import type { Metadata } from 'next';
import Link from 'next/link';

import { formatInTenantZone } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

import { NewAuditForm, type NewAuditInitial } from './form';

export const metadata: Metadata = { title: 'New audit' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

const DEFAULT_TIMEZONE = 'Australia/Perth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Requests come from Perth businesses and are read in Perth (C-10/C-11). */
const REQUEST_ZONE = 'Australia/Perth';

/**
 * Australian IANA zones from the runtime, matching the client form — so the
 * select can only offer zones the action will accept, and the list tracks
 * whatever tzdata the server actually ships with.
 */
function australianTimezones(): string[] {
  const supported = Intl.supportedValuesOf?.('timeZone') ?? [];
  const zones = supported.filter((zone) => zone.startsWith('Australia/'));
  return zones.length > 0 ? zones : [DEFAULT_TIMEZONE];
}

/**
 * A byte count as a person reads it.
 *
 * On the SERVER, so the formatter never crosses into the browser bundle with
 * the form. `4194304 bytes` is a number the operator has to convert in their
 * head to answer the only question they are asking of it — is this the export,
 * or is it a stray file.
 */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'size unknown';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type RequestRow = {
  id: string;
  business_name: string;
  contact_name: string;
  csv_object_path: string | null;
  csv_filename: string | null;
  csv_bytes: number | null;
  converted_prospect_id: string | null;
  created_at: string;
};

const REQUEST_COLUMNS =
  'id, business_name, contact_name, csv_object_path, csv_filename, csv_bytes, ' +
  'converted_prospect_id, created_at';

/**
 * Start a Quote Leakage Audit, optionally from an audit request (D-15, C-12).
 *
 * ── THE PRE-FILL IS READ UNDER RLS, AND A MISS IS NOT AN ERROR ──────────────
 *
 * `?request=` is a query string: anything can put anything there. The uuid is
 * shape-checked, the row is read through `createClient()` so the single
 * `is_operator()` policy decides whether it comes back at all, and EVERY way of
 * getting nothing — a malformed id, an id that names no row, a signed-in
 * non-operator — lands in the same place: the plain new-audit form. No refusal,
 * no 404, nothing that tells a prober which of those three things happened.
 *
 * ── AND THE KEY IS NOT PART OF IT (T-2-02) ──────────────────────────────────
 *
 * A request carries no ServiceM8 credential and never will: the public form
 * does not ask for one. On the API path the operator obtains the key from the
 * prospect and types it here. The only fields that arrive pre-filled are the
 * business name and which of the two sources is available.
 *
 * ── WHAT IS SHOWN WHILE IT LOADS, AND WHEN IT FAILS (E12) ───────────────────
 *
 * No skeleton: one server round trip, so the browser holds the previous page
 * until the HTML arrives. A FAILED read is not reported as a failure either,
 * and that is the deliberate part — the pre-fill is a convenience on top of a
 * form that works without it, so a Postgres hiccup costs the operator a typed
 * business name rather than the ability to start an audit at all. The code goes
 * to the log (WR-08).
 */
export default async function NewAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request: requestParam } = await searchParams;

  let request: RequestRow | null = null;

  if (typeof requestParam === 'string' && UUID_PATTERN.test(requestParam)) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('audit_requests')
      .select(REQUEST_COLUMNS)
      .eq('id', requestParam)
      .maybeSingle();

    if (error) {
      console.error(`[audit-requests] pre-fill read failed: ${error.code ?? 'unknown'}`);
    }

    request = (data as RequestRow | null) ?? null;
  }

  // A request that has already become an audit is not pre-filled from. The
  // second conversion is refused by the database anyway (the mark is guarded on
  // `converted_prospect_id IS NULL`), so pre-filling would be an invitation to
  // do something whose only outcome is a log line — and the operator's actual
  // intent, nine times in ten, is to look at the audit they already made.
  const alreadyConverted = request?.converted_prospect_id ?? null;
  const usable = request && alreadyConverted === null ? request : null;

  const received = usable ? formatInTenantZone(usable.created_at, REQUEST_ZONE) : null;

  const initial: NewAuditInitial | undefined = usable
    ? {
        requestId: usable.id,
        businessName: usable.business_name,
        source: usable.csv_object_path ? 'csv' : 'api_key',
        csvFilename: usable.csv_object_path ? usable.csv_filename : null,
        csvSize: usable.csv_object_path ? formatBytes(usable.csv_bytes) : null,
      }
    : undefined;

  return (
    <section>
      <p className="muted">
        <Link href="/audits">← Audits</Link>
      </p>

      <h1>New audit</h1>

      {usable ? (
        <p className="muted hint">
          Pre-filled from the audit request by {usable.contact_name}, {received}.
          {usable.csv_object_path ? null : (
            // Both readings of "no path" at once, because the two are
            // indistinguishable by design: the purge clears the path, the
            // filename, the size and the stamp together, so a request that never
            // attached anything and one whose export expired look identical here.
            // Naming the 30 days is what makes the sentence true either way.
            <> No export is attached (uploads are kept for 30 days), so use the read-only API key.</>
          )}
        </p>
      ) : null}

      {alreadyConverted ? (
        <p className="muted">
          This request has already been turned into an audit.{' '}
          <Link href={`/audits/${alreadyConverted}`}>Open audit</Link>
        </p>
      ) : null}

      <NewAuditForm
        timezones={australianTimezones()}
        defaultTimezone={DEFAULT_TIMEZONE}
        initial={initial}
      />
    </section>
  );
}
