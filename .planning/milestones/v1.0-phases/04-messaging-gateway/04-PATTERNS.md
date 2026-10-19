# Phase 4: Messaging Gateway - Pattern Map

**Mapped:** 2026-08-28
**Files analyzed:** 18 new/modified files
**Analogs found:** 16 / 18 (2 partial — external-HTTP client and triage page have role-matches only)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/messaging/clicksend-client.ts` | service (external HTTP client) | request-response | `src/core/servicem8/client.ts` (error-name-only rule cited by operator-email.ts) + `src/core/alerts/operator-email.ts` | role-match |
| `src/core/messaging/clicksend-sender.ts` | service (TouchSender impl) | request-response | `src/core/cadence/sender.ts` (`StubSender`) | exact |
| `src/core/messaging/resend-sender.ts` | service (TouchSender impl) | request-response | `StubSender` + `src/core/alerts/operator-email.ts` | exact |
| `src/core/messaging/stop-keywords.ts` | utility (pure) | transform | `src/core/cadence/primary-contact.ts` (normalizers) | exact |
| `src/core/messaging/inbound.ts` | service (threading/attribution) | event-driven | `src/core/cadence/controls.ts` (`killContact`) | exact |
| `src/core/messaging/receipts.ts` | service (DLR → ledger) | event-driven | `src/core/cadence/dispatch.ts` (`performSends` outcome write) + servicem8 webhook hint-vs-guarantee | role-match |
| `src/core/messaging/unsubscribe-token.ts` | utility (crypto, pure) | transform | `src/core/shared/crypto.ts` + `bearerMatches` in cadence-tick route | role-match |
| `src/db/schema/inbound-messages.ts` | model (evidence table) | CRUD | `src/db/schema/suppressed-contacts.ts` / `send-ledger.ts` | exact |
| `src/db/schema/messaging-config.ts` (D-04 config table) | model (config) | CRUD | `src/db/schema/suppressed-contacts.ts` (structure) | role-match |
| `src/db/schema/send-ledger.ts` (MODIFY: delivery columns) | model | CRUD | itself | exact |
| `src/core/cadence/controls.ts` (MODIFY: pause-upgrade) | service | CRUD | itself (`pauseForReply`, guard-as-WHERE house style) | exact |
| `src/core/cadence/dispatch.ts` or wiring site (MODIFY: channel-routing sender) | service | request-response | `sender.ts` contract + `dispatch.ts:453-482` | exact |
| `src/app/api/webhooks/clicksend/inbound/route.ts` | route (webhook) | event-driven | `src/app/api/webhooks/servicem8/route.ts` | exact |
| `src/app/api/webhooks/clicksend/dlr/route.ts` | route (webhook) | event-driven | same | exact |
| `src/app/api/unsubscribe/route.ts` | route (public GET+POST) | request-response | `cadence-tick/route.ts` (constant-time auth) + servicem8 route (uniform responses) | role-match |
| `src/core/shared/env.ts` (MODIFY: new secrets) | config | — | itself | exact |
| `scripts/setup-clicksend.mjs` | script (ops setup) | request-response | `scripts/apply-cron-schedules.mjs` | exact |
| Triage console page (e.g. `src/app/(console)/inbox/page.tsx`) | component (server page) | request-response | `src/app/(console)/audits/page.tsx`, `src/app/(console)/clients/[id]/page.tsx` (+ `_auth.ts`) | role-match (not excerpted — read before planning that plan) |

## Pattern Assignments

### `src/core/messaging/clicksend-sender.ts` / `resend-sender.ts` (TouchSender impls)

**Analog:** `src/core/cadence/sender.ts` — the contract IS the file. `StubSender` (lines 107-121) is the shape to copy:

```typescript
export class StubSender implements TouchSender {
  readonly provider = 'stub';   // Phase 4: 'clicksend' / 'resend' — verbatim into send_ledger.sender

