---
phase: 13-lead-cadence-labels-escalation
plan: 01
subsystem: database / leads / text-back gate / templates
status: complete
tags: [migration-0040, leads, lead-labels, message-templates, text-back-gate, d-12, d-16]
requires:
  - Phase 12 migration 0039 (leads, cadences.kind, missed-call text-back columns, escalations triggers)
  - Phase 12 text-back gate (src/core/leads/gate.ts) and decideInTransaction fact assembly
provides:
  - Migration 0040 (one journal entry, idx 40, written NOT applied, NOT pushed)
  - Lead policy constants (LEAD_MIN_GAP_HOURS, LEAD_STALENESS_CAP_HOURS, LEAD_EXPIRY_DAYS, LEAD_NEGATIVE_COOL_OFF_DAYS, RING_TWICE_WINDOW_MINUTES, URGENT_KEYWORDS)
  - Vocabularies LEAD_LABELS, LEAD_URGENCIES, LEAD_CLOSED_REASONS, MESSAGE_TEMPLATE_KINDS; recent_negative_close skip reason; lead_closed stop reason; lead_closed escalation outcome
  - kind-aware message_templates reads; TemplateVersionInsert (optional kind); latestApprovedSet(channel, kind = 'quote')
  - leads.latestForMobile; LeadCloseFacts
  - Gate rule 6 recent_negative_close; pure isRecentNegativeClose + NEGATIVE_CLOSE_REASONS
affects:
  - 13-02 (policy.ts reads the lead constants; lead seed uses insertVersion({kind:'lead'}) and latestApprovedSet('sms','lead'); CI proves 0040 on a fresh database)
  - 13-04 (LEAD_LABELS/LEAD_URGENCIES feed the zod schema; urgency/keyword_hot columns; URGENT_KEYWORDS matcher)
  - 13-05/13-06 (tenants.after_hours_escalation; escalations.hold_until/released_at; RING_TWICE_WINDOW_MINUTES)
  - 13-07 (production apply of 0040 under the push protocol)
tech-stack:
  added: []
  patterns:
    - "as-const vocabulary -> CHECK literal byte for byte (verified mechanically for all seven touched vocabularies)"
    - "By-kind CHECK keyed on lead_id (inbound_messages has no kind column)"
    - "Pure fact derivation beside the pure gate (isRecentNegativeClose), DB read on the claim transaction"
key-files:
  created:
    - src/db/migrations/0040_phase13_lead_cadence.sql
    - src/db/migrations/meta/0040_snapshot.json
  modified:
    - src/core/leads/constants.ts
    - src/db/schema/{leads,inbound-messages,tenants,message-templates,missed-calls,escalations,cadences}.ts
    - src/db/migrations/meta/_journal.json
    - src/db/repository/for-tenant.ts
    - src/core/leads/gate.ts
    - src/core/leads/text-back.ts
    - tests/text-back-gate.test.ts
    - tests/rls-coverage.test.ts
decisions:
  - "cadences_stop_reason_known now lives in src/db/schema/cadences.ts (it was hand-written only, in 0017/0022), so its literal is pinned beside CADENCE_STOP_REASONS; 0040 drops-if-exists then adds it"
  - "The D-12 fact is derived by a pure isRecentNegativeClose(newestLead, now) in gate.ts (>= boundary: exactly 90 days is still refused), so the four negative reasons, touches_exhausted and the boundary are provable without a database"
  - "Only the NEWEST lead at the client counts for the cool-off: an open or converted newest lead is never negative, whatever an older lead closed as"
  - "leads.latestForMobile returns the repository's array convention ([] = never a lead here), ordered created_at DESC, id DESC"
  - "listVersions and latestApproved are fixed to kind = 'quote'; only latestApprovedSet takes a kind (default 'quote'), matching research Q4"
metrics:
  duration: "~36 min"
  completed: 2026-10-08
  tasks: 2
  files: 16
estimate:
  tokens: 60000
  tasks: 2
actuals:
  tokens: 18800
  tasks: 2
  commits: 3
requirements-completed: [LEAD-01, LEAD-05]
---

# Phase 13 Plan 01: Migration 0040, lead vocabularies and the D-12 gate rule Summary

Phase 13's whole schema now sits in one hand-finished journal entry, `0040_phase13_lead_cadence` (idx 40). It is written and generated, and it is **not applied anywhere and not pushed**. The entry adds `leads.closed_reason`/`closed_at` with four consistency CHECKs, the lead label vocabulary on `inbound_messages` (`urgency`, `keyword_hot`, a label CHECK split by `lead_id` and four sibling CHECKs), `tenants.after_hours_escalation`, `message_templates.kind` with a unique index widened by kind, `escalations.hold_until`/`released_at`, the `recent_negative_close` skip reason, the `lead_closed` stop reason and four indexes. Each new vocabulary is an as-const array whose spelling appears byte for byte in its CHECK.

