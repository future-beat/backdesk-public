---
phase: 06-review-console-escalation
plan: 02
subsystem: cadence
tags: [aging, alerting, cron, console, badge, closed-vocabulary, build-fix]
status: complete

requires:
  - "cadence_touches.stall_alerted_at + APPROVAL_QUEUE_STATUSES (06-01, migration 0032)"
  - "operator-email.ts three header rules + consoleBaseUrl/formatAlertTimestamp (02-04)"
  - "forAllTenants_* keyed-accessor conventions and the four-bearers rule (04-01)"
provides:
  - "src/core/aging/stall-policy.ts — STALL_THRESHOLD_HOURS, STALLABLE_TOUCH_STATUSES, isStalled, selectStalled, deriveUrgency, URGENCY_LABELS, stallBoundary"
  - "src/core/alerts/stalled-drafts.ts — buildStalledAlert, buildDailyDigest, DigestSection seam, sendStalledDraftAlert, sendDailyDigest, resend/noop senders"
  - "src/core/aging/stalled-digest.ts — runStalledDigest with an injected sender"
  - "forAllTenants_claimNewlyStalled + forAllTenants_stalledTally (crossings nine and ten)"
  - "/api/internal/stalled-digest on STALLED_DIGEST_SECRET; cron entry 'stalled-digest' 30 22 * * *"
  - "CadenceTickResult.touchesNewlyStalled / stallAlertSent / stallAlertFailed, enumerated in the tick route"
  - "nav Queue count badge (RLS-scoped) + client-list Drafts column"
  - "src/core/approval/limits.ts — EDITED_BODY_MAX as a leaf module (client-boundary build fix)"
affects:
  - "APPROVAL_QUEUE_STATUSES is now an alias of STALLABLE_TOUCH_STATUSES — one array in the codebase"
  - "runCadenceTick gains a sixth pass and a second composition-root seam the route must supply"
  - "06-04's digest section seam is in place; 06-05's urgency badge reads deriveUrgency"

tech-stack:
  added: []
  patterns:
    - "The guarded UPDATE's WHERE clause IS the once-only guarantee (quote_opened rule, third application)"
    - "Composition root in the ROUTE: src/core defaults its email sink to a no-op, never to Resend"
    - "Closed-vocabulary pure builders, asserted byte-verbatim rather than by toContain"
    - "One exported boundary function so `now + threshold` exists once, not four times"
    - "`import type` is erased, a value import is not — client-reachable modules import constants from leaf modules"

key-files:
  created:
    - src/core/aging/stall-policy.ts
    - src/core/aging/stalled-digest.ts
    - src/core/alerts/stalled-drafts.ts
    - src/core/approval/limits.ts
    - src/app/api/internal/stalled-digest/route.ts
    - tests/stall-policy.test.ts
    - tests/stalled-drafts.test.ts
    - tests/stall-tick.test.ts
  modified:
    - src/app/(console)/layout.tsx
    - src/app/(console)/page.tsx
    - src/app/(console)/components/action-state.ts
    - src/app/api/internal/cadence-tick/route.ts
    - src/core/cadence/run-tick.ts
    - src/core/approval/approve-draft.ts
    - src/core/shared/env.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - scripts/apply-cron-schedules.mjs
    - docs/env-vars.md
    - .github/workflows/ci.yml
    - tests/cadence-tick-route.test.ts
    - tests/cron-schedules.test.ts
    - tests/lint-ban.test.ts
    - tests/helpers/env.ts
    - tests/clicksend-dlr-route.test.ts
    - tests/clicksend-inbound-route.test.ts
    - tests/unsubscribe.test.ts

