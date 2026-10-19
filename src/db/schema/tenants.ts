/**
 * Tenancy schema — the shape every later phase inherits.
 *
 * Shared tables keyed by `tenant_id`, RLS on from migration set 001. Attaching a
 * `pgPolicy` auto-enables row-level security on the table, so there is no
 * separate ALTER to forget (01-RESEARCH.md Pattern 1).
 *
 * Policies resolve access through a `tenant_members` lookup via the
 * SECURITY DEFINER helper `has_tenant_access(uuid)` — never through
 * `raw_user_meta_data`, which the user can modify (Pattern 4, threat T-02-01).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { prospects } from './prospects';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** ONB-01 "trade type" — free text for now; a vocabulary can land later. */
    tradeType: text('trade_type').notNull(),
    /** IANA identifier, never a UTC offset — offsets break across DST. */
    timezone: text('timezone').notNull().default('Australia/Perth'),
    contactHoursStart: time('contact_hours_start').notNull(),
    contactHoursEnd: time('contact_hours_end').notNull(),
    /** ISO weekdays, Monday = 1 .. Sunday = 7. */
    contactDays: smallint('contact_days').array().notNull(),
    escalationPhone: text('escalation_phone'),
    /**
     * Phase 13 (D-09): may a HOT lead outside this client's contact hours go
     * to their phone at once? DEFAULT OFF — a tradie who does not do call-outs
     * must not be woken at 23:00 by an enquiry about a fence; their hot lead is
     * held and sent at the start of the next contact window instead. Set ON at
     * onboarding for emergency trades (plumbing, electrical, locksmiths).
     * Emergency-urgency replies and keyword hits bypass it either way: a caller
     * in an emergency at 23:00 is precisely who rang.
     */
    afterHoursEscalation: boolean('after_hours_escalation').notNull().default(false),
    status: text('status').notNull().default('onboarding'),

    /**
     * D-02 — the conversion link, and note which way round it points.
     *
     * The TENANT references the prospect it came from; the prospect does not
     * reference the tenant. That direction is the whole design: the baseline
     * snapshot and the audit figures stay on the prospect record where they
     * were computed, and Phase 7 reads them THROUGH this column to answer "how
     * were they doing before we arrived". Storing the link the other way — or
     * copying the snapshot onto the tenant — would create a second copy of a
     * number that must never disagree with itself.
     *
     * NULL for every client onboarded without an audit first, which is most of
     * them; a prospect is a sales artefact, not a prerequisite. The setter
     * control ships with the convert flow in plan 02-07.
     *
     * NO CASCADE, deliberately: deleting a prospect must not delete a paying
     * client. `ON DELETE SET NULL` would also be wrong — a prospect row is
     * cheap and the provenance is worth more than the row it occupies, so the
     * default RESTRICT stands and a delete that would orphan a tenant fails
     * loudly instead.
     */
    prospectId: uuid('prospect_id').references(() => prospects.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('tenants_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(id)`,
      withCheck: sql`has_tenant_access(id)`,
    }),
  ],
);

export const tenantMembers = pgTable(
  'tenant_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull().default('operator'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    // Deliberately narrower than the tenants policy: a member may read their own
    // membership rows and nothing else. Writes go through create_tenant().
    pgPolicy('tenant_members_select_own', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`user_id = auth.uid()`,
    }),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantMember = typeof tenantMembers.$inferSelect;
