---
phase: 07-attribution-reporting
plan: 01
subsystem: database
tags: [postgres, drizzle, supabase, rls, migrations, unique-index, integer-cents, jsonb, append-only, vitest]

requires:
  - phase: 01-foundation
    provides: "has_tenant_access(), the pgPolicy-in-schema rule, forTenant() and its no-tenantId-parameter design, the REVOKE-then-GRANT migration shape"
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: "quotes mirror (total_invoice_amount, quotes_tenant_job_uniq — the tenant-scoped-uniqueness argument), the quote_status_events outbox and detected_at vs occurred_at"
  - phase: 03-cadence-engine
    provides: "send_ledger (claimed_at as the sent moment, no sent_at), the targetless ON CONFLICT DO NOTHING claim shape, the evidence-family no-FK-no-cascade rule"
  - phase: 05-ai-drafting-classification
    provides: "touch_drafts' unique partial index — the 23505-at-the-write precedent reports.insertVersion reuses"
  - phase: 06-review-console-escalation
    provides: "escalations.ts as the evidence-family mould, tenant_attestations' append-only posture and latest-wins index, migration 0032 as the consolidation shape"
  - phase: 07-attribution-reporting
    provides: "07-02's pure modules — FeeRow (effectiveFrom as a YYYY-MM-DD string, amountCents as a number) and Period, which the tenant_fees and monthly_reports column types are shaped to feed"
provides:
  - "quote_attributions on the hosted Sydney database: the at-most-once-per-quote attribution ledger (D-04), with the win's event id, the frozen gross/conservative cents, the baseline and window it was computed under, and the D-05 evidence chain"
  - "monthly_reports: the frozen, versioned report document a client was sent (D-11), with five NOT NULL jsonb columns and monthly_reports_version_uniq as the concurrent-generate arbiter"
  - "tenant_fees: the append-only per-client fee schedule (D-13), config family with ON DELETE CASCADE, CHECK-constrained kinds and a non-negative amount"
  - "migration 0033_phase7_reporting — the phase's ONE journal entry (idx 33), applied to production; no other Phase 7 plan touches the journal"
  - "send_ledger_tenant_quote_idx — the by-quote ledger read the evidence chain and the report line need"
  - "forTenant().attributions.{claim,listForPeriod,byQuote}, .reports.{insertVersion,list,byId}, .fees.{append,list} — no update or delete member on any of the three"
  - "AttributionClaim / ReportInsert / FeeInsert / MonthlyReportSummary / REPORT_LIST_LIMIT on the repository barrel"
  - "seedAttribution, seedFee, seedLedgerRow, seedInbound and ordered teardown for the three tables"
affects: [07-03-attribution-consumer, 07-04-report-generation-and-page, 07-05-metrics-overview]

actuals:
  tokens: 49382
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Evidence family vs config family, stated per table: no FK / no cascade for what outlives the client, FK with ON DELETE CASCADE for what does not"
    - "Never-twice by unique index + targetless ON CONFLICT DO NOTHING RETURNING; zero rows is a meaningful answer, never an error"
    - "Version computed inside the INSERT under a unique index, so the loser raises 23505 at the write rather than silently overwriting"
    - "Money as integer cents in bigint columns declared to read back as JS numbers; rates as integer basis points"
    - "Absent method as the rule: append-only / write-once namespaces expose no update or delete, and a source assertion pins the absence"

key-files:
  created:
    - src/db/schema/quote-attributions.ts
    - src/db/schema/monthly-reports.ts
    - src/db/schema/tenant-fees.ts
    - src/db/migrations/0033_phase7_reporting.sql
    - src/db/migrations/meta/0033_snapshot.json
    - tests/reporting-tables.test.ts
  modified:
    - src/db/schema/send-ledger.ts
    - src/db/schema/index.ts
    - src/db/migrations/meta/_journal.json
    - src/db/repository/for-tenant.ts
    - src/db/repository/index.ts
    - tests/rls-coverage.test.ts
    - tests/helpers/seed.ts
    - tests/lint-ban.test.ts