  async send(request: SendRequest): Promise<SendOutcome> {
    console.info(
      `[cadence] stub send ledger=${request.ledgerId} cadence=${request.cadenceId} ` +
        `touch=${request.touchNumber} channel=${request.channel} chars=${request.body.length}`,
    );
    return { kind: 'sent', provider: this.provider, providerMessageId: null };
  }
}
```

**Rules baked into the analog (sender.ts:15-37, 100-106):**
- `SendOutcome` union, NOTHING THROWS — provider refusal is `{ kind: 'failed', provider, reason, retryable }`, never an exception.
- Log ledger/cadence ids only — the address is NEVER logged (T-2-02, sender.ts:100-106).
- `provider` literal is written verbatim into `send_ledger.sender`; the channel-routing composite must report the DELEGATE's provider (D-06).
- Framework-free: no `next/*` imports, no DB reads (sender.ts:12-13).

**Resend usage pattern** — `src/core/alerts/operator-email.ts:215-238` (the only production Resend caller):

```typescript
try {
  const { data, error } = await new Resend(apiKey).emails.send({ from, to, subject, text });
  if (error) {
    // `name` only — NEVER the provider message (rule 3, lines 25-29)
    return { ok: false, kind: 'send_failed', detail: error.name ?? 'unknown_error' };
  }
  return { ok: true, id: data?.id ?? null };
} catch (e) {
  const name = e instanceof Error ? e.name : 'UnknownError';
  return { ok: false, kind: 'send_failed', detail: `send threw (${name})` };
}
```

Map this to `SendOutcome`: `error` → `{ kind: 'failed', provider: 'resend', reason: error.name, retryable: … }`; `data.id` → `providerMessageId`. Add `headers: { 'List-Unsubscribe': …, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }` and `replyTo` per RESEARCH Pattern 7. Note `DEFAULT_ALERT_FROM = 'Quote Recovery <onboarding@resend.dev>'` (operator-email.ts:47) — owner-only pre-verification; client-facing mail requires the verified domain first.

**ClickSend client:** direct `fetch` per CLAUDE.md (never the SDK); Basic auth per RESEARCH Code Examples; `custom_string: request.ledgerId`. Copy the "error `name`/classified string only, never provider message bodies" discipline from operator-email.ts rules 2-3 (lines 19-29). Also read `src/core/servicem8/client.ts` before implementing — operator-email.ts:25-29 cites it as the origin of the error-name invariant and it is the house external-HTTP-boundary client.

---

### `src/core/messaging/stop-keywords.ts` (pure utility)

**Analog:** `src/core/cadence/primary-contact.ts:110-149` — pure, anchored-regex, null/boolean-out normalizers:

```typescript
const LOCAL_MOBILE = /^04\d{8}$/;
export function normalizeAuMobile(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(PUNCTUATION, '');
  if (cleaned === '') return null;
  if (LOCAL_MOBILE.test(cleaned)) return `+61${cleaned.slice(1)}`;
  ...
  return null;
}
```

Same shape for `isStopMessage` (RESEARCH Pattern 4 regex, anchored whole-message, never substring). **Reuse `normalizeAuMobile`/`normalizeEmail` for inbound `from` — never a second normalizer** (suppression keying depends on ONE spelling).

---

### `src/core/messaging/inbound.ts` (STOP handling + threading)

**Analog:** `src/core/cadence/controls.ts` — `killContact` (lines 182-246) is the exact transaction shape a STOP write copies:

```typescript
export async function killContact(tenantId: string, cadenceId: string): Promise<KillContactResult> {
  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getById(cadenceId);
  if (!cadence) return { kind: 'no_cadence' };
  const entries = suppressionEntriesFor(cadence);   // BOTH channels, verbatim snapshot addresses
  ...
  return repo.transaction(async (tx) => {
    await tx.suppression.insertMany(entries.map((entry) => ({
      channel: entry.channel, address: entry.address, reason: KILL_REASON, source: KILL_SOURCE,
    })));
    ...
    const stopped = await tx.cadences.stopWhereLive([cadence.id], KILL_STOP_REASON);
    ...
    const skipped = await tx.touches.skipUnsentForCadences([cadence.id], KILL_SKIP_REASON);
    return { kind: 'killed' as const, addressesSuppressed: entries.length, touchesSkipped: skipped.length };
  });
}
```

House rules to copy verbatim:
- **Result unions, never throws** (controls.ts:25-31) — every function returns a closed `kind` union.
- **State decisions come from `cadenceTransition`, resolved at module load** (lines 63-100: `stopReasonFor`/`pauseReasonFor`) — never restate stop/pause reasons as literals.
- **Addresses written verbatim from the cadence snapshot, never re-normalized** (lines 157-166).
- **Suppression write is unconditional even when the cadence is already terminal** (lines 168-180); guard-as-WHERE (`stopWhereLive`) is the idempotence mechanism, not the pre-read (lines 223-233).
- **Framework-free, no authorization here** — caller provides a proven `tenantId`; scope via `forTenant(tenantId)` (lines 17-23). New sources: `source: 'sms_stop'` / `'email_unsubscribe'` (suppressed-contacts.ts:97-103 documents this as the plan).
- Threading match: `cadences.contact_mobile/contact_email` snapshot only (never `quote_contacts`); unique live hit → `pauseForReply(tenantId, cadenceId)` (controls.ts:497-520); zero/multiple → triage row, no pause, no guess.

---

### `src/core/cadence/controls.ts` (MODIFY — D-05 pause-upgrade)

**Analog:** itself. `pauseForReply` (lines 497-520) currently returns `upgrade_unsupported` at line 512-514:

```typescript
  const outcome = cadenceTransition({ status, pauseReason }, 'customer_reply');
  if (outcome.kind !== 'move') return { kind: 'not_active', status };

  if (status !== 'active') {
    return { kind: 'upgrade_unsupported', status, pauseReason };   // ← replace with the upgrade write
  }

  const paused = await repo.cadences.pauseWhereActive([cadence.id], REPLY_PAUSE_REASON);
```

The `upgrade_unsupported` doc block (lines 462-483) prescribes the fix: a new guarded repository write in the `pauseWhereActive`/`resumeWherePaused` house style — `WHERE status = 'paused' AND pause_reason = 'client_paused'` as the guard, `RETURNING id` (RESEARCH Code Examples sketch). Reasons come from `REPLY_PAUSE_REASON` (line 100), never literals. Vocab: `CADENCE_PAUSE_REASONS = ['customer_reply','client_paused']` (cadences.ts:176) — no new vocabulary member, so no CHECK migration needed for this write.

---

### `src/app/api/webhooks/clicksend/{inbound,dlr}/route.ts`

**Analog:** `src/app/api/webhooks/servicem8/route.ts` (webhook conventions) + `src/app/api/internal/cadence-tick/route.ts` (secret auth).

**Route scaffolding** (servicem8 route:49-54, cadence-tick route:63-66):
```typescript
import { z } from 'zod';
export const runtime = 'nodejs';
export const maxDuration = 300;   // cadence-tick sets this explicitly; do likewise
```

**Body handling** (servicem8 route:142-155) — parse defensively, unresolvable cases acknowledge and do nothing:
```typescript
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return acknowledged(); }
  const parsed = hintPayload.safeParse(body);
  if (!parsed.success) return acknowledged();
```
ClickSend difference from servicem8's strict-by-omission schema: use **tolerant** zod (`.passthrough()`, hard-require only `from`/`body` for inbound, `custom_string`/`message_id` for DLR) per RESEARCH Pitfall 1, with a metadata-only dead-letter row for unknown shapes.

**Auth** — no signing at ClickSend, so token-in-URL with the constant-time compare from cadence-tick route:76-90:
```typescript
function bearerMatches(header: string | null, expected: string): boolean {
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;   // timingSafeEqual THROWS on unequal lengths
  return timingSafeEqual(a, b);
}
```
Adapt to compare `new URL(request.url).searchParams.get('token')`. Token never logged, never echoed in errors.

**Response discipline** (servicem8 route:98-121): ONE uniform `acknowledged()` response for every outcome — no enumeration oracle; enumerated fields only (T-3-24); log ids only, never `from`/`body` (T-2-02, see also dispatch.ts:459-465 catch that deliberately discards the caught value). Route stays thin: parse + auth in the route; threading/suppression in `src/core/messaging/inbound.ts` core functions.

**DLR constraint** (fail-safe): update ledger only WHERE `custom_string`/`provider_message_id` matches an existing row; never touch `outcome` from a DLR — delivery status is new nullable columns (send-ledger.ts:107-110 shows the `outcome` / `providerMessageId` precedent; NULL-means-unknown philosophy in its header lines 26-39).

---

### `src/app/api/unsubscribe/route.ts` (public)

**Analog:** cadence-tick route for constant-time verification + `unauthorized()` shape (lines 84-90); servicem8 route for uniform-response philosophy. HMAC token via `node:crypto` following `src/core/shared/crypto.ts` conventions (read it before implementing `unsubscribe-token.ts`). Uniform success page for valid-and-suppressed vs invalid (Pitfall 7); own secret `UNSUBSCRIBE_SIGNING_SECRET` per the two-bearer precedent. Suppression writes go THROUGH a controls-style transaction with `source: 'email_unsubscribe'`, both channels.

---

### `src/db/schema/inbound-messages.ts` + `messaging-config.ts` + send-ledger columns

**Analog:** `src/db/schema/suppressed-contacts.ts` (full evidence-table template) and `send-ledger.ts`:

```typescript
export const suppressedContacts = pgTable(
  'suppressed_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),         // No cascade — see the header
    channel: text('channel').notNull(),
    address: text('address').notNull(),            // NORMALIZED. +614… / trimmed-lowercase
    source: text('source').notNull(),              // free text by design
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('suppressed_contacts_tenant_channel_address_uniq').on(
      table.tenantId, table.channel, table.address),
    pgPolicy('suppressed_contacts_member_access', {
      as: 'permissive', for: 'all', to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);
```

Conventions to copy: closed vocab exported as `const` array + derived type (e.g. `SUPPRESSION_CHANNELS`, suppressed-contacts.ts:74-75; `SEND_LEDGER_OUTCOMES`, send-ledger.ts:79-80); no FK/cascade from tenants; explanatory header stating the invariant; `$inferSelect`/`$inferInsert` type exports. `inbound_messages` is nullable-tenant for unattributed rows — decide RLS handling explicitly (unattributed rows are operator-only). Delivery status = new nullable columns on `send_ledger` (`delivery_status`, `delivered_at`, `delivery_error`) — NEVER new `outcome` values (header lines 26-39). Grants follow migration `0017` precedent (SELECT-only to `authenticated` for suppressed_contacts). **Migration trap:** run the drizzle journal-monotonicity guard after every `generate`; only one plan per wave may generate migrations.

---

### Channel-routing sender wiring (dispatch)

**Analog:** `dispatch.ts:453-482` — dispatch signature untouched; wiring supplies ONE `TouchSender`:

```typescript
// dispatch outcome mapping — already handles real providers:
const recorded: SendLedgerOutcome =
  outcome.kind === 'failed' ? 'failed' : outcome.provider === 'stub' ? 'stub_sent' : 'sent';
await forTenant(send.tenantId).ledger.setOutcome(
  send.ledgerId, recorded, outcome.kind === 'sent' ? outcome.providerMessageId : null);
```

The composite delegates on `request.channel` and returns the delegate's outcome unchanged (so `provider` is `'clicksend'`/`'resend'`, never a composite name). Note `context.sender.provider` is written into the ledger claim at dispatch.ts:410 — the composite's own `provider` field is also visible there; ensure the claimed `sender` column matches the delegate (this is a wiring decision the planner must resolve — the claim happens before the channel-specific delegate runs). Never auto-retry: the throw path (lines 456-466) leaves outcome NULL, logs id only.

---

### `scripts/setup-clicksend.mjs`

**Analog:** `scripts/apply-cron-schedules.mjs` — the secret-bearing, idempotent, replace-never-duplicate ops script:

```javascript
import postgres from 'postgres';
try { process.loadEnvFile('.env.local'); } catch { /* rely on ambient env */ }

