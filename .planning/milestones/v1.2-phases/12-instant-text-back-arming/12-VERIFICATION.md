---
phase: 12-instant-text-back-arming
verified: 2026-10-07T11:20:00Z
status: passed
score: 5/5 must-haves verified (3 verified; 2 verified in code with their live clause carried by one founder override)
behavior_unverified: 0
uat: 12-UAT.md (founder, phone, 2026-10-07 — 3/3 pass; live clauses under founder override)
overrides_applied: 1
overrides:
  - must_have: "Live clauses of success criteria 1 and 4 — a caller receives the text 'within seconds' of a diverted call ending on production (S4 timing, D-14), a real client armed through the gate with a real text_back_proof recorded, and the fail-safe skips (recent_text, own_number, withheld) demonstrated on a handset (plan 12-09)"
    reason: "Founder skipped plan 12-09 on 2026-10-07 ('i don't have a second number, skip this test for now just like the spike'). No text-back has ever been sent on production, S4 timing has no sample, nothing is armed. The proof is relocated to the first founding client's onboarding per docs/client-divert-onboarding-runbook.md (sections 6–8): diverted verification call from a second phone → arm → first live text with a stopwatch → npm run text-back:timing → text_back_proof. Every clause is proven in code, in the pure suites and in CI on a fresh database; nothing in these clauses was proven live."
    accepted_by: "founder (Hesam Abbaszadi)"
    accepted_at: "2026-10-07T18:12:00+08:00"
human_verification:
  - test: "First founding client: run docs/client-divert-onboarding-runbook.md top to bottom. Section 6: diverted verification call from a second phone; section 7: arm text-back; section 8: ring again, time the text on the handset, run `npm run text-back:timing -- --tenant <id> --limit 3`, record the text_back_proof from the console."
    expected: "The verification row reads call_status=completed, caller_present=true; the checklist's 'Verification call recorded' reads verified (strict rule); after the arm the live line reads 'Text-back: Armed, not yet proven'; the second call produces one SMS on the handset within seconds, the timing reader shows samples=1 with arrival_to_delivered_s filled, and after the proof the live line reads 'Text-back: Live'. Record carrier, forwarded_from_present, stopwatch seconds and arrival_to_delivered_s in the evidence file; Phase 15 reports the S4 figure."
    why_human: "This is where the skipped 12-09 session's proof now lives (override above). It needs a real handset on a real carrier and ClickSend delivering to a phone; code cannot measure handset arrival and no diverted call has been observed on any carrier (11-08 and 12-09 overrides together)."
  - test: "On a phone, open https://app.backdesk.com.au/clients/13e8f2aa-edee-4eb1-b699-09b650674f81. Do not tap 'Turn text-back on for this client'."
    expected: "The 'Ready to send?' card shows seventeen rows; the last four read 'Text-back templates attested', 'Own numbers on the never-text list', 'Text-back armed', 'Text-back proof recorded'; a third live line reads 'Text-back: Not armed'; 'Verification call recorded' shows the 2 Oct proof's id with the note that it needs a diverted call showing the caller on the active number; the unmet text-back rows link to the Text-back page."
    why_human: "Harvested from the 12-08 human-check block. Row order, the strict-proof wording and the layout at phone width are visual; tests/go-live-checklist.test.ts (CI) proves seventeen keys and the strict divertVerified rule, not what the operator reads."
  - test: "On a phone, open https://app.backdesk.com.au/clients/13e8f2aa-edee-4eb1-b699-09b650674f81/text-back. Do not save anything."
    expected: "Three template blocks pre-filled with wording naming the test tenant, each with a Save version button; a Never-text list section with Number, Kind and Label fields; one column, no sideways scroll; the client page carries the link 'Text-back templates and never-text list →'."
    why_human: "Harvested from the 12-06 human-check block. Layout, pre-fill and wording at phone width are visual; tests/text-back-actions.test.ts and tests/text-back-admin.test.ts prove the rules and guard order only."
  - test: "On production, open the inbox and the approval queue at https://app.backdesk.com.au."
    expected: "Both pages render as before; no row links to /quotes/null or /quotes/undefined."
    why_human: "Harvested from the 12-05 human-check block. The link-building for a lead-threaded message changed (quote_id NULL); no lead-threaded message exists on production yet, so this is a regression look until the first real lead reply arrives."
  - test: "After the first real text-back, watch the first reply to it on production: the inbox row, its classification, and (if hot) the escalation SMS on the tradie's phone."
    expected: "The reply threads to the lead cadence (lead_id set, quote_id NULL), is classified by today's classifier, nothing throws in inbound handling, and a hot reply reaches the escalation phone with the lead-reply snippet, not a quote description."
    why_human: "D-18 is proven by tests/lead-reply.test.ts (6 tests, CI) on a local stack only; the first lead reply on production is the first time inbound handling, classification and escalation run with a quote-less cadence against ClickSend and Resend."
  - test: "Check the operator inbox for the ClickSend balance alert. The balance read A$19.13 on 7 Oct (below the A$20 alert floor, above the A$5 disarm floor)."
    expected: "Exactly one 'ClickSend balance low' email per Perth day while the balance is under A$20, none once it is topped up above A$20, and no auto-disarm email (nothing is armed; the balance is above A$5). Top up to keep the alert from recurring."
    why_human: "The probe runs inside the production tick on a once-a-day claim (operator_alert_log). tests/text-back-balance.test.ts (78 tests) pins the decision and the claim; whether Resend delivered the email to the operator's inbox is observable only there."
