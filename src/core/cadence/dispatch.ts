/**
 * The claim transaction: due touch → just-in-time revalidation → ledger claim →
 * sender (CAD-04, CAD-05).
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*`. This is the
 * only place in the system that causes a message to exist, so the rule it
 * encodes — the conditions under which a real customer may be contacted — must
 * be reachable from a test, a script and a route alike, not from a route only.
 *
 * ── THE ORDER OF OPERATIONS IS THE GUARANTEE ────────────────────────────────
 *
 *   1. CLAIM the due rows with `FOR UPDATE OF cadence_touches SKIP LOCKED`
 *      (`forTenant(id).touches.claimDue`, which is where the SQL lives because
 *      the raw client is banned outside the repository). Overlapping ticks take
 *      DISJOINT sets and neither blocks — that is liveness, not correctness.
 *   2. REVALIDATE, re-read INSIDE the same transaction (CAD-05). Everything the
 *      schedule assumed is now minutes to weeks old: the quote may have been
 *      won, the key may have been revoked, the client may have paused, the
 *      customer may have asked us to stop, and the contact window may have
 *      closed since the touch was approved. A check performed before the
 *      transaction would be a TOCTOU with a real customer at the end of it.
 *   3. CLAIM THE LEDGER: `INSERT … ON CONFLICT (cadence_id, touch_number) DO
 *      NOTHING RETURNING id`. ZERO ROWS MEANS ANOTHER PROCESS OWNS THIS TOUCH,
 *      and this one refuses silently. This is the structural never-twice, and it
 *      holds even when SKIP LOCKED is bypassed entirely — a second deployment, a
 *      manual invocation, a cron that fired twice.
 *   4. MARK the touch `sent`, COMMIT, and only THEN invoke the sender.
 *
 * ── AT-MOST-ONCE, ON PURPOSE ────────────────────────────────────────────────
 *
 * Step 4 puts the commit before the send, so a crash in between leaves a ledger
 * row with `outcome IS NULL`, which means exactly "we do not know whether this
 * went out". Such a row is surfaced to the operator and NEVER auto-resent. The
 * product rule is "a late or duplicate touch is worse than a skipped touch", and
 * the alternative ordering — send first, record after — turns every crash into a
 * customer who might be messaged twice.
 *
 * The sender is invoked OUTSIDE the transaction for a second reason: holding a
 * pooled Postgres connection open across a third-party HTTP call is what
 * `run-sync.ts` already refuses to do, and Phase 4 makes that call real.
 *
 * ── THE FOUR REFUSALS, AND WHY TWO OF THEM ARE PERMANENT ────────────────────
 *
 *   quote closed / no longer eligible → skip the touch (`quote_closed`) AND stop
 *     the cadence, with the reason read off the quote's actual state rather than
 *     guessed. Permanent: the job is decided.
 *   recipient suppressed → skip (`suppressed`) AND stop (`contact_suppressed`).
 *     Permanent by design (D-06): a suppression is one-way.
 *   connection or client paused → refuse SILENTLY, leaving the touch alone. A
 *     pause is reversible, so consuming the touch would destroy work that the
 *     resume is supposed to restore.
 *   outside the contact window → refuse SILENTLY, same reasoning. Plan 03-04's
 *     re-window pass owns moving it; skipping it here would apply D-11's
 *     staleness verdict from a module that has not been given that decision.
 */
import {
  forAllTenants_cadenceTick,
  forTenant,
  type CadenceTickTenant,
  type ClaimedTouch,
  type TenantScopedRepository,
} from '@/db/repository';
import type { CadenceStopReason, SendLedgerOutcome } from '@/db/schema';
import type { TouchChannel } from '@/db/schema/cadence-templates';
import { closeLeadInTx } from '@/core/leads/close';

// `stubTouchBody` is deliberately NOT imported any more (05-01): dispatch
// composes no bodies at all. The function is still exported from sender.ts and
// still pinned by tests/touch-body.test.ts — it is the Phase 3 artefact, kept
// because deleting it would delete the record of what the stub era sent, and
// `send_ledger` rows from that era are excluded from Phase 7 attribution on the
// strength of it.
import type { SendOutcome, SendRequest, TouchSender } from './sender';
import { isInsideWindow, type ContactWindow } from './window';

/**
 * How many touches one tenant may have claimed in a single tick.
 *
 * Bounds one transaction, exactly as the outbox batch limit does. A tenant whose
 * cadences all came due at once (a resume after a long pause) makes progress
 * across several ticks rather than opening one transaction long enough to be
 * killed by the platform mid-claim.
 */
