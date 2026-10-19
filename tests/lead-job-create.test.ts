/**
 * Phase 14 (SM8-01, SM8-03; D-02, D-03, D-04): `provisionLeadJob` — the
 * ServiceM8 pipeline for one lead's job — against the in-memory ServiceM8.
 *
 * PURE: `createSm8Stub()` is the only ServiceM8 here (D-11 — no request
 * reaches api.servicem8.com), and nothing touches the database. Every number
 * is from ACMA's fiction block (0491 570 60x); every word is invented.
 */
import { describe, expect, it } from 'vitest';

import {
  previewSha256For,
  provisionLeadJob,
  type LeadJobPersisted,
  type LeadJobPersistPatch,
  type LeadJobPlan,
} from '../src/core/leads/job-provision';
import { createSm8Stub, type Sm8StubCall } from './helpers/sm8-stub';

const MOBILE = '+61491570601';
const SPACED = '0491 570 601';

const PLAN: LeadJobPlan = {
  companyName: 'Fiction Caller',
  contactFirst: 'Fiction',
  contactLast: 'Caller',
  mobileE164: MOBILE,
  description: 'Need a quote for a fence, Fiction Street\nCreated by Backdesk from a missed call on 10 Oct 2026 at 7:30 am',
  jobAddress: null,
};

const NOTHING: LeadJobPersisted = {
  companyUuid: null,
  jobUuid: null,
  contactUuid: null,
  descriptionSha256: null,
};

/** A persist that records every patch, and folds them into a running state. */
function recorder(start: LeadJobPersisted = NOTHING) {
  const patches: LeadJobPersistPatch[] = [];
  const state: LeadJobPersisted = { ...start };
  return {
    patches,
    state,
    persist: async (patch: LeadJobPersistPatch) => {
      patches.push(patch);
      if (patch.companyUuid !== undefined) state.companyUuid = patch.companyUuid;
      if (patch.jobUuid !== undefined) state.jobUuid = patch.jobUuid;
      if (patch.contactUuid !== undefined) state.contactUuid = patch.contactUuid;
      if (patch.descriptionSha256 !== undefined) state.descriptionSha256 = patch.descriptionSha256;
    },
  };
}

const posts = (calls: Sm8StubCall[]) =>
  calls.filter((c) => c.method === 'POST').map((c) => c.resource);

describe('provisionLeadJob — the happy path on an empty account (SM8-01)', () => {
  it('creates a company, its contact, a Quote job and a JOB contact, each read back, in order', async () => {
    const stub = createSm8Stub();
    const rec = recorder();

    const result = await provisionLeadJob(stub, PLAN, NOTHING, [], rec.persist);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(posts(stub.calls)).toEqual([
      'company.json',
      'companycontact.json',
      'job.json',
      'jobcontact.json',
    ]);

    // Each POST is followed directly by the read-back of the uuid it minted.
    stub.calls.forEach((call, i) => {
      if (call.method !== 'POST') return;
      const next = stub.calls[i + 1];
      expect(next.method).toBe('GET_ONE');
      expect(next.resource).toBe(call.resource);
    });

    // Then the final read of the job (the contact bumped its edit_date).
    const last = stub.calls.at(-1);
    expect(last).toMatchObject({ method: 'GET_ONE', resource: 'job.json', uuid: result.job.uuid });

    // persist: company, then (the digest, then) job, then contact.
    const uuidKeys = rec.patches.flatMap((p) =>
      (['companyUuid', 'jobUuid', 'contactUuid'] as const).filter((k) => p[k] !== undefined),
    );
    expect(uuidKeys).toEqual(['companyUuid', 'jobUuid', 'contactUuid']);
    const digestAt = rec.patches.findIndex((p) => p.descriptionSha256 !== undefined);
    const jobAt = rec.patches.findIndex((p) => p.jobUuid !== undefined);
    expect(digestAt).toBeGreaterThanOrEqual(0);
    expect(digestAt).toBeLessThan(jobAt);

    expect(result.job.status).toBe('Quote');
    expect(result.job.job_description).toBe(PLAN.description);
    expect(result.contact.type).toBe('JOB');
    expect(result.contact.mobile).toBe(SPACED);
    expect(result.contact.job_uuid).toBe(result.job.uuid);
    expect(result.companyUuid).toBe(rec.state.companyUuid);
    expect(result.adopted).toEqual({ company: false, job: false, contact: false });

    // The client record carries the mobile — a Company has none (ledger #2).
    const companyContacts = stub.rows('companycontact.json');
    expect(companyContacts).toHaveLength(1);
    expect(companyContacts[0]).toMatchObject({ company_uuid: result.companyUuid, mobile: SPACED });
  });
});

