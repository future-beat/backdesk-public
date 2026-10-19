---
phase: 07-attribution-reporting
plan: 05
subsystem: ui
tags: [nextjs, drizzle, postgres, supabase, vitest, metrics, digest, rls, operator-console]

requires:
  - phase: 07-attribution-reporting
    provides: "07-01's tables on the hosted database (quote_attributions, monthly_reports, tenant_fees) and the seeders that write them; 07-02's TenantMetricCounts contract, computeTenantMetrics, sortForOverview, isOptOutAlarming, onboardedAt, feesInForce and the formatters; 07-03's attribution rows; 07-04's /reports/[client] page with its marked slot and its `← Reports` back link"
  - phase: 06-review-console-escalation
    provides: "requireOperator()/OPERATOR_DENIED_MESSAGE, the console nav and its no-service-role rule (A5), runStalledDigest's `sections` seam and buildStaleAttestationSection's NULL-not-empty rule, the escalations evidence family"
  - phase: 04-messaging-gateway
    provides: "send_ledger as the record of what was actually sent (claimed_at IS the sent moment) and suppressed_contacts as the Spam Act record — the two tables the opt-out rate divides"
  - phase: 03-cadence-engine
    provides: "the quote_status_events outbox and cadences_one_per_opened_event, which is what lets first-touch be derived from events rather than from cadence rows"
provides:
  - "forAllTenants_reportMetrics(window) — the thirteenth cross-tenant crossing: every client's rolling-window counts, sums, escalation latencies and fee rows in one read, with its containment argument written down and pinned"
  - "forTenant().metrics.windowCounts(window) — the tenant-pinned twin, bound to the cross-tenant read by a field-for-field equality test"
  - "/reports — the operator's instrument panel: five metrics per client, alarmed rows first, `above 5%` badges derived from the one threshold"
  - "The `Last 30 days` section on /reports/[client] — the same five plus escalation speed, each with its evidence counts and its null-denominator text, footnoted from the constants that produced it"
  - "buildOptOutSection — the one line the 06:30 digest gains for a drifting client, NULL when nobody is drifting"
  - "The `Reports` nav link and the `Reports & metrics →` pipeline link"
  - "A recorded, measured rule: never put more in-flight queries than getDb()'s pool has connections, or the transaction pooler deadlocks"
affects: [verification, ship, future-metrics-work, any-repository-read-that-uses-Promise-all]

actuals:
  tokens: 31600
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Cross-tenant metric reads: several small grouped statements joined in memory by tenant_id, run SEQUENTIALLY, never one fused outer-joined query"
    - "Correlated conditions as JOINs, never as raw `sql` EXISTS fragments — drizzle renders columns unqualified in single-table queries"
    - "Duplicated SQL bound by an equality test rather than shared through a module, when sharing would empty a reachability pin"

key-files:
  created:
    - "src/app/(console)/reports/page.tsx"
    - "src/core/reporting/opt-out-section.ts"
    - "tests/report-metrics.test.ts"
    - "tests/opt-out-section.test.ts"
  modified:
    - "src/db/repository/for-all-tenants.ts"
    - "src/db/repository/for-tenant.ts"
    - "src/db/repository/index.ts"
    - "src/db/repository/client.ts"
    - "src/app/(console)/reports/[client]/page.tsx"
    - "src/app/(console)/layout.tsx"
    - "src/app/(console)/clients/[id]/page.tsx"
    - "src/core/aging/stalled-digest.ts"
    - "tests/sync-upsert.test.ts"
    - "tests/stall-tick.test.ts"
    - "tests/lint-ban.test.ts"

key-decisions:
  - "The cross-tenant metric accessor runs its eight statements SEQUENTIALLY: more in-flight queries than the pool's five connections deadlocks against Supabase's transaction pooler, measured rather than theorised"
  - "First-touch is derived from quote_opened EVENTS joined to send_ledger, so the accessor references no quotes or cadences column and the Phase 6 cadence pins are untouched"
  - "The outbox pin widened from one cross-tenant read to two, with the D-18 argument recorded and the second reader's five event-column references pinned"
  - "suppressed_contacts became cross-tenant reachable — a recorded reversal — because the A6 numerator-subset rule is a join between two tenant-scoped tables"
  - "The per-tenant metric SQL is a deliberate duplicate of the cross-tenant SQL, bound by a field-for-field parity test, because sharing it through a module would empty the reachability pin that notices new cross-tenant reads"
  - "forAllTenants_reportMetrics joins tenants for the client name (U-10): both consumers are service-role by construction and the cron digest has no JWT"
  - "The digest's metrics read has its own try/catch: a failed metric costs the paragraph, never the stalled-draft roll-up the operator acts on every morning"

