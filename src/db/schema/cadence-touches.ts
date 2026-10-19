/**
 * The materialized schedule — one row per touch, per cadence (CAD-02).
 *
 * ── MATERIALIZED, NOT COMPUTED (the whole point of this table) ──────────────
 *
 * `scheduled_at` is a STORED INSTANT decided once, at materialization, and
 * never recomputed on read. Every alternative — deriving send times from the
 * anchor plus template offsets at dispatch time — makes the schedule a moving
 * target: the jitter would be redrawn on every tick (so a touch would never
 * actually be "due"), a template edit would silently reshape a live cadence,
 * and nothing could ever be shown to an operator ahead of time as a fact.
 *
 * So the touch row is a DECISION ALREADY MADE. Dispatch VALIDATES it; dispatch
 * never CHOOSES it. The one path that writes a new time is the D-07/D-09
 * re-window pass, and it writes the new instant here for the same reason.
 *
 * `original_offset_days` is kept alongside because D-07 promises that a resumed
 * cadence keeps its RELATIVE GAPS: "next touch at the next allowed slot,
 * remaining touches follow at their original relative gaps". After a re-window
 * the stored `scheduled_at` no longer tells you what the gap was supposed to
 * be — this column does, and it is never rewritten.
 *
 * ── THE FULL LIFECYCLE SHIPS NOW, WITH TWO GATES STUBBED (D-14) ────────────
 *
 * `needs_draft` and `pending_approval` exist in this vocabulary from day one
 * even though Phase 3 auto-passes straight through them, because D-14 is a
 * ONE-WAY decision: the state names are the contract Phases 5 (drafting) and 6
 * (approval console) build on, and adding them later means migrating live
 * cadences under running schedules and rewriting the CAD-03 test suite. Phases
 * 5/6 replace `promoteDue`'s single statement with real gates; they do not
 * reshape the machine.
 *
 * ── UNIQUE (cadence_id, touch_number) ───────────────────────────────────────
 *
 * Materialization is triggered by an event stream where replay is legal, so it
 * must be safe to run twice. The constraint is what makes that true, and it is
 * deliberately the SAME shape as `send_ledger`'s never-twice key: the two
 * tables agree on what "a touch" is.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { cadences } from './cadences';

/**
 * D-14 verbatim. ONE-WAY: see the header.
 *
 *  scheduled        — materialized, waiting for its draft lead window
 *  needs_draft      — surfaced for drafting (Phase 5 fills this in)
 *  pending_approval — drafted, waiting for a human (Phase 6)
 *  approved         — cleared to send at `scheduled_at`
 *  sent             — a send_ledger row was claimed and the sender invoked
 *  skipped          — terminal without sending; `skip_reason` says why
 */
export const TOUCH_STATUSES = [
  'scheduled',
  'needs_draft',
  'pending_approval',
  'approved',
  'sent',
  'skipped',
] as const;
export type TouchStatus = (typeof TOUCH_STATUSES)[number];

