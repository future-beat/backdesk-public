/**
 * One ServiceM8 connection per tenant — the row every sync path starts from.
 *
 * WHY `tenant_id` IS UNIQUE AND NOT MERELY INDEXED (ONB-02 concurrency):
 * the uniqueness constraint IS the concurrency guarantee. Two operators (or one
 * operator double-clicking "Connect") race the same verify-then-write, and the
 * database — not application-level checking, which is a TOCTOU by construction —
 * decides that exactly one row survives. `connectServiceM8` upserts on this
 * constraint, so a second submit overwrites rather than duplicating, which is
 * also precisely the semantics the 02-04 re-key flow needs (D-08 auto-resume).
 *
 * CROSS-PHASE CONTRACT — the pause fields (D-06/D-08):
 * `paused_at` / `status_reason` are written by sync failure classification and
 * cleared by a successful re-key. **Phase 3 dispatch MUST check
 * `paused_at IS NULL` before sending anything**, and touches that fall due
 * during a pause must be RE-WINDOWED per CAD-02 — never burst-sent on resume.
 * A paused connection means "we no longer trust what we know about this
 * client's quotes"; sending from stale state is the failure mode this field
 * exists to prevent.
 *
 * `consecutive_failures` / `alerted_at` implement the degraded-health alert
 * (RESEARCH Pattern 5): increment per failed cycle, reset on success, alert once
 * per episode at 3 — `alerted_at` is the dedupe, so the operator gets one email
 * rather than one every five minutes.
 *
 * The `baseline_*` fields hold the 90-day snapshot computed at connect (D-14):
 * what the client's quote volume and win rate looked like BEFORE we touched
 * anything. Without a baseline captured at connect time, the monthly
 * recovered-revenue report has nothing honest to compare against.
 *
 * `sm8_tz_offset_minutes` is calibration metadata, not configuration: the
 * measured skew between ServiceM8's timestamp clock and UTC for this account
 * (RESEARCH A3 / Open Question 3). ServiceM8 never documents the timezone of
 * `edit_date`, so it is measured per account rather than assumed globally.
 */
import { sql } from 'drizzle-orm';
import {
  date,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { tenants } from './tenants';

export const sm8Connections = pgTable(
  'sm8_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** UNIQUE — see the header. One connection per tenant, enforced by Postgres. */
    tenantId: uuid('tenant_id')
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * `enc:v1:<iv>:<tag>:<data>` — AES-256-GCM, encrypted in the application
     * layer so the decryption key never enters the database (threat T-2-01).
     * A dump, a misconfigured replica or an RLS bug yields ciphertext only.
     */
    apiKeyCiphertext: text('api_key_ciphertext').notNull(),
    /** The ONLY part of the key that is ever rendered (threat T-2-02). */
    keyLast4: text('key_last4').notNull(),

    /**
     * Max `edit_date` STRING observed from ServiceM8, verbatim. Never our clock
     * and never reinterpreted — it is only ever compared against other
     * ServiceM8 timestamps inside ServiceM8's own filter (RESEARCH Pattern 1).
     */
    jobCursor: text('job_cursor'),
    contactCursor: text('contact_cursor'),

    /** D-06/D-08 — see the cross-phase contract in the header. */
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    statusReason: text('status_reason'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    alertedAt: timestamp('alerted_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),

    /** D-14 — the pre-service baseline, captured once at connect. */
    baselineWinRate: numeric('baseline_win_rate', { precision: 5, scale: 4 }),
    baselineQuotesIssued: integer('baseline_quotes_issued'),
    baselineWindowStart: date('baseline_window_start'),
    baselineWindowEnd: date('baseline_window_end'),
    baselineComputedAt: timestamp('baseline_computed_at', { withTimezone: true }),

    /** A3 — measured, not assumed. See the header. */
    sm8TzOffsetMinutes: integer('sm8_tz_offset_minutes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('sm8_connections_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type Sm8Connection = typeof sm8Connections.$inferSelect;
export type NewSm8Connection = typeof sm8Connections.$inferInsert;
