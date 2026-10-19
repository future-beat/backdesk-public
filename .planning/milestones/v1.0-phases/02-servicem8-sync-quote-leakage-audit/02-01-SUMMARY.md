---
phase: 02-servicem8-sync-quote-leakage-audit
plan: 01
subsystem: servicem8-sync
status: complete
tags: [servicem8, sync, crypto, rls, tracer, spike]

requires:
  - "Phase 1: tenants table, has_tenant_access(), forTenant() repository, create_tenant RPC"
provides:
  - "sm8_connections + quotes tables (RLS, grants, CHECK constraints)"
  - "AES-256-GCM credential encryption (enc:v1)"
  - "Sm8Client — typed, non-throwing ServiceM8 fetch wrapper"
  - "connectServiceM8() — verify, encrypt, store, 90-day backfill"
  - "Measured ServiceM8 API facts (docs/servicem8-api-notes.md)"
  - "Sanitized live fixtures (tests/fixtures/sm8/)"
affects:
  - "02-02 (events/outbox reads quotes), 02-03 (poll reuses cursor + Sm8Client), 02-04 (re-key reuses connect form + action), 02-05 (triage writes chase_eligibility), 02-06/02-07 (audit reuses the fetch path)"

tech-stack:
  added:
    - "date-fns 4.4.0"
    - "@date-fns/tz 1.5.0 (TZDate — DST-correct zone interpretation)"
  patterns:
    - "Typed Sm8Result union instead of thrown errors at the API boundary"
    - "App-layer AES-256-GCM with a versioned envelope (enc:v1)"
    - "Opaque cursor from max observed edit_date, never our clock"
    - "Integer-cents string math for all money"
    - "Node module-resolution hook so scripts exercise real TS source"

key-files:
  created:
    - src/db/schema/sm8-connections.ts
    - src/db/schema/quotes.ts
    - src/db/migrations/0006_sm8_connections_quotes.sql
    - src/db/migrations/0007_sm8_table_grants.sql
    - src/db/migrations/0008_sm8_vocabulary_constraints.sql
    - src/core/shared/crypto.ts
    - src/core/servicem8/{client,schemas,types,normalize,pagination}.ts
    - src/core/sync/connect.ts
    - src/app/(console)/clients/[id]/{actions.ts,connect-form.tsx}
    - scripts/{verify-sm8-connect.mjs,sm8-spike.mjs}
    - scripts/lib/ts-alias-hook.mjs
    - docs/servicem8-api-notes.md
    - tests/{sm8-schemas,sm8-normalize,credential-crypto,connect-servicem8}.test.ts
    - tests/fixtures/sm8/{job,jobcontact,note,jobactivity}.json
  modified:
    - src/core/shared/env.ts
    - src/db/repository/for-tenant.ts
    - src/app/(console)/clients/[id]/page.tsx
    - tests/{rls-coverage,leak}.test.ts
    - tests/helpers/{env,seed}.ts
    - docs/env-vars.md

decisions:
  - "ServiceM8 timestamps are UTC, not account-local — measured, contradicts assumption A3"
  - "SM8_TIMESTAMP_ZONE is separate from tenant.timezone: interpretation vs display"
  - "chase_eligibility excluded from the upsert set — operator triage survives re-sync"
  - "Backfill fetch happens outside the write transaction; only writes are atomic"
  - "INSERT withheld from authenticated on both new tables"
  - "Added a third migration (0008) for vocabulary CHECK constraints"

metrics:
  duration: ~50 minutes
  completed: 2026-08-26
  tasks: 3
  commits: 3
  tests_added: 89
  tests_total: 189

actuals:
  tokens: 62000
  tasks: 3
  commits: 3
---

# Phase 02 Plan 01: ServiceM8 Connect Tracer Summary

Operator can paste a client's ServiceM8 API key, have it verified live, stored as AES-256-GCM ciphertext, and see 90 days of their quotes mirrored — proven end to end against a real trial account, with four undocumented API behaviours measured rather than assumed.

## What was built

**Tracer slice (Task 1).** One path through every layer the phase touches: two RLS-governed tables → versioned credential encryption → a typed ServiceM8 client that never throws and never carries the key in an error string → `connectServiceM8` (verify live, fetch, encrypt, write atomically) → connect form and open-quotes list on the client detail page. `scripts/verify-sm8-connect.mjs` proves all seven acceptance assertions against the live account and cleans up after itself.

**Live-API spike (Task 2).** `scripts/sm8-spike.mjs` measured A1–A4 and captured sanitized fixtures for all four resources. Findings recorded in `docs/servicem8-api-notes.md`.

