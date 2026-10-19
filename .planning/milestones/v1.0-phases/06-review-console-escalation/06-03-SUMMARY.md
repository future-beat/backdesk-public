---
phase: 06-review-console-escalation
plan: 03
subsystem: console
status: complete
tags: [approval-queue, skip, equality-guard, urgency, race-honesty, mobile, css]

requires:
  - "touches.markPendingApproval — THE equality-guard pattern (Phase 3, D-12)"
  - "STALLABLE_TOUCH_STATUSES / deriveUrgency / URGENCY_LABELS (06-02)"
  - "src/core/approval/approve-draft.ts — the extracted approval core (06-01)"
  - "components/draft-card.tsx + its footer slot, components/action-state.ts (06-01)"
  - "TOUCH_SKIP_REASONS 'operator_skipped' + its console label (06-01, migration 0032)"
  - ".touch-when--stack and the hardened .badge contract (05-08)"
provides:
  - "touches.skipPendingWhere — the operator's own terminal skip, equality-guarded"
  - "touches.statusOf — the two-column re-read the honest zero-row report is chosen from"
  - "skipFromQueue server action + the queue's skip vocabulary (queue/action-state.ts)"
  - "ControlState.settled — a settled row swaps its controls for the outcome sentence"
  - ".button-quiet (both schemes, 44px, works on <a> and <button>) + .skip-confirm"
  - "URGENCY_BADGE_CLASS — the tier→class map, Record-typed so a new tier is a compile error"
  - "MAX_DRAFT_FAILURES exported from the repository barrel"
affects:
  - "DraftCard now hides its approve/edit controls on a settled row — the quote page inherits it"
  - "the quote page's already-approved answer now also removes the button that produced it"
  - "queue cards carry two header badges: urgency (tier) and draft state"

tech-stack:
  added: []
  patterns:
    - "The guard is EQUALITY on the SOURCE statuses — 'not terminal' is the engine's rule, not a human's"
    - "Zero rows is an ANSWER: re-read, then name the specific thing that happened"
    - "Derive on the server from the render's one clock; ship the tier, not the arithmetic"
    - "A control that cannot do anything is removed, not disabled — but the write is guarded regardless"
    - "Reuse a responsive modifier by wearing its class, never by copying its media query"

key-files:
  created: []
  modified:
    - src/db/repository/for-tenant.ts
    - src/db/repository/index.ts
    - src/app/(console)/queue/actions.ts
    - src/app/(console)/queue/action-state.ts
    - src/app/(console)/queue/queue-card.tsx
    - src/app/(console)/queue/page.tsx
    - src/app/(console)/components/action-state.ts
    - src/app/(console)/components/draft-card.tsx
    - src/app/globals.css
    - tests/approval-queue.test.ts
    - tests/lint-ban.test.ts

decisions:
  - "skipPendingWhere writes 'operator_skipped' itself rather than taking a reason parameter — the method then means exactly one thing (a person decided), and no caller can record an engine rule's vocabulary through the human-guarded write"
  - "The guard is `inArray(STALLABLE_TOUCH_STATUSES)` — the SAME array the queue is populated from, so the skip may move exactly what the queue may show and a widened queue cannot come apart from a widened skip"
  - "ControlState gained an OPTIONAL `settled`, not a required one: a forgotten flag leaves a harmless guarded button on screen, where a defaulted `true` would silently remove an approve control from a card that still needs one"
  - "The urgency tier is computed in page.tsx from the render's single `now`, never in the client card — a card rendered at 3:59 and hydrated at 4:01 would otherwise carry a badge the server-side stall alert disagrees with"
  - "A no-draft card at MAX_DRAFT_FAILURES stops saying 'it will keep trying', because at the cap listNeedsDraft has stopped offering the touch and nothing will ever be written for it"
  - "The skip's stale outcome is an ERROR, not a success: the operator asked for something and did not get it, and 'already approved' rendered as a green success sentence is how somebody walks away believing a message is stopped"
  - "The skip copy lives in queue/action-state.ts rather than the shared module, because the skip exists on exactly one surface — a shared module holding one caller's copy teaches the next reader that everything in it is shared"

