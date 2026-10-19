/**
 * THE CROSS-TENANT EXCEPTIONS. Everything in this file deliberately escapes the
 * scoping `for-tenant.ts` exists to enforce, and everything in it is therefore
 * written to be audited.
 *
 * The rule from `for-tenant.ts`'s header: cross-tenant work does not belong in
 * the scoped repository, and gets explicitly-named exports so a reviewer can
 * grep ONE STRING and see every crossing in the codebase. This file is where
 * those live. It is the whole list.
 *
 * WHY THE SYNC TICK NEEDS ONE. A five-minute tick has to answer "which
 * connections are due?" before it knows any tenant id — there is no tenant to
 * scope to yet. What it returns is deliberately thin: the connection metadata a
 * cycle needs to start, and nothing from `quotes`, `quote_contacts` or
 * `quote_status_events`. The moment a cycle knows which tenant it is working
 * on, it goes back through `forTenant(id)` for everything else, so the
 * unscoped surface is exactly one query wide.
 *
 * WHY THE WEBHOOK ADAPTER NEEDS ONE (02-03, SYNC-03). A ServiceM8 callback
 * arrives unauthenticated, carrying a job uuid and no tenant. Answering it means
 * asking "whose job is this?", which is a question that cannot be asked from
 * inside a tenant scope. `forAllTenants_webhookHint` is that question and
 * nothing more: it returns connection metadata for the ONE tenant that already
 * mirrors the uuid, or nothing.
 *
 * WHY THE CADENCE TICK NEEDS ONE (03-01, CAD-01/CAD-02). Same shape of question
 * as the sync tick, one minute apart instead of five: "whose cadences might have
 * work right now?" cannot be asked from inside a tenant scope. It returns thin
 * metadata only — the windowing inputs and the two pause flags — and the moment
 * a tenant is known the tick goes back through `forTenant(id)`.
 *
 * WHY THE EVENT CONSUMER NEEDS ONE (03-01). This is the third named export the
 * paragraph below anticipated, and it is the one that returns tenant DATA rather
 * than metadata — so it is worth saying plainly why that is not a hole in the
 * rule. The cadence engine IS the cross-tenant consumer the outbox contract
 * names ("Read your cursor: … WHERE consumer = 'cadence-engine' … Scan forward:
 * SELECT * FROM quote_status_events WHERE id > $cursor ORDER BY id", see
 * src/db/schema/quote-events.ts). A single ordered stream across every client is
 * the design; per-tenant cursors would mean the engine could not answer "have I
 * processed everything up to id N" at all. What keeps it audited is that it is
 * ONE named export, it returns only the outbox rows, and everything the consumer
 * then DOES with an event happens through `forTenant(event.tenantId)`.
 *
 * WHY THE INBOUND PATH NEEDS ONE (04-01, MSG-03/MSG-04). An SMS reply arrives
 * carrying a phone number and nothing else — no tenant, no cadence, no job — so
 * "whose conversation is this?" is the same unaskable-from-inside-a-scope
 * question `forAllTenants_webhookHint` faces, one channel over. It is the second
 * export here that returns tenant DATA, and what keeps it audited is the same
 * three things: it is ONE named export, it returns only the cadence columns the
 * threading decision needs, and everything the caller then DOES with a match
 * happens through `forTenant(match.tenantId)`.
 *
 * WHY THE APPROVAL QUEUE NEEDS ONE (06-01, CON-01). The operator's question is
 * "what must I approve next, ACROSS EVERYONE" (D-01), and the answer is an
 * ORDERING over every client's due touches. An ordering cannot be assembled from
 * N scoped reads without either fetching everything anyway or capping per
 * tenant — which would push a client with fifteen due drafts behind a client
 * with one. The cap and the sort only mean anything applied to the whole set at
 * once, which is the same argument the outbox scan makes about one ordered
 * stream. `forAllTenants_approvalQueue` is that question; see its own header for
 * what bounds it.
 *
 * WHY THE AGING PASS NEEDS TWO (06-02, CON-04). "Who is about to miss a send
 * slot" is the cadence tick's question one column over, and it cannot be asked
 * from inside a tenant scope for the same reason: there is no tenant yet, and
 * the answer must be ONE email covering every client rather than fifteen a
 * minute. `forAllTenants_claimNewlyStalled` is a guarded UPDATE ... RETURNING
 * whose WHERE clause IS the once-only guarantee; `forAllTenants_stalledTally`
 * is its read-only sibling for the nightly digest. Both return ids, client
 * names and integers — no body, no address, no customer name — because their
 * consumer is an email builder whose vocabulary is closed, and that closure has
 * to start here.
 *
 * WHY THE ESCALATION PASS NEEDS ONE (06-05, CON-03). "Which customer just said
 * yes, and has their tradie been told" is the inbound family's question with a
 * cadence attached, and it is unaskable from inside a scope for the same reason
 * every other inbound read is: a reply arrives carrying a phone number and no
 * client. `forAllTenants_hotUnescalated` is that question. It returns the widest
 * surface in this file after the queue — a customer's words AND their mobile —
 * because the message it feeds ENDS with `Call them: {mobile}`, which is the
 * entire product moment; see its own header for the four things that bound it,
 * including the absence of any join to `tenants`.
 *
 * WHY THE ARMING CONTROL NEEDS ONE (10-03, ARM-02/D-03). "Which clients does
 * this tap actually arm" is a question ABOUT the set of clients riding the
 * shared sms row, and there is no tenant to scope it to — the row it describes
 * has `tenant_id NULL` and belongs to nobody. `forAllTenants_armedBySmsGlobal`
 * is that question, and its whole return surface is ids and names, because its
 * consumer is one warning sentence read between two taps. See its own header.
 *
 * WHAT IS DELIBERATELY NOT HERE: any accessor that returns tenant DATA across
 * tenants for a reason other than the ones above — no cross-tenant read of
 * `quotes` or `quote_contacts` in its own right. Each of those is reachable per
 * tenant, and a convenience accessor "just for the console dashboard" is how the
 * scoping erodes.
 *
 * `suppressed_contacts` WAS on that list until 07-05, and the reversal is
 * recorded rather than absorbed: the opt-out rate's numerator must be restricted
 * to addresses in its denominator (A6), which is a join between two
 * tenant-scoped tables inside one grouped statement. It is reached by
 * `forAllTenants_reportMetrics` alone, only as a `count(DISTINCT (channel,
 * address))` and an EXISTS predicate, and the address is compared rather than
 * selected. See that function's header.
 *
 * `send_ledger` WAS on that list until 04-04, and the exception it now has is
 * deliberately the narrowest one in this file: `forAllTenants_ledgerOwners`
 * answers "whose send is this?" for ids a third party echoed back to us, it is
 * KEYED rather than filtered (no date range, no "all recent sends" arm, an empty
 * id list returns nothing), and its four-column select list contains no
 * `to_address` and no message content. See its own header for the full argument.
 *
 * `cadence_touches` (with `cadences` and `quotes` joined for the card's facts)
 * WAS on that list until 06-01, and the correction is made here rather than
 * worked around, exactly as `send_ledger`'s was. What keeps the widest crossing
 * in this file audited: a PINNED select list with no address column of any kind,
 * NO join to `tenants` (names are resolved on the page through the operator's
 * own JWT under RLS), a closed two-status predicate exported as a constant, and
 * every write it leads to going back through `forTenant(row.tenantId)`.
 *
 * WHY THE REPORTS OVERVIEW NEEDS ONE (07-05, RPT-03). "Which client is
 * drifting?" is a question ABOUT the set of clients, and there is no client to
 * scope it to until it has been answered. Fifteen clients × five metrics asked
 * through `forTenant(id)` is seventy-five round trips to render one table, on a
 * screen the operator opens between sales meetings; the same question grouped in
 * SQL is a handful. `forAllTenants_reportMetrics` is that question.
 *
 * WHAT CONTAINS IT — four things, and the fourth is the one that matters most:
 *
 *   1. COUNTS, SUMS AND FEE ROWS. The select lists hold integers, a numeric sum,
 *      an array of whole minutes, the append-only fee schedule, a client name and
 *      an IANA zone. No message body, no customer name, no quote column.
 *   2. THE ADDRESS IS COMPARED, NEVER SELECTED. The opt-out rate needs to know
 *      that a suppressed address is one we actually messaged (A6), so
 *      `to_address` appears inside a predicate and inside `count(DISTINCT …)`.
 *      It never leaves the database as a value — `tests/report-metrics.test.ts`
 *      asserts both the shape (no select list yields an address) and the
 *      behaviour (the stringified result contains no `@` and no `+61`).
 *   3. NO `quotes.*` COLUMN, NO `cadences.*` COLUMN, AND IT NEVER SELECTS FROM
 *      THE CADENCE TABLE. First-touch is derived from `quote_status_events`
 *      rather than from cadence rows (D-18), which is why the Phase 6 cadence
 *      pins — nine column refs, one read, two joins — are untouched by this
 *      addition. (The literal call spelling is avoided even in this comment:
 *      the tripwire counts occurrences in the SOURCE, prose included.)
 *   4. IT JOINS `tenants`, WHERE THE QUEUE ACCESSOR REFUSES TO — the split 06-02
 *      drew, applied again (U-10). Its two consumers are the
 *      `requireOperator()`-gated `/reports` page and the 06:30 cron digest; the
 *      digest holds no JWT and could not resolve a name any other way, and a
 *      second name-bearing export would widen this file by one more crossing to
 *      say the same thing twice.
 *
 * AND IT WRITES NOTHING. A metric NAGS (D-16, Phase 6 D-15): the >5% opt-out
 * alarm is a badge and one digest line. Nothing on this path pauses a cadence,
 * stops a tenant or records a suppression.
 *
 * WHY THE TELEPHONY PATH NEEDS TWO (11-01, CAP-03/D-02). A diverted call
 * arrives carrying the number it was dialled on and nothing else — the
 * `forAllTenants_webhookHint` question, one provider over: "whose number is
 * this?" cannot be asked from inside a tenant scope, because the tenant IS the
 * answer. `forAllTenants_divertNumberByE164` is that question, keyed on the
 * called number (UNIQUE, so no ordering is needed) and NEVER on ForwardedFrom.
 * `forAllTenants_activeDivertNumbers` is its reconcile sibling: the owner map
 * one paged Twilio call-log read is matched against (the
 * `forAllTenants_ledgerOwners` posture — one provider read, mapped onto our
 * rows, rather than a provider round trip per client). Both return a number,
 * a spoken name and the four contact-window columns; no caller data, no quote,
 * no cadence — and both WRITE NOTHING.
 */
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  sql,
} from 'drizzle-orm';

// The ONE spelling of "waiting on the operator" (CON-04). See
// APPROVAL_QUEUE_STATUSES below — this file aliases it rather than re-declaring
// it, and the import direction (db → core) is already established by
// `./client.ts` reading `@/core/shared/env`.
import { STALLABLE_TOUCH_STATUSES } from '@/core/aging/stall-policy';
// WR-01: the ONE rule for "which draft may still be offered", shared with the
// quote page — which reads the same population through RLS and cannot import
// anything from this layer. See the constant's own header.
import { APPROVABLE_DRAFT_STATUSES } from '@/core/approval/limits';
// 07-05, RPT-03: the first-touch window and the onboarding-gate attestation
// kind, read from the ONE place each is written. A `24` or an
// `'sm8_automation_off'` typed into SQL here would be a second definition that
// agrees with the pure functions until somebody changes one of them.
import { FIRST_TOUCH_HOURS } from '@/core/audit/constants';
import { SM8_AUTOMATION_ATTESTATION_KIND } from '@/core/drafting/onboarding-gate';
import type { FeeRow } from '@/core/reporting/fees';
import type { TenantMetricCounts } from '@/core/reporting/metrics';
import type { Period } from '@/core/reporting/period';
import {
  cadenceSettings,
  cadences,
  cadenceTouches,
  escalations,
  inboundMessages,
  messageTemplates,
  messagingConfig,
  quoteAttributions,
  quotes,
  quoteStatusEvents,
  sendLedger,
  sm8Connections,
  suppressedContacts,
  syncRuns,
  tenantAttestations,
  tenantDivertNumbers,
  tenantFees,
  tenants,
  touchDrafts,
  type QuoteStatusEvent,
  type TenantAttestationKind,
} from '@/db/schema';

