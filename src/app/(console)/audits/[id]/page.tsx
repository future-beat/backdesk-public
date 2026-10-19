import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AUDIT_RECOVERY_RATE, GRACE_PERIOD_DAYS, WINDOW_DAYS } from '@/core/audit/constants';
import { ABN_DISPLAY, SERVICE_NAME, footerIdentityLine } from '@/core/brand';
import { NO_VALUE } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

import './audit.css';
import { ConvertForm, type ConvertTarget } from './convert-form';

export const metadata: Metadata = { title: 'Quote Leakage Audit' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE SALES ARTIFACT (D-09, D-10, D-11, 02-UI-SPEC Screen 5).
 *
 * One A4 page, opened on a phone in a meeting and printed to PDF. Everything on
 * it is either a figure or an explanation of a figure; there are no badges, no
 * raw-quote table and no interactive elements inside the printed region.
 *
 * NOTE THE SELECT LIST: no `api_key_ciphertext`, no `csv_staging`. A page prop is
 * serialised into the HTML payload and the client router cache; the ciphertext
 * is useless without the server-side key, but there is no reason for a
 * credential envelope to be in a browser at all (threat T-2-02).
 */
type ProspectRow = {
  id: string;
  business_name: string;
  source: string;
  /** Last four of the prospect's API key — the "shown" half of the last-4-only promise. */
  key_last4: string | null;
  timezone: string;
  quotes_issued: number | null;
  total_value: number | string | null;
  never_followed_up_value: number | string | null;
  recoverable_estimate: number | string | null;
  baseline_win_rate: number | string | null;
  baseline_quotes_issued: number | null;
  window_start: string | null;
  window_end: string | null;
  audit_generated_at: string | null;
  csv_note_degraded: boolean;
};

/**
 * WHOLE DOLLARS, on purpose (02-UI-SPEC typography rule).
 *
 * The operational quotes table renders cents because it mirrors invoice
 * amounts. This page renders an ESTIMATE, and cents on an estimate claim a
 * precision the method does not have — `$4,250.50 recoverable` invites an
 * argument about fifty cents in a conversation that should be about four
 * thousand dollars.
 *
 * `numeric` arrives from PostgREST as a JSON NUMBER (measured — see
 * tests/baseline-winrate.test.ts). It is parsed for FORMATTING only, at the last
 * possible moment, and never fed back into a calculation: every figure on this
 * page was computed in integer cents by `aggregate.ts` and stored already.
 */
function formatMoney(value: number | string | null): string {
  if (value === null) return NO_VALUE;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NO_VALUE;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * `d MMM yyyy`, no time component.
 *
 * A timestamp on this page would claim a precision D-10 spends the whole
 * methodology footnote disclaiming — "prepared 26 Aug 2026, 14:32" reads as a
 * measurement rather than as an estimate assembled that day.
 */
function formatDate(value: string | null): string {
  if (!value) return NO_VALUE;
  // A date-only column must be read as a date, not as a local midnight that a
  // negative UTC offset would render as the previous day.
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(at.getTime())) return NO_VALUE;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at);
}

/**
 * The baseline, rendered as the UNDERSTATED secondary stat the UI-SPEC calls
 * for — one line of prose, never one of the headline figures.
 *
 * That restraint is the point. The four figures above are the pitch; this is
 * the number the service will later be MEASURED AGAINST, and putting it in
 * 32px beside "recoverable estimate" would turn a sales document into a
 * scoreboard the prospect has every reason to argue with.
 *
 * `null` is rendered as its own sentence rather than as `0%`. A prospect who
 * issued no quotes in ninety days has no win rate, and saying "0%" to a
 * business owner about their own conversion is both wrong and insulting.
 */
function baselineLine(prospect: ProspectRow): string {
  if (prospect.baseline_win_rate === null) {
    return 'No quotes issued in this period, so there is no baseline win rate to report.';
  }
  const fraction = Number(prospect.baseline_win_rate);
  if (!Number.isFinite(fraction)) {
    return 'No baseline win rate available for this period.';
  }
  return `${Math.round(fraction * 100)}% of quotes won in the period`;
}

