/**
 * ONE BACKDESK-CONTROLLED AUSTRALIAN NUMBER PER CLIENT, THAT THE CLIENT'S OWN
 * LINE DIVERTS TO WHEN THEY CANNOT ANSWER (Phase 11, CAP-01, D-01/D-02/D-08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO DELETE PATH. NO RELEASE PATH. NOT WHILE THE CLIENT IS ACTIVE (D-08).  │
 * │ A released number is a number Twilio can sell to somebody else, and the  │
 * │ tradie's phone keeps diverting to it — their customers' missed calls     │
 * │ would ring a stranger. So there is no DELETE in the repository and no    │
 * │ DELETE grant for any browser role (migration 0038): the only way a row   │
 * │ leaves this table is a deliberate, hand-written, reviewed statement.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * TENANT IDENTITY IS THE CALLED NUMBER (D-02). A diverted call reaches Twilio
 * carrying `To` = this row's `number_e164`, and that is the ONLY thing the voice
 * webhook resolves a tenant from. `ForwardedFrom` is carrier-dependent (and
 * absent on some carriers entirely), so it is stored on `missed_calls` as
 * evidence and never routed on. That is why both UNIQUEs below exist:
 *
 *   tenant_id UNIQUE   — one number per client. Also the double-provision
 *     guard: two concurrent "buy" clicks both try to INSERT the `pending` claim
 *     row, and the second gets a 23505 before any purchase is attempted.
 *   number_e164 UNIQUE — never shared (D-02). Two rows owning one number would
 *     make "whose call is this" a coin toss. NULL while `pending` (Postgres
 *     treats NULLs as distinct, so any number of pending rows coexist).
 *
 * THE CLAIM-THEN-BUY LIFECYCLE (plan 11-04): `pending` (claimed, nothing bought
 * yet) → `active` (bought, voice URL and status callback set in the SAME create
 * call, SID and number filled) or `failed` (the purchase refused; `failure_code`
 * is our closed code, never Twilio's prose). A retry is an UPDATE of the failed
 * row back through `activate`, never a second INSERT.
 *
 * ── THE CONFIG/EVIDENCE-FAMILY RULES (tenant-proofs.ts) ─────────────────────
 *
 * No FK on `tenant_id` and no cascade: deleting a tenant must not silently
 * delete the record of which number was theirs — that is the answer to "whose
 * number was +618… in March" long after they leave, and a cascade is exactly the
 * release path D-08 forbids, spelled as a side effect. RLS is authored here as a
 * `pgPolicy` so the table cannot ship unprotected by omission, and
 * `authenticated` gets SELECT only: provisioning is a server action writing
 * through the service-role repository, like every other control.
 */
import { sql } from 'drizzle-orm';
import { check, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The provisioning lifecycle. CHECK-constrained from the first member, the house
 * rule: the writer is a service-role action and the TypeScript union erases
 * before the INSERT is built.
 */
export const DIVERT_NUMBER_STATUSES = ['pending', 'active', 'failed'] as const;
export type DivertNumberStatus = (typeof DIVERT_NUMBER_STATUSES)[number];

export const tenantDivertNumbers = pgTable(
  'tenant_divert_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No FK, no cascade — see the header. UNIQUE: one number per client. */
    tenantId: uuid('tenant_id').notNull().unique('tenant_divert_numbers_tenant_uniq'),

    /** Only Twilio today (D-01); CHECK-constrained so a typo cannot land. */
    provider: text('provider').notNull().default('twilio'),

    /** Twilio's IncomingPhoneNumber SID (`PN…`). NULL while `pending`. */
    providerNumberSid: text('provider_number_sid'),

    /**
     * The number, E.164, `+61` and nine digits — THE TENANT KEY for every
     * diverted call. NULL while `pending`. UNIQUE: never shared (D-02).
     */
    numberE164: text('number_e164').unique('tenant_divert_numbers_number_uniq'),

    /**
     * What the greeting says after "you've reached" — the business name as a
     * caller would recognise it. 1..60 characters at the database; the greeting
     * builder truncates to the same ceiling and entity-escapes it, because this
     * string is interpolated into the TwiML a live call executes.
     */
    spokenName: text('spoken_name').notNull(),

    /** One of DIVERT_NUMBER_STATUSES. */
    status: text('status').notNull().default('pending'),

    /**
     * Our closed lower_snake code. Never provider prose. On `failed`: why the
     * purchase was refused. On `pending`: the hold code `outcome_unknown` when
     * the purchase may have gone through (CR-01). On `active`:
     * `bundle_unattached` when Twilio did not report the AU regulatory bundle
     * on the number after the attach-and-read-back (WR-09).
     */
    failureCode: text('failure_code'),

    /** Twilio's `locality` for the number (e.g. `Perth`), shown to the operator. */
    locality: text('locality'),

    /** When the purchase succeeded. SERVER-SET by the provisioning path. */
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),

    /** The operator's Supabase user id, from `requireOperatorId()`. */
    createdBy: uuid('created_by').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('tenant_divert_numbers_provider_known', sql`provider IN ('twilio')`),
    check(
      'tenant_divert_numbers_number_shape',
      sql`number_e164 IS NULL OR number_e164 ~ '^[+]61[0-9]{9}$'`,
    ),
    check('tenant_divert_numbers_spoken_name_length', sql`length(spoken_name) BETWEEN 1 AND 60`),
    check('tenant_divert_numbers_status_known', sql`status IN ('pending', 'active', 'failed')`),
    check(
      'tenant_divert_numbers_failure_code_shape',
      sql`failure_code IS NULL OR failure_code ~ '^[a-z_]{1,32}$'`,
    ),

    pgPolicy('tenant_divert_numbers_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TenantDivertNumber = typeof tenantDivertNumbers.$inferSelect;
export type NewTenantDivertNumber = typeof tenantDivertNumbers.$inferInsert;
