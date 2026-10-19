---
phase: 10-first-client-go-live
plan: 01
subsystem: database
tags: [drizzle, postgres, rls, supabase, next-server-actions, messaging-config, audit-trail, vitest]

requires:
  - phase: 04-messaging-activation
    provides: messaging_config as the arming switch (nullable tenant_id = the shared sms row), upsertChannelConfig's exhaustive set clause, resolveSmsFrom / resolveEmailIdentity
  - phase: 05-drafting-gate
    provides: hasApprovedTemplateSet and the sm8_automation_off attestation the gate reads
  - phase: 06-console
    provides: the client page's checklist card, action-state sentence discipline, the arm-then-confirm control shape
  - phase: 09-audit-requests
    provides: migration 0035's header discipline and REVOKE/GRANT block, the operator allowlist read
provides:
  - tenant_proofs and messaging_config_audit tables, live on the hosted Sydney database (migration 0036)
  - armChannel / disarmChannel — upsert + audit row in ONE transaction, identity re-read and re-supplied
  - listChannelAudit — the last N flips of a channel's switch, newest first
  - requireOperatorId — the allowlist read that keeps the operator's user id
  - ARMING_GATES + firstUnmetGate — the one server-side gate evaluation
  - readGoLiveChecklist — nine keys, per-channel arming state, injected domain check
  - isSendingDomainVerified — the three-state "may we send as this address" predicate
  - armChannelAction / disarmChannelAction + the ARM_* sentences and the card's ArmRow
affects: [10-02, 10-03, 10-04, 10-05, 10-06, 10-07, 10-08]

actuals:
  tokens: 28000
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Transactional writer in the repository, sentence in the action: the config flip and its audit row share one getDb().transaction, and the action maps an outcome union to fixed copy"
    - "Outcome unions instead of exceptions for ordinary refusals (no_identity / already_armed / reason_required)"
    - "Gate evaluation reads the same derivation the screen renders (firstUnmetGate over readGoLiveChecklist's items), never its own queries"
    - "Injected third-party predicate (deps.isSendingDomainVerified) so DB-backed suites never reach Resend"

key-files:
  created:
    - src/db/schema/messaging-config-audit.ts
    - src/db/schema/tenant-proofs.ts
    - src/db/migrations/0036_phase10_go_live.sql
    - src/core/onboarding/arming.ts
    - tests/arming-actions.test.ts
  modified:
    - src/db/repository/messaging-config.ts
    - src/app/(console)/_auth.ts
    - src/core/onboarding/checklist.ts
    - src/core/messaging/resend-domains.ts
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/clients/[id]/checklist-card.tsx
    - src/app/(console)/clients/[id]/page.tsx

key-decisions:
  - "Proofs live in a NEW tenant_proofs table rather than new tenant_attestations kinds, because 'no proof without an artefact id' and 'who recorded it' had to be database facts (NOT NULL + length CHECK + recorded_by), and attestations require only a note"
  - "requireOperator() now DELEGATES to requireOperatorId(), so the allowlist read exists once; the operator-authorization regexes were widened to accept the Id suffix (the pinned choice)"
  - "sm8Connected GATES arming (a dead ServiceM8 key means no win detection); voiceProfile does not (drafting has its own belt); the two proof items never gate arming (D-01)"
  - "armChannel/disarmChannel target the EXACT row (this tenant's, or the global one) and never the effective/fallback row — arming email for a client must not flip a row belonging to everybody"
  - "already_armed / already_disarmed write nothing, so arming twice leaves exactly one audit row per effective action"
  - "A disarm of a tenant row that does not exist CREATES it disabled (the explicit-OFF override), copying the identity from the row that tenant currently resolves to"

patterns-established:
  - "Audit row and config flip are inseparable: appendAudit is private and callable only from inside the two writers' transactions"
  - "A third-party read failure is UNKNOWN, never a pass and never a 'not yet' — unmet for the checklist, its own refusal sentence for the action"
  - "Arming is two taps with the blast radius stated between them; disarming is one tap behind a disclosure with a required reason"

requirements-completed: [ARM-01, ARM-02]

