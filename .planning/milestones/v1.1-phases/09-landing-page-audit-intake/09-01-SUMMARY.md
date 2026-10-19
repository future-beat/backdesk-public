---
phase: 09-landing-page-audit-intake
plan: 01
subsystem: api
tags: [nextjs, server-actions, zod, drizzle, postgres, rls, supabase-storage, resend, clicksend, gsm7, vercel]

requires:
  - phase: 02-quote-leakage-audit
    provides: the tenant-less `prospects` family (schema, repository, is_operator() policy) this plan mirrors, and the `prospects.id` the conversion link points at
  - phase: 04-messaging-gateway
    provides: `sendSms` (never-throws, verbatim body, customString) and the global `messaging_config` sms row whose from-number the operator SMS reads
  - phase: 02-quote-leakage-audit
    provides: `sendOperatorAlert` / `alertSubject` / `consoleBaseUrl`, extended here with a third kind
  - phase: 08-brand-and-domains
    provides: `app.backdesk.com.au` on the `backdesk` Vercel project, and the `env:push` + evidence-entry shape this plan reuses
provides:
  - "`audit_requests` + `audit_request_throttle`: two tenant-independent tables, four CHECK vocabularies, operator-only RLS, live on the hosted Sydney database (migration 0035)"
  - "`src/db/repository/audit-requests.ts`: the tenant-less repository family on its own barrel line (11 functions, no `tenantId` anywhere)"
  - "`src/core/intake/audit-request.ts`: the pure zod schema for the D-10 fields with the UI-SPEC error copy verbatim, plus the shared trade/band labels"
  - "`src/core/alerts/operator-sms.ts`: a never-throwing operator SMS that reads the GLOBAL sms from-number and ignores the tenant arming flag"
  - "`operator-email.ts` kind `audit_request` (discriminated union, control characters stripped before interpolation)"
  - "`src/app/(marketing)/`: the public route group — nested layout, one-file copy module, `/audit` form (works with JS off), the session-less action, `/audit/thanks`"
  - "`proxy.ts` matcher exclusions for the public site, anchored so `/audits` stays gated"
  - "`OPERATOR_ALERT_PHONE` + `AUDIT_IP_HASH_SALT` as REQUIRED env, live in Vercel Production and Preview"
  - "`scripts/audit-requests-count.mjs` (read-only row proof) and `scripts/setup-storage.mjs --check` (private-bucket proof)"
  - "the private `audit-uploads` Supabase Storage bucket"
affects: [09-03 throttle-honeypot-csv, 09-04 host-aware-routing, 09-05 landing-page-privacy, 09-06 console-detail-prefill, 09-09 console-request-list, 10 go-live]

actuals:
  tokens: 65599
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Public (session-less) server action whose gate is validation rather than authentication, with the blast radius bounded structurally by a two-function barrel import"
    - "Operator notification that deliberately bypasses the tenant arming flag because the recipient is the operator, not a customer"
    - "Closed vocabularies resolved to `{ value, label }` on the server and passed to the client component as props, so `@/db/schema` (and drizzle) never enters the browser bundle"

key-files:
  created:
    - src/db/schema/audit-requests.ts
    - src/db/migrations/0035_phase9_audit_requests.sql
    - src/db/repository/audit-requests.ts
    - src/core/intake/audit-request.ts
    - src/core/alerts/operator-sms.ts
    - src/app/(marketing)/layout.tsx
    - src/app/(marketing)/copy.ts
    - src/app/(marketing)/audit/actions.ts
    - src/app/(marketing)/audit/form.tsx
    - src/app/(marketing)/audit/thanks/page.tsx
    - scripts/audit-requests-count.mjs
    - scripts/setup-storage.mjs
    - tests/audit-request-schema.test.ts
    - tests/audit-request-notify.test.ts
    - tests/audit-request-action.test.ts
    - tests/audit-request-repository.test.ts
    - tests/proxy-host-routing.test.ts
  modified:
    - proxy.ts
    - src/core/alerts/operator-email.ts
    - src/core/shared/env.ts
    - src/db/repository/index.ts
    - src/db/schema/index.ts
    - eslint.config.mjs
    - tests/rls-coverage.test.ts
    - tests/lint-ban.test.ts
    - tests/helpers/env.ts
    - .github/workflows/ci.yml
    - docs/env-vars.md
    - docs/external-registrations.md
    - supabase/config.toml

