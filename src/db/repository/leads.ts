/**
 * The lead family's reads that START FROM A NUMBER OR A CLOCK (Phase 14, plan
 * 14-04; LEAD-04, D-08, D-09) — an EIGHTH family of the inbound/escalations
 * shape: no method takes a `tenantId` as a scope, because the question each
 * one answers has no tenant yet.
 *
 *   tenantsOwningNumber        — "which clients own this number?" The DONE
 *     door's first read: a tradie's DONE arrives from a number, and the
 *     tenant IS the answer. Tenant ids only.
 *   countLeadResolutionsSince  — the 06:30 digest's two Phase 14 lines: per
 *     client, how many leads became ServiceM8 jobs by the operator's tap and
 *     how many the tradie booked himself. Counts only.
 *
 * Phase 15 (2026-10, plan 15-03) adds the console's and the digest's
 * cross-client lead reads, under the same rule:
 *
 *   listOpenLeadsForQueue      — the `/leads` queue (D-01): every OPEN lead
 *     across clients, sorted by its next follow-up deadline in SQL before the
 *     cap, with the TRUE total beside it. Ids, instants, a touch status word,
 *     an integer and booleans — NO `contact_mobile`, NO reply body, NO join
 *     into `inbound_messages`. The mobile and the newest reply come per
 *     tenant through `forTenant(t).leads.queueCards(ids)` — the inbox's split
 *     (`listInboundNeedingTriage` then `jobLinkageFor` per tenant), so this
 *     family keeps holding ids-and-counts reads only (14-REVIEW IN-08).
 *   countOverdueOpenLeads      — the 06:30 digest's overdue line (D-09): per
 *     client, how many open leads have a follow-up past its slot that is
 *     waiting on the operator. Counts only.
 *   listLeadsDueForPseudonymisation / listMissedCallsDueForPseudonymisation —
 *     the privacy pass's due-reads (D-06): leads closed or expired, or
 *     converted with a terminal job, past PSEUDONYMISE_AFTER_DAYS; lead-less
 *     missed calls past it. THE ONLY TWO READS IN THIS FAMILY THAT RETURN A
 *     NUMBER OR A RAW CALLER STRING. Their one caller is the pass (plan
 *     15-07), which hashes in memory and writes through `forTenant()` — never
 *     a log, never a page. Bounded by `limit`.
 *   countMissedCallsInWindow / listTenantIdsWithActiveDivert — the `/reports`
 *     overview's calls column (RPT-04), called by `forAllTenants_reportMetrics`
 *     only (NOT barrel exports): per client, the window's diverted calls and
 *     the after-hours share; and which clients have an ACTIVE divert number.
 *     Tenant ids and integers only — no caller column, no number selected.
 *     They live here, not in `for-all-tenants.ts`, so that file's pinned
 *     table set (`tests/sync-upsert.test.ts`) does not grow for two counts.
 *
 * ── WHY THIS IS NOT A `forAllTenants_*` EXPORT ─────────────────────────────
 *
 * The cross-tenant export count is pinned at sixteen
 * (`tests/sync-upsert.test.ts`), and every one of the sixteen reaches customer
 * data, a cadence or a write. Neither read here does: `number_e164` and
 * `escalation_phone` are the CLIENT's own numbers (a never-text line, the
 * tradie's handset), compared and never selected, and only tenant ids or
 * counts leave. The `countColdLeadRepliesSince` / `listHeldEscalationsSince`
 * precedent (Phase 13): a counts-or-ids read in its family's own file.
 *
 * Every tenant-scoped lead read and write stays on `forTenant().leads`.
 * Nothing here writes.
 */
