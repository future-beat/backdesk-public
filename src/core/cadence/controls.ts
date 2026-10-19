/**
 * The D-16 control surface: every way a human stops a chase, as one module.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A KILL SWITCH IS ONLY A KILL SWITCH IF IT IS THE SAME SWITCH EVERYWHERE. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Five operations, and the console is not their only caller. Phase 4's inbound
 * classification calls `pauseForReply` when a customer writes back and will
 * write suppression through the same table `killContact` writes; Phase 5's
 * escalation paths reach `resumeCadence`. Every one of them is here, tested
 * against a real database, rather than expressed a second time as a server
 * action's inline transaction — because the second expression of "stop chasing
 * this person" is the one that gets a condition wrong, and the failure is a
 * message going out after somebody asked us to stop.
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*` and nothing here
 * authorizes. Every function takes a `tenantId` that its caller has already
 * proven the caller is entitled to, and scopes every read and write through
 * `forTenant(tenantId)`. WHAT THE CALLER MUST STILL DO: authorize. The server
 * actions in `app/(console)/clients/[id]/quotes/[quoteId]/actions.ts` run the
 * WR-01 membership read with the OPERATOR'S OWN JWT before calling any of these,
 * because these write through the service-role path and bypass RLS by design.
 *
 * ── RESULT UNIONS, NEVER THROWS ─────────────────────────────────────────────
 *
 * Every function returns a closed `kind` union the caller switches over. None of
 * these outcomes is exceptional: "the cadence was already stopped", "the client
 * was already paused", "there is no such cadence" are all ordinary answers to an
 * operator tapping a button on a page rendered eight seconds ago. A thrown error
 * for any of them would put a stack trace where a sentence belongs.
 *
 * ── THE STATE DECISIONS COME FROM THE MATRIX, NOT FROM THIS FILE ────────────
 *
 * Each status change below is what `cadenceTransition` prescribes, resolved once
 * at module load. The reasons are never restated as literals here: a stop reason
 * typed out in this file is a second answer to a question `transitions.ts`
 * already answers, and Phase 7 attributes recovered revenue on that column.
 *
 * ── D-06's TWO KILL SWITCHES ARE DELIBERATELY ASYMMETRIC ────────────────────
 *
 * `killContact` is TERMINAL and has no inverse anywhere in this codebase. There
 * is no un-suppress function here, no such method on the repository, and no
 * grant for it on `suppressed_contacts` — see that table's header for why the
 * irreversibility is enforced at three layers. `pauseClient` is REVERSIBLE, and
 * `resumeClient` is its inverse. The asymmetry is the product: a client changing
 * their mind about the service is a different fact from a human asking not to be
 * contacted, and only one of those is ours to reverse.
 */
// The gate's OWN readers, so the refusal and the gate cannot disagree about
// which condition is missing (D-14). No cycle: `onboarding-gate` imports
// `./resume`, which imports neither this module nor itself.
import {
  readOnboardingConditions,
  type OnboardingConditions,
} from '@/core/drafting/onboarding-gate';
import { isPseudonym } from '@/core/leads/pseudonym';
import {
  ONBOARDING_PAUSE_REASON,
  type Cadence,
  type CadencePauseReason,
  type CadenceStatus,
  type CadenceStopReason,
  type UpgradablePauseReason,
} from '@/db/schema/cadences';
import { type TouchSkipReason } from '@/db/schema/cadence-touches';
import { type SuppressionChannel } from '@/db/schema/suppressed-contacts';
import { forTenant, type SuppressionProbe } from '@/db/repository';

import { applyResumeRewindow } from './resume';
import { cadenceTransition, type CadenceEvent } from './transitions';

/* ------------------------------------------------------------------------- *
 * What the matrix prescribes — asked once, at module load
 * ------------------------------------------------------------------------- */

/**
 * The stop reason `event` produces at a live cadence.
 *
 * RESOLVED AT IMPORT, exactly as `consume-events.ts` resolves its four. A matrix
 * that ever stopped prescribing a stop for `contact_killed` would fail the
 * build, a deploy or a test run — rather than failing inside a transaction with
 * a customer who just asked to be left alone at the other end of it.
 */
function stopReasonFor(event: CadenceEvent): CadenceStopReason {
  const outcome = cadenceTransition({ status: 'active', pauseReason: null }, event);
  if (outcome.kind !== 'move' || outcome.stopReason === null) {
    throw new Error(
      `cadenceTransition prescribes no stop for '${event}'; the operator control ` +
        'surface cannot honour a kill safely and must not start.',
    );
  }
  return outcome.stopReason;
}

/**
 * The pause reason `event` produces at an active cadence.
 *
 * NARROWED TO `UpgradablePauseReason`, because both constants below are used as
 * upgrade TARGETS as well as as pause reasons. `onboarding` is not reachable
 * from an active cadence by any event — the gate is entered at creation, never
 * by something happening — so the extra arm is an assertion of that, not a case
 * with a plausible caller. It throws at module load beside its two siblings: a
 * matrix that started prescribing the downgrade must stop the build, not produce
 * one relabelled cadence per reply.
 */
