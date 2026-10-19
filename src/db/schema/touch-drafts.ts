/**
 * Every message the model wrote, and what happened to it. EVIDENCE (AI-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE ROW PER GENERATION ATTEMPT. NOT ONE ROW PER TOUCH.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A touch that took three tries to pass the validator has three rows here, and
 * that is the whole point. AI-04 asks what the model actually produced, how
 * often it had to be regenerated, and how much an operator changed before
 * approving — none of which survives a table that overwrites the previous
 * attempt. `attempt` numbers them; the two token columns price them.
 *
 * The `edit_distance` column is the one that pays for the rest. It is NULL until
 * approval and 0 when an operator approved the draft unchanged, so the fleet-wide
 * question "is the model writing in this tradie's voice yet" has a numeric answer
 * rather than a recollection. That number is the evidence V2-01 (graduated
 * autonomy) is gated on: nothing may relax the D-12 full-review gate on a hunch,
 * and this column is what a hunch would be replaced by.
 *
 * ── NO FOREIGN KEY TO ANYTHING, THE EVIDENCE-FAMILY RULE ────────────────────
 *
 * `tenant_id`, `cadence_id`, `quote_id` and `touch_id` are all denormalized and
 * NONE of them reference. Same rule as quote-events.ts, send-ledger.ts,
 * suppressed-contacts.ts and inbound-messages.ts: a client who disconnects must
 * not take with them the record of what was written in their name, and a draft
 * outlives the touch it was written for. `touch_id` is notNull because a draft
 * with no touch is not a draft of anything — the absence of a REFERENCE is not
 * the absence of a value.
 *
 * ── THE UNIQUE PARTIAL INDEX IS A PRODUCT INVARIANT, NOT A TIDINESS RULE ────
 *
 * `UNIQUE (touch_id) WHERE status = 'approved'` says: AT MOST ONE APPROVED DRAFT
 * PER TOUCH, decided by Postgres. Dispatch resolves the bytes it sends by asking
 * for the approved draft of a touch (D-10); if two rows could answer, the message
 * a customer receives would be whichever the planner returned first. A second
 * approve raises 23505 at the write rather than producing a silent coin-flip at
 * the send — which is the same trade `cadences_one_live_per_job` makes, for the
 * same reason.
 *
 * ── AND `UNIQUE (touch_id, attempt)` IS THE SAME ARGUMENT ONE LEVEL DOWN ────
 *
 * `attempt` is numbered from a READ of the rows already here, so two overlapping
 * ticks can compute the same next number — the drafting pass claims its touches
 * (`cadence_touches.drafting_started_at`) precisely so they should not, and this
 * index is what makes it true rather than likely. Without it, two rows can share
 * an `attempt` and three things follow: `MAX_DRAFT_ATTEMPTS` under-counts, so the
 * Pitfall-4 ceiling is not the bound it claims to be; the same touch is drafted
 * twice at full Sonnet price; and — the expensive one — `latestForTouch` and the
 * quote page can order a tie differently, so the page renders draft A while the
 * approve action computes a different "latest" and answers "reload the page to
 * see it" forever. A tie in this column is a touch that cannot be approved
 * through the console at all, and the customer's follow-up never goes out.
 *
 * ── `generated_body` AND `final_body` ARE BOTH STORED, AND DIFFER BY LAW ─────
 *
 * `generated_body` is what the model returned. `final_body` is that text plus
 * `complianceSuffix(businessName)` — the Spam Act sender identification and
 * opt-out line — appended MECHANICALLY, never produced or paraphrased by the
 * model (D-01, D-03). Storing both is what makes the mechanical half auditable:
 * `final_body` ending with something other than the exact suffix is a visible
 * discrepancy against `generated_body` rather than an invisible one against a
 * function's output at some past moment.
 *
 * `final_body` IS FROZEN AT DRAFT TIME. Approval reads this column, dispatch
 * reads this column, and neither recomposes it. A body recomposed at send time
 * is a body an operator did not approve — the business name could have changed,
 * the suffix function could have changed, and the customer receives text nobody
 * ever read (research Pitfall 6).
 *
 * ── BODIES ARE CUSTOMER-ADJACENT: BEHIND RLS, LOGGED NOWHERE (T-2-02, T-5-03) ─
 *
 * These columns contain a real customer's name, their job, and their price. They
 * live here, under the policy below, and they may not reach a platform log, a
 * `console.error` argument, or a tick response body — counts and error class
 * names only. The distinction inbound-messages.ts draws applies unchanged: a row
 * here is readable by whoever the policy admits, while a Vercel log line is
 * readable by anyone with project access, forever, and is not deletable
 * per-customer.
 *
 * WRITES ARE SERVICE-ROLE ONLY — `authenticated` holds SELECT and nothing else
 * (migration 0028). An INSERT grant on an evidence table is a path by which the
 * record can be fabricated after the fact; a DELETE grant removes the record of
 * what was sent in a client's name. The console's approve action is a server
 * action, like every other D-16 control.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * What became of this attempt. A CLOSED VOCABULARY, CHECK-constrained below for
 * the reason migration 0017 gives about every other vocabulary here: the writer
 * is service-role code and the TypeScript union erases before the INSERT is
 * built, so a typo produces a row no `status = …` predicate ever matches — a
 * draft that is in the table and invisible to the approval screen that exists to
 * find it.
 *
 *  generated        — the model produced it and the validator passed it. The
 *                     ordinary state of a draft awaiting a human.
 *  validator_failed — the model produced it and the MECHANICAL validator refused
 *                     it (a price it invented, a body too long, a character that
 *                     is not GSM-7). Recorded rather than discarded: `validator_
 *                     failures` is how a prompt regression is diagnosed, and a
 *                     refusal nobody can see looks identical to a model that was
 *                     never called.
 *  superseded       — a later attempt replaced it. Kept, because the attempt
 *                     count is the AI-04 measurement.
 *  approved         — a human read it and accepted it. THE ONLY STATUS DISPATCH
 *                     WILL SEND, and at most one per touch (see the index).
 */
