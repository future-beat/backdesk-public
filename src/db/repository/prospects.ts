/**
 * The prospect repository — and the wall between audits and cadences (D-03).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PROHIBITION. Nothing in this module touches a tenant-scoped table, and   │
 * │ nothing in `for-tenant.ts` touches a prospect table. Prospect data is    │
 * │ ANALYSIS-ONLY: it never becomes a cadence candidate, never joins         │
 * │ `quotes`, and never migrates when a prospect converts — a converted      │
 * │ client's sync starts fresh from their own connected account.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Why that is a wall and not a guideline: a prospect handed over a read-only key
 * so we could COUNT their quotes. Nobody at that business agreed to have their
 * customers texted, and those customers have never heard of us. One join that
 * let an audit line reach the send queue is a message to a stranger on behalf of
 * a business that never hired us — a Spam Act problem, a reference destroyed,
 * and the single worst outcome available to this product. The guarantee is
 * structural: there is no method here that accepts a `tenantId` and no method in
 * `forTenant()` that accepts a `prospectId`, so the join has nowhere to be
 * written.
 *
 * WHY THERE IS NO CLOSURE HERE, unlike `forTenant()`. The tenant repository
 * closes over its tenant id because forgetting a `WHERE tenant_id` is a
 * cross-tenant leak. Prospects have no such peer relationship — they are
 * operator-scoped, one operator, and every read is already the whole set. What
 * this module owes instead is that `purge_after` is set on EVERY line insert,
 * which is why `storeAuditResults` is the only insert path in the file.
 *
 * Service-role, so RLS is bypassed by design — the `is_operator()` policies are
 * defence in depth for the console's authenticated reads, not for this path.
 */
import { desc, eq, sql } from 'drizzle-orm';

import {
  CSV_STAGING_RETENTION_HOURS,
  PROSPECT_LINE_RETENTION_DAYS,
  prospectQuoteLines,
  prospects,
} from '@/db/schema';
import type { NewProspect, Prospect } from '@/db/schema';

import { getDb } from './client';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fail loudly at the boundary rather than handing Postgres a value it rejects
 * as `22P02` — or, for an `undefined`, letting the driver build a predicate
 * nobody intended. The same rule `forTenant()` enforces at construction.
 */
function assertProspectId(prospectId: string): void {
  if (typeof prospectId !== 'string' || !UUID_PATTERN.test(prospectId)) {
    throw new Error(
      `A prospect uuid is required; received ${JSON.stringify(prospectId)}.`,
    );
  }
}

export type ProspectCreate = Pick<NewProspect, 'businessName' | 'source'> &
  Partial<
    Pick<
      NewProspect,
      'apiKeyCiphertext' | 'keyLast4' | 'timezone' | 'csvNoteDegraded' | 'csvStaging'
    >
  >;

/** One audit line as the caller supplies it — WITHOUT `purgeAfter`. */
export interface ProspectLineInput {
  sm8JobUuid: string | null;
  status: string;
  quoteDateRaw: string | null;
  quoteDateUtc: Date | null;
  /** Integer cents. Converted to the `numeric` string exactly once, below. */
  valueCents: number | null;
  description: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  followedUp: boolean;
  lineSource: 'api' | 'csv';
}

/** The computed figures, in the units they were computed in. */
export interface AuditResults {
  quotesIssued: number;
  totalValueCents: number;
  neverFollowedUpValueCents: number;
  recoverableEstimateCents: number;
  /** `numeric(5,4)` string, or null for no data — NEVER '0.0000' for empty. */
  baselineWinRate: string | null;
  baselineQuotesIssued: number;
  windowStart: string;
  windowEnd: string;
  csvNoteDegraded?: boolean;
}

/**
 * Integer cents → the decimal string a `numeric(12,2)` column takes.
 *
 * A STRING, deliberately: handing drizzle a JS number for a numeric column
 * reintroduces the float round-trip the whole cents discipline exists to
 * prevent, one layer further down where it is harder to see
 * (src/core/servicem8/normalize.ts makes the same argument).
 */
