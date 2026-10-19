/**
 * What happens when a customer writes back (MSG-03, MSG-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY INBOUND IS RECORDED. NOTHING IS EVER DROPPED FOR BEING             │
 * │ UNRECOGNISABLE — THAT IS THE CASE THAT MOST NEEDS A HUMAN.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 04-01 proved the spine: a customer with exactly ONE live cadence texting
 * "STOP" ends up, in one call, with both their mobile AND their email
 * suppressed, their cadence stopped, their unsent touches skipped, and a row
 * recording all of it — the suppression written in EXACTLY the spelling
 * `dispatch.ts` probes, so the next tick refuses them. 04-02 made every OTHER
 * branch real. There are no record-only paths left.
 *
 * ── THE WHOLE DECISION TABLE, BECAUSE THE EDGES ARE THE PRODUCT ─────────────
 *
 *              │ STOP                              │ ordinary reply
 *  ────────────┼───────────────────────────────────┼──────────────────────────
 *  1 candidate │ suppress both channels, stop the  │ PAUSE the cadence
 *              │ cadence, skip its touches         │ (D-05), record threaded
 *  ────────────┼───────────────────────────────────┼──────────────────────────
 *  ≥2          │ suppress + stop for ALL of them   │ PAUSE NOTHING. One
 *              │ (D-03), one `ambiguous` row       │ `ambiguous` row for
 *              │                                   │ triage (T-4-06) —
 *              │                                   │ EXCEPT one quote + its
 *              │                                   │ leads at ONE client:
 *              │                                   │ the quote wins (D-10)
 *  ────────────┼───────────────────────────────────┼──────────────────────────
 *  0           │ suppress the bare mobile for      │ one `unmatched` row
 *              │ EVERY client (D-03), one          │
 *              │ `unmatched` row                   │
 *  ────────────┼───────────────────────────────────┼──────────────────────────
 *  unnormali-  │ record only — there is no         │ record only
 *  zable       │ probe-able spelling to suppress   │
 *
 * ── THE TWO ASYMMETRIES, AND WHY THEY POINT OPPOSITE WAYS ───────────────────
 *
 * An AMBIGUOUS STOP acts on every candidate. An AMBIGUOUS REPLY acts on none.
 * That looks inconsistent and is the opposite: both choose the outcome whose
 * failure mode is survivable.
 *
 *   • Suppressing two clients' contacts when only one of them was meant costs a
 *     client one follow-up they may not have needed to stop. NOT suppressing
 *     costs a human who asked to be left alone being chased anyway — a Spam Act
 *     breach and, per D-06, the exact thing this system's promise is about.
 *     "Suppressing is always safe, sending is not."
 *
 *   • PAUSING two clients' cadences on one reply is a lever anybody who can
 *     guess a phone number could pull: spoof a from-number that two cadences
 *     share and both stop chasing (T-4-06). A pause is not compliance, it is
 *     scheduling — so it needs a UNIQUE match, and an ambiguous reply goes to a
 *     human instead. The reply is recorded either way; nobody is ignored.
 *
 * ── ONE QUOTE AND A LEAD AT ONE CLIENT: THE QUOTE WINS (Phase 13, D-10) ─────
 *
 * A mobile can be on a quote cadence and a lead cadence at the same client —
 * a customer with a quote out who also rang and was missed. That is not an
 * ambiguity about WHO the reply is for; it is one person, one client, two
 * conversations, and the quote is the one with money attached. So when EVERY
 * candidate shares one `tenantId`, exactly one is a quote cadence and every
 * other is a lead cadence, each lead is closed `quote_cadence_wins` (its
 * cadence stopped `lead_closed`, ids logged) and the reply then threads to the
 * quote cadence exactly as a single match would. Every other many-match shape
 * — two tenants, two quotes, two leads — is still `ambiguous` and still
 * writes nothing but the row: the tie-break never reaches across tenants, so a
 * guessed number cannot close one client's lead by sharing it with another
 * client's quote. A STOP is not tie-broken: D-03 honours every candidate, and
 * the reconciling sweep closes the lead `opt_out` from its stopped cadence.
 *
 * ── A LEAD REPLY IS KEYWORD-SCANNED AT THE DOOR (Phase 13, D-06) ────────────
 *
 * After the STOP decision, and only for a reply threaded to a LEAD cadence,
 * `isUrgentKeyword` marks the row `keyword_hot` on insert — so a burst pipe is
 * hot before any model has read it. The door writes `keyword_hot` and never
 * `is_hot`, whose single writer is the classifier. A quote reply is never
 * scanned, and a STOP body never reaches the rule.
 *
 * ── ORDER INDEPENDENCE IS BY CONSTRUCTION, NOT BY SORTING ───────────────────
 *
 * `forAllTenants_cadencesByContactMobile` returns a deterministic order so
 * tests can assert a sequence, and this file reads NO meaning into it. The
 * multi-candidate STOP path iterates EVERY candidate with no early return, so
 * the end state cannot depend on which one came back first. A `.find()` or a
 * `[0]` anywhere in that branch would silently make an arbitrary client's
 * customer the one who gets suppressed.
 *
 * ── THE ORDER OF THE TWO WRITES IS A DECISION (T-4-01) ──────────────────────
 *
 * The compliance write — suppression, stop, or pause — is performed BEFORE the
 * evidence row, never the other way round. If the row write fails, we are left
 * having honoured a STOP without recording it: recoverable, because the provider
 * retries and every write here is idempotent, so the replay lands the row. The
 * reverse ordering fails the other way: a row that says `is_stop: true,
 * attribution: 'threaded'` sitting beside a customer who is still being chased,
 * which reads to every later human as "handled".
 *
 * ── NOTHING HERE LOGS A NUMBER OR A BODY (T-4-02, T-4-08) ───────────────────
 *
 * T-2-02's rule, applied at the new boundary: `from`, `body` and every address
 * are stored in `inbound_messages` behind RLS and appear in NO console line.
 * Ids and counts only. A platform log is readable by anyone with project access,
 * forever, and cannot be redacted per customer. `tests/inbound-threading.test.ts`
 * asserts this against the source rather than trusting the reviewer.
 *
 * ── NOTHING HERE SENDS, APPROVES OR RESUMES ANYTHING ────────────────────────
 *
 * The effects available to an inbound payload are exactly: suppress, stop,
 * pause, upgrade, record. That closure is what makes a FORGED stop tolerable at
 * an unsigned webhook boundary (T-4-05) — its worst outcome is a cadence that
 * stops — and it is why route authentication is 04-02's route file's concern
 * and not a reason for this function to be defensive about who called it.
 *
 * FRAMEWORK-FREE. Nothing here imports from `next/*`, and nothing here
 * authorizes. It also holds NO tenant-scoped write surface of its own: every
 * suppression and every cadence move goes through `controls.ts`.
 */
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import {
  pauseForReply,
  suppressBareContact,
  suppressFromInbound,
  type PauseForReplyResult,
} from '@/core/cadence/controls';
import { sendOperatorAlert } from '@/core/alerts/operator-email';
import { closeLead } from '@/core/leads/close';
import { handleTradieDone, isDoneKeyword } from '@/core/leads/done-keyword';
import { isUrgentKeyword } from '@/core/leads/urgency-keywords';
import {
  forAllTenants_cadencesByContactMobile,
  forAllTenants_ids,
  insertInboundMessage,
  type CadenceByContactMobile,
} from '@/db/repository';

