# Phase 6: Review Console & Escalation - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning

<domain>
## Phase Boundary

The operator's phone-first control surface: a cross-client, deadline-sorted approval queue where every pending draft is approved, edited-then-approved, or terminally skipped one at a time (CON-01); the per-client pipeline view grown out of the existing client-detail page — quotes grouped by cadence state, next-touch-per-quote, compact message indicators (CON-02); hot-lead SMS escalation that puts an interested/question reply in the tradie's hand within minutes with everything needed to call the customer back (CON-03); deadline-relative draft-aging with stalled-draft alerts against the first-touch-within-24h target (CON-04); and the ONB-04 extension of the Phase 5 onboarding gate — cadence activation stays blocked until ServiceM8's native Quote Follow Up automation is attested off, with periodic drift re-checks.

Requirements: CON-01, CON-02, CON-03, CON-04, ONB-04. Phase 5 produced the drafts, labels, and `is_hot` flags this phase consumes; attribution/reporting instrumentation is Phase 7.

**Carried forward (locked, not re-discussed):**
- Full review is the only v1 mode — no auto-pass exists anywhere, `pending_approval` is a real blocking gate, sampled review is V2-01 (Phase 5 D-12, one-way)
- Labels are evidence + priority only; no label triggers a state transition (Phase 5 D-14) — escalation consumes `is_hot`, it never moves a cadence
- The console must NOT offer "resume anyway" beside an onboarding-gated cadence; the only button beside `onboarding_gated` goes to the template editor (owed from 05-03, T-5-10)
- Soft opt-out stays operator-confirmed via the existing one-tap `killContact` suggestion, arm-then-confirm (Phase 5 D-13, T-5-27)

</domain>

<decisions>
## Implementation Decisions