/**
 * Why a touch was never sent. Auditable rather than merely absent — "we chose
 * not to send this, and here is the rule that decided" is a different fact from
 * "nothing happened", and Phase 7 needs to tell them apart.
 *
 *  min_gap         — D-10: the re-windowed slot landed within MIN_GAP of the
 *                    NEXT touch, so the next touch carries the conversation.
 *                    The customer never gets two texts in quick succession.
 *  stale           — D-11: more than the staleness cap past its slot. A late
 *                    touch is worse than a skipped touch.
 *  suppressed      — D-15: the recipient is on `suppressed_contacts`.
 *  quote_closed    — the quote stopped being an open, chase-eligible Quote.
 *  cadence_stopped — the cadence reached a terminal state first.
 *  cadence_expired — D-12: the cadence outlived its expiry from the anchor.
 *  no_address      — the cadence carries no address on this touch's channel, so
 *                    there is nobody to send to. Unreachable by construction
 *                    (a cadence with no usable contact is created already
 *                    stopped, and materialization picks a channel the contact
 *                    can be reached on) and therefore a corrupted row — but
 *                    RETIRED rather than left live, because a touch that stays
 *                    claimable is re-claimed and re-logged every minute for the
 *                    six weeks until D-12 expires it, starving the tenant's
 *                    batch behind it. An honest name for the rule that decided,
 *                    which is what this column is for.
 *  operator_skipped — Phase 6 D-02: a HUMAN decided this particular message
 *                    should not go out. Every other member names a RULE; this
 *                    one names a person, and that distinction is the reason it
 *                    is not folded into any of them. Phase 7 reads this column
 *                    as evidence, and "the operator judged this message wrong
 *                    for this customer" is a different fact from "the engine
 *                    retired it because it was late" — the first says something
 *                    about the drafting, the second about the schedule.
 *
 *                    TERMINAL PER TOUCH, NOT PER CADENCE. The cadence carries on
 *                    to its next touch untouched; there is no "defer", because
 *                    leaving a draft alone already leaves it in the queue where
 *                    the aging rules handle lateness honestly. The kill switch
 *                    (which DOES stop everything) stays on the quote page.
 *
 *
 * NOT HERE, AND DELIBERATELY: `window_refused`. It was in this vocabulary, in
 * the 0017 CHECK and in the console's labels, with NO WRITER anywhere — because
 * the decision this phase actually made is that dispatch refuses an
 * out-of-window send SILENTLY and leaves the touch alone (`dispatch.ts`, CAD-05
 * (c)), and the re-window pass owns moving it (`rewindow.ts` narrows its own
 * skip union to `min_gap | stale`). A CHECK vocabulary that admits a state the
 * engine cannot reach offers an operator auditing "which rule retired this
 * touch" an answer that never occurs, and tells the next contributor that
 * out-of-window touches ARE retired. Migration 0020 removed it. If a later
 * phase decides out-of-window touches should be retired, it adds the member
 * back with the writer that produces it.
 */
export const TOUCH_SKIP_REASONS = [
  'min_gap',
  'stale',
  'suppressed',
  'quote_closed',
  'cadence_stopped',
  'cadence_expired',
  'no_address',
  'operator_skipped',
] as const;
export type TouchSkipReason = (typeof TOUCH_SKIP_REASONS)[number];

