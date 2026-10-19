/**
 * Per-tenant touch timing (D-02) — the cadence shape, as data rather than code.
 *
 * WHY CONFIG ROWS AND NOT A CODE CONSTANT. The default schedule is day
 * 0/3/7/14/21, and for the founding cohort it will be exactly that for everyone.
 * It still lives in a table because onboarding is the moment a tradie says "not
 * three weeks, my quotes go cold in five days", and the alternative — a code
 * constant plus a per-client override column bolted on later — reshapes how
 * Phase 5 binds per-touch drafting templates to timing. D-02 records that as a
 * COSTLY reversal, so the schema admits per-client shapes from day one even
 * though the v1 console may only ever apply the default.
 *
 * SEEDED LAZILY, NEVER BACKFILLED. `forTenant().templates.ensureDefaults()`
 * inserts one row per offset `ON CONFLICT DO NOTHING` the first time a cadence
 * is created for a tenant. There is deliberately no backfill migration and no
 * coupling to tenant creation: a tenant who never gets a cadence never needs
 * these rows, and a migration that wrote them would have to be re-run for every
 * client onboarded afterwards.
 *
 * SNAPSHOT SEMANTICS — the important half. Materialization COPIES this row's
 * `channel` and the computed send time onto the `cadence_touches` rows it
 * creates. Editing a template therefore affects only FUTURE materializations
 * and can never reshape a live schedule underneath an approved plan. That is
 * the D-14 anti-goal stated as a data rule: a touch row is a decision already
 * made, not a view over configuration that someone can change later.
 *
 * UNIQUE (tenant_id, touch_number) is what makes `ensureDefaults` idempotent —
 * a double-tapped onboarding save produces five rows, not ten, because Postgres
 * decides rather than a check-then-insert in the caller.
 */
import { sql } from 'drizzle-orm';
import {
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { tenants } from './tenants';

/**
 * The channels a touch may travel on. SMS only in the walking skeleton
 * (STATE.md roadmap decision), but the vocabulary admits email from day one so
 * Phase 4 adds a sender rather than a migration.
 */
export const TOUCH_CHANNELS = ['sms', 'email'] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];

export const cadenceTouchTemplates = pgTable(
  'cadence_touch_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Configuration, not evidence — so unlike `cadences` and `send_ledger` this
     * one DOES cascade. A disconnected client's touch timing is worth nothing
     * to anybody, and leaving it behind would resurrect their old schedule if
     * the same tenant id were ever reused.
     */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** 1-based position in the cadence. UNIQUE per tenant — see the header. */
    touchNumber: smallint('touch_number').notNull(),
    /** Calendar days from the anchor (D-01), not from the previous touch. */
    offsetDays: smallint('offset_days').notNull(),
    /** One of TOUCH_CHANNELS. Snapshotted onto the touch at materialization. */
    channel: text('channel').notNull().default('sms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cadence_touch_templates_tenant_touch_uniq').on(
      table.tenantId,
      table.touchNumber,
    ),
    pgPolicy('cadence_touch_templates_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type CadenceTouchTemplate = typeof cadenceTouchTemplates.$inferSelect;
export type NewCadenceTouchTemplate = typeof cadenceTouchTemplates.$inferInsert;
