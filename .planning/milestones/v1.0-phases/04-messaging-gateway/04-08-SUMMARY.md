---
phase: 04-messaging-gateway
plan: 08
subsystem: messaging
tags: [messaging-config, activation-gate, d-04, clicksend, resend, drizzle, vitest]

# Dependency graph
requires:
  - phase: 04-messaging-gateway
    provides: "04-03's messaging_config table, RoutingSender composite and chooseSmsSender gate; 04-05's ResendSender + resolveEmailIdentity; 04-06's /settings/email console action; 04-07's disarmed global sms row"
provides:
  - "anyChannelEnabled(channel) — the deployment-level 'is this channel armed anywhere' accessor"
  - "buildRoutingSender gates BOTH channels on anyChannelEnabled, so a single tenant's messaging_config row genuinely activates that one client (D-04 rollout is reachable for the first time)"
  - "chooseSmsSender / chooseEmailSender reduced to (channelEnabled, creds) — the identity question lives wholly in resolveSmsFrom / resolveEmailIdentity"
  - "A per-tenant refusal is now RECORDED (sms_not_configured / email_not_configured) instead of a silent stub"
  - "The tenant-override activation test against the hosted DB: one client armed, every other refused"
  - "Honest console copy: 'Saved. Email is on for this client from the next send tick.'"
affects: [04-VERIFICATION gap 2, 04-10 MSG-02 email override, phase-07 revenue attribution, first-client onboarding]

actuals:
  tokens: 38000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Two-level activation: a deployment-level boolean gate decides whether a real sender object is worth constructing; the per-tenant resolver is the sole identity authority and the only thing that can grant a client a from-address"
    - "A widened gate that grants nothing: anyChannelEnabled returning true builds one object and gives nobody an identity, so the blast radius is bounded by the resolvers rather than by the gate"

key-files:
  created: []
  modified:
    - src/db/repository/messaging-config.ts
    - src/db/repository/index.ts
    - src/core/messaging/routing-sender.ts
    - src/core/messaging/resend-sender.ts
    - "src/app/(console)/settings/email/actions.ts"
    - tests/routing-sender.test.ts
    - tests/resend-sender.test.ts
    - tests/email-settings-action.test.ts
    - tests/routing-dispatch.test.ts
    - tests/lint-ban.test.ts

key-decisions:
  - "The deployment gate and the identity authority are two different questions and now two different functions — anyChannelEnabled answers 'is this channel armed anywhere', getChannelConfig/resolveEmailIdentity answer 'which identity does THIS client send as'. Conflating them was CR-01: buildRoutingSender asked the identity function with no tenant, which reads the GLOBAL row alone, so one client's enabled override row was invisible to the gate"
  - "The from-address conditions were DELETED from both choosers rather than kept as belt-and-braces — a deployment-level read of a per-client fact is precisely what produced the wrong answer for every tenant at once. The resolvers already return null for a disabled, absent or address-less row, and the senders record that refusal on the ledger"
  - "Widening the gate does not widen the blast radius (T-4GC-01): a true from anyChannelEnabled constructs ONE sender object and grants nobody an identity. A tenant that was refused before is still refused — now with a sms_not_configured / email_not_configured ledger row a human can read, instead of a stub row indistinguishable from Phase 3"
  - "The console success copy claims the TIMING, not the present: 'from the next send tick', because buildRoutingSender reads the switch once per tick at construction. Asserted verbatim, since the claim is the thing under test"
  - "The remote activation test writes an ENABLED email row, bounded four ways: tenant-scoped to a throwaway tenant with no quotes/cadences/touches, a complete but fictional example.test identity, no .send( anywhere in the block, deleted BY ID in an afterAll that runs on failure — with the deployed crons paused for the run"
  - "messaging_config has NO foreign key to tenants, so teardownTenants cannot sweep a leaked row. A new anyChannelEnabled('email') guard in beforeAll is the residue alarm: a delete this block ever misses fails the NEXT run loudly instead of sitting armed on the production-shared database"
  - "The suite's sms disarmed-alarm now asks anyChannelEnabled('sms') rather than the global row, because that is the question the tick asks — reading the global row alone would stay green while one client's override row armed real customer SMS"

patterns-established:
  - "Deployment gate vs per-tenant authority: any 'is the system allowed to do X at all' question is answered by a boolean accessor that holds no tenant; 'may THIS tenant do X, and as whom' is answered only by the per-tenant resolver, and the second is what bounds the first"
  - "A refusal must be recorded, not silent: moving a check from the deployment gate to the per-tenant resolver converts a stub row nobody can distinguish from Phase 3 into a named ledger reason an operator can triage"
  - "Console copy is test-pinned verbatim when the sentence makes a claim about system behaviour"

