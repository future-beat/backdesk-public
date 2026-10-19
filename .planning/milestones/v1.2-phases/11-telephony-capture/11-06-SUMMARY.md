---
phase: 11-telephony-capture
plan: 06
subsystem: telephony
tags: [twilio, ops-scripts, evidence, runbook, coverage, privacy]

requires:
  - phase: 11-telephony-capture
    provides: "11-01 missed_calls schema; 11-03 reconcileMissedCalls, listInboundCalls, twilioCredsFromEnv; 11-05 the console labels and DIVERT_ORPHANED_MESSAGE pointing at the runbook"
provides:
  - "npm run twilio:numbers-search — one GET to AvailablePhoneNumbers/AU/Local via the Sydney edge; settles A5"
  - "npm run missed-calls:recent — the CAP-03 evidence reader; caller-number columns only as IS NOT NULL booleans"
  - "npm run verify:missed-call-reconcile — the real reconcile once, through ts-alias-hook, with the S7 inbound-call count"
  - "docs/telephony-runbook.md — the founder-facing runbook for every Phase 11 live step (sections 0-12)"
  - "COVERAGE.md — the Twilio surface, 13 INTEGRATE / 15 OPT-OUT"
affects: [11-07, 11-08, 12-missed-call-text-back]

tech-stack:
  added: []
  patterns:
    - "Negative-lookahead source pin: a PII column may appear only as `(col IS NOT NULL)`"
    - "Provider probe with the Authorization header built inline in the fetch call, never bound to a name"

key-files:
  created:
    - scripts/twilio-numbers-search.mjs
    - scripts/missed-calls-recent.mjs
    - scripts/verify-missed-call-reconcile.mjs
    - docs/telephony-runbook.md
    - .planning/phases/11-telephony-capture/COVERAGE.md
    - .planning/phases/11-telephony-capture/deferred-items.md
  modified:
    - package.json
    - tests/ops-scripts.test.ts

key-decisions:
  - "verify-missed-call-reconcile loads the core through scripts/lib/ts-alias-hook.mjs, not ts-resolve-hooks.mjs: reconcile.ts imports @/ aliases, which the resolve-only hook deliberately does not support"
  - "The runbook reads reconcile `recovered` as 'calls converged in the 48 h window', not 'rows changed'. The drill proof is the row's completed_via reading, never the count (the plan's `recovered=1` expectation would have failed on any drill run after a verification call)"
  - "The dropped-callback drill saves the exact Status Callback URL to the password manager before editing one token character, and restores by pasting it back"
  - "The runbook has an orphaned-number trap section: never buy again; record the PN sid; activate the pending row by a quick task through the repository, never a hand-typed UPDATE"

requirements-completed: []

coverage:
  - id: D1
    description: "Search script: one fetch, GET, Sydney edge, the single AU/Local path, InLocality, e.name only, status-not-body, no credential in console/fail, --locality validated before the request, exit 2 on none"
    requirement: CAP-01
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/twilio-numbers-search.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "Evidence reader: read-only (expectReadOnlyDbScript), caller_e164 and forwarded_from_raw only inside IS NOT NULL, the raw-From and payload columns absent, uuid and limit validated before the statement, single ORDER BY started_at DESC, id DESC"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/missed-calls-recent.mjs"
        status: pass
      - kind: other
        ref: "npm run missed-calls:recent -- --limit 3 against production: exit 0, `missed calls: none`, no +61"
        status: pass
    human_judgment: false
  - id: D3
    description: "Verify script: one register(), the real reconcile.ts, production notice before import, no SQL of its own, counts only, closeDb"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/verify-missed-call-reconcile.mjs"
        status: pass
    human_judgment: false
  - id: D4
    description: "Runbook and COVERAGE.md pass every acceptance grep"
    requirement: CAP-04
    verification:
      - kind: other
        ref: "plan 11-06 Task 2 acceptance greps"
        status: pass
    human_judgment: false
  - id: D5
    description: "The drill, the spike and the verification call are run from this runbook"
    requirement: CAP-03
    verification: []
    human_judgment: true
    rationale: "Live founder steps in plans 11-07/11-08; they need an approved bundle and a bought number"

actuals:
  tokens: 21000
  tasks: 2
  commits: 3

duration: 20min
completed: 2026-09-28
status: complete
---

# Phase 11 Plan 06: Telephony ops scripts, runbook and Twilio coverage Summary

**Three instruments for the live Phase 11 steps:**

- **A read-only Perth number search.** It settled A5 today: 10 candidates, and the bundle is still pending.
- **A missed-call evidence reader.** It prints no caller number anywhere.
- **A one-shot run of the real reconcile.** This is for the dropped-callback drill.

The plan also adds the founder's telephony runbook and a Twilio coverage matrix of 13 INTEGRATE and 15 OPT-OUT rows.

