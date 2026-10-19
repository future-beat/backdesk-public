---
phase: 07-attribution-reporting
verified: 2026-09-03T16:53:00Z
status: passed
score: 112/113 must-haves verified
behavior_unverified: 0
backstop_abstentions: 1 # 07-07 backstop (the deployed console at 390px on the operator's phone; the iPhone print press; the `2 · 1 Aug` cell) — insufficient_spec until the operator checks after the next deploy. The 07-06 backstop is now CONFIRMED by 07-UAT tests 4 and 5.
deviations_recorded: 3 # WINDOWS.md #26 (WebKit header non-repeat), #27 (softwrap valve fold risk), #28 (printed description 22–25 of 60 code points). #26 and #28 are accepted rulings (orchestrator, 2026-09-03) confirmed on paper by 07-UAT test 4; none silently passed
overrides_applied: 0
prohibitions:
  total: 15
  tier: judgment # all descriptor-less; 07-06 and 07-07 declare none
  flagged: 15 # autonomous verify: NON-AUTHORITATIVE LLM-judge verdicts; `unverified-prohibition — human review recommended` on every item; still NOT covered by the 07-UAT (tests 1–6 were UI tests)
  judge_verdict_held: 14
  judge_verdict_held_with_caveat: 1 # 07-03 P3 tenant-uuid / event-id log lines — ruled 2026-09-04: tenant uuid permitted (see Prohibitions)
requirements:
  RPT-01: satisfied
  RPT-02: satisfied # print deviations #26/#28 accepted rulings; print button hardened (07-07); same-day range collapse (07-07)
  RPT-03: satisfied # every console table now inside .table-scroll and gated at source (07-07)
  orphaned: []
re_verification:
  previous_status: human_needed
  previous_score: 105/107
  previous_verified: 2026-09-03T10:00:00Z
  uat_gaps_diagnosed: [G-07-4, G-07-6]
  gaps_closed:

    - "G-07-6 — every console <table> inside .table-scroll (Clients on /, sync runs, audits list, mapping); tables-check.sh re-run first-hand: docScrollWidth 390 on all five fixtures at 390px, 1000 with tableFits at 1000px, control-bare still 620 (probe not blind); layout-contract third describe green and falsified synthetically; globals.css byte-untouched (6ed9105)"
    - "G-07-4 (withdrawn, hardened) — print-feedback.ts reducer (press → opening; beforeprint/afterprint → idle; timeout → fallback ONLY from opening) + island listeners + 1.5s timer + prefetch={false} on the version link; 25/25 print-feedback tests green first-hand; the false 'synchronous window.print()' header claim is gone"
    - "Cosmetic (UAT test 4 PDF) — followUpRange moved to @/core/reporting/copy with the same-day collapse: `2 · 1 Aug`, never `2 · 1–1 Aug`; 4/4 copy tests green first-hand; the page-local definition is gone"
    - "07-06 backstop 6.6 / 4.28 — CONFIRMED by 07-UAT tests 4 (iPhone Safari, 2-page PDF, one-line rows, no blank page, ~25 cp) and 5 (desktop Chrome, header on every page) recorded after the previous verification"
  gaps_remaining: []
  regressions: []
