---
phase: 04-messaging-gateway
plan: 04
subsystem: messaging
tags: [sms, clicksend, delivery-receipts, reconciliation, webhook, cron, opt-out, spam-act, d-07, t-4-18]

requires:
  - phase: 04-messaging-gateway
    plan: 01
    provides: the six Phase 4 env keys (CLICKSEND_DLR_SECRET, MESSAGING_RECONCILE_SECRET), inbound_messages + findInboundByProviderMessageId, suppressFromInbound and the provider_opt_out source arm
  - phase: 04-messaging-gateway
    plan: 02
    provides: the token-in-URL webhook shape (auth before body, uniform 200, pinned-interpolation log assertion), handleInboundSms complete over all eight branches, the ACMA 0491 570 1xx fixture rule, the pure/remote suite split precedent
  - phase: 04-messaging-gateway
    plan: 03
    provides: send_ledger delivery columns + DELIVERY_STATUSES, the "a receipt never writes outcome" rule stated in the schema header, custom_string = ledgerId on every send, the clicksend-client boundary conventions and codeOf, messaging_config + getChannelConfig, the pure-activation-gate pattern
  - phase: 03-cadence-engine
    provides: the cadence-tick bearer route shape, the counts-only response rule (T-3-24), the apply-cron-schedules.mjs JOBS list and its snapshot-and-restore suite
provides:
  - applyDeliveryReceipt + ReceiptResult — tolerant DLR parse, status classification, seconds/milliseconds boundary
  - updateDeliveryWhereMatch — the ONLY writer of the four delivery columns, UPDATE-only with an exact-match predicate
  - POST /api/webhooks/clicksend/dlr — the token-authed delivery-receipt door, own secret, no write surface
  - listSmsHistory + listInboundSms — the read-only paged polling half of the ClickSend client
  - reconcileMessaging + ReconcileResult — the daily sweep, all collaborators injectable
  - POST /api/internal/messaging-reconcile — bearer-authed nightly tick, counts-only body
  - forAllTenants_ledgerOwners — whose send is this ledger id (the seventh cross-tenant crossing)
  - codeOf and isOptOutCode exported from clicksend-client
  - cron JOBS entry messaging-reconcile ('30 19 * * *'), IN THE SCRIPT ONLY — not applied to production
affects: [04-05 email delivery events, 04-06 messaging console, 04-07 provider wiring + activation, 07 attribution]

actuals:
  tokens: 32800
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A bounded-length sanitizer is not a redaction: collapsing `could not deliver to +61491570156 because…` to 48 characters leaves the number INSIDE the cap — so a value a third party writes needs a shape rule (digit-run replacement) as well as a size rule"
    - "Two match keys must be tried in PRECEDENCE, never OR-ed, when either could name a different row: an OR over `custom_string` and `message_id` lets one forged callback annotate two clients' sends"
    - "A tolerant substring check that is safe in one context is unsafe in another: `OPT` is a correct opt-out test on a message the provider REFUSED and a wrong one on polled history, where `OPT_IN` satisfies it — so the polled path corroborates with a fact of our own"
    - "A poll loop whose exit condition is a field in a third party's response needs BOTH a page cap and a short-page break: the cap bounds a `last_page` that never stops incrementing, the short-page break covers a response that omits the field entirely"
    - "Injecting every collaborator is a SAFETY property, not a tidiness one, when the alternative is a suite that must write the row which arms production"

key-files:
  created:
    - src/db/repository/delivery-receipts.ts
    - src/core/messaging/receipts.ts
    - src/core/messaging/reconcile.ts
    - src/app/api/webhooks/clicksend/dlr/route.ts
    - src/app/api/internal/messaging-reconcile/route.ts
    - tests/receipts.test.ts
    - tests/clicksend-dlr-route.test.ts
    - tests/messaging-reconcile.test.ts
    - tests/messaging-reconcile-route.test.ts
  modified:
    - src/core/messaging/clicksend-client.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/core/shared/env.ts
    - docs/env-vars.md
    - scripts/apply-cron-schedules.mjs
    - tests/cron-schedules.test.ts
    - tests/lint-ban.test.ts
    - tests/sync-upsert.test.ts

