/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PHASE 3 CONSUMPTION CONTRACT. Read this before writing a consumer.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `quote_status_events` is a TRANSACTIONAL OUTBOX (SYNC-02, RESEARCH Pattern 3).
 * Every row is written in the SAME transaction as the quote upsert that caused
 * it. There is no second write, no queue publish, and therefore no window in
 * which a quote can be won in our mirror while the event announcing it is lost —
 * the two either commit together or neither happened.
 *
 * HOW TO CONSUME (Phase 3 cadence engine, Phase 7 reporting):
 *
 *   1. Read your cursor:  SELECT last_event_id FROM event_consumer_cursors
 *                         WHERE consumer = 'cadence-engine'
 *      Register yourself by inserting a row with last_event_id = 0. No row is
 *      seeded here — a consumer that does not exist yet must not silently
 *      appear to be up to date.
 *   2. Scan forward:      SELECT * FROM quote_status_events
 *                         WHERE id > $cursor ORDER BY id
 *   3. Act, then advance the cursor IN THE SAME TRANSACTION as whatever you did
 *      with the events. Advancing separately is how a consumer skips work after
 *      a crash.
 *
 * ORDER BY `id`, NOT `detected_at` and NOT `occurred_at`. `id` is a bigserial:
 * monotonic, gapless enough, and unaffected by clock adjustment. `detected_at`
 * can tie to the microsecond across a batch; `occurred_at` comes from ServiceM8
 * and can move BACKWARDS relative to detection (a job edited today can carry a
 * `work_order_date` from last week).
 *
 * APPEND-ONLY, AND REPLAY IS LEGAL. Nothing updates or deletes a row here.
 * Phase 7's recovered-revenue report re-reads history from id 0 on every run, so
 * a consumer must never assume it is the only reader or that a row is consumed
 * once. Idempotence is the consumer's job, which is why the events are facts
 * ("this quote became a Work Order") rather than commands ("send a win email").
 *
 * WHAT IS *NOT* IN HERE, AND WHY IT MATTERS MORE THAN WHAT IS:
 *
 *  - **No pre-connection history.** The 90-day backfill (`connect.ts`) writes
 *    quote rows and emits NOTHING. Its jobs' statuses did not transition while
 *    we were watching; fabricating events for them would make Phase 3 send
 *    congratulations for a job won in June and would poison Phase 7's
 *    attribution with wins the service never touched. Enforced structurally:
 *    `connect.ts` writes quote rows and calls no emission path at all.
 *  - **No events for quotes the operator has not triaged.** `quote_opened`
 *    fires only for a quote that is chase-eligible (D-15), which happens in
 *    exactly TWO places and nowhere else:
 *
 *      1. `run-sync.ts`'s diff path — a quote that ARRIVES after the client is
 *         connected lands eligible, because nobody has had a chance to
 *         mishandle it yet.
 *      2. `core/sync/eligibility.ts` — an operator ticked a backfilled quote
 *         and pressed Save. The flip and the event commit in one transaction,
 *         and the flip's own `RETURNING` drives the emission, so a re-saved
 *         form announces nothing twice.
 *
 *    A backfilled quote sitting at `needs_review` is not something the cadence
 *    engine may act on, so it does not get an announcement.
 *  - **No paused-connection check.** This table says what happened, not whether
 *    we may act. Phase 3 dispatch MUST separately check
 *    `sm8_connections.paused_at IS NULL` before sending anything — a paused
 *    connection means we no longer trust what we know about that client's
 *    quotes, and the events already in the table are exactly as stale as the
 *    mirror they came from.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The literal written into `from_status` when we are seeing a job for the first
 * time. A sentinel string rather than NULL so the column stays NOT NULL and
 * every consumer's `from_status = ...` comparison behaves — a NULL would make
 * both `= 'Quote'` and `<> 'Quote'` false for the same row.
 */
export const FIRST_SIGHT = '(new)' as const;

/**
 * The closed event vocabulary. Phase 3 switches on exactly these five.
 *
 * `won` covers `Quote → Work Order` AND `Quote → Completed`: ServiceM8's four
 * statuses do not progress linearly and a tradie may mark a quote complete
 * without ever passing through Work Order (Pitfall 5). `removed` covers the
 * upstream delete (`active` → 0) regardless of status, because a chased job that
 * no longer exists is the most urgent thing this stream can report.
 */
export const QUOTE_EVENT_TYPES = [
  'quote_opened',
  'won',
  'lost',
  'reopened',
  'removed',
] as const;
export type QuoteEventType = (typeof QUOTE_EVENT_TYPES)[number];

export const quoteStatusEvents = pgTable(
  'quote_status_events',
  {
    /** The consumer's ordering and cursoring basis — see the header. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    /**
     * No FK to `tenants` and no ON DELETE CASCADE, deliberately: this is the
     * ledger Phase 7 computes recovered revenue from, and a disconnected client
     * must not take their own attribution history with them. Isolation is
     * enforced by the policy below, not by the reference.
     */
    tenantId: uuid('tenant_id').notNull(),

    /** Our `quotes.id`. */
    quoteId: uuid('quote_id').notNull(),
    /** Denormalized so a consumer can correlate without a join. */
    sm8JobUuid: uuid('sm8_job_uuid').notNull(),

    /** One of QUOTE_STATUSES, or FIRST_SIGHT. */
    fromStatus: text('from_status').notNull(),
    /** One of QUOTE_STATUSES. */
    toStatus: text('to_status').notNull(),
    /** One of QUOTE_EVENT_TYPES. */
    eventType: text('event_type').notNull(),

    /**
     * Best-effort, from the ServiceM8 per-status timestamp for this event kind
     * (`work_order_date` for a win, `unsuccessful_date` for a loss), normalized
     * to UTC. NULLABLE because ServiceM8 does not always have one — a zero-date
     * is normalized to null rather than to a fake instant, and inventing
     * `detected_at` here would make "when the tradie won it" indistinguishable
     * from "when we noticed".
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),

    /**
     * When WE saw it. Authoritative for ordering questions that `id` cannot
     * answer (how long after the fact did we notice), and never null.
     */
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The console's per-quote timeline read.
    index('quote_status_events_tenant_quote_idx').on(table.tenantId, table.quoteId),
    pgPolicy('quote_status_events_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type QuoteStatusEvent = typeof quoteStatusEvents.$inferSelect;
export type NewQuoteStatusEvent = typeof quoteStatusEvents.$inferInsert;

/**
 * Where each consumer has read up to. ONE ROW PER CONSUMER, e.g.
 * `('cadence-engine', 1204)`.
 *
 * NO ROW IS SEEDED. Phase 3 registers itself with an explicit
 * `INSERT ... ON CONFLICT DO NOTHING` at startup. A pre-seeded row would let a
 * consumer that has never run appear to be caught up; an absent row is an
 * unmistakable "this consumer has not started".
 *
 * NOT TENANT-SCOPED — the cadence engine is one process reading every client's
 * events, so there is no `tenant_id` to gate on. Its policy is therefore
 * `is_operator()` rather than `has_tenant_access(...)`: see
 * src/db/schema/operators.ts for why that helper exists and why a bare
 * `using (true)` is not an option here.
 */
export const eventConsumerCursors = pgTable(
  'event_consumer_cursors',
  {
    consumer: text('consumer').primaryKey(),
    lastEventId: bigint('last_event_id', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('event_consumer_cursors_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type EventConsumerCursor = typeof eventConsumerCursors.$inferSelect;
