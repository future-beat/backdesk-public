---
phase: 11-telephony-capture
plan: 01
subsystem: telephony
tags: [twilio, twiml, webhooks, signature-validation, drizzle, postgres, rls, supabase, vitest]

requires:
  - phase: 04-messaging-activation
    provides: the ClickSend webhook doors (token gate, uniform 200, fixed-string logs, guarded form decoder), the four-bearer env rule
  - phase: 03-cadence-engine
    provides: isInsideWindow / ContactWindow (half-open contact hours in the tenant zone), normalizeAuMobile
  - phase: 10-first-client-go-live
    provides: tenant_proofs (widened here), migration 0036's header and REVOKE-then-GRANT discipline, getEscalationForTenant's tenant-in-predicate read shape
provides:
  - twilio@6.1.1 pinned exactly (checkpoint resolved install-6-1-1)
  - four REQUIRED Twilio env keys + three optional provisioning keys, wired into env.ts, tests/helpers/env.ts, CI dummies and docs/env-vars.md
  - tables tenant_divert_numbers and missed_calls, tenant_proofs kind divert_verification_call — migration 0038_phase11_telephony_capture (written, NOT pushed)
  - repository surface for the whole phase — missed-calls family (insert arrival / complete / upsert from log / get for tenant), forTenant().divertNumber and .missedCalls, forAllTenants_divertNumberByE164, forAllTenants_activeDivertNumbers
  - src/core/telephony/{webhook-url,verify-signature,parse-voice-webhook,caller,greeting,missed-call}.ts
  - POST /api/webhooks/twilio/voice — token gate, canonical-URL signature, one read, deadline-bounded idempotent insert, TwiML greeting
  - pure suites pinning the tracer, the D-04 no-recording invariant, the URL builder and the caller classifier
affects: [11-02, 11-03, 11-04, 11-05, 11-06, 11-07, 11-08, 12-missed-call-text-back]

actuals:
  tokens: 38000
  tasks: 3
  commits: 4

tech-stack:
  added: ["twilio@6.1.1 (exact pin; only the webhooks module is imported, by deep path)"]
  patterns:
    - "Two-factor provider door: URL token (401 before the body) THEN SDK signature over a URL rebuilt from APP_BASE_URL (failure = generic 200 greeting, no write)"
    - "One canonical URL builder shared by verification and provisioning; fails closed (null) when APP_BASE_URL is unset"
    - "TwiML only from greeting.ts, fixed element set, pinned by a comment-stripped structural scan of every telephony source"
    - "Core arrival path never throws: every failure is a closed-union result kind; lookup AND insert race one deadline"
    - "Tenant-less dead letters carry no caller data; tenant identity is the called number only"

key-files:
  created:
    - src/db/schema/tenant-divert-numbers.ts
    - src/db/schema/missed-calls.ts
    - src/db/migrations/0038_phase11_telephony_capture.sql
    - src/db/migrations/meta/0038_snapshot.json
    - src/db/repository/missed-calls.ts
    - src/core/telephony/webhook-url.ts
    - src/core/telephony/verify-signature.ts
    - src/core/telephony/parse-voice-webhook.ts
    - src/core/telephony/caller.ts
    - src/core/telephony/greeting.ts
    - src/core/telephony/missed-call.ts
    - src/app/api/webhooks/twilio/voice/route.ts
    - tests/twilio-voice-route.test.ts
    - tests/telephony-greeting.test.ts
    - tests/telephony-webhook-url.test.ts
    - tests/telephony-caller.test.ts
  modified:
    - package.json
    - package-lock.json
    - src/core/shared/env.ts
    - tests/helpers/env.ts
    - .github/workflows/ci.yml
    - docs/env-vars.md
    - src/db/schema/tenant-proofs.ts
    - src/db/schema/index.ts
    - src/db/migrations/meta/_journal.json
    - src/db/repository/for-tenant.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - tests/lint-ban.test.ts
    - tests/sync-upsert.test.ts
    - src/app/(console)/clients/[id]/actions.ts

