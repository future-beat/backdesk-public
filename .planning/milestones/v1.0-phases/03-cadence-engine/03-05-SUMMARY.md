---
phase: 03-cadence-engine
plan: 05
subsystem: cadence-engine
tags: [cadence, controls, suppression, kill-switch, pause, resume, console, server-actions, rls, compliance]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: the (console) auth-gated shell, the RLS-scoped read convention, tenants.timezone and the validated-IANA-zone rule
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: the WR-01 authorize-first server-action pattern in clients/[id]/actions.ts, the client detail page and its quote table, the framework-free-core header convention
  - phase: 03-cadence-engine
    provides: "03-01's cadence tables and guarded repository namespaces; 03-02's cadence creation gate (suppression checked at creation, D-15); 03-03's cadenceTransition matrix; 03-04's applyResumeRewindow (the one D-07 rule) and settings.setPausedAt"
provides:
  - "controls.ts — killContact, pauseClient, resumeClient, resumeCadence, pauseForReply as framework-free, transaction-safe operations with closed result unions"
  - "The first production writer of suppressed_contacts; Phase 4's STOP regex becomes a second writer to the same table"
  - "applyResumeRewindow gains onlyCadenceIds, so a resume repairs the cadences its own pause froze and not the ones created during it"
  - "cadences.getById and cadences.operatorResumeWherePaused — the D-05 reason-agnostic resume no WHERE pause_reason clause can express"
  - "/clients/[id]/quotes/[quoteId] — the per-quote control surface: cadence state, upcoming touches in the tenant's clock, send history"
  - "Four WR-01 authorize-first server actions and the arm-then-confirm kill component"
  - "pauseForReply, exported and tested before Phase 4 exists, including the pause-upgrade it cannot perform"
affects: [04-messaging, 05-drafting, 06-approval-console, 07-reporting]

actuals:
  tokens: 25956
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A control surface as ONE framework-free module the console and later phases share, rather than a server action's inline transaction — the second expression of 'stop chasing this person' is the one that gets a condition wrong"
    - "Splitting the irreversible half of an operation from the guarded half, so a kill on an already-terminal cadence still writes the suppression that reaches the customer's NEXT quote"
    - "Scoping a repair to the rows the write actually returned, rather than to everything currently eligible"
    - "Naming a prescribed-but-unwritable transition as its own result kind instead of folding it into the no-op beside it"
    - "Arm-then-confirm on a control that did not exist a moment earlier, in preference to a confirm() dialog the thumb is already over"
    - "One fixed failure sentence across malformed id, expired session, foreign tenant and absent cadence, so the response is not a membership oracle"

key-files:
  created:
    - src/core/cadence/controls.ts
    - tests/cadence-controls.test.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
    - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx
  modified:
    - src/core/cadence/resume.ts
    - src/db/repository/for-tenant.ts
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/globals.css
    - tests/cadence-resume.test.ts

key-decisions:
  - "The suppression write is UNCONDITIONAL and only the cadence stop is guarded: a kill on a cadence that stopped as 'won' an hour ago still records 'never chase this human again', because refusing it would honour none of the sentence the tradie just said and the first anyone would learn of that is the same customer being chased on their next quote"
  - "Suppression addresses are written VERBATIM from the cadence snapshot and are deliberately NOT re-normalized: those exact strings are what dispatch and the creation gate probe the list with, so re-normalizing could only ever produce a spelling no probe asks about — a suppression that does not suppress"
  - "A cadence with neither mobile nor email returns no_addresses and writes nothing, rather than stopping under 'contact_suppressed': there is no address on the row, so the reason column Phase 7 reads would carry a statement no rule made"
  - "applyResumeRewindow takes an explicit cadence scope, and both console resumes pass the ids their resume write RETURNED — event consumption keeps running for paused tenants, so a client may have gained new cadences during the pause whose slots are already correct, and re-windowing those would text a customer days early"
  - "operatorResumeWherePaused is guarded on status alone, with no pause_reason predicate, because D-05's operator resume must also reach a paused row whose reason is null — a case no reason-matched WHERE clause can express"
  - "The two resumes are the sensitive actions, not the kill: an unauthorized kill STOPS messages, an unauthorized resume STARTS them at a stranger's customers in a tradie's name"
  - "pauseForReply reports upgrade_unsupported as its own kind rather than not_active, because 'nothing should happen' and 'something should have happened and did not' have different consequences — and the consequence here is that a client's own resume can revive a live conversation"
  - "The kill's second tap is on a control that did not exist before the first, not on window.confirm: a confirm dialog puts its buttons wherever the phone puts them, which is often exactly where the thumb already is"
  - "The two actions with no input declare no formData parameter at all — a declared-and-ignored formData reads as a body the action might one day parse, and WR-01 is precisely that nothing in a body is worth parsing before the gate"
  - "Contact addresses are masked on the quote page: the kill decision needs the name and the shape of the number, not the digits, and the digits add a customer's mobile to the server-rendered payload, the router cache and every screenshot"

