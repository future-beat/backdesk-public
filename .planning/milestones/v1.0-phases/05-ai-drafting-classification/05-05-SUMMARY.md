---
phase: 05-ai-drafting-classification
plan: 05
subsystem: console
tags: [onboarding, onb-03, activation-gate, voice-profile, template-versions, attestation, d-04, d-05, d-06, d-08]
status: complete
requires:
  - "05-01: message_templates table (append-only versions, write-once approved_at), cadence_settings voice columns"
  - "05-03: approveTemplateVersion, unapprovedTouchNumbers, templates.{insertVersion,listVersions,approvedSetStatus}"
  - "Phase 4 (04-06): settings/email — the four-file config-authoring unit this mirrors"
  - "Phase 3 (03-05): the authorize-first server-action shape in quotes/[quoteId]/actions.ts"
provides:
  - "src/app/(console)/clients/[id]/drafting/{page,actions,action-state,forms}.tsx — the ONB-03 operator surface"
  - "saveVoiceProfile, saveTemplateVersion, attestTemplateApproval — three authorize-first server actions"
  - "settings.updateVoiceProfile — exhaustive six-column upsert that cannot disturb paused_at"
  - "The byte-equality no-change refusal on template saves"
  - "A rendered destination for RESUME_CADENCE_ONBOARDING_GATED_MESSAGE (05-03's dangling pointer)"
affects:
  - "05-07 (console approve/edit of drafts — reuses this authorize() shape and the DraftingState feedback pattern)"
  - "Phase 6 (the approval queue — the voice profile and template set it drafts against are authored here)"
  - "Any future email-template authoring: the schema's subject column stays deliberately unused (D-04)"

tech-stack:
  added: []
  patterns:
    - "getAll()-backed repeated form fields so the COUNT is something zod can refuse, not something the form merely limits"
    - "Sanitize-then-compare: byte equality over the exact bytes that WOULD be stored, never over a normalized projection"
    - "Invisible-character stripping at the operator→prompt boundary (C0/C1/DEL/bidi/zero-width), newlines preserved"
    - "authorize() returns the tenant's timezone, so a console sentence carrying an instant renders in the client's wall clock without a second read"

key-files:
  created:
    - src/app/(console)/clients/[id]/drafting/page.tsx
    - src/app/(console)/clients/[id]/drafting/actions.ts
    - src/app/(console)/clients/[id]/drafting/action-state.ts
    - src/app/(console)/clients/[id]/drafting/forms.tsx
    - tests/drafting-settings-action.test.ts
  modified:
    - src/app/(console)/clients/[id]/page.tsx
    - src/db/repository/for-tenant.ts

key-decisions:
  - "The page's domain reads go through forTenant() after an RLS-scoped tenants read, NOT through PostgREST — re-deriving approval progress in the console would be a second definition of the T-5-13 rule"
  - "channel is a zod LITERAL 'sms', not a default — a forged channel=email is refused rather than coerced (D-04)"
  - "The byte-equality comparison is against the LATEST version, approved or not — re-saving an unapproved draft unchanged is equally not a new version"
  - "already_approved is a SUCCESS, not an error, and carries the stored evidence in the client's timezone"
  - "The required evidence note IS the attestation's confirmation step; no arm-then-confirm was added"
  - "An over-length template WARNS rather than refuses — the template is prompt input, the validator judges the draft"
  - "settings.updateVoiceProfile upserts with a NAMED conflict SET over six columns, so a voice save can never touch paused_at"

patterns-established:
  - "Repeated-field forms: render N boxes under one name, refuse the count server-side — the boxes are convenience, the count is the rule"
  - "Empty list writes NULL, not [] — 'they have none' and 'nobody asked' are different facts a nullable array column can hold"
  - "Source assertion for an ABSENT affordance: pin the thing a later plan must not add, by name, in the files it would be added to"

requirements-completed: [ONB-03]

