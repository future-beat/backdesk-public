/**
 * What a lead reply's LABEL does to its lead (Phase 13, D-11; LEAD-02): a tick
 * pass of its own, after classification and before escalation.
 *
 * ── WHY A SEPARATE PASS AND NOT THE CLASSIFIER ──────────────────────────────
 *
 * Closing a lead is a state transition — its cadence is stopped, its unsent
 * touches retired, and a `spam` / `not_a_lead` / `complaint` / `opt_out` close
 * starts D-12's 90-day cool-off on the caller's number. The classifier hands a
 * stranger's words to a model, and its whole safety argument is that it can
 * write a label and nothing else (Phase 5, D-13;
 * `tests/classification-privilege.test.ts` forbids it this module). So the
 * effect lives here: this pass READS labels the classifier already wrote, and
 * acts only on the ones the policy below admits.
 *
 * ── HIGH CONFIDENCE ONLY (research Open Question 2) ─────────────────────────
 *
 * `existing_job`, `complaint`, `not_a_lead`, `already_sorted`, `spam` and
 * `opt_out` close the open lead — at HIGH confidence, and the read
 * (`inbound.closingLabelRowsForOpenLeads`) filters on that in SQL. A medium or
 * low closing label leaves the lead open for the operator: a wrong `spam`
 * close would blacklist a real caller for 90 days with no reopen path (D-12,
 * D-14). The label is the `closed_reason`, verbatim.
 *
 * The four open labels — `new_enquiry`, `callback_request`, `question`,
 * `other` — need nothing: `pauseForReply` already paused the cadence at the
 * door, before the row was written, and the reply waits in the inbox.
 *
 * ── SELF-HEALING, WITH NO MARKER COLUMN ─────────────────────────────────────
 *
 * The read returns only rows whose lead is still `open`, so a closed lead
 * leaves it: a tick that dies half-way is finished by the next one, and a
 * second close is `already_closed` by `closeLead`'s own guard. Several closing
 * rows on one lead close it once, with the NEWEST row's label.
 *
 * ── EVERY TENANT, EACH ISOLATED ─────────────────────────────────────────────
 *
 * The tenants the tick already walks, paused or not: a close sends nothing and
 * stops a chase, the safe direction, and a client who paused their messaging
 * still wants a spammer's lead closed. One tenant's failure is caught, logged
 * as a fixed string with its id, and the next tenant still runs. The caught
 * value is discarded — a driver error carries the statement.
 *
 * Framework-free and model-free. Logs carry ids only — never a caller's number
 * or words (T-4-02).
 */
import { forAllTenants_cadenceTick, forTenant } from '@/db/repository';

import { closeLead } from './close';

/** Counts only, enumerated by the tick. */
export interface LeadLabelEffectsResult {
  /** Open leads this pass closed on a high-confidence closing label. */
  leadsClosed: number;
}

/**
 * Close every open lead whose newest high-confidence closing label says so.
 */
export async function applyLeadLabelEffects(now: Date): Promise<LeadLabelEffectsResult> {
  let leadsClosed = 0;

  for (const tenant of await forAllTenants_cadenceTick()) {
    try {
      const rows = await forTenant(tenant.tenantId).inbound.closingLabelRowsForOpenLeads();

      // NEWEST ROW PER LEAD WINS: the read is ordered by `received_at`, so a
      // later write for the same lead replaces an earlier one.
      const labelByLead = new Map<string, (typeof rows)[number]['label']>();
      for (const row of rows) labelByLead.set(row.leadId, row.label);

      for (const [leadId, label] of labelByLead) {
        const result = await closeLead(tenant.tenantId, leadId, label, now);
        if (result.kind === 'closed') leadsClosed += 1;
      }
    } catch {
      console.error(`[leads] label effects failed for tenant ${tenant.tenantId}.`);
    }
  }

  return { leadsClosed };
}