key-decisions:
  - "Checkpoint Task 1 resolved by the founder as install-6-1-1: twilio installed at exactly 6.1.1 (--save-exact); postinstall absent; npm audit shows no advisory touching twilio or its seven dependencies"
  - "recordProofAction accepts only the two kinds it can verify (ACTION_PROOF_KINDS) until 11-05 adds the divert_verification_call arm — widening TENANT_PROOF_KINDS must not let an unverified proof through"
  - "Dead letters (unparseable / not_inbound / unknown_number) store no caller number, no raw From and no ForwardedFrom; only unparseable and not_inbound keep the raw body (<= 8000 chars)"
  - "The 6 s deadline bounds the tenant lookup as well as the insert (a hung cold connect must not hold the greeting past Twilio's 15 s)"
  - "Forbidden-verb scan matches element syntax (<Verb followed by whitespace, / or >) so TypeScript generics like Readonly<Record<...>> are not false positives"
  - "CALL_STATUSES is an alias of MISSED_CALL_STATUSES so the parser and the column CHECK cannot disagree"
  - "CAP-01..CAP-04 NOT marked complete in REQUIREMENTS.md: each spans later plans (provisioning 11-04/05, status route + reconcile 11-02, rls pins 11-03); this plan advances all four"

patterns-established:
  - "Twilio route test mould: node:crypto HMAC-SHA1 oracle, twilioPost(params, {token, signature}), untouchable Request for the before-the-body 401 proof, vi.doMock env for the fail-closed base URL"
  - "Structural D-04 scan over readdirSync(recursive) of src/core/telephony and src/app/api/webhooks/twilio with a guard that the glob is non-empty"

requirements-completed: []

coverage:
  - id: D1
    description: "Signed POST for a known number answers 200 text/xml TwiML naming the tenant and inserts exactly one missed_calls row"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/twilio-voice-route.test.ts#answers 200 text/xml naming the tenant and inserts exactly ONE row"
        status: pass
    human_judgment: false
  - id: D2
    description: "Token gate answers 401 before the body is read for no/wrong/truncated/status-route token; bad or absent signature answers the generic greeting with no write and logs signature_rejected"
    requirement: CAP-04
    verification:
      - kind: unit
        ref: "tests/twilio-voice-route.test.ts#voice webhook: the token gate / the signature"
        status: pass
    human_judgment: false
  - id: D3
    description: "Never a 5xx after the gate: unknown number, duplicate, insert throw, lookup throw/hang, unparseable, not_inbound, unreadable body, APP_BASE_URL unset all answer 200 TwiML with a fixed log"
    requirement: CAP-04
    verification:
      - kind: unit
        ref: "tests/twilio-voice-route.test.ts#voice webhook: never a 5xx / APP_BASE_URL unset fails CLOSED"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-04 no-recording invariant: no forbidden TwiML verb or recording API in any telephony source; greeting element set is Response/Pause/Say/Hangup with the D-03 script verbatim"
    requirement: CAP-02
    verification:
      - kind: unit
        ref: "tests/telephony-greeting.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Greeting as spoken by Polly.Olivia-Neural lasts <= 12 s on a real mobile divert"
    requirement: CAP-02
    verification: []
    human_judgment: true
    rationale: "Backstop truth measured live in plan 11-06 (CallDuration on completed callbacks); needs a purchased number and a real handset"
  - id: D6
    description: "Migration 0038 written as one journal entry (idx 38, when 1790525643412 > 1789806076213) with grants, RLS policies and the D-11 header; second db:generate is a no-op"
    requirement: CAP-03
    verification:
      - kind: other
        ref: "npm run db:generate (second run: 'No schema changes, nothing to migrate')"
        status: pass
    human_judgment: false
  - id: D7
    description: "Canonical URL builder fails closed and uses per-route secrets; caller classifier maps sentinels/non-numbers to withheld"
    requirement: CAP-04
    verification:
      - kind: unit
        ref: "tests/telephony-webhook-url.test.ts; tests/telephony-caller.test.ts"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-09-28
status: complete
---

# Phase 11 Plan 01: Telephony capture tracer Summary

