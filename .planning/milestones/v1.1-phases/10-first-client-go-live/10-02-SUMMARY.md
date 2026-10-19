---
phase: 10-first-client-go-live
plan: 02
subsystem: infra
tags: [ops-scripts, clicksend, resend, postgres, read-only-probes, rfc8058, vitest, evidence]

requires:
  - phase: 04-messaging-gateway
    provides: the setup-clicksend.mjs api() helper mould, the AUTHORIZATION header shape, ResendSender and the List-Unsubscribe/One-Click headers, suppressed_contacts and the both-channel suppression semantics
  - phase: 05-drafting-gate
    provides: the COVERAGE.md matrix shape reused here for the ClickSend account surface
  - phase: 09-audit-requests
    provides: the audit-requests-count.mjs read-only DB shell and the CR-01 connection-string rule; the cron-status-script.test.ts source-pin pattern
  - phase: 10-first-client-go-live
    plan: 01
    provides: the arming switch and checklist these probes are run around
provides:
  - scripts/clicksend-balance.mjs — the D-10 pre-arm balance line from GET /v3/account
  - scripts/escalations-recent.mjs — the CON-03 evidence rows, eight columns, no address and no body
  - scripts/cadence-status.mjs — cadence status/pause/stop plus both suppression facts computed by EXISTS
  - scripts/resend-email-status.mjs — the MSG-02 delivery read-back, pollable by exit code (0/2/1)
  - getEmailStatus(id) in src/core/messaging/resend-emails.ts — the ONE delivery wrapper the proof action and the runbook share
  - verify-email-pipe --cadence <uuid> — the opt-in live one-click path, guarded and loud, ordered before any send
  - tests/ops-scripts.test.ts — 27 pure source-level pins, green on a bare npm test
  - COVERAGE.md for the ClickSend account/billing surface
affects: [10-04, 10-05, 10-06, 10-07, 10-08]

actuals:
  tokens: 15000
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "Read-only production probe: an npm-aliased .mjs in the audit-requests-count/setup-clicksend mould whose whole output is safe to paste into an evidence log — ids, counts, statuses, domains and dates only"
    - "Source-level hygiene suite as the enforcement mechanism for scripts that cannot be run in CI (no credentials, real systems) — readFileSync + comment strip + regex, pure, on a bare npm test"
    - "Ordering pinned by index comparison in the source, not just presence: the cadence lookup must appear before sender.send( — a guard that runs after the send is a comment"
    - "Privacy by SQL shape: a suppression question answered by EXISTS inside the database so the address never enters the Node process"
    - "Two distinct failure exit codes (2 = not yet, 1 = the read broke) so a runbook loop can poll without spinning on a typo"

key-files:
  created:
    - scripts/clicksend-balance.mjs
    - scripts/escalations-recent.mjs
    - scripts/cadence-status.mjs
    - scripts/resend-email-status.mjs
    - src/core/messaging/resend-emails.ts
    - tests/ops-scripts.test.ts
    - .planning/phases/10-first-client-go-live/COVERAGE.md
    - .planning/phases/10-first-client-go-live/deferred-items.md
  modified:
    - scripts/verify-email-pipe.mjs
    - package.json
    - docs/env-vars.md

key-decisions:
  - "A1 HELD: GET /v3/account really does return balance, _currency.currency_name_short, low_credit_amount and auto_recharge — measured on the live account, so the not-found arm never fired"
  - "The balance script's non-200 advice names docs/env-vars.md rather than the two credential variables, because the 'no credential identifier inside a fail() or console call' rule is enforced by regex and a regex cannot tell a variable from prose about one — an absolute rule a machine can check beats a nuanced one it cannot"
  - "resend-email-status exits 0/2/1 with the branch spelled out rather than a ternary: the exit codes are the contract published to the runbook, and grep 'process.exit(2)' is how somebody checks the loop they are about to write"
  - "getEmailStatus bounds last_event to 32 chars (narrower than resend-domains' 48-char codeOf) because this value is compared against 'delivered' AND written into a proof artefact"
  - "escalations-recent selects exactly the eight columns the plan named — quote_id was drafted in and removed, because the pinned truth enumerates eight and a ninth column is a change to the contract, not a convenience"
  - "The --cadence guard runs as step 0, before resolveEmailIdentity opens the database: a refusal must cost nothing, which is also what makes the fictional-id acceptance run safe against production"

