---
phase: 12
plan: "12-09"
status: skipped
skipped_by: founder override
decided: 2026-10-07
requirements-completed: []
requirements-advanced: [TXT-01, TXT-02, TXT-05, COMP-03]
---

# 12-09 SUMMARY — founder live session: SKIPPED by founder override

**Decision (founder, 7 Oct 2026, verbatim): "i don't have a second number, skip this test for now just like the spike".** Task 1's decision was answered `go-one-phone` on 6 Oct, but the one-phone mode requires an Australian mobile other than the calling handset as the escalation phone and as the never-text own line; the founder has no second number, so no step of Task 2 was executed. Nothing was armed, no template was attested, no SMS row was enabled, no text was sent, nothing was written to production.

## Pre-flight at the time (read-only, 6–7 Oct)
Production on `e8557b1` (CI success on that SHA and on the code SHA `1e69e16`); `remote_test_lease rows: 0`, no watchdog; ClickSend balance A$19.13 after a top-up (was −A$20.87 on 6 Oct); test tenant: `samples=0`, `text_back_armed=false`, `sms_enabled_for_tenant=false`; `messaging_config text_back: rows=0 enabled=0`.

## What this leaves unproven
- **No text-back has ever been sent on production.** The gate, the ledger send, the delivery receipt and the `text_back_proof` are proven in CI on a local stack and in pure suites, not against ClickSend from a real diverted call.
- **S4 timing (D-14):** call arrival → SMS delivered has no sample; D-01 (send on call-completed) stands on research, not measurement.
- **Fail-safe demonstrations** (`recent_text`, `own_number`, `withheld` skips) are unit/DB-tested only.
- Together with the 11-08 override: no diverted call has been observed on any carrier.

## Where the proof moves
The first founding client's onboarding is the live proof, exactly as `docs/client-divert-onboarding-runbook.md` describes: diverted verification call from a second phone → arm → first live text with a stopwatch → `text_back_proof` → the checklist's "Text-back: Live". Until then:
1. No client may be armed on a direct-dial proof (the strict `divertVerified` rule enforces this in code; the one-phone override exists only for the founder's own test tenant and was not used).
2. The test tenant stays: paused, SMS off, text-back off, three templates unset, escalation phone unchanged.
3. The balance alarm will email once per Perth day while the balance is under A$20; auto-disarm is impossible with nothing armed.

## Requirements
- TXT-01 (instant text within seconds): built and CI-proven; the live "within seconds" is unmeasured → marked complete **with this override recorded**.
- TXT-02, TXT-05, COMP-03: already complete (12-04, 12-08, 12-07); their live halves (a real delivered text, a real arm, a real diverted verification) are the first client's.

## Carried forward
- First client: run the onboarding runbook end to end; record the carrier, `forwarded_from_present`, the stopwatch seconds and the reader's `arrival_to_delivered_s`; record the `text_back_proof`.
- Phase 15 must report the S4 figure once it exists.
- Phase 11 review items IN-02 and the SA-range test number remain as recorded.
