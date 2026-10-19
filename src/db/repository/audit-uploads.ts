/**
 * The private `audit-uploads` bucket — the FIRST service-role `supabase-js`
 * client anywhere under `src/` (Phase 9, LAND-02, D-11, threats T-9-10/T-9-11).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE MUST STAY IN `src/db/repository/`, AND THAT IS ENFORCED TWICE. │
 * │                                                                          │
 * │  1. CI greps `src/app` for `SUPABASE_SERVICE_ROLE_KEY` and fails the     │
 * │     build on a hit (.github/workflows/ci.yml). That key bypasses RLS on  │
 * │     both Postgres and `storage.objects`; anything under `src/app` can    │
 * │     end up in a client bundle.                                           │
 * │  2. `eslint.config.mjs` bans the deep import of this module, so the      │
 * │     barrel (`@/db/repository`) is the only door into it — including for  │
 * │     the public, session-less server action that calls `putAuditUpload`.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Until this file, every service-role supabase-js client in the repo lived in
 * `scripts/` or `tests/helpers/` — one-off tooling, never request-path code.
 * This is the first in the application, and it is here because Supabase Storage
 * has no SQL write path: "All operations, including uploading, copying, moving,
 * and deleting, should exclusively go through the API" [supabase.com, storage
 * schema design]. The drizzle connection next door cannot do this job.
 *
 * ── WHY THE BUCKET IS UNREACHABLE FROM A BROWSER (T-9-11) ───────────────────
 *
 * `public = false` (migration 0035) and NOT ONE `storage.objects` policy
 * exists — with RLS on and no policy, anon and authenticated can do nothing at
 * all, while the service role bypasses policies entirely. No signed URL is ever
 * handed to a browser. The only read path in the product is the operator-gated
 * console route (09-06), which calls `getAuditUpload` from the server and
 * streams the bytes back itself.
 *
 * That is a prohibition, not a default: adding a `storage.objects` policy
 * "so the console can read it" would trade the whole guarantee for a
 * convenience the operator route does not need.
 *
 * ── WHAT IS IN THESE OBJECTS ────────────────────────────────────────────────
 *
 * A stranger's CUSTOMERS — names, mobile numbers, email addresses, job values —
 * belonging to a business that has signed nothing. It is the same class of data
 * as `prospect_quote_lines` and less justified. So it expires: the repository
 * stamps `csv_purge_after` 30 days out at attach time, and
 * `purgeExpiredAuditUploads` below is what makes that stamp true rather than
 * decorative.
 *
 * ── NOTHING HERE THROWS ─────────────────────────────────────────────────────
 *
 * The house provider-boundary rule: an outcome object with an error NAME, never
 * a caught message. A Storage error carries the object key, and the object key
 * carries a request id and a prospect's filename.
 */
import { createClient } from '@supabase/supabase-js';

import { getClientEnv, getServerEnv } from '@/core/shared/env';

import { clearAuditRequestCsv, listExpiredAuditUploads, sweepAuditRequestThrottle } from './audit-requests';

/** The one bucket. Its name is also the first path segment of nothing else. */
const BUCKET = 'audit-uploads';

/**
 * Derived rather than imported from `@supabase/storage-js`: that package is a
 * transitive dependency of supabase-js, not a declared one here, and naming it
 * in an import would be depending on somebody else's lockfile.
 */
type Bucket = ReturnType<ReturnType<typeof createClient>['storage']['from']>;

let bucket: Bucket | undefined;

/**
 * The service-role storage handle, built on first use.
 *
 * Lazy for the same reason `getDb()` is: importing the repository during a
 * build, a typecheck or a unit test must not demand credentials. `persistSession`
 * and `autoRefreshToken` are off because there is no session to persist and no
 * token to refresh — this client authenticates with a static key and runs in a
 * function that may live for one request.
 */
function storage(): Bucket {
  if (bucket) return bucket;

  const { NEXT_PUBLIC_SUPABASE_URL } = getClientEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  bucket = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(BUCKET);

  return bucket;
}

