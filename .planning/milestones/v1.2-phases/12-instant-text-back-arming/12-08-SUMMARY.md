---
phase: 12-instant-text-back-arming
plan: 08
subsystem: arming + console + core/onboarding
status: complete
tags: [text-back, arming, checklist, privacy, proofs, console, per-tenant]
requires:
  - 12-01 (messaging_config CHECKs admitting text_back per tenant only; TEXT_BACK_CHANNEL; isTextBackArmed)
  - 12-02 (attestedSetStatus, countOwnLines, getTextBackEvidenceForTenant, disarmChannelBySystem)
  - 12-06 (text-back page: attested wordings and the never-text list the gate reads)
  - 12-07 (privacyCoversCallers; the runbook's checklist and control labels; text-back:timing)
provides:
  - MESSAGING_CHANNELS = ['sms', 'email', 'text_back']
  - armChannel / disarmChannel text_back support (per_tenant_only refusal; identity-less arm creates the row)
  - ARMING_GATES.text_back (ten keys, checklist order)
  - seventeen-item go-live checklist with strict divertVerified, live.textBack, arming.textBack, proofs.textBack
  - console text-back controls, Text-back live line, text_back_proof slot; text_back_proof arm of recordProofAction
affects:
  - 12-09 (founder steps: verification call under the strict rule, arm the test tenant, record the text-back proof)
tech-stack:
  added: []
  patterns:
    - compile-driven vocabulary widening (every Record<MessagingChannel|GatingKey> demanded its entry)
    - door kept shut across commits (schemas spelled as sms/email in Task 1, opened in Task 2)
    - three-layer per-tenant refusal (action, repository, CHECK)
key-files:
  created:
    - tests/text-back-arming-gate.test.ts
  modified:
    - src/db/schema/messaging-config.ts
    - src/db/repository/messaging-config.ts
    - src/core/onboarding/arming.ts
    - src/core/onboarding/checklist.ts
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/clients/[id]/checklist-card.tsx
    - src/app/(console)/clients/[id]/page.tsx
    - tests/go-live-checklist.test.ts
    - tests/onboarding-checklist-gate.test.ts
    - tests/messaging-config-arming.test.ts
    - tests/arming-actions.test.ts
    - tests/proof-actions.test.ts
    - tests/divert-provision-action.test.ts
    - tests/client-divert-runbook.test.ts
    - tests/runbook-contract.test.ts
    - tests/helpers/seed.ts
decisions:
  - "ARMING_GATES.text_back reuses BOTH_CHANNELS whole (contact hours and escalation phone included), then smsArmed, divertNumber, divertVerified, textBackTemplates, neverTextOwnNumber (planner's flagged assumption 1, kept)"
  - "divertVerified is strict: the LATEST divert proof's artefact_detail must have caller_present === true and divert_number_id equal to the ACTIVE divert row; an older proof reads 'recorded · {id} · needs a diverted call showing the caller on the active number' and is never edited"
  - "armChannel creates an absent text_back row enabled with NULL identity (no no_identity refusal); per_tenant_only is returned before any statement for a null tenant on arm and disarm"
  - "The text-back arm asks privacyCoversCallers(PRIVACY_COPY.sections) by importing the marketing copy module directly into the action (no lint rule forbids it), before the checklist read; disarm asks neither"
  - "text_back_proof requires status sent, route lead, ledger outcome sent with a provider id, delivery receipt delivered with a time, and a start inside the 24h verification window; artefact_detail keys are provider_message_id, delivered_at, started_at, seconds_to_delivered (floored), after_hours, forwarded_from_present, route"
  - "The card shows an unmet verification proof by the core's detail (id plus 'needs a diverted call'), never 'verified on'"
  - "IN-02 (reconcile truncation signal) left untouched, per the plan's flagged assumption 2"
metrics:
  duration: 29m
  completed: 2026-10-06
  tasks: 3
  files: 18
actuals:
  tokens: 20200
  tasks: 3
  commits: 4
---

# Phase 12 Plan 08: Text-back arming Summary

After this plan, text-back can be turned on for one client from that client's "Ready to send?" card. The server re-reads a ten-item gate before it does so, the deployed privacy notice has to cover callers, and the database will not hold a global row. Turning it off is never gated, and every effective flip is audited. The checklist has seventeen rows, a "Text-back" live line, and a proof slot that only accepts a delivered text-back. Production runs this code, and no client is armed.

## What was built

**Task 1: the vocabulary, repository, gates and checklist** (`9add17c`)
- `MESSAGING_CHANNELS` now includes `text_back`. `npm run db:generate` reports "No schema changes". `TouchChannel` is unchanged.
- `armChannel` and `disarmChannel` return `{ kind: 'per_tenant_only' }` before any statement when the tenant is null on `text_back`.
- Arming a client with no `text_back` row creates it, enabled, with NULL identity, and writes one `arm` audit row (actor `operator`) in the same transaction. A second arm returns `already_armed` and writes nothing.
- `ARMING_GATES.text_back` has ten keys, listed under Decisions. The `sms` and `email` gate lists are unchanged.
- `CHECKLIST_ITEM_KEYS` has 17 entries, ending with `textBackTemplates`, `neverTextOwnNumber`, `textBackArmed`, `textBackProof`. The single read batch grew from 15 to 19 reads:
  - `attestedSetStatus()`
  - `countOwnLines()`
  - `isTextBackArmed(tenantId)`, the exact-target read
  - `proofs.latest('text_back_proof')`
- Each new row's rule:
  - `textBackTemplates` is met only when every `TEXT_BACK_VARIANTS` entry is true. Otherwise the detail lists the missing variants.
  - `neverTextOwnNumber` is met when the client has at least one own line. The detail gives the count, never a number.
  - `divertVerified` is strict (see Decisions).
  - `live.textBack` comes from the same `deriveLive` as the other channels. `arming.textBack = { armed }` and `proofs.textBack` were added.
- To keep this commit compiling with text-back still unarmable, the action schemas listed only `sms` and `email`. A test proved a `text_back` POST was refused at the schema. Task 2 opened them.

**Task 2: the actions** (`e5a546a`)
- `armChannelAction`, for `text_back`:
  - A request aimed at everyone gets `ARM_TEXT_BACK_PER_CLIENT_MESSAGE`. This happens before any read.
  - `privacyCoversCallers(PRIVACY_COPY.sections)` is checked against the copy `/privacy` renders. If it is false, the action returns `ARM_TEXT_BACK_PRIVACY_MESSAGE` before reading the checklist.
  - Then `readGoLiveChecklist` (a read that throws counts as a refusal), `firstUnmetGate('text_back')` and `ARM_REFUSAL[key]`.
  - Target mapping is `channel === 'sms' && target === 'everyone' ? null : tenantId`.
- `disarmChannelAction` refuses `text_back` aimed at everyone. Otherwise it reads no checklist and no privacy notice, and it still requires a reason.
- `recordProofAction` has a new `text_back_proof` arm:
  - The pasted id must be a uuid. The armed gate is the `textBackArmed` row.
  - It calls `getTextBackEvidenceForTenant` and refuses with its own sentence when: the call was not texted, the route is not lead, the ledger outcome is not sent or has no provider id, the delivery receipt is missing or not delivered, or the call is outside the 24h window.
  - `artefact_detail` holds the seven keys listed under Decisions and no number.
- New sentences:
  - the five new `ARM_REFUSAL` keys
  - the `text_back` entries in the already-armed, already-disarmed, armed and disarmed maps
  - the per-client and privacy refusals
  - five proof refusals and the recorded sentence

**Task 3: the card, then deploy** (`1e69e16`)
- The four new rows use the runbook's exact labels. The two text-back page rows link to `/clients/{id}/text-back` ("Set it up →"). The switch and proof rows carry their controls on the card itself.
- There is a third live line, "Text-back", using `LIVE_LABEL`.
- `TextBackControls` follows the `EmailControls` pattern and has no every-client control:
  - "Turn text-back on for this client" asks for confirmation ("Yes — turn text-back on for this client"). Between the two taps it warns: "From the next missed call, callers to this client's diverted number get the attested text from the shared SMS number. Nobody else is affected."
  - "Turn text-back off for this client" requires a reason. Its note says the greeting keeps answering and calls keep being logged.
- The text-back proof slot uses the plan's field and note hints.
- In the arming history, a system disarm reads "· system" with its reason.
- `page.tsx` passes the text-back audit, the proof (date formatted in the client's zone), and the widened `live` and `arming` objects.
- `tests/client-divert-runbook.test.ts` now reads the card and checks that the 4 labels and 2 control labels appear verbatim, and that there is no `text_back` everyone control. The stale count comment in `tests/runbook-contract.test.ts` is corrected; none of its lists changed.
- `target: 'everyone'` count in `checklist-card.tsx`: **2 before, 2 after**.

## Verification

- Pure suites, local, all green:
  - text-back-arming-gate (34)
  - arming-actions (53)
  - proof-actions (75)
  - divert-provision-action
  - client-divert-runbook
  - runbook-contract
  - layout-contract
  - lint-ban
  - operator-authorization
  - console-error-leak
- `npm run typecheck` and `npm run lint` are clean at each task's commit. `npx next build` compiled.
- The new suites failed before their implementation:
  - The gate table had 33 of 34 fail against the base `arming.ts`.
  - The new action cases had 22 fail against Task 1's `actions.ts`.
- A bare `npx vitest run` passed all 4519 pure tests. The 50 failing files are the DB-backed suites, which refuse a non-local database by design.
- The must-not-move check passed: `git diff --quiet 2b3a66f -- tests/cron-schedules.test.ts tests/sync-upsert.test.ts tests/report-metrics.test.ts scripts/apply-cron-schedules.mjs src/db/migrations` exits 0.
- **CI:** run `37412627015` on `1e69e16` (the pushed HEAD, equal to `origin/main`) succeeded, 164 of 164 files. It was the first run of the edited DB suites: go-live-checklist (36 tests), onboarding-checklist-gate (25) and messaging-config-arming (20, including the text_back cases and the CHECK refusal).
- **Deployment:** `dpl_BV4xX4GBWv1YhiDzdQAL6VNPtMKL` (GitHub deployment 6875509329, state success) is **Ready** and aliased to app.backdesk.com.au. Its function region is syd1.
- **Doors:** `/login` returned 200. `POST /api/webhooks/twilio/voice` and `/voice-status` returned 401, with a wrong token and with none.
- **Post-deploy read-backs (read-only):**
  - `npm run text-back:timing -- --tenant 13e8f2aa-… --limit 1` ended with `text_back_armed=false` and `sms_enabled_for_tenant=false`.
  - `scripts/db-status.mjs` printed `messaging_config text_back: rows=0 enabled=0`. No `text_back` row exists in production.
- **Test tenant's "Verification call recorded" under the strict rule:** checked with a read-only query. The latest divert proof is `b79a5f9d-1edb-447c-9f94-8cc991ce2ea1`, recorded 2 Oct. Its `artefact_detail` has neither `caller_present` nor `divert_number_id`; the divert row is `active`. So the row is unmet and reads `recorded · b79a5f9d-1edb-447c-9f94-8cc991ce2ea1 · needs a diverted call showing the caller on the active number`. Text-back for the test tenant is refused at `divertVerified` (after `smsArmed`, which is also unmet) until 12-09's fresh diverted call.
- **Human check still open:** look at the card at phone width on app.backdesk.com.au/clients/13e8f2aa-…. Expect seventeen rows, the "Text-back: Not armed" line, and the strict-proof wording. Do not tap the arm control.

## Deviations from Plan

### Auto-fixed / auto-added

**1. [Rule 2 - Correctness] Text-back arming history read added to the page's degrading batch**
- **Found during:** Task 3
- **Issue:** The plan says "no new query outside `readGoLiveChecklist`". But the must-have "a system auto-disarm is shown in the client's arming history as 'system'" needs the `text_back` audit rows. The sms and email history reads cannot return them.
- **Fix:** Added `listChannelAudit('text_back', { tenantId, includeGlobal: false }, 3)` inside the existing try/`Promise.all` that already carries the sms and email audit reads, so it degrades with them. Added `actor` to `ChecklistCardAuditLine`.
- **Commit:** `1e69e16`

**2. [Rule 3 - Blocking] `tests/helpers/seed.ts` `seedProof` kind widened to `text_back_proof`**
- **Found during:** Task 1 (file not in the plan's list). The DB-backed `live.textBack → live` case needs to seed that kind.
- **Commit:** `9add17c`

**3. [Rule 2] Extra refusals and DB cases**
- Added beyond the plan:
  - an `armNoIdentityMessage` branch for `text_back`, which the code cannot reach but is never email's sentence
  - `already_armed` and `already_disarmed` sentences for text-back
  - DB cases for a good proof on a number that is no longer active, latest-wins supersession (the old row is asserted unedited), and the full ten-of-ten gate opening on a real database, then refusing at `smsArmed` once SMS is turned off (D-15 adjacency)
- **Commits:** `9add17c`, `e5a546a`

### TDD note
Tasks 1 and 2 are marked `tdd="true"`. Their tests were written in the same session as the implementation and committed together with it (`feat` commits only, no separate `test(...)` commit). RED was shown before each commit by running the new suites against the base sources: 33 of 34 failed for the gate, 22 for the actions.

## Requirements

TXT-05 is ticked. Its full text is now true and CI-proven:
- per-client arming through the existing gate, plus the strict verification call, the attested template set and own numbers on the never-text list
- the checklist shows the rows and the live line
- disarming takes effect on the next call: `sendTextBack` reads `isTextBackArmed` on every call, and the send side is pinned in `tests/text-back.test.ts`

## Known Stubs

None.

## Threat Flags

None. Every surface in this plan is in its threat register: T-12-05, T-12-25, T-12-03, T-12-14, T-12-31, T-12-07 and T-12-32.

## Self-Check: PASSED
- Files: tests/text-back-arming-gate.test.ts, src/core/onboarding/arming.ts, src/core/onboarding/checklist.ts, src/app/(console)/clients/[id]/checklist-card.tsx, src/app/(console)/clients/[id]/actions.ts all present.
- Commits: 9add17c, e5a546a, 1e69e16 are present in `git log`, and 1e69e16 is `origin/main`.
