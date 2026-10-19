---
phase: 04-messaging-gateway
plan: 02
subsystem: messaging
tags: [sms, webhook, clicksend, attribution, opt-out, spam-act, d-05, rls, zod]

requires:
  - phase: 04-messaging-gateway
    plan: 01
    provides: inbound_messages + insertInboundMessage, isStopMessage, suppressFromInbound, forAllTenants_cadencesByContactMobile, handleInboundSms's branch skeleton, the six Phase 4 env keys
  - phase: 03-cadence-engine
    provides: pauseForReply and its upgrade_unsupported gap, the guard-as-WHERE repository house style, dispatch's just-in-time suppression probe, the cadence transition matrix
provides:
  - POST /api/webhooks/clicksend/inbound — the live, token-authed, tolerant, uniformly-acknowledging inbound door
  - upgradePauseReason — the guarded repository write that closes D-05's carried-forward hole
  - pauseForReply result kind 'upgraded' (replaces 'upgrade_unsupported')
  - suppressBareContact — cadence-less suppression, the D-03 fan-out
  - forAllTenants_ids — the sixth cross-tenant crossing, ids only
  - handleInboundSms complete over all eight branches; no record-only paths remain
affects: [04-03 clicksend sender, 04-04 dlr + reconcile, 04-06 triage console, 04-07 provider wiring, 05 inbound email, 07 attribution]

actuals:
  tokens: 84847
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A guard expressed as a WHERE clause must be TOTAL over the states the schema permits: a `= $from` predicate silently skips the NULL row, so the guard takes a nullable `from` and renders `IS NULL` — otherwise the one state nothing writes is the one nothing can fix"
    - "A result kind states what IS TRUE of the row, not merely whether this call wrote: an idempotent repeat at a reply-paused cadence is `paused`, because `not_active` is the opposite claim and a caller records the kind"
    - "An unsigned webhook is survivable when the CLOSURE of its effects is survivable — suppress/stop/pause/upgrade/record and nothing else — so the argument for a URL token is made in the route header by enumerating what a forgery can do"
    - "Uniform 200 bodies are an access-control mechanism, not politeness: a body that distinguished threaded from unmatched turns the endpoint into an oracle that sorts phone numbers into 'being chased by a client of this service' and 'not'"
    - "Ambiguity resolves toward the survivable failure: an ambiguous STOP acts on every candidate (over-suppression) while an ambiguous reply acts on none (no pause) — the two look inconsistent and are the same rule"
    - "A test that exercises a cross-tenant fan-out on a production-shared database must tear down BY the fanned-out key, not by tenant, and must use addresses from a reserved block so the delete can never reach a real one"

key-files:
  created:
    - src/app/api/webhooks/clicksend/inbound/route.ts
    - tests/pause-upgrade.test.ts
    - tests/inbound-threading.test.ts
    - tests/clicksend-inbound-route.test.ts
  modified:
    - src/core/messaging/inbound.ts
    - src/core/cadence/controls.ts
    - src/db/repository/for-tenant.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/core/shared/env.ts
    - docs/env-vars.md
    - tests/cadence-controls.test.ts
    - tests/inbound-stop.test.ts
    - tests/sync-upsert.test.ts
    - tests/lint-ban.test.ts