import { getDb } from './client';
// 2026-10 (15-03): the overview's two missed-call groupings — see `(10)` and
// `(11)` in `forAllTenants_reportMetrics` for why they live in the family file.
import { countMissedCallsInWindow, listTenantIdsWithActiveDivert } from './leads';

/**
 * One unpaused connection, with the tenant metadata a cycle needs.
 *
 * NOTE WHAT IS ABSENT: the plaintext API key. The ciphertext travels; decryption
 * happens in the sync worker, once, and the result never returns to this layer.
 */
export interface DueConnection {
  tenantId: string;
  tenantName: string;
  /** The tenant's IANA zone — contact hours and DISPLAY. */
  tenantTimezone: string;
  apiKeyCiphertext: string;
  jobCursor: string | null;
  contactCursor: string | null;
  /** Failed cycles so far in the current episode — the D-06 policy's input. */
  consecutiveFailures: number;
  alertedAt: Date | null;
}

/**
 * Every connection the tick should attempt this cycle.
 *
 * `paused_at IS NULL` IS THE FILTER, AND IT IS LOAD-BEARING (D-06/D-08). A
 * paused connection means we no longer trust what we know about that client's
 * quotes — the key was revoked, so the mirror stopped updating at an unknown
 * point. Polling it again would produce a stream of auth failures, and (worse)
 * a cycle that somehow succeeded would emit transition events computed against
 * state that has been stale for days. The pause is cleared by a successful
 * re-key, which runs the same verify-then-write path as first connect.
 *
 * ── ORDERED BY HOW FAR BEHIND EACH CLIENT IS, NOT BY NAME (WR-03) ───────────
 *
 * An earlier revision ordered by `tenants.name`, so that a partial tick "covers
 * the same clients in the same order rather than a shuffling subset". The
 * stability was real and the conclusion was backwards: a stable order combined
 * with a function timeout is not a fairness policy, it is a STARVATION SCHEDULE.
 * The tick is sequential and one unresponsive account costs ~65 seconds, so
 * during a ServiceM8 slowdown the clients whose business names sort late were
 * never reached — the same clients, every tick, for as long as the slowdown
 * lasted. A client called Zenith Plumbing got systematically less sync than one
 * called Ace Electrical, for no reason anyone chose.
 *
 * `last_success_at ASC NULLS FIRST` makes the order self-correcting instead:
 * whoever is furthest behind goes first, so a client skipped by one tick is at
 * the FRONT of the next one. Never-synced connections lead, which is also the
 * right answer for a client who just connected.
 *
 * Determinism is preserved where it was actually needed — `tenant_id` breaks
 * ties, so two connections with identical `last_success_at` (or both NULL) still
 * have a fixed order rather than one the planner may vary between ticks.
 */
export async function forAllTenants_syncTick(): Promise<DueConnection[]> {
  return getDb()
    .select({
      tenantId: sm8Connections.tenantId,
      tenantName: tenants.name,
      tenantTimezone: tenants.timezone,
      apiKeyCiphertext: sm8Connections.apiKeyCiphertext,
      jobCursor: sm8Connections.jobCursor,
      contactCursor: sm8Connections.contactCursor,
      consecutiveFailures: sm8Connections.consecutiveFailures,
      alertedAt: sm8Connections.alertedAt,
    })
    .from(sm8Connections)
    .innerJoin(tenants, eq(sm8Connections.tenantId, tenants.id))
    .where(isNull(sm8Connections.pausedAt))
    .orderBy(sql`${sm8Connections.lastSuccessAt} ASC NULLS FIRST`, sm8Connections.tenantId);
}

/**
 * The connection a webhook hint belongs to, plus the field the debounce needs.
 *
 * `lastSuccessAt` is here and not on `DueConnection` because the tick has no use
 * for it — it runs every connection every five minutes regardless. The webhook
 * path is the only caller that must decide whether a cycle is worth running
 * *right now*, so the field travels with the type that faces that decision.
 */
export interface WebhookHintConnection extends DueConnection {
  lastSuccessAt: Date | null;
  /**
   * The start of the most recent cycle of ANY outcome (WR-02).
   *
   * Distinct from `lastSuccessAt`, and that distinction is the whole point: a
   * debounce measured from the last SUCCESS stops engaging the moment an
   * account starts failing, because `last_success_at` stops advancing while the
   * failures continue. That is precisely backwards — it removes the rate-limit
   * protection at the moment the account is least able to absorb traffic.
   *
   * `sync_runs` gets a row on every cycle, success or failure, so its latest
   * `started_at` is the cheapest honest answer to "when did we last hit this
   * account". Read as a correlated subquery rather than denormalised onto
   * `sm8_connections` because it is needed by exactly one caller, and a column
   * would have to be written correctly in both `recordFailure` and the success
   * branch forever.
   */
  lastAttemptAt: Date | null;
}

/**
 * Resolve a ServiceM8 job uuid to the connection that mirrors it.
 *
 * ── WHY THE JOB UUID IS THE KEY, AND WHAT THAT COSTS ────────────────────────
 *
 * A webhook callback carries `{uuid, changed fields, resource_url}` and no
 * identifier we chose. There is no stored ServiceM8 *account* identifier to key
 * on either — a private API key is not an account uuid, and the OAuth arm that
 * would supply one does not exist yet (docs/servicem8-api-notes.md §Webhook
 * activation). The job uuid is the one identifier present in both the callback
 * and our own tables.
 *
 * The cost is explicit and acceptable: **a job we have never seen cannot be
 * resolved.** That case is not a gap, it is the design — polling is the SYNC-03
 * guarantee and the webhook is only ever an accelerator, so an unresolvable hint
 * costs at most one polling interval of latency on a job that is, by definition,
 * brand new. The 90-day backfill plus five-minute polling means the resolvable
 * set is every job that has existed for more than five minutes.
 *
 * Returns `undefined` for an unknown uuid AND for a paused connection. A paused
 * connection must not be polled by any path (D-06): the pause means we no longer
 * trust our mirror, and a webhook is not evidence that the revoked key came back.
 *
 * ── WHY `LIMIT 1` NEEDS AN `ORDER BY` (WR-09) ───────────────────────────────
 *
 * The uniqueness constraint on `quotes` is `(tenant_id, sm8_job_uuid)`, NOT
 * `sm8_job_uuid` alone — so two tenants holding the same job uuid is a legal
 * state, not a corrupt one. It arises from two design partners on one ServiceM8
 * account, a shared franchise account, or a client onboarded twice under
 * different tenant rows during testing.
 *
 * With a bare `LIMIT 1`, Postgres may return either row, and which one it
 * returns can change with the plan, the statistics or a vacuum. The hint would
 * poll one tenant and never the other, non-deterministically — a client silently
 * losing webhook acceleration for reasons invisible from anywhere.
 *
 * So the choice is made explicitly, and made in the direction that is useful:
 * `last_success_at ASC NULLS FIRST` picks whichever tenant is furthest behind,
 * matching `forAllTenants_syncTick`'s ordering, with `tenant_id` breaking exact
 * ties so the result is stable rather than merely defined.
 */
export async function forAllTenants_webhookHint(
  sm8JobUuid: string,
): Promise<WebhookHintConnection | undefined> {
  const [row] = await getDb()
    .select({
      tenantId: sm8Connections.tenantId,
      tenantName: tenants.name,
      tenantTimezone: tenants.timezone,
      apiKeyCiphertext: sm8Connections.apiKeyCiphertext,
      jobCursor: sm8Connections.jobCursor,
      contactCursor: sm8Connections.contactCursor,
      consecutiveFailures: sm8Connections.consecutiveFailures,
      alertedAt: sm8Connections.alertedAt,
      lastSuccessAt: sm8Connections.lastSuccessAt,
      // Served by `sync_runs_tenant_started_idx` on (tenant_id, started_at), so
      // this is an index-only max rather than a scan of the run history.
      lastAttemptAt: sql<Date | null>`(
        select max(${syncRuns.startedAt})
          from ${syncRuns}
         where ${syncRuns.tenantId} = ${quotes.tenantId}
      )`,
    })
    .from(quotes)
    .innerJoin(sm8Connections, eq(sm8Connections.tenantId, quotes.tenantId))
    .innerJoin(tenants, eq(tenants.id, quotes.tenantId))
    .where(and(eq(quotes.sm8JobUuid, sm8JobUuid), isNull(sm8Connections.pausedAt)))
    .orderBy(sql`${sm8Connections.lastSuccessAt} ASC NULLS FIRST`, sm8Connections.tenantId)
    .limit(1);

  return row;
}

/**
 * Everything the cadence tick needs to decide WHEN, before it knows any tenant.
 *
 * NOTE WHAT IS ABSENT: quotes, contacts, cadences, touches. This returns the
 * windowing inputs and the two pause flags and nothing else — the moment a
 * tenant is known, the tick goes back through `forTenant(id)`.
 */
export interface CadenceTickTenant {
  tenantId: string;
  /**
   * The client's own name, as the operator typed it at onboarding.
   *
   * READ BY THE BODY COMPOSER, not by the scheduler: the shared dedicated number
   * cannot identify anybody, so the Spam Act identification lives in the message
   * copy (`complianceSuffix`, src/core/cadence/sender.ts). It is selected here
   * rather than re-read per touch because dispatch already holds this row and a
   * second query would land inside the loop that deliberately runs outside the
   * claim transaction.
   */
  name: string;
  /** IANA identifier, never an offset — offsets break across DST. */
  timezone: string;
  /** `'HH:MM:SS'` STRINGS from the driver, not Dates. See the note below. */
  contactHoursStart: string;
  contactHoursEnd: string;
  /** ISO weekdays, Monday = 1 .. Sunday = 7 — NOT JavaScript `getDay()`. */
  contactDays: number[];
  /**
   * D-03. NULL when the tenant has no `cadence_settings` row yet, which is the
   * normal state until their first cadence is created (the row is seeded
   * lazily, not at tenant creation). The caller substitutes
   * DEFAULT_PREFERRED_SEND_TIME rather than skipping the tenant.
   */
  preferredSendTime: string | null;
  /**
   * Phase 2's D-06/D-08 pause: the ServiceM8 key stopped working.
   * NON-NULL MEANS DO NOT SEND.
   */
  connectionPausedAt: Date | null;
  /**
   * D-06's per-client pause: the operator said stop messaging.
   * NON-NULL MEANS DO NOT SEND. Also NULL when no settings row exists.
   */
  settingsPausedAt: Date | null;
}

/**
 * Every connected tenant the cadence tick should look at this minute.
 *
 * ── THERE IS NO `paused_at IS NULL` FILTER HERE, AND ITS ABSENCE IS THE       ─
 *    WHOLE DESIGN (contrast `forAllTenants_syncTick`, which does filter) ─────
 *
 * The sync tick's job is to TALK TO SERVICEM8, and a paused connection means
 * the key is dead — polling it produces nothing but auth failures, so it is
 * excluded outright. The cadence tick's job is different and splits in two:
 *
 *   CONSUME EVENTS  — must happen for every tenant, paused or not. The outbox
 *                     already holds `won`, `lost` and `removed` events for
 *                     clients whose connection later paused, and those events
 *                     STOP cadences. Skipping a paused tenant would leave a
 *                     cadence chasing a job that was won a week ago, and the
 *                     backlog would then all land at once on resume.
 *   DISPATCH        — must NOT happen while either pause is set.
 *
 * So both flags travel with the row and the tick decides per phase, rather than
 * this query deciding for it. That is the same rule `quote_status_events`'s
 * header states from the other end: "This table says what happened, not whether
 * we may act… the outbox carries no permission to send."
 *
 * TWO INDEPENDENT PAUSES, BOTH BLOCKING, NEITHER IMPLYING THE OTHER. A
 * successful re-key clears `connectionPausedAt` and says nothing about whether
 * the client wants messaging resumed; an operator un-pause clears
 * `settingsPausedAt` and says nothing about whether the key works. See the
 * header of src/db/schema/cadence-settings.ts.
 *
 * INNER JOIN on `sm8_connections`, LEFT JOIN on `cadence_settings`: a tenant
 * with no connection has no mirrored quotes and therefore no cadences, so
 * there is genuinely nothing to do — but a tenant with no settings row is the
 * NORMAL state before their first cadence (the row is seeded lazily), and
 * dropping them would mean a client could never get their first touch.
 *
 * ORDER BY `tenant_id` alone. Unlike the sync tick there is no fairness problem
 * to solve here: the per-minute tick does no network I/O per tenant, so it does
 * not run out of time partway down the list and starve whoever sorts late.
 * A plain deterministic order is all that is needed, and is what makes a test
 * over two tenants assert a sequence rather than a set.
 */
