---
phase: 06-review-console-escalation
plan: 05
subsystem: escalation
tags: [escalation, hot-lead, sms, tick-pass, claim, gsm7, evidence, cross-tenant]
status: complete

requires:
  - "escalations table + UNIQUE(inbound_message_id) (06-01, migration 0032)"
  - "inbound_messages.is_hot, written only by writeClassification (05-06)"
  - "countSeptets / segmentCount / normalizeForGsm7 (05-01, src/core/drafting/gsm7.ts)"
  - "normalizeAuMobile — refuses rather than repairs (03-03)"
  - "sendSms + codeOf, the thin typed ClickSend client (04-03)"
  - "the per-tenant sms identity rule inside chooseSmsSender (04-08, CR-01)"
provides:
  - "src/core/escalation/message.ts — buildEscalationSms, ESCALATION_COOLDOWN_MINUTES, ESCALATION_MAX_SEGMENTS, ESCALATION_SEPTET_BUDGET, ESCALATION_UCS2_BUDGET"
  - "src/core/escalation/escalate-hot-leads.ts — escalateHotLeads, buildEscalationSender, EscalationSmsSender, EscalationCounts, NO_ESCALATIONS"
  - "forAllTenants_hotUnescalated + HOT_ESCALATION_CAP (crossing eleven)"
  - "claimEscalation / recentEscalationForCadence / recordEscalationOutcome (the seventh repository family)"
  - "resolveSmsFrom exported from routing-sender.ts — one arming rule, asked twice"
  - "CadenceTickResult.hotEscalated / escalationCooldownSuppressed / escalationNoNumber / escalationNotConfigured / escalationSendFailed / escalationDeferred / escalationUnconfigured, enumerated in the tick route"
  - "tests/escalation-message.test.ts (pure, 343) + tests/escalation.test.ts (remote, 17)"
affects:
  - "runCadenceTick gains a seventh pass and a THIRD composition-root seam the route must supply"
  - "ESCALATION_OUTCOMES is now the four outcomes we decide; provider refusals write a codeOf token"
  - "tests/helpers/seed.ts teardown sweeps escalations"
  - "Phase 7 reads escalations for reach latency; the cooldown and refusal rows are what make that computable"

tech-stack:
  added: []
  patterns:
    - "Fixed parts assembled AFTER truncation — the unclippable field is a property of assembly order, not of a length check"
    - "Derive a budget from the shared counter (segmentCount) instead of writing the number down"
    - "An injected seam with NO default, where the default's side effect would be irreversible"
    - "Two vocabularies in one text column, distinguishable by CASE — ours lower_snake, the provider's UPPERCASE from codeOf"
    - "Source assertions run over the file with its prose stripped, so a comment may name what the code may not do"

key-files:
  created:
    - src/core/escalation/message.ts
    - src/core/escalation/escalate-hot-leads.ts
    - src/db/repository/escalations.ts
    - tests/escalation-message.test.ts
    - tests/escalation.test.ts
  modified:
    - src/core/cadence/run-tick.ts
    - src/core/messaging/routing-sender.ts
    - src/app/api/internal/cadence-tick/route.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/db/schema/escalations.ts
    - tests/cadence-tick-route.test.ts
    - tests/lint-ban.test.ts
    - tests/helpers/seed.ts

decisions:
  - "The escalation sender has NO DEFAULT and undefined means the pass does not scan — stricter than the stall sender's no-op, because claiming an escalations row consumes the never-twice right permanently and every remote suite runs runCadenceTick against the hosted database"
  - "resolveSmsFrom became a named export rather than being copied: the plan asked the escalation to ask 'the SAME question dispatch asks', and a second reading of `row?.enabled ? row.fromAddress : null` is the exact shape that produced CR-01"
  - "ESCALATION_SEPTET_BUDGET is DERIVED by walking segmentCount until the third segment starts, so the number 306 appears nowhere in the module — asserted by a source check"
  - "The truncation marker is `normalizeForGsm7('…')`, not three typed dots and certainly not `…`: one ellipsis character flips the whole message to UCS-2 and halves the budget"
  - "UCS-2 segment sizes (70/67) are modelled in message.ts because gsm7.ts deliberately declines to — its caller wants the model to REWRITE a UCS-2 body, and this caller cannot rewrite a stranger's SMS"
  - "The first name is capped at 32 code points, bluntly and with no ellipsis, so a pathological contact_name cannot squeeze the fixed skeleton — which is what makes 'the number always survives' an absolute property rather than a typical one"
  - "A missing snippet drops the about-clause and a missing reply drops the colon, rather than rendering `about \"\"` or a dangling `:` — a message that looks broken is one a tradie stops trusting"
  - "escalations.outcome carries TWO vocabularies: ours in lower_snake_case and the provider's as an UPPERCASE codeOf token. The column has no CHECK by 0032's own argument, and case is what keeps the two readable apart without a prefix"
  - "to_address = '' means 'there was nobody'. The column stays NOT NULL because an alert that WAS sent must always name its recipient; outcome='no_escalation_number' is what distinguishes the sentinel from a bug"
  - "The cooldown counts every prior escalation in the window including refusals — two sms_not_configured rows ten minutes apart are one disarmed deployment, and counting both would inflate the number Phase 7 reads as 'hot leads we failed to reach'"
  - "escalationUnconfigured is its own field, not part of escalationDeferred: 'nothing is wired' and 'something threw' are read differently at 3am"
  - "The accessor does NOT join tenants — the escalation number is read through forTenant(row.tenantId), so the crossing's whole return surface stays facts about one customer's reply"

