---
phase: 02-servicem8-sync-quote-leakage-audit
plan: 02
subsystem: servicem8-sync
status: complete
tags: [servicem8, sync, outbox, events, rls, failure-policy, tdd]

requires:
  - "02-01: sm8_connections + quotes tables, Sm8Client, crypto, normalize, pagination, forTenant()"
  - "Phase 1: tenants, has_tenant_access(), migration/grant conventions"
provides:
  - "quote_contacts — Phase 3/4 recipient data on its own cursor"
  - "quote_status_events + event_consumer_cursors — the SYNC-02 transactional outbox and the Phase 3 consumption contract"
  - "sync_runs — per-cycle health log with a closed outcome vocabulary"
  - "operator_allowlist + is_operator() — the RLS gate for non-tenant tables"
  - "filterFrom / advanceCursor — the SYNC-01 cursor, pure"
  - "classifyTransition — total over the closed 5x4 status matrix"
  - "applyFailurePolicy — the D-06 pause/backoff/alert decision, pure"
  - "runSyncForConnection / runSyncTick — the locked, idempotent, event-emitting cycle"
  - "forAllTenants_syncTick() — the single audited cross-tenant read"
affects:
  - "02-03 (tick route + webhook adapter call runSyncTick; connections option is the hint seam)"
  - "02-04 (health badge derives from sync_runs + pause fields; onAlert hook is where the email lands)"
  - "02-05 (triage writes chase_eligibility, which sync still cannot overwrite)"
  - "Phase 3 (consumes quote_status_events past event_consumer_cursors)"
  - "Phase 7 (re-reads the event history for recovered-revenue attribution)"

tech-stack:
  added: []
  patterns:
    - "Transactional outbox: events co-commit with the upsert that caused them"
    - "Deletion classified on the EDGE, not the state, so idempotence survives"
    - "Pure policy modules + an orchestrator that applies their effects"
    - "Cross-tenant reads confined to explicitly-named forAllTenants_* exports"
    - "Closed vocabularies enforced by CHECK constraints, not just TS unions"

key-files:
  created:
    - src/db/schema/quote-contacts.ts
    - src/db/schema/quote-events.ts
    - src/db/schema/sync-runs.ts
    - src/db/schema/operators.ts
    - src/db/migrations/0009_is_operator_helper.sql
    - src/db/migrations/0010_sync_tables.sql
    - src/db/migrations/0011_sync_table_grants.sql
    - src/core/sync/cursor.ts
    - src/core/sync/transitions.ts
    - src/core/sync/failure-policy.ts
    - src/core/sync/run-sync.ts
    - src/db/repository/for-all-tenants.ts
    - scripts/grant-operator.mjs
    - tests/sync-cursor.test.ts
    - tests/transitions.test.ts
    - tests/failure-policy.test.ts
    - tests/sync-upsert.test.ts
    - tests/quote-events.test.ts
  modified:
    - src/db/schema/index.ts
    - src/db/repository/for-tenant.ts
    - src/db/repository/index.ts
    - src/core/servicem8/client.ts
    - tests/rls-coverage.test.ts
    - tests/lint-ban.test.ts
    - tests/helpers/seed.ts

decisions:
  - "Migration order inverted from the plan: the is_operator() helper must precede the generated table migration, because CREATE POLICY resolves functions at DDL time"
  - "is_operator() reads an explicit allowlist, not exists-in-tenant_members — a v2 client login must never satisfy it"
  - "Work Order/Completed -> Unsuccessful classifies lost, and Unsuccessful -> Work Order/Completed classifies won (the research skeleton returned null for both)"
  - "classifyTransition's third argument is the deletion EDGE, not the raw active flag — passing the state would re-emit removed every five minutes"
  - "ServiceM8 fetch stays outside the write transaction (02-01 precedent); the FOR UPDATE lock covers the diff-and-write, which is where the emission guarantee lives"
  - "A local (non-ServiceM8) cycle failure is reported as recorded:false rather than given a fabricated sync_runs outcome"
  - "authenticated is read-only on all five new tables — none of them holds a human decision"

metrics:
  duration: ~29 minutes
  completed: 2026-08-26
  tasks: 3
  commits: 4
  tests_added: 87
  tests_total: 276

actuals:
  tokens: 60000
  tasks: 3
  commits: 4
---

# Phase 02 Plan 02: Sync Engine Core Summary