export async function forAllTenants_cadenceTick(): Promise<CadenceTickTenant[]> {
  return getDb()
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      timezone: tenants.timezone,
      contactHoursStart: tenants.contactHoursStart,
      contactHoursEnd: tenants.contactHoursEnd,
      contactDays: tenants.contactDays,
      preferredSendTime: cadenceSettings.preferredSendTime,
      connectionPausedAt: sm8Connections.pausedAt,
      settingsPausedAt: cadenceSettings.pausedAt,
    })
    .from(tenants)
    .innerJoin(sm8Connections, eq(sm8Connections.tenantId, tenants.id))
    .leftJoin(cadenceSettings, eq(cadenceSettings.tenantId, tenants.id))
    .orderBy(tenants.id);
}

/**
 * The outbox read the `events.since()` doc comment promised: "Phase 3 reads
 * across tenants and will do so through its own explicitly-named cross-tenant
 * accessor."
 *
 * This is that accessor, and it follows the consumption contract in
 * src/db/schema/quote-events.ts LITERALLY:
 *
 *   WHERE id > $cursor ORDER BY id
 *
 * ── ORDER BY `id`, NEVER A TIMESTAMP, AND THE CONTRACT SAYS WHY ────────────
 *
 * `id` is a bigserial: monotonic and unaffected by clock adjustment.
 * `detected_at` ties to the microsecond across a batch written in one
 * transaction, so ordering on it is ordering on a tie — and a tie broken
 * differently between two runs is a consumer that processes a `won` before the
 * `quote_opened` it followed. `occurred_at` is worse still: it comes from
 * ServiceM8 and can move BACKWARDS relative to detection.
 *
 * ── `limit` IS NOT OPTIONAL, AND IS NOT A PERFORMANCE KNOB ─────────────────
 *
 * It bounds one tick's work. A consumer registering for the first time (or one
 * that fell behind during an outage) faces the entire history from id 0, and an
 * unbounded read would either time out the function or process thousands of
 * events in a single transaction that then rolls back in full on any error —
 * making progress impossible exactly when progress matters. Bounded batches
 * mean the cursor advances a little on every tick and the backlog drains.
 *
 * REPLAY IS LEGAL by contract, so the caller must act idempotently and advance
 * the cursor IN THE SAME TRANSACTION as whatever it did. Advancing separately
 * is how a consumer skips work after a crash.
 */
export async function forAllTenants_pendingQuoteEvents(
  afterId: number,
  limit: number,
): Promise<QuoteStatusEvent[]> {
  return getDb()
    .select()
    .from(quoteStatusEvents)
    .where(gt(quoteStatusEvents.id, afterId))
    .orderBy(quoteStatusEvents.id)
    .limit(limit);
}

/** One live cadence a normalized mobile could belong to. */
export interface CadenceByContactMobile {
  tenantId: string;
  cadenceId: string;
  /**
   * NULL on a LEAD cadence (Phase 12): a reply to a text-back threads to the
   * lead cadence and pauses it like any reply (D-04), and the inbound row
   * records `leadId` instead.
   */
  quoteId: string | null;
  /**
   * The `leads.id` of a lead cadence; NULL on a quote cadence. Exactly one of
   * `quoteId` / `leadId` is set, so the cadence's kind is not selected
   * separately — the cross-tenant column pin in tests/sync-upsert.test.ts
   * admits only what the threading decision needs (12-03).
   */
  leadId: string | null;
  status: string;
  pauseReason: string | null;
  /** The SNAPSHOT addresses — what suppression must be written verbatim from. */
  contactMobile: string | null;
  contactEmail: string | null;
  contactName: string | null;
}

/**
 * Every LIVE cadence whose snapshotted mobile is `normalizedMobile` (04-01,
 * MSG-03/MSG-04).
 *
 * WHY THE INBOUND PATH NEEDS ONE. This is the fifth entry in this file and the
 * second that returns tenant DATA, so it owes the same justification the outbox
 * scan gives. An SMS reply arrives carrying a phone number and nothing else —
 * no tenant, no cadence, no job. "Whose conversation is this?" is therefore a
 * question that CANNOT be asked from inside a tenant scope, in the same shape as
 * `forAllTenants_webhookHint`'s "whose job is this uuid?". Everything the caller
 * then DOES with the answer — the suppression, the stop, the touch skip — runs
 * through `forTenant(candidate.tenantId)` via `suppressFromInbound`.
 *
 * ── THE MATCH IS ON `normalizeAuMobile` OUTPUT, ON BOTH SIDES ───────────────
 *
 * The cadence's `contact_mobile` snapshot is stored normalized (`+614…`) by
 * `selectPrimaryContact`, and the caller normalizes the inbound `from` with THE
 * SAME function before calling this. That is the whole of MSG-04's encoding
 * edge: `0412 345 678`, `0412345678` and `+61412345678` are one human, and a
 * lookup that compared raw strings would fail to thread a reply from the very
 * customer we just texted. One normalizer, one spelling, one key — the rule
 * `suppressed_contacts` states from the other end.
 *
 * ── LIVE ONLY, AND THE CONSEQUENCE IS STATED RATHER THAN HIDDEN ────────────
 *
 * `status IN ('active','paused')` — a reply to a cadence that already stopped
 * (won, lost, killed) returns nothing here and the caller records the message as
 * `unmatched` for an operator. That is the honest answer: there is no live chase
 * to stop. It is NOT the same as "we ignored them", because the inbound row is
 * written either way, and a STOP arriving after the cadence stopped is a human
 * who should still never be chased again — closing that gap is 04-02's job (it
 * needs a suppression path that does not require a live cadence), and it is
 * flagged here rather than left to be discovered.
 *
 * ── HANDLING MUST BE ORDER-INDEPENDENT ──────────────────────────────────────
 *
 * The ORDER BY makes the RESULT deterministic (two cadences with the same
 * `created_at` must not swap between calls), but the caller must not read
 * meaning into the first element. Two live cadences for one mobile is an
 * AMBIGUOUS reply — possibly across two different tenants, i.e. two different
 * tradies who quoted the same person — and acting on whichever sorted first
 * would suppress an arbitrary one of them. The count is the decision; the order
 * is only so tests can assert a sequence.
 */
export async function forAllTenants_cadencesByContactMobile(
  normalizedMobile: string,
): Promise<CadenceByContactMobile[]> {
  return getDb()
    .select({
      tenantId: cadences.tenantId,
      cadenceId: cadences.id,
      quoteId: cadences.quoteId,
      leadId: cadences.leadId,
      status: cadences.status,
      pauseReason: cadences.pauseReason,
      contactMobile: cadences.contactMobile,
      contactEmail: cadences.contactEmail,
      contactName: cadences.contactName,
    })
    .from(cadences)
    .where(
      and(
        eq(cadences.contactMobile, normalizedMobile),
        inArray(cadences.status, ['active', 'paused']),
      ),
    )
    .orderBy(cadences.createdAt, cadences.id);
}

/**
 * Every tenant id. IDS ONLY — the sixth crossing, and the narrowest of them
 * (04-02, D-03).
 *
 * ── WHY AN UNTHREADABLE OPT-OUT NEEDS THE WHOLE LIST ────────────────────────
 *
 * A customer texts STOP from a number that matches NO live cadence — they
 * replied a week after the chase ended, or their quote was already won, or they
 * are answering a message from a client who has since disconnected. There is no
 * tenant to scope the suppression to, and refusing to record the opt-out
 * because it cannot be threaded is the one wrong answer (D-03). So the bare
 * mobile is suppressed for EVERY client: over-suppression is the compliant
 * failure mode, and the cost of the alternative is a human who asked to be left
 * alone being chased by whichever client quotes them next.
 *
 * ── WHAT MAKES THIS THE SAFEST EXPORT IN THE FILE, NOT THE MOST DANGEROUS ───
 *
 * The audit rule this file states is about tenant DATA leaving its scope. This
 * returns a column of primary keys and nothing else — no name, no timezone, no
 * contact window, nothing a caller could render, join or leak. It cannot be
 * grown into a dashboard query without changing its return type, which is the
 * property the select-list pins on `cadences` exist to approximate. Everything
 * a caller then DOES with an id happens through `forTenant(id)`, as always.
 *
 * `ORDER BY id` so the fan-out is deterministic across calls. The caller must
 * not read meaning into the order: every id is processed, and a fan-out that
 * returned early on the first one would be the bug this ordering hides.
 */
export async function forAllTenants_ids(): Promise<string[]> {
  const rows = await getDb().select({ id: tenants.id }).from(tenants).orderBy(tenants.id);
  return rows.map((row) => row.id);
}

/** Who owns a send, and what became of it. Ids and one enum, nothing else. */
export interface LedgerOwner {
  id: string;
  tenantId: string;
  cadenceId: string;
  /** One of SEND_LEDGER_OUTCOMES, or null for "we do not know". */
  outcome: string | null;
}

/**
 * WHOSE SEND IS THIS? (04-04, MSG-01, T-4-18.)
 *
 * ── THIS IS THE ONE `send_ledger` CROSSING, AND THE HEADER SAID THERE WOULD BE
 *    NONE ──────────────────────────────────────────────────────────────────
 *
 * The paragraph at the top of this file lists `send_ledger` among the tables
 * with no cross-tenant read, and that list was right about the reason: a
 * "convenience accessor just for the console dashboard" is how scoping erodes.
 * This is not that accessor, and the difference is worth stating rather than
 * assuming.
 *
 * The reconciliation sweep polls ClickSend's own message history. A history row
 * carries the `custom_string` we generated — a `send_ledger.id` — and NO TENANT,
 * because a third party has no concept of one. Turning "ClickSend refused this
 * message because the recipient opted out" into the suppression evidence the
 * Spam Act requires means asking whose send it was, and that is the same
 * unaskable-from-inside-a-scope question `forAllTenants_webhookHint` faces with
 * a job uuid and `forAllTenants_cadencesByContactMobile` faces with a phone
 * number. It is here, named, greppable, for exactly that reason.
 *
 * ── WHAT BOUNDS IT ─────────────────────────────────────────────────────────
 *
 * It is KEYED, not filtered: a caller must already hold the primary keys, which
 * it can only have learned from the provider echoing back ids we generated.
 * There is no date range, no tenant list, no "all recent sends" arm — this
 * cannot enumerate the ledger, and an empty id list returns nothing rather than
 * everything.
 *
 * The select list is FOUR COLUMNS and none of them is evidence. `to_address` is
 * a customer's mobile and is deliberately absent; so are `channel`,
 * `provider_message_id` and every delivery column. What comes back is an
 * ownership answer — which tenant, which cadence — plus the one fact the caller
 * gates on. Everything it then DOES happens through `forTenant(tenantId)`, as
 * always. `tests/lint-ban.test.ts` pins that select list, so growing it is a
 * decision somebody has to type and argue for.
 */
export async function forAllTenants_ledgerOwners(
  ledgerIds: readonly string[],
): Promise<LedgerOwner[]> {
  if (ledgerIds.length === 0) return [];

  return getDb()
    .select({
      id: sendLedger.id,
      tenantId: sendLedger.tenantId,
      cadenceId: sendLedger.cadenceId,
      outcome: sendLedger.outcome,
    })
    .from(sendLedger)
    .where(inArray(sendLedger.id, [...ledgerIds]))
    .orderBy(sendLedger.id);
}

