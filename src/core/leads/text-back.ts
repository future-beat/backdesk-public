/**
 * SEND ONE MISSED-CALL TEXT-BACK — the ONE implementation the status door and
 * the tick sweep both call (Phase 12, D-01/D-04/D-06/D-15/D-22).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A MEMBER OF THE PUBLIC IS ON THE OTHER END, AND THEY RANG A TRADIE       │
 * │ SECONDS AGO. The whole of this file is the order of operations that      │
 * │ makes "exactly one text, to exactly the right person, or a recorded      │
 * │ reason why not" a property of the database rather than of luck:         │
 * │                                                                          │
 * │   PRE    reads only — nothing written, bounded by a deadline;            │
 * │   CLAIM  one transaction: the guarded claim on the missed call, every    │
 * │          gate fact, the decision, and (on a send) the LEDGER claim, the  │
 * │          touch, the approved draft — and on the lead route the lead and  │
 * │          the lead cadence;                                               │
 * │   SEND   after the commit, outside any transaction: one provider call,   │
 * │          then the outcome on the ledger and on the missed call.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── TWO ROUTES (D-08, founder 27 Sep 2026) ──────────────────────────────────
 *
 *   lead   — an ordinary caller. A lead, a lead cadence of three touches, and
 *            the business-hours or after-hours wording as its touch 1.
 *   quote  — a caller whose mobile is the contact snapshot of a LIVE quote
 *            cadence at this client. That customer is already in a
 *            conversation about a quote, so NO lead is opened and no lead
 *            cadence started: the call attaches to the quote cadence, which
 *            receives the "about your quote" wording as touch
 *            `ABOUT_QUOTE_TOUCH_NUMBER` (0), and is then paused through the
 *            existing reply pause (`pauseForReply`, reason `customer_reply` —
 *            only an operator lifts it). The tradie is told by the tick's
 *            quote-call escalation pass, keyed on this missed call (D-16).
 *
 * WHY TOUCH 0. The ledger's never-twice key is `(cadence_id, touch_number)`
 * and the quote's own touches hold 1..5, so 0 can never collide with them —
 * and it makes the about-quote text once per quote cadence, ever: a second
 * call claims nothing and is recorded `skipped` / `quote_open`. Touch 0 is
 * written already `sent` inside the claim transaction, so the re-window and
 * resume planners (which read unsent touches only) never see it, and the
 * quote's own schedule is untouched. Attribution excludes it
 * (`qualifyingTouches`): an automatic reply to the customer's own phone call
 * must never claim a win (D-17).
 *
 * A PAUSE THAT FAILS IS NEVER SILENT. The pause runs after the commit and
 * before the send; if it throws or does not land, the text is still sent (the
 * customer's reply would pause the cadence anyway), the call is recorded
 * `sent` with detail `pause_failed`, the result is `sent_pause_failed`, and
 * the tick's alert pass tells the operator to pause it by hand.
 *
 * ── THE CALLER'S NUMBER COMES FROM THE ROW, NEVER FROM A REQUEST ────────────
 *
 * This function takes a missed-call ID. The number it texts is read from the
 * row the Twilio-signed ARRIVAL door wrote, through `getMissedCallForTextBack`
 * — never from the status callback's parameters, which are a hint (T-12-01).
 *
 * ── IDEMPOTENT BY DATABASE FACTS ────────────────────────────────────────────
 *
 * A second delivery of the same callback, the tick sweep racing the callback,
 * and a redelivered arrival all converge: `claimForTextBack` is a guarded
 * UPDATE on `text_back_status IS NULL`, so exactly one claimant decides; then
 * `leads_one_open_per_mobile`, `cadences_one_live_per_lead` and
 * `send_ledger_cadence_touch_uniq` each refuse a second copy. The loser
 * returns `claim_lost` having written nothing.
 *
 * ── A CLAIM IS NEVER RE-SENT ────────────────────────────────────────────────
 *
 * If the sender throws, or recording its answer throws, the ledger outcome
 * stays NULL and the missed call stays `claimed`: the caller may already have
 * been texted, so nothing here or anywhere retries it (D-04, the dispatch
 * rule). It is surfaced to the operator, never resent.
 *
 * ── A STUB IS NEVER A TEXT-BACK (D-15) ──────────────────────────────────────
 *
 * The gate refuses `sms_not_armed` before any claim when the delegate SMS
 * provider is the stub or the client's SMS identity does not resolve; and as
 * a second belt, an outcome whose provider is `'stub'` is recorded `failed`.
 *
 * NEVER THROWS. Every failure is a member of the closed `TextBackKind` union,
 * every log line is a fixed string, and every caught value is discarded — a
 * driver error carries its statement parameters, which here include a caller's
 * number. Framework-free (no `next/*`) and model-free: the bytes sent are the
 * bytes an operator attested.
 */
