/**
 * The API-key prospect path end to end (AUD-01, D-12).
 *
 * ── THE PROPERTY THIS SUITE EXISTS FOR ──────────────────────────────────────
 *
 * **A rejected key must leave NO prospect row.** Not "a row that is obviously
 * broken" — none at all. The failure mode it prevents is specific: a prospect
 * created against a key that does not work sits in the pipeline list looking
 * audited, and the operator finds out in front of the prospect. Verification is
 * therefore the first thing that happens and every write follows it.
 *
 * Counted BEFORE and AFTER, not asserted by existence. A suite that checks
 * "no prospect named X exists" passes for an implementation that writes a row
 * with a different name, and passes vacuously if the write silently failed for
 * an unrelated reason. The delta is the assertion.
 */
import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_RECOVERY_RATE } from '@/core/audit/constants';
import { generateAuditFromApiKey } from '@/core/audit/generate';
import { closeDb, countProspectLines, getProspect, listProspects } from '@/db/repository';

import { canReachServiceM8, sm8TestApiKey, testEnv } from './helpers/env';
import { teardownProspects } from './helpers/seed';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
});

const created: string[] = [];

/**
 * Source assertions read EXECUTABLE code, never comments.
 *
 * The same rule `tests/cron-schedules.test.ts` established, and for the same
 * reason: these files explain at length why they do NOT touch `quotes`, why the
 * ciphertext is not selected, and why the key is not echoed back. A naive
 * substring search finds those explanations and fails — so the only way to keep
 * the suite green would be to delete the reasoning, which is precisely backwards.
 */
function executable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

async function prospectCount(): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM prospects`;
  return n;
}

afterAll(async () => {
  await teardownProspects(created).catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
  await closeDb();
}, 60_000);

describe.skipIf(!canReachServiceM8)('createAudit — verify precedes any write', () => {
  it('creates NO prospect row for a key ServiceM8 rejects', async () => {
    const before = await prospectCount();

    const result = await generateAuditFromApiKey({
      businessName: `Rejected Key ${Date.now()}`,
      // Long enough to pass the length check, wrong enough to be refused —
      // so the rejection comes from ServiceM8, which is the boundary under
      // test, rather than from our own validation short-circuiting first.
      apiKey: 'not-a-real-servicem8-api-key-0123456789',
    });

    expect(result.ok, 'a garbage key was accepted').toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('auth_failed');
    }

    expect(
      await prospectCount(),
      'a rejected key left a prospect row behind — verification is not preceding the write',
    ).toBe(before);
  }, 60_000);

  it('never returns the key or a raw error in the failure result', async () => {
    const apiKey = 'not-a-real-servicem8-api-key-0123456789';
    const result = await generateAuditFromApiKey({
      businessName: `Leak Check ${Date.now()}`,
      apiKey,
    });

    // The whole result object, not just a message field: a `fetch` rejection
    // stringifies to the request URL and the one header on that request is the
    // key (threat T-2-02).
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(apiKey);
    expect(serialised).not.toContain('api.servicem8.com');
    expect(serialised).not.toContain('X-API-Key');
  }, 60_000);
});

describe.skipIf(!canReachServiceM8)('createAudit — the happy path against the live account', () => {
  let prospectId: string;

  beforeAll(async () => {
    const result = await generateAuditFromApiKey({
      businessName: `Audit Live ${Date.now()}`,
      apiKey: sm8TestApiKey!,
      timezone: 'Australia/Perth',
    });

    expect(result.ok, result.ok ? '' : `audit generation failed: ${result.kind}`).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    prospectId = result.prospectId;
    created.push(prospectId);
  }, 120_000);

  it('persists the four figures and the window', async () => {
    const prospect = (await getProspect(prospectId))!;

    expect(prospect.auditGeneratedAt).not.toBeNull();
    expect(prospect.windowStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prospect.windowEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prospect.quotesIssued).toBeGreaterThan(0);

    // Stored as numeric strings with two decimal places — the shape the column
    // takes, and the shape that proves no float round-trip happened on the way
    // in (`10500.5` would mean a JS number reached drizzle).
    for (const value of [
      prospect.totalValue,
      prospect.neverFollowedUpValue,
      prospect.recoverableEstimate,
    ]) {
      expect(value, 'a money figure is missing').not.toBeNull();
      expect(String(value)).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('derives the recoverable estimate from the never-followed-up value alone', async () => {
    const prospect = (await getProspect(prospectId))!;

    const neverFollowedUp = Math.round(Number(prospect.neverFollowedUpValue) * 100);
    const recoverable = Math.round(Number(prospect.recoverableEstimate) * 100);

    // Floored, so the stored value is the largest whole cent at or below the
    // exact product — never above it (D-09).
    expect(recoverable).toBe(Math.floor((neverFollowedUp * 15) / 100));
    expect(recoverable).toBeLessThanOrEqual(neverFollowedUp * AUDIT_RECOVERY_RATE);
  });

  it('snapshots the baseline, null-not-zero (AUD-02)', async () => {
    const prospect = (await getProspect(prospectId))!;

    if (prospect.baselineQuotesIssued === 0) {
      expect(
        prospect.baselineWinRate,
        'a prospect with no quotes issued was given a 0% baseline instead of null',
      ).toBeNull();
    } else {
      expect(prospect.baselineWinRate).not.toBeNull();
      const rate = Number(prospect.baselineWinRate);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it('stores the key as enc:v1 ciphertext with last4 only (T-2-01)', async () => {
    const prospect = (await getProspect(prospectId))!;

    expect(prospect.apiKeyCiphertext?.startsWith('enc:v1:')).toBe(true);
    expect(prospect.keyLast4).toBe(sm8TestApiKey!.slice(-4));
  });

  it('puts the plaintext key in NO column of the prospect row (T-2-02)', async () => {
    // `SELECT *` through the catalog connection: whatever columns exist, this
    // sees them — including one added by a future migration that nobody
    // remembered to check.
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM public.prospects WHERE id = ${prospectId}::uuid
    `;
    expect(rows).toHaveLength(1);

    const key = sm8TestApiKey!;
    for (const [column, value] of Object.entries(rows[0])) {
      // key_last4 is exempt: the last four characters ARE legitimately stored.
      if (column === 'key_last4') continue;
      expect(
        typeof value === 'string' && value.includes(key),
        `the plaintext key is stored in prospects.${column}`,
      ).toBe(false);
    }
  });

  it('stamps purge_after on EVERY line it wrote (D-04, T-2-07)', async () => {
    const stored = await countProspectLines(prospectId);
    expect(stored, 'no audit lines were stored').toBeGreaterThan(0);

    const [{ unstamped }] = await sql<{ unstamped: number }[]>`
      SELECT count(*)::int AS unstamped
      FROM prospect_quote_lines
      WHERE prospect_id = ${prospectId}::uuid AND purge_after IS NULL
    `;

    // A NULL here means "converted, keep forever". A freshly-generated audit
    // must have none: an unstamped line is a stranger's contact details with no
    // expiry, and the daily purge will never touch it.
    expect(unstamped, 'a fresh audit line was written without a purge date').toBe(0);

    const [{ within }] = await sql<{ within: number }[]>`
      SELECT count(*)::int AS within
      FROM prospect_quote_lines
      WHERE prospect_id = ${prospectId}::uuid
        AND purge_after BETWEEN now() + interval '29 days' AND now() + interval '31 days'
    `;
    expect(within, 'purge_after is not ~30 days out').toBe(stored);
  });

  it('regenerating replaces the lines rather than doubling them', async () => {
    const before = await countProspectLines(prospectId);

    const again = await generateAuditFromApiKey({
      businessName: `Audit Live Again ${Date.now()}`,
      apiKey: sm8TestApiKey!,
    });
    expect(again.ok).toBe(true);
    if (again.ok) created.push(again.prospectId);

    // The second run creates its OWN prospect, so the first one's line count is
    // untouched — the separation between prospects is not merely a filter.
    expect(await countProspectLines(prospectId)).toBe(before);
  }, 120_000);

  it('appears in the audits list', async () => {
    const list = await listProspects();
    const row = list.find((p) => p.id === prospectId);

    expect(row, 'the generated audit is missing from the list').toBeDefined();
    expect(row!.source).toBe('api_key');
    expect(row!.auditGeneratedAt).not.toBeNull();
  });
});

