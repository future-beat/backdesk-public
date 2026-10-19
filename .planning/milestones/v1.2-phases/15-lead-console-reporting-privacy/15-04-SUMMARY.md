---
phase: 15-lead-console-reporting-privacy
plan: 04
subsystem: console (/leads page, card, close action, nav) / shared create-job sheet / queue anchor / robots
status: complete
tags: [lead-queue, tracer, ci-gate, two-authority-read, deadline-tier, two-step-close, create-job-sheet, d-01, d-09, d-11, con-05]
requires:
  - 15-01 (migration 0042; first executed by this plan's CI gate)
  - 15-02 (leads/action-state.ts leaf — every sentence, closeLeadSchema, closeControlState, LEAD_TOUCH_COUNT)
  - 15-03 (listOpenLeadsForQueue, LEAD_QUEUE_CAP, forTenant().leads.queueCards, countOverdueOpenLeads; DB suites first run here)
  - Phase 14 (CreateJobForm, jobLinkageFor, jobSheetFacts, previewLinesFor/previewSha256For)
provides:
  - "/leads: the operator-gated cross-client lead queue (page, 'use client' card, closeLeadFromQueue action, nav item third)"
  - "src/core/leads/queue-deadline.ts: leadDeadlineTier — the one overdue definition (twin of countOverdueOpenLeads)"
  - "src/app/(console)/components/lead-job-sheet.ts: readLeadJobSheets, LEAD_RESOLUTION_LABELS, LEAD_JOB_STATE_LABELS, CreateJobSheet, jobChip, leadJobChips, LeadJobChip — shared by the inbox, /leads and (15-05) the client page"
  - "/queue#touch-{id} anchor on both queue-card arms (DraftCard gains optional anchorId)"
  - "/inbox lead row link to /leads#lead-{id}; create-job action revalidates /leads"
  - "robots disallows /leads; proxy pin proves /leads gated (matcher unchanged)"
affects:
  - 15-05 (imports LEAD_RESOLUTION_LABELS / readLeadJobSheets from components/lead-job-sheet.ts; shares tests/operator-authorization.test.ts GUARDED_PATHS)
  - 15-06 (digest overdue line must use countOverdueOpenLeads — the SQL twin of leadDeadlineTier)
  - 15-08 (deploy; phone human-checks for /leads, /queue, /inbox)
tech-stack:
  added: []
  patterns:
    - "Two-authority list page: ids-only cross-tenant family read, then forTenant(tenantId) per tenant for personal facts, both inside one try with a discarded catch"
    - "Deadline tier: stallable status → deriveUrgency; machine-owned status past its slot → 'scheduled'; no next touch → no chip"
    - "Card-held useActionState for a terminal two-step close; settled state replaces the whole controls block"
    - "One server-side sheet builder for every page mounting CreateJobForm; each caller keeps its own try and fixed log string"
key-files:
  created:
    - src/app/(console)/leads/page.tsx
    - src/app/(console)/leads/lead-card.tsx
    - src/app/(console)/leads/actions.ts
    - src/core/leads/queue-deadline.ts
    - src/app/(console)/components/lead-job-sheet.ts
    - tests/queue-deadline.test.ts
    - tests/leads-page.test.ts
    - tests/lead-close-action.test.ts
  modified:
    - src/app/(console)/layout.tsx
    - src/app/(console)/inbox/page.tsx
    - src/app/(console)/inbox/create-job-actions.ts
    - src/app/(console)/queue/queue-card.tsx
    - src/app/(console)/components/draft-card.tsx
    - src/app/robots.ts
    - tests/operator-authorization.test.ts
    - tests/lint-ban.test.ts
    - tests/marketing-metadata.test.ts
    - tests/proxy-host-routing.test.ts
    - tests/audit-request-console.test.ts
    - tests/create-job-action.test.ts
decisions:
  - "The /queue#touch-{id} anchor is on BOTH queue-card arms: a pending_approval touch renders through the shared DraftCard, so the card gains an optional anchorId prop (absent on the quote page → no attribute). Anchoring only the no-draft article (the plan's literal reading) would have left the primary deep-link target unanchored"
  - "jobChip moved into lead-job-sheet.ts with the label maps, and leadJobChips builds the inbox's job/resolution/state chips with the inbox's colours, so the two surfaces cannot drift on chip wording or colour"
  - "The confidence-suffix map (medium → not certain, low → a guess) is copied into leads/page.tsx with a comment naming the inbox's original; label-guess.ts (a pinned leaf) and the inbox's private map were left alone"
  - "callerLabelOf renders NO_VALUE rather than throwing if toLocalSpacedMobile refuses a value — an open lead is never pseudonymised, so this is a schema-violation guard, not a path"
  - "Tenant zone fallback is Australia/Perth (plan) rather than the queue's UTC"
metrics:
  duration: 28min
  completed: 2026-10-13
  tasks: 2
  files: 20
actuals:
  tokens: 20600
  tasks: 2
  commits: 3
---

# Phase 15 Plan 04: The Lead Queue (Tracer) Summary

`/leads` is now wired end to end: operator gate, an ids-only cross-tenant read, per-tenant mobile and newest reply, one `now`, cards with deadline, after-hours and job chips, the caller line, the next-touch line, the verbatim reply with its chips, a deep link to approve on `/queue`, the Phase 14 create-job sheet, and a two-step quiet close (reason `operator`). It is the third nav item. The first CI run of migration 0042 and of every 15-01 and 15-03 DB suite went green on the tracer gate after one fix-forward.

## Tracer CI gate

| Run | SHA | Result | Notes |
|-----|-----|--------|-------|
| 38373705444 | `ad2ed45` (tracer commit) | **failure** | Migrate step: `Journal entries recorded: 43`. All seven DB suites passed: `rls-coverage` (30), `text-back-recent-conversion` (4), `lead-job-create-db` (16), `lead-queue` (12), `missed-call-log` (10), `report-missed-calls` (11), `report-metrics` (19). One pure suite failed: `tests/audit-request-console.test.ts` pins the console nav at exactly 6 `<Link href=` and got 7. |
| 38375020788 | `61de38f` (fix-forward) | **success** | 205/205 files, 6396 passed, 29 skipped. The same 29 were skipped on the red run, so they predate this plan. Journal entries 43; the same seven DB suites passed, none skipped. |

- **Fix-forward:** `61de38f` `fix(15-04): the nav-width pin counts the Leads link — seven, still exact`. The failure came from this plan's own nav item (15-UI-SPEC's decision), not from 15-01 or 15-03's SQL or fixtures.
  - `NAV_LINK_COUNT` 6 → 7, with a dated comment. The assertion is still an exact count, and the "request list is not in the nav" assertion is unchanged.
