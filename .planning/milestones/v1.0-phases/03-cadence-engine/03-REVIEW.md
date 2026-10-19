---
phase: 03-cadence-engine
reviewed: 2026-08-28T00:00:00Z
depth: standard
files_reviewed: 60
files_reviewed_list:
  - .github/workflows/ci.yml
  - docs/env-vars.md
  - scripts/apply-cron-schedules.mjs
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts
  - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
  - src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx
  - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
  - src/app/api/internal/cadence-tick/route.ts
  - src/app/globals.css
  - src/core/cadence/constants.ts
  - src/core/cadence/consume-events.ts
  - src/core/cadence/controls.ts
  - src/core/cadence/dispatch.ts
  - src/core/cadence/jitter.ts
  - src/core/cadence/materialize.ts
  - src/core/cadence/primary-contact.ts
  - src/core/cadence/resume.ts
  - src/core/cadence/rewindow.ts
  - src/core/cadence/run-tick.ts
  - src/core/cadence/sender.ts
  - src/core/cadence/transitions.ts
  - src/core/cadence/window.ts
  - src/core/shared/env.ts
  - src/core/sync/connect.ts
  - src/core/sync/eligibility.ts
  - src/db/migrations/0016_cadence_tables.sql
  - src/db/migrations/0017_cadence_grants_and_constraints.sql
  - src/db/migrations/meta/_journal.json
  - src/db/repository/consumer-cursor.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/schema/cadence-settings.ts
  - src/db/schema/cadence-templates.ts
  - src/db/schema/cadence-touches.ts
  - src/db/schema/cadences.ts
  - src/db/schema/index.ts
  - src/db/schema/send-ledger.ts
  - src/db/schema/suppressed-contacts.ts
  - tests/cadence-completion-sweep.test.ts
  - tests/cadence-consume-events.test.ts
  - tests/cadence-controls.test.ts
  - tests/cadence-dispatch.test.ts
  - tests/cadence-materialize.test.ts
  - tests/cadence-primary-contact.test.ts
  - tests/cadence-repository.test.ts
  - tests/cadence-resume.test.ts
  - tests/cadence-rewindow.test.ts
  - tests/cadence-tick-route.test.ts
  - tests/cadence-tick.test.ts
  - tests/cadence-transitions.test.ts
  - tests/cadence-window.test.ts
  - tests/cron-schedules.test.ts
  - tests/helpers/env.ts
  - tests/helpers/seed.ts
  - tests/leak.test.ts
  - tests/lint-ban.test.ts
  - tests/rls-coverage.test.ts
  - tests/sync-upsert.test.ts
findings:
  critical: 3
  warning: 11
  info: 0
  total: 14
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-28
**Depth:** standard
**Files Reviewed:** 60
**Status:** issues_found

## Summary

The phase's headline guarantees are structurally sound where they are claimed to be. The
never-twice property really is structural (`send_ledger_cadence_touch_uniq` +
`onConflictDoNothing … returning({id})` at `for-tenant.ts:1477-1486`, branched on at
`dispatch.ts:346`), the claim is genuinely `FOR UPDATE OF cadence_touches SKIP LOCKED`
(`for-tenant.ts:1422`), just-in-time revalidation really does re-read quote state,
suppression, both pause flags and the window inside the claim transaction, and the two
state machines in `transitions.ts` are total with no `default` arm. The tick route's auth
is correct and constant-time, the proxy exclusion is asserted, and `tsc --noEmit` and
`eslint --max-warnings=0` both pass clean.

The defects are not in those mechanisms. They are in the **orchestration around them** and
in the **resume rule**:

1. The tick has per-tenant error isolation in three of its four passes and **none in the
   first** — so a failure inside event consumption takes down dispatch for every tenant, and
   a deterministic one does so permanently (CR-01).
2. Event consumption is cross-tenant by design but has **no cross-tenant blast-radius
   control**: one client's uninterpretable contact-hours row halts the shared outbox cursor
   for every other client, forever (CR-02).
3. `computeResumeSchedule` moves touches that were **never overdue**, pulling them earlier —
   so a pause-and-resume seconds apart rewrites a schedule forward by days and can put two
   touches on one customer in one morning, which is precisely the burst D-07 exists to
   prevent, arriving from the opposite direction (CR-03).

Secondary concerns cluster around observability that is computed and then discarded
(`refusals`, `eventsSkipped`, `quotesFlaggedForReview`), one dispatch refusal that never
terminates (`no_address`), and one repository query that is the sole outlier in an otherwise
consistently tenant-correlated set (`claimDue`).