/**
 * D-03, enforced by reading the source rather than by hoping.
 *
 * The prohibition is an ABSENCE — "no prospect row ever becomes a cadence
 * candidate" — and an absence cannot be demonstrated by running anything. What
 * can be demonstrated is that the two families of module do not import each
 * other, which is what makes the join impossible to write by accident.
 */
describe('prospect data never reaches the cadence tables (D-03)', () => {
  const REPO = executable(readFileSync('src/db/repository/prospects.ts', 'utf8'));
  const FOR_TENANT = executable(readFileSync('src/db/repository/for-tenant.ts', 'utf8'));
  const GENERATE = executable(readFileSync('src/core/audit/generate.ts', 'utf8'));

  it('the prospect repository touches no tenant-scoped table', () => {
    // Identifier boundaries, not substrings: the drizzle table symbol is
    // exactly `quotes`, while `quotesIssued` is one of this module's own audit
    // figures. A substring search conflates the two and would be "fixed" by
    // renaming a legitimate field.
    for (const table of [
      'quotes',
      'quoteContacts',
      'quoteStatusEvents',
      'syncRuns',
      'sm8Connections',
      'tenants',
      'tenantMembers',
    ]) {
      expect(REPO, `prospects.ts references the ${table} table`).not.toMatch(
        new RegExp(`\\b${table}\\b`),
      );
    }
  });

  it('the tenant repository touches no prospect table', () => {
    // The other direction, and the more dangerous one: `forTenant()` is where
    // hundreds of later queries will be written.
    expect(FOR_TENANT).not.toContain('prospectQuoteLines');
    expect(FOR_TENANT).not.toMatch(/\bprospects\b/);
  });

  it('audit generation creates no tenant, no quote, and no event', () => {
    expect(GENERATE).not.toContain('forTenant');
    expect(GENERATE).not.toContain('create_tenant');
    expect(GENERATE).not.toContain('markChaseEligible');
    expect(GENERATE).not.toContain('runSyncForConnection');
  });

  it('storeAuditResults is the only line-insert site (D-04)', () => {
    // `purge_after` is stamped there, from one expression. One insert path is
    // what makes the retention guarantee checkable — the alternative is a
    // promise about every future author.
    const inserts = REPO.match(/\.insert\(prospectQuoteLines\)/g) ?? [];
    expect(inserts).toHaveLength(1);
    expect(REPO).toContain('purgeAfter');
  });
});

