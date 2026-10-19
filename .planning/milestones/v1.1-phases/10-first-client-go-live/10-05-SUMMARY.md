---
phase: 10-first-client-go-live
plan: 05
subsystem: database
tags: [drizzle, postgres, supabase, next-server-actions, zod, resend, react]

requires:
  - phase: 10-01
    provides: tenant_proofs table (migration 0036), the nine-key readGoLiveChecklist, requireOperatorId, the ChecklistCard and its ITEM_LABELS/ITEM_FIX maps
  - phase: 10-02
    provides: getEmailStatus — the Resend GET /emails/{id} wrapper with bounded last_event and a domain-only recipient
  - phase: 10-03
    provides: armChannelAction / disarmChannelAction and the arm-then-confirm card controls the proof forms sit beside
  - phase: 10-04
    provides: seedProof, seedMessagingConfigOverride, and tenant_proofs in the teardown no-cascade list

provides:
  - "forTenant().proofs — append + latest(kind), append-only, recorded_at server-set"
  - "getEscalationForTenant(tenantId, id) — one escalation by id with the tenant in the predicate and providerMessageId in the select list"
  - "CHECKLIST_ITEM_KEYS extended to eleven; `proofs` and `live` on the readGoLiveChecklist result; LiveState exported"
  - "recordProofAction — operator-first, armed-channel gate, live tenant-scoped artefact verification, then proofs.append"
  - "The PROOF_* sentence set, including the ARM-03 empty states refused by name"
  - "ProofRow on the two proof keys and one Live line per channel on the checklist card"
  - "tests/proof-actions.test.ts (pure, 24 cases) and tests/tenant-proofs.test.ts (DB-backed, 11 cases)"

affects: [10-06, 10-07, 10-08, go-live-runbook, phase-11]

actuals:
  tokens: 21880
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Live is a three-state derivation of armed + proof, computed once in the core and rendered nowhere else"
    - "An operator's pasted artefact id is verified against a live, tenant-scoped row before it becomes evidence"

key-files:
  created:
    - tests/tenant-proofs.test.ts
    - tests/proof-actions.test.ts
  modified:
    - src/db/repository/for-tenant.ts
    - src/db/repository/escalations.ts
    - src/db/repository/index.ts
    - src/core/onboarding/checklist.ts
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/clients/[id]/checklist-card.tsx
    - src/app/(console)/clients/[id]/page.tsx
    - tests/go-live-checklist.test.ts
    - tests/onboarding-checklist-gate.test.ts
    - tests/lint-ban.test.ts
    - tests/operator-authorization.test.ts

key-decisions:
  - "The proof badge sentence 'recorded on {date} · {artefact id}' is composed in the CARD from the core's artefact id plus the page's zone-formatted date — the core never formats a date, and the id is not printed twice"
  - "LastTapped gained a 'proof' kind so the two proof forms sharing one useActionState hook cannot leave the SMS receipt sitting under the email row"
  - "The uuid check applies to the escalation artefact only; a Resend message id is not a uuid, and applying the rule to both would make the email proof unrecordable with the id the runbook prints"
  - "An escalation with outcome 'sent' but no provider_message_id is refused: nothing survives outside the database for anybody to re-check"

patterns-established:
  - "Three-state channel status (not_armed / armed / live): 'armed' is the honest middle — real messages can leave and nobody has watched one arrive"
  - "Provider-read failure is its own refusal, never 'it bounced' (the Pitfall 5 shape applied to delivery as well as domain verification)"
  - "Free-text provider values are bounded to [A-Za-z_]{1,32} before entering a rendered sentence or a stored artefact"

requirements-completed: [ARM-01]

