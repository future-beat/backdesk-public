---
phase: 02-servicem8-sync-quote-leakage-audit
plan: 06
subsystem: quote-leakage-audit
status: complete
tags: [audit, prospects, rls, retention, aggregation, baseline, servicem8, console]

requires:
  - "02-01: Sm8Client, fetchAllPages, zod boundary schemas, normalize/parseMoneyToCents, crypto, fixtures"
  - "02-02: is_operator() + operator_allowlist, migration/grant/CHECK conventions"
  - "02-03: cron-job-in-migration style (0012)"
  - "02-04: connect.ts after resumeConnection; console CSS vocabulary"
provides:
  - "prospects + prospect_quote_lines — the D-01/D-03 audit model, operator-only, self-purging"
  - "tenants.prospect_id — the D-02 conversion link (tenant → prospect, no cascade)"
  - "AUDIT_RECOVERY_RATE / GRACE_PERIOD_DAYS / WINDOW_DAYS — the single origin of all three numbers"
  - "isFollowedUp / graceDeadline — D-10 detection, DST-proof"
  - "computeAuditFigures / computeBaseline / auditWindow / isInWindow — the one aggregation core"
  - "fetch90DayQuoteHistory — 4 bulk requests, in-memory join, shared by audit and baseline"
  - "generateAuditFromApiKey — verify → fetch → create → store"
  - "prospect repository: createProspect / storeAuditResults / getProspect / listProspects / countProspectLines"
  - "console routes /audits, /audits/new, /audits/[id]"
  - "cron job prospect-line-purge; migrations 0013 + 0014"
  - "sm8_connections.baseline_* now populated at connect (D-14)"
affects:
  - "02-07 (CSV path reuses AuditLine, storeAuditResults, csv_staging, csv_note_degraded; print styling and the convert control build on audits/[id])"
  - "Phase 7 (reads baseline_win_rate through tenants.prospect_id and off sm8_connections; null means no-data, never 0)"

tech-stack:
  added: []
  patterns:
    - "Integer cents end to end; the rate applied in basis points, floored, never a float multiply"
    - "null and 0 kept distinct where the difference changes what gets invoiced"
    - "One insert site per retention-governed table, so the stamp cannot be forgotten"
    - "Bulk fetch + in-memory join instead of per-entity N+1"
    - "Orchestration lives outside 'use server' — every export there is a public endpoint"
    - "Source assertions read comment-stripped code, so reasoning is not deleted to keep tests green"

key-files:
  created:
    - src/db/schema/prospects.ts
    - src/db/migrations/0013_prospects.sql
    - src/db/migrations/0014_prospect_grants_and_purge.sql
    - src/core/audit/constants.ts
    - src/core/audit/followup.ts
    - src/core/audit/aggregate.ts
    - src/core/audit/fetch-history.ts
    - src/core/audit/generate.ts
    - src/db/repository/prospects.ts
    - src/app/(console)/audits/page.tsx
    - src/app/(console)/audits/new/page.tsx
    - src/app/(console)/audits/new/form.tsx
    - src/app/(console)/audits/new/actions.ts
    - src/app/(console)/audits/[id]/page.tsx
    - scripts/backfill-baselines.mjs
    - scripts/verify-audit.mjs
    - tests/audit-aggregate.test.ts
    - tests/baseline-winrate.test.ts
    - tests/prospect-purge.test.ts
    - tests/prospect-audit.test.ts
  modified:
    - src/db/schema/tenants.ts
    - src/db/schema/index.ts
    - src/core/servicem8/schemas.ts
    - src/core/sync/connect.ts
    - src/db/repository/index.ts
    - src/app/(console)/layout.tsx
    - tests/rls-coverage.test.ts
    - tests/helpers/seed.ts
    - tests/lint-ban.test.ts
    - tests/quote-triage.test.ts
    - package.json

decisions:
  - "A quote still inside its 72h grace is PENDING, not neglected — found live, where every 2-day-old quote was being counted as leaked"
  - "Orchestration lives in src/core/audit/generate.ts, not in the 'use server' action: every export from a server-action module is a globally-POSTable endpoint"
  - "fetch90DayQuoteHistory takes the SOURCE zone (UTC, measured), never the prospect's display timezone — the plan's wording would have been an 8-hour error"
  - "The window boundary is applied locally, not delegated to ServiceM8's measured-inclusive gt"
  - "Migrations numbered 0013/0014; the plan's 0011/0012 were taken by 02-02"
  - "computeBaseline returns a numeric STRING; PostgREST returns numeric as a JS NUMBER on the way back"
  - "Notes joined on related_object AND related_object_uuid — a note about the customer's account is not a follow-up on a quote"