`runSyncTick()` now performs an isolated, idempotent, event-emitting cycle for every unpaused client — cursor that cannot skip or regress, a status matrix with no fall-through, a transactional outbox Phase 3 can cursor over, and a failure policy that pauses on a revoked key without pausing on a 429.

## What was built

**Task 1 — schema (573a227).** Five tables. `quote_contacts` mirrors job contacts on their own cursor, because a tradie correcting a mobile number does not touch the job and a job-cursor poll would never see it. `quote_status_events` is the SYNC-02 outbox, with `event_consumer_cursors` beside it and the Phase 3 contract written into the file header. `sync_runs` is the per-cycle health log. `operator_allowlist` plus `is_operator()` gate the two tables that have no `tenant_id` to gate on.

**Task 2 — pure logic (RED `4fb4bda`, GREEN `596e671`).** `cursor.ts`, `transitions.ts`, `failure-policy.ts`. No I/O, no framework, 60 tests. The transition matrix is enumerated cell by cell with a reason attached to each, and a completeness assertion so deleting a row cannot silently shrink coverage.

**Task 3 — orchestrator (287f934).** `runSyncForConnection` and `runSyncTick`, the single cross-tenant accessor, and the repository accessors the cycle needs. 25 integration tests against real Postgres with only the ServiceM8 HTTP call stubbed — driven by the sanitized page captured from the live trial account, so the data flowing through is the data ServiceM8 actually sends.

## The Phase 3 contract (the plan's explicit output requirement)

This is restated in full in the header of `src/db/schema/quote-events.ts`; the short form:

**Reading.** Get your cursor from `event_consumer_cursors WHERE consumer = '<you>'` — **no row is seeded**, so a consumer that has never run cannot appear to be caught up. Scan `WHERE id > cursor ORDER BY id`. Advance the cursor **in the same transaction** as whatever you did with the events.

**Order on `id`, never on a timestamp.** A batch written in one transaction shares `detected_at` to the microsecond, and `occurred_at` can move backwards relative to detection because it comes from ServiceM8.

**Replay is legal.** Append-only; nothing updates or deletes. Phase 7 re-reads from 0 on every report run, so events are facts ("this quote became a Work Order"), not commands, and idempotence is the consumer's job.

**Three things the stream deliberately does not contain:**

| Not in the stream | Why | Enforcement |
|---|---|---|
| Pre-connection history | Emitting it would congratulate a client on a job won in June and credit Phase 7 with wins the service never touched | Emission exists only in `run-sync`'s diff path; `connect.ts` cannot reach the outbox. Asserted structurally *and* behaviourally |
| `quote_opened` for an untriaged quote | A backfilled quote may be months old and already dealt with (D-15) | Fires only for a brand-new poll-sourced row, which lands `chase_eligibility = 'eligible'` |
| Any permission to send | The stream says what happened, not whether we may act | **Phase 3 dispatch MUST check `sm8_connections.paused_at IS NULL` separately.** A paused connection means the mirror stopped updating at an unknown point, and the events in the table are exactly as stale as it is |

## Deviations from Plan

### Structural deviations

**1. [Rule 3 - Blocking] Migration order inverted — three files, not two**

The plan specified `0008_sync_tables.sql` (generated) then `0009_is_operator_and_grants.sql` (custom). That ordering cannot work: `CREATE POLICY` resolves the functions it references at DDL time, and the generated file is the one that carries the policies calling `is_operator()`. Shipped as `0009_is_operator_helper.sql` (custom, function first) → `0010_sync_tables.sql` (generated) → `0011_sync_table_grants.sql` (custom, grants + CHECKs). This is precisely the argument migration `0000` already makes for `has_tenant_access()`, and the helper is `plpgsql` for the same reason — a `LANGUAGE sql` body would be validated immediately and could not reference a table created afterwards.

**2. [Rule 1 - Bug] Journal timestamps stamped in the past again**

`drizzle-kit` gave the three new entries `when` values earlier than `0008`'s, and the migrator skips entries older than the last applied — the identical trap 02-01 hit and documented. Caught before the first `migrate` run this time. The generated-timestamp collision with the hand-stamped `0004`–`0008` values will recur on every future migration; worth a note in `src/db/migrations/README.md` in a later plan.

**3. [Rule 1 - Bug] `client.ts` was requesting `/api_1.0/job.json.json`**