import { and, asc, eq, exists, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

// The operator-waiting touch statuses, from the ONE place they are defined —
// the queue, the nav badge, the stall alert and now the digest's overdue line
// mean the same thing by "waiting on the operator" (`for-tenant.ts` imports the
// same constant for the same reason).
import { STALLABLE_TOUCH_STATUSES } from '@/core/aging/stall-policy';
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
// The retention boundary in days, from the ONE place it is defined (and
// defined there AS the negative cool-off) — never a literal here.
import { PSEUDONYMISE_AFTER_DAYS, PSEUDONYMISE_CONVERTED_MAX_DAYS } from '@/core/leads/constants';
import type { Period } from '@/core/reporting/period';
import {
  cadences,
  cadenceTouches,
  leads,
  missedCalls,
  quotes,
  tenantDivertNumbers,
  tenantNeverTextNumbers,
  tenants,
} from '@/db/schema';

import { getDb } from './client';

/**
 * EVERY CLIENT THAT OWNS `e164` AS ONE OF ITS OWN NUMBERS (D-08): its
 * never-text list (`own_line` or `never_text`, stored normalised) UNION its
 * escalation phone (stored raw as the operator typed it, so normalised HERE,
 * in TypeScript, by the one normaliser — the house rule; the column is read
 * for every tenant that has one, which is at most the client count).
 *
 * Sorted and deduplicated, so `[0]` is a stable choice when a number is on two
 * clients' sets (an operator configuration question the DONE door logs).
 * `[]` for a number no client owns — the DONE door then falls through and the
 * reply is an ordinary one.
 *
 * Tenant ids ONLY: no number is selected from either table.
 */
export async function tenantsOwningNumber(e164: string): Promise<string[]> {
  const db = getDb();

  const listed = await db
    .selectDistinct({ tenantId: tenantNeverTextNumbers.tenantId })
    .from(tenantNeverTextNumbers)
    .where(eq(tenantNeverTextNumbers.numberE164, e164));

  const phones = await db
    .select({ id: tenants.id, escalationPhone: tenants.escalationPhone })
    .from(tenants)
    .where(isNotNull(tenants.escalationPhone));

  const owners = new Set<string>(listed.map((row) => row.tenantId));
  for (const row of phones) {
    if (normalizeAuMobile(row.escalationPhone) === e164) owners.add(row.id);
  }

  return [...owners].sort();
}

/** One client's Phase 14 resolutions in the window — a tenant id and two counts. */
export interface LeadResolutionCount {
  tenantId: string;
  /** Leads whose ServiceM8 job was created by the operator's tap since `since`. */
  jobsCreated: number;
  /** Leads closed `booked_by_tradie` (the sync's match) since `since`. */
  bookedByTradie: number;
}

/**
 * HOW MANY LEADS RESOLVED, PER CLIENT, SINCE `since` (Phase 14, D-09) — the
 * 06:30 digest's "jobs created from leads" and "booked by the tradie" lines.
 *
 * ONE statement over `leads`, two `count(*) FILTER (WHERE …)` columns grouped
 * by tenant:
 *
 *   jobsCreated    — `sm8_job_state = 'created'` with `sm8_job_created_at`
 *                    in the window: the operator's tap, read back (D-04).
 *   bookedByTradie — `closed_reason = 'booked_by_tradie'` with `closed_at` in
 *                    the window: the sync found the caller on a job (D-07).
 *
 * Rows with both counts zero are dropped (the WHERE admits only rows one of
 * the filters counts), ordered by tenant id.
 *
 * COUNTS ONLY — no lead id, no number, no job uuid leaves this read. It lives
 * here, in the lead family, and NOT as a `forAllTenants_*` export: it reads
 * this one table and joins nothing, and the cross-tenant export count is
 * pinned at sixteen (the `countColdLeadRepliesSince` paragraph, restated).
 */
export async function countLeadResolutionsSince(since: Date): Promise<LeadResolutionCount[]> {
  const created = and(eq(leads.sm8JobState, 'created'), gte(leads.sm8JobCreatedAt, since));
  const booked = and(eq(leads.closedReason, 'booked_by_tradie'), gte(leads.closedAt, since));

  const rows = await getDb()
    .select({
      tenantId: leads.tenantId,
      jobsCreated: sql<number>`(count(*) FILTER (WHERE ${created}))::int`,
      bookedByTradie: sql<number>`(count(*) FILTER (WHERE ${booked}))::int`,
    })
    .from(leads)
    .where(or(created, booked))
    .groupBy(leads.tenantId)
    .orderBy(asc(leads.tenantId));

  return rows.filter((row) => row.jobsCreated > 0 || row.bookedByTradie > 0);
}

/* ========================================================================= *
 * PHASE 15 (2026-10, plan 15-03): THE LEAD QUEUE AND THE OVERDUE LINE
 * ========================================================================= */

/**
 * The `/leads` queue's cap — the approval queue's (`APPROVAL_QUEUE_CAP`), for
 * the approval queue's reason: no pagination on a deadline-sorted list worked
 * one-handed, the sort happens in SQL BEFORE this limit so the cap admits the
 * soonest deadlines, and the count line shows the TRUE total beside the rows.
 */
export const LEAD_QUEUE_CAP = 50;

/**
 * The cadence statuses a lead cadence is LIVE in. `cadences_one_live_per_lead`
 * admits at most one such cadence per lead, so the next-touch subquery cannot
 * fan a lead out into two rows.
 */
const LIVE_LEAD_CADENCE_STATUSES = ['active', 'paused'] as const;

/**
 * The touch statuses a NEXT follow-up can be in: not yet sent, not skipped,
 * not failed. `approved` is here (it is still the next follow-up the caller
 * will receive) even though it is not waiting on the operator — the overdue
 * predicate below is the narrower `STALLABLE_TOUCH_STATUSES`.
 */
const NEXT_TOUCH_STATUSES = ['scheduled', 'needs_draft', 'pending_approval', 'approved'] as const;

/**
 * One card on the `/leads` queue, as the CROSS-TENANT read returns it. Ids,
 * instants, an integer, booleans and a touch status word — nothing a page
 * could leak by accident. The caller's mobile and their newest reply are NOT
 * here: `forTenant(tenantId).leads.queueCards(ids)` returns them, per tenant.
 */
export interface LeadQueueRow {
  tenantId: string;
  leadId: string;
  firstMissedAt: Date;
  lastMissedAt: Date;
  missedCallCount: number;
  afterHours: boolean;
  /** The lead's job-creation state (`none` | `creating` | `created` | `failed`). */
  sm8JobState: string;
  /** The live lead cadence's next unsent touch, or NULL when it has none. */
  touchId: string | null;
  touchNumber: number | null;
  scheduledAt: Date | null;
  touchStatus: string | null;
}

/** The capped rows and the TRUE total of open leads beside them. */
export interface LeadQueuePage {
  rows: LeadQueueRow[];
  total: number;
}

/**
 * EVERY OPEN LEAD, ACROSS CLIENTS, SOONEST DEADLINE FIRST (Phase 15, D-01).
 *
 * The next touch is the lead's LIVE lead cadence's earliest touch still in
 * `NEXT_TOUCH_STATUSES`, ranked `scheduled_at ASC, id ASC` per lead (the id
 * breaks a same-instant tie deterministically). A lead with no such touch — a
 * stopped or completed cadence, or none — sorts LAST (`NULLS LAST`), then by
 * its first missed call, then by id, so the list never reshuffles between
 * renders. ALL OF IT IN SQL, BEFORE THE LIMIT: what the cap admits is the
 * soonest deadlines by construction.
 *
 * NO `contact_mobile`, NO reply body, NO join into `inbound_messages` — this
 * is a family read that crosses tenants, and the family holds ids-and-counts
 * reads only. The personal facts come per tenant through
 * `forTenant(tenantId).leads.queueCards(ids)`, behind the operator gate.
 */
export async function listOpenLeadsForQueue(cap = LEAD_QUEUE_CAP): Promise<LeadQueuePage> {
  const db = getDb();

  // The alias is `next_touch_rank`, not `rank`: a bare `.as()` name that a
  // real column or a function shares is how the approval queue's
  // `latest_attempt_number` ambiguity (42702) happened.
  const nextTouch = db
    .select({
      leadId: cadences.leadId,
      // Columns, not raw `sql`: the outer select then decodes them through
      // each column's own mapper (a timestamp arrives as a Date). The five
      // names (`lead_id`, `id`, `touch_number`, `scheduled_at`, `status`) are
      // distinct, so no alias is needed.
      touchId: cadenceTouches.id,
      touchNumber: cadenceTouches.touchNumber,
      scheduledAt: cadenceTouches.scheduledAt,
      touchStatus: cadenceTouches.status,
      rank: sql<number>`row_number() over (partition by ${cadences.leadId} order by ${cadenceTouches.scheduledAt} asc, ${cadenceTouches.id} asc)`.as(
        'next_touch_rank',
      ),
    })
    .from(cadences)
    .innerJoin(
      cadenceTouches,
      and(
        eq(cadenceTouches.cadenceId, cadences.id),
        eq(cadenceTouches.tenantId, cadences.tenantId),
      ),
    )
    .where(
      and(
        eq(cadences.kind, 'lead'),
        inArray(cadences.status, [...LIVE_LEAD_CADENCE_STATUSES]),
        inArray(cadenceTouches.status, [...NEXT_TOUCH_STATUSES]),
      ),
    )
    .as('next_touch');

  const open = eq(leads.status, 'open');

  // Two statements against a five-connection pool — inside the
  // `forAllTenants_reportMetrics` ceiling, the approval queue's exact shape.
  const [rows, counted] = await Promise.all([
    db
      .select({
        tenantId: leads.tenantId,
        leadId: leads.id,
        firstMissedAt: leads.firstMissedAt,
        lastMissedAt: leads.lastMissedAt,
        missedCallCount: leads.missedCallCount,
        afterHours: leads.afterHours,
        sm8JobState: leads.sm8JobState,
        touchId: nextTouch.touchId,
        touchNumber: nextTouch.touchNumber,
        scheduledAt: nextTouch.scheduledAt,
        touchStatus: nextTouch.touchStatus,
      })
      .from(leads)
      .leftJoin(nextTouch, and(eq(nextTouch.leadId, leads.id), eq(nextTouch.rank, 1)))
      .where(open)
      // IN SQL, BEFORE THE LIMIT. See the header.
      .orderBy(sql`${nextTouch.scheduledAt} asc nulls last`, asc(leads.firstMissedAt), asc(leads.id))
      .limit(cap),
    db.select({ total: sql<number>`count(*)::int` }).from(leads).where(open),
  ]);

  return { rows, total: counted[0]?.total ?? 0 };
}

/** One client's overdue open leads — a tenant id and a count. */
export interface OverdueOpenLeadCount {
  tenantId: string;
  count: number;
}

/**
 * HOW MANY OPEN LEADS ARE PAST THEIR NEXT FOLLOW-UP DEADLINE, PER CLIENT
 * (Phase 15, D-09) — the 06:30 digest's overdue line.
 *
 * THE SQL TWIN OF THE `/leads` DEADLINE TIER (`leadDeadlineTier`, plan 15-04)
 * and of the queue's `deriveUrgency(scheduledAt, now) === 'overdue'`: an OPEN
 * lead with a LIVE lead cadence holding a touch in `STALLABLE_TOUCH_STATUSES`
 * (waiting on the operator) whose `scheduled_at <= now`. An `approved` or
 * `scheduled` touch past its slot belongs to the machine — the next tick sends
 * or promotes it — and is NOT overdue.
 *
 * `count(DISTINCT leads.id)`: a lead with two waiting touches past their slots
 * is one overdue lead. Grouped by tenant, ordered by tenant id; a client with
 * none has no row. COUNTS ONLY — no lead id, no number leaves this read.
 * `now` goes through a comparison BUILDER, never a raw Date in a `sql`
 * template (the `promoteDue` Bind-time rule).
 */
export async function countOverdueOpenLeads(now: Date): Promise<OverdueOpenLeadCount[]> {
  const rows = await getDb()
    .select({
      tenantId: leads.tenantId,
      count: sql<number>`count(DISTINCT ${leads.id})::int`,
    })
    .from(leads)
    .innerJoin(
      cadences,
      and(
        eq(cadences.leadId, leads.id),
        eq(cadences.tenantId, leads.tenantId),
        eq(cadences.kind, 'lead'),
        inArray(cadences.status, [...LIVE_LEAD_CADENCE_STATUSES]),
      ),
    )
    .innerJoin(
      cadenceTouches,
      and(
        eq(cadenceTouches.cadenceId, cadences.id),
        eq(cadenceTouches.tenantId, cadences.tenantId),
        inArray(cadenceTouches.status, [...STALLABLE_TOUCH_STATUSES]),
        lte(cadenceTouches.scheduledAt, now),
      ),
    )
    .where(eq(leads.status, 'open'))
    .groupBy(leads.tenantId)
    .orderBy(asc(leads.tenantId));

  return rows.filter((row) => row.count > 0);
}

/* ========================================================================= *
 * PHASE 15 (2026-10, plan 15-03): THE `/reports` OVERVIEW'S CALLS COLUMN
 * ========================================================================= */

/** One client's diverted calls in a window — a tenant id and two counts. */
export interface MissedCallWindowCount {
  tenantId: string;
  missedCalls: number;
  missedCallsAfterHours: number;
}

/**
 * HOW MANY DIVERTED CALLS EACH CLIENT HAD IN `window` (Phase 15, RPT-04) —
 * `forAllTenants_reportMetrics`'s grouping `(10)`; its tenant-pinned twin is in
 * `forTenant().metrics.windowCounts`, and the two are asserted equal by the
 * parity pin in `tests/report-metrics.test.ts`.
 *
 * CLOSED AT BOTH ENDS (`>= start AND <= end`), the rolling window's rule.
 * Dead letters (no tenant) are excluded; a client with no calls has no row
 * (the caller zero-fills). COUNTS ONLY — no caller column is named.
 */
export async function countMissedCallsInWindow(window: Period): Promise<MissedCallWindowCount[]> {
  const rows = await getDb()
    .select({
      tenantId: missedCalls.tenantId,
      missedCalls: sql<number>`count(*)::int`,
      missedCallsAfterHours: sql<number>`(count(*) FILTER (WHERE ${missedCalls.afterHours}))::int`,
    })
    .from(missedCalls)
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        gte(missedCalls.startedAt, window.start),
        lte(missedCalls.startedAt, window.end),
      ),
    )
    .groupBy(missedCalls.tenantId)
    .orderBy(asc(missedCalls.tenantId));

  // The predicate makes `tenant_id` non-null; narrowed, not cast.
  return rows.flatMap((row) =>
    row.tenantId === null
      ? []
      : [
          {
            tenantId: row.tenantId,
            missedCalls: row.missedCalls,
            missedCallsAfterHours: row.missedCallsAfterHours,
          },
        ],
  );
}