metrics:
  duration: ~35 min
  completed: 2026-09-01
  tasks: 2
  files: 14
  commits: 2

actuals:
  tokens: 27500
  tasks: 2
  commits: 2
---

# Phase 6 Plan 05: Hot-Lead Escalation Summary

CON-03 is real and structural: a reply the classifier marks hot becomes an SMS to the
tradie's own phone **in the same tick**, carrying the customer's first name, their quote, their
actual words and a tap-to-call number that cannot be clipped — exactly once per inbound
message, decided by a unique index rather than by caller discipline, and unable to fire at
all while the deployment is disarmed.

## What Was Built

**The message (`src/core/escalation/message.ts`).** Pure, and the entire design is one
sentence: *a clipped number is a lead the tradie cannot call.* So the `Call them:` line and
the mobile are assembled **after** truncation. Only the reply text shrinks; only once the
reply is gone entirely does the snippet start to; and the first name is capped bluntly at 32
code points so a pathological `contact_name` cannot squeeze the fixed skeleton either. That
last cap is what turns "the number survives" from a typical outcome into an **absolute**
property — which is what the 343-case matrix in `tests/escalation-message.test.ts` asserts,
across emoji, mixed scripts, GSM extension characters, control characters, a 20,000-character
body and a reply that tries to forge its own `Call them:` line.

The budget is **derived, not typed**: `ESCALATION_SEPTET_BUDGET` walks `segmentCount` — the
same function that fills `touch_drafts.segments` — until the third segment would start. The
number `306` appears nowhere in the module, and a source assertion says so. The truncation
marker is `normalizeForGsm7('…')`, because the ellipsis character the spec writes is not in
the GSM table and one of them would flip the whole message to UCS-2, halving the budget and
roughly doubling the bill with nothing warning anybody.

**The evidence family (`src/db/repository/escalations.ts`).** Three functions and there is no
fourth: the claim, the cooldown read, the outcome write. `claimEscalation` is
`INSERT … ON CONFLICT DO NOTHING RETURNING id` — targetless, following `cadences.create`'s
G-3-2 lesson — and that statement **is** the never-twice guarantee. `recordEscalationOutcome`
is guarded on `outcome IS NULL` so a late second answer cannot bury the first. There is
deliberately no list, no read-by-tenant and no delete: an evidence table with a convenience
reader becomes a queryable log of who replied to whom.

**The crossing (`forAllTenants_hotUnescalated`).** The eleventh, and after the approval queue
the widest — it returns a customer's **words** and a customer's **mobile**, across tenants.
The address is there for a reason no other accessor can claim: the message *ends* with
`Call them: {mobile}`, and withholding it would only mean the pass fetched it a line later.
What bounds it instead is a closed predicate (`is_hot` AND `attribution = 'threaded'` AND no
escalation row), a pinned select list with no `raw_payload` and no `from_address`, a cap
exported as `HOT_ESCALATION_CAP` because every row costs a real charged SMS, and **no join to
`tenants`** — the escalation number is read back through `forTenant(row.tenantId)`.

It is a **scan**, not a hand-off from the classifier, and that is the self-healing property
(Pitfall 7): a tick that died between classifying and escalating would otherwise strand that
lead forever. Asking "hot and not yet escalated" every minute costs a missed lead one minute.

**The pass (`escalate-hot-leads.ts`).** Resolve → cooldown → claim → send → record, per-row
isolated, counts only. It bypasses every customer-protection gate by design (D-05: contact
hours, approval, suppression — the tradie is not a chased contact) and **not** the D-04 arming
switch. Seven counts ride the tick route enumerated one by one.