import { isStopMessage } from './stop-keywords';

/** One inbound SMS, as the provider adapter hands it over. */
export interface InboundSmsInput {
  /** RAW, exactly as received. Normalized once, below, and never re-normalized. */
  from: string;
  /** Which of our numbers it arrived on, when the provider tells us. */
  to: string | null;
  body: string;
  providerMessageId: string | null;
}

/**
 * What this call did. A CLOSED UNION, and every arm carries `inboundId` because
 * every arm wrote a row — that is the guarantee this function exists to make.
 *
 * The `stop_*` / `reply_*` split is deliberately by BOTH axes (was it an
 * opt-out, and did we place it) rather than by outcome, because the two answers
 * have independent consequences: an unmatched STOP is a compliance event, an
 * unmatched reply is an ordinary wrong number, and a caller that cannot tell
 * them apart cannot count either.
 */
export type InboundSmsResult =
  | {
      /** One candidate: suppressed, stopped, skipped, recorded. */
      kind: 'stop_threaded';
      inboundId: string;
      tenantId: string;
      cadenceId: string;
      addressesSuppressed: number;
      touchesSkipped: number;
      /**
       * False when the cadence had already left live state between the lookup
       * and the transaction. THE SUPPRESSION STILL HAPPENED — see `killContact`
       * on why that write is unconditional — so this reports the split rather
       * than pretending either half did not occur.
       */
      cadenceStopped: boolean;
    }
  | {
      /**
       * Matched, and the suppression did NOT happen. Unreachable by
       * construction: we matched ON the snapshot mobile, so there is an address
       * to write. Named anyway, because the alternative to a name is silence.
       */
      kind: 'stop_not_suppressed';
      inboundId: string;
      tenantId: string;
      cadenceId: string;
      reason: 'no_cadence' | 'no_addresses' | 'number_retired';
    }
  | {
      /**
       * An opt-out we could not place — suppressed everywhere it could apply
       * (D-03) and recorded for triage. `tenantsSuppressed` is the breadth of
       * the fan-out, which is the number an operator wants when they ask why a
       * client they have never heard of is suppressing this number.
       */
      kind: 'stop_unmatched';
      inboundId: string;
      tenantsSuppressed: number;
    }
  | {
      /**
       * An opt-out matching two or more live cadences. ALL of them honoured —
       * see the header on why this and `reply_ambiguous` point opposite ways.
       */
      kind: 'stop_ambiguous';
      inboundId: string;
      candidateCount: number;
      tenantsSuppressed: number;
      cadencesStopped: number;
      addressesSuppressed: number;
    }
  | {
      /** An ordinary reply to exactly one live cadence: the cadence is paused. */
      kind: 'reply_threaded';
      inboundId: string;
      tenantId: string;
      cadenceId: string;
      /**
       * What `pauseForReply` did — `paused`, `upgraded`, `not_active` or
       * `no_cadence`. Carried rather than collapsed to a boolean because
       * `upgraded` is the D-05 near-miss (a client had paused their own
       * messaging and their customer wrote back anyway) and `not_active` means
       * the cadence went terminal between the lookup and the write. Those are
       * different things for an operator to see.
       */
      pause: PauseForReplyResult['kind'];
    }
  | { kind: 'reply_unmatched'; inboundId: string }
  /** Two or more live cadences. NOTHING is paused — T-4-06, see the header. */
  | { kind: 'reply_ambiguous'; inboundId: string; candidateCount: number }
  /** The sender is not a number we can match on — a landline, a short code. */
  | { kind: 'unnormalizable'; inboundId: string }
  /**
   * Phase 14 (D-08): a DONE from one of a client's own numbers closed the lead
   * whose escalation was most recently sent to that number. The row carries
   * the tenant and is recorded pre-triaged; nobody is texted back.
   * `already_closed` is the tradie's word arriving after the lead had closed —
   * honoured silently.
   */
  | {
      kind: 'done_closed';
      inboundId: string;
      tenantId: string;
      leadId: string;
      close: 'closed' | 'already_closed';
    }
  /**
   * Phase 14 (D-08): a DONE from one of a client's own numbers with no lead
   * escalated to it inside the lookback. Nothing closed; the row is untriaged
   * (it waits in the inbox) and one operator email names the client.
   */
  | { kind: 'done_no_lead'; inboundId: string; tenantId: string };