**One diverted call answered end to end. A Twilio-signed POST to `/api/webhooks/twilio/voice` (URL token checked first, then the SDK signature over a URL rebuilt from `APP_BASE_URL`) looks up the tenant by the called number, sorts the caller into withheld / mobile / other_number, sets the after-hours flag from the tenant's contact window, writes one idempotent `missed_calls` row with a 6 s deadline, and answers with the D-03 Pause/Say/Hangup greeting. Migration 0038 and the whole phase's repository surface are written and committed, and neither is pushed.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-27T16:08:50Z
- **Completed:** 2026-09-27T16:33:04Z (2026-09-28 AWST)
- **Tasks:** 3 (Task 1 checkpoint resolved by the founder beforehand; Tasks 2 and 3 executed)
- **Files modified:** 31

## Checkpoint resolution (Task 1, gate="blocking-human")

- **Decision:** `install-6-1-1`, made by the founder before this executor started. The orchestrator checked the registry: 6.1.1 is the latest version, the publisher is official, the version is not deprecated, and there are no advisories.
- **Executed:** `npm install --save-exact twilio@6.1.1`. `package.json` now has `"twilio": "6.1.1"` with no caret. `node_modules/twilio/package.json` has no `postinstall` script (only `prepublish: npm run build`). The lockfile is committed.
- **Audit:** after the install, `npm audit` lists 7 findings: next, drizzle-kit/@esbuild-kit/esbuild, js-yaml and sharp. **None of them is twilio or one of its dependencies** (axios, dayjs, https-proxy-agent, jsonwebtoken, qs, scmp, xmlbuilder). All 7 were there before this plan.
- **Deep import:** `twilio/lib/webhooks/webhooks` resolves with no `exports` map, passes typecheck, and bundles in `next build`.

## Accomplishments

- **Env keys:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_WEBHOOK_SECRET` and `TWILIO_VOICE_STATUS_WEBHOOK_SECRET` are REQUIRED. `TWILIO_AU_BUNDLE_SID`, `TWILIO_AU_ADDRESS_SID` and `TWILIO_VOICE_FALLBACK_URL` are optional. All seven are in the env schema and the pick-list. The four required names are in the test-helper REQUIRED list. CI has four distinct dummies: the SID is `AC` + 32 zeros and the other three are 64 characters each. `docs/env-vars.md` gets a section covering the signing-key vs bearer distinction, the push command and the two-sided rotation order, plus seven "Who reads what" rows.
- **Schema:** `tenant_divert_numbers` (UNIQUE on tenant, UNIQUE on number, E.164 CHECK, spoken name limited to 1..60, a pending/active/failed lifecycle, no FK and no delete path, per D-08). `missed_calls` (the `(provider, provider_call_id)` arbiter, nine-status CHECK, dead-letter reasons, a call-id-or-dead-letter table CHECK, a two-arm member/operator policy, and a `(tenant_id, started_at DESC, id DESC)` index). `tenant_proofs_kind_known` is widened.
- **Migration 0038:** a single journal entry. It carries the 0036-style header, the D-11 cadences-generalisation paragraph (`kind`, nullable `quote_id`, `lead_id`, one-live-per-lead arbiter), `DROP CONSTRAINT IF EXISTS` hand-finished, and REVOKE-then-GRANT blocks for both tables with the fabrication and release arguments written out.
- **Repository:** the missed-calls family (ON CONFLICT DO NOTHING arrival insert; exact-match completion UPDATE; a reconcile upsert that fills only NULL completion columns and reports `xmax = 0`; a tenant-in-predicate evidence read that selects no caller number). `forTenant().divertNumber` has get/claim/activate/fail/setSpokenName and no delete. `forTenant().missedCalls` has latest. Two new crossings. Barrel block, lint-ban list (fifteenth and sixteenth crossings) and sync-upsert pins are updated.
- **Core and route:** described in the one-liner. Every log line is a fixed string, and the only interpolation in the route is `result.kind`.

## db:generate output

First run:
```
tenant_divert_numbers 13 columns 0 indexes 0 fks
missed_calls 23 columns 2 indexes 0 fks