function pauseReasonFor(event: CadenceEvent): UpgradablePauseReason {
  const outcome = cadenceTransition({ status: 'active', pauseReason: null }, event);
  if (
    outcome.kind !== 'move' ||
    outcome.pauseReason === null ||
    outcome.pauseReason === ONBOARDING_PAUSE_REASON
  ) {
    throw new Error(
      `cadenceTransition prescribes no pause for '${event}' that this surface may ` +
        'land; the operator control surface cannot pause safely and must not start.',
    );
  }
  return outcome.pauseReason;
}

const KILL_STOP_REASON = stopReasonFor('contact_killed');
const CLIENT_PAUSE_REASON = pauseReasonFor('client_paused');
const REPLY_PAUSE_REASON = pauseReasonFor('customer_reply');

/**
 * WHICH ALREADY-PAUSED CADENCES A CLIENT PAUSE UPGRADES, asked of the matrix.
 *
 * Returns the reason the upgrade should land, or `null` when the matrix says
 * this pause is left alone. Not a literal list, and not a `=== 'onboarding'`
 * check: `transitions.ts` note 7 owns the stickiness order, and a second copy of
 * it here would drift the first time a fourth reason is added — in the direction
 * where a client's handbrake silently stops covering a pause it used to cover.
 */
function clientPauseUpgradeFor(from: CadencePauseReason | null): CadencePauseReason | null {
  const outcome = cadenceTransition({ status: 'paused', pauseReason: from }, 'client_paused');
  return outcome.kind === 'move' && outcome.status === 'paused' ? outcome.pauseReason : null;
}

/**
 * Why a killed cadence's unsent touches were retired.
 *
 * `suppressed` rather than `cadence_stopped`, on the 03-02 rule that a skip
 * reason states what is TRUE: the recipient is on `suppressed_contacts`, which
 * is the specific fact, and `cadence_stopped` would describe the consequence
 * while discarding the cause Phase 7 would want to see.
 */
const KILL_SKIP_REASON: TouchSkipReason = 'suppressed';

/**
 * The free-text `reason` and the `source` stamped on every row this module
 * writes to `suppressed_contacts`.
 *
 * `source` is a machine fact — which mechanism wrote the row — and Phase 4's
 * STOP handling becomes the second writer with `'sms_stop'`. `reason` exists to
 * be READ by a human deciding later whether the suppression was justified, so it
 * says who acted rather than restating the source.
 */
const KILL_SOURCE = 'operator_kill';
const KILL_REASON = 'Operator kill switch: the client or the customer asked us to stop.';

/**
 * The sources Phase 4's inbound handling writes suppression under.
 *
 * NOT a widening of `CADENCE_EVENTS`, and the distinction matters. There is no
 * `opt_out` member of that vocabulary and this file does not add one: the state
 * machine's question is "what happens to a live cadence when a human is
 * suppressed", and `contact_killed` already answers it. What differs between an
 * operator kill and a customer texting STOP is not the TRANSITION, it is the
 * EVIDENCE — so the difference lives in `suppressed_contacts.source`, which is
 * exactly the column that table's header says exists for it ("`'operator_kill'`
 * today, `'sms_stop'` when Phase 4's deterministic STOP handling becomes the
 * second writer").
 *
 * All three arms are declared now, before two of them have callers, for the same
 * reason `pauseForReply` was exported before Phase 4 existed: the alternative is
 * a second module inventing its own spelling of `'sms_stop'` later, and a
 * suppression stored under a source nobody queries is evidence nobody finds.
 */
export const INBOUND_SUPPRESSION_SOURCES = [
  /** The customer replied STOP to a follow-up SMS (04-01/04-02, MSG-03). */
  'sms_stop',
  /** The customer used the unsubscribe link in a follow-up email (04-05). */
  'email_unsubscribe',
  /** The provider reported the recipient as opted out at their end (04-04). */
  'provider_opt_out',
] as const;
export type InboundSuppressionSource = (typeof INBOUND_SUPPRESSION_SOURCES)[number];

/**
 * The human-readable `reason` each inbound source stamps.
 *
 * Free text, and it says WHAT THE HUMAN DID rather than restating the machine
 * `source` beside it — the column exists to be read by somebody deciding later
 * whether the suppression was justified, and "sms_stop" tells that person
 * nothing they cannot already see one column to the left.
 */
const INBOUND_SUPPRESSION_REASONS: Record<InboundSuppressionSource, string> = {
  sms_stop: 'The customer replied STOP to a follow-up SMS.',
  email_unsubscribe: 'The customer used the unsubscribe link in a follow-up email.',
  provider_opt_out: 'The messaging provider reported this recipient as opted out.',
};

/* ------------------------------------------------------------------------- *
 * killContact — D-06/D-15, terminal
 * ------------------------------------------------------------------------- */

export type KillContactResult =
  | {
      kind: 'killed';
      /** Channel/address pairs this human is now suppressed on. */
      addressesSuppressed: number;
      touchesSkipped: number;
    }
  | {
      kind: 'already_stopped';
      addressesSuppressed: number;
      /** What had already stopped it — never overwritten by the kill. */
      stopReason: CadenceStopReason | null;
    }
  | { kind: 'no_addresses' }
  /**
   * Phase 15 (15-REVIEW CR-01): the cadence's mobile was RETIRED by the privacy
   * pass (D-06) — it holds a pseudonym, not a number — and no other address
   * remains. Nothing was written: a hash in `suppressed_contacts` suppresses
   * nobody and reads as if it did. Distinct from `no_addresses` because the
   * operator's next step differs (the caller's real number, if they ring
   * again, is a NEW lead, and its STOP is honoured on the raw number).
   */
  | { kind: 'number_retired' }
  | { kind: 'no_cadence' };