## Key Implementation Decisions

**The sender has no default, and that is stricter than the stall sender on purpose.**
`stallAlertSender` defaults to a no-op that reports `not_configured` — forgetting it costs a
lost email. Forgetting an escalation sender would cost a **claim**, and a claim is
irreversible: that inbound message can never be escalated again. `runCadenceTick` is reachable
from a script and from every remote suite in this repository, all of which run against the
hosted Sydney database, so `undefined` means the pass does not run **and does not scan**. The
remote suite asserts exactly that — a full tick with no sender leaves the row unclaimed and
still visible to `forAllTenants_hotUnescalated`.

**`resolveSmsFrom` was extracted rather than copied.** The plan asks the escalation to ask
"the SAME per-tenant enabled-sms-identity question dispatch asks". That question lived as an
anonymous arrow inside `chooseSmsSender`, so "the same" was not reachable without extraction.
A second copy of `row?.enabled ? row.fromAddress : null` is precisely the shape that produced
CR-01 — two readings of one activation rule, agreeing until one of them was widened. There is
now one function, and the remote suite source-asserts that the pass imports it and never names
`getChannelConfig` itself.

**Two vocabularies in one text column, told apart by case.** Migration 0032 refused a CHECK on
`escalations.outcome` with an argument worth keeping: a provider adding a status must not raise
a 23514 inside the tick that is trying to tell a tradie about a hot lead. So the four outcomes
**we** decide are `lower_snake_case` and a provider refusal writes the `codeOf` token, which is
UPPERCASE by construction. A reader never has to guess which side of the trust boundary a value
came from, and no prefix scheme was needed to buy that.

**The cooldown counts refusals too.** Two `sms_not_configured` rows ten minutes apart are one
disarmed deployment, not two failures to reach a tradie. Counting both would inflate exactly
the number Phase 7 reads as "hot leads that did not land".

**UCS-2 is modelled here because `gsm7.ts` declines to.** `countSeptets` reports UCS-2 as a
*violation* — which characters made septets inapplicable — because its caller, the drafting
validator, wants the model to rewrite the body. This caller cannot: the offending character is
in a stranger's SMS, and transliterating a customer's words to save a segment is the mutilation
`gsm7.ts` refuses by name. So a UCS-2 body is not an error here; it is a smaller budget, and the
smaller budget had to be written down somewhere. It is written once, and pinned by a test.

## Deviations from Plan

### Deliberate additions beyond the plan's file list

**1. [Rule 2 — Missing critical functionality] `escalationUnconfigured`, a seventh count**

The plan named six tick fields. A seventh was required by the sender-default decision above:
with no sender the pass does not scan, so there is no number of rows to report, and folding
that into `escalationDeferred` would make a missing credential read as "something threw". Same
shape and same argument as `ClassifyCounts.unconfigured` and `draftingUnconfigured`. It is
enumerated in the route beside the other six.

**2. [Rule 2 — Missing critical functionality] `resolveSmsFrom` exported from `routing-sender.ts`**

