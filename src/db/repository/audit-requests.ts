/**
 * The audit-request repository — the public intake's only write surface
 * (Phase 9, LAND-03, D-11/D-13).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PROHIBITION. Nothing in this module takes a `tenantId`, touches a        │
 * │ tenant-scoped table, or reads the prospects family. A request is a       │
 * │ STRANGER'S CLAIM: nobody at that business has signed anything and none   │
 * │ of their customers has heard of us, so there is no path from a row here  │
 * │ to a cadence, a quote or a send. The guarantee is structural — there is  │
 * │ no function in this file that could be handed a tenant id.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Why that is a wall and not a guideline: the caller is an UNAUTHENTICATED
 * server action. Everything it can reach is reachable by anyone on the
 * internet who can POST a form. Keeping the reachable surface to two tables
 * that carry no client data is what makes "the public form cannot touch client
 * data" a fact about the code rather than a claim about the action's author.
 *
 * WHY THERE IS NO CLOSURE HERE, unlike `forTenant()`. Same argument as
 * `prospects.ts`: requests are operator-scoped, one operator, and every read is
 * already the whole set. What this module owes instead is that `csv_purge_after`
 * is stamped on EVERY csv attach — which is why `attachAuditRequestCsv` is the
 * only writer of those four columns.
 *
 * Service-role, so RLS is bypassed by design; the `is_operator()` policies are
 * defence in depth for the console's authenticated reads, not for this path.
 */
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import {
  AUDIT_REQUEST_STATUSES,
  AUDIT_UPLOAD_RETENTION_DAYS,
  auditRequestThrottle,
  auditRequests,
} from '@/db/schema';
import type { AuditNotifyOutcome, AuditRequest, AuditRequestStatus, NewAuditRequest } from '@/db/schema';

import { getDb } from './client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fail loudly at the boundary rather than handing Postgres a value it rejects
 * as `22P02` — or, for an `undefined`, letting the driver build a predicate
 * nobody intended. The same rule `assertProspectId` enforces.
 */
function assertAuditRequestId(requestId: string): void {
  if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
    throw new Error(`An audit-request uuid is required; received ${JSON.stringify(requestId)}.`);
  }
}

/** Diagnostic only, and bounded here so a hostile header cannot fill a column. */
const USER_AGENT_MAX = 512;

/**
 * What the public action supplies. NARROW ON PURPOSE — a `Pick`, not the full
 * insert type, so the action cannot set a status, a notify outcome, a
 * conversion or a csv path even by accident.
 */
export type AuditRequestCreate = Pick<
  NewAuditRequest,
  | 'businessName'
  | 'contactName'
  | 'phone'
  | 'email'
  | 'trade'
  | 'servicem8User'
  | 'quotesBand'
> & {
  /** `sha256(salt:ip)` or null. NEVER an address — see the schema header. */
  ipHash?: string | null;
  /** Truncated to 512 characters here rather than by the caller. */
  userAgent?: string | null;
  /**
   * Where the request came from, already parsed (19 Sep 2026).
   *
   * All four independently optional and independently nullable, because all
   * four null is the ordinary state for an email-sourced request and a partial
   * arrival is the ordinary state for a referral. They are accepted here
   * ALREADY BOUNDED — `parseArrivalSource` in `@/core/intake/arrival-source`
   * is the trust boundary — for the reason `phone` arrives already in E.164:
   * the normalising happens once, at the edge, where its test can see it.
   */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrerHost?: string | null;
};

/**
 * Insert one request and return it.
 *
 * THE ROW IS WRITTEN BEFORE ANY NOTIFICATION IS ATTEMPTED (D-13). A request
 * that reached us and was lost because Resend was having an afternoon is the
 * one failure this whole path exists to prevent: the operator can be told late,
 * but the prospect cannot be asked to type it again.
 */
export async function createAuditRequest(values: AuditRequestCreate): Promise<AuditRequest> {
  const [row] = await getDb()
    .insert(auditRequests)
    .values({
      businessName: values.businessName,
      contactName: values.contactName,
      phone: values.phone,
      email: values.email,
      trade: values.trade,
      servicem8User: values.servicem8User,
      quotesBand: values.quotesBand,
      ipHash: values.ipHash ?? null,
      userAgent: values.userAgent ? values.userAgent.slice(0, USER_AGENT_MAX) : null,
      // `?? null` on each, separately: an absent key and a null value mean the
      // same thing to the row, and writing `undefined` would let drizzle omit
      // the column rather than state that it is empty.
      utmSource: values.utmSource ?? null,
      utmMedium: values.utmMedium ?? null,
      utmCampaign: values.utmCampaign ?? null,
      referrerHost: values.referrerHost ?? null,
    })
    .returning();
  return row;
}

