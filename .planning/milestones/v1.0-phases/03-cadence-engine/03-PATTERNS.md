# Phase 3: Cadence Engine - Pattern Map

**Mapped:** 2026-08-27
**Files analyzed:** 30 new/modified files (from CONTEXT.md canonical refs + RESEARCH.md recommended structure)
**Analogs found:** 28 / 30 (2 files have no in-repo analog — see "No Analog Found")

All paths relative to repo root: `~/Documents/Projects/Productised service`

## File Classification

### New pure-logic modules (`src/core/cadence/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/cadence/constants.ts` | config/constants | — | `src/core/audit/constants.ts` (`GRACE_PERIOD_DAYS` usage in followup.ts) | exact |
| `src/core/cadence/window.ts` | utility (pure) | transform | `src/core/audit/followup.ts` | exact (pure date math, UTC-pinned) |
| `src/core/cadence/materialize.ts` | utility (pure) | transform | `src/core/servicem8/normalize.ts` (TZDate idiom) + `followup.ts` | exact |
| `src/core/cadence/rewindow.ts` | utility (pure policy) | transform | `src/core/sync/failure-policy.ts` + `followup.ts` | role-match |
| `src/core/cadence/transitions.ts` | state machine (pure) | event-driven | `src/core/sync/transitions.ts` | **exact — the canonical analog** |
| `src/core/cadence/primary-contact.ts` | utility (pure) | transform | `src/core/audit/followup.ts` (pure, caller-assembles-inputs style) | role-match |
| `src/core/cadence/consume-events.ts` | service (outbox consumer) | event-driven | `src/core/sync/eligibility.ts` (`markChaseEligible` co-commit txn) + `src/db/schema/quote-events.ts` header (the written contract) | exact |
| `src/core/cadence/dispatch.ts` | service | queue/claim | `src/core/sync/run-sync.ts` (per-tenant loop, outcome unions) — claim SQL itself is new (RESEARCH Pattern 6) | role-match |
| `src/core/cadence/sender.ts` | interface + stub | request-response | `src/core/servicem8/` client result-union style; interface shape given verbatim in 03-RESEARCH.md Pattern 6 | role-match |
| `src/core/cadence/run-tick.ts` | orchestrator | batch | `src/core/sync/run-sync.ts` (`runSyncTick`) | exact |

### New schema files (`src/db/schema/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/schema/cadence-templates.ts` | model | CRUD | `src/db/schema/tenants.ts` | exact |
| `src/db/schema/cadences.ts` | model | CRUD + state | `src/db/schema/sm8-connections.ts` (unique-constraint-as-concurrency-guarantee header) | exact |
| `src/db/schema/cadence-touches.ts` | model | CRUD + state | `src/db/schema/quotes.ts` (closed status vocab as `const` array) | exact |
| `src/db/schema/send-ledger.ts` | model (append ledger) | append-only | `src/db/schema/quote-events.ts` (no-FK-no-cascade attribution rationale) | exact |
| `src/db/schema/suppressed-contacts.ts` | model (insert-only) | append-only | `src/db/schema/quote-events.ts` (append-only) + `tenants.ts` (pgPolicy) | exact |
| `src/db/schema/index.ts` (modify) | barrel | — | itself | exact |

