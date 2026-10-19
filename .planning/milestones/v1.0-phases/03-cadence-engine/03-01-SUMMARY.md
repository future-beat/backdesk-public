---
phase: 03-cadence-engine
plan: 01
subsystem: database
tags: [drizzle, postgres, supabase, rls, migrations, cadence, send-ledger, suppression]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: tenancy schema, has_tenant_access RLS helper, forTenant() scoped repository, the RLS triple pattern (pgPolicy + explicit grants + rls-coverage assertions)
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: quotes mirror with chase_eligibility, quote_status_events transactional outbox + event_consumer_cursors, sm8_connections.paused_at, forAllTenants_* cross-tenant convention
provides:
  - Six migrated tenant-scoped tables — cadence_touch_templates, cadence_settings, cadences, cadence_touches, send_ledger, suppressed_contacts — each behind the full RLS triple
  - cadences_one_live_per_quote (partial unique on status IN ('active','paused')) — replay-safe cadence creation
  - send_ledger_cadence_touch_uniq (CAD-04) — the structural never-twice for sends
  - Closed vocabularies as exported consts + CHECK constraints — CADENCE_STATUSES, CADENCE_PAUSE_REASONS, CADENCE_STOP_REASONS, TOUCH_STATUSES, TOUCH_SKIP_REASONS, TOUCH_CHANNELS, SEND_LEDGER_OUTCOMES, SUPPRESSION_CHANNELS
  - Six forTenant() namespaces (templates, settings, cadences, touches, ledger, suppression) plus quotes.flagNeedsReviewOnReopen
  - forAllTenants_cadenceTick and forAllTenants_pendingQuoteEvents
  - Test seeders for all six tables and a teardown order that honours the deliberate no-cascade design
affects: [03-02 tracer tick, 03-03 transitions and event consumption, 03-04 rewindow and dispatch, 03-05 operator controls, 03-06 tick route, 04-messaging, 05-drafting, 06-approval-console, 07-reporting]

actuals:
  tokens: 52621
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Partial unique index as the replay guard: ON CONFLICT (quote_id) WHERE status IN ('active','paused') DO NOTHING RETURNING — zero rows is an answer, not a failure"
    - "Claim-before-send: insert the ledger row first; a conflict means another process owns the touch and this one refuses silently"
    - "Guarded transitions as WHERE clauses that include the expected reason, not just the expected status"
    - "Nullable outcome column meaning 'we do not know', never defaulted to a definite answer"
    - "Irreversibility enforced at three layers: schema header, absent repository mutator, absent GRANT"

key-files:
  created:
    - src/db/schema/cadence-templates.ts
    - src/db/schema/cadence-settings.ts
    - src/db/schema/cadences.ts
    - src/db/schema/cadence-touches.ts
    - src/db/schema/send-ledger.ts
    - src/db/schema/suppressed-contacts.ts
    - src/db/migrations/0016_cadence_tables.sql
    - src/db/migrations/0017_cadence_grants_and_constraints.sql
    - tests/cadence-repository.test.ts
  modified:
    - src/db/schema/index.ts
    - src/db/repository/for-tenant.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/db/migrations/meta/_journal.json
    - tests/rls-coverage.test.ts
    - tests/leak.test.ts
    - tests/helpers/seed.ts
    - tests/lint-ban.test.ts
    - tests/sync-upsert.test.ts

key-decisions:
  - "send_ledger.outcome is NULLABLE and NULL means 'claimed, outcome unknown' — a 'failed' default would reclassify an unknown as a definite non-delivery, and the obvious response to a definite non-delivery is a retry, which is how a customer gets messaged twice"
  - "All six tables are READ-ONLY to authenticated; every D-16 control is a service-role server action because each is a multi-table transaction (stop the cadence AND skip its touches AND write suppression) that a direct console UPDATE would perform one third of"
  - "suppressed_contacts holds no INSERT/UPDATE/DELETE grant for authenticated — the D-06 irreversibility is enforced at the grant layer, not merely documented"
  - "cadence_touch_templates and cadence_settings DO cascade from tenants (configuration); cadences, cadence_touches, send_ledger and suppressed_contacts deliberately do not (attribution evidence and the Spam Act record)"
  - "PROMOTABLE_TOUCH_STATUSES accepts all three pre-terminal states so Phase 3's auto-passed D-14 gates become real gates in Phases 5/6 by editing one method, not the vocabulary"
  - "TERMINAL_TOUCH_STATUSES is written as the complement of ('sent','skipped') so a status added later defaults to live — a new status wrongly treated as terminal makes touches silently unreachable"
  - "forAllTenants_cadenceTick deliberately does NOT filter on paused_at (unlike forAllTenants_syncTick): event consumption must run for paused tenants so won/lost/removed still stop cadences, while dispatch checks both pause flags itself"
  - "The cross-tenant tripwire in sync-upsert.test.ts was rewritten from a substring ban to an import-list assertion plus a one-read-never-joined rule, because the substring ban stopped meaning anything once the header prose had to name the tables it excludes"

