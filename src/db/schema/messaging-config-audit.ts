/**
 * WHO ARMED SENDING, WHEN, AND WHY. EVIDENCE — APPEND-ONLY (D-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `messaging_config` IS THE SWITCH; THIS TABLE IS THE RECORD OF HANDS ON   │
 * │ IT. The config row answers "is sending on right now" and nothing else —  │
 * │ it is an UPSERT target, so every flip overwrites the last one. Arming is │
 * │ the highest-consequence act in the product (real customer messages, for  │
 * │ every connected client, on the next tick, with no deploy), and "who      │
 * │ turned this on, and what did they say about it" must survive the next    │
 * │ flip. It cannot live in a column that the next write replaces.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WRITTEN IN THE SAME TRANSACTION AS THE FLIP, ALWAYS ──────────────────────
 *
 * `armChannel` / `disarmChannel` (src/db/repository/messaging-config.ts) open
 * ONE transaction and write the config row and the row here inside it. Two
 * separate awaits would leave a window — a crash, a pool timeout, a deploy —
 * in which production is armed and no row explains it, which is precisely the
 * state this table exists to make impossible. There is no accessor anywhere
 * that writes one without the other.
 *
 * ── `tenant_id IS NULL` MEANS THE SHARED ROW, EXACTLY AS IT DOES NEXT DOOR ──
 *
 * Same keying as `messaging_config` (see its header): NULL is the GLOBAL sms
 * identity every founding client shares, not a missing value. An audit row with
 * `tenant_id = NULL` therefore reads "somebody armed SMS for everybody", and
 * the console says so in those words between the two taps of the confirm.
 *
 * ── THE EVIDENCE-FAMILY RULES, VERBATIM (tenant-attestations.ts) ─────────────
 *
 * No FK on `tenant_id` and no cascade: a client who disconnects must not take
 * the record of what we armed on their behalf with them. APPEND-ONLY — there is
 * no UPDATE and no DELETE accessor in the repository, and the grants (0036)
 * give `authenticated` SELECT alone. Timestamps are the server's. RLS is
 * authored here as a `pgPolicy` so the table cannot ship unprotected by
 * omission.
 *
 * ── `reason` IS REQUIRED ON A DISARM AND OPTIONAL ON AN ARM ──────────────────
 *
 * Deliberately asymmetric, and the CHECK below enforces it rather than the form
 * alone. An arm is explained by the thing it turns on — the checklist that
 * gated it is the record of why it was allowed. A DISARM is the interesting
 * event: something went wrong, or somebody decided it had, and the sentence
 * typed at that moment is the only place that judgement is ever written down.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

// The channel vocabulary is IMPORTED, never re-spelled: two spellings of
// `['sms','email']` is how an audit table ends up accepting a channel the
// config table refuses (or the reverse), and the row that records the arming of
// a channel nobody can send on is worse than no row. Imported rather than
// re-exported, because `schema/index.ts` star-exports both files and a second
// path to one binding is a name every reader has to disambiguate.
import type { MessagingChannel } from './messaging-config';

/**
 * What can happen to the switch. CHECK-constrained below for the same reason
 * every vocabulary in this schema is: the writer is service-role code and the
 * TypeScript union erases before the INSERT is built, so `'armed'` would insert
 * cleanly and match no `action = 'arm'` predicate ever again — an arming with
 * no readable record, which is this table's one failure mode.
 */
export const MESSAGING_CONFIG_AUDIT_ACTIONS = ['arm', 'disarm'] as const;
export type MessagingConfigAuditAction = (typeof MESSAGING_CONFIG_AUDIT_ACTIONS)[number];

/**
 * WHOSE HAND WAS ON THE SWITCH (Phase 12, D-21).
 *
 *  operator — a human, identified by `operator_user_id` (the allowlist read)
 *  system   — the product itself, and ONLY ever to DISARM: the low-balance
 *             auto-disarm (D-10) turns text-back off for every armed client
 *             when the ClickSend balance cannot pay for the next text. It can
 *             never arm anything, and it must say why (the disarm-reason CHECK
 *             already requires that of every disarm).
 *
 * Three CHECKs make that structural: the vocabulary, `operator_user_id` set
 * exactly when the actor is an operator, and a system row being a disarm.
 */
export const MESSAGING_CONFIG_AUDIT_ACTORS = ['operator', 'system'] as const;
export type MessagingConfigAuditActor = (typeof MESSAGING_CONFIG_AUDIT_ACTORS)[number];

