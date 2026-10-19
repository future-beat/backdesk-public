---
phase: 07-attribution-reporting
plan: 02
subsystem: api
tags: [attribution, reporting, zod, date-fns, tzdate, integer-cents, basis-points, pure-functions, vitest]

requires:
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: "The import-free audit constants module, computeBaseline's null-never-zero rule, integer-cents money parsing (parseMoneyToCents), the connect-time baseline columns on sm8_connections"
  - phase: 03-cadence-engine
    provides: "send_ledger (claimed_at, sender, outcome, delivery_status — no sent_at), the quote_status_events outbox and CADENCE_CONSUMER, the TZDate contact-window idiom"
  - phase: 04-messaging-gateway
    provides: "Real senders ('clicksend' / 'resend') and normalized DELIVERY_STATUSES, the STOP fan-out that forces the opt-out numerator restriction"
  - phase: 05-ai-drafting-classification
    provides: "touch_drafts.edit_distance semantics (NULL until approval, 0 = unchanged) — the D-17 denominator"
  - phase: 06-review-console-escalation
    provides: "escalations row shape, inbound_messages labels/isHot, the isAttestationStale one-predicate-two-surfaces precedent, the 32-code-point first-name cap"
provides:
  - "ATTRIBUTION_WINDOW_DAYS, DEFAULT_BASELINE_WIN_RATE, BASELINE_MIN_QUOTES, OPT_OUT_ALARM_RATE, FIRST_TOUCH_HOURS in the import-free constants module (now pinned to exactly eight exports)"
  - "ATTRIBUTION_CONSUMER = 'attribution' beside CADENCE_CONSUMER"
  - "decideAttribution — the whole attribution rule as one pure function (rows in, AttributionDecision out)"
  - "attributionEvidenceSchema + buildEvidence — the D-05 chain as a zod strictObject with no address/body/phone key at any depth"
  - "calendarMonth / currentMonth / previousMonth / rollingWindow / inPeriod / inRolling / localDaysIn in the tenant zone"
  - "feesInForce — append-only latest-wins fee schedule pro-rated by local day, one floor at the end"
  - "computeReportFigures — the report's headline numbers as integers or null"
  - "computeTenantMetrics, isOptOutAlarming, onboardedAt, sortForOverview, TenantMetricCounts"
  - "formatCents / formatRateBp / formatMultipleBp — the only division in the reporting path"
affects: [07-03-attribution-consumer, 07-04-report-generator, 07-05-instrumentation-pages]

actuals:
  tokens: 39827
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Rule modules are pure and framework-free; the consumer does IO and calls them"
    - "Integer cents and integer basis points end to end; the single division happens at display time"
    - "Money floors toward the client, diagnostics round — two rules, two files"
    - "null is a first-class answer meaning 'no denominator', returned before any division"
    - "Zone resolution confined to one module (TZDate), every stored instant UTC"

key-files:
  created:
    - src/core/attribution/qualify.ts
    - src/core/attribution/baseline.ts
    - src/core/attribution/money.ts
    - src/core/attribution/evidence.ts
    - src/core/attribution/decide.ts
    - src/core/reporting/period.ts
    - src/core/reporting/fees.ts
    - src/core/reporting/figures.ts
    - src/core/reporting/format.ts
    - src/core/reporting/metrics.ts
    - tests/attribution-qualify.test.ts
    - tests/attribution-baseline.test.ts
    - tests/attribution-decide.test.ts
    - tests/reporting-period.test.ts
    - tests/reporting-fees.test.ts
    - tests/reporting-figures.test.ts
    - tests/reporting-metrics.test.ts
  modified:
    - src/core/audit/constants.ts
    - src/core/cadence/constants.ts
    - tests/audit-aggregate.test.ts

