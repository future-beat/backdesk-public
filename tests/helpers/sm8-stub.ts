/**
 * AN IN-MEMORY SERVICEM8 — THE ONLY SERVICEM8 ANY CI TEST MAY TALK TO (Phase
 * 14, D-11). D-11 authorised live writes for the research spike alone; every
 * write test in this phase runs here (or against a `vi.stubGlobal('fetch')`).
 *
 * A HELPER, NOT A SUITE: it depends on neither the env helper nor the seed
 * helper, so pure suites may use it, and it never touches the network.
 *
 * It answers with the shapes the research spike MEASURED (14-RESEARCH "Spike
 * ledger", 10 Oct 2026):
 *
 *  - `post('<resource>.json', body)` CREATES: mints a time-ordered `01a1…`
 *    uuid, stores the row with `active: 1`, `edit_date` and the per-resource
 *    stamps (`date` as `YYYY-MM-DD 00:00:00`, `quote_date` for a job), and
 *    answers `{ uuid }` as the `x-record-uuid` header would (#1/#6). A
 *    referent that does not exist (`company_uuid` on a job or company
 *    contact, `job_uuid` on a job contact) is a 400 and creates nothing
 *    (#12/#14). ServiceM8 does NOT dedupe: a second identical POST makes a
 *    second row (#15). Adding a job contact bumps its job's `edit_date` (#11).
 *  - `post('<resource>/<uuid>.json', partial)` UPDATES (#16).
 *  - `getOne` answers the single object — inactive ones included (#20) — or a
 *    `bad_request` 404 when the uuid never existed (A4).
 *  - `get` honours `$filter` with EXACT-SPELLING equality over `and`-joined
 *    `eq` conditions (`mobile eq`, `job_uuid eq`, `company_uuid eq`,
 *    `status eq`, `active eq`): a compact spelling finds nothing for a spaced
 *    one (#4/#5). No filter returns every row. Failures classify as the READ
 *    client does (a 400 there is `server_error`), writes and single reads as
 *    the write client does.
 *
 * Controls: `calls` (every request, in order), `failNext(resource, status)`
 * (the next request of ANY method to that resource), `failNextReadBack(resource,
 * status)` (the next SINGLE read — `getOne` — of that resource only, so a POST
 * succeeds with its header uuid and the read-back after it fails: the CR-01
 * shape), `omitHeaderNext()` (the next POST still creates its row but answers no
 * uuid — the crashed-before-persist shape adopt-by-description recovers),
 * `coerceNextJobStatus(status)` (the next job create stores another status —
 * the read-back check's target), `setJobStatus(uuid, status)` (the tradie
 * moving a job on, as the sync would then see it) and `rows(resource)`.
 *
 * The stub IS an `Sm8WriteClient` (pass it to a `clientFactory` as is) and
 * also exposes itself as `.client`.
 */
import type {
  Sm8Result,
  Sm8WriteClient,
  Sm8WriteResult,
} from '../../src/core/servicem8/types';

type Row = Record<string, unknown>;

export interface Sm8StubCall {
  method: 'GET' | 'GET_ONE' | 'POST';
  /** The resource as passed, e.g. `job.json` or `job/<uuid>.json`. */
  resource: string;
  filter?: string;
  body?: Record<string, unknown>;
  uuid?: string;
}

export interface Sm8StubSeed {
  jobs?: Row[];
  contacts?: Row[];
  companies?: Row[];
  companyContacts?: Row[];
}

export interface Sm8Stub extends Sm8WriteClient {
  client: Sm8WriteClient;
  calls: Sm8StubCall[];
  failNext(resource: string, status: number): void;
  failNextReadBack(resource: string, status: number): void;
  omitHeaderNext(): void;
  coerceNextJobStatus(status: string): void;
  setJobStatus(uuid: string, status: string): void;
  rows(resource: string): Row[];
}

