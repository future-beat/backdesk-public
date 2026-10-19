---
phase: 02-servicem8-sync-quote-leakage-audit
plan: 07
subsystem: quote-leakage-audit
status: complete
tags: [audit, csv, papaparse, print, a4, conversion, retention, console, d-12, d-11, d-02]

requires:
  - "02-06: AuditLine, computeAuditFigures/computeBaseline, storeAuditResults, csv_staging + csv_note_degraded columns, audits routes, AUDIT_RECOVERY_RATE"
  - "02-01: parseMoneyToCents, sm8ToUtc, SM8_TIMESTAMP_ZONE, sm8 fixtures"
  - "02-02: is_operator() allowlist; prospect-line-purge cron job (0014)"
provides:
  - "inferMapping / validateRows / CANONICAL_FIELDS / mappingKey — the D-12 CSV heuristics, calibrated against a real export"
  - "confirmCsvMapping — the CSV audit publish path, outside 'use server'"
  - "createCsvProspectAction path (createAuditAction csv branch) + confirmMappingAction"
  - "convertProspectToTenant — the ONE prospect↔tenant crossing (D-02)"
  - "console route /audits/[id]/mapping"
  - "audit.css — @page A4 print sheet, forced light palette"
  - "getProspectStaging — narrow two-column read of the staged upload"
affects:
  - "Phase 7 (reads baseline_win_rate through tenants.prospect_id; conversion is what keeps prospect lines alive to be read)"
  - "Any future report change (the methodology footnote and the estimate are one constant apart)"

tech-stack:
  added:
    - "papaparse 5.7.0 (exact pin) + @types/papaparse 5.5.2"
  patterns:
    - "Exact normalized-equality header matching over curated synonyms — never substring containment"
    - "Unmapped is a RESULT, not a failure: the operator picks the column"
    - "The browser submits an inference to confirm, never the data it was inferred from"
    - "Caps bind the work, not just the result (papaparse preview stops the parser)"
    - "An acknowledgement is keyed to the thing it acknowledged"
    - "One crossing between two walled-off schemas lives in one greppable file"
    - "Print re-declares the design tokens rather than overriding each rule"

key-files:
  created:
    - src/core/audit/csv-mapping.ts
    - src/core/audit/csv-intake.ts
    - src/db/repository/conversion.ts
    - src/app/(console)/audits/[id]/mapping/page.tsx
    - src/app/(console)/audits/[id]/mapping/mapping-form.tsx
    - src/app/(console)/audits/[id]/mapping/actions.ts
    - src/app/(console)/audits/[id]/actions.ts
    - src/app/(console)/audits/[id]/convert-form.tsx
    - src/app/(console)/audits/[id]/audit.css
    - tests/csv-mapping.test.ts
    - tests/convert-prospect.test.ts
    - tests/fixtures/sm8/job-list-export.csv
  modified:
    - src/app/(console)/audits/[id]/page.tsx
    - src/app/(console)/audits/new/actions.ts
    - src/app/(console)/audits/new/form.tsx
    - src/db/repository/prospects.ts
    - src/db/repository/index.ts
    - tests/prospect-audit.test.ts
    - tests/lint-ban.test.ts
    - package.json

decisions:
  - "Header matching is exact normalized equality, never substring — the real export has eight date-shaped columns and a contains rule would bind quote_date to the first one"
  - "followedUp for CSV is status !== 'Quote' — the only follow-up signal an export can carry, and exactly what the addendum footnote claims"
  - "The 90-day window is enforced on our side for CSV too; out-of-window rows are counted and named, not silently dropped"
  - "The proceed-with-warning acknowledgement is keyed to the mapping it was computed under"
  - "convertProspectToTenant lives in its own file so prospects.ts keeps its no-tenant prohibition literally true"
  - "A tenant already linked is rejected, not repointed — repointing strands the first prospect's lines in a kept-forever state"
  - "The baseline label was kept on the report (UI-SPEC figure-labels row) rather than rendering a bare percentage"

metrics:
  duration: ~35 minutes
  completed: 2026-08-27
  tasks: 3
  commits: 4
  tests_added: 46
  tests_total: 490

actuals:
  tokens: 36712
  tasks: 3
  commits: 4
---

# Phase 02 Plan 07: CSV Fallback + The A4 Audit Report Summary