### Approval queue (CON-01)
- **D-01:** **One cross-client queue**, sorted by time-to-send-slot (soonest first), client name on every card. Drafts only — hot-reply triage stays in the existing inbox. The operator's question is "what must I approve next, across everyone"; a single deadline-ordered screen answers it.
- **D-02:** **Skip is terminal per-touch**: the touch moves to `skipped` with a new operator skip reason; the cadence continues to its next touch untouched. There is no "defer" button — leaving a draft alone leaves it in the queue, where the aging rules (D-09) and the existing re-window/staleness machinery handle lateness honestly. The kill switch stays on the quote page; the queue does not duplicate it.
- **D-03:** **One-at-a-time approval, full body visible** on every approve — the full-review invariant made physical. No select-all, no approve-all, no per-client batch commit (extends the Phase 2 no-select-all precedent: one tap must not approve messages the operator didn't read). Speed comes from layout (card flow, big tap targets), not batching. — **Reversibility:** one-way — batch approval is a graduated-autonomy affordance; introducing it is a V2-01 policy decision gated on edit-rate data, not a UX tweak.
- **D-04:** **No `review_mode` field in v1.** The roadmap's "full-review default for the first 30 days" is satisfied vacuously — full review is the only mode (Phase 5 D-12), and the 30-day clock is derivable from `tenants.created_at` whenever V2-01 arrives. A field with one legal value is a switch waiting to be flipped by accident.

### Hot-lead SMS escalation (CON-03)
- **D-05:** **Separate alert path, not the cadence pipeline.** A dedicated escalation module calls ClickSend directly (reusing the thin typed client), bypassing dispatch and every customer-protection gate — no contact-hours check (a hot lead at 7pm reaches the tradie at 7pm), no approval gate, no suppression check (the tradie is not a chased contact). It records its own evidence row so Phase 7 can prove "hot replies reached the tradie within minutes". — **Reversibility:** costly — routing tradie alerts through dispatch later means unpicking every gate exemption; the evidence row shape feeds Phase 7 instrumentation.
- **D-06:** **Sent from the existing shared number**, and the message carries the customer's mobile as a tap-to-call link — the action wanted is the tradie CALLING the lead, not texting back. A tradie reply to the shared number lands as `unmatched` in the inbox triage, which is honest and visible. No second number until scale justifies it.
- **D-07:** **Self-contained message content** (tradies never see a dashboard): customer first name, quote description snippet, the reply text itself (truncated to fit ~2 SMS segments), and the customer's mobile. It is the tradie's own customer writing about their own quote — no privacy barrier to forwarding it.
- **D-08:** **Fires in the same per-minute tick that sets `is_hot`** — "within minutes" holds structurally. One SMS per hot inbound message, with a recorded sent-at so a tick re-run can never double-fire. A short per-quote cooldown (e.g. no re-SMS for the same conversation within ~30 min) is Claude's discretion. No separate operator ping — the inbox already tops hot rows.

### Draft aging & stalled alerts (CON-04)
- **D-09:** **Stall is deadline-relative and keyed on TOUCH state, never draft rows**: stalled = a touch still unapproved (`needs_draft` OR `pending_approval`) whose send slot is inside a threshold window (~4h, exact value Claude's discretion) or already past. Keying on the touch is load-bearing: 05-04 decided deterministic API failures record NO draft row, so a touch stuck in `needs_draft` behind repeated 400s must still age and still alert — this is the named CON-04 backstop for that gap.
- **D-10:** **Alert channel = existing operator-email machinery + console nav badge.** Reuse the Resend operator-email path and the `alerted_at` dedupe pattern (sync auth-alert precedent); an urgency count badge rides the console nav (05-07 inbox-badge pattern). Operator SMS deferred until email proves too slow.
- **D-11:** **One alert per touch per threshold crossing** (deduped via `alerted_at`); anything still stalled rolls into a daily digest email. No escalating repeats — a single operator plus hourly nagging equals trained blindness; the queue badge is the persistent signal.
- **D-12:** **Aging surfaces in three places**: time-to-slot urgency on queue cards, a pending/stalled count badge in the console nav, and a per-client pending-drafts indicator on the client list — the CON-02 pipeline view picks the last up for free.

### ONB-04 onboarding gate & drift
- **D-13:** **Operator attestation is the gate; detection is a research question.** The operator attests "ServiceM8 Quote Follow Up is off" with a timestamped free-text evidence note — the exact D-06/Phase-5 template-attestation pattern. The phase researcher must investigate whether the ServiceM8 API (job activity, notes, any automation surface) can detect native follow-ups firing; if feasible, behavioral detection lands as a bonus backstop, but attestation is the gate either way.
- **D-14:** **The existing `paused(onboarding)` gate becomes a checklist of conditions**: templates approved (exists) AND sm8-automation attested (new). Resume fires only when ALL conditions pass — one pause reason, one resume path, riding tested machinery. No new pause vocabulary, no CHECK-constraint migration. — **Reversibility:** costly — the resume path and Phase 5's onboarding-pause semantics both assume a single gate; splitting into per-condition pause reasons later means a vocabulary migration plus resume-matrix growth (Phase 5 proved that costs plans).
- **D-15:** **Two-tier drift response**: hard behavioral evidence of a native follow-up firing (if detection proves buildable) → pause that tenant's sends + alert immediately — double-messaging is the harm ONB-04 exists to prevent. A stale attestation (~30 days) → the checklist item shows stale + an operator email nag, but NO auto-pause — a calendar must not stop a healthy client's follow-ups.
- **D-16:** **Full per-client onboarding checklist card** on the client page: ServiceM8 connected, contact hours set, voice profile set, templates approved, SM8 automation verified off, messaging armed. Only the SM8-automation item is attested; the rest are derived from existing data. It is the screen that makes "why is this client not sending yet?" answerable at a glance.

### Per-client pipeline view (CON-02)
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The Phase 5 → Phase 6 contract (load-bearing)
- `.planning/phases/05-ai-drafting-classification/05-CONTEXT.md` — D-12 (real blocking gate, no auto-pass ever), D-13 (soft opt-out operator-confirmed), D-14 (labels are evidence + priority; `is_hot` is the flag this phase's escalation consumes), D-15 (low confidence routes to operator), the onboarding-gate design this phase extends
- `src/db/schema/cadence-touches.ts` — TOUCH_STATUSES + skip-reason vocabulary the new operator skip joins; `needs_draft`/`pending_approval` are the states the queue and aging read
- `src/db/repository/for-tenant.ts` — `approveWhere` (sole path to `approved`), `promoteDue`, repository conventions
- `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx` + `draft-review.tsx` — the minimal approve/edit action the queue generalizes; per-quote control-surface rationale (D-16 controls, RLS-scoped reads)
- `src/db/schema/inbound-messages.ts` — `is_hot`, label/confidence columns, attribution vocabulary, T-2-02 body-logging prohibition
- `src/core/cadence/controls.ts` — `killContact`, `resumeCadence` (returns `onboarding_gated`), pause/resume semantics the checklist gate composes with

### Console & alerting patterns honoured
- `src/app/(console)/inbox/page.tsx` — triage queue conventions: `requireOperator()` + service-role for cross-tenant reads, raw bodies rendered only here-and-quote-pages, no select-all
- `src/app/(console)/page.tsx` — client-list health-badge pattern the pending-drafts indicator joins
- `src/app/(console)/clients/[id]/page.tsx` — the page D-17 evolves; existing sections (connection, quotes+triage, sync runs)
- `src/core/alerts/operator-email.ts` — the operator-email machinery D-10 reuses; `alerted_at` dedupe precedent lives in the sync failure policy
- `src/core/sync/health.ts` — `deriveHealth` badge pattern (one input, derived display)

### Messaging path (escalation reuses, does not extend)
- ClickSend thin typed client (`src/core/messaging/` family) — the direct-send call D-05 reuses outside dispatch
- `src/core/cadence/dispatch.ts` — the pipeline the escalation deliberately BYPASSES; read to know which gates are being exempted and why they exist
- `src/db/schema/send-ledger.ts` — evidence conventions the escalation row must echo (but NOT write to — the ledger is for cadence touches)

### Project planning & platform facts
- `.planning/REQUIREMENTS.md` — CON-01..04 + ONB-04 (this phase); RPT-03 (Phase 7 consumes first-touch-rate + edit-rate instrumentation this phase's data feeds); V2-01 (sampled review is v2)
- `.planning/ROADMAP.md` — Phase 6 goal + success criteria; UI hint: yes
- `.planning/STATE.md` — messaging disarmed status (global sms row enabled=false; re-arm is one UPDATE), MSG-02 first-client email obligation, T-2-02/T-3-24 rules, 05-03 console obligations (no resume-anyway; required approval note), 05-04 no-draft-row failure gap that D-09 backstops
- `docs/servicem8-api-notes.md` — ServiceM8 API surface for the D-13 detection research question
- `.claude/CLAUDE.md` §ServiceM8 Integration Facts — API endpoints, rate limits, webhook status (partner approval still pending)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DraftReview` (quote-detail): the approve / edit-then-approve action already exists per-quote — the queue is a new surface over the same repository writes (`approveWhere`, guarded on `pending_approval`)
- Inbox triage page: the cross-tenant queue pattern (requireOperator + service-role read, priority rank in SQL not in the page, capped reads) transfers directly to the approval queue
- `is_hot` + label/confidence columns: escalation and queue priority read existing data; no classification changes needed
- Operator-email alerts + `alerted_at` dedupe: stalled-draft alerts are a new policy over existing machinery
- ClickSend typed client: the escalation SMS is a new caller of an existing client — no new provider integration
- Phase 5 onboarding pause + `resumeCadence`/`onboarding_gated`: the ONB-04 gate extends an existing checklist-shaped condition (approvedSetStatus) with one more condition
- Nav badge pattern (05-07 inbox badge, 05-08 `.badge` hardening): the queue count badge reuses it

### Established Patterns
- Two read paths, chosen per page: RLS-scoped reads via the operator's JWT for tenant-scoped pages; `requireOperator()` + service-role via `getDb()` for cross-tenant queues — the approval queue is cross-tenant, so it takes the inbox path
- Sort/priority in SQL (CASE in ORDER BY) because reads are capped — a sort after the LIMIT orders only what the cap admitted
- Tenant-timezone display everywhere (`formatInTenantZone`, zone named beside schedules)
- No customer bodies/addresses in logs (T-2-02); response fields enumerated (T-3-24); no select-all on actions that touch customers
- Closed vocabularies CHECK-constrained (migration 0017 pattern) — the new skip reason follows it
- Evidence tables: tenant_id + RLS, no cascade from tenants, read-only to authenticated, service-role writes
- drizzle journal monotonicity guard; parallel plans must not both generate migrations in one wave

### Integration Points
- Queue: cross-tenant read of `pending_approval`/`needs_draft` touches + their drafts → one-tap approve/edit/skip → existing repository writes → dispatch picks up `approved` as today
- Escalation: classification pass (sets `is_hot`) → same-tick escalation module → ClickSend direct → evidence row; tradie replies → existing inbound webhook → unmatched triage
- Aging: per-minute tick computes stalled set from touch state + slots → operator email (deduped) + badge counts read by console
- ONB-04: checklist conditions (approvedSetStatus + new attestation) → gate the existing onboarding-resume write; drift tiers → alert or pause via existing controls

</code_context>

<specifics>
## Specific Ideas

- The queue's speed must come from layout, not batching — the full-review invariant is physical: every approve tap has the full final body on screen
- The escalation SMS is a lead-conversion tool, not a notification: reply text + tap-to-call number is the whole product moment ("call them while they're warm")
- Stall detection keys on touch state precisely so the 05-04 silent-failure mode (deterministic API errors leave no draft row) becomes loud
- The onboarding checklist card answers "why is this client not sending yet?" in one glance — mostly derived, one attested item

</specifics>

<deferred>
## Deferred Ideas

- **Sampled review / graduated autonomy** — V2-01, edit-rate-gated; D-03/D-04 keep v1 clean of its switches
- **Second dedicated alert number for tradie SMS** — revisit when client count or reply confusion justifies the cost (D-06)
- **Operator SMS alerts for stalled drafts** — add only if email proves too slow in practice (D-10)
- **Behavioral SM8-automation detection as the gate** (rather than backstop) — only if the research probe proves the API exposes enough signal (D-13)
- **7-day upcoming-touches schedule view** — revisit if the per-quote next-touch summary proves insufficient (D-20)

</deferred>

---

*Phase: 6-Review Console & Escalation*
*Context gathered: 2026-08-31*
