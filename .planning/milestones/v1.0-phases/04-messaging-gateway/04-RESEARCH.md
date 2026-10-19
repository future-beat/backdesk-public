# Phase 4: Messaging Gateway - Research

**Researched:** 2026-08-28
**Domain:** SMS (ClickSend) + email (Resend) send/receive gateway behind the D-13 sender seam; Spam Act compliance mechanics; inbound routing/threading
**Confidence:** MEDIUM overall — internal seams HIGH (read this session), ClickSend webhook payload specifics LOW (officially under-documented), Resend mechanics MEDIUM (official docs)

## Summary

Phase 3 deliberately built everything except the wire. The `TouchSender` interface (`src/core/cadence/sender.ts`) is an explicit Phase 4 contract: dispatch already claims a `send_ledger` row before invoking the sender, already records `provider` and `provider_message_id` for receipt reconciliation, already re-checks suppression just-in-time at every send, and `pauseForReply` is already exported waiting for its first caller. Phase 4's job is therefore three bounded pieces of work: (1) two real `TouchSender` implementations — a thin typed `fetch` wrapper over ClickSend's REST API and a Resend sender reusing the SDK already in production for operator alerts; (2) two inbound webhook receivers (ClickSend inbound SMS + DLR push; optionally Resend events) that thread messages to tenant/contact/quote and write suppressions/pauses through the existing control surface; (3) the compliance layer — deterministic STOP regex before anything else, a Spam Act unsubscribe endpoint, and sender identification baked into message copy and email footers.

The external landscape has one hard blocker and two soft spots. The blocker: **no IPND-acceptable AU street address**, which blocks dedicated-number provisioning at both ClickSend and Twilio (support ticket open since 2026-08-25, next check 2026-09-01). Plans must sequence so everything except live-number end-to-end tests proceeds without the number — ClickSend's test-inbound endpoint and the stub-distinguishable ledger design make that feasible. The soft spots: ClickSend's DLR/inbound webhook payload shapes are not fully documented on the official pages (parse with tolerant zod schemas + a poll-based reconciliation fallback), and ClickSend's account-level automatic STOP handling may intercept STOP replies before your webhook sees them (must be verified empirically; our `suppressed_contacts` stays canonical either way).

One schema-level fact matters for planning: there is **no inbound-messages table anywhere in the schema** — Phase 4 must add one (plus DLR columns/table for delivery receipts), and it must follow the established evidence-table conventions (tenant_id column, RLS via `has_tenant_access`, no FK cascade from tenants, read-only to `authenticated`).

**Primary recommendation:** Build the ClickSend SMS path end-to-end first (send → DLR → inbound → STOP → threading), reusing the D-13 seam and D-16 controls untouched; build the email send path (Resend, verified-domain-or-subdomain-fallback, unsubscribe headers + endpoint) as a parallel plan; leave email *inbound* as a reply-to decision surfaced to discuss-phase.

## Project Constraints (from CLAUDE.md)

