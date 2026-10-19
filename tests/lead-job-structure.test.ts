/**
 * Phase 14 (SM8-02, SM8-03; D-06, D-12, D-13; T-14-09, T-14-13): the absences
 * the job-creation tracer relies on, pinned in source.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PROPERTIES ARE ABSENCES. The create path never emits a quote event,  │
 * │ never grants `eligible`, never opens a second transaction, never calls   │
 * │ the closeLead wrapper, never logs a caller's words — and the sync never  │
 * │ writes to ServiceM8. A behavioural test proves what one path did; these  │
 * │ prove what the files COULD do.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE, SOURCE-READING.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CREATE = 'src/core/leads/create-job.ts';
const PROVISION = 'src/core/leads/job-provision.ts';
const RUN_SYNC = 'src/core/sync/run-sync.ts';

function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the create path joins the quote cadence only through review (D-06, T-14-13)', () => {
  it.each([CREATE, PROVISION])('%s emits no quote event and grants no eligibility', (path) => {
    const source = code(path);
    expect(source).not.toContain('events.insertMany');
    expect(source).not.toContain('classifyTransition');
    expect(source).not.toContain('quoteStatusEvents');
    expect(source).not.toContain('markChaseEligible');
    expect(source).not.toMatch(/chaseEligibility:\s*'eligible'/);
  });
});

describe('one unit of work, on the caller handle (D-04, D-05)', () => {
  it('create-job.ts opens exactly one transaction', () => {
    expect(code(CREATE).match(/\.transaction\(/g) ?? []).toHaveLength(1);
  });

  it('create-job.ts closes the lead with closeLeadInTx on that handle, never the wrapper', () => {
    const source = code(CREATE);
    expect(source).not.toMatch(/\bcloseLead\(/);
    expect(source).toMatch(/closeLeadInTx\(tx, leadId, 'job_created'/);
  });

  it('job-provision.ts opens no transaction and reaches no repository', () => {
    const source = code(PROVISION);
    expect(source).not.toContain('.transaction(');
    expect(source).not.toContain('forTenant(');
    expect(source).not.toMatch(/from '@\/db\/repository'/);
  });
});

describe('logs carry ids and kinds only (T-14-09)', () => {
  /** Identifiers a log line may interpolate: ids, uuids, a kind, a count. */
  const ALLOWED = /(Id|Uuid|kind|Kind|count|Count)$/;

  it.each([CREATE, PROVISION])('%s interpolates only ids, uuids, kinds and counts into console calls', (path) => {
    const source = code(path);
    const calls = source.match(/console\.\w+\(([\s\S]*?)\);/g) ?? [];
    for (const call of calls) {
      const interpolated = [...call.matchAll(/\$\{\s*([^}]+?)\s*\}/g)].map((m) => m[1]);
      for (const expression of interpolated) {
        expect(expression, call).toMatch(/^[A-Za-z_$][\w$]*$/);
        expect(expression, call).toMatch(ALLOWED);
      }
    }
  });

  it('job-provision.ts logs nothing at all — the caller logs', () => {
    expect(code(PROVISION)).not.toMatch(/console\./);
  });
});

describe('the sync never writes to ServiceM8 (D-12)', () => {
  it('run-sync.ts imports no write module and makes no post', () => {
    const source = code(RUN_SYNC);
    expect(source).not.toMatch(/from '\.\/writes'/);
    expect(source).not.toMatch(/from '@\/core\/servicem8\/writes'/);
    expect(source).not.toMatch(/\bpost\(/);
  });
});

// ── Plan 14-03: the tradie-booked pass on the sync's post-commit (D-07, D-12,
// D-13; T-14-07, T-14-09, T-14-10) ──────────────────────────────────────────

const BOOKED = 'src/core/leads/booked-by-tradie.ts';
const MATCH = 'src/core/leads/job-match.ts';

describe('the tradie-booked pass rides the sync AFTER its transaction commits (D-12, D-13)', () => {
  it('run-sync.ts calls resolveLeadsBookedByTradie exactly once, after the transaction and before the return', () => {
    const source = code(RUN_SYNC);
    const calls = source.match(/resolveLeadsBookedByTradie\(/g) ?? [];
    expect(calls).toHaveLength(1);

    const txAt = source.indexOf('await repo.transaction(');
    const callAt = source.indexOf('resolveLeadsBookedByTradie(');
    const returnAt = source.indexOf('return {', callAt);
    expect(txAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(txAt);
    // The transaction's own body has closed before the hook: the next `});`
    // after the transaction opens comes before the call.
    expect(source.lastIndexOf('});', callAt)).toBeGreaterThan(txAt);
    expect(returnAt).toBeGreaterThan(callAt);
  });

  it('the call sits in a try whose catch logs a fixed string with the tenant id only', () => {
    const source = code(RUN_SYNC);
    const block = /try\s*\{\s*await resolveLeadsBookedByTradie\([^)]*\)[^}]*\}\s*catch\s*\{\s*(console\.error\(([^;]*)\);)\s*\}/.exec(
      source,
    );
    expect(block, 'the hook must be a try/catch with a single console.error').not.toBeNull();
    const interpolated = [...block![2].matchAll(/\$\{\s*([^}]+?)\s*\}/g)].map((m) => m[1]);
    expect(interpolated).toEqual(['conn.tenantId']);
  });

  it('run-sync.ts does not import create-job (create-job imports run-sync: no cycle)', () => {
    const source = code(RUN_SYNC);
    expect(source).not.toMatch(/from '@\/core\/leads\/create-job'/);
    expect(source).not.toMatch(/from '\.\.\/leads\/create-job'/);
  });

  it('SyncCycleResult gains no field for the pass (OQ3)', () => {
    expect(code(RUN_SYNC)).not.toContain('leadsResolved');
  });
});

