import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';
import { ABN_DISPLAY, SERVICE_NAME, footerIdentityLine } from '@/core/brand';
import { parseReportDocument, type ReportMissedCallsDocument } from '@/core/reporting/document';
import {
  followUpRange,
  formatReportDate,
  methodologyNotes,
  NO_SAMPLES_LABEL,
  periodLabel,
  shortDate,
} from '@/core/reporting/copy';
import { formatCents, formatMultipleBp } from '@/core/reporting/format';
import { localDateString } from '@/core/reporting/period';
import { NO_VALUE } from '@/core/shared/tenant';
import { forTenant } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import './report.css';
import { PrintButton } from './print-button';

export const metadata: Metadata = { title: 'Monthly report' };

/** Session-dependent — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `#4201 · Switchboard upgrade…` — what the Job cell reads, and what its `title`
 * carries when the print/screen clip hides the tail. Pure: both halves are
 * already frozen on the row.
 */
function jobLabel(line: { generatedJobId: string | null; jobDescription: string | null }): string {
  const id = `#${line.generatedJobId ?? NO_VALUE}`;
  return line.jobDescription ? `${id} · ${line.jobDescription}` : id;
}

/**
 * THE DOCUMENT THAT GETS STAPLED TO AN INVOICE (RPT-02, D-11/D-12/D-13).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ RENDER-FROM-THE-ROW. This page computes NOTHING. Every number, label,     │
 * │ footnote value and constant below is read out of the frozen               │
 * │ `monthly_reports` row. There is no aggregation import here — no           │
 * │ `figures`, no `fees`, no `metrics`, no `generate` — and                   │
 * │ `tests/monthly-report.test.ts` asserts their absence as a source scan.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The reason is the product's promise, not tidiness: the PDF a client received
 * in September must still, in February, be the document they were handed, while
 * every input it was computed from keeps moving underneath it. ServiceM8 job
 * values get edited, baselines get re-measured, fee schedules change. A page
 * that recomputed would quietly restate a figure the client already checked
 * against their own account — and the first time they noticed would be the last
 * month they trusted the number.
 *
 * ── THE ID ALONE NEVER SELECTS ACROSS TENANTS (T-7-17) ──────────────────────
 *
 * Both params are uuid-checked before any query, the client is authorized
 * through the operator's OWN JWT against `tenants`, and the report is then read
 * with `forTenant(tenantId).reports.byId(reportId)` — which pins `tenant_id`
 * alongside the id. A report belonging to another client returns `[]` and this
 * page 404s, indistinguishably from one that does not exist.
 *
 * ── NO SPINNER, NO SKELETON (E4/E6) ─────────────────────────────────────────
 *
 * Server-rendered whole. A document that assembles itself in front of the
 * operator is a document they screenshot mid-assembly; this one either arrives
 * or 404s.
 */
