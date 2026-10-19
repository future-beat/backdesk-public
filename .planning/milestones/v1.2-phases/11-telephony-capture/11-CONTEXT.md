---
phase: 11
phase_name: Telephony Capture
milestone: v1.2
created: 2026-09-27
source: founder decisions 27 Sep 2026 + .planning/research/SUMMARY.md (S1–S7, S16, R1–R7) + ROADMAP.md Phase 11 planning note
---

# Phase 11 Context — Telephony Capture

## Goal
Every call a client diverts to their own Backdesk-controlled Australian number is answered with a short unrecorded greeting and lands as a logged missed call the rest of the milestone can act on — proven on real Telstra, Optus and Vodafone diverts before anything is texted.

## Decisions (locked)

<decisions>
- **D-01 Provider is Twilio Programmable Voice:** ClickSend cannot take inbound voice (its dedicated numbers answer with a busy tone; AU call forwarding is not offered). ClickSend stays for SMS. Telnyx Call Control is the fallback only if Twilio refuses the sole-trader regulatory bundle (S1).
- **D-02 One local number per client and tenant identity is the called number:** `ForwardedFrom`/Diversion is carrier-dependent and is captured as evidence only, never routed on (S2, S3). Numbers are never shared and never released while the client is active. No 1300/1800 (Vodafone cannot divert to them) and no 04 mobile numbers (heavier KYC, no benefit).
- **D-03 Greeting is static TTS then hang up:** Script ≤ 12 s, one fixed template with the business name substituted: "Hi, you've reached {business}. This is an automated message and the call isn't recorded. We're texting you now — if your number is private, text us instead." Says "automated" (founder, D10). The greeting never depends on a ClickSend or database round trip (rule R3): the voice webhook returns TwiML from data it already holds.
- **D-04 Nothing is recorded:** No `<Record>`, `<Dial>`, `<Gather>`, transcription, voicemail or provider-side recording anywhere; a structural test fails if any is introduced; recording features disabled at the Twilio account level and asserted by the reconcile (WA Surveillance Devices Act stays out of scope because no audio is retained).
- **D-05 Two signed webhooks:** `voice` (call arrival → log + TwiML) and `voice-status` (call completed → the Phase 12 text-back trigger). Authentication = Twilio request signature over the canonical public URL (`APP_BASE_URL`, not `request.url` behind Vercel's proxy) PLUS a per-route URL token, per the four-bearer rule. Never 5xx to the provider: on any failure answer the uniform greeting/200 and log a fixed string the ops probe surfaces.
- **D-06 Capture is double-sourced and idempotent:** `missed_calls` unique on `(provider, provider_call_id)`; the arrival webhook writes the row, the status callback completes it, and a provider call-log reconcile (existing reconcile-tick pattern) recovers any dropped callback with no duplicate row. Every diverted call is stored, including withheld (`anonymous`/`unknown`/`+266696687` → withheld marker, no number), landline and international callers — Phase 12's gate decides who is texted, not capture.
- **D-07 Stored fields:** tenant id, caller CLI (E.164) or withheld marker, called number, start time (UTC; Perth-time derivation in the read path), after-hours flag computed from the tenant's contact hours at arrival, provider call id, call status, `ForwardedFrom` raw value, duration; no audio, no transcript.
- **D-08 Provisioning from the console, gated:** operator buys a number for a client from the client page (Twilio API: search AU local by Perth area, buy, set voice URL + status callback with the route token); stored in `tenant_divert_numbers`; the go-live checklist shows the number and the divert-health state; releasing a number is impossible while the client is active (no delete path in v1.2).
- **D-09 Divert health:** arming text-back (Phase 12) requires an observed verification call; the console shows "verification call received on {date}" and "days since last diverted call"; Phase 11 ships the recording and display, Phase 12 consumes it in the gate.
- **D-10 Twilio region:** US1 with `edge: "sydney"` unless the S7 spike shows AU1 is needed for call-log visibility; recordings disabled either way; data at rest stays in Supabase Sydney.
- **D-11 One migration journal entry for the phase:** and its header documents the `cadences` generalisation decision (`kind`, nullable `quote_id`, `lead_id`, one-live-per-lead arbiter) even though Phase 12 executes it (ARCH §8).
- **D-12 Founder actions inside this phase:** open the Twilio account and submit the AU regulatory bundle as a sole trader (ABN Lookup record + ASIC business-name extract) on day 1 — number purchase and every live check wait on approval; then the live divert spike on real Telstra, Optus and Vodafone handsets (no-answer, busy, unreachable; one `#31#` withheld call) is a human-action checkpoint whose recorded outcome is the gate for Phase 12.
</decisions>

## Scope
- In: CAP-01..05 exactly as REQUIREMENTS.md states; the spikes S1 (bundle), S2/S3 (CLI survival, `ForwardedFrom` fill), S5 (greeting intelligibility), S7 (region/call-log).
- Out (later phases): any SMS (Phase 12), leads (13), ServiceM8 writes (14), lead queue and reporting (15). No recording, ever (milestone Out of Scope).

## Constraints carried
- Hosted Supabase is production; migration push protocol (cron:status lease gate, journal `when` monotonic, exit captured, no-op second run) before pushing code that writes the new tables.
- Bash commands naming `.env*` are denied; new env keys (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_WEBHOOK_SECRET`) documented in `docs/env-vars.md`, pushed to Vercel via the existing `env:push` path, never printed.
- Tooling budget: ~A$3.50/client/month on Twilio; pre-revenue ≈ A$14/month for design partners.
- Existing conventions: `forTenant()` repositories, RLS from the first migration, `tests/rls-coverage.test.ts` pins for new tables, `src/proxy.ts` matcher exclusion for the new public webhook paths, ops probes in the `audit-requests-count.mjs` mould, pure vitest bare / DB suites in CI.

## Deferred ideas
- Per-client recorded greeting (`<Play>`), AU1 region migration, shared-number attribution, texting the tradie on every miss — not in this phase.