key-decisions:
  - "Fee pro-rating accumulates over a common denominator of 28x29x30x31 so every day's contribution is an exact integer and a whole unchanged month collapses to precisely amountCents — per-day float division came out a cent short, which is the one discrepancy a client never forgives"
  - "hasMonthlyFeeInForce keys on the last LOCAL DAY the period covers rather than on period.end, so a rolling window ending mid-afternoon cannot report 'no fee schedule' for a period it is charging days against"
  - "computeTenantMetrics clamps the fee period to `now`, so a month-to-date view charges elapsed fees against elapsed revenue instead of a full month against a fortnight"
  - "LIVE_METRICS_WINDOW_DAYS is deliberately separate from ATTRIBUTION_WINDOW_DAYS despite holding the same 30 — fusing them would let a screen-tuning change silently rewrite the billing rule"
  - "The evidence chain's privacy boundary is defended twice and differently: strictObject stops an accidental runtime field, a recursive walk over the schema stops a deliberate review-time one"
  - "An unparseable total_invoice_amount is treated as valueSource 'missing' exactly like an absent quote row — never as a zero the report could quietly bill"

patterns-established:
  - "Constants module pinned by a source assertion to an exact export list AND to containing no `import` — the no-import rule stated as a test rather than a convention"
  - "Exact-integer pro-rating over a common denominator divisible by every month length, with exactly one floor, pinned by a source assertion counting Math.floor occurrences"
  - "Recursive zod schema key walk as a privacy test — fails on a forbidden key that is ADDED, not merely one this fixture populates"
  - "Both-sides-of-the-boundary testing for every threshold (30 days / +1ms, 24h / +1ms, 500bp / 499bp, half-open month to the millisecond)"
  - "Threshold literals live in exactly one derivation; the module that owns a predicate is source-asserted to contain no bare copy of its own number"

requirements-completed: [RPT-01, RPT-02, RPT-03]

coverage:
  - id: D1
    description: "The five Phase 7 constants live in the import-free audit constants module with A1/A2 surfaced as operator-confirmable; the module is pinned to exactly eight exports and to having no imports"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#exports exactly the eight named constants"
        status: pass
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#is a module with NO imports — stated as a test, not as a convention"
        status: pass
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#holds the deliberately HIGH default baseline and the Phase 7 thresholds"
        status: pass
    human_judgment: false
  - id: D2
    description: "The D-02 qualifying-touch predicate and the D-01 30-day window on claimed_at, inclusive at both edges"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/attribution-qualify.test.ts (13 tests, incl. exactly-30-days-inside / +1ms-outside and the pending-NULL receipt case)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Baseline resolution (connect vs deliberately-HIGH default, thin-sample floor) and the conservative haircut in integer basis points, floored toward the client"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/attribution-baseline.test.ts (17 tests, incl. DEFAULT_BASELINE_BP === 7000 and null-is-never-zero)"
        status: pass
    human_judgment: false
  - id: D4
    description: "decideAttribution end to end, and the evidence chain that carries no customer-identifying key at any depth"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/attribution-decide.test.ts#declares no key at any depth that could name a person or quote them"
        status: pass
      - kind: unit
        ref: "tests/attribution-decide.test.ts (17 tests, incl. the missing-mirror and unqualified paths)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Calendar months as half-open instants in the tenant's IANA zone, and the D-15 rolling window as a distinct instrument"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/reporting-period.test.ts (15 tests, incl. the Perth millisecond boundary, the Adelaide October DST month and a T23:30Z next-day-local instant)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The append-only fee schedule pro-rated by local day, collapsing to exactly amountCents for a whole unchanged month, with the setup fee on its own line and out of the denominator"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/reporting-fees.test.ts (15 tests, incl. the exact-collapse assertion in 28/29/30/31-day and DST months)"
        status: pass
    human_judgment: false
  - id: D7
    description: "computeReportFigures — integer-cent totals and integer-basis-point multiples, with null for an absent or $0.00 fee and a real 0 bp for a zero month"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/reporting-figures.test.ts (13 tests, incl. both multiple-floor fixtures and the four null/zero cases)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The five-plus-one instrumentation metrics through one derivation, with one alarm predicate, one onboarding-exclusion rule and one total order"
    requirement: RPT-03
    verification:
      - kind: unit
        ref: "tests/reporting-metrics.test.ts (35 tests, incl. the 500/499 pair, the exactly-24h pair and every null-denominator case)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The chosen values of DEFAULT_BASELINE_WIN_RATE (0.70) and BASELINE_MIN_QUOTES (10) — planner assumptions A1/A2, flagged in the doc comments as operator-confirmable before the first real report goes to a client"
    requirement: RPT-01
    verification: []
    human_judgment: true
    rationale: "These are commercial judgements, not code correctness. The tests pin that the constants are 0.70 and 10 and that everything derives from them; whether 0.70 is the right assumption to print in a client-facing footnote is the operator's call, and the research behind it is explicitly LOW confidence (a UK vendor band and an unverified AU aggregator figure)."