[✓] Your SQL migration file ➜ src/db/migrations/0038_pale_baron_zemo.sql 🚀
```
The file was renamed to `0038_phase11_telephony_capture.sql` and the journal tag re-tagged to match. The journal has `idx 38` and `when 1790525643412`, which is later than 0037's 1789806076213, so no re-stamp was needed.

Second run (after the hand-finish):
```
tenant_divert_numbers 13 columns 0 indexes 0 fks
missed_calls 23 columns 2 indexes 0 fks

No schema changes, nothing to migrate 😴
```
`npm run db:migrate` was **not** run. Plan 11-02 pushes the migration under the [BLOCKING] protocol.

## Task Commits

1. **Task 1: Package legitimacy decision.** No commit. The founder resolved it as `install-6-1-1`, and the install is part of 2a.
2. **Task 2a: twilio pin, env keys, schema, migration 0038, repository surface, pins.** `948a825` (feat)
3. **Task 2b: core telephony modules, voice route, route test.** `c32960c` (feat)
4. **Task 3: greeting invariant, URL builder and caller classifier suites.** `f2ed194` (test)

**Plan metadata:** the final docs commit (SUMMARY + STATE + ROADMAP).

Tracer feedback gate: the orchestrator asked for Task 3 to follow directly. The tracer's automated `<verify>` passed end to end first: route, lint-ban, typecheck and lint all green, and sync-upsert's source pins green against a dead localhost stack (see below). Tracer verified end to end, so expansion went ahead.

## Verification

- `npx vitest run tests/twilio-voice-route.test.ts tests/telephony-greeting.test.ts tests/telephony-webhook-url.test.ts tests/telephony-caller.test.ts tests/lint-ban.test.ts`: all green on a bare run (113 telephony tests, plus lint-ban).
- `tests/sync-upsert.test.ts` is DB-backed (it imports `helpers/seed.ts`), so it is CI-only by design. Its two edited source pins ("sixteen named exports" and "nineteen tables") were run on their own with `-t` against a **dead localhost stack**: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999`, both database URLs on `127.0.0.1:59998`, all other values dummies passed inline. Nothing could reach the hosted database. Both passed.
- Negative controls:
  - (a) Changing the mocked auth token made 18 valid-path route tests fail. This shows the node:crypto oracle and the SDK really agree when the token is right.
  - (b) Adding a `<Record/>` to `greeting.ts` made the structural scan and three element-set tests fail. It was reverted and the suite went green again. The test header records this.
- `npm run typecheck`, `npm run lint` and `npx next build` all exit 0.
- Full bare `npx vitest run` with the four Twilio dummies set inline in the command (no file written): **3444/3444 tests pass**. The only failures are 43 suite-level refusals, "Refusing to run integration tests against a non-local Supabase stack", which is the existing production guard. Those suites run in CI.

## Decisions Made

See `key-decisions` in the frontmatter. The two that most affect later plans:
- `recordProofAction` refuses `divert_verification_call` until 11-05 adds that arm.
- Dead letters carry no caller data.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widening TENANT_PROOF_KINDS broke `recordProofAction`'s exhaustive `PROOF_CHANNEL` Record**
- **Found during:** Task 2a (typecheck after the schema edit)
- **Issue:** `PROOF_CHANNEL: Record<TenantProofKind, 'sms'|'email'>` became a compile error. Just adding the key would also have let the zod enum accept an unverifiable `divert_verification_call` proof.
- **Fix:** added `ACTION_PROOF_KINDS`, the two kinds the action can verify (`satisfies` a subset of `TENANT_PROOF_KINDS`), and used it for the zod enum and `PROOF_CHANNEL`. 11-05 widens it when it adds the missed-call arm.
- **Files modified:** `src/app/(console)/clients/[id]/actions.ts`
- **Commit:** 948a825

**2. [Rule 3 - Blocking] `tests/sync-upsert.test.ts` also pins "exactly eighteen tables" reachable from for-all-tenants.ts**
- **Found during:** Task 2a
- **Issue:** the plan names the export-count pin but not the schema-import pin. Importing `tenantDivertNumbers` would have turned it red.
- **Fix:** the pin is now "nineteen", with a recorded argument for `tenantDivertNumbers`: two accessors, id/number/name/window only, no writes.
- **Commit:** 948a825

