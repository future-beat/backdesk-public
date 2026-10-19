/**
 * Typed ServiceM8 writes and the bounded reads around them (Phase 14, SM8-01,
 * D-03). Framework-free; every function takes an `Sm8WriteClient` first, so a
 * test hands it `createSm8Stub()` and production hands it `createSm8Client()`.
 *
 * EVERY CREATE IS READ BACK BEFORE IT RETURNS (D-03; research Pitfall 4). A 200
 * `{"errorCode":0}` with a header is not a record until `GET <resource>/<uuid>`
 * says so: a missing `x-record-uuid`, a failed read-back, a record that reads
 * back inactive, a job whose status is not `Quote`, or a child whose parent
 * uuid differs from the one we sent is `readback_mismatch` — a WRAPPER
 * outcome, not a transport kind, so it lives in this file's `WriteOutcome`
 * and never in `Sm8WriteFailureKind`. The lead goes `failed` with whatever
 * uuids it has, and the retry adopts rather than creating blind (ServiceM8
 * does not dedupe — spike ledger #15). Once the POST has answered a uuid,
 * every mismatch CARRIES it (`uuid` on the failure), so the caller can persist
 * the record that may exist before it gives up (14-REVIEW CR-01).
 *
 * NOTHING THROWS AND NOTHING LEAKS (T-2-02, T-14-03). An input our own schema
 * rejects is `bad_request` with NO request made and NO field named in the
 * detail; every detail is a status, a transport kind or a resource name.
 *
 * `$filter` VALUES ARE ONLY EVER a uuid validated by pattern or a spelling of
 * digits, spaces and a leading `+` (`mobileSpellings`), single-quoted.
 * Nothing else may enter a filter string (T-14-04).
 */
import type { z } from 'zod';

import {
  sm8Company,
  sm8CompanyContact,
  sm8CompanyContactCreate,
  sm8CompanyCreate,
  sm8Job,
  sm8JobContact,
  sm8JobContactCreate,
  sm8JobCreate,
  type Sm8Company,
  type Sm8CompanyContact,
  type Sm8CompanyContactCreate,
  type Sm8CompanyCreate,
  type Sm8Job,
  type Sm8JobContact,
  type Sm8JobContactCreate,
  type Sm8JobCreate,
} from './schemas';
import type { Sm8WriteClient, Sm8WriteFailureKind, Sm8WriteResult } from './types';

/** A create wrapper's outcome: the transport kinds plus `readback_mismatch`. */
export type WriteOutcome<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: Sm8WriteFailureKind | 'readback_mismatch';
      status?: number;
      /** A status, a kind or a resource name — never a response body. */
      detail?: string;
      /**
       * Set when the POST answered with a record uuid but the read-back did not
       * confirm it (a failed GET, an unparseable, inactive or differing record).
       * The record may well exist in the tradie's account: the caller persists
       * this uuid BEFORE giving up, so the sync's first-sight guard and the
       * retry's adopt-by-uuid can both see it (14-REVIEW CR-01).
       */
      uuid?: string;
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Digits and spaces with an optional leading `+` — what `mobileSpellings` produces. */
const SPELLING_PATTERN = /^\+?[0-9][0-9 ]{0,19}$/;

/**
 * The bounded lists below (one job's contacts, one mobile's contacts, one
 * company's open quotes) are read as ONE page — the cursor is not walked. A
 * page this full means the "bounded" assumption is false (or ServiceM8 began
 * paging), and is reported as `parse_error` (`unexpected second page`) rather
 * than acted on as if it were the whole list.
 */
export const BOUNDED_LIST_MAX_ROWS = 500;