duration: 22min
completed: 2026-09-02
status: complete
---

# Phase 07 Plan 02: Attribution & Reporting Rules Summary

**Every rule the service bills a client on — what counts as a touch, how long the window is, how the baseline is chosen, how the haircut is taken, where a month begins, how a fee pro-rates, how a rate is computed and when it alarms — now exists exactly once, as a pure function or a named constant, provable on bare `npm test` with no database.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-09-02T12:05Z
- **Completed:** 2026-09-02T12:27Z
- **Tasks:** 3 of 3
- **Files modified:** 20 (17 created, 3 modified; 3,337 insertions)

## Accomplishments

- **`decideAttribution` is one pure function.** A won event, its ledger, quote, connection and reply evidence go in; a complete attribution row with a self-describing evidence chain comes out, or an honest `unqualified`. The consumer in 07-03 does IO and calls it; nothing downstream re-derives a rule, so the row, the report and the screen cannot disagree.
- **The evidence chain cannot leak a customer.** `attributionEvidenceSchema` is a zod `strictObject` at every depth, and `tests/attribution-decide.test.ts` walks the schema recursively and fails on any key matching `/address|mobile|phone|email|body|raw|from|to$/i`. The two defences are deliberately different in kind: `strictObject` stops a field added by accident at runtime, the walk stops one added on purpose at review time. This matters because the attribution row outlives the cadence, the touches and the retention rules that governed the rows it was copied from (T-7-07).
- **No float touches money.** Integer cents and integer basis points end to end, one `Math.round` at each float→int conversion, `Math.floor` toward the client at every rounding step, and guards that throw rather than repair. The single division in the whole reporting path is `cents / 100` in `format.ts`, at display time, on a value that is already final.
- **A month begins where the client is.** `calendarMonth` resolves through `TZDate`, is half-open to the millisecond, and is tested against Adelaide's October DST change — a zone bug is invisible in `Australia/Perth` and would surface the day the first eastern-states client signs.
- **Every metric returns `null`, never a fabricated rate.** The guard is structural: null is returned before any division happens, so the module contains no arithmetic sanity check at all — and the suite pins that it contains none.

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer): decideAttribution end-to-end** — `caa5d96` (feat)
2. **Task 2: Calendar months, fee pro-rating, report figures** — `2644891` (feat)
3. **Task 3: The five-plus-one instrumentation metrics** — `dde2630` (feat)

**Tracer feedback gate:** Task 1's `<verify>` was re-run end to end after its commit (4 suites / 74 tests, `tsc --noEmit`, `eslint`) before any expansion task began. It passed; execution continued.

## Files Created/Modified

**Constants (modified, append-only):**
- `src/core/audit/constants.ts` — five Phase 7 constants added beside the three audit ones, each with the "one line to change; figure and footnote derive from it" paragraph and, for `DEFAULT_BASELINE_WIN_RATE` / `BASELINE_MIN_QUOTES`, the A1/A2 operator-confirmable flag. Module header updated (it no longer describes "the three numbers").
- `src/core/cadence/constants.ts` — `ATTRIBUTION_CONSUMER = 'attribution'` directly under `CADENCE_CONSUMER`, documented as siblings that must never read each other's cursor.

