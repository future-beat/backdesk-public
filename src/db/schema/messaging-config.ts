/**
 * Which provider identity each channel sends as, per client. CONFIGURATION —
 * and the switch that turns real sending on (D-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ACTIVATION IS A ROW FLIP, NOT A DEPLOY.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `buildRoutingSender()` (src/core/messaging/routing-sender.ts) reads this table
 * once per tick. With no row, or a row with `enabled = false`, or a row with no
 * `from_address`, the sms delegate is `StubSender` and production behaves
 * EXACTLY as it did in Phase 3 — same ledger `sender = 'stub'`, same
 * `outcome = 'stub_sent'`. Setting `enabled = true` on a row that carries a
 * from-address is the entire activation, and the NEXT tick picks it up.
 *
 * That property is the reason this is a table rather than an environment
 * variable, and it is worth stating why an env var was rejected rather than
 * merely not chosen. The ClickSend dedicated AU number is blocked on an
 * IPND-acceptable business address (see STATE.md) — a paperwork dependency with
 * no engineering answer and no predictable date. Everything in Phase 4 is
 * therefore built and tested WITHOUT it, and the moment it lands somebody has to
 * turn sending on for one client at a time, watch it, and be able to turn it off
 * in seconds. An env var makes each of those a redeploy: the activation script
 * (04-07), the console action (04-06) and per-client provisioning would all have
 * to become deployment steps, and "turn it off now" would become "wait for a
 * build". Walking this back later re-binds all three — rated COSTLY, decided
 * once, here.
 *
 * ── NULLABLE `tenant_id` IS THE KEYING, NOT AN OVERSIGHT ────────────────────
 *
 * `tenant_id IS NULL` is THE GLOBAL DEFAULT ROW. v1 sends every client's SMS
 * from ONE dedicated AU virtual number (CLAUDE.md: alpha tags cannot receive
 * replies, and replies drive the whole product), so there is exactly one sms
 * identity and it belongs to nobody in particular. v2 gives clients whose
 * customers overlap their own numbers, which is a per-tenant row — and the
 * lookup order (`getChannelConfig`) already asks for the tenant row first and
 * falls back to the global one, so that migration is inserting rows rather than
 * changing code.
 *
 * The unique index is `(channel, tenant_id) NULLS NOT DISTINCT`. Postgres 15+
 * treats NULLs as distinct by DEFAULT, which would permit any number of
 * "global" sms rows — and the fallback read would then return whichever one the
 * planner felt like, i.e. this system would send from an arbitrary one of two
 * numbers with no error anywhere. `NULLS NOT DISTINCT` makes "exactly one global
 * row per channel" a fact Postgres enforces rather than a convention the
 * upsert's ON CONFLICT clause assumes.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * NO CREDENTIALS. `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` stay in the
 * environment (see env.ts). This table is readable by `authenticated` under the
 * policy below so the console can render it; a secret in a console-readable row
 * is a secret in a browser (T-4-10). What lives here is IDENTITY — which number,
 * which from-address, which reply-to, whose business name — all of which appear
 * in the message a customer receives anyway.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The text-back switch's channel value (Phase 12, D-09). Declared before
 * `MESSAGING_CHANNELS` because the vocabulary below names it.
 *
 * `text_back` is the per-client switch for the missed-call text-back. It is not
 * a sending identity — a text-back leaves from the shared SMS number through
 * `resolveSmsFrom` — so a `text_back` row is only ever an on/off flag for ONE
 * tenant: `messaging_config_text_back_per_tenant` refuses a global one.
 */
export const TEXT_BACK_CHANNEL = 'text_back' as const;

/**
 * The channels an operator can ARM: the two sending channels, plus the
 * per-client text-back switch (Phase 12, 12-08, D-09).
 *
 * `sms` and `email` carry an identity — which number, which from-address.
 * `text_back` carries none: it is an arming switch with no identity of its own,
 * and it is listed here because every arming surface (`armChannel`, the
 * console action's schema, `ARMING_GATES`, the refusal and receipt sentences)
 * is typed by this tuple — widening it is what made the compiler name every
 * map that needed a text-back entry. `TouchChannel` is a SEPARATE type and is
 * not widened: nothing can route a touch on `text_back`.
 *
 * CHECK-constrained below rather than merely typed, for the reason every other
 * vocabulary in this schema is: the writer is service-role code and the union
 * erases before the INSERT is built, so a typo produces a row that no
 * `channel = 'sms'` predicate ever matches — a configuration that is present in
 * the table and invisible to the code that reads it, which reads as "not
 * configured" and falls back to the stub. The failure mode of a typo here is
 * "the operator turned sending on and nothing sent", with no error anywhere.
 *
 * PER-CLIENT ONLY FOR `text_back`, three times over: the console action refuses
 * the `everyone` target, `armChannel` / `disarmChannel` refuse a null tenant
 * (`per_tenant_only`), and the CHECK `messaging_config_text_back_per_tenant`
 * refuses the row.
 */
