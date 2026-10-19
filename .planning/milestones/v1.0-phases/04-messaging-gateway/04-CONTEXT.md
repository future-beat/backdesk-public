# Phase 4: Messaging Gateway - Context

**Gathered:** 2026-08-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Real SMS and email flow through the Phase 3 dispatch pipeline via the existing `TouchSender` seam: a ClickSend sender (dedicated AU virtual number, delivery receipts reconciled to the send ledger) and a Resend sender (verified client domain or service-subdomain fallback, SPF/DKIM, Spam Act sender identification, functional unsubscribe). Inbound SMS webhooks run a deterministic STOP regex before anything else, suppress across both channels through the existing D-16 control surface, and thread replies to the correct tenant/contact/quote by cadence-snapshot lookup — a unique match pauses the cadence, anything ambiguous goes to human triage, never a guess. The carried-forward `client_paused` → `customer_reply` pause-upgrade write is closed in this phase.

Requirements: MSG-01, MSG-02, MSG-03, MSG-04. AI drafting/classification is Phase 5, the full approval console is Phase 6 — this phase makes the wire real and compliant, reshaping nothing that Phase 3 settled.

</domain>

<decisions>
## Implementation Decisions

### Email reply path
- **D-01:** v1 email sends use **From: service subdomain, Reply-To: the tradie's own address**. Replies land where the tradie already works; the system never sees email replies, so email pause-on-reply does not exist in v1. MSG-04's inbound-threading criterion is **scoped to SMS + unsubscribe events** for this phase. Resend Inbound (`email.received` on the service subdomain) is recorded as the v2 trigger the moment email pause-on-reply is wanted. — **Reversibility:** reversible — Resend Inbound is additive on the same domain; switching later adds a webhook route without reshaping senders or threading.

### Email scope (MSG-02 interpretation)
- **D-02:** MSG-02 means **the email pipe is proven**, not email touches in live cadences: domain-verification flow (Resend domains API, DNS records surfaced to the operator), compliant sender identity + Spam Act footer, List-Unsubscribe/one-click headers + working unsubscribe endpoint — all proven by a real send through the actual `TouchSender` path (test/ops send). Email touch templates and cadence-settings work stay with ONB-03/Phase 5. All Phase 3 templates are SMS; this phase does not author templates.

### STOP / suppression policy
- **D-03:** A STOP from a number matching **multiple** tenants' cadences suppresses the contact for **all candidate tenants** (and stops each matched cadence), plus a triage item so the operator sees the full picture. A STOP matching **no** cadence still suppresses the bare mobile and lands in triage — refusing to record an opt-out because it can't be threaded is the one wrong answer. Over-suppression is the compliant failure mode; the mild cross-tenant visibility of a suppression row is accepted. — **Reversibility:** one-way by design — suppression entries inherit D-06's never-chase-again semantics; that is the point.

### Messaging config home
- **D-04:** The shared dedicated number and per-channel sender config live in a **DB config table with a global default row, keyed to allow per-tenant overrides** (the stated v2 direction is per-client numbers). When the IPND-blocked number lands mid-phase, activation is a scripted ops step (config row + rule pointing), not a code change or redeploy. — **Reversibility:** costly to walk back to env vars — dispatch wiring, the activation script, and future per-client provisioning would all rebind.

### Carried-forward obligations (locked, not discussed — from Phase 3 / STATE.md)
- **D-05:** Close the pause-upgrade gap: one guarded repository write so `pauseForReply` performs `paused(client_paused)` + customer_reply → `paused(customer_reply)` instead of returning `upgrade_unsupported`. Without it a client's own resume can revive a live conversation (D-05 Phase 3 breached from the other direction).
- **D-06:** The `TouchSender` contract (`src/core/cadence/sender.ts`) is untouched; dispatch keeps ONE sender — Phase 4 supplies a channel-routing composite that delegates by `request.channel` and reports the delegate's `provider` (`'clicksend' | 'resend'`, never composite names).
- **D-07:** No gate is re-implemented outside dispatch's claim transaction; no auto-retry of failed/NULL-outcome sends — `retryable` informs the operator surface only.
- **D-08:** IPND sequencing: all number-independent work (senders, webhooks, STOP, threading, schema, unsubscribe, email path) builds and tests first; "purchase number + point rules + live two-way test" is isolated as the final blocked-tagged plan.