metrics:
  duration: ~50 min
  completed: 2026-09-01
  tasks: 2
  files: 11
  commits: 2

actuals:
  tokens: 75600
  tasks: 2
  commits: 2
---

# Phase 6 Plan 03: The Complete Queue — Skip, Urgency, Honest Races Summary

CON-01 is whole: the operator can approve, fix or **skip** every pending draft from one
deadline-sorted screen, every card says how late it is, a touch nothing can draft says so
rather than sitting silent, and a card that raced a colleague reports what actually
happened instead of pretending it won.

## What Was Built

**`skipPendingWhere` — the write this plan exists for.** It sits eight lines from
`skipWhere` and differs in one predicate, which is precisely why it is a separate statement
with a header arguing for itself:

```
skipWhere:         notInArray(TERMINAL_TOUCH_STATUSES)   ← the ENGINE's skip
skipPendingWhere:  inArray(STALLABLE_TOUCH_STATUSES)     ← a PERSON's skip
```

`approved` is **not terminal**. So reusing `skipWhere` would have let a queue card rendered
ninety seconds ago skip a touch a colleague approved in between — silently un-approving a
message somebody had already read and cleared, and telling the operator the skip worked.
The guard is therefore equality on the two SOURCE statuses, exactly as `markPendingApproval`
refuses to drag an approved touch backwards and `approveWhere` refuses to approve anything
not pending. Same rationale, one status sideways.

The predicate is not a new array literal: it is `STALLABLE_TOUCH_STATUSES`, which
`APPROVAL_QUEUE_STATUSES` is already an alias of. **The skip may move exactly what the queue
may show**, structurally, so a future widening of one cannot leave the other behind.

The reason is written **inside** the method rather than taken as a parameter. That makes the
method mean one thing — a person decided this particular message would not send — and makes
it impossible for a caller to record an engine rule's vocabulary through the human-guarded
write. Phase 7 reads that difference.

**The honest zero-row report (`statusOf` + `skipFromQueue`).** A zero-row skip is never
reported as a success. The action re-reads the touch through the same tenant scope and names
the specific thing that happened: `This one was already approved. It goes out at its
scheduled time.` / `This one has already gone out.` / `This one was already skipped.` A
status the map has no entry for gets a real sentence (`This one has already moved on. Reload
the queue to see where it is.`), never snake_case — the house rule with a fallback that keeps
the map from becoming a liability the day it is out of date.

`statusOf` returns two columns and nothing else, and returns `null` for another tenant's
touch — the same answer as "does not exist", so the refusal is not an existence oracle over
somebody else's schedule.

**The two-step quiet skip.** `Skip this message` reveals `Touch #{n} will never send. The
rest of the cadence carries on.` with `Skip it` / `Keep it`. Not `Confirm` / `Cancel`: those
describe what happens to the confirm row, and the operator's question is what happens to the
message. The sentence says **both halves**, because an operator who reads "skip" as "stop"
reaches for the kill switch next time.

`.button-quiet` spends neither reserved token — not `--accent` (which the base `button` rule
fills and which means "the thing to tap"), and **not `--error`**, because the armed kill on
the quote page is deliberately the console's only red control. Every value is a custom
property, so both schemes come free; a test asserts the rule contains no hex literal.

**`ControlState.settled`, and what it removes.** When a row leaves the operator's hands —
approved here, approved by somebody else while the card sat on screen, or skipped — the card
drops its approve and edit controls and leaves the outcome sentence. The absence is a
courtesy (every one of those writes is guarded server-side); what it buys is that the
operator is never offered a tap whose only possible answer is the sentence already on screen.
The queue owns the skip's `useActionState` rather than the control, because its outcome
decides something **above** the control.