/** What every arm below writes to `inbound_messages`, minus its verdict. */
type InboundBase = Omit<
  Parameters<typeof insertInboundMessage>[0],
  'attribution' | 'matchedCadenceCount'
>;

/**
 * Record an inbound SMS, and honour it.
 *
 * NEVER THROWS FOR AN ORDINARY OUTCOME, the `controls.ts` convention: "no such
 * cadence", "two candidates" and "not a mobile" are all normal things for a
 * webhook to be handed. A throw here becomes a non-2xx at the route, which
 * ClickSend retries for 72 hours and then abandons — so an exception must mean
 * the database is unreachable, not that a customer sent something surprising.
 */
export async function handleInboundSms(
  input: InboundSmsInput,
  options: {
    /** Phase 14: the DONE branch's clock. Defaults to now; pinned in tests. */
    now?: Date;
    /** Phase 14: the done_no_lead email. Defaults to `sendOperatorAlert`. */
    alert?: typeof sendOperatorAlert;
  } = {},
): Promise<InboundSmsResult> {
  // THE STOP DECISION IS MADE FIRST, BEFORE ANY LOOKUP (MSG-03). It is a
  // deterministic regex over the body and it depends on nothing else — no
  // tenant, no cadence, no network. Deciding it here means no branch below can
  // reach a state where whether this was an opt-out depends on what we found.
  const isStop = isStopMessage(input.body);

  // THE ONE NORMALIZER, and the one call to it. `cadences.contact_mobile` was
  // written by this same function at cadence creation, so this is what makes
  // `0412 345 678` and `+61412345678` one lookup key (MSG-04).
  const normalizedFrom = normalizeAuMobile(input.from);

  const base: InboundBase = {
    channel: 'sms',
    fromAddress: input.from,
    normalizedFrom,
    toAddress: input.to,
    body: input.body,
    providerMessageId: input.providerMessageId,
    isStop,
  };

  if (normalizedFrom === null) {
    // Not a mobile we can match on. Recorded rather than refused: the raw
    // `from_address` is the only thing an operator has to work with, and a
    // dropped message is one they never learn existed.
    //
    // NO SUPPRESSION, EVEN FOR A STOP, and this is a limit rather than a
    // choice. Suppression works by storing the exact spelling `dispatch.ts`
    // probes with, and the normalizer just said there is no such spelling for
    // this sender. A row stored under the raw string would look like compliance
    // in the console and match no probe ever — worse than the honest gap,
    // because it would stop anyone looking for it.
    const { id } = await insertInboundMessage({
      ...base,
      attribution: 'unmatched',
      matchedCadenceCount: 0,
    });
    console.warn(
      `[messaging] inbound ${id} could not be normalized to an AU mobile; ` +
        `recorded unmatched (is_stop=${isStop}). No suppression is possible ` +
        'without a normalized address; this one needs a human.',
    );
    return { kind: 'unnormalizable', inboundId: id };
  }

  const candidates = await forAllTenants_cadencesByContactMobile(normalizedFrom);

  // ── D-08: THE TRADIE'S DONE, AFTER STOP, BEFORE ANY THREADING (Phase 14) ─
  //
  // After the STOP decision, so a STOP from an own number is still a STOP and
  // DONE is never consulted for it. ONLY WHEN NO LIVE CADENCE ANSWERS THIS
  // NUMBER (14-REVIEW WR-05): "a client's own number never carries a cadence"
  // holds per tenant only — a tradie who is ANOTHER client's customer texts
  // "all done, thanks" to that client's cadence, and the reply must thread and
  // pause there, not close his own lead. With a candidate the branch is never
  // taken and the reply threads exactly as before. The decision is
  // deterministic and the classifier never sees it (its read is
  // privilege-pinned). Nothing on this branch texts anybody.
  if (!isStop && candidates.length === 0 && isDoneKeyword(input.body)) {
    const done = await handleTradieDone(base, normalizedFrom, options.now ?? new Date(), {
      alert: options.alert ?? sendOperatorAlert,
    });
    if (done !== null) return done;
  }

  if (candidates.length === 1) return handleSingleMatch(base, candidates[0], isStop);
  if (candidates.length === 0) return handleNoMatch(base, normalizedFrom, isStop);
  return handleManyMatches(base, candidates, isStop);
}

