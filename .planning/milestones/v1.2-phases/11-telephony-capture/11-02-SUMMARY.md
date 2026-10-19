---
phase: 11-telephony-capture
plan: 02
subsystem: telephony
tags: [twilio, webhooks, signature-validation, status-callback, migration, supabase, vercel, deploy]

requires:
  - phase: 11-telephony-capture
    provides: "11-01 — migration 0038 (written), completeMissedCall, parseVoiceStatus, twilioWebhookUrl, verifyTwilioSignature, the voice door and its test mould; 11-03/11-04 — reconcile, checklist and DB-backed suites carried by this plan's push"
  - phase: 10-first-client-go-live
    provides: "the hosted-database push protocol (10-01 Task 3) and scripts/push-vercel-env.mjs"
provides:
  - "Migration 0038 live on the hosted Sydney database (39 journal entries; missed_calls and tenant_divert_numbers with RLS and policies)"
  - "Six TWILIO_* keys in Vercel Production and Preview (Secret type)"
  - "Production deployments of the voice door and the new voice-status door, both 401 on a wrong/missing token"
  - "POST /api/webhooks/twilio/voice-status + applyVoiceStatus: the status callback completes a missed_calls row by exact CallSid match, never inserts, never 5xx"
  - "Twilio account / Address / Bundle registration record and the migration-0038 push record in docs/external-registrations.md"
affects: [11-05, 11-06, 11-07, 11-08, 12-missed-call-text-back]

actuals:
  tokens: 10500
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Status callback as the HINT half: exact-match UPDATE or nothing; unparseable = counted log, no row, not even a dead letter; the call-log reconcile is the guarantee"
    - "Uniform { received: true } for every post-gate outcome, including signature rejection — byte-identity pinned by the suite"

key-files:
  created:
    - src/app/api/webhooks/twilio/voice-status/route.ts
    - tests/twilio-voice-status-route.test.ts
  modified:
    - src/core/telephony/missed-call.ts
    - docs/external-registrations.md

key-decisions:
  - "Env pushed before the migration and code push: the env schema requires the four Twilio keys at startup, so the deploy that carries 11-01's env.ts must find them already present"
  - "The two optional identifiers (TWILIO_AU_BUNDLE_SID, TWILIO_AU_ADDRESS_SID) were pushed as Secret like the four required keys, per the plan (no --public)"
  - "applyVoiceStatus passes any status from the closed CALL_STATUSES vocabulary (busy/no-answer/failed/canceled as well as completed) — the parser and the column CHECK share one array, so nothing outside it reaches the UPDATE"
  - "A zero-second CallDuration stores 0, not NULL; an unreadable Timestamp (not only a missing one) falls back to receipt time"

patterns-established:
  - "Twilio status-route suite: the arrival insert and tenant lookup are mocked too and asserted never called on every path, so a regression that created rows from hints fails in the pure suite"

requirements-completed: []