export const DISPATCH_BATCH_LIMIT = 50;

export interface DispatchOptions {
  sender: TouchSender;
  now: Date;
  batchLimit?: number;
}

/**
 * A sender that can say which provider will actually handle a given channel
 * BEFORE it is asked to send (Phase 4, D-06).
 *
 * ── WHY THIS EXISTS, AND WHY DISPATCH STILL TAKES EXACTLY ONE SENDER ────────
 *
 * The ledger row is claimed BEFORE the send runs (see step 3 in the header), and
 * `sender` is written into it at that moment. With one provider that was simply
 * `sender.provider`. Phase 4 routes sms and email to different providers behind
 * a single composite (`RoutingSender`), and a composite has no honest `provider`
 * of its own — so the claim would record a name no provider has.
 *
 * That is not cosmetic. `send_ledger.sender` is the column Phase 7 excludes stub
 * rows by when computing recovered revenue, years later, against rows written
 * today (see send-ledger.ts). A ledger that records the composite cannot answer
 * "was this actually sent", which is the question an invoice is stapled to.
 *
 * The alternative — giving `DispatchOptions` a sender PER CHANNEL — was
 * rejected: it moves the routing decision into dispatch, so the rule "which
 * provider handles email" would then exist here AND in whatever built the map,
 * and D-06 keeps this file's sender-facing surface at exactly one object. This
 * interface instead lets the composite answer the question with the same rule it
 * will use to route the send.
 *
 * It lives HERE rather than beside `RoutingSender` so the import direction stays
 * messaging→cadence, which is the direction every sender already imports in.
 */
export interface ChannelAwareTouchSender extends TouchSender {
  /** The provider that `send()` will delegate a `channel` request to. */
  providerFor(channel: TouchChannel): string;
}

/**
 * STRUCTURAL, not nominal, and deliberately so: `StubSender` and every test
 * sender in this repository predate the interface and must keep working
 * untouched. A sender that does not answer `providerFor` is one that handles
 * every channel itself, so its `.provider` IS the answer.
 */
export function isChannelAware(sender: TouchSender): sender is ChannelAwareTouchSender {
  return typeof (sender as Partial<ChannelAwareTouchSender>).providerFor === 'function';
}

/**
 * The name to write into `send_ledger.sender` for this touch.
 *
 * ONE QUESTION, ONE ANSWER: a channel-aware sender resolves it through the very
 * rule its `send()` will use, so the claimed provider and the sending provider
 * cannot disagree. A plain sender answers with the only provider it has.
 *
 * EXPORTED (Phase 12) for the text-back path, which must write the DELEGATE's
 * name into its ledger claim and must recognise `'stub'` BEFORE claiming
 * (D-15). One rule, imported — never a second implementation in another file.
 */
export function claimedProviderFor(sender: TouchSender, channel: TouchChannel): string {
  return isChannelAware(sender) ? sender.providerFor(channel) : sender.provider;
}

/**
 * Why a claimed touch was not sent. A CLOSED VOCABULARY, and every arm below
 * returns one — there is no unlabelled refusal.
 *
 * These are NOT `TOUCH_SKIP_REASONS`, even where a name appears in both. That
 * column is the durable record of a rule that retired a touch forever, and
 * three of these write to it (`quote_closed`, `suppressed` and `no_address`).
 * The other three describe a decision this TICK made about a touch that is
 * still live: `paused` and `outside_window` leave it exactly where it was, and
 * `claim_lost` means another process owns it. Collapsing them into one
 * `refused` number is what made the previous shape unable to answer the only
 * question an operator asks about a quiet tick: quiet because there was nothing
 * to do, or quiet because we declined everything?
 */
