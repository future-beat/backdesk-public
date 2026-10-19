# Phase 13: Lead Cadence, Labels & Escalation - Research

**Researched:** 2026-10-08 (HEAD `06944ee`, main)
**Domain:** In-repo — the cadence engine's `kind` branches, per-kind policy, lead vocabulary classification, escalation holds, lead closing, migration 0040
**Confidence:** HIGH on every code seam (each file named below was opened with `sed`/`cat` this session at the cited lines); MEDIUM on the proposed policy numbers and default wordings (reasoned, not measured); no web research was needed — the Claude structured-output pattern is reused byte-for-byte from the live-proven classifier.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 The lead cadence is 1 + 2 touches then closed (founder 27 Sep 2026):** touch 1 is the Phase 12 text-back (sent, exempt from hours); touches 2 and 3 already exist inert at `LEAD_TOUCH_OFFSET_DAYS` [0, 1, 2]. This phase re-windows them into the client's contact hours, drafts them, queues them for approval and dispatches them through the existing materialise/approve/dispatch path. After touch 3 is sent, or the cadence ends for any reason, the lead is `closed` (or `expired`) and that lead never sends again.
- **D-02 Touch 2–3 wording: shipped defaults, operator approves each send (founder 8 Oct 2026):** Backdesk ships one default lead template per touch (touch 2 a nudge, touch 3 the last word), stored as `message_templates` rows of a lead kind per tenant with defaults seeded at arming/first use; drafted in the client's voice through the existing drafting prompt with a lead facts block; every draft is approved per message in the existing queue. No client attestation for touches 2–3 (the client attested identity + STOP on touch 1). The D7 warmer existing-customer variant is NOT built.
- **D-03 Per-kind cadence policy (LEAD-05):** `MIN_GAP_HOURS`, `STALENESS_CAP_HOURS`, `CADENCE_EXPIRY_DAYS` and the touch offsets are selected by `cadences.kind`; the quote values are unchanged and the lead values are new named constants in `src/core/leads/constants.ts` (research proposes the numbers; a lead's short timings must never be skipped by the quote's 48-hour minimum gap). One DB-backed test pins both kinds side by side: a lead touch 2 due ~24 h after touch 1 is sent, a quote touch 2 due 24 h after touch 1 is held.
- **D-04 Lead touches obey contact hours; touch 1 does not:** touches 2 and 3 are re-windowed into the tenant's contact window (AWST, WA public holidays as today) at the moment the lead cadence becomes chaseable; a text-back at 2 am yields touch 2 in the first slot next morning, never a 2 am follow-up (PITFALLS §2.3).
- **D-05 Separate `LEAD_LABELS` vocabulary (research D3, founder):** `new_enquiry, callback_request, question, existing_job, complaint, not_a_lead, already_sorted, spam, opt_out, other`, plus `urgency` (`emergency | this_week | flexible | unknown`) and the existing `high|medium|low` confidence; byte-identical in three places (TS const → CHECK → zod), with a structured-output schema. The quote vocabulary `INBOUND_LABELS` is untouched; the classifier picks the vocabulary by the cadence's `kind`. No free-text summary is stored from the model. `service_area` is NOT built (deferred v2).
- **D-06 STOP first, then keywords, then the model:** the STOP regex and suppression run before anything else exactly as today. Then a deterministic keyword rule marks a lead reply hot without the model: `URGENT` as a whole word anywhere, plus a short fixed emergency list (burst, flooding, gas leak, no power, locked out, sparking — final list in research, pinned by tests, case-insensitive, whole words). Keyword hits still get classified afterwards for the label; the hot decision does not wait for the model (founder 8 Oct 2026).
- **D-07 Hot rule for leads (LEAD-03):** hot if `urgency = emergency` at any label except `spam | opt_out | not_a_lead`; else hot if label ∈ {`new_enquiry`, `callback_request`, `existing_job`, `complaint`} at high confidence; else cold. Plus the two model-free triggers: D-06 keywords, and a second missed call from the same caller at the same client within 30 minutes (ring-twice; the second call gets no second text — the Phase 12 `recent_text`/`lead_open` skips stand — only the escalation).
- **D-08 Escalation reuses the existing path to the tradie's escalation phone:** claim-then-send, cooldown, never-twice uniqueness, `missed_call_id` for ring-twice, `inbound_message_id` for replies. The tradie is never texted for every miss. Cold replies pause the lead and sit in the operator inbox like quote replies; the tradie hears about cold leads in the existing 06:30 digest (founder 8 Oct 2026).
- **D-09 After-hours escalation is a per-client switch, default OFF (founder 8 Oct 2026):** `tenants.after_hours_escalation boolean NOT NULL DEFAULT false`, set at onboarding for emergency trades; a hot lead outside the client's contact hours escalates immediately only when the switch is on, otherwise it is held and sent at the start of the next contact window (and named in the 06:30 digest). Emergency-urgency and keyword hits escalate immediately REGARDLESS of hours and of the switch (a caller in an emergency at 11 pm is precisely who rang).
- **D-10 Replies thread to the lead, single-tenant rule:** an inbound SMS from a number with a live lead cadence threads to that lead; the Phase 12 attribution by recipient number + active-cadence lookup stands. A number that is simultaneously on a quote cadence at the same client cannot happen (Phase 12 D-08 gives open-quote callers no lead); if it ever does, the quote cadence wins and the lead is closed with a logged reason. Pause-on-reply, STOP suppression across both channels and DLR reconcile apply unchanged.
- **D-11 Label effects on the lead (state machine):** `new_enquiry`/`callback_request`/`question`/`other` → cadence paused (reply pause), lead stays `open`; `existing_job`/`complaint` → lead `closed` with the label as reason, escalated; `not_a_lead`/`already_sorted`/`spam` → lead `closed`, no further touches; `opt_out` → suppression (if the regex missed it the operator confirms), lead `closed`. Reason is stored on the lead (`closed_reason`, CHECK-bound to the label set plus `touches_exhausted`, `expired`, `operator`, `quote_cadence_wins`).
- **D-12 Repeat callers after close (founder 8 Oct 2026):** a fresh call outside the 24-hour rule from a number whose last lead at that client is closed starts a NEW lead and a new text-back, EXCEPT when that lead closed as `not_a_lead`, `spam`, `complaint` or `opt_out`: then the number is not texted at that client for 90 days (`LEAD_NEGATIVE_COOL_OFF_DAYS`), recorded as a Phase 12 gate skip reason `recent_negative_close`; `opt_out` stays suppressed for good through the existing suppression table. The `lead_open` skip (Phase 12 D-22) stands while a lead is open.
- **D-13 Lead drafting facts and prompt (ARCH):** the drafting prompt gains a lead facts block (caller's verbatim reply if any, after-hours flag, touch number, what touch 1 said) placed AFTER the stable client-voice prefix; `PROMPT_VERSION` is bumped; the existing verbatim/price validators and the Spam Act footer rules apply; no links; identity line + STOP mandatory as on touch 1.
- **D-14 Closing is final and idempotent:** `closeLead(reason)` stops the live cadence (existing stop transition), sets lead status/reason/closed_at once, and is safe to call twice; the one-live-per-lead arbiter stays. Phase 14 adds `DONE` and the ServiceM8 job match (`converted`); Phase 15 adds the lead queue and reporting. No lead is ever reopened; a new call makes a new lead (D-12).
- **D-15 Expiry:** a lead whose touches cannot be sent inside the lead expiry window (e.g. approvals never came) is `expired` by the tick's expiry pass with the lead constants, never by the quote's 42-day rule; the expiry pass gets its `kind` branch.
- **D-16 Schema lands in one migration entry (0040):** `LEAD_LABELS`/urgency columns on `inbound_messages` (nullable, CHECK by kind), `leads.closed_reason`/`closed_at`, `tenants.after_hours_escalation`, lead message templates (kind on `message_templates` or a sibling table — research decides, preferring the existing table), the `recent_negative_close` skip reason on `missed_calls`, held-escalation support (`escalations.hold_until` or equivalent). Push protocol as always.
- **D-17 Quote cadence behaviour is unchanged:** every existing quote test passes untouched; the Phase 12 `lead-cadence-inert` tests are REPLACED by the lead-active tests, not deleted silently; `cadences.kind` branches are named in the plan (dispatch chaseable branch, per-kind policy, arbiter index).

### Claude's Discretion
(CONTEXT.md has no `## Claude's Discretion` section. Everything not locked above is handed to the planner with a default in `## Open Questions`.)

### Deferred Ideas (OUT OF SCOPE)
- Service-area check feeding touch 2; operator spam tags; warmer existing-customer touch; texting the tradie on every miss; booking-form links in touches 2–3.

### Scope and constraints carried (verbatim)
- In: LEAD-01, LEAD-02, LEAD-03, LEAD-05. Out: LEAD-04 (DONE keyword, 14-day ServiceM8 job match → Phase 14); ServiceM8 job creation (14); lead queue page, lead reporting, pseudonymisation (15); service-area check, operator spam/not-a-lead tags, D7 warmer variant (v2 / not built).
- Hosted Supabase is production; migration push protocol before code push; never `test:remote`; `.env*` never named in commands; DB-backed suites run in CI only.
- No text-back has ever been sent on production (12-09 override); nothing is armed; the test tenant is paused with SMS off. Everything here is CI/local-proven until the first client; the plan's human-action checkpoints must not require a second phone.
- 12-REVIEW IN-01..IN-09 open by design; touch any of them only if the work passes through that code.
- GSD model policy: fable for planner/researcher/checker/verifier; opus for executors.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEAD-01 | Each texted caller becomes a lead with its own `kind='lead'` cadence; touch 1 exempt from hours; touches 2–3 AI-drafted from approved lead templates, human-approved in the existing queue, materialised inside contact hours over ~48 h; after touch 3 the lead closes for good | §Q1 (the nine `kind='quote'` predicates and which flip), §Q2 (policy object), §Q3 (windowing), §Q4 (lead templates), §Q5 (drafting), §Q8 (closing), Pitfall 1 (queue page drops rows with no quote id) |
| LEAD-02 | Replies classified into `LEAD_LABELS` + urgency + confidence; STOP deterministic first, exactly as today | §Q6 (three-place vocabulary, schema, kind selection, CHECK shapes), Code Example 3 |
| LEAD-03 | Hot leads reach the tradie through the existing escalation path: emergency urgency, high-confidence enquiry/callback/existing-job/complaint, `URGENT` keyword, ring-twice; after-hours switch | §Q6 keyword rule, §Q7 (escalation claim/cooldown/never-twice, ring-twice pass, `hold_until`/`released_at`, digest section, console toggle) |
| LEAD-05 | Policy (min gap, staleness cap, expiry) chosen per cadence kind; quote unchanged; pinned on both kinds | §Q2 (numbers + where read today + `policyFor(kind)`), §Q10 side-by-side test |
</phase_requirements>

## Summary

Phase 12 left the lead cadence structurally inert with nine `kind = 'quote'` predicates spread over the repository and the tick; Phase 13 flips exactly five of them into per-kind branches (promote, draft-list, claim, rewindow, expiry), leaves four as quote-only by design (resume, `liveQuoteCadenceForMobile`, `createLead`'s arbiter, the consume path), and adds one new branch that is the actual safety line: the first statement of `dispatchOne` must switch on `touch.kind` before `tx.quotes.stateFor` is ever called, because the quote branch's failure arm is the irreversible `mirror_missing` stop (`src/core/cadence/dispatch.ts:356-426`). Policy is selected by a tiny `policyFor(kind)` object that defaults to today's quote constants so every pure suite passes untouched; the lead numbers proposed are `LEAD_MIN_GAP_HOURS = 12`, `LEAD_STALENESS_CAP_HOURS = 24`, `LEAD_EXPIRY_DAYS = 7`, with the offsets `[0, 1, 2]` unchanged — seven days is what a Friday-afternoon call before a long weekend needs so touch 3 is not expired before it can be sent.

The second half is vocabulary and escalation. `LEAD_LABELS` and `LEAD_URGENCIES` follow the `INBOUND_LABELS` discipline exactly (TS const in `src/db/schema/inbound-messages.ts` → CHECK → `z.enum`), the classifier picks the vocabulary by `inbound_messages.lead_id IS NOT NULL` (already written by the inbound door for lead cadences, so no join is added inside the D-13 privilege boundary), and a new `keyword_hot` column is written by the inbound door — not by classification — so the hot escalation query becomes `is_hot OR keyword_hot` and the keyword path never waits on a model. Escalation holds are two columns on `escalations` (`hold_until`, `released_at`) with a claim-then-release pass, chosen over "recompute at tick" because a held backlog would otherwise fill `HOT_ESCALATION_CAP = 25` and starve an emergency trade's hot row. Lead closing is one idempotent `closeLead(reason)` plus a reconciling sweep that maps every terminal cadence state onto `closed_reason`, so STOP, expiry and completion never need a kind branch inside `controls.ts`.

Three things pass every test and fail on the first real lead unless the plan names them: (1) the approval queue page filters out any row whose `quoteId` is null (`src/app/(console)/queue/page.tsx:135-137`), so a drafted lead touch would be invisible and never approvable; (2) `approvedSetStatus()` matches `message_templates` by `(tenant, touch_number, channel='sms')` with no kind — seeding approved lead templates 1–3 would make a client with unapproved quote templates read as onboarding-complete unless the predicate gains `kind = 'quote'`; (3) `leadSchedule`'s fallback branch writes plain day offsets (a 02:00 call → touch 2 at 02:00 next day) and today nothing moves it — the lead rewindow branch plus dispatch's `outside_window` refusal are what make D-04 true.

**Primary recommendation:** one plan for the engine (`policyFor`, the five flips, the dispatch branch, `closeLead` + sweep, migration 0040), one for drafting/templates/queue (kind on `message_templates`, lead facts block, `PROMPT_VERSION = 'p5'`, queue card without a quote link), one for classification + escalation (`LEAD_LABELS`, keyword rule at the door, hot rule, holds, ring-twice, digest section, console toggle), and a final CI/push plan that replaces `tests/lead-cadence-inert.test.ts` with `tests/lead-cadence-active.test.ts` and runs the side-by-side policy test.

## Project Constraints (from CLAUDE.md)

| Directive | Effect on this phase |
|---|---|
| Custom TypeScript + Next.js 16 on Vercel `syd1`, Supabase Sydney; no new service | No new cron job, no pgmq, no `waitUntil`: every new pass rides `runCadenceTick` (`src/core/cadence/run-tick.ts:1251`) and the existing 06:30 digest route |
| `zod` v4 at every boundary; strict structured outputs; `output_config: {format}`; never free-text classification parsing | `LeadReplyClassification = z.object({ label: z.enum(LEAD_LABELS), urgency: z.enum(LEAD_URGENCIES), confidence: ReplyConfidence })`, re-validated with `safeParse` after `messages.parse` exactly as `src/core/classification/classify-inbound.ts:431-445` does today |
| Spam Act sender ID + functional opt-out; DNCR contact-hours discipline; `Australia/Perth`, never store local times | Touch 2–3 bodies end with `complianceSuffix(name)` = `"{Business}. Reply STOP to opt out."` (`src/core/cadence/sender.ts:117-120`); touch 2–3 go through `isInsideWindow`/`nextAllowedSlot`; holds compute `hold_until` as a UTC instant from the tenant window |
| Prompt caching: stable prefix first, volatile last | The lead instruction block and lead templates form the stable system block; lead facts go in the user turn after it (§Q5) |
| drizzle-orm + versioned migrations; no Prisma | Migration 0040 generated then hand-finished per `src/db/migrations/README.md` |
| GSD workflow enforcement; hosted DB is production; never `test:remote` | DB-backed suites in CI only; push protocol from 12-03 Task 2 reused verbatim (§Q9) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Per-kind policy, rewindow, expiry | API / Backend (`src/core/cadence/{rewindow,run-tick}.ts`, new `policy.ts`) | — | Pure policy + tick passes; provable with pinned clocks |
| Lead dispatch branch | API / Backend (`dispatch.ts` inside the claim transaction) | Database (`cadences_one_live_per_lead`, ledger unique) | The chaseable re-read must be in the same transaction as the ledger claim |
| Lead templates + drafting | API / Backend (`draft-touches.ts`, `prompt.ts`) | Database (`message_templates.kind`) | Model call rides the existing per-tenant progress pass |
| Approval of lead drafts | Frontend Server (`/queue` server components + actions) | API / Backend (`approve-draft.ts`) | The queue is the only approval surface in v1.2 |
| Classification (lead vocabulary) | API / Backend (`classify-inbound.ts`) | Database (CHECKs by kind) | Three-place byte identity is enforced by CHECK + zod |
| Keyword hot rule | API / Backend (`src/core/messaging/inbound.ts` at insert) | Database (`keyword_hot`) | Model-free, decided at the door before any tick |
| Escalation (hot / ring-twice / hold / release) | API / Backend (tick passes under `escalationSender`) | Database (`escalations` never-twice indexes, `hold_until`) | Claim-then-send is a database property |
| Lead closing | API / Backend (`src/core/leads/close.ts` + tick sweep) | Database (guarded UPDATEs on `status='open'`) | Idempotence = guard on source status, the house rule |
| After-hours switch | Database (`tenants.after_hours_escalation`) | Frontend Server (client page form + action) | Same shape as the escalation-phone form |
| 06:30 digest lead section | API / Backend (`src/core/aging/stalled-digest.ts` `sections` seam) | — | Operator email; closed vocabulary |

## Standard Stack

No new packages. Everything used is already installed: `drizzle-orm`/`drizzle-kit 0.31.10`, `zod 4.4.3`, `@anthropic-ai/sdk ^0.122.0`, `vitest 4.1.11`, `@date-fns/tz` (via `window.ts`) `[VERIFIED: package.json:39-64, read this session]`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| `kind` column on `message_templates` (D-16 preference) | Sibling `lead_templates` table | Sibling avoids the vacuous-truth trap in `approvedSetStatus` structurally and needs no index rebuild, but adds a table + GRANT block + barrel pins; the kind column is chosen (D-16) and the trap is closed by one predicate + one test (Pitfall 2) |
| `escalations.hold_until` + `released_at` | Recompute hold at every tick, claim only at release | Recompute needs no schema but a held backlog fills `HOT_ESCALATION_CAP = 25` (`for-all-tenants.ts:1229`) and starves other tenants' hot rows overnight; the digest also cannot name "held" without deriving it |
| Reconciling `closeLeadsWithEndedCadences` sweep | Kind branch inside `killContact`/`suppressFromInbound`/completion sweep | The sweep touches no Phase 4 control code (12-REVIEW discipline) and is self-healing; the branches would be three edits in `controls.ts` + one in `for-tenant.ts` |

## Package Legitimacy Audit

No packages are installed by this phase. **Packages removed due to [SLOP] verdict:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
missed call ──► sendTextBack (Phase 12) ──► lead + kind='lead' cadence; touch 1 SENT; touches 2–3 'scheduled' (windowed by materializeCadenceSchedule)
                                                        │
   per-minute tick (runCadenceTick)                      ▼
   ├─ progress: expiry[kind] ─► rewindow[kind policy] ─► promoteDue(both kinds) ─► draftTouches (lead facts block, lead templates)
   ├─ dispatch: claimDue(both kinds) ─► dispatchOne: FIRST STATEMENT switches on touch.kind
   │        quote ─► quotes.stateFor … (unchanged)       lead ─► leads.byId open? + no live quote for mobile? + touch 1 'sent'?
   │                                                           └─ no ─► skip touch 'cadence_stopped', stopWhereLive 'lead_closed' / refuse
   ├─ completion sweep (unchanged) ─► closeLeadsWithEndedCadences (NEW: completed→touches_exhausted, expired→expired, stopped+contact_suppressed→opt_out, …)
   ├─ classification: lead_id NULL ─► INBOUND_LABELS (as today) │ lead_id set ─► LEAD_LABELS + urgency; is_hot by lead rule
   ├─ applyLeadLabelEffects (NEW): closing labels at high confidence ─► closeLead(label)
   ├─ escalation: hotUnescalated WHERE (is_hot OR keyword_hot) ─► hold? (after hours ∧ switch off ∧ not emergency/keyword) ─► claim with hold_until │ else claim+send
   ├─ ringTwice (NEW): skipped recent_text/lead_open call with an earlier call ≤30 min ─► claimEscalationForMissedCall (+hold rule)
   ├─ releaseHeldEscalations (NEW): hold_until ≤ now, released_at NULL ─► guarded claim ─► send
   └─ aging (unchanged: lead touches stall like any other)

inbound SMS ──► handleInboundSms: STOP regex FIRST (unchanged) ─► single match on a lead cadence ─► pauseForReply + insert {lead_id, keyword_hot = isUrgentKeyword(body)}
                                 └─ many matches, ONE tenant, one quote + lead(s) ─► thread to the quote, closeLead('quote_cadence_wins') (D-10)
06:30 digest ──► sections += "Leads": cold replies yesterday / escalations held overnight, per client (operator email)
```

### Recommended Project Structure (new and touched files)

```
src/core/cadence/policy.ts            # NEW: CadencePolicy, QUOTE_POLICY, LEAD_POLICY, policyFor(kind). Imports only the two constants modules.
src/core/cadence/rewindow.ts          # optional `policy` input, defaults = quote constants
src/core/cadence/run-tick.ts          # expiry + rewindow loops per kind; new passes: lead closes, ring-twice, held release
src/core/cadence/dispatch.ts          # kind branch at the top of dispatchOne; DISPATCH_REFUSALS += 'lead_closed'
src/core/leads/constants.ts           # LEAD_MIN_GAP_HOURS, LEAD_STALENESS_CAP_HOURS, LEAD_EXPIRY_DAYS, LEAD_NEGATIVE_COOL_OFF_DAYS, RING_TWICE_WINDOW_MINUTES
src/core/leads/close.ts               # NEW: closeLead(tenantId, leadId, reason), closeLeadsWithEndedCadences(tenantId)
src/core/leads/urgency-keywords.ts    # NEW: URGENT_KEYWORDS, isUrgentKeyword(body) — no imports
src/core/leads/lead-templates.ts      # NEW: DEFAULT_LEAD_TEMPLATE_BODIES (touch 2, touch 3), ensureLeadTemplateDefaults(repo)
src/core/leads/label-effects.ts       # NEW: applyLeadLabelEffects(now) — the D-11 closing labels
src/core/classification/schema.ts     # LeadReplyClassification (label + urgency + confidence)
src/core/classification/classify-inbound.ts  # LEAD_LABEL_DEFINITIONS, LEAD_CLASSIFIER_INSTRUCTIONS, isHotLeadReply, vocabulary by row.leadId
src/core/drafting/prompt.ts           # LEAD_INSTRUCTIONS, LeadFacts, PROMPT_VERSION = 'p5'
src/core/drafting/draft-touches.ts    # per-kind template set + facts
src/core/escalation/escalate-hot-leads.ts    # hold decision; `hold_until`
src/core/escalation/ring-twice.ts     # NEW pass (the quote-call.ts shape)
src/core/escalation/release-held.ts   # NEW pass
src/core/aging/stalled-digest.ts      # leads section
src/db/schema/{inbound-messages,leads,tenants,message-templates,escalations,missed-calls,cadences}.ts
src/db/migrations/0040_phase13_lead_cadence.sql
src/app/(console)/queue/{page,queue-card}.tsx, queue/actions.ts   # lead rows render and approve without a quote id
src/app/(console)/clients/[id]/after-hours-escalation-form.tsx + actions.ts  # the switch
tests/lead-cadence-active.test.ts     # REPLACES tests/lead-cadence-inert.test.ts
```

---

### Q1. The `kind = 'quote'` predicates Phase 12 planted (D-19) — every one, and what Phase 13 does with it

| # | Predicate | Where (opened this session) | Phase 13 | Pinned by (DB-backed unless noted) |
|---|---|---|---|---|
| 1 | `touches.promoteDue` subquery `AND ${cadences.kind} = 'quote'` | `src/db/repository/for-tenant.ts:3373` | **FLIP → both kinds.** Drop the predicate (promotion is kind-blind: `scheduled → needs_draft` inside `DRAFT_LEAD_HOURS`). `DRAFT_LEAD_HOURS = 24` (`src/core/cadence/constants.ts:110`) stays for both kinds — D-03 names only gap/staleness/expiry/offsets | `tests/lead-cadence-active.test.ts`: a lead touch 2 due in 23 h is promoted; `tests/cadence-tick.test.ts` quote promotion untouched |
| 2 | `touches.listNeedsDraft` same subquery | `for-tenant.ts:3397` | **FLIP → both kinds**; `draftTouches` branches on `cadence.kind` (§Q5) | `lead-cadence-active`: the promoted lead touch gets a `touch_drafts` row with `prompt_version = 'p5'` and `quote_id NULL` |
| 3 | `touches.claimDue` `eq(cadences.kind, 'quote')` and the `sql<string>` narrowing of `quoteId`/`sm8JobUuid` | `for-tenant.ts:3470-3523` (predicate at `:3517`) | **FLIP → both kinds.** Select adds `kind: cadences.kind`, `leadId: cadences.leadId`; `ClaimedTouch` becomes `quoteId: string \| null`, `sm8JobUuid: string \| null`, `kind: CadenceKind`, `leadId: string \| null` (`for-tenant.ts:442-453`) | `tests/cadence-dispatch.test.ts` (quote arms unchanged) + `lead-cadence-active`: an approved, due lead touch 2 is dispatched to the stub with `leadId` set and `quoteId: null` in the `SendRequest` |
| 4 | `cadences.listLive(kind = 'quote')` default, read by the **rewindow loop** | `for-tenant.ts:1098` (interface), `:3053-3066` (impl); caller `run-tick.ts:833` | **FLIP (caller-side):** `runProgressPass` iterates `listLive('quote')` with `QUOTE_POLICY` and `listLive('lead')` with `LEAD_POLICY`; the repository default stays `'quote'` | `lead-cadence-active`: a lead touch 2 scheduled at 02:00 is rescheduled by the tick to the window's first slot; `tests/cadence-rewindow.test.ts` pure suite unchanged |
| 5 | `expireOverdueCadences` reads `listLive('quote')` against `CADENCE_EXPIRY_DAYS` | `run-tick.ts:691-726` (`:698`, `:701`) | **FLIP:** second loop over `listLive('lead')` with `LEAD_EXPIRY_DAYS`; on expiry also `closeLead(leadId, 'expired')` inside the same transaction (D-15) | `lead-cadence-active`: a lead anchored 8 days ago with touch 3 `scheduled` → cadence `expired`, touches `cadence_expired`, lead `expired`/`closed_reason='expired'`; a lead anchored 6 days ago is untouched |
| 6 | `applyResumeRewindow` → `listLive()` (default quote) | `src/core/cadence/resume.ts:280` | **LEAVE quote-only, by design.** D-07's gap-preserving resume exists for 3-week quote cadences; a lead paused by a reply and later resumed is repaired by the per-tick lead rewindow (predicate 4) within a minute, under the lead policy. Write this sentence in the plan | `tests/cadence-resume.test.ts` untouched; `lead-cadence-active`: a lead cadence resumed by `resumeCadence` with an overdue touch 3 is rescheduled by the next tick, not burst |
| 7 | `liveQuoteCadenceForMobile` `eq(cadences.kind, 'quote')` | `for-tenant.ts:3028-3041` | **LEAVE.** It is the D-08 "about your quote" routing read; Phase 13 reuses it unchanged inside the lead dispatch branch for the D-10 tie-break (§Q8) | `tests/text-back.test.ts:578` unchanged |
| 8 | `createLead` targeted `onConflictDoNothing` on `cadences_one_live_per_lead` | `for-tenant.ts:3009-3026` | **LEAVE.** The arbiter index stays (D-14/D-17); after `closeLead` the lead's cadence is terminal, so the partial index releases the lead id and `leads_one_open_per_mobile` (`src/db/schema/leads.ts:91-93`) releases the mobile — which is exactly what lets D-12's new lead open | `tests/rls-coverage.test.ts` unique-index pin; `tests/text-back.test.ts:626` (`lead_open`) |
| 9 | Stall alerts + 06:30 digest: `forAllTenants_claimNewlyStalled` / `forAllTenants_stalledTally` read `cadence_touches` by status only, no kind | `src/db/repository/for-all-tenants.ts:1076-1098`, `:1115` | **NO EDIT (already kind-blind).** A lead touch in `pending_approval` stalls like any other and is named in the digest's per-client counts; the digest gains a *separate* Leads section (§Q7) | `tests/stalled-drafts.test.ts` untouched; `lead-cadence-active` asserts a stalled lead touch is claimed by `runAgingPass` |

Two more quote assumptions that are not predicates but will bite: `forAllTenants_approvalQueue` left-joins `quotes` and returns `quoteId: cadences.quoteId` nullable (`for-all-tenants.ts:895-957`) — fine — but **the queue page narrows rows to `quoteId !== null`** (`src/app/(console)/queue/page.tsx:135-137`, comment: "a lead touch never reaches this queue … (D-19)") and `QueueCardRow.quoteId: string` is bound into `approveFromQueue(tenantId, quoteId, …)`, `skipFromQueue`, `editAndApproveFromQueue` (`queue-card.tsx:63,114,230-231`; `queue/actions.ts:153-177`), where `quoteId` is used only for `revalidateQueue` (`queue/actions.ts:131-141`) and the quote link. See Pitfall 1 and §Q5.

### Q2. Per-kind policy (D-03): numbers, where the constants are read today, and the replacement

**Where the quote constants are read today** `[VERIFIED]`:
- `rewindowTouch` imports `CADENCE_EXPIRY_DAYS`, `MIN_GAP_HOURS`, `SAME_DAY_MARGIN_MINUTES`, `STALENESS_CAP_HOURS` from `./constants` (`src/core/cadence/rewindow.ts:61-66`) and reads them at `:171` (expiry), `:182` (staleness), `:228` (min gap).
- `expireOverdueCadences` reads `CADENCE_EXPIRY_DAYS` (`run-tick.ts:701`); `runProgressPass` reads `DRAFT_LEAD_HOURS` (`:852`).
- `computeResumeSchedule` reasons about `MIN_GAP_HOURS` in prose only (`resume.ts:47`); quote-only (Q1 #6).
- The values: `MIN_GAP_HOURS = 48` (`constants.ts:78`), `STALENESS_CAP_HOURS = 72` (`:89`), `CADENCE_EXPIRY_DAYS = 42` (`:99`), `DEFAULT_TOUCH_OFFSET_DAYS = [0, 3, 7, 14, 21]` (`:39`), `SAME_DAY_MARGIN_MINUTES = 60` (`:121`), `JITTER_MAX_MINUTES = 10` (`:66`). Lead: `LEAD_TOUCH_OFFSET_DAYS = [0, 1, 2]` (`src/core/leads/constants.ts:25`).

**Why the quote values break a lead** (the ROADMAP's seam): with offsets `[0,1,2]` touch 2 and touch 3 are 24 h apart. Any reschedule of touch 2 that lands within 48 h of touch 3 — which is every reschedule, since touch 3 is only 24 h away — is retired `min_gap` at `rewindow.ts:224-230`. A lead approved late in the day would lose touch 2 every time, and a lead cadence would sit live for 42 days.

**Proposed lead values** `[ASSUMED — reasoned against the schedule, not measured]`:

| Constant | Value | Reasoning |
|---|---|---|
| `LEAD_MIN_GAP_HOURS` | `12` | Touches 2 and 3 are one calendar day apart at the preferred time (`slotAtOffsetDays`, `window.ts:441-455`). A slipped touch 2 whose candidate lands the same morning as touch 3 (gap ≈ 0) must still be skipped — one message that morning, not two. Half the designed spacing is the largest value that never skips a touch 2 that is merely late *within its own day*: a touch 2 at 09:30 approved at 16:00 is `send_now` (inside window), and one approved at 17:30 becomes `nextAllowedSlot` = tomorrow 09:30 = touch 3's slot → gap 0 < 12 h → `min_gap`, touch 3 carries. Values ≥ 24 would skip touch 2 even when it reschedules to a free morning |
| `LEAD_STALENESS_CAP_HOURS` | `24` | "Yesterday's" follow-up still reads as a follow-up; two days late on a 48-hour promise reads as nobody watching. Exactly 24 h late is still sendable (boundary rule, `rewindow.ts:44-51`). With staleness judged before reschedule, a touch 3 nobody approved for a day is skipped and the cadence completes → lead `touches_exhausted` |
| `LEAD_EXPIRY_DAYS` | `7` | Not 4 (ARCH §3.5). Fri 14:00 call, Mon–Fri window, Monday public holiday: touch 2 rolls to Tue 09:30, touch 3 to Wed 09:30 = 4.8 days after the anchor, plus the 24 h staleness slack = 5.8 days. Expiry is evaluated first (`rewindow.ts:166-173`), so `LEAD_EXPIRY_DAYS = 4` would expire that lead before touch 3 could ever send. Seven covers the long weekend and still bounds a lead to one week; D-15's case (approvals never came) expires on day 8's first tick |
| `LEAD_TOUCH_OFFSET_DAYS` | `[0, 1, 2]` | Unchanged (D-01). Touch 2 ≈ 19–31 h after a daytime touch 1, touch 3 ≈ 43–55 h — "about 48 hours" |
| `LEAD_NEGATIVE_COOL_OFF_DAYS` | `90` | D-12 |
| `RING_TWICE_WINDOW_MINUTES` | `30` | D-07 |

**The policy object** (new `src/core/cadence/policy.ts`, imports only the two constants modules so `rewindow.ts` stays database-free):

```ts
// src/core/cadence/policy.ts
import { CADENCE_EXPIRY_DAYS, DEFAULT_TOUCH_OFFSET_DAYS, MIN_GAP_HOURS, STALENESS_CAP_HOURS } from './constants';
import { LEAD_EXPIRY_DAYS, LEAD_MIN_GAP_HOURS, LEAD_STALENESS_CAP_HOURS, LEAD_TOUCH_OFFSET_DAYS } from '@/core/leads/constants';
import type { CadenceKind } from '@/db/schema/cadences';

export interface CadencePolicy {
  minGapHours: number;
  stalenessCapHours: number;
  expiryDays: number;
  touchOffsetDays: readonly number[];
}
export const QUOTE_POLICY: CadencePolicy = { minGapHours: MIN_GAP_HOURS, stalenessCapHours: STALENESS_CAP_HOURS, expiryDays: CADENCE_EXPIRY_DAYS, touchOffsetDays: DEFAULT_TOUCH_OFFSET_DAYS };
export const LEAD_POLICY: CadencePolicy = { minGapHours: LEAD_MIN_GAP_HOURS, stalenessCapHours: LEAD_STALENESS_CAP_HOURS, expiryDays: LEAD_EXPIRY_DAYS, touchOffsetDays: LEAD_TOUCH_OFFSET_DAYS };
export function policyFor(kind: CadenceKind): CadencePolicy { return kind === 'lead' ? LEAD_POLICY : QUOTE_POLICY; }
```

- `RewindowInput` gains `policy?: Pick<CadencePolicy, 'minGapHours' | 'stalenessCapHours' | 'expiryDays'>`; the three reads at `rewindow.ts:171/182/228` become `(input.policy ?? QUOTE_POLICY).x`. Every existing pure test passes untouched because the default is the quote object (the suite imports the quote constants directly, `tests/cadence-rewindow.test.ts:34-39`).
- `rewindowCadence(tenantId, cadenceId, anchorAt, tenant, now, jitterMinutes)` (`run-tick.ts:740`) gains a `policy` parameter and passes it through; `expireOverdueCadences` gains `(kind, expiryDays)` and, for `kind === 'lead'`, calls `closeLead` for each expired cadence's `leadId` inside the same `repo.transaction` (`:710-725`).
- `CADENCE_KINDS` is `['quote', 'lead']` `[VERIFIED: src/db/schema/cadences.ts:15]`; the loop in `runProgressPass` is `for (const kind of CADENCE_KINDS)`.
- Quote behaviour unchanged: `QUOTE_POLICY` is the same four numbers read from the same module; `tests/cadence-tick.test.ts` and `tests/cadence-rewindow.test.ts` are the regression pins.

### Q3. Re-windowing touches 2–3 into contact hours (D-04)

**Input shapes** `[VERIFIED]`:
- `materializeCadenceSchedule({ anchor, templates: {touchNumber, offsetDays, channel}[], window: ContactWindow, preferredSendTime, jitterMinutes, sameDayMarginMinutes? })` → `{touchNumber, channel, scheduledAt, originalOffsetDays}[]`; offset 0 → `nextAllowedSlot(anchor, …)`, offset N → `slotAtOffsetDays(anchor, N, …)` = the anchor's **tenant-zone calendar date + N** at the preferred time, rolled past non-contact days (`src/core/cadence/materialize.ts:116-163`; `window.ts:441-455`).
- `rewindowTouch({ touch: {scheduledAt}, nextTouch: {scheduledAt} | null, cadenceAnchorAt, window, preferredSendTime, now, jitterMinutes, sameDayMarginMinutes? })` → `send_now | reschedule{at} | skip{min_gap|stale} | expire_cadence` (`rewindow.ts:84-117`, `:159-234`).
- `ContactWindow = { timezone, contactHoursStart, contactHoursEnd, contactDays }`; `isInsideWindow` checks ISO weekday ∈ `contactDays` and `start ≤ minutes < end` (`window.ts:185-195`). **There is no public-holiday handling anywhere in `src/`** (grep `holiday` → no hits in `.ts`/`.tsx`), so D-04's "WA public holidays as today" means *contact days only*; a holiday Monday is a contact day unless the client's `contact_days` says otherwise. State this in the plan; do not build holidays.

**How the quote path computes `due_at`:** `consume-events.ts` materialises the five quote touches at consumption; `scheduled_at` is the stored UTC instant with jitter baked in (`materialize.ts:26-35`). Dispatch never moves a slot; the progress pass is the only writer of a new `scheduled_at` (`dispatch.ts:470-478`, "CAD-05 (c)").

**What Phase 12's `createLead` path wrote for touches 2–3** `[VERIFIED: src/core/leads/text-back.ts:456-470, :632-675]`: `leadSchedule(now, preferred, window)` builds three templates from `LEAD_TOUCH_OFFSET_DAYS` and calls `materializeCadenceSchedule` with `jitterMinutes: () => 0`; touch 1's `scheduledAt` is overridden to `now`; touches 2–3 are therefore **already inside the window** (preferred time on anchor-date +1 and +2, rolled past non-contact days) — **except in the `catch` fallback**, which writes `now + offsetDays × 24 h` with a `console.warn('[text-back] lead schedule fallback')` — a 02:00 call becomes touch 2 at 02:00 tomorrow. The fallback fires only when the tenant's window is unusable (`InvalidContactWindowError` / `NoAllowedContactDayError`), which the arming gate makes unlikely but not impossible.

**The exact moment/pass that re-windows them:** there is no "delivered" or "sent" trigger and none is needed. Two mechanisms, both already in the engine once the lead policy exists:
1. **Creation** (unchanged): the windowed placement above.
2. **The tick's progress pass, lead branch** (Q1 #4): every tick, each unsent overdue lead touch is judged by `rewindowTouch` with `LEAD_POLICY`; a slot at 02:00 is not due until 02:00, at which point `mayContactNow` is false → `reschedule` to `nextAllowedSlot` = the window's preferred slot that morning. Dispatch's `outside_window` refusal (`dispatch.ts:470-478`) is the second belt: even if the rewindow pass failed for the tenant, nothing sends outside the window. **D-04's "2 am → first slot next morning" is therefore true for the fallback path; for the normal path a 02:00 Wednesday call yields touch 2 Thursday 09:30** (anchor date Wed + 1). See Open Question 1 for the choice between "next morning" (Wed 09:30, ~7.5 h later) and "day + 1" (Thu 09:30); the default keeps day + 1 because PITFALLS §4.6 wants the tradie to have the whole business day to ring back before touch 2.

**"Chaseable" for a lead** (the dispatch branch, §Q8) also requires touch 1's ledger outcome to be `'sent'` — a lead whose text-back failed must not receive "still need a hand?" (Open Question 3, default yes).

### Q4. Lead templates (D-02): `message_templates` with a `kind` column

**Today** `[VERIFIED: src/db/schema/message-templates.ts:95-137]`: columns `touch_number`, `channel` (CHECK `channel IN ('sms', 'email')`, `:137`), `version`, `body`, `subject`, `approved_at`, `approval_note`; unique `message_templates_tenant_touch_channel_version_uniq (tenant_id, touch_number, channel, version)` (`:130-135`). Its identity is `(tenant, touch, channel)` — a lead touch 2 and a quote touch 2 would collide on version 1. Quote **shape** rows live in `cadence_touch_templates` (offsets), seeded by `templates.ensureDefaults(DEFAULT_TOUCH_OFFSET_DAYS)` from `consume-events.ts:779` with `onConflictDoNothing` on `(tenant_id, touch_number)` (`for-tenant.ts:2604-2621`); quote **wording** rows are inserted by the drafting console (`clients/[id]/drafting/actions.ts:433`) and approved write-once by `approveWhereUnapproved`.

**Decision: add `kind text NOT NULL DEFAULT 'quote'` to `message_templates`** (D-16's preference), CHECK `message_templates_kind_known (kind IN ('quote','lead'))`, and replace the unique index with `message_templates_tenant_kind_touch_channel_version_uniq (tenant_id, kind, touch_number, channel, version)`. **Every quote predicate gains `kind = 'quote'`** — there are five, all in `for-tenant.ts`: `latestApproved` (`:2623-2636`), `latestApprovedSet` (`:2646`), `insertVersion` (version computed per key), `listVersions`, and `approvedSetStatus` (`:2737-2765` — the EXISTS matches `message_templates` by `(tenant_id, touch_number, channel='sms', approved_at IS NOT NULL)` with **no kind**; this is the vacuous-truth trap in Pitfall 2). New: `latestApprovedSet(channel, kind)` (second arg default `'quote'`) and `ensureLeadDefaults()`.

**Seeding (D-02 "at arming/first use"):** `ensureLeadDefaults` inserts touch 2 and touch 3 rows with `kind='lead'`, `channel='sms'`, `version=1`, `approved_at = now()`, `approval_note = 'Backdesk default lead wording (Phase 13, D-02)'`, `onConflictDoNothing` on the new unique index. Call it (a) from `armChannel('text_back')` and (b) as a belt inside `draftTouches`'s lead branch when `latestApprovedSet('sms','lead')` is empty. Pre-approved by construction: the operator approves every *draft*, not the template (D-02). Touch 1 is not a `message_templates` row — it stays in `text_back_templates` (attested bytes).

**Default wording** `[ASSUMED — proposal for the founder; follows the 12-RESEARCH Templates rules: question-led, plain ASCII, no links, no numbers, identity + STOP via the mechanically appended suffix]`. The body is the *model's* input (rewritten in the client's voice, `prompt.ts:260-300`); `complianceSuffix(name)` = `"{Business}. Reply STOP to opt out."` is appended at draft time (`draft-touches.ts` `suffix`; `sender.ts:117-120`) — that suffix **is** the identity line and the STOP. The validator caps the whole at two segments (`validate.ts:109`); ≤ 110 characters of body keeps one segment for names up to ~20 characters.

- Touch 2 (nudge, day +1): `Following up on your call yesterday. Still need a hand? Reply with the job and your suburb and we'll be in touch.` (107 chars, GSM-7 basic)
- Touch 3 (last word, day +2): `Last one from us. If you still need a hand with the job you rang about, reply here any time. Otherwise, no worries.` (111 chars)

Neither contains a digit, a month/weekday word, a link or a price, so `validateDraft` can only refuse a draft for a model-introduced number, a non-GSM character, a third segment or a missing suffix — all of which it should. Both avoid "yesterday" in touch 3 (touch 3 is two days on). The D7 warmer variant is not built.

### Q5. Drafting (D-13)

**Where the facts block is built** `[VERIFIED: src/core/drafting/draft-touches.ts:798-848]`: `repo.cadences.getById` → `CadenceRow = Pick<Cadence, 'quoteId' | 'contactName' | 'anchorAt'>` (`:232`) → `quote = cadence.quoteId ? repo.quotes.byId(…) : []` (already null-safe, `:807`) → `buildMergeFacts({ totalInvoiceAmount, quoteDateUtc, anchorAt, contactName, timezone, now })` (`merge-facts.ts:152-166`) → `QuoteFacts { contactFirstName, jobDescription, totalDisplay, quoteDateDisplay, daysSinceQuoteDisplay }` (`prompt.ts:129-141`) → `buildDraftPrompt({ voiceProfile, templates, quoteFacts, priorBodies, touchNumber, allowedDisplayStrings, regenerationFeedback })` (`:316`). `priorBodies = repo.drafts.sentBodiesForCadence(cadenceId)` — for a lead this already contains **touch 1's attested text-back body** (the Phase 12 draft row is `status='approved'`, touch `sent`), which is D-13's "what touch 1 said" for free. Templates come from `repo.templates.latestApprovedSet('sms')` once per batch and are picked per touch via `templateByTouch.get(touch.touchNumber)` (`:586-590`).

**`PROMPT_VERSION = 'p4'`** (`prompt.ts:95`), pinned by `tests/drafting-prompt.test.ts:85` ("is p4 — p3 plus the spelled-out-numeral rule") → becomes `'p5'`; the test moves by design.

**Validators** `[VERIFIED: src/core/drafting/validate.ts:213-348]`: `unlisted_number` (every digit run must be an allowed run), `unlisted_date_word` (capitalised month/weekday not in the allowed strings), `non_gsm_character`, `too_many_segments` (> 2), `missing_suffix`, `empty_body`. **All apply to a lead draft unchanged.** The allowed list for a lead is `buildMergeFacts` with null money/date → `[daysSinceDisplay]` only (the same thing `editThenApprove` already computes for a quote-less cadence at `approve-draft.ts:482-500`), so a lead draft may state the day count and nothing else numeric.

**Lead facts block shape** (user turn, after the stable prefix):

```
# This message
Write touch 2 of 3, using the approved template numbered for that touch.

# Facts you may state (copy character for character)
<<<QUOTE_DATA
Kind of message: follow-up after a missed call
The caller rang: after hours          ← leads.after_hours
Days since the call: 1                 ← daysSinceDisplay (anchor = the call)
What the caller said, if anything: (none)   ← newest inbound_messages row with lead_id, sanitized + capped 500 (sanitizeUntrusted)
QUOTE_DATA>>>

# The only numbers and dates permitted in your reply
- 1

# Already sent on this quote (do not repeat these angles)
- Hi, it's Acme Plumbing. Sorry we missed your call. … Privacy: backdesk.com.au/privacy
```

`BuildDraftPromptInput` gains `kind: CadenceKind` and `facts: QuoteFacts | LeadFacts` (discriminated); for `kind === 'lead'` the system block uses `LEAD_INSTRUCTIONS` ("You write SMS follow-ups for an Australian trade business after a missed call. The caller has not told us what they need; never invent a job, a price, a time or a suburb; no links; one question at most") and the lead template set. The byte-identity test ("stable system block is byte-identical across two quotes of one tenant", `drafting-prompt.test.ts:134`) gets a lead twin. No name fact: a lead has no `contact_name` (`createLead` sets none, `for-tenant.ts:3012-3020`).

**How batch drafting picks lead touches:** `listNeedsDraft` loses its kind predicate (Q1 #2); inside `draftClaimedBatch` the template set is loaded **per kind** (`latestApprovedSet('sms','quote')` and `('sms','lead')`), and per touch `cadence.kind` chooses the set, the facts and the instruction block. `CadenceRow` gains `kind` and `leadId`; `DraftRepository.leads.byId` and `inbound.latestForLead(leadId)` are the two new reads. Prompt caching: the lead system block is a second stable prefix per tenant — cheap, harmless.

**`editThenApprove`** (`approve-draft.ts:464-520`) already derives its whitelist from a quote-less cadence correctly; no change beyond the type widening.

### Q6. Classification (D-05/D-06)

**`INBOUND_LABELS` in three places** `[VERIFIED]`: (1) `export const INBOUND_LABELS = ['interested', 'question', 'objection', 'not_interested', 'opt_out', 'other'] as const` (`src/db/schema/inbound-messages.ts:140-147`), `LABEL_CONFIDENCES = ['high', 'medium', 'low']` (`:155`); (2) CHECK `inbound_messages_label_known`: `label IS NULL OR label IN ('interested', 'question', 'objection', 'not_interested', 'opt_out', 'other')` (`:296-298`) and `inbound_messages_label_confidence_known` (`:300`); (3) `ReplyLabel = z.enum(INBOUND_LABELS)`, `ReplyClassification = z.object({ label, confidence })` (`src/core/classification/schema.ts:53-69`), bound to the wire by `output_config: { format: zodOutputFormat(ReplyClassification) }` (`classify-inbound.ts:431`) and re-validated with `safeParse` (`:441-445`). The prompt derives its definitions from a `Record<InboundLabel, string>` so a new label is a type error until described (`:125-152`).

**Change list for `LEAD_LABELS` + `urgency`:**
1. `inbound-messages.ts`: `export const LEAD_LABELS = ['new_enquiry', 'callback_request', 'question', 'existing_job', 'complaint', 'not_a_lead', 'already_sorted', 'spam', 'opt_out', 'other'] as const;` `export const LEAD_URGENCIES = ['emergency', 'this_week', 'flexible', 'unknown'] as const;` columns `urgency: text('urgency')`, `keywordHot: boolean('keyword_hot').notNull().default(false)`; CHECKs in §Q9.
2. `schema.ts`: `LeadReplyLabel = z.enum(LEAD_LABELS)`, `LeadUrgency = z.enum(LEAD_URGENCIES)`, `LeadReplyClassification = z.object({ label: LeadReplyLabel, urgency: LeadUrgency, confidence: ReplyConfidence })`. No free-text field (D-05). Same wire shape as today; no new API feature is needed, so no web research was done.
3. `classify-inbound.ts`: `LEAD_LABEL_DEFINITIONS: Record<LeadLabel, string>`, `URGENCY_DEFINITIONS: Record<LeadUrgency, string>`, `LEAD_CLASSIFIER_INSTRUCTIONS` ("…a stranger's reply to a text sent after they rang a tradesperson and the call was missed…"); `ask(body, kind)` chooses model schema + system block; `isHotLeadReply(label, urgency, confidence)` (D-07); `record` writes `urgency` for lead rows (`'unknown'` on the empty-body path).
4. `inbound-messages.ts` repository: `UnclassifiedRow` gains `leadId` (one more selected column; still no join — `tests/classification-privilege.test.ts:274` holds); `ClassificationWrite` gains `urgency: string | null` (the "exactly four columns" pin at `:220` becomes five, by design).
5. `rls-coverage` adds the new CHECK names.

**The vocabulary is picked by `row.leadId !== null`**: `handleSingleMatch` already writes `leadId: candidate.leadId` for a lead cadence (`src/core/messaging/inbound.ts:287`, proven by `tests/lead-reply.test.ts:178`). Ambiguous/unmatched rows have `lead_id NULL` and keep today's quote classifier — unchanged behaviour.

**Where the STOP regex runs** `[VERIFIED]`: `isStopMessage` with `STOP_PATTERN = /^\s*(?:stop\s*all|stop|unsubscribe|cancel|end|quit|opt[\s-]?out)\s*[.!]?\s*$/i` (`src/core/messaging/stop-keywords.ts:65-66`) is the first line of `handleInboundSms` (`inbound.ts:216-224`), before the cadence lookup. A whole-body match only — "URGENT, no power" is not a STOP. Unchanged.

**`isUrgentKeyword(body)`** — new `src/core/leads/urgency-keywords.ts`, no imports, run by `handleSingleMatch` only when `candidate.leadId !== null`, after the STOP branch (a STOP body never reaches it):

```ts
export const URGENT_KEYWORDS = ['urgent', 'emergency', 'burst', 'flooding', 'flooded', 'gas leak', 'smell gas', 'no power', 'locked out', 'sparking'] as const;
const PATTERN = new RegExp(`\\b(?:${URGENT_KEYWORDS.map((k) => k.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
export function isUrgentKeyword(body: string): boolean { return typeof body === 'string' && PATTERN.test(body); }
```

False-positive analysis (pinned by `tests/urgency-keywords.test.ts`): "no worries" ✗ (phrase is `no power`, not `no`); "no hot water" ✗ (deliberately excluded — a quote, not an emergency for most trades); "sparky" ✗ (`sparking` only; `\b` stops "sparky"/"spark plug"); "gas hot water quote" ✗ (`gas leak`/`smell gas` only); "burst out laughing" ✓ false positive, implausible in a reply to a tradie; "stop flooding me with texts" ✓ false positive — and correct in effect, since a complaint is hot under D-07 anyway; **"not urgent" / "it's not an emergency" ✓ false positive** — the one real cost (see Open Question 4; the locked rule says "anywhere" and the direction of error is one extra SMS to the tradie, followed by the model's `flexible` urgency on the row). `URGENT`'s `\b` means "urgently" is ✗ — add `urgently` if the founder wants it. Case-insensitive, whole words, multi-word phrases tolerate any whitespace.

**Null-safety by kind — the CHECK shapes** (all nullable, plain, pre-flighted by a read-only count of `inbound_messages WHERE lead_id IS NOT NULL` on production, expected 0):

```sql
inbound_messages_label_known      → label IS NULL
                                     OR (lead_id IS NULL     AND label IN ('interested','question','objection','not_interested','opt_out','other'))
                                     OR (lead_id IS NOT NULL AND label IN ('new_enquiry','callback_request','question','existing_job','complaint','not_a_lead','already_sorted','spam','opt_out','other'))
inbound_messages_urgency_known    → urgency IS NULL OR urgency IN ('emergency','this_week','flexible','unknown')
inbound_messages_urgency_lead_only→ urgency IS NULL OR lead_id IS NOT NULL
inbound_messages_lead_label_has_urgency → lead_id IS NULL OR ((label IS NULL) = (urgency IS NULL))
inbound_messages_keyword_hot_lead_only  → keyword_hot = false OR lead_id IS NOT NULL
```

`is_hot` keeps its single writer (classification) — the keyword path writes `keyword_hot`, and the hot query reads `(is_hot OR keyword_hot)`. That is why `writeClassification` needs no `OR` and the D-13 boundary tests move by exactly one column.

### Q7. Escalation (D-07/D-08/D-09)

**Existing shape** `[VERIFIED]`: `escalateHotLeads` (`src/core/escalation/escalate-hot-leads.ts:192-356`): no sender → no scan; `forAllTenants_hotUnescalated(limit = HOT_ESCALATION_CAP = 25)` = `inbound_messages JOIN cadences LEFT JOIN quotes LEFT JOIN escalations ON inbound_message_id WHERE is_hot AND attribution='threaded' AND escalations.id IS NULL ORDER BY received_at` (`for-all-tenants.ts:1309-1346`); per row: tenant escalation phone via `normalizeAuMobile`, `resolveSmsFrom`, cooldown `recentEscalationForCadence(cadenceId, now − ESCALATION_COOLDOWN_MINUTES)` (`message.ts:72` = 30; `escalations.ts:304`), lead id read back for a quote-less cadence, **claim** `claimEscalation` (targetless `onConflictDoNothing`, `escalations.ts:106-121`; never-twice = `escalations_inbound_message_uniq`), then `no_escalation_number` / `sms_not_configured` / `cooldown_suppressed` recorded without a provider call, else `buildEscalationSms({ customerName, quoteSnippet: LEAD_REPLY_SNIPPET = 'missed call', replyText, customerMobile })` and `recordEscalationOutcome` (`sent` or `codeOf(reason)`). A throw after the claim leaves `outcome NULL` and is **never retried**. `ESCALATION_OUTCOMES = ['sent', 'no_escalation_number', 'sms_not_configured', 'cooldown_suppressed']` (`src/db/schema/escalations.ts:109-114`; `outcome` has no CHECK — provider codes are written verbatim).

Phase 12's `claimEscalationForMissedCall({ missedCallId, tenantId, cadenceId, quoteId, toAddress, at })` is targeted on `escalations_missed_call_uniq` (`escalations.ts:161-181`); `escalations_one_trigger` CHECK makes exactly one of `inbound_message_id`/`missed_call_id` non-null (`schema/escalations.ts:198`); `escalateQuoteCalls` (`quote-call.ts:60-262`) is the scan-then-claim template to copy for ring-twice, including its age bound (`QUOTE_CALL_ESCALATION_MAX_AGE_HOURS = 24`, `leads/constants.ts:134`).

**Ring-twice** (new `src/core/escalation/ring-twice.ts`, same seam, directly after the quote-call pass):
- Data: the second call is recorded by Phase 12 as `skipped` with `recent_text` (within 24 h of the text) or `lead_open`, after `noteRepeatCall` bumped the open lead (`text-back.ts:349`, `:340-347`; `for-tenant.ts:4144-4160`). The skipped row carries **no `lead_id`/`cadence_id`** today (`setTextBackDecision`'s skipped arm, `for-tenant.ts:4037-4060`). **Edit:** when the skip reason is `recent_text` or `lead_open` and `noteRepeatCall` returned a row, write `leadId` and the lead's live `cadenceId` onto the skipped missed call (the `quote_open` arm already writes `cadenceId`, so the patch type has the shape).
- Query `listUnescalatedRingTwiceCalls(limit, { notBefore, windowMs })`: `missed_calls m2 WHERE m2.tenant_id IS NOT NULL AND m2.caller_kind='mobile' AND m2.text_back_status='skipped' AND m2.text_back_skip_reason IN ('recent_text','lead_open') AND m2.lead_id IS NOT NULL AND coalesce(m2.ended_at, m2.started_at) >= notBefore AND EXISTS (SELECT 1 FROM missed_calls m1 WHERE m1.tenant_id = m2.tenant_id AND m1.caller_e164 = m2.caller_e164 AND m1.id <> m2.id AND m1.started_at >= m2.started_at − 30 min AND m1.started_at < m2.started_at) AND NOT EXISTS (escalation with missed_call_id = m2.id) AND EXISTS (leads l WHERE l.id = m2.lead_id AND l.status='open')`. Bounded by `missed_calls_tenant_started_idx`.
- Claim `claimEscalationForMissedCall` with `leadId` (widen `MissedCallEscalationClaim`), cooldown as today, hold rule as below, SMS `buildQuoteCallEscalationSms`-shaped: "{caller mobile} rang twice in 30 min and was missed. Call them: …" (new builder beside `message.ts:404`, same septet budget).
- D-07: the second call sends nothing (the Phase 12 gate decided that); the tradie is never texted for a single miss.

**Held after-hours escalations — `hold_until` + `released_at`** (chosen over recompute-at-tick; see Alternatives):
- Decision inside `escalateHotLeads` and the ring-twice pass, before the claim: `immediate = row.urgency === 'emergency' || row.keywordHot` (D-09 "regardless"); `inside = isInsideWindow(now, contactWindowOf(tenant))`; `hold = !immediate && !inside && !tenant.afterHoursEscalation`. The tenant row is already read per tenant (`escalate-hot-leads.ts:234-240`); `after_hours_escalation` rides it. `forAllTenants_hotUnescalated` selects `urgency`, `keywordHot`, `leadId` and filters `(is_hot OR keyword_hot)`.
- If `hold`: claim with `hold_until = nextWindowOpen(now, win)` and `outcome NULL`; count `escalationHeld`. `nextWindowOpen` is a new export in `window.ts` built from the existing private `rollToAllowedSlot(today, win, start, from)` (`nextAllowedSlot`'s own branch at `window.ts:367-399` uses it with the preferred-time minutes; passing `start` yields the window's opening minute on the next allowed day, or `from` if already inside). Pin it: 23:00 Tue → Wed 08:00 for an 08:00–17:00 Mon–Fri window; Fri 19:00 → Mon 08:00; Sat 10:00 → Mon 08:00.
- `releaseHeldEscalations(now, sender)` (new pass, after ring-twice): `UPDATE escalations SET released_at = now WHERE hold_until <= now AND released_at IS NULL AND outcome IS NULL RETURNING …` (the release **claim**, so a throw after it is never retried — the same never-twice discipline); skip with outcome `lead_closed` if the lead is no longer open; else send and record as today. Partial index `escalations_held_idx (hold_until) WHERE hold_until IS NOT NULL AND released_at IS NULL`.
- Cooldown interplay: a held row created 23:00 suppresses a second hot reply at 23:10 (`cooldown_suppressed`), which is right — the 07:00 release carries the first reply's words. An emergency reply at 23:40 on the same lead is not held and sends at once; the 07:00 release still sends (the held row is > 30 min old) — two texts, both true; acceptable.

**What the 06:30 digest needs** `[VERIFIED: src/core/aging/stalled-digest.ts:88-240; src/core/alerts/stalled-drafts.ts:67-70]`: the digest is the **operator's** email (`OPERATOR_ALERT_EMAIL`, `stalled-drafts.ts:243-248`), assembled from `perTenantCounts` plus a `sections: DigestSection[] = { heading, lines }` seam filled by `defaultSections(now)` (`stalled-digest.ts:156-194`). Add `buildLeadsSection(rows, now)` → heading `Leads` with closed-vocabulary lines: `"{client}: {n} cold lead repl(y|ies) in the last 24 h waiting in the inbox"` and `"{client}: {n} hot lead(s) held overnight — released at {HH:MM} ({zone})"` (from `escalations WHERE hold_until > now − 24 h`). No numbers from a caller, no bodies. The digest is skipped when every section is empty (`:213-225`) — a leads line only appears when there is one. **There is no tradie-facing digest in the codebase**; D-08's "the tradie hears about cold leads in the existing 06:30 digest" can only mean through the operator (Open Question 5).

**`tenants.after_hours_escalation` and the console toggle:** `tenants` has no boolean today (`src/db/schema/tenants.ts:27-45`); add `afterHoursEscalation: boolean('after_hours_escalation').notNull().default(false)`. `TenantPatch = Partial<Omit<Tenant, 'id' | 'createdAt'>>` (`for-tenant.ts:152`) admits it automatically through `tenant.update` (`:2396`). The toggle copies `EscalationPhoneForm` + `updateEscalationPhoneAction` (`clients/[id]/actions.ts:439-486`: `authorize(tenantId)` → zod → `forTenant(tenantId).tenant.update(…)` → `revalidatePath`) and renders directly below the escalation-phone form on the client page (`clients/[id]/page.tsx:916`), with a `<dt>After-hours escalation</dt><dd>On/Off</dd>` row in the profile list beside "Escalation phone" (`:905-909`). Default OFF; copy: "Text {escalation phone} about hot leads outside contact hours (emergencies and URGENT replies are always sent)".

### Q8. Lead closing (D-11/D-12/D-14/D-15)

**`closeLead(tenantId, leadId, reason, now)`** — new `src/core/leads/close.ts`, one `forTenant(tenantId).transaction`:
1. `tx.cadences.liveForLead(leadId)` (new read: `kind='lead' AND lead_id=$1 AND status IN ('active','paused')`, at most one row by the arbiter index) → if present and `reason !== 'expired'`: `tx.cadences.stopWhereLive([id], 'lead_closed')` + `tx.touches.skipUnsentForCadences([id], 'cadence_stopped')` (the existing stop pair, `dispatch.ts:430-437`); if `reason === 'expired'`: `tx.cadences.markExpired([id])` + `skipUnsentForCadences(…, 'cadence_expired')` (`run-tick.ts:710-725`).
2. `tx.leads.close(leadId, reason, now)` = `UPDATE leads SET status = CASE WHEN $reason='expired' THEN 'expired' ELSE 'closed' END, closed_reason=$reason, closed_at=$now, updated_at=$now WHERE tenant_id=$1 AND id=$2 AND status='open' RETURNING id`.
3. Returns `{ kind: 'closed' } | { kind: 'already_closed' }` by the RETURNING count. Idempotent by the two guards (`status='open'`, `status IN live`) — the house rule (`for-tenant.ts:1103-1110`). Never throws on a terminal row.

**Against `cadenceTransition`** `[VERIFIED: src/core/cadence/transitions.ts:138-151, :412-433]`: `CADENCE_EVENTS = ['customer_reply','won','lost','removed','reopened','contact_killed','client_paused','client_resumed','operator_resumed','operator_closed','expired_deadline','all_touches_done']`; the machine is total and kind-agnostic. `closeLead` does **not** add an event — it calls `stopWhereLive` with a new stop reason, exactly as `dispatchOne` does with `mirror_missing` without an event (`dispatch.ts:430`). Add `'lead_closed'` to `CADENCE_STOP_REASONS` (`src/db/schema/cadences.ts:285-294`, today `['won','lost','removed','reopened','contact_suppressed','operator_closed','no_contact','mirror_missing']`) and widen `cadences_stop_reason_known` in the 0022 idiom (`0022_mirror_missing_stop_reason.sql:36-43`). No `lead_converted` yet (Phase 14 adds it when it needs it).

**The reconciling sweep `closeLeadsWithEndedCadences(tenantId)`** (tick, right after `runCompletionSweep`): `SELECT l.id, c.status, c.stop_reason FROM leads l JOIN cadences c ON c.lead_id = l.id AND c.kind='lead' WHERE l.tenant_id=$1 AND l.status='open' AND c.status IN ('completed','expired','stopped')` → `closeLead` with: `completed → 'touches_exhausted'` (D-01: touch 3 sent, or skipped, and the completion sweep closed the cadence — `completeWhereAllTouchesDone` is kind-blind, `for-tenant.ts:3218-3248`); `expired → 'expired'`; `stopped` + `contact_suppressed → 'opt_out'` (a STOP via `suppressFromInbound` → `killContact`, `controls.ts:391`, `:261`, kind-agnostic, needs no edit); `stopped` + `operator_closed → 'operator'`; `stopped` + `lead_closed` → already closed by `closeLead` (no-op by the guard). The sweep is what makes "every exit closes the lead" a scan rather than four edits in Phase 4 code.

**`applyLeadLabelEffects(now)`** (tick, after classification, before escalation): `inbound_messages im JOIN leads l ON l.id = im.lead_id WHERE im.label IN ('existing_job','complaint','not_a_lead','already_sorted','spam','opt_out') AND im.label_confidence = 'high' AND l.status='open'` → `closeLead(label)`. Pause-on-reply for the four open labels is already done at the door (`pauseForReply`, `inbound.ts:290`). Self-healing (no marker column: a closed lead leaves the set). High confidence only — see Open Question 2 (D-12's 90-day cool-off hangs off `spam`/`not_a_lead`, so a low-confidence model guess must not blacklist a number).

**`leads.closed_reason` CHECK list** (D-11): `IN ('new_enquiry','callback_request','question','existing_job','complaint','not_a_lead','already_sorted','spam','opt_out','other','touches_exhausted','expired','operator','quote_cadence_wins')` — the full label set is admitted so the CHECK is the vocabulary, not the policy. Consistency: `leads_closed_iff_reason`: `(status IN ('closed','expired')) = (closed_reason IS NOT NULL)`; `leads_closed_at_with_reason`: `(closed_reason IS NULL) = (closed_at IS NULL)`; `leads_expired_reason`: `status <> 'expired' OR closed_reason = 'expired'`. `LEAD_STATUSES = ['open', 'converted', 'closed', 'expired']` `[VERIFIED: src/db/schema/leads.ts:57]` — `converted` (Phase 14) carries no `closed_reason` under these CHECKs, so Phase 14 is not blocked.

**The one-live-per-lead arbiter** stays; `leads_one_open_per_mobile (tenant_id, contact_mobile) WHERE status='open'` (`leads.ts:91-93`) releases the mobile on close so D-12's new lead inserts cleanly.

**The 90-day gate (D-12) — exact insertion into `decideTextBack`** `[VERIFIED: src/core/leads/gate.ts:93-134]`: the order is `not_armed → own_number → withheld → not_mobile → suppressed → recent_text → daily_cap → stale → sms_not_armed → no_template`. Insert **`recent_negative_close` between `suppressed` (5) and `recent_text` (6)** — it is a per-caller "must not text" fact like suppression, and D-06's relative order among its seven is preserved (which is what `tests/text-back-gate.test.ts` pins: "a fact set that trips two rules returns the earlier"; and `:103` pins that the gate vocabulary equals `TEXT_BACK_SKIP_REASONS` in the same order minus the two send-path reasons — so the const gains the member at the same position). The fact: `lastNegativeCloseAt: Date | null` from a new read `tx.leads.latestForMobile(caller)` = `SELECT closed_reason, closed_at FROM leads WHERE tenant_id=$1 AND contact_mobile=$2 ORDER BY created_at DESC LIMIT 1` (index `leads_tenant_mobile_created_idx`), evaluated in `decideInTransaction` beside the suppression probe (`text-back.ts:393-397`): refuse when the newest lead's `closed_reason IN ('not_a_lead','spam','complaint','opt_out')` and `closed_at >= now − 90 d`. `TEXT_BACK_SKIP_REASONS` `[VERIFIED: src/db/schema/missed-calls.ts:129-142]` = `['not_armed','own_number','withheld','not_mobile','suppressed','recent_text','daily_cap','stale','sms_not_armed','no_template','lead_open','quote_open']` → `recent_negative_close` after `suppressed`; CHECK widened in §Q9.

**D-10 tie-break:** in `handleInboundSms`, when `candidates.length > 1` and every candidate shares one `tenantId` and exactly one is a quote cadence (`quoteId !== null`): thread to the quote candidate via `handleSingleMatch`, then `closeLead(leadId, 'quote_cadence_wins')` for each lead candidate, log ids only. Cross-tenant ambiguity stays `ambiguous` (`tests/lead-reply.test.ts:290` and `inbound-threading.test.ts:274` keep passing). The same rule inside the lead dispatch branch: `liveQuoteCadenceForMobile(touch.contactMobile)` non-empty → `closeLead('quote_cadence_wins')`, refuse `lead_closed`.

**Expiry pass kind branch:** Q1 #5 and Q2.

**The lead dispatch branch** (the first statement of `dispatchOne`, `dispatch.ts:356-363`):

```ts
if (touch.kind === 'lead') {
  const [lead] = touch.leadId ? await tx.leads.byId(touch.leadId) : [];
  const quoteLive = touch.contactMobile ? await tx.cadences.liveQuoteCadenceForMobile(touch.contactMobile) : [];
  const firstSent = (await tx.ledger.listForCadence(touch.cadenceId)).some((r) => r.touchNumber === 1 && r.outcome === 'sent');
  const chaseable = lead?.status === 'open' && quoteLive.length === 0 && firstSent;
  if (!chaseable) {
    await tx.touches.skipWhere([touch.id], 'cadence_stopped');
    const stopped = await tx.cadences.stopWhereLive([touch.cadenceId], 'lead_closed');
    if (stopped.length > 0) await tx.touches.skipUnsentForCadences([touch.cadenceId], 'cadence_stopped');
    if (lead && lead.status === 'open') await tx.leads.close(lead.id, quoteLive.length > 0 ? 'quote_cadence_wins' : 'expired', now);
    return { kind: 'refused', reason: 'lead_closed' };
  }
  // fall through to the shared tail: address, suppression, window, approved body, ledger claim, markSent
}
```

`DISPATCH_REFUSALS` `[VERIFIED: src/core/cadence/dispatch.ts:162-212]` = `['paused','quote_closed','mirror_missing','suppressed','outside_window','claim_lost','no_address','no_approved_draft']` → add `'lead_closed'` (the tick's `Record<DispatchRefusal, number>` stays closed; `tests/cadence-tick-route.test.ts:490` pins the refusal key set and moves by design). The `SendRequest` at `:529-540` becomes `quoteId: touch.quoteId, leadId: touch.leadId`.

### Q9. Migration `0040_phase13_lead_cadence.sql` — exact change list (12-RESEARCH format)

One journal entry; `when` must exceed 0039's `1791222883774` `[VERIFIED: src/db/migrations/meta/_journal.json, idx 39]`. Generate with `npm run db:generate`, rename the tag, hand-finish per `src/db/migrations/README.md` (delete any generated statement touching `cadences_one_live_per_job`, `cadences_one_per_opened_event`, `cadences_id_tenant_uniq`, `cadences_replay_key_present`; rewrite every widened CHECK as `DROP CONSTRAINT IF EXISTS` then `ADD`).

**A. Columns that change nullability:** none.

**B. New columns**

| Table | Column | Notes |
|---|---|---|
| `leads` | `closed_reason text NULL`, `closed_at timestamptz NULL` | D-11/D-14 |
| `inbound_messages` | `urgency text NULL`, `keyword_hot boolean NOT NULL DEFAULT false` | D-05/D-06 |
| `tenants` | `after_hours_escalation boolean NOT NULL DEFAULT false` | D-09 (0004's hand-written CHECKs on `tenants` are untouched) |
| `message_templates` | `kind text NOT NULL DEFAULT 'quote'` | D-02/D-16 |
| `escalations` | `hold_until timestamptz NULL`, `released_at timestamptz NULL` | D-09 |

**C. CHECKs** (all plain; pre-flight read-only counts: `inbound_messages WHERE lead_id IS NOT NULL` = 0 expected; `leads` rows = 0 expected on production since nothing was ever armed — 12-09)

```sql
-- leads
leads_closed_reason_known      → closed_reason IS NULL OR closed_reason IN ('new_enquiry','callback_request','question','existing_job','complaint','not_a_lead','already_sorted','spam','opt_out','other','touches_exhausted','expired','operator','quote_cadence_wins')
leads_closed_iff_reason        → (status IN ('closed','expired')) = (closed_reason IS NOT NULL)
leads_closed_at_with_reason    → (closed_reason IS NULL) = (closed_at IS NULL)
leads_expired_reason           → status <> 'expired' OR closed_reason = 'expired'
-- inbound_messages (DROP IF EXISTS + ADD for the first)
inbound_messages_label_known, _urgency_known, _urgency_lead_only, _lead_label_has_urgency, _keyword_hot_lead_only   (shapes in §Q6)
-- message_templates
message_templates_kind_known   → kind IN ('quote','lead')
-- missed_calls (DROP IF EXISTS + ADD)
missed_calls_text_back_skip_reason_known → … IN ('not_armed','own_number','withheld','not_mobile','suppressed','recent_negative_close','recent_text','daily_cap','stale','sms_not_armed','no_template','lead_open','quote_open')
-- cadences (0022 idiom)
cadences_stop_reason_known     → … IN ('won','lost','removed','reopened','contact_suppressed','operator_closed','no_contact','mirror_missing','lead_closed')
-- escalations
escalations_release_needs_hold → released_at IS NULL OR hold_until IS NOT NULL
```

**D. Indexes**

| Index | Definition | Purpose |
|---|---|---|
| `message_templates_tenant_kind_touch_channel_version_uniq` (UNIQUE) | `(tenant_id, kind, touch_number, channel, version)` — **replaces** `message_templates_tenant_touch_channel_version_uniq` (drizzle emits the DROP + CREATE; check it) | lead and quote touch 2 coexist |
| `leads_tenant_mobile_created_idx` | `(tenant_id, contact_mobile, created_at DESC)` | the 90-day gate read, the tie-break |
| `escalations_held_idx` (partial) | `(hold_until) WHERE hold_until IS NOT NULL AND released_at IS NULL` | the release pass |
| `inbound_messages_lead_label_idx` (partial) | `(lead_id, label) WHERE lead_id IS NOT NULL` | label-effects pass |

Unchanged and still correct: `cadences_one_live_per_lead`, `leads_one_open_per_mobile`, `escalations_missed_call_uniq`, `escalations_inbound_message_uniq`, `missed_calls_text_back_caller_idx`.

**E. New tables:** none. **GRANT blocks:** none needed (no new table). **F. Data statements:** none — `message_templates.kind` backfills to `'quote'` by DEFAULT; every other new column is nullable or defaulted, so Phase 12 code meeting the 0040 schema stays legal (Pitfall 5 of 12-RESEARCH).

**G. Repository/types that change:** `ClaimedTouch` (+`kind`, `leadId`, nullable quote fields), `CadenceRow` in `draft-touches.ts` (+`kind`, `leadId`), `UnclassifiedRow` (+`leadId`), `ClassificationWrite` (+`urgency`), `EscalationClaim`/`MissedCallEscalationClaim` (+`leadId`, `holdUntil`), `HotUnescalatedReply` (+`urgency`, `keywordHot`, `leadId`), `TextBackDecisionPatch` skipped arm (+`leadId`, `cadenceId`), `ApprovalQueueRow` (+`leadId`, `kind`), new `forTenant` methods: `leads.close`, `leads.latestForMobile`, `leads.listOpenWithEndedCadence`, `cadences.liveForLead`, `templates.ensureLeadDefaults`, `templates.latestApprovedSet(channel, kind)`, `inbound.latestForLead`; new barrel exports: `listUnescalatedRingTwiceCalls`, `claimHeldEscalationRelease`, `listHeldEscalationsForDigest`, `forAllTenants_coldLeadRepliesSince` — each moves `tests/lint-ban.test.ts`'s exhaustive export pin and `tests/sync-upsert.test.ts`'s `forAllTenants_*` tripwire by design (write the containment paragraph).

**Push protocol** (12-03 Task 2, verbatim in effect): read-only pre-flight counts agree with the plain/NOT VALID decisions → `cron:status` shows `remote_test_lease rows 0` and no watchdog → `db:generate` reports no schema changes → `db:migrate` exits 0 recording **41** journal entries → a second `db:migrate` is a no-op at 41 → read-back shows the new columns/CHECKs → only then push `main` (schema before code). Over the session connection (5432), never the pooler (`README.md:6-9`).

### Q10. Test plan

**Pure (local, seconds):**
- `tests/cadence-policy.test.ts` (new): `policyFor('quote')` is byte-equal to the four quote constants; `policyFor('lead')` to the four lead constants; `rewindowTouch` with `LEAD_POLICY`: a lead touch 2 whose candidate lands at touch 3's slot is `min_gap`; exactly 12 h before is `reschedule`; exactly 24 h late is `send_now`/`reschedule`, 24 h + 1 ms is `stale`; exactly 7 days is live, + 1 ms is `expire_cadence`. The existing `tests/cadence-rewindow.test.ts` is **untouched** (its imports are the quote constants).
- `tests/urgency-keywords.test.ts` (new): the full word list hot; "no worries", "sparky", "gas hot water", "urgently" cold; "URGENT" / "Urgent!" hot; the STOP-shaped bodies never reach it (asserted at the door test).
- `tests/lead-labels.test.ts` (new): `LEAD_LABELS`/`LEAD_URGENCIES` spelled identically in the schema const, the CHECK literal in the schema file text, and `z.enum` (the `classification-privilege` read-the-file shape, `:283-299`); `isHotLeadReply` matrix (10 labels × 4 urgencies × 3 confidences = 120 cells, decided once).
- `tests/drafting-prompt.test.ts`: `'p5'`; lead system block byte-identical across two leads of one tenant; lead facts in the user turn; no name line; `tests/drafting-validate.test.ts`: both default lead bodies + suffix pass at ≤ 2 segments for a 120-char name.
- `tests/text-back-gate.test.ts`: `recent_negative_close` sits after `suppressed`, before `recent_text`; a caller both suppressed and negatively closed is `suppressed`.
- `tests/escalation-hold.test.ts` (pure part): `shouldHold` truth table (inside/outside × switch × emergency/keyword); `nextWindowOpen` boundaries (Tue 23:00 → Wed 08:00; Fri 19:00 → Mon 08:00; inside → now).
- `tests/classify-inbound.test.ts`: lead row → `LeadReplyClassification` schema and `LEAD_CLASSIFIER_INSTRUCTIONS`; quote row unchanged; empty body on a lead writes `other/low/unknown`; `tests/classification-privilege.test.ts`: five columns, no `tools`, no join.

**DB-backed (CI only):**
- `tests/lead-cadence-active.test.ts` **replaces** `tests/lead-cadence-inert.test.ts` (same seeds: `seedLead`, `seedLeadCadence`, `seedTouches`, `seedApprovedDraft`, `tests/helpers/seed.ts:725-815`): a lead touch 2 approved and overdue inside an always-open window is dispatched (ledger row touch 2, `lead_id` set, `quote_id NULL`); touch 3 `scheduled` and overdue is promoted; the 8-day-old lead expires with `closed_reason='expired'`; `refusals.mirror_missing === 0`; the quote control still dispatches. Keep the inert file's **control** block verbatim (D-17: replaced, not deleted silently — the plan names the rename in its commit message).
- **The D-03 side-by-side test** (`tests/lead-policy-both-kinds.test.ts`): one tenant, one lead cadence (touch 1 sent at T, touch 2 approved at T + 24 h, touch 3 scheduled T + 48 h) and one quote cadence (touch 1 sent at T, touch 2 approved and **rescheduled into** T + 24 h, touch 3 at T + 72 h) — tick at T + 24 h + 1 min outside the window at T + 24 h − 2 h so both touches are re-windowed first: the lead touch 2 is `send_now`/dispatched; the quote touch 2 is skipped `min_gap` (48 h rule) and the quote's touch 3 stands. Then the same seeds with the window open: lead sends, quote sends — proving the kinds are decided by policy, not by luck.
- `tests/lead-close.test.ts`: `closeLead` twice → `closed` once, cadence `stopped/lead_closed`, touches `cadence_stopped`; the sweep maps `completed → touches_exhausted` (seed touch 3 sent), STOP → `opt_out` through `handleInboundSms`; a new text-back for the closed mobile opens a new lead (D-12) except after a `spam` close → `recent_negative_close` and no lead; 91 days later → new lead.
- `tests/lead-reply.test.ts` extended: lead reply gets a lead label + urgency; `keyword_hot` written at the door for "URGENT no power"; a full tick escalates it before any model (classifyClient `null`); a hot non-emergency reply at 23:00 for a switch-off tenant is claimed with `hold_until` and sends nothing; the release pass at 08:00 sends once; the same with `after_hours_escalation = true` sends at 23:00; emergency urgency at 23:00 with the switch off sends at 23:00.
- `tests/ring-twice.test.ts`: two missed calls 10 min apart from one mobile → one escalation keyed on the second `missed_call_id`, the second call `skipped/recent_text`, no second text; 31 min apart → none; a third call → none (never-twice + cooldown).
- `tests/approval-queue.test.ts` + `tests/text-back-repository.test.ts`: a lead draft appears in `forAllTenants_approvalQueue` with `quoteId null`, `leadId` set, and `approveFromQueue` approves it; `tests/onboarding-gate.test.ts`: approved lead templates 1–3 with unapproved quote templates → **not** onboarding-complete (Pitfall 2).
- `tests/rls-coverage.test.ts`: new CHECK names; the replaced `message_templates` unique index.

**Gaps where a test would pass and the first real lead would fail — the ROADMAP's three seams and two more:**
1. *Dispatch chaseable branch* — tested only with the stub sender; the real path adds `RoutingSender` resolution — identical to a quote touch, already live-proven for quotes. Residual: none beyond the live first-client proof already carried.
2. *Per-kind policy* — the pure suite proves the numbers; the DB test proves the tick selects by kind. Residual: the **weekend/holiday** case (Fri call + Monday holiday) is a pure-suite case, not a DB one — add it to `cadence-policy.test.ts` explicitly.
3. *Arbiter index* — `createLead`'s targeted conflict is proven (`text-back.test.ts:626`); after `closeLead` the index must release — `lead-close.test.ts` proves the re-open. Residual: none.
4. *The queue page narrowing* (Pitfall 1) — no DB test renders the page; add a pure test that reads `queue/page.tsx` and asserts the `quoteId !== null` filter is gone, and a card test with `quoteId: null`.
5. *The window-start helper* — if `nextWindowOpen` is implemented with the preferred time instead of `start`, every test with `preferred = start` passes and production releases at 09:30 not 08:00. Pin with a window whose preferred time differs from its start.

### Anti-Patterns to Avoid
- **Calling `tx.quotes.stateFor` before the kind switch.** The quote branch's failure arm stops the cadence `mirror_missing` irreversibly (`dispatch.ts:366-426`). The kind switch is the first statement.
- **A `kind` predicate forgotten on one of the five `message_templates` reads** (Pitfall 2). Name all five in the plan task.
- **Letting classification write `is_hot` from the keyword rule.** The door writes `keyword_hot`; classification's write surface stays the D-13 boundary.
- **Holding by skipping the claim.** A held backlog fills `HOT_ESCALATION_CAP = 25` and silently starves other tenants; claim with `hold_until`.
- **Retrying a release whose send threw.** The release is a guarded UPDATE on `released_at IS NULL`; a throw after it leaves the row released with `outcome NULL`, never resent — the 03-01 ledger rule for a tradie's handset.
- **Closing a lead on a low-confidence `spam`/`not_a_lead`.** It blacklists a real caller for 90 days with no reopen path (D-14). High confidence or operator only.
- **Adding `lead_converted` now.** Phase 14 owns it; an unused stop reason is a CHECK member nothing writes (the `body_unreadable` lesson, 12-RESEARCH §C).
- **Building public-holiday logic.** None exists; D-04 says "as today".
- **Logging a caught value, a body, or a number.** Every catch in `run-tick.ts`, `dispatch.ts`, `escalate-hot-leads.ts` discards it; the digest's vocabulary is names and integers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Slot placement inside contact hours | A lead-specific "next morning" calculator | `nextAllowedSlot` / `slotAtOffsetDays` / `preferredSlotOnOrAfter` (`window.ts:367-455`) | One slot chooser, DST-proven in `cadence-window.test.ts` |
| Policy switching | `if (kind === 'lead') MIN = 12` scattered at call sites | `policyFor(kind)` object with the quote default | The ROADMAP's seam: a scattered value is four values |
| Structured classification | Free-text parsing or a second tool-use pattern | `zodOutputFormat(LeadReplyClassification)` + `safeParse` (`classify-inbound.ts:425-445`) | CLAUDE.md ban; live-proven on `claude-haiku-4-5`/Opus 5 |
| Never-twice escalation | A check-then-insert | `claimEscalation` / `claimEscalationForMissedCall` + partial unique indexes | Two overlapping ticks produce one text |
| Idempotent close | A read-then-write with a status check in TS | Guarded `UPDATE … WHERE status='open' RETURNING` | The house rule since 03-01 |
| Draft validation for leads | A lighter "lead validator" | `validateDraft` with `allowedDisplayStrings = [daysSince]` | Same rules, smaller whitelist |
| The 06:30 roll-up | A second email or a tradie SMS digest | `runStalledDigest`'s `sections` seam | Closed vocabulary; one morning email |

**Key insight:** every primitive this phase needs — windowed slots, guarded claims, kind-blind state machine, structured outputs, the digest seam — already exists and is pinned; the work is branching on `kind` in the right five places and refusing to branch in the four where the quote path must stay byte-identical.

## Runtime State Inventory

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | Production has **zero** `leads`, zero `kind='lead'` cadences and zero `inbound_messages` with `lead_id` (nothing was ever armed, 12-09); `message_templates` rows are all quote rows → backfilled `kind='quote'` by DEFAULT | Pre-flight read-only counts before 0040; no data migration |
| Live service config | pg_cron jobs: the per-minute cadence tick and the 06:30 digest route are unchanged by name (`tests/cron-schedules.test.ts` must not move) | none |
| OS-registered state | None — verified by grep for cron/schedules; everything rides the two existing jobs | none |
| Secrets/env vars | None new; `OPERATOR_ALERT_EMAIL`, ClickSend and Anthropic keys are read as today | none |
| Build artifacts | drizzle snapshot `meta/0040_snapshot.json` generated with the migration | commit it with the migration |

## Common Pitfalls

### Pitfall 1: the approval queue hides every lead draft
**What goes wrong:** touch 2 is promoted, drafted, parked `pending_approval` — and never appears on `/queue`, so it stalls, the digest nags, and nothing sends.
**Why:** `page.tsx:135-137` narrows rows to `quoteId !== null` (written in Phase 12 precisely because lead touches were inert); `QueueCardRow.quoteId: string` drives the "Open the quote" link and the three bound actions.
**How to avoid:** `ApprovalQueueRow` gains `leadId`, `kind`; the page keeps both; the card renders "Missed call · touch 2 of 3" with no quote link for `kind='lead'`; actions take `{ quoteId: string | null }` and `revalidateQueue` skips the quote path when null (`actions.ts:140`). The inbox already guards its link (`inbox/page.tsx:267`), but its soft-opt-out suppress form needs `quoteId` (`:282-290`) — give it a cadence-only variant so an operator can confirm a lead's `opt_out`.
**Warning signs:** `touchesPromoted` and `touchesDrafted` non-zero while `/queue` shows nothing; `stallAlertSent` for a client with no quotes.

### Pitfall 2: lead templates make the quote onboarding gate vacuously true
**What goes wrong:** a client whose quote templates 2 and 3 are unapproved reads as onboarding-complete, resumes born-paused quote cadences and sends unapproved-template drafts.
**Why:** `approvedSetStatus()` (`for-tenant.ts:2737-2765`) matches `message_templates` on `(tenant, touch_number, channel='sms', approved_at IS NOT NULL)` with no kind; seeded, pre-approved lead rows for touch 2 and 3 satisfy it.
**How to avoid:** `kind = 'quote'` in that EXISTS and in the four sibling reads; `tests/onboarding-gate.test.ts` seeds approved lead rows and asserts the gate is still unmet.

### Pitfall 3: `leadSchedule`'s fallback writes a 02:00 slot and the fallback is silent in prod
**What goes wrong:** an unusable window at text-back time yields plain day offsets (`text-back.ts:664-674`), i.e. a 02:00 touch 2.
**How to avoid:** the lead rewindow branch moves it at its first due tick; dispatch's `outside_window` refusal is the second belt; `lead-cadence-active` seeds a 02:00 slot and asserts the reschedule. Do not "fix" the fallback — it exists so the text-back itself never fails on a window error.

### Pitfall 4: the held backlog starves the hot scan
**What goes wrong:** with "recompute at tick", twenty-five held rows at the head of `ORDER BY received_at` fill the cap and an emergency trade's hot row at 02:00 is never reached.
**How to avoid:** claim with `hold_until`; held rows leave the unescalated set.

### Pitfall 5: `writeClassification` overwrites a keyword hot
**What goes wrong:** the door sets `is_hot = true` for "URGENT"; classification's four-column write sets `is_hot = false` for `flexible/medium`; the escalation scan (same tick, later) sees cold.
**How to avoid:** `keyword_hot` is its own column; the hot predicate is `(is_hot OR keyword_hot)`.

### Pitfall 6: the migration's rewritten `inbound_messages_label_known` meets a local lead row with a quote label
**What goes wrong:** CI databases built from the journal have no rows; a developer's local stack that ran `lead-reply.test.ts` (which labels a lead row with the *quote* vocabulary today) refuses the plain CHECK.
**How to avoid:** the plan's local-stack step is `supabase db reset` (fresh) before `db:migrate`; production is pre-flighted (count 0).

### Pitfall 7: `revalidatePath` and the quote page for a lead
**What goes wrong:** `revalidateQueue(tenantId, quoteId)` with a lead's null id builds `/clients/{id}/quotes/null`.
**How to avoid:** the `UUID_PATTERN` guard at `queue/actions.ts:140` already skips it when the argument is not a uuid — pass `''` for leads and keep the guard.

### Pitfall 8: `tests/cron-schedules.test.ts` and `report-metrics.test.ts` must not move
Any plan that adds a cron job or edits a metrics twin is wrong by construction (12-RESEARCH "tests that break by design").

## Code Examples

### 1. The per-kind progress loop (`run-tick.ts:810-908`, after)
```ts
for (const kind of CADENCE_KINDS) {
  const policy = policyFor(kind);
  const expiry = await expireOverdueCadences(tenant.tenantId, now, kind, policy.expiryDays); // lead: also closeLead('expired') in the same tx
  totals.cadencesExpired += expiry.expired; totals.touchesSkipped += expiry.touchesSkipped;
  for (const cadence of await repo.cadences.listLive(kind)) {
    if (cadence.status !== 'active' || expiry.expiredIds.has(cadence.id)) continue;
    const moved = await rewindowCadence(tenant.tenantId, cadence.id, cadence.anchorAt, tenant, now, jitterMinutes, policy);
    // … totals as today
  }
}
const promoted = await repo.touches.promoteDue(now, DRAFT_LEAD_HOURS * MS_PER_HOUR); // both kinds
```

### 2. `rewindowTouch` with a policy (`rewindow.ts:159-234`, the three reads)
```ts
const policy = input.policy ?? QUOTE_POLICY;
if (now.getTime() - cadenceAnchorAt.getTime() > policy.expiryDays * MS_PER_DAY) return { kind: 'expire_cadence' };
if (lateBy > policy.stalenessCapHours * MS_PER_HOUR) return { kind: 'skip', reason: 'stale' };
// …
if (gap < policy.minGapHours * MS_PER_HOUR) return { kind: 'skip', reason: 'min_gap' };
```

### 3. The lead classification call (the `classify-inbound.ts:425-445` shape, unchanged wire pattern)
```ts
const lead = row.leadId !== null;
response = await client.messages.parse({
  model: CLASSIFY_MODEL,
  max_tokens: MAX_CLASSIFY_TOKENS,
  system: lead ? LEAD_CLASSIFIER_INSTRUCTIONS : CLASSIFIER_INSTRUCTIONS,
  messages: [{ role: 'user', content: body }],
  output_config: { format: zodOutputFormat(lead ? LeadReplyClassification : ReplyClassification) },
} as Anthropic.MessageCreateParamsNonStreaming);
const parsed = (lead ? LeadReplyClassification : ReplyClassification).safeParse(response.parsed_output);
// isHot = lead ? isHotLeadReply(label, urgency, confidence) : isHotLead(label, confidence)
```
```ts
export function isHotLeadReply(label: LeadLabel, urgency: LeadUrgency, confidence: string): boolean {
  if (urgency === 'emergency' && label !== 'spam' && label !== 'opt_out' && label !== 'not_a_lead') return true;
  if (confidence !== 'high') return false;
  return label === 'new_enquiry' || label === 'callback_request' || label === 'existing_job' || label === 'complaint';
}
```

### 4. The hold decision and claim (`escalate-hot-leads.ts:265-275`, after)
```ts
const immediate = row.urgency === 'emergency' || row.keywordHot;
const hold = !immediate && !isInsideWindow(now, contactWindowOf(tenant)) && !tenant.afterHoursEscalation;
const claimed = await claimEscalation({ …, leadId, holdUntil: hold ? nextWindowOpen(now, contactWindowOf(tenant)) : null });
if (claimed === null) continue;
if (hold) { counts.held += 1; continue; }   // outcome stays NULL until the release pass
```

### 5. `closeLead` (new `src/core/leads/close.ts`)
```ts
export async function closeLead(tenantId: string, leadId: string, reason: LeadClosedReason, now: Date) {
  return forTenant(tenantId).transaction(async (tx) => {
    const [cadence] = await tx.cadences.liveForLead(leadId);
    if (cadence) {
      if (reason === 'expired') {
        const ended = await tx.cadences.markExpired([cadence.id]);
        if (ended.length > 0) await tx.touches.skipUnsentForCadences([cadence.id], 'cadence_expired');
      } else {
        const stopped = await tx.cadences.stopWhereLive([cadence.id], 'lead_closed');
        if (stopped.length > 0) await tx.touches.skipUnsentForCadences([cadence.id], 'cadence_stopped');
      }
    }
    const rows = await tx.leads.close(leadId, reason, now); // WHERE status = 'open'
    return { kind: rows.length > 0 ? 'closed' : 'already_closed' } as const;
  });
}
```

## State of the Art

| Old Approach (Phase 12) | Current Approach (Phase 13) | When Changed | Impact |
|---|---|---|---|
| `kind = 'quote'` predicates make lead touches inert | `policyFor(kind)` + kind branches; inert test replaced by active test | this phase | Lead touches flow through the same promote/draft/approve/dispatch path |
| Quote vocabulary on lead replies (D-18 interim) | `LEAD_LABELS` + urgency by `lead_id` | this phase | Lead-specific hot rule; CHECK by kind |
| Escalation is immediate or never | `hold_until`/`released_at` with a release pass | this phase | After-hours discipline for the tradie, per client |

**Deprecated/outdated:** `tests/lead-cadence-inert.test.ts` (replaced by design, D-17); the `page.tsx:131-137` comment that "a lead touch never reaches this queue".

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `LEAD_MIN_GAP_HOURS = 12`, `LEAD_STALENESS_CAP_HOURS = 24`, `LEAD_EXPIRY_DAYS = 7` | Q2 | Too-short expiry expires long-weekend leads; too-long gap skips touch 2; all pinned at boundaries so a change is one constant |
| A2 | Default touch 2/3 wording | Q4 | Founder may reword; stored as versioned template rows so a later edit is a new version |
| A3 | `URGENT_KEYWORDS` list and the absence of a negation guard | Q6, OQ4 | "not urgent" costs one extra tradie SMS |
| A4 | Closing labels apply at high confidence only | Q8, OQ2 | If any confidence were wanted, low-confidence `spam` would blacklist real callers for 90 days |
| A5 | Day + 1 placement for after-hours calls (Thu 09:30 for a 02:00 Wed call) | Q3, OQ1 | If "next morning" is meant literally, touch 2 arrives ~7.5 h after the text and before the tradie's business day |
| A6 | The 06:30 digest is operator-facing; no tradie digest is built | Q7, OQ5 | If the founder meant a tradie SMS summary, that is new surface (out of this phase's requirements) |
| A7 | `nextWindowOpen` can be built from `rollToAllowedSlot` with `start` minutes | Q7 | If the private helper's signature differs, implement from `windowBounds` + `isoWeekdayOfDate` (exported at `window.ts:147`) — pin with preferred ≠ start |

## Open Questions (RESOLVED)

1. **After-hours call → touch 2 placement: day + 1 or "next morning"?**
   - What we know: creation already places touch 2 on anchor-date + 1 at the preferred time (`slotAtOffsetDays`); D-04's words say "first slot next morning"; PITFALLS §4.6 wants the tradie to have a full business day first; D-01 locks offsets `[0,1,2]`.
   - Recommendation / planner default: **keep day + 1** (a 02:00 Wednesday call → Thursday 09:30); pin it in `lead-cadence-active`. If the founder wants Wednesday 09:30, the change is one line in `leadSchedule` (offset 1 → `preferredSlotOnOrAfter(anchor + LEAD_MIN_GAP_HOURS)`), not a policy change. **RESOLVED with default.**
2. **Do closing labels (D-11) apply at any confidence?** Default: **high only**; medium/low lead replies pause the cadence and sit in the inbox (today's `needsHuman` behaviour); `closed_reason='operator'` is reserved for Phase 15's lead controls. **RESOLVED with default.**
3. **Is a lead whose touch 1 ledger outcome is `failed` chaseable?** Default: **no** — the lead branch requires touch 1 `sent`; the lead then expires under `LEAD_EXPIRY_DAYS` with reason `expired` (D-15's own wording: "touches cannot be sent inside the window"). The Phase 12 failure alert already tells the operator. **RESOLVED with default.**
4. **Negation guard on `URGENT`/`emergency` ("not urgent")?** D-06 says "anywhere". Default: **implement the lock literally**, pin "not urgent" → hot in the test with a comment naming the cost; offer the guard as a one-line follow-up if the first clients report it. **RESOLVED with default.**
5. **"The tradie hears about cold leads in the 06:30 digest"** — the digest is the operator's email; there is no tradie-facing digest. Default: **operator digest section only** (per-client counts); the tradie hears from the operator. A tradie SMS summary would be new surface and new Spam-Act-adjacent sends to the client — out of scope here. **Handed to planner with default. RESOLVED: operator digest section only (adopted in 13-05 Task 2).**
6. **Ring-twice after hours with the switch off** — held like any non-emergency hot trigger (D-09 lists only emergency urgency and keywords as "regardless"). Default: **held.** **RESOLVED with default.**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node | everything | ✓ | v22.20.0 | — |
| npm | scripts | ✓ | 10.9.3 | — |
| vitest | pure suites locally | ✓ | 4.1.11 | — |
| Supabase CLI / Docker | DB-backed suites | ✗ locally | — | CI only (the standing rule); never `test:remote` |
| drizzle-kit | 0040 generation | ✓ (devDependency) | 0.31.10 | — |
| Anthropic key | drafting/classification live | n/a locally | — | Suites inject fake clients; nothing calls the API in tests |

**Missing dependencies with no fallback:** none. **Missing with fallback:** local Postgres → CI.

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest 4.1.11 |
| Config file | `vitest.config.ts` (`fileParallelism: false`, `globalSetup`) |
| Quick run command | `npx vitest run tests/<file>.test.ts` (pure suites run bare; DB suites refuse a remote target without `ALLOW_REMOTE_TESTS`) |
| Full suite command | CI: `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx next build`, migrate, `vitest run` against the local stack |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| LEAD-01 | lead touch 2/3 promoted, drafted (`p5`), approvable, dispatched inside hours; lead closes after touch 3 | integration (CI) | `npx vitest run tests/lead-cadence-active.test.ts tests/lead-close.test.ts tests/approval-queue.test.ts` | ❌ Wave 0 (replaces `lead-cadence-inert`) |
| LEAD-02 | lead vocabulary + urgency; STOP first; CHECK by kind | unit + integration | `npx vitest run tests/lead-labels.test.ts tests/classify-inbound.test.ts tests/classification-privilege.test.ts tests/lead-reply.test.ts tests/inbound-stop.test.ts` | ✅ extend + ❌ `lead-labels` |
| LEAD-03 | emergency / high-confidence / keyword / ring-twice; hold + release; switch | unit + integration | `npx vitest run tests/urgency-keywords.test.ts tests/escalation-hold.test.ts tests/ring-twice.test.ts tests/lead-reply.test.ts tests/escalation.test.ts` | ❌ Wave 0 (three new) |
| LEAD-05 | policy by kind, quote unchanged | unit + integration | `npx vitest run tests/cadence-policy.test.ts tests/cadence-rewindow.test.ts tests/lead-policy-both-kinds.test.ts` | ❌ `cadence-policy`, `lead-policy-both-kinds` |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` + the task's named pure suite
- **Per wave merge:** push a branch; CI runs the DB-backed suites against a journal-built database
- **Phase gate:** CI green on the final SHA → push protocol for 0040 → push main → `/gsd-verify-work` (no second phone needed: every proof is CI/local; the live first-lead proof stays event-gated with the first client, as 12-09 records)

### Wave 0 Gaps
- [ ] `tests/cadence-policy.test.ts`, `tests/urgency-keywords.test.ts`, `tests/lead-labels.test.ts`, `tests/escalation-hold.test.ts` (pure) — written first
- [ ] `tests/lead-cadence-active.test.ts` (rename + rewrite of `lead-cadence-inert`), `tests/lead-policy-both-kinds.test.ts`, `tests/lead-close.test.ts`, `tests/ring-twice.test.ts` (DB)
- [ ] `tests/helpers/seed.ts`: `seedInbound` with `lead_id`/`keyword_hot`; a lead template seed; `seedTenant` override for `after_hours_escalation`

### Tests that break by design
| Test | Pin | Why it moves |
|---|---|---|
| `tests/lead-cadence-inert.test.ts` | D-19 inertness | Replaced by `lead-cadence-active` (D-17) |
| `tests/drafting-prompt.test.ts:85` | `'p4'` | `'p5'` |
| `tests/classification-privilege.test.ts:220` | four columns | five (`urgency`) |
| `tests/cadence-tick-route.test.ts:385, :490` | response key set; refusal key set | new counts (`escalationHeld`, `escalationReleased`, `ringTwiceEscalated`, `leadsClosed`, …); `lead_closed` refusal |
| `tests/rls-coverage.test.ts:688-700` | CHECK names (additive) | new CHECKs; replaced `message_templates` unique index |
| `tests/lint-ban.test.ts`, `tests/sync-upsert.test.ts` | barrel export / `forAllTenants_*` tripwires | new accessors (containment paragraph each) |
| `tests/text-back-gate.test.ts:103` | gate vocabulary = stored vocabulary order | `recent_negative_close` inserted after `suppressed` in both |
| `tests/escalation.test.ts` | `EscalationClaim` shape | `holdUntil`, `leadId` |
| `tests/cron-schedules.test.ts`, `tests/report-metrics.test.ts` | four jobs; twin parity | **must not move** |

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no (console auth unchanged) | existing `authorize(tenantId)` on the new toggle action |
| V4 Access Control | yes | service-role writes; RLS policies unchanged; no new GRANTs |
| V5 Input Validation | yes | zod on the toggle form; `safeParse` on model output; `sanitizeUntrusted` on the caller's reply in the lead facts block (`prompt.ts:198-230`); `delimitedBody` for classification |
| V6 Cryptography | no | — |
| V8 Data Protection | yes | no caller number or body in logs, digest or tick JSON (counts only); `closed_reason` is a closed vocabulary |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Prompt injection via a caller's reply reaching the lead facts block | Tampering | `sanitizeUntrusted` + the `<<<QUOTE_DATA` fence; the validator whitelist (no numbers but the day count); human approval |
| Forged keyword reply makes a tradie's phone ring at 2 am | Spoofing / DoS | keyword hot still requires a live lead cadence for that mobile at that tenant (threaded only); cooldown 30 min per cadence; never-twice per message; the tradie's number is the client's own |
| Label-driven close used to blacklist a caller | Tampering | high-confidence only; `closeLead` is tenant-scoped; D-14 no reopen but a new call after 90 days opens a new lead |
| Held escalation replayed | Repudiation / duplicate send | `released_at` guarded claim; outcome written once |
| Cross-tenant lead close via the D-10 tie-break | Elevation | the tie-break only runs when every candidate shares one `tenantId` |

## Sources

### Primary (HIGH confidence) — files opened this session at `06944ee`
- `src/core/cadence/{constants,run-tick,dispatch,materialize,rewindow,window,transitions,resume,controls,sender}.ts`
- `src/core/leads/{constants,gate,text-back,template}.ts`; `src/core/classification/{classify-inbound,schema}.ts`; `src/core/drafting/{prompt,draft-touches,merge-facts,validate,onboarding-gate}.ts`; `src/core/approval/approve-draft.ts`
- `src/core/escalation/{escalate-hot-leads,quote-call,message}.ts`; `src/core/alerts/{stalled-drafts,text-back-alerts,operator-email}.ts`; `src/core/aging/stalled-digest.ts`; `src/core/messaging/{inbound,stop-keywords}.ts`; `src/core/telephony/missed-call.ts`
- `src/db/schema/{cadences,cadence-touches,leads,inbound-messages,message-templates,escalations,missed-calls,tenants,send-ledger}.ts`; `src/db/repository/{for-tenant,for-all-tenants,escalations,missed-calls,inbound-messages}.ts`; `src/db/migrations/{0039_phase12_text_back,0022_mirror_missing_stop_reason}.sql`, `README.md`, `meta/_journal.json`
- `src/app/(console)/queue/{page,queue-card}.tsx`, `queue/actions.ts`, `clients/[id]/{page.tsx,actions.ts}`, `inbox/page.tsx`
- `tests/{lead-cadence-inert,lead-reply,cadence-rewindow,classify-inbound,classification-privilege,escalation,text-back,text-back-gate,drafting-prompt,rls-coverage,cadence-tick-route,audit-aggregate,cron-schedules}.test.ts`; `tests/helpers/seed.ts`
- `.planning/phases/13-lead-cadence-labels-escalation/13-CONTEXT.md`; `.planning/phases/12-instant-text-back-arming/{12-CONTEXT,12-RESEARCH,12-REVIEW,12-09-SUMMARY}.md`; `.planning/ROADMAP.md` Phase 13; `.planning/REQUIREMENTS.md` LEAD-01..05

### Secondary (MEDIUM confidence)
- `.planning/research/{SUMMARY,FEATURES §4 §6,ARCHITECTURE §3 §4,PITFALLS §1.2 §2.3 §4.6 §5.3 §5.4}.md` (v1.2, 2026-09-27) — the label table, the hot rule, the after-hours table, the ARCH policy proposal (`LEAD_EXPIRY_DAYS = 4` there; revised to 7 here for the long-weekend case)

### Tertiary (LOW confidence)
- None. No web search was performed; the Claude structured-output pattern is the one already live in `classify-inbound.ts`.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages
- Architecture: HIGH — every seam opened and cited with line ranges; the five flips and four non-flips are enumerated against the actual predicates
- Policy numbers / wordings / keyword list: MEDIUM — reasoned proposals, all pinned at boundaries so a founder change is one constant
- Pitfalls: HIGH — each is a read line of code (`page.tsx:135`, `for-tenant.ts:2737`, `text-back.ts:664`)

**Research date:** 2026-10-08
**Valid until:** the next commit to `src/core/cadence/*`, `src/db/repository/for-tenant.ts` or the queue page (line numbers shift); the decisions hold for the milestone