const RESOURCES = ['job', 'jobcontact', 'company', 'companycontact'] as const;
type Resource = (typeof RESOURCES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function baseOf(resource: string): string {
  return resource.endsWith('.json') ? resource.slice(0, -'.json'.length) : resource;
}

function asResource(name: string): Resource {
  if ((RESOURCES as readonly string[]).includes(name)) return name as Resource;
  throw new Error(`sm8-stub: unknown resource ${name}`);
}

function readFailure(status: number): Sm8Result<never> {
  if (status === 401 || status === 403) return { ok: false, kind: 'auth_failed', status };
  if (status === 429) return { ok: false, kind: 'rate_limited', status };
  return { ok: false, kind: 'server_error', status, detail: `ServiceM8 returned HTTP ${status}` };
}

function writeFailure(status: number): Sm8WriteResult<never> {
  if (status === 401 || status === 403) return { ok: false, kind: 'auth_failed', status };
  if (status === 429) return { ok: false, kind: 'rate_limited', status };
  const kind = status === 400 || status === 404 || status === 422 ? 'bad_request' : 'server_error';
  return { ok: false, kind, status, detail: `ServiceM8 returned HTTP ${status}` };
}

/** `field eq 'value'` / `field eq 1`, joined by ` and ` — the subset the product uses. */
function parseFilter(filter: string): Array<[string, string]> {
  return filter.split(' and ').map((clause) => {
    const m = /^([a-z_]+) eq (?:'([^']*)'|([0-9]+))$/.exec(clause.trim());
    if (m === null) throw new Error('sm8-stub: unsupported $filter clause');
    return [m[1], m[2] ?? m[3]];
  });
}

