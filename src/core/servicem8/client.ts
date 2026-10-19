/**
 * The ONLY code in this repository that talks to api.servicem8.com.
 *
 * Two invariants, both about the API key (threat T-2-02):
 *
 *  1. **The key is never interpolated into a returned string.** Every failure
 *     result is built from the HTTP STATUS CODE and, for network failures, the
 *     error's `name` — never the caught value stringified, because a `fetch`
 *     rejection can stringify to text containing the request URL, and never the response
 *     body, because ServiceM8 has no obligation to keep our credential out of
 *     its own error text.
 *  2. **Nothing throws.** See src/core/servicem8/types.ts — a thrown fetch error
 *     carries the Request object, headers included, to whatever logs it.
 *
 * The write path (Phase 14: `post`, `getOne`) inherits both. ServiceM8's 400
 * answers `{"errorCode":400,"message":"<reason>"}` and the reason can name a
 * field — that is a RESPONSE BODY and is never returned, logged or stored:
 * the failure carries the HTTP status and nothing else (T-2-02, T-14-03).
 *
 * `src/core` is framework-free: global `fetch` only, no HTTP library.
 * [CITED: developer.servicem8.com/docs/authentication — "include it in all API
 * requests by setting it in the X-API-Key header"]
 */
import { sm8WriteResult } from './schemas';
import type { Sm8Auth, Sm8Result, Sm8WriteClient, Sm8WriteResult } from './types';

const BASE = 'https://api.servicem8.com/api_1.0';

/** ServiceM8 documents 180 req/min; a stalled request must not hold the tick. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Classify by status code alone.
 *
 * Note 4xx that is neither 401/403 nor 429: a 400 from a malformed `$filter` is
 * OUR bug, not the client's revoked key, and pausing their cadence over it would
 * be exactly wrong. It maps to `server_error` (back off, alert on repetition)
 * rather than `auth_failed` (pause immediately, email the operator).
 */
function classify(status: number): Sm8Result<never> {
  if (status === 401 || status === 403) return { ok: false, kind: 'auth_failed', status };
  if (status === 429) return { ok: false, kind: 'rate_limited', status };
  return {
    ok: false,
    kind: 'server_error',
    status,
    detail: `ServiceM8 returned HTTP ${status}`,
  };
}

/**
 * Classify a WRITE (or single read) by status code alone (Phase 14).
 *
 * The read classifier's one change: 400/404/422 are `bad_request` — on a write
 * they mean our payload, or a referent uuid this account does not have, and on
 * a single read a 404 is a clean "never existed here" (research A4). Neither is
 * the client's revoked key. The detail is the status and nothing else.
 */
function classifyWrite(status: number): Sm8WriteResult<never> {
  if (status === 401 || status === 403) return { ok: false, kind: 'auth_failed', status };
  if (status === 429) return { ok: false, kind: 'rate_limited', status };
  const kind = status === 400 || status === 404 || status === 422 ? 'bad_request' : 'server_error';
  return { ok: false, kind, status, detail: `ServiceM8 returned HTTP ${status}` };
}

/** A uuid's shape — the only thing allowed into a single-record path. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fetch catch, shared: the error's `name` only, never the stringified error — see header. */
function networkFailure(e: unknown): { ok: false; kind: 'network_error'; detail: string } {
  const name = e instanceof Error ? e.name : 'UnknownError';
  return { ok: false, kind: 'network_error', detail: `fetch failed (${name})` };
}

/**
 * `'job'` and `'job.json'` both mean the same endpoint.
 *
 * Every call site in this repository passes the `.json` form, which the naive
 * `${resource}.json` concatenation turned into `/api_1.0/job.json.json`.
 * ServiceM8 tolerates it — measured 26 Aug 2026, identical 200 and identical
 * body for both forms — which is exactly why it survived the tracer's seven
 * live assertions unnoticed. Tolerance is not a contract: the day their router
 * tightens, every request in the product breaks at once and the cause is a
 * doubled suffix nobody has looked at in months.
 */
function endpointPath(resource: string): string {
  return resource.endsWith('.json') ? resource : `${resource}.json`;
}