mvp_mode_discrepancy: "Unchanged from the initial verification: ROADMAP marks Phase 7 `mode: mvp` but the goal is not a User Story; standard goal-backward verification run as directed."
human_verification:

  - test: "390px PHONE PASS OVER THE CONSOLE (07-07 backstop truth 7.6 / plan human-check Task 1 / SUMMARY D6; also settles the bar-height judgement carried from 07-06). AFTER THE NEXT DEPLOY, on the phone (or DevTools at exactly 390px) sign in and stay on `/`; then open a client's page and scroll to `Recent sync runs`; then `/audits`; then, if an audit is mid-mapping, the mapping step. Finally widen past ~1000px on `/`."
    expected: "On every one of the four pages the page does NOT scroll sideways (`document.documentElement.scrollWidth === 390` in the console); the table scrolls sideways INSIDE its own box (swipe the Clients table to reach the Status column); the wrapped bar is unchanged from the 07-06 check and `Sign out` is reachable and comfortable to hit with a thumb. At ≥1000px the Clients table renders full width with no scrollbar, as before. WHILE THERE, RULE on the bar height: 176px at 390px (was 119px) and 72px at ≥700px (was 55px) is the recorded price of 44px on every nav control — say whether that is acceptable."
    why_human: "tables-check.sh proves it in headless Chrome over a hand-mirrored fixture DOM and the real globals.css, not over the deployed React render; the finding (UAT test 6) was reported from the operator's phone and must be closed from the same place. Thumb comfort and the bar-height price are judgements no measurement makes."

  - test: "iPHONE PRINT PRESS ON THE DEPLOYED FIXTURE (07-07 backstop truth 7.6 / plan human-check Tasks 2 and 3 / SUMMARY D5 and D3). AFTER THE NEXT DEPLOY, on the iPhone open /reports/13e8f2aa-edee-4eb1-b699-09b650674f81/2240704d-c755-4d55-ac1b-04fa09082331, scroll to the bottom, let the page settle a few seconds, tap `Print or save as PDF`. Cancel, reload, and this time tap the button the instant it is on screen. Save the PDF and read the Follow-ups column. Then, on desktop Chrome, click the button once."
    expected: "Settled tap: the print sheet opens (you may or may not glimpse `Opening print…` first). Immediate tap on reload: EITHER the sheet opens, OR `Opening print…` shows and within about two seconds becomes `Nothing opened? On iPhone use Share → Print; on desktop press ⌘P / Ctrl+P.` — and if the sheet then arrives by itself the hint disappears; a second tap still opens the sheet (the button is never dead). The saved PDF contains NEITHER `Opening print…` NOR `Nothing opened?`. Every Follow-ups cell whose two touches fall on one day reads `n · d MMM` (e.g. `2 · 1 Aug`), never `d–d MMM`; multi-day rows still read `n · d–d MMM`; the figures are unchanged. Desktop Chrome: the dialog opens on the first click and no hint remains after closing it. If a first tap is silent again, note ONE thing: did the sheet come up by itself a moment later, or only after the second tap — and were you still scrolling?"
    why_human: "The defect is a WebKit timing behaviour on a real device under a real network (`LocalDOMWindow::print()` defers while any subresource loads); the diagnosis found no code defect and no harness reproduces it. The reducer is proven; only the operator's phone can show whether the acknowledgement appears and whether the sheet arrives by itself."

  - test: "OPERATIONAL (07-UAT test 7, pending; carried forward from the 2026-09-02 verification). Check the operator inbox after 06:30 AWST (22:30 UTC) and read one digest."
    expected: "The stalled-drafts digest email arrives. When attribution is healthy it carries NO 'Attribution has stopped' section and NO 'Opt-out rate above 5%' section (both return null — absent, not empty headings). If any client is above the 5% opt-out threshold or the attribution cursor is wedged > 6h, the corresponding one-line section appears naming the count/backlog and age."
    why_human: "CR-03 (first review) made the digest wedge line the ONLY operator-facing signal for a quarantined won event; wiring is unit-tested, delivery is an external-service fact."

  - test: "PROHIBITIONS (15, judgment tier — ADR-550 D4 autonomous soft-gate; carried forward, still unruled by any UAT). Review the Prohibitions table in this report; the verifier's verdicts are NON-AUTHORITATIVE."
    expected: "Each must-NOT confirmed as not having happened. In particular rule on 07-03 P3: `consume-wins.ts` logs a tenant uuid (blocked run) and an outbox event id (quarantined decision) — never an amount, quote id, or the caught driver error — and the plan's own isolation test asserts exactly that sentence, so the literal wording ('MUST NOT carry a tenant id') and the plan's test disagree. — ruled: tenant uuid permitted (opaque internal id; sm8-sync tick bodies already carry tenantId; needed to act on a wedge) [Ruling 2026-09-04; 07-03 P3 statement and T-7-14 row amended in place; the other fourteen remain unruled]"
    why_human: "Descriptor-less prohibitions route to the end-of-phase human checkpoint; an LLM judgement cannot be the authority on a must-NOT for a billing surface."
---

# Phase 7: Attribution & Reporting — Verification Report (re-verification after 07-07)

**Phase Goal:** Every recovered dollar is attributed with an evidence chain and reported in the client's language — the invoice arrives stapled to proof it paid for itself
**Verified:** 2026-09-03T16:53:00Z
**Status:** human_needed
**Re-verification:** Yes — third pass. After the 07-UAT recorded tests 4–6 (2026-09-03 15:36), diagnosed G-07-6 (failed) and withdrew-but-kept G-07-4, gap-closure plan 07-07 executed in three commits (43d245f, c7b45ff, 271107e; docs 61b7af1)

**Mode note.** Unchanged: ROADMAP marks Phase 7 `mode: mvp`, goal is not a User Story; standard goal-backward verification as directed.

## What the verifier ran first-hand this session (not taken from any SUMMARY)