key-decisions:
  - "The pause upgrade got its OWN guarded statement rather than a widened `pauseWhereActive`: that method pauses only from `active` precisely so re-pausing can never downgrade a `customer_reply` pause to a `client_paused` one, and widening it to perform the upgrade would have deleted the guard the whole D-05 asymmetry rests on"
  - "`upgradePauseReason`'s `from` is NULLABLE, against the plan's pinned signature. transitions.ts note 6 describes a `paused` row with no reason — the schema permits it, no writer produces it, and the matrix still prescribes the move. A `WHERE pause_reason = $from` guard would skip it in silence, leaving a pause nothing can explain and only an operator can lift"
  - "The upgrade target reason is read from the `cadenceTransition` outcome, never typed as a literal: the matrix already answered which reason a `customer_reply` lands, and a second answer written in a Phase 4 file is how the two drift"
  - "`pauseForReply` reports an idempotent repeat as `paused`, not `not_active`. Both describe the same absence of a write, but they are opposite claims about the row — and `handleInboundSms` records the kind, so the misnomer would reach the triage screen as 'we did not pause' beside a visibly paused cadence"
  - "The ambiguous STOP now acts on EVERY candidate, reversing 04-01's 'an ambiguous STOP writes nothing'. D-03 is explicit that over-suppression is the compliant failure mode; what changed is not the risk assessment but that the phase context decided it, and suppressing two clients' contacts costs a follow-up while suppressing neither costs a Spam Act breach"
  - "The ambiguous REPLY still acts on none, and the asymmetry is the point: a pause is scheduling, not compliance, so pausing on an ambiguous match hands anyone who can guess a phone number a lever that stops two clients' chases at once (T-4-06)"
  - "Order independence is by CONSTRUCTION — every candidate is processed with no early return — and proven by running the same scenario twice with the candidate list arriving in opposite tenant orders, asserted reversed before either STOP is sent"
  - "`suppressBareContact` lives in controls.ts rather than inline at the call site the plan named: every suppression write in this codebase is in that file because 'the second expression of stop chasing this person is the one that gets a condition wrong', and inlining would have given inbound.ts its own tenant-scoped write surface plus a second spelling of the reason string"
  - "The route reads `request.text()` and parses JSON itself, so a non-JSON body still has bytes to store in `raw_payload` — `request.json()` throws the payload away on its way to the exception, which is exactly the case that column exists for"
  - "An unparseable payload is answered 200, not 4xx: ClickSend re-delivers on an error for up to 72h and throttles the rule after repeated failures, so a shape change answered honestly would degrade delivery of every other customer's replies too"
  - "The four 200 bodies are compared byte-for-byte in the test rather than each asserted to be 200 — the guarantee is indistinguishability, and four separate `toBe(200)` assertions would pass on an endpoint that leaked the attribution in the body"

patterns-established:
  - "Log-line safety is asserted by PINNING the set of interpolated expressions, not by scanning for banned words: a deny-list catches only the spellings somebody thought of, and the failure mode is a future `${input.from}` in a debug line"
  - "Cross-tenant tripwires are widened WITH the argument written in place, in the same commit — three fired this plan (export-name set, barrel key set, and a new select-list containment pin added for the export that widened them)"
  - "Phone numbers in remote suites come from the ACMA fiction block `0491 570 1xx`, so a fan-out that writes across every tenant and a teardown that deletes by address can never touch a real person's row"

requirements-completed: [MSG-04]