### Modified repository / route / infra

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/repository/for-tenant.ts` (extend) | repository | CRUD | itself (existing namespaces + `transaction()`) | exact |
| `src/db/repository/for-all-tenants.ts` (extend: `forAllTenants_cadenceTick`) | repository | cross-tenant read | `forAllTenants_syncTick` in same file | exact |
| `src/app/api/internal/cadence-tick/route.ts` | route (cron webhook) | request-response | `src/app/api/internal/sync-tick/route.ts` | **exact — clone byte-for-byte** |
| `src/core/shared/env.ts` (extend: `CADENCE_TICK_SECRET`) | config | — | itself (`SYNC_TICK_SECRET` lines 34, 111) | exact |
| `scripts/apply-cron-schedules.mjs` (extend: second job) | script | — | itself | exact |
| `src/db/migrations/00XX_cadence_table_grants.sql` | migration | — | `src/db/migrations/0007_sm8_table_grants.sql` / `0011_sync_table_grants.sql` | exact |
| `src/core/sync/eligibility.ts` (comment fix, lines 52-54) | doc fix | — | itself (Pitfall 1: stale `occurred_at` anchoring comment) | exact |

### Console (D-16)

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx` (new, per Open Question 1) | server component | request-response | `src/app/(console)/clients/[id]/page.tsx` | exact |
| `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts` (kill/pause/resume) | server action | request-response | `src/app/(console)/clients/[id]/actions.ts` | **exact — WR-01 pattern** |
| `.../action-state.ts` (state shapes) | utility | — | `src/app/(console)/clients/[id]/action-state.ts` | exact |
| Kill/resume form components | client component | request-response | `src/app/(console)/clients/[id]/triage-form.tsx`, `connect-form.tsx` | exact |

### Tests

| File | Role | Analog | Match Quality |
|---|---|---|---|
| `tests/cadence-transitions.test.ts` | unit (exhaustive matrix) | `tests/transitions.test.ts` | exact |
| `tests/cadence-window/materialize/rewindow/primary-contact.test.ts` | unit (pure) | `tests/failure-policy.test.ts`, `tests/sm8-normalize.test.ts` | exact |
| `tests/cadence-consume-events.test.ts` | integration (real DB) | `tests/quote-events.test.ts`, `tests/quote-triage.test.ts` | exact |
| `tests/cadence-dispatch.test.ts` | integration (concurrency race) | `tests/sync-upsert.test.ts` (real-DB pattern); intra-file `Promise.all` race is new (Pitfall 6) | role-match |
| `tests/cadence-tick-route.test.ts` | route auth test | `tests/sync-tick-route.test.ts` | exact |
| `tests/rls-coverage.test.ts` (extend) | standing guard | itself (grants map + presence list) | exact |
| `tests/helpers/seed.ts` (extend) | test helper | itself (`seedQuotes`, `seedConnection`, `seedTwoTenants`) | exact |

## Pattern Assignments

### `src/app/api/internal/cadence-tick/route.ts` — clone of `src/app/api/internal/sync-tick/route.ts`