- **Stack locked:** TypeScript, Next.js 16 App Router route handlers as webhook receivers, Supabase Sydney Postgres via drizzle, Vercel. No new deployment target.
- **ClickSend via direct `fetch`** — explicitly do NOT use ClickSend's generated Node SDK ("auto-generated, poorly maintained"). Thin typed wrapper + zod.
- **Resend** for email (Pro plan, 10 verified domains); `resend` SDK already a dependency (6.22.1).
- **Dedicated AU virtual number(s), never alphanumeric sender IDs** — alpha tags can't receive replies and require per-business ACMA Sender ID Register approval (live since 1 July 2026). v1: **one dedicated number shared across founding clients**, reply attribution by recipient phone number + active-cadence lookup; tradie identified by name in message copy.
- **Email pattern:** send from a service-owned subdomain (e.g. `quotes.<service>.com.au`) with reply-to the tradie's address; per-client verified domains as the default path when clients supply DNS.
- **No pgmq unless forced:** Phase 3 decision — touches-table-as-queue + ledger unique index; "revisit pgmq in Phase 4 only if ClickSend latency or retry semantics demand decoupled workers." Research finding: they don't (see Patterns).
- **No `waitUntil` for sends** — sends are must-happen work recorded in the ledger.
- **Free-text LLM classification parsing banned** — but note Phase 4 does NOT classify; MSG-03's STOP handling is regex-only and AI-02 classification is Phase 5.
- **zod everywhere data crosses a boundary** — webhook payloads are the canonical case.
- **Compliance:** Spam Act sender ID + functional opt-out on every message; DNCR contact-hours discipline already enforced by dispatch; AU data residency honesty (Resend has no Sydney region — see Pitfall 6).
- **GSD workflow:** all edits via GSD commands; drizzle-kit journal-ordering trap is a known repeated failure (STATE.md) — watch migration ordering.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MSG-01 | SMS send/receive via dedicated AU number(s), two-way replies + delivery receipts recorded per message | ClickSend send/DLR/inbound API facts (Standard Stack, Code Examples); `send_ledger.provider_message_id` + `custom_string` reconciliation pattern; IPND blocker sequencing (Environment Availability) |
| MSG-02 | Email via verified client domain (or service-subdomain fallback), SPF/DKIM, Spam Act sender ID + functional unsubscribe | Resend domains API + DNS records; List-Unsubscribe/One-Click headers; Spam Act rules (30-day functional unsubscribe, 5-business-day actioning, authorising-business identification) |
| MSG-03 | Deterministic STOP/unsubscribe regex before any LLM, cross-channel suppression, immediate effect at send gate | STOP regex pattern (Patterns §4); `killContact`-style both-channel suppression write; dispatch already re-checks `suppressed_contacts` JIT (`src/core/cadence/dispatch.ts:381-392`) so "immediate at the send gate" is already structural |
| MSG-04 | Outbound identifies client business; inbound threads to correct tenant/contact/quote; ambiguity → human triage | Shared-number attribution algorithm (Patterns §5); cadence contact snapshot as threading identity (`cadences.contact_mobile/contact_email`); triage-not-guess routing rules |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SMS/email send execution | Backend (`src/core/messaging/*`, framework-free) | — | Invoked by dispatch after ledger claim; same tier as StubSender it replaces |
| Send gating (suppression, window, pause) | Database + backend (dispatch claim transaction) | — | Already built in Phase 3; Phase 4 must NOT re-implement any gate |
| DLR ingestion | API route handler (`/api/webhooks/clicksend/...`) | Backend core function | Route parses/authenticates; a framework-free core function does the ledger write (established sync-webhook pattern) |
| Inbound SMS ingestion + threading | API route handler → backend core | Database (new `inbound_messages` table) | Attribution logic must be testable without HTTP; route stays thin |
| STOP regex + suppression write | Backend core (pure function + D-16-style transaction) | — | Deterministic, pre-LLM by requirement; writes through same tables as `killContact` |
| Unsubscribe endpoint (email) | API route handler (GET confirmation + POST one-click) | Backend core suppression write | Public, unauthenticated-by-token endpoint; token verification is `node:crypto` HMAC |
| Domain verification records surface | Console page (server components/actions) | Resend API | Operator-only; shows DNS records + verification status per client |
| Reply triage surface (minimal) | Console page | — | MSG-04 "ambiguous → human triage" needs somewhere to land before Phase 6's full console |
| Delivery-receipt reconciliation sweep | pg_cron-triggered or piggybacked on cadence tick | ClickSend REST (poll) | Webhook is the hint; poll is the guarantee (mirrors SYNC-03 philosophy) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` + zod wrapper | (built-in) | ClickSend REST client | CLAUDE.md directive; ClickSend API is simple Basic-auth REST `[CITED: developers.clicksend.com/docs/messaging/sms/other/send-sms]` |
| `resend` | 6.22.1 already installed (6.24.0 latest on npm 2026-08-28) | Email send, domains API, webhook verify | Already in production for operator alerts (`src/core/alerts/operator-email.ts` imports `Resend` from `'resend'`) `[VERIFIED: package.json dependency "resend": "6.22.1"; npm view resend version → 6.24.0]` |
| `zod` | 4.4.3 (installed) | Webhook payload validation, env | Existing boundary-validation convention `[VERIFIED: package.json]` |
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 (installed) | New tables + migrations | Sole migration authority (Phase 1 decision) `[VERIFIED: package.json]` |
| `node:crypto` | built-in | Unsubscribe-token HMAC, constant-time compares | Already used for credential encryption (`src/core/shared/crypto.ts` exists) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `svix` | 2.1.0 | Resend webhook signature verification | **Only if** `resend@6.22.1`'s `resend.webhooks.verify()` turns out absent at that version — check the installed SDK first; prefer zero new deps `[ASSUMED: verify() presence at 6.22.1 unconfirmed]` |
| `@react-email/components` | not installed | Email templates with Spam Act footer | Optional — plain HTML string templates are acceptable at Phase 4 volume; CLAUDE.md lists it but the operator-alert email already ships as inline HTML without it |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ClickSend | Twilio | Better SDK/signed webhooks, ~8c/SMS, but **hits the same IPND address requirement** — not a workaround for the real blocker `[VERIFIED: docs/external-registrations.md:72-76 "Twilio's AU regulatory bundle also requires a verified Australian address"]` |
| Resend Inbound for email replies | Reply-To the tradie's own address | Reply-To is the CLAUDE.md-decided pattern (zero build, replies land where the tradie already works) but the system never sees email replies → no pause-on-reply, no threading for email. Surface to discuss-phase (Open Question 1) |
| Touches-table queue (keep) | pgmq | ClickSend send is a single synchronous HTTP POST returning `message_id` inline; no async job semantics to absorb. Retry policy is "never auto-resend" by product rule, so visibility-timeout retry is actively unwanted. Keep Phase 3 architecture |

**Installation:**
```bash
# No mandatory new packages. If svix proves necessary:
npm install svix@2.1.0
```

**Version verification (run 2026-08-28):** `npm view resend version` → 6.24.0; `npm view svix version` → 2.1.0. Neither declares a postinstall script (`npm view <pkg> scripts.postinstall` → empty for both).

## Package Legitimacy Audit

Seam: `gsd-tools query package-legitimacy check --ecosystem npm svix resend` (run 2026-08-28).

| Package | Registry | Latest publish | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `resend` | npm | 2026-08-26 (latest release) | 10.3M/wk | github.com/resend/resend-node | [SUS: "too-new" latest release] | **Already installed at 6.22.1 and running in production** — no new install this phase; do not upgrade unless a needed API is missing. If upgrading, planner adds checkpoint:human-verify |
| `svix` | npm | 2026-08-25 (latest release) | 6.1M/wk | github.com/svix/svix-webhooks | [SUS: "too-new" latest release] | Optional dep. Prefer built-in `resend.webhooks.verify()`. If installed, **pin 2.1.0** and planner adds checkpoint:human-verify before install |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `resend` (upgrade only), `svix` (optional install) — both verdicts are the seam's "too-new" heuristic firing on days-old *latest releases* of long-established, multi-million-download official packages; the risk is a compromised recent release, so pinning the already-vetted installed version (`resend@6.22.1`) is the mitigation, and any version bump or new install gets a `checkpoint:human-verify`.

## Architecture Patterns

### System Architecture Diagram

```
                         OUTBOUND                                        INBOUND
┌─────────────┐   ┌──────────────────────┐                  ┌───────────────────────────────┐
│ cadence-tick │──▶│ dispatch.ts          │                  │ Customer phone / mail client  │
│ (pg_cron,    │   │ claim ledger row     │                  └──────┬────────────────┬───────┘
│  per-minute) │   │ JIT: suppression,    │                     SMS reply         email reply
└─────────────┘   │ pause, window, quote │                        │                │ (path per Open Q1)
                   └─────────┬────────────┘                        ▼                ▼
                             │ SendRequest (body, to, ledgerId)  ClickSend       Resend Inbound
                             ▼                                   inbound rule    (email.received)
                   ┌─────────────────────┐                       (action=URL)    or Reply-To tradie
                   │ TouchSender impls    │                          │            (system never sees it)
                   │  ClickSendSender ────┼──▶ POST /v3/sms/send     │
                   │  ResendSender ───────┼──▶ resend.emails.send    ▼
                   └─────────┬───────────┘        ┌────────────────────────────────────┐
                             │ SendOutcome        │ /api/webhooks/clicksend/inbound    │
                             ▼                    │  1. auth: secret token in URL       │
                   ┌─────────────────────┐        │  2. zod-parse (tolerant)            │
                   │ send_ledger          │        │  3. STOP regex (BEFORE anything)   │
                   │ outcome, provider_   │        │     match → suppress BOTH channels │
                   │ message_id           │        │     via cadence snapshot + stop    │
                   └─────────▲───────────┘        │  4. thread: to-number → from-number │
                             │ reconcile           │     → live cadence lookup           │
              ┌──────────────┴───────┐             │     unique hit → store + pauseFor-  │
              │ /api/webhooks/       │             │     Reply; ambiguous/none → triage  │
              │ clicksend/dlr        │             │  5. store inbound_messages row      │
              │ (custom_string =     │             └────────────────────────────────────┘
              │  ledger id)          │
              └──────────▲───────────┘             ┌────────────────────────────────────┐
                         │                         │ /api/unsubscribe (public)          │
                   ClickSend DLR rule              │ GET: confirm page  POST: one-click │
                   (action=URL)                    │ HMAC token → suppress both channels│
                                                   └────────────────────────────────────┘