key-decisions:
  - "`custom_string` and `provider_message_id` are tried in PRECEDENCE, not OR-ed as the plan's SQL prescribed. A payload naming one row by id and a different row by provider id would, under an OR, stamp two clients' sends from one callback — the difference between 'a receipt annotates the send it belongs to' and 'a receipt annotates whatever it can reach'. A test drives exactly that payload and requires the second row byte-identical"
  - "A non-uuid `custom_string` is treated as NO KEY rather than passed to the WHERE clause: `send_ledger.id` is a uuid column, so an unvalidated predicate is a 22P02 raised inside a webhook whose provider answers errors by re-delivering for 72 hours and then throttling the rule"
  - "Failure classes are tested BEFORE delivered classes because `UNDELIVERED` CONTAINS `DELIVERED`. A delivered-first mapping records the carrier's clearest possible statement of failure as a success, on the column Phase 7 reads — the assertion for it is named THE SUBSTRING TRAP"
  - "An `error_code` is dispositive over any status text. A payload carrying both `status_text: 'Delivered'` and an error code is a contradiction, and the safe reading of a contradiction is the one that does not claim a customer received something"
  - "`codeOf` was strengthened rather than copied: a digit-led run of 7+ number-ish characters is replaced before the 48-character cap, because the cap alone leaves `+61491570156` intact inside a 32-character collapse. Exported so the DLR boundary and the send boundary answer 'what may a third party put in our database' once"
  - "`applyDeliveryReceipt` never throws for an ORDINARY outcome (unparseable, unmatched) but lets a database failure propagate — the `inbound.ts` convention. A swallowed database error would 200-acknowledge a receipt that was never recorded, and ClickSend never re-delivers what we said we had"
  - "The opt-out evidence pass detects the refusal from ClickSend's POLLED HISTORY and corroborates it with `outcome = 'failed'` on our side, because `send_ledger` has no failure-reason column — the plan assumed one. The corroboration is load-bearing rather than belt-and-braces: `isOptOutCode` is a tolerant `OPT` substring that `OPT_IN` also satisfies"
  - "`forAllTenants_ledgerOwners` is the first cross-tenant read of `send_ledger`, a table three separate places in this repository stated would never have one. The reversal is recorded in all three rather than worked around, and what bounds it is that it is KEYED (no date range, no tenant list, empty list returns nothing) with a four-column select list pinned by a test"
  - "The reconcile suite is PURE with every collaborator injected, because the only remote alternative would have to write an enabled global `messaging_config` sms row — which on this production-shared database is the switch that arms real customer messaging for every client with no deploy (04-03's argument, applied again)"
  - "The sweep's window is 48 hours for a daily job. A 24-hour window has no margin: one deploy, cron outage or timeout during the nightly slot and that day's messages are never looked at by anything again. The overlap is only safe because all three writes converge"
  - "`messaging-reconcile` was added to the cron JOBS list and its test expectations but deliberately NOT applied to production — the route needs `MESSAGING_RECONCILE_SECRET` live in Vercel first, and activation is 04-07's ops step. The cron catalog was queried directly after the full remote run to prove it"

patterns-established:
  - "A route's pinned-interpolation assertion must match single-line AND wrapped `console` calls — the 04-02 version of that regex required a newline before the closing paren, so a one-line `console.log` would have slipped past it entirely"
  - "Fixture secrets in route suites are DERIVED (`W${TOKEN.slice(1)}`) rather than hand-typed to the same length, so 'a wrong token of identical length' cannot silently stop being that when the token is edited"
  - "A cross-tenant accessor that returns tenant data now carries THREE artefacts: the argument in its own header, the argument at the barrel tripwire, and a pinned select list — the third is what stops the first two from becoming decoration"

requirements-completed: []