# MSG-02 is deliberately NOT listed. The plan's frontmatter claims [MSG-01, MSG-02],
# but D-02 defines MSG-02 as the email pipe PROVEN BY A REAL SEND, and no client
# domain is verified at Resend. This plan removed the gate defect that would have
# made a per-client email activation send nothing; it did not send anything. Marking
# it complete here would be the same class of false claim this plan just deleted from
# the console copy. 04-10 owns MSG-02.
requirements-completed: [MSG-01]

coverage:
  - id: D1
    description: "anyChannelEnabled(channel) — one statement, one column, LIMIT 1, no join — answering the deployment-level 'is this channel armed anywhere'"
    requirement: MSG-01
    verification:
      - kind: integration
        ref: "tests/routing-dispatch.test.ts#one client armed, every other refused — the D-04 rollout (CR-01)"
        status: pass
      - kind: unit
        ref: "tests/lint-ban.test.ts#the repository barrel does not re-export the raw client"
        status: pass
    human_judgment: false
  - id: D2
    description: "chooseSmsSender gates on (channelEnabled, creds); the from-address condition moved wholly to resolveSmsFrom, whose null is a recorded sms_not_configured refusal"
    requirement: MSG-01
    verification:
      - kind: unit
        ref: "tests/routing-sender.test.ts#chooseSmsSender — the D-04 activation gate"
        status: pass
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#refuses with sms_not_configured when no from-number is resolved"
        status: pass
    human_judgment: false
  - id: D3
    description: "chooseEmailSender gates on (channelEnabled, creds); buildRoutingSender gates both arms on anyChannelEnabled and makes no tenant-less getChannelConfig read"
    requirement: MSG-02
    verification:
      - kind: unit
        ref: "tests/resend-sender.test.ts#buildRoutingSender — production stays stub-only until a row is enabled"
        status: pass
    human_judgment: false
  - id: D4
    description: "A tenant-override row with enabled=true and the global row disabled/absent arms the REAL email delegate for that tenant and refuses every other tenant"
    requirement: MSG-02
    verification:
      - kind: integration
        ref: "npm run test:remote -- tests/routing-dispatch.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The routing-sender.ts IN-04 comment rewritten to describe the gate that actually exists, and the settings/email success copy corrected to a claim the gate honours"
    requirement: MSG-02
    verification:
      - kind: unit
        ref: "tests/email-settings-action.test.ts#writes a per-tenant override under that tenant id"
        status: pass
      - kind: other
        ref: "! grep -q 'NOTE THE ORDER' src/core/messaging/routing-sender.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-08-30
status: complete
---

# Phase 04 Plan 08: CR-01 Gap Closure Summary

**Per-tenant messaging activation now works: a single client's `messaging_config` row arms the real provider for that client and records a named refusal for every other, closing VERIFICATION gap 2 and making the D-04 one-client-at-a-time rollout reachable for the first time.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-30T03:37:41Z
- **Completed:** 2026-08-30T03:57:59Z
- **Tasks:** 3 of 3
- **Files modified:** 10

## Accomplishments

- **The gap's actual defect is fixed.** `buildRoutingSender` gated both channels on the GLOBAL `messaging_config` row, so enabling one client's row while the global row stayed off produced `StubSender` silently — `sender='stub'`, `outcome='stub_sent'`, nothing sent — while the console reported success. Both arms now gate on `anyChannelEnabled(channel)`, which an override row satisfies.
- **The identity question moved wholly to the per-tenant resolvers.** `chooseSmsSender` and `chooseEmailSender` reduced to `(channelEnabled, creds)`. `resolveSmsFrom` / `resolveEmailIdentity` were already the only place a tenant's from-address is decided; they are now the only place it is *asked*. The consequence is that a client with no usable row gets `sms_not_configured` / `email_not_configured` on the ledger — a refusal a human can read — where they previously got a stub row indistinguishable from Phase 3.
- **The two false claims the gap named are gone.** The `routing-sender.ts` header comment (IN-04) described a per-tenant lookup the gate never performed; it now describes the two-level design that exists, including the surviving true half (a per-tenant `enabled = false` still means stop for that one client). The console copy now reads *"Saved. Email is on for this client from the next send tick."* — true under the fixed gate, and claiming the timing rather than the immediate present.
- **The activation is proven against the hosted database, not asserted about the code.** A new remote block seeds two throwaway tenants, arms email for exactly one of them with the global row absent, and asserts `providerFor('email') === 'resend'`, `resolveEmailIdentity(armed)` returns that identity, and `resolveEmailIdentity(other)` is `null`. No send is performed anywhere in it.

## Task Commits

Each task was committed atomically:

1. **Task 1: Deployment-level SMS gate — anyChannelEnabled + chooseSmsSender rewrite + comment fix** - `4c5de33` (fix, TDD: RED tests written and confirmed failing before implementation)
2. **Task 2: Email arm on the deployment gate + honest console success copy** - `e311fa9` (fix, TDD: 4 failing tests confirmed before implementation)
3. **Task 3: The tenant-override activation test** - `b8e114b` (test)

