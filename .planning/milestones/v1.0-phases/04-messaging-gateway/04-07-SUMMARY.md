---
phase: 04-messaging-gateway
plan: 07
subsystem: infra
tags: [clicksend, sms, webhooks, compliance, spam-act, reconciliation, rls, ops]

requires:
  - phase: 04-messaging-gateway
    provides: "inbound webhook + STOP classification (04-01/04-02), routing sender + delivery receipts (04-03), reconcile sweep (04-04), email sender (04-05), console screens (04-06)"
provides:
  - "MSG-01 proven live end to end on the dedicated AU number: send -> delivery receipt -> reply -> STOP -> suppression -> cadence stop -> send gate closed"
  - "Research A3 answered empirically: ClickSend's automation engine evaluates EVERY matching rule, so its auto-opt-out does not swallow the STOP webhook"
  - "A fixed T-4-28 backstop: listInboundSms polls /v3/sms/history (direction='in') instead of the pull-queue /v3/sms/inbound that reads empty exactly when it is needed"
  - "A disarmed, documented activation switch — the number is recorded and the row is enabled=false until the first real client"
affects: [phase-05-review-console, phase-06-onboarding, phase-07-reporting]

actuals:
  tokens: 9000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Provider event endpoints are pull queues; the durable log is the resource to poll"
    - "A safety assertion should test the guarantee (enabled=false), not a proxy for it (row absent)"
    - "Multi-tenant visibility assertions ask membership, never a literal tenant id"

key-files:
  created: []
  modified:
    - src/core/messaging/clicksend-client.ts
    - tests/clicksend-sender.test.ts
    - tests/leak.test.ts
    - tests/routing-dispatch.test.ts
    - docs/external-registrations.md

key-decisions:
  - "A3 ANSWERED: both the ordinary reply and the STOP reached our webhook directly while ClickSend's own 'Opt-out contact' rule ALSO fired — their engine runs every matching rule, not the first"
  - "GET /v3/sms/inbound and /v3/sms/receipts are pull queues an automation rule drains; /v3/sms/history is the durable log. The T-4-28 backstop was reading the endpoint that is empty precisely BECAUSE a rule intercepted the message"
  - "The inbound backstop DROPS an undirected history row and counts it, reversing the usual keep-the-doubtful-row trade — that resource is half outbound"
  - "The global sms messaging_config row is DISARMED (enabled=false) after the proof, not left live: no real client exists while the test tenant is wired to a live ServiceM8 account holding two eligible quotes"
  - "The two test cadences were made inert rather than deleted — the inbound and ledger evidence rows point at cadence b7a0f041, and that correlation is the deliverable"
  - "A ClickSend inbound reply echoes our outbound custom_string (our send_ledger.id) — recorded as a stronger attribution key, NOT adopted, because changing the attribution key is architectural"

patterns-established:
  - "Endpoint choice is measured, not assumed: two candidate resources were queried over the same window before the backstop was pointed at one"
  - "Teardown preserves the evidence chain and removes the capability — inert beats deleted when rows are the proof"

requirements-completed: [MSG-01, MSG-04]

