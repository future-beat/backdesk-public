/**
 * "Never chase this person again." Insert-only, by design (D-06/D-15).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THERE IS NO UPDATE PATH AND NO DELETE PATH, AND NEITHER MAY EVER SHIP.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This is the Spam Act safety mechanism. A row lands here because a human
 * complained, asked to be left alone, or the tradie said "do not contact this
 * customer" — and D-06 records the per-contact kill as ONE-WAY BY DESIGN:
 * making it reversible invites resuming someone who complained, which is the
 * single failure this product cannot recover from commercially or legally.
 *
 * The irreversibility is enforced at THREE layers, deliberately, because a
 * convention is not a control:
 *
 *   1. This header, so nobody adds an `unsuppress()` by accident.
 *   2. The repository namespace, which exposes `insertMany` / `existsFor` /
 *      `listAll` and no mutator at all.
 *   3. `0017_cadence_grants_and_constraints.sql`, which grants `authenticated`
 *      SELECT and NOTHING ELSE. Un-suppressing a complained contact is not
 *      merely undocumented from the console role — it is structurally
 *      impossible (threat T-3-02).
 *
 * ── KEYED ON THE ADDRESS, NEVER ON A CONTACT UUID (D-15, and this is the      ─
 *    reason the table exists at all rather than a flag on quote_contacts) ────
 *
 * `quote_contacts` rows are PER-JOB MIRRORS: the same human appears as a brand
 * new row, with a brand new `sm8_contact_uuid`, on every new job the tradie
 * creates. Suppressing by contact uuid would therefore stop the cadence on the
 * job they complained about and cheerfully start a fresh one the next time that
 * customer asked for a quote — which is exactly the behaviour the complaint was
 * about. D-15 states the requirement directly: "A suppressed contact must block
 * cadences on NEW quotes too, not just stop existing ones."
 *
 * So the key is `(tenant_id, channel, address)` where `address` is the
 * NORMALIZED channel address (`+614…` for sms, trimmed-lowercase for email).
 * Normalization is not cosmetic here: `0400 123 456`, `0400123456` and
 * `+61400123456` are one human, and a suppression that only matches one
 * spelling of their number does not suppress them.
 *
 * ── BOTH CHANNELS, ONE HUMAN ────────────────────────────────────────────────
 *
 * A per-contact kill writes BOTH the mobile and the email of the cadence's
 * primary contact. One person asked not to be contacted; honouring that on SMS
 * while emailing them anyway is not compliance, it is a loophole.
 *
 * ── SCOPED PER TENANT, NOT GLOBAL ───────────────────────────────────────────
 *
 * Suppression is a relationship between one tradie and one of their customers.
 * A customer who told Plumber A to stop has said nothing about Electrician B,
 * and a global list would leak the fact of the complaint across clients.
 *
 * NO CASCADE from `tenants`: a client who disconnects must not take their
 * suppression list with them. If they ever reconnect — or if the same customer
 * appears again — "never chase again" still means never.
 */
import { sql } from 'drizzle-orm';
import {
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The channels an address can be suppressed on. Deliberately the same two
 * values as `TOUCH_CHANNELS` — a channel the engine can send on but cannot
 * suppress on would be a hole in the guarantee above.
 */
export const SUPPRESSION_CHANNELS = ['sms', 'email'] as const;
export type SuppressionChannel = (typeof SUPPRESSION_CHANNELS)[number];

export const suppressedContacts = pgTable(
  'suppressed_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),

    /** One of SUPPRESSION_CHANNELS. */
    channel: text('channel').notNull(),
    /** NORMALIZED. `+614…` for sms; trimmed and lowercased for email. */
    address: text('address').notNull(),

    /**
     * Free text, on purpose. A closed vocabulary here would eventually force a
     * real reason into a bucket that does not fit, and unlike `status` columns
     * nothing branches on this value — it exists to be READ by a human who is
     * deciding whether the suppression was justified.
     */
    reason: text('reason').notNull(),
    /**
     * Which mechanism wrote the row: `'operator_kill'` today, `'sms_stop'` when
     * Phase 4's deterministic STOP handling becomes the second writer. Recorded
     * because "the customer texted STOP" and "the tradie asked us to stop" are
     * different facts with different evidentiary weight.
     */
    source: text('source').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * The lookup dispatch performs on every send, and the idempotence key that
     * lets a second kill on the same contact be a no-op instead of an error.
     */
    uniqueIndex('suppressed_contacts_tenant_channel_address_uniq').on(
      table.tenantId,
      table.channel,
      table.address,
    ),
    pgPolicy('suppressed_contacts_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type SuppressedContact = typeof suppressedContacts.$inferSelect;
export type NewSuppressedContact = typeof suppressedContacts.$inferInsert;