coverage:
  - id: D25
    description: "A DLR whose custom_string or message_id matches an existing send_ledger row updates ONLY the delivery columns; outcome and provider_message_id are untouched by any DLR path"
    requirement: "MSG-01"
    verification:
      - kind: integration
        ref: "tests/receipts.test.ts#applies a custom_string receipt to the delivery columns ONLY"
        status: pass
      - kind: integration
        ref: "tests/receipts.test.ts#falls back to provider_message_id when only message_id is present"
        status: pass
      - kind: integration
        ref: "tests/receipts.test.ts#the repository module contains no INSERT — it is update-only by construction"
        status: pass
    human_judgment: false
  - id: D26
    description: "A DLR matching NO ledger row is a recorded no-op: counted, acknowledged 200, zero writes"
    requirement: "MSG-01"
    verification:
      - kind: integration
        ref: "tests/receipts.test.ts#writes NOTHING for a payload that matches no row"
        status: pass
      - kind: integration
        ref: "tests/receipts.test.ts#treats a NON-UUID custom_string as no key at all rather than a 22P02"
        status: pass
      - kind: unit
        ref: "tests/clicksend-dlr-route.test.ts#gives the SAME 200 body on every path (T-4-16)"
        status: pass
    human_judgment: false
  - id: D27
    description: "A payload naming one row by custom_string and a different row by message_id moves exactly one of them"
    requirement: "MSG-01"
    verification:
      - kind: integration
        ref: "tests/receipts.test.ts#prefers custom_string over message_id when BOTH are present"
        status: pass
    human_judgment: false
  - id: D28
    description: "DLR numeric timestamps are interpreted as epoch SECONDS below 1e11 and milliseconds at or above it, converted to timestamptz"
    verification:
      - kind: integration
        ref: "tests/receipts.test.ts#reads a numeric timestamp below the boundary as epoch SECONDS"
        status: pass
      - kind: integration
        ref: "tests/receipts.test.ts#reads a numeric timestamp at or above the boundary as MILLISECONDS"
        status: pass
      - kind: other
        ref: "The UNIT ITSELF is unverified — no real ClickSend DLR has ever been received. 04-07 must capture one and confirm."
        status: deferred
    human_judgment: true
    rationale: "The boundary rule is a backstop for a LOW-confidence research assumption (A1), and it is the reason a wrong unit surfaces as a NULL or an obviously absurd date rather than a plausible wrong one. Whether ClickSend's `timestamp` is seconds at all can only be answered by a captured payload, which is blocked behind the IPND-blocked dedicated number."
  - id: D29
    description: "The DLR route 401s a wrong, absent, truncated token AND the inbound webhook's own secret; every parseable and unparseable body gets one byte-identical 200 and writes no row anywhere"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/clicksend-dlr-route.test.ts#dlr webhook authentication (5 blocks incl. THE PER-ENDPOINT RULE)"
        status: pass
      - kind: unit
        ref: "tests/clicksend-dlr-route.test.ts#records no row anywhere — this route has no write surface at all"
        status: pass
      - kind: unit
        ref: "tests/clicksend-dlr-route.test.ts#takes the token from the QUERY STRING, not an Authorization header"
        status: pass
    human_judgment: false
  - id: D30
    description: "With sms config disabled or ClickSend creds absent, reconcileMessaging returns skipped and performs ZERO HTTP calls"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#the reconcile guard (5 blocks)"
        status: pass
    human_judgment: false
  - id: D31
    description: "A history row is applied through applyDeliveryReceipt; a polled inbound message is replayed through handleInboundSms unless already recorded; the sweep re-implements neither"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#delegates every history row to applyDeliveryReceipt, translated"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#replays an unseen message through handleInboundSms — the SAME entry point"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#SKIPS a message already recorded — dedupe on provider_message_id"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#IMPORTS the three application paths rather than re-implementing them"
        status: pass
    human_judgment: false
  - id: D32
    description: "A provider-refused send whose history status says opt-out becomes suppression evidence via suppressFromInbound(tenant, cadence, 'provider_opt_out'); a non-failed send does not"
    requirement: "MSG-01"
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#suppresses through suppressFromInbound with source provider_opt_out"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#THE OPT_IN GUARD: a non-failed send is not evidence of an opt-out"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#never suppresses on a row the receipt could not match"
        status: pass
    human_judgment: false
  - id: D33
    description: "Nothing in the reconciliation path can resend, re-enqueue or reset a message (D-07)"
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#RECORDS FACTS AND NEVER CREATES SENDS (D-07)"
        status: pass
    human_judgment: false
  - id: D34
    description: "The reconcile route 401s without its own bearer, answers counts only, and is excluded from the proxy matcher with no proxy change"
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile-route.test.ts#messaging-reconcile authentication (7 blocks)"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile-route.test.ts#every leaf of the body is a number or a boolean — no strings, ever"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile-route.test.ts#is EXCLUDED from the proxy matcher, and needs no proxy change"
        status: pass
    human_judgment: false
  - id: D35
    description: "The messaging-reconcile cron job is applied by the committed script at 03:30 AWST with its own bearer, and neither tick receives it"
    verification:
      - kind: integration
        ref: "tests/cron-schedules.test.ts#messaging-reconcile schedule (MSG-01, T-4-18) — 5 blocks"
        status: pass
    human_judgment: false
  - id: D36
    description: "ClickSend's real /v3/sms/history and /v3/sms/inbound responses match the shapes this client parses"
    verification:
      - kind: other
        ref: "Nothing in this repo can call a live ClickSend account; there is no dedicated AU number and no credentials on any deploy"
        status: deferred
    human_judgment: true
    rationale: "Both readers are built from the same MEDIUM-to-LOW confidence research (A1) as the send path and exercised against an injected fetch. The tolerant parse, the short-page break and the `unexpected_response` branch all exist because that seam cannot be closed from here — it closes in 04-07, behind the IPND-blocked number."

