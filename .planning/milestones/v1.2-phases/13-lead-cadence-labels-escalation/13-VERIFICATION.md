---
phase: 13-lead-cadence-labels-escalation
verified: 2026-10-09
uat: 13-UAT.md (founder, phone, 2026-10-09 — 3/3 pass; live clauses event-gated on the first client)T03:50:00Z
status: passed
score: 4/4 must-haves verified (4 verified in code, in the pure suites and in CI on a fresh database; every live clause carried by the one founder override below and relocated to the first client)
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "Live clauses of success criteria 1–3 — a real caller's touch 2 and touch 3 delivered on a handset inside contact hours in the tradie's voice; a real lead reply classified in the lead vocabulary on production; a hot reply, an URGENT keyword reply and a ring-twice reaching the tradie's escalation handset, and a held one arriving when the shop opens"
    reason: "Carried forward from the Phase 12 override (12-09 SKIPPED, founder 2026-10-07: 'i don't have a second number, skip this test for now just like the spike'). No text-back has ever been sent on production, nothing is armed, and production holds zero leads, zero lead cadences, zero lead-threaded inbound rows and zero message_templates rows (read-only `npm run lead-cadence:invariants` by this verifier, 2026-10-09). A lead cannot exist until the first client is armed, so no Phase 13 live clause can run before then. 13-07-SUMMARY 'Carried forward' extends the relocated first-client proofs to: touch 2 appearing in /queue, a lead reply classified in the lead vocabulary, and a held/released escalation. Every clause is proven in code, in the pure suites run here, and in CI (runs 37762760641 on ci/phase-13-final and 37875868246 / 37879078061 on main) on a fresh database migrated through 0040."
    accepted_by: "founder (Hesam Abbaszadi)"
    accepted_at: "2026-10-07T18:12:00+08:00"
prohibitions_flagged: 26
human_verification:
  - test: "On a phone, open https://app.backdesk.com.au/clients/13e8f2aa-edee-4eb1-b699-09b650674f81. Read the profile list and open 'Change after-hours escalation' below the escalation-phone form. Do NOT save."
    expected: "A profile row 'After-hours escalation' reading Off (the 0040 default, never changed); the disclosure opens to one checkbox labelled 'After-hours escalation', unticked, with the sentence 'Text the escalation phone about hot leads outside contact hours. Emergencies and URGENT replies are always sent.' and a 'Save setting' button; one column, no sideways scroll."
    why_human: "Layout and wording at phone width are visual. tests/after-hours-escalation-action.test.ts (14 tests, pass) proves authorize-before-read, the one-column patch and both saved sentences; it cannot see what the operator reads. D-09."
  - test: "On a phone, open https://app.backdesk.com.au/queue."
    expected: "The queue renders as before with no lead card: production has zero lead cadences, so no row may read 'Missed call · touch N of 3'. No row links to /quotes/null or /quotes/undefined."
    why_human: "A regression look. tests/queue-lead-rows.test.ts (9 tests, pass) pins that the page keeps lead rows and a lead card builds no quote link; the first real lead's card (D-01, D-02) is the first-client proof."
  - test: "On a phone, open https://app.backdesk.com.au/inbox."
    expected: "The inbox renders as before. No row carries a lead label (new_enquiry, callback_request, existing_job, complaint, not_a_lead, already_sorted, spam) or an urgency chip; if any badge shows a label it reads in operator words ('reads as a new enquiry', 'sounds like an emergency'), never raw snake_case. No row says 'missed-call lead, no quote'."
    why_human: "Production has zero lead-threaded inbound rows, so this is a regression look until the first lead reply. tests/lead-labels.test.ts (pass) pins operator words for every member of both vocabularies and that the inbox selects and renders urgency (WR-03); it cannot see the badge. CR-01 inbox arm."
  - test: "First founding client (event-gated, the relocated live proof — the Phase 12 override's runbook plus the Phase 13 extension): after the first real text-back, watch for touch 2 in /queue within a minute, approve it, and watch the handset the next morning; then watch the first reply."
    expected: "Touch 2 appears in /queue as 'Missed call · touch 2 of 3' with prompt_version p5 and no quote link; after approval it arrives on the caller's handset inside the client's contact window (never at night) in the tradie's voice with the identity line and STOP; touch 3 the morning after; then `npm run escalations:recent -- --tenant <id>` and the lead row show the lead closed touches_exhausted. The first reply threads to the lead (lead_id set, quote_id NULL), is labelled in the lead vocabulary with an urgency; a hot one, an 'URGENT' one or a second call within 30 minutes reaches the escalation handset; a cold one after hours with the switch off shows hold_until and is released at the window's open."
    why_human: "Every step is proven in CI on a local stack (tests/lead-cadence-active, lead-policy-both-kinds, lead-close, lead-reply, escalation-lead, ring-twice) and never on production: nothing is armed and no lead exists (override above). Needs a real client, a real handset and ClickSend."
  - test: "Ratify the 26 PLAN prohibitions (must_haves.prohibitions across 13-01..13-07) recorded under 'Prohibitions' below."
    expected: "Each non-authoritative verdict below is accepted or disputed by the founder at the end-of-phase checkpoint."
    why_human: "The prohibitions declare no verification tier; in autonomous verify they take a non-authoritative LLM-judge verdict and are flagged 'unverified-prohibition — human review recommended' rather than passed silently (ADR-550 D4). The v1.0 close ratified prohibitions the same way."
