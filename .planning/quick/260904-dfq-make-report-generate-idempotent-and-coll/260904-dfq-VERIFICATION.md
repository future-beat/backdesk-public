---
phase: quick-260904-dfq
verified: 2026-09-04T00:00:00Z
status: passed
score: 4/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "When any of the five documents differs from the newest stored version, Generate still writes version N+1 and keeps N (D-11) — the remote suite proves it against the real unique index by changing the fee schedule between two presses"
    test: "Run tests/monthly-report.test.ts in the next serialized remote CI window (never locally — the hosted Supabase is production; do not set ALLOW_REMOTE_TESTS)."
    expected: "Three amended cases pass: second identical press → `unchanged`, version 1, same reportId, list versions [1]; after seedFee(setup, 99_000, 2026-08-15) → `generated`, version 2, list [2, 1], row.figures.feesSetupCents === 99_000; the September race loser is `concurrent` OR `unchanged` with shape [1,1] | [2,0]."
    why_human: "The pure suite proves the comparator and the mocked generate path (zero insertVersion calls on an identical month, one call on a differing month). Only the real jsonb column can prove the key-reordered document that comes BACK OUT compares equal to what went in, and only the real unique index can prove the idempotency check and the MAX(version)+1 arbiter compose. The suite was edited by reading and never executed."
human_verification:
  - test: "Run `npm run test:remote` in the next serialized remote CI window (not locally). Read the three cases named in behavior_unverified_items."
    expected: "All three pass; no other remote assertion regresses (the T-7-20 serialisation test that reads the newest August row must still find no `@` and no `+61`, since the seeded setup fee carries no note)."
    why_human: "Hosted Supabase is production and shares live pg_cron ticks; the verifier must not run it. Deferred remote item, not a gap."
  - test: "After deploy, open /reports/[client] for the August-2026 fixture tenant (3 identical versions) on a 390px phone and on desktop. Tap `show 2 earlier versions`."
    expected: "One August row with `latest` badge; the summary sits on its own full-width line UNDER the row (not squeezed beside the `generated …` meta); the nested list shows version 2 and version 1 each marked `superseded`, each a working link; opening version 1 shows `Version 1 of 3 — a newer version exists.`; pressing Generate for August again shows `August 2026 is already up to date (version 3).` with `Open it →` and no new row appears."
    why_human: "Layout of a native <details> inside a wrapping flex <li> (the new `.touch-list li > .disclosure` rule) is visual; the end-to-end press-twice loop touches the production database."
---

# Quick 260904-dfq: Make report Generate idempotent and collapse superseded versions — Verification Report

