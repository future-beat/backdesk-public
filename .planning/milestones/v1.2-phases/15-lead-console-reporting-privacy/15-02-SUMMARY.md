---
phase: 15-lead-console-reporting-privacy
plan: 02
subsystem: env / leads (pseudonym leaf) / reporting (document, figures, CSV, copy) / console leaves
status: complete
tags: [caller-pseudonym-pepper, hmac, missed-calls-report-block, partner-csv, client-safe-leaves, d-01, d-02, d-03, d-04, d-06, d-10, d-11]
requires:
  - 15-01 (TEXT_BACK_SKIP_REASONS carries recent_conversion; migration 0042 widens leads_contact_mobile_e164 to admit a 64-lower-hex hash under pseudonymised_at)
  - Phase 9 AUDIT_IP_HASH_SALT pattern (secret as an argument; REQUIRED in the four places)
  - Phase 7 frozen report document (reportFiguresSchema, canonicalJson, reportDocumentsUnchanged, methodologyNotes)
provides:
  - CALLER_PSEUDONYM_PEPPER as a REQUIRED server env var (schema, pick-list, tests/helpers/env.ts, CI dummy, docs/env-vars.md)
  - src/core/leads/pseudonym.ts — pseudonymiseCaller, isPseudonym, PSEUDONYM_PATTERN, PEPPER_MIN_CHARS
  - reportMissedCallsSchema + ReportMissedCallsDocument; reportFiguresSchema.missedCalls optional and last
  - src/core/reporting/missed-call-figures.ts — MissedCallCounts, computeMissedCallFigures
  - src/core/reporting/partner-csv.ts — PARTNER_CSV_HEADER, PartnerCsvInput, partnerCsvRows, partnerCsv
  - copy.ts — NO_SAMPLES_LABEL, MISSED_CALL_EVIDENCE, MISSED_CALL_LIVE_FOOTNOTE, MISSED_CALL_SHEET_NOTE; methodologyNotes appends the sheet note only when the row carries the block
  - tests/fixtures/monthly-report-v1.json — a stored pre-Phase-15 report row (D-11 fixture)
  - Three client-safe leaves — leads/action-state.ts, components/text-back-outcome.ts, reports/export-state.ts — listed in CLIENT_REACHABLE