key-decisions:
  - "Task 0 gate answered `proceed` (2026-09-02): D-03 (frozen snapshot value), D-04 (unique attribution index) and D-11 (frozen versioned reports) confirmed as one-way doors before 0033 landed on the production database. 07-03 T1 and 07-04 T1 keep their one-way ratings for the record and do not prompt again."
  - "quote_attributions_one_per_quote is (tenant_id, quote_id), not (quote_id): two clients could be handed the same job uuid by a shared ServiceM8 account, and one tenant's win must never consume another's claim — the quotes_tenant_job_uniq argument. Proven both ways in the suite (another tenant may claim the same quote id; the same tenant may claim a different quote)."
  - "attributions.claim uses TARGETLESS ON CONFLICT DO NOTHING: naming the arbiter would turn a conflict on any other index into a 23505 raised inside the consumer's transaction, which the consumer reads as a blocked run and which holds the shared attribution cursor for every tenant."
  - "reports.insertVersion computes version inside the INSERT (COALESCE(MAX(version),0)+1) rather than reading then writing, so two concurrent generates cannot both compute the same next number; monthly_reports_version_uniq arbitrates and the CALLER maps 23505."
  - "reports.list returns a six-column MonthlyReportSummary — a distinct TYPE, not a comment — so a caller reaching for summary.figures fails to compile; the five jsonb documents are fetched only by byId, for the one report being read."
  - "fees.list orders effective_from DESC then created_at DESC. The second key is the D-13 rule for a same-day correction: latest-inserted wins, and ordering on effective_from alone leaves the tie to the planner."
  - "monthly_reports.figures/lines/baseline/constants/fees carry NO CHECK constraints, deliberately: they are frozen documents whose shape is versioned by the generator that wrote them, and a key constraint would make an old report unreadable the first time the report gains a figure. NOT NULL is the whole database-level guarantee."
  - "tenant_fees.effective_from has no default anywhere in the stack (schema, repository type, seed helper) — the no-default-contact-window rule: a defaulted now() would silently backdate or forward-date a price change depending on when the form was submitted."
  - "seedLedgerRow defaults to a QUALIFYING touch (sender 'clicksend', outcome 'sent', delivery_status NULL). A 'stub' default would be excluded from attribution forever by the sender column and would make every later attribution suite silently assert nothing."

patterns-established:
  - "Half-open period reads: attributions.listForPeriod is >= start AND < end, asserted millisecond-by-millisecond against the Perth August 2026 boundary rather than mid-month, because a closed upper bound bills one job in two months"
  - "Cross-tenant id reads return [] rather than an error: reports.byId pins tenant_id from the closure beside the id, so denial and absence stay indistinguishable for a uuid in a URL (T-7-04)"
  - "Source assertion for guarantees that are absences: the interface text is sliced per namespace and member declarations are collected at the interface indent, so doc comments that say UPDATE and DELETE out loud cannot trip it"
  - "Seed helpers for evidence tables on a production database use ACMA fiction numbers (+61491570xxx) and empty message bodies, and require the timestamp a window or period is measured against"

requirements-completed: []