- **First-run SQL from 15-03, all executed without error against a fresh Postgres:** tz-bucketed `extract … AT TIME ZONE` with `GROUP BY 1,2`, `selectDistinctOn`, `next_touch_rank`, `greatest(0,…)`, `FILTER`, and the EXISTS reads.
- **Branch cleanup:** `ci/phase-15-tracer` was deleted after the green run, and `git ls-remote --heads origin ci/phase-15-tracer` prints nothing.
- **main:** not pushed. `git log origin/main..HEAD` lists every phase commit.
- **Full Task 1 verify, at HEAD 61de38f:** the local half plus `gh run list --commit HEAD` returning `success` — green.

## What was built

### Task 1 (tracer): `ad2ed45`

- **`leadDeadlineTier(next, now)`** returns:
  - `null` when there is no next touch;
  - `deriveUrgency` when the status is in `STALLABLE_TOUCH_STATUSES`;
  - `'scheduled'` for an `approved` or `scheduled` touch past its slot, because the machine owns those.
  It spells no threshold of its own.
- **`closeLeadFromQueue(tenantId, _prev, formData)`**:
  - runs `authorize` (UUID guard → `requireOperator()` → own-JWT `tenants` read) before `formData.get`;
  - parses one `lead_id`;
  - calls `closeLead(tenantId, leadId, 'operator', new Date())`, discarding the caught value and logging `[leads] close write failed`;
  - on `closed`, revalidates `/leads`, `/queue`, `/inbox` and `/clients/${tenantId}`;
  - maps the result with `closeControlState`.
- **`/leads` page:**
  - `force-dynamic`, with `requireOperator()` before any read.
  - One `try` holds `listOpenLeadsForQueue(LEAD_QUEUE_CAP)` plus `forTenant(t).leads.queueCards(ids)` per tenant. On failure it logs `[leads] lead queue read failed` and renders `LEADS_LOAD_FAILED_MESSAGE` in `role="alert"`.
  - Names and zones are read under RLS, falling back to `Another client` and `Australia/Perth`.
  - One `now` for the whole render.
  - The count line shows the true total, plus ` · {m} overdue` counted over the rendered cards. It is absent at zero. The header comment states the cap divergence.
  - Shows the hint, and the two-sentence empty state when there are no leads.
- **`LeadCard`:**
  - `'use client'`, rendered as `<article className="draft-card" id="lead-{id}">`.
  - Header chips:
    - the deadline chip, using the same class map as the queue;
    - `after hours`;
    - from Task 2, the job chips.
  - Caller line, plus the call count and last-rang time when there was more than one call.
  - Deadline line: `Next: #n of 3 · slot (zone) · relative · state word`, or `No follow-ups left · expires …`.
  - Reply block: the body in `.reply-body`, the `(empty message)` marker, or `No reply yet.`. Chips are the label with its confidence suffix, then urgency, `hot` and the received time. Soft opt-out and emergency use `badge--error`.
  - Controls, in order: approve link (only for `pending_approval` / `needs_draft`), then the sheet (Task 2), then `CloseControl`, two-step and `.button-quiet`.
  - A settled close replaces the whole controls block with `role="status"`. An unsettled error shows `role="alert"` and keeps the control.