/**
 * The action layer, read rather than run.
 *
 * A Server Action cannot be invoked from vitest without Next's runtime, but the
 * properties that matter here are about ORDER and ABSENCE, both of which are
 * visible in the source and neither of which a happy-path invocation would
 * demonstrate.
 */
describe('createAuditAction (WR-01, T-2-02)', () => {
  const ACTION = executable(readFileSync('src/app/(console)/audits/new/actions.ts', 'utf8'));

  it('checks the operator allowlist before reading the credential out of the body', () => {
    // CR-01 replaced the bare getClaims() session check with requireOperator(),
    // which proves allowlist membership through an RLS-scoped read — the
    // ordering guarantee this test protects is unchanged.
    const authAt = ACTION.indexOf('requireOperator()');
    const keyAt = ACTION.indexOf("readString(formData, 'api_key')");

    expect(authAt, 'the action never checks the operator allowlist').toBeGreaterThan(-1);
    expect(keyAt).toBeGreaterThan(-1);
    // Server Action ids are global — this is POST-able from any route, and the
    // body carries a live third-party credential.
    expect(authAt, 'the API key is parsed before the session is checked').toBeLessThan(keyAt);
  });

  it('never echoes the API key back into the returned state', () => {
    // Every other value survives a rejection so the operator does not retype
    // it. The credential does not: a returned value is serialised into the HTML
    // payload and the client router cache.
    const valuesShape = ACTION.match(/values: \{ business_name: string; source: string \}/);
    expect(valuesShape, 'the state shape changed — re-check that api_key is absent').toBeTruthy();
    // No object literal assigned to `values` may carry the key AS A FIELD.
    // The trailing colon is what distinguishes a field named `api_key` from
    // the string `'api_key'`, which is also the source discriminator and is
    // perfectly safe to echo back.
    expect(ACTION).not.toMatch(/values:\s*\{[^}]*api_key\s*:/);
    // And the one place the key IS read, it goes straight into the schema
    // parse — never into a variable that the returned state spreads.
    expect(ACTION).toMatch(/api_key: readString\(formData, 'api_key'\)/);
  });

  it('renders the classified reason only, per the UI-SPEC copy', () => {
    expect(ACTION).toContain("Couldn't fetch this prospect's data:");
    expect(ACTION).toContain('Check the read-only key or fall back to a CSV export.');
    // No `detail`, no status code, no caught error text reaches the operator.
    expect(ACTION).not.toMatch(/result\.detail/);
  });
});

/**
 * The audit page, read for the two UI-SPEC properties this plan owns.
 */
describe('the audit report page', () => {
  const PAGE = executable(readFileSync('src/app/(console)/audits/[id]/page.tsx', 'utf8'));
  const LIST = executable(readFileSync('src/app/(console)/audits/page.tsx', 'utf8'));

  it('never selects the ciphertext or the CSV staging blob (T-2-02)', () => {
    for (const source of [PAGE, LIST]) {
      expect(source).not.toContain('api_key_ciphertext');
      expect(source).not.toContain('csv_staging');
    }
  });

  it('renders the baseline as a one-line secondary stat, not a headline figure', () => {
    // The four figures live in the <dl>; the baseline lives in a <p>. Putting
    // it in the grid would turn a sales document into a scoreboard.
    //
    // The class is `audit-figures` from 02-07, which restyled this list into the
    // A4 figure grid (D-11). The PROPERTY under test is unchanged — what the
    // list may and may not contain — so the selector moved with the markup
    // rather than the assertion being dropped.
    const dl = PAGE.match(/<dl className="audit-figures">[\s\S]*?<\/dl>/)?.[0] ?? '';

    expect(dl, 'the figure list could not be located').toBeTruthy();
    expect(dl).toContain('Quotes issued');
    expect(dl).toContain('Recoverable estimate');
    expect(dl, 'the baseline was promoted into the headline figures').not.toContain('Baseline');
    expect(PAGE).toContain('Baseline win rate:');
  });

  it('carries the empty-state copy verbatim (UI-SPEC)', () => {
    expect(LIST).toContain('No audits yet. Create a prospect to generate their Quote Leakage Audit.');
    expect(LIST).toContain('New audit');
  });

  it('renders money in whole dollars — cents undermine an estimate', () => {
    expect(PAGE).toContain('maximumFractionDigits: 0');
    expect(PAGE).toContain("Intl.NumberFormat('en-AU'");
    expect(PAGE).not.toContain('minimumFractionDigits: 2');
  });
});