/**
 * Never chase this human again (D-06/D-15). ONE-WAY BY DESIGN.
 *
 * ── BOTH CHANNELS, ONE HUMAN ────────────────────────────────────────────────
 *
 * The cadence's snapshotted mobile AND email are both written, even though every
 * Phase 3 template is sms. One person asked not to be contacted; honouring that
 * on SMS while emailing them anyway is a loophole, not compliance. This is the
 * same cross-channel rule `consume-events.ts` already probes with at creation,
 * which is what makes the kill reach NEW quotes: a suppression keyed on the
 * ADDRESS blocks the fresh `quote_contacts` row the same human arrives as on
 * their next job, where a suppression keyed on a contact uuid would not.
 *
 * ── THE ADDRESSES ARE WRITTEN VERBATIM, AND ARE NOT RE-NORMALIZED ───────────
 *
 * `cadences.contact_mobile` / `contact_email` are already the normalized
 * snapshot (`+614…`, trimmed-lowercase) that `selectPrimaryContact` produced,
 * and they are the exact strings `dispatch.ts` and the creation gate probe the
 * suppression list with. Running them through `normalizeAuMobile` again could
 * only ever produce a DIFFERENT string — and a suppression stored under a
 * spelling no probe asks about is a suppression that does not suppress. The
 * normalization belongs at the boundary where the raw upstream value arrives,
 * which is where it happens.
 *
 * ── THE SUPPRESSION IS WRITTEN EVEN WHEN THE CADENCE IS ALREADY TERMINAL ────
 *
 * A cadence that stopped as `won` an hour ago is a common thing to be looking at
 * when the tradie says "and don't ever contact them again". Refusing the
 * suppression because there is no live cadence to stop would honour none of that
 * sentence — and the first anyone would learn of it is the same customer getting
 * chased on their next quote. So the suppression write is unconditional; only
 * the cadence transition is guarded, and `already_stopped` reports exactly that
 * split rather than pretending either half did not happen.
 *
 * A second kill on the same contact is a no-op at the unique index and reports
 * the same `addressesSuppressed`: the number describes the state this call
 * guarantees, not the rows it happened to write.
 */
export async function killContact(
  tenantId: string,
  cadenceId: string,
): Promise<KillContactResult> {
  return suppressAndStop(tenantId, cadenceId, KILL_SOURCE, KILL_REASON);
}

/**
 * The one transaction every "never chase this human again" path runs.
 *
 * ── WHY THIS IS PARAMETERIZED RATHER THAN COPIED ────────────────────────────
 *
 * This file's header states the rule it exists to enforce: "the second
 * expression of 'stop chasing this person' is the one that gets a condition
 * wrong, and the failure is a message going out after somebody asked us to
 * stop." Phase 4's inbound STOP is that second caller. Writing it as its own
 * transaction would have duplicated four decisions — that the suppression write
 * is UNCONDITIONAL even for a terminal cadence, that BOTH channels are written,
 * that the addresses are the snapshot VERBATIM, and that the skip is inseparable
 * from the stop — and the copy that drifts is the one that keeps sending.
 *
 * ONLY TWO THINGS VARY, and both are evidence rather than behaviour: the machine
 * `source` and the human `reason`. The transition, the guards, the skip reason
 * and the result union are identical by construction, so `killContact`'s public
 * behaviour is byte-compatible with what it was before the extraction — which
 * `tests/cadence-controls.test.ts` asserts, unchanged.
 */
async function suppressAndStop(
  tenantId: string,
  cadenceId: string,
  source: string,
  reason: string,
): Promise<KillContactResult> {
  const repo = forTenant(tenantId);

  const [cadence] = await repo.cadences.getById(cadenceId);
  // Absent, or belonging to another tenant — indistinguishable on purpose.
  if (!cadence) return { kind: 'no_cadence' };

  const entries = suppressionEntriesFor(cadence);
  if (entries.length === 0 && cadence.contactMobile && isPseudonym(cadence.contactMobile)) {
    // A retired number (15-REVIEW CR-01): see the union member. Checked before
    // `no_addresses` so the operator is told WHY there is nothing to write.
    return { kind: 'number_retired' };
  }
  if (entries.length === 0) {
    // A D-04 `no_contact` cadence: there was never an address, so there is
    // nobody to record. Stopping it under a reason that claims a suppression
    // exists would put a false statement in the column Phase 7 reads.
    return { kind: 'no_addresses' };
  }

  return repo.transaction(async (tx) => {
    await tx.suppression.insertMany(
      entries.map((entry) => ({
        channel: entry.channel,
        address: entry.address,
        reason,
        source,
      })),
    );

    const outcome = cadenceTransition(
      { status: cadence.status as CadenceStatus, pauseReason: cadence.pauseReason as CadencePauseReason | null },
      'contact_killed',
    );

    if (outcome.kind !== 'move') {
      return {
        kind: 'already_stopped' as const,
        addressesSuppressed: entries.length,
        stopReason: cadence.stopReason as CadenceStopReason | null,
      };
    }

    // The guard, not the read above, is what decides: `WHERE status IN
    // ('active','paused')` is the idempotence mechanism, so two operators
    // tapping kill at once produce one stop and one `already_stopped`.
    const stopped = await tx.cadences.stopWhereLive([cadence.id], KILL_STOP_REASON);
    if (stopped.length === 0) {
      return {
        kind: 'already_stopped' as const,
        addressesSuppressed: entries.length,
        stopReason: cadence.stopReason as CadenceStopReason | null,
      };
    }

    // INSEPARABLE FROM THE STOP, in the same transaction as it: a stopped
    // cadence whose touches are still `scheduled` is the exact state that makes
    // a killed cadence keep sending.
    const skipped = await tx.touches.skipUnsentForCadences([cadence.id], KILL_SKIP_REASON);

    return {
      kind: 'killed' as const,
      addressesSuppressed: entries.length,
      touchesSkipped: skipped.length,
    };
  });
}