---

# Phase 12: Instant Text-back & Arming Verification Report

**Phase Goal:** Within seconds of a missed call the right caller — and only the right caller — receives one pre-approved text from the client's identity through the existing SMS number and send ledger, and a client can be armed for it only through the go-live gate with a written runbook and a balance alarm behind it.
**Verified:** 2026-10-07T11:20:00Z (2026-10-07 19:20 AWST)
**Status:** human_needed
**Re-verification:** No — initial verification
**Commit verified:** `d386da0` (HEAD = origin/main). CI run 37610996574 on that SHA: `success` (typecheck, lint, `next build`, migrate a fresh local stack from the journal, full suite: 165 files, 5311 tests passed, 29 skipped, 257 s). Vercel Production deployment created 2026-10-07T10:59:05Z (the push time of `d386da0`), status Ready. Local on the same SHA: `npm run typecheck` exit 0, `npm run lint` exit 0, 17 pure suites / 1228 tests passed bare (`npx vitest run …`); the five DB-backed suites named below refused the local run by design ("Refusing to run integration tests against a non-local Supabase stack") and are cited from CI.

## Goal Achievement

The code half of the goal is achieved and checked against the source, the migration, the pure suites, CI on a fresh database and read-only production probes. The "within seconds" and "a client can be armed" clauses have never run live: the founder skipped plan 12-09 (no second mobile number). As with Phase 11's criterion 4, those live clauses are carried as one accepted override, not as a pass on evidence, and the proof is relocated to the first client's onboarding.