## Performance

- **Duration:** about 20 min
- **Started:** 2026-09-28T06:43Z (14:43 AWST)
- **Completed:** 2026-09-28T07:05Z
- **Tasks:** 2
- **Files:** 8 (6 created, 2 modified)

## Accomplishments

**`twilio:numbers-search`**
- One `fetch`, method `GET`, to `https://api.sydney.us1.twilio.com/2010-04-01/Accounts/<sid>/AvailablePhoneNumbers/AU/Local.json?InLocality=…&VoiceEnabled=true&PageSize=10`.
- The Basic header is built inside the fetch call and never bound to a name.
- A fetch rejection prints `e.name` only. A non-200 prints `returned ${status}` and never the body.
- Exit 2 prints `none for <locality>`. There is no write verb and no `IncomingPhoneNumbers` in the file.

**`missed-calls:recent`**
- Uses the `escalations-recent` shell verbatim.
- The select list is explicit. `caller_e164` and `forwarded_from_raw` appear only as `(… IS NOT NULL) AS caller_present / forwarded_from_present`.
- The raw-From and dead-letter payload columns are never named, not even in comments.
- Arguments are validated before the statement. The CR-01 URL guard is in place, and both arms call `sql.end`.

**`verify:missed-call-reconcile`**
- Prints a two-line production notice, then loads `reconcile.ts` and `twilio-client.ts` through `ts-alias-hook`.
- Lists inbound calls for the last 48 h and prints the count (S7), then runs `reconcileMissedCalls()` once.
- Prints `skipped`, `recovered` and `recordings`, then calls `closeDb()`.
- Has no SQL of its own.

**Pins**
- `tests/ops-scripts.test.ts` gains four describe blocks and 17 tests: the three scripts and the three `package.json` aliases.
- The suite now has 54 tests, all passing bare.

**`docs/telephony-runbook.md`** (sections 0–12, 431 lines)
- Before anything: the log-grep table, covering all four `[twilio]` strings and the three `[telephony]` lines.
- The recording posture and the bundle, with its Individual fallback, the address and the Telnyx trigger.
- The env keys and rotation order, with the 401 probe `curl`s.
- Search: read the prefix, not only the locality.
- Console purchase and the Console read-back table, plus the orphaned-number trap.
- The optional generic TwiML Bin.
- The verification call and proof, with S5 at 13 s or less, and the S7 check.
- The nine-step dropped-callback drill.
- The three-carrier spike: the `**61*`, `**62*` and `**67*` codes, the `##6x#` clears, the `*#61#` check, the iPhone unconditional-forwarding trap, `#31#`, the evidence table and the pass criteria.
- The evidence template and the never-done list.
- The console labels are quoted verbatim.

**`COVERAGE.md`**
- 13 INTEGRATE rows, each naming the file that consumes it.
- 15 OPT-OUT rows, each with a one-line reason.
- The "SMS stays on ClickSend (Phase 4)" note, in the header and the footer.

## Live runs (read-only)

| Command | Exit | Output (no numbers) |
|---|---|---|
| `npm run missed-calls:recent -- --tenant not-a-uuid` | 1 | `--tenant must be a uuid, got: not-a-uuid` (refused before connecting) |
| `npm run missed-calls:recent -- --limit 0` | 1 | `--limit must be a whole number from 1 to 50, got: 0` |
| `npm run missed-calls:recent -- --limit 3` (production) | 0 | `missed calls: none`; `+61` count 0 |
| `npm run twilio:numbers-search` | **0** | **10 candidates for Perth**. All 10 had `locality=Perth region=Western Australia address_requirements=local`. By prefix class: 8 × `+61 8 7…`, 1 × `+61 8 5…`, 1 × `+61 3 6…` |
| `node --check scripts/verify-missed-call-reconcile.mjs` | 0 | not run (it writes; plan 11-07 runs it in the drill). A load-only check with a dummy `DATABASE_URL` confirmed the alias hook resolves `reconcile.ts` and `twilio-client.ts` |

**A5 is settled.**
- `InLocality=Perth` returns AU local inventory.
- The search is not refused while the bundle is pending.
- `address_requirements=local` means an AU address, and that address is already registered.

## Task Commits

1. **Task 1: telephony ops scripts: search, evidence reader, one-shot reconcile.** Commit `659bee1` (feat).
2. **Task 2: telephony runbook and Twilio coverage matrix.** Commit `0083737` (docs). It also carries the corrected `recovered` wording in the verify script's header and `deferred-items.md`.

## Verification

**Local checks**
- `npx vitest run tests/ops-scripts.test.ts`: 54 of 54 pass.
- `npm run typecheck` and `npm run lint` (`--max-warnings=0`) are both clean.
- Full bare suite: 3,637 tests passed. The 44 DB-backed files refuse to run locally by design.