**Wave-0 tests (Task 3).** 89 new tests across six files; full suite 189 passing.

## Spike findings — plans 02-02 and 02-03 consume these

| # | Assumption | **Measured** | Consequence |
|---|---|---|---|
| A1 | Datetime literals in `$filter` unverified | **Honoured** — but `gt` behaves **inclusively** (`>=`) | Cursor keeps second precision. The boundary record returns on every poll; the upsert dedupes it. **A non-empty poll no longer means "something changed"** — 02-03 must not treat row count as a change signal |
| A2 | `cursor=-1` mechanics unknown | `cursor=-1` and no-cursor return **identical** sets; no cursor header, no envelope, bare array | **Not conclusive at 6 jobs.** `pagination.ts` keeps its defensive walk; the no-new-uuids rule is load-bearing because the server ignores the cursor. Re-measure at >100 jobs |
| A3 | Timestamps are account-local | **UTC** — via the `x-platform-date-utc` header plus a 24-min-old record | **Assumption was wrong.** `SM8_TIMESTAMP_ZONE = 'UTC'`; `connect.ts` no longer passes `tenant.timezone`. That conflation was an 8-hour error for every Perth client |
| A4 | `gt` excludes zero-dates | **Confirmed** — natural experiment on `work_order_date`: 4 zero-date rows, 0 survived | Single-filter Pattern 6 fetch is safe. **The four-request per-status fallback is not needed and was not built** |

**Two schema corrections the documentation got wrong**, found by the tracer failing on live data:
- `quote_sent` is a **JSON boolean**, not the documented int 0/1 — returned alongside `active: 1` (a number) in the same object. A schema written from the reference pages alone rejected every job in the account.
- `total_invoice_amount` carries **4 decimal places** (`"393.7500"`). Integer-cents math truncates to 2 correctly.

`pagination.ts` was adjusted per A2 (documented rationale, no behavioural change — the walk already terminated correctly).

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] `quote_sent` schema rejected every live job**
- **Found during:** Task 1, first tracer run
- **Issue:** `sm8Flag` accepted only `0 | 1 | '0' | '1'` per the reference docs; the API returns `false`
- **Fix:** widened to accept numbers, strings and booleans
- **Commit:** e0ae1a4

**2. [Rule 1 - Bug] Timestamps interpreted in the wrong zone**
- **Found during:** Task 2 (A3 measurement)
- **Issue:** `connect.ts` passed `tenant.timezone` to `sm8ToUtc`, per assumption A3. Measurement showed ServiceM8 stores UTC — every `*_utc` column would have been 8 hours out for a Perth client, silently
- **Fix:** added `SM8_TIMESTAMP_ZONE = 'UTC'`; `normalizeJob` takes an explicit `sourceZone`. `sm8ToUtc` itself was already correct — it interprets in whatever zone it is given
- **Commit:** d8cc9b5

**3. [Rule 1 - Bug] Migration 0006 silently skipped**
- **Found during:** Task 1
- **Issue:** drizzle-kit stamped the new journal entry with a `when` earlier than 0004/0005, and the migrator skips entries older than the last applied. `migrate.mjs` then failed on 0007 with "relation does not exist" — the useful symptom, but the cause was two files away
- **Fix:** corrected the journal timestamp
- **Commit:** e0ae1a4

**4. [Rule 2 - Missing critical] Vocabulary CHECK constraints (new migration 0008)**
- **Issue:** `authenticated` holds UPDATE on `quotes`, so a curl with a valid operator JWT could write `chase_eligibility = 'whatever'` — a row simultaneously not-chaseable and not-safely-parked depending on which query asks. TypeScript unions erase; the grant does not
- **Fix:** CHECK constraints on `status`, `chase_eligibility`, `sync_source`, plus `api_key_ciphertext LIKE 'enc:v%'` so a plaintext key is not storable. Follows the Phase 1 precedent (0004_tenant_constraints.sql)
- **Note:** the plan specified two migrations; this is a third
- **Commit:** e0ae1a4

**5. [Rule 2 - Missing critical] Authorization check in the connect action**
- **Issue:** the plan specified a WR-01 authentication check. `connectServiceM8` writes through the service-role repository, which bypasses RLS — so authentication alone would let **any** authenticated operator attach a ServiceM8 account to any tenant uuid they could guess
- **Fix:** the action performs an RLS-scoped read of the target tenant with the operator's own JWT before proceeding; Postgres decides membership
- **Commit:** e0ae1a4

