/**
 * Threat T-2-09: the ServiceM8 payload boundary.
 *
 * The first half of this suite parses THE CAPTURED FIXTURES — real payloads
 * from a live account, not a hand-written guess at what ServiceM8 returns. That
 * distinction has already earned its keep: the schema written from the
 * reference documentation rejected every job in the account, because
 * `quote_sent` arrives as a JSON boolean rather than the documented integer.
 *
 * The second half drives synthetic rows at the coercions, because a trial
 * account cannot be made to produce a zero-date on demand.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseMoneyToCents } from '../src/core/servicem8/normalize';
import {
  JOB_STATUSES,
  sm8Company,
  sm8CompanyContact,
  sm8CompanyContactCreate,
  sm8CompanyCreate,
  sm8Job,
  sm8JobContact,
  sm8JobContactCreate,
  sm8JobCreate,
  sm8WriteResult,
} from '../src/core/servicem8/schemas';

const jobs = JSON.parse(readFileSync(new URL('./fixtures/sm8/job.json', import.meta.url), 'utf8'));
const contacts = JSON.parse(
  readFileSync(new URL('./fixtures/sm8/jobcontact.json', import.meta.url), 'utf8'),
);

/** A minimal valid job, for tests that vary one field at a time. */
const baseJob = {
  uuid: '01a03d1b-f954-7bb1-957a-bdd5e80f194d',
  active: 1,
  edit_date: '2026-08-26 08:14:46',
  status: 'Quote',
  date: '2026-08-26 00:00:00',
  quote_date: '2026-08-26 08:07:19',
  work_order_date: '0000-00-00 00:00:00',
  completion_date: '0000-00-00 00:00:00',
  unsuccessful_date: '0000-00-00 00:00:00',
  quote_sent: false,
  quote_sent_stamp: '0000-00-00 00:00:00',
  total_invoice_amount: '4850.0000',
};