coverage:
  - id: D1
    description: "forTenant().proofs append/latest — append-only, latest-wins, tenant-scoped, with the table's CHECKs, NOT NULL and SELECT-only grant proven against a real database"
    requirement: ARM-01
    verification:
      - kind: integration
        ref: "tests/tenant-proofs.test.ts#proofs.append then proofs.latest (D-02)"
        status: pass
      - kind: integration
        ref: "tests/tenant-proofs.test.ts#the table refuses a proof that proves nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "getEscalationForTenant — the artefact read, scoped by tenant in the predicate, carrying providerMessageId and no to_address"
    requirement: ARM-03
    verification:
      - kind: integration
        ref: "tests/tenant-proofs.test.ts#getEscalationForTenant scopes the artefact to its owner (T-10-17)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The eleven-key checklist with `proofs` and a `live` derived per channel from armed + proof"
    requirement: ARM-01
    verification:
      - kind: integration
        ref: "tests/go-live-checklist.test.ts#LIVE is armed PLUS a recorded proof, derived and never stored (D-01, D-02)"
        status: pass
      - kind: integration
        ref: "tests/onboarding-checklist-gate.test.ts#renders ELEVEN items in the fixed order, all unmet for a bare tenant"
        status: pass
    human_judgment: false
  - id: D4
    description: "recordProofAction — operator then membership then body; refuses an unarmed channel, a malformed or foreign artefact, and every ARM-03 empty state by name; writes ids/statuses/domains/timestamps only"
    requirement: ARM-01
    verification:
      - kind: unit
        ref: "tests/proof-actions.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The client page renders eleven rows, two proof forms and the two Live lines"
    requirement: ARM-01
    verification: []
    human_judgment: true
    rationale: "The rendered card is a visual fact about a page; typecheck and lint prove the props type-check, not that an operator sees eleven rows and two forms. Confirmed at the end-of-phase human check."
  - id: D6
    description: "The ARM-03 and DOM-04 live proofs executed on production and recorded"
    verification: []
    human_judgment: true
    rationale: "Out of scope for this plan by design — plan 05 builds the recording path; the proofs themselves are produced by the product on production in the go-live runbook (plans 07/08). Both requirements remain open."

duration: 25min
completed: 2026-09-11
status: complete
---

# Phase 10 Plan 05: Live Proofs and the Live Derivation Summary

**An operator records each live proof by pasting the artefact id the product produced; the action verifies that artefact live and tenant-scoped before writing, and the checklist derives "Live" per channel from armed plus proof.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-11T07:03:50Z
- **Completed:** 2026-09-11T07:29:00Z
- **Tasks:** 3
- **Files modified:** 14 (2 created, 12 modified)

## Accomplishments

- **The evidence path exists end to end.** `forTenant().proofs` appends and reads latest-wins, `recordProofAction` is the only way a row gets there, and it refuses to write one without an artefact id it has just read back from the system that produced it.
- **`live` is a derivation, not a column.** Three states per channel — `not_armed` / `armed` / `live` — computed once in `readGoLiveChecklist` from the channel's armed item and its proof item, rendered by the card and by nothing that re-derives it.
- **ARM-01 is genuinely complete.** Eleven rows in one card, in a fixed order that is also the order the work is done in, with the two proof rows reading `recorded on {date} · {artefact id}`.
- **The ARM-03 empty states are refused by name.** `no_escalation_number`, `sms_not_configured`, `cooldown_suppressed` and uppercase provider codes are rows the escalation pass writes honestly when it could *not* send — findable, pasteable, and exactly what somebody working the runbook might mistake for evidence.

## Task Commits

1. **Task 1: proofs namespace, getEscalationForTenant, and the DB-backed proof suite** — `0ffe427` (feat)
2. **Task 2: Eleven checklist keys, proof rows, and the live derivation** — `2653e78` (feat)
3. **Barrel export allow-list** — `e0b9314` (fix, Rule 3)
4. **Task 3: recordProofAction, the ProofRow form, and the Live line** — `0b8bc05` (feat)

**Plan metadata:** see the final `docs(10-05)` commit.

## Files Created/Modified

