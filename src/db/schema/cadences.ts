/**
 * One cadence = one quote being chased, for one human, until it stops.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY `cadences_one_live_per_quote` IS A CONSTRAINT AND NOT A CHECK IN     │
 * │ CODE — the same argument sm8_connections.tenant_id makes, and it is the  │
 * │ reason this table can be driven by a replayable event stream at all.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The uniqueness constraint IS the concurrency guarantee. `quote_status_events`
 * is an append-only outbox where "REPLAY IS LEGAL … Idempotence is the
 * consumer's job" (see src/db/schema/quote-events.ts). So the consumer WILL see
 * the same `quote_opened` twice — after a crash, after a cursor rewind, after
 * two ticks overlap. A check-then-insert in the consumer is a TOCTOU by
 * construction: both readers see "no live cadence", both insert, and the
 * customer gets two parallel chase sequences for one job.
 *
 * With the partial unique index, creation is `INSERT … ON CONFLICT DO NOTHING
 * RETURNING`, and ZERO ROWS RETURNED IS A MEANINGFUL ANSWER — it says "a live
 * cadence already exists, you are the replay". The database — not application
 * code — decides that exactly one row survives.
 *
 * PARTIAL, on `status IN ('active','paused')`, because a quote may legitimately
 * have SEQUENTIAL cadences over its life: reopened → operator re-triages →
 * a fresh `quote_opened` → a new cadence. What must never exist is two LIVE
 * ones. A full unique index on `quote_id` would forbid the legal history along
 * with the illegal concurrency.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THERE ARE TWO UNIQUE INDEXES, AND WHY NEITHER SUBSUMES THE OTHER     │
 * │ (G-3-2, found by adversarial verification of Phase 3 UAT test 2)          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `cadences_one_live_per_quote` answers exactly ONE question — "may a second
 * LIVE cadence exist for this quote?" — and that is the CONCURRENCY guarantee.
 * G-3-2 proved it cannot answer the other one: "may this SAME consumed event
 * create a second cadence?", which is the REPLAY guarantee.
 *
 * The gap is real and it is reachable in production. The shared cursor in
 * `src/core/cadence/consume-events.ts` HOLDS when any tenant's run blocks, so
 * every later tick re-reads the same `quote_opened`. If the first cadence has
 * already left live state — created already-stopped as `no_contact` or
 * `contact_suppressed`, or stopped by a `won` consumed in the same held batch —
 * the partial index covers NO row, the replayed INSERT conflicts with nothing,
 * and a duplicate cadence is created EVERY TICK until the blocking tenant is
 * fixed. Duplicates pollute the counters and the table Phase 7 attributes
 * revenue from; the worst case is a duplicate ACTIVE cadence that re-chases the
 * customer from touch 1.
 *
 * `cadences_one_per_opened_event` closes it: each row records WHICH
 * `quote_status_events.id` created it, and a unique index over that column
 * refuses the replay WHATEVER the first cadence's status is.
 *
 * Sequential cadences stay legal, which is why this is an event-id unique and
 * NOT a blanket unique on `quote_id`: a re-triaged quote (reopened → operator
 * re-triage → `markChaseEligible`) emits a FRESH `quote_opened` with a NEW
 * bigserial id, so its insert conflicts with neither index and creates the
 * second cadence the history above describes.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE EXACT EDGE OF THE REPLAY GUARANTEE (WR-03) — READ BEFORE ADDING AN    │
 * │ ELIGIBILITY WRITER                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The guarantee is NOT "one consumed `quote_opened` can only ever produce one
 * cadence". It is: ONE CONSUMED `quote_opened` CAN ONLY EVER PRODUCE ONE
 * CADENCE ONCE ITS ID HAS BEEN RECORDED — and its id is recorded only on the
 * event that actually CREATED a row.
 *
 * When a `quote_opened` is refused by a LIVE index instead (a live cadence
 * already exists for this quote or job, created by a DIFFERENT event),
 * `createCadenceForQuoteOpened` also returns 'replayed' and the event is also
 * consumed — but that event's id is written nowhere. If the shared cursor is
 * later held behind it AND the first cadence has since left live state, no index
 * covers the row and the replay creates a duplicate: the very G-3-2 defect, in
 * the one branch the fix does not reach.
 *
 * It cannot be closed by stamping the second event onto the first cadence: that
 * row already carries the id of the event that created it, and one column cannot
 * hold two. Closing it properly means a separate consumed-event ledger, which is
 * a bigger design decision than this table.
 *
 * IT IS LATENT, NOT LIVE, and it rests on exactly two facts:
 *   1. `markChaseEligible` requires `chase_eligibility = 'needs_review'`, whose
 *      only writer is `flagNeedsReviewOnReopen`, which runs in the SAME
 *      transaction as `stopWhereLiveByQuoteIds` — so the cadence is never live
 *      when a second `quote_opened` becomes emittable; and
 *   2. `run-sync.ts` suppresses `quote_opened` for quotes it already had a row
 *      for.
 *
 * A NEW ELIGIBILITY WRITER THAT CAN EMIT `quote_opened` WHILE A CADENCE IS LIVE
 * MAKES THIS REAL. `tests/cadence-repository.test.ts` pins the behaviour so that
 * a change either way turns a test red instead of turning a customer's phone on.
 *
 * Consequence for the writer: `cadences.create` uses TARGETLESS
 * `ON CONFLICT DO NOTHING`. Naming an arbiter would make a conflict on ANOTHER
 * index raise 23505 instead of returning zero rows, and the consumer's outer
 * catch would read that throw as a blocked run — holding the shared cursor
 * forever. Zero rows now means "a live cadence exists for this quote or this
 * job, OR this exact event already produced its cadence": either way, you are
 * the replay.
 *
 * ── NO FOREIGN KEYS, AND NO CASCADE (Phase 7 attribution evidence) ──────────
 *
 * Neither `tenant_id` nor `quote_id` references anything, for the reason
 * `quote_status_events.tenant_id` gives verbatim: this table and `send_ledger`
 * are what the recovered-revenue report is computed from, and a client who
 * disconnects must not take their own attribution history with them. Isolation
 * is enforced by the policy below, not by the reference.
 *
 * ── THE CONTACT SNAPSHOT (D-04) ─────────────────────────────────────────────
 *
 * `contact_name` / `contact_mobile` / `contact_email` are COPIES taken at
 * creation, already normalized, not a join to `quote_contacts`. `quote_contacts`
 * rows are per-job mirrors that re-sync: the row this cadence selected can
 * change its phone number, lose its `sm8_active` flag, or be replaced wholesale
 * by the next poll. Reply threading (Phase 4), suppression checks and
 * attribution all need a stable "one human per cadence" identity that survives
 * that. `primary_contact_sm8_uuid` records WHICH row was chosen so the decision
 * is auditable; the addresses are what the engine actually uses.
 *
 * ── WHY `status` AND `*_reason` ARE SEPARATE COLUMNS ────────────────────────
 *
 * A flat vocabulary (`stopped_because_won`, `paused_by_customer_reply`, …) is
 * the product of the two sets and cannot be tested exhaustively at that size.
 * Status × event stays small enough for the CAD-03 matrix while the reason
 * column keeps the WHY auditable for Phase 7. Both are CHECK-constrained in
 * migration 0017 — the vocabularies below erase at compile time, and the writer
 * here is service-role code, so a typo would produce a row that no
 * `status = …` predicate ever matches and nothing would go red.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * WHAT A CADENCE CHASES (Phase 12, D-05 / D-19). ONE-WAY DECISION, like the
 * statuses below: the strings are a CHECK vocabulary (`cadences_kind_known`).
 *
 *  quote — the original product: one ServiceM8 quote, `quote_id` and
 *          `sm8_job_uuid` set, `lead_id` NULL. Created only by
 *          `cadences.create` from a consumed `quote_opened`.
 *  lead  — a missed-call text-back (Phase 12): `lead_id` set, both quote
 *          columns NULL. Created only by `cadences.createLead`. Its touches 2
 *          and 3 are STRUCTURALLY INERT until Phase 13: promotion, drafting,
 *          claiming, the progress pass and the 42-day expiry all carry a
 *          `kind = 'quote'` predicate.
 *
 * `cadences_kind_identity` ties each kind to its identity columns, so a row
 * cannot claim to be a lead while carrying a quote (or the reverse).
 */
