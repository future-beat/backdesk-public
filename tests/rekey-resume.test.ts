/**
 * D-08 auto-resume: one paste brings a dead client back.
 *
 * The failure this suite exists to prevent is a HALF resume. A re-key touches
 * five things — the ciphertext, `paused_at`, `status_reason`,
 * `consecutive_failures` and `alerted_at` — and leaving any one of them behind
 * produces a client that looks fixed and is not:
 *
 *   `paused_at` left set     → the tick keeps skipping them. Banner might clear
 *                              on a reload; nothing syncs, ever.
 *   `alerted_at` left set    → the client is permanently muted. The NEXT time
 *                              their key dies, nobody is emailed.
 *   ciphertext not replaced  → polling resumes with the revoked key.
 *   pause cleared, key not   → same, plus the operator believes they fixed it.
 *
 * So the assertions are exhaustive over all five rather than spot-checking the
 * one the UI happens to read.
 *
 * THE FAILURE BRANCH IS THE OTHER HALF. A rejected key must leave the
 * connection exactly as it was — a re-key attempt with a typo must not clear
 * the pause, because a cleared pause with a bad key is worse than the pause.
 *
 * These run against the LIVE ServiceM8 trial account (SM8_TEST_API_KEY), which
 * a second developer or a CI runner may legitimately not have. That half skips
 * itself and says so; the source-contract assertions below are unconditional.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { credentialLast4, decodeEncryptionKey, encryptCredential } from '@/core/shared/crypto';
import { resumeConnection } from '@/core/sync/connect';
import { deriveHealth } from '@/core/sync/health';
import { closeDb, forTenant } from '@/db/repository';

import { canReachServiceM8, sm8TestApiKey } from './helpers/env';
import { seedConnection, seedTenant, teardownTenants } from './helpers/seed';

const tenants: string[] = [];

/** A connection that died on an auth failure — the state a re-key starts from. */
async function seedDeadConnection(prefix: string): Promise<{ tenantId: string }> {
  const tenantId = await seedTenant(prefix);
  tenants.push(tenantId);

  const key = decodeEncryptionKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
  await seedConnection(tenantId, {
    api_key_ciphertext: encryptCredential('revoked-key-abcd', key),
    key_last4: 'abcd',
    paused_at: new Date('2026-08-25T02:00:00Z').toISOString(),
    status_reason: 'auth_failed',
    consecutive_failures: 4,
    alerted_at: new Date('2026-08-25T02:00:00Z').toISOString(),
    last_success_at: new Date('2026-08-24T22:00:00Z').toISOString(),
    job_cursor: '2026-08-24 22:00:00',
  });

  return { tenantId };
}

beforeAll(() => {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error('These suites need CREDENTIALS_ENCRYPTION_KEY — see docs/env-vars.md');
  }
});

afterAll(async () => {
  await teardownTenants(tenants);
  await closeDb();
});