```

Trace the primary case: cadence-tick claims a due touch → dispatch revalidates and claims the ledger → `ClickSendSender.send()` POSTs to ClickSend with `custom_string = ledgerId` → outcome written to ledger → DLR webhook later updates delivery status against `custom_string`/`provider_message_id` → customer replies → inbound webhook runs STOP regex, threads by number, pauses the cadence, stores the message.

### Recommended Project Structure

```
src/
├── core/
│   ├── messaging/                  # NEW — framework-free, mirrors core/cadence conventions
│   │   ├── clicksend-client.ts     # thin typed fetch wrapper (Basic auth), zod-parsed responses
│   │   ├── clicksend-sender.ts     # TouchSender impl, provider = 'clicksend'
│   │   ├── resend-sender.ts        # TouchSender impl, provider = 'resend' (+ compliance footer/headers)
│   │   ├── stop-keywords.ts        # THE deterministic regex + unit tests (pure)
│   │   ├── inbound.ts              # threading/attribution + STOP handling (calls D-16 controls)
│   │   ├── receipts.ts             # DLR application to send_ledger + reconciliation poll
│   │   └── unsubscribe-token.ts    # HMAC mint/verify (pure, node:crypto)
│   ├── cadence/                    # touched minimally:
│   │   ├── dispatch.ts             # swap StubSender wiring only (sender chosen per channel)
│   │   └── controls.ts             # ADD the pause-or-upgrade write (carried-forward gap)
├── db/schema/
│   ├── inbound-messages.ts         # NEW evidence table
│   └── send-ledger.ts              # extended: delivery status columns (or sibling receipt table)
└── app/api/
    ├── webhooks/clicksend/inbound/route.ts   # token-authed, zod boundary
    ├── webhooks/clicksend/dlr/route.ts
    ├── webhooks/resend/route.ts              # svix-verified (email events; inbound if chosen)
    └── unsubscribe/route.ts                  # public GET+POST, token-authed