The quote template reads can no longer see lead rows. That closes the trap where seeded, pre-approved lead templates would have made the quote onboarding gate pass with nothing approved. The text-back gate also has its D-12 rule: a caller whose newest lead at the client closed as not_a_lead, spam, complaint or opt_out within 90 days is not texted.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Lead constants, every new vocabulary member in its schema file and CHECK, migration 0040 as one hand-finished entry (not applied) | `1ec56f4` | constants.ts, 7 schema files, 0040 sql + snapshot + journal, rls-coverage pins |
| 2 | Five kind-aware template reads, `leads.latestForMobile`, the D-12 gate rule and its pure proof | `e6038b0` | for-tenant.ts, gate.ts, text-back.ts, text-back-gate.test.ts |

## db:generate outputs

- First run: generated `0040_rare_shaman.sql` (37 tables listed). It was renamed to `0040_phase13_lead_cadence.sql` and the journal was re-tagged. The new `when` is 1791444299489, which is later than 0039's 1791222883774, so no re-stamp was needed. The journal check (`idx === 40 && when > 1791222883774 && tag === '0040_phase13_lead_cadence'`) exits 0.
- Second run, after hand-finishing: `No schema changes, nothing to migrate 😴`.

Hand-finished:
- Drizzle emitted bare DROPs for `inbound_messages_label_known` and `missed_calls_text_back_skip_reason_known`. Both now use `DROP CONSTRAINT IF EXISTS`.
- `cadences_stop_reason_known` gets an added `DROP CONSTRAINT IF EXISTS` in front of the ADD drizzle generated. No snapshot knew this constraint because it was hand-written in 0017/0022.
- The replaced `message_templates` unique-index DROP now uses `IF EXISTS`.

Drizzle emitted nothing touching `cadences_one_live_per_job`, `cadences_one_per_opened_event`, `cadences_id_tenant_uniq` or `cadences_replay_key_present` (checked). The entry has no CREATE TABLE, no GRANT and no data statement (all three counted at 0).

## Migration 0040: final statement list

1. `inbound_messages` DROP CONSTRAINT IF EXISTS `inbound_messages_label_known`
2. `missed_calls` DROP CONSTRAINT IF EXISTS `missed_calls_text_back_skip_reason_known`
3. `cadences` DROP CONSTRAINT IF EXISTS `cadences_stop_reason_known`
4. DROP INDEX IF EXISTS `message_templates_tenant_touch_channel_version_uniq`
5. `tenants` ADD `after_hours_escalation boolean DEFAULT false NOT NULL`
6. `inbound_messages` ADD `urgency text`
7. `inbound_messages` ADD `keyword_hot boolean DEFAULT false NOT NULL`
8. `message_templates` ADD `kind text DEFAULT 'quote' NOT NULL`
9. `escalations` ADD `hold_until timestamptz`
10. `escalations` ADD `released_at timestamptz`
11. `leads` ADD `closed_reason text`
12. `leads` ADD `closed_at timestamptz`
13. CREATE INDEX `inbound_messages_lead_label_idx` (lead_id, label) WHERE lead_id IS NOT NULL
14. CREATE UNIQUE INDEX `message_templates_tenant_kind_touch_channel_version_uniq` (tenant_id, kind, touch_number, channel, version)
15. CREATE INDEX `escalations_held_idx` (hold_until) WHERE hold_until IS NOT NULL AND released_at IS NULL
16. CREATE INDEX `leads_tenant_mobile_created_idx` (tenant_id, contact_mobile, created_at DESC)
17. ADD `cadences_stop_reason_known` (the eight existing members plus `lead_closed`)
18. ADD `inbound_messages_urgency_known`
19. ADD `inbound_messages_urgency_lead_only`
20. ADD `inbound_messages_lead_label_has_urgency`
21. ADD `inbound_messages_keyword_hot_lead_only`
22. ADD `inbound_messages_label_known` (by kind: lead_id NULL = quote list, lead_id NOT NULL = lead list)
23. ADD `message_templates_kind_known`
24. ADD `escalations_release_needs_hold`
25. ADD `missed_calls_text_back_skip_reason_known` (`recent_negative_close` after `suppressed`)
26. ADD `leads_closed_reason_known`
27. ADD `leads_closed_iff_reason`
28. ADD `leads_closed_at_with_reason`
29. ADD `leads_expired_reason`

