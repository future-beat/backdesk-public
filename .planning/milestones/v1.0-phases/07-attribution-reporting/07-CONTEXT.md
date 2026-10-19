# Phase 7: Attribution & Reporting - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the evidence the earlier phases deliberately preserved — the append-only `quote_status_events` outbox (Phase 2), the `send_ledger` with provider/outcome/delivery columns and the `cadences.stop_reason` vocabulary (Phases 3–4), threaded `inbound_messages` and `suppressed_contacts` (Phase 4), `touch_drafts.edit_distance` (Phase 5), `escalations.sent_at` (Phase 6), and the connect-time baseline on `sm8_connections` (Phase 2 D-14) — into three deliverables:

1. **RPT-01 — Attribution:** a per-quote recovered-revenue record, written at most once per quote, carrying the evidence chain (qualifying sent touches, replies, the win event) and both a gross and a conservative net-of-baseline dollar figure.
2. **RPT-02 — Monthly report:** a frozen, versioned per-client calendar-month report rendered as a print-styled A4 page the operator prints to PDF and staples to the invoice: quotes chased, replies, jobs won, dollars recovered (gross + conservative), fees paid, multiple returned.
3. **RPT-03 — Instrumentation:** a new `/reports` console area with a cross-client overview and per-client detail showing rolling-30-day first-touch-within-24h rate, reply rate, opt-out rate (with the >5% alarm), human-edit rate, and recovery multiple.

Requirements: RPT-01, RPT-02, RPT-03. Out of this phase: client logins or links (V2-08), cross-client benchmarking in the client-facing report (V2-04), system-sent report emails, any change to how earlier phases record evidence.

**Carried forward (locked, not re-discussed):**
- Stub ledger rows (`sender = 'stub'`) are excluded from attribution by the `sender` column, forever (Phase 3 D-13 / send-ledger.ts header).
- `cadences.stop_reason` keeps `won` / `lost` / `removed` / `reopened` / `mirror_missing` distinct because this phase attributes on it (Phase 3, G-3-5).
- `quote_status_events` is append-only; Phase 7 re-reads from id 0 and must be idempotent; the 90-day backfill emits NO events, so pre-connection wins can never be attributed; `quote_opened` fires only for chase-eligible quotes (quote-events.ts contract).
- `computeBaseline` returns null, never 0, for no data — a stored 0 would bill wins the client would have made anyway (Phase 2).
- Evidence-family table conventions: `tenant_id` column not FK, no cascade from `tenants`, RLS authored in schema, read-only to `authenticated`, service-role writes (every evidence table since Phase 2).
- Clients get reports, not logins; the console is operator-only (PROJECT.md, V2-08).
- A metric nags, it never pauses a healthy client (Phase 6 D-15 stale-attestation rule).
- Money is `numeric` with integer-cents string math, never a float (quotes.ts).

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The evidence contracts this phase consumes (load-bearing)
- `src/db/schema/quote-events.ts` — THE consumption contract: cursor registration, ORDER BY id, append-only, replay legal, no pre-connection events, `quote_opened` only for eligible quotes; `QUOTE_EVENT_TYPES`; `detected_at` vs `occurred_at` (D-10 keys on `detected_at`)
- `src/db/schema/send-ledger.ts` — `sender` (stub exclusion), `outcome` NULL semantics, `delivery_*` columns as a separate fact (D-02 reads both), no-FK/no-cascade rationale written for Phase 7
- `src/db/schema/cadences.ts` — `CADENCE_STOP_REASONS` (won/lost/removed/reopened/mirror_missing distinctions), one-live-per-quote + one-per-opened-event indexes, contact snapshot columns
- `src/db/schema/sm8-connections.ts` — `baseline_win_rate`, `baseline_quotes_issued`, `baseline_window_start/end`, `baseline_computed_at` (D-06 canonical baseline)
- `src/db/schema/prospects.ts` + `src/db/schema/tenants.ts` (`prospect_id`) — the audit baseline reached through the tenant→prospect link (D-06 footnote only)
- `src/db/schema/quotes.ts` — `QUOTE_STATUSES`, `total_invoice_amount` numeric discipline, raw+UTC date pairs, D-16 all-statuses-persisted
- `src/db/schema/inbound-messages.ts` — `INBOUND_ATTRIBUTIONS` (`threaded` is the reply-rate numerator), classification labels, `is_hot`, T-2-02 body prohibition
- `src/db/schema/suppressed-contacts.ts` — `source` values that define the opt-out numerator (D-16)
- `src/db/schema/touch-drafts.ts` — `edit_distance` semantics (NULL until approval, 0 = unchanged), `DRAFT_STATUSES`, one-row-per-attempt (D-17 denominator = approved rows)
- `src/db/schema/escalations.ts` — `sent_at` + `ESCALATION_OUTCOMES`, the "within minutes" proof table
- `src/db/schema/cadence-touches.ts` — `TOUCH_STATUSES`, `scheduled_at`, `TOUCH_SKIP_REASONS`; first-touch-24h reads touch 1's ledger row, not touch state

