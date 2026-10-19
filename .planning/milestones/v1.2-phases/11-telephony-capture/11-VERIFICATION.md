---
phase: 11-telephony-capture
verified: 2026-10-05T15:35:51Z
status: passed
score: 5/5 must-haves verified (4 verified, 1 passed by override)
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "Live divert spike — gates Phase 12: on real no-answer, busy and unreachable diverts from Telstra, Optus and Vodafone handsets the original caller's CLI survives into the stored row (with ForwardedFrom fill-rate per carrier recorded as evidence only, never routed on); a #31# withheld call is logged with the withheld marker and no number, so it can never be texted (CAP-03)"
    reason: "Founder skipped plan 11-08 ('skip the spike altogether'). The proof is relocated to each client's onboarding: the divert_verification_call proof now requires an un-withheld caller number, the tenant's active divert number and a call under 24 hours old (WR-02, 66cda87), and the runbook requires a DIVERTED call from a second phone. Nothing in this criterion was proven live."
    accepted_by: "founder (Hesam Abbaszadi)"
    accepted_at: "2026-10-05T00:28:00+08:00"
human_verification:
  - test: "On a phone, open the test tenant's client page on production (13e8f2aa-edee-4eb1-b699-09b650674f81). Do not tap Buy."
    expected: "The 'Ready to send?' card shows thirteen rows; 'Divert number provisioned' shows the number; 'Verification call recorded' reads verified with a date and the row id b79a5f9d-…; beneath it 'Last diverted call {date} — N days ago'; the Divert number section says the number cannot be released and shows no release control."
    why_human: "Row order, copy and layout at phone width are visual. Harvested from the human-check blocks in 11-04-01 and 11-05-02; typecheck proves the props, not what the operator sees."
  - test: "Set Twilio auto-recharge on the account (balance was US$20 on 2026-10-02)."
    expected: "Auto-recharge enabled, recorded in docs/external-registrations.md."
    why_human: "Twilio Console billing setting. A lapsed balance stops the number answering, and no code path watches the balance."
  - test: "First real client: make the verification call as a DIVERTED call per runbook section 7 — divert set on the client's handset, client's own line rung from a second phone with caller ID on."
    expected: "missed-calls:recent shows call_status=completed, completed_via=callback, caller_withheld=false, caller_present=true; the proof is accepted by the console; carrier and forwarded_from_present recorded. If caller_present=false, that client is not armed for text-back."
    why_human: "This is where the skipped spike's proof now lives. It needs a real handset on a real carrier, and code cannot tell a direct dial from a divert when ForwardedFrom is absent."
  - test: "Before the test tenant is ever armed for text-back in Phase 12, re-record its verification proof from a diverted call."
    expected: "A new divert_verification_call proof whose artefact detail carries caller_present=true and divert_number_id."
    why_human: "The existing proof (b79a5f9d, recorded 2026-10-02) came from a direct dial and predates WR-02; it still satisfies the checklist's divertVerified row, which only asks whether a proof row exists."
  - test: "First real client's number purchase: watch the revised provisioning path run once on production."
    expected: "Find offers a WA-range number only; after Buy the row is active, the Twilio Console shows the bundle attached without a manual update, and the console shows no 'AU bundle not attached' line."
    why_human: "The only live purchase (2026-10-02) predates CR-01, WR-07, WR-08 and WR-09. The hold/adopt path, the WA range filter and the bundle read-back are unit-tested and CI-green but have never run against Twilio."
---

# Phase 11: Telephony Capture Verification Report

**Phase Goal:** Every call a client diverts to their own Backdesk-controlled Australian number is answered with a short unrecorded greeting and lands as a logged missed call the rest of the milestone can act on — proven on real Telstra, Optus and Vodafone diverts before anything is texted.
**Verified:** 2026-10-04T17:22:40Z (2026-10-05 01:22 AWST)
**Status:** human_needed
**Re-verification:** No — initial verification
**Commit verified:** `a85d8be` (HEAD = origin/main; CI success on that SHA; Vercel Production deployment `success` at 2026-10-04T17:09Z)

