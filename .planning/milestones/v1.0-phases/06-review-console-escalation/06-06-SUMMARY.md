---
phase: 06-review-console-escalation
plan: 06
subsystem: console
status: complete
tags: [pipeline, grouping, conversation, chips, privacy, escalation-phone, mobile, css]

requires:
  - "isStalled + STALL_THRESHOLD_HOURS (06-02) — the shared stall predicate the needs-attention facet asks"
  - "the checklist card's position in the section order (06-04)"
  - ".touch-list / .touch-meta / .badge / .disclosure / .zone-note conventions (05-08, 06-03)"
  - "LABEL_GUESS_LABELS phrasing from the inbox (05-06)"
  - "normalisePhone + AU_MOBILE_PATTERN inside tenantCreateSchema (03-03, ONB-01)"
  - "forTenant().tenant.update() — the named-column, unknown-key-refusing patch"
provides:
  - "src/core/pipeline/grouping.ts — PIPELINE_GROUPS, PIPELINE_GROUP_HEADINGS, groupRank, nextTouchForQuote, NEXT_TOUCH_STATE_LABELS, weeklyTouchCount, weekHorizon, WEEK_HORIZON_DAYS, formatRelative, mergeConversation, lastActivity, OPEN_QUOTE_STATUS"
  - "the D-18 pipeline on clients/[id] — four groups, next-touch line, activity chips, weekly summary"
  - "the Conversation section on the quote page (replaces `Messages sent`)"
  - "src/app/(console)/components/label-guess.ts — LABEL_GUESS_LABELS + labelGuess, the one phrasing three surfaces import"
  - "escalationPhoneSchema + ESCALATION_PHONE_MESSAGE exported from @/core/shared/tenant"
  - "updateEscalationPhoneAction + EscalationPhoneForm + escalationPhoneSavedMessage"
  - ".touch-line and .reply-body"
  - "tests/pipeline-grouping.test.ts (pure, 62)"
affects:
  - "the `?status=` quote filter is GONE — Closed holds the won/lost history, collapsed"
  - "the seven-column quotes table is gone; rows are .touch-list items and the Contact column with it"
  - "the quote page no longer selects send_ledger.to_address"
  - "tenantCreateSchema's escalation_phone field IS escalationPhoneSchema — one object, two callers"
  - "five source assertions moved out of the remote-gated triage suite into the pure suite"

tech-stack:
  added: []
  patterns:
    - "The ORDER is an exported array the render walks and the tests assert — not a list spelled twice"
    - "A privacy guarantee expressed as a SHAPE: the chip derivation's parameters and result have no body field, so the reads never select the column"
    - "One horizon asked twice (the weekly count and the relative/absolute switch), never two sevens"
    - "Source assertions belong in a pure suite: behind a remote gate they run only on a sanctioned remote run, and rot"
    - "Assert on the RULE (a select list, a patch object's keys, a CSS selector followed by `{`) rather than on the file, so a tombstone comment may name what the code may not do"

key-files:
  created:
    - src/core/pipeline/grouping.ts
    - src/app/(console)/components/label-guess.ts
    - src/app/(console)/clients/[id]/escalation-phone-form.tsx
    - tests/pipeline-grouping.test.ts
  modified:
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
    - src/app/(console)/inbox/page.tsx
    - src/core/shared/tenant.ts
    - src/app/globals.css
    - tests/quote-triage.test.ts
    - tests/tenant-validation.test.ts
    - tests/inbox-authorization.test.ts
    - tests/lint-ban.test.ts

