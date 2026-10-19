/**
 * THE NIGHTLY PSEUDONYMISATION PASS (Phase 15, COMP-02 / D-06; research Q6).
 *
 * The retention promise on the public privacy notice — "ninety days after a
 * lead closes without becoming a job, we replace your number … with a code we
 * cannot turn back into a number" — is a sentence until something runs every
 * night and makes it true. This is that something. It rides the existing
 * 03:30 AWST `messaging-reconcile` tick as one more awaited pass: no new
 * pg_cron job, no second bearer, no second route (planning note S8 — one more
 * nightly job is one more thing that can fail green).
 *
 * ── WHAT IS REPLACED ────────────────────────────────────────────────────────
 *
 * The caller's number becomes `HMAC-SHA-256(pepper, number)` — 64 lower-case
 * hex, through the one leaf `./pseudonym` — wherever this product holds it for
 * a due lead, in ONE transaction per lead:
 *
 *   • the lead's missed calls — `caller_e164`, `caller_raw` and
 *     `forwarded_from_raw`, EACH hashed on its own stored value (a raw string
 *     is not the normalised number, so it gets its own code), each stamped;
 *   • the lead's inbound rows — `from_address` and `normalized_from`, stamped;
 *   • (15-REVIEW WR-01) the replies from the lead's number we could not
 *     place — `unmatched`, or `ambiguous` with this client among the
 *     candidates, no lead, no quote — from the lead's first call up to its
 *     close + `PSEUDONYMISE_AFTER_DAYS` (or older than the boundary): the
 *     late "thanks, all sorted" that arrives after the cadence has stopped
 *     and so never threads. Same hash, stamped, words kept;
 *   • the lead's lead cadence — `contact_mobile`;
 *   • the lead's ledger rows — `to_address`;
 *   • LAST, the lead itself — `contact_mobile` AND `pseudonymised_at` in one
 *     statement, because migration 0042's widened CHECK admits the hash only
 *     beside its stamp.
 *
 * The cadence and ledger rows ride the lead's stamp — there is no fourth
 * stamp. A lead-less call past the boundary (withheld, other-number, or a
 * mobile that never opened a lead) is hashed and stamped ONE ROW AT A TIME;
 * a withheld row keeps `caller_e164` NULL (its CHECK), and is stamped anyway
 * so the due-read converges.
 *
 * ── WHAT IS KEPT ────────────────────────────────────────────────────────────
 *
 * The words a caller sent (inbound bodies) stay with the business's records;
 * no statement here writes them. A STOP is kept for as long as it is needed so
 * that it keeps working: this module names no opt-out table, by construction,
 * and the structural pin in `tests/pseudonymise-structure.test.ts` keeps it so.
 *
 * ── WHEN A ROW FALLS DUE ────────────────────────────────────────────────────
 *
 * The two due-reads own the predicate (plan 15-03): a lead closed or expired
 * at least `PSEUDONYMISE_AFTER_DAYS` ago; a converted lead whose mirrored job
 * reached Completed or Unsuccessful at least that long ago (a customer's
 * number is kept while their job is open); a converted lead that converted at
 * least `PSEUDONYMISE_CONVERTED_MAX_DAYS` ago whatever its job's state — the
 * long-stop (15-REVIEW WR-02), so a job the mirror never sees finish cannot
 * keep the number for ever; a lead-less call that arrived at least
 * `PSEUDONYMISE_AFTER_DAYS` ago. An open lead is never due.
 *
 * ── WHY THE GATE READS NO HASH (research Q6's ruling) ───────────────────────
 *
 * `PSEUDONYMISE_AFTER_DAYS` IS the negative cool-off (`constants.ts`, pinned
 * `>=` in the structure suite). A lead is hashed only once it is at or past
 * the end of every window the text-back gate looks back over, so no gate
 * window can ever contain a hashed row — which is why the gate's per-caller
 * reads compare the RAW number with one equality and never compute a hash.
 * The one rule that must outlive the boundary — a STOP — reads the opt-out
 * rows, which are kept raw. Shortening retention below the cool-off would
 * silently reopen the gate; the identity is the guard.
 *
 * ── IDEMPOTENT AT THE ROW ───────────────────────────────────────────────────
 *
 * Every write is guarded on its row's stamp (and the lead's children on the
 * lead being not open and unstamped), so a second run — or two overlapping
 * ones — changes nothing that is already done. A lead the final statement
 * refuses (stamped meanwhile) rolls its whole transaction back, so no child
 * row is left hashed under an unstamped lead.
 *
 * ── BOUNDED ─────────────────────────────────────────────────────────────────
 *
 * At most `PSEUDONYMISE_BATCH` leads and `PSEUDONYMISE_BATCH` lead-less calls
 * per night. A backlog drains oldest first over the following nights; the tick
 * stays inside its duration.
 *
 * ── LOGS ARE COUNTS ─────────────────────────────────────────────────────────
 *
 * No id, no number, no hash and no body ever reaches a log line. Every log
 * line is a fixed string, and the counts ride as a SEPARATE argument —
 * `console.log(label, count)` — never inside a template literal, so the
 * structural pin can prove nothing else could ride along. Every caught value
 * is discarded: a postgres error carries its statement parameters, and those
 * include a caller's number.
 *
 * ── THE PEPPER ──────────────────────────────────────────────────────────────
 *
 * An ARGUMENT. It is read once, at the edge (the messaging-reconcile route),
 * and handed down; this module never reads the environment. A pepper under the
 * floor throws before anything is written, and the pass reports failed.
 *
 * ── IT NEVER THROWS ─────────────────────────────────────────────────────────
 *
 * The cron route must never 500 because of this pass: everything is caught
 * and the FAILED shape returned. A per-lead or per-call write failure is
 * counted in `failed` and the pass moves on.
 */