coverage:
  - id: D1
    description: "The operator can capture a voice profile (greeting, sign-off, formality, banned phrases, up to 3 real examples, notes) that is validated and stripped at the boundary before it reaches a drafting prompt (D-05)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#stores the profile, with empty lists as NULL rather than []"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#STRIPS the characters that make text lie about what it says (T-5-19)"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#REFUSES a fourth example message — the form renders three, the endpoint is global"
        status: pass
    human_judgment: false
  - id: D2
    description: "Templates are append-only versions: editing an approved template inserts a NEW unapproved version and the approved row is never mutated (D-08)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#inserts the next version, UNAPPROVED, with no subject"
        status: pass
      - kind: integration
        ref: "tests/onboarding-gate.test.ts (05-03) — insertVersion numbering + save-is-not-attestation, against the hosted DB"
        status: pass
    human_judgment: false
  - id: D3
    description: "A byte-identical resubmission is refused as a no-change save rather than minting a duplicate version (ONB-03 encoding edge)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#REFUSES a byte-identical resubmission rather than minting a duplicate version"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#compares BYTES, not meaning — one changed character is a new version"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#does NOT equate a body that only differs by surrounding whitespace with a new version"
        status: pass
    human_judgment: false
  - id: D4
    description: "Attestation requires a free-text evidence note and is write-once; a second approval surfaces its own message and changes nothing (D-06, T-5-11, T-5-20)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#REFUSES an empty note without calling the core (T-5-20)"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#surfaces already_approved as its OWN message, and writes nothing"
        status: pass
      - kind: integration
        ref: "tests/onboarding-gate.test.ts (05-03)#REFUSES A SECOND APPROVAL AND LEAVES THE ATTESTATION BYTE-UNCHANGED (D-06)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The page shows which touch numbers still lack approved SMS wording, and the completing approval reports how many onboarding-paused cadences resumed (D-07)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#REPORTS how many paused follow-ups the completing approval resumed (D-07)"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#approval progress is read from approvedSetStatus, not re-derived (T-5-13)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Onboarding requires only the 5 SMS templates; no email template is required or authorable-as-required in v1 (D-04)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#REFUSES channel=email — the form offers none, and neither does the rule (D-04)"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#the form authors SMS only, and offers no channel choice (D-04)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every server action refuses before reading a byte of the body, for an unauthenticated caller, a stranger to this client, and a malformed tenant id (WR-01, T-5-18)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#every action is gated BEFORE it reads the body (WR-01, T-5-18) — 9 cases across 3 actions"
        status: pass
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#every export of the action module opens with the gate — the count is pinned"
        status: pass
    human_judgment: false
  - id: D8
    description: "No 'resume anyway' affordance exists on this surface — approval is the only unlock (05-03's closing directive, T-5-10)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "tests/drafting-settings-action.test.ts#NO RESUME AFFORDANCE EXISTS ANYWHERE IN THIS UNIT (05-03, T-5-10)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The rendered screen is usable one-handed on a phone during an onboarding call, and the operator can tell at a glance what blocks activation"
    verification: []
    human_judgment: true
    rationale: "Layout, tap targets and whether the activation banner reads as actionable are judgements about pixels. The page follows the established console classes (banner-error, disclosure, badge, hint muted) and the single-column full-width discipline the D-16 controls established, but nobody has opened it on a 390px screen."

metrics:
  duration: "22 min"
  completed: 2026-08-31

# Actuals (#2632) — estimateTokens scale (chars/4) over the realized diff.
actuals:
  tokens: 22000
  tasks: 3
  commits: 3
---

# Phase 5 Plan 05: The ONB-03 Operator Surface Summary

**The activation gate now has a door.** An operator can capture a tradie's voice,
author the five SMS touches as append-only versions, and attest — with typed
evidence — that the client approved this exact wording; and the approval that
completes the set tells them, in a sentence, how many follow-ups that had been
piling up paused since Tuesday just went live.

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-31T01:23Z
- **Completed:** 2026-08-31T01:45Z
- **Tasks:** 3
- **Files:** 7 (5 created, 2 modified), +2,111 / −0

## What Was Built

**Task 1 — the voice profile** (commit `d205ecd`). The four-file console unit at
`clients/[id]/drafting`, mirroring `settings/email` file-for-file, plus
`settings.updateVoiceProfile` on the tenant repository and a link from the client
detail page.

**Task 2 — template versions and the attestation** (commit `f5f2c19`).
`saveTemplateVersion` and `attestTemplateApproval`, and the per-touch cards that
render every version a touch has ever had, which one drafting is actually using,
and the evidence behind each approval.

**Task 3 — the suite** (commit `fc2f094`). 42 tests, entirely pure.

### The three writes, and what each one refuses

| Action | Refuses | Because |
| --- | --- | --- |
| `saveVoiceProfile` | a 4th example, a 481-char example, a 21st banned phrase, a 501-char field | the profile is the prompt's stable prefix; caps are a cost decision as well as a safety one |
| `saveTemplateVersion` | `channel=email`, touch 0/6/junk, an empty or 481-char body, **a byte-identical resubmission** | D-04, and the no-change rule below |
| `attestTemplateApproval` | an empty or 501-char note, a malformed version id | an attestation with no evidence is an approval nobody can later show happened (T-5-20) |