decisions:
  - "`PIPELINE_GROUPS` is the rule, not a description of it: `groupRank` evaluates its cases in that order and returns the first match, and the page renders by mapping the same array — so the action order and the rank cannot come apart"
  - "The stalled facet is asked BEFORE the closed test, deliberately: `isStalled` does not filter on cadence state either, and a quote that produced a stall alert must be findable in the group the email sent the operator to look in"
  - "`Closed` covers any quote whose upstream status is not `Quote` — written as the OPEN member rather than as a list of the closed three, so a status ServiceM8 adds later reads as closed rather than silently joining the chaseable groups"
  - "A won quote with a cadence the tick has not stopped yet reads as Closed, not Chasing: the group scanned for work must not contain a finished job for the length of a tick"
  - "`stalled` WINS over the underlying touch status in the next-touch label — the `deriveUrgency` rule (overdue tested before due_soon) one level up: when two readings are both true the urgent one is the honest one"
  - "`weeklyTouchCount` counts OVERDUE touches: an overdue unapproved touch is the work most in need of a person, and a summary that excluded it would shrink on exactly the morning it should grow"
  - "The relative/absolute switch in the next-touch line reuses WEEK_HORIZON_DAYS rather than picking its own boundary — one constant asked twice"
  - "`lastActivity` takes `{ at }` and `{ at, label }` rather than the evidence types, so the client page's reads never have to select `body` at all — the mitigation is the signature, not a comment above a `.map()`"
  - "The `Messages sent` section was REPLACED by `Conversation` rather than joined by it: it was the sent half of the same list, and two lists of the same sends agree until one is changed"
  - "The Contact column went with the table. The pipeline row shape (UI-SPEC §3) has no contact, the customer's name lives on the quote page where the decision needing it is made, and the read it required is one fewer round trip and one fewer customer identifier on a scan surface"
  - "`escalationPhoneSchema` is EXTRACTED and `tenantCreateSchema` now uses that object, rather than the action importing the pieces and re-assembling them — a second AU-mobile pattern on the field that decides which handset gets a hot lead is CR-01 at its worst"
  - "LABEL_GUESS_LABELS moved to a leaf module rather than being copied: 'a guess stays phrased as a guess on every surface' is a rule, and a copied map is verbatim exactly until somebody softens one copy"

metrics:
  duration: ~70 min
  completed: 2026-09-01
  tasks: 2
  files: 15
  commits: 2

actuals:
  tokens: 61000
  tasks: 2
  commits: 2
---

# Phase 6 Plan 06: The Client Pipeline, the Conversation, and an Editable Alert Number Summary

CON-02 holds: the client page answers "what needs me, for this client" in action order
before the operator scrolls, every active quote carries its next touch and its last
activity as compact indicators, the whole message history is one tap deeper on the quote
page, and nothing customer-private reaches the surface built to be scanned in somebody
else's kitchen.

## What Was Built

**One derivation, exported as data (`src/core/pipeline/grouping.ts`).** Framework-free and
DB-free, with exactly one import — `isStalled` — asserted as the only one. The ORDER is an
array (`PIPELINE_GROUPS`), the rank evaluates its cases in that order and returns the first
match, and the page renders by mapping the same array. A page that spelled the order out in
JSX and a suite that spelled it out in an `expect` would be two statements of one decision,
and that pair stays correct precisely until somebody reorders one of them.

The three facets of `Needs attention` are unrelated problems — a paused cadence (any
reason), a quote still awaiting triage, a stalled touch — and the third asks the SHARED
predicate. The number 4 does not appear anywhere in the module, which is source-asserted:
five surfaces now render one stall question, and five answers would teach an operator that
none of the colours mean anything.

**The pipeline (D-17/D-18/D-20).** The quotes section regroups under `Needs attention` →
`Chasing` → `Waiting` → `Closed (n)` in a disclosure. `Needs attention` always renders, with
`Nothing needs attention.` when empty — the triage precedent, and the distinction that
matters: an operator who cannot tell "nothing needs me" from "the list failed to load"
checks their phone instead. `Chasing` and `Waiting` hide when empty because their headings
carry nothing a missing heading does not.

Rows are `.touch-list` items, not the seven-column table. The job number stays the tap
target; the description truncates to one line with its `title`; then the D-20 next-touch
line (`Next: #3 in 6 hours · awaiting approval`) and the D-19 chips. The `?status=`
Open/Won/Lost/All filter is gone: `Closed` holds the won and lost history, so there is no
slice left for an operator to be stranded in, and the third empty state that existed to get
them out of one went with it.

**The conversation (D-19).** On the quote page, where the cadence controls already are, and
it REPLACES the old `Messages sent` list rather than sitting beside it — that list was the
sent half of this one. Sent evidence and inbound replies merge through a pure function:
oldest first, with a sent row winning a shared instant because a reply cannot precede the
message it answers and a provider timestamp rounded to the second can make it look like it
did. Reply bodies render verbatim and un-truncated here, because this page is inside the
operator gate; the delivery badge appears only when a receipt has actually arrived, since a
NULL `delivery_status` means "no receipt yet" and is not a delivery problem.

The section ALWAYS renders, with the UI-SPEC's exact sentence and the first scheduled slot
in the tenant's zone when one exists — derived by the same `nextTouchForQuote` the client
page's next-touch line uses, so the two cannot name different slots.