coverage:
  - id: D8
    description: "A non-STOP reply matching exactly ONE live cadence threads to its (tenant, quote, cadence), stores an inbound row, and pauses the cadence via pauseForReply"
    requirement: "MSG-04"
    verification:
      - kind: integration
        ref: "tests/inbound-threading.test.ts#threads a unique reply, PAUSES its cadence, and records the pause result"
        status: pass
    human_judgment: false
  - id: D9
    description: "Two or more live cadences matching one from-number produce attribution ambiguous, NO pause on any cadence, and a triage row carrying both candidate tenant ids"
    requirement: "MSG-04"
    verification:
      - kind: integration
        ref: "tests/inbound-threading.test.ts#pauses NOTHING when a reply matches two clients (T-4-06)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Zero matches produce an unmatched inbound row and — when the body is a STOP — bare-mobile suppression across every tenant, probe-visible to dispatch's just-in-time gate"
    requirement: "MSG-04"
    verification:
      - kind: integration
        ref: "tests/inbound-threading.test.ts#suppresses the bare mobile for EVERY client when a STOP matches nothing (D-03)"
        status: pass
      - kind: integration
        ref: "tests/inbound-threading.test.ts#makes a LATER cadence for that number refuse at the send gate"
        status: pass
    human_judgment: false
  - id: D11
    description: "A STOP matching MULTIPLE tenants' cadences suppresses the contact for ALL candidate tenants and stops each matched cadence, and the result is identical whatever order candidates return in"
    requirement: "MSG-04"
    verification:
      - kind: integration
        ref: "tests/inbound-threading.test.ts#honours an ambiguous STOP for EVERY candidate, in either arrival order (D-03)"
        status: pass
    human_judgment: false
  - id: D12
    description: "paused(client_paused) + customer_reply upgrades the pause reason in one guarded write, and a subsequent CLIENT resume does not revive the cadence"
    requirement: "MSG-04"
    verification:
      - kind: integration
        ref: "tests/pause-upgrade.test.ts#THE D-05 ASSERTION: a client resume does NOT revive the upgraded cadence"
        status: pass
      - kind: integration
        ref: "tests/pause-upgrade.test.ts#changes ZERO rows when the cadence is not paused for the expected reason"
        status: pass
    human_judgment: false
  - id: D13
    description: "The webhook route 401s a wrong, absent or truncated token via constant-time compare, 200-acknowledges every parseable payload uniformly, and records unknown shapes as dead_letter rows with raw_payload"
    requirement: "MSG-04"
    verification:
      - kind: unit
        ref: "tests/clicksend-inbound-route.test.ts#inbound webhook authentication (5 blocks)"
        status: pass
      - kind: unit
        ref: "tests/clicksend-inbound-route.test.ts#gives the SAME 200 body on every path — no attribution oracle (T-4-08)"
        status: pass
      - kind: unit
        ref: "tests/clicksend-inbound-route.test.ts#records a NON-JSON body as a dead letter and still answers 200"
        status: pass
    human_judgment: false
  - id: D14
    description: "No inbound code path interpolates a phone number, a message body, an address or the webhook token into a log line"
    verification:
      - kind: unit
        ref: "tests/inbound-threading.test.ts#interpolates ONLY ids and counts into its log lines"
        status: pass
      - kind: unit
        ref: "tests/clicksend-inbound-route.test.ts#interpolates ONLY ids, result kinds and lengths into its logs (T-4-08)"
        status: pass
    human_judgment: false
  - id: D15
    description: "The deployed route is reachable from ClickSend with the production token — the rule's callback URL must carry ?token=<CLICKSEND_WEBHOOK_SECRET>"
    verification:
      - kind: other
        ref: "Provider wiring is plan 04-07's; nothing in this repo can observe a ClickSend rule"
        status: deferred
    human_judgment: true
    rationale: "The route is proven in isolation and against the hosted database through handleInboundSms. Whether ClickSend actually POSTs to it, with the token in the query string and a payload this schema accepts, can only be confirmed by sending a real SMS to the dedicated number — which is blocked on the IPND business-address requirement and is 04-07's scope."

duration: 55min
completed: 2026-08-29
status: complete
---

# Phase 4 Plan 02: Inbound Attribution, Pause-on-Reply and the Webhook Door Summary

**Real ClickSend traffic now has a live, authenticated door to arrive at, and behind it every inbound SMS lands in exactly one honest bucket — threaded, ambiguous, unmatched or dead-letter — with a pause only on a unique match, suppression everywhere an opt-out plausibly applies, and the D-05 hole that let a client's own resume restart a live conversation structurally closed.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-08-29T10:45:00Z
- **Completed:** 2026-08-29T11:40:00Z
- **Tasks:** 3
- **Files modified:** 15 (4 created, 11 modified)
- **Full remote suite:** 55 files, 1173 tests, green against the hosted Sydney database; production crons paused and re-armed cleanly

## Accomplishments