duration: 40min
completed: 2026-08-29
status: complete
---

# Phase 4 Plan 04: Delivery Receipts and the Daily Reconciliation Sweep Summary

**Every sent message can now carry a delivery fact recorded by a door that can only ever annotate a send somebody already made, and behind that hint sits a nightly poll that recovers a dropped receipt, replays a swallowed reply through the exact same attribution path the webhook uses, and turns a ClickSend-side opt-out into our own canonical suppression evidence — while remaining structurally incapable of sending anything.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2
- **Files modified:** 18 (9 created, 9 modified)
- **Full remote suite:** 62 files, 1287 tests, green against the hosted Sydney database; production crons paused and re-armed cleanly
- **Full pure suite:** 952 tests green on a bare `npm test`
- **No migration.** The four delivery columns landed in 04-03; `src/db/migrations/` is untouched.

## Accomplishments

- **The security model of the DLR door is structural, and the tests assert the structure.** `delivery-receipts.ts` is an UPDATE with an exact-match predicate and no insert path — asserted by reading the module's source for `.insert(`, not by behaviour, because the guarantee is that no such path exists. `outcome` is not in the SET list and is unreachable from any caller. The remote suite re-reads `outcome` after every receipt and requires `'sent'`.
- **The two match keys are tried in precedence, not OR-ed — and that is a plan deviation with a test that can fail on it.** A payload naming one row by `custom_string` and a different one by `message_id` moves exactly one row; the other's `delivery_updated_at` is compared byte-for-byte before and after. Under the plan's literal `WHERE … OR …`, one forged callback would have stamped two clients' sends.
- **`UNDELIVERED` contains `DELIVERED`, and there is a test named after it.** The failure classes are checked first for exactly that reason. A delivered-first mapping would record the carrier's clearest statement of failure as a success on the column Phase 7 reads, and every other assertion in the file would still pass.
- **The 48-character cap turned out not to be a redaction, and now there is one.** `codeOf` collapsed `could not deliver to +61491570156 because…` to 32 characters *with the number still in it*. A digit-led run of 7+ number-ish characters is now replaced before the cap, at both boundaries, from one exported function.
- **The sweep contains no decision of its own, and that is asserted three ways:** the source imports `applyDeliveryReceipt`, `handleInboundSms` and `suppressFromInbound`; every branch is proven by observing which injected dependency was called with what; and the D-07 prohibition is asserted against the source (`no sendSms`, `no dispatchDueTouches`, `no .send(`).
- **The opt-out path has a guard the plan did not ask for and needs.** `isOptOutCode` is a tolerant `OPT` substring — correct on a message the provider refused, wrong on polled history where `OPT_IN` satisfies it. The sweep corroborates with `outcome = 'failed'` on our side, and the test for it is named THE OPT_IN GUARD.
- **The reconcile suite cannot arm production.** Every collaborator is injected, so the enabled global `messaging_config` sms row that the guard requires exists only as a literal in the test process. Verified after the full remote run: `messaging_config` still holds zero rows.
- **The cron entry is in the script and not in the database.** `messaging-reconcile` is in `JOBS`, its five assertions pass remotely, and the `cron.job` catalog was queried directly afterwards: five jobs, none of them this one, both ticks active. Activation belongs to 04-07 and the route needs its secret in Vercel first.