/**
 * WHICH CLIENTS HAVE AN ACTIVE DIVERT NUMBER (Phase 15, RPT-04) —
 * `forAllTenants_reportMetrics`'s grouping `(11)`: what makes a zero in the
 * calls column a measurement rather than an absence. Tenant ids ONLY; the
 * number is never selected. Sorted.
 */
export async function listTenantIdsWithActiveDivert(): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ tenantId: tenantDivertNumbers.tenantId })
    .from(tenantDivertNumbers)
    .where(eq(tenantDivertNumbers.status, 'active'))
    .orderBy(asc(tenantDivertNumbers.tenantId));
  return rows.map((row) => row.tenantId);
}

/* ========================================================================= *
 * PHASE 15 (2026-10, plan 15-03): THE PRIVACY PASS'S DUE-READS (D-06)
 * ========================================================================= */

const MS_PER_DAY = 86_400_000;

/**
 * One lead the privacy pass is due to hash. CARRIES THE CALLER'S RAW MOBILE —
 * the pass hashes it in memory and writes the hash through
 * `forTenant(tenantId).leads.pseudonymise`. NEVER LOGGED.
 */
export interface LeadDueForPseudonymisation {
  tenantId: string;
  leadId: string;
  contactMobile: string;
  /** `closed` | `expired` | `converted` — never `open`. */
  status: string;
}

