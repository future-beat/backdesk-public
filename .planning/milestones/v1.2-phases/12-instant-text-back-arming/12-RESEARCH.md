# Phase 12: Instant Text-back & Arming - Research

**Researched:** 2026-10-05
**Domain:** Implementation-level, in this codebase: synchronous SMS from the Twilio `voice-status` callback through the existing ClickSend sender and `send_ledger`; `cadences` generalised to `kind='lead'`; a deterministic pre-send gate; a third arming channel; balance alarm; privacy callers section; onboarding runbook
**Confidence:** HIGH on the code map (every path:line below was opened this session at HEAD `d8acd35`); MEDIUM on timing (S4 is unmeasured); the design choices that CONTEXT.md does not lock are listed as Open Questions, each with a recommendation
**Scope note:** milestone research (`.planning/research/*.md`) is not repeated. Where the shipped Phase 11 code differs from `ARCHITECTURE.md`, the difference is called out, because the planner must follow the code.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 Trigger is the call-completed callback:** the text is sent synchronously from `voice-status` when Twilio reports the call ended (about 12 s after the divert); never from the arrival webhook, so the greeting never waits on ClickSend (founder 5 Oct 2026; research D1). The per-minute cadence tick is the guarantee: a sweep sends any text-back whose synchronous send did not complete. No pgmq, no `waitUntil`, no new cron job.
- **D-02 The text is a fixed attested template with no LLM in the path:** per client, two variants (business hours / after hours by the missed call's `after_hours` flag), at most 2 GSM-7 segments, validated at save time; the client's version is attested by the operator before arming.
- **D-03 Default wording (founder 5 Oct 2026, question-led):** "Hi, it's {business}. Sorry we missed your call. What do you need a hand with, and which suburb? Reply here and we'll get back to you. Reply STOP to opt out. Privacy: backdesk.com.au/privacy" — the Spam Act identity is the client's business name; STOP and the plain-text privacy pointer are mandatory and checked by the template validator; no link other than the plain-text privacy pointer; the after-hours default adds one clause that the reply will be read in the morning unless it is urgent.
- **D-04 Sent through the existing send ledger as touch 1 of a `kind='lead'` cadence:** claim → sent → provider outcome exactly like a quote touch, so delivery receipts, reconcile, STOP suppression, pause-on-reply and metrics apply unchanged. Touch 1 is exempt from contact hours (the caller rang seconds ago); touches 2–3 are created but stay INERT (not chaseable) until Phase 13 wires the lead dispatch branch and per-kind policy.
- **D-05 Schema lands here in one migration entry:** `leads` table; `cadences` generalised (`kind` 'quote'|'lead', nullable `quote_id`/`sm8_job_uuid` with a CHECK, `lead_id`, partial unique one-live-per-lead); `send_ledger`/`escalations` nullable `quote_id` where needed; text-back templates + attestation; per-tenant never-text list; `missed_calls` gains the skip reason / text-back outcome and the Phase 11 review's IN-04 consistency CHECKs.
- **D-06 Deterministic pre-send gate, in this order, recording the skip reason on the missed call:** text-back not armed → client's own numbers / never-text list → withheld or absent caller → not an Australian mobile (`+614…`) → suppressed (STOP) → caller already texted for this client in the last 24 h → per-client daily cap reached. Fail safe given the skipped carrier spike (11-08 override): a caller that is absent, withheld, or equal to any of the client's own numbers is NEVER texted; `forwarded_from` is normalised and compared to the client's numbers as evidence but is never required.
- **D-07 Limits (founder 5 Oct 2026):** daily cap 30 texts per client; ClickSend balance alert below A$20; auto-disarm below A$5; all three are named constants beside the other commercial assumptions and recorded in `docs/commercial-assumptions.md`.
- **D-08 Open-quote callers get no lead (founder 27 Sep 2026):** a caller whose mobile matches a contact on an open quote cadence at the same client attaches to that cadence; the cadence pauses; the caller receives the client's attested "about your quote" template; the operator is escalated through the existing path.
- **D-09 Arming goes through the existing gate, as a third channel `text_back`:** `armChannel`/`disarmChannel` with audit rows; gate items = onboarding complete + `sm8Connected` + `divertNumber` active + `divertVerified` (the WR-02-strict proof) + text-back template set attested + never-text list contains the client's own number(s) + privacy notice covers callers (a deploy-time fact, asserted by a test). Per-client only: there is no global text-back row. Disarm takes effect on the next call and is never gated.
- **D-10 Balance alarm and failure visibility:** the existing reconcile/tick probes the ClickSend balance; below the alert floor the operator gets one alert per day; below the disarm floor every armed client's text-back is disarmed with an audit row naming the reason; any failed text-back surfaces to the operator within the tick (never silent).
- **D-11 Privacy callers section pulled forward (founder 5 Oct 2026):** COMP-01's `/privacy` callers section (what is captured from a diverted call, who processes it, retention) ships in this phase; the first text carries the plain-text pointer. COMP-01's remaining wording review and COMP-02 (90-day pseudonymisation) stay in Phase 15.
- **D-12 Onboarding runbook (COMP-03):** `docs/client-divert-onboarding-runbook.md` — carrier divert codes 61/62/67 with the iPhone settings caveat, the DIVERTED verification call from a second phone (the relocated spike proof), the carrier-charge warning, a holiday pause state, offboarding (remove the divert before the number is retired), and what to do if the caller number is missing on the verification row (do not arm).
- **D-13 `text_back` LIVE proof:** a new proof kind recorded when a real text-back is delivered to a caller for an armed client, beside the carried-forward CON-03 and MSG-02 proofs; the checklist shows text-back as Not armed / Armed, not yet proven / Live.
- **D-14 Spike S4 runs here:** measure call arrival → SMS delivered on the test tenant with the founder's handset (direct dial is acceptable for timing) and record median/worst in the evidence file; D-01 stands unless the numbers contradict it.

**Scope (verbatim):**
- In: TXT-01..06, COMP-03, and the callers section of COMP-01 (D-11).
- Out: lead follow-up dispatch, LEAD_LABELS, escalation rules for leads (Phase 13); ServiceM8 job creation (14); lead queue, reporting, pseudonymisation (15). No voice, no recording.

**Constraints carried (verbatim):**
- Hosted Supabase is production; migration push protocol before code push; never `test:remote`; `.env*` never named in commands; ClickSend is the only SMS provider (no SMS on Twilio).
- The test tenant `13e8f2aa` is paused (D-06 client pause since 13 Sep) and has an explicit SMS `enabled=false` row; its divert verification proof came from a direct dial and must be re-recorded from a diverted call before it is armed for text-back. No diverted call has been proven on any carrier (11-08 override).
- Phase 11 review items that bind here: IN-04 (consistency CHECKs), IN-07 (mark "caller is the client's own line"), IN-02 (reconcile truncation signal) if touched.

### Claude's Discretion

CONTEXT.md has no "Claude's Discretion" section. Everything not locked above is treated as a design choice the planner must make; this document gives one prescriptive recommendation per choice and lists the ones that need the founder in "Open Questions".

### Deferred Ideas (OUT OF SCOPE)

- LLM-drafted first text; links in the first text; texting the tradie on every miss; a shared divert number; per-client dedicated SMS numbers.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TXT-01 | One SMS within seconds from the client's identity via the shared number, static pre-approved template (hours / after-hours), ≤ 2 GSM segments, identity line + STOP, no LLM | §Send path (`sendTextBack`), §Templates (literal attested bytes, validator on `gsm7.ts`), §Timing budget |
| TXT-02 | Sent through the existing ledger (claim → sent → outcome); tick is the guarantee | §Send path steps 4–9, §Tick sweep, §Inertness |
| TXT-03 | Deterministic gate, skip reason recorded on the missed call; 1 text / caller / client / 24 h; daily cap 30 | §Gate design (pure `decideTextBack`, queries, CHECK vocabulary) |
| TXT-04 | Open-quote caller: no lead, attach, pause, "about your quote" template, escalate | §D-08 branch (touch 0 on the quote cadence, `pauseForReply`, `escalations.missed_call_id`) |
| TXT-05 | Armed per client through the existing gate + verification call + attested templates + own numbers on never-text; checklist item; disarm immediate | §Arming design (`MESSAGING_CHANNELS`, `ARMING_GATES.text_back`, four new checklist keys) |
| TXT-06 | Balance alert below a floor, auto-disarm below a lower floor; failed text-back surfaced within the tick | §Balance alarm, §Failure visibility |
| COMP-03 | Per-client onboarding runbook in `docs/` | §Runbook (analog `docs/telephony-runbook.md`, contract test analog `tests/runbook-contract.test.ts`) |
| COMP-01 (callers section only, D-11) | `/privacy` callers section; first text carries the plain-text pointer | §Privacy callers section (proposed text, tests that move) |
</phase_requirements>

## Summary

Phase 11 shipped the capture layer with column names that differ from the milestone architecture note: `missed_calls` has `caller_e164` / `caller_kind` / `caller_withheld` / `forwarded_from_raw` and **no text-back column of any kind**; `tenant_divert_numbers` has no `enabled` flag. So the Phase 12 migration adds the text-back state to `missed_calls`, and arming lives in `messaging_config` as D-09 says, not on the divert-number row. The existing send path is reusable almost verbatim: `dispatchOne`'s claim → `markSent` → commit → `sender.send` → `ledger.setOutcome` is the exact shape `sendTextBack` copies, the ledger's `(cadence_id, touch_number)` unique index is the send arbiter, and the DLR route, the daily reconcile, STOP suppression and `pauseForReply` all key on `cadences` / `send_ledger` and need no edits.

Five things in the code will bite a plan that follows the milestone note literally. (1) `cadences_replay_key_present` (migration 0023) refuses any new cadence without `created_by_event_id`; a lead cadence has none, so the CHECK must be widened in 0039 or every lead insert fails with 23514. (2) "Inert until Phase 13" is not free: `promoteDue`, `listNeedsDraft`, `claimDue`, the progress pass and the 42-day expiry all act on every `active` cadence, and a lead touch reaching `dispatchOne` is stopped **irreversibly** as `mirror_missing`. Four statements need a `kind = 'quote'` predicate. (3) `buildRoutingSender()` falls back to `StubSender` when no SMS row is enabled anywhere, which would write a `stub_sent` ledger row for a text-back that never left; the text-back path must refuse before the claim when the SMS provider is the stub or `resolveSmsFrom(tenant)` is null. (4) A text-back must never be sent for a stale call (a call the nightly reconcile inserted hours later), so the sweep needs a maximum age. (5) `escalations.inbound_message_id` is NOT NULL and is the never-twice key; the D-08 escalation has no inbound message, so it needs `missed_call_id` and a relaxed `inbound_message_id`, which D-05's "nullable `quote_id`" does not cover.

No new package, no new env key, no new cron job, and no new webhook route are needed. The phase is one migration (0039), one new core directory (`src/core/leads/`), edits at about a dozen named seams, a console template/never-text surface copied from `clients/[id]/drafting/`, a privacy copy section, a runbook and a read-only timing script.

**Primary recommendation:** build `sendTextBack(missedCallId, deps)` as one framework-free function called by both the `voice-status` route and a `runTextBackSweep` pass in `runCadenceTick`; make it one tenant-scoped transaction (claim the missed call → gate → lead + cadence + touches + draft + ledger claim) followed by the send and the outcome write outside the transaction; and make lead inertness structural with a `kind = 'quote'` predicate in the four tick statements plus one DB-backed test that proves a due lead touch is never promoted, drafted, claimed, re-windowed or expired.

## Project Constraints (from CLAUDE.md)

| Directive | Effect on this phase |
|---|---|
| Custom TypeScript + Next.js 16 on Vercel `syd1`, Supabase Sydney | No new service. `vercel.json` holds only `"regions": ["syd1"]` `[VERIFIED: vercel.json:1-4]` |
| ClickSend via thin typed `fetch`, never the generated SDK | Balance read is a new function in `src/core/messaging/clicksend-client.ts`, zod-parsed |
| `zod` v4 at every boundary | Template form, never-text form, balance response |
| No `waitUntil` for sends; no n8n/Zapier; no Prisma | D-01 already forbids `waitUntil`; `tests/twilio-voice-status-route.test.ts:577` and `tests/cadence-tick-route.test.ts:478` pin it |
| Dedicated virtual number, tradie identified in copy; alpha tags banned | The text-back sends from the shared number via `resolveSmsFrom`; the identity is in the template body |
| Spam Act sender ID + functional opt-out; contact-hours discipline | Template validator requires identity, STOP and the privacy pointer; touch 1 is exempt from hours by D-04, touches 2–3 are not sent in this phase |
| Never store local times; `Australia/Perth` handling explicit | `after_hours` is already stored at arrival; "one alert per day" uses a Perth-date key computed in code |
| Strict tool use for classification; no free-text parsing | No LLM in this phase at all (D-02) |
| GSD workflow enforcement | All edits happen inside `/gsd-execute-phase` plans |
| Project memory: hosted DB is production | Never `test:remote`; migration is pushed with the push protocol before code; DB-backed suites run in CI only |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trigger (call ended) | API / Backend (`/api/webhooks/twilio/voice-status`) | — | Signed provider callback; the route authenticates and hands off, it decides nothing |
| Gate decision | API / Backend (`src/core/leads/gate.ts`, pure) | Database (facts read in one transaction) | Deterministic, ordered, testable without a database |
| Send + idempotency | API / Backend (`src/core/leads/text-back.ts`) | Database (unique indexes are the arbiters) | At-most-once is an index property, never a code property, in this codebase |
| Guarantee sweep | API / Backend (`runCadenceTick`) | Database (pg_cron fires the existing job) | No new cron job (D-01) |
| Arming switch + audit | Database (`messaging_config`, `messaging_config_audit`) | API / Backend (`armChannel`, `disarmChannel`) | One transaction for the flip and its audit row |
| Arming gate evaluation | API / Backend (`readGoLiveChecklist` + `firstUnmetGate`) | Frontend Server (server action refuses, card renders) | The gate runs server-side on every call; the card derives nothing |
| Templates, never-text list | Database | Frontend Server (console server actions) | Service-role writes after the operator allowlist read; no authenticated write grant |
| Balance probe + auto-disarm | API / Backend (a tick pass) | Database (alert de-dup row, audit row) | Rides the per-minute tick with a 15-minute time gate |
| Privacy notice | CDN / Static (marketing copy module) | — | `PRIVACY_COPY` in `src/app/(marketing)/copy.ts` |
| Runbook | docs | — | Founder-facing markdown, contract-tested |

## Standard Stack

No new dependency. Everything is already installed and verified in `package.json` this session.

### Core (already present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 `[VERIFIED: package.json]` | Schema + queries | Existing repository layer; `onConflictDoNothing({ target, where })` is typed in this version `[VERIFIED: node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:138-141]` |
| `postgres` | 3.4.9 `[VERIFIED: package.json]` | Driver, transaction pooler | Existing `getDb()`; pool `max: 5` |
| `zod` | 4.4.3 `[VERIFIED: package.json]` | Boundary validation | Existing convention |
| `twilio` | 6.1.1 `[VERIFIED: package.json]` | Signature verification only | Already used by the two doors |
| `vitest` | 4.1.11 `[VERIFIED: package.json]` | Tests | Existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A `kind = 'quote'` predicate in four tick statements | A new pause reason so lead cadences are born `paused` | Zero query edits, but it widens `CADENCE_PAUSE_REASONS`, the transitions matrix test, `pauseForReply`'s upgrade arm and `operatorResumeWherePaused`'s exclusion. More moving parts than four one-line predicates. Rejected. |
| `text_back_templates` table | `kind` column on `message_templates` (milestone note) | `message_templates` is keyed on `touch_number`; the text-back set is three *variants* of one message, and `approvedSetStatus()` correlates on quote timing rows. A dedicated table avoids touching the quote template readers at all. |
| `tenant_never_text_numbers` table | An array column on `tenants` | The gate needs an indexed existence probe and a label per number; the row also needs `created_by`. |

**Installation:** none.

## Package Legitimacy Audit

Not applicable: this phase installs no external package.

## Architecture Patterns

### System Architecture Diagram

```
caller ─dials tradie─▶ carrier divert ─▶ client's Twilio 08 number
                                              │ signed form POSTs
              ┌───────────────────────────────┴───────────────────────────────┐
              ▼ (unchanged)                                                   ▼ (extended)
   /api/webhooks/twilio/voice                              /api/webhooks/twilio/voice-status
   recordMissedCallArrival → missed_calls row              token → signature → applyVoiceStatus
   greeting TwiML, never waits on anything                 completeMissedCall RETURNING id, tenant_id
                                                                    │ completed + tenant present
                                                                    ▼
                                                    sendTextBack(missedCallId, {now, sender})
   ┌──────────────────────────── one forTenant(tenant).transaction ────────────────────────────┐
   │ 1 claim: UPDATE missed_calls SET text_back_status='claimed' WHERE id AND status IS NULL   │
   │ 2 decideTextBack(facts)  ── skip ──▶ status='skipped', skip_reason=<D-06 reason>  (end)   │
   │ 3 open quote cadence for this mobile?                                                     │
   │      yes ─▶ touch 0 + draft + ledger claim on the QUOTE cadence   (D-08)                  │
   │      no  ─▶ leads.openOrCreate → cadences.createLead → touches 1..3 → draft → ledger(1)   │
   │ 4 missed_calls ← lead_id / cadence_id / ledger_id / route                                 │
   └──────────────────────────────────────── COMMIT ───────────────────────────────────────────┘
                    │ (D-08 only) pauseForReply(tenant, quoteCadence)
                    ▼
            sender.send(request)  ── ClickSend, custom_string = ledger id
                    ▼
            ledger.setOutcome(...)  →  missed_calls.text_back_status = 'sent' | 'failed'
                    ▼
   ClickSend DLR webhook (unchanged) stamps send_ledger.delivery_status by custom_string

   pg_cron cadence-tick (per minute, existing job)
     … progress (kind='quote' only) → dispatch (kind='quote' only)
     → runTextBackSweep      pending rows 45 s … 10 min old → sendTextBack; older → skipped 'stale'
     → completion → classification → escalation (+ quote-call escalations, D-08)
     → runTextBackAlertPass  failed / stuck-claimed rows → one operator email
     → runBalanceProbe       every 15th minute, only when a text_back row is armed
     → aging
```

### Recommended Project Structure

```
src/core/leads/
├── constants.ts        # LEAD_TOUCH_OFFSET_DAYS, TEXT_BACK_GRACE_SECONDS, TEXT_BACK_MAX_AGE_MINUTES, ABOUT_QUOTE_TOUCH_NUMBER
├── gate.ts             # decideTextBack(facts) — pure, ordered, returns the first skip reason
├── template.ts         # validateTextBackTemplate(), default wordings, required tokens
├── text-back.ts        # sendTextBack() — the one implementation, two callers
├── sweep.ts            # runTextBackSweep(), runTextBackAlertPass()
└── balance.ts          # runBalanceProbe() — alert + auto-disarm
src/core/escalation/quote-call.ts     # D-08 escalation (claim-then-send on missed_call_id)
src/db/schema/{leads,text-back-templates,tenant-never-text,operator-alert-log}.ts
src/db/migrations/0039_phase12_text_back.sql
src/app/(console)/clients/[id]/text-back/{page.tsx,forms.tsx,actions.ts,action-state.ts}
docs/client-divert-onboarding-runbook.md
scripts/text-back-timing.mjs
```

### Codebase map: new file → analog

| New / changed file | Analog to copy | Why that one |
|---|---|---|
| `src/db/migrations/0039_phase12_text_back.sql` | `src/db/migrations/0038_phase11_telephony_capture.sql` (header, one entry per phase, REVOKE-then-GRANT block at lines 133-189); `0023_cadence_replay_key_required.sql:68-83` for the drop-and-re-add `NOT VALID` idiom; `0022_mirror_missing_stop_reason.sql:36-43` for widening a CHECK | Same hand-finish rules |
| `src/db/schema/leads.ts` | `src/db/schema/missed-calls.ts:106-235` | Evidence family: no FK, CHECK vocabularies, member policy |
| `src/db/schema/text-back-templates.ts` | `src/db/schema/message-templates.ts:84-150` | Versioned rows, write-once approval columns |
| `src/db/schema/tenant-never-text.ts` | `src/db/schema/suppressed-contacts.ts:77-128` | Tenant-scoped address list with a unique index, insert through service role only |
| `src/db/schema/operator-alert-log.ts` | `audit_request_throttle` in `src/db/schema/audit-requests.ts` and `0035_phase9_audit_requests.sql:37` (composite PK, `is_operator()` policy) | Tenant-less, operator-only, claim by primary key |
| `src/core/leads/text-back.ts` | `src/core/cadence/dispatch.ts:352-608` (`dispatchOne` + `performSends`) and `src/core/escalation/escalate-hot-leads.ts:185-336` (per-row try/catch, counts) | Claim inside the transaction, send outside, outcome NULL on unknown |
| `src/core/leads/gate.ts` | `src/core/onboarding/arming.ts:93-105` (`firstUnmetGate`: ordered walk, absent = unmet) | Pure ordered first-refusal |
| `src/core/leads/template.ts` | `src/core/drafting/validate.ts:213-347` and `src/core/escalation/message.ts:72-103` | `countSeptets` / `segmentCount` / `normalizeForGsm7` reuse |
| `src/core/leads/sweep.ts` | `runAgingPass` at `src/core/cadence/run-tick.ts:957-1004` | Claim, then a second `try` that reports the claim it cannot undo |
| `src/core/leads/balance.ts` + `getAccountBalance` in `clicksend-client.ts` | `scripts/clicksend-balance.mjs:74-138` (field names) and `listSmsHistory` (`clicksend-client.ts:477`) for the never-throw GET shape | Same endpoint, same never-print rules |
| `src/core/escalation/quote-call.ts` | `src/core/escalation/escalate-hot-leads.ts:185-336`, `src/db/repository/escalations.ts:85-103` | Same claim-then-send, same cooldown read |
| `src/core/alerts/text-back-alerts.ts` | `src/core/alerts/stalled-drafts.ts:166-331` (`buildStalledAlert`, `sendClosedVocabularyEmail`, `resendStalledEmailSender`) | Counts-only operator email |
| `clients/[id]/text-back/actions.ts` | `src/app/(console)/clients/[id]/drafting/actions.ts:391` (`saveTemplateVersion`) and `:507` (`attestTemplateApproval`) | Save is not an attestation; approval is write-once |
| never-text form | `src/app/(console)/clients/[id]/escalation-phone-form.tsx` (92 lines) | One number, normalised at the boundary |
| checklist rows + arm control | `src/app/(console)/clients/[id]/checklist-card.tsx:59-75` (`ITEM_LABELS`), `:203-240` (`ProofSlot`, `PROOF_KIND`) | Same card |
| `docs/client-divert-onboarding-runbook.md` | `docs/telephony-runbook.md` (sections 7, 10, 11, 12) and `docs/first-client-go-live-runbook.md` | Founder-facing, evidence entry template |
| `scripts/text-back-timing.mjs` | `scripts/missed-calls-recent.mjs`; pinned by `tests/ops-scripts.test.ts` | Read-only, prints no number |
| `tests/text-back-gate.test.ts` (pure) | `tests/go-live-checklist.test.ts` gate section, `tests/failure-policy.test.ts` | Whole input space |
| `tests/text-back-template.test.ts` (pure) | `tests/gsm7.test.ts`, `tests/drafting-validate.test.ts` | Known-answer segment tests |
| `tests/text-back.test.ts` (DB, CI) | `tests/cadence-dispatch.test.ts`, `tests/escalation.test.ts` | Ledger arbiter, outcome NULL |
| `tests/text-back-sweep.test.ts` (DB, CI) | `tests/stall-tick.test.ts`, `tests/cadence-tick-isolation.test.ts` | Tick pass isolation |
| `tests/lead-cadence-inert.test.ts` (DB, CI) | `tests/cadence-completion-sweep.test.ts` | Proves the four predicates |

### Pattern 1: `sendTextBack(missedCallId, deps)` — exact construction

**Callers:** `voice-status` route (after `applyVoiceStatus` returns `completed`) and `runTextBackSweep`.

**What must be extended first (small, named):**

| Change | Where | Why |
|---|---|---|
| `completeMissedCall` returns `{ completed, id, tenantId }` (add `tenantId` to `RETURNING`) | `src/db/repository/missed-calls.ts:96-114` | The route needs the row id to trigger the send; today it returns only `{ completed: boolean }` |
| `applyVoiceStatus` result gains `missedCallId: string \| null`, `tenantId: string \| null` | `src/core/telephony/missed-call.ts:256-322` | Still never throws; the route still logs only `result.kind` |
| `SendRequest.quoteId` becomes `string \| null`; add `leadId: string \| null` | `src/core/cadence/sender.ts:49-68` | `ClickSendSender` never reads `quoteId` (`clicksend-sender.ts:60-144`); `stubTouchBody` interpolates it and is not used by this path |
| Export `claimedProviderFor(sender, channel)` (today a private function) | `src/core/cadence/dispatch.ts:140` | The text-back must write the DELEGATE's provider name into `send_ledger.sender` and must detect `'stub'` before the claim. The exported pieces today are `ChannelAwareTouchSender` (`:118`) and `isChannelAware` (`:129`) only; do not re-implement the rule in a second file |
| `SendLedgerClaim` gains `leadId`, `quoteId` nullable (falls out of the schema type) | `src/db/repository/for-tenant.ts:263-266` | Derived from `NewSendLedgerRow` |
| `forTenant().missedCalls` gains `claimForTextBack(id)`, `setTextBackDecision(...)`, `setTextBackOutcome(...)`, `countTextBacksSince(since)`, `existsTextBackToCallerSince(caller, since)` | `src/db/repository/for-tenant.ts:3671-3682` (namespace exists with `latest` only) | The claim must be in the same transaction as the ledger claim, so it must be a tenant-scoped method on the transaction handle |
| `listPendingTextBacks({ olderThan, newerThan, limit })`, `markStaleTextBacks(before)`, `getMissedCallForTextBack(id)` | `src/db/repository/missed-calls.ts` (the tenant-less one-table family) | Keeps `for-all-tenants.ts` and its `tests/sync-upsert.test.ts` table-set pin untouched |
| `forTenant().leads` (`openOrCreate`, `byId`), `forTenant().cadences.createLead`, `forTenant().cadences.liveQuoteCadenceForMobile(mobile)`, `forTenant().neverText` (`list`, `add`, `remove`, `has`), `forTenant().textBackTemplates` (`insertVersion`, `attestWhereUnattested`, `latestAttested(variant)`, `attestedSetStatus`) | `src/db/repository/for-tenant.ts` | New namespaces, same closure scoping |
| `isTextBackArmed(tenantId)` — exact-target read, no global fallback | `src/db/repository/messaging-config.ts` (reuse private `readTarget`, lines 260-272) | `getChannelConfig` falls back to the `tenant_id IS NULL` row (lines 89-110); text-back must never do that |

**Sequence (transaction boundaries marked):**

```
PRE (no transaction, own pooled reads — all before any write):
  row      = getMissedCallForTextBack(id)        tenant_id, caller_e164, caller_kind,
                                                 after_hours, started_at, forwarded_from_raw,
                                                 text_back_status
             → return 'not_found' | 'dead_letter' | 'already_decided' without writing
  armed    = isTextBackArmed(tenantId)
  smsFrom  = resolveSmsFrom(tenantId)            src/core/messaging/routing-sender.ts:185-189
  provider = claimedProviderFor(sender, 'sms')   'stub' means SMS is armed nowhere

TX  forTenant(tenantId).transaction(tx):
  1  claimed = tx.missedCalls.claimForTextBack(id)
        UPDATE missed_calls SET text_back_status='claimed', text_back_decided_at=now
        WHERE id=$1 AND tenant_id=$t AND text_back_status IS NULL RETURNING id
        zero rows → another caller owns it → return 'claim_lost' (nothing written)
  2  facts  = { armed, smsFrom, provider, row,
                ownNumbers: tx.neverText.list() ∪ normalised tenants.escalation_phone
                            ∪ the tenant's divert number ∪ smsFrom,
                suppressed: tx.suppression.existsFor([{channel:'sms', address: caller}]),
                textedSince24h: tx.missedCalls.existsTextBackToCallerSince(caller, now−24h),
                sentSince24h:   tx.missedCalls.countTextBacksSince(now−24h),
                template: tx.textBackTemplates.latestAttested(variant) }
     decision = decideTextBack(facts, now)                       PURE
     skip → tx.missedCalls.setTextBackDecision(id, {status:'skipped', skipReason}) ; return
  3  quote = tx.cadences.liveQuoteCadenceForMobile(caller)
     ── D-08 branch (quote found): see Pattern 4
     ── lead branch:
        lead    = tx.leads.openOrCreate({contactMobile, missedCallId, afterHours, at: now})
        cadence = tx.cadences.createLead({kind:'lead', leadId, contactMobile, anchorAt: now})
                  zero rows → a live lead cadence exists → skip 'lead_open'
        touches = tx.touches.insertMany([touch 1 scheduledAt=now status default, 2, 3 from
                  materializeCadenceSchedule with LEAD_TOUCH_OFFSET_DAYS])
        tx.drafts.insertAttempt({touchId: t1, attempt:1, model:'template',
                  promptVersion:'text-back-v1', generatedBody: body, finalBody: body,
                  status:'approved', approvedAt: now, segments})
        ledger  = tx.ledger.insertClaim({cadenceId, leadId, quoteId:null, touchNumber:1,
                  channel:'sms', toAddress: caller, sender: provider})
                  zero rows → skip 'claim_lost' (cannot happen on a fresh cadence; handled anyway)
        tx.touches.markSent([t1])
  4  tx.missedCalls.setTextBackDecision(id, {status:'claimed', route:'lead'|'quote',
                  leadId, cadenceId, ledgerId})
COMMIT

POST (no transaction; the dispatch.ts:558-608 rules verbatim):
  5  (D-08 only) pauseForReply(tenantId, quoteCadenceId)     idempotent
  6  outcome = await sender.send(request)      try/catch, caught value never logged
  7  forTenant(tenantId).ledger.setOutcome(ledgerId, 'sent'|'failed', providerMessageId)
  8  forTenant(tenantId).missedCalls.setTextBackOutcome(id, 'sent'|'failed', detailCode)
     a throw at 6 or 7 leaves status 'claimed' and ledger outcome NULL — never resent,
     surfaced by runTextBackAlertPass
```

**Idempotency chain (each is a database fact):** `missed_calls_provider_call_uniq (provider, provider_call_id)` → the guarded claim on `text_back_status IS NULL` → `leads_one_open_per_mobile` → `cadences_one_live_per_lead` → `send_ledger_cadence_touch_uniq (cadence_id, touch_number)` `[VERIFIED: src/db/schema/send-ledger.ts:205]`. The CallSid is the key that finds the row; the missed call's primary key is the key everything else hangs from.

**Touch 1 status trick:** `touches.insertMany` inserts with the column default `'scheduled'` and `markSent` is guarded only by `notInArray(status, TERMINAL)` `[VERIFIED: src/db/repository/for-tenant.ts:3290-3304]`, so `scheduled → sent` in one transaction is a legal write with the existing methods. No new touch status is needed.

**Why a `touch_drafts` row for a templated message:** `send_ledger` has no body column. The only stored copy of what a customer was sent is `touch_drafts.final_body`, read by `drafts.sentBodiesForCadence` `[VERIFIED: src/db/repository/for-tenant.ts:2581-2618]`. Its NOT NULL columns are `model`, `prompt_version`, `generated_body`, `final_body`, `status`, `attempt` `[VERIFIED: src/db/schema/touch-drafts.ts:133-262, read via shell]`; `quote_id` is already nullable there.

### Pattern 2: the tick sweep

`runTextBackSweep(now, sender)` placed in `runCadenceTick` directly after `dispatchDueTouches` (`src/core/cadence/run-tick.ts:1062`):

```
pending = listPendingTextBacks({ olderThan: now − 45 s, newerThan: now − 10 min, limit: 25 })
          WHERE tenant_id IS NOT NULL AND text_back_status IS NULL
          ORDER BY started_at, id
for each (own try/catch): sendTextBack(id, { now, sender })
markStaleTextBacks(before = now − 10 min)
          UPDATE … SET text_back_status='skipped', text_back_skip_reason='stale'
          WHERE tenant_id IS NOT NULL AND text_back_status IS NULL AND started_at < $1
```

- The 45 s grace lets the callback win (greeting is 12 s measured, `11-07-SUMMARY.md:67`). A row whose callback never arrived still has `ended_at NULL`; the sweep does not require completion, only age.
- The 10-minute ceiling is what stops the nightly call-log reconcile (`upsertMissedCallFromLog`, `missed-calls.ts:150-195`) from producing a text hours after a call. `[ASSUMED]` value; see Open Question 7.
- The tick's `sender` is the `RoutingSender` built once per tick. If its SMS delegate is the stub, `sendTextBack` skips with `sms_not_armed` before the claim.
- Counts go into `CadenceTickResult` field by field and into the route's enumerated response (`src/app/api/internal/cadence-tick/route.ts`), never by spread.

### Pattern 3: timing budget in `voice-status`

| Step | Cost | Source |
|---|---|---|
| Twilio hard ceiling on the callback | 15 s total, no retry on timeout or 5xx, one retry on connect failure only | `[CITED: twilio.com/docs/usage/webhooks/webhooks-connection-overrides, via 11-RESEARCH.md:132]` |
| Token + signature + `completeMissedCall` | 1 indexed UPDATE | `route.ts:106-164` |
| Pre-reads (row, armed, smsFrom) | 3 small reads, same region | new |
| Transaction | ~10 statements on one connection | new |
| ClickSend send | fixed 20 s abort (`REQUEST_TIMEOUT_MS = 20_000`) `[VERIFIED: src/core/messaging/clicksend-client.ts:51]`; typical latency unmeasured in this repo — the milestone note's "a few hundred ms" is `[ASSUMED]` | S4 measures it |
| Route `maxDuration` | `export const maxDuration = 60` `[VERIFIED: src/app/api/webhooks/twilio/voice-status/route.ts:70]` | unchanged |

Prescriptions:
- Do **not** shorten ClickSend's timeout for this path. A send aborted at 8 s whose request ClickSend already accepted leaves a NULL outcome and a customer who was texted; 20 s inside a 60 s function is the honest wait. If Twilio gives up at 15 s it logs a webhook error and does not retry; the function still finishes and records the outcome `[ASSUMED: Vercel does not cancel a Node function when the client disconnects; vercel.json sets no cancellation option]`.
- Wrap everything after the acknowledgement decision in a `try/catch` that logs a fixed string and still returns `received()`. The route's byte-identical 200 contract (`tests/twilio-voice-status-route.test.ts:385`) must hold for every text-back outcome.
- The route may log one more closed-union value (`text_back=<kind>`), never an id or a number (`tests/twilio-voice-status-route.test.ts:561`).
- Bound the pre-claim reads with the `withinDeadline` helper shape (`src/core/telephony/missed-call.ts:96-117`, 6 s). After the claim commits, nothing is aborted.
- If the pre-claim work fails or times out, write nothing: the row stays `text_back_status IS NULL` and the sweep sends it within the minute. That is the D-01 guarantee and the reason the claim is inside the transaction.

### Pattern 4: the "about your quote" branch (D-08)

- **Detect:** `SELECT id, quote_id, sm8_job_uuid, status, pause_reason, contact_name FROM cadences WHERE tenant_id = $t AND kind = 'quote' AND contact_mobile = $caller AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1`. `cadences.contact_mobile` is the normalised `+614…` snapshot written by `normalizeAuMobile` `[VERIFIED: src/db/schema/cadences.ts:339-340]`. `quote_contacts.mobile` is the raw upstream string (`src/db/schema/quote-contacts.ts`, column `mobile`) and would need normalising row by row in code; recommendation is the cadence snapshot only (Open Question 5). The existing `cadences_tenant_status_idx (tenant_id, status)` serves the query.
- **Send without disturbing the schedule:** a reserved touch number, `ABOUT_QUOTE_TOUCH_NUMBER = 0`, on the QUOTE cadence. There is no CHECK on `touch_number` in any migration (0016-0038 searched this session), so 0 is legal. In the transaction: insert a `cadence_touches` row `(cadence_id, touch_number 0, channel 'sms', scheduled_at now, original_offset_days 0)` → `touch_drafts` approved row with the attested bytes → `ledger.insertClaim({ cadenceId, quoteId, touchNumber: 0, … })` → `markSent`. Because the touch is `sent` before commit, `listUnsentForCadence`, `rewindowCadence` (`run-tick.ts:580-639`) and `planResume` (`resume.ts:99-177`, unsent touches only) never see it. `cadence_touches_cadence_touch_uniq` and the ledger index make it once per cadence, ever.
- **Pause:** `pauseForReply(tenantId, cadenceId)` after the commit (`src/core/cadence/controls.ts:836-906`). It lands `customer_reply`, the pause only an operator may lift, and it upgrades a `client_paused` or `onboarding` pause. No new pause reason, no CHECK change, no transitions edit.
- **Escalate:** `escalations` today is keyed on `inbound_message_id uuid NOT NULL` with `escalations_inbound_message_uniq` `[VERIFIED: src/db/schema/escalations.ts:116-189, read via shell]`. Add `missed_call_id uuid NULL`, drop NOT NULL on `inbound_message_id`, add CHECK exactly-one-of, add partial unique `escalations_missed_call_uniq (missed_call_id) WHERE missed_call_id IS NOT NULL`. A new pass `escalateQuoteCalls({ sender, now })` runs beside `escalateHotLeads` in the tick: read missed calls with `text_back_route = 'quote'` and no escalation row → the same (a) tradie phone via `normalizeAuMobile(tenant.escalationPhone)`, (b) `resolveSmsFrom`, (c) `recentEscalationForCadence` cooldown, (d) claim, then send with `customString = escalation id`. Message builder is a sibling of `buildEscalationSms` (`src/core/escalation/message.ts:315-353`) with the two-segment budget reused.
- **`isHotLead` is not involved:** it classifies an inbound reply (`classify-inbound.ts`); a missed call has no reply. The D-08 escalation is unconditional once the call is attached.
- **Attribution side effect (must be decided, Open Question 4):** `qualifyingTouches` (`src/core/attribution/qualify.ts:96-108`) counts every real ledger row for the quote inside the 30-day window. A touch-0 row would qualify a win for recovered-revenue attribution on its own. Recommendation: exclude `touchNumber === 0` in `qualifiesAsTouch`'s caller so an auto-reply to the customer's own phone call never claims revenue by itself.

### Pattern 5: making touches 2–3 structurally inert

A lead touch that reaches `dispatchOne` hits `tx.quotes.stateFor([touch.sm8JobUuid])` with a NULL job uuid, is treated as `quote === undefined`, and the cadence is stopped `mirror_missing` with no resume path `[VERIFIED: src/core/cadence/dispatch.ts:358-426]`. The statements that act on every `active` cadence today:

| Statement | Location | What it would do to a lead cadence | Edit |
|---|---|---|---|
| `touches.promoteDue` | `for-tenant.ts:3019-3051` | Promote touch 2 to `needs_draft` at once (24 h lead, `DRAFT_LEAD_HOURS = 24`) | add `AND kind = 'quote'` inside the cadence subquery |
| `touches.listNeedsDraft` | `for-tenant.ts:3053-3079` | Hand it to `draftTouches`, which would draft from quote wording with no quote | same subquery predicate |
| `touches.claimDue` | `for-tenant.ts:3142-3185` | Claim it for `dispatchOne` → irreversible `mirror_missing` | `eq(cadences.kind, 'quote')` in the WHERE; this also keeps `ClaimedTouch.quoteId: string` honest |
| progress pass loop + `expireOverdueCadences` | `run-tick.ts:533-560`, `:671-686` (both read `cadences.listLive()`) | Re-window / skip overdue lead touches as `min_gap` or `stale`; expire at 42 days | `listLive()` gains a `kind` parameter (default `'quote'`), or the two callers filter `cadence.kind === 'quote'` |
| `completeWhereAllTouchesDone` | `for-tenant.ts:2899-2944` | Nothing: touches 2–3 are not terminal, so the lead cadence stays `active` | none |
| `forAllTenants_approvalQueue`, `forAllTenants_claimNewlyStalled` | `for-all-tenants.ts:877`, `:1058` | Nothing: they read `needs_draft` / `pending_approval` touches, which a lead touch never reaches once `promoteDue` is filtered | none |
| `forAllTenants_cadencesByContactMobile` | `for-all-tenants.ts:605-627` | Threads a reply to the lead cadence and pauses it — **wanted** (D-04) | type only: `quoteId: string \| null` |
| `forAllTenants_hotUnescalated` → `claimEscalation` | `for-all-tenants.ts:1286-1322`, `escalations.ts:85-103` | A hot reply on a lead cadence would insert `quote_id NULL` | make `escalations.quote_id` nullable (D-05) and pass through; see Open Question 6 |

One DB-backed test (`tests/lead-cadence-inert.test.ts`) seeds a lead cadence with touch 2 `approved` and overdue, runs `runCadenceTick`, and asserts: touch untouched, cadence `active`, zero ledger rows for touch 2, `refusals.mirror_missing === 0`.

### Anti-Patterns to Avoid

- **Calling `buildRoutingSender()` and sending whatever it returns.** With no SMS row enabled anywhere it returns `StubSender` (`routing-sender.ts:142-153`, `:248-283`), `performSends`-style code records `stub_sent`, and the missed call reads as texted. Refuse before the claim when the provider is `'stub'`.
- **Reading the caller's number from the status callback.** The callback is a hint; a forgery with the token and the signing key can only re-stamp an existing row (`voice-status/route.ts:34-42`). `sendTextBack` takes an id and reads the caller from the row the signed arrival door wrote. Never pass `params.From` into the send path.
- **`getChannelConfig('text_back', tenantId)`.** It falls back to the global row by design. Use the exact-target read.
- **Adding the three limits to a new constants module.** D-07 says beside the other commercial assumptions: `src/core/audit/constants.ts`, which is pinned to exactly nine exports and no imports (`tests/audit-aggregate.test.ts:67`, `:104`). Add three, change the pin to twelve, add three sections to `docs/commercial-assumptions.md`.
- **Naming an arbiter on the quote path's `cadences.create`.** It stays targetless (`for-tenant.ts:2681-2724`). The lead path gets its own `createLead` with a targeted `onConflictDoNothing({ target: cadences.leadId, where: sql\`lead_id IS NOT NULL AND status IN ('active','paused')\` })`, so a conflict on any other index raises instead of reading as "already open".
- **A retention promise the code does not keep.** `copy.ts:402-415` says so in its own header. COMP-02 (90 days) is Phase 15; the callers section must describe today's behaviour.
- **Logging a caught value, an id beyond the row id, or any number.** Every catch in `dispatch.ts`, `run-tick.ts` and both doors discards the caught value.

## The migration: `0039_phase12_text_back.sql` — exact change list

One journal entry. `when` must exceed 0038's `1790525643412` `[VERIFIED: src/db/migrations/meta/_journal.json, idx 38]`. Generate with `npm run db:generate`, rename the tag, then hand-finish. Drizzle will try to re-create hand-written objects it cannot see (`src/db/migrations/README.md:11-35`): delete any statement touching `cadences_one_live_per_job`, `cadences_one_per_opened_event`, `cadences_id_tenant_uniq` or `cadences_replay_key_present`.

### A. Columns that are NOT NULL on a quote today

| Column | Location | Change |
|---|---|---|
| `cadences.quote_id` | `src/db/schema/cadences.ts:285` (`uuid('quote_id').notNull()`) | DROP NOT NULL |
| `cadences.sm8_job_uuid` | `src/db/schema/cadences.ts:287` (`uuid('sm8_job_uuid').notNull()`) | DROP NOT NULL |
| `send_ledger.quote_id` | `src/db/schema/send-ledger.ts:134` (`uuid('quote_id').notNull()`) | DROP NOT NULL |
| `escalations.quote_id` | `src/db/schema/escalations.ts` (`quoteId: uuid('quote_id').notNull()`) | DROP NOT NULL (D-05; used by Phase 13) |
| `escalations.inbound_message_id` | `src/db/schema/escalations.ts` (`inboundMessageId: uuid('inbound_message_id').notNull()`) | DROP NOT NULL (needed by D-08 **now**) |
| `inbound_messages.quote_id` | `src/db/schema/inbound-messages.ts` (`quoteId: uuid('quote_id')`) | already nullable — no change |
| `touch_drafts.quote_id` | `src/db/schema/touch-drafts.ts` (`quoteId: uuid('quote_id')`) | already nullable — no change |
| `cadence_touches` | no quote column at all | no change |
| `quote_attributions.quote_id`, `quote_status_events.quote_id` | attribution/outbox tables | **untouched**: they are quote-only by definition |

### B. New columns

| Table | Column | Notes |
|---|---|---|
| `cadences` | `kind text NOT NULL DEFAULT 'quote'` | CHECK `cadences_kind_known`: `kind IN ('quote','lead')` |
| `cadences` | `lead_id uuid NULL` | no FK (evidence posture, as `quote_id`) |
| `send_ledger` | `lead_id uuid NULL` | + index `send_ledger_tenant_lead_idx (tenant_id, lead_id)` |
| `escalations` | `lead_id uuid NULL`, `missed_call_id uuid NULL` | |
| `inbound_messages` | `lead_id uuid NULL` | `handleSingleMatch` writes it for a lead cadence |
| `missed_calls` | `text_back_status text NULL` | CHECK `IN ('claimed','sent','failed','skipped')`; NULL = undecided |
| `missed_calls` | `text_back_skip_reason text NULL` | CHECK vocabulary below |
| `missed_calls` | `text_back_route text NULL` | CHECK `IN ('lead','quote')` |
| `missed_calls` | `text_back_decided_at timestamptz NULL` | set by the claim |
| `missed_calls` | `text_back_detail text NULL` | provider code only, CHECK `~ '^[A-Za-z0-9_]{1,48}$'` (the `failure_code` precedent in 0038) |
| `missed_calls` | `text_back_alerted_at timestamptz NULL` | the `stall_alerted_at` claim shape |
| `missed_calls` | `lead_id`, `cadence_id`, `text_back_ledger_id` uuid NULL | no FK |
| `messaging_config_audit` | `actor text NOT NULL DEFAULT 'operator'` | CHECK `IN ('operator','system')`; `operator_user_id` DROP NOT NULL |

**`text_back_skip_reason` vocabulary** (TS const → CHECK → gate, byte-identical). D-06's seven, in D-06's order, then the four this research adds:

`'not_armed'`, `'own_number'`, `'withheld'`, `'not_mobile'`, `'suppressed'`, `'recent_text'`, `'daily_cap'`, `'stale'`, `'sms_not_armed'`, `'no_template'`, `'lead_open'` `[ASSUMED: names are this research's proposal; D-06 fixes the order and meaning of the first seven, not their spelling]`

### C. CHECKs

```sql
-- cadences: which identity each kind carries
ALTER TABLE public.cadences ADD CONSTRAINT cadences_kind_identity CHECK (
  (kind = 'quote' AND quote_id IS NOT NULL AND sm8_job_uuid IS NOT NULL AND lead_id IS NULL)
  OR (kind = 'lead' AND lead_id IS NOT NULL AND quote_id IS NULL AND sm8_job_uuid IS NULL)
);

-- the 0023 replay key: a lead cadence has no opening event
ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_replay_key_present;
ALTER TABLE public.cadences ADD CONSTRAINT cadences_replay_key_present CHECK (
  kind = 'lead'
  OR created_by_event_id IS NOT NULL
  OR created_at < '2026-08-28T08:53:44.384+00:00'::timestamptz
) NOT VALID;

-- send_ledger: exactly one owner
ALTER TABLE public.send_ledger ADD CONSTRAINT send_ledger_one_owner CHECK (
  (quote_id IS NOT NULL) <> (lead_id IS NOT NULL)
);

-- escalations: exactly one trigger
ALTER TABLE public.escalations ADD CONSTRAINT escalations_one_trigger CHECK (
  (inbound_message_id IS NOT NULL) <> (missed_call_id IS NOT NULL)
);

-- messaging_config + audit: channel vocabulary, and text_back is never global
--   messaging_config_channel_known        → channel IN ('sms','email','text_back')
--   messaging_config_audit_channel_known  → channel IN ('sms','email','text_back')
--   messaging_config_text_back_per_tenant → channel <> 'text_back' OR tenant_id IS NOT NULL   (both tables)
-- audit actor
--   messaging_config_audit_actor_known    → actor IN ('operator','system')
--   messaging_config_audit_actor_identity → (actor = 'operator') = (operator_user_id IS NOT NULL)
--   messaging_config_audit_system_disarms → actor = 'operator' OR action = 'disarm'

-- tenant_proofs_kind_known → add 'text_back_proof'

-- missed_calls (IN-04 + text-back consistency)
--   missed_calls_withheld_has_no_number     → (caller_kind = 'withheld') = (caller_e164 IS NULL)
--   missed_calls_withheld_flag_consistent   → caller_withheld = (caller_kind = 'withheld')
--   missed_calls_dead_letter_iff_no_tenant  → (tenant_id IS NULL) = (dead_letter_reason IS NOT NULL)
--   missed_calls_text_back_status_known, _skip_reason_known, _route_known
--   missed_calls_skip_reason_iff_skipped    → (text_back_status = 'skipped') = (text_back_skip_reason IS NOT NULL)
--   missed_calls_no_text_back_on_dead_letter→ tenant_id IS NOT NULL OR text_back_status IS NULL
```

The replay-key definition quoted above extends the existing one verbatim: `created_by_event_id IS NOT NULL OR created_at < '2026-08-28T08:53:44.384+00:00'::timestamptz` … `NOT VALID` `[VERIFIED: src/db/migrations/0023_cadence_replay_key_required.sql:68-76, read via shell]`. `tests/rls-coverage.test.ts:621-624` asserts the definition still matches `/created_by_event_id IS NOT NULL/` and `convalidated === false`; both survive the widening.

**The three IN-04 CHECKs must be pre-flighted against production with a read-only count before the migration is pushed** (the "verified against the production database before applying" rule in `0024`'s header). The code paths that write these columns are consistent: `classifyCaller` returns `e164: null` only for `withheld` `[VERIFIED: src/core/telephony/caller.ts:41-44]`, the arrival writes `callerWithheld: caller.kind === 'withheld'` `[VERIFIED: src/core/telephony/missed-call.ts:226]`, and a dead letter writes `tenantId: null` with a reason `[VERIFIED: src/core/telephony/missed-call.ts:166-185]`. The reconcile's rows were not exhaustively traced; the count is the proof. `'body_unreadable'` is in `DEAD_LETTER_REASONS` and no code writes it (IN-04); leave it in the vocabulary (narrowing a CHECK needs its own data proof and buys nothing).

### D. Indexes

| Index | Definition | Purpose |
|---|---|---|
| `cadences_one_live_per_lead` (UNIQUE, partial) | `ON cadences (lead_id) WHERE lead_id IS NOT NULL AND status IN ('active','paused')` | Sits beside `cadences_one_live_per_quote` (`ON cadences (quote_id) WHERE status IN ('active', 'paused')`, `cadences.ts:353-355`). Quote rows have `lead_id IS NULL` and can never conflict on it, so the targetless `cadences.create` keeps its meaning. **Write that sentence in the migration header.** |
| `leads_one_open_per_mobile` (UNIQUE, partial) | `ON leads (tenant_id, contact_mobile) WHERE status = 'open'` | `openOrCreate` arbiter |
| `escalations_missed_call_uniq` (UNIQUE, partial) | `ON escalations (missed_call_id) WHERE missed_call_id IS NOT NULL` | D-08 never-twice |
| `missed_calls_text_back_pending_idx` (partial) | `ON missed_calls (started_at) WHERE text_back_status IS NULL AND tenant_id IS NOT NULL` | The sweep |
| `missed_calls_text_back_caller_idx` (partial) | `ON missed_calls (tenant_id, caller_e164, text_back_decided_at DESC) WHERE text_back_status IN ('claimed','sent')` | 24 h rule and daily cap |
| `missed_calls_text_back_alert_idx` (partial) | `ON missed_calls (text_back_decided_at) WHERE text_back_alerted_at IS NULL AND text_back_status IN ('failed','claimed')` | Failure alert pass |
| `text_back_templates_tenant_variant_version_uniq` (UNIQUE) | `(tenant_id, variant, version)` | `insertVersion` arbiter (the `message_templates` shape) |
| `tenant_never_text_tenant_number_uniq` (UNIQUE) | `(tenant_id, number_e164)` | |
| `send_ledger_tenant_lead_idx` | `(tenant_id, lead_id)` | Phase 15 reads |

Existing indexes that reference the relaxed columns and need **no** change: `cadences_one_live_per_quote`, `cadences_one_live_per_job (tenant_id, sm8_job_uuid)`, `cadences_one_per_opened_event`, `send_ledger_tenant_quote_idx (tenant_id, quote_id)`, `escalations_inbound_message_uniq`. NULLs are distinct in all of them.

### E. New tables (all: RLS on, `REVOKE ALL` from `anon`/`authenticated`, `GRANT SELECT` to both, `GRANT ALL` to `service_role` — the 0038 block)

```
leads                     id, tenant_id NOT NULL, contact_mobile NOT NULL CHECK ~ '^[+]614[0-9]{8}$',
                          source CHECK IN ('missed_call'),
                          status CHECK IN ('open','converted','closed','expired') DEFAULT 'open',
                          first_missed_call_id, first_missed_at, last_missed_at,
                          missed_call_count int DEFAULT 1, after_hours boolean,
                          created_at, updated_at            policy: has_tenant_access(tenant_id)
text_back_templates       id, tenant_id NOT NULL, variant CHECK IN ('business_hours','after_hours','about_quote'),
                          version smallint, body text NOT NULL, segments smallint NOT NULL,
                          attested_at NULL, attested_by NULL, attestation_note NULL, created_at
                                                           policy: has_tenant_access(tenant_id)
tenant_never_text_numbers id, tenant_id NOT NULL, number_e164 CHECK ~ '^[+]61[0-9]{9}$',
                          kind CHECK IN ('own_line','never_text'), label text CHECK length ≤ 60,
                          created_by uuid NOT NULL, created_at
                                                           policy: has_tenant_access(tenant_id)
operator_alert_log        kind CHECK IN ('clicksend_balance_low','text_back_auto_disarmed'),
                          alert_day date, detail jsonb, created_at, PRIMARY KEY (kind, alert_day)
                                                           policy: is_operator()
```

No foreign key from `leads`, and none from `tenant_never_text_numbers` that cascades away evidence; `text_back_templates` may cascade from `tenants` as `message_templates` does.

### F. Data statement

`UPDATE missed_calls SET text_back_status = 'skipped', text_back_skip_reason = 'not_armed' WHERE tenant_id IS NOT NULL;` — every existing row predates text-back. Without it the first sweep would have to age them out; with it the state is explicit.

### G. Repository methods and types that assume a quote

| Item | Location | What changes |
|---|---|---|
| `CadenceCreate` (requires `createdByEventId: number`) | `for-tenant.ts:208-229` | Unchanged for quotes; add `LeadCadenceCreate` + `cadences.createLead` |
| `cadences.create` | `for-tenant.ts:2681-2724` | Unchanged; update its header comment to name the fourth arbiter and why it cannot fire |
| `cadences.getByQuoteId`, `stopWhereLiveByQuoteIds` | `for-tenant.ts:2726-2731`, `:2777-2799` | No change (NULL never equals a quote id) |
| `ClaimedTouch` (`quoteId: string`, `sm8JobUuid: string`) | `for-tenant.ts:442-453` | Keep non-null; `claimDue` filters `kind='quote'` and the select narrows |
| `touches.claimDue` / `promoteDue` / `listNeedsDraft` | `for-tenant.ts:3142-3185`, `:3019-3051`, `:3053-3079` | `kind = 'quote'` predicate |
| `ledger.insertClaim` | `for-tenant.ts:3343-3352` | type only |
| `ledger.listForQuote`, `countQuotesChasedInPeriod` | `for-tenant.ts:3377-3413` | No change (`COUNT(DISTINCT quote_id)` ignores NULL) |
| `inbound.listThreadedForQuote` | `for-tenant.ts:3421-3442` | No change |
| `metrics.windowCounts` | `for-tenant.ts:3810-3960` | **No edit in this phase**, but note: `sentInWindow`, `cadencesTouched`, `contactsTouched` count every real ledger row, so text-backs enter the live metrics (D-04 "metrics apply unchanged"). Its twin `forAllTenants_reportMetrics` (`for-all-tenants.ts:1406`) behaves the same; `tests/report-metrics.test.ts` parity holds because neither changes |
| `forAllTenants_cadencesByContactMobile` (`quoteId: string`) | `for-all-tenants.ts:549-627` | type → `string \| null`; add `kind`, `leadId` |
| `forAllTenants_approvalQueue` (`quoteId: string`, left join quotes) | `for-all-tenants.ts:766-945` | type only if touched; lead touches never reach it this phase |
| `forAllTenants_hotUnescalated` (`quoteId: string`) | `for-all-tenants.ts:1214-1322` | type → nullable; see Open Question 6 |
| `EscalationClaim.quoteId: string`, `claimEscalation` | `src/db/repository/escalations.ts:46-103` | nullable; add `claimEscalationForMissedCall` |
| `listEscalationsForQuote`, `getEscalationForTenant` | `escalations.ts:236-313` | select types widen |
| `handleSingleMatch` writes `quoteId: candidate.quoteId` | `src/core/messaging/inbound.ts:280-287` | add `leadId` |
| `draftTouches`, `editThenApprove` | `src/core/drafting/draft-touches.ts:807`, `src/core/approval/approve-draft.ts:491` | Already written as `cadence.quoteId ? … : []`; compile unchanged |
| `dispatchOne` | `src/core/cadence/dispatch.ts:500`, `:529` | Compiles unchanged if `ClaimedTouch` stays non-null |
| `stubTouchBody` | `src/core/cadence/sender.ts:132-143` | `quoteId` param type only |
| Console pages that read `cadences.quote_id` through the JWT | `src/app/(console)/clients/[id]/page.tsx`, `queue/`, `inbox/` | **Run `npx tsc --noEmit` after the schema edit: the compile errors are the checklist.** Not enumerated line by line here |

`forTenant()` namespaces today (22): `tenant, connection, quotes, templates, drafts, settings, cadences, touches, ledger, inbound, suppression, attestations, proofs, divertNumber, missedCalls, attributions, reports, fees, metrics, quoteContacts, events, consumerCursor, syncRuns` `[VERIFIED: src/db/repository/for-tenant.ts:2121-4176, outline read this session]`. New: `leads`, `neverText`, `textBackTemplates`.

## The gate (D-06)

### Where each fact lives

| Fact | Source | Location |
|---|---|---|
| Armed | `messaging_config` row `(channel='text_back', tenant_id=T, enabled)` | new `isTextBackArmed`; table at `src/db/schema/messaging-config.ts:86-194` |
| Client's own numbers / never-text | `tenant_never_text_numbers` ∪ `normalizeAuMobile(tenants.escalation_phone)` ∪ the tenant's divert number ∪ the SMS from-number | new table; `escalationPhone: text('escalation_phone')` on `tenants`; `tenant_divert_numbers.number_e164` |
| Withheld / absent | `missed_calls.caller_kind = 'withheld'` (always with `caller_e164 IS NULL`) | `missed-calls.ts:135-139`; `CALLER_KINDS = ['mobile', 'other_number', 'withheld']` `[VERIFIED: src/db/schema/missed-calls.ts:65]` |
| Not an AU mobile | `caller_kind <> 'mobile'` — `classifyCaller` returns `mobile` only when `normalizeAuMobile` accepts it (`/^\+?614\d{8}$/` or local `04…`) | `src/core/telephony/caller.ts:109-128`; `src/core/cadence/primary-contact.ts:129-141` |
| Suppressed | `suppressed_contacts (tenant_id, channel, address)` via `tx.suppression.existsFor([{ channel: 'sms', address }])` | `for-tenant.ts:3485-3516`; STOP is written by `suppressFromInbound` / `suppressBareContact` (`controls.ts:391`, `:442`) |
| Texted in last 24 h | `missed_calls` rows for `(tenant, caller)` with `text_back_status IN ('claimed','sent')` and `text_back_decided_at >= now − 24 h` | new query + partial index |
| Daily cap | count of the same statuses for the tenant since `now − 24 h` | new query; cap from `TEXT_BACK_DAILY_CAP` |

### IN-07: marking "the caller is the client's own line"

1. Onboarding records the client's own line(s) as `kind = 'own_line'` rows, normalised through `classifyCaller(input).e164` so a landline office number (`+618…`) is accepted as well as a mobile. The arming gate item `neverTextOwnNumber` is satisfied only by at least one `own_line` row; an empty list is "not armable" (the review's wording).
2. In the gate: `own = classifyCaller(row.forwardedFromRaw).e164`. Skip `own_number` when `caller_e164` is in the never-text set **or** `caller_e164 === own`. So a carrier that substitutes the diverting line as CLI is caught twice: by the list, and by `ForwardedFrom` when the carrier sends it.
3. Evidence only, never required: when `ForwardedFrom` is present and its normalised value is **not** an `own_line` row, log the fixed string `[text-back] forwarded_from_unlisted` (no number). The runbook tells the operator to add that line. Absence of `ForwardedFrom` changes nothing.

### `decideTextBack(facts, now)` — pure, ordered

```
1  !facts.armed                                        → 'not_armed'
2  caller ∈ ownNumbers  ||  caller === forwardedFromE164 → 'own_number'
3  callerKind === 'withheld' || callerE164 === null    → 'withheld'
4  callerKind !== 'mobile'                             → 'not_mobile'
5  facts.suppressed                                    → 'suppressed'
6  facts.textedSince24h                                → 'recent_text'
7  facts.sentSince24h >= TEXT_BACK_DAILY_CAP           → 'daily_cap'
── additions, after D-06's seven so its order is untouched ──
8  now − startedAt > TEXT_BACK_MAX_AGE_MINUTES         → 'stale'
9  smsFrom === null || provider === 'stub'             → 'sms_not_armed'
10 template for the variant === null                   → 'no_template'
   otherwise                                           → { send: true, variant }
```

Step 2 precedes step 3 exactly as D-06 orders them; a withheld caller has no number to compare, so step 2 is simply false for it. An absent fact is a refusal, never a pass (the `firstUnmetGate` rule, `arming.ts:83-92`): if the never-text read fails the transaction rolls back and the sweep retries.

### The two rate queries

```sql
-- 6: this caller, this client, last 24 h
SELECT 1 FROM missed_calls
 WHERE tenant_id = $t AND caller_e164 = $caller AND id <> $this
   AND text_back_status IN ('claimed','sent')
   AND text_back_decided_at >= $now - interval '24 hours'
 LIMIT 1;

-- 7: this client, last 24 h
SELECT count(*)::int FROM missed_calls
 WHERE tenant_id = $t AND text_back_status IN ('claimed','sent')
   AND text_back_decided_at >= $now - interval '24 hours';
```

Build both with drizzle operators (`gte(col, date)`), never a raw `Date` inside a `sql` template: the repository documents that postgres.js throws at Bind time for that form (`for-tenant.ts:3030-3037`). `'failed'` is excluded from both on purpose: a refused send (no credit) should not block the redial five minutes later, and should not consume the cap. `'claimed'` (outcome unknown) is included: the customer may have been texted.

Both reads run inside the claim transaction, after the claim. Two calls from the same number seconds apart are serialised by neither index, so under READ COMMITTED both could pass step 6; the second is then stopped by `leads_one_open_per_mobile` / `cadences_one_live_per_lead` and recorded `lead_open`. That is the arbiter; step 6 is the common-case filter.

## Arming as a third channel (D-09)

### What exists

- `MESSAGING_CHANNELS = ['sms', 'email'] as const` `[VERIFIED: src/db/schema/messaging-config.ts:83-84]`; CHECK `messaging_config_channel_known`: `channel IN ('sms', 'email')`; UNIQUE `messaging_config_channel_tenant_uniq` on `(channel, tenant_id)` NULLS NOT DISTINCT `[VERIFIED: src/db/schema/messaging-config.ts:166-170, read via shell]`.
- `armChannel` refuses with `no_identity` when the target row is missing or has no `from_address` (`messaging-config.ts:319-366`); `disarmChannel` requires a non-empty reason and creates an explicit-off row when none exists (`:396-451`); both write `messaging_config_audit` in the same transaction through private `appendAudit` (`:458-477`).
- `messaging_config_audit.operator_user_id` is `uuid('operator_user_id').notNull()`; `MESSAGING_CONFIG_AUDIT_ACTIONS = ['arm', 'disarm']`; CHECKs `messaging_config_audit_channel_known` (`channel IN ('sms', 'email')`), `messaging_config_audit_action_known`, `messaging_config_audit_disarm_reason` `[VERIFIED: src/db/schema/messaging-config-audit.ts:60-168, read via shell]`.
- `ARMING_GATES` is `{ sms: BOTH_CHANNELS, email: [...BOTH_CHANNELS, 'sendingDomainVerified'] } as const satisfies Record<MessagingChannel, readonly ChecklistItemKey[]>` with `BOTH_CHANNELS = ['sm8Connected','contactHours','templatesApproved','sm8AutomationOff','escalationPhone']` `[VERIFIED: src/core/onboarding/arming.ts:59-78]`.
- `CHECKLIST_ITEM_KEYS` has thirteen members ending `'divertNumber', 'divertVerified'` `[VERIFIED: src/core/onboarding/checklist.ts:150-164]`; `divertVerified` is satisfied by the mere existence of a `divert_verification_call` proof row (`checklist.ts:626-632`).
- `TENANT_PROOF_KINDS = ['escalation_handset_proof', 'email_pipe_proof', 'divert_verification_call']` `[VERIFIED: src/db/schema/tenant-proofs.ts:66-71, read via shell]`; `recordProofAction` verifies each artefact live and tenant-scoped before the insert, with `ACTION_PROOF_KINDS` spelled out so a new kind is refused until its verification arm exists (`src/app/(console)/clients/[id]/actions.ts:819-823`, `:912-1158`).
- "Onboarding complete" has one definition: `conditions.templatesApproved && conditions.sm8AutomationAttested` `[VERIFIED: src/core/drafting/onboarding-gate.ts:180-182, read via shell]`.

### What to build

1. **Vocabulary:** `MESSAGING_CHANNELS = ['sms', 'email', 'text_back']`. This is a compile-driven change: `ARMING_GATES` (`satisfies Record<MessagingChannel, …>`), `ARM_REFUSAL: Record<GatingKey, string>` (`action-state.ts:183`), `ARM_ALREADY_MESSAGE` / `DISARM_ALREADY_MESSAGE` (`action-state.ts:230-235`), `armNoIdentityMessage`, `armedMessage`, `disarmedMessage`, and `armSchema` / `disarmSchema` (`actions.ts:602-619`) all fail to compile until they have a `text_back` arm. `TouchChannel` (`cadence-templates.ts:50-51`) is a separate type and is **not** widened: nothing can route a touch on `text_back`.
2. **Per-tenant only, three layers:** the CHECK `channel <> 'text_back' OR tenant_id IS NOT NULL` on both tables; `armChannel`/`disarmChannel` return a refusal when `channel === 'text_back' && tenantId === null`; the action computes `tenantId: channel === 'sms' && target === 'everyone' ? null : tenantId`.
3. **No identity needed:** in `armChannel`, a `text_back` target with no row is created (`enabled: true`, identity columns NULL) rather than refused `no_identity`; the from-number stays `resolveSmsFrom`'s to answer.
4. **Reader:** `isTextBackArmed(tenantId)` on the exact target. `anyChannelEnabled('text_back')` (unchanged code) is the cheap "is anyone armed" test the balance probe uses.
5. **Checklist:** four new keys after `divertVerified`: `'textBackTemplates'` (latest attested version exists for all three variants), `'neverTextOwnNumber'` (≥ 1 `own_line` row), `'textBackArmed'`, `'textBackProof'`. `GoLiveChecklist.live` gains `textBack: LiveState` from `deriveLive(textBackArmed, textBackProof !== null)` (`checklist.ts:642-643`). Seventeen items.
6. **Gate:** `text_back: [...BOTH_CHANNELS, 'smsArmed', 'divertNumber', 'divertVerified', 'textBackTemplates', 'neverTextOwnNumber']`. `BOTH_CHANNELS` covers "onboarding complete + `sm8Connected`" and adds contact hours (the after-hours flag depends on them) and the escalation phone (D-08 needs it). `smsArmed` is this research's addition (Open Question 1).
7. **WR-02-strict `divertVerified`:** tighten the item itself: satisfied only when the latest proof's `artefact_detail.caller_present === true` and `artefact_detail.divert_number_id` equals the active divert row id. Both keys are written by `recordProofAction` (`actions.ts:1069-1081`: `caller_present: call.callerPresent`, `divert_number_id: call.divertNumberId`). The test tenant's 2 Oct proof predates WR-02 and goes unmet, which is exactly the carried constraint.
8. **Privacy as a deploy-time fact:** a pure test asserts `PRIVACY_COPY.sections` contains the callers section naming Twilio and ClickSend. It is not a checklist row; core code cannot import `src/app/(marketing)/copy.ts`.
9. **Audit actor for the system:** `actor = 'system'`, `operator_user_id NULL`, reason required (existing CHECK), `action = 'disarm'` only. `DisarmChannelInput.operatorUserId` becomes `string | null` behind a separate exported `disarmChannelBySystem({ channel: 'text_back', tenantId, reason })` so no caller can pass NULL by accident. `ChannelAuditRow.operatorUserId` becomes nullable and the card renders "system". No sentinel uuid: the repo has none (`grep SYSTEM_` found nothing in `src/` or `scripts/`).
10. **`text_back_proof`:** artefact = a `missed_calls.id`. Verification arm (new read `getTextBackEvidenceForTenant(tenantId, id)` joining the row to its ledger row, ids/statuses/timestamps only): tenant in the predicate; `text_back_status = 'sent'`; `text_back_route = 'lead'`; ledger `outcome = 'sent'` with a `provider_message_id`; ledger `delivery_status = 'delivered'` (the DLR — "delivered", not "accepted"); recent (reuse `PROOF_MISSED_CALL_MAX_AGE_MS`). `artefact_detail`: `provider_message_id`, `delivered_at`, `started_at`, `seconds_to_delivered`, `after_hours`, `forwarded_from_present`. Gate for recording it: `textBackArmed` (the `PROOF_CHANNEL` map gains a `'text_back'` value). `ACTION_PROOF_KINDS`, `PROOF_KIND`, `ProofSlot` (`checklist-card.tsx:203-240`) each gain the member.
11. **Disarm is never gated and is immediate:** `disarmChannelAction` reads no checklist today (`actions.ts:756-809`); the gate re-reads `isTextBackArmed` on every call, so the next call after the commit is skipped `not_armed`.

### How `text_back` coexists with the shared SMS arming

SMS arms the GLOBAL row (`tenant_id IS NULL`) or one client's override; `resolveSmsFrom(tenantId)` returns the tenant row's number if that row is enabled, else the global row's, else `null`, and an explicit per-client `enabled = false` means stop (`routing-sender.ts:155-189`). `ClickSendSender.send` calls it and records `sms_not_configured` when it is null (`clicksend-sender.ts:101-109`). So a text-back physically cannot leave unless the client's effective SMS row is enabled. Recommendation: make that explicit rather than discovered at send time — `smsArmed` in the `text_back` gate, and gate step 9 (`sms_not_armed`) before the claim so no ledger row is written for a send that cannot happen. For the test tenant this means S4 needs its SMS override row armed (its D-06 client pause keeps the quote cadences quiet: `claimForTenant` refuses when `settings.pausedAt` is set, `dispatch.ts:327-330`).

Text-back deliberately does **not** read the client pause (`cadence_settings.paused_at`) or the connection pause: it has its own switch. The runbook's holiday state is "disarm text-back with a reason" (Open Question 8).

## Balance alarm and failure visibility (D-10, TXT-06)

- **No `getBalance` exists in the client.** `src/core/messaging/clicksend-client.ts` exports `sendSms`, `listSmsHistory`, `listInboundSms`, `codeOf`, `isOptOutCode` only. Add `getAccountBalance(creds): Promise<{ ok: true; balanceCents: number; currency: string } | { ok: false; reason: string }>`: `GET https://rest.clicksend.com/v3/account`, Basic auth, 5 s abort, zod-parse `data.balance` and `data._currency.currency_name_short`. Those field names produced a real answer on this account: `clicksend balance: 0.029806 AUD (low-credit threshold 0.50, auto-recharge on)` `[VERIFIED: evidence line recorded in .planning (10-series summary) from scripts/clicksend-balance.mjs]`. A currency other than `AUD`, or an unparseable balance, is `ok: false` — never a disarm.
- **Where it runs:** a `runBalanceProbe(now)` pass in `runCadenceTick`, gated by `now.getUTCMinutes() % 15 === 0` and `anyChannelEnabled('text_back')`. Existing jobs are `sm8-sync-tick` (`*/5 * * * *`), `cadence-tick` (`* * * * *`), `messaging-reconcile` (`30 19 * * *` UTC), `stalled-digest` (`30 22 * * *` UTC) `[VERIFIED: scripts/apply-cron-schedules.mjs:72-124, read via shell]`. The two daily jobs are too slow for an auto-disarm; a new job is forbidden; the per-minute tick with a time gate gives the suggested 15 minutes with no stored state. A skipped tick skips one probe.
- **Second trigger:** a text-back whose provider reason is `INSUFFICIENT_CREDIT` runs the probe immediately in the same pass. That spelling is named as ClickSend's own reason in `src/db/schema/escalations.ts:97` and the first live SMS failed with it; no constant for it exists in `src/`, so the planner adds one beside `isOptOutCode` rather than a string literal in two places `[ASSUMED: exact provider spelling as returned through codeOf — confirm against one recorded ledger/escalation outcome before relying on it]`.
- **Constants** in `src/core/audit/constants.ts`: `TEXT_BACK_DAILY_CAP = 30`, `CLICKSEND_BALANCE_ALERT_FLOOR_CENTS = 2000`, `CLICKSEND_BALANCE_DISARM_FLOOR_CENTS = 500`.
- **Alert de-duplication:** claim-then-send on `operator_alert_log (kind, alert_day)`, `INSERT … ON CONFLICT DO NOTHING RETURNING` — zero rows means today's alert is already sent. `alert_day` is the Perth calendar date computed in code with `@date-fns/tz` (already a dependency).
- **Auto-disarm:** below the disarm floor, `listChannelConfig('text_back')` (`messaging-config.ts:162-170`) → every enabled row → `disarmChannelBySystem` with reason `auto: ClickSend balance below A$5`. The disarm is self-de-duplicating (`already_disarmed` writes no audit row). One email names how many clients were disarmed.
- **Alert channel is email**, through the `stalled-drafts.ts` closed-vocabulary sender. An SMS about an empty SMS balance goes nowhere.
- **Failed text-backs within the tick:** `runTextBackAlertPass(now, send)`: guarded UPDATE `SET text_back_alerted_at = now WHERE text_back_alerted_at IS NULL AND (text_back_status = 'failed' OR (text_back_status = 'claimed' AND text_back_decided_at < now − 2 min)) RETURNING tenant_id` → one email with per-client counts and no numbers. Split the `try` at the claim exactly as `runAgingPass` does (`run-tick.ts:940-1003`), so a lost email is reported as `textBackAlertFailed`, not as zero.

## Templates (D-02, D-03)

- **Storage:** `text_back_templates`, three variants, versioned, with write-once attestation columns. The gate reads `latestAttested(variant)` — the newest version with `attested_at IS NOT NULL`, so an unattested edit never changes what goes out (the `latestApproved` rule, `for-tenant.ts:2354-2372`).
- **Bytes:** store the **final literal text** with the business name typed in, not a `{business}` token. The form pre-fills D-03's default with the tenant's name. What the operator attests is what is sent, byte for byte (`gsm7.ts:196-200`: "The bytes an operator approves and the bytes ClickSend sends must be identical"). A token would let a later rename change attested bytes.
- **Validator** (`validateTextBackTemplate(body, { businessName, variant })`), run at save and again inside `sendTextBack` (a failed re-check is `no_template`):
  1. `normalizeForGsm7(body)` then `countSeptets` must return `encoding: 'gsm7'` (`src/core/drafting/gsm7.ts:114-134`, `:202-208`);
  2. `segmentCount(septets) <= 2` (`gsm7.ts:156-160`; two segments = 306 septets);
  3. contains the client's business name (case-insensitive, trimmed) — the Spam Act identity;
  4. matches `/\bReply STOP\b/i` (lead variants and the about-quote variant alike);
  5. contains the exact string `backdesk.com.au/privacy`;
  6. after removing that pointer, matches no `https?://`, `www.` or `[a-z0-9-]+\.[a-z]{2,}` pattern — no other link;
  7. non-empty after trim.
- **Segment arithmetic for D-03's default** (computed this session): the fixed text without the name is 179 characters, all GSM basic. It can never be one segment. Two segments leave 127 characters for the name in the business-hours variant; `tenants.name` is capped at 120 (`tenants_name_len`, `0004_tenant_constraints.sql:51-55`), so it always fits. The after-hours clause budget is `306 − 179 − len(name)`; a 57-character clause leaves 70 for the name. The validator, not arithmetic in a comment, is what enforces this.
- **Existing pins to reuse:** the operator SMS's one-segment budget is asserted against `countSeptets` (`src/core/alerts/operator-sms.ts:58-122`); `MAX_SEGMENTS = 2` in `src/core/drafting/validate.ts:109`; `ESCALATION_SEPTET_BUDGET` in `src/core/escalation/message.ts:92`.
- **Console:** `clients/[id]/text-back/` copies `drafting/`: `saveTemplateVersion` (`drafting/actions.ts:391-465`) → save a version, show the segment count; `attestTemplateApproval` (`:507-562`) → write-once attestation with a required note and `requireOperatorId()` as `attested_by`. Same four checks before any byte of `formData` is read.
- **Default wordings** are constants in `src/core/leads/template.ts`. D-03 fixes the business-hours text. The after-hours clause and the about-quote text are `[ASSUMED]` proposals for the founder:
  - after hours: D-03 text with "…we'll get back to you." replaced by "…we'll get back to you. We read replies in the morning unless it's urgent."
  - about quote: "Hi, it's {business}. Sorry we missed your call. Is it about your quote? Reply here and we'll get back to you. Reply STOP to opt out. Privacy: backdesk.com.au/privacy"

## Privacy callers section (D-11)

- **Structure:** `PRIVACY_COPY = { h1, dateLine, sections: [{ id, h2, paragraphs }] }` with seven sections `collect, why, where, processors, retention, access, contact` `[VERIFIED: src/app/(marketing)/copy.ts:416-505]`. The page maps `sections` generically (`privacy/page.tsx:33`), so a new section needs no page edit.
- **Date line:** `Last updated 19 September 2026. Backdesk is operated by …` — change the date; the test matches `/Last updated \d{1,2} \w+ 2026\./` (`tests/privacy-page.test.ts:66`).
- **Pinned sentences that must not change:** `'Your details and any file you attach are stored with Supabase in Sydney, Australia.'` and `'Email is sent through Resend, SMS through ClickSend, and message drafting uses Anthropic. These providers process content outside Australia.'` (`tests/privacy-page.test.ts:79-88`). Twilio is therefore named inside the new section, not by editing the pinned one.
- **Scans the new text must pass** (`tests/marketing-copy.test.ts`): none of the `FORBIDDEN` words (`'automation'`, `'agent'`, `'bot'`, `'assistant'`, `'dashboard'`, `'platform'`, `'solution'`, `'proven'`, `'demo'`, … lines 33-60, whole-word, case-insensitive); no em dash and no `!`; no domain ending `.com`, `.com.au`, `.io`, `.net`, `.app` other than `backdesk.com.au`; "ServiceM8" and "Backdesk" spelled exactly; the phrase "Run by AI, checked by a human" still appears exactly once across all copy; no `(all|entirely|fully|only) … in Australia` (`privacy-page.test.ts:93`); every paragraph longer than 40 characters (`:72`).
- **Proposed section** (insert after `collect`; id `callers`):

  > **h2:** If you called a business that uses Backdesk
  >
  > Some businesses divert the calls they cannot answer to a Backdesk phone number. If you rang one of them and heard a short greeting, this section is about you.
  >
  > We collect the number you called from, the number you rang, and the time and length of the call. The call is not recorded and nothing you say is kept. If your number was withheld, we do not receive it.
  >
  > We use your number to send you one text message on behalf of the business you called, so they can get back to you. If you reply, we keep your messages and the replies sent to you, and we pass them to that business.
  >
  > The call is answered through Twilio and the text is sent through ClickSend. Both process these details outside Australia. If the business writes back to you, the wording may be drafted with Anthropic and a person approves it before it is sent.
  >
  > Reply STOP to any text and that business will not message your number again through us. We keep a stopped number on a do-not-message list so that the request keeps working.
  >
  > The record of your call is kept with the service records of the business you called, for the term of their agreement with us. You can ask us to delete it sooner, using the contact details below.

  The last paragraph states what the code does today. The 90-day pseudonymisation sentence belongs to Phase 15 with COMP-02 (Open Question 9).

## Runbook (D-12, COMP-03)

`docs/client-divert-onboarding-runbook.md`, modelled on `docs/telephony-runbook.md` (twelve numbered sections, an evidence entry template, a "What is never done" section). Required content from D-12: divert codes 61 / 62 / 67 with the iPhone settings caveat; the DIVERTED verification call from a second phone and what the row must show (`caller_present=true`, on the active number) — and "do not arm" if the caller is missing; the carrier-charge warning; the never-text list (own lines first); template attestation; arming; the holiday state; offboarding (remove the divert before the number is retired; numbers are never released). A contract test in the `tests/runbook-contract.test.ts` shape asserts the three codes, the checklist labels it sends the operator to (verbatim from `ITEM_LABELS`), the commands it names, and no credential shape. Carrier-specific facts come from `.planning/research/PITFALLS.md` §4.3–4.5 and `STACK.md`; this research did not re-verify them `[ASSUMED]`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GSM-7 segment counting | `body.length / 160` | `countSeptets`, `segmentCount`, `normalizeForGsm7` (`src/core/drafting/gsm7.ts`) | Extension characters cost two septets; one curly quote flips the message to UCS-2 |
| Mobile normalisation | A new regex | `normalizeAuMobile` (`src/core/cadence/primary-contact.ts:129-141`), `classifyCaller` (`src/core/telephony/caller.ts:109-128`) | One normaliser; suppression matches by exact spelling |
| At-most-once send | A "sent" flag checked in code | `ledger.insertClaim` on `send_ledger_cadence_touch_uniq` | The index is the claim |
| STOP handling | Anything in the text-back path | `handleInboundSms` → `suppressFromInbound` (unchanged) | The lead cadence carries `contact_mobile`, so the existing path stops it |
| Delivery status | Polling in the text-back path | DLR route + daily reconcile keyed on `custom_string = ledger id` | Unchanged |
| Pause on a customer contact | A new pause reason | `pauseForReply` | The matrix already upgrades weaker pauses |
| Arm / disarm with history | A boolean column on a new table | `armChannel` / `disarmChannel` + `messaging_config_audit` | One transaction, one audit row per effective flip |
| Operator email | A new Resend call | `sendClosedVocabularyEmail` shape in `src/core/alerts/stalled-drafts.ts` | Counts-only, never throws |
| Deadline around DB work in a webhook | Ad-hoc `Promise.race` | `withinDeadline` (`src/core/telephony/missed-call.ts:96-117`) | Returns a result, never rejects |
| Template versioning | Mutable rows | `insertVersion` with in-statement `MAX(version)+1` and write-once approval (`for-tenant.ts:2401-2444`) | Concurrent saves lose on the unique index |

**Key insight:** every guarantee D-04 wants (receipts, reconcile, suppression, pause-on-reply) is already keyed on `cadences` / `send_ledger`. The only new machinery this phase truly needs is the gate, the missed-call claim, and the sweep.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `missed_calls` rows (Phase 11 test calls, at least five direct dials plus one reconcile recovery per `11-08-SUMMARY.md`); existing `cadences` / `send_ledger` / `escalations` rows (all quote-shaped, all satisfy the new CHECKs by construction); the test tenant's `divert_verification_call` proof of 2 Oct (pre-WR-02) | Data statement F stamps existing missed calls `skipped / not_armed`. Pre-flight the three IN-04 CHECKs with a read-only count. The tightened `divertVerified` item makes the old proof read unmet — intended |
| Live service config | The Twilio number `PN0000…` already has `statusCallback` pointing at `voice-status` (set at purchase, `provision.ts:463`) — no Twilio change. pg_cron: four jobs, unchanged; `tests/cron-schedules.test.ts` pins that. ClickSend: shared number, DLR and inbound rules unchanged | None. Do not re-run `cron:apply` |
| OS-registered state | None — verified: the project has no launchd/pm2/systemd registration; all scheduling is pg_cron in the hosted database | None |
| Secrets / env vars | No new key. The balance probe uses the existing optional `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` (`src/core/shared/env.ts:144-145`); absent creds = probe skipped and counted | None; `docs/env-vars.md` unchanged |
| Build artifacts | `src/db/migrations/meta/0039_snapshot.json` and `_journal.json` idx 39 are generated; the snapshot will again not know the hand-written indexes | Inspect generated SQL for drift before applying |

## Common Pitfalls

### Pitfall 1: `cadences_replay_key_present` rejects every lead cadence
**What goes wrong:** the first real missed call throws 23514 inside the transaction; the row stays pending; the sweep retries and throws every minute for ten minutes, then marks it stale. No text is ever sent and nothing is red in the pure suites.
**How to avoid:** widen the CHECK in 0039 (section C). **Warning sign:** `tests/text-back.test.ts` (DB) cannot create a lead cadence.

### Pitfall 2: a lead touch reaches `dispatchOne`
**What goes wrong:** `mirror_missing`, irreversible, and an alarming `console.error` about "a bug in our own sync".
**How to avoid:** Pattern 5's four predicates and its one test.

### Pitfall 3: stub sender writes a believable ledger row
**What goes wrong:** `outcome = 'stub_sent'`, `missed_calls.text_back_status = 'sent'`, no SMS.
**How to avoid:** gate step 9; and map a `provider === 'stub'` outcome to `failed`, never `sent`, in `sendTextBack`'s outcome write as a second belt.

### Pitfall 4: texting hours later
**What goes wrong:** the nightly reconcile inserts a call the webhook missed; the sweep texts at 03:31.
**How to avoid:** `TEXT_BACK_MAX_AGE_MINUTES` in both the sweep query and gate step 8; `markStaleTextBacks`.

### Pitfall 5: the migration is pushed before the code, and old code meets new columns
**What goes wrong:** the push protocol applies 0039 while the deployed code is Phase 11. New columns are nullable or defaulted, so Phase 11 inserts still work — **provided no new NOT NULL column without a default is added to an existing table.** `cadences.kind` has a default; `messaging_config_audit.actor` has a default.
**How to avoid:** keep every added column on an existing table nullable or defaulted; widening-only CHECK changes (the 0018 ordering principle quoted in `0022`'s header).

### Pitfall 6: `tests/sync-upsert.test.ts` pins `for-all-tenants.ts`
**What goes wrong:** adding `forAllTenants_pendingTextBacks` trips the export tripwire and the table-set pin.
**How to avoid:** put the sweep reads in `src/db/repository/missed-calls.ts` (one table, no join — that family's own rule). The barrel pin in `tests/lint-ban.test.ts:88` still needs the new export names added, by design.

### Pitfall 7: the route's uniform-response and no-insert pins
**What goes wrong:** `tests/twilio-voice-status-route.test.ts:582` asserts the route file "contains no insert call of any kind"; `:561` that only the result kind is interpolated into logs; `:385` byte-identical bodies.
**How to avoid:** the route calls `sendTextBack` (a core function) and contains no repository call itself; the header comment's "decides nothing itself" stays true.

### Pitfall 8: pool exhaustion in the callback
**What goes wrong:** the pool is `max: 5`; parallel pre-reads plus a transaction plus `resolveSmsFrom` inside the sender can hold several connections at once under a burst of calls.
**How to avoid:** pre-reads sequential or at most three in parallel; everything gate-related on the transaction handle; the sender's own `resolveSmsFrom` read happens after the commit.

### Pitfall 9: cross-tenant reply ambiguity grows
**What goes wrong:** a caller with a live quote cadence at client A who misses a call to client B now has two live cadences on one mobile across tenants; their reply is `reply_ambiguous` and nothing pauses (`inbound.ts:417-445`). Existing behaviour, now more likely.
**How to avoid:** nothing in this phase (the single-tenant tie-break is Phase 13); state it in the plan's known limitations. Within one tenant, D-08 prevents the quote + lead pair at creation.

### Pitfall 10: an open lead blocks every later text until Phase 13
**What goes wrong:** lead cadences are inert and excluded from expiry, so a lead opened today is still `open` in three weeks; a repeat caller is skipped `lead_open`, not texted.
**How to avoid:** accept and document (it is the conservative direction), or see Open Question 3.

## Code Examples

### The guarded claim (the `claimForDrafting` shape, `for-tenant.ts:3081-3117`)

```typescript
// forTenant(tenantId).missedCalls.claimForTextBack — builders, never a Date in a sql`` template
claimForTextBack: (id: string, at: Date) =>
  db
    .update(missedCalls)
    .set({ textBackStatus: 'claimed', textBackDecidedAt: at, updatedAt: at })
    .where(
      and(
        eq(missedCalls.tenantId, tenantId),
        eq(missedCalls.id, id),
        isNull(missedCalls.textBackStatus), // THE ARBITER
      ),
    )
    .returning({ id: missedCalls.id }),
```

### The lead cadence insert (targeted, partial)

```typescript
// Source: drizzle-orm 0.45.2 insert.d.ts:138-141 — { target, where } is typed.
// First use of a partial-index target in this repo: prove it in a DB-backed test.
createLead: (values: LeadCadenceCreate) =>
  db
    .insert(cadences)
    .values({ ...values, tenantId, kind: 'lead', quoteId: null, sm8JobUuid: null })
    .onConflictDoNothing({
      target: cadences.leadId,
      where: sql`lead_id IS NOT NULL AND status IN ('active', 'paused')`,
    })
    .returning(),
```

### The send, outside the transaction (copy of `performSends`, `dispatch.ts:558-608`)

```typescript
let outcome: SendOutcome | null = null;
try {
  outcome = await sender.send(request);
} catch {
  console.error(`[text-back] sender threw for ledger ${ledgerId}; outcome left NULL.`);
}
if (outcome) {
  const recorded = outcome.kind === 'sent' && outcome.provider !== 'stub' ? 'sent' : 'failed';
  try {
    await repo.ledger.setOutcome(ledgerId, recorded,
      outcome.kind === 'sent' ? outcome.providerMessageId : null);
    await repo.missedCalls.setTextBackOutcome(id, recorded,
      outcome.kind === 'failed' ? codeOf(outcome.reason) : null);
  } catch {
    console.error(`[text-back] could not record the outcome for ledger ${ledgerId}.`);
  }
}
```

## State of the Art

| Old Approach (milestone note, 27 Sep) | Current Approach (code at `d8acd35`) | Impact |
|---|---|---|
| `missed_calls.text_back_status` exists with a 12-value vocabulary | No text-back column exists; Phase 11 shipped capture only | 0039 adds them; vocabulary is this document's |
| `normalized_from`, `forwarded_from` | `caller_e164`, `caller_kind`, `caller_withheld`, `forwarded_from_raw` | Use the shipped names |
| Arming on `tenant_divert_numbers.enabled` | That column does not exist; D-09 locks `messaging_config` channel `text_back` | Follow D-09 |
| Text-back for a customer with an open quote coexists with a lead (ARCH §4) | D-08: no lead, attach to the quote cadence | Follow D-08; the single-tenant tie-break is Phase 13 |
| Lead template set = `kind` on `message_templates`, 3 touches | Touch 1 is three attested variants in their own table; touches 2–3 wording is Phase 13 | Do not touch `message_templates` |
| Status callbacks retried "a few times" | Twilio does not retry a timeout or 5xx; one retry on connect failure only (`11-RESEARCH.md:132`) | The sweep is the only guarantee |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vercel keeps a Node function running after Twilio disconnects at 15 s | Pattern 3 | A slow ClickSend call would be cut off mid-send, leaving `claimed` rows; the alert pass still surfaces them, the customer may or may not have been texted |
| A2 | ClickSend's send call typically answers in well under a few seconds | Pattern 3 | D-01 holds either way (the caller is not waiting); S4 measures it |
| A3 | Twilio fires the status callback for the terminal status with default events | Pattern 1 | If a carrier path produces no callback, the sweep sends ~1 minute later instead of seconds |
| A4 | The skip-reason spellings and the four added reasons (`stale`, `sms_not_armed`, `no_template`, `lead_open`) | Migration B | Naming only; must be byte-identical in TS const, CHECK and gate |
| A5 | 45 s grace and 10-minute maximum age | Pattern 2 | Too short a ceiling drops a legitimate late text; too long texts a cold call |
| A6 | "Daily cap" and "24 h" are both rolling 24-hour windows | Gate | A calendar-day reading would need tenant-zone maths |
| A7 | The after-hours clause and the about-quote wording | Templates | Founder wording decision |
| A8 | Carrier divert facts for the runbook (codes, iPhone caveat, charges) come from the milestone research unverified this session | Runbook | A wrong code in a client-facing runbook; the verification call catches it per client |
| A9 | `quote_contacts.mobile` is not consulted for D-08; only the cadence's snapshot mobile | Pattern 4 | A caller who is a secondary contact on the quote gets a lead instead of the quote path |

## Open Questions (RESOLVED)

All eleven are settled (marked 6 Oct 2026 at plan revision). Eight are locked founder decisions in 12-CONTEXT.md (D-15..D-22); three are planner decisions recorded as flagged assumptions in the plans, which the founder may overrule at UAT.

1. **Does text-back require SMS to be armed for the client?** — **RESOLVED: D-15** (`smsArmed` is a `text_back` gate item; `sms_not_armed` refuses before any ledger claim).
   - Known: the existing sender refuses with `sms_not_configured` when `resolveSmsFrom` is null; the test tenant has an explicit SMS-off row.
   - Unclear: D-09's gate list does not name `smsArmed`.
   - Recommendation: yes — add `smsArmed` to `ARMING_GATES.text_back` and gate step 9. One sending identity, one meaning of "SMS off for this client".

2. **Who is "the operator" in D-08's escalation?** — **RESOLVED: D-16** (the tradie's escalation phone, existing sender and cooldown, `escalations.missed_call_id`).
   - Known: the existing escalation path texts the tradie's `escalation_phone` (`escalate-hot-leads.ts:215-225`); PITFALLS §5.4 words it "your quote customer Sue just rang".
   - Recommendation: the tradie's escalation phone through a new `escalateQuoteCalls` pass with the existing cooldown; the Backdesk operator sees it on the quote page via `listEscalationsForQuote`. Confirm with the founder.

3. **What closes a lead in Phase 12?** — **RESOLVED: D-22** (nothing closes a lead in this phase; a repeat caller with an open lead is skipped `lead_open`).
   - Known: nothing; Phase 13 adds per-kind expiry. Until then a repeat caller with an open lead is skipped `lead_open`.
   - Recommendation: accept for this phase and record it as a known limitation. Do not invent a lead expiry here; it is Phase 13's policy constant.

4. **Should the about-quote text (touch 0) count toward recovered-revenue attribution?** — **RESOLVED: D-17** (no; `qualifyingTouches` excludes touch 0, pinned by a test).
   - Known: `qualifyingTouches` would count it.
   - Recommendation: exclude touch 0 (one line where the consumer filters ledger rows, plus a pure test). The customer phoned on their own; claiming the win on our auto-reply alone is the overreach the attribution rules exist to prevent.

5. **Match open quotes on the cadence's snapshot mobile only, or on every `quote_contacts.mobile` for the job?** — **RESOLVED (planner: snapshot mobile only; flagged assumption in 12-05; founder may overrule at UAT).**
   - Recommendation: snapshot only. It is normalised, indexed by tenant and status, and is who the cadence is talking to.

6. **A hot reply on a lead cadence before Phase 13.** — **RESOLVED: D-18** (classified by today's classifier; a hot one escalates now through the existing path, null-safe).
   - Known: replies thread to the lead cadence and pause it today's code path; classification runs with the quote vocabulary; `forAllTenants_hotUnescalated` would pick up a hot one and `claimEscalation` needs `quote_id` nullable.
   - Recommendation: make the column nullable (D-05) and let the existing pass escalate with a null-safe snippet ("missed call"). A hot reply reaching nobody is the worse failure, and the change is the nullable type plus one fallback string. If the founder prefers strict scope, add `kind = 'quote'` to that read instead; either way nothing may throw.

7. **Grace and maximum age values** (45 s, 10 min). — **RESOLVED: D-20** (45 seconds to 10 minutes; older unsent calls are marked `stale`). Recommendation: adopt, name them in `src/core/leads/constants.ts`, revisit on S4 numbers.

8. **Holiday pause.** — **RESOLVED: D-22** (holiday pause = disarm text-back with a reason). Recommendation: the runbook's holiday state is "disarm text-back with the reason 'holiday until <date>'"; the greeting keeps answering and calls keep being logged. Text-back does not read the cadence client pause.

9. **Retention sentence for callers.** — **RESOLVED: D-22** (the callers section describes today's behaviour; the 90-day promise waits for Phase 15). Recommendation: the paragraph proposed above (kept for the term of the client's agreement, deletable on request). Phase 15 replaces it with the 90-day statement when COMP-02 ships.

10. **Arming gate membership of `contactHours` and `escalationPhone`.** — **RESOLVED (planner: reuse `BOTH_CHANNELS` whole; flagged assumption in 12-08; founder may overrule at UAT).** D-09 says "onboarding complete + `sm8Connected`"; `BOTH_CHANNELS` also carries those two. Recommendation: reuse `BOTH_CHANNELS` whole — after-hours depends on contact hours and D-08 depends on the escalation phone.

11. **IN-02 (reconcile truncation signal).** — **RESOLVED (planner: leave IN-02 untouched, no plan edits `reconcile.ts`; flagged assumption in 12-08; founder may overrule at UAT).** Not required by any Phase 12 path. Recommendation: leave it; fix only if a plan edits `src/core/telephony/reconcile.ts` for another reason.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | ✓ | v22.20.0 | — |
| Docker / local Supabase stack | DB-backed suites | ✗ on the dev machine | — | CI (`.github/workflows/ci.yml` starts the stack); never `test:remote` |
| `psql` | optional read-only pre-flight | ✓ | /opt/homebrew/bin/psql | a `scripts/*.mjs` read-only count |
| Hosted Supabase (production) | migration push, S4 | ✓ | — | — |
| ClickSend account with credit | S4, live proof | ✓ (balance to be read with `npm run clicksend:balance` before S4) | — | — |
| Twilio number on the test tenant | S4 | ✓ (`PN0000…`, bought 2 Oct) | — | — |
| Founder's handset | S4, diverted verification call | human | — | none — these are human-action steps |

**Missing dependencies with no fallback:** none for code. S4, the re-recorded verification proof and the `text_back_proof` need the founder.

**Missing dependencies with fallback:** local database — every DB-backed suite is proven in CI.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.11 |
| Config file | `vitest.config.ts` (`fileParallelism: false`, 30 s timeouts, `globalSetup`) |
| Quick run command | `npx vitest run tests/<file>.test.ts` (pure suites run bare; a DB suite refuses a remote target without `ALLOW_REMOTE_TESTS`, `tests/helpers/env.ts:171`) |
| Full suite command | CI: `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx next build`, migrate, `vitest run` against the local stack |
| Local gate | `npx tsc --noEmit && npx eslint . --max-warnings=0` plus the named pure suites |

### Pure vs CI, per piece

| Piece | Pure (local, seconds) | DB-backed (CI only) |
|---|---|---|
| Gate `decideTextBack` | `tests/text-back-gate.test.ts`: every reason, the D-06 order (a fact set that trips two rules returns the earlier), absent fact = refusal | — |
| Template validator | `tests/text-back-template.test.ts`: D-03 default passes at 2 segments for a 120-char name; missing STOP / missing pointer / second link / curly quote / 3 segments each refuse | — |
| Constants | `tests/audit-aggregate.test.ts` pin moved to twelve | — |
| `sendTextBack` | structural: no LLM import under `src/core/leads/` (the `classification-privilege` shape); no `waitUntil` | `tests/text-back.test.ts`: ledger row is touch 1 of a `kind='lead'` cadence; second call for the same row is `claim_lost`; sender throw leaves outcome NULL and status `claimed`; stub provider never yields `sent`; skip reasons written; touch 1 `sent`, touches 2–3 `scheduled` |
| D-08 branch | builder test for the escalation SMS (two segments) | `tests/text-back-quote.test.ts`: no lead row; touch 0 on the quote cadence; cadence `paused / customer_reply`; escalation row keyed on `missed_call_id`; a second call sends nothing |
| Inertness | — | `tests/lead-cadence-inert.test.ts` (Pattern 5) |
| Sweep + alerts | — | `tests/text-back-sweep.test.ts`: 46 s-old pending is sent, 30 s-old is left, 11-minute-old is `stale`; failed row is alerted once |
| Route | `tests/twilio-voice-status-route.test.ts` extended with an injected `sendTextBack`: called once on `completed`, not on `unmatched`/`unparseable`/signature failure; byte-identical 200 preserved; a throwing `sendTextBack` still answers 200 | — |
| Arming | `tests/go-live-checklist.test.ts` / `arming-actions.test.ts`: `firstUnmetGate('text_back', …)` order; refusal sentences exist | `tests/messaging-config-arming.test.ts`: global `text_back` row refused by code and by CHECK; system disarm writes `actor='system'`; `tests/rls-coverage.test.ts` |
| Balance | parse of the account response; floors; Perth-day key | `operator_alert_log` claim is once per day; auto-disarm writes one audit row per armed client |
| Privacy | `tests/privacy-page.test.ts` (eight headings, callers section names Twilio and ClickSend and "not recorded"); `tests/marketing-copy.test.ts` unchanged and green | — |
| Runbook | `tests/client-divert-runbook.test.ts` (new, contract shape) | — |
| Timing script | `tests/ops-scripts.test.ts`: read-only, prints no number | — |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TXT-01 | Template ≤ 2 segments, identity, STOP, pointer, no link, no LLM | unit | `npx vitest run tests/text-back-template.test.ts` | ❌ Wave 0 |
| TXT-02 | Ledger claim → sent → outcome; sweep recovers | integration (CI) | `npx vitest run tests/text-back.test.ts tests/text-back-sweep.test.ts` | ❌ Wave 0 |
| TXT-03 | Gate order, skip reason, 24 h, cap | unit + integration | `npx vitest run tests/text-back-gate.test.ts` | ❌ Wave 0 |
| TXT-04 | Open-quote branch | integration (CI) | `npx vitest run tests/text-back-quote.test.ts` | ❌ Wave 0 |
| TXT-05 | Gate, checklist, disarm immediate, audit | unit + integration | `npx vitest run tests/go-live-checklist.test.ts tests/arming-actions.test.ts` | ✅ extend |
| TXT-06 | Balance floors, de-dup, auto-disarm, failed surfaced | unit + integration | `npx vitest run tests/text-back-balance.test.ts` | ❌ Wave 0 |
| COMP-03 | Runbook contract | unit | `npx vitest run tests/client-divert-runbook.test.ts` | ❌ Wave 0 |
| COMP-01 (callers) | Section present and truthful | unit | `npx vitest run tests/privacy-page.test.ts tests/marketing-copy.test.ts` | ✅ extend |
| D-14 / S4 | arrival → delivered median and worst | manual + script | `npm run text-back:timing` (new) | ❌ Wave 0 |

### S4 timing evidence

A read-only script (`scripts/text-back-timing.mjs`, the `missed-calls-recent.mjs` shell) joins `missed_calls` to `send_ledger` on `text_back_ledger_id` for one tenant and prints, per call and with no number: `started_at`, `ended_at`, `claimed_at` (ledger), `delivered_at` and `delivery_updated_at` (DLR), `completed_via`, and three deltas — `ended − started` (greeting), `claimed − ended` (handler), `delivered − started` (the promise). It then prints the median and the worst of `delivered − started` over the last N rows. `delivered_at` is the carrier's clock and `claimed_at` is ours (`send-ledger.ts:185-201`), so the evidence file must say which clock each figure rests on; the founder's stopwatch reading of handset arrival is recorded beside it. Minimum five calls; the D-01 test is "does the worst case contradict sending from the completed callback".

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` + the task's named pure suite
- **Per wave merge:** push to a branch and let CI run the DB-backed suites
- **Phase gate:** CI green on the final SHA, then the human steps (migration push, S4, verification proof, live proof)

### Wave 0 Gaps
- [ ] `tests/text-back-gate.test.ts`, `tests/text-back-template.test.ts` — pure, written first (TXT-01, TXT-03)
- [ ] `tests/text-back.test.ts`, `tests/text-back-quote.test.ts`, `tests/text-back-sweep.test.ts`, `tests/lead-cadence-inert.test.ts`, `tests/text-back-balance.test.ts` — DB-backed
- [ ] `tests/client-divert-runbook.test.ts`
- [ ] `tests/helpers/seed.ts` — a lead-cadence seed helper and a missed-call seed helper (the file has ten quote-shaped references today)

### Tests that break by design

| Test | Pin | Why it moves |
|---|---|---|
| `tests/rls-coverage.test.ts:540-575` | exact set of unique indexes on `cadences` | add `cadences_one_live_per_lead`; write the decision in the comment |
| `tests/rls-coverage.test.ts:116-135` and `:1022-1088` | table lists for grants and existence | four new tables |
| `tests/rls-coverage.test.ts:627-661` | cadence CHECK names (additive) | add `cadences_kind_known`, `cadences_kind_identity` |
| `tests/rls-coverage.test.ts:801-861` | `messaging_config` global-row rules | add the `text_back` never-global assertion |
| `tests/go-live-checklist.test.ts:131-162`, `:613-616` | "thirteen keys", `toHaveLength(13)`; a proof seeded with an artefact id only | seventeen keys; `divertVerified` now needs `caller_present` and the active number in the proof detail |
| `tests/onboarding-checklist-gate.test.ts:621-651` | "THIRTEEN items", `toHaveLength(13)` | seventeen |
| `tests/runbook-contract.test.ts:39` | the checklist labels the go-live runbook names | re-check after `ITEM_LABELS` grows |
| `tests/audit-aggregate.test.ts:67` | "exactly the nine named constants" | twelve |
| `tests/cadence-tick-route.test.ts:338` | exact response key set | new text-back and balance counts |
| `tests/lint-ban.test.ts:88-…` | exhaustive repository barrel export list | new exports |
| `tests/privacy-page.test.ts:46-56` | seven headings in order | eight |
| `tests/tenant-proofs.test.ts`, `tests/proof-actions.test.ts` | proof kind vocabulary and verification arms | `text_back_proof` |
| `tests/messaging-config-arming.test.ts`, `tests/arming-actions.test.ts` | channel vocabulary, audit row shape (`operatorUserId` non-null) | `text_back`; system actor |
| `tests/missed-calls.test.ts` | `completeMissedCall` returns `{ completed }`; vocabulary refusals | return shape; new CHECKs |
| `tests/twilio-voice-status-route.test.ts:479-510`, `:582` | `applyVoiceStatus` result shape; "no insert call" | result gains ids; route still contains no repository call |
| `tests/escalation.test.ts` | `EscalationClaim.quoteId` required; `inbound_message_id` NOT NULL | nullable; `missed_call_id` |
| `tests/cadence-repository.test.ts` | cadence shapes with `quoteId` non-null (26 references) | types widen; quote behaviour unchanged |
| `tests/inbound-threading.test.ts`, `tests/inbound-stop.test.ts` | `CadenceByContactMobile.quoteId: string` | nullable, plus `kind` / `leadId` |
| `tests/ops-scripts.test.ts` | list of read-only scripts | add the timing script |
| `tests/sync-upsert.test.ts:560-930` | `forAllTenants_*` export tripwire and table set | **should not move** if the sweep reads live in `missed-calls.ts`; if a plan adds a `forAllTenants_` accessor it moves by design and needs its containment paragraph |
| `tests/cron-schedules.test.ts` | four jobs | **must not move** — a red here means a plan added a cron job |
| `tests/report-metrics.test.ts` | twin parity | **must not move** — neither twin is edited |

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Supabase Auth + operator allowlist; Twilio token + signature on the door |
| V3 Session Management | no (unchanged) | — |
| V4 Access Control | yes | Every new server action: `requireOperatorId()` then `authorize(tenantId)` before reading `formData` (`actions.ts:649-662`); `forTenant()` closure scoping; no authenticated write grant on any new table; RLS policies written anyway |
| V5 Input Validation | yes | zod on template, never-text and arm forms; `classifyCaller` for numbers; template validator forbids links; ClickSend balance response zod-parsed |
| V6 Cryptography | no | nothing new; constant-time token compare already in the door |
| V7 Logging | yes | fixed strings and closed-union kinds only; caught values discarded; no number, body or token in any log |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged status callback triggers a text to an arbitrary number | Spoofing / Tampering | The callback only completes an existing row by CallSid; `sendTextBack` takes the row id and reads the caller from the row the signed arrival door wrote; no caller data is taken from callback params |
| Fabricated `missed_calls` row from a browser session | Tampering | No INSERT/UPDATE grant to `authenticated` (0038 lines 173-189); unchanged |
| Call flood drains the shared ClickSend balance (SMS pumping) | Denial of service | Per-caller 24 h rule, `TEXT_BACK_DAILY_CAP`, balance alert, auto-disarm, greeting unchanged |
| Spoofed CLI makes Backdesk text a stranger | Spoofing | Residual, accepted: one benign factual text, STOP honoured for every tenant via the bare-mobile fan-out (`inbound.ts:380-411`); never-text list; no link in the text |
| Template used to send a link or promotion | Tampering | Validator rule 6 at save and at send; attestation by a named operator, write-once |
| Operator arms a client they are not a member of | Elevation of privilege | `authorize(tenantId)` through the operator's own JWT, then the server-side gate |
| System disarm forged as an operator action, or an arm written with no hand on it | Repudiation | `actor` CHECKs: system rows can only be disarms; operator rows must carry a user id |
| Caller numbers leak into logs, alerts, proofs or the timing script | Information disclosure | Counts-only alert bodies; proof `artefact_detail` ids/statuses/timestamps only (T-10-20 rule); script select list has no number column |
| Double text from the callback and the sweep racing | Tampering (integrity) | Guarded claim + ledger unique index; nothing is ever retried after a claim |
| Cross-tenant write through a mis-scoped query | Elevation of privilege | All text-back writes on `forTenant(tenantId)` with the tenant in every predicate; `tests/leak.test.ts` family |

## Sources

### Primary (HIGH confidence) — files opened this session at `d8acd35`
- `src/core/cadence/dispatch.ts` (150-663), `run-tick.ts` (525-739, 940-1145), `controls.ts` (780-906), `sender.ts`, `transitions.ts` (events and matrix entry points)
- `src/core/messaging/routing-sender.ts` (whole), `clicksend-sender.ts` (60-144), `clicksend-client.ts` (51, 170-300), `inbound.ts` (200-487)
- `src/core/telephony/missed-call.ts` (whole), `caller.ts` (30-128); `src/app/api/webhooks/twilio/voice-status/route.ts` (whole)
- `src/core/onboarding/arming.ts` (whole), `checklist.ts` (100-702); `src/core/drafting/gsm7.ts` (whole), `onboarding-gate.ts` (150-200)
- `src/core/escalation/escalate-hot-leads.ts` (180-336); `src/core/attribution/qualify.ts` (40-110)
- `src/db/schema/cadences.ts` (200-418), `send-ledger.ts` (60-225), `missed-calls.ts` (60-236), plus `escalations`, `inbound-messages`, `cadence-touches`, `touch-drafts`, `message-templates`, `messaging-config`, `messaging-config-audit`, `tenant-proofs`, `tenant-attestations`, `quote-contacts`, `tenants`
- `src/db/repository/for-tenant.ts` (200-275, 436-456, 2324-2500, 2575-2620, 2660-3562), `messaging-config.ts` (whole), `missed-calls.ts` (whole), `escalations.ts` (40-125), `for-all-tenants.ts` (400-660, 1286-1330)
- `src/db/migrations/0023` (55-83), `0024` (45-59), `0022` (30-43), `0038` (whole), `meta/_journal.json` (tail), `README.md`
- `src/app/(console)/clients/[id]/actions.ts` (560-1397), `checklist-card.tsx` (59-75, 203-240); `src/app/(marketing)/copy.ts` (380-505)
- `tests/privacy-page.test.ts` (whole), `tests/marketing-copy.test.ts` (1-290), `tests/rls-coverage.test.ts` (116-140, 395-680), `tests/sync-upsert.test.ts` (560-930), test outlines for the route, tick-route and lint-ban suites
- `scripts/clicksend-balance.mjs` (whole), `scripts/apply-cron-schedules.mjs` (schedule lines), `vercel.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `package.json`
- `.planning/phases/12-instant-text-back-arming/12-CONTEXT.md`; `.planning/phases/11-telephony-capture/11-08-SUMMARY.md`, `11-REVIEW.md` (IN-02, IN-04, IN-07), `11-VERIFICATION.md`, `deferred-items.md`; `.planning/research/ARCHITECTURE.md`, `SUMMARY.md`, `PITFALLS.md` §5–7; `ROADMAP.md` Phase 12; `REQUIREMENTS.md`

### Secondary (MEDIUM confidence)
- Twilio webhook timeout and retry defaults — cited in `11-RESEARCH.md:132` from twilio.com/docs/usage/webhooks/webhooks-connection-overrides; not re-fetched this session
- ClickSend `/v3/account` field names — one real response recorded in the Phase 10 evidence

### Tertiary (LOW confidence)
- ClickSend send latency; Vercel behaviour on client disconnect; carrier divert facts for the runbook — see the Assumptions Log

**Research-plan seam:** not used. No question in this phase needed an external provider lookup; every finding is a codebase read. No digest was cached.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; versions read from `package.json`
- Architecture / code map: HIGH — every seam opened this session; the console pages' `quote_id` consumers are left to `tsc` rather than enumerated
- Migration change list: HIGH on what exists; MEDIUM on the IN-04 CHECKs holding against production data until the read-only pre-flight runs
- Design recommendations (touch 0, escalation key, system actor, literal template bytes): MEDIUM — consistent with the code, not locked by CONTEXT.md; see Open Questions
- Timing: LOW until S4

**Research date:** 2026-10-05
**Valid until:** 2026-11-04 for the code map (stable), or the next commit that touches `dispatch.ts`, `for-tenant.ts` cadence/touch methods, `messaging-config.ts` or `checklist.ts`