## Task Commits

1. **Task 1 (RED): the failing receipt suites** — `e55ed43` (test)
2. **Task 1 (GREEN): receipts core, match-only repository write, DLR route** — `a3e63ea` (feat)
3. **Task 2: the reconciliation sweep, its route, and the cron entry** — `6c97361` (feat)

_Both tasks carried `tdd="true"`. Task 1 kept the two-commit shape; Task 2 did not — see Deviations._

## Files Created/Modified

**Created**
- `src/db/repository/delivery-receipts.ts` — `updateDeliveryWhereMatch`. Uuid shape check, precedence over OR, `now()` from the database clock, no insert path.
- `src/core/messaging/receipts.ts` — `applyDeliveryReceipt`. Tolerant schema whose one hard requirement is a routing key; failure-first classification; the seconds/milliseconds boundary documented as a research-A1 backstop.
- `src/core/messaging/reconcile.ts` — `reconcileMessaging`. Guard, 48-hour window, three passes, all collaborators injectable.
- `src/app/api/webhooks/clicksend/dlr/route.ts` — own secret, query-string token, one uniform 200, zero write surface.
- `src/app/api/internal/messaging-reconcile/route.ts` — cadence-tick clone, own bearer, counts-only body enumerated field by field.
- `tests/receipts.test.ts` — 14 remote assertions against real ledger rows.
- `tests/clicksend-dlr-route.test.ts` — 20 pure assertions.
- `tests/messaging-reconcile.test.ts` — 23 pure assertions over injected dependencies.
- `tests/messaging-reconcile-route.test.ts` — 14 pure assertions (split for a mechanical reason; see Deviations).

**Modified**
- `src/core/messaging/clicksend-client.ts` — `listSmsHistory`, `listInboundSms`, the paging helper, `codeOf` exported and strengthened, `isOptOutCode` exported.
- `src/db/repository/for-all-tenants.ts` — `forAllTenants_ledgerOwners`, and the header paragraph it reverses, corrected in place.
- `src/db/repository/index.ts` — two new export blocks on documented lines.
- `src/core/shared/env.ts`, `docs/env-vars.md` — `CLICKSEND_DLR_SECRET` corrected from bearer to URL token.
- `scripts/apply-cron-schedules.mjs` — the third JOBS entry.
- `tests/cron-schedules.test.ts`, `tests/lint-ban.test.ts`, `tests/sync-upsert.test.ts` — tripwires widened, each with the argument written in place.

## Decisions Made

See `key-decisions` in the frontmatter. The three worth reading twice:

1. **Precedence, not `OR`.** The plan pins `WHERE id = $ledgerId OR provider_message_id = $providerMessageId`, and its behaviour table simultaneously says `custom_string` takes precedence when both are present. Those conflict, and the conflict has a victim: a payload carrying a valid `custom_string` for tenant A's send and a valid `message_id` for tenant B's would, under the `OR`, stamp both. `custom_string` is a value *we* generated and handed to ClickSend, so where it is present and well-formed it is authoritative and the fallback is not tried — a receipt naming a ledger id we do not hold is `unmatched`, full stop, not an invitation to go looking with the other key.

2. **The opt-out corroboration is load-bearing.** `send_ledger` has no failure-reason column — dispatch stores an outcome and a provider message id, and `ClickSendSender`'s `recipient_opted_out` label lives only in a log line — so the plan's "outcome 'failed' and reason-detail indicating recipient_opted_out" describes a row this schema cannot produce. The reason therefore comes from ClickSend's own history row, which is where the sweep gets everything else. But `isOptOutCode` is deliberately a tolerant `OPT` substring (D-03's trade at the provider boundary), and that tolerance is safe *only* in the context it was written for: a per-message refusal. `OPT_IN` matches it. Polled history has no such context, so `outcome = 'failed'` is what supplies it — and the alternative would be suppressing a customer for having opted *in*.