export const DISPATCH_REFUSALS = [
  /** Either pause was set when the claim transaction re-read it. Touch untouched. */
  'paused',
  /** The quote is no longer an open, chase-eligible Quote. Touch skipped, cadence stopped. */
  'quote_closed',
  /**
   * G-3-5 — the just-in-time re-read found NO row for this job in our mirror.
   * Touch skipped, cadence stopped `mirror_missing`, IRREVERSIBLY.
   *
   * ITS OWN MEMBER, not folded into `quote_closed`, for the reason migration
   * 0022 gives about the stop-reason column and for one more that is specific to
   * this vocabulary. The argument for folding was that a refusal names THIS
   * TICK's decision rather than the durable reason — true, and it holds equally
   * well for a `mirror_missing` member. What it cannot survive is that the tick
   * response body is the operator's only near-real-time view: with one shared
   * label, `{ quote_closed: 9 }` is nine customers who bought or declined, or
   * nine cadences killed forever because our own sync is broken, and those want
   * opposite responses. One of the three documented causes of this branch is "a
   * bug in our own sync" — a counter that cannot show it is a counter that
   * cannot raise the alarm on us.
   */
  'mirror_missing',
  /** D-15: the recipient asked us to stop. Touch skipped, cadence stopped. */
  'suppressed',
  /** DNCR contact hours. Touch untouched — the re-window pass owns moving it. */
  'outside_window',
  /** The ledger claim returned zero rows: another process owns this touch. */
  'claim_lost',
  /** No address on the touch's channel. Unreachable by construction; touch retired `no_address`. */
  'no_address',
  /**
   * D-10 — the touch is `approved` and NO APPROVED DRAFT ROW EXISTS for it.
   *
   * A BROKEN INVARIANT, AND THE HONEST RESPONSE IS TO SEND NOTHING. Since
   * Phase 5 the only path to `approved` is `touches.approveWhere` beside
   * `drafts.approve`, so the two are written together; a touch that reached
   * here without a draft means something wrote that status by another route —
   * a manual UPDATE, a half-applied migration, a bug in a later plan.
   *
   * THE TEMPTING ALTERNATIVE IS THE DANGEROUS ONE. Dispatch used to compose a
   * body itself (`stubTouchBody`), and the "obvious" repair is to fall back to
   * that, or to merge-fill the template. Either would send a real customer, in a
   * tradie's name, a message that NO MODEL WROTE AND NO HUMAN APPROVED — which
   * is precisely the failure the D-12 review gate exists to prevent, arriving
   * through the one door nobody is watching. D-10 forbids the merge-fill
   * fallback by name.
   *
   * Touch UNTOUCHED, like `paused` and `outside_window`: the state is
   * recoverable (approve a draft, or investigate the write) and skipping the
   * touch would retire a customer's follow-up over our own bug. The counter is
   * the alarm.
   */
  'no_approved_draft',
  /**
   * Phase 13 (D-10, D-14) — a LEAD touch whose lead is no longer chaseable:
   * the lead is not open, the caller's mobile is on a live QUOTE cadence at
   * this client (the quote conversation wins), or the lead's touch 1 — the
   * text-back — did not go out. Touch skipped `cadence_stopped`, cadence
   * stopped `lead_closed`, and the lead closed (`quote_cadence_wins`, else
   * `expired`) on this same claim transaction.
   *
   * ITS OWN MEMBER, not `quote_closed`: a lead has no quote, and the
   * operator reading `{ quote_closed: 3 }` must never be looking at three
   * missed callers. Decided BEFORE any quote mirror read — the quote branch's
   * failure arm is the irreversible `mirror_missing` stop.
   */
  'lead_closed',
] as const;
export type DispatchRefusal = (typeof DISPATCH_REFUSALS)[number];

function noRefusals(): Record<DispatchRefusal, number> {
  return Object.fromEntries(DISPATCH_REFUSALS.map((reason) => [reason, 0])) as Record<
    DispatchRefusal,
    number
  >;
}

/** Counts only — see `ConsumeQuoteEventsResult` for why that matters. */
export interface DispatchResult {
  /** Ledger rows claimed and handed to the sender. */
  dispatched: number;
  /** Due touches this tick declined to send, for any reason. Sums `refusals`. */
  refused: number;
  /** The same total, split by the rule that decided. Counts only — no ids, no addresses. */
  refusals: Record<DispatchRefusal, number>;
}

/** A send the transaction has already committed to. Invoked after it closes. */
interface PendingSend {
  tenantId: string;
  ledgerId: string;
  request: SendRequest;
}

/** One claimed touch's fate. Never a bare `null` — a refusal names its rule. */
type TouchOutcome =
  | { kind: 'send'; send: PendingSend }
  | { kind: 'refused'; reason: DispatchRefusal };

/**
 * The honest stop reason for a quote that is no longer chaseable, READ OFF THE
 * QUOTE rather than assumed.
 *
 * `CADENCE_STOP_REASONS` has no "quote_closed" member, deliberately: Phase 7
 * attributes revenue on this column, and "we stopped because the quote closed"
 * would collapse a won job, a lost job and a deleted job into one bucket. The
 * quote's own state distinguishes them, and it is right here in the transaction.
 */
function stopReasonForQuote(quote: {
  status: string;
  sm8Active: boolean;
  chaseEligibility: string;
}): CadenceStopReason {
  // Checked first: a deleted job is deleted whatever status it froze at, and it
  // is the most urgent thing to stop chasing.
  if (!quote.sm8Active) return 'removed';
  if (quote.status === 'Work Order' || quote.status === 'Completed') return 'won';
  if (quote.status === 'Unsuccessful') return 'lost';

  // Still an open Quote, but no longer eligible — which in this codebase has
  // exactly one writer: the D-08 reopen flip back to `needs_review`.
  return 'reopened';
}