---

## Critical Issues

### CR-01: A failure in event consumption aborts dispatch for every tenant in the tick

**File:** `src/core/cadence/run-tick.ts:376-379`, `src/core/cadence/consume-events.ts:625-640`, `src/app/api/internal/cadence-tick/route.ts:97`

**Issue:**
`runCadenceTick` runs four passes in sequence:

```ts
const consumed = await consumeQuoteEvents({ jitterMinutes, batchLimit });
const progress = await runProgressPass(now, jitterMinutes);
const dispatch = await dispatchDueTouches({ sender, now });
const cadencesCompleted = await runCompletionSweep();
```

Passes 2, 3 and 4 each wrap their per-tenant work in `try/catch` and explain at length why
("one client's broken configuration … must not stop the other fourteen from making
progress", `run-tick.ts:270-274`; the identical argument at `:341-343` and
`dispatch.ts:415-419`). **Pass 1 has no such protection at any level.**

Inside `consumeRun`, the catch at `consume-events.ts:625-640` is deliberately narrow — it
handles `InvalidContactWindowError` and `NoAllowedContactDayError` and **rethrows everything
else** (line 639). That rethrow propagates out of the drizzle transaction callback, out of
`consumeRun`, through the unguarded `await consumeRun(...)` at `consume-events.ts:673`, out
of `consumeQuoteEvents`, and out of `runCadenceTick` — which the route awaits with no
`try/catch` (`route.ts:97`). The tick returns 500 and **progress, dispatch and the completion
sweep never run for anyone that minute.**

Reachable throw sources that are not the two named window errors:
- a transient driver failure — deadlock (`40P01`), serialization failure, statement timeout,
  connection reset — inside any one tenant's run transaction;
- `RangeError` / `TypeError` from `materializeCadenceSchedule` (`materialize.ts:119-146`),
  which are *not* subclasses of the two caught errors;
- `settings.ensure()`'s `throw new Error(...)` (`for-tenant.ts:1069-1072`);
- `registerConsumerCursor`'s `throw new Error(...)` (`consumer-cursor.ts:62-66`).

For a *transient* error the cost is one minute of no sends for all fifteen clients. For a
*deterministic* one the cost is unbounded: the cursor cannot advance past the offending
event, so the next tick re-reads the same batch, throws again, and the engine never
dispatches anything again. The route's own header calls this route "the only auth" for a
system that "makes this system SEND SMS" — it has no answer for the case where the first
pass simply throws.

**Fix:** Isolate the consume pass the same way the other three are isolated, and isolate each
run within it so a poison run stops the *scan* (as the header intends) rather than the *tick*.

```ts
// consume-events.ts — inside the run loop, replacing the bare `await`
for (const run of contiguousRuns(pending)) {
  let outcome: RunOutcome;
  try {
    outcome = await consumeRun(run, tenantsById.get(run[0].tenantId), jitterMinutes);
  } catch {
    // Not logging the caught value: a driver error carries the statement, whose
    // parameters are this tenant's data (the rule this file already follows).
    console.error(
      `[cadence] consumption failed for tenant ${run[0].tenantId}; the cursor did not ` +
        'advance past this run and the scan stops here.',
    );
    result.blocked = true; // surface it in the result, not only in a log
    break;
  }
  // ...existing accumulation...
  if (outcome.blocked) break;
}
```

```ts
// run-tick.ts — the consume pass must never be able to cost anyone their sends
let consumed = ZERO_CONSUME_RESULT;
try {
  consumed = await consumeQuoteEvents({ jitterMinutes, batchLimit });
} catch {
  console.error('[cadence] event consumption failed this tick; proceeding to dispatch.');
}
const progress = await runProgressPass(now, jitterMinutes);
```

Add a regression test alongside `tests/cadence-tick.test.ts` that stubs one tenant's consume
transaction to reject and asserts a *different* tenant's due touch is still dispatched in the
same tick.

---

### CR-02: One tenant's uninterpretable contact window wedges the shared outbox cursor for every tenant

**File:** `src/core/cadence/consume-events.ts:625-641, 672-685`, `src/core/cadence/window.ts:150-159`

**Issue:**
`event_consumer_cursors` is a **single ordered position across every client** (documented as
deliberate at `for-all-tenants.ts:32-42`). When one tenant's `quote_opened` cannot be
materialized because their contact window is uninterpretable, `consumeRun` sets
`blocked = true` and breaks (`:630-637`), and `consumeQuoteEvents` then breaks out of the
whole run loop:

