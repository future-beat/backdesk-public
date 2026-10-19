/**
 * One-off: compute the D-14 baseline for connections made before plan 02-06.
 *
 *   node scripts/backfill-baselines.mjs           # write
 *   node scripts/backfill-baselines.mjs --dry-run # report only
 *
 * `connectServiceM8` now snapshots the baseline in the same transaction as the
 * backfill, so every connection made from here on has one. This script exists
 * for the ones that predate that code and would otherwise carry `NULL` forever
 * — and a client with no baseline is a client Phase 7 cannot report on
 * honestly, which surfaces as a missing column in an invoice six months from
 * now rather than as an error today.
 *
 * ── NO API CALLS, DELIBERATELY ──────────────────────────────────────────────
 *
 * It recomputes from the `quotes` rows already mirrored locally. Re-fetching
 * from ServiceM8 would need each client's key decrypted, would spend their rate
 * limit, and — the real objection — would read TODAY'S data through a filter
 * meant to describe a window that closed months ago. The mirror is what we knew
 * then and what the report will reconcile against.
 *
 * ── THE WINDOW IS ANCHORED TO `created_at`, NOT TO NOW ──────────────────────
 *
 * The baseline means "the 90 days BEFORE we connected". Anchoring it to the
 * current date would include quotes the service itself chased, so the number
 * subtracted from our own results would be partly made of our own results —
 * the attribution equivalent of grading your own homework.
 *
 * A caveat worth stating rather than hiding: the mirror only holds what the
 * connect-time backfill fetched, which was itself the 90 days before connect.
 * For a connection made months ago the two windows coincide almost exactly; for
 * one made days ago they coincide entirely. The script reports the row counts
 * it worked from so a thin result is visible rather than silently averaged.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 *
 * Only rows with `baseline_computed_at IS NULL` are touched, so a re-run is a
 * no-op and a partially-completed run resumes. `baseline_computed_at` rather
 * than `baseline_win_rate IS NULL`: a legitimately-null win rate (a client who
 * issued no quotes in the window) is a computed answer, and keying on it would
 * recompute those clients on every run forever.
 */
import postgres from 'postgres';

import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();

const env = requireEnv('MIGRATE_DATABASE_URL');
const dryRun = process.argv.includes('--dry-run');

const WINDOW_DAYS = 90;

const sql = postgres(env.MIGRATE_DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
});

/**
 * A TRANSCRIPTION of `computeBaseline` in src/core/audit/aggregate.ts, and it
 * is a transcription rather than an import because a `.mjs` one-off cannot pull
 * in a TypeScript module without a build step this repo does not have.
 *
 * KEEP THE TWO IN STEP, or delete this script once it has been run — it is a
 * one-off by design and its whole working life is a single execution. The
 * properties that must not drift:
 *
 *   - `null`, NEVER 0, when no quotes were issued (see aggregate.ts for the
 *     full argument: a stored 0 tells Phase 7 the client won nothing before we
 *     arrived, and every win they would have made anyway gets billed as ours)
 *   - BOTH `Work Order` and `Completed` count as won — the four statuses do not
 *     progress linearly
 *   - integer-scaled to exactly 4 decimal places, because the column is
 *     `numeric(5,4)` and '0.33333333' is a failed UPDATE
 */
function computeBaseline(rows) {
  let quotesIssued = 0;
  let quotesWon = 0;

  for (const row of rows) {
    if (row.quote_date_utc === null) continue;
    quotesIssued += 1;
    if (row.status === 'Work Order' || row.status === 'Completed') quotesWon += 1;
  }

  if (quotesIssued === 0) return { winRate: null, quotesIssued: 0, quotesWon: 0 };

  const scaled = Math.round((quotesWon * 10_000) / quotesIssued);
  const winRate = `${Math.floor(scaled / 10_000)}.${String(scaled % 10_000).padStart(4, '0')}`;

  return { winRate, quotesIssued, quotesWon };
}

const pending = await sql`
  SELECT id, tenant_id, created_at
  FROM sm8_connections
  WHERE baseline_computed_at IS NULL
  ORDER BY created_at
`;

if (pending.length === 0) {
  // "Nothing to do" and "there is nothing here" are different findings, and an
  // operator running this after a migration needs to be able to tell them
  // apart: a script that reports success against an empty table is exactly how
  // a mis-pointed DATABASE_URL goes unnoticed.
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM sm8_connections`;
  console.log(
    total === 0
      ? 'No ServiceM8 connections exist yet — nothing to backfill.'
      : `All ${total} connection(s) already carry a baseline. Nothing to do.`,
  );
  await sql.end({ timeout: 5 });
  process.exit(0);
}

console.log(`${pending.length} connection(s) without a baseline.\n`);

let written = 0;

for (const connection of pending) {
  const windowEnd = new Date(connection.created_at);
  const windowStart = new Date(windowEnd.getTime() - WINDOW_DAYS * 86_400_000);

  // Deleted-upstream jobs are excluded, matching the audit path: a job the
  // tradie removed from ServiceM8 is not part of the history they would
  // recognise, and it must not move a win rate they might be shown.
  const rows = await sql`
    SELECT status, quote_date_utc
    FROM quotes
    WHERE tenant_id = ${connection.tenant_id}
      AND sm8_active = true
      AND quote_date_utc IS NOT NULL
      AND quote_date_utc >= ${windowStart}
      AND quote_date_utc <= ${windowEnd}
  `;

  const baseline = computeBaseline(rows);
  const label =
    baseline.winRate === null
      ? 'no quotes in window → null (NOT zero)'
      : `${baseline.quotesWon}/${baseline.quotesIssued} → ${baseline.winRate}`;

  console.log(`  ${connection.tenant_id}  ${label}`);

  if (dryRun) continue;

  await sql`
    UPDATE sm8_connections
    SET baseline_win_rate = ${baseline.winRate},
        baseline_quotes_issued = ${baseline.quotesIssued},
        baseline_window_start = ${windowStart.toISOString().slice(0, 10)},
        baseline_window_end = ${windowEnd.toISOString().slice(0, 10)},
        baseline_computed_at = now()
    WHERE id = ${connection.id}
      AND baseline_computed_at IS NULL
  `;
  written += 1;
}

console.log(
  dryRun
    ? `\nDry run — nothing written. ${pending.length} connection(s) would be updated.`
    : `\nBaselines written: ${written}.`,
);

await sql.end({ timeout: 5 });
