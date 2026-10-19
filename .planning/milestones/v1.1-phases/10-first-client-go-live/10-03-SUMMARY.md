---
phase: 10-first-client-go-live
plan: 03
subsystem: ui
tags: [next-server-actions, drizzle, postgres, messaging-config, audit-trail, resend, vitest]

requires:
  - phase: 04-messaging-activation
    provides: messaging_config as the arming switch (nullable tenant_id = the shared sms row), upsertChannelConfig's exhaustive SET clause, getChannelConfig's override-then-default read
  - phase: 10-first-client-go-live
    plan: 01
    provides: armChannel/disarmChannel + the audit row, isSendingDomainVerified, ARM_* sentences, the checklist card's ArmRow and its two-step confirm
provides:
  - forAllTenants_armedBySmsGlobal — the shared sms row's blast radius (connected tenants with no sms row of their own), ids and names only
  - smsBlastRadiusSentence + a blast-radius-aware armedMessage, sharing one clause between the warning and the receipt
  - the client page and armChannelAction wired to name the clients a shared-row arm will start
  - an identity-only saveEmailConfigAction — enabled preserved, one shared domain predicate, no enable checkbox
affects: [10-04, 10-05, 10-06, 10-07, 10-08]

actuals:
  tokens: 15574
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "One clause, two surfaces: the warning shown between the two taps and the success sentence after the write are built from the same pure helper, so they cannot describe different sets"
    - "Three-state list for a consequence sentence: a list names them, an empty list says plainly that nobody is affected, and null (read failed) drops the clause rather than making a claim"
    - "Preserve-don't-default: a console write that does not own a column re-reads it and writes it back, and REFUSES when the read fails rather than defaulting"
    - "Override-then-default reads are counted only when the row IS the target's own (row.tenantId === targetTenantId), never inherited"

key-files:
  created: []
  modified:
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/checklist-card.tsx
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/(console)/settings/email/actions.ts
    - src/app/(console)/settings/email/forms.tsx
    - src/app/(console)/settings/email/page.tsx
    - tests/arming-actions.test.ts
    - tests/email-settings-action.test.ts

key-decisions:
  - "The blast-radius predicate is ABSENCE OF AN OWN SMS ROW, not enabled state — a tenant with its own row (on or off) is governed by that row, so filtering on enabled would drop a client the tap is about to start messaging for"
  - "A failed blast-radius read after a successful arm drops the clause (null) instead of rendering the empty-list sentence: 'no connected client is without its own row today' is a claim, and a claim built from a failed query is false comfort"
  - "The blast-radius read happens AFTER the write and only for the shared-row target — a per-client arm has no blast radius, and a crossing nobody needs is a crossing that has to be justified"
  - "saveEmailConfigAction REFUSES when the stored row cannot be read rather than defaulting enabled to false — the default would disarm a live client with no audit row and nobody would notice until the tradie asked"
  - "The identity-completeness refusals moved wholly into armChannel: a half-built identity on a disabled row sends nothing, and refusing it here blocked an operator saving mid-onboarding"

patterns-established:
  - "Cross-tenant read whose consumer is a SENTENCE: ids and names only, both callers behind the operator gate, justified in the file header's crossing list like every other"
  - "Console copy that names the NEXT action instead of announcing success, when the save changes nothing about whether anything sends"

requirements-completed: []

coverage:
  - id: D1
    description: "The SMS shared-row control names the clients it will arm — count and names in the warning between the two taps and in the success sentence, from a fresh read taken after the write"
    requirement: ARM-02
    verification:
      - kind: unit
        ref: "tests/arming-actions.test.ts#the shared row names the clients it arms (D-03, T-10-12)"
        status: pass
      - kind: unit
        ref: "tests/arming-actions.test.ts#the blast-radius clause (D-03)"
        status: pass
    human_judgment: true
    rationale: "The sentences are asserted pure, but that the WARNING actually renders the named list on a real client page is a screen-reading check — it is the end-of-phase human check this plan's verification names"
  - id: D2
    description: "forAllTenants_armedBySmsGlobal returns exactly the connected tenants the shared row governs (no sms row of their own), ids and names only"
    requirement: ARM-02
    verification: []
    human_judgment: true
    rationale: "The SQL predicate (INNER JOIN sm8_connections, paused_at IS NULL, NOT EXISTS an own sms row) has no DB-backed test in this plan — 10-04 owns the DB-backed arming suites, and the pure suite only proves the action calls it"
  - id: D3
    description: "The email settings form can no longer arm or disarm: enabled is preserved from the stored row (false for a new row), and the only path that flips it is the audited client-page action"
    requirement: ARM-02
    verification:
      - kind: unit
        ref: "tests/email-settings-action.test.ts#the settings form saves identity only (D-04, T-10-13)"
        status: pass
      - kind: unit
        ref: "tests/email-settings-action.test.ts#identity completeness is the arming gate’s job, not this form’s"
        status: pass
    human_judgment: false
  - id: D4
    description: "One isSendingDomainVerified spelling serves both the checklist and the settings save; a domain read failure is a refusal in both, never a pass"
    verification:
      - kind: unit
        ref: "tests/email-settings-action.test.ts#the verified-domain check is server-side, through ONE predicate (T-4-26, T-10-14)"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-09-11