A mechanical check confirmed that each const (LEAD_CLOSED_REASONS, LEAD_LABELS, LEAD_URGENCIES, INBOUND_LABELS, MESSAGE_TEMPLATE_KINDS, TEXT_BACK_SKIP_REASONS, CADENCE_STOP_REASONS) renders to a literal that appears verbatim both in its schema file and in the migration.

## The five kind-aware read sites (`src/db/repository/for-tenant.ts`)

- `:2682`: `latestApproved`, `eq(messageTemplates.kind, 'quote')`
- `:2704`: `latestApprovedSet(channel, kind = 'quote')`, `eq(messageTemplates.kind, kind)`
- `:2745`: `insertVersion`, inside the correlated version sub-select (`AND kind = ${kind}`). The insert also writes `kind` (`row.kind ?? 'quote'`).
- `:2777`: `listVersions`, `eq(messageTemplates.kind, 'quote')`
- `:2816`: the EXISTS inside `approvedSetStatus`, `eq(messageTemplates.kind, 'quote')`, with a comment naming the vacuous-truth trap
- `:4227`: `leads.latestForMobile` (new)

## Files `tsc` forced

- `tests/text-back-gate.test.ts`: `FAILING` is a `Record<TextBackGateReason, …>`, so adding the vocabulary member in Task 1 required a `recent_negative_close` key. Task 1 added a compile-only `{}` arm, which Task 2 replaced with `{ recentNegativeClose: true }` (see Deviation 1).
- `tests/text-back-gate.test.ts` again in Task 2: the `clear()` fixture gained `recentNegativeClose: false` once the fact became required.
- No source file was forced. Adding `'lead_closed'` to `ESCALATION_OUTCOMES` and `'lead_closed'` to `CADENCE_STOP_REASONS` broke no switch or `Record` anywhere.

## Verification