export const CADENCE_KINDS = ['quote', 'lead'] as const;
export type CadenceKind = (typeof CADENCE_KINDS)[number];

/**
 * The cadence lifecycle (D-14). ONE-WAY DECISION: these strings are the
 * contract Phases 5, 6 and 7 build on, and renaming one after live cadences
 * exist is a data migration under running schedules.
 *
 *  active     — touches are being promoted and dispatched
 *  paused     — reversible; see CADENCE_PAUSE_REASONS
 *  stopped    — terminal, with a reason; nothing further is ever sent
 *  completed  — every touch reached a terminal state; the cadence ran its course
 *  expired    — D-12; the cadence outlived CADENCE_EXPIRY_DAYS from its anchor
 */
export const CADENCE_STATUSES = [
  'active',
  'paused',
  'stopped',
  'completed',
  'expired',
] as const;
export type CadenceStatus = (typeof CADENCE_STATUSES)[number];

/**
 * D-05 / D-06 — the two pauses, and they are NOT interchangeable.
 *
 * `customer_reply` means a human is mid-conversation with the tradie. Only an
 * operator may lift it (D-05: no automated resume after a live conversation).
 * `client_paused` is the reversible per-client kill switch (D-06).
 *
 * The asymmetry is enforced in `resumeWherePaused`, which matches on the
 * EXPECTED reason: a client un-pause must not silently resume a cadence that
 * was paused because the customer wrote back.
 */
