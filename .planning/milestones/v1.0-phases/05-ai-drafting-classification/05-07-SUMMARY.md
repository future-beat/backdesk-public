---
phase: 05-ai-drafting-classification
plan: 07
subsystem: console
tags: [ai, console, approval, d-11, d-12, d-13, d-14, d-15, ai-02, ai-04, trust-boundary]
status: complete
requires:
  - "05-01: touch_drafts schema, drafts.approve (write-once via unique partial index), touches.approveWhere guarded on pending_approval, final_body frozen at draft time"
  - "05-02: normalizedEditDistance and validateDraft — the metric and the trust boundary this plan calls at approval time"
  - "05-04: draft-touches' merge-fact construction, which this plan extracted so the whitelist has one definition"
  - "05-06: inbound_messages label/label_confidence/is_hot columns and TRIAGE_ATTRIBUTIONS — the read this plan widens"
provides:
  - "approveDraft / editAndApproveDraft — the only two paths by which AI text reaches a customer"
  - "src/core/drafting/merge-facts.ts — ONE builder for the validator whitelist, shared by the drafting pass and the approval action"
  - "the AI-04 edit-distance record, written on every approval including the explicit zero"
  - "DraftReview — the per-quote review card (CON-01's queue is Phase 6)"
  - "the widened triage read: soft opt-outs ranked first IN SQL, below-high-confidence second"
  - "SuppressContactForm — a suggestion that delegates to the EXISTING killContact and adds no write path"
affects:
  - "Phase 6 CON-01 (the deadline-sorted approval queue reads the same touch_drafts rows this card does)"
  - "Phase 6 CON-02 (hot-lead escalation consumes is_hot, now visible on the triage screen)"
  - "V2-01 graduated autonomy — the edit_distance column starts filling from the first approval"
tech-stack:
  added: []
  patterns:
    - "extract a shared builder the moment a second caller needs a derived set, because two renderings of a whitelist do not fail loudly — they refuse the value they were meant to permit"
    - "rank a capped queue IN SQL: a sort applied after the LIMIT orders only the rows the cap admitted"
    - "a suggested action is a component, not an endpoint — the privilege boundary is that model output may put a BUTTON on a row and nothing more"
    - "pin the clock a derived fact was computed at, not just the fact"
key-files:
  created:
    - src/core/drafting/merge-facts.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx
    - src/app/(console)/inbox/suppress-contact-form.tsx
    - tests/quote-draft-approval.test.ts
  modified:
    - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
    - src/app/(console)/inbox/page.tsx
    - src/core/drafting/draft-touches.ts
    - src/db/repository/inbound-messages.ts
    - src/app/globals.css
    - tests/inbox-authorization.test.ts
    - tests/inbound-threading.test.ts
key-decisions:
  - "The validator whitelist has ONE builder (merge-facts.ts) shared by the drafting pass and the approval action — two renderings of $2,450 would not fail loudly, they would refuse the price the draft was written with"
  - "The whitelist is rebuilt at the DRAFT's created_at, not at the approval's clock: days-since is a clock-derived fact, and D-14's lead time makes an overnight approval the ordinary case"
  - "Edit distance is measured against the validator's normalizedBody, not the raw submission — counting the normalizer's own repairs as operator edits would inflate every AI-04 number by work no human did"
  - "The triage priority rank lives in SQL, because the read is capped and a sort applied after the LIMIT orders only the rows the cap admitted"
  - "approveDraft and editAndApproveDraft are separate exports, not one action with an optional body — a body field's presence must not decide whether text was checked"
  - "The soft-opt-out suggestion arms before it confirms: T-5-27 is a mis-tap in a scrolling list of different customers, and killContact has no undo anywhere"
  - "The single authorize() was widened to return the tenant row rather than adding a second helper — two authorization functions in one 'use server' module is how the next action gets the weaker one"
