---
phase: 02-servicem8-sync-quote-leakage-audit
verified: 2026-08-26T17:45:38Z
status: passed
score: 9/13 must-haves verified
behavior_unverified: 4
overrides_applied: 0
behavior_unverified_items:

  - truth: "Operator can connect a client's ServiceM8 account and see per-client sync health (SC1)"
    test: "npm run dev, sign in, open a client, paste the trial API key, submit"
    expected: "Button disables and reads 'Verifying key…'; on success the connection shows key_last4, backfilled quotes render, badges show on the client list"
    why_human: "Console UI was never visually loaded in any plan (02-01-SUMMARY 'UAT — needs a human'); the live connect round-trip cannot be exercised without the operator's trial key and a browser"

  - truth: "Open quotes appear in the system within one polling interval (SC2)"
    test: "Deploy, then APP_BASE_URL=https://<url> npm run cron:apply; edit a job in ServiceM8; wait ≤5 min"
    expected: "cron:apply prints 'sm8-sync-tick  schedule=*/5 * * * *  active=true'; the edited quote updates in the console within one tick"
    why_human: "The pg_cron schedule is NOT applied in production — scripts/apply-cron-schedules.mjs is tested and idempotent but needs a deployed URL that does not exist yet (02-03-SUMMARY line 202, declared user_setup)"

  - truth: "When a client's ServiceM8 auth fails, cadences pause and the operator is alerted immediately (SC4)"
    test: "Revoke the trial key, wait one tick; then paste a fresh key via Replace key"
    expected: "Persistent red banner + auth-failed badge + exactly ONE alert email in the operator inbox; re-key clears the banner, badge returns to healthy, sync resumes"
    why_human: "Live Resend delivery is unobserved (research assumption A6: pre-domain-verification sender delivers to account owner); pause/dedupe logic is unit-tested but external email delivery always needs a human witness (02-04-PLAN deferred human-check)"

  - truth: "Operator can generate a one-page Quote Leakage Audit with baseline snapshot (SC5)"
    test: "Open a generated audit on a phone, print-preview from a dark-mode device; repeat with a 60-char business name and 7-digit values"
    expected: "Exactly one A4 page, light ink-on-paper palette, hero recoverable-estimate figure accented, methodology footnote present"
    why_human: "One-A4-page rendering is a declared verification: backstop truth (abstains to human by design); the audits pages were never visually loaded (02-07-PLAN deferred human-check)"
human_verification:

  - test: "Console visual pass: npm run dev, sign in; check client list (Sync + Last sync badge columns), client detail (connect form with masked input + 'Verifying key…' pending state, quotes table with Open/Won/Lost/All filter, triage checklist), audits list/new/detail pages"
    expected: "All UI-SPEC copy, empty states, and badges render as specified; no layout breakage on a phone-width viewport"
    why_human: "Visual appearance cannot be verified programmatically; source assertions confirm the copy exists but nobody has loaded a page this phase"

  - test: "Auth-failure UAT (02-04 planner-deferred human-check): revoke the trial ServiceM8 key, confirm banner + auth-failed badge + exactly one email arrive; paste a fresh key via Replace key and confirm banner clears, badge heals, immediate sync runs"
    expected: "One email per episode (never 288/day), banner non-dismissible until verified re-key, auto-resume with zero manual flag-clearing"
    why_human: "Requires the live trial account and observing real email delivery through Resend"

  - test: "Production tick: deploy to Vercel, run APP_BASE_URL=<prod-url> npm run cron:apply against the live DB, then observe one 5-minute cycle"
    expected: "sm8-sync-tick scheduled */5 * * * * active=true; sync_runs rows accrue; quotes mirror within one interval"
    why_human: "Needs the deployed production URL and live Supabase — declared user_setup in 02-03-PLAN, not yet performed"

  - test: "A4 print backstop (02-07 planner-deferred human-check): print-preview a generated audit from a dark-mode phone; repeat with worst-case fixture (60-char name, 7-digit dollar values)"
    expected: "Stays on one A4 page, forced light colors, nav/actions hidden"
    why_human: "verification: backstop truth — print rendering is not inferable from source"

  - test: "Phone-overflow backstop (02-05): load a client with 200+ backfilled open quotes on a 390px-wide viewport"
    expected: "Table remains scrollable and the triage Save button reachable"
    why_human: "verification: backstop truth — scroll/reachability is a rendered-layout property"

  - test: "DB-backed suite confirmation: run `npm run test:remote` (or point .env.test at a throwaway/local stack) once"
    expected: "All integration suites pass (SUMMARY claims 664 total incl. DB suites; verifier independently ran only the 185 pure unit tests — the DB suites mutate the hosted project and were not re-run)"
    why_human: "Running them writes rows with the service-role key against the hosted project; the verifier must not mutate state"

  - test: "Prohibition sign-off (5 judgment-tier items, LLM-judge verdict: all upheld, NON-AUTHORITATIVE): (1) no plaintext API key persisted/logged/rendered; (2) backfill emits no won/lost events; (3) no backfilled quote chase-eligible without triage save; (4) prospect audit rows never reach tenant sync/cadence; (5) audit figures never render without the methodology footnote/constant"
    expected: "Human confirms each judge verdict (evidence in the Prohibitions table below)"
    why_human: "Judgment-tier prohibitions require explicit human resolution at the end-of-phase checkpoint — never a silent pass"