patterns-established:
  - "Vocabulary CHECK constraints admit NULL explicitly (`x IS NULL OR x IN (...)`) rather than relying on three-valued logic being remembered"
  - "Cross-tenant reachability is asserted via the schema import block, which is the file's true query surface"
  - "Repository methods that can legitimately affect zero rows return the RETURNING set, and callers branch on it"

# Copied verbatim from this plan's `requirements` frontmatter. NOTE: neither ID
# is checked off in REQUIREMENTS.md yet — both are also declared by sibling
# plans in this phase (CAD-01 by 03-02/03/06/07, CAD-04 by 03-02/04) that have
# no SUMMARY yet, so the shared-ID gate holds them Pending until the last
# declaring plan finishes. This plan delivered its share of both.
requirements-completed: [CAD-01, CAD-04]

coverage:
  - id: D1
    description: "Six cadence tables exist in the migrated Sydney database with RLS enabled, a has_tenant_access policy, and exactly the documented grants (anon SELECT, authenticated SELECT, service_role ALL)"
    requirement: "CAD-04"
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#grants exactly the documented privileges and nothing inherited (WR-04)"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#found the tables it was meant to check — an empty schema would pass vacuously"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#has row-level security enabled on every table in the public schema"
        status: pass
    human_judgment: false
  - id: D2
    description: "The CAD-04 never-twice index and the one-live-cadence-per-quote partial unique index exist in the migrated database, and the second is partial on the live statuses"
    requirement: "CAD-04"
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#enforces never-twice and one-live-per-quote in the database (CAD-04, CAD-01)"
        status: pass
      - kind: integration
        ref: "tests/cadence-repository.test.ts#runs every cadence namespace, and refuses where it must (second insertClaim returns [], replayed create returns [])"
        status: pass
    human_judgment: false
  - id: D3
    description: "suppressed_contacts is insert-only from the console role: no INSERT, UPDATE or DELETE grant, and a delete attempt changes nothing (D-06/D-15, T-3-02)"
    requirement: "CAD-04"
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#holds no write grant of any kind on suppressed_contacts (T-3-02)"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#cannot un-suppress a contact, its own or anyone else's (T-3-02)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The six cadence tables are tenant-isolated: an operator sees their own client's cadences, touches, ledger and suppression list and never another client's, and an unauthenticated read returns [] rather than 42501"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/leak.test.ts#shows the operator tenant A's cadences and never tenant B's"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#shows the operator tenant A's touches, ledger and suppression list only"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#returns an empty array — not an error — for tenant B's cadence data"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#returns nothing at all to a caller with no session"
        status: pass
    human_judgment: false
  - id: D5
    description: "Closed vocabularies are mirrored as CHECK constraints in the database, so a typo written by the service-role worker is refused rather than producing a row no predicate matches"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#constrains the cadence vocabularies (WR-03, D-14)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Six forTenant() namespaces plus quotes.flagNeedsReviewOnReopen execute against the real database, with the guarded writes refusing where they must — replayed create, second ledger claim, wrong-reason resume, replayed stop"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-repository.test.ts#runs every cadence namespace, and refuses where it must"
        status: pass
      - kind: other
        ref: "npm run typecheck && npm run lint (--max-warnings=0)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Cross-tenant access is exactly four named exports, none accepting a tenantId, with the outbox read confined to one never-joined query"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/sync-upsert.test.ts#keeps the cross-tenant surface to exactly four named exports"
        status: pass
      - kind: integration
        ref: "tests/sync-upsert.test.ts#reaches exactly five tables from the cross-tenant file, and no more"
        status: pass
      - kind: integration
        ref: "tests/lint-ban.test.ts#the repository barrel does not re-export the raw client"
        status: pass
      - kind: integration
        ref: "tests/cadence-repository.test.ts (forAllTenants_cadenceTick returns window metadata and both pause flags; forAllTenants_pendingQuoteEvents honours the limit)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Test seeders exist for all six tables and teardown removes the rows that deliberately do not cascade"
    verification:
      - kind: integration
        ref: "npm run test:remote (36 files, 687 tests — teardown leaves no cadence rows behind across the full suite)"
        status: pass
    human_judgment: false

