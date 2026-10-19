---
phase: 02-servicem8-sync-quote-leakage-audit
reviewed: 2026-08-27T00:00:00Z
depth: standard
files_reviewed: 46
files_reviewed_list:
  - proxy.ts
  - vercel.json
  - package.json
  - scripts/apply-cron-schedules.mjs
  - scripts/backfill-baselines.mjs
  - scripts/grant-operator.mjs
  - scripts/lib/ts-alias-hook.mjs
  - scripts/verify-audit.mjs
  - src/app/(console)/audits/[id]/actions.ts
  - src/app/(console)/audits/[id]/convert-form.tsx
  - src/app/(console)/audits/[id]/mapping/actions.ts
  - src/app/(console)/audits/[id]/mapping/mapping-form.tsx
  - src/app/(console)/audits/[id]/mapping/page.tsx
  - src/app/(console)/audits/[id]/page.tsx
  - src/app/(console)/audits/new/actions.ts
  - src/app/(console)/audits/new/form.tsx
  - src/app/(console)/audits/new/page.tsx
  - src/app/(console)/audits/page.tsx
  - src/app/(console)/clients/[id]/actions.ts
  - src/app/(console)/clients/[id]/connect-form.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/clients/[id]/triage-form.tsx
  - src/app/(console)/layout.tsx
  - src/app/(console)/page.tsx
  - src/app/api/internal/sync-tick/route.ts
  - src/app/api/webhooks/servicem8/route.ts
  - src/core/alerts/operator-email.ts
  - src/core/audit/aggregate.ts
  - src/core/audit/constants.ts
  - src/core/audit/csv-intake.ts
  - src/core/audit/csv-mapping.ts
  - src/core/audit/fetch-history.ts
  - src/core/audit/followup.ts
  - src/core/audit/generate.ts
  - src/core/servicem8/client.ts
  - src/core/servicem8/normalize.ts
  - src/core/servicem8/pagination.ts
  - src/core/servicem8/schemas.ts
  - src/core/shared/crypto.ts
  - src/core/shared/env.ts
  - src/core/shared/tenant.ts
  - src/core/sync/connect.ts
  - src/core/sync/cursor.ts
  - src/core/sync/eligibility.ts
  - src/core/sync/failure-policy.ts
  - src/core/sync/health.ts
  - src/core/sync/outcomes.ts
  - src/core/sync/run-sync.ts
  - src/core/sync/transitions.ts
  - src/db/migrations/0009_is_operator_helper.sql
  - src/db/migrations/0010_sync_tables.sql
  - src/db/migrations/0011_sync_table_grants.sql
  - src/db/migrations/0012_cron_details_cleanup.sql
  - src/db/migrations/0013_prospects.sql
  - src/db/migrations/0014_prospect_grants_and_purge.sql
  - src/db/repository/client.ts
  - src/db/repository/conversion.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/repository/prospects.ts
  - src/db/schema/prospects.ts
  - src/db/schema/quote-events.ts
  - src/db/schema/sm8-connections.ts
  - src/lib/supabase/server.ts
findings:
  critical: 3
  warning: 9
  info: 6
  total: 18
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-08-27
**Depth:** standard
**Files Reviewed:** 46 source files (+ migrations, scripts, console pages)
**Status:** issues_found

## Summary

This is unusually careful code. The credential envelope (`crypto.ts`), the timing-safe bearer check, the tenant-scoped repository closure, the closed `sync_runs` vocabulary, the transactional outbox and the `chase_eligibility` conflict-set omission are all correct and well-defended, and `tsc --noEmit` is clean. The review found nothing wrong with the AES-256-GCM implementation, the cursor arithmetic, the transition matrix, or the integer-cents money path.

The defects that do exist cluster in one place: **the code's own comments assert guarantees that the code does not deliver.** Three of them are load-bearing.

1. The prospect/audit server actions claim `is_operator()` RLS is "the whole of the authorization story", but every write on those paths goes through the service-role drizzle client, where RLS is inert. They authenticate; they do not authorize.
2. `deriveHealth`'s header says "Derivation cannot lie in that direction" about a stale connection reading healthy. It can, and does — nothing in the function looks at how old `last_success_at` is.
3. `prospects.csv_staging` is documented as a workspace that "must not outlive the confirmation that consumed it", but there is no purge for it and every abandoned upload leaves a full copy of a stranger's customer data in the database indefinitely.