A prospect who will not hand over an API key can now be audited from a CSV export through an operator-confirmed column mapping, and the result is one A4 page — four figures, a hero recoverable estimate, and a methodology footnote that renders the same constant the estimate was computed from — that a converted client's baseline survives intact.

## What was built

**Task 1 — the package gate (`14e1829`).** `papaparse` re-checked at execution: `SUS` for `too-new` alone, against 15.36M weekly downloads, the canonical `mholt/PapaParse` repository, no `postinstall`, not deprecated. The operator approved; installed at an exact `5.7.0` pin with `@types/papaparse` alongside, and the installed package confirmed to carry no install-lifecycle script.

**Task 2 — the CSV path (RED `70c31bd`, GREEN `b50a94a`).** `csv-mapping.ts` (heuristics, status vocabulary, row validation), `csv-intake.ts` (the publish orchestration, deliberately outside `'use server'`), the wired upload branch, and the mapping screen. 31 tests, every one of them against the real export.

**Task 3 — the artifact (`8ce904a`).** The report per UI-SPEC Screen 5, `audit.css`, `conversion.ts`, and the convert control. 15 tests.

## The negative case the fixture bought

The heuristics were calibrated against a sanitized Job List export from the trial account, and the single most valuable thing it revealed is a column the audit must **not** use.

That export carries **eight date-shaped headers**: `Date`, `Invoice Date`, `Quote Date`, `Work Order Date`, `Unsuccessful Date`, `Payment Received Date`, `Invoice Sent Stamp`, `Completion Date`. It carries two money-shaped ones: `Total Invoice Amount` and `Payment Amount`, the second of which reads `0.0000` on every unpaid job.

The obvious heuristic — normalize the header and check whether it *contains* "date" — binds `quote_date` to `Date`, which is the job-created date. The obvious money heuristic binds `value` to whichever amount column appears first. Neither throws. Neither logs. The first silently ages every quote in the audit, moving quotes across the 90-day edge and across the 72-hour grace boundary in both directions; the second reports a prospect's entire book as worth nothing.

So matching is **exact normalized equality against a curated synonym list**, ordered, with a claimed header removed from the running for later fields. `Total Invoice Amount` is listed ahead of the generic `total`/`amount` forms; mobile forms are listed ahead of landline ones, because the mobile is both the SMS-reachable number and the one actually populated.

The cost is that an unrecognised header leaves a field unmapped. That is not a failure mode — it is a dropdown, on a screen the operator is already looking at, in a step that exists precisely because this format is undocumented. **An unmapped field costs one click. A wrongly-mapped field costs the meeting.**

A synthetic fixture would not have shown any of this. It would have contained the three columns whoever wrote it was thinking about, and a `contains` heuristic would have passed against it.

## Deviations from Plan

### Intentional design deviations

**1. `confirmCsvMapping` lives in `src/core/audit/csv-intake.ts`, not in `actions.ts`**

The plan puts the confirm orchestration in the action file. Same argument as 02-06 deviation 6, one step sharper: a `'use server'` module publishes **every** export as a globally-POSTable Server Action, and this function writes `prospect_quote_lines` and publishes an audit. Exported from an action module it would be an unauthenticated endpoint that does so for any prospect id a caller can name.

The action is now a thin auth-first wrapper that translates result kinds into copy.

**2. `convertProspectToTenant` lives in `src/db/repository/conversion.ts`, not in `prospects.ts`**

`prospects.ts` opens with a prohibition it means literally — "there is no method here that accepts a `tenantId`" — and the conversion needs both schemas in one transaction. Adding it there would have required weakening that header, which is the sentence protecting the product's worst available outcome (a prospect's customer reached by a cadence).

It is one file, with one export, importing both schemas. Anyone asking "can prospect data reach a cadence?" finds exactly one place where the two families meet and can read what it does. Recorded in the barrel and in `tests/lint-ban.test.ts`, which asserts the exact export surface — adding a second function to that file requires editing a test, which is the point.

**3. The 90-day window is enforced on the CSV side, and out-of-window rows are counted**

Not in the plan's action. The API path filters to the window at fetch time; a CSV covers whatever range the operator happened to select in ServiceM8's reporting UI. The report's headline claim is "Last 90 days", so the window is applied here — and rows outside it are surfaced through the same proceed-with-warning copy as any other exclusion.

Silently using 12 of someone's 40 rows produces a defensible number attached to an indefensible sentence.

**4. Rows with no quote date are skipped with a reason rather than stored inert**

