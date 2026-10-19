# Phase 6: Review Console & Escalation - Research

**Researched:** 2026-09-01
**Domain:** Operator console (Next.js 16 App Router) over the existing cadence/classification machinery; hot-lead SMS escalation; deadline-relative alerting; ONB-04 onboarding-gate extension
**Confidence:** HIGH (codebase facts — every discrete value read from source this session) / LOW (ServiceM8 automation detection — external, preview-status API)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried forward (locked, not re-discussed):**
- Full review is the only v1 mode — no auto-pass exists anywhere, `pending_approval` is a real blocking gate, sampled review is V2-01 (Phase 5 D-12, one-way)
- Labels are evidence + priority only; no label triggers a state transition (Phase 5 D-14) — escalation consumes `is_hot`, it never moves a cadence
- The console must NOT offer "resume anyway" beside an onboarding-gated cadence; the only button beside `onboarding_gated` goes to the template editor (owed from 05-03, T-5-10)
- Soft opt-out stays operator-confirmed via the existing one-tap `killContact` suggestion, arm-then-confirm (Phase 5 D-13, T-5-27)

**Approval queue (CON-01)**
- **D-01:** **One cross-client queue**, sorted by time-to-send-slot (soonest first), client name on every card. Drafts only — hot-reply triage stays in the existing inbox. The operator's question is "what must I approve next, across everyone"; a single deadline-ordered screen answers it.
- **D-02:** **Skip is terminal per-touch**: the touch moves to `skipped` with a new operator skip reason; the cadence continues to its next touch untouched. There is no "defer" button — leaving a draft alone leaves it in the queue, where the aging rules (D-09) and the existing re-window/staleness machinery handle lateness honestly. The kill switch stays on the quote page; the queue does not duplicate it.
- **D-03:** **One-at-a-time approval, full body visible** on every approve — the full-review invariant made physical. No select-all, no approve-all, no per-client batch commit (extends the Phase 2 no-select-all precedent: one tap must not approve messages the operator didn't read). Speed comes from layout (card flow, big tap targets), not batching. — **Reversibility:** one-way — batch approval is a graduated-autonomy affordance; introducing it is a V2-01 policy decision gated on edit-rate data, not a UX tweak.
- **D-04:** **No `review_mode` field in v1.** The roadmap's "full-review default for the first 30 days" is satisfied vacuously — full review is the only mode (Phase 5 D-12), and the 30-day clock is derivable from `tenants.created_at` whenever V2-01 arrives. A field with one legal value is a switch waiting to be flipped by accident.

**Hot-lead SMS escalation (CON-03)**
- **D-05:** **Separate alert path, not the cadence pipeline.** A dedicated escalation module calls ClickSend directly (reusing the thin typed client), bypassing dispatch and every customer-protection gate — no contact-hours check (a hot lead at 7pm reaches the tradie at 7pm), no approval gate, no suppression check (the tradie is not a chased contact). It records its own evidence row so Phase 7 can prove "hot replies reached the tradie within minutes". — **Reversibility:** costly — routing tradie alerts through dispatch later means unpicking every gate exemption; the evidence row shape feeds Phase 7 instrumentation.
- **D-06:** **Sent from the existing shared number**, and the message carries the customer's mobile as a tap-to-call link — the action wanted is the tradie CALLING the lead, not texting back. A tradie reply to the shared number lands as `unmatched` in the inbox triage, which is honest and visible. No second number until scale justifies it.
- **D-07:** **Self-contained message content** (tradies never see a dashboard): customer first name, quote description snippet, the reply text itself (truncated to fit ~2 SMS segments), and the customer's mobile. It is the tradie's own customer writing about their own quote — no privacy barrier to forwarding it.
- **D-08:** **Fires in the same per-minute tick that sets `is_hot`** — "within minutes" holds structurally. One SMS per hot inbound message, with a recorded sent-at so a tick re-run can never double-fire. A short per-quote cooldown (e.g. no re-SMS for the same conversation within ~30 min) is Claude's discretion. No separate operator ping — the inbox already tops hot rows.

**Draft aging & stalled alerts (CON-04)**
- **D-09:** **Stall is deadline-relative and keyed on TOUCH state, never draft rows**: stalled = a touch still unapproved (`needs_draft` OR `pending_approval`) whose send slot is inside a threshold window (~4h, exact value Claude's discretion) or already past. Keying on the touch is load-bearing: 05-04 decided deterministic API failures record NO draft row, so a touch stuck in `needs_draft` behind repeated 400s must still age and still alert — this is the named CON-04 backstop for that gap.
- **D-10:** **Alert channel = existing operator-email machinery + console nav badge.** Reuse the Resend operator-email path and the `alerted_at` dedupe pattern (sync auth-alert precedent); an urgency count badge rides the console nav (05-07 inbox-badge pattern). Operator SMS deferred until email proves too slow.
- **D-11:** **One alert per touch per threshold crossing** (deduped via `alerted_at`); anything still stalled rolls into a daily digest email. No escalating repeats — a single operator plus hourly nagging equals trained blindness; the queue badge is the persistent signal.
- **D-12:** **Aging surfaces in three places**: time-to-slot urgency on queue cards, a pending/stalled count badge in the console nav, and a per-client pending-drafts indicator on the client list — the CON-02 pipeline view picks the last up for free.

**ONB-04 onboarding gate & drift**
- **D-13:** **Operator attestation is the gate; detection is a research question.** The operator attests "ServiceM8 Quote Follow Up is off" with a timestamped free-text evidence note — the exact D-06/Phase-5 template-attestation pattern. The phase researcher must investigate whether the ServiceM8 API (job activity, notes, any automation surface) can detect native follow-ups firing; if feasible, behavioral detection lands as a bonus backstop, but attestation is the gate either way.
- **D-14:** **The existing `paused(onboarding)` gate becomes a checklist of conditions**: templates approved (exists) AND sm8-automation attested (new). Resume fires only when ALL conditions pass — one pause reason, one resume path, riding tested machinery. No new pause vocabulary, no CHECK-constraint migration. — **Reversibility:** costly — the resume path and Phase 5's onboarding-pause semantics both assume a single gate; splitting into per-condition pause reasons later means a vocabulary migration plus resume-matrix growth (Phase 5 proved that costs plans).
- **D-15:** **Two-tier drift response**: hard behavioral evidence of a native follow-up firing (if detection proves buildable) → pause that tenant's sends + alert immediately — double-messaging is the harm ONB-04 exists to prevent. A stale attestation (~30 days) → the checklist item shows stale + an operator email nag, but NO auto-pause — a calendar must not stop a healthy client's follow-ups.
- **D-16:** **Full per-client onboarding checklist card** on the client page: ServiceM8 connected, contact hours set, voice profile set, templates approved, SM8 automation verified off, messaging armed. Only the SM8-automation item is attested; the rest are derived from existing data. It is the screen that makes "why is this client not sending yet?" answerable at a glance.

**Per-client pipeline view (CON-02)**
- **D-17:** **The existing `clients/[id]` page evolves into the pipeline view** — no new sub-page. The quotes table gains cadence-state presentation; connection health and sync runs stay.
- **D-18:** **Quotes grouped by cadence state in action order**: needs attention (paused / triage / stalled) first, then actively chasing, then waiting (scheduled), then closed (won/lost/stopped) collapsed at the bottom. The operator's question is "what needs me" — the grouping answers it before they scroll.
- **D-19:** **Conversation threads live on the quote-detail page**, where the cadence controls already are: sent touches interleaved with replies, timestamped in the tenant's zone, bodies rendered only behind the operator gate (T-2-02 discipline). The pipeline view shows compact indicators only (last sent / last reply with label chip per quote).
- **D-20:** **Upcoming = next touch per quote + a summary count.** Each active quote row shows its next scheduled touch (when, touch number, draft status), plus a header line like "12 touches scheduled this week". No separate 7-day schedule list — near-term detail is the queue's job.

### Claude's Discretion
- Exact stall threshold hours, cooldown window for escalation re-SMS, digest send time
- Escalation evidence-row shape (own table vs columns on `inbound_messages`) — must record sent-at, target, and link to the inbound message; follow evidence-table conventions
- Queue card layout, urgency tier visuals, edit-then-approve input UX on mobile (UI hint: yes — `/gsd-ui-phase` can own the design contract)
- The new operator skip reason's name (must join TOUCH_SKIP_REASONS via the CHECK-constraint pattern)
- Onboarding-checklist storage shape (derived items computed live; the attested item needs a timestamped record with evidence note)
- Where the escalation module's config lives (tradie's alert mobile — likely on tenant/settings; note `tenants` vs `cadence_settings` split)
- How the ONB-04 attestation composes with the existing approval-resume write (both must pass before resume; respect the 05-03 rule that the only affordance beside a gated cadence points at what's missing)

### Deferred Ideas (OUT OF SCOPE)
- **Sampled review / graduated autonomy** — V2-01, edit-rate-gated; D-03/D-04 keep v1 clean of its switches
- **Second dedicated alert number for tradie SMS** — revisit when client count or reply confusion justifies the cost (D-06)
- **Operator SMS alerts for stalled drafts** — add only if email proves too slow in practice (D-10)
- **Behavioral SM8-automation detection as the gate** (rather than backstop) — only if the research probe proves the API exposes enough signal (D-13)
- **7-day upcoming-touches schedule view** — revisit if the per-quote next-touch summary proves insufficient (D-20)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CON-01 | Mobile-friendly approval queue: approve, edit-then-approve, or skip each pending draft; full-review default for first 30 days | Pattern 1 (cross-tenant queue read), Pattern 2 (reusing `approveWhere`/`editAndApproveDraft` machinery), Pattern 3 (new operator skip reason + equality-guarded skip write), Pitfalls 3, 9, 12 |
| CON-02 | Per-client pipeline: open quotes, cadence states, recent messages, upcoming touches | Pattern 7 (pipeline reads over `clients/[id]/page.tsx`), D-17..D-20 mapping, tenant-timezone conventions |
| CON-03 | Hot replies SMS the tradie within minutes with conversation context | Pattern 4 (escalation module + evidence claim), verified `is_hot` writer + `tenants.escalation_phone`, Pitfalls 1, 2, 7 |
| CON-04 | Queue surfaces draft aging vs first-touch-within-24h; stalled drafts alert the operator | Pattern 5 (aging policy + `alerted_at` dedupe + digest cron), Pattern 8 (nav badge), Pitfall 4 |
| ONB-04 | Onboarding checklist blocks cadence activation until SM8 native Quote Follow Up verified off; check re-runs for drift | Pattern 6 (checklist gate composition), D-13 research answer (detection = LOW-confidence preview API; attestation is the gate), Pitfall 14 |
</phase_requirements>

## Summary

Phase 6 is almost entirely **new surfaces over existing, tested machinery**. Every write the approval queue needs already exists (`approveWhere` guarded on `pending_approval`, `editAndApproveDraft`'s re-validation, `skipWhere`-family writes); every input the escalation needs already exists (`is_hot` written by the classification pass, `tenants.escalation_phone` validated at tenant creation, the `sendSms` typed client); the onboarding gate is already a checklist-shaped condition with one member (`hasApprovedTemplateSet`) that D-14 extends to two. The risk profile is therefore not "can we build it" but "does the new surface re-derive a rule the core already owns" — the 04-09 CR-02 drift class. The prescription throughout this document is: extract shared builders, never copy.

The one genuinely external question — D-13, can the ServiceM8 API detect the native Quote Follow Up automation — has a nuanced answer. **No API reads the automation *setting*** (Settings → Automation is UI-only; no automation/addon resource exists in the reference). **Job activity is measured to NOT be a communications log** (docs/servicem8-api-notes.md). But **read-only SMS/email history endpoints (`GET /api_1.0/sms.json`, `/email.json`) were staff-confirmed in private preview in May 2026** — filterable by job UUID, merged inbound/outbound — and support docs state automation-sent communications land in the job diary. Detection as a drift backstop is *plausible but unproven*: the endpoints 404 in the public reference and may require OAuth scopes the pending partner approval hasn't granted. Attestation is the gate (as D-13 already locked); detection should be planned as a probe-first optional task, and D-15's tier-1 hard-pause response should be built only if the probe succeeds.

**Primary recommendation:** Plan the phase as five thin verticals — queue, escalation, aging/alerts, ONB-04 gate + checklist card, pipeline view — each reusing an existing core module through one new accessor or one extracted shared function, with exactly one hand-written migration wave (new skip reason CHECK + attestation table + escalation evidence table + stall-alert dedupe column) to respect the drizzle journal monotonicity guard.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Approval queue read (cross-tenant) | Console server component (`requireOperator()` + service-role) | DB (SQL sort/cap) | Inbox precedent: cross-tenant reads take the service-role path behind an explicit operator gate; priority rank lives in SQL because reads are capped |
| Approve / edit-approve / skip writes | Core (`src/db/repository` guarded writes) via server actions | Console (forms) | `approveWhere` is the sole path to `approved`; the console is a caller, never a second author of the guard |
| Hot-lead escalation | Core tick pass (framework-free module in `src/core/`) | ClickSend REST (external) | D-08: fires in the same per-minute tick that classifies; the console never sends |
| Draft-aging computation | Core pure policy function | Tick (evaluation) + Console (display) | `failure-policy.ts` precedent: pure decision, injectable clock, assertable without a DB |
| Stalled-draft alerts | Core tick pass → Resend (external) | DB (`alerted_at`-style dedupe column) | The dedupe must be a stored fact, not a caller convention (03-x lesson: "a caller-dependent guarantee is not a guarantee") |
| Daily digest | pg_cron schedule → protected API route | Core (digest builder) | Secret-bearing schedules applied by `scripts/apply-cron-schedules.mjs` from env, never in migrations |
| ONB-04 gate & resume | Core (`onboarding-gate.ts` extension, in-transaction) | DB (attestation evidence rows) | The gate is a state-machine fact (pause reason + resume predicate), never a UI rule |
| Onboarding checklist card | Console server component (derived items computed live) | Core (condition readers) | D-16: one attested item, rest derived — display composes the same readers the gate uses |
| Pipeline view (CON-02) | Console server component (RLS-scoped reads via operator JWT) | DB | Tenant-scoped page → the RLS read path, per the established two-read-paths rule |
| Nav count badge | Console layout (RLS-scoped count) | DB | Layout gates on auth only, not operator — an RLS-scoped count leaks nothing to a non-operator session |
| SM8 automation drift detection (optional) | Probe script first (`scripts/sm8-spike.mjs` extension) | Sync tick (only if probe succeeds) | The endpoint's availability under private API keys is unverified; nothing in the plan may depend on it before measurement |

## Standard Stack

### Core

**No new packages.** Every dependency this phase needs is already installed and in production use:

| Library | Version (installed) | Purpose in this phase | Why |
|---------|--------------------|-----------------------|-----|
| `next` (App Router) | 16.x | Queue page, pipeline page, checklist card, server actions | Existing console; `force-dynamic` + server-component pattern established [VERIFIED: src/app/(console)/inbox/page.tsx:15] |
| `drizzle-orm` + `postgres` | installed | New accessors, guarded writes, 4 schema additions | Sole migration authority (Phase 1 decision) |
| `zod` v4 | installed | Action input schemas (uuid ids, note text, skip reason literal) | Established at every boundary; `z.uuid()` id schemas precedent in quote actions [VERIFIED: src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts — `const draftIdsSchema = z.object({ draft_id: z.uuid(), touch_id: z.uuid() });`] |
| `resend` | installed | Stalled-draft alert email + daily digest | `sendOperatorAlert` machinery exists [VERIFIED: src/core/alerts/operator-email.ts:188] |
| ClickSend REST via thin client | n/a (direct fetch) | Escalation SMS | `sendSms(input, creds)` exists and is live-proven [VERIFIED: src/core/messaging/clicksend-client.ts:177] |
| `date-fns` + `@date-fns/tz` | installed | Tenant-zone display, threshold math | `formatInTenantZone` exists [VERIFIED: src/core/shared/tenant.ts:281] |
| `vitest` | installed | All new suites | `npm test` (pure), `npm run test:remote` (hosted, serialized) [VERIFIED: package.json scripts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New tick pass for escalation | Escalate inside `classifyInbound` after `writeClassification` | Couples the D-13 three-function privilege boundary (a pinned equality-asserted import list in tests/classification-privilege.test.ts) to an SMS-sending capability — widening the exact boundary Phase 5 built to be narrow. A separate pass scanning for unescalated hot rows is also self-healing across missed ticks. **Use a separate pass.** |
| `escalated_at` column on `inbound_messages` as the claim | Own evidence table with `UNIQUE(inbound_message_id)` | The column is a cheaper claim, but D-05 says the evidence row shape feeds Phase 7 ("hot replies reached the tradie within minutes") — outcome, target, provider id, and sent-at don't belong crammed onto the inbound row. **Use an own table; the unique index is the claim** (send_ledger's exact never-twice shape). |
| Widening `OperatorAlertKind` | Sibling alert-builder module in `src/core/alerts/` | `alertBody` interpolates a `SyncOutcome` from a closed vocabulary; a stalled-draft alert has different facts. Widening the union forces every existing assertion to grow arms. **Add a sibling pure builder + sender following the same three header rules.** |
| Write-once attestation (message-template pattern verbatim) | Append-only attestation rows, newest wins | D-15 requires *re-attestation* after ~30-day staleness — write-once cannot express it, and overwriting destroys evidence. **Append-only rows; latest `attested_at` drives staleness.** |

**Installation:** none — `npm install` adds nothing this phase.

## Package Legitimacy Audit

No new packages are installed by this phase. All recommendations reuse dependencies already present in `package.json` (`next`, `drizzle-orm`, `zod`, `resend`, `@anthropic-ai/sdk`, `date-fns`, `@date-fns/tz`, `postgres`, `@supabase/*`, `react`).

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## D-13 Research Answer: ServiceM8 native Quote Follow Up detection

This was the priority research question. Answer in three parts, confidence tagged:

**1. The automation *setting* is not readable via API — not found.** [VERIFIED-NEGATIVE within searched surface: developer.servicem8.com reference + support docs + web search, 2026-09-01] The Quote Follow Up automation is configured at Settings → Automation in the UI (requires the Automation Add-on). No `automation`, `addon`, or account-settings resource appears in the public API reference, and no documented endpoint exposes whether it is enabled. "Not found" is the honest answer — it may exist unpublished, but nothing plannable surfaces it.

**2. Job activity cannot see it — measured.** [VERIFIED: docs/servicem8-api-notes.md, measured 2026-08-26] — "**`jobactivity` is not a communications log.** It records staff scheduling/time-allocation (`staff_uuid`, `start_date`, `activity_was_scheduled`)… SMS and email sent from within ServiceM8 are **not visible** through it." Any detection design keyed on `jobactivity.json` is dead on arrival.

**3. New read-only SMS/email history endpoints exist in private preview — plausible backstop, unproven.** [CITED: community.servicem8.com/t/sms-email-read-only-api/1046, staff-confirmed May 2026] ServiceM8 staff (Cody) announced: "We've added new read-only REST resources for job-related SMS and Email history" — `GET /api_1.0/sms.json`, `GET /api_1.0/sms/{uuid}.json`, `GET /api_1.0/email.json`, `GET /api_1.0/email/{uuid}.json`, requiring `read_sms` / `read_email` scopes, filterable by job UUID, returning merged inbound/outbound history. Support docs separately state "all scheduled and sent automated communications are saved to the job diary" [CITED: support.servicem8.com Automation overview] — so if these endpoints surface diary communications, an automation-fired follow-up SHOULD appear there, attributable to the job UUID of a quote we're also chasing. **Caveats, all LOW confidence:** (a) the endpoints 404 in the public reference as of 2026-09-01 — preview status likely persists; (b) the named scopes imply the OAuth path, and partner approval (App ID 000000, submitted 25 Aug 2026) is still unconfirmed — whether a private `X-API-Key` can reach them is UNKNOWN [ASSUMED: unknowable without probing]; (c) response shape, timestamps, and sender attribution fields are unmeasured.

**Prescription for the planner:**
- Attestation is the gate (D-13 locked this either way). Build the attestation + staleness tier (D-15 tier 2) unconditionally.
- Detection is a **probe-first optional task**: extend `scripts/sm8-spike.mjs` to `GET /api_1.0/sms.json` (and `email.json`) with the existing `SM8_TEST_API_KEY`. Record the measured answer in docs/servicem8-api-notes.md per that file's convention. If 404/403 under the private key → record it, and the behavioural-detection backstop moves to the deferred list (CONTEXT already anticipates this). If it works → a later plan may add the D-15 tier-1 sweep (pause + alert on hard evidence of a native follow-up firing).
- Do NOT schedule any production code path that depends on `sms.json`/`email.json` before the probe lands. The 02-x lesson applies: a schema written from reference pages alone rejected every live job; this endpoint has no reference page at all.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌────────────────────────────────────────────────┐
                         │ per-minute cadence tick (pg_cron → /api/internal│
                         │ /cadence-tick, bearer CADENCE_TICK_SECRET)      │
                         └────────────────────────────────────────────────┘
                                             │
      pass 1 consume → pass 2 promote/draft → pass 3 dispatch → pass 4 complete
                                             │
                              pass 5 classify (global) — writes label,
                              label_confidence, is_hot  [existing]
                                             │
                    ┌────────────────────────┴───────────────────────────┐
                    ▼ NEW pass 6 (escalation)                            ▼ NEW pass 7 (aging)
        scan inbound_messages: is_hot AND                    scan cadence_touches: status IN
        no escalation evidence row                           ('needs_draft','pending_approval')
                    │                                        AND scheduled_at <= now + THRESHOLD
        claim: INSERT escalations row                        AND stall_alerted_at IS NULL
        (UNIQUE(inbound_message_id)                                       │
         ON CONFLICT DO NOTHING)                             guarded UPDATE stall_alerted_at
                    │                                                     │
        cooldown check (same cadence,                        sendStalledDraftAlert (Resend,
        ~30 min) → skip if warm                              pure body builder, name-only errors)
                    │
        sendSms via clicksend-client                 nightly digest (new pg_cron schedule →
        from = messaging_config sms row              protected route): everything still stalled
        to   = normalizeAuMobile(tenants.
               escalation_phone)
                    │
        UPDATE escalations row outcome/provider_message_id

  ┌──────────────── CONSOLE (Next.js 16 App Router, Vercel syd1) ────────────────┐
  │                                                                              │
  │  /queue (NEW, cross-tenant)          /clients/[id] (D-17 evolves)            │
  │  requireOperator() + service-role    RLS-scoped reads (operator JWT)         │
  │  read: touches(needs_draft|          quotes grouped by cadence state         │
  │  pending_approval) ⋈ latest draft    (D-18 order) + next-touch per quote     │
  │  ⋈ cadences ⋈ quotes; ORDER BY       + last-sent/last-reply chips (D-19)     │
  │  scheduled_at ASC, capped in SQL     + onboarding checklist card (D-16)      │
  │  tenant names via operator JWT/RLS                                           │
  │        │ approve / edit+approve / skip                                       │
  │        ▼                                                                     │
  │  SHARED action core (extracted from quotes/[quoteId]/actions.ts):            │
  │  latest-attempt check → whitelist rebuild at mergeNow → byte re-validation   │
  │  → drafts.approve + touches.approveWhere (sole path to 'approved')           │
  │  skip → NEW equality-guarded skipPendingWhere(reason='operator_skipped')     │
  │                                                                              │
  │  layout nav: RLS-scoped count badge (pending + stalled)                      │
  └──────────────────────────────────────────────────────────────────────────────┘

  ONB-04 gate: approveTemplateVersion ─┐
                                       ├─→ resumeIfOnboardingComplete(tx):
  attestSm8AutomationOff (NEW action) ─┘    templatesApproved AND sm8Attested
                                            → resumeWherePaused(…, 'onboarding')
                                            → applyResumeRewindow(RETURNING ids)
```

### Recommended Project Structure

```
src/
├── app/(console)/
│   ├── queue/                     # CON-01 — NEW cross-tenant approval queue
│   │   ├── page.tsx               # requireOperator + service-role read, force-dynamic
│   │   ├── queue-card.tsx         # client component: approve/edit/skip per card
│   │   └── actions.ts             # thin wrappers over the shared approval core
│   ├── clients/[id]/
│   │   ├── page.tsx               # D-17: evolves into pipeline view + checklist card
│   │   └── quotes/[quoteId]/      # D-19: gains conversation thread; actions.ts SHRINKS
│   │       └── actions.ts         #   (approval core extracted to src/core/approval/)
│   └── layout.tsx                 # gains RLS-scoped nav count badge
├── core/
│   ├── approval/                  # NEW — extracted shared approve/edit-approve core
│   │   └── approve-draft.ts       #   (latest-attempt, mergeNow whitelist, byte re-validate)
│   ├── escalation/                # NEW — CON-03, framework-free
│   │   ├── escalate-hot-leads.ts  #   tick pass: scan → claim → send → record
│   │   └── message.ts             #   pure body builder (truncation, tap-to-call number)
│   ├── alerts/
│   │   ├── operator-email.ts      #   existing — untouched
│   │   └── stalled-drafts.ts      # NEW — pure body builder + sender, same 3 header rules
│   ├── aging/                     # NEW — CON-04 pure policy
│   │   └── stall-policy.ts        #   stalled-set predicate, threshold constant, digest set
│   └── onboarding/                # ONB-04 (or extend src/core/drafting/onboarding-gate.ts)
│       └── checklist.ts           #   condition readers + resumeIfOnboardingComplete
└── db/
    ├── schema/
    │   ├── escalations.ts         # NEW evidence table
    │   └── tenant-attestations.ts # NEW append-only attestation evidence
    └── migrations/
        └── 0032+…                 # ONE wave: hand-written grants/CHECKs + generated tables
```

### Pattern 1: Cross-tenant approval queue read (inbox precedent, verified)

**What:** A new keyed cross-tenant accessor (e.g. `forAllTenants_approvalQueue`) beside the existing `forAllTenants_*` family [VERIFIED: src/db/repository/index.ts:35-43 exports `forAllTenants_cadenceTick`, `forAllTenants_cadencesByContactMobile`, `forAllTenants_ids`, `forAllTenants_ledgerOwners`, `forAllTenants_pendingQuoteEvents`, `forAllTenants_syncTick`, `forAllTenants_webhookHint`]. Pinned select list, no join to `tenants` — the page resolves client names through the operator's own JWT under RLS, exactly as the inbox does [VERIFIED: src/app/(console)/inbox/page.tsx:190-194 — `const supabase = await createClient(); const { data: tenantRows } = await supabase.from('tenants').select('id, name');`].

**Query shape:** `cadence_touches` WHERE `status IN ('needs_draft','pending_approval')` on live cadences, LEFT JOIN latest `touch_drafts` attempt (a `needs_draft` touch legitimately has no draft row — 05-04), join `cadences`/`quotes` for card facts, `ORDER BY scheduled_at ASC` **in SQL, before the LIMIT** — "the read is capped, so a sort applied after the LIMIT orders only the rows the cap admitted" (established rule, STATE.md).

**Gate:** `requireOperator()` before the read; `export const dynamic = 'force-dynamic'` [VERIFIED: inbox/page.tsx:15].

### Pattern 2: Approve / edit-then-approve from the queue — extract, never copy

The per-quote actions module already implements the whole trust pipeline [VERIFIED: src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts — header: "THESE TWO ACTIONS ARE THE ONLY WAY AI TEXT REACHES A CUSTOMER… the entire distance between 'a model wrote this' and 'a stranger's customer read this' is one of the two functions below"]. It carries four subtleties a queue copy would get wrong:

1. **Latest-attempt check** — approving an older attempt sends superseded text.
2. **Whitelist rebuilt at `mergeNow`** (falling back to `createdAt`) — a fresh-clock rebuild refuses "14 days" the model was legitimately handed across a midnight.
3. **`complianceSuffix` from the draft row**, not re-derived — a tenant rename must not fail `missing_suffix` on an unedited body.
4. **`approveDraft` writes `edit_distance = 0` EXPLICITLY** — the AI-04 dataset needs "reviewed and untouched" distinguishable from "never approved".

**Prescription:** extract the draft-lookup + validation + two-statement write (`drafts.approve` + `touches.approveWhere`) into a framework-free shared core (e.g. `src/core/approval/approve-draft.ts`); both the quote page actions and the queue actions call it. This is the `providerVerdictCorpus` lesson (04-09 CR-02): "A second correct copy would leave the exact structure that produced the bug."

The repository write is already correct and needs no change [VERIFIED: src/db/repository/for-tenant.ts:2479-2495]:

```typescript
approveWhere: async (touchIds: readonly string[]) => {
  ...
  .set({ status: 'approved', updatedAt: sql`now()` })
  .where(and(
    eq(cadenceTouches.tenantId, tenantId),
    inArray(cadenceTouches.id, [...touchIds]),
    // Same equality guard, same reason, one status later. This is the
    // ONLY statement in this file that writes `approved` (D-12).
    eq(cadenceTouches.status, 'pending_approval'),
  ))
```

### Pattern 3: The operator skip — new vocabulary member + equality-guarded write

The current skip vocabulary, verbatim [VERIFIED: src/db/schema/cadence-touches.ts:112-121]:

```typescript
export const TOUCH_SKIP_REASONS = [
  'min_gap',
  'stale',
  'suppressed',
  'quote_closed',
  'cadence_stopped',
  'cadence_expired',
  'no_address',
] as const;
```

And the statuses [VERIFIED: src/db/schema/cadence-touches.ts:65-72]:

```typescript
export const TOUCH_STATUSES = [
  'scheduled',
  'needs_draft',
  'pending_approval',
  'approved',
  'sent',
  'skipped',
] as const;
```

**Adding the member** (name is Claude's discretion — `operator_skipped` reads naturally beside the existing "what is true" naming rule) requires: (a) the const, (b) a hand-written CHECK migration following 0017/0018/0020 (drizzle-kit does not model CHECKs; journal entry hand-stamped), (c) any console label maps ("A map, not a `.replace('_',' ')`" house rule [VERIFIED: inbox/page.tsx:69]). The `window_refused` cautionary tale in the same file applies in reverse: a vocabulary member must ship WITH its writer.

**The write must be a NEW equality-guarded method**, not a reuse of `skipWhere` — `skipWhere` is guarded `notInArray(status, TERMINAL_TOUCH_STATUSES)` [VERIFIED: for-tenant.ts:2513-2527], which would let a stale queue card skip a touch a colleague approved seconds earlier. The queue skip needs `WHERE status IN ('needs_draft','pending_approval')` — the same "equality on the source status, not merely not-terminal" reasoning `markPendingApproval` documents [VERIFIED: for-tenant.ts:2470-2473].

### Pattern 4: Hot-lead escalation — claim-then-send, tick pass 6

**Inputs, all verified:**
- The hot flag rule [VERIFIED: src/core/classification/classify-inbound.ts:284-287]:
```typescript
function isHotLead(label: InboundLabel, confidence: string): boolean {
  if (confidence !== 'high') return false;
  return label === 'interested' || label === 'question';
}
```
- The labels vocabulary [VERIFIED: src/db/schema/inbound-messages.ts:140-148]: `['interested', 'question', 'objection', 'not_interested', 'opt_out', 'other']`; confidences `['high', 'medium', 'low']` [VERIFIED: inbound-messages.ts:155].
- The tradie's alert mobile ALREADY EXISTS: `escalationPhone: text('escalation_phone')` on `tenants` [VERIFIED: src/db/schema/tenants.ts:40], collected optionally at tenant creation, validated against `AU_MOBILE_PATTERN` after `normalisePhone` [VERIFIED: src/core/shared/tenant.ts:128-133]. **The `tenants` vs `cadence_settings` question is answered: it's on `tenants`.** (What's missing: an *edit* affordance after creation — the new-client form is the only writer found.)
- The send input contract [VERIFIED: src/core/messaging/clicksend-client.ts:64-73]:
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
- Creds come from env: `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY`, both `.optional()` in the env schema [VERIFIED: src/core/shared/env.ts:113-114] — the reconcile module's read-and-refuse-if-missing shape is the precedent [VERIFIED: src/core/messaging/reconcile.ts:134-139].

**Design:** a new `escalations` evidence table following the evidence-family conventions (tenant_id + RLS, NO FK/cascade from tenants, read-only to `authenticated`, service-role writes — the family rule stated on inbound-messages [VERIFIED: src/db/schema/inbound-messages.ts:31-36]). Columns: `inbound_message_id` (UNIQUE — this index IS the D-08 never-twice guarantee, the same shape as `send_ledger_cadence_touch_uniq` [VERIFIED: src/db/schema/send-ledger.ts:205]), denormalized `cadence_id`/`quote_id`/`tenant_id`, `to_address`, `sent_at`, `provider_message_id`, `outcome` **NULLABLE where NULL means "claimed, outcome unknown"** (send_ledger's 03-01 rule — a 'failed' default invites the retry that double-texts).

**Flow per tick (pass 6, after classification):** cross-tenant scan for `is_hot = true` rows with no escalations row → per row: resolve tenant's `escalation_phone` (skip + count if NULL), check cooldown (any escalation for the same `cadence_id` within ~30 min → record a row with outcome `cooldown_suppressed` or skip-count — discretion), **INSERT the claim row ON CONFLICT DO NOTHING; only the inserter proceeds to send** → `sendSms` → UPDATE outcome. Per-row try/catch; counts-only result fields enumerated into the tick response (T-3-24). `customString` should carry the escalation row id (NOT a send_ledger id — the DLR route matches `custom_string` against send_ledger [STATE.md 04-04]; verify the DLR handler tolerates an unmatched custom_string rather than misfiling it — it matches by precedence and should simply not match, but assert it).

**Escalation must still respect deployment arming.** D-05 exempts the *customer-protection* gates (contact hours, approval, suppression). It does not exempt the D-04 arming switch: the `from` number comes off the enabled sms `messaging_config` row, and the global row is currently **disarmed** (`enabled=false`, STATE.md 2026-08-30). If no enabled sms row exists, the escalation must refuse-and-record, not invent a from-number — otherwise the disarmed production would page tradies about test data, and every test run could send real SMS.

### Pattern 5: Draft aging + stalled alerts

**The stalled predicate is pure and touch-keyed (D-09):** `status IN ('needs_draft','pending_approval') AND scheduled_at <= now + STALL_THRESHOLD`. Write it as a pure policy module (the `failure-policy.ts` precedent — pure decision over a row snapshot, `alertKind` derived from `alertedAt === null` [VERIFIED: src/core/sync/failure-policy.ts:76-103]).

**Dedupe:** add `stall_alerted_at timestamptz` to `cadence_touches` (the `sm8_connections.alerted_at` precedent — "the dedupe, so the operator gets one email per episode" [VERIFIED: src/db/schema/sm8-connections.ts:21-23,82]). One alert per touch per threshold crossing (D-11): the tick's aging pass does a guarded `UPDATE … SET stall_alerted_at = now() WHERE stall_alerted_at IS NULL AND <stalled predicate> RETURNING`, and alerts only for returned rows — the WHERE clause is the idempotence mechanism (the quote_opened emission rule, Phase 2).

**Alert channel:** a NEW pure builder + sender in `src/core/alerts/` following operator-email's three header rules verbatim — nothing throws, body assembled from a closed vocabulary (tenant name, count, formatted UTC timestamp, constructed URL — never a customer body or address), failure detail is the error's `name` [VERIFIED: src/core/alerts/operator-email.ts:9-30]. Do not widen `OperatorAlertKind` — its `detail` is typed `SyncOutcome`.

**Daily digest:** everything still stalled rolls up nightly (D-11). New protected route + pg_cron entry added to `scripts/apply-cron-schedules.mjs` with its OWN bearer secret (the four-separate-bearers rule, 04-01: rotating a shared secret must not 401 unrelated endpoints). Secret-bearing schedules are applied by script from env, never committed in migrations (Phase 2 decision). Verify activation the Phase 3 way: `net._http_response` recording 200, not a green `cron.job_run_details` row.

**Three display surfaces (D-12):** time-to-slot on queue cards (already in the queue read); nav badge (Pattern 8); per-client pending count on the client list (extend the client-list read beside `deriveHealth` [VERIFIED: src/app/(console)/page.tsx:9,114]).

### Pattern 6: ONB-04 — the gate becomes a two-condition checklist

**What exists:** `hasApprovedTemplateSet(repo)` — asked in-transaction, with the vacuous-truth guard written out (`if (touches.length === 0) return false;`) [VERIFIED: src/core/drafting/onboarding-gate.ts:74-78]. `approveTemplateVersion` writes the attestation, **re-asks the gate inside the same transaction**, resumes `ONBOARDING_PAUSE_REASON`-scoped cadences via `resumeWherePaused`, and re-windows OUTSIDE the transaction scoped to the RETURNING ids [VERIFIED: onboarding-gate.ts:154-234]. `resumeCadence` returns `{ kind: 'onboarding_gated' }` for a paused-onboarding cadence [VERIFIED: src/core/cadence/controls.ts:702-708]. The pause vocabulary [VERIFIED: src/db/schema/cadences.ts:193-197]:

```typescript
export const CADENCE_PAUSE_REASONS = [
  'customer_reply',
  'client_paused',
  'onboarding',
] as const;
```

**The extension (D-14 — no new pause vocabulary):**
1. New evidence table (e.g. `tenant_attestations`): append-only rows `(id, tenant_id, kind, note text NOT NULL, attested_at, created_at)` with `kind` CHECK-constrained (`'sm8_automation_off'` today). Append-only because D-15 staleness requires re-attestation and evidence must never be overwritten (`approved_at`/`approval_note` are "ATTESTATION, NOT A STATUS FLAG" [VERIFIED: src/db/schema/message-templates.ts:33-37] — but write-once is wrong here; versioned-append is the right sibling). The note is REQUIRED, not defaulted — the T-5-12 rule ("typing HOW… is a deliberation a second tap only simulates, and unlike a tap it is kept as the evidence", 05-05).
2. Extract `resumeIfOnboardingComplete(tx, now)` from the tail of `approveTemplateVersion`: asks ALL conditions (`hasApprovedTemplateSet(tx) && hasSm8AutomationAttestation(tx)`) in-transaction, resumes + returns ids. Both writers call it: `approveTemplateVersion` (existing) and the new `attestSm8AutomationOff` action. One resume path, riding tested machinery — exactly D-14.
3. **Both conditions must gate cadence CREATION too:** `consume-events.ts` asks `hasApprovedTemplateSet` to decide born-paused vs born-active [VERIFIED: onboarding-gate.ts:11-14 header]. If only the resume composes the new condition, a tenant with approved templates but no attestation gets born-ACTIVE cadences — the gate never engages. The creation-time question must become the same composed predicate.
4. `RESUME_CADENCE_ONBOARDING_GATED_MESSAGE` currently points at the template editor (05-03). With two conditions, the refusal must name the condition(s) actually missing, and the only affordance beside a gated cadence points at THAT (Claude's-discretion item; the T-5-10 rule constrains it).
5. Drift tier 2 (stale ≥ ~30 days): checklist item shows stale + operator-email nag (reuse Pattern 5's alert sender), NO auto-pause. Tier 1 (behavioural pause) ONLY if the D-13 probe succeeds — see the D-13 section.

**Checklist card (D-16) — all readers already exist for the derived items:**
| Item | Derived from |
|------|-------------|
| ServiceM8 connected | `sm8_connections` row present, `paused_at IS NULL` |
| Contact hours set | Always true post-ONB-01 (required at creation, zero-width rejected) — show the window, not a boolean |
| Voice profile set | `cadence_settings` voice columns (`greeting_style`, `sign_off`, `formality`, …) [VERIFIED: src/db/schema/cadence-settings.ts:82-102] |
| Templates approved | `approvedSetStatus()` via `forTenant()` — NEVER re-derived from `message_templates` (T-5-13 vacuous-truth trap, pinned by a source assertion in 05-05) |
| SM8 automation verified off | NEW attestation row, latest `attested_at`, stale flag |
| Messaging armed | Per-tenant identity resolver answer, NOT `anyChannelEnabled` — the 04-08 CR-01 lesson: deployment gate and identity authority are two different questions; the checklist asks the per-client one |

### Pattern 7: Pipeline view (CON-02) — evolve `clients/[id]/page.tsx`

The page today renders: connection section, quotes + triage section, recent sync runs [VERIFIED: src/app/(console)/clients/[id]/page.tsx:528-707 — `<h2>ServiceM8 connection</h2>`, `<h2>Quotes</h2>`, `<h3>Needs review</h3>`, `<h2>Recent sync runs</h2>`]. D-17 keeps those and grows the quotes section: per-quote cadence state, D-18 grouping (needs-attention → chasing → waiting → closed collapsed), next-touch per quote + weekly count (D-20), last-sent/last-reply chips (D-19 — chips only; bodies stay on the quote page and inbox).

Reads are tenant-scoped → RLS path via the operator's JWT (the established two-read-paths rule). Grouping order is a product rule: compute the group rank in SQL or in a pure exported function so it's assertable — but note the cap rule only bites on capped reads; a full per-tenant quote list at founding-cohort scale is small. Timestamps in the tenant's zone via `formatInTenantZone`, zone named beside schedules (house rule).

### Pattern 8: Nav count badge — the layout has NO badge today

`src/app/(console)/layout.tsx` is a 55-line auth-gated shell whose nav is static links [VERIFIED: layout.tsx:23-50 — no count, no badge markup]. The "05-07 inbox-badge pattern" in CONTEXT refers to the `.badge` CSS class conventions (05-08 hardened: `display: inline-block`, `white-space: nowrap`, flex-gap container contract), not an existing nav counter. Adding the D-10/D-12 count is NEW work:

- The layout gates on `getClaims()` (any authenticated user), NOT `requireOperator()`. A service-role count read in the layout would show cross-tenant numbers to any authenticated session. **Use an RLS-scoped count via the user's own JWT** (`createClient()` + a count over `cadence_touches` the policy admits) — a non-operator (v2 client login) sees only their own rows by construction, and v1's single operator sees everything they're a member of.
- Server layouts re-render after actions complete (noted in the quote actions module: "runs when a LAYOUT renders — which is after the action has finished"), so the count self-refreshes on approve/skip.

### Anti-Patterns to Avoid

- **Copying the approval pipeline into queue actions** — the drift class that produced CR-02 (04-09). Extract one core.
- **Reusing `skipWhere` for the operator skip** — its not-terminal guard admits `approved`; a stale card would un-approve by skipping.
- **A `review_mode` column** — D-04 explicitly forbids it.
- **Escalating from inside `classifyInbound`** — widens the three-function classification privilege boundary pinned by equality in tests/classification-privilege.test.ts (05-06).
- **Free-text or widened detail in alert bodies** — `alertBody`'s closed-vocabulary rule is the T-2-16 mitigation; a stalled-draft alert naming a customer or quoting a draft body breaks T-2-02.
- **Deriving hot-ness in the escalation pass** — `is_hot` is stored precisely so the product rule can change without rewriting history [VERIFIED: inbound-messages.ts:246-252]; the escalation reads the column, never re-computes `isHotLead`.
- **`.replace('_',' ')` for any new vocabulary label** — the house rule is a map that fails loudly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Approve/edit validation | New validation in queue actions | Extracted shared core over `latestForTouch` + `mergeNow` whitelist + `approveWhere` | Four known subtleties (attempt races, midnight boundary, rename suffix, edit_distance=0) already solved and tested |
| Once-only escalation | In-memory sent-set or timestamp comparison | UNIQUE index claim row (`ON CONFLICT DO NOTHING` + RETURNING) | Overlapping ticks are the documented worst case (drafting claim header); only the index survives them |
| Alert dedupe | "The caller checks before alerting" | Stored `stall_alerted_at` + guarded UPDATE RETURNING | "A caller-dependent guarantee is not a guarantee" (sync alert lesson, STATE.md) |
| Phone normalization for the tradie's mobile | New regex | `normalizeAuMobile` [VERIFIED: src/core/cadence/primary-contact.ts:129-141] | Returns E.164 or null; refuses rather than repairs (Phase 3 rule: a restored digit texts a stranger) |
| Cron activation proof | Trusting `cron.job_run_details` | `net._http_response` status + evidence rows in the same window | The 307-reads-as-success trap (Pitfall 7, Phase 2) |
| Skip-reason rendering | String munging | Label map + badge-class map per inbox precedent | Fails loudly on a new member |
| SMS segment estimation for D-07 truncation | Ad-hoc length math | Reuse whatever `segments` logic touch_drafts uses (`touch_drafts.segments` exists [VERIFIED: src/db/schema/touch-drafts.ts:228]) — locate and share the counter | GSM-7 vs UCS-2 boundary is easy to get wrong; a shared counter can't disagree with drafting's |

## Common Pitfalls

### Pitfall 1: `escalation_phone` is NOT E.164 — normalize before send
**What goes wrong:** `tenants.escalation_phone` is stored compact-local — `normalisePhone` only strips separators (`'0412 345 678'` → `'0412345678'`) [VERIFIED: src/core/shared/tenant.ts:80-84], while `SendSmsInput.to` demands "NORMALIZED E.164" [VERIFIED: clicksend-client.ts:65-66]. Passing the stored value as-is sends to an invalid recipient.
**How to avoid:** `normalizeAuMobile(tenant.escalationPhone)` in the escalation module; a null result (or null column) is a recorded refusal (`no_escalation_number`), surfaced on the checklist card — not a throw, not a silent skip.

### Pitfall 2: Escalation bypasses customer gates, not deployment arming
**What goes wrong:** the global sms `messaging_config` row is currently `enabled=false` (disarmed, STATE.md 2026-08-30). An escalation that reads `from_address` off the row regardless of `enabled` — or hardcodes the number — sends real SMS from test/CI runs against the production-shared DB, and re-arms tradie paging with no D-04 switch.
**How to avoid:** the escalation resolves its from-number through the same enabled-row question dispatch's sms resolver asks; disabled → recorded refusal. Tests inject a fake sender seam (the `StubSender`/`ClassifyClient` injection precedent).

### Pitfall 3: A stale queue card must not skip an approved touch
**What goes wrong:** `skipWhere`'s guard is `notInArray(TERMINAL_TOUCH_STATUSES)` — `approved` is not terminal, so a queue rendered before a colleague's approval would skip a cleared touch.
**How to avoid:** new write guarded `WHERE status IN ('needs_draft','pending_approval')` (equality-guard rule stated at `markPendingApproval` [VERIFIED: for-tenant.ts:2470-2473]). Zero rows returned → re-read and report honestly (the `resumeCadence` race pattern).

### Pitfall 4: Aging keyed on drafts silently misses the 05-04 gap
**What goes wrong:** deterministic drafting 400s record NO `touch_drafts` row (05-04 decision) — a drafts-joined stall query never sees the stuck touch. D-09 exists because of this.
**How to avoid:** the stalled predicate reads `cadence_touches` only; the queue read LEFT JOINs drafts and renders a `needs_draft`-with-no-draft card honestly ("no draft yet — drafting failed or pending"), including `draft_failures` at cap [VERIFIED: cadence-touches.ts:202 `MAX_DRAFT_FAILURES = 5` referenced; column at :218].

### Pitfall 5: One migration wave, hand-stamped journal
**What goes wrong:** the drizzle journal-ordering trap fired on 3 consecutive Phase 2 plans; parallel plans generating migrations in one wave collide (the 0025→0027 renumber cost a quick task). This phase needs ~4 schema changes (skip-reason CHECK, `stall_alerted_at`, `escalations`, `tenant_attestations` + grants).
**How to avoid:** consolidate schema work into one plan/wave; hand-written CHECK/GRANT migrations follow 0017's REVOKE-then-GRANT block convention ("EVERY NEW TABLE NEEDS ITS OWN BLOCK" [VERIFIED: src/db/migrations/0017_cadence_grants_and_constraints.sql header]); latest migration is `0031_draft_merge_inputs.sql` [VERIFIED: ls src/db/migrations], so this phase starts at 0032. Prove with a no-op `db:migrate`.

### Pitfall 6: The gate extension must reach cadence CREATION, not just resume
**What goes wrong:** if only `resumeIfOnboardingComplete` composes the new attestation condition, `consume-events.ts` still births cadences ACTIVE for a templates-approved-but-unattested tenant — ONB-04 never engages for exactly the client it exists for.
**How to avoid:** the creation-time question (`hasApprovedTemplateSet` asked by consume-events) becomes the composed predicate. Also mind ordering for EXISTING gated tenants at deploy time: a tenant whose templates were approved pre-Phase-6 but who has no attestation must not be resumable until attested — which falls out naturally if resume asks the composed predicate, but write the test.

### Pitfall 7: Escalation can't get hot ids from the classification pass
**What goes wrong:** `classifyInbound` returns counts only (T-3-24) [VERIFIED: classify-inbound.ts:204-248 `ClassifyCounts`]; wiring escalation to its return value requires widening it into an id-carrying result.
**How to avoid:** the escalation pass scans the table (`is_hot AND no escalations row`) — same-tick because it's pass 6 of the same run, and self-healing: a hot row from a tick where escalation failed is retried next minute. Cap the scan and order oldest-first.

### Pitfall 8: `'use server'` exports are globally POSTable
**What goes wrong:** every export from a server-action module is an endpoint (Phase 2 audit lesson). Queue actions accept touch/draft ids from a form anyone authenticated can forge.
**How to avoid:** the WR-01 discipline the quote actions already carry: zod uuid schemas, membership/operator re-check inside the action with the caller's own JWT before any service-role write, ids re-verified against the database (draft-for-touch pairing), no extra parameters accepted.

### Pitfall 9: Draft bodies on the queue are operator-only content
**What goes wrong:** `final_body` is AI text bound for a customer; a queue page cached, statically rendered, or reachable past `requireOperator` leaks cross-tenant content. Logging a body anywhere breaks T-2-02.
**How to avoid:** `force-dynamic`, `requireOperator()` first, catch-and-discard on read failures (the inbox's WR-08 catch [VERIFIED: inbox/page.tsx:171-177]), counts-only logs.

### Pitfall 10: The gated-cadence affordance must point at what's missing
**What goes wrong:** with two conditions, the 05-03 rule ("the only button beside `onboarding_gated` goes to the template editor") goes stale — sending an operator to the template editor when templates are done but attestation is missing is the exact broken-button experience `onboarding_gated` was carved out to avoid [VERIFIED: controls.ts:640-658, the kind's own doc comment].
**How to avoid:** the refusal surface derives which condition(s) fail and links accordingly; `unapprovedTouchNumbers`-style per-condition readers make it cheap.

### Pitfall 11: Timezone of every timestamp is a decision, not a default
**What goes wrong:** the queue mixes tenants; the pipeline is one tenant. Rendering send slots in the wrong zone misstates the deadline by up to the AWST offset.
**How to avoid:** follow the two established rules — cadence/schedule surfaces in the TENANT's zone with the zone named (`formatInTenantZone`); operator-waiting-time surfaces (inbox) in the operator's locale [VERIFIED: inbox/page.tsx:126-133 doc]. Queue cards show the send slot (tenant-zone, zone named) plus relative time-to-slot (zone-free).

### Pitfall 12: `test:remote` shares the production database
**What goes wrong:** overlapping remote runs, or a run overlapping the live crons, corrupts real state (memory note: hosted DB is production; globalSetup pauses deployed ticks via lease+watchdog).
**How to avoid:** serialize `npm run test:remote`; escalation tests must run against injected fakes for ClickSend and assert zero HTTP calls when unconfigured (the reconcile suite's zero-HTTP-calls property precedent).

### Pitfall 13: New tick counts must be enumerated in the route response
**What goes wrong:** spreading a result object into the tick route response leaks future fields into cron/Vercel logs (T-3-24; the route enumerates fields today).
**How to avoid:** add escalation/aging count fields explicitly to the route's enumerated response.

### Pitfall 14: Attestation staleness must not auto-pause (D-15)
**What goes wrong:** an over-eager drift implementation pauses tenants at the 30-day mark — "a calendar must not stop a healthy client's follow-ups."
**How to avoid:** staleness produces UI state + one deduped nag email only. The only pause trigger is hard behavioural evidence, which is gated behind the D-13 probe.

## Code Examples

### Claim-then-send (escalation core loop)

```typescript
// Pattern assembled from verified precedents: send_ledger's unique-claim
// (03-01), writeClassification's guarded write (05-06), dispatch's per-item
// try/catch (04-09). Source conventions: src/db/schema/send-ledger.ts,
// src/core/classification/classify-inbound.ts.
const claimed = await db
  .insert(escalations)
  .values({ inboundMessageId: row.id, tenantId, cadenceId, quoteId, toAddress })
  .onConflictDoNothing() // UNIQUE(inbound_message_id) — the D-08 guarantee
  .returning();
if (claimed.length === 0) continue; // another tick already owns it

const result = await sendSms(
  { to: toAddress, from: smsIdentity.fromAddress, body, customString: claimed[0].id },
  creds,
);
// outcome NULL means "claimed, outcome unknown" — never default to 'failed'
await db.update(escalations)
  .set(result.ok
    ? { sentAt: now, providerMessageId: result.messageId, outcome: 'sent' }
    : { outcome: `refused_${result.reason}`.slice(0, 48) })
  .where(eq(escalations.id, claimed[0].id));
```

### Stalled-set claim (aging pass)

```typescript
// The WHERE clause is the idempotence mechanism (quote_opened rule, Phase 2).
const newlyStalled = await db
  .update(cadenceTouches)
  .set({ stallAlertedAt: now, updatedAt: sql`now()` })
  .where(and(
    inArray(cadenceTouches.status, ['needs_draft', 'pending_approval']),
    lte(cadenceTouches.scheduledAt, addHours(now, STALL_THRESHOLD_HOURS)),
    isNull(cadenceTouches.stallAlertedAt),
  ))
  .returning({ id: cadenceTouches.id, tenantId: cadenceTouches.tenantId });
// alert once per returned row's tenant (grouped), counts-only logging
```

### Composed onboarding resume (extracted from onboarding-gate.ts:181-205)

```typescript
// Both writers (approveTemplateVersion, attestSm8AutomationOff) call this
// inside their own transaction, AFTER their write — the 05-03 in-transaction
// re-ask rule, verbatim.
export async function resumeIfOnboardingComplete(tx: TenantScopedRepository) {
  const conditions = {
    templatesApproved: await hasApprovedTemplateSet(tx),
    sm8AutomationAttested: await hasSm8AutomationAttestation(tx), // empty = false, decided on purpose
  };
  if (!Object.values(conditions).every(Boolean)) return { resumedIds: [], conditions };
  const resumed = await tx.cadences.resumeWherePaused(
    (await tx.cadences.listLive()).filter((c) => c.status === 'paused').map((c) => c.id),
    ONBOARDING_PAUSE_REASON,
  );
  return { resumedIds: resumed.map((c) => c.id), conditions };
}
// Caller re-windows OUTSIDE the transaction, scoped to resumedIds — the
// applyResumeRewindow placement rule (onboarding-gate.ts:130-142), unchanged.
```

## State of the Art

| Old Approach (pre-Phase-6) | Current Approach (this phase) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-quote approval only (`DraftReview` on quote detail) | Cross-client deadline-ordered queue over the same writes | Phase 6 | Approval core must be extracted before two surfaces call it |
| `hasApprovedTemplateSet` as the whole gate | Composed checklist predicate (templates AND attestation) | Phase 6 (D-14) | Both consume-events creation and both resume writers ask the composed predicate |
| `is_hot` display-only (inbox chip, 05-07) | `is_hot` consumed by escalation | Phase 6 (D-05..08) | Still never moves a cadence (D-14 Phase 5) |
| No aging signal (05-04 silent no-draft-row gap) | Touch-keyed stall detection + alerts | Phase 6 (D-09) | The named CON-04 backstop |
| ServiceM8 comms unreadable via API | `sms.json`/`email.json` read endpoints in private preview | May 2026 (community-confirmed) | Detection backstop plausible; probe before planning on it |

**Deprecated/outdated:** the CLAUDE.md model-table row "classification on `claude-haiku-4-5`" is doubly historical — classification runs on `claude-opus-5` (user decision 2026-08-31, quick 260831-iie). No Phase 6 code touches model choice, but plans must not "fix" it back.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `GET /api_1.0/sms.json` / `email.json` may be reachable with a private `X-API-Key` (scope names suggest OAuth-only) | D-13 answer | None if probed first — the probe is the plan; only a plan that skips the probe is at risk |
| A2 | Automation-sent Quote Follow Ups would appear in those endpoints (inferred from "saved to the job diary" support-doc claim) | D-13 answer | Detection backstop returns empty even when native follow-ups fire → drift check silently useless; mitigated by requiring a measured positive (seed a native follow-up on the trial account) before building tier-1 |
| A3 | ~2-SMS-segment truncation for the escalation body is enough for name + snippet + reply + number | Pattern 4 / D-07 | Message clipped mid-number; mitigate by placing the customer's mobile FIRST or asserting it survives truncation in tests |
| A4 | The DLR webhook tolerates an unmatched `custom_string` (an escalation id will match no send_ledger row) | Pattern 4 | A forged/mismatched receipt path misfiles; verify in the receipts route before shipping (match keys are tried in precedence — expected safe, unproven for this new id shape) |
| A5 | The single operator is a `tenant_members` member of every tenant, so an RLS-scoped nav count covers all clients | Pattern 8 | Badge undercounts for tenants the operator isn't a member of; verify membership invariant or fall back to requireOperator + service-role count |

## Open Questions (RESOLVED — each recommendation enacted verbatim in a plan)

1. **RESOLVED (by design — the probe IS the resolution): Does `GET /api_1.0/sms.json` answer to a private API key on the live trial account?** → 06-04 Task 3 runs the probe.
   - What we know: staff-confirmed endpoints, scope names, job-UUID filtering (community thread, May 2026); public reference 404s.
   - What's unclear: auth mode, GA status, response shape.
   - Recommendation: first task of the ONB-04 plan extends `scripts/sm8-spike.mjs`; the measured answer is recorded in docs/servicem8-api-notes.md and decides whether the D-15 tier-1 sweep is planned at all.

2. **RESOLVED → 06-05: Escalation cooldown bookkeeping when suppressed by cooldown** — record a row with a `cooldown_suppressed` outcome (evidence-complete, but consumes the UNIQUE claim for that inbound id — fine, each inbound escalates at most once) vs. count-only skip. Recommendation: record the row; Phase 7 can then compute honest reach latency.
3. **RESOLVED → 06-06 Task 2: Where the escalation-phone edit affordance lives** — only the new-client form writes it today. Recommendation: the client page settings area (beside contact hours), validated by the same `AU_MOBILE_PATTERN` path.
4. **RESOLVED → 06-02 Task 2 (06:30 Perth): Digest send time** (discretion) — recommend early AM AWST (e.g. 06:30 Perth) so the operator starts the day with the list; store the schedule in the cron-apply script.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase (Sydney, hosted) | everything | ✓ (production, shared with test:remote) | Postgres 15+ | — |
| ClickSend account + number | CON-03 escalation | ✓ (+61491579212 live-proven; sms row disarmed) | api v3 | Escalation refuses-and-records while disarmed |
| Resend | CON-04 alerts/digest | ✓ (`onboarding@resend.dev` operator-alert path proven) | v2 API | — |
| Vercel deployment | tick passes 6/7, new routes | ✓ (deployed at a02a731) | — | — |
| pg_cron | daily digest schedule | ✓ (three schedules live) | hosted | — |
| ServiceM8 trial account + `SM8_TEST_API_KEY` | D-13 probe | ✓ (sm8-spike rig exists) | — | Probe fails honest → detection deferred |
| ServiceM8 OAuth partner credentials | D-13 detection IF scope-gated | ✗ (App ID 000000 unconfirmed since 25 Aug) | — | Attestation-only (already the gate) |
| ANTHROPIC_API_KEY | none new (classification exists) | ✓ | — | — |

**Missing dependencies with no fallback:** none that block the phase — every blocked path (OAuth scopes) has attestation as the locked-in gate.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (installed; 23 pure suites run on bare `npm test` — WR-09 gate on credential access) |
| Config file | vitest via package.json scripts |
| Quick run command | `npm test -- tests/<file>.test.ts` |
| Full suite command | `npm test` (pure) · `npm run test:remote` (hosted DB — SERIALIZED, pauses production crons via lease+watchdog; never overlap runs) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CON-01 | Queue read joins/order/cap; approve only from `pending_approval`; skip equality guard; extracted approval core parity with quote-page behaviour | integration (remote) + unit | `npm run test:remote -- tests/approval-queue.test.ts` | ❌ Wave 0 |
| CON-01 | New skip reason in CHECK + label map fails loudly on new member | unit | `npm test -- tests/touch-skip-vocabulary.test.ts` | ❌ Wave 0 (extend existing vocabulary suites) |
| CON-02 | D-18 grouping rank pure function; next-touch derivation | unit | `npm test -- tests/pipeline-grouping.test.ts` | ❌ Wave 0 |
| CON-03 | Claim uniqueness under concurrent ticks; cooldown; null/invalid escalation_phone refusal; disarmed-deployment refusal; zero HTTP calls unconfigured | integration (remote) + unit w/ injected sender | `npm run test:remote -- tests/escalation.test.ts` | ❌ Wave 0 |
| CON-04 | Stall predicate pure-function matrix (incl. no-draft-row touch); `stall_alerted_at` once-only; digest set | unit + remote | `npm test -- tests/stall-policy.test.ts` | ❌ Wave 0 |
| ONB-04 | Composed predicate: creation born-paused without attestation; resume fires only when ALL pass; both writers converge; staleness no-auto-pause | integration (remote) | `npm run test:remote -- tests/onboarding-checklist-gate.test.ts` | ❌ Wave 0 (extend existing onboarding-gate suites) |

### Sampling Rate
- **Per task commit:** `npm test -- <touched suites>` + `npx tsc --noEmit` + `npm run lint`
- **Per wave merge:** `npm test` (full pure suite); one serialized `npm run test:remote` when repository/schema changed
- **Phase gate:** full `test:remote` green before `/gsd-verify-work`; no-op `npm run db:migrate` proves journal coherence

### Wave 0 Gaps
- [ ] `tests/approval-queue.test.ts` — CON-01 (queue read + guarded writes)
- [ ] `tests/escalation.test.ts` — CON-03 (claim/cooldown/refusals; injected ClickSend seam)
- [ ] `tests/stall-policy.test.ts` — CON-04 (pure predicate + dedupe)
- [ ] `tests/onboarding-checklist-gate.test.ts` — ONB-04 (composed gate; creation + both resumes)
- [ ] `tests/pipeline-grouping.test.ts` — CON-02 (pure grouping/next-touch)
- [ ] Existing suites to extend, not duplicate: cadence-transitions coverage guards, vocabulary tests, classification-privilege import-equality (must NOT gain escalation imports)

## Security Domain

### Applicable ASVS Categories (Level 1, enforcement on)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (existing) | Supabase Auth; `getClaims()` (JWT-verified) in layout; no change this phase |
| V3 Session Management | yes (existing) | `@supabase/ssr` cookie sessions; no change |
| V4 Access Control | yes — core of this phase | Two-read-paths rule: `requireOperator()` + service-role for cross-tenant (queue), RLS via operator JWT for tenant pages (pipeline, checklist); WR-01 membership re-check inside every server action; new tables get RLS policies in schema (pgPolicy) + explicit REVOKE/GRANT migration blocks |
| V5 Input Validation | yes | zod on every action input (`z.uuid()` ids, bounded note text, literal skip reason); CHECK-constrained closed vocabularies; ids re-verified against DB (draft↔touch pairing) |
| V6 Cryptography | no new | Existing bearer secrets; digest route gets its OWN bearer (four-bearers rule) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged POST to `'use server'` action (globally reachable) | Tampering/Elevation | WR-01: authorize with caller's JWT inside the action; zod-shape everything; accept no extra parameters |
| IDOR on touch/draft/tenant ids in queue actions | Information disclosure / Tampering | Equality-guarded repository writes scoped by `forTenant`; absent vs other-tenant indistinguishable (house rule) |
| Escalation SMS as injection vector (customer reply text forwarded to tradie) | Tampering | Body is plain SMS text to a human — no parser downstream; still sanitize control characters (drafting `sanitizeUntrusted` precedent) and truncate; never log the body (T-2-02) |
| Double-fire escalation (replayed tick) | Tampering/DoS-on-trust | UNIQUE claim row; cooldown window |
| Alert email as data-exfil channel | Information disclosure | Closed-vocabulary body builder, exported + asserted verbatim (T-2-16); error `name` only |
| Nav badge leaking cross-tenant counts to non-operator sessions | Information disclosure | RLS-scoped count via caller's own JWT (Pattern 8) |
| Stale attestation forged/backdated | Repudiation | Append-only evidence rows, service-role writes only, `attested_at` server-set (`now()`), note required |
| New evidence tables without grants blocks | Elevation (TRUNCATE not subject to RLS) | 0017's REVOKE-then-GRANT block per table, verbatim convention |

## Project Constraints (from CLAUDE.md)

- Custom TypeScript + Next.js 16 (App Router, `proxy.ts` not middleware) on Vercel `syd1`; Supabase Sydney — no new infra, tooling ≤ $200/mo
- drizzle-orm is the migration authority; **do NOT adopt Prisma**; keep pg_cron schedules with secrets applied by script, not migrations
- ClickSend via thin typed `fetch` wrapper + zod — **skip their generated SDK**; escalation reuses the existing client
- **No n8n/Zapier/Make** for any cadence logic; **no Vercel `waitUntil`** for must-happen sends (escalation rides the tick + claim row, not waitUntil)
- **No free-text LLM classification parsing** — untouched this phase; escalation reads the stored `is_hot` column only
- Spam Act sender identification: escalation SMS to the TRADIE is not marketing to a consumer, but keep the sender identifiable (client/customer names in body per D-07); customer-facing rules unchanged
- Contact-hours/DNCR discipline applies to CUSTOMER sends only — D-05 explicitly exempts the tradie alert (own decision, documented)
- ServiceM8: 180 req/min, 20k/day per account; the D-13 probe is a handful of requests — no polling-loop detection designs
- GSD workflow enforcement: all edits through GSD commands

## Sources

### Primary (HIGH confidence — read from source this session)
- `src/db/schema/cadence-touches.ts`, `inbound-messages.ts`, `cadences.ts` (line-ranged quotes above), `tenants.ts:40`, `cadence-settings.ts:82-107`, `send-ledger.ts:205`, `message-templates.ts:33-37,119-121`, `sm8-connections.ts:21-23,82`
- `src/db/repository/for-tenant.ts:2460-2546` (guarded writes), `src/db/repository/index.ts:35-43` (cross-tenant family)
- `src/core/cadence/controls.ts` (full read), `src/core/drafting/onboarding-gate.ts` (full read), `src/core/classification/classify-inbound.ts:150-310`, `src/core/alerts/operator-email.ts` (full read), `src/core/messaging/clicksend-client.ts:59-178`, `src/core/shared/tenant.ts:80-160,281`, `src/core/cadence/primary-contact.ts:129-149`, `src/core/sync/failure-policy.ts:36-103`
- `src/app/(console)/inbox/page.tsx` (full read), `layout.tsx` (full read), `clients/[id]/page.tsx` (section structure), `clients/[id]/quotes/[quoteId]/actions.ts:352-470`, `draft-review.tsx` (exports)
- `docs/servicem8-api-notes.md` (full read — measured API behaviour, jobactivity finding)
- `.planning/STATE.md`, `06-CONTEXT.md`, `REQUIREMENTS.md`, `.planning/config.json`

### Secondary (MEDIUM confidence)
- https://support.servicem8.com/hc/en-us/articles/212550866-Quote-Follow-Up-Automation — feature behaviour (only fires while status = Quote, max 5 follow-ups, Settings → Automation)
- https://support.servicem8.com/hc/en-us/articles/214222743-Automation-overview — "all scheduled and sent automated communications are saved to the job diary"
- https://developer.servicem8.com/docs/messaging-overview — Messaging API is send-only, OAuth-required

### Tertiary (LOW confidence — flagged for the probe)
- https://community.servicem8.com/t/sms-email-read-only-api/1046 — staff-confirmed private-preview `GET /api_1.0/sms.json` / `email.json` (May 2026); not in public reference as of 2026-09-01; cached in research store (key `3438adeb…`)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; every reused module read from source
- Architecture: HIGH — every pattern anchored to a verified precedent in this repo
- ONB-04 detection (D-13): LOW — preview API, auth mode unknown; probe-first prescription bounds the risk
- Pitfalls: HIGH — each derived from a verified guard, a measured API fact, or a recorded prior incident

**Research date:** 2026-09-01
**Valid until:** 2026-10-01 for codebase facts (re-verify after any Phase 6 plan executes); the ServiceM8 preview-endpoint status may change any week — re-check at probe time
