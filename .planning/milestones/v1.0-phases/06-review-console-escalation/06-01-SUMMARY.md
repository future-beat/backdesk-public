---
phase: 06-review-console-escalation
plan: 01
subsystem: console
status: complete
tags: [approval-queue, console, schema, migration, cross-tenant, refactor]

requires:
  - "touches.approveWhere (Phase 5 D-12) — the sole guarded path to 'approved'"
  - "touch_drafts.final_body / merge_now / compliance_suffix (05-01, 05-04)"
  - "requireOperator() + OPERATOR_DENIED_MESSAGE (02-06 CR-01)"
  - "forAllTenants_* keyed-accessor family conventions (02-02 onward)"
provides:
  - "src/core/approval/approve-draft.ts — the ONE approval implementation both surfaces call"
  - "(console)/components/draft-card.tsx — the shared review card"
  - "(console)/components/action-state.ts — one copy of the approval copy + outcome→sentence mapping"
  - "forAllTenants_approvalQueue + APPROVAL_QUEUE_STATUSES + APPROVAL_QUEUE_CAP"
  - "/queue page, queue-card, queue server actions, nav Queue link"
  - "escalations + tenant_attestations tables; cadence_touches.stall_alerted_at; TOUCH_SKIP_REASONS gains 'operator_skipped'"
  - "migration 0032 applied to the hosted Sydney DB — the phase's single journal entry"
affects:
  - "quote-page approval actions (now thin callers; behaviour byte-identical)"
  - "draft-review.tsx (renders the shared card; visually unchanged)"
  - "06-02/06-03/06-04/06-05/06-06 build on applied schema, not on types alone"

tech-stack:
  added: []
  patterns:
    - "Extract the shared core BEFORE the second surface exists (CR-02 lesson)"
    - "Core returns OUTCOMES; copy lives in one shared mapping"
    - "Cross-tenant accessor: pinned select list, no join to tenants, closed predicate as an exported const"
    - "Sort in SQL before the LIMIT; true total beside the capped rows"

key-files:
  created:
    - src/core/approval/approve-draft.ts
    - src/app/(console)/components/action-state.ts
    - src/app/(console)/components/draft-card.tsx
    - src/app/(console)/queue/page.tsx
    - src/app/(console)/queue/queue-card.tsx
    - src/app/(console)/queue/actions.ts
    - src/app/(console)/queue/action-state.ts
    - src/db/schema/escalations.ts
    - src/db/schema/tenant-attestations.ts
    - src/db/migrations/0032_phase6_console.sql
    - tests/approval-queue.test.ts
  modified:
    - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx
    - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
    - src/app/(console)/layout.tsx
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/db/schema/cadence-touches.ts
    - src/db/schema/index.ts
    - tests/quote-draft-approval.test.ts
    - tests/lint-ban.test.ts
    - tests/rls-coverage.test.ts

decisions:
  - "The approval core returns a discriminated union of OUTCOMES, never sentences — copy lives in one shared mapping (approvalControlState) so two surfaces cannot answer a double-tap with different words"
  - "`edited` is a property of WHICH entry point ran, never of `editDistance > 0` — an operator who opens the edit box and changes nothing must still be told their version is what goes out"
  - "The latest-attempt subquery column is aliased `latest_attempt_number`, not `attempt` — drizzle emits the bare `.as()` name in a join condition, which Postgres rejects as 42702 ambiguous"
  - "The queue predicate is exported as APPROVAL_QUEUE_STATUSES so the queue, the 06-02 nav badge and the CON-04 stall predicate cannot acquire three spellings of one rule"
  - "Source assertions relocated with the code they are about, not deleted — and the actions file now carries an ABSENCE assertion (no leftover copy of the four subtleties)"
  - "The `operator_skipped` console label ships with the vocabulary member, one plan ahead of its writer, so it can never render as snake_case in the gap"

metrics:
  duration: ~55 min
  completed: 2026-09-01
  tasks: 3
  files: 25
  commits: 3

actuals:
  tokens: 87718
  tasks: 3
  commits: 3
---

# Phase 6 Plan 01: Cross-Client Approval Queue + Phase 6 Schema Summary

The operator's core loop is live: `/queue` renders every unapproved draft across every
client, soonest deadline first, with the full frozen body on screen — and one tap moves the
touch through the one extracted approval core into the one guarded repository write. All
Phase 6 schema landed in a single proven migration (0032).

## What Was Built

**The extracted core (`src/core/approval/approve-draft.ts`).** Framework-free — no
`next/*` import, no copy, no authorization. It carries the four load-bearing subtleties that
were previously inside a single server-action file:

1. **Latest-attempt check.** Approving an older attempt sends text the drafting pass already
   superseded. A forged draft/touch pair answers with the same not-found outcome as a genuinely
   missing draft, deliberately — distinguishing them would be an existence oracle over another
   client's drafts.
