---
phase: 02-servicem8-sync-quote-leakage-audit
fixed_at: 2026-08-26T17:25:58Z
review_path: .planning/phases/02-servicem8-sync-quote-leakage-audit/02-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 12
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-08-26T17:25:58Z
**Source review:** `.planning/phases/02-servicem8-sync-quote-leakage-audit/02-REVIEW.md`
**Iteration:** 1
**Scope:** `critical_warning` — 3 critical + 9 warning. The 6 Info findings were out of scope and are untouched.

**Summary:**

- Findings in scope: 12
- Fixed: 12
- Skipped: 0

**Verification environment:** the **main checkout**, not an isolated worktree. `.planning/config.json` sets `workflow.use_worktrees: false`, so per that opt-out all edits and commits were made directly on `main`. The numbers below are reproducible from the tree as it stands.

## Verification

| Gate | Before | After |
|---|---|---|
| `npx tsc --noEmit` | clean | **clean** |
| `npm run lint` (`--max-warnings=0`) | clean | **clean** |
| `npm run build` | 10 routes | **clean, 10 routes** |
| Non-DB suites (`vitest run`, 24 files) | 326 passed (17 files) | **507 passed (24 files)** |
| DB-backed suites (11 files) | not run | **not run — see below** |

### The 490-test baseline could not be reproduced here, and this matters

The task brief cites 490 green tests. That number is only reachable with a live Supabase stack, and **this machine has neither Docker nor a `.env.test`** — `tests/helpers/env.ts` is a global `setupFile`, so with `.env.local` pointing at the hosted Sydney project every one of the 28 suites aborts at setup with:

> Refusing to run integration tests against a non-local Supabase stack.

That guard is deliberate (it is the fix for a prior WR-09) and it is correct: these suites create auth users and `INSERT`/`UPDATE`/`DELETE` with the service-role key, so running them here means **running destructive tests against production data**. `npm run test:remote` exists to say yes to that, and it is a decision for you, not for me — I did not run it.

What I did instead: split the suites by whether they touch the database, and ran the 17 that do not to establish a real baseline (**326 passed**), then re-ran them plus my 7 new/moved suites after the fixes (**507 passed**). The 11 DB-backed suites — `auth-security`, `baseline-winrate`, `connect-servicem8`, `convert-prospect`, `cron-schedules`, `leak`, `prospect-audit`, `prospect-purge`, `rekey-resume`, `rls-coverage`, `tenant-create` — **have not been run against these changes**.

**Please run `npm run test:remote` (or point `.env.test` at a throwaway project) before treating this phase as verified.** Three fixes touch code those suites cover directly: CR-01 (`prospect-audit`, `convert-prospect`), CR-03 (`prospect-purge`), WR-06 (`rekey-resume`).

## Fixed Issues

### CR-01: Prospect/audit server actions authorize nobody

**Files:** `src/app/(console)/_auth.ts` (new), `audits/new/actions.ts`, `audits/[id]/actions.ts`, `audits/[id]/mapping/actions.ts`, `audits/[id]/mapping/page.tsx`, `tests/operator-authorization.test.ts` (new)
**Commit:** `226eadc`
**Status:** fixed — **requires human verification** (the RLS read has not been executed against Postgres here)

Added `requireOperator()`, which reads `operator_allowlist` through the operator's own JWT so Postgres decides membership — the same shape `clients/[id]/actions.ts` already uses to prove tenant membership. Wired into all three actions (auth-first, before the body is read) and into `MappingPage` before `getProspectStaging`. A read error is treated as denial, not as a pass. Corrected the comment at `audits/new/actions.ts` that taught the opposite.

`MappingPage` returns `notFound()` for a non-operator rather than a distinct error, so the page is not an existence oracle either.

15 tests assert the property over the whole set of guarded files (including that none of them still treats a bare `getClaims()` as authorization) rather than only on paths someone remembered to cover.

---

### CR-02: `deriveHealth` ignores staleness

**Files:** `src/core/sync/health.ts`, `tests/sync-health.test.ts` (new), `tests/rekey-resume.test.ts`
**Commit:** `d1094bf`
**Status:** fixed — **requires human verification** (a logic/threshold change)

Added `STALE_AFTER_MS` (15 min = three missed ticks) checked below the failure count, plus an explicit `NaN` guard so a corrupt timestamp degrades rather than falling through to `healthy`. `now` is a defaulted parameter; both call sites are unchanged.

Also corrected the module header, which claimed "derivation cannot lie in that direction" — derivation only guarantees the answer is a fresh function of the inputs, not that the inputs are still moving.

I moved the pure `deriveHealth` tests out of the DB-bound re-key suite into `tests/sync-health.test.ts` and extended them (17 tests). They never needed a database, and leaving them there meant the rules behind every console badge were only provable on a machine with Docker — which is precisely the wrong property for the rule that detects the system having stopped.

---

### CR-03: `prospects.csv_staging` has no retention

