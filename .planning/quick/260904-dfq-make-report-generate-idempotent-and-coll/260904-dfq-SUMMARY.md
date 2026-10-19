---
phase: quick-260904-dfq
plan: 01
subsystem: reporting
status: complete
tags: [reporting, idempotency, console, privacy-ruling]
requires:
  - src/core/reporting/generate.ts (the six-arm result union, the one-transaction snapshot)
  - src/db/repository reports.latestVersionOf + reports.byId (no new method added)
provides:
  - src/core/reporting/unchanged.ts — canonicalJson + reportDocumentsUnchanged, an import-free leaf
  - GenerateReportResult arm `unchanged` — the seventh answer, neither refusal nor write
  - generateUnchangedMessage(version, monthLabel) — the operator-facing sentence
  - /reports/[client] grouped list — one row per month, earlier versions in a nested native disclosure
affects:
  - src/app/(console)/reports/[client]/actions.ts (one new branch, ahead of the refusal branch)
  - tests/monthly-report.test.ts (remote — deferred to the next CI window)
tech-stack:
  added: []
  patterns:
    - "Canonical JSON over whole documents, not a field list — a comparator that enumerates fields silently passes the day a document gains one"
    - "The object compared IS the object inserted (one `documents` const) — a second literal is how a comparison and a write drift apart"
    - "Both new reads on the transaction's `repo`, never pool-side `forTenant()` (07 WR-02, max: 5)"
    - "A pure suite whose repository mock OMITS the key it forbids, so the wrong call throws TypeError rather than passing"
key-files:
  created:
    - src/core/reporting/unchanged.ts
    - tests/report-unchanged.test.ts
    - tests/report-list.test.ts
  modified:
    - src/core/reporting/generate.ts
    - src/core/reporting/copy.ts
    - src/app/(console)/reports/[client]/actions.ts
    - src/app/(console)/reports/[client]/page.tsx
    - src/app/(console)/reports/[client]/generate-form.tsx
    - src/app/globals.css
    - tests/reporting-copy.test.ts
    - tests/reports-authorization.test.ts
    - tests/monthly-report.test.ts
    - .planning/phases/07-attribution-reporting/07-03-PLAN.md
    - .planning/phases/07-attribution-reporting/07-VERIFICATION.md
    - .planning/phases/07-attribution-reporting/07-SECURITY.md
decisions:
  - "The `unchanged` sentence rides the SUCCESS slot, not the error slot — nothing went wrong and the next act is the same as after a write"
  - "The `latest` badge renders only where a month HAS earlier versions — on one row per month it was noise"
  - "`ReportRow` derived from `reports.list()`'s return type rather than re-exporting `MonthlyReportSummary` from the barrel — `src/db` stayed untouched"
  - "07-03 P3 ruled: the consumer's one fixed failure sentence may name the tenant uuid; quote id, amount, customer data and the caught error stay forbidden"
metrics:
  duration: ~17 min
  completed: 2026-09-04
actuals:
  tokens: 72600
  tasks: 3
  commits: 3
---

# Quick 260904-dfq: Make report Generate idempotent and collapse superseded versions Summary

Generate now writes nothing when the five frozen documents are byte-identical to the newest stored version, the per-client reports list shows one row per month with superseded versions one tap away, and 07-03 P3's contradiction with its own isolation test is ruled and recorded in four documents.

## What Was Built

**Task 1 — idempotent Generate** (`e510be2`)

`src/core/reporting/unchanged.ts` is a new import-free leaf exporting `canonicalJson(value)` and `reportDocumentsUnchanged(next, previous)`. Its canonicalisation rules are exactly the two normalisations a jsonb round trip performs, and both are load-bearing in opposite directions:

| Rule | Why | Failure it prevents |
|------|-----|---------------------|
| Object keys emitted SORTED | jsonb reorders keys on storage | Without it every stored row compares "changed" and the feature is silently inert — duplicates keep accumulating and nothing fails (T-Q-02) |
| `undefined`-valued entries DROPPED | jsonb cannot carry `undefined`; the key simply is not there on the way out | The generator's own object would never compare equal to what came back |
| `null` KEPT (never conflated with absent) | jsonb stores null and returns it | `note: null` and no note are genuinely different documents |
| Array order PRESERVED | lines are stored in `won_detected_at ASC`, the printed table's order | A reorder is a different document, and two renders of one frozen report must not order a tie differently |