3. **`send_ledger` got its first cross-tenant reader, against a rule stated in three places.** `for-all-tenants.ts`'s header, `tests/sync-upsert.test.ts`'s failure message and `tests/lint-ban.test.ts`'s comment all named `send_ledger` as a table with no such accessor. All three are now corrected rather than worked around, because the question is genuinely the one this file exists for: a polled history row echoes back a `send_ledger.id` and carries no tenant, and Spam Act suppression evidence has to be written under a real client. What makes it the narrowest crossing in the file is that it is KEYED — no date range, no tenant list, an empty id list returns nothing rather than everything — with a four-column select list that omits `to_address` and every delivery column, pinned by a test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `send_ledger` has no failure-reason column, so the plan's opt-out trigger could not exist**
- **Found during:** Task 2
- **Issue:** The plan's behaviour table says "a `send_ledger` row with outcome `'failed'` and reason-detail indicating `recipient_opted_out`", and its action text says to "read its constant; import rather than retype" from `ClickSendSender`. There is no such column: `setOutcome(ledgerId, outcome, providerMessageId)` is the whole write, and `recipient_opted_out` reaches only a `console.info`. The plan's own `<verification>` also forbids a migration in this plan, so adding the column was ruled out from the other side.
- **Fix:** The refusal reason comes from ClickSend's polled history row — the same source the sweep uses for everything else and the more authoritative one — and `outcome = 'failed'` on our side is the corroboration. `isOptOutCode` was exported from `clicksend-client.ts` so the detection has one spelling asked from two places, which is what the plan's "import rather than retype" instruction was protecting.
- **Verification:** `tests/messaging-reconcile.test.ts` — the opt-out pass, four blocks including THE OPT_IN GUARD.
- **Committed in:** `6c97361`

**2. [Rule 2 - Missing Critical] The two match keys are tried in precedence rather than OR-ed**
- **Found during:** Task 1
- **Issue:** The plan's SQL is an `OR`; its behaviour table says `custom_string` takes precedence. Under the `OR`, a single callback naming two different rows annotates both — across tenants, since neither key is tenant-scoped.
- **Fix:** One predicate, chosen by precedence. `tests/receipts.test.ts` drives exactly that payload and requires the non-target row byte-identical afterwards.
- **Committed in:** `a3e63ea`

**3. [Rule 2 - Missing Critical] `codeOf`'s 48-character cap does not redact a phone number, and now the sanitizer does**
- **Found during:** Task 1
- **Issue:** 04-03 introduced `codeOf` with the argument that "a phone number survives that transformation as digits, so the length cap is what actually stops it". It does not: `could not deliver to +61491570156 because…` collapses to `COULD_NOT_DELIVER_TO_61491570156_BECAUSE…`, which is 32 characters before truncation with the mobile fully intact. `delivery_detail` is rendered on the operator's screen and T-4-17 disposition is `mitigate` at high severity.
- **Fix:** A digit-led run of seven or more number-ish characters (digits plus the separators a phone number is written with) is replaced with `N` before the cap, so `+61491570156`, `0491 570 156` and `(08) 9000 0000` all vanish. No status code in any provider vocabulary is seven digits. Applied at both boundaries from one exported function rather than copied.
- **Verification:** `tests/receipts.test.ts#stores a bounded CODE in delivery_detail, never provider prose (T-4-17)`; the full `tests/clicksend-sender.test.ts` suite unchanged and green.
- **Committed in:** `a3e63ea`

**4. [Rule 1 - Bug] `CLICKSEND_DLR_SECRET` was documented as a Bearer header, which it cannot be**
- **Found during:** Task 1
- **Issue:** `env.ts` and `docs/env-vars.md` both called it a bearer. ClickSend's callback rules POST to a URL we configure with no way to set request headers — the identical error 04-02 found and fixed for the inbound secret, left uncorrected on this one. In 04-07 the operator configures the DLR rule from these docs and would build a callback URL with no token, producing a silent 401 on every real receipt.
- **Fix:** Both corrected, with the consequence spelled out at both. The route asserts it reads `searchParams` and never `headers.get('authorization')`.
- **Committed in:** `a3e63ea`