- `src/db/repository/for-tenant.ts` — the `proofs` namespace: `append` (INSERT only, `recordedAt` from the column default) and `latest(kind)` (ordered LIMIT 1 on `recorded_at DESC, id DESC`). No update, no delete, by design.
- `src/db/repository/escalations.ts` — `EscalationProofEvidence` and `getEscalationForTenant(tenantId, id)`: explicit select list including `providerMessageId`, tenant in the predicate, never `to_address` or `body_segments`.
- `src/db/repository/index.ts` — both exported from the escalations block, with the reader documented in the block's prose.
- `src/core/onboarding/checklist.ts` — eleven keys; `proofs.latest` for both kinds in the parallel fan-out; `ProofRecord`, `LiveState`, and `proofs` + `live` on the result.
- `src/app/(console)/clients/[id]/action-state.ts` — `ProofState`, `BLANK_PROOF_STATE`, `PROOF_NOTE_MAX`, and the nine `PROOF_*` sentences/builders.
- `src/app/(console)/clients/[id]/actions.ts` — `recordProofAction` and `proofSchema`.
- `src/app/(console)/clients/[id]/checklist-card.tsx` — two labels, two `ITEM_FIX` entries, `ProofRow`, the two Live lines and their muted explanatory note, and the widened `LastTapped`.
- `src/app/(console)/clients/[id]/page.tsx` — formats both `recordedAt` values in the tenant's zone and passes `proofs` and `live`.
- `tests/tenant-proofs.test.ts` (new, 291 lines) — DB-backed: append/latest, latest-wins with the history intact, `[]` for unproven, tenant scoping, the two CHECKs, the `recorded_by` NOT NULL, the operator-JWT insert refusal, and the three `getEscalationForTenant` cases.
- `tests/proof-actions.test.ts` (new, 501 lines) — pure: both denials, note/artefact/kind validation, both unarmed refusals, the failed checklist read, the non-uuid refusal, the not-found refusal, all four not-sent outcomes, the claimed-row refusal, both successful writes with their exact `artefactDetail` key sets, four not-delivered last events, the provider-read failure, and the write failure that leaks nothing.
- `tests/go-live-checklist.test.ts`, `tests/onboarding-checklist-gate.test.ts` — the eleven-key literal and the new live/proof cases.
- `tests/lint-ban.test.ts`, `tests/operator-authorization.test.ts` — the barrel allow-list entry and the guarded-path prose.

## Decisions Made