// ── The partial failures and their reconciliation (D-04; research Q3) ────────

const COMPANY = '01a1c0de-0000-7bb1-957b-00000000c0de';
const JOB = '01a1c0de-0000-7bb1-957b-0000000009ab';

const countPosts = (calls: Sm8StubCall[], resource: string) =>
  calls.filter((c) => c.method === 'POST' && c.resource === resource).length;

/** Calls made from `from` onwards — one attempt's slice of the stub's log. */
const since = (calls: Sm8StubCall[], from: number) => calls.slice(from);

describe('provisionLeadJob — a retry reconciles, never POSTs blind (SM8-03)', () => {
  it('(a) company created, job POST fails: the retry reuses the company', async () => {
    const stub = createSm8Stub();
    const rec = recorder();

    stub.failNext('job.json', 500);
    const first = await provisionLeadJob(stub, PLAN, rec.state, [], rec.persist);
    expect(first).toEqual({ ok: false, kind: 'server_error' });
    expect(rec.patches.some((p) => p.companyUuid !== undefined)).toBe(true);
    expect(rec.state.jobUuid).toBeNull();

    const mark = stub.calls.length;
    const retry = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(retry.ok).toBe(true);

    const retryCalls = since(stub.calls, mark);
    expect(countPosts(retryCalls, 'company.json')).toBe(0);
    expect(retryCalls[0]).toMatchObject({
      method: 'GET_ONE',
      resource: 'company.json',
      uuid: rec.state.companyUuid,
    });
    expect(countPosts(retryCalls, 'job.json')).toBe(1);
    expect(countPosts(retryCalls, 'jobcontact.json')).toBe(1);
    expect(stub.rows('company.json')).toHaveLength(1);
    expect(stub.rows('job.json')).toHaveLength(1);
  });

  it('(b) job created, contact POST fails: the retry GETs the job and creates only the contact', async () => {
    const stub = createSm8Stub();
    const rec = recorder();

    stub.failNext('jobcontact.json', 500);
    const first = await provisionLeadJob(stub, PLAN, rec.state, [], rec.persist);
    expect(first).toEqual({ ok: false, kind: 'server_error' });
    expect(rec.state.jobUuid).not.toBeNull();
    expect(rec.state.contactUuid).toBeNull();

    const mark = stub.calls.length;
    const retry = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    const retryCalls = since(stub.calls, mark);
    expect(retryCalls).toContainEqual(
      expect.objectContaining({ method: 'GET_ONE', resource: 'job.json', uuid: rec.state.jobUuid }),
    );
    expect(retryCalls).toContainEqual(
      expect.objectContaining({ method: 'GET', resource: 'jobcontact.json' }),
    );
    expect(countPosts(retryCalls, 'job.json')).toBe(0);
    expect(countPosts(retryCalls, 'jobcontact.json')).toBe(1);
    expect(stub.rows('job.json')).toHaveLength(1);
    expect(retry.adopted).toEqual({ company: true, job: true, contact: false });
  });

  it('(c) no header on the job POST: readback_mismatch, and the retry adopts by the PERSISTED digest even with a different suburb', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Fiction Caller' }] });
    const rec = recorder({ ...NOTHING, companyUuid: COMPANY });

    stub.omitHeaderNext();
    const first = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(first).toEqual({ ok: false, kind: 'readback_mismatch' });
    expect(rec.state.jobUuid).toBeNull();
    expect(rec.state.descriptionSha256).toMatch(/^[0-9a-f]{64}$/);
    // ServiceM8 made the job anyway — the crashed-before-persist shape.
    expect(stub.rows('job.json')).toHaveLength(1);

    // The operator retyped the suburb: the re-composed description differs.
    const retyped: LeadJobPlan = {
      ...PLAN,
      description: PLAN.description.replace('\nCreated', '\nSuburb: Fiction Heights\nCreated'),
    };
    const mark = stub.calls.length;
    const retry = await provisionLeadJob(stub, retyped, { ...rec.state }, [], rec.persist);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    const retryCalls = since(stub.calls, mark);
    expect(retryCalls).toContainEqual(
      expect.objectContaining({ method: 'GET', resource: 'job.json' }),
    );
    expect(countPosts(retryCalls, 'job.json')).toBe(0);
    expect(stub.rows('job.json')).toHaveLength(1);
    expect(retry.adopted.job).toBe(true);
    expect(retry.job.job_description).toBe(PLAN.description);
  });

  it('(c) with no digest persisted, or one matching no open job, the job is POSTed exactly once', async () => {
    for (const descriptionSha256 of [null, 'f'.repeat(64)]) {
      const stub = createSm8Stub({
        companies: [{ uuid: COMPANY, name: 'Fiction Caller' }],
        jobs: [
          { company_uuid: COMPANY, status: 'Quote', job_description: 'Someone else entirely' },
        ],
      });
      const rec = recorder({ ...NOTHING, companyUuid: COMPANY, descriptionSha256 });

      const result = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
      expect(result.ok).toBe(true);
      expect(countPosts(stub.calls, 'job.json')).toBe(1);
      expect(stub.rows('job.json')).toHaveLength(2);
    }
  });

  it('(d) the mirror tier finds the company: no filter read, no company POST', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Fiction Caller' }] });
    const rec = recorder();

    const result = await provisionLeadJob(
      stub,
      PLAN,
      NOTHING,
      [{ companyUuid: COMPANY, mobile: SPACED, phone: null, sm8Active: true }],
      rec.persist,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(stub.calls.filter((c) => c.resource === 'companycontact.json')).toHaveLength(0);
    expect(countPosts(stub.calls, 'company.json')).toBe(0);
    expect(result.companyUuid).toBe(COMPANY);
    expect(result.adopted.company).toBe(true);
    expect(rec.patches[0]).toEqual({ companyUuid: COMPANY });
  });

  it('(d) a mirror candidate with another number, or an inactive contact, is passed over', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Fiction Caller' }] });
    const rec = recorder();

    const result = await provisionLeadJob(
      stub,
      PLAN,
      NOTHING,
      [
        { companyUuid: COMPANY, mobile: '0491 570 602', phone: null, sm8Active: true },
        { companyUuid: COMPANY, mobile: SPACED, phone: null, sm8Active: false },
      ],
      rec.persist,
    );
    expect(result.ok).toBe(true);
    expect(countPosts(stub.calls, 'company.json')).toBe(1);
  });

  it.each([
    ['0491 570 601', 1],
    ['+61491570601', 3],
  ])(
    '(e) a company contact spelled %s is found by the filter tier (spelling %i of 3), with no company POST',
    async (spelling, reads) => {
      const stub = createSm8Stub({
        companies: [{ uuid: COMPANY, name: 'Fiction Caller' }],
        companyContacts: [{ company_uuid: COMPANY, mobile: spelling, type: 'BILLING' }],
      });
      const rec = recorder();

      const result = await provisionLeadJob(stub, PLAN, NOTHING, [], rec.persist);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const filterReads = stub.calls.filter(
        (c) => c.method === 'GET' && c.resource === 'companycontact.json',
      );
      expect(filterReads).toHaveLength(reads);
      expect(countPosts(stub.calls, 'company.json')).toBe(0);
      expect(countPosts(stub.calls, 'companycontact.json')).toBe(0);
      expect(result.companyUuid).toBe(COMPANY);
    },
  );

  it('(f) an existing JOB contact with our mobile on the adopted job is adopted, not re-created', async () => {
    const stub = createSm8Stub({
      companies: [{ uuid: COMPANY, name: 'Fiction Caller' }],
      jobs: [{ uuid: JOB, company_uuid: COMPANY, status: 'Quote', job_description: 'x' }],
      contacts: [{ job_uuid: JOB, mobile: '0491570601', type: 'JOB', first: 'Fiction' }],
    });
    const rec = recorder({ ...NOTHING, companyUuid: COMPANY, jobUuid: JOB });

    const result = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(countPosts(stub.calls, 'jobcontact.json')).toBe(0);
    expect(result.adopted).toEqual({ company: true, job: true, contact: true });
    expect(rec.state.contactUuid).toBe(result.contact.uuid);
  });

  // ── 14-REVIEW CR-01: the POST answered a uuid, the read-back after it failed.
  // The record may exist, so its uuid is persisted BEFORE the step fails, and
  // the retry reads it back by uuid instead of creating a second one.

  it('(h) CR-01 company: POST ok, read-back 500 → readback_mismatch WITH the company uuid persisted; the retry adopts it', async () => {
    const stub = createSm8Stub();
    const rec = recorder();

    stub.failNextReadBack('company.json', 500);
    const first = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(first).toEqual({ ok: false, kind: 'readback_mismatch' });
    expect(stub.rows('company.json')).toHaveLength(1);
    expect(rec.state.companyUuid).toBe(stub.rows('company.json')[0].uuid);
    expect(countPosts(stub.calls, 'job.json')).toBe(0);

    const mark = stub.calls.length;
    const retry = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    const retryCalls = since(stub.calls, mark);
    expect(retryCalls[0]).toMatchObject({ method: 'GET_ONE', resource: 'company.json', uuid: rec.state.companyUuid });
    expect(countPosts(retryCalls, 'company.json')).toBe(0);
    expect(stub.rows('company.json')).toHaveLength(1);
    expect(retry.adopted.company).toBe(true);
  });

  it('(h) CR-01 job: POST ok, read-back 500 → readback_mismatch WITH the job uuid persisted; the retry adopts it by uuid', async () => {
    const stub = createSm8Stub();
    const rec = recorder();

    stub.failNextReadBack('job.json', 500);
    const first = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(first).toEqual({ ok: false, kind: 'readback_mismatch' });
    expect(stub.rows('job.json')).toHaveLength(1);
    expect(rec.state.jobUuid).toBe(stub.rows('job.json')[0].uuid);
    expect(countPosts(stub.calls, 'jobcontact.json')).toBe(0);

    const mark = stub.calls.length;
    const retry = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    const retryCalls = since(stub.calls, mark);
    expect(retryCalls).toContainEqual(
      expect.objectContaining({ method: 'GET_ONE', resource: 'job.json', uuid: rec.state.jobUuid }),
    );
    // Adopted by uuid: no list-by-digest read and no second job POST.
    expect(retryCalls.filter((c) => c.method === 'GET' && c.resource === 'job.json')).toHaveLength(0);
    expect(countPosts(retryCalls, 'job.json')).toBe(0);
    expect(stub.rows('job.json')).toHaveLength(1);
    expect(retry.job.uuid).toBe(rec.state.jobUuid);
    expect(retry.adopted.job).toBe(true);
  });

  it('(h) CR-01 contact: POST ok, read-back 500 → readback_mismatch WITH the contact uuid persisted; the retry adopts it', async () => {
    const stub = createSm8Stub();
    const rec = recorder();

    stub.failNextReadBack('jobcontact.json', 500);
    const first = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(first).toEqual({ ok: false, kind: 'readback_mismatch' });
    expect(stub.rows('jobcontact.json')).toHaveLength(1);
    expect(rec.state.contactUuid).toBe(stub.rows('jobcontact.json')[0].uuid);

    const mark = stub.calls.length;
    const retry = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(countPosts(since(stub.calls, mark), 'jobcontact.json')).toBe(0);
    expect(stub.rows('jobcontact.json')).toHaveLength(1);
    expect(retry.contact.uuid).toBe(rec.state.contactUuid);
    expect(retry.adopted).toEqual({ company: true, job: true, contact: true });
  });

  it('(h) CR-01: no header on the POST still persists no uuid (nothing to persist)', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Fiction Caller' }] });
    const rec = recorder({ ...NOTHING, companyUuid: COMPANY });

    stub.omitHeaderNext();
    await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    expect(rec.patches.some((p) => p.jobUuid !== undefined)).toBe(false);
  });

  // ── 14-REVIEW WR-01: a persisted job the tradie deleted is not adopted.

  it('(i) WR-01: a persisted job deleted between attempts is not adopted — cleared, reported, a fresh job follows', async () => {
    const stub = createSm8Stub();
    const rec = recorder();

    stub.failNext('jobcontact.json', 500);
    await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist);
    const deleted = rec.state.jobUuid!;
    expect(deleted).not.toBeNull();

    // The tradie deletes the orphan in ServiceM8 (soft delete, ledger #20).
    await stub.post(`job/${deleted}.json`, { active: 0 });

    const stale: string[] = [];
    const mark = rec.patches.length;
    const retry = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist, (k) => {
      stale.push(k);
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    expect(stale).toEqual(['inactive']);
    expect(rec.patches.slice(mark)[0]).toEqual({ jobUuid: null, contactUuid: null });
    expect(retry.job.uuid).not.toBe(deleted);
    expect(retry.job.active).toBe(true);
    expect(retry.adopted.job).toBe(false);
    expect(rec.state.jobUuid).toBe(retry.job.uuid);
    // No contact was hung on the deleted job.
    expect(stub.rows('jobcontact.json').filter((c) => c.job_uuid === deleted)).toHaveLength(0);
    expect(stub.rows('job.json')).toHaveLength(2);
  });

  it('(i) WR-01: a persisted job that no longer exists is reported missing and cleared', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Fiction Caller' }] });
    const rec = recorder({ ...NOTHING, companyUuid: COMPANY, jobUuid: JOB });

    const stale: string[] = [];
    const result = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist, (k) => {
      stale.push(k);
    });
    expect(result.ok).toBe(true);
    expect(stale).toEqual(['missing']);
    expect(rec.patches).toContainEqual({ jobUuid: null, contactUuid: null });
  });

  it('(i) WR-01: an ACTIVE persisted job in another status is still adopted, and nothing is reported', async () => {
    const stub = createSm8Stub({
      companies: [{ uuid: COMPANY, name: 'Fiction Caller' }],
      jobs: [{ uuid: JOB, company_uuid: COMPANY, status: 'Work Order', job_description: 'x' }],
    });
    const rec = recorder({ ...NOTHING, companyUuid: COMPANY, jobUuid: JOB });
    const stale: string[] = [];
    const result = await provisionLeadJob(stub, PLAN, { ...rec.state }, [], rec.persist, (k) => {
      stale.push(k);
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.uuid).toBe(JOB);
    expect(result.adopted.job).toBe(true);
    expect(stale).toEqual([]);
  });

  it.each([
    [401, 'auth_failed'],
    [429, 'rate_limited'],
    [400, 'bad_request'],
  ])('(g) a job POST answering %i is %s', async (status, kind) => {
    const stub = createSm8Stub();
    const rec = recorder();

    stub.failNext('job.json', status);
    const result = await provisionLeadJob(stub, PLAN, NOTHING, [], rec.persist);
    expect(result).toEqual({ ok: false, kind });
    expect(stub.rows('job.json')).toHaveLength(0);
  });
});