import { claimedProviderFor } from '@/core/cadence/dispatch';
import { materializeCadenceSchedule } from '@/core/cadence/materialize';
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import type { SendOutcome, TouchSender } from '@/core/cadence/sender';
import { DEFAULT_PREFERRED_SEND_TIME } from '@/core/cadence/constants';
import { pauseForReply, type PauseForReplyResult } from '@/core/cadence/controls';
import { codeOf } from '@/core/messaging/clicksend-client';
import { resolveSmsFrom } from '@/core/messaging/routing-sender';
import { classifyCaller } from '@/core/telephony/caller';
import { withinDeadline } from '@/core/telephony/missed-call';
import {
  forTenant,
  getMissedCallForTextBack,
  isTextBackArmed,
  type MissedCallForTextBack,
  type TenantScopedRepository,
} from '@/db/repository';
import {
  TEXT_BACK_PAUSE_FAILED_DETAIL,
  type TextBackSkipReason,
  type TextBackVariant,
} from '@/db/schema';

import {
  ABOUT_QUOTE_TOUCH_NUMBER,
  LEAD_TOUCH_OFFSET_DAYS,
  TEXT_BACK_DRAFT_MODEL,
  TEXT_BACK_PRE_CLAIM_DEADLINE_MS,
  TEXT_BACK_PROMPT_VERSION,
  TEXT_BACK_RATE_WINDOW_HOURS,
} from './constants';
import { decideTextBack, isRecentConversion, isRecentNegativeClose } from './gate';
import { validateTextBackTemplate } from './template';

/** Everything that can become of one call. The only thing a caller may log. */
export const TEXT_BACK_KINDS = [
  'sent',
  /** Sent on the quote route, but the quote cadence could not be paused (alerted). */
  'sent_pause_failed',
  'failed',
  'skipped',
  'claim_lost',
  'already_decided',
  'not_found',
  'dead_letter',
  'pre_claim_failed',
  'outcome_unknown',
] as const;
export type TextBackKind = (typeof TEXT_BACK_KINDS)[number];

export interface TextBackResult {
  kind: TextBackKind;
}

export interface TextBackDeps {
  /** The decision clock: the claim time, the rate windows and staleness. */
  now: Date;
  /**
   * Builds the sender, asked ONLY when the client is armed (it may read the
   * database). The voice-status door passes `buildRoutingSender`.
   */
  getSender: () => Promise<TouchSender>;
  /** The pre-claim budget; defaults to TEXT_BACK_PRE_CLAIM_DEADLINE_MS. */
  deadlineMs?: number;
  /**
   * The quote route's reply pause; defaults to the real `pauseForReply`. A
   * seam so a test can make the pause fail and prove it is never silent.
   */
  pauseForReply?: (tenantId: string, cadenceId: string) => Promise<PauseForReplyResult>;
}

const RATE_WINDOW_MS = TEXT_BACK_RATE_WINDOW_HOURS * 3_600_000;
const MS_PER_DAY = 86_400_000;

/** `missed_calls_text_back_detail_shape`, so a provider code can never break the write. */
const DETAIL_SHAPE = /^[A-Za-z0-9_]{1,48}$/;

/** What the claim transaction decided. Exactly one owner per send. */
type Decided =
  | { kind: 'done'; result: TextBackKind }
  | {
      kind: 'send';
      route: 'lead';
      ledgerId: string;
      leadId: string;
      quoteId: null;
      cadenceId: string;
      touchNumber: number;
      caller: string;
      body: string;
    }
  | {
      kind: 'send';
      route: 'quote';
      ledgerId: string;
      leadId: null;
      quoteId: string;
      cadenceId: string;
      touchNumber: number;
      caller: string;
      body: string;
    };

