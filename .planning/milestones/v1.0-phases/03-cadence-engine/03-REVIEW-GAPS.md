---
phase: 03-cadence-engine
reviewed: 2026-08-28T09:22:57Z
depth: standard
scope: gap-closure delta only (git diff 40e8df9..HEAD — commits 76bc5df, 5209b28, 1fc0c66, f9bc539)
files_reviewed: 9
files_reviewed_list:
  - src/core/cadence/consume-events.ts
  - src/core/cadence/dispatch.ts
  - src/db/repository/for-tenant.ts
  - src/db/schema/cadences.ts
  - src/db/migrations/0021_cadence_created_by_event.sql
  - src/db/migrations/0022_mirror_missing_stop_reason.sql
  - tests/cadence-consume-events.test.ts
  - tests/cadence-dispatch.test.ts
  - tests/cadence-repository.test.ts
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
---

# Phase 03 (gap closure): Code Review Report

**Reviewed:** 2026-08-28T09:22:57Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Two gap fixes were reviewed against the full files for context, plus the two
already-applied migrations and their test coverage.

**The specific regression risk raised in the brief does not reproduce.**
`onConflictDoNothing()` with no argument emits a targetless `ON CONFLICT DO
NOTHING`, which Postgres applies to *every* unique and exclusion constraint on
the target relation. A conflict on `cadences_one_per_opened_event` therefore
returns zero rows rather than raising 23505, so it cannot reach
`consumeQuoteEvents`'s outer `catch`, cannot set `blocked = true`, and cannot
wedge the shared cursor. The three concurrency interleavings that matter —
overlapping ticks on the same event, a held cursor re-reading a `quote_opened`
whose cadence has since stopped, and a re-triage emitting a fresh `quote_opened`
— all resolve correctly, and `tests/cadence-repository.test.ts` now witnesses
both arbiters separately. `npm run typecheck` and `npm run lint` are clean.

G-3-5 is a one-word change plus a widened CHECK applied migration-first, in the
0018 ordering the file itself cites. That is correct.

What the delta does **not** do is make the new invariant structural. The entire
G-3-2 guarantee now rests on `created_by_event_id` being non-NULL, and the
column is nullable with `NULLS DISTINCT` semantics and no CHECK — enforced only
by a TypeScript type, in the one table whose own header argues at length that
code-level enforcement of exactly this class of invariant is a TOCTOU by
construction. A NULL-writing path already exists in-repo (`tests/helpers/seed.ts`
`seedCadence`). That is CR-01.

Secondary themes: `mirror_missing` ships with zero observability despite its
documented meaning including "a bug in our own sync"; the live-cadence
uniqueness index is keyed on the surrogate `quotes.id` rather than
`sm8_job_uuid`, which the newly-blessed "quote row absent from the mirror" state
makes newly load-bearing; and one of the two new G-3-2 tests contains a
tautological assertion whose comment claims a guarantee the assertion cannot
test.

---

## Critical Issues

### CR-01: The G-3-2 replay guarantee is not enforced by the database — a NULL `created_by_event_id` silently disables it

**File:** `src/db/schema/cadences.ts:211,260`, `src/db/migrations/0021_cadence_created_by_event.sql:1-2`, `src/db/repository/for-tenant.ts:160-170`

**Issue:** `cadences.ts:4-21` states the doctrine this table is built on: *"The
uniqueness constraint IS the concurrency guarantee … A check-then-insert in the
consumer is a TOCTOU by construction."* Lines 29-66 then extend that doctrine to
the replay guarantee. But the column that carries the replay guarantee is
declared nullable:

```ts
createdByEventId: bigint('created_by_event_id', { mode: 'number' }),   // line 211
uniqueIndex('cadences_one_per_opened_event').on(table.createdByEventId), // line 260
```

and the migration adds no CHECK:

```sql
ALTER TABLE "cadences" ADD COLUMN "created_by_event_id" bigint;
CREATE UNIQUE INDEX "cadences_one_per_opened_event" ON "cadences" USING btree ("created_by_event_id");
```

Postgres's default `NULLS DISTINCT` means the index permits **unlimited** rows
with a NULL key. The only thing that stops a cadence being created with a NULL
key is the TypeScript type at `for-tenant.ts:170` (`createdByEventId: number`) —
i.e. exactly the code-level check the file's own header rejects.