metrics:
  duration: ~41 minutes
  completed: 2026-08-26
  tasks: 3
  commits: 5
  tests_added: 70
  tests_total: 444

actuals:
  tokens: 66941
  tasks: 3
  commits: 5
---

# Phase 02 Plan 06: Quote Leakage Audit — Data Pipeline Summary

An operator can now paste a prospect's read-only ServiceM8 key and land on a page showing what that business is leaking — computed by one tested cents-exact aggregation that also snapshots every new client's pre-service baseline, so the sales promise and the monthly report cannot disagree.

## What was built

**Task 1 — the data model (`28e1c09`).** `prospects` and `prospect_quote_lines`, deliberately not tenants. Both gated by `is_operator()`, both read-only to `authenticated`, every line stamped with `purge_after` and swept by a daily `prospect-line-purge` cron job. `tenants.prospect_id` is the one link between the families and it points from the tenant to the prospect, never the reverse.

**Task 2 — the aggregation core (RED `63282c9`, GREEN `7ce2f9f`).** `constants.ts`, `followup.ts`, `aggregate.ts`, `fetch-history.ts`, and the D-14 wiring into `connect.ts`. No database, no network, no clock except the one passed in. 40 tests.

**Task 3 — the vertical (`9dfc933`).** `generateAuditFromApiKey`, the prospect repository, three console routes, and `scripts/verify-audit.mjs` — seven live assertions against the trial account acting as its own prospect.

## The bug the live run found

This is the finding worth the plan.

Every unit test passed. The typecheck passed. The first live run against the trial account then reported **$17,918.75 of "never followed up" value out of $17,918.75 quoted** — all six quotes, the prospect's entire book, flagged as neglected.

The arithmetic was correct. The finding was nonsense.

The trial account was seeded 48 hours earlier, so no quote in it was more than two days old — and **nothing can be past a 72-hour deadline that has not arrived yet.** D-10 defines the leak as "no signal *after* quote_date + 3 days", which presupposes those days have passed; the implementation read the absence of a signal as evidence of neglect without first asking whether there had been time for one.

A quote issued yesterday is not neglected. It is **pending**, and the honest answer about it is "not yet known".

The cost of shipping it would have been specific rather than diffuse. The quotes a prospect can check against their own memory are *this week's*. Handing a tradie a document that says they neglected the job they quoted yesterday does not cost one line item — it discredits every other number on the page, in the meeting the page exists for. The figure was wrong in the one direction D-09 spends an entire named constant guarding against, and it was wrong by the largest possible margin on exactly the accounts where the product most needs to be believed: new ones, with recent data.

`computeAuditFigures` now takes `now` explicitly and a pending quote contributes to `quotesIssued` and `totalValueCents` (it *was* issued, and it *is* quoted value) but nothing to the leak or the estimate derived from it. Four tests pin it, including both sides of the boundary on the same quote. The live run now reports `$0 never followed up` for that account, which is the true answer.

**No unit test would have caught this**, and that is the part worth keeping. Every fixture in `tests/audit-aggregate.test.ts` used quote dates comfortably in the past, because that is what a fixture author writes when thinking about aggregation. The bug lived in the gap between "the arithmetic is right" and "the finding is true", and only real data with a real age crossed it.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] Quotes inside the grace window counted as leaks**

Described in full above. `computeAuditFigures(lines, now)`; a line contributes to `neverFollowedUpValueCents` only once `graceDeadline(quoteDate) <= now`.

- **Files:** `src/core/audit/aggregate.ts`, `src/core/audit/generate.ts`, `tests/audit-aggregate.test.ts`
- **Commit:** `9dfc933`

**2. [Rule 3 — Blocking] `tsc --noEmit` was already failing before this plan started**

`tests/quote-triage.test.ts` (02-05, commit `e2aa427`) used a regex with the `/s` dotAll flag. The project targets ES2017; dotAll needs ES2018, so `tsc` reported TS1501 while vitest ran the file green. That command is the verification gate for two of this plan's three tasks and could never have passed.

Fixed as `[\s\S]*` rather than by raising the project target — identical semantics, and changing emit for the whole project to satisfy one regex in one test is the larger change, not the smaller one.

- **Files:** `tests/quote-triage.test.ts`
- **Commit:** `5307458` (separate, because it belongs to neither task)

**3. [Rule 3 — Blocking] Migration numbers 0011/0012 were already taken**

The plan specifies `0011_prospects.sql` and `0012_prospect_grants_and_purge.sql`. 02-02 shipped `0011_sync_table_grants` and 02-03 shipped `0012_cron_details_cleanup`. Shipped as **0013/0014**.