**3. [Rule 2 - Critical] The deadline also bounds the tenant lookup**
- **Issue:** the plan raced only the insert against the 6 s deadline. A hung cold connect on the lookup would still have held the greeting past Twilio's 15 s ceiling (Pitfall 3).
- **Fix:** one deadline covers both statements. A lookup timeout logs `db_timeout` and serves the generic greeting. Tested with fake timers.
- **Commit:** c32960c

**4. [Rule 1 - Bug] `String.replace` replacement patterns in the spoken name**
- **Issue:** a name containing `$&` would have expanded into the matched `{business}` token.
- **Fix:** the substitution uses a function replacer. Tested.
- **Commit:** c32960c

**5. [Rule 2 - Privacy] Dead letters store no caller data**
- **Issue:** the plan did not say what caller fields an `unknown_number` dead letter gets.
- **Fix:** tenant-less rows get `caller_e164`, `caller_raw` and `forwarded_from_raw` all NULL, and `caller_kind 'withheld'`, meaning "not recorded". A caller's number with no client attached is personal information with no purpose here. The unknown-number row keeps the CallSid and the called number, which is enough to diagnose it.
- **Commit:** c32960c

**6. [Rule 1 - Test precision] The forbidden-element regex requires element syntax**
- **Issue:** research's `/<\s*(Record|…)\b/` matches the TypeScript generic `Readonly<Record<string, string>>` in greeting.ts.
- **Fix:** each verb must be followed by whitespace, `/` or `>`. A self-test covers both the positive and the generic case.
- **Commit:** f2ed194

### Process deviations

- **Requirements not marked complete:** CAP-01..CAP-04 stay Pending in REQUIREMENTS.md. Each is only partly delivered here, and later plans in this phase finish them.
- **Task 2 split into two commits** (2a and 2b), as the checker suggested.

---

**Total deviations:** 6 auto-fixed (2 blocking, 2 critical, 2 bugs/precision) and 2 process deviations.
**Impact on plan:** none of them changes scope. The largest is #1, a deliberate interim narrowing that 11-05 removes.

## Issues Encountered

- **The local `.env.local` does not have the four new REQUIRED keys.** Three pure suites build the real `getServerEnv()` from `.env.local`: `audit-request-action`, `resend-domains` and `stall-claim-isolation`. On a bare `npm test` on this machine they now fail with "Invalid server environment: TWILIO_*" (45 tests). With the four dummies set inline in the command, all 3444 tests pass, so the only cause is the missing local values. CI has the dummies. **Founder action (plan user_setup / the 11-02 checkpoint):** add the four keys to `.env.local` by hand. The agent cannot write `.env*`.
- **Deploying `main` without the four keys in Vercel would fail at the first `getServerEnv()`,** because they are required. This plan does not push. 11-02 pushes the keys (`scripts/push-vercel-env.mjs`) before any deploy.

## Interface-first surface (declared here, consumed later; not stubs)

`completeMissedCall`, `upsertMissedCallFromLog`, `forAllTenants_activeDivertNumbers` and `parseVoiceStatus` are for 11-02. `forTenant().divertNumber.{claim,activate,fail,setSpokenName}` is for 11-04 and 11-05. `getMissedCallForTenant` is for 11-05. `forTenant().missedCalls.latest` is for the 11-05 checklist. The repository/barrel pins are exhaustive, so these are declared once, with no body that returns placeholder data.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat register. The one new public surface is `POST /api/webhooks/twilio/voice`, which is T-11-01/04/05/11/13 in the register. The migration's grants give anon/authenticated SELECT only (T-11-12).

## Next Phase Readiness

- Plan 11-02: founder Twilio-account checkpoint, env push, and the `db:migrate` push of 0038 under the [BLOCKING] protocol. After that come the voice-status route and the call-log reconcile, which use the repository surface declared here.
- Blockers: the founder must add the four Twilio keys to `.env.local` and to Vercel before any deploy of `main`.

## Self-Check: PASSED

- All 16 created files are present on disk (checked with `ls`).
- Commits 948a825, c32960c and f2ed194 are present in `git log`.