# Metrics
duration: 31 min
completed: 2026-08-27
status: complete
---

# Phase 3 Plan 01: Cadence Persistence Skeleton Summary

**Six RLS-scoped cadence tables live in the hosted Sydney database with duplicate sends made structurally impossible by a Postgres unique index rather than by application-code promises, plus the scoped repository namespaces every later plan in this phase reads and writes through.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-08-27T11:19:00Z
- **Completed:** 2026-08-27T11:50:30Z
- **Tasks:** 2
- **Files modified:** 20 (9 created, 11 modified)

## Accomplishments

- **The enforcement surface for every structural "never" in this phase's goal exists and is asserted against the migrated database.** `send_ledger_cadence_touch_uniq` makes a second claim on the same touch return zero rows; `cadences_one_live_per_quote` makes a replayed `quote_opened` refuse instead of starting a second parallel chase. Both are verified by reading `pg_indexes` on the real database, not by trusting the schema file that was meant to produce them.
- **Six tables shipped behind the complete RLS triple** — `pgPolicy` in the schema, explicit REVOKE-then-GRANT in migration 0017, and exact-grant assertions in `tests/rls-coverage.test.ts`. All six are read-only to `authenticated`, and `suppressed_contacts` holds no write grant at all, which turns D-06's "un-suppressing a complained contact must be impossible" from a convention into a missing privilege.
- **The D-14 status vocabularies are locked in code and in the database.** Exported `as const` arrays for TypeScript, CHECK constraints for the service-role worker that TypeScript cannot protect. The two gates Phase 3 auto-passes (`needs_draft`, `pending_approval`) ship in the vocabulary now, so Phases 5 and 6 replace one method rather than migrating live cadences.
- **Six repository namespaces where every write is a guarded UPDATE returning what Postgres actually changed**, including the D-05/D-06 asymmetry expressed as a WHERE clause: a client un-pause matches on `pause_reason = 'client_paused'`, so it cannot lift a pause that exists because the customer wrote back.
- **A real-database suite that immediately earned its place** — it caught `promoteDue` binding a raw `Date` through a `sql` template, a driver-level failure that `typecheck` and `lint` (the plan's stated verification for that task) both passed cleanly.

## Task Commits

1. **Task 1: Six cadence tables, generated + grants migrations, RLS triple enumeration** — `a6482dd` (feat)
2. **Task 2: Repository namespaces, cross-tenant tick accessors, and test seeders** — `d0db88b` (feat)

## Files Created/Modified

### Schema
- `src/db/schema/cadence-templates.ts` — D-02 per-tenant touch timing; snapshot semantics documented (editing a template never reshapes a live schedule)
- `src/db/schema/cadence-settings.ts` — D-03 preferred send time + D-06 reversible per-client pause, with a header spelling out why this pause and `sm8_connections.paused_at` must never be conflated
- `src/db/schema/cadences.ts` — the cadence row, the partial unique index, and the three closed vocabularies; contact snapshot rationale (D-04)
- `src/db/schema/cadence-touches.ts` — the materialized schedule, `original_offset_days` as D-07's relative-gap basis, full D-14 lifecycle vocabulary
- `src/db/schema/send-ledger.ts` — CAD-04's never-twice index and the nullable-outcome argument
- `src/db/schema/suppressed-contacts.ts` — insert-only by design, keyed on the normalized address so a suppressed human is blocked on NEW jobs too
- `src/db/schema/index.ts` — barrel re-exports so drizzle-kit sees the six tables

### Migrations
- `src/db/migrations/0016_cadence_tables.sql` — generated, renamed from its codename, hand-stamped in the journal
- `src/db/migrations/0017_cadence_grants_and_constraints.sql` — per-table REVOKE-then-GRANT with the reasoning for each role's privileges, plus nine CHECK constraints
- `src/db/migrations/meta/_journal.json` — 0016 re-tagged and re-stamped; 0017 stamped by hand

### Repository
- `src/db/repository/for-tenant.ts` — six new namespaces, `quotes.flagNeedsReviewOnReopen`, and the shared status-set constants
- `src/db/repository/for-all-tenants.ts` — `forAllTenants_cadenceTick`, `forAllTenants_pendingQuoteEvents`, and an expanded header justifying both crossings
- `src/db/repository/index.ts` — barrel exports for the new accessors and types

### Tests
- `tests/cadence-repository.test.ts` (new) — every namespace exercised against the real database, refusals included
- `tests/rls-coverage.test.ts` — six tables in the presence list and the exact-grants map; new assertions for the two indexes, the cadence CHECK vocabularies, and the absence of any write grant on `suppressed_contacts`
- `tests/leak.test.ts` — two-tenant isolation extended to all six tables, including "cannot write to any cadence table at all" and "cannot un-suppress a contact"
- `tests/helpers/seed.ts` — `seedTouchTemplates`, `seedCadenceSettings`, `seedCadence`, `seedTouches`, `seedSuppression`, and a teardown order for the tables that deliberately do not cascade
- `tests/lint-ban.test.ts` — barrel export list updated with the two new cross-tenant accessors
- `tests/sync-upsert.test.ts` — the two cross-tenant tripwires updated deliberately

## Decisions Made

Recorded in `key-decisions` above. The three worth reading in full are:

1. **`send_ledger.outcome` is nullable, and NULL is load-bearing.** The row is written before the sender is invoked, so a crash in between leaves a row meaning "we do not know whether this went out". A `NOT NULL DEFAULT 'failed'` would silently convert that unknown into a definite non-delivery — and the obvious operational response to a definite non-delivery is a retry, which is precisely how a customer receives the same follow-up twice. The honest NULL is surfaced to the operator and never auto-resent.

2. **`forAllTenants_cadenceTick` does not filter on `paused_at`, unlike its sync-tick sibling.** The sync tick's job is to talk to ServiceM8, so a dead key means skip. The cadence tick's job splits: event consumption must run for every tenant (the outbox holds `won`/`lost`/`removed` events that STOP cadences, and skipping a paused tenant would leave a cadence chasing a job won a week ago, with the backlog landing all at once on resume), while dispatch must not. Both pause flags travel with the row and the tick decides per phase.

3. **Every one of the six tables is read-only to `authenticated`.** `quotes` earns its UPDATE because `chase_eligibility` holds a human decision made directly in the console. Not one column here is like that: the D-16 kill/pause/resume controls are each a multi-table transaction, and a direct console UPDATE would perform one third of one — a "stopped" cadence whose touches are still scheduled, or a suppressed contact whose live cadence keeps sending.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `promoteDue` bound a raw `Date` through a `sql` template and failed at the driver**
- **Found during:** Task 2
- **Issue:** `sql\`${cadenceTouches.scheduledAt} <= ${dueBefore}\`` compiles and lints cleanly but throws at Bind time: `TypeError: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`. A raw `Date` interpolated into a `sql` template is bound as an untyped parameter and never passes through the column's timestamptz mapper. The plan's stated verification for this task was `typecheck && lint`, both of which passed while the method was completely non-functional — the first caller would have been a Wave-2 plan.
- **Fix:** Replaced with the `lte(cadenceTouches.scheduledAt, dueBefore)` operator helper, which routes the value through the column mapper. Comment added at the site explaining that nothing in the type system distinguishes the two forms.
- **Files modified:** `src/db/repository/for-tenant.ts`
- **Verification:** `tests/cadence-repository.test.ts` — `promoteDue` now promotes exactly the due touch and leaves the future one alone
- **Committed in:** `d0db88b`

**2. [Rule 2 - Missing Critical] Added `tests/cadence-repository.test.ts` as a permanent suite**
- **Found during:** Task 2
- **Issue:** The plan verified Task 2 with `typecheck && lint` only. Deviation 1 proves that insufficient: the queries in this layer are hand-written for their SQL semantics, and three of them are product guarantees expressed entirely in SQL (the partial-index `ON CONFLICT` inference, the ledger claim's zero-row refusal, the resume reason guard). None is observable to the type checker.
- **Fix:** Wrote the suite as a throwaway smoke check, then kept it. It exercises every namespace against the real database and asserts the REFUSALS as much as the successes — replayed create returns `[]`, a second ledger claim returns `[]`, a client un-pause does not lift a `customer_reply` pause, a replayed stop does not overwrite the stop reason.
- **Files modified:** `tests/cadence-repository.test.ts` (new)
- **Verification:** Green against the hosted Sydney database; fixtures torn down
- **Committed in:** `d0db88b`

**3. [Rule 3 - Blocking] Two pre-existing cross-tenant tripwires in `tests/sync-upsert.test.ts` fired**
- **Found during:** Task 2
- **Issue:** `keeps the cross-tenant surface to exactly two named exports` asserted the export set was exactly `{syncTick, webhookHint}`, and `returns no tenant DATA across tenants` banned the substring `quoteStatusEvents` from `for-all-tenants.ts` outright. This plan adds two exports, one of which reads the outbox by design. Both tests are working as intended — they exist so that growing the cross-tenant surface is a decision someone types on purpose.
- **Fix:** Updated deliberately rather than relaxed. The export-set assertion now names four with a comment recording why each exists. The substring ban was replaced with something stronger: an assertion on the file's schema **import block** (its true reachability surface, and one that keeps working now that the header prose has to name the tables it excludes), plus a narrow rule for the outbox exception — read from exactly one accessor, never joined to anything, ordered by `id`.
- **Files modified:** `tests/sync-upsert.test.ts`
- **Verification:** `tests/sync-upsert.test.ts` 18/18 green; the new assertion was itself caught mis-matching a lazy regex across two import blocks and fixed
- **Committed in:** `d0db88b`

**4. [Rule 3 - Blocking] `teardownTenants` had to learn the new no-cascade tables in Task 1**
- **Found during:** Task 1
- **Issue:** `cadences`, `cadence_touches`, `send_ledger` and `suppressed_contacts` deliberately carry no FK to `tenants`, so the extended leak test would have left rows behind in the hosted database on every run — in tables nobody thinks to look at. The plan assigned `tests/helpers/seed.ts` to Task 2, but Task 1's own test could not be correct without this.
- **Fix:** Added `NO_CASCADE_TABLES` with an ordered, sequential delete (children before parents) and a header explaining why each table is on the list rather than inheriting a cascade.
- **Files modified:** `tests/helpers/seed.ts`
- **Verification:** Full remote suite green with no leftover rows
- **Committed in:** `a6482dd`

**5. [Rule 2 - Missing Critical] Extra CHECK constraint and extra index-existence assertions**
- **Found during:** Task 1
- **Issue:** The plan listed CHECK constraints for `cadence_touch_templates.channel` but not `cadence_touches.channel`, leaving one member of a closed vocabulary unconstrained in the table the sender actually reads. Separately, the plan's `must_haves` require both unique indexes to exist *in the migrated database*, but no test asserted that — a `uniqueIndex(...)` in a schema file proves only what drizzle intended, and the journal-ordering trap (which has now fired on four plans) makes "migration silently skipped" a live failure mode.
- **Fix:** Added `cadence_touches_channel_known`, and a new `rls-coverage` test that reads `pg_indexes` and asserts both indexes exist — including that `cadences_one_live_per_quote` is genuinely PARTIAL, since a full unique index would carry the same name while forbidding the legal sequential-cadence history.
- **Files modified:** `src/db/migrations/0017_cadence_grants_and_constraints.sql`, `tests/rls-coverage.test.ts`
- **Verification:** `tests/rls-coverage.test.ts` green
- **Committed in:** `a6482dd`

**6. [Rule 3 - Blocking] Plan pointed at the wrong file for the journal-monotonicity guard, and at the wrong drizzle option name**
- **Found during:** Tasks 1 and 2
- **Issue:** (a) The plan says to verify journal monotonicity with `npx vitest run tests/lint-ban.test.ts`; that guard actually lives in `tests/prospect-staging-retention.test.ts` (`describe('migration journal ordering')`). (b) The plan specifies `.onConflictDoNothing({ target, targetWhere })`; in drizzle-orm 0.45 `targetWhere` exists only on `onConflictDoUpdate` — `onConflictDoNothing` takes `{ target, where }`, and the wrong key would have silently produced an un-predicated `ON CONFLICT` that fails to infer the partial index.
- **Fix:** Ran the guard in its real location (green), and used the correct option key, confirmed by reading `node_modules/drizzle-orm/pg-core/query-builders/insert.js` rather than assuming.
- **Files modified:** `src/db/repository/for-tenant.ts`
- **Verification:** `tests/prospect-staging-retention.test.ts` green; `cadences.create` replay returns `[]` against the real database, proving the partial index was inferred
- **Committed in:** `a6482dd`, `d0db88b`

---

**Total deviations:** 6 auto-fixed (1 bug, 2 missing critical, 3 blocking)
**Impact on plan:** No scope creep. One deviation (the `Date` binding) was a genuine defect that the plan's own verification could not have caught, and the suite added to catch it is the most valuable artefact here beyond the schema itself. Two were plan-text inaccuracies about where a test lives and what a library's option is called. The rest tightened guarantees the plan's `must_haves` already asked for.

## Issues Encountered

- **The precondition could not be checked directly.** The plan's precondition names `MIGRATE_DATABASE_URL` in `.env.local`, but this workspace has a standing deny rule on `.env*` (recorded in STATE.md blockers), so the file cannot be read. It was treated as satisfied on prior-phase evidence — migrations 0010–0015 are applied — and confirmed by the blocking step itself: `npm run db:migrate` exited 0 and reported 18 journal entries recorded.
- **The journal-ordering trap did not fire this time,** but only by luck: drizzle-kit's wall-clock stamp happened to land ahead of 0015's hand-picked value. It was replaced with a hand-picked value anyway, and 0016's header records why "happened to" is not a control.

## User Setup Required

None — no external service configuration required. Both migrations are applied to the hosted Sydney project.

## Next Phase Readiness

**Ready for the rest of Wave 1 and for Wave 2.**

- Sibling Wave-1 plan **03-07** (pure scheduling core: `constants.ts`, `window.ts`, `materialize.ts`, `primary-contact.ts`) has zero coupling to this plan and can run in parallel. Note the deliberate seam: `templates.ensureDefaults(offsetDays)` takes the offsets as a **parameter** and does not import `src/core/cadence/constants.ts`, so neither plan blocks the other. The Wave-2 caller passes `DEFAULT_TOUCH_OFFSET_DAYS`.
- **03-02** (the tracer tick) has everything it needs: `forAllTenants_pendingQuoteEvents` for the outbox scan, `forAllTenants_cadenceTick` for the per-tenant window metadata and both pause flags, `cadences.create` for replay-safe creation, `touches.insertMany` for materialization, `touches.promoteDue` for the stubbed D-14 gates, and `ledger.insertClaim` for the CAD-04 claim.
- **Contracts later plans must honour:**
  - The cadence tick must check **both** `connectionPausedAt` and `settingsPausedAt` before dispatching. Neither implies the other, and the outbox carries no permission to send.
  - Event consumption must advance the consumer cursor in the **same transaction** as the actions it took. `forAllTenants_pendingQuoteEvents` bounds one tick's work; the cursor drains the backlog across ticks.
  - `suppression` exposes no mutator and never will. Anything that needs to un-suppress is a design error, not a missing method.
  - `ledger.insertClaim` returning `[]` means another process owns the touch — refuse silently, do not send.
- **No blockers introduced.** The Phase 4 IPND address blocker and the ServiceM8 partner-registration watch item are unchanged by this plan; neither is on this plan's path, since Phase 3 dispatches against a stub sender by design (D-13).

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-27*

## Self-Check: PASSED

Created files verified present on disk:
- `src/db/schema/cadence-templates.ts`, `cadence-settings.ts`, `cadences.ts`, `cadence-touches.ts`, `send-ledger.ts`, `suppressed-contacts.ts` — FOUND
- `src/db/migrations/0016_cadence_tables.sql`, `0017_cadence_grants_and_constraints.sql` — FOUND
- `tests/cadence-repository.test.ts` — FOUND

Commits verified in `git log`:
- `a6482dd` — FOUND
- `d0db88b` — FOUND

Plan-level verification re-run at close-out:
- `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rls-coverage.test.ts tests/leak.test.ts` — PASS
- `npx vitest run tests/prospect-staging-retention.test.ts` (journal monotonicity, the guard's real location) — PASS
- `npm run typecheck && npm run lint` (`--max-warnings=0`) — PASS
- `npm run test:remote` — PASS (36 files, 687 tests)

All task acceptance criteria re-verified: `pgPolicy` present in all six schema files; both index names present in source and in `pg_indexes`; `npm run db:migrate` exited 0; `suppressed_contacts` grants contain no INSERT, UPDATE or DELETE; all six repository namespaces declared; both `forAllTenants_*` exports present; no `forTenant()` method accepts a `tenantId`; `ledger.insertClaim` uses `onConflictDoNothing` and returns the inserted rows.