import {
  forTenant,
  listLeadsDueForPseudonymisation,
  listMissedCallsDueForPseudonymisation,
} from '@/db/repository';

import { PSEUDONYMISE_BATCH } from './constants';
import { PEPPER_MIN_CHARS, pseudonymiseCaller } from './pseudonym';

/** What one night's pass did. Counts only — nothing here can name anyone. */
export interface PseudonymisationResult {
  /** Leads closed or expired without converting, hashed and stamped tonight. */
  leadsClosed: number;
  /** Converted leads whose job finished past the boundary, hashed and stamped tonight. */
  leadsConverted: number;
  /** Missed calls hashed and stamped under their lead's transaction. */
  missedCallsWithLead: number;
  /** Lead-less missed calls hashed and stamped one row at a time. */
  missedCallsNoLead: number;
  /** Inbound rows of hashed leads whose sender columns took the hash. */
  inboundRows: number;
  /**
   * 15-REVIEW WR-01: replies from a hashed lead's number that we could not
   * place (`unmatched`/`ambiguous`, no lead, no quote) — the late "thanks, all
   * sorted" after the lead's cadence stopped — hashed and stamped with it.
   */
  inboundRowsNoLead: number;
  /** Lead cadences of hashed leads whose `contact_mobile` took the hash. */
  cadenceRows: number;
  /** Ledger rows of hashed leads whose `to_address` took the hash. */
  ledgerRows: number;
  /**
   * Leads or lead-less calls whose write failed or was refused tonight —
   * rolled back, left raw, and due again tomorrow. Anything above 0 is a
   * next-morning check, never a data repair by SQL.
   */
  failed: number;
  /**
   * True when the pass as a whole threw (a due-read failed, or the pepper is
   * under the floor) — every count above is then 0 and nothing was written
   * after the failure point.
   */
  passFailed: boolean;
}

/** A night with nothing due. */
export const PSEUDONYMISE_NOTHING: PseudonymisationResult = {
  leadsClosed: 0,
  leadsConverted: 0,
  missedCallsWithLead: 0,
  missedCallsNoLead: 0,
  inboundRows: 0,
  inboundRowsNoLead: 0,
  cadenceRows: 0,
  ledgerRows: 0,
  failed: 0,
  passFailed: false,
};

/** A pass that threw: nothing reported, and the flag the operator reads. */
export const PSEUDONYMISE_FAILED: PseudonymisationResult = {
  ...PSEUDONYMISE_NOTHING,
  passFailed: true,
};

interface PassDeps {
  now: Date;
  pepper: string;
}