### Patterns and modules to reuse
- `src/core/audit/constants.ts` — the no-import constants module: figure and footnote derive from one value; `AUDIT_RECOVERY_RATE = 0.15` (still a flagged assumption), `WINDOW_DAYS = 90`; `ATTRIBUTION_WINDOW_DAYS` and `DEFAULT_BASELINE_WIN_RATE` join it
- `src/core/audit/aggregate.ts` — `computeBaseline` (null-never-0) and `computeAuditFigures`; the aggregation style the report figures follow
- `src/app/(console)/audits/[id]/page.tsx` + `audit.css` — the A4 print-styled page pattern D-12 reuses (screen-only controls, `@media print` hiding, methodology footnotes)
- `src/core/sync/connect.ts` — where the D-14 baseline is written at connect (D-09: never rewritten)
- `src/core/aging/stalled-digest.ts` + `src/core/alerts/operator-email.ts` — the digest the D-16 alarm line rides; empty-digest-not-sent rule
- `src/app/(console)/inbox/page.tsx` + `src/app/(console)/queue/` — cross-tenant read conventions (`requireOperator()` + service-role, priority in SQL, capped reads) for the `/reports` overview; nav-badge pattern (JWT-scoped count, Phase 6 A5)
- `src/app/(console)/clients/[id]/page.tsx` — the pipeline page that only links to `/reports/[client]` (D-14); `formatInTenantZone` display discipline
- `src/db/repository/for-tenant.ts` + `src/db/repository/for-all-tenants.ts` — repository conventions; the cross-tenant surface was ratified at 12 exports / 13 tables in quick task 260902-1x6 — any new cross-tenant read must update that pinned count deliberately

### Project planning & prior decisions
- `.planning/REQUIREMENTS.md` — RPT-01..03 (this phase); V2-01 (edit-rate trigger reads D-17), V2-04 (benchmarking deferred), V2-08 (portal deferred)
- `.planning/ROADMAP.md` — Phase 7 goal + success criteria; "Evidence-before-reporting invariant" note; UI hint: yes
- `.planning/PROJECT.md` — Core Value ("invoice stapled to proof"), success metric ≥3× fees, complaint alarm >5%, pricing ($297 founding / $597 / $997 + $990 setup) for the fee schedule
- `.planning/STATE.md` — Phase 2 open concern (AUDIT_RECOVERY_RATE; won-inside-72h-grace question), Phase 6 A5 contract, T-2-02/T-3-24 rules, first-arming checklist
- `.planning/phases/02-servicem8-sync-quote-leakage-audit/02-CONTEXT.md` — D-01/D-02 (prospect link, baseline read through it), D-09/D-10 (audit constants), D-14 (connect baseline), D-16 (status history kept for this report)
- `.planning/phases/03-cadence-engine/03-CONTEXT.md` — D-04 (one human per cadence: attribution assumes it), D-13/D-14 (ledger + lifecycle as Phase 7 evidence)
- `.planning/phases/04-messaging-gateway/04-CONTEXT.md` — D-03 (over-suppression is the compliant failure — opt-out rate will include ambiguous multi-tenant STOPs), D-07 (no auto-retry)
- `.planning/phases/06-review-console-escalation/06-CONTEXT.md` — D-05 (escalation evidence row shape for Phase 7), D-15 (nag-never-pause), D-17 (client page evolution), Phase 6 console patterns
- `.claude/CLAUDE.md` — stack constraints; date-fns-tz / `Australia/Perth` handling for calendar-month boundaries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Audit A4 page + `audit.css`**: print-styled document with methodology footnotes and screen-only controls — the monthly report is a second document in the same mould
- **Audit constants module + `computeBaseline`**: the "one value feeds figure and footnote" discipline; new attribution/baseline constants live beside `AUDIT_RECOVERY_RATE`
- **`quote_status_events` consumer contract + `event_consumer_cursors`**: a second consumer (attribution) registers its own cursor row at 0 and scans forward, exactly as the cadence engine does
- **`send_ledger` sender/outcome/delivery columns**: D-02 is a pure predicate over existing columns — no schema change to the ledger
- **`sm8_connections.baseline_*`**: D-06 reads existing columns; nothing new is written at connect
- **`touch_drafts.edit_distance`, `escalations.sent_at`, `inbound_messages.attribution`, `suppressed_contacts.source`**: every RPT-03 metric is a query over existing evidence
- **Stalled-digest + operator-email + nav-badge**: the D-16 alarm is a new line and a new count over existing machinery
- **`requireOperator()` + service-role cross-tenant read pattern (inbox/queue)**: the `/reports` overview is cross-tenant and takes that path; per-client detail can use RLS-scoped reads
- **Test harness**: pure suites on bare `npm test` for the attribution predicate, window math and metric definitions; `test:remote` (serialized, hosted Sydney DB is production) for cursor/idempotency proofs

