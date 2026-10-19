---
phase: quick-260904-dfq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/reporting/unchanged.ts
  - src/core/reporting/generate.ts
  - src/core/reporting/copy.ts
  - src/app/(console)/reports/[client]/actions.ts
  - src/app/(console)/reports/[client]/page.tsx
  - src/app/(console)/reports/[client]/generate-form.tsx
  - src/app/globals.css
  - tests/report-unchanged.test.ts
  - tests/report-list.test.ts
  - tests/reporting-copy.test.ts
  - tests/reports-authorization.test.ts
  - tests/monthly-report.test.ts
  - .planning/phases/07-attribution-reporting/07-03-PLAN.md
  - .planning/phases/07-attribution-reporting/07-VERIFICATION.md
  - .planning/phases/07-attribution-reporting/07-SECURITY.md
autonomous: true
requirements: [RPT-02]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Pressing Generate for a month whose five frozen documents are byte-identical to the newest stored version writes NOTHING and returns `{ kind: 'unchanged', reportId, version, periodStart }`; the form reads `August 2026 is already up to date (version 3).` beside an `Open it →` link to that version"
    - "When any of the five documents differs from the newest stored version, Generate still writes version N+1 and keeps N (D-11) — the remote suite proves it against the real unique index by changing the fee schedule between two presses"
    - "`/reports/[client]` renders ONE row per month (the newest version); earlier versions sit behind a native `<details class=\"disclosure\">` whose summary reads `show N earlier version(s)`; every superseded row keeps its version label, opens normally, and the report page's own `Version N of M` banner is untouched"
    - "The `REPORT_LIST_LIMIT` cap notice says what is capped — report VERSIONS fetched, grouped afterwards — so the oldest month shown may be missing earlier versions; no delete, no void flag, no schema change"
    - "07-03 P3 and its T-7-14 register row explicitly PERMIT a tenant uuid in the consumer's single fixed failure sentence while a quote id, an amount, customer data and the caught driver error stay forbidden; 07-VERIFICATION and 07-SECURITY record the same ruling; `src/core/attribution/consume-wins.ts` and `tests/attribution-consume-isolation.test.ts` are untouched"
  artifacts:
    - "src/core/reporting/unchanged.ts — import-free leaf exporting `canonicalJson` and `reportDocumentsUnchanged(next, previous)` over the five documents only"
    - "src/core/reporting/generate.ts — seventh result arm `unchanged`; `latestVersionOf` + `byId` read on the TRANSACTION repo before `insertVersion`; the compared object IS the inserted object"
    - "src/core/reporting/copy.ts — `generateUnchangedMessage(version, monthLabel)`; `generateRefusalMessage` excludes both `generated` and `unchanged`"
    - "src/app/(console)/reports/[client]/actions.ts — maps `unchanged` to `success` + `reportId` (the form's existing success markup renders the link; no island change)"
    - "src/app/(console)/reports/[client]/page.tsx — grouped list, nested disclosure per month with earlier versions, honest cap notice, corrected hint copy"
    - "src/app/globals.css — `.touch-list li > .disclosure` claims a whole flex line inside the list row"
    - "tests/report-unchanged.test.ts — pure: comparator cases + mocked-repository generate path (unchanged → zero `insertVersion` calls) + source pins"
    - "tests/report-list.test.ts — pure source assertions for the grouped list shape and the untouched version banner"
    - "tests/monthly-report.test.ts — remote regenerate case split into `unchanged` (nothing changed) and `generated v2` (fee appended); concurrent-race losers may be `concurrent` OR `unchanged`"
    - ".planning/phases/07-attribution-reporting/07-03-PLAN.md — P3 statement (:79) and T-7-14 row (:200) amended with `[Ruling 2026-09-04: …]`"
  key_links:
    - "generate.ts builds ONE `documents` object → passes it to `reportDocumentsUnchanged(documents, previousRow)` AND to `repo.reports.insertVersion({ …documents })` — the bytes compared are the bytes written"
    - "generate.ts → `repo.reports.latestVersionOf(periodStart)` → `repo.reports.byId(latest.id)` — both on the transaction's `repo`, never on the pool-side `forTenant()` (07 WR-02 five-connection pool)"
    - "actions.ts `result.kind === 'unchanged'` → `generateUnchangedMessage` (copy.ts) → `GenerateState.success` + `reportId` → generate-form.tsx existing `{state.success} … Open it →` markup"
    - "page.tsx month grouping → outer `<li>` newest row → nested `<details className=\"disclosure\">` → inner `<ul className=\"touch-list\">` of earlier rows, each still a `Link` to `/reports/[client]/[reportId]`"
    - "07-03-PLAN.md :79 P3 ↔ :200 T-7-14 ↔ 07-VERIFICATION.md (frontmatter :15, human_verification `expected:` :50, Prohibitions section :143, Gaps item :227) ↔ 07-SECURITY.md :97 — one ruling, one tag, four documents"
---

<objective>
Make the monthly-report Generate action idempotent and stop the per-client reports list reading as though every re-press were a correction. Two identical presses produce one row; the list shows one row per month with superseded versions one tap away; and the Phase 7 paperwork records the operator's ruling that the attribution consumer's one fixed failure sentence may name a tenant uuid.