The failure mode is silent, and it compounds with the (otherwise correct)
targetless conflict clause: a writer that omits the key produces a row that
conflicts with nothing, `create()` returns a row, `createCadenceForQuoteOpened`
returns `'created'`, and a duplicate ACTIVE cadence re-chases the customer from
touch 1 with **no error anywhere**. There is no runtime signal at all — no
23505, no log line, no counter.

This is not hypothetical. A NULL-writing insert path is already in the repo:
`tests/helpers/seed.ts:307-327` (`seedCadence`) inserts via the service-role
Supabase client with no `created_by_event_id`, so every cadence used by
`cadence-dispatch.test.ts`, `cadence-controls.test.ts` and `cadence-tick.test.ts`
sits outside the guarantee. Any future writer — Phase 4 reply handling, an ops
backfill script, a psql session — inherits the same hole by default rather than
by decision.

**Fix:** make the invariant structural, keeping legacy rows legal. A follow-up
migration:

```sql
-- 0023: the replay key is required for every cadence created after 0021.
-- Legacy rows (created_by_event_id IS NULL) predate the column and stay legal;
-- new rows must carry the key or the INSERT fails loudly instead of silently
-- opting out of `cadences_one_per_opened_event`.
ALTER TABLE public.cadences
  DROP CONSTRAINT IF EXISTS cadences_replay_key_present;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_replay_key_present
  CHECK (created_by_event_id IS NOT NULL OR created_at < '2026-08-27T00:00:00Z')
  NOT VALID;
```

(`NOT VALID` skips the scan of existing rows; new and updated rows are checked.
Substitute the real 0021 application timestamp.) Then narrow the unique index to
`WHERE created_by_event_id IS NOT NULL` so its purpose is explicit rather than
implied by `NULLS DISTINCT`, and add a repository test that a create without the
key raises rather than succeeding.

---

## Warnings

### WR-01: `mirror_missing` is terminal, irreversible, and completely silent — including when it means "our sync is broken"

**File:** `src/core/cadence/dispatch.ts:298-308`

**Issue:** The new branch permanently stops a paying client's quote chase and
emits no signal of any kind:

- no `console.error` — contrast the sibling "unreachable by construction" branch
  at `dispatch.ts:328-333` (`no_address`), which *does* log;
- the refusal reported to the caller is `'quote_closed'` (line 308, deliberate
  per the comment), so `DispatchResult.refusals` cannot distinguish a
  mirror-missing kill from a legitimate closure — the tick response body is the
  operator's only near-real-time view;
- `stopWhereLive` writes `status = 'stopped'`, and the only resume path
  (`resumeWherePaused`) matches `status = 'paused'`, so this is unrecoverable
  even after the mirror row comes back.

The delta's own documentation (`0022_mirror_missing_stop_reason.sql:12-17`,
`dispatch.ts:289-292`, `cadences.ts:161-171`) names "a bug in our own sync" as
one of three causes. Shipping a branch that means "we may be broken" with zero
observability and an irreversible outcome is the combination that turns a small
sync defect into silently unchased quotes across a whole client.

**Fix:** at minimum log, in the style the `no_address` branch already uses (ids
only, no customer data):

```ts
const stopReason: CadenceStopReason = quote ? stopReasonForQuote(quote) : 'mirror_missing';
if (!quote) {
  console.error(
    `[cadence] cadence ${touch.cadenceId} references sm8 job ${touch.sm8JobUuid}, ` +
      'which has no row in our quotes mirror. The cadence is stopped as ' +
      'mirror_missing — this is a purge, a deletion we never observed, or a bug ' +
      'in our own sync, and it needs a human.',
  );
}
```

Better: add `'mirror_missing'` to `DISPATCH_REFUSALS` so the counter is honest
(the comment's argument that the refusal vocabulary describes *this tick's*
decision holds equally for a `mirror_missing` member), and route it to the
existing `onAlert` operator-alert path that `run-sync.ts` uses.

### WR-02: `cadences_one_live_per_quote` is keyed on the surrogate `quotes.id`, and "the quote row is gone" is now a blessed state

**File:** `src/db/schema/cadences.ts:249-251`, `src/core/cadence/dispatch.ts:302`