patterns-established:
  - "Pool-ceiling rule: repository callers keep Promise.all batches well under getDb()'s max, or run sequentially — recorded at the definition site in client.ts"
  - "Correlated-subquery rule: express correlation as a JOIN, because drizzle strips table qualification from sql-template columns in single-table queries"
  - "Metric cells show the value and the two numbers it came from; a null denominator shows `—` and its explanation, never 0% and never (0/0)"
  - "Digest sections are NULL when empty, ordered by urgency, and each risky read is wrapped so one failure cannot take the email down"

requirements-completed: [RPT-01, RPT-02, RPT-03]

coverage:
  - id: D1
    description: "forAllTenants_reportMetrics returns every client's rolling-window counts in one read, excluding pre-onboarding quotes and opt-outs from contacts never messaged, with no address, body or customer name in any select list"
    requirement: RPT-03
    verification:
      - kind: integration
        ref: "tests/report-metrics.test.ts#forAllTenants_reportMetrics counts the window (RPT-03, D-14..D-18)"
        status: pass
      - kind: unit
        ref: "tests/report-metrics.test.ts#the cross-tenant surface carries no customer data (T-7-23)"
        status: pass
      - kind: unit
        ref: "tests/sync-upsert.test.ts#keeps the cross-tenant surface to exactly thirteen named exports"
        status: pass
    human_judgment: false
  - id: D2
    description: "The /reports overview: five metrics per client over a rolling 30 days, alarmed rows first, `above 5%` badge, `—` + `no fees` for a null multiple, empty state and load-error copy"
    requirement: RPT-03
    verification:
      - kind: unit
        ref: "tests/stall-tick.test.ts#the opt-out alarm colours on ONE rule across all three surfaces (07-05)"
        status: pass
      - kind: other
        ref: "npm run build (route /reports server-rendered on demand)"
        status: pass
    human_judgment: true
    rationale: "Layout under a 390px viewport — sideways scroll inside .table-scroll, the badge sitting beside its number, the alarmed row first — is a visual judgement no assertion in this repo can make. Deferred to the end-of-phase human check the plan names."
  - id: D3
    description: "The per-client `Last 30 days` section: six metric rows with evidence counts, null-denominator text, the fee-schedule link, and a footnote interpolated from the constants and resolveBaseline"
    requirement: RPT-03
    verification:
      - kind: integration
        ref: "tests/report-metrics.test.ts#the two reads agree field for field (T-7-26, the E1 backstop)"
        status: pass
    human_judgment: true
    rationale: "That badge and evidence text wrap under the value rather than overflowing the grid column on a phone is a rendered-layout property; the numbers behind it are proven by the parity test."
  - id: D4
    description: "The 06:30 digest gains one closed-vocabulary line per client above the opt-out threshold, and changes no cadence, tenant or suppression"
    requirement: RPT-03
    verification:
      - kind: unit
        ref: "tests/opt-out-section.test.ts#buildOptOutSection (D-16)"
        status: pass
      - kind: integration
        ref: "tests/stall-tick.test.ts#the opt-out alarm reaches the 06:30 digest and changes nothing (D-16)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The `Reports` nav link and the `Reports & metrics →` pipeline link, neither of which reads a count"
    requirement: RPT-03
    verification:
      - kind: unit
        ref: "tests/stall-tick.test.ts#the layout builds no service-role client (source assertion)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-02
status: complete
---

# Phase 7 Plan 05: Live Instrumentation Summary

**Every client's five service-level metrics now compute once and appear on two screens and in one morning email that cannot disagree with each other — because all three call the same pure functions over one contract, and a field-for-field parity test says so.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-09-02T07:15Z
- **Completed:** 2026-09-02T08:11Z
- **Tasks:** 3 of 3
- **Files modified:** 15 (4 created, 11 modified)

## Accomplishments