describe.skipIf(!canReachServiceM8)('resumeConnection — the good key (D-08)', () => {
  it('clears all four pause fields, replaces the key, and syncs immediately', async () => {
    const { tenantId } = await seedDeadConnection('Rekey Resume');
    const [before] = await forTenant(tenantId).connection.get();

    // The health the console would show before the paste — asserted here so
    // "the banner clears" is a claim about derived state rather than about a
    // screenshot nobody took.
    expect(
      deriveHealth({
        pausedAt: before.pausedAt,
        statusReason: before.statusReason,
        consecutiveFailures: before.consecutiveFailures,
        lastSuccessAt: before.lastSuccessAt,
      }),
    ).toBe('auth-failed');

    const result = await resumeConnection(tenantId, sm8TestApiKey!);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keyLast4).toBe(credentialLast4(sm8TestApiKey!));

    const [after] = await forTenant(tenantId).connection.get();

    // All four, exhaustively. Any one of them left behind is a half resume.
    expect(after.pausedAt).toBeNull();
    expect(after.statusReason).toBeNull();
    expect(after.consecutiveFailures).toBe(0);
    expect(
      after.alertedAt,
      'a re-key that leaves alerted_at set mutes this client permanently',
    ).toBeNull();

    // The credential really was replaced, and it is still stored encrypted.
    expect(after.apiKeyCiphertext).not.toBe(before.apiKeyCiphertext);
    expect(after.apiKeyCiphertext.startsWith('enc:v1:')).toBe(true);
    expect(after.keyLast4).toBe(credentialLast4(sm8TestApiKey!));

    // The console now derives the state the operator expects to see.
    expect(
      deriveHealth({
        pausedAt: after.pausedAt,
        statusReason: after.statusReason,
        consecutiveFailures: after.consecutiveFailures,
        lastSuccessAt: after.lastSuccessAt,
      }),
    ).toBe('healthy');

    // And the immediate cycle actually ran — the operator does not wait five
    // minutes to find out whether the fix worked.
    const runs = await forTenant(tenantId).syncRuns.recent();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].outcome).toBe('ok');
    expect(result.syncOutcome).toBe('ok');
    expect(after.lastSuccessAt!.getTime()).toBeGreaterThan(before.lastSuccessAt!.getTime());
  });

  it('does not re-run the 90-day backfill, so triage decisions survive', async () => {
    // The reason resume is its own function rather than a call to
    // connectServiceM8: the backfill writes `needs_review` over every open
    // quote, which would silently un-approve everything the operator triaged.
    const { tenantId } = await seedDeadConnection('Rekey Triage');
    const repo = forTenant(tenantId);

    await repo.quotes.upsertMany([
      {
        sm8JobUuid: '11111111-2222-3333-4444-555555555555',
        status: 'Quote',
        sm8Active: true,
        generatedJobId: '9001',
        jobAddress: null,
        jobDescription: 'Operator already approved this one',
        companyUuid: null,
        totalInvoiceAmount: '1200.00',
        quoteSent: true,
        editDateRaw: '2026-08-24 21:00:00',
        editDateUtc: new Date('2026-08-24T21:00:00Z'),
        dateRaw: null,
        quoteDateRaw: '2026-08-24 21:00:00',
        quoteDateUtc: new Date('2026-08-24T21:00:00Z'),
        workOrderDateRaw: null,
        workOrderDateUtc: null,
        completionDateRaw: null,
        completionDateUtc: null,
        unsuccessfulDateRaw: null,
        unsuccessfulDateUtc: null,
        quoteSentStampRaw: null,
        quoteSentStampUtc: null,
        syncSource: 'backfill',
        chaseEligibility: 'eligible',
      },
    ]);

    await resumeConnection(tenantId, sm8TestApiKey!);

    const [quote] = (await repo.quotes.list()).filter(
      (q) => q.sm8JobUuid === '11111111-2222-3333-4444-555555555555',
    );
    expect(quote.chaseEligibility).toBe('eligible');
  });
});

describe.skipIf(!canReachServiceM8)('resumeConnection — the bad key leaves the pause alone', () => {
  it('rejects a garbage key and changes nothing at all', async () => {
    const { tenantId } = await seedDeadConnection('Rekey Rejected');
    const [before] = await forTenant(tenantId).connection.get();

    const result = await resumeConnection(tenantId, 'not-a-real-servicem8-key-000');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('auth_failed');

    const [after] = await forTenant(tenantId).connection.get();

    // STILL paused. A cleared pause with a key that does not work is strictly
    // worse than the pause: the tick resumes, every cycle fails, and the
    // operator has been told the problem is fixed.
    expect(after.pausedAt?.getTime()).toBe(before.pausedAt?.getTime());
    expect(after.statusReason).toBe('auth_failed');
    expect(after.consecutiveFailures).toBe(before.consecutiveFailures);
    expect(after.alertedAt?.getTime()).toBe(before.alertedAt?.getTime());
    // And the rejected key was never stored, not even briefly.
    expect(after.apiKeyCiphertext).toBe(before.apiKeyCiphertext);
    expect(after.keyLast4).toBe(before.keyLast4);
  });

  it('says so plainly when there is no connection to re-key', async () => {
    const tenantId = await seedTenant('Rekey Unconnected');
    tenants.push(tenantId);

    const result = await resumeConnection(tenantId, sm8TestApiKey!);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Not 'no_such_tenant' — the tenant exists. Half-performing a connect here
    // would leave the client with no quote history and no way to notice.
    expect(result.kind).toBe('not_connected');
  });
});