**5. [Rule 2 - Missing Critical] The page loop needed a short-page break as well as a cap**
- **Found during:** Task 2
- **Issue:** The plan says "paged". The exit condition is `last_page`, a field in a third party's response — the least confident kind of value in this whole plan. A response that omits it reads as "there is always another page", and a `last_page` that never stops incrementing is an unbounded loop inside a cron-invoked function.
- **Fix:** Both bounds. `MAX_PAGES = 5` caps it absolutely, and a page shorter than `PAGE_SIZE` breaks regardless of what `last_page` says. Documented at the constant with the daily-sweep volume that makes five pages generous.
- **Committed in:** `6c97361`

**6. [Rule 2 - Missing Critical] The 04-02 pinned-interpolation regex silently ignores one-line `console` calls**
- **Found during:** Task 1
- **Issue:** `tests/clicksend-inbound-route.test.ts`'s log assertion matches `/console\.\w+\(([\s\S]*?)\n\s*\);/` — it requires a newline before the closing paren, so it only sees *wrapped* calls. The DLR route's single-line `console.log` produced an empty interpolation set and the assertion passed vacuously until the regex was widened. That is a live gap in the inbound suite too: a one-line `console.log(\`…\${payload.from}\`)` added there today would not be caught.
- **Fix:** The DLR suite matches both shapes, with the reason written in place. **The inbound suite's copy is NOT changed here** — see Deferred Issues.
- **Committed in:** `a3e63ea`

**7. [Structural, Rule 2] The route tests live in their own file, not in `tests/messaging-reconcile.test.ts`**
- **Found during:** Task 2
- **Issue:** The plan lists one test file for Task 2. The route suite must `vi.mock('@/core/messaging/reconcile')` to observe the route in isolation, and vitest keys mocks on the resolved module path — so a mocked `reconcile` module cannot also be the subject under test in the same file.
- **Fix:** `tests/messaging-reconcile-route.test.ts`, the same separation `cadence-tick-route.test.ts` keeps from `cadence-tick.test.ts`. Each file's header names the other and why.
- **Committed in:** `6c97361`

**8. [Rule 3 - Blocking] Three source-guarantee tripwires fired**
- **Found during:** Tasks 1 and 2
- **Issue:** `tests/lint-ban.test.ts` pins the repository barrel's key set (fired twice — `updateDeliveryWhereMatch`, then `forAllTenants_ledgerOwners`), and `tests/sync-upsert.test.ts` pins both the cross-tenant export list and the set of tables reachable from that file. All three are the tripwires working: a sixth family and a seventh crossing must be decisions somebody typed.
- **Fix:** Widened with the argument written in place at each, plus a NEW select-list containment pin the file did not previously need — `forAllTenants_ledgerOwners`'s `sendLedger.*` references are pinned to exactly four columns, so adding `to_address` "to log which number failed" is a test failure rather than a customer's mobile crossing the tenant boundary.
- **Committed in:** `a3e63ea` and `6c97361`

### Process deviations

**9. Task 2's TDD RED was not observed at all**
- Task 2 carried `tdd="true"` and its implementation was written before its suite; the 37 assertions passed on their first run. That is weaker than Task 1's module-resolution RED and much weaker than an assertion-level one, and it is recorded rather than dressed up. Task 1 kept the two-commit shape (`e55ed43` → `a3e63ea`) and its RED is in the log.
- The one discrimination worth stating: the OPT_IN guard test *was* checked to fail without its guard, by reasoning rather than observation — without the `outcome !== 'failed'` line, `suppress` is called and `optOutsRecorded` is 1, which is exactly what that block asserts against.

**10. The plan's stated example timestamp is off by a year**
- The plan says `1756351200 → 2026-08-28T…Z`. It is `2025-08-28T03:20:00.000Z`. The tests assert the computed value.

---

**Total deviations:** 8 auto-fixed (2 bugs, 1 blocking tripwire set, 5 missing-critical/structural), 2 process deviations.
**Impact on plan:** No scope creep. Deviations 1, 2 and 3 are the three that would have shipped something wrong — a compliance pass that could never fire, a callback that could stamp two clients' rows, and an operator screen with a customer's mobile on it.

## Known Stubs

None. Every artefact this plan names is wired to a real caller except the cron job itself, which is deliberately unapplied (see below).

## Deferred Issues

