/**
 * CR-03: the CSV staging workspace has a clock, and something enforces it.
 *
 * ── WHY THESE ARE SOURCE AND MIGRATION ASSERTIONS ───────────────────────────
 *
 * The defect was an ABSENCE — `prospects.csv_staging` held a full copy of a
 * stranger's customer list with no `purge_after`, no expiry column and no
 * scheduled job, cleared only by a SUCCESSFUL mapping confirmation. Every other
 * exit from the flow (navigate away, a rejected mapping, a forgotten prospect)
 * leaked it indefinitely.
 *
 * The enforcement lives in two places that a behavioural test cannot cover
 * together: a pg_cron schedule (proved against a live catalog in
 * tests/cron-schedules.test.ts, which needs a database) and the write path that
 * stamps the clock. What is asserted here is the CONTRACT BETWEEN THEM — that
 * the column the sweep filters on is the column the writer stamps, and that both
 * agree on the window. That contract is exactly what silently breaks when
 * someone edits one side, and it needs no database to check.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CSV_STAGING_RETENTION_HOURS } from '@/db/schema';

const MIGRATION = readFileSync(
  'src/db/migrations/0015_prospect_staging_expiry.sql',
  'utf-8',
);

/** Strip SQL line comments so prose describing a rule cannot satisfy an assertion. */
const migrationSql = MIGRATION.replace(/^\s*--.*$/gm, '');

function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('csv_staging retention — the migration (CR-03)', () => {
  it('adds the expiry column', () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE public\.prospects\s+ADD COLUMN IF NOT EXISTS csv_staging_expires_at timestamptz/i,
    );
  });

  it('backfills rows staged before the policy existed', () => {
    // The pre-migration cohort is the one that has been sitting there longest.
    // Without a backfill it is the one cohort the sweep never reaches.
    expect(migrationSql).toMatch(/UPDATE public\.prospects/i);
    expect(migrationSql).toMatch(/SET csv_staging_expires_at = now\(\)/i);
  });

  it('schedules an hourly sweep', () => {
    expect(migrationSql).toMatch(/cron\.schedule\(\s*'prospect-staging-sweep'/);
    // Hourly, at :20 — clear of the 5-minute tick, of prospect-line-purge
    // (03:15) and of cron-details-cleanup (03:30).
    expect(migrationSql).toMatch(/'20 \* \* \* \*'/);
  });

  it('is idempotent: unschedule-if-present before schedule', () => {
    // cron.unschedule RAISES when the job is absent, so the existence check is
    // required rather than defensive — re-running the migration must not fail.
    expect(migrationSql).toMatch(
      /IF EXISTS \(SELECT 1 FROM cron\.job WHERE jobname = 'prospect-staging-sweep'\)/,
    );
    expect(migrationSql).toMatch(/PERFORM cron\.unschedule\('prospect-staging-sweep'\)/);
  });

  it('the sweep clears BOTH columns, not just the payload', () => {
    // An expiry left behind on a row with no staging is a row the hourly job
    // re-examines forever to delete nothing.
    const sweep = migrationSql.slice(migrationSql.indexOf("'prospect-staging-sweep'"));
    expect(sweep).toMatch(/SET csv_staging = NULL, csv_staging_expires_at = NULL/);
  });

  it('the sweep only ever touches EXPIRED staged rows', () => {
    const sweep = migrationSql.slice(migrationSql.indexOf("'prospect-staging-sweep'"));

    // All three predicates. Dropping the last one would wipe every operator's
    // in-progress upload on the next hour boundary.
    expect(sweep).toMatch(/WHERE csv_staging IS NOT NULL/);
    expect(sweep).toMatch(/AND csv_staging_expires_at IS NOT NULL/);
    expect(sweep).toMatch(/AND csv_staging_expires_at < now\(\)/);

    // And it is an UPDATE, never a DELETE: the prospect is a sales record that
    // outlives their staged upload.
    expect(sweep).not.toMatch(/DELETE\s+FROM\s+prospects/i);
  });

  it('does not touch prospect_quote_lines — that is 0014 job', () => {
    // The two retention policies have different windows and different owners.
    // Merging them is how a 24-hour rule quietly starts deleting 30-day data.
    expect(migrationSql).not.toMatch(/prospect_quote_lines/);
  });
});

describe('csv_staging retention — the write path (CR-03)', () => {
  const repo = code('src/db/repository/prospects.ts');

  it('createProspect stamps the expiry whenever something is staged', () => {
    expect(repo).toMatch(/csvStagingExpiresAt: values\.csvStaging/);
  });

  it('the stamp is computed by Postgres, not by this process clock', () => {
    // Same argument as purge_after: a container with skew would otherwise write
    // a workspace that is already expired, or one that outlives the policy.
    expect(repo).toMatch(/csvStagingExpiresAt: values\.csvStaging\s*\?\s*sql`now\(\) \+ interval/);
  });

  it('storeAuditResults clears the expiry alongside the staging payload', () => {
    expect(repo).toMatch(/csvStaging: null,\s*csvStagingExpiresAt: null/);
  });

  it('a caller cannot stage data without an expiry', () => {
    // The guarantee is structural, not a promise about future authors:
    // `csvStagingExpiresAt` is absent from ProspectCreate, so there is no way to
    // supply one -- or to supply staging with a null one -- through this type.
    const created = repo.slice(
      repo.indexOf('export type ProspectCreate'),
      repo.indexOf('export interface ProspectLineInput'),
    );
    expect(created).toContain('csvStaging');
    expect(created).not.toContain('csvStagingExpiresAt');
  });
});

describe('csv_staging retention — the two sides agree', () => {
  it('the constant matches the interval the migration backfills with', () => {
    expect(migrationSql).toContain(`interval '${CSV_STAGING_RETENTION_HOURS} hours'`);
  });

  it('the window is hours, not days — this is a workspace, not a record', () => {
    expect(CSV_STAGING_RETENTION_HOURS).toBe(24);
  });
});

/**
 * Not strictly CR-03, but the trap this migration had to step around, and the
 * one the 02-06 summary records as having fired on three consecutive plans:
 * drizzle-kit stamps `when` from the wall clock, while every migration from 0004
 * on carries a hand-picked value that leads it. `scripts/migrate.mjs` skips any
 * entry older than the last applied, so a generated stamp makes the migration a
 * silent no-op — `migrate` exits 0, the column never exists, and the first
 * symptom is a runtime error somewhere else entirely.
 */
describe('migration journal ordering', () => {
  const journal = JSON.parse(
    readFileSync('src/db/migrations/meta/_journal.json', 'utf-8'),
  ) as { entries: Array<{ idx: number; when: number; tag: string }> };

  it('`when` increases monotonically across every entry', () => {
    const outOfOrder = journal.entries
      .slice(1)
      .filter((entry, i) => entry.when <= journal.entries[i].when)
      .map((entry) => entry.tag);

    expect(outOfOrder).toEqual([]);
  });

  it('`idx` matches position, so nothing was inserted mid-history', () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(
      journal.entries.map((_, i) => i),
    );
  });

  it('every entry is tagged with a name, not a generated codename', () => {
    // `0013_fast_pixie` names nothing, in a directory people read to find out
    // where a table came from.
    for (const entry of journal.entries) {
      expect(entry.tag).toMatch(/^\d{4}_[a-z0-9_]+$/);
    }
  });
});
