---
phase: 02-servicem8-sync-quote-leakage-audit
plan: 03
subsystem: servicem8-sync
status: complete
tags: [servicem8, sync, cron, pg_cron, webhooks, route-auth, proxy, vercel]

requires:
  - "02-02: runSyncTick / runSyncForConnection, DueConnection, forAllTenants_syncTick"
  - "02-01: SYNC_TICK_SECRET in the server env schema, quotes.sm8_job_uuid"
  - "Phase 1: proxy.ts matcher, migration + grant conventions, scripts/migrate.mjs"
provides:
  - "POST /api/internal/sync-tick — timing-safe bearer gate in front of runSyncTick"
  - "pg_cron job sm8-sync-tick (*/5 * * * *), applied by scripts/apply-cron-schedules.mjs"
  - "pg_cron job cron-details-cleanup (weekly, 30-day retention) — migration 0012"
  - "POST/GET /api/webhooks/servicem8 — challenge echo + hint-to-poll adapter"
  - "forAllTenants_webhookHint — the second audited cross-tenant read"
  - "vercel.json pinning function execution to syd1"
affects:
  - "02-04 (health badge reads sync_runs, which only now gains rows unattended; the tick is what makes 'stale' meaningful)"
  - "02-05/02-06/02-07 (every later plan assumes quotes arrive without an operator pressing anything)"
  - "Phase 3 (the same api/ proxy exclusion covers the cadence tick route; the WR-01 rule is now written into proxy.ts)"
  - "Any future OAuth work (webhook activation is a config change, not a build — steps in docs/servicem8-api-notes.md)"

tech-stack:
  added: []
  patterns:
    - "API routes own their auth; the proxy matcher excludes api/ entirely"
    - "Secrets-bearing schedules applied by script from env; secret-free schedules stay in migrations"
    - "Untrusted callbacks resolve to a tenant and trigger an authenticated re-fetch — never a write"
    - "Destructive integration tests snapshot and restore the real catalog row they mutate"

key-files:
  created:
    - src/app/api/internal/sync-tick/route.ts
    - src/app/api/webhooks/servicem8/route.ts
    - scripts/apply-cron-schedules.mjs
    - src/db/migrations/0012_cron_details_cleanup.sql
    - vercel.json
    - tests/sync-tick-route.test.ts
    - tests/cron-schedules.test.ts
    - tests/webhook-hint.test.ts
  modified:
    - proxy.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/db/migrations/meta/_journal.json
    - docs/servicem8-api-notes.md
    - package.json
    - tests/lint-ban.test.ts
    - tests/sync-upsert.test.ts

decisions:
  - "Migration numbered 0012, not the plan's 0010 — 0010 and 0011 were taken by 02-02"
  - "Webhook tenant resolution keys on quotes.sm8_job_uuid; there is no stored ServiceM8 account identifier to key on and inventing a column would require OAuth to populate it"
  - "An unresolvable webhook hint is a no-op, not an error — polling is the guarantee and the latency cost is one interval on a minutes-old job"
  - "The cron integration test snapshots and restores the live sm8-sync-tick row rather than leaving a dead schedule behind"
  - "The tick response reduces alert to a boolean so the client's business name never travels in a cron log"
  - "Challenge echo shape is text/plain and flagged UNVERIFIED in the docs rather than asserted as fact"

metrics:
  duration: ~20 minutes
  completed: 2026-08-26
  tasks: 2
  commits: 3
  tests_added: 47
  tests_total: 323

actuals:
  tokens: 16000
  tasks: 2
  commits: 3
---

# Phase 02 Plan 03: Production Tick + Webhook Adapter Summary

The sync engine built in 02-02 now runs itself: pg_cron POSTs a shared secret to a Sydney-pinned route every five minutes, the route the console proxy can no longer swallow, and a ServiceM8 webhook can make that faster without being able to make it different.

## What was built

**Task 1 — the tick endpoint and the two things that would silently break it (`b8cf0cd`).**

`POST /api/internal/sync-tick` compares its bearer with `timingSafeEqual`, awaits `runSyncTick()` inside the request, and returns the per-connection outcome list. `proxy.ts`'s matcher now excludes `api/`. `vercel.json` pins execution to `syd1`.