patterns-established:
  - "Evidence-log discipline: every new probe's output was designed against the question 'what does this look like when someone re-reads it next quarter' — hence explicit select lists, EXISTS booleans, domains instead of addresses, and e.name instead of e.message"
  - "TDD on scripts: RED commit pins the contract (readFileSync throws on the not-yet-written file), GREEN commit satisfies it — three RED/GREEN pairs here"

# NOT marked complete in REQUIREMENTS.md, deliberately — see "Requirements" below.
# This plan builds the instruments these three requirements are MEASURED with;
# it does not satisfy any of them. ARM-03 and DOM-04 demand live production
# proofs (10-06/10-07 and 10-08); ARM-05 demands a runbook file that does not
# exist yet (10-04).
requirements-completed: []
requirements-advanced: [ARM-03, ARM-05, DOM-04]

coverage:
  - id: D1
    description: "ClickSend pre-arm balance probe: one GET /v3/account, one line carrying balance, currency, low-credit threshold and the auto-recharge flag, never a credential or a URL"
    requirement: ARM-05
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/clicksend-balance.mjs — one GET, one line, no credentials"
        status: pass
      - kind: manual_procedural
        ref: "npm run clicksend:balance → 'clicksend balance: 0.029806 AUD (low-credit threshold 0.50, auto-recharge on)', exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Escalation-evidence reader: eight explicit columns, newest first, --tenant/--limit validated before the statement, recipient address and body segments deliberately unselected"
    requirement: ARM-05
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/escalations-recent.mjs — the CON-03 artefact, with nobody in it"
        status: pass
      - kind: manual_procedural
        ref: "npm run escalations:recent -- --limit 3 → 'escalations: none', exit 0 (read-only against production)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cadence status + both suppression facts, computed by EXISTS so no customer address enters the process"
    requirement: ARM-05
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/cadence-status.mjs — status and suppression, never an address"
        status: pass
      - kind: manual_procedural
        ref: "npm run cadence:status -- --cadence b7a0f041-… → 'cadence: not found', exit 1; bad uuid → refused before connecting"
        status: pass
    human_judgment: true
    rationale: "The not-found arm proves the statement parses and plans (Postgres validates the whole query, EXISTS subqueries included). The FOUND arm's yes/no rendering is unexercised — there are zero live cadences on production today. It is first exercised by a human in plan 10-08, when the DOM-04 one-click click is observed through this script."
  - id: D4
    description: "getEmailStatus(id) — the shared delivery read-back: no-throw, error.name only, last_event bounded, recipient reduced to a domain, body never returned"
    requirement: DOM-04
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#src/core/messaging/resend-emails.ts — delivery evidence, nothing else"
        status: pass
      - kind: unit
        ref: "npm run typecheck (GetEmailResponseSuccess field names confirmed against the installed resend types)"
        status: pass
    human_judgment: true
    rationale: "Nothing here has yet read a REAL Resend email id — no proof email has been sent. Whether a live response carries last_event in the shape the installed types promise is the exact seam a wrapper cannot close on its own; it closes in plan 10-08 against the MSG-02 proof email's id."
  - id: D5
    description: "scripts/resend-email-status.mjs — one line, exit 0 delivered / 2 not-yet / 1 read failed, through the shared wrapper"
    requirement: DOM-04
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/resend-email-status.mjs — last_event, pollable by exit code"
        status: pass
      - kind: manual_procedural
        ref: "npm run resend:email-status -- not-an-id → refused by the id guard before any provider call"
        status: pass
    human_judgment: true
    rationale: "Same seam as D4 — the delivered/not-delivered branches are unexercised against a real email id until the MSG-02 proof email exists."
  - id: D6
    description: "verify-email-pipe --cadence <uuid>: uuid + tenant-ownership + live-status guards running BEFORE resolveEmailIdentity and sender.send, the loud both-channels warning, the exact one-click POST curl printed; the default run stays inert"
    requirement: DOM-04
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#scripts/verify-email-pipe.mjs — the --cadence branch is opt-in and loud (includes the source-order assertion: cadences.getById precedes sender.send)"
        status: pass
      - kind: manual_procedural
        ref: "npm run verify:email-pipe -- --tenant 13e8f2aa… --to nobody@example.com --cadence 00000000-0000-4000-8000-000000000000 → refused at the cadence check, exit 1, no email sent, no PASS lines printed"
        status: pass
    human_judgment: true
    rationale: "Only the REFUSAL arms have been exercised. The accept arm — a live cadence, a real send, a click that suppresses both channels — is the DOM-04 proof itself and is performed by a human on production in plan 10-08."
  - id: D7
    description: "COVERAGE.md for the ClickSend account/billing surface: account.balance INTEGRATE, nine capabilities OPT-OUT with reasons, Phase 4's SMS decisions explicitly not re-opened"
    requirement: ARM-05
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/10-first-client-go-live/COVERAGE.md — 10 rows, 9 OPT-OUT, Phase 4 note line"
        status: pass
    human_judgment: true
    rationale: "A coverage matrix is a set of judgment calls about what this product should and should not reach for. Whether 'never upload contact data to a provider' and 'recharge.purchase is never a code path' are the right calls is the operator's decision, not a test's."

