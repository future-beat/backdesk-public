# Phase 7: Attribution & Reporting - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 29 new/modified files (from 07-CONTEXT.md, 07-RESEARCH.md "Recommended Project Structure", and 07-UI-SPEC.md Screens 1–5)
**Analogs found:** 27 / 29 (2 files are pure-function modules with a role-match only; nothing is truly analog-free — every hard guarantee in this phase has a named, tested precedent)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/audit/constants.ts` (MOD: +`ATTRIBUTION_WINDOW_DAYS`, `DEFAULT_BASELINE_WIN_RATE`, `BASELINE_MIN_QUOTES`, `OPT_OUT_ALARM_RATE`, `FIRST_TOUCH_HOURS`) | config (no-import constants) | — | itself (`AUDIT_RECOVERY_RATE` doc-comment shape) | exact |
| `src/core/cadence/constants.ts` (MOD: +`ATTRIBUTION_CONSUMER = 'attribution'`) | config | — | itself (`CADENCE_CONSUMER`) | exact |
| `src/core/attribution/qualify.ts` (NEW) | utility (pure predicate) | transform | `src/core/audit/aggregate.ts` (`auditWindow`, elapsed-ms windows, inclusive edges) + `src/core/aging/stall-policy.ts` (pure policy) | role-match |
| `src/core/attribution/baseline.ts` (NEW) | utility (pure resolver) | transform | `src/core/audit/aggregate.ts` `computeBaseline` + `RECOVERY_RATE_BASIS_POINTS` | exact |
| `src/core/attribution/money.ts` (NEW) | utility (pure integer math) | transform | `src/core/audit/aggregate.ts:207-214` (floored basis-point math) + `src/core/servicem8/normalize.ts` `parseMoneyToCents`/`centsToNumeric` | exact |
| `src/core/attribution/evidence.ts` (NEW) | utility (zod schema + builder) | transform | `src/core/escalation/message.ts` (closed-vocabulary pure builder, per 06-PATTERNS) | role-match |
| `src/core/attribution/consume-wins.ts` (NEW) | service (outbox consumer, tick pass) | event-driven | `src/core/cadence/consume-events.ts` (register → scan → same-tenant runs → advance-in-tx → head-of-line) | exact |
| `src/core/cadence/run-tick.ts` (MOD: +`runAttributionPass`, 6 fields on `CadenceTickResult` (37 → 43), `attribution: 'run' \| 'skip'` seam) | service (tick composition) | batch | itself (`runEscalationPass` + the `escalationSender` no-default seam) | exact |
| `src/app/api/internal/cadence-tick/route.ts` (MOD: +6 enumerated fields) | route | request-response | itself (:153-200 field-by-field enumeration) | exact |
| `src/core/reporting/period.ts` (NEW) | utility (pure date math) | transform | `src/core/cadence/window.ts` (`TZDate` idiom) + `aggregate.ts` `auditWindow` | role-match |
| `src/core/reporting/fees.ts` (NEW) | utility (pure) | transform | `src/core/audit/aggregate.ts` (integer-cents accumulation, floor once) | role-match |
| `src/core/reporting/metrics.ts` (NEW) | utility (pure rates) | transform | `src/core/audit/aggregate.ts` `computeBaseline` (null-never-0) + `src/core/onboarding/checklist.ts` `isAttestationStale` (one predicate, two surfaces) | role-match |
| `src/core/reporting/figures.ts` (NEW) | utility (pure aggregation) | transform | `src/core/audit/aggregate.ts` `computeAuditFigures` | exact |
| `src/core/reporting/generate.ts` (NEW) | service (frozen row writer) | CRUD | `src/core/drafting/onboarding-gate.ts` `attestSm8AutomationOff` (core owns the transaction; action authorizes + maps) + `for-tenant.ts` `insertClaim` | role-match |
| `src/core/reporting/opt-out-section.ts` (NEW) | utility (digest section builder) | transform | `src/core/aging/stalled-digest.ts` `buildStaleAttestationSection` | exact |
| `src/core/aging/stalled-digest.ts` (MOD: compose `buildOptOutSection` into `sections`) | service | batch | itself (:130-138 `sections` composition) | exact |
| `src/db/schema/quote-attributions.ts` (NEW) | model (evidence table, never-twice claim) | event-driven | `src/db/schema/escalations.ts` (evidence-family header, `uniqueIndex`, `pgPolicy`) | exact |
| `src/db/schema/monthly-reports.ts` (NEW) | model (evidence, frozen document, versioned) | CRUD | `src/db/schema/escalations.ts` (evidence rules) + `src/db/schema/tenant-attestations.ts` (append-only, latest-wins index) | exact |
| `src/db/schema/tenant-fees.ts` (NEW) | model (config family, append-only) | CRUD | `src/db/schema/cadence-settings.ts` (FK cascade to `tenants`) + `src/db/schema/tenant-attestations.ts` (append-only rows, `effective_from DESC` index shape) | exact |
| `src/db/migrations/0033_phase7_reporting.sql` (NEW, one wave) | migration | — | `src/db/migrations/0032_phase6_console.sql` (generate → rename tag → hand-finish CHECK + REVOKE/GRANT) | exact |
| `src/db/repository/for-tenant.ts` (MOD: `attributions.*`, `reports.*`, `fees.*`, `ledger.listForQuote`, `inbound.listThreadedForQuote`, `escalations.listForQuote`, `events.wonInPeriod`) | repository (tenant-scoped) | CRUD | itself (`ledger.insertClaim` / `listForCadence`, `events.since`, `consumerCursor.advanceTo`) | exact |
| `src/db/repository/for-all-tenants.ts` (MOD: `forAllTenants_reportMetrics`) + `index.ts` barrel line | repository (cross-tenant accessor) | request-response | `forAllTenants_stalledTally` (:1006-1032 grouped counts, no address) — but WITHOUT the `tenants` join (the page-feeding rule) | exact |
| `src/app/(console)/reports/page.tsx` (NEW) | page (server component, cross-tenant) | request-response | `src/app/(console)/inbox/page.tsx` (gate → read → names via JWT) + `src/app/(console)/page.tsx` (client-list `<table>`) | exact |
| `src/app/(console)/reports/[client]/page.tsx` (NEW) | page (tenant-scoped) | request-response | `src/app/(console)/clients/[id]/page.tsx` (uuid check → RLS read → `.profile` dl, `.zone-note`, capped reads) | exact |
| `src/app/(console)/reports/[client]/actions.ts` (NEW: `generateReportAction`, `appendFeeAction`) + `action-state.ts` | server actions | request-response | `src/app/(console)/clients/[id]/actions.ts` (`authorize()` → zod → core call → try/catch → `revalidatePath`) + `action-state.ts` | exact |
| `src/app/(console)/reports/[client]/generate-form.tsx`, `fee-schedule-form.tsx` (NEW) | client components | request-response | `src/app/(console)/clients/[id]/escalation-phone-form.tsx` (`useActionState`, `.disclosure`, pending labels) | exact |
| `src/app/(console)/reports/[client]/[reportId]/page.tsx` (NEW) + `print-button.tsx` | page (print document) + client component | request-response | `src/app/(console)/audits/[id]/page.tsx` (render-from-row, uuid → 404, figure/footnote from one value) + `convert-form.tsx` (screen-only client component) | exact |
| `src/app/(console)/reports/[client]/[reportId]/report.css` (NEW) | stylesheet (page-scoped, print) | — | `src/app/(console)/audits/[id]/audit.css` (clone verbatim, extend selectors) | exact |
| `src/app/globals.css` (MOD: `.num`, `.metrics`) | stylesheet | — | itself (`.profile` :408-422, `.badge` :330-365) | exact |
| `src/app/(console)/layout.tsx` (MOD: nav link) + `clients/[id]/page.tsx` (MOD: one `.meta` link) | layout / page | — | itself (:117-134 nav order; client page :909 `Voice & templates →`) | exact |
| `tests/attribution-*.test.ts`, `tests/reporting-*.test.ts`, `tests/opt-out-section.test.ts` (NEW, pure) | test | — | `tests/audit-aggregate.test.ts` (pure + source assertions) | exact |
| `tests/attribution-consume.test.ts`, `tests/monthly-report.test.ts`, `tests/report-metrics.test.ts` (NEW, remote) | test | — | `tests/cadence-consume-events.test.ts` (park-at-head / rewind / replay-is-no-op) | exact |
| `tests/reports-authorization.test.ts` (NEW) | test | — | `tests/inbox-authorization.test.ts` (mock repo, real gate, call-count on denied paths) | exact |
| Pinned-test extensions: `tests/sync-upsert.test.ts:498,673`, `tests/audit-aggregate.test.ts:53`, `tests/rls-coverage.test.ts:116`, `tests/cadence-tick.test.ts:535`, `tests/cadence-tick-route.test.ts:316`, `tests/helpers/seed.ts` | test | — | themselves (each is a deliberate-widening tripwire) | exact |

## Pattern Assignments

### `src/core/attribution/consume-wins.ts` — the second outbox consumer (RPT-01)

**Analog:** `src/core/cadence/consume-events.ts` (963 lines; read the header :1-120, `ZERO_RESULT`/`NO_CONSUMPTION`/`contiguousRuns` :301-335, `consumeRun` :740-870, `consumeQuoteEvents` :878-963)

**Imports pattern** (consume-events.ts:120-142) — the consumer reaches the outbox ONLY through the barrel, never `getDb()`:
```typescript
import {
  forAllTenants_pendingQuoteEvents,
  forTenant,
  registerConsumerCursor,
  type TenantScopedRepository,
} from '@/db/repository';
import type { QuoteStatusEvent } from '@/db/schema';
import { CADENCE_CONSUMER } from './constants';   // → ATTRIBUTION_CONSUMER from '@/core/cadence/constants'
```

**Batch limit is a documented transaction bound, not a knob** (consume-events.ts:155-160):
```typescript
/** How many events one tick consumes. NOT A PERFORMANCE KNOB ... it bounds the work
 * of a single transaction, so a consumer registering for the first time against
 * months of history makes steady progress instead of opening one enormous
 * transaction that rolls back in full on any error. */