- **D-05's carried-forward hole is closed, and the proof is the resume, not the column.** `upgradePauseReason` performs the write the matrix has prescribed since Phase 3 and no repository method could make. The assertion that matters is not `pause_reason = 'customer_reply'` — it is `resumeClient` (the same function the console's client-level un-pause calls) running across the upgraded cadence and leaving it paused. Before this, that resume revived it.
- **Every branch of `handleInboundSms` is real.** 04-01 left seven of eight arms recording and doing nothing; the header said so, and the header now carries the full decision table instead. A unique reply pauses. An ambiguous reply pauses nothing. An unmatched STOP suppresses the bare mobile for every client. An ambiguous STOP honours all candidates.
- **Order independence is proven, not asserted.** The suite seeds the same scenario twice with the two tenants' cadences created in opposite orders, asserts `forAllTenants_cadencesByContactMobile` really does return them reversed, then requires the two end states to be identical. A handler that returned on its first candidate reports one client instead of two and fails.
- **The unmatched-STOP fan-out is probe-visible.** After the bare-mobile suppression, a brand-new cadence for that number with a touch approved afterwards is refused by a real `dispatchDueTouches` tick with reason `suppressed` — the only assertion that distinguishes "a suppression row exists" from "a suppression written in the spelling dispatch asks about".
- **The webhook door is deployable.** Token compared in constant time before a byte of the body is read; tolerant zod that hard-requires only `from` and `body`; four structurally different outcomes producing one byte-identical `{"received":true}`; unreadable, non-JSON and unknown-shape payloads all becoming `dead_letter` rows with `raw_payload` and still answering 200.
- **No migration, as the plan required.** The upgrade introduces no new `CADENCE_PAUSE_REASONS` member, so `src/db/migrations/` is untouched and the journal-ordering trap 04-01 hit could not recur here.
- **The hosted database was left exactly as found.** Zero `inbound_messages` rows, zero test suppression rows across any tenant — verified directly after the full remote run, which matters more than usual this plan because D-03's fan-out writes into tenants the suite does not own.

## Task Commits

1. **Task 1 (RED): the failing pause-upgrade suite** — `c2ead80` (test)
2. **Task 1 (GREEN): `upgradePauseReason` + the `upgraded` branch** — `c3ef493` (feat)
3. **Task 2: full attribution — unique / ambiguous / unmatched, order-independent** — `cbfea4a` (feat)
4. **Task 3: the ClickSend inbound webhook route** — `d8ec7a3` (feat)

_Task 1 carried `tdd="true"`; Task 2 also did, but its RED could not be observed separately — see Deviations._

## Files Created/Modified

**Created**
- `src/app/api/webhooks/clicksend/inbound/route.ts` — token auth, tolerant `z.looseObject`, dead-letter path, one `received()` response, 8k payload cap.
- `tests/pause-upgrade.test.ts` — 9 blocks, including the repository guard driven directly at an active, a terminal and an already-reply-paused cadence.
- `tests/inbound-threading.test.ts` — 8 blocks: the six behaviour rows, the reversed-order STOP, and the pinned-interpolation log assertion.
- `tests/clicksend-inbound-route.test.ts` — 22 blocks, pure (no database).

**Modified**
- `src/core/messaging/inbound.ts` — rewritten. The header now carries the decision table and the argument for the two opposite-pointing asymmetries; three private handlers replace the single-match special case.
- `src/core/cadence/controls.ts` — `pauseForReply`'s upgrade branch, the `upgraded`/`paused` result union, and `suppressBareContact`.
- `src/db/repository/for-tenant.ts` — `upgradePauseReason` in the cadences namespace, `isNull` imported for its nullable guard.
- `src/db/repository/for-all-tenants.ts` — `forAllTenants_ids`, the sixth crossing.
- `src/db/repository/index.ts` — one new barrel export on one documented line.
- `src/core/shared/env.ts`, `docs/env-vars.md` — the webhook secret is a URL token, not a bearer header (see Deviations).
- `tests/cadence-controls.test.ts`, `tests/inbound-stop.test.ts`, `tests/sync-upsert.test.ts`, `tests/lint-ban.test.ts` — assertions updated or widened, each with the argument written in place.

## Decisions Made

See `key-decisions` in the frontmatter. The three worth reading twice:

1. **The upgrade is a separate statement, not a widened one.** `pauseWhereActive` refuses anything that is not `active` for a specific reason: re-pausing an already-paused cadence would overwrite `customer_reply` with `client_paused` and quietly convert a pause only a human may lift into one a client can. Making it perform the upgrade would have removed exactly that guard. So the upgrade gets its own WHERE clause, narrower than the one it sits beside — `status = 'paused' AND pause_reason IS NOT DISTINCT FROM $from` — and the reason predicate is what stops a future caller downgrading through it. The test drives that predicate directly at an already-reply-paused cadence and requires zero rows.