```ts
// Head-of-line by design: the cursor is one ordered position, so a run that
// could not finish must not be stepped over by the runs behind it.
if (outcome.blocked) break;
```

Head-of-line blocking is the right answer for the *cursor*. But because the cursor is shared,
the blast radius is **every other client**: no further `quote_opened`, `won`, `lost`,
`removed` or `reopened` is consumed for anybody until a human notices and edits one tenant's
row. A `won` job that should have stopped a cadence sits unconsumed while that cadence keeps
sending — which is the single worst message this product can send, per `transitions.ts:31-37`.

The trigger is reachable and undefended. `window.ts:30-36` states it plainly: *"Phase 1
rejects a window whose start EQUALS its end, but nothing rejects start > end, so a
20:00–06:00 row is reachable."* An operator setting overnight contact hours for one client —
or a `contact_days` array that admits no day, which raises `NoAllowedContactDayError` from the
same branch — silently halts cadence creation for the entire book of business. The only
signal is one `console.error` per tick in the Vercel log; the tick's HTTP body reports
`eventsConsumed: 0` and every other counter at zero, which is indistinguishable from a quiet
minute.

Note the asymmetry this creates against the phase's own stated principle: `run-tick.ts:270-274`
argues at length that "an uninterpretable contact window, most likely" must not stop the other
fourteen tenants — and then the pass that runs *first* does exactly that.

**Fix:** Two changes, both cheap.

1. **Do not let one tenant block the others' events.** Track blocked tenants and skip their
   runs while continuing the scan; hold the cursor at the *lowest* blocked event id so nothing
   is stepped over:

```ts
const blockedTenants = new Set<string>();
let cursorFloor: number | null = null;

for (const run of contiguousRuns(pending)) {
  const tenantId = run[0].tenantId;
  if (blockedTenants.has(tenantId)) continue;

  const outcome = await consumeRun(run, tenantsById.get(tenantId), jitterMinutes);
  // ...accumulate...
  if (outcome.blocked) {
    blockedTenants.add(tenantId);
    cursorFloor ??= run[0].id;      // never advance the shared cursor past this
  }
}
```
   …and advance the shared cursor only to `min(cursorFloor - 1, lastConsumedId)`. (If that
   bookkeeping is judged too subtle for this phase, the alternative is a per-tenant cursor
   key — `cadence-engine:<tenantId>` — which removes the shared-position constraint entirely.)

2. **Reject the unusable window at the boundary that creates it**, so this state cannot be
   entered. Add a CHECK to `tenants` in a follow-up migration:

```sql
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_contact_window_ordered
  CHECK (contact_hours_start < contact_hours_end);
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_contact_days_nonempty
  CHECK (array_length(contact_days, 1) >= 1);
```

3. Surface `blocked` in `ConsumeQuoteEventsResult` and in the tick's HTTP body as a count, so
   a wedged cursor is visible in `cron.job_run_details` rather than only in a log line.

---

### CR-03: A resume pulls not-yet-due touches EARLIER, sending follow-ups ahead of schedule

**File:** `src/core/cadence/resume.ts:117-152` (`computeResumeSchedule`)

**Issue:**
The first unsent touch is placed at the next allowed slot from the resume moment
**unconditionally**, with no comparison against where it was already scheduled:

```ts
if (previous === null) {
  at = nextAllowedSlot(resumeAt, win, preferredSendTime, jitterMinutes, {
    sameDayMarginMinutes: input.sameDayMarginMinutes,
  });
}
```

Every later touch is then derived from that placement via `slotAtOffsetDays(previous.at,
delta, …)`. The function's entire justification (`resume.ts:1-43`) is about repairing touches
that *fell due during the pause* — but nothing in the code restricts it to those. When the
next unsent touch is still in the **future**, the rule drags it backwards in wall-clock terms.

Worked example, all inside the seeded Perth window:
- Monday 09:35 — touch 1 (offset 0) is sent. Touch 2 (offset 3) sits at Thursday 09:30.
- Monday 10:00 — the operator taps *Pause this client*. `pauseClient` pauses the cadence
  (`controls.ts:295-301`).
- Monday 10:15 — they tap *Resume this client*. `resumeClient` resumes the cadence and calls
  `applyResumeRewindow(tenantId, now, { onlyCadenceIds: resumedIds })` (`controls.ts:371-381`).
- `computeResumeSchedule` places touch 2 at `nextAllowedSlot(Mon 10:15)` = **Monday 10:15**.

Three separate guarantees break at once:
- **CAD-02 / D-02.** The customer receives their day-3 follow-up on day 0, three days early.
  `materialize.ts:24-35` calls the stored `scheduled_at` "the thing that happens"; a resume
  silently rewrites it.