**And the journal trap fired for the third consecutive plan.** `drizzle-kit` stamped the generated entry `when: 1787744773931`, behind `0012`'s hand-stamped `1787810500000`; the migrator skips entries older than the last applied, so `migrate` would have exited 0 with no tables created and the first symptom would have been a 404 in the console. Caught before the first run, as in 02-02. The generated file was also renamed from `0013_fast_pixie` — a tag that names nothing, in a directory people read to find out where a table came from.

This will recur on every future migration for as long as the hand-stamped values from `0004` onward lead the generator's clock. It is noted in `src/db/migrations/README.md`; the durable fix is a `db:generate` wrapper that re-stamps, and it is not this plan's.

**4. [Rule 2 — Missing critical] CHECK constraints and the ciphertext envelope**

Not in the plan's task action, and required by the house convention 0004/0008/0011 all follow: `prospects_source_known`, `prospect_quote_lines_status_known`, `prospect_quote_lines_source_known`, and `prospects_ciphertext_versioned` (mirroring `sm8_connections_ciphertext_versioned`, nullable-tolerant because a CSV prospect has no key).

`authenticated` holds no write grant here, so these defend against us rather than against a forged request. A typo'd `status` written by the service-role audit path is a quote the baseline counts as neither won nor lost — quietly deflating a number handed to a prospect in a sales meeting, with nothing going red.

**5. [Rule 2 — Missing critical] The audits list was unreachable**

Three routes were built and nothing linked to them. Added `Audits` to the console nav — the list, not `audits/new`, because the list is the pipeline view the operator returns to and the New-audit button lives on it.

### Intentional design deviations

**6. Orchestration lives in `src/core/audit/generate.ts`, not in `actions.ts`**

The plan puts the verify→create→fetch→store function in the server action file. A `'use server'` module may export only async functions and **every function it exports becomes a Server Action with a globally-POSTable id**. Putting the orchestration there would have published an unauthenticated endpoint that accepts an API key and writes prospect rows — the exact hole `createAuditAction`'s auth-first check exists to close, opened by the act of factoring code out for testability.

It also happens to be what the plan's own test requirement needs: `tests/prospect-audit.test.ts` calls "the action's core path, not the Next formData wrapper", which is only possible if that path is not itself an action.

**7. `fetch90DayQuoteHistory` takes the SOURCE zone, not the prospect's timezone**

The plan says "run `fetch90DayQuoteHistory` with the prospect timezone". Following that literally would have been a bug of exactly the kind `normalize.ts` was written to prevent: the tenant's IANA zone governs contact hours and display, while the zone a ServiceM8 naive string is READ in was measured as UTC (A3). Passing `Australia/Perth` there puts every quote date eight hours out, which at the window edge silently moves quotes in and out of the audit.

The parameter is `sourceZone`, defaulted to `SM8_TIMESTAMP_ZONE`. The prospect's timezone is still stored and still governs display.

**8. The 90-day boundary is decided by us, not by ServiceM8**

The `$filter` asks for a day MORE than the window and `isInWindow` applies the exact edge locally. ServiceM8's `gt` was measured to behave *inclusively* (A1) and only reliably accepts date-granularity literals, so leaning on it would put the audit's most checkable claim — "the last 90 days" — inside somebody else's undocumented operator. A day of slack costs a handful of rows we discard.

**9. `computeAuditFigures` returns four figures, not five**

A count of pending (in-grace) quotes would be useful honesty on the report and was deliberately not added: the plan pins four figures and four columns, and presentation is 02-07's. Recorded here as a suggestion rather than shipped as scope.

**10. Notes are joined on `related_object` AND `related_object_uuid`**

The research says "join to jobs via `related_object_uuid`". Notes attached to a Company carry a uuid in the same column, so joining on the uuid alone credits a job with a follow-up that was actually a note about the customer's account. Matched case-insensitively — the live fixture returns `"job"`, lowercase, where the docs say `Job`.

**11. `graceDeadline` is exported and the addition happens on a UTC `TZDate`**

`addDays` on a plain Date adds *calendar* days in the runner's local zone, which is 71 or 73 hours across a DST transition. The same quote and the same follow-up would then be classified differently depending on where the audit ran, twice a year — the figures would move with nobody editing anything. UTC has no DST, so the boundary is exactly 72 hours, everywhere, which is also the only version of the rule the report can honestly describe. Pinned by a test using the Australian changeover weekend.

**12. `scripts/verify-audit.mjs` was added; it is not in the plan's file list**