requirements-completed: [AI-02, AI-04]
coverage:
  - id: C1
    description: "An operator can approve a pending draft unchanged, or edit then approve; approval freezes the exact bytes dispatch will send (D-12)"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#writes EXACTLY 0 for an approve-unchanged, never NULL"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#approves the draft FIRST and the touch only after"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#ACCEPTS an edit that only changes wording"
        status: pass
    human_judgment: false
  - id: C2
    description: "A validator_failed draft is unapprovable UNCHANGED, enforced server-side; edit-then-approve is the one path left open (D-11)"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#refuses approveDraft with its OWN distinct message"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#ALLOWS edit-then-approve on that same draft"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#renders the approve form ONLY on the non-failed branch"
        status: pass
    human_judgment: false
  - id: C3
    description: "A human edit is re-validated with the rebuilt whitelist — an unlisted price, a fabricated date, a deleted opt-out line, a third segment and a UCS-2 character are all refused with nothing written (T-5-26)"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#the whole 'an operator edit is re-validated with the REBUILT whitelist' block (12 tests)"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#builds the whitelist from the MIRROR, not from anything the form supplied"
        status: pass
    human_judgment: false
  - id: C4
    description: "Edit distance is recorded at the moment of approval: explicit 0 unchanged, the pinned normalized value on a one-character edit, at four decimal places (AI-04)"
    requirement: AI-04
    verification:
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#writes the pinned normalized value for a ONE-CHARACTER edit"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#keeps at least four decimal places — a two-place column would erase this"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#measures against the CANONICAL bytes, not the raw submission"
        status: pass
    human_judgment: false
  - id: C5
    description: "A soft opt-out tops the triage queue with a one-tap suggestion that runs the EXISTING killContact; the model never writes suppression (D-13)"
    requirement: AI-02
    verification:
      - kind: integration
        ref: "tests/inbound-threading.test.ts#puts a soft opt-out above an OLDER unmatched row, and a needs-human between them"
        status: pass
      - kind: integration
        ref: "tests/inbound-threading.test.ts#keeps a hard STOP in the queue and OUT of the soft-opt-out rank"
        status: pass
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#reaches no repository, no schema and no suppression table"
        status: pass
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#killContact is called from exactly one place outside its own module"
        status: pass
    human_judgment: false
  - id: C6
    description: "Below-high-confidence rows surface as needs-human with the guess shown and nothing acted on; hot rows are visible and drive nothing (D-14, D-15)"
    requirement: AI-02
    verification:
      - kind: integration
        ref: "tests/inbound-threading.test.ts#does NOT drag every threaded reply into the queue"
        status: pass
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#the page renders labels as GUESSES, never as findings"
        status: pass
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#does NOT put is_hot in the queue predicate"
        status: pass
    human_judgment: false
  - id: C7
    description: "Both actions authorize before a byte of formData is read, and read through forTenant scoped to the authorized tenant (T-5-25)"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#the tenant read happens before the first formData.get (order trace, both actions)"
        status: pass
      - kind: unit
        ref: "tests/quote-draft-approval.test.ts#EVERY exported action opens with the authorize call"
        status: pass
    human_judgment: false
  - id: C8
    description: "The review card and the triage decorations are usable one-handed on a phone by an operator between meetings"
    verification: []
    human_judgment: true
    rationale: "Every structural claim is asserted — monospace body, opt-in edit box, absent approve button on a failed draft, 44px stacked controls, live segment count, labels as guesses. What no test here settles is whether an operator standing in a driveway can actually read a 117-character SMS in a `pre` block on a 390px screen and spot a transposed price, which is the judgement the whole D-12 gate rests on. This is the same class of item as windows #2 and #4 (console surfaces verified by source assertion only) and needs a real device, not a renderer."
metrics:
  duration: "~45m"
  completed: 2026-08-31
actuals:
  tokens: 30000
  tasks: 3
  commits: 4
---

# Phase 5 Plan 07: The Human Half of the Gate Summary

**Every AI-drafted message now crosses a person before it can send, the crossing
is measured in a column that starts filling from the first approval, and a
customer who asks to be left alone in a sentence the STOP regex does not match
reaches the top of the operator's screen with a button that runs the Phase 3
suppression transaction — a button, and nothing else, being the entire extent of
what a model's opinion may cause.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3
- **Files changed:** 13 (4 created), 0 deletions
- **Commits:** 4

## What Was Built

**Task 1 — the two actions, and one whitelist (commit `7ab21fb`).**
`approveDraft` accepts the model's text unchanged and writes `edit_distance = 0`
**explicitly**; a `validator_failed` attempt is refused there with its own
sentence, server-side, because the missing button on the card is a rendering
decision and a Server Action id is POSTable without rendering anything.
`editAndApproveDraft` re-runs `validateDraft` over the operator's bytes with the
whitelist rebuilt from the mirror, and records
`normalizedEditDistance(stored final_body, canonical edit)`.