patterns-established:
  - "Resolving every state change from cadenceTransition at module load in a new caller, so a matrix that stopped prescribing one fails at import rather than inside a live transaction"
  - "A test suite that seeds its count-sensitive fixtures inside the blocks that need them, because a stray active cadence in the tenant would be swept up by the client-wide pause the neighbouring block asserts"
  - "Driving the real production creation path to prove a control reached a row that did not exist when the control was used"

requirements-completed: [CAD-03]

coverage:
  - id: D1
    description: "A per-contact kill is terminal and cross-channel: it writes BOTH the snapshotted mobile and email to suppressed_contacts, stops the cadence with reason contact_suppressed, and retires its unsent touches as `suppressed` in the same transaction (D-06, D-15)"
    requirement: "CAD-03"
    verification:
      - kind: integration
        ref: "tests/cadence-controls.test.ts#suppresses BOTH channels of one human and stops the cadence terminally"
        status: pass
      - kind: integration
        ref: "tests/cadence-controls.test.ts#is idempotent: a second kill writes no duplicate row and re-stops nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "The kill reaches quotes that did not exist when it was used: a brand new quote for the same human, arriving through the real markChaseEligible → consumeQuoteEvents path with a fresh quote_contacts row and an un-normalized number, produces a cadence born stopped with zero touches (D-15)"
    requirement: "CAD-03"
    verification:
      - kind: integration
        ref: "tests/cadence-controls.test.ts#blocks a BRAND NEW quote for the same human at cadence creation (D-15)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The per-client kill is a reversible pause: cadence_settings.paused_at is set and every ACTIVE cadence pauses with reason client_paused, in one transaction, and a second pause moves neither the flag nor a cadence (D-06)"
    requirement: "CAD-03"
    verification:
      - kind: integration
        ref: "tests/cadence-controls.test.ts#pauses every ACTIVE cadence and sets the client flag, in one transaction"
        status: pass
      - kind: integration
        ref: "tests/cadence-controls.test.ts#is idempotent: a second pause moves neither the flag nor a cadence"
        status: pass
    human_judgment: false
  - id: D4
    description: "A reply-paused cadence survives a client-level resume, and its touches are not re-windowed either: only client_paused cadences reactivate, and they do so through the one D-07 rule, landing at future in-window slots (D-05, D-06, D-07)"
    requirement: "CAD-03"
    verification:
      - kind: integration
        ref: "tests/cadence-controls.test.ts#resumes ONLY client-paused cadences and re-windows exactly those (D-05, D-07)"
        status: pass
      - kind: integration
        ref: "tests/cadence-controls.test.ts#reports not_paused when the client is not paused"
        status: pass
    human_judgment: false
  - id: D5
    description: "Only an explicit operator action lifts a customer_reply pause, and it re-windows the resumed cadence alone; a cadence that is not paused, and a terminal one, are refused (D-05)"
    requirement: "CAD-03"
    verification:
      - kind: integration
        ref: "tests/cadence-controls.test.ts#lifts a customer_reply pause, which nothing else in this file could"
        status: pass
      - kind: integration
        ref: "tests/cadence-controls.test.ts#refuses to resume a cadence that is not paused"
        status: pass
    human_judgment: false
  - id: D6
    description: "pauseForReply is exported and proven before Phase 4 exists: it pauses an active cadence with reason customer_reply, no-ops on a repeat and on a terminal cadence, and NAMES the client_paused → customer_reply upgrade it cannot perform rather than reporting a silent no-op"
    requirement: "CAD-03"
    verification:
      - kind: integration
        ref: "tests/cadence-controls.test.ts#pauses an active cadence for a customer reply, and a repeat changes nothing"
        status: pass
      - kind: integration
        ref: "tests/cadence-controls.test.ts#names the pause UPGRADE it cannot perform rather than reporting a no-op"
        status: pass
      - kind: integration
        ref: "tests/cadence-controls.test.ts#refuses a reply pause on a terminal cadence"
        status: pass
    human_judgment: false
  - id: D7
    description: "No code path anywhere removes or mutates a suppressed_contacts row: no un-suppress function, no repository mutator, no grant (D-06, prohibition)"
    requirement: "CAD-03"
    verification:
      - kind: other
        ref: "grep -c 'delete' src/core/cadence/controls.ts → 0; the suppression namespace exposes insertMany/existsFor/listAll and no mutator; migration 0017 grants authenticated SELECT and nothing else"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts — the exact-grants map, still green (unchanged by this plan)"
        status: pass
    human_judgment: true
    rationale: "A grep and a grants assertion prove no path exists TODAY. That none is ever added is a standing property enforced by three layers of prose and one grant, and only a reviewer can confirm a future change has not quietly opened one — which is why the prohibition stays judgment-verified"
  - id: D8
    description: "The operator can see cadence state, pause/stop reasons in plain language, upcoming touch times and send history per quote, from a route reachable from the client's quote list, with every instant rendered in the TENANT's timezone (D-16)"
    requirement: "CAD-03"
    verification:
      - kind: other
        ref: "npm run build → route manifest contains /clients/[id]/quotes/[quoteId]"
        status: pass
      - kind: other
        ref: "grep 'tenant.timezone' page.tsx → 6 call sites; grep 'Australia/' → 0 (no hardcoded zone, no browser default)"
        status: pass
      - kind: other
        ref: "grep 'quotes/' clients/[id]/page.tsx → the job-number cell links to the new route; the Follow-up glance column is one cadences read keyed by the visible quote ids"
        status: pass
    human_judgment: true
    rationale: "The route, the formatter's input and the link are asserted mechanically. That the page READS well — whether the state line answers 'is this still going out' at a glance, and whether the schedule is scannable — is layout judgment, and it is the end-of-phase phone check the validation map already reserves"
  - id: D9
    description: "Every control action authorizes FIRST with the operator's own JWT and an RLS-scoped tenant-membership read, before any formData is read; ids are zod-uuid validated and every failure returns one fixed sentence (WR-01, T-3-18, T-3-19)"
    requirement: "CAD-03"
    verification:
      - kind: other
        ref: "Source ordering in actions.ts: `const denied = await authorize(tenantId)` at lines 154/197/227/265 precedes the only formData reader (readCadenceId, lines 157/268); the single `formData.get` in the file is inside that helper"
        status: pass
      - kind: other
        ref: "grep 'z.uuid()' actions.ts → cadenceIdSchema; grep -c revalidatePath → 3"
        status: pass
      - kind: other
        ref: "A cross-tenant quoteId renders notFound(): the page's reads run as `authenticated`, so has_tenant_access decides and both absence and denial return zero rows"
        status: pass
    human_judgment: false
  - id: D10
    description: "Kill, pause and resume are reachable and usable one-handed on a phone, and the kill requires two distinct interactions (D-16, T-3-22)"
    requirement: "CAD-03"
    verification:
      - kind: other
        ref: "cadence-controls.tsx — the armed useState gates killContactAction behind a second tap on a control that does not render until the first; full-width 44px buttons via .controls in globals.css"
        status: pass
    human_judgment: true
    rationale: "That two taps are required is a source fact and is asserted. That the result is comfortable one-handed on a 390px screen — tap-target placement, thumb reach, whether Cancel is where a panicking operator expects it — is ergonomics, and no automated check substitutes for holding the phone"
  - id: D11
    description: "The whole repository is green: typecheck, lint at --max-warnings=0, a production build, and the full remote suite"
    verification:
      - kind: other
        ref: "npm run typecheck; npm run lint; npm run build"
        status: pass
      - kind: integration
        ref: "npm run test:remote → 46 files, 1018 tests, all pass"
        status: pass
    human_judgment: false

