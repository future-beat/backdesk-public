---
phase: 04-messaging-gateway
plan: 03
subsystem: messaging
tags: [sms, clicksend, provider, routing, config, rls, drizzle, d-04, d-06, attribution]

requires:
  - phase: 04-messaging-gateway
    plan: 01
    provides: the six Phase 4 env keys (CLICKSEND_USERNAME/API_KEY optional by design), the evidence-table RLS/grant template, the journal-vs-database migration trap and its fix
  - phase: 04-messaging-gateway
    plan: 02
    provides: serialization of remote runs against the shared hosted DB; the ACMA `0491 570 1xx` fixture-number rule; the pure/remote suite split precedent
  - phase: 03-cadence-engine
    provides: the untouchable TouchSender contract (D-13), StubSender and the 'stub'/'stub_sent' structural distinction, the dispatch claim-before-send ordering, performSends' outcome mapping
provides:
  - messaging_config — the D-04 activation switch (global default row + per-tenant overrides, UNIQUE NULLS NOT DISTINCT) + migration 0026
  - getChannelConfig / listChannelConfig / upsertChannelConfig — override-then-default resolution in one query
  - send_ledger delivery_status / delivery_detail / delivered_at / delivery_updated_at + DELIVERY_STATUSES
  - sendSms + SendSmsResult — the thin typed ClickSend REST client (direct fetch, no SDK)
  - ClickSendSender — TouchSender over ClickSend, provider 'clicksend', non-throwing
  - RoutingSender + buildRoutingSender + chooseSmsSender — the channel composite and its activation gate
  - ChannelAwareTouchSender + isChannelAware — the claim-time provider resolution seam in dispatch.ts
affects: [04-04 dlr + reconcile, 04-05 resend email arm, 04-06 messaging console, 04-07 provider wiring + activation, 07 attribution]

actuals:
  tokens: 45595
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "A configuration table whose 'unset' state is a NULL-keyed global row needs UNIQUE ... NULLS NOT DISTINCT, or Postgres permits unlimited defaults and the read returns whichever the planner picked — an arbitrary choice with no error anywhere"
    - "When a value is written BEFORE the work it describes, and the work is now delegated, the write must resolve through the SAME rule the delegation will use — otherwise the record names something that never ran"
    - "An activation gate is a PURE function over (config, credentials) so its cases can be enumerated in a test that cannot arm production; the I/O wrapper around it is then trivial enough to cover with one read-only remote assertion"
    - "A boundary that classifies a third party's status strings sanitizes them to a bounded code shape before returning: the field is documented as a code on LOW-confidence research, and if it turns out to be prose the cap is what stops a customer's number reaching a log"

key-files:
  created:
    - src/db/schema/messaging-config.ts
    - src/db/repository/messaging-config.ts
    - src/db/migrations/0026_messaging_config_delivery.sql
    - src/core/messaging/clicksend-client.ts
    - src/core/messaging/clicksend-sender.ts
    - src/core/messaging/routing-sender.ts
    - tests/clicksend-sender.test.ts
    - tests/routing-sender.test.ts
    - tests/routing-dispatch.test.ts
  modified:
    - src/db/schema/send-ledger.ts
    - src/db/schema/index.ts
    - src/db/repository/index.ts
    - src/core/cadence/dispatch.ts
    - src/app/api/internal/cadence-tick/route.ts
    - tests/rls-coverage.test.ts
    - tests/lint-ban.test.ts
    - tests/cadence-tick-route.test.ts

