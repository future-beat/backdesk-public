/**
 * What each client pays us, and from when. APPEND-ONLY CONFIGURATION.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS TABLE IS THE DENOMINATOR OF THE 3× GUARANTEE (D-13). The headline   │
 * │ multiple is conservative recovered revenue ÷ fees paid, so a wrong or    │
 * │ silently-edited number here does not produce a slightly-off report — it  │
 * │ produces a claim about value delivered that the client can disprove.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── APPEND-ONLY, THE `tenant_attestations` RULE FOR A DIFFERENT REASON ─────
 *
 * A price change is a NEW ROW with a later `effective_from`. Nothing is ever
 * overwritten, and the repository exposes `append` and `list` and nothing else —
 * the absent method IS the rule (the `suppressed_contacts` / `tenant_attestations`
 * posture).
 *
 * Why it matters more here than tidiness: a frozen `monthly_reports` row copies
 * the fee rows it used into its own `fees` document (D-11), so the report itself
 * survives an edit. What does NOT survive is the ability to answer "what were we
 * charging them in August" for any month whose report has not been generated yet,
 * or to explain a multiple that a client questions three months later. An
 * updatable row erases exactly the history the question is asking about.
 *
 * Reading it is `feesInForce(rows, start, end, timezone)`: for each local day in
 * the period, the monthly row with the greatest `effective_from` at or before
 * that day is in force. Two rows sharing an `effective_from` resolve
 * LATEST-INSERTED-WINS, which is why `fees.list()` orders by `effective_from
 * DESC, created_at DESC` — a correction entered the same day supersedes the
 * mistake, without either row disappearing.
 *
 * ── CONFIG FAMILY, SO IT CASCADES — AND THAT IS DELIBERATE ─────────────────
 *
 * Unlike `quote_attributions` and `monthly_reports` beside it, `tenant_id` HAS a
 * foreign key with `ON DELETE CASCADE`, following `cadence_settings`. This is
 * configuration, not evidence: the evidential copy of a fee schedule lives
 * inside the frozen report that used it, so a deleted client's schedule loses
 * nothing that a report needed. The distinction is worth stating out loud
 * because the two neighbouring tables in this phase go the other way.
 *
 * ── `effective_from` HAS NO DEFAULT, ON PURPOSE ────────────────────────────
 *
 * The "no default contact window" rule (Phase 1): a value this consequential is
 * something an operator SAYS, not something a helper assumed. A defaulted
 * `now()` would silently backdate or forward-date a price change by up to a
 * month depending on when the form was submitted, and the error would only
 * surface as a wrong multiple in a document already sent.
 *
 * ── RLS AND GRANTS ─────────────────────────────────────────────────────────
 *
 * RLS is authored HERE, as a `pgPolicy` (the Phase 1 rule). Migration 0033
 * grants `authenticated` SELECT only and carries the argument: A CONSOLE EDIT
 * REWRITES THE DENOMINATOR OF A MULTIPLE ALREADY REPORTED. The edit form is a
 * server action that calls `forTenant(id).fees.append(...)` after `authorize()`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { tenants } from './tenants';

/**
 * The two things a client pays.
 *
 *  monthly — the retainer. PRO-RATED by local day across a period, so a
 *            mid-month price change bills correctly, and it is the ONLY kind in
 *            the recovery multiple's denominator.
 *  setup   — the one-off onboarding fee. Rendered as its own line in the month
 *            containing its `effective_from` and EXCLUDED from the multiple: the
 *            3× guarantee is quoted against the retainer, and folding a $990
 *            setup line into month one would make every first month look like a
 *            failure. The report's footnote says so rather than leaving the
 *            reader to work it out.
 *
 * A CHECK-constrained closed set (migration 0033), following the house rule from
 * 0004/0008/0011/0017: the writer is a service-role action and the TypeScript
 * union erases before the INSERT is built, so the constraint is what catches a
 * typo. `'montly'` would insert cleanly, be in force for nothing, and leave a
 * client's report reading "no fee schedule" with a row sitting in the table.
 */
export const TENANT_FEE_KINDS = ['monthly', 'setup'] as const;
export type TenantFeeKind = (typeof TENANT_FEE_KINDS)[number];

export const tenantFees = pgTable(
  'tenant_fees',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Config family: a real foreign key, cascading. NOT `.primaryKey()` —
     * unlike `cadence_settings` there are MANY rows per tenant, which is the
     * whole append-only point. See the header.
     */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** One of TENANT_FEE_KINDS. CHECK-constrained in migration 0033. */
    kind: text('kind').notNull(),

    /**
     * INTEGER CENTS, in a `bigint` column read back as a JS number.
     *
     * Never a float, for the reason the attribution table gives: money that
     * rounds differently on two screens is a client ringing about their invoice.
     * Declared to read back as a JS number because postgres.js hands back a
     * `bigint` column as a STRING otherwise (Pitfall 10), and `feesInForce`
     * wants integers.
     *
     * `CHECK (amount_cents >= 0)` in migration 0033. A negative fee is not a
     * credit note — it is a typo that would inflate a recovery multiple, and the
     * credit-note feature, if it is ever wanted, is a decision rather than a
     * side effect of an unconstrained column.
     */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),

    /**
     * The local calendar date this amount starts applying. NO DEFAULT — see the
     * header. A `date`, not an instant: a price starts on a day in the client's
     * own calendar, and `feesInForce` compares it as text (ISO dates sort).
     */
    effectiveFrom: date('effective_from').notNull(),

    /** Why, in the operator's own words. Optional — unlike an attestation. */
    note: text('note'),

    /**
     * When the row was entered. The LATEST-INSERTED-WINS tie-break for two rows
     * sharing an `effective_from` — see the header.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE IN-FORCE LOOKUP, in the `tenant_attestations_latest_idx` shape:
     * "what monthly fee applied to this client on this day" served as one
     * indexed lookup rather than a scan of their whole pricing history.
     */
    index('tenant_fees_in_force_idx').on(
      table.tenantId,
      table.kind,
      sql`${table.effectiveFrom} DESC`,
    ),

    pgPolicy('tenant_fees_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TenantFee = typeof tenantFees.$inferSelect;
export type NewTenantFee = typeof tenantFees.$inferInsert;
