/**
 * The ServiceM8 boundary's type vocabulary.
 *
 * THE CENTRAL DESIGN RULE: a ServiceM8 request NEVER throws. It resolves to a
 * `Sm8Result` whose failure arm names WHICH KIND of failure occurred, because
 * the five kinds have five different policies (RESEARCH Pattern 5):
 *
 *   auth_failed   → pause the client immediately; keys do not un-revoke
 *   rate_limited  → back off; never pause a cadence over our own impatience
 *   server_error  → back off; ServiceM8's outage is not the client's fault
 *   network_error → back off
 *   parse_error   → schema drift alert; do NOT pause auth, do NOT partial-write
 *
 * A thrown exception erases that distinction at the first `catch`, and the
 * caller is left choosing between "pause everything" and "ignore it". Worse: an
 * exception thrown from `fetch` carries the Request — headers included — into
 * whatever logs it, which would put a client's API key in a log line
 * (threat T-2-02). Typed results carry status codes and nothing else.
 *
 * THE WRITE KINDS ARE A SIBLING ENUM (Phase 14, D-03/D-13). A write — and a
 * single-record read — needs one more kind, `bad_request` (400/404/422: our
 * payload, or a referent that does not exist). It is NOT added to
 * `Sm8FailureKind`, because `applyFailurePolicy` and `SyncOutcome` (the
 * `sync_runs.outcome` CHECK and its label map) are exhaustive over the read
 * kinds, and a new member there would be a policy change for the sync (14-
 * PATTERNS Mismatch 10). `Sm8WriteClient` likewise EXTENDS the one-method
 * `Sm8Client` rather than widening it, so every structural fake the sync
 * suites build still compiles unchanged (Mismatch 6).
 */

export type Sm8FailureKind =
  | 'auth_failed'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'parse_error';

export type Sm8Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: Sm8FailureKind;
      status?: number;
      /**
       * Human-readable context. MUST NOT contain the API key, the request
       * headers, or the full URL of an authenticated request — see T-2-02.
       */
      detail?: string;
    };

/**
 * Authentication strategy.
 *
 * A discriminated union rather than a bare string so the OAuth path (pending
 * ServiceM8 partner approval) lands as a new arm plus a header branch, not a
 * rewrite of every call site.
 */
export type Sm8Auth = { kind: 'apiKey'; key: string };

export interface Sm8Client {
  /**
   * One page of a resource. `filter` is the raw `$filter` expression.
   * `timeoutMs` may only SHORTEN the client's own request timeout — an
   * optional read with a budget of its own (14-REVIEW WR-06).
   */
  get(
    resource: string,
    options?: { filter?: string; cursor?: string; timeoutMs?: number },
  ): Promise<Sm8Result<{ rows: unknown[]; headers: Headers }>>;
}

/**
 * A write's — or a single read's — failure kinds (Phase 14). `bad_request` is
 * 400/404/422: our payload, or a uuid that does not exist on this account —
 * never the client's revoked key, so it never pauses anything.
 */
export type Sm8WriteFailureKind = Sm8FailureKind | 'bad_request';

export type Sm8WriteResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: Sm8WriteFailureKind;
      status?: number;
      /** The HTTP status or the error's `name` only — see T-2-02. */
      detail?: string;
    };

/**
 * The write path (Phase 14, SM8-01). `createSm8Client` returns one of these;
 * the sync keeps typing its parameter `Sm8Client` and never sees the writes.
 */
export interface Sm8WriteClient extends Sm8Client {
  /**
   * One record by uuid: `GET <resource>/<uuid>.json` → a single object. A
   * soft-deleted record still reads back (`active: 0`); a uuid that never
   * existed is a `bad_request` 404 (research A4).
   */
  getOne(
    resource: string,
    uuid: string,
  ): Promise<Sm8WriteResult<{ row: unknown; headers: Headers }>>;
  /**
   * Create (`<resource>.json`) or update (`<resource>/<uuid>.json`). The new
   * record's uuid is the `x-record-uuid` response header — `null` when absent,
   * which a create wrapper treats as `readback_mismatch`.
   */
  post(
    resource: string,
    body: Record<string, unknown>,
  ): Promise<Sm8WriteResult<{ uuid: string | null; headers: Headers }>>;
}

/**
 * A ServiceM8 job after zod parsing AND normalization — the shape that goes
 * into the `quotes` table. Raw strings are kept alongside their UTC
 * interpretations; see the header of src/db/schema/quotes.ts for why both.
 */
export interface NormalizedQuote {
  sm8JobUuid: string;
  status: string;
  sm8Active: boolean;
  generatedJobId: string | null;
  jobAddress: string | null;
  jobDescription: string | null;
  companyUuid: string | null;
  /** Decimal string for `numeric(12,2)`, derived via integer-cents math. */
  totalInvoiceAmount: string | null;
  quoteSent: boolean | null;
  editDateRaw: string;
  editDateUtc: Date | null;
  dateRaw: string | null;
  quoteDateRaw: string | null;
  quoteDateUtc: Date | null;
  workOrderDateRaw: string | null;
  workOrderDateUtc: Date | null;
  completionDateRaw: string | null;
  completionDateUtc: Date | null;
  unsuccessfulDateRaw: string | null;
  unsuccessfulDateUtc: Date | null;
  quoteSentStampRaw: string | null;
  quoteSentStampUtc: Date | null;
}
