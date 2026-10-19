---
phase: 04-messaging-gateway
plan: 09
subsystem: messaging
tags: [reconcile, opt-out, compliance, dispatch-isolation, failure-injection, t-4-18, cr-02, cr-03]

# Dependency graph
requires:
  - phase: 04-messaging-gateway
    provides: "04-04's reconcile sweep and ClickSend poll readers; 04-08's anyChannelEnabled deployment gate; receipts.ts's four-field corpus (c47dd1d, fe7520c); the two captured real payloads in docs/external-registrations.md"
provides:
  - "providerVerdictCorpus(fields) — the ONE answer to 'what did the provider say about this message', exported from receipts.ts and asked from both receipts and reconcile"
  - "A provider opt-out backstop that CAN fire: the probe reads status, status_text, status_code and error_text, which is where the verdict prose actually lives"
  - "Reconcile fixtures pinned to the two captured REAL payloads plus a synthesised opt-out whose token sits only in status_text — the suite can no longer be green on a shape ClickSend does not emit"
  - "The reconcile activation guard asks anyChannelEnabled('sms'), so a tenant-only activation is still swept nightly"
  - "Per-send isolation: a failed setOutcome costs exactly one NULL outcome, never the sends behind it"
  - "Per-tenant isolation over the SEND pass, not just the claim — the loop's documented invariant is true again"
  - "tests/cadence-dispatch-isolation.test.ts — the failure-injection suite for both isolation levels"
affects: [04-VERIFICATION gaps 3 and 4, phase-05 drafting cadence, phase-07 revenue attribution, first-client onboarding]

actuals:
  tokens: 23000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A shared normalization builder for third-party free text: every field passes through codeOf individually (bounded, digit-run-redacting) and the joined result is only ever SEARCHED, never stored or logged"
    - "Fixtures pinned to captured real payloads, with the real failure shape asserted as a NEGATIVE — a widened classifier must be proven silent on the shapes that are not what it now detects"
    - "Two-level failure isolation around a loop whose inner work has already committed: an inner guard that bounds the loss to one record, an outer guard that bounds it to one tenant"

key-files:
  created:
    - tests/cadence-dispatch-isolation.test.ts
  modified:
    - src/core/messaging/receipts.ts
    - src/core/messaging/reconcile.ts
    - src/core/cadence/dispatch.ts
    - tests/messaging-reconcile.test.ts

key-decisions:
  - "The corpus builder was EXPORTED from receipts.ts rather than duplicated in reconcile.ts, because a private copy is exactly how this defect was born: classify's corpus was widened to four fields on 2026-08-30 and the sibling probe one file over was not, so the same question had two answers and only one of them was right"
  - "The probe passes fields in the SAME ORDER as classify (status, status_text, status_code, error_text). Order does not change the result for a substring search, but a shared builder called with two different orders is a shared builder in name only"
  - "The outcome='failed' corroboration in recordOptOuts was left exactly as it was and is now MORE load-bearing, not less: widening the corpus to include prose widens what an OPT substring can match, and isOptOutCode is a deliberately tolerant check that OPT_IN satisfies"
  - "The reconcile guard was moved onto anyChannelEnabled('sms') in this plan rather than deferred, because 04-08 made tenant-only activation real: a client armed by an override row would send real SMS that the nightly sweep — still reading the global row — would never reconcile, which is the T-4-18 hole with a second door"
  - "Neither new catch retries. A setOutcome failure means the send DID happen and we failed to write down what the provider said; NULL is the honest record of that, and a retry after an accepted send is how a customer gets messaged twice (D-07)"
  - "Both guards were needed, not either one: the per-send guard cannot catch a throw that arises in the send loop itself, and the per-tenant guard alone would still lose every remaining send of the tenant it caught for. The suite proves each with its own injection"
  - "The invented opt-out fixture was replaced rather than kept alongside the real ones. It asserted a status field carrying an opt-out token, which the live capture contradicts — keeping it would preserve a green test for a payload shape the provider does not emit, which is the specific thing that let this backstop sit dead"

patterns-established:
  - "When a classifier is widened because live data contradicted an assumption, EVERY sibling reader of the same third-party payload is a suspect — the fix is a shared builder, and the review that finds the second instance is the one that proves the first fix was incomplete"
  - "A widened detector is verified by its negatives: the captured real payloads are asserted to produce NO detection, so the tolerance cannot silently grow into over-suppression"
  - "Failure injection at the repository seam (vi.mock('@/db/repository')) is the house pattern for throws hosted Postgres will not produce on demand — cadence-tick-isolation.test.ts is the model and this suite states the same rationale"

requirements-completed: [MSG-01, MSG-03]