/**
 * `onboarding` (D-07, Phase 5) is the THIRD pause and it is not like the other
 * two: nothing went wrong and nobody chose it. It means the client is not ready
 * to send yet — no approved template set exists for this tenant (ONB-03), so
 * there is nothing for the drafting pass to write from and nothing for an
 * operator to approve. Cadences form and touches materialize on schedule; they
 * simply do not leave until the words exist.
 *
 * It is a PAUSE rather than a refusal at cadence creation because the quote is
 * genuinely live and the schedule is genuinely correct — the only missing thing
 * is configuration a human will supply in an hour. Refusing to create the
 * cadence would mean re-deriving the whole schedule later from an anchor that
 * has since moved.
 *
 * Phase 5 plan 05-01 widens this vocabulary and the CHECK only. The behavioural
 * arms — who sets it, and what lifts it — land in 05-03.
 */
export const CADENCE_PAUSE_REASONS = [
  'customer_reply',
  'client_paused',
  'onboarding',
] as const;
export type CadencePauseReason = (typeof CADENCE_PAUSE_REASONS)[number];

/**
 * THE ONE SPELLING OF THE ACTIVATION GATE (ONB-03), so `grep
 * ONBOARDING_PAUSE_REASON` shows every site that sets it, upgrades away from it,
 * or refuses to lift it — the same reviewability rule `forAllTenants_` follows.
 *
 * It is a named constant rather than a literal because the other two reasons are
 * derived from the matrix at module load (`pauseReasonFor` in controls.ts) and
 * this one CANNOT be: no member of `CADENCE_EVENTS` produces it. Nothing
 * *happens* to a cadence to make it onboarding-paused — it is born that way, by
 * a direct write in `consume-events.ts`, because the tenant was never ready.
 */
export const ONBOARDING_PAUSE_REASON = 'onboarding' as const satisfies CadencePauseReason;