affects:
  - 15-03 (repository read returns MissedCallCounts; the export read gets the same no-personal-token structural pin as partner-csv.ts)
  - 15-04 (lead-card.tsx imports leads/action-state.ts; queue-card.tsx moves onto LEAD_TOUCH_COUNT; lead-card.tsx joins CLIENT_REACHABLE)
  - 15-05 / 15-06 (missed-call log rows use text-back-outcome.ts; the export island uses export-state.ts and joins CLIENT_REACHABLE; the reports pages use the copy constants)
  - 15-07 (the pass reads the pepper through the reconcile route's getServerEnv() and hands it to pseudonymiseCaller)
  - 15-08 (the pepper must exist on Vercel Production + Preview BEFORE main is pushed)
tech-stack:
  added: []
  patterns:
    - "Optional LAST key on a frozen zod document, pinned by a hand-written stored-row fixture whose canonical JSON and note count must not move"
    - "One CSV writer with a byte-pinned header and a comment-stripped source grep for personal-field tokens"
    - "Client-safe label leaves keyed by string literals; the TEST imports the schema vocabulary and checks exhaustiveness"
    - "Time threshold passed into a pure resolver as milliseconds, so the leaf imports nothing"
key-files:
  created:
    - src/core/leads/pseudonym.ts
    - src/core/reporting/missed-call-figures.ts
    - src/core/reporting/partner-csv.ts
    - src/app/(console)/leads/action-state.ts
    - src/app/(console)/components/text-back-outcome.ts
    - src/app/(console)/reports/export-state.ts
    - tests/fixtures/monthly-report-v1.json
    - tests/pseudonym.test.ts
    - tests/missed-call-figures.test.ts
    - tests/partner-csv.test.ts
    - tests/report-frozen-fixture.test.ts
    - tests/text-back-outcome-labels.test.ts
  modified:
    - src/core/shared/env.ts
    - docs/env-vars.md
    - tests/helpers/env.ts
    - .github/workflows/ci.yml
    - src/core/reporting/document.ts (additions only)
    - src/core/reporting/copy.ts
    - tests/lint-ban.test.ts
decisions:
  - "partnerCsv appends the trailing CRLF only when papaparse has not: papaparse 5.7.0 already ends a header-only file (no data rows) with the newline, and does not when there are data rows, so an unconditional append would double it on the empty file"
  - "The fixture's methodologyNotes count is 5 (measured on the fixture before the copy change); both fixture lines are valueSource mirror, so no dagger note"
  - "TEXT_BACK_SKIP_REASON_LABELS carries 14 entries: the 13 UI-SPEC §2 words plus stale -> 'stale' (stale has its own chip but the map is pinned exhaustive against the vocabulary)"
  - "resolveTextBackOutcome treats elapsed < stuckAfterMs as young (at exactly the threshold the chip is undecided/stuck); an unknown status resolves to 'undecided' (warn), never the raw value; skipped with a null reason is 'skipped'"
  - "leads/action-state.ts returns the shared ControlState (it already carries settled?), so no local State type was needed"
metrics:
  duration: "~12 min"
  completed: 2026-10-13
  tasks: 3
  files: 19
estimate:
  tokens: 70000
actuals:
  tokens: 19400
  tasks: 3
  commits: 4
---

# Phase 15 Plan 02: Pepper, HMAC leaf, missedCalls report block, partner CSV and the three client-safe leaves Summary

The caller pepper is now a REQUIRED server env var in all four places. It feeds an HMAC-SHA-256 leaf that takes it as an argument. The frozen report gained an optional, last `missedCalls` block, and a stored pre-Phase-15 row parses to `undefined` with byte-identical canonical figures and the same 5 notes. The plan also adds one pure figures derivation, one CSV writer with a fixed fourteen-column header, and three import-safe console leaves whose label maps are pinned against the schema vocabularies.

## What was built

### Task 1: the pepper and the HMAC leaf (commit 64ff201)

- `src/core/shared/env.ts`: `CALLER_PSEUDONYM_PEPPER: z.string().min(32)` after `AUDIT_IP_HASH_SALT`, with its paragraph. The paragraph says it is a keyed hash because of the 10^8 mobile space, that it is REQUIRED rather than skip-if-absent, and that rotation is a recorded decision. The pick-list line has the "absent validates as undefined" note.
- `tests/helpers/env.ts`: `'CALLER_PSEUDONYM_PEPPER'` added to `REQUIRED` with a dated comment.
- `.github/workflows/ci.yml`: a distinct dummy, `ci-caller-pseudonym-pepper-not-a-secret-000000000000000000000000`, which is **exactly 64 characters** (checked with `wc -c`). It sits after the salt's echo line with a two-line comment.
- `docs/env-vars.md`: a paragraph after the salt's, the example line `CALLER_PSEUDONYM_PEPPER=hex-32-bytes`, and the "BY HAND" note extended to all three keys. The note includes the push command `node scripts/push-vercel-env.mjs --project backdesk --envs production,preview CALLER_PSEUDONYM_PEPPER` and the env-before-code ORDER rule. There is also a "Who reads what" row.
- `src/core/leads/pseudonym.ts`: imports only `node:crypto`.
  - `PEPPER_MIN_CHARS = 32`.
  - `pseudonymiseCaller(value, pepper)` throws `pseudonym: pepper too short` below the floor. Otherwise it returns `createHmac('sha256', pepper).update(value, 'utf8').digest('hex')`.
  - `PSEUDONYM_PATTERN = /^[0-9a-f]{64}$/` and `isPseudonym`.
  - It never reads the environment.

### Task 2: the report block, figures, CSV and fixture (commit f8838f9)

- `document.ts`: adds `rateSchema`, `reportMissedCallsSchema` and `ReportMissedCallsDocument`. `missedCalls: reportMissedCallsSchema.optional()` is the LAST key. The diff against the phase base is additions only (0 removed lines).
- `missed-call-figures.ts`:
  - `MissedCallCounts` and `computeMissedCallFigures`.
  - Every rate is `{numerator, denominator, rateBp}`, with `rateBp` null at a zero denominator.
  - The median is the `escalationSpeed` median. P90 is nearest-rank `sorted[min(n-1, ceil(0.9n)-1)]`. Both are null when n = 0.
  - Negative seconds clamp to 0.
  - The 24/7/7 lengths are asserted and throw on a mismatch.
- `partner-csv.ts`:
  - `PARTNER_CSV_HEADER` has the fourteen columns.
  - `partnerCsvRows` sorts by client then month. A missing block gives empty cells, and a null median or P90 gives an empty cell. A name starting with `=`, `+`, `-` or `@` gets an apostrophe.
  - `partnerCsv` uses `Papa.unparse({fields, data}, {newline: '\r\n'})` and the file always ends in exactly one CRLF.
- `copy.ts`: adds `NO_SAMPLES_LABEL`, `MISSED_CALL_EVIDENCE`, `MISSED_CALL_LIVE_FOOTNOTE` and `MISSED_CALL_SHEET_NOTE`, checked byte-for-byte against UI-SPEC §3b and §3c. `methodologyNotes` appends the sheet note LAST only when `row.figures.missedCalls !== undefined`.
- `tests/fixtures/monthly-report-v1.json`: a hand-written stored row for a fictional Perth tenant, Aug 2026. It has the eleven figure keys, two lines (both `mirror`), a `connect` baseline, constants and fees. The figures are consistent: conservative = gross x (1 - 0.70), and the multiples are floored bp. It contains no `+61` and no nine-digit run.
- **Pinned `methodologyNotes` count for the fixture: 5.** A row carrying the block gets 6, and the last one is `MISSED_CALL_SHEET_NOTE`.

### Task 3: the three client-safe leaves (commit de94b43)

- `src/app/(console)/leads/action-state.ts`: value-imports only `zod` and `../components/action-state`. It has 18 `export const`s:
  - `LEAD_TOUCH_COUNT`
  - `CLOSE_STEP_LABEL`, `CLOSE_CONFIRM_LABEL`, `CLOSE_DISMISS_LABEL`, `CLOSE_PENDING_LABEL`
  - `LEAD_CLOSED_MESSAGE`, `LEAD_ALREADY_CLOSED_MESSAGE`, `LEAD_CLOSE_FAILED_MESSAGE`
  - `APPROVE_TOUCH_LABEL`, `NEXT_TOUCH_STATE_LABELS`, `STALLED_LABEL`, `NO_FOLLOW_UPS_LEFT_LABEL`, `NO_REPLY_LABEL`
  - `LEADS_HINT`, `LEADS_EMPTY_TITLE`, `LEADS_EMPTY_HINT`, `LEADS_LOAD_FAILED_MESSAGE`
  - `closeLeadSchema`

  It also exports `closeConsequence()`, `closeControlState()` and `type CloseOutcome`.
- `src/app/(console)/components/text-back-outcome.ts` (imports nothing):
  - `TEXT_BACK_OUTCOME_LABELS`.
  - `TEXT_BACK_SKIP_REASON_LABELS` with 14 entries, including `recent_conversion` -> `booked recently`.
  - `CALLER_KIND_LABELS`, `AFTER_HOURS_LABEL`, `NUMBER_RETIRED_LABEL`.
  - `TextBackOutcomeFacts`, `TextBackOutcomeTone`, `TextBackOutcome`.
  - `resolveTextBackOutcome(facts, now, stuckAfterMs)`.
- `src/app/(console)/reports/export-state.ts` (imports nothing): `EXPORT_LABEL`, `EXPORT_PENDING_LABEL`, `EXPORT_EMPTY_MESSAGE`, `EXPORT_FAILED_MESSAGE`, `EXPORT_HINT`, `EXPORT_FILENAME_PREFIX`, `exportedMessage()`, `ExportState` and `BLANK_EXPORT_STATE`.
- `tests/lint-ban.test.ts`: `CLIENT_REACHABLE` gains the three paths under one dated comment (2026-10-13, Phase 15, 15-02).
- None of the leaves uses a string replace. Every label comes from a map.

## Local verification

- Task 1 chain, with the CI dummy set INLINE (no file named): 6 files, 447 tests passed. Typecheck and lint were green and every grep clause passed.
- Task 2 chain: 7 files, 136 tests passed. Typecheck and lint were green. `figures.ts`, `unchanged.ts`, `generate.ts` and the four pinned reporting suites are byte-identical to the phase base.
- Task 3 chain: 3 files, 311 tests passed. Typecheck and lint were green and every grep clause passed.
- Plan-level run of 15 pure suites (all of the above, plus `reporting-*`, `report-unchanged` and `console-error-leak`) with the inline dummy: **865 passed**.
- **Expected local failure, recorded (the 11-01 precedent).** On a bare run with no inline pepper, the three pure suites that build the real `getServerEnv()` from the local env file fail 45 tests with `CALLER_PSEUDONYM_PEPPER: Invalid input: expected string, received undefined`. Those suites are `audit-request-action`, `resend-domains` and `stall-claim-isolation`. The only cause is the missing local value, and the inline-dummy run proves it. CI has the dummy.
- `tests/monthly-report.test.ts` (a DB suite) refuses to start locally for the same missing key. It is not in the local list and `test:remote` was never run.
- No `db:migrate`, no `test:remote`, no push.

## Deviations from Plan

### Process deviation: the example file was NOT edited

- **Found during:** Task 1.
- **Issue:** The plan says to add `CALLER_PSEUDONYM_PEPPER=hex-32-bytes` to the example env file using the Edit tool only. This workspace has a permission deny rule covering `.env*`, so the Read tool was refused, and Edit needs a prior Read.
- **What I did:** I did not route around the rule, and no shell command named the file. This follows the 01-02 and 08-02 precedents. `docs/env-vars.md` carries the example line verbatim.
- **Consequence:** `git status --porcelain` is EMPTY after the final commit, not "1 line (the example file)" as the acceptance criteria expected. **The example file does not yet carry the key and awaits the founder's hand edit and commit** (see User Setup).

### Implementation note (not a behaviour change)

- **partnerCsv's trailing CRLF is conditional.** A probe showed that papaparse 5.7.0's `unparse` with empty `data` already returns `header\r\n`, and returns no trailing newline when there are data rows. The plan's "plus a trailing CRLF" would have produced a double CRLF on the empty file and failed its own `partnerCsv([])` behaviour, so the CRLF is appended only when it is missing.

### State-update note

- **REQUIREMENTS.md was not ticked.** `requirements.mark-complete` checked off all five frontmatter IDs (COMP-02, RPT-04, RPT-05, CON-05, CON-06). That file was reverted to match the 15-01 precedent, which left its requirements Pending. This plan only builds leaves: the queue page, the log, the report surfaces, the export and the retention pass land in 15-03 to 15-08, so the ticks belong at phase completion.

Otherwise the plan was executed as written.

## User Setup Required (founder, by hand; names only, no values anywhere)

1. **Local env file.** Generate a value in a subshell with `openssl rand -hex 32` and add `CALLER_PSEUDONYM_PEPPER=<that value>` to the local env file by hand. Until then, the three real-env pure suites fail locally as described above.
2. **Example file.** Add the line `CALLER_PSEUDONYM_PEPPER=hex-32-bytes` directly after the `AUDIT_IP_HASH_SALT=` line, then review and commit it yourself. The agent could not read or write it.
3. **Vercel (before plan 15-08 pushes main).** Run `node scripts/push-vercel-env.mjs --project backdesk --envs production,preview CALLER_PSEUDONYM_PEPPER`. The value is read from the local env, never from argv or a terminal. ORDER is the rule: the key must exist on Production AND Preview before the Phase 15 code deploys, or every route fails at `getServerEnv()`.

## Hazards for 15-03 and later

1. **15-03's export read needs the same structural pin.** `tests/partner-csv.test.ts` pins only `partner-csv.ts`. The research's select-list pin (`tenants.name`, `period_start`, `figures`, `version`, `tenant_id`) and the no-personal-token grep over `src/db/repository/reports.ts` are 15-03's to add.
2. **`MissedCallCounts.deliveredSeconds` is one entry per DELIVERED text-back,** computed as `delivered_at - started_at` in whole seconds. Clamp in the SQL too (`greatest(0, ...)`) as research Pitfall 7 says. The pure clamp is a second line of defence, not a replacement.
3. **The byHour, byIsoWeekday and afterHoursByIsoWeekday arrays must be dense, at 24/7/7,** with zeros filled. `GROUP BY` returns only non-empty buckets, and `computeMissedCallFigures` throws on a wrong length.
4. **The CSV `month` is `YYYY-MM` from `period_start`,** which is already a local date. Slice the string and never reformat it through a Date.
5. **Parse each export row's `figures` through `reportFiguresSchema`** so `missedCalls` arrives typed, or `undefined` for a pre-Phase-15 month. Never pass raw jsonb to `partnerCsvRows`.
6. **The first regenerate of any month after deploy is version N+1** (research Pitfall 6, D-03), now pinned in `report-frozen-fixture.test.ts`. Expect `tests/monthly-report.test.ts` DB cases that assert `unchanged` across a regenerate to still hold, because both generates carry the block.
7. **`LEAD_TOUCH_COUNT` is declared twice until 15-04:** `queue-card.tsx` keeps its private const and the new leaf exports the same 3. 15-04 must switch `queue-card.tsx` to the import and add `lead-card.tsx` to `CLIENT_REACHABLE`. 15-06 must add `export-csv-form.tsx`.
8. **`resolveTextBackOutcome` expects `TEXT_BACK_STUCK_MINUTES * 60_000` from the caller,** and the page must not import the constant into a client island.
9. **The `/reports` page import pin** (`tests/monthly-report.test.ts`: the page value-imports only `document`, `copy` and `format`) still holds. The new copy constants live in `copy.ts`, so 15-06 must not import `missed-call-figures.ts` into the printed sheet page.

## Known Stubs

None. The leaves are complete fixed copy. Their consumers (15-04 and 15-06) are interface-first, declared here and consumed later.

## Threat Flags

None beyond the plan's threat model. T-15-05 is covered by the HMAC with a 32-char floor and a source pin. T-15-08 is covered by the REQUIRED key plus documented order. T-15-11 is covered by the fixture and the unchanged pinned files. T-15-09 is covered by the header and source pin. T-15-10 is covered by the apostrophe pin. For T-15-01, the CI dummy is the only literal; this SUMMARY names no value and no shell command in it names an env file.

## TDD Gate Compliance

Each task wrote its suite first and ran it RED: the import failed for Tasks 1 and 3, and Task 2 had 4 failures plus 2 unresolved files. Each task then implemented to GREEN and committed once as `feat(...)`, per the plan's single-commit-per-task instruction. There are no separate `test(...)` commits, which matches the 15-01 precedent for `tdd="true"` tasks in an execute-type plan.

## Self-Check: PASSED

All twelve created files exist. Commits 64ff201, f8838f9 and de94b43 are in the log. The only digit run in this SUMMARY is the CI dummy's zero padding, and it contains no caller number, hash or secret value.