key-decisions:
  - "The request is a tenant-independent row that points AT a prospect once an operator converts it — nothing points back, and no repository function here accepts a tenantId"
  - "The operator SMS reads the global messaging_config from-number and ignores `enabled`: the arming flag protects a tradie's CUSTOMERS, and gating the operator's own alert on it would make every request arrive silently in the current production state"
  - "The SMS drops the request uuid from the link and caps both names (40/30 code points) — 151 septets worst case, one GSM-7 segment; the trade, the band and the id live in the email"
  - "The closed-vocabulary rule for alert bodies is deliberately relaxed for a prospect's own strings, and control-character stripping plus zod length bounds is what replaces it"
  - "The storage bucket upsert is the LAST statement in migration 0035 so a privilege failure there cannot lose the table DDL — it succeeded, so the createBucket fallback was not needed"
  - "`audit_request_throttle` gets an is_operator() policy but no anon/authenticated grant at all: service-role only, and absent from the exact-grants map by design"

patterns-established:
  - "Tenant-less public-intake repository family: no closure, every id shape-checked, retention stamped by Postgres on the one write path, exported on its own commented barrel line"
  - "Write-once bookkeeping guards (`WHERE notified_at IS NULL`, `WHERE converted_prospect_id IS NULL`) so a retry cannot rewrite the first truthful record"
  - "Server-resolved option lists as props, keeping schema/ORM modules out of any client bundle on a prerendered marketing page"

requirements-completed: [LAND-02, LAND-03]

