---
phase: 12-instant-text-back-arming
plan: 05
subsystem: text-back / escalation / attribution / inbound / console
status: complete
tags: [text-back, open-quote, touch-0, reply-pause, quote-call-escalation, attribution, lead-reply, null-safety]
requires:
  - 12-01 (sendTextBack, liveQuoteCadenceForMobile, ABOUT_QUOTE_TOUCH_NUMBER, the quote_open stub)
  - 12-02 (claimEscalationForMissedCall, listUnescalatedQuoteCalls, claimTextBackAlerts)
  - 12-03 (migration 0039 live, incl. the pause_failed arm of missed_calls_text_back_alert_idx)
  - 12-04 (sweep and alert pass, tick seams); 12-06 (about_quote attestation); 12-07
provides:
  - "sendTextBack's D-08 arm: about-quote text as touch 0 of the live quote cadence, no lead, the existing reply pause (seam deps.pauseForReply), result kind sent_pause_failed"
  - "TEXT_BACK_PAUSE_FAILED_DETAIL ('pause_failed') in src/db/schema/missed-calls.ts; claimTextBackAlerts third arm; textBackPauseFailed tick field"
  - "qualifyingTouches excludes ABOUT_QUOTE_TOUCH_NUMBER (D-17)"
  - "src/core/escalation/quote-call.ts (escalateQuoteCalls) and buildQuoteCallEscalationSms; four quoteCallEscalation* tick fields"
  - "Hot replies on a lead cadence escalate with quote_id NULL and lead_id set (D-18)"
affects:
  - 12-08 (the text_back_proof; once text_back is armable the quote branch and quote-call pass act in production)
  - 12-09 (first real lead reply observed; the human-check below)
  - Phase 13 (lead vocabulary and LEAD-03 after-hours switch replace the D-18 interim wording)
tech-stack:
  added: []
  patterns:
    - "Reserved touch number on an existing cadence as the never-twice key for a side-channel send (ledger (cadence, touch) claim first)"
    - "A pause that may fail after commit is surfaced through a detail value the alert claim already indexes, never silently"
    - "Second escalation trigger rides the existing sender seam: undefined sender, no scan, no claim"
key-files:
  created:
    - src/core/escalation/quote-call.ts
    - tests/text-back-quote.test.ts
    - tests/lead-reply.test.ts
  modified:
    - src/core/leads/text-back.ts
    - src/core/leads/sweep.ts
    - src/core/alerts/text-back-alerts.ts
    - src/core/attribution/qualify.ts
    - src/core/escalation/message.ts
    - src/core/escalation/escalate-hot-leads.ts
    - src/core/cadence/run-tick.ts
    - src/app/api/internal/cadence-tick/route.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
    - src/db/repository/for-tenant.ts
    - src/db/repository/missed-calls.ts
    - src/db/repository/escalations.ts
    - src/db/schema/missed-calls.ts
    - tests/attribution-qualify.test.ts
    - tests/attribution-decide.test.ts
    - tests/cadence-tick-route.test.ts
    - tests/cadence-tick.test.ts
    - tests/escalation-message.test.ts
    - tests/text-back.test.ts
    - tests/text-back-sweep.test.ts
    - tests/text-back-balance.test.ts
    - tests/text-back-tick-passes.test.ts
decisions:
  - "The D-08 arm claims the ledger on (quote cadence, touch 0) FIRST inside the claim transaction; zero rows records skipped/quote_open WITH route quote and the cadence id (a new TextBackDecisionPatch variant), so a repeat call is still escalated to the tradie"
  - "Touch 0 is inserted already sent (touches.insertMany then markSent in the same transaction); the quote's touches 1..5 are neither read nor written"
  - "The pause runs after the commit and before the send; a throw or any kind other than paused/upgraded sets pause_failed; the text still goes; outcome sent + detail pause_failed; result sent_pause_failed; the sweep counts it as sent"
  - "The pause_failed constant lives in the schema module (src/db/schema/missed-calls.ts) so the writer (core) and the alert predicate (repository) share one value without the repository importing core"
  - "The alert email reports pause failures as their own section ('N sent, but the quote cadence could not be paused — pause it on the quote page'); a pause-only email does not say 'did not go through'; textBackPauseFailed counts claimed rows even if the email is lost (that loss is alertFailed)"
  - "The quote-call SMS says 'We texted them back about their quote.' only when the touch-0 ledger row's outcome is sent; refused or unknown reads 'Our text back to them is not confirmed.'"
  - "Quote-call counts: escalated, cooldownSuppressed, refused (no number + not configured), sendFailed (provider refusal or any throw); its unconfigured flag is escalationUnconfigured (same seam)"
  - "A hot reply on a lead cadence reads its lead id via forTenant().cadences.getById (for-all-tenants.ts is pinned and unchanged) and uses the snippet 'missed call'"
  - "classify-inbound.ts was NOT changed: the classifier reads only the reply body (listUnclassified selects id/body/receivedAt/attempts), so there is no quote context to replace; inbound threading, both suppression paths and the console links were already null-safe from 12-01 and are now proven by tests/lead-reply.test.ts"
  - "TXT-04 left unticked: its text says 'the operator is escalated', while D-16 (founder 6 Oct) routes the escalation to the tradie's escalation phone; the requirement wording should be amended before it is ticked"