- **Nav:** `<Link href="/leads">Leads</Link>` sits after Queue and before Audits, with no badge.
- **Pins:**
  - `tests/queue-deadline.test.ts`: 8 cases.
  - `tests/leads-page.test.ts`: page, action, card and layout source pins.
  - `tests/lead-close-action.test.ts`: 8 cases. Call-count ordering on denial; the four-path revalidation; already-closed; a throw that is discarded.
  - Dated entries in `GUARDED_PATHS` (the two leads files) and `CLIENT_REACHABLE` (the card).

### Task 2 (expansion): `3c03cee`

- **`components/lead-job-sheet.ts`** (server module) holds the inbox's sheet loop verbatim as `readLeadJobSheets(leadIdsByTenant)`. It throws on failure, so each caller keeps its own `try`. The two label maps, `CreateJobSheet`, `jobChip` and the new `leadJobChips` live here too.
- **Inbox:** `readLeadJobs` now only groups rows by tenant and calls the helper inside the existing `try` and `[inbox] lead job linkage read failed`. The lead row gains `open the lead →` to `/leads#lead-{leadId}`. Nothing else the inbox renders changed.
- **`create-job-actions.ts`** adds `revalidatePath('/leads')`.
- **Queue card:**
  - `const anchorId = \`touch-${row.touchId}\``, set on the no-draft `<article>` and passed to `DraftCard`, which gains an optional `anchorId` → `id`.
  - `LEAD_TOUCH_COUNT` is now imported from `../leads/action-state`, and the local const was removed.
- **`/leads`:** the page calls `readLeadJobSheets` inside the same `try` and passes `chips: leadJobChips(link)` and `sheet` to each card. The card mounts `<CreateJobForm tenantId leadId clientName {...sheet} />` only when a sheet exists.
- **Robots and pins:**
  - `robots.ts` disallows `/leads`.
  - `marketing-metadata` gets a disallow case; `proxy-host-routing` gets both lists.
  - `src/proxy.ts` did not move: the matcher already gates `/leads`.

### The card's final value-import set

`react`, `next/link`, `@/core/aging/stall-policy`, `../components/action-state`, `../inbox/create-job-form`, `./action-state`, `./actions`. That is Task 1's allowed set plus `../inbox/create-job-form`. `../components/label-guess` is permitted but unused, because the page builds the chip strings. The card's `import type` from `../components/lead-job-sheet` is erased at build time. A pin asserts the card never value-imports that module.

## Verification (local)

- **Task 1 verify:**
  - 8 suites / 408 tests;
  - typecheck, lint and `next build` (`ƒ /leads`) green;
  - both grep gates pass;
  - `git diff --quiet` against the phase base `e7ee32b`: queue page, queue actions, `close.ts`, `sync-upsert`, `cron-schedules` and `console-error-leak` are all byte-identical.
- **Task 2 verify:**
  - 11 suites / 562 tests;
  - typecheck, lint and build green;
  - every grep gate passes;
  - byte-identical: queue page, queue actions, `create-job-form.tsx`, `src/proxy.ts` and `console-error-leak`.
- **Extra pure suites over the touched files:** `lead-labels`, `quote-draft-approval`, `audit-request-console`, `brand`, `text-back-outcome-labels` (7 files / 414 including repeats) — green.
- **DB suites that read the touched files**, checked by reading their source assertions rather than running them:
  - `approval-queue`: the no-draft slice, the class map and the stack modifier;
  - `lead-reply`: the inbox quote-link guard and the queue-card quote-href guard;
  - `pipeline-grouping`: `labelGuess(` in the inbox.
  All still hold.
- Every local run passed the CI dummy pepper inline; no env file was named. No `test:remote`, no `db:migrate`.
  - An explicit-list run that included `tests/stall-tick.test.ts` (a DB suite) refused at the env guard, and no database was contacted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The `/queue` anchor had to land on both card arms**
- **Found during:** Task 2
- **Issue:** The plan puts `id` on queue-card's `<article className="draft-card">`, which only exists on the no-draft arm. A `pending_approval` touch, the main target of `Approve the next touch →`, renders through `components/draft-card.tsx`, so the link would have landed at the top of `/queue`.
- **Fix:**
  - `DraftCard` gains an optional `anchorId` prop, rendered as `id`. The quote page passes nothing, so it renders no attribute.
  - `queue-card.tsx` computes `anchorId` once and uses it on both arms.
  - The plan's grep gate (`touch-${row.touchId}` count == 1) still holds.
  - The `leads-page` pin asserts both arms.