coverage:
  - id: D1
    description: "A prospect submits business name, contact name, mobile, email, trade, ServiceM8 yes/no and quotes band on /audit with no login, and every failing field comes back at once with the locked UI-SPEC wording and the entered values preserved"
    requirement: LAND-02
    verification:
      - kind: unit
        ref: "tests/audit-request-schema.test.ts#a blank form reports EVERY field at once, in the UI-SPEC words"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#returns every failing field and echoes the input back"
        status: pass
      - kind: e2e
        ref: "curl -s https://app.backdesk.com.au/audit (200 signed out; renders h1, business_name, quotes_per_month, submit, skip link)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The form works with JavaScript disabled — a plain multipart POST to the page route, which the proxy matcher deliberately excludes"
    requirement: LAND-02
    verification:
      - kind: e2e
        ref: "curl -s https://app.backdesk.com.au/audit | grep encType — renders `encType=\"multipart/form-data\" method=\"POST\"` with the $ACTION_1 / $ACTION_REF_1 progressive-enhancement fields present"
        status: pass
      - kind: unit
        ref: "tests/proxy-host-routing.test.ts#public marketing paths never reach the session gate"
        status: pass
    human_judgment: true
    rationale: "The rendered markup and the matcher are proven; that a real browser with JS switched off completes the round trip to /audit/thanks is the plan's human-check and needs a person with a browser."
  - id: D3
    description: "Every valid submission is a row in public.audit_requests written through the service-role repository before any notification is attempted, and a notification failure never loses it"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-action.test.ts#writes the row BEFORE it attempts either notification"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#records failed with the CODE and still redirects"
        status: pass
      - kind: integration
        ref: "tests/audit-request-repository.test.ts#writes a row that is new, unnotified and carrying no file (CI run 34304180247)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The operator is emailed (kind audit_request) and texted (OPERATOR_ALERT_PHONE, one GSM-7 segment, arming flag ignored) inside the same request, with both outcomes recorded on the row"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-notify.test.ts#sends from the global row even when that row is DISARMED"
        status: pass
      - kind: unit
        ref: "tests/audit-request-notify.test.ts#renders the locked shape and stays inside one segment"
        status: pass
      - kind: integration
        ref: "tests/audit-request-repository.test.ts#writes the first outcome and ignores the second (CI run 34304180247)"
        status: pass
    human_judgment: true
    rationale: "That the email lands in the founder's inbox and the SMS on the founder's handset within a minute of a real submission can only be observed by the founder; ClickSend and Resend are never called from a test."
  - id: D5
    description: "A stored row is provable without the console: node scripts/audit-requests-count.mjs prints the count and the newest row's status and notify outcomes, and never a name, phone, email, hash or agent string"
    requirement: LAND-03
    verification:
      - kind: other
        ref: "node scripts/audit-requests-count.mjs → `audit_requests rows: 0` (one line; `| grep -c \"@\"` prints 0)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Migration 0035 is applied to the hosted Sydney database with a proven no-op re-run, and the private audit-uploads bucket exists"
    verification:
      - kind: other
        ref: "npm run db:migrate twice → `Journal entries recorded: 36` both times, no DDL echoed on the second"
        status: pass
      - kind: other
        ref: "node scripts/setup-storage.mjs --check → `audit-uploads public=false`"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts (grants, is_operator policy list, presence list, four audit_requests_* CHECK names — CI run 34304180247)"
        status: pass
    human_judgment: false
  - id: D7
    description: "GET /audit, /audit/thanks, /privacy, /brand/*, /robots.txt and /sitemap.xml never invoke the proxy; /audits and /audits/requests still do"
    verification:
      - kind: unit
        ref: "tests/proxy-host-routing.test.ts (both directions, matcher read from the real file)"
        status: pass
      - kind: e2e
        ref: "curl app.backdesk.com.au: /audit 200, /audit/thanks 200, /audits 307"
        status: pass
    human_judgment: false

duration: 42min
completed: 2026-09-09
status: complete
---

# Phase 09 Plan 01: Public Audit Request (Tracer) Summary

**A prospect can now submit the free-audit form on `app.backdesk.com.au/audit` with no account and no JavaScript, and the request lands as a tenant-independent `audit_requests` row that emails and texts the operator inside the same request — proven end to end on the live host, with the row provable by a read-only count script because the console list does not exist yet.**

## Performance

- **Duration:** 42 min (including the 7-minute CI run and the production deploy)
- **Started:** 2026-09-09T02:15Z
- **Completed:** 2026-09-09T02:57Z
- **Tasks:** 2 of 2
- **Files modified:** 37 (22 created, 15 modified)

## Accomplishments

- **Every layer of the intake path has one committed, tested path.** Schema and migration, repository, env, intake validation, marketing route group, server action, alert email, operator SMS and proxy matcher were each touched once, thinly, and wired together — which is what makes the eight expansion plans widenings rather than redesigns.
- **Migration 0035 is live on the hosted Sydney database with a proven no-op re-run** (`Journal entries recorded: 36` on both runs, no DDL echoed the second time). The journal-ordering trap did not fire: the generator stamped `1788919992174`, ahead of 0034's `1788412215830`, checked before applying rather than assumed.
- **The private `audit-uploads` bucket exists, created by the migration's own upsert.** RESEARCH Assumption A2 held — the migrating role may write the Storage bucket catalog on hosted Supabase — so the `createBucket` fallback was never needed. It ships anyway, with a `--check` mode that is now the standing assertion the bucket is private.
- **Both new REQUIRED env values are live in Vercel Production and Preview**, the salt generated in a subshell and delivered over stdin so it never touched a file or this workspace's context; read back by metadata only.
- **CI is green** (run `34304180247`: 120 files, 3079 tests, 29 skipped) including the two new DB-backed suites — `tests/audit-request-repository.test.ts` (13 tests) and the extended `tests/rls-coverage.test.ts` (23 tests).
- **Live on the app host:** `/audit` and `/audit/thanks` return 200 signed out, `/audits` still 307s to login, and the rendered form carries `encType="multipart/form-data" method="POST"` with React's `$ACTION_1` / `$ACTION_REF_1` fields — the no-JS POST path is wired, not merely written.