function centsToNumeric(cents: number | null): string | null {
  if (cents == null) return null;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Create a prospect record.
 *
 * Called ONLY after the API key has been verified against the live API — see
 * `createAuditAction`. A prospect row written before verification is a business
 * we cannot read, sitting in the pipeline list looking like one we can.
 *
 * ── THE STAGING CLOCK IS STAMPED HERE, NOT BY THE CALLER (CR-03, D-04) ──────
 *
 * Same argument as `purge_after` in `storeAuditResults`: the guarantee is not
 * "every caller that stages a CSV remembers to set an expiry", which is a
 * promise about future authors, but "there is one place `csv_staging` can be
 * written and it stamps the clock". A caller cannot supply
 * `csvStagingExpiresAt` — it is not in `ProspectCreate` — so staged data
 * without an expiry is unrepresentable rather than merely discouraged.
 *
 * Computed by Postgres rather than by this process's clock, for the reason
 * `purge_after` is: a container with skew would otherwise write a workspace
 * that is already expired, or one that outlives the policy by however far the
 * skew runs.
 */
export async function createProspect(values: ProspectCreate): Promise<Prospect> {
  const [row] = await getDb()
    .insert(prospects)
    .values({
      ...values,
      // Only when something is actually staged. A stamp on an API-path prospect
      // would give the sweep a row to consider forever, for nothing.
      csvStagingExpiresAt: values.csvStaging
        ? sql`now() + interval '${sql.raw(String(CSV_STAGING_RETENTION_HOURS))} hours'`
        : null,
    })
    .returning();
  return row;
}

/**
 * Persist an audit: figures onto the prospect, lines beside it, ONE transaction.
 *
 * ── WHY ATOMIC ──────────────────────────────────────────────────────────────
 *
 * Figures without lines is an audit that cannot be explained when a prospect
 * asks "which quotes?" — the single most likely question in the meeting the
 * document exists for. Lines without figures is a pile of a stranger's customer
 * data with no purpose attached to justify holding it. Either both land or
 * neither does.
 *
 * ── THIS IS THE ONLY PLACE A LINE IS EVER INSERTED (D-04, T-2-07) ───────────
 *
 * `purge_after` is stamped HERE, on every row, from one expression. That is
 * what makes the retention guarantee checkable: not "every insert site
 * remembers", which is a promise about future authors, but "there is one insert
 * site". A second insert path added later must either come through this
 * function or be a deliberate, visible decision to opt out of the purge.
 *
 * Lines are REPLACED, not appended: regenerating an audit for the same prospect
 * must not double their quote count. The delete and the insert share the
 * transaction, so a failed regeneration does not leave them with nothing.
 */
export async function storeAuditResults(
  prospectId: string,
  results: AuditResults,
  lines: readonly ProspectLineInput[],
): Promise<void> {
  assertProspectId(prospectId);

  const db = getDb();

  await db.transaction(async (tx) => {
    await tx
      .update(prospects)
      .set({
        quotesIssued: results.quotesIssued,
        totalValue: centsToNumeric(results.totalValueCents),
        neverFollowedUpValue: centsToNumeric(results.neverFollowedUpValueCents),
        recoverableEstimate: centsToNumeric(results.recoverableEstimateCents),
        baselineWinRate: results.baselineWinRate,
        baselineQuotesIssued: results.baselineQuotesIssued,
        windowStart: results.windowStart,
        windowEnd: results.windowEnd,
        auditGeneratedAt: new Date(),
        csvNoteDegraded: results.csvNoteDegraded ?? false,
        // The staging workspace is cleared on every successful generation
        // (plan 02-07 writes it). Leaving it populated keeps a second copy of
        // every contact detail alive past the purge that empties the line
        // table — the one place the retention guarantee could leak around.
        //
        // The expiry is cleared WITH it (CR-03). The two columns are one fact —
        // "there is something staged, and it dies at this time" — and a row with
        // an expiry but no staging is a row the sweep would keep re-examining
        // forever to delete nothing.
        csvStaging: null,
        csvStagingExpiresAt: null,
      })
      .where(eq(prospects.id, prospectId));

    await tx.delete(prospectQuoteLines).where(eq(prospectQuoteLines.prospectId, prospectId));

    if (lines.length === 0) return;

    await tx.insert(prospectQuoteLines).values(
      lines.map((line) => ({
        prospectId,
        sm8JobUuid: line.sm8JobUuid,
        status: line.status,
        quoteDateRaw: line.quoteDateRaw,
        quoteDateUtc: line.quoteDateUtc,
        value: centsToNumeric(line.valueCents),
        description: line.description,
        contactName: line.contactName,
        contactPhone: line.contactPhone,
        contactEmail: line.contactEmail,
        followedUp: line.followedUp,
        lineSource: line.lineSource,
        // THE RETENTION STAMP. Computed by Postgres rather than by this
        // process's clock: a container with a skewed clock would otherwise
        // write rows that are already expired, or ones that outlive the policy
        // by however far the skew runs (D-04).
        purgeAfter: sql`now() + interval '${sql.raw(String(PROSPECT_LINE_RETENTION_DAYS))} days'`,
      })),
    );
  });
}

/** One prospect, or `null`. Never a throw for a well-formed id that is absent. */
export async function getProspect(prospectId: string): Promise<Prospect | null> {
  assertProspectId(prospectId);

  const [row] = await getDb().select().from(prospects).where(eq(prospects.id, prospectId));
  return row ?? null;
}

/**
 * The audits list.
 *
 * NOTE THE SELECT LIST: no `api_key_ciphertext`, no `csv_staging`. A list page
 * has no use for either, and a page prop is serialised into the HTML payload and
 * the client router cache (threat T-2-02) — the ciphertext is useless without
 * the server-side key, but there is no reason for a credential envelope to be
 * in a browser at all.
 */
export async function listProspects(): Promise<
  Array<{
    id: string;
    businessName: string;
    source: string;
    auditGeneratedAt: Date | null;
    createdAt: Date;
  }>
> {
  return getDb()
    .select({
      id: prospects.id,
      businessName: prospects.businessName,
      source: prospects.source,
      auditGeneratedAt: prospects.auditGeneratedAt,
      createdAt: prospects.createdAt,
    })
    .from(prospects)
    // `id` breaks the tie: two prospects created in the same millisecond must
    // not swap places between renders.
    .orderBy(desc(prospects.createdAt), desc(prospects.id));
}

/**
 * The staged-but-unconfirmed CSV upload, or `null` (plan 02-07, D-12).
 *
 * A NARROW READ, on purpose. `getProspect` returns the whole row including
 * `api_key_ciphertext`, and this value is destined for a rendered page: the
 * mapping screen shows the operator their own headers and the first five rows.
 * Selecting two columns rather than filtering fifteen means a credential
 * envelope cannot reach a page prop by someone later forgetting to destructure
 * (threat T-2-02).
 *
 * Shape is NOT trusted. `csv_staging` is `jsonb` — Postgres guarantees it is
 * valid JSON and nothing more — so a row written by an older version of the
 * upload action, or by hand, must not become an `undefined.map` three layers
 * up. Anything that is not `{ headers: string[], rows: object[] }` reads as
 * absent, which the caller already handles as "nothing staged".
 */
export async function getProspectStaging(
  prospectId: string,
): Promise<{ headers: string[]; rows: Record<string, string | undefined>[] } | null> {
  assertProspectId(prospectId);

  const [row] = await getDb()
    .select({ businessName: prospects.businessName, csvStaging: prospects.csvStaging })
    .from(prospects)
    .where(eq(prospects.id, prospectId));

  const staged = row?.csvStaging;
  if (!staged || typeof staged !== 'object' || Array.isArray(staged)) return null;

  const { headers, rows } = staged as { headers?: unknown; rows?: unknown };
  if (!Array.isArray(headers) || !Array.isArray(rows)) return null;
  if (!headers.every((h): h is string => typeof h === 'string')) return null;

  return {
    headers,
    rows: rows.filter(
      (r): r is Record<string, string | undefined> =>
        typeof r === 'object' && r !== null && !Array.isArray(r),
    ),
  };
}

/** The line count behind a stored audit — how much of it survives the purge. */
export async function countProspectLines(prospectId: string): Promise<number> {
  assertProspectId(prospectId);

  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(prospectQuoteLines)
    .where(eq(prospectQuoteLines.prospectId, prospectId));

  return row?.n ?? 0;
}
