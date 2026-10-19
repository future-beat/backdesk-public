/**
 * WHAT WAS OBSERVED WORKING, ON PRODUCTION, WITH AN ARTEFACT TO SHOW FOR IT.
 * EVIDENCE — APPEND-ONLY (D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ AN ATTESTATION IS "A HUMAN LOOKED AND SAYS SO". A PROOF IS "THE SYSTEM   │
 * │ DID IT, AND HERE IS THE ROW THAT PROVES IT". They are different claims,  │
 * │ and only the second one can be checked by somebody who was not there.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `tenant_attestations` is the sibling table and the reason this one is not
 * simply two more of its kinds. An attestation carries a NOTE — a sentence a
 * named human typed about what they saw. A proof carries an ARTEFACT ID: the
 * escalation row's id and its provider message id (CON-03), the Resend message
 * id whose `last_event` is `delivered` (MSG-02/DOM-04). The artefact is the
 * claim; the note is commentary on it.
 *
 * Two facts had to be facts of the DATABASE rather than of the form, and that
 * is what bought a new table rather than two new `kind` values:
 *
 *   NO PROOF WITHOUT AN ARTEFACT ID — `artefact_id` is NOT NULL with a length
 *     CHECK. `tenant_attestations.note` is the only required column over there,
 *     so a proof stored as an attestation would be one Enter key away from
 *     "yeah, saw it work" with nothing to re-check. The whole point of the two
 *     live proofs deferred since v1.0 is that somebody can go and look the
 *     artefact up months later.
 *   WHO RECORDED IT — `recorded_by` is NOT NULL and holds the operator's
 *     Supabase user id from the allowlist read. Attestations predate the
 *     operator-id read (`requireOperatorId`) and carry no such column.
 *
 * ── THE EVIDENCE-FAMILY RULES, VERBATIM (tenant-attestations.ts) ─────────────
 *
 * No FK on `tenant_id` and no cascade: a client who disconnects must not take
 * the record of what we proved on their behalf with them — that record is the
 * answer to "did this ever actually work" long after they leave. APPEND-ONLY:
 * re-proving is a NEW ROW, latest wins, and there is no update or delete path
 * in the repository or in the grants (0036). `recorded_at` is SERVER-SET, never
 * submitted — a proof whose date somebody could type is a date, not a proof.
 * RLS is authored here as a `pgPolicy` so the table cannot ship unprotected by
 * omission, and `authenticated` gets SELECT only: the proof form is a server
 * action writing through the service-role repository, like every other control.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * What can be proven. CHECK-constrained from the first member, following the
 * house rule: the writer is a service-role action and the TypeScript union
 * erases before the INSERT is built, so `'email_pipe'` would insert cleanly,
 * satisfy no read, and leave the client showing "not proven" forever with the
 * proof sitting in the table.
 *
 *  escalation_handset_proof — CON-03: a real hot-lead reply produced an
 *    escalation SMS that arrived on the tradie's (or, recorded as such, the
 *    operator's) handset. Artefact: the escalation row id + provider message id.
 *  email_pipe_proof — MSG-02/DOM-04: a cadence email left the tenant's verified
 *    identity and was delivered. Artefact: the Resend message id whose
 *    `last_event` is `delivered`.
 *  divert_verification_call — CAP-05/D-09 (Phase 11): the founder's own test
 *    call to the client's line was diverted to their Backdesk number, answered
 *    with the greeting, and landed as a completed `missed_calls` row. Artefact:
 *    that row's `missed_calls.id`. Phase 12's text-back gate reads it; widened
 *    in migration 0038 (drop-if-exists, then add).
 *  text_back_proof — TXT-05/D-13 (Phase 12): a real text-back was DELIVERED to
 *    a caller for an armed client. Artefact: the `missed_calls.id` of that
 *    call, whose text-back row and ledger row carry the delivery receipt.
 *    Widened in migration 0039. Spelled with the `_proof` suffix of its
 *    siblings: `text_back` alone is the CHANNEL, and stays refused as a kind.
 */
export const TENANT_PROOF_KINDS = [
  'escalation_handset_proof',
  'email_pipe_proof',
  'divert_verification_call',
  'text_back_proof',
] as const;
export type TenantProofKind = (typeof TENANT_PROOF_KINDS)[number];

export const tenantProofs = pgTable(
  'tenant_proofs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),

    /** One of TENANT_PROOF_KINDS. CHECK-constrained below. */
    kind: text('kind').notNull(),

    /**
     * THE OBSERVABLE THE CLAIM RESTS ON — an escalation row id, a provider
     * message id, a Resend message id.
     *
     * REQUIRED, and the length CHECK below is what makes it more than a
     * NOT NULL: `'x'` satisfies a NOT NULL and proves nothing. Every id this
     * column is meant to hold is at least a short opaque token; the floor of
     * eight characters refuses the placeholder without pretending to know which
     * provider's id format arrives.
     */
    artefactId: text('artefact_id').notNull(),

    /**
     * The rest of the artefact, as read from the system that produced it —
     * outcome codes, `last_event`, a provider id beside a row id.
     *
     * JSONB with a `{}` default rather than columns, because the shape differs
     * per kind and inventing an `escalation_outcome` column that is null for
     * every email proof is how a table starts describing its writers instead of
     * its rows. NEVER a customer's address or a message body: this is the same
     * evidence family as `escalations`, ids and outcomes only.
     */
    artefactDetail: jsonb('artefact_detail').notNull().default({}).$type<Record<string, unknown>>(),

    /** What the operator saw, in their own words. REQUIRED, NO DEFAULT. */
    note: text('note').notNull(),

    /** The operator's Supabase user id, from `requireOperatorId()`. */
    recordedBy: uuid('recorded_by').notNull(),

    /** WHEN the proof was recorded — SERVER-SET, never submitted. */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE LATEST-WINS READ, the same shape `tenant_attestations_latest_idx`
     * carries: the checklist asks "has this ever been proven, and when" as one
     * indexed lookup rather than a scan of a client's whole proof history.
     */
    index('tenant_proofs_latest_idx').on(table.tenantId, table.kind, sql`${table.recordedAt} DESC`),

    check(
      'tenant_proofs_kind_known',
      sql`kind IN ('escalation_handset_proof', 'email_pipe_proof', 'divert_verification_call', 'text_back_proof')`,
    ),

    check('tenant_proofs_artefact_present', sql`length(artefact_id) BETWEEN 8 AND 128`),

    pgPolicy('tenant_proofs_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TenantProof = typeof tenantProofs.$inferSelect;
export type NewTenantProof = typeof tenantProofs.$inferInsert;