Purpose: During Phase 7 UAT the operator generated the August 2026 fixture month three times and got three byte-identical versions, then asked for delete. Delete was rejected on 3 Sep 2026 (a frozen version may already be stapled to an invoice; D-11 exists so a client's copy can always be reproduced). The problem is duplicate creation and a cluttered list — not retention. Separately, 07-03 P3 as written contradicts its own isolation test; the ruling closes the last open judgment-tier item that names a specific line.

Output: `src/core/reporting/unchanged.ts` (new), the seventh `GenerateReportResult` arm wired through core → copy → action → form, the grouped list page with a nested disclosure, two new pure suites plus three amended ones, and the four Phase 7 documents carrying `[Ruling 2026-09-04: …]`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/todos/pending/2026-09-03-make-report-generate-idempotent-and-collapse-superseded-vers.md
@src/core/reporting/generate.ts
@src/core/reporting/document.ts
@src/core/reporting/copy.ts
@src/app/(console)/reports/[client]/page.tsx
@src/app/(console)/reports/[client]/actions.ts
@src/app/(console)/reports/[client]/generate-form.tsx
@src/app/(console)/reports/[client]/action-state.ts
@tests/attribution-consume-isolation.test.ts
@tests/monthly-report.test.ts
@tests/reports-authorization.test.ts
</context>

<interfaces>
Verified seams (opened this planning session, line numbers against the live tree at commit 890160d (re-verified by the plan checker on the live tree)):

- `src/core/reporting/generate.ts:116-122` — `GenerateReportResult` union (six arms today; doc comment :108-115 says "SIX ANSWERS, FIVE OF THEM ORDINARY"). :213-397 `generateMonthlyReport(tenantId, input, now)`: pool-side `resolveProspectRate` (:234) BEFORE `forTenant(tenantId).transaction(async (repo) => …)` (:236); the five documents are built :276-363; `repo.reports.insertVersion({ periodStart, periodEnd, timezone, figures: asDocument(figures), lines, baseline: asDocument(baseline), constants: asDocument(constants), fees: asDocument(feesDocument) })` at :365-377; `isUniqueViolation` catch :393-396. `asDocument<T>` :157-159 widens to `Record<string, unknown>`.
- `src/core/reporting/document.ts:183-195` — `StoredReportRow { id, periodStart, periodEnd, timezone, version, generatedAt, figures: unknown, lines: unknown, baseline: unknown, constants: unknown, fees: unknown }`; `parseReportDocument` :205-219. Leaf module: imports `zod` and `codePointMax` only.
- `src/db/repository/for-tenant.ts:1708-1762` (interface) / :3417-3476 (impl) — `reports.insertVersion(row: ReportInsert): Promise<Array<{ id; version }>>` (version = `COALESCE(MAX(version),0)+1` inside the INSERT, :3428); `reports.list(): Promise<MonthlyReportSummary[]>` ordered `period_start DESC, version DESC`, `.limit(REPORT_LIST_LIMIT)` (:3446-3448; `REPORT_LIST_LIMIT = 120` :397); `reports.latestVersionOf(periodStart): Promise<Array<{ id; version }>>` (:3453-3465, `ORDER BY version DESC LIMIT 1`, no documents); `reports.byId(reportId): Promise<MonthlyReport[]>` (:3469-3475, full row incl. the five jsonb columns). `MonthlyReportSummary` :411-418 has NO documents. No repository change is needed: `latestVersionOf` + `byId` together give the newest version's documents.
- `src/db/schema/monthly-reports.ts` — five jsonb columns `figures/lines/baseline/constants/fees` typed `Record<string, unknown>` / `unknown[]`; `version smallint`; `generated_at` defaulted by the DB; unique `(tenant_id, period_start, version)`. jsonb REORDERS OBJECT KEYS on storage — that is why the comparator must be key-order-insensitive.
- `src/core/reporting/copy.ts:325` `GENERATE_FAILED_MESSAGE`; :345-372 `generateRefusalMessage(result: Exclude<GenerateReportResult, { kind: 'generated' }>, context)` — a `switch` with NO default, so adding an arm to the union without changing the `Exclude` makes `tsc` fail here (non-exhaustive return); :375-377 `generateSuccessMessage(version, monthLabel)` → `Version 2 for August 2026 is ready.`. Header :20-27: no `@/db` value import — pinned by `tests/reporting-copy.test.ts:482`.
- `src/app/(console)/reports/[client]/actions.ts:114-177` `generateReportAction`: `authorize` → zod → `generateMonthlyReport` → `revalidatePath` (:151, on every non-throwing outcome) → `monthLabel` via `periodLabel` (:153-156) → `if (result.kind !== 'generated') return { …BLANK_GENERATE_STATE, error: generateRefusalMessage(result, …) }` (:158-170) → success `{ success: generateSuccessMessage(result.version, monthLabel), reportId: result.reportId }` (:172-176).
- `src/app/(console)/reports/[client]/action-state.ts` — `GenerateState { error; success; reportId }`, imports NOTHING (0 `^import` lines; pinned in `tests/lint-ban.test.ts:573`).
- `src/app/(console)/reports/[client]/generate-form.tsx` — exactly 4 `^import` lines (`next/link`, `react`, `./actions`, `./action-state`; pinned :577). Success markup :128-135 already renders `{state.success}` + `<Link href={`/reports/${tenantId}/${state.reportId}`}>Open it →</Link>` under `role="status"` — the `unchanged` sentence needs NO island change. Closing hint :137-140.
- `src/app/(console)/reports/[client]/page.tsx` — header comment :40-43 ("EVERY version ever generated"); reads `repo.reports.list()` :201 into `versions`; `newestVersionByMonth` Map :299-306; hint :429-432; cap comment + notice :441-452 (`versions.length === REPORT_LIST_LIMIT` → "Showing the most recent {REPORT_LIST_LIMIT} reports. Older months are not listed."); list :454-489 (`<ul className="touch-list">`, per-row `Link`, `latest` badge / `superseded` muted span / `month to date` badge / `generated …` meta); fee disclosure :494-525 = `<details className="disclosure" id="fee-schedule"><summary>…</summary>…</details>` — THE pattern to copy (native, no island).
- `src/app/globals.css:473-484` `.disclosure { margin-top: 16px } .disclosure > summary { display:flex; align-items:center; min-height:44px; color:var(--accent); cursor:pointer }`; :572-579 `.touch-list li { display:flex; flex-wrap:wrap; align-items:center; gap:0.25rem 0.75rem; … }` — a `<details>` dropped straight into that `<li>` becomes a content-sized flex item; :617-624 `.touch-line { flex: 1 1 100%; … }` is the precedent for a child that must claim a whole line.
- `src/app/(console)/reports/[client]/[reportId]/page.tsx:168-169` reads `latestVersionOf(report.periodStart)`; :414-431 renders `Version {report.version} of {latestVersion} — a newer version exists.` + `Open version {latestVersion} →`. UNCHANGED by this task.
- `tests/reports-authorization.test.ts:35-40` `generateMonthlyReport = vi.fn(async () => ({ kind: 'generated' as const, reportId, version: 1, periodStart }))` (its inferred type only admits the `generated` shape — widen the generic before adding an `unchanged` case); :43-48 `vi.mock('@/db/repository')`; :50-52 `vi.mock('@/core/reporting/generate')`; :167-178 the cleared-caller case asserts `state.success === 'Version 1 for August 2026 is ready.'`.
- `tests/attribution-consume-isolation.test.ts:36-95` — THE pure mocking pattern for a core module that imports the repository barrel: `vi.mock('@/db/repository', () => ({ …, forTenant: (tenantId) => ({ transaction: (work) => runTransaction(tenantId, work) }) }))`, a `txRepo(tenantId)` factory handed to the callback, `await import('@/core/…')` after the mock. Header line :36 "PURE. No database … runs on bare `npm test`".
- `tests/monthly-report.test.ts` — REMOTE (header :32-33: runs only under the remote script); `NOW = 2026-09-02T02:00:00Z` (:65); tenantA has one monthly fee `59_700` effective `2026-08-01` (:206-212); test :348-421 writes v1 and asserts `figures.feesSetupCents === 0`; test :424-440 `generates again as version 2 and KEEPS version 1 (D-11)` calls the SAME generate twice with NOTHING changed between — under this task that second call becomes `unchanged`; test :486-540 the September concurrent race asserts every loser is `concurrent` (:533-538) — under this task a serialised second transaction that sees the first's committed identical row returns `unchanged` instead; `seedFee(tenantId, { kind, amountCents, effectiveFrom, note? })` :617; `teardownTenants` deletes `monthly_reports` and `tenant_fees` by `tenant_id` (:918, :923).
- `tests/monthly-report.test.ts:543-552` `valueImportSources(path)` — the regex helper for "value imports only" source pins; reuse its shape in the new suites.
- `src/core/attribution/consume-wins.ts:565-568` — the ONE fixed sentence: `` `[attribution] consumption threw for tenant ${tenantId}; the cursor is held behind this run and this tenant is skipped for the rest of the pass.` `` — NOT touched by this task. `tests/attribution-consume-isolation.test.ts:185-204` asserts `message` contains `TENANT_A` and NOT `deadlock` / `4417` / `+61491570156`. `src/app/api/internal/sync-tick/route.ts:91` already emits `tenantId: r.tenantId` in its body — the ruling's second rationale is a fact on the tree.
- `.planning/phases/07-attribution-reporting/07-03-PLAN.md:79` — the P3 statement, a double-quoted YAML string inside the frontmatter (closing `---` at :82); :200 the `| T-7-14 | … |` register row (6 pipes, 5 cells). `07-VERIFICATION.md:15` `judge_verdict_held_with_caveat: 1 # 07-03 P3 …`; :49-51 the `PROHIBITIONS` human_verification entry whose `expected:` names 07-03 P3; :141-143 `### Prohibitions (must-NOT) — judgment tier …` paragraph; :227 `4. **Fifteen judgment-tier prohibitions**, in particular 07-03 P3 (carried forward, never ruled).`. `07-SECURITY.md:48` T-7-14 row already notes the residual; :97 `- T-7-14 residual: …` notes line.
</interfaces>

<executor_constraints>
READ BEFORE THE FIRST EDIT. These are not advisory.

1. THE HOSTED SUPABASE IS PRODUCTION. Never run `npm run test:remote`. Never set `ALLOW_REMOTE_TESTS`. Never import the seed helper module under `tests/helpers/` from a new suite. Every test you ADD must be pure (mocks/source assertions). The remote suite you AMEND (`tests/monthly-report.test.ts`) is edited by reading, and proven by `npx tsc --noEmit` + `npm run lint` + a careful re-read; CI runs it in its serialized remote window.
2. BASELINE FIRST. Before any edit: `npm test 2>&1 | tee "$SCRATCH/baseline.txt"` (use your session scratchpad). Expected today: 0 assertion failures; ~39 suites refuse with the `tests/helpers/env.ts` remote-gate message. After EACH task: run `npm test` again and diff the set of `FAIL` lines against the baseline — it must be identical (every failure a remote-gate refusal), and the passed count must be ≥ baseline + the tests you added.
3. PER-TASK GATES, in this order, all green before the task's commit: `npx tsc --noEmit` → `npm run lint` → targeted `npx vitest run …` (listed in each task) → `npm run build` → `npm test` diff.
4. COMMITS: sequential on the main tree, one per task, scoped with `--files` (the tree has unrelated uncommitted changes: `.env.example`, `.planning/config.json`, untracked `*-PATTERNS.md` — DO NOT stage them). Messages: Task 1 `feat(quick-260904-dfq): make report Generate idempotent — unchanged documents write nothing`, Task 2 `feat(quick-260904-dfq): one row per month on /reports/[client], earlier versions behind a disclosure`, Task 3 `docs(quick-260904-dfq): rule 07-03 P3 — tenant uuid permitted in the consumer's fixed failure sentence`.
5. NO NEW DEPENDENCIES. No schema change, no migration, no repository method, no delete path, no void flag.
6. `tests/lint-ban.test.ts` pins `action-state.ts` (0 imports) and `generate-form.tsx` (4 imports, none `@/db/**`). Do not add an import to either. The `unchanged` sentence reaches the island through `GenerateState.success` + `reportId`, which already exist.
</executor_constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Idempotent Generate — pure comparator, seventh result arm, message + action mapping, pure tests, remote-suite rewrite</name>
  <files>src/core/reporting/unchanged.ts, src/core/reporting/generate.ts, src/core/reporting/copy.ts, src/app/(console)/reports/[client]/actions.ts, tests/report-unchanged.test.ts, tests/reporting-copy.test.ts, tests/reports-authorization.test.ts, tests/monthly-report.test.ts</files>
  <behavior>
    - `reportDocumentsUnchanged(next, previous)` returns true for two structurally identical five-document sets
    - returns false when ONE figure differs (`figures.grossCents` + 1)
    - returns false when ONE line differs (`lines[0].replyCount` + 1) and when two lines are swapped (array order is part of the document — it is the printed table's order)
    - returns true when object KEY ORDER differs at any depth (reverse the key order of `figures`, of `fees.rows[0]`, of `baseline`) — jsonb reorders keys on storage
    - returns true when a property is `undefined` on one side and ABSENT on the other (`fees.rows[0].note: undefined` vs no `note` key; `baseline.windowStart: undefined` vs absent) — jsonb cannot carry undefined
    - returns false when a property is `null` on one side and ABSENT on the other (jsonb keeps null)
    - ignores everything outside the five documents: `id`, `version`, `generatedAt`, `periodStart`, `periodEnd`, `timezone`, `tenantId` differing on `previous` still yields true
    - `generateMonthlyReport` with `latestVersionOf → []` returns `generated` and calls `insertVersion` exactly once (capture the argument as `written`)
    - with `latestVersionOf → [{ id: 'r1', version: 3 }]` and `byId → [row whose five documents are `JSON.parse(JSON.stringify(written))` with keys re-ordered]` returns `{ kind: 'unchanged', reportId: 'r1', version: 3, periodStart: '2026-08-01' }` and calls `insertVersion` ZERO times
    - with the same but `figures.quotesChased` altered on the stored row → `generated`, `insertVersion` called once
    - the pool-side `forTenant()` mock exposes ONLY `tenant.get` and `transaction`; the unchanged check never reaches it (a pool-side `reports` read would throw TypeError — that is the WR-02 pin)
    - `generateUnchangedMessage(3, 'August 2026')` === `'August 2026 is already up to date (version 3).'`
    - `generateReportAction` with the generator resolving `{ kind: 'unchanged', reportId, version: 3, periodStart }` returns `success === 'August 2026 is already up to date (version 3).'`, `reportId` = that id, `error === null`
  </behavior>
  <action>
**Why the action mapping lives in this task and not Task 2:** adding an arm to `GenerateReportResult` breaks `tsc` in two consumers at once — `generateRefusalMessage`'s `Exclude<…>` (copy.ts:346, non-exhaustive switch) and the `result.kind !== 'generated'` narrowing in actions.ts:158 that passes `result` to it. The per-task `npx tsc --noEmit` gate therefore forces the sentence and the one-branch action mapping into the same commit as the union arm. Task 2 owns everything the operator SEES on the list page.

**1. `src/core/reporting/unchanged.ts` (new, import-free leaf — `import type` only, mirroring document.ts's reason for existing apart from generate.ts).**
- Export `interface FrozenDocuments { figures: unknown; lines: unknown; baseline: unknown; constants: unknown; fees: unknown }` — `unknown` on purpose: one side is the generator's typed objects, the other is `StoredReportRow`'s jsonb columns, and neither should be cast to meet.
- Export `canonicalJson(value: unknown): string` — recursive: arrays serialise in order; plain objects serialise with keys SORTED and entries whose value is `undefined` DROPPED (exactly what `JSON.stringify` does and what jsonb can represent); every other value goes through `JSON.stringify`. Document the two facts it exists for: jsonb reorders keys, and a stored row never carries `undefined`.
- Export `reportDocumentsUnchanged(next: FrozenDocuments, previous: FrozenDocuments): boolean` — true iff `canonicalJson` of each of the five keys is equal. Read ONLY those five keys; `id`, `version`, `generatedAt`, `prepared`/period fields are excluded by construction, and the header must say so (the spec's "generated_at must be excluded" is a property of the signature, not of a filter).
- Header comment: what this decides (whether a press writes), why bytes and not a field list (a comparator that enumerates fields silently passes the day the document gains one), and why it is NOT the place to compare `generatedAt`.

**2. `src/core/reporting/generate.ts`.**
- Add the seventh arm `| { kind: 'unchanged'; reportId: string; version: number; periodStart: string }` to `GenerateReportResult`; update the result doc comment (:108-115) to seven answers, six of them ordinary, and say what `unchanged` means: the newest stored version already says exactly this, so nothing was written and the operator is pointed at it.
- Import `{ reportDocumentsUnchanged }` from `./unchanged` (value import — this module already reaches the repository; the leaf reaches nothing).
- Inside the transaction, AFTER `feesDocument` is built (:363) and BEFORE the insert: compute `const periodStart = localDateString(period.start, timezone)` and `periodEnd` once (they are currently computed inline at :369-370 and again at :390 — hoist, do not duplicate a third time). Build ONE `const documents = { figures: asDocument(figures), lines, baseline: asDocument(baseline), constants: asDocument(constants), fees: asDocument(feesDocument) }`. Then `const [latest] = await repo.reports.latestVersionOf(periodStart)`; if `latest`, `const [previous] = await repo.reports.byId(latest.id)`; if `previous && reportDocumentsUnchanged(documents, previous)` return `{ kind: 'unchanged', reportId: latest.id, version: latest.version, periodStart }`. Then `repo.reports.insertVersion({ periodStart, periodEnd, timezone, ...documents })`. THE OBJECT COMPARED IS THE OBJECT WRITTEN — a second literal here is how the comparison and the insert drift apart.
- Both reads are on `repo` (the transaction's connection). Write the comment: a pool-side `forTenant(tenantId).reports.…` here would hold a second connection under an open transaction — the `max: 5` starvation recorded at :219-233 (07 WR-02). Two statements: `latestVersionOf` is index-only; `byId` fetches the five documents once, the cost of one report-page render.
- Concurrency comment beside the check: it runs inside the same snapshot as the six reads; a generate that commits an identical version between this check and the insert is arbitrated exactly as before (`MAX(version)+1` at the write, 23505 → `concurrent`), so the worst case under a genuine race is one extra identical version — the status quo, never a lost correction. The isUniqueViolation catch (:393-396) is unchanged.

**3. `src/core/reporting/copy.ts`.**
- `generateRefusalMessage(result: Exclude<GenerateReportResult, { kind: 'generated' } | { kind: 'unchanged' }>, …)`; update its doc comment (six arms → five refusal arms; `unchanged` is not a refusal and not a success — it is "already done").
- Add `export function generateUnchangedMessage(version: number, monthLabel: string): string` returning the template `${monthLabel} is already up to date (version ${version}).` — doc comment example `August 2026 is already up to date (version 3).` Place it beside `generateSuccessMessage`. No new imports.

**4. `src/app/(console)/reports/[client]/actions.ts`.**
- Import `generateUnchangedMessage` alongside the other copy imports (:6-12).
- After `monthLabel` (:156) and BEFORE the `result.kind !== 'generated'` branch, add: if `result.kind === 'unchanged'` return `{ ...BLANK_GENERATE_STATE, success: generateUnchangedMessage(result.version, monthLabel), reportId: result.reportId }`. Comment: it rides the SUCCESS slot, not the error slot, because nothing went wrong and the operator's next act is the same as after a write — open it; and it carries `reportId` so the island's existing `Open it →` renders without the island learning a new state. `revalidatePath` stays where it is (:151) — harmless on this arm and the "every non-throwing outcome" comment stays true.

**5. Tests.**
- NEW `tests/report-unchanged.test.ts` — PURE, header says so in the isolation suite's words. Three describes:
  (a) the comparator cases from `<behavior>`, using a small fixture builder that produces a realistic five-document set (a `figures` object with the eleven `reportFiguresSchema` keys, one or two `lines`, `baseline`, `constants`, `fees` with one row) and helper `reversedKeys(obj)` for the key-order cases.
  (b) the generate path: `vi.mock('@/db/repository', () => ({ getProspect: …, forTenant: (tenantId) => ({ tenant: { get: async () => [tenantRow] }, transaction: (work) => work(txRepo()) }) }))` then `const { generateMonthlyReport } = await import('@/core/reporting/generate')`. `txRepo()` answers: `tenant.get` (timezone `Australia/Perth`, `prospectId: null`), `connection.get` (createdAt `2026-03-01T00:00:00Z`, baseline fields as in the remote suite's seeds :197-203), `fees.list` (one monthly row `59_700` effective `2026-08-01`, `createdAt` a Date, `note: null`), `attributions.listForPeriod → []`, `ledger.countQuotesChasedInPeriod → 0`, `inbound.countThreadedInPeriod → 0`, `events.countWonQuotesInPeriod → 0`, and `reports: { latestVersionOf: vi.fn(), byId: vi.fn(), insertVersion: vi.fn(async () => [{ id: REPORT_ID, version: 1 }]) }`. Type the fake rows with `as unknown as` casts at the boundary (the isolation suite's approach) rather than importing schema types as values. Run the three scenarios from `<behavior>` with `now = new Date('2026-09-02T02:00:00.000Z')` and `{ year: 2026, month: 8 }`. If importing `@/core/reporting/generate` under this mock trips the remote gate in `tests/helpers/env.ts` (it should not — the schema barrel is table definitions only), STOP and report rather than widening the mock to `@/db/schema`.
  (c) source pins: `src/core/reporting/unchanged.ts` has zero value imports (reuse the `valueImportSources` regex from tests/monthly-report.test.ts:543-552); in `src/core/reporting/generate.ts` the first `reportDocumentsUnchanged(` call precedes the `repo.reports.insertVersion(` call; `latestVersionOf` and `reports.byId` each appear in generate.ts.
- `tests/reporting-copy.test.ts` — import `generateUnchangedMessage`; add one `it` in the `the Generate action says one thing, and names the fix` describe (:419+) asserting the byte-exact sentence for `(3, AUGUST)`.
- `tests/reports-authorization.test.ts` — widen the mock's generic (`vi.fn<() => Promise<GenerateReportResult>>(…)` with `import type { GenerateReportResult } from '@/core/reporting/generate'` — a type import is erased and does not fight the `vi.mock`), then add one `it` after :178: `mockResolvedValueOnce({ kind: 'unchanged', reportId: '77777777-7777-4777-8777-777777777777', version: 3, periodStart: '2026-08-01' })` → assert `state.success`, `state.reportId`, `state.error === null`, and `revalidatePath` called with `/reports/${TENANT}`.
- `tests/monthly-report.test.ts` (REMOTE — edit by reading; do not run):
  · Hoist the v1 report id: declare `let augustV1Id: string;` beside `quoteIds` and set it in the first test after `result.kind === 'generated'`.
  · Replace the test at :424-440 with TWO: (i) `pressing Generate again with nothing changed writes nothing (quick-260904-dfq)` — second `generateMonthlyReport(tenantA, { year: 2026, month: 8 }, NOW)` → `kind === 'unchanged'`, `version === 1`, `reportId === augustV1Id`; `list()` filtered to `2026-08-01` maps versions to `[1]`. (ii) `generates version 2 after the fee schedule changed and KEEPS version 1 (D-11)` — `await seedFee(tenantA, { kind: 'setup', amountCents: 99_000, effectiveFrom: '2026-08-15' })` (inside August, so BOTH `figures.feesSetupCents` and `fees.rows` change; no note — the T-7-20 test later serialises the newest August row and asserts no `@`/`+61`), then generate → `generated`, `version === 2`, list versions `[2, 1]`, and the new row's `figures.feesSetupCents === 99_000`. Keep the original assertion message about "A CORRECTION IS A NEW VERSION, NOT AN EDIT".
  · The September race (:486-540): the loser loop at :533-538 must accept `concurrent` OR `unchanged` — write the assertion as `expect(['concurrent', 'unchanged']).toContain(loser.kind)` with a message explaining both: the index arbitrated (`concurrent`), or the second transaction serialised behind the first's commit and found the identical document already stored (`unchanged` — idempotency doing its job). The shape assertion `[1,1] | [2,0]` and the dense-versions invariant are unchanged. Note `[2,0]` is now reachable only if both transactions passed the unchanged check before either committed; leave the shape assertion as is and say so in the comment.
  · Add one line to the header's "three properties" list (:14-30) naming the fourth: an identical second press writes nothing, and only the real index can prove the arbiter and the idempotency check compose.
  · `teardownTenants` already covers `tenant_fees` and `monthly_reports` by `tenant_id` — no teardown change.
  </action>
  <verify>
    <automated>cd "~/Documents/Projects/Productised service" && npx tsc --noEmit && npm run lint && npx vitest run tests/report-unchanged.test.ts tests/reporting-copy.test.ts tests/reports-authorization.test.ts tests/lint-ban.test.ts tests/attribution-consume-isolation.test.ts && npm run build</automated>
  </verify>
  <done>
Acceptance criteria (live-tree baselines in parentheses; every command run from the repo root):
- `test -f src/core/reporting/unchanged.ts` (absent today)
- `grep -E '^import ' src/core/reporting/unchanged.ts | grep -vc '^import type'` → `0`
- `grep -c "kind: 'unchanged'" src/core/reporting/generate.ts` → `≥ 2` (0)
- `grep -c 'latestVersionOf' src/core/reporting/generate.ts` → `≥ 1` (0); `grep -c 'reports.byId' src/core/reporting/generate.ts` → `≥ 1` (0)
- `test "$(grep -n 'reportDocumentsUnchanged(' src/core/reporting/generate.ts | head -1 | cut -d: -f1)" -lt "$(grep -n 'repo.reports.insertVersion(' src/core/reporting/generate.ts | head -1 | cut -d: -f1)"` → exit 0
- `grep -c 'generateUnchangedMessage' src/core/reporting/copy.ts` → `≥ 1` (0); `grep -c "{ kind: 'unchanged' }" src/core/reporting/copy.ts` → `≥ 1` (0)
- `grep -c "'unchanged'" "src/app/(console)/reports/[client]/actions.ts"` → `≥ 1` (0)
- `grep -c '^import' "src/app/(console)/reports/[client]/action-state.ts"` → `0` (0, unchanged); `grep -c '^import' "src/app/(console)/reports/[client]/generate-form.tsx"` → `4` (4, unchanged)
- `test -f tests/report-unchanged.test.ts`; `grep -c "vi.mock('@/db/repository'" tests/report-unchanged.test.ts` → `≥ 1`; `grep -c 'helpers/seed' tests/report-unchanged.test.ts` → `0`
- `grep -c "'unchanged'" tests/monthly-report.test.ts` → `≥ 2` (0); `grep -c "'unchanged'" tests/reports-authorization.test.ts` → `≥ 1` (0); `grep -c 'generateUnchangedMessage' tests/reporting-copy.test.ts` → `≥ 1` (0)
- The `<automated>` command exits 0; `npm test` FAIL-line set identical to the baseline (remote-gate refusals only) and passed count ≥ baseline + new tests
- Commit `feat(quick-260904-dfq): make report Generate idempotent — unchanged documents write nothing` contains exactly the eight files in this task's `<files>`
  </done>
</task>

<task type="auto">
  <name>Task 2: Console — one row per month, earlier versions behind a native disclosure, honest cap notice, corrected hint copy, source pins</name>
  <files>src/app/(console)/reports/[client]/page.tsx, src/app/(console)/reports/[client]/generate-form.tsx, src/app/globals.css, tests/report-list.test.ts</files>
  <action>
**1. `src/app/(console)/reports/[client]/page.tsx` — grouping.**
- Replace the `newestVersionByMonth` Map (:299-306) with a grouping computed in one pass over `versions` (which `reports.list()` returns `period_start DESC, version DESC`): `Map<string, Row[]>` keyed by `periodStart`, insertion order = month order; for each month `newest` = the row with the greatest `version` (pick by `Math.max`, do not rely on list order — say in the comment that the order is a repository promise and the max is what makes the row right even if that promise moves), `earlier` = the rest, `version DESC`. `Row` is `Awaited<ReturnType<typeof repo.reports.list>>[number]` — the summary type, no documents.
- Rewrite the list (:454-489): one `<li key={newest.id}>` per month. Inside, in this order: the `Link` `{month} — version {newest.version}`; a `latest` badge ONLY when `earlier.length > 0` (a month with a single version has nothing to be latest over — with one row per month the badge on every row was noise; say so); the `month to date` badge (same predicate as today); the `generated …` meta. Then, when `earlier.length > 0`, a nested `<details className="disclosure">` with `<summary>show {earlier.length} earlier version{earlier.length === 1 ? '' : 's'}</summary>` and an inner `<ul className="touch-list">` whose rows are the earlier versions: `Link` `{month} — version {row.version}`, `<span className="muted">superseded</span>`, the `month to date` badge, the `generated …` meta. No `id` on these disclosures (the fee one has `id="fee-schedule"` because a link targets it; nothing targets these). Keep every label derived from the ROW's own frozen zone (the existing :459-461 comment).
- The empty state (:454-455) is unchanged.
- Header comment :40-43: the list still shows EVERY version (D-11) — one row per month, superseded versions one tap away inside the month's disclosure; nothing is deleted and nothing is hidden from the DOM. Say why: a re-pressed month used to read like a corrected one.
- Hint :429-432 → `Each report is a frozen calendar month in {tenant.timezone}. Generating again makes a new version only if the figures or lines changed, and keeps every earlier one.`
- Cap notice (:441-452): keep the predicate `versions.length === REPORT_LIST_LIMIT` (it is VERSIONS the repository caps, before grouping). Text → `Showing the most recent {REPORT_LIST_LIMIT} report versions, grouped by month. Older versions are not listed — the oldest month shown may be missing earlier versions, and months before it are not shown.` Rewrite the comment above it: the cap binds on versions fetched, grouping happens after, so the thing that falls off is the oldest month's OLDEST versions first — the notice has to say that or a month that shows only "version 3" reads as though 1 and 2 were never generated.

**2. `src/app/globals.css`** — in the disclosure block after `.disclosure > summary` (:477-484) add `.touch-list li > .disclosure { flex: 1 1 100%; margin-top: 0; }` with a two-line comment: `.touch-list li` is a wrapping flex row, so a bare `<details>` becomes a content-sized item beside the meta; claiming the whole line (the `.touch-line` precedent, :617) puts the summary under the row it belongs to and keeps its 44px target full-width. No other CSS.

**3. `src/app/(console)/reports/[client]/generate-form.tsx`** — ONLY the closing hint sentence (:137-140): `Creates a frozen report you can print to PDF and attach to the invoice. Re-generating a month adds a version only if something changed.` No import changes (the pin is 4 lines).

**4. NEW `tests/report-list.test.ts`** — PURE source assertions (readFileSync + the `valueImportSources` helper shape), header in the isolation suite's words. Assert on `src/app/(console)/reports/[client]/page.tsx`: exactly two `<details className="disclosure"` occurrences (the fee schedule and the per-month one); the summary text contains `earlier version`; `superseded` still rendered; the cap notice contains `report versions` AND still interpolates `REPORT_LIST_LIMIT` (the number is never typed); `versions.length === REPORT_LIST_LIMIT` is the predicate; the hint contains `only if the figures or lines changed`. Assert on `src/app/(console)/reports/[client]/[reportId]/page.tsx`: `latestVersionOf(` still called and the literal `of {latestVersion}` still rendered — the banner is untouched. Assert on `src/app/globals.css`: `.touch-list li > .disclosure` present. Assert on `generate-form.tsx`: the hint contains `only if something changed` and `valueImportSources` yields exactly `['next/link', 'react', './actions', './action-state']` (a second lock beside lint-ban's, on THIS change). Assert on `tests/layout-contract.test.ts`, `tests/stall-tick.test.ts`, `tests/lint-ban.test.ts`: NOT edited by this task — verify by running them, not by pinning.
  </action>
  <verify>
    <automated>cd "~/Documents/Projects/Productised service" && npx tsc --noEmit && npm run lint && npx vitest run tests/report-list.test.ts tests/layout-contract.test.ts tests/lint-ban.test.ts tests/report-unchanged.test.ts && npm run build</automated>
  </verify>
  <done>
Acceptance criteria (live-tree baselines in parentheses; run from the repo root; `P="src/app/(console)/reports/[client]"`):
- `grep -c '<details' "$P/page.tsx"` → `2` (1)
- `grep -c 'earlier version' "$P/page.tsx"` → `≥ 1` (0)
- `grep -c 'superseded' "$P/page.tsx"` → `≥ 1` (1)
- `grep -c 'report versions' "$P/page.tsx"` → `≥ 1` (0); `grep -c 'REPORT_LIST_LIMIT' "$P/page.tsx"` → `≥ 3` (4)
- `grep -c 'only if the figures or lines changed' "$P/page.tsx"` → `1` (0)
- `grep -c 'only if something changed' "$P/generate-form.tsx"` → `1` (0); `grep -c 'adds a new version' "$P/generate-form.tsx"` → `0` (1); `grep -c '^import' "$P/generate-form.tsx"` → `4` (4)
- `grep -c 'touch-list li > .disclosure' src/app/globals.css` → `1` (0)
- `grep -c 'of {latestVersion}' "$P/[reportId]/page.tsx"` → `1` (1, untouched); `git diff --quiet HEAD -- "$P/[reportId]/page.tsx" "$P/action-state.ts" "$P/actions.ts" src/db` → exit 0
- `test -f tests/report-list.test.ts`; `grep -c 'helpers/seed' tests/report-list.test.ts` → `0`
- The `<automated>` command exits 0; `npm test` FAIL-line set identical to the baseline; passed count ≥ Task 1's count + new tests
- Commit `feat(quick-260904-dfq): one row per month on /reports/[client], earlier versions behind a disclosure` contains exactly the four files in this task's `<files>`
  </done>
</task>

<task type="auto">
  <name>Task 3: Docs — the tenant-uuid ruling on 07-03 P3 / T-7-14, mirrored in 07-VERIFICATION and 07-SECURITY</name>
  <files>.planning/phases/07-attribution-reporting/07-03-PLAN.md, .planning/phases/07-attribution-reporting/07-VERIFICATION.md, .planning/phases/07-attribution-reporting/07-SECURITY.md</files>
  <action>
NO CODE CHANGE. `src/core/attribution/consume-wins.ts:565-568` already logs exactly one fixed sentence whose only variable is the tenant uuid, and `tests/attribution-consume-isolation.test.ts:185-204` already asserts that sentence contains the tenant id and none of the driver's text. This task makes the paperwork agree with the code and the test. Use `Edit` (scoped) on every file — never `Write`.

**1. `07-03-PLAN.md:79`** — the P3 `statement:` is a double-quoted YAML scalar inside the frontmatter. Rewrite it in place, keeping the outer double quotes and using NO double quote inside (single quotes and angle brackets are fine). Today it lists four forbidden items for both the tick response and the logs, the tenant id first. New wording, one line: the tick response carries counts and a cursor position only (no tenant id, quote id, amount or driver error — T-3-24, T-2-02); the consumer's logs MUST NOT carry a quote id, an amount, customer data or a caught driver error; then the tag `[Ruling 2026-09-04: the consumer's single fixed failure sentence ('consumption threw for tenant <uuid>; the cursor is held …') MAY carry the tenant uuid — an opaque internal id, already emitted in sync-tick bodies (src/app/api/internal/sync-tick/route.ts:91), and the one fact the operator needs to act on a wedged tenant; a quote id, an amount, customer data and the caught error remain forbidden there — matches consume-wins.ts:565-568 and tests/attribution-consume-isolation.test.ts:185-204]`. Keep `category: privacy` and `requirement_id: RPT-01` lines untouched. The tenant-id item must be REMOVED from the logs' forbidden list, not merely footnoted.
- **`07-03-PLAN.md:200`** — the `T-7-14` register row: keep the six pipes and five cells; append to the Mitigation Plan cell (no `|` inside the text): ` [Ruling 2026-09-04: tenant uuid permitted in the consumer's one fixed failure sentence — opaque internal id; sync-tick bodies already carry tenantId; needed to act on a wedge. Quote id, amount, customer data and the caught error stay forbidden.]`. Leave the Threat description cell as written (it still names what the mitigation defends against on the tick body).

**2. `07-VERIFICATION.md`** — four scoped edits, frontmatter YAML kept valid (double-quoted strings: no `"` inside):
- :15 `judge_verdict_held_with_caveat: 1 # 07-03 P3 tenant-uuid / event-id log lines` → keep the number, extend the comment: `… — ruled 2026-09-04: tenant uuid permitted (see Prohibitions)`.
- :50 the `expected:` string of the `PROHIBITIONS` human_verification entry: append, inside the closing double quote, ` — ruled: tenant uuid permitted (opaque internal id; sm8-sync tick bodies already carry tenantId; needed to act on a wedge) [Ruling 2026-09-04; 07-03 P3 statement and T-7-14 row amended in place; the other fourteen remain unruled]`.
- :141-143 the `### Prohibitions (must-NOT) — judgment tier …` paragraph: add a second paragraph: `07-03 P3 — ruled: tenant uuid permitted (opaque internal id; sm8-sync tick bodies already carry tenantId; needed to act on a wedge) [Ruling 2026-09-04]. The statement at 07-03-PLAN.md:79 and the T-7-14 register row were amended in place; no code or test changed — consume-wins.ts:565-568 and attribution-consume-isolation.test.ts:185-204 already matched the ruling. Fourteen prohibitions remain flagged and unruled.`
- :227 `4. **Fifteen judgment-tier prohibitions**, in particular 07-03 P3 (carried forward, never ruled).` → `4. **Fourteen judgment-tier prohibitions** still unruled; 07-03 P3 ruled 2026-09-04 (tenant uuid permitted — see Prohibitions).`

**3. `07-SECURITY.md:97`** — append to the `- T-7-14 residual:` notes line (same bullet, no new bullet): ` [Ruling 2026-09-04: tenant uuid permitted in that one fixed sentence — opaque internal id; sync-tick bodies already carry tenantId; needed to act on a wedge. Quote id, amount, customer data and the caught error remain forbidden.]`. Do not touch the T-7-14 table row at :48 beyond nothing — it already points at the residual note.

Verify with `git diff --stat` that only these three markdown files changed, then commit with the Task 3 message from `<executor_constraints>`.
  </action>
  <verify>
    <automated>cd "~/Documents/Projects/Productised service" && D=.planning/phases/07-attribution-reporting && test "$(grep -c 'Ruling 2026-09-04' $D/07-03-PLAN.md)" = 2 && test "$(grep -c 'MUST NOT carry a tenant id' $D/07-03-PLAN.md)" = 0 && test "$(sed -n '79p' $D/07-03-PLAN.md | grep -c '^    - statement: ".*"$')" = 1 && test "$(grep -c 'ruled: tenant uuid permitted' $D/07-VERIFICATION.md)" -ge 2 && test "$(grep -c 'Ruling 2026-09-04' $D/07-SECURITY.md)" = 1 && test "$(grep -c 'consumption threw for tenant' src/core/attribution/consume-wins.ts)" = 1 && git diff --quiet HEAD -- src tests && npx vitest run tests/attribution-consume-isolation.test.ts</automated>
  </verify>
  <done>
Acceptance criteria (live-tree baselines in parentheses; `D=.planning/phases/07-attribution-reporting`):
- `grep -c 'Ruling 2026-09-04' $D/07-03-PLAN.md` → `2` (0): the :79 statement and the :200 register row
- `grep -c 'MUST NOT carry a tenant id' $D/07-03-PLAN.md` → `0` (1)
- `sed -n '79p' $D/07-03-PLAN.md | grep -c '^    - statement: ".*"$'` → `1` (the YAML scalar is still one double-quoted line); `grep -c 'T-7-14' $D/07-03-PLAN.md` → `1` (1)
- `grep -c 'ruled: tenant uuid permitted' $D/07-VERIFICATION.md` → `≥ 2` (0); `sed -n '15p' $D/07-VERIFICATION.md | grep -c 'ruled'` → `1` (0); `grep -c 'Fourteen judgment-tier prohibitions' $D/07-VERIFICATION.md` → `1` (0)
- `grep -c 'Ruling 2026-09-04' $D/07-SECURITY.md` → `1` (0)
- `grep -c 'consumption threw for tenant' src/core/attribution/consume-wins.ts` → `1` (1, untouched); `git diff --quiet HEAD -- src tests` → exit 0 before the commit
- The `<automated>` command exits 0
- Commit `docs(quick-260904-dfq): rule 07-03 P3 — tenant uuid permitted in the consumer's fixed failure sentence` contains exactly the three markdown files in this task's `<files>`
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator browser → Server Action | `generateReportAction` is globally addressable; `authorize` (actions.ts:69-91) runs before the generator — unchanged by this task |
| generator → Postgres (service role) | `forTenant(tenantId).transaction` bypasses RLS by design; the new reads are tenant-pinned repository methods (`latestVersionOf`, `byId` pin `tenant_id` from the closure) |
| stored jsonb → comparator | previously written documents come back re-keyed by jsonb; a comparator that trusted key order would call every stored row "changed" and defeat the feature silently |
| planning documents → future verifiers | the ruling must read identically in all four documents or the next verifier re-flags the same line |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-Q-01 | Tampering | `reportDocumentsUnchanged` returning true for a document that DID change (a real correction never written; the client keeps a wrong figure) | high | mitigate | Byte-level canonical JSON over the five documents, no field list; the compared object is the inserted object (one `documents` const); differs-in-one-figure / differs-in-one-line / swapped-lines / null-vs-absent cases in tests/report-unchanged.test.ts; remote suite proves a fee change produces v2 (Task 1) |
| T-Q-02 | Tampering | comparator returning false for identical documents because jsonb re-keyed them (feature silently inert, duplicates continue) | medium | mitigate | key-order and undefined-vs-absent cases; generate-path case feeds `JSON.parse(JSON.stringify(written))` with re-ordered keys back through `byId` and asserts zero `insertVersion` calls (Task 1) |
| T-Q-03 | Tampering | the unchanged check reading a stale snapshot under two concurrent generates | low | accept | Worst case is one extra identical version — today's behaviour; `MAX(version)+1` at the write and `monthly_reports_version_uniq` still arbitrate; September race test now admits `concurrent` or `unchanged` for the loser (Task 1) |
| T-Q-04 | Denial of service | the two new reads holding a second pool connection under an open transaction (07 WR-02 starvation at `max: 5`) | high | mitigate | Both reads on the transaction's `repo`; pool-side `forTenant()` mock exposes no `reports` key so a pool read throws in the pure suite (Task 1) |
| T-Q-05 | Repudiation | a superseded version becoming unreachable from the list (the document a client was sent cannot be found when they ask) | high | mitigate | Every earlier version rendered in the DOM inside the month's `<details>` as a `Link`; no delete, no void flag; `Version N of M` banner on the report page untouched; `tests/report-list.test.ts` pins two disclosures and `superseded` (Task 2) |
| T-Q-06 | Information disclosure | the up-to-date sentence or the list leaking anything new | low | accept | Sentence carries month label + version only, already on screen; list carries the same `MonthlyReportSummary` fields it did (no documents) |
| T-Q-07 | Information disclosure | a new suite seeding or reading the production database on bare `npm test` | high | mitigate | Both new suites are pure (`vi.mock('@/db/repository')` / readFileSync); `grep -c 'helpers/seed'` = 0 gates on both; executor constraint 1 (Tasks 1, 2) |
| T-Q-08 | Tampering | the docs ruling widening beyond the one sentence (a future log line carrying a quote id "because tenant ids are allowed now") | medium | mitigate | The ruling names the single fixed sentence and the file:line; the forbidden list for logs still names quote id, amount, customer data and the caught error; isolation test :185-204 stays the enforcement (Task 3) |
| T-Q-SC | Tampering | npm/pip/cargo installs | low | accept | No install this task (executor constraint 5) |
</threat_model>

<verification>
After Task 3, from the repo root:

1. `npx tsc --noEmit && npm run lint && npm run build` — green.
2. `npx vitest run tests/report-unchanged.test.ts tests/report-list.test.ts tests/reporting-copy.test.ts tests/reports-authorization.test.ts tests/lint-ban.test.ts tests/layout-contract.test.ts tests/attribution-consume-isolation.test.ts` — green.
3. `npm test 2>&1 | grep -E 'FAIL|Test Files|Tests '` diffed against the pre-task baseline: identical FAIL set (remote-gate refusals only), higher passed count.
4. `git log --oneline -3` shows the three `quick-260904-dfq` commits, each scoped to its task's files; `git status --short` shows the pre-existing unrelated changes untouched.
5. Grep gates from all three `<done>` blocks re-run together and all hold.
6. Deferred to the next remote CI window (never run locally): `tests/monthly-report.test.ts` — the `unchanged` second press, the v2-after-fee-change case, and the race loser admitting `concurrent` or `unchanged`.
</verification>

<success_criteria>
- A second identical press of Generate returns `unchanged`, writes no `monthly_reports` row, and the form says `<Month> is already up to date (version N).` with `Open it →` pointing at that version.
- A press after any of the five documents changed writes version N+1 and keeps N, exactly as D-11 promised.
- `/reports/[client]` shows one row per month; a month with earlier versions carries a native `<details class="disclosure">` reading `show N earlier version(s)`; every superseded version is a working link that opens with its `Version N of M` banner.
- The cap notice names report VERSIONS as the capped unit and warns that the oldest month shown may be missing earlier versions.
- `action-state.ts` still imports nothing; `generate-form.tsx` still has exactly its four imports; no `@/db` reaches the browser bundle.
- No schema change, no migration, no repository method, no delete, no void flag, no new dependency, no remote test run.
- 07-03 P3, T-7-14 (07-03 and 07-SECURITY) and 07-VERIFICATION all carry the same `[Ruling 2026-09-04: …]`: tenant uuid permitted in the consumer's one fixed failure sentence; quote id, amount, customer data and the caught error still forbidden; code and isolation test untouched.
- Three commits, `feat`/`feat`/`docs` under `quick-260904-dfq`, each scoped to its task's files.
</success_criteria>

<output>
Create `.planning/quick/260904-dfq-make-report-generate-idempotent-and-coll/260904-dfq-SUMMARY.md` when done, recording: the comparator's canonicalisation rules, the seventh result arm, which remote assertions changed and why they could not be run locally, the `latest`-badge-only-when-earlier-versions-exist discretion, and the four document locations carrying the ruling tag.
</output>
