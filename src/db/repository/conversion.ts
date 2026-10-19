/**
 * The one sanctioned crossing between prospects and tenants (D-02).
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
 *
 * `prospects.ts` opens with a prohibition it means literally: nothing in that
 * module touches a tenant-scoped table, and nothing in `for-tenant.ts` touches a
 * prospect table, so a join between the two families has nowhere to be written.
 * Conversion is the single exception — it must set `tenants.prospect_id` and
 * clear `prospect_quote_lines.purge_after` atomically, which requires both
 * tables in one transaction.
 *
 * Putting it here rather than weakening either module's header is the point.
 * The exception is ONE file, with ONE export, and it is greppable: anybody
 * wondering "can prospect data reach a cadence?" finds exactly one place where
 * the two schemas are imported together and can read what it does. A second
 * function added to this file is a decision somebody has to make on purpose.
 *
 * What it does NOT do is as load-bearing as what it does. It copies nothing. It
 * creates no `quotes` row, no contact, no cadence candidate. A converted
 * client's sync starts fresh from their own connected account; the audit lines
 * stay audit lines, they merely stop expiring.
 */
import { eq } from 'drizzle-orm';

import { prospectQuoteLines, prospects, tenants } from '@/db/schema';

import { getDb } from './client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConvertProspectResult =
  | { ok: true; linesKept: number }
  | { ok: false; kind: 'prospect_not_found' | 'tenant_not_found' }
  | { ok: false; kind: 'already_linked'; existingProspectId: string };

function assertUuid(value: string, label: string): void {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`A ${label} uuid is required; received ${JSON.stringify(value)}.`);
  }
}

/**
 * Link a prospect to the client they became, and stop their purge clock.
 *
 * ── LINK, NEVER COPY ────────────────────────────────────────────────────────
 *
 * The audit figures and the baseline snapshot STAY ON THE PROSPECT ROW. Phase 7
 * reads the "before" through `tenants.prospect_id`, so there is exactly one copy
 * of the number the first invoice will be argued about. A copied baseline is two
 * numbers that agree until somebody regenerates one of them, and the
 * disagreement surfaces in front of a paying client.
 *
 * ── THE ONLY PLACE `purge_after` IS EVER CLEARED (D-04, threat T-2-07) ───────
 *
 * A prospect's quote lines carry a stranger's customers' names, phone numbers
 * and email addresses, and they self-delete after 30 days. Conversion is the one
 * event that justifies keeping them: the business signed, and their own quote
 * history is now their data as a client. Clearing the clock therefore takes an
 * explicit, operator-initiated call — never a background inference from some
 * other state, because a bug in that inference turns a retention policy into a
 * data hoard with nothing going red.
 *
 * ── ONE LINK, NO SILENT OVERWRITE ───────────────────────────────────────────
 *
 * A tenant already pointing at a prospect is REJECTED, with the existing id, and
 * nothing is written. Repointing would strand the first prospect's lines in a
 * `purge_after IS NULL` state: retained forever, attached to no client, and
 * invisible to both the purge and every report.
 */
export async function convertProspectToTenant(
  prospectId: string,
  tenantId: string,
): Promise<ConvertProspectResult> {
  assertUuid(prospectId, 'prospect');
  assertUuid(tenantId, 'tenant');

  return getDb().transaction(async (tx) => {
    const [prospect] = await tx
      .select({ id: prospects.id })
      .from(prospects)
      .where(eq(prospects.id, prospectId));
    if (!prospect) return { ok: false as const, kind: 'prospect_not_found' as const };

    const [tenant] = await tx
      .select({ id: tenants.id, prospectId: tenants.prospectId })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) return { ok: false as const, kind: 'tenant_not_found' as const };

    if (tenant.prospectId !== null) {
      return {
        ok: false as const,
        kind: 'already_linked' as const,
        existingProspectId: tenant.prospectId,
      };
    }

    await tx.update(tenants).set({ prospectId }).where(eq(tenants.id, tenantId));

    // `returning` rather than a rowCount so the caller can state how much data
    // it just took responsibility for keeping — the operator-facing message
    // says it out loud instead of implying that conversion is free.
    const kept = await tx
      .update(prospectQuoteLines)
      .set({ purgeAfter: null })
      .where(eq(prospectQuoteLines.prospectId, prospectId))
      .returning({ id: prospectQuoteLines.id });

    return { ok: true as const, linesKept: kept.length };
  });
}
