# Phase 11: Telephony Capture - Pattern Map

**Mapped:** 2026-09-27
**Files analyzed:** 21 new/modified files (plus 9 test files whose pins must be edited)
**Analogs found:** 19 / 21 (two are genuinely new shapes: Twilio signature validation and the TwiML builder — both have partial analogs noted)

Every line reference below was read on 2026-09-27 against the working tree at `ccbd039`. Line numbers are for the executor to open the analog at the right place; copy the SHAPE and the CONVENTIONS, not the domain content.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/telephony/twilio-client.ts` (signature validate, number search/buy, configure voice URLs, list calls) | provider client | request-response | `src/core/messaging/clicksend-client.ts` | role-match (same boundary: our credentials crossing to a third party; nothing throws, codes-only failures, tolerant zod parse, direct `fetch`) |
| `src/core/telephony/greeting.ts` (TwiML `<Say>`+`<Hangup/>` builder, pure) | utility | transform | `src/core/messaging/clicksend-client.ts:142-151` (`codeOf` — a pure, exported, bounded string transform with a structural reason) | partial (no TwiML anywhere; treat as pure function + XML-escape) |
| `src/core/telephony/after-hours.ts` (or export from greeting/capture module) | utility | transform | `src/core/cadence/window.ts:69-77, 185-195` (`ContactWindow`, `isInsideWindow`) | exact (the flag is `!isInsideWindow(startedAt, tenantWindow)`) |
| `src/core/telephony/capture.ts` (arrival → row, status → completion; the "handle" function both the webhook and the reconcile call) | service | event-driven | `src/core/messaging/receipts.ts` (`applyDeliveryReceipt`) + `src/core/messaging/inbound.ts` (`handleInboundSms`) — closed-union result kinds consumed by both a webhook and the reconcile | role-match |
| `src/core/telephony/reconcile.ts` (call-log sweep) | service | batch | `src/core/messaging/reconcile.ts:46-157, 176-240` | exact |
| `src/app/api/webhooks/twilio/voice/route.ts` | route (webhook) | request-response | `src/app/api/webhooks/clicksend/dlr/route.ts` (whole file, 178 lines) | exact for auth/logging/uniform-200 shape; differs in response body (TwiML XML, not JSON) |
| `src/app/api/webhooks/twilio/voice-status/route.ts` | route (webhook) | request-response | `src/app/api/webhooks/clicksend/dlr/route.ts` | exact |
| `src/app/api/internal/telephony-reconcile/route.ts` (ONLY if the sweep is not folded into `messaging-reconcile`) | route (internal tick) | batch | `src/app/api/internal/messaging-reconcile/route.ts` (93 lines) | exact |
| `src/db/schema/tenant-divert-numbers.ts` | model | CRUD | `src/db/schema/tenant-proofs.ts` (136 lines) | exact (tenant-scoped, no FK, pgPolicy authored in schema, CHECK vocabularies) |
| `src/db/schema/missed-calls.ts` | model | event-driven | `src/db/schema/escalations.ts:149-185` (unique index as the never-twice claim) + `tenant-proofs.ts` policy block | exact |
| `src/db/schema/index.ts` (modify: two `export *` lines) | config | — | itself, lines 25-31 | exact |
| `src/db/migrations/0038_phase11_telephony.sql` + `meta/_journal.json` entry | migration | — | `src/db/migrations/0036_phase10_go_live.sql` (122 lines) + `0035` header lines 1-31 | exact |
| `src/db/repository/for-tenant.ts` (modify: `divertNumbers` + `missedCalls` namespaces on the interface and in `build`) | repository | CRUD | interface `proofs` at lines 1631-1696, impl at 3449-3473; `claimEscalation` at `src/db/repository/escalations.ts:85-103` for the ON CONFLICT insert | exact |
| `src/db/repository/for-all-tenants.ts` (modify, only if the reconcile needs "every active divert number") | repository | batch | `forAllTenants_ledgerOwners` / `forAllTenants_ids` (keyed or ids-only crossings) | role-match |
| `src/core/onboarding/checklist.ts` (modify: two new keys, two new reads, new `divert` block on the return) | service | CRUD | itself: keys 142-154, reads 300-334, items 456-512, return 524-564 | exact |
| `src/app/(console)/clients/[id]/actions.ts` (modify: `provisionDivertNumberAction`) | controller (server action) | request-response | `armChannelAction` lines 595-710 + `recordProofAction` lines 860-935 | exact |
| `src/app/(console)/clients/[id]/action-state.ts` (modify: `BLANK_PROVISION_STATE`, messages) | config | — | itself (`BLANK_PROOF_STATE`, `PROOF_*` messages, `ARM_REFUSAL` at 183) | exact |
| `src/app/(console)/clients/[id]/checklist-card.tsx` (modify: labels, a provisioning section, divert-health lines) | component | request-response | itself: `ITEM_LABELS` 58-72, proof hook 243-247, row render 296-330 | exact |
| `src/app/(console)/clients/[id]/page.tsx` (modify: pass divert facts, format dates in tenant zone) | component | CRUD | itself lines 932-956 (proofs formatted via `formatInTenantZone`) | exact |
| `src/core/shared/env.ts` (modify: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_WEBHOOK_SECRET`, `TWILIO_VOICE_STATUS_SECRET`?) | config | — | itself lines 46-100 (four-bearer comment + two `CLICKSEND_*_SECRET`), 132-133 (optional provider creds), 244-283 (`getServerEnv` mapping) | exact |
| `docs/env-vars.md` (modify) | docs | — | itself: section at line 131 (`# --- Messaging gateway (Phase 4) ---`) and the reader table at 214-230 | exact |
| `src/proxy.ts` (NO change expected: `api/` is already excluded — see line 226 matcher) | config | — | itself | n/a — verify only |
| `scripts/apply-cron-schedules.mjs` (modify only if a new tick route is added) | script | batch | itself lines 100-103 (`messaging-reconcile` job) | exact |
| `scripts/missed-calls-recent.mjs` | script (ops probe) | batch | `scripts/escalations-recent.mjs:39-120` (uuid/limit validation before the statement) + `scripts/audit-requests-count.mjs:34-101` (the shell) | exact |
| `tests/twilio-voice-route.test.ts`, `tests/twilio-voice-status-route.test.ts` | test (pure) | — | `tests/clicksend-dlr-route.test.ts` (356 lines; source pins at 298-352) | exact |
| `tests/greeting.test.ts` / no-record structural test | test (pure, source scan) | — | `tests/classification-privilege.test.ts:20-30, 79-104` | role-match |
| `tests/telephony-reconcile.test.ts` | test (pure, injected deps) | — | `tests/messaging-reconcile.test.ts:78-121` | exact |
| `tests/missed-calls.test.ts` (DB-backed: idempotency + tenant scoping) | test (DB) | — | `tests/tenant-proofs.test.ts:1-70, 108-190` | exact |
| `tests/divert-provision-action.test.ts` | test (pure, faked session) | — | `tests/proof-actions.test.ts:1-60` | exact |
| `tests/ops-scripts.test.ts` (modify: add a `describe` for the new script) | test (source pin) | — | itself lines 101-174 (`expectReadOnlyDbScript` + `escalations-recent` block) | exact |