**The chips, and what they cannot do.** `sent 2 hours ago` and
`reply 40 minutes ago — reads as interested`, each rendered only when its fact exists. The
guarantee is not that the `.map()` is careful: `lastActivity`'s parameters are `{ at }` and
`{ at, label }`, its result has no body field, and the client page's reads therefore never
select the column at all. The suite walks every `.select(...)` list on that page and asserts
`body` is not among them.

**The escalation number, editable at last (CON-03).** Until now `escalation_phone` could
only be set on the new-client form — a tradie changing phones had no route to it that was
not a SQL console, on the one field whose whole purpose is that a person picks up.
`escalationPhoneSchema` was extracted from `tenantCreateSchema`, which now uses that same
object, and `updateEscalationPhoneAction` imports it. The equality is proven behaviourally:
a sixteen-case matrix runs through both entry points and must get identical answers.

## Key Implementation Decisions

**The stalled facet is asked before the closed test.** That means a stalled unapproved touch
can pull a won quote into `Needs attention`, which looks like a bug and is the point:
`isStalled` does not filter on cadence state either, the stall alert email fires on that
touch, and the email points the operator at this page. A quote the alert was about must be
findable in the group the alert sent somebody to look in. It is also the right reading on its
own terms — an unapproved draft on a job that was already won is a message about to go to a
customer who has accepted.

**Closed is written as "not open", not as a list of the closed three.** ServiceM8's four
statuses are fixed today. If a fifth ever arrives, the safe default is that we do not chase
a job whose state we do not understand — chasing it is the failure that embarrasses a
client, and a list of three closed members would have made the new one chaseable silently.

**`lastActivity`'s signature is the privacy mitigation.** The plan asked for chips that
"NEVER carry body text". A comment above the render would have been the obvious way. Instead
the function takes two structurally-typed arrays with no `body` member, which means the
client page never needs to read the column, which means there is no body in the HTML
payload, the client router cache, or a screenshot pasted into a chat thread. `SentEvidence`
and `ReplyEvidence` still satisfy those parameters, so the quote page passes its merged
thread straight in.

**The Contact column went with the table, and that is a real loss weighed.** The UI-SPEC's
row shape has no contact, the customer's name is on the quote page where the decision that
needs it is made, and dropping it removes a round trip and a customer identifier from the
surface most likely to be read in public. What it costs is scanning by customer name, which
is a search problem rather than a column.

**The relative/absolute switch reuses the week horizon.** "in 3 hours" is what an operator is
actually asking up close; a fortnight out it is noise and the date is the fact. Picking a
second boundary (48h, say) would have been two numbers that mean roughly the same thing and
drift independently.

## Deviations from Plan

### Deliberate additions beyond the plan's file list

**1. [Rule 2] `src/app/(console)/components/label-guess.ts`**

The plan says the chips reuse the inbox phrasing "verbatim". The inbox's map was a private
`const`. Copying it would have been verbatim on the day it was written and for no day after
— and "a guess stays phrased as a guess on every surface" is a rule, not a style. The map
moved to a leaf module that imports nothing (three consumers, one of them a hair away from
being a client component), the inbox imports it, and `inbox-authorization.test.ts`'s D-15
assertion was rewritten to follow the words to their new home and to pin that the page has
no local map of its own.

**2. [Rule 2] `escalationPhoneSchema` extracted rather than the pieces exported**

The plan says the edit is "validated through the same `normalisePhone` + `AU_MOBILE_PATTERN`
path". Exporting those two and re-assembling them in the action would have produced a second
`.refine(...)` chain — the same shape as the original, until one of them was loosened. The
whole field schema is now one exported object and `tenantCreateSchema` uses it. The matrix
test asserts both entry points agree case by case, which is a stronger claim than an import.

**3. [Rule 2] `formatRelative` in the pipeline module**

The UI-SPEC copy rows require relative labels in two places and no such helper existed. It is
pure and server-side for 06-03's reason: computed in a client component it would use the
browser's clock at hydration, and a row rendered at 3:59 that hydrates at 4:01 would carry a
label the stall alert disagrees with.

**4. [Rule 2] `NEXT_TOUCH_STATES` has five members where the UI-SPEC lists four**

`scheduled` is the majority state of everything in `Waiting` — a touch the engine has not
promoted yet. The alternative to naming it is a next-touch line rendering a bare separator or
a raw column value, which is the house rule's exact failure.