/**
 * The customer asked to be left alone, through a channel rather than through the
 * console (MSG-03). ONE-WAY BY DESIGN, exactly as `killContact` is.
 *
 * ── WHY THIS IS HERE AND NOT IN `src/core/messaging` ────────────────────────
 *
 * Because of the sentence at the top of this file: a kill switch is only a kill
 * switch if it is the same switch everywhere. `handleInboundSms` could have
 * written `suppressed_contacts` itself — it is three statements — and the copy
 * would have had to re-derive that the write is unconditional at a terminal
 * cadence, that both channels go in, that the addresses are the snapshot
 * verbatim, and that the touch skip commits with the stop. It would have got one
 * of them wrong eventually, and the symptom is a follow-up sent after a STOP.
 *
 * ── THE STOP REASON IS `contact_suppressed`, AND IT IS NOT A LITERAL ────────
 *
 * `CADENCE_EVENTS` has no `opt_out` member (transitions.ts:105), deliberately:
 * the matrix answers "what happens to a live cadence when this human is
 * suppressed", and the answer does not depend on who said so. So an inbound STOP
 * rides the `contact_killed` arm, and the reason comes from
 * `KILL_STOP_REASON` — resolved from the matrix at module load — rather than
 * being typed out here. Phase 7 attributes recovered revenue on that column, and
 * a second answer to it written in a Phase 4 file is how the two drift.
 *
 * WHAT DISTINGUISHES AN INBOUND STOP FROM AN OPERATOR KILL is `source`, in the
 * evidence table, where "the customer texted STOP" and "the tradie asked us to
 * stop" are different facts with different evidentiary weight.
 *
 * ── RESULT SHAPE IS `killContact`'s, INCLUDING `no_cadence` ─────────────────
 *
 * Callers must be able to tell "suppressed and stopped" from "suppressed, the
 * cadence was already terminal" from "there was no address to record": for an
 * inbound those are three different rows in `inbound_messages`. Reusing the
 * union rather than inventing a parallel one keeps them one vocabulary.
 */
export async function suppressFromInbound(
  tenantId: string,
  cadenceId: string,
  source: InboundSuppressionSource,
): Promise<KillContactResult> {
  return suppressAndStop(tenantId, cadenceId, source, INBOUND_SUPPRESSION_REASONS[source]);
}

/**
 * The suppression an UNTHREADABLE opt-out writes: no cadence, no snapshot, one
 * bare address, every client (04-02, D-03).
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * A STOP arriving from a number with no live cadence is ordinary, not exotic:
 * the customer replied a week after the chase ended, or their quote was already
 * won, or they are answering a client who has since disconnected. 04-01
 * recorded those and wrote nothing, and named the gap in `inbound.ts`'s header
 * as a real Spam Act hole rather than a design. This closes it.
 *
 * ── WHY IT IS HERE AND NOT IN THE INBOUND HANDLER ───────────────────────────
 *
 * This file's header states the rule: "the second expression of 'stop chasing
 * this person' is the one that gets a condition wrong, and the failure is a
 * message going out after somebody asked us to stop." Every suppression write
 * in this codebase lives in this file for that reason — `killContact` and
 * `suppressFromInbound` share one transaction, and this one shares their source
 * and reason vocabulary. Inlining it at the call site would have given
 * `inbound.ts` its own tenant-scoped write surface and a second spelling of the
 * reason string, which is the drift `INBOUND_SUPPRESSION_REASONS` exists to
 * prevent.
 *
 * ── EVERY TENANT, AND THAT IS THE DECISION, NOT AN OVERSIGHT ────────────────
 *
 * `suppressed_contacts` is tenant-scoped, so "suppress this bare mobile" has no
 * single row to be. D-03 chooses over-suppression: the cost is that a client
 * who never quoted this person now carries a suppression row for them, and the
 * cost of the alternative is that human being chased by whichever client quotes
 * them next. One of those is a compliance breach and the other is a row.
 *
 * ── NO CADENCE MOVES ───────────────────────────────────────────────────────-
 *
 * There is no cadence to stop — that is the premise. This writes suppression
 * ONLY, so nothing here can stop, pause or resume anything, and a forged STOP
 * at this boundary cannot reach the cadence machine at all.
 *
 * Idempotent at the `suppressed_contacts` unique index: a customer repeating
 * themselves writes nothing new and is not an error. Per-tenant inserts rather
 * than one multi-row statement because `forTenant()` closes over its scope by
 * design — that is the mechanism, and this is what paying for it looks like.
 */
