---
phase: 04-messaging-gateway
plan: 01
subsystem: messaging
tags: [sms, compliance, spam-act, postgres, rls, drizzle, clicksend, opt-out]

requires:
  - phase: 03-cadence-engine
    provides: killContact/suppressFromInbound's transaction shape, the suppressed_contacts table and its D-06 grant-layer irreversibility, dispatch's just-in-time suppression probe, normalizeAuMobile, the cadence contact snapshot
  - phase: 01-foundation
    provides: has_tenant_access()/is_operator() RLS helpers, the migration journal discipline, forTenant() scoping
provides:
  - inbound_messages evidence table (nullable tenant_id, closed attribution vocabulary, two-arm RLS policy) + migration 0025
  - insertInboundMessage / findInboundByProviderMessageId repository family
  - isStopMessage — the anchored whole-message opt-out regex
  - suppressFromInbound — the D-16 control-surface entry point for channel-originated opt-outs
  - forAllTenants_cadencesByContactMobile — the cross-tenant reply-threading lookup
  - handleInboundSms — the STOP single-match spine, proven end-to-end against the hosted DB
  - All six new Phase 4 env keys, CI-dummied, documented, schema-validated
affects: [04-02 inbound route, 04-03 clicksend sender, 04-04 dlr + reconcile, 04-05 email unsubscribe, 04-06 triage console, 07 attribution]

actuals:
  tokens: 80225
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Evidence tables may carry a NULLABLE tenant_id when the record must survive being unattributable; the RLS policy then needs an explicit is_operator() arm or the rows that most need a human become invisible to everyone"
    - "A control-surface transaction is extracted and parameterized on its EVIDENCE (source, reason) rather than copied per caller, so behaviour cannot drift between the operator path and the channel path"
    - "A compliance write is ordered BEFORE its evidence write, because a failed evidence write is recoverable by provider retry and a false 'handled' record is not"

key-files:
  created:
    - src/db/schema/inbound-messages.ts
    - src/db/repository/inbound-messages.ts
    - src/db/migrations/0025_inbound_messages.sql
    - src/core/messaging/stop-keywords.ts
    - src/core/messaging/inbound.ts
    - tests/stop-keywords.test.ts
    - tests/inbound-stop.test.ts
  modified:
    - src/core/cadence/controls.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/core/shared/env.ts
    - docs/env-vars.md
    - .github/workflows/ci.yml
    - tests/rls-coverage.test.ts
    - tests/sync-upsert.test.ts
    - tests/lint-ban.test.ts
    - tests/helpers/env.ts
    - tests/helpers/seed.ts

key-decisions:
  - "An inbound STOP rides the matrix's existing contact_killed arm rather than a new opt_out event: what differs between an operator kill and a customer texting STOP is the EVIDENCE (suppressed_contacts.source), not the transition"
  - "inbound_messages.tenant_id is nullable and the RLS policy carries an explicit is_operator() arm — an unattributable reply is recorded rather than dropped, and has_tenant_access(NULL) can never admit it"
  - "The suppression write happens BEFORE the inbound evidence row: a failed row write is recovered by the provider's retry (suppression is idempotent at the unique index), whereas a row claiming attribution 'threaded' beside a customer still being chased reads to every later human as 'handled'"
  - "isStopMessage is anchored to the whole trimmed message, and 'STOP?' deliberately does NOT match — a question mark makes it a question, and the non-matching branch still records the message for a human, so strictness costs a few minutes and looseness costs a customer permanently"
  - "stop\\s*all is ordered before the bare stop alternative because alternation is first-match-wins — reversed, 'STOP ALL' matches 'stop' then fails on the leftover, making the MORE emphatic opt-out the one that does not register"
  - "cadences became reachable from the cross-tenant file for the first time, from exactly one accessor with a pinned select list — an inbound reply carries a phone number and no tenant, so 'whose cadence is this?' has no scope to be asked from"
  - "The gate-chain assertion (a real dispatch tick refusing a second live cadence for the same human) is the only test that can distinguish 'suppression written' from 'suppression written in a spelling that suppresses' — every other assertion in the suite passes either way"
  - "Four separate Phase 4 bearers rather than one shared secret: rotating a shared value would 401 the inbound webhook, the DLR callback, the unsubscribe links and the reconcile tick simultaneously, dropping customers' STOPs at the door"

