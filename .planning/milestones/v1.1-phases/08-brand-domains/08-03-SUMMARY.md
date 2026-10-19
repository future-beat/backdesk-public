---
phase: 08-brand-domains
plan: 03
subsystem: audit
tags: [commercial-assumptions, audit, attribution, decision-record, basis-points]

requires:
  - phase: 02-audit
    provides: "src/core/audit/constants.ts — the import-free, eight-export constants module and its eight-export / no-import structural pins"
  - phase: 07-attribution
    provides: "resolveBaseline + the basis-point storage in aggregate.ts and attribution/baseline.ts; feesNote's setup-fee exclusion sentence"
provides:
  - "A recorded operator decision on AUDIT_RECOVERY_RATE (0.15), DEFAULT_BASELINE_WIN_RATE (0.7), BASELINE_MIN_QUOTES (10) and the setup-fee exclusion — dated 2026-09-07, quoted verbatim"
  - "docs/commercial-assumptions.md — the citable decision record: value, rationale, where it renders, and the exact file:line pins to edit if it changes"
  - "src/core/audit/constants.ts header pointing at the record (comment only — still eight exports, still no import)"
  - "PROJECT.md Key Decisions: both '⚠ Flagged assumption' rows replaced with confirmed rows pointing at the record"
  - "A basis-point precision assertion any future operator-chosen rate must also satisfy"
affects: [08-06-audit-page-copy, 09-landing-page, 10-first-client, first-real-audit, first-real-invoice]

actuals:
  tokens: 3200
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Decision record as a docs/ file the code header points at, and the code's own JSDoc updated so no block still reads as awaiting confirmation"
    - "Precision-as-a-test: assert the STORAGE representation can hold the constant exactly (Number.isInteger(rate * 10000)), so a future value change cannot silently round a figure away from its own footnote"

key-files:
  created:
    - docs/commercial-assumptions.md
  modified:
    - src/core/audit/constants.ts
    - tests/audit-aggregate.test.ts
    - .planning/PROJECT.md
    - .planning/STATE.md

key-decisions:
  - "Operator confirmed keep-all on 2026-09-07: all three values and the setup-fee exclusion stand unchanged, so Task 2 was documentation only and no stored prospect needed reconciling"
  - "Grace-window behaviour confirmed as-is — a quote WON inside the 72h grace window is still not counted as 'never followed up'; recorded as a confirmation, not a change, and no follow-up task was requested"
  - "The three per-value JSDoc blocks were rewritten from 'the operator should confirm this' to 'operator-confirmed 2026-09-07' (Rule 2 deviation): leaving a constants file that asks for a confirmation it already has is the same class of defect the module exists to prevent — a document disagreeing with the fact it describes"
  - "The record names the pins by file:line (tests/audit-aggregate.test.ts:96/100/115) and by assertion text, so a line drift does not make the instruction unusable"
  - "The rate-change path in the record carries the stored-prospect caveat explicitly: prospects.recoverable_estimate is frozen at audit time while the page footnote renders the current constant, so /audits must be empty or every prospect regenerated before a rate change ships"

patterns-established:
  - "Confirm-only checkpoint items (the grace window) are recorded in the decision record with their outcome, so a later reader can tell 'confirmed and unchanged' from 'never asked'"

requirements-completed: [BRAND-02]

