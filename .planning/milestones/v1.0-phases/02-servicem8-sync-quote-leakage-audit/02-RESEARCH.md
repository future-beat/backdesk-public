# Phase 2: ServiceM8 Sync & Quote Leakage Audit - Research

**Researched:** 2026-08-26
**Domain:** ServiceM8 REST API integration (private API key polling), incremental sync with cursor semantics, transactional status-event emission, prospect audit pipeline (API + CSV), Supabase pg_cron→Vercel worker pattern, API-key encryption at rest
**Confidence:** MEDIUM-HIGH — ServiceM8 field-level facts (the STATE.md LOW-confidence flag) are now resolved against official `developer.servicem8.com` reference pages fetched this session; the two remaining genuine unknowns (edit_date timezone behaviour, cursor pagination mechanics) are neutralized by design (opaque cursor + overlap window) and covered by an early spike task against the trial account

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Prospect data model
- **D-01:** Audit prospects are a **separate lightweight `prospects` table**, not tenants. A prospect record carries business name, data source (API key or CSV), audit results, and the baseline win-rate snapshot. `tenants` keeps meaning "paying/onboarding client" with full contact-hours machinery. — **Reversibility:** costly — merging prospects into tenants later means a data migration plus rewriting every audit query and the conversion flow.
- **D-02:** Conversion links, never copies: when a prospect becomes a client, the new tenant row references the prospect record; the baseline win-rate snapshot stays on the prospect record and Phase 7 reporting reads it through the link. No duplicated truth.
- **D-03:** Prospect quote lines (the last-90-days rows feeding the audit) live in **separate audit tables keyed by `prospect_id`** — the tenant-scoped sync tables stay pure: every row there has a real tenant and can feed cadences. A converted client's ongoing sync starts fresh; audit rows never migrate into sync tables.
- **D-04:** Retention: raw prospect quote/contact lines **auto-purge after ~30 days** unless the prospect converts. Audit aggregate figures and the baseline win-rate snapshot persist indefinitely. Minimises Privacy Act exposure for businesses that never sign.

#### Sync health & auth-failure handling
- **D-05:** Auth-failure alerting = **immediate email to the operator + persistent red banner** on that client in the console. No SMS dependency in this phase (the SMS gateway is Phase 4).
- **D-06:** Failure classification: a **401/403 (bad/revoked key) pauses that client's cadences and alerts on first occurrence** — keys don't un-revoke themselves. Network errors, 429s, and 5xx retry with backoff and only alert after ~3 consecutive failed polling cycles. No false-pause on transient errors; no silent dead client.
- **D-07:** Sync health UI: **status badge (healthy / degraded / auth-failed / never-synced) + last-successful-sync time on the client list**; the client detail page adds recent sync runs, quote counts, and error details. Reuses the Phase 1 clients pages.
- **D-08:** Recovery: **auto-resume on verified key**. Saving a new API key triggers an immediate test call; success resumes sync and clears the pause flag automatically. Pause state must be recorded such that Phase 3 cadences honour it, and touches that came due during a pause re-window (per CAD-02) rather than sending in a burst.

#### Quote Leakage Audit report
- **D-09:** Recoverable estimate = **never-followed-up value × a conservative fixed recovery rate (~15–20%, one number picked from GTM research and used for every prospect)**. Comparable across audits; under-promising protects the 3×-fees guarantee.
- **D-10:** "Never followed up" = **no job activity, note, or status change after the quote date plus a ~3-day grace period**, computed from ServiceM8 job activity/status data. The approximation is stated as a footnote on the report — honesty is part of the pitch.
- **D-11:** Audit output is a **print-styled web page** (console route, styled to one A4 page; browser print-to-PDF when a file is needed). No PDF generation library in v1. Must render well on a phone in a sales meeting.
- **D-12:** Audit input: **read-only private API key first** (exercises the same fetch code as client sync), **CSV upload (ServiceM8 job export) as fallback** for prospects unwilling to share a key. Both paths land in the same audit tables and produce the same report.

#### Polling & backfill
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ONB-02 | Operator can connect a client's ServiceM8 account (private API key now; OAuth when partner approval lands) and see sync health per client | X-API-Key header auth verified against official docs (§ServiceM8 Facts); `sm8_connections` schema sketch + connect-form flow (Pattern 4); key-verification test call and auto-resume design (Pattern 5); health badge derivation (Pattern 5) |
| SYNC-01 | System syncs jobs in status Quote (value, contact, dates) per client via edit_date-cursor polling, inside ServiceM8 rate limits | Job/JobContact field inventory verified (§ServiceM8 Facts); opaque-cursor + overlap-window polling design (Pattern 1); rate-limit budget math (Pattern 2); zero-date and string-money parsing pitfalls (Pitfalls 3, 4) |
| SYNC-02 | System detects status transitions (won/lost) and emits events the cadence engine consumes | Verified status enum (`Quote`/`Work Order`/`Completed`/`Unsuccessful`) + per-status timestamp fields; transactional outbox `quote_status_events` design with consumer cursor (Pattern 3) |
| SYNC-03 | Webhooks act as hints-to-poll with UTC/account-local timestamp normalisation — polling remains the guarantee | Opaque-cursor design makes sync correctness timezone-independent (Pattern 1); normalization strategy for display/grace-period math (Pattern 1); webhook facts already verified in CLAUDE.md — thin adapter design (Pattern 2) |
| SYNC-04 | Sync/auth failures pause that client's cadences and alert the operator immediately | Error-classification table (401/403 vs 429/5xx/network) per D-06 (Pattern 5); pause flag placement consumed by Phase 3; Resend operator-alert path (§Alerting) |
| AUD-01 | One-page audit from prospect's read access or CSV: quotes issued, value, never-followed-up value, recoverable estimate | Shared 90-day fetch/aggregation code path (Pattern 6); note.json + jobactivity.json bulk-fetch join for "never followed up" (Pattern 6); CSV flexible column mapping (Pattern 7); print-CSS one-pager (D-11) |
| AUD-02 | Audit snapshots the prospect's baseline win rate for later net-of-baseline attribution | Baseline computed from the same 90-day window (quote_date in window → terminal status now); snapshot columns on `prospects`; tenant→prospect link per D-02 (Pattern 6) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **GSD workflow enforcement:** all file changes through GSD commands; planned work via `/gsd-execute-phase`
- **Stack is locked:** TypeScript 5.9.x, Next.js 16.3.2 (`proxy.ts`, no `next lint`), Supabase Sydney, drizzle-orm + drizzle-kit (never Prisma), zod v4 at every boundary, thin typed `fetch` wrapper for external REST APIs (explicitly: skip generated SDKs)
- **ServiceM8 Integration Facts section is authoritative** for auth modes, webhook behaviour, rate limits (180/min, 20k/day per app per connected account), quotes-are-jobs lifecycle — verified Aug 2026 and re-confirmed this session
- **What NOT to Use:** full-table polling loops (use webhooks + incremental `edit_date` fetch + daily reconciliation), free-text LLM parsing, `waitUntil` for must-happen work
- **AU data residency posture:** DB + auth AU-resident; note honestly that Vercel functions process data outside AU unless `syd1` set — sync worker route should pin `syd1` in `vercel.json`
- **Timezone rule:** IANA identifiers only, validity = membership in `Intl.supportedValuesOf('timeZone')` — never UTC offsets

## Summary

The LOW-confidence ServiceM8 field questions from STATE.md are now settled against the official API reference (the `.md` variants of `developer.servicem8.com/reference/*` pages are directly fetchable). The Job object's `status` is a required enum of exactly `Quote`, `Work Order`, `Unsuccessful`, `Completed`; each status has its own transition timestamp (`quote_date`, `work_order_date`, `completion_date`, `unsuccessful_date`); `edit_date` is a read-only last-modified timestamp; `total_invoice_amount` is a read-only *string*. Filtering supports only `eq/ne/gt/lt` (no `ge`/`le`), `and`-only combination, max 10 conditions, with `cursor`-based pagination. Two things the docs do **not** settle: the timezone of ServiceM8 timestamps (a community thread reports `edit_date` appearing "in the future" against a GMT+8 account) and exact cursor-pagination mechanics.

The design answer to the timezone gap is the most important recommendation in this document: **treat `edit_date` as an opaque monotonic value in ServiceM8's own clock — never compare it to our wall clock.** The sync cursor is simply the maximum `edit_date` string seen in the last successful fetch, minus a fixed overlap window, with UUID-level dedupe on re-fetched rows. That makes sync correctness immune to whatever timezone ServiceM8 uses. Normalization to UTC (SYNC-03) then matters only for *display* and for the audit's 3-day grace-period math, where the tenant/prospect's configured IANA timezone is the interpretation and ±hours of skew is immaterial against a 3-day threshold. An early spike against the founder's trial account pins down the actual offset and the pagination behaviour before the polling worker is finalized.

Two discovery corrections that change the plan: (1) `jobactivity.json` is a **staff scheduling/time record**, not a communications log — so D-10's "never followed up" detection uses `quote_sent`/`quote_sent_stamp` on the job, `note.json` entries, JobActivity entries after the quote date, and status-change timestamps, fetched in bulk (one filtered request per resource, joined in memory by `job_uuid`) rather than per-job N+1 calls. (2) The Company object has **no email/mobile fields** — customer contact details live on `jobcontact.json` (typed `JOB`/`BILLING`/`Property Manager`), so contact sync is a separate cursor-fetched resource joined to jobs.