decisions:
  - "APPROVAL_QUEUE_STATUSES is now `= STALLABLE_TOUCH_STATUSES`, an alias rather than a second literal — 06-01 asked the next plan not to re-spell the rule, and an alias makes that structural instead of advisory"
  - "The stall predicate takes a status and a slot and CANNOT be given a draft — the 05-04 no-draft-row touch is exactly what CON-04 exists to catch, so the signature is the mitigation"
  - "Both threshold comparisons are inclusive and `overdue` is tested before `due_soon`, so a slot exactly at now reads as the more urgent tier — decided once here rather than three times at three call sites"
  - "The daily digest deliberately does NOT filter on stall_alerted_at: every touch in it has already been alerted about, so that filter would mail an empty digest every morning while the queue grew"
  - "An EMPTY digest is not sent; `digestSkippedEmpty: 1` in the 200 body is the liveness proof instead, because a daily all-clear that is right 95% of the time is the same trained blindness the nav badge hides its zero for"
  - "The stall-alert email is NOT retried on failure — the claim already happened, and un-claiming would convert a mail outage into an alert storm; `stallAlertFailed` is how the lost email stays visible"
  - "src/core defaults its email sink to a no-op that reports not_configured; the ROUTES inject the real Resend sender — the StubSender composition-root split, because the tick is reachable from every remote suite"
  - "stallBoundary() is exported so `now + STALL_THRESHOLD_HOURS` is computed in exactly one place across the tick, the digest, the nav badge and the Drafts column"
  - "The nav badge reads through the caller's OWN JWT, never service-role: the layout gates on getClaims(), so a service-role count would print a cross-tenant number to a future non-operator session"
  - "The aging accessors DO join `tenants` where the queue accessor refuses to — the difference is the consumer (a tick and a cron route, service-role by construction, rendering nothing) not the convenience"

metrics:
  duration: ~45 min
  completed: 2026-09-01
  tasks: 3
  files: 27
  commits: 3

actuals:
  tokens: 35300
  tasks: 3
  commits: 3
---

# Phase 6 Plan 02: Stall Policy, Alerting and the Two Count Surfaces Summary

CON-04 is real: one pure predicate decides what "stalled" means, a guarded UPDATE
claims each crossing exactly once, a closed-vocabulary email tells the operator, a
06:30 digest rolls up whatever is left, and the same derivation colours the nav badge
and the client-list Drafts column — including for touches that have no draft row at all.

## What Was Built

**One derivation (`src/core/aging/stall-policy.ts`).** Framework-free and, as asserted,
importing *nothing at all*. `STALL_THRESHOLD_HOURS = 4` is the only threshold in the
system; `isStalled` takes a status and a slot and **cannot be given a draft**, which is
the D-09 backstop expressed as a signature rather than as a promise. 05-04 decided that a
deterministic drafting failure records no `touch_drafts` row, so a stall predicate joined
to drafts would be blind to precisely the touches most worth alerting about.

`deriveUrgency` implements the 06-UI-SPEC tier table against the SAME boundary helper, so
the queue's badge and the alert cannot disagree by construction. `stallBoundary()` is
exported for the same reason one level down: the tick, the digest, the nav badge and the
Drafts column all ask for `now + threshold` rather than each writing it.

`APPROVAL_QUEUE_STATUSES` in the repository is now `= STALLABLE_TOUCH_STATUSES`. 06-01
exported it precisely so this plan would not re-spell the rule and asked, in prose, that
it not be. An alias makes that structural: there is one array literal in the codebase.

**The alert module (`src/core/alerts/stalled-drafts.ts`).** A SIBLING of
`operator-email.ts`, not an extension — widening `OperatorAlertKind` would make its typed
`SyncOutcome` detail a union of two unrelated vocabularies. Its three header rules are
copied verbatim because they are rules, not style. The builders are pure, exported, and
asserted **byte-verbatim** against fixed fixtures: a `toContain` suite passes cheerfully
on a body that grew a fifth line naming a customer, which is the regression the assertion
style exists to catch. `buildDailyDigest` takes an ordered list of caller-built
`DigestSection`s — the seam 06-04 appends its attestation-staleness line through.

**The claim (`forAllTenants_claimNewlyStalled`).** The ninth crossing and the only one in
that file that WRITES across tenants. Its `stall_alerted_at IS NULL … RETURNING` is the
once-only guarantee — the `quote_opened` rule's third application — and it writes one
column: no status, no skip reason, no slot. Aging observes; the D-09/D-10 re-window pass
remains the only schedule authority. The remote suite proves the dedupe at the database:
the second claim returns zero of ours, with nothing about the caller changed.

**The tick's sixth pass.** After classification, because it sends mail and nothing above
it reads `stall_alerted_at`. Three counts split by the 05-04 rule — one field per
different thing to do — ride the tick route enumerated one by one, never spread.
`stallAlertFailed` is the only record that an operator was owed an email they did not get,
since the claim is never undone: un-claiming on a send failure would convert a mail outage
into an alert storm at exactly the wrong moment.

**The digest and its route.** `/api/internal/stalled-digest` on `STALLED_DIGEST_SECRET`,
the sixth bearer. Sharing the cadence tick's would mean rotating that secret also silences
the digest that says drafts are piling up — the two failures compounding when somebody
needs the second to notice the first. The route is `api/`-excluded, bearer-checked in
constant time, 401s without body detail, and returns five enumerated integers.