/**
 * The four tenant columns that make a contact window.
 *
 * EXPORTED so the tick's progress pass and this claim path cannot disagree about
 * which columns constitute a window. Two copies of this mapping is two answers
 * to "may we contact them now" — one used to place a slot, one used to refuse a
 * send — and the disagreement would show up as a touch that is re-windowed and
 * refused in the same minute, forever.
 *
 * Takes only the four columns (Phase 13, 13-06), so the escalation passes can
 * hand it a `tenants` row for the D-09 hold and still ask this one mapping.
 */
export function contactWindowOf(
  tenant: Pick<
    CadenceTickTenant,
    'timezone' | 'contactHoursStart' | 'contactHoursEnd' | 'contactDays'
  >,
): ContactWindow {
  return {
    timezone: tenant.timezone,
    contactHoursStart: tenant.contactHoursStart,
    contactHoursEnd: tenant.contactHoursEnd,
    contactDays: tenant.contactDays,
  };
}

/** The snapshotted address this touch's channel sends to. */
function addressFor(touch: ClaimedTouch): string | null {
  return touch.channel === 'sms' ? touch.contactMobile : touch.contactEmail;
}

/**
 * One tenant's due touches, in one transaction. Returns the sends the
 * transaction committed to, for the caller to invoke after it closes.
 */
async function claimForTenant(
  tenant: CadenceTickTenant,
  options: DispatchOptions,
): Promise<{ pending: PendingSend[]; refusals: Record<DispatchRefusal, number> }> {
  const { sender, now, batchLimit = DISPATCH_BATCH_LIMIT } = options;
  const win = contactWindowOf(tenant);

  return forTenant(tenant.tenantId).transaction(async (tx) => {
    const pending: PendingSend[] = [];
    const refusals = noRefusals();

    // ORDERED BY `scheduled_at`, THEN `id` (the SQL lives in `claimDue`): oldest
    // work first, with a deterministic tie-break so two ticks claiming from the
    // same backlog walk it in the same order rather than one the planner may
    // vary between runs. Without the tie-break, two overlapping ticks can
    // interleave over an identically-timed pair and both do useful work — but
    // which touch each one takes changes run to run, and a concurrency bug that
    // only appears under one interleaving becomes unreproducible.
    const claimed = await tx.touches.claimDue(now, batchLimit);
    if (claimed.length === 0) return { pending, refusals };

    // ── JIT re-reads, once per transaction: they are the same answer for every
    // touch in it, and re-reading per touch would be a second chance to get a
    // DIFFERENT answer inside one transaction, which cannot happen and would be
    // confusing if it appeared to.
    const [connection] = await tx.connection.get();
    const [settings] = await tx.settings.get();

    // The outbox carries no permission to send, and neither does the tick's
    // snapshot of these flags taken moments ago. BOTH pauses block, and neither
    // implies the other: a successful re-key says nothing about whether the
    // client wants messaging resumed.
    if (!connection || connection.pausedAt !== null || settings?.pausedAt != null) {
      refusals.paused = claimed.length;
      return { pending, refusals };
    }

    const insideWindow = isInsideWindow(now, win);

    for (const touch of claimed) {
      const outcome = await dispatchOne(tx, touch, tenant, {
        sender,
        insideWindow,
        now,
      });

      if (outcome.kind === 'send') pending.push(outcome.send);
      else refusals[outcome.reason] += 1;
    }

    return { pending, refusals };
  });
}

/**
 * One claimed touch: revalidate, claim the ledger, mark sent. Returns the send
 * to perform after the commit, or the NAMED rule that refused it.
 */
async function dispatchOne(
  tx: TenantScopedRepository,
  touch: ClaimedTouch,
  tenant: CadenceTickTenant,
  context: { sender: TouchSender; insideWindow: boolean; now: Date },
): Promise<TouchOutcome> {
  // ── THE KIND SWITCH IS THE FIRST STATEMENT (Phase 13, D-10/D-14). ────────
  //
  // A lead touch must never reach the quote mirror read below: a lead has no
  // job uuid, and that read's failure arm stops the cadence `mirror_missing`,
  // irreversibly. Each kind asks its own "may we still chase this?", and a
  // chaseable touch of either kind falls through to the SHARED tail —
  // address, suppression, contact window, approved bytes, ledger claim,
  // markSent — which is identical for both.
  const refused =
    touch.kind === 'lead'
      ? await refuseUnchaseableLead(tx, touch, context.now)
      : await refuseUnchaseableQuote(tx, touch);
  if (refused !== null) return refused;

  return claimAndCommit(tx, touch, tenant, context);
}