| Check | Result |
| --- | --- |
| `git diff --stat 2fb1e3a..HEAD` (excluding `.planning/`) | 13 files, +733/−236: four console pages (`page.tsx`, `clients/[id]/page.tsx`, `audits/page.tsx`, `mapping-form.tsx`), `reports/page.tsx` (comment only, 8 lines), `[reportId]/page.tsx`, `print-button.tsx`, NEW `print-feedback.ts`, `core/reporting/copy.ts`, and four test files (`layout-contract`, `lint-ban`, NEW `print-feedback`, `reporting-copy`). **No repository, schema, migration, consumer, action, accessor, route, CSS or env change** — `globals.css` last commit is still `6ed9105`, `report.css` still `44b0cf8`. No remote-only truth from 2026-09-02 needs re-running. |
| `gsd-tools query verify.commits 43d245f c7b45ff 271107e 61b7af1` | all 4 valid |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm test` (bare, run ONCE; log `scratchpad/npm-test-0704.log`; `ALLOW_REMOTE_TESTS` unset, `test:remote` never run, DB untouched) | **2,402 passed / 0 failed** across 72 files; 39 files fail at import with the ONE message `Refusing to run integration tests against a non-local Supabase stack` (39 distinct FAIL lines, zero non-refusal error lines) — the documented remote gate |
| `npx vitest run tests/layout-contract.test.ts tests/print-feedback.test.ts tests/reporting-copy.test.ts tests/lint-ban.test.ts --reporter=verbose` | **4 files / 93 passed / 0 failed** — layout-contract 13 (11 + the 2 new G-07-6 tests), print-feedback 25 (12 transitions, 2 sequences, 4 copy/constant, 7 island pins), reporting-copy incl. the 4 new `the Follow-ups cell` cases, lint-ban incl. both `print-button.tsx` and `print-feedback.ts` in `CLIENT_REACHABLE` |
| `bash 07-06-harness/tables-check.sh` (headless Google Chrome, real `globals.css`, wrapper read from the shipped `.tsx`) | **RESULT: PASS** — 390px: clients / runs / audits / mapping / reports all `docScrollWidth 390`, `wrapperInSource true`, `tableParent <div class="table-scroll"> overflow-x:auto`, `navRight 370`; `control-bare` (unwrapped by construction) `620` — the probe is not blind; 1000px: all five `docScrollWidth 1000`, `tableFits true` (wrapper inert) |
| `bash 07-06-harness/nav-check.sh` (regression) | RESULT: PASS at 390/604/700px (unchanged) |
| `bash 07-06-harness/run.sh` (regression; Chrome A4 + compiled WKWebView) | RESULT: PASS — Chrome 3pp (18 + 22 rows, p3 footer), header 1/1, 25 cp; WebKit 2pp (26 + 14 rows), 22 cp, header 0/1 INFO (WINDOWS #26) |
| Synthetic falsification of the new source gate (node, no tree change) | `<table>` preceded only by a `{/* <div className="table-scroll"> */}` comment → `tables 1 wrapped 0` FAIL; wrapped → `1 / 1` PASS. The comment stripper and the whitespace-only adjacency both bite. |
| Comment-naive table/wrapper counts over `src/app/(console)/**/*.tsx` | 7 files, 9 tables, 9 wrapped (mapping-form 2/2, settings/email 2/2, the rest 1/1) |
| `gsd-tools query verify.artifacts` on 07-07-PLAN | **12/12** exist and are substantive |
| `gsd-tools query verify.key-links` on 07-07-PLAN | tool cannot parse (prose `from:` values) — all four links verified by hand below |
| `verify.artifacts` / `verify.key-links` plans 01–05 | unchanged since the previous pass (28/28; 17/18 + 1 by hand) — no file those truths depend on changed |
| Debt-marker scan over the 13 changed files (added lines) | zero TBD/FIXME/XXX/TODO/HACK/placeholder/console.log |
| `roadmap.analyze` | phases 1–7 only → nothing can be deferred |
| `git status` of `src/`, `tests/`, the phase dir | clean; the harness copy of `layout-contract.test.ts` flagged last time is deleted in `df0cb83` and no longer listed in the README |

## Goal Achievement

### Observable Truths — Roadmap Success Criteria (the contract)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| SC1 | A job won after ≥1 sent touch in the window records as recovered revenue with a per-job evidence chain, gross beside conservative | ✓ VERIFIED (regression: unchanged) | Nothing under `src/core/attribution`, `src/db`, `run-tick.ts` or the cadence-tick route changed since 23853c5; pure suites green in this run's `npm test`; `attribution-consume.test.ts` remote evidence stands from 2026-09-02 |
| SC2 | Operator can generate a per-client monthly report (web/PDF): quotes chased, replies, jobs won, dollars (gross + conservative), fees paid, multiple | ✓ VERIFIED — print deviations #26/#28 are **accepted rulings** | Generation path (`generate.ts`, `reports.insertVersion`, `parseReportDocument`) untouched. The PDF half is now confirmed ON THE REAL DEVICES: 07-UAT test 4 (iPhone Safari, `Monthly report · Quote Recovery 2.pdf`, 2 pages, one-line rows, no blank page, ~25 cp) and test 5 (desktop Chrome, header on every page) both `pass`. 07-07 adds the press acknowledgement (D-12 delivery mechanism) and the same-day Follow-ups collapse. WINDOWS #26 (WebKit header non-repeat) and #28 (22–25 of 60 description code points on paper) were observed in test 4 and are accepted engine-debt rulings, not gaps. |
| SC3 | Operator sees per-client first-touch-24h, reply, opt-out/complaint, human-edit rates and recovery multiple | ✓ VERIFIED (regression: unchanged) | `metrics.ts`, both pages' data paths and `forAllTenants_reportMetrics` untouched; `report-metrics.test.ts` parity evidence (2026-09-02) stands; UAT test 3 confirmed the overview/detail rendering; the console-wide 390px widening that hid `Sign out` (G-07-3 nav, then G-07-6 Clients table) is closed in code and measured |

### Observable Truths — Plan 07-07 (gap closure G-07-6 / G-07-4; the new must-haves)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 7.1 | At 390px no console page is wider than the viewport: `/`, `/clients/[id]`, `/audits`, `/audits/[id]/mapping` each scroll their table INSIDE `.table-scroll`; `scrollWidth === 390` with the nav unchanged; at ≥1000px the wrapper is inert (G-07-6; RPT-03) | ✓ VERIFIED (source + harness) | Source: `page.tsx:162`, `clients/[id]/page.tsx:1048`, `audits/page.tsx:108`, `mapping-form.tsx:78` (+ the already-wrapped preview at :133) each `<div className="table-scroll">` immediately before `<table>`, with a comment recording the measured width and the real precedent. `globals.css:319 .table-scroll { overflow-x: auto }` untouched. tables-check.sh first-hand: 390 / 390 / 390 / 390 (reports control 390, control-bare 620); 1000px `tableFits true` on all five. Deployed-device leg → backstop 7.6 / Human #1. |
| 7.2 | A `<table>` outside `.table-scroll` anywhere under `src/app/(console)` fails `npm test` — the gate 06-02 lacked (G-07-6) | ✓ VERIFIED (behaviourally) | `tests/layout-contract.test.ts:296-323`: `consoleTsxFiles()` recursive `readdirSync(…, { recursive: true })` over `src/app/(console)`, `uncommentedTsx()` strips JSX-comment → block → whole-line in that order, per-file `count(<table\b) === count(<div className="table-scroll">\s*<table\b)`, `expect(seen).toBeGreaterThan(0)` (no vacuous pass), one assertion over the offenders array. Green in `npm test` (in the 2,402). Falsified synthetically: a commented-out wrapper decoy → FAIL, a real wrapper → PASS. No allowlist anywhere in the describe. |
| 7.3 | Pressing `Print or save as PDF` always gives visible feedback: `Opening print…` at once, cleared on `beforeprint`; after 1.5s of silence the inline fallback names Share → Print / ⌘P–Ctrl+P and the button stays live; none of it reaches paper (G-07-4; RPT-02) | ✓ VERIFIED (reducer behaviourally tested; island wired) | `print-feedback.ts` (87 lines, zero imports): `nextPrintFeedback` — `press` → `opening` from ANY state, `beforeprint`/`afterprint` → `idle`, `timeout` → `fallback` ONLY from `opening`; `PRINT_FALLBACK_AFTER_MS = 1500`; both message constants. `print-button.tsx`: `useEffect` registers `beforeprint`/`afterprint` listeners that `clearTimer()` and dispatch; `press()` clears, dispatches `press`, arms the 1.5s timer, then calls `window.print()` LAST; `<p className="muted hint" role="status">` renders inside `.report-actions`; no `disabled=`. `report.css:268-276` print block still hides `.report-actions`. `tests/print-feedback.test.ts` 25/25 first-hand incl. "ignores a stale timer that fires after the dialog opened" and "never takes the button out of service". `page.tsx:413` version link `prefetch={false}` (the in-flight-prefetch arming condition removed). On Chromium the dialog itself is the acknowledgement (print() blocks and fires `beforeprint` synchronously) — documented in the island, consistent with the truth. Real-device timing → backstop 7.6 / Human #2. |
| 7.4 | The printed Follow-ups cell collapses a same-day range to `2 · 1 Aug`, never `2 · 1–1 Aug`; multi-day and cross-month unchanged; frozen `monthly_reports` rows untouched (RPT-02) | ✓ VERIFIED | `copy.ts:114-122 followUpRange`: `if (first === last) return \`${count} · ${first}\``, then the existing same-month/cross-month logic. Call site `[reportId]/page.tsx:339-345` byte-identical (`className="report-softwrap">{followUpRange(` — the layout-contract pin at :233 still green), fed from `shortDate(line.firstTouchAt / lastTouchAt, report.timezone)` — frozen row fields, render-time only. Page-local definition gone (`grep -c 'function followUpRange' page.tsx` = 0). `reporting-copy.test.ts:137-166` 4/4 first-hand: `2 · 1–4 Aug`, `12 · 14–31 Aug`, `2 · 1 Aug`, `1 · 3 Aug`, `3 · 28 Jul–2 Aug`, `2 · —` and the one-degraded-end long form. |
| 7.5 | 06-UI-SPEC:182, 07-UI-SPEC:242/:319 and the `reports/page.tsx` comment attribute `.table-scroll` to the quotes table (02-05, 8de755c); 07-UI-SPEC:219/:299 describe the acknowledgement and fallback instead of a synchronous `window.print()`; every correction dated and attributed to 07-07 | ✓ VERIFIED | `[Contract correction 07-07, 2026-09-03, G-07-6]` at 06-UI-SPEC:182 and 07-UI-SPEC:242, :319; `[… G-07-4]` at 07-UI-SPEC:219, :299; `### Contract corrections (07-07, 2026-09-03)` at :380 with both narratives (:384 G-07-6, :385 G-07-4). `reports/page.tsx:148-151` comment now names 07-07/G-07-6 and the quotes-table origin. Harness README row 13 documents `tables-check.sh` and the FAIL-before/PASS-after at :27/:31. No residual "client-list wrapper/convention/precedent" text in either UI-SPEC or the README (the only "client-list precedent" left, 07-UI-SPEC:144, is about the empty-state COPY, not the wrapper); no residual "synchronous" print claim outside the correction narrative. |
| 7.6 | **[backstop]** On the operator's phone at 390px, `/` after login does not scroll sideways and the Clients table scrolls inside its box; on the deployed fixture report the print button shows `Opening print…` then the sheet or the fallback; the Follow-ups cell reads `2 · 1 Aug` | ⚠️ INSUFFICIENT_SPEC (abstain) | Mechanism present, wired and harness-proven on this machine; **no deploy after 43d245f..271107e is evidenced in the repo and the operator has not looked at `/` or pressed the button since 07-07 landed.** → Human #1 and #2. |