The load-bearing extraction is `src/core/drafting/merge-facts.ts`. The plan says
to "rebuild the allowed display set from the same merge sources the draft used",
and the honest reading of *same* is one function: a second rendering that emitted
`$2450` where the first emits `$2,450` would not fail loudly — it would refuse
the exact price the draft was written with, on the screen where a human is trying
to fix the message. `draft-touches.ts` now calls the same builder.

**Task 2 — the review card (commit `52669e0`).** One card per
`pending_approval` touch, read through the operator's own session client under
RLS. `final_body` only — never `generated_body`, because a second, un-sendable
version of the message on screen is one somebody will read as *the* message. The
body is monospace on the argument the validator's own header makes: `$2,450` and
`$2,540` look alike at a glance, and a proportional font makes them look more
alike. A failed draft renders the violation list and the edit form and no
approve-unchanged control at all. The edit box pre-fills the whole final body
including the opt-out line, with a live segment count computed by the validator's
own `countSeptets`, so the two-segment refusal is met before the tap rather than
after it.

**Task 3 — the triage decorations (commit `d859a44`).**
`listInboundNeedingTriage` gained the classification arm — soft opt-outs
(`label = 'opt_out'` with `is_stop = false`) and below-high-confidence labels —
and a three-rank `CASE` in the `ORDER BY`. The queue is **capped**, so the
priority has to be part of what the `LIMIT` chooses: a sort applied afterwards
orders only the rows the cap admitted, and a soft opt-out cut off by a night of
dead-letter callbacks would then be "sorted to the top" of a list it is not in.

`SuppressContactForm` is a client component that binds the **existing**
`killContactAction`. It defines no server action, imports nothing from `@/db/`,
and submits one field. The suggestion is presentation; the write is the Phase 3
guarded transaction.

**The fix (commit `ccaa186`).** See deviation 1.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug, in my own Task 1 work] The whitelist was rebuilt at the
APPROVAL's clock, not the draft's**

- **Found during:** the pre-summary audit, working out what this plan owed the
  broken-windows ledger.
- **Issue:** one of the merge facts is *days since the quote*, derived from a
  clock. `editAndApproveDraft` rebuilt the whitelist with `now: new Date()`. A
  draft written on day 14 says "14 days"; approved after midnight the fresh
  whitelist contains `15`, the body's `14` is unlisted, and the validator refuses
  a figure the model was legitimately handed. **No edit fixes it** — the operator
  can see the refusal and cannot see the cause.
- **Why it is not an edge case:** D-14 gives drafts hours of lead time
  deliberately, so a draft written at 6pm and approved at 9am is the *ordinary*
  path. This would have fired on a large fraction of real approvals.
- **Fix:** rebuild at `touch_drafts.created_at`. "The same merge sources the
  draft used" includes the instant it used them at.
- **Verified as a real regression pin:** the new test was run against the
  previous behaviour and **fails**, then passes with the fix.
- **Commit:** `ccaa186`

**2. [Rule 2 — Missing critical] `merge-facts.ts` extracted rather than the
rendering duplicated**

- The plan's file list has no new core module, and the literal reading is to
  rebuild the display strings inside the action. That is a second definition of
  the whitelist, and `draft-touches.ts` says in its own comment why one list
  exists: *"two lists could disagree, and the disagreement would read as the
  model inventing a number it was in fact given."*
- The failure of a duplicated rendering is silent and points the wrong way. It is
  the same shape as 05-02's substring hole: the obvious test passes under both
  implementations.
- Pinned structurally — the actions module is asserted to import `buildMergeFacts`
  and to contain no `toLocaleString(` and no `Intl.DateTimeFormat`.

**3. [Rule 2 — Missing critical] The soft-opt-out one-tap arms before it
confirms**

- The plan says "one-tap suggested action". Implemented as arm-then-confirm.
- The cadence controls already arm this same action because it is irreversible.
  Here it is irreversible **and** it sits in a scrolling list of rows about
  different customers, on a phone — which is the literal wording of this plan's
  own threat T-5-27, *"one-tap suppressing the wrong contact"*. A mis-tap
  permanently blocks somebody who never asked, in a client's name, with no undo
  anywhere in the codebase.
- "One tap" is read as *the suggestion is one tap away*, which it is. D-13's
  requirement is that suppression is **operator-confirmed**; the confirm step is
  that confirmation, not an obstacle to it.

**4. [Rule 3 — Blocking] The single `authorize()` was widened, not duplicated**

- `editAndApproveDraft` needs the client's business name (for the compliance
  suffix an edited body must still end with) and their timezone (the zone the
  quote date was rendered in). Both are columns of the row the gate already
  selects.