**The two count surfaces.** The nav badge is an RLS-scoped head count through the caller's
own JWT — the layout gates on `getClaims()`, so a service-role read there would print a
cross-tenant number in the chrome of every page the day a v2 client login ships. It hides
at zero and hides on a read failure, and the layout never breaks over a number. The Drafts
column is one round trip for the whole table selecting two columns, neither of them
customer content, with an em dash at zero.

## Key Implementation Decisions

**The digest does not filter on `stall_alerted_at`, and that is the design.** Every touch
in the roll-up has already been alerted about individually — that is what makes it *still*
stalled rather than *newly* stalled. Filtering on "not yet alerted" would produce an empty
digest every single morning while the queue quietly grew, which is the exact failure a
roll-up exists to prevent. Both the accessor's header and the builder's argue it from
their own ends.

**An empty digest is not sent.** A daily all-clear that is right 95% of the time trains
the same blindness the nav badge hides its zero for. But an absent email is
indistinguishable from a broken cron, so the liveness proof moved somewhere a cron can
see it: `digestSkippedEmpty: 1` in the 200 body `net._http_response` records each morning.
The builder still renders the honest zero, and a caller that wants it can ask.

**`src/core` defaults its email sink to a no-op; the routes inject Resend.** This is the
`TouchSender`/`StubSender` split, and the argument is sharper here: `runCadenceTick` is
reachable from a script and from every remote suite in this repository, all of which run
against the hosted Sydney database. A real Resend default inside `src/core` would mean
`npm run test:remote` mails the operator about seeded rows. The no-op reports
`not_configured` rather than `ok`, so a caller that forgets lands in `stallAlertFailed`
instead of in a silent success — which matters because the touch has already been claimed
by then and will never be claimed again.

**The aging accessors join `tenants`; the queue accessor still refuses to.** That looks
like an inconsistency and is not. The queue feeds a PAGE, which must learn a client's name
only from the operator's own JWT under RLS. These feed the tick and a cron route:
service-role by construction, rendering nothing, and the name they read goes into an email
addressed to the operator alone. Their whole return surface is ids, client names and
integers — which is what makes the alert vocabulary closable at all.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocking] `next build` failed outright, from 06-01**

- **Found during:** Task 3, running a production build to check the layout change.
- **Issue:** Four `Module not found` errors — `fs`, `net`, `tls`, `perf_hooks`. The chain:
  `draft-card.tsx` is a `'use client'` component; it imports
  `components/action-state.ts` (06-01's shared copy module); that imported
  `EDITED_BODY_MAX` — **a value** — from `@/core/approval/approve-draft`, which imports
  `@/db/repository`, which imports the `postgres` driver. `import type` is erased at build
  time and a value import is not, and that asymmetry is invisible in the source, invisible
  to `tsc`, and invisible to `npm test`. Nothing in the plan's verification (`npm test`,
  `tsc`, `lint`) runs a build, so it had shipped green.
- **Why fixed here rather than deferred:** it blocks every deploy, and therefore blocks
  this plan's own cron-activation step and the whole phase's ability to ship.
- **Fix:** `EDITED_BODY_MAX` moved to `src/core/approval/limits.ts`, a leaf module that
  imports nothing; `approve-draft.ts` re-exports it so **no server-side import path
  changed**; `components/action-state.ts` now takes `ApprovalResult` as a type-only import
  and the constant from the leaf. `tests/lint-ban.test.ts` gained a standing guard that
  parses value-vs-type imports for the client-reachable console modules — a one-time fix is
  not a guard, and the next person who needs one constant from a module that talks to
  Postgres will trip it in `npm test` rather than in a deploy log.
- **Files:** `src/core/approval/limits.ts` (new), `src/core/approval/approve-draft.ts`,
  `src/app/(console)/components/action-state.ts`, `tests/lint-ban.test.ts`
- **Commit:** 58307c9. Build now green, `/api/internal/stalled-digest` included.

### Deliberate additions beyond the plan's file list

**2. [Rule 2] `src/core/aging/stalled-digest.ts`**

The plan put the digest in the route. A Next route file may export only its handlers and
segment config, so a digest written there could be exercised in exactly one way: by
constructing a `Request`, holding a real bearer, and letting it mail somebody — which
contradicts the plan's own acceptance criterion ("invoke the handler directly with an
injected sender seam — zero real emails"). The orchestration moved to `src/core/aging/`,
where it takes an injected sender and a pinned clock.