The plan asks for a live smoke "recorded in SUMMARY as evidence". A committed script beats a transcript: it is re-runnable after any future change to the fetch path, and it is what found deviation 1. Seven named assertions, cleanup in a `finally` block.

**13. `tests/baseline-winrate.test.ts` gained a live section**

Every other assertion in that file is about arithmetic and source text, and none of them would notice a `computeBaseline` call whose result is computed correctly and then dropped. That failure is silent at connect time and surfaces months later as a report with no "before" column. Three integration cases now prove the five columns land and agree with a recomputation from the mirrored rows.

## Measured surprise: `numeric` comes back as a JS number

`src/app/(console)/clients/[id]/page.tsx` states that "`numeric` arrives from PostgREST as a STRING". Measured while writing the D-14 persistence test: **it arrives as a JSON number.** `baseline_win_rate` read back as `0.5` where `computeBaseline` had written the string `'0.5000'`.

Both are the same value and nothing was broken — `formatMoney` already did `Number(value)`, which works either way — but the comment is wrong and the direction matters for anyone writing a new read.

`computeBaseline` and the repository still produce **strings** on the way IN, deliberately: handing drizzle a JS number for a `numeric` column reintroduces the float round-trip the whole cents discipline exists to prevent. The conversion belongs at the read edge. Recorded in `tests/baseline-winrate.test.ts` next to the assertion that found it.

## Verification

| Check | Result |
|---|---|
| `node scripts/migrate.mjs` | applied — 15 journal entries |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rls-coverage.test.ts tests/prospect-purge.test.ts` | 20 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/audit-aggregate.test.ts tests/baseline-winrate.test.ts` | 40 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/prospect-audit.test.ts` | 21 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` (full suite) | **444 passed** (70 new) |
| `npx tsc --noEmit` | clean (after deviation 2) |
| `npm run lint` | clean |
| `npm run build` | compiled, 10 routes — `/audits`, `/audits/[id]`, `/audits/new` present |
| `node scripts/verify-audit.mjs` | **7/7 live** against the trial account |
| `node scripts/backfill-baselines.mjs --dry-run` | "No ServiceM8 connections exist yet" |

### Live evidence (the plan's required smoke)

The trial account as its own prospect, after deviation 1 was fixed:

```
PASS  figures-persisted   — 6 quotes, $17918.75 total, $0 never followed up
PASS  window-90-days      — 2026-05-28 → 2026-08-26
PASS  recoverable-derived — $0 @ 0.15
PASS  baseline-null-safe  — 50% of 6
PASS  ciphertext-only     — enc:v1 envelope, last4 61ec
PASS  lines-stamped       — 6 lines, all purging in ~30 days
PASS  no-tenant-leak      — no tenant, no quote row
```

`$0 never followed up` on a $17,918 book is the correct reading, not a broken one: every quote in that account is younger than its 72-hour grace. The 50% baseline is 3 of 6 (2 Work Order + 1 Completed).

### Acceptance criteria

| Criterion | Evidence |
|---|---|
| Migration applies; both tables enrolled in rls-coverage, neither policyless nor literal-true | `rls-coverage.test.ts`, grants + policy + is_operator assertions extended |
| Purge: expired deleted, future spared, NULL spared | `prospect-purge.test.ts`, three-way, executing the command **read from `cron.job`** |
| `cron.job` contains `prospect-line-purge` | catalog assertion, `15 3 * * *`, active |
| `tenants.prospect_id` is a nullable FK | catalog assertion incl. `confdeltype = 'a'` (no cascade) |
| Both grace-boundary directions, day-90/91 pair, null-not-zero empty baseline | `audit-aggregate.test.ts`, `baseline-winrate.test.ts` |
| `constants.ts` exports exactly three constants; aggregate imports the rate | source assertion + a check that `0.15` appears nowhere else in the aggregation |
| ≤4 resource fetches, no N+1 | source assertion: exactly 4 `fetchAllPages(`, no `client.get(`, each resource named once |
| Baseline written in the backfill transaction | source assertion on the transaction block + live persistence test |
| Rejected key creates NO prospect row | `prospect-audit.test.ts` — counted before and after, against the live API |
| Every line insert sets `purge_after` | one insert site asserted in source; live check that all rows land ~30 days out |
| Baseline is an understated secondary stat | source assertion: the `<dl>` contains no "Baseline" |
| Key stored ciphertext-only with last4 | `enc:v1` assertion + `SELECT *` sweep for the plaintext across every column |

## Threat mitigations applied

