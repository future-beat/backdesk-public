---
phase: 03-cadence-engine
verified: 2026-08-28T10:35:00Z
status: passed
score: 50/50 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 41/42
  gaps_closed:
    - "G-3-2: quote_opened is idempotent under cursor-hold replay regardless of cadence liveness (plan 03-08 + review fixes CR-01/WR-02/WR-03/WR-04/WR-05/WR-06)"
    - "G-3-5: a vanished-mirror-row stop carries stop_reason='mirror_missing', distinguishable from a ServiceM8-deleted job (plan 03-09 + review fix WR-01)"
  human_items_resolved:
    - "Phone-viewport kill/pause/resume ergonomics + WR-08 single-message slot — PASSED by human (UAT test 1)"
    - "CR-02 cursor-hold idempotence — REFUTED by adversarial review (UAT test 2) → became G-3-2, now fixed and behaviorally verified"
    - "CR-03 resume clamp direction — adversarially CONFIRMED (UAT test 3)"
    - "WR-06 empty re-key scope — adversarially CONFIRMED; product-intent question dissolved (UAT test 4)"
    - "WR-07 'removed' vs Phase 7 attribution — user decision (UAT test 5) → became G-3-5, now fixed and behaviorally verified"
    - "3 judgment-tier prohibitions — human sign-off recorded (UAT test 6, pass, independently adversarially confirmed)"
  gaps_remaining: []
  regressions: []
gaps: []
deferred:
  - truth: "Touches are sent through a real SMS/email provider rather than the stub sender"
    addressed_in: "Phase 4"
    evidence: "Phase 4 success criteria: 'SMS sends from a dedicated AU virtual number with delivery receipts recorded per message'; D-13 defines the TouchSender contract the stub implements so Phase 4 swaps the sender without touching dispatch"
accepted_limitations:
  - id: WR-03
    statement: "A quote_opened refused by a LIVE index (cadence created by a DIFFERENT event) has its id recorded nowhere; if that cadence later stops and the refused event replays under cursor hold, a duplicate is created"
    disposition: "acceptably pinned — NOT a gap in this phase's goal"
    reasoning: "Unreachable in production today via two verified emitter facts (markChaseEligible requires needs_review whose only writer runs in the same tx as stopWhereLiveByQuoteIds; run-sync suppresses quote_opened for pre-existing quotes); documented in cadences.ts header, consume-events.ts, and a repository-level tripwire test that goes red if the gap is closed; full close needs a consumed-event ledger (a design decision beyond a review fix)"
    phase_4_planning_note: "The tripwire does NOT trip on reachability — any new chase_eligibility writer in Phase 4+ must revisit this before landing (the dependency is written at cadence-repository.test.ts:318-345 and cadences.ts)"
---

# Phase 3: Cadence Engine Verification Report (Re-verification)

**Phase Goal:** Every synced open quote gets a deterministic, contact-hours-aware follow-up schedule that structurally cannot send late, twice, or stale
**Verified:** 2026-08-28T10:35:00Z
**Status:** passed
**Re-verification:** Yes — after UAT-driven gap closure (plans 03-08, 03-09) and a scoped gap-closure code review (1 critical + 6 warnings, all fixed)

## What changed since the initial verification

The initial verification (2026-08-28T07:35Z) passed all automated checks and routed 6 items to human verification. A completed UAT session (`03-UAT.md`, status: complete — 4 passed, 2 issues) resolved ALL six:

- **Test 1 (phone ergonomics + WR-08)** — passed by the human.
- **Test 2 (CR-02 cursor-hold idempotence)** — adversarial code verification **REFUTED** the claim for `quote_opened`: the partial live index could not dedupe replay against a stopped first cadence → **gap G-3-2 (major)**.
- **Tests 3, 4 (CR-03 clamp, WR-06 re-key scope)** — adversarially confirmed, with documented non-bug caveats.
- **Test 5 (WR-07)** — user decision: `removed` must not be reused for a mirror-missing row → **gap G-3-5 (minor)**.
- **Test 6 (3 judgment-tier prohibitions)** — human sign-off recorded, each independently re-confirmed by adversarial grep+read.

Gap plans 03-08 (G-3-2) and 03-09 (G-3-5) executed; a scoped code review (`03-REVIEW-GAPS.md`) of the delta found CR-01 + WR-01…WR-06; all 7 fixed (`03-REVIEW-GAPS-FIX.md`) as atomic commits with migrations 0023/0024 applied to the hosted DB. This re-verification checked every claim against the actual codebase and re-ran the load-bearing suites.

## Gap Closure Verification (full 3+1-level, not trusted from SUMMARYs)

### G-3-2 — quote_opened replay-safe regardless of cadence liveness (plan 03-08)

