# Phase 6: Review Console & Escalation - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 21 new/modified files
**Analogs found:** 18 / 21 (3 files are extractions/evolutions of their own analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(console)/queue/page.tsx` (NEW) | page (server component, cross-tenant) | request-response | `src/app/(console)/inbox/page.tsx` | exact |
| `src/app/(console)/queue/queue-card.tsx` (NEW) | client component | request-response | `src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx` | exact |
| `src/app/(console)/queue/actions.ts` (NEW) | server actions | request-response | `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts` | exact |
| `src/core/approval/approve-draft.ts` (NEW, extracted) | service (framework-free core) | request-response | `.../quotes/[quoteId]/actions.ts` lines 351–510 (the code being extracted) | exact (source of extraction) |
| `src/core/escalation/escalate-hot-leads.ts` (NEW) | service (tick pass) | event-driven / batch | `src/core/cadence/dispatch.ts` (claim + per-item try/catch) + `src/core/classification/classify-inbound.ts` (tick-pass shape, counts-only result) | role-match |
| `src/core/escalation/message.ts` (NEW) | utility (pure builder) | transform | `src/core/alerts/operator-email.ts` `alertBody` (pure exported builder, closed vocabulary) | role-match |
| `src/core/alerts/stalled-drafts.ts` (NEW) | service (alert sender) | request-response | `src/core/alerts/operator-email.ts` | exact |
| `src/core/aging/stall-policy.ts` (NEW) | utility (pure policy) | transform | `src/core/sync/failure-policy.ts` | exact |
| `src/core/onboarding/checklist.ts` (NEW) | service | CRUD | `src/core/drafting/onboarding-gate.ts` | exact |
| `src/core/drafting/onboarding-gate.ts` (MOD) | service | CRUD | itself — `approveTemplateVersion` tail extracted into `resumeIfOnboardingComplete` | exact |
| `src/db/schema/escalations.ts` (NEW) | model (evidence table) | event-driven | `src/db/schema/send-ledger.ts` (unique claim) + `src/db/schema/inbound-messages.ts` (evidence-family header rules) | exact |
| `src/db/schema/tenant-attestations.ts` (NEW) | model (evidence, append-only) | CRUD | `src/db/schema/message-templates.ts` (attestation columns) — but append-only, not write-once | role-match |
| `src/db/schema/cadence-touches.ts` (MOD) | model | — | itself (`TOUCH_SKIP_REASONS`, `stall_alerted_at` mirrors `sm8_connections.alerted_at`) | exact |
| `src/db/migrations/0032+…` (NEW, one wave) | migration | — | `src/db/migrations/0017_cadence_grants_and_constraints.sql` (REVOKE-then-GRANT blocks, hand-stamped journal) | exact |
| `src/db/repository/for-tenant.ts` (MOD: `skipPendingWhere`) | repository (guarded write) | CRUD | `markPendingApproval` / `approveWhere` in same file (equality-guarded UPDATE) | exact |
| `src/db/repository/index.ts` (MOD: `forAllTenants_approvalQueue`) | repository (cross-tenant accessor) | request-response | existing `forAllTenants_*` family (index.ts:35-43), esp. `listInboundNeedingTriage` | exact |
| `src/app/(console)/clients/[id]/page.tsx` (MOD: pipeline view + checklist card) | page (tenant-scoped) | request-response | itself + `src/app/(console)/page.tsx` (`deriveHealth` badge pattern) | exact |
| `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx` (MOD: conversation thread) | page | request-response | itself + inbox body-rendering discipline | exact |
| `src/app/(console)/layout.tsx` (MOD: nav count badge) | layout | request-response | no existing nav counter — `.badge` CSS conventions only (05-08) | no-analog (new work) |
| `src/app/api/internal/…digest route` (NEW) + `scripts/apply-cron-schedules.mjs` (MOD) | route + config | batch | existing cadence-tick route + cron-apply script (four-separate-bearers rule) | exact |
| `scripts/sm8-spike.mjs` (MOD: D-13 probe) | script | request-response | itself | exact |

## Pattern Assignments

### `src/app/(console)/queue/page.tsx` — cross-tenant approval queue (CON-01)

**Analog:** `src/app/(console)/inbox/page.tsx` (full file is the template)

**Page skeleton — operator gate + force-dynamic** (inbox/page.tsx:12-15, 155-166):
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

**Read-failure handling — catch and DISCARD, never log the error** (inbox/page.tsx:168-185):
```typescript
  let rows: InboundTriageRow[];
  try {
    rows = await listInboundNeedingTriage();
  } catch {
    // The caught value is DELIBERATELY DISCARDED rather than logged or shown
    // (WR-08, T-2-02): a postgres error from this query can carry the predicate,
    // and the predicate names customer columns.
    console.error('[inbox] triage queue read failed');
    return ( /* error section */ );
  }
```

**Tenant names via the operator's OWN JWT, not the service-role read** (inbox/page.tsx:187-194):
```typescript
  // Names through the operator's OWN JWT, so RLS decides which clients they may
  // see — a narrower authority than the read above, and the reason the
  // repository accessor returns ids rather than joining `tenants` itself.
  const supabase = await createClient();
  const { data: tenantRows } = await supabase.from('tenants').select('id, name');
  const names: TenantNames = new Map(
    ((tenantRows as { id: string; name: string }[] | null) ?? []).map((row) => [row.id, row.name]),
  );
```

**Vocabulary label maps — "A map, not a `.replace('_',' ')`"** (inbox/page.tsx:69-81):
```typescript
const ATTRIBUTION_LABELS: Record<string, string> = {
  threaded: 'Threaded',
  ambiguous: 'Ambiguous',
  unmatched: 'Unmatched',
  dead_letter: 'Unreadable payload',
};
const ATTRIBUTION_BADGE_CLASS: Record<string, string> = {
  threaded: 'badge badge--ok',
  ambiguous: 'badge badge--warn',
  ...
};
```
Any new vocabulary (skip reason, cadence-state group, urgency tier) gets a map like this that fails loudly on a new member.

**Timezone rule** (inbox/page.tsx:126-141): operator-waiting-time surfaces use the operator's locale (`Intl.DateTimeFormat('en-AU')`); but queue cards show a SEND SLOT → tenant zone with the zone named, via `formatInTenantZone` (`src/core/shared/tenant.ts:281`), plus zone-free relative time-to-slot (Pitfall 11).

**Query shape (Pattern 1, RESEARCH):** new `forAllTenants_approvalQueue` accessor beside the family at `src/db/repository/index.ts:35-43` — pinned select list, no join to `tenants`, `ORDER BY scheduled_at ASC` in SQL before the LIMIT, LEFT JOIN latest draft attempt (a `needs_draft` touch legitimately has no draft row — 05-04).

---

### `src/app/(console)/queue/actions.ts` + `src/core/approval/approve-draft.ts` — the approval writes

**Analog:** `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts` (lines ~351–786). This is an EXTRACTION, not a copy: the draft-lookup + validation + two-statement write moves to `src/core/approval/approve-draft.ts`; both surfaces call it (CR-02 lesson: "a second correct copy would leave the exact structure that produced the bug").

**Input schemas — WR-01 discipline** (actions.ts:397-405):
```typescript
const draftIdsSchema = z.object({ draft_id: z.uuid(), touch_id: z.uuid() });

const editedBodySchema = z.object({
  edited_body: z
    .string()
    .trim()
    .min(1, DRAFT_BODY_REQUIRED_MESSAGE)
    .max(EDITED_BODY_MAX, DRAFT_BODY_TOO_LONG_MESSAGE),
});
```

**Latest-attempt lookup — the four subtleties the extraction must carry** (actions.ts:479-505):
```typescript
async function loadApprovableDraft(tenantId, touchId, draftId): Promise<DraftLookup> {
  const attempts = await forTenant(tenantId).drafts.latestForTouch(touchId);
  const latest = attempts[0];
  if (!latest) return denied(DRAFT_NOT_FOUND_MESSAGE);
  if (latest.id !== draftId) {
    return attempts.some((row) => row.id === draftId)
      ? denied(DRAFT_SUPERSEDED_MESSAGE)
      : denied(DRAFT_NOT_FOUND_MESSAGE);   // forged pair = same sentence (no existence oracle)
  }
  if (latest.status === 'approved') {
    // A SUCCESS, not an error — double-tap on a phone.
    return { ok: false, state: { ...BLANK_CONTROL_STATE, success: DRAFT_ALREADY_APPROVED_MESSAGE } };
  }
  if (latest.status === 'superseded') return denied(DRAFT_SUPERSEDED_MESSAGE);
  ...
}
```
The four load-bearing subtleties (documented at actions.ts:414-456):
1. Latest-attempt check — approving an older attempt sends superseded text.
2. Whitelist rebuilt at the draft's `mergeNow` (fallback `createdAt`), never `new Date()` — midnight-boundary "14 days vs 15" refusal.
3. `complianceSuffix` from the draft row, not re-derived — tenant rename must not fail `missing_suffix`.
4. `approveDraft` writes `edit_distance = 0` EXPLICITLY (AI-04 dataset).

Also: `approveDraft` and `editAndApproveDraft` stay SEPARATE exports (actions.ts:370-378) — never one export with an optional body.

**The repository write (unchanged — the sole path to `approved`)** (for-tenant.ts:2479-2495):
```typescript
approveWhere: async (touchIds: readonly string[]) => {
  if (touchIds.length === 0) return [];
  return db
    .update(cadenceTouches)
    .set({ status: 'approved', updatedAt: sql`now()` })
    .where(and(
      eq(cadenceTouches.tenantId, tenantId),
      inArray(cadenceTouches.id, [...touchIds]),
      // Same equality guard, same reason, one status later. This is the
      // ONLY statement in this file that writes `approved` (D-12).
      eq(cadenceTouches.status, 'pending_approval'),
    ))
    .returning();
},
```

---

### `src/db/repository/for-tenant.ts` — NEW `skipPendingWhere` (operator skip, D-02)

**Analog:** `markPendingApproval` in the same file — NOT `skipWhere`. `skipWhere` (for-tenant.ts:2513-2527) is guarded `notInArray(TERMINAL_TOUCH_STATUSES)`, which would let a stale queue card skip a touch a colleague just approved (Pitfall 3).

**The equality-guard pattern to copy** (for-tenant.ts:2460-2477):
```typescript
markPendingApproval: async (touchIds: readonly string[]) => {
  if (touchIds.length === 0) return [];
  return db
    .update(cadenceTouches)
    .set({ status: 'pending_approval', updatedAt: sql`now()` })
    .where(and(
      eq(cadenceTouches.tenantId, tenantId),
      inArray(cadenceTouches.id, [...touchIds]),
      // The guard is EQUALITY on the source status, not merely
      // "not terminal": a late draft must not drag an already-approved
      // touch backwards out of the queue a human already cleared.
      eq(cadenceTouches.status, 'needs_draft'),
    ))
    .returning();
},
```
New method: same shape, `.set({ status: 'skipped', skipReason: 'operator_skipped', … })`, guard `inArray(status, ['needs_draft','pending_approval'])`. Zero rows returned → re-read and report honestly (`resumeCadence` race pattern).

**Skip-reason vocabulary** (`src/db/schema/cadence-touches.ts:112-121`):
```typescript
export const TOUCH_SKIP_REASONS = [
  'min_gap', 'stale', 'suppressed', 'quote_closed',
  'cadence_stopped', 'cadence_expired', 'no_address',
] as const;
```
New member ships WITH (a) the const, (b) a hand-written CHECK migration (0017/0018/0020 pattern; drizzle-kit does not model CHECKs; journal hand-stamped), (c) console label maps.

---

### `src/core/escalation/escalate-hot-leads.ts` — tick pass 6 (CON-03)

**Analogs:** claim shape from `src/db/schema/send-ledger.ts`; per-item try/catch + counts-only result from `src/core/cadence/dispatch.ts` / `classify-inbound.ts` (`ClassifyCounts`, classify-inbound.ts:204-248). A SEPARATE pass — never inside `classifyInbound` (would widen the pinned three-function privilege boundary, tests/classification-privilege.test.ts).

**Claim-then-send core loop** (assembled in RESEARCH from verified precedents):
```typescript
const claimed = await db
  .insert(escalations)
  .values({ inboundMessageId: row.id, tenantId, cadenceId, quoteId, toAddress })
  .onConflictDoNothing() // UNIQUE(inbound_message_id) — the D-08 never-twice guarantee
  .returning();
if (claimed.length === 0) continue; // another tick already owns it

const result = await sendSms(
  { to: toAddress, from: smsIdentity.fromAddress, body, customString: claimed[0].id },
  creds,
);
// outcome NULL means "claimed, outcome unknown" — never default to 'failed' (03-01 rule)
await db.update(escalations)
  .set(result.ok
    ? { sentAt: now, providerMessageId: result.messageId, outcome: 'sent' }
    : { outcome: `refused_${result.reason}`.slice(0, 48) })
  .where(eq(escalations.id, claimed[0].id));
```

**Send input contract** (`src/core/messaging/clicksend-client.ts:64-73`):
```typescript
export interface SendSmsInput {
  /** NORMALIZED E.164 recipient. */
  to: string;
  /** The dedicated AU virtual number, from `messaging_config.from_address`. */
  from: string;
  /** The approved body, VERBATIM. Never truncated or transformed here. */
  body: string;
  /** The `send_ledger` row id — how 04-04's delivery receipt finds its row. */
  customString: string;
}
```
Creds: `CLICKSEND_USERNAME`/`CLICKSEND_API_KEY` from env, read-and-refuse-if-missing per `src/core/messaging/reconcile.ts:134-139`.

**Key rules:**
- `is_hot` is READ from `inbound_messages`, never re-computed (`isHotLead` at classify-inbound.ts:284-287 stays private to classification).
- `escalation_phone` lives on `tenants` (tenants.ts:40) and is stored compact-local — MUST pass through `normalizeAuMobile` (`src/core/cadence/primary-contact.ts:129-141`); null → recorded refusal `no_escalation_number`, not a throw (Pitfall 1).
- From-number resolves through the same enabled-`messaging_config`-row question dispatch asks; disabled deployment → refuse-and-record (Pitfall 2 — global sms row is currently disarmed).
- Tick route response: add escalation/aging counts as explicitly enumerated fields (T-3-24, Pitfall 13).
- Tests: injected sender seam (StubSender precedent), zero-HTTP-calls-when-unconfigured property (reconcile suite precedent).

---

### `src/db/schema/escalations.ts` — evidence table

**Analogs:** `send-ledger.ts` for the unique-claim + nullable-outcome shape; `inbound-messages.ts:31-36` for evidence-family rules (tenant_id + RLS, NO FK/cascade from tenants, read-only to `authenticated`, service-role writes).

**Unique index + RLS policy shape** (send-ledger.ts:203-217):
```typescript
(table) => [
  /** THE never-twice constraint (CAD-04). See the header. */
  uniqueIndex('send_ledger_cadence_touch_uniq').on(table.cadenceId, table.touchNumber),
  index('send_ledger_tenant_claimed_idx').on(table.tenantId, table.claimedAt),
  pgPolicy('send_ledger_member_access', {
    as: 'permissive',
    for: 'all',
    to: authenticatedRole,
    using: sql`has_tenant_access(tenant_id)`,
    withCheck: sql`has_tenant_access(tenant_id)`,
  }),
],
```
For escalations: `uniqueIndex(...).on(table.inboundMessageId)` IS the D-08 claim. Columns: denormalized `tenant_id`/`cadence_id`/`quote_id`, `to_address`, `sent_at`, `provider_message_id`, `outcome` NULLABLE ("claimed, outcome unknown" — never default `'failed'`, per send-ledger:150-151). Provider detail = CODE only, never prose (send-ledger:174-183).

---

### `src/core/alerts/stalled-drafts.ts` — sibling alert module (CON-04)

**Analog:** `src/core/alerts/operator-email.ts` (full file). SIBLING, not a widening of `OperatorAlertKind` — its `detail` is typed `SyncOutcome`.

**Three header rules to copy verbatim** (operator-email.ts:9-31):
1. NOTHING HERE THROWS — typed outcome (`{ ok: true } | { ok: false; kind: 'not_configured' | 'send_failed'; detail }`).
2. THE BODY IS ASSEMBLED FROM A CLOSED VOCABULARY (T-2-16) — tenant name, counts, formatted timestamp, constructed URL; pure `alertBody` exported so it's provable by assertion. Never a customer body or address (T-2-02).
3. FAILURE DETAIL IS THE ERROR'S `name`, NEVER ITS MESSAGE.

**Pure body builder shape** (operator-email.ts:137-150):
```typescript
export function alertBody(input: { tenantName; kind; detail; at: Date; url: string }): string {
  const facts = [
    `Client: ${tenantName}`,
    `Reason: ${SYNC_OUTCOME_LABELS[detail]}`,
    `Detected: ${formatAlertTimestamp(at)}`,
  ].join('\n');
  ...
}
```

**Typed send with name-only errors** (operator-email.ts:215-238):
```typescript
try {
  const { data, error } = await new Resend(apiKey).emails.send({ from, to, subject, text });
  if (error) return { ok: false, kind: 'send_failed', detail: error.name ?? 'unknown_error' };
  return { ok: true, id: data?.id ?? null };
} catch (e) {
  const name = e instanceof Error ? e.name : 'UnknownError';
  return { ok: false, kind: 'send_failed', detail: `send threw (${name})` };
}
```
Reuse `consoleBaseUrl()` / `clientDetailUrl()` / `formatAlertTimestamp()` (operator-email.ts:93-120) rather than re-deriving. `src/core` is framework-free — no `next/*` imports.

The escalation body builder (`src/core/escalation/message.ts`) follows the same pure-exported-builder discipline; content per D-07 (customer first name, quote snippet, reply text truncated to ~2 segments, tap-to-call mobile — mobile placed to survive truncation, A3). Sanitize control characters per drafting's `sanitizeUntrusted` precedent. Segment counting: locate and share whatever counter populates `touch_drafts.segments` — never ad-hoc length math.

---

### `src/core/aging/stall-policy.ts` — pure stall predicate (CON-04)

**Analog:** `src/core/sync/failure-policy.ts` — pure decision over a row snapshot, injectable clock, dedupe derived from `alertedAt === null`.

**The dedupe-in-the-decision pattern** (failure-policy.ts:53-82):
```typescript
export function applyFailurePolicy(input: FailurePolicyInput): FailurePolicyDecision {
  const { kind, consecutiveFailures, alertedAt } = input;
  if (kind === 'auth_failed') {
    // THE PAUSE IS UNCONDITIONAL; THE ALERT IS DEDUPED (D-05).
    // "Exactly one email per episode" ... a guarantee that holds because of what
    // the callers do today is one that breaks the first time a third caller is written.
    return {
      pauseReason: 'auth_failed',
      incrementFailures: true,
      alertKind: alertedAt === null ? 'auth' : null,
    };
  }
  ...
}
```

**Stalled-set claim in the tick pass** (guarded UPDATE RETURNING — the WHERE clause IS the idempotence, quote_opened rule):
```typescript
const newlyStalled = await db
  .update(cadenceTouches)
  .set({ stallAlertedAt: now, updatedAt: sql`now()` })
  .where(and(
    inArray(cadenceTouches.status, ['needs_draft', 'pending_approval']),
    lte(cadenceTouches.scheduledAt, addHours(now, STALL_THRESHOLD_HOURS)),
    isNull(cadenceTouches.stallAlertedAt),
  ))
  .returning({ id: cadenceTouches.id, tenantId: cadenceTouches.tenantId });
```
Predicate reads `cadence_touches` ONLY — never joined to drafts (Pitfall 4: the 05-04 no-draft-row failure must still age). `stall_alerted_at` column follows `sm8_connections.alerted_at` (sm8-connections.ts:21-23,82).

Daily digest: new protected route with its OWN bearer secret (four-bearers rule, 04-01), schedule added in `scripts/apply-cron-schedules.mjs` (never in migrations); activation proved via `net._http_response` 200, not `cron.job_run_details`.

---

### `src/core/onboarding/checklist.ts` + `onboarding-gate.ts` MOD — ONB-04 composed gate

**Analog:** `src/core/drafting/onboarding-gate.ts` (full file).

**The vacuous-truth guard to replicate for `hasSm8AutomationAttestation`** (onboarding-gate.ts:74-78):
```typescript
export async function hasApprovedTemplateSet(repo: TenantScopedRepository): Promise<boolean> {
  const touches = await repo.templates.approvedSetStatus();
  if (touches.length === 0) return false;   // written out ON PURPOSE — empty ≠ approved (T-5-13)
  return touches.every((touch) => touch.approved);
}
```
Empty attestation set = false, decided on purpose, comment saying so.

**The extraction — `resumeIfOnboardingComplete(tx)` comes from the tail of `approveTemplateVersion`** (onboarding-gate.ts:184-205):
```typescript
    // ASKED AFTER THE WRITE, IN THE SAME TRANSACTION.
    const setComplete = await hasApprovedTemplateSet(tx);
    if (!setComplete) return { kind: 'approved' as const, setComplete: false, resumedIds: [] };

    // REASON-SCOPED, exactly as `resumeClient` is.
    const resumed = await tx.cadences.resumeWherePaused(
      (await tx.cadences.listLive())
        .filter((cadence) => cadence.status === 'paused')
        .map((cadence) => cadence.id),
      ONBOARDING_PAUSE_REASON,
    );
```
Extracted function asks templatesApproved AND sm8AutomationAttested; both writers (`approveTemplateVersion`, new `attestSm8AutomationOff`) call it in-transaction after their write. Re-window stays OUTSIDE the transaction, scoped to the RETURNING ids (onboarding-gate.ts:130-152, 213-225) — the placement rule is load-bearing, copy the comment's reasoning.

**Creation gate too (Pitfall 6):** `consume-events.ts` asks `hasApprovedTemplateSet` to decide born-paused vs born-active — the creation-time question must become the composed predicate, or ONB-04 never engages.

**Attestation table:** `message-templates.ts:33-37` names `approved_at`/`approval_note` "ATTESTATION, NOT A STATUS FLAG" — same evidence discipline, but APPEND-ONLY rows (D-15 re-attestation), `note` REQUIRED not defaulted (T-5-12), `attested_at` server-set, `kind` CHECK-constrained.

**Gated-cadence affordance:** `resumeCadence` returns `{ kind: 'onboarding_gated' }` (controls.ts:702-708); the actions handler treats it as SUCCESS not error (actions.ts:334-342). With two conditions, the refusal must name the missing condition(s) and link there (`unapprovedTouchNumbers`-style per-condition readers, onboarding-gate.ts:81-86).

---

### `src/app/(console)/clients/[id]/page.tsx` MOD — pipeline view + checklist card (CON-02, D-16)

**Analog:** itself (sections at lines 528-707: ServiceM8 connection / Quotes + Needs review / Recent sync runs — all kept, quotes section grows) plus `src/app/(console)/page.tsx` `deriveHealth` (one input → derived display badge) for the checklist items and per-client pending-drafts indicator.

Reads: tenant-scoped → RLS path via operator JWT (two-read-paths rule). D-18 grouping rank as a pure exported function (assertable; `tests/pipeline-grouping.test.ts`). Timestamps via `formatInTenantZone` with the zone named. Checklist items: templates-approved via `approvedSetStatus()` through `forTenant()` — NEVER re-derived from `message_templates` (T-5-13 pinned assertion); messaging-armed via the per-tenant identity resolver, NOT `anyChannelEnabled` (04-08 CR-01).

### `src/app/(console)/layout.tsx` MOD — nav count badge

**No analog** — layout is a 55-line static-nav auth shell today. Constraint from Pattern 8: layout gates on `getClaims()` (any authenticated user), NOT `requireOperator()` — so the count MUST be an RLS-scoped count via the caller's own JWT (`createClient()`), never a service-role read in the layout. `.badge` CSS conventions from 05-08 (`display: inline-block`, `white-space: nowrap`, flex-gap container). Layouts re-render after actions, so the count self-refreshes.

## Shared Patterns

### Two read paths (choose per page)
**Sources:** `inbox/page.tsx:36-58` (service-role behind `requireOperator()`) vs `clients/[id]/page.tsx` (RLS via operator JWT)
**Apply to:** queue page = service-role path; pipeline/checklist/quote pages = RLS path; nav badge = RLS path (layout is not operator-gated).

### Equality-guarded status writes
**Source:** `for-tenant.ts:2460-2495` (`markPendingApproval`, `approveWhere`)
**Apply to:** new `skipPendingWhere`, escalation outcome update, stall-claim update. Guard on the exact source status(es); zero rows → re-read and report honestly.

### Unique-index claim rows (never-twice under overlapping ticks)
**Source:** `send-ledger.ts:205` + INSERT … ON CONFLICT DO NOTHING … RETURNING
**Apply to:** `escalations.inbound_message_id` unique claim; only the inserter sends.

### Closed-vocabulary alert bodies, nothing throws, name-only errors
**Source:** `operator-email.ts` rules 1–3 (lines 9-31)
**Apply to:** `stalled-drafts.ts`, digest builder, escalation message builder (content rules differ, discipline identical).

### `'use server'` action hardening (WR-01)
**Source:** `quotes/[quoteId]/actions.ts:397, 479-505` — zod `z.uuid()` schemas, membership/operator re-check with caller's JWT inside the action, ids re-verified against DB (draft↔touch pairing), absent vs other-tenant indistinguishable.
**Apply to:** all queue actions, `attestSm8AutomationOff`, skip action.

### Migrations: one wave, hand-written CHECK/GRANT blocks
**Source:** `src/db/migrations/0017_cadence_grants_and_constraints.sql` ("EVERY NEW TABLE NEEDS ITS OWN BLOCK", REVOKE-then-GRANT). Latest migration is `0031_draft_merge_inputs.sql` → this phase starts at 0032, consolidated into ONE plan/wave (Pitfall 5 — journal-ordering trap fired three times in Phase 2). Prove with a no-op `npm run db:migrate`.

### Vocabulary label + badge-class maps
**Source:** `inbox/page.tsx:69-123`
**Apply to:** skip-reason label, cadence-state groups, urgency tiers, checklist item states — a map that fails loudly, never string munging.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/app/(console)/layout.tsx` nav count badge | layout enhancement | request-response | No nav counter exists; only `.badge` CSS conventions (05-08). Constraint: RLS-scoped count via caller's JWT (Pattern 8, RESEARCH). Verify assumption A5 (operator is member of every tenant) or fall back to a small operator-gated server component. |
| D-13 detection sweep (conditional) | service | batch | No comms-reading ServiceM8 code exists; endpoints are private-preview. Probe-first via `scripts/sm8-spike.mjs` extension; nothing may depend on `sms.json`/`email.json` before a measured answer lands in `docs/servicem8-api-notes.md`. |
| Escalation-phone edit affordance | form/action | CRUD | Only the new-client form writes `escalation_phone` today; new edit form on the client page, validated via the same `AU_MOBILE_PATTERN` path (`src/core/shared/tenant.ts:128-133`). |

## Metadata

**Analog search scope:** `src/app/(console)/**`, `src/core/**`, `src/db/schema/**`, `src/db/repository/**`, `src/db/migrations/**`, `scripts/**`
**Files read this session:** inbox/page.tsx (full), operator-email.ts (full), onboarding-gate.ts (full), quotes/[quoteId]/actions.ts:330-510, for-tenant.ts:2455-2549, send-ledger.ts:150-221, failure-policy.ts:36-105 — remaining line-ranged excerpts carried from 06-RESEARCH.md's [VERIFIED] citations (read from source 2026-09-01)
**Pattern extraction date:** 2026-09-01