coverage:
  - id: D1
    description: "The three Phase 7 tables exist on the hosted Sydney database from ONE monotonic journal entry (0033_phase7_reporting), with their indexes, policies, CHECK vocabularies and grants"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/prospect-staging-retention.test.ts#migration journal ordering"
        status: pass
      - kind: integration
        ref: "npm run db:generate (second run reports 'No schema changes'); npm run db:migrate run twice, second applies nothing"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#has row-level security enabled on every table in the public schema"
        status: pass
    human_judgment: false
  - id: D2
    description: "The DATABASE refuses a second attribution for a quote: a repeated claim returns zero rows and leaves the first row byte-identical, tenant-scoped so another client may still claim the same quote id"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "tests/reporting-tables.test.ts#claims once, then returns zero rows and leaves the first row untouched"
        status: pass
      - kind: integration
        ref: "tests/reporting-tables.test.ts#is tenant-scoped: another client may still claim the same quote id"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#enforces at-most-once attribution and one row per report version in the database (RPT-01, RPT-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A regenerated report is version N+1 and version N survives, with per-period_start version sequences"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "tests/reporting-tables.test.ts#writes version 1 then version 2 for one period and keeps both"
        status: pass
      - kind: integration
        ref: "tests/reporting-tables.test.ts#keeps versions independent per period_start"
        status: pass
    human_judgment: false
  - id: D4
    description: "Console roles hold SELECT ONLY on all three tables and service_role holds ALL; the repository exposes no update or delete member on attributions, reports or fees"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#grants exactly the documented privileges and nothing inherited (WR-04)"
        status: pass
      - kind: unit
        ref: "tests/reporting-tables.test.ts#the three namespaces expose no write-back surface (RPT-01, T-7-03)"
        status: pass
    human_judgment: false
  - id: D5
    description: "tenant_fees is append-only with latest-inserted-wins on an effective_from tie, a non-negative amount and a closed kind vocabulary, all enforced by the database"
    verification:
      - kind: integration
        ref: "tests/reporting-tables.test.ts#appends two rows for one effective_from and orders the later one first"
        status: pass
      - kind: integration
        ref: "tests/reporting-tables.test.ts#refuses a negative amount at the database (0033 CHECK)"
        status: pass
      - kind: integration
        ref: "tests/reporting-tables.test.ts#refuses an unknown fee kind at the database (0033 CHECK)"
        status: pass
      - kind: integration
        ref: "tests/reporting-tables.test.ts#fees.list resolves a same-day correction through the repository"
        status: pass
    human_judgment: false
  - id: D6
    description: "The keyed reads later plans run on: half-open listForPeriod, byQuote, a document-free reports.list ordered before it is limited, a tenant-pinned reports.byId, and fees.list"
    verification:
      - kind: integration
        ref: "tests/reporting-tables.test.ts#listForPeriod is half-open at BOTH ends (D-10)"
        status: pass
      - kind: integration
        ref: "tests/reporting-tables.test.ts#reports.list is newest-first and carries no frozen document"
        status: pass
      - kind: integration
        ref: "tests/reporting-tables.test.ts#reports.byId returns the full row, and nothing across tenants (T-7-04)"
        status: pass
    human_judgment: false
  - id: D7
    description: "seedAttribution, seedFee, seedLedgerRow and seedInbound exist with production-safe defaults, and teardownTenants removes all three Phase 7 tables for seeded tenants"
    verification:
      - kind: integration
        ref: "tests/reporting-tables.test.ts#seeds ledger and inbound evidence with fiction addresses and no bodies"
        status: pass
      - kind: manual_procedural
        ref: "post-run count of quote_attributions / monthly_reports / tenant_fees on the hosted database — 0 rows, no residue"
        status: pass
    human_judgment: false

duration: 32min
completed: 2026-09-02
status: complete
---

# Phase 7 Plan 01: Attribution & Reporting Tables Summary

**Three tables live on the production Sydney database from one monotonic journal entry — Postgres, not the caller, now refuses a second attribution for a quote and a rewritten report, and console roles can read every one of them and write none.**

## Performance

- **Duration:** 32 min (execution after the Task 0 gate was answered)
- **Started:** 2026-09-02T13:05:00Z
- **Completed:** 2026-09-02T13:37:00Z
- **Tasks:** 2 (plus the Task 0 decision gate, answered `proceed`)
- **Files modified:** 14 (6 created, 8 modified)

## Accomplishments

- `quote_attributions`, `monthly_reports` and `tenant_fees` exist on the hosted Sydney database, created by `0033_phase7_reporting` — the phase's ONE journal entry (idx 33, `when` strictly greater than 0032's). A second `db:generate` reports "No schema changes" and a second `db:migrate` applies nothing; both proven, not reasoned.
- The D-04 never-twice guarantee is a database fact: a second `attributions.claim` for a quote returns `[]` and the stored row's `id`, `attributed_at` and `gross_cents` are unchanged even though the refused claim carried different figures. It is tenant-scoped, so another client may still claim the same quote id, and the same client may still claim a different quote.
- The D-11 freeze is a database fact too: `reports.insertVersion` writes version 1 then version 2 for one `period_start` and keeps both, with the version computed inside the INSERT so `monthly_reports_version_uniq` arbitrates concurrent generates rather than one silently replacing the other.
- `authenticated` and `anon` hold SELECT and nothing else on all three tables; `service_role` holds ALL. `tests/rls-coverage.test.ts` pins all six `table/role` entries and asserts both unique indexes' column tuples out of `pg_indexes`, so a silently-skipped migration goes red instead of surfacing as a double-billed job.
- The repository exposes `claim` / `listForPeriod` / `byQuote`, `insertVersion` / `list` / `byId`, `append` / `list` — and no `update` or `delete` on any of them, with a source assertion that slices each namespace's interface block and would fail if one appeared.
- `seedLedgerRow` and `seedInbound` give 07-03/07-04/07-05 their evidence seeders, with a qualifying-touch default, ACMA fiction numbers and empty bodies — these rows land on the production database.