/**
 * Record a stored upload against the request (09-03 calls this).
 *
 * THE RETENTION STAMP LIVES HERE, on the one write path, computed by Postgres
 * rather than by this process's clock — the `prospect_quote_lines` argument
 * verbatim: a container with skew would otherwise write an object that is
 * already expired, or one that outlives the policy by however far the skew runs.
 */
export async function attachAuditRequestCsv(
  requestId: string,
  file: { objectPath: string; filename: string; bytes: number },
): Promise<void> {
  assertAuditRequestId(requestId);

  await getDb()
    .update(auditRequests)
    .set({
      csvObjectPath: file.objectPath,
      csvFilename: file.filename,
      csvBytes: file.bytes,
      csvPurgeAfter: sql`now() + interval '${sql.raw(String(AUDIT_UPLOAD_RETENTION_DAYS))} days'`,
    })
    .where(eq(auditRequests.id, requestId));
}

/**
 * Write the two notification outcomes, ONCE.
 *
 * `WHERE notified_at IS NULL` is the write-once guard: a retried action (or a
 * future background retry) must not overwrite the first, truthful record of
 * what happened with a second attempt's answer. The console badge is evidence,
 * and evidence that can be silently rewritten is not evidence.
 */
export async function recordAuditRequestNotify(
  requestId: string,
  outcomes: { email: AuditNotifyOutcome; sms: AuditNotifyOutcome; detail?: string | null },
): Promise<void> {
  assertAuditRequestId(requestId);

  await getDb()
    .update(auditRequests)
    .set({
      notifyEmail: outcomes.email,
      notifySms: outcomes.sms,
      notifyDetail: outcomes.detail ?? null,
      notifiedAt: sql`now()`,
    })
    .where(and(eq(auditRequests.id, requestId), isNull(auditRequests.notifiedAt)));
}

/**
 * The console list (09-09).
 *
 * NOTE THE SELECT LIST: no `user_agent` and no `ip_hash`. A list page has no
 * use for either, and a page prop is serialised into the HTML payload and the
 * client router cache — a hashed address is still a stable identifier for a
 * person, and there is no reason for one to be in a browser.
 */
export async function listAuditRequests(limit = 50): Promise<
  Array<{
    id: string;
    createdAt: Date;
    businessName: string;
    contactName: string;
    phone: string;
    email: string;
    trade: string;
    servicem8User: boolean;
    quotesBand: string;
    csvFilename: string | null;
    csvBytes: number | null;
    status: string;
    convertedProspectId: string | null;
    notifyEmail: string | null;
    notifySms: string | null;
    notifiedAt: Date | null;
  }>
> {
  return getDb()
    .select({
      id: auditRequests.id,
      createdAt: auditRequests.createdAt,
      businessName: auditRequests.businessName,
      contactName: auditRequests.contactName,
      phone: auditRequests.phone,
      email: auditRequests.email,
      trade: auditRequests.trade,
      servicem8User: auditRequests.servicem8User,
      quotesBand: auditRequests.quotesBand,
      csvFilename: auditRequests.csvFilename,
      csvBytes: auditRequests.csvBytes,
      status: auditRequests.status,
      convertedProspectId: auditRequests.convertedProspectId,
      notifyEmail: auditRequests.notifyEmail,
      notifySms: auditRequests.notifySms,
      notifiedAt: auditRequests.notifiedAt,
    })
    .from(auditRequests)
    // `id` breaks the tie: two requests created in the same millisecond must
    // not swap places between renders.
    .orderBy(desc(auditRequests.createdAt), desc(auditRequests.id))
    .limit(limit);
}

/** One request, or `null`. Never a throw for a well-formed id that is absent. */
export async function getAuditRequest(requestId: string): Promise<AuditRequest | null> {
  assertAuditRequestId(requestId);

  const [row] = await getDb().select().from(auditRequests).where(eq(auditRequests.id, requestId));
  return row ?? null;
}