- A second helper beside the existing one was the smaller diff and the wrong
  shape: two authorization functions in one `'use server'` module is how the
  sixth action added later gets the weaker one. The four existing call sites moved
  to the new result shape; the module's structural test now asserts that **every**
  exported action opens with `await authorize(` before any `formData.get(`.

**5. [Rule 2] `textarea` added to the `input, select` CSS rule**

- Left out, it renders at the browser default — 13px monospace, no padding, no
  border of ours — and **iOS Safari zooms the viewport on focus** because the
  font is under 16px. This plan's edit box is a phone-first surface by
  requirement; the same repair silently fixes 05-05's voice-profile and template
  boxes, which have the same defect today.

### Judgement calls recorded because they differ from the plan's wording

**6. The classification arm carries no `attribution = 'threaded'` predicate**

The plan says "untriaged **threaded** rows where …". The predicate would be
redundant rather than wrong: `attribution` has four values and the other three
are already in the queue unconditionally, so the only rows this arm can *add* are
threaded ones. Writing it anyway states a restriction the query does not depend
on, and a later reader would reasonably assume removing it changes the result
set. The argument is on the code.

**7. Three hosted-DB ordering tests were added to `tests/inbound-threading.test.ts`**

The plan's Task 3 file list names only the two pure suites, and its acceptance
criteria say the ordering is "pinned by test". Ordering over a **capped** read is
a database property: a sort asserted over a fixture array is a test of the
fixture. `inbound-threading.test.ts` already owns the hosted `inbound_messages`
table, has the teardown machinery, and is **already in this task's own remote
verify command** — so the assertions cost no additional remote budget. The
fixtures are built so arrival order and priority order **disagree**, which is the
trap `seedOrderedPair` in that same file documents.

**8. The one-tap does not mark the row handled**

`triaged_at` answers "how long did this customer wait for a human", and a
suppression is not always the end of the decision — the operator may want to ring
the client first. Two separate taps, deliberately.

---

**Total deviations:** 1 bug fixed (my own), 3 × Rule 2 missing-critical, 1 ×
Rule 3 blocking, 3 judgement calls recorded.
**Impact:** no scope creep. Deviation 1 is a defect this plan would otherwise
have shipped, and it would have fired on the ordinary overnight approval.

## Verification Evidence