coverage:
  - id: D1
    description: "providerVerdictCorpus(fields) exported from receipts.ts — per-field codeOf over a readonly field list, joined with a single space; classify's call site uses it"
    requirement: MSG-01
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#the opt-out evidence pass"
        status: pass
      - kind: integration
        ref: "npm run test:remote -- tests/receipts.test.ts"
        status: pass
      - kind: other
        ref: "grep -q 'export function providerVerdictCorpus' src/core/messaging/receipts.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The reconcile opt-out probe reads all four verdict-bearing fields through the shared builder — the T-4-18 backstop fires on a status_text verdict"
    requirement: MSG-03
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#suppresses through suppressFromInbound with source provider_opt_out"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#THE OPT_IN GUARD: a non-failed send is not evidence of an opt-out"
        status: pass
    human_judgment: false
  - id: D3
    description: "The backstop stays SILENT on both captured real payloads — the delivered one and the absent-subscriber failure, even on a failed send"
    requirement: MSG-03
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#stays SILENT on the captured real FAILED payload, even on a failed send"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#does not look up owners at all when no history row said opt-out"
        status: pass
    human_judgment: false
  - id: D4
    description: "The reconcile activation guard asks anyChannelEnabled('sms'), so a tenant-only activation is swept — with the zero-HTTP-calls skip preserved"
    requirement: MSG-01
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#skips with NO HTTP CALLS when NO sms row is enabled anywhere"
        status: pass
      - kind: unit
        ref: "tests/messaging-reconcile.test.ts#RUNS when any sms row is enabled — a TENANT-ONLY activation is still swept"
        status: pass
    human_judgment: false
  - id: D5
    description: "Per-send guard: a rejected setOutcome leaves that one ledger row NULL and every remaining claimed send still goes out and records its outcome"
    requirement: MSG-01
    verification:
      - kind: unit
        ref: "tests/cadence-dispatch-isolation.test.ts#sends BOTH touches when the first outcome write rejects"
        status: pass
      - kind: unit
        ref: "tests/cadence-dispatch-isolation.test.ts#performs and records tenant B’s send while every write for A rejects"
        status: pass
    human_judgment: false
  - id: D6
    description: "Per-tenant guard: a throw inside performSends costs exactly one tenant's pass; the tick reaches the remaining tenants"
    requirement: MSG-01
    verification:
      - kind: unit
        ref: "tests/cadence-dispatch-isolation.test.ts#dispatchDueTouches — a throw inside the send pass costs ONE tenant’s pass > still dispatches tenant B"
        status: pass
    human_judgment: false
  - id: D7
    description: "T-2-02 log discipline on both new catches — ledger and tenant ids only, caught values discarded"
    requirement: MSG-01
    verification:
      - kind: unit
        ref: "tests/cadence-dispatch-isolation.test.ts#never lets a customer address, a body or a caught value reach a log line"
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-08-30
status: complete
---

# Phase 04 Plan 09: CR-02 / CR-03 Gap Closure Summary

**The provider-opt-out compliance backstop can now actually fire — it reads the fields ClickSend writes its verdicts into rather than two fields the live capture proves carry none — and a failed ledger write now costs exactly one NULL outcome instead of the rest of the tick.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-30T04:06:00Z
- **Completed:** 2026-08-30T04:24:00Z
- **Tasks:** 2 of 2
- **Files created/modified:** 5 (1 created, 4 modified)

## Accomplishments

- **The T-4-18 backstop was dead code, and now is not.** `applyHistory` decided "did the provider refuse this because the recipient opted out with them" from `status` + `status_code` alone. The account's own live capture records what those two fields contain: `Sent`/`Failed` and `201`/`301`, whose codes are `SENT_201` and `FAILED_301`. Neither contains `OPT` and neither ever will — the verdict prose lives in `status_text` and `error_text`. `recordOptOuts` therefore received an empty list on every real sweep and reported `optOutsRecorded: 0` indistinguishably from "nothing was missed". The probe now reads all four verdict-bearing fields.
- **There is one corpus builder, not two.** This defect exists because there *were* two: `classify`'s corpus was widened to four fields on 2026-08-30 (`c47dd1d`, `fe7520c`) when the first live sends contradicted the field assumptions, and the sibling probe one file over was not touched. `providerVerdictCorpus(fields)` is now exported from `receipts.ts` and called from both, per field through `codeOf` — never one joined string, because `codeOf` caps at 48 characters and the real `status_text` is a 114-character sentence.
- **The fixtures can no longer be green on a shape ClickSend does not emit.** The invented opt-out fixture (an opt-out token in the `status` field) is gone. In its place: the two captured real payloads asserted as **negatives** — the delivered one and the absent-subscriber failure, the latter even with our own `outcome = 'failed'` — plus a synthesised opt-out whose token sits only in `status_text`, which fails against any probe that does not read that field.
- **The sweep now covers the activation 04-08 made real.** `reconcileMessaging`'s guard read the GLOBAL `messaging_config` row, which was the right question only while the send path asked the same one. After 04-08 a single client's override row arms real SMS with the global row off — and those sends, and the STOPs answering them, would never have been reconciled. The guard asks `anyChannelEnabled('sms')`, with the zero-HTTP-calls skip property intact and still asserted.
- **One client's transient database error can no longer starve the other fourteen.** `performSends` guarded `sender.send()` but not the `setOutcome` after it, and `dispatchDueTouches` awaited `performSends` *outside* the per-tenant try/catch. A pooler hiccup on one ledger write threw out of the send pass and out of the tick: every remaining `PendingSend` for that tenant — already marked `sent`, its ledger row already claimed in a **committed** transaction — was stranded at `outcome IS NULL` forever, and every remaining tenant was skipped. Two guards now bound the two losses, and neither retries: the send happened, and NULL is the honest record (D-07).

