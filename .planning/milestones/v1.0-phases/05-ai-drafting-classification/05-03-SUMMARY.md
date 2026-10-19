---
phase: 05-ai-drafting-classification
plan: 03
subsystem: cadence
tags: [onboarding, activation-gate, state-machine, pause-reason, onb-03, d-07, d-05]
status: complete
requires:
  - "05-01: CADENCE_PAUSE_REASONS widened with 'onboarding' (vocabulary + CHECK only), message_templates table with write-once approved_at"
  - "Phase 3: fromPaused matrix, pauseWhereActive/resumeWherePaused/upgradePauseReason, applyResumeRewindow's onlyCadenceIds scope"
  - "Phase 4 (04-02): the guarded upgradePauseReason statement the third pause reuses unchanged"
provides:
  - "src/core/drafting/onboarding-gate.ts — hasApprovedTemplateSet + approveTemplateVersion"
  - "the transition matrix is total over 'onboarding', with the stickiness order pinned by tests"
  - "born-paused cadences: quote_opened for an unapproved tenant creates, materializes and pauses in ONE transaction"
  - "UpgradablePauseReason — the downgrade into the gate is untypeable"
  - "templates.{insertVersion,approveWhereUnapproved,listVersions,approvedSetStatus}"
  - "resumeCadence's onboarding_gated result + its console message"
  - "tests/helpers/seed.ts seedApprovedTemplateSet"
affects:
  - "05-05 (console template editor + attestation action — consumes approveTemplateVersion and approvedSetStatus)"
  - "05-04 (drafting pass: a born-paused cadence's touches never reach needs_draft until approval)"
  - "any future suite driving consumeQuoteEvents — it must seedApprovedTemplateSet or get a paused cadence"

tech-stack:
  added: []
  patterns:
    - "matrix-derived writes: pauseClient asks cadenceTransition which pauses it may upgrade, rather than naming reasons"
    - "type-level ordering: UpgradablePauseReason makes the forbidden downgrade a compile error"
    - "same-transaction proof via Postgres now(): created_at == updated_at is only true inside one transaction"

key-files:
  created:
    - src/core/drafting/onboarding-gate.ts
    - tests/onboarding-gate.test.ts
  modified:
    - src/core/cadence/transitions.ts
    - src/core/cadence/controls.ts
    - src/core/cadence/consume-events.ts
    - src/db/schema/cadences.ts
    - src/db/repository/for-tenant.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/{action-state,actions}.ts
    - tests/{cadence-transitions,pause-upgrade,cadence-consume-events,cadence-tick}.test.ts
    - tests/helpers/seed.ts

key-decisions:
  - "operator_resumed is a NO-OP at an onboarding pause — the only paused cell in the matrix where a human's resume does not move a cadence"
  - "The new stickiness note is note 7, appended, not note 4 — inserting it would silently repoint four cross-file 'note 6' references"
  - "resumeCadence reports onboarding_gated as its own kind, never not_paused"
  - "pauseClient upgrades onboarding-paused cadences to client_paused"
  - "UpgradablePauseReason excludes 'onboarding' from upgradePauseReason's `to` at the type level"
  - "approvedSetStatus is driven from cadence_touch_templates, never from message_templates"
  - "A born-paused cadence is counted `created`, not `stopped` — it is waiting, not declined"

patterns-established:
  - "Pause-reason coverage guard: every CADENCE_PAUSE_REASONS member must have a hand-decided matrix row; totality is not coverage"
  - "Whole-input-space negative assertions: no (status, reason, event) triple may move INTO 'onboarding'"
  - "Scope assertions need an ACTIVE out-of-scope fixture — a paused one is skipped by applyResumeRewindow anyway and proves nothing"

requirements-completed: []