key-decisions:
  - "The claim resolves the ledger's `sender` through `providerFor(touch.channel)`, not `context.sender.provider` — the column Phase 7 excludes stub rows by would otherwise have read 'routing', a provider that does not exist, on every row written from this plan forward"
  - "`providerFor` and `send` both go through one private `delegateFor`: two rules that must never disagree are safer as one rule asked twice, and here the disagreement would be a ledger row naming one provider while the message left through another"
  - "`ChannelAwareTouchSender` is a STRUCTURAL guard (`typeof sender.providerFor === 'function'`), not a nominal one, so StubSender and every existing test sender keep working with no edit — the alternative, a sender-per-channel map in DispatchOptions, would have moved the routing rule into dispatch and given D-06's one-sender surface a second copy of it"
  - "`nullsNotDistinct()` exists only on drizzle-orm 0.45.2's UNIQUE CONSTRAINT builder, not the index builder — the constraint is the same object underneath (Postgres implements it AS a unique index) and ON CONFLICT infers it identically; naming an arbiter is safe here, unlike `cadences.create`, because this table has exactly one unique index"
  - "A per-tenant `messaging_config` row with `enabled = false` returns null from `resolveSmsFrom` rather than falling back to the global number: an explicit per-client disable means stop, not 'use the default instead' — without it, turning one client off would mean flipping the global row and stopping all fifteen"
  - "The activation gate is a pure function `chooseSmsSender(config, creds, fallback)` precisely so its five refusal cases can be enumerated WITHOUT writing an enabled sms row to a production-shared database — that row is the switch that arms real messaging for every client with no deploy"
  - "The ClickSend response parse is TOLERANT (loose zod, hard-requiring only what is read): the payload shape is LOW-confidence research, and a strict schema would report 'failed' for a message that was in fact delivered — the one error direction whose obvious follow-up is a human sending it again"
  - "Opt-out detection is a tolerant `OPT` substring against a normalized code, not equality with a documented constant: a false negative loses a suppression a customer asked for (Spam Act), a false positive costs one follow-up — D-03's trade, applied at the provider boundary"
  - "Provider status strings are reduced to a bounded 48-char uppercase token before becoming a `reason`: the field is documented as a code, that documentation is the least-confident part of the research, and the value flows into the ledger, the operator's screen and a log line"
  - "A delivery receipt NEVER writes `outcome`. `outcome` answers 'did the provider accept it from us', `delivery_status` answers 'did the carrier reach the handset' — folding an undelivered receipt into 'failed' invites the retry that messages a customer twice"
  - "The tick route builds the routing sender PER REQUEST, never at module scope: an activation is a row flip that the next tick must observe, and a module-scope sender would hold whatever configuration was current when Vercel last cold-started"

patterns-established:
  - "Pure and remote halves of one plan's behaviour live in separate suites (routing-sender vs routing-dispatch), because WR-09 refuses any file that reaches for hosted credentials at module scope — the same split 04-02 made between its route and threading suites"
  - "A migration's journal stamp is checked against the DATABASE's applied head, not only against the journal, and the check is written into the migration header — the 04-01 trap is invisible to any journal-internal guard"
  - "Suites that write to a production-shared config table pick the provably inert combination (a channel nothing reads yet, enabled false, no address), guard on the row not already existing, and delete BY ID"

requirements-completed: []