/** The pause results that mean the quote cadence is standing down. */
const PAUSE_LANDED: ReadonlySet<PauseForReplyResult['kind']> = new Set(['paused', 'upgraded']);

export async function sendTextBack(missedCallId: string, deps: TextBackDeps): Promise<TextBackResult> {
  const now = deps.now;
  const deadlineAt = Date.now() + (deps.deadlineMs ?? TEXT_BACK_PRE_CLAIM_DEADLINE_MS);

  /* ── PRE: reads only, sequential, deadline-bounded (Pitfall 8) ──────────── */

  const read = await withinDeadline(() => getMissedCallForTextBack(missedCallId), deadlineAt);
  if (!read.ok) return preClaimFailed();
  const row = read.value;
  if (row === null) return { kind: 'not_found' };
  if (row.tenantId === null) return { kind: 'dead_letter' };
  if (row.textBackStatus !== null) return { kind: 'already_decided' };
  const tenantId = row.tenantId;

  const armedRead = await withinDeadline(() => isTextBackArmed(tenantId), deadlineAt);
  if (!armedRead.ok) return preClaimFailed();
  const armed = armedRead.value;

  // Only an armed client costs a sender build and an identity read; an unarmed
  // one is recorded `not_armed` by the gate, which asks nothing else first.
  let sender: TouchSender | null = null;
  let provider = 'stub';
  let smsFrom: string | null = null;
  if (armed) {
    const built = await withinDeadline(() => deps.getSender(), deadlineAt);
    if (!built.ok) return preClaimFailed();
    sender = built.value;
    provider = claimedProviderFor(sender, 'sms');

    const from = await withinDeadline(() => resolveSmsFrom(tenantId), deadlineAt);
    if (!from.ok) return preClaimFailed();
    smsFrom = from.value;
  }

  /* ── CLAIM: one transaction ─────────────────────────────────────────────── */

  let decided: Decided;
  try {
    decided = await forTenant(tenantId).transaction((tx) =>
      decideInTransaction(tx, row, { now, armed, provider, smsFrom }),
    );
  } catch {
    // Rolled back: the claim with it, so the row is still undecided and the
    // tick sweep retries it within the minute. Nothing was written.
    console.error('[text-back] decision transaction failed; nothing written.');
    return { kind: 'pre_claim_failed' };
  }

  if (decided.kind === 'done') return { kind: decided.result };
  if (sender === null) {
    // Unreachable: a send is only decided for an armed client, and an armed
    // client always has a sender. Recorded as unknown rather than guessed.
    console.error('[text-back] send decided with no sender; claim left as is.');
    return { kind: 'outcome_unknown' };
  }

  /* ── PAUSE (quote route only): after the commit, before the send ───────── */

  // The quote cadence stands down through the EXISTING reply pause (D-17): no
  // new reason, event or status. A failure does not stop the text — the
  // customer's reply would pause the cadence anyway — but it is recorded and
  // alerted, never silent.
  let pauseFailed = false;
  if (decided.route === 'quote') {
    try {
      const paused = await (deps.pauseForReply ?? pauseForReply)(tenantId, decided.cadenceId);
      if (!PAUSE_LANDED.has(paused.kind)) pauseFailed = true;
    } catch {
      // The caught value is discarded: a driver error carries its parameters.
      pauseFailed = true;
    }
    if (pauseFailed) console.error('[text-back] quote cadence pause did not land; will alert.');
  }

  /* ── SEND: after the commit, outside any transaction (dispatch's rule) ──── */

  let outcome: SendOutcome;
  try {
    outcome = await sender.send({
      ledgerId: decided.ledgerId,
      tenantId,
      quoteId: decided.quoteId,
      leadId: decided.leadId,
      cadenceId: decided.cadenceId,
      touchNumber: decided.touchNumber,
      channel: 'sms',
      to: { address: decided.caller, contactName: null },
      body: decided.body,
    });
  } catch {
    console.error('[text-back] sender threw; outcome left unknown, never resent.');
    return { kind: 'outcome_unknown' };
  }

  // A stub is never a sent text-back (D-15), whatever it says.
  const recorded: 'sent' | 'failed' =
    outcome.kind === 'sent' && outcome.provider !== 'stub' ? 'sent' : 'failed';
  const detail =
    recorded === 'sent'
      ? pauseFailed
        ? TEXT_BACK_PAUSE_FAILED_DETAIL
        : null
      : outcome.kind === 'failed'
        ? detailCode(outcome.reason)
        : 'stub';

  try {
    const repo = forTenant(tenantId);
    await repo.ledger.setOutcome(
      decided.ledgerId,
      recorded,
      outcome.kind === 'sent' && recorded === 'sent' ? outcome.providerMessageId : null,
    );
    await repo.missedCalls.setTextBackOutcome(row.id, recorded, detail);
  } catch {
    console.error('[text-back] could not record the outcome; left unknown, never resent.');
    return { kind: 'outcome_unknown' };
  }

  return { kind: recorded === 'sent' && pauseFailed ? 'sent_pause_failed' : recorded };
}