**Urgency, from the one derivation.** `deriveUrgency` is called in `page.tsx`, from the
render's single `now`, and the tier is passed down. Computing it in the client card would
have used the browser's clock at hydration: a card rendered at 3:59 and hydrated at 4:01
would carry a badge the server-side stall alert disagrees with, which is exactly the
"four answers to one question" failure `stall-policy.ts` was written to prevent. The
tier→class map is `Record<UrgencyTier, string>`, so a tier added later is a compile error
rather than a neutral pill somebody notices in three weeks.

**The no-draft-yet card, finished.** `.badge--warn no draft yet`, the failure count in
digits, and controls that are the skip plus `Open the quote` — no approve, no edit, mirroring
a server refusal now asserted directly against real rows (`approveUnchanged` on a touch with
no attempts answers `not_found`).

**Phone polish.** The client name and its urgency badge are one `.touch-when--stack` unit,
reused verbatim from 05-08 — below 22.5rem they take a full row and the badge relaxes
`nowrap` so a long pill wraps inside an intact border. `.button-quiet` works on an `<a>` as
well as a `<button>`, so `Open the quote` is a 44px target rather than an inline link in a
column of buttons. All three actions carry pending labels (`Approving…` / `Skipping…`).

## Key Implementation Decisions

**`settled` is optional, and the direction of that default is the decision.** A forgotten
flag leaves a harmless button on screen — every write behind it is guarded. A defaulted
`true` would silently remove the approve control from a card that still needs one. The
conservative default is the one whose failure mode is visible and harmless.

**A stale skip is an ERROR, not a success.** `already_approved` on the *approve* path is a
success and deliberately so (nothing went wrong; a third tap must not be invited). The skip's
mirror image is not: the operator asked for a message to be stopped and it was not stopped.
Rendering "This one was already approved." in the success register is how somebody walks away
believing a message is dead while it sits approved and scheduled.

**At `MAX_DRAFT_FAILURES`, "it will keep trying" is a lie.** `listNeedsDraft` stops offering
a touch at the cap, so past it nothing will ever be written and the card is no longer
reporting a delay — it is asking for a decision. The UI-SPEC's copy row states the
still-trying sentence unconditionally; shipping it unconditionally would have left a touch
unsent for six weeks behind a reassuring line. See Deviations.

**The skip copy lives in the queue's own `action-state.ts`.** 06-01's module header says
"nothing new is defined here", and that rule is about the APPROVAL copy: two surfaces
approving one draft must not answer a double-tap with different words. The skip exists on one
surface — the quote page's terminal control is the armed kill over a whole cadence, and the
queue never duplicates it (D-02). A shared module holding one caller's copy teaches the next
reader that everything in it is shared. The header now says which half is which, and when to
promote.

## Deviations from Plan

### Deliberate additions beyond the plan's file list

**1. [Rule 2 — Missing critical functionality] `touches.statusOf`**

The plan says the zero-row branch "re-reads the touch and reports honestly". No read existed
that could: `for-tenant.ts` had no by-id touch accessor at all. Two columns, tenant-scoped,
`null` for a stranger's id so the honest report cannot become an existence oracle.

**2. [Rule 2] `ControlState.settled` and `DraftCard`'s `settled` prop**

The plan's Task 2 item 5 asks that a stale card "swaps its controls for the outcome sentence
instead of pretending success". That needed a channel from an outcome to the card's controls,
and the queue's skip is an action the shared card knows nothing about. `settled` is that
channel, and it is shared rather than queue-local because the quote page has the same stale
case: `already_approved` there now also removes the button that produced it.

**3. [Rule 2] `draftingGaveUp` — the honest half of the no-draft card**