export const CONSUME_BATCH_LIMIT = 200;
```

**Result shape + frozen zero literal** (consume-events.ts:298-311) — copy this exactly, with `attributionEventsConsumed`, `attributionsRecorded`, `attributionsUnqualified`, `attributionsValueMissing`, `attributionCursorAt`, `attributionTenantsBlocked`:
```typescript
const ZERO_RESULT = (cursorAt: number): ConsumeQuoteEventsResult => ({
  eventsConsumed: 0, cadencesCreated: 0, cadencesStopped: 0,
  quotesFlaggedForReview: 0, eventsSkipped: 0, tenantsBlocked: 0, cursorAt,
});
/** What a consume pass that could not run AT ALL reports. Exported so the tick's guard
 * around this pass reports the shape rather than inventing one ... */
export const NO_CONSUMPTION: ConsumeQuoteEventsResult = Object.freeze(ZERO_RESULT(0));
```

**Same-tenant chunking** (consume-events.ts:323-335) — copy verbatim:
```typescript
function contiguousRuns(events: readonly QuoteStatusEvent[]): QuoteStatusEvent[][] {
  const runs: QuoteStatusEvent[][] = [];
  for (const event of events) {
    const current = runs[runs.length - 1];
    if (current && current[0].tenantId === event.tenantId) current.push(event);
    else runs.push([event]);
  }
  return runs;
}
```

**One run = one transaction ending in one advance** (consume-events.ts:740-748, 860-870):
```typescript
async function consumeRun(events, tenant, jitterMinutes, advanceCursor: boolean): Promise<RunOutcome> {
  const tenantId = events[0].tenantId;
  return forTenant(tenantId).transaction(async (tx) => {
    const outcome: RunOutcome = { consumed: 0, ..., advancedTo: 0, blocked: false };
    // ... per-event work through `tx.*` ...
    // STILL IN THE SAME TRANSACTION AS THE WRITES IT ACCOUNTS FOR — the clause
    // of the consumption contract that survives everything else. `advanceCursor`
    // only ever withholds the advance; it never moves it independently.
    if (advanceCursor && outcome.advancedTo > 0) {
      await tx.consumerCursor.advanceTo(CADENCE_CONSUMER, outcome.advancedTo);
    }
    return outcome;
  });
}
```

**Entry: register → scan → head-of-line loop** (consume-events.ts:878-963) — clone whole, swapping the consumer name and dropping `forAllTenants_cadenceTick` (attribution needs no window metadata):
```typescript
export async function consumeQuoteEvents(options = {}): Promise<ConsumeQuoteEventsResult> {
  const { batchLimit = CONSUME_BATCH_LIMIT } = options;
  const cursor = await registerConsumerCursor(CADENCE_CONSUMER);
  const pending = await forAllTenants_pendingQuoteEvents(cursor, batchLimit);
  if (pending.length === 0) return ZERO_RESULT(cursor);
  const result = ZERO_RESULT(cursor);
  const blockedTenants = new Set<string>();   // their LATER runs are not attempted
  let cursorHeld = false;                      // once true, no later run may advance
  for (const run of contiguousRuns(pending)) {
    const tenantId = run[0].tenantId;
    if (blockedTenants.has(tenantId)) continue;
    let outcome: RunOutcome;
    try {
      outcome = await consumeRun(run, tenantsById.get(tenantId), jitterMinutes, !cursorHeld);
    } catch {
      // The caught value is deliberately not logged: a driver error carries the
      // statement, whose parameters are this tenant's data.
      console.error(`[cadence] consumption threw for tenant ${tenantId}; the cursor is held ...`);
      outcome = { consumed: 0, ..., advancedTo: 0, blocked: true };
    }
    result.eventsConsumed += outcome.consumed;
    if (!cursorHeld && outcome.advancedTo > 0) result.cursorAt = outcome.advancedTo;
    if (outcome.blocked) { blockedTenants.add(tenantId); cursorHeld = true; result.tenantsBlocked = blockedTenants.size; }
  }
  return result;
}
```

**Per-event branch for Phase 7:** only `event.eventType === 'won'` does work; the other four types increment `consumed` and set `advancedTo = event.id`. Inside the `won` arm: `tx.ledger.listForQuote(quoteId)` → `qualifyingTouches(rows, event.detectedAt)` → if none, count `unqualified` and move on; else read quote/connection/inbound/escalations/cadences through `tx.*`, build the evidence jsonb, and `tx.attributions.claim(...)` (zero rows returned = replay or second win — consumed, not recorded). A missing quote row still claims with `valueSource: 'missing'`, `grossCents: 0` (RESEARCH Pitfall 8) — never hold the cursor for it.

**Cursor registration** (src/db/repository/consumer-cursor.ts:46-69) — reuse as-is; the header explains why registration is here and the advance is on `forTenant()`:
```typescript
export async function registerConsumerCursor(consumer: string): Promise<number> {
  const db = getDb();
  await db.insert(eventConsumerCursors).values({ consumer, lastEventId: 0 })
    .onConflictDoNothing({ target: eventConsumerCursors.consumer });
  const [row] = await db.select({ lastEventId: eventConsumerCursors.lastEventId })
    .from(eventConsumerCursors).where(eq(eventConsumerCursors.consumer, consumer));
  if (!row) throw new Error(`registerConsumerCursor('${consumer}') found no row after insert. ...`);
  return row.lastEventId;
}
```

**Never-rewind advance** (for-tenant.ts:2894-2910) — already consumer-name parameterised; no change needed:
```typescript
consumerCursor: {
  advanceTo: async (consumer: string, toEventId: number) => {
    const moved = await db.update(eventConsumerCursors)
      .set({ lastEventId: toEventId, updatedAt: sql`now()` })
      .where(and(eq(eventConsumerCursors.consumer, consumer),
                 lt(eventConsumerCursors.lastEventId, toEventId)))   // THE NEVER-REWIND GUARD
      .returning({ lastEventId: eventConsumerCursors.lastEventId });
    return moved.length;
  },
},
```

---

### `src/core/cadence/run-tick.ts` MOD + `cadence-tick/route.ts` MOD — the attribution pass in the tick

**Analog:** itself. `runEscalationPass` (run-tick.ts:773-783) is the guard shape; the `escalationSender` option (:195-200, :893-896) is the "undefined means the pass does not scan" seam RESEARCH Pitfall 3 asks for.

**Pass guard** (run-tick.ts:773-783):
```typescript
async function runEscalationPass(now: Date, sender: EscalationSmsSender | undefined): Promise<EscalationCounts> {
  try {
    return await escalateHotLeads({ sender, now });
  } catch {
    console.error('[cadence] hot-lead escalation failed this tick.');
    return { ...NO_ESCALATIONS };
  }
}
```
For Phase 7: `runAttributionPass(mode: 'run' | 'skip')` returns `NO_ATTRIBUTION` on `'skip'` (the default) and on throw; the route passes `'run'`. This keeps every existing tick test (which calls `runCadenceTick` without the option) from draining the production outbox into `quote_attributions`.

**The consume-pass guard the attribution pass sits after** (run-tick.ts:911-926):
```typescript
let consumed = NO_CONSUMPTION;
try {
  consumed = await consumeQuoteEvents({ jitterMinutes, batchLimit });
} catch {
  console.error('[cadence] event consumption failed this tick; proceeding to dispatch.');
}
```

**Result enumeration, no spread** (run-tick.ts:943-991 and route.ts:153-200) — add the new fields one by one in BOTH places, with the grouped-rationale comment style:
```typescript
// CON-03 / 06-05, enumerated one by one like everything above. NO SPREAD: ...
hotEscalated: escalation.hotEscalated,
escalationCooldownSuppressed: escalation.cooldownSuppressed,
```
```typescript
// route.ts — "A POSITION, not a count — and still just a number."
cursorAt: result.cursorAt,
tenantsBlocked: result.tenantsBlocked,
```

**Pinned tests to extend in the same task:** `tests/cadence-tick.test.ts:535-607` (exhaustive `toEqual` literal — add the fields; `attributionCursorAt: expect.any(Number)` like `cursorAt` at :541) and `tests/cadence-tick-route.test.ts:316` ("reports EXACTLY the agreed key set").

---

### `src/db/schema/quote-attributions.ts` — evidence table with the never-twice claim

**Analog:** `src/db/schema/escalations.ts` (full file, 189 lines)

**Header discipline** (escalations.ts:12-25) — restate the evidence-family rules verbatim in the new header:
```
 *   * `tenant_id` is a COLUMN, not a foreign key, and there is NO CASCADE from
 *     `tenants`. A client who disconnects must not take the record of what we
 *     did on their behalf with them — the same rule `quote_status_events`,
 *     `send_ledger`, `suppressed_contacts` and `inbound_messages` all follow.
 *   * RLS is authored HERE, as a `pgPolicy`, so a new table cannot ship
 *     unprotected by omission (the Phase 1 rule).
 *   * READ-ONLY to `authenticated`; every write is service-role.