**6. [Rule 2 - Missing critical] `chase_eligibility` excluded from the upsert set**
- **Issue:** the plan did not specify conflict-set behaviour. Including it would revert an operator's triage decision on the next sync touching that job — silently un-chasing an approved quote, or re-chasing an excluded one
- **Fix:** deliberately omitted from the `onConflictDoUpdate` set, with a test on both halves
- **Commit:** e0ae1a4

**7. [Rule 3 - Blocking] Scripts could not import TypeScript source**
- **Issue:** Node 22 strips types natively but does not know the `@/*` alias or extensionless relative imports. The alternative was reimplementing connect logic inside the verify script — which would prove only that the script works
- **Fix:** `scripts/lib/ts-alias-hook.mjs`, a ~40-line resolution hook. No new dependency
- **Commit:** e0ae1a4

### Intentional design deviations

**Backfill fetch moved outside the write transaction.** The plan put the fetch inside the transaction. Holding an open Postgres transaction across several seconds of third-party HTTP occupies a pooled connection and can outlive the pool's timeouts. Order is now verify → fetch → encrypt → **one transaction for all writes**. The `must_haves` guarantee ("verifies-then-writes in one transaction") is about the writes and is fully preserved; a failed fetch leaves no residue because nothing is written yet.

**Migration named `0008` rather than folded into `0007`.** Grants and constraints are separate concerns and read better as separate files.

## Tracer feedback gate

Auto mode was off, but this plan declares `autonomous: true` with no `checkpoint:*` tasks, and the tracer's `<verify>` is fully automated and passed (7/7 live assertions, tsc, lint). Tasks 2 and 3 probe the tracer rather than build on it — Task 2 found and corrected a tracer bug (A3), which is the gate working as intended. **The visual UI check was not performed and is carried as a UAT item below.**

## Verification

| Check | Result |
|---|---|
| `node scripts/verify-sm8-connect.mjs` | 7/7 PASS against the live account |
| `node scripts/sm8-spike.mjs` | A1–A4 measured, 4 fixtures written |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` | **189 passed** (89 new) |
| `node scripts/migrate.mjs` | applied (9 journal entries) |

## Requirements satisfied

- **ONB-02** — key verified live before storage, `enc:v1` ciphertext, last4-only display, double-connect and simultaneous-connect both leave one row
- **SYNC-01** — 90-day backfill, all four statuses, cursor from observed `edit_date`
- **SYNC-03** — raw + UTC timestamp pairs populated; zero-dates normalize to `null`, never `Invalid Date`

## Known Stubs

None. Every code path in this plan is wired to real data.

Two deliberate not-yet-built items, both owned by later plans and neither a stub in this one:
- `sm8_connections` baseline fields (`baseline_*`) exist but are unpopulated — D-14 baseline computation is plan 02-06's.
- `SYNC_TICK_SECRET` is declared in the env schema but unused until plan 02-03, by design (env.ts is edited once per wave).

## UAT — needs a human

**The console UI was never visually verified.** Source-level assertions confirm the UI-SPEC copy is present, but nobody has loaded the page. Worth 5 minutes before plan 02-04 builds the re-key flow on the same form:

1. `npm run dev`, sign in, open a client
2. Confirm the connect form shows the hint copy and the input masks the key
3. Paste the trial key — confirm the button disables and reads "Verifying key…"
4. Confirm the connected state shows only "Connected — key ending in ####"
5. Confirm the open-quotes list renders amounts as AUD with cents
6. Try a junk key — confirm the inline field error appears and nothing is saved

## Notes for the next plans

- **02-03 (poll):** `gt` is inclusive — the cursor record always returns. Do not treat a non-empty poll as a change signal. `SYNC_TICK_SECRET` is already in the env schema. Webhook activation steps are in `docs/servicem8-api-notes.md`.
- **02-04 (re-key):** `connect-form.tsx` and `connectServiceM8Action` are built for reuse; `connectServiceM8` already clears `paused_at`/`consecutive_failures`/`alerted_at` on success, so D-08 auto-resume is the same code path as first connect.
- **02-05 (triage):** `chase_eligibility` is protected from sync overwrite and has a CHECK constraint. `authenticated` holds UPDATE on `quotes`.
- **02-06/02-07 (audit):** the single-filter fetch is confirmed safe (A4). `jobactivity` is a **scheduling** record, not a comms log — the "never followed up" figure is an approximation and the report must say so.

## Self-Check: PASSED

All 26 claimed files verified present on disk; all three commits verified in `git log`.