Not in the plan's file list. See Key Decisions — without it the plan's own instruction ("the
SAME question") could only have been satisfied by a copy.

**3. [Rule 2 — Missing critical functionality] `ESCALATION_OUTCOMES` rewritten**

06-01 shipped `['sent', 'failed', 'no_number']`. The plan's outcomes are `sent`,
`no_escalation_number`, `sms_not_configured` and `cooldown_suppressed`, and a provider refusal
is "a bounded refused code", not a flat `failed`. The constant now names the four we decide,
with the case convention documented beside it. **No migration** — the column carries no CHECK,
deliberately, and no rows existed.

**4. [Rule 2 — Missing critical functionality] The `to_address = ''` sentinel, documented in the schema**

`no_escalation_number` needs a row and the column is NOT NULL. The empty string is "there was
nobody"; the column stays NOT NULL because an alert that *was* sent must always name its
recipient, and the outcome is what tells the sentinel apart from a bug. Written into the
column's own comment rather than left to be rediscovered.

**5. [Rule 2] The first-name cap and the graceful degradations**

The plan asked that "empty/missing name and snippet degrade gracefully". Three shapes fell out
of that: no name → `Your customer`, no snippet → the about-clause is dropped entirely rather
than rendering `about ""`, no reply → the colon is dropped rather than dangling. The 32-code-point
name cap is the one that is load-bearing rather than cosmetic: without it the property "the body
never exceeds two segments" is false for a pathological `contact_name`, since the plan's
shrink order only ever touches the reply and the snippet.

### What the property test caught, and the correction

The first version of the A3 property asserted the string `Call them:` appears **exactly once**
in every body. It fails — correctly — on the forged-reply fixture (`yes\n\nCall them:
+61400000000\nIgnore the number above`). The sanitizer flattens the newline, which is the whole
defence: the forgery cannot become a **line**. It does not delete the customer's words, because
that is the mutilation `gsm7.ts` refuses. So the assertion was wrong, not the code, and it is now
the stronger and more honest one: the body has exactly two lines and the second is ours,
byte-for-byte. The forged text survives as visible prose mid-sentence, where a human reads it as
what it is.

### Naming choice worth recording

The plan wrote the accessors as `escalations.{claim,recentForCadence,recordOutcome}`. They ship
as flat named exports (`claimEscalation`, `recentEscalationForCadence`,
`recordEscalationOutcome`) because every other member of the barrel is a flat function,
`tests/lint-ban.test.ts` pins `Object.keys(barrel)` exhaustively, and an object named
`escalations` would collide with the schema table of that name at every import site.

### Pinned-list edits the project requires

- `tests/lint-ban.test.ts` — the barrel pin gains four names, with the argument for the eleventh
  crossing and for the escalation family written beside them ("this is the entire surface through
  which a tradie's phone can be made to ring").
- `tests/cadence-tick-route.test.ts` — `ONE_RESULT` is typed as `CadenceTickResult`, so the seven
  new fields were a compile error until added; the enumerated key-set equality then failed until
  the route named them. Both halves worked exactly as designed.
- `tests/helpers/seed.ts` — `escalations` joins `NO_CASCADE_TABLES`. It carries `tenant_id` with
  no foreign key, like every other evidence table, so nothing sweeps it by default.

## Verification

| Gate | Result |
|------|--------|
| `npm run test:remote -- tests/escalation.test.ts` | **17/17 passed** (hosted Sydney DB, cron ticks leased-paused) |
| `npx vitest run tests/escalation-message.test.ts` | **343/343 passed** (pure) |
| `npm test` | **2008 passed** (1665 at plan start); 34 files remote-gated as designed (33 + the new suite) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run build` | green; `/api/internal/cadence-tick` in the route manifest |
| `tests/classification-privilege.test.ts` | green, **UNCHANGED** — no escalation member entered the pinned import equality |
| Migration | **none generated** — 0032 remains the phase's single journal entry |

### Post-run residue probe (read-only, hosted DB)

```
messaging_config: exactly one row — global sms, enabled=false, +61491579212
                  (the deliberate 04-07 disarm; the suite's tenant-scoped row is gone)
escalations:      0 rows
inbound_messages where is_hot: 0 rows
```

The suite's own `beforeAll` carries the residue alarm in the other direction: it fails loudly
if an enabled sms row exists *before* it writes one, so an interrupted run is caught by the
next run rather than sitting armed on a production-shared database.

### Test-environment note

Every command above was run with `STALLED_DIGEST_SECRET` injected into the command
environment. That variable is a REQUIRED member of `serverEnvSchema` (06-02) and is still
absent from `.env.local`, which this executor is permission-blocked from writing.
**06-02's operator obligation 1 remains outstanding** and blocks a bare `npm test`.

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-6-16 Tampering — double-fire on replayed/overlapping ticks | `UNIQUE(inbound_message_id)` with `ON CONFLICT DO NOTHING RETURNING`; only the inserter sends. Proven at the database in two ways: two successive passes over one hot reply produce one send and one `sent` row, and a direct second `claimEscalation` on the same inbound id returns `null` (asserted through the claim itself, not through the anti-join that would hide it). |
| T-6-17 Information disclosure — reply text in logs/error details | The pass logs one fixed sentence of six integers. Every catch discards its value. A named test walks every `console.*` call in the file and asserts none interpolates `row.body`, `message.body`, `contactMobile`, `escalationPhone` or a caught error. The tick route enumerates seven numbers, never a spread. |
| T-6-18 Tampering — injection via forwarded reply text | C0/C1 controls to spaces, whitespace collapsed, `normalizeForGsm7` applied; the body is exactly as many lines as the builder decided. Asserted across the property matrix: two lines, and the second is ours byte-for-byte. A forged `Call them:` survives as prose, never as structure. |
| T-6-19 Elevation — sending while the deployment is disarmed | `resolveSmsFrom` — the same function dispatch asks — before the claim and before any HTTP. The remote suite proves it on a real tenant with no enabled row: `sms_not_configured` recorded, and the injected fake was never invoked for that row. |
| T-6-20 Spoofing — escalation `custom_string` misfiling a DLR | A4 is now a named remote test: `applyDeliveryReceipt` with a real escalation row id as `custom_string` answers `{ kind: 'unmatched' }`, and a seeded `send_ledger` bystander for the same tenant still reads NULL on all four delivery columns afterwards. |

## Prohibitions Honoured

- **The recipient is only ever the tradie.** Asserted on a real row: the fake sender's `to`
  equals the tenant's normalized `escalation_phone`, is not the customer's mobile, and
  `escalations.to_address` records the same. The customer's number appears exclusively inside
  the body, whole, on the last line.
- **Not reachable from `classifyInbound`, and the privilege pin is untouched.**
  `tests/classification-privilege.test.ts` was run and not edited; the escalation suite asserts
  by absence in both directions (the pinned suite names no escalation member, and the
  classifier's import block names no escalation module). The pass reads the stored `is_hot` and
  contains neither `isHotLead` nor the string `'interested'`.
- **No send while unconfigured or disarmed**, with zero sender invocations asserted on the
  injected fake for both the no-number and the disarmed cases.
- **No customer reply text in any log or error detail** (see T-6-17).
- **No migration. No packages installed.** `git diff` touches no file under `src/db/migrations/`
  and no manifest.

## Known Stubs

None.

One thing is deliberately **not** a stub and is worth stating plainly, because it looks like one
from the outside: while the global sms row stays disarmed, every hot reply is consumed as a
recorded `sms_not_configured` refusal and is **never retried**. That is plan-directed (D-04,
Pitfall 2) and correct — an escalation about a reply from three days ago is not a hot lead any
more, and a queue that replayed on arming would page a tradie about a week of stale conversations
at once. Arming is the flip that makes escalation live from that moment forward.

## Requirement Status

**CON-03 is complete and is marked here** — 06-05 is the only plan whose frontmatter claims it.
A hot reply reaches the tradie's hand within one tick with everything needed to call the customer
back, exactly once per inbound message, with evidence rows Phase 7 can compute reach latency from,
and nothing can fire while the deployment is disarmed.

The plan's `<human-check>` is a **VALIDATION obligation, not unbuilt work** — the same reading
06-02 applied to CON-04's cron activation. There is no ops step here at all: the pass rides the
already-deployed per-minute `cadence-tick`, so it goes live on the next deploy. What cannot be
done today is the supervised confirmation on a real handset, because it requires an armed
`messaging_config` sms row and there is no real client yet:

> At first real-client arming (or supervised UAT with the operator's handset): trigger a
> hot-classified inbound against the test tenant and confirm the tradie SMS arrives within a
> minute with readable context and a tap-to-call number.

This is deliberately NOT the MSG-02 case (04-10). D-02 defined MSG-02 *as* the pipe proven by a
real send, so a recorded deferral there would have read as a proof. CON-03's wording is about the
mechanism, the mechanism is complete, and every part of it including the disarm gate is proven
against real rows in the hosted database.

## Notes for Next Plans

- **The escalation seam must be decided by anything that runs `runCadenceTick` outside the tick
  route.** The default is `undefined`, which means the pass does not scan and claims nothing —
  visible as `escalationUnconfigured: 1`, never silent.
- `resolveSmsFrom` is now the one per-tenant sms arming question. A third consumer imports it;
  it does not re-read `messaging_config`.
- `buildEscalationSms` is pure and exported. A console surface that wants to show an operator
  what a tradie received should call it rather than re-render the template.
- **Do not add a list/read accessor to the escalation family without an argument.** The three
  functions are pinned in `tests/lint-ban.test.ts` precisely because they are the whole surface
  through which a tradie's phone can be made to ring. Phase 7's reach-latency read is the next
  legitimate addition and should carry its own header.
- `HOT_ESCALATION_CAP` is 25 per tick. A backlog drains oldest-first over successive minutes
  rather than in one burst of charged messages.
- **A remote run of `tests/escalation.test.ts` claims and records any other hot, threaded,
  unescalated reply present at the time** — cross-tenant by design. While sms is disarmed those
  rows get `sms_not_configured`, which is byte-identical to what the deployed tick would have
  written for them a minute later. Once a client is armed, that is no longer true, and the suite
  header says so.

## Self-Check: PASSED

Files asserted present:

```
FOUND: src/core/escalation/message.ts
FOUND: src/core/escalation/escalate-hot-leads.ts
FOUND: src/db/repository/escalations.ts
FOUND: tests/escalation-message.test.ts
FOUND: tests/escalation.test.ts
```

Commits asserted present: `fa1eef2`, `5e20539`.