## Task Commits

1. **Task 1: voice profile capture (D-05)** — `d205ecd` (feat)
2. **Task 2: template versions + attestation (D-04/06/08)** — `f5f2c19` (feat)
3. **Task 3: the action suite** — `fc2f094` (test)

## Decisions Made

**1. The page's domain reads go through `forTenant()`, not through PostgREST —
the plan said "under the operator's JWT (RLS)".** The authorization is still the
RLS-scoped `tenants` read made with the operator's own JWT; what changed is where
the *domain* reads come from. The alternative was reading
`cadence_touch_templates` and `message_templates` separately under RLS and
computing approval progress on the page — which puts a **second definition of the
ONB-03 approval rule** in the codebase beside `approvedSetStatus`. 05-03 drove
that read from the TIMING table on purpose, so a tenant with no cadence shape
reads as unapproved rather than vacuously complete (T-5-13). Two copies of that
rule is exactly how the vacuous-truth trap returns — as a console that says "all
approved" for the one client the gate exists to stop. The cross-tenant defence is
unchanged: `forTenant(id)` scopes every query on an id the RLS read just proved
the caller may see. Pinned by a source assertion.

**2. `channel` is a zod `literal('sms')`, not a default.** A submitted
`channel=email` is refused rather than coerced. The difference is between "the
form does not offer that" and "the system does not do that", and only the second
survives a body the form did not build.

**3. The byte-equality comparison is against the LATEST version, approved or
not.** The plan says "the current latest version for that touch"; the reading
that matters is that re-saving an *unapproved* draft unchanged is equally not a
new version. The comparison is `===` between the exact bytes that would be stored
and the exact bytes that are — no trimming, case folding or whitespace
collapsing *at the comparison*. Sanitization runs before it, on both sides by
construction, because sanitization is what produced the stored bytes; a test
pins both directions (one changed character IS a new version; a trailing newline
is NOT).

**4. `already_approved` is a SUCCESS, not an error.** Nothing failed and the
operator did nothing wrong — the wording *is* approved, which is the state they
were asking for. Same argument `resumeCadence`'s `onboarding_gated` makes. The
sentence carries the stored `approved_at` and note, rendered in the CLIENT's
timezone, because the operator who double-tapped and the operator reading a
colleague's approval need different things from it and the evidence serves both.

**5. No arm-then-confirm on the attestation, unlike the kill switch.** It already
has a better confirmation step: the form cannot be submitted without the operator
*typing* how the client approved. That is a deliberation an arm-then-confirm
pattern only simulates — and unlike a second tap, what they type is kept.

**6. An over-length template WARNS; it does not refuse.** The template is prompt
input, not a message, and the validator judges the *draft*. But a template
already over D-03's two-segment limit before the model adds a name and a price
will produce drafts that fail every time, and the operator should learn that at
save rather than from an empty approval queue three days later.

**7. `updateVoiceProfile` upserts with a NAMED conflict SET over six columns.**
`ensure()` is `DO NOTHING` because it must never overwrite; this method's whole
purpose is to overwrite the voice columns. Naming them rather than spreading the
patch is what guarantees a voice save can never disturb `preferred_send_time` or
— far more importantly — `paused_at`, the D-06 kill switch that happens to share
this row.

**8. `VoiceProfilePatch` is exhaustive, not `Partial`.** The profile is edited on
one form that submits every field at once, so an absent key means the operator
CLEARED that field. A partial patch would silently keep the old value, leaving a
banned phrase the client has since withdrawn sitting in the drafting prompt with
a screen that says it is gone.

## Deviations from Plan

### Judgement calls recorded because they differ from the plan's wording

**1. The page reads through `forTenant()` rather than PostgREST.** Decision 1
above. The security property the plan named (the operator's own JWT decides
entitlement) is intact; the read *path* for domain data changed to avoid a second
copy of the T-5-13 rule.

**2. The test suite was built incrementally across all three tasks, not written
whole in Task 3.** Tasks 1 and 2 each declare
`npx vitest run tests/drafting-settings-action.test.ts` in their `<verify>`
blocks, while Task 3 is the task that creates that file. Running a verification
against a file that does not exist yet is not a verification, so each task landed
its own portion and Task 3 completed the suite (the source assertions and the
`it.each` gate matrix over all three actions). Every task's stated verify command
ran green *at that task's commit*.

### Auto-fixed

**3. [Rule 1 — Bug in my own test] The override helper asserted the value it was
overriding**