/**
 * THE LEADS WHOSE CALLER NUMBER IS DUE TO BE REPLACED (Phase 15, D-06), oldest
 * close first, at most `limit`.
 *
 * Every row is UNSTAMPED (`pseudonymised_at IS NULL`) and matches one of two
 * arms, the boundary being `now − PSEUDONYMISE_AFTER_DAYS` (inclusive):
 *
 *   (1) closed without converting — `status IN ('closed', 'expired')` with
 *       `closed_at` at or before the boundary. `converted` is its own status
 *       (`leads_closed_iff_reason`, `leads_converted_reason`), so status alone
 *       is the rule.
 *   (2) converted, and the job is FINISHED — `status = 'converted'` and the
 *       mirror shows this tenant's job (`sm8_job_uuid`) `Completed` or
 *       `Unsuccessful`, its terminal instant (completion, else unsuccessful,
 *       else last edit) at or before the boundary. ITS OWN ARM because a
 *       converted lead is a customer: while their job is still open — or the
 *       mirror has never seen it — their number is never touched, UNTIL:
 *   (3) the converted LONG-STOP (15-REVIEW WR-02) — `status = 'converted'`
 *       with `closed_at` (the conversion) at or before
 *       `now − PSEUDONYMISE_CONVERTED_MAX_DAYS`, whatever the job's state. A
 *       job the mirror never sees finish (ServiceM8 disconnected, the job
 *       deleted or abandoned, no job uuid recorded) would otherwise keep the
 *       number with no end, and the notice states an end.
 *
 * An OPEN lead matches no arm, by construction. The suppression table is
 * not read: a STOP is kept for as long as it is needed so that it keeps
 * working. Ordered `closed_at, id` — the due instant — so a backlog drains
 * oldest first across nights. Every Date binds through a builder or a
 * column-encoded param (the `promoteDue` Bind-time rule).
 */