---

## Pattern Assignments

### `src/core/telephony/twilio-client.ts` (provider client, request-response)

**Analog:** `src/core/messaging/clicksend-client.ts`

**Header invariants to restate verbatim** (lines 1-22): the ONLY file that talks to `api.twilio.com`; credentials never interpolated into a returned string; nothing throws; direct `fetch`, no vendor SDK (`src/core` is framework-free — global `fetch` only). CLAUDE.md bans ClickSend's SDK by name; apply the same reasoning to `twilio` npm — the surface needed (signature HMAC, 3 REST calls) is small.

**Credential + timeout shape** (lines 43-64, 179-227):
```ts
const API_BASE = 'https://rest.clicksend.com/v3';
const REQUEST_TIMEOUT_MS = 20_000;

export interface ClickSendCreds { username: string; apiKey: string; }

export type SendSmsResult =
  | { ok: true; messageId: string | null; status: string }
  | { ok: false; reason: string; retryable: boolean; optedOut: boolean };

// Built at call time and never stored, logged or returned (T-4-10).
const authorization = `Basic ${Buffer.from(`${creds.username}:${creds.apiKey}`).toString('base64')}`;
let res: Response;
try {
  res = await fetch(ENDPOINT, { method: 'POST', headers: { authorization, ... }, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
} catch (e) {
  // `e.name` only ('TimeoutError', 'TypeError'). NOT String(e) — see header.
  const name = e instanceof Error ? e.name : 'UnknownError';
  return { ok: false, reason: name, retryable: true, optedOut: false };
}
if (!res.ok) {
  // The status CLASS and nothing from the body.
  return { ok: false, reason: `http_${res.status}`, retryable: retryableStatus(res.status), optedOut: false };
}
```
Twilio: `Basic base64(ACCOUNT_SID:AUTH_TOKEN)`; `TwilioCreds { accountSid; authToken }`; add `edge: 'sydney'` by using host `api.sydney.us1.twilio.com` per D-10 (make the host a single constant so the AU1 migration is one edit).

**Tolerant response parsing** (lines 99-114, 236-250): `z.object({...}).loose()` hard-requiring only what is read; `parse_error` / `unexpected_response` / `no_message_in_response` as non-retryable reasons.

**Paged list read** (lines 292-420, `listPaged` / `listSmsHistory`): `MAX_PAGES = 5`, `PAGE_SIZE = 100`, `LIST_TIMEOUT_MS = 30_000`, `ListOptions { creds; since; fetchImpl?; now? }`, result `ClickSendListResult<T> = { ok: true; items; pages } | { ok: false; reason; retryable }`. Copy this for `listCalls({ creds, since, fetchImpl, now })` reading `/2010-04-01/Accounts/{sid}/Calls.json?StartTime>=...&PageSize=100`. Keep the cap: the loop's exit condition is a field in a third party's response.

**Bounded provider strings** (lines 116-151, `codeOf`): any provider status that lands in a column, a screen or a log passes through a code-shaped, digit-run-redacting normaliser. Reuse `codeOf` by import (it is exported for exactly this reason — line 136-140) for Twilio `CallStatus` before storing `call_status`.

**Signature validation (no analog; partial from `tests/clicksend-dlr-route.test.ts` constant-time rules):** implement `validateTwilioSignature({ authToken, url, params, signature }): boolean` in this file as a pure function: `createHmac('sha1', authToken).update(url + sortedKeys.map(k => k + params[k]).join('')).digest('base64')`, compared with `timingSafeEqual` after a length check (the same `tokenMatches` shape at `dlr/route.ts:97-102`). The `url` argument is the CANONICAL public URL built from `getServerEnv().APP_BASE_URL` + pathname + the `?token=` query (D-05), never `request.url`. Export it so the route test can call it with a known token.

**Test analog for this file:** `tests/clicksend-sender.test.ts` (sender) — inject `fetchImpl`; assert the auth header is never in a returned object; assert `e.name` only.

---

### `src/core/telephony/greeting.ts` (utility, transform — pure TwiML)

**Analog (partial):** `src/core/messaging/clicksend-client.ts:142-151` for "one exported pure function with a bounded output and a stated reason". No TwiML exists in the repo.

