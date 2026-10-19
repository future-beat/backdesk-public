import type { Metadata } from 'next';
import Link from 'next/link';

import {
  formatContactDays,
  formatContactTime,
  formatInTenantZone,
  NO_VALUE,
} from '@/core/shared/tenant';
import { STALLABLE_TOUCH_STATUSES, stallBoundary } from '@/core/aging/stall-policy';
import { deriveHealth, HEALTH_BADGE_CLASS, HEALTH_LABELS } from '@/core/sync/health';
import { createClient } from '@/lib/supabase/server';

/**
 * THE CONSOLE'S HOME, at `/clients` since 09-04.
 *
 * It sat at the route-group root (`(console)/page.tsx`, served at `/`) until the
 * public landing page needed the real `/`: two route groups cannot both resolve
 * it. The operator's URL did not change — `proxy.ts` rewrites app-host `/` to
 * this path — but the route did, which is why the two `revalidatePath` callers
 * and the login redirect now name `/clients`.
 *
 * The page itself is untouched by the move: same RLS read, same three round
 * trips, same force-dynamic contract.
 */
export const metadata: Metadata = { title: 'Clients' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * The connection fields the health badge is derived from, and nothing else.
 *
 * `api_key_ciphertext` is not in the select list and must never be: a page prop
 * is serialised into the HTML payload and the client router cache, and a list
 * page has even less business holding a credential envelope than a detail page
 * does (threat T-2-02). `key_last4` is not here either — the list shows health,
 * not credentials.
 */
type ConnectionHealthRow = {
  tenant_id: string;
  paused_at: string | null;
  status_reason: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
};

/**
 * The two columns the Drafts count needs, and nothing else.
 *
 * Not the draft body, not the contact, not the job description — the number is
 * a fact about the operator's own queue, and every extra column on a list page
 * is customer content serialised into an HTML payload and the router cache.
 */
type PendingTouchRow = {
  tenant_id: string;
  scheduled_at: string;
};

export default async function ClientListPage() {
  const supabase = await createClient();

  // Reads through the authenticated client, so RLS decides what comes back.
  // Ordering by created_at alone is non-deterministic when two rows share a
  // timestamp; id is the tiebreaker that makes output stable.
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select(
      'id, name, trade_type, timezone, status, contact_hours_start, contact_hours_end, contact_days',
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    // The code, to the log; a fixed sentence, to the page (WR-08, T-2-02). A
    // PostgREST message can name columns, constraints and the internals of the
    // SECURITY DEFINER policy helpers, and the operator cannot act on any of it.
    console.error(`[clients] tenant list read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Clients</h1>
        <p className="error" role="alert">
          Could not load clients. Try again in a moment.
        </p>
      </section>
    );
  }

  // One extra round trip rather than one per row. A connection read that fails
  // is tolerated rather than fatal — every client renders as `never synced`,
  // which is visibly wrong and therefore reportable, whereas taking the whole
  // list down would hide the clients that are fine.
  const connectionsResult =
    tenants.length === 0
      ? { data: [] as ConnectionHealthRow[] }
      : await supabase
          .from('sm8_connections')
          .select('tenant_id, paused_at, status_reason, consecutive_failures, last_success_at')
          .in(
            'tenant_id',
            tenants.map((tenant) => tenant.id),
          );

  const byTenant = new Map(
    ((connectionsResult.data as ConnectionHealthRow[] | null) ?? []).map((row) => [
      row.tenant_id,
      row,
    ]),
  );

  /**
   * WHAT IS WAITING ON THE OPERATOR, PER CLIENT (D-12).
   *
   * ONE round trip for the whole table, grouped in a single pass below — the
   * same shape as the connection read above it, and for the same reason: a
   * query per row turns a fifteen-client list into sixteen round trips.
   *
   * Two columns only, and neither is customer content: a tenant id and a slot.
   * The count is a fact about the OPERATOR'S queue, not about anybody's job, so
   * nothing here needs a description, a contact or a body — and a list page is
   * the last place any of those should be selected into an HTML payload
   * (T-2-02).
   *
   * Read through the same RLS-scoped client as everything else on this page.
   * A failed read is tolerated exactly as the connection read is: every client
   * renders an em dash, which is visibly wrong and therefore reportable,
   * whereas taking the list down would hide the clients that are fine.
   */
  const now = new Date();
  const boundary = stallBoundary(now);

  const touchesResult =
    tenants.length === 0
      ? { data: [] as PendingTouchRow[] }
      : await supabase
          .from('cadence_touches')
          .select('tenant_id, scheduled_at')
          .in('status', [...STALLABLE_TOUCH_STATUSES])
          .in(
            'tenant_id',
            tenants.map((tenant) => tenant.id),
          );

  const draftsByTenant = new Map<string, { pending: number; stalled: number }>();
  for (const row of (touchesResult.data as PendingTouchRow[] | null) ?? []) {
    const tally = draftsByTenant.get(row.tenant_id) ?? { pending: 0, stalled: 0 };
    tally.pending += 1;
    // The boundary comes from the SAME imported constant the tick alerts on and
    // the nav badge colours by — never a second `4` written beside a
    // `scheduled_at` comparison. Three surfaces, one rule.
    if (new Date(row.scheduled_at).getTime() <= boundary.getTime()) tally.stalled += 1;
    draftsByTenant.set(row.tenant_id, tally);
  }

  return (
    <section>
      <div className="row">
        <h1>Clients</h1>
        <Link href="/clients/new" className="button">
          New client
        </Link>
      </div>

      {tenants.length === 0 ? (
        <p className="muted">
          No clients yet. <Link href="/clients/new">Create the first one</Link>.
        </p>
      ) : (
        /* SIDEWAYS SCROLL INSIDE THE BOX, never a wider `main` — the quotes
           table's rule (02-05, 8de755c). Seven columns are 447.7px of header
           cells alone against the 350px column a 390px phone offers, and an
           auto-layout table's used width is max(specified, min-content), so
           `width: 100%` cannot shrink it: without this box the document is
           620px wide and the nav's Sign out sits off the right edge. The box
           was missing from the 01-02 tracer until 07-07 (G-07-6) while the
           contract chain cited it as precedent anyway. */
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Clients">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Trade</th>
                <th>Sync</th>
                {/* Second only to health, because it is the other thing on this
                    page with a clock on it: an unapproved draft at its send slot
                    is a follow-up that goes out late or not at all. */}
                <th>Drafts</th>
                <th>Last sync</th>
                <th>Contact hours</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const connection = byTenant.get(tenant.id);
                // The ONE place a health string originates on this page. The
                // detail page's banner derives from the same fields of the same
                // row, which is why the two can never disagree (D-07).
                const health = deriveHealth(
                  connection
                    ? {
                        pausedAt: connection.paused_at,
                        statusReason: connection.status_reason,
                        consecutiveFailures: connection.consecutive_failures,
                        lastSuccessAt: connection.last_success_at,
                      }
                    : null,
                );

                return (
                  <tr key={tenant.id}>
                    <td>
                      {/* The link lives in the cell rather than around the row:
                          an anchor cannot legally wrap a <tr>. */}
                      <Link href={`/clients/${tenant.id}`}>{tenant.name}</Link>
                    </td>
                    <td>{tenant.trade_type}</td>
                    <td>
                      {/* Text, always. Color reinforces; it never carries the
                          meaning on its own (WCAG 1.4.1). */}
                      <span className={HEALTH_BADGE_CLASS[health]}>{HEALTH_LABELS[health]}</span>
                    </td>
                    <td>
                      {/* Digits are the content; `.badge--error` reinforces when
                          any of this client's waiting touches is inside the stall
                          threshold. An em dash at zero rather than a `0` — the
                          same reason the nav badge hides itself: a column of
                          permanent zeroes is a column nobody reads. */}
                      {(() => {
                        const drafts = draftsByTenant.get(tenant.id);
                        if (!drafts || drafts.pending === 0) return NO_VALUE;
                        return (
                          <span className={drafts.stalled > 0 ? 'badge badge--error' : 'badge'}>
                            {drafts.pending}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      {connection?.last_success_at
                        ? formatInTenantZone(connection.last_success_at, tenant.timezone)
                        : NO_VALUE}
                    </td>
                    <td>
                      {formatContactTime(tenant.contact_hours_start)}–
                      {formatContactTime(tenant.contact_hours_end)}
                      <span className="muted"> {formatContactDays(tenant.contact_days)}</span>
                    </td>
                    <td>{tenant.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