---

# Phase 13: Lead Cadence, Labels & Escalation — Verification Report

**Phase Goal:** A texted caller becomes a lead that is chased briefly and politely — two human-approved follow-ups inside contact hours, then closed for good — with replies classified in a lead vocabulary and the hot ones on the tradie's phone.
**Verified:** 2026-10-09T03:50:00Z (11:50 AWST)
**Status:** human_needed
**Re-verification:** No — initial verification

**Commit verified:** `c1f9c52` (HEAD = origin/main). CI run 37879078061 on that SHA: **success** (job "typecheck, lint, migrate, test"; migrate step "Migrations applied. Journal entries recorded: 41"; vitest "Test Files 179 passed (179)"). Earlier: run 37875868246 on `8caa4ce` success (the SHA the code review read); run 37762760641 on branch `ci/phase-13-final` at `8caa4ce` success (13-07's gate before production was touched). Production: GitHub deployment 6952178820 for `c1f9c52`, environment Production, created 2026-10-09T03:24:54Z, state **success**; `vercel ls backdesk --prod` shows `backdesk-1bv2puj3s` **Ready** (Production, 1m build) above the `8caa4ce` and `db02fd0` deployments. Local on `c1f9c52`: `npm run typecheck` exit 0, `npm run lint` exit 0, 38 pure suites by explicit file list / 2288 tests passed (`npx vitest run …`, list in Behavioral Spot-Checks). DB-backed suites are cited from CI by run id; `npm run test:remote` was not run and no env file was named.

**Read-only production probes by this verifier (2026-10-09, ~11:40 AWST):** `npm run lead-cadence:invariants` → `leads_total=0 lead_cadences_total=0 inbound_lead_rows=0 message_templates_total=0 text_back_armed_tenants=0 schema_0040_applied=true`. `npm run cron:status` → `remote_test_lease rows: 0`, watchdog not scheduled, four jobs active (sm8-sync-tick, cadence-tick, messaging-reconcile, stalled-digest — no job added), last five `net._http_response` all 200 (03:35–03:38Z). Doors: POST `/api/webhooks/twilio/voice?token=wrong` → 401; POST `/api/webhooks/twilio/voice-status?token=wrong` → 401; POST `/api/internal/cadence-tick` with `Authorization: Bearer wrong` → 401.

## Goal Achievement

**Founder override declared up front (the Phase 11/12 format).** Plan 12-09 was SKIPPED by the founder on 7 Oct 2026 (no second mobile). No text-back has ever been sent on production, nothing is armed, and the invariants above read zero leads. A lead is created only by a text-back, so every live clause of this phase — a follow-up on a handset, a classified lead reply, an escalation to the tradie's phone, a hold released at opening — is event-gated on the first client and is carried as **relocated**, not failed. The code half of the goal is verified against the source, migration 0040, the pure suites run here, and CI on a fresh database.

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each texted caller is a lead with its own `kind='lead'` cadence; touch 1 instant and hours-exempt; touches 2 and 3 AI-drafted from approved lead templates, in the existing approval queue, sent inside contact hours over ~48 h; after touch 3 the lead closes for good and that number is never texted again for that lead (LEAD-01) | VERIFIED in code · live clause relocated (override) | Lead + cadence + three touches created by Phase 12's `sendTextBack` at `LEAD_TOUCH_OFFSET_DAYS = [0, 1, 2]` (`src/core/leads/constants.ts:37`). Per-kind progress: `run-tick.ts:910-944` loops `CADENCE_KINDS` with `policyFor(kind)` for expiry and rewindow; `rewindow.ts:179-248` reads gap/staleness/expiry from `input.policy ?? QUOTE_POLICY`; a 02:00 slot is moved into the morning (`lead-cadence-active.test.ts:560-613`, CI). Drafting: `draft-touches.ts:840-841` picks the lead template set by `cadence.kind`, `:660-672` seeds the two defaults as a belt when a client has none (`lead-templates.ts`, bodies "Following up on your recent call…" / "Last one from us…"), `:962` writes `PROMPT_VERSION = 'p5'` (`prompt.ts:101`), `:1005` passes `forbidLinks: isLead` (WR-02). Arming seeds the same defaults (`clients/[id]/actions.ts:859`; `after-hours-escalation-action.test.ts:279-313`, pass). Queue keeps lead rows and a lead card reads "Missed call · touch N of 3" with no quote link (`queue/page.tsx:131-146`, `queue-card.tsx:114-177`; `queue-lead-rows.test.ts` 9 tests pass; `approval-queue.test.ts` CI). Dispatch: the kind switch is the first statement of `dispatchOne` (`dispatch.ts:388-400`); `refuseUnchaseableLead` (`:419-445`) re-reads the lead's status, the live quote cadence for the mobile and the touch-1 `sent` ledger row inside the claim transaction, else skips, stops `lead_closed` and calls `closeLeadInTx` **on the same handle**; the shared tail keeps `outside_window`, suppression, approved-bytes and the never-twice ledger claim (`:534-636`). Close: `close.ts` — `closeLeadInTx` stops/expires the live cadence, retires unsent touches and closes the lead by guarded UPDATE in one transaction; `closeLead` is the single wrapper (exactly one `forTenant(` in the file — the B1 contract); `closeLeadsWithEndedCadences` maps `completed → touches_exhausted` and is wired after the completion sweep (`run-tick.ts:1067`). Tests: `lead-cadence-active.test.ts` (tracer: promote → draft p5 → approve → dispatch owned by the lead → touch 3 → `touches_exhausted` → a further tick sends nothing; dispatch branch refusals; 8-day expiry closes the lead `expired`; D-19 quote control) and `lead-close.test.ts` (idempotent close, no re-reason, `cadences_one_live_per_lead` released) — DB-backed, CI green on `c1f9c52`. Migration 0040 adds `leads.closed_reason/closed_at` with `leads_closed_iff_reason`, `leads_closed_at_with_reason`, `leads_expired_reason`, and the `lead_closed` stop reason. Live: no lead has ever existed on production (override). |
| 2 | A lead reply is classified into the separate lead vocabulary with urgency and confidence, threads to the lead not a quote cadence, and STOP is handled deterministically before any model exactly as today (LEAD-02) | VERIFIED in code · live clause relocated (override) | `LEAD_LABELS` (10 members) and `LEAD_URGENCIES` (4) in `src/db/schema/inbound-messages.ts:192-217`; the lead arm of `inbound_messages_label_known` and `inbound_messages_urgency_known` in `0040_phase13_lead_cadence.sql` spell them byte for byte; `classification/schema.ts` derives `LeadReplyLabel`/`LeadUrgency` by `z.enum` over the consts — `lead-labels.test.ts` reads all three places and compares member for member (pass), and pins `INBOUND_LABELS` unchanged as the quote arm. The classifier picks the vocabulary only by `row.leadId` (`classify-inbound.ts:668-670`), binds `output_config.format` to the zod-derived schema with no `tools` key (`:564-621`; `classification-privilege.test.ts` pass), stores label/urgency/confidence and no free text (`writeClassification` five columns; `keywordHot` not settable — T-13-13). STOP: `inbound.ts:248-297` decides `isStopMessage` before any lookup; `src/core/messaging/stop-keywords.ts` is byte-identical to `ed2e4dc`; `inbound-stop.test.ts` unchanged. Threading: the Phase 12 attribution by recipient number + active-cadence lookup stands; a lead reply carries `lead_id` and NULL `quote_id` (`lead-reply.test.ts:290`, CI); one mobile on a quote and a lead at ONE client threads to the quote and closes the lead `quote_cadence_wins` (`inbound.ts:461-491`, same-tenant only; `lead-reply.test.ts:720-758`). Quote path unchanged: quote rows write `urgency: null` and the CHECKs `urgency_lead_only`/`lead_label_has_urgency` hold (the acknowledged `classify-inbound.test.ts` key-set edit). Live: no lead reply has ever arrived (override). |
| 3 | A hot lead reaches the tradie's phone through the existing escalation path: emergency urgency at any confidence, high-confidence new_enquiry/callback_request/existing_job/complaint, a deterministic `URGENT` keyword reply bypassing the model, and a second missed call within 30 minutes; after-hours escalation is a per-client switch; the tradie is never texted for every miss (LEAD-03) | VERIFIED in code · live clause relocated (override) | Hot rule `isHotLeadReply` (`classify-inbound.ts:392-400`): emergency hot at any label except spam/opt_out/not_a_lead, else the four labels at high confidence; decided once over all 120 cells, 33 hot (`lead-labels.test.ts:231-244`, pass). Keyword rule: `URGENT_KEYWORDS` (urgent, emergency, burst, flooding, flooded, gas leak, smell gas, no power, locked out, sparking) in `constants.ts:228-239`; `urgency-keywords.ts` builds `\b(?:…)\b` case-insensitive, non-global; `urgency-keywords.test.ts` pins the list in order, word boundaries ("urgently", "sparky" cold), whitespace in phrases, and the locked "not urgent" is HOT (`:111-122`, pass). The door writes `keyword_hot` after the STOP decision, lead replies only (`inbound.ts:330-336`); the hot scan reads `is_hot OR keyword_hot`, so a keyword row with label NULL and no model escalates (`lead-reply.test.ts:457-508`, `escalation-lead.test.ts:369`, CI). Ring-twice: `listUnescalatedRingTwiceCalls` with `RING_TWICE_WINDOW_MINUTES = 30`, claim keyed on the second call's `missed_call_id` (`ring-twice.ts`); the second call gets no second text (Phase 12 `recent_text`/`lead_open` skips stand); call 3 is `cooldown_suppressed`; a 31-minute gap produces no row (`ring-twice.test.ts:189-302`, CI). After-hours: `tenants.after_hours_escalation boolean NOT NULL DEFAULT false` (0040; `schema/tenants.ts:51`); `hold.ts` — hold iff not immediate, outside the window, switch off; emergency/keyword never reads the window (`escalation-hold.test.ts` eight-row truth table + `nextWindowOpen` at the opening minute incl. weekend and DST, pass); `escalate-hot-leads.ts:296-349` claims with `hold_until`, sends nothing, counts `held`; `release-held.ts` releases by guarded claim, re-reads the lead (`lead_closed`) and **the tenant's escalation phone as it stands now** (WR-01 fix, `:183-190`; `escalation-passes.test.ts:390`, pass; `escalation-lead.test.ts:488-526`, CI); release is the last escalation pass so a hold is never released in its own minute. Switch UI: `after-hours-escalation-form.tsx` + `updateAfterHoursEscalationAction` (authorize before any form read, one-column patch; 14 tests pass), profile row at `clients/[id]/page.tsx:912-928`. Cold replies pause the lead and sit in the inbox (CR-01 arm, `inbox/page.tsx:292-311`), counted in the 06:30 digest's Leads section until triaged (`stalled-digest.ts:157-213`, `inbound-messages.ts:582-587`; `lead-digest-section.test.ts` pass). Same path as today: `claimEscalation`, `escalations_one_trigger`, `escalations_missed_call_uniq`, cooldown, `resolveSmsFrom`; `quote-call.ts` behaviour unchanged (see Anti-Patterns). The nine new tick counts are enumerated by name in `cadence-tick/route.ts:295-303`. Live: no escalation has ever gone to a tradie about a lead (override). |
| 4 | Cadence policy (minimum gap, staleness cap, expiry) is chosen per cadence kind; the lead's short timings are not skipped by the quote's 48-hour rules and the quote's behaviour is unchanged — pinned by a test on both kinds (LEAD-05) | VERIFIED | `src/core/cadence/policy.ts`: `QUOTE_POLICY` built from the unchanged quote constants (`MIN_GAP_HOURS = 48`, `STALENESS_CAP_HOURS = 72`, `CADENCE_EXPIRY_DAYS = 42`, `src/core/cadence/constants.ts` byte-identical to `ed2e4dc`), `LEAD_POLICY` from `LEAD_MIN_GAP_HOURS = 12`, `LEAD_STALENESS_CAP_HOURS = 24`, `LEAD_EXPIRY_DAYS = 7`, `LEAD_TOUCH_OFFSET_DAYS`; `policyFor(kind)` over an `as const satisfies Record<CadenceKind, CadencePolicy>` map. Pure pins: `cadence-policy.test.ts` (both objects at every boundary — 12 h/48 h gap, 24 h/72 h staleness, 7 d/42 d expiry, the long-weekend case; no policy decides as the quote, pass). DB pin on both kinds: `lead-policy-both-kinds.test.ts:235-313` — touch 3 twenty-four hours after the next morning: the lead touch 2 is rescheduled and sent, the quote touch 2 is skipped `min_gap`; the 49-hour control sends both (CI). Quote behaviour unchanged: `tests/cadence-rewindow`, `cadence-resume`, `cadence-window`, `cadence-dispatch`, `cadence-transitions`, `inbound-stop`, `sync-upsert`, `report-metrics`, `cron-schedules` and `src/core/cadence/resume.ts` are byte-identical to `ed2e4dc` (`git diff --quiet`); the acknowledged edits are listed under Anti-Patterns. Docs: `docs/commercial-assumptions.md` §11–§15 record the five lead numbers and the keyword list. |

**Score:** 4/4 truths verified (4 verified in code; live clauses of 1–3 carried by one override; 0 present-but-behaviour-unverified — every state transition named above is exercised by a DB-backed suite that CI ran green on `c1f9c52`).

### The planning note's three seams — each has a named test

| Seam | Code | Named test |
|---|---|---|
| Dispatch chaseable branch on `cadences.kind` | `dispatch.ts:388-445` (`dispatchOne` kind switch first; `refuseUnchaseableLead`) | `lead-cadence-active.test.ts:466` "never reaches the quote branch — no mirror_missing stop, no lead_closed refusal, on either tick"; `:693-806` "the dispatch lead branch refuses lead_closed and closes on its own transaction (D-10, D-14)" — closed lead, failed text-back, live quote cadence (CI) |
| Per-kind policy constants | `policy.ts`; `run-tick.ts:910-944`; `rewindow.ts:179` | `cadence-policy.test.ts` "policyFor(kind) — one object per kind" + the three boundary blocks (pure, pass); `lead-policy-both-kinds.test.ts:235-313` (CI) |
| One-live-per-lead arbiter | `cadences_one_live_per_lead` partial unique index (0039, unchanged by 0040 by design) | `lead-close.test.ts:351` "releases cadences_one_live_per_lead: a live lead cadence for the closed lead is admitted again"; `rls-coverage.test.ts:602-612` pins the index definition (`(lead_id)`, live statuses, NULL excluded) (CI) |

### Context decisions D-01..D-17 — where each lives

D-01 offsets `[0,1,2]` + close after touch 3 (`constants.ts:37`, `close.ts` sweep, `lead-cadence-active:481-550`). D-02 shipped defaults seeded at arming and at first use, every draft approved in the queue (`lead-templates.ts`, `actions.ts:859`, `draft-touches.ts:660-672`). D-03 per-kind policy (above). D-04 touch 1 hours-exempt (Phase 12 send path), touches 2–3 re-windowed (`lead-cadence-active:560`). D-05 vocabulary in three places (`lead-labels.test.ts`). D-06 STOP → keyword → model (`inbound.ts:248-336`; `lead-reply:456-529`). D-07 hot rule + ring-twice (`isHotLeadReply`; `ring-twice.ts`). D-08 existing path, claim-then-send, cooldown, never-twice, cold → inbox + digest (`escalate-hot-leads.ts`, `inbox/page.tsx`, `stalled-digest.ts`). D-09 switch default false, held unless immediate (`hold.ts`; `escalation-lead:257-369`). D-10 threads to the lead; quote wins within one tenant (`inbound.ts:461-491`; `lead-reply:720-758`). D-11 label effects at HIGH confidence only (`for-tenant.ts:4123-4126` `labelConfidence = 'high'`; `label-effects.ts`; `lead-reply:545-574`; `lead-label-effects.test.ts` pass). D-12 90-day cool-off, boundary inclusive (`gate.ts:111-176`; `text-back-gate.test.ts:234` pins 90 and the ±1 ms boundary, pass; `lead-close:498-590` CI). D-13 lead facts after the stable prefix, `p5` (`prompt.ts:77-101, 369-480`; `drafting-prompt.test.ts` pass). D-14 final + idempotent (`close.ts`; `lead-close:292-351`). D-15 expiry by kind closes the lead in the expiry transaction (`run-tick.ts:753-794`; `lead-cadence-active:622-684`). D-16 one journal entry idx 40, additive, hand-finished DROP IF EXISTS (file read; journal tail; CI "41 entries"; production `schema_0040_applied=true`). D-17 protected pins unchanged; `lead-cadence-inert` replaced by `lead-cadence-active` via rename (file absent; `git diff --stat` shows the 356-line deletion beside the 838-line addition).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/db/migrations/0040_phase13_lead_cadence.sql` + journal idx 40 | One additive entry: closing columns, urgency/keyword_hot, by-kind label CHECK, after_hours_escalation, templates.kind + widened unique index, hold_until/released_at, two widened vocabularies, four indexes | VERIFIED | 119 lines, 30 statements; applied to production (41 journal entries; `schema_0040_applied=true`); CI migrates it from the journal on every push |
| `src/core/leads/constants.ts` | Lead policy numbers, cool-off, ring-twice window, keyword list | VERIFIED | Import-free; each constant says why |
| `src/core/cadence/policy.ts` | `QUOTE_POLICY`, `LEAD_POLICY`, `policyFor` | VERIFIED | 85 lines; used by `run-tick.ts`, read by `rewindow.ts` |
| `src/core/cadence/dispatch.ts`, `rewindow.ts`, `run-tick.ts` | Kind switch first; policy-driven rewindow; per-kind expiry; passes 5b–8 | VERIFIED | Wired; counts enumerated in the route |
| `src/core/leads/close.ts`, `label-effects.ts`, `urgency-keywords.ts`, `lead-templates.ts`, `gate.ts` rule 6 | Closing core/wrapper/sweep; label pass; keyword rule; defaults; cool-off | VERIFIED | All substantive, all imported and called from the tick, the door or the drafting pass |
| `src/core/classification/classify-inbound.ts`, `schema.ts` | Lead arm, zod-derived vocabulary, hot rule | VERIFIED | Vocabulary by `lead_id`; no `tools` key |
| `src/core/escalation/hold.ts`, `escalate-hot-leads.ts`, `release-held.ts`, `ring-twice.ts` | D-09 hold/release; ring-twice; WR-01 re-read | VERIFIED | Wired as passes 6–8 on the `escalationSender` seam |
| `src/core/drafting/prompt.ts` (`p5`), `validate.ts` (`forbidLinks`), `src/core/shared/link-pattern.ts` | Lead prompt block; link rule for lead drafts only | VERIFIED | `approve-draft.ts:518` and `draft-touches.ts:1005` pass `forbidLinks` for lead cadences |
| `src/app/(console)/clients/[id]/after-hours-escalation-form.tsx`, `actions.ts`, `page.tsx` | Switch form, action, profile row, arming-time seed | VERIFIED | Rendered at `page.tsx:912-928` |
| `src/app/(console)/inbox/page.tsx`, `components/label-guess.ts` | CR-01 lead arm; WR-03 operator words + urgency | VERIFIED | Seven lead labels mapped; `urgencyGuess`; emergency in `badge--error` |
| `src/app/(console)/queue/*` | Lead rows kept; nullable quote id; lead card wording | VERIFIED | `LEAD_TOUCH_COUNT = 3` restated in the client component (IN-06, info) |
| `src/core/aging/stalled-digest.ts` + two counts-only reads | Leads section in the 06:30 digest | VERIFIED | Null when empty; no number selected |
| `scripts/lead-cadence-invariants.mjs` | Read-only evidence reader | VERIFIED | Run by this verifier; `ops-scripts.test.ts` pins number-free output |
| `docs/commercial-assumptions.md` §11–§15, divert runbook §0.6, first-client runbook | Numbers recorded; switch and ring-twice named | VERIFIED | `runbook-contract.test.ts`, `client-divert-runbook.test.ts` pass |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `run-tick.ts` progress pass | `policyFor(kind)` → `expireOverdueCadences` / `rewindowCadence` | `for (const kind of CADENCE_KINDS)` | WIRED |
| `dispatchOne` | `refuseUnchaseableLead` → `closeLeadInTx(tx, …)` | kind switch, same transaction handle | WIRED |
| `expireOverdueCadences` | `closeLeadInTx(tx, leadId, 'expired')` | inside the expiry transaction | WIRED |
| `handleInboundSms` | `isStopMessage` → `isUrgentKeyword` (lead only) → `insertInboundMessage({ keywordHot })` | fixed order | WIRED |
| `classifyInbound` | `LEAD_VOCABULARY` / `QUOTE_VOCABULARY` | `row.leadId !== null` | WIRED |
| tick pass 5b | `applyLeadLabelEffects` → `closingLabelRowsForOpenLeads` (HIGH) → `closeLead` | after classification, before escalation | WIRED |
| `escalateHotLeads` | `escalationHoldUntil({ window, immediate, afterHoursEscalation })` → `claimEscalation({ holdUntil })` | tenant row read once per tenant | WIRED |
| `releaseHeldEscalations` | `claimHeldEscalationRelease` → tenant re-read → `sender` → `recordEscalationOutcome(toAddress)` | last escalation pass | WIRED |
| `escalateRingTwiceCalls` | `listUnescalatedRingTwiceCalls(30 min)` → `claimEscalationForMissedCall` | hold-aware | WIRED |
| `draftTouches` | `latestApprovedSet('sms','lead')` / `seedLeadTemplateDefaults` → `buildPrompt({ kind:'lead', leadFacts })` → `PROMPT_VERSION` | `cadence.kind` | WIRED |
| `armChannelAction` (text_back) | `seedLeadTemplateDefaults(forTenant(tenantId))` | after the arm succeeds, own try | WIRED |
| `AfterHoursEscalationForm` | `updateAfterHoursEscalationAction` → `tenant.update({ afterHoursEscalation })` | `useActionState` | WIRED |
| `cadence-tick/route.ts` | nine new counts | enumerated by name | WIRED |

### Data-Flow Trace (Level 4)

| Surface | Variable | Source | Real data | Status |
|---|---|---|---|---|
| Client page profile row + form `current` | `tenant.after_hours_escalation` | tenant read | yes (column added by 0040) | FLOWING |
| Inbox lead row badge/urgency | `row.label`, `row.urgency`, `row.leadId` | `listInboxRows` selects `leadId`, `urgency` | yes | FLOWING (zero rows on production by fact, not by stub) |
| Queue lead card | `row.kind`, `row.leadId`, `row.quoteId` | queue read carries kind + lead id | yes | FLOWING |
| Digest Leads lines | `countColdLeadRepliesSince`, `listHeldEscalationsSince` | counts-only reads | yes | FLOWING (null section when empty, by design) |

### Behavioral Spot-Checks

| Behaviour | Command | Result | Status |
|---|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 | PASS |
| Lint | `npm run lint` | exit 0 | PASS |
| Pure suites (explicit list): cadence-policy, lead-close-isolation, queue-lead-rows, urgency-keywords, lead-labels, lead-label-effects, escalation-hold, escalation-passes, after-hours-escalation-action, lead-digest-section, text-back-gate, drafting-prompt, drafting-validate, cadence-tick-route, classify-inbound, classification-privilege, escalation-message, runbook-contract, lint-ban, ops-scripts, cadence-rewindow, cadence-window, cadence-transitions, text-back-structure, stalled-drafts, cadence-tick-isolation, cadence-dispatch-isolation, cadence-tick-classification, stall-claim-isolation, console-error-leak, layout-contract, text-back-actions, arming-actions, operator-authorization, audit-aggregate, client-divert-runbook, inbox-authorization, draft-touches | `npx vitest run <38 files>` | 38 files, 2288 tests passed | PASS |
| DB-backed suites (lead-cadence-active, lead-policy-both-kinds, lead-close, ring-twice, escalation-lead, lead-reply, rls-coverage, approval-queue, onboarding-gate, escalation, text-back, inbound-threading, cadence-tick, …) | CI run 37879078061 on `c1f9c52` | success; 179 files; migrate "41 entries" | PASS (CI) |
| Protected pins byte-identical to `ed2e4dc` | `git diff --quiet ed2e4dc..HEAD -- <files>` | 13 of 14 unchanged; `quote-call.ts` see below | PASS with note |
| Production invariants | `npm run lead-cadence:invariants` | all zero, `schema_0040_applied=true` | PASS |
| Cron | `npm run cron:status` | lease 0, 4 jobs, ticks 200 | PASS |
| Doors | three `curl` probes with wrong credentials | 401 / 401 / 401 | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist in this repository; the phase's probes are the read-only npm scripts and door probes above, each run by this verifier.

### Requirements Coverage

| Requirement | Plans | Status | Evidence |
|---|---|---|---|
| LEAD-01 | 13-01, 02, 03, 04, 05, 07 | SATISFIED in code (live clause relocated) | Truth 1 |
| LEAD-02 | 13-04 | SATISFIED in code (live clause relocated) | Truth 2 |
| LEAD-03 | 13-03, 04, 05, 06 | SATISFIED in code (live clause relocated) | Truth 3 |
| LEAD-05 | 13-01, 02, 05 | SATISFIED | Truth 4 |
| LEAD-04 | — (Phase 14) | not this phase | REQUIREMENTS.md maps it to Phase 14; no orphan |

REQUIREMENTS.md ticks LEAD-01/02/03/05 and the table reads "Phase 13 | Complete" for each — consistent with this report.

### Prohibitions (26, judgment-tier by default — non-authoritative, flagged for ratification)

No PLAN prohibition declares a `verification:` tier, so each takes a non-authoritative LLM-judge verdict here and is flagged `unverified-prohibition — human review recommended`. None reads as violated.

| Group | Verdict (non-authoritative) | Evidence |
|---|---|---|
| STOP before keyword/model; no free-text parse; no `tools` key (13-04) | holds | `inbound.ts:248-336`; `classify-inbound.ts:564-621`; `classification-privilege` pass |
| No close on medium/low closing label (13-04) | holds | `for-tenant.ts:4124` `labelConfidence = 'high'`; `lead-reply:574` |
| No body / number / caught value in logs, results, test names (13-02, 03, 04, 06, 07) | holds | `console-error-leak`, `cadence-dispatch-isolation:244`, `lead-digest-section:160`, `ops-scripts` pass; review found none |
| Quote-wins tie-break only within one tenant (13-04) | holds | `inbound.ts:461-491`; `lead-reply:421, 758` |
| Classification never writes `is_hot` from the keyword rule; five columns (13-03) | holds | `writeClassification`; T-13-13 pin |
| No `forAllTenants_*` export; no delete/reopen; controls/transitions/completion sweep untouched (13-03) | holds | `sync-upsert.test.ts` unchanged (16 exports); `close.ts` guards; no reopen path |
| No quote mirror read for a lead touch; kind switch first (13-02) | holds | `dispatch.ts:388-400` |
| No nested transaction (13-02, B1) | holds | `close.ts` has one `forTenant(`; dispatch and expiry call `closeLeadInTx(tx, …)`; tracer completed inside timeout in CI |
| No lead touch outside hours / without suffix / with a link / without approval (13-02) | holds | shared dispatch tail `outside_window`, `claimDue` approved only, `forbidLinks`, compliance suffix |
| Quote constants and pins unchanged (13-01, 02) | holds | `git diff --quiet` on constants and the nine pins |
| No DB-backed suite locally; no `test:remote`; no env file named; 0040 not applied before the checkpoint; main not pushed early (13-01..07) | holds on the record | Every SUMMARY states it; 13-07 records the founder running `db:migrate` by hand after the checkpoint; this verifier ran none |
| One additive journal entry; no new table/privilege/data statement (13-07) | holds | 0040 read in full; journal idx 40 |
| No ad-hoc data repair; no `cron:apply`; no arming; schema before code (13-07) | holds on the record | invariants zero; `cron:status` four jobs; `text_back_armed_tenants=0`; CI "41 entries" before the main push |
| Hold is a claim; no re-send of unknown outcome; no double release (13-06) | holds | `escalate-hot-leads.ts:296-349`; `release-held.ts` guarded claim + `released_at`; `escalation-lead:319` |
| Never text the tradie for a single miss; only the tenant's own escalation phone via `resolveSmsFrom` (13-06) | holds | `ring-twice.ts` needs an earlier call inside 30 min; `release-held.ts:183-199`; `ring-twice:302` |
| Authorize before any form read; one-column patch; no tradie-facing digest (13-05) | holds | `after-hours-escalation-action.test.ts:180-236` pass |
| No number/body/secret in digest lines, runbooks, assumptions (13-05) | holds | `lead-digest-section:144-160`; `runbook-contract` pass |
| No cron job, route or package added (13-05) | holds | `cron-schedules` unchanged; `cron:status` four jobs; `package.json` adds scripts only |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` / `PLACEHOLDER` in the 60 source, script and doc files changed since `ed2e4dc` | none found | — |
| `src/core/escalation/quote-call.ts` | 183–187 | A "must not move" pin (13-VALIDATION) changed: `leadId: null, holdUntil: null` added to the claim | Info | Type-forced by the widened `claimEscalation` input; acknowledged in 13-03-SUMMARY deviation 1; behaviour unchanged (a quote call is never held); `tests/escalation.test.ts` key-set edit acknowledged |
| `tests/cadence-tick.test.ts`, `tests/escalation.test.ts`, `tests/classify-inbound.test.ts`, `tests/inbound-threading.test.ts`, `tests/text-back.test.ts` | — | Edits to protected DB suites | Info | All acknowledged key-set / fixture edits: zero-valued new tick counts (`lead_closed`, `leadsClosed`, `leadsClosedByLabel`, nine escalation counts), `holdUntil: null` / `held: 0` on claim fixtures, `urgency: null` on quote rows, `candidate.leadId` / `closed.kind` in the log-interpolation pin, and a lead fixture closed with reason + time because 0040's `leads_closed_iff_reason` now refuses a bare `status: 'closed'`. No quote assertion value moved. |
| `.planning/ROADMAP.md` | 178 | "**Plans:** 6/7 plans executed" while all seven plans are ticked | Info | Bookkeeping; `gsd-tools query roadmap.get-phase 13` also reports 6/7. Correct to 7/7 when the phase is marked complete. |
| 13-REVIEW IN-01..IN-11 | — | Open by design (held alert released after an emergency on the same lead; stale headers; `expired` for a failed text-back; "released at" tense; `z.boolean()` dead branch; `LEAD_TOUCH_COUNT` restatement; unreachable quote branch in `messageFor`; stale inert-era comments) | Info | Recorded, not fixed; none blocks the goal |

### Human Verification Required

See the frontmatter `human_verification` list (five items): the after-hours switch on the client page, the queue regression look (no lead row may exist), the inbox regression look (no lead badge; operator words if any), the event-gated first-client live proof (touch 2 in the queue and on a handset inside hours, a classified reply, a hot/URGENT/ring-twice escalation, a held release), and ratification of the 26 flagged prohibitions. No `<human-check>` blocks were deferred by the planner in 13-01..13-07.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | `DONE` from the tradie's number closes the lead; 14-day ServiceM8 job match auto-resolves `converted` | Phase 14 | REQUIREMENTS.md LEAD-04 → Phase 14; 13-CONTEXT D-14 "Phase 14 adds DONE and the ServiceM8 job match" |
| 2 | Lead queue page and lead reporting | Phase 15 | 13-CONTEXT D-14; inbox CR-01 arm is explicitly "until Phase 15's lead queue exists" |

### Gaps Summary

No gaps. Every success criterion is implemented, wired and exercised: the pure suites pass here (38 files, 2288 tests), the DB-backed suites pass in CI on the verified SHA (179 files) against a fresh database migrated through 0040, the migration is live on production with every invariant at zero, and `c1f9c52` is deployed and Ready. The live clauses — a follow-up on a handset, a classified lead reply, an escalation on the tradie's phone — cannot run until the first client is armed and are carried under the founder's 12-09 override, relocated to the first-client onboarding as 13-07 records. Status is `human_needed` for the end-of-phase phone check (switch, queue, inbox, label words) and the ratification of the flagged prohibitions.

---

_Verified: 2026-10-09T03:50:00Z_
_Verifier: Claude (gsd-verifier)_