**5. [Rule 1 — Bug] `stateGlance` maps the stop reasons it used to print raw**

The superseded `cadenceGlance` returned `cadence.stop_reason ?? 'stopped'`, so a stopped
cadence rendered `contact_suppressed` at the operator in snake_case — the very thing the
`ELIGIBILITY_LABELS` header two functions down argues against. The replacement maps both
vocabularies, with the raw value as a visible fallback.

**6. [Rule 2] Delivery badge on the sent rows**

The plan says "delivery badge where `delivery_status` is known". The column was not selected
anywhere on the page; it is now, with the NULL case rendering nothing at all rather than
`unknown` — `unknown` is a real `DELIVERY_STATUSES` member meaning the carrier told us it
could not say, and conflating "no receipt yet" with it would report a delivery problem that
does not exist.

**7. [Rule 2] The quote page stops selecting `send_ledger.to_address`**

It was selected and never rendered — the row reads "SMS via {sender}". A customer's mobile in
the HTML payload and the router cache for a fact nothing on screen uses is the `key_last4`
discipline one table over. Removed, and asserted on the select list.

### Departures from the plan's literal wording

**8. The five source assertions moved suite, and three changed meaning**

The plan's Task 1 supersedes the `?status=` filter, which `tests/quote-triage.test.ts` pinned
in three assertions. Rewriting them in place was the obvious move and would have been wrong
twice over: **that file is a database suite**, so under a bare `npm test` it errors at import
and every assertion in it — including five that need no database — runs only during a
sanctioned remote run. A source assertion behind a remote gate is one that rots. They are now
in `tests/pipeline-grouping.test.ts`, rewritten to ask the same questions of the grouping
(is the won/lost history still reachable, is an empty list diagnosed rather than blanked),
with a tombstone comment in the old file explaining the move and naming the sibling block
that should follow it.

**9. `.filters` / `.filter-link` CSS deleted**

Dead CSS outlives the element it styled and teaches the next reader that the control is still
there somewhere. Replaced by a comment saying what was there and why it went.

### Pinned-list edits the project requires

- `tests/lint-ban.test.ts`'s `CLIENT_REACHABLE` gains `escalation-phone-form.tsx` (a
  `'use client'` form one `import` away from `escalationPhoneSchema`, a VALUE in a module the
  server half of the same feature imports) and `components/label-guess.ts` (a leaf whose
  leafness is the point).

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run tests/pipeline-grouping.test.ts` | **62/62 passed** |
| `npx vitest run tests/tenant-validation.test.ts` | passed, including the new 16-case refusal matrix |
| `npx vitest run tests/inbox-authorization.test.ts` | **34/34 passed** |
| `npm test` | **2090 passed** (2057 at plan start); 35 files remote-gated as designed |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run build` | green; `/clients/[id]` and `/clients/[id]/quotes/[quoteId]` in the route manifest |
| `npm run test:remote` | **NOT RUN** — this plan is pure-only by instruction; 06-05 was the wave's remote-suite user |
| Migration | **none generated** — 0032 remains the phase's single journal entry |
| Packages | none installed — `git diff` touches no manifest |

### Test-environment note

Every command above was run with `STALLED_DIGEST_SECRET` injected into the command
environment. It is a REQUIRED member of `serverEnvSchema` (06-02) and is still absent from
`.env.local`, which this executor is permission-blocked from writing. **06-02's operator
obligation 1 remains outstanding and blocks a bare `npm test`.** No `.env*` file was edited.

### The 35 "failed" files