/**
 * A reason an UPGRADE may land — every member except `onboarding`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE DOWNGRADE IS UNTYPEABLE, NOT MERELY UNTESTED.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `transitions.ts` note 7 orders the reasons by stickiness and says nothing may
 * ever be written INTO `onboarding` as an upgrade target. A cadence relabelled
 * from `customer_reply` down to `onboarding` would be resumed en masse by the
 * next template approval — a live conversation restarted by somebody else's
 * paperwork, which is the exact breach D-05 exists to prevent, arriving through
 * the one write that is ALLOWED to change a pause reason.
 *
 * So `upgradePauseReason`'s `to` takes this type rather than `CadencePauseReason`.
 * The matrix cannot prescribe the downgrade (asserted over the whole input space
 * in `tests/cadence-transitions.test.ts`) and no caller can hand-write it either.
 */
export type UpgradablePauseReason = Exclude<
  CadencePauseReason,
  typeof ONBOARDING_PAUSE_REASON
>;

/**
 * Terminal reasons. Every one of these is a decision somebody (or something)
 * made, recorded so Phase 7 can tell a win from an abandonment.
 *
 *  won / lost           — the ServiceM8 status transition (Phase 2 outbox)
 *  removed              — ServiceM8 TOLD us the job is gone (D-08). Two writers,
 *                         both evidence-backed: the outbox `removed` event, and
 *                         `stopReasonForQuote` reading `sm8_active = false` off a
 *                         quote row we still hold.
 *  reopened             — D-08: a reopen is NOT a restart. The quote goes back
 *                         to operator triage; the live cadence stops here.
 *  contact_suppressed   — D-06/D-15 per-contact kill; terminal by design
 *  operator_closed      — the operator closed it by hand
 *  no_contact           — D-04: no usable mobile or email anywhere on the job.
 *                         Created already-stopped so the event is consumed
 *                         exactly once, the cursor advances, and the console
 *                         surfaces it. NEVER a guess at who to text.
 *  mirror_missing       — G-3-5: dispatch's just-in-time re-read found NO quote
 *                         row in OUR mirror at all. The job may or may not still
 *                         exist upstream and we cannot say which — a purge, a
 *                         bug, or a deletion we never observed all look
 *                         identical from here. DISTINCT FROM `removed` on
 *                         purpose: less evidence is exactly why it must be a
 *                         different word, because Phase 7 attributes revenue on
 *                         this column and "the job was deleted" and "we lost the
 *                         row" are not the same claim. Which bucket Phase 7 puts
 *                         it in is Phase 7's decision; distinguishability is the
 *                         requirement now (user decision at UAT test 5).
 *  lead_closed          — Phase 13 (D-14): the LEAD this cadence chased was
 *                         closed (a closing label, the operator, the quote
 *                         cadence winning, or dispatch finding it no longer
 *                         chaseable), and `closeLead` stopped its live cadence
 *                         in the same transaction. Lead cadences only.
 */
export const CADENCE_STOP_REASONS = [
  'won',
  'lost',
  'removed',
  'reopened',
  'contact_suppressed',
  'operator_closed',
  'no_contact',
  'mirror_missing',
  'lead_closed',
] as const;
export type CadenceStopReason = (typeof CADENCE_STOP_REASONS)[number];

