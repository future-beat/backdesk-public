import type { Metadata } from 'next';
import Link from 'next/link';

import { formatMultipleBp, formatRateBp } from '@/core/reporting/format';
import {
  computeTenantMetrics,
  LIVE_METRICS_WINDOW_DAYS,
  OPT_OUT_ALARM_BP,
  sortForOverview,
  type Rate,
} from '@/core/reporting/metrics';
import { rollingWindow } from '@/core/reporting/period';
import { NO_VALUE } from '@/core/shared/tenant';
import { forAllTenants_reportMetrics } from '@/db/repository';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../_auth';
import { ExportCsvForm } from './export-csv-form';
import { EXPORT_HINT } from './export-state';

export const metadata: Metadata = { title: 'Reports' };

/** Live numbers over a window ending NOW — never cached, never static. */
export const dynamic = 'force-dynamic';

/**
 * WHICH CLIENT IS DRIFTING (RPT-03, UI-SPEC Screen 1, D-14/D-15/D-16).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OPERATOR'S INSTRUMENT PANEL. Five metrics for every client, side by  │
 * │ side, over one rolling 30-day window — the numbers that say whether the  │
 * │ service is keeping its promises BEFORE a client has to say it isn't.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── SERVICE-ROLE READ BEHIND AN EXPLICIT OPERATOR GATE ─────────────────────
 *
 * `forAllTenants_reportMetrics` goes through `getDb()`, where RLS is inert by
 * design, so no policy protects this page. `requireOperator()` does, and it runs
 * BEFORE the read — the inbox's rule (CR-01): a session proves somebody signed
 * in, not that they may see every client's numbers on one screen.
 *
 * ── ONE ROUND TRIP, NOT FIFTEEN ────────────────────────────────────────────
 *
 * The accessor groups in SQL. A per-client loop would be fifteen clients × five
 * metrics on a page the operator opens on a phone between meetings, and the
 * fifteenth client's row would be the one that never arrived.
 *
 * ── AND THE DERIVATION IS NOT HERE ─────────────────────────────────────────
 *
 * Every rate on this screen comes from `computeTenantMetrics`, the same
 * function `/reports/[client]` calls over the same contract. Not one division
 * happens in this file. The `above 5%` badge fires on `optOut.alarming`, which
 * is `isOptOutAlarming` — the ONE predicate the detail page and the 06:30
 * digest also carry. Three surfaces cannot disagree about a client's opt-out
 * rate, because there is only one place that decides.
 *
 * ── NO TIMESTAMPS, NO SORT CONTROLS, NO PAGINATION ─────────────────────────
 *
 * No "as at" line: the clients on this table live in different zones and a
 * single timestamp would be wrong for most of them (the per-client page carries
 * the zone). No column sorting: the order IS the message — alarmed first, then
 * alphabetical (U-6) — and a sortable table invites the operator to re-sort away
 * the thing the screen exists to show them. No pagination: fifteen rows is one
 * screen.
 */

/** `Another client` rather than a bare uuid — the inbox's `nameOf` precedent. */
function displayName(name: string): string {
  return name.trim() === '' ? 'Another client' : name;
}

/**
 * One metric cell: the rate, and the two numbers it came from underneath.
 *
 * The evidence line is OMITTED for a null denominator rather than rendered as
 * `(0/0)`. `—` already says "there is nothing to measure"; a zero-over-zero
 * beside it reads as a computed result and invites the operator to wonder which
 * of the two numbers is broken.
 */
function MetricCell({ rate, badge }: { rate: Rate; badge?: React.ReactNode }) {
  return (
    <td className="num">
      {formatRateBp(rate.rateBp)}
      {badge}
      {rate.rateBp === null ? null : (
        <>
          <br />
          <span className="muted hint">
            ({rate.numerator}/{rate.denominator})
          </span>
        </>
      )}
    </td>
  );
}