function preClaimFailed(): TextBackResult {
  // Nothing written; the row stays undecided and the sweep sends it (D-01).
  console.warn('[text-back] pre-claim read failed or timed out; nothing written.');
  return { kind: 'pre_claim_failed' };
}

/** A provider reason reduced to a code the detail CHECK accepts. */
function detailCode(reason: string): string {
  const code = codeOf(reason);
  return DETAIL_SHAPE.test(code) ? code : 'unknown';
}

/**
 * Everything between the claim and the commit. Every read is on `tx`, so a
 * failure anywhere rolls the CLAIM back too and the sweep retries — an absent
 * fact is a refusal to decide, never a pass.
 */
async function decideInTransaction(
  tx: TenantScopedRepository,
  row: MissedCallForTextBack,
  pre: { now: Date; armed: boolean; provider: string; smsFrom: string | null },
): Promise<Decided> {
  const { now } = pre;

  // THE ARBITER. Zero rows: another caller owns this call.
  const claimed = await tx.missedCalls.claimForTextBack(row.id, now);
  if (claimed.length === 0) return { kind: 'done', result: 'claim_lost' };

  const caller = row.callerE164;
  const callerIsMobile = row.callerKind === 'mobile' && caller !== null;

  // D-22: a repeat call joins the caller's open lead, whatever the gate says.
  // The returned row (at most one: `leads_one_open_per_mobile`) is the lead
  // this call joined — kept for the ring-twice ids below.
  const [repeatLead] = callerIsMobile ? await tx.leads.noteRepeatCall(caller, now) : [];

  const skip = async (reason: TextBackSkipReason): Promise<Decided> => {
    // Phase 13, D-07 — RING-TWICE'S DATA. A second call from a caller with an
    // open lead is skipped `recent_text` (texted inside the window) or
    // `lead_open` (the lead already exists); either way it sends nothing, and
    // the ring-twice escalation pass (plan 13-06) is the one reader of these
    // two ids: which lead the call joined, and that lead's live cadence. A
    // skip for a caller with no open lead, or for any other reason, writes
    // neither, exactly as before.
    if ((reason === 'recent_text' || reason === 'lead_open') && repeatLead) {
      const [liveCadence] = await tx.cadences.liveForLead(repeatLead.id);
      await tx.missedCalls.setTextBackDecision(row.id, {
        status: 'skipped',
        skipReason: reason,
        leadId: repeatLead.id,
        ...(liveCadence ? { cadenceId: liveCadence.id } : {}),
      });
      return { kind: 'done', result: 'skipped' };
    }
    await tx.missedCalls.setTextBackDecision(row.id, { status: 'skipped', skipReason: reason });
    return { kind: 'done', result: 'skipped' };
  };

  const [tenant] = await tx.tenant.get();
  if (!tenant) throw new Error('tenant row missing');
  const neverText = await tx.neverText.list();
  const [divert] = await tx.divertNumber.get();

  // The client's own numbers, every source D-06 names. A substituted caller ID
  // is caught by the list AND by ForwardedFrom when the carrier sends it.
  const ownNumbers = new Set<string>(neverText.map((entry) => entry.numberE164));
  const escalationMobile = normalizeAuMobile(tenant.escalationPhone);
  if (escalationMobile !== null) ownNumbers.add(escalationMobile);
  const escalationAny = classifyCaller(tenant.escalationPhone).e164;
  if (escalationAny !== null) ownNumbers.add(escalationAny);
  if (divert?.numberE164) ownNumbers.add(divert.numberE164);
  if (pre.smsFrom !== null) ownNumbers.add(pre.smsFrom);

  // ForwardedFrom is EVIDENCE (11-08 override), never required.
  const forwardedFromE164 = classifyCaller(row.forwardedFromRaw).e164;
  if (
    forwardedFromE164 !== null &&
    !neverText.some((entry) => entry.kind === 'own_line' && entry.numberE164 === forwardedFromE164)
  ) {
    console.warn('[text-back] forwarded_from_unlisted');
  }

  const since = new Date(now.getTime() - RATE_WINDOW_MS);
  const suppressed =
    caller !== null &&
    (await tx.suppression.existsFor([{ channel: 'sms', address: caller }])).length > 0;
  // Phase 13, D-12 — beside suppression, the other per-caller "must not text"
  // fact: the caller's NEWEST lead here closed negatively within
  // LEAD_NEGATIVE_COOL_OFF_DAYS. The rule itself is pure (gate.ts) so its
  // reasons and its boundary are provable without a database.
  const [newestLead] = caller !== null ? await tx.leads.latestForMobile(caller) : [];
  const recentNegativeClose = isRecentNegativeClose(newestLead, now);
  // Phase 15, D-08b — rule 7's fact from the SAME newest lead: it converted
  // within LEAD_RECENT_CONVERSION_HOURS. No new read.
  const recentConversion = isRecentConversion(newestLead, now);
  const textedSince24h =
    caller !== null && (await tx.missedCalls.existsTextBackToCallerSince(caller, since, row.id));
  const sentSince24h = await tx.missedCalls.countTextBacksSince(since, row.id);
  const openQuote = caller !== null ? await tx.cadences.liveQuoteCadenceForMobile(caller) : [];

  // D-08: a caller with a live quote cadence here gets the "about your quote"
  // wording, so gate rule ten checks THAT variant's attestation.
  const variant: TextBackVariant =
    openQuote.length > 0 ? 'about_quote' : row.afterHours ? 'after_hours' : 'business_hours';
  const [template] = await tx.textBackTemplates.latestAttested(variant);
  // Re-validated AT SEND against the client's name. The stored body must also
  // already be canonical: the bytes sent are the bytes stored, never a
  // normalization the operator did not see.
  const validated = template
    ? validateTextBackTemplate(template.body, { businessName: tenant.name, variant })
    : null;
  const templateOk =
    validated !== null && validated.ok && validated.normalizedBody === template?.body;

  const decision = decideTextBack(
    {
      armed: pre.armed,
      callerE164: caller,
      callerKind: row.callerKind,
      forwardedFromE164,
      ownNumbers: [...ownNumbers],
      suppressed,
      recentNegativeClose,
      recentConversion,
      textedSince24h,
      sentSince24h,
      referenceAt: row.endedAt ?? row.startedAt,
      smsFrom: pre.smsFrom,
      provider: pre.provider,
      openQuoteCadence: openQuote.length > 0,
      templateOk,
      variant,
    },
    now,
  );
  if (!decision.send) return skip(decision.reason);

  // The gate passed, so the caller is a mobile with a number and a template.
  if (!callerIsMobile || !template) throw new Error('gate passed without its facts');

  /* ── The quote route (D-08, D-17) ─────────────────────────────────────── */

  const quoteCadence = openQuote[0];
  if (quoteCadence) {
    return decideAboutQuote(tx, row.id, {
      now,
      caller,
      cadence: quoteCadence,
      body: template.body,
      segments: validated?.ok ? validated.segments : null,
      provider: pre.provider,
    });
  }

  /* ── The lead branch ──────────────────────────────────────────────────── */

  const [lead] = await tx.leads.openOrCreate({
    contactMobile: caller,
    firstMissedCallId: row.id,
    afterHours: row.afterHours,
    at: now,
  });
  if (!lead) return skip('lead_open');

  const [cadence] = await tx.cadences.createLead({
    leadId: lead.id,
    contactMobile: caller,
    anchorAt: now,
  });
  if (!cadence) return skip('lead_open');

  const preferred = (await tx.settings.get())[0]?.preferredSendTime ?? DEFAULT_PREFERRED_SEND_TIME;
  const touches = await tx.touches.insertMany(
    leadSchedule(now, preferred, {
      timezone: tenant.timezone,
      contactHoursStart: tenant.contactHoursStart,
      contactHoursEnd: tenant.contactHoursEnd,
      contactDays: tenant.contactDays,
    }).map((touch) => ({ cadenceId: cadence.id, ...touch })),
  );
  const first = touches.find((touch) => touch.touchNumber === 1);
  if (!first) throw new Error('lead touch 1 missing');

  // The one stored copy of what the caller is sent (the ledger has no body).
  // Inserted `generated` and then approved through `drafts.approve` — the only
  // path to `approved` — because the operator's attestation IS the approval.
  const [draft] = await tx.drafts.insertAttempt({
    cadenceId: cadence.id,
    quoteId: null,
    touchId: first.id,
    touchNumber: 1,
    attempt: 1,
    model: TEXT_BACK_DRAFT_MODEL,
    promptVersion: TEXT_BACK_PROMPT_VERSION,
    generatedBody: template.body,
    finalBody: template.body,
    status: 'generated',
    segments: validated?.ok ? validated.segments : null,
  });
  if (!draft) throw new Error('text-back draft not written');
  await tx.drafts.approve(draft.id, { finalBody: template.body, editDistance: '0', approvedAt: now });

  const [ledger] = await tx.ledger.insertClaim({
    cadenceId: cadence.id,
    leadId: lead.id,
    quoteId: null,
    touchNumber: 1,
    channel: 'sms',
    toAddress: caller,
    sender: pre.provider,
  });
  // CANNOT HAPPEN, SO IT THROWS (12-REVIEW WR-04). The cadence was created in
  // THIS transaction, so `(cadence, 1)` cannot already be claimed. Returning
  // `claim_lost` here would COMMIT a `claimed` missed call with no ledger row,
  // a live lead cadence and an approved draft for a text never sent — later
  // alerted as "may already have reached the caller", and never textable
  // again under `cadences_one_live_per_lead`. A throw rolls the claim back
  // with everything else, and the sweep retries, like every other impossible
  // state in this function. (The quote route's zero-row claim is a real skip.)
  if (!ledger) throw new Error('lead ledger claim returned no row');

  await tx.touches.markSent([first.id]);
  await tx.missedCalls.setTextBackDecision(row.id, {
    status: 'claimed',
    route: 'lead',
    leadId: lead.id,
    cadenceId: cadence.id,
    ledgerId: ledger.id,
  });

  return {
    kind: 'send',
    route: 'lead',
    ledgerId: ledger.id,
    leadId: lead.id,
    quoteId: null,
    cadenceId: cadence.id,
    touchNumber: 1,
    caller,
    body: template.body,
  };
}