### Observable Truths — Plan 07-06 (regression check against the 2026-09-03T10:00 report)

| # | Truth | Previous | Now | Evidence |
| --- | --- | --- | --- | --- |
| 6.1 | No trailing blank page (G-07-1) | ✓ (harness) | ✓ VERIFIED (harness + device) | run.sh re-run: trailingGap pass on both engines; **07-UAT test 4 (iPhone) and 5 (Chrome): `NO blank page` — pass** |
| 6.2 | One-line-box rows, seven columns fit, Chrome header repeat, figures never separate (G-07-2) | ✓ (harness) | ✓ VERIFIED (harness + device) | run.sh re-run PASS; UAT test 4: one-line rows `#4201 · Switchboard upgrade an…`, row #4230 and Total whole at the top of page 2; test 5: header on every page |
| 6.3 | WebKit non-repeat recorded as debt, never claimed fixed | ✓ | ✓ VERIFIED | WINDOWS #26 still the record; UAT test 4 instructed "do not fail on that" and observed it; run.sh prints INFO |
| 6.4 | 390px nav wraps, 44px controls, ≥700px one line (G-07-3) | ✓ (harness) | ✓ VERIFIED (harness) — height judgement still open | nav-check.sh re-run PASS. UAT test 6 implicitly confirmed the bar behaves ("unlike the Reports table" — the widening moved to the Clients table) and "the bar height was not commented on" → folded into Human #1 |
| 6.5 | Contract corrections dated and attributed (07-06) | ✓ | ✓ VERIFIED | unchanged; 07-07 added its own subsection beneath rather than editing them |
| 6.6 | **[backstop]** Deployed fixture printed from the operator's iPhone and desktop Chrome | ⚠️ abstain | ✓ VERIFIED (explicit evidence) | **07-UAT test 4 `result: pass`** (Creator Safari, Producer iOS 26.5.2 Quartz PDFContext, A4, 2 pages, fixture version 3) and **test 5 `result: pass`** (desktop Chrome) — recorded 2026-09-03 after the previous verification was written |