**Primary recommendation:** Build one `Sm8Client` (thin typed fetch wrapper, zod-parsed, error-classified) used by three consumers — client sync, prospect audit, and connect-time key verification; drive the 5-minute tick with pg_cron→`net.http_post`→a shared-secret-protected Vercel route; persist quotes/contacts/events in tenant-scoped drizzle tables following the Phase 1 pgPolicy pattern; encrypt API keys app-side with AES-256-GCM (`node:crypto`, key in server env); and emit status transitions as a transactional outbox table with a Phase 3 consumer cursor.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 5-minute tick scheduling | Database (pg_cron + pg_net) | — | Already-enabled extensions; survives Vercel deploys; schedule lives in a migration [VERIFIED: src/db/migrations/0000_extensions_and_tenant_access.sql:4-6 — `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net; CREATE EXTENSION IF NOT EXISTS pgmq;`] |
| Sync worker (poll, upsert, detect transitions) | API/Backend (Vercel route handler, `src/core/sync`) | Database | Needs Node fetch + zod + crypto; per-tenant isolation logic is code, not SQL |
| ServiceM8 HTTP client + parsing | API/Backend (`src/core/servicem8`) | — | Framework-free module per Phase 1 `src/core` contract; shared by sync, audit, key-verify |
| API key encryption/decryption | API/Backend (`src/core/shared/crypto`) | Deployment env (key material) | Key never in DB or browser; ciphertext in Postgres |
| Quote mirror, events, sync runs persistence | Database (tenant-scoped tables, RLS) | API/Backend (`forTenant`/`forAllTenants_*`) | Phase 1 pattern: pgPolicy in schema, repository the only service-role path |
| Status-transition event contract (SYNC-02) | Database (outbox table) | API/Backend (Phase 3 consumer) | Same-DB single consumer: events table + cursor beats a queue for testability |
| Sync health UI, connect form, triage checklist | Frontend Server (server components + actions) | Database | Extends existing `(console)/clients` pages; actions authorize their own caller (WR-01 rule) |
| Audit report page | Frontend Server (print-styled server component) | — | D-11: print CSS, no PDF lib |
| CSV upload + mapping | Frontend Server (server action) | API/Backend (papaparse in action) | File never needs client-side parsing; server action validates with zod |
| Operator alert email | API/Backend (`src/core/alerts`) | External (Resend) | D-05 immediate email; red banner is derived console state, not a send |
| Auth-failure pause flag | Database (`sm8_connections` row) | API/Backend (Phase 3 dispatch reads it) | The cross-phase contract: pause is data, not behaviour |
| Prospect data purge (D-04) | Database (pg_cron SQL job) | — | Pure SQL delete on `purge_after < now()`; no HTTP needed |

## Standard Stack

No new core infrastructure — this phase extends the Phase 1 stack (already installed and version-verified in `package.json` [VERIFIED: package.json — next 16.3.2, drizzle-orm 0.45.2, zod 4.4.3, vitest 4.1.11]).

### Core (already installed — reuse)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 | New tables (quotes, events, sync runs, prospects) + migrations | Phase 1 pgPolicy-in-schema pattern is established; `scripts/migrate.mjs` is the sole migration authority |
| `zod` | 4.4.3 | ServiceM8 response parsing, CSV row validation, env additions | Every boundary crossing per CLAUDE.md |
| Native `fetch` + thin wrapper | Node 22 built-in | ServiceM8 REST calls | CLAUDE.md explicitly: thin typed fetch wrapper, no generated SDK |
| `node:crypto` | Node 22 built-in | AES-256-GCM for API keys at rest | No new dependency; standard construction (see Pattern 4) |

### Supporting (new this phase)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `papaparse` | 5.7.0 [VERIFIED: npm registry] | CSV parsing for the audit fallback (D-12) | Server-action parsing of uploaded ServiceM8 job exports; battle-tested against Excel-mangled CSVs (quoted fields, BOM, mixed line endings) |
| `date-fns` | 4.4.0 [VERIFIED: npm registry] | Date arithmetic (90-day windows, 3-day grace) | Locked stack choice; first use lands this phase |
| `@date-fns/tz` | 1.5.0 [VERIFIED: npm registry] | `TZDate` — interpret ServiceM8 timestamps in a tenant's IANA timezone | **First-party** date-fns v4 timezone package (37M downloads/wk); supersedes the older community `date-fns-tz` listed in CLAUDE.md — see State of the Art |
| `resend` | latest at install | Operator alert email (D-05) | Already the project's chosen email provider (Phase 4); free tier suffices for operator-only alerts now [ASSUMED — sandbox/free-tier rules verified at signup, see Open Questions] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `papaparse` | `csv-parse` 7.0.2 (also legitimacy-checked OK) | csv-parse is stream-oriented Node-only; papaparse's forgiving auto-detection (delimiters, headers) fits an unknown export format better |
| App-layer AES-256-GCM | Supabase Vault (`vault.create_secret` / `vault.decrypted_secrets`) | Vault is the Supabase-blessed path and survives DB dumps encrypted [CITED: supabase.com/docs/guides/database/vault], but any service-role DB session can decrypt; app-layer keeps the decryption key entirely out of the database (DB compromise alone leaks nothing) and works in CI/local Postgres without extensions. pgsodium directly is **pending deprecation** — do not use [CITED: supabase.com/docs/guides/database/extensions/pgsodium] |
| pg_cron→`net.http_post`→Vercel route | Vercel Cron | Vercel Cron is plan-limited and lives outside the DB; pg_cron keeps schedule + monitoring (`cron.job_run_details`) in migrations and one dashboard — and pg_cron/pg_net are already enabled |
| Events table + consumer cursor | pgmq queue for events | pgmq shines for competing consumers and per-message retry (Phase 3+ sends); SYNC-02 has exactly one consumer reading in order — a bigserial outbox with a cursor row is simpler, replayable, and trivially testable |

**Installation:**
```bash
npm install papaparse date-fns @date-fns/tz resend
npm install -D @types/papaparse
```

**Version verification:** `papaparse@5.7.0`, `date-fns@4.4.0`, `@date-fns/tz@1.5.0`, `csv-parse@7.0.2` confirmed via `npm view <pkg> version` this session (2026-08-26). Re-verify and pin exact versions at execution.

## Package Legitimacy Audit

Ran `gsd-tools query package-legitimacy check --ecosystem npm` on all new candidates this session:

| Package | Registry | Latest publish | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| papaparse | npm | 2026-08-24 | 15.3M/wk | github.com/mholt/PapaParse | [SUS: too-new] | Flagged — pin exact `5.7.0`; no postinstall; canonical package, flag caused only by recent patch date |
| csv-parse | npm | 2026-08-02 | 18.7M/wk | github.com/adaltas/node-csv | [SUS: too-new] | Alternative only; same signal cause; not installed unless papaparse rejected |
| date-fns | npm | 2026-05-29 | 101.7M/wk | github.com/date-fns/date-fns | [OK] | Approved |
| @date-fns/tz | npm | 2026-05-21 | 37.3M/wk | github.com/date-fns/date-fns | [OK] | Approved |
| date-fns-tz | npm | 2024-09-30 | 11.2M/wk | github.com/marnusw/date-fns-tz | [OK] | Not recommended (superseded by @date-fns/tz for date-fns v4) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** papaparse (and alternative csv-parse) — solely `too-new` latest-patch timestamps on canonical 15M+/wk packages with `postinstall: null`. Per the Phase 1 precedent, cover with a single `checkpoint:human-verify` at the install task rather than per-package noise. `resend` was not legitimacy-checked this session (install lands with the alerting task) — planner must run the check before that install [ASSUMED].

## ServiceM8 API Facts (verified this session)

All from official reference pages (`developer.servicem8.com` — the `.md` suffix variants render cleanly; the index is `developer.servicem8.com/llms.txt`).

### Job object — `GET /api_1.0/job.json` [CITED: developer.servicem8.com/reference/listjobs.md]

| Field | Type | Notes |
|-------|------|-------|
| `uuid` | string (uuid) | Primary identifier — the sync natural key |
| `active` | integer 0/1 | "Record active/deleted flag" — **0 = deleted; do NOT filter it out of the cursor fetch** (Pitfall 6) |
| `edit_date` | string timestamp, read-only | "Timestamp at which record was last modified" — the cursor field |
| `status` | string enum, **required** | "Valid values: Quote, Work Order, Unsuccessful, Completed" |
| `date` | string YYYY-MM-DD | "The date the job was created or scheduled" — community reports `0000-00-00 00:00:00` on API-created jobs (Pitfall 3) |
| `quote_date` | string timestamp | "Date and time job status changed to Quote" |
| `work_order_date` | string timestamp | "Date and time job status changed to Work Order" — the **won** timestamp |
| `completion_date` | string timestamp | "Date and time job status changed to Completed" |
| `unsuccessful_date` | string timestamp | "Date and time job status changed to Unsuccessful" — the **lost** timestamp |
| `quote_sent` / `quote_sent_stamp` | int 0/1 / timestamp (read-only) | Whether/when a quote was sent — feeds D-10 follow-up detection |
| `total_invoice_amount` | **string**, read-only | "Total amount to be invoiced" — parse to numeric, store as `numeric(12,2)` (Pitfall 4) |
| `company_uuid` | string (uuid) | Client/company link |
| `job_address`, `job_description`, `billing_address` | string | Display fields for the console/audit |
| `generated_job_id` | string | Human-readable job number for the operator UI |
| `category_uuid`, `badges`, geo fields, queue fields, payment flags | various | Not needed this phase; keep raw JSON if stored |