/**
 * THE ABOUT-QUOTE TEXT AS TOUCH 0 OF THE LIVE QUOTE CADENCE (D-08, D-17).
 *
 * CLAIM FIRST: the ledger claim on `(cadence, ABOUT_QUOTE_TOUCH_NUMBER)` is
 * the arbiter of "once per quote cadence". Zero rows means this cadence has
 * already had its about-quote text, and the call is recorded `skipped` /
 * `quote_open` with the route and the cadence — so the quote-call escalation
 * still tells the tradie about the call (D-16).
 *
 * Then the touch (written straight to `sent`), the approved draft holding the
 * attested bytes, and the decision — all on `tx`. NO lead, no lead cadence,
 * and the quote's own touches are neither read nor written.
 */
async function decideAboutQuote(
  tx: TenantScopedRepository,
  missedCallId: string,
  input: {
    now: Date;
    caller: string;
    cadence: { id: string; quoteId: string | null };
    body: string;
    segments: number | null;
    provider: string;
  },
): Promise<Decided> {
  const { now, caller, cadence, body } = input;
  // `cadences_kind_identity`: a quote cadence always carries its quote.
  const quoteId = cadence.quoteId;
  if (quoteId === null) throw new Error('quote cadence without a quote');

  const [ledger] = await tx.ledger.insertClaim({
    cadenceId: cadence.id,
    quoteId,
    leadId: null,
    touchNumber: ABOUT_QUOTE_TOUCH_NUMBER,
    channel: 'sms',
    toAddress: caller,
    sender: input.provider,
  });
  if (!ledger) {
    await tx.missedCalls.setTextBackDecision(missedCallId, {
      status: 'skipped',
      skipReason: 'quote_open',
      route: 'quote',
      cadenceId: cadence.id,
    });
    return { kind: 'done', result: 'skipped' };
  }

  const [touch] = await tx.touches.insertMany([
    {
      cadenceId: cadence.id,
      touchNumber: ABOUT_QUOTE_TOUCH_NUMBER,
      channel: 'sms',
      scheduledAt: now,
      originalOffsetDays: 0,
    },
  ]);
  // The ledger claim just won on this (cadence, touch), so no touch 0 can
  // exist; an absent row is a fault that rolls everything back.
  if (!touch) throw new Error('about-quote touch not written');

  const [draft] = await tx.drafts.insertAttempt({
    cadenceId: cadence.id,
    quoteId,
    touchId: touch.id,
    touchNumber: ABOUT_QUOTE_TOUCH_NUMBER,
    attempt: 1,
    model: TEXT_BACK_DRAFT_MODEL,
    promptVersion: TEXT_BACK_PROMPT_VERSION,
    generatedBody: body,
    finalBody: body,
    status: 'generated',
    segments: input.segments,
  });
  if (!draft) throw new Error('about-quote draft not written');
  await tx.drafts.approve(draft.id, { finalBody: body, editDistance: '0', approvedAt: now });

  await tx.touches.markSent([touch.id]);
  await tx.missedCalls.setTextBackDecision(missedCallId, {
    status: 'claimed',
    route: 'quote',
    leadId: null,
    cadenceId: cadence.id,
    ledgerId: ledger.id,
  });

  return {
    kind: 'send',
    route: 'quote',
    ledgerId: ledger.id,
    leadId: null,
    quoteId,
    cadenceId: cadence.id,
    touchNumber: ABOUT_QUOTE_TOUCH_NUMBER,
    caller,
    body,
  };
}