export const cadences = pgTable(
  'cadences',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No FK and no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),
    /**
     * One of CADENCE_KINDS. DEFAULT 'quote' so every row that existed before
     * migration 0039 — and every insert Phase 11 code makes between the schema
     * push and the code push — is a quote cadence without saying so.
     */
    kind: text('kind').notNull().default('quote'),
    /**
     * Our `quotes.id`. No FK, same reason. NULL exactly when `kind = 'lead'`
     * (`cadences_kind_identity`); every quote row still carries one.
     */
    quoteId: uuid('quote_id'),
    /**
     * Denormalized so a consumer can correlate without a join. NULL exactly
     * when `kind = 'lead'` (`cadences_kind_identity`).
     */
    sm8JobUuid: uuid('sm8_job_uuid'),
    /**
     * The `leads.id` a lead cadence chases (Phase 12). NULL on every quote
     * cadence. No FK: the evidence posture `quote_id` has.
     */
    leadId: uuid('lead_id'),

    /**
     * WHICH `quote_status_events.id` — the consumption of which `quote_opened` —
     * created this row. The replay-dedupe key (G-3-2); see the header for why it
     * exists alongside the partial live index rather than instead of it.
     *
     * NO FOREIGN KEY, the same Phase 7 evidence rationale `tenant_id` and
     * `quote_id` give above: a cadence is attribution evidence and must not be
     * deletable by way of the row that happened to spawn it.
     *
     * NULLABLE IN THE COLUMN TYPE, REQUIRED BY A CHECK (CR-01). Rows created
     * before migration 0021 recorded no event and stay NULL forever, so the
     * column cannot be `NOT NULL` without inventing an event id for them. But
     * "nullable" was doing far more than that: NULLS DISTINCT lets a unique index
     * hold UNLIMITED NULL-key rows, so a writer that omitted the key opted
     * silently out of the entire replay guarantee — `create` returned a row, the
     * consumer reported 'created', and a duplicate ACTIVE cadence re-chased the
     * customer from touch 1 with no error anywhere. The only thing standing in
     * the way was the TypeScript type on `CadenceCreate`, i.e. exactly the
     * code-level enforcement this file's header rejects for this class of
     * invariant.
     *
     * Migration 0023 makes it structural: `cadences_replay_key_present` CHECKs
     * `created_by_event_id IS NOT NULL OR created_at < <the moment 0021 was
     * applied>`. New rows must carry the key or the INSERT fails LOUDLY (23514);
     * pre-0021 rows stay legal. The database decides, not the caller.
     */
    createdByEventId: bigint('created_by_event_id', { mode: 'number' }),

    /** One of CADENCE_STATUSES. */
    status: text('status').notNull().default('active'),
    /** One of CADENCE_PAUSE_REASONS, or NULL when not paused. */
    pauseReason: text('pause_reason'),
    /** One of CADENCE_STOP_REASONS, or NULL when not stopped. */
    stopReason: text('stop_reason'),

    /**
     * D-01 — Day 0. The ELIGIBILITY moment: when the quote became chase-eligible
     * and we started watching it, i.e. the consumption of `quote_opened`.
     *
     * NEVER `quote_status_events.occurred_at`, which is ServiceM8's own
     * timestamp and can point WEEKS into the past for a backfilled quote an
     * operator has only just triaged. Anchoring there would materialize a
     * cadence whose first three touches are already overdue — the exact state
     * D-01 says can never happen.
     */
    anchorAt: timestamp('anchor_at', { withTimezone: true }).notNull(),

    /** Which `quote_contacts` row was selected (D-04). Audit trail, not a join. */
    primaryContactSm8Uuid: uuid('primary_contact_sm8_uuid'),
    contactName: text('contact_name'),
    /** Normalized `+614…`, never the raw upstream string. */
    contactMobile: text('contact_mobile'),
    /** Normalized: trimmed and lowercased. */
    contactEmail: text('contact_email'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE never-twice constraint for cadence creation (CAD-01). See the header
     * for why it is partial and why zero rows from `ON CONFLICT DO NOTHING` is
     * an answer rather than a failure.
     */
    uniqueIndex('cadences_one_live_per_quote')
      .on(table.quoteId)
      .where(sql`status IN ('active', 'paused')`),

    /**
     * THE SAME never-twice guarantee, keyed on the identity that SURVIVES A
     * MIRROR REBUILD (WR-02, migration 0024).
     *
     * `cadences_one_live_per_quote` is keyed on `quote_id`, our own surrogate.
     * Migration 0022 made "the quotes row is absent while its cadence survives" a
     * blessed state rather than a corruption, and that turned the choice of key
     * load-bearing: after an ops purge, a re-sync inserts a NEW `quotes` row with
     * a NEW uuid, `run-sync.ts` sees `prev === undefined` and so does NOT
     * suppress the `quote_opened`, and the resulting insert conflicts with
     * neither index — different `quote_id`, different `created_by_event_id`. Two
     * live cadences for one ServiceM8 job, two parallel chase sequences, one
     * customer.
     *
     * TENANT-SCOPED: two tenants may legitimately hold the same job uuid, which
     * is why `quotes` is unique on the pair rather than on the uuid alone.
     *
     * KEPT ALONGSIDE the `quote_id` form rather than replacing it. The two
     * coincide whenever the mirror is intact; keeping both costs one index and
     * avoids having to argue that the new one covers everything the old one did.
     */
    uniqueIndex('cadences_one_live_per_job')
      .on(table.tenantId, table.sm8JobUuid)
      .where(sql`status IN ('active', 'paused')`),

    /**
     * THE never-twice constraint for cadence creation under REPLAY (G-3-2).
     *
     * NOT partial on STATUS: it must refuse a re-consumed `quote_opened`
     * whatever status the cadence that event already created has since reached —
     * that is the whole difference between it and the live index above. A new
     * `quote_opened` carries a new bigserial id and is therefore still allowed to
     * create the sequential cadence the header describes.
     *
     * Partial on NULL only, and that predicate is documentation rather than a
     * behaviour change (CR-01): Postgres's NULLS DISTINCT default already
     * excluded NULL keys. Spelling it out answers "which rows does the replay
     * guarantee actually cover?" in the index definition instead of leaving the
     * answer to a default nobody names — and it is now honest, because
     * `cadences_replay_key_present` (migration 0023) means the only rows in the
     * excluded set are pre-0021 legacy ones.
     */
    uniqueIndex('cadences_one_per_opened_event')
      .on(table.createdByEventId)
      .where(sql`created_by_event_id IS NOT NULL`),

    /**
     * THE FOURTH ARBITER (Phase 12, D-05): never two LIVE cadences for one lead.
     * A second missed call from a caller whose text-back cadence is live must
     * join that cadence, not text them again — the lead twin of
     * `cadences_one_live_per_quote`.
     *
     * Partial on `lead_id IS NOT NULL` as well as on live status, and that is
     * what keeps the targetless quote `cadences.create` meaning what it meant
     * (WR-06, for-tenant.ts): every quote row has `lead_id` NULL, so no quote
     * insert can ever conflict on this index. Only `cadences.createLead`
     * reaches it, and that statement NAMES it as its arbiter so a conflict on
     * any other index raises instead of reading as "already open".
     */
    uniqueIndex('cadences_one_live_per_lead')
      .on(table.leadId)
      .where(sql`lead_id IS NOT NULL AND status IN ('active', 'paused')`),

    /** The tick's per-tenant live-cadence read, and the console's badge count. */
    index('cadences_tenant_status_idx').on(table.tenantId, table.status),

    check('cadences_kind_known', sql`kind IN ('quote', 'lead')`),
    /**
     * Hand-written in 0017 and widened by hand in 0022; carried in this file
     * from Phase 13 (0040, `lead_closed`) so the spelling is pinned beside
     * CADENCE_STOP_REASONS byte for byte. The other cadence vocabulary CHECKs
     * (status, pause reason) remain hand-written in 0017 only.
     */
    check(
      'cadences_stop_reason_known',
      sql`stop_reason IS NULL OR stop_reason IN ('won', 'lost', 'removed', 'reopened', 'contact_suppressed', 'operator_closed', 'no_contact', 'mirror_missing', 'lead_closed')`,
    ),
    /**
     * Which identity each kind carries (D-05). Every pre-0039 row is
     * `kind = 'quote'` with both quote columns set (they were NOT NULL), so the
     * CHECK holds over existing data by construction.
     */
    check(
      'cadences_kind_identity',
      sql`(kind = 'quote' AND quote_id IS NOT NULL AND sm8_job_uuid IS NOT NULL AND lead_id IS NULL) OR (kind = 'lead' AND lead_id IS NOT NULL AND quote_id IS NULL AND sm8_job_uuid IS NULL)`,
    ),

    pgPolicy('cadences_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type Cadence = typeof cadences.$inferSelect;
export type NewCadence = typeof cadences.$inferInsert;
