/**
 * One row per tenant — the cadence engine's per-client knobs (D-03, D-06).
 *
 * WHY A SEPARATE TABLE RATHER THAN WIDER `tenants`. Two reasons, and the second
 * is the load-bearing one:
 *
 *  1. `tenants` is the onboarding record — who the client is, when we may
 *     contact their customers, which zone they live in. Those columns are read
 *     by the console, the audit path and the sync worker. Send-time preferences
 *     are read by exactly one subsystem.
 *  2. Phase 5 hangs per-tenant DRAFTING configuration (voice guide, template
 *     block, model preferences) off this same row. Putting that on `tenants`
 *     would mean every `SELECT * FROM tenants` in the console starts dragging a
 *     prompt prefix around, and the D-06 pause below would sit next to the
 *     UNRELATED `sm8_connections.paused_at`, inviting exactly the confusion
 *     that field's header warns about.
 *
 * THE TWO PAUSES ARE NOT THE SAME PAUSE, AND MUST NEVER BE CONFLATED:
 *
 *   `cadence_settings.paused_at`   — D-06. The operator (or the client, via the
 *                                    operator) said "stop messaging my customers
 *                                    for now". A DELIBERATE, REVERSIBLE choice.
 *                                    Sync keeps running; the mirror stays fresh.
 *   `sm8_connections.paused_at`    — D-06/D-08 of Phase 2. The ServiceM8 key
 *                                    stopped working, so we no longer TRUST what
 *                                    we know about this client's quotes. Sending
 *                                    from stale state is the failure mode.
 *
 * Both stop dispatch. They are cleared by different events (an operator resume
 * versus a successful re-key), and a resume of one must never lift the other.
 * The dispatch gate checks both, separately, on purpose.
 *
 * NO DEFAULT CONTACT WINDOW EXISTS ANYWHERE, and that rule (Phase 1) is why
 * `preferred_send_time` is a preference rather than a window: it is CLAMPED
 * into `tenants.contact_hours_start/end`, which the operator had to state
 * explicitly. A preferred time outside the client's own contact window is
 * resolved by the window, never by this column.
 */
import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { tenants } from './tenants';

export const cadenceSettings = pgTable(
  'cadence_settings',
  {
    /**
     * PRIMARY KEY, so "one row per tenant" is a database fact rather than a
     * convention two code paths have to remember. `ensure()` upserts against it.
     *
     * Cascades: like the touch templates this is configuration, not attribution
     * evidence — a disconnected client's preferred send time is worth nothing.
     */
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * D-03. Wall-clock LOCAL time in `tenants.timezone`, never an instant — the
     * driver hands this back as an `'HH:MM:SS'` STRING, which is correct and is
     * the reason materialization parses it to minutes-since-midnight rather
     * than constructing a Date from it.
     */
    preferredSendTime: time('preferred_send_time').notNull().default('09:30'),

    // --- The voice profile (D-05, Phase 5) ------------------------------------
    //
    // The header above predicted these columns would land here, and here they
    // are. EVERY ONE IS NULLABLE, and that is deliberate rather than lazy: this
    // is the drafting prompt's stable prefix, and a DEFAULT would be this
    // service inventing a tradie's voice on their behalf. A tenant with no voice
    // profile drafts from the approved template and the quote facts alone —
    // thinner, and honestly thinner, rather than confidently wrong in somebody
    // else's register.
    //
    // They sit on this row rather than on `tenants` for reason 2 in the header:
    // a prompt prefix must not ride along on every `SELECT * FROM tenants` the
    // console performs.

    /** e.g. 'Hi {first name}' vs 'Hey mate' — how this tradie opens. */
    greetingStyle: text('greeting_style'),
    /** How they close. Distinct from the compliance suffix, which is not theirs. */
    signOff: text('sign_off'),
    /** e.g. 'casual', 'plain', 'formal'. Free text: it feeds a prompt, not a switch. */
    formality: text('formality'),
    /**
     * Words this client will not have said in their name. Fed to the prompt as
     * a prohibition — NOT enforced by the validator, which polices FACTS (prices,
     * dates, names) rather than taste. A banned phrase surviving into a draft is
     * something the operator catches at the D-12 review gate; an invented price
     * is something no human should have to catch.
     */
    bannedPhrases: text('banned_phrases').array(),
    /**
     * Real messages this tradie has sent, as few-shot voice examples. The single
     * highest-signal field here — a register is easier to show than to describe,
     * and this is what the onboarding conversation actually collects.
     */
    exampleMessages: text('example_messages').array(),
    /** Anything the operator needs the model to know that has no column. */
    voiceNotes: text('voice_notes'),

    /** D-06 — the reversible, per-client "stop messaging". See the header. */
    pausedAt: timestamp('paused_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('cadence_settings_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type CadenceSettings = typeof cadenceSettings.$inferSelect;
export type NewCadenceSettings = typeof cadenceSettings.$inferInsert;