OAuth scope `read_jobs`; rate limits restated on the reference page: 180 requests/minute, 20,000/day.

### Filtering — [CITED: developer.servicem8.com/docs/filtering]

- Syntax: `GET /api_1.0/{resource}.json?$filter={field} {op} {value}`
- Operators: **only `eq`, `ne`, `gt`, `lt`** — the docs state verbatim: "Greater than or equal (ge) and less than or equal (le) operators are not currently supported."
- Combination: `and` only ("Only and operator is supported (no or or not)"), **max 10 conditions**
- Date literals: quoted strings — documented example `create_date gt '2023-01-01'`; whether datetime-precision literals (`'2026-08-26 03:00:00'`) filter correctly on `edit_date` is **undocumented** [ASSUMED — spike task, Open Question 1]
- Pagination: documented example `GET /api_1.0/job.json?$filter=active eq 1&cursor=-1` — a `cursor` query parameter exists, but the mechanics (page size, next-cursor location) are undocumented [ASSUMED — spike task, Open Question 2]
- No `or` means "status in (Quote, Unsuccessful)" is impossible in one request — use one request per status, or a single date-field filter that spans statuses (Pattern 6)

### Company object — `GET /api_1.0/company.json` [CITED: developer.servicem8.com/reference/listclients.md]

Fields: `uuid`, `active`, `edit_date`, `name`, `abn_number`, `address` (+ `address_street/city/state/postcode/country`), `billing_address`, `billing_attention`, `is_individual`, `fax_number`, `website`, `parent_company_uuid`, `tax_rate_uuid`, `badges`, `payment_terms`, `deposit_percent`. **No email or mobile fields** — customer contact details are NOT on the company. OAuth scope `read_customers`.

### JobContact object — `GET /api_1.0/jobcontact.json` [CITED: developer.servicem8.com/reference/listjobcontacts.md]

Fields: `uuid`, `active`, `edit_date`, `job_uuid` ("cannot be changed once set"), `first`, `last`, `phone`, `mobile`, `email`, `type` — "Valid values are: 'JOB' (or 'Job Contact'), 'BILLING' (or 'Billing Contact'), or 'Property Manager'"; `is_primary_contact` is DEPRECATED. OAuth scope `read_job_contacts`. **This is where the cadence's recipient phone/email comes from.**

### JobActivity object — `GET /api_1.0/jobactivity.json` [CITED: developer.servicem8.com/reference/listjobactivities.md]

**A staff scheduling/time-allocation record** (`job_uuid`, `staff_uuid`, `start_date`, `end_date`, `activity_was_scheduled`, `activity_was_recorded`, `has_been_opened`…), scope `read_schedule`. It is *not* a communications log. It still counts as "job activity" for D-10 (a scheduled/recorded visit after the quote date = the tradie did something), but email/SMS follow-ups sent from ServiceM8 are not visible here.

### Note object — `GET /api_1.0/note.json` [CITED: developer.servicem8.com/reference/listnotes.md]

Fields: `uuid`, `active`, `edit_date`, `related_object`, `related_object_uuid`, `note`, `action_required`, `create_date`, `edit_by_staff_uuid`. Scope `read_job_notes`. Join to jobs via `related_object_uuid` = job uuid.

### Authentication — [CITED: developer.servicem8.com/docs/authentication.md]

- Private app: "include it in all API requests by setting it in the **X-API-Key header**"; keys generated at "Settings -> API Keys" in the client's own account — zero partner approval
- OAuth (when partner approval lands): `go.servicem8.com/oauth/authorize` → `/oauth/access_token`, access token lifetime "3600 seconds", `authorization_code` + `refresh_token` grants, Bearer header; scope-limited apps "unlock a higher rate limit"
- Design consequence: the `Sm8Client` takes an auth strategy (`{ kind: 'apiKey', key }` now; `{ kind: 'oauth', ... }` later) so the OAuth swap is a constructor change, not a rewrite

### Timestamp timezone — UNRESOLVED upstream, neutralized by design

The reference pages never state the timezone of `edit_date`/`quote_date`/etc. A developer-forum thread ("Job edit_date", developer.servicem8.com/discuss/5ad6b02364c441000369046e) reports `edit_date` values appearing *in the future* against a correctly-configured GMT+8 (Western Australia) account [ASSUMED — community report surfaced via search; the thread itself would not render this session]. Treat the timezone as unknown-per-account and design around it (Pattern 1). CLAUDE.md's webhook facts (challenge POST, UUID+changed-fields payload, re-fetch required, 72h retries, 429→15min throttle, 410 auto-unsubscribe) remain the authority for the webhook adapter.

## Architecture Patterns

### System Architecture Diagram

```
                       ┌────────────────────────────────────────────────────┐
                       │ SUPABASE (ap-southeast-2)                          │
   every 5 min         │                                                    │
  ┌─────────────┐      │  pg_cron: 'sync-tick' ── net.http_post ──────────┐ │
  │  pg_cron    │──────│  pg_cron: 'purge-prospect-lines' (SQL, daily)    │ │
  └─────────────┘      │  pg_cron: 'cron-details-cleanup' (SQL)           │ │
                       └───────────────────────────────────────────────────┼─┘
                                          shared-secret Authorization      │
                                                                           ▼
  ┌────────────────────────────────────────────────────────────────────────────┐
  │ NEXT.JS 16 (Vercel syd1)                                                   │
  │                                                                            │
  │  POST /api/internal/sync-tick  (maxDuration 300, excluded from proxy auth, │
  │                                 timing-safe secret check)                  │
  │       │  for each connection due (not paused):                            │
  │       ▼                                                                    │
  │  src/core/sync/run-sync.ts ──► src/core/servicem8/Sm8Client               │
  │       │   1. fetch job.json      $filter=edit_date gt '<cursor-overlap>'   │──► api.servicem8.com
  │       │   2. fetch jobcontact.json (own cursor)                            │    (X-API-Key,
  │       │   3. zod-parse, normalize zero-dates, parse money                  │     180/min, 20k/day)
  │       ▼                                                                    │
  │  ONE TRANSACTION per tenant:                                               │
  │    upsert quotes ─► diff old/new status ─► INSERT quote_status_events      │
  │    advance cursor ─► INSERT sync_runs                                      │
  │    on 401/403: paused_at=now(), alert email (Resend) ── red banner derives │
  │    on 429/5xx/network: consecutive_failures++, alert at 3                  │
  │                                                                            │
  │  (console)/clients        ── health badge + last-sync (D-07)               │
  │  (console)/clients/[id]   ── sync runs, quote list (open default, D-16),   │
  │                              triage checklist (D-15), connect form (ONB-02)│
  │  (console)/audits/new     ── prospect: API key OR CSV upload (papaparse)   │
  │  (console)/audits/[id]    ── print-styled A4 report page (D-11)            │
  │                                                                            │
  │  POST /api/webhooks/servicem8  (future, when OAuth lands): challenge reply,│
  │        verify, then ENQUEUE A POLL for that tenant — same fetch path       │
  └────────────────────────────────────────────────────────────────────────────┘
            │ postgres.js 6543 via forTenant()/forAllTenants_*()
            ▼
   Tables: sm8_connections · quotes · quote_contacts · quote_status_events
           sync_runs · prospects · prospect_quote_lines (30-day purge)
   Phase 3 contract: quote_status_events + event_consumer_cursors,
                     sm8_connections.paused_at, quotes.chase_eligibility
```

### Recommended Project Structure (additions)

```
src/
├── core/
│   ├── servicem8/
│   │   ├── client.ts          # Sm8Client: typed fetch wrapper, X-API-Key, error classification
│   │   ├── schemas.ts         # zod schemas: job, jobcontact, note, jobactivity (+ zero-date/money coercion)
│   │   ├── types.ts           # NormalizedQuote, NormalizedContact, Sm8Error taxonomy
│   │   └── pagination.ts      # cursor-param handling (shaped by spike findings)
│   ├── sync/
│   │   ├── run-sync.ts        # per-connection sync: fetch → normalize → upsert → events
│   │   ├── cursor.ts          # opaque-cursor + overlap window (pure, unit-tested)
│   │   ├── transitions.ts     # (oldStatus, newStatus) → event classification (pure)
│   │   └── failure-policy.ts  # D-06 classification: pause vs backoff vs alert (pure)
│   ├── audit/
│   │   ├── aggregate.ts       # 90-day metrics from normalized rows (SHARED with backfill baseline)
│   │   ├── followup.ts        # D-10 never-followed-up detection (pure, bulk-join)
│   │   ├── csv-mapping.ts     # header→canonical-field mapping + zod row validation
│   │   └── constants.ts       # AUDIT_RECOVERY_RATE, GRACE_PERIOD_DAYS, WINDOW_DAYS
│   ├── alerts/
│   │   └── operator-email.ts  # Resend send; alert dedupe (one email per failure episode)
│   └── shared/
│       └── crypto.ts          # AES-256-GCM encrypt/decrypt for API keys
├── db/
│   ├── schema/
│   │   ├── sm8-connections.ts · quotes.ts · quote-events.ts · sync-runs.ts · prospects.ts
│   └── repository/
│       ├── for-tenant.ts      # extended: quotes, connection accessors
│       └── for-all-tenants.ts # forAllTenants_syncTick() — the documented cross-tenant exception
├── app/
│   ├── api/internal/sync-tick/route.ts
│   └── (console)/audits/…     # new/[id] pages
```