```

### Pattern 1: The sender swap is a wiring change, not a dispatch change

The `TouchSender` contract is explicit and complete — `SendRequest` carries `ledgerId`, `tenantId`, `quoteId`, `cadenceId`, `touchNumber`, `channel`, normalized `to.address`, `body`; `SendOutcome` is a non-throwing union `{ kind: 'sent', provider, providerMessageId }` | `{ kind: 'failed', provider, reason, retryable }` `[VERIFIED: src/core/cadence/sender.ts:49-78]`. Dispatch already maps outcomes: `outcome.kind === 'failed' ? 'failed' : outcome.provider === 'stub' ? 'stub_sent' : 'sent'` `[VERIFIED: src/core/cadence/dispatch.ts:473-474]` — so a real sender's rows are automatically distinguishable (`SEND_LEDGER_OUTCOMES = ['stub_sent', 'sent', 'failed']`, `[VERIFIED: src/db/schema/send-ledger.ts:79]`). The one wiring decision Phase 4 must make: dispatch takes ONE `sender` in `DispatchOptions` but Phase 4 has TWO providers keyed by channel — introduce a channel-routing `TouchSender` (`provider` written per delegate, not as a composite name, so `send_ledger.sender` stays `'clicksend' | 'resend'` per D-13).

**Never** add retry to a failed/thrown send: "outcome left NULL — surfaced to the operator, never auto-resent" `[VERIFIED: src/core/cadence/dispatch.ts:453-466]`. `retryable` informs the *operator surface*, not an automatic loop.

### Pattern 2: Webhook receivers follow the sync-webhook conventions

The codebase already has one inbound webhook (`src/app/api/webhooks/servicem8/route.ts`) and two secret-authed tick routes. Established rules that apply verbatim: routes own their auth (proxy.ts excludes `api/` entirely — a 307 to /login reads as success to a webhook sender `[VERIFIED: STATE.md decision]`); `export const runtime = 'nodejs'` and explicit `maxDuration` `[VERIFIED: src/app/api/internal/cadence-tick/route.ts:63-66]`; per-provider bearer/secret, never shared (the CADENCE_TICK_SECRET vs SYNC_TICK_SECRET rotation argument `[VERIFIED: src/core/shared/env.ts:35-44]`); response bodies enumerate fields, never spread internal results (T-3-24); never log customer addresses (T-2-02 — dispatch deliberately logs ids only `[VERIFIED: src/core/cadence/dispatch.ts:459-465]`).

ClickSend-specific: **no documented webhook signing** `[ASSUMED — searched official docs + help center; nothing found; absence not proven]`. Mitigation: unguessable secret in the webhook URL (`?token=<CLICKSEND_WEBHOOK_SECRET>`, constant-time compare), treat every payload as untrusted input, and (for DLRs) apply updates only where `custom_string`/`message_id` matches an existing ledger row — a forged DLR can then only annotate a real send, and a forged inbound can at worst create a triage item or a suppression (fail-safe direction: suppressing is always safe, sending is not).

Resend-specific: webhooks are Svix-signed — verify `svix-id`, `svix-timestamp`, `svix-signature` against the **raw request body** with the endpoint's `webhookSecret` `[CITED: resend.com/docs/dashboard/webhooks/verify-webhooks-requests]`.

### Pattern 3: Delivery receipts reconcile against the ledger; webhook is the hint, poll is the guarantee

Send with `custom_string` set to the ledger id — ClickSend echoes it in receipts and inbound-linked records (`custom_string` appears on both send and inbound objects `[CITED: developers.clicksend.com/docs/messaging/sms/other/send-sms, /view-inbound-sms]`). Store the returned `message_id` in `send_ledger.provider_message_id` — that column exists for exactly this `[VERIFIED: src/db/schema/send-ledger.ts:110]`. DLR rule: `POST /v3/automations/sms/receipts` with `action: 'URL'`, `action_address`, `webhook_type: 'json'` `[CITED: developers.clicksend.com/docs/automations/sms/other/view-sms-delivery-receipt-rules]`. Because the push payload shape is under-documented (see Pitfall 1), also poll `GET /v3/sms/history` (or receipts listing) on a daily reconciliation sweep to catch missed DLRs — the same hint-vs-guarantee split SYNC-03 uses.

Schema note: delivery status ("delivered"/"undelivered" + timestamps) is a *new fact about a send*, arriving after `outcome` is already `'sent'`. Do not overload `SEND_LEDGER_OUTCOMES` — `outcome` records what the provider said at hand-off. Add nullable columns (`delivery_status`, `delivered_at`, `delivery_error`) or a sibling `delivery_receipts` table; nullable-with-NULL-meaning-unknown follows the ledger's own D-13 philosophy.

### Pattern 4: STOP is a pure, anchored, exact-message regex — and it writes both channels

MSG-03 verbatim: deterministic regex before any LLM. Standard opt-out keyword set (CTIA/industry + AU convention): STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT / OPT-OUT / OPTOUT `[ASSUMED — industry convention; no single AU statutory keyword list exists]`. Anchored to the whole trimmed message so "please don't stop by" never suppresses:

```typescript
// pure, exhaustively unit-testable
const STOP_REGEX = /^\s*(stop( ?all)?|unsubscribe|cancel|end|quit|opt[ -]?out)\s*[.!]?\s*$/i;
export const isStopMessage = (body: string): boolean => STOP_REGEX.test(body);
```

On match: suppress **both** the mobile the STOP came from AND the paired email of the same human (MSG-03 spans channels). The mechanism already exists: resolve the human via the cadence contact snapshot and write both `suppressionEntriesFor`-style entries + stop the cadence — exactly `killContact`'s transaction shape with `source: 'sms_stop'` (`suppressed_contacts.source` documents `'sms_stop'` as the planned Phase 4 writer `[VERIFIED: src/db/schema/suppressed-contacts.ts:97-103]`). Addresses written verbatim from the cadence snapshot, never re-normalized `[VERIFIED: src/core/cadence/controls.ts:157-166]`. "Immediate at the send gate" requires no new gate: dispatch re-probes `suppressed_contacts` inside every claim transaction `[VERIFIED: src/core/cadence/dispatch.ts:377-392]`.

A STOP that matches **no** cadence still suppresses the bare mobile (single channel — we know no paired email) and lands in triage; refusing to record an opt-out because we can't thread it is the one wrong answer.

### Pattern 5: Shared-number inbound attribution — unique hit or triage, never a guess

v1 has ONE dedicated number across clients, so `to` doesn't identify the tenant. Attribution algorithm (deterministic, ordered):

1. Normalize `from` with the existing `normalizeAuMobile` (`[VERIFIED: src/core/cadence/primary-contact.ts:129]` — reuse, don't re-implement).
2. Look up cadences where `contact_mobile = from` across all tenants, `status IN ('active','paused')` first, then recently-stopped as fallback evidence.
3. **Exactly one** live cadence → thread to its `(tenant_id, quote_id, cadence_id)`; store inbound row; call `pauseForReply` (already exported for precisely this caller `[VERIFIED: src/core/cadence/controls.ts:497-520]`).
4. **Zero or multiple** matches → store as unattributed/ambiguous, route to human triage. MSG-04's success criterion is explicit: ambiguity goes to triage, never a guess — the D-04 snapshot exists because "reply threading (Phase 4) … need[s] a stable 'one human per cadence' identity" `[VERIFIED: src/db/schema/cadences.ts:111-120]`.

STOP processing (Pattern 4) runs BEFORE attribution branching: an opt-out from an ambiguous number still gets recorded (against every matching tenant's list, or bare-address if none — over-suppressing across candidate tenants is the compliant failure mode; note the privacy consideration in Open Question 3).

### Pattern 6: The carried-forward pause-or-upgrade write is in-scope, not optional

`pauseForReply` returns `upgrade_unsupported` for `paused(client_paused)` + `customer_reply` because `pauseWhereActive` only pauses from `'active'` — deliberately, so re-pausing can't downgrade a `customer_reply` pause. The matrix prescribes the upgrade and "Phase 4 owns it" `[VERIFIED: src/core/cadence/controls.ts:462-483]`. The fix is one guarded repository write (e.g. `upgradePauseReasonWhere(cadenceIds, { from: 'client_paused', to: 'customer_reply' })` with the WHERE clause as the guard, matching house style), then `pauseForReply` performs it instead of reporting `upgrade_unsupported`. Without it, a client's own resume can restart messaging at somebody mid-conversation — D-05 breached from the other direction.

### Pattern 7: Email sends carry compliance in the template, unsubscribe in the headers

Every outbound email: identifies the client business (legal name + contact) in the footer, states it's sent on behalf of the tradie (Spam Act: messages sent on someone's behalf must identify the authorising business `[CITED: acma.gov.au/avoid-sending-spam]`), and carries a working unsubscribe both as a visible footer link and as headers:

```typescript
// Source: resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails
await resend.emails.send({
  from: 'Dave\'s Plumbing via QuoteRecovery <quotes@quotes.example.com.au>',
  to: [request.to.address],
  replyTo: tradieEmail,               // decided pattern; see Open Question 1
  subject,
  html,
  headers: {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
});
```

Unsubscribe endpoint contract: GET renders a confirmation page; POST (one-click, no body semantics guaranteed) suppresses immediately and returns 200/202 `[CITED: resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails]`. The URL carries an HMAC token minted per send over `(tenant_id, channel-addresses, key-version)` — no login, no lookup-by-guessable-id, valid ≥ 30 days (Spam Act: unsubscribe functional at least 30 days, actioned within 5 business days `[CITED: acma.gov.au/avoid-sending-spam; sprintlaw.com.au Spam Act guides]` — our suppression is instant, comfortably inside). Suppression write: both channels of the human, `source: 'email_unsubscribe'` (a third source value; column is free text by design `[VERIFIED: src/db/schema/suppressed-contacts.ts:97-103]`).

### Anti-Patterns to Avoid

- **Re-implementing any gate in the sender or webhook:** suppression/pause/window checks live in dispatch's claim transaction. A sender that re-checks is a second answer to a settled question.
- **Auto-resending failures or NULL-outcome rows:** the product rule is structural; `retryable` is operator information.
- **Composite provider names in `send_ledger.sender`:** the column contract is `'stub' | 'clicksend' | 'resend'` verbatim `[VERIFIED: src/core/cadence/sender.ts:75]`.
- **Substring STOP matching:** "can't stop thinking about the quote" is a hot lead, not an opt-out.
- **Trusting webhook payloads for anything not verifiable:** unsigned ClickSend payloads only annotate existing ledger rows or create triage items; they never directly trigger a send.
- **Suppressing under a re-normalized spelling:** probe-time strings must equal write-time strings (the 03-controls verbatim rule).
- **Alpha-tag sender IDs:** relitigated and decided; register regime + no replies.
- **Logging inbound bodies or addresses in route/console logs:** platform logs have no tenant scoping (T-2-02 rule, applied at the new boundary — inbound bodies are customer content).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email deliverability (SPF/DKIM/DMARC signing) | Own SMTP/signing | Resend domains API (returns SPF TXT `v=spf1 include:amazonses.com ~all`, DKIM CNAMEs, MX per domain) `[CITED: resend.com/docs/api-reference/domains/create-domain]` | Reputation management is a full-time job |
| Webhook signature verification (Resend) | Own HMAC parser | `resend.webhooks.verify()` / svix `Webhook.verify` | Timestamp tolerance + replay protection already solved |
| AU mobile normalization | New normalizer | `normalizeAuMobile` / `normalizeEmail` `[VERIFIED: src/core/cadence/primary-contact.ts:129,144]` | Suppression keying depends on ONE spelling; two normalizers = two spellings |
| Suppression/pause/stop writes | Inline UPDATEs in webhook routes | D-16 controls (`killContact`-shaped transaction, `pauseForReply`) | "The second expression of 'stop chasing this person' is the one that gets a condition wrong" `[VERIFIED: src/core/cadence/controls.ts:12-15]` |
| Send dedup / idempotency | Provider-side dedup config | `send_ledger` unique index (already exists) | CAD-04 is enforced by Postgres, not by the provider |
| One-click unsubscribe semantics | Custom scheme | RFC 8058 headers (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`) | Gmail/Yahoo enforcement expects the standard shape |