export default async function MonthlyReportPage({
  params,
}: {
  params: Promise<{ client: string; reportId: string }>;
}) {
  const { client, reportId } = await params;

  // BOTH params, before any query: Postgres raises 22P02 on a malformed uuid
  // rather than returning no rows.
  if (!UUID_PATTERN.test(client) || !UUID_PATTERN.test(reportId)) {
    notFound();
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', client)
    .maybeSingle();

  if (error) {
    // The caught code goes to the log, never to the page (WR-08, T-2-02).
    console.error(`[reports] tenant read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Monthly report</h1>
        <p className="error" role="alert">
          Could not load this client&rsquo;s reports. Try again in a moment.
        </p>
        <p>
          <Link href={`/reports/${client}`}>← Reports</Link>
        </p>
      </section>
    );
  }

  const tenant = data as { id: string; name: string } | null;
  if (!tenant) {
    notFound();
  }

  const [row] = await forTenant(tenant.id).reports.byId(reportId);
  if (!row) {
    notFound();
  }

  // THE READ EDGE. A row that cannot describe itself throws here rather than
  // rendering `undefined` into a document somebody sends a client.
  const report = parseReportDocument(row);

  const monthLabel = periodLabel(report.periodStart, report.timezone);
  const preparedLabel = formatReportDate(report.generatedAt, report.timezone);
  const figures = report.figures;

  const money = (cents: number) => formatCents(cents);

  /**
   * THE PAGE'S ONE AND ONLY USE OF THE CONSTANTS MODULE (UI-SPEC mandate).
   *
   * It compares, and it never computes. A report generated under a 30-day
   * attribution window and read after D-01 moves to 45 still prints 30 in its
   * own footnote — because the footnote reads `row.constants`. What the
   * operator needs to know, and the client does not, is that the rule has since
   * changed; that is a screen-only banner, and the sheet below it is untouched.
   */
  const windowMismatch = report.constants.attributionWindowDays !== ATTRIBUTION_WINDOW_DAYS;

  /**
   * A REPORT FOR A MONTH THAT HAD NOT FINISHED. `period_end` is EXCLUSIVE, so
   * this compares the first day AFTER the period against the local day it was
   * generated on. The row is still frozen — it is simply frozen mid-month, and
   * the document has to say so in both media.
   */
  const monthToDate = report.periodEnd > localDateString(report.generatedAt, report.timezone);

  /** Every line whose dollar figure could not be read (Pitfall 8). */
  const missingValueLines = report.lines.filter((line) => line.valueSource === 'missing');

  /**
   * IS THERE A NEWER VERSION OF THIS MONTH?
   *
   * Read, and NEVER acted on: this page does not redirect. An older version is
   * the document a client was actually sent, and bouncing somebody who followed
   * a link to it — from an email, from their own records — to a corrected one
   * would answer a different question from the one they asked.
   */
  // A TARGETED READ, NOT A SCAN OF `reports.list()` (07 WR-05). That list is
  // capped at `REPORT_LIST_LIMIT`, so once the cap binds an old month drops off
  // it, the scan finds no sibling, and this banner silently stops firing on
  // exactly the superseded reports it exists for. Asking for the newest version
  // of ONE month cannot go stale that way.
  const [newest] = await forTenant(tenant.id).reports.latestVersionOf(report.periodStart);
  const latestVersion = newest === undefined ? report.version : Math.max(newest.version, report.version);

  return (
    <>
      {/* PREFETCH OFF, AND THIS IS THE LINK THE DIAGNOSIS ACTUALLY BLAMES
          (07-07 review, WR-02). It is above the fold, so its viewport-triggered
          prefetch is in flight during exactly the seconds after hydration when
          the print button first works — the state in which WebKit's
          `window.print()` defers silently (G-07-4). The version link further
          down is off by default for the same reason; two links on an
          operator-only route lose nothing measurable by not prefetching. */}
      <p className="muted report-backlink">
        <Link href={`/reports/${tenant.id}`} prefetch={false}>
          ← {tenant.name}
        </Link>
      </p>

      {/* SCREEN-ONLY WARNINGS, ABOVE THE SHEET AND NEVER INSIDE IT. Both are
          operator context about a document that is already what it is — the
          printed artifact below is unchanged by either. */}
      {windowMismatch ? (
        <section className="banner-error" role="alert">
          <h2>This report was computed under a different rule.</h2>
          <p>
            It uses a {report.constants.attributionWindowDays}-day attribution window; today&rsquo;s
            constant is {ATTRIBUTION_WINDOW_DAYS} days. The figures below are the ones the client
            was sent and are unchanged.
          </p>
        </section>
      ) : null}

      {missingValueLines.map((line) => (
        <p className="muted hint report-screen-note" key={`missing-${line.attributionId}`}>
          Job #{line.generatedJobId ?? NO_VALUE} has no value — add it to the invoice by hand if
          it should count.
        </p>
      ))}

      <section className="report-sheet">
        {/* THE LETTERHEAD (logo v2, 19 Sep 2026). Above the title, because this
            is the sheet stapled to an invoice and the only thing on it that
            said who produced it was the identity line at the foot.

            BOTH drawings, exactly one displayed — `report.css` switches them
            with `display`, not `<picture>`. Measured through Chrome's real
            print path: a `<picture>` scoped on `prefers-color-scheme` alone
            prints the PAPER lockup from a dark-mode phone, i.e. a white
            wordmark on white paper, on the page a paying client reads. The note
            on `.report-lockup` has the rest of it.

            Both carry the same alt: whichever is displayed is the one a screen
            reader sees, and the other is `display: none` and so out of the
            accessibility tree entirely.

            `no-img-element` IS DISABLED HERE, TWICE, AND THE RULE IS WRONG
            ABOUT THIS CASE. It fires because these two are bare <img> rather
            than children of a <picture> (which is why the nav and the marketing
            header do not trip it). Its advice — `next/image` — would put an
            optimiser in front of a committed, exactly-sized PNG with nothing
            left to optimise, and would emit its own `srcset`, which is the one
            thing that must not happen on a page whose printed size is set in
            millimetres against a legal minimum. */}
        <div className="report-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="report-lockup-light"
            src="/brand/lockup-graphite-transparent.png"
            alt={SERVICE_NAME}
            width={147}
            height={28}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="report-lockup-dark"
            src="/brand/lockup-paper-transparent.png"
            alt={SERVICE_NAME}
            width={147}
            height={28}
          />
        </div>

        <h1>Quote follow-up report — {tenant.name}</h1>

        <p className="muted report-subline">
          {monthLabel}
          {/* THE MEDIUM SWITCH. On screen the badge says it; on paper the badge
              is gone, so the period text has to carry the same fact — a printed
              report for an unfinished month that looked like a whole one is a
              document the client would reconcile against a full month. */}
          {monthToDate ? (
            <span className="report-print-only">
              {' '}
              to {shortDate(report.generatedAt, report.timezone)}
            </span>
          ) : null}{' '}
          · prepared {preparedLabel} · version {report.version}{' '}
          {monthToDate ? (
            <span className="badge badge--warn report-screen-note">month to date</span>
          ) : null}
        </p>

        {/* THE HERO, and the only accent-coloured element inside the printed
            region. The conservative figure is the headline because it is the
            one the client can defend to themselves; the gross multiple sits
            beside it in 14px rather than competing with it. */}
        <dl className="report-hero">
          <dt>Return on fees</dt>
          <dd>{formatMultipleBp(figures.multipleConservativeBp)}</dd>
          {/* A SECOND `dd` FOR THE SAME `dt`, not a `<p>`: a paragraph is not a
              legal child of a `dl`, and two descriptions of one term is exactly
              what these are — the number and the qualification of the number. */}
          <dd className="muted report-hero-note">
            on the conservative figure · {formatMultipleBp(figures.multipleGrossBp)} on gross
          </dd>
        </dl>

        <dl className="report-figures">
          <div className="report-figure">
            <dt>Quotes chased</dt>
            <dd>{figures.quotesChased}</dd>
          </div>

          <div className="report-figure">
            <dt>Replies</dt>
            <dd>{figures.replies}</dd>
          </div>

          <div className="report-figure">
            <dt>Jobs won</dt>
            <dd>
              {figures.jobsWonAttributed}
              {/* PRINTED BESIDE OUR NUMBER, DELIBERATELY (D-13). A document
                  claiming four wins to a client whose own account shows eleven
                  reads as a lie about their business rather than as a claim
                  about ours. Rendered only when the two differ. */}
              {figures.jobsWonTotal > figures.jobsWonAttributed ? (
                <span className="muted report-figure-note">
                  of {figures.jobsWonTotal} won in the month
                </span>
              ) : null}
            </dd>
          </div>

          <div className="report-figure">
            <dt>Recovered — conservative</dt>
            <dd>{money(figures.conservativeCents)}</dd>
          </div>

          <div className="report-figure">
            <dt>Recovered — gross</dt>
            <dd>{money(figures.grossCents)}</dd>
          </div>

          <div className="report-figure">
            <dt>Fees this month</dt>
            <dd>
              {figures.feesMonthlyCents === null ? NO_VALUE : money(figures.feesMonthlyCents)}
            </dd>
          </div>
        </dl>

        {/* OPTIONAL, AND ONLY FROM THE ROW (D-03, D-11). A report frozen before
            Phase 15 carries no block, so this renders nothing and the document
            is byte-identical to the one the client was sent. */}
        {figures.missedCalls === undefined ? null : (
          <MissedCallsSheetBlock block={figures.missedCalls} />
        )}

        {report.lines.length === 0 ? (
          // DONE ≠ MISSING. The figures above still render ($0.00, 0.0×) — a
          // month with a real fee and nothing recovered is a bad month, honestly
          // reported, and blanking the page would look like a broken report
          // rather than a quiet one.
          <p className="muted">No jobs were recovered in {monthLabel}.</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Jobs recovered">
            <table className="report-lines">
              <caption>Jobs recovered in {monthLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Won</th>
                  <th scope="col">Follow-ups</th>
                  <th scope="col">Replies</th>
                  <th scope="col" className="num">
                    Gross
                  </th>
                  <th scope="col" className="num">
                    Conservative
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => (
                  <tr key={line.attributionId}>
                    {/* ONE LINE BOX, AND THE SEPARATOR IS A LITERAL STRING.
                        The description is frozen at 60 code points plus an
                        ellipsis at generation; `.cell-truncate` (the pattern the
                        clients page already uses) then holds the id and the
                        description on a single clipped line with the whole text
                        in `title`. A one-line row is the only row either print
                        engine promises not to split at a fold (07-06, G-07-2) —
                        so this cell does depend on CSS clipping, deliberately.
                        The separator below is an explicit string expression
                        because JSX strips the newline whitespace between the
                        `#{id}` text and a sibling element, which is exactly how
                        `#4201Switchboard…` shipped. */}
                    <td>
                      <span className="cell-truncate" title={jobLabel(line)}>
                        #{line.generatedJobId ?? NO_VALUE}
                        {line.jobDescription ? (
                          <span className="muted">
                            {' · '}
                            {line.jobDescription}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    {/* NOWRAP IN PRINT, like every cell but the next one. A
                        first name is the column least able to spend width, and
                        letting it wrap traded a silent two-line row — which
                        WebKit will split at a fold — for pixels the Job cell
                        needed more (07-06 review, CR-01). Over-budget now shows
                        up as a `tableFits` failure in the harness instead. */}
                    <td>{line.contactFirstName ?? NO_VALUE}</td>
                    <td>{shortDate(line.wonDetectedAt, report.timezone)}</td>
                    {/* The remaining pressure valve — see `.report-softwrap`. */}
                    <td className="report-softwrap">
                      {followUpRange(
                        line.touchCount,
                        shortDate(line.firstTouchAt, report.timezone),
                        shortDate(line.lastTouchAt, report.timezone),
                      )}
                    </td>
                    <td>
                      {line.replyCount}
                      {line.valueSource === 'missing' ? (
                        <span className="badge badge--warn report-screen-note">
                          value unavailable
                        </span>
                      ) : null}
                    </td>
                    {/* `$0.00†` — the marker is TEXT with a matching footnote,
                        never an icon and never colour alone (WCAG 1.4.1). The
                        line is printed rather than hidden because a job the
                        client knows they won, missing from the table, reads as
                        a report that lost it. */}
                    <td className="num">
                      {money(line.grossCents)}
                      {line.valueSource === 'missing' ? '†' : null}
                    </td>
                    <td className="num">
                      {money(line.conservativeCents)}
                      {line.valueSource === 'missing' ? '†' : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className="num">{money(figures.grossCents)}</td>
                  <td className="num">{money(figures.conservativeCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* EVERY NUMBER IN EVERY FOOTNOTE COMES FROM THIS ROW — the window days,
            the baseline rate and its sample, the fee amounts. See
            `methodologyNotes`. */}
        <ol className="report-notes">
          {/* KEYED BY INDEX DELIBERATELY. The note TEXT is not unique: every
              missing-value job emits a `†` line interpolating
              `generatedJobId ?? 'unknown'`, and two lines whose job id is null
              — precisely the case where the mirror row was gone, which is WHY
              the value is missing — are byte-identical. The list is generated
              fresh on every render from a frozen row and is never reordered,
              filtered or appended to, which is the condition under which an
              index key is the correct one rather than the lazy one. */}
          {methodologyNotes(report).map((note, index) => (
            <li key={`note-${String(index)}`}>{note}</li>
          ))}
        </ol>

        {/* Same one-spelling rule as the audit sheet: the identity segments come
            from `@/core/brand`, the document's own facts follow them (D-16). */}
        <p className="report-footer">
          {footerIdentityLine(ABN_DISPLAY)} · {monthLabel} · prepared {preparedLabel} · version{' '}
          {report.version}
        </p>
      </section>

      {/* Screen-only. `report.css` hides this whole section under @media print. */}
      <section className="report-actions">
        {latestVersion > report.version ? (
          <p className="muted">
            Version {report.version} of {latestVersion} — a newer version exists.{' '}
            {newest ? (
              // Prefetch off, because this link sits beside the print button: a
              // default prefetch scrolling into view is a subresource in flight
              // at the moment of the press, and that is precisely the state in
              // which WebKit defers `window.print()` (G-07-4). The back-link at
              // the top of the page is off for the same reason and is the more
              // likely culprit of the two — it is above the fold, so it
              // prefetches at hydration rather than on a scroll (WR-02).
              <Link href={`/reports/${tenant.id}/${newest.id}`} prefetch={false}>
                Open version {latestVersion} →
              </Link>
            ) : null}
          </p>
        ) : null}

        <PrintButton />
        <p className="muted hint">
          Use &ldquo;Save as PDF&rdquo; in the print dialog, then attach it to the invoice email.
        </p>
      </section>
    </>
  );
}

/** ISO weekday order, Monday first — the order the frozen arrays are in. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * THE MISSED-CALL BLOCK, PRINTED FROM THE ROW (Phase 15, D-03, D-11; UI-SPEC §3c).
 *
 * Rendered ONLY when the frozen row carries `figures.missedCalls` — a report
 * generated before Phase 15 has no block and renders byte-identically to the
 * document the client was already sent. Every number below is READ from the
 * block; nothing is divided, sorted or derived here (the render-from-the-row
 * rule above). The client-facing voice says `of 4 delivered`, never
 * "denominator", and a speed with no delivered text-back says `no samples` —
 * a sentence, never a zero (D-10).
 *
 * The hour split is omitted from print on purpose: an A4 sheet would gain up to
 * twenty-four rows for a figure the weekday split already tells.
 *
 * DECLARED BELOW THE PAGE, deliberately: the layout-contract pins read the
 * per-job table as the FIRST `<tbody>` in this file, and the sheet's own order
 * (figures, this block, then the jobs table) is the page's JSX, not this file's.
 */
function MissedCallsSheetBlock({ block }: { block: ReportMissedCallsDocument }) {
  const { textBacks, replyRate, funnel } = block;

  return (
    <>
      <h2>Missed calls</h2>

      <dl className="report-figures">
        <div className="report-figure">
          <dt>Calls diverted</dt>
          <dd>
            {block.captured}
            <span className="muted report-figure-note">
              {block.afterHours.numerator} after hours
            </span>
          </dd>
        </div>

        <div className="report-figure">
          <dt>Text sent back within</dt>
          <dd>
            {textBacks.medianSeconds === null ? (
              <>
                {NO_VALUE}
                <span className="muted report-figure-note">{NO_SAMPLES_LABEL}</span>
              </>
            ) : (
              <>
                {textBacks.medianSeconds} s
                <span className="muted report-figure-note">
                  P90 {textBacks.p90Seconds ?? NO_VALUE} s · {textBacks.delivered} delivered
                </span>
              </>
            )}
          </dd>
        </div>

        <div className="report-figure">
          <dt>Replied</dt>
          <dd>
            {replyRate.numerator}
            <span className="muted report-figure-note">of {replyRate.denominator} delivered</span>
          </dd>
        </div>

        <div className="report-figure">
          <dt>Leads → jobs</dt>
          <dd>
            {funnel.leads} → {funnel.jobsCreated} → {funnel.jobsWon}
            <span className="muted report-figure-note">
              {funnel.bookedByTradie} booked by you
            </span>
          </dd>
        </div>
      </dl>

      <div className="table-scroll" tabIndex={0} role="region" aria-label="Missed calls by weekday">
        <table className="report-lines">
          <caption>When calls came in — by weekday</caption>
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
    </>
  );
}