- **`/reports` exists.** One operator-gated screen, one round trip, every client's first-touch-within-24h rate, reply rate, opt-out rate, human-edit rate and recovery multiple over a rolling 30 days — alarmed rows first, each cell carrying the two numbers behind its percentage. The `← Reports` back link 07-04 shipped now goes somewhere, and the nav window recorded in `.planning/WINDOWS.md` is closed.
- **The numbers cannot disagree.** `forAllTenants_reportMetrics` and `forTenant().metrics.windowCounts` are deliberate duplicates of the same eight statements; `tests/report-metrics.test.ts` asserts their results are equal field for field for two seeded tenants. Both feed the single `computeTenantMetrics`.
- **The exclusions are the product, and they are proven.** A quote opened before a client had approved wording and attested is excluded from first-touch (D-18); a suppression for an address we never messaged is excluded from the opt-out rate (A6). Both are asserted against the real database with fixtures built around exactly those cases.
- **The alarm nags and never stops anything.** One `isOptOutAlarming`, one `OPT_OUT_ALARM_BP`, three surfaces: the overview badge, the detail badge and the digest heading. A remote test proves that running the digest for an alarmed client leaves its cadence row and its suppression count byte-identical.
- **A latent production deadlock was found and written down.** Firing more concurrent queries than `getDb()`'s five connections hangs against Supabase's transaction pooler — the first burst succeeds and every later one stalls until the statement timeout. It is now a documented ceiling at the pool's definition site, not a trap for the next author.

## Task Commits

1. **Task 1 (tracer): `/reports` overview end-to-end** — `daac276` (feat)
2. **Task 2: the per-client `Last 30 days` section and the parity proof** — `a38df25` (feat)
3. **Task 3: the opt-out digest line** — `77059be` (feat)

## Files Created/Modified

**Created**
- `src/app/(console)/reports/page.tsx` — the cross-client overview: `requireOperator()` → accessor → `computeTenantMetrics` → `sortForOverview` → one table inside `.table-scroll`.
- `src/core/reporting/opt-out-section.ts` — `buildOptOutSection(rows)`, the digest's one new paragraph.
- `tests/report-metrics.test.ts` — the remote proof: two seeded tenants, the exclusions, the parity, the privacy assertions.
- `tests/opt-out-section.test.ts` — the pure proof: byte-verbatim lines, NULL when nobody is alarmed, closed vocabulary.

**Modified**
- `src/db/repository/for-all-tenants.ts` — `forAllTenants_reportMetrics` at the end of the file, plus the header paragraph recording why the crossing exists and what bounds it.
- `src/db/repository/for-tenant.ts` — the `metrics.windowCounts` namespace, tenant-pinned.
- `src/db/repository/index.ts` — the annotated barrel line.
- `src/db/repository/client.ts` — the pool-ceiling rule, recorded where the pool is created.
- `src/app/(console)/reports/[client]/page.tsx` — the `Last 30 days` section, the footnote, `id="fee-schedule"` on the disclosure.
- `src/app/(console)/layout.tsx` — the `Reports` nav link, no badge.
- `src/app/(console)/clients/[id]/page.tsx` — one `Reports & metrics →` line.
- `src/core/aging/stalled-digest.ts` — `defaultSections()`, with the metrics read behind its own try/catch.
- `tests/sync-upsert.test.ts` — the ratified pins: 13 exports, 17 tables, two outbox reads, the second reader's event columns.
- `tests/stall-tick.test.ts` — the digest composition tests and the three-surface one-threshold assertion.
- `tests/lint-ban.test.ts` — the barrel key pin.

## Decisions Made

- **Sequential statements, not `Promise.all`.** See the deviation below; the accessor's own header carries the argument.
- **First-touch from events, not cadences.** The D-18 derivation reads `quote_status_events` and joins `send_ledger`, so the accessor names no cadence or quote column and the Phase 6 cadence pins (nine refs, one read, two joins) still hold unchanged.
- **The duplicated SQL stays duplicated.** Sharing the eight statements through a module both repository files import would have emptied `for-all-tenants.ts`'s schema import block — which is exactly what `tests/sync-upsert.test.ts` treats as the file's reachability surface. Two readable copies and one equality test beat one copy and a tripwire that has quietly stopped working.
- **`U-10` followed as planned:** the accessor joins `tenants` for the client name, because the cron digest holds no JWT and a second name-bearing export would have widened the crossing count to say the same thing twice.
- **The digest's byte-verbatim test now passes `sections: []`.** That override exists for this purpose (06-04's own header says so). With two shared-database reads in the default composition, an expected body built from the tally alone could only match on a morning when nobody else's fixtures happened to be drifting.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Correlated subqueries written as raw `sql` fragments compiled to always-true predicates**