```

**Imports + vocabulary constant** (escalations.ts:60-70, 108-113):
```typescript
import { sql } from 'drizzle-orm';
import { index, integer, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const ESCALATION_OUTCOMES = ['sent', 'no_escalation_number', 'sms_not_configured', 'cooldown_suppressed'] as const;
export type EscalationOutcome = (typeof ESCALATION_OUTCOMES)[number];
```
Phase 7 adds `ATTRIBUTION_VALUE_SOURCES = ['mirror', 'missing'] as const` and `BASELINE_SOURCES = ['connect', 'default'] as const` in the same shape (CHECK-constrained in the migration; add `jsonb`, `bigint`/`numeric`, `smallint` to the import list).

**Table body: denormalised ids with no FK, unique claim, per-period index, policy** (escalations.ts:115-185):
```typescript
export const escalations = pgTable('escalations', {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The inbound reply this alert is ABOUT — and the never-twice key. No FK ... */
    inboundMessageId: uuid('inbound_message_id').notNull(),
    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),
    cadenceId: uuid('cadence_id').notNull(),
    /** Denormalized so attribution can group by quote without a join. */
    quoteId: uuid('quote_id').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    outcome: text('outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** THE NEVER-TWICE CLAIM (D-08). See the header. */
    uniqueIndex('escalations_inbound_message_uniq').on(table.inboundMessageId),
    /** Phase 7's per-client, per-period read. */
    index('escalations_tenant_created_idx').on(table.tenantId, table.createdAt),
    pgPolicy('escalations_member_access', {
      as: 'permissive', for: 'all', to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);
export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
```
For `quote_attributions`: `uniqueIndex('quote_attributions_one_per_quote').on(table.tenantId, table.quoteId)` (tenant-scoped, the `quotes_tenant_job_uniq` argument) and `index('quote_attributions_tenant_won_idx').on(table.tenantId, table.wonDetectedAt)` (the D-10 month read). For `monthly_reports`: `uniqueIndex('monthly_reports_version_uniq').on(table.tenantId, table.periodStart, table.version)`.

---

### `src/db/schema/tenant-fees.ts` — append-only config family

**Analog:** `src/db/schema/cadence-settings.ts` (FK/cascade) + `src/db/schema/tenant-attestations.ts` (append-only + latest-wins index)

**FK with cascade — config, not evidence** (cadence-settings.ts:47-59):
```typescript
import { tenants } from './tenants';
// ...
    /** Cascades: like the touch templates this is configuration, not attribution
     * evidence — a disconnected client's preferred send time is worth nothing. */
    tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
```
(`tenant_fees` uses `.notNull().references(...)` without `.primaryKey()` — many rows per tenant.)

**Closed vocabulary + no-default required column** (tenant-attestations.ts:66-84):
```typescript
export const TENANT_ATTESTATION_KINDS = ['sm8_automation_off'] as const;
export type TenantAttestationKind = (typeof TENANT_ATTESTATION_KINDS)[number];
// ...
    /** One of TENANT_ATTESTATION_KINDS. CHECK-constrained in migration 0032. */
    kind: text('kind').notNull(),
```
Phase 7: `TENANT_FEE_KINDS = ['monthly', 'setup'] as const`; `amountCents: bigint(...)` or `numeric(12,2)` string (pick one and keep it — RESEARCH A8), `effectiveFrom: date('effective_from').notNull()` (no default — the "no default contact window" rule), `note: text('note')` nullable.

**Latest-wins index** (tenant-attestations.ts:104-108):
```typescript
index('tenant_attestations_latest_idx').on(table.tenantId, table.kind, sql`${table.attestedAt} DESC`),
```
→ `index('tenant_fees_in_force_idx').on(table.tenantId, table.kind, sql`${table.effectiveFrom} DESC`)`.

---

### `src/db/migrations/0033_phase7_reporting.sql` — one migration, hand-finished

**Analog:** `src/db/migrations/0032_phase6_console.sql` (full file, 171 lines)

**Header — consolidation rationale** (0032:1-20): copy the "ONE journal entry ... NO OTHER PLAN IN THIS PHASE TOUCHES THE JOURNAL" box. Generated with drizzle-kit, tag renamed, journal `idx: 33` hand-stamped (journal currently ends at idx 32 `0032_phase6_console`).

**CHECK block shape** (0032:60-98) — drop-if-present then add, idempotent:
```sql
ALTER TABLE public.tenant_attestations DROP CONSTRAINT IF EXISTS tenant_attestations_kind_known;
--> statement-breakpoint
ALTER TABLE public.tenant_attestations
  ADD CONSTRAINT tenant_attestations_kind_known
  CHECK (kind IN ('sm8_automation_off'));
--> statement-breakpoint
```
Phase 7 needs three: `quote_attributions_value_source_known` (`'mirror','missing'`), `quote_attributions_baseline_source_known` (`'connect','default'`), `tenant_fees_kind_known` (`'monthly','setup'`).

**REVOKE-then-GRANT block per table** (0032:124-171):
```sql
REVOKE ALL ON public.escalations FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.escalations FROM authenticated;
--> statement-breakpoint
-- escalations: EVIDENCE, and read-only to `authenticated` ... (the per-table argument)
GRANT SELECT ON public.escalations TO anon;
--> statement-breakpoint
GRANT SELECT ON public.escalations TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.escalations TO service_role;
--> statement-breakpoint
```
Three blocks, each with its own one-paragraph argument for why INSERT/UPDATE/DELETE are withheld (attribution: fabricates billed revenue; reports: rewrites a document a client was sent; fees: rewrites the denominator of a multiple already reported). Then extend `tests/rls-coverage.test.ts:116-131` table list + expected map with six `table/role: 'SELECT'` entries.

---

### `src/db/repository/for-tenant.ts` MOD — claim + keyed reads

**Analog:** itself. `ledger.insertClaim` interface doc (:1280-1291) + `listForCadence` (:1308); `events.since` (:2881-2891) for the tenant-pinned SQL-where shape.

**Claim interface contract** (for-tenant.ts:1280-1291):
```typescript
    /** `INSERT … ON CONFLICT (cadence_id, touch_number) DO NOTHING RETURNING id`.
     * ZERO ROWS MEANS ANOTHER PROCESS ALREADY OWNS THIS TOUCH, and the caller
     * must refuse silently rather than send. That is the whole never-twice
     * guarantee, and it is why this returns an array the caller branches on
     * instead of a row it can assume. */
    insertClaim(row: SendLedgerClaim): Promise<Array<{ id: string }>>;
    /** Everything claimed for a cadence, oldest first. Phase 7's evidence. */
    listForCadence(cadenceId: string): Promise<SendLedgerRow[]>;
```
Phase 7 `attributions.claim(row)` uses TARGETLESS `.onConflictDoNothing().returning({ id })` (the `cadences.ts:95-101` argument — a named arbiter turns a conflict on another index into 23505 inside the run transaction).

**Tenant-pinned read with id ordering** (for-tenant.ts:2881-2891):
```typescript
      since: (afterId: number) =>
        db.select().from(quoteStatusEvents)
          .where(sql`${quoteStatusEvents.tenantId} = ${tenantId} AND ${quoteStatusEvents.id} > ${afterId}`)
          // `id`, never `detected_at`: a batch of events written in one
          // transaction shares a `now()` to the microsecond ...
          .orderBy(quoteStatusEvents.id),
```
Every new read (`ledger.listForQuote`, `inbound.listThreadedForQuote`, `escalations.listForQuote`, `attributions.listForPeriod`, `reports.list/byId`, `fees.list`) pins `tenantId` from the closure and uses an explicit select list (no `body`, `to_address`, `from_address`, `raw_payload`).

**Versioned insert** — `reports.insertVersion` in one statement: `INSERT ... (version) SELECT COALESCE(MAX(version),0)+1 FROM monthly_reports WHERE tenant_id = $1 AND period_start = $2`, inside `forTenant(id).transaction` (:2930-2933 — nested transactions become savepoints); the unique index arbitrates and the action maps 23505 (the `touch-drafts.ts:31-39` precedent).

---

### `src/db/repository/for-all-tenants.ts` MOD — `forAllTenants_reportMetrics`

**Analog:** `forAllTenants_stalledTally` (for-all-tenants.ts:1006-1032) for the grouped-counts shape; but follow the QUEUE rule (no `tenants` join — names come from the page's JWT) rather than the digest rule.

**Grouped counts in SQL, bounded by tenants** (for-all-tenants.ts:1006-1032):
```typescript
export async function forAllTenants_stalledTally(boundary: Date): Promise<StalledTenantTally[]> {
  const rows = await getDb()
    .select({
      tenantId: cadenceTouches.tenantId,
      tenantName: tenants.name,               // ← OMIT for reportMetrics (page-feeding accessor)
      count: sql<number>`count(*)::int`,
    })
    .from(cadenceTouches)
    .innerJoin(tenants, eq(tenants.id, cadenceTouches.tenantId))   // ← OMIT
    .where(and(inArray(cadenceTouches.status, [...APPROVAL_QUEUE_STATUSES]), lte(cadenceTouches.scheduledAt, boundary)))
    .groupBy(cadenceTouches.tenantId, tenants.name)
    .orderBy(tenants.name);   // Deterministic, so two renders of one morning's digest read the same.
  return rows;
}
```
Return `{ tenantId, cadencesOpened, cadencesFirstTouch24h, cadencesTouched, cadencesReplied, contactsTouched, contactsOptedOut, draftsApproved, draftsEdited, editDistanceSum, conservativeCents, feesCents }` — counts and sums only. Place it AFTER `forAllTenants_hotUnescalated` (end of file) so the bounded `ownersBody` slice in the tripwire (tests/sync-upsert.test.ts:661-668) does not move.

**Header paragraph** — add a "WHY THE REPORTS OVERVIEW NEEDS ONE (07-xx, RPT-03)" paragraph to the file header (:1-70) in the same voice as "WHY THE APPROVAL QUEUE NEEDS ONE".

**Barrel line** (src/db/repository/index.ts:38-83) — one annotated re-export:
```typescript
  // 06-04, ONB-04/D-15: whose ServiceM8-automation attestation is getting old.
  // READ-ONLY and it writes nothing ... Returns an id, a name and an instant.
  forAllTenants_latestAttestations,
```

**Tripwire updates** (tests/sync-upsert.test.ts:498 twelve-exports block, :673 thirteen-tables block): add `'forAllTenants_reportMetrics'` with a decision-record comment in the established form; add `quoteAttributions` and `tenantFees` to the import set and rename the `it` titles (13 exports / 15 tables).

---

### `src/core/audit/constants.ts` MOD — the five new constants

**Analog:** itself (full file, 51 lines).

**Doc-comment shape: figure + footnote from one value, flagged assumption named** (constants.ts:1-27):
```typescript
/**
 * The three numbers the Quote Leakage Audit is built on.
 *
 * They live in their own module — with no imports — because both the FIGURE and
 * the FOOTNOTE that explains it must render from the same value. ...
 */

/**
 * The share of never-followed-up quote value assumed recoverable (D-09).
 * ... **0.15 is the conservative end, chosen deliberately.** ...
 * PLANNER'S FLAGGED ASSUMPTION, surfaced rather than buried: if the operator
 * prefers another value in the band, this line is the only change required —
 * the figure, the footnote and the stored `recoverable_estimate` all derive
 * from it.
 */
export const AUDIT_RECOVERY_RATE = 0.15;
```
Add `ATTRIBUTION_WINDOW_DAYS = 30`, `DEFAULT_BASELINE_WIN_RATE = 0.70` (HIGH on purpose — shrinks credit), `BASELINE_MIN_QUOTES = 10`, `OPT_OUT_ALARM_RATE = 0.05`, `FIRST_TOUCH_HOURS = 24`, each with the same "one line to change; footnote derives" paragraph. Keep the file import-free. Extend `tests/audit-aggregate.test.ts:53-62` (exact sorted export list) in the same task and add a `not.toContain('import')` source assertion.

**Consumer name** — `src/core/cadence/constants.ts` already hosts `CADENCE_CONSUMER`; add `ATTRIBUTION_CONSUMER = 'attribution'` beside it so both cursor names are in one file.

---

### `src/core/attribution/{qualify,baseline,money}.ts` + `src/core/reporting/{period,fees,metrics,figures}.ts` — pure modules

**Analog:** `src/core/audit/aggregate.ts` (:55-69 `Baseline` null-vs-0 doc, :88-98 basis points, :102-112 elapsed-ms window, :207-214 floor toward the client, :229-251 `computeBaseline`).

**Basis points: the ONE float→int step** (aggregate.ts:88-98):
```typescript
/** `cents * 0.15` is a float multiplication on money, which this module does not
 * do. `cents * 1500 / 10_000` is integer arithmetic until the single final
 * division, which is then floored — so there is exactly one rounding step and
 * it is visible. `Math.round` on the conversion is load-bearing:
 * `0.15 * 10_000` is `1500.0000000000002` in binary floating point. */
const RECOVERY_RATE_BASIS_POINTS = Math.round(AUDIT_RECOVERY_RATE * 10_000);
```

**Floor in the client's favour** (aggregate.ts:207-214):
```typescript
    // FLOORED, never rounded. The half-cent always falls in the prospect's
    // favour: D-09 forbids overstating this figure in either direction ...
    recoverableEstimateCents: Math.floor((neverFollowedUpValueCents * RECOVERY_RATE_BASIS_POINTS) / 10_000),
```
→ `conservativeCents(gross, rateBp) = Math.floor((gross * (10_000 - rateBp)) / 10_000)`.

**Elapsed-ms window, not calendar days** (aggregate.ts:102-112):
```typescript
const DAY_MS = 86_400_000;
export function auditWindow(now: Date = new Date(), days: number = WINDOW_DAYS): AuditWindow {
  return { start: new Date(now.getTime() - days * DAY_MS), end: new Date(now.getTime()) };
}
```
→ `rollingWindow(now, 30)` for D-15 and the D-01 floor `detectedAt − ATTRIBUTION_WINDOW_DAYS·DAY_MS`. NOTE (RESEARCH Pitfall 1): the ledger's "sent moment" is `claimed_at` of a row with `outcome = 'sent'`; there is no `sent_at` column.

**null, never 0, for an empty denominator** (aggregate.ts:236-251):
```typescript
  // See `Baseline.winRate` — the one branch in this file that must never be
  // simplified into `quotesWon / Math.max(quotesIssued, 1)`.
  if (quotesIssued === 0) return { winRate: null, quotesIssued: 0, quotesWon: 0 };
```
Every `metrics.ts` function returns `{ numerator, denominator, rate: number | null }` with `rate = null` when `denominator === 0`; `resolveBaseline` treats `winRate === null || quotesIssued < BASELINE_MIN_QUOTES` as `source: 'default'`. `numeric` arrives as a STRING through postgres.js (`Baseline.winRate: string | null`, :55-69) — convert once with `Math.round(Number(winRate) * 10_000)`.

**Money parsing** (src/core/servicem8/normalize.ts:136-158, 166-176): `parseMoneyToCents(raw: string | null | undefined): number | null` (regex, integer parse, no float) and `centsToNumeric(cents): string | null` ("A STRING, not a number: handing drizzle a JS number for a numeric column reintroduces the float round-trip"). Use these for `total_invoice_amount` → `gross_cents` and for fee amounts.

**Calendar month in the tenant's zone** — `src/core/cadence/window.ts:56-57` is the import idiom (`import { TZDate } from '@date-fns/tz'; import { addDays } from 'date-fns';`); the repo uses `@date-fns/tz` 1.5.0, NOT `date-fns-tz`. `period.ts`: `new TZDate(year, month - 1, 1, timeZone)` + `addMonths` (RESEARCH Code Examples). Half-open `[start, end)` on `getTime()`.

**One predicate, two surfaces** — `isOptOutAlarming(rate)` must be imported by both the overview badge and `buildOptOutSection`, exactly as `isAttestationStale` is by the checklist card and the digest (stalled-digest.ts:58-59, tests/stall-tick.test.ts:511 "neither surface writes a second threshold literal").

---

### `src/core/reporting/opt-out-section.ts` + `stalled-digest.ts` MOD — the D-16 digest line

**Analog:** `src/core/aging/stalled-digest.ts` `buildStaleAttestationSection` (:58-79) and the `sections` composition (:130-138); `DigestSection` type (src/core/alerts/stalled-drafts.ts:74-77).

**Section builder — closed vocabulary, NULL not empty** (stalled-digest.ts:58-79):
```typescript
export function buildStaleAttestationSection(
  latest: readonly { tenantName: string; attestedAt: Date }[],
  now: Date,
): DigestSection | null {
  const lines = latest
    .filter((row) => isAttestationStale(row.attestedAt, now))
    .map((row) => `${row.tenantName}: ServiceM8 auto-follow-up attestation is ` +
                  `${attestationAgeDays(row.attestedAt, now)} days old — re-verify and record it.`);
  // NULL, not an empty section. A heading with nothing under it is a daily
  // "no drift" all-clear, which is the trained blindness this digest's own
  // empty-send rule exists to avoid.
  if (lines.length === 0) return null;
  return { heading: 'ServiceM8 automation checks due:', lines };
}
```
→ `buildOptOutSection(rows: readonly { tenantName; numerator; denominator; rate }[], now)` → `{ heading: 'Opt-out rate above 5%:', lines: ['<name>: 7.1% (3 of 42 contacts) in the last 30 days.'] }` with the `5` interpolated from `OPT_OUT_ALARM_RATE`. Names for the digest come from a service-role join (the digest is a cron route rendering nothing — the `forAllTenants_latestAttestations` argument at for-all-tenants.ts:1060-1075), so either widen the tally accessor for the digest path or let the digest resolve names via `forAllTenants_latestAttestations`-style ids→names read; the planner should choose one and keep `forAllTenants_reportMetrics` name-free for the page.

**Composition seam** (stalled-digest.ts:130-138):
```typescript
  const [perTenantCounts, sections] = await Promise.all([
    forAllTenants_stalledTally(stallBoundary(now)),
    options.sections
      ? Promise.resolve(options.sections)
      : forAllTenants_latestAttestations(SM8_AUTOMATION_ATTESTATION_KIND).then((latest) => {
          const section = buildStaleAttestationSection(latest, now);
          return section ? [section] : [];
        }),
  ]);
```
Append the opt-out section to the same default array; the empty-not-sent rule (:141-160) keys on `touchesStalled === 0 && sectionLines === 0` and needs no change.

---

### `src/app/(console)/reports/page.tsx` — cross-tenant overview (RPT-03)

**Analog:** `src/app/(console)/inbox/page.tsx` (full file) for the gate/read/names skeleton; `src/app/(console)/page.tsx:146-172` for the `<table>` shape.

**Gate + force-dynamic** (inbox/page.tsx:13-16, 152-163):
```typescript
export const metadata: Metadata = { title: 'Inbox' };
/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const access = await requireOperator();
  if (access !== 'ok') {
    return (
      <section>
        <h1>Inbox</h1>
        <p className="error" role="alert">{OPERATOR_DENIED_MESSAGE[access]}</p>
      </section>
    );
  }
```

**Read-failure: catch and DISCARD** (inbox/page.tsx:165-181):
```typescript
  let rows: InboundTriageRow[];
  try {
    rows = await listInboundNeedingTriage();
  } catch {
    // The caught value is DELIBERATELY DISCARDED rather than logged or shown
    // (WR-08, T-2-02): a postgres error from this query can carry the predicate,
    // and the predicate names customer columns.
    console.error('[inbox] triage queue read failed');
    return (<section><h1>Inbox</h1><p className="error" role="alert">Could not load the inbox. Try again in a moment.</p></section>);
  }
```

**Names through the operator's OWN JWT** (inbox/page.tsx:183-191, 144-151):
```typescript
  const supabase = await createClient();
  const { data: tenantRows } = await supabase.from('tenants').select('id, name');
  const names: TenantNames = new Map(
    ((tenantRows as { id: string; name: string }[] | null) ?? []).map((row) => [row.id, row.name]),
  );
function nameOf(names: TenantNames, id: string): string {
  return names.get(id) ?? 'Another client';
}
```

**Label maps, never `.replace('_',' ')`** (inbox/page.tsx:62-82):
```typescript
const ATTRIBUTION_LABELS: Record<string, string> = { threaded: 'Threaded', ambiguous: 'Ambiguous', ... };
const ATTRIBUTION_BADGE_CLASS: Record<string, string> = { threaded: 'badge badge--ok', ... };
```

**Empty state + table** (page.tsx:149-172):
```tsx
      {tenants.length === 0 ? (
        <p className="muted">No clients yet. <Link href="/clients/new">Create the first one</Link>.</p>
      ) : (
        <table>
          <thead><tr><th>Name</th>...</tr></thead>
          <tbody>{tenants.map((tenant) => { ... })}</tbody>
        </table>
      )}
```
Wrap in `.table-scroll` (globals.css:249) per UI-SPEC Screen 1; sort alarmed rows first then by name (U-6); compute every rate via the pure `metrics.ts` functions over `forAllTenants_reportMetrics` rows.

---

### `src/app/(console)/reports/[client]/page.tsx` — per-client detail

**Analog:** `src/app/(console)/clients/[id]/page.tsx` (1066 lines — targeted reads: :520-600 capped RLS reads, :909 link line, :946-952 zone-note) + `audits/[id]/page.tsx:17,130-134` (uuid → 404 before any query).

**Capped, ordered, tenant-filtered RLS reads via `createClient()`** (clients/[id]/page.tsx:545-575):
```typescript
  const [connectionResult, quotesResult, runsResult, needsReviewResult] = await Promise.all([
    supabase.from('sm8_connections').select('key_last4, last_success_at, paused_at, status_reason, consecutive_failures').eq('tenant_id', tenant.id).maybeSingle(),
    quotesQuery
      .order('quote_date_utc', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(QUOTE_LIMIT),
    supabase.from('sync_runs').select('id, started_at, outcome, jobs_fetched, jobs_upserted').eq('tenant_id', tenant.id).order('started_at', { ascending: false }).limit(RECENT_RUNS),
  ]);
```
Select lists are explicit ("a column that nothing renders is a column that is not selected", :522-534). `numeric` via PostgREST is a JSON number — type as `number | string | null`, format only.

**Zone named once beside the heading** (clients/[id]/page.tsx:946-948):
```tsx
        <h2>Quotes <span className="muted zone-note">times in {tenant.timezone}</span></h2>
```

**`formatInTenantZone`** (src/core/shared/tenant.ts:312-329) — every on-screen instant:
```typescript
export function formatInTenantZone(value, timeZone, options = { dateStyle: 'medium', timeStyle: 'short' }): string {
  if (!value) return NO_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NO_VALUE;
  try { return new Intl.DateTimeFormat('en-AU', { ...options, timeZone }).format(date); }
  catch { return `${new Intl.DateTimeFormat('en-AU', { ...options, timeZone: 'UTC' }).format(date)} UTC`; }
}
```

**`.profile` dl grid** (globals.css:408-422) is the base for the new `dl.metrics` (add `.metrics dd { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem }` and `.num { text-align: right; font-variant-numeric: tabular-nums }` in globals.css, token-only).

**The one-line link from the pipeline page** (clients/[id]/page.tsx:908-910) — add `Reports & metrics →` directly after it:
```tsx
      <p className="meta">
        <Link href={`/clients/${tenant.id}/drafting`}>Voice &amp; templates →</Link>
      </p>
```

---

### `src/app/(console)/reports/[client]/actions.ts` + `action-state.ts` — authorized server actions

**Analog:** `src/app/(console)/clients/[id]/actions.ts` (`authorize` :137-163; `attestSm8AutomationOffAction` :468-510) + `action-state.ts` (:1-24)

**`authorize(tenantId)` — uuid shape, session, RLS membership read** (actions.ts:137-163):
```typescript
async function authorize(tenantId: string): Promise<ConnectState | null> {
  if (!UUID_PATTERN.test(tenantId)) return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { ...BLANK_CONNECT_STATE, formError: 'Your session has expired. Sign in again.' };
  const { data: tenant, error: tenantError } = await supabase.from('tenants').select('id').eq('id', tenantId).maybeSingle();
  if (tenantError || !tenant) return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  return null;
}
```

**Action body: authorize → zod → core call in try/catch → revalidate → one sentence** (actions.ts:468-510):
```typescript
export async function attestSm8AutomationOffAction(tenantId: string, _previous: AttestState, formData: FormData): Promise<AttestState> {
  const denied = await authorize(tenantId);
  if (denied) return { ...BLANK_ATTEST_STATE, error: denied.formError ?? 'Unknown client.' };

  const raw = formData.get('note');
  const parsed = attestSchema.safeParse({ note: typeof raw === 'string' ? raw : '' });
  if (!parsed.success) return { ...BLANK_ATTEST_STATE, error: parsed.error.issues[0]?.message ?? ATTEST_NOTE_REQUIRED_MESSAGE };

  let result: Awaited<ReturnType<typeof attestSm8AutomationOff>>;
  try {
    result = await attestSm8AutomationOff(tenantId, parsed.data.note, new Date());
  } catch {
    // The caught value is DISCARDED: the statement's parameters include the
    // operator's own evidence note about this client.
    console.error('[clients] attestation write failed');
    return { ...BLANK_ATTEST_STATE, error: ATTEST_WRITE_FAILED_MESSAGE };
  }
  revalidatePath(`/clients/${tenantId}`);
  return { ...BLANK_ATTEST_STATE, success: attestRecordedMessage({...}) };
}
```
`generateReportAction` maps the five UI-SPEC refusals (no fee in force, future month, pre-connection month, 23505 concurrent generate, other) from a discriminated `generateMonthlyReport` result; `appendFeeAction` validates `kind` enum / `amount` money string / `effective_from` date with zod v4.

**State constants live outside the `'use server'` module** (action-state.ts:1-24):
```typescript
/** These live OUTSIDE actions.ts because a `'use server'` module may export only
 * async functions — a const export is a module-evaluation error under Turbopack */
export type ConnectState = { error: string | null; formError: string | null; success: string | null };
export const BLANK_CONNECT_STATE: ConnectState = { error: null, formError: null, success: null };
```

**Authorization test shape:** `tests/inbox-authorization.test.ts:1-50` — mock `@/db/repository` + `next/cache`, do NOT mock the gate, assert the repository mock's call count is 0 on denied paths.

---

### `src/app/(console)/reports/[client]/{generate-form,fee-schedule-form}.tsx` — client forms

**Analog:** `src/app/(console)/clients/[id]/escalation-phone-form.tsx` (full file)

**`useActionState` + `.disclosure` + pending labels + plain-prop rule** (escalation-phone-form.tsx:1-6, 38-94):
```tsx
'use client';
import { useActionState } from 'react';
import { updateEscalationPhoneAction } from './actions';
import { BLANK_ESCALATION_PHONE_STATE, ESCALATION_PHONE_MAX } from './action-state';

export function EscalationPhoneForm({ tenantId, current }: { tenantId: string; current: string | null }) {
  const [state, formAction, pending] = useActionState(
    updateEscalationPhoneAction.bind(null, tenantId), BLANK_ESCALATION_PHONE_STATE);
  return (
    <details className="disclosure">
      <summary>{current ? 'Change the escalation number' : 'Set an escalation number'}</summary>
      <form action={formAction}>
        {state.error ? <p className="error" role="alert">{state.error}</p> : null}
        {state.success ? <p className="muted" role="status">{state.success}</p> : null}
        <label htmlFor="escalation-phone">Escalation phone</label>
        <input id="escalation-phone" name="escalation_phone" type="text" inputMode="tel" defaultValue={current ?? ''} disabled={pending} />
        <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save number'}</button>
      </form>
    </details>
  );
}
```
"PLAIN PROPS, NO DATABASE MODULE": client components import only `./actions` and `./action-state` (pinned by `tests/lint-ban.test.ts`). The fee editor sits inside `<details className="disclosure">` (U-1); the Generate form uses two `<select>`s defaulting to the previous month in the client's zone (U-5), computed on the server page and passed as props.

---

### `src/app/(console)/reports/[client]/[reportId]/page.tsx` + `report.css` — the printed A4 report (RPT-02)

**Analog:** `src/app/(console)/audits/[id]/page.tsx` (full file, 322 lines) + `audit.css` (full file, 169 lines)

**Imports + page-level CSS import + uuid guard** (audits/[id]/page.tsx:1-17):
```typescript
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AUDIT_RECOVERY_RATE, GRACE_PERIOD_DAYS, WINDOW_DAYS } from '@/core/audit/constants';
import { NO_VALUE } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';
import './audit.css';
import { ConvertForm, type ConvertTarget } from './convert-form';
export const dynamic = 'force-dynamic';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```
The report page imports the constants module for ONE purpose — the screen-only mismatch banner comparing `row.constants.attributionWindowDays` to `ATTRIBUTION_WINDOW_DAYS` (UI-SPEC render-from-the-row mandate). It imports NO aggregation function (a source assertion in `tests/monthly-report.test.ts` should pin this).

**Money/date formatters** (audits/[id]/page.tsx:67-97) — the report uses cents (`minimumFractionDigits: 2, maximumFractionDigits: 2`) because the audit's whole-dollar rule is explicitly for ESTIMATES (:53-66):
```typescript
function formatMoney(value: number | string | null): string {
  if (value === null) return NO_VALUE;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NO_VALUE;
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(amount);
}
function formatDate(value: string | null): string {   // `d MMM yyyy`, no time component
  if (!value) return NO_VALUE;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(at.getTime())) return NO_VALUE;
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(at);
}
```

**Read failure vs not found** (audits/[id]/page.tsx:147-176):
```typescript
  if (error) {
    // A genuine failure is not a 404 ... THE MESSAGE ITSELF NEVER REACHES THE PAGE (WR-08)
    console.error(`[audits] prospect read failed: ${error.code ?? 'unknown'}`);
    return (<section><h1>Quote Leakage Audit</h1><p className="error" role="alert">Could not load this audit. Try again in a moment.</p>...</section>);
  }
  const prospect = data as ProspectRow | null;
  if (!prospect) notFound();
```

**Figure and footnote from one value — no percentage literal in the file** (audits/[id]/page.tsx:204-214, 264-276):
```typescript
  const ratePercent = Math.round(AUDIT_RECOVERY_RATE * 100);
  // ...
          <p className="audit-method">
            How this was measured: quotes issued in the last {WINDOW_DAYS} days ...
            The recoverable estimate applies a conservative {ratePercent}% recovery rate ...
```
For the report every interpolated value comes from the ROW (`row.constants.*`, `row.baseline.*`), which is the same discipline one step further: the row froze the constant, the page prints the frozen one.

**Sheet DOM: backlink → h1 → subline → figures dl → method → footer → screen-only actions** (audits/[id]/page.tsx:216-320):
```tsx
    <section className="audit-sheet">
      <p className="muted audit-backlink"><Link href="/audits">← Audits</Link></p>
      <h1>Quote Leakage Audit — {prospect.business_name}</h1>
      <p className="muted audit-subline">Last {WINDOW_DAYS} days · prepared {formatDate(...)}</p>
      <dl className="audit-figures">
        <div className="audit-figure"><dt>Quotes issued</dt><dd>{prospect.quotes_issued ?? 0}</dd></div>
        {/* The hero, and the only accent-colored element on the sheet. */}
        <div className="audit-figure audit-figure--hero"><dt>Recoverable estimate</dt><dd>{formatMoney(...)}</dd></div>
      </dl>
      <p className="audit-method">...</p>
      <p className="audit-footer">{SERVICE_NAME} · prepared {formatDate(...)}</p>
      {/* Screen-only (D-02). `audit.css` hides every form under @media print. */}
      <section className="audit-actions">...</section>
    </section>
```
The report adds `dl.report-hero` (the multiple, the ONE accent element), six `.report-figure` cells, `table.report-lines` with `caption/thead/tbody/tfoot`, `ol.report-notes`, and a `print-button.tsx` client component (`window.print()`), following `convert-form.tsx`'s "SCREEN ONLY — hidden under @media print" header.

**`audit.css` → `report.css`: clone the print block verbatim, extend the hidden list** (audit.css:101-169):
```css
@media print {
  /* FORCED LIGHT, UNCONDITIONALLY — the operator's phone is usually in dark mode */
  :root { --bg: #ffffff; --fg: #16181d; --muted: #3d424e; --line: #c9ced6; --accent: #1f6feb; }
  html, body { background: #ffffff; color: #16181d; }
  @page { size: A4; margin: 14mm; }
  /* Console chrome and every control: operator context, not the document. */
  .nav, .audit-actions, .audit-backlink, .audit-keyline, button, form { display: none !important; }
  main { padding: 0; max-width: none; }
  .audit-sheet { max-width: none; padding-top: 0; }
  /* The one place background/color forcing is asked for. */
  .audit-figure--hero dd { color: #1f6feb; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .audit-figures, .audit-figure, .audit-method, .audit-footer { break-inside: avoid; }
}
```
Screen rules to clone with renamed selectors (audit.css:20-99): `.audit-sheet { max-width: 42rem; margin: 0 auto; padding-top: 3rem }`, `.audit-figures { grid; repeat(auto-fit, minmax(12rem, 1fr)); gap: 1.5rem }`, `.audit-figure dt { 0.875rem; 600; var(--muted) }`, `.audit-figure dd { 2rem; 600; 1.2; nowrap }`, `.audit-method`, `.audit-footer`, `.audit-actions`. Per UI-SPEC: hero `dd` at 2rem, `.report-figure dd` at 1.5rem, `minmax(10rem, 1fr)`, `.report-lines thead { display: table-header-group }`, `.table-scroll { overflow: visible }` in print, `break-inside: avoid` on `.report-lines tr` and `.report-notes li`.

---

### `src/app/(console)/layout.tsx` MOD — nav link

**Analog:** itself (:117-134). Insert `<Link href="/reports">Reports</Link>` after `<Link href="/audits">Audits</Link>` and before `New client`; NO badge, no count read (U-8 — `pendingQueueCount` at :60-75 is the JWT-scoped nav read and must not gain a cross-tenant opt-out count).

---

### Remote test suites — park/rewind discipline

**Analog:** `tests/cadence-consume-events.test.ts` (:1-30 header, :62-101 `setCursor`/`parkCursorAtHead`, :182-215 `expectReplayIsANoOp`, :223-300 `beforeAll`/`afterAll`)

**Park the shared cursor at the head; rewind only behind your own events** (cadence-consume-events.test.ts:65-101):
```typescript
/** Move the cursor by hand — including BACKWARDS, which no production path can. */
async function setCursor(lastEventId: number): Promise<void> {
  const { error } = await admin.from('event_consumer_cursors')
    .upsert({ consumer: CADENCE_CONSUMER, last_event_id: lastEventId }, { onConflict: 'consumer' });
  if (error) throw new Error(`Setting the cadence cursor failed: ${error.message}`);
}
/** Park the shared cursor at the newest event, i.e. "caught up". */
async function parkCursorAtHead(): Promise<void> {
  const { data, error } = await admin.from('quote_status_events').select('id').order('id', { ascending: false }).limit(1);
  if (error) throw new Error(`Reading the outbox head failed: ${error.message}`);
  await setCursor((data?.[0]?.id as number | undefined) ?? 0);
}
```
For `tests/attribution-consume.test.ts`: same helpers with `ATTRIBUTION_CONSUMER`; `beforeAll` parks at head BEFORE any seeding (RESEARCH Pitfall 11 — a rewind to 0 would replay every real client's `won` history into production `quote_attributions`). Assert `readConsumerCursor(CADENCE_CONSUMER)` is untouched by the attribution pass.

**Replay-is-a-no-op proof via unchanged rows** (cadence-consume-events.test.ts:182-215):
```typescript
async function expectReplayIsANoOp(eventId: number, cadenceId: string, quoteIndex: number) {
  const [before] = await repo.cadences.getByQuoteId(quotes[quoteIndex].id);
  await setCursor(eventId - 1);
  const replay = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(replay.eventsConsumed).toBeGreaterThanOrEqual(1);   // consumed again — replay is legal
  expect(replay.cadencesCreated).toBe(0);                    // and changed nothing
  const [after] = await repo.cadences.getByQuoteId(quotes[quoteIndex].id);
  expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
}
```
→ for attribution: rewind behind the `won`, re-consume, assert `attributionsRecorded === 0` and the single row's `attributed_at`/`id` are unchanged.

**Seed helpers + ordered teardown** (tests/helpers/seed.ts:151-565 exports; `NO_CASCADE_TABLES` list then `teardownTenants` :708-722): add `seedLedgerRow`, `seedInbound`, `seedAttribution`, `seedFee`; add `'quote_attributions'` and `'monthly_reports'` to `NO_CASCADE_TABLES` (children-before-parents; `tenant_fees` cascades but list it anyway, per the header's "relying on a cascade ... is how leftovers reappear silently").

---

## Shared Patterns

### Two read paths (choose per page)
- **Cross-tenant page** (`/reports`): `requireOperator()` (src/app/(console)/_auth.ts:52-72) → service-role accessor returning ids + counts → names via `createClient().from('tenants').select('id, name')` under RLS (inbox/page.tsx:183-191).
- **Tenant-scoped page/action** (`/reports/[client]`, `[reportId]`, both actions): uuid-shape check → `authorize(tenantId)` RLS read with the operator's JWT (clients/[id]/actions.ts:137-163) → `forTenant(tenantId)` reads/writes. The report id alone never selects across tenants.

### Never-twice by unique index + `ON CONFLICT DO NOTHING RETURNING`
`escalations_inbound_message_uniq` (escalations.ts:161), `send_ledger` `insertClaim` (for-tenant.ts:1280-1291), targetless `onConflictDoNothing()` (cadences.ts:95-101 argument). Zero rows is an answer the caller branches on. Apply to `quote_attributions_one_per_quote (tenant_id, quote_id)` and `monthly_reports (tenant_id, period_start, version)`.

### Act and advance in ONE transaction; head-of-line holds the cursor
consume-events.ts:740-748, 860-870, 878-963. The attribution consumer is a clone with its own `'attribution'` cursor; it must never read or move `'cadence-engine'`.

### Integer-cents money, basis points, floor toward the client, `numeric` as string
aggregate.ts:88-98, 207-214; normalize.ts:136-176. One `Math.round(Number(x) * 10_000)` step, then integer math, then `Math.floor`. Format with `Intl.NumberFormat('en-AU', { currency: 'AUD' })` at the last moment.

### No-import constants module: figure and footnote from one value
src/core/audit/constants.ts:1-10; audits/[id]/page.tsx:204-214. `tests/audit-aggregate.test.ts:53-62` pins the export list — extend it in the same task.

### Counts-only tick body, enumerated field by field
run-tick.ts:943-991; route.ts:153-200; pinned by `tests/cadence-tick.test.ts:535` and `tests/cadence-tick-route.test.ts:316`.

### Closed-vocabulary digest sections; NULL not empty
stalled-digest.ts:58-79, 130-138; `DigestSection` (stalled-drafts.ts:74-77). One threshold predicate shared by badge and digest (tests/stall-tick.test.ts:511).

### Catch-and-discard error handling, fixed sentence to the page
inbox/page.tsx:165-181; audits/[id]/page.tsx:147-166; clients/[id]/actions.ts:488-498. Log a tag and (at most) `error.code`; never the message.

### Label + badge-class maps, fail loudly on an unknown member
inbox/page.tsx:62-82. Apply to `value_source`, `baseline_source`, fee `kind`, `suppressed_contacts.source`.

### Evidence-family schema + migration
escalations.ts header (:12-25); 0032 CHECK (:60-98) and REVOKE/GRANT (:124-171) blocks; `tests/rls-coverage.test.ts:116-131` grants map. ONE migration for the whole phase; journal hand-stamped idx 33.

### Cross-tenant surface is a pinned count
`tests/sync-upsert.test.ts:498` (12 exports) and `:673` (13 tables) — the task adding `forAllTenants_reportMetrics` edits both with a decision-record comment; place the accessor at end of file.

### Print discipline
audit.css:101-169 cloned verbatim into report.css; screen-only controls are client components hidden by selector (`convert-form.tsx` header); no interactive element inside the printed region.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/core/reporting/fees.ts` (`feesInForce` pro-rating by local day) | utility (pure) | transform | No existing per-day pro-rating over an effective-dated schedule; follow `aggregate.ts` integer-cents accumulation + `period.ts` `TZDate` day iteration, floor once at the end (RESEARCH Pattern 4) |
| `src/core/reporting/period.ts` (`calendarMonth` / `currentMonth`) | utility (pure) | transform | No existing calendar-month boundary code; `window.ts` proves the `TZDate` idiom and RESEARCH Code Examples give the exact `startOfMonth(now, { in: tz(zone) })` / `addMonths` shape. Do NOT install `date-fns-tz` |

## Metadata

**Analog search scope:** `src/core/{cadence,audit,aging,alerts,attribution,reporting,shared,servicem8}`, `src/db/{schema,repository,migrations}`, `src/app/(console)/{inbox,audits/[id],clients/[id],layout.tsx,page.tsx,_auth.ts}`, `src/app/api/internal/cadence-tick`, `src/app/globals.css`, `tests/{cadence-consume-events,sync-upsert,rls-coverage,audit-aggregate,cadence-tick,cadence-tick-route,inbox-authorization,stall-tick}.test.ts`, `tests/helpers/seed.ts`
**Files scanned:** 34 (targeted, non-overlapping reads; `for-tenant.ts` 2949 lines and `clients/[id]/page.tsx` 1066 lines read by section)
**Pattern extraction date:** 2026-09-02