_TDD note: tasks 1 and 2 were executed RED-then-GREEN inside a single commit each, per the plan's `tdd="true"` task shape (the plan is `type: execute`, not a plan-level TDD gate). RED was confirmed by running the suites and observing 2 and 4 failures respectively before any implementation edit._

## Files Created/Modified

- `src/db/repository/messaging-config.ts` — NEW `anyChannelEnabled(channel)`: one SELECT of `id`, `WHERE channel AND enabled`, `LIMIT 1`, no join. Header documents that this answers the DEPLOYMENT-level question while `getChannelConfig` keeps the per-tenant identity one.
- `src/db/repository/index.ts` — barrel export, on the messaging-config family's line, with a note that it is deliberately not an identity read.
- `src/core/messaging/routing-sender.ts` — `chooseSmsSender(channelEnabled, creds, fallback)`; `buildRoutingSender` reads `anyChannelEnabled('sms')` and `anyChannelEnabled('email')` and makes no tenant-less `getChannelConfig` call; the IN-04 comment block rewritten; `resolveSmsFrom`'s inline comment corrected to say it is the identity authority.
- `src/core/messaging/resend-sender.ts` — `chooseEmailSender(channelEnabled, creds, fallback, resolve)`; five-condition doc comment reduced to the surviving conditions with an explicit note on why no identity condition belongs at a gate that holds no tenant.
- `src/app/(console)/settings/email/actions.ts` — tenant-row success copy corrected; the global-row and disabled branches left alone (both were already true).
- `tests/routing-sender.test.ts` — gate cases re-enumerated over the boolean; a new case pinning that no from-address is read.
- `tests/resend-sender.test.ts` — email gate cases re-enumerated; `buildRoutingSender` block now drives `anyChannelEnabled` and asserts `getChannelConfig` is never called without a tenant.
- `tests/email-settings-action.test.ts` — the success copy asserted verbatim instead of by substring.
- `tests/routing-dispatch.test.ts` — the new activation block (first in the file, own hooks); the sms disarmed-alarm re-pointed at `anyChannelEnabled`.
- `tests/lint-ban.test.ts` — pinned barrel export list updated (see deviations).

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: **the deployment gate and the identity authority are two questions, and the fix is that they are now two functions.** A `true` from `anyChannelEnabled` means only that a real sender object is worth constructing; it grants nobody an identity, and that is what makes widening it safe (T-4GC-01).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The pinned repository-barrel export list refused the new accessor**

- **Found during:** Task 2 (surfaced on the full pure suite)
- **Issue:** `tests/lint-ban.test.ts` pins `Object.keys(barrel).sort()` to an exact list as the ONB-05 audit. Adding `anyChannelEnabled` failed it — by design: every crossing added to that barrel is meant to be argued for in that file.
- **Fix:** Added `anyChannelEnabled` to the pinned list with a paragraph in the file's existing style explaining what bounds it (one column, one row, `LIMIT 1`, returns a boolean, so nothing it can answer is customer data) and why it exists.
- **Files modified:** `tests/lint-ban.test.ts`
- **Verification:** `npm test` — 1163 pure tests pass
- **Committed in:** `e311fa9` (part of task commit)

**2. [Rule 2 - Missing critical functionality] The sms disarmed-alarm no longer covered the question the tick asks**

- **Found during:** Task 3
- **Issue:** `tests/routing-dispatch.test.ts`'s production-is-stub-only test asserted `getChannelConfig('sms')?.enabled === false` — the global row alone. After this plan the tick asks `anyChannelEnabled('sms')`, so that alarm would stay green while one client's override row armed real customer SMS. The alarm's whole purpose is to fail the moment somebody arms sms.
- **Fix:** Re-pointed the assertion at `await anyChannelEnabled('sms')` and rewrote the surrounding comment (which still described `chooseSmsSender` reading `!config?.enabled`).
- **Files modified:** `tests/routing-dispatch.test.ts`
- **Verification:** `npm run test:remote -- tests/routing-dispatch.test.ts` — passes, and still fails-closed on an armed row
- **Committed in:** `b8e114b` (part of task commit)

**3. [Rule 2 - Missing critical functionality] No residue alarm for the enabled row the new test writes**

