/**
 * One row per sync cycle, per connection — the answer to "is this client's
 * mirror actually being kept up to date?" (SYNC-04, D-07).
 *
 * WHY A LOG TABLE RATHER THAN A HEALTH COLUMN: a stored badge goes stale the
 * moment the process that maintains it dies, and the failure this table exists
 * to catch is precisely "the tick stopped running". A connection whose newest
 * `sync_runs` row is four hours old is visibly broken; a connection whose
 * `health = 'healthy'` column is four hours old looks fine. Health is DERIVED
 * from this table plus the pause fields on `sm8_connections`, never stored.
 *
 * EVERY CYCLE WRITES A ROW, INCLUDING FAILURES. A failed cycle that writes
 * nothing is indistinguishable from a cycle that never ran, and those two need
 * different responses (fix the client's key vs. fix our cron).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `error_detail` HOLDS THE CLASSIFIED REASON AND NOTHING ELSE (T-2-02).    │
 * │                                                                          │
 * │ Never a stack trace, never a response body, never a request header, and  │
 * │ above all never an API key. The ServiceM8 boundary returns typed results │
 * │ carrying a status code and a curated detail string precisely so that the │
 * │ value written here cannot contain a credential — a `catch (e)` writing   │
 * │ `String(e)` would put the request URL, and potentially the X-API-Key     │
 * │ header, into a table the console renders.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { tenants } from './tenants';

/**
 * The closed outcome vocabulary: `ok` plus the five `Sm8FailureKind` values.
 *
 * It is deliberately the SAME vocabulary the ServiceM8 client classifies into
 * (src/core/servicem8/types.ts), because the whole point of that classification
 * is that the five kinds carry five different policies (D-06). A sixth value
 * invented at a write site would be a failure with no policy attached.
 */
export const SYNC_OUTCOMES = [
  'ok',
  'auth_failed',
  'rate_limited',
  'server_error',
  'network_error',
  'parse_error',
] as const;
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    /** One of SYNC_OUTCOMES. */
    outcome: text('outcome').notNull(),

    jobsFetched: integer('jobs_fetched').notNull().default(0),
    jobsUpserted: integer('jobs_upserted').notNull().default(0),
    contactsFetched: integer('contacts_fetched').notNull().default(0),
    eventsEmitted: integer('events_emitted').notNull().default(0),

    /** Classified reason ONLY — see the box in the header. */
    errorDetail: text('error_detail'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "What happened most recently for this client" — the health read, every
    // console page load.
    index('sync_runs_tenant_started_idx').on(table.tenantId, table.startedAt),
    pgPolicy('sync_runs_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