coverage:
  - id: D1
    description: "quote_opened for a tenant without a fully-approved SMS template set creates and materializes the cadence, then pauses it 'onboarding' in the same transaction — no quote opened during onboarding is lost (D-07)"
    requirement: "ONB-03"
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#BORN PAUSED: a tenant with no approved templates gets a paused cadence with a full schedule"
        status: pass
    human_judgment: false
  - id: D2
    description: "Approving the template version that completes the set resumes exactly the paused-where-reason='onboarding' cadences and re-windows only the RETURNING ids"
    requirement: "ONB-03"
    verification:
      - kind: integration
        ref: "tests/onboarding-gate.test.ts#resumes ONLY the onboarding-paused cadences, and re-windows only those"
        status: pass
      - kind: integration
        ref: "tests/onboarding-gate.test.ts#APPROVES WITHOUT RESUMING while the set is still incomplete"
        status: pass
    human_judgment: false
  - id: D3
    description: "hasApprovedTemplateSet is FALSE for a tenant with zero SMS touch templates — the vacuous-truth guard (T-5-13)"
    requirement: "ONB-03"
    verification:
      - kind: integration
        ref: "tests/onboarding-gate.test.ts#IS FALSE FOR A TENANT WITH NO SMS TIMING TEMPLATES — the vacuous-truth guard"
        status: pass
    human_judgment: false
  - id: D4
    description: "customer_reply at an onboarding pause upgrades the reason, so a later template approval cannot revive a live conversation (D-05 extended)"
    verification:
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#paused|onboarding + customer_reply -> paused(customer_reply)"
        status: pass
      - kind: integration
        ref: "tests/pause-upgrade.test.ts#upgrades an ONBOARDING pause to a customer-reply pause"
        status: pass
    human_judgment: false
  - id: D5
    description: "client_paused at an onboarding pause upgrades to client_paused, so template approval cannot auto-resume a cadence the client asked to pause"
    verification:
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#paused|onboarding + client_paused -> paused(client_paused)"
        status: pass
      - kind: integration
        ref: "tests/pause-upgrade.test.ts#upgrades an ONBOARDING pause to a client pause, through pauseClient"
        status: pass
    human_judgment: false
  - id: D6
    description: "An operator resume cannot lift an onboarding pause (T-5-10) while a paused row with NULL reason stays operator-reachable"
    verification:
      - kind: integration
        ref: "tests/pause-upgrade.test.ts#AN OPERATOR RESUME CANNOT LIFT AN ONBOARDING PAUSE — approval is the only unlock"
        status: pass
      - kind: integration
        ref: "tests/pause-upgrade.test.ts#AND STILL RESUMES A PAUSED ROW WITH NO REASON — the note-6 row stays reachable"
        status: pass
      - kind: integration
        ref: "tests/pause-upgrade.test.ts#the repository guard refuses it too, called directly — not only through the control"
        status: pass
    human_judgment: false
  - id: D7
    description: "Closing events (won/lost/opt-out/removed) stop an onboarding-paused cadence exactly as they stop any paused cadence"
    verification:
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#cadenceTransition — decided-quote dominance (the consumer depends on this)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The attestation is write-once: a second approval is refused and the stored approved_at/approval_note are unchanged (T-5-11)"
    verification:
      - kind: integration
        ref: "tests/onboarding-gate.test.ts#REFUSES A SECOND APPROVAL AND LEAVES THE ATTESTATION BYTE-UNCHANGED (D-06)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The operator-facing sentence at the gate names the missing thing and the action that supplies it, rather than reading as a permission refusal"
    verification: []
    human_judgment: true
    rationale: "RESUME_CADENCE_ONBOARDING_GATED_MESSAGE has no console screen yet — 05-05 builds the template editor this sentence points an operator at. Whether the wording actually sends the operator to the right place is a judgement about a UI that does not exist."

# Actuals (#2632) — estimateTokens scale (chars/4) over the realized diff.
actuals:
  tokens: 24000
  tasks: 3
  commits: 3

duration: 44min
completed: 2026-08-30
---

# Phase 5 Plan 03: The ONB-03 Activation Gate Summary

**A cadence for a client with no approved template set is now born paused with
the third pause reason, materialized schedule and all — and approving that
client's fifth SMS template is the one act in the codebase that resumes it, past
a matrix arm and a database predicate that both refuse an operator.**

## Performance

- **Duration:** 44 min
- **Started:** 2026-08-30T16:48:49Z
- **Completed:** 2026-08-30T17:32:59Z
- **Tasks:** 3
- **Files modified:** 14 (2 created, 12 modified), +1822 / −54

## What Was Built

**Task 1 — the matrix and the writes learn the third reason** (commit `5bfbd54`).

`transitions.ts` gains **note 7**: the stickiness order
`customer_reply > client_paused > onboarding`, and the argument for why the
newest reason sits at the bottom — its unlock is the broadest AUTOMATIC one
(approving a template set resumes every onboarding-paused cadence of a tenant in
one write, with nobody looking at any individual conversation), while the other
two each carry a specific human signal about a specific cadence.