## Goal Achievement

The capture half of the goal is achieved and checked against code, tests and production. The "proven on real Telstra, Optus and Vodafone diverts" half is **not** proven: the founder skipped the spike. It is carried as an accepted override, not a pass on evidence.

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator provisions one AU local (08) number per client from the console; recorded against that tenant only, shown on the client record, never shared, never released (CAP-01) | VERIFIED | `provisionDivertNumber` (`src/core/telephony/provision.ts`) claims a `pending` row before the purchase and activates after. `tenant_divert_numbers_tenant_uniq` and `tenant_divert_numbers_number_uniq` in migration 0038 stop sharing. No delete or release path: no `delete(tenantDivertNumbers)` anywhere in `src`/`scripts`, the only Twilio update is the bundle-only `attachBundle`, grants are SELECT-only for `authenticated`. The number renders through `checklist.divert` on the client page. Suites `provision-divert-number` and `divert-provision-action` pass. Live: PN `PN00000000000000000000000000000000` bought from the console on 2026-10-02. |
| 2 | Caller hears a static greeting of at most 12 s (business name, text on its way, not recorded, private-number callers text instead) then hang-up; no Record/Dial/Gather/transcription/voicemail, and a test fails if one is introduced (CAP-02) | VERIFIED | `greetingTwiml` emits only `Response`, `Pause`, `Say`, `Hangup`; template is D-03 verbatim. `tests/telephony-greeting.test.ts` scans both telephony directories for twelve forbidden verbs and four recording APIs and proves the scanner is not blind. Suite passes. Production rows show 11–12 s total call duration on five calls (limit 13 s including the 1 s pause). |
| 3 | Every diverted call becomes exactly one `missed_calls` row (tenant from the called number, CLI or withheld marker, start time, after-hours flag, provider call id); a dropped status callback is recovered by the reconcile with no duplicate (CAP-03) | VERIFIED | Arbiter `missed_calls_provider_call_uniq`; arrival is `ON CONFLICT DO NOTHING`, callback is UPDATE-only, reconcile upsert fills only NULLs. Tenant lookup takes `To` only. Route, reconcile and caller suites pass; the DB-backed `tests/missed-calls.test.ts` is green in CI on `a85d8be`. Production read-back by this verifier: five rows, five distinct call ids; drill row `71284d4a-…` reads `source=webhook`, `completed_via=reconcile`, same id. Withheld, landline and international classification is proven by unit tests only — no such call has reached production. |
| 4 | Live three-carrier divert spike — gates Phase 12 (CAP-03) | PASSED (override) | Override: founder skipped plan 11-08 on 2026-10-05 — see "Override" below. Not proven on any evidence. |
| 5 | Both webhooks verify the Twilio signature over the canonical URL plus a per-route token before any write, answer a uniform greeting/200 on any failure (never 5xx), log a fixed string the ops probe surfaces; the console shows the verification call and days since the last diverted call (CAP-04, CAP-05) | VERIFIED | Both routes: constant-time token check before the body is read, URL from `twilioWebhookUrl()` (built from `APP_BASE_URL`), SDK `validateRequest`, then the write. Env failure answers 200 (WR-03). Fixed strings `signature_rejected`, `base_url_unset`, `body_unreadable`, `env_unreadable`. Both route suites pass. Probes by this verifier: no token, wrong token and same-length wrong token return 401 on both production doors. Four production rows completed via callback show real Twilio requests pass signature and token. Checklist items `divertNumber`/`divertVerified` and `DivertHealthLine` render the proof and the days count, derived at read time. |

**Score:** 5/5 truths (4 verified, 1 passed by override; 0 present-but-behaviour-unverified)

### Override: success criterion 4 (the Phase 12 gate)

The founder decided "skip the spike altogether" on 2026-10-05. It is recorded in `11-08-SUMMARY.md` (status `skipped`) and `.planning/STATE.md` line 488.

**What remains unproven**