export default async function AuditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked before the query. A guessed-but-wrong uuid falls
  // through to the policy-scoped read below and comes back empty.
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('prospects')
    .select(
      'id, business_name, source, key_last4, timezone, quotes_issued, total_value, never_followed_up_value, recoverable_estimate, baseline_win_rate, baseline_quotes_issued, window_start, window_end, audit_generated_at, csv_note_degraded',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // A genuine failure is not a 404 — saying "not found" would send the
    // operator looking for a prospect that exists.
    //
    // THE MESSAGE ITSELF NEVER REACHES THE PAGE (WR-08, T-2-02/T-2-16). A
    // PostgREST error can carry column names, constraint names, SQLSTATE detail
    // and — for errors raised inside SECURITY DEFINER functions — the internals
    // of is_operator() and has_tenant_access(). Every other boundary in this
    // phase is rigorous about this (the ServiceM8 client classifies by status
    // code and refuses String(e); outcomes.ts refuses to echo an unrecognised
    // stored value; operator-email.ts builds from a closed vocabulary), and the
    // operator cannot act on any of it anyway. The code goes to the server log,
    // where it belongs; the page gets a fixed sentence.
    console.error(`[audits] prospect read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Quote Leakage Audit</h1>
        <p className="error" role="alert">
          Could not load this audit. Try again in a moment.
        </p>
        <p>
          <Link href="/audits">Back to audits</Link>
        </p>
      </section>
    );
  }

  const prospect = data as ProspectRow | null;
  if (!prospect) {
    notFound();
  }

  const generated = prospect.audit_generated_at !== null;

  // The convert targets. Read through the authenticated client so RLS decides
  // what comes back, and only three columns — a link control has no use for a
  // client's contact hours or escalation phone.
  const { data: tenantRows } = await supabase
    .from('tenants')
    .select('id, name, prospect_id')
    .order('name', { ascending: true });

  const tenantList = (tenantRows ?? []) as Array<{
    id: string;
    name: string;
    prospect_id: string | null;
  }>;

  const targets: ConvertTarget[] = tenantList.map((row) => ({
    id: row.id,
    name: row.name,
    linked: row.prospect_id !== null,
  }));

  /** Already converted — the control is replaced by a statement of the fact. */
  const linkedClient = tenantList.find((row) => row.prospect_id === prospect.id) ?? null;

  /**
   * ── THE RATE AND ITS EXPLANATION COME FROM ONE PLACE (D-09) ───────────────
   *
   * `AUDIT_RECOVERY_RATE` is the constant the stored `recoverable_estimate` was
   * computed from, and it is interpolated into the sentence that explains that
   * figure. There is deliberately no percentage literal anywhere in this file:
   * a report claiming "a conservative 15% recovery rate" above a number computed
   * with 0.2 is not a rounding error, it is a document the person being sold to
   * can show is wrong.
   */
  const ratePercent = Math.round(AUDIT_RECOVERY_RATE * 100);

  return (
    <section className="audit-sheet">
      <p className="muted audit-backlink">
        <Link href="/audits">← Audits</Link>
      </p>

      {/* THE LETTERHEAD (logo v2, 19 Sep 2026). Above the title, because this
          sheet is printed and handed to a prospect and the only thing on it
          that said who produced it was the identity line at the foot.

          BOTH drawings, exactly one displayed — `audit.css` switches them with
          `display`, not `<picture>`. Measured through Chrome's real print path:
          a `<picture>` scoped on `prefers-color-scheme` alone prints the PAPER
          lockup from a dark-mode phone, i.e. a white wordmark on white paper.
          The long note on `.audit-lockup` has the rest of it.

          Both carry the same alt: whichever one is displayed is the one a
          screen reader sees, and the other is `display: none` and therefore out
          of the accessibility tree entirely.

          `no-img-element` IS DISABLED HERE, TWICE, AND THE RULE IS WRONG ABOUT
          THIS CASE. It fires because these two are bare <img> rather than
          children of a <picture> (which is why the nav and the marketing header
          do not trip it). Its advice — `next/image` — would put an optimiser in
          front of a committed, exactly-sized PNG that has nothing left to
          optimise, and would emit its own `srcset`, which is the one thing that
          must not happen on a page whose printed size is set in millimetres
          against a legal minimum. */}
      <div className="audit-lockup">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="audit-lockup-light"
          src="/brand/lockup-graphite-transparent.png"
          alt={SERVICE_NAME}
          width={147}
          height={28}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="audit-lockup-dark"
          src="/brand/lockup-paper-transparent.png"
          alt={SERVICE_NAME}
          width={147}
          height={28}
        />
      </div>

      <h1>Quote Leakage Audit — {prospect.business_name}</h1>

      {generated ? (
        <p className="muted audit-subline">
          Last {WINDOW_DAYS} days · prepared {formatDate(prospect.audit_generated_at)}
          {/* Operator context, screen-only (hidden from the printed artifact):
              the "shown" half of the form's last-4-only promise, so the
              operator can tell which key generated this audit. */}
          {prospect.source === 'api_key' && prospect.key_last4 ? (
            <span className="audit-keyline"> · key ending in {prospect.key_last4}</span>
          ) : null}
        </p>
      ) : (
        // Distinct from "zero quotes", and the distinction matters: one is a
        // finding about the prospect, the other is a generation that never
        // completed. Rendering zeros for the second would hand the operator a
        // fabricated result.
        <p className="muted audit-subline" role="status">
          No audit has been generated for this prospect yet.
        </p>
      )}

      {generated ? (
        <>
          <dl className="audit-figures">
            <div className="audit-figure">
              <dt>Quotes issued</dt>
              <dd>{prospect.quotes_issued ?? 0}</dd>
            </div>

            <div className="audit-figure">
              <dt>Total quoted value</dt>
              <dd>{formatMoney(prospect.total_value)}</dd>
            </div>

            <div className="audit-figure">
              <dt>Value never followed up</dt>
              <dd>{formatMoney(prospect.never_followed_up_value)}</dd>
            </div>

            {/* The hero, and the only accent-colored element on the sheet. */}
            <div className="audit-figure audit-figure--hero">
              <dt>Recoverable estimate</dt>
              <dd>{formatMoney(prospect.recoverable_estimate)}</dd>
            </div>
          </dl>

          {/* One line of prose, below the figures — see `baselineLine`. The
              label is kept (02-UI-SPEC figure-labels row) so the number is not
              an unexplained percentage on a document about someone's business. */}
          <p className="muted meta audit-baseline">Baseline win rate: {baselineLine(prospect)}</p>

          {/* 02-UI-SPEC "Audit methodology footnote (D-10, API path)", verbatim,
              with the rate interpolated from the constant. */}
          <p className="audit-method">
            How this was measured: quotes issued in the last {WINDOW_DAYS} days of your
            ServiceM8 data. &ldquo;Never followed up&rdquo; means no note, activity, or status
            change within 3 days of the quote being sent — follow-ups made outside ServiceM8
            aren&rsquo;t visible here, so the real number may be lower. The recoverable estimate
            applies a conservative {ratePercent}% recovery rate to the never-followed-up value.
            {prospect.csv_note_degraded ? (
              // The CSV addendum (D-10 honesty). Rendered if and only if the
              // flag is set — the degradation is stated on the document, in the
              // same paragraph as the method it degrades, not hidden in a
              // caveat the prospect will not reach.
              <>
                {' '}
                This audit was prepared from a CSV export, which doesn&rsquo;t include notes or
                activity — &ldquo;never followed up&rdquo; here means no status change from{' '}
                {GRACE_PERIOD_DAYS} days after the quote onwards.
              </>
            ) : null}
          </p>

          {/* The identity line is built in `@/core/brand`, not typed here: this
              sheet is printed and handed over, so the number on it is a legal
              identifier that must have exactly one spelling (D-16, D-17). */}
          <p className="audit-footer">
            {footerIdentityLine(ABN_DISPLAY)} · prepared{' '}
            {formatDate(prospect.audit_generated_at)}
          </p>
        </>
      ) : null}

      {/* Screen-only (D-02). `audit.css` hides every form under @media print. */}
      <section className="audit-actions">
        <h2>Convert to client</h2>
        {linkedClient ? (
          <p className="muted hint">
            Linked to <Link href={`/clients/${linkedClient.id}`}>{linkedClient.name}</Link>. This
            prospect&rsquo;s quote lines are kept rather than purged.
          </p>
        ) : (
          <>
            <p className="muted hint">
              Linking keeps this prospect&rsquo;s quote lines instead of purging them after 30
              days, and preserves their baseline win rate for the monthly report.
            </p>
            <ConvertForm prospectId={prospect.id} targets={targets} />
          </>
        )}
      </section>
    </section>
  );
}