export function createSm8Client(auth: Sm8Auth): Sm8WriteClient {
  async function get(
    resource: string,
    options: { filter?: string; cursor?: string; timeoutMs?: number } = {},
  ): Promise<Sm8Result<{ rows: unknown[]; headers: Headers }>> {
    // A caller may only shorten the timeout, never lengthen it (WR-06).
    const timeoutMs =
      options.timeoutMs === undefined
        ? REQUEST_TIMEOUT_MS
        : Math.max(1, Math.min(Math.ceil(options.timeoutMs), REQUEST_TIMEOUT_MS));
    const url = new URL(`${BASE}/${endpointPath(resource)}`);
    // ServiceM8's filter parameter is literally named `$filter`; URL's own
    // encoder handles the rest so no hand-rolled query string can go wrong.
    if (options.filter) url.searchParams.set('$filter', options.filter);
    if (options.cursor !== undefined) url.searchParams.set('cursor', options.cursor);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-API-Key': auth.key, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // `e.name` only ('TimeoutError', 'TypeError'), never the stringified error — see header.
      const name = e instanceof Error ? e.name : 'UnknownError';
      return { ok: false, kind: 'network_error', detail: `fetch failed (${name})` };
    }

    if (!res.ok) return classify(res.status);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, kind: 'parse_error', status: res.status, detail: 'response was not JSON' };
    }

    // Every list endpoint returns a bare array. Anything else is drift, and
    // guessing at an envelope shape here would hide it.
    if (!Array.isArray(body)) {
      return {
        ok: false,
        kind: 'parse_error',
        status: res.status,
        detail: `expected a JSON array from ${resource}.json, got ${typeof body}`,
      };
    }

    return { ok: true, data: { rows: body, headers: res.headers } };
  }

  /**
   * Create or update (Phase 14). Measured (14-RESEARCH ledger #1–#16): a 200
   * `{"errorCode":0,"message":"OK"}` — `errorCode` a NUMBER on the wire, the
   * docs' string accepted too — with the record's uuid in `x-record-uuid`.
   */
  async function post(
    resource: string,
    body: Record<string, unknown>,
  ): Promise<Sm8WriteResult<{ uuid: string | null; headers: Headers }>> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${endpointPath(resource)}`, {
        method: 'POST',
        headers: {
          'X-API-Key': auth.key,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      return networkFailure(e);
    }

    if (!res.ok) return classifyWrite(res.status);

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      return { ok: false, kind: 'parse_error', status: res.status, detail: 'response was not JSON' };
    }
    if (!sm8WriteResult.safeParse(parsed).success) {
      return {
        ok: false,
        kind: 'parse_error',
        status: res.status,
        detail: `unexpected write envelope from ${resource}`,
      };
    }

    return { ok: true, data: { uuid: res.headers.get('x-record-uuid'), headers: res.headers } };
  }

  /**
   * One record by uuid (Phase 14). `get()` rejects a non-array body, and a
   * single read answers a single object, so this is its own method. The uuid
   * is validated before it enters the path.
   */
  async function getOne(
    resource: string,
    uuid: string,
  ): Promise<Sm8WriteResult<{ row: unknown; headers: Headers }>> {
    if (!UUID_PATTERN.test(uuid)) {
      return { ok: false, kind: 'bad_request', detail: 'not a uuid' };
    }
    const base = resource.endsWith('.json') ? resource.slice(0, -'.json'.length) : resource;

    let res: Response;
    try {
      res = await fetch(`${BASE}/${base}/${uuid}.json`, {
        method: 'GET',
        headers: { 'X-API-Key': auth.key, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      return networkFailure(e);
    }

    if (!res.ok) return classifyWrite(res.status);

    let row: unknown;
    try {
      row = await res.json();
    } catch {
      return { ok: false, kind: 'parse_error', status: res.status, detail: 'response was not JSON' };
    }
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return {
        ok: false,
        kind: 'parse_error',
        status: res.status,
        detail: `expected a JSON object from ${base}/{uuid}.json`,
      };
    }

    return { ok: true, data: { row, headers: res.headers } };
  }

  return { get, getOne, post };
}