duration: 16min
completed: 2026-09-11
status: complete
---

# Phase 10 Plan 02: Read-Only Production Probes Summary

**Four read-only probes (ClickSend balance, escalation evidence, cadence+suppression, Resend delivery), the shared `getEmailStatus` wrapper, and an opt-in `--cadence` flag whose guards provably run before any send — all pinned by 27 pure source-level assertions that run on a bare `npm test`.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-09-11T05:32Z
- **Completed:** 2026-09-11T05:48Z
- **Tasks:** 3 (each RED → GREEN)
- **Files modified:** 12 (8 created, 4 modified)

## Accomplishments

- **The balance question is now askable, and the answer is alarming.** `npm run clicksend:balance` prints `clicksend balance: 0.029806 AUD (low-credit threshold 0.50, auto-recharge on)`. Three cents. The account is below its own low-credit threshold. Auto-recharge is on, which may or may not fire in time — **this is a go-live blocker for the SMS proof and it was invisible until this plan** (see Next Phase Readiness).
- **Assumption A1 held.** The OpenAPI-mirror field names (`balance`, `_currency.currency_name_short`, `low_credit_amount`, `auto_recharge`) are the real ones — the not-found arm never fired. Currency is AUD.
- **Two database read-backs that cannot leak a person.** `escalations-recent` selects eight columns and pointedly not `to_address` or `body_segments`; `cadence-status` answers "is this contact suppressed" as two `EXISTS` booleans computed inside Postgres, so no customer address ever enters the Node process.
- **One delivery wrapper, two callers.** `getEmailStatus` is what the plan-05 proof action and the runbook script both call, so "what counts as delivered" has exactly one spelling.
- **The `--cadence` ordering is proven, not asserted.** A fictional cadence id was refused against production *before* `resolveEmailIdentity` ran — no `PASS identity-resolved` line, no database identity read, no email. The source-order assertion pins it so it stays that way.

## Task Commits