**Task Goal:** Make report Generate idempotent and collapse superseded versions (plus the 07-03 P3 tenant-uuid ruling as a docs task)
**Verified:** 2026-09-04
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Identical press writes NOTHING, returns `{ kind: 'unchanged', reportId, version, periodStart }`; form reads `August 2026 is already up to date (version 3).` beside `Open it →` | ✓ VERIFIED | `generate.ts:421-429` returns the arm before `insertVersion` (:431). Pure suite `tests/report-unchanged.test.ts` "returns `unchanged` and calls insertVersion ZERO times for an identical month" — feeds `JSON.parse(JSON.stringify(written))` with re-keyed `figures`/`baseline`/`fees.rows[0]` back through `byId`, asserts `toHaveBeenCalledTimes(0)` and `byId` called with the existing id. `copy.ts:396-398` byte-exact sentence, pinned in `tests/reporting-copy.test.ts`. `actions.ts:167-172` maps to `success` + `reportId`, pinned in `tests/reports-authorization.test.ts` ("reports an unchanged month in the SUCCESS slot"). `generate-form.tsx:128-132` existing markup renders `{state.success}` + `Open it →` link to `/reports/${tenantId}/${state.reportId}`. All run green first-hand (129/129). |
| 2 | Differing documents → writes N+1, keeps N; remote suite proves it against the real unique index | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Pure half proven: "still writes a new version when the stored document differs" asserts `insertVersion` called once. Remote half present-but-unexecuted: `tests/monthly-report.test.ts` diff read line-by-line — `augustV1Id` hoisted; the old regenerate case split into `unchanged` (list `[1]`) and `generated v2 after seedFee(setup, 99_000, 2026-08-15)` (list `[2,1]`, `feesSetupCents === 99_000`); race loser accepts `['concurrent','unchanged']`; shape `[1,1] | [2,0]` unchanged; header gained the fourth property. Not run (production DB). Deferred remote item — see Human Verification. |
| 3 | `/reports/[client]` renders ONE row per month; earlier versions behind native `<details class="disclosure">` with `show N earlier version(s)`; superseded rows keep label + link; report page `Version N of M` banner untouched | ✓ VERIFIED | `page.tsx:365-369` groups into `Map<periodStart, rows>`; `:529-531` newest by `reduce` max, `earlier` sorted DESC; `:534-561` outer `<li key={newest.id}>` → `<details className="disclosure">` → `<summary>show {n} earlier version{s}</summary>` → inner `<ul className="touch-list">` of `reportRow(...)` each a `Link` to `/reports/[client]/[id]`. `grep -c '<details'` = 2. `[reportId]/page.tsx` byte-identical to 890160d (`git diff --quiet` exit 0); `:416` still renders `Version {report.version} of {latestVersion}`. `tests/report-list.test.ts` 10/10 green. Note: the `superseded` span moved out of `reportRow` — earlier rows are marked via the disclosure context; grep confirms `superseded` still present once in page.tsx. |
| 4 | Cap notice names report VERSIONS as the capped unit and warns the oldest month may be missing earlier versions; no delete, no void, no schema change | ✓ VERIFIED | `page.tsx:515-520`: "Showing the most recent {REPORT_LIST_LIMIT} report versions, grouped by month. Older versions are not listed — the oldest month shown may be missing earlier versions, and months before it are not shown." Predicate still `versions.length === REPORT_LIST_LIMIT`. `git diff 890160d..HEAD -- src/db` is EMPTY. No added line in the src diff contains a delete/void/migration path (only two prose comments say "deleted"/"delete"). No new dependency. |
| 5 | 07-03 P3 and T-7-14 row PERMIT a tenant uuid in the consumer's single fixed failure sentence; quote id, amount, customer data, caught error still forbidden; 07-VERIFICATION and 07-SECURITY record the same ruling; `consume-wins.ts` and isolation test untouched | ✓ VERIFIED | `07-03-PLAN.md:79` rewritten — tenant id REMOVED from the logs' forbidden list, `[Ruling 2026-09-04: …]` appended; still one double-quoted YAML scalar with no inner `"` (js-yaml parses the frontmatter OK). `:200` T-7-14 row carries the same tag, 5 cells intact. `07-VERIFICATION.md` :15 comment, :50 `expected:`, Prohibitions paragraph, Gaps item #4 ("Fourteen … still unruled") — frontmatter parses OK. `07-SECURITY.md:97` same tag on the existing bullet. `grep -c 'Ruling 2026-09-04'` = 2 / 1 as gated; `MUST NOT carry a tenant id` = 0. `src/core/attribution/consume-wins.ts` and `tests/attribution-consume-isolation.test.ts` byte-identical to 890160d; isolation suite green. |