| Threat | Applied |
|---|---|
| T-2-07 | `purge_after` stamped at the ONE insert site, computed by Postgres' clock rather than the container's; daily cron delete; three-way purge test executing the scheduled command verbatim; aggregates survive on `prospects` |
| T-2-08 | `is_operator()` policies on both tables, enrolled in rls-coverage; grants withhold INSERT/UPDATE/DELETE from `authenticated`; behavioural proof that an **authenticated non-allowlisted user** — the shape a v2 client login takes — reads empty and cannot insert |
| T-2-01 | Identical `enc:v1` AES-256-GCM path as client keys, plus a nullable-tolerant CHECK that a non-null value looks encrypted |
| T-2-02 | The key is never echoed into action state, never selected into a page prop, never in a failure result (asserted over the whole serialised object, including `api.servicem8.com` and `X-API-Key`); a `SELECT *` sweep proves it is in no column |
| T-2-17 | One tested cents-exact aggregation; the estimate derives from the named constant only; parse failures abort the whole fetch rather than silently converting a followed-up quote into a leak |

## Known Stubs

**One, named in the plan: the CSV radio renders but does not submit.** Choosing "CSV upload" returns *"CSV upload is not available yet. Use a read-only API key for now."* rather than failing silently or generating from a key that was never supplied. The radio ships now on purpose — the form must not change shape under the operator once they have learned it — and plan 02-07 wires the branch. `csv_staging` and `csv_note_degraded` exist on the schema and are read by the report, unpopulated until then.

Not stubs, and owned by 02-07: the A4 print styling, the methodology footnote, and the convert-to-client control. `audits/[id]` renders the figures structurally; the page is deliberately not the finished sales artifact.

## UAT — needs a human

**Nobody has looked at any of these three pages.** They build and their source is asserted, which is not the same thing. This inherits 02-01's and 02-04's outstanding console UAT and adds to it.

Worth 10 minutes:

1. `npm run dev`, sign in, click **Audits** in the nav → confirm the empty state reads *"No audits yet. Create a prospect to generate their Quote Leakage Audit."* with the **New audit** button beside the h1.
2. **New audit** → confirm the radios render with *Read-only API key* first, and that choosing *CSV upload* hides the key field.
3. Generate with `SM8_TEST_API_KEY` → confirm the button reads *Fetching 90 days…* while it runs, and that it lands on the report.
4. Confirm the four figures render as **whole dollars** and the baseline is one line of prose below them, not a headline.
5. Paste a garbage key → confirm the failure appears **under the key field**, reads *"Couldn't fetch this prospect's data: ServiceM8 rejected the key. Check the read-only key or fall back to a CSV export."*, and that the business name survives.
6. Delete the test prospect afterwards, or it sits in the real pipeline list.

Also unverified: **the recovery rate itself.** `AUDIT_RECOVERY_RATE = 0.15` is the planner's flagged assumption — the conservative end of the D-09 15–20% band, with no more specific figure anywhere in the GTM research. It is a one-line change and the report renders the constant, so the figure and the footnote cannot drift apart. The operator should confirm the number before the first audit goes to a real prospect.

## Notes for the next plans

- **02-07 (CSV + print):** `AuditLine` is source-agnostic — build CSV rows into that shape and `computeAuditFigures`/`computeBaseline` work unchanged. `storeAuditResults` is the only sanctioned line-insert path and stamps `purge_after`; do not add a second. It also **replaces** a prospect's lines rather than appending, so regenerating is safe. Set `csvNoteDegraded: true` on the CSV path — `audits/[id]` already renders the addendum footnote from it. `csv_staging` must be cleared on confirm (`storeAuditResults` nulls it). The convert control sets `tenants.prospect_id` and clears `purge_after` on that prospect's lines.
- **Phase 7 (attribution):** two baselines exist and they mean the same thing. A client onboarded from an audit has theirs on the prospect, reachable via `tenants.prospect_id`; every client has one on `sm8_connections`. **`null` means no data and must never be read as 0** — that distinction is the difference between an honest invoice and one the client can disprove from their own books.
- **Retention:** `prospect-line-purge` runs daily at 03:15 UTC. After 30 days a prospect's report still renders in full from the stored aggregates; only the line detail is gone. If 02-07's report ever needs to list individual quotes, that changes and the retention argument has to be revisited rather than worked around.
- **Migrations:** next is `0015`. Re-stamp the journal `when` and rename the generated tag before running `migrate` — three plans in a row have now hit this.

## Self-Check: PASSED

All 20 created and 11 modified files verified present on disk. All five commits (`5307458`, `28e1c09`, `63282c9`, `7ce2f9f`, `9dfc933`) verified in `git log`. No commit deleted a tracked file.
