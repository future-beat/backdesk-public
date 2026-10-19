# Phase 2: ServiceM8 Sync & Quote Leakage Audit - Context

**Gathered:** 2026-08-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Every connected client's open quotes mirror into the system reliably (per-client private API key + edit_date-cursor polling now; webhooks later only as hints-to-poll), won/lost status transitions become events the cadence engine (Phase 3) can consume, sync/auth failures pause that client's cadences and alert the operator immediately, and the operator can generate a one-page Quote Leakage Audit from any prospect's data (read-only API key or CSV export), with the prospect's baseline win rate snapshotted for later net-of-baseline attribution.

Requirements: ONB-02, SYNC-01, SYNC-02, SYNC-03, SYNC-04, AUD-01, AUD-02. Cadence sending, messaging, drafting, and reporting are later phases — this phase produces the data and events they consume.

</domain>

<decisions>
## Implementation Decisions

### Prospect data model
- **D-01:** Audit prospects are a **separate lightweight `prospects` table**, not tenants. A prospect record carries business name, data source (API key or CSV), audit results, and the baseline win-rate snapshot. `tenants` keeps meaning "paying/onboarding client" with full contact-hours machinery. — **Reversibility:** costly — merging prospects into tenants later means a data migration plus rewriting every audit query and the conversion flow.
- **D-02:** Conversion links, never copies: when a prospect becomes a client, the new tenant row references the prospect record; the baseline win-rate snapshot stays on the prospect record and Phase 7 reporting reads it through the link. No duplicated truth.
- **D-03:** Prospect quote lines (the last-90-days rows feeding the audit) live in **separate audit tables keyed by `prospect_id`** — the tenant-scoped sync tables stay pure: every row there has a real tenant and can feed cadences. A converted client's ongoing sync starts fresh; audit rows never migrate into sync tables.
- **D-04:** Retention: raw prospect quote/contact lines **auto-purge after ~30 days** unless the prospect converts. Audit aggregate figures and the baseline win-rate snapshot persist indefinitely. Minimises Privacy Act exposure for businesses that never sign.

### Sync health & auth-failure handling
- **D-05:** Auth-failure alerting = **immediate email to the operator + persistent red banner** on that client in the console. No SMS dependency in this phase (the SMS gateway is Phase 4).
- **D-06:** Failure classification: a **401/403 (bad/revoked key) pauses that client's cadences and alerts on first occurrence** — keys don't un-revoke themselves. Network errors, 429s, and 5xx retry with backoff and only alert after ~3 consecutive failed polling cycles. No false-pause on transient errors; no silent dead client.
- **D-07:** Sync health UI: **status badge (healthy / degraded / auth-failed / never-synced) + last-successful-sync time on the client list**; the client detail page adds recent sync runs, quote counts, and error details. Reuses the Phase 1 clients pages.
- **D-08:** Recovery: **auto-resume on verified key**. Saving a new API key triggers an immediate test call; success resumes sync and clears the pause flag automatically. Pause state must be recorded such that Phase 3 cadences honour it, and touches that came due during a pause re-window (per CAD-02) rather than sending in a burst.

### Quote Leakage Audit report
- **D-09:** Recoverable estimate = **never-followed-up value × a conservative fixed recovery rate (~15–20%, one number picked from GTM research and used for every prospect)**. Comparable across audits; under-promising protects the 3×-fees guarantee.
- **D-10:** "Never followed up" = **no job activity, note, or status change after the quote date plus a ~3-day grace period**, computed from ServiceM8 job activity/status data. The approximation is stated as a footnote on the report — honesty is part of the pitch.
- **D-11:** Audit output is a **print-styled web page** (console route, styled to one A4 page; browser print-to-PDF when a file is needed). No PDF generation library in v1. Must render well on a phone in a sales meeting.
- **D-12:** Audit input: **read-only private API key first** (exercises the same fetch code as client sync), **CSV upload (ServiceM8 job export) as fallback** for prospects unwilling to share a key. Both paths land in the same audit tables and produce the same report.

### Polling & backfill
- **D-13:** Polling interval: **5 minutes, fixed, all clients** (pg_cron driven). ~288 polls/day/client — comfortably inside 180/min and 20k/day per-account limits at founding-cohort scale.
- **D-14:** Initial backfill on connect: **90 days of quotes — open, won, and lost**. The won/lost history doubles as the client's baseline win rate (same window and code path as the audit); open ones become cadence candidates.
- **D-15:** Stale-quote triage: backfilled open quotes land as **"needs review"; the operator ticks which ones become chase-eligible during onboarding**. No blanket auto-chase of an old pile — protecting the client's brand is the white-glove differentiator. Sync stores the eligibility flag; Phase 3 honours it.
- **D-16:** Synced quotes persist with full status history; the console **defaults to open quotes with a status filter** to see won/lost. Phase 7 reporting needs the win history regardless.

