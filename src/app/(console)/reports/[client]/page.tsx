import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { TZDate } from '@date-fns/tz';

import { resolveBaseline } from '@/core/attribution/baseline';
import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';
import {
  formatReportDate,
  MISSED_CALL_EVIDENCE,
  MISSED_CALL_LIVE_FOOTNOTE,
  periodLabel,
} from '@/core/reporting/copy';
import type { ReportMissedCallsDocument } from '@/core/reporting/document';
import { monthlyFeeInForceOn, type FeeRow } from '@/core/reporting/fees';
import { formatCents, formatMultipleBp, formatRateBp } from '@/core/reporting/format';
import {
  computeTenantMetrics,
  LIVE_METRICS_WINDOW_DAYS,
  OPT_OUT_ALARM_BP,
  type TenantMetrics,
} from '@/core/reporting/metrics';
import { computeMissedCallFigures } from '@/core/reporting/missed-call-figures';
import {
  currentMonth,
  localDateString,
  previousMonth,
  rollingWindow,
} from '@/core/reporting/period';
import { formatInTenantZone, NO_VALUE } from '@/core/shared/tenant';
import { forTenant, REPORT_LIST_LIMIT } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { FeeScheduleForm } from './fee-schedule-form';
import { GenerateForm } from './generate-form';

export const metadata: Metadata = { title: 'Reports' };

/** Session-dependent, and the version list must never be a cached page. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE PER-CLIENT REPORTS PAGE (UI-SPEC Screen 2, D-13/D-14/D-15).
 *
 * Two instruments and a price list, in that order:
 *
 *   1. `Last 30 days` — the rolling metrics, added by 07-05 in the slot marked
 *      below. Deliberately ABOVE the monthly reports: it is the screen an
 *      operator opens to spot a client drifting, and the frozen reports are the
 *      thing they come here to produce once a month.
 *   2. `Monthly reports` — the Generate form and EVERY version ever generated
 *      (D-11), as ONE ROW PER MONTH with the month's earlier versions one tap
 *      away inside its disclosure. Nothing is deleted and nothing leaves the
 *      DOM: the document a client was actually sent is the one row somebody
 *      asking about their invoice needs to find, and it is still a link.
 *
 *      WHY IT WAS GROUPED. Every version used to be a top-level row, so a month
 *      that had merely been re-pressed read exactly like a month that had been
 *      corrected — three identical August rows say "something changed twice"
 *      to the only person who reads this screen. Generate is idempotent now
 *      (quick-260904-dfq), so the duplicates stop accumulating; the grouping is
 *      what makes the versions that DO exist mean something.
 *   3. `Fee schedule` — collapsed, because CHECKING the number is the common act
 *      and CHANGING it is rare (the `Replace key` argument, one route over). Its
 *      summary line carries the current fee so the common act costs no taps.
 *
 * ── ONE ERROR SENTENCE FOR THE WHOLE PAGE ───────────────────────────────────
 *
 * The three `forTenant()` reads share a single failure arm. They are one
 * question — "what does this client's reporting look like" — and three separate
 * apologies stacked on one screen would tell the operator less than one does,
 * while implying that the page half-worked. The caught value is discarded
 * (WR-08): a driver error names columns and policy internals and the operator
 * cannot act on any of it.
 *
 * THE ONE EXCEPTION IS THE MISSED-CALL BLOCK (Phase 15, D-03). It is a second
 * live instrument with its own six statements, read AFTER the arm above and in
 * its own `try`: a failed missed-call read costs that block one sentence, and
 * the quote metrics, the Generate form and every frozen version still render.
 */

/**
 * A report row WITHOUT its five frozen documents, derived from the read that
 * produces it rather than imported.
 *
 * `MonthlyReportSummary` is not on the repository barrel, and putting it there
 * to name a type on one page would widen a module boundary for a convenience.
 * Derived, this cannot drift from what `reports.list()` actually returns.
 */
type ReportRow = Awaited<ReturnType<ReturnType<typeof forTenant>['reports']['list']>>[number];