// ── 14-REVIEW WR-04: the preview digest the sheet posts and the core recomputes.

describe('previewSha256For — any preview line that changes changes the digest (WR-04)', () => {
  const ID = '00000000-0000-4000-8000-0000000000a1';
  const base = {
    replies: [{ id: ID, body: 'Need a quote for a fence', urgency: null as string | null }],
    firstMissedAt: new Date('2026-10-09T23:30:00Z'),
    timezone: 'Australia/Perth',
  };

  it('is 64 hex and stable for the same facts', () => {
    const digest = previewSha256For(base);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(previewSha256For({ ...base, replies: base.replies.map((r) => ({ ...r })) })).toBe(digest);
  });

  it('an urgency label set between render and confirm changes it', () => {
    const labelled = { ...base, replies: [{ ...base.replies[0], urgency: 'emergency' }] };
    expect(previewSha256For(labelled)).not.toBe(previewSha256For(base));
  });

  it("an 'unknown' urgency writes no line and so does not change it", () => {
    const unknown = { ...base, replies: [{ ...base.replies[0], urgency: 'unknown' }] };
    expect(previewSha256For(unknown)).toBe(previewSha256For(base));
  });

  it('a different reply id, an added reply, or a different call minute changes it', () => {
    const digest = previewSha256For(base);
    expect(
      previewSha256For({ ...base, replies: [{ ...base.replies[0], id: '00000000-0000-4000-8000-0000000000a2' }] }),
    ).not.toBe(digest);
    expect(
      previewSha256For({
        ...base,
        replies: [...base.replies, { id: '00000000-0000-4000-8000-0000000000a3', body: 'and the gate', urgency: null }],
      }),
    ).not.toBe(digest);
    expect(previewSha256For({ ...base, firstMissedAt: new Date('2026-10-09T23:31:00Z') })).not.toBe(digest);
  });
});
