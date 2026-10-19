import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { defaultTextBackBody } from '@/core/leads/template';
import { formatInTenantZone } from '@/core/shared/tenant';
import { forTenant, isTextBackArmed } from '@/db/repository';
import {
  TEXT_BACK_VARIANTS,
  type TenantNeverTextNumber,
  type TextBackTemplate,
  type TextBackVariant,
} from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

import { NEVER_TEXT_KIND_LABEL, TEXT_BACK_VARIANT_LABEL } from './action-state';
import {
  AttestTextBackForm,
  NeverTextAddForm,
  NeverTextRemoveForm,
  TextBackTemplateForm,
} from './forms';

export const metadata: Metadata = { title: 'Text-back' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE TWO THINGS ARMING TEXT-BACK REQUIRES (Phase 12, D-02, D-06, IN-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE WORDING ON THIS PAGE IS SENT TO MEMBERS OF THE PUBLIC VERBATIM. No   │
 * │ model rewrites it and nothing is filled in; what the operator attests    │
 * │ here is, byte for byte, what a missed caller receives. And the client's  │
 * │ own lines listed here are what stops a substituted caller ID texting the │
 * │ client about their own call.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THE DRAFTING PAGE'S SHAPE. The gate is the RLS-scoped `tenants` read made
 * with the operator's OWN JWT — a client they do not hold reads as absent —
 * and everything after it reads through `forTenant(id)`, closed over that
 * proven id. Each of those reads DEGRADES on its own: a list that cannot be
 * read costs the operator that list, not the page, and the caught value is
 * discarded (a driver error carries the client's numbers and wording).
 *
 * "IN USE" IS THE NEWEST ATTESTED VERSION, NOT THE NEWEST. Exactly what the
 * send path reads (`latestAttested`). A newer unattested version changes
 * nothing a caller receives, and each variant's state line says so.
 */

type TenantRow = { id: string; name: string; timezone: string };

type VariantView = {
  variant: TextBackVariant;
  latest: TextBackTemplate | null;
  attested: TextBackTemplate | null;
};

export default async function TextBackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows.
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, timezone')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // The message never reaches the page (WR-08): a PostgREST error carries the
    // internals of has_tenant_access().
    console.error(`[text-back] tenant read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Text-back</h1>
        <p className="error" role="alert">
          Could not load this client. Try again in a moment.
        </p>
        <p>
          <Link href="/">Back to clients</Link>
        </p>
      </section>
    );
  }

  const tenant = data as TenantRow | null;
  if (!tenant) {
    notFound();
  }

  const repo = forTenant(tenant.id);

  let variants: VariantView[] | null = null;
  try {
    variants = await Promise.all(
      TEXT_BACK_VARIANTS.map(async (variant) => {
        const [[latest], [attested]] = await Promise.all([
          repo.textBackTemplates.latestForVariant(variant),
          repo.textBackTemplates.latestAttested(variant),
        ]);
        return { variant, latest: latest ?? null, attested: attested ?? null };
      }),
    );
  } catch {
    console.error('[text-back] template read failed');
  }

  let entries: TenantNeverTextNumber[] | null = null;
  try {
    entries = await repo.neverText.list();
  } catch {
    console.error('[text-back] never-text read failed');
  }

  let armed: boolean | null = null;
  try {
    armed = await isTextBackArmed(tenant.id);
  } catch {
    console.error('[text-back] arming read failed');
  }

  const ownLines = entries?.filter((entry) => entry.kind === 'own_line').length ?? 0;

  return (
    <section>
      <p className="muted">
        <Link href={`/clients/${tenant.id}`}>← {tenant.name}</Link>
      </p>

      <h1>Text-back</h1>

      <p className="muted" role="status">
        {armed === null
          ? 'Could not read whether text-back is armed for this client.'
          : armed
            ? `Text-back is armed for ${tenant.name}. Missed callers receive the attested wording below.`
            : `Text-back is not armed for ${tenant.name}. Nothing on this page sends anything yet.`}
      </p>

      <section>
        <h2>Templates</h2>
        <p className="hint muted">
          The first text a missed caller receives, in three variants. Saving adds a new version that
          is NOT in use; attesting it — with a note of what you checked — is what puts it on the send
          path. An attested version cannot be edited or withdrawn; reword by saving again.
        </p>

        {variants === null ? (
          <p className="error" role="alert">
            Could not load this client&rsquo;s wording. Reload to try again.
          </p>
        ) : (
          variants.map((view) => (
            <VariantCard
              key={view.variant}
              tenantId={tenant.id}
              tenantName={tenant.name}
              timezone={tenant.timezone}
              view={view}
            />
          ))
        )}
      </section>

      <section>
        <h2>Never-text list</h2>
        <p className="hint muted">
          The client&rsquo;s own lines must be listed before text-back can be armed — if a carrier
          shows the client&rsquo;s own number as the caller, this list is what stops a text to them.
          Add anyone else they never want texted as &ldquo;Never text&rdquo;.
        </p>

        {entries === null ? (
          <p className="error" role="alert">
            Could not load the never-text list. Reload to try again.
          </p>
        ) : entries.length === 0 ? (
          <p className="muted">Nothing listed yet — no own line is recorded for this client.</p>
        ) : (
          <>
            {ownLines === 0 ? (
              <p className="banner-error" role="note">
                No own line is listed. Text-back cannot be armed until at least one is.
              </p>
            ) : null}
            <ul className="touch-list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <div className="disclosure">
                    <div className="row">
                      <p>{entry.numberE164}</p>
                      <span
                        className={
                          entry.kind === 'own_line' ? 'badge badge--ok' : 'badge badge--warn'
                        }
                      >
                        {entry.kind === 'own_line'
                          ? NEVER_TEXT_KIND_LABEL.own_line
                          : NEVER_TEXT_KIND_LABEL.never_text}
                      </span>
                    </div>
                    {entry.label ? <p className="muted meta">{entry.label}</p> : null}
                    <NeverTextRemoveForm tenantId={tenant.id} entryId={entry.id} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <NeverTextAddForm tenantId={tenant.id} />
      </section>
    </section>
  );
}

/**
 * One variant: its state line, the wording in use (when a newer unattested
 * version sits over it), the edit form pre-filled with the newest saved wording
 * or the D-03 / D-23 default, and — only under an unattested newest version —
 * the attestation form.
 */
function VariantCard({
  tenantId,
  tenantName,
  timezone,
  view,
}: {
  tenantId: string;
  tenantName: string;
  timezone: string;
  view: VariantView;
}) {
  const { variant, latest, attested } = view;
  const label = TEXT_BACK_VARIANT_LABEL[variant];
  const latestIsAttested = latest !== null && attested !== null && latest.id === attested.id;

  const attestedOn = attested
    ? formatInTenantZone(attested.attestedAt, timezone, { dateStyle: 'medium' })
    : null;

  return (
    <div className="disclosure">
      <div className="row">
        <h3>{label}</h3>
        {latest === null ? (
          <span className="badge badge--error">Not set</span>
        ) : latestIsAttested ? (
          <span className="badge badge--ok">Attested on {attestedOn}</span>
        ) : (
          <span className="badge badge--warn">Saved, not attested — not in use</span>
        )}
      </div>

      {latest !== null ? (
        <p className="meta">
          Version {latest.version} · {latest.segments} segment{latest.segments === 1 ? '' : 's'}
        </p>
      ) : (
        <p className="muted meta">Pre-filled with the default wording for {tenantName}.</p>
      )}

      {/* An older attested version is still what callers receive — shown as
          stored, unstyled and untruncated, so the operator can see exactly
          what a newer unattested save has NOT replaced. */}
      {attested !== null && !latestIsAttested ? (
        <>
          <p className="muted meta">
            In use: version {attested.version}, attested on {attestedOn}
          </p>
          <p>{attested.body}</p>
        </>
      ) : null}

      <TextBackTemplateForm
        tenantId={tenantId}
        variant={variant}
        label={label}
        body={latest?.body ?? defaultTextBackBody(variant, tenantName)}
      />

      {latest !== null && latest.attestedAt === null ? (
        <AttestTextBackForm
          tenantId={tenantId}
          variant={variant}
          versionId={latest.id}
          version={latest.version}
        />
      ) : null}

      {latestIsAttested && latest.attestationNote ? (
        <p className="muted meta">Attestation note: {latest.attestationNote}</p>
      ) : null}
    </div>
  );
}