# Metrics
duration: 27 min
completed: 2026-08-27
status: complete
---

# Phase 3 Plan 05: Operator Kill Switches and the Quote Control Surface Summary

**The moment a human says stop, the system stops: a per-contact kill that writes both channels of one person to the suppression list and reaches quotes that do not exist yet, a per-client pause that resumes through the single D-07 rule without reviving a live conversation, and a phone-first quote page that shows exactly what each cadence will do next in the client's own clock — all behind authorize-first actions over one framework-free control module.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-08-27T14:06:00Z
- **Completed:** 2026-08-27T14:33:30Z
- **Tasks:** 3
- **Files modified:** 11 (6 created, 5 modified)

## Accomplishments

- **The kill now reaches the quote that does not exist yet, and that is proven through the production path rather than asserted.** Stopping the cadence in front of the operator is the easy half and it looks identical to success when the hard half is missing; the failure surfaces weeks later as the same customer being chased on their next job — which is the complaint, again, from the person who already made it. So the suite seeds a brand new quote with its own fresh `quote_contacts` row, spelling the number the way ServiceM8 actually does (`0400 555 555`), runs `markChaseEligible` and `consumeQuoteEvents` for real, and asserts the cadence is born stopped with zero touches. That works only because `suppressed_contacts` is keyed on the normalized ADDRESS, which is the entire reason the table exists instead of a flag on `quote_contacts`.