The two halves are one guarantee, and they only work together. Without the matcher exclusion, the cron POST is answered with a 307 to `/login`, `net.http_post` records it as a success, and `cron.job_run_details` reads all-green forever while `sync_runs` stays empty — Pitfall 7, the failure that hides in the exact place an operator would look for it. With the exclusion and no bearer check, the endpoint becomes an unauthenticated way to make the service decrypt every client's ServiceM8 key. 17 tests hold both down, including the one that names the trap directly: the unauthenticated response is a plain 401 with no `Location` header.

**Task 2 — the schedule, the retention, and the webhook (`ddd10e2`).**

`scripts/apply-cron-schedules.mjs` applies `sm8-sync-tick` at `*/5 * * * *`. Migration `0012` schedules `cron-details-cleanup` weekly. `src/app/api/webhooks/servicem8/route.ts` answers the challenge and turns a callback into an authenticated re-fetch for one tenant. 29 more tests.

## Why the tick schedule is a script and the cleanup job is a migration

The plan asked for this split and it is worth restating why, because the two jobs look alike and are governed by opposite rules.

`sm8-sync-tick`'s command embeds a bearer token. A migration is a committed file. The alternative was Supabase Vault — store the secret, have the committed migration read `decrypted_secrets` — which keeps the "schedules live in migrations" rule intact and is the nicer shape. It was not taken because that interop is unverified for this project (research assumption A7) and the failure mode of getting it wrong is the worst one available: a schedule that exists, runs, and posts a null bearer. 401 every five minutes, cron green, `sync_runs` empty. That is Pitfall 7 again wearing a different hat, arrived at from the opposite direction. The script trades elegance for a thing you can watch work.

`cron-details-cleanup` is pure SQL with nothing to hide, so it stays in a migration where it is versioned and applied with everything else.

The secret does end up in `cron.job.command` in the database. That is inherent to pg_cron, and it is why `cron` schema privileges are already asserted in `tests/rls-coverage.test.ts` — neither `anon` nor `authenticated` can read that table. It is also the second reason the retention job matters: `cron.job_run_details` holds a copy of the command per execution, 288 times a day, forever. Retention here is a security control, not only housekeeping.

## Deviations from Plan

### Structural

**1. [Rule 3 - Blocking] The migration is `0012`, not `0010`**

The plan named `0010_cron_details_cleanup.sql`. Plan 02-02 shipped `0010_sync_tables.sql` and `0011_sync_table_grants.sql` in the previous wave — itself a documented deviation from *its* plan, which expected to stop at `0009`. Renumbered to `0012` and journal-stamped `1787810500000`, continuing the hand-stamped sequence that exists because `drizzle-kit` keeps generating `when` values earlier than the last applied entry (the trap 02-01 and 02-02 both hit).

**2. [Rule 2 - Missing critical] A second cross-tenant accessor, and the two tripwires that had to be edited to allow it**

The plan said "resolve the tenant by its connection" without saying how. There is no way to do that from inside a tenant scope — a callback arrives unauthenticated carrying a job uuid and nothing we chose — so it needed a `forAllTenants_*` export, which is the codebase's deliberately-awkward path for exactly this.

Two assertions had to be edited to admit it, and both are working as designed rather than being obstacles: the barrel-export list in `lint-ban.test.ts` and the `forAllTenants_\w+` set in `sync-upsert.test.ts`, whose comment says in so many words that adding a second one should require editing that line.

Rather than merely widening them, a new assertion was added alongside: the file's header rule is "no accessor returns tenant DATA across tenants", and the webhook resolver reads `quotes`, which is tenant data. The test now pins that `quotes` appears **only** as a join target and a uuid predicate — `quotes.tenantId` and `quotes.sm8JobUuid`, nothing selected — and that the outbox and contact mirror are not reachable from the file at all. The promise in the header is now a check.

**3. [Rule 2 - Missing critical] A webhook test file the plan did not list**

The plan's file list named only `tests/cron-schedules.test.ts`, but its own acceptance criteria demand webhook behaviour ("challenge case returns the documented echo; notification case calls `runSyncForConnection` and writes no payload fields"). Those are unit assertions with mocked collaborators; `cron-schedules.test.ts` is a remote-guarded integration suite that mutates the live `cron` catalog. Mixing them would mean a `vi.mock` factory in a file whose other tests need real Postgres. Split into `tests/webhook-hint.test.ts` (18 assertions).