**Founder override declared up front:** plan 12-09 SKIPPED on 7 Oct 2026 (`12-09-SUMMARY.md`, status `skipped`; `.planning/STATE.md` line 517). Nothing was armed, no template attested, no SMS row enabled, no text sent. Read-only production probe by this verifier: `npm run text-back:timing -- --tenant 13e8f2aa-… --limit 1` ends `samples=0`, `text_back_armed=false`, `sms_enabled_for_tenant=false`; the one row shown is a 5 Oct call back-filled `skipped / not_armed` by migration 0039 line 189.

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Within seconds of a diverted call ending the caller receives one SMS from the client's identity via the shared number, built from the attested static template (business/after-hours), ≤ 2 GSM segments, with the identity line, STOP and the plain-text privacy pointer, no LLM; in `send_ledger` as touch 1 of a `kind='lead'` cadence so receipts, reconcile, STOP and metrics apply; the tick sends it when the synchronous send fails (TXT-01, TXT-02) | VERIFIED in code · live clause PASSED (override) | `src/app/api/webhooks/twilio/voice-status/route.ts` calls `sendTextBack(result.missedCallId, { getSender: buildRoutingSender })` only on `completed && callEnded`, passing the row id and nothing else (D-01). `src/core/leads/text-back.ts`: PRE reads bounded by `TEXT_BACK_PRE_CLAIM_DEADLINE_MS` → one transaction (`claimForTextBack` guarded on `text_back_status IS NULL`, gate, `leads.openOrCreate`, `cadences.createLead`, three touches, draft inserted `generated` then `drafts.approve`, `ledger.insertClaim` touch 1 `channel='sms'`) → send after commit via the same `TouchSender` the cadence uses → `ledger.setOutcome` + `missedCalls.setTextBackOutcome`. `model: 'template'` — no model call anywhere in `src/core/leads/` (grep). Variant by `row.afterHours`. `src/core/leads/template.ts` refuses `not_gsm7`, `too_many_segments` (>2 by the shared `segmentCount`), `missing_identity`, `missing_stop`, `missing_privacy_pointer` (`backdesk.com.au/privacy`), `extra_link`, `merge_token_left`; re-validated at send and the stored bytes must equal the normalised bytes. Guarantee: `runTextBackSweep` (`src/core/leads/sweep.ts`) wired in `run-tick.ts` line 1329 with the route's real sender (`cadence-tick/route.ts` line 174), window 45 s – 10 min (D-20), older rows marked `stale`. Migration 0039: `cadences.kind`, `cadences_kind_identity`, `send_ledger_one_owner`, `cadences_one_live_per_lead`, `leads_one_open_per_mobile`. Tests: `text-back-template` (pure, pass), `text-back-structure` (pure, pass), `text-back.test.ts` and `text-back-sweep.test.ts` (DB, CI green), `lead-cadence-inert.test.ts` (6 tests, CI — touches 2–3 inert through a full tick, D-19). Live: no text-back has ever been sent on production; "within seconds" has no sample (override). |
| 2 | Before any send a deterministic gate skips suppressed, withheld/anonymous, non-AU-mobile, the client's own numbers and the never-text list, recording the skip reason on the missed call; one text per caller per client per 24 h; per-client daily cap (default 30) (TXT-03) | VERIFIED | `src/core/leads/gate.ts` `decideTextBack`: pure, ordered, first refusal wins — `not_armed → own_number (null-guarded) → withheld → not_mobile → suppressed → recent_text → daily_cap → stale → sms_not_armed → no_template`. Own numbers assembled in `decideInTransaction` from the never-text list, escalation phone (both normalisations), divert number, SMS from-number; `forwarded_from` compared as evidence only. `TEXT_BACK_DAILY_CAP = 30` (`src/core/audit/constants.ts:226`, `docs/commercial-assumptions.md §8`); rolling 24 h window (`TEXT_BACK_RATE_WINDOW_HOURS`). Skip recorded by `missedCalls.setTextBackDecision({status:'skipped', skipReason})` inside the claim transaction; `missed_calls_skip_reason_iff_skipped` and `missed_calls_text_back_skip_reason_known` CHECKs in 0039 lines 214/217. Tests: `text-back-gate.test.ts` 45 tests pure, pass (every reason and the order); DB proof in `text-back.test.ts` (CI). Bookkeeping: `REQUIREMENTS.md` still shows TXT-03 `Pending` — see Anti-Patterns. |
| 3 | A caller with an open quote cadence at the same client gets no new lead: the call attaches to that cadence, the cadence pauses, the caller receives the "about your quote" template and the tradie is escalated (TXT-04; D-16 moved the escalation from the operator to the tradie's phone) | VERIFIED | `decideAboutQuote` in `text-back.ts`: `cadences.liveQuoteCadenceForMobile(caller)` → variant `about_quote` → ledger claim on `(quote cadence, touch 0)` first (never-twice; a second call records `skipped / quote_open` with route and cadence) → touch 0 written sent, draft approved, decision `claimed / route quote`, no lead row; pause after commit through the existing `pauseForReply` (seam `deps.pauseForReply`), a failed pause recorded `sent_pause_failed` with detail `pause_failed` and alerted (alert index 0039 line 200). Escalation: `src/core/escalation/quote-call.ts` `escalateQuoteCalls` via `listUnescalatedQuoteCalls` + `claimEscalationForMissedCall` (targeted on `escalations_missed_call_uniq`, `escalations_one_trigger` CHECK), cooldown-aware, wired in `run-tick.ts` line 1079 with the route's escalation sender; WR-05 bounds it to 24 h. Attribution: `src/core/attribution/qualify.ts` line 113 filters `ABOUT_QUOTE_TOUCH_NUMBER` (D-17). Tests: `attribution-qualify`, `escalation-message` pure pass; `text-back-quote.test.ts` (DB, CI), `lead-reply.test.ts` 6 tests (DB, CI, D-18 null-safety). |
| 4 | Text-back armed per client only through the existing gate, additionally requiring the verification call, an attested template set and the client's own numbers on the never-text list; the checklist shows the item; disarm stops text-backs immediately; every arm/disarm audited; balance below the alert floor alerts, below the disarm floor auto-disarms; failed text-backs surface within the tick (TXT-05, TXT-06) | VERIFIED in code · live clause PASSED (override) | `src/core/onboarding/arming.ts` `ARMING_GATES.text_back` = the five shared items + `smsArmed`, `divertNumber`, `divertVerified`, `textBackTemplates`, `neverTextOwnNumber`; `firstUnmetGate` treats an absent item as unmet. `src/app/(console)/clients/[id]/actions.ts` `armChannelAction`: `per_tenant_only` refusal, then `privacyCoversCallers(PRIVACY_COPY.sections)` (line 710), then the gate on a fresh checklist read (line 727). `checklist.ts`: seventeen keys (`CHECKLIST_ITEM_KEYS` line 155), strict `divertVerified` (`caller_present === true` on the active divert row, line 595), `textBackTemplates` re-validated against the current tenant name (WR-02), `live.textBack` derived from armed + proof; `checklist-card.tsx` labels and the `not_armed / armed / live` line. Disarm: `disarmChannelAction` is not gated (reason required only); `sendTextBack` reads `isTextBackArmed(tenantId)` per call before any claim, so a disarm takes effect on the next call. Audit: `armChannel` and `disarmChannel` write `messaging_config_audit` in the same transaction (`messaging-config.ts` lines 365–560), `disarmChannelBySystem` writes `actor='system'` with a reason (`messaging_config_audit_actor_known`, D-21). Balance: `src/core/leads/balance.ts` `decideBalanceActions` with `CLICKSEND_BALANCE_ALERT_FLOOR_CENTS = 2000` / `DISARM_FLOOR_CENTS = 500` (`audit/constants.ts` 241/259, `commercial-assumptions.md §9–10`), one email per Perth day via `claimOperatorAlert`, every armed client disarmed with `AUTO_DISARM_REASON`; CR-01 fix reads a negative balance as an overdraft (pinned `-2087` in `text-back-balance.test.ts`). Failures: `runTextBackAlertPass` claims `failed` / stuck `claimed` / `pause_failed` / WR-02 configuration skips and emails counts only; both passes wired in `run-tick.ts` lines 1344/1348 with `textBackOps` from the tick route (line 180). Tests: `text-back-arming-gate` 34, `arming-actions`, `proof-actions`, `text-back-balance` 78, `text-back-tick-passes`, `cadence-tick-route`, `cadence-tick-isolation` (WR-01 sweep clock) pure pass; `go-live-checklist` 37, `messaging-config-arming` 20, `onboarding-checklist-gate` 25, `text-back-repository` (DB, CI). Live: no client has been armed, no `text_back_proof` exists, the balance probe has alerted but never disarmed (override). |
| 5 | A per-client onboarding runbook in `docs/` covers the carrier divert codes (61, 62, 67; iPhone caveat), the verification call, the carrier-charge warning, a holiday pause state and offboarding (remove the divert before the number is retired) (COMP-03) | VERIFIED | `docs/client-divert-onboarding-runbook.md` (400 lines, 13 sections): §4.1 `**61*`, `**62*`, `**67*` with per-carrier no-answer delay (§4.2); §4.3 the iPhone Call Forwarding trap; §5 carrier charges (warned and recorded as agreed in §0.5); §6 the DIVERTED verification call with §6.4 "DO NOT ARM when the caller is missing"; §9 holiday pause (disarm with a reason, D-22); §10 offboarding in order — text-back off, remove all three diverts, confirm a test call rings out, keep the number ("Never release or retire a number while a handset may still divert to it", §12). Contract test `tests/client-divert-runbook.test.ts` (14 assertions, heading-anchored order) passes; it also cross-checks the console labels 12-08 shipped. |

**Score:** 5/5 truths (3 verified; 2 verified in code with their live clause carried by one override; 0 present-but-behaviour-unverified)

**COMP-01 (callers section only, D-11):** VERIFIED. `src/app/(marketing)/copy.ts` line 467 section `id: 'callers'`, "If you called a business that uses Backdesk", names Twilio and ClickSend as offshore processors and describes today's retention only (D-22). `src/core/onboarding/privacy-coverage.ts` is import-free; `tests/privacy-page.test.ts` line 147 pins `privacyCoversCallers(PRIVACY_COPY.sections) === true` for the shipped copy, and the arm action refuses without it. The first text carries the plain-text pointer by validator rule (`missing_privacy_pointer`); no other link survives (`extra_link`). The wording review, the retention statement and COMP-02 stay in Phase 15 as recorded.

### Override: the live clauses of criteria 1 and 4 (plan 12-09)

The founder decided on 2026-10-07: "i don't have a second number, skip this test for now just like the spike". Recorded in `12-09-SUMMARY.md` (status `skipped`), `.planning/STATE.md` line 517 and `REQUIREMENTS.md` line 93.

**What remains unproven**

- A text-back delivered to a caller on production, from a real diverted call, through ClickSend. The gate, the ledger send, the receipt and the `text_back_proof` are proven on a local stack and in pure suites only.
- S4 timing (D-14): call arrival → SMS delivered has no sample; D-01 stands on research, not measurement.
- The fail-safe skips (`recent_text`, `own_number`, `withheld`) on a handset.
- A real arm through the ten-item gate and a real `text_back_proof`; the auto-disarm on a live armed client.
- Together with the 11-08 override: no diverted call has been observed on any carrier.

**The relocation is real**

| Where | Confirmed |
|---|---|
| `src/core/onboarding/checklist.ts` lines 589–598, 713–721 | `divertVerified` is strict: the latest proof's `caller_present === true` on the active divert row, else "needs a diverted call showing the caller on the active number". The test tenant's 2 Oct direct-dial proof therefore reads unmet today. |
| `src/app/(console)/clients/[id]/actions.ts` lines 700–727 | The text-back arm refuses a global scope, refuses unless the deployed privacy copy covers callers, then runs the ten-item gate server-side. |
| `docs/client-divert-onboarding-runbook.md` §6–8 | Diverted verification call from a second phone, arm, first live text with a stopwatch, timing reader, proof. §6.4: do not arm when the caller is missing. |
| `scripts/text-back-timing.mjs` | Read-only S4 reader; prints no number; ends with the two arming read-back lines. Run by this verifier: `samples=0`, `text_back_armed=false`, `sms_enabled_for_tenant=false`. |

**Limits of the relocation**

- Code still cannot tell a direct dial from a divert when `ForwardedFrom` is absent (Phase 11 limit, unchanged); the diverted-call requirement is enforced by the runbook and the operator.
- The test tenant stays paused, SMS off, text-back off, three templates unset, escalation phone unchanged. It must not be armed on its 2 Oct proof (the strict rule now refuses it in code).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/db/migrations/0039_phase12_text_back.sql` | leads, text_back_templates, tenant_never_text_numbers, operator_alert_log; cadences/send_ledger/escalations/missed_calls/messaging_config widening; IN-04 CHECKs | VERIFIED | 301 lines; journal entry 39; applied to the hosted database 6 Oct under the push protocol (12-03, `docs/external-registrations.md`); CI migrates it from the journal on every push. |
| `src/core/leads/gate.ts` | Pure ordered gate | VERIFIED | 134 lines; imports only constants and types; 45 pure tests. |
| `src/core/leads/template.ts` | Validator + defaults | VERIFIED | D-03 wording verbatim; eight closed rules; shared GSM-7 counters. |
| `src/core/leads/text-back.ts` | The one send path | VERIFIED | 675 lines; called from the status door and the sweep; WR-04 throw on a zero-row lead claim (`text-back-lead-claim-fault.test.ts`). |
| `src/core/leads/sweep.ts`, `balance.ts`, `src/core/alerts/text-back-alerts.ts` | Guarantee, alarm, counts-only emails | VERIFIED | Wired through `run-tick.ts` seams; undefined-by-default so scripts/remote suites cannot claim. |
| `src/core/escalation/quote-call.ts` | Tradie escalation on a quote call | VERIFIED | Wired in the tick; 24 h bound (WR-05). |
| `src/core/onboarding/arming.ts`, `checklist.ts`, `privacy-coverage.ts` | Ten-item gate, seventeen-item checklist, deploy-time privacy predicate | VERIFIED | As above. |
| `src/app/(console)/clients/[id]/text-back/*` | Templates + attestation + never-text page | VERIFIED | Four-file console shape; 54 + 56 pure tests; IN-07 last-own-line guard. |
| `src/app/(console)/clients/[id]/actions.ts`, `checklist-card.tsx`, `page.tsx` | Arm/disarm controls, live line, `text_back_proof` arm | VERIFIED | `text_back_proof` requires status sent, route lead, ledger outcome sent with provider id, receipt delivered, start inside the 24 h window (lines 1151–1210). |
| `src/app/(marketing)/copy.ts` callers section | COMP-01 callers part | VERIFIED | Section id `callers`; Twilio and ClickSend named. |
| `docs/client-divert-onboarding-runbook.md` | COMP-03 | VERIFIED | Contract-tested. |
| `docs/commercial-assumptions.md` §8–10 | D-07 limits recorded | VERIFIED | 30 / 2000 / 500 beside the constants. |
| `scripts/text-back-timing.mjs`, `scripts/missed-calls-invariants.mjs`, `scripts/db-status.mjs` | Read-only evidence readers | VERIFIED | Timing reader run by this verifier; `ops-scripts.test.ts` pins the number-free output. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `voice-status/route.ts` | `sendTextBack` | row id only, after `applyVoiceStatus` returns `completed && callEnded` | WIRED | lines 186–197; a throw is caught, 200 still returned. |
| `sendTextBack` | `send_ledger` | `tx.ledger.insertClaim` touch 1 (lead) / touch 0 (quote), `repo.ledger.setOutcome` | WIRED | Same `TouchSender` (`buildRoutingSender`) as cadence touches, so receipts/reconcile/STOP/metrics apply; WR-03 keeps lead rows out of the quote report counts. |
| `sendTextBack` | `decideTextBack` | every fact read on `tx` inside the claim transaction | WIRED | A read failure rolls the claim back (`pre_claim_failed`). |
| `run-tick.ts` | `runTextBackSweep` / `runTextBackAlertPass` / `runBalanceProbe` / `escalateQuoteCalls` | seams `textBackSender`, `textBackOps`, `escalationSender` | WIRED | `cadence-tick/route.ts` lines 142–183 supply all three in production; twelve counts returned field by field. |
| `armChannelAction` | `privacyCoversCallers` → `firstUnmetGate('text_back')` → `armChannel` | server action | WIRED | lines 700–745. |
| `readGoLiveChecklist` | `text_back_templates`, `tenant_never_text_numbers`, `tenant_proofs`, `messaging_config` | repository reads | WIRED | `attestedSetStatus`, `latestAttested` re-validation, `countOwnLines`, strict divert proof. |
| `runBalanceProbe` | `disarmChannelBySystem` + `claimOperatorAlert` | per armed tenant from `listArmedTextBackTenantIds` | WIRED | `balance.ts` lines 172–237. |
| `qualify.ts` | `ABOUT_QUOTE_TOUCH_NUMBER` | filter | WIRED | line 113; `attribution-qualify.test.ts` passes. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `sendTextBack` | `row` (caller, kind, after_hours, forwarded_from) | `getMissedCallForTextBack` — the row the signed arrival door wrote | Yes | FLOWING |
| `sendTextBack` | `template.body` | `tx.textBackTemplates.latestAttested(variant)` | Yes (attested bytes) | FLOWING |
| checklist card | seventeen items, live line | `readGoLiveChecklist` repository reads | Yes | FLOWING |
| `text-back:timing` | timing columns | production `missed_calls` LEFT JOIN `send_ledger` | Yes (`samples=0` today — nothing sent) | FLOWING |
| balance probe | `balanceCents` | ClickSend `getAccountBalance` parsed to integer cents | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Types and lint on HEAD | `npm run typecheck`; `npm run lint` | both exit 0 | PASS |
| Pure Phase 12 suites | `npx vitest run` on 17 pure suites (gate, template, structure, balance, tick-passes, lead-claim-fault, admin, actions, arming-gate, client-divert-runbook, privacy-page, attribution-qualify, escalation-message, arming-actions, proof-actions, cadence-tick-isolation, cadence-tick-route) | 1228 tests passed | PASS |
| DB-backed suites on a fresh database | CI run 37610996574 on `d386da0` | `success`; 165 files, 5311 passed, 29 skipped; includes `text-back.test.ts`, `text-back-sweep.test.ts`, `text-back-quote.test.ts`, `lead-reply.test.ts` (6), `lead-cadence-inert.test.ts` (6), `text-back-repository.test.ts`, `go-live-checklist.test.ts` (37), `messaging-config-arming.test.ts` (20), `onboarding-checklist-gate.test.ts` (25), `report-metrics.test.ts` (17) | PASS |
| Production arming state (read-only) | `npm run text-back:timing -- --tenant 13e8f2aa-… --limit 1` | `samples=0`, `text_back_armed=false`, `sms_enabled_for_tenant=false` | PASS (nothing armed, as the override requires) |
| Production deployment | `vercel ls --prod`, `vercel inspect` | latest Production deployment Ready, created 2026-10-07T10:59:05Z = the `d386da0` push | PASS |
| Live text-back / S4 timing | — | not run (12-09 skipped) | SKIP → human (override) |

Behaviour-dependent truths (claim → send → outcome; pause-on-quote; auto-disarm; the sweep window) each have a passing behavioural test (`text-back.test.ts`, `text-back-quote.test.ts`, `text-back-balance.test.ts`, `text-back-sweep.test.ts`, `cadence-tick-isolation.test.ts`), so none is left PRESENT_BEHAVIOR_UNVERIFIED.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist in this repository; the phase declares none. The read-only `text-back:timing` reader above stands in as the production probe.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| TXT-01 | 01, 06, 09 | Instant text within seconds, attested template, ≤ 2 segments, identity + STOP, no LLM | SATISFIED in code; live clause by override | Truth 1. REQUIREMENTS.md marks it complete with the override recorded. |
| TXT-02 | 01, 02, 03, 04, 09 | Through the send ledger; tick as the guarantee | SATISFIED | Truth 1; sweep + alert pass wired. |
| TXT-03 | 01, 02 | Deterministic gate, skip reason recorded, 24 h rule, daily cap | SATISFIED in code — **unticked in REQUIREMENTS.md** | Truth 2. No plan ticked it (12-02 deferred to the arming plan; 12-08 did not pick it up). Bookkeeping gap only. |
| TXT-04 | 05 | Open-quote caller: attach, pause, about-quote text, tradie escalated (D-16) | SATISFIED | Truth 3. |
| TXT-05 | 06, 08, 09 | Armed through the gate with verification call, attested set, own numbers; checklist item; disarm immediate | SATISFIED in code; live arm by override | Truth 4. |
| TXT-06 | 04 | Balance alert and auto-disarm; failed text-back surfaced within the tick | SATISFIED | Truth 4; CR-01 overdraft fix pinned. |
| COMP-01 (callers section) | 07 | Privacy notice callers section; first text carries the pointer | SATISFIED (callers part) | Phase 15 keeps the wording review, retention statement and COMP-02. |
| COMP-03 | 07, 09 | Onboarding runbook | SATISFIED | Truth 5. |

No orphaned requirements: REQUIREMENTS.md maps exactly these eight to Phase 12 and every one appears in a plan's `requirements` field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `.planning/REQUIREMENTS.md` | 24, 95 | TXT-03 reads `[ ]` / `Pending` although the gate is built, tested and deployed | Warning | The tracker understates the phase; tick it with a pointer to `text-back-gate.test.ts` and `text-back.test.ts`. |
| `.planning/ROADMAP.md` | 129, 160, 237 | "8/9 plans executed", 12-09 unchecked, no note of the founder override; criterion 3 still says "the operator is escalated" where D-16 moved it to the tradie's phone (REQUIREMENTS.md was updated, the roadmap was not) | Warning | Same shape as Phase 11's roadmap warning; a reader of the roadmap sees an open live session and the pre-D-16 wording. |
| `12-REVIEW.md` IN-01..IN-09 | — | Open by design (unread `openQuoteCadence` fact, pre-claim arming read, non-locked daily cap, duplicate CHECK name across tables, template tenant FK, link regex, driver error in the timing script, second same-day auto-disarm not emailed, `pre_claim_failed` counted each tick) | Info | None blocks the goal; IN-03's non-locked cap can over-admit by a handful under a flood, bounded by the 25-per-tick sweep limit. |
| Phase 12 source files | — | No TODO / FIXME / TBD / XXX / HACK / placeholder markers; no empty handlers or static returns in the send path | Info | Clean. |

### Human Verification Required

Six items, listed in the frontmatter: the relocated live proof (first client onboarding: diverted verification call, arm, first live text with S4 timing, `text_back_proof`); the 12-08 checklist card on a phone; the 12-06 text-back page on a phone; the 12-05 inbox/queue regression look; the first real lead reply on production (D-18); and the ClickSend low-balance email arriving once per Perth day while the balance sits at A$19.13.

### Gaps Summary

No gaps. All five success criteria are verified against the code, the migration, the pure suites run bare on `d386da0`, CI on a fresh database on the same SHA, and read-only production probes. The live clauses of criteria 1 and 4 — a text delivered within seconds of a real diverted call, a real arm and proof, S4 timing — pass by founder override only: plan 12-09 was skipped for want of a second mobile number, and the proof has moved to the first client's onboarding, where the strict `divertVerified` rule, the privacy predicate and the runbook enforce the order. Two bookkeeping warnings (TXT-03 unticked; the roadmap's plan count, 12-09 checkbox and criterion-3 wording) should be tidied with the phase close. Status is `human_needed` because of the six items above.

---

_Verified: 2026-10-07T11:20:00Z_
_Verifier: Claude (gsd-verifier)_