- **The suppression write was separated from the cadence stop, and the split is the design.** "And don't ever contact them again" is most often said about a job that was just won — a cadence that stopped an hour ago. Guarding the suppression on there being a live cadence to stop would honour none of that sentence. So the suppression is unconditional and only the transition is guarded; `already_stopped` reports exactly that split, and its copy says the contact is suppressed either way rather than the "nothing changed" a naive reading would produce.

- **A resume no longer repairs schedules that were never broken.** `applyResumeRewindow` took a tenant and moved every active cadence, which is right for auth recovery — a dead key froze everything at once. It is wrong for a client resume, because event consumption deliberately keeps running for paused tenants, so a client may have gained brand-new cadences during the pause whose slots are already correct and in the future. Re-windowing those drags touch one forward to the resume moment and texts a customer days early. Both console resumes now pass the ids their resume write RETURNED, which is precisely the set the pause is responsible for.

- **D-05 is asserted from the side that can break it.** The client-level resume test does not merely check that two cadences came back; it checks that the reply-paused one did not, AND that its touches sit on exactly the instants they were seeded with. A test that only looked at the resumed set would pass just as happily if the resume lifted everything, and the bug it would miss is a machine walking back into a live conversation.

- **The Phase 4 pause-upgrade gap is now a named result kind instead of a paragraph in a summary.** `cadenceTransition` prescribes `paused(client_paused)` + `customer_reply` → `paused(customer_reply)`, and no repository method can write it. `pauseForReply` could have folded that into `not_active` and been quietly wrong: `not_active` means nothing should happen, whereas this means something should have happened and did not — and the consequence is that the client's own resume can restart messaging at somebody mid-conversation. It returns `upgrade_unsupported` with the row's state, and a test asserts it.

- **The kill switch is two taps on a phone, and neither of them is a browser dialog.** `window.confirm` is the obvious answer and puts its buttons wherever the phone puts them — frequently under the thumb that just armed the action. The arm step instead renders a control that did not exist a moment earlier, so the same gesture cannot reach it, and uses the intervening space to say the one thing a confirm dialog has no room for: this blocks the contact on every future quote and there is no undo.

## Task Commits

1. **Task 1: framework-free control operations + real-DB suite** — `b274762` (feat)
2. **Task 2: quote detail route, timezone-correct schedule, client-page link and glance column** — `689c0ec` (feat)
3. **Task 3: WR-01 authorize-first actions and the arm-then-confirm control form** — `add40c0` (feat)

## Files Created/Modified

### Core (`src/core/cadence/`)

- `controls.ts` (new, 466 lines) — the five operations, every state change resolved from `cadenceTransition` at module load, every write inside `forTenant().transaction`, closed result unions throughout
- `resume.ts` — `ApplyResumeRewindowOptions` with `jitterMinutes` and `onlyCadenceIds`; the scope check is one `continue` and the argument for it is in the option's own doc comment