metrics:
  duration: "~40 min"
  completed: 2026-10-06
  tasks: 3
  files: 25
estimate:
  tokens: 60000
  tasks: 3
actuals:
  tokens: 23340
  tasks: 3
  commits: 4
---

# Phase 12 Plan 05: Open-quote callers, quote-call escalation and lead-reply null-safety Summary

A missed caller with a live quote cadence now gets the attested "about your quote" text once, as reserved touch 0 on that cadence through the ledger. The cadence pauses through the existing `customer_reply` pause, and the tradie's own escalation phone is told once per call. That text can never qualify a win. A reply to any text-back now threads, pauses, is classified and, when hot, escalates on a lead cadence that has no quote.

## Wave-4 gate (before any edit)

- Pushed `01cd918` (12-04, 12-06 and 12-07, plus 12-03's docs). CI run **37407955826**, conclusion **success** on that SHA. This was the first CI run of `tests/text-back-sweep.test.ts` and the wave-4 pins. Nothing failed, so nothing was fixed forward.
- Production deployment for `01cd918` was READY. `voice` and `voice-status` both answered 401 to a wrong token, `/login` answered 200, and `cadence-tick` answered 200 every minute after the deployment (03:19 to 03:22Z).
- `MESSAGING_CHANNELS` is still `['sms','email']`, so nothing can arm text-back. The deployed sweep, alert pass, probe and the new quote branch are inert.

## What was built

**Task 1, the D-08 arm (`9e774b9`).** In `sendTextBack`, a caller who matches `liveQuoteCadenceForMobile` is now handled like this:
- The variant becomes `about_quote`, so gate rule ten checks that wording.
- The ledger claim on `(cadence, ABOUT_QUOTE_TOUCH_NUMBER)` is taken first.
- In the same transaction, the code writes touch 0 already `sent`, then an approved draft holding the attested bytes (same model and prompt-version constants as the lead path), then the decision `claimed` with route `quote`.
- No lead is opened and no lead cadence started.
- After the commit, `pauseForReply` runs through an injectable `deps.pauseForReply` seam, then the send goes out with `quoteId` set and `leadId` null.

If the pause fails, the call is recorded `sent` with detail `pause_failed` and the result is `sent_pause_failed`. `claimTextBackAlerts` has a third arm (`sent` + `pause_failed`). The operator email names those calls per client, and the tick reports `textBackPauseFailed`. Other Task 1 changes:
- `qualifyingTouches` drops touch 0. `qualifiesAsTouch` and its SQL twins are byte-identical.
- The quote page shows touch 0 as "Missed-call reply".
- The 12-01 test that expected a `quote_open` skip on first contact now expects the send, and a repeat-call `quote_open` case was added.

**Task 2, quote-call escalation (`b734662`).** `escalateQuoteCalls` copies `escalateHotLeads` closely:
- With no sender, the pass does not scan.
- It reads the tenant's escalation phone and normalises it, resolves the from-number through `resolveSmsFrom`, and asks `recentEscalationForCadence` before the claim.
- It then calls `claimEscalationForMissedCall`, and either records a named refusal or sends with `customString` set to the escalation id. It returns counts only.

`buildQuoteCallEscalationSms` sits beside `buildEscalationSms` and reuses its sanitizer, first-name cap, snippet cap and derived budget. The pass runs directly after the hot-lead pass on the same `escalationSender` seam, and the tick, route and key-set pin each gained four fields.

**Task 3, D-18 (`67cd763`).** `escalateHotLeads` handles a reply on a lead cadence: it claims with `quote_id` NULL and the lead id, and the SMS says `"missed call"` where the job description would go. `claimEscalation` takes an optional `leadId`. `tests/lead-reply.test.ts` proves the end-to-end behaviour (listed below).

## Final push

- Pushed `67cd763`. CI run **37410224929**, conclusion **success** on that SHA, 163 files and 5176 tests. This was the first CI run of `tests/text-back-quote.test.ts` (13 tests) and `tests/lead-reply.test.ts` (6 tests). The 29 skipped tests are other suites' existing skips.
- Production deployment for `67cd763` is READY (deployment status `success`). Both Twilio doors answer 401 to a wrong token, `/login` answers 200, and `cadence-tick` answered 200 from 03:48 to 03:51Z after the deployment.
- The "must not move" files are byte-identical to the plan base `01cd918`: `tests/report-metrics.test.ts`, `tests/sync-upsert.test.ts`, `tests/cron-schedules.test.ts`, `tests/cadence-transitions.test.ts`, `src/db/repository/for-all-tenants.ts` and `scripts/apply-cron-schedules.mjs`.

## The four flagged TXT-04 assumptions, checked against the code

1. **The match is on the quote cadence's snapshot mobile only.** Holds. `liveQuoteCadenceForMobile` filters `cadences.contact_mobile`, scoped to the tenant, `kind = 'quote'`, live statuses. It does not read job-contact rows.
2. **A repeat call gets no second text but is still escalated, subject to the cooldown, unless the 24-hour rule skipped it first.** Holds. A repeat inside 24 hours is skipped `recent_text` with route NULL, so `listUnescalatedQuoteCalls` (route `quote` only) never lists it and nothing is escalated. A repeat after 24 hours is skipped `quote_open` with route `quote` and is escalated, or suppressed by the cooldown. Both cases are tested.
3. **Escalation ignores contact hours, so an after-hours call reaches the tradie at that hour.** Holds. The quote-call pass has no contact-hours gate, matching the hot-lead path.
4. **The about-quote text counts in live "sent" metrics and "quotes chased", never in attribution.** Holds. `qualifiesAsTouch` and its two SQL twins are untouched, so the live metrics count touch 0. Only `qualifyingTouches`, which attribution's decision uses, drops it.

None was contradicted. One more fact for the founder: a quote customer whose call is refused by the gate for any other reason (not armed, no about-quote attestation, daily cap, stale) gets route NULL and is **not** escalated.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The pure alert-pass suite mocks `@/db/repository` wholesale**
- **Found during:** Task 1
- **Issue:** I first exported the `pause_failed` constant from the repository barrel. `tests/text-back-tick-passes.test.ts` mocks that barrel, so the constant was undefined there. That suite's alert-result `toEqual`s also had to gain `pauseFailed`.
- **Fix:** Moved `TEXT_BACK_PAUSE_FAILED_DETAIL` into `src/db/schema/missed-calls.ts`, which is imported by both the writer and the alert predicate. Updated that suite's expectations and added two pause-failed cases.
- **Files modified:** `src/db/schema/missed-calls.ts`, `tests/text-back-tick-passes.test.ts` (neither in the plan's file list)
- **Commit:** `9e774b9`

**2. [Rule 3 - Blocking] A skip could not carry a route or cadence**
- **Found during:** Task 1
- **Issue:** `TextBackDecisionPatch`'s skipped arm wrote route NULL, so the plan's "skipped quote_open with route quote and the cadence id" could not be recorded.
- **Fix:** Added one explicit variant, `{ status: 'skipped', skipReason: 'quote_open', route: 'quote', cadenceId }`, and its write branch.
- **Files modified:** `src/db/repository/for-tenant.ts`
- **Commit:** `9e774b9`

**3. [Rule 3 - Blocking] `claimEscalation` could not record a lead id**
- **Found during:** Task 3
- **Issue:** The plan says to claim "with the lead id", but `EscalationClaim` had no `leadId`.
- **Fix:** Added an optional `leadId` and wrote it to the existing `escalations.lead_id` column. A quote reply passes nothing, so it stays NULL as before.
- **Files modified:** `src/db/repository/escalations.ts` (not in the plan's file list)
- **Commit:** `67cd763`

**4. [Scope note] No change to `classify-inbound.ts`, `inbound.ts` or the console inbox and queue**
- The plan expected classification to read quote context. It does not: it sends only the reply body. Inbound threading already carried `leadId` (12-01). The inbox already renders its quote link only under `row.tenantId && row.quoteId`, and the queue page already filters to non-null quote ids. Each of these is now proven in `tests/lead-reply.test.ts` (one is a source pin) rather than edited.

## Human check (deferred to the operator; not runnable by the executor)

- On production at https://app.backdesk.com.au, open the inbox and the approval queue after this deploy. Both pages should render as before, with no link ending in `/quotes/null` or `/quotes/undefined`. The code paths are guarded and pinned, but no lead-threaded message exists in production yet. The first real lead reply is observed in 12-09.

## Requirements

- **TXT-04 not ticked.** All the behaviour is built and CI-proven: no new lead, the call attaches to the cadence, the cadence pauses, the about-quote template is sent, and someone is escalated. But the requirement says "the **operator** is escalated", and D-16 (founder, 6 Oct 2026) sends that escalation to the **tradie's** escalation phone. The operator is told only when the pause fails. The requirement text should read "the tradie is escalated (D-16)" before it is ticked.

## Threat Flags

None. The only new outbound surface is an SMS to the tenant's own normalised escalation phone, which is T-12-29 in the plan's threat model. No new endpoint, auth path or schema change.

## Known Stubs

None.

## Self-Check: PASSED