**Files:** `src/db/schema/prospects.ts`, `src/db/repository/prospects.ts`, `src/db/migrations/0015_prospect_staging_expiry.sql` (new), `meta/_journal.json`, `meta/0015_snapshot.json`, `tests/prospect-staging-retention.test.ts` (new)
**Commit:** `4dd49a2`
**Status:** fixed — **requires human verification: the migration has NOT been applied**

Added `csv_staging_expires_at`, stamped by Postgres in `createProspect` whenever staging is written and cleared with the payload in `storeAuditResults`. The column is deliberately absent from `ProspectCreate`, so *staged-without-an-expiry is unrepresentable* rather than merely discouraged — the same structural argument `storeAuditResults` makes for `purge_after`. Migration 0015 backfills existing staged rows, adds a partial index, and schedules an hourly `prospect-staging-sweep` clearing both columns.

**Action required:** run `node scripts/migrate.mjs`. I could not apply it (no local stack, and migrating the hosted project is your call). Until it runs, the code writes a column that does not exist — `createProspect` will fail on the CSV path.

I followed the `drizzle-kit generate` → rename → re-stamp convention rather than hand-writing around the snapshot, and **the journal trap fired again, for the fourth consecutive plan**: drizzle stamped `when: 1787763332880`, behind 0014's `1787810700000`, which `migrate.mjs` would have skipped — exiting 0 with the column never created. Re-stamped to `1787810800000`. There is now a test asserting the journal is monotonic, so the fifth occurrence fails loudly instead of silently.

---

### WR-01 + WR-02: webhook enumeration oracle; fail-open debounce

**Files:** `src/app/api/webhooks/servicem8/route.ts`, `src/db/repository/for-all-tenants.ts`, `tests/webhook-hint.test.ts`
**Commit:** `62721c1` (both findings)
**Status:** fixed — **requires human verification** (the `lastAttemptAt` subquery has not been executed against Postgres)

**Deviation from one-commit-per-finding, stated plainly:** both fixes rewrite the same `POST` branches. Splitting them would have staged an intermediate commit that neither compiles nor expresses either fix, which seemed worse than a commit naming both.

*WR-01:* every non-challenge POST now returns one constant `{status:'accepted'}`. The test asserts **byte-identity** across mirrored / unknown / paused / debounced / unparseable rather than five separate constant checks — the property is that they cannot be told apart, which is stronger. The timing channel is documented as remaining; closing it needs a durable queue (pgmq, Phase 3), not a detached promise Vercel may kill.

*WR-02:* debounces on `max(lastSuccessAt, lastAttemptAt)`, where `lastAttemptAt` is `max(sync_runs.started_at)` — written on every cycle regardless of outcome, and served by the existing `(tenant_id, started_at)` index. Tests cover the case that was worst: a never-succeeded connection, where the old rule read `NULL` as `POSITIVE_INFINITY`, i.e. "never debounce, ever".

---

### WR-03: sequential tick starves the tail of the client list

**Files:** `src/core/sync/run-sync.ts`, `src/db/repository/for-all-tenants.ts`, `src/app/api/internal/sync-tick/route.ts`, `tests/sync-tick-budget.test.ts` (new)
**Commit:** `610cc04`
**Status:** fixed — **requires human verification** (a logic/threshold change; the reordered SQL has not been executed)

Three parts: a `TICK_DEADLINE_MS` budget checked *before* each cycle starts (never mid-cycle — a started cycle owns a transaction and a decrypted credential); a `skipped` flag on `SyncCycleResult` surfaced as a count in the route response; and reordering by `last_success_at ASC NULLS FIRST` so a client skipped by one tick leads the next.

**The headroom test caught a real error in my own first draft.** I initially set the deadline to 240_000, leaving exactly 60s inside `maxDuration = 300` — less than the ~65s worst-case cycle it has to cover, which would have let the platform kill a cycle mid-transaction. That is strictly worse than the starvation being fixed. Now 220_000, pinned by an assertion rather than by arithmetic in a comment.

---

### WR-04: `fetchAllPages` returns `ok: true` with truncated data

**Files:** `src/core/servicem8/pagination.ts`, `src/core/audit/fetch-history.ts`, `tests/pagination-cap.test.ts` (new)
**Commit:** `a936f10`
**Status:** fixed

Added an `exhausted` flag that starts pessimistic and is set by each of the three legitimate terminations, so a `break` added later without thought fails closed. Hitting the cap returns `parse_error` (weather, not an auth pause — T-2-09) with a detail naming only the resource and the cap.

Also filtered the audit's `jobcontact.json` fetch on `edit_date`. I checked before changing it: `run-sync.ts` already sends exactly this filter for that resource, so this makes the audit path and the connected-client path ask ServiceM8 the same question — the parity `fetch-history.ts`'s own header argues for — rather than introducing a new assumption.

**A second test caught a second error of mine:** I had asserted that a full page under `maxPages: 1` should be a success. It should not — one page was read, the cap stopped the walk, and nothing proved there was no second page. Guessing in the caller's favour there is the exact silent partial-success being removed. The assertion now says `ok: false`, and a separate test covers the real production path (the cursor-ignoring API terminating cleanly via `fresh === 0`).

---

### WR-05: API and CSV `followedUp` use different rules

