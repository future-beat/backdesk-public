---
phase: 12-instant-text-back-arming
plan: 06
subsystem: console + core/leads
status: complete
tags: [text-back, templates, attestation, never-text, server-actions, console]
requires:
  - 12-01 (text_back_templates + tenant_never_text_numbers schema; validateTextBackTemplate + defaultTextBackBody)
  - 12-02 (forTenant().textBackTemplates / .neverText namespaces; isTextBackArmed)
  - 12-03 (migration 0039 live)
provides:
  - saveTextBackTemplate / attestTextBackTemplate (src/core/leads/template-admin.ts)
  - normalizeNeverTextInput / addNeverTextNumber / removeNeverTextNumber (src/core/leads/never-text.ts)
  - /clients/[id]/text-back console page with four server actions
  - client page link "Text-back templates and never-text list →"
affects:
  - 12-08 (arming reads the attested set and the own-line count this page writes; the IN-07 removal refusal reads isTextBackArmed, live once arming exists)
tech-stack:
  added: []
  patterns:
    - drafting/ four-file console shape (page, forms, actions, action-state leaf)
    - requireOperatorId -> RLS tenant read -> zod -> core in try with fixed-string log
    - poisoned FormData (throwing getters) to pin guard order
key-files:
  created:
    - src/core/leads/template-admin.ts
    - src/core/leads/never-text.ts
    - src/app/(console)/clients/[id]/text-back/page.tsx
    - src/app/(console)/clients/[id]/text-back/forms.tsx
    - src/app/(console)/clients/[id]/text-back/actions.ts
    - src/app/(console)/clients/[id]/text-back/action-state.ts
    - tests/text-back-admin.test.ts
    - tests/text-back-actions.test.ts
  modified:
    - src/app/(console)/clients/[id]/page.tsx
    - tests/lint-ban.test.ts
    - tests/operator-authorization.test.ts
decisions:
  - "A byte-identical resave of a text-back wording is refused as 'unchanged' — an unattested copy of an attested wording would invite a second attestation of live text"
  - "Attest checks already-attested BEFORE re-validating: an existing stamp is evidence and is not re-judged; a non-attested version that fails today (renamed business) is refused with 'save it again'"
  - "Never-text input has separators stripped before classifyCaller, and only +61[23478] + 8 digits is kept (narrower than the column CHECK) — '+61 8 9123 4567' is the office line, a 13/1300 or +615 number is not a client's line"
  - "The IN-07 last-own-line guard is a check, not a lock: two concurrent removals of an armed client's last two own lines could both pass; accepted (one operator; the gate also compares escalation phone, divert number and ForwardedFrom)"
metrics:
  duration: 13m
  completed: 2026-10-06
  tasks: 2
  files: 11
actuals:
  tokens: 23400
  tasks: 2
  commits: 3
---

# Phase 12 Plan 06: Text-back console page Summary

The operator can now save, measure and write-once attest the three text-back wordings per client (validated at save and again at attest, stored as normalised literal bytes with the business name typed in), and maintain a never-text list that accepts the client's own lines in any common spelling and refuses to drop the last one while text-back is armed — all from `/clients/{id}/text-back`, linked from the client page.

## What was built

**Task 1 — the rules (core, framework-free)** — `a46a976` (RED), `5c11fb6` (GREEN)
- `saveTextBackTemplate`: tenant name → `validateTextBackTemplate` → `insertVersion` with the validator's `normalizedBody` and `segments`; kinds `saved | invalid | unchanged | tenant_missing`. Never attests.
- `attestTextBackTemplate`: note trimmed, required, ≤500 before any read; version by id (tenant-scoped); `already_attested` if stamped; re-validates the stored body against the current name (`invalid`); `attestWhereUnattested` (zero rows → `already_attested`). Never edits.
- `normalizeNeverTextInput` via `classifyCaller`; `addNeverTextNumber` (`added | already_listed | invalid_number | invalid_label`); `removeNeverTextNumber` (`removed | not_found | last_own_line_while_armed`). No number is logged or returned.
- `tests/text-back-admin.test.ts` (641 lines, 54 tests): every validator rule refuses with nothing inserted, curly → straight apostrophe stored, three spellings of one mobile → one row, landline accepted, UK / withheld / sentinel / 1300 / lost-zero refused, last own line refused only while armed, foreign id is `not_found`.