## Task Commits

1. **Task 1 (tracer): End-to-end "request a free audit" — public form to row to operator email + SMS to thanks page** — `f136c8d` (feat)
2. **Task 2: Push migration 0035 to the hosted database, push the two env values, prove the repository + RLS contract in CI** — `3aa275d` (feat)

**Plan metadata:** see the `docs(09-01)` commit that carries this summary.

## Files Created/Modified

**Schema and migration**
- `src/db/schema/audit-requests.ts` — both tables, five closed vocabularies, four CHECKs, two indexes, `is_operator()` policies; the header argues why a request is not a `prospects` row
- `src/db/migrations/0035_phase9_audit_requests.sql` — the one Phase 9 journal entry: generated DDL, the hand-written REVOKE/GRANT block, and the bucket upsert deliberately last
- `src/db/repository/audit-requests.ts` — 11 functions, no `tenantId`, write-once guards, retention stamped by Postgres

**Core**
- `src/core/intake/audit-request.ts` — the zod schema (pure, framework-free), `toAuditFieldErrors`, `TRADE_LABELS` / `BAND_LABELS`
- `src/core/alerts/operator-sms.ts` — `auditRequestSmsBody` (pure, one segment) and `sendOperatorSms` (never throws, global from-number, arming flag ignored)
- `src/core/alerts/operator-email.ts` — `OperatorAlertInput` became a discriminated union; new `audit_request` subject, `auditRequestUrl`, `auditRequestAlertBody`, and control-character stripping
- `src/core/shared/env.ts` — `OPERATOR_ALERT_PHONE` and `AUDIT_IP_HASH_SALT`, schema and pick-list together

**The public site**
- `src/app/(marketing)/layout.tsx` — nested layout with the D-19 landmarks and skip link, free of `getServerEnv()` so the pages prerender
- `src/app/(marketing)/copy.ts` — every public string, verbatim from the Copywriting Contract, in the one file 09-05 swaps
- `src/app/(marketing)/audit/{page,form,actions,action-state,field-error}.tsx|ts` — the form and the session-less action
- `src/app/(marketing)/audit/thanks/page.tsx` — the D-14 confirmation, `robots: noindex`
- `proxy.ts` — anchored exclusions for the public site; the matcher is still one string

**Proof and plumbing**
- `scripts/audit-requests-count.mjs` — the read-only row proof that stands in for the console list until 09-09
- `scripts/setup-storage.mjs` — bucket create + `--check`
- `supabase/config.toml`, `.github/workflows/ci.yml`, `docs/env-vars.md`, `docs/external-registrations.md`, `eslint.config.mjs`, `tests/helpers/env.ts`

## Decisions Made

- **`alertBody` narrowed rather than widened.** Adding `audit_request` to `OperatorAlertKind` would have let an audit request reach the sync body builder and render `Reason: undefined`. A new `SyncAlertKind = Exclude<OperatorAlertKind, 'audit_request'>` types `alertBody` and `SyncAlertInput`, so the compiler refuses the mistake. `tests/sync-failure-alerts.test.ts` was updated to use it (a 2-line cast change; its assertions are untouched).
- **The email URL is resolved from the `kind`, not from an optional field.** An `audit_request` therefore cannot end up linking at `/clients/undefined`.
- **`notify_detail` records the FIRST failing channel only.** Two codes in one column would be a second format for the console to parse; the two outcome columns already say which channel failed.
- **The notify-bookkeeping write is itself wrapped in try/catch.** By that point the request is stored and the operator has been told; losing the bookkeeping is worth a log line and must not turn a successful submission into an error the prospect reads.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Performance/correctness] drizzle `pg-core` was being shipped to the browser on `/audit`**