- **D-10 min-gap.** Touch 1 went out at 09:35 the same morning. `computeResumeSchedule` only
  chains gaps *among unsent touches* — it never compares against an already-`sent` touch or
  its ledger row — so the customer gets two chases inside 40 minutes. That is exactly the
  "machine having a malfunction" `constants.ts:69-78` says the min-gap rule exists to prevent.
- **Cadence shape.** Every subsequent touch is re-derived from the pulled-forward slot, so the
  whole tail compresses by three days permanently.

The same applies to any resume path: `resumeCadence` (`controls.ts:446`), `resumeClient`
(`controls.ts:381`) and `resumeConnection` (`connect.ts:405`).

**This case is not covered by any test.** `tests/cadence-resume.test.ts:66-93` seeds every
touch in the past on purpose ("Touches 2..5 … every one of them in the past"), and the pure
suite's fixture (`tests/cadence-rewindow.test.ts:299-320`) picks `resumeAt = 2026-09-13`
against touches at Sep 3 / 7 / **14** / **21** — the two future touches happen to be pushed
*later* by the chained arithmetic, so the early-move never appears. Every assertion is
`toBeGreaterThanOrEqual(resumeAt)` or "strictly increasing", and both hold for a schedule that
has been pulled forward.

**Fix:** A resume must never move a touch earlier than where it already stood. Clamp the first
placement, and let the chained placements inherit the clamp:

```ts
if (previous === null) {
  const slot = nextAllowedSlot(resumeAt, win, preferredSendTime, jitterMinutes, {
    sameDayMarginMinutes: input.sameDayMarginMinutes,
  });
  // A RESUME REPAIRS OVERDUE TOUCHES; IT NEVER PROMOTES A FUTURE ONE. A touch
  // whose slot is still ahead of the resume moment did not slip, so there is
  // nothing to repair — and moving it forward would send a customer their next
  // follow-up days early, possibly in the same morning as the last one.
  at = slot.getTime() < touch.scheduledAt.getTime() ? touch.scheduledAt : slot;
}
```

Then add two tests:
1. Pure: `computeResumeSchedule` with a single unsent touch scheduled 3 days *after*
   `resumeAt` returns that touch's original `scheduledAt` unchanged.
2. Integration: seed an `active` cadence with touch 1 `sent` and touch 2 three days out, run
   `pauseClient` then `resumeClient` minutes apart, and assert touch 2's `scheduled_at` and
   `updated_at` are both unchanged (`applyResumeRewindow`'s no-op guard at `resume.ts:282`
   already makes the `updated_at` assertion meaningful).

---

## Warnings

### WR-01: The `no_address` refusal never retires the touch — it re-claims and re-logs every minute

**File:** `src/core/cadence/dispatch.ts:289-304`

**Issue:** When a claimed touch's channel has no snapshotted address, dispatch logs and
returns `{ kind: 'refused', reason: 'no_address' }` **without changing the touch's state**.
The touch stays `approved` and `scheduled_at <= now`, so the next tick claims it again — and
every tick after that, for up to `CADENCE_EXPIRY_DAYS` (42 days ≈ 60,000 ticks) until D-12
finally expires the cadence. Each iteration consumes one of the tenant's 50
`DISPATCH_BATCH_LIMIT` claim slots (starving genuinely sendable touches behind it, since
`claimDue` orders by `scheduled_at` and this row is the oldest) and emits an identical
`console.error` carrying the touch and cadence ids.

The comment argues correctly that writing a borrowed `TOUCH_SKIP_REASONS` value would put a
false statement in Phase 7's evidence. But "stays live and stays loud" is not what the code
does — it stays live and stays loud *sixty thousand times*, which is the same as being silent.

**Fix:** Add an honest terminal reason rather than reusing a false one, and use it here:

```ts
// src/db/schema/cadence-touches.ts + migration 0018 CHECK
export const TOUCH_SKIP_REASONS = [ /* … */, 'no_address' ] as const;
```
```ts
// dispatch.ts
await tx.touches.skipWhere([touch.id], 'no_address');
return { kind: 'refused', reason: 'no_address' };
```

If adding a vocabulary member is out of scope for this phase, the minimum viable change is to
exclude the row from future claims so it stops starving the batch — e.g. narrow `claimDue`
with `(channel = 'sms' AND cadences.contact_mobile IS NOT NULL) OR (channel = 'email' AND
cadences.contact_email IS NOT NULL)` — and raise the condition once through the operator alert
channel rather than once per minute through `console.error`.