coverage:
  - id: D1
    description: "Two new tables (tenant_proofs, messaging_config_audit) with CHECK vocabularies, RLS policies and SELECT-only grants, applied to the hosted Sydney database by migration 0036"
    requirement: ARM-02
    verification:
      - kind: integration
        ref: "npm run db:migrate (exit 0, then a second run applying nothing); node scripts/db-status.mjs — both tables rowsecurity=true with their policies"
        status: pass
    human_judgment: false
  - id: D2
    description: "armChannel / disarmChannel write the messaging_config flip and its audit row in one transaction, re-supplying the sending identity"
    requirement: ARM-02
    verification:
      - kind: unit
        ref: "npm run typecheck && npm run lint"
        status: pass
      - kind: integration
        ref: "tests/messaging-config-arming.test.ts (DB-backed — plan 10-04 writes it)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "armChannelAction / disarmChannelAction authorize operator-first, refuse on the first unmet gate without writing, and never return the caught database error text"
    requirement: ARM-02
    verification:
      - kind: unit
        ref: "tests/arming-actions.test.ts (19 tests)"
        status: pass
      - kind: unit
        ref: "tests/operator-authorization.test.ts — clients/[id]/actions.ts is a guarded path"
        status: pass
    human_judgment: false
  - id: D4
    description: "The checklist renders nine items in fixed order, each carrying its own fact, with per-channel arming state"
    requirement: ARM-01
    verification:
      - kind: integration
        ref: "tests/onboarding-checklist-gate.test.ts — literal nine-key array + toHaveLength(9) (DB-backed, CI runs it)"
        status: unknown
      - kind: unit
        ref: "npm run typecheck (the Record over the key union makes a missing label a compile error)"
        status: pass
    human_judgment: false
  - id: D5
    description: "From a client page the operator arms SMS through a two-step confirm whose warning names the shared-number blast radius, and the last three audit lines render under the row"
    requirement: ARM-02
    verification: []
    human_judgment: true
    rationale: "Whether the warning actually reads as a switch with consequences — and whether the controls appear in the right state for a real client — is a judgement about a rendered page. Deferred to the end-of-phase human check (human_verify_mode: end-of-phase); nothing is to be armed during it."

duration: 26min
completed: 2026-09-11
status: complete
---

# Phase 10 Plan 01: Arming Tracer Summary

**The operator can arm and disarm SMS and email for a client from the console; the flip and its audit row are written in one transaction, the gate refuses server-side on the first unmet checklist item without writing, and migration 0036 is live on the hosted Sydney database.**

## Performance

- **Duration:** ~26 min
- **Started:** 2026-09-11T05:02Z
- **Completed:** 2026-09-11T05:28Z
- **Tasks:** 3 of 3
- **Files modified:** 19 (5 created, 14 modified)

## Accomplishments

- **The vertical slice is wired end to end** — schema → migration → transactional repository writer → operator identity → pure gate → checklist derivation → server actions → card control → page. Every layer the phase modifies was touched once, thinly, and compiles and lints clean.
- **Migration 0036 is applied to production** (tenant_proofs, messaging_config_audit, both with RLS enabled, their policies and REVOKE-then-GRANT blocks), and a second `db:migrate` run applied nothing.
- **Arming is refused, not merely hidden.** `firstUnmetGate` walks `ARMING_GATES[channel]` over the same items the card renders; an absent item is unmet, never vacuously satisfied; nothing is written on refusal.
- **Nothing was armed.** The global sms row and every tenant row stand exactly as they did before this plan — disarmed. This plan built the controls and pushed the schema.

## Task Commits

1. **Task 1: End-to-end arm/disarm tracer (schema → card)** — `8b908d4` (feat)
2. **Task 2: Pin the tracer — pure action suite, nine-key assertion, regex decision** — `d73a9e3` (test)
3. **Task 3: Push migration 0036 to the hosted Sydney database** — no repository change (the journal entry it lists was already committed in Task 1 and was unchanged by the run); the task's output is production state, recorded below.

## Task 3 — the production run, verbatim

Four exit lines, each captured directly (no pipe that could mask a failure):