Four arms changed in `fromPaused`:

| Event | At `paused(onboarding)` | Why |
| --- | --- | --- |
| `customer_reply` | upgrade to `customer_reply` | a later approval must not revive a live conversation |
| `client_paused` | upgrade to `client_paused` | a later approval must not release a handbrake the client pulled |
| `client_resumed` | no-op, with its **own sentence** | the reason it stays shut is different from D-05's |
| `operator_resumed` | **no-op** | the only paused cell in the file where a human's resume moves nothing |

That last cell is the plan's real content. Every other pause records a
*judgement* a human may overrule; this one records a *missing fact* — no
client-approved words exist — and no amount of authority conjures words.
Resuming would produce a cadence the console calls "running" whose every touch
parks unsent in `needs_draft`.

The refusal is enforced twice on purpose (T-5-10): at the matrix, and at
`operatorResumeWherePaused`, which gained
`pause_reason IS DISTINCT FROM 'onboarding'`. `IS DISTINCT FROM` rather than
`<>` is load-bearing and has its own named test — a plain `<>` is NULL for a
NULL column, which would have taken the `transitions.ts` note-6 row (the one
that method exists to reach) silently out of scope and left a paused cadence
nothing on earth could resume.

**Task 2 — `onboarding-gate.ts`** (commit `80aa8c7`). `hasApprovedTemplateSet`
and `approveTemplateVersion`, plus four repository methods
(`insertVersion`, `approveWhereUnapproved`, `listVersions`, `approvedSetStatus`).
The approval is the `resumeClient` composition verbatim: attestation and
reason-scoped resume in one transaction, `applyResumeRewindow` outside it over
the ids the resume write RETURNED.

**Task 3 — the born-paused creation path** (commit `786c337`). `CreationInputs`
gains `hasApprovedTemplateSet`, resolved once per run per tenant inside the same
memo that already seeds templates and settings — a run with twenty
`quote_opened` events still asks once. Shape (a) pauses the cadence *after*
materialization and *inside* the creation transaction. Shapes (b) suppressed,
(c) no-contact and (d) replay are untouched.

## Task Commits

1. **Task 1: transition matrix + repository writes** — `5bfbd54` (feat)
2. **Task 2: onboarding-gate.ts** — `80aa8c7` (feat)
3. **Task 3: born-paused creation path** — `786c337` (feat)

## Decisions Made

**1. The new header note is note 7, appended — not note 4 as the plan said.**
Inserting at 4 would have shifted notes 4/5/6 to 5/6/7, and **four other files
reference "note 6" by number** (`for-tenant.ts` twice, `pause-upgrade.test.ts`,
`controls.ts`). Renumbering breaks every one of them silently — a comment that
now points at the wrong rule reads exactly like a comment that points at the
right one. The stickiness order is a new fact, not an amendment to the existing
three, so it costs nothing to append.

**2. `operator_resumed` at an onboarding pause is a matrix no-op, not merely a
repository refusal.** The plan located the refusal in
`operatorResumeWherePaused` alone. Leaving the matrix saying "move to active"
while no writer performs it recreates **exactly** the 03-05 `upgrade_unsupported`
gap this codebase spent two plans closing — a matrix that prescribes a write
nothing can do. Both layers now agree, and `resumeCadence` refuses at the matrix
before it ever reaches the write (which is why the repository guard has its own
direct-call test: a guard that exists only because the caller checked first is
not a guard).

**3. `resumeCadence` reports `onboarding_gated`, its own result kind.** Following
03-05's recorded rule about `upgrade_unsupported`: *nothing-should-happen* and
*something-should-have-happened-and-did-not* have different consequences.
`not_paused` against a cadence the same screen renders as paused is a lie an
operator acts on — they reload, tap again, and conclude the button is broken,
instead of going and approving the templates, which is the one thing that works.
The console message names the missing thing and the action that supplies it.

**4. The downgrade into the gate is untypeable, not merely untested.**
`upgradePauseReason`'s `to` takes a new `UpgradablePauseReason`
(`Exclude<CadencePauseReason, 'onboarding'>`). Relabelling a `customer_reply`
pause *down* to `onboarding` would hand a live conversation to the next bulk
template approval — the D-05 breach, arriving through the one write that is
*allowed* to change a pause reason. This forced `pauseReasonFor` to narrow too,
which is where the module-load assertion now lives.