export async function suppressBareContact(
  tenantIds: readonly string[],
  contact: { channel: SuppressionChannel; address: string },
  source: InboundSuppressionSource,
): Promise<{ tenantsSuppressed: number; rowsWritten: number }> {
  // The shared vocabulary, plus the ONE fact that distinguishes this row from
  // its threaded sibling. A human auditing a suppression months later needs to
  // know it was applied to them without a matching conversation.
  const reason =
    `${INBOUND_SUPPRESSION_REASONS[source]} No live cadence matched the sender, ` +
    'so it was suppressed for every client (D-03).';

  let rowsWritten = 0;
  for (const tenantId of tenantIds) {
    rowsWritten += await forTenant(tenantId).suppression.insertMany([
      { channel: contact.channel, address: contact.address, reason, source },
    ]);
  }

  // `tenantsSuppressed` is the STATE this call guarantees and `rowsWritten` is
  // what it happened to write — the same distinction `killContact` draws about
  // `addressesSuppressed`. A repeat STOP writes zero rows and still guarantees
  // every client is covered.
  return { tenantsSuppressed: tenantIds.length, rowsWritten };
}

/**
 * The channel/address pairs a cadence's snapshotted contact is reachable on.
 *
 * A RETIRED MOBILE IS NOT AN ADDRESS (Phase 15, 15-REVIEW CR-01). The privacy
 * pass (D-06) overwrites a closed lead's cadence `contact_mobile` with the
 * caller pseudonym; written into `suppressed_contacts` it would match no probe
 * ever made (every probe asks with a raw E.164) while the console reported the
 * caller suppressed. So the chokepoint every suppression path shares drops it,
 * and `suppressAndStop` reports `number_retired` when nothing else remains.
 */
function suppressionEntriesFor(cadence: Cadence): SuppressionProbe[] {
  const entries: SuppressionProbe[] = [];
  if (cadence.contactMobile && !isPseudonym(cadence.contactMobile)) {
    entries.push({ channel: 'sms' as SuppressionChannel, address: cadence.contactMobile });
  }
  if (cadence.contactEmail) {
    entries.push({ channel: 'email' as SuppressionChannel, address: cadence.contactEmail });
  }
  return entries;
}

/* ------------------------------------------------------------------------- *
 * pauseClient / resumeClient — D-06's reversible switch
 * ------------------------------------------------------------------------- */

export type PauseClientResult =
  | { kind: 'paused'; cadencesPaused: number }
  | { kind: 'already_paused' };

/**
 * Stop everything for one client, reversibly (D-06).
 *
 * TWO WRITES, ONE TRANSACTION, AND BOTH ARE LOAD-BEARING. The flag on
 * `cadence_settings` is what `dispatch.ts` re-reads just-in-time inside its claim
 * transaction, so it stops sends that are already in flight this tick. Pausing
 * the cadences themselves is what stops promotion and what makes the resume
 * possible at all — D-07 re-windows on the way back, and a cadence that was never
 * paused has nothing to re-window. Committing one without the other leaves a
 * client who is half-paused in a way neither the console nor the tick describes.
 *
 * ONLY `active` CADENCES MOVE. `pauseWhereActive` refuses a cadence already
 * paused for `customer_reply`, which is the D-05 asymmetry seen from this side:
 * downgrading that reason would hand the client a lever only a human may pull.
 *
 * ── EXCEPT AN `onboarding` PAUSE, WHICH IS UPGRADED (D-07, note 7) ──────────
 *
 * That pause is WEAKER than a client pause, and its unlock is broader: approving
 * the tenant's template set resumes every onboarding-paused cadence at once. A
 * client who taps "pause my messaging" during onboarding and is then approved an
 * hour later would find their cadences running — released by paperwork, not by
 * them. So the reason is upgraded to `client_paused` in the same transaction,
 * and only their own resume lifts it. Counted in `cadencesPaused` because the
 * client asked one question ("is everything stopped?") and the answer is one
 * number.
 */
export async function pauseClient(tenantId: string, now: Date): Promise<PauseClientResult> {
  const repo = forTenant(tenantId);

  return repo.transaction(async (tx) => {
    // `ensure` rather than `get`: a client who has never had a cadence has no
    // settings row yet, and "I could not pause you because you have no
    // configuration" is not an answer an operator can act on.
    const settings = await tx.settings.ensure();
    if (settings.pausedAt !== null) return { kind: 'already_paused' as const };

    await tx.settings.setPausedAt(now);

    const live = await tx.cadences.listLive();

    const paused = await tx.cadences.pauseWhereActive(
      live.filter((cadence) => cadence.status === 'active').map((cadence) => cadence.id),
      CLIENT_PAUSE_REASON,
    );

    // GROUPED BY THE REASON BEING UPGRADED FROM, because `upgradePauseReason`
    // carries `from` as half its guard — a row that moved between this read and
    // the write must not be re-labelled. One group today (`onboarding`); the
    // shape is what stops a fourth reason from needing this code re-derived.
    const upgradesByFrom = new Map<CadencePauseReason, string[]>();
    for (const cadence of live) {
      if (cadence.status !== 'paused') continue;
      const from = cadence.pauseReason as CadencePauseReason | null;
      if (from === null) continue;
      if (clientPauseUpgradeFor(from) !== CLIENT_PAUSE_REASON) continue;
      upgradesByFrom.set(from, [...(upgradesByFrom.get(from) ?? []), cadence.id]);
    }

    let upgraded = 0;
    for (const [from, ids] of upgradesByFrom) {
      upgraded += (
        await tx.cadences.upgradePauseReason(ids, { from, to: CLIENT_PAUSE_REASON })
      ).length;
    }

    return { kind: 'paused' as const, cadencesPaused: paused.length + upgraded };
  });
}

