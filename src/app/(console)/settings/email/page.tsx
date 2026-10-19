import type { Metadata } from 'next';

import {
  getDomain,
  listDomains,
  VERIFIED_STATUS,
  type DnsRecordView,
  type DomainDetail,
} from '@/core/messaging/resend-domains';
import { NO_VALUE } from '@/core/shared/tenant';
import { listChannelConfig } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../_auth';
import { AddDomainForm, EmailConfigForm, VerifyDomainForm } from './forms';

export const metadata: Metadata = { title: 'Email settings' };

/** Session-dependent, and reads a third party live — never cached. */
export const dynamic = 'force-dynamic';

/**
 * The email pipe, from nothing to sending (MSG-02, D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE FLOW WITH A HUMAN IN THE MIDDLE OF IT.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A domain cannot be verified from code: somebody has to open a DNS host and
 * paste records. This page exists to make that possible without a developer —
 * add the domain, copy the exact records, check DNS, then enable a client's
 * email identity. Every string in the DNS table is passed through from Resend
 * untouched, because a DKIM key that has been trimmed for display is a key the
 * operator pastes wrong and a verification that never lands.
 *
 * ── THE RESIDENCY NOTE IS RENDERED, NOT COMMENTED ───────────────────────────
 *
 * AU data residency is a selling point of this service and the operator says so
 * in sales conversations. The true version has an exception in it: Supabase is
 * in Sydney, Resend has no Australian region at all, and ClickSend's processing
 * is likewise not something we control. That exception has to reach the person
 * making the claim, and the only place it reliably reaches them is the screen
 * they are on when they turn email on — not a comment in a file, not a line in
 * a research document nobody reopens.
 *
 * ── EVERY READ HERE IS BEHIND AN EXPLICIT OPERATOR GATE ─────────────────────
 *
 * `listChannelConfig` goes through `getDb()`, where RLS is inert by design, and
 * the Resend calls carry an account-wide API key. `requireOperator()` runs
 * before any of it, on the same argument as the inbox and the CSV mapping page
 * (CR-01): a session proves somebody signed in, not that they may reconfigure
 * how fifteen businesses' mail is sent.
 */

/**
 * VERBATIM, and deliberately blunt about the part that is not AU-resident.
 *
 * Naming `ap-northeast-1` rather than saying "offshore" is the whole point: a
 * region code is checkable, and a prospect's IT person will check it.
 */
const RESIDENCY_NOTE =
  'Database and auth are AU-resident (Supabase Sydney). Email is processed by Resend offshore ' +
  '(nearest region ap-northeast-1) and SMS by ClickSend — sales copy must say so.';

/**
 * A map, not a `.replace('_', ' ')` — the house rule every status label here
 * follows. An unmapped status renders as its own code rather than as an empty
 * cell, because "we do not have a label for this" and "there is no status" are
 * different facts and only one of them is a bug.
 */
const DOMAIN_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  pending: 'Pending DNS',
  verified: 'Verified',
  partially_verified: 'Partly verified',
  partially_failed: 'Partly failed',
  failed: 'Failed',
  temporary_failure: 'Temporary failure',
};

const DOMAIN_STATUS_CLASS: Record<string, string> = {
  verified: 'badge badge--ok',
  pending: 'badge badge--warn',
  not_started: 'badge badge--warn',
  partially_verified: 'badge badge--warn',
  partially_failed: 'badge badge--error',
  failed: 'badge badge--error',
  temporary_failure: 'badge badge--error',
};