function sameUuid(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function mismatch(detail: string, uuid?: string): WriteOutcome<never> {
  return uuid === undefined
    ? { ok: false, kind: 'readback_mismatch', detail }
    : { ok: false, kind: 'readback_mismatch', detail, uuid };
}

type ReadBack = (uuid: string) => Promise<Sm8WriteResult<{ row: unknown; headers: Headers }>>;

/**
 * Validate, POST, then read the record back through `readBack` (each wrapper
 * names its own `getOne`, so the read-back is visible at every create) and
 * verify it. `verify` receives the parsed read-back and the validated input
 * and says whether the record is the one we asked for (beyond the uuid and
 * `active`, which are always checked).
 */
async function createAndReadBack<Req extends z.ZodType, Read extends z.ZodType>(
  client: Sm8WriteClient,
  resource: string,
  requestSchema: Req,
  input: unknown,
  readBack: ReadBack,
  readSchema: Read,
  verify: (record: z.output<Read>, request: z.output<Req>) => boolean,
): Promise<WriteOutcome<z.output<Read>>> {
  const request = requestSchema.safeParse(input);
  if (!request.success) {
    // Our bug. The kind only — no field name, no value.
    return { ok: false, kind: 'bad_request', detail: `invalid ${resource} request` };
  }

  const posted = await client.post(resource, request.data as Record<string, unknown>);
  if (!posted.ok) return posted;

  const uuid = posted.data.uuid;
  if (uuid === null || !UUID_PATTERN.test(uuid)) {
    return mismatch(`no record uuid from ${resource}`);
  }

  // From here on ServiceM8 has answered the POST with a uuid: every failure
  // carries it, so the caller can persist what may exist (CR-01).
  const read = await readBack(uuid);
  if (!read.ok) return mismatch(`read-back of ${resource} failed (${read.kind})`, uuid);

  const record = readSchema.safeParse(read.data.row);
  if (!record.success) return mismatch(`read-back of ${resource} did not parse`, uuid);

  const parsed = record.data as { uuid?: unknown; active?: unknown };
  if (!sameUuid(parsed.uuid, uuid) || parsed.active !== true) {
    return mismatch(`read-back of ${resource} is not the active record created`, uuid);
  }
  if (!verify(record.data, request.data)) {
    return mismatch(`read-back of ${resource} differs from the request`, uuid);
  }

  return { ok: true, data: record.data };
}

/** `POST company.json`, read back. */
export async function createCompany(
  client: Sm8WriteClient,
  input: Sm8CompanyCreate,
): Promise<WriteOutcome<Sm8Company>> {
  return createAndReadBack(
    client,
    'company.json',
    sm8CompanyCreate,
    input,
    (uuid) => client.getOne('company.json', uuid),
    sm8Company,
    () => true,
  );
}

/** `POST companycontact.json`, read back; the company must match. */
export async function createCompanyContact(
  client: Sm8WriteClient,
  input: Sm8CompanyContactCreate,
): Promise<WriteOutcome<Sm8CompanyContact>> {
  return createAndReadBack(
    client,
    'companycontact.json',
    sm8CompanyContactCreate,
    input,
    (uuid) => client.getOne('companycontact.json', uuid),
    sm8CompanyContact,
    (record, request) => sameUuid(record.company_uuid, request.company_uuid),
  );
}

/** `POST job.json`, read back; status `Quote` and the company must match. */
export async function createJob(
  client: Sm8WriteClient,
  input: Sm8JobCreate,
): Promise<WriteOutcome<Sm8Job>> {
  return createAndReadBack(
    client,
    'job.json',
    sm8JobCreate,
    input,
    (uuid) => client.getOne('job.json', uuid),
    sm8Job,
    (record, request) =>
      record.status === 'Quote' && sameUuid(record.company_uuid, request.company_uuid),
  );
}

/** `POST jobcontact.json`, read back; the job must match. */
export async function createJobContact(
  client: Sm8WriteClient,
  input: Sm8JobContactCreate,
): Promise<WriteOutcome<Sm8JobContact>> {
  return createAndReadBack(
    client,
    'jobcontact.json',
    sm8JobContactCreate,
    input,
    (uuid) => client.getOne('jobcontact.json', uuid),
    sm8JobContact,
    (record, request) => sameUuid(record.job_uuid, request.job_uuid),
  );
}

// ── Single reads ─────────────────────────────────────────────────────────────

async function readOne<Read extends z.ZodType>(
  client: Sm8WriteClient,
  resource: string,
  uuid: string,
  schema: Read,
): Promise<Sm8WriteResult<z.output<Read>>> {
  const read = await client.getOne(resource, uuid);
  if (!read.ok) return read;
  const parsed = schema.safeParse(read.data.row);
  if (!parsed.success) {
    return { ok: false, kind: 'parse_error', detail: `unexpected ${resource} shape` };
  }
  return { ok: true, data: parsed.data };
}

/** One job by uuid. A soft-deleted job reads back `active: false`; a never-existed one is `bad_request`. */
export async function getJob(client: Sm8WriteClient, uuid: string): Promise<Sm8WriteResult<Sm8Job>> {
  return readOne(client, 'job.json', uuid, sm8Job);
}

/** One job contact by uuid. */
export async function getJobContact(
  client: Sm8WriteClient,
  uuid: string,
): Promise<Sm8WriteResult<Sm8JobContact>> {
  return readOne(client, 'jobcontact.json', uuid, sm8JobContact);
}

/** One company (client record) by uuid. */
export async function getCompany(
  client: Sm8WriteClient,
  uuid: string,
): Promise<Sm8WriteResult<Sm8Company>> {
  return readOne(client, 'company.json', uuid, sm8Company);
}

// ── Bounded list reads ───────────────────────────────────────────────────────

async function readBoundedList<Read extends z.ZodType>(
  client: Sm8WriteClient,
  resource: string,
  filter: string,
  schema: Read,
): Promise<Sm8WriteResult<Array<z.output<Read>>>> {
  const page = await client.get(resource, { filter });
  if (!page.ok) return page;
  if (page.data.rows.length >= BOUNDED_LIST_MAX_ROWS) {
    return { ok: false, kind: 'parse_error', detail: `unexpected second page from ${resource}` };
  }
  const out: Array<z.output<Read>> = [];
  for (const row of page.data.rows) {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      return { ok: false, kind: 'parse_error', detail: `unexpected ${resource} row shape` };
    }
    out.push(parsed.data);
  }
  return { ok: true, data: out };
}