export type ResumeClientResult =
  | {
      kind: 'resumed';
      cadencesResumed: number;
      touchesRescheduled: number;
      /**
       * True when the schedules could NOT be repaired because the client's
       * ServiceM8 connection is still paused. The client-level pause IS lifted;
       * the re-window belongs to whoever fixes the key.
       */
      rewindowDeferred: boolean;
    }
  | { kind: 'not_paused' };

/**
 * Start the client's messaging again (D-06) — and repair what the pause broke.
 *
 * ── THREE STEPS, AND THE ORDER IS THE WHOLE FUNCTION ────────────────────────
 *
 *   1. Clear `cadence_settings.paused_at`.
 *   2. Reactivate ONLY the cadences paused with reason `client_paused`.
 *   3. Re-window exactly those cadences through the one D-07 rule.
 *
 * Step 2's guard is D-05 verbatim: a cadence paused because the customer wrote
 * back is NOT resumed by a client-level un-pause. `resumeWherePaused` expresses
 * that as a WHERE clause rather than a check here, so it cannot be forgotten at
 * the next call site. Only an operator lifts that pause, through `resumeCadence`.
 *
 * ── WHY STEP 3 IS OUTSIDE THE TRANSACTION, DELIBERATELY ─────────────────────
 *
 * `applyResumeRewindow` refuses while either pause is still in force, and it
 * reads that state through its own connection. Called inside the transaction
 * above it would read the UNCOMMITTED world from outside, see `paused_at` still
 * set, and quietly return `stillPaused: true` — a resume that clears the flag,
 * reports success, and leaves every overdue touch exactly where it was. Which is
 * the burst D-07 exists to prevent, arriving through the door marked "we fixed
 * it".
 *
 * The cost of the split is a crash window between the commit and the re-window.
 * It is survivable by construction: the tick's progress pass re-windows overdue
 * touches of active cadences for unpaused tenants, so the repair happens within
 * the minute either way. Reversing the order is not survivable, because a
 * re-window against a moment that is not the resume is worse than none.
 *
 * ── WHY THE RE-WINDOW IS SCOPED TO THE CADENCES THAT ACTUALLY RESUMED ───────
 *
 * Event consumption keeps running for paused tenants by design, so a client may
 * have gained brand new cadences DURING the pause — materialized from a fresh
 * anchor, with correct slots in the future. Re-windowing every active cadence
 * would drag their first touch forward to the resume moment and text a customer
 * days before the schedule said to.
 */
export async function resumeClient(tenantId: string, now: Date): Promise<ResumeClientResult> {
  const repo = forTenant(tenantId);

  const resumedIds = await repo.transaction(async (tx) => {
    const [settings] = await tx.settings.get();
    if (!settings || settings.pausedAt === null) return null;

    await tx.settings.setPausedAt(null);

    const paused = (await tx.cadences.listLive()).filter(
      (cadence) => cadence.status === 'paused',
    );
    const resumed = await tx.cadences.resumeWherePaused(
      paused.map((cadence) => cadence.id),
      CLIENT_PAUSE_REASON,
    );

    return resumed.map((cadence) => cadence.id);
  });

  if (resumedIds === null) return { kind: 'not_paused' };

  const rewindow = await applyResumeRewindow(tenantId, now, { onlyCadenceIds: resumedIds });

  return {
    kind: 'resumed',
    cadencesResumed: resumedIds.length,
    touchesRescheduled: rewindow.touchesRescheduled,
    rewindowDeferred: rewindow.stillPaused,
  };
}

/* ------------------------------------------------------------------------- *
 * resumeCadence — D-05's explicit human act
 * ------------------------------------------------------------------------- */