The comparison is over the whole document rather than a field list: a comparator that enumerated `figures.grossCents`, `figures.replies`, … would start silently passing the day a document gains a figure, swallowing a real correction while telling the operator the month is already up to date (T-Q-01). `generatedAt`, `id`, `version` and the period fields are excluded by the SIGNATURE — `FrozenDocuments` has five keys — rather than by a filter, because a filter is a line somebody can delete.

`generate.ts` gained the seventh result arm `{ kind: 'unchanged'; reportId; version; periodStart }`. Inside the transaction, `periodStart`/`periodEnd` are hoisted (they were computed inline twice), ONE `documents` const is built, and that same const is both handed to `reportDocumentsUnchanged` and spread into `insertVersion` — the bytes compared are the bytes written. Both new reads (`repo.reports.latestVersionOf`, then `repo.reports.byId` only when a version exists) are on the transaction's connection; a pool-side read here would hold a second connection against the `max: 5` pool (07 WR-02).

Concurrency is unchanged: the check reads the transaction's own snapshot, so a generate committing an identical version between the check and the insert is still arbitrated by `MAX(version) + 1` and `monthly_reports_version_uniq` → `concurrent`. Worst case under a genuine race is one extra identical version, which is today's behaviour, never a lost correction.

`copy.ts` gained `generateUnchangedMessage` → `August 2026 is already up to date (version 3).` and `generateRefusalMessage` now excludes both `generated` and `unchanged`; its switch still has no `default`, so a future arm fails to compile rather than falling through. `actions.ts` maps the arm to `success` + `reportId`, which the island's existing `{state.success} … Open it →` markup renders — `generate-form.tsx` kept its four pinned imports and `action-state.ts` its zero.

**Task 2 — the grouped list** (`0bc2aac`)