1. **Task 1: ClickSend balance, npm alias, hygiene suite, COVERAGE.md** — `c1d193b` (test, RED) → `734a3a2` (feat, GREEN)
2. **Task 2: Escalation-evidence and cadence-status probes** — `b41b995` (test, RED) → `e68140b` (feat, GREEN)
3. **Task 3: getEmailStatus, Resend status script, `--cadence` flag** — `01db8e8` (test, RED) → `5abfe67` (feat, GREEN)

**Out-of-scope discovery logged:** `94b4584` (docs)

## Files Created/Modified

- `scripts/clicksend-balance.mjs` — one `GET /v3/account`, one line; `e.name` on a fetch rejection, status-only on a non-200, never the body
- `scripts/escalations-recent.mjs` — the CON-03 artefact; `--tenant`/`--limit` validated before the statement is built, deterministic `ORDER BY created_at DESC, id DESC`
- `scripts/cadence-status.mjs` — cadence status/pause/stop plus `sms_suppressed` / `email_suppressed` via `EXISTS`; the snapshot address columns appear exactly once each, both inside a SQL predicate
- `scripts/resend-email-status.mjs` — `last_event` + recipient domain; exit 0 delivered, 2 not-yet, 1 read failed
- `src/core/messaging/resend-emails.ts` — `getEmailStatus(id)`; no-throw union, `boundedCode()` capped at 32 chars, `domainOfAddress` for the recipient, body never returned
- `scripts/verify-email-pipe.mjs` — step 0 `--cadence` guard (uuid → tenant ownership → live status), the loud both-channels warning, and the exact one-click `curl` printed beside the headers
- `tests/ops-scripts.test.ts` — 27 assertions across six describes; shared `expectReadOnlyDbScript` carries the CR-01 connection-string rule
- `.planning/phases/10-first-client-go-live/COVERAGE.md` — 10 capabilities, 1 INTEGRATE, 9 OPT-OUT
- `package.json` — `clicksend:balance`, `escalations:recent`, `cadence:status`, `resend:email-status`
- `docs/env-vars.md` — reader rows for `MIGRATE_DATABASE_URL`, both ClickSend variables and `RESEND_API_KEY`. **No new environment variables.**

## Decisions Made

See `key-decisions` in the frontmatter. The two worth repeating:

- **The balance script's non-200 message does not name `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY`.** The hygiene rule is "no credential identifier inside a `fail()` or a `console` call", enforced by regex — and a regex cannot distinguish a variable from prose about a variable. Rather than weaken the rule to accommodate one helpful sentence, the sentence points at `docs/env-vars.md`, where the names live anyway. An absolute rule a machine can check is worth more than a nuanced one it cannot.
- **`escalations-recent` selects eight columns, not nine.** `quote_id` was drafted in (it is our own uuid, not PII, and useful for attribution) and then removed: the plan's pinned truth enumerates eight columns, and widening a pinned contract mid-execution because it seemed convenient is how contracts stop meaning anything. If the ninth column is wanted, that is a plan change.

## Deviations from Plan

**None affecting scope or contract.** Two small corrections made while executing, both to my own first draft rather than to the plan:

1. Removed `quote_id` from `escalations-recent`'s select list (above) to match the pinned eight-column truth.
2. Replaced a ternary exit with explicit `process.exit(0)` / `process.exit(2)` branches in `resend-email-status.mjs`, so the published exit-code contract is greppable.

Neither touched behaviour the plan specified.

## Issues Encountered

### `tests/lint-ban.test.ts` is red on `main`, and it is not this plan's doing

