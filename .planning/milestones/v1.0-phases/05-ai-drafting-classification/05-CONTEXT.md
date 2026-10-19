# Phase 5: AI Drafting & Classification - Context

**Gathered:** 2026-08-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Every touch is Claude-drafted (`claude-sonnet-5`) in the client's approved voice with facts injected from data — prices, dates, and names come from merge data, never from the model — and inbound replies classify (`claude-haiku-4-5`) into the closed enum (interested / question / objection / not-interested / opt-out / other) via structured output, with inbound text structurally unable to steer the system. The phase makes the two D-14 stub gates real: `needs_draft` becomes a genuine drafting stage and `pending_approval` becomes a genuine blocking gate (with a minimal approve/edit action; the full mobile queue is Phase 6). ONB-03 lands here too: voice-profile capture, per-touch template authoring, operator-attested client approval, and the no-approval-no-activation gate. Every draft records model, template/prompt version, and human edit distance (AI-04).

Requirements: AI-01, AI-02, AI-03, AI-04, ONB-03. The approval-queue console, hot-lead SMS escalation, and draft-aging alerts are Phase 6; this phase produces the drafts, labels, and flags Phase 6 consumes.

</domain>

<decisions>
## Implementation Decisions

### Template freedom (AI-01 shape)
- **D-01:** **Bounded rewrite.** The client-approved template fixes each touch's intent, structure, and rough wording; Claude re-renders it per quote in the client's voice. Facts (names, prices, dates) come exclusively from merge data; the post-generation validator proves every price and date verbatim against source data. Not verbatim merge-fill (robotic, arguably fails AI-01), not free composition (approval would cover nothing). — **Reversibility:** costly — the template schema, prompt contract, validator, and what "client approval" legally covers all assume this freedom level; loosening it later re-opens the approval question for every client.
- **D-02:** Drafting context = quote facts (job description, value, customer first name, days since quote) **plus prior-touch history** from our own mirror/send ledger, so later touches don't repeat earlier angles. Nothing is fetched live at draft time.
- **D-03:** Length discipline: prompt targets **1 GSM-7 segment** (including business-name identification + opt-out line); validator **hard-fails anything over 2 segments** and forces regeneration. ClickSend measured at 7.9c/segment — this is both cost control and tone control.
- **D-04:** **SMS-only templates in v1.** Template schema supports email (subject + body) from day one so Phase 4's email arm needs no migration, but onboarding requires only the 5 SMS templates. Email template authoring rides with first-client email enablement (MSG-02 event).

### Voice profile & approval (ONB-03)
- **D-05:** Voice profile = short structured fields (greeting style, sign-off, formality, banned phrases/words) + **2–3 real example messages in the tradie's own words** + free-text notes. The examples carry the voice in the prompt; the structured fields make phone review fast. Hangs off per-tenant drafting config (the `cadence_settings` header already reserves this home).
- **D-06:** **Operator attests approval** on the client's behalf: per-template-version approval with timestamp + free-text evidence note ("approved via email 30/8", "read back on call"). No client-facing approval flow in v1 — clients never see a dashboard.
- **D-07:** The activation gate = **cadence born paused**. `quote_opened` for a tenant without approved templates still creates and materializes the cadence, but paused with a new pause reason (e.g. `onboarding`). Approval resumes via the existing D-07/Phase-3 resume + re-window machinery — no quote opened during onboarding is ever lost, and the operator can see what's waiting. — **Reversibility:** costly — the pause-reason vocabulary is CHECK-constrained (migration 0017 pattern) and the Phase 3 resume rules become the approval-unblock path; moving the gate later means a vocabulary migration plus a re-trigger sweep the pause path gets for free.
- **D-08:** **Editing an approved template creates a new unapproved version.** Drafting keeps using the last approved version until the new one is approved — live cadences never go dark mid-edit. Approval binds to the version; AI-04 records that version on every draft. — **Reversibility:** one-way — draft rows will reference template versions as attribution/audit evidence (AI-04); collapsing versioning later orphans the recorded references.