export const messagingConfigAudit = pgTable(
  'messaging_config_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** One of MESSAGING_CHANNELS. CHECK-constrained below. */
    channel: text('channel').notNull(),

    /**
     * NULL MEANS THE SHARED ROW — the same meaning `messaging_config.tenant_id`
     * carries, and deliberately not a second convention. No FK, no cascade.
     */
    tenantId: uuid('tenant_id'),

    /** One of MESSAGING_CONFIG_AUDIT_ACTIONS. CHECK-constrained below. */
    action: text('action').notNull(),

    /**
     * One of MESSAGING_CONFIG_AUDIT_ACTORS. DEFAULT 'operator' so every row
     * written before migration 0039 — and every insert Phase 11 code makes
     * between the schema push and the code push — reads as what it was.
     */
    actor: text('actor').notNull().default('operator'),

    /**
     * The operator's Supabase user id, from `requireOperatorId()` — the
     * allowlist read, not a form field. Set EXACTLY when `actor = 'operator'`
     * (`messaging_config_audit_actor_identity`): an operator row with no hand on
     * it is still the row this table exists to refuse. NULL only on a SYSTEM
     * row, which can only be a disarm with a reason (D-21) — the product
     * turning text-back off because the balance ran out, never turning
     * anything on.
     */
    operatorUserId: uuid('operator_user_id'),

    /** Required on a disarm by the CHECK below; optional on an arm. */
    reason: text('reason'),

    /**
     * WHAT WAS ARMED, snapshotted — the number or the from-address as it stood
     * at the moment of the flip.
     *
     * Nullable because a disarm can target a row that never carried one. It is
     * a SNAPSHOT and not a join: the config row is an upsert target, so reading
     * "which number was armed on 11 Sep" back off it a month later answers with
     * whatever number is configured today.
     */
    fromAddress: text('from_address'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE LAST-THREE READ. `(channel, tenant_id, created_at DESC)` serves the
     * one question the client page asks — "what happened to this switch most
     * recently" — as an indexed lookup rather than a scan of the whole history.
     */
    index('messaging_config_audit_latest_idx').on(
      table.channel,
      table.tenantId,
      sql`${table.createdAt} DESC`,
    ),

    check(
      'messaging_config_audit_channel_known',
      sql`channel IN ('sms', 'email', 'text_back')`,
    ),
    /** The same rule as `messaging_config`: no global text-back (D-09). */
    check(
      'messaging_config_text_back_per_tenant',
      sql`channel <> 'text_back' OR tenant_id IS NOT NULL`,
    ),

    check('messaging_config_audit_actor_known', sql`actor IN ('operator', 'system')`),
    check(
      'messaging_config_audit_actor_identity',
      sql`(actor = 'operator') = (operator_user_id IS NOT NULL)`,
    ),
    /** The system may only ever turn something OFF (D-21). */
    check(
      'messaging_config_audit_system_disarms',
      sql`actor = 'operator' OR action = 'disarm'`,
    ),

    check('messaging_config_audit_action_known', sql`action IN ('arm', 'disarm')`),

    /**
     * A DISARM WITHOUT A REASON IS NOT A RECORD. Enforced in the database, not
     * only in the action, because the action is one caller and this row is the
     * only account anybody will ever have of why sending stopped.
     */
    check(
      'messaging_config_audit_disarm_reason',
      sql`action <> 'disarm' OR (reason IS NOT NULL AND length(reason) > 0)`,
    ),

    /**
     * THE SAME TWO ARMS `messaging_config` CARRIES, for the same reason.
     *
     * A tenant-scoped row is visible to that tenant's members. The rows about
     * the GLOBAL row belong to nobody, so `has_tenant_access(NULL)` can never
     * admit them — without the `is_operator()` arm the history of the flip that
     * arms every client at once would be invisible to every human.
     */
    pgPolicy('messaging_config_audit_member_or_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
      withCheck: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
    }),
  ],
);

export type MessagingConfigAuditRow = typeof messagingConfigAudit.$inferSelect;
export type NewMessagingConfigAuditRow = typeof messagingConfigAudit.$inferInsert;

/**
 * An audit row as a WRITER supplies it, with both vocabularies narrowed from
 * the schema's `string`.
 *
 * The CHECKs would catch a typo, but they would catch it as a 23514 raised from
 * inside the transaction that was arming production — the same argument
 * `MessagingConfigUpsert` makes one file over, and the reason the narrowing
 * lives beside the table rather than in each caller.
 */
export type NewMessagingConfigAudit = Omit<
  NewMessagingConfigAuditRow,
  'id' | 'createdAt' | 'channel' | 'action'
> & { channel: MessagingChannel; action: MessagingConfigAuditAction };
