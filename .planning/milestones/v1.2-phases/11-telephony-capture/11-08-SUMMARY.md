---
phase: 11
plan: "11-08"
status: skipped
skipped_by: founder override
decided: 2026-10-05
requirements-completed: []
requirements-advanced: [CAP-03, CAP-04]
---

# 11-08 SUMMARY — three-carrier live divert spike: SKIPPED by founder override

**Decision (founder, 5 Oct 2026, verbatim): "skip the spike altogether".** No task in this plan was executed. No handset diverts were set, no spike calls were made, nothing was written to Twilio or the database.

## What this leaves unproven
ROADMAP Phase 11 success criterion 4 ("Live divert spike — gates Phase 12") was the proof that, on real no-answer, busy and unreachable diverts from Telstra, Optus and Vodafone handsets, the original caller's CLI survives into the stored row, and that a `#31#` withheld call logs with the withheld marker and no number. As of this decision:

- Proven on production (plan 11-07): five **directly dialled** calls from one mobile → one row each, caller present, 11–12 s greeting, completion via callback; a dropped callback recovered by the reconcile with no duplicate; signature + token accepted on real Twilio requests; recordings = 0.
- **Not proven:** CLI survival through any carrier's conditional divert; `ForwardedFrom` fill-rate; a withheld (`#31#`) caller on a real call (the classifier is unit-tested against Twilio's documented sentinels only); behaviour on busy/unreachable diverts.

## Where the proof moves
The override does not delete the question, it relocates it. From now on:

1. **Per-client onboarding is the proof.** The `divert_verification_call` recorded for each client (CAP-05, runbook `docs/telephony-runbook.md`) MUST be a **diverted** call — the client's handset set to no-answer divert, rung from a second phone — not a direct dial. The operator checks the stored row shows `caller_present=true` and that the caller is the second phone, before text-back can be armed (Phase 12 gate, TXT-05).
2. **Phase 12 must fail safe.** If a diverted call arrives with the caller absent or equal to the client's own number, nothing is texted (TXT-03 already skips withheld and the client's own numbers); the missed-call log shows it, so a carrier that strips CLI is visible within the first verification call rather than discovered by a customer.
3. The research's fallback stands: if a carrier is found to strip CLI, that client is not armed for text-back on that carrier; no design change is made speculatively.

## Requirements
- CAP-03: capture, idempotency and reconcile are proven live; the "diverted, withheld, landline, international" clause is proven by unit tests and direct calls only. Marked complete **with this override recorded**.
- CAP-04: signature over the canonical URL + route token accepted on real provider requests; 401 probes recorded in 11-02; the drill's broken token produced no row completion via callback. Marked complete.

## Carried forward
- First real client: diverted verification call per the runbook; record carrier and whether `ForwardedFrom` was present (evidence only).
- F-11-07-1 and F-11-07-2 were fixed in the review round (d405260, 769576d); the first real client's purchase is their first live run.
- Twilio auto-recharge before the first client (balance US$20).