`page.tsx` groups `reports.list()` in one pass into a `Map<periodStart, rows>` (a Map iterates in insertion order, so the months stay in the repository's `period_start DESC` order for free). The month's newest row is picked by `Math.max`, not by list position — the ordering is a repository promise, and picking by maximum is what keeps the row the operator opens correct on the day that promise moves. Earlier versions render inside a nested native `<details className="disclosure">` whose summary reads `show N earlier version(s)`, each still a `Link` to `/reports/[client]/[reportId]`, each still marked `superseded`. Nothing is deleted and nothing leaves the DOM (T-Q-05); the report page's own `Version N of M` banner is untouched.

**Discretion exercised:** the `latest` badge now renders ONLY when a month has earlier versions. With one row per month a badge on every row is noise — `latest` is information only where there is something for it to be latest over.

The cap notice was rewritten because the cap is on VERSIONS and the grouping happens afterwards: what falls off the end is the oldest month's OLDEST versions, so a month rendering `version 3` with an empty disclosure would otherwise read as though 1 and 2 were never generated. `globals.css` gained `.touch-list li > .disclosure { flex: 1 1 100%; margin-top: 0 }` — `.touch-list li` is a wrapping flex row, so a bare `<details>` would become a content-sized item beside the `generated …` meta with its 44px thumb target shrunk to the width of its own text (the `.touch-line` precedent).

**Task 3 — the 07-03 P3 ruling** (`60135d9`)

No code change. `consume-wins.ts:565-568` already logs exactly one fixed sentence whose only variable is the tenant uuid, and `tests/attribution-consume-isolation.test.ts:185-204` already asserts that sentence contains the tenant id and none of the driver's text — the paperwork was the thing out of step. The ruling now reads identically in four documents so the next verifier does not re-flag the same line:

| Document | Location | What changed |
|----------|----------|--------------|
| `07-03-PLAN.md` | `:79` P3 statement | Tenant id REMOVED from the logs' forbidden list (not footnoted); tick-response and log prohibitions separated; `[Ruling 2026-09-04: …]` appended |
| `07-03-PLAN.md` | `:200` T-7-14 register row | Mitigation Plan cell carries the same ruling tag |
| `07-VERIFICATION.md` | `:15` frontmatter, `:50` `expected:`, Prohibitions section, Gaps item | Caveat comment extended; count corrected to **fourteen** unruled |
| `07-SECURITY.md` | T-7-14 residual note | Same ruling tag on the existing bullet |

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (run per task and at the end) |
| `npm run lint` | PASS (`--max-warnings=0`) |
| `npm run build` | PASS |
| `npx vitest run` (7 targeted suites) | 129 passed |
| `npm test` FAIL-line set vs baseline | **IDENTICAL** — 39 suites, every one a `tests/helpers/env.ts` remote-gate refusal |
| `npm test` assertion failures | 0, as at baseline |
| Passed count | 2407 (baseline) → **2434** (+27: 15 comparator/generate-path, 10 list source pins, 1 copy sentence, 1 action mapping) |
| All three `<done>` grep gates | Re-run together, all hold |
| Commit scope | Three commits, 8 / 4 / 3 files — exactly each task's `<files>`; pre-existing unrelated changes untouched |

## Deferred to the next remote CI window

`tests/monthly-report.test.ts` was **edited by reading only and never executed** — the hosted Supabase is production and shares live `pg_cron` ticks, so `npm run test:remote` was not run and `ALLOW_REMOTE_TESTS` was never set. Three assertions changed there and only the real unique index can settle them:

1. `pressing Generate again with nothing changed writes nothing` — the second press of August returns `unchanged`, version 1, the same `reportId`, and `list()` still shows `[1]`. This is the case that proves the comparator survives an actual jsonb round trip (key reordering included), which no mock can prove.
2. `generates version 2 after the fee schedule changed and KEEPS version 1 (D-11)` — a `setup` fee of $990 dated `2026-08-15` changes both `figures.feesSetupCents` and `fees.rows`, so the press writes v2 beside v1 and the new row's `feesSetupCents === 99_000`. The fee carries no note, so the T-7-20 serialisation test downstream still finds no `@` and no `+61`.
3. The September concurrent race's loser loop now accepts `concurrent` OR `unchanged` (`expect([...]).toContain(loser.kind)`) — either the index arbitrated, or the second transaction serialised behind the first's commit and declined to write a duplicate. The `[1,1] | [2,0]` shape assertion is unchanged; a comment records that `[2,0]` now additionally requires both transactions to have passed the unchanged check before either committed.

The suite's header gained a fourth property naming exactly this.

## Deviations from Plan

**1. [Rule 3 — Blocking] `MonthlyReportSummary` is not on the repository barrel**

- **Found during:** Task 2, typing the extracted `reportRow` helper.
- **Issue:** The plan's `Row` type (`Awaited<ReturnType<typeof repo.reports.list>>[number]`) is scoped inside the component, but the shared row fragment is a module-level function and needs a named type. `MonthlyReportSummary` is declared in `for-tenant.ts` and NOT re-exported from `src/db/repository/index.ts`.
- **Fix:** Derived it at module scope from the already-present value import instead — `type ReportRow = Awaited<ReturnType<ReturnType<typeof forTenant>['reports']['list']>>[number]`. Adding a barrel re-export would have touched `src/db`, which Task 2's own `<done>` gate forbids (`git diff --quiet HEAD -- … src/db`). Derived, it also cannot drift from what `reports.list()` actually returns.
- **Files modified:** `src/app/(console)/reports/[client]/page.tsx` (Task 2's own file).
- **Commit:** `0bc2aac`

**2. [Rule 1 — Bug in my own test] Two source pins read prose instead of code**

- **Found during:** Task 1 (`report-unchanged.test.ts`) and Task 2 (the `<details` count gate).
- **Issue:** The pin `expect(source).not.toContain('forTenant(tenantId).reports')` failed because the comment I wrote beside the check NAMES the pool-side call it exists to forbid. Separately, `grep -c '<details' page.tsx` returned 3 rather than the plan's stated 2, because a comment explaining the pattern contained the literal `` `<details>` ``.
- **Fix:** The test now strips block and line comments before asserting (the `valueImportSources` approach); the page comment says "a native disclosure element". An assertion that reads prose is an assertion that fails when the reason is written down — and the plan's stated grep baseline is the contract, so the source was changed to meet it rather than the gate reinterpreted.
- **Files modified:** `tests/report-unchanged.test.ts`, `src/app/(console)/reports/[client]/page.tsx`.
- **Commits:** `e510be2`, `0bc2aac`

No architectural changes were needed. No schema change, no migration, no repository method, no delete path, no void flag, no new dependency, no remote test run.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, file access pattern or schema change. The two new reads are existing tenant-pinned repository methods called on the transaction's connection; the `unchanged` sentence carries a month label and a version number that are already on screen.

## Self-Check: PASSED

- `src/core/reporting/unchanged.ts` — FOUND
- `tests/report-unchanged.test.ts` — FOUND
- `tests/report-list.test.ts` — FOUND
- `.planning/quick/260904-dfq-make-report-generate-idempotent-and-coll/260904-dfq-SUMMARY.md` — FOUND
- commit `e510be2` — FOUND (8 files)
- commit `0bc2aac` — FOUND (4 files)
- commit `60135d9` — FOUND (3 files)
