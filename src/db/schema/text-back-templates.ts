/**
 * THE WORDS A MISSED CALLER IS SENT — PER CLIENT, VERSIONED, ATTESTED
 * (Phase 12, D-02/D-03/D-23).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS NOT `message_templates`. That table's body is the SHAPE a    │
 * │ drafting prompt rewrites, and its header says nothing in the repository  │
 * │ ever sends a template body to a customer. The text-back is the first     │
 * │ path that DOES: no model, no merge-fill — the bytes the operator attested │
 * │ are the bytes ClickSend sends (D-02). Sharing the table would make that   │
 * │ sentence false for some rows and true for others, which is worse than    │
 * │ either.                                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THREE VARIANTS: `business_hours` and `after_hours` (chosen by the missed
 * call's stored `after_hours` fact) and `about_quote` (the D-08 text to a
 * caller who already has an open quote cadence).
 *
 * THE BODY IS THE FINAL LITERAL TEXT, with the business name typed in — not a
 * `{business}` token. A token would let a later rename change attested bytes.
 * `validateTextBackTemplate` (src/core/leads/template.ts) checks it at save and
 * AGAIN at send time: GSM-7 only, at most two segments, the business name,
 * "Reply STOP", the plain-text privacy pointer and no other link.
 *
 * VERSIONED, WRITE-ONCE ATTESTATION, the `message_templates` mould: an edit is a
 * new version with NULL attestation, and the send path reads only the newest
 * ATTESTED version, so an unattested edit never changes what goes out. The
 * three attestation columns are all NULL or all set (with a non-blank note) —
 * a half-attested row is refused by the database.
 *
 * Configuration, not evidence: `tenant_id` references `tenants` with cascade,
 * as `message_templates` does.
 */
import { sql } from 'drizzle-orm';
import {
  check,
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

/** The three wordings a client's text-back can use. See the header. */
export const TEXT_BACK_VARIANTS = ['business_hours', 'after_hours', 'about_quote'] as const;
export type TextBackVariant = (typeof TEXT_BACK_VARIANTS)[number];

export const textBackTemplates = pgTable(
  'text_back_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Configuration — so this one DOES cascade. See the header. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** One of TEXT_BACK_VARIANTS. */
    variant: text('variant').notNull(),

    /** 1-based, monotonic per (tenant, variant). */
    version: smallint('version').notNull(),

    /** The literal text sent, byte for byte. At most 306 septets (two segments). */
    body: text('body').notNull(),
    /** Segments as the shared counter measured them at save. */
    segments: smallint('segments').notNull(),

    /** WRITE-ONCE attestation. NULL means "not attested", never "pending". */
    attestedAt: timestamp('attested_at', { withTimezone: true }),
    /** The operator's Supabase user id, from `requireOperatorId()`. */
    attestedBy: uuid('attested_by'),
    /** What the operator checked, in their own words. */
    attestationNote: text('attestation_note'),

    /** The operator who saved this version. */
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The version-bump arbiter, the `message_templates` shape. */
    uniqueIndex('text_back_templates_tenant_variant_version_uniq').on(
      table.tenantId,
      table.variant,
      table.version,
    ),

    check(
      'text_back_templates_variant_known',
      sql`variant IN ('business_hours', 'after_hours', 'about_quote')`,
    ),
    check('text_back_templates_body_length', sql`length(body) BETWEEN 1 AND 306`),
    check('text_back_templates_segments_range', sql`segments BETWEEN 1 AND 2`),
    /** All three attestation columns, or none — and a note that says something. */
    check(
      'text_back_templates_attestation_whole',
      sql`(attested_at IS NULL AND attested_by IS NULL AND attestation_note IS NULL) OR (attested_at IS NOT NULL AND attested_by IS NOT NULL AND attestation_note IS NOT NULL AND length(btrim(attestation_note)) > 0)`,
    ),

    pgPolicy('text_back_templates_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TextBackTemplate = typeof textBackTemplates.$inferSelect;
export type NewTextBackTemplate = typeof textBackTemplates.$inferInsert;