- **The badge sentence is composed in the card, not the core.** `readGoLiveChecklist` returns `recorded · {artefactId}` as the item detail and the raw `recordedAt` on `proofs`; the page formats the date in the client's zone and the card joins them into `recorded on {date} · {artefact id}`. Composing the whole sentence in the core would have made a framework-free module format a date in the runner's timezone; composing it in both places would have printed the artefact id twice on one row.
- **`LastTapped` gained a `proof` kind.** Both proof forms share one `useActionState` hook (one action, bound once), so without it, recording the SMS proof would leave "Recorded. SMS is live for this client." sitting under the email row as well — the same defect the arm/disarm dispatch already guards against.
- **The uuid rule is per-kind.** The escalation artefact is a row id and is checked against `UUID_PATTERN` before any repository read; a Resend message id is not a uuid, and applying the rule to both kinds would have made the email proof unrecordable with the id `verify:email-pipe` prints.
- **`outcome === 'sent'` alone is not enough.** A sent row with no `provider_message_id` is refused: the provider id is the only handle that survives outside this database, and without it the proof is not re-checkable by somebody who was not there.
- **Nothing re-verifies at read time.** The checklist trusts the row because `recordProofAction` verified it at write time. A checklist that re-asked ClickSend would be a second reading of the proof rule, and a provider outage would un-prove a client who is provably live.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tests/lint-ban.test.ts` barrel allow-list did not include the new export**

- **Found during:** Task 3 (discovered when running the affected pure suites)
- **Issue:** `tests/lint-ban.test.ts` asserts the repository barrel's export list **exhaustively** — the ONB-05 guard against re-exporting the raw client. Adding `getEscalationForTenant` in Task 1 reddened it.
- **Fix:** Added the entry in alphabetical position with a comment recording why this reader is not a list accessor. The assertion stays exhaustive; nothing was widened.
- **Files modified:** `tests/lint-ban.test.ts`
- **Verification:** `npx vitest run tests/lint-ban.test.ts` — 28 passed.
- **Committed in:** `e0b9314`

### Criterion-literal deviations (no behaviour change)

**2. `grep -c "getEscalationForTenant" src/db/repository/index.ts` returns 2, not the 1 the plan predicted.** The barrel's house style names every export in the doc block above it, so `listEscalationsForQuote` and `claimEscalation` each return 2 as well. The criterion's intent — the reader is exported from the barrel — is met; matching the literal count would have meant shipping the only export in that block with no prose entry.

**3. An invented `live-state` CSS class was removed before commit.** The Live lines reuse `touch-list` / `row` / `badge`, which the card already styles; a class name with no rule behind it is a dead hook.

**4. `tests/operator-authorization.test.ts` prose extended.** Not required by any criterion — the file's header enumerates *why* `clients/[id]/actions.ts` is a guarded path, and leaving `recordProofAction` out of that enumeration would have made the list wrong. The assertions are unchanged and still pass.

---

**Total deviations:** 1 auto-fixed (1 blocking), 3 documentation/criterion-literal notes.
**Impact on plan:** No scope creep. The blocking fix was caused by this plan's own barrel addition.

## Issues Encountered

- **`OPERATOR_DENIED_MESSAGE` has no `not_allowlisted` key.** The union is `'unauthenticated' | 'forbidden'`; the first draft of the pure suite asserted against the wrong key and failed loudly rather than silently (`toBe(undefined)` would have passed had the action returned nothing). Corrected to `.forbidden`.
- **Prettier is not part of the gate and the repo is not prettier-clean at HEAD.** `npm run lint` is `eslint . --max-warnings=0`; `npx prettier --check` flags the pre-existing files as well, so formatting was left to eslint as the repo's actual standard.

## Verification

- `npm run typecheck` — exit 0.
- `npm run lint` — exit 0.
- `npx vitest run tests/proof-actions.test.ts` — 24 passed.
- Full bare run: **3025 tests passed, 0 failed.** The 43 failing *files* are the DB-backed suites refusing to run without a local Supabase stack (`Refusing to run integration tests against a non-local Supabase stack`) — the expected local posture; they run in CI. `tests/tenant-proofs.test.ts`, `tests/go-live-checklist.test.ts` and `tests/onboarding-checklist-gate.test.ts` are in that set, and CI run `34574158415` is green on the pushed SHA, which is what promotes their coverage statuses above to `pass`.

## User Setup Required

None — no external service configuration required. Nothing was armed and no production row was written by this plan.

## Next Phase Readiness

- **Plans 07 and 08 have the form they end on.** The runbook can now produce an escalation on production, paste the row id, and get a `live` SMS state — and the same for the email pipe.
- **ARM-03 and DOM-04 remain open, deliberately.** This plan built the recording path; the proofs themselves are produced by the product on production and are not something a plan can manufacture (D-06).
- **No blockers.** `ARM-01` is complete and now fully rendered.

---
*Phase: 10-first-client-go-live*
*Completed: 2026-09-11*

## Deployment

- **Pushed:** `3aaceb56cf4b99aefb547fbcc76aa961715242a4` to `main`.
- **CI:** run `34574158415` — green on that SHA. Typecheck, lint, build, both secret scans, migrations against a fresh local stack, and the full suite including the DB-backed `tests/tenant-proofs.test.ts`, `tests/go-live-checklist.test.ts` and `tests/onboarding-checklist-gate.test.ts`.
- **Production deployment:** `dpl_EaUf6JqKvdYsLVu1xZSjZdceT6WJ` — READY, target production, aliased to `app.backdesk.com.au`.
- **`https://app.backdesk.com.au/login`** — HTTP 200.
- **Nothing was armed.** No `enabled = true` row was written and no production `tenant_proofs` row exists.

## Self-Check: PASSED

All 15 claimed files exist on disk; all four task commits (`0ffe427`, `2653e78`, `e0b9314`, `0b8bc05`) are present in the repository history.