### Pattern 1: Opaque edit_date cursor with overlap window (SYNC-01, SYNC-03)

**What:** The per-connection cursor is the **maximum `edit_date` string observed** in the last successful sync — never `now()` and never any value derived from our clock. Each poll fetches `$filter=edit_date gt '<cursor minus OVERLAP>'` where `OVERLAP` (recommend 15 minutes) is subtracted lexically-safely by parsing the timestamp *as a naive datetime* (no timezone attached), and re-fetched rows are deduped by upserting on `(tenant_id, sm8_job_uuid)`.

**Why this shape:** ServiceM8's timestamp timezone is unverified and community reports show skew against account-local expectations. Comparing ServiceM8 timestamps only to *other ServiceM8 timestamps* makes sync correctness timezone-proof: even if their clock is 8 hours off ours, `max(edit_date)` from their own data is still the correct high-water mark. The overlap window additionally absorbs (a) `gt`-only filtering (no `ge` — a record modified in the same second as the cursor would otherwise be lost), (b) clock jitter between ServiceM8 app servers, (c) any datetime-precision quirks in their filter parser.

**Normalization (the SYNC-03 deliverable):** store both `sm8_edit_date_raw` (verbatim string, feeds the cursor) and `edit_date_utc` (timestamptz) computed by interpreting the naive timestamp in an assumed zone. Default assumption: the ServiceM8 **account's local timezone = the tenant's configured IANA timezone** [ASSUMED — Open Question 3; the connect-time spike measures the real offset]. Timezone validity is `Intl.supportedValuesOf('timeZone')` membership per the Phase 1 rule [VERIFIED: src/db/schema/tenants.ts:33 — `timezone: text('timezone').notNull().default('Australia/Perth')` with the comment "IANA identifier, never a UTC offset"]. Use `@date-fns/tz`'s `TZDate` for the interpretation. Display and grace-period math tolerate hours of error against 3-day thresholds; nothing in the state machine may depend on sub-day precision of normalized SM8 timestamps.

**When to use:** every polled resource — `job.json` and `jobcontact.json` each keep their own cursor on the connection row.

### Pattern 2: pg_cron tick → shared-secret Vercel worker (SYNC-01, D-13)

**What:** A migration-managed `cron.schedule` posts to the worker route every 5 minutes [CITED: supabase.com/docs/guides/cron/quickstart]:

```sql
-- custom drizzle migration (drizzle-kit generate --custom)
select cron.schedule(
  'sm8-sync-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<app-domain>/api/internal/sync-tick',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || <secret from a vault/settings mechanism — see note>
    ),
    timeout_milliseconds := 8000
  ) as request_id;
  $$
);
```

**Key mechanics:**
- The route checks the bearer secret with `crypto.timingSafeEqual`, sets `export const maxDuration = 300` (Vercel Fluid default per CLAUDE.md), and pins region `syd1` via `vercel.json`
- **The secret must not be a plaintext literal in a committed migration.** Options: store it via Supabase Vault (`vault.create_secret`) and reference `(select decrypted_secret from vault.decrypted_secrets where name = 'sync_tick_secret')` in the cron SQL, or apply the schedule via a parameterized script (`scripts/`) rather than a migration. Planner picks; the Vault option keeps the "schedules live in migrations" rule intact [ASSUMED — Vault interop with pg_cron SQL is standard but unverified this session]
- `net.http_post` is fire-and-forget: the 8s timeout only covers request dispatch; the worker's own 300s window does the work. The tick returns 202 immediately after validating the secret and processes synchronously within the route's duration — at 15 clients × a few requests each, one tick completes in seconds
- Monitor via `cron.job_run_details`; it is "not cleaned up automatically" — add a weekly SQL cleanup job [CITED: supabase.com/docs/guides/cron/quickstart]
- **Proxy exclusion (Pitfall 7):** the Phase 1 matcher `'/((?!_next/static|_next/image|favicon.ico|login$|login/).*)'` [VERIFIED: proxy.ts:25] catches `/api/internal/sync-tick` and would redirect the cron POST to `/login`. The matcher must exclude `api/` (routes then own their auth — consistent with the WR-01 comment in proxy.ts that actions/routes authorize their own caller)
- Per-tenant error isolation: one client's failure must not abort the loop for the others — wrap each connection's sync in its own try/catch + transaction
- Webhook adapter (when OAuth lands): `POST /api/webhooks/servicem8` answers the challenge, then simply invokes the same `run-sync` for that tenant — "hints-to-poll" per SYNC-03; polling cadence unchanged

**Rate-limit budget:** 5-min polling = 288 ticks/day/client × ~2–4 requests (jobs + contacts + occasional pages) ≈ 600–1,200 requests/day per account against a 20,000/day per-account cap; burst is a handful of requests/min against 180/min. Backfill (~90 days) adds a few paged requests once. No throttling logic needed beyond honoring 429 backoff.

### Pattern 3: Status-transition events as a transactional outbox (SYNC-02)

**What:** In the *same transaction* that upserts a quote row, diff the previously-stored status against the fetched status and insert an event row when they differ. Phase 3 consumes by ordered scan past a cursor.

```
quote_status_events
  id            bigserial PK          -- consumer orders and cursors on this
  tenant_id     uuid NOT NULL
  quote_id      uuid NOT NULL         -- our row id; sm8_job_uuid also denormalized
  from_status   text NOT NULL         -- 'Quote' | 'Work Order' | 'Completed' | 'Unsuccessful' | '(new)'
  to_status     text NOT NULL
  event_type    text NOT NULL         -- 'quote_opened' | 'won' | 'lost' | 'reopened' | 'removed'
  occurred_at   timestamptz           -- best-effort from SM8 per-status timestamp (normalized)
  detected_at   timestamptz NOT NULL DEFAULT now()   -- authoritative ordering basis

event_consumer_cursors
  consumer      text PK               -- 'cadence-engine'
  last_event_id bigint NOT NULL DEFAULT 0
```

**Classification (pure function, exhaustively unit-tested):** `Quote → Work Order | Completed` = `won`; `Quote → Unsuccessful` = `lost`; `Work Order | Completed | Unsuccessful → Quote` = `reopened`; `active 1 → 0` = `removed`; first sight of an open quote = `quote_opened`. A direct `Quote → Completed` (skipping Work Order) is still `won` — never assume the 4 statuses progress linearly. Events are append-only facts; Phase 3 decides what each type means for a cadence.

**Why not pgmq here:** single consumer, same database, ordering matters, replay matters (Phase 7 reporting can re-read history). A cursor over bigserial gives all three; pgmq's visibility-timeout machinery buys nothing until there are competing consumers (Phase 3 sends — where it is already planned). [ASSUMED — standard transactional-outbox reasoning]

**Backfill discipline:** the initial 90-day backfill inserts quotes with their *current* statuses but must emit **no** won/lost events (nothing transitioned while we watched; emitting history would make Phase 3 react to pre-connection wins). Only `quote_opened` events for open quotes, and only after triage per D-15 — planner decides whether `quote_opened` fires at sync or at chase-eligibility flip; recommend at eligibility flip, keeping the event stream exactly "things the cadence engine may act on."

### Pattern 4: API keys encrypted with AES-256-GCM, app layer (ONB-02, discretion area)