### Repository

- `src/db/repository/for-tenant.ts` — `cadences.getById` (the read a forged POST hits; `[]` for absent and for foreign, indistinguishably) and `cadences.operatorResumeWherePaused` (guarded on status alone, deliberately reason-agnostic)

### Console

- `clients/[id]/quotes/[quoteId]/page.tsx` (new, 400 lines) — RLS-scoped reads only; cadence state, masked contact, schedule and send history; every instant through `formatInTenantZone(value, tenant.timezone)` with the zone named once beside the schedule
- `clients/[id]/quotes/[quoteId]/actions.ts` (new, 290 lines) — four actions, each opening with the WR-01 gate before any body is read
- `clients/[id]/quotes/[quoteId]/action-state.ts` (new) — the shared state shape and every user-facing sentence as a constant
- `clients/[id]/quotes/[quoteId]/cadence-controls.tsx` (new) — arm-then-confirm kill, pause/resume as one button in two states, rendered on cadence state
- `clients/[id]/page.tsx` — the job number links to the detail route; a Follow-up glance column from ONE cadences read keyed by the visible quote ids
- `src/app/globals.css` — `.touch-list` (a list rather than a table, so the status badge is not the fact that scrolls off a 390px screen), `.controls`, `.zone-note`

### Tests

- `tests/cadence-controls.test.ts` (new, 526 lines) — 14 cases against the hosted Sydney database
- `tests/cadence-resume.test.ts` — three call sites updated for the options object

## Decisions Made

Recorded in `key-decisions` above. The three worth reading in full:

1. **The suppression is written even when the cadence is already terminal.** See Accomplishments. The alternative fails in the one direction this table exists to prevent, and it fails silently.

2. **The addresses are written verbatim and are NOT re-normalized.** The plan's `read_first` names `normalizeAuMobile`/`normalizeEmail`, and the correct use of having read them was to decide against applying them here. `cadences.contact_mobile` is already the normalized snapshot `selectPrimaryContact` produced, and it is the exact string `dispatch.ts` and the creation gate probe the list with. Running it through the normalizer again can only produce the same string or a different one, and a different one is a suppression stored under a spelling nothing ever asks about. Normalization belongs where the raw upstream value arrives, which is where it already happens.

3. **The two actions with no input declare no `formData` parameter.** ESLint's `after-used` rule surfaced it, but the fix is not a rename: `pauseClientAction` and `resumeClientAction` genuinely have no body to parse — the client is the argument the caller bound and the gate authorized. A declared-and-ignored `formData` reads as a body the action might one day read, and WR-01's whole content is that there is nothing in a body worth reading before the gate. `useActionState` supplies the two arguments regardless and JavaScript discards them; the two actions that DO have a cadence id to read declare both parameters normally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The operator resume had no repository write that could perform it**

- **Found during:** Task 1
- **Issue:** `resumeCadence` must lift a pause "either pause reason — the operator IS the explicit act D-05 requires". The only resume write was `resumeWherePaused(ids, expectedReason)`, whose `WHERE pause_reason = $2` predicate is the D-05 asymmetry and must stay. Reading the reason first and passing it back would put the asymmetry in a second place, and it cannot express the third case at all: `transitions.ts` note 6 describes a `paused` row with a NULL reason that only an operator may resume, and no equality predicate matches null.
- **Fix:** `cadences.operatorResumeWherePaused(cadenceIds)` — guarded on `status = 'paused'` and nothing else, with the D-05 argument stated at the definition and a pointer to its reason-matched sibling.
- **Files modified:** `src/db/repository/for-tenant.ts`
- **Verification:** `tests/cadence-controls.test.ts#lifts a customer_reply pause, which nothing else in this file could`; the not-paused and terminal refusals asserted alongside it
- **Committed in:** `b274762`

**2. [Rule 2 - Missing Critical] A tenant-wide re-window would have moved cadences the pause never froze**