## Task Commits

1. **Task 0 (gate): Confirm the phase's three one-way doors** — answered `proceed` (no commit; a decision gate)
2. **Task 1: Three tables end-to-end — schema → ONE migration applied to the hosted DB → repository claim → never-twice proven [BLOCKING]** — `ef812bc` (feat)
3. **Task 2: Keyed reads for the three tables + seeds the later suites need** — `70062e7` (feat)
4. **[Rule 3] Barrel tripwire pin** — `efe51de` (test)

**Plan metadata:** see the final `docs(07-01)` commit.

## Files Created/Modified

- `src/db/schema/quote-attributions.ts` — the evidence table, `ATTRIBUTION_VALUE_SOURCES`, `BASELINE_SOURCES`, `quote_attributions_one_per_quote`, `quote_attributions_tenant_won_idx`, policy
- `src/db/schema/monthly-reports.ts` — the frozen versioned document table, five NOT NULL jsonb columns, `monthly_reports_version_uniq`, policy
- `src/db/schema/tenant-fees.ts` — append-only config table, `TENANT_FEE_KINDS`, `tenant_fees_in_force_idx`, FK with cascade, policy
- `src/db/migrations/0033_phase7_reporting.sql` — three tables, five indexes, three policies, four CHECKs, three REVOKE-then-GRANT blocks, each with its own argument
- `src/db/migrations/meta/_journal.json` — one entry, idx 33, tag `0033_phase7_reporting`
- `src/db/schema/send-ledger.ts` — `send_ledger_tenant_quote_idx`
- `src/db/schema/index.ts` — three barrel exports
- `src/db/repository/for-tenant.ts` — `attributions` / `reports` / `fees` namespaces on the interface and in `build()`, `AttributionClaim` / `ReportInsert` / `FeeInsert` / `MonthlyReportSummary`, `REPORT_LIST_LIMIT`
- `src/db/repository/index.ts` — the four types and the constant re-exported
- `tests/reporting-tables.test.ts` — the Phase 7 tracer: 17 cases across never-twice, versioning, fee ordering, the CHECKs, the keyed reads and the absent-write-surface source assertion
- `tests/rls-coverage.test.ts` — six new `table/role` entries and the unique-index assertion
- `tests/helpers/seed.ts` — `seedAttribution`, `seedFee`, `seedLedgerRow`, `seedInbound`, three tables added to `NO_CASCADE_TABLES`
- `tests/lint-ban.test.ts` — `REPORT_LIST_LIMIT` pinned in the repository barrel's exact export set

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one for the phase's reversibility record: **the Task 0 gate was answered `proceed` on 2026-09-02**, confirming D-03, D-04 and D-11 as one-way doors before migration 0033 landed on the production database. The three tables, their CHECKs and grants, and both unique indexes are now the record.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `REPORT_LIST_LIMIT` broke the repository barrel's pinned export set**
- **Found during:** Task 2 (keyed reads)
- **Issue:** `tests/lint-ban.test.ts` asserts `Object.keys(barrel).sort()` against an exact 45-name list (the ONB-05 raw-client ban). `REPORT_LIST_LIMIT` is a runtime export, so it appeared in that set and turned the guard red. The types added alongside it (`AttributionClaim`, `ReportInsert`, `FeeInsert`, `MonthlyReportSummary`) are erased and did not.
- **Fix:** Added `'REPORT_LIST_LIMIT'` to the pinned list with a decision-record comment in the established form — it is an integer, not a new cross-tenant crossing, and `monthly_reports` is reachable only through `forTenant()`.
- **Files modified:** `tests/lint-ban.test.ts`
- **Verification:** `npx vitest run tests/lint-ban.test.ts` — 22 passed
- **Committed in:** `efe51de`

**2. [Rule 2 - Missing Critical] Two extra CHECK-constraint cases in the tracer suite**
- **Found during:** Task 1 (proof)
- **Issue:** The plan's proof cases covered the two unique indexes and the fee ordering but exercised none of the four CHECK vocabularies the migration hand-finishes. A CHECK that was written into the migration but never applied (the exact failure mode the journal trap produces) would have passed every listed case.
- **Fix:** Added `refuses a negative amount at the database (0033 CHECK)` and `refuses an unknown fee kind at the database (0033 CHECK)`, both writing through `admin` and asserting the constraint name in the error.
- **Files modified:** `tests/reporting-tables.test.ts`
- **Verification:** both pass against the hosted database
- **Committed in:** `ef812bc` (part of the Task 1 commit)