**What:** `src/core/shared/crypto.ts` wraps `node:crypto`: `createCipheriv('aes-256-gcm', key, iv)` with a random 12-byte IV per encryption, ciphertext stored as `enc:v1:<base64 iv>:<base64 tag>:<base64 data>`. The 32-byte key lives in a new server env var `CREDENTIALS_ENCRYPTION_KEY` (base64), added to the `serverEnvSchema` in `src/core/shared/env.ts` following the existing pattern [VERIFIED: src/core/shared/env.ts:12-20 — server schema currently holds `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `MIGRATE_DATABASE_URL`; `getServerEnv()` throws if reached from browser code].

**Why app-layer over Vault for the keys themselves:** the decryption key never enters the database, so a DB-only compromise (dump, misconfigured replica, RLS bug) yields ciphertext only; testable in CI against plain Postgres; explicit versioned format (`v1`) makes rotation a data migration, not a platform question. Vault remains right for the *cron shared secret* (which must be readable from SQL). pgsodium is pending deprecation and must not be used [CITED: supabase.com/docs/guides/database/extensions/pgsodium].

**Handling rules:** the connect form's server action receives the key over HTTPS, verifies it with a live test call, encrypts, stores — the plaintext never persists and is never rendered back (show `key_last4` only). Decryption happens only inside `run-sync` and the audit fetch. Never log the key or the `X-API-Key` header (redact in any request logging).

### Pattern 5: Failure classification, pause, auto-resume (SYNC-04, D-06/D-07/D-08)

**Error taxonomy in `Sm8Client`** — every request resolves to a typed outcome, never a thrown string:

| Outcome | HTTP | Policy (D-06) |
|---------|------|---------------|
| `auth_failed` | 401, 403 | Immediately: `paused_at = now()`, `status_reason = 'auth_failed'`, send operator email, red banner. First occurrence — keys don't un-revoke |
| `rate_limited` | 429 | Backoff (see below); never pauses cadences; alert only at 3 consecutive failed *cycles* |
| `server_error` | 5xx | Same as 429 |
| `network_error` | fetch reject / timeout | Same as 429 |
| `parse_error` | 200 + zod failure | Log with payload sample, count as failed cycle — a schema drift alert, not an auth pause |

**Backoff (discretion — recommendation):** within a tick, retry a transient failure twice (1s, 4s jittered); if the cycle still fails, record it and let the next 5-minute tick be the retry — the tick cadence *is* the outer backoff. `consecutive_failures` increments per failed cycle, resets on success; at 3, send the degraded alert (once per episode — dedupe by `alerted_at` so the operator gets one email, not one per 5 minutes).

**Health badge derivation (D-07):** never store the badge — derive it: `auth-failed` if `paused_at` with `status_reason='auth_failed'`; `never-synced` if no successful run; `degraded` if `consecutive_failures >= 3`; else `healthy`. Stored state can go stale; derived state cannot.

**Auto-resume (D-08):** saving a new key = same verification test call as connect (fetch one job page); on success: store new ciphertext, clear `paused_at`/`consecutive_failures`/`alerted_at`, run an immediate sync. The pause flag lives on `sm8_connections`; Phase 3 dispatch must check `paused_at IS NULL` — document this as the cross-phase contract alongside the events table.

**Alert email:** Resend from `src/core/alerts`. Pre-domain-verification, the free tier can send from Resend's onboarding sender to the account owner's own address — sufficient for operator-only alerts [ASSUMED — verify at Resend signup; fallback: verify one service-owned domain now, which Phase 4 needs anyway].

### Pattern 6: One fetch/aggregation path for backfill baseline AND prospect audit (D-14, AUD-01/02)

**What:** A single `fetch90DayQuoteHistory(client: Sm8Client)` used by both client backfill and prospect audit (the CONTEXT.md "specific idea" made concrete):

1. `GET job.json?$filter=quote_date gt '<90 days ago>'` — one filter spans all statuses, because any job that ever became a quote has `quote_date` set; jobs created straight to Work Order have a zero/empty `quote_date` and fall out of a `gt` comparison naturally [ASSUMED — zero-date comparison behaviour needs the spike]. Fallback if the spike disproves it: four requests, one per `status eq '<value>'`, merged
2. Bulk companion fetches, one filtered request each (NOT per-job N+1): `note.json?$filter=create_date gt '<cutoff>'`, `jobactivity.json?$filter=start_date gt '<cutoff>'`, `jobcontact.json` for the fetched jobs' contacts — joined in memory by `related_object_uuid`/`job_uuid`
3. Normalize through the same zod schemas as sync

**Aggregation (`src/core/audit/aggregate.ts`, pure):**
- *Quotes issued* = jobs with `quote_date` in window; *total value* = Σ parsed `total_invoice_amount`
- *Baseline win rate* (AUD-02) = of quotes issued in window, fraction now in `Work Order`/`Completed`
- *Never followed up* (D-10) = quote where, after `quote_date + 3 days` grace: no note, no job activity, no status change, and `quote_sent_stamp` not after it — footnoted on the report as an approximation (ServiceM8 comms sent outside notes are invisible to us; honesty is part of the pitch)
- *Recoverable estimate* (D-09) = never-followed-up value × `AUDIT_RECOVERY_RATE`. **Recommendation: 0.15** — the conservative end of the user's stated 15–20% band, protecting the 3×-fees guarantee; a named constant in `src/core/audit/constants.ts` with a comment citing the GTM basis [ASSUMED — planner confirms the number against `.planning/research/` GTM material]

**Persistence split (D-01..D-04):** for clients, normalized rows land in tenant-scoped `quotes` (open ones default `chase_eligibility = 'needs_review'` per D-15) and the baseline snapshot is written to… the linked prospect record when one exists, else stored with the tenant's connection metadata — planner aligns with D-02's "snapshot stays on the prospect record". For prospects, raw lines land in `prospect_quote_lines` with `purge_after = now() + interval '30 days'`; aggregates + baseline snapshot are columns on `prospects` and persist. A daily pg_cron SQL job deletes expired lines (conversion clears `purge_after`).

**Prospect RLS:** prospect tables have no `tenant_id`, so `has_tenant_access(id)` doesn't apply. They still must carry pgPolicy (the Phase 1 rls-coverage test will fail otherwise [VERIFIED: tests/rls-coverage.test.ts exists in tests/ listing]). Policy: operator-only — recommend an `is_operator()` SECURITY DEFINER helper (exists-in-`tenant_members` check, or a dedicated allowlist) rather than a bare `to authenticated using(true)`, so a future client login can never see prospect data. Planner's choice of helper shape.

### Pattern 7: CSV fallback with header-based mapping (D-12, discretion area)

**What:** ServiceM8's Job List CSV export comes from the **Advanced Reporting Pack add-on**, and its column layout is **not publicly documented** [ASSUMED — searched; only the export's existence is confirmed via support.servicem8.com]. Therefore: never hard-code columns. Server action parses with papaparse (`header: true`, `skipEmptyLines: true`), then a mapping step matches headers to canonical fields (status, quote date, value, description, contact name/phone/email) by normalized-name heuristics (case/space-insensitive, common synonyms), shows the operator the inferred mapping plus the first 5 parsed rows for confirmation, and validates every row through the same zod-normalized shape the API path produces. Unmappable required fields block with a named-column error. Both paths land in `prospect_quote_lines` identically — the report code cannot tell which source fed it.

**Limitation to surface on the report:** a CSV export likely lacks notes/activity data, so D-10's "never followed up" degrades to status-change-only detection for CSV prospects — the report footnote must say so. Obtain a real export from the founder's trial account during execution to calibrate the heuristics (Open Question 4).

### Anti-Patterns to Avoid

- **Cursor from our clock** (`last_polled_at = now()`): timezone skew between our clock and ServiceM8's silently drops edits — the exact SYNC-01 failure mode. Cursor = max observed `edit_date`, always
- **Filtering `active eq 1` in the cursor fetch:** deletion of an open quote becomes invisible and its cadence chases a ghost (Pitfall 6)
- **Per-job N+1 fetches for notes/activities:** 300 jobs × 2 = 600 requests in an audit — near the 180/min ceiling; bulk-fetch + in-memory join instead
- **Storing money as float:** `total_invoice_amount` is a string; parse and store `numeric(12,2)`, render with Intl
- **Alert-per-tick:** a dead key at 5-min polling = 288 emails/day; dedupe by episode (`alerted_at` cleared on recovery)
- **Emitting won/lost events during backfill:** Phase 3 would react to pre-connection history; backfill seeds state, not events
- **Plaintext API key anywhere:** in logs, in the DB, in server-rendered props, in error messages — ciphertext + last4 only
- **A new pile of tables without pgPolicy:** the Phase 1 pattern ("a new table cannot ship unprotected by omission") applies to all ~6 new tables; prospect tables need an operator-only policy, not a skip
- **`waitUntil` for the sync work:** must-happen work runs inside the route's duration (CLAUDE.md What-NOT-to-Use)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV parsing | split-on-comma / regex parser | papaparse | Quoted fields, embedded commas/newlines, BOM, CRLF, Excel quirks — the classic underestimated parser |
| Timezone interpretation | manual offset arithmetic | `@date-fns/tz` `TZDate` + IANA ids | Offsets break across DST; Phase 1 already bans them by rule |
| Encryption | custom crypto construction, ECB/CBC-without-MAC | `node:crypto` AES-256-GCM (authenticated), random IV per message | GCM's auth tag detects tampering; hand-rolled modes are the canonical V6 failure |
| Scheduling | setInterval in a serverless function / bespoke ticker | pg_cron + pg_net (already enabled) | Serverless functions don't persist; the platform primitive is right there in migration 0000 |
| Secret comparison | `===` on the bearer token | `crypto.timingSafeEqual` | Timing side-channel on the one internet-exposed internal route |
| Retry semantics for event delivery | ad-hoc "did Phase 3 see this?" flags | append-only outbox + consumer cursor | Replayable, ordered, testable; the flag-per-row approach rots |
| PDF generation | puppeteer/react-pdf | print-styled page + browser print (locked D-11) | Zero deps; A4 via `@page` CSS; phone-renderable |

**Key insight:** this phase's product is *trustworthy state* — a mirror the cadence engine can act on without re-checking. Every guarantee (cursor never skips, events never fire falsely, keys never leak, pauses always honoured) must be a mechanism — a transaction, a unique constraint, a typed outcome, a test — exactly as Phase 1 established for tenancy.

## Common Pitfalls

### Pitfall 1: Trusting ServiceM8 timestamps against our clock
**What goes wrong:** Sync logic computes "changed since 10 minutes ago" using `Date.now()`; ServiceM8's clock/timezone differs (community-reported future-dated `edit_date` on a GMT+8 account); edits silently never sync, or everything re-syncs constantly.
**Why it happens:** The API docs never state timestamp timezones.
**How to avoid:** Opaque cursor (Pattern 1); normalized timestamps used for display/grace-math only; connect-time offset probe in the spike.
**Warning signs:** cursor code importing `Date.now()`; quotes appearing hours late or events firing for未-changed rows.

### Pitfall 2: `gt`-only filtering losing same-second edits
**What goes wrong:** Cursor = exact max `edit_date`; the next poll uses `gt`, and a second edit landing in the same timestamp second is never fetched.
**How to avoid:** Always subtract the overlap window (15 min) from the cursor before filtering; dedupe via upsert. `ge` does not exist [CITED: developer.servicem8.com/docs/filtering].
**Warning signs:** occasional "stale" quotes that fix themselves after an unrelated edit.

### Pitfall 3: Zero-dates (`0000-00-00 00:00:00`) crashing parsing
**What goes wrong:** `new Date('0000-00-00 00:00:00')` → Invalid Date; zod `.datetime()` rejects; whole page of jobs fails to sync. Community confirms API-created jobs return `'0000-00-00 00:00:00'` for `date` [ASSUMED — developer forum via search].
**How to avoid:** Every SM8 timestamp field parses through one shared zod coercion that maps zero-dates and empty strings to `null` before Date construction. Fixture-test with real captured payloads.
**Warning signs:** `parse_error` outcomes clustering on jobs created via other integrations.

### Pitfall 4: Money as float
**What goes wrong:** `total_invoice_amount` is a string ("read-only") [CITED: developer.servicem8.com/reference/listjobs.md]; `parseFloat` → float column → cent drift in the audit's dollar figures — the one artifact whose numbers get handed to a prospect.
**How to avoid:** Parse to a decimal-safe representation; store `numeric(12,2)`; sum in SQL or integer cents.

### Pitfall 5: Assuming linear status progression
**What goes wrong:** Transition code only handles `Quote → Work Order`; a tradie marks a quote `Completed` directly, or drags `Unsuccessful` back to `Quote` — win goes undetected or a dead cadence resumes wrongly.
**How to avoid:** Classification is a total function over all 4×4 pairs + `(new)` + `removed` (Pattern 3), table-driven and exhaustively tested. Statuses cannot be customized (CLAUDE.md), so the matrix is closed.

### Pitfall 6: Filtering out `active eq 0` and missing deletions
**What goes wrong:** Fetch filters `active eq 1`; a deleted open quote stops appearing but its row stays `Quote` forever; Phase 3 chases a deleted job.
**How to avoid:** Cursor fetch takes all rows regardless of `active`; `active = 0` maps to the `removed` event.
**Warning signs:** quotes in console that the tradie says don't exist.

### Pitfall 7: The proxy swallowing the sync-tick route
**What goes wrong:** pg_cron POSTs to `/api/internal/sync-tick`; the matcher `'/((?!_next/static|_next/image|favicon.ico|login$|login/).*)'` [VERIFIED: proxy.ts:25] applies `updateSession` → 307 to `/login`; `net.http_post` records a "success" (it got *a* response); sync never runs and nothing alarms.
**How to avoid:** Extend the matcher exclusion for `api/`; route enforces its own bearer secret (timing-safe). Add an integration test that the route returns 401 without the secret and 2xx with it — not a redirect.
**Warning signs:** `cron.job_run_details` all-green while `sync_runs` is empty.

### Pitfall 8: One client's failure aborting the tick for everyone
**What goes wrong:** The per-tenant loop throws on client #2's revoked key; clients #3–15 never sync that tick (or ever, if it's the same order each time).
**How to avoid:** Per-connection try/catch + per-connection transaction; the tick's result is a per-connection outcome list recorded in `sync_runs`.

### Pitfall 9: Prospect PII outliving its purpose
**What goes wrong:** Raw prospect quote lines (names, phones, addresses of a *non-client's* customers) persist indefinitely — Privacy Act APP exposure the audit was explicitly designed to minimise (D-04).
**How to avoid:** `purge_after` set at insert; daily pg_cron SQL delete; conversion (D-02) clears it; a test asserts the purge job's SQL removes expired rows and spares converted prospects.

### Pitfall 10: `cron.job_run_details` growing unbounded
**What goes wrong:** Every-5-minutes × forever, "records… are not cleaned up automatically" [CITED: supabase.com/docs/guides/cron/quickstart].
**How to avoid:** Weekly cleanup cron job deleting details older than ~30 days, shipped in the same migration as the schedules.

## Code Examples

Patterns assembled from official docs fetched this session; ServiceM8 field names are verbatim from the reference pages cited in §ServiceM8 API Facts. Exact drizzle syntax follows the Phase 1 house style [VERIFIED: src/db/schema/tenants.ts:25-51 — `pgTable(...)` with `pgPolicy` in the third argument, `authenticatedRole`, `sql`-templated `using`].

### zod schemas with zero-date and money coercion

```typescript
// src/core/servicem8/schemas.ts
import { z } from 'zod';

/** '0000-00-00 00:00:00', '', and null all mean "no value" in SM8 payloads. */
const sm8Timestamp = z
  .string()
  .nullish()
  .transform((v) => (!v || v.startsWith('0000-00-00') ? null : v));

const sm8Money = z
  .string()
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v)); // keep as string; convert to cents at persistence