- **Found during:** Task 1, writing the sanitization test.
- **Issue:** `form()` built every field with `FormData.append`, so a test that
  passed `['greeting_style', 'Hi  there']` as an override produced a
  FormData holding BOTH the base value and the override — and `formData.get()`
  returns the FIRST. Every override test was silently asserting the base
  fixture. The strip test caught it by failing; the length-refusal tests would
  have passed for the wrong reason indefinitely.
- **Fix:** `form()` now `set`s scalars and `append`s only `example_message`,
  which is exactly what the real form does (three boxes under one name so the
  action can count them). Reason recorded in the helper.
- **Commit:** `d205ecd`

**4. [Rule 1 — Bug in my own test] The strip test submitted four example messages**

- **Found during:** Task 1, first run.
- **Issue:** the base fixture already carries two examples and the strip test
  appended two more, so it would have been refused by the 3-example cap — the
  test asserting `state.error` is null was about to fail for a reason that had
  nothing to do with stripping.
- **Fix:** one override, and the expectation names all three resulting examples.
- **Commit:** `d205ecd`

**5. [Rule 3 — Blocking] Raw control characters written into source**

- **Issue:** the invisible-character regex and the sanitization test's fixtures
  were first written with LITERAL control characters embedded in the files —
  which is precisely the hazard those lines exist to describe. `grep` treated
  both files as binary.
- **Fix:** both rewritten with explicit `\u` escapes. A test about invisible
  characters must not itself contain any, and a reviewer must be able to see
  which characters a stripping regex covers.
- **Commits:** `d205ecd`

**6. [Rule 3 — Blocking] Lint: an unused `eslint-disable no-control-regex`** —
once the ranges were written as `\u` escapes the rule no longer fires, and
`--max-warnings=0` treats a redundant directive as a warning. Removed.

---

**Total deviations:** 2 judgement calls recorded, 4 auto-fixed (2 bugs in my own
tests, 2 blocking).
**Impact:** no scope change. The two test bugs are the same shape 05-01 and 05-03
each recorded — a test green because the mechanism it claims to exercise was
never reached.

## Verification Evidence