/**
 * Operator-set status (D-15).
 *
 * The vocabulary is checked HERE as well as by the CHECK constraint, because
 * the constraint's failure is a `23514` three layers up and this one names the
 * value that was wrong.
 */
export async function updateAuditRequestStatus(
  requestId: string,
  status: AuditRequestStatus,
): Promise<void> {
  assertAuditRequestId(requestId);
  if (!AUDIT_REQUEST_STATUSES.includes(status)) {
    throw new Error(`Unknown audit-request status ${JSON.stringify(status)}.`);
  }

  await getDb().update(auditRequests).set({ status }).where(eq(auditRequests.id, requestId));
}

/**
 * Link the request to the prospect an operator created from it, ONCE.
 *
 * `WHERE converted_prospect_id IS NULL` makes a double-submit idempotent rather
 * than a silent re-point: the second call returns `false` and the first
 * conversion stands. Two prospects for one request is an operator mistake worth
 * seeing, not a link worth overwriting.
 */
export async function markAuditRequestConverted(
  requestId: string,
  prospectId: string,
): Promise<boolean> {
  assertAuditRequestId(requestId);
  assertAuditRequestId(prospectId);

  const rows = await getDb()
    .update(auditRequests)
    .set({ convertedProspectId: prospectId, status: 'audited' })
    .where(and(eq(auditRequests.id, requestId), isNull(auditRequests.convertedProspectId)))
    .returning({ id: auditRequests.id });

  return rows.length > 0;
}

/**
 * Count one attempt against this hashed address for the current hour, and
 * return the running total (D-12).
 *
 * ONE STATEMENT, and it must stay one statement. A read-then-write would let
 * two concurrent submissions both read 5 and both write 6, which is the exact
 * shape of a limit that does not limit. `ON CONFLICT … DO UPDATE … RETURNING`
 * is atomic under Postgres' own row lock.
 */
export async function bumpAuditRequestThrottle(ipHash: string): Promise<number> {
  const [row] = await getDb()
    .insert(auditRequestThrottle)
    .values({ ipHash, windowStart: sql`date_trunc('hour', now())`, hits: 1 })
    .onConflictDoUpdate({
      target: [auditRequestThrottle.ipHash, auditRequestThrottle.windowStart],
      set: { hits: sql`${auditRequestThrottle.hits} + 1` },
    })
    .returning({ hits: auditRequestThrottle.hits });

  return row.hits;
}

/**
 * Drop counter rows older than a day.
 *
 * The window is an hour, so anything a day old cannot influence any decision —
 * it is a row kept for nothing, keyed by a hashed address. Deleting it is both
 * the housekeeping and the data-minimisation.
 */
export async function sweepAuditRequestThrottle(): Promise<number> {
  const rows = await getDb()
    .delete(auditRequestThrottle)
    .where(lt(auditRequestThrottle.windowStart, sql`now() - interval '1 day'`))
    .returning({ ipHash: auditRequestThrottle.ipHash });

  return rows.length;
}

/**
 * Uploads past their retention stamp — ids and object paths ONLY (09-03's
 * purge reads this).
 *
 * Objects cannot be deleted from SQL (Supabase requires the Storage API), so
 * the purge is a two-step: this read names what must go, the caller deletes the
 * objects, `clearAuditRequestCsv` forgets them.
 */
export async function listExpiredAuditUploads(): Promise<
  Array<{ id: string; csvObjectPath: string }>
> {
  const rows = await getDb()
    .select({ id: auditRequests.id, csvObjectPath: auditRequests.csvObjectPath })
    .from(auditRequests)
    .where(
      and(
        isNotNull(auditRequests.csvObjectPath),
        lt(auditRequests.csvPurgeAfter, sql`now()`),
      ),
    );

  return rows.filter((row): row is { id: string; csvObjectPath: string } =>
    row.csvObjectPath !== null,
  );
}

/**
 * Forget a purged (or converted) upload — all four columns together.
 *
 * They are ONE FACT: "there is a file, it is called this, it is this big, and
 * it dies at this time". Clearing three of four leaves the sweep a row to
 * re-examine forever to delete nothing.
 */
export async function clearAuditRequestCsv(requestId: string): Promise<void> {
  assertAuditRequestId(requestId);

  await getDb()
    .update(auditRequests)
    .set({ csvObjectPath: null, csvFilename: null, csvBytes: null, csvPurgeAfter: null })
    .where(eq(auditRequests.id, requestId));
}