/**
 * CAD-05 (a) for a LEAD touch (Phase 13, D-10/D-14; research Q8 and Open
 * Question 3). Chaseable means: the lead is still `open`, the caller's mobile
 * is NOT on a live quote cadence at this client, and the lead's touch 1 (the
 * text-back) has a ledger row whose outcome is `sent` — a caller whose
 * text-back failed must not receive "still need a hand?".
 *
 * NOT CHASEABLE: skip this touch, stop the cadence `lead_closed` with the
 * existing guarded pair, then close the lead through `closeLeadInTx` ON THIS
 * SAME HANDLE — dispatch already holds the claim transaction, and a second
 * connection would wait on the row lock this one holds (see
 * src/core/leads/close.ts). The cadence is already stopped, so the core finds
 * no live cadence and only closes the lead: `quote_cadence_wins` when a quote
 * cadence is live, otherwise `expired`; a lead that is already closed stays
 * exactly as it was (the guard on `status = 'open'`).
 */
async function refuseUnchaseableLead(
  tx: TenantScopedRepository,
  touch: ClaimedTouch,
  now: Date,
): Promise<TouchOutcome | null> {
  const [lead] = touch.leadId === null ? [] : await tx.leads.byId(touch.leadId);
  const quoteLive =
    touch.contactMobile === null
      ? []
      : await tx.cadences.liveQuoteCadenceForMobile(touch.contactMobile);
  const firstSent = (await tx.ledger.listForCadence(touch.cadenceId)).some(
    (row) => row.touchNumber === 1 && row.outcome === 'sent',
  );

  if (lead?.status === 'open' && quoteLive.length === 0 && firstSent) return null;

  await tx.touches.skipWhere([touch.id], 'cadence_stopped');
  const stopped = await tx.cadences.stopWhereLive([touch.cadenceId], 'lead_closed');
  if (stopped.length > 0) {
    await tx.touches.skipUnsentForCadences([touch.cadenceId], 'cadence_stopped');
  }
  if (lead) {
    await closeLeadInTx(tx, lead.id, quoteLive.length > 0 ? 'quote_cadence_wins' : 'expired', now);
  }

  return { kind: 'refused', reason: 'lead_closed' };
}

/**
 * CAD-05 (a) for a QUOTE touch — the Phase 3–12 branch, unchanged in
 * behaviour: re-read the mirror, and stop the cadence with the honest reason
 * when the quote is no longer chaseable. Returns `null` when it is.
 */
