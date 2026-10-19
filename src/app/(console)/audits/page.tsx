import type { Metadata } from 'next';
import Link from 'next/link';

import { NO_VALUE } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Audits' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * The prospect list read contract.
 *
 * NOTE THE SELECT LIST: no `api_key_ciphertext` and no `csv_staging`. A page
 * prop is serialised into the HTML payload and the client router cache, and a
 * list page has even less business holding a credential envelope than a detail
 * page does (threat T-2-02).
 */
type ProspectRow = {
  id: string;
  business_name: string;
  source: string;
  audit_generated_at: string | null;
  created_at: string;
};

/**
 * A map, not a `.replace('_', ' ')`.
 *
 * The same rule the eligibility and sync-outcome labels follow: string surgery
 * at the render site means a third source added later ships as a lowercase
 * snake_case word in the UI and nobody notices.
 */
const SOURCE_LABELS: Record<string, string> = {
  api_key: 'API key',
  csv: 'CSV',
};

/**
 * Dates in the OPERATOR'S locale, not a prospect's timezone.
 *
 * Deliberately different from the client pages, which render in each client's
 * IANA zone because those times govern when their customers may be contacted.
 * Nothing on this page is a contact-hours decision — these are pipeline
 * timestamps the founder reads — so the zone that matters is the one they are
 * standing in.
 */
function formatDate(value: string | null): string {
  if (!value) return NO_VALUE;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return NO_VALUE;
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(at);
}

export default async function AuditsListPage() {
  const supabase = await createClient();

  // Through the AUTHENTICATED client, so the `is_operator()` policy decides
  // what comes back. An operator who is not on the allowlist sees an empty
  // list — correct, and indistinguishable from having no prospects yet.
  const { data, error } = await supabase
    .from('prospects')
    .select('id, business_name, source, audit_generated_at, created_at')
    .order('created_at', { ascending: false })
    // `id` breaks the tie: two prospects created in the same millisecond must
    // not swap places between renders.
    .order('id', { ascending: false });

  if (error) {
    // The code, to the log; a fixed sentence, to the page (WR-08, T-2-02). A
    // PostgREST message can name columns, constraints and the internals of the
    // SECURITY DEFINER policy helpers, and the operator cannot act on any of it.
    console.error(`[audits] prospect list read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Audits</h1>
        <p className="error" role="alert">
          Could not load audits. Try again in a moment.
        </p>
      </section>
    );
  }

  const prospects = (data as ProspectRow[] | null) ?? [];

  /**
   * How many public audit requests are still waiting (LAND-03, D-15).
   *
   * `head: true` so the round trip returns the integer and no rows: this header
   * needs a number, and pulling fifty strangers' contact details into a page
   * that renders one digit would be the wrong trade twice over. Through the same
   * cookie-bound client as the read above, so `is_operator()` decides here too —
   * the count is a fact about the request table and gets the same gate the list
   * itself gets (T-9-18).
   */
  const { count: newRequestCount, error: requestCountError } = await supabase
    .from('audit_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');

  if (requestCountError) {
    console.error(`[audits] request count read failed: ${requestCountError.code ?? 'unknown'}`);
  }

  return (
    <section>
      <div className="row">
        <h1>Audits</h1>
        {/* The console nav refuses a fifth item in its own comment, so the way
            into the request list is a second link here. The number is appended
            only when there IS one and it is not zero: a permanent `(0 new)` is
            chrome an operator stops reading, and a failed count rendered as a
            zero would be a lie in the one direction that matters. */}
        <Link href="/audits/requests" className="button-quiet">
          Requests
          {newRequestCount !== null && newRequestCount > 0 ? ` (${newRequestCount} new)` : ''}
        </Link>
        <Link href="/audits/new" className="button">
          New audit
        </Link>
      </div>

      {prospects.length === 0 ? (
        // Verbatim from the 02-UI-SPEC Copywriting Contract, "Empty state —
        // audits list". The New audit button above stays rendered: it is the
        // control that gets the operator OUT of the empty state, so hiding it
        // with the table would strand them here.
        <p className="muted">
          No audits yet. Create a prospect to generate their Quote Leakage Audit.
        </p>
      ) : (
        /* The box scrolls, not the page: a business name with one unbreakable
           word of twenty characters or more takes the list past a 390px phone
           (measured 464px). The quotes table's rule (02-05, 8de755c); G-07-6. */
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Audits">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Source</th>
                <th>Created</th>
                <th>Audit</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((prospect) => (
                <tr key={prospect.id}>
                  <td>
                    {/* The link lives in the cell rather than around the row: an
                        anchor cannot legally wrap a <tr>. */}
                    <Link href={`/audits/${prospect.id}`}>{prospect.business_name}</Link>
                  </td>
                  <td>{SOURCE_LABELS[prospect.source] ?? prospect.source}</td>
                  <td>{formatDate(prospect.created_at)}</td>
                  <td>
                    {prospect.audit_generated_at ? (
                      <Link href={`/audits/${prospect.id}`}>
                        {formatDate(prospect.audit_generated_at)}
                      </Link>
                    ) : (
                      // A prospect row with no figures is a generation that did
                      // not finish. Saying so beats an empty cell that reads as a
                      // rendering bug.
                      <span className="muted">not generated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