---

### WR-02: The per-reason refusal breakdown is computed and then thrown away

**File:** `src/core/cadence/dispatch.ts:105-136, 440-443`; `src/core/cadence/run-tick.ts:389`; `src/app/api/internal/cadence-tick/route.ts:117`

**Issue:** `DISPATCH_REFUSALS` and `DispatchResult.refusals` exist to answer one stated
question — *"quiet because there was nothing to do, or quiet because we declined everything?"*
(`dispatch.ts:101-103`). `dispatchDueTouches` populates the six-way breakdown correctly, and
then `runCadenceTick` reads only `dispatch.refused` (the scalar total) into
`CadenceTickResult`, and the route emits only that. **The breakdown reaches no production
consumer.** An operator seeing `{ dispatched: 0, refused: 12 }` cannot distinguish twelve
paused tenants from twelve suppressed customers from twelve lost claims — which is exactly the
"previous shape" the comment says was replaced.

**Fix:** Carry the breakdown through, since the route already enumerates fields explicitly
(so nothing leaks by accident):

```ts
// run-tick.ts
export interface CadenceTickResult {
  // ...
  refused: number;
  refusals: Record<DispatchRefusal, number>;
}
// ...
refusals: dispatch.refusals,
```
```ts
// route.ts — counts only, one key per closed-vocabulary member
refused: result.refused,
refusals: result.refusals,
```

`tests/cadence-tick-route.test.ts`'s typed `ONE_RESULT` fixture will force both ends to stay
in step, which is the mechanism that suite was built for.

---

### WR-03: A second, unguarded `Math.random()` jitter draw in `consume-events.ts`

**File:** `src/core/cadence/consume-events.ts:254-257` (vs `src/core/cadence/jitter.ts:35-37`)

**Issue:**

```ts
// consume-events.ts
function defaultJitter(): number {
  return Math.floor(Math.random() * (JITTER_MAX_MINUTES + 1));
}
```
is byte-for-byte the body of `randomJitterMinutes()`. `jitter.ts`'s header exists specifically
to prevent this: *"Three inlined copies of `floor(random × (bound + 1))` is three places the
bound can drift from `JITTER_MAX_MINUTES`, and drift there is invisible."* The standing purity
greps that would have caught it cover `window.ts` (`tests/cadence-window.test.ts:327-329`),
`materialize.ts` (`tests/cadence-materialize.test.ts:365-367`), `rewindow.ts` and `resume.ts`
(`tests/cadence-rewindow.test.ts:419-422`) — **not** `consume-events.ts`.

**Fix:**

```ts
import { randomJitterMinutes } from './jitter';
// ...
const { batchLimit = CONSUME_BATCH_LIMIT, jitterMinutes = randomJitterMinutes } = options;
```
Delete `defaultJitter`, and extend the standing grep to `consume-events.ts` so a third copy
cannot appear.

---

### WR-04: Three consume-pass counters are computed and discarded by the tick

**File:** `src/core/cadence/consume-events.ts:232-243`; `src/core/cadence/run-tick.ts:376, 381-392`

**Issue:** `ConsumeQuoteEventsResult` carries `quotesFlaggedForReview`, `eventsSkipped` and
`cursorAt`. `runCadenceTick` reads only `eventsConsumed`, `cadencesCreated` and
`cadencesStopped`. The dropped ones are the operationally interesting half:

- **`eventsSkipped`** counts events consumed with *no action at all* because the tenant has no
  `sm8_connections` row (`consume-events.ts:536-546`). The comment calls this "the difference
  between 'nothing to do' and 'nothing happened'" — and then that difference is invisible in
  production. A tenant row deleted while events remain silently discards work with a green tick.
- **`quotesFlaggedForReview`** is the D-08 reopen triage count; it is the only signal that
  quotes have re-entered the operator's review queue.
- **`cursorAt`** is the one number that distinguishes a healthy tick from a wedged one (CR-02).

**Fix:** Add the three to `CadenceTickResult` and to the route's enumerated body. All are
counts/positions with no PII, consistent with the T-3-24 rule.

---

### WR-05: `claimDue` is the only cadence query that does not correlate `cadences.tenant_id`

**File:** `src/db/repository/for-tenant.ts:1390-1422`; `src/db/schema/cadences.ts:130-183`, `cadence-touches.ts:104-160`

**Issue:** The claim query joins `cadences` on `id` alone and filters the tenant only on the
touch side:

```ts
.from(cadenceTouches)
.innerJoin(cadences, eq(cadences.id, cadenceTouches.cadenceId))
.where(and(
  eq(cadenceTouches.tenantId, tenantId),
  eq(cadenceTouches.status, 'approved'),
  lte(cadenceTouches.scheduledAt, now),
  eq(cadences.status, 'active'),          // <- no eq(cadences.tenantId, tenantId)
))
```

It is the outlier. `completeWhereAllTouchesDone` correlates both sides
(`eq(cadenceTouches.tenantId, cadences.tenantId)`, `:1261-1263`), and `promoteDue`'s subquery
carries `cadences.tenant_id = ${tenantId}` (`:1382`). `claimDue` is also the *most* sensitive
of the three: it is the query whose result rows supply `contactMobile` / `contactEmail` /
`contactName` straight into a `SendRequest`.

Nothing enforces `cadence_touches.tenant_id = cadences.tenant_id` at the schema layer either.
`cadence_touches.tenant_id` is a bare `uuid().notNull()` with **no** `.references()` (migration
0016 declares only `cadence_touches_cadence_id_cadences_id_fk`), and `cadences.tenant_id`
likewise has none — the latter is documented as deliberate for attribution survival
(`cadences.ts:29-35`), but that argument does not extend to the *pairing* invariant. So the
only thing standing between a mis-set `tenant_id` and one tenant's dispatcher sending to
another tenant's customer is that every writer happens to take the value from the same closure.

For a phase whose review context calls multi-tenant RLS "defense-in-depth", the service-role
path having a single un-correlated join is the wrong side of that principle to be on.

**Fix:** Add the predicate (free — `cadences` is already joined and indexed on
`(tenant_id, status)`):

```ts
.where(and(
  eq(cadenceTouches.tenantId, tenantId),
  eq(cadences.tenantId, tenantId),   // the touch and its cadence are the same tenant's
  eq(cadenceTouches.status, 'approved'),
  lte(cadenceTouches.scheduledAt, now),
  eq(cadences.status, 'active'),
))
```

And consider a follow-up migration adding a composite guard so the invariant is structural:

```sql
ALTER TABLE public.cadences ADD CONSTRAINT cadences_tenant_id_uniq UNIQUE (id, tenant_id);
ALTER TABLE public.cadence_touches
  ADD CONSTRAINT cadence_touches_cadence_tenant_fk
  FOREIGN KEY (cadence_id, tenant_id) REFERENCES public.cadences (id, tenant_id)
  ON DELETE CASCADE;
```

---

### WR-06: `resumeConnection` re-windows every active cadence, including ones created during the pause

**File:** `src/core/sync/connect.ts:404-411` (vs `src/core/cadence/resume.ts:176-197`)

**Issue:** The auth-recovery path calls `applyResumeRewindow(tenantId, new Date())` with no
`onlyCadenceIds`, so `scope === null` and **every** active cadence is re-windowed
(`resume.ts:220, 256`). `resume.ts`'s own documentation for that parameter describes precisely
why that is wrong:

> a tenant may have gained brand new cadences DURING the pause, created by event consumption,
> which deliberately keeps running for paused tenants. Those were materialized from a fresh
> anchor and their slots are already correct and in the future; re-windowing them would drag
> touch one forward to the resume moment and send a customer their first message days early.

That hazard applies verbatim here. `consumeQuoteEvents` runs for connection-paused tenants by
design (`for-all-tenants.ts:274-291`), and an operator can triage quotes to `eligible` in the
console while a client's key is dead — so new, correctly-scheduled cadences do accumulate
during a connection pause. The comment at `connect.ts:390-392` says the three resume paths use
"one implementation, so the three cannot drift into three different answers" — but two of them
pass a scope and one does not, which *is* two different answers.

Compounded by CR-03, this is the worst instance of that bug: a brand-new cadence's touch 1
gets pulled to the re-key moment.

**Fix:** Scope the auth-recovery re-window to cadences that existed before the pause began.
`sm8_connections.paused_at` is available on the row `resumeConnection` already read, so:

```ts
const frozen = (await forTenant(tenantId).cadences.listLive())
  .filter((c) => c.status === 'active' && c.createdAt < pausedAt)
  .map((c) => c.id);
await applyResumeRewindow(tenantId, new Date(), { onlyCadenceIds: frozen });
```

Applying the CR-03 clamp makes this defensive rather than load-bearing, but both are worth
having: the clamp stops the early send, the scope stops the pointless writes.

---

### WR-07: A missing quote row leaves the cadence live and writes a false skip reason

**File:** `src/core/cadence/dispatch.ts:265-287`

