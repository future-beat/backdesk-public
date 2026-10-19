# Phase 5: AI Drafting & Classification - Pattern Map

**Mapped:** 2026-08-30
**Files analyzed:** 24 new/modified files
**Analogs found:** 22 / 24 (2 no-analog: Anthropic client construction beyond the fetch-client shape, edit-distance — both covered by RESEARCH.md recommendations)

All paths relative to repo root: `~/Documents/Projects/Productised service`.

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `src/core/shared/anthropic.ts` | new | service (API client) | request-response | `src/core/messaging/clicksend-client.ts` | role-match |
| `src/core/drafting/prompt.ts` | new | utility (pure) | transform | `src/core/cadence/resume.ts` (pure/applier split) | role-match |
| `src/core/drafting/gsm7.ts` | new | utility (pure) | transform | `src/core/messaging/stop-keywords.ts` | exact |
| `src/core/drafting/validate.ts` | new | utility (pure, trust boundary) | transform | `src/core/messaging/stop-keywords.ts` | exact |
| `src/core/drafting/edit-distance.ts` | new | utility (pure) | transform | `src/core/cadence/jitter.ts` / stop-keywords (framework-free pure) | role-match |
| `src/core/drafting/draft-touches.ts` | new | service (tick pass) | batch | `src/core/cadence/run-tick.ts` (`runProgressPass`) | exact |
| `src/core/classification/schema.ts` | new | config (zod) | transform | `src/core/servicem8/schemas.ts` | role-match |
| `src/core/classification/classify-inbound.ts` | new | service (tick pass) | batch | `src/core/messaging/reconcile.ts` + `run-tick.ts` pass shape | exact |
| `src/db/schema/message-templates.ts` | new | model (config family) | CRUD | `src/db/schema/cadence-templates.ts` | exact |
| `src/db/schema/touch-drafts.ts` | new | model (evidence family) | CRUD (append-only) | `src/db/schema/inbound-messages.ts` | exact |
| `src/db/schema/cadence-settings.ts` | mod | model | CRUD | itself (header reserves voice-profile home) | exact |
| `src/db/schema/cadences.ts` | mod | model | CRUD | itself (`CADENCE_PAUSE_REASONS` at line 176) | exact |
| `src/db/schema/inbound-messages.ts` | mod | model | CRUD | itself (add label/confidence/hot/attempt columns) | exact |
| `src/db/migrations/0028+*.sql` | new | migration | — | `src/db/migrations/0017_cadence_grants_and_constraints.sql` | exact |
| `src/db/repository/for-tenant.ts` | mod | repository | CRUD | itself (`promoteDue` at :1483, `PROMOTABLE_TOUCH_STATUSES` :249) | exact |
| `src/db/repository/inbound-messages.ts` | mod | repository | CRUD | itself | exact |
| `src/core/cadence/run-tick.ts` | mod | service (orchestrator) | batch | itself (pass structure, per-tenant isolation) | exact |
| `src/core/cadence/dispatch.ts` | mod | service | request-response | itself (body seam) | exact |
| `src/core/cadence/sender.ts` | mod | service | request-response | itself (`complianceSuffix` :109-112, `SendRequest.body` :62-67) | exact |
| `src/core/shared/env.ts` | mod | config | — | itself (`CLICKSEND_USERNAME` optional pattern :113-115) | exact |
| `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts` | mod | controller (server action) | request-response | itself + `src/app/(console)/inbox/actions.ts` | exact |
| `src/app/(console)/settings/*` voice/template screens | new | component + server action | request-response | `src/app/(console)/settings/email/{page,actions,forms,action-state}.ts(x)` | exact |
| `tests/gsm7|drafting-*|classify-*|edit-distance|message-templates.test.ts` | new | test | — | `tests/stop-keywords.test.ts`, `tests/cadence-rewindow.test.ts`, `tests/cadence-tick.test.ts` | exact |
| `scripts/verify-drafting.mjs` | new | script | request-response | existing `verify:*` scripts precedent | role-match |

## Pattern Assignments

### `src/core/shared/anthropic.ts` (API client)

**Analog:** `src/core/messaging/clicksend-client.ts` (lines 1-50)

The header states the two invariants every third-party boundary in this repo follows — copy them verbatim in spirit:

```typescript
/**
 *  1. **The credentials are never interpolated into a returned string.** Every
 *     failure result is built from the HTTP STATUS CODE, a sanitized provider
 *     status code, or the error's `name` — never `String(e)` ...
 *  2. **Nothing throws.** ...
 */
const REQUEST_TIMEOUT_MS = 20_000; // pin a per-request timeout; a stalled request must not hold the tick
```

For Anthropic use the SDK (not fetch — see RESEARCH §Don't Hand-Roll), but keep: pinned `timeout` in **milliseconds** (e.g. `60_000` drafting, `30_000` classification), SDK default `maxRetries: 2`, and the no-customer-content-in-errors rule (log error class names/counts only, per T-2-02). Typed error chain per RESEARCH Code Examples (check `APIConnectionError` before `APIError`).

**Env pattern** — `src/core/shared/env.ts` lines 106-115 (the ClickSend optional precedent, apply to `ANTHROPIC_API_KEY`):

```typescript
// OPTIONAL, unlike the four above, and the asymmetry is D-08's
// number-independent sequencing made structural. ... Making them required would
// put a regulator's postal requirement on the critical path of `npm test`.
CLICKSEND_USERNAME: z.string().min(1).optional(),
CLICKSEND_API_KEY: z.string().min(1).optional(),
```

Absent key → drafting refuses, touches stay `needs_draft` (D-10-shaped); classification skips.

---

### `src/core/drafting/gsm7.ts`, `validate.ts`, `edit-distance.ts`, `prompt.ts` (pure core)

**Analog:** `src/core/messaging/stop-keywords.ts` (lines 1-38)

The framework-free pure-function discipline, with the safety asymmetry argued in the header — the validator has the same asymmetry (false failure = one regen + human edit; false pass = wrong price on a customer's phone):

```typescript
/**
 * The obvious implementation — `body.toLowerCase().includes('stop')` — is wrong
 * in the expensive direction ...
 * FRAMEWORK-FREE AND DEPENDENCY-FREE, the shape `primary-contact.ts` follows.
 * Nothing here imports from `next/*`, touches the database, or logs: this
 * function is handed a customer's message body, and T-4-02 ... says that
 * string never reaches a platform log.
 */
```

**Pure-rule / thin-applier split analog:** `src/core/cadence/resume.ts` header (lines 53-60):

```typescript
 * ── THE SPLIT: A PURE RULE AND A THIN APPLIER ───────────────────────────────
 * `computeResumeSchedule` is pure — no database, no clock, injected RNG — so
 * D-07 is provable with pinned inputs. `applyResumeRewindow` is the write ...
```

Apply the same split: `prompt.ts`/`validate.ts`/`gsm7.ts`/`edit-distance.ts` are pure and exhaustively tested with pinned inputs; `draft-touches.ts` is the applier that reads/writes through `forTenant(id)`. Validator mechanics (whitelist membership + septet counting) per RESEARCH Pattern 4; GSM-7 facts per RESEARCH Code Examples.

---

### `src/core/drafting/draft-touches.ts` + `src/core/cadence/run-tick.ts` change (tick pass)

**Analog:** `src/core/cadence/run-tick.ts` `runProgressPass` (lines ~320-365)

Per-tenant loop, pause skip, per-tenant error isolation, no-content logging:

```typescript
for (const tenant of await forAllTenants_cadenceTick()) {
  if (tenant.connectionPausedAt !== null || tenant.settingsPausedAt !== null) continue;
  try {
    const repo = forTenant(tenant.tenantId);
    // ... sub-passes (a)(b) ...
    // (c) D-14, last: a touch surfaces to the drafting queue at the time it is
    // actually going out at, not at one this pass was about to change.
    const promoted = await repo.touches.promoteDue(now, DRAFT_LEAD_HOURS * MS_PER_HOUR);
    totals.touchesPromoted += promoted.length;
  } catch {
    console.error(`[cadence] progress pass failed for tenant ${tenant.tenantId}.`);
  }
}
```

Drafting pass hangs off sub-pass (c): `promoteDue` already `.returning()`s the promoted rows — feed those plus leftover `needs_draft` rows into the per-tenant sequential Claude batch (RESEARCH Open Question 2). Counts accumulate into a `ProgressCounts`-style totals object; the tick route response enumerates fields (T-3-24), pattern in `src/app/api/internal/cadence-tick/route.ts`.

**Narrowing the stub gate:** `src/db/repository/for-tenant.ts` lines 249-253 and :1483 — change `PROMOTABLE_TOUCH_STATUSES` to `['scheduled']` and `.set({ status: 'needs_draft', … })`. The header at :243-247 states verbatim: "Phases 5 and 6 replace this one method with real gates; the vocabulary does not change".

**Classification pass** (`classify-inbound.ts`): same per-tenant-isolation shape but runs for **all** tenants (like pass 1 — labels are evidence, D-16); scan `inbound_messages WHERE label IS NULL AND attribution != 'dead_letter' ORDER BY received_at LIMIT n` with an attempt counter. Batch-scan-over-rows shape analog: `src/core/messaging/reconcile.ts`.

---

### `src/db/schema/touch-drafts.ts` (evidence family)

**Analog:** `src/db/schema/inbound-messages.ts`

**Evidence-family rules** (header, lines 31-36):

```typescript
 * NO FOREIGN KEY AND NO CASCADE from `tenants`, the rule the whole evidence
 * family follows (see quote-events.ts, send-ledger.ts, suppressed-contacts.ts):
 * a client who disconnects must not take the record of what their customers
 * asked for with them. `cadence_id` and `quote_id` are denormalized for
 * correlation and carry no reference either ...
```

**Closed vocabulary as const + CHECK** (lines 103-109, 202-205):

```typescript
export const INBOUND_ATTRIBUTIONS = ['threaded', 'ambiguous', 'unmatched', 'dead_letter'] as const;
export type InboundAttribution = (typeof INBOUND_ATTRIBUTIONS)[number];
// ...
check('inbound_messages_attribution_known',
  sql`attribution IN ('threaded', 'ambiguous', 'unmatched', 'dead_letter')`),
```

**RLS policy shape** (lines 220-226):

```typescript
pgPolicy('inbound_messages_member_or_operator_access', {
  as: 'permissive', for: 'all', to: authenticatedRole,
  using: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
  withCheck: sql`...`,
}),
```

For `touch_drafts` the simpler single-arm `has_tenant_access(tenant_id)` suffices (tenant_id always known). Body columns (`generated_body`, `final_body`) follow the T-2-02 rule stated at lines 54-60: stored behind RLS, logged nowhere. Grants: read-only to authenticated, service-role writes — grant migration analog `0025_inbound_messages.sql` / `0017`.

**Column set** per RESEARCH Pattern 6: `tenant_id` (no FK), `cadence_id`, `touch_id`, `attempt`, `model`, `template_id`, `template_version`, `prompt_version`, `generated_body`, `final_body`, `status` CHECK (`generated | validator_failed | superseded | approved`), `validator_failures jsonb`, `segments`, `edit_distance numeric` (NULL until approval), timestamps. Denormalize model/template_version/prompt_version onto the row.

---

### `src/db/schema/message-templates.ts` (config family, append-only versions)

**Analog:** `src/db/schema/cadence-templates.ts`

Config family DOES cascade (lines 57-65):

```typescript
tenantId: uuid('tenant_id')
  .notNull()
  .references(() => tenants.id, { onDelete: 'cascade' }),
// ...
uniqueIndex('cadence_touch_templates_tenant_touch_uniq').on(table.tenantId, table.touchNumber),
```

For versions: `UNIQUE (tenant_id, touch_number, channel, version)`; rows immutable after insert; write-once `approved_at timestamptz` + `approval_note text` (D-06 attestation); nullable `subject` for D-04 email readiness. Reuse `TOUCH_CHANNELS` from cadence-templates.ts (lines 50-51). Cascade is acceptable only because drafts denormalize their audit facts (RESEARCH Pattern 6). Snapshot-semantics rationale to echo in the header: lines 20-25 ("a touch row is a decision already made, not a view over configuration").

---

### `src/db/schema/cadence-settings.ts` (voice profile columns)

**Analog:** itself — header lines 11-13 reserve the home verbatim: "Phase 5 hangs per-tenant DRAFTING configuration (voice guide, template block, model preferences) off this same row." Add nullable columns (`greeting_style`, `sign_off`, `formality`, `banned_phrases text[]`, `example_messages text[]`, `voice_notes`) beside `preferredSendTime`/`pausedAt`; existing single-arm `has_tenant_access` policy already covers them. Preserve the "TWO PAUSES" header commentary untouched.

---

### `src/db/schema/cadences.ts` + migration (onboarding pause reason)

**Analog:** `src/db/migrations/0017_cadence_grants_and_constraints.sql` lines 184-188 — the drop/re-add CHECK pattern for extending a closed vocabulary:

```sql
ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_pause_reason_known;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_pause_reason_known
  CHECK (pause_reason IS NULL OR pause_reason IN ('customer_reply', 'client_paused'));
```

New migration (0028+): re-add with `'onboarding'` in the list; also add CHECKs for draft status, classification label, confidence bucket the same way. Schema-side: extend `CADENCE_PAUSE_REASONS` (`src/db/schema/cadences.ts:176`). **Migration trap:** drizzle journal-ordering (RESEARCH Pitfall 5) — after every generate, run the monotonicity guard and prove `npm run db:migrate` is no-op-or-applies; new migrations start at 0028.

**Resume path analog:** `src/core/cadence/resume.ts` — every path that clears a pause calls `applyResumeRewindow` with an explicit cadence scope; the reason-scoped resume asymmetry is enforced by `resumeWherePaused(expected)` (cadences.ts:172-175). The template-set-approval action calls `resumeWherePaused('onboarding')` + `applyResumeRewindow` over the RETURNING ids — the exact composition the two console resumes in `controls.ts` use.

---

### `src/core/cadence/sender.ts` + `dispatch.ts` (body seam)

**Analog:** itself. The suffix must be appended mechanically after generation and frozen into `final_body`:

```typescript
// src/core/cadence/sender.ts:109-112
export function complianceSuffix(businessName: string): string {
  const name = businessName.trim();
  return name === '' ? 'Reply STOP to opt out.' : `${name}. Reply STOP to opt out.`;
}
```

`SendRequest.body` (sender.ts:62-67) is the seam: dispatch's claim replaces `stubTouchBody` composition with a lookup of the approved draft's `final_body` for the claimed touch; a claimed `approved` touch with no approved draft row is a **refusal, never a stub fallback** (D-10). Approval and dispatch read the same `final_body` bytes (RESEARCH Pitfall 6). Never truncate at the transport — `clicksend-client.ts:198-201` sends verbatim by contract.

---

### `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts` (approve/edit action)

**Analog:** itself (lines 1-95). The full server-action discipline to copy:

```typescript
'use server';
// EVERY EXPORT BELOW IS A GLOBALLY-POSTABLE ENDPOINT ... every one of them opens
// with `authorize(tenantId)` BEFORE reading a byte of `formData` (WR-01), and the
// authorization is an RLS-scoped read made with the OPERATOR'S OWN JWT.
const cadenceIdSchema = z.object({ cadence_id: z.uuid() });
async function authorize(tenantId: string): Promise<ControlState | null> { ... }
```

Copy: `authorize(tenantId)` first, zod-validate formData ids, control logic delegated to a `@/core` function through `forTenant(tenantId)` (the tenant-closure second layer), messages as constants in the sibling `action-state.ts`, `revalidatePath` after write. The approve action computes edit distance (`edit-distance.ts`) and re-runs the validator on edited bodies before writing `pending_approval → approved`.

### Voice-profile / template authoring screens

**Analog:** `src/app/(console)/settings/email/` — `page.tsx` + `actions.ts` + `action-state.ts` + `forms.tsx` is the established four-file config-authoring unit (server component page, server actions with authorize-first, message constants, client form components). Follow it file-for-file for template versions and voice profile.

---

### `src/core/classification/schema.ts` + `classify-inbound.ts`

**Analog for zod boundary:** `src/core/servicem8/schemas.ts` (dedicated schema module, exported inferred types). Request shape per RESEARCH Code Examples — `messages.parse()` + `zodOutputFormat`, **no `tools` key**, `temperature: 0` (Haiku only), guard `parsed_output === null`, then `safeParse` again (project rule: LLM outputs are a boundary). Writes label/confidence/hot columns only — never `cadences`, `suppressed_contacts`, or any send path (D-13/D-14); the repository surface handed to this pass must structurally exclude those writers (test analog: `tests/lint-ban.test.ts` style assertion).

---

### Tests

| New test | Analog | What to copy |
|---|---|---|
| `tests/gsm7.test.ts`, `drafting-validate.test.ts`, `edit-distance.test.ts` | `tests/stop-keywords.test.ts` | Known-answer table pinning of a pure function |
| `tests/drafting-prompt.test.ts` | `tests/cadence-rewindow.test.ts` | Pinned-input pure-rule proofs (byte-identical prefix assertions) |
| `tests/draft-touches.test.ts` | `tests/cadence-tick.test.ts`, `tests/routing-dispatch.test.ts` | Fake-seam injection for the sender-of-drafts; failure-path matrix |
| `tests/classify-inbound.test.ts` | `tests/inbound-stop.test.ts` | Fake client, boundary re-validation paths |
| `tests/classification-privilege.test.ts` | `tests/lint-ban.test.ts`, `tests/resume-write-guard.test.ts` | Static/structural privilege assertions |
| `tests/message-templates.test.ts` (remote) | `tests/cadence-repository.test.ts` | Remote harness; **never overlap `test:remote` runs** (lease/watchdog live) |
| extend `tests/cadence-transitions.test.ts` | itself | Onboarding pause/resume transition matrix |

## Shared Patterns

### Per-tenant error isolation (all tick passes)
**Source:** `src/core/cadence/run-tick.ts` (~:326, :357-359). `try { forTenant(...) } catch { console.error('[cadence] ... tenant ${id}.') }` — the caught value deliberately not logged (parameters carry customer data).

### No customer content in logs (T-2-02) / enumerated responses (T-3-24)
**Source:** `src/db/schema/inbound-messages.ts` header lines 54-60; `src/app/api/internal/cadence-tick/route.ts`. Prompts, bodies, and raw API payloads never reach logs; tick responses return count fields only. Log `usage.cache_read_input_tokens` counts — counts are safe.

### Closed vocabulary = `as const` + CHECK (migration 0017 pattern)
**Source:** `src/db/schema/inbound-messages.ts:103-109` + `0017_...sql:184-188`. Every new vocabulary (draft status, label, confidence bucket, `onboarding` pause reason) gets: exported const array, derived union type, `check(...)` in the table def, drop/re-add SQL in the migration. Enum spelling: underscores everywhere (`not_interested`, `opt_out`) — zod enum = CHECK = TS union byte-identical.

### Authorize-first server actions
**Source:** `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts:35-95`. Applies to approve/edit action, template attestation, voice-profile save.

### Optional external-dependency env vars
**Source:** `src/core/shared/env.ts:106-115` (`CLICKSEND_*` precedent). `ANTHROPIC_API_KEY: z.string().min(1).optional()` — paperwork/external deps never break `npm test`.

### Evidence vs config table families
**Source:** evidence = `inbound-messages.ts`/`send-ledger.ts` (no FK, no cascade, RLS read, service-role write); config = `cadence-templates.ts`/`cadence-settings.ts` (FK + cascade). `touch_drafts` is evidence; `message_templates` is config with denormalized audit facts on drafts.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Anthropic SDK usage itself (`messages.parse`, `zodOutputFormat`, `cache_control`) | service | request-response | No LLM calls exist in the repo; use RESEARCH.md Code Examples verbatim (they cite the bundled claude-api skill). `@anthropic-ai/sdk` is new — flagged SUS, needs `checkpoint:human-verify` before install (Phase 4 precedent) |
| `edit-distance.ts` algorithm body | utility | transform | No string-metric code exists; RESEARCH recommends in-repo two-row Wagner–Fischer (~25 lines) with pinned known-answer tests; `fastest-levenshtein` is the only sanctioned fallback |

## Metadata

**Analog search scope:** `src/core/**`, `src/db/{schema,repository,migrations}/**`, `src/app/(console)/**`, `src/app/api/**`, `tests/`
**Files scanned:** ~120 (full tree listed); 10 read in depth this session, plus 16 seams line-cited from RESEARCH.md's same-session reads
**Pattern extraction date:** 2026-08-30