/** The three caller strings of one call, each hashed on its own value or left NULL. */
function hashCallerStrings(
  row: { callerE164: string | null; callerRaw: string | null; forwardedFromRaw: string | null },
  pepper: string,
) {
  return {
    callerE164: row.callerE164 === null ? null : pseudonymiseCaller(row.callerE164, pepper),
    callerRaw: row.callerRaw === null ? null : pseudonymiseCaller(row.callerRaw, pepper),
    forwardedFromRaw:
      row.forwardedFromRaw === null ? null : pseudonymiseCaller(row.forwardedFromRaw, pepper),
  };
}

/** Thrown inside a lead's transaction to roll it back when the lead itself is refused. */
class LeadRefused extends Error {}

export async function runPseudonymisationPass(deps: PassDeps): Promise<PseudonymisationResult> {
  try {
    return await sweep(deps);
  } catch {
    // The cron route must never 500 because of this pass. The caught value is
    // discarded — see the header.
    console.error('[pseudonymise] pass failed');
    return PSEUDONYMISE_FAILED;
  }
}

async function sweep({ now, pepper }: PassDeps): Promise<PseudonymisationResult> {
  // 15-REVIEW IN-01: a pepper under the floor fails the WHOLE pass, once,
  // before any read — never as one `failed` per lead-less call.
  if (pepper.length < PEPPER_MIN_CHARS) throw new Error('pseudonym: pepper too short');

  const result: PseudonymisationResult = { ...PSEUDONYMISE_NOTHING };

  // ── 1. DUE LEADS — one transaction each, the lead's stamp last ────────────
  const leads = await listLeadsDueForPseudonymisation(now, PSEUDONYMISE_BATCH);

  for (const lead of leads) {
    // Hashed OUTSIDE the per-lead try: a pepper under the floor is a
    // configuration bug, so it fails the whole pass before any write.
    const contactHash = pseudonymiseCaller(lead.contactMobile, pepper);

    try {
      const done = await forTenant(lead.tenantId).transaction(async (tx) => {
        let calls = 0;
        const rows = await tx.missedCalls.listRawForLead(lead.leadId);
        for (const row of rows) {
          const written = await tx.missedCalls.pseudonymise(
            row.id,
            hashCallerStrings(row, pepper),
            now,
          );
          calls += written.length;
        }

        const counts = await tx.leads.pseudonymise(lead.leadId, { contactHash, at: now });
        // Refused (stamped or reopened meanwhile): undo the calls above too, so
        // no hashed child is ever left under an unstamped lead.
        if (counts.leads !== 1) throw new LeadRefused();

        return { calls, counts };
      });

      // Tallied only after the commit — a rolled-back lead counts nothing.
      result.missedCallsWithLead += done.calls;
      result.inboundRows += done.counts.inboundRows;
      result.inboundRowsNoLead += done.counts.inboundRowsNoLead;
      result.cadenceRows += done.counts.cadenceRows;
      result.ledgerRows += done.counts.ledgerRows;
      if (lead.status === 'converted') result.leadsConverted += 1;
      else result.leadsClosed += 1;
    } catch {
      result.failed += 1;
      console.error('[pseudonymise] lead write failed');
    }
  }

  // ── 2. LEAD-LESS CALLS — one guarded row at a time ────────────────────────
  const calls = await listMissedCallsDueForPseudonymisation(now, PSEUDONYMISE_BATCH);

  for (const call of calls) {
    try {
      const written = await forTenant(call.tenantId).missedCalls.pseudonymise(
        call.id,
        hashCallerStrings(call, pepper),
        now,
      );
      result.missedCallsNoLead += written.length;
    } catch {
      result.failed += 1;
      console.error('[pseudonymise] call write failed');
    }
  }

  // ── 3. COUNTS ONLY — a fixed label, the number as its own argument ────────
  console.log('[pseudonymise] leads_closed', result.leadsClosed);
  console.log('[pseudonymise] leads_converted', result.leadsConverted);
  console.log('[pseudonymise] missed_calls_with_lead', result.missedCallsWithLead);
  console.log('[pseudonymise] missed_calls_no_lead', result.missedCallsNoLead);
  console.log('[pseudonymise] inbound_rows', result.inboundRows);
  console.log('[pseudonymise] inbound_rows_no_lead', result.inboundRowsNoLead);
  console.log('[pseudonymise] cadence_rows', result.cadenceRows);
  console.log('[pseudonymise] ledger_rows', result.ledgerRows);
  console.log('[pseudonymise] failed', result.failed);

  return result;
}