### Design decisions the plan left open

**4. The webhook resolves tenants by job uuid, and cannot resolve a brand-new job**

The obvious key would be a ServiceM8 account identifier, and there is none stored: a private API key is not an account uuid, and the OAuth arm that would supply one does not exist yet. Adding a column would be a schema change we could not populate.

The job uuid is the one identifier present in both the callback and our own tables. The cost is explicit: **a job we have never seen cannot be resolved.** That is not a gap, it is the posture — polling is the SYNC-03 guarantee, so an unresolvable hint costs at most one polling interval of latency on a job that is by definition minutes old. The 90-day backfill plus five-minute polling means the resolvable set is every job older than one tick. Written into the accessor's header and step 9 of the activation doc, so nobody later reads it as a bug.

**5. Unknown tenant and paused connection return the same answer**

Both resolve to `undefined` inside the accessor, and the route answers `{"status":"unknown"}` for both. A response that distinguished them would answer "is this uuid one of your clients' jobs?" for anyone who asked — the same denial-vs-absence property Phase 1 built the RLS suite around, applied to an endpoint that is unauthenticated by construction. Paused connections are excluded in SQL, not in the route, so the D-06 rule ("a paused connection is not polled by any path") holds without the route needing to know about it.

**6. Every webhook response is 200, including the ones that failed**

ServiceM8's delivery behaviour makes non-200 actively harmful: a 429 from us throttles delivery for 15 minutes, a 410 **auto-unsubscribes**, retries continue for 72 hours. A 500 on a malformed payload converts a parse bug into hours of retry traffic or a silently cancelled subscription. There is nothing to report to ServiceM8 anyway — the outcome of the poll is in `sync_runs`, where the operator can see it. Six tests cover the non-happy paths, including a thrown cycle and an error message carrying a fake API key that does not reach the response body.

**7. The tick response reduces `alert` to a boolean**

`SyncCycleResult.alert` carries `tenantName`. The response ends up in a cron log, so the route returns `alerted: true|false` and drops the object. Kinds and counts only (T-2-15), asserted by a test that stringifies the whole body and greps for the business name.

**8. The challenge echo shape is flagged, not assumed**

The docs say the challenge must be echoed; they do not pin the encoding. The route answers `text/plain` with the raw value, and both the route and the activation doc mark the single line to change if the live subscription call rejects it. Guessing silently here would produce a subscription that never activates for a reason nobody wrote down.

**9. The cron integration test restores what it breaks**

The suite applies `sm8-sync-tick` pointing at `https://example.invalid`. Against the hosted project — which is what `ALLOW_REMOTE_TESTS=yes` means here — that would replace a live production schedule with a dead one, silently, in exactly the cron-green-sync-empty shape this plan exists to prevent. It snapshots whatever schedule it finds, restores it verbatim in `afterAll`, and unschedules if there was none. Verified after the run: `cron.job` holds only `cron-details-cleanup`.

One assertion in that suite is there specifically to catch a mistake that would otherwise pass everything: the test asserts the applied command contains its dummy secret and **not** the real one from `.env.local`. If the child environment did not win over `process.loadEnvFile`, the suite would have published the production bearer into a job pointing at an unroutable host, and every other assertion would still have been green.

**10. `cron-details-cleanup` filters on `start_time`, not `end_time`**

`end_time` is NULL for a run still in flight and for one whose worker died. `end_time < now() - interval '30 days'` skips NULLs, which would leave exactly the rows an investigation cares about accumulating forever. Asserted both ways: the command contains `start_time` and does not contain `end_time`.

### Additions

**11. `npm run cron:apply`** — following the `db:migrate` / `verify:sm8-connect` convention, so the apply step is discoverable from `package.json` rather than only from a doc.

## Verification

| Check | Result |
|---|---|
| `node scripts/migrate.mjs` | applied — 13 journal entries |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/sync-tick-route.test.ts` | 17 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cron-schedules.test.ts` | 11 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/webhook-hint.test.ts` | 18 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` (full suite) | **323 passed** (47 new) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `cron.job` state after the suite | only `cron-details-cleanup` — the snapshot/restore worked |

### Acceptance criteria

