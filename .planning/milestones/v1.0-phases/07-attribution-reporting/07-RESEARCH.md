# Phase 7: Attribution & Reporting - Research

**Researched:** 2026-09-02
**Domain:** Evidence-chained revenue attribution over an append-only outbox; frozen versioned monthly reports; per-client instrumentation over existing evidence tables (TypeScript / drizzle / Supabase Postgres / Next.js 16 App Router)
**Confidence:** HIGH for everything grounded in the codebase (every column, vocabulary, index, test pin and module cited below was opened this session); LOW for the two external figures (industry quote-win-rate benchmarks) that feed one discretionary constant

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Attribution rule (RPT-01)
- **D-01:** **Attribution window = 30 days after the last qualifying sent touch.** A `won` event qualifies if the quote has at least one qualifying touch whose sent moment is within the 30 days before the win's detection. The window is anchored on the last SENT touch, never on cadence creation. Named constant (e.g. `ATTRIBUTION_WINDOW_DAYS`) in a no-import constants module, per the audit-constants precedent — the figure and the report's methodology footnote must derive from one value. — **Reversibility:** costly — every attribution row records the window it was computed under; changing the constant later means months computed under two rules, and frozen reports already sent under the old one.
- **D-02:** **A qualifying touch = a `send_ledger` row with a real provider (`sender <> 'stub'`), `outcome = 'sent'`, and `delivery_status` not `'undelivered'`.** Email touches count on `sent` (no receipt exists); an SMS with a pending receipt counts; an SMS the carrier reported undelivered does not. Only `outcome` and `delivery_status` are read — never a retry, never a re-send (Phase 4 D-07 stands).
- **D-03:** **The recovered dollar figure is `quotes.total_invoice_amount` snapshotted into the attribution row at attribution time and frozen.** A later ServiceM8 edit shows as a visible discrepancy against the mirror, never as a silent change to a report already sent. — **Reversibility:** one-way — frozen report lines and invoices reference the stored figure; recomputing from the live mirror would make a published document disagree with itself.
- **D-04:** **One quote is attributed at most once, ever.** The first qualifying win wins; later reopen→win cycles on the same quote, sequential cadences, and replayed events never produce a second row. Enforced by a unique index on the quote (the `send_ledger` / `escalations` never-twice shape: claim by `INSERT … ON CONFLICT DO NOTHING RETURNING`, zero rows is a meaningful answer). — **Reversibility:** one-way — the unique index IS the guarantee; relaxing it later means re-deciding every historical double-win by hand.
- **D-05:** **Every attribution row carries its evidence chain**: the qualifying ledger row ids (touch numbers + sent-at), any threaded inbound message ids (with label), the `quote_status_events.id` of the win, the escalation id if one fired, the cadence id(s), and the baseline + constants used. The chain must be reproducible from the row alone after the cadence is gone.

### Conservative net-of-baseline figure (RPT-01)
- **D-06:** **The connect-time baseline on `sm8_connections` is canonical** (`baseline_win_rate`, `baseline_quotes_issued`, window dates). It exists for every client from the same code path and window as the audit. If the client converted from a prospect and `prospects.baseline_win_rate` (via `tenants.prospect_id`) exists and differs, the report FOOTNOTES it for continuity with what they were sold on — it is never computed from.
- **D-07:** **Conservative value per job = gross value × (1 − baseline win rate).** Stored on the attribution row beside gross; sums cleanly; can never go negative. The report shows both figures on every line and both totals.
- **D-08:** **When the baseline is null (no pre-service history, or below a minimum-sample threshold), a named `DEFAULT_BASELINE_WIN_RATE` constant is used and the report footnotes that it was assumed.** The default is set deliberately HIGH — a high assumed baseline shrinks our credit, which is the conservative direction. Lives in the audit constants module beside `AUDIT_RECOVERY_RATE`. The exact value and the minimum-sample threshold are Claude's discretion, from research.
- **D-09:** **The baseline is frozen at connect and never refreshed.** "How were they doing before we arrived" is a one-time fact; any later window contains our own wins. Every month's report uses the same baseline, so months stay comparable.

### Report period, freezing & delivery (RPT-02)
- **D-10:** **Report period = calendar month in the client's IANA timezone. A win lands in the month its `won` event was DETECTED** (`quote_status_events.detected_at`), never ServiceM8's editable `work_order_date`. A July quote won on 3 August is August recovered revenue — "jobs won this month" stays literally true, and a closed month never changes.
- **D-11:** **Generating a report writes a frozen, versioned report row**: headline figures, per-job attribution lines, the baseline and every constant used, `generated_at`, and a version number. The page renders FROM the row, so the PDF stapled to an invoice is reproducible byte-for-byte. Re-generating creates version N+1 and keeps N. — **Reversibility:** one-way — a live-computed page cannot reproduce what a client was sent; once a frozen report has been handed over, its row is the record.
- **D-12:** **Delivery = a print-styled web page the operator prints to PDF and attaches to the invoice email themselves.** Reuse the audit page's A4 `@media print` pattern (`audit.css`): operator-only controls hidden in print, no interactive elements in the printed region. No system email, no client link, no PDF library this phase.
- **D-13:** **"Fees paid" comes from a per-tenant fee schedule** (monthly fee + one-off setup fee, each with an effective-from date, edited on the client page); the report reads the fee in force for that month. **Headline multiple = conservative recovered ÷ fees** (the 3× guarantee is measured conservatively); the gross multiple prints beside it.

### Instrumentation (RPT-03)
- **D-14:** **A new `/reports` console area.** `/reports` lists every client with the five metrics side by side (the "which client is drifting" screen); `/reports/[client]` shows the metrics, the evidence behind them, the list of monthly reports (all versions) and the Generate action. The Phase 6 pipeline page (`clients/[id]`) only LINKS to it — it is already the busiest screen.
- **D-15:** **Live metrics use a rolling 30-day window.** Monthly reports stay frozen calendar months; the two instruments are labelled as different on screen.
- **D-16:** **Opt-out rate = contacts suppressed in the window (STOP, email unsubscribe, or operator-confirmed soft opt-out — every `suppressed_contacts.source`) ÷ contacts with ≥1 qualifying sent touch in the window.** Labelled "opt-out rate" honestly — no complaint signal exists. **Above 5% the client row on `/reports` shows a red badge and the 06:30 digest carries one line.** No auto-pause: a metric nags, never stops a healthy client (Phase 6 D-15). The 5% threshold is a named constant.
- **D-17:** **Human-edit rate = share of drafts approved in the window with `edit_distance > 0`, with the mean normalized edit distance printed beside it.** V2-01's trigger is written as a share. Validator-forced edits count as edits.
- **D-18:** **Recommended defaults for the remaining metric definitions** (Claude may refine from research, not redefine): first-touch-within-24h = cadences whose touch 1 became a qualifying sent row within 24h of the `quote_opened` event's `detected_at`, over cadences opened in the window, EXCLUDING cadences born `paused('onboarding')` (the service was not yet responsible); reply rate = cadences with ≥1 `threaded` inbound reply ÷ cadences with ≥1 qualifying sent touch; recovery multiple = conservative attributed in the window ÷ fees in force for the window (pro-rated).

