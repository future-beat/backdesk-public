# Phase 12: Instant Text-back & Arming - Pattern Map

**Mapped:** 2026-10-05
**Files analyzed:** 46 new/modified (34 source/doc/script, 12 test files new or deliberately edited)
**Analogs found:** 45 / 46

Inputs: `12-CONTEXT.md` (D-01..D-14), `.planning/REQUIREMENTS.md` (TXT-01..06, COMP-03, COMP-01 callers section). There is no `12-RESEARCH.md` in the phase directory; `12-VALIDATION.md` is still the unfilled template. No `.claude/skills/` directory exists.

All paths are relative to the repo root `<repo>` (note the space). Line ranges were read on 2026-10-05 at commit `d8acd35`.

File names marked (proposed) are the mapper's inference from the decisions; the planner may rename them. Everything else is an existing file.

---

## File Classification

### Schema and migration

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/migrations/0039_phase12_text_back.sql` (proposed tag) + `meta/_journal.json` + `meta/0039_snapshot.json` | migration | batch DDL | `src/db/migrations/0038_phase11_telephony_capture.sql` | exact |
| `src/db/schema/leads.ts` (new) | model | CRUD (evidence family) | `src/db/schema/missed-calls.ts` + `src/db/schema/cadences.ts` contact snapshot | role-match |
| `src/db/schema/cadences.ts` (mod: `kind`, `lead_id`, nullable `quote_id`/`sm8_job_uuid`, CHECK, one-live-per-lead) | model | CRUD | itself, lines 277-414; decision prose in `0038` lines 41-62 | exact |
| `src/db/schema/send-ledger.ts` (mod: nullable `quote_id`) | model | CRUD | itself, lines 125-221 | exact |
| `src/db/schema/escalations.ts` (mod: nullable `quote_id` "as needed") | model | CRUD | itself, lines 116-189 | exact |
| `src/db/schema/text-back-templates.ts` (new, proposed) | model | CRUD (versioned config + write-once attestation) | `src/db/schema/message-templates.ts` lines 84-150 | exact |
| `src/db/schema/never-text-numbers.ts` (new, proposed) | model | CRUD | `src/db/schema/suppressed-contacts.ts` lines 74-128 | exact |
| `src/db/schema/missed-calls.ts` (mod: skip reason, text-back outcome, IN-04 CHECKs, IN-07 own-line mark) | model | event-driven | itself, lines 64-104 (vocabularies) and 186-216 (CHECKs) | exact |
| `src/db/schema/messaging-config.ts` + `messaging-config-audit.ts` (mod: channel vocabulary incl. `text_back`) | model/config | CRUD | themselves: `messaging-config.ts:83-84,169`; `messaging-config-audit.ts:121` | exact |
| `src/db/schema/tenant-proofs.ts` (mod: kind `text_back_proof`) | model | CRUD | itself lines 66-71, 127-130; widening mould `0038` lines 125, 128 | exact |
| `src/db/schema/index.ts` (mod: export new tables) | config | n/a | itself lines 31-35 | exact |

### Repository

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/repository/for-tenant.ts` (mod: namespaces `leads`, `textBackTemplates`, `neverText`; lead cadence create; `SendLedgerClaim`/`ClaimedTouch` typing) | service (repository) | CRUD | same file: `templates` 2324-2500, `suppression` 3463-3524, `attestations` 3526-3548, `proofs` 3550-3574, `ledger` 3342-3414, `cadences.create` 2680-2712 | exact |
| `src/db/repository/missed-calls.ts` (mod: text-back claim/outcome writers, sweep read) | service (repository) | event-driven | same file: `completeMissedCall` 96-118, `getMissedCallForTenant` 230-255; claim shape from `escalations.ts` 85-103 | exact |
| `src/db/repository/messaging-config.ts` (mod: `text_back` through `armChannel`/`disarmChannel`; system auto-disarm) | service (repository) | CRUD | same file 251-451 | exact |
| `src/db/repository/escalations.ts` (mod, only if the D-08 escalation is recorded here) | service (repository) | event-driven | same file 46-103 | exact |
| `src/db/repository/for-all-tenants.ts` (mod, only if a cross-tenant sweep or armed-clients read is added) | service (repository) | batch | `forAllTenants_hotUnescalated` 1286-, `forAllTenants_armedBySmsGlobal` 1836-, `forAllTenants_activeDivertNumbers` 1953- | role-match |
| `src/db/repository/index.ts` (mod: barrel) | config | n/a | itself 344-391 (the telephony block) | exact |

