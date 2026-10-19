# Phase 3: Cadence Engine - Context

**Gathered:** 2026-08-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Every chase-eligible synced open quote gets a deterministic, materialized schedule of up to 5 touches over ~3 weeks — timezone- and contact-hours-aware — with a send ledger that makes duplicate sends structurally impossible, stop/pause conditions (reply, won/lost, opt-out, kill switches) proven by exhaustive state-machine tests, and dispatch-time revalidation of quote status, suppression, and send window. Overdue touches re-window instead of sending late.

Requirements: CAD-01, CAD-02, CAD-03, CAD-04, CAD-05. Real SMS/email sending is Phase 4, Claude drafting is Phase 5, the approval console is Phase 6 — this phase ships the complete dispatch pipeline against a stub sender and models the full touch lifecycle so those phases fill in stages rather than reshape the machine.

</domain>

<decisions>
## Implementation Decisions

### Cadence shape & anchoring
- **D-01:** Day 0 anchors on the **eligibility moment** — the `quote_opened` event (when the quote became chase-eligible). Fresh post-connect quotes anchor within ~5 minutes of sync (feeds the first-touch-within-24h metric); backfilled quotes anchor when the operator ticks them eligible. A cadence can never materialize already-overdue.
- **D-02:** Touch timing is a **fixed default (day 0, 3, 7, 14, 21) stored as per-tenant config rows** that onboarding can edit. Schema supports per-client overrides from day one; v1 UI may simply apply the default. — **Reversibility:** costly — moving from config rows back to code constants (or vice versa) reshapes how Phase 5 binds per-touch templates to timing.
- **D-03:** Touches materialize at a **per-tenant preferred send time (default mid-morning, ~9:30am local)** clamped inside the contact window, **with a few minutes of random jitter** so sends don't land robotically at the identical minute.
- **D-04:** One cadence chases **one primary contact per quote**, selected by a deterministic rule (JobContact type, then documented fallback order). Quotes where no contact has a usable mobile/email go to **operator triage**, never a guess. — **Reversibility:** costly — opt-out, reply threading (Phase 4) and attribution (Phase 7) all assume one human per cadence; multi-contact later means reworking suppression and threading semantics.

### Stop vs pause semantics
- **D-05:** Customer reply → **pause until the operator explicitly acts** (resume or close). No automated resume after a live conversation — a human is in the loop in v1 anyway.
- **D-06:** Kill switches are asymmetric: **per-contact kill is terminal** (writes the contact to the suppression list — "never chase again"), **per-client kill is a reversible pause** of every cadence for that tenant. — **Reversibility:** one-way for the contact kill by design — the suppression entry is the Spam Act safety mechanism; making it reversible invites resuming someone who complained.
- **D-07:** Resume (operator resume, client un-pause, auth-failure recovery per Phase 2 D-08) uses **one rule for every pause type: shift the remaining schedule from the resume moment** — next touch at the next allowed slot, remaining touches follow at their original relative gaps. Never a burst, never out-of-hours.
- **D-08:** `removed` event → terminal stop (job no longer exists). `reopened` event → **no auto-restart**: the quote returns to `needs_review` for operator triage, because a reopen usually means the tradie is actively negotiating in ServiceM8.

### Overdue re-window policy
- **D-09:** "Next allowed slot" = **later today if the contact window is still open** (send at next tick with jitter, given sufficient margin), otherwise the **next allowed contact day at the preferred slot**.
- **D-10:** **Minimum-gap rule** (~2 days between consecutive sends, named constant): a re-windowed touch that would land inside the min gap of the next scheduled touch is **skipped** (recorded as skipped, not sent) — the next touch carries the conversation. The customer never gets two texts in quick succession.
- **D-11:** **Staleness cap ~72h**: a touch more than ~72h past its slot is marked `skipped_stale` and never sent; the cadence proceeds to the next touch (min-gap still applies).
- **D-12:** **Cadence expiry at ~6 weeks from anchor** (~2× design length): the cadence auto-completes as `expired` with remaining touches unsent. An expired-but-still-open quote is a pipeline-view concern (Phase 6), not a send-queue concern.

