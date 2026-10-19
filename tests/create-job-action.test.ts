/**
 * Phase 14 (D-01; T-14-01, T-14-09): the create-ServiceM8-job action proves
 * operator status BEFORE it reads a byte of the body, authorises the tenant
 * through the operator's own JWT before the form is parsed, and answers in
 * fixed sentences keyed by the closed vocabulary.
 *
 * PURE, SOURCE-READING: the order of three calls in one file and the key set
 * of one map. No database, no network, no session.
 *
 * The vocabulary const is imported HERE, in the test, and never by the leaf:
 * the leaf is client-reachable and the schema module reaches Postgres
 * (tests/lint-ban.test.ts, CLIENT_REACHABLE).
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CREATE_JOB_SENTENCES } from '../src/app/(console)/inbox/action-state';
import { LEAD_JOB_ERROR_KINDS } from '../src/db/schema';

const ACTION = 'src/app/(console)/inbox/create-job-actions.ts';

/** Strip comments so the header's prose cannot satisfy or fail an assertion. */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Every `CreateJobResult` kind other than `failed`, which is keyed per error kind. */
const RESULT_KINDS = [
  'created',
  'already_in_progress',
  'already_created',
  'not_open',
  'no_reply',
  'thread_changed',
  'not_connected',
  'connection_paused',
] as const;

describe('the create-job action is gated before the body (T-14-01)', () => {
  const source = code(ACTION);

  it('calls requireOperatorId, then the membership read, then reads the form', () => {
    const gate = source.indexOf('requireOperatorId(');
    const membership = source.indexOf('getClaims(');
    const tenantRead = source.indexOf(".from('tenants')");
    const body = source.indexOf('formData.get(');

    expect(gate).toBeGreaterThan(-1);
    expect(membership).toBeGreaterThan(gate);
    expect(tenantRead).toBeGreaterThan(membership);
    expect(body).toBeGreaterThan(tenantRead);
  });

  it('imports requireOperatorId from the shared module', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\brequireOperatorId\b[^}]*\}\s*from\s*'\.\.\/_auth'/,
    );
  });

  it("is a 'use server' module exporting exactly one async function", () => {
    expect(source).toMatch(/^'use server';/);
    const exports = source.match(/^export\s+async\s+function\s+(\w+)/gm) ?? [];
    expect(exports).toHaveLength(1);
    expect(exports[0]).toContain('createJobForLeadAction');
    expect(source).not.toMatch(/^export\s+(const|let|var|function\s)/m);
  });

  it('takes created_by from the verified claim, never a field', () => {
    expect(source).toMatch(/access\.userId/);
    expect(source).not.toMatch(/formData\.get\(\s*'created_by'/);
    expect(source).not.toMatch(/formData\.get\(\s*'description'/);
  });

  it('never interpolates an error message into what it returns', () => {
    expect(source).not.toMatch(/\.message\b/);
    expect(source).not.toMatch(/String\(\s*\w*(error|err|e)\w*\s*\)/i);
  });

  it('parses the preview digest (64 hex) and hands it to the core (WR-04)', () => {
    expect(source).toMatch(/preview_sha256: z\.string\(\)\.regex\(\/\^\[0-9a-f\]\{64\}\$\/\)/);
    expect(source).toContain("formData.get('preview_sha256')");
    expect(source).toContain('expectedPreviewSha256: parsed.data.preview_sha256');
  });

  it('the sheet posts the server-computed digest as a hidden field (WR-04)', () => {
    const form = code('src/app/(console)/inbox/create-job-form.tsx');
    expect(form).toMatch(/<input type="hidden" name="preview_sha256" value=\{previewSha256\} \/>/);
    // 2026-10-13 (Phase 15, 15-04): MOVED BY DESIGN. The sheet builder left
    // `inbox/page.tsx` for the shared server module both the inbox and the
    // lead queue call, so one function computes the digest for both pages.
    const builder = code('src/app/(console)/components/lead-job-sheet.ts');
    expect(builder).toContain('previewSha256: previewSha256For(previewFacts)');
    const page = code('src/app/(console)/inbox/page.tsx');
    expect(page).toContain('readLeadJobSheets(');
  });

  it('revalidates the inbox and the client page directly', () => {
    expect(source).toContain("revalidatePath('/inbox')");
    expect(source).toContain('revalidatePath(`/clients/${tenantId}`)');
    expect(source).not.toContain('revalidateBoth');
  });
});

describe('the sheet speaks in fixed sentences keyed by the closed vocabulary', () => {
  const keys = Object.keys(CREATE_JOB_SENTENCES);
  const failedKeys = LEAD_JOB_ERROR_KINDS.map((kind) => `failed:${kind}`);

  it('has a sentence for every result kind, thread_changed included', () => {
    for (const kind of RESULT_KINDS) {
      expect(CREATE_JOB_SENTENCES[kind], kind).toEqual(expect.any(String));
    }
    expect(CREATE_JOB_SENTENCES.thread_changed).toBeTruthy();
  });

  it('has a failed: sentence for every member of LEAD_JOB_ERROR_KINDS', () => {
    for (const key of failedKeys) {
      expect(CREATE_JOB_SENTENCES[key], key).toEqual(expect.any(String));
    }
  });

  it('has no key outside those two sets', () => {
    const allowed = new Set<string>([...RESULT_KINDS, ...failedKeys]);
    expect(keys.filter((key) => !allowed.has(key))).toEqual([]);
  });

  it('never echoes a status, undefined or null', () => {
    for (const sentence of Object.values(CREATE_JOB_SENTENCES)) {
      expect(sentence).not.toMatch(/ServiceM8 returned\s+(HTTP\s+)?\d/);
      expect(sentence).not.toMatch(/\bundefined\b|\bnull\b/);
      expect(sentence.trim()).not.toBe('');
    }
  });
});

/**
 * 2026-10 (Phase 15, D-08a; 14-REVIEW WR-02): the unique-violation recovery
 * records its own kind, `job_linked_elsewhere`, which migration 0042 admits —
 * the borrowed `parse_error` is retired from that branch — and the sheet says
 * what happened in one fixed sentence. The per-kind loop above already fails
 * for any member of LEAD_JOB_ERROR_KINDS without a sentence.
 */
describe('job_linked_elsewhere — the dedicated kind on the WR-02 branch (Phase 15, D-08a)', () => {
  it('is a member of the stored vocabulary, last', () => {
    expect(LEAD_JOB_ERROR_KINDS.at(-1)).toBe('job_linked_elsewhere');
  });

  it('has its fixed sentence, byte for byte', () => {
    expect(CREATE_JOB_SENTENCES['failed:job_linked_elsewhere']).toBe(
      'That ServiceM8 job already belongs to another lead. Retry — a fresh job will be created.',
    );
  });

  it('the WR-02 branch of create-job.ts records job_linked_elsewhere, not the borrowed kind', () => {
    const createJob = code('src/core/leads/create-job.ts');
    const start = createJob.indexOf('isJobCreatedUniqueViolation(error)');
    expect(start, 'the unique-violation branch').toBeGreaterThan(-1);
    const end = createJob.indexOf('await repo.leads.recordJobFailure', start);
    expect(end, 'the branch records its failure').toBeGreaterThan(start);
    const branch = createJob.slice(start, end);

    expect(branch).toContain("'job_linked_elsewhere'");
    expect(branch).not.toMatch(/=\s*'parse_error'/);
  });
});