The UI-SPEC's copy row for this card ends `It will keep trying; you can skip it or open the
quote.` At `MAX_DRAFT_FAILURES` that sentence is **false**: `listNeedsDraft` has stopped
offering the touch and nothing will retry it. The card now branches, and at the cap says so
and names the remedy (`It has stopped trying, so nothing will be written for it. Skip it, or
open the quote and fix what the drafting refused.`). This is a deliberate departure from a
UI-SPEC copy row, made on the project's own honesty rule — a sentence that is true for the
first four attempts and false for the state that actually needs a human is the worst place to
be reassuring.

**4. [Rule 2] `.controls .button-quiet` width and the anchor treatment**

The plan's phone-polish item says "every tappable control >= 44px". `Open the quote` on the
no-draft card is an `<a>`, and `.controls button { width: 100% }` does not reach it. Making
`.button-quiet` an `inline-flex` with its own padding and radius makes the class wearable by
either element, which is what lets the acceptance criterion be true of the whole column
rather than of the buttons in it.

### Not needed — already true

- **Task 1 item (4), the `operator_skipped` label map.** 06-01 shipped it one plan ahead of
  its writer, deliberately. Verified present in `SKIP_REASON_LABELS` and left alone.
- **Task 2 item (3), edit-then-approve wiring.** The queue already routed through the shared
  `DraftCard` and `editThenApprove` from 06-01. What this plan added is the **proof**: a
  parity test and the source assertions.
- **Task 2 item (2), failed-draft presentation.** Byte-verbatim parity with `DraftReview` is
  structural, not copied — both render `components/draft-card.tsx`. Asserted as an absence:
  neither surface file contains the badge text or the alert sentence.

### Pinned-list edits the project requires

- `tests/lint-ban.test.ts` barrel pin gains `MAX_DRAFT_FAILURES` (the queue's no-draft card
  needs the ceiling, not just the count).
- The same file's `CLIENT_REACHABLE` list gains `queue/action-state.ts` and
  `queue-card.tsx` — the same `'use client'` + sibling-constants shape that broke the build
  in 06-02, one directory over, and the skip's vocabulary is one `import` away from the
  repository barrel.

## Verification

| Gate | Result |
|------|--------|
| `npm run test:remote -- tests/approval-queue.test.ts` | **37/37 passed** (16 at plan start; hosted Sydney DB, cron ticks leased-paused) |
| `npx vitest run tests/quote-draft-approval.test.ts` | **77/77 passed** — the `settled` change touched the shared mapping |
| `npx vitest run tests/lint-ban.test.ts` | **18/18 passed** |
| `npm test` | **2010 passed** (2008 at plan start); 34 files remote-gated as designed |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run build` | green; `/queue` in the route manifest |
| Migration | **none generated** — 0032 remains the phase's single journal entry, per 06-01 |

### The named Pitfall 3 test, and what it proves

```
it('CANNOT skip an APPROVED touch — zero rows, nothing changed')
  → approveUnchanged(...)                    → { kind: 'approved', edited: false }
  → touches.skipPendingWhere([touchId])      → []
  → row                                       → { status: 'approved', skip_reason: null }
```

Run against real rows in the hosted database, with sibling assertions that a `sent` touch is
equally immovable, that an engine-written `skip_reason` is never overwritten, and that a
cadence's later touches keep both their status and their slots — a skip is not a stop, and
there is no defer.

### Test-environment note

