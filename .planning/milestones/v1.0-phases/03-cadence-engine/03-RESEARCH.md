# Phase 3: Cadence Engine - Research

**Researched:** 2026-08-27
**Domain:** Deterministic scheduling / state machines / Postgres-backed dispatch (TypeScript, Supabase Postgres, pg_cron)
**Confidence:** HIGH (codebase-grounded; every load-bearing external claim cited or verified in-repo)

## Summary

Phase 3 is almost entirely an internal-architecture phase: no new npm packages, no new external services, no new API integrations. Everything the cadence engine needs already exists in the repo — the transactional outbox with a documented consumption contract (`quote_status_events` + `event_consumer_cursors`), tenant contact-hours/timezone columns, the `paused_at` dispatch gate, the pg_cron→Vercel tick pattern, `@date-fns/tz` for wall-clock→UTC math, and a real-DB Vitest harness. The research work is therefore about the *shape* of five new tables, three pure-function modules, one tick route, and the exact Postgres mechanics that make "never late, never twice, never stale" structural rather than aspirational.

The two structural guarantees are both Postgres-native: **never twice** = a send-ledger row inserted with a unique constraint on `(cadence_id, touch_number)` before any sender is invoked (a concurrent tick's insert conflicts and refuses); **never stale** = dispatch runs its just-in-time revalidation (quote open + eligible, contact unsuppressed, connection unpaused, inside window) inside the same claim transaction, using `FOR UPDATE SKIP LOCKED` so overlapping ticks skip rather than block. **Never late** is the materialization/re-window layer: touch times are computed once (with jitter baked in), stored as UTC instants, and any touch found overdue is re-windowed by policy (D-09/D-10/D-11) rather than sent.

The single most dangerous trap found in this research: a stale comment in `src/core/sync/eligibility.ts` says "Phase 3 measures its cadence offsets from when the tradie sent the quote" (`occurred_at`), but Phase 3's D-01 — decided later — anchors Day 0 on the **eligibility moment**. For a backfilled quote, `occurred_at` can be months old; anchoring on it would materialize an entirely-overdue cadence that the staleness cap immediately skips to death. The anchor must be the consumption/`detected_at` moment. This is documented in Pitfalls and should also produce a comment fix in eligibility.ts.

**Primary recommendation:** Build the engine as a second pg_cron-driven tick (`/api/internal/cadence-tick`, per-minute) that in one pass (1) consumes the outbox with same-transaction cursor advance, (2) promotes touches through the stub draft/approval gates, (3) re-windows overdue touches, and (4) dispatches due approved touches via claim-transaction + ledger-unique-insert + pluggable sender. All decisions live in pure framework-free functions under `src/core/cadence/` tested exhaustively with Vitest; the tables follow the Phase 1/2 pgPolicy + grants + rls-coverage triple exactly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Cadence shape & anchoring
- **D-01:** Day 0 anchors on the **eligibility moment** — the `quote_opened` event (when the quote became chase-eligible). Fresh post-connect quotes anchor within ~5 minutes of sync (feeds the first-touch-within-24h metric); backfilled quotes anchor when the operator ticks them eligible. A cadence can never materialize already-overdue.
- **D-02:** Touch timing is a **fixed default (day 0, 3, 7, 14, 21) stored as per-tenant config rows** that onboarding can edit. Schema supports per-client overrides from day one; v1 UI may simply apply the default. — **Reversibility:** costly — moving from config rows back to code constants (or vice versa) reshapes how Phase 5 binds per-touch templates to timing.
- **D-03:** Touches materialize at a **per-tenant preferred send time (default mid-morning, ~9:30am local)** clamped inside the contact window, **with a few minutes of random jitter** so sends don't land robotically at the identical minute.
- **D-04:** One cadence chases **one primary contact per quote**, selected by a deterministic rule (JobContact type, then documented fallback order). Quotes where no contact has a usable mobile/email go to **operator triage**, never a guess. — **Reversibility:** costly — opt-out, reply threading (Phase 4) and attribution (Phase 7) all assume one human per cadence; multi-contact later means reworking suppression and threading semantics.

#### Stop vs pause semantics
- **D-05:** Customer reply → **pause until the operator explicitly acts** (resume or close). No automated resume after a live conversation — a human is in the loop in v1 anyway.
- **D-06:** Kill switches are asymmetric: **per-contact kill is terminal** (writes the contact to the suppression list — "never chase again"), **per-client kill is a reversible pause** of every cadence for that tenant. — **Reversibility:** one-way for the contact kill by design — the suppression entry is the Spam Act safety mechanism; making it reversible invites resuming someone who complained.
- **D-07:** Resume (operator resume, client un-pause, auth-failure recovery per Phase 2 D-08) uses **one rule for every pause type: shift the remaining schedule from the resume moment** — next touch at the next allowed slot, remaining touches follow at their original relative gaps. Never a burst, never out-of-hours.
- **D-08:** `removed` event → terminal stop (job no longer exists). `reopened` event → **no auto-restart**: the quote returns to `needs_review` for operator triage, because a reopen usually means the tradie is actively negotiating in ServiceM8.

#### Overdue re-window policy
- **D-09:** "Next allowed slot" = **later today if the contact window is still open** (send at next tick with jitter, given sufficient margin), otherwise the **next allowed contact day at the preferred slot**.
- **D-10:** **Minimum-gap rule** (~2 days between consecutive sends, named constant): a re-windowed touch that would land inside the min gap of the next scheduled touch is **skipped** (recorded as skipped, not sent) — the next touch carries the conversation. The customer never gets two texts in quick succession.
- **D-11:** **Staleness cap ~72h**: a touch more than ~72h past its slot is marked `skipped_stale` and never sent; the cadence proceeds to the next touch (min-gap still applies).
- **D-12:** **Cadence expiry at ~6 weeks from anchor** (~2× design length): the cadence auto-completes as `expired` with remaining touches unsent. An expired-but-still-open quote is a pipeline-view concern (Phase 6), not a send-queue concern.

#### Dispatch handoff boundary
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAD-01 | Every synced open quote gets a cadence of up to 5 touches over ~3 weeks, with per-touch channel (SMS/email) and timing from the client's approved template set | Pattern 1 (event consumer creates cadence on `quote_opened`), Pattern 2 (per-tenant touch-template config rows, defaults `[0,3,7,14,21]`), schema skeletons in Code Examples. Note: "approved template set" (ONB-03 approval) is Phase 5 — this phase's template rows carry timing + channel only, defaulting to SMS per the walking-skeleton decision |
| CAD-02 | Touch send times are materialized, contact-hours- and timezone-aware; overdue touches re-window to the next allowed slot rather than sending late | Pattern 3 (materialization with `TZDate` wall-clock math against `tenants.contact_hours_*`/`contact_days`/`timezone`), Pattern 5 (re-window policy engine D-09/D-10/D-11), Pitfalls 2–4 |
| CAD-03 | Cadences stop or pause deterministically on: customer reply, quote won/lost, opt-out, and operator kill switch (per-contact and per-client) | Pattern 4 (pure total transition function over closed vocabularies + exhaustive table tests), Pattern 1 (won/lost/removed/reopened event handling), D-16 console actions |
| CAD-04 | Sends are idempotent via a send ledger with a unique constraint — a quote can never receive the same touch twice | Pattern 6 (claim transaction: `FOR UPDATE SKIP LOCKED` + ledger `INSERT` under UNIQUE `(cadence_id, touch_number)`), cited Postgres docs, concurrent-tick test design in Validation Architecture |
| CAD-05 | Dispatch revalidates quote status, suppression list, and send window just-in-time before every send (stale sends are impossible by construction) | Pattern 6 (JIT revalidation inside the claim transaction: `quotes.status='Quote' AND sm8_active AND chase_eligibility='eligible'`, `sm8_connections.paused_at IS NULL`, suppression lookup by normalized address, window check), enqueue→suppress→refuse test design |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives from `.claude/CLAUDE.md` that bind this phase:

- **No Vercel `waitUntil` for sends** — sends are must-happen work; durability via queue/ledger + idempotency keys. This phase's ledger-claim design satisfies the underlying directive (durable, idempotent, synchronous within the tick) — see "pgmq" discussion in Alternatives.
- **No n8n/Zapier/Make** — the state machine is the product; custom TS with tests and versioning.
- **No Prisma** — drizzle-orm (already at 0.45.2) + drizzle-kit journal is the sole migration authority.
- **Money is `numeric`/integer-cents string math, never floats** (quote values pass through cadence context untouched — keep them strings).
- **pg_cron + pg_net for the tick**; Supabase hosted platform extensions; keep secret-free schedules in migrations, secret-bearing schedules applied by script from env (Phase 2 precedent, `scripts/apply-cron-schedules.mjs`).
- **`date-fns` + timezone package for contact-hours windows; never store local times** — repo uses `@date-fns/tz` (`TZDate`), not the legacy `date-fns-tz`; store UTC instants.
- **`zod` v4 everywhere data crosses a boundary** — console action inputs, tick-route payloads.
- **Vitest for the cadence state machine** — "test it exhaustively, no mocks of Postgres needed for pure transition logic" (verbatim CLAUDE.md directive).
- **Vercel functions: `maxDuration` 300s** confirmed pattern in the sync-tick route.
- **GSD workflow enforcement** — implementation happens through `/gsd-execute-phase`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cadence creation / stop / pause (event consumption) | API/Backend (tick route → `src/core/cadence`) | Database (outbox + cursor) | Decisions from events; cursor co-commit is a DB transaction concern |
| Touch-time materialization + re-window math | Backend pure functions (`src/core/cadence`) | — | Deterministic, framework-free, exhaustively unit-testable |
| Duplicate-send prevention | **Database** (unique constraint on send ledger) | Backend (claim flow) | Structural guarantee must live where concurrency is arbitrated — Postgres, not app code |
| Stale-send prevention (JIT revalidation) | Backend inside claim transaction | Database (row locks) | Reads and claim must share a transaction to close the TOCTOU window |
| The tick (schedule) | Database (pg_cron + pg_net) | API/Backend (protected route) | Established Phase 2 pattern; pg_cron is the only always-on component |
| Kill switches / resume / suppression writes | Frontend Server (server actions, auth-first) | Database (suppression table) | Operator-initiated; WR-01 auth-in-action pattern |
| Cadence visibility (state + upcoming touches) | Frontend Server (RLS-scoped server components) | — | Read-only console extension per D-16 |
| Sending | Backend sender interface (stub this phase) | — | D-13 pluggable seam; Phase 4 swaps implementation |

## Standard Stack

**No new packages are required or recommended for this phase.** Everything is already installed and in production use:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 `[VERIFIED: package.json:28]` | 5 new tables, repository extensions | Existing sole schema/migration authority |
| `drizzle-kit` | 0.31.10 `[VERIFIED: package.json:42]` | Migration generation | Journal is sole authority (watch ordering trap) |
| `@date-fns/tz` | 1.5.0 `[VERIFIED: package.json:24]` | Wall-clock↔UTC in tenant IANA zone | Already the repo's proven pattern (`sm8ToUtc`, `graceDeadline`) |
| `date-fns` | 4.4.0 `[VERIFIED: package.json:27]` | Day arithmetic on `TZDate` | Pairs with `@date-fns/tz` (v4-native) |
| `zod` | 4.4.3 `[VERIFIED: package.json:35]` | Action input validation | Boundary-validation house rule |
| `postgres` (postgres.js) | 3.4.9 `[VERIFIED: package.json:31]` | Runtime driver (pooler 6543) | Existing repository client |
| `vitest` | 4.1.11 `[VERIFIED: package.json:47]` | Exhaustive state-machine + real-DB integration tests | Existing harness with remote-DB gate |
| `next` | 16.3.2 `[VERIFIED: package.json:29]` | Tick route + console actions/pages | Existing app |
| Supabase pg_cron + pg_net | hosted platform | The cadence tick | Existing sync-tick precedent |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Touches table as the queue (claim via `FOR UPDATE SKIP LOCKED` + ledger unique insert) | pgmq (Supabase Queues) | pgmq adds visibility-timeout retry semantics but creates a **second source of truth** beside the touch rows and their materialized times; the CAD success criteria are stated in terms of the ledger's unique constraint, which works identically either way. At stub-sender volume (and even 15-client real volume) the table-as-queue is simpler and keeps the D-13 pipeline in one transaction. CLAUDE.md's "pgmq + idempotency keys" directive is about *durability and idempotency for must-happen sends*, which the ledger design satisfies; revisit pgmq in Phase 4 only if ClickSend latency/retry demands decoupled workers |
| Plain status-column state machine + pure transition function | XState | XState is heavyweight for a 5-state cadence + 6-state touch machine that must live *in Postgres columns*; the product guarantee is the exhaustive test table, not a statechart runtime. Repo precedent: `src/core/sync/transitions.ts` |
| Separate `cadence-tick` pg_cron job | Piggyback on the 5-min sync tick | Piggybacking couples dispatch latency and failure domains to ServiceM8 fetches (a slow SM8 page delays sends; a sync crash skips dispatch). Separate job costs one more cron row and one more secret-bearing schedule application — recommended: **separate, per-minute** |

**Installation:** none — `npm install` adds nothing this phase.

## Package Legitimacy Audit

No new packages are installed in this phase. All libraries referenced above already exist in `package.json` and were audited in prior phases.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                                     ┌────────────────────────────────────────────────┐
 pg_cron '* * * * *'                 │  POST /api/internal/cadence-tick               │
 net.http_post ──── Bearer secret ──▶│  (auth: timingSafeEqual, maxDuration 300,      │
 (scripts/apply-cron-schedules.mjs)  │   runtime nodejs — clone of sync-tick route)   │
                                     └───────────────┬────────────────────────────────┘
                                                     │ runCadenceTick()  (src/core/cadence/run-tick.ts)
                 ┌───────────────────────────────────┼──────────────────────────────────────────┐
                 ▼ (1) CONSUME                       ▼ (2) PROGRESS                              ▼ (3) DISPATCH
   ┌──────────────────────────┐        ┌──────────────────────────────┐        ┌─────────────────────────────────────┐
   │ quote_status_events      │        │ Touch lifecycle promotion    │        │ Claim due touches                   │
   │  WHERE id > cursor       │        │ scheduled → needs_draft →    │        │  SELECT ... WHERE status='approved' │
   │  ORDER BY id             │        │ pending_approval → approved  │        │   AND scheduled_at <= now()         │
   │ quote_opened → create    │        │ (STUB GATES auto-pass, D-14) │        │  FOR UPDATE SKIP LOCKED             │
   │   cadence + select       │        │ + RE-WINDOW overdue          │        │  ── JIT revalidation ──             │
   │   primary contact +      │        │   (D-09/D-10/D-11 policy:    │        │  quote open+eligible? unpaused      │
   │   materialize touches    │        │    later-today / next day /  │        │  connection? contact unsuppressed?  │
   │ won|lost|removed → stop  │        │    skip min-gap / skip stale │        │  inside window?                     │
   │ reopened → stop + flip   │        │    / expire at ~6wk)         │        │  ── claim ──                        │
   │   quote to needs_review  │        └──────────────────────────────┘        │  INSERT send_ledger                 │
   │ cursor advance SAME TXN  │                                                │   ON CONFLICT DO NOTHING            │
   └────────────┬─────────────┘                                                │  (UNIQUE cadence_id,touch_number)   │
                │                                                              └──────────────┬──────────────────────┘
                │ writes                                                                      │ invoke
                ▼                                                                             ▼
   ┌──────────────────────────┐    read by dispatch ▲                          ┌─────────────────────────────────┐
   │ cadences / cadence_      │                     │                          │ TouchSender interface (D-13)    │
   │ touches / send_ledger    │    ┌────────────────┴────────────┐             │  Phase 3: StubSender (logs,     │
   │ (tenant-scoped, RLS)     │    │ suppressed_contacts (D-15)  │             │  ledger sender='stub')          │
   └──────────────────────────┘    │ written by: per-contact kill│             │  Phase 4: ClickSend/Resend      │
                ▲                  │ (console) now; STOP regex   │             └─────────────────────────────────┘
                │ buttons          │ (Phase 4) later             │
   ┌────────────┴─────────────┐    └─────────────────────────────┘
   │ Console (D-16): cadence  │
   │ state + upcoming touches;│    Per-client kill/pause → cadences paused (reversible)
   │ per-contact kill, per-   │    Resume → re-materialize remaining touches from resume moment (D-07)
   │ client pause, resume     │
   └──────────────────────────┘
```

### Recommended Project Structure

```
src/
├── core/cadence/                 # framework-free by contract (like src/core/sync)
│   ├── constants.ts              # ALL named constants (D-10/D-11/D-12 magnitudes, jitter, margins)
│   ├── window.ts                 # contact-hours math: isInsideWindow, nextAllowedSlot (pure)
│   ├── materialize.ts            # anchor + templates + tenant config → touch schedule (pure)
│   ├── rewindow.ts               # D-09/D-10/D-11/D-12 policy: overdue touch → action (pure)
│   ├── transitions.ts            # cadence + touch state machines: total (state, event) → outcome (pure)
│   ├── primary-contact.ts        # D-04 deterministic selection + address normalization (pure)
│   ├── consume-events.ts         # outbox consumer: cursor read/act/advance in one txn
│   ├── dispatch.ts               # claim → JIT revalidate → ledger insert → sender invoke
│   ├── sender.ts                 # TouchSender interface + StubSender (D-13 Phase 4 contract)
│   └── run-tick.ts               # orchestrator: consume → progress/re-window → dispatch
├── db/schema/
│   ├── cadence-templates.ts      # per-tenant touch timing/channel config rows (D-02)
│   ├── cadences.ts               # one active cadence per quote (partial unique)
│   ├── cadence-touches.ts        # materialized touches, lifecycle status, skip reasons
│   ├── send-ledger.ts            # THE idempotency record (CAD-04)
│   └── suppressed-contacts.ts    # D-15, keyed by normalized address not contact uuid
├── db/repository/
│   ├── for-tenant.ts             # extend: cadence/touch/suppression namespaces
│   └── for-all-tenants.ts        # extend: forAllTenants_cadenceTick() (documented convention)
├── app/api/internal/cadence-tick/route.ts   # clone of sync-tick route (own secret)
└── app/(console)/clients/[id]/   # D-16: cadence column on quote list, kill/pause/resume actions
tests/
├── cadence-window.test.ts        # window math incl. ISO-weekday mapping, DST zone
├── cadence-materialize.test.ts   # D-01/D-02/D-03 incl. day-0 anchoring, jitter bounds
├── cadence-rewindow.test.ts      # D-09/D-10/D-11/D-12 policy table
├── cadence-transitions.test.ts   # EXHAUSTIVE (state × event) matrix — CAD-03
├── cadence-primary-contact.test.ts
├── cadence-consume-events.test.ts   # real DB: cursor co-commit, replay idempotence
├── cadence-dispatch.test.ts         # real DB: concurrent-tick ledger race (CAD-04),
│                                    # enqueue→suppress→refuse (CAD-05), paused-connection refuse
└── cadence-tick-route.test.ts       # 401-not-redirect, per sync-tick-route.test.ts
```

### Pattern 1: Outbox consumption with same-transaction cursor advance

The contract is written in the schema header and must be followed literally `[VERIFIED: src/db/schema/quote-events.ts:12-35]`:

> "1. Read your cursor: SELECT last_event_id FROM event_consumer_cursors WHERE consumer = 'cadence-engine' — Register yourself by inserting a row with last_event_id = 0. No row is seeded …
> 2. Scan forward: SELECT * FROM quote_status_events WHERE id > $cursor ORDER BY id
> 3. Act, then advance the cursor IN THE SAME TRANSACTION as whatever you did with the events."

- Consumer id is the literal `'cadence-engine'` `[VERIFIED: src/db/schema/quote-events.ts:16,165]`.
- Registration: `INSERT INTO event_consumer_cursors (consumer, last_event_id) VALUES ('cadence-engine', 0) ON CONFLICT DO NOTHING` at the start of each tick (idempotent, per CONTEXT discretion note).
- **Replay is legal** — "APPEND-ONLY, AND REPLAY IS LEGAL … Idempotence is the consumer's job" `[VERIFIED: src/db/schema/quote-events.ts:31-35]`. Every consumer action must be idempotent: cadence creation guarded by the partial unique index (`ON CONFLICT DO NOTHING`), stops as guarded `UPDATE ... WHERE status IN (...)`.
- The event vocabulary is closed — the consumer switches on exactly these five `[VERIFIED: src/db/schema/quote-events.ts:96-102]`:
  ```typescript
  export const QUOTE_EVENT_TYPES = ['quote_opened', 'won', 'lost', 'reopened', 'removed'] as const;
  ```
- Event handling per decisions: `quote_opened` → create cadence (D-01); `won`/`lost` → terminal stop with reason; `removed` → terminal stop (D-08); `reopened` → stop any live cadence AND write `quotes.chase_eligibility = 'needs_review'` so the quote lands in operator triage (D-08 — note Phase 2 sync deliberately never writes this column on upsert, so the consumer is the only writer for this transition; re-triage then re-emits `quote_opened` via the existing `markChaseEligible` path and a *new* cadence starts).
- Process the batch grouped per tenant inside ONE transaction ending with the cursor `UPDATE`; a crash rolls back both act and advance together (crash-safe by construction).

### Pattern 2: Per-tenant touch templates + cadence settings (D-02/D-03)

- `cadence_touch_templates`: `(tenant_id, touch_number 1..5, offset_days, channel)` with UNIQUE `(tenant_id, touch_number)`. Defaults `offset_days ∈ [0,3,7,14,21]`, `channel = 'sms'` (walking skeleton is SMS-only per STATE.md roadmap decision; schema admits `'email'` from day one).
- Seed lazily and idempotently: `ensureTouchTemplates(tenantId)` inserts the five defaults `ON CONFLICT DO NOTHING` the first time a cadence is created for the tenant — no backfill migration for existing tenants, no coupling to tenant creation.
- Per-tenant preferred send time (D-03): a `preferred_send_time time NOT NULL DEFAULT '09:30'` column. Recommend a one-row-per-tenant `cadence_settings` table (tenant_id PK) rather than widening `tenants` — Phase 5 will hang per-tenant drafting config off the same row. (Either placement is workable; pick one and stick to it.)
- **Snapshot semantics:** materialization copies the template's `channel` and computed times onto the touch rows; editing a template affects only future materializations, never live cadences (a live schedule silently reshaped under an approved plan is the D-14 anti-goal).

### Pattern 3: Materialization — wall-clock math in the tenant zone

All required tenant data exists; no schema addition for hours `[VERIFIED: src/db/schema/tenants.ts:35-39]`:

```typescript
/** IANA identifier, never a UTC offset — offsets break across DST. */
timezone: text('timezone').notNull().default('Australia/Perth'),
contactHoursStart: time('contact_hours_start').notNull(),
contactHoursEnd: time('contact_hours_end').notNull(),
/** ISO weekdays, Monday = 1 .. Sunday = 7. */
contactDays: smallint('contact_days').array().notNull(),
```

The proven in-repo idiom for "wall-clock time in zone → UTC instant" `[VERIFIED: src/core/servicem8/normalize.ts:104-117]`:

```typescript
// TZDate's constructor reads the numeric components AS WALL-CLOCK TIME in the
// given zone and resolves the offset — including DST — for that date
const zoned = new TZDate(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ianaZone);
const instant = new Date(zoned.getTime());
```

And for fixed-duration day math, pin to UTC (no DST days) `[VERIFIED: src/core/audit/followup.ts:48]`:

```typescript
return new Date(addDays(new TZDate(quoteDateUtc, 'UTC'), GRACE_PERIOD_DAYS).getTime());
```

Materialization algorithm (D-01/D-03, all pure — anchor, templates, tenant config in; touch rows out):
1. Anchor = the **consumption moment** of `quote_opened` (use the event's `detected_at`, or `now()` at consumption — they are minutes apart at most). **Never `occurred_at`** — see Pitfall 1.
2. For touch N with `offset_days > 0`: take the anchor's calendar date *in the tenant zone*, add `offset_days` calendar days, set wall-clock to `preferred_send_time` plus a random jitter of `[0, JITTER_MAX_MINUTES]` minutes, resolve to a UTC instant via `TZDate`. If that weekday is not in `contact_days`, roll forward day-by-day to the next allowed day (same preferred time + jitter). Clamp inside `[contact_hours_start, contact_hours_end)` — if preferred time falls outside the window, clamp to window start + jitter.
3. For touch 1 (`offset_days = 0`): schedule at the **next allowed slot from the anchor** — later today (next tick + jitter) if the window is open with ≥ `SAME_DAY_MARGIN_MINUTES` remaining, else the next allowed day at preferred time + jitter. This is what makes D-01's "can never materialize already-overdue" true and feeds first-touch-within-24h.
4. **Jitter is drawn once at materialization and baked into the stored `scheduled_at`** — deterministic thereafter (Pitfall 4). Inject the RNG (`jitterMinutes: () => number`) so tests pin it.

### Pattern 4: Two small state machines, one pure total transition function each

Model exactly the D-14 vocabulary; these strings are the Phase 5/6/7 contract (one-way decision):

```typescript
// Cadence-level (CAD-03 targets this machine)
export const CADENCE_STATUSES = ['active', 'paused', 'stopped', 'completed', 'expired'] as const;
export const CADENCE_PAUSE_REASONS = ['customer_reply', 'client_paused'] as const;   // D-05, D-06
export const CADENCE_STOP_REASONS = ['won', 'lost', 'removed', 'contact_suppressed', 'operator_closed'] as const;

// Touch-level (D-14 verbatim lifecycle)
export const TOUCH_STATUSES = ['scheduled', 'needs_draft', 'pending_approval', 'approved', 'sent', 'skipped'] as const;
export const TOUCH_SKIP_REASONS = ['min_gap', 'stale', 'suppressed', 'quote_closed', 'cadence_stopped', 'cadence_expired', 'window_refused'] as const;
```

- Status + reason columns (not a flat mega-vocabulary): keeps the transition matrix small enough to test exhaustively while reasons stay auditable for Phase 7.
- The transition function is **total**: `(status, event) → { status, reason? } | { refused: why }` — every pair returns something, no `default: throw`. Repo precedent: `src/core/sync/transitions.ts` (Phase 2 pattern-map entry). Phase 2 learned the hard way that non-obvious pairs matter (STATE.md: "Won/lost classification covers Unsuccessful→Work Order (won) … the research skeleton returned null for both") — enumerate the full matrix in the test, including e.g. `won` arriving at a `paused` cadence (still stops it) and `customer_reply` arriving at a `stopped` cadence (no-op).
- **Connection pause is NOT a cadence state.** `sm8_connections.paused_at` is a dispatch-time gate `[VERIFIED: src/db/schema/sm8-connections.ts:13-19]`: "Phase 3 dispatch MUST check `paused_at IS NULL` before sending anything, and touches that fall due during a pause must be RE-WINDOWED per CAD-02 — never burst-sent on resume." Dispatch refuses while paused; the refused/overdue touches are handled by the standing re-window pass. On auth-recovery resume (Phase 2 `resumeConnection`), call the same D-07 re-window routine for that tenant's active cadences — one rule for every pause type.
- D-07 resume rule (all pause types): re-materialize from the resume moment — next unsent touch at the next allowed slot; each later touch keeps its original *relative gap* from the one before it (recompute, clamp to allowed days, min-gap applies).

### Pattern 5: Overdue re-window policy engine (D-09/D-10/D-11/D-12)

A single pure function evaluated by the tick for every unsent touch whose `scheduled_at < now`:

```
rewindow(touch, nextTouch, tenantWindow, now) →
    | { action: 'send_now' }                       // due, inside window — proceed to dispatch
    | { action: 'reschedule', at: Date }           // D-09: later today (window open, margin OK)
    |                                              //       else next allowed day at preferred slot
    | { action: 'skip', reason: 'min_gap' }        // D-10: rescheduled slot within MIN_GAP of nextTouch.scheduled_at
    | { action: 'skip', reason: 'stale' }          // D-11: now - scheduled_at > STALENESS_CAP
    | { action: 'expire_cadence' }                 // D-12: now - anchor > CADENCE_EXPIRY
```

Recommended named constants (discretion; magnitudes from decisions — all in `src/core/cadence/constants.ts` with doc comments):

| Constant | Value | Decision |
|----------|-------|----------|
| `DEFAULT_TOUCH_OFFSET_DAYS` | `[0, 3, 7, 14, 21]` | D-02 |
| `DEFAULT_PREFERRED_SEND_TIME` | `'09:30'` | D-03 |
| `JITTER_MAX_MINUTES` | `10` | D-03 ("a few minutes") |
| `MIN_GAP_HOURS` | `48` | D-10 ("~2 days") |
| `STALENESS_CAP_HOURS` | `72` | D-11 |
| `CADENCE_EXPIRY_DAYS` | `42` | D-12 ("~6 weeks") |
| `DRAFT_LEAD_HOURS` | `24` | D-14 (surface ahead of slot; feeds CON-04) |
| `SAME_DAY_MARGIN_MINUTES` | `60` | D-09 "enough margin" (discretion): re-window lands today only if `now + margin ≤ window end` |

All comparisons in UTC milliseconds on stored instants (fixed durations, `TZDate`-pinned-UTC arithmetic per followup.ts precedent); only *choosing a new slot* re-enters zone math.

### Pattern 6: Dispatch — claim transaction with JIT revalidation and ledger-unique insert

The CAD-04/CAD-05 core. Postgres docs on the claim primitive `[CITED: postgresql.org/docs/15/sql-select.html]`:

> "With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped. Skipping locked rows provides an inconsistent view of the data, so this is not suitable for general purpose work, but can be used to avoid lock contention with multiple consumers accessing a queue-like table."

Flow, per due touch, in ONE transaction:
1. `SELECT ... FROM cadence_touches WHERE status = 'approved' AND scheduled_at <= now() ... FOR UPDATE SKIP LOCKED` — overlapping ticks skip each other's rows instead of blocking (liveness).
2. JIT revalidation (CAD-05), re-read inside the transaction: cadence `status = 'active'`; quote `status = 'Quote' AND sm8_active AND chase_eligibility = 'eligible'` (vocabularies `[VERIFIED: src/db/schema/quotes.ts:53,64]`: `QUOTE_STATUSES = ['Quote', 'Work Order', 'Unsuccessful', 'Completed']`, `CHASE_ELIGIBILITIES = ['needs_review', 'eligible']`); `sm8_connections.paused_at IS NULL`; recipient address absent from `suppressed_contacts`; `now` inside the tenant contact window. Any failure → refuse without sending (window → reschedule; suppressed/closed → skip with reason + stop cadence as appropriate).
3. Claim: `INSERT INTO send_ledger (...) ON CONFLICT (cadence_id, touch_number) DO NOTHING RETURNING id`. Zero rows returned = another process already owns this touch = **refuse silently**. This is the structural never-twice: even if SKIP LOCKED were bypassed (a second deployment, a manual invocation), the unique constraint arbitrates. ON CONFLICT can target the constraint or a partial unique index via `index_predicate` if the ledger design needs one `[CITED: postgresql.org/docs/15/sql-insert.html]`.
4. Mark the touch `sent`, commit, THEN invoke the sender with the ledger row id. **At-most-once by design:** a crash after commit but before the stub send loses nothing real in Phase 3; for Phase 4 the ledger row's outcome column records the provider result, and a `claimed`-but-outcome-less row is surfaced to the operator, never auto-resent — the product principle is "a late/duplicate touch is worse than a skipped touch" (CONTEXT Specific Ideas).
5. Stub sender (D-13): `sender = 'stub'` in the ledger row's sender column with `outcome = 'stub_sent'` — structurally distinguishable from Phase 4's `'clicksend'`/`'resend'` rows forever (Phase 7 must be able to exclude stub rows from attribution).

Sender interface (the Phase 4 contract — costly to change, get the shape right):

```typescript
// src/core/cadence/sender.ts — typed outcome union, never throws (house rule)
export interface SendRequest {
  ledgerId: string; tenantId: string; quoteId: string; cadenceId: string;
  touchNumber: number; channel: 'sms' | 'email';
  to: { address: string; contactName: string | null };
  body: string;            // Phase 3: deterministic placeholder text; Phase 5: approved draft
}
export type SendOutcome =
  | { kind: 'sent'; provider: string; providerMessageId: string | null }
  | { kind: 'failed'; provider: string; reason: string; retryable: boolean };
export interface TouchSender { readonly provider: string; send(req: SendRequest): Promise<SendOutcome>; }
```

### Pattern 7: Suppression by normalized address, not contact uuid (D-15)

`quote_contacts` rows are per-job mirrors — the same human appears as a new row on every new job. D-15 requires a suppressed contact to block cadences on **new** quotes too, so the suppression key must be the **channel address**, not `sm8_contact_uuid`:

- `suppressed_contacts`: `(tenant_id, channel 'sms'|'email', address text, reason, source, created_at)`, UNIQUE `(tenant_id, channel, address)`. Insert-only (terminal by design, D-06); no delete path ships.
- `address` is normalized by named pure functions Phase 4 will reuse: `normalizeAuMobile` (strip spaces/hyphens; `04xxxxxxxx` → `+614xxxxxxxx`; already-`+61` passthrough) and `normalizeEmail` (trim, lowercase). Contact fields available: `phone`, `mobile`, `email` on quote_contacts `[VERIFIED: src/db/schema/quote-contacts.ts:67-69]`.
- Per-contact kill (console action) suppresses BOTH the mobile and the email of the cadence's primary contact (one human, both channels — matches MSG-03's cross-channel suppression later), then stops the cadence with reason `contact_suppressed`.
- Cadence creation ALSO checks suppression (D-15 "block cadences on NEW quotes"): a `quote_opened` whose selected primary contact is suppressed creates the cadence directly in a stopped/triage state, never active.

### Pattern 8: Primary-contact selection (D-04, discretion — must be deterministic and documented)

Recommended rule, over `quote_contacts` rows matching the quote's `sm8_job_uuid` with `sm8_active = true`:
1. Order by `contact_type` precedence, case-insensitive: `'JOB'` → `'BILLING'` → `'Property Manager'` → anything else. (Free text upstream, "case varies" `[VERIFIED: src/db/schema/quote-contacts.ts:71]`; `is_primary_contact` is deliberately not mirrored because upstream deprecated it — select on `type` `[VERIFIED: src/db/schema/quote-contacts.ts:18-21]`.)
2. Within a tier, prefer a contact with a usable mobile (normalizes to `+614…`), then usable email; a contact with neither is unusable.
3. Final deterministic tie-break: lowest `sm8_contact_uuid` (stable, replay-safe).
4. No usable contact anywhere → **operator triage, never a guess**: create the cadence with status `'stopped'`, stop_reason `'no_contact'` — or a dedicated `needs_contact` blocked state — so the event is consumed exactly once, the cursor advances, and the console surfaces it. (Planner picks the exact representation; the invariant is: consumed once, visible to the operator, nothing sent.)
5. Snapshot the selected contact id + normalized addresses onto the cadence row at creation — reply threading (Phase 4) and suppression checks need a stable "one human per cadence" identity even if contacts re-sync.

### Anti-Patterns to Avoid
- **Anchoring on `occurred_at`** — see Pitfall 1. D-01 supersedes the stale Phase 2 comment.
- **Computing jitter or window placement at dispatch time** — send times must be materialized and stored (CAD-02 "materialized"); dispatch only *validates*, never *chooses* (except re-window, which writes a new stored time).
- **Advancing the consumer cursor outside the action transaction** — "Advancing separately is how a consumer skips work after a crash" `[VERIFIED: src/db/schema/quote-events.ts:22-23]`.
- **Trusting the outbox as permission to send** — "This table says what happened, not whether we may act" `[VERIFIED: src/db/schema/quote-events.ts:59-64]`.
- **App-level check-then-insert for uniqueness** — TOCTOU by construction; Postgres arbitrates (Phase 2 precedent in the sm8-connections header).
- **A `forTenant()` method that accepts a tenantId, or raw cross-tenant queries** — cross-tenant tick work goes through `forAllTenants_<op>()` exports only `[VERIFIED: src/db/repository/for-tenant.ts:12-15]`.
- **`using (true)` RLS or missing grants on any new table** — rls-coverage test fails the build; every new table needs its schema pgPolicy AND its grants-migration block AND enumeration in the coverage test.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wall-clock ↔ UTC in tenant zone | Offset arithmetic / string parsing | `TZDate` from `@date-fns/tz` (repo idiom in normalize.ts, followup.ts) | DST resolution per-date; offsets break across DST (tenants.ts comment); already proven in this codebase |
| Concurrent work claiming | Advisory locks, app mutexes, "check status then update" | `FOR UPDATE SKIP LOCKED` + unique-constraint insert | Postgres-documented queue pattern [CITED: postgresql.org/docs/15/sql-select.html]; races decided by the database |
| Idempotency | In-memory dedupe, application flags | DB unique constraints with `ON CONFLICT` | Survives crashes, redeploys, concurrent ticks; the repo's established mechanism (quotes upsert, connection upsert, eligibility WHERE clause) |
| Scheduling | `setInterval`, Vercel cron, `waitUntil` | pg_cron + pg_net → protected route (Phase 2 pattern, `scripts/apply-cron-schedules.mjs`) | Only always-on component is the DB; `waitUntil` banned for must-happen work (CLAUDE.md) |
| State machine framework | XState / statechart library | Pure total transition function + exhaustive Vitest table | 5–6 states each, persisted as columns; the test matrix IS the guarantee (CLAUDE.md directive) |
| Durable queue infra (this phase) | pgmq integration | The touches table + ledger claim | See Alternatives — one source of truth; pgmq re-evaluated in Phase 4 if provider retry semantics demand it |

**Key insight:** every "never" in this phase's goal (never late, never twice, never stale) must be enforced by a Postgres constraint or a same-transaction read — not by application-code discipline. The codebase already models this philosophy everywhere (the eligibility WHERE clause, the connection unique key, the outbox co-commit); Phase 3 extends it, it doesn't invent it.

## Common Pitfalls

### Pitfall 1: Anchoring cadences on `occurred_at` (stale Phase 2 comment vs D-01)
**What goes wrong:** `quote_opened` events carry `occurred_at = quoteDateUtc` — the ServiceM8 quote issue date, which for a triaged backfilled quote can be **months in the past** `[VERIFIED: src/core/sync/eligibility.ts:52-54,84]`. The eligibility.ts comment even says "Phase 3 measures its cadence offsets from when the tradie sent the quote" — written before D-01 was decided. Anchoring there materializes a fully-overdue schedule; the staleness cap then skips every touch and the cadence expires without one send.
**Why it happens:** the comment predates the Phase 3 discussion; D-01 (2026-08-27) supersedes it: Day 0 = the eligibility moment.
**How to avoid:** anchor on the event's `detected_at` (or the consumption `now()` — minutes apart at most). Also update the stale comment in eligibility.ts as part of this phase.
**Warning signs:** a materialization test with a backfilled quote (quote_date 60 days ago) producing any `scheduled_at` in the past — D-01 says that must be impossible.

### Pitfall 2: ISO weekdays vs JavaScript `getDay()`
**What goes wrong:** `contact_days` is "ISO weekdays, Monday = 1 .. Sunday = 7" `[VERIFIED: src/db/schema/tenants.ts:38]`; JS `Date.prototype.getDay()` returns 0–6 with Sunday = 0. A direct `contactDays.includes(zoned.getDay())` silently makes Sunday always-refused and shifts every other day by one.
**How to avoid:** one named conversion `isoWeekday = ((zoned.getDay() + 6) % 7) + 1` (on the `TZDate`, so it's the tenant-zone weekday), unit-tested for all seven days.
**Warning signs:** Monday-window tenants never send on Monday in tests.

### Pitfall 3: `time` columns arrive as strings; window math on Dates
**What goes wrong:** `contact_hours_start/end` are Postgres `time` columns — the driver returns `'HH:MM:SS'` strings. Comparing them against a `Date`, or against an unpadded `'9:30'`, gives nonsense.
**How to avoid:** a pure `parseTimeOfDay('HH:MM:SS') → minutesSinceMidnight` and compare integers against the tenant-zone wall-clock minutes of the candidate instant. Phase 1 guarantees `start ≠ end` (STATE.md: zero-width windows rejected) but **does not obviously guarantee `start < end`** — assert `start < end` in the window function and route violations to a loud error, not a guess (see Open Questions).
**Warning signs:** touches scheduled at 09:30 refused by a 08:00–17:00 window.

### Pitfall 4: Jitter computed per-tick instead of materialized
**What goes wrong:** drawing jitter at dispatch makes `scheduled_at` a moving target: re-window comparisons (min-gap, staleness) become nondeterministic, tests flake, and the "materialized send times" requirement (CAD-02) is quietly violated.
**How to avoid:** jitter is drawn once at materialization (and once per re-window placement), stored in `scheduled_at`. Inject the RNG for tests.

### Pitfall 5: Consumer actions not replay-safe
**What goes wrong:** the outbox is append-only and replay is legal; Phase 7 re-reads from id 0. Any consumer action that isn't idempotent (e.g. plain `INSERT` of a cadence) double-fires after a crash-rollback re-scan.
**How to avoid:** cadence creation via `ON CONFLICT DO NOTHING` against the one-active-cadence-per-quote partial unique index; stops as `UPDATE ... WHERE status = 'active'`-guarded writes; the cursor advance co-committed with the batch.
**Warning signs:** the replay integration test (process the same event window twice) producing two cadences or two state flips.

### Pitfall 6: The concurrent-tick test that doesn't actually race
**What goes wrong:** `vitest.config.mts` sets `fileParallelism: false` (deliberate — shared operator + shared DB), so cross-file concurrency won't happen; and a single shared drizzle handle can serialize the two "concurrent" dispatches through one connection, proving nothing.
**How to avoid:** the CAD-04 test runs inside ONE test file with `Promise.all([dispatch(), dispatch()])` over a driver pool with `max ≥ 2` (or two separate `postgres()` clients) so two real transactions contend. Assert: exactly one ledger row, exactly one stub send, the loser refused cleanly. Note the transaction pooler (port 6543) is the runtime path; integration tests follow `tests/helpers/env.ts` gating (`ALLOW_REMOTE_TESTS`).
**Warning signs:** the race test never once producing a conflict path in CI (add an assertion that both interleavings are exercised, e.g. by also testing the ledger conflict directly).

### Pitfall 7: drizzle-kit journal-ordering trap (3 strikes in Phase 2)
**What goes wrong:** `db:generate` can stamp entries behind the journal head; `migrate` silently skips them (STATE.md tooling watch item). Phase 3 adds ~5 tables + grants + a cron schedule migration — prime territory.
**How to avoid:** after every `db:generate`, verify journal monotonicity (the `tests/lint-ban` guard exists); grants and `is_operator`-style helpers ordered BEFORE any policy that references them (Phase 2 lesson: "CREATE POLICY resolves functions at DDL time").

### Pitfall 8: Treating the tick response as the record
**What goes wrong:** pg_cron + pg_net records "success" for any HTTP response; a 307-to-login reads as success (Phase 2 Pitfall 7). And a tick that times out leaves no durable trace for un-reached work.
**How to avoid:** clone the sync-tick route exactly — proxy matcher already excludes `api/`; route owns auth via `timingSafeEqual` bearer `[VERIFIED: src/app/api/internal/sync-tick/route.ts:55-72]`; outcomes durably recorded in tables (touch statuses, ledger rows), response is counts-only; a `cadence-tick-route.test.ts` asserts 401-with-no-Location.

### Pitfall 9: Suppressing by contact uuid
**What goes wrong:** the same customer returns as a NEW `quote_contacts` row on their next job; uuid-keyed suppression lets the new quote's cadence text a person who said stop — a Spam Act breach, the worst available failure.
**How to avoid:** suppression keyed on `(tenant_id, channel, normalized_address)` (Pattern 7); creation-time check as well as dispatch-time check; the CAD-05 test suppresses between enqueue and dispatch AND asserts a subsequent new-quote cadence is blocked at creation.

### Pitfall 10: Widening the sender interface too late
**What goes wrong:** D-13 marks the sender interface as the Phase 4 contract, costly to change. Designing it around the stub (e.g. no provider message id, no retryable flag, no channel) forces a simultaneous dispatch+ledger+gateway rework in Phase 4.
**How to avoid:** the `SendOutcome` union in Pattern 6 carries provider, providerMessageId, and retryable from day one; the ledger schema stores them nullable now.

## Code Examples

### Send ledger schema (the CAD-04 constraint)

```typescript
// src/db/schema/send-ledger.ts — follows the tenants.ts pgPolicy pattern exactly
export const SEND_LEDGER_OUTCOMES = ['stub_sent', 'sent', 'failed'] as const;

export const sendLedger = pgTable(
  'send_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),          // no cascade — Phase 7 attribution evidence,
                                                    // same rationale as quote_status_events.tenantId
    cadenceId: uuid('cadence_id').notNull(),
    quoteId: uuid('quote_id').notNull(),
    touchNumber: smallint('touch_number').notNull(),
    channel: text('channel').notNull(),             // 'sms' | 'email'
    toAddress: text('to_address').notNull(),        // normalized recipient at send time
    sender: text('sender').notNull(),               // 'stub' now; 'clicksend' | 'resend' in Phase 4
    outcome: text('outcome').notNull(),             // SEND_LEDGER_OUTCOMES
    providerMessageId: text('provider_message_id'), // null for stub
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // THE never-twice constraint (CAD-04). Insert-before-send; a concurrent
    // tick's insert conflicts and the dispatch refuses.
    uniqueIndex('send_ledger_cadence_touch_uniq').on(table.cadenceId, table.touchNumber),
    pgPolicy('send_ledger_member_access', { as: 'permissive', for: 'all', to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`, withCheck: sql`has_tenant_access(tenant_id)` }),
  ],
);
```

### One active cadence per quote (partial unique)

```typescript
// src/db/schema/cadences.ts (excerpt) — a quote may have SEQUENTIAL cadences
// (reopen → re-triage → new quote_opened) but never two live ones.
uniqueIndex('cadences_one_live_per_quote')
  .on(table.quoteId)
  .where(sql`status IN ('active', 'paused')`),
```

Creation is then replay-safe: `INSERT ... ON CONFLICT DO NOTHING` — Postgres infers the partial index when the insert's target + predicate match `[CITED: postgresql.org/docs/15/sql-insert.html]` (with drizzle, `.onConflictDoNothing({ target: [cadences.quoteId], targetWhere: sql`status IN ('active','paused')` })`).

### Claim + JIT revalidation shape (dispatch core)

```sql
-- inside one transaction per batch (via drizzle db.transaction / raw sql)
SELECT t.id
FROM cadence_touches t
JOIN cadences c            ON c.id = t.cadence_id
WHERE t.status = 'approved'
  AND t.scheduled_at <= now()
  AND c.status = 'active'
ORDER BY t.scheduled_at
LIMIT 50
FOR UPDATE OF t SKIP LOCKED;   -- overlapping ticks skip, never block
-- [CITED: postgresql.org/docs/15/sql-select.html — queue-like table pattern]

-- then, per claimed touch, re-SELECT the gates in this same transaction:
--   quotes: status = 'Quote' AND sm8_active AND chase_eligibility = 'eligible'
--   sm8_connections: paused_at IS NULL
--   suppressed_contacts: no row for (tenant_id, channel, to_address)
--   window: now() inside tenant contact hours (computed in TS with tenant row)
-- pass → INSERT INTO send_ledger ... ON CONFLICT (cadence_id, touch_number) DO NOTHING RETURNING id
--   → zero rows: someone else owns it, refuse; one row: mark touch 'sent', commit, invoke sender
-- fail → skip/reschedule per policy, no ledger row (except suppressed: skip + stop cadence)
```

### Exhaustive transition test shape (CAD-03)

```typescript
// tests/cadence-transitions.test.ts — every (status, event) pair asserted, no default case
const CADENCE_EVENTS = ['customer_reply', 'won', 'lost', 'removed', 'reopened',
  'contact_killed', 'client_paused', 'client_resumed', 'operator_resumed',
  'operator_closed', 'expired_deadline', 'all_touches_done'] as const;

it('is total over the full matrix', () => {
  for (const status of CADENCE_STATUSES) {
    for (const event of CADENCE_EVENTS) {
      const result = transition({ status }, event);   // must return, never throw
      expect(EXPECTED[status][event]).toEqual(result); // hand-written expectation table
    }
  }
});
// The EXPECTED table is written BY HAND, pair by pair — the point is forcing a
// human decision for every cell (Phase 2's won/lost gap was exactly an
// unconsidered cell). Vitest `test.each` over the flattened matrix also works.
```

### Cadence tick route + schedule

Route: byte-for-byte the sync-tick pattern `[VERIFIED: src/app/api/internal/sync-tick/route.ts]` — `maxDuration = 300`, `runtime = 'nodejs'`, `timingSafeEqual` bearer, counts-only JSON response. Use a **new** env var `CADENCE_TICK_SECRET` (added to `serverEnvSchema` in `src/core/shared/env.ts` with an explicit `process.env.` reference) so the two ticks rotate independently. Schedule: extend `scripts/apply-cron-schedules.mjs` with a second job `('cadence-tick', '* * * * *', net.http_post ...)` — per-minute gives jitter fidelity (materialized minutes are honored to the minute) and the no-work tick is one indexed query; secret-bearing schedules stay script-applied per the Phase 2 A7 decision.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `date-fns-tz` (separate package, `zonedTimeToUtc`) | `@date-fns/tz` `TZDate` (Date subclass) with date-fns v4 first-class tz support | date-fns v4 (2024) | Repo already on the current stack; CLAUDE.md's `date-fns-tz` mention is outdated — do not install it |
| External queue brokers for job dispatch | Postgres-native queues (`SKIP LOCKED`, pgmq) at small/medium scale | mainstream since PG 9.5 `ON CONFLICT` / 9.6 `SKIP LOCKED` | One system of record; transactionality across state + queue |
| Cron in app platform (Vercel cron) | pg_cron + pg_net → protected route | Project decision, Phase 2 | Already operational; schedules versioned (or script-applied when secret-bearing) |

**Deprecated/outdated:**
- `date-fns-tz`: superseded in this stack by `@date-fns/tz` — the repo already imports `TZDate` from `@date-fns/tz` `[VERIFIED: src/core/servicem8/normalize.ts:35]`.
- `quote_contacts.is_primary_contact`: deprecated upstream, deliberately not mirrored — never base D-04 selection on it `[VERIFIED: src/db/schema/quote-contacts.ts:18-21]`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Contact-hours windows always satisfy `start < end` (no overnight windows) — Phase 1 rejects only `start == end` | Pitfall 3 / window math | An overnight-window tenant (e.g. 20:00–06:00) would have every touch refused or misplaced. Mitigation: assert `start < end` loudly in `window.ts`; if it ever throws, add wrap support then |
| A2 | Per-minute pg_cron granularity is available on the hosted Supabase project (CLAUDE.md says "down to sub-minute"; the sync tick uses `*/5`) | Tick mechanics | Fall back to `*/5` cadence tick — jitter fidelity drops to 5-minute buckets, otherwise harmless |
| A3 | `contact_type` values in real ServiceM8 data are drawn from {'JOB','BILLING','Property Manager'} with only case variance (schema comment says "free text upstream, case varies") | Pattern 8 | An unrecognized type falls to the lowest precedence tier — still deterministic, worst case a suboptimal primary contact; the documented fallback order covers it |
| A4 | AU mobile normalization (`04xxxxxxxx` → `+614xxxxxxxx`) is sufficient for Phase 3's suppression keying; full E.164 handling (landlines, international) is Phase 4's problem with the SMS provider | Pattern 7 | A number in an odd format could evade suppression matching; mitigate by suppressing the *stored raw* form as well as the normalized form |
| A5 | Phase 5 will bind templates/drafts per `(tenant_id, touch_number)` against the `cadence_touch_templates` rows (D-02 reversibility note implies this) | Pattern 2 | If Phase 5 needs a different binding key, template schema gains columns — additive, not breaking |
| A6 | `resumeConnection` (Phase 2) is the correct single hook point for auth-recovery cadence re-windowing (D-07) | Pattern 4 | If other un-pause paths exist/appear, they must call the same re-window routine; grep for `pausedAt` writes during planning |

## Open Questions (RESOLVED)

All three questions were resolved during planning; each recommendation was adopted by a specific plan.

1. **Where does "quote detail" live for D-16?**
   - What we know: D-16 says "cadence state + upcoming touches on the quote detail page" — but no quote detail page exists; quotes render as a list on `src/app/(console)/clients/[id]/page.tsx` (files enumerated — no `quotes/[id]` route).
   - What's unclear: whether to add `clients/[id]/quotes/[quoteId]/page.tsx` or render cadence state inline/expandable in the client-detail quote list.
   - Recommendation: add a minimal quote detail page (server component, same pattern as `clients/[id]`) — kill/resume buttons need a stable per-quote surface, and Phase 6's pipeline view will want the route anyway. Phone-first layout (the kill switch must work from a phone).
   - **RESOLVED → plan 03-05**: recommendation adopted — 03-05 adds `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx` (server component, phone-first) with the kill/pause/resume controls and links from the client quote list.
2. **Does the cadence tick also own touch-lifecycle promotion and expiry sweeps, or are those separate passes?**
   - What we know: promotion (scheduled→…→approved via stub gates), re-windowing, and D-12 expiry are all periodic scans; the tick is the only heartbeat.
   - Recommendation: one tick, three ordered passes (consume → progress/re-window/expire → dispatch) so stops always land before sends in the same tick; keep each pass a separately-testable function.
   - **RESOLVED → plan 03-04** (tracer groundwork in 03-02): recommendation adopted — 03-02's `runCadenceTick` wires consume → promote → dispatch as ordered, separately-testable passes; 03-04 completes the progress pass (re-window/min-gap/staleness/expiry) inside the single tick.
3. **`reopened` handling writes `chase_eligibility` from the engine — confirm no conflict with sync upsert.**
   - What we know: sync upsert deliberately never writes `chase_eligibility` `[VERIFIED: src/db/repository/for-tenant.ts:396-405]`, so the engine's write survives re-sync. `markChaseEligible` requires `status='Quote'`, which a reopened quote satisfies.
   - What's unclear: nothing blocking — flagged only because two writers (operator triage, engine-on-reopen) now touch the column; both are transitions *to* the safe state or via the guarded flip.
   - Recommendation: engine writes `needs_review` only inside the `reopened` event handler, same transaction as the cadence stop.
   - **RESOLVED → plan 03-03**: recommendation adopted — the `reopened` handler calls `quotes.flagNeedsReviewOnReopen` in the same transaction as the cadence stop (guarded WHERE status='Quote' AND sm8_active); no writer conflict with sync upsert.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Postgres (Sydney) + pg_cron + pg_net | Tick, all tables | ✓ (in production use by Phase 2 sync tick) | Postgres 15+ hosted | — |
| Node + npm toolchain | Build/test | ✓ (project builds; `@types/node` 26.x) | — | — |
| Vercel deployment (`syd1`) | Tick route target | ✓ (sync tick live in production per Phase 2 UAT) | — | — |
| ServiceM8 API | **Not required this phase** (engine consumes the local mirror/outbox only) | n/a | — | — |
| SMS/email providers | **Not required this phase** (stub sender, D-13) | n/a | — | IPND address blocker is a Phase 4 concern (STATE.md) |

**Missing dependencies with no fallback:** none — this phase introduces no new external dependencies.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 `[VERIFIED: package.json:47]` |
| Config file | `vitest.config.mts` (fileParallelism: false — deliberate, see Pitfall 6) |
| Quick run command | `npx vitest run tests/cadence-transitions.test.ts` (any single file) |
| Full suite command | `npm test` (local stack) / `npm run test:remote` (`ALLOW_REMOTE_TESTS=yes`, hosted Sydney DB) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAD-01 | quote_opened → cadence with ≤5 touches from tenant templates; suppressed/no-contact → triage not chase | integration (real DB) | `npx vitest run tests/cadence-consume-events.test.ts` | ❌ Wave 0 |
| CAD-02 | Materialized times inside window/zone; day-0 never overdue; overdue re-windows (D-09/10/11/12 table) | unit (pure) | `npx vitest run tests/cadence-materialize.test.ts tests/cadence-rewindow.test.ts tests/cadence-window.test.ts` | ❌ Wave 0 |
| CAD-03 | Exhaustive (status × event) matrix for cadence + touch machines; reply/won/lost/opt-out/kill/resume | unit (pure, exhaustive) | `npx vitest run tests/cadence-transitions.test.ts` | ❌ Wave 0 |
| CAD-04 | Concurrent dispatch race → exactly one ledger row (unique constraint holds) | integration (real DB, intra-file Promise.all, pool max≥2) | `npx vitest run tests/cadence-dispatch.test.ts` | ❌ Wave 0 |
| CAD-05 | enqueue → suppress → dispatch-refuses; paused connection refuses; closed quote refuses; outside-window re-windows | integration (real DB) | `npx vitest run tests/cadence-dispatch.test.ts` | ❌ Wave 0 |
| — (route auth) | 401 plain, no Location header | route test | `npx vitest run tests/cadence-tick-route.test.ts` | ❌ Wave 0 |
| — (RLS) | every new table: rowsecurity on, policy present, grants exact | standing guard (extend) | `npx vitest run tests/rls-coverage.test.ts` | ✅ extend |

### Sampling Rate
- **Per task commit:** the relevant single-file `npx vitest run tests/<file>.test.ts` + `npm run typecheck`
- **Per wave merge:** `npm test` (pure suites) and `npm run test:remote` when DB schema/integration changed
- **Phase gate:** full `npm run test:remote` green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/cadence-window.test.ts`, `cadence-materialize.test.ts`, `cadence-rewindow.test.ts`, `cadence-transitions.test.ts`, `cadence-primary-contact.test.ts` — pure suites (CAD-02, CAD-03)
- [ ] `tests/cadence-consume-events.test.ts`, `tests/cadence-dispatch.test.ts` — real-DB suites (CAD-01, CAD-04, CAD-05)
- [ ] `tests/cadence-tick-route.test.ts` — route auth
- [ ] `tests/helpers/seed.ts` — extend with cadence/touch/template/suppression seeders (two-tenant, for the leak test)
- [ ] `tests/rls-coverage.test.ts` — enumerate 5 new tables in grants map + presence list
- Framework install: none needed (Vitest + harness exist)

## Security Domain

### Applicable ASVS Categories (L1, block on high)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (tick route; console actions) | Bearer `timingSafeEqual` on `/api/internal/cadence-tick` (own secret, `CADENCE_TICK_SECRET`); auth-check-FIRST in every server action (WR-01 pattern from `clients/new/actions.ts`) |
| V3 Session Management | no new surface | existing Supabase session handling; proxy excludes `api/` |
| V4 Access Control | yes | RLS pgPolicy on all 5 new tables (`has_tenant_access(tenant_id)`); grants blocks; rls-coverage test; cross-tenant engine access ONLY via `forAllTenants_<op>()` exports; kill/resume actions verify tenant membership before writing |
| V5 Input Validation | yes | zod on all action inputs (quote ids, cadence ids as UUIDs); `forTenant()` UUID guard; no free-text reaches SQL unparameterized |
| V6 Cryptography | no new crypto | existing secret comparison util; no new key material beyond one shared-secret env var |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated tick invocation (dispatch on demand) | Elevation | Bearer secret + constant-time compare; 401-no-redirect test; counts-only response (no client names in cron logs, per T-2-15 precedent) |
| Server-action ID abuse (kill/resume POSTable globally) | Elevation/Tampering | Auth + tenant-membership check first inside every action (WR-01) — especially resume, which restarts messaging |
| Cross-tenant cadence/suppression leak | Info disclosure | RLS triple control + extend two-tenant leak test to cadence tables |
| Suppression bypass via address-format variance | Tampering (compliance) | Normalize-then-match + suppress raw form too (Assumption A4); creation-time AND dispatch-time checks |
| Un-suppressing a complained contact | Repudiation/compliance | Suppression table is insert-only by design (D-06); no delete action ships; per-contact kill irreversible |
| Duplicate/late send via race or replay | Tampering (the product's core risk) | Ledger unique constraint + SKIP LOCKED claim + JIT revalidation + staleness cap — all proven by tests this phase |

## Sources

### Primary (HIGH confidence — read in full this session)
- `src/db/schema/quote-events.ts` — outbox contract, consumer rules, event vocabulary, no-permission-to-send rule
- `src/db/schema/quotes.ts`, `tenants.ts`, `quote-contacts.ts`, `sm8-connections.ts` — vocabularies, contact-hours columns, pause contract
- `src/db/repository/for-tenant.ts` — scoping convention, upsert/eligibility mechanics
- `src/core/sync/eligibility.ts` — quote_opened emission + the stale occurred_at comment (Pitfall 1)
- `src/core/servicem8/normalize.ts`, `src/core/audit/followup.ts` — TZDate idioms
- `src/app/api/internal/sync-tick/route.ts`, `scripts/apply-cron-schedules.mjs` — tick + schedule pattern
- `vitest.config.mts`, `package.json`, `.planning/config.json`, ROADMAP/STATE/REQUIREMENTS, Phase 2 CONTEXT + PATTERNS

### Secondary (MEDIUM confidence — official docs, fetched this session)
- https://www.postgresql.org/docs/15/sql-select.html — SKIP LOCKED semantics (quoted verbatim in Pattern 6)
- https://www.postgresql.org/docs/15/sql-insert.html — ON CONFLICT + partial unique index inference

### Tertiary (LOW confidence)
- None relied upon. (Seam `classify-confidence` rates websearch/webfetch LOW/… — all webfetch claims above are direct official-docs quotes, treated as CITED/MEDIUM.)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; every version read from package.json
- Architecture: HIGH — the phase's contracts are literally written into the Phase 2 schema headers; patterns extend proven in-repo idioms
- Pitfalls: HIGH for in-repo pitfalls (each traced to a file/line); MEDIUM for the concurrency-test guidance (established Postgres behavior, cited docs, but the race test must prove itself)

**Research date:** 2026-08-27
**Valid until:** ~2026-09-26 (internal-architecture phase over a stable stack; re-check only if package.json or the Phase 2 schema contracts change)