**Issue:**

```ts
const [quote] = await tx.quotes.stateFor([touch.sm8JobUuid]);
const chaseable = quote !== undefined && /* ... */;

if (!chaseable) {
  await tx.touches.skipWhere([touch.id], 'quote_closed');
  if (quote) { /* stop the cadence with the honest reason */ }
  return { kind: 'refused', reason: 'quote_closed' };
}
```

When `quote` is `undefined` — the mirrored row is gone entirely — the touch is retired as
`quote_closed` but the **cadence is not stopped**. The remaining touches stay live, so every
subsequent tick claims the next one and writes another `quote_closed` skip, one per tick,
until the cadence runs out of touches and the completion sweep closes it as
`all_touches_done`. Phase 7 then reads a cadence that "ran its course" with five
`quote_closed` skips, none of which is true: the quote did not close, it ceased to exist in
our mirror.

The `if (quote)` guard is correct in *refusing to guess a stop reason* — `stopReasonForQuote`
genuinely cannot answer from a missing row. But the consequence, a live cadence bleeding one
false skip per tick, is worse than the thing being avoided.

**Fix:** Distinguish the two cases. `CADENCE_STOP_REASONS` already has `removed`, which is the
honest reading of "the job is not in our mirror any more" (it is what
`stopReasonForQuote` returns for `!sm8Active`):

```ts
if (!chaseable) {
  await tx.touches.skipWhere([touch.id], quote ? 'quote_closed' : 'cadence_stopped');
  const reason: CadenceStopReason = quote ? stopReasonForQuote(quote) : 'removed';
  const cadences = await tx.cadences.stopWhereLive([touch.cadenceId], reason);
  if (cadences.length > 0) {
    await tx.touches.skipUnsentForCadences([touch.cadenceId], 'cadence_stopped');
  }
  return { kind: 'refused', reason: 'quote_closed' };
}
```

---

### WR-08: All four control-action results render simultaneously, producing contradictory copy

**File:** `src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx:59-85`

**Issue:** Four independent `useActionState` hooks each retain their last result, and all four
`<Message>` components are rendered unconditionally at the top of the panel. `useActionState`
does not clear sibling states, and the component does not unmount between actions (the
`revalidatePath` refresh re-renders it in place). So an operator who taps *Pause this client*
and then *Resume this client* sees, stacked:

> Paused. Nothing goes out for this client until you resume.
> Resumed. Follow-ups were rescheduled to the next available slots inside contact hours.

Both with `role="status"`, both read out to a screen-reader user in that order. For a control
surface whose stated purpose is that an operator "standing in a driveway, one-handed" can tell
what state a client is in, two contradictory confirmations is the failure the copy constants
were carefully written to avoid.

**Fix:** Render only the most recent outcome. The simplest correct form is a single message
slot keyed by the last submitted action:

```tsx
const [last, setLast] = useState<'kill' | 'pause' | 'resumeClient' | 'resumeCadence' | null>(null);
const state =
  last === 'kill' ? killState :
  last === 'pause' ? pauseState :
  last === 'resumeClient' ? resumeClientState :
  last === 'resumeCadence' ? resumeCadenceState : BLANK_CONTROL_STATE;

// each <form> gets onSubmit={() => setLast('pause')} etc.
<Message state={state} />
```

---

### WR-09: Event consumption writes template and settings rows on runs that need neither

**File:** `src/core/cadence/consume-events.ts:574-588`

**Issue:** Both writes are unconditional for any run with a known tenant:

```ts
if (tenant) {
  await tx.templates.ensureDefaults(DEFAULT_TOUCH_OFFSET_DAYS);   // 5-row INSERT … ON CONFLICT
  templates = (await tx.templates.list()).map(/* … */);
  const settings = await tx.settings.ensure();                    // INSERT … ON CONFLICT + SELECT
  preferredSendTime = settings.preferredSendTime || DEFAULT_PREFERRED_SEND_TIME;
}
```

A run consisting only of `won` / `lost` / `removed` / `reopened` events needs neither
templates nor a send time — `stopCadenceForClosingEvent` uses neither. The effect is four
extra statements per tenant per tick forever, and a semantic side effect: a `won` event alone
now **creates** a `cadence_settings` row for a tenant that has never had a cadence. That row
then joins into `forAllTenants_cadenceTick`'s `settingsPausedAt` and into the console's
"client paused" read, changing the meaning of "no settings row" that
`CadenceTickTenant.preferredSendTime`'s doc (`for-all-tenants.ts:252-258`) and
`resume.ts:248-250` both depend on. It also sits awkwardly beside
`for-tenant.ts:398-405`'s rule that read paths must not lazily insert configuration rows.

