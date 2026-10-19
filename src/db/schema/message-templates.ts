/**
 * The approved words a client's follow-ups are built from. CONFIGURATION.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A ROW IS A VERSION. ROWS ARE APPEND-ONLY. NOTHING IS EDITED IN PLACE.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The primary identity of a template is `(tenant, kind, touch_number,
 * channel, version)` — i.e. a version of one `(tenant, kind, touch, channel)`
 * slot's wording — NOT a mutable per-touch slot that gets UPDATEd when the
 * operator rewords touch 3. `kind` (Phase 13, D-02) separates the quote
 * cadence's wordings from the lead cadence's: a lead touch 2 and a quote
 * touch 2 are different messages, and every QUOTE read carries
 * `kind = 'quote'` so a seeded, pre-approved lead row can never satisfy the
 * quote onboarding gate. That choice is D-08 and it is ONE-WAY, which is why it is
 * here in the first migration rather than deferred to whenever versioning first
 * hurts.
 *
 * The reason is `touch_drafts`. Every draft row records the `template_id` and
 * `template_version` it was generated from, and those references are AI-04 audit
 * evidence: months later, "why did the model write that" is answered by reading
 * the exact template text the draft was produced from. If templates were mutable
 * slots, that answer would silently become the CURRENT wording — the draft row
 * would point at text that did not exist when it was drafted, and every recorded
 * reference would be quietly wrong rather than loudly broken. Collapsing
 * versioning later orphans the references that already exist; adding it later
 * cannot retroactively recover the text that was overwritten.
 *
 * So:
 *
 *   - Editing a template INSERTS version+1 with `approved_at` NULL.
 *   - Drafting reads MAX(version) WHERE `approved_at IS NOT NULL` — the newest
 *     version an operator actually blessed, never the newest draft of a
 *     template. An unapproved edit sitting in the table changes nothing about
 *     what customers receive until somebody approves it.
 *   - Rows are IMMUTABLE after insert. The approval columns are WRITE-ONCE.
 *
 * ── `approved_at` / `approval_note` ARE ATTESTATION, NOT A STATUS FLAG (D-06) ─
 *
 * `approved_at` is not "is this template on". It records that a HUMAN read this
 * exact body and accepted responsibility for it going out in a tradie's name.
 * `approval_note` is where that human says why — the free-text half of the
 * attestation. Both are write-once for the same reason `touch_drafts` is
 * append-only: an attestation that can be edited afterwards is not evidence of
 * anything, because the version that was approved and the version that is
 * recorded as approved could differ with no trace.
 *
 * ── `subject` EXISTS NOW AND IS NULL FOR EVERY SMS ROW (D-04) ───────────────
 *
 * Phase 5 drafts SMS only. The column is here anyway because `TOUCH_CHANNELS`
 * already admits `'email'` (see cadence-templates.ts) and the email arm needs a
 * subject line. Adding a nullable column later is cheap; adding it later to a
 * table that `touch_drafts` rows already reference by version means the email
 * templates start at a version number whose predecessors have no subject, which
 * is a distinction with no meaning that every reader afterwards has to learn.
 *
 * ── CASCADE, BECAUSE THIS IS CONFIGURATION AND NOT EVIDENCE ─────────────────
 *
 * Same split the rest of the schema follows: config tables cascade from
 * `tenants` (cadence-templates.ts, cadence-settings.ts), evidence tables
 * deliberately do not (cadences.ts, send-ledger.ts, inbound-messages.ts, and
 * `touch_drafts` beside this file). A disconnected client's template wording is
 * worth nothing to anybody and would resurrect their old words if the tenant id
 * were ever reused. The DRAFTS generated from those templates are a different
 * question and get the opposite answer.
 *
 * WRITES ARE SERVICE-ROLE ONLY. `authenticated` holds SELECT and nothing else
 * (see the GRANT block in migration 0028) — the console's template editor is a
 * server action, for the reason 0017 states about every D-16 control: inserting
 * a version and attesting to it are two steps of one decision, and a console
 * role holding a direct INSERT grant is a console role holding the ability to
 * perform half of it.
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

/**
 * Which cadence a template's wording belongs to (Phase 13, D-02). Mirrors
 * `CADENCE_KINDS` (cadences.ts) member for member; its own const because the
 * schema files do not import each other's vocabularies, and the CHECK below
 * repeats this spelling byte for byte.
 */
export const MESSAGE_TEMPLATE_KINDS = ['quote', 'lead'] as const;
export type MessageTemplateKind = (typeof MESSAGE_TEMPLATE_KINDS)[number];

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Configuration — so this one DOES cascade. See the header. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * One of MESSAGE_TEMPLATE_KINDS (Phase 13). DEFAULT 'quote', which is what
     * every pre-Phase-13 row is, so the column backfills without a data
     * statement.
     */
    kind: text('kind').notNull().default('quote'),

    /** 1-based position in the cadence, matching `cadence_touch_templates`. */
    touchNumber: smallint('touch_number').notNull(),
    /** One of TOUCH_CHANNELS (cadence-templates.ts). CHECK-constrained below. */
    channel: text('channel').notNull().default('sms'),

    /**
     * 1-based, monotonic per (tenant, kind, touch, channel). The UNIQUE index below
     * is what makes a double-tapped save produce a 23505 rather than two rows
     * claiming to be the same version — Postgres decides, not the caller.
     */
    version: smallint('version').notNull(),

    /**
     * The template text. NOT a merge-field string that gets filled in and sent:
     * this is the wording the DRAFTING PROMPT is given as the shape to rewrite
     * for a specific quote (D-01). Nothing in this repository ever sends a
     * template body to a customer — D-10 forbids the merge-fill fallback
     * explicitly, so a body reaching a handset has always been through the
     * model and the validator.
     */
    body: text('body').notNull(),
    /** Email-ready from day one; NULL on every sms row. See the header. */
    subject: text('subject'),

    /** WRITE-ONCE attestation. NULL means "not approved", never "pending". */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** The human half of the attestation (D-06). Write-once with the above. */
    approvalNote: text('approval_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * The identity stated in the header, as a database fact. Also the
     * idempotence mechanism for the version-bump insert.
     */
    uniqueIndex('message_templates_tenant_kind_touch_channel_version_uniq').on(
      table.tenantId,
      table.kind,
      table.touchNumber,
      table.channel,
      table.version,
    ),

    check('message_templates_channel_known', sql`channel IN ('sms', 'email')`),
    /** Phase 13. The spelling must match MESSAGE_TEMPLATE_KINDS byte for byte. */
    check('message_templates_kind_known', sql`kind IN ('quote', 'lead')`),

    pgPolicy('message_templates_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