coverage:
  - id: D16
    description: "ClickSendSender maps API success, per-message error, non-2xx and thrown network failure to the SendOutcome union without ever throwing, with custom_string = ledgerId and the returned message_id as providerMessageId"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#ClickSendSender — the outcome union (7 blocks incl. the 5-row HTTP matrix)"
        status: pass
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#sends custom_string = ledgerId, and the resolved from-number"
        status: pass
    human_judgment: false
  - id: D17
    description: "An empty or whitespace-only body returns failed('empty_body') with NO HTTP call — a blank SMS never reaches a customer"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#refuses a whitespace-only body (%j) with NO http call"
        status: pass
    human_judgment: false
  - id: D18
    description: "request.body is transmitted verbatim: a 220-character body and a unicode/emoji body both appear byte-identical in the provider payload"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#transmits a 220-character body byte-identical (no segment truncation)"
        status: pass
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#transmits a unicode/emoji body byte-identical (no charset transformation)"
        status: pass
    human_judgment: false
  - id: D19
    description: "Dispatch keeps ONE sender: the routing composite delegates by request.channel and both the CLAIMED send_ledger.sender and the outcome provider record the DELEGATE's name, never the composite's (D-06, T-4-11)"
    requirement: "MSG-01"
    verification:
      - kind: integration
        ref: "tests/routing-dispatch.test.ts#claims the ledger under the DELEGATE name, never the composite (T-4-11)"
        status: pass
      - kind: unit
        ref: "tests/routing-sender.test.ts#delegates by channel and returns the delegate outcome UNCHANGED"
        status: pass
    human_judgment: false
  - id: D20
    description: "With the global sms config row absent or disabled, production dispatch behavior is byte-identical to Phase 3 (stub delegate) — activation is a config-row flip, not a deploy (D-04)"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/routing-sender.test.ts#chooseSmsSender — the D-04 activation gate (5 refusal cases + the one accept)"
        status: pass
      - kind: integration
        ref: "tests/routing-dispatch.test.ts#leaves the sms delegate on the stub while no sms config row exists (D-04)"
        status: pass
    human_judgment: false
  - id: D21
    description: "messaging_config exists on the hosted DB behind two-arm RLS, read-only to authenticated, with the NULLS NOT DISTINCT arbiter that makes exactly one global row per channel possible"
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#admits the global messaging_config row to the operator ONLY (D-04)"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#keeps exactly one global row per channel possible (D-04, NULLS NOT DISTINCT)"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#grants exactly the documented privileges and nothing inherited (WR-04)"
        status: pass
    human_judgment: false
  - id: D22
    description: "getChannelConfig returns the tenant override row when both a tenant and a global row exist, and the global row for every other tenant"
    verification:
      - kind: integration
        ref: "tests/routing-dispatch.test.ts#prefers a tenant override row over the global default"
        status: pass
    human_judgment: false
  - id: D23
    description: "The cadence-tick route builds the routing sender per tick and threads it into runCadenceTick; its response shape is unchanged (T-3-24)"
    verification:
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#builds the routing sender per tick and threads it into runCadenceTick (D-04)"
        status: pass
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#THE T-3-24 ASSERTION: the body is numbers under fixed labels, nothing else"
        status: pass
    human_judgment: false
  - id: D24
    description: "A real ClickSend account accepts this payload and returns the message_id and status this client reads"
    verification:
      - kind: other
        ref: "Nothing in this repo can observe a live ClickSend send; the account has no dedicated AU number to send from"
        status: deferred
    human_judgment: true
    rationale: "The request shape and response mapping are built from MEDIUM-to-LOW confidence research (A1) and exercised against a stubbed fetch. Whether ClickSend's real 200 carries `data.messages[0].message_id` and a `status` this classifier maps can only be confirmed by a live send, which is blocked on the IPND business-address requirement and is 04-07's scope. The tolerant parse and the `no_message_in_response` branch exist because that seam cannot be closed from here."

duration: 30min
completed: 2026-08-29
status: complete
---

# Phase 4 Plan 03: Real Outbound SMS Behind the D-13 Seam Summary

**Real SMS capability now exists end-to-end in code — claim, route, send, record — with every failure mode mapped to the outcome union and nothing that throws, truncates, retries or logs a customer's number; and it is gated entirely by a database row that does not exist, so production remains provably stub-only until an operator writes one.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-29T03:28:00Z
- **Completed:** 2026-08-29T03:58:00Z
- **Tasks:** 3
- **Files modified:** 19 (9 created, 10 modified)
- **Full remote suite:** 58 files, 1211 tests, green against the hosted Sydney database; production crons paused and re-armed cleanly
- **Full pure suite:** 895 tests green on a bare `npm test`

## Accomplishments

- **The claim-time wiring bug is closed, and the proof is a real ledger row.** `dispatch.ts` writes `send_ledger.sender` *before* the send runs. With a routing composite that would silently have become `'routing'` — a provider that does not exist — on the exact column Phase 7 excludes stub rows by when computing recovered revenue. The claim now resolves through `providerFor(touch.channel)`, and `tests/routing-dispatch.test.ts` runs a real `dispatchDueTouches` through the composite and reads back `sender = 'stub'`, `outcome = 'stub_sent'`. Every pure test in this plan passes either way; that one assertion is the only one that can fail on it.
- **Production is stub-only as a fact about the database, not a claim about the code.** `messaging_config` holds zero rows, asserted directly after the full remote run, and `buildRoutingSender` refuses on any of four independent grounds (no row, not enabled, no from-address, no credentials). Deploying this plan cannot send a message to anybody.
- **The whole send path is built and tested without the IPND-blocked number (D-08).** 21 assertions cover the eight behaviour rows against a stubbed `fetch`, including the two that only a byte-exact comparison can make: a 220-character body and an emoji body arrive in the payload identical to the input string, so no `.slice(0, 160)` can ever be added quietly.
- **`messaging_config` is on the hosted DB behind two-arm RLS**, read-only to `authenticated`, with `UNIQUE ... NULLS NOT DISTINCT (channel, tenant_id)` — verified against the real database, not the migration file. Without that clause Postgres permits unlimited "global" rows and the read returns whichever one the planner picks; the tripwire that catches its removal asserts the index *definition* rather than inserting a second global row, because on this database that row is the live activation switch.
- **The migration applied and was verified column-by-column.** 04-01's trap was `migrate` exiting 0 having applied nothing, because the journal was behind the *database*. This plan read the applied head first (`1787940000000`), confirmed the new stamp exceeds it, and afterwards queried `information_schema` for the table, all nine columns, the four delivery columns, the constraint definitions, the policy expression, the RLS flag and all grants.
- **The 0025 snapshot did its job.** Generation emitted no drift statements against `cadences` this time — the three that 04-01 had to delete by hand did not reappear, which is exactly what its corrected snapshot was supposed to prevent. Verified by reading the generated file, not assumed.
- **`src/core/cadence/sender.ts` is byte-identical to its pre-plan state.** D-06 said the contract file was untouchable and it was not touched; the one extension the ledger needed (`ChannelAwareTouchSender`) lives in `dispatch.ts`, keeping the import direction messaging→cadence.