**Files:** `src/core/audit/csv-mapping.ts`, `src/app/(console)/audits/[id]/page.tsx`, `tests/csv-mapping.test.ts`
**Commit:** `d508ec1`
**Status:** fixed — **requires human verification; please read the caveat below**

Implemented the review's primary recommendation rather than its fallback: added `work_order_date` / `unsuccessful_date` / `completion_date` as optional canonical fields (inferred from the real export headers) and routed them through `isFollowedUp`, so one function owns the timing rule. `Invoice Sent Stamp` is deliberately excluded — it is an invoicing event, the API path does not count it, and binding it would recreate the divergence.

When no stamp column is mapped the movement test still stands: an empty signal list would otherwise mark *every* row a leak, which is the wrongly-claimed-leak error this codebase repeatedly warns is the one that discredits the document. `blankMapping()` is now derived from `CANONICAL_FIELDS` so the key list cannot drift. The mapping form and `confirmCsvMapping` pick the new fields up automatically (both iterate `CANONICAL_FIELDS`), and the report footnote now states the timing rather than implying a bare status change.

> **⚠ This materially changes CSV audit figures, and you should decide whether you want it.**
>
> On the synthetic trial fixture — where every status change lands *seconds* after its quote — the whole book now reads as leaked ($17,918.75 instead of $6,090). That is exactly what the API path computes for the same data at the same instant, so it is the intended agreement and the test now says so explicitly. But it surfaces something neither the review nor I should decide silently: **D-10 counts a quickly-won job as "never followed up" on BOTH paths.** A tradie who quotes and wins same-day would be shown their entire book as recoverable leakage.
>
> That is a pre-existing property of the API path, not something introduced here — WR-05 was about the two paths agreeing, and they now do. But it is a product/methodology question worth answering before the next audit goes in front of a prospect.

---

### WR-06: `resumeConnection` reports success when the UPDATE matched no rows

**Files:** `src/core/sync/connect.ts`, `tests/resume-write-guard.test.ts` (new)
**Commit:** `7aba3f8`
**Status:** fixed

Guarded the write before entering the `try`, following the precedent `recordFailure` already sets for the deleted-mid-cycle case. This also un-blurs that `catch`: it now covers only what its comment claims, so a programming error is no longer indistinguishable from a database blip.

Proved behaviourally (not just structurally) with a stubbed repository — the trigger is a race, and reproducing it against real Postgres proves less than it costs. 9 tests, including that the happy path and the "failed immediate sync is still a successful re-key" rule (D-08) both still hold.

---

### WR-07: `incrementFailures` computed, documented, never read

**Files:** `src/core/sync/run-sync.ts`, `tests/failure-policy.test.ts`
**Commit:** `2b966fd`
**Status:** fixed

Chose to honour it rather than delete it — the review said either was fine, and the field is the natural home for a future "do not count a 429 against the degraded threshold" rule. Added a test asserting **every** field of the returned decision is read somewhere in `run-sync`, so the next field added cannot become the next WR-07.

---

### WR-08: Raw PostgREST error messages rendered into console pages

**Files:** `src/app/(console)/page.tsx`, `audits/page.tsx`, `audits/[id]/page.tsx`, `clients/[id]/page.tsx`, `tests/console-error-leak.test.ts` (new)
**Commit:** `53531f0`
**Status:** fixed

Each of the four sites now logs `error.code` server-side and renders a fixed sentence. The test scans **every** file under `(console)` — not just the four named — for `{*.message}` in JSX, stringified errors, and (in the other direction) that each page still reports the failure with `role="alert"` rather than swallowing it. It also asserts the `console.error` calls log the *code* and never the *message*, since relocating the leak from page to log would only change who leaks it.

---

### WR-09: `forAllTenants_webhookHint` uses `LIMIT 1` with no `ORDER BY`

**Files:** `src/db/repository/for-all-tenants.ts`, `tests/webhook-hint.test.ts`
**Commit:** `8947e54`
**Status:** fixed — **requires human verification** (the SQL has not been executed)

Ordered by `last_success_at ASC NULLS FIRST` with `tenant_id` as tiebreak — the same ordering `forAllTenants_syncTick` now uses, so both cross-tenant accessors resolve "who is furthest behind" identically. Asserted against source, since the defect was the *absence* of an `ORDER BY` and provoking a plan change proves less than it costs.

## Notes for the next step

1. **Run `node scripts/migrate.mjs`** — CR-03 adds a column the code already writes. This is the one item that will break at runtime if skipped.
2. **Run the 11 DB-backed suites** (`npm run test:remote`, or point `.env.test` somewhere disposable). CR-01, CR-03 and WR-06 touch code they cover.
3. **Decide the WR-05 methodology question** above before the next prospect audit.
4. Six Info findings (IN-01…IN-06) were out of scope and remain open.
5. Two of my own fixes were wrong on the first attempt and were caught by tests I wrote in the same commit (the WR-03 deadline headroom, the WR-04 cap-of-1 expectation). Both are noted in their sections — worth knowing that the test-first framing was load-bearing rather than ceremonial.

---

_Fixed: 2026-08-26T17:25:58Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