| Criterion | Evidence |
|---|---|
| 401 without / with wrong-same-length secret; 200 with correct | `sync-tick-route.test.ts`, 4 auth cases incl. a too-short header that would otherwise throw |
| No `Location` header on the 401 | "THE PITFALL-7 ASSERTION" |
| Matcher regex does not match the tick path | matcher read from `proxy.ts` at runtime, tested against 6 paths incl. `/loginanything` and `/clients/api-keys` |
| `maxDuration = 300` and `timingSafeEqual` | export assertion + source assertion incl. a negative on `===` |
| `vercel.json` contains `syd1` | parsed and compared |
| `sm8-sync-tick` at `*/5 * * * *`, one row after double-apply | `cron-schedules.test.ts` against the real catalog |
| `cron-details-cleanup` exists after migration | same suite |
| Script contains no literal secret and no literal production URL | source assertion over comment-stripped code |
| Challenge returns the documented echo | `webhook-hint.test.ts`, POST and GET forms |
| Notification calls `runSyncForConnection` and writes no payload fields | behavioural (a forged `status: 'Work Order'` changes nothing but which tenant is re-fetched) + structural (route imports no write surface) |
| Activation doc lists concrete steps, not TBD | `docs/servicem8-api-notes.md`, 9 steps incl. the exact subscription call |

## Threat mitigations applied

| Threat | Applied |
|---|---|
| T-2-03 | Bearer + `timingSafeEqual` + length pre-check (the pre-check is what stops a short header being a 500 rather than a 401); proxy exclusion means the route's own auth is the only auth; rotation documented as env-update → redeploy → re-run script |
| T-2-05 | Payload used only as a poll hint, enforced structurally (no write surface imported, asserted); 60s per-connection debounce; challenge handshake; paused connections excluded in SQL |
| T-2-15 | Tick response carries kinds + counts, `alert` reduced to a boolean; apply script prints jobname/schedule/active only; 30-day retention on the run-details table that holds a copy of the bearer per execution |
| T-2-02 | Webhook swallows its own throw without logging the caught value; asserted with a fake `X-API-Key` in an error message |
| T-2-SC | No packages installed |

## Known Stubs

**None in the code paths this plan ships.** Two things are deliberately not yet live, both configuration rather than stubs:

- **`sm8-sync-tick` is not scheduled in production.** The script exists, is tested and is idempotent, but `APP_BASE_URL` needs a deployment to point at and there is none yet. This is the plan's declared `user_setup` item, carried below as a UAT step.
- **The webhook route is inert.** No subscription exists, because a private API key cannot create one. Activation is a config change with 9 written steps and no code to write except the OAuth arm.

## UAT — needs a human, after the first deploy

The one check that cannot be made from here, and the one this whole plan is shaped around:

1. Deploy to Vercel and note the stable production URL.
2. `APP_BASE_URL=https://<that-url> npm run cron:apply` — confirm it prints `sm8-sync-tick  schedule=*/5 * * * *  active=true`.
3. Wait ten minutes, then run both halves of the cross-check:
   - `SELECT status, return_message FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sm8-sync-tick') ORDER BY start_time DESC LIMIT 3;`
   - `SELECT started_at, outcome, jobs_fetched FROM sync_runs ORDER BY started_at DESC LIMIT 3;`

**Both must be non-empty.** Green cron with an empty `sync_runs` is the exact silent failure this plan was built to make impossible — if it happens anyway, the matcher exclusion or the bearer is the first place to look, not the sync engine.

## Notes for the next plans

- **02-04 (health):** `sync_runs` now gains rows without anyone pressing anything, which is what makes a "last synced" badge meaningful. Until the UAT step above is done in production, the table only moves when a test or a manual call runs it.
- **02-05 and later:** any new API route is now outside the proxy. It must authenticate itself — `proxy.ts`'s comment and `sync-tick/route.ts`'s header both state the rule, and `tests/sync-tick-route.test.ts` has the pattern to copy.
- **Phase 3:** the cadence tick will want its own schedule. Follow the same split: secret-bearing command → `scripts/apply-cron-schedules.mjs` (add a second job there rather than a second script); secret-free SQL → a migration.
- **Whoever activates webhooks:** read `docs/servicem8-api-notes.md` §Webhook activation start to finish before touching code. Step 6 is the only unverified thing in it.

## Self-Check: PASSED

All 8 created and 8 modified files verified present on disk; both task commits verified in `git log`.