- **Found during:** Task 1, at the `npx next build` gate.
- **Issue:** The client component imported `AUDIT_REQUEST_TRADES` / `AUDIT_REQUEST_BANDS` and `AUDIT_REQUEST_FIELDS`, which import `@/db/schema` for the closed vocabularies. Measured: the chunk set for `/audit` carried a 96,734-byte chunk containing `Symbol.for("drizzle:entityKind")`, `PgForeignKeyBuilder` and the rest of `pg-core`, plus a 283 KB neighbour — ~389 KB of page-specific client payload on the page LAND-06 asks to score ≥ 90 on a phone.
- **Fix:** The option lists are now resolved to `{ value, label }` on the server page and passed to `AuditRequestForm` as props — the same pattern `NewAuditForm timezones={…}` already uses — and `action-state.ts` names its seven blank fields literally under a `Record<AuditRequestField, string>` annotation, so the totality guarantee moves from a runtime `map` to the compiler and the only remaining reference is an erased `import type`.
- **Files modified:** `src/app/(marketing)/audit/form.tsx`, `src/app/(marketing)/audit/page.tsx`, `src/app/(marketing)/audit/action-state.ts`
- **Verification:** rebuilt from a clean `.next`; `/audit`'s page-specific client payload is now two chunks totalling 13,761 bytes, and no chunk it loads contains `drizzle:entityKind`. All four pure suites, typecheck and lint still pass.
- **Committed in:** `f136c8d` (part of the tracer commit)

**2. [Rule 3 - Blocking] Three source-reading gates failed on the new code's own comments and exports**

- **Found during:** Tasks 1 and 2.
- **Issue:** (a) `tests/lint-ban.test.ts` pins the repository barrel's export list by name, so the 11 new functions failed it; (b) the action's header comment named `forTenant` and `createProspect` while explaining that it must not import them, which failed the plan's own grep gate and the structural test written for it; (c) the migration header and `operator-sms.ts`'s header each mentioned `storage.buckets` / `getChannelConfig('sms')` a second time, so the acceptance-criteria counts read 2 instead of 1.
- **Fix:** The barrel pin gained the eleven names in sorted position with a comment naming the plan; the three explanatory comments were reworded to describe the thing rather than spell its identifier. No behaviour changed and no reasoning was deleted — which is the point of the rule that these gates must read executable code or be written around, never satisfied by removing the explanation.
- **Files modified:** `tests/lint-ban.test.ts`, `src/app/(marketing)/audit/actions.ts`, `src/db/migrations/0035_phase9_audit_requests.sql`, `src/core/alerts/operator-sms.ts`
- **Verification:** `npx vitest run tests/lint-ban.test.ts` (28 passed); every acceptance-criteria grep now returns its expected count.
- **Committed in:** `f136c8d`, `3aa275d`

---

**Total deviations:** 2 auto-fixed (1 × Rule 2, 1 × Rule 3)
**Impact on plan:** No scope change. The bundle fix is the only one that altered a component's interface, and it did so toward an existing in-repo pattern; the plan's `<behavior>`, acceptance criteria and artifact list are all satisfied as written.

## Issues Encountered

- **The plan's `<automated>` verify for Task 2 could not be run as one chained expression** because `npm run db:migrate` is not idempotent-by-exit-code in a way that reads well inside a `&&` chain and the two runs are the assertion. Each step was run and recorded individually instead, and both migrate outputs are quoted in `docs/external-registrations.md` — the acceptance criterion (same recorded count, no DDL on the second run) is met.
- **`tests/sync-failure-alerts.test.ts` cannot run bare** (it is a DB-backed suite behind the `ALLOW_REMOTE_TESTS` gate), so the `SyncAlertKind` edit was proven by `npm run typecheck` locally and by the green CI run against the local stack. This is pre-existing behaviour, not a regression.
- **The bare `npm test` run reports 39 failed files.** All 39 are the DB-backed suites correctly refusing to run against the hosted project without `ALLOW_REMOTE_TESTS`; 2549 tests passed and zero assertions failed. `npm run test:remote` was deliberately never run in this phase.