**3. [Rule 2] `noopStalledEmailSender` and the composition-root split**

Not in the plan. Without it, every existing remote suite that runs a full tick
(`cadence-tick`, `cadence-dispatch`, `cadence-tick-isolation`, `cadence-completion-sweep`,
…) would have mailed the operator on the next `npm run test:remote`. See Key Decisions.

**4. [Rule 2] `stallBoundary()` exported**

The plan had four call sites each computing `now + STALL_THRESHOLD_HOURS * MS_PER_HOUR`.
Four copies of one arithmetic expression is the same defect as four copies of the
predicate, one level down — they agree until somebody changes the threshold and finds
three of them.

### Pinned-list edits the project requires

`tests/lint-ban.test.ts` pins the repository barrel exhaustively (two new accessors, with
the argument for the write-across-tenants crossing written beside them);
`tests/helpers/env.ts`, `.github/workflows/ci.yml` and `docs/env-vars.md` take the sixth
bearer per the documented keep-in-sync rule; `tests/cron-schedules.test.ts` gains
`stalled-digest` in `MANAGED_JOBS` — **load-bearing**, because that list is what snapshots
and restores production schedules, and a fourth job the script writes but the suite does
not know about is a live schedule left pointing at `example.invalid`.

## Verification

| Gate | Result |
|------|--------|
| `npm run test:remote -- tests/stall-tick.test.ts` | **24/24 passed** (hosted Sydney DB, cron ticks leased-paused) |
| `npm run test:remote -- tests/cron-schedules.test.ts` | **29/29 passed**; catalog snapshot restored, verified by direct read |
| `npm test` | **1665 passed** (1620 at plan start, 1661 before the build-fix guard); 33 files remote-gated as designed (32 + the new suite) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run build` | **green** — was failing before this plan (see Deviation 1); `/api/internal/stalled-digest` present in the route manifest |
| Migration | **none generated** — 0032 remains the phase's single journal entry, per 06-01's instruction |

### Production cron catalog, after the runs

```
cadence-tick               * * * * *      active=true
cron-details-cleanup       30 3 * * 0     active=true
messaging-reconcile        30 19 * * *    active=true
prospect-line-purge        15 3 * * *     active=true
prospect-staging-sweep     20 * * * *     active=true
sm8-sync-tick              */5 * * * *    active=true
```

No `stalled-digest` job, deliberately — see the obligation below. One remote run's teardown
hit a transient DNS failure and left both ticks paused; the sanctioned repair path (the
lease's adoption branch in `tests/helpers/global-setup.ts`) re-armed them on the next run,
and the state above is a direct read afterwards.

## OPERATOR OBLIGATIONS — two, and the first blocks `npm test`

**1. `STALLED_DIGEST_SECRET` must be added to `.env.local` and `.env.example`.**

This executor is permission-blocked from `.env*` files and could not write them. The
variable is a **REQUIRED** member of `serverEnvSchema` (like all five bearers before it),
so **until it is present, every suite that reaches `getServerEnv()` fails**. Every
verification above was run with the value injected into the command's environment; CI
already has its dummy (`ci.yml`), and `docs/env-vars.md` documents it.

```bash
# a value of the shape every other bearer uses
openssl rand -hex 32
# then add to BOTH files:
#   .env.local      STALLED_DIGEST_SECRET=<that value>
#   .env.example    STALLED_DIGEST_SECRET=hex-32-bytes      (placeholder only)
```

**2. The `stalled-digest` cron is NOT applied, and must not be until the route is deployed.**

The Phase 3 activation standard could not complete inside this run (no deploy). Applying
the schedule against an undeployed route produces a nightly 404 that reads green in
`cron.job_run_details` — the 04-04 precedent the plan names. The remaining sequence,
verbatim:

```bash
# 1. STALLED_DIGEST_SECRET in .env.local first (obligation 1)
git push origin main                       # Vercel deploys from main
npm run env:push                           # pushes the new secret to Vercel
# 2. wait for the deploy, then prove the route is live AND its env parses:
curl -i -X POST https://<prod-host>/api/internal/stalled-digest \
  -H 'authorization: Bearer wrong-token'   # EXPECT 401, not 404 and not 500
