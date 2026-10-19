/**
 * The reports family's cross-client read (Phase 15, plan 15-03; D-04) — a
 * NINTH family of the inbound/escalations/leads shape: no method takes a
 * `tenantId` as a scope, because the question it answers is about every
 * client at once.
 *
 *   listLatestReportFiguresForExport — the design-partner CSV (D-04): the
 *     NEWEST frozen version of every client's every monthly report, as the
 *     figures document the generator froze and the ids that place it. The
 *     operator's export action parses each `figures` through
 *     `reportFiguresSchema` and resolves client names through the operator's
 *     own JWT under RLS — the approval queue's two-authority rule — so no
 *     name is read here.
 *
 * ── WHY THIS IS NOT A `forAllTenants_*` EXPORT ─────────────────────────────
 *
 * The cross-tenant export count is pinned at sixteen
 * (`tests/sync-upsert.test.ts`), and every one of the sixteen reaches customer
 * data, a cadence or a write. This read does not: it reads ONE table,
 * `monthly_reports`, joins nothing, and returns frozen documents of COUNTS —
 * the eleven quote figures and, from Phase 15, the optional missed-call block
 * (integers, two small arrays, rates with their denominators). The
 * `countLeadResolutionsSince` precedent: a counts-or-ids read in its family's
 * own file.
 *
 * ── WHAT THIS FILE PROMISES ────────────────────────────────────────────────
 *
 * Frozen documents and ids ONLY: no recovered-quote line, no customer name,
 * no number of any kind, no client name. The `lines` document (which names
 * jobs) is never selected. `tests/partner-csv.test.ts` reads this file with
 * its comments stripped and fails on a customer-column token, on a join, or
 * on a selected column beyond the five below.
 *
 * Every tenant-scoped report read and write stays on `forTenant().reports`.
 * Nothing here writes.
 */
import { desc } from 'drizzle-orm';

import { monthlyReports } from '@/db/schema';

import { getDb } from './client';

/** One client-month's newest frozen figures, for the design-partner export. */
export interface ReportFiguresForExport {
  tenantId: string;
  /** `YYYY-MM-DD`, the first local day of the month (a `date` column). */
  periodStart: string;
  /** The IANA zone the month was cut in. */
  timezone: string;
  /** The newest version of this (client, month). */
  version: number;
  /**
   * The frozen `figures` document, RAW. The caller parses it through
   * `reportFiguresSchema` — a strict shape, never trusted jsonb.
   */
  figures: unknown;
}

/**
 * THE NEWEST VERSION OF EVERY (CLIENT, MONTH) (Phase 15, D-04).
 *
 * `DISTINCT ON (tenant_id, period_start)` ordered `version DESC`, so a month
 * regenerated after Phase 15 (version N+1, carrying the missed-call block)
 * exports its newest figures and an untouched month exports the one version
 * it has. Ordered by tenant then month. Five named columns, one table, no
 * join.
 */
export async function listLatestReportFiguresForExport(): Promise<ReportFiguresForExport[]> {
  return getDb()
    .selectDistinctOn([monthlyReports.tenantId, monthlyReports.periodStart], {
      tenantId: monthlyReports.tenantId,
      periodStart: monthlyReports.periodStart,
      timezone: monthlyReports.timezone,
      version: monthlyReports.version,
      figures: monthlyReports.figures,
    })
    .from(monthlyReports)
    .orderBy(monthlyReports.tenantId, monthlyReports.periodStart, desc(monthlyReports.version));
}