- **Task 1 verify** was green: typecheck, lint, the pure suites `lint-ban` + `cadence-rewindow` + `text-back-structure` (3 files, 353 tests), the second `db:generate` (no changes), the journal check, and `git diff --quiet ed2e4dc -- <quote pins + must-not-move>`.
- **Task 2 verify** was green: the pure suites `text-back-gate` + `text-back-structure` + `lint-ban` (3 files, 389 tests), typecheck, lint, and the same pin diff.
- Phase base = `ed2e4dc` (the last commit touching 13-01-PLAN.md). `tests/cron-schedules.test.ts`, `report-metrics.test.ts`, `sync-upsert.test.ts`, `cadence-rewindow.test.ts`, `cadence-tick.test.ts`, `cadence-resume.test.ts` and `scripts/apply-cron-schedules.mjs` are byte-identical to it.
- The quote constants are unchanged: `MIN_GAP_HOURS = 48`, `STALENESS_CAP_HOURS = 72`, `CADENCE_EXPIRY_DAYS = 42` (grep count 3). `src/core/leads/constants.ts` has 0 imports, and the six new export lines grep to 6.
- `forAllTenants_` export count is 16 (unchanged).
- **Not run here** (DB-backed, CI only; 13-02's tracer CI on a fresh database): `tests/rls-coverage.test.ts` with its two new cases (the Phase 13 CHECK names and definitions; the four indexes, with the old template index asserted absent).
- Nothing was applied and nothing was pushed. `npm run db:migrate` was not run, no DB-backed suite was run locally, `npm run test:remote` was not run, and no env file was named in any command.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 needed a compile-only arm in `tests/text-back-gate.test.ts`**
- **Found during:** Task 1, `npm run typecheck`.
- **Issue:** The plan says this test goes red at the Task 1 commit "on its vocabulary pin" and leaves the file to Task 2. But `FAILING: Record<TextBackGateReason, …>` is derived from `TEXT_BACK_SKIP_REASONS`, so the new member was a **type error**, not just a runtime red. That would fail Task 1's own `npm run typecheck`.
- **Fix:** Added `recent_negative_close: {}` with a dated comment, which is the minimum the compiler demanded under the plan's "widen only as far as the compiler demands" rule. The runtime vocabulary pin stayed red at `1ec56f4` by design, because `ORDER` was not moved yet. Task 2 replaced the arm with the real failing patch.
- **Files:** tests/text-back-gate.test.ts. **Commit:** `1ec56f4` (then `e6038b0`).

**2. [Rule 1 - Correctness] `cadences_stop_reason_known` moved into the schema file**
- **Found during:** Task 1.
- **Issue:** The plan says to add `'lead_closed'` "to CADENCE_STOP_REASONS and the CHECK literal" in `cadences.ts`, and the acceptance criterion greps for 2 occurrences there. But the CHECK existed only as hand-written SQL in 0017/0022, so `cadences.ts` had no literal to widen.
- **Fix:** Added `check('cadences_stop_reason_known', …)` to `cadences.ts`. The literal is now pinned beside the const, and the snapshot knows the constraint. Drizzle emitted a bare ADD, which would fail on the existing constraint, so 0040 drops-if-exists first (0022 idiom). The database end state is identical to a hand-written widening. `cadences_status_known` and `cadences_pause_reason_known` remain hand-written in 0017 only (unchanged).
- **Files:** src/db/schema/cadences.ts, 0040 sql. **Commit:** `1ec56f4`.

**3. [Rule 2 - Testability] The D-12 fact is a pure function in `gate.ts` rather than inline in `text-back.ts`**
- **Found during:** Task 2.
- **Issue:** The behaviour block asks for a pure proof that "a caller whose newest lead closed touches_exhausted is not refused by this rule". With the derivation inline in `decideInTransaction`, that is only provable through a DB-backed suite.
- **Fix:** Added `isRecentNegativeClose(newestLead, now)` and `NEGATIVE_CLOSE_REASONS` (typed `satisfies readonly LeadClosedReason[]`) to `gate.ts`, which still imports only types and the two constants modules. `text-back.ts` reads `tx.leads.latestForMobile(caller)` beside suppression and passes the result through. The pure suite now proves:
  - the four negative reasons refuse;
  - every other stored reason does not;
  - touches_exhausted is texted again;
  - exactly 90 days is refused and 90 days plus 1 ms is not;
  - no lead or an open lead is never negative;
  - a reason without a close time is not trusted.
- **Consequence:** `grep -c "latestForMobile\|LEAD_NEGATIVE_COOL_OFF_DAYS" src/core/leads/text-back.ts` = 2 (two latestForMobile lines). The constant itself is now read in `gate.ts`. The criterion holds.
- **Files:** src/core/leads/gate.ts, src/core/leads/text-back.ts, tests/text-back-gate.test.ts. **Commit:** `e6038b0`.

**4. [Naming] `TemplateVersionInsert` is a new exported interface**
- The plan says "TemplateVersionInsert gains an optional kind", but no type by that name existed: `insertVersion` used an inline row type. I created the interface with `kind?: MessageTemplateKind` and used it in both the interface and the implementation. Every existing caller compiles unchanged.

## TDD Gate Compliance

Task 2 is `tdd="true"`, but the plan prescribes a single `feat(13-01)` commit per task, and that is what landed. The RED state existed by construction at `1ec56f4`: the stored vocabulary had `recent_negative_close` and `ORDER` did not. I did not run it at that commit, and it was not committed as a separate `test(...)` commit. GREEN is `e6038b0`. No refactor commit.

## Forward risk for 13-02's CI gate (out of scope here, not fixed)

`tests/lead-reply.test.ts:206-232` (DB-backed) runs today's QUOTE classifier on a reply threaded to a LEAD cadence and asserts `label: 'interested'`. Under 0040's by-kind `inbound_messages_label_known`, a row with `lead_id` set may only carry a LEAD_LABELS label. That write will be refused (23514) on any database built with 0040 until 13-04 gives the classifier its lead arm and extends this suite. The research's "Tests that break by design" table does not list it. If 13-02's CI run on `ci/phase-13-tracer` executes the full DB suite, expect this case red. This is the same seam as research Pitfall 6, but it surfaces in CI rather than on a dirty local stack.

## Known Stubs

None. The new columns have no writers yet by design: closing writers land in 13-02, urgency/keyword_hot in 13-04, and hold/release and the after-hours switch in 13-05/13-06. No UI renders them.

## Threat Flags

None. No new endpoint, auth path or trust-boundary surface. T-13-03 is mitigated by the `approvedSetStatus` EXISTS predicate. T-13-05 is mitigated by an additive or widening-only entry. T-13-09 is mitigated by the CHECK-bound reason, a `>=` boundary and the newest lead only. For T-13-15, the tests use fiction-range numbers only, and the migration header carries names and counts only.

## Self-Check: PASSED

- FOUND: src/db/migrations/0040_phase13_lead_cadence.sql
- FOUND: src/db/migrations/meta/0040_snapshot.json
- FOUND: commit 1ec56f4
- FOUND: commit e6038b0