**Key insight:** Phase 3 already hand-rolled (correctly, once) everything stateful. Phase 4's value is thin adapters at two HTTP boundaries; every time Phase 4 code wants to write cadence/suppression state directly, the correct move is calling or extending `controls.ts`.

## Common Pitfalls

### Pitfall 1: ClickSend's webhook payloads are under-documented
**What goes wrong:** DLR and inbound push payload shapes are not fully specified on official docs pages (confirmed by fetching them); community sources suggest DLR fields `timestamp_send, timestamp, message_id, status_code, status_text, error_code, error_text, custom_string, subaccount_id, message_type` and inbound example `{"timestamp_send":..., "from":"+61...", "body":"..."}` with `webhook_type` changing format (post=form-encoded, get=query params, json=JSON POST) `[ASSUMED — aggregated from search results, not official field tables]`. A strict zod schema written from guesses rejects real traffic silently.
**How to avoid:** `webhook_type: 'json'`; tolerant zod (`.passthrough()`, most fields optional, hard-require only what's acted on: `from`/`body` for inbound, `custom_string` or `message_id` for DLR); log unknown-shape payloads (metadata only, no body/address values) to a dead-letter row for inspection; use `POST /v3/sms/inbound` (test inbound endpoint `[CITED: developers.clicksend.com/docs/messaging/sms/other/create-test-inbound-sms]`) to capture the real shape before any live traffic.
**Warning signs:** inbound webhook 200s but no `inbound_messages` rows; DLRs arriving with zero ledger matches.

### Pitfall 2: ClickSend's own opt-out system races yours
**What goes wrong:** ClickSend auto-processes STOP at account level, moving the number to ClickSend's opt-out list and **blocking future sends from their side** `[CITED: help.clicksend.com/en/articles/42308-understanding-opt-outs]`. Whether the STOP still reaches your URL inbound rule is undocumented `[ASSUMED]`. Two failure modes: (a) STOP never reaches you → your `suppressed_contacts` misses the opt-out and your compliance evidence has a hole even though sends fail; (b) their list and yours drift → sends fail as provider errors with no recorded reason.
**How to avoid:** verify empirically with a real STOP during number onboarding (make this an explicit checkpoint task); keep an inbound reconciliation poll of `GET /v3/sms/inbound` so a swallowed webhook still lands; treat a ClickSend send failure whose error indicates opt-out as a suppression signal to record. If ClickSend supports disabling/tuning auto-opt-out per account, prefer our regex as primary and theirs as backstop — ask support while the IPND ticket is open.
**Warning signs:** `send_ledger` rows failing for a contact with no `suppressed_contacts` row.

### Pitfall 3: The IPND blocker sequencing trap
**What goes wrong:** Planning the phase as "provision number → build" stalls everything on a support ticket (blocked since 2026-08-25, both providers need an AU street address `[VERIFIED: docs/external-registrations.md:59-95]`).
**How to avoid:** invert the order. All senders, webhooks, STOP handling, threading, schema, unsubscribe, and email path are buildable and testable now (test-inbound endpoint; DLR/inbound rules configurable per `'*'` wildcard number; email needs no number at all). Isolate "purchase number, point rules at prod URL, live two-way test" as the final, blocking-tagged plan. Number config (the sending `from` number) belongs in DB/env config, not code, so the unblock is an ops step.
**Warning signs:** any plan's first task says "buy the number."

### Pitfall 4: Threading by `quote_contacts` instead of the cadence snapshot
**What goes wrong:** `quote_contacts` rows are per-job mirrors that re-sync and get replaced; matching a reply against them binds a conversation to a row that may vanish next poll.
**How to avoid:** the cadence snapshot (`contact_mobile`/`contact_email`) is the designed threading identity `[VERIFIED: src/db/schema/cadences.ts:111-120]`. Match replies against cadences, not contacts.
**Warning signs:** replies attributed to quotes with no cadence; attribution changing after a sync.

### Pitfall 5: A one-per-channel sender wired as one-for-all
**What goes wrong:** `DispatchOptions.sender` is singular; naive wiring sends email touches through ClickSend (refused, `failed` rows) or requires touching dispatch's signature (a D-13 "costly to change" contract).
**How to avoid:** channel-routing composite implementing `TouchSender`, delegating on `request.channel`, reporting the delegate's `provider`. Dispatch signature untouched.
**Warning signs:** ledger rows with `channel='email'`, `sender='clicksend'`.

### Pitfall 6: AU-residency honesty breaks silently with email
**What goes wrong:** Resend's regions are `us-east-1 | eu-west-1 | sa-east-1 | ap-northeast-1` — **no Australian region** `[CITED: resend.com/docs/api-reference/domains/create-domain]`. Claiming blanket AU residency in sales copy becomes false the moment email ships.
**How to avoid:** pick a region deliberately (`ap-northeast-1` nearest); keep the CLAUDE.md-scripted honest note: DB/auth AU-resident, message-processing vendors offshore. Not a code task, but a sales-copy consequence the operator must hear — surface in discuss/verify.
**Warning signs:** none in code — this one only shows up in a client conversation.

### Pitfall 7: Unsubscribe endpoint as a suppression oracle
**What goes wrong:** a public endpoint that accepts an address or bare id lets anyone suppress anyone (DoS on the product: silently stop a competitor's follow-ups), or — with verbose errors — probe which addresses are in the system.
**How to avoid:** token = HMAC over the suppression payload minted at send time; endpoint accepts ONLY the token, responds identically for valid-and-suppressed vs invalid (suppression success page either way, no state disclosure); constant-time verification. Key in env (`UNSUBSCRIBE_SIGNING_SECRET`, own secret per the two-bearer rotation precedent).
**Warning signs:** unsubscribe URL contains a readable email/uuid; distinct error pages.

### Pitfall 8: drizzle-kit journal ordering (house-known)
**What goes wrong:** `drizzle-kit generate` stamps entries behind the journal head; `migrate` silently skips them — fired on 3 consecutive Phase 2 plans `[VERIFIED: STATE.md tooling blocker]`.
**How to avoid:** Phase 4 adds at least one migration (inbound_messages + ledger columns + any CHECKs); run the monotonicity guard test after every generate; parallel plans must not both generate migrations in the same wave.

## Code Examples

### ClickSend send (thin typed client)
```typescript
// Source: developers.clicksend.com/docs/messaging/sms/other/send-sms
// POST https://rest.clicksend.com/v3/sms/send — HTTP Basic auth (username + API key)
const res = await fetch('https://rest.clicksend.com/v3/sms/send', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messages: [{
      to: request.to.address,          // +614... (already normalized upstream)
      from: dedicatedNumber,           // the provisioned AU virtual number
      body: request.body,              // copy identifies the tradie by name (Spam Act)
      source: 'quote-recovery',
      custom_string: request.ledgerId, // echoes back on receipts → reconciliation key
    }],
  }),
});
// 200 → data.messages[0].message_id (→ send_ledger.provider_message_id), .status
// Non-2xx / per-message error status → { kind: 'failed', reason, retryable } — NEVER throw
```

### ClickSend inbound + DLR rules (one-time setup, scripted like cron:apply)
```typescript
// Source: developers.clicksend.com/docs/automations/sms/other/create-sms-inbound-automation
// POST /v3/automations/sms/inbound
{
  dedicated_number: '*',        // all numbers ("Can be '*' to apply to all numbers")
  rule_name: 'inbound-to-gateway',
  message_search_type: 0,       // 0 = Any message — STOP filtering is OURS, not theirs
  message_search_term: '',
  action: 'URL',
  action_address: 'https://<prod>/api/webhooks/clicksend/inbound?token=<secret>',
  enabled: 1,
  webhook_type: 'json',
}
// DLR rule: POST /v3/automations/sms/receipts — rule_name, match_type, action: 'URL',
// action_address (same token pattern), enabled, webhook_type
// Test without a number: POST /v3/sms/inbound (create test inbound SMS)
```

### Resend webhook verification
```typescript
// Source: resend.com/docs/dashboard/webhooks/verify-webhooks-requests
const raw = await request.text(); // RAW body — signature is byte-sensitive
// preferred (check availability in resend@6.22.1):
resend.webhooks.verify({ payload: raw, headers: {
  'svix-id': ..., 'svix-timestamp': ..., 'svix-signature': ... }, webhookSecret });
// fallback: new Webhook(secret).verify(raw, headers)  // svix package
```

### The pause-or-upgrade repository write (shape sketch — the gap Phase 4 closes)
```typescript
// Guard-as-WHERE-clause, matching pauseWhereActive/resumeWherePaused house style:
// UPDATE cadences SET pause_reason = 'customer_reply', updated_at = now()
// WHERE id = ANY($ids) AND tenant_id = $tenant
//   AND status = 'paused' AND pause_reason = 'client_paused'
// RETURNING id;
// pauseForReply then: active → pauseWhereActive; paused(client_paused) → upgrade write;
// paused(customer_reply) → no-op 'paused'; terminal → 'not_active'.
```
Vocabulary values used above are verbatim from schema: `CADENCE_PAUSE_REASONS = ['customer_reply', 'client_paused']` `[VERIFIED: src/db/schema/cadences.ts:176]`; `CADENCE_STATUSES = ['active','paused','stopped','completed','expired']` `[VERIFIED: src/db/schema/cadences.ts:156-162]`. Note migration 0017 CHECK-constrains these columns — new `suppressed_contacts.source` values are safe (free text, no CHECK `[VERIFIED: src/db/schema/suppressed-contacts.ts:96-103]`), but any new stop/pause/skip vocabulary member needs a migration.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Alphanumeric sender IDs for AU SMS | Registered via ACMA Sender ID Register or overstamped "Unverified"/blocked | 1 July 2026 | Dedicated virtual numbers are the only viable two-way path (already decided) |
| Resend = send-only | Resend Inbound: `email.received` webhook + Received Emails API, per-domain `capabilities.receiving` | ~Nov 2025 `[CITED: resend.com/blog/inbound-emails]` | Email reply capture on a service domain is now possible without SendGrid/Postmark inbound parse — changes the Open Question 1 tradeoff |
| Unsubscribe = footer link only | RFC 8058 one-click headers enforced by Gmail/Yahoo for bulk senders | Feb 2024, ratcheting since | Include headers from day one; volume will cross thresholds per-domain eventually |
| — | ClickSend `webhook_type` payload format options (post/get/json) | changelog "support for more webhook payload formats" | Pin `json` explicitly rather than relying on a default |

**Deprecated/outdated:** nothing in this phase's path; `resend.dev` onboarding sender restriction (only account-owner recipient pre-verification) remains true and is why domain verification must precede any client-facing email `[VERIFIED: src/core/alerts/operator-email.ts:40-47 comment]`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ClickSend DLR push payload contains `timestamp_send, timestamp, message_id, status_code, status_text, error_code, error_text, custom_string, subaccount_id, message_type` | Pitfall 1 | Reconciliation misses; mitigated by tolerant zod + test-capture + poll sweep |
| A2 | ClickSend inbound URL push carries at least `from`, `body`, `to`, `message_id`, `timestamp` | Pitfall 1 | Threading fails; same mitigation |
| A3 | STOP replies still reach a URL inbound rule despite ClickSend's automatic opt-out processing | Pitfall 2 | Our suppression list gains a hole; mitigated by poll reconciliation + onboarding checkpoint STOP test + treating provider opt-out send-failures as suppression signals |
| A4 | ClickSend webhooks are unsigned (no signature mechanism found in official docs) | Pattern 2 | If signing exists, we're leaving free security on the table — check dashboard during number onboarding |
| A5 | `resend@6.22.1` includes `webhooks.verify()` | Standard Stack | Fall back to `svix@2.1.0` (pinned, checkpointed) or upgrade resend (checkpointed) |
| A6 | STOP keyword set (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT/OPT-OUT) is sufficient for AU compliance | Pattern 4 | ACMA has no statutory keyword list; regex is easily extended; visible "Reply STOP to opt out" instruction in copy makes STOP the dominant real-world token |
| A7 | One shared dedicated number across founding clients is acceptable until customer-overlap (CLAUDE.md decided, but per-client cost ~AUD $20.71/mo estimate unconfirmed while purchase is blocked) | Environment | Overlapping customers make attribution ambiguous more often → more triage, still never a guess |
| A8 | ClickSend test-inbound endpoint (`POST /v3/sms/inbound`) triggers inbound automation rules (docs page truncated on this) | Pitfall 3 | If it only creates a pollable record, live-shape capture waits for the real number; build against tolerant schemas either way |

## Open Questions (RESOLVED)

> All five questions were resolved at discuss-phase (2026-08-28): Q1 → CONTEXT.md D-01 (Reply-To tradie; Resend Inbound is the v2 trigger), Q2 → D-02 (pipe proven, templates stay Phase 5), Q3 → D-03 (suppress all candidate tenants + triage), Q4 → plan 04-07's scripted `setup-clicksend.mjs` activation, Q5 → D-04 (DB config table with global default + per-tenant overrides).

1. **Email replies: Reply-To the tradie (decided pattern) vs Resend Inbound capture?**
   - What we know: CLAUDE.md pattern = service-subdomain From + Reply-To tradie (replies bypass the system entirely). Resend Inbound now exists (`email.received`, per-domain `receiving` capability). MSG-04 says "every inbound message threads" — but the walking skeleton is SMS-only and every Phase 3 template is `sms`.
   - What's unclear: whether v1 needs system-visible email replies at all (pause-on-reply for email cadence touches can't fire if replies go straight to the tradie).
   - Recommendation: for discuss-phase. Default: keep Reply-To-tradie for v1 (zero build, tradie sees replies where they work); scope MSG-04's inbound-threading criterion to SMS + unsubscribe events for this phase, and record email-inbound as the v2 trigger. If the user wants email pause-on-reply now, Resend Inbound on the service subdomain is the build.
2. **Email touch templates don't exist yet** — every Phase 3 template is SMS (`[VERIFIED: STATE.md Phase 3 decision "every Phase 3 template is sms"]`). Does MSG-02 mean "the email pipe works" (provable via a test/ops send + domain verification) or "email touches flow in real cadences" (needs template/cadence-settings work that smells like ONB-03/Phase 5)? Recommendation: prove the pipe + compliance in Phase 4; template authoring stays Phase 5.
3. **Cross-tenant STOP on ambiguous numbers:** suppressing the number for ALL candidate tenants is compliance-safe but writes a suppression row into tenants whose customer may not have complained (mild cross-tenant information consideration; suppression reasons are operator-visible). Recommendation: suppress everywhere + triage note; confirm in discuss.
4. **Number provisioning ops:** if the IPND address lands mid-phase, who executes purchase + rule pointing? Recommendation: ship a scripted setup (`scripts/setup-clicksend.mjs` in the `cron:apply` mold) so the unblock is one command + one checkpoint.
5. **Where does the "shared number" config live?** Recommendation: a `messaging_numbers`/config row (or env for v1's single number) — but per-client numbers are the stated v2 direction, so prefer DB config keyed by tenant with a global default over a bare env var.

## Environment Availability

| Dependency | Required By | Available | Version/Status | Fallback |
|------------|------------|-----------|----------------|----------|
| ClickSend account + API key | MSG-01 send | Account exists; key not yet in env | — | None — but key issuance is not blocked, only the number |
| **Dedicated AU virtual number** | MSG-01 live two-way | **✗ BLOCKED** | IPND street-address requirement; ticket open 2026-08-25, next check 2026-09-01 `[VERIFIED: docs/external-registrations.md:59-69]` | Twilio = provider fallback only, same address wall. Sequencing fallback: build + test everything number-independent (Pitfall 3) |
| IPND-acceptable AU business address | Number purchase | ✗ | Candidates: ASIC registered address, IPND-acceptable virtual office, accountant's address `[VERIFIED: docs/external-registrations.md:84-91]` | None — operator action, highest-priority critical-path item |
| Resend account + API key | MSG-02, alerts | ✓ | `RESEND_API_KEY` required in env schema `[VERIFIED: src/core/shared/env.ts:54]` | — |
| Verified sending domain / service subdomain + DNS access | MSG-02 | ✗ (custom domain "not yet landed" per STATE ops note) | — | Resend onboarding sender is unusable for client mail (owner-only); domain verification is a hard prerequisite for any client-facing email |
| Vercel prod deployment (stable webhook URLs) | webhooks | ✓ | cadence-tick live, 3 consecutive 200s verified | ngrok/cloudflared for local webhook dev |
| Supabase (pg_cron, Sydney) | reconciliation sweep | ✓ | cron:apply pipeline working | — |
| Node/npm/vitest toolchain | all | ✓ | vitest 4.1.11, TS 5.9 | — |

**Missing with no fallback:** IPND address → number (blocks only the final live-SMS success-criterion evidence); DNS access to a service domain (blocks client-facing email sends).
**Missing with fallback:** none others.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (installed) |
| Config file | present (WR-09 disposable-stack gate on testEnv getters; 586 pure tests run on bare `npm test`) |
| Quick run command | `npm test -- <file>` |
| Full suite command | `npm test` (pure) / `npm run test:remote` (hosted Sydney DB — **pauses deployed crons via globalSetup; never overlap runs** per memory note) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MSG-01 | ClickSendSender maps API success/failure/non-2xx to SendOutcome union without throwing | unit (fetch mocked) | `npm test -- tests/clicksend-sender.test.ts` | ❌ Wave 0 |
| MSG-01 | DLR application: matching `custom_string`/`message_id` updates ledger; non-matching is a recorded no-op | integration (DB) | `npm run test:remote -- tests/receipts.test.ts` | ❌ Wave 0 |
| MSG-01 | Live two-way SMS on real number | manual-only — requires provisioned number (IPND-blocked); checkpoint:human-verify at phase end | — | — |
| MSG-02 | Email send includes List-Unsubscribe + List-Unsubscribe-Post headers, footer identifies client business + authorising service | unit (SDK mocked, template snapshot) | `npm test -- tests/resend-sender.test.ts` | ❌ Wave 0 |
| MSG-02 | Unsubscribe endpoint: valid token suppresses both channels; invalid token indistinguishable; GET vs POST semantics | integration | `npm run test:remote -- tests/unsubscribe.test.ts` | ❌ Wave 0 |
| MSG-03 | STOP regex: exhaustive keyword/punctuation/case matrix; non-STOP bodies never match | unit (pure) | `npm test -- tests/stop-keywords.test.ts` | ❌ Wave 0 |
| MSG-03 | STOP → both-channel suppression + cadence stop → next dispatch tick refuses `suppressed` | integration (extends existing enqueue→suppress→refuse suite) | `npm run test:remote -- tests/inbound-stop.test.ts` | ❌ Wave 0 |
| MSG-04 | Attribution: unique live-cadence match threads; zero/multiple → triage row, no pause, no guess | integration | `npm run test:remote -- tests/inbound-threading.test.ts` | ❌ Wave 0 |
| MSG-04 | pause-or-upgrade: `paused(client_paused)` + reply → `paused(customer_reply)`; client resume then does NOT revive | integration (closes the carried-forward matrix gap) | `npm run test:remote -- tests/pause-upgrade.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (pure suites, fast)
- **Per wave merge:** `npm run test:remote` (serialized — hosted DB is production-shared)
- **Phase gate:** full suite green + typecheck + lint before `/gsd-verify-work`; live-number UAT item explicitly carried as blocked-external if the IPND address hasn't landed

### Wave 0 Gaps
- [ ] `tests/stop-keywords.test.ts` — MSG-03 regex matrix
- [ ] `tests/clicksend-sender.test.ts`, `tests/resend-sender.test.ts` — MSG-01/02 outcome mapping
- [ ] `tests/inbound-threading.test.ts`, `tests/inbound-stop.test.ts` — MSG-03/04
- [ ] `tests/receipts.test.ts`, `tests/unsubscribe.test.ts`, `tests/pause-upgrade.test.ts`
- [ ] Framework install: none — Vitest present

## Security Domain

### Applicable ASVS Categories (L1, security_enforcement on)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (machine-to-machine) | Per-endpoint secrets: ClickSend token-in-URL (constant-time compare), Resend svix signatures, following the SYNC/CADENCE two-bearer precedent — one secret per webhook, never shared |
| V3 Session Management | no (no new human sessions) | — |
| V4 Access Control | yes | Tenant resolution happens server-side from verified data (cadence lookup), never from payload-claimed tenant ids; triage rows RLS-scoped like all evidence tables |
| V5 Input Validation | yes | zod at every webhook boundary (tolerant parse, strict on acted-upon fields); inbound bodies are untrusted content — stored, never interpolated into queries/logs/prompts (AI-03 groundwork) |
| V6 Cryptography | yes | HMAC-SHA256 unsubscribe tokens via `node:crypto` (existing crypto.ts conventions); never roll novel schemes |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged ClickSend webhook (unsigned) | Spoofing | URL secret + effects constrained to fail-safe writes (annotate existing ledger rows; create suppressions/triage — never sends); reconciliation poll detects fabricated inbound absent from `GET /v3/sms/inbound` |
| Forged DLR flipping delivery status | Tampering | Update only WHERE `provider_message_id`/`custom_string` matches; never touch `outcome` from a DLR (outcome is the hand-off fact) |
| Unsubscribe endpoint abuse (suppress arbitrary victims / enumerate addresses) | Elevation/Info disclosure | HMAC token only, uniform responses, no address in URL (Pitfall 7) |
| Webhook replay (Resend) | Spoofing | svix timestamp window; idempotent handlers (suppression insert is `ON CONFLICT` no-op by unique index `[VERIFIED: src/db/schema/suppressed-contacts.ts:112-116]`) |
| Reply-bomb pausing all cadences (SMS from spoofed numbers) | DoS | Pause is per-matched-cadence only; ambiguous → triage (no pause); rate anomalies surface on the tick counters |
| Customer PII in platform logs | Info disclosure | House rule T-2-02: ids only in logs — extends to inbound `from`/`body` |
| Secrets in webhook URLs leaking via logs | Info disclosure | Token compared then never logged; Vercel log redaction unavailable → keep token out of error messages; rotate independently |

## Sources

### Primary (HIGH confidence)
- This repository, read this session: `src/core/cadence/sender.ts`, `dispatch.ts`, `controls.ts`, `primary-contact.ts`, `src/db/schema/{send-ledger,suppressed-contacts,cadence-touches,cadences,tenants}.ts`, `src/core/shared/env.ts`, `src/core/alerts/operator-email.ts`, `package.json`, `docs/external-registrations.md`, `.planning/STATE.md`, `03-RESEARCH.md`

### Secondary (MEDIUM confidence — official docs, fetched)
- developers.clicksend.com: send-sms (endpoint/auth/fields), create-sms-inbound-automation (full rule fields), view-sms-delivery-receipt-rules, view-inbound-sms, create-test-inbound-sms
- resend.com/docs: api-reference/domains/create-domain (regions, DNS records, capabilities), dashboard/emails/add-unsubscribe-to-transactional-emails (header names/values), dashboard/webhooks/verify-webhooks-requests (svix headers), dashboard/receiving + blog/inbound-emails (Inbound existence)
- acma.gov.au/avoid-sending-spam + Sprintlaw Spam Act guides (30-day unsubscribe, 5-business-day actioning, authorising-business identification) — cross-checked
- npm registry: resend 6.24.0, svix 2.1.0, no postinstall scripts

### Tertiary (LOW confidence — flagged for empirical validation)
- ClickSend DLR/inbound push payload field lists (community/aggregated; official pages truncated)
- ClickSend auto-opt-out vs webhook passthrough behaviour (help-center articles; passthrough undocumented)
- Absence of ClickSend webhook signing (searched, not found ≠ doesn't exist)

## Metadata

**Confidence breakdown:**
- Internal seams & contracts: HIGH — every discrete value read from source files this session with line citations
- Standard stack: HIGH — no new mandatory packages; providers pre-decided
- ClickSend API mechanics: MEDIUM (endpoints/rule fields official) with LOW spots (push payload shapes, opt-out interplay) — mitigations designed in
- Resend mechanics: MEDIUM — official docs; SDK verify-method availability at pinned version unchecked
- Compliance (Spam Act): MEDIUM — ACMA + cross-checked legal guides; not legal advice
- Pitfalls: HIGH for house-known items, MEDIUM external

**Research date:** 2026-08-28
**Valid until:** ~2026-09-27 (stable APIs) — EXCEPT the IPND blocker status (re-check 2026-09-01) and A5 (check at first implementation task)