- **Found during:** Task 1
- **Issue:** The plan asks for "a cadence-scoped variant or parameter on `applyResumeRewindow`" for the single-cadence resume. Working through it showed the CLIENT resume needs the same thing and for a sharper reason: 03-01 decided that event consumption runs for paused tenants by design, so cadences are created during a client pause, materialized from a fresh anchor with correct future slots. A tenant-wide re-window on resume would place their first touch at the resume moment — a customer texted days before the schedule said to, by the code whose purpose is to stop exactly that.
- **Fix:** `ApplyResumeRewindowOptions.onlyCadenceIds`. Omitted keeps the auth-recovery reading (every active cadence) byte-identically; an EMPTY array means "nothing resumed" and is deliberately not the same as omitted. Both console resumes pass the ids their resume write returned.
- **Files modified:** `src/core/cadence/resume.ts`, `tests/cadence-resume.test.ts` (three call sites moved to the options object)
- **Verification:** `tests/cadence-resume.test.ts` 4/4 and `tests/rekey-resume.test.ts` unchanged and green — the auth-recovery path's behaviour is provably untouched; the client-resume case asserts `touchesRescheduled` is exactly the 6 belonging to the two resumed cadences
- **Committed in:** `b274762`

**3. [Rule 2 - Missing Critical] Two outcomes the plan's unions would have reported as lies**