| Check | Result |
| --- | --- |
| `npx vitest run tests/quote-draft-approval.test.ts` | **58 passed** (new suite, pure) |
| `npx vitest run tests/inbox-authorization.test.ts` | **34 passed** (20 pre-existing + 14 new) |
| The plan's `<verification>` line 1 (both suites) | **92 passed** |
| Full `npm test` (pure) | **1539 tests passed, ZERO assertion failures** (baseline 1461 + 78) |
| `npm test` failed *files* | 31 — every one the WR-09 remote-refusal gate, verified by counting the distinct error string (31 FAIL lines, 31 "Refusing to run"). **Unchanged from the 05-06 baseline** |
| **`npm run test:remote -- inbound-threading onboarding-gate draft-pipeline`** (serialized, foreground, the wave's only remote user) | **3 files, 33 tests, ALL PASS** |
| Crons after the remote run | re-armed, lease released — confirmed in the run output |
| `npx tsc --noEmit` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| File deletions across the four commits | **0** (`git diff --diff-filter=D`) |
| The deviation-1 fix, run against the PREVIOUS behaviour | **fails** — confirmed a genuine regression pin, not a tautology |

### The must_haves truths, each pinned

| Truth | Where |
| --- | --- |
| Approve or edit-then-approve on the quote page; approval freezes the bytes dispatch sends (D-12) | "writes EXACTLY 0 for an approve-unchanged"; "approves the draft FIRST and the touch only after"; the page's `final_body`-only select |
| Approve-unchanged records 0 explicitly; edit records the normalized distance (AI-04) | "writes the pinned normalized value for a ONE-CHARACTER edit" (1/117, with the fixture length asserted first); "keeps at least four decimal places" |
| An edited body is re-validated — no unwhitelisted price, no missing suffix, no third segment (D-11) | the 12-test re-validation block, including the deleted-opt-out-line and UCS-2 cases |
| A validator_failed draft is unapprovable unchanged, server-side (D-11) | "refuses approveDraft with its OWN distinct message"; "keeps that refusal DISTINCT from every other refusal"; "renders the approve form ONLY on the non-failed branch" |
| A soft opt-out tops triage with a one-tap running the EXISTING killContact (D-13) | the hosted ordering test; "reaches no repository, no schema and no suppression table"; "killContact is called from exactly one place outside its own module" |
| Below-high surfaces as needs-human with the guess shown, nothing acted on (D-15); hot is visible (D-14) | "puts a soft opt-out above an OLDER unmatched row, and a needs-human between them"; "renders labels as GUESSES, never as findings"; "does NOT put is_hot in the queue predicate" |

## Surprises & Findings

**The bug I shipped in Task 1 was found by writing the ledger, not by writing
the tests.** Fifty-seven passing tests covered the re-validation from every angle
I had thought of, and every one of them constructed the draft and approved it in
the same millisecond. The defect only appeared when I sat down to write "what
does this plan leave open" and had to describe, in a sentence, what the whitelist
is rebuilt *from* — at which point "and at what moment" was obviously missing.
Recorded because the ledger step is easy to treat as paperwork after the tests
are green, and here it was the step that found the defect.

**A clock-derived fact needs its clock pinned, not just its value.** The general
shape: any whitelist built from a function of `now` is a whitelist that changes
without anything happening. Two of the three merge facts are stable (price and
date come from mirror columns); the third is a subtraction against the current
time, and it is the one that silently disagreed. The residue is recorded as
window #21 — price and date are still read live, so a mirror re-sync between
drafting and approval can still shift the set. That case at least has an external
cause a human can find, which is why it is a note rather than a second fix.

**"One tap" and "irreversible" do not belong in the same control.** The plan's
wording and the plan's own threat register disagreed with each other — D-13 asks
for a one-tap suggested action, T-5-27 names "one-tap suppressing the wrong
contact" as a high-severity threat with the same button as its subject. The
resolution is that *suggested* is the operative word: the suggestion is one tap
away, and the compliance write is confirmed. Worth recording because the plan
looked internally consistent until both lines were read together.

**A structural test caught a redundancy I was about to write.** Drafting the
`attribution = 'threaded'` predicate for the classification arm, then writing the
"one table, no joins" assertion, made it obvious the predicate could never change
a row's membership. It is out, with the reasoning on the code rather than a
silently absent line.

## Known Stubs

| Stub | File | Reason / resolved by |
| --- | --- | --- |
| The approval gate is **per-quote only** — no deadline-sorted queue across clients, so an operator must open each quote to find drafts waiting | `draft-review.tsx` | **By design and stated in the plan** (D-12: "the full mobile queue is Phase 6"). Building the queue here would mean building it twice. Ledger #19. |
| The soft-opt-out one-tap is offered only when the row carries tenant/cadence/quote ids — an **ambiguous or unmatched** reply classified `opt_out` gets no suggestion | `inbox/page.tsx` | **Correct, not a gap in disguise.** An unattributed reply has no cadence to stop and no client to stop it for; guessing which would be the ambiguity-acting mistake 04-02 refused. It is still in the queue, still labelled, and triaged by hand. Ledger #20. |
| The edit whitelist rebuilds **price and date from the live quote row**, so a mirror re-sync between drafting and approval can refuse a body quoting the price the model was given | `quotes/[quoteId]/actions.ts` | **Narrower than the bug fixed above and with an external cause.** A quote whose total changed since drafting arguably *should* not be approved as written. Recorded rather than fixed because the right answer (regenerate the draft) is Phase 6's queue work. Ledger #21. |
| `is_hot` is displayed and still drives nothing | `inbox/page.tsx` | **D-14, unchanged.** This plan closed the "nothing reads it" half — it is on the screen — but the escalation that acts on it is Phase 6 CON-02. Ledger #16 stays open. |
| No device check of the review card or the triage decorations | — | Coverage C8. Source-asserted only; needs a real phone. Same class as ledger #2 and #4. |

None of these prevent the plan's goal.

**Ledger movements:** #12 (`normalizedEditDistance` has no storage caller) and
#17 (`opt_out` labelled but nothing surfaces it) are marked **fixed** — this plan
is the half both were waiting on. #19, #20 and #21 appended.

## Requirements

**AI-02 marked Complete.** *"Inbound replies classify into a closed enum … via
structured output; low-confidence classifications route to the operator."* The
first clause was settled by 05-06 (closed enum, `output_config.format`, no
`tools` key on the wire, pinned structurally). The second is this plan's: a
below-high-confidence label puts the row in the triage queue by SQL predicate,
ranked above the ordinary attribution rows, rendered with the model's guess and
its confidence and acted on by nothing. Both halves now hold and are asserted.

**AI-04 marked Complete.** *"Every draft records model, template/prompt version,
and human edit distance."* Model, `template_id`, `template_version` and
`prompt_version` have been written from the first attempt since 05-01 and are
required by the insert type rather than optional. `edit_distance` was the missing
column and it is now written on **every** approval — explicitly `0` for
approve-unchanged, which is the data point V2-01 is actually gated on and the one
a NULL would have made indistinguishable from "never approved".

This is the **last** plan claiming either, which is the rule 05-01 established
after reverting a premature completion. All five of the phase's requirements
(ONB-03, AI-01, AI-02, AI-03, AI-04) are now Complete.

## Deferred / Owed

- **Nothing owed from this plan.** Every command in `<verification>` ran,
  including the single serialized `test:remote` — foreground, never overlapping,
  crons paused and re-armed.
- **Device verification of the two console surfaces** — coverage C8, ledger-class
  item. Needs a phone, not a renderer.
- Pre-existing and still open: the undeployed-commit note carried since Phase 4.
  **This is now the sharpest it has been.** Production still runs the Phase 4
  build, where `promoteDue` auto-passes a touch to `approved`. The whole of D-12
  — the gate this plan exists to close — lives in undeployed code. **Deploy the
  phase before arming any real client**, or production and this repository
  disagree about whether a human has to read an AI-written message before a
  customer does.

## Note on `actuals`

`tokens: 30000` is **chars/4 over the realized diff** (118,574 characters of
added lines across the four commits) — the same basis 05-06 stated, so the two
are comparable. Against this plan's `estimate.tokens: 60000` (confidence `low`)
that is a **~2× over-estimate**, consistent with 05-06's ~2.4×. Three plans on
one stated basis is now enough to say the phase's `low`-confidence estimates ran
roughly 2–2.5× high; 05-04's `32000` remains on an unstated basis and should not
be read into that series.

## Threat Flags

None. This plan's four register entries are implemented and asserted:

- **T-5-25** (unauthenticated POST approving a draft) — `authorize` before any
  `formData.get`, proven by an **order trace** rather than by a returned message,
  because an action that parsed first and checked afterwards returns the identical
  denial. Plus the `forTenant` closure, the module-wide "every export opens with
  the gate" scan, and the unique partial index making a replay inert.
- **T-5-26** (human edit bypassing the fact validator) — `editAndApproveDraft`
  re-runs the real `validateDraft` with the rebuilt whitelist; twelve refusal
  cases including the deleted compliance line; the whitelist proven to come from
  the mirror by removing the quote row and watching the same body flip from
  accepted to refused.
- **T-5-27** (one-tap suppressing the wrong contact) — no new write path exists
  in this diff (asserted by a repo-wide `killContact(` caller scan), the ids come
  from the RLS-read row, the form submits exactly one field, and it arms before
  it confirms.
- **T-5-28** (bodies leaking via logs) — no `console.*` at all in
  `draft-review.tsx` and `suppress-contact-form.tsx`; the actions module's log
  statements scanned for body identifiers; a leak test that rejects an approve
  with an error whose message **contains the fixture's draft body** and asserts
  neither the log nor the returned state carries it.

No new security-relevant surface beyond the two actions the threat model already
covers. The one new module (`merge-facts.ts`) is pure — no I/O, no network, no
clock of its own.

## Next Phase Readiness

- **Phase 5 is complete.** All seven plans have summaries; all five requirements
  are marked.
- Phase 6 CON-01 (the deadline-sorted approval queue) reads the same
  `touch_drafts` rows this card does and can reuse both actions unchanged — they
  take ids and a tenant, and know nothing about which page called them.
- Phase 6 CON-02 (hot-lead escalation) reads `is_hot`, which is now written on
  every high-confidence `interested`/`question` reply **and** visible to the
  operator, so the escalation lands beside a flag a human has already been seeing
  rather than one that appears with it.
- The `edit_distance` column begins filling with the first real approval. V2-01
  needs 30 days of it; the clock starts at deploy, not at this commit.

## Self-Check: PASSED

All four created files verified present on disk:
`src/core/drafting/merge-facts.ts`,
`src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx`,
`src/app/(console)/inbox/suppress-contact-form.tsx`,
`tests/quote-draft-approval.test.ts`.

All four commits verified in `git log`: `7ab21fb`, `52669e0`, `d859a44`,
`ccaa186`.

---
*Phase: 05-ai-drafting-classification*
*Completed: 2026-08-31*