async function refuseUnchaseableQuote(
  tx: TenantScopedRepository,
  touch: ClaimedTouch,
): Promise<TouchOutcome | null> {
  // CAD-05 (a): is this still a quote we may chase? Re-read, not remembered.
  //
  // A quote row's job uuid is NOT NULL by the kind-identity CHECK; were it ever
  // NULL, "no mirror row" is exactly the right reading, so it takes the
  // `mirror_missing` arm below rather than a read keyed on nothing.
  const [quote] = touch.sm8JobUuid === null ? [] : await tx.quotes.stateFor([touch.sm8JobUuid]);
  const chaseable =
    quote !== undefined &&
    quote.status === 'Quote' &&
    quote.sm8Active &&
    quote.chaseEligibility === 'eligible';

  if (!chaseable) {
    // TWO CASES, AND THE MIRROR-IS-GONE ONE IS NEITHER "the quote closed" NOR
    // "the job was removed" (G-3-5, user decision at UAT test 5).
    //
    // `quote === undefined` means the mirrored row is not there at all. Writing
    // `quote_closed` for it would be a false statement — the quote did not
    // close, it ceased to exist in our mirror — and the cadence used to be left
    // LIVE, so every subsequent tick claimed the next touch and wrote another
    // false `quote_closed`, one per tick, until the completion sweep closed the
    // cadence as `all_touches_done`. Phase 7 then read a cadence that "ran its
    // course" with five skips, not one of them true.
    //
    // The first fix wrote `removed` here, arguing that "the job is not in our
    // mirror any more" is the same fact `stopReasonForQuote` reports for
    // `!sm8Active`, arriving with less evidence. UAT overruled that: LESS
    // EVIDENCE IS EXACTLY WHY IT MUST BE A DIFFERENT WORD. `removed` is now
    // reserved for the two paths where ServiceM8 TOLD us the job is gone — the
    // outbox `removed` event, and `sm8_active = false` read off a row we still
    // hold (`stopReasonForQuote`, untouched below). `mirror_missing` says our
    // mirror has no row and we cannot know why: a purge, a bug in our own sync,
    // or a deletion we never observed. Phase 7 attributes revenue on this
    // column and cannot reconstruct the distinction later.
    //
    // The refusal reported to the caller SPLITS HERE TOO (WR-01). It used to
    // stay `quote_closed` on the argument that the refusal vocabulary describes
    // this TICK's decision rather than the durable reason — but that argument
    // works just as well for a `mirror_missing` member, and collapsing the two
    // costs the operator the only near-real-time signal they have. See
    // DISPATCH_REFUSALS.
    await tx.touches.skipWhere([touch.id], quote ? 'quote_closed' : 'cadence_stopped');

    // The writes are one transaction: a stopped cadence whose touches are still
    // scheduled is the state that makes a killed cadence keep sending.
    const stopReason: CadenceStopReason = quote ? stopReasonForQuote(quote) : 'mirror_missing';
    const cadences = await tx.cadences.stopWhereLive([touch.cadenceId], stopReason);
    if (cadences.length > 0) {
      await tx.touches.skipUnsentForCadences([touch.cadenceId], 'cadence_stopped');
    }

    if (!quote) {
      // LOUD, in the style the `no_address` branch below already uses: ids only,
      // never customer data, because a driver/log line is not a place a
      // customer's phone number belongs.
      //
      // This branch permanently stops a paying client's quote chase, and
      // `stopWhereLive` writes `status = 'stopped'` while the only resume path
      // (`resumeWherePaused`) matches `status = 'paused'` — so it is
      // unrecoverable even after the mirror row comes back. An irreversible
      // outcome whose documented causes include "a bug in our own sync" must not
      // also be silent: that combination is how one small sync defect becomes a
      // whole client's quotes quietly going unchased.
      console.error(
        `[cadence] cadence ${touch.cadenceId} references sm8 job ${touch.sm8JobUuid}, ` +
          'which has no row in our quotes mirror. The cadence is STOPPED as ' +
          'mirror_missing and cannot be resumed — this is a purge, a deletion we ' +
          'never observed, or a bug in our own sync, and it needs a human.',
      );
    }

    return { kind: 'refused', reason: quote ? 'quote_closed' : 'mirror_missing' };
  }

  return null;
}

/**
 * The SHARED tail for a chaseable touch of either kind: address, suppression,
 * contact window, approved bytes, ledger claim, markSent. Returns the send to
 * perform after the commit, or the named rule that refused it.
 */