## Task Commits

Each task was committed atomically:

1. **Task 1: CR-02 — shared four-field verdict corpus, live-shaped fixtures, guard alignment** — `be85e4e` (fix, TDD: 12 failing tests confirmed before any implementation edit)
2. **Task 2: CR-03 — per-send and per-tenant isolation guards + failure-injection suite** — `02cf3a1` (fix, TDD: all 5 tests of the new suite confirmed failing against the unguarded code)

_TDD note: both tasks were executed RED-then-GREEN inside a single commit each, per the plan's `tdd="true"` task shape (the plan is `type: execute`, not a plan-level TDD gate)._

## Files Created/Modified

- `src/core/messaging/receipts.ts` — NEW exported `providerVerdictCorpus(fields)` taking a readonly `(string | number | null | undefined)[]`: blanks filtered, each survivor through `codeOf`, joined with a space. Its doc block carries the per-field-budget argument (previously inline at the `classify` call site) and states plainly that this is the one answer to "what did the provider say", asked from two files. `classify`'s call site now reads through it.
- `src/core/messaging/reconcile.ts` — the `:209` probe replaced with `isOptOutCode(providerVerdictCorpus([entry.status, entry.statusText, entry.statusCode, entry.errorText]))`; `codeOf` import dropped (`isOptOutCode` kept); `ReconcileDeps.getConfig` replaced with `anyEnabled?: typeof anyChannelEnabled`; the guard's comment rewritten to state the deployment-level question and why 04-08 changed the answer.
- `src/core/cadence/dispatch.ts` — try/catch around the `setOutcome` await in `performSends`, and around the `performSends` call in `dispatchDueTouches`. Both catches bind nothing. The `:546-552` isolation-invariant comment extended to say the guard covers the send pass, not just the claim, and why two guards rather than one.
- `tests/messaging-reconcile.test.ts` — `historyRow()`'s header now names its source document; `REAL_FAILED` added as the captured failure; the synthesised opt-out replaces the invented fixture; the guard describe drives `anyEnabled`; a tenant-only-activation test added; the pinned-interpolation set shrunk by the two `entry.*` entries the deleted template literal contributed.
- `tests/cadence-dispatch-isolation.test.ts` — NEW. `vi.mock('@/db/repository')` supplying `forAllTenants_cadenceTick` and a `forTenant` whose `transaction` resolves a canned `{ pending, refusals }` without invoking the callback (the claim internals are 04-03's tested ground) and whose `ledger.setOutcome` is the injection point. Refusals built as zeros over the exported `DISPATCH_REFUSALS`. ACMA `0491 570 1xx` fiction addresses throughout.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: **the fix is a shared builder, not a second widened probe.** The defect exists precisely because the same question had two implementations and only one of them was corrected when live data arrived; writing a second correct copy would leave the same structure that produced the bug, waiting for the next payload surprise.

The second: **both catches discard the caught value and neither retries.** The discard is T-2-02 — a driver error can quote the statement, whose parameters include a customer's address. The no-retry is D-07 — the message went out; a retry is how the customer gets it twice.

## Deviations from Plan

None — plan executed exactly as written.

Two small judgment calls worth recording, neither a deviation from an instruction:

- The `REAL_FAILED` fixture is given a distinct `messageId` (`CS-FAILED`) so a test using both real payloads in one `listHistory` result cannot silently rely on them being the same row.
- The comment introducing the synthesised opt-out describes the fixture it replaces without spelling the old token, so the plan's `! grep -q "RECIPIENT_OPT_OUT"` acceptance check reads as intended rather than tripping on prose.
- **[Rule 1 — state bookkeeping]** `state advance-plan` reported `previous_plan: 3 → current_plan: 4` against a phase that has ten plans and, as of this commit, ten SUMMARYs — the counter had drifted (04-10 was executed before 04-09, and the counter was already behind that). `STATE.md`'s Current Position line was corrected to `Plan: 10 of 10 — every plan has a SUMMARY` with status `Phase 04 execution complete; ready for verification`. No planning artifact was otherwise touched; the progress bar was already correct at 30/30.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/messaging-reconcile.test.ts` | 24 passed (12 failing before the fix) |
| `npx vitest run tests/cadence-dispatch-isolation.test.ts` | 5 passed (5 failing before the guards) |
| `npm test` (full pure suite) | **1169 passed, 0 failed** (28 integration files refused by the WR-09 disposable-stack guard, as expected on a bare `npm test`) |
| `npm run test:remote -- tests/receipts.test.ts tests/messaging-reconcile.test.ts` | 40 passed — the recorded house command for these suites, run serialized, crons paused and re-armed |
| `npm run test:remote` (full) | **70 files, 1512 tests, all passed** — crons paused and re-armed cleanly |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| Migration generated? | **None.** Nothing in this plan touches schema; the drizzle journal is untouched |

**Acceptance criteria greps, all passing:**

- `grep -q "export function providerVerdictCorpus" src/core/messaging/receipts.ts` — and `classify` calls it
- `grep -q "providerVerdictCorpus" src/core/messaging/reconcile.ts`
- ``! grep -q "codeOf(\`" src/core/messaging/reconcile.ts`` — the two-field template-literal probe is gone
- `grep -q "entry.statusText"` and `grep -q "entry.errorText"` in `reconcile.ts` — all four fields reach the probe
- `! grep -q "RECIPIENT_OPT_OUT" tests/messaging-reconcile.test.ts` — the invented fixture is gone; the absent-subscriber sentence is present and the synthesised opt-out's `OPT` token appears only in `statusText`
- `grep -q "anyEnabled" src/core/messaging/reconcile.ts` — the guard asks the deployment-level question
- Both new catch blocks are `} catch {` — nothing bound, nothing interpolated (`grep -n "catch {"` shows four in the file, the two originals and the two new)

## Threat Mitigations

| Threat | Disposition | Evidence |
|---|---|---|
| T-4-18 (repudiation: the opt-out backstop cannot fire) | mitigated | The probe reads all four verdict-bearing fields via the shared builder; a `status_text` opt-out now suppresses through `suppressFromInbound` with source `provider_opt_out`, asserted in `tests/messaging-reconcile.test.ts` |
| T-4GC-04 (denial of service: one tenant's DB error starves the rest) | mitigated | Per-send and per-tenant guards, both proven by injection at the repository seam — `sender.sent` reaches every tenant while every write for one of them rejects |
| T-2-02 (information disclosure via the new catches) | mitigated | Neither catch binds the caught value; the `console.error` spy asserts no line contains the injected secret, the fixture address or the body |
| T-4GC-05 (tampering: provider free text reaching a comparison raw) | mitigated | Every field passes through `codeOf` (48-char cap, digit-run redaction) before any comparison; the joined corpus is searched only, never stored or logged |
| Over-suppression (D-03's direction, checked in the other direction) | bounded | Both captured real payloads are asserted to produce NO opt-out, the absent-subscriber one even with our own `outcome = 'failed'`; the `OPT_IN` corroboration guard is unchanged and still asserted |

## Known Stubs

None. No `TODO`, `FIXME`, skipped test or unrun `<verify>` was introduced by this plan. Every `<verify>` command in both tasks was run, and the plan-level verification block was run in full including both remote passes.

## Threat Flags

None. This plan added no network endpoint, auth path, file access pattern or schema change. `providerVerdictCorpus` is a pure string function; the two new catches log ids already present in the surrounding log lines.

## Notes for the Operator

- **Nothing became armed by this change**, and nothing was deployed. The global sms row is still `enabled=false` (04-07's deliberate disarm) and no email row is enabled anywhere. This rides on the same carried-forward note as 04-08: commits are on `main` and not pushed — deploy is your call.
- **The backstop's first real firing will be visible in `optOutsRecorded`.** Before this change that counter was structurally pinned at 0; a non-zero value from the nightly sweep is now meaningful, and each one corresponds to a `suppressed_contacts` row written with source `provider_opt_out`.
- **A NULL `outcome` on a `send_ledger` row is now a supported, surfaced state rather than a symptom of a crashed tick.** It means the message went out and the write of what the provider said failed. It is deliberately never auto-resent (D-07); the `[cadence] could not record the outcome for ledger …` log line names the row.
- **VERIFICATION gaps 3 and 4 are closed.** Of the phase's review findings, that leaves the warnings (WR-01's unguarded DLR body read, WR-02's `ERROR`-token classification) as the outstanding items — neither is in this plan's scope.

## Self-Check: PASSED

`tests/cadence-dispatch-isolation.test.ts` verified present on disk; all four modified files present; both task commit hashes (`be85e4e`, `02cf3a1`) verified in `git log`.