Each of these is a stated phase guarantee (operator-only prospect access, "no silent dead client", 30-day prospect PII retention) that a reader of the comments would believe is enforced. Several warnings below are the same shape at lower stakes.

## Critical Issues

### CR-01: Prospect/audit server actions authorize nobody — service-role writes bypass the `is_operator()` policy they claim to rely on

**File:** `src/app/(console)/audits/new/actions.ts:198-201` (and `src/app/(console)/audits/[id]/actions.ts:36-40`, `src/app/(console)/audits/[id]/mapping/actions.ts:50-58`)

**Issue:** All three prospect-mutating actions perform exactly one check:

```ts
const { data: claims } = await supabase.auth.getClaims();
if (!claims?.claims) { /* session expired */ }
```

That proves a valid Supabase session exists. It proves nothing about the operator allowlist. The comment at `audits/new/actions.ts:184-188` states:

> "The operator allowlist is the whole of the authorization story here, and it is enforced by the `is_operator()` policies plus the withheld INSERT grant on `prospects`."

That is false for these code paths. `createProspect`, `storeAuditResults` and `convertProspectToTenant` all call `getDb()` (`src/db/repository/client.ts`), which connects with `DATABASE_URL` — service-role-equivalent, RLS bypassed by design (the file's own header says so). The withheld `authenticated` INSERT grant is likewise irrelevant, because the writes are not made as `authenticated`.

Compare `src/app/(console)/clients/[id]/actions.ts:128-152`, which does this correctly: after `getClaims()` it performs an RLS-scoped read of `tenants` through the operator's own JWT and lets Postgres decide membership. The audit actions have no equivalent second check.

Consequences, in ascending order of severity:

- Any authenticated non-operator can create prospects and publish audits (writing a stranger's ServiceM8 key into `prospects.api_key_ciphertext`).
- `convertProspectAction` is the **only** code path that clears `purge_after` (`conversion.ts:104-108`). A caller with any session can therefore cancel the D-04 retention policy on a stranger's customer PII — which is precisely threat T-2-07, and precisely what that action's own header (lines 28-31) says it exists to prevent.
- `src/app/(console)/audits/[id]/mapping/page.tsx:42-45` reads `getProspect`/`getProspectStaging` through the same service-role path, so any authenticated user who can name a prospect uuid renders that prospect's staged CSV rows.

The blast radius is small *today* only because there is one Supabase user. It becomes real the moment a second operator account exists, or the v2 client reports portal gives clients logins — which is the exact scenario `src/db/schema/prospects.ts:169-175` argues the allowlist was designed for.

**Fix:** Prove operator status through an RLS-scoped read, the same way the client actions prove tenant membership, and factor it so all three actions share it:

```ts
// src/app/(console)/_auth.ts
export async function requireOperator(): Promise<'ok' | 'unauthenticated' | 'forbidden'> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return 'unauthenticated';

  // Read through the operator's own JWT: the operator_allowlist policy is
  // `is_operator()`, so a non-operator gets zero rows, not an error.
  const { data } = await supabase
    .from('operator_allowlist')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();

  return data ? 'ok' : 'forbidden';
}
```

Call it first in `createAuditAction`, `confirmMappingAction` and `convertProspectAction` (before the body is read, matching the existing auth-first convention), and in `MappingPage` before `getProspectStaging`. Then correct the comment at `audits/new/actions.ts:184-188` — it currently teaches the next author that no check is needed.

---

### CR-02: `deriveHealth` ignores staleness — a client whose sync has entirely stopped renders "healthy"

**File:** `src/core/sync/health.ts:92-108`

**Issue:** The function's inputs are `pausedAt`, `statusReason`, `consecutiveFailures` and `lastSuccessAt`, and `lastSuccessAt` is only ever tested for presence:

```ts
if (!lastSuccessAt) return 'never-synced';
if (consecutiveFailures >= DEGRADED_AFTER_FAILURES) return 'degraded';
return 'healthy';
```

Nothing compares it to the current time. The module header (lines 5-11) makes the opposite claim explicitly:

> "A connection whose stored health says `healthy` and whose last successful sync was four hours ago looks fine and is not. Derivation cannot lie in that direction: the inputs ARE the state."

It can lie in exactly that direction, and there are at least three reachable ways to get there — all of which share the property that `sync_runs` gets no row, so `consecutive_failures` never increments and `paused_at` never gets set:

1. **Secret rotation.** `scripts/apply-cron-schedules.mjs:33-35` documents the window: "Rotating `SYNC_TICK_SECRET` means: update the Vercel env, redeploy, then re-run this script. In between, the tick 401s." During that window `POST /api/internal/sync-tick` returns 401 before `runSyncTick()` is ever called. `net.http_post` got a response, so `cron.job_run_details` reads green — this is RESEARCH Pitfall 7 reintroduced through a different door, and the console shows every client `healthy`.
2. **Cron unscheduled / misapplied.** Same signature: no requests, no rows, all badges green.
3. **Tick starvation** (see WR-03): clients the tick never reaches keep `consecutive_failures = 0` and a stale `last_success_at`.

In all three, the phase's "no silent dead client" criterion fails silently — no banner, no badge change, no operator email — which is the specific outcome the whole SYNC-04 alerting design exists to make impossible.

**Fix:** Add a staleness rule above `healthy`, keyed to the tick interval, and pass `now` in so it stays testable:

```ts
/** Ticks are every 5 minutes (D-13). Three missed ticks is not weather. */
export const STALE_AFTER_MS = 15 * 60_000;

export function deriveHealth(
  connection: HealthInputs | null | undefined,
  now: Date = new Date(),
): SyncHealth {
  if (!connection) return 'never-synced';
  const { pausedAt, statusReason, consecutiveFailures, lastSuccessAt } = connection;

  if (pausedAt) return statusReason === 'auth_failed' ? 'auth-failed' : 'degraded';
  if (!lastSuccessAt) return 'never-synced';
  if (consecutiveFailures >= DEGRADED_AFTER_FAILURES) return 'degraded';

  // The tick itself stopping is invisible to consecutive_failures — no cycle
  // ran, so nothing incremented. Staleness is the only observable.
  const last = lastSuccessAt instanceof Date ? lastSuccessAt : new Date(lastSuccessAt);
  if (now.getTime() - last.getTime() > STALE_AFTER_MS) return 'degraded';

  return 'healthy';
}
```

Both call sites (`(console)/page.tsx:110`, `(console)/clients/[id]/page.tsx:401`) pick this up with no change. Consider also a separate "tick heartbeat" check so a global cron failure raises one alert rather than fifteen badges nobody is looking at.

---

### CR-03: `prospects.csv_staging` holds a full copy of a non-client's customer data with no retention at all

**File:** `src/db/schema/prospects.ts:151-158`, `src/db/migrations/0014_prospect_grants_and_purge.sql:152-156`, `src/app/(console)/audits/new/actions.ts:159-167`

**Issue:** `stageCsvUpload` writes the *entire parsed CSV* into `prospects.csv_staging`:

```ts
csvStaging: { headers, rows: parsed.data },
```

`parsed.data` is every column of every row — not the seven mapped fields. For the real ServiceM8 Job List export (`tests/fixtures/sm8/job-list-export.csv`) that includes `Job Address`, `Billing Address`, `Job Email Address`, `Job Telephone Number`, `Job Contact Mobile Number`, `Billing Email Address`, `Billing Telephone Number`, `Description of work` and more — i.e. strictly *more* PII than `prospect_quote_lines`, which the schema header calls "the highest-sensitivity data in this phase".

The D-04 purge job covers only the line table:

```sql
DELETE FROM prospect_quote_lines WHERE purge_after IS NOT NULL AND purge_after < now()
```

`csv_staging` has no `purge_after`, no expiry column, and is not touched by any scheduled job. It is cleared in exactly one place — `storeAuditResults` (`prospects.ts:170`) — which runs only on a *successful* mapping confirmation. Every other exit from the mapping flow leaves it populated forever:

- the operator uploads and navigates away (the overwhelmingly likely case mid-sales-call);
- `confirmCsvMapping` returns `missing_columns`, `no_usable_rows`, `unknown_header`, or `needs_acknowledgement` and the operator gives up;
- the prospect never converts and is simply forgotten.

Both the schema comment (lines 155-157) and `prospects.ts:167-170` state the requirement — "leaving it populated would keep a second copy of every contact detail alive past the purge that empties the line table" — and neither is enforced by anything.

**Fix:** Give staging its own clock and sweep it in the existing daily job. Staging is a workspace measured in minutes, so it does not need the 30-day line window:

```sql
-- new migration
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS csv_staging_expires_at timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prospect-staging-sweep') THEN
    PERFORM cron.unschedule('prospect-staging-sweep');
  END IF;
END
$$;

-- Hourly: an abandoned upload is dead within the sales meeting it came from.
SELECT cron.schedule(
  'prospect-staging-sweep',
  '20 * * * *',
  $$UPDATE prospects
      SET csv_staging = NULL, csv_staging_expires_at = NULL
    WHERE csv_staging IS NOT NULL
      AND csv_staging_expires_at IS NOT NULL
      AND csv_staging_expires_at < now()$$
);
```

Set `csvStagingExpiresAt: sql\`now() + interval '24 hours'\`` in `createProspect` on the CSV branch, and clear it alongside `csvStaging` in `storeAuditResults`. `MappingPage` already handles absent staging by redirecting to the report (`mapping/page.tsx:51`), so expiry degrades correctly, and `confirmCsvMapping`'s `no_staging` copy already says "has already been used or has expired".

## Warnings

### WR-01: The webhook endpoint is a client-enumeration oracle, contradicting its own comment

**File:** `src/app/api/webhooks/servicem8/route.ts:138-150`

**Issue:** The unauthenticated POST handler returns three distinguishable statuses:

```ts
if (!connection) return acknowledged('unknown');   // uuid not in any mirror, or paused
if (since < DEBOUNCE_MS) return acknowledged('debounced');
...
return acknowledged('polled');
```

`unknown` versus `polled`/`debounced` is a direct yes/no on "is this ServiceM8 job uuid mirrored by one of our clients". The comment immediately above (lines 140-144) claims the opposite:

> "the response says nothing about whether the job exists in our mirror — a webhook endpoint that distinguished 'not ours' from 'paused' would be an enumeration oracle over client accounts."

It correctly avoids distinguishing *not-ours* from *paused*, and then distinguishes both from *ours-and-active*. Anyone holding a set of ServiceM8 job uuids (a competitor, a former staff member, another ServiceM8 app) can determine which businesses are clients of this service. Response timing widens it further: `polled` awaits a full multi-request sync cycle, `unknown` returns after one indexed SELECT.

**Fix:** Collapse the response to a single constant for every non-challenge POST, and keep the distinction server-side only:

```ts
/** One response for every hint, resolvable or not. See the header. */
function acknowledged(): Response {
  return Response.json({ status: 'accepted' });
}
```

If the status values are wanted for local debugging, log them server-side rather than returning them. Note the timing channel remains unless the poll is detached; at minimum, do not advertise the answer in the body.

---

### WR-02: The webhook debounce fails open exactly when the account is already in trouble

**File:** `src/app/api/webhooks/servicem8/route.ts:147-150`, `src/db/repository/for-all-tenants.ts:98-100`

**Issue:** The debounce is measured from `lastSuccessAt`:

```ts
const since = connection.lastSuccessAt
  ? Date.now() - connection.lastSuccessAt.getTime()
  : Number.POSITIVE_INFINITY;
if (since < DEBOUNCE_MS) return acknowledged('debounced');
```

`last_success_at` is written only by the success path of `runSyncForConnection` (`run-sync.ts:483`). During any failure episode — `rate_limited`, `network_error`, `server_error`, `parse_error` — it stops advancing, so `since` grows without bound and **the debounce never engages again until a cycle succeeds**.

The header (lines 56-66) justifies the debounce specifically as protection for an account with a 180-req/min cap. The scenario it protects against is a burst; the scenario it fails in is a sustained failure, where each unauthenticated POST triggers a fresh `fetchAndParse` — two resources, up to 3 attempts each, with 20s timeouts and 1s/4s jittered sleeps between them. That is unbounded amplification against a third party's rate-limited account, reachable by anyone who knows one job uuid, and it also inflates `consecutive_failures` on a schedule the attacker chooses.

**Fix:** Debounce on the last *attempt*, not the last success. The cheapest correct source is already written on every cycle, success or failure:

```ts
// for-all-tenants.ts — add to the webhook-hint select
lastAttemptAt: sql<Date | null>`(
  select max(sr.started_at) from sync_runs sr where sr.tenant_id = ${quotes.tenantId}
)`,
```

or add a `last_attempt_at` column to `sm8_connections` written in both `recordFailure` and the success branch. Then debounce on `max(lastAttemptAt, lastSuccessAt)`.

---

### WR-03: The tick is strictly sequential under a hard 300s ceiling — the tail of the client list starves, always the same clients

**File:** `src/core/sync/run-sync.ts:544-567`, `src/app/api/internal/sync-tick/route.ts:42`

**Issue:** `runSyncTick` awaits each connection in turn:

```ts
for (const conn of due) {
  try { results.push(await runSyncForConnection(conn, options)); } catch { ... }
}
```

Per-client worst case, with `REQUEST_TIMEOUT_MS = 20_000` (`client.ts:24`), 3 attempts (`IN_CYCLE_RETRY_DELAYS_MS` has 2 entries), and two resources per attempt: ~60s of timeouts on `job.json` alone, plus ~5s of jittered sleeps. That is ~65s for one slow client, so **roughly five clients consume the entire `maxDuration = 300` budget**. At the target of 15 clients, a ServiceM8 slowdown means two-thirds are never attempted.

`forAllTenants_syncTick` orders by `tenants.name` "so a partial tick ... covers the same clients in the same order rather than a shuffling subset" (`for-all-tenants.ts:68-71`). That stability, combined with the timeout, means the *same* clients are starved every tick — a client whose business name sorts late gets systematically less sync than one that sorts early, for as long as the slowdown lasts.

A starved client writes no `sync_runs` row and never increments `consecutive_failures`, so with CR-02 unfixed it renders `healthy` throughout.

**Fix:** Budget the tick and record what it could not reach:

```ts
const DEADLINE_MS = 240_000; // leave headroom inside maxDuration = 300
const startedAt = Date.now();

for (const conn of due) {
  if (Date.now() - startedAt > DEADLINE_MS) {
    results.push({ tenantId: conn.tenantId, outcome: null, recorded: false, skipped: true, /* ... */ });
    continue;
  }
  ...
}
```

Return the skipped count from the route so it is visible, and rotate the start offset (or order by `last_success_at ASC NULLS FIRST`) so starvation cannot be permanent. Bounding total per-client wall clock — e.g. an `AbortSignal` covering the whole cycle, not just each request — is the sharper fix.

---

### WR-04: `fetchAllPages` returns `ok: true` with silently truncated data at `MAX_PAGES`

**File:** `src/core/servicem8/pagination.ts:73-115`

**Issue:** The walk exits the loop on `page < maxPages` and falls straight into:

```ts
return { ok: true, data: collected };
```

There is no distinction between "the walk terminated because there was no more data" and "the walk terminated because it hit the 50-page cap". The function's own header (lines 58-60) promises otherwise:

> "Returns the FIRST failure encountered rather than a partial result ... Partial success is the one outcome this function will not produce."

It produces exactly that at the cap. Downstream, a truncated `job.json` walk yields an audit with understated `quotesIssued`, `totalValueCents` and `recoverableEstimateCents` that looks complete — the failure mode `fetch-history.ts:34-40` says is "worse than no audit, because it looks exactly like a complete one". `fetch90DayQuoteHistory` also fetches `jobcontact.json` with **no filter at all** (line 147), i.e. the account's entire contact table, which is the most likely place to hit the cap.

The cap is unlikely to be reached against the measured behaviour (the API ignores the cursor, so `fresh === 0` breaks on page 2), but the whole reason the loop still exists is that the measurement is "HONEST BUT NOT CONCLUSIVE" on a 6-job account.

**Fix:** Make the cap an explicit failure:

```ts
let hitCap = true;
for (let page = 0; page < maxPages; page++) {
  ...
  // every existing `break` should set hitCap = false before breaking
}
if (hitCap) {
  return {
    ok: false,
    kind: 'parse_error',
    detail: `page walk hit the ${maxPages}-page cap on ${resource} — result would be truncated`,
  };
}
return { ok: true, data: collected };
```

Also add a filter to the `jobcontact.json` fetch in `fetch-history.ts:147` (e.g. `edit_date gt '${cutoff}'`, matching the other three), or accept that a large account's contacts cannot be fetched in one walk.

---

### WR-05: API and CSV `followedUp` use different rules, contradicting the shared-path guarantee

**File:** `src/core/audit/csv-mapping.ts:387-403` vs `src/core/audit/followup.ts:62-73`

**Issue:** The API path computes follow-up as "at least one signal at or after quote + 72h":

```ts
const deadline = graceDeadline(quoteDateUtc).getTime();
return signals.some((s) => s != null && s.getTime() >= deadline);
```

The CSV path computes it with no timing test whatsoever:

```ts
followedUp: status !== 'Quote',
```

These disagree on a common case. A quote won two hours after it was issued has `work_order_date < deadline`, so the API path reports `followedUp: false` (a leak) while the CSV path reports `true` (chased). A quote issued 60 days ago whose status changed on day 1 and never again: CSV says followed up, API says leak.

`fetch-history.ts:5-12` states the reason this matters:

> "The audit is a PROMISE made to a prospect; the client's monthly report is the DELIVERY against it. If the two are computed by different fetch paths, the first thing a converted client sees is a number that contradicts the document that sold them ... Sharing the path makes disagreement unexpressible rather than merely unlikely."

The shared path is `computeAuditFigures`/`computeBaseline`. `followedUp` is upstream of it, and there the two paths diverge — so the disagreement is expressible, and it surfaces for exactly the prospects who converted from a CSV audit (`csv_note_degraded = true`) and then get an API-derived baseline at connect.

The CSV degradation is disclosed on the report ("no status change after the quote"), which covers the *evidence* difference honestly. It does not cover the *timing* difference, which is a separate and undisclosed rule change.

**Fix:** Apply the same grace deadline to the CSV signals available. The export carries `Work Order Date`, `Unsuccessful Date`, `Completion Date` and `Invoice Sent Stamp` — map them as optional columns and route them through `isFollowedUp` like the API path does, so one function owns the rule:

```ts
followedUp: isFollowedUp(quoteDateUtc, [
  sm8ToUtc(cell(row, mapping.work_order_date), SM8_TIMESTAMP_ZONE),
  sm8ToUtc(cell(row, mapping.unsuccessful_date), SM8_TIMESTAMP_ZONE),
  sm8ToUtc(cell(row, mapping.completion_date), SM8_TIMESTAMP_ZONE),
]),
```

If that is too large for this phase, at minimum state the divergence in `csv-mapping.ts`'s comment (which currently implies parity) and extend the report footnote.

---

### WR-06: `resumeConnection` reports success when the connection UPDATE matched no rows

**File:** `src/core/sync/connect.ts:323-361`

**Issue:**

```ts
const [updated] = await repo.connection.update({ ... });

let syncOutcome: SyncOutcome | null = null;
try {
  const cycle = await runSyncForConnection({
    ...
    apiKeyCiphertext: updated.apiKeyCiphertext,   // TypeError if `updated` is undefined
    ...
  });
  syncOutcome = cycle.outcome;
} catch {
  syncOutcome = null;
}

return { ok: true, keyLast4: last4, syncOutcome };
```

`connection.update` returns `[]` when the `WHERE tenant_id = ...` predicate matches nothing — reachable if the connection row was deleted between the `repo.connection.get()` check at line 307 and this write. `updated` is then `undefined`, `updated.apiKeyCiphertext` throws a `TypeError`, and that throw is caught by the very next `catch` block (whose comment says it is for "A LOCAL failure (the database went away)"). The function returns `ok: true` and the console renders "Key replaced. Sync resumed" for a re-key that wrote nothing.

The same swallow means a genuine programming error here is indistinguishable from a transient database blip.

**Fix:** Check the write before entering the try:

```ts
const [updated] = await repo.connection.update({ ... });
if (!updated) {
  // Deleted between the existence check and the write. Nothing was stored.
  return { ok: false, kind: 'not_connected' };
}
```

The same guard is worth adding at `run-sync.ts:387` where `recordFailure` already handles the deleted-mid-cycle case correctly (line 313-314) — that one is a good precedent to follow here.

---

### WR-07: `FailurePolicyDecision.incrementFailures` is computed, documented and never read

**File:** `src/core/sync/failure-policy.ts:47-48, 80, 95` and `src/core/sync/run-sync.ts:316-331`

**Issue:** `applyFailurePolicy` returns `incrementFailures: true` on both branches, documented as "Whether to bump `consecutive_failures`". The single consumer ignores it entirely:

```ts
const decision = applyFailurePolicy({ ... });

await tx.connection.update({
  consecutiveFailures: locked.consecutiveFailures + 1,   // unconditional
  pausedAt: decision.pauseReason ? now : locked.pausedAt,
  statusReason: decision.pauseReason ?? locked.statusReason,
  alertedAt: decision.alertKind ? now : locked.alertedAt,
});
```

`decision.pauseReason` and `decision.alertKind` are honoured; `decision.incrementFailures` is not. The policy module's header argues at length that the split exists so "a policy that can only be exercised through both is a policy whose branches get tested by whichever path an integration test happened to take" — but a third of the decision it returns is decorative, so a future `incrementFailures: false` branch (say, "do not count a 429 against the degraded threshold") would be written, tested at the policy level, and silently ignored in production.

**Fix:** Honour it —

```ts
consecutiveFailures: decision.incrementFailures
  ? locked.consecutiveFailures + 1
  : locked.consecutiveFailures,
```

— or delete the field from `FailurePolicyDecision` and its two return sites. Either is fine; the current state is the one that is not.

---

### WR-08: Raw PostgREST error messages are rendered into console pages

**File:** `src/app/(console)/audits/[id]/page.tsx:152`, `src/app/(console)/clients/[id]/page.tsx:277`, `src/app/(console)/audits/page.tsx:76`, `src/app/(console)/page.tsx:52`

**Issue:** Four pages render the database error verbatim:

```tsx
<p className="error" role="alert">
  Could not load this audit: {error.message}
</p>
```

PostgREST error messages can carry column names, constraint names, SQLSTATE detail, and — for errors raised inside `SECURITY DEFINER` functions — details about `is_operator()` and `has_tenant_access()`. This is the one place in the phase where raw error text reaches a rendered surface. Every other boundary is rigorous about it: `client.ts:34-43` classifies by status code and refuses `String(e)`; `outcomes.ts:49-52` refuses to echo an unrecognised stored value; `operator-email.ts` builds its body from a closed vocabulary; `audits/new/actions.ts:33-41` returns only the classified `Sm8FailureKind`. The same rule (T-2-02, T-2-16) applies here and is not followed.

The page-level rationale — "A genuine failure is not a 404" — is right, and is fully served by a fixed sentence.

**Fix:**

```tsx
if (error) {
  // The message can name columns, constraints and policy functions. The
  // operator cannot act on any of it; the server log is where it belongs.
  console.error(`[audits] prospect read failed: ${error.code ?? 'unknown'}`);
  return (
    <section>
      <h1>Quote Leakage Audit</h1>
      <p className="error" role="alert">
        Could not load this audit. Try again in a moment.
      </p>
      <p><Link href="/audits">Back to audits</Link></p>
    </section>
  );
}
```

Apply the same shape to all four sites.

---

### WR-09: `forAllTenants_webhookHint` uses `LIMIT 1` with no `ORDER BY`

**File:** `src/db/repository/for-all-tenants.ts:128-146`

**Issue:**

```ts
const [row] = await getDb()
  .select({ ... })
  .from(quotes)
  .innerJoin(sm8Connections, eq(sm8Connections.tenantId, quotes.tenantId))
  .innerJoin(tenants, eq(tenants.id, quotes.tenantId))
  .where(and(eq(quotes.sm8JobUuid, sm8JobUuid), isNull(sm8Connections.pausedAt)))
  .limit(1);
```

The uniqueness constraint on `quotes` is `(tenant_id, sm8_job_uuid)`, not `sm8_job_uuid` alone. Two tenants can legitimately hold the same job uuid — two design partners on the same ServiceM8 account, a shared franchise account, or a client onboarded twice under different tenant rows during testing. When that happens, `LIMIT 1` without `ORDER BY` gives Postgres licence to return either row, and which one it returns can change with the plan, the statistics, or a vacuum. The hint would then poll one tenant and never the other, non-deterministically.

**Fix:** Make the choice explicit, and prefer the tenant most likely to be behind:

```ts
.orderBy(sql`${sm8Connections.lastSuccessAt} ASC NULLS FIRST`, sm8Connections.tenantId)
.limit(1);
```

If multi-tenant uuid collision is considered impossible, say so in the comment and add a test that asserts it — the current code is silently correct only under an unstated assumption.

## Info

### IN-01: Unused column in a deliberately-narrow select

**File:** `src/db/repository/prospects.ts:264`

**Issue:** `getProspectStaging` selects `businessName` and never uses it — the function returns only `{ headers, rows }`. The whole documented justification for this function (lines 245-252) is that it is "A NARROW READ, on purpose ... Selecting two columns rather than filtering fifteen". A third unused column undercuts the argument the docblock makes.

**Fix:** Drop `businessName: prospects.businessName` from the select. `MappingPage` already gets the business name from its separate `getProspect(id)` call.

---

### IN-02: `parseMoneyToCents` does not detect integer-precision loss

**File:** `src/core/servicem8/normalize.ts:148-150`

**Issue:**

```ts
const value = Number.parseInt(`${whole || '0'}${cents}`, 10);
if (!Number.isFinite(value)) return null;
```

`Number.isFinite` is true for values well past `Number.MAX_SAFE_INTEGER`, so a money string with more than ~15 significant digits parses to a silently rounded number. The module's entire premise is "Nothing in this file performs floating-point arithmetic on money" — this is the one place a float can appear, through `parseInt` overflow rather than through a decimal operation.

Not reachable from realistic ServiceM8 data; it is a guard that costs one word.

**Fix:** `if (!Number.isSafeInteger(value)) return null;`

---

### IN-03: `backfill-baselines.mjs` overstates rows written

**File:** `scripts/backfill-baselines.mjs:149-159`

**Issue:** The UPDATE carries `AND baseline_computed_at IS NULL`, which can match zero rows if a concurrent run got there first, but `written += 1` runs unconditionally afterwards. The final "Baselines written: N" can therefore report more than were written. The script's own header makes idempotence and honest reporting a design goal ("a script that reports success against an empty table is exactly how a mis-pointed DATABASE_URL goes unnoticed").

**Fix:** Use `RETURNING id` and increment on `result.length > 0`.

---

### IN-04: `sql.raw` inside an interval literal

**File:** `src/db/repository/prospects.ts:196`

**Issue:** `purgeAfter: sql\`now() + interval '${sql.raw(String(PROSPECT_LINE_RETENTION_DAYS))} days'\`` is safe today — `PROSPECT_LINE_RETENTION_DAYS` is a module constant — but `sql.raw` inside a quoted SQL literal is one refactor away from injection if the value ever becomes a parameter (a per-client retention setting, say).

**Fix:** Bind it: `sql\`now() + (${PROSPECT_LINE_RETENTION_DAYS}::text || ' days')::interval\``

---

### IN-05: CSV and API paths disagree on how zero-date rows are counted

**File:** `src/core/audit/csv-intake.ts:132-136` vs `src/core/audit/aggregate.ts:144-146`

**Issue:** The CSV path pushes rows with `quoteDateUtc === null` into `reasons` ("never issued as a quote (no quote date)"), which inflates `skippedCount` and can force a proceed-with-warning dialog. The API path keeps such rows and simply excludes them from the figures via `wasQuoted`. The comment in `csv-mapping.ts:333-336` says zero-dates are "handled downstream exactly as the API path handles them" — they are not.

The arithmetic is the same either way; what differs is the number of "skipped rows" the operator is shown for the same underlying data.

**Fix:** Either exclude zero-date rows from `reasons` (letting `wasQuoted` do the work, matching the API path) or note the deliberate difference where the claim of parity currently sits.

---

### IN-06: `SELECT` granted to `anon` on the two prospect tables

**File:** `src/db/migrations/0014_prospect_grants_and_purge.sql:44, 57`

**Issue:** `GRANT SELECT ON public.prospects TO anon` and the same for `prospect_quote_lines`. The effective result is zero rows — RLS is enabled and the only policy is `TO authenticated USING (is_operator())`, so `anon` matches nothing. The grant exists for the migration's stated reason (denial and absence must be indistinguishable), and it is consistent with 0007/0011.

Still worth noting: this is the highest-sensitivity table in the schema, and its safety now rests entirely on nobody ever adding a permissive policy scoped to `public` rather than `authenticated`. The anon-facing 404-versus-403 distinction those grants buy is not needed for a table no anonymous request should reach at all.

**Fix:** Consider `REVOKE SELECT ... FROM anon` for these two tables specifically, and record the exception to the 0007/0011 convention in the migration comment. If the grants stay, add an assertion to `tests/rls-coverage.test.ts` that `anon` reads return zero rows rather than an error, so the property is proven rather than reasoned about.

---

_Reviewed: 2026-08-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