## Task Commits

1. **Task 1: messaging_config + delivery columns + repository + migration 0026** — `9e6dc6e` (feat)
2. **Task 2 (RED): failing ClickSendSender outcome matrix** — `7b62f50` (test)
3. **Task 2 (GREEN): ClickSend client + sender** — `c7001b8` (feat)
4. **Task 3 (RED): failing RoutingSender + claim-wiring suite** — `ab3d4da` (test)
5. **Task 3 (GREEN): RoutingSender, dispatch claim wiring, tick construction** — `ba6973d` (feat)

_Tasks 2 and 3 both carried `tdd="true"`; both kept the two-commit shape. Neither RED was assertion-level — see Deviations._

## Files Created/Modified

**Created**
- `src/db/schema/messaging-config.ts` — the D-04 switch. Nullable `tenant_id` as the global-default key, `MESSAGING_CHANNELS` with a `check()`, `UNIQUE NULLS NOT DISTINCT`, the two-arm policy.
- `src/db/repository/messaging-config.ts` — the fifth non-`forTenant` family. Override-then-default in one statement, one write path.
- `src/db/migrations/0026_messaging_config_delivery.sql` — generated, renamed, re-tagged, hand-extended with grants. Header records the applied-head check.
- `src/core/messaging/clicksend-client.ts` — direct `fetch`, tolerant zod, closed result union, sanitized codes.
- `src/core/messaging/clicksend-sender.ts` — `TouchSender` over ClickSend; one `try` around the whole body.
- `src/core/messaging/routing-sender.ts` — `RoutingSender`, `chooseSmsSender` (pure gate), `buildRoutingSender` (I/O wrapper).
- `tests/clicksend-sender.test.ts` — 21 pure assertions, real client + stubbed fetch.
- `tests/routing-sender.test.ts` — 10 pure assertions: delegation, `providerFor`, the guard, the six gate cases.
- `tests/routing-dispatch.test.ts` — 3 remote assertions, including the ledger row.

**Modified**
- `src/db/schema/send-ledger.ts` — four delivery columns, `DELIVERY_STATUSES`, and the header paragraph stating that a receipt never writes `outcome`.
- `src/core/cadence/dispatch.ts` — `ChannelAwareTouchSender`, `isChannelAware`, `claimedProviderFor`, and the one changed line in the claim.
- `src/app/api/internal/cadence-tick/route.ts` — builds the sender per request and threads it through.
- `src/db/schema/index.ts`, `src/db/repository/index.ts` — barrel exports on documented lines.
- `tests/rls-coverage.test.ts`, `tests/lint-ban.test.ts`, `tests/cadence-tick-route.test.ts` — tripwires widened with the argument written in place.

## Decisions Made

See `key-decisions` in the frontmatter. The three worth reading twice:

1. **The claim resolves through the routing rule, not through the object dispatch holds.** This is the whole plan in one line. `send_ledger.sender` is written before the send, and it is the column that keeps stub rows excludable from recovered-revenue attribution *forever*, against rows written today — the reason Phase 3 made `'stub'`/`'stub_sent'` structural rather than a date range. A composite has no honest `.provider`, so the alternatives were to give dispatch a sender-per-channel map (which moves the routing rule into dispatch and gives D-06's one-sender surface a second copy of it) or to have the composite answer the question with the same rule its `send()` will use. The second is a five-line interface and one changed line in the claim.

2. **The activation gate is pure so the test cannot arm production.** `chooseSmsSender(config, creds, fallback)` takes a row and returns a sender. That shape was chosen for a specific reason: the hosted Sydney database is shared with production, and an *enabled global sms row* left behind by an interrupted test run is, by D-04's own design, the switch that turns real customer messaging on with no deploy. A test that wrote one to prove the gate works would be a test that can arm the system if it dies between `beforeAll` and `afterAll`. Pure, all five refusal cases plus the accept are enumerable with zero writes; the I/O wrapper around it is thin enough that one read-only remote assertion (`no sms row ⇒ stub`) covers it.

3. **A per-tenant `enabled = false` means stop, not "use the default".** `getChannelConfig` returns the override row when one exists, and `resolveSmsFrom` returns `null` for a disabled override rather than falling through to the global number. Without that reading, "turn this one client off" would have no expression at all — the only lever would be the global row, which stops all fifteen. The sender then reports `sms_not_configured`, which is an honest recorded refusal on the ledger rather than a silent nothing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `nullsNotDistinct()` does not exist on drizzle-orm 0.45.2's `uniqueIndex()` builder**
- **Found during:** Task 1 (`npm run db:generate`)
- **Issue:** The plan prescribes `uniqueIndex(...).on(...).nullsNotDistinct()`. In the installed version that method exists only on the UNIQUE **constraint** builder (`unique()`), and calling it on the index builder is a `TypeError` thrown during snapshot generation — `db:generate` produced no file at all.
- **Fix:** Switched to `unique('messaging_config_channel_tenant_uniq').on(...).nullsNotDistinct()`. Postgres implements a UNIQUE constraint *as* a unique index, so the guarantee is identical and `ON CONFLICT (channel, tenant_id)` infers the same arbiter. Verified on the hosted database: `CREATE UNIQUE INDEX messaging_config_channel_tenant_uniq ON public.messaging_config USING btree (channel, tenant_id) NULLS NOT DISTINCT`. Naming an arbiter is safe here — unlike `cadences.create`, which must stay targetless — because this table has exactly one unique index, so no conflict can land on a different one and be re-raised as a 23505. Written into both the schema and the migration header.
- **Committed in:** `9e6dc6e`

**2. [Rule 2 - Missing Critical] `messaging_config` had no RLS, grant or arbiter coverage assertions**
- **Found during:** Task 1
- **Issue:** The migration series states "every new table needs its own block" and 04-01 added exactly such a block for `inbound_messages` under the same threat. Two failure modes here are invisible to the schema-wide assertions: (a) a policy without the `is_operator()` arm makes the *global* row — the one that governs whether anything sends at all — unreadable by every human, while RLS-on/policy-present/no-literal-`true` all still pass; (b) a unique arbiter that lost `NULLS NOT DISTINCT` permits unlimited global rows with no error anywhere, and the observable symptom is sending from an arbitrary one of two numbers.
- **Fix:** Added the table to the exact-grants map and the table-exists list, plus two dedicated assertions — both policy clauses naming `has_tenant_access` *and* `is_operator`, and the index *definition* containing `NULLS NOT DISTINCT`. The second is asserted against the definition rather than by inserting two global rows, because on this production-shared database that insert is the activation switch.
- **Verification:** `tests/rls-coverage.test.ts` — 21 tests green remotely.
- **Committed in:** `9e6dc6e`

**3. [Rule 3 - Blocking] The repository-barrel tripwire fired on the three new exports**
- **Found during:** Task 1
- **Issue:** `tests/lint-ban.test.ts` pins the exact key set of the repository barrel. This is the fourth consecutive plan to trip it and it is the tripwire working: a fifth non-`forTenant` family must be a decision somebody typed. `getChannelConfig` is the one that most *looks* like an escape, because it accepts a `tenantId`.
- **Fix:** Widened with the argument written in place — it takes a tenant id but not as a *scope*, since it asks for the override row OR the global default in one statement and a closure over a single scope cannot pose a question with two in it. What keeps it audited is the same thing that audits the other four families: one table, no joins, and nothing in the table worth leaking (identity, never credentials — those stay in `env.ts` per T-4-10).
- **Committed in:** `9e6dc6e`

**4. [Rule 3 - Blocking] `tests/cadence-tick-route.test.ts` broke on the route's new dependency, and one of its tripwires was pinning the wrong thing**
- **Found during:** Task 3 (full pure run)
- **Issue:** Two separate problems. (a) The route now imports `routing-sender`, which reaches `@/db/repository` and `getServerEnv` — the suite mocks `run-tick` and `env` but had nothing for the new module, so five behavioural tests failed on import. (b) A source tripwire asserted `ROUTE_SOURCE` contains the literal `'await runCadenceTick()'`. That test is named "does not use waitUntil — a send is must-happen work", and the guarantee it defends is that the tick is *awaited*; pinning the empty parens was pinning the argument list, which the plan legitimately changes.
- **Fix:** Mocked `@/core/messaging/routing-sender` with a recognisable stub sender, and widened the tripwire to `/await runCadenceTick\(/` with the reasoning written in place. Also added two assertions the wiring now needs (see deviation 5).
- **Verification:** `tests/cadence-tick-route.test.ts` — 21 tests green.
- **Committed in:** `ba6973d`

**5. [Rule 2 - Missing Critical] Nothing asserted that the route actually *uses* the sender it builds**
- **Found during:** Task 3
- **Issue:** `runCadenceTick` defaults `sender` to `StubSender`. A route that called `buildRoutingSender()` and then `runCadenceTick()` bare would compile, typecheck, pass every existing assertion in the suite, and send nothing real *forever* — with `cron.job_run_details` green throughout. The plan's acceptance criteria check the response shape is unchanged, which such a route would also satisfy.
- **Fix:** Added `expect(runCadenceTick).toHaveBeenCalledWith({ sender: ROUTING_SENDER })` plus a per-tick construction count. Added a second test asserting that a *failed* sender build does not degrade into running the tick with the default — that failure mode is the same silent one, arriving by a different road.
- **Committed in:** `ba6973d`

**6. [Structural, Rule 2] The plan's single `tests/routing-sender.test.ts` was split into a pure suite and a remote one**
- **Found during:** Task 3
- **Issue:** The plan specifies one file containing pure delegation tests *and* one remote dispatch test, with `npm test -- tests/routing-sender.test.ts` in its verify block. Those conflict: `tests/helpers/seed.ts` reads hosted credentials at module scope, so WR-09 refuses the entire file on a bare `npm test` and the pure assertions become unrunnable outside a remote run. The acceptance criterion "pure delegation tests pass" cannot be satisfied by a file that refuses to load.
- **Fix:** `tests/routing-sender.test.ts` keeps the pure half (delegation, `providerFor`, the guard, the six gate cases) and runs on a bare `npm test`; `tests/routing-dispatch.test.ts` holds the three remote assertions. Exactly the split 04-02 made between `clicksend-inbound-route.test.ts` (pure) and `inbound-threading.test.ts` (remote). Each file's header names the other and says why.
- **Committed in:** `ba6973d`

**7. [Rule 2 - Missing Critical] Provider status strings are sanitized before becoming a `reason`**
- **Found during:** Task 2
- **Issue:** The plan says reasons carry "codes/names only, never provider prose", and ClickSend's per-message `status` is *documented* as a code. That documentation is the LOW-confidence part of research A1, and the value flows into `send_ledger`, the operator's screen and a log line. Trusting a third party's discretion about what it puts in a field is not a control.
- **Fix:** `codeOf()` uppercases, collapses non-alphanumerics to `_`, and truncates to 48 characters. A phone number survives as digits, so the length cap is what actually bounds the damage — 48 characters is far shorter than any prose worth leaking. Documented at the function.
- **Committed in:** `c7001b8`

### Process deviation

**8. Neither TDD RED was observed as an assertion-level failure**
- Both Task 2 and Task 3 carried `tdd="true"` and both kept the two-commit shape (`7b62f50` → `c7001b8`, `ab3d4da` → `ba6973d`). In both cases the RED was a module-resolution failure rather than a failing assertion: each suite is the *first* consumer of a module that did not yet exist, so there was nothing to import. This is the same limitation 04-02 recorded for its Task 2 and the same signal 04-01's Task 1 had. Recorded rather than dressed up: a red that says "cannot find module" proves the test runs and the subject is absent, which is weaker than a red that proves the test discriminates.
- The Task 3 discrimination *was* checked by reasoning rather than by observation, and is worth stating explicitly: before the wiring change, `claimedProviderFor` did not exist and the claim wrote `context.sender.provider`, which for `RoutingSender` is the literal `'routing'` — so `expect(row.sender).toBe('stub')` would have failed on the value, not on an import. Re-running that assertion against the pre-fix code was not done, because doing so means running a real dispatch tick against the production-shared database for the sake of watching a test fail.

---

**Total deviations:** 7 auto-fixed (3 blocking, 4 missing-critical/structural), 1 process deviation.
**Impact on plan:** No scope creep. Deviations 1 and 5 are the two that would have shipped something wrong — a migration that could not be generated at all, and a tick route that builds a real sender and then silently sends nothing through it forever.

## Issues Encountered

- **`npm test` (pure) now reports 26 refusing integration files, up from 25.** That is the WR-09 guard working on the one new remote suite (`routing-dispatch.test.ts`), not a regression. 895 pure tests pass.
- **The cross-session `0025` collision flagged in 04-01 and 04-02 is unchanged.** The concurrent worktree's `0025_remote_test_lease.sql` is still applied to the hosted database and absent from `main`'s journal; `_journal.json` will still conflict on merge and one of the two `0025` entries must be renumbered by a human. This plan's `0026` sits ahead of both and is unaffected, but it does mean `main`'s schema and the hosted schema still differ by that one table, and CI builds only from the journal.
- **Nothing has ever received a real ClickSend response.** The request shape and the response classifier are built from MEDIUM-to-LOW confidence research and exercised against a stubbed `fetch`. The tolerant parse, the `no_message_in_response` branch and the sanitizing `codeOf` all exist because that seam cannot be closed from here — it closes in 04-07, behind the IPND-blocked number.

## User Setup Required

**Nothing new, and deliberately nothing.** `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY` remain unset and that is the expected state — `chooseSmsSender` falls back to the stub without them, which is what keeps this buildable while the AU dedicated number stays blocked.

**What 04-07 will do to activate, in order:**
1. Provision the dedicated AU virtual number (blocked on an IPND-acceptable business address).
2. Set `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` in Vercel Production.
3. `upsertChannelConfig({ channel: 'sms', tenantId: null, fromAddress: '+614…', enabled: true })`.

Step 3 alone arms real messaging for every client, on the next tick, with no deploy. Steps 1 and 2 are inert without it, and it is inert without them.

## Next Phase Readiness

**Ready for 04-04 (DLR + reconcile):**
- `send_ledger.delivery_status` / `delivery_detail` / `delivered_at` / `delivery_updated_at` exist and are unused — 04-04's callback is their first writer. `DELIVERY_STATUSES` is the normalized vocabulary; the schema header states the rule a DLR must not break (never write `outcome`).
- `custom_string` is populated with the ledger id on every send, so a receipt finds its row without searching on a phone number.
- `SendSmsResult.optedOut` and the `recipient_opted_out` reason are the hook for turning provider-side opt-outs into suppression evidence via `suppressBareContact` (04-02's `provider_opt_out` source arm is still uncalled).

**Ready for 04-05 (email arm):**
- `chooseSmsSender`'s shape is the template: a pure gate over the `'email'` config row plus `RESEND_API_KEY`, wired into `buildRoutingSender`'s `email` delegate, which is `StubSender` today with a comment naming 04-05.
- `messaging_config.reply_to` exists and is unused — D-01's tradie-reply-to address.

**Ready for 04-06 (console) and 04-07 (activation):**
- `upsertChannelConfig` is the single write path both are expected to use; `listChannelConfig` is the read.
- `messaging_config` holds **zero rows**, verified directly after the full remote run.

**Carried blockers unchanged:** the IPND business-address dependency still blocks the AU dedicated number, the ServiceM8 partner App ID/Secret is still unconfirmed, and the cross-session `0025` journal collision still needs a human at merge time.

---
*Phase: 04-messaging-gateway*
*Completed: 2026-08-29*

## Self-Check: PASSED

All 9 source/test artifacts and the SUMMARY exist on disk; all 5 task commits
(`9e6dc6e`, `7b62f50`, `c7001b8`, `ab3d4da`, `ba6973d`) are present in git
history. `messaging_config` verified empty on the hosted database after the full
remote run, and both production cron jobs verified `active`.