describe('captured fixtures parse', () => {
  it('has fixtures to parse — an empty file would pass vacuously', () => {
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    expect(contacts.length).toBeGreaterThan(0);
  });

  it('parses every captured job', () => {
    for (const row of jobs) {
      const parsed = sm8Job.safeParse(row);
      expect(
        parsed.success,
        `job ${row.uuid} failed: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    }
  });

  it('parses every captured job contact', () => {
    for (const row of contacts) {
      const parsed = sm8JobContact.safeParse(row);
      expect(
        parsed.success,
        `contact ${row.uuid} failed: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    }
  });

  it('covers all four statuses — the fixture set is the regression net', () => {
    // If the trial account is ever re-seeded with only open quotes, the win/loss
    // paths lose their fixture coverage silently. This notices.
    const seen = new Set(jobs.map((j: { status: string }) => j.status));
    for (const status of JOB_STATUSES) {
      expect(seen.has(status), `no fixture job with status "${status}"`).toBe(true);
    }
  });

  it('normalizes quote_sent to a real boolean', () => {
    // The documented type is integer 0/1; the account returns `false`.
    for (const row of jobs) {
      const parsed = sm8Job.parse(row);
      if (parsed.quote_sent !== null && parsed.quote_sent !== undefined) {
        expect(typeof parsed.quote_sent).toBe('boolean');
      }
      expect(typeof parsed.active).toBe('boolean');
    }
  });
});

describe('boolean-ish coercion (the documentation is wrong about these)', () => {
  it('accepts numbers, strings and booleans for active', () => {
    for (const [input, expected] of [
      [1, true],
      [0, false],
      ['1', true],
      ['0', false],
      [true, true],
      [false, false],
      ['true', true],
      ['false', false],
    ] as const) {
      expect(sm8Job.parse({ ...baseJob, active: input }).active, `active: ${input}`).toBe(expected);
    }
  });

  it('rejects a value that is neither', () => {
    expect(sm8Job.safeParse({ ...baseJob, active: 'yes' }).success).toBe(false);
    expect(sm8Job.safeParse({ ...baseJob, active: 2 }).success).toBe(false);
  });
});

describe('zero-date coercion (Pitfall 3)', () => {
  it('coerces every "never happened" form to null', () => {
    const parsed = sm8Job.parse({
      ...baseJob,
      date: '0000-00-00 00:00:00',
      quote_date: '',
      work_order_date: null,
      completion_date: '0000-00-00',
      unsuccessful_date: undefined,
      quote_sent_stamp: '0000-00-00 00:00:00',
    });

    expect(parsed.date).toBeNull();
    expect(parsed.quote_date).toBeNull();
    expect(parsed.work_order_date).toBeNull();
    expect(parsed.completion_date).toBeNull();
    expect(parsed.unsuccessful_date).toBeNull();
    expect(parsed.quote_sent_stamp).toBeNull();
  });

  it('leaves real timestamps verbatim — the cursor depends on the exact string', () => {
    const parsed = sm8Job.parse({ ...baseJob, edit_date: '2026-08-26 08:21:02' });
    expect(parsed.edit_date).toBe('2026-08-26 08:21:02');
    expect(parsed.quote_date).toBe('2026-08-26 08:07:19');
  });

  it('rejects a missing edit_date — the cursor cannot be null', () => {
    expect(sm8Job.safeParse({ ...baseJob, edit_date: '' }).success).toBe(false);
    expect(sm8Job.safeParse({ ...baseJob, edit_date: undefined }).success).toBe(false);
  });
});

describe('money stays a string through zod (Pitfall 4)', () => {
  it('does not coerce total_invoice_amount to a number', () => {
    const parsed = sm8Job.parse({ ...baseJob, total_invoice_amount: '1234.50' });
    expect(typeof parsed.total_invoice_amount).toBe('string');
    expect(parsed.total_invoice_amount).toBe('1234.50');
  });

  it('feeds the precision contract cases through unchanged', () => {
    expect(parseMoneyToCents(sm8Job.parse({ ...baseJob, total_invoice_amount: '1234.50' }).total_invoice_amount)).toBe(123450);
    expect(parseMoneyToCents(sm8Job.parse({ ...baseJob, total_invoice_amount: '0.1' }).total_invoice_amount)).toBe(10);
    expect(parseMoneyToCents(sm8Job.parse({ ...baseJob, total_invoice_amount: null }).total_invoice_amount)).toBeNull();
  });

  it('treats an empty amount as absent, not as zero', () => {
    // A quote with no value and a quote worth $0.00 are different facts, and
    // the audit's "total value" figure must not silently include the former.
    expect(sm8Job.parse({ ...baseJob, total_invoice_amount: '' }).total_invoice_amount).toBeNull();
    expect(sm8Job.parse({ ...baseJob, total_invoice_amount: '0.00' }).total_invoice_amount).toBe('0.00');
  });
});

describe('status vocabulary', () => {
  it('accepts every documented status', () => {
    for (const status of JOB_STATUSES) {
      expect(sm8Job.safeParse({ ...baseJob, status }).success, status).toBe(true);
    }
  });

  it('rejects anything else, including plausible near-misses', () => {
    for (const status of ['quote', 'WorkOrder', 'Won', 'Lost', '', null]) {
      expect(sm8Job.safeParse({ ...baseJob, status }).success, `status: ${status}`).toBe(false);
    }
  });
});

describe('unknown fields pass through', () => {
  it('does not fail on a field ServiceM8 adds', () => {
    // Strictness here would make their roadmap our outage.
    const parsed = sm8Job.safeParse({
      ...baseJob,
      some_field_shipped_next_tuesday: 'surprise',
      nested: { thing: 1 },
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps the unknown field rather than stripping it', () => {
    const parsed = sm8Job.parse({ ...baseJob, badges: '["urgent"]' }) as Record<string, unknown>;
    expect(parsed.badges).toBe('["urgent"]');
  });
});

describe('job contacts — where the cadence recipient comes from', () => {
  it('requires the join key and the cursor field', () => {
    const base = {
      uuid: 'c1',
      active: 1,
      edit_date: '2026-08-26 08:00:00',
      job_uuid: 'j1',
    };
    expect(sm8JobContact.safeParse(base).success).toBe(true);
    expect(sm8JobContact.safeParse({ ...base, job_uuid: undefined }).success).toBe(false);
    expect(sm8JobContact.safeParse({ ...base, edit_date: '' }).success).toBe(false);
  });

  it('tolerates absent phone, mobile and email', () => {
    // The captured fixtures include a contact with empty phone AND mobile — a
    // customer we could not SMS. That must parse, so the cadence can classify
    // it as unreachable rather than crash on it.
    const parsed = sm8JobContact.safeParse({
      uuid: 'c1',
      active: 1,
      edit_date: '2026-08-26 08:00:00',
      job_uuid: 'j1',
      phone: '',
      mobile: null,
      email: undefined,
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * 2026-10 (Phase 14, plan 14-01): the WRITE boundary. The read-back shapes are
 * the research spike's measured responses (14-RESEARCH "Spike ledger",
 * 10 Oct 2026), typed in by hand — the raw ledger lives in the research, not in
 * a fixture file. Uuids are the spike's own (all deleted/inactive since).
 */
describe('Phase 14 write boundary — measured read-backs and request schemas', () => {
  const COMPANY = '01a12438-2033-7bb1-957b-3d868b711fcb';
  const JOB = '01a12438-259d-7bb1-957a-334257f778ab';

  it('parses the measured job read-back (ledger #7) through sm8Job', () => {
    const row = {
      uuid: JOB,
      active: 1,
      date: '2026-10-10 00:00:00',
      status: 'Quote',
      quote_date: '2026-10-10 05:10:21',
      edit_date: '2026-10-10 05:10:21',
      generated_job_id: '7',
      company_uuid: COMPANY,
      quote_sent: false,
      total_invoice_amount: '0.0000',
      job_address: '',
      category_uuid: '',
      job_description: 'BACKDESK SPIKE — research spike, delete me',
    };
    const parsed = sm8Job.safeParse(row);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.status).toBe('Quote');
    expect(parsed.success && parsed.data.active).toBe(true);
  });

  it('parses the measured jobcontact (ledger #10) through sm8JobContact', () => {
    const parsed = sm8JobContact.safeParse({
      uuid: '01a12438-2832-7bb1-957b-91e78978beeb',
      active: 1,
      edit_date: '2026-10-10 05:10:22',
      job_uuid: JOB,
      first: 'BACKDESK',
      last: 'SPIKE',
      mobile: '0491 570 999',
      type: 'JOB',
    });
    expect(parsed.success).toBe(true);
  });

  it('parses the measured companycontact (ledger #4, type BILLING) through sm8CompanyContact', () => {
    const parsed = sm8CompanyContact.safeParse({
      uuid: '01a12438-232f-7bb1-957b-c635a0fac47b',
      active: 1,
      edit_date: '2026-10-10 05:10:20',
      company_uuid: COMPANY,
      first: 'BACKDESK',
      last: 'SPIKE',
      email: '',
      phone: '',
      mobile: '0491 570 999',
      type: 'BILLING',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.active).toBe(true);
  });

  it('parses the measured company (ledger #2 — no mobile, phone or email) through sm8Company', () => {
    const parsed = sm8Company.safeParse({
      uuid: COMPANY,
      active: 1,
      edit_date: '2026-10-10 05:10:20',
      name: 'BACKDESK SPIKE Pty Ltd',
      is_individual: 0,
      abn_number: '',
      address: '',
      fax_number: '',
    });
    expect(parsed.success).toBe(true);
  });

  it('sm8JobCreate rejects an unknown field, a non-Quote status and an over-long description', () => {
    const ok = { status: 'Quote', company_uuid: COMPANY, job_description: 'Hot water unit leaking' };
    expect(sm8JobCreate.safeParse(ok).success).toBe(true);
    expect(sm8JobCreate.safeParse({ ...ok, uuid: JOB }).success).toBe(false);
    expect(sm8JobCreate.safeParse({ ...ok, status: 'Work Order' }).success).toBe(false);
    expect(sm8JobCreate.safeParse({ ...ok, job_description: 'x'.repeat(4001) }).success).toBe(false);
    expect(sm8JobCreate.safeParse({ ...ok, job_description: 'x'.repeat(4000) }).success).toBe(true);
    expect(sm8JobCreate.safeParse({ ...ok, company_uuid: 'not-a-uuid' }).success).toBe(false);
  });

  it('sm8CompanyCreate rejects an empty or 101-character name', () => {
    expect(sm8CompanyCreate.safeParse({ name: 'Jane Citizen' }).success).toBe(true);
    expect(sm8CompanyCreate.safeParse({ name: '' }).success).toBe(false);
    expect(sm8CompanyCreate.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(sm8CompanyCreate.safeParse({ name: 'x'.repeat(100) }).success).toBe(true);
  });

  it('the contact request schemas are strict and pin their type literal', () => {
    const jc = { job_uuid: JOB, first: 'Jane', mobile: '0491 570 999', type: 'JOB' };
    expect(sm8JobContactCreate.safeParse(jc).success).toBe(true);
    expect(sm8JobContactCreate.safeParse({ ...jc, type: 'BILLING' }).success).toBe(false);
    expect(sm8JobContactCreate.safeParse({ ...jc, is_primary_contact: '1' }).success).toBe(false);
    const cc = {
      company_uuid: COMPANY,
      first: 'Jane',
      mobile: '0491 570 999',
      type: 'JOB',
      is_primary_contact: '1',
    };
    expect(sm8CompanyContactCreate.safeParse(cc).success).toBe(true);
    expect(sm8CompanyContactCreate.safeParse({ ...cc, is_primary_contact: '0' }).success).toBe(false);
  });

  it('sm8WriteResult accepts errorCode 0 and "0" and rejects 400', () => {
    expect(sm8WriteResult.safeParse({ errorCode: 0, message: 'OK' }).success).toBe(true);
    expect(sm8WriteResult.safeParse({ errorCode: '0', message: 'OK' }).success).toBe(true);
    expect(
      sm8WriteResult.safeParse({ errorCode: 400, message: 'Job status is not valid' }).success,
    ).toBe(false);
  });
});
