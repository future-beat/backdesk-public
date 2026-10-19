---
phase: 12
phase_name: Instant Text-back & Arming
milestone: v1.2
created: 2026-10-05
source: founder decisions 27 Sep + 5 Oct 2026; .planning/research/SUMMARY.md (S8–S16, R1–R7, D1, D6); ROADMAP.md Phase 12; Phase 11 outcomes (11-08-SUMMARY override, 11-REVIEW IN-04/IN-07, 11-VERIFICATION)
---

# Phase 12 Context — Instant Text-back & Arming

## Goal
Within seconds of a missed call the right caller — and only the right caller — receives one pre-approved text from the client's identity through the existing SMS number and send ledger, and a client can be armed for it only through the go-live gate with a written runbook and a balance alarm behind it.

## Decisions (locked)

<decisions>
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
- **D-15 SMS armed is a text-back gate item (founder 6 Oct 2026):** text-back sends through the same ClickSend number and identity resolution as quote touches, so `smsArmed` for the client is an explicit `text_back` arming gate item and the pre-send gate refuses (`sms_not_armed`) before any ledger claim when the provider would be the stub or the client's SMS identity does not resolve. A stub send is never recorded as a text-back.
- **D-16 The open-quote escalation goes to the tradie's escalation phone (founder 6 Oct 2026):** existing escalation sender and cooldown; `escalations` gains `missed_call_id` with an exactly-one CHECK against `inbound_message_id` and its own never-twice partial unique.
- **D-17 The "about your quote" text does not count for attribution (founder 6 Oct 2026):** it is sent as reserved touch number 0 on the quote cadence through the ledger; attribution's qualifying-touch rule excludes touch 0, pinned by a test; the quote cadence is paused with the existing reply-pause mechanism (no new pause reason).
- **D-18 Hot replies on a lead escalate now (founder 6 Oct 2026):** before Phase 13's lead vocabulary exists, a reply to a text-back is classified by today's classifier and a hot one escalates to the tradie through the existing path, made null-safe for a cadence with no quote; nothing in inbound handling, classification or escalation may throw on a lead cadence.
- **D-19 Lead touches 2–3 are structurally inert until Phase 13:** promotion, drafting, claiming, the progress pass and the 42-day expiry all carry a `kind = 'quote'` predicate, proven by a DB-backed test; the 0023 replay-key CHECK is widened for `kind = 'lead'`; lead cadences are created by a dedicated `createLead` (the quote path's `create` is untouched).
- **D-20 Sweep window and staleness:** the tick sweep sends text-backs whose synchronous send did not complete, for calls that ended between 45 seconds and 10 minutes ago; older unsent calls are marked `stale` and never texted (a call the nightly reconcile inserts hours late must not produce a text).
- **D-21 System disarm has an audited actor:** `messaging_config_audit` gains `actor` ('operator'|'system') with CHECKs so a system row can only be a disarm and carries a reason; the low-balance auto-disarm writes one per armed client.
- **D-22 Known limitation accepted for Phase 12:** nothing closes a lead yet; a repeat caller with an open lead is skipped with reason `lead_open` (Phase 13/14 add closing). The callers retention sentence in the privacy notice describes today's behaviour; the 90-day promise waits for Phase 15. Holiday pause = disarm text-back with a reason.
- **D-23 Default wordings beside D-03:** after-hours clause and the about-quote text follow the research proposals in 12-RESEARCH.md (Templates section); each client's set is attested before arming, so these are starting points, not sent unseen.
</decisions>

## Scope
- In: TXT-01..06, COMP-03, and the callers section of COMP-01 (D-11).
- Out: lead follow-up dispatch, LEAD_LABELS, escalation rules for leads (Phase 13); ServiceM8 job creation (14); lead queue, reporting, pseudonymisation (15). No voice, no recording.

## Constraints carried
- Hosted Supabase is production; migration push protocol before code push; never `test:remote`; `.env*` never named in commands; ClickSend is the only SMS provider (no SMS on Twilio).
- The test tenant `13e8f2aa` is paused (D-06 client pause since 13 Sep) and has an explicit SMS `enabled=false` row; its divert verification proof came from a direct dial and must be re-recorded from a diverted call before it is armed for text-back. No diverted call has been proven on any carrier (11-08 override).
- Phase 11 review items that bind here: IN-04 (consistency CHECKs), IN-07 (mark "caller is the client's own line"), IN-02 (reconcile truncation signal) if touched.

## Deferred ideas
- LLM-drafted first text; links in the first text; texting the tradie on every miss; a shared divert number; per-client dedicated SMS numbers.