const JOBS = [ { name: 'cadence-tick', schedule: '* * * * *', path: '/api/internal/cadence-tick', secretVar: 'CADENCE_TICK_SECRET' } ];
// Usage:  APP_BASE_URL=https://your-app.vercel.app node scripts/apply-cron-schedules.mjs
```

Copy: header explaining why script-not-migration (secrets never committed, lines 6-32); env read at apply time; re-run safe at any time; rotation story documented (lines 34-41). Phase 4 version POSTs ClickSend inbound/DLR automation rules + config row insert; the IPND-blocked live-number activation is this script's final blocked-tagged step (includes the empirical STOP-passthrough test, A3).

---

### `src/core/shared/env.ts` (MODIFY)

**Analog:** itself. New secrets follow the `CADENCE_TICK_SECRET` precedent (lines 34-44 — one secret per endpoint, `.min(32)`, comment explaining the rotation argument): `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, `CLICKSEND_WEBHOOK_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET`. Every new key must ALSO be added to the explicit `safeParse({...})` object literal (lines 116-128) — the schema and the pick-list are maintained in tandem. `.env.example` is currently modified in the working tree; coordinate.

---

### Reconciliation sweep (`receipts.ts` + cron)

**Analog:** the SYNC-03 hint-vs-guarantee philosophy documented in servicem8 route:22-29 ("A webhook can only ever make sync *faster*, never different") — DLR webhook is the hint, `GET /v3/sms/history` / inbound poll is the guarantee. Schedule as pure-SQL-free HTTP cron via the `apply-cron-schedules.mjs` JOBS pattern or piggyback on cadence tick (Claude's discretion per CONTEXT).

## Shared Patterns

### Non-throwing result unions
**Source:** `controls.ts:25-31`, `sender.ts:15-22`, `operator-email.ts:9-17`
**Apply to:** every new core function and sender. Closed `kind` unions; a thrown error is reserved for genuinely broken invariants.

### T-2-02 — no customer addresses/bodies in logs
**Source:** `sender.ts:100-106`, `dispatch.ts:456-465`, servicem8 route:159-164, 201-206
**Apply to:** all senders, webhook routes, inbound handling. Ids only; caught values deliberately discarded, never interpolated.

### T-3-24 — enumerated response bodies
**Source:** `cadence-tick/route.ts:99-132` (field-by-field, never spread)
**Apply to:** every new route's JSON response.

### Per-endpoint secrets + constant-time compare
**Source:** `cadence-tick/route.ts:57, 76-90`; env.ts:34-44 two-bearer rationale
**Apply to:** clicksend inbound token, clicksend dlr token, unsubscribe HMAC — each its own secret.

### zod at every boundary
**Source:** servicem8 route:79-95 (strict-by-omission for known shapes); ClickSend variants go tolerant (`.passthrough()`) per RESEARCH Pitfall 1.

### Framework-free core
**Source:** `sender.ts:12-13`, `controls.ts:17-23`, `env.ts:4`
**Apply to:** everything under `src/core/messaging/` — no `next/*` imports; routes are thin parse+auth shells.

### One normalizer
**Source:** `primary-contact.ts:129-149` — `normalizeAuMobile` / `normalizeEmail` are the ONLY spellings suppression and threading key on.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Domain-verification console surface (Resend DNS records) | component | request-response | No external-API-status console page exists; nearest scaffolding is `src/app/(console)/clients/[id]/page.tsx` + `_auth.ts` + `actions.ts` (server-action + WR-01 membership-read pattern per controls.ts:20-23) — read those files when planning this plan |
| Reply-triage page | component | request-response | Same — extend `(console)` conventions; `clients/[id]/triage-form.tsx` exists and is the closest named artifact (unread; read before planning) |

## Metadata

**Analog search scope:** `src/core/**`, `src/db/schema/**`, `src/app/api/**`, `src/app/(console)/**`, `scripts/**`
**Files read with excerpts:** sender.ts, controls.ts, dispatch.ts (340-490), send-ledger.ts, suppressed-contacts.ts, env.ts, cadence-tick route, servicem8 webhook route, operator-email.ts, primary-contact.ts (110-160), apply-cron-schedules.mjs (1-80)
**Flagged for read-before-implement:** `src/core/servicem8/client.ts`, `src/core/shared/crypto.ts`, `src/db/repository` (tx namespaces), `src/app/(console)/clients/[id]/{page,actions}.tsx`, migration 0017
**Pattern extraction date:** 2026-08-28