- **Found during:** Task 1
- **Issue:** The plan specifies `killed | already_stopped | no_cadence` and `paused | not_active`. Two real states fall outside them. A D-04 `no_contact` cadence has no mobile and no email, so a kill writes nothing — reporting `killed` would tell the operator we blocked somebody we did not, and stopping it under `contact_suppressed` would put a statement no rule made into the column Phase 7 reads. And `paused(client_paused)` + `customer_reply` is a move the matrix prescribes and no repository method can write (03-03's carried-forward gap); reporting `not_active` would say "nothing should happen" about a case where something should have and did not.
- **Fix:** `no_addresses` on `KillContactResult` and `upgrade_unsupported` (carrying the row's status and pause reason) on `PauseForReplyResult`. Both are closed union members the actions switch over exhaustively; neither adds a write.
- **Files modified:** `src/core/cadence/controls.ts`, `tests/cadence-controls.test.ts`, `.../quotes/[quoteId]/action-state.ts`
- **Verification:** `#writes nothing for a cadence with no address to suppress` and `#names the pause UPGRADE it cannot perform rather than reporting a no-op`, the second asserting the row was left untouched
- **Committed in:** `b274762`

**4. [Rule 1 - Bug] The suite's fixtures would have been swept up by the control they were seeding for**

- **Found during:** Task 1
- **Issue:** The two `pauseForReply` fixtures were seeded in `beforeAll` — one active, one `client_paused`. Both are exactly what `pauseClient` and `resumeClient` act on, so the counts the pause and resume blocks assert (`cadencesPaused: 2`, `cadencesResumed: 2`, `touchesRescheduled: 6`) would have been three and four, and the suite would have "proved" the controls by measuring its own scaffolding.
- **Fix:** Both are seeded inside the blocks that use them, at the end of the file, with a note in `beforeAll` saying why they are absent from it.
- **Files modified:** `tests/cadence-controls.test.ts`
- **Verification:** 14/14 green; the pause and resume counts are now exact `toEqual`s rather than lower bounds
- **Committed in:** `b274762`

---

**Total deviations:** 4 auto-fixed (1 bug, 2 missing critical, 1 blocking)
**Impact on plan:** No architectural change and no scope creep. Deviations 1 and 2 are the plan's own instructions followed to their consequence ("extend for-tenant.ts only if a needed guarded write is missing"; "add a cadence-scoped variant or parameter"). Deviation 3 adds two union members and no behaviour. Deviation 4 is a test-construction error found by the assertions themselves. Every file touched is inside the plan's `files_modified` except `src/app/globals.css` and `tests/cadence-resume.test.ts`, both named above.

## Open questions the plan carried, and how each was decided

| Question | Decision | Why this direction |
|---|---|---|
| Open Question 1: a real route, or a disclosure on the client page? | a real route (as the plan resolved) | Confirmed while building: the resume needs somewhere to come BACK to, so the operator can check the schedule actually moved. A disclosure inside a filterable table cannot be re-opened by URL |
| Should a kill on an already-terminal cadence write the suppression? | yes, unconditionally | The sentence a tradie says is about the human, not the cadence in front of them; see Decisions |
| Should the client resume re-window every active cadence, or only the resumed ones? | only the resumed ones | Cadences created during the pause have correct future slots; see deviation 2 |
| Which skip reason retires a killed cadence's touches? | `suppressed`, not `cadence_stopped` | 03-02's rule that a skip reason states what is TRUE — the recipient being on the list is the cause; `cadence_stopped` describes the consequence and discards it |

## Issues Encountered

- **No blocker introduced or encountered.** This plan adds no environment variable, no migration, no third-party I/O and no new endpoint beyond a server-rendered page and four server actions. The Phase 4 IPND address blocker and the ServiceM8 partner-registration watch item are untouched.
- **`settings.setPausedAt(null)` now has its caller.** 03-04 flagged it as a pause-clearing writer with no caller and an obligation attached — that clearing the column does not itself resume anything and the caller must run the D-07 re-window. `resumeClient` is that caller, and it satisfies the obligation in the order the applier requires: clear the flag and commit, THEN re-window, because `applyResumeRewindow` reads the pause state through its own connection and would see an uncommitted flag as still-set and quietly refuse.
- **`all_touches_done → completed` still has no production driver.** 03-04 asked 03-05 or 03-06 to decide where that write belongs. This plan deliberately did not add it: the natural placement is the tick's progress pass or a post-dispatch sweep, both of which are 03-06's territory, and neither is reachable from a console control. Carried forward below with a recommendation.

## Known Stubs

- **Inherited, unchanged:** `StubSender` and `stubTouchBody` (D-13, plan 03-02), and the auto-passed D-14 draft/approval gates inside `touches.promoteDue`. The quote page renders a stub send as `stub (not really sent)` in its own badge, so a demo cannot be read as a delivery.
- **No new stubs.** Every function and every rendered value ships wired to a real read or a real write; there are no `TODO`/`FIXME` markers in the new code and no hardcoded empty value flowing to the UI.
- **`pauseForReply` has no production caller yet, by design.** It is exported and fully tested so Phase 4's inbound classification calls a proven path rather than writing its own UPDATE. That is a seam, not a stub: the function is complete and its behaviour is asserted.

## Threat Flags

None new beyond the register's own entries, which are mitigated as written:

- **T-3-18** (forged action POST kills/resumes another tenant's cadence) — the WR-01 gate opens every action before any body is read, and the `forTenant` closure is the second layer: `cadences.getById` returns `[]` for a foreign cadence, so a forged body naming one gets `no_cadence`.
- **T-3-19** (resume restarts messaging without entitlement) — same gate; `resumeClient` routes through the guarded `resumeWherePaused` plus `applyResumeRewindow`, and `resumeCadence` through `operatorResumeWherePaused`. Neither writes a status directly.
- **T-3-20** (un-suppressing a complained contact) — `grep -c "delete"` on `controls.ts` returns 0; the repository namespace has no mutator; migration 0017 grants `authenticated` SELECT and nothing else. Three layers, none of them merely documentation.
- **T-3-21** (quote detail leaks cross-tenant data) — every read on the page runs as `authenticated`, so `has_tenant_access` decides; an unknown or foreign quoteId returns zero rows and renders `notFound()`. A PostgREST error never reaches the page.
- **T-3-22** (accidental one-tap kill on a phone) — the arm step renders a control that did not exist before it, so the arming gesture cannot land on the confirm.

**One addition worth naming for the register:** the quote page masks the customer's mobile and email. Not a threat the plan listed, but the unmasked forms would otherwise sit in the server-rendered payload and the client router cache for a decision that does not need the digits.

## User Setup Required

None — no external service configuration, no new environment variable, no migration.

## Next Phase Readiness

**Ready. Every CAD-03 operator stop condition is a tested, transaction-safe operation, and the console is no longer the only thing that can reach them.**

- **03-06 (tick route)** is unaffected: `CadenceTickResult` is unchanged in shape by this plan, and no new counter was added.
- **04-messaging** inherits three seams:
  - `pauseForReply` — call it on inbound classification rather than writing an UPDATE. Handle `upgrade_unsupported`: it is the carried-forward gap, and it now arrives as a value rather than as silence.
  - `suppressed_contacts` — Phase 4's STOP handling is the second writer. Use `source: 'sms_stop'`, write BOTH channels of the human as `killContact` does, and write the address VERBATIM from the cadence snapshot for the reason in Decisions (2).
  - `resumeCadence` — the operator's explicit resume, for escalation flows that need to restart one conversation.
- **CARRIED FORWARD:**
  - `all_touches_done → completed` still has no production driver. Recommendation for 03-06: a post-dispatch sweep in `run-tick.ts` that marks cadences whose touches are all terminal, guarded on `status = 'active'` — the matrix says a PAUSED cadence must stay on the operator's queue, and a sweep that only looks at active cadences honours that without special-casing it.
  - The Phase 4 pause-upgrade gap (03-03) is unclosed but no longer silent: `pauseForReply` names it. Closing it needs one guarded write — pause-or-upgrade from `active` OR from `paused` where the reason is not already `customer_reply`.
- **Contracts later plans must honour (added to 03-02's, 03-03's and 03-04's):**
  - `controls.ts` is the ONLY place a cadence is killed, paused or resumed by a human or by an inbound message. A second implementation is a second answer to "has this person asked us to stop".
  - Any new path that clears a pause must call `applyResumeRewindow` AFTER its own transaction commits, and must pass `onlyCadenceIds` with the ids its resume write returned.
  - There is no un-suppress, and there is no place to add one. The absence is enforced in the schema header, the repository namespace and the grants; a change that touches any of the three is a change to a compliance control.

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-27*

## Self-Check: PASSED

Created files verified present on disk:
- `src/core/cadence/controls.ts` — FOUND
- `tests/cadence-controls.test.ts` — FOUND
- `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx` — FOUND
- `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts` — FOUND
- `src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts` — FOUND
- `src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx` — FOUND

Commits verified in `git log`:
- `b274762`, `689c0ec`, `add40c0` — all FOUND

Plan-level verification re-run at close-out:
- `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-controls.test.ts` — PASS (14/14 against the hosted Sydney project)
- `npm run typecheck` — PASS
- `npm run lint` (`--max-warnings=0`) — PASS
- `npm run build` — PASS; route manifest contains `/clients/[id]/quotes/[quoteId]`
- `npm run test:remote` — PASS (46 files, 1018 tests; no regression against 03-04's 45/992)

All task acceptance criteria re-verified:
- Kill test asserts exactly two `suppressed_contacts` rows (`email` and `sms`, source `operator_kill`) for a contact with both addresses, and `stop_reason = 'contact_suppressed'` with `pause_reason` cleared on the cadence.
- New-quote block test asserts the post-kill `quote_opened`, driven through `markChaseEligible` + `consumeQuoteEvents`, produces a `stopped` cadence with zero touches.
- `resumeClient` test asserts the `customer_reply`-paused cadence remains paused AND its slots are byte-identical, while the two `client_paused` cadences reactivate with `scheduled_at` strictly after `now` and `isInsideWindow` true for every touch.
- `grep -c "delete" src/core/cadence/controls.ts` → **0**.
- All five exports present (`killContact`, `pauseClient`, `resumeClient`, `resumeCadence`, `pauseForReply`); every result is a closed union consumed by an exhaustive `switch` in `actions.ts` — no `default` arm in any of the four.
- `npm run build` succeeds with the new route present; `grep 'tenant.timezone'` finds 6 call sites in the page and `grep 'Australia/'` finds 0, so the formatter provably receives the tenants-row value rather than a literal or the browser default.
- Cross-tenant `quoteId` renders `notFound()`: the reads run as `authenticated` and additionally carry an explicit `tenant_id` predicate.
- `clients/[id]/page.tsx` links every quote row to `/clients/{tenantId}/quotes/{quoteId}`.
- Source ordering in `actions.ts`: `authorize(tenantId)` at lines 154, 197, 227, 265; the only `formData.get` in the file sits inside `readCadenceId`, called at 157 and 268 — after the gate in both.
- `cadenceIdSchema` is `z.object({ cadence_id: z.uuid() })`; anything else returns the fixed `BAD_REQUEST_MESSAGE`.
- `cadence-controls.tsx` gates `killContactAction` behind an `armed` state, so the confirm control does not render until a first, separate interaction has occurred.
- `grep -q "revalidatePath"` in `actions.ts` succeeds (3 occurrences; both the quote route and the client page on every success path).