# 3. only then:
npm run cron:apply
# 4. verify the FIRST real invocation, not a green cron.job_run_details row:
#    SELECT status_code, created FROM net._http_response ORDER BY id DESC LIMIT 5;
#    EXPECT a 200 from the 22:30 UTC run.
```

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-6-05 Information disclosure — alert/digest emails as exfil channel | Pure exported builders whose entire parameter surface is a client name, an integer, the threshold, a timestamp and a URL; bodies asserted BYTE-VERBATIM on fixed fixtures plus a forbidden-string sweep and a `\d{6,}` guard; the same closure asserted on a body built from REAL seeded rows in the remote suite (a job description present in the database does not appear in the email). The accessors that feed it can return nothing else — ids, names and integers. |
| T-6-06 Elevation — digest route invoked without auth | Its own bearer `STALLED_DIGEST_SECRET` (the sixth); `timingSafeEqual` with the length pre-check; 401 with a body that cannot distinguish "wrong secret" from "no secret"; asserted to read none of the other five, and the other five's suites assert they do not read this one. |
| T-6-07 Information disclosure — nav badge leaking cross-tenant counts | The count flows through `createClient()` (caller's own JWT) — source-asserted that the layout builds no service-role client, names no `getDb`, and imports no `forAllTenants`. A5 (the operator is a member of every tenant) is now PROVEN on real rows rather than assumed: the RLS-scoped count equals the service-role count over the same predicate, and the stalled subset agrees too. |
| T-6-08 Denial of service (trust) — alert storms training blindness | The guarded UPDATE with RETURNING, proven at the database by a named second-claim-returns-zero test; one covering email per tick rather than one per client; the daily digest as the only roll-up; no retry, and no hourly re-alert. |

## Prohibitions Honoured

- **No customer content in an email.** Asserted verbatim on fixtures and on a real body.
- **The aging pass changes no touch's status and moves no cadence.** Asserted on a real
  overdue row after a claim: status unchanged, `skip_reason` still NULL, slot untouched.
- **No repeats.** One alert per touch per threshold crossing, enforced by the WHERE clause.
- **No migration.** `git diff` touches no file under `src/db/migrations/`.
- **No packages installed.** `git diff` touches no manifest.

## Known Stubs

None from this plan. Two things are deliberately scoped elsewhere:

- The **queue card's urgency badge** consumes `deriveUrgency`/`URGENCY_LABELS`, which ship
  here unused by any card — 06-05 renders them. Exported-and-unused is honest forward
  declaration in the same sense `operator_skipped` was in 06-01: the derivation exists so
  the badge cannot invent a second one.
- The **digest's section seam** (`DigestSection`) is exercised by a test and by no
  production caller until 06-04 appends the attestation-staleness line.

## Requirement Status

**CON-04 is complete and is marked here** — this is the only plan claiming it. Stalls are
defined once, claimed once, alerted once, digested daily, and visible persistently on the
nav and the client list, including for touches with no draft row. The cron activation is an
OPERATIONS obligation recorded above, not an unbuilt requirement: the route, its bearer,
its schedule entry and its tests all exist and are proven.

## Notes for Next Plans

- `deriveUrgency` + `URGENCY_LABELS` are ready for 06-05's queue card and pipeline; do not
  write a second tier function.
- 06-04 appends to the digest through `sections`, not by widening `buildDailyDigest`'s
  parameters. Each section brings its own closed vocabulary and its own assertion.
- Anything that runs `runCadenceTick` outside a route must decide about `stallAlertSender`.
  The default is the no-op, so forgetting is visible as `stallAlertFailed`, not silent.
- The client-boundary guard in `tests/lint-ban.test.ts` covers two files by name. A third
  shared component under `(console)/components/` should be added to that list.
- **The remote suite claims `stall_alerted_at` on any stalled touch present at the time**,
  cross-tenant by design. That column is an alert dedupe and nothing else, and the deployed
  ticks are leased-paused during a run — but once a real client exists, a remote run
  suppresses one alert cycle for them. Stated so it is a known property rather than a
  discovery.

## Self-Check: PASSED

Files asserted present:

```
FOUND: src/core/aging/stall-policy.ts
FOUND: src/core/aging/stalled-digest.ts
FOUND: src/core/alerts/stalled-drafts.ts
FOUND: src/core/approval/limits.ts
FOUND: src/app/api/internal/stalled-digest/route.ts
FOUND: tests/stall-policy.test.ts
FOUND: tests/stalled-drafts.test.ts
FOUND: tests/stall-tick.test.ts
```

Commits asserted present: `2853a41`, `ea97f94`, `58307c9`.