**Task 2 — the page** — `bcf21f3`
- `action-state.ts` (client-reachable leaf): one sentence per validator rule (typed `satisfies Record<TextBackTemplateRule, string>`), the save / attest / never-text sentences from the plan, variant and kind labels.
- `actions.ts`: four async exports; operator (`requireOperatorId`) → RLS tenant read → zod (`TEXT_BACK_VARIANTS`, uuid, `NEVER_TEXT_KINDS`, bounded strings) → core inside try/catch with `[text-back] … failed` fixed logs → sentence → `revalidatePath` for the page and the client page.
- `forms.tsx`: per-variant textarea + "Save version"; "Attest this wording" form with a required note, rendered only under an unattested latest version; never-text form (Number with tel keypad, Kind radio "Client's own line" / "Never text", Label, "Add number"); per-entry "Remove".
- `page.tsx`: RLS tenant gate, degrading reads (templates, list, armed), per-variant state badge ("Attested on {date}" in the client's zone / "Saved, not attested — not in use" / "Not set"), the in-use attested body shown when a newer unattested version sits over it, default pre-fill via `defaultTextBackBody`, the own-lines explanation line and a banner when the list has no own line.
- Client page link beside "Voice & templates". `CLIENT_REACHABLE` gains the two leaf files.
- `tests/text-back-actions.test.ts` (56 tests): every action refuses signed-out / non-operator / non-member / malformed tenant id with a FormData whose getters throw; bad variant, empty / oversized body, non-uuid version and entry ids, unknown kind refused before the core; every result kind → its sentence; a throwing core → generic sentence + exactly one fixed log line containing no number.

## Verification

- `npx vitest run tests/text-back-admin.test.ts tests/text-back-template.test.ts tests/text-back-structure.test.ts` — green (365)
- `npx vitest run tests/text-back-actions.test.ts tests/text-back-admin.test.ts tests/lint-ban.test.ts tests/console-error-leak.test.ts tests/layout-contract.test.ts tests/operator-authorization.test.ts` — green (427)
- `npm run typecheck`, `npm run lint` — clean; `npx next build` — compiled, `ƒ /clients/[id]/text-back` listed
- Bare `npx vitest run`: 4347 pure tests pass; the 48 failing files are the DB-backed suites refusing a non-local Supabase (CI-only by design, not run)
- Static harness (throwaway, not committed): rendered the server page with mocked Supabase / repository — three variant blocks (default pre-fill naming the tenant; saved-not-attested with the in-use v1 body and the attest form; attested with its note), the never-text entry with Remove, and the add form with Number / Kind / Label. One column, no table.
- Human check (phone layout at app.backdesk.com.au after the next production deploy) remains for the operator, per the plan's `<human-check>`.

## Deviations from Plan

### Auto-added

**1. [Rule 2 - Correctness] `unchanged` result for a byte-identical resave**
- **Found during:** Task 1
- **Issue:** without it, re-saving the attested wording mints an unattested copy, and the page would show "Saved, not attested — not in use" over text that is live (the drafting page's no-change refusal, same reason).
- **Fix:** `saveTextBackTemplate` compares the normalised bytes with `latestForVariant`; maps to "That is the wording already saved — nothing changed."
- **Commit:** `5c11fb6`, `bcf21f3`

**2. [Rule 2 - Correctness] Separators stripped before `classifyCaller`; AU leading digits narrowed**
- **Found during:** Task 1
- **Issue:** `classifyCaller`'s E.164 rule reads the value as given, so `+61 8 9123 4567` would be refused; and the column CHECK alone would admit `+615…`/`+611…`.
- **Fix:** strip `[\s().-]` first (classifyCaller remains the one normaliser); keep only `^\+61[23478]\d{8}$`.
- **Commit:** `5c11fb6`

**3. [Rule 2 - Security] Text-back actions pinned in `tests/operator-authorization.test.ts` `GUARDED_PATHS`**
- **Found during:** Task 2 (file not in the plan's list)
- **Fix:** one entry so the requireOperatorId-from-`_auth` source scan covers the new actions.
- **Commit:** `bcf21f3`

**4. [Rule 2] Sentences added beyond the plan's list:** label too long, entry not found, generic write failure, body far too long, and a non-identity re-validation failure that names the rule. All fixed strings; none carries an entered number.

## Requirements

TXT-01 and TXT-05 are this plan's contribution only (the attested wording surface and the never-text list); they are NOT marked complete in REQUIREMENTS.md — TXT-05 closes with arming in 12-08 and TXT-01 with the live send proof in 12-09.

## Known Stubs

None. The IN-07 refusal reads `isTextBackArmed`, which is always false until 12-08 adds `text_back` arming; the refusal is written and tested against the armed case now.

## Threat Flags

None — both tables, the actions' authorization model and the logging rule are in the plan's threat register (T-12-07, T-12-08, T-12-11, T-12-23, T-12-24).

## TDD Gate Compliance

Task 1: `test(12-06)` `a46a976` (RED — import failed) then `feat(12-06)` `5c11fb6` (GREEN). No refactor commit needed.

## Self-Check: PASSED