export async function listLeadsDueForPseudonymisation(
  now: Date,
  limit: number,
): Promise<LeadDueForPseudonymisation[]> {
  // The retention boundary, inclusive: `now` minus PSEUDONYMISE_AFTER_DAYS
  // whole days — written in each due-read rather than shared, so each read's
  // own body names the constant (tests/pseudonymise-structure.test.ts).
  const boundary = new Date(now.getTime() - PSEUDONYMISE_AFTER_DAYS * MS_PER_DAY);
  const db = getDb();

  const closedWithoutConverting = and(
    inArray(leads.status, ['closed', 'expired']),
    lte(leads.closedAt, boundary),
  );

  const convertedWithFinishedJob = and(
    eq(leads.status, 'converted'),
    exists(
      db
        .select({ one: sql`1` })
        .from(quotes)
        .where(
          and(
            eq(quotes.tenantId, leads.tenantId),
            eq(quotes.sm8JobUuid, leads.sm8JobUuid),
            inArray(quotes.status, ['Completed', 'Unsuccessful']),
            sql`coalesce(${quotes.completionDateUtc}, ${quotes.unsuccessfulDateUtc}, ${quotes.editDateUtc}) <= ${sql.param(boundary, quotes.completionDateUtc)}`,
          ),
        ),
    ),
  );

  // (3) The long-stop: a customer's number is kept no longer than
  // PSEUDONYMISE_CONVERTED_MAX_DAYS after they converted, job finished or not.
  const longStopBoundary = new Date(now.getTime() - PSEUDONYMISE_CONVERTED_MAX_DAYS * MS_PER_DAY);
  const convertedPastLongStop = and(
    eq(leads.status, 'converted'),
    lte(leads.closedAt, longStopBoundary),
  );

  return db
    .select({
      tenantId: leads.tenantId,
      leadId: leads.id,
      contactMobile: leads.contactMobile,
      status: leads.status,
    })
    .from(leads)
    .where(
      and(
        isNull(leads.pseudonymisedAt),
        or(closedWithoutConverting, convertedWithFinishedJob, convertedPastLongStop),
      ),
    )
    .orderBy(asc(leads.closedAt), asc(leads.id))
    .limit(limit);
}