2. **The two ambiguity answers point in opposite directions, on purpose.** An ambiguous STOP acts on every candidate; an ambiguous reply acts on none. Both choose the survivable failure. Suppressing a client's contact who did not ask costs that client one follow-up. Not suppressing costs a human who asked to be left alone being chased anyway. Conversely, pausing on an ambiguous match is a lever anyone who can guess a phone number could pull to stop two clients' chases at once — and a pause is scheduling, not compliance, so it can afford to require certainty. This reverses 04-01's "an ambiguous STOP writes nothing", which was correct given what 04-01 knew and superseded by D-03 in the phase context.

3. **Uniform 200s are access control.** The route's authentication is a token in a URL, so "somebody else holds it" is a state to design for rather than exclude. What makes that survivable is (a) the closure of effects — suppress, stop, pause, upgrade, record, and provably nothing that sends — and (b) that every parseable request gets the same answer. A body distinguishing "threaded" from "unmatched" would let a token holder sort a list of phone numbers into "currently being chased by a client of this service" and "not", which is a customer list assembled one 200 at a time. The test compares four 200 bodies as strings rather than asserting each is 200, because only the former can fail on that leak.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `upgradePauseReason` takes a NULLABLE `from`, against the plan's pinned signature**
- **Found during:** Task 1
- **Issue:** The plan pins `change: { from: CadencePauseReason; to: CadencePauseReason }`. But `transitions.ts` note 6 describes a `paused` row carrying NO reason — a state the schema permits, no writer produces, and the matrix answers anyway (`customer_reply` "should record the reason it now knows"). With a non-nullable `from`, `pauseForReply` would have had nothing to call for that row and would have reported `not_active` for a cadence the matrix says should move. The failure mode is a pause with no recorded reason that a client resume cannot lift and a reply cannot label — permanently stuck, invisible, and reachable only by an operator who happens to look.
- **Fix:** `from: CadencePauseReason | null`, rendered as `isNull(cadences.pauseReason)` rather than `eq(col, null)` — drizzle renders the latter as `= NULL`, which matches nothing, so the row would have been skipped in silence by the very guard added to reach it.
- **Verification:** `tests/pause-upgrade.test.ts` seeds a reasonless pause and asserts `upgraded`.
- **Committed in:** `c3ef493`

**2. [Rule 2 - Missing Critical] `pauseForReply` reports the idempotent repeat as `paused`, which required editing an existing assertion the plan said would still pass**
- **Found during:** Task 1
- **Issue:** The plan's behaviour table says `paused(customer_reply) + pauseForReply → 'paused'` (idempotent), while its acceptance criteria say `tests/cadence-controls.test.ts` still passes. Those conflict: that file asserted `{kind: 'not_active', status: 'paused'}` for exactly this row. The criterion cannot have meant "unchanged" in any case, since removing the `upgrade_unsupported` union member forces an edit to the block below it.
- **Fix:** Implemented the plan's table. The argument for it is not cosmetic: `handleInboundSms` now records the pause kind on its result, and `not_active` means "there was nothing to stand down" — the opposite claim from the row it would have described. Updated the existing block with that reasoning written in place rather than silently re-baselined.
- **Verification:** `tests/cadence-controls.test.ts` — 14 tests green remotely, including the unregressed active path.
- **Committed in:** `c3ef493`

**3. [Structural, Rule 2] `suppressBareContact` was placed in `controls.ts`, not inlined in `inbound.ts` as the plan's action text prescribed**
- **Found during:** Task 2
- **Issue:** The plan says to call `forTenant(tenantId).suppression.insertMany([{ …, reason: 'customer texted STOP (unmatched inbound)' }])` from `inbound.ts`. That would have (a) given `inbound.ts` a tenant-scoped write surface it otherwise does not have, and (b) introduced a second spelling of the suppression reason, beside the `INBOUND_SUPPRESSION_REASONS` map that exists to keep one. `controls.ts`'s own header states the rule this breaks: "the second expression of 'stop chasing this person' is the one that gets a condition wrong, and the failure is a message going out after somebody asked us to stop."
- **Fix:** Exported `suppressBareContact(tenantIds, {channel, address}, source)` from `controls.ts`, deriving the reason from the shared map plus the one fact that distinguishes it (no live cadence matched). `inbound.ts` still imports no repository write.
- **Verification:** `tests/inbound-threading.test.ts` asserts one row per tenant with `source: 'sms_stop'`; the full remote suite is green.
- **Committed in:** `cbfea4a`