export type ResumeCadenceResult =
  | { kind: 'resumed'; touchesRescheduled: number; rewindowDeferred: boolean }
  | {
      /**
       * THE ACTIVATION GATE REFUSED (ONB-03 + ONB-04, transitions.ts note 7).
       *
       * The cadence IS paused and the operator IS entitled to resume — the
       * refusal is about neither. This client is missing one or both onboarding
       * conditions, and lifting the pause would produce a cadence the console
       * calls "running" whose every touch parks unsent (no approved wording) or
       * chases a customer ServiceM8 is already chasing (no attestation).
       *
       * ITS OWN KIND, NOT `not_paused`, on the rule 03-05 recorded about
       * `upgrade_unsupported`: nothing-should-happen and
       * something-should-have-happened-and-did-not have different consequences
       * for the human reading the answer. `not_paused` against a cadence the
       * same screen renders as paused is a lie an operator would act on — they
       * would reload, tap again, and conclude the button is broken, rather than
       * going and clearing the condition, which is the one thing that works.
       *
       * ── AND IT CARRIES THE CONDITIONS, NOT A SENTENCE (T-5-10) ────────────
       *
       * A refusal that does not name the MISSING thing sends an operator to
       * reload the page. Which of the two is missing is a fact this layer can
       * read cheaply and the console cannot re-derive without duplicating the
       * gate — so the OUTCOME travels with its conditions and the console owns
       * the copy and the link, which is the 06-01 rule (`src/core` returns
       * outcomes; sentences live in one shared mapping) applied here.
       */
      kind: 'onboarding_gated';
      conditions: OnboardingConditions;
    }
  | { kind: 'not_paused'; status: CadenceStatus }
  | { kind: 'no_cadence' };

/**
 * Resume ONE cadence, whatever it is paused for. THE OPERATOR IS THE HUMAN D-05
 * REQUIRES.
 *
 * D-05 says no automated resume after a live conversation — a human decides. An
 * operator tapping a confirmed button on a page showing that conversation's
 * cadence IS that decision, so this is the one path that lifts a
 * `customer_reply` pause. It reaches a `client_paused` cadence too, and a
 * `paused` row carrying no reason at all, which `transitions.ts` note 6 answers
 * the same way and no reason-matched WHERE clause could express.
 *
 * Same three-step shape as `resumeClient`, same reason for the ordering, scoped
 * to the single cadence. Re-windowing the tenant's other active cadences because
 * one of them resumed would rewrite send times for cadences that never slipped.
 */
export async function resumeCadence(
  tenantId: string,
  cadenceId: string,
  now: Date,
): Promise<ResumeCadenceResult> {
  const repo = forTenant(tenantId);

  const [cadence] = await repo.cadences.getById(cadenceId);
  if (!cadence) return { kind: 'no_cadence' };

  const outcome = cadenceTransition(
    {
      status: cadence.status as CadenceStatus,
      pauseReason: cadence.pauseReason as CadencePauseReason | null,
    },
    'operator_resumed',
  );

  if (outcome.kind !== 'move') {
    // An active cadence has no pause to lift; a terminal one must never be
    // revived. The matrix said so; this file did not re-decide it.
    //
    // ONE OF THOSE NO-OPS IS NOT ABOUT BEING UNPAUSED (note 7): the ONB-03 gate
    // refusing. Reported as its own kind, from the cadence's OWN reason rather
    // than by parsing the matrix's sentence.
    if (
      cadence.status === 'paused' &&
      cadence.pauseReason === ONBOARDING_PAUSE_REASON
    ) {
      // Read only on the refusal path, so the ordinary resume pays nothing for
      // it — two cheap per-tenant reads to tell the operator WHICH condition.
      return {
        kind: 'onboarding_gated',
        conditions: await readOnboardingConditions(repo),
      };
    }
    return { kind: 'not_paused', status: cadence.status as CadenceStatus };
  }

  const resumed = await repo.cadences.operatorResumeWherePaused([cadence.id]);
  if (resumed.length === 0) {
    // Somebody else got there between the read and the write — the guard is
    // what decides, and losing that race is an ordinary answer. RE-READ rather
    // than report the stale status, exactly as `pauseForReply` does: the cadence
    // may have stopped, or the gate may have closed underneath us (a template
    // set is per-tenant, so a concurrent write cannot re-gate this row — but the
    // repository predicate is the authority either way, and a result claiming
    // `not_paused` for a row that is visibly onboarding-paused is the same lie
    // the kind above exists to avoid).
    const [current] = await repo.cadences.getById(cadence.id);
    if (current?.status === 'paused' && current.pauseReason === ONBOARDING_PAUSE_REASON) {
      return {
        kind: 'onboarding_gated',
        conditions: await readOnboardingConditions(repo),
      };
    }
    return {
      kind: 'not_paused',
      status: (current?.status ?? cadence.status) as CadenceStatus,
    };
  }

  const rewindow = await applyResumeRewindow(tenantId, now, { onlyCadenceIds: [cadence.id] });

  return {
    kind: 'resumed',
    touchesRescheduled: rewindow.touchesRescheduled,
    rewindowDeferred: rewindow.stillPaused,
  };
}

/* ------------------------------------------------------------------------- *
 * pauseForReply — D-05, called by Phase 4's inbound classification
 * ------------------------------------------------------------------------- */

export type PauseForReplyResult =
  /**
   * The cadence is now standing down for a customer reply.
   *
   * Covers BOTH the pause and the no-op repeat: an active cadence that just
   * moved, and one already paused for `customer_reply` where a further reply
   * changes nothing. Both are the same fact for a caller — this conversation is
   * not being chased — and the repeat is not `not_active`, which means the
   * opposite thing (there was nothing to stand down).
   */
  | { kind: 'paused' }
  | {
      /**
       * THE PAUSE UPGRADE HAPPENED (D-05, transitions.ts note 3).
       *
       * The cadence was already paused for a reason a CLIENT may lift, and is
       * now paused for one only an operator may lift. The status did not
       * change; the reason did, which is the whole of it.
       *
       * Distinct from `paused` because the two describe different rows before
       * the call, and only this one closes a breach: without the upgrade the
       * client's own resume could restart messaging at somebody mid-
       * conversation. A caller counting these separately can see how often that
       * near-miss actually occurs.
       */
      kind: 'upgraded';
    }
  | { kind: 'not_active'; status: CadenceStatus }
  | { kind: 'no_cadence' };