export const JOB_STATUSES = ['Quote', 'Work Order', 'Unsuccessful', 'Completed'] as const;
// [CITED: developer.servicem8.com/reference/listjobs.md — "Valid values: Quote, Work Order, Unsuccessful, Completed"]

export const sm8Job = z.object({
  uuid: z.string().uuid(),
  active: z.union([z.literal(0), z.literal(1)]),
  edit_date: z.string().min(1),          // never zero for an existing record; cursor field
  status: z.enum(JOB_STATUSES),
  date: sm8Timestamp,
  quote_date: sm8Timestamp,
  work_order_date: sm8Timestamp,
  completion_date: sm8Timestamp,
  unsuccessful_date: sm8Timestamp,
  quote_sent: z.union([z.literal(0), z.literal(1)]).nullish(),
  quote_sent_stamp: sm8Timestamp,
  total_invoice_amount: sm8Money,
  company_uuid: z.string().uuid().nullish(),
  generated_job_id: z.string().nullish(),
  job_address: z.string().nullish(),
  job_description: z.string().nullish(),
}).passthrough(); // unknown fields must not fail sync
```

### Thin typed client with error classification

```typescript
// src/core/servicem8/client.ts — [CITED: developer.servicem8.com/docs/authentication.md]
const BASE = 'https://api.servicem8.com/api_1.0';

export type Sm8Result<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'auth_failed' | 'rate_limited' | 'server_error' | 'network_error' | 'parse_error'; status?: number; detail?: string };