coverage:
  - id: D1
    description: "Signed completed callback updates the matching row by exact (provider, provider_call_id) with call_status, integer duration, RFC 2822 ended_at; answers { received: true }"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/twilio-voice-status-route.test.ts#completes the row by CallSid with status, integer duration and the RFC 2822 end time"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unknown CallSid updates nothing and inserts nothing (unmatched); unreadable/unparseable body is a counted log and no row; signature failure is { received: true } with no write and signature_rejected"
    requirement: CAP-04
    verification:
      - kind: unit
        ref: "tests/twilio-voice-status-route.test.ts#voice-status webhook: never a 5xx, never a new row / the signature"
        status: pass
    human_judgment: false
  - id: D3
    description: "Four-bearer rule: the voice token is rejected by the status door and vice versa"
    requirement: CAP-04
    verification:
      - kind: unit
        ref: "tests/twilio-voice-status-route.test.ts#THE VOICE ROUTE'S token; tests/twilio-voice-route.test.ts#THE STATUS ROUTE'S token"
        status: pass
    human_judgment: false
  - id: D4
    description: "Timestamp parsed with Date.parse, receipt-time fallback; CallDuration integer or NULL; never fails the callback"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/twilio-voice-status-route.test.ts#missing / UNREADABLE Timestamp; missing CallDuration"
        status: pass
    human_judgment: false
  - id: D5
    description: "Migration 0038 applied under the protocol (lease gate, clean generate, migrate exit 0 to 39, no-op second run, RLS read-back) before the code push"
    requirement: CAP-04
    verification:
      - kind: other
        ref: "docs/external-registrations.md#2026-09-28 — Phase 11: migration 0038 pushed to the hosted database"
        status: pass
    human_judgment: false
  - id: D6
    description: "Production answers 401 on both Twilio doors and on a wrong-bearer internal tick (getServerEnv parses with the new keys)"
    requirement: CAP-04
    verification:
      - kind: other
        ref: "curl probes against https://app.backdesk.com.au after deployments dpl_Gvvy6YbcNb6Z9FYDm2fhk1dJoXqa and dpl_CZdtY1stGVDk2FLpMXxtkBH4HtW8"
        status: pass
    human_judgment: false
  - id: D7
    description: "A real Twilio completed callback fills a real row end to end"
    requirement: CAP-03
    verification: []
    human_judgment: true
    rationale: "Needs a purchased number, which waits on bundle approval (plan 11-07) and a live call (11-06/11-08)"

duration: 30min
completed: 2026-09-28
status: complete
---

# Phase 11 Plan 02: Twilio account, migration 0038 to production, and the voice-status door Summary