---

# Phase 2: ServiceM8 Sync & Quote Leakage Audit — Verification Report

**Phase Goal:** Every connected client's open quotes mirror into the system reliably with won/lost detection, and the operator can produce the Quote Leakage Audit from any prospect's data
**Verified:** 2026-08-26T17:45:38Z
**Status:** human_needed
**Re-verification:** No — initial verification

**Mode note (WARNING):** ROADMAP marks this phase `mode: mvp`, but the goal is not User Story format (`user-story.validate` → invalid on all four slots). The phase was planned and executed against 5 explicit roadmap Success Criteria, so verification ran goal-backward against those SCs — the higher-fidelity contract. Flagging the metadata inconsistency for the user; no User Flow Coverage table was produced.

## Goal Achievement

### Observable Truths

Merged must-haves: 5 roadmap Success Criteria + 8 cross-cutting plan truths (deduplicated from 7 plans' frontmatter; plan truths that restate an SC are folded into it).

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC1: Operator can connect a client's ServiceM8 account (private API key) and see per-client sync health | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | All artifacts + 4 key links verified; `connectServiceM8` verifies-then-writes in one tx (connect.ts:116-248); health derived not stored (health.ts, sync-health tests PASS); console UI never visually loaded; live connect not witnessed by verifier |
| 2 | SC2: Open quotes appear within one polling interval; cursor polling stays in rate limits; timestamps normalize | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | filterFrom/advanceCursor overlap semantics tested (sync-cursor PASS); normalization tested (sm8-normalize PASS); pagination cap test exists; **production cron schedule unapplied** (02-03-SUMMARY:202) — mechanism exists, cadence unproven live |
| 3 | SC3: Won/lost in ServiceM8 produces a status-transition event the cadence engine can consume | ✓ VERIFIED | `classifyTransition` total-function behavior tests PASS (won incl. Quote→Completed skip, lost incl. WO→Unsuccessful, reopened, removed); same-tx outbox insert code-verified (run-sync.ts:453-537 single `repo.transaction`); `quote_status_events` + `event_consumer_cursors` schema present; DB idempotence suite enumerated (sync-upsert: "identical page twice → identical rows, zero new events") |
| 4 | SC4: Auth failure pauses that client's cadences and alerts the operator immediately | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | applyFailurePolicy tests PASS: 401/403 pauses on FIRST occurrence, transient never pauses, degraded at 3rd, `alerted_at` episode dedupe; sendOperatorAlert wired as default sink (run-sync.ts:304,418); live Resend delivery unobserved (external service) |
| 5 | SC5: One-page Quote Leakage Audit (90-day figures + recoverable estimate) with baseline win-rate snapshot | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Aggregation integer-cents math tested (audit-aggregate PASS); CSV mapping tested against real export fixture (csv-mapping PASS); both API and CSV paths land in prospect_quote_lines; A4 one-page = backstop truth → human; audit UI never loaded |
| 6 | Cursor advances to max observed edit_date (never our clock) with 15-min overlap | ✓ VERIFIED | cursor.ts `OVERLAP_MINUTES = 15`, `advanceCursor(prev, observed)`; sync-cursor tests PASS; sync-upsert enumerates "advances the cursor to the maximum observed edit_date, never our clock" |
| 7 | Money parses via integer-cents string math; naive timestamps normalize via tenant TZ; zero-dates → null | ✓ VERIFIED | sm8-normalize tests PASS; aggregate.ts documents and enforces no float money math (`cents * 1500 / 10_000`); audit-aggregate tests PASS |
| 8 | Failure policy: auth pauses first occurrence; single transient never pauses/alerts; degraded only at 3rd consecutive; one alert per episode | ✓ VERIFIED | failure-policy.ts `DEGRADED_AFTER_FAILURES = 3`, `alertKind: alertedAt === null ? 'auth' : null`; failure-policy tests PASS; WR-07 fix honours `incrementFailures` (commit 2b966fd) |
| 9 | Tick route: 401 (never 307) without secret via timing-safe compare; awaits runSyncTick; maxDuration 300; syd1 | ✓ VERIFIED | route.ts uses `timingSafeEqual` with length guard, `maxDuration = 300`, awaited `runSyncTick` (no waitUntil); proxy.ts matcher excludes `api/`; vercel.json `"regions": ["syd1"]` |
| 10 | Webhook answers challenge and is hint-to-poll only — no payload field ever written; always 200 | ✓ VERIFIED | webhooks/servicem8/route.ts: challenge echo (POST + GET), zod-parsed envelope, re-fetch via `runSyncForConnection`, "grep this file for a write: there is none"; every response 200; WR-01/WR-02/WR-09 hardening commits verified |
| 11 | Baseline win rate: null (never 0) for zero-issued; 72h follow-up boundary; recoverable estimate and footnote from the single AUDIT_RECOVERY_RATE constant | ✓ VERIFIED | aggregate.ts `winRate: string \| null` with explicit null≠0 contract; constants.ts exports RATE/GRACE/WINDOW; audits/[id]/page.tsx imports the constant for both figure and footnote, CSV addendum conditional on `csv_note_degraded`; audit-aggregate tests PASS; baseline-winrate suite enumerated (null-never-0, boundary, numeric(5,4)) |
| 12 | CSV upload with confirmed column mapping produces the same audit as the API path | ✓ VERIFIED | csv-mapping.ts exports inferMapping/validateRows/CANONICAL_FIELDS; csv-mapping tests PASS (calibrated against tests/fixtures real Job List export); mapping actions wired through validateRows; staging expiry added by migration 0015 (CR-03 fix) |
| 13 | Credentials stored as AES-256-GCM `enc:v1` ciphertext; only key_last4 rendered | ✓ VERIFIED | crypto.ts `enc:v1:<iv>:<tag>:<data>` format; credential-crypto tests PASS; repo-wide grep found zero key/credential/secret logging; rekey-resume suite asserts "neither page selects the credential envelope" |

**Score:** 9/13 truths verified (4 present, behavior-unverified — see Human Verification)

### Required Artifacts

All 30 declared artifacts across 7 plans exist and pass substantive checks (`verify.artifacts`: 30/30 exist, 1 pattern note below). Summary of the load-bearing set:

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| src/db/schema/{sm8-connections,quotes,quote-events,prospects,tenants}.ts | Data model incl. outbox, purge_after, prospect_id link | ✓ VERIFIED | Unique tenant_id, alerted_at dedupe field, `prospectId` FK on tenants |
| src/core/servicem8/client.ts + schemas/normalize/pagination | Typed Sm8 boundary | ✓ VERIFIED | Shared by sync AND audit paths (D-12) |
| src/core/sync/{connect,run-sync,cursor,transitions,failure-policy,health,eligibility}.ts | The sync engine | ✓ VERIFIED | All exports present, imported, and exercised by tests |
| src/app/api/internal/sync-tick/route.ts + scripts/apply-cron-schedules.mjs | Tick wiring | ✓ VERIFIED | sm8-sync-tick `*/5 * * * *`; schedule NOT yet applied in prod (human item) |
| src/app/api/webhooks/servicem8/route.ts | Challenge + hint-to-poll | ✓ VERIFIED | No DB writes from payload |
| src/core/audit/{constants,aggregate,fetch-history,csv-mapping,followup}.ts | Audit pipeline | ✓ VERIFIED | Single-constant methodology; WR-05 grace rule applied to CSV path |
| src/app/(console)/audits/** + audits/[id]/audit.css | Audit console + A4 print sheet | ✓ VERIFIED | `@page { size: A4 }`, `@media print` forced light palette; requireOperator on all actions (CR-01) |
| src/core/alerts/operator-email.ts | Typed, never-throwing alert sink | ✓ VERIFIED | Pure alertBody, closed outcome vocabulary |
| src/app/(console)/page.tsx | Client list Sync + Last sync columns | ✓ VERIFIED (note) | `contains: badge--` pattern check failed on the literal — the badge classes live in health.ts `HEALTH_BADGE_CLASS` (badge--ok/warn/error) and page.tsx renders them at line 136. Genuine indirection, not a stub; rekey-resume suite asserts the four badge modifiers exist |
| Migrations 0006–0015 (journal: 16 entries) | Schema + grants + cron cleanup + purge + staging expiry | ✓ VERIFIED | 0012 job_run_details weekly cleanup; 0014 prospect-line-purge cron; 0015 csv_staging_expires_at retroactive backfill |

### Key Link Verification

`verify.key-links`: **19/19 verified** across all 7 plans. Highlights: actions→connectServiceM8, connect→createSm8Client→encryptCredential, run-sync→classifyTransition→quote_status_events (same tx), run-sync→applyFailurePolicy, run-sync→sendOperatorAlert, cron script→tick route→runSyncTick, saveEligibility→markChaseEligible→quote_opened, audit actions→fetch90DayQuoteHistory→shared Sm8Client, connect→computeBaseline, mapping actions→validateRows, audit page→AUDIT_RECOVERY_RATE.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| clients/[id]/page.tsx | quotes table rows | RLS-governed select on `quotes` mirror populated by connect backfill + runSyncForConnection upserts | Yes | ✓ FLOWING |
| (console)/page.tsx | health badge | `deriveHealth(connection)` over sm8_connections fields written by the sync tx | Yes | ✓ FLOWING |
| audits/[id]/page.tsx | figures + footnote | Persisted prospect aggregates (`quotes_issued … csv_note_degraded` select at page.tsx:140) computed by computeAuditFigures | Yes | ✓ FLOWING |
| quote_status_events | outbox rows | Inserted in the same tx as the quote upsert; consumer cursor table present for Phase 3 | Yes | ✓ FLOWING |

No static returns, hardcoded literals, or mock terminations found on any rendered value.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Pure sync/audit logic invariants (8 files, 185 tests: transitions, cursor, failure-policy, aggregate, csv-mapping, crypto, normalize, health) | `ALLOW_REMOTE_TESTS=yes npx vitest run <8 pure files>` (guard bypass only; zero DB refs in these files) | 185 passed / 185 | ✓ PASS |
| Type soundness | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| DB-backed invariants (idempotent upsert, backfill-no-events, quote_opened dedupe, rekey-resume, purge, RLS leak, tick budget) | `vitest list` enumeration — 11 suites, names match every invariant | Tests EXIST; not run (would mutate hosted project) | ? SKIP → human |
| Review-fix commits real | `git cat-file -t 226eadc / 8947e54` | both `commit`; all 12 CR/WR fix commits present in log | ✓ PASS |
| Cron schedule content | grep apply-cron-schedules.mjs | `sm8-sync-tick`, `*/5 * * * *` | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and no plan declares probes — SKIPPED (not a probe-based phase).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| ONB-02 | 02-01, 02-04 | Connect ServiceM8 + per-client sync health | ✓ SATISFIED (UI residue → human) | Connect flow, enc:v1 storage, derived health badges, re-key auto-resume |
| SYNC-01 | 02-01/02/03/05 | edit_date-cursor polling inside rate limits | ✓ SATISFIED | Cursor tests PASS; page-cap-as-failure (WR-04); tick budget (WR-03) |
| SYNC-02 | 02-02, 02-05 | Transition events the cadence engine consumes | ✓ SATISFIED | Truths 3 + eligibility flip; consumer cursor contract |
| SYNC-03 | 02-01, 02-03 | Webhooks as hints-to-poll + timestamp normalization | ✓ SATISFIED | Truth 10 + normalize tests PASS; polling remains the guarantee |
| SYNC-04 | 02-02, 02-04 | Auth failure pauses cadences + immediate alert | ✓ SATISFIED (live email → human) | Truths 4, 8 |
| AUD-01 | 02-06, 02-07 | One-page audit from read access or CSV | ✓ SATISFIED (A4 print → human) | Truths 5, 11, 12 |
| AUD-02 | 02-06, 02-07 | Baseline win rate snapshotted | ✓ SATISFIED | Truth 11; snapshot survives conversion (purge_after cleared, prospect_id link) |

No ORPHANED requirements: REQUIREMENTS.md maps exactly these 7 IDs to Phase 2 and every one is claimed by at least one plan.

### Prohibitions (5 judgment-tier — flagged, NON-AUTHORITATIVE judge verdicts)

| Prohibition | Judge verdict | Evidence |
| --- | --- | --- |
| ONB-02: no plaintext API key anywhere | UPHELD | Repo grep clean of key/credential logging; only ciphertext + key_last4 stored; tests: "never leaks a rejected key into the failure result", "neither page selects the credential envelope" |
| SYNC-02: no won/lost events from backfill | UPHELD | connect.ts writes quotes without events by construction; sync-upsert test "keeps event emission out of the backfill path"; quote-events test "never announces a quote that predates the connection" |
| SYNC-02/D-15: no backfilled quote chase-eligible without explicit triage save | UPHELD | connect.ts:208 `chaseEligibility: 'needs_review'` always; markChaseEligible flips only needs_review rows in one tx; quote-triage suite covers idempotence + cross-tenant refusal |
| AUD-01: prospect rows never reach tenant sync/cadence | UPHELD | prospects keyed by prospect_id with is_operator() RLS; conversion sets tenants.prospect_id + clears purge_after only — no row migration; convert-prospect suite |
| AUD-01: figures never render without methodology footnote/constant | UPHELD | page.tsx imports AUDIT_RECOVERY_RATE for both figure and footnote; CSV addendum renders iff csv_note_degraded; 02-07 acceptance asserts no literal rate string |

All five are recorded as human-verification items — never silently absorbed into a pass.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | No TBD/FIXME/XXX/TODO/HACK/placeholder markers in src/ or scripts/ | — | None |

ℹ️ Info: `deferred-items.md` logs 4 moderate npm audit advisories via drizzle-kit devDependency (esbuild ≤0.24.2) with an explicit revisit trigger — deliberate, documented, dev-only; not a phase gap.

### Human Verification Required

See frontmatter `human_verification` — 7 items: (1) console visual pass, (2) auth-failure/re-key UAT with live email, (3) production cron apply + observed tick, (4) A4 print backstop, (5) 390px phone-overflow backstop, (6) one `npm run test:remote` run to confirm the DB-backed suites, (7) prohibition sign-off. Items 2 and 4 were harvested from planner-deferred `<human-check>` blocks in 02-04/02-07 PLAN (end-of-phase UAT mode).

### Gaps Summary

No gaps. Every artifact exists and is substantive, all 19 key links are wired, no stub or anti-pattern was found, and 185 pure behavioral tests plus a clean `tsc` run were executed by the verifier in-session. Four Success-Criteria truths are present-and-wired but behaviorally unproven in this session: the console UI has never been visually loaded, live alert-email delivery is unobserved, the production 5-minute cron schedule is unapplied (needs a deployed `APP_BASE_URL`), and A4 print rendering is a declared backstop. These, plus the DB-integration suite confirmation and the five judgment-tier prohibitions, route to the human checkpoint. The phase goal is achieved at the code level; sign-off requires the operator's eyes and the deployed environment.

---

_Verified: 2026-08-26T17:45:38Z_
_Verifier: Claude (gsd-verifier)_