/**
 * The touch statuses the approval queue is made of — THE ONE POPULATION RULE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KEYED ON THE TOUCH, NEVER ON DRAFT ROWS (D-09). A touch stuck in         │
 * │ `needs_draft` behind repeated deterministic API failures has NO draft    │
 * │ row at all — 05-04 decided a 400 records nothing — so a queue built from │
 * │ `touch_drafts` would be blind to exactly the touches that are stuck.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Exported because the queue page, the nav count badge (06-02) and the stall
 * predicate (CON-04) must all mean the same thing by "waiting on the operator".
 * Three spellings of one predicate is how a badge reads 4 next to a list of 3.
 *
 * ── AND SINCE 06-02 IT IS AN ALIAS, NOT A COPY ─────────────────────────────
 *
 * The literal now lives in `src/core/aging/stall-policy.ts`, which is the pure
 * module the nav badge, the urgency tier and the stall alert email all read.
 * 06-01 left this as the canonical spelling and warned the next plan not to
 * re-spell it; an alias makes that structural instead of advisory — there is
 * one array in the codebase, and a fifth consumer cannot acquire a fifth
 * opinion by copying the wrong one. The name stays exported under its own
 * identifier because the queue's population rule and the aging rule are two
 * QUESTIONS that happen to share an answer, and the day they diverge should be
 * a deliberate edit here rather than a silent widening of the alert predicate.
 */
export const APPROVAL_QUEUE_STATUSES = STALLABLE_TOUCH_STATUSES;

/**
 * The most cards one read returns.
 *
 * NOT a page size — there is no pagination (D-03: speed comes from layout, not
 * from bulk affordances, and a "next page" button on a deadline-sorted queue
 * invites working the second page first). The sort happens in SQL BEFORE this
 * limit, so what the cap admits is the SOONEST deadlines by construction; the
 * true total travels beside the rows so an operator can see that more exist
 * rather than having them silently disappear.
 */
export const APPROVAL_QUEUE_CAP = 50;

/** One card on the cross-client approval queue. */
export interface ApprovalQueueRow {
  touchId: string;
  tenantId: string;
  cadenceId: string;
  /**
   * NULL for a LEAD touch (Phase 13). Since 13-02 lead touches 2 and 3 are
   * promoted, drafted and parked here like any other, so a row carries
   * exactly one of `quoteId` / `leadId`, and `kind` says which.
   */
  quoteId: string | null;
  /** One of CADENCE_KINDS — `'lead'` renders as a missed-call card with no quote link. */
  kind: string;
  /** The lead a lead touch chases; NULL on a quote touch. */
  leadId: string | null;
  touchNumber: number;
  channel: string;
  /** One of APPROVAL_QUEUE_STATUSES. */
  touchStatus: string;
  scheduledAt: Date;
  /** 05-04's deterministic-failure counter — why a `needs_draft` row is stuck. */
  draftFailures: number;
  /** The cadence's contact SNAPSHOT name, never a live mirror lookup. */
  contactName: string | null;
  /** `null` when the quote row has vanished from our mirror (`mirror_missing`). */
  quoteDescription: string | null;
  quoteJobId: string | null;
  /* --- the latest draft attempt, or nulls when there is none (05-04) ------ */
  draftId: string | null;
  draftFinalBody: string | null;
  draftStatus: string | null;
  draftSegments: number | null;
  draftModel: string | null;
  draftAttempt: number | null;
  draftViolations: unknown;
}

/** What one queue read answers: the capped cards, and how many there really are. */
export interface ApprovalQueuePage {
  rows: ApprovalQueueRow[];
  /**
   * The TRUE count over the same predicate, not `rows.length`.
   *
   * The count line on the page is the only thing that can tell an operator the
   * cap is engaged. Reporting `rows.length` would make 50 and 500 render
   * identically, which is the overflow failure the sort-before-LIMIT rule exists
   * to bound rather than to hide.
   */
  total: number;
}

/**
 * EVERY DRAFT WAITING ON THE OPERATOR, ACROSS EVERY CLIENT, SOONEST FIRST
 * (06-01, CON-01).
 *
 * ── WHY THIS CROSSING EXISTS, IN THE TERMS THIS FILE DEMANDS ────────────────
 *
 * This is the EIGHTH named crossing and, with the outbox scan, one of the very
 * few that returns customer-visible content across tenants — a frozen
 * `final_body`, a contact's first name, a job description. That is a bigger
 * surface than any accessor above it, so the justification has to be bigger too.
 *
 * The operator's question is "what must I approve next, ACROSS EVERYONE"
 * (D-01). It is not a per-client question with a loop around it: the answer is
 * an ORDERING over every client's touches by send slot, and an ordering cannot
 * be assembled from N scoped reads without either fetching everything (the same
 * crossing with more round trips) or capping per tenant, which would push a
 * client with fifteen due drafts past a client with one. The cap and the sort
 * only mean anything if they are applied to the whole set at once — which is the
 * same argument `forAllTenants_pendingQuoteEvents` makes about one ordered
 * stream, and the same one the inbox's cross-tenant triage read makes about
 * replies. The operator IS the cross-tenant human (T-4-25, D-03).
 *
 * ── WHAT BOUNDS IT ─────────────────────────────────────────────────────────
 *
 * The select list is PINNED and joins NOTHING to `tenants`: the queue page
 * resolves client names through the OPERATOR'S OWN JWT under RLS, exactly as the
 * inbox does, so this accessor can never name a client the operator may not
 * already see. There is no address column — no `contact_mobile`, no
 * `contact_email`, no `to_address` — because a card is approved by reading the
 * message, not by reading who it is going to. And the predicate is the closed
 * two-status set above, not a date range or a free filter, so this cannot be
 * grown into "all touches" without editing the exported constant.
 *
 * Every WRITE the queue then performs happens through `forTenant(row.tenantId)`,
 * as always — and through the one approval core, which re-reads the draft under
 * that scope before it writes anything.
 *
 * ── NO CADENCE-STATUS FILTER, AND THE ABSENCE IS THE DECISION ───────────────
 *
 * A paused cadence's pending draft STAYS VISIBLE. The pause is context, not
 * concealment: the operator paused it, the draft is still written and still
 * unapproved, and hiding it would make "why is nothing waiting on me" and
 * "everything is approved" render identically. It also keeps this predicate
 * literally identical to the nav badge's and the stall predicate's, which is the
 * `deriveHealth` one-derivation rule applied to a queue.
 *
 * ── THE LATEST ATTEMPT, VIA A GROUPED SUBQUERY, LEFT-JOINED ────────────────
 *
 * LEFT, not INNER: a `needs_draft` touch legitimately has no draft row (05-04),
 * and an inner join would silently drop precisely the touches CON-04 alerts
 * about. `max(attempt)` rather than `max(created_at)` because `attempt` is the
 * column the drafting pass increments and two attempts of one tick can share a
 * timestamp — the same rule the quote page's own read follows, and
 * `touch_drafts_touch_attempt_uniq` makes the pair single-valued.
 *
 * AND THE JOIN CARRIES `APPROVABLE_DRAFT_STATUSES` (WR-01). The quote page
 * filtered the latest attempt on those two statuses and this accessor did not,
 * which is the CR-02 drift class — one population rule, two filters — inside the
 * phase built to prevent it. The rule now lives in one leaf module both readers
 * import, and it sits on the JOIN rather than the WHERE so the no-draft touches
 * above still come back.
 *
 * ── SORT BEFORE THE LIMIT, AND THE TIE-BREAK IS NOT OPTIONAL ────────────────
 *
 * `(scheduled_at ASC, id ASC)` in SQL, before `LIMIT`. Sorting after the cap
 * would order only what the cap happened to admit — the established house rule.
 * The `id` tie-break is what stops two drafts due at the same instant swapping
 * places between renders, which on a list worked one-handed by thumb is how the
 * wrong card gets approved.
 */
export async function forAllTenants_approvalQueue(): Promise<ApprovalQueuePage> {
  const db = getDb();

  const waiting = inArray(cadenceTouches.status, [...APPROVAL_QUEUE_STATUSES]);

  /**
   * The newest attempt number per touch. See the header.
   *
   * THE ALIAS IS DELIBERATELY NOT `attempt`. Drizzle emits an aggregate
   * subquery column by its bare `.as()` name in the join condition, so calling
   * it `attempt` produced `... and "touch_drafts"."attempt" = "attempt"` —
   * which Postgres refuses outright as `42702 column reference "attempt" is
   * ambiguous`, because `touch_drafts` is in scope with a column of that name.
   * A name no real column shares is what keeps the reference unqualifiable.
   */
  const latest = db
    .select({
      touchId: touchDrafts.touchId,
      latestAttempt: sql<number>`max(${touchDrafts.attempt})`.as('latest_attempt_number'),
    })
    .from(touchDrafts)
    .groupBy(touchDrafts.touchId)
    .as('latest_attempt');

  const [rows, counted] = await Promise.all([
    db
      .select({
        touchId: cadenceTouches.id,
        tenantId: cadenceTouches.tenantId,
        cadenceId: cadenceTouches.cadenceId,
        quoteId: cadences.quoteId,
        // Phase 13 (13-02): which kind of card this is, and whose lead. The
        // kind is DERIVED from the lead id rather than selected — the
        // kind-identity CHECK makes `lead_id IS NOT NULL` exactly a lead row —
        // so this file's pinned cadence column set does not grow (12-03 made
        // the same choice for the threading read).
        kind: sql<string>`CASE WHEN ${cadences.leadId} IS NOT NULL THEN 'lead' ELSE 'quote' END`,
        leadId: cadences.leadId,
        touchNumber: cadenceTouches.touchNumber,
        channel: cadenceTouches.channel,
        touchStatus: cadenceTouches.status,
        scheduledAt: cadenceTouches.scheduledAt,
        draftFailures: cadenceTouches.draftFailures,
        contactName: cadences.contactName,
        quoteDescription: quotes.jobDescription,
        quoteJobId: quotes.generatedJobId,
        draftId: touchDrafts.id,
        draftFinalBody: touchDrafts.finalBody,
        draftStatus: touchDrafts.status,
        draftSegments: touchDrafts.segments,
        draftModel: touchDrafts.model,
        draftAttempt: touchDrafts.attempt,
        draftViolations: touchDrafts.validatorFailures,
      })
      .from(cadenceTouches)
      .innerJoin(cadences, eq(cadences.id, cadenceTouches.cadenceId))
      // LEFT, because a quote can vanish from our own mirror (`mirror_missing`)
      // while its touches are still live — and a card with no description is
      // still a card the operator must be able to act on.
      .leftJoin(quotes, eq(quotes.id, cadences.quoteId))
      .leftJoin(latest, eq(latest.touchId, cadenceTouches.id))
      .leftJoin(
        touchDrafts,
        and(
          eq(touchDrafts.touchId, cadenceTouches.id),
          eq(touchDrafts.attempt, latest.latestAttempt),
          // ── THE STATUS RULE, IN THE JOIN AND NOT IN THE CALLER (WR-01). ──
          //
          // On the JOIN condition, deliberately, not in the WHERE: a `where`
          // would turn this LEFT join into an effective INNER one and drop the
          // `needs_draft` touches the header just finished explaining must
          // survive. Here it drops only the DRAFT, so a touch whose latest
          // attempt is `approved` or `superseded` falls through to the existing
          // `row.draft === null` no-draft card — which says something honest
          // instead of offering a tap the server would refuse.
          inArray(touchDrafts.status, [...APPROVABLE_DRAFT_STATUSES]),
        ),
      )
      .where(waiting)
      // IN SQL, BEFORE THE LIMIT. See the header.
      .orderBy(cadenceTouches.scheduledAt, cadenceTouches.id)
      .limit(APPROVAL_QUEUE_CAP),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(cadenceTouches)
      .where(waiting),
  ]);

  return { rows, total: counted[0]?.total ?? 0 };
}

/* ========================================================================= *
 * THE AGING CROSSING (06-02, CON-04)
 * ========================================================================= */