/**
 * ONE REPORT ROW'S CONTENTS — drawn identically whether it is the month's
 * newest version or one of the earlier ones inside its disclosure.
 *
 * EVERY LABEL COMES FROM THE ROW'S OWN FROZEN ZONE, not the tenant's current
 * one. A client who moved from Perth to Adelaide must not have last year's
 * report headings quietly restated.
 *
 * `hasEarlier` IS THE `latest` BADGE'S WHOLE PREDICATE. With one row per month
 * a badge on every row says nothing — `latest` is only information where there
 * is something for it to be latest OVER, which is a month that actually has
 * earlier versions. A superseded row inside a disclosure never gets it.
 */
function reportRow(tenantId: string, row: ReportRow, hasEarlier: boolean): ReactNode {
  const month = periodLabel(row.periodStart, row.timezone);

  // A report generated before its own month had ended. `period_end` is
  // EXCLUSIVE, so this compares the first day AFTER the period against the
  // local day it was generated on.
  const monthToDate = row.periodEnd > localDateString(row.generatedAt, row.timezone);

  return (
    <>
      <Link href={`/reports/${tenantId}/${row.id}`}>
        {month} — version {row.version}
      </Link>

      {hasEarlier ? <span className="badge">latest</span> : null}
      {monthToDate ? <span className="badge badge--warn">month to date</span> : null}

      <span className="muted touch-meta">
        generated {formatInTenantZone(row.generatedAt, row.timezone)} ({row.timezone})
      </span>
    </>
  );
}

/**
 * The fee-kind vocabulary, as a map that FAILS LOUDLY on an unknown member.
 *
 * Never a string rewrite of the stored member (house rule — no underscore
 * substitution, no title-casing): a vocabulary widened in the
 * database CHECK and not here would render `one_off_credit` on a page about
 * money, and the operator would read it as a bug in the amount beside it. A
 * throw is the honest answer — the page is wrong, and it says so.
 */
const FEE_KIND_LABELS: Record<FeeRow['kind'], string> = {
  monthly: 'Monthly retainer',
  setup: 'One-off setup fee',
};

function feeKindLabel(kind: string): string {
  const label = FEE_KIND_LABELS[kind as FeeRow['kind']];
  if (label === undefined) {
    throw new Error(`Unknown tenant_fees.kind: ${JSON.stringify(kind)}`);
  }
  return label;
}

/**
 * The summary line, always visible — CHECKING the retainer is the common act.
 *
 * `setupCents` is the SUM of every setup row in force, not the latest one, so
 * this line and the report's footnote 4 describe the same money (07 WR-09).
 */
function feeSummary(
  rows: readonly FeeRow[],
  today: string,
  setupCents: number | null,
): string {
  const monthly = monthlyFeeInForceOn(rows, today);

  if (monthly === null && setupCents === null) return 'Fee schedule — none recorded';

  const monthlySegment =
    monthly === null ? 'none recorded' : `${formatCents(monthly.amountCents)}/month`;
  const setupSegment = setupCents === null ? '' : ` · setup ${formatCents(setupCents)}`;

  return `Fee schedule — ${monthlySegment}${setupSegment}`;
}

/** ISO weekday order, Monday first — the order the block's arrays are in. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * `7 am`, `6 pm` — the clock hour as the tenant reads it, through `Intl` in the
 * tenant's zone over a fixed local date at that hour (UI-SPEC §3b). The date is
 * arbitrary — 5 January 2026, far from any DST transition — because the label
 * is the hour's name, not an instant.
 */
function hourLabel(hour: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hour12: true, timeZone }).format(
    new TZDate(2026, 0, 5, hour, 0, 0, timeZone),
  );
}

/**
 * THE LIVE MISSED-CALL BLOCK (Phase 15, RPT-04, D-03, D-10; UI-SPEC §3b).
 *
 * The figures come from `computeMissedCallFigures` — THE SAME PURE DERIVATION the
 * generator freezes into `figures.missedCalls` — over the calendar month to date
 * in the tenant's zone. So the block an operator reads mid-month and the block
 * printed on the month's report cannot disagree about how a number was made;
 * only about which calls had happened yet.
 *
 * EVERY RATE CARRIES ITS DENOMINATOR, and a figure with nothing to divide says
 * so in a fixed sentence: `—` with `no samples — …` under Text-back speed, never
 * a zero (D-10). Jobs from leads are COUNTED here and never valued — recovered
 * dollars stay a quotes figure.
 *
 * No chart: two plain tables, which a 390px phone and an A4 print both read.
 */
