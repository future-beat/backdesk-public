import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatInTenantZone } from '@/core/shared/tenant';
import { forTenant } from '@/db/repository';
import type { MessageTemplate } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

import { AttestApprovalForm, TemplateVersionForm, VoiceProfileForm } from './forms';

export const metadata: Metadata = { title: 'Drafting' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ONBOARDING, WHERE A CLIENT'S FOLLOW-UPS GET THEIR WORDS (ONB-03).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS PAGE IS THE ONLY THING THAT OPENS THE ACTIVATION GATE.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A cadence for a client with no approved SMS template set is born
 * `paused(onboarding)` — materialized, visible, and unable to send. No operator
 * resume can lift that pause: 05-03 refused it at the transition matrix AND at
 * `operatorResumeWherePaused`, because the pause records a MISSING FACT (no
 * client-approved words exist) rather than a judgement a human may overrule.
 * Approving the version that completes the set is the one act in this codebase
 * that resumes them.
 *
 * Which is why the quote page's gated-cadence message points HERE, and why this
 * page offers no "resume anyway" affordance next to anything. The refusal is the
 * product; the button that belongs beside it is the one that supplies the words.
 *
 * ── WHY THE READS GO THROUGH `forTenant()` AND NOT THROUGH POSTGREST ────────
 *
 * The gate on this page is the RLS-scoped `tenants` read below, made with the
 * operator's OWN JWT: a client they are not a member of returns zero rows,
 * indistinguishable from one that does not exist. Everything after it reads
 * through `forTenant(id)`, closed over that same proven id.
 *
 * The alternative — reading `cadence_touch_templates` and `message_templates`
 * separately under RLS and computing approval progress here — would put a SECOND
 * definition of "is this client's template set approved" in the codebase, beside
 * `approvedSetStatus`, which 05-03 deliberately drove from the TIMING table so
 * that a tenant with no cadence shape reads as unapproved rather than vacuously
 * complete (T-5-13). Two copies of that rule is exactly how the vacuous-truth
 * trap comes back: the console would say "all approved" for the one client the
 * gate exists to stop. One rule, asked once, in the place the gate itself asks
 * it.
 *
 * ── PHONE FIRST ─────────────────────────────────────────────────────────────
 *
 * The operator fills this in during an onboarding call, standing up. Single
 * column, full-width fields, the thing that blocks activation at the top.
 */

type TenantRow = {
  id: string;
  name: string;
  timezone: string;
};

export default async function DraftingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked before the query.
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
    // A genuine failure is not a 404 — but the message never reaches the page
    // (WR-08, T-2-16): a PostgREST error carries column and constraint names and
    // the internals of has_tenant_access().
    console.error(`[drafting] tenant read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Drafting</h1>
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
  const [settingsRows, setStatus, versions] = await Promise.all([
    repo.settings.get(),
    repo.templates.approvedSetStatus(),
    // SMS only, and that is D-04 rather than a filter: v1 authors no email
    // wording, and rendering an email version here would offer an approval that
    // `approvedSetStatus` does not count.
    repo.templates.listVersions(undefined, 'sms'),
  ]);

  const settings = settingsRows[0] ?? null;
  const unapproved = setStatus.filter((touch) => !touch.approved).map((touch) => touch.touchNumber);

  // Newest first within each touch, which `listVersions` already guarantees, so
  // `[0]` is the current latest and the first row with `approvedAt` set is the
  // one drafting actually uses.
  const byTouch = new Map<number, MessageTemplate[]>();
  for (const version of versions) {
    const existing = byTouch.get(version.touchNumber);
    if (existing) existing.push(version);
    else byTouch.set(version.touchNumber, [version]);
  }

  return (
    <section>
      <p className="muted">
        <Link href={`/clients/${tenant.id}`}>← {tenant.name}</Link>
      </p>

      <h1>Drafting &amp; templates</h1>

      {/* FIRST on the page, above every control: it is the fact that decides
          whether this client's follow-ups send at all, and the operator came
          here to change it. */}
      <ActivationStatus
        touchCount={setStatus.length}
        unapproved={unapproved}
        tenantName={tenant.name}
      />

      <section>
        <h2>Touch templates</h2>
        <p className="hint muted">
          The five SMS touches, as approved versions. Editing an approved template adds a NEW
          unapproved version — drafting keeps using the last approved one, so a live client&rsquo;s
          follow-ups never go dark mid-edit.
        </p>

        {setStatus.length === 0 ? (
          <p className="muted">Nothing to author yet — the follow-up shape does not exist.</p>
        ) : (
          setStatus.map((touch) => (
            <TouchCard
              key={touch.touchNumber}
              tenantId={tenant.id}
              timezone={tenant.timezone}
              touchNumber={touch.touchNumber}
              approved={touch.approved}
              versions={byTouch.get(touch.touchNumber) ?? []}
            />
          ))
        )}
      </section>

      <section>
        <h2>Voice profile</h2>
        <p className="hint muted">
          How this tradie sounds. Every draft is written from their approved template in this
          voice, with the prices, dates and names injected from the quote — never invented.
        </p>
        <VoiceProfileForm
          tenantId={tenant.id}
          values={{
            greetingStyle: settings?.greetingStyle ?? null,
            signOff: settings?.signOff ?? null,
            formality: settings?.formality ?? null,
            bannedPhrases: settings?.bannedPhrases ?? null,
            exampleMessages: settings?.exampleMessages ?? null,
            voiceNotes: settings?.voiceNotes ?? null,
          }}
        />
      </section>
    </section>
  );
}

/**
 * One touch: every version it has ever had, which one drafting uses, and the two
 * things an operator can do about it.
 *
 * ── THE HISTORY IS RENDERED, NOT COLLAPSED TO THE CURRENT VERSION ───────────
 *
 * `message_templates` is append-only because `touch_drafts` rows reference the
 * exact version they were generated from — that reference is AI-04 evidence, and
 * "why did the model write that in June" is answered by reading the template as
 * it was in June. A screen that showed only the current wording would make that
 * history exist without anyone being able to see it, which is most of the way to
 * it not existing.
 *
 * ── "IN USE" IS THE NEWEST APPROVED, NOT THE NEWEST ─────────────────────────
 *
 * Exactly what `templates.latestApproved` reads. An unapproved edit sitting on
 * top changes nothing about what customers receive, and the badge has to say so
 * or the operator will believe their rewording went live the moment they saved.
 */
function TouchCard({
  tenantId,
  timezone,
  touchNumber,
  approved,
  versions,
}: {
  tenantId: string;
  timezone: string;
  touchNumber: number;
  approved: boolean;
  versions: readonly MessageTemplate[];
}) {
  const latest = versions[0] ?? null;
  const inUse = versions.find((version) => version.approvedAt !== null) ?? null;

  return (
    <div className="disclosure">
      <div className="row">
        <h3>Touch {touchNumber}</h3>
        {approved ? (
          <span className="badge badge--ok">Approved</span>
        ) : (
          <span className="badge badge--error">Needs approved wording</span>
        )}
      </div>

      {versions.length === 0 ? (
        <p className="muted">No wording written yet.</p>
      ) : (
        versions.map((version) => (
          <div key={version.id} className="disclosure">
            <div className="row">
              <p className="meta">
                Version {version.version}
                {version.id === inUse?.id ? ' — in use by drafting' : ''}
              </p>
              {version.approvedAt ? (
                <span className="badge badge--ok">
                  Approved {formatInTenantZone(version.approvedAt, timezone)}
                </span>
              ) : (
                <span className="badge badge--warn">Not approved</span>
              )}
            </div>

            {/* The stored bytes, unstyled and untruncated. This is the text an
                operator read to the client on the phone, and a rendering that
                trimmed or reflowed it would be a different sentence than the one
                that was approved. */}
            <p>{version.body}</p>

            {version.approvedAt ? (
              <p className="muted meta">
                {version.approvalNote ?? 'No note recorded.'}
              </p>
            ) : (
              <AttestApprovalForm
                tenantId={tenantId}
                versionId={version.id}
                touchNumber={touchNumber}
                version={version.version}
              />
            )}
          </div>
        ))
      )}

      <details className="disclosure" open={versions.length === 0}>
        <summary>{versions.length === 0 ? 'Write the wording' : 'Reword this touch'}</summary>
        <TemplateVersionForm
          tenantId={tenantId}
          touchNumber={touchNumber}
          currentBody={latest?.body ?? ''}
        />
      </details>
    </div>
  );
}

/**
 * What still blocks this client's follow-ups, in a sentence.
 *
 * THREE STATES, AND THE EMPTY ONE IS NOT "APPROVED". A tenant with no
 * `cadence_touch_templates` rows has no cadence shape yet, which
 * `hasApprovedTemplateSet` reads as UNAPPROVED — an empty `every()` is true, and
 * that vacuous truth is the trap the gate exists to avoid (T-5-13). Rendering it
 * as "all approved" here would tell the operator the opposite of what the engine
 * believes.
 */
function ActivationStatus({
  touchCount,
  unapproved,
  tenantName,
}: {
  touchCount: number;
  unapproved: readonly number[];
  tenantName: string;
}) {
  if (touchCount === 0) {
    return (
      <p className="banner-error" role="note">
        {tenantName} has no follow-up shape yet — the cadence timing rows are created with their
        first quote. Nothing can be approved until then, and nothing will send.
      </p>
    );
  }

  if (unapproved.length === 0) {
    return (
      <p className="muted" role="status">
        Every touch has approved wording. Follow-ups for {tenantName} can send.
      </p>
    );
  }

  return (
    <p className="banner-error" role="note">
      {unapproved.length === 1 ? 'Touch' : 'Touches'} {unapproved.join(', ')} still{' '}
      {unapproved.length === 1 ? 'needs' : 'need'} approved wording. Until then every follow-up for{' '}
      {tenantName} is created paused — nothing is lost, and nothing sends.
    </p>
  );
}