/** One client's share of the stall, in the alert's own vocabulary. */
export interface StalledTenantTally {
  tenantId: string;
  /** The client's own name, as the operator typed it at onboarding. */
  tenantName: string;
  count: number;
}

/** What the claim moved, and who it belongs to. Ids only. */
export interface ClaimedStalledTouch {
  touchId: string;
  tenantId: string;
}

export interface StallClaim {
  /** Exactly the touches whose `stall_alerted_at` this call set. */
  claimed: ClaimedStalledTouch[];
  /** The same set, grouped and named — the email's whole input. */
  perTenant: StalledTenantTally[];
}

/**
 * Group `{tenantId}` rows into named per-tenant tallies.
 *
 * ONE service-role read of `tenants`, keyed by the ids that came back — never a
 * scan, never a join dragged through the UPDATE. The name is needed because the
 * operator's alert has to say WHICH client, and "Acme Plumbing: 2" is the whole
 * of what it says about them.
 */
async function tallyByTenant(tenantIds: readonly string[]): Promise<StalledTenantTally[]> {
  const unique = [...new Set(tenantIds)];
  if (unique.length === 0) return [];

  const named = await getDb()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(inArray(tenants.id, unique));

  const nameOf = new Map(named.map((row) => [row.id, row.name]));

  return unique.map((tenantId) => ({
    tenantId,
    // A tenant row deleted between the claim and this read is not a reason to
    // drop the count — the touches are real and the operator still has work.
    // `Another client` is the inbox's precedent for an unresolvable name.
    tenantName: nameOf.get(tenantId) ?? 'Another client',
    count: tenantIds.filter((id) => id === tenantId).length,
  }));
}

/**
 * CLAIM EVERY NEWLY-STALLED TOUCH, EXACTLY ONCE (CON-04, D-11).
 *
 * ── THE WHERE CLAUSE IS THE IDEMPOTENCE, NOT THE CALLER ────────────────────
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `stall_alerted_at IS NULL` inside the UPDATE, with RETURNING, is what     │
 * │ makes "one alert per touch per threshold crossing" true. Only the rows    │
 * │ this statement actually flipped come back, so two ticks racing produce    │
 * │ one email and one empty result rather than two emails.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This is the `quote_opened` rule applied a third time (02-05's eligibility
 * UPDATE, 03-01's `alerted_at`): emission is driven by the statement's own
 * RETURNING, never by a list the caller assembled from an earlier SELECT. A
 * read-then-write would be a guarantee that holds because of what one caller
 * does today, and "a caller-dependent guarantee is not a guarantee" is the
 * sentence the sync failure policy already earned the hard way.
 *
 * ── IT WRITES ONE COLUMN, AND OBSERVES EVERYTHING ELSE ─────────────────────
 *
 * `stall_alerted_at` and `updated_at`. NOT `status`, not `skip_reason`, not
 * `scheduled_at`. Aging notices; the D-09/D-10/D-11 re-window pass is the only
 * thing that MOVES a touch, and the only thing that retires one. An aging pass
 * that also skipped a touch would be a second schedule authority, quietly
 * disagreeing with the first.
 *
 * ── WHY IT CROSSES TENANTS, AND WHY IT JOINS `tenants` WHEN THE QUEUE DOES  ─
 *    NOT ───────────────────────────────────────────────────────────────────
 *
 * Same shape of question as the cadence tick: "who is about to miss a slot"
 * cannot be asked from inside a tenant scope, and one alert covering every
 * client is the whole point — fifteen emails a minute is the trained blindness
 * D-11 forbids. The queue accessor refuses to join `tenants` because its
 * consumer is a PAGE, and a page must not learn a client name from anywhere but
 * the operator's own JWT. This consumer is the tick: it holds the service-role
 * key by construction, it renders nothing, and the name it reads goes into an
 * email addressed to the operator alone.
 *
 * The returned surface is ids, names and integers. No body, no address, no
 * customer name, no quote — the closed vocabulary of `stalled-drafts.ts` is a
 * property of what this accessor can hand it.
 */
export async function forAllTenants_claimNewlyStalled(input: {
  /** The instant at or before which a slot counts as at risk. */
  boundary: Date;
  /** What to stamp — the tick's pinned clock, never `now()` in SQL. */
  at: Date;
}): Promise<StallClaim> {
  const claimed = await getDb()
    .update(cadenceTouches)
    .set({ stallAlertedAt: input.at, updatedAt: input.at })
    .where(
      and(
        inArray(cadenceTouches.status, [...APPROVAL_QUEUE_STATUSES]),
        lte(cadenceTouches.scheduledAt, input.boundary),
        isNull(cadenceTouches.stallAlertedAt),
      ),
    )
    .returning({ touchId: cadenceTouches.id, tenantId: cadenceTouches.tenantId });

  return {
    claimed,
    perTenant: await tallyByTenant(claimed.map((row) => row.tenantId)),
  };
}

/**
 * EVERYTHING STILL STALLED, grouped per client (the 06:30 digest).
 *
 * READ-ONLY, and deliberately NOT filtered on `stall_alerted_at`: every touch
 * here has already been alerted about individually, which is what makes it
 * STILL stalled rather than newly stalled. Filtering on "not yet alerted" would
 * mail an empty digest every morning while the queue grew — see
 * `buildDailyDigest`'s header for the same argument from the other end.
 *
 * Grouped in SQL. The result is bounded by the number of TENANTS (fifteen at
 * the plan's ceiling), not by the number of touches, so there is no cap to
 * apply and no sort-before-limit question to answer: an operator with 400
 * stalled drafts gets fifteen lines and one true total, which is the honest
 * shape for a roll-up.
 */
export async function forAllTenants_stalledTally(boundary: Date): Promise<StalledTenantTally[]> {
  const rows = await getDb()
    .select({
      tenantId: cadenceTouches.tenantId,
      tenantName: tenants.name,
      count: sql<number>`count(*)::int`,
    })
    .from(cadenceTouches)
    .innerJoin(tenants, eq(tenants.id, cadenceTouches.tenantId))
    .where(
      and(
        inArray(cadenceTouches.status, [...APPROVAL_QUEUE_STATUSES]),
        lte(cadenceTouches.scheduledAt, boundary),
      ),
    )
    .groupBy(cadenceTouches.tenantId, tenants.name)
    // Deterministic, so two renders of one morning's digest read the same.
    .orderBy(tenants.name);

  return rows;
}

/* ========================================================================= *
 * THE ATTESTATION-DRIFT CROSSING (06-04, ONB-04 / D-15)
 * ========================================================================= */

/** One client's newest attestation of one kind. Ids, a name, and an instant. */
export interface LatestTenantAttestation {
  tenantId: string;
  /** The client's own name, as the operator typed it at onboarding. */
  tenantName: string;
  attestedAt: Date;
}

/**
 * THE NEWEST ATTESTATION PER CLIENT — the nightly drift read (D-15 tier 2).
 *
 * ── READ-ONLY, AND IT WRITES NOTHING. THAT IS THE PROHIBITION, NOT A DETAIL ─
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING ON THE STALENESS PATH MAY PAUSE ANYTHING. This accessor is a     │
 * │ SELECT, the caller derives staleness from a pure function, and the       │
 * │ digest turns it into one sentence. There is no write anywhere on it.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Compare its sibling `forAllTenants_claimNewlyStalled`, which is a guarded
 * UPDATE: aging CLAIMS its alerts so it can promise "once per crossing", and
 * that promise needs a write. Drift promises nothing of the kind — a client
 * whose attestation is 34 days old is 34 days old again tomorrow, and saying so
 * every morning is the nag working, not an alert storm. So there is no
 * `alerted_at` here to claim, and adding one would be the first step toward a
 * pause nobody decided to build.
 *
 * ── STALENESS IS NOT COMPUTED IN SQL, DELIBERATELY ──────────────────────────
 *
 * A `WHERE attested_at < now() - interval '30 days'` here would be a SECOND
 * reading of `ATTESTATION_STALE_DAYS` — one in Postgres and one in
 * `isAttestationStale`, which is what the checklist card renders from. They
 * would agree until somebody changed the threshold and found one of them. This
 * returns every client's latest instant; the ONE derivation decides.
 *
 * ── AND IT JOINS `tenants`, WHERE THE QUEUE ACCESSOR REFUSES TO ─────────────
 *
 * Same split 06-02 drew for the aging pair: the queue feeds a PAGE and must
 * learn a client's name only from the operator's own JWT under RLS. This feeds
 * a cron route — service-role by construction, rendering nothing — and the name
 * it reads goes into an email addressed to the operator alone. The whole return
 * surface is an id, a name and a timestamp, which is what makes the digest
 * section's vocabulary closable at all.
 *
 * Bounded by the number of TENANTS (fifteen at the plan's ceiling), so there is
 * no cap to apply. `DISTINCT ON` is served by `tenant_attestations_latest_idx`,
 * whose `(tenant_id, kind, attested_at DESC)` shape is exactly this query.
 */