**5. `approvedSetStatus` is driven from `cadence_touch_templates`, never from
`message_templates`.** Only the timing table knows which touches will actually be
sent. Reading the wording table would answer "is every wording they happen to
have approved, approved" — vacuously true for a tenant with none, which is
precisely the tenant the gate exists to stop.

**6. A born-paused cadence is counted `created`, not `stopped`.** It is waiting,
not declined; counting it as a stop would tell an operator reading the tick
counts that four quotes were turned away during onboarding.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug in my own test] The scope assertion passed for the wrong reason**

- **Found during:** Task 2, first green run of `onboarding-gate.test.ts`.
- **Issue:** the acceptance criterion is "`applyResumeRewindow` receives exactly
  the RETURNING ids". I asserted it by showing a **customer_reply-paused**
  cadence's schedule was untouched. But `applyResumeRewindow` skips every
  non-active cadence anyway (`if (cadence.status !== 'active') continue`), so
  that row stays put whether the scope is the returned ids or the whole tenant.
  Thirteen green tests, and the one that mattered proved nothing. Same shape as
  05-01's throwing-client test that passed without the client being called.
- **Fix:** added a third fixture — an **ACTIVE cadence with equally overdue
  touches**, outside the resume. It is also the real case the scope exists for:
  event consumption keeps running while a client onboards, so by approval time
  the tenant holds cadences that were never gated. A tenant-wide re-window moves
  those too, producing `touchesRescheduled: 4` instead of 2.
- **Commit:** `80aa8c7`

**2. [Rule 1 — Bug in my own fixture] `pauseClient` had already upgraded the row
the operator-resume test was asserting the gate against**

- **Found during:** Task 1, first remote run of `pause-upgrade.test.ts` — two
  failures, loudly.
- **Issue:** I seeded the onboarding-paused fixture *before* the `pauseClient`
  block, and wrote a comment claiming it was seeded after. `pauseClient` upgrades
  every onboarding-paused cadence in the tenant, so by the time
  `resumeCadence` ran the row read `client_paused` — and was correctly resumed.
- **Fix:** the fixture is seeded inside the first block that needs it, with the
  reason recorded in the file so the next person does not repeat it.
- **Commit:** `5bfbd54`

**3. [Rule 3 — Blocking] Existing suites now create paused cadences**

- **Found during:** Task 3.
- **Issue:** `tests/cadence-tick.test.ts` drives `markChaseEligible` +
  `runCadenceTick` against a tenant with no approved templates. Four assertions
  broke because the cadence is now born `paused(onboarding)` — correctly.
- **Fix:** a `seedApprovedTemplateSet` helper, called in the two suites whose
  subject is the Phase 3 pipeline rather than the gate. This is not a workaround:
  an approved template set is the true precondition for the pipeline those suites
  assert. Every other remote suite was checked and needed nothing.
- **Commit:** `786c337`

### Judgement calls recorded because they differ from the plan's wording

**4. The plan says "widen `upgradePauseReason` so the guarded statement also
permits FROM 'onboarding'". Nothing needed widening.** That method has taken
`{ from, to }` as parameters since 04-02, and `pauseForReply` already reads
`from` off the row and `to` off the matrix outcome. So the third pause reason
arrived through a code path that needed **no change at all** — which is the
04-02 design working as intended, and is recorded here because "no diff" looks
identical to "forgotten" in a later audit. The `to` side moved in the opposite
direction from the plan's wording: it was **narrowed**, not widened (decision 4).

**5. The plan calls the memo `loadTenantContext`; it is `prepare` /
`CreationInputs`.** Same memo, same "twenty quote_opened events still seed once"
property. Named here so a reader of the plan can find it.

**6. No `CadenceTickResult` counter for born-paused cadences.** The phase's own
symbol inventory lists the drafting and classification count fields and not this
one, and D-07's visibility requirement is met by the paused cadence rows
themselves — five materialized touches an operator can read. Left for 05-05's
console work if it wants a number.

---

**Total deviations:** 3 auto-fixed (2 bugs in my own tests, 1 blocking), 3
judgement calls recorded.
**Impact:** two of the three auto-fixes are tests that were green for the wrong
reason. No scope creep; the one addition beyond the plan (`onboarding_gated` as a
distinct result kind + its message) exists because the plan's own instruction to
give `resumeCadence` the predicate would otherwise have made it lie to an
operator.