/**
 * The lead cadence's three touches (D-04). Touch 1 is NOW — exempt from
 * contact hours, the caller rang seconds ago. Touches 2 and 3 are placed by
 * the quote path's materializer with the client's window and preferred time
 * and zero jitter; they are INERT until Phase 13 re-windows them, so if the
 * window cannot be honoured the fallback is plain day offsets from now.
 */
function leadSchedule(
  now: Date,
  preferredSendTime: string,
  window: {
    timezone: string;
    contactHoursStart: string;
    contactHoursEnd: string;
    contactDays: readonly number[];
  },
): Array<{
  touchNumber: number;
  channel: 'sms';
  scheduledAt: Date;
  originalOffsetDays: number;
}> {
  const templates = LEAD_TOUCH_OFFSET_DAYS.map((offsetDays, index) => ({
    touchNumber: index + 1,
    offsetDays,
    channel: 'sms' as const,
  }));

  try {
    return materializeCadenceSchedule({
      anchor: now,
      templates,
      window,
      preferredSendTime,
      jitterMinutes: () => 0,
    }).map((touch) => ({
      touchNumber: touch.touchNumber,
      channel: 'sms' as const,
      scheduledAt: touch.touchNumber === 1 ? now : touch.scheduledAt,
      originalOffsetDays: touch.originalOffsetDays,
    }));
  } catch {
    console.warn('[text-back] lead schedule fallback');
    return templates.map((template) => ({
      touchNumber: template.touchNumber,
      channel: 'sms' as const,
      scheduledAt: new Date(now.getTime() + template.offsetDays * MS_PER_DAY),
      originalOffsetDays: template.offsetDays,
    }));
  }
}
