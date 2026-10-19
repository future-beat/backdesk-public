/**
 * The private `audit-uploads` bucket: create it if the migration could not, and
 * prove it is there and PRIVATE (Phase 9, D-11).
 *
 * Usage:
 *   node scripts/setup-storage.mjs           # create if absent, then check
 *   node scripts/setup-storage.mjs --check   # read-only; exits 1 unless the
 *                                            # bucket exists and is private
 *
 * ── WHY THIS EXISTS ALONGSIDE THE MIGRATION ─────────────────────────────────
 *
 * Migration 0035's last statement upserts the bucket row directly, which is the
 * documented way to create a bucket in SQL. Whether the role behind
 * `MIGRATE_DATABASE_URL` may write that catalog on hosted Supabase was an
 * ASSUMPTION (RESEARCH A2), not a verified fact — so the upsert is the last
 * statement in the file (a `42501` there cannot lose the table DDL) and this
 * script is the fallback that does the same job through the Storage API with
 * the service role.
 *
 * `--check` is the more important half and is what the plan's verification
 * runs: it answers "does the bucket exist and is it private" with an exit code,
 * whichever path created it. A bucket that silently became public is the whole
 * risk — the objects in it are a stranger's customers' names, phone numbers and
 * email addresses.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 * It writes no object, adds no `storage.objects` policy and grants nothing. The
 * bucket is meant to be unreachable from any browser session: the console
 * downloads through an operator-gated route handler using the service role,
 * which bypasses RLS by design. Adding a policy here would be the one change
 * that makes a stranger's CSV fetchable with an anon key.
 *
 * Nothing here prints a credential. The only values that reach the console are
 * the bucket id, its `public` flag, its size limit and its mime list.
 */
import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

const BUCKET = 'audit-uploads';

/** 4 MiB — the app-side cap, and ≤ the platform's own per-file ceiling. */
const FILE_SIZE_LIMIT = 4 * 1024 * 1024;

/**
 * What a ServiceM8 Job List export arrives as. `application/octet-stream` is on
 * the list because some browsers send it for a `.csv` picked from Files on iOS;
 * the content is sniffed by the upload path regardless (09-03).
 */
const ALLOWED_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel', 'application/octet-stream'];

const CHECK_ONLY = process.argv.slice(2).includes('--check');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) fail('NEXT_PUBLIC_SUPABASE_URL is not set — see docs/env-vars.md');
if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is not set — see docs/env-vars.md');

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The bucket row, or null. Never throws for an absent bucket. */
async function readBucket() {
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (error) return null;
  return data ?? null;
}

let bucket = await readBucket();

if (!bucket && !CHECK_ONLY) {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });

  // IDEMPOTENT: a concurrent run (or the migration, moments earlier) having
  // created it is success, not a conflict to report.
  if (error && !/already exists/i.test(error.message ?? '')) {
    fail(`Could not create the ${BUCKET} bucket: ${error.name ?? 'StorageError'}`);
  }

  bucket = await readBucket();
}

if (!bucket) {
  fail(
    `${BUCKET} does not exist.` +
      (CHECK_ONLY ? ' Run `node scripts/setup-storage.mjs` (without --check) to create it.' : ''),
  );
}

// THE ASSERTION THAT MATTERS. A public bucket would publish every attached
// export to anyone who could guess a path.
if (bucket.public !== false) {
  fail(`${BUCKET} is PUBLIC — a stranger's customer data must never be world-readable.`);
}

console.log(`${BUCKET} public=${bucket.public}`);
process.exit(0);