### Established Patterns
- Evidence-family tables: `tenant_id` column not FK, no cascade, RLS in schema, read-only to `authenticated`, service-role writes — the attribution table and report table are evidence
- Closed vocabularies CHECK-constrained (migration 0017 pattern); numeric money as integer-cents strings; tenant-timezone display everywhere with the zone named
- Never-twice by unique index + `ON CONFLICT DO NOTHING RETURNING` (ledger, escalations, cadences) — the D-04 attribution row uses the same shape
- No customer bodies/addresses in logs (T-2-02); enumerated response fields (T-3-24); no select-all on customer-touching actions
- drizzle journal monotonicity guard; parallel plans must not both generate migrations in one wave; remote suites serialize
- Cross-tenant repository surface is a pinned count — extending it is a deliberate, tested change

### Integration Points
- Attribution: `won` events (outbox) → attribution consumer → predicate over `send_ledger` (D-02) within `ATTRIBUTION_WINDOW_DAYS` (D-01) → attribution row (D-03/D-04/D-05) with gross + conservative (D-07) from the connect baseline (D-06/D-08/D-09)
- Report: Generate action on `/reports/[client]` → aggregate attribution rows + chased/replies counts for the calendar month (D-10) + fee in force (D-13) → frozen versioned row (D-11) → print-styled page (D-12)
- Instrumentation: `/reports` overview (cross-tenant, service-role) + `/reports/[client]` (rolling 30 days, D-15) over ledger / inbound / suppression / drafts / attribution rows (D-16/D-17/D-18); >5% badge + digest line via existing alert machinery
- Fee schedule: edited on `clients/[id]`, read by the report generator

</code_context>

<specifics>
## Specific Ideas

- "The invoice arrives stapled to proof it paid for itself" — the report is a document with an audience that will challenge it; every number must be traceable to rows the client can recognise (their job numbers, their customers' replies)
- Every ambiguity resolves in the conservative direction: tight window, undelivered excluded, per-job haircut, HIGH default baseline, headline multiple on the conservative figure
- Figure and footnote from one value (the audit-constants rule) — a report that states a 30-day window above a number computed with 45 is a document that can be shown to be wrong by the person being billed
- A closed month never changes: detection-month attribution + frozen rows mean the operator never has to explain why August moved after it was invoiced

</specifics>

<deferred>
## Deferred Ideas

- **System-sent report emails / tokenized client links** — V2-08 territory; revisit when manual PDF attachment becomes friction (D-12)
- **Operator-flagged "complaint" marker on inbound messages** — would separate a genuine complaint from a polite STOP; small inbox affordance, not needed for the opt-out rate (D-16)
- **Engagement-proven third figure** (wins preceded by a customer reply, no baseline math) — a possible extra line on the report once clients ask "which of these did you actually cause" (D-07)
- **Operator re-snapshot of the baseline** — only if a first connect provably captured a bad window (D-09)
- **Selectable instrumentation windows** (7/30/90) — if rolling 30 proves wrong for a metric (D-15)
- **Cross-client benchmarking in reports** — V2-04, ≥10 clients of data
- **Attribution "won inside 72h grace" question and AUDIT_RECOVERY_RATE confirmation** — Phase 2's flagged assumptions remain the operator's call before the first real audit; not changed here

</deferred>

---

*Phase: 7-Attribution & Reporting*
*Context gathered: 2026-09-02*