**Attribution rules (created):**
- `src/core/attribution/qualify.ts` — `qualifiesAsTouch` (D-02) and `qualifyingTouches` (D-01). Documents the `IS DISTINCT FROM` SQL form beside the TypeScript predicate, and reads no timestamp other than `claimedAt`.
- `src/core/attribution/baseline.ts` — `DEFAULT_BASELINE_BP` and `resolveBaseline`. A null baseline is never a zero; the thin-sample fallback can only cost the service.
- `src/core/attribution/money.ts` — `conservativeCents`, `multipleBasisPoints`, `grossCentsFromNumeric`, `InvalidMoneyError`.
- `src/core/attribution/evidence.ts` — `attributionEvidenceSchema`, `buildEvidence`, plus `truncateCodePoints` and `firstNameOf` exported for the 07-04 generator to reuse the same rule.
- `src/core/attribution/decide.ts` — `decideAttribution`, `AttributionRowValues` (declared locally so this module stays free of the database layer and of 07-01's schema).

**Reporting (created):**
- `src/core/reporting/period.ts` — `calendarMonth`, `currentMonth`, `previousMonth`, `rollingWindow`, `inPeriod`, `inRolling`, `localDateString`, `daysInLocalMonth`, `periodStartDate`, `localDaysIn`.
- `src/core/reporting/fees.ts` — `monthlyFeeInForceOn`, `hasMonthlyFeeInForce`, `feesInForce`.
- `src/core/reporting/figures.ts` — `computeReportFigures`.
- `src/core/reporting/format.ts` — `formatCents`, `formatRateBp`, `formatMultipleBp`.
- `src/core/reporting/metrics.ts` — `rateBasisPoints`, `LIVE_METRICS_WINDOW_DAYS`, `OPT_OUT_ALARM_BP`, `isOptOutAlarming`, `FIRST_TOUCH_MS`, `withinFirstTouchWindow`, `onboardedAt`, `TenantMetricCounts`, the five rate functions, `meanEditDistanceBp`, `recoveryMultiple`, `escalationSpeed`, `computeTenantMetrics`, `sortForOverview`.

**Tests (created / modified):** `tests/attribution-{qualify,baseline,decide}.test.ts`, `tests/reporting-{period,fees,figures,metrics}.test.ts`, and `tests/audit-aggregate.test.ts` extended to pin eight constants, their values, and the no-import rule. 108 new tests.

## Decisions Made

1. **Exact-integer fee pro-rating over a common denominator.** The plan specified accumulating `amountCents × 10_000 / daysInMonth` and flooring once. Implemented as written that would have failed the plan's own primary assertion: summing thirty float quotients of `997_000_000 / 30` lands at `996_999_999.9999999`, so a whole unchanged month at $297.00 comes out as **$296.99**. Every day's contribution is instead scaled by `SCALE / daysInMonth` where `SCALE = 28 × 29 × 30 × 31` — an integer for every possible month length — so the accumulation is exact and the collapse to `amountCents` holds in 28-, 29-, 30-, 31-day and DST months. Still exactly one `Math.floor`, at the end.

2. **`hasMonthlyFeeInForce` keys on the last covered local day, not on `period.end`.** The planned form (`effectiveFrom < localDateString(period.end)`) is correct for a calendar month but wrong for a rolling window ending mid-afternoon: a fee effective that same day would be excluded by the predicate while the pro-rating loop charged a day against it, producing a report whose "no fee schedule" line contradicts its own arithmetic.

3. **`computeTenantMetrics`'s `now` parameter clamps the fee period.** The plan's signature took `now` without assigning it work. Rather than drop it or leave it unused, it now bounds the fee period so an unfinished period never charges days that have not happened — a month-to-date view charges elapsed fees against elapsed revenue. A no-op for the D-15 rolling window, which already ends at `now`.

4. **Setup-fee containment bounded by the days actually covered**, so the setup line and the pro-rated line describe the same stretch of calendar.

5. **`LIVE_METRICS_WINDOW_DAYS` kept separate from `ATTRIBUTION_WINDOW_DAYS`** even though both are 30. They answer different questions ("how long after a touch does a win still count" vs "how far back does this screen look"); fusing them would let a screen-tuning change silently rewrite the billing rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fee pro-rating would have been a cent short for a whole unchanged month**
- **Found during:** Task 2 (fee pro-rating)
- **Issue:** The plan's literal accumulation (`amountCents × 10_000 / daysInMonth` per day, floor once) accumulates float error. At $297.00 over 30 days the sum reaches `996_999_999.9999999`, and the final floor yields 29,699 cents — one cent under the client's actual invoice. The plan's own first acceptance criterion ("a month with one row in force every day collapses to exactly `amountCents`") would have failed.
- **Fix:** Accumulate over `SCALE = 28 × 29 × 30 × 31`, which is divisible by every possible month length, so each day's term is an exact integer. Identical semantics, exact arithmetic, still one floor.
- **Files modified:** `src/core/reporting/fees.ts`
- **Verification:** `tests/reporting-fees.test.ts` asserts the exact collapse in 28-, 29-, 30-, 31-day and Adelaide-DST months, and a source assertion pins `Math.floor` to a single occurrence.
- **Committed in:** `2644891`

**2. [Rule 1 - Bug] `hasMonthlyFeeInForce` could answer null for a period it was charging days against**
- **Found during:** Task 2 (fee pro-rating)
- **Issue:** Keyed on `localDateString(period.end)` with a strict `<`, a rolling window ending mid-afternoon would exclude a fee effective on its last day while `feesInForce` charged that day — `monthlyCents: null` alongside `daysCharged: 1`.
- **Fix:** Key on the last local day the period actually covers, with `<=`. Equivalent for calendar months, correct for rolling windows.
- **Files modified:** `src/core/reporting/fees.ts`
- **Verification:** `tests/reporting-fees.test.ts#does not answer "no fee schedule" for a month it is charging days against`
- **Committed in:** `2644891`

**3. [Rule 1 - Bug] A doc comment asserted a floating-point fact that is false**
- **Found during:** Task 1 (baseline module)
- **Issue:** The comment written for `DEFAULT_BASELINE_BP` claimed `0.7 * 10_000` is `7000.000000000001`. It is exactly `7000`. A comment that can be disproved by running one line is worse than no comment — and the codebase's own standard for this phase is that a document which can be shown to be wrong is the failure mode being designed against.
- **Fix:** Rewrote the rationale to the true and stronger one: `Math.round` is load-bearing for the EDIT rather than for today's value — `0.07 * 10_000` is `700.0000000000001` and `0.57 * 10_000` is `5699.999999999999`, and `DEFAULT_BASELINE_WIN_RATE` is explicitly flagged as operator-confirmable.
- **Files modified:** `src/core/attribution/baseline.ts`
- **Verification:** `tests/attribution-baseline.test.ts#rounds, because the constant is explicitly operator-confirmable` asserts the two inexact cases directly.
- **Committed in:** `caa5d96`

**4. [Rule 1 - Bug] Requirement completion marked prematurely, then reverted**
- **Found during:** State updates, after Task 3
- **Issue:** Following the standard state-update step, `requirements mark-complete RPT-01 RPT-02 RPT-03` (the IDs in this plan's frontmatter) flipped all three to `[x] / Complete` in `.planning/REQUIREMENTS.md`. All five plans in Phase 7 share those same three IDs, and three of them have not run. RPT-02 reads "Operator can generate a per-client monthly report" — that generator is 07-04 and does not exist. Leaving the mark would tell a milestone audit that a client-facing deliverable had shipped when nothing renders it.
- **Fix:** Reverted `.planning/REQUIREMENTS.md` to `Pending`. RPT-01/02/03 should be marked by the last plan in the phase, or by the phase verifier, once 07-03/04/05 have landed. This plan's contribution to all three is recorded in the `requirements-completed` and `coverage` frontmatter above, which is where per-plan traceability belongs.
- **Files modified:** `.planning/REQUIREMENTS.md` (reverted to its prior state — no net change)
- **Verification:** `grep -n "RPT-0" .planning/REQUIREMENTS.md` shows `[ ]` and `Pending` for all three.
- **Committed in:** n/a — the net change is zero, so the file is absent from the metadata commit.

---

**Total deviations:** 4 auto-fixed (4 × Rule 1 — bug). No Rule 4 (architectural) situations arose.
**Impact on plan:** All four were corrections to specified behaviour that would have failed the plan's own acceptance criteria, shipped a false statement, or overstated what has been delivered. No scope creep; no source file outside this plan's `files_modified` was touched.

## Deferred Items

Logged, not fixed (out of scope — pre-existing, in a file this plan does not own):

- `src/core/audit/aggregate.ts:88-98` carries the same false floating-point claim corrected in deviation 3 above (`0.15 * 10_000` is exactly `1500`, not `1500.0000000000002`). Comment-only; the code is correct. Recorded in `.planning/phases/07-attribution-reporting/deferred-items.md`.

## Issues Encountered

**`npm test` reports 35 failing test FILES.** All 35 fail identically at import time with `resolveTestEnv`'s "Refusing to run integration tests against a non-local Supabase" guard — the pre-existing environment gate requiring `ALLOW_REMOTE_TESTS=yes` (`npm run test:remote`). **Zero test assertions fail: 2,250 tests pass across the 65 pure suites.** None of the 35 gated files is touched by this plan. This plan is wave 1's pure-only plan by design and was explicitly instructed not to run the remote suite (plan 07-01 is paused at its Task 0 decision gate, so migration 0033 and the three new tables do not exist).

Verified that no gated suite can be broken by the two append-only edits: `tests/audit-aggregate.test.ts` is the only test in the repository that pins an export list from either constants module, it is pure, and it was updated. Every other consumer imports named values, which appending cannot affect.

## Known Stubs

None. No placeholder values, no skipped tests, no unrun `<verify>` blocks within this plan's scope.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change — every file in this plan is a pure, framework-free module with no IO. The plan's own `mitigate` dispositions are all discharged:

| Threat | Disposition | Where mitigated |
|---|---|---|
| T-7-07 (evidence chain leaking customer data) | mitigate | `attributionEvidenceSchema` strictObject at every depth + the recursive forbidden-key walk |
| T-7-08 (overstated credit via float money or rounding toward the service) | mitigate | Integer cents/bp throughout, `DEFAULT_BASELINE_BP === 7000` pinned, guards throw, fees floor once |
| T-7-09 (a figure and its footnote from different values) | mitigate | Eight-export pin + no-import pin; `windowDays` and `evidence.constants.attributionWindowDays` from one import |
| T-7-10 (`NaN` / `Infinity` reaching a page or digest) | mitigate | Null returned before any division; asserted per metric and per multiple |
| T-7-SC (package installs) | accept | No install performed — `@date-fns/tz` 1.5.0, `date-fns` 4.4.0, `zod` 4.4.3 were already present |

## Verification

- `npx vitest run` on all eight suites this plan owns or extends: **108 tests, all passing**
- `npm test` (bare, no database): **2,250 tests passing across 65 pure suites**; 35 database-backed files gated by the environment guard (see Issues Encountered)
- `npx tsc --noEmit`: exits 0
- `npm run lint` (`eslint . --max-warnings=0`): exits 0
- Every acceptance-criteria `grep` in all three tasks verified and matching

## User Setup Required

None — no external service configuration, no environment variables, no migrations.

## Next Phase Readiness

**Ready for 07-03 (attribution consumer).** It needs `ATTRIBUTION_CONSUMER`, `decideAttribution` and `LedgerTouchFields` (the exact ledger column set its evidence read must select — never `to_address`), plus the `attributions` table from 07-01. `AttributionRowValues` is a plain shape the consumer maps onto the `claim` insert, so no import crosses between the two wave-1 plans.

**Ready for 07-04 (report generator).** `computeReportFigures`, `calendarMonth` / `previousMonth` / `periodStartDate`, `feesInForce`, `formatCents` / `formatRateBp` / `formatMultipleBp`, and `truncateCodePoints` / `firstNameOf` for line rendering. The methodology footnote should interpolate from the stored row's `evidence.constants` and `evidence.baseline`, never from the live constants.

**Ready for 07-05 (instrumentation pages).** `TenantMetricCounts` is the contract both the cross-tenant accessor and `forTenant().metrics.windowCounts` must satisfy; `computeTenantMetrics`, `isOptOutAlarming`, `sortForOverview` and `LIVE_METRICS_WINDOW_DAYS` are the whole computation surface. 07-05 should add the source assertions that the two badge components and the digest section carry no threshold literal of their own.

**Concerns:**
- **A1/A2 remain operator assumptions.** `DEFAULT_BASELINE_WIN_RATE = 0.70` and `BASELINE_MIN_QUOTES = 10` are flagged in the doc comments and surfaced as coverage item D9. They should be confirmed before the first real report reaches a client — the research behind 0.70 is explicitly LOW confidence.
- **A3 (setup fee excluded from the multiple's denominator)** is implemented and footnote-ready but not yet operator-confirmed.
- **The A5 onboarding exclusion is a rule, not a query.** `onboardedAt` states the definition; 07-05 must supply `templatesFirstApprovedAt` and `firstAttestedAt` per tenant and apply the exclusion in the `quotesOpened` SQL.

---
*Phase: 07-attribution-reporting*
*Completed: 2026-09-02*

## Self-Check: PASSED

All 10 created source modules verified present on disk. All 3 task commit hashes (`caa5d96`, `2644891`, `dde2630`) verified present in `git log --all`. All acceptance-criteria greps re-run and matching.