`npm test` reports 35 file-level failures and 0 test failures. Those are the database suites,
which throw at import on the WR-09 disposable-stack gate — the same count and the same files
as at plan start. Every assertion that runs, passes.

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-6-21 Information disclosure — raw bodies leaking into pipeline chips/lists | Expressed as a SHAPE, not a convention: `lastActivity` takes `{ at }` / `{ at, label }` and returns `{ lastSentAt, lastReply }` with no body field, so the client page's reads never select the column. Asserted by walking every `.select(...)` list on that page for `body` / `final_body` / `generated_body`, by pinning that the page contains no `.body` access at all, and by a serialisation check that a fixture reply's text cannot appear in the derivation's output. Bodies render on the quote page (asserted present, with the argument) and the inbox, both behind the operator gate. |
| T-6-22 Tampering — forged escalation-phone edit redirecting tradie alerts | WR-01 order asserted positionally: `authorize(tenantId)` — session check **and** an RLS-scoped `tenants` read with the caller's own JWT — appears before the first `formData.get`. Validation is the SAME schema object tenant creation uses, proven by a 16-case matrix run through both entry points; a number missing its leading zero is REFUSED with the fixable message, never repaired. A forged over-long body is bounded before the regex. The write is `tenant.update({ escalationPhone })` — the patch object's key list is asserted to be exactly `['escalationPhone']`, and the action is asserted not to read the row first. |
| T-6-23 Information disclosure — conversation thread reachable past the operator gate | No new route: the section rides the existing quote page, whose every read goes through `createClient()` (the operator's own JWT) so `has_tenant_access(tenant_id)` decides what comes back. The reply read carries both `tenant_id` and `quote_id` predicates, which also excludes the NULL-tenant unattributed replies that belong to the inbox. |

## Prohibitions Honoured

- **No raw message body on the client page.** Not filtered downstream — NOT SELECTED.
  Asserted on the select lists and on the absence of any `.body` access.
- **Chips carry a label and a relative time only.** Neither chip renders when its fact does
  not exist; there is no placeholder chip.
- **The escalation number is refused, never repaired.** Sixteen cases, including the six
  with an obvious "fix" that is not applied.
- **A settings save disturbs no row siblings.** The patch object has one key.
- **No migration.** `git diff` touches no file under `src/db/migrations/`.
- **No packages installed.** `git diff` touches no manifest.
- **No `.env*` file edited**, and no remote suite run — the hosted database is production.

## Known Stubs

None.

One thing is deliberately scoped elsewhere and is not a stub: `labelGuess()` in
`components/label-guess.ts` ships exported and unused — both current consumers index the map
directly, inside JSX where the `??` fallback reads fine. It exists as the function form for
the next surface that needs the guess outside a template, in the same sense
`deriveUrgency` shipped one plan ahead of its badge.

## Requirement Status

**CON-02 is complete and is marked here** — this is the only plan claiming it. The operator
can see each client's whole pipeline: cadence states grouped by what needs them, the next
scheduled touch per quote with its draft state, last-sent and last-reply indicators, the
week's load in one line, and the full conversation one tap away on the quote page.

CON-03's console half — an operator-editable escalation number — also lands here. The
requirement itself belongs to 06-05, which built the escalation pass; this plan removed the
"set it at creation or never" limitation that would have made it unusable in practice.

## UAT obligation (not unbuilt work)

Task 2's `<human-check>` needs a phone, which this executor does not have:

> Open a seeded client on a phone — groups in order, tap a quote, read the conversation
> thread interleaved correctly in Perth time, set the escalation phone, see an invalid
> number refused.

Every mechanism it checks is asserted here (the group order, the interleave and its
tiebreak, the tenant-zone formatting and its single zone-note, the refusal matrix, the
full-width row rules). What a handset adds is the judgement about whether a pipeline row
carrying four facts still reads well under a thumb at 390px.

## Notes for Next Plans

- **`PIPELINE_GROUPS` is the order.** A fifth group goes in that array and in
  `PIPELINE_GROUP_HEADINGS` (a `Record` over the union, so forgetting is a compile error),
  and `groupRank` gains its case in the right position. Do not sort in the JSX.
- **Do not write a second week horizon.** `WEEK_HORIZON_DAYS` is asked by the weekly count
  and by the next-touch line's relative/absolute switch.
- **Chips must keep taking `lastActivity`'s output.** The day something passes a fuller row
  into a chip is the day a customer's words reach the scan surface; the shape is the guard.
- **`components/label-guess.ts` is the phrasing.** A fourth surface imports it. It is a leaf
  by contract — pinned in `tests/lint-ban.test.ts` — so nothing in it may import the schema
  module for the `InboundLabel` union.
- **`escalationPhoneSchema` is the one path.** A future settings screen edits this column
  through that object, and the matrix test in `tenant-validation.test.ts` is where a new case
  goes.
- **The triage console source-assertion block in `tests/quote-triage.test.ts` should move**
  to a pure suite the next time it is edited, for the reason its neighbour just did.

## Self-Check: PASSED

Files asserted present:

```
FOUND: src/core/pipeline/grouping.ts
FOUND: src/app/(console)/components/label-guess.ts
FOUND: src/app/(console)/clients/[id]/escalation-phone-form.tsx
FOUND: tests/pipeline-grouping.test.ts
```

Commits asserted present: `4c883fc`, `0384258`.