**Acceptance greps (all pass)**
- `fetch(` 1, `method: 'GET'` 1, sydney host 1, write verbs 0.
- `caller_raw|raw_payload` 0. Each IS NOT NULL alias 1. ORDER BY 1. `SELECT *` 0.
- `register(` 1. Describe blocks 3.
- Runbook:
  - 431 lines, 14 headings
  - divert-code lines 3, `#31#` 2
  - `verify:missed-call-reconcile` 2+, `missed-calls:recent` 7+
  - `signature_rejected` 2, label lines exactly 3
  - `+61` followed by 9 digits: 0
- COVERAGE: INTEGRATE 13, OPT-OUT 15, every OPT-OUT reason is non-empty, `Phase 4` appears 4 times.

**CI and production**
- CI run `36388762332` on `00837376b5acedf656edb2f95608548757c22903`: **success**.
- Production deployment `dpl_EVLAPogYL4coEgT5r6BW1vEYLacL` (`backdesk-g0h9ca6z9`): **Ready**, created 14:53:59 AWST at the push. `https://app.backdesk.com.au/login` returns 200.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The verify script uses `ts-alias-hook.mjs`, not `ts-resolve-hooks.mjs`**
- **Found during:** Task 1
- **Issue:** The plan's key_link names `register('./lib/ts-resolve-hooks.mjs')`. That hook deliberately supports no `@/` alias, and `reconcile.ts` imports `@/db/repository`, `@/core/brand` and others. The import would have failed.
- **Fix:** Registered `./lib/ts-alias-hook.mjs`, the hook `pause-client.mjs` and RESEARCH Open Question 6 name. The pin asserts it. A load-only check confirmed resolution.
- **Commit:** 659bee1

**2. [Rule 1 - Bug] The runbook no longer expects `recovered=1` in the drill**
- **Found during:** Task 2
- **Issue:** `convergeCalls` counts every inbound call to an owned number in the 48 h window, whether it was inserted or rewritten idempotently. After the verification call, a drill run reads at least 2, so the plan's `recovered=1` pass line would have failed a correct drill.
- **Fix:** Runbook §8, §9 step 6 and the evidence template now say "at least 1; the count is not the proof". The row's `completed_via` (`-` then `reconcile`) and the unchanged row count are the proof. The verify script's header says the same.
- **Commit:** 0083737

**3. [Rule 2 - Missing critical] The runbook has an orphaned-number section**
- **Found during:** Task 2
- **Issue:** `DIVERT_ORPHANED_MESSAGE` (11-05) sends the operator to this runbook to "attach the PN sid by hand", but the plan's section list had no such step.
- **Fix:** §5 now has a "Trap: orphaned number" section:
  - never buy again
  - grep `provision orphaned_number` for the sid
  - record the sid only
  - activate the pending row by a quick task through the repository
  - never a hand-typed UPDATE, never a release
- **Commit:** 0083737

**Minor additions:**
- The search script refuses `AreaCode` / `InRegion` (pinned).
- The status-door `handled` kinds are listed in the log table.
- The Auth Token rotation trap is included.
- COVERAGE has three rows beyond the minimum: `<Pause>`, outbound calls, and the fallback URL at purchase.

## Issues Encountered

**A defect found by the live search (logged, not fixed; out of scope):**
- The first "Perth" candidate Twilio returned was a `+61 3 6…` number. The console's Find action shows `candidates[0]`, and the Buy action's zod schema accepts only `^\+618\d{8}$`. If Twilio keeps that order on the day, Find offers a number that Buy refuses.
- Logged as D-11-06-1 in `.planning/phases/11-telephony-capture/deferred-items.md`.
- Suggested one-line fix: in `searchAuLocalNumbers`, narrow the `inLocality` page client-side to `+618`, as the fallback page already is.
- Runbook §4 carries the workaround.
- **This should be fixed before plan 11-07's purchase.**

## Known Stubs

None. `DIVERT_ORPHANED_MESSAGE`'s pointer to `docs/telephony-runbook.md` (11-05's known stub) now resolves.

## Threat Flags

None beyond the plan's register:
- T-11-04, T-11-16 and T-11-14 are mitigated and pinned.
- T-11-09 is accepted as planned. The drill saves the URL to the password manager, never to the repo.

## Self-Check: PASSED

- FOUND: scripts/twilio-numbers-search.mjs, scripts/missed-calls-recent.mjs, scripts/verify-missed-call-reconcile.mjs, docs/telephony-runbook.md, .planning/phases/11-telephony-capture/COVERAGE.md, .planning/phases/11-telephony-capture/deferred-items.md
- FOUND: 659bee1, 0083737