async function claimAndCommit(
  tx: TenantScopedRepository,
  touch: ClaimedTouch,
  tenant: CadenceTickTenant,
  context: { sender: TouchSender; insideWindow: boolean },
): Promise<TouchOutcome> {
  const address = addressFor(touch);
  if (!address) {
    // Unreachable by construction: a cadence is created stopped when no usable
    // address exists, and materialization picks the channel the contact can
    // actually be reached on. Reached anyway, this is a corrupted row.
    //
    // RETIRED UNDER ITS OWN NAME, NOT A BORROWED ONE. Every member of
    // TOUCH_SKIP_REASONS is a rule that decided something and Phase 7 reads them
    // as evidence, so `quote_closed` or `suppressed` here would be a false
    // statement written to make a loop terminate. Leaving the touch live was the
    // wrong way out of that: it stays `approved` with its slot in the past, so
    // every tick re-claims it — one of this tenant's 50 claim slots, and one
    // identical log line, once a minute for the six weeks until D-12 expires the
    // cadence, with `claimDue`'s `ORDER BY scheduled_at` putting this row ahead
    // of every sendable touch behind it. `no_address` is a member of the
    // vocabulary (migration 0018) precisely so this can be recorded honestly and
    // still terminate.
    await tx.touches.skipWhere([touch.id], 'no_address');
    console.error(
      `[cadence] touch ${touch.id} is channel '${touch.channel}' on cadence ` +
        `${touch.cadenceId}, which has no address on that channel. Nothing sent; ` +
        'the touch is retired as no_address.',
    );
    return { kind: 'refused', reason: 'no_address' };
  }

  // CAD-05 (b): D-15, re-checked at the last possible moment. The enqueue→
  // suppress→refuse case is the whole reason this check is here and not only at
  // creation: a touch approved yesterday for a customer who texted STOP this
  // morning must not go out.
  const suppressed = await tx.suppression.existsFor([
    { channel: touch.channel as TouchChannel, address },
  ]);

  if (suppressed.length > 0) {
    await tx.touches.skipWhere([touch.id], 'suppressed');
    const cadences = await tx.cadences.stopWhereLive([touch.cadenceId], 'contact_suppressed');
    if (cadences.length > 0) {
      await tx.touches.skipUnsentForCadences([touch.cadenceId], 'cadence_stopped');
    }
    return { kind: 'refused', reason: 'suppressed' };
  }

  // CAD-05 (c): DNCR contact-hours discipline. Silent refusal that LEAVES THE
  // TOUCH ALONE — the re-window pass (`rewindowTouch`, run earlier in this same
  // tick) is the only writer of a new `scheduled_at`, and skipping the touch
  // here would apply D-11's staleness verdict from a module that was never
  // given that decision.
  if (!context.insideWindow) return { kind: 'refused', reason: 'outside_window' };

  // CAD-05 (d): THE BYTES. Resolved BEFORE the claim, deliberately.
  //
  // A claim is a durable record that we took responsibility for sending this
  // touch, and `markSent` follows it in the same transaction. Discovering after
  // the claim that there is nothing to send would leave a ledger row and a
  // `sent` touch for a message that never existed — so the question is asked
  // while refusing is still free.
  //
  // The STORED `final_body` column, never a recomposition: the approver read
  // these exact bytes and this is what goes out (research Pitfall 6).
  const approvedBody = await tx.drafts.approvedFinalBody(touch.id);
  if (approvedBody === null) {
    console.error(
      `[cadence] touch ${touch.id} is approved with no approved draft row. ` +
        'Nothing sent; the touch is left for investigation.',
    );
    return { kind: 'refused', reason: 'no_approved_draft' };
  }

  // THE CLAIM.
  const [ledger] = await tx.ledger.insertClaim({
    cadenceId: touch.cadenceId,
    // EXACTLY ONE OWNER (`send_ledger_one_owner`): a quote touch carries its
    // quote and no lead; a lead touch carries its lead and no quote.
    quoteId: touch.quoteId,
    leadId: touch.leadId,
    touchNumber: touch.touchNumber,
    channel: touch.channel,
    // The normalized address AS IT STOOD AT CLAIM TIME — evidence of who was
    // actually messaged, stored rather than joined to a mirror that re-syncs.
    toAddress: address,
    // THE DELEGATE'S NAME, NOT THE COMPOSITE'S. See `ChannelAwareTouchSender`:
    // this column is what Phase 7 excludes stub rows by, and it is written here,
    // before the send, so it has to be resolved from the same routing rule the
    // send will use rather than from whatever object dispatch happens to hold.
    sender: claimedProviderFor(context.sender, touch.channel as TouchChannel),
  });

  // ZERO ROWS IS THE OTHER SIDE OF THE RACE, and it is a clean answer rather
  // than an error: a concurrent tick, a second deployment or a cron that fired
  // twice already owns this touch. Refuse silently and leave it alone — the
  // winner has already marked it sent.
  if (!ledger) return { kind: 'refused', reason: 'claim_lost' };

  await tx.touches.markSent([touch.id]);

  return {
    kind: 'send',
    send: {
      tenantId: tenant.tenantId,
      ledgerId: ledger.id,
      request: {
        ledgerId: ledger.id,
        tenantId: tenant.tenantId,
        // Exactly one is set (Phase 13): a quote touch's quote, or a lead
        // touch's lead — the same pair the ledger row above records.
        quoteId: touch.quoteId,
        leadId: touch.leadId,
        cadenceId: touch.cadenceId,
        touchNumber: touch.touchNumber,
        channel: touch.channel as TouchChannel,
        to: { address, contactName: touch.contactName },
        // THE APPROVED DRAFT'S EXACT BYTES. Dispatch composes nothing.
        //
        // Phase 3 built this string here from `stubTouchBody`, and the compliance
        // suffix (MSG-04 / Spam Act) came with it. Both moved to DRAFT TIME in
        // Phase 5: `draftTouches` appends `complianceSuffix(businessName)`
        // mechanically and freezes the result in `touch_drafts.final_body`, which
        // is the column a human then approved. Recomposing any part of it here
        // would mean the customer receives text that differs from what was
        // approved — by a renamed business, or by a changed suffix function.
        body: approvedBody,
      },
    },
  };
}

/**
 * Send everything the claim transactions committed to, and record what happened.
 *
 * A SEND THAT THROWS DOES NOT ABORT THE REST. The interface says a sender
 * returns a union rather than throwing, but Phase 4 puts a real HTTP client
 * behind it and an unhandled rejection there would strand every remaining
 * claimed touch with a null outcome. The ledger row already exists either way;
 * leaving `outcome` NULL is the honest record of "we do not know".
 */
