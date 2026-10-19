---
phase: 15-lead-console-reporting-privacy
plan: 05
subsystem: console (client page missed-calls section, keyset cursor leaf)
status: complete
tags: [missed-call-log, keyset-pagination, operator-gate, d-02, con-06, t-6-21]
requires:
  - 15-02 (components/text-back-outcome.ts — resolveTextBackOutcome, CALLER_KIND_LABELS, NUMBER_RETIRED_LABEL, AFTER_HOURS_LABEL)
  - 15-03 (forTenant().missedCalls.listForLog / countInWindow; MissedCallLogRow)
  - 15-04 (components/lead-job-sheet.ts — LEAD_RESOLUTION_LABELS; GUARDED_PATHS leads entries)
provides:
  - "src/app/(console)/clients/[id]/missed-calls-cursor.ts: CALLS_BEFORE_PARAM, parseCallsBefore, formatCallsBefore"
  - "src/app/(console)/clients/[id]/missed-calls-list.tsx: MissedCallsSection — the operator-gated missed-call log on the client page"
  - "The client page reads searchParams.calls_before and mounts the section between Quotes and Recent sync runs"
affects:
  - 15-07 (privacy pass: a stamped row renders NUMBER_RETIRED_LABEL here; the check precedes the number in the source)
  - 15-08 (deploy; phone human-check for the section)
tech-stack:
  added: []
  patterns:
    - "One gated server component on an RLS-only page: requireOperator() first, then one try with a discarded catch and a fixed log string; the page stays ungated and number-free"
    - "Keyset cursor as a zod-parsed leaf: {ISO}_{uuid}, strict toISOString round trip, malformed -> page one"
key-files:
  created:
    - src/app/(console)/clients/[id]/missed-calls-cursor.ts
    - src/app/(console)/clients/[id]/missed-calls-list.tsx
    - tests/missed-call-cursor.test.ts
    - tests/missed-calls-section.test.ts
  modified:
    - src/app/(console)/clients/[id]/page.tsx
    - tests/operator-authorization.test.ts
decisions:
  - "GUARDED_PATHS gains missed-calls-list.tsx, NOT clients/[id]/page.tsx: the page does not call requireOperator() and must not (it stays RLS-only), so listing it would fail the guard suite. The plan names the component; the 15-04 hazard line naming the page was a slip"
  - "The section's error arm still renders the state line, minus the two facts it could not read (template attestation and the 30-day count) — omitted, not guessed"
  - "A paged request that comes back empty (the previous page was exactly 20 and the last) says 'No older calls.' rather than the first-run empty state"
  - "Pagination links use the full /clients/{id}?calls_before=…#missed-calls path with the cursor URI-encoded, not a bare '?…' relative href"
  - "The cursor's strict check is the toISOString round trip, so only the exact form formatCallsBefore writes is accepted; the id is lower-cased"
metrics:
  duration: 9min
  completed: 2026-10-13
  tasks: 2
  files: 6
actuals:
  tokens: 6400
  tasks: 2
  commits: 2
---

# Phase 15 Plan 05: The Client Page's Missed-Call Log Summary

The client page now has a Missed calls section between Quotes and Recent sync runs. It runs `requireOperator()` before any read, then does three reads inside its own `try`: the attested templates, the 30-day count, and a 20-row keyset page of `listForLog`. Every chip and caller word comes from the 15-02 maps, and the two divert-aware empty states are what a client with no calls shows. The page itself still reads no caller number.

## What was built

**The section's exact props** (`MissedCallsSection`, async server component):

| Prop | Type | The page passes |
|------|------|-----------------|
| `tenantId` | `string` | `tenant.id` |
| `timezone` | `string` | `tenant.timezone` |
| `divertNumber` | `string \| null` | `checklist?.divert.numberE164 ?? null` |
| `textBackLive` | `LiveState` | `checklist?.live.textBack ?? 'not_armed'` |
| `callsBefore` | `string \| string[] \| undefined` | `(await searchParams)[CALLS_BEFORE_PARAM]`, raw |
| `now` | `Date` | the page's one `now` (the checklist's) |

**`searchParams` handling:** the page's signature gains `searchParams: Promise<Record<string, string | string[] | undefined>>` (Next 16). It awaits the Promise and hands the raw value to the section. The section parses it with `parseCallsBefore`, which turns an array, an empty string, a bad date, a bad uuid, `../` or an SQL fragment into `null`, meaning page one.

**Order inside the section:**
1. Gate: `requireOperator()`. If it does not return `ok`, the section renders the h2 and `OPERATOR_DENIED_MESSAGE[access]` with `role="alert"`, and no read runs.
2. One `try` around `Promise.all`:
   - `latestAttested` for each of the `TEXT_BACK_VARIANTS`; the newest `attestedAt` wins
   - `countInWindow(now − 30 d)`
   - `listForLog({ before: cursor ?? undefined, limit: 20 })`
3. The bare `catch` logs only `[client] missed calls read failed`. It renders the h2, the state line built from props, and `Could not load the missed calls. Try again in a moment.`