The bare `npx vitest run` gate surfaced exactly one genuine failure: `tests/lint-ban.test.ts:367` pins the sorted export list of the RLS-bypassing repository barrel, and **plan 10-01 added `listChannelAudit` to the barrel without adding it to the pin**. It reproduces at `8dae60e` (10-01's final commit), before any 10-02 commit, and this plan adds no repository export.

Per the scope boundary it was logged rather than fixed — `.planning/phases/10-first-client-go-live/deferred-items.md` and `.planning/WINDOWS.md` entry 37. **The fix is one line** (add `'listChannelAudit'` to the array) and belongs to 10-01. It should be done before the next plan runs: this is the repo's CI-blocking gate on the data surface, and a gate that is red for a known-benign reason is a gate people start waving through.

*(Context for the run counts: 40 of the 41 "failed" test files are the designed refusal — `Refusing to run integration tests against a non-local Supabase stack` — which is the correct and expected state on this machine without `ALLOW_REMOTE_TESTS`. Per the standing rule, `npm run test:remote` was **not** run.)*

### Nothing was sent, by design

Every provider interaction in this plan was a read or a refusal. The ClickSend call was a `GET`. The Resend script was exercised only through its id guard. `verify-email-pipe` was run twice against production and refused twice — once at the cadence check (fictional id) and once at identity resolution (the test tenant's email row is disarmed). No SMS, no email.

## User Setup Required

None for this plan — no new environment variables and no dashboard configuration.

**But one operator decision is now on the table:** ClickSend's balance is $0.03 AUD against a $0.50 low-credit threshold. Top up before the SMS proof, and decide whether to rely on auto-recharge (currently `on`) or fund the account manually. That is a dashboard action, deliberately not a code path (see COVERAGE.md, `recharge.purchase`).

## Next Phase Readiness

**Ready:**
- The runbook (10-04) can now name a real command and a real artefact for the balance check, the escalation evidence, the cadence read-back and the email delivery read-back.
- The proof actions (10-05) have `getEmailStatus` to verify `last_event === 'delivered'` before writing a proof row.
- The DOM-04 proof (10-08) has the `--cadence` path and the printed one-click `curl`.

**Blockers / concerns for later plans:**
1. **ClickSend balance is $0.03 AUD.** The first live SMS will fail with `INSUFFICIENT_CREDIT` exactly as it did in Phase 9 unless the account is topped up. This is the D-10 step doing its job on its first run.
2. **`tests/lint-ban.test.ts` is red** (above). One line, 10-01's territory.
3. **Three deliverables are proven only on their refusal arms** (D3's found-arm rendering, D4/D5 against a real Resend id, D6's accept path). All three close in 10-08 against real artefacts — that is where they were always going to close, and the `human_judgment: true` flags say so rather than letting a green suite imply otherwise.

---
*Phase: 10-first-client-go-live*
*Completed: 2026-09-11*

## Requirements

The plan's frontmatter names `ARM-03`, `ARM-05` and `DOM-04`, and the state-update
step duly checked all three off in `REQUIREMENTS.md`. **That was reverted.**

None of them is satisfied by this plan and none is close:

| Requirement | What it demands | Where it actually closes |
|---|---|---|
| ARM-03 | the CON-03 escalation proof *executed on production and recorded* | 10-06 / 10-07 |
| ARM-05 | *a written runbook in `docs/`* — no such file exists yet | 10-04 |
| DOM-04 | the live email proof *executed*, delivered, one-click POST answered | 10-08 |

What this plan built is the **instruments those three are measured with**. A tick
in the requirements ledger against an unexecuted production proof is precisely
the green-over-unproven-work this project's own code comments keep warning
about, and it would have been read later as evidence that the proof happened.
The plan's `requirements:` field means "this plan contributes to these", not
"this plan completes them"; the completing plans will mark them.

## Self-Check: PASSED

All 8 created files and 1 modified-script claim verified present on disk; all 7 commit hashes verified in `git log`. Every acceptance grep in the plan re-run and satisfied (npm aliases 1/1/1/1, `getEmailStatus` export 1, loud line 1, `one-click POST:` 1, `randomUUID()` 2, `ORDER BY created_at DESC, id DESC` 1, `EXISTS` 5, `tests/ops-scripts.test.ts` 310 lines ≥ 80). `npm run lint`, `npm run typecheck` and `npx vitest run tests/ops-scripts.test.ts` (27 passed) all green.