patterns-established:
  - "Attribution vocabulary (threaded/ambiguous/unmatched/dead_letter) states CONFIDENCE about whose conversation a message is, independently of what was done about it — an ambiguous opt-out is recorded and never acted on, because D-06 suppression is irreversible"
  - "Remote suites that create NULL-tenant rows must delete them BY ID in afterAll; teardownTenants keys on tenant_id and cannot reach them"
  - "Source-guarantee tripwires are widened WITH a written argument in the same commit, never silently re-baselined"

requirements-completed: [MSG-03]

coverage:
  - id: D1
    description: "An SMS body that is entirely a stop keyword is recognised as an opt-out; a body that merely contains one never is"
    requirement: "MSG-03"
    verification:
      - kind: unit
        ref: "tests/stop-keywords.test.ts#isStopMessage — the anchored whole-message rule"
        status: pass
    human_judgment: false
  - id: D2
    description: "A STOP from a mobile with exactly one live cadence suppresses BOTH the mobile and the paired snapshot email (source sms_stop), stops the cadence with the matrix-derived reason, and skips its unsent touches"
    requirement: "MSG-03"
    verification:
      - kind: integration
        ref: "tests/inbound-stop.test.ts#threads a STOP from a differently-spelled mobile and suppresses BOTH channels"
        status: pass
    human_judgment: false
  - id: D3
    description: "After an inbound STOP, a dispatch tick that claims a live touch for the same address refuses it with reason suppressed — the STOP-written rows are probe-visible to dispatch's existing JIT gate"
    requirement: "MSG-03"
    verification:
      - kind: integration
        ref: "tests/inbound-stop.test.ts#makes dispatch refuse a live approved touch for the suppressed address"
        status: pass
    human_judgment: false
  - id: D4
    description: "An inbound from '0412 345 678' and '+61412345678' resolve to the same cadence — matching keys on normalizeAuMobile output on both sides (MSG-04 encoding edge)"
    requirement: "MSG-03"
    verification:
      - kind: integration
        ref: "tests/inbound-stop.test.ts#threads a STOP from a differently-spelled mobile and suppresses BOTH channels"
        status: pass
    human_judgment: false
  - id: D5
    description: "inbound_messages exists on the hosted DB behind RLS, read-only to authenticated, with unattributed rows admitted to the operator only"
    requirement: "MSG-03"
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#admits unattributed inbound rows to the operator ONLY (T-4-04)"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#grants exactly the documented privileges and nothing inherited (WR-04)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A repeat STOP from an already-suppressed contact is an idempotent no-op that still records a fresh inbound_messages row (the plan's flagged assumption)"
    verification:
      - kind: integration
        ref: "tests/inbound-stop.test.ts#records a repeat STOP without duplicating the suppression"
        status: pass
    human_judgment: false
  - id: D7
    description: "All six new Phase 4 env keys are schema-validated, CI-dummied and documented; the four required secrets are present in Vercel Production"
    verification:
      - kind: other
        ref: "npx tsc --noEmit (env schema + pick-list) and .github/workflows/ci.yml dummy block"
        status: pass
    human_judgment: true
    rationale: "The Vercel Production side was set by the operator through the dashboard (the Vercel CLI is not installed on this machine), so no automated check in this repo can observe it. A human must confirm the four names exist under Project → Settings → Environment Variables → Production."

duration: 40min
completed: 2026-08-29
status: complete
---

# Phase 4 Plan 01: Inbound-STOP Compliance Spine Summary