export type PutAuditUploadResult = { ok: true } | { ok: false; detail: string };

/**
 * Store one export at `{requestId}/{safeFilename}`.
 *
 * `upsert: false` on purpose: the path is keyed by a uuid the database just
 * minted, so a collision is not a retry — it is a bug worth failing on rather
 * than a stranger's file quietly overwriting another stranger's.
 *
 * THE CALLER MUST TREAT A FAILURE AS SURVIVABLE. The request row is already
 * written when this runs; a Storage outage costs the attachment, never the
 * request. The row keeps `csv_object_path = null` and the operator sees
 * "No file attached" — which is true, and which they can act on.
 */
export async function putAuditUpload(
  path: string,
  bytes: Uint8Array,
): Promise<PutAuditUploadResult> {
  const { error } = await storage().upload(path, bytes, {
    contentType: 'text/csv',
    upsert: false,
  });

  return error ? { ok: false, detail: error.name || 'StorageError' } : { ok: true };
}

/**
 * Read one object back, for the operator-gated download route (09-06).
 *
 * `null` for both "no such object" and "Storage said no", because the caller —
 * a route rendering an HTTP response to one authenticated operator — has the
 * same answer either way, and distinguishing them in the response body would
 * tell an unauthenticated prober which request ids exist.
 */
export async function getAuditUpload(path: string): Promise<Blob | null> {
  const { data, error } = await storage().download(path);
  return error ? null : data;
}

/** Remove one object. `false` if Storage refused; the caller decides what that costs. */
export async function deleteAuditUpload(path: string): Promise<boolean> {
  const { error } = await storage().remove([path]);
  return !error;
}

export interface AuditUploadPurgeResult {
  /** Objects deleted AND forgotten by the row. */
  purged: number;
  /** Objects Storage would not delete — the row keeps its path, so they retry tomorrow. */
  failed: number;
  /** Throttle counter rows older than a day, swept in the same pass. */
  throttleSwept: number;
}

/**
 * Delete every expired upload and forget it (D-11, T-9-06).
 *
 * ── THE ORDER IS THE GUARANTEE ──────────────────────────────────────────────
 *
 * Object first, row second. The other way round leaves an ORPHAN: a file full
 * of a stranger's customers sitting in a bucket with nothing left in the
 * database pointing at it, so nothing will ever try to delete it again. A
 * failure in the order below leaves the row's path intact instead, and tomorrow's
 * tick tries the same object — the retryable failure rather than the permanent
 * one.
 *
 * ── WHY THIS RUNS ON THE DIGEST TICK RATHER THAN ITS OWN CRON ───────────────
 *
 * Objects cannot be deleted from SQL, so pg_cron cannot do this alone: the purge
 * needs an authenticated HTTP entry point. The daily stalled-digest route
 * already is one — bearer-protected, daily, pg_cron-driven — so the purge
 * borrows its clock (09-RESEARCH §6, assumption A8). A seventh internal route
 * would mean a seventh bearer to rotate for work that has no separate schedule.
 *
 * The throttle sweep rides along for the same reason: an hour-windowed counter
 * row that is a day old can influence no decision and is a hashed address kept
 * for nothing.
 */
export async function purgeExpiredAuditUploads(): Promise<AuditUploadPurgeResult> {
  const expired = await listExpiredAuditUploads();

  let purged = 0;
  let failed = 0;

  // Sequential, deliberately. This is a nightly job with a handful of rows at
  // this scale, and a parallel fan-out here would race the connection ceiling
  // the repository client's header warns about for no gain anyone can measure.
  for (const row of expired) {
    if (await deleteAuditUpload(row.csvObjectPath)) {
      await clearAuditRequestCsv(row.id);
      purged += 1;
    } else {
      failed += 1;
    }
  }

  const throttleSwept = await sweepAuditRequestThrottle();

  return { purged, failed, throttleSwept };
}