export const cadenceTouches = pgTable(
  'cadence_touches',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Denormalized from the cadence, with no FK to `tenants` — this row's
     * parent has none either (attribution evidence), and carrying the tenant
     * here is what lets the RLS policy scope without a join.
     */
    tenantId: uuid('tenant_id').notNull(),

    /**
     * The one genuine reference on this table. A touch is meaningless without
     * its cadence, and `cadences` itself survives tenant deletion, so this
     * cascade destroys nothing anybody wanted to keep.
     */
    cadenceId: uuid('cadence_id')
      .notNull()
      .references(() => cadences.id, { onDelete: 'cascade' }),

    /** 1-based, matching `cadence_touch_templates.touch_number`. */
    touchNumber: smallint('touch_number').notNull(),
    /** SNAPSHOT of the template's channel — see cadence-templates.ts. */
    channel: text('channel').notNull(),

    /** One of TOUCH_STATUSES. */
    status: text('status').notNull().default('scheduled'),
    /** One of TOUCH_SKIP_REASONS, or NULL when not skipped. */
    skipReason: text('skip_reason'),

    /** The stored decision. See the header — dispatch validates, never chooses. */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),

    /**
     * D-07's relative-gap basis: the template offset this touch was built from,
     * never rewritten by a re-window. Without it a resumed cadence could only
     * reconstruct gaps from times that the resume itself had already moved.
     */
    originalOffsetDays: smallint('original_offset_days').notNull(),

    /**
     * THE DRAFTING CLAIM. NULL means "nobody is drafting this right now".
     *
     * ── WHY A COLUMN AND NOT `FOR UPDATE SKIP LOCKED` ───────────────────────
     *
     * `claimDue` claims with a row lock because dispatch's whole unit of work
     * fits inside one transaction. Drafting's does not: it makes up to two
     * Anthropic calls at `DRAFT_TIMEOUT_MS` each, so a lock-based claim would
     * hold a Postgres transaction open across two minutes of somebody else's
     * network. This column is the same claim, durable outside a transaction.
     *
     * ── WHY THE CLAIM IS NEEDED AT ALL ──────────────────────────────────────
     *
     * pg_cron fires the tick every 60s and does not wait for the response, while
     * a full drafting batch (25 touches, two 60s calls each) can run for the
     * function's whole 300s budget. Overlapping ticks are the documented worst
     * case, not a hypothetical — and an unclaimed queue read means both ticks
     * draft the same touch: two paid Sonnet calls, and two `touch_drafts` rows
     * that raced for the same `attempt` number.
     *
     * ── IT IS RELEASED, NOT WAITED OUT ──────────────────────────────────────
     *
     * The drafting pass sets this on the touches it takes and clears it on every
     * path that leaves the touch in `needs_draft`, so an ordinary failure is
     * retried by the very next tick exactly as it was before the claim existed.
     * The staleness window in `claimForDrafting` is therefore crash recovery
     * only: it is what releases a claim held by a function that was killed
     * mid-batch, and nothing in normal operation should ever reach it.
     */
    draftingStartedAt: timestamp('drafting_started_at', { withTimezone: true }),

    /**
     * How many times the drafting API refused this touch DETERMINISTICALLY —
     * a 400, 401 or 403, which produced no model output to record.
     *
     * ── WHY THE ATTEMPT LEDGER CANNOT COUNT THIS ────────────────────────────
     *
     * `MAX_DRAFT_ATTEMPTS` is read from `touch_drafts`, which is evidence of
     * what the model WROTE. A 400 produced nothing to be evidence of, so no row
     * is written and that ceiling never moves — a touch whose job description
     * makes every request a 400 accumulates zero recorded attempts and is
     * re-attempted twice a minute until D-12 expires the cadence six weeks
     * later. This column is the terminator for the case the ledger cannot see.
     *
     * The classification pass reached the same conclusion for the identical
     * situation and says why (`inbound_messages.classify_attempts`): the pass
     * cannot tell a deployment-wide 400 from one unusual input, and only a
     * counter makes the second case terminate.
     *
     * A touch at the cap is NOT retired and is NOT an error — it simply stops
     * being offered by `listNeedsDraft`. Whether a follow-up this late should
     * still go out is the cadence engine's decision (D-10/D-11), not the
     * drafter's.
     */
    draftFailures: smallint('draft_failures').notNull().default(0),

    /**
     * WHEN THE OPERATOR WAS TOLD THIS TOUCH IS STALLING (CON-04, D-11).
     *
     * NULL means "no alert has been sent for this touch". The sibling this is
     * modelled on is `sm8_connections.alerted_at`, and it is the same mechanism
     * for the same reason: the alert policy runs on a per-minute tick, so
     * WITHOUT a dedupe column an operator gets one email every sixty seconds for
     * as long as the touch stays stalled — which is not an escalating signal, it
     * is trained blindness, and the first casualty is the alert that mattered.
     *
     * ONE ALERT PER TOUCH PER THRESHOLD CROSSING (D-11). Anything still stalled
     * afterwards rolls into the daily digest; the queue's own count badge is the
     * persistent signal. Written ONLY by the tick's guarded UPDATE — the same
     * shape as `alerted_at`, so a second tick racing the first flips zero rows
     * rather than sending a second email.
     *
     * Deliberately NOT a boolean: "we alerted" and "we alerted at 06:12" answer
     * different questions, and the second is the one an operator asks when they
     * are trying to work out whether the email arrived before or after they
     * looked at the queue.
     */
    stallAlertedAt: timestamp('stall_alerted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cadence_touches_cadence_touch_uniq').on(
      table.cadenceId,
      table.touchNumber,
    ),

    /**
     * The tick's due-scan. A no-work tick must be one indexed lookup rather
     * than a scan of every touch ever materialized — the cadence tick runs
     * every minute, and most minutes have nothing to do.
     */
    index('cadence_touches_due_idx').on(table.status, table.scheduledAt),

    pgPolicy('cadence_touches_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type CadenceTouch = typeof cadenceTouches.$inferSelect;
export type NewCadenceTouch = typeof cadenceTouches.$inferInsert;
