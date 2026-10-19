/**
 * NUMBERS A CLIENT'S TEXT-BACK MUST NEVER TEXT (Phase 12, D-06, IN-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FAIL-SAFE AGAINST A SUBSTITUTED CALLER ID. No diverted call has been │
 * │ proven on any carrier (11-08 override): a carrier may present the        │
 * │ DIVERTING line as the caller. If it does, the "caller" is the tradie's   │
 * │ own phone, and a text-back would text the client about their own call.  │
 * │ The gate refuses any caller equal to a number here BEFORE anything else  │
 * │ that could pass (`own_number`, D-06 step 2).                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 *  own_line   — the client's own line(s), the ones that divert to Backdesk.
 *               Recorded at onboarding; at least one is an arming gate item.
 *  never_text — anyone else the client asks us never to text (a supplier, a
 *               family member who rings the work number).
 *
 * Numbers are E.164 `+61…` (mobile or landline: an office line is `+618…`),
 * normalised at the boundary. They are the client's numbers, not customers',
 * but the same never-printed rule applies.
 *
 * The suppressed-contacts mould: tenant-scoped, unique per (tenant, number),
 * no FK and no cascade, written through the service-role repository only.
 */
import { sql } from 'drizzle-orm';
import { check, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** Why a number is on the list. See the header. */
export const NEVER_TEXT_KINDS = ['own_line', 'never_text'] as const;
export type NeverTextKind = (typeof NEVER_TEXT_KINDS)[number];

export const tenantNeverTextNumbers = pgTable(
  'tenant_never_text_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),

    /** Normalised E.164 `+61…`. NEVER PRINTED. */
    numberE164: text('number_e164').notNull(),

    /** One of NEVER_TEXT_KINDS. */
    kind: text('kind').notNull(),

    /** The operator's short note ("office line", "Dave's mobile"). */
    label: text('label'),

    /** The operator who added it. */
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** One entry per number per client; a second add is a no-op. */
    uniqueIndex('tenant_never_text_tenant_number_uniq').on(table.tenantId, table.numberE164),

    check('tenant_never_text_number_shape', sql`number_e164 ~ '^[+]61[0-9]{9}$'`),
    check('tenant_never_text_kind_known', sql`kind IN ('own_line', 'never_text')`),
    check('tenant_never_text_label_length', sql`label IS NULL OR length(label) <= 60`),

    pgPolicy('tenant_never_text_numbers_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TenantNeverTextNumber = typeof tenantNeverTextNumbers.$inferSelect;
export type NewTenantNeverTextNumber = typeof tenantNeverTextNumbers.$inferInsert;