export const MESSAGING_CHANNELS = ['sms', 'email', TEXT_BACK_CHANNEL] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export const messagingConfig = pgTable(
  'messaging_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * NULL MEANS THE GLOBAL DEFAULT ROW — see the header. No FK and no cascade,
     * following the evidence-table family: a client who disconnects and
     * reconnects should not silently come back with a different sending
     * identity than the one their customers have been replying to.
     */
    tenantId: uuid('tenant_id'),

    /** One of MESSAGING_CHANNELS. CHECK-constrained below. */
    channel: text('channel').notNull(),

    /**
     * WHO THE MESSAGE COMES FROM, in the channel's own address space.
     *
     *  sms   — the dedicated AU virtual number in E.164 (`+614…`). NOT an
     *          alphanumeric sender ID: those cannot receive replies, and replies
     *          are what drive classification, pause-on-reply and opt-out
     *          (CLAUDE.md, ACMA Sender ID Register).
     *  email — the verified-domain from address (plan 04-05).
     *
     * NULLABLE, and null is a MEANINGFUL state rather than an unset one: a row
     * can exist, carrying a business name and an enabled flag, before the number
     * has been provisioned. `buildRoutingSender` treats null as "not configured"
     * and stays on the stub, which is why the IPND block does not stop the row
     * from being created and reviewed ahead of time.
     */
    fromAddress: text('from_address'),

    /**
     * EMAIL ONLY (D-01): the tradie's own address, so a customer who hits reply
     * reaches the tradie rather than us. Meaningless for sms — a virtual number
     * receives its own replies, which is the reason it is a number.
     */
    replyTo: text('reply_to'),

    /**
     * The business name that identifies the sender in the message body — the
     * Spam Act sender-identification requirement, met in COPY because the
     * channel is a shared virtual number rather than a per-client alpha tag.
     *
     * An OVERRIDE. Consumers fall back to `tenants.name`, which is the name the
     * operator typed when onboarding; this column exists for the case where the
     * trading name a customer would recognise is not the entity name in our
     * tenants row. A wrong value here is a message that identifies the wrong
     * business, so it is null (fall back) rather than '' (identify as nobody).
     */
    businessName: text('business_name'),

    /**
     * THE SWITCH. `false` by default, deliberately: a row that appears through a
     * migration, a seed or a console form must not start messaging customers by
     * existing. Turning it on is a separate, deliberate write.
     */
    enabled: boolean('enabled').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * EXACTLY ONE ROW PER (channel, tenant) — INCLUDING the global row. See the
     * header for why `NULLS NOT DISTINCT` is load-bearing rather than tidy.
     *
     * A UNIQUE CONSTRAINT rather than a `uniqueIndex()`, because in drizzle-orm
     * 0.45.2 `nullsNotDistinct()` exists only on the constraint builder — the
     * index builder has no such method and calling it is a TypeError at
     * `db:generate` time. The two are the same object underneath: Postgres
     * implements a UNIQUE constraint AS a unique index, so
     * `ON CONFLICT (channel, tenant_id)` infers this arbiter exactly as it would
     * a bare index. Naming an arbiter is safe HERE, unlike `cadences.create`
     * (see cadences.ts), for the reason that made it unsafe there: this table
     * has exactly ONE unique index, so there is no second constraint a conflict
     * could land on and be re-raised as a 23505.
     */
    unique('messaging_config_channel_tenant_uniq')
      .on(table.channel, table.tenantId)
      .nullsNotDistinct(),

    check('messaging_config_channel_known', sql`channel IN ('sms', 'email', 'text_back')`),
    /** Text-back is per client only: there is no global text-back row (D-09). */
    check(
      'messaging_config_text_back_per_tenant',
      sql`channel <> 'text_back' OR tenant_id IS NOT NULL`,
    ),

    /**
     * THE SAME TWO ARMS `inbound_messages` CARRIES, for the same reason (T-4-04).
     *
     * A tenant-scoped row is visible to that tenant's members. The GLOBAL row
     * (`tenant_id IS NULL`) belongs to nobody, so `has_tenant_access(NULL)` can
     * never admit it — without the `is_operator()` arm the row that decides
     * whether anything sends at all would be invisible to every human.
     *
     * `is_operator()` reads an explicit allowlist (operators.ts), NOT
     * "belongs to some tenant", so a v2 client login can never read the global
     * identity or another client's.
     */
    pgPolicy('messaging_config_member_or_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
      withCheck: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
    }),
  ],
);

export type MessagingConfigRow = typeof messagingConfig.$inferSelect;
export type NewMessagingConfigRow = typeof messagingConfig.$inferInsert;