Every command above was run with `STALLED_DIGEST_SECRET` injected into the command
environment. It is a REQUIRED member of `serverEnvSchema` (06-02) and is still absent from
`.env.local`, which this executor is permission-blocked from writing. **06-02's operator
obligation 1 remains outstanding and blocks a bare `npm test`.**

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-6-09 Tampering — a stale card skipping an approved touch | `skipPendingWhere`'s equality guard on the two unapproved statuses, proven at the database (zero rows, row unchanged) and pinned structurally: the method's source must contain `STALLABLE_TOUCH_STATUSES` and must NOT contain `TERMINAL_TOUCH_STATUSES` or take a reason parameter. Zero rows re-reads and reports the specific truth. |
| T-6-10 Elevation — forged skip POST | WR-01 order: `authorize(tenantId)` — `requireOperator()` **and** an RLS-scoped `tenants` read with the caller's own JWT — before a byte of `formData`; one `z.uuid()`; the write scoped to `forTenant(the authorized tenant)`, so another client's touch id matches nothing (asserted, along with `statusOf` returning `null` for it). |
| T-6-11 Tampering — batch approval smuggled via array inputs | `skipTouchSchema` is a single-object, single-uuid schema with no array arm, matching `draftIdsSchema`. Nothing in the queue action layer could consume a multi-id form. |

## Prohibitions Honoured

- **No batch or bulk affordance.** No select-all, no approve-all, no per-client group commit,
  no multi-id form input. Every queue action parses exactly one uuid per field.
- **The skip cannot move an approved or sent touch.** Equality-guarded, never
  merely-not-terminal; the named remote test is the proof and the source assertion is the
  guard against it being quietly widened later.
- **No kill switch on the queue, and no `--error` on the skip.** `.button-quiet` is asserted
  to contain no `--error` and no hex literal. The armed kill on the quote page remains the
  console's only red control.
- **Draft bodies are never truncated in any card state.** `.draft-body` is a `<pre>` in the
  shared card and this plan did not touch it; the only `.cell-truncate` on a queue card is
  the job description, which is not the thing being approved.
- **No migration, no packages installed.** `git diff` touches no file under
  `src/db/migrations/` and no manifest.

## Known Stubs

None.

## Requirement Status

**CON-01 is complete and is marked here.** This is the LAST plan claiming it — 06-01
deliberately left it unticked because CON-01's wording is "approve, edit-then-approve, **or
skip** each pending draft" and the skip control was this plan's. All three now work from the
deadline-sorted queue, the full-review invariant is physical (the whole frozen body is on
screen before every approve tap), drafting failures are loud, and every race is reported
honestly.

CON-04 is also in this plan's frontmatter and was marked complete by **06-02**, which is the
plan that built it; this plan only consumes its `deriveUrgency`.

## UAT obligation (not unbuilt work)

Task 2's `<human-check>` is an end-of-phase validation step and needs a phone, which is not
something this executor has:

> On a 390px phone viewport, work a seeded queue of 20+ cards — approve one,
> edit-then-approve one, skip one; confirm no horizontal scroll, 44px targets, and the honest
> already-approved message on a stale card.

Every mechanism it checks is asserted here (the 44px rules, the stacking modifier, the
absence of truncation, the honest sentences and their `settled` behaviour); what a handset
adds is the judgement about whether the column reads well under a thumb.

## Notes for Next Plans

- **Do not widen `skipWhere` and delete `skipPendingWhere`.** They differ in one predicate
  and the difference is a safety property. A source assertion will fail first, and it says
  why.
- `ControlState.settled` is now the console's "this row is finished" channel. Any new console
  action whose outcome ends a row's life should set it rather than leaving a dead button.
- The urgency tier is computed **server-side** in `page.tsx`. A future surface that wants the
  badge should pass the tier down the same way, not import `deriveUrgency` into a client
  component.
- `MAX_DRAFT_FAILURES` is now barrel-exported. Anything that renders a `needs_draft` touch
  should tell "still trying" apart from "given up" — they need different words and a
  different next action.

## Self-Check: PASSED

Files asserted present:

```
FOUND: src/db/repository/for-tenant.ts
FOUND: src/app/(console)/queue/actions.ts
FOUND: src/app/(console)/queue/action-state.ts
FOUND: src/app/(console)/queue/queue-card.tsx
FOUND: src/app/(console)/queue/page.tsx
FOUND: src/app/globals.css
FOUND: tests/approval-queue.test.ts
```

Commits asserted present: `f72a2a9`, `88ddb60`.