The API path stores them as lines with a null `quote_date_utc`, excluded from every figure by `wasQuoted`. For CSV they are excluded and named. The figures are provably identical either way — a never-quoted job contributes zero to all four — and one fewer PII-bearing row is stored for a job that was never quoted (D-04 minimization).

**5. The timezone select moved outside the source branch**

It was rendered only on the API path. A CSV prospect has exactly the same need of it, and the alternative was silently defaulting a Perth prospect's zone.

**6. `convert-form.tsx` and `mapping-form.tsx` are separate client components**

Not in the plan's file list. Both need `useActionState` — for the named-column errors, the proceed-with-warning gate, and the link failure message. The full staged row set stays server-side in both cases.

### Auto-fixed issues

**7. [Rule 1 — Bug] A NUL byte was written into `mapping/actions.ts`**

A `.join(' ')` in a helper landed on disk as `.join('\0')`. Caught when a subsequent edit failed to match and an `od -c` showed the byte. The helper was the wrong home for that logic anyway — it moved to `csv-mapping.ts` as `mappingKey` (both the action and the client component need it, and exporting it from the action module would have published another endpoint) and now joins on `'|'`.

**8. [Rule 2 — Missing critical] The skipped-row acknowledgement was transferable between mappings**

First implementation rendered the hidden `acknowledge` input whenever a warning was present. An operator who saw *"4 rows skipped — unrecognised job status"*, changed a column, and submitted again would have proceeded **without ever being shown the new mapping's real counts** — the acknowledgement carrying over to a number nobody had seen.

The warning now carries the `mappingKey` it was computed under, and the form renders neither the message nor the acknowledgement unless the selects still match it. Changing a column re-asks with the true figures.

**9. [Rule 2 — Missing critical] Submitted column names are validated against the staged headers**

`confirmCsvMapping` rejects any mapping naming a header the upload did not produce. Harmless today — the worst case was a `jsonb` key lookup returning `undefined` — and exactly the shape that stops being harmless when something richer than a CSV row is staged later.

**10. [Rule 3 — Blocking] Three existing assertions needed updating**

- `tests/lint-ban.test.ts` asserts the repository barrel's exact export list; `getProspectStaging` and `convertProspectToTenant` were added to it with comments explaining what each is for. That test exists so surface growth is deliberate, and it worked.
- `tests/prospect-audit.test.ts` located the figure list by `<dl className="profile">`, which 02-07 restyled to `audit-figures`. The selector moved; the property under test — what that list may and may not contain — is unchanged.
- The baseline **label** was dropped in the first draft of the report and restored: the UI-SPEC figure-labels row lists `Baseline win rate` as a secondary stat, and a bare percentage on a document about someone's business is a number with no question attached to it.

## The report's one-constant rule, made checkable

`page.tsx` interpolates `Math.round(AUDIT_RECOVERY_RATE * 100)` into the footnote. There is no percentage literal anywhere in the file, and a comment-stripped source assertion proves it — `15%`, `20%` and `0.15` are all absent from the executable text, and `WINDOW_DAYS` supplies "the last 90 days" rather than the digits.

That assertion is the mechanism behind the plan's prohibition. A report claiming "a conservative 15% recovery rate" above a figure computed with 0.2 is not a rounding error; it is a document the person being sold to can show is wrong, in the meeting it was written for.

## Threat mitigations applied

| Threat | Applied |
|---|---|
| T-2-SC | Blocking-human gate re-run at execution and surfaced verbatim before install; exact `5.7.0` pin; installed package confirmed script-free |
| T-2-06 | `file.size` checked before a byte is read; papaparse `preview: MAX_CSV_ROWS + 1` stops the parser rather than rejecting its output; per-row validation with named skip reasons; unknown statuses never defaulted |
| T-2-14 | Cells are data end to end — React escapes the preview and the report, and no CSV re-export exists this phase for a formula payload to escape into |
| T-2-13 | `convertProspectAction` is auth-first before the body is parsed; both uuids shape-checked at the action and again at the repository boundary; the no-overwrite rule and both not-found paths are under test |
| T-2-07 | Conversion is the only site that clears `purge_after` and requires an explicit operator action; the convert test runs the purge command **read from `cron.job`** and proves it spares converted lines while deleting an unconverted prospect's expired ones; a rejected conversion leaves the second prospect's clock running |
| T-2-02 | `getProspectStaging` is a two-column read that cannot return `api_key_ciphertext`; only five preview rows cross into the client; the report page still selects neither the ciphertext nor the staging blob |