**What the section renders (UI-SPEC §2):**
- **State line:** `Divert number {E.164}` or the `#divert-number` provision link · `text-back armed / not armed` · `templates attested {d MMM yyyy}` (links to `/text-back`) or `templates not attested` · `{n} call(s) in the last 30 days`.
- **When paged:** `Calls before {…}` and a `← Newest calls` link.
- **Each row:**
  - the time
  - an `after hours` chip
  - the outcome chip with its tone class, from `resolveTextBackOutcome(…, now, TEXT_BACK_STUCK_MINUTES * 60_000)`
  - the caller, checked in this order: the retired label first, then the spaced mobile, otherwise the kind word (a landline shows no digits)
  - the link line: `Open lead →` / `Lead {closed|booked|expired}` with the `LEAD_RESOLUTION_LABELS` word / `Attached to the quote →`
- **Paging:** `Show older calls →` appears only when the page is full.

`tests/console-error-leak.test.ts` was **not edited** and is byte-identical, as are `checklist-card.tsx` and `checklist.ts`. The leak suite's walk scans both new files and passes.

## Verification (local, pure only)

| Check | Result |
|-------|--------|
| Task 1: `missed-call-cursor`, `missed-calls-section`, `text-back-outcome-labels`, `console-error-leak`, `lint-ban` | 5 files, 350 tests passed |
| Task 2: `missed-calls-section`, `missed-call-cursor`, `operator-authorization`, `console-error-leak`, `lint-ban`, `layout-contract` | 6 files, 392 tests passed |
| `npm run typecheck`, `npm run lint` | clean |
| `npx next build` | exit 0 |
| Grep gates (both tasks) | all hold |
| Byte identity vs phase base `e7ee32b` (`checklist-card.tsx`, `checklist.ts`, `console-error-leak`, `queue/page.tsx`, `queue/actions.ts`) | identical |

RED was observed first: both new suites failed because the files did not exist yet.

These were deliberately not run: DB suites, `test:remote` and `db:migrate`. No env file was named and nothing was pushed. `tests/missed-call-log.test.ts` (the read's DB proof) ran at the 15-04 tracer gate and runs again at 15-08's gate.

## Deviations from Plan

**1. [Rule 1 - Instruction conflict] `GUARDED_PATHS` entry is the component, not the page**
- **Conflict:** the executor brief (from the 15-04 hazard list) said to add `clients/[id]/page.tsx` to `GUARDED_PATHS`. The plan's Task 2 and its grep gate name `missed-calls-list.tsx`.
- **Why the component:** every `GUARDED_PATHS` entry must call `requireOperator()` and import it from `_auth`. The page does neither, by design (T-6-21; RLS-only), so listing it would turn the suite red.
- **Done:** I followed the plan. The component is listed, with a comment dated 2026-10-13.
- **Commit:** c43f0b9

**2. Small additions within the plan's semantics, recorded:**
- **Error arm:** the state line still renders, without the two facts the failed read would have supplied.
- **Empty older page:** a paged-but-empty result says `No older calls.`
- **Link paths:** pagination links use the full path with the cursor URI-encoded.
- **Defensive mobile:** `toLocalSpacedMobile` sits in a bare `try` and renders `—` on a value that is not a mobile. This is a guard against a schema violation (the 15-04 `callerLabelOf` precedent); there is no such path today.
- **Extra pins:** the section suite also pins that the retired check comes before the number in the source, that the only log line is the fixed one, that there is no `catch (`, and that the page names no `callerE164` / `caller_e164` and does not call the gate itself.

## Hazards for 15-06 / 15-07 / 15-08

- **15-07:** a stamped row reads `pseudonymisedAt !== null` and shows `Mobile · number retired`. The pass must set `pseudonymised_at` on every row it hashes, or a hashed `caller_e164` on a `mobile` row would reach `toLocalSpacedMobile`. That function throws on it, and the guard turns the throw into `—`, so a hash would never render, but the row would lose its label.
- **15-08:** these show on the phone UAT and should be read as known, not as bugs:
  - If the checklist read fails, the section falls back to `No divert number — provision one above` and `text-back not armed`. The checklist's own error sentence is on the same page.
  - The forbidden arm reuses `OPERATOR_DENIED_MESSAGE.forbidden` (“You do not have access to audits.”), as `/leads` does.
- **Keyset precision (not this plan's file):** the cursor carries milliseconds, while `started_at` is `timestamptz` (microseconds). Two calls for one tenant within the same millisecond could skip the older one across a page boundary. This is negligible in practice; recorded so nobody is surprised.
- **CI:** the 15-04 Task 2 expansion and this plan's two commits have not been through CI. 15-08's gate is their first run.

## Known Stubs

None. Every row field comes from `listForLog`, and the state line from the checklist and the section's own reads. With zero production calls, the UAT phone shows the empty state first, by design.

## Threat Flags

None beyond the plan's threat model:
- **T-15-03:** the gate comes before the read (source pin plus `GUARDED_PATHS`).
- **T-15-01:** numbers appear only in the gated component's JSX; a stamped row shows the label; the page selects no number (pinned).
- **T-15-14:** fixed sentence, discarded catch, and the leak walk covers the file.
- **T-15-12:** the cursor goes through zod plus a strict round trip, and a malformed one means page one.

## TDD Gate Compliance

Task 1 was `tdd="true"` in a `type: execute` plan. Both suites were written and run RED (missing modules) before the implementation, and the task was committed as one `feat` commit per the plan's verify/commit instruction. There is no separate `test(...)` commit; the RED run is recorded here.

## Self-Check: PASSED

- Files exist: `missed-calls-cursor.ts`, `missed-calls-list.tsx`, `tests/missed-call-cursor.test.ts`, `tests/missed-calls-section.test.ts`.
- Commits exist: 8757847, c43f0b9.