### Core

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/telephony/text-back.ts` (new: gate + send via the ledger) | service | event-driven, claim-then-send | `src/core/cadence/dispatch.ts` 295-608 (ledger order) + `src/core/escalation/escalate-hot-leads.ts` 185-336 (per-row refusals) + `src/core/telephony/missed-call.ts` 93-117, 293-322 (never-throws, deadline) | exact (composite) |
| `src/core/telephony/text-back-template.ts` (new, proposed: defaults + save-time validator) | utility | transform (pure) | `src/core/drafting/validate.ts` 105-109, 313-347; `src/core/escalation/message.ts` 72-104; `src/core/drafting/gsm7.ts` 99-160; `src/core/cadence/sender.ts` 109-112 | role-match |
| `src/core/telephony/missed-call.ts` (mod: `applyVoiceStatus` hands the completed call to text-back) | service | event-driven | itself 256-322 | exact |
| `src/app/api/webhooks/twilio/voice-status/route.ts` (mod: call text-back after completion) | route (webhook) | request-response | itself 106-164 | exact |
| `src/core/cadence/run-tick.ts` (mod: text-back sweep pass, balance pass, result counts) | service | batch | itself: `runEscalationPass` 894-904, `runAgingPass` 957-1000, wiring 1006-1145 | exact |
| `src/app/api/internal/cadence-tick/route.ts` (mod: new seams + enumerated response keys) | route (cron) | request-response | itself 95-200 | exact |
| `src/core/cadence/dispatch.ts` / `for-tenant.ts` `touches.*` (mod: keep lead touches 2-3 INERT) | service | batch | `claimDue` `for-tenant.ts:3142-3186`, `promoteDue` `for-tenant.ts:3019-3038`, `dispatchOne` `dispatch.ts:352-426` | exact |
| `src/core/messaging/clicksend-client.ts` (mod: account balance read) | utility (HTTP client) | request-response | same file `listPaged` ~401-474; field names from `scripts/clicksend-balance.mjs` 56-138 | exact |
| `src/core/alerts/*` (mod or new: balance alert + failed text-back surfacing) | service | event-driven | `src/core/alerts/stalled-drafts.ts` 166-204, 288-331; once-only claim shape `run-tick.ts` 957-1000 | role-match |
| `src/core/audit/constants.ts` (mod: three named limits) | config | n/a | itself 138-204 | exact |
| `src/core/onboarding/checklist.ts` (mod: keys, reads, `live.textBack`, arming state) | service | CRUD read | itself 150-164, 320-336, 360-409, 545-701 | exact |
| `src/core/onboarding/arming.ts` (mod: `ARMING_GATES.text_back`) | utility (pure) | transform | itself 59-105 | exact |

### Console, marketing, docs, scripts

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(console)/clients/[id]/actions.ts` (mod: arm/disarm `text_back`, proof kind, template save/attest, never-text add) | controller (server actions) | request-response | itself: `armChannelAction` 649-741, `disarmChannelAction` 756-809, `recordProofAction` 912-1158, `attestSm8AutomationOffAction` 543- | exact |
| `src/app/(console)/clients/[id]/action-state.ts` (mod: copy maps) | utility (client-safe leaf) | n/a | itself 163-345 (arm), 344-590 (proof) | exact |
| `src/app/(console)/clients/[id]/checklist-card.tsx` (mod: rows, live line, proof slot, text-back controls) | component | request-response | itself: `ITEM_LABELS` 59-77, `ITEM_FIX` 90-, `LIVE_LABEL` 215, `PROOF_KIND` 231, `ProofRow` 583, `ArmRow` 663, `EmailControls` 815, `DisarmForm` 928 | exact |
| `src/app/(console)/clients/[id]/text-back-template-form.tsx` (new, proposed) | component | request-response | `src/app/(console)/clients/[id]/drafting/forms.tsx` `TemplateVersionForm` 184-242, `AttestApprovalForm` 243-285 | exact |
| `src/app/(console)/clients/[id]/never-text-form.tsx` (new, proposed) | component | request-response | `src/app/(console)/clients/[id]/escalation-phone-form.tsx` (92 lines); `src/app/(console)/inbox/suppress-contact-form.tsx` | role-match |
| `src/app/(console)/clients/[id]/page.tsx` (mod: mount forms, pass props) | component (server page) | request-response | itself 734-775 (degrading reads), 908-925 (form mounts), 1025 (card section) | exact |
| `src/app/(marketing)/copy.ts` (mod: `PRIVACY_COPY` callers section) | config (copy) | n/a | itself 416-508 | exact |
| `docs/client-divert-onboarding-runbook.md` (new) | doc | n/a | `docs/first-client-go-live-runbook.md` (413 lines) + `docs/telephony-runbook.md` §7, §10, §12 | role-match |
| `docs/commercial-assumptions.md` (mod: three new sections) | doc | n/a | itself §7 lines 159-223 | exact |
| `scripts/text-back-timing.mjs` (new, proposed; S4 evidence) + `package.json` alias | utility (ops script) | file-I/O (read-only SQL) | `scripts/missed-calls-recent.mjs` (165 lines) | exact |

### Tests (new)

| New File (proposed names) | Role | Analog |
|---|---|---|
| `tests/text-back-gate.test.ts` (pure, ordered gate) | test | `tests/telephony-caller.test.ts`, `tests/go-live-checklist.test.ts` 640-690 (`firstUnmetGate` order) |
| `tests/text-back-template.test.ts` (pure validator) | test | `tests/drafting-validate.test.ts`, `tests/escalation-message.test.ts`, `tests/gsm7.test.ts` |
| `tests/text-back.test.ts` (DB-backed: claim, never-twice, sweep, outcomes) | test | `tests/cadence-dispatch.test.ts`, `tests/escalation.test.ts`, `tests/missed-calls.test.ts` |
| `tests/text-back-arming.test.ts` (DB-backed repository) | test | `tests/messaging-config-arming.test.ts` |
| `tests/client-divert-runbook-contract.test.ts` | test | `tests/runbook-contract.test.ts` |
| additions to `tests/twilio-voice-status-route.test.ts`, `tests/arming-actions.test.ts`, `tests/proof-actions.test.ts`, `tests/ops-scripts.test.ts`, `tests/privacy-page.test.ts` | test | themselves |

---

## Pattern Assignments

### `src/db/migrations/0039_*.sql` (migration, one journal entry)

**Analog:** `src/db/migrations/0038_phase11_telephony_capture.sql`

**Header mould** (lines 1-64): boxed "ONE ENTRY FOR THE PHASE" statement; "GENERATED by drizzle-kit from <schema files>, then renamed from its random tag and re-tagged in `meta/_journal.json`"; the `when` check against the previous entry. The last journal entry is idx 38, `when` 1790525643412 (`meta/_journal.json` tail). The new entry's `when` must be greater or drizzle's migrator silently skips it (0038 lines 16-21).

**The design already recorded for this migration** (0038 lines 41-62): add `cadences.kind` (CHECK), make `quote_id` nullable, add `lead_id` with a CHECK that exactly one of `quote_id`/`lead_id` is set per kind, add a one-live-per-lead partial unique index. CONTEXT D-05 additionally makes `sm8_job_uuid` nullable.

**CHECK widening is hand-finished** (lines 125, 128): drizzle emits a bare DROP; rewrite to
```sql
ALTER TABLE "tenant_proofs" DROP CONSTRAINT IF EXISTS "tenant_proofs_kind_known";--> statement-breakpoint
ALTER TABLE "tenant_proofs" ADD CONSTRAINT "tenant_proofs_kind_known" CHECK (kind IN (...));--> statement-breakpoint
```
The same shape applies to `messaging_config_channel_known` (created in `0026:78`), `messaging_config_audit_channel_known` (`0036:44`), and any `missed_calls_*` CHECK that changes.

**Grant block, one per NEW table** (lines 133-189): REVOKE ALL from `anon` and `authenticated`, then `GRANT SELECT` to both, `GRANT ALL` to `service_role`, each followed by `--> statement-breakpoint`, each with a comment saying why there is no INSERT/UPDATE/DELETE.
```sql
REVOKE ALL ON public.missed_calls FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.missed_calls FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON public.missed_calls TO anon;
--> statement-breakpoint
GRANT SELECT ON public.missed_calls TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.missed_calls TO service_role;
```

**Policy mould** (line 129, single-arm tenant table):
```sql
CREATE POLICY "tenant_divert_numbers_member_access" ON "tenant_divert_numbers" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_tenant_access(tenant_id)) WITH CHECK (has_tenant_access(tenant_id));
```

**Other conventions:** idempotent hand-written SQL (`IF NOT EXISTS`, `DROP ... IF EXISTS`), per `src/db/migrations/README.md` lines 28-35. Applied with `npm run db:migrate` over the session connection (README 1-9). Hosted Supabase is production: migration push before code push (CONTEXT "Constraints carried").

**Existing constraints this migration has to reconcile with** (read before writing the ALTERs): `0017_cadence_grants_and_constraints.sql` (cadence CHECKs; channel CHECKs at 245, 252, 259), `0019_cadence_touch_tenant_pairing.sql`, `0023_cadence_replay_key_required.sql` (`cadences_replay_key_present`: `created_by_event_id IS NOT NULL OR created_at < <0021 moment>` — a lead cadence has no `quote_opened` event, so this CHECK refuses it as written), `0024_cadence_one_live_per_job.sql`.

---

### `src/db/schema/cadences.ts` (model, modified)

**Analog:** itself.

**Columns to change** (lines 282-287): `quoteId: uuid('quote_id').notNull()` and `sm8JobUuid: uuid('sm8_job_uuid').notNull()` become nullable; add `kind` and `leadId` beside them. `createdByEventId` (line 315) is nullable in the type but required by CHECK 0023 and by the `CadenceCreate` type (`for-tenant.ts:208-229`).

**Partial unique index mould** (lines 353-355, 378-380) for one-live-per-lead:
```typescript
uniqueIndex('cadences_one_live_per_quote')
  .on(table.quoteId)
  .where(sql`status IN ('active', 'paused')`),
```

**Vocabulary mould** (lines 156-163): `export const X = [...] as const; export type X = (typeof X)[number];` with the CHECK spelled in the migration and, since Phase 11, in the schema file too (`missed-calls.ts:186-216` uses `check(...)` inline).

**The creation statement is targetless on purpose** (`for-tenant.ts:2681-2712`): `cadences.create` uses `ON CONFLICT DO NOTHING` with no target, so a fourth unique index is absorbed silently — zero rows then means "a live cadence exists for this lead" as well. That comment block (WR-06) says the constraint set is part of the statement's contract; a lead create must branch on zero rows the same way.

---

### `src/db/schema/text-back-templates.ts` (model, new)

**Analog:** `src/db/schema/message-templates.ts` lines 84-150.

Copy: versioned rows, `uniqueIndex(tenant, <slot>, version)`, `approvedAt` + `approvalNote` as the write-once attestation ("NULL means not approved, never pending"), `tenantId` with `.references(() => tenants.id, { onDelete: 'cascade' })` because templates are the config family (line 89-93), inline `check(...)` for the slot vocabulary (line 137).

A separate table rather than new rows in `message_templates`: that table's `body` comment (lines 104-113) states that nothing in the repository ever sends a template body to a customer and that D-10 forbids merge-fill. Text-back is the first path that sends a template without a model (D-02), so it cannot share the table without making that comment false.

**Repository surface to copy** (`for-tenant.ts:2401-2445`): `insertVersion` computes `version` inside the INSERT with a correlated sub-select so two concurrent saves collide on the unique index; `approveWhereUnapproved(versionId, note, at)` is guarded by `isNull(approvedAt)`.
```typescript
approveWhereUnapproved: (versionId: string, note: string, at: Date) =>
  db
    .update(messageTemplates)
    .set({ approvedAt: at, approvalNote: note })
    .where(
      and(
        eq(messageTemplates.tenantId, tenantId),
        eq(messageTemplates.id, versionId),
        // THE WRITE-ONCE GUARD (D-06). See the interface comment.
        isNull(messageTemplates.approvedAt),
      ),
    )
    .returning(),
```
"Is the whole set attested" must not be vacuously true for a tenant with no rows: the precedent is `hasApprovedTemplateSet` reading `approvedSetStatus()` driven from the slot list, not from the rows that exist (`checklist.ts` header lines 22-26; `src/core/drafting/onboarding-gate.ts:107`).

---

### `src/db/schema/never-text-numbers.ts` (model, new)

**Analog:** `src/db/schema/suppressed-contacts.ts` lines 74-128 and its namespace `for-tenant.ts:3463-3524`.

Copy the `insertMany` with `onConflictDoNothing` on the `(tenant_id, …, address)` unique index (lines 3464-3483) and the tenant-predicated existence probe (`existsFor`, 3485-3516). Numbers are stored normalized through `normalizeAuMobile` (`src/core/cadence/primary-contact.ts:129`) — "one normalizer, one spelling, one key" (`for-all-tenants.ts` header of `cadencesByContactMobile`, ~577-582). Note `tenants.escalation_phone` is stored compact-local and must pass through `normalizeAuMobile` before comparison (`escalate-hot-leads.ts:213-224`).

---

### `src/db/schema/missed-calls.ts` (model, modified)

**Analog:** itself.

**Closed vocabulary + nullable column + CHECK** (lines 81-87, 163-164, 204-207):
```typescript
export const DEAD_LETTER_REASONS = ['unknown_number', 'unparseable', 'not_inbound', 'body_unreadable'] as const;
...
check(
  'missed_calls_dead_letter_reason_known',
  sql`dead_letter_reason IS NULL OR dead_letter_reason IN ('unknown_number', 'unparseable', 'not_inbound', 'body_unreadable')`,
),
```
**Cross-column consistency CHECK mould** (lines 213-216, the IN-04 shape):
```typescript
check(
  'missed_calls_call_id_or_dead_letter',
  sql`dead_letter_reason IS NOT NULL OR provider_call_id IS NOT NULL`,
),
```
Existing facts the gate reads are already columns: `callerE164`, `callerWithheld`, `callerKind` (`mobile`/`other_number`/`withheld`), `forwardedFromRaw`, `afterHours` (computed once at arrival, lines 148-150). The header (lines 28-36) says handset numbers are never printed by any log, script or console surface.

The arrival insert type omits completion columns by construction (`missed-calls.ts` repo 58-61); new text-back columns must be omitted from `MissedCallArrivalInsert` the same way so the webhook cannot write an outcome.

---

### `src/db/repository/for-tenant.ts` (repository, modified)

**Analog:** itself.

**Namespace shape:** interface member with doc comment (e.g. `proofs` at 1656-1700) plus implementation in `build()` (3550-3574). Every statement carries `eq(table.tenantId, tenantId)`; inserts spread `{ tenantId, ...row }`. Append-only namespaces have `append` + `latest` and no update/delete (`attestations` 3526-3548).

**The ledger claim and outcome** (3342-3363), reused as-is for a lead cadence's touch 1:
```typescript
insertClaim: (row: SendLedgerClaim) =>
  db
    .insert(sendLedger)
    .values({ ...row, tenantId })
    .onConflictDoNothing({ target: [sendLedger.cadenceId, sendLedger.touchNumber] })
    .returning({ id: sendLedger.id }),

setOutcome: (ledgerId: string, outcome: SendLedgerOutcome, providerMessageId: string | null) =>
  db
    .update(sendLedger)
    .set({ outcome, providerMessageId })
    .where(and(eq(sendLedger.tenantId, tenantId), eq(sendLedger.id, ledgerId)))
    .returning(),
```
`SendLedgerClaim` (263-266) is `Omit<NewSendLedgerRow, 'tenantId' | 'id' | 'outcome' | 'providerMessageId' | 'claimedAt'>`, so `quoteId` becomes optional/nullable automatically once the column is nullable.

**Transactions:** `forTenant(id).transaction(async (tx) => …)` (4188) gives a `TenantScopedRepository` bound to one connection; this is how dispatch does claim + markSent atomically.

**`markSent`** (3290-3304) moves any non-terminal touch to `sent`; `CadenceTouchInsert` (250-253) omits `status`, so touches are inserted `scheduled`.

**Typed assumptions that a nullable quote breaks:** `ClaimedTouch.quoteId: string` / `sm8JobUuid: string` (442-455); `claimDue` select (3142-3186); `cadences.getByQuoteId` (2730), `stopWhereLiveByQuoteIds` (2794); `ledger.listForQuote` (3377-3391), `countQuotesChasedInPeriod` (3397-3413, `COUNT(DISTINCT quote_id)` ignores NULLs); metrics join at 3878.

---

### `src/db/repository/missed-calls.ts` (repository, modified)

**Analog:** itself + `src/db/repository/escalations.ts`.

**Exact-match UPDATE as the only writer of a column group** (96-118), the shape for "record the skip reason / text-back outcome on the missed call":
```typescript
const rows = await getDb()
  .update(missedCalls)
  .set({ callStatus: input.callStatus, durationSeconds: input.durationSeconds, endedAt: input.endedAt, completedVia: 'callback', updatedAt: sql`now()` })
  .where(and(eq(missedCalls.provider, 'twilio'), eq(missedCalls.providerCallId, input.providerCallId)))
  .returning({ id: missedCalls.id });
return { completed: rows.length > 0 };
```
`completeMissedCall` currently returns only `{ completed }`; the text-back path needs the row (id, tenant, caller, after-hours) and there is no such read today. The existing tenant-scoped read `getMissedCallForTenant` (230-255) deliberately cannot select the caller number.

**Outcome guarded on NULL** so a late second answer cannot bury the first: `recordEscalationOutcome` (`escalations.ts:169-`, described in barrel `index.ts:268-269`).

**Barrel rule:** every new export is added to `src/db/repository/index.ts` in the telephony block (344-391) with a one-line justification, and to the sorted list in `tests/lint-ban.test.ts` (see Tripwires).

---

### `src/core/telephony/text-back.ts` (service, new) — the core of the phase

**Analogs:** `src/core/cadence/dispatch.ts`, `src/core/escalation/escalate-hot-leads.ts`, `src/core/telephony/missed-call.ts`.

**Module conventions** (`missed-call.ts:1-60`, `dispatch.ts:1-55`): framework-free (no `next/*`), deps injectable through a `deps` object with defaults, never throws to the route — every failure is a member of a closed `kind` union, logs are fixed strings with at most a closed-union interpolation, caught values are discarded because a driver error carries statement parameters (a caller's number).

**The order of operations to copy** (`dispatch.ts:10-27`, implemented 478-546 and 558-608):
1. resolve everything that can refuse BEFORE the claim ("the question is asked while refusing is still free", 478-495);
2. `tx.ledger.insertClaim({ cadenceId, quoteId, touchNumber, channel, toAddress, sender })` — zero rows means another process owns it, refuse silently (498-517);
3. `tx.touches.markSent([touch.id])` in the same transaction (519);
4. COMMIT, then call the sender outside the transaction (38-40, 558-562);
5. `forTenant(tenantId).ledger.setOutcome(ledgerId, recorded, providerMessageId)`; a throw from the sender or from `setOutcome` leaves `outcome` NULL and is never retried (563-606).

```typescript
const [ledger] = await tx.ledger.insertClaim({
  cadenceId: touch.cadenceId,
  quoteId: touch.quoteId,
  touchNumber: touch.touchNumber,
  channel: touch.channel,
  toAddress: address,
  sender: claimedProviderFor(context.sender, touch.channel as TouchChannel),
});
if (!ledger) return { kind: 'refused', reason: 'claim_lost' };
await tx.touches.markSent([touch.id]);
```
```typescript
const recorded: SendLedgerOutcome =
  outcome.kind === 'failed' ? 'failed' : outcome.provider === 'stub' ? 'stub_sent' : 'sent';
```
`send_ledger.sender` must be the delegate's provider name, never the composite's (`dispatch.ts:91-142`; `routing-sender.ts:55-67`). `'stub'` rows are excluded from attribution forever (`send-ledger.ts:48-54`).

**The sender to send through:** a `TouchSender` (`src/core/cadence/sender.ts:49-78`). `ClickSendSender.send` (`clicksend-sender.ts:68-143`) refuses an empty body, resolves the from-number through `resolveSmsFrom(request.tenantId)`, passes `customString: request.ledgerId` so the delivery receipt finds the ledger row, never truncates the body, and never throws. `SendRequest.quoteId` is typed `string` (sender.ts:53).

**Closed refusal vocabulary with one counter per rule** (`dispatch.ts:158-219`):
```typescript
export const DISPATCH_REFUSALS = ['paused', 'quote_closed', …] as const;
export type DispatchRefusal = (typeof DISPATCH_REFUSALS)[number];
function noRefusals(): Record<DispatchRefusal, number> { … }
```
The D-06 gate order is fixed and "the first unmet names the reason" — the pure, ordered-walk precedent is `firstUnmetGate` (`arming.ts:93-105`), including "an absent item is unmet, never vacuously satisfied".

**Disarmed refusals are recorded, with zero provider calls** (`escalate-hot-leads.ts:227-277`): resolve identity before any HTTP; claim; then record the named refusal (`sms_not_configured`, `no_escalation_number`, `cooldown_suppressed`) and bump its own counter. The "already texted in the last 24 h" question is asked BEFORE the claim "so the row we are about to insert cannot suppress itself" (236-243).

**No sender means do not scan** (`escalate-hot-leads.ts:51-60, 191-196`): `sender === undefined` returns `unconfigured: 1` without claiming anything, because a claim consumes the never-twice right; every remote suite runs `runCadenceTick` against the hosted (production) database.

**Suppression probe** (`dispatch.ts:458-460`): `tx.suppression.existsFor([{ channel: 'sms', address }])`.

**Caller classification already exists:** `classifyCaller` (`src/core/telephony/caller.ts:111`) produces `mobile` / `other_number` / `withheld` and the E.164; `normalizeAuMobile` (`primary-contact.ts:129`) refuses rather than repairs.

**Deadline helper** (`missed-call.ts:93-117`, `withinDeadline`) if the synchronous send must bound its time inside the status webhook; the route's `maxDuration` is 60 (`voice-status/route.ts:70`).

**Contact hours:** touch 1 is exempt (D-04). The exemption precedent and its wording is `escalate-hot-leads.ts:30-49`; the arming switch is explicitly NOT exempt there.

---

### `src/core/telephony/text-back-template.ts` (utility, new)

**Analogs:** `src/core/drafting/validate.ts`, `src/core/escalation/message.ts`, `src/core/drafting/gsm7.ts`.

**Segment counting** (`gsm7.ts:114-160`): `countSeptets(body)` returns a discriminated `{ encoding: 'gsm7'; septets } | { encoding: 'ucs2'; unsupported: string[] }`; `segmentCount(septets)` is 1 up to 160 and `ceil(septets / 153)` above. A UCS-2 result is a rewrite, not a shorten.

**The two-segment cap** (`validate.ts:105-109, 313-347`):
```typescript
const MAX_SEGMENTS = 2;
…
const segments = segmentCount(counted.septets);
if (segments > MAX_SEGMENTS) {
  violations.push({ rule: 'too_many_segments', detail: String(segments) });
}
```
Measure after `normalizeForGsm7` (`gsm7.ts:202`), as the existing template save does (`drafting/actions.ts:454-457`).

**Budget derived from the counter, not typed** (`message.ts:75-92`): `largestSeptetsWithin(maxSegments)`.

**Spam Act line precedent** (`sender.ts:109-112`): `complianceSuffix(businessName)` → `"<name>. Reply STOP to opt out."`, GSM-7 only (no em dash, middle dot or curly apostrophe, sender.ts 100-107). D-03's default wording contains an apostrophe-free GSM-7 string; `{business}` expansion length must be counted after substitution since the business name is operator text.

**Violations as a closed union** (`validate.ts:50-84`): `{ rule, detail }[]` and `{ ok: true; segments; normalizedBody } | { ok: false; violations }`.

---

### `src/app/api/webhooks/twilio/voice-status/route.ts` + `src/core/telephony/missed-call.ts` (modified)

**Analog:** themselves.

Route invariants that the new call must not break (route header 44-55, body 106-164): env read in a try and acknowledged 200 on failure; token compared in constant time before the body is read; signature over the canonical URL; **every response after the token gate is the byte-identical `Response.json({ received: true })`, never a 5xx**; exactly one log interpolation, the result kind:
```typescript
const result = await applyVoiceStatus(params, { now: new Date() });
console.log(`[twilio] status handled: ${result.kind}.`);
return received();
```
`applyVoiceStatus` (missed-call.ts 293-322) returns `{ kind: 'completed' | 'unmatched' | 'unparseable' | 'db_failed' }` from a closed union and takes injectable deps (`VoiceStatusDeps`, 263-267). The header at 274-282 already anticipates this phase: "in Phase 12 an invented call would be a text to whoever's number was typed" — the callback only completes a row that exists.

Twilio retries a failed status callback (missed-call.ts 283-285), and the reconcile can also complete a call (`completed_via = 'reconcile'`); the text-back claim must therefore be idempotent per call regardless of which writer completed it.

The route's header comment "One callback is one indexed UPDATE and no network call to anyone" (65-69) becomes false and must be rewritten with the change.

---

### `src/core/cadence/run-tick.ts` + `src/app/api/internal/cadence-tick/route.ts` (modified)

**Analog:** themselves.

**Pass wrapper** (run-tick 894-904): one function per pass, try/catch returning the zero counts, fixed-string log.
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
**Seams default to the safe value** (1006-1024): `sender = new StubSender()`, `stallAlertSender = noopStalledEmailSender`, `escalationSender` undefined (no scan), `attribution = 'skip'`. The route is the only composition root that passes real ones (route 117-167). A text-back sweep seam and a balance-probe seam follow the `escalationSender` rule: undefined means the pass does not run.

**Pass ordering** (1053-1074): consume → attribution → progress → dispatch → completion sweep → classification → escalation → aging. Comments at each line argue the placement; anything that sends mail or calls a provider goes behind everything that touches a customer.

**Result is enumerated, never spread**, in both `runCadenceTick`'s return (1076-1143) and the route's `Response.json` (route 177-). Counts only: no ids, no numbers, no error strings (T-3-24).

**Once-per-day alert / claim-then-send for alerts** (`runAgingPass`, 957-1000): the guarded UPDATE that claims is the alert decision; the try is split at the claim so a failed send is still reported as `stallAlertFailed`; nothing un-claims on failure. Email sender type: `StalledEmailSender` (`src/core/alerts/stalled-drafts.ts:288-331`), real one `resendStalledEmailSender`, no-op `noopStalledEmailSender`. Operator SMS: `sendOperatorSms` (`src/core/alerts/operator-sms.ts:160`).

**ClickSend balance read:** no core function exists; only `scripts/clicksend-balance.mjs` (GET `/v3/account`, fields `data.balance`, `data._currency.currency_name_short`, lines 56-138, with a "field not found" arm because the names were an assumption until first run). The typed-client mould is `listPaged` in `src/core/messaging/clicksend-client.ts` (~401-474): injected `fetchImpl`, `AbortSignal.timeout`, Basic auth built from `ClickSendCreds`, closed result union `{ ok: true … } | { ok: false; reason; retryable }`, error NAME only, `http_<status>`, zod `.loose()` schema with `.nullish()` fields. "Read-and-refuse-if-missing" credentials: `buildEscalationSender` (`escalate-hot-leads.ts:103-110`).

---

### Keeping lead touches 2-3 INERT (dispatch / touches)

**Analog:** `for-tenant.ts` `promoteDue` 3019-3038, `claimDue` 3142-3186; `dispatch.ts` 352-426.

Facts the plan must account for:
- `promoteDue` promotes every `scheduled` touch of any `active` cadence whose `scheduled_at` is within the draft lead, with no kind predicate.
- `claimDue` selects `approved` touches of `active` cadences and returns `cadences.quoteId` / `cadences.sm8JobUuid` into `ClaimedTouch` (typed non-null).
- `dispatchOne` starts with `tx.quotes.stateFor([touch.sm8JobUuid])`; an absent quote row takes the `mirror_missing` branch, which skips the touch and STOPS the cadence irreversibly (395-425).
- The approval queue and hot-escalation crossings read `cadences.quoteId` (`for-all-tenants.ts:612, 907, 929 (leftJoin), 1296, 1310 (leftJoin)`); the queue UI builds `/clients/{tenant}/quotes/{quoteId}` links (`queue/queue-card.tsx:114-231`).
- `draft-touches.ts:807` and `approve-draft.ts:491` already guard `cadence.quoteId ? … : []`.
- `completeWhereAllTouchesDone` and `expireOverdueCadences` (`run-tick.ts:533`, 42-day expiry) run over all cadences.

---

### `src/db/repository/messaging-config.ts`, `src/core/onboarding/arming.ts`, `checklist.ts` (arming `text_back`)

**Analog:** themselves.

**`armChannel`** (319-366): one transaction; `readTarget` exact row (never the fallback); refuses `no_identity` when the row is absent or `from_address` is blank (323-340, with extra email requirements); `already_armed` writes nothing; `upsertWith` re-supplies the identity because the `set` is exhaustive (346-353); `appendAudit` in the same transaction (355-362).

**`disarmChannel`** (396-451): reason trimmed and required before any statement; never gated; creates a disabled row for a tenant that has none ("explicit-off override", 410-438); audit in the same transaction.

**Audit insert** (458-477): `operatorUserId` is NOT NULL in the table ("an arming with no hand on it is the row this table exists to refuse", `messaging-config-audit.ts:86-91`) and `reason` is CHECK-required on a disarm (129-133).

**Effective-row read** `getChannelConfig(channel, tenantId)` (89-110) returns the tenant row first and otherwise the GLOBAL row; `resolveSmsFrom` (`routing-sender.ts:185-189`) is `row?.enabled ? row.fromAddress : null`. `anyChannelEnabled(channel)` (144-152) is the deployment-level question.

**`ARMING_GATES`** (`arming.ts:59-81`):
```typescript
export const ARMING_GATES = {
  sms: BOTH_CHANNELS,
  email: [...BOTH_CHANNELS, 'sendingDomainVerified'],
} as const satisfies Record<MessagingChannel, readonly ChecklistItemKey[]>;
export type GatingKey = (typeof ARMING_GATES)[MessagingChannel][number];
```
`satisfies Record<MessagingChannel, …>` makes a missing `text_back` entry a compile error as soon as the vocabulary widens. Gate keys must be listed in `CHECKLIST_ITEM_KEYS` order because `firstUnmetGate` walks them in order (checklist.ts 126-129). D-09's gate items map to existing keys `sm8Connected`, `divertNumber`, `divertVerified` plus new keys for template set attested and never-text contains own number(s); "onboarding complete" has an existing reader, `onboardingComplete` / `readOnboardingConditions` (`src/core/drafting/onboarding-gate.ts:162-192`).

**Checklist** (`checklist.ts`): add keys to `CHECKLIST_ITEM_KEYS` (150-164, order is load-bearing), reads to the single `Promise.all` batch (368-409; the comment at 346-353 counts "Fifteen independent reads" and cites the pool ceiling in `src/db/repository/client.ts`), items to the array (545-633), proof to `proofs` (647-657), and a third member to `live` (671-674) through the one `deriveLive(armed, proven)` (642-643). `LiveState = 'not_armed' | 'armed' | 'live'` (266) already matches D-13's three states. The header/JSDoc counts ("thirteen", "Exactly thirteen", lines 12, 123, 321) are prose that must follow.

Existing divert facts the gate reads: `divertStatus === 'active'` (623), `divertProof !== null` (630), `DivertHealth.divertNumberId` (290).

---

### `src/app/(console)/clients/[id]/actions.ts` + `action-state.ts` (controller, modified)

**Analog:** themselves.

**Action skeleton** (649-741): `requireOperatorId()` → `authorize(tenantId)` → zod `safeParse` of `formData` (nothing read before the first two pass) → re-read `readGoLiveChecklist(tenantId, new Date())` in a try ("a checklist that cannot be read is not a checklist that passed") → `firstUnmetGate(channel, checklist.items)` → `ARM_REFUSAL[unmet]` → repository call in a try whose catch discards the value and logs a fixed string → outcome kinds mapped to sentences → `revalidatePath(`/clients/${tenantId}`)`.

**Target selection** (line 703 and 789), which a third channel changes:
```typescript
tenantId: channel === 'email' || target === 'client' ? tenantId : null,
```
With `armSchema.channel = z.enum(MESSAGING_CHANNELS)` (602-606), widening the vocabulary makes `text_back` postable immediately, and `text_back` + `target: 'everyone'` would resolve to `tenantId: null` — the global row D-09 says must not exist.

**Proof kinds are spelled out, not imported** (811-823): `ACTION_PROOF_KINDS … satisfies readonly (typeof TENANT_PROOF_KINDS)[number][]`, so a kind added to the table is refused here until its verification arm exists. `PROOF_CHANNEL` (861-867) is a `Record` over those kinds and maps each to the armed item it requires (`null` = divert gate). Each arm: validate the paste shape before any read (975-979), tenant-in-predicate read (983, 1018), refuse by name, build `artefactDetail` from ids/statuses/booleans/timestamps only (1003-1006, 1069-1081), then `forTenant(tenantId).proofs.append({ kind, artefactId, artefactDetail, note, recordedBy: operator.userId })` (1137-1147). A text-back proof needs a tenant-predicated read of a `send_ledger` row whose `delivery_status = 'delivered'`; `ledger.listForQuote` deliberately omits `to_address` and `provider_message_id` (for-tenant 3374-3391).

**Copy lives in `action-state.ts`**, a client-reachable leaf that imports types only: `ARM_REFUSAL: Record<GatingKey, string>` (183), `armNoIdentityMessage` (211), `ARM_ALREADY_MESSAGE` / `DISARM_ALREADY_MESSAGE: Record<MessagingChannel, string>` (230, 235), `armedMessage` (313), `disarmedMessage` (330), `PROOF_CHANNEL_NOT_ARMED_MESSAGE: Record<'sms' | 'email', string>` (408), `proofRecordedMessage` (514). Each widens at compile time.

**Attestation action mould:** `attestSm8AutomationOffAction` (543-) with `attestSchema` (507) and note bounds `ATTEST_NOTE_MAX = 500`.

**Template save/attest mould:** `src/app/(console)/clients/[id]/drafting/actions.ts` — `saveTemplateVersion` 391-460 (authorize first, schema, `repo.templates.insertVersion`, segment measurement at 454-457) and `attestTemplateApproval` 507-530 (note required as a parameter; all business rules in the core function). State and messages in `drafting/action-state.ts` 20-156. Forms: `drafting/forms.tsx` `TemplateVersionForm` 184-242 and `AttestApprovalForm` 243-285, both `'use client'` + `useActionState`, one column, real keyboards.

---

### `src/app/(console)/clients/[id]/checklist-card.tsx` (component, modified)

**Analog:** itself.

`'use client'`; takes plain props and defines its own labels; imports types only from core (lint-ban guard). Tables to extend: `ITEM_LABELS` (59-77, `ItemKey = keyof typeof ITEM_LABELS`), `ITEM_FIX: Record<ItemKey, …>` (90-), `ChecklistCardProofs` (182), `LIVE_LABEL` (215), `PROOF_FIELD_HINT` / `PROOF_KIND` / `PROOF_NOTE_HINT` (222-245, keyed by `ProofSlot`), the live lines (312-331), `ProofRow` (583), `ArmRow` (663), per-channel controls (`SmsControls` 730, `EmailControls` 815 — the per-client-only email controls are the closer mould for `text_back`), `ArmConfirm` (874), `DisarmForm` (928). `page.tsx` builds the props inside the degrading read at 734-775 and mounts forms at 908-925.

---

### `src/app/(marketing)/copy.ts` — `PRIVACY_COPY` callers section

**Analog:** itself, lines 416-508.

Sections are `{ id, h2, paragraphs: [...] }` in an `as const` array; the page (`privacy/page.tsx:33-52`) maps them generically, so a new section needs no page change. `dateLine` carries "Last updated 19 September 2026." (line 426). The header comment (403-415) states the rule: retention numbers here must be ones the code enforces. D-11 defers the 90-day pseudonymisation (COMP-02) to Phase 15, so a caller-retention sentence can only state what Phase 12 actually does.

Voice rules apply to every string in the module (`tests/marketing-copy.test.ts:158-228`): the `FORBIDDEN` word list, no em dash, no exclamation mark, no "up to $X", no domain other than ours, exact spelling of ServiceM8 and Backdesk, and the AI disclosure phrase exactly once.

---

### `docs/client-divert-onboarding-runbook.md` (doc, new) + its contract test

**Analogs:** `docs/first-client-go-live-runbook.md` (sections "Before anything" 15, "The window, in order" 40 with `###` steps and two-column "Artefact that proves it" tables, "What each proof is and is not" 349, "Evidence entry template" 389) and `docs/telephony-runbook.md` (§7 "Verification call and proof" 287, §10 "Live divert spike protocol" 404, §11 evidence template 458, §12 "What is never done" 490).

**Contract-test mould** (`tests/runbook-contract.test.ts`): one `readFileSync`, literal lists (`CHECKLIST_LABELS` 46-60 verbatim from `ITEM_LABELS`, `CONTROL_LABELS` 71-79, `STATE_STRINGS` 82, `COMMANDS` 91-99, `HOUSEKEEPING` 113-129), `it.each` presence checks (131-155), a minimum `###` step count (164-166), and three no-credential-shape assertions (186-197). D-12's required content (codes 61/62/67, iPhone settings caveat, DIVERTED verification call from a second phone, carrier-charge warning, holiday pause, offboarding order, "caller number missing on the verification row → do not arm") is the natural `HOUSEKEEPING`-style list.

---

### `src/core/audit/constants.ts` + `docs/commercial-assumptions.md` (named constants)

**Analog:** `OPT_OUT_ALARM_MIN_CONTACTS` (`constants.ts:159-188`) and its record, `docs/commercial-assumptions.md` §7 (159-223).

The module has NO imports by rule and by test; each constant carries a JSDoc stating the value, the reasoning, where it renders/applies, the single place it is applied, and "Recorded in `docs/commercial-assumptions.md` §N". The doc uses one `## N. \`NAME\` = \`value\`` section per constant (headings at 22, 60, 91, 119, 138, 149, 159). D-07's values: daily cap 30 per client; balance alert below A$20; auto-disarm below A$5.

---

### `scripts/text-back-timing.mjs` (ops script, new) + `package.json` alias

**Analog:** `scripts/missed-calls-recent.mjs` (whole file, 165 lines).

Copy verbatim in shape: header with Usage / "WRITES NOTHING. One SELECT." / what is deliberately not selected; `args()` parser (54-61); UUID and limit validation BEFORE the statement (63-88); `process.loadEnvFile('.env.local')` in a try (94-98); `MIGRATE_DATABASE_URL` presence check; the URL parsed inside a `try { new URL(url); } catch {` that never echoes the value (103-108); `postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 })`; explicit select list with numbers reduced to booleans inside SQL (`(caller_e164 IS NOT NULL) AS caller_present`, 124-125); deterministic `ORDER BY … DESC, id DESC`; an explicit "none" line; `sql.end` on both arms (155, 158). For S4 the measured interval is `missed_calls.started_at` → `send_ledger.delivered_at` (carrier time, `send-ledger.ts:185-191`) and `claimed_at`; median/worst computed in SQL or in-process, never printing a number.

npm alias convention (`package.json` 17-24): `"<noun>:<verb>": "node scripts/<file>.mjs"`.

---

## Shared Patterns

### Claim → mark → COMMIT → send → record; NULL outcome is never retried
**Source:** `src/core/cadence/dispatch.ts:10-40, 497-546, 558-608`; `src/db/schema/send-ledger.ts:1-39`
**Apply to:** `text-back.ts`, the tick sweep, the D-08 "about your quote" send.
The sweep must distinguish "never claimed" (safe to send) from "claimed, outcome NULL" (unknown — surfaced to the operator, never auto-resent). D-01's guarantee sweep can therefore only pick up calls with no ledger claim.

### Zero rows from `ON CONFLICT DO NOTHING RETURNING` is an answer
**Source:** `for-tenant.ts:3343-3352` (ledger), `for-tenant.ts:2681-2712` (cadences, targetless), `escalations.ts:85-103`, `missed-calls.ts:71-82`
**Apply to:** lead creation, lead cadence creation, ledger claim, any text-back claim on the missed call.

### Identity resolution is one function, asked before any HTTP
**Source:** `src/core/messaging/routing-sender.ts:155-189` (`resolveSmsFrom`), used by `escalate-hot-leads.ts:227-234` and `checklist.ts:393`
**Apply to:** `text-back.ts`, checklist `textBackArmed`, the proof action. Two readings of one activation rule is the recorded CR-01 defect (`messaging-config.ts:115-143`). A text-back send needs BOTH the shared SMS number resolved for the tenant and the tenant's `text_back` row enabled.

### Closed vocabularies: `as const` array + type + CHECK
**Source:** `missed-calls.ts:64-104, 186-216`; `tenant-proofs.ts:66-71, 127-130`
**Apply to:** `cadences.kind`, skip reasons, text-back outcome, template slot, `text_back_proof`, channel.

### Counts-only results, enumerated field by field, fixed-string logs
**Source:** `escalate-hot-leads.ts:62-66, 112-166, 329-333`; `run-tick.ts:1076-1143`; `cadence-tick/route.ts:167-`
**Apply to:** text-back core, sweep pass, balance pass, both routes. No number, body, name or caught error value in any log.

### Per-row / per-tenant isolation
**Source:** `dispatch.ts:610-663`; `escalate-hot-leads.ts:180-184, 319-326`
**Apply to:** the sweep and the auto-disarm loop over armed clients.

### Server action guard order
**Source:** `clients/[id]/actions.ts:631-741`
**Apply to:** every new action (template save, attest, never-text add, arm/disarm `text_back`, proof).

### Client-reachable modules import no server value
**Source:** `tests/lint-ban.test.ts:636-680, 790-800`
**Apply to:** the two new `'use client'` forms and anything they import. New form files must be added to `CLIENT_REACHABLE`.

### Evidence family: no FK, no cascade, no delete; config family cascades
**Source:** `cadences.ts:103-109`, `missed-calls.ts:44-46`, `message-templates.ts:89-93`
**Apply to:** `leads` and never-text audit-relevant rows (evidence); text-back templates (config).

### Hosted database is production
**Source:** CONTEXT "Constraints carried"; `escalate-hot-leads.ts:51-60`
**Apply to:** every default seam (undefined = do not run), every DB-backed test (never `test:remote`; test tenant `13e8f2aa` is paused with an explicit SMS `enabled=false` row).

---

## Tripwires That WILL Go Red

Each of these is a deliberate pin. They fail on purpose and are edited knowingly, usually with a dated comment recording the decision.

### Database / schema pins

| # | File:lines | What it pins | Trigger in Phase 12 |
|---|---|---|---|
| 1 | `tests/rls-coverage.test.ts:116-137` (the `table_name IN (...)` list) and the expected map ending ~`:340-380` (`'tenant_proofs/anon': 'SELECT'` 355-356, `'missed_calls/…'` 375-378) | Exact grants per table for `anon`/`authenticated` | Every new table (`leads`, text-back templates, never-text) needs an entry in BOTH the IN list and the expected map; a table missing from the list is not checked at all |
| 2 | `tests/rls-coverage.test.ts:30-47` and `:56-` | RLS enabled and at least one policy on every public table; no `USING (true)` (`:95-99`) | New tables without `pgPolicy` |
| 3 | `tests/tenant-proofs.test.ts:229-248` | Refuses kind `'text_back'` with `tenant_proofs_kind_known`; its comment says it goes red "the day that migration widens the CHECK" | If the new kind is spelled `text_back` it goes red; CONTEXT's instruction names the kind `text_back_proof`, in which case this stays green but the comment is stale. Decide the spelling against this pin |
| 4 | `tests/missed-calls.test.ts:581` and the surrounding CHECK table | Each `missed_calls_*` CHECK by name | New columns/CHECKs (skip reason, outcome, IN-04) need rows; a changed CHECK name breaks existing rows |
| 5 | `tests/helpers/seed.ts` `NO_CASCADE_TABLES` (~1040-1128) and `teardownTenants` 1130-1145 | Tables deleted by `tenant_id` in order | New no-FK tables (`leads`, never-text) are left behind unless listed; `leads` must be deleted in an order consistent with `cadences` |
| 6 | `tests/helpers/seed.ts:546` `seedCadence`, `:842` `seedLedgerRow` | Seed with non-null `quote_id` | Not red by themselves, but a new CHECK tying `kind`/`quote_id`/`lead_id` must accept every existing seeded row (default kind = quote) |
| 7 | `tests/cadence-repository.test.ts:108-300, 350-407` | Cadence creation, replay key, one-live indexes, targetless conflict | Any change to `CadenceCreate` (required `quoteId`, `sm8JobUuid`, `createdByEventId`) is a compile error here; CHECK `cadences_replay_key_present` (migration 0023) refuses a lead cadence with no event id |
| 8 | `src/db/migrations/meta/_journal.json` (idx 38, `when` 1790525643412) | Migrator ordering | A new entry with an older `when` is silently skipped (0038 header 16-21) |

### Repository surface pins

| # | File:lines | What it pins | Trigger |
|---|---|---|---|
| 9 | `tests/lint-ban.test.ts:367-549` | `Object.keys(barrel).sort()` equals an explicit list (76 names today) | Every new VALUE export from `src/db/repository/index.ts` (types are erased) |
| 10 | `tests/sync-upsert.test.ts:498-724` | "exactly sixteen named exports" matching `forAllTenants_\w+`, list at 701-718 | Any new `forAllTenants_*` function (sweep crossing, armed-text-back clients). Each addition carries a written justification comment in the test (pattern at 505-700) |
| 11 | `tests/sync-upsert.test.ts:771-830…` | "reaches exactly nineteen tables" — the `import { … } from '@/db/schema'` block of `for-all-tenants.ts` | Importing `leads`, `missedCalls`-adjacent or template tables into `for-all-tenants.ts` |
| 12 | `tests/sync-upsert.test.ts:725-765` | Source slices between named functions must not reference certain tables | Inserting a new function between `forAllTenants_ids` and `forAllTenants_ledgerOwners`, or between `ledgerOwners` and `approvalQueue` |
| 13 | `tests/lint-ban.test.ts:636-680` | `CLIENT_REACHABLE` list | New `'use client'` forms must be added, and must import no `@/db/*` or server-only value |
| 14 | `tests/lint-ban.test.ts:831-854` | `'use server'` files export only async functions | Any constant or sync helper exported from `actions.ts` |

### Checklist / arming pins

| # | File:lines | What it pins | Trigger |
|---|---|---|---|
| 15 | `tests/go-live-checklist.test.ts:137-162` | Literal ordered key list and `toHaveLength(13)` | New checklist keys (13 → N) |
| 16 | `tests/onboarding-checklist-gate.test.ts:598-651` | Same: literal list, `toEqual([...CHECKLIST_ITEM_KEYS])`, `toHaveLength(13)` | Same |
| 17 | `tests/go-live-checklist.test.ts:167-181` | "gates NOTHING this phase": a divert-less client opens the SMS gate, and `ARMING_GATES[channel]` for `['sms','email']` does not contain `divertNumber`/`divertVerified` | Stays green only if the divert keys are added to `ARMING_GATES.text_back` alone and never to sms/email; the describe title and comments become stale |
| 18 | `src/core/onboarding/arming.ts:75-78` | `satisfies Record<MessagingChannel, …>` | Compile error the moment `MESSAGING_CHANNELS` gains `text_back` without a gate list |
| 19 | `src/app/(console)/clients/[id]/action-state.ts:183, 211, 230, 235, 313, 330` | `Record<GatingKey, string>` and `Record<MessagingChannel, string>` maps | Compile errors on new gate keys and the new channel |
| 20 | `src/app/(console)/clients/[id]/checklist-card.tsx:59-77, 90` | `ITEM_LABELS` / `ITEM_FIX: Record<ItemKey, …>` | Missing label or fix link for a new key (the card indexes `ITEM_LABELS[item.key]` at 385) |
| 21 | `tests/runbook-contract.test.ts:39-60, 71-82` | The thirteen `CHECKLIST_LABELS`, seven `CONTROL_LABELS`, `STATE_STRINGS` must appear in `docs/first-client-go-live-runbook.md` | Not red from adding rows, but any RENAMED label breaks it, and the comment "thirteen" goes stale. If the go-live runbook should name the new rows/controls, the lists and the doc move together |
| 22 | `tests/arming-actions.test.ts:38-46` | `vi.mock('@/db/repository', …)` lists exactly the exports `actions.ts` imports | Any new repository import in `actions.ts` (ledger read for the proof, never-text, templates via `forTenant` is already there) is `undefined` at call time unless added |
| 23 | `tests/proof-actions.test.ts:35-45` | Same mock, other half | Same |
| 24 | `tests/divert-provision-action.test.ts:29-44` | Same module mocked a third time | Same |
| 25 | `tests/arming-actions.test.ts` (whole) | `armSchema` accepts `MESSAGING_CHANNELS`; target mapping | A `text_back` + `everyone` POST currently maps to the global row (`actions.ts:703`) |
| 26 | `tests/messaging-config-arming.test.ts:194-388` | `armChannel` refuses a missing row / blank from-address; rollback when the audit insert fails; the explicit-off row creation | Behaviour for `text_back` (no from-address of its own) must be decided against these; system auto-disarm has no `operator_user_id` (NOT NULL) |

### Tick, dispatch and route pins

| # | File:lines | What it pins | Trigger |
|---|---|---|---|
| 27 | `tests/cadence-tick-route.test.ts:353-…` | `Object.keys(body).sort()` equals a written-out key list | Any new count in the tick response |
| 28 | `tests/cadence-tick-route.test.ts:50-75` | `runCadenceTick` and `buildRoutingSender` mocked; asserts the options the route passes | New seams passed by the route |
| 29 | `tests/cadence-tick-route.test.ts:432` | `Object.keys(body.refusals).sort()` equals `DISPATCH_REFUSALS` | A new dispatch refusal (e.g. a lead-kind guard) |
| 30 | `tests/cadence-transitions.test.ts:835-848, 1238-1240` | `CADENCE_EVENTS.length === 12`, matrix = rows × events, every `CADENCE_STATUSES` member has a row; `TOUCH_STATUSES.length === 6`, `TOUCH_EVENTS.length === 5` | Any new cadence/touch status or event (e.g. an "inert" touch status, a "missed call" event for D-08's pause) |
| 31 | `tests/cadence-tick-isolation.test.ts:37`, `tests/cadence-dispatch-isolation.test.ts:45`, `tests/cadence-tick-classification.test.ts:44`, `tests/stall-claim-isolation.test.ts:43` | Repository mocked with an explicit export list | New repository imports in `run-tick.ts` / `dispatch.ts` or in modules they import |
| 32 | `tests/twilio-voice-status-route.test.ts:56-60` | Repository mocked with exactly three functions; suite asserts the byte-identical 200 and the log kinds | Importing text-back into the status path pulls `forTenant`, `getChannelConfig`, etc.; unmocked they are `undefined` |
| 33 | `tests/twilio-voice-route.test.ts:57` | Same mock on the arrival route (shares `missed-call.ts`) | New top-level repository imports in `missed-call.ts` |
| 34 | `tests/telephony-greeting.test.ts:44-100` | Scans EVERY `.ts` under `src/core/telephony` and `src/app/api/webhooks/twilio` (comments stripped) for forbidden TwiML elements and the APIs `record: true`, `recordings.create`, `/transcribe/i`, `.record(` | New telephony files are scanned automatically; avoid identifiers such as `record(`-style method calls (`.record(` matches any method named record) |
| 35 | `tests/routing-sender.test.ts`, `tests/routing-dispatch.test.ts` | Ledger `sender` is the delegate's provider, never `'routing'` | Text-back claiming through a composite without `providerFor` |
| 36 | `tests/classification-privilege.test.ts` | The classifier's import surface from the barrel | Only if barrel reshuffling touches the trio |
| 37 | `tests/cron-schedules.test.ts:136-420` | Exactly one job each; "drives every job from one list" (`:384-389`) | Green as long as D-01 holds (no new cron job). A new job is a violation of D-01, not a pin to edit |

### Constants, copy and script pins

| # | File:lines | What it pins | Trigger |
|---|---|---|---|
| 38 | `tests/audit-aggregate.test.ts:66-95` | `src/core/audit/constants.ts` exports "exactly the nine named constants" and contains no `import` | Adding the three D-07 limits there (9 → 12); the pin comment asks for a dated note and a `docs/commercial-assumptions.md` record |
| 39 | `tests/privacy-page.test.ts:46-56` | "carries the seven headings, in order" — literal h2 list | The callers section (7 → 8) |
| 40 | `tests/privacy-page.test.ts:84-88` | Byte-for-byte: "Email is sent through Resend, SMS through ClickSend, and message drafting uses Anthropic. These providers process content outside Australia." | Naming Twilio as a processor must be a NEW sentence; editing this one goes red |
| 41 | `tests/privacy-page.test.ts:90-94` | No `(all|entirely|fully|only)…in Australia` anywhere in the notice | Caller-section wording |
| 42 | `tests/privacy-page.test.ts:66` | `dateLine` matches `/Last updated \d{1,2} \w+ 2026\./` | Updating the date keeps the shape |
| 43 | `tests/privacy-page.test.ts:69-74, 114-118` | Every section has a non-empty body; test title says "seven sections" | New section content; stale title |
| 44 | `tests/marketing-copy.test.ts:158-228` | Forbidden words, no em dash, no `!`, only our domain, exact product spellings, AI disclosure exactly once — over every leaf of `copy.ts` | Every new privacy sentence |
| 45 | `tests/ops-scripts.test.ts:111-128` (`expectReadOnlyDbScript`) | No write verb (`INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|REVOKE`, case-insensitive, comments stripped), no `SELECT *`, the exact `try {\n new URL(url);\n } catch {` shape, the exact not-parseable message, no `url` in a console/fail call, at least two `sql.end(` | The new S4 script should be added to this suite; note the write-verb regex also matches those words in string literals |
| 46 | `tests/ops-scripts.test.ts:561-570` | `package.json` exposes the telephony aliases | Add the new alias to the pin |
| 47 | `tests/ops-scripts.test.ts:50-99` | `scripts/clicksend-balance.mjs` requests exactly `/account`, no write verb, prints one line | Only if that script is touched |
| 48 | `tests/console-error-leak.test.ts`, `tests/layout-contract.test.ts` (both use `readdirSync`) | Source scans of console code for leaked error values / layout rules | New console forms and actions are scanned automatically |

### Comment-level staleness (not red, but reviewers check them)

- `src/core/onboarding/checklist.ts:12, 123, 142-149, 321, 346-353` — "thirteen", "fifteen reads", "gate nothing in this phase".
- `src/core/onboarding/arming.ts:44-49, 69-73` — "the SMS gate is evaluated against the client whose page this is", "all NINE checklist keys".
- `src/db/schema/message-templates.ts:104-113` — "nothing in this repository ever sends a template body to a customer".
- `src/core/escalation/escalate-hot-leads.ts:87-93` — "an escalation … has no ledger row by design".
- `src/app/api/webhooks/twilio/voice-status/route.ts:65-69` — "no network call to anyone".
- `src/db/schema/send-ledger.ts:133-138` — "Denormalized so attribution can group by quote"; `channel` "One of TOUCH_CHANNELS".
- `src/db/migrations/0038…sql:41-62` — the D-11 prose this migration executes; the new header should point back to it.

---

## Structural Mismatches the Planner Must Resolve

These are places where a locked decision does not fit the existing analog as written. They are reported as facts; the choice belongs to the planner.

1. **`armChannel` cannot arm a channel with no row or no from-address.** `messaging-config.ts:323-332` returns `no_identity` for a missing row or blank `from_address`. A per-client `text_back` row has no number of its own (the text leaves from the shared SMS number). Nothing creates `text_back` rows today.
2. **`disarmChannel` creates a row when none exists** (`:410-438`) and copies identity from the same channel's effective row — for `text_back` there is none, so the row is created with NULL identity. That is consistent with "explicit OFF needs no identity".
3. **Auto-disarm (D-10) has no operator.** `messaging_config_audit.operator_user_id` is NOT NULL (`messaging-config-audit.ts:86-91`, migration `0036:40`) and both writers take `operatorUserId: string` from `requireOperatorId()`. A system disarm "with an audit row naming the reason" needs either a nullable column + CHECK, a sentinel, or a different audit shape.
4. **"No global text-back row" is not enforced by the read.** `getChannelConfig(channel, tenantId)` falls back to `tenant_id IS NULL` (`:89-110`), and the action maps `target: 'everyone'` to `tenantId: null` for any non-email channel (`actions.ts:703, 789`).
5. **`escalations.inbound_message_id` is NOT NULL and is the never-twice key** (`escalations.ts` schema 125, 167; repo 85-103). D-08's operator escalation for an open-quote caller has no inbound message. `forAllTenants_hotUnescalated` (`for-all-tenants.ts:1286-`) drives the existing pass from `inbound_messages.is_hot`.
6. **D-08's pause uses a reply-shaped transition.** `pauseForReply` (`src/core/cadence/controls.ts:836-906`) goes through `cadenceTransition(…, 'customer_reply')` and `pauseWhereActive([id], REPLY_PAUSE_REASON)`. A missed call is not a reply; reusing the reason keeps the matrix at 12 events (pin 30), a new event/reason does not.
7. **D-08 sends a second template to a QUOTE cadence's contact outside the touch sequence.** The ledger's never-twice key is `(cadence_id, touch_number)` (`send-ledger.ts:205`), and the quote cadence's touch numbers 1-5 are already in use.
8. **Lead cadence creation vs the replay key.** `CadenceCreate` requires `createdByEventId: number` (`for-tenant.ts:208-229`) and CHECK 0023 requires it for new rows; a lead cadence is not created by a `quote_opened` event.
9. **INERT touches 2-3.** As mapped above, `promoteDue` would promote them and the drafting pass would pick them up unless a kind predicate, a non-promotable state, or deferred materialisation is used. A new touch status trips pin 30.
10. **Match of an open-quote caller.** `forAllTenants_cadencesByContactMobile` (`for-all-tenants.ts:605-627`) is cross-tenant; D-08 needs "same client", which is a tenant-scoped predicate that does not exist yet on `forTenant(id).cadences` (`listLive()` at interface 984 returns all live cadences).
11. **`SendRequest.quoteId: string`** (`sender.ts:53`) and `ClaimedTouch` typing assume a quote; `ResendSender` may read `quoteId` for the unsubscribe link — check `src/core/messaging/resend-sender.ts` before widening the type.
12. **Daily cap and 24-hour rule need a count read** over `send_ledger` joined to lead cadences (or over `missed_calls` outcomes) inside the tenant scope; the nearest existing reads are `ledger.countQuotesChasedInPeriod` (`for-tenant.ts:3397-3413`) with its `::int` cast note.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| ClickSend balance probe inside the tick with a once-per-day alert latch | service | batch | The only balance read is a script (`scripts/clicksend-balance.mjs`); no table or column records "alert already sent today". The closest once-only mechanism is the guarded-UPDATE claim in `forAllTenants_claimNewlyStalled` (`for-all-tenants.ts:1058-`), which latches per touch, not per day |

Everything else has an exact or role-match analog listed above.

---

## Metadata

**Analog search scope:** `src/core/{cadence,escalation,messaging,onboarding,telephony,drafting,alerts,audit}`, `src/db/{schema,repository,migrations}`, `src/app/api/{webhooks,internal}`, `src/app/(console)/clients/[id]`, `src/app/(marketing)`, `scripts/`, `docs/`, `tests/`
**Files read in full:** 11 (`dispatch.ts`, `escalate-hot-leads.ts`, `missed-call.ts`, `voice-status/route.ts`, `0038_*.sql`, `messaging-config.ts` repository, `arming.ts`, `routing-sender.ts`, `checklist.ts`, schema `cadences.ts` / `send-ledger.ts` / `missed-calls.ts`, repository `index.ts`)
**Files read in targeted ranges or outlined:** about 45
**Not verified:** `src/core/messaging/resend-sender.ts` use of `quoteId`; the full expected-grants map in `tests/rls-coverage.test.ts` (start line located, entries for existing tables confirmed at 355-378); `tests/onboarding-checklist-gate.test.ts:598-651` was located by grep, not read line by line; `src/core/cadence/controls.ts` `pauseForReply` body beyond its signature and transition call.
**Pattern extraction date:** 2026-10-05
