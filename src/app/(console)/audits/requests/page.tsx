import type { Metadata } from 'next';
import Link from 'next/link';

import { BAND_LABELS, TRADE_LABELS } from '@/core/intake/audit-request';
import { formatInTenantZone } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Audit requests' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * The console half of LAND-03 (D-15): what a stranger typed into the public
 * form, on the operator's phone, newest first.
 *
 * ── READ THROUGH THE COOKIE CLIENT, NOT THE REPOSITORY (T-9-18) ─────────────
 *
 * `audit_requests` is tenant-independent and carries exactly one policy,
 * `is_operator()`. Reading it through `createClient()` — anon key plus the
 * operator's session cookie — makes Postgres decide whether this person may see
 * the list of every business that has asked the founder for an audit. The
 * repository family would work too, and would be wrong: it goes through
 * `getDb()`, where RLS is inert, so the gate would move from the database into
 * whichever `requireOperator()` call somebody remembers to keep at the top of
 * the file. A signed-in non-operator gets an empty list here, which is correct
 * and indistinguishable from having no requests yet.
 *
 * ── AN EXPLICIT SELECT, MINUS THE TWO DIAGNOSTIC COLUMNS (T-9-34) ───────────
 *
 * The schema stores a salted address hash to key the throttle bucket and a
 * capped agent string to diagnose a broken submit. Neither is a fact about the
 * business, and this screen is read at a glance with people standing behind it.
 * The detail page shows them, truncated and deliberately (09-06); the list asks
 * for ten named columns and nothing else, so the NEXT column added to the table
 * also arrives here only when somebody decides it should.
 *
 * ── A LIST, NOT A TABLE (G-07-6) ────────────────────────────────────────────
 *
 * Seven facts per row against the 350px a 390px phone offers. A table would
 * live inside `.table-scroll` and push the status badge — the fact the operator
 * opened the page for — off the right edge. `.touch-list` wraps instead, which
 * is the same call the schedule and the inbox made.
 */

/** No pagination in v1: the expected volume is tens (UI-SPEC C-10). */
const LIST_LIMIT = 50;

/**
 * The zone, named ONCE above the list rather than on every row.
 *
 * Requests arrive from Perth trade businesses and the operator reads them in
 * Perth; unlike a cadence surface there is no per-tenant zone to resolve. The
 * `.zone-note` argument from globals.css applies unchanged — repeating the zone
 * eleven times costs the times themselves the width they need on a phone.
 */
const REQUEST_ZONE = 'Australia/Perth';

/** Verbatim from the UI-SPEC Copywriting Contract (E11 empty). */
const EMPTY_STATE =
  'No audit requests yet. Requests from backdesk.com.au/audit appear here, newest first.';

/**
 * The ten columns, as one string.
 *
 * Named here rather than inline so the grep that proves the two diagnostic
 * columns are absent has one place to look, and so the list cannot drift into
 * `select('*')` during a hurried edit.
 */
const REQUEST_COLUMNS =
  'id, business_name, trade, quotes_band, servicem8_user, status, csv_object_path, notify_email, notify_sms, created_at';

type RequestRow = {
  id: string;
  business_name: string;
  trade: string;
  quotes_band: string;
  servicem8_user: boolean;
  status: string;
  csv_object_path: string | null;
  notify_email: string | null;
  notify_sms: string | null;
  created_at: string;
};

/**
 * A map, not a `.replace('_', ' ')` at the render site.
 *
 * The house rule the source, eligibility and attribution labels follow: a fifth
 * status added to the CHECK constraint must arrive as an unstyled fallback that
 * a test catches, not as a lowercase word wearing the default pill. Words carry
 * the meaning and colour only reinforces (WCAG 1.4.1) — `--ok` for a request
 * that became an audit, `.muted` for one that went nowhere, and no `--warn`,
 * which is reserved for sync health.
 */
const STATUS_BADGE_CLASS: Record<string, string> = {
  new: 'badge',
  contacted: 'badge',
  audited: 'badge badge--ok',
  declined: 'badge muted',
};

/** The trade and band vocabularies are the intake module's, never re-spelled. */
const TRADE_LABEL: Record<string, string> = TRADE_LABELS;
const BAND_LABEL: Record<string, string> = BAND_LABELS;

export default async function AuditRequestsPage() {
  const supabase = await createClient();

  // `count: 'exact'` alongside the capped read: PostgREST reports the size of
  // the whole result set in Content-Range, so the total stays honest past the
  // 50th row rather than reporting the size of the page.
  const { data, error, count } = await supabase
    .from('audit_requests')
    .select(REQUEST_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    // `id` breaks the tie: two requests written in the same millisecond must not
    // swap places between renders.
    .order('id', { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    // The code, to the log; a fixed sentence, to the page (WR-08, T-9-05). A
    // PostgREST message names columns, constraints and the internals of
    // `is_operator()`, and none of it is something the operator can act on.
    console.error(`[audit-requests] list read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Audit requests</h1>
        <p className="error" role="alert">
          Could not load audit requests. Try again in a moment.
        </p>
      </section>
    );
  }

  const requests = (data as RequestRow[] | null) ?? [];
  const total = count ?? requests.length;

  // The count of NEW across the whole table, not across the 50 rows fetched:
  // with a cap in play those two are different numbers, and the one the operator
  // is asking for is "how much is waiting for me".
  const { count: newCount, error: newCountError } = await supabase
    .from('audit_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');

  if (newCountError) {
    console.error(`[audit-requests] new count read failed: ${newCountError.code ?? 'unknown'}`);
  }

  // A failed count degrades to the half of the line that is still true rather
  // than to a zero, which would read as "nothing is waiting".
  const countLine = newCount === null ? `${total} total` : `${newCount} new · ${total} total`;

  return (
    <section>
      <div className="row">
        <h1>Audit requests</h1>
        <span className="muted zone-note">times in {REQUEST_ZONE}</span>
      </div>

      <p className="muted">{countLine}</p>

      {requests.length === 0 ? (
        <p className="muted">{EMPTY_STATE}</p>
      ) : (
        <ul className="touch-list">
          {requests.map((request) => {
            // EITHER channel failing is the signal (D-13): the operator has to
            // know the request arrived without them being told about it.
            // `not_configured` is deliberately not this badge — that is a
            // deployment problem the detail page names, not a lost alert.
            const notifyFailed =
              request.notify_email === 'failed' || request.notify_sms === 'failed';

            return (
              <li key={request.id}>
                <div className="touch-when touch-when--stack">
                  {/* The link 404s until 09-06 lands the detail page. */}
                  <Link href={`/audits/requests/${request.id}`} className="request-name">
                    <strong>{request.business_name}</strong>
                  </Link>
                  <span className={STATUS_BADGE_CLASS[request.status] ?? 'badge'}>
                    {request.status}
                  </span>
                  {notifyFailed ? <span className="badge badge--error">notify failed</span> : null}
                </div>

                <p className="touch-meta">
                  {TRADE_LABEL[request.trade] ?? request.trade} ·{' '}
                  {BAND_LABEL[request.quotes_band] ?? request.quotes_band} a month · ServiceM8{' '}
                  {request.servicem8_user ? 'yes' : 'no'}
                </p>

                <p className="touch-meta muted">
                  {formatInTenantZone(request.created_at, REQUEST_ZONE)}
                  {request.csv_object_path ? ' · CSV attached' : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Said only when the cap actually bit. There is nothing further to link
          to: at tens of rows a pager is a control that exists to be wrong. */}
      {requests.length === LIST_LIMIT ? <p className="muted">Showing the latest 50</p> : null}
    </section>
  );
}