- **`tests/clicksend-inbound-route.test.ts`'s interpolation regex is still the narrow one.** Deviation 6 fixed the DLR copy; the inbound copy was left alone because changing an existing passing tripwire in a plan that does not touch that route is out of scope, and the fix is one character. It is a real gap — a single-line `console.log` added to the inbound route would not be caught — and belongs in 04-06 or a `/gsd-quick`.
- **`send_ledger` still has no failure-reason column.** Deviation 1 works around it correctly for the opt-out case, but the general fact "why did this send fail" is currently discoverable only from a Vercel log line. 04-06's console will want it. Recorded here rather than solved, because it is a migration and this plan was pinned to none.

## Issues Encountered

- **`npm test` (pure) reports 27 refusing integration files, up from 26.** That is the WR-09 guard working on the one new remote suite (`receipts.test.ts`), not a regression. 952 pure tests pass.
- **The cross-session `0025` journal collision flagged in 04-01, 04-02 and 04-03 is unchanged.** This plan generated no migration, so nothing was added and nothing resolved. `main`'s schema and the hosted schema still differ by that one table and a human is still needed at merge time.
- **Nothing has ever received a real ClickSend delivery receipt or history page.** Both the DLR schema and the two list readers are built from research A1 and exercised against injected fetches and `Request` objects. The tolerant parses, the `unexpected_response` branch, the short-page break and the timestamp boundary all exist because that seam closes only in 04-07, behind the IPND-blocked number.

## User Setup Required

**Nothing new to run, one thing to record for 04-07.**

`CLICKSEND_DLR_SECRET` and `MESSAGING_RECONCILE_SECRET` were both set by the operator in 04-01; this plan is their first consumer. Two facts to carry forward:

1. The ClickSend **delivery-receipt** rule's callback URL must be
   `https://<host>/api/webhooks/clicksend/dlr?token=<CLICKSEND_DLR_SECRET>`.
   A query parameter, not a header. Configured without it, every receipt 401s silently and the delivery columns stay NULL forever.
2. **The `messaging-reconcile` cron job is deliberately not applied.** It is in `scripts/apply-cron-schedules.mjs` and under test, but the production `cron.job` catalog was verified after the full remote run to contain five jobs and none of them this one. Applying it means, in order: confirm `MESSAGING_RECONCILE_SECRET` is set in Vercel Production, deploy, then `APP_BASE_URL=… npm run cron:apply`. Running it before the secret is live produces a nightly 401 with `cron.job_run_details` green.

## Next Phase Readiness

**Ready for 04-05 (email arm):**
- `updateDeliveryWhereMatch` is channel-agnostic: a Resend delivery/bounce webhook writes the same four columns through the same function, keyed on `provider_message_id`.
- `codeOf` is exported and now genuinely redacts, so Resend's error strings have a sanitizer waiting.
- `INBOUND_SUPPRESSION_SOURCES` has one arm left with no caller (`email_unsubscribe`); `provider_opt_out` is now live.

**Ready for 04-06 (console):**
- `delivery_status` / `delivery_detail` / `delivered_at` / `delivery_updated_at` have their first writer, so the ledger view has something to render besides an outcome.
- Still missing, unchanged from 04-02: nothing lists `inbound_messages` rows for the triage queue.
- New: nothing surfaces WHY a send failed (see Deferred Issues).

**Ready for 04-07 (activation):**
- Three things now depend on the same `messaging_config` sms row: the sender, the reconcile guard, and — indirectly — every delivery fact. Flipping that one row arms all of them.
- The reconcile route and its cron entry are the last piece of the messaging spine that exists in code and not in the database.

**Carried blockers unchanged:** the IPND business-address dependency still blocks the AU dedicated number, the ServiceM8 partner App ID/Secret is still unconfirmed, and the cross-session `0025` journal collision still needs a human at merge time.

---
*Phase: 04-messaging-gateway*
*Completed: 2026-08-29*

## Self-Check: PASSED

All 9 created source/test artifacts and this SUMMARY exist on disk; all 3 task
commits (`e55ed43`, `a3e63ea`, `6c97361`) are present in git history. The hosted
database was verified after the full remote run: `messaging_config` holds zero
rows, `inbound_messages` zero, `send_ledger` zero rows with a non-null
`delivery_status`, `suppressed_contacts` the same two pre-existing orphans, and
the `cron.job` catalog the same five jobs it held before — both ticks active,
`messaging-reconcile` absent.