## Verification Evidence

| Check | Result |
| --- | --- |
| `npx vitest run tests/cadence-transitions.test.ts` (pure) | **137 passed** (was 125) |
| `npm run test:remote -- tests/pause-upgrade.test.ts` | **15 passed** (was 10) |
| `npm run test:remote -- tests/onboarding-gate.test.ts` | **13 passed** (new suite) |
| `npm run test:remote -- tests/cadence-consume-events.test.ts` | **15 passed** (was 11) |
| `npm run test:remote -- tests/cadence-tick.test.ts` | **8 passed** |
| `npm run test:remote -- tests/cadence-controls.test.ts` | **14 passed** |
| **Full `npm run test:remote`** (serialized, one run) | **77 files, 1653 tests, all pass** (baseline 76/1601-equivalent) |
| `npm test` (pure) | **1274 tests passed, ZERO assertion failures** |
| `npm test` failed *files* | 31 — was 30; the delta is exactly `onboarding-gate.test.ts`, a new remote suite. All 31 verified to be the WR-09 disposable-stack gate by counting distinct error strings (**one**), not assumed |
| `npx tsc --noEmit` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| File deletions across the three commits | **0** (`git diff --diff-filter=D`) |
| Crons re-armed / lease released after every remote run | confirmed in each run's output |

### The must_haves truths, each pinned by a named test

| Truth | Test |
| --- | --- |
| Born paused, materialized, same transaction | "BORN PAUSED: a tenant with no approved templates gets a paused cadence with a full schedule" |
| Approval resumes only reason='onboarding', re-windows only RETURNING ids | "resumes ONLY the onboarding-paused cadences, and re-windows only those" |
| Vacuous-truth guard | "IS FALSE FOR A TENANT WITH NO SMS TIMING TEMPLATES — the vacuous-truth guard" |
| customer_reply upgrades an onboarding pause | matrix cell + "upgrades an ONBOARDING pause to a customer-reply pause" |
| client_paused upgrades an onboarding pause | matrix cell + "upgrades an ONBOARDING pause to a client pause, through pauseClient" |
| Operator resume refuses; NULL-reason row stays reachable | three named tests in `pause-upgrade.test.ts` |
| Closing events stop an onboarding-paused cadence | "decided-quote dominance" block, now four live states |
| Nothing writes 'onboarding' as an upgrade target | whole-input-space matrix assertion + the `@ts-expect-error` block |

### Surprises & findings

**The same-transaction claim turned out to be directly observable.** Task 3's
acceptance criterion asks to assert that the pause commits inside the creation
transaction, "via the transactional seam or the composed repository call shape" —
i.e. by inspection. It does not need inspection: Postgres `now()` is
`transaction_timestamp()`, fixed for the whole transaction. `created_at` defaults
to `now()` and `pauseWhereActive` sets `updated_at` to `now()`, so
**`created_at === updated_at` is true if and only if the pause ran inside the
create's transaction.** A pause committed separately leaves `updated_at` strictly
later. That is now the assertion, and it is a genuine one rather than a
restatement of the code.

**A vocabulary member can be appended without a single test going red.**
`tests/cadence-transitions.test.ts` has a totality test over
`CADENCE_STATUSES × [null, ...CADENCE_PAUSE_REASONS] × CADENCE_EVENTS`, and
05-01's append passed it cleanly — because totality only asserts that every
triple *returns*, which a new member satisfies by falling through somebody else's
branch. **Totality is not coverage.** Added a pause-reason coverage guard beside
the existing status one: every member of `CADENCE_PAUSE_REASONS` must have a
hand-decided row in the matrix. The next member will fail at the moment the
vocabulary changes rather than the moment somebody notices.

**The `@ts-expect-error` block is honest about how weak its runtime half is.**
With the directive deleted, the downgrade write *would* land — the column's CHECK
admits `'onboarding'`, so types are the whole guard. The test says so in a
comment and asserts the write's real effect rather than pretending a runtime
guard exists. The complementary runtime guarantee is the pure whole-input-space
assertion that the matrix never *prescribes* the move.

## Known Stubs