/* ------------------------------------------------------------------------- *
 * Exactly one candidate — the only branch that can pause
 * ------------------------------------------------------------------------- */

async function handleSingleMatch(
  base: InboundBase,
  candidate: CadenceByContactMobile,
  isStop: boolean,
): Promise<InboundSmsResult> {
  const threaded = {
    ...base,
    tenantId: candidate.tenantId,
    cadenceId: candidate.cadenceId,
    quoteId: candidate.quoteId,
    // Phase 12: a reply to a text-back threads to a LEAD cadence, which has no
    // quote; its lead is denormalized beside it the way a quote is.
    leadId: candidate.leadId,
    attribution: 'threaded',
    matchedCadenceCount: 1,
  };

  if (!isStop) {
    // ── D-05: THE MACHINE STANDS DOWN ────────────────────────────────────────
    //
    // Before the evidence row, on the same rule as the suppression below: a
    // failed row write is recovered by the provider's retry (the pause is
    // idempotent), whereas a row claiming `threaded` beside a cadence still
    // texting reads to every later human as handled.
    const pause = await pauseForReply(candidate.tenantId, candidate.cadenceId);

    // ── D-06: THE KEYWORD RULE, AFTER STOP, LEAD REPLIES ONLY ──────────────
    //
    // This branch is the non-STOP one, so a STOP body never reaches the rule.
    // A quote reply is never scanned (its vocabulary has no urgency), and the
    // door writes `keyword_hot` only — `is_hot` stays the classifier's.
    const keywordHot = candidate.leadId !== null && isUrgentKeyword(base.body ?? '');
    const { id } = await insertInboundMessage({ ...threaded, keywordHot });

    console.log(
      `[messaging] inbound ${id}: reply threaded to cadence ${candidate.cadenceId} ` +
        `(tenant ${candidate.tenantId}); pause result '${pause.kind}'.`,
    );

    return {
      kind: 'reply_threaded',
      inboundId: id,
      tenantId: candidate.tenantId,
      cadenceId: candidate.cadenceId,
      pause: pause.kind,
    };
  }

  // ── THE COMPLIANCE WRITE, BEFORE THE EVIDENCE WRITE (see the header) ──────
  //
  // Through `suppressFromInbound` and never an inline UPDATE: that function owns
  // the four decisions a copy would have to re-derive — the suppression is
  // unconditional even at a terminal cadence, BOTH channels are written, the
  // addresses are the snapshot VERBATIM (so dispatch's probe finds them), and
  // the touch skip commits with the stop.
  const outcome = await suppressFromInbound(
    candidate.tenantId,
    candidate.cadenceId,
    'sms_stop',
  );

  if (
    outcome.kind === 'no_cadence' ||
    outcome.kind === 'no_addresses' ||
    outcome.kind === 'number_retired'
  ) {
    const { id } = await insertInboundMessage(threaded);
    console.error(
      `[messaging] inbound ${id} matched cadence ${candidate.cadenceId} but ` +
        `suppression reported '${outcome.kind}'. No suppression written.`,
    );
    return {
      kind: 'stop_not_suppressed',
      inboundId: id,
      tenantId: candidate.tenantId,
      cadenceId: candidate.cadenceId,
      reason: outcome.kind,
    };
  }

  const { id } = await insertInboundMessage(threaded);

  console.log(
    `[messaging] inbound ${id}: STOP threaded to cadence ${candidate.cadenceId} ` +
      `(tenant ${candidate.tenantId}); ${outcome.addressesSuppressed} addresses ` +
      `suppressed, cadence ${outcome.kind === 'killed' ? 'stopped' : 'already terminal'}.`,
  );

  return {
    kind: 'stop_threaded',
    inboundId: id,
    tenantId: candidate.tenantId,
    cadenceId: candidate.cadenceId,
    addressesSuppressed: outcome.addressesSuppressed,
    touchesSkipped: outcome.kind === 'killed' ? outcome.touchesSkipped : 0,
    cadenceStopped: outcome.kind === 'killed',
  };
}