### Claude's Discretion
- Minimal reply-triage surface shape (where ambiguous/unattributed inbound lands before Phase 6's console) — extend existing console patterns.
- DLR reconciliation cadence and mechanics (webhook is the hint, poll is the guarantee — mirror SYNC-03 philosophy; daily sweep suggested).
- `inbound_messages` table and delivery-receipt column/table design, following evidence-table conventions (tenant_id, RLS via has_tenant_access, no cascade from tenants, read-only to authenticated).
- STOP keyword set details (research Pattern 4 regex is the starting point; anchored whole-message match, never substring).
- Unsubscribe token mechanics (HMAC via node:crypto, uniform responses, own secret per the two-bearer precedent).
- Live-number activation checkpoint mechanics (scripted setup in the `cron:apply` mold, `scripts/setup-clicksend.mjs` suggested), including the empirical STOP-passthrough test (research A3) and webhook-payload shape capture (research A1/A2).
- Whether `svix` is needed (only if `resend@6.22.1` lacks `webhooks.verify()`); any install/upgrade gets a human-verify checkpoint per the research's package-legitimacy disposition.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The Phase 3 → Phase 4 contract (load-bearing)
- `src/core/cadence/sender.ts` — THE `TouchSender` contract Phase 4 implements: `SendRequest`/`SendOutcome` union, non-throwing rule, provider vocabulary `'stub' | 'clicksend' | 'resend'`
- `src/core/cadence/dispatch.ts` — claim transaction, JIT suppression/pause/window re-checks, outcome mapping, never-auto-resend rule; Phase 4 changes wiring only
- `src/core/cadence/controls.ts` — D-16 control transactions (`killContact` shape, `pauseForReply`, verbatim-address rule); STOP and unsubscribe write THROUGH these, and D-05's upgrade write lands here
- `src/db/schema/send-ledger.ts` — outcome semantics (NULL = claimed/unknown), `provider_message_id`, unique-index idempotency; delivery status is a new fact, not a new outcome value
- `src/db/schema/suppressed-contacts.ts` — grant-layer irreversibility, `source` free-text (`'sms_stop'`, `'email_unsubscribe'` as new writers)
- `src/db/schema/cadences.ts` — contact snapshot (`contact_mobile`/`contact_email`) as the threading identity (never `quote_contacts`); pause/status vocabularies (CHECK-constrained by migration 0017)
- `src/core/cadence/primary-contact.ts` — `normalizeAuMobile`/`normalizeEmail`: the ONE spelling suppression and threading key on

### Phase 4 research & planning
- `.planning/phases/04-messaging-gateway/04-RESEARCH.md` — ClickSend/Resend mechanics, pitfalls (payload under-documentation, opt-out race, IPND sequencing), assumptions log A1–A8, security threat table, test map
- `.planning/REQUIREMENTS.md` — MSG-01..04 (this phase); AI-01..04 and CON-01..04 (what consumes this phase's inbound rows)
- `.planning/ROADMAP.md` — Phase 4 goal + success criteria
- `.planning/STATE.md` — IPND blocker status, carried-forward pause-upgrade gap, drizzle-kit journal-ordering trap, T-2-02 (no addresses in logs) and T-3-24 (enumerate response fields) rules
- `docs/external-registrations.md` — IPND address blocker detail, ClickSend/Twilio status, candidate fixes

### Prior phase contracts honoured
- `.planning/phases/03-cadence-engine/03-CONTEXT.md` — D-05/D-06/D-13/D-14/D-15 semantics this phase extends
- `src/app/api/webhooks/servicem8/route.ts` + `src/app/api/internal/cadence-tick/route.ts` — the established webhook/tick route conventions (routes own auth, nodejs runtime, per-endpoint secrets, enumerated responses)
- `src/core/shared/env.ts` — env validation pattern for new secrets (ClickSend key, webhook tokens, unsubscribe signing secret)
- `.claude/CLAUDE.md` §SMS sender identity / §What NOT to Use — decided: dedicated numbers not alpha tags, direct fetch not ClickSend SDK, no waitUntil for sends

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TouchSender` seam + stub-distinguishable ledger outcomes: real senders drop in; `stub_sent` vs `sent` already separates eras
- `pauseForReply` (exported, waiting for its first caller) + `killContact` transaction shape: inbound STOP and reply handling compose existing controls
- `normalizeAuMobile`/`normalizeEmail`: reuse for inbound `from` normalization — never a second normalizer
- Resend SDK already in production (`src/core/alerts/operator-email.ts`, `resend@6.22.1`) — the email sender extends known ground
- Secret-bearing setup scripts pattern (`cron:apply`) → model for ClickSend rule/number activation script
- Test harness: 586 pure tests on bare `npm test`; `test:remote` pauses deployed crons via globalSetup — never overlap runs (hosted Sydney DB is production)

### Established Patterns
- Routes own their auth (proxy.ts excludes `api/`); per-endpoint secrets, never shared; `runtime = 'nodejs'` + explicit `maxDuration`
- zod at every boundary — tolerant parse for under-documented ClickSend payloads (`.passthrough()`, hard-require only acted-upon fields), dead-letter row for unknown shapes (metadata only)
- Evidence tables: tenant_id + RLS, no cascade from tenants, read-only to authenticated, service-role writes via multi-table transactions
- No customer addresses/bodies in logs (T-2-02); response bodies enumerate fields (T-3-24)
- drizzle-kit journal monotonicity guard after every generate; parallel plans must not both generate migrations in one wave

### Integration Points
- Outbound: dispatch → channel-routing sender → ClickSend REST (`custom_string = ledgerId`) / Resend SDK → ledger outcome
- Inbound: `/api/webhooks/clicksend/{inbound,dlr}` (token-authed) → core functions → `inbound_messages` + ledger delivery columns + suppression/pause via controls
- Public: `/api/unsubscribe` (HMAC token, GET confirm + POST one-click) → both-channel suppression
- Reconciliation: pg_cron-driven poll of ClickSend history/inbound as the guarantee behind webhook hints

</code_context>

<specifics>
## Specific Ideas

- Message copy identifies the tradie by name (Spam Act) since the shared number can't; email footer names the client business AND the authorising service
- AU-residency honesty: Resend has no Sydney region (nearest `ap-northeast-1`) — the sales-copy note ("DB/auth AU-resident, message vendors offshore") must reach the operator; surface at verify/UAT, not just in code
- "Suppressing is always safe, sending is not" — the fail-safe direction for every untrusted-webhook decision
- ClickSend's account-level auto-STOP may swallow STOP before the webhook fires — the onboarding checkpoint must test this empirically with a real STOP; our `suppressed_contacts` stays canonical either way

</specifics>

<deferred>
## Deferred Ideas

- **Resend Inbound email-reply capture** — v2 trigger: the moment email pause-on-reply or system-visible email threading is wanted (D-01 records the default)
- **Email touch templates in live cadences** — Phase 5 (ONB-03 template approval + AI drafting own this)
- **Per-client dedicated numbers** — v2 direction already noted in CLAUDE.md; D-04's config table is shaped for it

</deferred>

---

*Phase: 4-Messaging Gateway*
*Context gathered: 2026-08-28*