/**
 * One lead-less missed call the privacy pass is due to hash. CARRIES THE RAW
 * CALLER STRINGS (each NULL when absent — a withheld call has no number).
 * NEVER LOGGED.
 */
export interface MissedCallDueForPseudonymisation {
  tenantId: string;
  id: string;
  callerE164: string | null;
  callerRaw: string | null;
  forwardedFromRaw: string | null;
}

/**
 * THE LEAD-LESS MISSED CALLS DUE TO BE STAMPED (Phase 15, D-06), oldest
 * first, at most `limit`: a TENANT's call (dead letters are out of scope —
 * they carry no caller columns worth the name and no client), with no lead
 * (a lead's calls are hashed with the lead, under its transaction), that
 * arrived at or before `now − PSEUDONYMISE_AFTER_DAYS`, and is unstamped.
 *
 * Withheld and other-number calls are INCLUDED: they are stamped so the
 * predicate converges (research OQ7), and a withheld row's `caller_e164`
 * stays NULL (`missed_calls_withheld_has_no_number`).
 */
export async function listMissedCallsDueForPseudonymisation(
  now: Date,
  limit: number,
): Promise<MissedCallDueForPseudonymisation[]> {
  // The retention boundary, inclusive — see the lead due-read.
  const boundary = new Date(now.getTime() - PSEUDONYMISE_AFTER_DAYS * MS_PER_DAY);

  const rows = await getDb()
    .select({
      tenantId: missedCalls.tenantId,
      id: missedCalls.id,
      callerE164: missedCalls.callerE164,
      callerRaw: missedCalls.callerRaw,
      forwardedFromRaw: missedCalls.forwardedFromRaw,
    })
    .from(missedCalls)
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        isNull(missedCalls.leadId),
        lte(missedCalls.startedAt, boundary),
        isNull(missedCalls.pseudonymisedAt),
      ),
    )
    .orderBy(asc(missedCalls.startedAt), asc(missedCalls.id))
    .limit(limit);

  // The predicate makes `tenant_id` non-null; narrowed, not cast.
  return rows.flatMap((row) => (row.tenantId === null ? [] : [{ ...row, tenantId: row.tenantId }]));
}