| Truth | Status | Evidence |
| --- | --- | --- |
| Replaying a held quote_opened whose first cadence already stopped creates NO new cadence row | ✓ VERIFIED | `cadences_one_per_opened_event` unique index (schema cadences.ts:342-343; migration 0021, narrowed by 0023); behavioral: "replay: created already-stopped, no contact" test — `cadencesCreated: 0`, `getByQuoteId(...).length === 1` — **passed this run** on hosted DB |
| Worst case closed: replay after a live cadence stopped mid-batch cannot re-chase | ✓ VERIFIED | Worst-case test rewinds behind the `quote_opened` of a won job, replays BOTH events: exactly one cadence, still stopped/won, `updatedAt` byte-identical, tenant-wide before/after touch-id set equal (WR-04 fix — a real assertion, not the old tautology) — **passed this run** |
| Sequential cadences stay legal (fresh quote_opened → second cadence) | ✓ VERIFIED | Re-triage test asserts `getByQuoteId` length 2 with two DISTINCT `createdByEventId`s, exactly one live — **passed this run** |
| Conflict on EITHER index returns zero rows, never a thrown 23505 | ✓ VERIFIED | `cadences.create` is targetless `.onConflictDoNothing()` (for-tenant.ts:1144) with the load-bearing WHY comment; repository suite witnesses both arbiters separately — **passed this run** |

Artifacts: migration `0021_cadence_created_by_event.sql` (hand-edited to `IF NOT EXISTS` idiom per WR-05, journaled idx 21), schema column + index, `CadenceCreate` requires `createdByEventId: number` (for-tenant.ts:160,170), consumer passes `createdByEventId: event.id` (consume-events.ts:420). All exist, substantive, wired.

### G-3-5 — mirror_missing distinguishable from removed (plan 03-09)

| Truth | Status | Evidence |
| --- | --- | --- |
| Missing mirror row → stop_reason='mirror_missing' | ✓ VERIFIED | dispatch.ts:322 `quote ? stopReasonForQuote(quote) : 'mirror_missing'`; dispatch test "stops the cadence as `mirror_missing` when the quote row is gone" asserts `stopReason === 'mirror_missing'` AND `refusals.mirror_missing === 1` — **passed this run** |
| 'removed' means exactly one thing: ServiceM8 told us (outbox event, or sm8_active=false on a PRESENT row) | ✓ VERIFIED | `stopReasonForQuote` untouched; paired sibling test flips `sm8_active=false` on a present row and asserts `stopReason === 'removed'` (cadence-dispatch.test.ts:604-617) — the pair makes the DISTINCTION what the suite proves — **passed this run** |
| DB CHECK accepts 'mirror_missing' before code can write it | ✓ VERIFIED | Migration 0022 re-adds `cadences_stop_reason_known` with the 8-member vocabulary (WIDENING ONLY, 0018 idiom); journaled idx 22, applied to hosted DB (remote dispatch test writes the value and succeeds — a stale 7-member CHECK would throw) |
| Console renders an honest label | ✓ VERIFIED | `page.tsx:126` — "the quote vanished from our records — not a deletion ServiceM8 told us about" |

### Gap-closure code review fixes (7/7 verified in code, not trusted from the fix report)