async function performSends(pending: readonly PendingSend[], sender: TouchSender): Promise<void> {
  for (const send of pending) {
    let outcome: SendOutcome | null = null;
    try {
      outcome = await sender.send(send.request);
    } catch {
      // Deliberately NOT logging the caught value: a throw from a provider
      // client can carry the request, and the request carries a customer's
      // mobile number (the T-2-02 rule, applied to the other boundary).
      console.error(
        `[cadence] sender '${sender.provider}' threw for ledger ${send.ledgerId}; ` +
          'outcome left NULL — surfaced to the operator, never auto-resent.',
      );
    }

    if (!outcome) continue;

    // 'stub_sent' keeps Phase 3's rows structurally distinguishable from real
    // sends FOREVER (D-13). Phase 7 must be able to exclude them from
    // attribution years from now, against rows written today.
    const recorded: SendLedgerOutcome =
      outcome.kind === 'failed' ? 'failed' : outcome.provider === 'stub' ? 'stub_sent' : 'sent';

    try {
      await forTenant(send.tenantId).ledger.setOutcome(
        send.ledgerId,
        recorded,
        outcome.kind === 'sent' ? outcome.providerMessageId : null,
      );
    } catch {
      // THE MESSAGE HAS GONE OUT. Leaving `outcome` NULL is the honest record
      // of that — we know the provider took it and we failed to write down what
      // it said. Losing the sends BEHIND it is not honest, it is just loss:
      // every remaining touch here was already marked `sent` and its ledger row
      // already claimed inside a COMMITTED transaction, so an unguarded throw
      // strands them at NULL forever and the at-most-once rule (see the header)
      // means nothing ever picks them back up.
      //
      // Nothing is retried, deliberately. A retry after a send the provider
      // accepted is how a customer gets messaged twice.
      //
      // Deliberately NOT logging the caught value: a driver error can carry the
      // statement, and this statement's parameters include the outcome of a send
      // to a customer's address (the T-2-02 rule the catch above follows).
      console.error(
        `[cadence] could not record the outcome for ledger ${send.ledgerId}; ` +
          'the send happened and the row is left NULL — surfaced, never auto-resent.',
      );
    }
  }
}

/**
 * Every tenant's due touches, once.
 *
 * PER-TENANT ISOLATION IS THE POINT (the same rule `runSyncTick` follows): each
 * tenant's claim runs in its own transaction and its own try/catch, so one
 * client's broken configuration cannot stop the other fourteen from being
 * followed up.
 *
 * THE GUARD COVERS THE SEND PASS TOO, NOT JUST THE CLAIM. It did not, and the
 * invariant above was therefore false for anything `performSends` could throw:
 * `performSends` was awaited outside the try/catch, so one transient driver
 * error on one tenant's ledger write took out every REMAINING tenant in the
 * tick as well as the rest of that tenant's own sends. Two guards, because the
 * two losses are different: the per-send one inside `performSends` bounds the
 * damage to a single NULL outcome, and this one bounds it to a single client's
 * pass.
 */
export async function dispatchDueTouches(options: DispatchOptions): Promise<DispatchResult> {
  const result: DispatchResult = { dispatched: 0, refused: 0, refusals: noRefusals() };

  for (const tenant of await forAllTenants_cadenceTick()) {
    // The cheap pre-filter. The authoritative check is the re-read inside the
    // claim transaction — this one only avoids opening a transaction for a
    // client we already know we may not message.
    if (tenant.connectionPausedAt !== null || tenant.settingsPausedAt !== null) continue;

    let claim;
    try {
      claim = await claimForTenant(tenant, options);
    } catch {
      // Not logging the caught value: a driver error can carry the statement,
      // and this statement's parameters include a customer's address.
      console.error(`[cadence] dispatch failed for tenant ${tenant.tenantId}; nothing sent.`);
      continue;
    }

    for (const reason of DISPATCH_REFUSALS) {
      result.refusals[reason] += claim.refusals[reason];
      result.refused += claim.refusals[reason];
    }
    result.dispatched += claim.pending.length;

    try {
      await performSends(claim.pending, options.sender);
    } catch {
      // Same rule as the claim guard directly above, and not logging the caught
      // value for the same reason: this pass holds a customer's address and a
      // driver error can quote the statement that carried it.
      console.error(`[cadence] send pass failed for tenant ${tenant.tenantId}; continuing.`);
    }
  }

  return result;
}
