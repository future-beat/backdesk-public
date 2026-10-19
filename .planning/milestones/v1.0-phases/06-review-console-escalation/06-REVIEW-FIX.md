---
phase: 06-review-console-escalation
fixed_at: 2026-09-01T14:45:00Z
review_path: .planning/phases/06-review-console-escalation/06-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 9
skipped: 2
status: partial
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-09-01
**Source review:** `.planning/phases/06-review-console-escalation/06-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 11 (CR-01, WR-01 – WR-10; `fix_scope: critical_warning`)
- Fixed: 9
- Skipped: 2 (WR-02, WR-03 — decided semantics, see below)

## Verification

**Where it ran:** the MAIN CHECKOUT. `workflow.use_worktrees` is `false` in
`.planning/config.json`, so per the documented opt-out no worktree was created
and every edit and commit landed on `main` directly. The numbers below are
reproducible from the tree you are looking at.

**Gates, after every fix and again at the end:**

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 0 warnings (`--max-warnings=0`) |
| `npm test` (pure suite) | 2123 passed, 0 failed |
| `npm run build` | compiled successfully |

**The 35 "failed" test FILES are the pre-existing remote gate, not a regression.**
Baseline before any edit was `35 failed | 57 passed (92 files), 2090 tests
passed`; the 35 refuse to load with *"Refusing to run integration tests against
a non-local Supabase stack"* because they are hosted-DB suites. Final state is
`35 failed | 58 passed (93 files), 2123 tests passed` — same 35 gated files, one
new pure file, +33 tests, zero test failures.

**`npm run test:remote` was NOT run.** The hosted Sydney Supabase is
production-shared and the remote suite pauses deployed crons via a lease; no fix
here changes hosted-DB behaviour that the pure suite cannot cover. `.env*` was
not touched — `STALLED_DIGEST_SECRET` was injected per-command as a dummy hex
value.

**No migration was generated.** 0032 remains the phase's single journal entry.
CR-01 uses the existing `forTenant(id).transaction()` handle, following the
`conversion.ts` / `prospects.ts` precedent.

**Invariants re-checked after the last commit:**
- `touches.approveWhere` is still written in exactly one repository statement and
  still reached from one module (`approve-draft.ts`). CR-01 adds a second call
  site *within that module* — the repair — and `tests/quote-draft-approval.test.ts`'s
  D-12 grep assertion still passes.
- The `approveWhere` / `skipPendingWhere` equality guards are untouched.
- No select-all, no batch arm, no new write path reachable from classification.

## Fixed Issues

### CR-01: The approval write is not atomic, and every recovery path reports a false success

**Files modified:** `src/core/approval/approve-draft.ts`,
`src/app/(console)/components/action-state.ts`,
`src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx`,
`tests/quote-draft-approval.test.ts`
**Commit:** `1020046`
**Status:** fixed — **requires human verification** (see below)

**Applied fix:** Both statements now run inside `repo.transaction()`, which hands
the callback a repository bound to the same tenant and to the transaction. Added
`settleAlreadyApproved()` — one guarded re-run of `touches.approveWhere` — and
routed **all three** paths to `already_approved` through it: `loadApprovableDraft`'s
`latest.status === 'approved'` branch (the earliest reachable one, and the only
one a second tap hits), `writeApproval`'s zero-row branch, and the
`23505` duplicate-index branch. Because `approveWhere` is equality-guarded on
`pending_approval`, the repair is a no-op on an ordinary double-tap and on a
touch skipped/stopped underneath the approval; it moves exactly one row in the
wedged state. A failed repair reports `write_failed` (retryable, idempotent)
rather than a second false success.

Also corrected two comments that now overstate the tear risk: the
`DRAFT_ALREADY_APPROVED_MESSAGE` header (which asserts a claim about the *touch*)
and the quote page's `continue` rationale.

**Tests added (4, all pure, all passing):** both statements run at transaction
depth 1; the zero-row branch repairs; the already-approved-on-re-read branch
repairs without calling `drafts.approve`; a failed repair reports the retryable
error without leaking the draft body. The fake repository now records the
transaction depth of each write, because the atomicity claim is invisible in the
*result* — a torn implementation returns the identical outcome.

**Why this still needs a human look:** the pure suite proves the control flow and
the repair. It does **not** exercise a real Postgres transaction, and
`tests/approval-queue.test.ts` — where the reviewer's suggested end-to-end
regression belongs ("flip a draft to `approved` directly, leave the touch at
`pending_approval`, assert a second `approveUnchanged` moves it") — is one of the
35 remote-gated files and was deliberately not run against the production-shared
DB. Recommend running that single assertion during the next sanctioned
`test:remote` window.

---

### WR-01: The queue renders approve/edit controls for drafts the server will refuse

**Files modified:** `src/core/approval/limits.ts`,
`src/db/repository/for-all-tenants.ts`,
`src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx`
**Commit:** `5575d62`
**Status:** fixed

**Applied fix:** Added `APPROVABLE_DRAFT_STATUSES` (+ `isApprovableDraftStatus`)
to `src/core/approval/limits.ts` — the leaf module that already exists precisely
because a rule needed a home neither consumer's import graph could poison. The
queue accessor now carries the predicate **on the LEFT JOIN condition, not the
WHERE**: a `where` would turn the join into an effective inner one and drop the
`needs_draft` touches CON-04 alerts about, whereas on the join it drops only the
draft, so the row falls through to the existing honest `row.draft === null`
no-draft card. The quote page's two inline string comparisons now call the shared
predicate.

`limits.ts` was the only viable home: the queue reads through drizzle in the
repository layer, and the quote page reads through the operator's own RLS-scoped
Supabase client and must not touch the repository barrel at all.

---

### WR-04: `revalidateQueue` does not revalidate the quote page its own comment promises

**Files modified:** `src/app/(console)/queue/actions.ts`,
`src/app/(console)/queue/queue-card.tsx`
**Commit:** `1f620f2`
**Status:** fixed

**Applied fix:** `quoteId` is now bound onto all three queue actions from the
server-read row, exactly as `tenantId` already was, and `revalidateQueue` takes
it and revalidates `/clients/{tenant}/quotes/{quote}` behind the same
`UUID_PATTERN` check the tenant id gets. The binding carries no authority —
`authorize()` still acts on the tenant id alone. Both surfaces now clear the same
three paths after the same write.

---

### WR-05: `relativeToSlot` can say "overdue" while the badge beside it says "due soon"

**Files modified:** `src/core/aging/stall-policy.ts`,
`src/app/(console)/queue/page.tsx`, `tests/stall-policy.test.ts`
**Commit:** `22c0ef7`
**Status:** fixed

**Applied fix:** Two changes, one arithmetic and one structural.

The arithmetic is the reviewer's: the sign test is now on raw milliseconds —
character for character `deriveUrgency`'s own `slot <= now` — and happens before
any coarsening, and every remaining division floors instead of rounding
(`Math.max(1, minutes)` keeps the minute branch off "due in 0m").

The structural change goes one step further than the finding asked: the function
**moved** out of `queue/page.tsx` and now sits directly beneath `deriveUrgency`
in `stall-policy.ts`. The whole defect was a comment in one file claiming
agreement with a function in another; the module they now share is the one whose
header names "a red badge beside three cards that all read `scheduled`" as the
failure it exists to prevent, and it is testable there (a page module is not).

**Tests added (18, pure):** the agreement property asserted across 14 offsets
spanning the boundary (including the 20-second case that produced the
contradiction), plus the 91-minute round-up, the "never due in 0m" case, and a
zone-free/no-negative-duration check.

---

### WR-06: `job_address` is selected into the client-list payload and never rendered

**Files modified:** `src/app/(console)/clients/[id]/page.tsx`
**Commit:** `cea97e8`
**Status:** fixed

**Applied fix:** Dropped `job_address` and `sm8_job_uuid` from both the select
list and `QuoteRow`. Confirmed by grep that neither is referenced anywhere in the
file — the row renders `generated_job_id`, `job_description`, money and dates.
Removing them from the *type* as well is what keeps them out: a column added back
to the query with no consumer is a compile-time no-op, but a column added to the
type is a claim that something renders it. `job_address` stays on the quote
detail page, which does render it. `tests/pipeline-grouping.test.ts`'s existing
select-list assertions still pass.

---

### WR-07: A claimed stall alert that fails after the claim is reported as zero of everything

**Files modified:** `src/core/cadence/run-tick.ts`,
`tests/stall-claim-isolation.test.ts` (new)
**Commit:** `6b5c620`
**Status:** fixed

**Applied fix:** Split the `try` at the claim. The outer one still covers
`forAllTenants_claimNewlyStalled` itself, where `{0, 0, 0}` is honest — the
guarded UPDATE either returned rows or did not run, and no email is attempted.
Everything after it is a second `try` that reports `touchesNewlyStalled:
claimed.length` and `stallAlertFailed: 1`, the same shape a `{ ok: false }` send
produces, because from the operator's side a throw and a refusal are the same
event.

**Tests added (8, pure, new file `tests/stall-claim-isolation.test.ts`):**
covering a synchronous throw, an async rejection, the no-leak logging rule, the
tick still returning a complete result, the claim-throws case (three zeroes AND
no send attempted), the zero-rows case, and both ordinary arms.

**Proven to catch the regression:** the new suite was run against
`git show HEAD:src/core/cadence/run-tick.ts` (the pre-fix implementation) and
failed 2 of 8 with exactly the reported symptom, then passed 8/8 against the fix.

---

### WR-08: Three write paths have no error handling on surfaces where every neighbour does

**Files modified:** `src/app/(console)/clients/[id]/actions.ts`,
`src/app/(console)/clients/[id]/action-state.ts`,
`src/app/(console)/clients/[id]/page.tsx`
**Commit:** `87b7d83`
**Status:** fixed

**Applied fix:** All three wrapped in the file's established shape — caught value
discarded, dull `console.error` with no parameters, a fixed sentence returned.

- `updateEscalationPhoneAction` → `ESCALATION_PHONE_WRITE_FAILED_MESSAGE`, which
  says "nothing changed" out loud, because this is the one write whose success is
  a hot lead arriving on a particular handset.
- `attestSm8AutomationOffAction` → `ATTEST_WRITE_FAILED_MESSAGE`. The core runs a
  transaction, so a failure leaves no half-written row; it just left the action
  with nothing to say.
- `ClientDetailPage`'s `readOnboardingChecklist` → `checklist` becomes `null` and
  the card renders a `role="alert"` "could not load" section **that keeps the
  `id="ready-to-send"` anchor**, because a gated-cadence refusal on the quote
  page links to it and dropping the element would turn that link into a scroll to
  nowhere. The rest of the page still renders, matching the file's own "half a
  page beats none" rule.

Both new sentences live in `action-state.ts` (a `'use server'` module may export
only async functions).

---

### WR-09: Dead exports on three Phase 6 modules

**Files modified:** `src/app/(console)/components/label-guess.ts` (unchanged
export, three consumers converted), `src/app/(console)/inbox/page.tsx`,
`src/app/(console)/clients/[id]/page.tsx`,
`src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx`,
`src/core/alerts/stalled-drafts.ts`, `src/core/aging/stall-policy.ts`, plus four
test files
**Commit:** `3a721a2`
**Status:** fixed

**Applied fix:** All three, taking the reviewer's preferred option on each.

- **`labelGuess`** — converted rather than deleted, which is what makes the
  module's "one array of words in one file" argument true. All three surfaces
  imported `LABEL_GUESS_LABELS` and re-spelled `?? raw` inline; they now call the
  function that owns that fallback. Updated the four source assertions in
  `inbox-authorization.test.ts` and `pipeline-grouping.test.ts` to pin the
  stronger property: the surfaces import `labelGuess`, and none of them indexes
  `LABEL_GUESS_LABELS[` directly.
- **`sendStalledDraftAlert` / `sendDailyDigest`** — deleted, with a tombstone
  comment explaining that both routes inject `resendStalledEmailSender` and call
  the builders themselves, which is the shape the seam exists to produce.
  Rewrote `stalled-drafts.test.ts`'s "has ONE Resend send" assertion to pin the
  surviving property (one `emails.send`, one exported seam, neither wrapper
  present) and added a check that neither route names them.
- **`selectStalled`** — deleted. It was `touches.filter(isStalled)` under a
  header arguing the digest must not filter on `stall_alerted_at` — a real rule,
  but one already enforced and documented on `forAllTenants_stalledTally`, which
  is a SQL predicate; the digest never has rows in memory to filter. Replaced its
  test block with two source assertions **on the accessor that enforces the
  rule**: the tally mentions no alert-state column, and the claim, by contrast,
  is guarded on exactly that column. `isStalled` is untouched and still widely
  used.

---

### WR-10: `ControlState.fixes` is honoured by one renderer and silently dropped by the other

**Files modified:** `src/app/(console)/components/action-message.tsx` (new),
`src/app/(console)/components/draft-card.tsx`,
`src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx`
**Commit:** `90c6201`
**Status:** fixed

**Applied fix:** Took the reviewer's preferred option — extracted one
`<ActionMessage state={...} />` into `components/action-message.tsx` and deleted
both local `Message` components. It renders `state.fixes` on **both** the error
and the success branch, inside the `role="alert"` / `role="status"` element so a
screen-reader user hears the refusal and the remedy as one message. Both branches,
because `fixes` is declared on the state and not on one arm of it: today only
`resumeCadenceGatedState` populates it and that path reports through `success`,
but a future refusal landing on `error` must not lose its links for having
chosen the other field.

**New file created** (documented here per the fixer's own rule): the shared
renderer needed somewhere to live that both a `(console)/components` client
component and a route-local one can import.

## Skipped Issues

### WR-02: The nav Queue badge and the queue page count different populations

**File:** `src/app/(console)/layout.tsx:49-76`, `src/app/(console)/queue/page.tsx:107-136`
**Reason:** skipped — decided semantics, not a defect with a mechanical fix.

The finding is accurate: the badge counts through `createClient()` under RLS
(`has_tenant_access`, membership only — migration 0016 gives `cadence_touches` no
`is_operator()` arm) while the page counts through the service-role
`forAllTenants_approvalQueue()`. But both remedies the reviewer offers change a
decision the code argues for explicitly and at length:

- Giving the badge service-role authority requires upgrading the layout gate from
  `getClaims()` to `requireOperator()` — directly against the boxed argument in
  `layout.tsx:26-37`, which says a service-role read there "would print a
  cross-tenant number in the chrome of every page, to whoever is logged in", and
  names the v2 client-reports login as the reason the distinction is drawn *now*.
- Scoping the queue read to memberships contradicts
  `forAllTenants_approvalQueue`'s header (D-01: the answer is an ordering over
  every client's touches, and "the operator IS the cross-tenant human").

Picking either would be me overruling a recorded decision. It needs a human
choice, and — as the reviewer says — the chosen answer should be recorded and
then asserted ("the two counts agree for a tenant the operator is not a member
of"). Left for that.

### WR-03: The queue's approve/skip actions refuse the very cards the queue page renders

**File:** `src/app/(console)/queue/actions.ts:83-108` vs `src/app/(console)/queue/page.tsx:94-105`
**Reason:** skipped — same decision as WR-02, seen from the write side; the
reviewer explicitly flags it as "a deliberate decision to make and record, not a
line to delete."

Making `authorize()` accept an operator without a membership row means deciding
whether `cadence_touches` RLS should gain an `is_operator()` arm the way
`inbound_messages` has one (`0025_inbound_messages.sql:73`). That is a migration
plus a security-posture decision, and my instructions rule out generating a
migration that a fix does not genuinely require. Deleting the RLS-scoped `tenants`
read instead would remove the only defence named in that file's own boxed threat
paragraph, on the actions that reach a service-role write.

WR-02 and WR-03 should be resolved together — they are one question asked twice.

---

_Fixed: 2026-09-01_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