export default async function ReportsOverviewPage() {
  const access = await requireOperator();
  if (access !== 'ok') {
    return (
      <section>
        <h1>Reports</h1>
        <p className="error" role="alert">
          {OPERATOR_DENIED_MESSAGE[access]}
        </p>
      </section>
    );
  }

  const now = new Date();
  // THE CONSTANT, never a literal 30. The same one the hint below prints and
  // the digest line quotes, so "last 30 days" cannot come to mean two windows.
  const window = rollingWindow(now, LIVE_METRICS_WINDOW_DAYS);

  let rows;
  try {
    const counts = await forAllTenants_reportMetrics(window);
    rows = sortForOverview(counts.map((row) => computeTenantMetrics(row, window, now)));
  } catch {
    // The caught value is DELIBERATELY DISCARDED (WR-08, T-2-02): a postgres
    // error from this query can carry the predicate, and the predicate names
    // customer columns. The operator cannot act on any of it either way.
    console.error('[reports] overview read failed');
    return (
      <section>
        <h1>Reports</h1>
        <p className="error" role="alert">
          Could not load reports. Try again in a moment.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="row">
        <h1>Reports</h1>
      </div>

      <p className="hint muted">
        Last {LIVE_METRICS_WINDOW_DAYS} days, rolling, across every client — the screen for spotting
        who is drifting. Monthly reports are frozen calendar months: open a client to generate one.
      </p>

      {rows.length === 0 ? (
        <p className="muted">
          No clients yet. <Link href="/clients/new">Create the first one</Link>.
        </p>
      ) : (
        /* SIDEWAYS SCROLL INSIDE THE BOX, never a wider `main` — the quotes
           table's rule (02-05, 8de755c; the client list on `/` only got its box in
           07-07, G-07-6, having been cited as the precedent for years without
           ever having one). Seven columns do not fit a 390px phone, and widening
           the page would push the nav's sign-out off the right edge. */
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Client metrics">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th className="num">First touch &lt;24h</th>
                <th className="num">Replies</th>
                <th className="num">Opt-outs</th>
                <th className="num">Edited</th>
                <th className="num">Multiple</th>
                <th className="num">Missed calls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tenantId}>
                  {/* NOT `.cell-truncate`. A job description truncates because
                      the operator scans past it; a client name is the thing
                      they are looking for, and half of one is not findable. */}
                  <td>
                    <Link href={`/reports/${row.tenantId}`}>{displayName(row.tenantName)}</Link>
                  </td>

                  <MetricCell rate={row.firstTouch} />
                  <MetricCell rate={row.reply} />
                  <MetricCell
                    rate={row.optOut}
                    badge={
                      row.optOut.alarming ? (
                        // TEXT FIRST, COLOUR SECOND (WCAG 1.4.1) — and the text
                        // is DERIVED from the threshold, so the badge cannot
                        // come to say 5% while the predicate means something
                        // else.
                        <span className="badge badge--error">
                          above {OPT_OUT_ALARM_BP / 100}%
                        </span>
                      ) : null
                    }
                  />
                  <MetricCell rate={row.humanEdit} />

                  {/* `—` + `no fees`, never `0.0×`: a client with no fee
                      schedule has no multiple, and a zero would accuse a
                      working service of failing. */}
                  <td className="num">
                    {formatMultipleBp(row.recovery.multipleBp)}
                    {row.recovery.feesCents === null ? (
                      <>
                        <br />
                        <span className="muted hint">no fees</span>
                      </>
                    ) : null}
                  </td>

                  {/* MISSED CALLS, OVER THE SAME ROLLING WINDOW (Phase 15,
                      UI-SPEC §3a). A client without an active divert has
                      nothing to count, so it gets the dash and says why; a
                      client with one and no calls shows `0`, because there the
                      zero is a measurement. Counts only: no caller reaches this
                      page. */}
                  <td className="num">
                    {row.missedCalls.hasDivertNumber ? (
                      <>
                        {row.missedCalls.count}
                        <br />
                        <span className="muted hint">
                          {row.missedCalls.afterHours} after hours
                        </span>
                      </>
                    ) : (
                      <>
                        {NO_VALUE}
                        <br />
                        <span className="muted hint">no divert number</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* THE DESIGN-PARTNER CSV (Phase 15, RPT-05, D-04). Below the table,
          rendered with or without clients: a header-only file is still the
          column shape the sales deck needs first (D-10). The island owns the
          download; the action owns the gate and the read. */}
      <section id="design-partner-export">
        <h2>Design-partner export</h2>
        <p className="hint muted">{EXPORT_HINT}</p>
        <ExportCsvForm />
      </section>
    </section>
  );
}