```
cron:status exit=0
db:generate exit=0
db:migrate exit=0
second db:migrate exit=0
```

- **Gate before:** `local APP_BASE_URL origin: https://app.backdesk.com.au`, `remote_test_lease rows: 0`, `remote-test-watchdog scheduled: no`, four jobs active on the custom domain.
- **Generator clean:** `No schema changes, nothing to migrate` — journal idx 36, tag `0036_phase10_go_live`, `when` 1789103759992 (> 0035's 1788919992174, checked not assumed).
- **Applied:** `Migrations applied. Journal entries recorded: 37`.
- **Second run:** identical output, count still 37 — nothing applied. Read-back with `node scripts/db-status.mjs`: `migrations recorded: 37`, `messaging_config_audit rowsecurity=true`, `tenant_proofs rowsecurity=true`, both policies present.
- **Push:** `6bbba4b..d73a9e3 main -> main`. Vercel production deployment `backdesk-m1cucm1ea` (`https://backdesk-m1cucm1ea-hesams-projects-432a48c6.vercel.app`) reached **Ready** in 59s; `GET https://app.backdesk.com.au/login` → 200.
- **Gate after:** `remote_test_lease rows: 0`, watchdog still unscheduled; `git status --porcelain src/db/migrations` empty.

## Files Created/Modified

- `src/db/schema/messaging-config-audit.ts` — append-only record of who armed/disarmed what, with the two-arm policy (`is_operator()` for the shared row) and the disarm-reason CHECK
- `src/db/schema/tenant-proofs.ts` — the D-02 proof rows: `artefact_id` NOT NULL with a length CHECK, `recorded_by` NOT NULL, jsonb detail
- `src/db/migrations/0036_phase10_go_live.sql` — the phase's ONE migration: both tables, RLS, indexes, policies, and two REVOKE-then-GRANT blocks
- `src/db/repository/messaging-config.ts` — `upsertWith` (the one statement, on any handle), `armChannel`, `disarmChannel`, `listChannelAudit`, private `appendAudit`
- `src/app/(console)/_auth.ts` — `requireOperatorId`; `requireOperator` delegates; the allowlist read and its `if (error || !data) return 'forbidden'` branch live once
- `src/core/onboarding/arming.ts` — `ARMING_GATES` + `firstUnmetGate`, pure and framework-free
- `src/core/onboarding/checklist.ts` — `readGoLiveChecklist`, nine keys, `arming` state, injected domain check
- `src/core/messaging/resend-domains.ts` — `isSendingDomainVerified`, three states plus `invalid_address`
- `src/app/(console)/clients/[id]/action-state.ts` — `ARM_REFUSAL` (a Record over `GatingKey`), the no-identity/already/failed sentences, `armedMessage` / `disarmedMessage`
- `src/app/(console)/clients/[id]/actions.ts` — `armChannelAction` / `disarmChannelAction`
- `src/app/(console)/clients/[id]/checklist-card.tsx` — nine labelled rows, `ArmRow` with arm-then-confirm and the disarm disclosure, audit lines
- `src/app/(console)/clients/[id]/page.tsx` — `readGoLiveChecklist` + the two `listChannelAudit` reads inside the existing tolerated try
- `tests/arming-actions.test.ts` — the pure suite (19 tests)

## Decisions Made

- **`GatingKey` is a narrow union, not `ChecklistItemKey`.** `ARMING_GATES` is declared `as const satisfies Record<MessagingChannel, readonly ChecklistItemKey[]>` rather than annotated: an annotation would widen every entry and force `ARM_REFUSAL` to carry a sentence for rows that never gate anything.
- **The operator-authorization regex decision (pinned in that suite's header):** widen the two regexes to `requireOperator(?:Id)?`, and have `requireOperator()` delegate. The alternative — call `requireOperator()` then a sibling for the id — is two allowlist reads per arming and two places for the "read error is denial" rule to drift.
- **`arming.sms.from` is the identity, armed or not.** The confirm warning has to name the number it is about to send from, which is exactly the moment it is not sending from it yet. `smsArmed.satisfied` still comes from `resolveSmsFrom` (armed-only).
- **Unmet rows now show their diagnostic detail** in the warn badge rather than a bare "not yet" — `sendingDomainVerified` says which domain is unverified, `smsArmed` says "off for this client (override) — shared number off".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The bare-`getClaims()` assertion could not cover the new guarded path**

- **Found during:** Task 2 (the operator-authorization update)
- **Issue:** The plan adds `clients/[id]/actions.ts` to `GUARDED_PATHS`, and that list also drives `it.each(GUARDED_PATHS)('%s does not treat a bare getClaims() as authorization')`. That file's `authorize()` helper legitimately calls `supabase.auth.getClaims()` — it is the membership read through the operator's own JWT, made AFTER `requireOperatorId()` — so the assertion would have failed on a correct file.
- **Fix:** The new path joins `GUARDED_PATHS` for both `requireOperator(Id)?` assertions. The bare-`getClaims` assertion was re-pointed at a derived `PROSPECT_PATHS` (the four audit paths whose defect it pins), with a header comment stating why the clients path is excluded from that one assertion and from no other.
- **Files modified:** `tests/operator-authorization.test.ts`
- **Verification:** `npx vitest run tests/operator-authorization.test.ts` — 17 tests pass
- **Committed in:** `d73a9e3`

**2. [Rule 3 - Blocking] `messaging-config-audit.ts` re-exporting the channel vocabulary would have collided in the schema barrel**

- **Found during:** Task 1
- **Issue:** The first draft re-exported `MESSAGING_CHANNELS` from the audit schema file. `src/db/schema/index.ts` star-exports both files, so the same name would arrive by two paths.
- **Fix:** Import the type instead and use it in a narrowed `NewMessagingConfigAudit` writer type; the runtime vocabulary keeps its single home in `messaging-config.ts`.
- **Files modified:** `src/db/schema/messaging-config-audit.ts`
- **Verification:** `npm run typecheck`
- **Committed in:** `8b908d4`

---

**Total deviations:** 2 auto-fixed (2 × Rule 3). **Impact:** none on scope — both were mechanical consequences of the plan's own instructions meeting the existing code.

## Issues Encountered

- **A stray `npx prettier --write` reformatted `action-state.ts` to prettier defaults** (double quotes, 80 columns) — this repository has no prettier config and uses ESLint as its formatter authority. Caught immediately, the file was restored with `git checkout --` and the additions re-applied by hand. Nothing was committed in the mangled state, and no other file was touched. **Prettier must not be run in this repository.**
- The generated migration left a `;;` where the hand-finished section was appended after drizzle's last statement; removed before commit.

## User Setup Required

None — no new environment variables, and no dashboard configuration. The ClickSend number, the Resend domain and the operator allowlist all predate this plan.

## Known Stubs

None. Every surface this plan created is wired to a real reader or writer.

## Next Phase Readiness

- **Ready for wave 2.** Plan 10-04's DB-backed suites (`tests/messaging-config-arming.test.ts`, `tests/tenant-proofs.test.ts`) have their tables live on production and on any fresh local stack; `tests/rls-coverage.test.ts` will fail until 10-04 adds the two table names to its list and its exact-grants map — expected, and 10-04 is the fix.
- **Plans 10-03/10-05** inherit `isSendingDomainVerified` (the settings action should be switched to call it) and `tenant_proofs` (the repository namespace and the proof form are theirs to add).
- **Production carries the Phase 10 console** at `backdesk-m1cucm1ea`; 10-07 Task 1 re-confirms the SHA before the go-live window.
- **Nothing is armed**, and nothing in this plan can arm anything by itself. Arming production is plan 10-07's decision.

---
*Phase: 10-first-client-go-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

- All 13 claimed source/test files exist on disk; `10-01-SUMMARY.md` exists.
- Both task commits exist in git history: `8b908d4`, `d73a9e3`.
- Artifact floors met: `checklist-card.tsx` 626 lines (min 200), `tests/arming-actions.test.ts` 453 lines (min 120).
- `npm run typecheck` and `npm run lint` exit 0; `npx vitest run tests/arming-actions.test.ts tests/operator-authorization.test.ts` — 36 tests pass.