2. **Whitelist rebuilt at the draft's `mergeNow`**, falling back to `createdAt`, never a fresh
   clock. That is the midnight-boundary refusal: a draft written at 6pm and approved at 9am is
   the ordinary case, and a whitelist rebuilt at `new Date()` says "15 days" where the body says
   "14".
3. **`complianceSuffix` read off the draft row**, so a tenant rename cannot fail `missing_suffix`
   on a body the operator did not touch.
4. **`edit_distance = 0` written EXPLICITLY** on approve-unchanged. "Reviewed and untouched" is
   the data point V2-01 is gated on; NULL is indistinguishable from "never approved".

It was extracted **before** the second surface existed. The CR-02 defect was two correct copies
that drifted when one was widened and the other was not; building the queue as a second copy
would have reproduced that structure exactly.

**The shared card and the shared copy.** `components/draft-card.tsx` is the review card both
surfaces render; `components/action-state.ts` holds one set of approval sentences plus
`approvalControlState`, the single outcome→sentence mapping. The quote page's `action-state.ts`
re-exports them, so every existing import path (and the existing test's) still resolves to one
definition. Each surface supplies only its own furniture through `header` / `meta` / `footer`
slots — never a fork.

**The accessor.** `forAllTenants_approvalQueue` is the eighth named cross-tenant crossing and
the widest: it returns a frozen `final_body`, a contact first name and a job description across
tenants. What bounds it — and what the file's header and the barrel comment now both argue — is
a pinned select list with **no address column of any kind**, **no join to `tenants`** (names come
from the operator's own JWT under RLS, so it can never name a client they may not already see), a
closed two-status predicate exported as a constant, and every write going back through
`forTenant(row.tenantId)`.

Population is **touch-state-only** with no cadence-status filter, so a paused cadence's pending
draft stays visible (the pause is context, not concealment) and the queue, the 06-02 nav badge and
the CON-04 stall predicate share one rule. The latest draft attempt is **LEFT** joined, so a
`needs_draft` touch with no draft row at all — 05-04's deterministic-failure gap — appears rather
than being silently dropped by an inner join.

**The page.** `requireOperator()` before the read, `force-dynamic`, catch-and-discard on failure.
Because the list mixes tenants, **each card names its own zone** — the one-zone-note-per-list
shortcut only holds on single-tenant pages, and a Perth slot beside a Sydney slot reads as the same
number two hours apart. The relative time sits beside the absolute one, never instead of it.

**The schema.** `operator_skipped` joins `TOUCH_SKIP_REASONS` (every other member names a rule;
this one names a person, and Phase 7 reads the difference). `cadence_touches.stall_alerted_at` is
the CON-04 alert dedupe, modelled on `sm8_connections.alerted_at`. `escalations` carries the D-08
never-twice claim as a unique index on `inbound_message_id`; `tenant_attestations` is append-only
with `note` NOT NULL and no default, because typing *how* you verified it is the deliberation.

**Migration 0032** landed all of it in one journal entry, hand-finished for the two things
drizzle-kit does not model (CHECKs and GRANTs).

## Key Implementation Decisions

**`edited` is about the entry point, not the distance.** The first draft of the core derived
`edited` from `editDistance > 0`. An operator who opens the edit box, changes nothing and taps
"Approve my version" then gets the approve-unchanged sentence — on the one screen where the
difference between "the model's words" and "my words" is the entire point. It is now passed
explicitly by each entry point.

**Copy is the caller's, outcomes are the core's.** A core that returned sentences could not be
called from a script or a future non-console surface, and would put UI copy in `src/core`. A core
that returned booleans would have made each surface re-derive which outcomes are successes — and
`already_approved` being a *success* is a decision, not an obvious fact.

**Source assertions were relocated, not deleted.** Nine assertions in
`tests/quote-draft-approval.test.ts` pinned that the *actions file* imports the real validator,
the one merge-fact builder and the owned edit-distance metric. After extraction those are
properties of the core, so they moved there — and the actions file gained the assertion that
matters more after a refactor: that it keeps **no copy** of any of them. Delegation plus a leftover
copy is worse than either alone, because the copy still compiles and is where half of all future
fixes land.

The `approveWhere` call-site count is now asserted directly: exactly one module in `src` invokes
it. Before the extraction that was true because there was one surface; now it is true because
there is one core, which is the stronger property and the one a third surface must not break.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `42702 column reference "attempt" is ambiguous` in the new accessor**

- **Found during:** Task 1, first remote run of `tests/approval-queue.test.ts`
- **Issue:** The latest-attempt subquery aliased its aggregate as `attempt`. Drizzle emits a
  subquery column by its bare `.as()` name in a join condition, producing
  `... and "touch_drafts"."attempt" = "attempt"` — which Postgres refuses outright, because
  `touch_drafts` is in scope with a column of that name. Every queue read threw.
- **Fix:** Aliased it `latest_attempt_number` — a name no real column shares, so the reference
  cannot be ambiguous. Comment records the trap.
- **Files modified:** `src/db/repository/for-all-tenants.ts`
- **Commit:** 97401d8
- **Note:** `tsc` and `lint` were both green with this bug present. Only the hosted-DB run found
  it, which is the argument for the remote suite existing at all.

**2. [Rule 1 — Bug] Digit-bearing test fixtures failed the fact whitelist**

- **Found during:** Task 1, same run
- **Issue:** The seeded draft bodies read `Following up on touch 1.` The seeded quotes carry no
  invoice amount and no quote date, so the only permitted display string is what `renderDaysSince`
  produces — and the `1` failed `unlisted_number`. The edit tests were red for a reason unrelated
  to what they assert.
- **Fix:** Digit-free fixtures (`SEEDED_BODY`), with a comment explaining that an
  `unlisted_number` violation in this suite is therefore always a real finding.
- **Files modified:** `tests/approval-queue.test.ts`
- **Commit:** 97401d8

### Deliberate additions beyond the plan's file list

**3. [Rule 2 — Missing critical functionality] One shared copy module**

The plan named `queue/action-state.ts` but not a shared one. Re-declaring the approval sentences
per surface would have been the CR-02 drift class in the copy layer, so
`(console)/components/action-state.ts` became their single home, with the quote page's
`action-state.ts` re-exporting. No import path changed for any existing caller.

**4. [Rule 2 — Missing critical functionality] `operator_skipped` console label**

The plan defers the skip *writer* to 06-03. The vocabulary member ships now (the CHECK rides
0032), and the house rule is that labels are maps, never `.replace('_', ' ')` — so a member with
no map entry would render as snake_case on the operator's phone if 06-03 slipped. The label
shipped with the member. This is the `operator_closed` case migration 0020 explicitly calls
honest forward-declaration, not the `window_refused` case it removed.

**5. [Rule 2 — Missing critical functionality] Standing grant guard for the two new tables**

Threat T-6-04 (new tables without grant blocks; TRUNCATE is not subject to RLS) was mitigated by
0032's grant blocks and confirmed by a probe. A one-time probe is not a guard, so `escalations` and
`tenant_attestations` were added to the pinned grant map in `tests/rls-coverage.test.ts`. Suite
re-run remotely: 21/21 green.

### Pinned-list edits the project requires

`tests/lint-ban.test.ts` pins the repository barrel's exports exhaustively, "which is the point".
Adding `forAllTenants_approvalQueue`, `APPROVAL_QUEUE_CAP` and `APPROVAL_QUEUE_STATUSES` required
editing it, with the full justification for the widest crossing in the file written beside them.

## Verification

| Gate | Result |
|------|--------|
| `npm run test:remote -- tests/approval-queue.test.ts` | **16/16 passed** (hosted Sydney DB, cron ticks leased-paused) |
| `npm run test:remote -- tests/rls-coverage.test.ts` | **21/21 passed** |
| `npm test` | **1620 passed** (up from 1590 at plan start); 32 files remote-gated as designed (31 pre-existing + the new suite) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run db:migrate` (1st) | applied; journal entries recorded: **33** |
| `npm run db:migrate` (2nd) | **no-op** — 33 entries, no DDL notices |
| Journal monotonicity guard | green (`idx` 32, strictly after 31, `when` increasing, descriptive tag) |

### Double-migrate no-op proof

The first run emitted a real DDL notice (`constraint "tenant_attestations_kind_known" … does not
exist, skipping` — the idempotent drop-then-add executing). The second emitted **none**: only the
migrator's own `schema/table already exists` notices, which it prints on every invocation. Journal
row count unchanged at 33 across both.

### Hosted-DB probe (read-only)

```
TABLES:    escalations (rowsecurity=true), tenant_attestations (rowsecurity=true)
COLUMN:    cadence_touches.stall_alerted_at — timestamptz, nullable
CHECK:     cadence_touches_skip_reason_known → … 'no_address', 'operator_skipped'
CHECK:     tenant_attestations_kind_known    → kind = 'sm8_automation_off'
GRANT:     escalations/anon SELECT · escalations/authenticated SELECT
GRANT:     tenant_attestations/anon SELECT · tenant_attestations/authenticated SELECT
POLICIES:  escalations_member_access, tenant_attestations_member_access
INDEXES:   escalations_inbound_message_uniq (UNIQUE), escalations_tenant_created_idx,
           escalations_cadence_created_idx, tenant_attestations_latest_idx
```

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-6-01 Elevation — forged POST at the queue approve action | `requireOperator()` (cross-client surface gate) **and** an RLS-scoped `tenants` read with the caller's own JWT, both before any `formData.get`; zod `z.uuid()` on both ids; the draft/touch pairing re-verified inside the core under `forTenant(authorized tenant)`; no extra params accepted. Remote test proves a fully valid pair belonging to another client resolves to `not_found`. |
| T-6-02 Information disclosure — cached render / error leak | `export const dynamic = 'force-dynamic'`; `requireOperator()` before the read; the caught read failure is discarded, not logged or rendered; the log line is a fixed sentence with no ids. |
| T-6-03 Tampering — approving a superseded attempt | The latest-attempt check lives in the one core both surfaces call; proven against real rows (`{ kind: 'superseded' }`, draft still `generated`, touch still `pending_approval`). |
| T-6-04 Elevation — new tables without grant blocks | 0017-style REVOKE-then-GRANT block per table in 0032, SELECT-only to anon/authenticated; verified by probe **and** pinned in `tests/rls-coverage.test.ts` as a standing guard. |
| T-6-SC Tampering — package installs | No packages added. `git diff` touches no manifest. |

## Prohibitions Honoured

- **No batch path to 'approved'.** Both queue actions parse exactly one `draft_id` and one
  `touch_id` through a schema with no array arm — nothing in the action layer could consume a
  multi-id form. Asserted structurally on the shared card (no checkbox, no `multiple`, no
  `draft_ids`).
- **No path to 'approved' except an operator action on a surface showing the full frozen body.**
  Asserted as a call-site count: exactly one module in `src` invokes `touches.approveWhere`.
- **No customer bodies or addresses in logs.** The queue read failure discards its caught value;
  the core's write failure logs a tenant id and nothing else; the accessor's select list contains
  no `contact_mobile` / `contact_email` / `to_address`, asserted remotely against a seeded row that
  really carries one.
- **No `review_mode` field or per-tenant review-mode switch.** None added.

## Known Stubs

None. Two items are explicitly scoped to later plans in this phase rather than stubbed here:

- The **urgency badge** on queue cards (06-02) — cards render the existing `awaiting approval` /
  `failed the fact check` status badge, which is accurate, not a placeholder.
- The **skip control** (06-03) — the shared card exposes a `footer` slot for it, and it renders
  nothing until 06-03 fills it. A `needs_draft` row with no draft renders the honest no-draft card
  (badge + reason + quote link, no approve button), which 06-03 replaces with the fully documented
  version.

Neither prevents this plan's goal: an operator can open `/queue` and approve a real pending draft
across clients today.

## Requirement Status

**CON-01 stays PENDING**, though this plan's frontmatter claims it. 06-03 also claims it, and
CON-01's own wording is "approve, edit-then-approve, **or skip** each pending draft" — the skip
control is 06-03's. Marking it here would tell the ship gate the approval queue is done while a
third of its sentence is unbuilt.

This is the rule 04-10 set for MSG-02 and 05-01 restated for AI-01/AI-04/ONB-03: **mark each
requirement at the LAST plan claiming it**, because a gap that disappears is indistinguishable from
a gap that was fixed. The checkbox was briefly ticked by `requirements mark-complete` during state
updates and was reverted for exactly this reason.

## Notes for Next Plans

- **No later Phase 6 plan may generate a migration.** 0032 is the phase's single journal entry;
  the schema for CON-03, CON-04 and ONB-04 is already applied.
- `APPROVAL_QUEUE_STATUSES` is exported precisely so 06-02's nav badge and 06-04's stall predicate
  read the same rule. Do not re-spell it.
- The shared card's `header` / `meta` / `footer` slots are the extension points. Anything a surface
  needs goes through them; forking the card is the defect this plan spent its budget preventing.
- 06-03's skip writer needs no migration — `operator_skipped` is already in the CHECK and already
  has its console label.
- `stall_alerted_at` is written only by a guarded UPDATE, `alerted_at`-style: one alert per touch
  per threshold crossing.

## Self-Check: PASSED

Files asserted present:

```
FOUND: src/core/approval/approve-draft.ts
FOUND: src/app/(console)/components/action-state.ts
FOUND: src/app/(console)/components/draft-card.tsx
FOUND: src/app/(console)/queue/page.tsx
FOUND: src/app/(console)/queue/queue-card.tsx
FOUND: src/app/(console)/queue/actions.ts
FOUND: src/app/(console)/queue/action-state.ts
FOUND: src/db/schema/escalations.ts
FOUND: src/db/schema/tenant-attestations.ts
FOUND: src/db/migrations/0032_phase6_console.sql
FOUND: tests/approval-queue.test.ts
```

Commits asserted present: `97401d8`, `160d8f5`, `738cb6d`.