export function createSm8Client(auth: { kind: 'apiKey'; key: string }) {
  async function get(resource: string, filter?: string): Promise<Sm8Result<unknown[]>> {
    const url = `${BASE}/${resource}.json${filter ? `?$filter=${encodeURIComponent(filter)}` : ''}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'X-API-Key': auth.key, Accept: 'application/json' } });
    } catch (e) {
      return { ok: false, kind: 'network_error', detail: String(e) };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'auth_failed', status: res.status };
    if (res.status === 429) return { ok: false, kind: 'rate_limited', status: 429 };
    if (res.status >= 500) return { ok: false, kind: 'server_error', status: res.status };
    // json + zod parse at the call site → 'parse_error' on failure; NEVER log auth.key
    return { ok: true, data: (await res.json()) as unknown[] };
  }
  return { get };
}
```

### Opaque cursor with overlap (pure, unit-tested)

```typescript
// src/core/sync/cursor.ts
const OVERLAP_MINUTES = 15;

/** SM8 timestamps are naive 'YYYY-MM-DD HH:MM:SS' strings in an unknown zone.
 *  Subtract the overlap WITHOUT attaching any timezone — the value only ever
 *  meets other SM8 timestamps inside SM8's own filter. */
export function filterFrom(cursor: string | null, backfillDays = 90): string {
  if (!cursor) {
    // backfill: SM8's clock minus ours is bounded (< 1 day); pad the window by a day
    const d = new Date(Date.now() - (backfillDays + 1) * 86_400_000);
    return d.toISOString().slice(0, 10); // date-only literal, per documented example form
  }
  return minusMinutesNaive(cursor, OVERLAP_MINUTES); // pure string/date math, no TZ
}

/** New cursor = max edit_date OBSERVED — never our clock. */
export function advanceCursor(prev: string | null, editDates: string[]): string | null {
  return editDates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), prev);
}
```

### Transition classification (total function)

```typescript
// src/core/sync/transitions.ts
import type { (typeof JOB_STATUSES)[number] as Sm8Status } from '../servicem8/schemas'; // illustrative

export type QuoteEventType = 'quote_opened' | 'won' | 'lost' | 'reopened' | 'removed' | null;

export function classifyTransition(prev: Sm8Status | null, next: Sm8Status, nowInactive: boolean): QuoteEventType {
  if (nowInactive) return 'removed';
  if (prev === next) return null;
  if (next === 'Work Order' || next === 'Completed') return prev === 'Quote' ? 'won' : null; // WO→Completed is progress, not a new win
  if (next === 'Unsuccessful') return prev === 'Quote' ? 'lost' : null;
  if (next === 'Quote') return prev === null ? 'quote_opened' : 'reopened';
  return null;
}
```

### AES-256-GCM key encryption

```typescript
// src/core/shared/crypto.ts — node:crypto only, no dependency
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export function encryptCredential(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptCredential(stored: string, key: Buffer): string {
  const [, v, ivB64, tagB64, dataB64] = stored.split(':');
  if (v !== 'v1') throw new Error(`Unknown credential format version: ${v}`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64')); // GCM tag → tamper detection
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
```

### Sync-tick route skeleton

```typescript
// src/app/api/internal/sync-tick/route.ts
import { timingSafeEqual } from 'node:crypto';
export const maxDuration = 300; // Vercel Fluid default ceiling per CLAUDE.md

export async function POST(req: Request) {
  const provided = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const expected = getServerEnv().SYNC_TICK_SECRET;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response('unauthorized', { status: 401 });
  }
  const outcomes = await runSyncTick(); // per-connection try/catch inside; forAllTenants_syncTick()
  return Response.json({ outcomes });
}
```

## Runtime State Inventory

Not applicable — this is a greenfield feature phase, not a rename/refactor/migration. No stored data, live service config, OS-registered state, secrets, or build artifacts carry names being changed. (New runtime state *created* by this phase — pg_cron schedules, Vault/env secrets — is documented in Patterns 2 and 4 for future phases' awareness.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `date-fns-tz` (community) | `@date-fns/tz` (`TZDate`, first-party) with date-fns v4 | date-fns 4.0 (2024); v4 line current at 4.4.0 | CLAUDE.md's supporting-library table predates this; use `@date-fns/tz` — same team as date-fns, 37M/wk |
| pgsodium for column encryption | Supabase Vault (stable API) or app-layer crypto; **pgsodium pending deprecation** | Supabase docs, current | Don't build anything on pgsodium; Vault for SQL-readable secrets, app-layer GCM for app-only secrets [CITED: supabase.com/docs/guides/database/extensions/pgsodium] |
| Per-minute cron minimum | Sub-minute (`'30 seconds'`) pg_cron on PG 15.1.1.61+ via pg_net | Supabase Cron, current | 5-min tick well within capability; sub-minute available for Phase 3's send tick [CITED: supabase.com/docs/guides/cron/quickstart] |
| Guessing SM8 docs structure | `developer.servicem8.com/llms.txt` + `.md` page variants | discovered this session | Executor can re-verify any field claim in seconds — cite this in plans |

**Deprecated/outdated:**
- `is_primary_contact` on JobContact: "DEPRECATED" per reference — use `type` ('JOB'/'BILLING'/'Property Manager')
- Job `payment_*` fields: "Not used. Refer to JobPayment endpoint" — irrelevant this phase, don't mirror them
- pgsodium: pending deprecation (above)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Datetime-precision literals work in `$filter=edit_date gt '...'` (docs only show date-only) | Filtering / Pattern 1 | Cursor granularity degrades to a day → overlap window becomes 1 day + heavier dedupe; design already tolerates this. Spike resolves |
| A2 | `cursor=-1` pagination: page size and next-cursor mechanics | Filtering / Pattern 1 | Backfill of a large account mis-pages; spike against seeded trial account resolves before worker finalized |
| A3 | ServiceM8 timestamps are account-local (tenant's IANA zone is the right interpretation for display/grace math) | Pattern 1 | Displayed times off by hours; grace-period math unaffected at 3-day threshold; connect-time probe measures the real offset |
| A4 | Zero-date strings (`0000-00-00…`) compare below any real date in SM8's filter engine (so `quote_date gt '<cutoff>'` naturally excludes never-quoted jobs) | Pattern 6 | Backfill/audit over- or under-fetches; fallback is per-status fetches (4 requests) |
| A5 | Job List CSV export columns (Advanced Reporting Pack) — layout unknown | Pattern 7 | Mapping heuristics miss; mitigated by operator-confirmed mapping UI; get a real export during execution |
| A6 | Resend free tier can deliver operator alerts to the account owner pre-domain-verification | Pattern 5 | Verify at signup; fallback = verify one service-owned domain now (needed by Phase 4 anyway) |
| A7 | Supabase Vault secret readable inside committed pg_cron SQL (for the tick bearer token) | Pattern 2 | Fall back to applying the schedule via a parameterized script outside migrations |
| A8 | Outbox + consumer-cursor is sufficient for Phase 3 (single consumer, ordered) | Pattern 3 | If Phase 3 needs competing consumers it adds pgmq for *sends* (already planned) — events contract unchanged |
| A9 | `AUDIT_RECOVERY_RATE = 0.15` is the defensible GTM number within the user's 15–20% band | Pattern 6 | One-line constant change; planner confirms against `.planning/research/` GTM docs |
| A10 | Community report of future-skewed `edit_date` (GMT+8 account) reflects current API behaviour | §Timestamp timezone | If timestamps turn out to be clean UTC, the opaque-cursor design still works — it is skew-agnostic by construction |
| A11 | `resend` npm package legitimacy — not seam-checked this session | Package Audit | Run `package-legitimacy check` before the alerting task's install |

## Open Questions

1. **Does `$filter=edit_date gt '<datetime>'` accept time-of-day precision?** (RESOLVED via Wave-0 spike — 02-01 Task 2 `scripts/sm8-spike.mjs` probes A1 and records the finding in docs/servicem8-api-notes.md)
   - What we know: docs show date-only literals (`'2023-01-01'`); a 2018 forum thread reported edit_date filtering broken for attachments
   - What's unclear: datetime literal parsing; per-resource filter reliability on `job.json`
   - Recommendation: **Wave-0 spike** against the founder's ServiceM8 trial account (seed 3 fake quotes, edit one, filter with datetime + date literals, record results in the plan). Design already survives either answer via the overlap window
2. **Cursor pagination mechanics (`cursor=-1`)** (RESOLVED via Wave-0 spike — 02-01 Task 2 probes A2; `pagination.ts` is fixed in the same task if the finding contradicts its initial implementation)
   - What we know: parameter documented in a filtering example; job reference page states no explicit pagination
   - What's unclear: page size, where the next cursor is returned (header? envelope?), behaviour with no cursor param
   - Recommendation: same spike; until then, code `pagination.ts` behind an interface so the answer slots in
3. **Actual timezone/offset of SM8 timestamps for a Perth account** (RESOLVED via Wave-0 spike — 02-01 Task 2 probes A3; the measured offset is stored as `sm8_connections.sm8_tz_offset_minutes` calibration metadata)
   - What we know: undocumented; community reports skew
   - What's unclear: UTC vs account-local vs server-local
   - Recommendation: same spike — edit a record at a known UTC instant, read back `edit_date`, compute offset; record on the connection as calibration metadata
4. **Real Job List CSV columns** (RESOLVED via 02-07 user_setup — operator enables the Advanced Reporting Pack, exports a sanitized Job List CSV to tests/fixtures/sm8/job-list-export.csv; 02-07 Task 2's mapping heuristics and tests calibrate against the real fixture, guarded by a task precondition)
   - Recommendation: enable Advanced Reporting Pack on the trial account, export, commit a sanitized fixture; calibrate `csv-mapping.ts` heuristics against it
5. **ServiceM8 partner approval status (App ID 000000, submitted 2026-08-25)** (RESOLVED via operator confirmation at phase start — 02-03 ships the webhook route inert (challenge + hints-to-poll) with activation steps appended to docs/servicem8-api-notes.md pending OAuth credentials; polling remains the SYNC-03 guarantee either way)
   - What we know: Draft store item saved; App Secret in operator's secret store; check date was 2026-08-26 [CITED: docs/external-registrations.md]
   - Recommendation: operator confirms at phase start; if issued, the webhook adapter task becomes schedulable this phase — otherwise it stays a stub route + documented activation steps (SYNC-03 is satisfied by the hints-to-poll design either way)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | worker, crypto, papaparse | ✓ | v22.20.0 (probed this session) | — |
| pg_cron / pg_net / pgmq | tick, purge job | ✓ enabled | migration 0000 [VERIFIED: src/db/migrations/0000_extensions_and_tenant_access.sql:4-6] | — |
| Docker | `supabase start` local stack | ✗ (still missing, probed) | — | Unchanged from Phase 1: CI has Docker; local integration tests run per Phase 1 harness (`test:remote` script exists [VERIFIED: package.json scripts — `"test:remote": "ALLOW_REMOTE_TESTS=yes vitest run"`]) |
| ServiceM8 trial account with seeded quotes | spike, fixtures, CSV export | unknown (human) | — | **Human task, week 1** — CLAUDE.md notes 14-day free trial as the test rig |
| Resend account + API key | D-05 operator alerts | unknown (human) | — | Human task; fallback = banner-only until account exists (banner satisfies half of D-05; email is required, so unblock early) |
| Vercel deployment URL (stable) | pg_cron target, future webhooks | partially (deploy exists?) | — | Preview alias or production domain; cron target must be stable |
| ServiceM8 OAuth App ID/Secret | webhook adapter only | submitted, unconfirmed | App ID 000000 | Private API keys bridge everything else (committed fallback) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Docker (CI covers), OAuth credentials (private-key bridge), Resend (banner interim — but treat account creation as a day-1 human task since D-05 locks email).

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (installed) [VERIFIED: package.json devDependencies] |
| Config file | `vitest.config.ts` (exists from Phase 1) |
| Quick run command | `npx vitest run tests/<file>.test.ts` |
| Full suite command | `npm test` (`vitest run`); DB-backed: `npm run test:remote` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | zod schemas parse real SM8 payloads incl. zero-dates, string money | unit (fixtures) | `npx vitest run tests/sm8-schemas.test.ts` | ❌ Wave 0 |
| SYNC-01 | Cursor advance/overlap never skips or double-counts (property-style cases) | unit (pure) | `npx vitest run tests/sync-cursor.test.ts` | ❌ Wave 0 |
| SYNC-01 | Upsert idempotence: same page twice → identical rows, no duplicate events | integration (real DB) | `npx vitest run tests/sync-upsert.test.ts` | ❌ Wave 0 |
| SYNC-02 | Transition classification total over 4×4 + new + removed matrix | unit (table-driven) | `npx vitest run tests/transitions.test.ts` | ❌ Wave 0 |
| SYNC-02 | Event emitted in same tx as status change; consumer cursor reads in order | integration | `npx vitest run tests/quote-events.test.ts` | ❌ Wave 0 |
| SYNC-03 | Timestamp normalization: naive SM8 string + IANA zone → correct UTC; zero-date → null | unit | `npx vitest run tests/sm8-normalize.test.ts` | ❌ Wave 0 |
| SYNC-04 | Failure policy: 401→immediate pause+alert; 429×2→no pause; 3rd consecutive→alert once (dedupe) | unit (pure policy) + integration (pause flag row) | `npx vitest run tests/failure-policy.test.ts` | ❌ Wave 0 |
| SYNC-04 | Tick route: 401 without secret, 2xx with, never a redirect | integration | `npx vitest run tests/sync-tick-route.test.ts` | ❌ Wave 0 |
| ONB-02 | Connect action: key verified→ciphertext stored (never plaintext), last4 shown; bad key→clear error | integration | `npx vitest run tests/connect-servicem8.test.ts` | ❌ Wave 0 |
| ONB-02 | Crypto roundtrip + GCM tamper detection | unit | `npx vitest run tests/credential-crypto.test.ts` | ❌ Wave 0 |
| ONB-05 (regression) | All new tables have RLS; forTenant extensions leak-tested; `forAllTenants_syncTick` greppable-scoped | integration | existing `tests/rls-coverage.test.ts` + `tests/leak.test.ts` extended | ⚠️ extend |
| AUD-01 | Aggregation: fixtures → known issued/value/never-followed-up/recoverable figures | unit (pure) | `npx vitest run tests/audit-aggregate.test.ts` | ❌ Wave 0 |
| AUD-01 | CSV mapping: real-export fixture → same normalized rows as API fixture | unit | `npx vitest run tests/csv-mapping.test.ts` | ❌ Wave 0 (fixture from spike) |
| AUD-02 | Baseline win rate from mixed-status 90-day fixture; snapshot persists on prospect | unit + integration | `npx vitest run tests/baseline-winrate.test.ts` | ❌ Wave 0 |
| D-04 | Purge job SQL removes expired lines, spares converted prospects | integration | `npx vitest run tests/prospect-purge.test.ts` | ❌ Wave 0 |
| SYNC-01 (live) | End-to-end against founder's trial account | manual-only — real external API; recorded as spike/verification evidence | n/a | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test>` + `npx tsc --noEmit`
- **Per wave merge:** full `vitest run` (pure suites) + DB-backed suites per Phase 1 harness
- **Phase gate:** full suite green in CI before `/gsd-verify-work`; live-account smoke recorded manually

### Wave 0 Gaps
- [ ] `tests/fixtures/sm8/*.json` — captured job/jobcontact/note/jobactivity payloads from the trial-account spike (the single highest-value test asset this phase)
- [ ] Pure-logic test files: sm8-schemas, sync-cursor, transitions, failure-policy, sm8-normalize, audit-aggregate, credential-crypto
- [ ] Integration files: sync-upsert, quote-events, sync-tick-route, connect-servicem8, prospect-purge, baseline-winrate
- [ ] Extend `tests/rls-coverage.test.ts` + `tests/leak.test.ts` + `tests/helpers/seed.ts` for the ~6 new tables
- [ ] `tests/csv-mapping.test.ts` blocked on the real CSV export fixture (spike deliverable)
- [ ] No framework install needed — Vitest present

## Security Domain

(`security_enforcement: true`, ASVS level 1, block on high.)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Console unchanged (Phase 1); NEW: sync-tick route bearer secret with `timingSafeEqual`; future webhook route does challenge + own verification |
| V3 Session Management | yes | Unchanged (`@supabase/ssr`); internal routes are session-less by design with their own credential |
| V4 Access Control | yes | pgPolicy on every new table (tenant tables via `has_tenant_access`; prospect tables via operator-only helper); `forTenant()` extensions + single documented `forAllTenants_syncTick()`; server actions authorize their own caller (WR-01 rule in proxy.ts) |
| V5 Input Validation | yes | zod on: SM8 API responses (untrusted third-party data), CSV uploads (untrusted files — size-cap, row-cap, reject formulas-as-values for any future re-export), connect-form key input, tick-route payloads |
| V6 Cryptography | yes | AES-256-GCM from `node:crypto` only, random IV, versioned format; 32-byte key in server env; never hand-roll modes; pgsodium banned (pending deprecation) |
| V8 Data Protection | yes | D-04 purge as an APP-11 control; prospect PII minimized (only fields the report needs); API keys ciphertext-only, last4 display, redacted logging |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client's ServiceM8 API key exfiltrated from DB/dump | Information Disclosure | App-layer GCM (key not in DB); server-only env; never rendered to browser |
| Key leaked via logs/error messages | Information Disclosure | Typed `Sm8Result` (no throw-with-context carrying headers); redaction rule in the client wrapper; test asserts error strings never contain the key |
| Unauthenticated invocation of sync-tick (forced sync, resource burn) | Elevation / DoS | Bearer secret + timing-safe compare; 401 test; secret rotation = env + cron-job update |
| Forged webhook (when enabled) triggering fetch storms | Spoofing | Webhook is only a *hint* — handler re-fetches via authenticated API; challenge handshake; per-tenant poll debounce |
| Malicious CSV (formula injection, oversized file, path-ish values) | Tampering / DoS | papaparse (no eval), server-side size/row caps, zod per-row validation, values treated as data (report renders via React escaping) |
| Cross-tenant leak via new sync tables | Information Disclosure | Same triple control as Phase 1: pgPolicy + forTenant closure + extended leak test — new tables join `rls-coverage` |
| Prospect PII retained indefinitely | Privacy (APP 11) | `purge_after` + daily purge job + purge test |
| SM8 response schema drift causing silent bad state | Tampering (integrity) | zod parse → `parse_error` outcome → degraded health + alert at 3 cycles, never partial writes (per-tenant transaction) |

## Sources

### Primary (official documentation fetched this session)
- developer.servicem8.com/reference/listjobs.md — full Job field inventory, status enum, scopes, rate limits
- developer.servicem8.com/docs/filtering — operators (eq/ne/gt/lt only), and-only, 10-condition max, cursor example
- developer.servicem8.com/reference/listclients.md — Company fields (no email/mobile)
- developer.servicem8.com/reference/listjobcontacts.md — JobContact fields + type enum
- developer.servicem8.com/reference/listjobactivities.md — JobActivity is scheduling data
- developer.servicem8.com/reference/listnotes.md — Note fields for D-10
- developer.servicem8.com/docs/authentication.md — X-API-Key header, OAuth endpoints/lifetimes
- developer.servicem8.com/llms.txt — reference index (executors: append `.md` to any reference URL)
- supabase.com/docs/guides/cron/quickstart — cron.schedule + net.http_post pattern, job_run_details caveat
- supabase.com/docs/guides/database/extensions/pgsodium + /guides/database/vault — pgsodium pending deprecation; Vault API stable

### Primary (in-repo, read this session)
- `.planning/phases/01-foundation-tenancy/01-RESEARCH.md` — inherited patterns (pgPolicy, forTenant, migration authority, CI harness)
- `src/db/schema/tenants.ts`, `src/db/repository/for-tenant.ts`, `src/db/repository/client.ts`, `src/core/shared/env.ts`, `proxy.ts`, `src/db/migrations/0000_extensions_and_tenant_access.sql`, `package.json`, `tests/` listing, `tests/helpers/seed.ts`
- `docs/external-registrations.md` — partner registration status (App ID 000000), private-key fallback commitment

### Secondary (registry/tool-verified)
- npm registry via `npm view` — papaparse 5.7.0, csv-parse 7.0.2, date-fns 4.4.0, @date-fns/tz 1.5.0, date-fns-tz peerDeps (`'date-fns': '^3.0.0 || ^4.0.0'`)
- `gsd-tools query package-legitimacy check` — verdicts/downloads/postinstall for all new candidates

### Tertiary (web search / community — LOW confidence, validate via spike)
- developer.servicem8.com/discuss threads (via search): future-skewed edit_date on GMT+8 account; zero-date `date` on API-created jobs; 2018 attachment edit_date filter complaint
- support.servicem8.com + webblend.au (via search): Job List CSV export via Advanced Reporting Pack; columns undocumented
- Resend free-tier sandbox sending rules (not verified this session)

## Metadata

**Confidence breakdown:**
- ServiceM8 field-level facts (the STATE.md flag): HIGH — resolved verbatim against official reference pages this session
- Sync architecture (cursor/overlap/outbox/failure policy): MEDIUM-HIGH — design is verified-fact-driven; two mechanics (datetime filters, pagination) are [ASSUMED] but the design degrades gracefully and a Wave-0 spike closes them
- pg_cron→Vercel pattern: MEDIUM — official quickstart pattern; secret-in-migration mechanism (A7) needs a small execution-time decision
- Audit pipeline: MEDIUM — API path solid; CSV column layout unknowable until a real export (mapping UI absorbs this)
- Timestamp timezone: LOW on the upstream fact, HIGH on the mitigation — the opaque-cursor design is correct under every possible answer

**Research date:** 2026-08-26
**Valid until:** ~2026-09-26 for API shapes (ServiceM8 API is slow-moving); re-run the npm version pins at install; replace A1–A4 assumptions with spike-recorded facts before the polling worker task is marked complete