- **Found during:** Task 1
- **Issue:** The reply and opt-out counts were first written as `count(...) FILTER (WHERE EXISTS (SELECT 1 FROM inbound_messages WHERE ${inboundMessages.tenantId} = ${sendLedger.tenantId} ...))`. Drizzle renders EVERY column inside a `sql` template **unqualified** when the query has a single table, so the emitted SQL was `WHERE tenant_id = tenant_id AND cadence_id = cadence_id` — true for every row. The counts would have been silently wrong (and non-zero, so a naive test would have passed).
- **Fix:** Both correlated reads became JOINs, whose ON clauses drizzle qualifies. The rule is recorded in the accessor's header and in the `metrics` namespace's.
- **Files modified:** `src/db/repository/for-all-tenants.ts`, `src/db/repository/for-tenant.ts`
- **Verification:** `tests/report-metrics.test.ts` asserts `cadencesReplied` is 1 for the tenant with a reply and **0** for the tenant without — the assertion the broken form could not have passed.
- **Committed in:** `daac276`

**2. [Rule 1 — Bug] Raw `Date` values interpolated into `sql` templates crash postgres.js**

- **Found during:** Task 1
- **Issue:** `${window.start}` inside a `sql` template reaches the driver as a `Date` object rather than a serialized timestamp — `TypeError: The "string" argument must be … Received an instance of Date`.
- **Fix:** Every window comparison now goes through drizzle's `gte`/`lte` helpers, which apply the column's driver mapping. No raw date reaches a template.
- **Files modified:** `src/db/repository/for-all-tenants.ts`
- **Verification:** the whole remote suite runs.
- **Committed in:** `daac276`

**3. [Rule 3 — Blocking] Eight concurrent statements deadlock against the transaction pooler**

- **Found during:** Task 1
- **Issue:** With the SQL fixed, the accessor still hung: the first call returned in ~600ms and every subsequent one stalled until Supabase's statement timeout fired. Isolated at the driver level — a burst of nine queries against a `max: 5` pool hangs deterministically on the second burst; the same burst with `max: 12`, or run sequentially, is fine. postgres.js pipelines the overflow onto connections PgBouncer has already handed to another transaction.
- **Fix:** the accessor and its per-tenant twin run their statements one at a time (~1s for eight indexed round trips to Sydney); the detail page keeps its existing three-read `Promise.all` and awaits the metrics read separately; the digest's two cross-tenant reads are sequential. The ceiling is documented at `getDb()`'s definition, because the next author to write `Promise.all` of six repository reads would have hit exactly this and seen "the database stopped answering".
- **Files modified:** `src/db/repository/for-all-tenants.ts`, `src/db/repository/for-tenant.ts`, `src/db/repository/client.ts`, `src/core/aging/stalled-digest.ts`, `src/app/(console)/reports/[client]/page.tsx`
- **Verification:** `npm run test:remote -- tests/report-metrics.test.ts tests/sync-upsert.test.ts tests/stall-tick.test.ts` — 61 passing, no timeouts.
- **Committed in:** `daac276`, `a38df25`, `77059be`

**4. [Rule 3 — Blocking] The outbox read pin fired, and was ratified rather than worked around**

- **Found during:** Task 1
- **Issue:** The plan stated only the export and table pins would change. `quote_status_events` was already an imported table, so the plan-checker did not see that D-18's first-touch denominator is a **second** `.from(quoteStatusEvents)` — which `tests/sync-upsert.test.ts` pinned at exactly one, and which the old rule also forbade joining.
- **Fix:** the pin now reads two, with the decision recorded in the file's established form (what it asks, why it has no tenant scope, what contains it), and a NEW containment assertion pins the second reader's five event-column references. The alternative — deriving first-touch from `cadences` — would have broken the stronger cadence pins.
- **Files modified:** `tests/sync-upsert.test.ts`
- **Verification:** the suite passes with both pins asserted.
- **Committed in:** `daac276`