### Claude's Discretion
- Event mechanism/schema for status-transition events (SYNC-02) — design for Phase 3 consumption; researcher/planner pick the pattern (e.g., events table with consumer cursor).
- API key storage/encryption approach — must be server-side only, never exposed to the browser; exact mechanism is planner's choice.
- CSV column mapping and validation UX for the audit fallback path.
- Exact backoff parameters, sync-run logging schema, and the sync worker's route/endpoint design.
- The precise conservative recovery-rate number (pick one defensible from GTM research, make it a named constant).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project planning
- `.planning/REQUIREMENTS.md` — ONB-02, SYNC-01..04, AUD-01, AUD-02 definitions (this phase); CAD-01..05 (what Phase 3 will consume)
- `.planning/ROADMAP.md` — Phase 2 goal and success criteria
- `.planning/STATE.md` — Phase 1 decisions carried forward (pooler URLs, migration authority, forTenant pattern) and the ServiceM8 partner-registration watch item

### ServiceM8 integration
- `.claude/CLAUDE.md` §ServiceM8 Integration Facts — auth modes, quotes-are-jobs lifecycle, endpoints, rate limits, webhook behaviour (verified Aug 2026)
- `docs/external-registrations.md` — ServiceM8 Development Partner registration status (submitted 2026-08-25; private API keys are the no-approval bridge)

### Phase 1 foundations
- `.planning/phases/01-foundation-tenancy/01-RESEARCH.md` — RLS pgPolicy pattern, SECURITY DEFINER helper, repository patterns this phase must follow
- `src/db/schema/tenants.ts` — the schema conventions (pgPolicy attached in schema, IANA timezone rule) every new table must replicate
- `src/db/repository/for-tenant.ts` — `forTenant()` closed-over scoping; cross-tenant sync work must use explicit `forAllTenants_<operation>()` exports per this file's stated rule

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `forTenant(tenantId)` repository (`src/db/repository/for-tenant.ts`): the only sanctioned tenant-data path; the sync worker polling all clients needs `forAllTenants_<op>()` exports per the documented convention
- Clients console pages (`src/app/(console)/clients/…`): client list and detail pages exist — sync health badge/detail and the API-key connect form extend these
- `scripts/migrate.mjs` + drizzle-kit journal: sole migration authority; new tables (quotes, sync runs, events, prospects, audit tables) follow the pgPolicy-in-schema pattern
- Test harness (`tests/` with real-DB integration tests, `tests/helpers/seed.ts`): RLS leak tests exist; new tenant-scoped tables must join the rls-coverage test
- `src/core/shared/env.ts`: env validation pattern for new secrets (encryption key, alert email config)

### Established Patterns
- RLS via `pgPolicy` in schema definition — a new table cannot ship unprotected by omission
- Explicit per-table GRANTs in migrations; anon keeps SELECT so denial and absence are indistinguishable
- Timezone validity = membership in `Intl.supportedValuesOf('timeZone')` — ServiceM8 timestamp normalisation (SYNC-03: UTC vs account-local) must respect this
- Database errors asserted against real PostgREST errors in integration tests, not hand-written stand-ins
- Supabase pooler URLs only (session 5432 for migrations, transaction 6543 for runtime)

### Integration Points
- pg_cron (Supabase Cron) → protected Vercel route handler: the 5-minute sync tick (pattern penciled in CLAUDE.md; first actual use is this phase)
- Status-transition events: produced here, consumed by Phase 3 cadence engine — the contract between phases
- Pause flag on tenant/connection: written here on auth failure, honoured by Phase 3 dispatch
- Baseline win-rate snapshot: written here (prospect record), read by Phase 7 net-of-baseline reporting through the prospect→tenant link

</code_context>

<specifics>
## Specific Ideas

- The audit is a **sales artifact**: one A4 page, phone-renderable, honest footnotes on methodology — it gets handed to a prospect in a meeting
- Old open quotes can be gold ("following up on that quote from March") but only after deliberate operator triage — never auto-chase a backfilled pile
- The 90-day backfill window deliberately matches the audit window so client sync and prospect audit share one fetch/aggregation code path

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 2-ServiceM8 Sync & Quote Leakage Audit*
*Context gathered: 2026-08-26*