export function createSm8Stub(seed: Sm8StubSeed = {}): Sm8Stub {
  let tick = Date.UTC(2026, 9, 10, 5, 10, 20); // 2026-10-10 05:10:20, the spike's first stamp
  let minted = 0;
  let generatedJobId = 0;

  const stamp = (): string => {
    tick += 1000;
    return new Date(tick).toISOString().slice(0, 19).replace('T', ' ');
  };
  const mint = (): string => {
    minted += 1;
    return `01a1${minted.toString(16).padStart(4, '0')}-0000-7bb1-957b-${minted
      .toString(16)
      .padStart(12, '0')}`;
  };

  const store: Record<Resource, Row[]> = { job: [], jobcontact: [], company: [], companycontact: [] };
  const seedRows = (resource: Resource, rows: Row[] | undefined) => {
    for (const row of rows ?? []) {
      store[resource].push({ uuid: mint(), active: 1, edit_date: stamp(), ...clone(row) });
    }
  };
  seedRows('company', seed.companies);
  seedRows('companycontact', seed.companyContacts);
  seedRows('job', seed.jobs);
  seedRows('jobcontact', seed.contacts);

  const calls: Sm8StubCall[] = [];
  const pendingFailures = new Map<string, number>();
  const pendingReadBackFailures = new Map<string, number>();
  let omitHeader = false;
  let coercedJobStatus: string | null = null;

  const takeFailure = (resource: string): number | undefined => {
    const key = baseOf(resource).split('/')[0];
    const status = pendingFailures.get(key);
    if (status !== undefined) pendingFailures.delete(key);
    return status;
  };
  const find = (resource: Resource, uuid: string): Row | undefined =>
    store[resource].find((r) => typeof r.uuid === 'string' && r.uuid.toLowerCase() === uuid.toLowerCase());

  const stub: Sm8Stub = {
    calls,

    async get(resource, options = {}) {
      calls.push({ method: 'GET', resource, filter: options.filter });
      const failure = takeFailure(resource);
      if (failure !== undefined) return readFailure(failure);

      let rows = store[asResource(baseOf(resource))];
      if (options.filter) {
        const conditions = parseFilter(options.filter);
        rows = rows.filter((row) =>
          conditions.every(([field, value]) => row[field] !== undefined && String(row[field]) === value),
        );
      }
      return { ok: true, data: { rows: clone(rows), headers: new Headers() } };
    },

    async getOne(resource, uuid) {
      calls.push({ method: 'GET_ONE', resource, uuid });
      const failure = takeFailure(resource);
      if (failure !== undefined) return writeFailure(failure);
      const readBackKey = baseOf(resource).split('/')[0];
      const readBackFailure = pendingReadBackFailures.get(readBackKey);
      if (readBackFailure !== undefined) {
        pendingReadBackFailures.delete(readBackKey);
        return writeFailure(readBackFailure);
      }
      if (!UUID_PATTERN.test(uuid)) return { ok: false, kind: 'bad_request', detail: 'not a uuid' };

      const row = find(asResource(baseOf(resource)), uuid);
      if (row === undefined) return writeFailure(404);
      return { ok: true, data: { row: clone(row), headers: new Headers() } };
    },

    async post(resource, body) {
      calls.push({ method: 'POST', resource, body: clone(body) });
      const failure = takeFailure(resource);
      if (failure !== undefined) return writeFailure(failure);

      const [name, target] = baseOf(resource).split('/');
      const kind = asResource(name);

      // UPDATE: post('<resource>/<uuid>.json', partial) — ledger #16.
      if (target !== undefined) {
        const row = find(kind, target);
        if (row === undefined) return writeFailure(400);
        Object.assign(row, clone(body), { edit_date: stamp() });
        return { ok: true, data: { uuid: target, headers: new Headers({ 'x-record-uuid': target }) } };
      }

      // Referents must exist — ledger #12/#14.
      const parentOf: Partial<Record<Resource, [string, Resource]>> = {
        job: ['company_uuid', 'company'],
        companycontact: ['company_uuid', 'company'],
        jobcontact: ['job_uuid', 'job'],
      };
      const parent = parentOf[kind];
      if (parent !== undefined) {
        const ref = body[parent[0]];
        if (typeof ref !== 'string' || find(parent[1], ref) === undefined) return writeFailure(400);
      }

      const uuid = mint();
      const now = stamp();
      const row: Row = { uuid, active: 1, edit_date: now, ...clone(body) };
      if (kind === 'job') {
        generatedJobId += 1;
        Object.assign(row, {
          date: `${now.slice(0, 10)} 00:00:00`,
          quote_date: now,
          generated_job_id: String(generatedJobId),
          job_address: (body.job_address as string | undefined) ?? '',
          quote_sent: false,
          total_invoice_amount: '0.0000',
        });
        if (coercedJobStatus !== null) {
          row.status = coercedJobStatus;
          coercedJobStatus = null;
        }
      }
      if (kind === 'jobcontact') {
        const job = find('job', body.job_uuid as string);
        if (job !== undefined) job.edit_date = stamp(); // ledger #11
      }
      store[kind].push(row);

      if (omitHeader) {
        omitHeader = false;
        return { ok: true, data: { uuid: null, headers: new Headers() } };
      }
      return { ok: true, data: { uuid, headers: new Headers({ 'x-record-uuid': uuid }) } };
    },

    failNext(resource, status) {
      pendingFailures.set(baseOf(resource), status);
    },
    failNextReadBack(resource, status) {
      pendingReadBackFailures.set(baseOf(resource), status);
    },
    omitHeaderNext() {
      omitHeader = true;
    },
    coerceNextJobStatus(status) {
      coercedJobStatus = status;
    },
    setJobStatus(uuid, status) {
      const job = find('job', uuid);
      if (job === undefined) throw new Error('sm8-stub: no such job');
      job.status = status;
      job.edit_date = stamp();
    },
    rows(resource) {
      return clone(store[asResource(baseOf(resource))]);
    },

    get client(): Sm8WriteClient {
      return stub;
    },
  };

  return stub;
}