**Issue:** The live-uniqueness index is `UNIQUE (quote_id) WHERE status IN
('active','paused')`. `quote_id` is our own surrogate uuid, not the stable
ServiceM8 identity (`sm8_job_uuid`, which the same table denormalizes at line
195 and which `stateFor` keys on).

G-3-5 formally recognises that a `quotes` row can be absent while its cadence
survives ("a cadence outliving its quote row is a reachable state rather than a
corruption" — `0022_...sql:16-17`). If that row is later re-synced, `run-sync.ts`
inserts a **new** `quotes` row with a **new** uuid, `prev === undefined`, so the
`type === 'quote_opened' && prev !== undefined` guard at `run-sync.ts:503` does
not fire and a fresh `quote_opened` is emitted. The old cadence is only stopped
if dispatch happened to run against a due touch in the interval; otherwise it is
still ACTIVE. The new event's insert conflicts with neither index — different
`quote_id`, different `created_by_event_id` — so a **second live cadence for the
same ServiceM8 job** is created and two parallel chase sequences reach the same
customer. That is the exact outcome `cadences_one_live_per_quote` exists to
prevent, routed around by the surrogate key.

Reachability today is via an ops-side purge (named in the migration text) rather
than a code path, which is why this is a WARNING and not a blocker — but the
delta is what promoted "mirror row absent" from corruption to expected state.

**Fix:** key the live index on the upstream identity, which is stable across a
mirror rebuild:

```ts
uniqueIndex('cadences_one_live_per_job')
  .on(table.tenantId, table.sm8JobUuid)
  .where(sql`status IN ('active', 'paused')`),
```

Keep or drop the `quote_id` form as preferred; the `sm8_job_uuid` form is the
one that survives the state G-3-5 blessed. Add a test that re-syncing a purged
quote row does not produce a second live cadence for the same job.

### WR-03: The G-3-2 dedupe key is not recorded when the *live* index wins the conflict, so the documented invariant is weaker than stated

**File:** `src/core/cadence/consume-events.ts:414-434`, `src/db/schema/cadences.ts:60-66`

**Issue:** `createCadenceForQuoteOpened` returns `'replayed'` for *both* conflict
cases and the event is consumed either way. When the conflict was on
`cadences_one_live_per_quote` (a live cadence already exists for this quote from
a *different* event), that event's id is never written anywhere. If the shared
cursor is later held behind it and the first cadence has since stopped, neither
index covers the row and a duplicate cadence is created — the precise G-3-2
defect, in the one branch the fix does not close.

The assertion message in the new test (`cadence-consume-events.test.ts:531`,
*"one consumed quote_opened may only ever produce one cadence"*) and the schema
header at `cadences.ts:60-66` both state this as unconditional. It is
conditional on which arbiter refused.

I could not construct a production path that emits a second `quote_opened` while
a cadence is live: `markChaseEligible` requires `chase_eligibility =
'needs_review'`, whose only writer is `flagNeedsReviewOnReopen`, which runs in
the same transaction as `stopWhereLiveByQuoteIds`
(`consume-events.ts:533-558`); and `run-sync.ts:503` suppresses `quote_opened`
for pre-existing quotes. So this is latent rather than live — but it is one new
eligibility writer away from being real, and nothing in the code or tests marks
the dependency.

**Fix:** either close it or narrow the claim. To close it, distinguish the two
zero-row cases and record the key on the live-conflict path:

```ts
if (!cadence) {
  // Which arbiter refused? If a LIVE cadence for this quote exists but was
  // created by a DIFFERENT event, stamp this event onto it so a later replay
  // of THIS event conflicts too.
  await tx.cadences.claimOpenedEvent(event.quoteId, event.id); // no-op if already set
  return 'replayed';
}
```

To narrow the claim, add an explicit comment at `consume-events.ts:431-434` and
change the test message to *"one consumed quote_opened may only ever produce one
cadence, once its id has been recorded"*, plus a regression test that pins the
gap so a future eligibility writer trips it.

### WR-04: New G-3-2 test contains a tautological assertion whose comment claims an untested guarantee

**File:** `tests/cadence-consume-events.test.ts:590-591`

**Issue:**

```ts
// And no touches anywhere else either: a duplicate cadence would carry its own.
expect(await repo.touches.listForCadence(all[0].id)).toHaveLength(touchesBefore.length);
```

`all` was asserted `toHaveLength(1)` at line 581 and `all[0].id` asserted equal
to `cadence.id` at line 582; `touchesAfter` (line 587) is already
`listForCadence(cadence.id)` and was already compared id-by-id at line 588. This
line therefore re-reads the same cadence and re-asserts the same fact. It cannot
fail independently of the assertions above it and tests nothing about "anywhere
else". This is the worst-case test in the pair (a duplicate ACTIVE cadence
re-chasing a won job), so a decorative assertion here is false confidence at the
exact point it matters most.