coverage:
  - id: D1
    description: "SMS sends from the dedicated AU virtual number with a delivery receipt recorded on the ledger row (MSG-01 send + DLR half)"
    requirement: "MSG-01"
    verification:
      - kind: e2e
        ref: "live: send_ledger 77433ea2 — sender=clicksend, outcome=sent, delivery_status=delivered, delivery_detail=201, delivered_at=2026-08-29T17:06:00Z"
        status: pass
      - kind: integration
        ref: "npm run test:remote -- tests/receipts.test.ts (real captured payloads)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A two-way reply lands as a threaded inbound_messages row and pauses the cadence (D-05)"
    requirement: "MSG-01"
    verification:
      - kind: e2e
        ref: "live: inbound_messages 1c13261e — attribution=threaded, matched_cadence_count=1; deployment log 'pause result paused'"
        status: pass
    human_judgment: false
  - id: D3
    description: "A real STOP from a handset produces suppressed_contacts rows on BOTH channels via our own pipeline, and stops the cadence"
    requirement: "MSG-01"
    verification:
      - kind: e2e
        ref: "live: inbound_messages 470b4aad (is_stop, threaded); 2 suppressed_contacts source=sms_stop; cadence b7a0f041 stopped(contact_suppressed); touches 2-5 skipped(suppressed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The send gate refuses a suppressed contact, including on a NEW quote (D-15)"
    verification:
      - kind: integration
        ref: "live probe: (tenant_id, channel, address) against the cadence's verbatim snapshot returns true on both sms and email"
        status: pass
      - kind: unit
        ref: "tests/cadence-dispatch.test.ts (dispatch suppression refusal)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every outbound message identifies the client business by name and offers an opt-out (MSG-04, Spam Act)"
    requirement: "MSG-04"
    verification:
      - kind: e2e
        ref: "live: body named 'Perth Sparks Electrical (Test)' and carried 'Reply STOP to opt out' — 144 chars, one GSM-7 segment, from +61491579212"
        status: pass
    human_judgment: false
  - id: D6
    description: "Research A3 answered empirically and recorded with its evidence"
    verification:
      - kind: other
        ref: "docs/external-registrations.md '2026-08-30 — A3, ANSWERED'; ClickSend Opt-Out List holds exactly the one handset while both messages reached our webhook"
        status: pass
    human_judgment: false
  - id: D7
    description: "The T-4-28 inbound backstop polls a resource that actually holds inbound messages"
    verification:
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#listInboundSms — the T-4-28 backstop reads /sms/history (3 tests)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-08-30
status: complete
---

# Phase 4 Plan 07: ClickSend Activation and the Live Two-Way Proof — Summary

**The first real SMS conversation completed end to end on `+61491579212` — sent, delivered, replied to, stopped, suppressed — and the same test caught the compliance backstop reading an endpoint that is empty exactly when it is needed.**

## Performance

- **Duration:** ~35 min (this continuation; the plan spanned several sessions)
- **Completed:** 2026-08-30
- **Tasks:** 3 of 3
- **Files modified:** 5

## Accomplishments

- **MSG-01 is complete, live, on the real number.** Every link in the chain is a row or a log line, not an inference: `send_ledger 77433ea2` (`sender=clicksend`, `outcome=sent`) → delivery receipt (`delivered`, `201`, `delivered_at`) → `inbound_messages 1c13261e` (`attribution=threaded`) with `pause result 'paused'` in the deployment log → `inbound_messages 470b4aad` (`is_stop`) → two `suppressed_contacts` rows (`source=sms_stop`, sms **and** email) → cadence `b7a0f041` `stopped(contact_suppressed)` → touches 2–5 `skipped(suppressed)`.
- **Research A3 is answered, and the answer is the good one.** Both the ordinary reply and the STOP reached our webhook directly, *while* ClickSend's own `Opt-out contact` rule also fired — their `Opt-Out List` now holds exactly the one handset, and it was empty before. ClickSend's automation engine evaluates **every** matching rule, not the first. That also disposes of the broader `Default rule` fear this log raised: silence on the whole inbound channel is not a real risk.
- **The backstop behind A3 was broken, and is now fixed.** `/v3/sms/inbound` returned `total: 0` over an explicit three-day window minutes after two real inbound messages arrived; `/v3/sms/history` held all four with `direction: "in"`. Both `/sms/inbound` and `/sms/receipts` are pull queues an automation rule drains. The nightly sweep's inbound replay was reading the one resource that is empty *because* a rule intercepted the message — the exact scenario it exists for.
- **MSG-04's live check passed**: the body named `Perth Sparks Electrical (Test)` and carried `Reply STOP to opt out`, in 144 characters and one GSM-7 segment.
- **The system is back to a safe resting state**: contact window restored, the contact's mobile restored by the ServiceM8 sync itself, zero live cadences, zero pending touches, and the sms config row disarmed with the number retained.

## Task Commits