coverage:
  - id: D1
    description: "The operator has explicitly confirmed the three values and the setup-fee rule at a recorded checkpoint, before any real audit or invoice exists"
    requirement: BRAND-02
    verification:
      - kind: other
        ref: "Checkpoint reply 2026-09-07, verbatim `keep-all, grace-window confirmed`; recorded in docs/commercial-assumptions.md header, in .planning/STATE.md Blockers, and in this summary"
        status: pass
    human_judgment: true
  - id: D2
    description: "The confirmed values live in exactly one config location whose header points at the decision record, with no new export and no import"
    requirement: BRAND-02
    verification:
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#constants (D-09) > exports exactly the eight named constants"
        status: pass
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#constants (D-09) > is a module with NO imports — stated as a test, not as a convention"
        status: pass
      - kind: other
        ref: "grep -c '^import ' src/core/audit/constants.ts → 0; grep -c '^export const ' → 8; grep -c 'docs/commercial-assumptions.md' → 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "PROJECT.md Key Decisions carries no '⚠ Flagged assumption' row for either value; both read as confirmed with the date and a pointer to the record"
    requirement: BRAND-02
    verification:
      - kind: other
        ref: "grep -c 'Flagged assumption' .planning/PROJECT.md → 0; grep -c 'docs/commercial-assumptions.md' .planning/PROJECT.md → 2"
        status: pass
    human_judgment: false
  - id: D4
    description: "The decision record states, for each value and the setup-fee rule: the value, the rationale lifted from the JSDoc and feesNote, the confirmation date and who confirmed, where it renders, and exactly what to edit if it changes"
    requirement: BRAND-02
    verification:
      - kind: other
        ref: "docs/commercial-assumptions.md (165 lines) names AUDIT_RECOVERY_RATE, DEFAULT_BASELINE_WIN_RATE, BASELINE_MIN_QUOTES, feesNote and tests/audit-aggregate.test.ts; §1-§4 each carry value / rationale / where it renders / if it changes"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both rates are exactly representable in basis points, so the basis-point storage in aggregate.ts and attribution/baseline.ts loses nothing — and any operator-chosen replacement must satisfy the same constraint"
    requirement: BRAND-02
    verification:
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#constants (D-09) > holds two rates that are exactly representable in basis points"
        status: pass
    human_judgment: false
  - id: D6
    description: "[backstop] BRAND-02 boundary: at quotesIssued exactly equal to BASELINE_MIN_QUOTES the MEASURED baseline is used (strictly fewer-than), and win rates of 0 and 1 resolve without error"
    requirement: BRAND-02
    verification:
      - kind: other
        ref: "Read at execution — src/core/attribution/baseline.ts:79 is `(input.quotesIssued ?? 0) < BASELINE_MIN_QUOTES`, strictly fewer-than, so exact equality takes the measured branch"
        status: pass
      - kind: unit
        ref: "tests/attribution-baseline.test.ts — BASELINE_MIN_QUOTES - 1 falls back to default (line 68), BASELINE_MIN_QUOTES does not (line 78); winRate '0.0000' (line 90) and '1.0000' (line 124) both resolve"
        status: pass
    human_judgment: false

metrics:
  duration: ~14 min
  completed: 2026-09-07
status: complete
---

# Phase 8 Plan 03: Commercial Assumptions Confirmed Summary

The three numbers a Quote Leakage Audit promises a prospect and a monthly invoice claims credit against stopped being planner assumptions and became an operator decision — recorded in the code's own header, in PROJECT.md, and in a standalone record the marketing thread can cite.

## The Decision

The checkpoint was answered on **2026-09-07**. The operator's reply, verbatim:

> `keep-all, grace-window confirmed`

Which resolves to:

| Item | Confirmed value | Change? |
|------|-----------------|---------|
| `AUDIT_RECOVERY_RATE` | `0.15` | no |
| `DEFAULT_BASELINE_WIN_RATE` | `0.7` | no |
| `BASELINE_MIN_QUOTES` | `10` | no |
| Setup fee in the recovery multiple | excluded | no |
| Quote won inside the 72h grace window counted as "never followed up" | no (the honest choice) | confirmed as-is, no follow-up task |

Because nothing changed, the three literal pins in `tests/audit-aggregate.test.ts` (lines 96 / 100 / 115) are untouched and no stored `prospects.recoverable_estimate` needed reconciling against a rate it was not computed under. Task 2 was documentation only, exactly as the recommended option predicted.

## Performance

- **Duration:** ~14 minutes
- **Tasks:** 2 (1 checkpoint:decision resolved by the operator, 1 auto)
- **Commits:** 2 (`b3d4e95`, `c8cc55c`)
- **Files:** 4 modified, 1 created

## Accomplishments