function MissedCallsLiveBlock({
  block,
  timezone,
}: {
  block: ReportMissedCallsDocument;
  timezone: string;
}) {
  const { afterHours, textBacks, replyRate, funnel } = block;

  // Clock order, hours with at least one call only. The block carries a total
  // per hour; the after-hours split is per weekday (see the summary's note).
  const hours = block.byHour
    .map((calls, hour) => ({ hour, calls }))
    .filter((row) => row.calls > 0);

  return (
    <>
      <dl className="metrics">
        <MetricRow
          label="Missed calls"
          value={String(block.captured)}
          evidence={
            block.captured === 0
              ? MISSED_CALL_EVIDENCE.none
              : `${afterHours.numerator} after hours · ${block.withheld} withheld`
          }
        />

        <MetricRow
          label="After hours"
          value={formatRateBp(afterHours.rateBp)}
          evidence={
            afterHours.rateBp === null
              ? MISSED_CALL_EVIDENCE.none
              : `${afterHours.numerator} of ${afterHours.denominator} calls`
          }
        />

        <MetricRow
          label="Text-back speed"
          value={
            textBacks.medianSeconds === null
              ? NO_VALUE
              : `median ${textBacks.medianSeconds} s · P90 ${textBacks.p90Seconds ?? NO_VALUE} s`
          }
          evidence={
            textBacks.medianSeconds === null
              ? MISSED_CALL_EVIDENCE.noSamples
              : plural(textBacks.delivered, 'delivered text-back')
          }
        />

        <MetricRow
          label="Reply rate"
          value={formatRateBp(replyRate.rateBp)}
          evidence={
            replyRate.rateBp === null
              ? MISSED_CALL_EVIDENCE.nothingDelivered
              : `${replyRate.numerator} of ${replyRate.denominator} delivered text-backs replied`
          }
        />

        <MetricRow
          label="Leads → jobs"
          value={
            funnel.leads === 0
              ? NO_VALUE
              : `${funnel.leads} → ${funnel.jobsCreated} → ${funnel.jobsWon}`
          }
          evidence={
            funnel.leads === 0
              ? MISSED_CALL_EVIDENCE.noLeads
              : `leads opened → jobs we created → of those, won · ${funnel.bookedByTradie} booked by the tradie`
          }
        />
      </dl>

      <p className="hint muted">{MISSED_CALL_LIVE_FOOTNOTE}</p>

      {block.captured === 0 ? (
        <p className="muted">No diverted calls this month.</p>
      ) : (
        <>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Missed calls by weekday">
            <table>
              <caption className="muted hint">By weekday, {timezone}</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">
                    Calls
                  </th>
                  <th scope="col" className="num">
                    After hours
                  </th>
                </tr>
              </thead>
              <tbody>
                {WEEKDAY_LABELS.map((day, index) => (
                  <tr key={day}>
                    <td>{day}</td>
                    <td className="num">{block.byIsoWeekday[index] ?? 0}</td>
                    <td className="num">{block.afterHoursByIsoWeekday[index] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-scroll" tabIndex={0} role="region" aria-label="Missed calls by hour">
            <table>
              <caption className="muted hint">By hour of day, {timezone}</caption>
              <thead>
                <tr>
                  <th scope="col">Hour</th>
                  <th scope="col" className="num">
                    Calls
                  </th>
                </tr>
              </thead>
              <tbody>
                {hours.map((row) => (
                  <tr key={row.hour}>
                    <td>{hourLabel(row.hour, timezone)}</td>
                    <td className="num">{row.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/**
 * One `dl.metrics` row: the value, an optional badge, and the evidence behind it.
 *
 * THE EVIDENCE IS NOT DECORATION. "7.1%" invites the operator to ring a client;
 * "7.1% (3 of 42 contacts messaged)" tells them whether it is worth the call.
 * A rate over a denominator of five is noise, and the only way to know that
 * from a screen is to be shown the five.
 */
function MetricRow({
  label,
  value,
  evidence,
  badge,
}: {
  label: string;
  value: string;
  evidence: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <>
      <dt>{label}</dt>
      {/* A FLEX ROW (`.metrics dd`): value, badge, evidence sit on one line
          where there is room and wrap UNDER the value on a phone. */}
      <dd>
        <span className="num">{value}</span>
        {badge}
        <span className="muted hint">{evidence}</span>
      </dd>
    </>
  );
}

export default async function ClientReportsPage({
  params,
}: {
  params: Promise<{ client: string }>;
}) {
  const { client } = await params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked BEFORE any query (the audit page's rule).
  if (!UUID_PATTERN.test(client)) {
    notFound();
  }

  const supabase = await createClient();

  // The AUTHENTICATED client, so the `tenants` policy decides visibility: a
  // client this operator is not a member of returns zero rows, indistinguishable
  // from one that does not exist.
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, timezone')
    .eq('id', client)
    .maybeSingle();

  if (error) {
    // A genuine failure is not a 404 — saying "not found" would send the
    // operator looking for a client that exists.
    console.error(`[reports] tenant read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Reports</h1>
        <p className="error" role="alert">
          Could not load this client&rsquo;s reports. Try again in a moment.
        </p>
        <p>
          <Link href="/reports">← Reports</Link>
        </p>
      </section>
    );
  }

  const tenant = data as { id: string; name: string; timezone: string } | null;
  if (!tenant) {
    notFound();
  }

  const now = new Date();
  const repo = forTenant(tenant.id);

  // The D-15 rolling window, from the constant the heading prints and the
  // overview passes to the same function — never a literal 30.
  const metricsWindow = rollingWindow(now, LIVE_METRICS_WINDOW_DAYS);

  let connectedAt: Date | null = null;
  let versions: Awaited<ReturnType<typeof repo.reports.list>> = [];
  let feeRowsRaw: Awaited<ReturnType<typeof repo.fees.list>> = [];
  let metrics: TenantMetrics | null = null;
  let baselineRateBp = 0;

  try {
    // FOUR READS, ONE AT A TIME PAST THE FIRST THREE. `windowCounts` is itself
    // nine statements (see its header), so folding it into the `Promise.all`
    // would put twelve queries in flight against a five-connection pool — the
    // deadlock recorded in `client.ts`.
    const [connection, reports, fees] = await Promise.all([
      repo.connection.get(),
      repo.reports.list(),
      repo.fees.list(),
    ]);

    connectedAt = connection[0]?.createdAt ?? null;
    versions = reports;
    feeRowsRaw = fees;

    // THE FOOTNOTE'S BASELINE COMES FROM THE SAME RESOLVER THE ATTRIBUTION
    // DECISION USES (D-08). A page that quoted a different percentage from the
    // one the money was computed under would be a document the client can
    // disprove against their own report.
    baselineRateBp = resolveBaseline({
      winRate: connection[0]?.baselineWinRate ?? null,
      quotesIssued: connection[0]?.baselineQuotesIssued ?? null,
    }).rateBp;

    metrics = computeTenantMetrics(await repo.metrics.windowCounts(metricsWindow), metricsWindow, now);
  } catch {
    // The caught value is discarded — see the header.
    console.error('[reports] client reports read failed');
    return (
      <section>
        <h1>{tenant.name}</h1>
        <p className="error" role="alert">
          Could not load this client&rsquo;s reports. Try again in a moment.
        </p>
        <p>
          <Link href="/reports">← Reports</Link>
        </p>
      </section>
    );
  }

  // ── THE MISSED-CALL BLOCK, MONTH TO DATE, IN ITS OWN TOLERATED ARM ────────
  //
  // Read after the arm above (never inside its `Promise.all` — `missedCallCounts`
  // is six statements against a five-connection pool) and in its own `try`: a
  // failure costs this block one sentence, not the page. The caught value is
  // discarded (WR-08, T-2-02).
  const monthToDate = currentMonth(tenant.timezone, now);
  let missedCallFigures: ReportMissedCallsDocument | null = null;
  try {
    missedCallFigures = computeMissedCallFigures(
      await repo.metrics.missedCallCounts(monthToDate, tenant.timezone),
    );
  } catch {
    console.error('[reports] missed-call figures read failed');
  }

  const today = localDateString(now, tenant.timezone);
  const currentYear = Number(today.slice(0, 4));

  // The lower bound of the year select is the year we CONNECTED: a month before
  // that is refused by the generator anyway, and offering it would make the
  // operator discover the rule by being told no.
  const firstYear = connectedAt === null
    ? currentYear
    : Number(localDateString(connectedAt, tenant.timezone).slice(0, 4));

  const years: number[] = [];
  for (let year = Math.min(firstYear, currentYear); year <= currentYear; year += 1) {
    years.push(year);
  }

  // U-5: the month an operator invoices for is the one that just closed.
  const defaultPeriod = previousMonth(tenant.timezone, now);
  const defaultStart = localDateString(defaultPeriod.start, tenant.timezone);
  const defaultYear = Number(defaultStart.slice(0, 4));
  const defaultMonth = Number(defaultStart.slice(5, 7));

  // The default month can predate the connection (a client connected this
  // month). The select still offers it — the refusal explains why, once — but
  // the year must be selectable or the form cannot render its own default.
  if (!years.includes(defaultYear)) years.unshift(defaultYear);

  // `FeeRow` is what the pure RULE needs; `id` and `note` ride along because the
  // LIST renders them. One array, so the row the rule picks is the same OBJECT
  // the list renders — which is how the `in force` badge is matched below
  // without re-running the rule per item.
  const feeRows: Array<FeeRow & { id: string; note: string | null }> = feeRowsRaw.map((row) => ({
    id: row.id,
    note: row.note,
    kind: row.kind as FeeRow['kind'],
    amountCents: row.amountCents,
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
  }));

  // ── THE SUMMARY MUST DESCRIBE WHAT THE REPORT CHARGES (07 WR-09) ─────────
  //
  // This used to show the single most recent setup row, while `feesInForce`
  // SUMS every setup row whose `effective_from` falls inside the period — and
  // that sum is what `figures.feesSetupCents` and footnote 4 print. A client
  // with two setup lines saw `setup $990.00` on the operator's screen and "a
  // one-off $1,980.00 setup fee" on the document they were sent: the
  // two-screens-disagree failure this phase is otherwise careful about, in the
  // one place where the operator is checking the number before it goes out.
  //
  // Summed to TODAY rather than over a report period, because this line
  // describes the schedule as it currently stands and there is no period on
  // this screen. `null` (never `$0.00`) is "nothing recorded" — a recorded
  // $0.00 setup fee is a fact, and the sum of no rows is not.
  const setupTotalToday = feeRowsRaw
    .filter((row) => row.kind === 'setup' && row.effectiveFrom <= today)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const hasSetupToday = feeRowsRaw.some((row) => row.kind === 'setup' && row.effectiveFrom <= today);
  const latestSetupCents = hasSetupToday ? setupTotalToday : null;

  // THE ROW THE REPORT WOULD DIVIDE BY TODAY, resolved through the same pure
  // rule the generator uses — so the `in force` badge and the multiple on a
  // report generated this minute cannot point at different rows.
  const inForceRow = monthlyFeeInForceOn(feeRows, today);

  /**
   * The versions of each month, newest month first — ONE ROW PER MONTH.
   *
   * `reports.list()` returns `period_start DESC, version DESC`, so a single pass
   * over it gives the months in order for free (a `Map` iterates in insertion
   * order). THE NEWEST VERSION IS PICKED BY `Math.max`, NOT BY POSITION: the
   * ordering is a promise the repository makes, and this row is the one the
   * operator opens — picking it by a maximum is what keeps it right on the day
   * that promise moves, at the cost of one comparison per row.
   */
  const monthVersions = new Map<string, typeof versions>();
  for (const row of versions) {
    const seen = monthVersions.get(row.periodStart);
    if (seen === undefined) monthVersions.set(row.periodStart, [row]);
    else seen.push(row);
  }

  return (
    <section>
      <p className="muted">
        <Link href="/reports">← Reports</Link>
      </p>

      <h1>
        {tenant.name}{' '}
        <span className="muted zone-note">times in {tenant.timezone}</span>
      </h1>
      <p className="muted meta">Reports &amp; metrics</p>

      {/* ── THE ROLLING INSTRUMENT (RPT-03, D-15), ABOVE THE FROZEN ONE ──
          The window is measured from the same constant and computed by the
          same `computeTenantMetrics` the `/reports` overview calls, over
          equivalent counts — so this client's five numbers here and their row
          there cannot disagree. NO `metrics === null` GUARD HERE: every path
          that leaves it null has already returned from the catch above, so the
          branch was unreachable and read as though a null were expected. */}
      <h2>Last {LIVE_METRICS_WINDOW_DAYS} days</h2>
      <p className="muted hint">
        Rolling window ending now. These numbers move every day; the monthly reports below do
        not.
      </p>

      <dl className="metrics">
        <MetricRow
          label="First touch within 24h"
          value={formatRateBp(metrics.firstTouch.rateBp)}
          evidence={
            metrics.firstTouch.rateBp === null
              ? 'no quotes opened in the window'
              : `${metrics.firstTouch.numerator} of ${metrics.firstTouch.denominator} quotes opened`
          }
        />

        <MetricRow
          label="Reply rate"
          value={formatRateBp(metrics.reply.rateBp)}
          evidence={
            metrics.reply.rateBp === null
              ? 'nothing sent in the window'
              : `${metrics.reply.numerator} of ${metrics.reply.denominator} quotes messaged`
          }
        />

        <MetricRow
          label="Opt-out rate"
          value={formatRateBp(metrics.optOut.rateBp)}
          /* THE SAME `isOptOutAlarming` THE OVERVIEW BADGE AND THE 06:30
             DIGEST LINE FIRE ON, reached through `optOut.alarming`, and the
             text derived from the threshold rather than typed. It NAGS: no
             cadence is paused, stopped or edited by this badge (D-16). */
          badge={
            metrics.optOut.alarming ? (
              <span className="badge badge--error">above {OPT_OUT_ALARM_BP / 100}%</span>
            ) : null
          }
          evidence={
            metrics.optOut.rateBp === null
              ? 'nothing sent in the window'
              : `${metrics.optOut.numerator} of ${metrics.optOut.denominator} contacts messaged`
          }
        />

        <MetricRow
          label="Human-edit rate"
          value={formatRateBp(metrics.humanEdit.rateBp)}
          evidence={
            metrics.humanEdit.rateBp === null
              ? 'no messages approved in the window'
              : `${metrics.humanEdit.numerator} of ${metrics.humanEdit.denominator} approved · mean edit ${formatRateBp(metrics.humanEdit.meanEditDistanceBp)}`
          }
        />

        <MetricRow
          label="Recovery multiple"
          value={formatMultipleBp(metrics.recovery.multipleBp)}
          evidence={
            metrics.recovery.feesCents === null ? (
              /* THE NULL TEXT IS A LINK, because the fix is on this page:
                 the disclosure below carries the `Add a fee` form. An em
                 dash that only said "no fee schedule" would leave the
                 operator to find it. */
              <>
                no fee schedule — <a href="#fee-schedule">add one below</a>
              </>
            ) : (
              `${formatCents(metrics.recovery.conservativeCents)} recovered ÷ ${formatCents(metrics.recovery.feesCents)} fees`
            )
          }
        />

        <MetricRow
          label="Escalation speed"
          value={
            metrics.escalation.medianMinutes === null
              ? NO_VALUE
              : `median ${metrics.escalation.medianMinutes} min`
          }
          evidence={
            metrics.escalation.count === 0
              ? 'no hot leads in the window'
              : `${metrics.escalation.count} hot lead${metrics.escalation.count === 1 ? '' : 's'} escalated`
          }
        />
      </dl>

      {/* EVERY NUMBER IN THIS PARAGRAPH IS INTERPOLATED FROM THE VALUE THAT
          PRODUCED THE FIGURES ABOVE (the constants module, and the same
          `resolveBaseline` the attribution decision runs). A methodology
          note that disagrees with its own arithmetic is worse than none. */}
      <p className="muted hint">
        Opt-outs count every STOP, unsubscribe and confirmed soft opt-out against contacts we
        messaged. The recovery multiple divides conservative recovered value (jobs won within{' '}
        {ATTRIBUTION_WINDOW_DAYS} days of a sent follow-up, less the {baselineRateBp / 100}% you
        were already winning) by the retainer in force, pro-rated to the window. First-touch
        excludes quotes opened before this client was ready to send.
      </p>

      {/* ── THE SECOND LIVE INSTRUMENT (Phase 15, D-03): above the frozen
          reports it previews. */}
      <h2>
        Missed calls{' '}
        <span className="muted zone-note">
          {periodLabel(localDateString(monthToDate.start, tenant.timezone), tenant.timezone)} to
          date
        </span>
      </h2>
      <p className="muted hint">
        Calendar month so far, in {tenant.timezone} — the same figures the monthly report will
        freeze. Every rate shows the numbers it was divided from.
      </p>

      {missedCallFigures === null ? (
        <p className="error" role="alert">
          Could not load the missed-call figures. Try again in a moment.
        </p>
      ) : (
        <MissedCallsLiveBlock block={missedCallFigures} timezone={tenant.timezone} />
      )}

      <h2>Monthly reports</h2>
      <p className="muted hint">
        Each report is a frozen calendar month in {tenant.timezone}. Generating again makes a new
        version only if the figures or lines changed, and keeps every earlier one.
      </p>

      <GenerateForm
        tenantId={tenant.id}
        years={years}
        defaultMonth={defaultMonth}
        defaultYear={defaultYear}
      />

      {/* A CAPPED LIST HAS TO SAY WHAT IS CAPPED, AND IT IS NOT MONTHS.
          `reports.list()` caps VERSIONS — at most `REPORT_LIST_LIMIT` rows,
          ordered before they are limited — and the grouping above happens
          AFTERWARDS. So the first thing to fall off the end is the oldest
          month's OLDEST versions, and a month rendering `version 3` with an
          empty disclosure would otherwise read as though 1 and 2 were never
          generated. The predicate stays on `versions.length` for the same
          reason: it is versions the repository counted. Ten years of monthly
          versions, so this renders essentially never — which is exactly why it
          must not be left to be noticed at the moment it first binds. */}
      {versions.length === REPORT_LIST_LIMIT ? (
        <p className="muted hint">
          Showing the most recent {REPORT_LIST_LIMIT} report versions, grouped by month. Older
          versions are not listed — the oldest month shown may be missing earlier versions, and
          months before it are not shown.
        </p>
      ) : null}

      {versions.length === 0 ? (
        <p className="muted">No monthly reports yet. Generate the first one above.</p>
      ) : (
        <ul className="touch-list">
          {[...monthVersions.values()].map((rows) => {
            // BY MAXIMUM, NOT BY POSITION — see `monthVersions` above.
            const newest = rows.reduce((best, row) => (row.version > best.version ? row : best));
            const earlier = rows
              .filter((row) => row !== newest)
              .sort((a, b) => b.version - a.version);

            return (
              <li key={newest.id}>
                {reportRow(tenant.id, newest, earlier.length > 0)}

                {/* SUPERSEDED, NEVER HIDDEN (D-11). Every earlier version is
                    rendered in the DOM as a working link — a native
                    disclosure element, the fee schedule's pattern, so this
                    costs no client island and no JavaScript. The document a
                    client was
                    actually sent is the one row somebody asking about their
                    invoice needs to find, and collapsing it is not the same as
                    losing it. No `id` here: the fee disclosure carries one
                    because a link targets it, and nothing targets these. */}
                {earlier.length > 0 ? (
                  <details className="disclosure">
                    <summary>
                      show {earlier.length} earlier version{earlier.length === 1 ? '' : 's'}
                    </summary>

                    <ul className="touch-list">
                      {earlier.map((row) => (
                        <li key={row.id}>{reportRow(tenant.id, row, false)}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* COLLAPSED, AND THE SUMMARY CARRIES THE ANSWER. Checking the retainer is
          the common act; changing it is rare and append-only. Task 3 fills the
          rows and the `Add a fee` form inside. */}
      <details className="disclosure" id="fee-schedule">
        <summary>{feeSummary(feeRows, today, latestSetupCents)}</summary>

        {feeRows.length === 0 ? (
          <p className="muted">
            No fees recorded. The monthly report cannot show a multiple until a monthly fee is in
            force.
          </p>
        ) : (
          <ul className="touch-list">
            {feeRows.map((row) => (
              <li key={row.id}>
                <span>{feeKindLabel(row.kind)}</span>
                <span className="num">{formatCents(row.amountCents)}</span>
                {/* THE ONLY `--ok` BADGE THIS PHASE, on the one row that is
                    actually being charged today. `feesInForce` picks it by the
                    same rule the report's denominator uses, so the badge and
                    the multiple cannot disagree. */}
                {inForceRow === row ? (
                  <span className="badge badge--ok">in force</span>
                ) : null}
                <span className="muted touch-meta">
                  from {formatReportDate(row.effectiveFrom, tenant.timezone)}
                  {row.note ? ` · ${row.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        <FeeScheduleForm tenantId={tenant.id} />
      </details>
    </section>
  );
}