1. **Task 1: IPND address + number purchase** (checkpoint) — verified in `3ebfd9b`
2. **Task 2: setup-clicksend.mjs, rules, config, cron** — `c788fac`, `eb01fcc`, `79a2776`
3. **Task 3: live two-way + STOP proof** — `3285bda`, `c47dd1d`, `fe7520c`, `ea66903`, then this continuation:
   - `e658ea1` (fix) — the STOP backstop reads `/sms/history`
   - `0ecd855` (docs) — A3 answered, teardown recorded, two tests corrected

## Files Created/Modified

- `src/core/messaging/clicksend-client.ts` — `listInboundSms` polls `/v3/sms/history` filtered on `direction === 'in'`; `listRowSchema` gains `direction`
- `tests/clicksend-sender.test.ts` — three tests pinning the endpoint, the direction filter, and the undirected-row rule
- `tests/leak.test.ts` — the cadence-table RLS assertion now asks membership instead of a literal tenant id
- `tests/routing-dispatch.test.ts` — the D-04 safety assertion now asks `enabled`, not row existence
- `docs/external-registrations.md` — the A3 answer with its evidence, the backstop finding, the cost datapoint, and the teardown record

## Decisions Made

**Disarm the sms `messaging_config` row rather than leave it live.** The plan allowed either and required the choice be recorded. Disarmed: there is no real client to serve, while the test tenant is connected to a live ServiceM8 account currently holding **two quotes with `status='Quote'` and `chase_eligibility='eligible'`**. With the row armed and the contact window restored to business hours, an unattended cadence could form with nobody watching. The recipients would be ACMA fiction numbers, so the exposure is billing and noise rather than a stranger being messaged — but D-04's whole point is that re-arming is one `UPDATE` and no deploy, so holding the switch off costs nothing.

**Make the test cadences inert rather than delete them.** The plan said tear down the test cadence. Both are `stopped`, every touch is terminal, and the contact is suppressed on both channels — nothing can send from them by three independent mechanisms. Deleting them would have destroyed the correlation the evidence chain hangs on: the `inbound_messages` and `send_ledger` rows point at cadence `b7a0f041`, and that chain is this plan's deliverable.

**Record the `custom_string` echo without acting on it.** ClickSend returns our outbound `custom_string` (our `send_ledger.id`) on the *inbound* reply — a strictly stronger attribution key than the sender's number, and one that would disambiguate the D-03 case of two tradies who quoted the same person. Changing the attribution key is architectural (Rule 4), so it is written down rather than done.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The T-4-28 inbound backstop polled an endpoint that is empty exactly when it is needed**

- **Found during:** Task 3, while answering A3 by querying what ClickSend actually holds
- **Issue:** `reconcile.ts`'s `replayInbound` called `GET /v3/sms/inbound`. Measured over an explicit three-day window minutes after the live test, that endpoint returned `total: 0` while `/v3/sms/history` held both inbound messages with `direction: "in"` and their bodies intact; `/v3/sms/receipts` was empty the same way. Both read as pull queues that an automation rule drains. The failure is circular: the poll exists to recover a STOP an automation rule intercepted, and it reads the resource that is blank *because* a rule intercepted it — returning `inboundReplayed: 0`, indistinguishable from "nothing was missed", on the one night it mattered. Had A3's answer gone the other way, the designed backstop would have failed silently behind it.
- **Fix:** `listInboundSms` now polls `/sms/history` and filters `direction === 'in'`. A row with no direction is dropped and counted rather than kept — the usual "keep the doubtful row" trade (D-03) reverses here, because this resource is half outbound and replaying our own follow-ups would put our own traffic on the operator's triage screen every sweep.
- **Files modified:** `src/core/messaging/clicksend-client.ts`, `tests/clicksend-sender.test.ts`
- **Verification:** three new tests pin the endpoint, the filter and the undirected-row rule; full `test:remote` green
- **Committed in:** `e658ea1`

**2. [Rule 3 — Blocking] Two remote tests asserted a world the live test had moved past**