- Caller CLI surviving a no-answer, busy or unreachable divert on Telstra, Optus or Vodafone. Every production call so far was dialled directly to the Twilio number from one mobile (`forwarded_from_present=false` on all five rows).
- A withheld (`#31#`) caller on a real call. The classifier is tested against Twilio's documented sentinels only.
- `ForwardedFrom` fill-rate per carrier. No data.

**The relocation is real**

| Where | Confirmed |
|---|---|
| `src/app/(console)/clients/[id]/actions.ts` lines 1031–1063 | The `divert_verification_call` arm refuses a call that is not `completed`, not on the tenant's active divert row, withheld or without a caller number, older than 24 hours, or stamped more than a minute in the future. |
| `src/db/repository/missed-calls.ts` | `callerPresent` is computed in SQL (`caller_e164 IS NOT NULL`); no caller number is selected. |
| `tests/proof-actions.test.ts` lines 789–840 | Each refusal has a test; suite passes (54 tests). |
| `docs/telephony-runbook.md` section 7 | "This call MUST be a DIVERTED call — never a direct dial", from a second phone with caller ID on; do not arm if `caller_present=false`. |

**Limits of the relocation**

- Code cannot tell a direct dial from a divert. A direct dial with caller ID on passes every check in the proof arm. The diverted-call requirement is enforced by the runbook and the operator only.
- The arm accepts any present caller, including `caller_kind=other_number` (a landline second phone). The review suggested requiring `mobile`; the fix did not.
- The test tenant's existing proof (`b79a5f9d-…`, recorded 2026-10-02T12:46Z) came from a direct dial and predates WR-02. The checklist's `divertVerified` row only asks whether a proof row exists, so it reads verified for the test tenant today.
- Phase 12 must fail safe on the own-number case. Capture does not mark "caller is the diverting line" (review IN-07, open).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/app/api/webhooks/twilio/voice/route.ts` | Voice door | VERIFIED | 171 lines; wired to `recordMissedCallArrival` and `greetingTwiml` |
| `src/app/api/webhooks/twilio/voice-status/route.ts` | Status door | VERIFIED | 164 lines; wired to `applyVoiceStatus`; no insert |
| `src/core/telephony/greeting.ts` | The only TwiML | VERIFIED | Four elements; name escaped and capped at 60 |
| `src/core/telephony/caller.ts` | Withheld / mobile / other classifier | VERIFIED | Six sentinels as words and digits (WR-01); unrecognised input is withheld |
| `src/core/telephony/missed-call.ts` | Arrival and completion | VERIFIED | Never throws; 6 s deadline; dead letters carry no caller data |
| `src/core/telephony/verify-signature.ts`, `webhook-url.ts` | Signature check and canonical URL | VERIFIED | One builder used by provisioning and both routes |
| `src/core/telephony/twilio-client.ts` | Only REST client import | VERIFIED | Only file importing `twilio` root; Sydney edge |
| `src/core/telephony/reconcile.ts` | Call-log reconcile and recording alarm | VERIFIED | Called from `messaging-reconcile/route.ts` line 115 |
| `src/core/telephony/provision.ts` | Claim-then-buy | VERIFIED | Hold, adopt, reclaim, bundle read-back |
| `src/db/migrations/0038_phase11_telephony_capture.sql` | Both tables, RLS, grants, proof kind | VERIFIED | Applied to production 2026-09-28 (recorded); production reads succeed |
| `src/db/repository/missed-calls.ts` | Three writers, one read | VERIFIED | DB suite green in CI |
| `src/core/onboarding/checklist.ts` + `checklist-card.tsx` | Thirteen items, divert health | VERIFIED | Rendering needs the human check |
| `src/app/(console)/clients/[id]/divert-number-form.tsx` | Find / Buy / rename, no release | VERIFIED | No release control; rendering needs the human check |
| `scripts/missed-calls-recent.mjs`, `twilio-numbers-search.mjs`, `verify-missed-call-reconcile.mjs` | Ops scripts | VERIFIED | `missed-calls:recent` run by this verifier (exit 0, no number printed); the other two not run (provider read / production write) |
| `docs/telephony-runbook.md`, `COVERAGE.md` | Runbook and coverage | VERIFIED | Section 7 carries the relocated proof |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| voice route | `missed_calls` | `recordMissedCallArrival` → `insertMissedCallArrival` | WIRED |
| voice-status route | `missed_calls` | `applyVoiceStatus` → `completeMissedCall` | WIRED |
| `messaging-reconcile` cron (03:30 AWST, active) | `missed_calls` | `reconcileMissedCalls` → `upsertMissedCallFromLog` | WIRED |
| provisioning | both routes | `twilioWebhookUrl()` written onto the number and rebuilt by the routes | WIRED |
| proof action | `missed_calls` | `getMissedCallForTenant` (tenant in the predicate) | WIRED |
| client page | divert health | `readGoLiveChecklist` → `checklist.divert` → `ChecklistCard` | WIRED |
| `src/proxy.ts` | both doors | matcher excludes `api/` | WIRED (401 from the route itself, not a 307) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|---|---|---|---|---|
| Checklist `divertNumber` row | `divert.numberE164` | `repo.divertNumber.get()` | Yes — one active row in production | FLOWING |
| Checklist `divertVerified` row | `divertProof` | `repo.proofs.latest('divert_verification_call')` | Yes — proof recorded 2026-10-02 | FLOWING |
| Divert health line | `lastCallAt`, `daysSinceLastCall` | `repo.missedCalls.latest()` | Yes — newest row 2026-10-02T12:50Z | FLOWING |
| Greeting name | `owner.spokenName` | `forAllTenants_divertNumberByE164(To)` | Yes — live greeting named the tenant | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Ten pure telephony suites | `npx vitest run` on greeting, caller, webhook-url, both routes, provision, provision action, reconcile, ops-scripts, lint-ban (Twilio dummies inline) | 10 files, 441 tests passed | PASS |
| Verification-proof arm | `npx vitest run tests/proof-actions.test.ts` | 54 passed | PASS |
| DB-backed suites | `missed-calls`, `rls-coverage`, `go-live-checklist` | Refused locally by the production guard, as designed; CI run on `a85d8be` success | PASS (CI) |
| Typecheck | `npm run typecheck` | exit 0 | PASS |
| Lint | `npm run lint` | exit 0 | PASS |
| Wrong-token probes, production | `POST` to both doors with no token, `wrong`, and a 64-char wrong token | 401 on all six | PASS |
| Production rows | `npm run missed-calls:recent -- --tenant 13e8f2aa-… --limit 10` | 5 rows, 5 distinct call ids, 4 callback and 1 reconcile | PASS |
| Cron health | `npm run cron:status` | lease 0, no watchdog, four jobs active on the custom domain, last five responses 200 | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes are declared for this phase. The production probes are the wrong-token requests and read-only scripts above.

### Requirements Coverage

| Requirement | Plans | Status | Evidence |
|---|---|---|---|
| CAP-01 | 01, 05, 06, 07 | SATISFIED | Truth 1 |
| CAP-02 | 01, 03, 07 | SATISFIED | Truth 2; reconcile recording alarm returns `null`, not 0, on a failed count (WR-05); `recordings=0` on each recorded run |
| CAP-03 | 01, 02, 03, 07, 08 | SATISFIED with override | Capture, idempotency and reconcile verified in code and production. The withheld, landline and international clauses are unit-tested only; the diverted-call clause is covered by the override. |
| CAP-04 | 01, 02, 08 | SATISFIED | Truth 5. The "ops probe" is `vercel logs | grep` per runbook section 0; there is no scripted probe, and this verifier did not read the Vercel logs. |
| CAP-05 | 04, 05, 07 | SATISFIED | Proof arm, checklist rows and days-since line. Arming enforcement belongs to TXT-05 in Phase 12; `ARMING_GATES` is untouched here. |

No orphaned requirements: REQUIREMENTS.md maps only CAP-01..05 to Phase 11.

### Anti-Patterns and Record Inconsistencies

No `TBD`, `FIXME`, `XXX`, `TODO` or `HACK` in the 61 files changed by the phase. No stubs.

| Where | Finding | Severity | Impact |
|---|---|---|---|
| `.planning/ROADMAP.md` Phase 11 | Reads "7/8 plans executed" with 11-08 unchecked and criterion 4 still worded as the gate | Warning | The roadmap does not show the override; a reader of Phase 12's gate sees an open spike |
| `.planning/STATE.md` line 33 | "Status: Ready to execute 11-08" contradicts line 488 (spike skipped) | Warning | Stale state |
| `docs/telephony-runbook.md` section 10 | Still titled "Live divert spike protocol (success criterion 4 — gates Phase 12)" with no note that it was skipped | Warning | Section 7 is correct; section 10 contradicts it |
| `deferred-items.md`, `11-08-SUMMARY.md` | F-11-07-1 and F-11-07-2 still read OPEN; both were fixed in `d405260` and `769576d` | Info | Stale |
| `11-VALIDATION.md` | `status: draft`, `nyquist_compliant: false` | Info | Validation was never finalised |
| `11-REVIEW.md` | IN-01, IN-02, IN-04, IN-05, IN-06, IN-07 open | Info | IN-07 (own-number detection) and IN-04 (no CHECK tying `caller_kind` to `caller_e164`) matter to Phase 12's send gate |
| Greeting copy | Says "We're texting you now" while nothing texts until Phase 12 | Info | Only the test tenant has a number; do not divert a real client's line before Phase 12 |
| Greeting length | 12 s was measured for one spoken name; the cap is 60 characters / 6 words | Info | A long name may exceed 12 s; runbook section 7 measures it per client |

### Human Verification Required

1. **Console page on a phone.** Open the test tenant's client page on production. Expect thirteen checklist rows, the number on "Divert number provisioned", "Verification call recorded" verified with a date and row id, the "Last diverted call … N days ago" line, and no release control. Layout at phone width is visual.
2. **Twilio auto-recharge.** Enable it and record it. Balance was US$20 on 2 Oct and nothing watches it.
3. **First real client's verification call must be a diverted call.** Runbook section 7. Expect `caller_present=true`, `caller_withheld=false`, `completed_via=callback`; record the carrier and `forwarded_from_present`. If the caller is missing, do not arm that client.
4. **Re-record the test tenant's proof from a diverted call** before it is ever armed for text-back. The current proof is from a direct dial and predates WR-02.
5. **First real client's purchase exercises the revised provisioning path.** Expect a WA-range candidate, the bundle attached without a manual update, and no "AU bundle not attached" line. The hold/adopt, WA-range and bundle read-back code has never run against Twilio.

### Gaps Summary

No gaps. Four of five success criteria are verified against the code, the test suites and production. Criterion 4 passes by founder override only: no carrier divert, withheld call or `ForwardedFrom` reading exists. The proof has moved to each client's onboarding, where the console enforces a present caller on the active number within 24 hours and the runbook requires the call to be diverted. Status is `human_needed` because of the five items above.

---

_Verified: 2026-10-04T17:22:40Z_
_Verifier: Claude (gsd-verifier)_

## Re-verification, 2026-10-05 — human verification completed

No source, script or test file changed between the verified SHA `a85d8be` and this update (docs and planning records only). The human-verification items owed above were run as UAT on the founder's phone (`11-UAT.md`, 5/5 passed): the thirteen-row checklist with the number, the verified row and the last-diverted-call line; no release or buy-another control; the greeting on a real call; an old call refused as a verification proof with the "make a diverted call from a second phone" sentence (WR-02 live); a new call updating the last-diverted-call line. Status moves from `human_needed` to `passed`.

Unchanged and carried forward, not gaps: criterion 4 passed by founder override (no diverted call has been made on any carrier; the founder has no second phone today); Twilio auto-recharge; the test tenant's proof to be re-recorded from a diverted call before it is ever armed; the first real client's purchase is the first live run of the hold/adopt, WA-range and bundle read-back paths.