| Stub | File | Reason / resolved by |
| --- | --- | --- |
| `unapprovedTouchNumbers` has no caller | `src/core/drafting/onboarding-gate.ts` | **Intentional.** It is the console's partial-progress read ("which touches still need words"), which **05-05** builds. Exported and covered by three named tests now so that plan renders a number whose definition is already fixed. |
| `templates.insertVersion` / `listVersions` have no production caller | `src/db/repository/for-tenant.ts` | **Intentional** — the phase inventory assigns the template editor to **05-05**. Both are exercised by `tests/onboarding-gate.test.ts`, including the version-numbering and save-is-not-attestation properties. |
| `RESUME_CADENCE_ONBOARDING_GATED_MESSAGE` renders on a screen with no route to the fix yet | console `action-state.ts` | The message points an operator at the template editor **05-05** builds. Until then the sentence is correct and the destination does not exist. |
| The `to` exclusion is a TYPE guard only; no CHECK forbids `'onboarding'` in `pause_reason` for an upgrade write | `src/db/schema/cadences.ts` | **Accepted, stated in the test.** A database-level guard would need a trigger comparing old and new values, which is a heavier mechanism than the risk warrants while every writer is in this repository and typechecked in CI. |

None of these prevent the plan's goal: no cadence can activate before its
client's templates are approved, by any route the codebase currently has.

## Deferred / Owed

- **Nothing owed from this plan.** Every command in the plan's `<verification>`
  block was run, plus `tests/cadence-controls.test.ts` and the four other suites
  that drive cadence creation, plus one full serialized `npm run test:remote`.
- **One plan-verification command needed adjusting.** Task 1's
  `<automated>` block is
  `npx vitest run tests/cadence-transitions.test.ts tests/pause-upgrade.test.ts`,
  but `pause-upgrade.test.ts` is a **remote** suite — a bare `vitest run` refuses
  it at the WR-09 gate. Run as
  `npx vitest run tests/cadence-transitions.test.ts` +
  `npm run test:remote -- tests/pause-upgrade.test.ts`. Both green.
- **`ONB-03` stays PENDING**, per the rule 05-01 recorded and 04-10 set: it is
  also claimed by **05-05**, and a requirement is marked by the LAST plan that
  claims it. `gsd-tools requirements.ready-ids` independently returned
  `0/1 ready`. This plan built the state-machine half; 05-05 builds the console
  an operator actually approves through, and a gap that disappears is
  indistinguishable from a gap that was fixed.
- Pre-existing and still open: the undeployed-commit note. This plan's changes
  are also undeployed. **This one matters more than the last two:** production
  still runs a build where a cadence for an unapproved tenant is born ACTIVE.
  Deploy before onboarding any real client.

## Threat Flags

None. All four register entries are implemented and asserted:

- **T-5-10** (operator resume lifting the gate) — refused at the matrix AND at
  `operatorResumeWherePaused`; three named tests, including the direct
  repository call and the NULL-reason non-regression.
- **T-5-11** (attestation overwrite) — `approveWhereUnapproved`'s
  `WHERE approved_at IS NULL`; the refused double-approve asserts `approved_at`,
  `approval_note` and `body` all unchanged.
- **T-5-12** (approval without evidence) — `approval_note` is a required
  parameter of `approveTemplateVersion`, not an optional one; the console action
  that must require it is 05-05's.
- **T-5-13** (vacuous set check) — the `length > 0` guard, written out rather
  than folded into the `every`, with the file's first and loudest named test.

No new network surface, no new endpoint, no new schema object. One new
CHECK-free type narrowing and one new predicate on an existing guarded write.

## Next Phase Readiness

`hasApprovedTemplateSet`, `approveTemplateVersion`, `approvedSetStatus` and
`unapprovedTouchNumbers` are the exact four seams **05-05**'s console work needs,
and all four are pinned by tests against the hosted database. The drafting pass
(**05-04**) inherits a useful invariant for free: a touch belonging to an
onboarding-paused cadence never reaches `needs_draft`, so the batching work does
not have to special-case unconfigured tenants.

**One thing 05-05 must not do:** offer an operator a "resume anyway" affordance
next to the gated cadence. The refusal is the product (T-5-10), and the button
that belongs there goes to the template editor.

## Self-Check: PASSED

- `src/core/drafting/onboarding-gate.ts` — FOUND
- `tests/onboarding-gate.test.ts` — FOUND
- Commits `5bfbd54`, `80aa8c7`, `786c337` — all FOUND in `git log`

---
*Phase: 05-ai-drafting-classification*
*Completed: 2026-08-30*
