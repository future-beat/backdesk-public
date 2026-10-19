/**
 * Phase 14 (SM8-01, D-03; threat T-2-02 / T-14-03): the ServiceM8 WRITE path.
 *
 * PURE, AND IT MAKES NO NETWORK REQUEST: every `fetch` is `vi.stubGlobal`'d and
 * every wrapper test talks to `createSm8Stub` — the ONLY ServiceM8 any CI test
 * may talk to (D-11 authorised the research spike alone). The response shapes
 * are the spike's measured ones (14-RESEARCH "Spike ledger").
 *
 * The key below is a fixture string, not a credential.
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSm8Client } from '../src/core/servicem8/client';
import {
  createCompany,
  createCompanyContact,
  createJob,
  createJobContact,
  findCompanyContactsByMobile,
  getJob,
  listJobContactsForJob,
  listOpenQuoteJobsForCompany,
} from '../src/core/servicem8/writes';
import { mobileSpellings } from '../src/core/leads/mobile-spellings';
import { createSm8Stub } from './helpers/sm8-stub';

const KEY = 'fixture-key-not-a-secret';
const BASE = 'https://api.servicem8.com/api_1.0';
const JOB = '01a12438-259d-7bb1-957a-334257f778ab';
const COMPANY = '01a12438-2033-7bb1-957b-3d868b711fcb';
const SERVICEM8_400_MESSAGE = 'company_uuid record does not exist';

type Call = { url: string; init: RequestInit };

function stubFetch(respond: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const call = { url: String(input), init };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('post() — the transport (Phase 14)', () => {
  it('POSTs the serialised body to BASE/endpointPath(resource) with the three headers', async () => {
    const calls = stubFetch(() => json({ errorCode: 0, message: 'OK' }, 200, { 'x-record-uuid': JOB }));
    const client = createSm8Client({ kind: 'apiKey', key: KEY });
    const body = { status: 'Quote', company_uuid: COMPANY, job_description: 'Leaking tap' };

    const result = await client.post('job.json', body);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/job.json`);
    expect(calls[0].init.method).toBe('POST');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('X-API-Key')).toBe(KEY);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(calls[0].init.body).toBe(JSON.stringify(body));
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(result.ok && result.data.uuid).toBe(JOB);
  });

  it("'job' and 'job.json' reach the same URL", async () => {
    const calls = stubFetch(() => json({ errorCode: 0, message: 'OK' }, 200, { 'x-record-uuid': JOB }));
    const client = createSm8Client({ kind: 'apiKey', key: KEY });
    await client.post('job', {});
    expect(calls[0].url).toBe(`${BASE}/job.json`);
  });

  it('accepts errorCode as the string "0" too (the docs spelling)', async () => {
    stubFetch(() => json({ errorCode: '0', message: 'OK' }, 200, { 'x-record-uuid': JOB }));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).post('job.json', {});
    expect(result).toMatchObject({ ok: true, data: { uuid: JOB } });
  });

  it('a 200 with no x-record-uuid is ok with uuid null — the wrapper decides', async () => {
    stubFetch(() => json({ errorCode: 0, message: 'OK' }));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).post('job.json', {});
    expect(result).toMatchObject({ ok: true, data: { uuid: null } });
  });

  it('a 200 with a non-JSON body is parse_error', async () => {
    stubFetch(() => new Response('<html>oops</html>', { status: 200 }));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).post('job.json', {});
    expect(result).toMatchObject({ ok: false, kind: 'parse_error' });
  });

  it('a 200 whose body is not the write envelope is parse_error', async () => {
    stubFetch(() => json({ errorCode: 400, message: 'nope' }, 200));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).post('job.json', {});
    expect(result).toMatchObject({ ok: false, kind: 'parse_error' });
  });

  it('400 is bad_request with the status, and the detail never carries the response message', async () => {
    stubFetch(() =>
      json(
        { errorCode: 400, message: SERVICEM8_400_MESSAGE, documentation: 'Please refer to …' },
        400,
      ),
    );
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).post('job.json', {});
    expect(result).toMatchObject({ ok: false, kind: 'bad_request', status: 400 });
    expect(JSON.stringify(result)).not.toContain(SERVICEM8_400_MESSAGE);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it.each([
    [404, 'bad_request'],
    [422, 'bad_request'],
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],
    [409, 'server_error'],
  ])('HTTP %i is %s', async (status, kind) => {
    stubFetch(() => json({ errorCode: status, message: 'provider prose' }, status));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).post('job.json', {});
    expect(result).toMatchObject({ ok: false, kind, status });
    expect(JSON.stringify(result)).not.toContain('provider prose');
  });

  it.each(['TypeError', 'TimeoutError'])(
    'a thrown fetch (%s) is network_error naming the error, never its message',
    async (name) => {
      const leaky = `boom ${BASE}/job.json X-API-Key ${KEY}`;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw Object.assign(new Error(leaky), { name });
        }),
      );
      const result = await createSm8Client({ kind: 'apiKey', key: KEY }).post('job.json', {});
      expect(result).toMatchObject({ ok: false, kind: 'network_error' });
      expect(!result.ok && result.detail).toContain(name);
      expect(JSON.stringify(result)).not.toContain(KEY);
      expect(JSON.stringify(result)).not.toContain('boom');
    },
  );
});

describe('getOne() — the single read (Phase 14)', () => {
  it('GETs BASE/<resource>/<uuid>.json and returns the object', async () => {
    const row = { uuid: JOB, active: 1, status: 'Quote', edit_date: '2026-10-10 05:10:21' };
    const calls = stubFetch(() => json(row));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).getOne('job.json', JOB);

    expect(calls[0].url).toBe(`${BASE}/job/${JOB}.json`);
    expect(calls[0].init.method ?? 'GET').toBe('GET');
    expect(new Headers(calls[0].init.headers).get('X-API-Key')).toBe(KEY);
    expect(result).toMatchObject({ ok: true, data: { row } });
  });

  it('an array body is parse_error — a single read is a single object', async () => {
    stubFetch(() => json([{ uuid: JOB }]));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).getOne('job', JOB);
    expect(result).toMatchObject({ ok: false, kind: 'parse_error' });
  });

  it('a 404 is a clean bad_request miss (A4)', async () => {
    stubFetch(() => json({ errorCode: 404, message: 'The requested record does not exist' }, 404));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).getOne('job', JOB);
    expect(result).toMatchObject({ ok: false, kind: 'bad_request', status: 404 });
  });

  it('a non-uuid never enters the path — bad_request without a request', async () => {
    const calls = stubFetch(() => json({}));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).getOne(
      'job',
      '../company/x',
    );
    expect(result).toMatchObject({ ok: false, kind: 'bad_request' });
    expect(calls).toHaveLength(0);
  });
});

describe('the read client is unchanged (D-13)', () => {
  it('createSm8Client still answers get() for the sync', async () => {
    stubFetch(() => json([]));
    const result = await createSm8Client({ kind: 'apiKey', key: KEY }).get('job.json');
    expect(result).toMatchObject({ ok: true, data: { rows: [] } });
  });
});

describe('source guarantees (T-2-02)', () => {
  const source = readFileSync(new URL('../src/core/servicem8/client.ts', import.meta.url), 'utf8');

  it('client.ts never stringifies a caught error, reads a body as text, or returns a .message', () => {
    expect(source).not.toContain('String(e)');
    expect(source).not.toContain('res.text()');
    expect(source).not.toMatch(/\.message\b/);
  });
});

describe('the create wrappers read every record back (D-03, T-14-08)', () => {
  it('createCompany → createCompanyContact → createJob → createJobContact against the stub', async () => {
    const stub = createSm8Stub();

    const company = await createCompany(stub.client, { name: 'Jane Citizen' });
    expect(company.ok).toBe(true);
    if (!company.ok) return;

    const cc = await createCompanyContact(stub.client, {
      company_uuid: company.data.uuid,
      first: 'Jane',
      mobile: '0491 570 999',
      type: 'JOB',
      is_primary_contact: '1',
    });
    expect(cc.ok).toBe(true);

    const job = await createJob(stub.client, {
      status: 'Quote',
      company_uuid: company.data.uuid,
      job_description: 'Hot water unit leaking',
    });
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    expect(job.data.status).toBe('Quote');
    expect(job.data.company_uuid).toBe(company.data.uuid);

    const contact = await createJobContact(stub.client, {
      job_uuid: job.data.uuid,
      first: 'Jane',
      mobile: '0491 570 999',
      type: 'JOB',
    });
    expect(contact.ok).toBe(true);

    // Every create was POSTed and then read back by uuid.
    const posts = stub.calls.filter((c) => c.method === 'POST').map((c) => c.resource);
    const reads = stub.calls.filter((c) => c.method === 'GET_ONE').map((c) => c.resource);
    expect(posts).toEqual(['company.json', 'companycontact.json', 'job.json', 'jobcontact.json']);
    expect(reads).toEqual(['company.json', 'companycontact.json', 'job.json', 'jobcontact.json']);
  });

  it('an invalid input is bad_request without a request', async () => {
    const stub = createSm8Stub();
    const result = await createJob(stub.client, {
      status: 'Quote',
      company_uuid: 'nope',
      job_description: 'x',
    });
    expect(result).toMatchObject({ ok: false, kind: 'bad_request' });
    expect(stub.calls).toHaveLength(0);
  });

  it('a 200 with no x-record-uuid is readback_mismatch', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Existing' }] });
    stub.omitHeaderNext();
    const result = await createJob(stub.client, {
      status: 'Quote',
      company_uuid: COMPANY,
      job_description: 'Leaking tap',
    });
    expect(result).toMatchObject({ ok: false, kind: 'readback_mismatch' });
    expect(result).not.toHaveProperty('uuid');
  });

  it('CR-01: a POST with a uuid whose read-back fails is readback_mismatch CARRYING that uuid', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Existing' }] });
    stub.failNextReadBack('job.json', 500);
    const result = await createJob(stub.client, {
      status: 'Quote',
      company_uuid: COMPANY,
      job_description: 'Leaking tap',
    });
    expect(stub.rows('job.json')).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false,
      kind: 'readback_mismatch',
      uuid: stub.rows('job.json')[0].uuid,
    });
  });

  it('a read-back whose status is not Quote is readback_mismatch', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Existing' }] });
    stub.coerceNextJobStatus('Work Order');
    const result = await createJob(stub.client, {
      status: 'Quote',
      company_uuid: COMPANY,
      job_description: 'Leaking tap',
    });
    expect(result).toMatchObject({ ok: false, kind: 'readback_mismatch' });
  });

  it('a 400 from ServiceM8 is bad_request and nothing is created', async () => {
    const stub = createSm8Stub();
    stub.failNext('job.json', 400);
    const result = await createJob(stub.client, {
      status: 'Quote',
      company_uuid: COMPANY,
      job_description: 'Leaking tap',
    });
    expect(result).toMatchObject({ ok: false, kind: 'bad_request', status: 400 });
    expect(stub.rows('job.json')).toHaveLength(0);
  });

  it('ServiceM8 does not dedupe — a second identical POST makes a second job (ledger #15)', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Existing' }] });
    const input = { status: 'Quote' as const, company_uuid: COMPANY, job_description: 'Same' };
    await createJob(stub.client, input);
    await createJob(stub.client, input);
    expect(stub.rows('job.json')).toHaveLength(2);
  });
});

describe('the bounded reads (Phase 14)', () => {
  it('findCompanyContactsByMobile is exact-spelling and short-circuits on the first hit (ledger #4/#5)', async () => {
    const stub = createSm8Stub({
      companyContacts: [
        { uuid: '01a12438-232f-7bb1-957b-c635a0fac47b', company_uuid: COMPANY, mobile: '0491570999' },
      ],
    });
    const result = await findCompanyContactsByMobile(stub.client, mobileSpellings('+61491570999'));
    expect(result.ok && result.data.map((r) => r.company_uuid)).toEqual([COMPANY]);
    // The spaced spelling found nothing; the compact one hit; '+61…' was never asked.
    expect(stub.calls.map((c) => c.filter)).toEqual([
      "mobile eq '0491 570 999' and active eq 1",
      "mobile eq '0491570999' and active eq 1",
    ]);
  });

  it('a spelling carrying anything but digits, spaces and a leading + never enters a filter', async () => {
    const stub = createSm8Stub();
    const result = await findCompanyContactsByMobile(stub.client, ["0491' or active eq 0"]);
    expect(result).toMatchObject({ ok: false, kind: 'bad_request' });
    expect(stub.calls).toHaveLength(0);
  });

  it('listJobContactsForJob and listOpenQuoteJobsForCompany filter by validated uuids', async () => {
    const stub = createSm8Stub({ companies: [{ uuid: COMPANY, name: 'Existing' }] });
    const job = await createJob(stub.client, {
      status: 'Quote',
      company_uuid: COMPANY,
      job_description: 'Leaking tap',
    });
    if (!job.ok) throw new Error('setup');
    await createJobContact(stub.client, {
      job_uuid: job.data.uuid,
      mobile: '0491 570 999',
      type: 'JOB',
    });

    const contacts = await listJobContactsForJob(stub.client, job.data.uuid);
    expect(contacts.ok && contacts.data).toHaveLength(1);

    const open = await listOpenQuoteJobsForCompany(stub.client, COMPANY);
    expect(open.ok && open.data.map((j) => j.uuid)).toEqual([job.data.uuid]);

    stub.setJobStatus(job.data.uuid, 'Work Order');
    const after = await listOpenQuoteJobsForCompany(stub.client, COMPANY);
    expect(after.ok && after.data).toHaveLength(0);

    const bad = await listJobContactsForJob(stub.client, "x' or 1 eq 1");
    expect(bad).toMatchObject({ ok: false, kind: 'bad_request' });
  });

  it('getJob on a uuid that never existed is a clean bad_request miss', async () => {
    const stub = createSm8Stub();
    const result = await getJob(stub.client, JOB);
    expect(result).toMatchObject({ ok: false, kind: 'bad_request', status: 404 });
  });
});
