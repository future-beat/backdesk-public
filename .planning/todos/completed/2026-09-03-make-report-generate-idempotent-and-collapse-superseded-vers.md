---
created: 2026-09-03T15:45:33Z
title: Make report Generate idempotent and collapse superseded versions
area: ui
severity: minor
sequence_after: 07-07-PLAN.md (Phase 7 gap closure) — run as /gsd-quick once 07-07 has executed and deployed
files:
  - src/core/reporting/generate.ts:207-395
  - src/db/repository (reports.insertVersion / reports.list, REPORT_LIST_LIMIT)
  - src/app/(console)/reports/[client]/page.tsx:299-460
  - src/app/(console)/reports/[client]/generate-form.tsx
  - src/app/(console)/reports/[client]/actions.ts
  - src/db/schema/monthly-reports.ts
---

## Problem

Pressing Generate on `/reports/[client]` always writes version N+1 of the month (D-11: re-generating creates N+1 and keeps N), even when nothing has changed since version N. During Phase 7 UAT the operator generated the August 2026 fixture month three times and got three byte-identical versions; the "Monthly reports" list shows every version, so a month that was merely re-pressed reads like a month that changed, and the operator asked for a way to delete reports.

Hard delete was rejected on 3 Sep 2026: a frozen version may already be stapled to an invoice, nothing tracks whether a version was sent, and D-11 exists precisely so a client's copy can always be reproduced. The problem to solve is the duplicate creation and the cluttered list, not the retention.

## Solution

1. **Idempotent Generate.** In `generateMonthlyReport`, after building the five frozen documents and before `reports.insertVersion`, load the latest version for (tenant, period) and compare the documents (stable JSON, byte equality — the same `parseReportDocument` shape the page renders from). If identical, return a new result kind (e.g. `{ kind: 'unchanged', reportId, version }`) and do not write; the form shows "August 2026 is already up to date (version 3)" with a link to it. `generated_at`/`prepared` must be excluded from the comparison. Unit-test the comparison with a pure function; the existing generate tests cover the write path.
2. **One row per month in the list.** `/reports/[client]` shows the latest version per month by default with a "show N earlier versions" disclosure (native `<details>`, matching the fee-schedule disclosure) — superseded rows stay reachable and keep their "Version N of M" banner on open. `REPORT_LIST_LIMIT` semantics and the "Showing the most recent…" cap notice must still be honest after grouping.
3. **Not in scope:** deleting rows; a "void" flag (only if 1–2 prove insufficient — reversible, keeps the row, prints a "voided" banner).

Constraints: the hosted Supabase is production (no `npm run test:remote` overlap with live ticks); no schema change needed for 1–2; keep the lint-ban CLIENT_REACHABLE list intact if a client island is touched.