**A customer texting "STOP" now ends, in one function call, with both their mobile and their email irreversibly suppressed, their cadence stopped as `contact_suppressed`, their unsent touches skipped, and a recorded `inbound_messages` row — written in exactly the spelling dispatch's just-in-time gate probes, proven by a real dispatch tick refusing a second live cadence for the same human.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-29T02:04:00Z
- **Completed:** 2026-08-29T02:44:00Z
- **Tasks:** 2
- **Files modified:** 21 (7 created, 14 modified)

## Accomplishments

- **The compliance spine is real end-to-end on the hosted DB.** `handleInboundSms({from: '0412 345 678', body: 'STOP'})` → both-channel suppression byte-equal to the cadence snapshot with `source: 'sms_stop'` → cadence `stopped`/`contact_suppressed` → three touches skipped `suppressed` → a `threaded` evidence row with `normalized_from: '+61412345678'`.
- **The gate chain closes.** A second live cadence for the same human, with a touch approved *before* the STOP arrived, is refused by a real `dispatchDueTouches` tick with reason `suppressed`. This is the only assertion that distinguishes "a suppression row exists" from "a suppression that actually suppresses" — the enqueue → suppress → refuse case MSG-03 means by "immediate at the send gate".
- **`inbound_messages` is on the hosted DB behind RLS**, read-only to `authenticated`, with a two-arm policy so unattributable replies (`tenant_id IS NULL`) are visible to the operator and to nobody else.
- **`killContact`'s transaction is now shared, not copied.** It was extracted into a private `suppressAndStop` parameterized only on the evidence strings; `killContact`'s own suite passes unchanged, and `suppressFromInbound` is the second caller of exactly the same four decisions.
- **All six new Phase 4 env keys** are schema-validated (schema *and* pick-list), CI-dummied, documented, and mirrored in `tests/helpers/env.ts`'s REQUIRED gate.
- **Full remote suite green:** 52 files, 1134 tests, hosted Sydney DB, production crons paused and re-armed cleanly.

## Task Commits

1. **Task 1: inbound_messages schema + repository module + six Phase 4 env keys + migration** — `ea7e82b` (feat)
2. **Task 2 (RED): failing stop-keyword matrix** — `3e2b2ef` (test)
3. **Task 2 (GREEN): isStopMessage anchored regex** — `36e5704` (feat)
4. **Task 2: the STOP spine — suppression → stop → skip → dispatch refusal** — `ef1fe94` (feat)

_Task 2 carried `tdd="true"`, hence the test → feat pair before the integration commit._

## Files Created/Modified