## Verification

| Check | Result |
|---|---|
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/csv-mapping.test.ts` | 31 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/convert-prospect.test.ts` | 15 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` (full suite) | **490 passed** (46 new) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | compiled, 11 routes — `/audits/[id]/mapping` present |
| RED gate | `70c31bd` failed on the missing module before `b50a94a` |

### Acceptance criteria

| Criterion | Evidence |
|---|---|
| Every behavior-block case passes against the real export | `csv-mapping.test.ts` — inferMapping over the fixture's own headers, plus the `Date`/`Invoice Date`/`Completion Date` negative case |
| `package.json` pins papaparse 5.7.0 exactly | `"papaparse": "5.7.0"`, no range prefix |
| The confirm path is the only CSV line-write and goes through `storeAuditResults` | `csv-intake.ts` has one `storeAuditResults` call and no other insert; `storeAuditResults` remains the sole insert site |
| `csv_staging` cleared in the same transaction that stores results | `storeAuditResults` sets `csvStaging: null` inside its `db.transaction` |
| Both caps bind before work proportional to file size | `file.size` check precedes `file.text()`; `preview: MAX_CSV_ROWS + 1` bounds the parse |
| Convert test passes all four assertions | link set, purge cleared on every line, no-overwrite with the first link intact, purge-spares-converted via the catalog-read command |
| `page.tsx` imports the constant and holds no percent literal | comment-stripped source assertion for `15%`, `20%`, `0.15` |
| `audit.css` has the A4 rule and a print block hiding the nav | `@page { size: A4; margin: 14mm }`; print block contains `.nav`, `.audit-actions`, `display: none` |
| The CSV addendum renders iff `csv_note_degraded` | source assertion: the sentence occurs exactly once, inside the `csv_note_degraded ?` branch |

## Known Stubs

None. Both D-12 input paths are wired end to end.

## UAT — needs a human

**The print rendering has not been looked at by anyone**, and it cannot be: the backstop truth is explicitly a human check, and no assertion in this repository can tell whether the sheet fits on one page.

Worth 15 minutes with `npm run dev`:

1. **CSV path.** New audit → *CSV upload* → the fixture at `tests/fixtures/sm8/job-list-export.csv`. Confirm the mapping screen pre-fills **Job Status / Quote Date / Total Invoice Amount** and that the preview shows real values under each. Change *quote value* to `Payment Amount` and confirm the preview goes to zeros — that is the wrong-column failure the whole screen exists to catch, made visible.
2. Set *quote value* to *— not in this export —* and press Confirm: the error must read *"Couldn't find a column for quote value. Pick it from the dropdown or re-export the Job List from ServiceM8 reporting."* **on that dropdown**.
3. The fixture's quotes are dated late August 2026. If today is more than 90 days later they will all fall outside the window and the proceed-with-warning copy will appear — that is correct behaviour, not a bug.
4. **The A4 backstop truth.** Open a generated audit, print-preview, confirm **one page**. Repeat on a phone in **dark mode** — the preview must be black on white with only the Recoverable estimate in blue. Then repeat with a worst-case prospect: a 60-character business name and 7-digit values.
5. **Convert.** Link the prospect to a client, confirm the success line names the number of lines now kept, and confirm a second prospect cannot be linked to the same client.

Also still outstanding, inherited: **the recovery rate itself.** `AUDIT_RECOVERY_RATE = 0.15` remains the planner's flagged assumption at the conservative end of the D-09 band. It is now rendered on a prospect-facing document. Confirm the number before the first audit goes out.

## Notes for the next plans

- **Phase 7 (attribution):** conversion is what keeps a prospect's lines alive to be read. `tenants.prospect_id` is the link and the baseline stays on the prospect row — `null` still means no data and must never be read as 0.
- **A second link ever needed?** `conversion.ts` is deliberately a one-export file. Unlinking (to re-point a client at a different audit) does not exist and would need its own decision about what happens to the first prospect's `purge_after`.
- **The mapping heuristics are calibrated against one account's export.** A second design partner's export is the next real test of the synonym lists; the failure mode is a dropdown the operator has to fill in, which is survivable and visible.

## Self-Check: PASSED

All 12 created and 8 modified files verified present on disk. All four commits (`14e1829`, `70c31bd`, `b50a94a`, `8ce904a`) verified in `git log`. No commit deleted a tracked file.