- **Files modified:** `src/app/(console)/components/draft-card.tsx` (not in `files_modified`), `src/app/(console)/queue/queue-card.tsx`
- **Commit:** 3c03cee

**2. [Rule 3 - Blocking] Nav-width pin (CI red on the tracer SHA)**
- `tests/audit-request-console.test.ts` (09-06) pinned exactly six nav links. The UI-SPEC-decided seventh link turned it red.
- Moved by design to 7, with a dated comment; still an exact count. The file is not in `files_modified`.
- **Commit:** 61de38f

**3. [Rule 3 - Blocking] The WR-04 digest pin followed the sheet builder**
- `tests/create-job-action.test.ts` asserted `previewSha256: previewSha256For(previewFacts)` in `inbox/page.tsx`. The builder moved to `components/lead-job-sheet.ts` by design.
- The pin now asserts the expression in the builder and `readLeadJobSheets(` in the inbox, with a dated comment.
- **Commit:** 3c03cee

**4. [Rule 2 - Drift guard] `jobChip` and the chip colours moved into the shared helper**
- The plan says to pass `chips` "exactly as the inbox decides". The inbox's private `jobChip` would otherwise have needed a copy.
- It now lives in `lead-job-sheet.ts` beside the maps, and the inbox imports it. `leadJobChips` encodes the inbox's order and colours for `/leads`. The inbox's own JSX is unchanged.
- **Commit:** 3c03cee

**5. Choices that keep the plan's semantics**
- The close action's `authorize` denies with `BAD_REQUEST_MESSAGE`, not the queue's `UNKNOWN_QUOTE_MESSAGE`. This is the plan's wording: there is no quote here.
- The `leads-page` "builder inside the one try" pin anchors on the try that precedes `listOpenLeadsForQueue(`, because `callerLabelOf` has its own `try`.
- The confidence-suffix map was copied into the page; see decisions.

### Not deviations, recorded for the record

- `src/proxy.ts` did not move. Its pin passes with the matcher as is.
- `tests/console-error-leak.test.ts` is byte-identical and was not given a `NAMED_PAGES` entry (B2). Its walk scans every new `(console)` file.

## Hazards for 15-05 / 15-07

- **15-05:**
  - Import `LEAD_RESOLUTION_LABELS` (and `readLeadJobSheets` / `leadJobChips` if the log shows job state) from `src/app/(console)/components/lead-job-sheet.ts`. The inbox no longer defines them.
  - `tests/operator-authorization.test.ts` `GUARDED_PATHS` already holds the two leads files; add `clients/[id]/page.tsx` beneath them with its own dated comment.
- **15-05 / 15-06:** The Task 2 expansion (`3c03cee`: the shared helper, the inbox refactor, the `DraftCard` `anchorId`, the queue-card import) has not yet been through CI. The plan requires no push for Task 2. The next phase CI gate is its first run.
  - The DB suites that read these files by source are `approval-queue`, `lead-reply` and `pipeline-grouping`. They were checked by reading their assertions.
- **15-06:** The digest's overdue line must call `countOverdueOpenLeads`, the SQL twin of `leadDeadlineTier`. Do not add a third predicate.
- **15-07:** `leads.pseudonymise`, `missedCalls.pseudonymise` / `listRawForLead` and both due-reads are still un-run against Postgres. This gate ran only 15-03's read suites. `callerLabelOf` on `/leads` renders `—` if a hash ever reached an open lead's `contact_mobile`, which it cannot by construction.
- **Local:** suites that build the server env still need the CI dummy pepper inline.

## Known Stubs

None. Every card field is read from real rows. With no leads in production, the UAT phone sees the empty state first; that is by design.

## Threat Flags

None beyond the plan's threat model.
- T-15-03: the gate precedes the read (source pin).
- T-15-02: `authorize` runs before `formData`; the call-count test covers it; the core re-reads under `forTenant`.
- T-15-14: the catch is discarded, the fixed sentence is in `role="alert"`, and the leak walk covers the new files.
- T-15-01: the caller number appears only in the gated card's props. The inbox gained a link, not a number.

## TDD Gate Compliance

Not a TDD plan (`type: execute`).

## Self-Check: PASSED

- Created files exist: `leads/page.tsx`, `leads/lead-card.tsx`, `leads/actions.ts`, `core/leads/queue-deadline.ts`, `components/lead-job-sheet.ts`, `tests/queue-deadline.test.ts`, `tests/leads-page.test.ts`, `tests/lead-close-action.test.ts`.
- Commits exist: ad2ed45, 61de38f, 3c03cee.
- CI run 38375020788 concluded `success` on 61de38f, and the branch is deleted.