**Score:** 4/5 truths verified (1 present, behavior-unverified — remote-index clause of Truth 2)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/reporting/unchanged.ts` | import-free leaf; `canonicalJson`, `reportDocumentsUnchanged` over five documents only | ✓ VERIFIED | 121 lines; 0 value imports; `DOCUMENT_KEYS` = the five; keys sorted, `undefined` dropped, `null` kept, arrays ordered, Date/non-plain objects via `JSON.stringify`. Imported by generate.ts (wired). |
| `src/core/reporting/generate.ts` | seventh arm; `latestVersionOf` + `byId` on the TRANSACTION repo before `insertVersion`; compared object IS inserted object | ✓ VERIFIED | Arm at :125. Inside `forTenant(tenantId).transaction(async (repo) => …)` (:244): one `documents` const (:388-394) passed to `reportDocumentsUnchanged(documents, previous)` (:421) and spread into `repo.reports.insertVersion({ periodStart, periodEnd, timezone, ...documents })` (:431-436). Both reads on `repo.reports.*` (:417, :419); source pin asserts no `forTenant(tenantId).reports` after comment-stripping. `periodStart` hoisted and reused in compare/insert/return. `isUniqueViolation` catch unchanged. |
| `src/core/reporting/copy.ts` | `generateUnchangedMessage`; `generateRefusalMessage` excludes `generated` and `unchanged` | ✓ VERIFIED | :353 `Exclude<…, { kind: 'generated' } | { kind: 'unchanged' }>`, switch still has no default (tsc-enforced exhaustiveness); :396 sentence. |
| `src/app/(console)/reports/[client]/actions.ts` | `unchanged` → `success` + `reportId`, before the refusal branch | ✓ VERIFIED | :167-172, after `monthLabel`, before `result.kind !== 'generated'`; `revalidatePath` still fires (:151). |
| `src/app/(console)/reports/[client]/page.tsx` | grouped list, nested disclosure, honest cap notice, corrected hint | ✓ VERIFIED | See Truths 3–4. `ReportRow` derived from `reports.list()` return type (deviation 1 — kept `src/db` untouched). |
| `src/app/globals.css` | `.touch-list li > .disclosure` claims a whole flex line | ✓ VERIFIED | :490-493 `flex: 1 1 100%; margin-top: 0`. |
| `src/app/(console)/reports/[client]/generate-form.tsx` | hint only; 4 imports unchanged | ✓ VERIFIED | One-line hint change; `grep -c '^import'` = 4; `lint-ban.test.ts` CLIENT_REACHABLE pins (:573, :577) green; `action-state.ts` 0 imports. |
| `tests/report-unchanged.test.ts` | pure comparator + mocked generate path + source pins | ✓ VERIFIED | 15 tests green; `vi.mock('@/db/repository')` with pool-side `forTenant()` exposing ONLY `tenant.get` + `transaction` (WR-02 pin); 0 `helpers/seed`. |
| `tests/report-list.test.ts` | pure source assertions | ✓ VERIFIED | 10 tests green; 0 `helpers/seed`. |
| `tests/monthly-report.test.ts` | remote split into `unchanged` + `generated v2`; race loser admits either | ⚠️ PRESENT, NOT RUN | Diff reviewed by reading only (production DB). Deferred remote item. |
| `07-03-PLAN.md` :79 / :200 | ruling tags | ✓ VERIFIED | See Truth 5. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| generate.ts `documents` | `reportDocumentsUnchanged` AND `insertVersion` | one const, compared then spread | WIRED | :388 → :421 → :431. Source pin "compares BEFORE it inserts" green. |
| generate.ts | `repo.reports.latestVersionOf` → `repo.reports.byId` | transaction `repo`, never pool-side | WIRED | :417, :419; `for-tenant.ts:3453-3475` both tenant-pinned; `byId` is `select()` — full row incl. five jsonb columns (`MonthlyReport = $inferSelect`, tsc-assignable to `FrozenDocuments`). |
| actions.ts `unchanged` | copy `generateUnchangedMessage` → `GenerateState.success` + `reportId` → generate-form `Open it →` | existing success markup | WIRED | actions :167-172; form :128-132. Action test green. |
| page.tsx grouping | outer `<li>` → nested `<details>` → inner `<ul>` of `Link`s | native disclosure | WIRED | :529-561. |
| 07-03-PLAN :79 ↔ :200 ↔ 07-VERIFICATION (×4 sites) ↔ 07-SECURITY :97 | one ruling, one tag | docs | WIRED | All grep gates hold; both frontmatters parse. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| generate.ts | `previous` (five docs) | `repo.reports.byId(latest.id)` → `db.select().from(monthlyReports)` | Yes — real query, tenant + id pinned | ✓ FLOWING |
| page.tsx | `monthVersions` / `earlier` | `repo.reports.list()` (unchanged repository read) | Yes | ✓ FLOWING |
| generate-form.tsx | `state.success`, `state.reportId` | server action return | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type-level exhaustiveness after the seventh arm | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Lint incl. `--max-warnings=0` | `npm run lint` | exit 0 | ✓ PASS |
| Pure suites | `npx vitest run tests/report-unchanged.test.ts tests/report-list.test.ts tests/reporting-copy.test.ts tests/reports-authorization.test.ts tests/lint-ban.test.ts tests/layout-contract.test.ts tests/attribution-consume-isolation.test.ts` | 7 files, 129/129 passed | ✓ PASS |
| Identical month → zero writes | named test "returns `unchanged` and calls insertVersion ZERO times…" | pass | ✓ PASS |
| Differing month → one write | named test "still writes a new version when the stored document differs" | pass | ✓ PASS |
| Pool-side read forbidden under transaction | mock omits `reports` on `forTenant()` + comment-stripped source pin | pass | ✓ PASS |
| `src/db` untouched | `git diff 890160d..HEAD -- src/db` | empty | ✓ PASS |
| Remote suite (jsonb round-trip, real unique index) | `npm run test:remote` | NOT RUN — production DB | ? SKIP → human |
| `npm run build` | — | not re-run by verifier (tsc + lint substituted; SUMMARY claims PASS) | ? SKIP (low risk) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared or present for this task. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-----------|-------------|--------|----------|
| RPT-02 | 260904-dfq-PLAN | Operator can generate a per-client monthly report … multiple versions retained | ✓ SATISFIED (refined) | Generate remains version-retaining (D-11); duplicates no longer created; every version still listed and linkable. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| actions.ts | 278 | "placeholder" (pre-existing prose about the HTML `placeholder` attribute) | ℹ️ Info | None — not introduced by this task |
| generate-form.tsx | 16 | "placeholder" (pre-existing prose) | ℹ️ Info | None |

No TBD/FIXME/XXX/TODO/HACK markers in any file this task touched. No console.log-only implementations. No empty returns.

### Commit Scoping

`e510be2` (8 files), `0bc2aac` (4 files), `60135d9` (3 files) — each matches its task's `<files>` exactly. Pre-existing unrelated working-tree changes (`.env.example`, `.planning/config.json`, untracked `*-PATTERNS.md`) untouched. Note: the todo `.planning/todos/pending/2026-09-03-make-report-generate-idempotent-…md` is still in `pending/` (no `done/` dir exists) — housekeeping for the orchestrator, not a goal gap.

### Human Verification Required

#### 1. Remote suite in the next serialized CI window (deferred remote item — NOT a gap)

**Test:** `npm run test:remote` in CI only. Never locally; never set `ALLOW_REMOTE_TESTS`.
**Expected:** `pressing Generate again with nothing changed writes nothing` → `unchanged`, v1, same id, list `[1]`; `generates version 2 after the fee schedule changed and KEEPS version 1` → `generated`, v2, list `[2,1]`, `feesSetupCents === 99_000`; September race loser ∈ {`concurrent`, `unchanged`}, shape `[1,1] | [2,0]`; T-7-20 serialisation test still finds no `@`/`+61`.
**Why human:** Only the real jsonb column proves the re-keyed stored document compares equal; only the real unique index proves the idempotency check composes with `MAX(version)+1`. The suite was edited by reading and never executed.

#### 2. Phone + desktop pass on the deployed fixture month

**Test:** Open `/reports/[client]` for the August-2026 fixture tenant (3 identical versions) at 390px and on desktop; tap `show 2 earlier versions`; open version 1; press Generate for August again.
**Expected:** One August row with `latest`; summary on its own full-width line under the row; versions 2 and 1 listed as `superseded` links; version 1 shows `Version 1 of 3 — a newer version exists.`; Generate says `August 2026 is already up to date (version 3).` with `Open it →`; no fourth row.
**Why human:** Visual layout of a native `<details>` inside a wrapping flex `<li>`; the end-to-end loop touches production data.

### Gaps Summary

No gaps. Every automated must-have is verified first-hand against the tree: the comparator is a genuine import-free leaf that canonicalises exactly the two jsonb normalisations and reads only the five documents; the generate path compares the same object it inserts, inside the transaction, on the transaction's repository; the `unchanged` arm rides the success slot into the island's existing link markup without touching either lint-ban-pinned file; the list groups by month with a native disclosure, keeps every version in the DOM as a link, and states the cap honestly; `src/db`, the report page banner, `consume-wins.ts` and the isolation test are byte-identical to 890160d; and the tenant-uuid ruling reads identically across the four Phase 7 documents with valid YAML. What remains is external: the remote suite's three amended assertions (cannot be run against the production database by the verifier) and a visual pass on the deployed list.

---

_Verified: 2026-09-04_
_Verifier: Claude (gsd-verifier)_

## Addendum (2026-09-04, orchestrator)

Human item 1 (the remote suite) is now settled: GitHub Actions run 33831495364 for commit `31f8913` — the CI job that runs `npx vitest run` against a fresh local Supabase stack, so the remote-gated files execute — completed with conclusion `success`, i.e. the three edited `tests/monthly-report.test.ts` cases (`unchanged` on a repeat press, version 2 after a fee change, race losers `concurrent` or `unchanged`) passed against the real jsonb columns and unique index. Only human item 2 (the phone tap on the disclosure) remains.

## Human verification result (2026-09-04)

Human item 2 settled: the operator opened the fixture client on the phone on 2026-09-04 — one August row, "show 2 earlier versions", version 1 banner, and Generate reported already up to date (version 3): "pass".