describe('booked-by-tradie.ts reads ServiceM8 and never writes it (D-12)', () => {
  it('makes no post, no create, and imports no write module', () => {
    const source = code(BOOKED);
    expect(source).not.toMatch(/\bpost\(/);
    expect(source).not.toMatch(/\bcreateJob\b/);
    expect(source).not.toMatch(/\bcreateCompany\b/);
    expect(source).not.toMatch(/from '@\/core\/servicem8\/writes'/);
    expect(source).not.toMatch(/from '@\/core\/leads\/create-job'/);
  });

  it('opens exactly one transaction, and closes only with closeLeadInTx on it', () => {
    const source = code(BOOKED);
    expect(source.match(/\.transaction\(/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/\bcloseLead\(/);
    expect(source).toMatch(/closeLeadInTx\(tx, leadId, 'booked_by_tradie'/);
  });

  it('caps the company-contact reads with the constant', () => {
    const source = code(BOOKED);
    expect(source).toContain('LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE');
    expect(source).toContain("'companycontact.json'");
  });

  it('compares numbers in TypeScript, never with SQL string munging', () => {
    for (const path of [BOOKED, MATCH]) {
      const source = code(path);
      expect(source).not.toMatch(/replace\(\s*['"`]?\s*\$\{/);
      expect(source).not.toMatch(/sql`[^`]*replace\(/i);
    }
    expect(code(MATCH)).toContain('normalizeAuMobile');
  });

  it('job-match.ts is pure: no repository, no ServiceM8 client, no transaction', () => {
    const source = code(MATCH);
    expect(source).not.toMatch(/from '@\/db\//);
    expect(source).not.toMatch(/from '@\/core\/servicem8\//);
    expect(source).not.toContain('.transaction(');
    expect(source).not.toMatch(/console\./);
  });

  it('logs carry ids and counts only (T-14-09)', () => {
    const ALLOWED = /(Id|Uuid|kind|Kind|count|Count|Reads|resolved|Failed)$/;
    const source = code(BOOKED);
    const calls = source.match(/console\.\w+\(([\s\S]*?)\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const interpolated = [...call.matchAll(/\$\{\s*([^}]+?)\s*\}/g)].map((m) => m[1]);
      for (const expression of interpolated) {
        expect(expression, call).toMatch(/^[A-Za-z_$][\w$]*$/);
        expect(expression, call).toMatch(ALLOWED);
      }
    }
    expect(source).not.toMatch(/contactMobile\s*\}/);
  });
});

// ── 14-03 deviation A: the SM8-02 gap — an orphan job of a lead's failed
// attempt is mirrored needs_review / lead on first sight, and emits nothing.

describe('the first-sight guard for a lead-linked job (SM8-02)', () => {
  it('run-sync.ts reads the lead linkage of UNSEEN jobs inside the cycle transaction', () => {
    const source = code(RUN_SYNC);
    expect(source.match(/tx\.leads\.jobUuidsLinkedAmong\(/g) ?? []).toHaveLength(1);
    const txAt = source.indexOf('await repo.transaction(');
    const readAt = source.indexOf('tx.leads.jobUuidsLinkedAmong(');
    const upsertAt = source.indexOf('tx.quotes.upsertManyReturning(');
    expect(readAt).toBeGreaterThan(txAt);
    expect(readAt).toBeLessThan(upsertAt);
  });

  it('such a row lands needs_review / lead, never eligible, and the event loop skips it', () => {
    const source = code(RUN_SYNC);
    expect(source).toMatch(/syncSource = 'lead'/);
    expect(source).toMatch(/chaseEligibility = 'needs_review'/);
    expect(source).toMatch(/if \(leadLinked\.has\(job\.sm8JobUuid\)\) continue;/);
    // The skip comes BEFORE the classifier, so no event of any type is built.
    expect(source.indexOf('if (leadLinked.has(job.sm8JobUuid)) continue;')).toBeLessThan(
      source.indexOf('classifyTransition('),
    );
  });
});

// ── 14-03 deviation B: an abandoned `creating` claim is released by the same
// post-commit pass, through one guarded UPDATE.

describe('the stale-claim release rides the same pass (14-03 deviation B)', () => {
  it('booked-by-tradie.ts releases stale claims with the pure cutoff, before the match', () => {
    const source = code(BOOKED);
    expect(source).toMatch(/failStaleJobClaims\(staleJobClaimCutoff\(now\), now\)/);
    expect(source.indexOf('failStaleJobClaims(')).toBeLessThan(source.indexOf('listOpenForJobMatch('));
  });

  it('the repository UPDATE is guarded on creating and strictly before the cutoff, kind stale_claim', () => {
    const source = readFileSync('src/db/repository/for-tenant.ts', 'utf-8');
    const at = source.indexOf('failStaleJobClaims: (cutoff: Date, at: Date) =>');
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('.returning(', at));
    expect(body).toContain("sm8JobErrorKind: 'stale_claim'");
    expect(body).toContain("sm8JobState: 'failed'");
    expect(body).toContain('eq(leads.tenantId, tenantId)');
    expect(body).toContain("eq(leads.sm8JobState, 'creating')");
    expect(body).toContain('lt(leads.sm8JobAttemptedAt, cutoff)');
  });
});