/* ------------------------------------------------------------------------- *
 * No candidate — the branch 04-01 named as a compliance gap
 * ------------------------------------------------------------------------- */

async function handleNoMatch(
  base: InboundBase,
  normalizedFrom: string,
  isStop: boolean,
): Promise<InboundSmsResult> {
  if (!isStop) {
    // An ordinary reply to nothing: a wrong number, a stale thread, a customer
    // answering a message from a cadence that finished. Recorded and left.
    const { id } = await insertInboundMessage({
      ...base,
      attribution: 'unmatched',
      matchedCadenceCount: 0,
    });
    return { kind: 'reply_unmatched', inboundId: id };
  }

  // ── D-03: AN OPT-OUT IS NEVER DISCARDED FOR BEING UNTHREADABLE ────────────
  //
  // There is no cadence, so there is no snapshot to write both channels from —
  // only the mobile the message arrived from, in the one spelling every probe
  // uses. Suppressed for EVERY client, because there is no tenant in the
  // question: see `suppressBareContact` for the full argument.
  const tenantIds = await forAllTenants_ids();
  const suppression = await suppressBareContact(
    tenantIds,
    { channel: 'sms', address: normalizedFrom },
    'sms_stop',
  );

  const { id } = await insertInboundMessage({
    ...base,
    attribution: 'unmatched',
    matchedCadenceCount: 0,
  });

  // WARN, NOT ERROR. In 04-01 this was `console.error` because nothing was
  // done about it; now the opt-out is honoured, and the row is a triage item
  // rather than an incident. It stays above `log` because a STOP we could not
  // place is still worth an operator's eyes — the customer may be mid-quote
  // with a client whose cadence had already stopped.
  console.warn(
    `[messaging] inbound ${id}: OPT-OUT with no live cadence. Bare-mobile ` +
      `suppression applied for ${suppression.tenantsSuppressed} clients ` +
      `(${suppression.rowsWritten} new rows); recorded unmatched for triage.`,
  );

  return { kind: 'stop_unmatched', inboundId: id, tenantsSuppressed: suppression.tenantsSuppressed };
}

/* ------------------------------------------------------------------------- *
 * Two or more candidates — where the two asymmetries live
 * ------------------------------------------------------------------------- */