### Dispatch handoff boundary
- **D-13:** Dispatch runs the **full pipeline against a pluggable sender interface**: just-in-time revalidation (quote still open + chase-eligible, contact not suppressed, connection not paused, inside send window), claim the send-ledger row, then invoke the sender. Phase 3 ships a **stub sender that logs instead of sending** (ledger-recorded as stub-sent); Phase 4 swaps in the real gateway. Every CAD success criterion (concurrent-tick ledger uniqueness, enqueue→opt-out→dispatch-refuses) is proven in this phase against the real path. — **Reversibility:** costly — the sender interface is the Phase 4 contract; changing its shape later touches dispatch, ledger, and gateway simultaneously.
- **D-14:** The touch state machine **models the full lifecycle from day one**: scheduled → needs_draft → pending_approval → approved → sent / skipped (with skip reasons) — Phase 3 **auto-passes the draft and approval gates**. Touches surface ahead of their send slot so approval has lead time (feeds CON-04 draft aging later). Phases 5/6 replace stub gates with real logic; no live-cadence state migration, no rewritten CAD-03 test suite. — **Reversibility:** one-way — the state vocabulary is the contract Phases 5, 6, and 7 build on; renaming states after live cadences exist requires a data migration under running schedules.
- **D-15:** **The suppression table ships in Phase 3.** Per-contact kill writes to it, dispatch revalidates against it, and the enqueue→suppress→dispatch-refuses test proves the gate now. Phase 4's deterministic STOP regex becomes another writer to the same table. A suppressed contact must block cadences on NEW quotes too, not just stop existing ones.
- **D-16:** **Minimal operator UI this phase**, extending existing console pages: cadence state + upcoming touches on the quote detail page; per-contact kill, per-client kill/pause, and cadence resume as buttons. The full approval queue and pipeline view stay in Phase 6 — but a kill switch must be reachable from a phone from the day real cadences exist.

### Claude's Discretion
- Tick mechanics: own pg_cron schedule vs piggyback on the 5-minute sync tick; route/endpoint design follows the Phase 2 sync-tick pattern.
- Send ledger schema and the exact unique-constraint shape; how the stub sender records stub-sent entries distinguishably from future real sends.
- Exact named-constant values (min-gap days, staleness-cap hours, expiry weeks, draft lead time, jitter range) — decisions above give the intent and rough magnitudes.
- Cadence/touch table design, event-consumer registration (`INSERT ... ON CONFLICT DO NOTHING` per the outbox contract), and crash-safe cursor advancement.
- Primary-contact selection rule specifics (JobContact type precedence, fallback order) — must be deterministic and documented.
- How "enough margin" is defined for same-day re-windows (D-09).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The Phase 2 → Phase 3 contract (load-bearing)
- `src/db/schema/quote-events.ts` — **THE consumption contract**: transactional outbox semantics, cursor registration (no seeded row), same-transaction cursor advance, ORDER BY id, the five-event vocabulary, no-permission-to-send rule (`sm8_connections.paused_at` must be checked by dispatch), and why backfilled/untriaged quotes emit nothing
- `src/db/schema/quotes.ts` — quote mirror shape, `chase_eligibility` (D-15 Phase 2), raw+UTC timestamp pairs, `sm8_active` deletion semantics, QUOTE_STATUSES vocabulary
- `src/db/schema/tenants.ts` — contact-hours window (start/end + ISO weekday array), IANA timezone rule, tenancy/RLS pattern every new table replicates
- `.planning/phases/02-servicem8-sync-quote-leakage-audit/02-CONTEXT.md` — Phase 2 decisions this phase honours: D-08 (pause/resume + re-window on auth recovery), D-15 (chase eligibility triage), D-16 (status history retention)