**3. [Rule 2 - Missing Critical] A per-quote counter-assertion beside the tenant-scoping one**
- **Found during:** Task 1 (proof)
- **Issue:** The plan proved the index is not GLOBAL (another tenant may claim the same quote id) but not that it is not per-TENANT. A unique index on `tenant_id` alone would have passed every listed case while capping every client at one recovered job for all time.
- **Fix:** Added `leaves the same client free to claim a DIFFERENT quote`, using the second seeded quote.
- **Files modified:** `tests/reporting-tables.test.ts`
- **Verification:** passes
- **Committed in:** `ef812bc`

**4. [Rule 3 - Blocking] Repository barrel re-exports**
- **Found during:** Tasks 1 and 2
- **Issue:** `src/db/repository/index.ts` is not in the plan's `files_modified`, but the tracer suite imports `AttributionClaim` and `MonthlyReportSummary` from `../src/db/repository` — the only sanctioned entry point (the raw client is deliberately not re-exported). Without the re-exports the suite could not compile.
- **Fix:** Added the four types and `REPORT_LIST_LIMIT` to the barrel with annotated comments in the `TouchDraftInsert` / `MAX_DRAFT_FAILURES` form.
- **Files modified:** `src/db/repository/index.ts`
- **Verification:** `npx tsc --noEmit` clean; the cross-tenant tripwire in `tests/sync-upsert.test.ts` reads `for-all-tenants.ts` and is unaffected (18 passed)
- **Committed in:** `ef812bc` and `70062e7`

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 missing critical)
**Impact on plan:** No scope creep. Two are test coverage the plan's own threat register (T-7-05) implies but did not enumerate; two are the mechanical consequence of adding a runtime export to a barrel whose surface is pinned by design.

## Issues Encountered

- **The generated migration needed no `when` hand-stamping.** drizzle-kit stamped `1788325815830`, comfortably above 0032's `1788230927449`, so the 0027 precedent (hand-stamping a greater value) did not have to be applied. Only the filename and the journal `tag` were renamed.
- **`grep`-exact acceptance criteria constrained prose.** Three acceptance criteria pin `grep -c` counts (`mode: 'number'` exactly 1 in `tenant-fees.ts`, `references` exactly 0 in the two evidence schemas, `onConflictDoNothing()` up by exactly 1). Two doc comments had to be reworded to keep the counts honest rather than the criteria loosened — the comments say the same thing in different words.
- **No production residue.** Post-run counts on the hosted database: `quote_attributions` 0, `monthly_reports` 0, `tenant_fees` 0. The two `send_ledger` and four `inbound_messages` rows present are pre-existing production rows from 29 August, not this run's.

## User Setup Required

None — no external service configuration required. The migration was applied to the hosted Sydney project with the existing `MIGRATE_DATABASE_URL` session connection.

## Next Phase Readiness

- **07-03 (attribution consumer) is unblocked:** `quote_attributions` exists, `attributions.claim` is the never-twice write, `attributions.byQuote` and `send_ledger_tenant_quote_idx` serve the evidence chain, and `seedLedgerRow` / `seedInbound` seed the qualifying touches and threaded replies its suites need. It must still park the `'attribution'` cursor at the outbox head and rewind only to its own first event id (Pitfall 11) — this plan added no cursor handling.
- **07-04 (report generation and page) is unblocked:** `reports.insertVersion` / `list` / `byId` and `fees.append` / `list` exist; the action must map SQLSTATE 23505 from `insertVersion` to the "just generated — reload" message, which is deliberately the caller's job.
- **07-05 (metrics overview)** still needs its own `forAllTenants_reportMetrics` and the two tripwire updates in `tests/sync-upsert.test.ts` (12→13 exports, 13→15 tables) — untouched here.
- **RPT-01 / RPT-02 remain `Pending` in REQUIREMENTS.md**, per the phase's rule that requirements flip only at the last plan. The tables are real; nothing yet writes an attribution or generates a report.

---
*Phase: 07-attribution-reporting*
*Completed: 2026-09-02*

## Self-Check: PASSED

All six created files and the SUMMARY exist on disk; all three task commits (`ef812bc`, `70062e7`, `efe51de`) are in the git history.