**Fix:** Lazily resolve both, inside the `quote_opened` branch only:

```ts
let prepared: { templates: MaterializeTemplate[]; preferredSendTime: string } | null = null;
const prepare = async () => {
  if (prepared) return prepared;
  await tx.templates.ensureDefaults(DEFAULT_TOUCH_OFFSET_DAYS);
  const rows = await tx.templates.list();
  const settings = await tx.settings.ensure();
  prepared = {
    templates: rows.map((r) => ({ touchNumber: r.touchNumber, offsetDays: r.offsetDays, channel: r.channel as TouchChannel })),
    preferredSendTime: settings.preferredSendTime ?? DEFAULT_PREFERRED_SEND_TIME,
  };
  return prepared;
};
```

---

### WR-10: `window_refused` is a skip reason with a CHECK constraint and a UI label and no writer

**File:** `src/db/schema/cadence-touches.ts:93-102`; `src/db/migrations/0017_cadence_grants_and_constraints.sql:218-226`; `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx:137-145`

**Issue:** `'window_refused'` appears in `TOUCH_SKIP_REASONS`, in the 0017 CHECK vocabulary,
and in the console's `SKIP_REASON_LABELS` (rendered as *"outside the client's contact
hours"*). A repository-wide search finds **no writer**: `dispatch.ts:323-328` deliberately
refuses out-of-window sends *silently* and leaves the touch alone, and `rewindow.ts:90` narrows
its skip union to `'min_gap' | 'stale'`.

The silent refusal is the right behaviour and is well argued. The problem is that the schema
and the UI both assert a state the engine cannot reach: an operator auditing "which rule
retired this touch" is offered a fourth answer that never occurs, and a future contributor
reading `TOUCH_SKIP_REASONS` will reasonably conclude that out-of-window touches *are* retired.

Related: `'operator_closed'` in `CADENCE_STOP_REASONS` has a matrix arm
(`transitions.ts:248-249, 294-296`) but no caller — `controls.ts` exposes kill, pause and two
resumes, and nothing raises `operator_closed`. That one is honest forward-declaration for D-16;
`window_refused` is not, because it contradicts a decision this phase actually made.

**Fix:** Either remove `window_refused` from the vocabulary, the CHECK and the label, or leave
it and mark it explicitly reserved in the schema comment beside the members that do have
writers — e.g. `/* RESERVED. No writer: dispatch refuses out-of-window sends silently and the
re-window pass owns moving the touch (dispatch.ts:323-328). */`. Removing is preferable: the
CHECK vocabulary is the thing migrations 0004/0008/0011/0017 argue should mean exactly what
the code produces.

---

### WR-11: Convention drift across the cadence modules

**File:** `src/core/cadence/consume-events.ts:587`; `src/core/cadence/controls.ts:58`

**Issue:** Two small inconsistencies in a codebase whose stated design principle is that one
rule must have one expression:

1. **`||` vs `??` for the preferred-send-time fallback.** `consume-events.ts:587` uses
   `settings.preferredSendTime || DEFAULT_PREFERRED_SEND_TIME`, while `run-tick.ts:214`,
   `resume.ts:250` all use `?? DEFAULT_PREFERRED_SEND_TIME`. `cadence_settings.preferred_send_time`
   is `time NOT NULL` so they agree today, but they are two answers to one question, and the
   `||` form additionally coerces an empty string — which is exactly what `parseTimeOfDay`
   would then throw on.
2. **A deep repository import that bypasses the audited barrel.** `controls.ts:58` imports
   `import { forTenant, type SuppressionProbe } from '@/db/repository/for-tenant';` while every
   other consumer (`dispatch.ts:56-62`, `consume-events.ts:81-89`, `run-tick.ts:81-85`,
   `resume.ts:52`, `eligibility.ts:27`) goes through `@/db/repository`. The barrel exists so a
   reviewer can read one file to see the whole sanctioned surface (`index.ts:1-8`); a deep
   import is a second door. Note `tests/cadence-resume.test.ts:22-23` does the same.

**Fix:** Use `??` in `consume-events.ts:587`, import `forTenant` from `@/db/repository` in
`controls.ts`, and — since ESLint already bans the raw client via path (`tests/lint-ban.test.ts`)
— add a `no-restricted-imports` rule for `@/db/repository/for-tenant` outside
`src/db/repository/**` so the barrel stays the only door.

---

_Reviewed: 2026-08-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