| Finding | Fix verified | Evidence |
| --- | --- | --- |
| CR-01 replay key not structural | ✓ | Migration 0023: `cadences_replay_key_present` CHECK `NOT VALID` with real-timestamp carve-out (1787907224384 = actual 0021 application) + index narrowed `WHERE created_by_event_id IS NOT NULL`; `tests/helpers/seed.ts` mints synthetic NEGATIVE keys (`nextSeededEventId`, seed.ts:299-350); `tests/leak.test.ts:81,582` keyed; repository test matches refusal **by constraint name** through drizzle's cause chain (`toMatch(/cadences_replay_key_present/)`, cadence-repository.test.ts:282) — refusal witnessed, **passed this run** |
| WR-01 mirror_missing silent | ✓ | `'mirror_missing'` in `DISPATCH_REFUSALS` (dispatch.ts:125) with its own WHY block; returned at dispatch.ts:348; `console.error` IDs-only log at dispatch.ts:340-345 stating irreversibility; tick suites' refusal-map tripwires updated (`cadence-tick.test.ts:453`, `cadence-tick-route.test.ts:91`) |
| WR-02 live index on surrogate quote_id | ✓ | Migration 0024: `cadences_one_live_per_job` UNIQUE `(tenant_id, sm8_job_uuid) WHERE status IN ('active','paused')` — tenant-scoped, kept ALONGSIDE the quote_id index; end-to-end purge→re-sync-under-new-uuid test asserts `cadencesCreated: 0` — **passed this run**; fix report additionally negative-verified (index dropped → 1, restored → 0) |
| WR-03 dedupe key unrecorded on live-index win | ✓ (narrowed claim + pin) | See `accepted_limitations` in frontmatter — assessed acceptably pinned; tripwire test at cadence-repository.test.ts:346-405 demonstrates the latent edge and its trigger conditions, **passed this run** |
| WR-04 tautological assertion | ✓ | Worst-case test now compares tenant-wide touch-id SETS before/after replay (the fixer correctly rejected the review's count-based suggestion, which fails under the shared-tenant file) |
| WR-05 migration 0021 not idempotent | ✓ | 0021 rewritten to `IF NOT EXISTS` house idiom with header documenting hash-not-compared migrator behavior; `prospect-staging-retention` journal guard 16/16 — **passed this run** |
| WR-06 targetless conflict absorbs future constraints | ✓ | Arbiter-set pin in `rls-coverage.test.ts:344-428` reads `pg_index.indisunique` from the **hosted** catalog: pins {pkey, id_tenant_uniq, one_live_per_quote, one_live_per_job, one_per_opened_event}, asserts tenant-scoping + partiality predicates + the `NOT VALID` CHECK exists with `convalidated = false` — **passed this run**, which is also the proof migrations 0021/0023/0024 reached the hosted DB |

## Observable Truths — Roadmap Success Criteria (regression check)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Every synced open quote gets a cadence of up to 5 touches over ~3 weeks with materialized, tz- and contact-hours-aware send times | ✓ VERIFIED | Pure suites 296/296 this run; sequential-cadence test materializes touches [1..5] on hosted DB this run; per-minute production cadence-tick cron verified live and succeeding (initial verification + orchestrator observation) |
| 2 | Reply, won/lost, opt-out, operator kill (per-contact/per-client) each stop or pause deterministically — exhaustive state-machine tests | ✓ VERIFIED | `cadence-transitions.test.ts` exhaustive matrix passed this run (296 pure incl.); consume-events 11 tests passed this run on hosted DB — now STRONGER: replay idempotence holds for all five event types including the stopped-cadence case UAT refuted |
| 3 | A quote can never receive the same touch twice — ledger unique constraint under concurrent ticks | ✓ VERIFIED | `cadence-dispatch.test.ts` 11/11 this run incl. the genuine two-connection race; creation-side never-twice now guarded by THREE arbiters (live-per-quote, live-per-job, one-per-opened-event) pinned against the hosted catalog |
| 4 | Dispatch revalidates quote status, suppression, send window just-in-time | ✓ VERIFIED | Dispatch suite JIT block passed this run: suppressed-after-approval refuse, paused refuse, closed-quote refuse+stop, mirror_missing stop (with own refusal label + log), no-address retirement |
| 5 | Overdue touches re-window instead of sending outside contact hours | ✓ VERIFIED | Rewindow pure suite this run; dispatch "re-windows to a future slot inside the window and claims nothing" this run |

**Score:** 5/5 SCs + 37/37 plan truths (phone-ergonomics truth now human-PASSED via UAT) + 8/8 gap-plan truths = **50/50**. Every behavior-dependent truth was exercised by a test run **during this re-verification** (353 tests executed: 296 pure + 16 journal + 41 remote), not taken from SUMMARY claims.

## Behavioral Spot-Checks (executed this run)

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Pure core regression (transitions, rewindow, window, materialize, primary-contact, jitter) | `npx vitest run tests/cadence-{transitions,rewindow,window,materialize,primary-contact,jitter}.test.ts` | 296/296 | ✓ PASS |
| Journal ordering through idx 24 | `npx vitest run tests/prospect-staging-retention.test.ts` | 16/16 | ✓ PASS |
| G-3-2 replays + WR-02 purge-resync + sequential legality | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-consume-events.test.ts …` | part of 41/41, 4 files, hosted Sydney DB, crons paused/re-armed cleanly | ✓ PASS |
| G-3-5 two-bucket distinction + JIT refusals + race | `… tests/cadence-dispatch.test.ts` | ✓ (same run) | ✓ PASS |
| CR-01 refusal by constraint name + WR-03 tripwire + arbiter witnesses | `… tests/cadence-repository.test.ts` | ✓ (same run) | ✓ PASS |
| WR-06 arbiter-set pin + NOT VALID CHECK against hosted catalog | `… tests/rls-coverage.test.ts` | ✓ (same run) | ✓ PASS |
| Typecheck | `npm run typecheck` | clean | ✓ PASS |

## Required Artifacts (gap-closure delta)

| Artifact | Expected | Status |
| --- | --- | --- |
| `src/db/migrations/0021_cadence_created_by_event.sql` | column + unique index, idempotent idiom | ✓ VERIFIED (journaled idx 21, `when` 1787907224384, monotonic) |
| `src/db/migrations/0022_mirror_missing_stop_reason.sql` | 8-member CHECK, 0018/0020 idiom | ✓ VERIFIED (idx 22) |
| `src/db/migrations/0023_cadence_replay_key_required.sql` | NOT VALID CHECK + narrowed index | ✓ VERIFIED (idx 23; hosted presence proven by rls-coverage) |
| `src/db/migrations/0024_cadence_one_live_per_job.sql` | tenant-scoped partial unique on job uuid | ✓ VERIFIED (idx 24; hosted presence proven by rls-coverage + negative verification) |
| `src/db/schema/cadences.ts` | createdByEventId + both new indexes + mirror_missing + WHY docs | ✓ VERIFIED (lines 196, 208-216, 258, 321, 342) |
| `src/db/repository/for-tenant.ts` | required key + targetless conflict + contract comment | ✓ VERIFIED (160-170, 1102-1145) |
| `src/core/cadence/consume-events.ts` | passes event.id; narrowed replay claim | ✓ VERIFIED (420) |
| `src/core/cadence/dispatch.ts` | mirror_missing writer + refusal member + log | ✓ VERIFIED (125, 322, 340-348) |
| `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx` | mirror_missing label | ✓ VERIFIED (126) |
| Tests (consume-events, dispatch, repository, rls-coverage, seed, leak) | replay pair, bucket pair, tripwires, keys | ✓ VERIFIED (all read + executed) |

Journal: 25 entries, idx 0-24 sequential, `when` strictly monotonic. All 11 gap-closure commits exist in git history (76bc5df, 5209b28, 1fc0c66, f9bc539, b8c337a, a44a120, 448670b, cedcdd6, e3b707d, 8468a11, d4ad72c).

## Key Link Verification (gap-closure delta)

| From | To | Via | Status |
| --- | --- | --- | --- |
| consume-events `createCadenceForQuoteOpened` | `cadences_one_per_opened_event` | `createdByEventId: event.id` → targetless ON CONFLICT → zero rows = 'replayed' | ✓ WIRED (behaviorally: replay tests) |
| dispatch `!chaseable` branch | `cadences_stop_reason_known` CHECK | `stopWhereLive([cadenceId], 'mirror_missing')` | ✓ WIRED (behaviorally: remote write succeeded) |
| `stopReasonForQuote` (!sm8Active → 'removed') | evidence-backed deletion path | untouched, paired test | ✓ WIRED |
| CR-01 CHECK | seed/test writers | synthetic negative keys; NULL-key insert refused by name | ✓ WIRED |

## Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| CAD-01 | ✓ SATISFIED | SC1 + G-3-2 closure strengthens never-twice at creation |
| CAD-02 | ✓ SATISFIED | SC5 + window suites + live per-minute cron |
| CAD-03 | ✓ SATISFIED | SC2 + replay idempotence now unconditional for all reachable paths |
| CAD-04 | ✓ SATISFIED | SC3 + G-3-5 keeps the evidence chain honest for Phase 7 |
| CAD-05 | ✓ SATISFIED | SC4 + mirror_missing now loud (own refusal label + log) |

No orphaned requirements; REQUIREMENTS.md maps exactly CAD-01…CAD-05 to Phase 3.

## Anti-Patterns Found

None. No TBD/FIXME/XXX in any gap-closure file. The `sender.ts` "placeholder" doc comment remains the deliberate D-13 StubSender design (deferred to Phase 4, tracked in `deferred`).

## Prohibitions (3 judgment-tier — RESOLVED)

All three were signed off in the completed UAT session (test 6, result: pass) with independent adversarial confirmation recorded: (1) stub sends structurally distinguishable (`sender='stub'`/`outcome='stub_sent'` + CHECK); (2) no un-suppress path (insert/exists/list namespace, 0017 SELECT-only grants, leak test); (3) no customer PII in tick response/cron/logs (enumerated counts-only body, leaf-walking test, IDs-only console lines). Human resolution obtained — no longer flagged.

## Accepted Limitation (not a gap)

**WR-03** — see frontmatter `accepted_limitations`. The replay guarantee is conditional on the event id having been recorded; the uncovered edge (live-index refusal discards the id) is unreachable via any production path today, documented at every site a future author would touch, and pinned by a repository-level tripwire. **Phase 4 planning note:** any new `chase_eligibility` writer must revisit this before landing — the tripwire does not trip on reachability.

## Human Verification Required

None. All six prior items were resolved through the completed UAT session; the gap fixes introduced no new visual/UX/external-service behavior beyond a console label string (verified textually).

## Gaps Summary

No gaps. G-3-2 and G-3-5 are closed with structural (database-enforced) mechanisms, behaviorally proven against the hosted Sydney database during this re-verification, and hardened by a scoped review whose 7 findings are all verified fixed in code.

---

_Verified: 2026-08-28T10:35:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after UAT gap closure — 353 tests executed this run (296 pure, 16 journal guard, 41 remote on hosted DB), typecheck clean_