**4. [Rule 2 - Missing Critical] The route reads `request.text()`, and caps what it stores**
- **Found during:** Task 3
- **Issue:** Two problems with the prescribed `request.json()` inside try/catch. First, it discards the bytes on the way to the exception — so the `raw_payload` column, whose entire purpose is the non-JSON case, would have been written empty for exactly that case. Second, nothing bounded what a token holder could store: `raw_payload` is jsonb on a table the operator's triage screen reads, and the size of anything written there was the caller's choice.
- **Fix:** `await request.text()` (itself wrapped, for an aborted stream), then `JSON.parse` locally. Non-JSON bodies are stored as `{ unparseable_body: <first 8k> }`; valid JSON of an unknown shape is stored verbatim unless the raw form exceeds 8k, in which case `{ oversized_payload: <first 8k> }`.
- **Verification:** `tests/clicksend-inbound-route.test.ts` — the non-JSON, unknown-shape and 20k-payload blocks.
- **Committed in:** `d8ec7a3`

**5. [Rule 1 - Bug] `CLICKSEND_WEBHOOK_SECRET` was documented as a Bearer header, which it cannot be**
- **Found during:** Task 3
- **Issue:** `env.ts` and `docs/env-vars.md` both called it "bearer for the ClickSend inbound-SMS callback". ClickSend's inbound rules POST to a URL we configure and offer no way to set request headers, so the secret has to travel as `?token=…`. The consequence of leaving it wrong is not cosmetic: in 04-07 the operator configures that rule from these docs and would build a callback URL with no token in it, producing a 401 on every real customer reply — including STOPs.
- **Fix:** Corrected both, and recorded in the same place why a query token is acceptable here (it is its own secret, and the closure of effects behind it is fail-safe).
- **Committed in:** `d8ec7a3`

**6. [Rule 3 - Blocking] A third source-guarantee tripwire fired that the plan did not anticipate**
- **Found during:** Task 2 (remote regression)
- **Issue:** The plan foresaw widening `tests/sync-upsert.test.ts`'s cross-tenant export set. `tests/lint-ban.test.ts` independently pins the exact key set of the repository barrel, and also failed on `forAllTenants_ids`. Both are the tripwires working — a sixth cross-tenant crossing must be a decision somebody typed.
- **Fix:** Widened both with the D-03 argument written in place, and added a NEW containment assertion the file did not previously need: `forAllTenants_ids` is the only accessor here with no tenant scope AND no filter of any kind, so its select list is pinned to `{ id: tenants.id }` — adding `tenants.name` "for a nicer log line" is now a test failure rather than a cross-tenant read of the client list.
- **Verification:** `tests/sync-upsert.test.ts` and `tests/lint-ban.test.ts` green remotely.
- **Committed in:** `cbfea4a`

**7. [Rule 2 - Missing Critical] The D-03 fan-out writes into tenants the tests do not own, on a production-shared database**
- **Found during:** Task 2
- **Issue:** The unmatched-STOP path suppresses a bare mobile for EVERY tenant, by design. On the hosted Sydney stack that includes the long-lived seed tenant, which `teardownTenants` cannot reach — so every run would have left a permanent suppression row behind, in a table with no un-suppress path anywhere in the codebase. `tests/inbound-stop.test.ts`'s repeat-STOP block (written in 04-01, before the branch did anything) takes exactly this path and would have leaked one row per run.
- **Fix:** Both suites now delete suppression rows BY ADDRESS across all tenants in `afterAll`, and every number `tests/inbound-threading.test.ts` uses is from the `0491 570 1xx` block ACMA reserves for fiction, so neither the fan-out nor the delete can reach a real person's row. `tests/inbound-stop.test.ts`'s block was updated to assert the fan-out rather than describe a gap.
- **Verification:** Direct query after the full remote run — `suppressed_contacts` holds only the two pre-existing orphan rows it held before, and `inbound_messages` is empty.
- **Committed in:** `cbfea4a`

