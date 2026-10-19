/**
 * What an operator SAW, and said so, on a client's behalf. EVIDENCE — APPEND-ONLY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONB-04's gate is an ATTESTATION, NOT A STATUS FLAG. A row here does not  │
 * │ mean "ServiceM8 automation is off for this client". It means a NAMED     │
 * │ HUMAN opened that client's ServiceM8 settings at a recorded moment,      │
 * │ looked, and wrote down what they saw. Those are different claims, and    │
 * │ only the second one is something we can actually know.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The distinction is the same one `message_templates.approved_at` /
 * `approval_note` draws ("ATTESTATION, NOT A STATUS FLAG"), and this table is
 * its versioned sibling. There, an approval is write-once on an immutable row.
 * Here, RE-ATTESTATION IS A NEW ROW.
 *
 * ── WHY APPEND-ONLY RATHER THAN WRITE-ONCE ──────────────────────────────────
 *
 * The fact being attested can DRIFT: a client (or their bookkeeper) can switch
 * ServiceM8's native Quote Follow Up back on months later, and D-15 responds to
 * a stale attestation (~30 days) by nagging rather than by pausing. That policy
 * needs a HISTORY — "verified off on 3 Sep, and again on 8 Oct" — and an
 * updatable row would erase exactly the trail it reads. There is no update path
 * and no delete path in the repository, and none in the grants (0032).
 *
 * The staleness read is therefore "the latest row for this tenant and kind",
 * which is what the index below is shaped for. Latest wins; nothing is
 * overwritten.
 *
 * ── `note` IS REQUIRED AND HAS NO DEFAULT, AND THAT IS THE MECHANISM ────────
 *
 * T-5-12, applied one gate over: TYPING HOW YOU VERIFIED IT *IS* THE
 * DELIBERATION. A checkbox records that somebody clicked; a sentence records
 * that somebody looked. A default value — even an empty string — turns this
 * column into the checkbox it exists to replace, so the NOT NULL carries no
 * `.default()` and the form's textarea is `required` with no placeholder text
 * that could be submitted unchanged.
 *
 * ── THE EVIDENCE-FAMILY RULES, VERBATIM ─────────────────────────────────────
 *
 * `tenant_id` is a column with NO foreign key and NO cascade (inbound-messages.ts
 * :31-36): a client who disconnects must not take the record of what we checked
 * on their behalf with them — that record is the answer to "did we do our job"
 * long after they leave. RLS is authored here as a `pgPolicy` so the table
 * cannot ship unprotected by omission, and `authenticated` gets SELECT only:
 * the attest form is a server action writing through the service-role
 * repository, like every other D-16 control.
 */
import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * What can be attested. ONE MEMBER, and the vocabulary exists anyway.
 *
 * A CHECK-constrained closed set from the first member, following the house rule
 * (migrations 0004/0008/0011/0017): the writer is a service-role action and the
 * TypeScript union erases before the INSERT is built, so the constraint is what
 * catches a typo. `'sm8_automation_of'` would insert cleanly, satisfy no read,
 * and leave the client gated forever with an attestation sitting in the table.
 *
 *  sm8_automation_off — ONB-04: the client's own ServiceM8 Quote Follow Up
 *    automation is switched off, so our cadence is not the second voice
 *    chasing the same customer. This is the condition D-14 adds to the
 *    onboarding gate beside "templates approved".
 */
export const TENANT_ATTESTATION_KINDS = ['sm8_automation_off'] as const;
export type TenantAttestationKind = (typeof TENANT_ATTESTATION_KINDS)[number];

export const tenantAttestations = pgTable(
  'tenant_attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),

    /** One of TENANT_ATTESTATION_KINDS. CHECK-constrained in migration 0032. */
    kind: text('kind').notNull(),

    /**
     * HOW the operator verified it, in their own words. REQUIRED, NO DEFAULT.
     *
     * See the header: this column is the deliberation, not a description of it.
     */
    note: text('note').notNull(),

    /**
     * WHEN the operator looked — SERVER-SET, never submitted.
     *
     * A client-supplied timestamp on an attestation is a date somebody could
     * type, and the whole value of this row is that the moment is ours. The
     * staleness policy (D-15, ~30 days) reads this column.
     */
    attestedAt: timestamp('attested_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE LATEST-WINS READ. `(tenant_id, kind, attested_at DESC)` serves both
     * questions the checklist asks — "has this ever been attested" and "how old
     * is the newest one" — as one indexed lookup rather than a scan of a
     * client's whole attestation history.
     */
    index('tenant_attestations_latest_idx').on(
      table.tenantId,
      table.kind,
      sql`${table.attestedAt} DESC`,
    ),

    pgPolicy('tenant_attestations_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TenantAttestation = typeof tenantAttestations.$inferSelect;
export type NewTenantAttestation = typeof tenantAttestations.$inferInsert;