function statusBadge(status: string) {
  return (
    <span className={DOMAIN_STATUS_CLASS[status] ?? 'badge'}>
      {DOMAIN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function DnsRecords({ records }: { records: readonly DnsRecordView[] }) {
  if (records.length === 0) {
    return <p className="muted">No DNS records returned for this domain.</p>;
  }

  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="DNS records">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Name</th>
            <th>Value</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.record}-${record.type}-${record.name}`}>
              <td>{record.type}</td>
              {/* `<code>` on both, and no truncation class: these are strings
                  the operator selects and copies. A DKIM value is ~400
                  characters and every one of them matters. */}
              <td>
                <code>{record.name}</code>
              </td>
              <td>
                <code>{record.value}</code>
              </td>
              <td>{statusBadge(record.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EmailSettingsPage() {
  const access = await requireOperator();
  if (access !== 'ok') {
    return (
      <section>
        <h1>Email settings</h1>
        <p className="error" role="alert">
          {OPERATOR_DENIED_MESSAGE[access]}
        </p>
      </section>
    );
  }

  const listed = await listDomains();

  // One detail read per domain, because Resend's list endpoint does not return
  // records and the records are what this page is for. Bounded by the Resend Pro
  // domain limit (10) — a fan-out that cannot grow into a problem at this scale,
  // and the alternative (storing records ourselves) is a copy that goes stale
  // the first time a key is rotated.
  const details: DomainDetail[] = listed.ok
    ? (
        await Promise.all(listed.domains.map(async (domain) => await getDomain(domain.id)))
      ).flatMap((result) => (result.ok ? [result.domain] : []))
    : [];

  if (!listed.ok) {
    // The code to the log, a fixed sentence to the page (WR-08). The rest of the
    // page still renders: the existing config rows are the half an operator may
    // have come here to check, and taking the whole screen down because a third
    // party is unreachable hides them.
    console.error(`[settings/email] domain list failed: ${listed.reason}`);
  }

  const verifiedDomains = details
    .filter((domain) => domain.status === VERIFIED_STATUS)
    .map((domain) => ({ id: domain.id, name: domain.name }));

  const configRows = await listChannelConfig('email');

  // Names through the operator's OWN JWT, so RLS decides which clients they may
  // configure — the same authority the client list page reads under.
  const supabase = await createClient();
  const { data: tenantRows } = await supabase
    .from('tenants')
    .select('id, name')
    .order('name', { ascending: true });
  const tenants = ((tenantRows as { id: string; name: string }[] | null) ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const tenantNames = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));

  return (
    <section>
      <h1>Email settings</h1>

      {/* FIRST on the page, above every control, because it is the fact the
          operator is most likely to state incorrectly in a sales meeting. */}
      <p className="banner-error" role="note">
        {RESIDENCY_NOTE}
      </p>

      <h2>Sending domains</h2>

      {listed.ok ? null : (
        <p className="error" role="alert">
          Could not reach the email provider. Domain status below may be incomplete.
        </p>
      )}

      {details.length === 0 ? (
        <p className="muted">
          No sending domains yet. Add one below — email cannot be switched on until a domain is
          verified.
        </p>
      ) : (
        details.map((domain) => (
          <div key={domain.id} className="disclosure">
            <div className="row">
              <h3>
                {domain.name} {statusBadge(domain.status)}
              </h3>
              <span className="muted">{domain.region}</span>
            </div>
            <DnsRecords records={domain.records} />
            <VerifyDomainForm domainId={domain.id} />
          </div>
        ))
      )}

      <h2>Add a domain</h2>
      <AddDomainForm />

      <h2>Who sends as what</h2>

      {configRows.length === 0 ? (
        <p className="muted">
          No email identities configured. Nothing sends email until a row here is switched on.
        </p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Who sends as what">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>From</th>
                <th>Reply-to</th>
                <th>Business name</th>
                <th>Sending</th>
              </tr>
            </thead>
            <tbody>
              {configRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.tenantId
                      ? (tenantNames.get(row.tenantId) ?? 'Another client')
                      : 'Every client (default)'}
                  </td>
                  <td>{row.fromAddress ?? NO_VALUE}</td>
                  <td>{row.replyTo ?? NO_VALUE}</td>
                  <td>{row.businessName ?? NO_VALUE}</td>
                  <td>
                    {row.enabled ? (
                      <span className="badge badge--ok">On</span>
                    ) : (
                      <span className="badge">Off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Set an email identity</h2>
      <p className="hint muted">
        Saving a client&rsquo;s row overrides the default for that client only. It changes the
        IDENTITY and nothing else — email starts sending when somebody arms it on the
        client&rsquo;s page, which is the tap that gets audited.
      </p>
      <EmailConfigForm tenants={tenants} verifiedDomains={verifiedDomains} />
    </section>
  );
}