## User Setup Required

**Both new environment values must be in the founder's `.env.local`** — they are REQUIRED members of `serverEnvSchema`, so every suite that reaches `getServerEnv()` (which is every suite that touches the repository) fails without them. The agent cannot read or write any `.env*` file; this is the 06-02 `STALLED_DIGEST_SECRET` precedent.

```
OPERATOR_ALERT_PHONE=+61491578888
AUDIT_IP_HASH_SALT=<openssl rand -hex 32>
```

Both were confirmed present on 2026-09-09 before this plan ran. The local salt need not match production. `docs/env-vars.md` carries the same instruction for the next machine.

**Production is already done:** both are live in Vercel Production and Preview (`OPERATOR_ALERT_PHONE` as Config, 12 chars, 02:37:08Z; `AUDIT_IP_HASH_SALT` as Secret, 64 chars, 02:37:24Z) and the production deployment aliased to `app.backdesk.com.au` has rebooted with them.

## Outstanding UAT (the plan's `<human-check>`)

Not blocking the next plans, but the tracer's last hop is not claimed until a person does it:

> Signed out on your phone, open `https://app.backdesk.com.au/audit` and submit a test request with your own mobile and email (JS on); then repeat once with JavaScript disabled. Expect `/audit/thanks` both times, an email `Backdesk · Audit request: …` and one SMS on the operator handset within a minute of each submit. Then run `node scripts/audit-requests-count.mjs`: the count should read `2` (the recorded baseline is `audit_requests rows: 0`) and the newest row should show `status=new email=sent sms=sent` with a `notified_at`.

If `sms=not_configured`, the global `messaging_config` sms row has no from-number in production or the ClickSend credentials are absent there — the row is still stored either way, which is the D-13 guarantee.

## Next Phase Readiness

Every expansion plan in this phase now has its foundation:

- **09-03** (honeypot, throttle, CSV): `bumpAuditRequestThrottle` / `sweepAuditRequestThrottle`, `attachAuditRequestCsv` / `clearAuditRequestCsv` / `listExpiredAuditUploads`, `AUDIT_IP_HASH_SALT`, the private bucket and the `AUDIT_THROTTLE_LIMIT` / `AUDIT_UPLOAD_RETENTION_DAYS` constants are all in place. It also owns the "up to 5 MB" → "up to 4 MB" copy change in `AUDIT_FORM_COPY` and the `hasCsv` flag the action currently passes as `false`.
- **09-04** (host-aware routing): `tests/proxy-host-routing.test.ts` exists with the matcher half done; the host half is a second describe block.
- **09-05** (landing page, privacy, styling): `copy.ts` and the marketing layout are the files to extend; the layout deliberately has no fonts, `metadataBase` or stylesheet yet, and `THANKS_COPY`'s two contact literals are marked for the `@/core/brand` swap.
- **09-06 / 09-09** (console detail, list, pre-fill): `listAuditRequests`, `getAuditRequest`, `updateAuditRequestStatus` and `markAuditRequestConverted` are exported and CI-covered; `auditRequestUrl` already points at `/audits/requests/{id}`, which the email and the console must agree on.

**Concerns:** none blocking. The one thing to carry forward is that `notify_sms` may read `not_configured` in production until the global `messaging_config` sms row and the ClickSend credentials are confirmed present there — visible on the row, and by design not a lost request.

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-09*

## Self-Check: PASSED

All 23 claimed files exist on disk; both task commits (`f136c8d`, `3aa275d`) are present in the repository and pushed to `origin/main`.