**Conventions to copy:**
- Framework-free, no imports beyond nothing (string building only). D-03: template is fixed text with `{business}` substituted; escape `&`, `<`, `>`, `"`, `'` for XML before interpolation (a business name like `Smith & Sons` must not break the document).
- Export the template string constant (e.g. `GREETING_TEMPLATE`) AND the builder `buildGreetingTwiml(businessName): string` so the structural test can assert the sentence includes "automated", "isn't recorded", "texting you now", "text us instead".
- Return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Olivia-Neural" language="en-AU">…</Say><Hangup/></Response>`. Nothing else — the no-record test greps this file and both route files for `<Record`, `<Dial`, `<Gather`, `transcri`, `record="` and must find none.
- Also export `UNIFORM_FALLBACK_TWIML` (business-name-less greeting) for the route's "any failure → 200 + greeting" branch (D-05), so the route has no second copy of the XML.

---

### `src/core/telephony/after-hours.ts` (utility, transform)

**Analog:** `src/core/cadence/window.ts`

**Copy exactly** (lines 69-77 interface; 185-195 predicate):
```ts
export interface ContactWindow {
  timezone: string;            // IANA identifier, never a UTC offset
  contactHoursStart: string;   // 'HH:MM:SS' as the `time` column returns it
  contactHoursEnd: string;
  contactDays: readonly number[]; // ISO weekdays, Monday = 1 .. Sunday = 7
}
export function isInsideWindow(instant: Date, win: ContactWindow): boolean { ... [start, end) half-open ... }
```
The after-hours flag is `!isInsideWindow(startedAt, { timezone, contactHoursStart, contactHoursEnd, contactDays })` from `repo.tenant.get()`. Do not re-implement zone maths; import `isInsideWindow`. `InvalidContactWindowError` (line 80) is thrown for a malformed window — catch it in capture and store `after_hours = null`? No: D-07 says the flag is computed; the tenant row cannot exist without a valid window (checklist.ts:357-360 states "ALWAYS SET POST-ONB-01"), so let it propagate to the route's catch-all, which answers the greeting anyway.

---

### `src/core/telephony/capture.ts` (service, event-driven)

**Analogs:** `src/core/messaging/receipts.ts` (`applyDeliveryReceipt` — closed-union `kind` result the webhook logs) and `src/core/messaging/inbound.ts` (`handleInboundSms` — the single entry point both the webhook and `reconcile.ts:274-280` call).

**Conventions to copy:**
- ONE entry point per event (`recordCallArrival(input)`, `completeCall(input)`) that the webhook AND the reconcile call — `reconcile.ts:9-15` states the rule: "imported, not re-implemented… drift would only ever be visible as a customer being treated differently depending on whether their message arrived by callback or by poll".
- Return `{ kind: 'recorded' | 'duplicate' | 'unknown_number' | 'completed' | 'not_found' }` — a closed union, so the route can `console.log(\`[twilio] voice handled: ${result.kind}.\`)` and the pinned-interpolation test (`clicksend-dlr-route.test.ts:326-339`) can hold.
- Tenant resolution is by `To` (the called number) via the divert-number lookup — that lookup is the one cross-tenant read on this path (see for-all-tenants note below). `From` normalisation: `anonymous` / `unknown` / `+266696687` → withheld marker (D-06); otherwise E.164 as received — Twilio already E.164s `From`.
- After-hours flag computed here from the tenant row, not in the route.

---

### `src/core/telephony/reconcile.ts` (service, batch)

**Analog:** `src/core/messaging/reconcile.ts`

**Guard + deps + window** (lines 71-157):
```ts
const WINDOW_HOURS = 48;
export interface ReconcileDeps {
  anyEnabled?: typeof anyChannelEnabled;
  creds?: { username?: string; apiKey?: string };
  listHistory?: typeof listSmsHistory;
  applyReceipt?: typeof applyDeliveryReceipt;
  now?: Date;
}
export async function reconcileMessaging(deps: ReconcileDeps = {}): Promise<ReconcileResult> {
  // THE GUARD IS FIRST AND IT IS TOTAL … Zero HTTP calls, which the suite asserts rather than assumes
  const rawCreds = deps.creds ?? { username: getServerEnv().CLICKSEND_USERNAME, apiKey: getServerEnv().CLICKSEND_API_KEY };
  if (!(await anyEnabled('sms')) || !rawCreds.username || !rawCreds.apiKey) return NOTHING;
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);
  …
  console.info(`[messaging] reconcile applied=${receipts.applied} replayed=${inboundReplayed} optouts=${optOutsRecorded}`);
}
```
Telephony guard: no active divert numbers OR no `TWILIO_*` creds → `NOTHING` with zero fetches. Per D-04, add a pass that asserts account-level recording is off (a GET) and logs a fixed string if not.

**Pass shape** (lines 176-240): `result = await listHistory(...)`; on `!result.ok` → `console.warn(\`[messaging] reconcile history poll failed: ${result.reason}\`)` and return 0 (tomorrow's sweep covers the window); loop calling the SAME apply function the webhook uses; count `kind === 'applied'`.

**Decision on placement:** the existing `messaging-reconcile` route (03:30 AWST) can call `reconcileTelephony()` after `reconcileMessaging()` and add counts to its enumerated JSON — that avoids a new secret, a new cron job, and edits to `tests/cron-schedules.test.ts`. If the planner instead creates `/api/internal/telephony-reconcile`, copy the route below and add a job + secret + doc row + cron test.

---

### `src/app/api/webhooks/twilio/voice/route.ts` and `voice-status/route.ts` (route, request-response)

**Analog:** `src/app/api/webhooks/clicksend/dlr/route.ts` (read the whole file; the header alone is the conventions list).

**Imports + segment config** (lines 71-84):
```ts
import { timingSafeEqual } from 'node:crypto';
import { applyDeliveryReceipt } from '@/core/messaging/receipts';
import { getServerEnv } from '@/core/shared/env';

export const maxDuration = 60;   // a decision, not an inherited default
export const runtime = 'nodejs'; // node:crypto and the postgres driver are unavailable on edge
```

**Constant-time token + 401** (lines 97-110):
```ts
function tokenMatches(provided: string | null, expected: string): boolean {
  const a = Buffer.from(provided ?? '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
function unauthorized(): Response {
  return new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
```
Twilio adds the SECOND factor: after `tokenMatches(token, getServerEnv().TWILIO_VOICE_WEBHOOK_SECRET)` passes, read the form body (`await request.text()` → `new URLSearchParams`), compute the canonical URL from `APP_BASE_URL` (D-05; comment WHY not `request.url` — Vercel's proxy rewrites host/scheme), and call `validateTwilioSignature`. Per the four-bearer rule, `voice` and `voice-status` each get their OWN URL token env key (`TWILIO_VOICE_WEBHOOK_SECRET`, `TWILIO_VOICE_STATUS_SECRET`) — the header at dlr lines 11-24 is the argument to restate; the shared Twilio auth token is the signature key for both and is not a per-route secret.

**Auth first, then body; uniform response; fixed-string logs** (lines 153-178):
```ts
export async function POST(request: Request): Promise<Response> {
  // AUTH FIRST, before the body is read.
  const token = new URL(request.url).searchParams.get('token');
  if (!tokenMatches(token, getServerEnv().CLICKSEND_DLR_SECRET)) return unauthorized();

  const payload = decodeBody(await request.text());
  if (payload === undefined) {
    console.warn('[clicksend] dlr body was readable as neither JSON nor a form; acknowledged 200.');
    return received();
  }
  const result = await applyDeliveryReceipt(payload);
  // THE RESULT KIND, AND NOTHING ELSE. A member of a closed union.
  console.log(`[clicksend] dlr handled: ${result.kind}.`);
  return received();
}
```
For `voice`: the ONLY 200 body is TwiML (`content-type: text/xml`); a signature failure is a 401 (before any write) but a downstream failure (DB down, unknown `To`) is `200 + UNIFORM_FALLBACK_TWIML` plus `console.error('[twilio] voice capture failed; answered fallback greeting.')` — a FIXED sentence the ops probe greps (CAP-04). Wrap the core call in `try { … } catch { console.error('<fixed>'); return fallback(); }` — the caught value is DISCARDED (see Shared Patterns). The greeting must come from data already in hand (D-03 rule R3): resolve the business name from the divert-number row read; if that read fails, fallback greeting without a name.

**Form decoding** (lines 138-151): Twilio always posts `application/x-www-form-urlencoded`; keep the guarded `URLSearchParams` decode (empty key filter) — do not consult the content-type header.

**Proxy exclusion:** `src/proxy.ts:226` matcher already excludes `api/`; no edit. The route test still pins it (`clicksend-dlr-route.test.ts:347-352`) — copy that `it`.

---

### `src/app/api/internal/telephony-reconcile/route.ts` (only if not folded in)

**Analog:** `src/app/api/internal/messaging-reconcile/route.ts` — copy lines 39-93 wholesale: `bearerMatches` (56-62), `unauthorized` (65-70), `maxDuration = 300`, `runtime = 'nodejs'`, and the enumerated-fields `Response.json({...})` at 87-92 ("COUNTS ONLY, enumerated field by field rather than spread"). New env key `TELEPHONY_RECONCILE_SECRET` (min 32), new job in `scripts/apply-cron-schedules.mjs:100-103` shape, new `describe` in `tests/cron-schedules.test.ts:251-268` shape.

---

### `src/db/schema/tenant-divert-numbers.ts` and `src/db/schema/missed-calls.ts` (model)

**Analog:** `src/db/schema/tenant-proofs.ts` (policy + CHECK + no-FK conventions) and `src/db/schema/escalations.ts:165-185` (unique index as the never-twice claim).

**Imports + table + policy** (`tenant-proofs.ts:43-45, 64-133`):
```ts
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const TENANT_PROOF_KINDS = ['escalation_handset_proof', 'email_pipe_proof'] as const;

export const tenantProofs = pgTable('tenant_proofs', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** No FK, no cascade — see the header. */
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').notNull(),
  …
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('tenant_proofs_latest_idx').on(table.tenantId, table.kind, sql`${table.recordedAt} DESC`),
  check('tenant_proofs_kind_known', sql`kind IN ('escalation_handset_proof', 'email_pipe_proof')`),
  pgPolicy('tenant_proofs_member_access', { as: 'permissive', for: 'all', to: authenticatedRole,
    using: sql`has_tenant_access(tenant_id)`, withCheck: sql`has_tenant_access(tenant_id)` }),
]);
export type TenantProof = typeof tenantProofs.$inferSelect;
```

**Unique index shape** (`escalations.ts:166-167`): `uniqueIndex('escalations_inbound_message_uniq').on(table.inboundMessageId)` — for `missed_calls`: `uniqueIndex('missed_calls_provider_call_uniq').on(table.provider, table.providerCallId)` (D-06). For `tenant_divert_numbers`: unique on `tenantId` (one number per client) AND unique on `phoneNumber` (never shared, D-02).

**Column decisions to carry from D-07:** `caller_cli text` nullable + `caller_withheld boolean not null default false` (or a CHECK that exactly one of the two holds); `called_number text not null`; `started_at timestamptz not null` (UTC; Perth derivation in the read path); `after_hours boolean not null`; `provider text not null` CHECK `IN ('twilio')`; `provider_call_id text not null`; `call_status text` (through `codeOf`); `forwarded_from text` (evidence only); `duration_seconds integer`; explicitly NO audio/transcript column. Add a `check('missed_calls_no_record', …)`? Not needed — the structural test covers it.

**Divert health (D-09):** `tenant_divert_numbers.verification_call_at timestamptz` (set once, by the first observed call — or by an explicit operator "this was the verification call" tap; planner decides) and "days since last diverted call" is a READ over `missed_calls` (max `started_at` per tenant) — never a stored counter (`checklist.ts:161-179` rule: derive, don't store).

---

### `src/db/schema/index.ts` (modify)

Lines 29-31 show the append convention; add `export * from './tenant-divert-numbers';` and `export * from './missed-calls';` at the end. Barrel comment (lines 1-4): "Every future table must be exported from here or it will not reach a migration."

---

### `src/db/migrations/0038_phase11_telephony.sql` + `meta/_journal.json` (migration)

**Analog:** `src/db/migrations/0036_phase10_go_live.sql` (all 122 lines) and the `0035` header (lines 1-31).

**Header conventions** (0036 lines 1-33): one journal entry for the whole phase (D-11); "GENERATED by drizzle-kit from …, then renamed from its random tag and re-tagged in meta/_journal.json"; state the generator's `when` and that it is AHEAD of 0037's `1789806076213` ("CHECKED rather than assumed, because drizzle's migrator silently SKIPS an entry older than the last applied one"); no FK on `tenant_id`; policies reference `has_tenant_access` (0000). D-11 adds: a paragraph documenting the `cadences` generalisation decision (`kind`, nullable `quote_id`, `lead_id`, one-live-per-lead arbiter) that Phase 12 executes.

**Journal entry shape** (`meta/_journal.json` tail):
```json
{ "idx": 38, "version": "7", "when": <monotonic > 1789806076213>, "tag": "0038_phase11_telephony", "breakpoints": true }
```

**Grant block, verbatim shape** (0036 lines 71-122):
```sql
-- ── GRANTS (0014's block, verbatim in shape, with the Phase 11 table names) ──
REVOKE ALL ON public.tenant_divert_numbers FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.tenant_divert_numbers FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON public.tenant_divert_numbers TO anon;
--> statement-breakpoint
GRANT SELECT ON public.tenant_divert_numbers TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.tenant_divert_numbers TO service_role;
--> statement-breakpoint
-- (repeat for missed_calls)
```
Both tables READ-ONLY to `authenticated`: the writers are the webhook/reconcile (service role) and the provisioning server action. Explain in the block why an `authenticated` INSERT on `missed_calls` would fabricate a diverted call and why DELETE on `tenant_divert_numbers` would be the release path D-08 forbids.

**Push protocol (CONTEXT constraints):** `npm run cron:status` lease gate, journal `when` monotonic, capture exit code, second run must be a no-op. `src/db/migrations/README.md:1-9` — migrate over port 5432 via `scripts/migrate.mjs`, never bare `drizzle-kit migrate`.

---

### `src/db/repository/for-tenant.ts` (modify: `divertNumbers`, `missedCalls` namespaces)

**Analog:** the `proofs` namespace — interface lines 1631-1696, implementation lines 3449-3473.

**Interface doc + shape** (1652-1696):
```ts
proofs: {
  append(row: { kind: TenantProofKind; artefactId: string; artefactDetail: Record<string, unknown>; note: string; recordedBy: string }): Promise<TenantProof[]>;
  latest(kind: TenantProofKind): Promise<TenantProof[]>;
};
```
**Implementation** (3449-3473):
```ts
proofs: {
  append: (row) => db.insert(tenantProofs).values({ tenantId, ...row }).returning(),
  latest: (kind) => db.select().from(tenantProofs)
    .where(and(eq(tenantProofs.tenantId, tenantId), eq(tenantProofs.kind, kind)))
    .orderBy(desc(tenantProofs.recordedAt), desc(tenantProofs.id)) // `id DESC` is the tiebreak
    .limit(1),
},
```
For `missedCalls.record(row)`: copy `claimEscalation` (`src/db/repository/escalations.ts:85-103`) — `.insert(...).values(...).onConflictDoNothing().returning({ id })` and `rows[0] ?? null` means "duplicate, already held" (D-06 idempotency at the DATABASE, not the caller). Add `missedCalls.complete(providerCallId, { status, duration })` as an UPDATE with `tenantId` AND `providerCallId` in the predicate (the `updateDeliveryWhereMatch` posture: exact-match, cannot enumerate). Add `missedCalls.latest()` (ordered LIMIT 1 on `started_at DESC, id DESC`) for "days since last diverted call". For `divertNumbers.get()` / `divertNumbers.create(row)`: INSERT only, no delete (D-08 — "releasing a number is impossible while the client is active (no delete path in v1.2)"), and say so in the namespace header the way `proofs` says APPEND-ONLY.

**`forTenant()` guard** (3984-3996): unchanged; `forTenant` throws on a non-uuid, so the capture path must resolve `tenantId` from the called number BEFORE calling it.

**Cross-tenant lookup "whose number is this `To`?"** — cannot be asked inside a scope. Add `forAllTenants_divertNumberOwner(calledNumber)` in `for-all-tenants.ts` in the `forAllTenants_ledgerOwners` mould (keyed, not filtered; returns `{ tenantId, businessName? }` — but the barrel comment rule at `lint-ban.test.ts:302-304` says NO join to `tenants` for page-facing reads; this one feeds a webhook (service role by construction, renders nothing) so a name join is acceptable on the `forAllTenants_stalledTally` argument at lines 325-331 — write that argument in the accessor header). If the reconcile needs every active number: `forAllTenants_activeDivertNumbers()` (ids + numbers only).

---

### `src/core/onboarding/checklist.ts` (modify)

**Analog:** itself.

**Keys** (lines 142-154): append `'divertNumber'` and `'divertVerified'` to `CHECKLIST_ITEM_KEYS` — ORDER IS LOAD-BEARING (lines 125-140: `firstUnmetGate` walks it); place them after `emailPipeProof` (they are Phase 12's gate inputs, not Phase 11's; `ARMING_GATES` in `arming.ts:59-78` is NOT edited in this phase).

**Reads** (lines 300-334): add `repo.divertNumbers.get()` and `repo.missedCalls.latest()` to the `Promise.all` (independent reads, issued together — header at 279-285).

**Items** (lines 456-512), same `detail` philosophy ("THE ACTUAL FACT, where one exists" — 161-170):
```ts
{ key: 'escalationHandsetProof', satisfied: handsetProof !== null,
  detail: handsetProof ? `recorded · ${handsetProof.artefactId}` : null },
```
→ `{ key: 'divertNumber', satisfied: divert !== null, detail: divert?.phoneNumber ?? null }` and `{ key: 'divertVerified', satisfied: divert?.verificationCallAt != null, detail: null }` (the DATE is deliberately absent — page formats it in the client's zone; 501-505).

**Return block** (lines 524-564): add `divert: { phoneNumber, verificationCallAt: Date | null, lastCallAt: Date | null }` beside `proofs` — raw instants, never formatted (155-160 rule). "Days since last diverted call" is derived on the page from `lastCallAt` with the `attestationAgeDays` helper shape (lines 97-100: floored whole days, `null` in → `null` out) — export a `daysSince(instant, now)` twin or reuse `attestationAgeDays`.

**Interface** `GoLiveChecklist` (258-270): add the `divert` field; the "Exactly eleven" comment becomes thirteen.

---

### `src/app/(console)/clients/[id]/actions.ts` (modify: `provisionDivertNumberAction`)

**Analog:** `armChannelAction` (595-710) for the three-check preamble; `recordProofAction` (860-935) for "verify live BEFORE writing".

**Preamble to copy verbatim** (618-631):
```ts
export async function armChannelAction(tenantId: string, _previous: ArmState, formData: FormData): Promise<ArmState> {
  const operator = await requireOperatorId();
  if (!operator.ok) return { ...BLANK_ARM_STATE, error: OPERATOR_DENIED_MESSAGE[operator.reason] };

  const denied = await authorize(tenantId);
  if (denied) return { ...BLANK_ARM_STATE, error: denied.formError ?? 'Unknown client.' };
  // NOTHING FROM formData IS READ BEFORE 1 AND 2 BOTH PASS.
```
`authorize` is the private helper at 182-207 (uuid check, `getClaims()`, RLS-scoped `tenants` read through the operator's OWN JWT). Import path must end in `_auth` (line 23-27; pinned by `tests/operator-authorization.test.ts:97`).

**Discard-caught-error + fixed sentence** (667-681):
```ts
let result: Awaited<ReturnType<typeof armChannel>>;
try {
  result = await armChannel({ … });
} catch {
  // The caught value is DISCARDED: a postgres error from this statement carries the statement …
  console.error('[clients] arm write failed');
  return { ...BLANK_ARM_STATE, error: ARM_WRITE_FAILED_MESSAGE };
}
```
**Provisioning order (D-08):** (1) refuse if `repo.divertNumbers.get()` already has a row ("already provisioned" sentence — the `ARM_ALREADY_MESSAGE` pattern at 687-689); (2) `searchAvailableNumbers` (AU local, Perth area) → (3) `buyNumber` with `VoiceUrl = ${APP_BASE_URL}/api/webhooks/twilio/voice?token=…`, `StatusCallback = …/voice-status?token=…`, `VoiceMethod=POST` → (4) `repo.divertNumbers.create(...)`. If (4) fails after (3) succeeded, log a fixed sentence naming that a purchased number is unrecorded (`'[clients] divert number bought but not recorded'`) — the analog for "a failed read never unsays the write" is 693-707. `revalidatePath(\`/clients/${tenantId}\`)` on success (691). Success sentence names the number (the `armedMessage` pattern — the receipt states the fact).

**State + copy** live in `action-state.ts` (a `'use server'` module may export only async functions — comment at 43-44): add `BLANK_PROVISION_STATE`, `PROVISION_*_MESSAGE` constants beside `BLANK_PROOF_STATE` / `PROOF_*`.

---

### `src/app/(console)/clients/[id]/checklist-card.tsx` + `page.tsx` (modify)

**Card labels** (`checklist-card.tsx:58-72`): `ITEM_LABELS` is `Record<ChecklistItemKey, string>` by construction (`type ItemKey = keyof typeof ITEM_LABELS`) — adding keys without labels is a type error, which is the point. Add `divertNumber: 'Divert number provisioned'`, `divertVerified: 'Verification call received'`.

**Hook binding** (243-247): `const [proofState, proofAction, proofPending] = useActionState(recordProofAction.bind(null, tenantId), BLANK_PROOF_STATE);` — one more `useActionState` for `provisionDivertNumberAction`; extend `LastTapped` (164) so a success sentence renders only under the control that was tapped (159-163 explains why).

**Row rendering with a pre-formatted date** (311-321): the date arrives formatted; the card composes the sentence: `` `recorded on ${proof.recordedOn} · ${proof.artefactId}` ``. For divert: `` `verified on ${divert.verifiedOn}` `` and `` `last diverted call ${divert.daysSinceLastCall} days ago` `` (or "no diverted call yet").

**Page formatting** (`page.tsx:932-956`):
```tsx
proofs={{
  escalationHandset: checklist.proofs.escalationHandset
    ? { recordedOn: formatInTenantZone(checklist.proofs.escalationHandset.recordedAt, tenant.timezone, {…}), artefactId: … }
    : null,
```
`formatInTenantZone` is from `@/core/shared/tenant` (line 312). Pass `divert={{ phoneNumber, verifiedOn, daysSinceLastCall }}` the same way.

---

### `src/core/shared/env.ts` + `docs/env-vars.md` (modify)

**Schema** (`env.ts:78-93` for a URL-token secret with its doc comment; 132-133 for optional provider creds):
```ts
CLICKSEND_DLR_SECRET: z.string().min(32),
…
CLICKSEND_USERNAME: z.string().min(1).optional(),
CLICKSEND_API_KEY: z.string().min(1).optional(),
```
Add `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (optional — reconcile guard skips without them, like ClickSend at `reconcile.ts:133-137`; but the WEBHOOK cannot validate a signature without the auth token, so the route must 401 when it is unset — say so in the comment), `TWILIO_VOICE_WEBHOOK_SECRET: z.string().min(32)`, `TWILIO_VOICE_STATUS_SECRET: z.string().min(32)` (REQUIRED — lines 63-66: "an optional webhook secret degrades … into an unauthenticated public endpoint"). Mirror them in the `getServerEnv()` object literal (257-283).

**Docs** (`docs/env-vars.md`): new `# --- Telephony capture (Phase 11, CAP-01..05) ---` block in the style of lines 56-71 (the CADENCE_TICK_SECRET rotation paragraph) and 85-131 ("ADDED TO .env.local BY HAND … pushed with `npm run env:push -- --project backdesk`"); add rows to the reader table at 214-230 (`| \`TWILIO_VOICE_WEBHOOK_SECRET\` | \`src/app/api/webhooks/twilio/voice/route.ts\` via \`getServerEnv()\`, compared in constant time against \`?token=\` and used as the signature URL | **never** |`).

---

### `scripts/missed-calls-recent.mjs` (ops probe)

**Analog:** `scripts/escalations-recent.mjs:39-120` (argument validation, connection, query) inside the `audit-requests-count.mjs:34-101` shell.

**Argument parsing BEFORE the statement** (escalations-recent 50-82):
```js
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const parsed = args(process.argv.slice(2));
if (!parsed) fail('Usage: … [--tenant <uuid>] [--limit <1..50>]');
const tenant = parsed.tenant;
if (tenant !== undefined && !UUID.test(tenant)) fail(`--tenant must be a uuid, got: ${tenant}`);
const limit = parsed.limit === undefined ? 10 : Number(parsed.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(`--limit must be a whole number from 1 to 50, got: ${parsed.limit}`);
```
**Connection + CR-01** (88-104): `process.loadEnvFile('.env.local')` in a try; `MIGRATE_DATABASE_URL`; `try { new URL(url); } catch { fail('MIGRATE_DATABASE_URL is not a parseable URL — see docs/env-vars.md'); }`; `postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 })`.

**Select list — EXPLICIT, no caller number** (T-10-09 mould, 109-120 + `ORDER BY created_at DESC, id DESC`): `id, tenant_id, called_number, caller_withheld, started_at, after_hours, provider_call_id, call_status, duration_seconds, created_at` — `caller_cli` and `forwarded_from` are handset numbers and MUST NOT be selected (the ops-scripts test will pin `not.toMatch(/caller_cli|forwarded_from/)`). Both arms `sql.end({ timeout: 5 })`. Also print a count of the fixed failure sentence? No — that lives in Vercel logs; the script proves rows landed (CAP-03), the log sentence is grepped in the runbook.

Add an npm script `missed-calls:recent` beside `escalations:recent` in `package.json`.

---

### Tests

**`tests/twilio-voice-route.test.ts` / `tests/twilio-voice-status-route.test.ts`** — analog `tests/clicksend-dlr-route.test.ts`:
- Mock env (lines 36-49): a known 40-char token, `WRONG_SAME_LENGTH = \`W${TOKEN.slice(1)}\``, and the OTHER route's token asserted REJECTED (four-bearer rule, lines 11-17). Add `TWILIO_AUTH_TOKEN` and `APP_BASE_URL` to the mock so the signature can be computed in the test with the same HMAC.
- Mock the core (`vi.mock('@/core/telephony/capture', …)`), `await import` the route, `readFileSync` the route source and `src/proxy.ts` (59-60).
- Source pins to copy (298-352): `not.toMatch(/provided\s*===\s*expected/)`; `not.toMatch(/headers\.get\(\s*'authorization'/i)`; the pinned-interpolation set (`326-339`) — collect every `${…}` in the source and assert it equals `new Set(['result.kind'])`; `not.toMatch(/\bwaitUntil\b\s*\(/)`; proxy-matcher exclusion (347-352).
- New pins: never 5xx — a throwing core still yields 200 + TwiML containing `<Say` and `<Hangup/>`; `not.toMatch(/request\.url/)` in the signature-URL computation (or assert the canonical URL builder is called with `APP_BASE_URL`); the fixed failure sentence is present verbatim.

**No-record structural test** — analog `tests/classification-privilege.test.ts:20-30` (`readFileSync` of named source files, an `it.each(FORBIDDEN)` over patterns with a `why`): scan `src/core/telephony/greeting.ts` and both route files for `/<Record\b/`, `/<Dial\b/`, `/<Gather\b/`, `/transcri/i`, `/record=/i`, `/<Play\b/` (deferred idea) and assert none. Also assert the greeting text contains the four D-03 clauses and that `buildGreetingTwiml('Smith & Sons')` escapes the ampersand.

**`tests/telephony-reconcile.test.ts`** — analog `tests/messaging-reconcile.test.ts:78-121`: `vi.fn()` per dep, a `deps(overrides)` builder with `creds: CREDS`, and the first test "skips with ZERO fetches when nothing is enabled / no creds" (the guard is asserted, not assumed).

**`tests/missed-calls.test.ts`** (DB-backed, CI only) — analog `tests/tenant-proofs.test.ts:1-70, 108-190`: `seedTenant`, `signInAsOperator`, `admin`, `teardownTenants` from `tests/helpers/seed.ts`; add `seedDivertNumber(tenantId, overrides)` and `seedMissedCall(...)` helpers in the `seedProof` mould (seed.ts:384-407 — service-role insert, returns id, throws on error). Assertions: (a) `missedCalls.record` twice with the same `(provider, provider_call_id)` → second returns `null`, one row; (b) `authenticated` INSERT through the operator JWT is refused (grant absent); (c) tenant A's rows invisible to a tenant-B-scoped read; (d) `after_hours` stored as computed. Never through `npm run test:remote` (header lines 16-21: the hosted database is production).

**`tests/divert-provision-action.test.ts`** — analog `tests/proof-actions.test.ts:1-60`: mock `@/db/repository`, `@/core/telephony/twilio-client`, `next/cache`; fake Supabase ONE LEVEL BELOW `requireOperatorId` so the REAL allowlist gate runs; assert refusal before any provider call for unauthenticated / forbidden / non-member; assert no `create` when `buyNumber` fails; assert the "already provisioned" refusal makes no provider call.

**`tests/ops-scripts.test.ts`** (modify) — add a `describe('scripts/missed-calls-recent.mjs …')` copying the `escalations-recent` block (129-174): `expectReadOnlyDbScript(CODE)`, the column list, `not.toMatch(/caller_cli|forwarded_from/)`, uuid-before-statement ordering, `limit < 1 || limit > 50`, single `ORDER BY created_at DESC, id DESC`.

---

## Shared Patterns

### Operator-first authorisation (every mutating server action)
**Source:** `src/app/(console)/_auth.ts:73-86` (`requireOperatorId`), `clients/[id]/actions.ts:182-207` (`authorize`), `618-631` (the order).
**Apply to:** `provisionDivertNumberAction` (and any future "mark verification call" action).
```ts
const operator = await requireOperatorId();               // 1. allowlist, through the operator's OWN JWT; read error = denial
if (!operator.ok) return { ...BLANK, error: OPERATOR_DENIED_MESSAGE[operator.reason] };
const denied = await authorize(tenantId);                 // 2. membership, RLS-scoped `tenants` read
if (denied) return { ...BLANK, error: denied.formError ?? 'Unknown client.' };
// 3. only now read formData / call the provider / write through forTenant()
```
Pinned by `tests/operator-authorization.test.ts:58-62, 97` (the file list and the `_auth` import regex) — `clients/[id]/actions.ts` is already listed, so no pin change for a new action in that file.

### Four-bearer rule (one secret per endpoint)
**Source:** `src/core/shared/env.ts:46-66`, `dlr/route.ts:11-24`, `messaging-reconcile/route.ts:25-28`.
**Apply to:** `voice` and `voice-status` get separate URL tokens; a new internal tick (if any) gets its own bearer. Each route test asserts the SIBLING's token is rejected (`clicksend-dlr-route.test.ts:44-49`). The Twilio auth token is a signing key shared by both routes — that is the `UNSUBSCRIBE_SIGNING_SECRET` category (env.ts:94-100: "NOT a bearer"), and the comment must say so.

### Fixed sentences in logs; interpolate only closed-union kinds, ids and counts
**Source:** `dlr/route.ts:163-176`, `inbound/route.ts:239-246`, `reconcile.ts:146-149, 184-187`.
**Apply to:** both webhook routes, capture, reconcile, the provisioning action. Prefix `[twilio]` for provider routes, `[clients]` for actions, `[telephony]` for the sweep. The CAP-04 failure sentence must be ONE literal string in each route so `grep` in the runbook finds it; the pinned-interpolation test enforces that nothing else is templated.

### Discard-caught-error
**Source:** `actions.ts:648-654, 676-681, 702-706`; `clicksend-client.ts:212-216` (`e.name` only); `dlr/route.ts:138-144` (`catch {` with a comment).
**Apply to:** every `try` on this phase's paths. Never `String(e)`, never `e.message` in a log or a returned state — a fetch rejection carries the request URL (Twilio Basic-auth account in it) and a postgres error carries the statement parameters (a caller's number).

### Structural tests (source pins) over behavioural claims
**Source:** `tests/clicksend-dlr-route.test.ts:298-352`, `tests/ops-scripts.test.ts:31-43` (comment-stripped `code()`), `tests/classification-privilege.test.ts:39-104`, `tests/sync-upsert.test.ts:498-506`.
**Apply to:** the no-record test, the route interpolation pins, the ops-script pin, the barrel/crossing pins. Rationale is recorded at `ops-scripts.test.ts:16-22`: the properties are testable by reading the committed source on a bare `npm test`, which is the only reason they are enforced rather than written down.

### Provider client boundary rules
**Source:** `clicksend-client.ts:1-38`.
**Apply to:** `twilio-client.ts`. Nothing throws; failures are codes; no SDK; tolerant `.loose()` schemas; `AbortSignal.timeout`; paging capped.

### Evidence-family table rules
**Source:** `tenant-proofs.ts:31-42`, `0036 lines 23-26, 97-111`, `rls-coverage.test.ts:345-355`.
**Apply to:** `missed_calls` (no FK on `tenant_id`, no cascade — a client who leaves must not take the record of calls we captured; no UPDATE/DELETE grant to browser roles) and `tenant_divert_numbers` (no delete path at all in v1.2, D-08).

### Uniform response to the provider, never 5xx
**Source:** `servicem8/route.ts:22-40` (why every response is 200), `inbound/route.ts:35-55`.
**Apply to:** both Twilio routes. A 5xx on `voice` makes Twilio play its own error tone to the tradie's customer; a 5xx on `voice-status` triggers retries. The reconcile is the guarantee behind the hint (`reconcile.ts:17-29`).

---

## No Analog Found

| File | Role | Data Flow | Reason / What to use instead |
|------|------|-----------|------------------------------|
| Twilio request-signature validation (inside `twilio-client.ts`) | utility | transform | No HMAC-over-URL verification exists (ClickSend signs nothing, ServiceM8 signs nothing; `unsubscribe-token.ts` signs OUR links, the reverse direction). Use `node:crypto` `createHmac('sha1')` + the `tokenMatches` constant-time shape; the canonical-URL rule comes from D-05, and `src/core/messaging/unsubscribe-token.ts` is the nearest example of `timingSafeEqual` on a base64 digest. |
| TwiML document (`greeting.ts`) | utility | transform | No XML is produced anywhere in the repo. Pure string builder with an XML-escape helper; the structural test is the guard. |

---

## Test files whose pins WILL go red and must be updated deliberately

| Test file | Pin | Edit |
|-----------|-----|------|
| `tests/rls-coverage.test.ts:116-137, 150-356` | The `table_name IN (...)` list AND the expected grants map | Add `'tenant_divert_numbers', 'missed_calls'` to the IN-list and four map rows (`/anon: 'SELECT'`, `/authenticated: 'SELECT'`) with a comment paragraph in the 330-355 style. The two standing checks (RLS enabled, at least one policy, no `true` policy) pass automatically if the `pgPolicy` is authored in the schema. |
| `tests/lint-ban.test.ts:367-513` | Exhaustive sorted list of runtime exports from `@/db/repository` | Add any new `forAllTenants_*` accessor (e.g. `forAllTenants_divertNumberOwner`) with a numbered-crossing comment; `forTenant` namespaces need no pin change. |
| `tests/sync-upsert.test.ts:498-506` (+ closing `toEqual` list ~lines 650-700) | "exactly fourteen named exports" scan of `for-all-tenants.ts` | Bump the count and add the name if a crossing is added. |
| `tests/go-live-checklist.test.ts:129-155` and `tests/onboarding-checklist-gate.test.ts:598-646` | `toHaveLength(11)` and "eleven keys" | Thirteen; `toEqual([...CHECKLIST_ITEM_KEYS])` self-updates but the length literal does not. |
| `tests/proof-actions.test.ts` / `tests/arming-actions.test.ts` | `vi.mock('@/db/repository', …)` enumerates the names `actions.ts` imports (proof-actions:36-42) | If `actions.ts` gains a new repository import for provisioning, these mocks must export it or the module fails to load. |
| `tests/runbook-contract.test.ts:35-36` | `docs/first-client-go-live-runbook.md` must name every console label / npm script it references | If the runbook gains divert steps, the labels must match `ITEM_LABELS` exactly. |
| `tests/ops-scripts.test.ts` | One `describe` per Phase 10 script | Add the `missed-calls-recent.mjs` block (not a red pin, but the CONTEXT requires the probe be pinned). |
| `tests/cron-schedules.test.ts:251-268` | Named jobs and their schedules | Only if a `telephony-reconcile` job is added. |
| `tests/clicksend-dlr-route.test.ts:347-352`, `clicksend-inbound-route.test.ts:382-388`, `proxy-host-routing.test.ts:93-103` | `src/proxy.ts` matcher parsed as ONE string | No change needed (`api/` already excluded) — do not touch the matcher; if it is edited for any reason, it must stay a single string. |
| `tests/operator-authorization.test.ts:58-62` | The list of action files that must call `requireOperator(Id)` | No change if the new action lives in `clients/[id]/actions.ts`; add the path if it lives in a new file. |

---

## Metadata

**Analog search scope:** `src/app/api/webhooks/**`, `src/app/api/internal/**`, `src/core/messaging/*`, `src/core/onboarding/*`, `src/core/cadence/window.ts`, `src/core/shared/{env,tenant}.ts`, `src/db/schema/*`, `src/db/migrations/{0035,0036,0037}.sql` + `meta/_journal.json` + `README.md`, `src/db/repository/{index,for-tenant,escalations}.ts`, `src/app/(console)/_auth.ts`, `src/app/(console)/clients/[id]/{actions,action-state,checklist-card,page}.tsx`, `src/proxy.ts`, `scripts/{audit-requests-count,escalations-recent,apply-cron-schedules,push-vercel-env}.mjs`, `docs/env-vars.md`, `tests/{ops-scripts,rls-coverage,lint-ban,clicksend-dlr-route,clicksend-inbound-route,messaging-reconcile,messaging-reconcile-route,tenant-proofs,proof-actions,go-live-checklist,onboarding-checklist-gate,classification-privilege,sync-upsert,operator-authorization,cron-schedules,runbook-contract,proxy-host-routing}.test.ts`, `tests/helpers/{seed,env}.ts`, `vitest.config.ts`, `package.json`.
**Files scanned:** 52 (targeted reads by line range for the four files over 800 lines: `for-tenant.ts` 3996, `page.tsx` 1157, `rls-coverage.test.ts` 1111, `actions.ts` 1022, `lint-ban.test.ts` 815).
**Pattern extraction date:** 2026-09-27