status: complete
---

# Phase 10 Plan 03: Blast-Radius Naming and Identity-Only Email Settings Summary

**The shared SMS row now names, by count and by name, every client one tap will start messaging for — and the email settings form has stopped being a second, unaudited way to arm a client.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-09-11T13:50:00Z
- **Completed:** 2026-09-11T14:08:00Z
- **Tasks:** 2 of 2
- **Files modified:** 11

## Accomplishments

- `forAllTenants_armedBySmsGlobal` — the fourteenth named cross-tenant crossing, returning the connected tenants with no SMS row of their own, which is exactly the set the shared row governs. Ids and names only, both readers behind the operator gate, justified in the file header's crossing list.
- One clause, two surfaces: `smsBlastRadiusSentence` (the warning between the two taps) and `armedMessage` (the receipt after the write) are built from the same pure helper, so the operator cannot be warned about two clients and then told four were armed. The receipt's list is read fresh, after the write.
- `saveEmailConfigAction` now saves an IDENTITY: `enabled` is read from the stored row and written back unchanged, so `armChannel`/`disarmChannel` is the only path that flips the switch that sends real customer email — which is what makes "every arm is audited" a property of the system rather than a sentence in a document.
- The inline `listDomains` predicate is gone; the action asks `isSendingDomainVerified`, the same three-state predicate the go-live checklist asks, and refuses on `unknown` as well as `unverified`.

## Task Commits

1. **Task 1: Name the clients the shared row arms** — `7833f68` (test, RED) → `cfb4530` (feat, GREEN)
2. **Task 2: The email settings form saves identity only** — `a7a2e1c` (test, RED) → `4c8e78a` (feat, GREEN)

**Plan metadata:** see the `docs(10-03)` commit that carries this file.

## Files Created/Modified

- `src/db/repository/for-all-tenants.ts` — `forAllTenants_armedBySmsGlobal` + `SmsGlobalArmedClient`, and the header's crossing list gains its arming paragraph
- `src/db/repository/index.ts` — the barrel export, with the crossing's one-paragraph justification
- `src/app/(console)/clients/[id]/action-state.ts` — `blastRadiusClause` (private), `smsBlastRadiusSentence`, `armedMessage(channel, target, armedClients)`
- `src/app/(console)/clients/[id]/actions.ts` — the fresh post-write read, guarded, shared-row target only
- `src/app/(console)/clients/[id]/checklist-card.tsx` — `armedClients` threaded to `SmsControls`; the warning is now the shared sentence
- `src/app/(console)/clients/[id]/page.tsx` — the read joins the checklist `Promise.all` and its try
- `src/app/(console)/settings/email/actions.ts` — identity-only save, preserved `enabled`, shared domain predicate, guarded stored-row read
- `src/app/(console)/settings/email/forms.tsx` — the enable checkbox replaced by the pointer to the client page
- `src/app/(console)/settings/email/page.tsx` — one sentence of copy that described the removed checkbox
- `tests/arming-actions.test.ts` — the blast-radius describes (9 new cases)
- `tests/email-settings-action.test.ts` — the T-4-26 describe re-pointed at the shared predicate; the identity-only and completeness describes rewritten

## Decisions Made

See `key-decisions` in the frontmatter. The two that shaped the code most:

1. **Absence of an own row, not `enabled`.** `getChannelConfig` reads override-then-default, so a tenant with its own SMS row is governed by that row whatever it says. The blast-radius list therefore asks `NOT EXISTS (an sms row for this tenant)` — which is also why the Phase 4 test tenant shows up in the list until somebody writes it an explicit OFF override, exactly as the plan wanted the operator to see.
2. **Refuse rather than default, in both new reads.** A failed stored-row read in the settings save would, if defaulted to `false`, disarm a live client with no audit row — the same defect D-04 exists to prevent, pointing the other way. A failed blast-radius read after a successful arm cannot refuse (the row IS armed), so it drops the clause instead of claiming "nobody".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing error handling] The stored-row read in `saveEmailConfigAction` was unguarded**
- **Found during:** Task 2
- **Issue:** The plan specified `enabled: existing?.enabled ?? false` with no guidance for a failed read. A driver error would either surface as Next's generic error page or, worse under any `?? false` reading, write `enabled = false` over a live client's row — an unaudited disarm, which is precisely what this plan's own prohibition forbids.
- **Fix:** The read is wrapped; a throw returns "Could not read the current settings. Nothing was saved — try again in a moment." and writes nothing. A test pins it.
- **Files modified:** `src/app/(console)/settings/email/actions.ts`, `tests/email-settings-action.test.ts`
- **Verification:** `tests/email-settings-action.test.ts` — "REFUSES when the stored row cannot be read — nothing is written"
- **Committed in:** `4c8e78a`