### Project planning
- `.planning/REQUIREMENTS.md` — CAD-01..05 (this phase); MSG-01..04, AI-01..04, CON-01..04, RPT-01..03 (what consumes this phase's structures)
- `.planning/ROADMAP.md` — Phase 3 goal + success criteria; "Evidence-before-reporting invariant" note: the send ledger and cadence events are Phase 7's raw attribution material and cannot be reconstructed retroactively
- `.planning/STATE.md` — carried decisions: timezone validity = `Intl.supportedValuesOf('timeZone')` membership; no default contact-hours window exists anywhere; pooler URLs; drizzle-kit journal-ordering trap (tooling watch item)

### Foundations & patterns
- `src/db/repository/for-tenant.ts` — `forTenant()` closed-over scoping; cross-tenant engine work uses explicit `forAllTenants_<op>()` exports per this file's rule
- `src/app/api/internal/sync-tick/route.ts` — the shared-secret pg_cron→Vercel tick pattern (proxy.ts excludes api/; API routes own their auth)
- `src/db/schema/quote-contacts.ts` — mirrored job contacts the primary-contact rule (D-04) selects from
- `.claude/CLAUDE.md` §Background-Job Architecture / Supabase Specifics — pgmq/pg_cron platform facts; "What NOT to Use": no Vercel `waitUntil` for sends, queue + idempotency keys

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `quote_status_events` + `event_consumer_cursors` (Phase 2): the engine registers as consumer `'cadence-engine'` and scans forward by id — the outbox header comment is the integration spec
- `tenants` contact-hours columns + validated IANA timezone: all the data D-01/D-03/D-09 windowing math needs already exists, no schema addition for hours
- `quotes.chase_eligibility` + `sm8_connections.paused_at`: the two gates dispatch must check (eligibility for scheduling, pause for sending)
- Sync-tick route + pg_cron pattern (`scripts/` apply secret-bearing schedules from env; secret-free ones live in migrations)
- Test harness with real-DB integration tests (`tests/`, `tests/helpers/seed.ts`) — CAD-04's concurrent-tick ledger test and the RLS-coverage test for every new table belong here; Vitest for pure state-transition tests (no Postgres mocks needed)
- Clients/quotes console pages (`src/app/(console)/…`) — D-16's minimal cadence UI extends the existing quote detail page

### Established Patterns
- RLS via `pgPolicy` in schema definition; explicit per-table GRANTs; anon keeps SELECT
- drizzle-kit journal is sole migration authority via `scripts/migrate.mjs`; watch the journal-ordering trap (3 strikes in Phase 2)
- Timezone validity is `Intl.supportedValuesOf('timeZone')` membership — never try/catch around DateTimeFormat
- Money is `numeric`/integer-cents string math, never floats
- Events are facts, not commands; idempotence is the consumer's job; replay is legal

### Integration Points
- Inbound: `quote_status_events` (quote_opened starts cadences; won/lost/removed stop them; reopened → triage)
- Outbound: the pluggable sender interface (D-13) is the Phase 4 contract; touch lifecycle states (D-14) are the Phase 5/6 contract; send ledger + cadence event trail are Phase 7's attribution evidence
- Suppression table (D-15): written by contact-kill now, by Phase 4 STOP handling later; read by dispatch revalidation
- Dispatch checks `sm8_connections.paused_at IS NULL` itself — the outbox carries no permission to send

</code_context>

<specifics>
## Specific Ideas

- Jitter exists for brand reasons: messages landing at the identical minute every time read as robotic, and the tradie's brand is the thing being protected
- The min-gap/skip rule (D-10) and staleness cap (D-11) encode the same principle: a late touch is worse than a skipped touch — never let mechanics make the client look spammy
- The kill switch must be phone-reachable from the first real cadence — "a kill switch you can't reach from your phone isn't a kill switch"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-Cadence Engine*
*Context gathered: 2026-08-27*