export async function forAllTenants_latestAttestations(
  kind: TenantAttestationKind,
): Promise<LatestTenantAttestation[]> {
  const rows = await getDb()
    .selectDistinctOn([tenantAttestations.tenantId], {
      tenantId: tenantAttestations.tenantId,
      tenantName: tenants.name,
      attestedAt: tenantAttestations.attestedAt,
    })
    .from(tenantAttestations)
    // INNER, so an attestation whose tenant row is gone drops out. That is the
    // opposite of `tallyByTenant`'s `Another client` fallback, and the
    // difference is what the row means: a stalled touch belongs to a client who
    // still has work waiting, whereas "go and re-verify a client who no longer
    // exists" is an instruction nobody can act on.
    .innerJoin(tenants, eq(tenants.id, tenantAttestations.tenantId))
    .where(eq(tenantAttestations.kind, kind))
    // The DISTINCT ON prefix FIRST — Postgres requires it, and the `attested_at
    // DESC` after it is what makes the surviving row the newest one.
    .orderBy(tenantAttestations.tenantId, desc(tenantAttestations.attestedAt));

  // Deterministic for the reader, not for Postgres: two renders of one
  // morning's digest must list the same clients in the same order, and the
  // DISTINCT ON above had to be ordered by tenant id instead.
  return rows.sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

/* ========================================================================= *
 * THE ESCALATION CROSSING (06-05, CON-03)
 * ========================================================================= */

/**
 * The most hot replies one escalation pass will look at.
 *
 * Small on purpose. A number this large is already a pathological minute (a
 * hot reply is a customer saying yes), and the pass sends a real SMS per row —
 * so the cap is what stops a backfill or a replay turning into a burst of
 * charged messages at a tradie's handset. Anything not taken this tick is taken
 * next tick, oldest first, because the scan is a SCAN and not a queue drain.
 */
export const HOT_ESCALATION_CAP = 25;

/** One hot reply that has never been escalated, with the facts the SMS needs. */
export interface HotUnescalatedReply {
  inboundMessageId: string;
  tenantId: string;
  cadenceId: string;
  /**
   * NULL when the reply is on a LEAD cadence (Phase 12, D-18): there is no
   * quote, so the LEFT join below finds no description either — the same
   * shape a quote missing from our mirror already has.
   */
  quoteId: string | null;
  /** What the customer actually said — the middle of the escalation message. */
  body: string;
  receivedAt: Date;
  /** The cadence SNAPSHOT name and mobile, never a live mirror lookup. */
  contactName: string | null;
  contactMobile: string | null;
  /** `null` when the quote has vanished from our mirror (`mirror_missing`). */
  quoteDescription: string | null;
  /**
   * Phase 13 (D-05): the classifier's urgency on a LEAD reply; `null` on every
   * quote reply and on a lead reply not yet classified.
   */
  urgency: string | null;
  /**
   * Phase 13 (D-06): the door's deterministic emergency-keyword hit. A row can
   * be here on this alone, before any model has run.
   */
  keywordHot: boolean;
  /** Phase 13: the lead of a LEAD cadence; `null` on a quote cadence. */
  leadId: string | null;
}

/**
 * EVERY HOT REPLY NOT YET ESCALATED, OLDEST FIRST (06-05, CON-03).
 *
 * ── WHY THIS CROSSING EXISTS ───────────────────────────────────────────────
 *
 * The ELEVENTH named crossing, and it owes the biggest justification after the
 * approval queue because it returns the widest surface in this file: a
 * customer's words AND a customer's mobile number, across tenants.
 *
 * The question is the cadence tick's own — "who needs telling right now" — and
 * it cannot be asked from inside a tenant scope for the reason the whole
 * inbound family lives outside one: a reply arrives carrying a phone number and
 * no client, and `inbound_messages.tenant_id` is only filled in when threading
 * succeeded. There is no scope to ask from.
 *
 * ── AND WHY IT MAY CARRY AN ADDRESS WHEN THE QUEUE ACCESSOR MAY NOT ────────
 *
 * `forAllTenants_approvalQueue` refuses every address column because a card is
 * approved by reading the MESSAGE, and the address is never needed to decide.
 * Here the customer's mobile IS THE DELIVERABLE: D-07's message ends with
 * `Call them: {mobile}` and the whole product moment is the tradie tapping it.
 * An accessor that withheld it would only mean the pass fetched it from
 * somewhere else a line later.
 *
 * What bounds it instead:
 *
 *   * The predicate is CLOSED and narrow — `(is_hot OR keyword_hot)` AND
 *     `attribution = 'threaded'` AND no `escalations` row. It cannot be widened
 *     into "recent replies" without editing this function.
 *   * The select list is PINNED, and `raw_payload`, `from_address`, `label`,
 *     `classify_attempts` and every delivery column are absent from it.
 *   * NO JOIN TO `tenants`. The pass reads the client's own escalation number
 *     through `forTenant(row.tenantId)`, which is the house rule: the moment a
 *     tenant is known, go back through the scope. That also keeps this
 *     accessor's whole return surface facts about ONE customer's reply.
 *   * Every write it leads to goes through the keyed `escalations` family,
 *     never through here.
 *
 * ── IT READS THE STORED `is_hot`, AND NEVER RE-DERIVES IT ──────────────────
 *
 * `isHotLead` stays private to `classify-inbound.ts` (D-14/D-15). The column is
 * stored precisely so the product rule can change without rewriting history,
 * and a second implementation of "is this hot" living in an accessor is how the
 * escalation pass and the triage queue come to disagree about the same row.
 *
 * 2026-10 (Phase 13, plan 13-03): the predicate is `(is_hot OR keyword_hot)`.
 * That is still not a re-derivation. `keyword_hot` is the DOOR's own column
 * (D-06), written by the deterministic emergency-keyword matcher when the
 * reply arrives, before any model runs — so a "burst pipe" on a lead reaches
 * the tradie without waiting for classification, and classification (the
 * single writer of `is_hot`) can never overwrite it with a cold verdict. This
 * OR is the ONE place the two meet. `urgency`, `keywordHot` and the cadence's
 * `leadId` join the select list so the pass can word a lead alert and decide
 * a hold; no address or body column was added.
 *
 * ── THE LEFT ANTI-JOIN IS THE SCAN, AND THE SCAN IS THE SELF-HEALING ───────
 *
 * The pass could have been handed the rows the classification pass just marked
 * hot. It is not, deliberately (Pitfall 7): a tick that crashed between
 * classifying and escalating, or a deploy in the gap, would otherwise leave that
 * lead unescalated forever with nothing to notice it. Asking "hot and not yet
 * escalated" every minute means a missed tick costs a minute, not a customer.
 *
 * `threaded` only: an `ambiguous` or `unmatched` reply has no cadence, no quote
 * and possibly no client, so there is nobody to text and nothing to say. Those
 * rows are the inbox's job, and they are already at the top of it.
 */
export async function forAllTenants_hotUnescalated(
  limit: number = HOT_ESCALATION_CAP,
): Promise<HotUnescalatedReply[]> {
  const db = getDb();

  return db
    .select({
      inboundMessageId: inboundMessages.id,
      tenantId: cadences.tenantId,
      cadenceId: cadences.id,
      quoteId: cadences.quoteId,
      body: inboundMessages.body,
      receivedAt: inboundMessages.receivedAt,
      contactName: cadences.contactName,
      contactMobile: cadences.contactMobile,
      quoteDescription: quotes.jobDescription,
      urgency: inboundMessages.urgency,
      keywordHot: inboundMessages.keywordHot,
      leadId: cadences.leadId,
    })
    .from(inboundMessages)
    // INNER: a threaded row always has a cadence, and a hot reply we cannot
    // place against one has no quote to name and no tradie to attribute to.
    .innerJoin(cadences, eq(cadences.id, inboundMessages.cadenceId))
    // LEFT, for the queue accessor's reason: a quote can vanish from our own
    // mirror while its conversation is live, and the tradie still needs to know
    // their customer replied.
    .leftJoin(quotes, eq(quotes.id, cadences.quoteId))
    // THE ANTI-JOIN IS THE "not yet escalated" HALF OF THE PREDICATE. The unique
    // index is still what makes never-twice TRUE (this read races nothing); this
    // is what stops the pass re-reading rows it has already finished with.
    .leftJoin(escalations, eq(escalations.inboundMessageId, inboundMessages.id))
    .where(
      and(
        // THE ONE PLACE THE TWO HOT COLUMNS MEET (Phase 13, D-06): the
        // classifier's `is_hot` OR the door's `keyword_hot`. Neither is
        // re-derived here. No bound value, so a template is safe.
        sql`(${inboundMessages.isHot} OR ${inboundMessages.keywordHot})`,
        eq(inboundMessages.attribution, 'threaded'),
        isNull(escalations.id),
      ),
    )
    // OLDEST FIRST, so a backlog drains in the order the customers wrote — and
    // with the id tie-break every other ordered read in this file uses.
    .orderBy(inboundMessages.receivedAt, inboundMessages.id)
    .limit(limit);
}

/* ========================================================================= *
 * THE REPORTS-OVERVIEW CROSSING (07-05, RPT-03 / D-14..D-18)
 * ========================================================================= */

/**
 * EVERY CLIENT'S WINDOW COUNTS — the `/reports` overview and the digest line.
 *
 * ── COUNTS IN, DERIVATION ELSEWHERE ────────────────────────────────────────
 *
 * This returns `TenantMetricCounts`, which is declared in
 * `src/core/reporting/metrics.ts` beside the pure functions that consume it —
 * so this SQL and the per-tenant SQL in `for-tenant.ts` are typed against ONE
 * contract, and every rate on both screens is computed by ONE
 * `computeTenantMetrics`. Not a single division happens in this function. Two
 * screens showing a client a different opt-out rate is not a display bug; it is
 * the moment the operator stops believing either of them.
 *
 * ── ELEVEN STATEMENTS, JOINED IN MEMORY BY `tenant_id` ─────────────────────
 *
 * ELEVEN, counting the `tenantRows` read alongside the ten numbered groupings
 * below — which is how the comment blocks in the body number them, `(1)`
 * through `(11)`, and what `stalled-digest.ts` states when it reasons about the
 * pool ceiling. (Nine until 2026-10: Phase 15, plan 15-03, added `(10)` the
 * window's diverted calls and `(11)` who has an active divert number — both
 * issued through the lead family's helpers, so this file's pinned table set
 * does not grow.) The count matters precisely because that ceiling (`max: 5` in
 * `src/db/repository/client.ts`) is a real deadlock, so a reader arriving here
 * to work out what this function costs must not be handed the wrong number.
 *
 * Deliberately not one query. These are independent groupings over eleven tables
 * with five different time columns; fusing them means outer-joining ten
 * aggregates and getting a fan-out wrong in a way that inflates a count
 * silently. Each is bounded by the number of TENANTS (fifteen at the plan's
 * ceiling) except the fee read, which is bounded by the fee schedule.
 *
 * WHAT IS PINNED IS THE EXPORT COUNT, not the statement count: the tripwire in
 * `tests/sync-upsert.test.ts` counts `forAllTenants_*` names, because a name is
 * what a caller can reach. Adding a ninth grouping inside this body changes
 * nothing about what escapes the tenant scope.
 *
 * ── AND THEY RUN ONE AT A TIME, WHICH IS NOT A STYLE CHOICE ────────────────
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NEVER `Promise.all` MORE STATEMENTS THAN `getDb()` HAS CONNECTIONS.      │
 * │ Eight concurrent reads against a five-connection pool DEADLOCK against   │
 * │ Supabase's transaction pooler: postgres.js pipelines the overflow onto   │
 * │ connections PgBouncer has already handed to another transaction, and     │
 * │ the extra queries never come back. Measured, not theorised — the first   │
 * │ burst succeeds and every later one hangs until the statement timeout.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Sequential costs eleven round trips to Sydney (~1s) on a screen an operator
 * opens a few times a day, and it is safe under ANY other load in the same
 * process — which a batch of five would not be, because the pool is shared with
 * every other request this instance is serving.
 *
 * ── THE WINDOW IS CLOSED AT BOTH ENDS ──────────────────────────────────────
 *
 * `>= start AND <= end`, matching `inRolling` (period.ts) and NOT the half-open
 * `[start, end)` the calendar-month reads use. A rolling window's end is "now",
 * and an event happening this instant is inside the last 30 days by any reading.
 * The same at-the-boundary-is-inside convention applies at the start: a
 * suppression timestamped exactly at the window start is in the window.
 *
 * ── EVERY AGGREGATE IS CAST, AND CONVERTED ONCE ────────────────────────────
 *
 * `COUNT()` is a bigint and postgres.js hands bigints back as STRINGS: without
 * `::int` this returns '7' and every arithmetic use of it silently
 * concatenates (`countQuotesChasedInPeriod`'s rule, one file over). The two
 * values that CANNOT be an int — the numeric edit-distance sum and the cents
 * total — stay strings until the ONE `Number()` that reads them.
 *
 * ── AND NO COLUMN OF ANOTHER TABLE GOES INSIDE A RAW `sql` FRAGMENT ────────
 *
 * Drizzle renders EVERY column in a `sql` template UNQUALIFIED when the query
 * has a single table, so a correlated `WHERE im.cadence_id = sl.cadence_id`
 * written that way compiles to `WHERE cadence_id = cadence_id` — true for every
 * row, and green in any test that only checks the number is not zero. The
 * correlated reads below are therefore JOINS, whose ON clauses the builder
 * qualifies. (Also measured. It was a real bug in this function's first draft.)
 */
export async function forAllTenants_reportMetrics(
  window: Period,
): Promise<TenantMetricCounts[]> {
  const db = getDb();

  // ── THE D-02 QUALIFYING-SEND PREDICATE, IN THE WINDOW ────────────────────
  //
  // `qualifiesAsTouch` written in SQL (src/core/attribution/qualify.ts), and
  // the third clause is `IS DISTINCT FROM`, never `<>`: the plain inequality is
  // NULL — and therefore false — for every email touch and every SMS whose
  // receipt has not arrived, which is most of the qualifying rows in the table.
  //
  // QUOTE FOLLOW-UPS ONLY (12-REVIEW WR-03). Since Phase 12 the ledger also
  // carries the missed-call text-back on a LEAD cadence (`quote_id` NULL,
  // `lead_id` set), which satisfies every other clause. This report is the
  // client's proof of what the quote engine did; a text-back is not a quote
  // follow-up and reports separately (Phase 15). The quote route's touch 0 (the
  // "about your quote" text) carries a `quote_id` and stays counted, per 12-05.
  // Applied to all three reads below, so the replied and opted-out numerators
  // stay subsets of the touched denominators. The twin in
  // `forTenant().metrics.windowCounts` carries the same clause.
  const sentInWindow = and(
    isNotNull(sendLedger.quoteId),
    ne(sendLedger.sender, 'stub'),
    eq(sendLedger.outcome, 'sent'),
    sql`${sendLedger.deliveryStatus} IS DISTINCT FROM 'undelivered'`,
    gte(sendLedger.claimedAt, window.start),
    lte(sendLedger.claimedAt, window.end),
  );

  // ── THE D-18 ONBOARDING EXCLUSION, AS TWO GROUPED SUBQUERIES ─────────────
  //
  // `onboardedAt()` (metrics.ts) is "the later of first-templates-approved and
  // first-attested, or NULL when either is missing" — the instant a cadence
  // could first send. Quotes opened before it were born paused for onboarding,
  // and counting them against the first-touch rate blames the service for not
  // sending messages it was forbidden to send.
  //
  // `WHERE approved_at IS NOT NULL` rather than a HAVING: a client with
  // templates that were never approved must produce NO ROW here, so the INNER
  // JOIN below drops them entirely. That is the NULL arm of `onboardedAt()`
  // expressed structurally — every quote excluded, rather than defaulted in.
  const firstApproved = db
    .select({
      tenantId: messageTemplates.tenantId,
      at: sql<Date>`min(${messageTemplates.approvedAt})`.as('first_approved_at'),
    })
    .from(messageTemplates)
    .where(isNotNull(messageTemplates.approvedAt))
    .groupBy(messageTemplates.tenantId)
    .as('first_approved');

  const firstAttested = db
    .select({
      tenantId: tenantAttestations.tenantId,
      at: sql<Date>`min(${tenantAttestations.attestedAt})`.as('first_attested_at'),
    })
    .from(tenantAttestations)
    .where(eq(tenantAttestations.kind, SM8_AUTOMATION_ATTESTATION_KIND))
    .groupBy(tenantAttestations.tenantId)
    .as('first_attested');

  // (1) EVERY CLIENT, including the ones with no activity at all. The overview
  // must render a row for a client whose every metric is `—`; driving the list
  // off any of the count statements below would silently hide exactly the
  // client nobody has sent anything for.
  const tenantRows = await db
    .select({ tenantId: tenants.id, tenantName: tenants.name, timezone: tenants.timezone })
    .from(tenants)
    .orderBy(tenants.name, tenants.id);

  // (2) FIRST TOUCH WITHIN 24h (D-18). The denominator is `quote_opened`
  // EVENTS, not cadence rows — one cadence per opened event
  // (`cadences_one_per_opened_event`), so the two counts are the same
  // population and this accessor needs no `cadences` column at all.
  //
  // `detected_at >= first_approved AND detected_at >= first_attested` IS
  // `detected_at >= GREATEST(both)` — the same instant `onboardedAt()` returns,
  // written as the two comparisons Postgres can serve from the joins.
  //
  // COUNT DISTINCT ON THE EVENT ID, not `count(*)`: a reopened quote gets a
  // SECOND cadence and therefore a second touch 1, and the LEFT JOIN below
  // would otherwise count one opened quote twice.
  const openedRows = await db
    .select({
      tenantId: quoteStatusEvents.tenantId,
      quotesOpened: sql<number>`count(DISTINCT ${quoteStatusEvents.id})::int`,
      quotesFirstTouch24h: sql<number>`count(DISTINCT ${quoteStatusEvents.id}) FILTER (WHERE ${sendLedger.id} IS NOT NULL)::int`,
    })
    .from(quoteStatusEvents)
    .innerJoin(firstApproved, eq(firstApproved.tenantId, quoteStatusEvents.tenantId))
    .innerJoin(firstAttested, eq(firstAttested.tenantId, quoteStatusEvents.tenantId))
    // LEFT, and the whole first-touch rate is in this ON clause: the join
    // matches only a touch 1 that QUALIFIED (D-02) and landed inside the
    // service level, so a matched row is a quote first-touched in time and a
    // NULL is one that was not. An INNER join would silently delete the slow
    // quotes from the denominator — turning the metric into "of the quotes we
    // answered fast, how many did we answer fast".
    //
    // Claimed BEFORE the quote was detected does not count either (a clock
    // problem or a replay is not a fast follow-up), which is the
    // `>= detected_at` half — `withinFirstTouchWindow` makes the same refusal
    // in TypeScript.
    .leftJoin(
      sendLedger,
      and(
        eq(sendLedger.tenantId, quoteStatusEvents.tenantId),
        eq(sendLedger.quoteId, quoteStatusEvents.quoteId),
        eq(sendLedger.touchNumber, 1),
        ne(sendLedger.sender, 'stub'),
        eq(sendLedger.outcome, 'sent'),
        sql`${sendLedger.deliveryStatus} IS DISTINCT FROM 'undelivered'`,
        sql`${sendLedger.claimedAt} >= ${quoteStatusEvents.detectedAt}`,
        sql`${sendLedger.claimedAt} <= ${quoteStatusEvents.detectedAt} + make_interval(hours => ${FIRST_TOUCH_HOURS})`,
      ),
    )
    .where(
      and(
        eq(quoteStatusEvents.eventType, 'quote_opened'),
        gte(quoteStatusEvents.detectedAt, window.start),
        lte(quoteStatusEvents.detectedAt, window.end),
        gte(quoteStatusEvents.detectedAt, firstApproved.at),
        gte(quoteStatusEvents.detectedAt, firstAttested.at),
      ),
    )
    .groupBy(quoteStatusEvents.tenantId);

  // (3) WHAT WE SENT, from the one table that knows. `count(DISTINCT
  // cadence_id)` because a quote chased with five touches is ONE conversation,
  // and counting rows would scale the denominator by the cadence length.
  const ledgerRows = await db
    .select({
      tenantId: sendLedger.tenantId,
      cadencesTouched: sql<number>`count(DISTINCT ${sendLedger.cadenceId})::int`,
      // THE ADDRESS IS COUNTED, NOT SELECTED. `count(DISTINCT (channel,
      // address))` returns an integer; the string never leaves Postgres. The
      // PAIR rather than the address alone, because the same person's mobile
      // and email are two contacts we can be asked to stop.
      contactsTouched: sql<number>`count(DISTINCT (${sendLedger.channel}, ${sendLedger.toAddress}))::int`,
    })
    .from(sendLedger)
    .where(sentInWindow)
    .groupBy(sendLedger.tenantId);

  // (4) WHO REPLIED. The numerator is a SUBSET of `cadencesTouched` by
  // construction: the ledger predicate is the same one, so a cadence that
  // replied but was never messaged in the window cannot appear here.
  const repliedRows = await db
    .select({
      tenantId: inboundMessages.tenantId,
      cadencesReplied: sql<number>`count(DISTINCT ${inboundMessages.cadenceId})::int`,
    })
    .from(inboundMessages)
    .innerJoin(
      sendLedger,
      and(
        eq(sendLedger.tenantId, inboundMessages.tenantId),
        eq(sendLedger.cadenceId, inboundMessages.cadenceId),
      ),
    )
    .where(
      and(
        // `threaded` only: an `ambiguous` row's cadence is a guess, and a guess
        // must not move a metric the operator rings a client about.
        eq(inboundMessages.attribution, 'threaded'),
        gte(inboundMessages.receivedAt, window.start),
        lte(inboundMessages.receivedAt, window.end),
        sentInWindow,
      ),
    )
    .groupBy(inboundMessages.tenantId);

  // (5) OPT-OUTS, RESTRICTED TO CONTACTS WE MESSAGED (A6). The join IS the
  // restriction. Without it this would count the Phase 4 D-03 STOP fan-out —
  // which writes a bare STOP into EVERY tenant's suppression list — and push
  // every client past the alarm threshold in the same minute because one
  // stranger texted the shared number. The numerator has to be a subset of the
  // denominator or the rate is not a rate.
  //
  // `count(DISTINCT (channel, address))` also absorbs the join's fan-out: a
  // contact messaged five times is one opt-out, not five.
  const optOutRows = await db
    .select({
      tenantId: suppressedContacts.tenantId,
      contactsOptedOut: sql<number>`count(DISTINCT (${suppressedContacts.channel}, ${suppressedContacts.address}))::int`,
    })
    .from(suppressedContacts)
    .innerJoin(
      sendLedger,
      and(
        eq(sendLedger.tenantId, suppressedContacts.tenantId),
        eq(sendLedger.channel, suppressedContacts.channel),
        // COMPARED, NEVER SELECTED — the one place an address is named.
        eq(sendLedger.toAddress, suppressedContacts.address),
      ),
    )
    .where(
      and(
        gte(suppressedContacts.createdAt, window.start),
        lte(suppressedContacts.createdAt, window.end),
        sentInWindow,
      ),
    )
    .groupBy(suppressedContacts.tenantId);

  // (6) THE HUMAN-EDIT LOAD (D-17). Denominator is drafts APPROVED in the
  // window — a draft the operator never got to says nothing about how much
  // rewriting the model costs them. `edit_distance > 0` is NULL-safe by
  // construction: a NULL distance is not `> 0`, so it counts as unedited rather
  // than as a broken row.
  const draftRows = await db
    .select({
      tenantId: touchDrafts.tenantId,
      draftsApproved: sql<number>`count(*)::int`,
      draftsEdited: sql<number>`count(*) FILTER (WHERE ${touchDrafts.editDistance} > 0)::int`,
      // NUMERIC, and it stays a string: `meanEditDistanceBp` does the one
      // `Number()`. A `::float8` here would be a second conversion.
      editDistanceSum: sql<string>`COALESCE(sum(${touchDrafts.editDistance}), 0)::numeric`,
    })
    .from(touchDrafts)
    .where(
      and(
        eq(touchDrafts.status, 'approved'),
        gte(touchDrafts.approvedAt, window.start),
        lte(touchDrafts.approvedAt, window.end),
      ),
    )
    .groupBy(touchDrafts.tenantId);

  // (7) WHAT WE RECOVERED, bucketed by the moment the win was DETECTED — the
  // same column `attributions.listForPeriod` buckets a monthly report by, so a
  // rolling figure and a frozen one describe the same events.
  const moneyRows = await db
    .select({
      tenantId: quoteAttributions.tenantId,
      conservativeCents: sql<string>`COALESCE(sum(${quoteAttributions.conservativeCents}), 0)::bigint`,
    })
    .from(quoteAttributions)
    .where(
      and(
        gte(quoteAttributions.wonDetectedAt, window.start),
        lte(quoteAttributions.wonDetectedAt, window.end),
      ),
    )
    .groupBy(quoteAttributions.tenantId);

  // (8) HOW FAST A HOT LEAD REACHED THE TRADIE. Whole minutes, aggregated as
  // integers so the MEDIAN is taken over the same values the page prints —
  // `escalationSpeed` sorts and picks; no averaging happens here.
  // `outcome = 'sent'` only: an escalation that failed to send has no latency,
  // and counting it as zero would flatter the one metric that says whether the
  // product moment actually happened.
  const latencyRows = await db
    .select({
      tenantId: escalations.tenantId,
      minutes: sql<
        number[]
      >`array_agg(round(EXTRACT(EPOCH FROM (${escalations.sentAt} - ${inboundMessages.receivedAt})) / 60)::int ORDER BY ${escalations.sentAt})`,
    })
    .from(escalations)
    .innerJoin(inboundMessages, eq(inboundMessages.id, escalations.inboundMessageId))
    .where(
      and(
        eq(escalations.outcome, 'sent'),
        gte(escalations.sentAt, window.start),
        lte(escalations.sentAt, window.end),
      ),
    )
    .groupBy(escalations.tenantId);

  // (9) THE FEE SCHEDULE, WHOLE AND UNFILTERED. `feesInForce` pro-rates by
  // LOCAL DAY and needs every row to answer "which fee was in force on the
  // 3rd" — a row whose `effective_from` predates the window is usually the one
  // being charged. Ordered so the D-13 latest-inserted-wins tie-break sees the
  // same order `fees.list()` gives the report generator.
  const feeRows = await db
    .select({
      tenantId: tenantFees.tenantId,
      kind: tenantFees.kind,
      amountCents: tenantFees.amountCents,
      effectiveFrom: tenantFees.effectiveFrom,
      createdAt: tenantFees.createdAt,
    })
    .from(tenantFees)
    .orderBy(tenantFees.tenantId, tenantFees.effectiveFrom, tenantFees.createdAt);

  // (10) THE WINDOW'S DIVERTED CALLS and (11) WHO IS DIVERTING AT ALL
  // (2026-10, Phase 15, 15-03; RPT-04) — the overview's calls column.
  //
  // ISSUED THROUGH THE LEAD FAMILY (`./leads`), NOT WRITTEN HERE: this file's
  // schema import set is pinned table by table in `tests/sync-upsert.test.ts`
  // (every table in it is one a query can read without a tenant scope, each
  // for one recorded reason), and `tenant_divert_numbers` is recorded there as
  // reached by exactly two accessors. Two counts-only groupings belong in the
  // family file beside `countLeadResolutionsSince`, by the same rule that put
  // that read there: tenant ids and integers leave, no caller column and no
  // number is selected, and nothing is written. Still one statement each, run
  // in sequence like every statement above.
  const callRows = await countMissedCallsInWindow(window);
  const divertTenantIds = await listTenantIdsWithActiveDivert();

  // ── ZEROS, NOT ABSENCES ──────────────────────────────────────────────────
  //
  // Every tenant starts at zero counts and an empty fee list, and each grouped
  // statement fills in what it found. A client with no activity is therefore a
  // row of zeros — which `computeTenantMetrics` turns into `null` rates and the
  // page renders as `—`. Dropping them instead would make the overview quietly
  // shorter than the client list, which is the one thing a
  // which-client-is-drifting screen must never be.
  const byTenant = new Map<string, TenantMetricCounts>(
    tenantRows.map((row) => [
      row.tenantId,
      {
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        timezone: row.timezone,
        quotesOpened: 0,
        quotesFirstTouch24h: 0,
        cadencesTouched: 0,
        cadencesReplied: 0,
        contactsTouched: 0,
        contactsOptedOut: 0,
        draftsApproved: 0,
        draftsEdited: 0,
        editDistanceSum: '0',
        conservativeCents: 0,
        escalationLatencyMinutes: [],
        fees: [],
        missedCalls: 0,
        missedCallsAfterHours: 0,
        hasDivertNumber: false,
      },
    ]),
  );

  for (const row of openedRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.quotesOpened = row.quotesOpened;
    counts.quotesFirstTouch24h = row.quotesFirstTouch24h;
  }

  for (const row of ledgerRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.cadencesTouched = row.cadencesTouched;
    counts.contactsTouched = row.contactsTouched;
  }

  for (const row of repliedRows) {
    // `inbound_messages.tenant_id` is NULLABLE — a reply we could not place is
    // still recorded. The join above cannot match one, but the type says it
    // could, and a `null` key would silently become a map entry nobody reads.
    const counts = row.tenantId === null ? undefined : byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.cadencesReplied = row.cadencesReplied;
  }

  for (const row of optOutRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.contactsOptedOut = row.contactsOptedOut;
  }

  for (const row of draftRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.draftsApproved = row.draftsApproved;
    counts.draftsEdited = row.draftsEdited;
    counts.editDistanceSum = row.editDistanceSum;
  }

  for (const row of moneyRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    // THE ONE `Number()` on the cents total. `::bigint` arrives as a string.
    counts.conservativeCents = Number(row.conservativeCents);
  }

  for (const row of latencyRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.escalationLatencyMinutes = row.minutes;
  }

  for (const row of feeRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.fees.push({
      kind: row.kind as FeeRow['kind'],
      amountCents: row.amountCents,
      effectiveFrom: row.effectiveFrom,
      createdAt: row.createdAt,
    });
  }

  for (const row of callRows) {
    const counts = byTenant.get(row.tenantId);
    if (!counts) continue;
    counts.missedCalls = row.missedCalls;
    counts.missedCallsAfterHours = row.missedCallsAfterHours;
  }

  for (const tenantId of divertTenantIds) {
    const counts = byTenant.get(tenantId);
    if (!counts) continue;
    counts.hasDivertNumber = true;
  }

  // Client-name order, so a caller that renders without sorting still gets a
  // stable list. `sortForOverview` re-orders alarmed-first on the page; the
  // digest reads the same rows and sorts them its own way.
  return tenantRows.map((row) => byTenant.get(row.tenantId)!);
}

/* ========================================================================= *
 * THE SHARED SMS ROW'S BLAST RADIUS (10-03, ARM-02, D-03)
 * ========================================================================= */

/** One client the shared sms row governs. An id and a name, and nothing else. */
export interface SmsGlobalArmedClient {
  id: string;
  name: string;
}

/**
 * WHICH CLIENTS DOES ARMING THE SHARED ROW ACTUALLY ARM? (10-03, D-03, T-10-12)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OPERATOR MUST NOT BE ABLE TO ARM N CLIENTS WITHOUT KNOWING WHICH N.  │
 * │ This is the list the two-step warning states between the taps, and the   │
 * │ success sentence repeats afterwards.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THIS CROSSING EXISTS ───────────────────────────────────────────────
 *
 * The FOURTEENTH named crossing, and the first one whose consumer is a WARNING
 * rather than a job. D-03 has SMS v1 arming the SHARED row — `tenant_id NULL`,
 * one ClickSend number for every founding client — so one tap starts real
 * messages to real customers for a SET of clients, and the page that offers the
 * tap shows exactly one client's name. "Arms SMS for every connected client" is
 * a true sentence an operator can read as "arms this plumber". Naming them is
 * what makes the claim checkable, and a set that spans tenants cannot be
 * assembled from inside a tenant scope.
 *
 * ── THE PREDICATE IS ABSENCE OF AN OWN ROW, NOT `enabled` ───────────────────
 *
 * `getChannelConfig` reads override-then-default: a tenant with its own sms row
 * is governed by THAT row, on or off, and the shared row never reaches them. So
 * the set the shared row governs is "connected, and has no sms row of its own" —
 * which is why the Phase 4 test tenant appears here until somebody writes it an
 * explicit OFF override, and why filtering on `enabled` would quietly drop a
 * client the tap is about to start messaging for.
 *
 * `paused_at IS NULL` is the "connected" half: a paused connection is not
 * syncing quotes, so no cadence of theirs reaches a send.
 *
 * ── WHAT CONTAINS IT ───────────────────────────────────────────────────────
 *
 *   1. IDS AND NAMES ONLY. No connection metadata, no key last-4, no config
 *      column — the consumer is one sentence whose vocabulary is closed.
 *   2. BOTH CONSUMERS ARE BEHIND THE OPERATOR GATE: the client page (rendered
 *      only by `requireOperator`-gated code) and `armChannelAction` (which calls
 *      `requireOperatorId` before it reads a byte of the body).
 *   3. IT JOINS `tenants` FOR A NAME, on the 06-02 split — the name IS the
 *      product of this read, and its reader holds the service-role key by
 *      construction.
 *
 * Bounded by the number of TENANTS (fifteen at the plan's ceiling), so there is
 * no cap to apply. Ordered by name so two renders of one page list them the
 * same way.
 */
export async function forAllTenants_armedBySmsGlobal(): Promise<SmsGlobalArmedClient[]> {
  const db = getDb();

  return db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    // INNER: no connection, no sync, no sends — "connected" is the first half
    // of what the shared row's tap actually starts.
    .innerJoin(sm8Connections, eq(sm8Connections.tenantId, tenants.id))
    .where(
      and(
        isNull(sm8Connections.pausedAt),
        // Built with the query builder rather than a `sql` template so the
        // channel vocabulary routes through the COLUMN's own mapper.
        notExists(
          db
            .select({ one: sql`1` })
            .from(messagingConfig)
            .where(
              and(
                eq(messagingConfig.channel, 'sms'),
                eq(messagingConfig.tenantId, tenants.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(tenants.name);
}

/**
 * Everything the voice webhook needs to answer a diverted call and record it,
 * from ONE read (D-03, rule R3: the greeting never waits on a second round trip).
 */
export interface DivertNumberOwner {
  tenantId: string;
  divertNumberId: string;
  /** What the greeting says after "you've reached". */
  spokenName: string;
  /** The four contact-window columns, for the after-hours flag (D-07). */
  timezone: string;
  contactHoursStart: string;
  contactHoursEnd: string;
  contactDays: number[];
}

/** One ACTIVE divert number and its owner — the reconcile's map entry. */
export interface ActiveDivertNumber extends DivertNumberOwner {
  numberE164: string;
}

/**
 * Whose Backdesk number is this `To`? (11-01, CAP-03, D-02.)
 *
 * ── THE CALLED NUMBER IS THE ONLY KEY ───────────────────────────────────────
 *
 * The voice webhook passes Twilio's `To` and nothing else. `ForwardedFrom` — the
 * client's own line, when a carrier bothers to send it — is carrier-dependent
 * and absent on some diverts entirely, so it is evidence on the `missed_calls`
 * row and NEVER a lookup key here, not even as a fallback: a fallback that
 * fires "only when `To` is unknown" is a second tenant-resolution rule that
 * nobody tests until it attributes one client's caller to another.
 *
 * `status = 'active'` only: a `pending` or `failed` row owns no number yet, and
 * `number_e164` is UNIQUE, so `LIMIT 1` is deterministic without an ORDER BY.
 *
 * ── IT JOINS `tenants`, ON THE 06-02 SPLIT ──────────────────────────────────
 *
 * The contact window lives on `tenants` (`timezone`, `contact_hours_*`,
 * `contact_days`), and the after-hours flag must be computed at arrival from
 * the window IN FORCE AT ARRIVAL (D-07) — so the join is the price of answering
 * a live call from one query. Acceptable for the `forAllTenants_stalledTally`
 * reason: its only consumer is a service-role webhook that renders nothing;
 * what it returns reaches a TwiML `<Say>` (the spoken name, which the caller
 * already dialled) and a boolean on a row, never a page or a log.
 */
export async function forAllTenants_divertNumberByE164(
  calledNumber: string,
): Promise<DivertNumberOwner | undefined> {
  const [row] = await getDb()
    .select({
      tenantId: tenantDivertNumbers.tenantId,
      divertNumberId: tenantDivertNumbers.id,
      spokenName: tenantDivertNumbers.spokenName,
      timezone: tenants.timezone,
      contactHoursStart: tenants.contactHoursStart,
      contactHoursEnd: tenants.contactHoursEnd,
      contactDays: tenants.contactDays,
    })
    .from(tenantDivertNumbers)
    .innerJoin(tenants, eq(tenants.id, tenantDivertNumbers.tenantId))
    .where(
      and(
        eq(tenantDivertNumbers.numberE164, calledNumber),
        eq(tenantDivertNumbers.status, 'active'),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Every ACTIVE divert number and its owner — the nightly call-log reconcile's
 * owner map (plan 11-02).
 *
 * One read of at most one row per client (the `tenant_id` UNIQUE), so it is
 * bounded by the number of TENANTS and needs no cap. The reconcile lists
 * Twilio's call log ONCE, account-wide, and keeps only inbound calls whose `To`
 * is in this map — the `forAllTenants_ledgerOwners` posture of one provider
 * read mapped onto our rows. An EMPTY result is the reconcile's total guard:
 * no active number, no Twilio call at all.
 *
 * Same shape as `forAllTenants_divertNumberByE164` plus the number itself, for
 * the same join argument; ordered by the number so two runs walk the map the
 * same way. WRITES NOTHING.
 */
export async function forAllTenants_activeDivertNumbers(): Promise<ActiveDivertNumber[]> {
  const rows = await getDb()
    .select({
      tenantId: tenantDivertNumbers.tenantId,
      divertNumberId: tenantDivertNumbers.id,
      numberE164: tenantDivertNumbers.numberE164,
      spokenName: tenantDivertNumbers.spokenName,
      timezone: tenants.timezone,
      contactHoursStart: tenants.contactHoursStart,
      contactHoursEnd: tenants.contactHoursEnd,
      contactDays: tenants.contactDays,
    })
    .from(tenantDivertNumbers)
    .innerJoin(tenants, eq(tenants.id, tenantDivertNumbers.tenantId))
    .where(
      and(
        eq(tenantDivertNumbers.status, 'active'),
        isNotNull(tenantDivertNumbers.numberE164),
      ),
    )
    .orderBy(tenantDivertNumbers.numberE164);

  // `number_e164` is nullable at the column (NULL while `pending`); the
  // predicate above excludes those rows, and this narrows the type to match.
  return rows.flatMap((row) =>
    row.numberE164 === null ? [] : [{ ...row, numberE164: row.numberE164 }],
  );
}
