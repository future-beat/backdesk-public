---
status: complete
phase: 03-cadence-engine
source: [03-VERIFICATION.md]
started: 2026-08-28T06:20:00Z
updated: 2026-08-28T11:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Phone-viewport kill / pause / resume end to end
expected: Cadence state, stop/pause reasons, and upcoming touch times (tenant timezone) visible; kill/pause/resume controls tappable one-handed without horizontal scrolling (D-16); exactly one result message renders after each action — the one for the action last tapped (WR-08)
result: pass

### 2. Semantic review — CR-02 cursor-hold idempotence
expected: Runs after a blocked tenant commit their writes without advancing the shared cursor; held events re-read next tick are safe because every handler (quote_opened create-on-conflict, won/lost/removed/reopened guarded stops) is idempotent by construction (read consume-events.ts advanceCursor flow)
result: pass
resolved_by: 03-08-PLAN.md
reported: "Adversarial code verification REFUTED idempotence for quote_opened: the dedupe index cadences_one_live_per_quote covers only status IN ('active','paused'), so replaying a held quote_opened whose first cadence already stopped (no_contact / contact_suppressed / stopped-won in the same held batch) re-creates a new stopped cadence EVERY tick until the blocking tenant is fixed — duplicate cadence rows polluting counters and the table Phase 7 attributes from; worst-case an active duplicate re-chases from touch 1 if the first cadence leaves live state while the quote is still open. Cursor mechanics and the other four handlers CONFIRMED idempotent. Untested case: stopped-cadence replay."
severity: major
resolution: "Fixed by gap plan 03-08 — replay-safe event-id dedupe made structural (0021+0023), cursor-wedge prevented; re-verification passed 2026-08-28"

### 3. Semantic review — CR-03 resume clamp direction
expected: A future-scheduled touch keeps its original slot to the millisecond; an overdue touch is repaired forward; touches chained behind a clamped one never land earlier than the touch before them (read resume.ts computeResumeSchedule)
result: pass
source: automated
note: "Adversarially CONFIRMED (resume.ts:125-178 max-clamps, window.ts roll-forward monotone). Two documented caveats, neither a bug: chained touches are re-derived so their wall-clock minute can move up to 10 jitter-minutes earlier within the same allowed day (never before predecessor or preferred time); MIN_GAP preservation relies on template gaps >48h (property of shipped data, not the function)." 

### 4. Semantic review — WR-06 empty re-key re-window scope
expected: resumeConnection scopes re-window to cadences created before pausedAt; a proactive API-key rotation (null pausedAt) re-windows NOTHING — anything overdue for unrelated reasons belongs to the tick's own re-window pass. Confirm this is the intended product behavior
result: pass
source: automated
note: "Adversarially CONFIRMED mechanically: null pausedAt yields an explicit empty Set that selects zero (not all) cadences; the per-minute tick's re-window pass repairs any overdue touch on active unpaused cadences within a minute regardless of cause, so nothing can be permanently stranded; console pause/resume paths unaffected. The product-intent question dissolves — the empty scope delays repair by at most one tick." 

### 5. Semantic review — WR-07 `removed` stop reason vs Phase 7 attribution
expected: Phase 7 attributes revenue on stop_reason; a cadence stopped `removed` because the mirrored quote row vanished must not silently exclude (or include) recovered revenue in a way the report design didn't intend — a design judgment for the Phase 7 contract
result: pass
resolved_by: 03-09-PLAN.md
reported: "User decision: mirror-missing quotes must be distinguishable from ServiceM8-deleted jobs — do not reuse stop_reason='removed' for a quote row that vanished from the local mirror; introduce a separate reason (e.g. mirror_missing) so Phase 7 can decide its attribution bucket later"
severity: minor
resolution: "Fixed by gap plan 03-09 — mirror_missing stop reason (0022), own refusal label and log; distinguishability tests pass; re-verification passed 2026-08-28"

### 6. Prohibition sign-off (3 judgment-tier items)
expected: (1) stub ledger rows structurally distinguishable from real sends (sender='stub', outcome='stub_sent'); (2) no un-suppress path anywhere (suppression namespace insert/exists/list only; migration 0017 SELECT-only grants; no .delete()/.update() on suppressedContacts in src/); (3) no customer PII in tick response/cron rows/logs (counts-only body, IDs-only console.error). LLM-judge verdict: all hold — confirm
result: pass
source: automated
note: "Independently CONFIRMED by adversarial grep+read: sender='stub'/outcome='stub_sent' at dispatch.ts:361,424-425 with DB CHECK; zero UPDATE/DELETE against suppressed_contacts in src/, 0017 REVOKE-then-SELECT-only grants, leak test asserts console cannot un-suppress; tick body field-enumerated counts with leaf-walking test, all ten console.* calls carry UUIDs/counts only." 

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-3-2
  truth: "Every outbox event handler is idempotent under cursor-hold replay — a held quote_opened re-read on later ticks must not create duplicate cadences"
  status: resolved
  resolved_by: 03-08-PLAN.md
  resolved_at: 2026-08-28
  reason: "Adversarial verification: cadences_one_live_per_quote partial index only dedupes live cadences; replay of a held quote_opened whose first cadence is stopped creates a new stopped cadence every tick (row/counter/attribution pollution; worst-case active duplicate re-chases from touch 1). Fix direction: make quote_opened replay-safe regardless of cadence liveness (e.g., existence check on (tenant_id, quote_id) irrespective of status before create, or widen the dedupe to any cadence for the quote), plus a stopped-cadence replay test."
  severity: major
  test: 2
  artifacts: [src/core/cadence/consume-events.ts, src/db/repository/for-tenant.ts]
  missing: [stopped-cadence replay test in tests/cadence-consume-events.test.ts]
- gap_id: G-3-5
  truth: "A cadence stopped because its quote row vanished from the local mirror carries a stop_reason distinguishable from a ServiceM8-deleted job, so Phase 7 revenue attribution can bucket the two differently"
  status: resolved
  resolved_by: 03-09-PLAN.md
  resolved_at: 2026-08-28
  reason: "User decision at UAT: 'removed' conflates ServiceM8 job deletion with mirror-missing rows. Introduce a distinct stop reason (e.g. mirror_missing) written by the dispatch/consume path that stops on a missing quote row; update the stop_reason vocabulary (transitions/state machine if applicable), the DB CHECK constraint via migration, and tests covering the missing-mirror-row stop."
  severity: minor
  test: 5
  artifacts: [src/core/cadence/dispatch.ts, src/core/cadence/transitions.ts, src/db/migrations]
  missing: [distinct mirror_missing stop reason + migration + test coverage]
