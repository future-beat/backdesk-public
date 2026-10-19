/**
 * Closing a lead (Phase 13, D-11/D-14/D-15): final, idempotent, and always on
 * a transaction somebody already holds.
 *
 * ── TWO FORMS, AND WHICH ONE A CALLER MAY USE IS THE WHOLE RULE ─────────────
 *
 * `closeLeadInTx(tx, …)` is the CORE. It takes the tenant repository's
 * transaction handle and uses ONLY that handle: read the lead's live cadence,
 * stop it (or expire it, for an `expired` close) and retire its unsent touches,
 * then close the lead with one guarded UPDATE. It never opens a transaction of
 * its own.
 *
 * `closeLead(tenantId, …)` is the ONE WRAPPER, and the only place in this
 * module that opens a transaction: it opens one tenant transaction and hands
 * its handle to the core.
 *
 * A CALLER ALREADY INSIDE A TRANSACTION MUST CALL THE TRANSACTION FORM ON ITS
 * OWN HANDLE — the expiry loop in the tick and the lead branch at the top of
 * `dispatchOne` are the two today. A second connection opened from inside the
 * first would wait on the row lock the outer transaction already holds on the
 * same cadence, and the outer transaction waits for the inner one to return:
 * the tick hangs for that tenant every minute, and the per-tenant catch hides
 * it. Callers OUTSIDE any transaction — the reconciling sweep below, the
 * label-effects pass and the inbound tie-break (plan 13-04) — use the wrapper.
 *
 * ── IDEMPOTENT BY TWO GUARDS, NEVER BY A READ ───────────────────────────────
 *
 * The cadence writes are guarded on the cadence still being live and the lead
 * write on the lead still being `open`, so a second call (or a call racing a
 * STOP) writes nothing and reports `already_closed`. A lead is never reopened
 * and its first reason is never overwritten; a new call makes a new lead
 * (D-12). Nothing here throws on a terminal row.
 *
 * NO MATRIX EVENT. The stop uses the existing guarded pair with the
 * `lead_closed` stop reason, exactly as `dispatchOne` stops a cadence
 * `mirror_missing` — the transition table is kind-agnostic and is not edited.
 *
 * Framework-free and model-free: no web framework, no SDK. Logs carry ids and
 * vocabulary values only — never a caller's number or words.
 */
import { forTenant, type TenantScopedRepository } from '@/db/repository';
import type { LeadClosedReason } from '@/db/schema';

/** What a close did. `already_closed` is an answer, not an error. */
export type CloseLeadResult = { kind: 'closed' } | { kind: 'already_closed' };

/**
 * THE CORE: close one lead on the caller's transaction handle. See the header
 * for who must call this form rather than the wrapper.
 */
export async function closeLeadInTx(
  tx: TenantScopedRepository,
  leadId: string,
  reason: LeadClosedReason,
  now: Date,
): Promise<CloseLeadResult> {
  const [cadence] = await tx.cadences.liveForLead(leadId);

  if (cadence) {
    if (reason === 'expired') {
      // D-15: an expired lead's cadence is EXPIRED, not stopped — the same
      // pair the tick's expiry pass writes, so the record says why.
      const ended = await tx.cadences.markExpired([cadence.id]);
      if (ended.length > 0) {
        await tx.touches.skipUnsentForCadences([cadence.id], 'cadence_expired');
      }
    } else {
      // The existing stop pair, as `dispatchOne` writes for `mirror_missing`.
      const stopped = await tx.cadences.stopWhereLive([cadence.id], 'lead_closed');
      if (stopped.length > 0) {
        await tx.touches.skipUnsentForCadences([cadence.id], 'cadence_stopped');
      }
    }
  }

  const closed = await tx.leads.close(leadId, reason, now);
  return closed.length > 0 ? { kind: 'closed' } : { kind: 'already_closed' };
}

/**
 * THE ONE WRAPPER: one tenant transaction, handed to the core. Only for
 * callers that are not already inside a transaction (see the header).
 */
export async function closeLead(
  tenantId: string,
  leadId: string,
  reason: LeadClosedReason,
  now: Date,
): Promise<CloseLeadResult> {
  return repositoryFor(tenantId).transaction((tx) => closeLeadInTx(tx, leadId, reason, now));
}

/**
 * Why an open lead's ended cadence closes it, read off the cadence.
 *
 * `completed` — touch 3 went, or was skipped, and the completion sweep
 * closed the cadence: the follow-ups are exhausted (D-01). `expired` — the
 * expiry pass ended it (D-15). A STOP reaches the cadence as
 * `contact_suppressed` (the kill path is kind-agnostic) and closes the lead
 * `opt_out`; an operator close is `operator`.
 *
 * Every other stop reason — `lead_closed` included, whose close happens in
 * the same transaction as its stop, so an open lead behind it is an anomaly —
 * reconciles as `operator`, loudly: the log names the stop reason, a closed
 * vocabulary value, and nothing else.
 */
function closedReasonFor(cadenceStatus: string, stopReason: string | null): LeadClosedReason {
  if (cadenceStatus === 'completed') return 'touches_exhausted';
  if (cadenceStatus === 'expired') return 'expired';
  if (stopReason === 'contact_suppressed') return 'opt_out';
  if (stopReason === 'operator_closed') return 'operator';

  console.error(
    `[leads] an open lead's cadence was stopped '${String(stopReason)}'; ` +
      'closing the lead as operator.',
  );
  return 'operator';
}

/**
 * THE RECONCILING SWEEP (D-01, D-14): every open lead whose lead cadence has
 * ended is closed, with the reason the cadence's end implies.
 *
 * A scan rather than an edit in every writer that can end a cadence — the
 * completion sweep, the expiry pass, the STOP kill path, an operator close —
 * so "every exit closes the lead" holds for a writer added later too. Runs in
 * the tick directly after the completion sweep, outside any transaction, so
 * it calls the wrapper. Returns how many leads it actually closed.
 */
export async function closeLeadsWithEndedCadences(tenantId: string, now: Date): Promise<number> {
  const rows = await repositoryFor(tenantId).leads.listOpenWithEndedCadence();
  let closed = 0;

  for (const row of rows) {
    const result = await closeLead(
      tenantId,
      row.leadId,
      closedReasonFor(row.cadenceStatus, row.stopReason),
      now,
    );
    if (result.kind === 'closed') closed += 1;
  }

  return closed;
}

/**
 * The tenant repository, named in ONE place. `closeLead` opens its single
 * transaction on it; the sweep's read above opens none.
 */
function repositoryFor(tenantId: string): TenantScopedRepository {
  return forTenant(tenantId);
}