### Observable Truths — Plans 07-01 … 07-05 (regression check)

The 101 truths (SC1–3, 1.1–1.9, 2.1–2.14, 3.1–3.10, 4.1–4.40, 5.1–5.28) stand on: artifacts 28/28, key-links 17/18 (+1 by hand), tsc/lint clean, 2,402 pure assertions green in this run, and a diff since 2fb1e3a confined to presentation/test files. Rows whose evidence changed since the last pass:

| # | Truth | Previous | Now | Evidence |
| --- | --- | --- | --- | --- |
| 4.22 | **[backstop]** Dark-mode iPhone print → light A4, accent hero, no nav/buttons | ✓ (UAT 1) | ✓ VERIFIED | Re-confirmed by UAT test 4 on the same device after 07-06 |
| 4.28 | **[backstop]** 20-line month: hero+figures+totals page one, header repeated page two, no row split | ⚠️ DEVIATION — ruling requested | ✓ VERIFIED **as amended by 07-06** (WINDOWS #26/#28 accepted rulings) | UAT test 5 (desktop Chrome): header repeated on every page, no row split, no blank page — the truth as written holds on Chromium. UAT test 4 (iPhone): one-line rows, no split, header on page one only — the WebKit half is WINDOWS #26, an accepted engine-debt ruling (orchestrator, 2026-09-03). The previous report's suggested override is therefore withdrawn as unnecessary; no `overrides:` entry is fabricated here. |
| 4.4 / 4.36 | Description frozen at 60 code points; page renders `line.jobDescription` verbatim | ✓ (#28 touches) | ✓ VERIFIED | Unchanged; on paper ~25 cp survived in UAT test 4 (above the 22 floor) — WINDOWS #28 accepted |
| 4.30-ish (print button, UI-SPEC E7) | `Print or save as PDF` opens the browser print dialog | ✓ (code) | ✓ VERIFIED — hardened | The first-press miss (G-07-4) was withdrawn as not reproducible; 07-07 makes the press observable regardless of cause (7.3) |
| 4.x (Follow-ups cell) | Follow-ups renders `n · d–d MMM` | ✓ | ✓ VERIFIED — refined | Same-day collapse (7.4); every other shape byte-identical |
| 5.16 | `.table-scroll` scrolls sideways, `main` never widens | ✓ (harness, /reports only) | ✓ VERIFIED (harness, every console table) | tables-check.sh now covers all four formerly-bare tables plus the /reports control |
| 5.18 | Nav gains one link and wraps | ✓ (harness) | ✓ VERIFIED | nav-check.sh re-run PASS |

**Score:** 112/113 truths verified (1 backstop abstention: 7.6; 0 recorded deviations awaiting a ruling; 0 present-behavior-unverified; 0 failed)

### Recorded deviations (WINDOWS.md) and the truths they touch

| WINDOWS id | Kind | What it deviates from | Touches truths | Disposition |
| --- | --- | --- | --- | --- |
| 26 | unmet-truth | "column header repeated at the top of page two" on iPhone Safari | 4.28, SC2 (PDF half), UI-SPEC E6 | **Accepted ruling** (orchestrator 2026-09-03); observed and not failed in UAT test 4; still recorded, never claimed fixed |
| 27 | deviation | "no row straddles the fold" is structural and conditional on the Follow-ups valve not wrapping on a narrow sheet | 6.2, 4.28 | Recorded; UAT test 4 showed no wrap on the real device; 07-07's same-day collapse can only SHORTEN the valve cell |
| 28 | deviation | "description 60 code points + `…`" on paper: 25 (Chromium) / 22 (WebKit) survive | 4.4, 4.36, SC2 | **Accepted ruling**; UAT test 4 measured ~25 surviving on the iPhone; run.sh `DESC_FLOOR=22` re-asserted first-hand on both engines |

### Prohibitions (must-NOT) — judgment tier, NON-AUTHORITATIVE LLM-judge verdicts

> **Operator ratification, 2026-09-05 (v1.0 milestone audit):** every must-NOT statement in 07-01..07-05 is ratified as held. Basis: each overlaps a threat closed with grep-level evidence in 07-SECURITY.md (36/36); the one contradiction (07-03 P3) was ruled on 2026-09-04.

Unchanged from 2026-09-02: 15 descriptor-less prohibitions across 07-01…07-05 (07-06 and 07-07 declare none). 07-07's diff cannot affect any of them — no write path, accessor, log line, evidence schema, cadence control or trust boundary changed (the island renders one of two fixed strings from an import-free module inside a print-hidden section; `lint-ban` pins both files as pulling no database module into the browser bundle, green first-hand). All 15 remain flagged **`unverified-prohibition — human review recommended`**; no UAT has ruled on them → Human #4.

07-03 P3 — ruled: tenant uuid permitted (opaque internal id; sm8-sync tick bodies already carry tenantId; needed to act on a wedge) [Ruling 2026-09-04]. The statement at 07-03-PLAN.md:79 and the T-7-14 register row were amended in place; no code or test changed — consume-wins.ts:565-568 and attribution-consume-isolation.test.ts:185-204 already matched the ruling. Fourteen prohibitions remain flagged and unruled.

### Required Artifacts (07-07; plans 01–06 regression unchanged)

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/app/(console)/page.tsx` | Clients table inside `.table-scroll` (PRIMARY) | ✓ VERIFIED / WIRED | :162 wrapper immediately before `<table>`; harness clients @390 = 390 (was 620) |
| `src/app/(console)/clients/[id]/page.tsx` | sync-runs table wrapped | ✓ VERIFIED / WIRED | :1048; harness runs @390 = 390 (was 437) |
| `src/app/(console)/audits/page.tsx` | audits list wrapped | ✓ VERIFIED / WIRED | :108; harness audits @390 = 390 (was 464) |
| `src/app/(console)/audits/[id]/mapping/mapping-form.tsx` | first (mapping) table wrapped; preview already wrapped | ✓ VERIFIED / WIRED | :78 and :133; 2 tables / 2 wrapped; harness mapping @390 = 390 (was 408) |
| `tests/layout-contract.test.ts` | third describe, recursive walk, count equality, `.table-scroll` pin | ✓ VERIFIED / RUNS | :296-323; 13/13 first-hand; in `npm test`; synthetic falsification bites |
| `07-06-harness/tables-check.sh` (+ `gen-tables.mjs`) | 390/1000px proof, wrapper read from the shipped `.tsx`, `control-bare` | ✓ VERIFIED / RUNS | Executed first-hand → RESULT: PASS with control-bare 620 |
| `src/app/(console)/reports/[client]/[reportId]/print-feedback.ts` | import-free reducer leaf, 1500ms, both messages | ✓ VERIFIED / WIRED | 87 lines, `grep -c '^import'` = 0; imported by the island; pinned in `CLIENT_REACHABLE` |
| `src/app/(console)/reports/[client]/[reportId]/print-button.tsx` | acknowledgement + timer + listeners + fallback, never disabled, header rewritten | ✓ VERIFIED / WIRED | imports `react` + `./print-feedback` only; rendered at `page.tsx:420` inside `.report-actions` |
| `tests/print-feedback.test.ts` | reducer transitions, byte-verbatim copy, 1500, island pins, `.report-actions` still hidden | ✓ VERIFIED / RUNS | 25/25 first-hand |
| `src/core/reporting/copy.ts` | `followUpRange` with the same-day collapse | ✓ VERIFIED / WIRED | :114-122; imported at `page.tsx:8`, called at :340 |
| `tests/reporting-copy.test.ts` | same month / same day / cross month / degraded ends | ✓ VERIFIED / RUNS | :137-166, 4/4 first-hand |
| `.planning/phases/07-attribution-reporting/07-UI-SPEC.md` | :219, :242, :299, :319 corrected + `### Contract corrections (07-07, …)` | ✓ VERIFIED | all five locations tagged; :380-385 subsection |

### Key Link Verification (07-07, by hand — the tool rejects prose `from:` values)

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `page.tsx` `<div className="table-scroll">` | `globals.css:319 .table-scroll { overflow-x: auto }` | className — the only overflow-containing box between the table and the ICB | WIRED | Harness `tableParent: <div class="table-scroll"> overflow-x:auto`, `docScrollWidth 390`, `tableWidth 599.6` inside a 350px column; control-bare proves the same markup without the box is 620 |
| `tests/layout-contract.test.ts` third describe | every `src/app/(console)/**/*.tsx` | recursive readdir + comment strip; per-file count equality; no allowlist | WIRED | 9 tables / 9 wrapped seen; `seen > 0` guard; synthetic decoy fails |
| `print-button.tsx` `addEventListener('beforeprint', …)` | `print-feedback.ts` `nextPrintFeedback(state, 'beforeprint')` → `'idle'` | the dialog opening is the ONLY success signal | WIRED | `onBefore` → `clearTimer()` + `setFeedback(s => nextPrintFeedback(s, 'beforeprint'))`; listener removed on unmount; reducer test `opening + beforeprint → idle` green |
| `[reportId]/page.tsx` Follow-ups `<td>` | `copy.ts followUpRange` | import — call site name unchanged (layout-contract pin :233 green) | WIRED | :8 import, :340 call over `shortDate(line.firstTouchAt/lastTouchAt, report.timezone)`; page still computes nothing (import set: document, copy, format, period, tenant, repository, supabase) |

Plans 01–06 key links: unchanged (17/18 by tool + 1 by hand; 07-06's four by hand last pass, files untouched since).

### Data-Flow Trace (Level 4)

No data path was touched. The report page still renders every value from `forTenant().reports.byId → parseReportDocument`; `followUpRange` consumes the same frozen row fields it did before. The print status line renders one of two fixed strings from reducer state (no data source by design — it is operator feedback, hidden in print). The four wrapped tables render exactly the rows they did before; a wrapper `<div>` adds no data dependency.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Whole project type-checks / lints after 07-07 | `npx tsc --noEmit`; `npm run lint` | exit 0 / clean | ✓ PASS |
| Pure suites + the three layout/print/copy contracts | `npm test` (once) | 2,402 / 2,402; 39 remote-gate refusals only | ✓ PASS |
| The four suites 07-07 touched, in isolation | `npx vitest run …` (4 files) | 93 / 93 | ✓ PASS |
| No console page widens a 390px phone; wrapper inert at 1000px | `bash 07-06-harness/tables-check.sh` | RESULT: PASS (control-bare 620) | ✓ PASS |
| Source gate cannot be fooled by a commented-out wrapper | node one-liner replicating `uncommentedTsx` + both regexes | decoy FAIL / wrapped PASS | ✓ PASS |
| Print-button transition table incl. stale timer and never-dead button | `npx vitest run tests/print-feedback.test.ts` | 25 / 25 | ✓ PASS |
| Same-day Follow-ups collapse | `npx vitest run tests/reporting-copy.test.ts` | `the Follow-ups cell` 4 / 4 | ✓ PASS |
| G-07-1/2/3 regressions on real print engines and the nav | `run.sh`, `nav-check.sh` | both RESULT: PASS | ✓ PASS |
| Remote never-twice / versioning / concurrent-generate / cursor isolation / metric parity | not re-run — no relevant code changed since the last green full serialized run (108 files / 2,875) | — | ? SKIP (justified by the diff) |
| Deployed `/` at 390px on the phone; iPhone print press; `2 · 1 Aug` on the deployed fixture | cannot run here | — | ? SKIP → Human #1, #2 |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist. The phase's declared runnable checks are the three harness scripts (`tables-check.sh`, `nav-check.sh`, `run.sh`); all three were executed first-hand this session and exited 0.

### Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| RPT-01 | 07-01, 07-02, 07-03 | Won job after ≥1 sent touch in window = recovered (gross) beside conservative | ✓ SATISFIED | SC1 — untouched since the initial verification |
| RPT-02 | 07-01, 07-02, 07-04, 07-06, 07-07 | Per-client monthly report (web/PDF) with the six figures, fees, multiple | ✓ SATISFIED | SC2; PDF confirmed on both real engines (UAT 4, 5); print button hardened and same-day range fixed by 07-07; #26/#28 accepted rulings |
| RPT-03 | 07-02, 07-05, 07-06, 07-07 | Per-client first-touch-24h, reply, opt-out, human-edit rates, recovery multiple | ✓ SATISFIED | SC3; UAT test 3 confirmed the metric rows; the last console page that widened a phone (Clients on `/`) is wrapped and gated |
| Orphaned | — | REQUIREMENTS.md maps only RPT-01..03 to Phase 7 (all marked Complete) | none | all three claimed by plans; 07-07 declares `[RPT-02, RPT-03]` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| 13 files changed by 07-07 (added lines) | — | No TBD/FIXME/XXX/TODO/HACK/placeholder/console.log | — | none |
| `print-feedback.ts` | :86 | `return null` | ℹ️ Info | The documented `idle` state ("no line at all"), asserted by `renders no line at all when there is nothing to say` — not a stub |
| `07-07-PLAN.md` frontmatter | key_links | Prose `from:` values make `verify.key-links` unusable for this plan | ℹ️ Info | verified by hand |
| `07-07-SUMMARY.md` | Deviation 1 | The four wraps reindent 53–162 lines each where the plan expected "a handful"; `git diff -w` shows one wrapper + one comment per file | ℹ️ Info | readability choice, no behaviour change |
| `07-06-PLAN.md` | :145, :182 | Pre-review wording (`margin: -0.625rem 0`, `max-width: 10rem`, `n (d MMM–d MMM)`) superseded by the review fixes | ℹ️ Info | carried forward; planning artifact only |
| working tree (previous pass) | `07-06-harness/layout-contract.test.ts` | Staged deletion warned about last time | resolved | committed in `df0cb83`; README row gone |

### Deferred Items

None — `roadmap.analyze` shows no phase after 7 in this milestone. `deferred-items.md` and WINDOWS #23/#24 do not touch this goal.

### Human Verification Required

Four items in the frontmatter `human_verification` list. The two previous device items (#1 iPhone print backstop + #26/#28 rulings, #2 desktop Chrome print) are CLOSED by 07-UAT tests 4 and 5 and the accepted rulings; what remains:

1. **390px phone pass after the next deploy** — `/` (Clients), `/clients/[id]` (sync runs), `/audits`, the mapping step: `scrollWidth === 390`, each table scrolls inside its box, `Sign out` reachable; ≥1000px inert. Rule on the 176px/72px bar height while there.
2. **iPhone print press on the deployed fixture** — settled tap and immediate-on-reload tap: sheet, or `Opening print…` → fallback hint within ~2s; second tap works; the saved PDF carries neither string; Follow-ups same-day cells read `2 · 1 Aug`; desktop Chrome opens on the first click.
3. **06:30 digest actually delivered** (UAT test 7, pending).
4. ~~Fourteen judgment-tier prohibitions still unruled~~ — RATIFIED by the operator on 2026-09-05 at the v1.0 milestone audit (all must-NOT statements across 07-01..07-05 stand as held; 07-03 P3 ruled 2026-09-04, tenant uuid permitted).

### Gaps Summary

No gaps. G-07-6 is closed in code (four wrappers, no CSS change), gated at source with no allowlist, and re-proven here by running `tables-check.sh` through real headless Chrome — including its `control-bare` fixture that shows the probe can still see a 620px overflow — plus a synthetic falsification of the gate's own regexes. G-07-4's hardening is a pure reducer whose 25 tests were run first-hand, with the island's listeners, timer clearing, status role and print-hidden placement read in source and pinned by tests. The same-day Follow-ups collapse and the contract corrections are present exactly where the plan said. The 07-06 backstop that the previous pass abstained on is now confirmed by the operator's own iPhone and Chrome PDFs (UAT tests 4 and 5), and WINDOWS #26/#28 are accepted rulings rather than open questions. What remains is one honest backstop — the deployed console and the deployed print button on the operator's phone after the next deploy — plus the two operational items no UAT has reached. Status is `human_needed` because that list is non-empty; nothing failed.

---

_Verified: 2026-09-03T16:53:00Z_
_Verifier: Claude (gsd-verifier) — re-verification after 07-07_

## Post-verification changes (2026-09-04)

The verifier above ran against `61b7af1`. The scoped 07-07 code review (07-REVIEW.md) and its fix report (07-REVIEW-FIX.md) landed seven further commits (`8678233`..`52db4ab`): a second print success signal via `matchMedia('print')` (the review's CR-01 claim that WebKit lacks `beforeprint`/`afterprint` was refuted — caniuse `beforeafterprint`: iOS Safari 13+, WebKit r243762), a permanently mounted `role="status"` region, `prefetch={false}` on the report back link, `tabIndex`/`role`/`aria-label` on all nine `.table-scroll` boxes with a `:focus-visible` outline, a wider table gate over all of `src/app`, and import-pin regexes that catch side-effect and double-quoted imports. Presentation and tests only; no repository, schema, route or consumer code changed. Re-run after the fixes: `tsc` clean, lint clean, build compiled, `npm test` 2,407 passed / 0 assertion failures (39 remote-gated refusals), `tables-check.sh` RESULT: PASS. The human items above are unchanged.