function badUuid(): Sm8WriteResult<never> {
  return { ok: false, kind: 'bad_request', detail: 'not a uuid' };
}

/**
 * Every contact on one job. ServiceM8 auto-creates NO job contact for an
 * API-created job (spike ledger #8), so an empty list after our job create is
 * normal.
 */
export async function listJobContactsForJob(
  client: Sm8WriteClient,
  jobUuid: string,
): Promise<Sm8WriteResult<Sm8JobContact[]>> {
  if (!UUID_PATTERN.test(jobUuid)) return badUuid();
  return readBoundedList(client, 'jobcontact.json', `job_uuid eq '${jobUuid}'`, sm8JobContact);
}

/**
 * Active company contacts carrying one of `spellings`, asked in order and
 * SHORT-CIRCUITING on the first non-empty answer (the filter is exact-spelling
 * — spike ledger #4/#5). Every spelling is checked before ANY request is made;
 * one that is not digits, spaces and a leading `+` refuses the whole call.
 */
export async function findCompanyContactsByMobile(
  client: Sm8WriteClient,
  spellings: readonly string[],
): Promise<Sm8WriteResult<Sm8CompanyContact[]>> {
  if (!spellings.every((s) => SPELLING_PATTERN.test(s))) {
    return { ok: false, kind: 'bad_request', detail: 'not a mobile spelling' };
  }
  for (const spelling of spellings) {
    const found = await readBoundedList(
      client,
      'companycontact.json',
      `mobile eq '${spelling}' and active eq 1`,
      sm8CompanyContact,
    );
    if (!found.ok) return found;
    if (found.data.length > 0) return found;
  }
  return { ok: true, data: [] };
}

/**
 * One company's ACTIVE jobs still at `Quote` — the adopt-before-create read: a
 * job whose description matches ours is the orphan of a crashed attempt.
 */
export async function listOpenQuoteJobsForCompany(
  client: Sm8WriteClient,
  companyUuid: string,
): Promise<Sm8WriteResult<Sm8Job[]>> {
  if (!UUID_PATTERN.test(companyUuid)) return badUuid();
  return readBoundedList(
    client,
    'job.json',
    `company_uuid eq '${companyUuid}' and status eq 'Quote' and active eq 1`,
    sm8Job,
  );
}