**Analog:** `src/app/api/internal/sync-tick/route.ts` (104 lines — copy the whole file's shape, swap secret + worker)

**Route config + imports** (lines 36-45):
```typescript
import { timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '@/core/shared/env';
import { runSyncTick } from '@/core/sync/run-sync';   // → runCadenceTick from '@/core/cadence/run-tick'

export const maxDuration = 300;
export const runtime = 'nodejs';
```

**Auth pattern** (lines 55-74) — constant-time bearer; length check prevents `timingSafeEqual` throwing:
```typescript
function bearerMatches(header: string | null, expected: string): boolean {
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function unauthorized(): Response {
  return new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), getServerEnv().SYNC_TICK_SECRET)) {
    return unauthorized();
  }
```
Use `getServerEnv().CADENCE_TICK_SECRET` (new env var, rotates independently per RESEARCH).

**Response pattern** (lines 78-102): counts-only JSON — kinds and counts, never error strings or client names (T-2-15). Cadence tick returns e.g. `{ eventsConsumed, touchesPromoted, rewindowed, dispatched, refused }`.

**Header comments to replicate** (lines 1-35): why proxy.ts excludes `api/`, why the route owns its own auth, why the work is awaited (no `waitUntil`), and why outcomes are durably recorded in tables — not the HTTP response.

---

### `src/core/cadence/transitions.ts` — copy `src/core/sync/transitions.ts`

**Analog:** `src/core/sync/transitions.ts` (95 lines)

**Core pattern** (lines 53-94): a pure, TOTAL function over closed vocabularies — no `default: throw`, no null-by-omission:
```typescript
export function classifyTransition(
  prev: Sm8Status | null,
  next: Sm8Status,
  becameInactive: boolean,
): QuoteEventType | null {
  if (becameInactive) return 'removed';       // priority ordering is explicit
  if (prev === null) return next === 'Quote' ? 'quote_opened' : null;
  if (prev === next) return null;
  switch (next) {
    case 'Quote': return 'reopened';
    case 'Work Order':
    case 'Completed': return prev === 'Quote' || prev === 'Unsuccessful' ? 'won' : null;
    case 'Unsuccessful': return 'lost';
  }
}
```
Cadence version: `transition({status}, event) → {status, reason?} | {refused}` for both machines (CADENCE_STATUSES × cadence events; TOUCH_STATUSES × touch events — vocabularies in 03-RESEARCH.md Pattern 4).

**Header doc pattern** (lines 1-30): explains WHY the matrix is closed, which cells deliberately differ from naive expectation, and what is NOT decided in the pure function (gating stays in the caller). Replicate: e.g. `won` at a `paused` cadence still stops it; `customer_reply` at `stopped` is a no-op.

---

### `src/core/cadence/window.ts` + `materialize.ts` — TZDate idioms

**Analog 1:** `src/core/servicem8/normalize.ts` lines 104-117 — wall-clock-in-zone → UTC instant:
```typescript
// TZDate's constructor reads the numeric components AS WALL-CLOCK TIME in the
// given zone and resolves the offset — including DST — for that date
const zoned = new TZDate(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ianaZone);
const instant = new Date(zoned.getTime());
return Number.isNaN(instant.getTime()) ? null : instant;   // impossible dates → null, never Invalid Date
```

**Analog 2:** `src/core/audit/followup.ts` lines 46-49 — fixed-duration day math pinned to UTC (no DST days):
```typescript
export function graceDeadline(quoteDateUtc: Date): Date {
  // UTC has no DST, so `addDays` here is exactly GRACE_PERIOD_DAYS × 24h.
  return new Date(addDays(new TZDate(quoteDateUtc, 'UTC'), GRACE_PERIOD_DAYS).getTime());
}
```

**Analog 3:** `src/db/schema/tenants.ts` lines 34-39 — the exact input columns:
```typescript
timezone: text('timezone').notNull().default('Australia/Perth'),   // IANA, never offset
contactHoursStart: time('contact_hours_start').notNull(),           // driver returns 'HH:MM:SS' STRING
contactHoursEnd: time('contact_hours_end').notNull(),
contactDays: smallint('contact_days').array().notNull(),            // ISO weekdays, Mon=1..Sun=7
```
Pitfalls bound to this file: ISO weekday vs `getDay()` conversion `((zoned.getDay() + 6) % 7) + 1`; parse `time` strings to minutes-since-midnight; assert `start < end` loudly (RESEARCH Pitfalls 2-3, A1). Jitter drawn ONCE at materialization, RNG injected (Pitfall 4).

Also copy followup.ts's defensive-null style (lines 62-73): reject null/NaN dates loudly at the top, resolve ambiguity in the documented direction.

---

### `src/core/cadence/consume-events.ts` — outbox consumer

**Analog 1 (the written contract):** `src/db/schema/quote-events.ts` header lines 12-35 — read cursor for consumer `'cadence-engine'`, register with `INSERT ... ON CONFLICT DO NOTHING` (no seeded row), scan `WHERE id > $cursor ORDER BY id` (never `detected_at`/`occurred_at`), act + advance cursor IN THE SAME TRANSACTION. Replay is legal; idempotence is the consumer's job.

**Analog 2 (co-commit transaction shape):** `src/core/sync/eligibility.ts` lines 68-90:
```typescript
return forTenant(tenantId).transaction(async (tx) => {
  const flipped = await tx.quotes.updateEligibilityWhereNeedsReview(unique);
  if (flipped.length === 0) return { flipped: 0, eventsEmitted: 0 };
  const events: QuoteStatusEventInsert[] = flipped.map((quote) => ({ ... }));
  const eventsEmitted = await tx.events.insertMany(events);
  return { flipped: flipped.length, eventsEmitted };
});
```
Note the RETURNING-drives-emission idiom: act only on rows that actually changed, making re-runs no-ops.

**MUST-FIX in this analog (RESEARCH Pitfall 1):** `eligibility.ts` lines 52-54 comment — "Phase 3 measures its cadence offsets from when the tradie sent the quote" — is superseded by D-01. Anchor on `detected_at`/consumption `now()`, never `occurred_at`, and fix the comment in this phase.

**Framework-free header pattern:** eligibility.ts lines 16-24 ("FRAMEWORK-FREE ON PURPOSE... Nothing here imports from `next/*`... WHAT THE CALLER MUST STILL DO: authorize") — every `src/core/cadence/` module follows this.

---

### `src/db/repository/for-all-tenants.ts` — add `forAllTenants_cadenceTick()`

**Analog:** `forAllTenants_syncTick` in the same file, lines 88-104:
```typescript
export async function forAllTenants_syncTick(): Promise<DueConnection[]> {
  return getDb()
    .select({ tenantId: sm8Connections.tenantId, tenantName: tenants.name, ... })
    .from(sm8Connections)
    .innerJoin(tenants, eq(sm8Connections.tenantId, tenants.id))
    .where(isNull(sm8Connections.pausedAt))
    .orderBy(sql`${sm8Connections.lastSuccessAt} ASC NULLS FIRST`, sm8Connections.tenantId);
}
```
House rules from this file's header (lines 1-29): cross-tenant work is an explicitly-named export in THIS file with its own justification comment — never a parameter on an existing export, never a `forTenant()` accepting a tenantId. Return deliberately thin metadata; the moment a tenant is known, go back through `forTenant(id)`. Deterministic ORDER BY with `tenant_id` tie-break.

`forTenant()` extension analog: `src/db/repository/for-tenant.ts` — existing namespaces (`tx.quotes`, `tx.events`), `transaction()` at line 512, UUID guard at lines 516-524. Add `cadences`/`touches`/`suppression`/`ledger` namespaces in the same shape.

---

### Schema files — copy `tenants.ts` / `sm8-connections.ts` / `quote-events.ts`

**pgPolicy pattern** (every tenant-scoped table — `src/db/schema/tenants.ts` lines 68-76):
```typescript
(table) => [
  pgPolicy('send_ledger_member_access', {
    as: 'permissive',
    for: 'all',
    to: authenticatedRole,
    using: sql`has_tenant_access(tenant_id)`,
    withCheck: sql`has_tenant_access(tenant_id)`,
  }),
],
```
Imports: `import { sql } from 'drizzle-orm'; import { pgPolicy, pgTable, ... } from 'drizzle-orm/pg-core'; import { authenticatedRole } from 'drizzle-orm/supabase';` and export `$inferSelect`/`$inferInsert` types at the bottom.

**Closed vocabulary pattern** (`quote-events.ts` lines 96-103):
```typescript
export const QUOTE_EVENT_TYPES = ['quote_opened', 'won', 'lost', 'reopened', 'removed'] as const;
export type QuoteEventType = (typeof QUOTE_EVENT_TYPES)[number];
```
Apply to `CADENCE_STATUSES`, `TOUCH_STATUSES`, `TOUCH_SKIP_REASONS`, `SEND_LEDGER_OUTCOMES` (values in 03-RESEARCH.md Pattern 4). Note migration `0008_sm8_vocabulary_constraints.sql` adds CHECK constraints for vocabularies — mirror it.

**No-FK-no-cascade for attribution evidence** (`quote-events.ts` lines 111-117) — apply to `send_ledger.tenant_id`:
```typescript
/**
 * No FK to `tenants` and no ON DELETE CASCADE, deliberately: this is the
 * ledger Phase 7 computes recovered revenue from, and a disconnected client
 * must not take their own attribution history with them. Isolation is
 * enforced by the policy below, not by the reference.
 */
tenantId: uuid('tenant_id').notNull(),
```

**Unique-constraint-as-concurrency-guarantee header** (`sm8-connections.ts` lines 4-10) — the rationale to replicate on the send-ledger unique index and the one-live-cadence-per-quote partial unique:
> "the uniqueness constraint IS the concurrency guarantee... the database — not application-level checking, which is a TOCTOU by construction — decides that exactly one row survives."

Ledger + partial-unique skeletons are given fully in 03-RESEARCH.md Code Examples (send_ledger with `uniqueIndex('send_ledger_cadence_touch_uniq').on(cadenceId, touchNumber)`; `cadences_one_live_per_quote` partial on `status IN ('active','paused')`).

**Cross-tenant table policy** (`quote-events.ts` lines 178-194): `event_consumer_cursors` uses `is_operator()` not `has_tenant_access` — if any new table is not tenant-scoped, follow this.

---

### Grants migration — copy `src/db/migrations/0007_sm8_table_grants.sql`

REVOKE-then-GRANT block per table (lines 30-37 shape), one block per new table, ordered AFTER the tables exist and after `is_operator()`/`has_tenant_access` helpers (Pitfall 7 — policies resolve functions at DDL time):
```sql
REVOKE ALL ON public.send_ledger FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.send_ledger FROM authenticated;
--> statement-breakpoint
-- then explicit GRANTs: anon SELECT (so unauthenticated reads return [] not 42501),
-- authenticated per documented need — see 0007/0011 headers for the rationale prose.
```
Then enumerate all 5 tables in `tests/rls-coverage.test.ts`'s grants map (lines 116-139 assert `information_schema.role_table_grants` matches an exact expected map) and its RLS-presence list.

---

### Console actions — copy `src/app/(console)/clients/[id]/actions.ts`

**File shape** (lines 1-31): `'use server'` at top; state shapes + BLANK constants in a sibling `action-state.ts` (a 'use server' module may export only async functions); copy constants for user-facing messages.

**The WR-01 auth pattern — MANDATORY for kill/pause/resume** (lines 50, 123-148):
```typescript
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(tenantId: string): Promise<ConnectState | null> {
  if (!UUID_PATTERN.test(tenantId)) return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { ...BLANK_CONNECT_STATE, formError: 'Your session has expired. Sign in again.' };
  // RLS-scoped membership read with the OPERATOR'S OWN JWT — Postgres decides,
  // because the core function writes through service-role and bypasses RLS.
  const { data: tenant, error } = await supabase.from('tenants').select('id').eq('id', tenantId).maybeSingle();
  if (error || !tenant) return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  return null;
}
```
Every action starts `const denied = await authorize(tenantId); if (denied) return denied;` BEFORE reading formData (line 268: "There is nothing in `formData` worth parsing for a caller who is not entitled to this client"). Resume is the most sensitive action here — it restarts messaging.

**zod input pattern** (lines 237-239): `z.object({ quote_ids: z.array(z.uuid()).min(1).max(1000) })` — UUIDs validated at the action, with `.max()` bounding forged POSTs; success path ends with `revalidatePath(...)`. Result switch over a closed `kind` union, mapping each to fixed message constants.

**Server component page:** `src/app/(console)/clients/[id]/page.tsx` (636 lines) — the quote-list rendering, `_auth.ts` gate, and RLS-scoped reads the new quote-detail page extends. Phone-first layout for the kill switch (CONTEXT Specific Ideas).

---

### `scripts/apply-cron-schedules.mjs` — add second job

**Analog:** itself. Current constants (lines 47-52):
```javascript
const JOB_NAME = 'sm8-sync-tick';
const SCHEDULE = '*/5 * * * *';
const TICK_PATH = '/api/internal/sync-tick';
const DISPATCH_TIMEOUT_MS = 8000;
```
Add `('cadence-tick', '* * * * *', '/api/internal/cadence-tick', CADENCE_TICK_SECRET)` and generalize the apply loop (unschedule-if-exists lines 125-128, `cron.schedule` line 130, print jobname+schedule ONLY — never the command, it holds the bearer). Keep the pooler-port guard (lines 64-69: session 5432, never 6543) and the `lit()` SQL-literal escaper (line 108). `tests/cron-schedules.test.ts` is the analog test to extend.

**Env var:** `src/core/shared/env.ts` — add `CADENCE_TICK_SECRET: z.string().min(32)` to `serverEnvSchema` (line 34 analog) AND the explicit `process.env.CADENCE_TICK_SECRET` reference (line 111 analog — the explicit reference is load-bearing for Next bundling).

---

### Tests

**Exhaustive matrix:** `tests/transitions.test.ts` (235 lines) — the analog for `cadence-transitions.test.ts`. Hand-written EXPECTED table per (status × event) cell; test asserts the function is total (returns for every pair, never throws). RESEARCH Code Examples give the exact loop skeleton.

**Real-DB integration:** `tests/helpers/seed.ts` exports to extend — `seedTwoTenants()` (line 110, for the cross-tenant leak test), `seedTenant`, `seedConnection` (line 176), `seedQuotes` (line 196), `seedQuoteContacts` (line 218), `teardownTenants` (line 362), `signInAsOperator` (line 375). Add `seedCadence`, `seedTouches`, `seedTouchTemplates`, `seedSuppression` in the same shape. Env gating via `tests/helpers/env.ts` (`ALLOW_REMOTE_TESTS`).

**Concurrency race (CAD-04):** no true analog — `vitest.config.mts` sets `fileParallelism: false`, so the race must be intra-file `Promise.all([dispatch(), dispatch()])` over a driver pool with `max ≥ 2` or two separate `postgres()` clients (RESEARCH Pitfall 6). Closest structural analog for real-DB assertion style: `tests/sync-upsert.test.ts`.

**Route auth:** `tests/sync-tick-route.test.ts` — assert 401 plain with NO `Location` header (provably not a redirect).

## Shared Patterns

### Tenancy / RLS triple control
**Source:** `src/db/schema/tenants.ts` (pgPolicy), `src/db/migrations/0007_sm8_table_grants.sql` (revoke-then-grant), `tests/rls-coverage.test.ts` (exact-grants + presence assertions).
**Apply to:** all 5 new tables. Every table needs all three or the coverage test fails the build.

### Framework-free core with authorize-in-caller
**Source:** `src/core/sync/eligibility.ts` header (lines 16-24).
**Apply to:** everything under `src/core/cadence/` — no `next/*` imports; server actions authorize, core functions scope.

### Result unions, never throws, closed vocabularies
**Source:** `src/core/sync/transitions.ts`, `connect.ts` result kinds consumed by `actions.ts` switch (lines 88-101).
**Apply to:** `SendOutcome`, transition outcomes, dispatch refusal reasons — exhaustive `switch` on `kind`, no free-text error parsing.

### Postgres arbitrates concurrency, never app code
**Source:** `sm8-connections.ts` header (unique constraint = concurrency guarantee); `eligibility.ts` RETURNING-driven emission; outbox co-commit rule.
**Apply to:** send-ledger unique insert (`ON CONFLICT DO NOTHING RETURNING id` — zero rows = refuse), one-live-cadence partial unique, cursor co-commit, guarded `UPDATE ... WHERE status = 'active'` stops.

### Heavily-annotated code as documentation
**Source:** every analog above. This codebase writes long WHY-headers naming decisions (D-xx), threats (T-x-xx), and requirements (CAD-xx) directly in file headers, and records what is deliberately ABSENT. New files must match this register — the Phase 2→3 contract literally lives in schema comments.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/core/cadence/dispatch.ts` claim SQL (`FOR UPDATE SKIP LOCKED`) | service | queue claim | No queue-like claim exists in-repo; use 03-RESEARCH.md Pattern 6 + Code Examples (cited Postgres docs) verbatim |
| `src/core/cadence/sender.ts` interface | interface | request-response | No provider-send seam exists yet; the `TouchSender`/`SendRequest`/`SendOutcome` shape is specified verbatim in 03-RESEARCH.md Pattern 6 — it is the Phase 4 contract, copy it exactly |

## Metadata

**Analog search scope:** `src/core/**`, `src/db/**`, `src/app/**`, `scripts/`, `tests/`, `src/db/migrations/`
**Files read in full or targeted:** 14 (sync-tick route, sync transitions, tenants, quote-events, sm8-connections, for-all-tenants, clients/[id]/actions, apply-cron-schedules, followup, eligibility, normalize excerpt, 0007 grants excerpt, + grep indexes of for-tenant/env/rls-coverage/seed)
**Pattern extraction date:** 2026-08-27