async function handleManyMatches(
  base: InboundBase,
  candidates: CadenceByContactMobile[],
  isStop: boolean,
): Promise<InboundSmsResult> {
  const ambiguous = {
    ...base,
    attribution: 'ambiguous',
    matchedCadenceCount: candidates.length,
    // The triage surface (04-06) renders these. Deduplicated because two live
    // cadences at ONE client is a different problem from one at each of two,
    // and an operator reading a repeated id would have to count to tell.
    candidateTenantIds: [...new Set(candidates.map((candidate) => candidate.tenantId))],
  };

  if (!isStop) {
    // ── D-10: ONE QUOTE AND ITS LEADS AT ONE CLIENT — THE QUOTE WINS ────────
    //
    // See the header. The leads are closed FIRST, before the reply is
    // threaded, on the same rule as every other state write here: if the row
    // write then fails, the provider's retry finds only the quote cadence live
    // and lands as an ordinary single match. `closeLead` is idempotent.
    const quoteWins = quoteWinsCandidate(candidates);
    if (quoteWins !== null) {
      const now = new Date();
      for (const candidate of candidates) {
        if (candidate.leadId === null) continue;
        const closed = await closeLead(
          candidate.tenantId,
          candidate.leadId,
          'quote_cadence_wins',
          now,
        );
        console.log(
          `[messaging] lead ${candidate.leadId} (cadence ${candidate.cadenceId}, ` +
            `tenant ${candidate.tenantId}) closed quote_cadence_wins: '${closed.kind}'.`,
        );
      }
      return handleSingleMatch(base, quoteWins, isStop);
    }

    // ── NOTHING IS PAUSED (T-4-06) ───────────────────────────────────────────
    //
    // A pause is scheduling, not compliance, and pausing on an ambiguous match
    // hands anyone who can guess a phone number a lever that stops two clients'
    // chases at once. The reply is recorded with both candidates named; a human
    // decides which conversation it belongs to.
    const { id } = await insertInboundMessage(ambiguous);
    console.warn(
      `[messaging] inbound ${id} matched ${candidates.length} live cadences; ` +
        'recorded ambiguous, NO pause written. This needs a human.',
    );
    return { kind: 'reply_ambiguous', inboundId: id, candidateCount: candidates.length };
  }

  // ── D-03: EVERY CANDIDATE IS HONOURED ────────────────────────────────────
  //
  // Sequential over ALL candidates with no early return — see the header on
  // order independence. `suppressFromInbound` is idempotent per contact, so two
  // cadences at the same client cost one suppression pair and two stops.
  let addressesSuppressed = 0;
  let cadencesStopped = 0;
  const tenantsCovered = new Set<string>();

  for (const candidate of candidates) {
    const outcome = await suppressFromInbound(
      candidate.tenantId,
      candidate.cadenceId,
      'sms_stop',
    );

    if (outcome.kind === 'killed' || outcome.kind === 'already_stopped') {
      addressesSuppressed += outcome.addressesSuppressed;
      tenantsCovered.add(candidate.tenantId);
    }
    if (outcome.kind === 'killed') cadencesStopped += 1;
  }

  const { id } = await insertInboundMessage(ambiguous);

  console.warn(
    `[messaging] inbound ${id}: OPT-OUT matching ${candidates.length} live cadences ` +
      `across ${tenantsCovered.size} clients. All honoured (D-03): ` +
      `${addressesSuppressed} addresses suppressed, ${cadencesStopped} cadences ` +
      'stopped. Recorded ambiguous for triage.',
  );

  return {
    kind: 'stop_ambiguous',
    inboundId: id,
    candidateCount: candidates.length,
    tenantsSuppressed: tenantsCovered.size,
    cadencesStopped,
    addressesSuppressed,
  };
}

/**
 * The D-10 shape, or `null`: every candidate at ONE tenant, exactly one quote
 * cadence, and every other a lead cadence. Anything else — a second tenant, a
 * second quote, no quote at all — is a real ambiguity and stays one.
 */
function quoteWinsCandidate(
  candidates: readonly CadenceByContactMobile[],
): CadenceByContactMobile | null {
  const tenantIds = new Set(candidates.map((candidate) => candidate.tenantId));
  if (tenantIds.size !== 1) return null;

  const quotes = candidates.filter((candidate) => candidate.quoteId !== null);
  if (quotes.length !== 1) return null;

  const othersAreLeads = candidates.every(
    (candidate) => candidate === quotes[0] || candidate.leadId !== null,
  );
  return othersAreLeads ? quotes[0] : null;
}