**2. [Rule 2 — Missing error handling] The blast-radius read after a successful arm was unguarded**
- **Found during:** Task 1
- **Issue:** The plan said to re-read `forAllTenants_armedBySmsGlobal` after a successful global arm. A throw there would have turned a SUCCESSFUL arm into an error page, leaving the operator believing nothing happened while the next tick sends real messages.
- **Fix:** `armedClients` is `null` on a failed read and `armedMessage` drops the clause entirely for `null` — the arm is still confirmed, and the sentence makes no claim it cannot support.
- **Files modified:** `src/app/(console)/clients/[id]/actions.ts`, `src/app/(console)/clients/[id]/action-state.ts`, `tests/arming-actions.test.ts`
- **Verification:** `tests/arming-actions.test.ts` — "a failed list read never unsays the arming — the clause is dropped, not guessed"
- **Committed in:** `cfb4530`

**3. [Rule 1 — Bug] Copy on `/settings/email` still described the removed checkbox**
- **Found during:** Task 2
- **Issue:** The paragraph above the identity form read "Switching the default row on starts email for every client that has no row of their own" — an instruction for a control this plan deleted, on the screen where it was deleted. `settings/email/page.tsx` is outside the plan's `files_modified`, but the sentence was made false by this task's change.
- **Fix:** Rewritten to say the form changes the identity only and that arming happens on the client's page. The `enabled` badge in the table above it is untouched, as the plan specified.
- **Files modified:** `src/app/(console)/settings/email/page.tsx`
- **Verification:** `npm run lint`, `npm run typecheck`, `npx vitest run tests/email-settings-action.test.ts` (the source-assertion describe pins the residency note on this page and still passes)
- **Committed in:** `4c8e78a`

**4. [Copy] The preserved-enabled success sentence has a global-row variant**
- **Found during:** Task 2
- **Issue:** The plan gave one preserved-enabled sentence, "Saved. Email stays on for this client." The settings form can also target the GLOBAL row, where "this client" is wrong.
- **Fix:** The global-row branch says "Saved. Email stays on by default for every client."; the tenant branch is the plan's sentence verbatim; the disabled branch is the plan's pointer sentence verbatim.
- **Files modified:** `src/app/(console)/settings/email/actions.ts`
- **Committed in:** `4c8e78a`

---

**Total deviations:** 4 auto-fixed (2 × Rule 2, 1 × Rule 1, 1 copy correction)
**Impact on plan:** No scope creep. Two of the four exist to keep this plan's own prohibition true ("no console path flips `enabled` without an audit row"), one repairs copy the plan's change falsified, one covers a sentence variant the plan did not enumerate.

## Issues Encountered

**The repository barrel pin is still red, and this plan makes it redder.** `tests/lint-ban.test.ts` pins the exact export list of `@/db/repository`. It has been failing since 10-01 added `armChannel`, `disarmChannel` and `listChannelAudit` without updating the pin (logged by 10-02). This plan adds a fourth missing name, `forAllTenants_armedBySmsGlobal`. **10-04 owns that test file and must add all four** — the received list in the failure output is the complete answer:

```
armChannel, disarmChannel, forAllTenants_armedBySmsGlobal, listChannelAudit
```

(`SmsGlobalArmedClient` is a type-only export and does not appear in the runtime barrel keys.)

Full bare suite at the end of this plan: **3000 passing, 1 failing** — that one being the pin above. The 41 "failed" test FILES are the 40 DB-backed suites refusing to run without `ALLOW_REMOTE_TESTS` (by design; the hosted Sydney database is production) plus `lint-ban`.

## Verification Run

- `npm run typecheck` — clean
- `npm run lint` — clean (`--max-warnings=0`)
- `npx vitest run tests/arming-actions.test.ts` — 29 passed
- `npx vitest run tests/email-settings-action.test.ts` — 40 passed
- `npm test` (bare, no remote) — 3000 passed, 1 pre-existing failure (the barrel pin above)

All of this plan's acceptance greps return their required counts, including `listDomains` → 0 and `z.boolean()` → 0 in the settings action, and `name="enabled"` → 0 in the form.

## Requirements

**ARM-02 is deliberately NOT ticked here.** Its full text requires the arming to be "audited with operator, timestamp and reason", and the DB-backed proof of that audit row belongs to 10-04. This plan delivers the operator-facing half (the blast radius is stated before the tap and repeated after it) and closes the unaudited side door; 10-04 ticks the requirement once the DB-backed suites prove the transaction.

## Nothing Was Armed

No `enabled = true` was written anywhere, by code or by hand. No remote test ran. No push was made — 10-04 pushes at the end of this wave.

## Next Phase Readiness

- 10-04 must update the `tests/lint-ban.test.ts` barrel pin to include `forAllTenants_armedBySmsGlobal` alongside 10-01's three names, or the suite stays red.
- Any DB-backed test of `forAllTenants_armedBySmsGlobal` (the one deliverable here without automated proof) would fit naturally in 10-04's arming suites.
- The end-of-phase human check stands: open a client page and confirm the SMS warning lists the connected clients by name, and that `/settings/email` shows no enable checkbox.

---
*Phase: 10-first-client-go-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 11 modified files exist on disk; all four task commits (`7833f68`, `cfb4530`, `a7a2e1c`, `4c8e78a`) are present in the repository history.