**Created**
- `src/db/schema/inbound-messages.ts` — the evidence table. Nullable `tenant_id`, `INBOUND_ATTRIBUTIONS` closed vocabulary with a drizzle `check()`, index on `normalized_from`, two-arm RLS policy.
- `src/db/repository/inbound-messages.ts` — `insertInboundMessage` (the only insert path) and `findInboundByProviderMessageId` (returns an array; there is no unique index on a third party's id space).
- `src/db/migrations/0025_inbound_messages.sql` — generated, then hand-edited (see Deviations).
- `src/core/messaging/stop-keywords.ts` — `isStopMessage`, one anchored regex.
- `src/core/messaging/inbound.ts` — `handleInboundSms`, an 8-arm closed result union; one arm fully real.
- `tests/stop-keywords.test.ts` — 36 assertions (21 opt-outs, 13 non-opt-outs, plus the `STOP?` and non-string cases).
- `tests/inbound-stop.test.ts` — the three-block remote spine.

**Modified**
- `src/core/cadence/controls.ts` — `suppressAndStop` extraction, `INBOUND_SUPPRESSION_SOURCES`, `suppressFromInbound`.
- `src/db/repository/for-all-tenants.ts` — `forAllTenants_cadencesByContactMobile`, the fifth crossing.
- `src/db/repository/index.ts` — three new barrel exports on two new documented lines.
- `src/core/shared/env.ts` — six new keys in schema and pick-list; `APP_BASE_URL`'s comment records its new customer-facing consumer.
- `docs/env-vars.md`, `.github/workflows/ci.yml`, `tests/helpers/env.ts` — the documented keep-in-sync triangle.
- `tests/rls-coverage.test.ts`, `tests/sync-upsert.test.ts`, `tests/lint-ban.test.ts` — tripwires widened with written arguments.
- `tests/helpers/seed.ts` — `inbound_messages` added to `NO_CASCADE_TABLES`.

## Decisions Made

See `key-decisions` in the frontmatter. The three worth reading twice:

1. **No `opt_out` event was added to the matrix.** `CADENCE_EVENTS` has no such member and Phase 4 did not invent one. An inbound STOP rides the existing `contact_killed` arm, and the stop reason is read from `stopReasonFor('contact_killed')` at module load rather than typed as a literal — Phase 7 attributes revenue on that column, and a second answer written in a Phase 4 file is how the two drift. What distinguishes the two writers is `suppressed_contacts.source`, which is exactly what that table's header said the column was for.

2. **Order of the two writes.** Suppression first, evidence second. If the row write fails, the customer is protected and the provider's retry lands the row (suppression is idempotent at the unique index). The reverse fails the other way: a row reading `is_stop: true, attribution: 'threaded'` beside a customer who is still being chased tells every later human that it was handled.

3. **An ambiguous STOP writes nothing.** Two live cadences for one mobile can be two different tradies who quoted the same person. Since suppression is irreversible by design, acting on whichever row sorted first would permanently delete an arbitrary one of two customers. The row carries `candidate_tenant_ids` and an operator decides.

## Deviations from Plan

### Checkpoint substitution (operator-directed)

**1. Vercel secrets set via the dashboard rather than `vercel env add`**
- **Found during:** Task 1 (precondition: `vercel whoami`)
- **Issue:** The Vercel CLI is not installed on this machine, and installing it was explicitly out of scope. The previous executor halted here at a `blocking-human` checkpoint.
- **Fix:** The operator generated the four secrets and added them to Vercel Project → Settings → Environment Variables → Production, and to local `.env.local`. The `vercel env add` sub-step was skipped entirely.
- **Verification:** Local presence probe confirmed all four keys present at 64 characters each without printing any value. The Vercel Production side is operator-attested and carries `human_judgment: true` in the coverage block (D7) because nothing in this repo can observe it.

### Auto-fixed Issues

**2. [Rule 1 - Bug] drizzle-kit emitted three `cadences` index statements that would have failed mid-migration**
- **Found during:** Task 1 (migration generation)
- **Issue:** Migrations 0023 and 0024 are hand-written, so the drizzle snapshot did not know about `cadences_one_per_opened_event`'s narrowing or `cadences_one_live_per_job`'s existence and treated both as new work. The generated file contained `DROP INDEX cadences_one_per_opened_event` followed by `CREATE UNIQUE INDEX cadences_one_live_per_job` — which has no `IF NOT EXISTS` and would have raised 42P07 **after** the drop had already committed at its own statement-breakpoint. Net effect: the G-3-2 replay guarantee silently gone, and a failure message naming an unrelated index.
- **Fix:** Deleted the three statements; verified against the production database first that both indexes already exist with exactly the definitions the generator wanted. The 0025 snapshot still records all three correctly, which is what stops the next `db:generate` re-emitting them. The reasoning is written into the migration header.
- **Verification:** Post-migration query confirms all six `cadences` indexes intact.
- **Committed in:** `ea7e82b`

**3. [Rule 3 - Blocking] The migration was silently skipped: a concurrent worktree's migration sits ahead of the hand-picked journal stamp**
- **Found during:** Task 1 (`npm run db:migrate` reported success; `inbound_messages` did not exist)
- **Issue:** This is the drizzle journal-ordering trap that STATE.md flags, in a new variant the existing monotonicity guard cannot see — the disagreement is between the journal and the **database**, not within the journal. A concurrent local session (worktree `trusting-noether-eb2e3c`, the "Harden test-run cron pause" work) generated and applied `0025_remote_test_lease.sql` to the shared hosted DB at ~01:00 today with a **wall-clock** stamp of `1787936781812`. The house convention is a hand-picked stamp continuing the `…9082xx00000` series, so `0025_inbound_messages` was stamped `1787908300000` — behind the last applied `created_at`, and drizzle's migrator only applies entries strictly newer than that. `migrate` exited 0 having applied nothing.
- **Fix:** Re-stamped to `1787940000000` — ahead of the foreign row, still behind wall-clock now so a future generated stamp will not be skipped in turn, and still monotonic within the journal.
- **Verification:** Re-ran `db:migrate`; confirmed the table, RLS flag, policy expression, CHECK constraint, index and all four grants against the hosted DB directly.
- **Committed in:** `ea7e82b`

**4. [Rule 2 - Missing Critical] The four new required secrets were absent from the test-env REQUIRED gate**
- **Found during:** Task 1
- **Issue:** They are REQUIRED members of `serverEnvSchema`, so every suite reaching `getServerEnv()` — which is every suite touching the repository — would fail three layers down with a zod report. `docs/env-vars.md` states the keep-in-sync rule explicitly.
- **Fix:** Added to `tests/helpers/env.ts` REQUIRED and to the `ci.yml` env block as four distinct 64-character dummies, in the same commit, per that rule.
- **Verification:** `npx vitest run` — 804 pure tests pass; full remote suite green.
- **Committed in:** `ea7e82b`

**5. [Rule 2 - Missing Critical] `inbound_messages` had no RLS/grant coverage assertions**
- **Found during:** Task 1
- **Issue:** Threat T-4-04 is dispositioned `mitigate` in the plan's register, and the migration series states "every new table needs its own block" five times over. The schema-wide assertions in `rls-coverage.test.ts` would have caught a missing policy but not a policy missing its `is_operator()` arm — the failure mode where the triage queue renders empty forever while every generic check passes.
- **Fix:** Added the table to the exact-grants map and the table-exists list, plus a dedicated assertion that both the USING and WITH CHECK clauses name `has_tenant_access` and `is_operator`.
- **Verification:** `tests/rls-coverage.test.ts` green remotely.
- **Committed in:** `ea7e82b`

**6. [Rule 3 - Blocking] Two source-guarantee tripwires fired on the new cross-tenant accessor**
- **Found during:** Task 2 (full remote regression run)
- **Issue:** `tests/sync-upsert.test.ts` pins both the set of `forAllTenants_*` exports and the set of tables reachable from that file — and its own failure message named `cadences` as one that "must stay" per-tenant. This is the tripwire working: the plan prescribes the accessor's location, so widening it had to be a decision typed on purpose.
- **Fix:** Widened both sets with the argument written in place (an inbound SMS carries a phone number and no tenant, so the question has no scope to be asked from), and added a **new containment assertion** the file did not previously need: `cadences` may be read from exactly one accessor, never joined, with a pinned nine-symbol select list — because unlike `quotes` this table is genuinely selected from, and the difference between a threading lookup and a cross-tenant dashboard query is nothing but the length of a select list.
- **Verification:** `tests/sync-upsert.test.ts` — 18 tests green remotely.
- **Committed in:** `ef1fe94`

**7. [Rule 2 - Missing Critical] Test teardown could not reach unattributed inbound rows**
- **Found during:** Task 2
- **Issue:** `teardownTenants` keys on `tenant_id`, and the entire point of the nullable column is that an unplaced reply carries NULL — such rows would survive every teardown, accumulating in a table the operator's triage screen reads, on a database shared with production.
- **Fix:** Added `inbound_messages` to `NO_CASCADE_TABLES` for tenant-scoped rows, and made `tests/inbound-stop.test.ts` track and delete every id it creates.
- **Verification:** `select count(*) from inbound_messages` returns 0 after the full remote run.
- **Committed in:** `ef1fe94`

### Documented plan-count correction

**8. `APP_BASE_URL` already existed — this plan adds SIX new keys, not seven**
- The plan's action text and acceptance criteria count seven. `src/core/shared/env.ts:78` has declared `APP_BASE_URL` as `z.url().optional()` since 02-04 (the alert-email link base). Phase 4 gives it a **second consumer** — the unsubscribe-link base for 04-05 — so its comment was updated to record that the fallback chain is now load-bearing for something a customer clicks, where a wrong value produces a broken opt-out rather than merely an awkward alert email. No new declaration was added. Six keys are genuinely new.

---

**Total deviations:** 1 operator-directed substitution, 6 auto-fixed (2 bugs/blocking-in-migration, 1 blocking tripwire, 3 missing-critical), 1 documented plan-count correction.
**Impact on plan:** No scope creep. Deviation 3 in particular would have shipped a plan that reported success with no table on the database — the exact failure STATE.md warns about, in a variant the existing guard cannot detect.

## Issues Encountered

- **Cross-session migration collision (unresolved, needs a human at merge time).** The concurrent worktree `claude/trusting-noether-eb2e3c` holds a file also numbered `0025` (`0025_remote_test_lease.sql`) which is **already applied to the shared hosted database** but is not in `main`'s journal. Two consequences: (a) `main`'s schema and the hosted schema now differ by that table until that branch merges, and CI — which builds only from the journal — will not have it; (b) when that branch merges, `_journal.json` will conflict and one of the two `0025` entries must be renumbered. Flagged rather than resolved: that branch is another session's work and renumbering it from here would break it.
- **The unmatched-STOP gap is real and named, not silent.** A STOP arriving with no live cadence (the repeat-STOP case, and any reply from a customer whose cadence already stopped) is currently recorded and logged loudly, but writes no suppression — there is no snapshot address to write verbatim from. Closing it needs a suppression path that does not require a live cadence, which belongs to 04-02. It is documented in `inbound.ts`'s header, asserted in `tests/inbound-stop.test.ts`, and repeated below under Next Phase Readiness so it cannot be lost.

## User Setup Required

The four Phase 4 bearers are already set (operator, via the Vercel dashboard, 2026-08-29) in Production and in local `.env.local`. **One human check remains:** confirm `CLICKSEND_WEBHOOK_SECRET`, `CLICKSEND_DLR_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET` and `MESSAGING_RECONCILE_SECRET` are present under Vercel → Project → Settings → Environment Variables → **Production** before 04-02 deploys a route that reads one (coverage D7).

`CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` remain unset and that is expected — every sender falls back to the stub without them (D-08), which is what keeps the pipeline buildable while the AU dedicated number stays blocked on the IPND business-address requirement.

## Next Phase Readiness

**Ready for 04-02 (inbound route):**
- `handleInboundSms` is complete and framework-free; 04-02 supplies the authenticated route (`CLICKSEND_WEBHOOK_SECRET` is already in the env schema) and a zod payload parser.
- The `dead_letter` attribution and `raw_payload` column exist and are unused — 04-02's parser is their first writer.
- `findInboundByProviderMessageId` exists and is unused — 04-04's reconciliation is its first caller.

**Three things 04-02 must close, all named in code rather than only here:**
1. **The unmatched-STOP gap.** A human asking to be left alone with no live cadence currently gets a `console.error` and a row, not a suppression.
2. **The D-05 reply pause.** A non-STOP reply to a live cadence records `reply_threaded` and does not pause. `pauseForReply` has been waiting for this caller since 03-05.
3. **The pause-upgrade write.** Still open from 03-05: `paused(client_paused) + customer_reply` returns `upgrade_unsupported`, so a client's own resume can restart messaging at somebody mid-conversation.

**Carried blockers unchanged:** the IPND business-address dependency still blocks the AU dedicated number (nothing in this plan needed it), and the ServiceM8 partner App ID/Secret is still unconfirmed.

---
*Phase: 04-messaging-gateway*
*Completed: 2026-08-29*

## Self-Check: PASSED

All 7 source/test artifacts and the SUMMARY exist on disk; all 4 task commits
(`ea7e82b`, `3e2b2ef`, `36e5704`, `ef1fe94`) are present in git history.