### Process deviation

**8. Task 2's TDD RED was not observed as a separate commit**
- Task 2 carried `tdd="true"`. Its behaviour is spread across three branches of one function plus a new repository export, and the test file cannot compile at all until `forAllTenants_ids` and the widened result union exist — so a RED commit would have been a file that fails to typecheck rather than a test that fails an assertion, which is a weaker signal than Task 1's. The implementation and its suite were committed together. Task 1, where a genuine assertion-level RED was available, kept the two-commit shape and it is in the log (`c2ead80` → `c3ef493`).

---

**Total deviations:** 7 auto-fixed (1 bug, 1 blocking tripwire, 5 missing-critical/structural), 1 process deviation.
**Impact on plan:** No scope creep. Deviations 4 and 7 are the two that would have shipped something wrong — an empty `raw_payload` on precisely the payloads it exists for, and a test suite permanently suppressing seeded numbers on the production database.

## Issues Encountered

- **`npm test` (pure) now reports 25 refusing integration files, up from 23.** That is the WR-09 guard working on the two new remote suites, not a regression. 862 pure tests pass; the refusing files run under `npm run test:remote`.
- **The cross-session `0025` collision flagged in 04-01 is unchanged.** This plan generated no migration (the pause-reason vocabulary is unmodified), so nothing was added to the journal and nothing was resolved. The concurrent worktree's `0025_remote_test_lease.sql` is still applied to the hosted database and absent from `main`'s journal; that renumbering still needs a human at merge time.
- **Nothing yet POSTs to the new route.** ClickSend is not wired to it — that is 04-07, and it remains blocked behind the dedicated AU number, which is blocked on the IPND business-address requirement. The route is exercised directly with `Request` objects and the core it calls is exercised against the hosted database, so the untested seam is exactly one: whether ClickSend's real payload satisfies this schema. The `dead_letter` path exists because that seam cannot be closed from here.

## User Setup Required

Nothing new. `CLICKSEND_WEBHOOK_SECRET` was set by the operator in 04-01 (Vercel Production and local `.env.local`) and this plan is its first consumer.

**One thing to carry into 04-07:** the ClickSend inbound rule's callback URL must be
`https://<host>/api/webhooks/clicksend/inbound?token=<CLICKSEND_WEBHOOK_SECRET>`.
The token is a query parameter, not a header — ClickSend cannot send one. A rule configured without it 401s every customer reply, silently, including STOPs.

## Next Phase Readiness

**Ready for the rest of Phase 4:**
- `dead_letter` and `raw_payload` now have their first writer, so 04-06's triage surface has all four attributions to render.
- `findInboundByProviderMessageId` is still unused — 04-04's reconciliation is its first caller, and the route now populates `provider_message_id` from ClickSend's `message_id` when it sends one.
- `suppressBareContact` is written to be the shared entry point for 04-05's email unsubscribe (`email_unsubscribe`) and 04-04's `provider_opt_out`: both are cadence-less suppressions of a bare address, which is exactly its shape. Neither should write its own.
- `INBOUND_SUPPRESSION_SOURCES` still has two arms with no callers, unchanged and waiting.

**What 04-06 will need that does not exist yet:** a read path over `inbound_messages` for the triage queue. Nothing in `src/db/repository/inbound-messages.ts` lists rows — the two accessors there are an insert and a provider-id lookup.

**Carried blockers unchanged:** the IPND business-address dependency still blocks the AU dedicated number, and the ServiceM8 partner App ID/Secret is still unconfirmed.

---
*Phase: 04-messaging-gateway*
*Completed: 2026-08-29*

## Self-Check: PASSED

All 4 source/test artifacts and the SUMMARY exist on disk; all 4 task commits
(`c2ead80`, `c3ef493`, `cbfea4a`, `d8ec7a3`) are present in git history.