### Claude's Discretion
- **When attribution is computed**: as a `quote_status_events` consumer with its own cursor row (per the quote-events.ts contract, replay-safe via the D-04 index) vs. evaluated at report time. Must be idempotent and must not share the cadence engine's cursor.
- Attribution table name and shape; how the D-05 evidence chain is stored (jsonb summary vs. reference columns) — it must survive the cadence and touch rows being gone.
- Report row schema, per-job line content, and version semantics; report list ordering; whether "jobs won" in the report also shows total wins in the period (unattributed) as context beside attributed wins.
- Report and `/reports` page layout, print layout, badge visuals (UI hint: yes — `/gsd-ui-phase 7` can own the design contract; follow the audit page's print discipline).
- `DEFAULT_BASELINE_WIN_RATE` value and the minimum-sample threshold below which a real baseline is treated as null (D-08).
- Fee schedule schema (own table vs. `tenants` columns — note the `tenants` vs `cadence_settings` split precedent) and how the setup fee appears (own line; whether it enters the first month's multiple denominator).
- Whether to add an escalation-latency metric (median minutes from inbound `received_at` to `escalations.sent_at`) — the table was built to prove "within minutes"; cheap if the page has room.
- Where the >5% badge count is computed (RLS-scoped JWT read like the nav badge, per Phase 6 A5) and how the digest line rides the existing `stalled-digest` module.

### Deferred Ideas (OUT OF SCOPE)
- **System-sent report emails / tokenized client links** — V2-08 territory; revisit when manual PDF attachment becomes friction (D-12)
- **Operator-flagged "complaint" marker on inbound messages** — would separate a genuine complaint from a polite STOP; small inbox affordance, not needed for the opt-out rate (D-16)
- **Engagement-proven third figure** (wins preceded by a customer reply, no baseline math) — a possible extra line on the report once clients ask "which of these did you actually cause" (D-07)
- **Operator re-snapshot of the baseline** — only if a first connect provably captured a bad window (D-09)
- **Selectable instrumentation windows** (7/30/90) — if rolling 30 proves wrong for a metric (D-15)
- **Cross-client benchmarking in reports** — V2-04, ≥10 clients of data
- **Attribution "won inside 72h grace" question and AUDIT_RECOVERY_RATE confirmation** — Phase 2's flagged assumptions remain the operator's call before the first real audit; not changed here
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RPT-01 | A job won after ≥1 sent touch within the attribution window counts as recovered revenue (gross), reported alongside a conservative net-of-baseline figure | Pattern 1 (attribution consumer riding the cadence tick with its own `event_consumer_cursors` row), the D-02 predicate grounded in the real `send_ledger` columns (§ "The predicate, in column names"), the `claimed_at`-is-the-sent-moment finding, the basis-point conservative math (Code Examples), the baseline resolution rule (§ "Baseline resolution"), Pitfalls 1, 3, 6, 7, 8 |
| RPT-02 | Operator can generate a per-client monthly report (web/PDF): quotes chased, replies, jobs won, dollars recovered (gross + conservative), fees paid, multiple returned | Pattern 2 (frozen versioned `monthly_reports` row), Pattern 4 (fee schedule + pro-rating), calendar-month boundaries with the installed `@date-fns/tz` 1.5.0 / `date-fns` 4.4.0 (Code Examples), Pattern 5 (A4 print page cloned from `audit.css`), Pitfalls 4, 5, 9 |
| RPT-03 | System tracks per client: first-touch-within-24h rate, reply rate, opt-out/complaint rate, human-edit rate, and recovery multiple | Pattern 3 (metric definitions as pure functions over typed evidence snapshots; one grouped cross-tenant accessor for the overview), § "Metric definitions in column names", Pattern 6 (badge + digest line via the `DigestSection` seam), Pitfall 2 (the pinned cross-tenant surface), Pitfall 10 |
</phase_requirements>

## Summary

Phase 7 is a *read* phase over evidence the earlier phases deliberately preserved. Every predicate it needs is expressible over columns that already exist: `send_ledger.sender / outcome / delivery_status / claimed_at`, `quote_status_events.event_type / detected_at / id`, `inbound_messages.attribution / label / received_at`, `suppressed_contacts.source / created_at`, `touch_drafts.status / edit_distance / approved_at`, `escalations.sent_at`, `cadences.pause_reason / created_by_event_id`, and `sm8_connections.baseline_*`. No existing table changes. The phase adds three tables (an attribution ledger, a frozen monthly-report row, a per-tenant fee schedule), two constants in the no-import audit constants module, one new outbox consumer, two console routes and one print stylesheet — all in shapes the codebase has already established and pinned with tests.

The most consequential discretion call is **where attribution runs**. Recommendation: a second `quote_status_events` consumer, registered as its own `event_consumer_cursors` row (`'attribution'`), executed as one more pass inside the existing per-minute `runCadenceTick` — a clone of `consume-events.ts`'s register → scan-by-id → same-tenant-run transaction → advance-in-transaction structure, with the D-04 unique index doing the idempotency work. This costs no new bearer, cron job, env var or route; the price is three counts-only fields added to `CadenceTickResult` and to the route's enumerated body, which two pinned tests will force the executor to update deliberately (Pitfall 3). Computing at report time was rejected: D-05's evidence chain must survive the cadence and ledger rows being gone, and D-04's never-twice guarantee is only a fact if a row exists to be unique.

Two things the planner must know that the CONTEXT does not say: (1) `send_ledger` has **no `sent_at` column** — the sent moment for D-01/D-02 is `claimed_at` (the claim is written immediately before the provider call, and `outcome = 'sent'` is set after; a `sent` row's `claimed_at` is the honest send instant to within seconds); and (2) the repo's timezone library is `@date-fns/tz` 1.5.0 (the date-fns v4-native package, already used by `window.ts` / `followup.ts` / `normalize.ts`), **not** `date-fns-tz` as CLAUDE.md's stack table says — use `TZDate` + `startOfMonth`/`addMonths` and never install `date-fns-tz`.

**Primary recommendation:** Build attribution as an idempotent second outbox consumer with its own cursor riding the cadence tick, claim attribution rows through a unique index on `(tenant_id, quote_id)`, store the D-05 chain as a jsonb snapshot beside reference columns, freeze reports as versioned jsonb rows rendered by a print page cloned from `audit.css`, and express every metric as a pure function over typed evidence snapshots so the whole rule-set is provable on bare `npm test`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Attribution (won event → attribution row) | API / Backend (`src/core/attribution`, run inside the cadence tick) | Database (unique index = never-twice; cursor advance in the same transaction) | Replay is legal on the outbox; only Postgres can decide "at most once per quote" under overlapping ticks (the `send_ledger` / `escalations` argument, verbatim) |
| Baseline resolution (connect baseline → default fallback) | API / Backend (pure function in `src/core/attribution`) | Database (`sm8_connections.baseline_*`, `prospects.baseline_win_rate` read-only) | D-09: never rewritten; a pure resolver keeps "null vs thin vs default" one derivation |
| Monthly report generation (frozen row) | API / Backend (server action → core generator → `forTenant().reports.insertVersion`) | Database (unique `(tenant_id, period_start, version)` arbitrates concurrent generates) | D-11: the row IS the record; generation is a write, not a render |
| Report rendering / print-to-PDF | Frontend Server (RSC page renders FROM the row) | Browser (`@media print`, `@page A4`, operator's print dialog) | D-12: no PDF library; the browser is the PDF engine, as for the audit |
| Instrumentation overview (`/reports`) | Database (one grouped, counts-only cross-tenant accessor) | Frontend Server (`requireOperator()`-gated page) | Fifteen clients × five metrics must be one round trip each, not N+1 (the `stalledTally` shape) |
| Instrumentation detail (`/reports/[client]`) | API / Backend (`forTenant()` reads → pure metric functions) | Frontend Server | Tenant is known; RLS-scoped authorization read, service-role data read — the client-page pattern |
| Fee schedule editing | Frontend Server (server action on `clients/[id]`) | Database (append-only `tenant_fees`) | D-13: "edited on the client page"; append-only rows are the `tenant_attestations` precedent |
| >5% opt-out badge + digest line | API / Backend (`buildOptOutSection` on the `DigestSection` seam; badge from the same computed rates) | — | Phase 6 D-15: a metric nags, it never pauses; the section seam exists precisely for this |

## Standard Stack

### Core

No new packages. Everything below is already in `package.json` and already used the way this phase needs it.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 `[VERIFIED: package.json]` | Schema (`pgTable`, `pgPolicy`, `uniqueIndex`, `jsonb`, `numeric`), typed reads/writes, `ON CONFLICT DO NOTHING RETURNING` | Every evidence table in the repo is declared this way; migrations are generated then hand-finished |
| `postgres` (postgres.js) | 3.4.9 `[VERIFIED: package.json]` | Driver under drizzle | `numeric` columns arrive as **strings** through this driver (see `Baseline.winRate: string | null` `[VERIFIED: src/core/audit/aggregate.ts:55-69]`) — keep them strings until formatting |
| `@date-fns/tz` | 1.5.0 `[VERIFIED: package.json; node_modules/@date-fns/tz/package.json]` | `TZDate` + `tz()` for calendar-month boundaries in the tenant's IANA zone | Already imported by `src/core/cadence/window.ts:56`, `src/core/audit/followup.ts:34`, `src/core/servicem8/normalize.ts:35` `[VERIFIED: grep this session]` |
| `date-fns` | 4.4.0 `[VERIFIED: package.json]` | `startOfMonth`, `addMonths`, `subDays` with the v4 `in:` context option | `ContextOptions<DateType>.in?: ContextFn<DateType>` `[VERIFIED: node_modules/date-fns/types.d.ts:292-297]`; `startOfMonth.js`, `addMonths.js`, `endOfMonth.js` present `[VERIFIED: ls node_modules/date-fns]` |
| `zod` | 4.4.3 `[VERIFIED: package.json]` | Server-action input validation (period year/month, fee amounts, effective dates) | The house rule for every boundary |
| `next` | 16.3.2 `[VERIFIED: package.json]` | `/reports` and `/reports/[client]` RSC pages, server actions, per-page CSS import | `audits/[id]/page.tsx` imports `./audit.css` at page level `[VERIFIED: src/app/(console)/audits/[id]/page.tsx:9]` |
| `vitest` | 4.1.11 `[VERIFIED: package.json]` | Pure suites on `npm test`; serialized remote suites on `npm run test:remote` | `fileParallelism: false`, `globalSetup` pauses production cron `[VERIFIED: vitest.config.mts:14-46]` |
| `Intl.NumberFormat('en-AU', { currency: 'AUD' })` | runtime | Money display | The audit page's `formatMoney` (whole dollars for estimates) `[VERIFIED: src/app/(console)/audits/[id]/page.tsx:67-76]`; the report prints cents on invoice-grade figures (see Pattern 5) |

### Supporting (existing in-repo modules to reuse, not libraries)

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/core/servicem8/normalize.ts` `parseMoneyToCents` / `centsToNumeric` `[VERIFIED: :136-165]` | String-math money | Every gross/conservative/fee figure; never `Number(x) * rate` |
| `src/db/repository/consumer-cursor.ts` `registerConsumerCursor` `[VERIFIED: :46-69]` and `forTenant(id).consumerCursor.advanceTo(consumer, id)` `[VERIFIED: src/db/repository/for-tenant.ts:1437, 2894-2895]` | Cursor register / advance, consumer-name parameterised | The attribution consumer — no new cursor code |
| `forAllTenants_pendingQuoteEvents(afterId, limit)` `[VERIFIED: src/db/repository/for-all-tenants.ts:445-453]` | The outbox scan, cursor-agnostic | Reuse verbatim with the attribution cursor — no new cross-tenant export for the consumer |
| `src/core/audit/constants.ts` `[VERIFIED: full file]` | No-import constants module | `ATTRIBUTION_WINDOW_DAYS`, `DEFAULT_BASELINE_WIN_RATE`, `BASELINE_MIN_QUOTES`, `OPT_OUT_ALARM_RATE`, `FIRST_TOUCH_HOURS` join `AUDIT_RECOVERY_RATE`, `GRACE_PERIOD_DAYS`, `WINDOW_DAYS` |
| `src/core/alerts/stalled-drafts.ts` `DigestSection { heading; lines }` `[VERIFIED: :74-77]` + `runStalledDigest`'s `sections` seam `[VERIFIED: src/core/aging/stalled-digest.ts:81-97, 130-138]` | The 06:30 digest line | `buildOptOutSection(rates, now): DigestSection | null` beside `buildStaleAttestationSection` |
| `src/app/(console)/_auth.ts` `requireOperator()` `[VERIFIED: :52-72]` | Operator gate for cross-tenant service-role pages | `/reports` overview |
| `authorize(tenantId)` pattern in `src/app/(console)/clients/[id]/actions.ts` `[VERIFIED: :73-90]` | RLS-scoped tenant read with the operator's own JWT before a service-role write | Generate-report and fee-schedule actions |
| `src/app/(console)/audits/[id]/audit.css` `[VERIFIED: full file]` | A4 print discipline | Clone as `report.css` (Pattern 5) |
| `formatInTenantZone` `[VERIFIED: src/core/shared/tenant.ts:312-329]` | Zone-labelled display | Every timestamp on `/reports/[client]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Attribution pass inside `runCadenceTick` | Own `/api/internal/attribution-tick` route + 7th bearer + cron entry | Isolation, but adds `ATTRIBUTION_TICK_SECRET` to `serverEnvSchema`, `tests/helpers/env.ts` REQUIRED list, CI env, `scripts/apply-cron-schedules.mjs`, a route test clone — for a pass that makes zero external calls. Not worth it at MVP |
| jsonb evidence snapshot + reference columns | Pure reference columns / a child `attribution_evidence` table | References alone violate D-05 ("reproducible from the row alone after the cadence is gone") — ledger rows have no FK and survive, but a jsonb copy of the touch numbers, `claimed_at`s, labels and ids is what makes the row self-contained |
| Frozen jsonb report row | Normalised `monthly_report_lines` child table | Two tables to freeze and version; the report is a document, and a document is one row |
| Append-only `tenant_fees` rows with `effective_from` | Two columns on `tenants` | The `tenants` vs `cadence_settings` split precedent `[VERIFIED: src/db/schema/cadence-settings.ts:1-27]` says onboarding identity stays on `tenants` and subsystem config gets its own table; fees also need history (D-13 "in force for that month") which columns cannot hold |
| Browser print-to-PDF | `@react-pdf/renderer`, Puppeteer | Locked out by D-12; the audit already proves the print path |

**Installation:** none.

**Version verification:** performed by reading `package.json` and the installed `node_modules/@date-fns/tz/package.json` (`"version": "1.5.0"`) this session; nothing new is installed, so no registry lookup was needed.

## Package Legitimacy Audit

> This phase installs **no** external packages. Every dependency is already present in `package.json` and imported by earlier phases.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — | — | — | — | — | — | No installs this phase |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Do NOT add `date-fns-tz` (CLAUDE.md names it, but the repo standardised on `@date-fns/tz` in Phases 2–3 and three core modules import it).*

## Architecture Patterns

### System Architecture Diagram

```
ServiceM8 poll (Phase 2)                                  Operator (console)
        │                                                        │
        ▼                                                        │
  quotes upsert ──same tx──▶ quote_status_events (append-only outbox, bigserial id)
                                     │
                     ┌───────────────┴────────────────┐
                     ▼                                ▼
        cursor 'cadence-engine'               cursor 'attribution'   ◀── NEW (Pattern 1)
        (consume-events.ts, unchanged)        (src/core/attribution/consume-wins.ts)
                                                      │  for each event_type='won'
                                                      │  in a same-tenant run, one tx:
                                                      ▼
                                   ┌── send_ledger rows for (tenant_id, quote_id)
                                   │   sender<>'stub' AND outcome='sent'
                                   │   AND delivery_status IS DISTINCT FROM 'undelivered'
                                   │   AND claimed_at ∈ [detected_at − 30d, detected_at]
                                   │        │ none → not attributed (event still consumed)
                                   │        ▼ ≥1
                                   ├── quotes.total_invoice_amount (snapshot, D-03)
                                   ├── sm8_connections.baseline_* → resolveBaseline() → rate or DEFAULT
                                   ├── inbound_messages (threaded, same quote) → ids+labels
                                   ├── escalations (same quote) → id, sent_at
                                   └── cadences (same quote) → ids
                                                      │
                                                      ▼
                             INSERT quote_attributions … ON CONFLICT (tenant_id, quote_id) DO NOTHING RETURNING id
                             (zero rows = replay or second win: consumed, not recorded)
                                                      │
                                     advanceTo('attribution', lastEventIdOfRun)  ── same tx
                                                      │
        ┌─────────────────────────────────────────────┴───────────────────────────────┐
        ▼                                                                             ▼
  /reports/[client] "Generate <month>" (server action)                        /reports overview
        │ authorize(tenantId) via RLS read (operator JWT)                          │ requireOperator()
        ▼                                                                          ▼
  generateMonthlyReport(tenantId, period, now)                     forAllTenants_reportMetrics(window)
        │ month bounds = TZDate in tenants.timezone (D-10)                (counts only, grouped in SQL)
        │ reads: quote_attributions (detected_at in month),                       │
        │        send_ledger (chased), inbound (replies),                          ▼
        │        quote_status_events won (context), tenant_fees (in force)   pure computeMetrics()
        ▼                                                                          │
  INSERT monthly_reports (tenant_id, period_start, version = max+1, jsonb…)        ▼
        │  UNIQUE (tenant_id, period_start, version) arbitrates                >5% → badge row
        ▼                                                                    + buildOptOutSection()
  /reports/[client]/[reportId]  renders FROM the row                          → 06:30 digest line
        │  report.css  @media print / @page A4
        ▼
  operator prints to PDF → attaches to invoice (D-12)
```

### Recommended Project Structure

```
src/core/attribution/
├── constants.ts?            # NO — constants go in src/core/audit/constants.ts (D-01/D-08 say "the audit constants module")
├── qualify.ts               # PURE: qualifiesAsTouch(row), withinWindow(claimedAt, detectedAt), lastQualifying(rows)
├── baseline.ts              # PURE: resolveBaseline({winRate, quotesIssued}) → {rateBp, source:'connect'|'default'}
├── money.ts                 # PURE: conservativeCents(grossCents, rateBp) — integer basis points, floored
├── consume-wins.ts          # the consumer (clone of cadence/consume-events.ts structure; ATTRIBUTION_CONSUMER = 'attribution')
└── evidence.ts              # builds the D-05 jsonb chain from the reads; the zod schema of that chain
src/core/reporting/
├── period.ts                # PURE: calendarMonth(timezone, year, month) → {start, end} instants; rolling30(now)
├── fees.ts                  # PURE: feesInForce(rows, start, end, timezone) pro-rated by local day; setup-fee line
├── metrics.ts               # PURE: firstTouch24h(), replyRate(), optOutRate(), humanEditRate(), recoveryMultiple(), escalationLatency()
├── figures.ts               # PURE: computeReportFigures(attributions, chased, replies, wins, fees) — the report's numbers
├── generate.ts              # generateMonthlyReport(tenantId, {year, month}, now) → writes the frozen row via forTenant()
└── opt-out-section.ts       # buildOptOutSection(rates, now): DigestSection | null
src/db/schema/
├── quote-attributions.ts    # evidence family: tenant_id no FK, RLS in schema, authenticated SELECT only
├── monthly-reports.ts       # evidence family (frozen document): same rules
└── tenant-fees.ts           # config family: FK cascade like cadence_settings; append-only rows
src/db/migrations/00NN_phase7_reporting.sql   # ONE migration for the whole phase, hand-finished (grants + CHECKs)
src/db/repository/
├── for-tenant.ts            # + attributions.{claim,listForPeriod,byQuote}, reports.{insertVersion,list,byId}, fees.{append,list},
│                            #   ledger.listForQuote, inbound.listThreadedForQuote, escalations.listForQuote (see "Reads to add")
└── for-all-tenants.ts       # + forAllTenants_reportMetrics (12 → 13; ratify in tests/sync-upsert.test.ts)
src/app/(console)/reports/
├── page.tsx                 # overview (requireOperator + service-role accessor; names via operator JWT)
├── [client]/page.tsx        # detail: metrics, evidence, report versions, Generate form
├── [client]/actions.ts      # generateReportAction (authorize(tenantId) first)
├── [client]/[reportId]/page.tsx  # the printable document, renders FROM the row
└── [client]/[reportId]/report.css
src/app/(console)/clients/[id]/  # + fee-schedule-form.tsx + appendFeeAction; + link to /reports/[client]
src/core/cadence/run-tick.ts     # + runAttributionPass → 3 counts on CadenceTickResult
src/app/api/internal/cadence-tick/route.ts  # + the 3 enumerated fields
```

### The predicate, in column names (D-01 / D-02)

Verbatim vocabularies this phase reads (all opened this session):

- `send_ledger`: `SEND_LEDGER_OUTCOMES = ['stub_sent', 'sent', 'failed']`; `DELIVERY_STATUSES = ['delivered', 'undelivered', 'unknown']`; `sender` is `'stub'` now, `'clicksend' / 'resend'` from Phase 4; columns `id, tenant_id, cadence_id, quote_id, touch_number, channel, to_address, sender, outcome, provider_message_id, claimed_at, delivery_status, delivery_detail, delivered_at, delivery_updated_at` `[VERIFIED: src/db/schema/send-ledger.ts:102-123, 125-202]`. **There is no `sent_at`.** `claimed_at` is "when the claim was won — i.e. when this row came into existence" `[VERIFIED: :155-156]`, written before the provider call; `outcome` is set after. → **The D-01 "sent moment" is `claimed_at` of a row with `outcome = 'sent'`.** Record this in the methodology text as "sent (claimed) at".
- Qualifying touch: `sender <> 'stub' AND outcome = 'sent' AND delivery_status IS DISTINCT FROM 'undelivered'` — `NULL` (no receipt yet) and `'delivered'` and `'unknown'` all qualify per D-02's "an SMS with a pending receipt counts". Use `IS DISTINCT FROM`, not `<>`: `delivery_status <> 'undelivered'` is NULL-false for every email and every pending SMS.
- Window: `claimed_at >= detected_at − ATTRIBUTION_WINDOW_DAYS·24h AND claimed_at <= detected_at`, where `detected_at` is the `won` event's `detected_at` (`notNull().defaultNow()` `[VERIFIED: src/db/schema/quote-events.ts:145]`), never `occurred_at` (nullable, "can move BACKWARDS relative to detection" `[VERIFIED: :25-29, 131-139]`). Elapsed milliseconds, not calendar days — the audit's `auditWindow` reasoning `[VERIFIED: src/core/audit/aggregate.ts:102-112]`.
- Win: `event_type = 'won'` covers both `Quote → Work Order` and `Quote → Completed` `[VERIFIED: src/db/schema/quote-events.ts:87-102]`; `QUOTE_EVENT_TYPES = ['quote_opened', 'won', 'lost', 'reopened', 'removed']`.
- Stop reasons available for the evidence chain / context: `CADENCE_STOP_REASONS = ['won', 'lost', 'removed', 'reopened', 'contact_suppressed', 'operator_closed', 'no_contact', 'mirror_missing']` `[VERIFIED: src/db/schema/cadences.ts:265-274]`. Attribution keys on the outbox `won` event, not on `cadences.stop_reason` — the cadence engine may be head-of-line blocked and not yet have stopped the cadence when the attribution consumer sees the win. `stop_reason` goes into the chain as context.
- `send_ledger` index: only `(tenant_id, claimed_at)` and the unique `(cadence_id, touch_number)` `[VERIFIED: :203-208]`. A per-quote read filters by `tenant_id` (index prefix) then `quote_id`; at founding-cohort volume that is fine. Optional: add `send_ledger_tenant_quote_idx (tenant_id, quote_id)` in the phase migration — cheap, and it is the read the report also makes.

### Baseline resolution (D-06 / D-08 / D-09)

- `sm8_connections.baseline_win_rate numeric(5,4) | null`, `baseline_quotes_issued integer | null`, `baseline_window_start/end date`, `baseline_computed_at` `[VERIFIED: src/db/schema/sm8-connections.ts:85-90]`. Written once in `connectServiceM8` from `computeBaseline` `[VERIFIED: src/core/sync/connect.ts:176-244]`; `computeBaseline` returns `winRate: null` when `quotesIssued === 0`, formatted to exactly four decimals `[VERIFIED: src/core/audit/aggregate.ts:229-251]`.
- Prospect footnote: `tenants.prospect_id` → `prospects.baseline_win_rate numeric(5,4)` `[VERIFIED: src/db/schema/tenants.ts:64; src/db/schema/prospects.ts:148]`. Read-only, footnote only (D-06).
- Resolver (pure): `resolveBaseline({ winRate, quotesIssued })` → `{ rateBp: number; source: 'connect' | 'default'; sampleSize: number | null }` where `source = 'default'` when `winRate === null` OR `quotesIssued < BASELINE_MIN_QUOTES`. Convert the numeric string to basis points with `Math.round(Number(winRate) * 10_000)` exactly as `RECOVERY_RATE_BASIS_POINTS` does `[VERIFIED: src/core/audit/aggregate.ts:88-98]` — the ONE float→int step, then integer math.
- Conservative cents: `Math.floor(grossCents * (10_000 − rateBp) / 10_000)` — floored, "the half-cent always falls in the client's favour" (the audit's rule `[VERIFIED: :207-214]`). Never negative because `rateBp ≤ 10_000`.

**`DEFAULT_BASELINE_WIN_RATE` recommendation: `0.70`** `[ASSUMED]` and **`BASELINE_MIN_QUOTES = 10`** `[ASSUMED]`. Reasoning, with the sources found this session:
- A UK quoting-tool vendor's published guidance puts a "healthy" tradesperson win rate at **30–50%**, calls >60% a sign of under-pricing `[CITED: quotesmith.co.uk/tools/win-rate-calculator.html — vendor guidance, undated, no external study]` (LOW confidence as a benchmark, but it is a published band).
- An AU aggregator snippet attributes to Tradify's 2026 AU Trades Report win rates of **87%** (plumbing/gas/HVAC) and **85%** (electrical/property maintenance/renovations) over 10,000+ businesses `[ASSUMED — WebSearch snippet only; the report landing page (tradifyhq.com/au/trades-report) and the GC News article (13 Feb 2026) were fetched and neither states the percentages; the PDF was not retrieved]`. Those figures, if real, are acceptance rates of quotes sent through an in-app accept flow and are the upper bound of anything a client could argue.
- D-08's direction is HIGH. `0.70` sits above the UK "underpricing" ceiling and within reach of the AU aggregator figures, so the footnote can say "we assumed you were already winning 70% of quotes — at or above published trade benchmarks — so our credit is understated". It shrinks credit to 30% of gross, which is punishing but only applies when a client has **no usable pre-service history**, a case the connect-time baseline makes rare.
- Minimum sample `10`: with n = 10 the 95% Wilson interval on p = 0.5 spans roughly ±0.28; below that the "baseline" is a coin-flip and the default (which is designed to be conservative) is the more honest yardstick. Ten quotes in 90 days is under one a week — a business that thin has no baseline to speak of. `[ASSUMED — standard binomial interval arithmetic; no client data yet]`.
- Both are one-line changes in the constants module, footnoted from the same value, and listed in the Assumptions Log for the operator to confirm before the first real report.

### Pattern 1: A second outbox consumer, riding the cadence tick

**What:** `consumeWonEvents({ batchLimit })` in `src/core/attribution/consume-wins.ts`, structurally a clone of `consumeQuoteEvents` `[VERIFIED: src/core/cadence/consume-events.ts:876-910 and header :9-33, 45-80]`:
1. `const cursor = await registerConsumerCursor(ATTRIBUTION_CONSUMER)` — `INSERT … ON CONFLICT DO NOTHING` then SELECT; brand-new consumer starts at 0 and re-reads all history, which is legal and idempotent by the D-04 index `[VERIFIED: src/db/repository/consumer-cursor.ts:46-69]`.
2. `forAllTenants_pendingQuoteEvents(cursor, batchLimit)` — ORDER BY id `[VERIFIED: for-all-tenants.ts:445-453]`.
3. Chunk into maximal same-tenant runs; for each run `forTenant(tenantId).transaction(async (tx) => { …; await tx.consumerCursor.advanceTo(ATTRIBUTION_CONSUMER, lastId); })` — the advance "refuses to move backwards" `[VERIFIED: consume-events.ts:33]`.
4. Head-of-line rule: a blocked run freezes the cursor; later tenants' runs still commit (their claims are zero-row no-ops on replay) but do not advance; the blocked tenant's later runs are skipped `[VERIFIED: consume-events.ts:60-80]`. Copy this verbatim — it is the reason one client's bad row cannot wedge fourteen.
5. Only `event_type = 'won'` does work; the other four types are consumed and advance the cursor. A `won` with no qualifying touch is consumed with no row (count it as `attributionsUnqualified`).
6. `ATTRIBUTION_CONSUMER = 'attribution'` lives in `src/core/attribution/constants.ts`? No — put the consumer name beside `CADENCE_CONSUMER` in `src/core/cadence/constants.ts` `[VERIFIED: consume-events.ts imports CADENCE_CONSUMER from there, :142]` so both names are visible in one file, and the D-01/D-08 figures stay in the audit constants module.

**When to use:** always for attribution. Report-time computation would leave D-05 with nothing after `cadence_touches` cascade-delete with a cadence (`cadence_touches.cadence_id` has `onDelete: 'cascade'` `[VERIFIED: src/db/schema/cadence-touches.ts:156-158]`) — the ledger survives, the touch row does not.

**Where it runs:** one more awaited pass in `runCadenceTick` after `consumeQuoteEvents` `[VERIFIED: src/core/cadence/run-tick.ts:923-941 — the pass order]`. Add three counts to `CadenceTickResult`: `attributionEventsConsumed`, `attributionsRecorded`, `attributionCursorAt` (a position, like `cursorAt`). Enumerate them by hand in the route body `[VERIFIED: src/app/api/internal/cadence-tick/route.ts:153-200 — "enumerated field by field rather than spread"]`. See Pitfall 3 for the two tests that pin this.

**Table shape — `quote_attributions`** (evidence family: `tenant_id` column, no FK, no cascade; RLS `has_tenant_access(tenant_id)` authored in schema; `authenticated` SELECT only; service-role writes `[VERIFIED: the rule restated in escalations.ts:12-25 and send-ledger.ts:41-46]`):

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id`, `quote_id`, `sm8_job_uuid` | uuid not null | denormalised like every evidence table |
| `won_event_id` | bigint not null | the `quote_status_events.id` (D-05); no FK (evidence rule) |
| `won_detected_at` | timestamptz not null | copied from the event — the D-10 month key; index `(tenant_id, won_detected_at)` |
| `last_touch_claimed_at`, `qualifying_touch_count` | timestamptz, smallint | the D-01 anchor and count, as columns for the report's per-line print |
| `gross_cents`, `conservative_cents` | bigint | integer cents (or `numeric(12,2)` strings — pick one; bigint avoids the string round-trip and the report row stores the formatted string anyway) |
| `value_source` | text CHECK IN ('mirror','missing') | D-03 snapshot provenance; `missing` when the quote row is gone (Pitfall 8) |
| `baseline_rate_bp`, `baseline_source`, `baseline_sample` | smallint, text CHECK IN ('connect','default'), integer | D-06/D-08 as used |
| `window_days` | smallint not null | the `ATTRIBUTION_WINDOW_DAYS` this row was computed under (D-01 reversibility) |
| `evidence` | jsonb not null | the D-05 chain snapshot (zod-schema'd; see `evidence.ts`): ledger `[ {id, touchNumber, channel, claimedAt, deliveryStatus} ]`, inbound `[ {id, receivedAt, label, isHot} ]`, escalations `[ {id, sentAt, outcome} ]`, cadences `[ {id, createdByEventId, stopReason} ]`, `generatedJobId`, `jobDescription` (truncated), `contactName` — **no bodies, no addresses** (T-2-02) |
| `attributed_at` | timestamptz default now() | |

Unique index: `quote_attributions_one_per_quote ON (tenant_id, quote_id)` — tenant-scoped because two tenants may hold the same job uuid (`quotes_tenant_job_uniq` argument `[VERIFIED: src/db/schema/quotes.ts:11-17, 135]`). Claim with targetless `.onConflictDoNothing().returning({ id })` — the cadence-create argument for targetless: a named arbiter turns a conflict on another index into 23505 inside the run transaction, which the consumer would read as a blocked run `[VERIFIED: src/db/schema/cadences.ts:95-101]`.

### Pattern 2: The frozen, versioned report row

**What:** `monthly_reports` (evidence family, no FK, RLS in schema, `authenticated` SELECT only):

| Column | Type | Note |
|---|---|---|
| `id` uuid pk; `tenant_id` uuid not null | | |
| `period_start` date, `period_end` date, `timezone` text | | local calendar dates + the zone they were computed in; `period_end` exclusive |
| `version` smallint not null | | `UNIQUE (tenant_id, period_start, version)` |
| `generated_at` timestamptz | | |
| `figures` jsonb | headline numbers as **strings of cents and counts**: quotesChased, replies, jobsWonAttributed, jobsWonTotal (context), grossCents, conservativeCents, feesCents (monthly + setup separately), multipleConservativeBp, multipleGrossBp | integers/strings only — never floats |
| `lines` jsonb | one entry per attribution row in the month: attributionId, generatedJobId, jobDescription, contactName, wonDetectedAt, touchCount, firstTouchAt, lastTouchAt, replyCount, replyLabels, grossCents, conservativeCents | the client-recognisable evidence; no bodies/addresses |
| `baseline` jsonb | rateBp, source, sampleSize, windowStart/End, prospectRateBp (footnote, may be null) | D-06 footnote input |
| `constants` jsonb | `{ attributionWindowDays, defaultBaselineWinRate, baselineMinQuotes }` | D-11 "every constant used" |
| `fees` jsonb | the `tenant_fees` rows in force + the pro-rating arithmetic inputs | reproducibility |

Version semantics: `INSERT … (version) SELECT COALESCE(MAX(version),0)+1 FROM monthly_reports WHERE tenant_id=$1 AND period_start=$2` in one statement inside `forTenant(id).transaction`; the unique index is the arbiter — a concurrent second Generate gets 23505, which the action maps to "A report for this month was just generated — reload to see it" (the `approveDraft` 23505-at-the-write precedent `[VERIFIED: src/db/schema/touch-drafts.ts:31-39]`). List ordering: newest `period_start` first, then `version` desc; every version stays visible (D-11). A report for the **current, unfinished** month is allowed but the page labels it "month to date (generated {date})" — the row is still frozen.

Page rule: `/reports/[client]/[reportId]/page.tsx` reads ONE row and renders it; it imports the constants module only to sanity-check that `constants.attributionWindowDays` in the row matches today's constant, and prints a screen-only warning if not (D-01 reversibility). It never recomputes a figure.

### Pattern 3: Metrics as pure functions over typed snapshots

**What:** every RPT-03 rate is `f(rows, window, now) → { numerator, denominator, rate: number | null }` in `src/core/reporting/metrics.ts`, with `rate = null` when `denominator === 0` (never `NaN`, never `0%` — the `computeBaseline` null-never-0 rule `[VERIFIED: aggregate.ts:239-241]`). The overview page gets its inputs from one grouped SQL accessor; the detail page from `forTenant()` reads. Both feed the same pure functions, so the two screens cannot disagree (the `deriveHealth` one-derivation argument `[VERIFIED: src/core/sync/health.ts:1-37]`).

**Metric definitions in column names** (D-16 / D-17 / D-18, refined only where the columns force it):

| Metric | Denominator | Numerator | Columns |
|---|---|---|---|
| First-touch-within-24h | cadences whose `created_by_event_id` → `quote_status_events.detected_at` ∈ window, excluding cadences whose **first** pause reason was `'onboarding'` | those with a qualifying `send_ledger` row `touch_number = 1` and `claimed_at ≤ detected_at + 24h` | `cadences.created_by_event_id` (nullable for pre-0021 rows — exclude nulls) `[VERIFIED: cadences.ts:315]`; `ONBOARDING_PAUSE_REASON = 'onboarding'` `[VERIFIED: :211]`. **Refinement:** "born paused('onboarding')" is not recoverable from `pause_reason` after the pause lifts (it is overwritten/cleared). Use the proxy "touch 1's ledger row does not exist AND the cadence's tenant had no approved template set at `anchor_at`"? Too indirect. **Recommend:** exclude cadences whose `anchor_at` precedes the tenant's earliest `message_templates.approved_at` for the set — or, simpler and honest, exclude cadences created while the onboarding gate was closed by reading `tenant_attestations` + `message_templates` at compute time. Planner should pick the simplest derivable rule and footnote it; flag as `[ASSUMED]` A5 |
| Reply rate | cadences with ≥1 qualifying sent touch in window (distinct `cadence_id` over qualifying ledger rows with `claimed_at` ∈ window) | of those, cadences with ≥1 `inbound_messages` row `attribution = 'threaded'` AND `cadence_id` matches AND `received_at` ∈ window | `INBOUND_ATTRIBUTIONS = ['threaded','ambiguous','unmatched','dead_letter']` `[VERIFIED: inbound-messages.ts:103-108]`; `tenant_id` nullable — always filter `tenant_id = $tenant` `[VERIFIED: :166]` |
| Opt-out rate | distinct `(channel, to_address)` over qualifying ledger rows with `claimed_at` ∈ window | `suppressed_contacts` rows with `created_at` ∈ window whose `(channel, address)` is in the denominator set — every `source` (`'operator_kill'`, `'sms_stop'`, and the email-unsubscribe / soft-opt-out sources Phases 4–6 added `[VERIFIED: suppressed-contacts.ts:97-103 — free-text `source`, no CHECK]`) | **Refinement within D-16:** restricting the numerator to addresses in the denominator keeps the rate a rate (numerator ⊆ denominator). The Phase 4 D-03 fan-out writes a bare STOP into **every** tenant's list; unrestricted, one stranger's STOP would push every client past 5% in the same minute. Ambiguous multi-tenant STOPs where both tenants messaged the number still count for both — which is what CONTEXT accepted. `[ASSUMED]` A6 |
| Human-edit rate | `touch_drafts` rows `status = 'approved'` AND `approved_at` ∈ window | those with `edit_distance > 0` (numeric string → `Number()` for the comparison and the mean only) | `DRAFT_STATUSES = ['generated','validator_failed','superseded','approved']`; `edit_distance numeric`, NULL until approval, 0 = unchanged `[VERIFIED: touch-drafts.ts:125-131, 228-234]`; at most one approved row per touch by `touch_drafts_one_approved_per_touch` `[VERIFIED: :254-256]` |
| Recovery multiple (live) | `feesInForce(tenant_fees, window)` pro-rated by local day (monthly fee only — see Pattern 4) | Σ `conservative_cents` of `quote_attributions` with `won_detected_at` ∈ window | null when fees = 0 (no schedule yet) — render "no fee schedule" not "∞" |
| Escalation latency (optional, cheap) | `escalations` rows with `outcome = 'sent'` AND `sent_at` ∈ window | median of `sent_at − inbound_messages.received_at` joined on `inbound_message_id` | `ESCALATION_OUTCOMES = ['sent','no_escalation_number','sms_not_configured','cooldown_suppressed']` `[VERIFIED: escalations.ts:108-113]`; provider refusals are UPPERCASE tokens, excluded by `= 'sent'` |

Rolling window: `[now − 30·24h, now]` in elapsed ms (the `auditWindow` reasoning). Calendar month: Pattern below / Code Examples.

**Cross-tenant accessor for the overview:** ONE new export, `forAllTenants_reportMetrics(windowStart: Date, now: Date): Promise<TenantMetricCounts[]>`, returning `{ tenantId, cadencesOpened, cadencesFirstTouch24h, cadencesTouched, cadencesReplied, contactsTouched, contactsOptedOut, draftsApproved, draftsEdited, editDistanceSum, conservativeCents, feesCents }` — **counts and sums only, grouped in SQL, no `tenants` join, no names, no addresses** (the `forAllTenants_stalledTally` containment argument `[VERIFIED: tests/sync-upsert.test.ts:498-640 — the ratification comment block]`). Names come through the operator's own JWT on the page, exactly as the inbox does `[VERIFIED: src/app/(console)/inbox/page.tsx:170-177]`. This is the deliberate 12 → 13 widening (Pitfall 2). If the planner prefers, implement it as several small grouped queries inside the one function — the export count is what is pinned, not the statement count.

### Pattern 4: Fee schedule

**What:** `tenant_fees` — config family (FK to `tenants` with `onDelete: 'cascade'` like `cadence_settings` `[VERIFIED: cadence-settings.ts:57-60]`; the frozen report copies what it used, so cascade loses nothing evidential). Append-only rows, the `tenant_attestations` shape ("RE-ATTESTATION IS A NEW ROW … latest wins; nothing is overwritten" `[VERIFIED: tenant-attestations.ts:19-31]`): `id, tenant_id, kind text CHECK IN ('monthly','setup'), amount_cents bigint (or numeric(12,2)), effective_from date, note text, created_at`. Index `(tenant_id, kind, effective_from DESC)`. `authenticated` SELECT only; the edit form is a server action through `forTenant(id).fees.append(...)` after `authorize(tenantId)`.

**Pure `feesInForce(rows, start, end, timezone)`:** for each local day in `[start, end)`, the monthly row with the greatest `effective_from ≤ day` is in force; daily rate = `amount_cents / daysInThatMonth`; sum, floored once. A month with one row and no change collapses to exactly `amount_cents`. Setup fee: rendered as its own line in the month containing its `effective_from`; **recommend excluding it from the multiple's denominator** and stating so in the footnote — the 3×-fees guarantee is quoted against the retainer, and a $990 setup line in month one would make every first-month multiple look like a failure `[ASSUMED]` A3 — operator to confirm. Seed the pricing from PROJECT.md (`$597` / `$997` retainer, `$990` setup, founding `$297`) as form placeholders only — never as defaults written without an operator action (the "no default contact window" rule).

### Pattern 5: The A4 print page, cloned from `audit.css`

**What:** `report.css` beside the page, page-level import (`import './report.css'`), with the print block copied verbatim and the selector list extended: forced light tokens, `@page { size: A4; margin: 14mm }`, `.nav, .report-actions, .report-backlink, button, form { display: none !important }`, `break-inside: avoid` on the figure grid, each line row, the method paragraph and the footer `[VERIFIED: audit.css:101-169]`. Multi-page is acceptable here (a month with 20 lines is two pages); keep the four headline figures + totals on page one and let the per-job table flow, with `thead { display: table-header-group }` so headers repeat.

Money on this document is **invoice-grade, so print cents** (`maximumFractionDigits: 2`) — the audit's whole-dollar rule is explicitly for *estimates* `[VERIFIED: audits/[id]/page.tsx:53-66]`; a recovered-revenue line is a real quote total. Period label: `new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone })` on `period_start`. Methodology footnote interpolates `constants.attributionWindowDays`, `baseline.rateBp / 100`, `baseline.source` ("assumed" wording when `'default'`), the prospect footnote when `baseline.prospectRateBp` differs, and "sent (claimed) at" — every number from the row, no literals (the D-09 audit rule `[VERIFIED: audits/[id]/page.tsx:204-214]`).

### Pattern 6: The >5% badge and the digest line

- `OPT_OUT_ALARM_RATE = 0.05` in the audit constants module; `isOptOutAlarming(rate)` pure, imported by the overview row badge AND `buildOptOutSection` — one threshold, two surfaces (the `isAttestationStale` argument `[VERIFIED: stalled-digest.ts:58-59]`).
- Badge: `/reports` is already a `requireOperator()` service-role page, so the badge is computed from the same `forAllTenants_reportMetrics` result — no second read path. (The nav-badge A5 JWT rule applies to the console **layout**, which any authenticated user renders; `/reports` is operator-gated, so service-role is correct there.) Do NOT add a nav-level opt-out badge in `layout.tsx`.
- Digest: `runStalledDigest` composes `sections` from `forAllTenants_latestAttestations` `[VERIFIED: stalled-digest.ts:130-138]`; add `buildOptOutSection(metrics, now)` producing `{ heading: 'Opt-out rate above 5%:', lines: ['<client>: 7.1% (3 of 42 contacts) in the last 30 days.'] }` or `null` when empty (the "NULL, not an empty section" rule `[VERIFIED: :73-76]`). Closed vocabulary: client name, integers, fixed words — no addresses. The digest still writes nothing (its header's invariant).

### Anti-Patterns to Avoid
- **Sharing or reading the cadence engine's cursor.** `'cadence-engine'` stays untouched; attribution has `'attribution'`. A held cadence cursor must not delay attribution and vice-versa.
- **Attributing on `cadences.stop_reason = 'won'`** instead of the outbox `won` event: the cadence may be blocked behind an unconsumed event; the outbox is the fact.
- **`delivery_status <> 'undelivered'`** — silently excludes every email and every pending SMS (NULL comparison). Use `IS DISTINCT FROM`.
- **Recomputing a report on view.** The page renders the row. A "regenerate" is a new version.
- **Float money anywhere** (`Number(total_invoice_amount) * 0.7`). Basis points and integer cents, one rounding step, floored toward the client.
- **`new Date(year, month, 1)`** for month boundaries — that is the Vercel function's zone (UTC), not the tenant's; a Perth win at 07:00 on 1 Sep would land in August.
- **A `.replace('_',' ')` label** for `suppressed_contacts.source` or `stop_reason` on screen — use a map, fail loudly on an unknown member (the house rule `[VERIFIED: inbox/page.tsx:62-82]`).
- **Selecting `body`, `to_address`, `from_address`, `raw_payload`** into any report row, page prop or tick response (T-2-02, T-6-21, T-3-24).
- **Writing `0` where the baseline is unknown.** `null` → default, footnoted.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar-month boundaries in an IANA zone | Offset arithmetic, `getTimezoneOffset()` tricks | `new TZDate(y, m, 1, tz)` + `addMonths` / `startOfMonth(now, { in: tz(zone) })` | Perth has no DST but Adelaide/Melbourne clients will; `TZDate` is what `window.ts` already trusts |
| At-most-once attribution under replay | check-then-insert | `UNIQUE (tenant_id, quote_id)` + `ON CONFLICT DO NOTHING RETURNING` | TOCTOU by construction otherwise — the ledger/escalations argument |
| Consumer registration / advance | new cursor table or ad-hoc row | `registerConsumerCursor` + `tx.consumerCursor.advanceTo` | Already consumer-name parameterised; two homes on purpose |
| Money parsing / formatting | `parseFloat`, `toFixed` | `parseMoneyToCents`, `centsToNumeric`, `Intl.NumberFormat('en-AU')` | The Phase 2 rule; `numeric` is a string from postgres.js and a number from PostgREST — format at the last moment only |
| PDF generation | `@react-pdf/renderer`, Puppeteer | Browser print via `@media print` (D-12) | Locked; the audit proves it |
| Outbox scan | new query | `forAllTenants_pendingQuoteEvents(afterId, limit)` | Cursor-agnostic already |
| Digest email | new mailer | `buildDailyDigest` `sections` seam | Empty-not-sent rule and closed vocabulary come for free |
| Operator authorization | new gate | `requireOperator()` (cross-tenant pages) / `authorize(tenantId)` RLS read (tenant actions) | Both are the pinned Phase 2/6 patterns |

**Key insight:** every hard guarantee in this phase (never-twice, advance-with-actions, evidence survives deletion, one threshold everywhere) already has a named precedent with a test behind it; the planner's job is to name the precedent per task, not to invent.

## Common Pitfalls

### Pitfall 1: `send_ledger` has no `sent_at`
**What goes wrong:** the plan says "sent moment" and the executor looks for a column that does not exist, or uses `delivered_at` (NULL for every email and undelivered SMS).
**Why it happens:** the schema records the claim and the provider's answer, not a send instant.
**How to avoid:** define the sent moment as `claimed_at` of a row with `outcome = 'sent'` `[VERIFIED: send-ledger.ts:155-156]`; say "sent (claimed) at" in the methodology footnote.
**Warning signs:** a predicate mentioning `delivered_at` or `delivery_updated_at` in a window test.

### Pitfall 2: The cross-tenant repository surface is pinned — twice
**What goes wrong:** adding `forAllTenants_reportMetrics` turns CI red in `tests/sync-upsert.test.ts` and nobody knows whether that is a leak or a decision.
**Why it happens:** quick task 260902-1x6 ratified the surface at **12 exports / 13 tables** and turned every widening into a typed decision `[VERIFIED: .planning/quick/260902-1x6-…/260902-1x6-SUMMARY.md; tests/sync-upsert.test.ts:498 `it('keeps the cross-tenant surface to exactly twelve named exports')`, :673 `it('reaches exactly thirteen tables from the cross-tenant file, and no more')`]`.
**How to avoid — exactly what a new cross-tenant read must update:**
1. `:498` block — add `'forAllTenants_reportMetrics'` to the `expected` array (12 → 13) AND a decision-record comment in the established form (what it asks, why it has no tenant scope, what contains it: counts/sums only, no `tenants` join, no address column, consumed only from the `requireOperator`-gated `/reports` page).
2. `:673` block — the schema import set: add `quoteAttributions`, `tenantFees`, `suppressedContacts`, `messageTemplates` (13 → 17 tables — 07-05 T1) with the same argument; `sendLedger`, `inboundMessages`, `touchDrafts`, `cadences`, `quoteStatusEvents` are already imported.
3. `:814` `quoteRefs` set — pinned at five `quotes.*` column refs; if the new accessor references `quotes.*` at all, extend the set deliberately (prefer not to: attribution rows carry `gross_cents` already).
4. `:842` `cadenceRefs` set (9 members) and `:888` `toHaveLength(2)` on `Join(cadences` — if the metrics accessor joins `cadences` (first-touch-24h needs `created_by_event_id`), that becomes 3 and the refs set grows; record it or compute first-touch from a ledger-only proxy.
5. The `ownersBody` slice is bounded `forAllTenants_ledgerOwners` → `forAllTenants_approvalQueue` `[VERIFIED: :661-668]`; place the new accessor **after** `forAllTenants_hotUnescalated` at end of file so no bounded slice moves.
6. `src/db/repository/index.ts` barrel line with its own comment `[VERIFIED: index.ts:38-83 — the annotated re-export list]`.
**Warning signs:** a plan task that adds the export without a companion task editing `tests/sync-upsert.test.ts`.

### Pitfall 3: `CadenceTickResult` is pinned as a 37-field literal, and the route's key set is pinned too
**What goes wrong:** three new attribution counts make `tests/cadence-tick.test.ts` (the CAD-05 all-zero `toEqual` literal `[VERIFIED: :535-607]`) and `tests/cadence-tick-route.test.ts:316 'reports EXACTLY the agreed key set'` red.
**How to avoid:** the plan task that adds `runAttributionPass` also (a) adds the three fields to the literal with the grouped-rationale comment style (quiet tick → 0 consumed / 0 recorded; `attributionCursorAt: expect.any(Number)` with a dedicated assertion, as `cursorAt` is `[VERIFIED: :541]`), (b) adds them to the route body enumeration, (c) updates the route test's key list. Ensure the attribution pass in a quiet tick CANNOT consume another suite's events: it registers at the outbox head? No — it registers at 0 on first run. In the remote suites the shared production DB means the first tick in a test run would consume **all history**. Make the pass **injectable/disableable** like `escalationSender` (no sender → pass does not scan) `[VERIFIED: STATE.md — "The escalation sender seam has NO default and undefined means the pass does not scan"]`: `runCadenceTick({ attribution: 'run' | 'skip' })` with the route passing `'run'` and tests defaulting to `'skip'` unless they are the attribution suite.
**Warning signs:** `tests/cadence-tick.test.ts` red with a `toEqual` diff naming `attribution*`.

### Pitfall 4: `tests/audit-aggregate.test.ts` pins the constants module to exactly three exports
**What goes wrong:** adding `ATTRIBUTION_WINDOW_DAYS` / `DEFAULT_BASELINE_WIN_RATE` / `BASELINE_MIN_QUOTES` / `OPT_OUT_ALARM_RATE` reds `it('exports exactly the three named constants')` `[VERIFIED: tests/audit-aggregate.test.ts:53-62]`.
**How to avoid:** the same task extends the expected array (sorted) and adds `'holds the deliberately HIGH default baseline'` assertions; keep the module import-free (the test at `:75` asserts aggregate.ts imports it; add a source assertion that `constants.ts` contains no `import`).

### Pitfall 5: `tests/rls-coverage.test.ts` enumerates tables by name and pins their grants
**What goes wrong:** new tables pass RLS-enabled/has-policy checks automatically but are **absent** from the grants map `[VERIFIED: tests/rls-coverage.test.ts:116-131 — the `table_name IN (…)` list and the expected `{'table/role': 'PRIVS'}` object]`, so a missing REVOKE/GRANT block ships unnoticed on hosted Supabase (which grants `anon`/`authenticated` everything by default `[VERIFIED: 0017 header]`).
**How to avoid:** the single phase migration carries the 0032-shaped REVOKE ALL → GRANT SELECT to anon/authenticated → GRANT ALL to service_role block for `quote_attributions`, `monthly_reports`, `tenant_fees` `[VERIFIED: 0032_phase6_console.sql:124-171]`, and the test's table list + expected map gain the six `table/role: 'SELECT'` entries. Also add the CHECK vocabularies (`value_source`, `baseline_source`, `kind`) by hand — drizzle-kit does not model CHECKs or GRANTs `[VERIFIED: src/db/migrations/README.md; 0032 header]`.

### Pitfall 6: `detected_at` vs `occurred_at`, and DST-free Perth hiding a zone bug
**What goes wrong:** a month boundary computed in UTC puts a 1-Sep-07:00-AWST win into August; Perth's fixed +08:00 hides it in tests until an Adelaide client onboards.
**How to avoid:** boundaries from `TZDate` in `tenants.timezone`; compare `won_detected_at.getTime()` against `[start, end)` instants; unit-test with `Australia/Adelaide` across the October DST change and with a `T23:30Z` instant that is next-day local.

### Pitfall 7: Attribution freezes delivery state at consumption time
**What goes wrong:** a touch counted as qualifying (receipt pending) is reported `undelivered` two seconds later; the row stands.
**Why it happens:** the consumer runs within a minute of the win; DLRs arrive "minutes to hours" later `[VERIFIED: send-ledger.ts:56-60]`.
**How to avoid:** accept (D-02 says pending counts) and record `deliveryStatus` in the evidence jsonb as it stood; the methodology footnote says "delivery as known at the time of attribution". Optionally re-check the window only against rows already `undelivered` at consumption — never re-open a row.

### Pitfall 8: The quote row can be gone (`mirror_missing`) when the win arrives
**What goes wrong:** `quotes.byId(quoteId)` returns nothing after an ops purge + re-sync under a new uuid `[VERIFIED: cadences.ts:361-369]`; `gross_cents` would be null.
**How to avoid:** still claim the row (the event is consumed exactly once) with `value_source = 'missing'` and `gross_cents = 0`, count `attributionsValueMissing`, and render the line as "value unavailable — check job {id} in ServiceM8" so the operator can raise a manual line on the invoice. Do not hold the cursor for it.

### Pitfall 9: Migration journal — one migration, hand-stamped, monotonic
**What goes wrong:** two plans in one wave each `db:generate`; the journal is coherent for whichever landed first `[VERIFIED: 0032 header; STATE.md Phase 3 tooling concern]`.
**How to avoid:** ONE plan owns `0033_phase7_reporting.sql` (all three tables, indexes, policies, CHECKs, grants, optional `send_ledger_tenant_quote_idx`); generate with drizzle-kit, rename the tag, hand-finish; no other Phase 7 plan touches `meta/_journal.json`. Run `npm run db:migrate` (session connection, port 5432) — the hosted DB is production.

### Pitfall 10: `numeric` is a string here and a number there
**What goes wrong:** `edit_distance`, `baseline_win_rate`, `total_invoice_amount` arrive as strings through drizzle/postgres.js and as JSON numbers through PostgREST (`supabase-js`) `[VERIFIED: audits/[id]/page.tsx:62-66 — "numeric arrives from PostgREST as a JSON NUMBER (measured)"]`.
**How to avoid:** core code reads through `forTenant()` (strings) and converts once (`parseMoneyToCents`, `Math.round(Number(rate)*10_000)`); pages that read via `createClient()` type the column as `number | string | null` and format only.

### Pitfall 11: The remote suites share one production database and one operator
**What goes wrong:** an attribution suite that rewinds the `'attribution'` cursor to 0 replays every client's real `won` history into `quote_attributions` — real rows on the production table.
**How to avoid:** park the attribution cursor at the outbox head in `beforeAll` and rewind only to the suite's own first event id, exactly as `cadence-consume-events.test.ts` does for the cadence cursor `[VERIFIED: tests/cadence-consume-events.test.ts:15-25, 62-70 `setCursor`]`; seed with stamped names; tear down attribution/report rows for seeded tenants in `teardownTenants`' ordered teardown (extend `tests/helpers/seed.ts`). Never run remote suites in parallel; `globalSetup` pauses the two production cron ticks under a lease `[VERIFIED: tests/helpers/global-setup.ts header]`.

## Code Examples

### Calendar-month bounds in the tenant's zone (D-10) and the rolling window (D-15)
```typescript
// Source: node_modules/@date-fns/tz/tz/index.d.ts (tz), date/index.d.ts (TZDate ctor (year, month, date, timeZone)),
//         node_modules/date-fns/types.d.ts:292-297 (ContextOptions.in) — all VERIFIED this session.
import { TZDate, tz } from '@date-fns/tz';
import { addMonths, startOfMonth } from 'date-fns';

export interface Period { start: Date; end: Date } // instants; end EXCLUSIVE

/** The calendar month `year-month` (1-based month) as it falls in `timeZone`. */
export function calendarMonth(timeZone: string, year: number, month: number): Period {
  const start = new TZDate(year, month - 1, 1, timeZone); // local midnight, 1st of month
  const end = addMonths(start, 1);                          // TZDate in, TZDate out — same zone
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** The month `now` falls in, in `timeZone` — for the "generate current month" default. */
export function currentMonth(timeZone: string, now: Date): Period {
  const start = startOfMonth(now, { in: tz(timeZone) });
  return { start: new Date(start.getTime()), end: new Date(addMonths(start, 1).getTime()) };
}

/** Elapsed-ms window, deliberately not calendar days (the auditWindow argument). */
export function rollingWindow(now: Date, days: number): Period {
  return { start: new Date(now.getTime() - days * 86_400_000), end: new Date(now.getTime()) };
}

export const inPeriod = (at: Date, p: Period) => at.getTime() >= p.start.getTime() && at.getTime() < p.end.getTime();
```

### The D-02 predicate and D-01 window, pure
```typescript
// Source: src/db/schema/send-ledger.ts:102-123 (vocabularies), :155-156 (claimed_at) — VERIFIED.
import type { SendLedgerRow } from '@/db/schema';
import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';

export function qualifiesAsTouch(row: Pick<SendLedgerRow, 'sender' | 'outcome' | 'deliveryStatus'>): boolean {
  return row.sender !== 'stub' && row.outcome === 'sent' && row.deliveryStatus !== 'undelivered';
  // NULL (no receipt), 'delivered' and 'unknown' all qualify — D-02 "a pending receipt counts".
}

/** Qualifying rows whose sent (claimed) moment lies in the 30 days before the win was DETECTED. */
export function qualifyingTouches(rows: readonly SendLedgerRow[], wonDetectedAt: Date): SendLedgerRow[] {
  const floor = wonDetectedAt.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000;
  return rows
    .filter(qualifiesAsTouch)
    .filter((r) => r.claimedAt.getTime() >= floor && r.claimedAt.getTime() <= wonDetectedAt.getTime())
    .sort((a, b) => a.claimedAt.getTime() - b.claimedAt.getTime());
}
```

### Baseline resolution and the conservative figure (D-07 / D-08), integer basis points
```typescript
// Source: src/core/audit/aggregate.ts:88-98 (basis points), :207-214 (floor toward the client), :239-251 (null never 0) — VERIFIED.
import { BASELINE_MIN_QUOTES, DEFAULT_BASELINE_WIN_RATE } from '@/core/audit/constants';

export interface ResolvedBaseline { rateBp: number; source: 'connect' | 'default'; sampleSize: number | null }

export function resolveBaseline(input: { winRate: string | null; quotesIssued: number | null }): ResolvedBaseline {
  const thin = input.winRate === null || (input.quotesIssued ?? 0) < BASELINE_MIN_QUOTES;
  if (thin) return { rateBp: Math.round(DEFAULT_BASELINE_WIN_RATE * 10_000), source: 'default', sampleSize: input.quotesIssued };
  return { rateBp: Math.round(Number(input.winRate) * 10_000), source: 'connect', sampleSize: input.quotesIssued };
}

/** gross × (1 − baseline), floored — one rounding step, in the client's favour, never negative. */
export function conservativeCents(grossCents: number, rateBp: number): number {
  return Math.floor((grossCents * (10_000 - rateBp)) / 10_000);
}
```

### The never-twice claim
```typescript
// Source: src/db/schema/cadences.ts:95-101 (targetless ON CONFLICT), src/db/repository/for-tenant.ts:1291 (insertClaim shape) — VERIFIED.
// inside forTenant(tenantId) build(): attributions namespace
claim: (row: AttributionInsert) =>
  db.insert(quoteAttributions)
    .values({ ...row, tenantId })
    .onConflictDoNothing()            // targetless: a conflict on ANY unique index is "you are the replay"
    .returning({ id: quoteAttributions.id }),
```

### Consumer skeleton (per-tenant run, advance in the same transaction)
```typescript
// Source: src/core/cadence/consume-events.ts:744-870 (runForTenant shape), :876-910 (register/scan/batch) — VERIFIED.
const cursor = await registerConsumerCursor(ATTRIBUTION_CONSUMER);
const pending = await forAllTenants_pendingQuoteEvents(cursor, ATTRIBUTION_BATCH_LIMIT);
// chunk into maximal same-tenant runs in id order; cursorHeld=false; blockedTenants=new Set()
await forTenant(run.tenantId).transaction(async (tx) => {
  for (const event of run.events) {
    if (event.eventType === 'won') {
      const ledger = await tx.ledger.listForQuote(event.quoteId);           // NEW read
      const touches = qualifyingTouches(ledger, event.detectedAt);
      if (touches.length > 0) {
        const [quote] = await tx.quotes.byId(event.quoteId);
        const [conn] = await tx.connection.get();
        const baseline = resolveBaseline({ winRate: conn?.baselineWinRate ?? null, quotesIssued: conn?.baselineQuotesIssued ?? null });
        const gross = parseMoneyToCents(quote?.totalInvoiceAmount) ?? 0;
        const inserted = await tx.attributions.claim({ /* columns + evidence jsonb */ });
        // inserted.length === 0 → replay or second win: consumed, not recorded
      }
    }
    advancedTo = event.id;
  }
  if (advanceCursor && advancedTo > 0) await tx.consumerCursor.advanceTo(ATTRIBUTION_CONSUMER, advancedTo);
});
```

### Reads to add to `forTenant()` (all keyed, tenant-closed, no new cross-tenant exports)
- `ledger.listForQuote(quoteId)` beside `listForCadence` `[VERIFIED: for-tenant.ts:1308]`.
- `inbound.listThreadedForQuote(quoteId)` (new namespace; `inbound_messages` has `tenant_id`, `quote_id`, `attribution`, `label`, `is_hot`, `received_at` `[VERIFIED: inbound-messages.ts:166-170, 240-273]`; select list omits `body`, `from_address`, `raw_payload`).
- `escalations.listForQuote(quoteId)` — the barrel says "Phase 7 adds the read it needs, with its own argument" `[VERIFIED: index.ts:197-199]`; columns `id, inbound_message_id, sent_at, outcome, created_at` only (no `to_address`).
- `cadences.listForQuote(quoteId)` — there is `getByQuoteId` `[VERIFIED: :828]`; confirm it returns all (sequential) cadences, else add.
- `events.wonInPeriod(start, end)` (count distinct quote_id for the "total wins" context) via `quote_status_events` `(tenant_id, quote_id)` index.
- `attributions.listForPeriod(start, end)`, `attributions.byQuote(quoteId)`; `reports.insertVersion(row)`, `reports.list()`, `reports.byId(id)`; `fees.append(row)`, `fees.list()`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `date-fns-tz` (`zonedTimeToUtc`/`utcToZonedTime`) | `@date-fns/tz` `TZDate` + date-fns v4 `in:` option | date-fns 4.0 (Sept 2024) `[CITED: blog.date-fns.org/v40-with-time-zone-support — via WebSearch, LOW]`; repo adopted it in Phase 2 `[VERIFIED: src/core/audit/followup.ts:34]` | CLAUDE.md's stack table is stale on this one point; do not install `date-fns-tz` |
| Live-computed reports | Frozen versioned document rows | Phase 7 D-11 | The row is the record; the page is a renderer |
| Reply-time PDF libraries | Browser print with `@page A4` | Phase 2 audit | No PDF dependency; proven on a phone |

**Deprecated/outdated:**
- `date-fns-tz` for this repo (superseded by `@date-fns/tz`).
- The CLAUDE.md "Dependencies" line about `date-fns-tz` — treat `@date-fns/tz` as the locked equivalent.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `DEFAULT_BASELINE_WIN_RATE = 0.70` is a defensibly HIGH default | Baseline resolution | Too low overstates credit on no-history clients (the invoice-they-can-disprove failure); too high makes the conservative multiple unprovable for those clients. One-line change, footnoted from the constant |
| A2 | `BASELINE_MIN_QUOTES = 10` as the thin-sample threshold | Baseline resolution | A real but thin baseline (e.g. 8 quotes, 25% won) would be replaced by the 70% default — conservative direction, but the footnote must say so |
| A3 | Setup fee excluded from the monthly multiple denominator; printed as its own line | Pattern 4 | If the guarantee is read as "3× all fees", month-one multiples are overstated |
| A4 | Tradify 2026 AU Trades Report win rates of 85–87% (aggregator snippet; primary PDF not retrieved) | Baseline resolution | Only informs the *direction* of A1; the QuoteSmith 30–50% band was fetched directly |
| A5 | First-touch-24h exclusion of "born `paused('onboarding')`" must be derived from a proxy because `pause_reason` is not historical | Pattern 3 | A wrong proxy under- or over-counts the denominator; footnote the rule chosen |
| A6 | Opt-out numerator restricted to addresses in the denominator set (numerator ⊆ denominator) | Pattern 3 | If the operator wants every fan-out STOP counted regardless, the alarm fires fleet-wide on one stranger's STOP |
| A7 | Riding the cadence tick (vs an own route) is acceptable for the attribution consumer | Pattern 1 | Slightly couples attribution latency to the tick's 300s budget; trivially movable later since the module is framework-free |
| A8 | `quote_attributions` money stored as `bigint` cents (vs `numeric(12,2)`) | Pattern 1 | Cosmetic; either satisfies "numeric with integer-cents math" as long as no float is used |
| A9 | Statistical framing of A2 (Wilson interval ±0.28 at n=10) | Baseline resolution | Framing only |

## Open Questions (RESOLVED)

1. **Confirm A1/A2/A3 before the first real report** — What we know: the constants are footnoted from one value and trivially changed. What's unclear: the operator's appetite for how punishing the no-history default should be, and whether the guarantee counts the setup fee. Recommendation: ship the recommended values behind the constants module; list in the phase's UAT as an operator decision. **RESOLVED:** 07-02 T1 — the constants module carries the A1/A2/A3 values with the rationale in doc comments; 07-04 T1/T2 — every footnote derives from the constants frozen into the report row; the operator's appetite for the values stays a UAT item.
2. **Attribution pass placement** — What we know: the tick composition and its two pinned tests; the pass makes no external calls. What's unclear: whether the planner wants the tick's 300s budget shared. Recommendation: ride the tick with a `'skip' | 'run'` switch (Pitfall 3); revisit only if the tick budget ever binds. **RESOLVED:** 07-03 T1 — `attribution?: 'run' | 'skip'` on `RunCadenceTickOptions`, default `'skip'`, the route passes `'run'`; the pass rides the tick.
3. **First-touch-24h onboarding exclusion proxy** (A5) — Recommendation: derive "gate closed at `anchor_at`" from `message_templates.approved_at` + `tenant_attestations.attested_at` via the existing `onboardingComplete` conditions read, evaluated at `anchor_at`; footnote it on the detail page. **RESOLVED:** 07-02 T3 — `onboardedAt()` derives the gate-closed instant from the existing `onboardingComplete` conditions, consumed by the metrics (and 07-05's denominator).
4. **Per-line content in the frozen report** — What we know: T-2-02 forbids bodies/addresses in logs and pages should minimise them. What's unclear: whether `contact_name` (the customer's first name) belongs on a document the client already knows their customer from. Recommendation: include `generated_job_id`, a truncated `job_description`, and the contact's first name only; never phone/email/bodies. `/gsd-ui-phase 7` should ratify. **RESOLVED:** 07-02 T1 — the strict evidence schema admits no address or body key; 07-04 T1 — report lines carry the job id, a truncated description and the contact's first name only (UI-SPEC ratified).
5. **`value_source = 'missing'` handling** (Pitfall 8) — Recommendation: record and surface; do not hold the cursor. **RESOLVED:** 07-03 T1 — a vanished mirror row is recorded as `value_source = 'missing'` (counted in `attributionsValueMissing`), the cursor advances, and the page/report surface it as value-unavailable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/tests | ✓ | v22.20.0 `[VERIFIED: node --version]` | — |
| npm | scripts | ✓ | 10.9.3 | — |
| Supabase CLI | local `supabase start` (CI) | ✓ (a `supabase` binary answered `59.10.0`; the devDependency pins `supabase` 2.115.0 — CI uses the package one) | — | CI workflow runs `supabase start` → `db:migrate` → `vitest run` `[VERIFIED: .github/workflows/ci.yml:90-199]` |
| Hosted Supabase (Sydney) | `test:remote`, production | ✓ (production — see memory `hosted-db-is-production`) | Postgres 15+ | none; serialize, never overlap runs |
| Vercel deploy | the tick route change must deploy before the attribution pass runs live | assumed ✓ (GitHub-linked) | — | Attribution simply starts when the deploy lands; the cursor registers at 0 and drains history |
| A browser with print-to-PDF | D-12 delivery | ✓ (operator's device) | — | — |
| ServiceM8 / ClickSend / Resend / Anthropic | **not used by this phase** | — | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 `[VERIFIED: package.json]` |
| Config file | `vitest.config.mts` (`include: tests/**/*.test.ts`, `setupFiles: tests/helpers/env.ts`, `globalSetup: tests/helpers/global-setup.ts`, `fileParallelism: false`, 30s timeouts) `[VERIFIED]` |
| Quick run command | `npx vitest run tests/<file>.test.ts` (pure suites need no env; a remote suite refuses without `ALLOW_REMOTE_TESTS=yes` `[VERIFIED: tests/helpers/env.ts:141-150]`) |
| Full suite command | `npm test` (pure + whatever env allows); `npm run test:remote` — **serialized against the hosted Sydney production DB; the global setup pauses the two production pg_cron ticks under a lease; never run two remote runs concurrently** |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RPT-01 | D-02 predicate (`stub`, `failed`, NULL outcome, `undelivered`, pending, email) and D-01 window edges (exactly 30 days, `claimed_at` after `detected_at`) | unit (pure) | `npx vitest run tests/attribution-qualify.test.ts` | ❌ Wave 0 |
| RPT-01 | `resolveBaseline` null/thin/real; `conservativeCents` floors, never negative, basis-point exactness (`0.7 * 10000` float trap) | unit (pure) | `npx vitest run tests/attribution-baseline.test.ts` | ❌ Wave 0 |
| RPT-01 | Constants module: exact export set, no imports, HIGH default, footnote derives from constant (source assertion on the report page) | unit (source) | `npx vitest run tests/audit-aggregate.test.ts` (extend `:53`) | ✅ extend |
| RPT-01 | Consumer: registers `'attribution'` at 0, never touches `'cadence-engine'`; won with qualifying touch → one row; replay/rewind → zero new rows; reopen→won again → no second row; second-tenant run continues when the first blocks; cursor advances in the same tx | integration (remote) | `npm run test:remote -- tests/attribution-consume.test.ts` | ❌ Wave 0 (clone `tests/cadence-consume-events.test.ts` park/rewind discipline) |
| RPT-01 | Unique index `quote_attributions_one_per_quote`, RLS + grants on the three tables, CHECK vocabularies | integration (remote) | extend `tests/rls-coverage.test.ts:116` grants map + a `:336`-style index assertion | ✅ extend |
| RPT-01 | Tick result + route body carry the three new counts, all numbers, nothing else | unit | `tests/cadence-tick.test.ts` literal, `tests/cadence-tick-route.test.ts:316` key set | ✅ extend |
| RPT-02 | `calendarMonth` / `currentMonth` in `Australia/Perth` and `Australia/Adelaide` across DST; `inPeriod` half-open; `won_detected_at` at `T23:30Z` lands next local day | unit (pure) | `npx vitest run tests/reporting-period.test.ts` | ❌ Wave 0 |
| RPT-02 | `feesInForce` pro-rating (no change, mid-month change, no schedule → null multiple, setup line placement) | unit (pure) | `npx vitest run tests/reporting-fees.test.ts` | ❌ Wave 0 |
| RPT-02 | `computeReportFigures`: gross/conservative totals, multiples in bp, zero-month → zeros not NaN, unattributed wins as context | unit (pure) | `npx vitest run tests/reporting-figures.test.ts` | ❌ Wave 0 |
| RPT-02 | Generate writes version 1 then 2, keeps 1; page renders from the row (source assertion: the report page imports no aggregation function); concurrent generate → one 23505 mapped to a message | integration (remote) | `npm run test:remote -- tests/monthly-report.test.ts` | ❌ Wave 0 |
| RPT-02 | Report page/action authorization: non-member tenant id → denied; operator gate on `/reports` | integration (remote) | clone `tests/inbox-authorization.test.ts` shape → `tests/reports-authorization.test.ts` | ❌ Wave 0 |
| RPT-02 | Print layout, PDF from phone, footnote wording | manual-only (visual) | UAT — `/gsd-verify-work` | — |
| RPT-03 | Each metric: empty → `rate: null`; onboarding exclusion; opt-out numerator ⊆ denominator; edit rate counts validator-forced edits; 5% threshold from the constant (`isOptOutAlarming(0.05)` true, `0.0499` false) | unit (pure) | `npx vitest run tests/reporting-metrics.test.ts` | ❌ Wave 0 |
| RPT-03 | `forAllTenants_reportMetrics` counts match the pure functions over seeded rows for two tenants (no cross-tenant bleed); pinned surface ratified (13 exports / 17 tables) | integration (remote) + source | `npm run test:remote -- tests/report-metrics.test.ts`; `tests/sync-upsert.test.ts:498,673` | ❌ Wave 0 / ✅ extend |
| RPT-03 | Digest: `buildOptOutSection` null when nobody is above 5%, one line per client above; closed vocabulary (no `@`, no `+61` in output); digest still writes nothing | unit (pure) | extend `tests/stall-tick.test.ts` / new `tests/opt-out-section.test.ts` | ❌ Wave 0 |
| all | `npm run lint`, `npm run typecheck`, `next build` (client bundle pulls no db module — `tests/lint-ban.test.ts:510`) | static | `npm run lint && npm run typecheck` | ✅ |

### Sampling Rate
- **Per task commit:** the task's pure suite(s) + `npm run typecheck`
- **Per wave merge:** `npm test` (pure) and, for waves touching schema/consumer/repository, one serialized `npm run test:remote`
- **Phase gate:** full `npm run test:remote` green (serialized, production DB, lease-paused ticks) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/attribution-qualify.test.ts`, `tests/attribution-baseline.test.ts` — RPT-01 pure rules
- [ ] `tests/reporting-period.test.ts`, `tests/reporting-fees.test.ts`, `tests/reporting-figures.test.ts`, `tests/reporting-metrics.test.ts`, `tests/opt-out-section.test.ts` — RPT-02/03 pure rules
- [ ] `tests/attribution-consume.test.ts`, `tests/monthly-report.test.ts`, `tests/report-metrics.test.ts`, `tests/reports-authorization.test.ts` — remote proofs
- [ ] `tests/helpers/seed.ts` — `seedLedgerRow`, `seedInbound`, `seedAttribution`, `seedFee`; teardown order extended for the three new tables
- [ ] Pinned-test extensions: `tests/audit-aggregate.test.ts:53`, `tests/sync-upsert.test.ts:498/673`, `tests/rls-coverage.test.ts:116`, `tests/cadence-tick.test.ts:535`, `tests/cadence-tick-route.test.ts:316`
- Framework install: none — Vitest present

## Security Domain

### Applicable ASVS Categories (Level 1, `security_enforcement: true`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | Supabase Auth session via `getClaims()` in the console layout; `proxy.ts` redirect `[VERIFIED: layout.tsx:86-92]` — nothing new |
| V3 Session Management | inherited | — |
| V4 Access Control | **yes** | `/reports` overview: `requireOperator()` before the service-role read (inbox pattern). `/reports/[client]`, Generate, fee append: `authorize(tenantId)` RLS-scoped `tenants` read with the operator's own JWT before any `forTenant()` write (clients/[id]/actions.ts pattern). Server actions are globally POSTable — auth first, body second (WR-01) |
| V5 Input Validation | yes | zod: `{ year: int 2024..2100, month: 1..12 }`, fee `{ kind: enum, amountCents: int ≥ 0 ≤ 10^9, effectiveFrom: YYYY-MM-DD, note }`; uuid pattern check before any query (22P02 → 404 rule) |
| V6 Cryptography | no new | bearer for the tick unchanged (`timingSafeEqual`) |
| V8 Data Protection | **yes** | Report rows / page props / tick body carry no `body`, `to_address`, `from_address`, `raw_payload`; tick response counts-only (T-3-24); PostgREST/postgres errors never echoed (WR-08 — fixed sentence + code to log) |
| V7 Error Handling & Logging | yes | `console.error('[reports] … failed: <code>')` only; caught values discarded (inbox precedent) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fabricated attribution / report / fee row from a console session | Tampering | `authenticated` holds SELECT only on all three tables (REVOKE-then-GRANT block); writes are service-role behind `authorize()`; unique index on `(tenant_id, quote_id)` |
| Cursor rewind replaying history into attribution | Tampering / DoS | `event_consumer_cursors` is `is_operator()`-gated and `authenticated` has SELECT only `[VERIFIED: rls-coverage expected map; quote-events.ts:178-194]`; replay is idempotent by the index anyway |
| Cross-tenant metric leak via the new `forAllTenants_` accessor | Information disclosure | Counts/sums only, no `tenants` join, consumed only from the `requireOperator` page; pinned in `tests/sync-upsert.test.ts` |
| Customer content in a printed/serialised document or log | Information disclosure | Evidence jsonb and report lines exclude bodies/addresses by schema (zod) and by select list; T-2-02/T-6-21 |
| IDOR on `/reports/[client]/[reportId]` | Elevation of privilege | Read the row through the operator's JWT (RLS `has_tenant_access`) or `authorize(tenantId)` then `forTenant(tenantId).reports.byId(id)` — the report id alone never selects across tenants |
| Concurrent Generate producing two "version 2"s | Tampering | Unique `(tenant_id, period_start, version)`; loser gets a fixed message |
| Tick body leaking a tenant id / error string | Information disclosure | Enumerated numeric fields only; route test asserts every leaf is a number |
| Unbounded reads on the report page | DoS | Cap per-period reads (the `QUOTE_LIMIT` / `ACTIVITY_LIMIT` precedent `[VERIFIED: clients/[id]/page.tsx:241-254]`) and order before limiting |

## Sources

### Primary (HIGH confidence — opened this session)
- `src/db/schema/{quote-events,send-ledger,cadences,sm8-connections,prospects,tenants,quotes,inbound-messages,suppressed-contacts,touch-drafts,escalations,cadence-touches,cadence-settings,tenant-attestations,index}.ts` — every column, vocabulary and index cited
- `src/core/audit/{constants,aggregate}.ts`, `src/core/cadence/consume-events.ts`, `src/core/cadence/run-tick.ts` (pass order :923-941), `src/core/aging/stalled-digest.ts`, `src/core/alerts/{stalled-drafts,operator-email}.ts`, `src/core/sync/connect.ts` (:176-244), `src/core/shared/tenant.ts` (:312-329), `src/core/servicem8/normalize.ts` (:136-165), `src/core/sync/health.ts`
- `src/db/repository/{consumer-cursor,index,for-all-tenants,for-tenant}.ts` (namespaces and signatures), `src/db/migrations/{0017_cadence_grants_and_constraints,0032_phase6_console}.sql`, `src/db/migrations/README.md`, `meta/_journal.json` (idx 32 = `0032_phase6_console`)
- `src/app/(console)/{layout,_auth}.tsx/ts`, `audits/[id]/{page.tsx,audit.css}`, `inbox/page.tsx`, `clients/[id]/{page,actions}.tsx/ts`, `api/internal/{cadence-tick,stalled-digest}/route.ts`
- `tests/{sync-upsert,audit-aggregate,rls-coverage,cadence-tick,cadence-tick-route,cadence-consume-events,lint-ban}.test.ts`, `tests/helpers/{env,global-setup,seed}.ts`, `vitest.config.mts`, `.github/workflows/ci.yml`
- `package.json`, `node_modules/@date-fns/tz/{package.json,README.md,tz/index.d.ts,date/index.d.ts}`, `node_modules/date-fns/types.d.ts:292-297`
- `.planning/{REQUIREMENTS,ROADMAP,PROJECT,STATE}.md`, `07-CONTEXT.md`, `07-DISCUSSION-LOG.md`, `.planning/quick/260902-1x6-…/260902-1x6-SUMMARY.md`

### Secondary (MEDIUM confidence)
- date-fns v4 time-zone support (`in:` option, `TZDate`) — corroborated by the installed type declarations above; web: blog.date-fns.org/v40-with-time-zone-support, date-fns.org/v4.1.0/docs/Time-Zones (via WebSearch)

### Tertiary (LOW confidence — marked for validation)
- quotesmith.co.uk/tools/win-rate-calculator.html — "healthy win rate 30–50%", ">60% may indicate underpricing" (vendor guidance, fetched)
- Tradify 2026 AU Trades Report win rates 87% / 85% — WebSearch snippet only; tradifyhq.com/au/trades-report (landing page, no figures) and gcnews.com.au (13 Feb 2026, no percentages) fetched; PDF not retrieved
- `gsd-tools query classify-confidence --provider websearch|webfetch` → `LOW` (used for the tags above)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nothing new; versions read from `package.json` and `node_modules`
- Architecture: HIGH — every pattern is a clone of a named, tested precedent in this repo; the one novel table family (frozen report) follows the evidence-family rules verbatim
- Pitfalls: HIGH — each pinned test was opened and its line cited
- Discretionary constants (A1/A2/A3): LOW — external benchmarks are thin; the design makes them one-line, footnoted changes

**Research date:** 2026-09-02
**Valid until:** 2026-10-02 for the codebase findings (or the next migration / repository change, whichever first); the benchmark figures should be re-checked before the first client-facing report