/**
 * The customer wrote back: stand the machine down (D-05).
 *
 * Phase 4's inbound classification calls this on a UNIQUE match, and Phase 5's
 * inbound email will. Both must pause through this function rather than through
 * an UPDATE of their own — the pause reason they write is the one thing standing
 * between a client's "resume messaging" tap and a machine re-entering a live
 * conversation.
 *
 * The console does not call it: an operator looking at a reply pauses nothing,
 * because the reply already did.
 *
 * ── FOUR ROWS IN, THREE ANSWERS OUT ─────────────────────────────────────────
 *
 *   active                  → `paused`   (pauseWhereActive)
 *   paused(client_paused)   → `upgraded` (upgradePauseReason — 04-02 closed
 *                                        this; it was `upgrade_unsupported`
 *                                        from 03-05 until then, and while it
 *                                        was, a client's own resume could
 *                                        restart messaging mid-conversation)
 *   paused(onboarding)      → `upgraded` (05-03, the same write and the same
 *                                        breach one door over: without it, the
 *                                        TEMPLATE APPROVAL that resumes every
 *                                        onboarding-paused cadence would revive
 *                                        this one too, mid-conversation)
 *   paused(customer_reply)  → `paused`   (already the stickiest pause)
 *   stopped/completed/expired → `not_active`
 *
 * NOTHING BELOW NAMES A REASON. Both upgrade rows are served by the SAME code
 * path, because it takes `from` off the row and `to` off the matrix outcome —
 * which is why 05-03 added an arm to `transitions.ts` and nothing here.
 *
 * NOTHING HERE EVER MOVES A CADENCE TO `active`, and no branch writes a status
 * at all except the one that pauses. A reply can only ever stand the machine
 * down.
 */
export async function pauseForReply(
  tenantId: string,
  cadenceId: string,
): Promise<PauseForReplyResult> {
  const repo = forTenant(tenantId);

  const [cadence] = await repo.cadences.getById(cadenceId);
  if (!cadence) return { kind: 'no_cadence' };

  const status = cadence.status as CadenceStatus;
  const pauseReason = cadence.pauseReason as CadencePauseReason | null;

  const outcome = cadenceTransition({ status, pauseReason }, 'customer_reply');

  if (outcome.kind !== 'move') {
    // THE ONE NO-OP THE MATRIX PRODUCES HERE is a cadence already paused for a
    // customer reply (transitions.ts: "already paused for a customer reply; a
    // further reply changes nothing"). Reported as `paused` rather than
    // `not_active` because it IS paused, for exactly this reason — and the
    // inbound handler records this kind, where "not_active" against a visibly
    // reply-paused cadence would be a lie about which of the two happened.
    // Every other no-op reaching here is a terminal cadence.
    if (status === 'paused' && pauseReason === REPLY_PAUSE_REASON) {
      return { kind: 'paused' };
    }
    return { kind: 'not_active', status };
  }

  // ── THE UPGRADE (D-05) ────────────────────────────────────────────────────
  //
  // The matrix prescribes a move at an ALREADY-PAUSED cadence: the status stays
  // `paused` and the reason becomes one only an operator may lift. That is a
  // different write from a pause, and it has its own guard — see
  // `upgradePauseReason`.
  if (status === 'paused') {
    // FROM THE OUTCOME, NEVER A LITERAL. `cadenceTransition` decided which
    // reason this event lands; typing `REPLY_PAUSE_REASON` here would be a
    // second answer to a question the matrix already answered, and the two
    // would drift the first time the matrix changed.
    if (outcome.pauseReason === null || outcome.pauseReason === ONBOARDING_PAUSE_REASON) {
      // Unreachable twice over: `fromPaused`'s `customer_reply` arm either
      // no-ops or moves to `customer_reply`, and note 7 forbids ANY move into
      // the activation gate — asserted over the whole input space in
      // tests/cadence-transitions.test.ts. Named rather than asserted-away,
      // because the alternative to a name is a cast nobody can audit, and the
      // thing being cast past here is the D-05 downgrade.
      return { kind: 'not_active', status };
    }

    const upgraded = await repo.cadences.upgradePauseReason([cadence.id], {
      from: pauseReason,
      to: outcome.pauseReason,
    });

    if (upgraded.length === 0) {
      // The guard refused: somebody moved the cadence between the read and the
      // write. RE-READ rather than report the stale status — a result claiming
      // `paused` for a cadence that has since stopped is the kind of record a
      // later human reads as "handled".
      const [current] = await repo.cadences.getById(cadence.id);
      return { kind: 'not_active', status: (current?.status ?? status) as CadenceStatus };
    }

    return { kind: 'upgraded' };
  }

  const paused = await repo.cadences.pauseWhereActive([cadence.id], REPLY_PAUSE_REASON);
  if (paused.length === 0) return { kind: 'not_active', status };

  return { kind: 'paused' };
}