Every call site passes `'job.json'`; `client.ts` appended another `.json`. Measured against the live account: ServiceM8 returns an identical 200 and an identical body for both forms, which is exactly why the tracer's seven live assertions never noticed. Tolerance is not a contract — the day their router tightens, every request in the product breaks at once from a doubled suffix nobody has looked at in months. Normalized in `client.ts` so both spellings resolve to one path; `scripts/verify-sm8-connect.mjs` re-run live, 7/7.

### Behavioural deviations from the research skeleton

**4. [Rule 2 - Missing critical] Four transition cells the skeleton got wrong**

The research excerpt restricted `won` to a `Quote` origin and returned null for everything else, and the plan's behavior block inherited that shape while instructing "enumerate, no default fall-through". Enumerating forced a decision on the cells neither document names:

- `Work Order → Unsuccessful` and `Completed → Unsuccessful` are **lost**. A job that was won and then died is a loss the service may already have claimed credit for. Null here leaves Phase 7 attributing revenue the client never invoiced, and Phase 3 with no signal to stop a cadence.
- `Unsuccessful → Work Order` and `Unsuccessful → Completed` are **won**. A written-off quote turning into real work is the single most valuable thing this product detects — it is the entire pitch — and it would have been invisible.

**5. [Rule 1 - Bug] The deletion parameter is the edge, not the state**

The spec says "`nowInactive` = removed regardless of pair". Taken literally, a deleted job — which keeps returning `active: 0` on every subsequent poll forever — emits a fresh `removed` event every five minutes, contradicting the plan's own idempotence acceptance criterion. The parameter is named `becameInactive` and documented as the `true → false` edge; the caller computes it. First sight of an already-deleted job stays silent, which is the pre-connection-history prohibition applied to deletions. Both properties are asserted.

**6. Fetch outside the write transaction (intentional design deviation)**

The plan put the ServiceM8 fetch inside the locked transaction. It is outside, following the precedent `connect.ts` set in the previous wave: a transaction held across several seconds of third-party HTTP occupies a pooled connection and can outlive the pool's own timeouts — at fifteen clients on a five-minute tick, that is an outage waiting for a slow day at ServiceM8.

**The guarantee the lock protects is fully preserved, because it is about emission, not fetching.** Two overlapping runs may both fetch; they cannot both emit. The stored state a run diffs against is read *inside* its own locked transaction, so whichever commits second sees the first one's upserted statuses and classifies no change. The cursor advance is also safe: `prev` is re-read from the locked row rather than from the snapshot the cycle started with, so a concurrent run that got further cannot be rewound. `SELECT ... FOR UPDATE` is asserted present by a source test, since the property it defends is an absence no single-threaded test can demonstrate.

**7. Local failures are not given a fabricated outcome**

`sync_runs.outcome` is a closed vocabulary of `ok` plus the five `Sm8FailureKind` values, and none of them honestly means "our own database write failed". Rather than mislabel it — or widen a vocabulary the plan pins — a local throw propagates to `runSyncTick`'s per-connection catch and is reported as `{ outcome: null, recorded: false }`. The database being unreachable is precisely the condition under which recording the failure would also fail. Tested via a connection whose ciphertext cannot be decrypted.

**8. `event_consumer_cursors` lives in `quote-events.ts`, not `operators.ts`**

The plan's task action put it in `operators.ts`; the plan's own artifact spec lists it under `quote-events.ts`. Placed with the outbox it cursors over, so the consumption contract is one file. `operators.ts` holds the allowlist and the rationale for the helper.

**9. `runSyncTick` takes an optional `connections` list**

Defaults to `forAllTenants_syncTick()`. This is the 02-03 webhook seam, not a test hook: the research's "hints-to-poll" adapter answers a webhook about one tenant by running this same cycle for that tenant, so the two paths cannot drift into separate implementations of the same guarantee.

### Additions

**10. [Rule 2 - Missing critical] CHECK constraints on the new vocabularies**

`event_type`, `from_status`, `to_status`, `outcome`. Unlike the `quotes` CHECKs these do not defend against a curl with an operator JWT — `authenticated` holds no write grant here. They defend against us: a typo'd `event_type` written by the service-role worker is a win the cadence engine silently ignores and the report silently omits, with nothing going red. TypeScript unions erase before the INSERT is built.

**11. `teardownTenants` deletes events explicitly**