**Migration 0038 live on the hosted Sydney database under the lease-gated protocol, six Twilio keys in Vercel, both Twilio doors deployed and answering 401 in production, and a signed status callback that completes a `missed_calls` row by exact CallSid match and never creates one.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-28T05:48Z (13:48 AWST)
- **Completed:** 2026-09-28T06:20Z
- **Tasks:** 3 (Task 1 was the founder's checkpoint, resolved before this run)
- **Files modified:** 4

## Accomplishments

- **Task 1 (checkpoint resolved `twilio-ready`):** Account SID `AC00000000000000000000000000000000`, Address SID `AD00000000000000000000000000000000`, Bundle SID `BU00000000000000000000000000000000`, **bundle submitted 2026-09-28 1:32 pm AWST, PENDING review**; recording configurations: empty on 2026-09-28. Recorded in `docs/external-registrations.md` with a Status-at-a-glance row, next check 2026-09-29, support contact after 72 h (2026-10-01), Telnyx fallback trigger (not needed).
- **Task 2:** env pushed, migration applied, `main` pushed (carrying 11-01, 11-03, 11-04), CI green, production Ready, probes 401.
- **Task 3:** `voice-status` door and `applyVoiceStatus` with a 44-test pure suite; deployed and probed.

## The production run, verbatim

```
env:push exit=0          (6 keys, names and lengths only, Production + Preview, Secret)
cron:status exit=0
db:generate exit=0
db:migrate exit=0
second db:migrate exit=0
cron:status(after) exit=0
```

- **Gate before:** `local APP_BASE_URL origin: https://app.backdesk.com.au`, `remote_test_lease rows: 0`, `remote-test-watchdog scheduled: no`, four jobs active on the custom domain.
- **Generator clean:** `No schema changes, nothing to migrate` (journal idx 38, `0038_phase11_telephony_capture`).
- **Journal:** `migrations recorded: 38` before → `Migrations applied. Journal entries recorded: 39`; second run identical, still 39.
- **Read-back:** `missed_calls rowsecurity=true`, `tenant_divert_numbers rowsecurity=true`, policies `missed_calls_member_or_operator_access` and `tenant_divert_numbers_member_access` present; `git status --porcelain src/db/migrations` empty.
- **Push 1:** `370bc0d..88d91b9` — CI run `36384185964` success (first CI run of the 11-03/11-04 DB-backed suites; all passed first time). Deployment **`dpl_Gvvy6YbcNb6Z9FYDm2fhk1dJoXqa`** (`backdesk-7o440wn99`) Ready.
- **Push 2:** `88d91b9..a501b57` — CI run `36384995317` success. Deployment **`dpl_CZdtY1stGVDk2FLpMXxtkBH4HtW8`** (`backdesk-bsidzdsae`) Ready.
- **Gate after:** `remote_test_lease rows: 0`, watchdog unscheduled; `cadence-tick` answered 200 every minute across the deploy.

| Probe (https://app.backdesk.com.au) | Code |
|---|---|
| `POST /api/webhooks/twilio/voice` (no token) | 401 |
| `POST /api/webhooks/twilio/voice?token=wrong` | 401 |
| `POST /api/webhooks/twilio/voice-status?token=wrong` | 401 (404 before push 2) |
| `POST /api/webhooks/twilio/voice-status` (no token) | 401 |
| `POST /api/internal/messaging-reconcile`, `Bearer wrong` | 401 (not 500 — env parses) |
| `cadence-tick` / `sync-tick` / `stalled-digest`, `Bearer wrong` | 401 each |

## Task Commits

1. **Task 1: record the Twilio account and bundle** — `88d91b9` (docs)
2. **Task 2: migration 0038 applied and the tracer deployed** — `57478d1` (docs)
3. **Task 3: voice-status webhook** — `a501b57` (feat), then `8ca7411` (docs: voice-status door probed)

## Files Created/Modified

- `src/app/api/webhooks/twilio/voice-status/route.ts` — token gate (own secret, 401 before the body), canonical-URL signature, `applyVoiceStatus`, uniform `{ received: true }`, fixed-string logs with `result.kind` as the only interpolation
- `src/core/telephony/missed-call.ts` — `applyVoiceStatus(params, deps)`: parse → Date.parse(Timestamp) with receipt fallback → parseInt(CallDuration) or NULL → `completeMissedCall` → `completed | unmatched | unparseable | db_failed`, never throws
- `tests/twilio-voice-status-route.test.ts` — 44 tests: token gate (incl. the voice secret rejected), signature (mismatch/absent/empty/voice-URL/tampered), completion facts, fallbacks, closed-vocabulary pass-through, unmatched/db_failed/unparseable, byte-identical bodies, APP_BASE_URL unset, direct `applyVoiceStatus`, source pins (eight sibling secrets absent, no insert call, proxy exclusion)
- `docs/external-registrations.md` — the Phase 11 Twilio entry + Status row; the migration-0038 push record with the probe lines

## Decisions Made

See `key-decisions` in the frontmatter. In short: env before code; the two identifier SIDs stored as Secret; any closed-vocabulary final status is applied (not only `completed`); zero duration stays 0; an unparseable Timestamp falls back like a missing one.

## Deviations from Plan

None - plan executed exactly as written. (Housekeeping inside Task 3: three unused `_dropped` destructures in the first draft of the suite tripped `--max-warnings=0`; replaced with a `without(key)` helper before the commit.)

## Issues Encountered

- Locally, 44 DB-backed test files refuse to run (no local Supabase stack; the helper refuses non-local targets by design) — expected; all 3,496 pure tests passed locally and the full suite including DB-backed files passed in CI on both pushes.

## User Setup Required

None beyond Task 1, already done by the founder. The bundle is PENDING: check on 2026-09-29; contact Twilio support on 2026-10-01 if no decision. Number purchase is plan 11-07.

## Known Stubs

None. The status route is wired to the real repository UPDATE.

## Next Phase Readiness

- Schema and both doors are live; every later Phase 11 plan deploys against an existing schema.
- Blocked on bundle approval for number purchase (11-07) and live checks (11-06/11-08).

## Self-Check: PASSED