- **Found during:** Task 3, the full `npm run test:remote` verification run (2 failures out of 1503)
- **Issue:** (a) `tests/routing-dispatch.test.ts` asserted the sms config row was **absent**, which was only ever a proxy for "sms is not armed" while the number was IPND-blocked; the row now exists, disarmed. (b) `tests/leak.test.ts` asserted every visible cadence row belonged to `seeded.tenantA`, assuming the operator belongs to exactly one tenant; the live test created a real tenant they genuinely *are* a member of, so RLS returned a row it was right to return. Confirmed not a leak by reading `tenant_members` directly.
- **Fix:** (a) assert `enabled` is false — the same guarantee, and it still fails the moment somebody arms the row, which is the alarm the test exists to raise. (b) assert the row's tenant is one the operator holds a membership for — the general form the tenants-visibility test above it already used, and strictly stronger than `not.toBe(tenantB)` would have been.
- **Files modified:** `tests/routing-dispatch.test.ts`, `tests/leak.test.ts`
- **Verification:** both suites green; full `test:remote` 69 files / 1503 tests pass
- **Committed in:** `0ecd855`

---

**Total deviations:** 2 auto-fixed (1 × Rule 1, 1 × Rule 3)
**Impact on plan:** No scope creep. The Rule 1 fix is the plan's own threat T-4-28 mitigation being made real rather than nominal — it was found *by* the live test the plan mandates. The Rule 3 fixes are assertions whose premise the plan's own activation invalidated.

## Issues Encountered

**The pause looked unrecorded and was not.** `cadences.pause_reason` reads NULL on `b7a0f041`, because `stopWhereLive` clears it deliberately ("paused, and also stopped" is a state with two answers to "why is nothing being sent"). The pause is observed in the deployment's runtime log — `pause result 'paused'` — ten seconds before the STOP. Reading the column alone would have produced a false negative on a D-05 guarantee that held.

**The DLR callback's wire transport is still unobserved.** The reasoning stands (a receipts rule stores no `webhook_type`, so ClickSend's form-encoded `post` default applies) and the route decodes both, but it is not confirmed: `tests/receipts.test.ts`'s payloads were copied from `/v3/sms/history` rows, not from a callback body, and the Vercel log window holding the real receipt had rolled off before it could be read. Recorded as unknown rather than quietly promoted to a finding; the first real client's first receipt closes it.

## Known Stubs

The touch body is still the Phase 3 placeholder — `[STUB touch 1] follow-up for quote <id> to <name>.` — with `complianceSuffix()` appending the business name and opt-out. This is intentional and scoped: LLM drafting in the client's voice is a later phase, and MSG-01 is about the pipe, not the prose. The compliance half of the body (identification + opt-out) is real and was verified live.

## User Setup Required

None outstanding. The number is purchased, the rules are pointed, the secrets agree between `.env.local` and Vercel, and the reconcile cron is applied and proven.

**One operator action before a real client is onboarded:** push `main` so commit `e658ea1` deploys — the corrected inbound backstop is committed but not yet running in production.

## Next Phase Readiness

The messaging gateway is proven and deliberately switched off. Arming it for the first real client is a single `UPDATE` on the global sms `messaging_config` row (or `setup-clicksend.mjs --activate`) — no code change, no redeploy, which was D-04's claim and is now a demonstrated fact.

Carried forward:

- **MSG-02 (email) remains Pending.** No client domain is verified at Resend, so `verify-email-pipe.mjs` still refuses at its first assertion. D-02 defines MSG-02 as the pipe proven by a real send; that proof has not been run.
- **Cost model input:** `message_price` is `0.0792` AUD per outbound segment, ~10% above the ~7.2c research estimate. Inbound is free.
- **Deploy `e658ea1`** before the first real client is armed.

---
*Phase: 04-messaging-gateway*
*Completed: 2026-08-30*

## Self-Check: PASSED

All 7 claimed files exist on disk; all 10 claimed commits resolve in `git log`.
Verification commands re-run at close: `npm run test:remote` (69 files, 1503 tests,
exit 0), `npx tsc --noEmit` (clean), `npm run lint` (clean), `npm test` (1163 pure
tests pass; the 28 remote files refuse at import by the WR-09 disposable-stack gate,
which is the designed behaviour of a bare `npm test`).