1. **The decision is recorded in three places that cannot drift apart quietly.** `docs/commercial-assumptions.md` is the record; `src/core/audit/constants.ts`'s file header names it (once, in a comment); `.planning/PROJECT.md`'s two Key Decisions rows point at it. The STATE.md blocker that carried the question since Phase 2 is closed with the verbatim reply.
2. **The record answers the question a future reader will actually have** — not "what is the value" (the code says that) but "what do I edit, and what breaks, if I change it". Each section names the value line, the test pin by file:line and assertion text, and where the number renders on a prospect- or client-facing document. The rate section carries the stored-prospect caveat in full.
3. **The rationale is lifted, not re-invented.** Every "why" paragraph in the record is the prose already written on the constant's JSDoc or in `feesNote` — so a change to one and not the other is visibly a contradiction rather than two plausible arguments.
4. **A precision constraint the next operator decision must also satisfy.** `aggregate.ts` and `attribution/baseline.ts` both store rates as whole basis points (`Math.round(value * 10_000)` into a `smallint`). `0.15 → 1500` and `0.7 → 7000` are exact; a value like `0.155` would not be, and would round on the way into a stored row while the footnote rendered the unrounded constant. That is now an assertion, not a hope.
5. **The backstop boundary was confirmed by reading, not assumed.** `src/core/attribution/baseline.ts:79` uses `<`, so at *exactly* `BASELINE_MIN_QUOTES` quotes the measured baseline is used. `tests/attribution-baseline.test.ts` already covered both sides of that threshold and both win-rate extremes; no new test was needed and none was invented to look busy.

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run tests/audit-aggregate.test.ts tests/attribution-baseline.test.ts tests/reporting-copy.test.ts tests/brand.test.ts` | 4 files, 109 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `grep -c 'Flagged assumption' .planning/PROJECT.md` | 0 |
| `grep -c 'docs/commercial-assumptions.md' .planning/PROJECT.md` | 2 |
| `grep -c '^import ' src/core/audit/constants.ts` | 0 |
| `grep -c '^export const ' src/core/audit/constants.ts` | 8 |
| `grep -c 'docs/commercial-assumptions.md' src/core/audit/constants.ts` | 1 |
| `grep -c 'isInteger(AUDIT_RECOVERY_RATE \* 10000)' tests/audit-aggregate.test.ts` | 1 |
| `docs/commercial-assumptions.md` names all four required symbols | yes (165 lines) |

CI on the next push runs the DB-backed `tests/convert-prospect.test.ts` (structural audit-page check); nothing in this plan touches its inputs, since no value changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — missing critical documentation correctness] The three per-value JSDoc blocks still asked for the confirmation they now had**

- **Found during:** Task 2, while adding the header pointer
- **Issue:** `AUDIT_RECOVERY_RATE`, `DEFAULT_BASELINE_WIN_RATE` and `BASELINE_MIN_QUOTES` each carried a "PLANNER'S FLAGGED ASSUMPTION … the operator should confirm this value before the first real report goes out" block. After 2026-09-07 those sentences are false, and this module exists precisely to stop a figure and its explanation disagreeing. A reader landing on line 111 would conclude the value was still unconfirmed while the header eight lines above said otherwise.
- **Fix:** each block's confirmation sentence rewritten to state the confirmation and its date, pointing back at the file header rather than repeating the record's path (the acceptance criterion pins that path to exactly one occurrence). The reasoning prose itself is unchanged — the argument for each value still stands as written.
- **Files modified:** `src/core/audit/constants.ts`
- **Commit:** `c8cc55c`
- **Not touched:** `ATTRIBUTION_WINDOW_DAYS`'s own flagged-assumption block. That is D-01, not D-09, and was not put to the operator — removing its flag would be recording a decision that was never made.

No other deviations. No architectural questions arose; no package was installed.

## Known Stubs

None.

## Notes for Future Phases

- **Before any rate change ships, `/audits` must list no prospects.** The Aug-2026 fixture was torn down on 4 Sep 2026, so this is currently free — but it stops being free the moment the first real prospect audit is generated. The record states this; the code cannot enforce it.
- **`docs/commercial-assumptions.md` is the citable artifact for the Cowork/marketing thread.** It contains values and rationale only — no tenant names, no figures from real audits (T-8-15).
- **Baselines are frozen at connect**, so a future `DEFAULT_BASELINE_WIN_RATE` change affects only clients connected after it — never a report already generated. That asymmetry is in the record and is the reason a baseline change is cheaper than a rate change.
- Phase 8's remaining plans (04–07) do not touch these constants; the next thing that will is the first real audit run in Phase 10.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change — this plan added one comment block, one test assertion, one docs file, and two table cells.

## Self-Check: PASSED

- `docs/commercial-assumptions.md` — FOUND
- `src/core/audit/constants.ts` — FOUND
- `tests/audit-aggregate.test.ts` — FOUND
- `.planning/PROJECT.md` — FOUND
- Commit `b3d4e95` — FOUND
- Commit `c8cc55c` — FOUND