export const DRAFT_STATUSES = [
  'generated',
  'validator_failed',
  'superseded',
  'approved',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const touchDrafts = pgTable(
  'touch_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Denormalized, NO FK, NO cascade — the evidence rule. See the header. */
    tenantId: uuid('tenant_id').notNull(),
    cadenceId: uuid('cadence_id').notNull(),
    /** Nullable: correlation only, and a draft outlives the mirror row. */
    quoteId: uuid('quote_id'),
    /** Which touch this is a draft OF. notNull; still not a reference. */
    touchId: uuid('touch_id').notNull(),
    /** Denormalized from the touch so the approval queue needs no join. */
    touchNumber: smallint('touch_number').notNull(),

    /** 1-based attempt number for this touch. See the header. */
    attempt: smallint('attempt').notNull(),

    /**
     * The exact model id, recorded from the FIRST attempt (AI-04). Not derived
     * at read time from a constant: the constant will change, and the question
     * this column answers is which model wrote THIS text.
     */
    model: text('model').notNull(),
    /**
     * The `message_templates` row and version this was generated from. Nullable
     * only so the column can exist for a future template-free path; the drafting
     * pass refuses to draft at all without an approved template (the ONB-03
     * belt), so a NULL here on a real row is a defect, not a state.
     */
    templateId: uuid('template_id'),
    templateVersion: smallint('template_version'),
    /**
     * Which revision of the PROMPT produced this ('p1', 'p2', …). The template
     * says what to write; the prompt says how to write it, and a voice
     * regression is usually the second one changing. Both are needed to
     * reproduce a draft.
     */
    promptVersion: text('prompt_version').notNull(),

    /**
     * THE INSTANT THE WHITELIST WAS BUILT FROM — a reproduction input, in the
     * same family as `prompt_version` and `template_version`.
     *
     * ── WHY `created_at` CANNOT DO THIS JOB ─────────────────────────────────
     *
     * One merge fact is "days since the quote", floored from a clock. The
     * whitelist the model was given was built from `runCadenceTick`'s JS `now`,
     * captured at the top of the tick; `created_at` is Postgres `now()`, written
     * when the row lands — after the consume pass, the per-tenant progress
     * passes and up to two model calls. Once per day per cadence, at the anchor
     * time-of-day, those two instants fall on opposite sides of a day boundary.
     * The body then says `14` while a whitelist rebuilt from `created_at` says
     * `15`, and the approval-time re-validation refuses `unlisted_number` for a
     * figure the model was legitimately handed — with nothing on screen to
     * explain it and no edit that fixes it.
     *
     * NULLABLE for rows written before this column existed; the approve action
     * falls back to `created_at` for those, which is the behaviour they had.
     */
    mergeNow: timestamp('merge_now', { withTimezone: true }),

    /**
     * THE EXACT COMPLIANCE LINE APPENDED TO THIS DRAFT, frozen with the body.
     *
     * `complianceSuffix(tenants.name)` is derived from a MUTABLE column. After a
     * rename, an approval screen pre-filled with this row's `final_body` carries
     * the OLD suffix, while a re-derived `expectedSuffix` is the new one — so
     * submitting the pre-filled text unmodified fails `missing_suffix`. Worse,
     * `approveDraft` re-writes the stored old-suffix bytes unchanged, so the two
     * approve paths disagree about what the compliance line is.
     *
     * The same "frozen at draft time" argument `final_body` makes in the header,
     * for the half of `final_body` that is ours rather than the model's.
     *
     * NULLABLE for pre-existing rows; the approve action falls back to deriving
     * it, which is the behaviour they had.
     */
    complianceSuffix: text('compliance_suffix'),

    /** What the model returned, verbatim. See the header. */
    generatedBody: text('generated_body').notNull(),
    /** `generated_body` + the mechanical compliance suffix. FROZEN HERE. */
    finalBody: text('final_body').notNull(),

    /** One of DRAFT_STATUSES. CHECK-constrained below. */
    status: text('status').notNull(),
    /**
     * The validator's refusal reasons, for a `validator_failed` row. An ARRAY of
     * machine-readable violations rather than a sentence, because the thing
     * anybody asks of this column is "how often does rule X fire".
     */
    validatorFailures: jsonb('validator_failures'),

    /** SMS segment count as the validator measured it (D-03 caps at 2). */
    segments: smallint('segments'),
    /**
     * Normalized distance between `final_body` and what the operator actually
     * approved. NULL until approval; 0 on approve-unchanged. The V2-01 evidence
     * column — see the header.
     */
    editDistance: numeric('edit_distance'),

    /** Usage counters, straight off the API response. Priced per attempt. */
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadInputTokens: integer('cache_read_input_tokens'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set by the approve write, with `status` — the only path to 'approved'. */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
  },
  (table) => [
    /** The approval queue and the attempt history both read by touch. */
    index('touch_drafts_touch_idx').on(table.touchId),

    /**
     * AT MOST ONE APPROVED DRAFT PER TOUCH — the product invariant, enforced by
     * Postgres rather than by the two code paths that would otherwise have to
     * agree. See the header.
     */
    uniqueIndex('touch_drafts_one_approved_per_touch')
      .on(table.touchId)
      .where(sql`status = 'approved'`),

    /**
     * ONE ROW PER (TOUCH, ATTEMPT). The attempt number is derived from a read,
     * so this is the arbiter when two writers derive the same one. See header.
     */
    uniqueIndex('touch_drafts_touch_attempt_uniq').on(table.touchId, table.attempt),

    check(
      'touch_drafts_status_known',
      sql`status IN ('generated', 'validator_failed', 'superseded', 'approved')`,
    ),

    pgPolicy('touch_drafts_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TouchDraft = typeof touchDrafts.$inferSelect;
export type NewTouchDraft = typeof touchDrafts.$inferInsert;