**5. [Rule 2 — Missing critical] The barrel key pin needed the thirteenth crossing**

- **Found during:** Task 3 (`npm test`)
- **Issue:** `tests/lint-ban.test.ts` pins the exact set of names the repository barrel exports; a new crossing must be added there deliberately.
- **Fix:** added with its own decision comment.
- **Files modified:** `tests/lint-ban.test.ts`
- **Verification:** `npm test` — 2331 passing, zero assertion failures.
- **Committed in:** `77059be`

**6. [Rule 2 — Missing critical] `suppressed_contacts` reachability reversal recorded in prose as well as in the pin**

- **Found during:** Task 1
- **Issue:** `for-all-tenants.ts`'s header and `tests/sync-upsert.test.ts`'s failure message both named `suppressed_contacts` as a table that must stay per-tenant. Adding it to the set without rewriting those sentences would have left the file contradicting itself — the failure mode this codebase explicitly rejects.
- **Fix:** both rewritten, with the A6 argument for the reversal.
- **Files modified:** `src/db/repository/for-all-tenants.ts`, `tests/sync-upsert.test.ts`
- **Committed in:** `daac276`

### Minor departures from the plan's literal text

- **The privacy source assertion is per-line, not per-select-block.** The plan proposed asserting that no `.select({ … })` block contains `toAddress`. It must: `contactsTouched` is `count(DISTINCT (channel, to_address))`, and an aggregate is precisely what makes the address safe. The assertion instead requires that any line in a select block naming an address, body or contact column sits inside `count(DISTINCT` — plus the stronger behavioural check that the stringified result of a fixture full of phone numbers contains no `@` and no `+61`.
- **`buildOptOutSection(rows)` takes no `now`.** The plan's task action gives this signature; one `must_haves` artifact string says `(metrics, now)`. The window is already inside the counts, and a second description of it is how a line comes to say "30 days" over a fortnight's numbers. Documented in the module header.
- **The pipeline-page diff is 8 lines, not ≤4.** One `.meta` link plus the four-line comment explaining why the page only links. Nothing else on that page changed.
- **`tests/report-metrics.test.ts` does not carry the three-file one-threshold assertion** — it lives in `tests/stall-tick.test.ts` beside the existing `:511` assertion of the same shape, where the plan's Task 3 also asked for it. Writing it in both places would have been two copies of one rule.

---

**Total deviations:** 6 auto-fixed (2 × Rule 1 bugs, 2 × Rule 3 blocking, 2 × Rule 2 missing-critical) plus 4 minor departures recorded above.
**Impact on plan:** No scope creep. Two of the six were genuine correctness bugs that a less specific test would have shipped; one is a production hazard now documented for every future caller. Every plan artifact was delivered.

## Issues Encountered

The deadlock (deviation 3) cost the most time and was worth every minute: it presented as "the query hangs", the SQL was fast in isolation on both ports, and the tables involved held single-digit row counts. It was only identified by reproducing the burst pattern at the driver level and varying the pool size. The same trap sits under any future `Promise.all` of repository reads, which is why the finding lives in `client.ts` rather than only in this summary.

## Known Stubs

None. Every metric on both screens is wired to a real read; no placeholder text, no hardcoded empty collection, no "coming soon".

## Threat Flags

None. Every surface this plan added is covered by the plan's own threat register (T-7-23 through T-7-28); no new network endpoint, auth path or trust-boundary schema change was introduced.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 7 is complete: RPT-01 (attribution), RPT-02 (monthly reports) and RPT-03 (live instrumentation) are all delivered and marked complete in `REQUIREMENTS.md`.

Outstanding for the end-of-phase human check the plan names:

- `/reports` on a 390px phone: sideways scroll inside `.table-scroll`, `main` not widening, the alarmed client first with its badge beside the number.
- `/reports/[client]`: six metric rows, badge and evidence wrapping under the value, the `Recovery multiple` null text jumping to the fee disclosure.
- The printed monthly report (07-04's backstop) on a real device.

No blockers.

## Self-Check: PASSED

All four created files exist on disk; all three task commits (`daac276`, `a38df25`, `77059be`) are present in `git log`.

---
*Phase: 07-attribution-reporting*
*Completed: 2026-09-02*