`quote_status_events` deliberately carries no FK to `tenants` — it is the attribution ledger, and a disconnecting client must not take their history with them. That design choice means the cascade no longer covers everything, so test teardown says so out loud rather than leaving orphaned rows behind on every run.

## Verification

| Check | Result |
|---|---|
| `node scripts/migrate.mjs` | applied — 12 journal entries |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rls-coverage.test.ts` | 11 passed |
| `npx vitest run` (three pure suites) | 60 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/sync-upsert.test.ts` | 17 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/quote-events.test.ts` | 8 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` (full suite) | **276 passed** (87 new) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `node scripts/grant-operator.mjs` | operator enrolled |
| `node scripts/verify-sm8-connect.mjs` | 7/7 live — regression check on the `client.ts` URL fix |

### Acceptance criteria

| Criterion | Evidence |
|---|---|
| Idempotence: identical page twice → identical rows, zero duplicate events | `sync-upsert.test.ts` "running the identical page twice…" |
| Transactionality: parse failure leaves zero quote/event writes, one classified run row | `quote-events.test.ts` "a parse failure writes NO quotes and NO events…" |
| `FOR UPDATE` lock present in the cycle transaction | source assertion, `sync-upsert.test.ts` "takes the connection-row lock…" |
| `error_detail` drawn from the closed vocabulary only | source assertion + behavioural assertion on a recorded failure |
| `forAllTenants_` shows exactly the syncTick export | source assertion, regex over the whole file |
| ≥20 transition cells asserted | 20 cells + a completeness check proving all 20 exist |
| Cursor: same-second inclusion, never regresses | `sync-cursor.test.ts` |
| Failure policy: 1 transient no-op, auth pauses, 3rd alerts once | `failure-policy.test.ts` |

## Threat mitigations applied

| Threat | Applied |
|---|---|
| T-2-04 | `pgPolicy` on all three tenant-scoped tables + grants in 0011 + rls-coverage enrolment |
| T-2-08 | `is_operator()` allowlist, asserted by name, volatility, language and definer-ness in rls-coverage — an `exists-in-tenant_members` variant would look scoped and admit every v2 client login |
| T-2-02 | `error_detail` restricted to the classified kind at the single write site; `runSyncTick`'s catch deliberately does not log the caught value, which can carry a Request with the key in its headers |
| T-2-09 | Parse failure aborts before the transaction opens, so "no partial writes" is structural rather than dependent on a rollback firing |
| T-2-11 | Emission lives only in `run-sync`'s diff path; asserted structurally (connect.ts references none of the outbox symbols) and behaviourally (a backfilled quote re-seen by a poll emits nothing) |

## Known Stubs

**One, deliberate and named in the plan: `onAlert` defaults to a no-op.** The decision to alert is made, tested and returned in the cycle result; sending the email is plan 02-04's, which keeps this plan free of a mail dependency. This is not a silent stub — the alert intent is a typed value on `SyncCycleResult`, and 02-04 wires the callback rather than re-deriving the decision from stored state.

Two not-yet-built items owned by later plans, neither a stub here:

- Nothing calls `runSyncTick()` yet. The tick route and the pg_cron schedule are plan 02-03's.
- `baseline_*` on `sm8_connections` remains unpopulated — D-14 is plan 02-06's.

## Notes for the next plans

- **02-03 (tick route):** call `runSyncTick()`; it returns a per-connection outcome list already. The `connections` option is the webhook-hint seam. Remember the poll is never empty (`gt` is inclusive) — row count is not a change signal. `paused_at IS NULL` filtering is already inside `forAllTenants_syncTick`.
- **02-04 (health + re-key):** derive the badge, never store it — `syncRuns.recent()` plus the pause fields are the inputs (D-07). Wire `onAlert`; `alerted_at` is set by the cycle that decided to alert and cleared by the next success, so a new episode alerts again. `connectServiceM8` already clears the pause fields, so D-08 auto-resume needs no new code.
- **02-05 (triage):** `chase_eligibility` survives sync — proven on both halves (a backfilled `needs_review` row stays parked through a poll; a fresh poll-sourced row arrives `eligible`).
- **Phase 3:** read the contract in `src/db/schema/quote-events.ts` before writing the consumer. Check `paused_at` yourself; the outbox will not do it for you.

## Self-Check: PASSED

All 18 created and 7 modified files verified present on disk; all four commits verified in `git log`.