**Fix:** assert over the tenant, not over the one cadence you already pinned:

```ts
// No touches anywhere else either: a duplicate cadence would carry its own.
const { data: allTouches } = await admin
  .from('cadence_touches')
  .select('id, cadence_id')
  .eq('tenant_id', tenantId)
  .in('cadence_id', [cadence.id]);   // or: select all, then assert every row's cadence_id
expect(allTouches?.every((t) => t.cadence_id === cadence.id)).toBe(true);
expect(allTouches).toHaveLength(touchesBefore.length);
```

### WR-05: Migration 0021 is not idempotent, breaking the convention 0022 documents one file later

**File:** `src/db/migrations/0021_cadence_created_by_event.sql:1-2`

**Issue:** `0022_mirror_missing_stop_reason.sql:26-28` states the house rule
verbatim: *"IDEMPOTENT BY CONSTRUCTION, in the idiom migrations
0004/0008/0011/0017/0018 use."* 0021 — machine-generated and shipped in the same
gap-closure batch — is not:

```sql
ALTER TABLE "cadences" ADD COLUMN "created_by_event_id" bigint;
CREATE UNIQUE INDEX "cadences_one_per_opened_event" ON "cadences" USING btree ("created_by_event_id");
```

Re-running either statement raises (`42701 column already exists` /
`42P07 relation already exists`). The brief states both migrations are already
applied to the hosted DB; if 0021 was applied out-of-band rather than through
`npm run db:migrate`, `drizzle.__drizzle_migrations` has no row for it and the
next `db:migrate` run aborts on it — and because drizzle's migrator applies the
journal in order, that failure blocks **every** subsequent migration, including
0022 and anything Phase 4 adds. 0022 survives this scenario precisely because it
follows the convention; 0021 does not.

Secondary: `CREATE UNIQUE INDEX` (not `CONCURRENTLY`) takes `ACCESS EXCLUSIVE`
on `cadences` for the duration of the build, against a table the per-minute cron
writes to. Harmless at MVP row counts, worth knowing before the table grows.

**Fix:** hand-edit 0021 to the house idiom before it is replayed anywhere:

```sql
ALTER TABLE "cadences" ADD COLUMN IF NOT EXISTS "created_by_event_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cadences_one_per_opened_event" ON "cadences" USING btree ("created_by_event_id");
```

Then verify both rows exist in `drizzle.__drizzle_migrations`; drizzle keys on
the file hash, so editing the file after it was recorded will itself need a
reconciliation step.

### WR-06: Targetless `ON CONFLICT DO NOTHING` silently absorbs *every* present and future constraint on `cadences`

**File:** `src/db/repository/for-tenant.ts:1103-1121`

**Issue:** The change is correct for the stated problem, but it is broader than
the comment claims. `ON CONFLICT DO NOTHING` without an arbiter matches every
unique index, unique constraint, exclusion constraint **and the primary key** on
`cadences`. The comment ends *"Either way, you are the replay"* — a statement
that is true of exactly the two indexes that exist today and that silently
becomes false for the third. A unique index added by Phase 4 or 7 (say
`(tenant_id, quote_id, touch_generation)`) would be absorbed here: zero rows,
`createCadenceForQuoteOpened` returns `'replayed'`, the event is consumed, and no
cadence exists — a quote that is never chased, with no error and no counter.

The primary key is guarded only by `CadenceCreate` omitting `id`; the same
TypeScript-only enforcement as CR-01.

**Fix:** keep the targetless form (it is the right call) and add the tripwire the
comment implies. Either an explicit note that any new unique index on this table
must be paired with a decision about this statement, or — better — a repository
test asserting the index set:

```ts
// The targetless ON CONFLICT absorbs every constraint on this table, so the
// constraint set is part of `create`'s contract. Adding one without revisiting
// `createCadenceForQuoteOpened`'s 'replayed' branch turns a real failure into a
// silently unchased quote.
const idx = await admin.rpc('...') // or a raw pg_indexes select
expect(new Set(idx.map((r) => r.indexname))).toEqual(
  new Set(['cadences_pkey', 'cadences_one_live_per_quote', 'cadences_one_per_opened_event', 'cadences_tenant_status_idx']),
);
```

---

## Info

### IN-01: Existing `removed` rows written by the old dispatch path are not backfilled

**File:** `src/db/migrations/0022_mirror_missing_stop_reason.sql:19-24`

**Issue:** The migration widens the vocabulary but leaves rows that the WR-07
code already wrote as `removed` from a missing mirror conflated with
evidence-backed `removed` — the exact conflation the migration says Phase 7
"cannot reconstruct later". It *is* reconstructible right now (a mirror-missing
`removed` is one whose `quote_id` has no `quotes` row; an outbox/`sm8_active`
`removed` always has one), and it stops being reconstructible as the mirror
churns. I found no code path that deletes `quotes` rows outside a tenant cascade
(and `forAllTenants_cadenceTick` inner-joins `sm8_connections`, so dispatch never
runs for a deleted tenant), so the affected row count is probably zero — hence
Info rather than Warning.

**Fix:** run the check, and backfill if it returns rows:

```sql
UPDATE public.cadences c
   SET stop_reason = 'mirror_missing', updated_at = now()
 WHERE c.stop_reason = 'removed'
   AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = c.quote_id);
```

### IN-02: `cadencesCreated` under-reports, and the new test enshrines it

**File:** `src/core/cadence/consume-events.ts:595-599`, `tests/cadence-consume-events.test.ts:511-513`

**Issue:** A `no_contact` / `contact_suppressed` cadence *is* inserted, but
`applyEvent` reports `created: 0, stopped: 1`, so `ConsumeQuoteEventsResult`
never counts it. The new test now asserts `expect(first.cadencesCreated).toBe(0)`
alongside `cadencesStopped: 1`, pinning the behaviour. Pre-existing, but it means
`cadencesCreated` cannot be used as "rows written to `cadences`" by any later
consumer of the tick response.

**Fix:** either rename the field to `cadencesStarted` (which is what it means) or
count creation and stopping independently:
`{ created: 1, stopped: result === 'stopped' ? 1 : 0 }`.

### IN-03: `openedEventIdFor` takes the first match and would silently pick the wrong event for a quote with two `quote_opened`s

**File:** `tests/cadence-consume-events.test.ts:123-130`

**Issue:** `.find(...)` returns the first `quote_opened` for the quote in the
scanned range. Quote index 3 has two by design (the re-triage test at line 411),
so the helper is only correct because it is called with indices 6 and 7. Nothing
enforces that, and a future test reusing it on a re-triaged quote gets the wrong
id and rewinds to the wrong place — producing a test that passes for the wrong
reason.

**Fix:** assert the assumption:

```ts
const rows = emitted.filter((e) => e.eventType === 'quote_opened' && e.quoteId === quotes[quoteIndex].id);
if (rows.length !== 1) {
  throw new Error(`Expected exactly one quote_opened for quote index ${quoteIndex}, found ${rows.length}.`);
}
return rows[0].id;
```

### IN-04: `mirror_missing` renders raw in the client quote list, and `_journal.json` lost its trailing newline

**File:** `src/app/(console)/clients/[id]/page.tsx:112`, `src/db/migrations/meta/_journal.json`

**Issue:** Two nits. (a) `cadenceGlance` returns `cadence.stop_reason` verbatim
into a column whose own header (lines 100-105) says it is "deliberately SHORTER"
than the detail page's label. `mirror_missing` is the longest member of the
vocabulary and the delta added a friendly label only to the detail page
(`quotes/[quoteId]/page.tsx:126`). Pre-existing pattern for every other reason,
so consistent — but the new value is the one that reads worst raw. (b) The
journal file now ends without a newline (`\ No newline at end of file` in the
diff), which will produce a spurious one-line diff on the next `drizzle-kit
generate`.

**Fix:** (a) add a short-form map beside `cadenceGlance`, e.g.
`mirror_missing → 'quote missing'`. (b) restore the trailing newline.

---

_Reviewed: 2026-08-28T09:22:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