- **Found during:** Task 3
- **Issue:** `messaging_config` has NO foreign key to `tenants` (verified in `src/db/schema/messaging-config.ts`: `tenantId: uuid('tenant_id')`, no `references`). So `teardownTenants` cannot sweep a leaked row, and neither can the tenant delete fail on one — an enabled email row left by an interrupted run would sit armed on the production-shared hosted database with nothing pointing at it.
- **Fix:** Added `expect(await anyChannelEnabled('email')).toBe(false)` to the new block's `beforeAll`, with a message telling the reader it is most likely residue and to delete it by id. A missed delete now fails the NEXT run loudly.
- **Files modified:** `tests/routing-dispatch.test.ts`
- **Verification:** The suite was run twice; the second run's guard passing is itself the proof that the first run's `afterAll` deleted the row and the hosted database is stub-only again.
- **Committed in:** `b8e114b` (part of task commit)

---

**Total deviations:** 3 auto-fixed (1 × Rule 3, 2 × Rule 2). No Rule 4 (architectural) decisions were needed; no checkpoints were reached.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/routing-sender.test.ts` | 11 passed |
| `npx vitest run tests/resend-sender.test.ts tests/email-settings-action.test.ts tests/routing-sender.test.ts` | 93 passed |
| `npm test` (full pure suite) | **1163 passed, 0 failed** (28 integration files refused by the WR-09 disposable-stack guard, as expected on a bare `npm test`) |
| `npm run test:remote -- tests/routing-dispatch.test.ts` | 6 passed (run twice, serialized) |
| `npm run test:remote` (full) | **69 files, 1506 tests, all passed** — crons paused and re-armed cleanly |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |

**Acceptance criteria greps, all passing:**

- `grep -q "export async function anyChannelEnabled" src/db/repository/messaging-config.ts` — body contains `limit(1)`, no `join`
- `grep -q "anyChannelEnabled" src/db/repository/index.ts`
- `grep -q "anyChannelEnabled('sms')"` and `grep -q "anyChannelEnabled('email')"` in `routing-sender.ts`
- `! grep -q "NOTE THE ORDER" src/core/messaging/routing-sender.ts` — the IN-04 comment is gone
- `! grep -q "getChannelConfig('sms')"` and `! grep -q "getChannelConfig('email')"` in `routing-sender.ts` — no tenant-less read survives (the resolvers keep their two-argument calls)
- `grep -q "Saved. Email is on for this client from the next send tick."` in both `actions.ts` and `tests/email-settings-action.test.ts`
- No `.send(` in the new remote describe block (verified by `sed` range + `grep -c` → 0)

**Manual trace confirmed by the remote test rather than by reading:** with no global email row and one tenant row enabled, `buildRoutingSender` arms the resend delegate and `resolveEmailIdentity` activates exactly that tenant.

## Threat Mitigations

| Threat | Disposition | Evidence |
|---|---|---|
| T-4GC-01 (elevation: wider gate widening blast radius) | mitigated | The resolvers remain the sole identity authority; `resolveEmailIdentity(otherTenant) === null` is asserted against the hosted DB while the armed tenant resolves |
| T-4GC-02 (repudiation: false console copy) | mitigated | Copy rewritten to a next-tick claim, asserted verbatim in `tests/email-settings-action.test.ts` |
| T-4GC-03 (tampering: transient enabled row on the shared DB) | mitigated | Crons paused by `global-setup`; row scoped to a throwaway tenant with no quotes/cadences/touches; fictional identity; no send invoked; deleted by id in `afterAll`; residue alarm added |
| T-4-11 (ledger records the delegate) | unchanged | `RoutingSender` untouched; the remote suite's delegate-not-composite assertion still passes |

## Known Stubs

None. `StubSender` remains the intentional refusal path, not a placeholder — it is what a correctly-disarmed channel is supposed to produce. No `TODO`, `FIXME`, skipped test or unrun `<verify>` was introduced by this plan.

## Threat Flags

None. This plan added no network endpoint, auth path, file access pattern or schema change; `anyChannelEnabled` reads one existing column of one existing table and returns a boolean.

## Notes for the Operator

- **Nothing became armed by this change.** The global sms row is still `enabled=false` (04-07's deliberate disarm) and no email row is enabled anywhere; both delegates are still `StubSender` on production. What changed is that arming ONE client now works, which it did not before.
- **This is still undeployed.** It rides on the existing carried-forward note that commit `e658ea1` (the T-4-28 inbound backstop fix) is committed but not pushed. Deploy is the operator's call; the fix must be live before the first real client is armed, or arming one client will still send nothing.
- **MSG-02 stays Pending, deliberately.** The plan's frontmatter lists it, but D-02 defines MSG-02 as the email pipe proven by a real send and no client domain is verified at Resend. This plan removed the gate defect that would have made a per-client email activation send nothing — a prerequisite, not the proof. `REQUIREMENTS.md` was left unchanged for MSG-02; 04-10 owns it.
- **No new blockers.** The remaining Phase 4 gaps (CR-02 reconcile opt-out corpus, CR-03 dispatch-loop isolation) are 04-09's scope and were deliberately untouched here.

## Self-Check: PASSED

All ten modified files verified present on disk; all three task commit hashes verified in `git log`.