| Check | Result |
| --- | --- |
| `npx vitest run tests/drafting-settings-action.test.ts` | **42 passed** (new suite) |
| `npm test` (pure, no credentials) | **1371 passed, ZERO assertion failures** |
| `npm test` failed *files* | **31 — unchanged from 05-03's baseline.** Verified by counting DISTINCT error strings across the whole run: **one** (`Refusing to run integration tests against a non-local Supabase`), 62 occurrences = 31 files × 2. Zero `AssertionError`/`TypeError`/`ReferenceError`/`SyntaxError` anywhere in the output |
| `npx tsc --noEmit` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm run test:remote` | **not run, deliberately** — no hosted-DB work in this plan, and wave 3's single remote budget belongs to 05-04 |
| File deletions across the three commits | **0** (`git diff --diff-filter=D`) |

### The must_haves truths, each pinned by a named test

| Truth | Test |
| --- | --- |
| Voice profile capturable, validated, stripped (D-05) | "stores the profile, with empty lists as NULL rather than []" + "STRIPS the characters that make text lie about what it says" |
| Five SMS touches authorable, approval attested per version with required evidence (D-06) | "delegates to approveTemplateVersion EXACTLY ONCE, with the note verbatim" + "REFUSES an empty note without calling the core" |
| Editing an approved template inserts a NEW unapproved version (D-08) | "inserts the next version, UNAPPROVED, with no subject" |
| Byte-equality no-change refusal (ONB-03 encoding edge) | three tests, both directions |
| Approval progress shown; the completing approval reports resumed cadences (D-07) | "REPORTS how many paused follow-ups the completing approval resumed" + "approval progress is read from approvedSetStatus, not re-derived" |
| SMS only; no email template required or authorable-as-required (D-04) | "REFUSES channel=email" + "the form authors SMS only, and offers no channel choice" |

### Three 05-03 stubs retired

05-03 recorded three symbols as intentional stubs "resolved by 05-05". All three
now have production callers:

| Stub | Caller now |
| --- | --- |
| `unapprovedTouchNumbers` had no caller | `attestTemplateApproval`, on the still-incomplete branch |
| `templates.insertVersion` / `listVersions` had no production caller | `saveTemplateVersion` and the page's per-touch cards |
| `RESUME_CADENCE_ONBOARDING_GATED_MESSAGE` pointed at a screen that did not exist | `/clients/{id}/drafting`, linked from the client detail page |

### Surprises & findings

**The plan's `<verify>` blocks depend on a file the plan creates last.** Tasks 1
and 2 both run `npx vitest run tests/drafting-settings-action.test.ts`, which
Task 3 creates. Not a defect in the plan so much as a property of how a
four-file console unit is naturally sequenced — recorded because the honest
resolution (build the suite incrementally) is not what a literal reading of the
task boundaries prescribes, and a future executor hitting the same shape should
not silently skip a verify command instead.

**`FormData.append` and `FormData.set` are the difference between a test helper
that overrides and one that lies.** Written up in deviation 3 because it is the
second time in this phase that an override mechanism produced green tests about
the wrong input — and it took a *failing* test (the sanitization one) to expose
five *passing* ones.

## Known Stubs

| Stub | File | Reason / resolved by |
| --- | --- | --- |
| `message_templates.subject` is written NULL on every row and no code path authors an email template | `actions.ts`, `forms.tsx` | **Intentional, D-04.** The column exists so the Phase 4 email arm needs no migration. Email template authoring rides with first-client email enablement (the MSG-02 event), not with a phase. |
| No delete/retire for a template version | — | **Intentional.** The table is append-only because `touch_drafts` rows reference the version they were generated from (AI-04 evidence). Superseding a wording is a new version, which is the whole mechanism. |
| The page has no "preview a draft from this template" affordance | `page.tsx` | Not in scope. The drafting pass (05-04) produces drafts on the tick and 05-07 builds the review surface; a synchronous preview here would be a second, differently-shaped call to the model. |

None of these prevent the plan's goal: a client can be onboarded end to end from
this page, and the approval that completes their set is what lets their
follow-ups send.

## Deferred / Owed

- **Nothing owed from this plan.** Every command in the plan's `<verification>`
  block was run and passed.
- **`ONB-03` is marked COMPLETE by this plan**, per the rule 05-01 recorded and
  04-10 set: a requirement is marked by the LAST plan that claims it. 05-03 built
  the state-machine half and explicitly deferred the mark here;
  `requirements.ready-ids` independently returned `1/1 ready`.
- **D9 (the phone-screen judgement) is unverified by construction** — see the
  coverage entry. It belongs in UAT, not in a test.
- Pre-existing and still open: the undeployed-commit note. This plan's changes
  are also undeployed. Production still runs a build with no drafting page and no
  onboarding gate, so a real client connected today would get cadences born
  ACTIVE with no approved wording. **Deploy before onboarding any real client.**

## Threat Flags

None. All three register entries are implemented and asserted:

- **T-5-18** (unauthenticated POST to the action that opens the gate) —
  `authorize(tenantId)` runs before a byte of `formData` is read in all three
  exports, proven by nine behavioural cases *and* a source assertion that pins
  the export count at three and requires each one's first statement to be the
  gate. The refusals are asserted as SILENCE across every write seam, not by the
  returned message alone.
- **T-5-19** (prompt injection via operator-authored text) — **accepted**, as the
  register says, with the stated mitigations in place: C0/C1/DEL/bidi/zero-width
  characters stripped, every field length-capped, and the validator plus the
  human review gate remaining the boundaries that matter. The operator is the
  sole trusted author in v1.
- **T-5-20** (attestation without evidence) — the note is required non-empty at
  zod *and* required-as-a-parameter at the core, and write-once is enforced by
  `approveWhereUnapproved`'s `WHERE approved_at IS NULL` (05-03).

No new network surface, no new endpoint, no new schema object, no new
dependency. One new repository method, on an existing table, whose conflict SET
deliberately cannot reach the D-06 pause column.

## Next Phase Readiness

**05-07** (the console approve/edit of drafts) inherits the `authorize()` shape,
the `DraftingState`/`Feedback` pattern and the message-constants split verbatim —
and inherits one useful constraint for free: the voice profile and approved
template set its drafts are produced from are now authorable, so a test tenant
can be driven from empty to draftable entirely through the console.

**One thing 05-07 must not do:** re-derive "is this set approved" anywhere. The
answer has exactly one definition (`approvedSetStatus`, driven from the timing
table) and this plan's source assertion exists to keep it that way.

## Self-Check: PASSED

- `src/app/(console)/clients/[id]/drafting/{page,actions,action-state,forms}` — all FOUND
- `tests/drafting-settings-action.test.ts` — FOUND
- Commits `d205ecd`, `f5f2c19`, `fc2f094` — all FOUND in `git log`

---
*Phase: 05-ai-drafting-classification*
*Completed: 2026-08-31*