### Draft timing & failure path
- **D-09:** Drafts generate **at `needs_draft` promotion, in the same tick pass**, batched per tenant (consecutive calls, stable voice-prefix first) to exploit prompt caching. Uses the existing `promoteDue`/`DRAFT_LEAD_HOURS` machinery; drafts appear with full lead time for review.
- **D-10:** **Claude API failure: the touch stays `needs_draft` and the next per-minute tick retries.** If still undrafted near its slot, the existing re-window/stale machinery handles lateness honestly. **Never fall back to sending a raw merge-filled template** — an unreviewed fact-bearing message is the failure mode this phase exists to prevent.
- **D-11:** **Validator rejection: one automatic regeneration** with the violation fed back; a second failure keeps the draft flagged `validator_failed` — it can never be auto-approved (or, in any future sampled-review mode, sampled past a human), only edited-then-approved. Matches SC2's "failures force mandatory review" with one cheap self-heal first.
- **D-12:** **`pending_approval` becomes a real blocking gate in this phase**, with a minimal approve / edit-then-approve action on the existing quote-detail page (Phase 6 builds the proper deadline-sorted queue). The `promoteDue` auto-pass of real Claude drafts is removed — a re-armed client can never send unreviewed AI text. — **Reversibility:** one-way — this is the full-review product invariant (CON-01's default); reintroducing any auto-pass is a v2 graduated-autonomy decision gated on AI-04's edit-rate dataset (V2-01), not an implementation choice.

### Classification consequences (AI-02 / AI-03)
- **D-13:** **A soft opt-out (classified opt-out but not matched by the deterministic STOP regex) is operator-confirmed, never auto-suppressed.** It routes to triage as top priority with a one-tap suggested action that runs the existing `killContact` transaction. The LLM can never write to `suppressed_contacts` — suppression is one-way (Phase 3 D-06) and AI-03 is least-privilege. The deterministic Phase 4 reply-pause has already stopped sends while it waits. — **Reversibility:** one-way — granting model output an irreversible compliance write cannot be safely walked back once any auto-suppression has fired; the privilege boundary is the contract.
- **D-14:** **Labels are evidence + triage priority only in Phase 5.** Label + confidence are recorded on the inbound row; opt-out tops triage; interested/question rows are marked hot — the flag Phase 6's tradie-SMS escalation consumes; objection/not-interested are informational. **No label triggers any state transition** — the deterministic reply-pause already did.
- **D-15:** **Low confidence routes to the operator.** Structured output returns label + confidence; below the threshold the row is treated as `other`/needs-human and surfaces in the existing triage inbox with the model's guess shown but not acted on.
- **D-16:** **Classification runs async, after the webhook has recorded/threaded/paused and returned 200** (post-response or next tick). An Anthropic outage can never delay or fail STOP handling — the inbound compliance path stays LLM-free end to end, preserving MSG-03's "regex before any LLM" invariant.

### Claude's Discretion
- Drafts table / storage shape (one row per generation attempt suggested, evidence-family conventions: tenant_id + RLS, no cascade from tenants) — must record model, template version, prompt version, validator result, and support the AI-04 edit-distance record from the first draft.
- Edit-distance metric and computation point (on approve-with-edits; normalized Levenshtein or similar).
- Validator implementation (how prices/dates are extracted and matched verbatim; what counts as a "date" across formats).
- Prompt architecture details within the decided shape (stable per-client voice block first, volatile quote details last, per CLAUDE.md caching guidance); injection-hardening details for quote-derived text inside drafting prompts (job descriptions are ServiceM8-sourced but still untrusted).
- Classification schema details (strict tool / `output_config.format`), the exact confidence threshold, and where the async classification step runs (post-response vs next cadence-tick pass).
- Exact pause-reason name for the onboarding gate and how approval-resume composes with the existing resume writes (must respect the D-05/upgrade semantics from Phases 3–4).
- Voice-profile and template-version schema specifics; where the minimal approve/edit action lives on the quote-detail page.
- Anthropic API failure taxonomy (rate limit vs outage vs content refusal) and any alerting when drafts age toward their send slot.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The D-14 lifecycle contract this phase fills in (load-bearing)
- `src/db/schema/cadence-touches.ts` — TOUCH_STATUSES vocabulary (`needs_draft`, `pending_approval` are THE Phase 5 gates), skip-reason semantics, materialized-not-computed rule
- `src/db/repository/for-tenant.ts` — `promoteDue` (the stub gate Phase 5 replaces; its status-source list and header notes), repository conventions, PROMOTABLE statuses
- `src/core/cadence/run-tick.ts` — the tick pass structure drafting joins (`DRAFT_LEAD_HOURS` promotion, dispatch ordering, per-tenant batching home)
- `src/core/cadence/dispatch.ts` — claim transaction + JIT revalidation; the drafted body must flow into `SendRequest.body` here
- `src/core/cadence/sender.ts` — `SendRequest`/`SendOutcome`; the Phase 3 stub body composition Phase 5's draft replaces; Spam Act identification must travel with every body
- `src/db/schema/cadence-templates.ts` — per-touch timing/channel rows Phase 5 binds message templates to; snapshot semantics (edits affect only future materializations)
- `src/db/schema/cadence-settings.ts` — header explicitly reserves this row/table family as the home for per-tenant drafting config (voice guide, template block, model prefs); the two-pauses rule
- `src/db/schema/cadences.ts` — contact snapshot columns, pause/status CHECK vocabularies (D-07's new pause reason lands against this pattern), created_by_event_id replay contract

### The classification surface
- `src/db/schema/inbound-messages.ts` — attribution vocabulary, threading rules, T-2-02 body-logging prohibition; classification columns extend this table
- `src/core/cadence/controls.ts` — `killContact` (the one-tap soft-opt-out action), `pauseForReply`, verbatim-address rule
- `src/app/api/webhooks/clicksend/inbound/route.ts` — the webhook flow classification must NOT sit inside (D-16); STOP-regex-before-LLM ordering
- `src/db/schema/suppressed-contacts.ts` — grant-layer irreversibility; the table the LLM must never write (D-13)

### Project planning & platform facts
- `.planning/REQUIREMENTS.md` — AI-01..04 + ONB-03 (this phase); CON-01..04 (what consumes drafts/labels); V2-01 (graduated autonomy is edit-rate-gated, v2)
- `.planning/ROADMAP.md` — Phase 5 goal + success criteria; Phase 6/7 dependencies on drafts, labels, and hot flags
- `.planning/STATE.md` — messaging disarmed status, MSG-02 first-client email obligation, T-2-02/T-3-24 rules, drizzle journal-ordering trap
- `.claude/CLAUDE.md` §Claude model choice / §Stack Patterns — locked models (`claude-sonnet-5` draft, `claude-haiku-4-5` classify), structured outputs via `output_config.format` (never free-text parsing, never deprecated `output_format`), prompt-caching shape (stable voice prefix first), no assistant prefill
- `.planning/phases/03-cadence-engine/03-CONTEXT.md` — D-14 lifecycle contract, D-05 pause semantics, D-07 resume/re-window rule the onboarding gate reuses
- `.planning/phases/04-messaging-gateway/04-CONTEXT.md` — D-01 (no email replies in v1), D-03 (over-suppression is the compliant failure), STOP-before-LLM

### Prior-phase conventions honoured
- `src/core/shared/env.ts` — env validation pattern for `ANTHROPIC_API_KEY`
- `src/app/api/internal/cadence-tick/route.ts` — tick route conventions (own auth, enumerated response fields per T-3-24)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `promoteDue` + `DRAFT_LEAD_HOURS`: touches already surface into `needs_draft` ahead of their slot — Phase 5 hangs drafting off an existing promotion, no new scheduling machinery
- `cadence_touch_templates`: per-tenant per-touch timing/channel rows with snapshot semantics — message-template content extends this family (same tenant, touchNumber keys)
- `cadence_settings`: the pre-planned home for per-tenant drafting config; its header documents why drafting config lives here and not on `tenants`
- Phase 3 pause/resume + re-window machinery: the onboarding gate (D-07) is a new pause reason riding existing resume rules, not new state-machine logic
- `inbound_messages` + triage inbox (Phase 4): classification decorates existing rows and existing triage ordering — no new inbound surface
- `killContact` transaction: the soft-opt-out one-tap action is a UI affordance over an existing guarded write
- Test harness: exhaustive pure state-machine suites (bare `npm test`) + `test:remote` against the hosted Sydney DB (production — never overlap runs; lease/watchdog pause is live)
- No Anthropic SDK in the repo yet — `@anthropic-ai/sdk` is a new dependency (package-legitimacy checkpoint per the Phase 4 precedent)

### Established Patterns
- Closed vocabularies are CHECK-constrained (migration 0017 pattern); new statuses/reasons (onboarding pause, validator flag, classification labels) follow it
- Evidence tables: tenant_id, RLS, no cascade from tenants, read-only to authenticated, service-role writes via transactions — the drafts table is evidence (AI-04)
- zod at every boundary; LLM outputs are a boundary — schema-validate structured outputs even though the API enforces the format
- No customer content in platform logs (T-2-02) — draft bodies and reply bodies live behind RLS only; response bodies enumerate fields (T-3-24)
- Routes own auth, per-endpoint secrets; drizzle journal monotonicity guard after every generate

### Integration Points
- Drafting: tick pass (`run-tick.ts`) → needs_draft touches → Claude draft → validator → `pending_approval` (real gate) → operator approve/edit → `approved` → existing dispatch → `SendRequest.body`
- Classification: inbound webhook (unchanged, LLM-free) → recorded row → async classify step → label/confidence/hot columns → triage ordering now, Phase 6 escalation later
- Onboarding gate: template approval writes → resume of `onboarding`-paused cadences via existing resume + re-window
- AI-04 record: drafts table ↔ send ledger ↔ Phase 7 instrumentation (human-edit rate) and V2-01 graduated autonomy

</code_context>

<specifics>
## Specific Ideas

- The validator is the trust boundary, not the prompt: "prices and dates verbatim in source data" is proven post-generation, mechanically — prompt discipline is a quality tool, never the safety mechanism
- The Spam Act identification (business name + opt-out line) must survive drafting — it travels with every body, counted inside the 1-segment target
- Fallback asymmetry is deliberate: a missed/late touch is recoverable (re-window exists for exactly this), an unreviewed message is not — every failure path resolves toward "don't send"
- Classification's blast radius is bounded by construction: it can raise a human's attention, it can never touch a cadence, a suppression, or a send

</specifics>

<deferred>
## Deferred Ideas

- **Email touch templates required at onboarding** — rides with first-client email enablement (MSG-02 event/override); schema supports them now (D-04)
- **Sampled review / graduated autonomy** — V2-01, gated on 30 days of AI-04 edit-rate data; D-12 explicitly defers any auto-pass to it
- **AI-suggested replies to customer responses** — V2-02; classification labels are the input it will consume
- **Auto-suppression of high-confidence soft opt-outs** — revisit only if triage volume makes operator confirmation burdensome, and then as a policy decision with compliance review, not a code toggle

</deferred>

---

*Phase: 5-AI Drafting & Classification*
*Context gathered: 2026-08-30*
