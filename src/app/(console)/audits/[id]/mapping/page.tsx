import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CANONICAL_FIELDS, inferMapping } from '@/core/audit/csv-mapping';
import { getProspect, getProspectStaging } from '@/db/repository';

import { requireOperator } from '../../../_auth';
import { MappingForm } from './mapping-form';

export const metadata: Metadata = { title: 'Confirm column mapping' };

/** Session-dependent, and reads a staged upload — never cached or prerendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many rows the operator confirms against (02-UI-SPEC Screen 4). */
const PREVIEW_ROWS = 5;

/**
 * The CSV mapping step (02-UI-SPEC Screen 4, RESEARCH Pattern 7).
 *
 * ── WHY THIS READS THROUGH THE REPOSITORY, NOT THE RLS CLIENT ───────────────
 *
 * Sibling pages select through `createClient()` so the `is_operator()` policy
 * does the scoping. This one wants `csv_staging`, and `getProspectStaging` is a
 * two-column read that cannot return `api_key_ciphertext` at all — where a
 * `select('*')` here would put a credential envelope one forgotten destructure
 * away from a page prop (threat T-2-02). This is about which columns can
 * physically reach the render.
 *
 * BUT THE REPOSITORY PATH IS SERVICE-ROLE, SO RLS SCOPES NOTHING HERE (CR-01).
 * Reading through `getProspectStaging` means the `is_operator()` policy that
 * scopes the sibling pages does not run, and the `(console)` layout gate only
 * proves a session. Without the explicit check below, any authenticated user who
 * could name a prospect uuid rendered that prospect's staged CSV rows — every
 * column of every row of a stranger's customer list. `requireOperator()` is the
 * check the sibling pages get from Postgres for free.
 *
 * Only `PREVIEW_ROWS` rows cross into the client component. The full staged set
 * stays server-side and is re-read by the confirm action — the browser never
 * holds, and never submits, the prospect's customer data.
 */
export default async function MappingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) notFound();

  // Before the read, not after: `notFound()` for a non-operator is the same
  // answer they would get for a prospect that does not exist, so this page is
  // not an existence oracle either.
  const access = await requireOperator();
  if (access === 'unauthenticated') redirect('/login');
  if (access !== 'ok') notFound();

  const prospect = await getProspect(id);
  if (!prospect) notFound();

  const staged = await getProspectStaging(id);

  // Nothing staged means the mapping was already confirmed (the audit write
  // clears it) or the prospect came in through the API path. Either way the
  // report is the right destination — a dead-end error page here would strand
  // the operator on a step that no longer exists.
  if (!staged) redirect(`/audits/${id}`);

  const inferred = inferMapping(staged.headers);

  return (
    <section>
      <p className="muted">
        <Link href="/audits">← Audits</Link>
      </p>

      <h1>Confirm columns — {prospect.businessName}</h1>

      <p className="muted hint">
        The Job List export&rsquo;s column names aren&rsquo;t fixed, so these are a best guess.
        Check each one against the preview before generating the audit.
      </p>

      <MappingForm
        prospectId={id}
        fields={CANONICAL_FIELDS.map((field) => ({
          key: field.key,
          label: field.label,
          required: field.required,
        }))}
        headers={staged.headers}
        inferred={inferred}
        previewRows={staged.rows.slice(0, PREVIEW_ROWS)}
        totalRows={staged.rows.length}
      />
    </section>
  );
}