/*
 * The pure `deriveHealth` rules — including the CR-02 staleness rule — live in
 * tests/sync-health.test.ts. They need no database, and keeping them here meant
 * the rules behind every badge in the console were only provable on a machine
 * with a live Supabase stack. What remains in THIS file is the part that is
 * genuinely integration: deriving health from a row that a real re-key just
 * wrote (above), which is a claim about the write, not about the function.
 */

/**
 * Strip comments before asserting on a source file.
 *
 * These files EXPLAIN the rules they follow — "`api_key_ciphertext` is not in
 * the select list and must never be", "persistent, not dismissible". A negative
 * assertion run over the raw text therefore fires on the prose describing the
 * property rather than on a violation of it, which is a test that punishes
 * documenting the invariant. Strip the commentary, assert on the code.
 *
 * Line comments are only stripped when they START a line, so the `//` in a
 * `https://` URL survives.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('console contract (source assertions)', () => {
  const CSS = readFileSync('src/app/globals.css', 'utf8');
  const LIST = code(readFileSync('src/app/(console)/clients/page.tsx', 'utf8'));
  const DETAIL = code(readFileSync('src/app/(console)/clients/[id]/page.tsx', 'utf8'));

  it('--ok and --warn are declared in BOTH the light and dark blocks', () => {
    // A token declared only in :root renders its light value against a dark
    // background — a contrast failure that only appears on the device the
    // operator actually uses.
    const dark = CSS.slice(CSS.indexOf('prefers-color-scheme: dark'));

    for (const token of ['--ok', '--warn']) {
      expect(CSS.slice(0, CSS.indexOf('prefers-color-scheme: dark'))).toContain(`${token}:`);
      expect(dark).toContain(`${token}:`);
    }
  });

  it('defines the four badge modifiers and the banner block', () => {
    for (const rule of ['.badge--ok', '.badge--warn', '.badge--error', '.banner-error']) {
      expect(CSS).toContain(rule);
    }
    // 3px left accent per the UI-SPEC.
    expect(CSS).toMatch(/border-left-width:\s*3px/);
  });

  it('both pages derive health rather than inventing it', () => {
    for (const source of [LIST, DETAIL]) {
      expect(source).toMatch(/deriveHealth/);
      expect(source).toMatch(/HEALTH_BADGE_CLASS/);
      expect(source).toMatch(/HEALTH_LABELS/);
      // No literal health-state string built in a page file — every one of them
      // has exactly one origin (src/core/sync/health.ts).
      expect(source).not.toMatch(/['"]auth failed['"]/);
      expect(source).not.toMatch(/['"]never synced['"]/);
      expect(source).not.toMatch(/['"]degraded['"]/);
    }
  });

  it('the banner renders only for auth-failed, with the exact UI-SPEC copy', () => {
    expect(DETAIL).toMatch(/health === 'auth-failed'/);
    expect(DETAIL).toContain('ServiceM8 connection failed — follow-ups paused.');
    expect(DETAIL).toContain('The API key was rejected on');
    expect(DETAIL).toContain('Save a new');
    expect(DETAIL).toContain('key below to verify and resume automatically.');
    expect(DETAIL).toContain('role="alert"');
    // Not dismissible: no close control anywhere near the banner.
    expect(DETAIL).not.toMatch(/dismiss|Dismiss/);
  });

  it('the sync-runs table shows classified outcomes and the exact empty state', () => {
    expect(DETAIL).toContain('Recent sync runs');
    expect(DETAIL).toContain('No sync runs yet.');
    expect(DETAIL).toMatch(/syncOutcomeLabel/);
    // error_detail is not rendered — it is a classified kind redundant with
    // `outcome`, and a column that looks like detail but is not is worse than
    // no column (T-2-16).
    expect(DETAIL).not.toMatch(/\{run\.error_detail\}/);
  });

  it('neither page selects the credential envelope', () => {
    for (const source of [LIST, DETAIL]) {
      expect(source).not.toMatch(/api_key_ciphertext/);
    }
  });

  it('the re-key CTA uses the UI-SPEC label', () => {
    const form = code(readFileSync('src/app/(console)/clients/[id]/connect-form.tsx', 'utf8'));
    expect(form).toContain('Save new key & resume');
    expect(form).toContain('Verifying key…');
    expect(DETAIL).toContain('Replace key');
  });
});
