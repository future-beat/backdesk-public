-- Migration 0023 — the G-3-2 replay key becomes STRUCTURAL (CR-01).
--
-- WHY THIS EXISTS:
-- `src/db/schema/cadences.ts` opens with the doctrine this whole table is built
-- on: "The uniqueness constraint IS the concurrency guarantee … A
-- check-then-insert in the consumer is a TOCTOU by construction." Migration 0021
-- extended that doctrine to the REPLAY guarantee by adding
-- `created_by_event_id` and a unique index over it — and then left the column
-- nullable with nothing but a TypeScript type standing between a writer and a
-- NULL.
--
-- That is the one enforcement mechanism this file's own header rejects, and
-- NULLS DISTINCT makes the hole silent rather than loud: a unique index permits
-- UNLIMITED rows with a NULL key, so a NULL-key INSERT conflicts with nothing,
-- `cadences.create` returns a row, `createCadenceForQuoteOpened` reports
-- 'created', and a duplicate ACTIVE cadence re-chases the customer from touch 1.
-- No 23505, no log line, no counter — the failure mode is total silence, which
-- is precisely what the replay guarantee was added to prevent.
--
-- It was not hypothetical: `tests/helpers/seed.ts` already wrote NULL keys, so
-- every seeded cadence in the dispatch/controls/tick suites sat outside the
-- guarantee. Any future writer — Phase 4 reply handling, an ops backfill, a psql
-- session — inherited the same hole BY DEFAULT rather than by decision.
--
-- ── WHY A CARVE-OUT AND NOT A PLAIN `SET NOT NULL` ──────────────────────────
--
-- `cadences.createdByEventId` is documented as nullable so rows written BEFORE
-- 0021 stay legal — that column could not have been populated for them and this
-- migration must not invent an event id it does not have. The CHECK therefore
-- reads "the key is required, unless you predate the column", pinned to the
-- moment 0021 was actually applied to this database:
-- drizzle.__drizzle_migrations records created_at = 1787907224384, i.e.
-- 2026-08-28T08:53:44.384Z.
--
-- The carve-out is VACUOUS on the production database today (`cadences` held
-- zero rows when this was written, verified before the constraint was added), so
-- in practice this is `created_by_event_id IS NOT NULL`. It is kept anyway
-- because it is what makes the constraint replayable against a development
-- database that does hold pre-0021 rows, and because silently redefining the
-- column's documented nullability is how the next reader gets surprised.
--
-- NOT VALID skips the scan of existing rows; INSERTs and UPDATEs are checked
-- from this statement on, which is the whole requirement. Promoting it with
-- VALIDATE CONSTRAINT later takes only a SHARE UPDATE EXCLUSIVE lock and can be
-- done at leisure once the legacy carve-out is known to match nothing.
--
-- ── THE INDEX NARROWING ─────────────────────────────────────────────────────
--
-- `cadences_one_per_opened_event` is re-created WHERE created_by_event_id IS NOT
-- NULL. This changes NO behaviour — NULLS DISTINCT already excluded NULL keys
-- from the index in every practical sense — but it moves the exclusion from an
-- implicit Postgres default into the index definition, where a reader looking
-- for "which rows does the replay guarantee actually cover?" can see it. An
-- invariant that depends on a default nobody names is an invariant that survives
-- exactly until someone changes the default.
--
-- IDEMPOTENT BY CONSTRUCTION, in the idiom migrations 0004/0008/0011/0017/0018
-- use: Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the constraint is
-- dropped-if-present and re-added; the index is dropped-if-present and re-created
-- because `CREATE UNIQUE INDEX IF NOT EXISTS` would silently KEEP the old
-- unnarrowed definition, which is the failure this file exists to avoid.
--
-- APPLIED BEFORE THE WRITERS THAT DEPEND ON IT (the 0018 ordering principle):
-- the database's rule is never narrower than the code that races it. A writer
-- reaching an old, unconstrained database simply gets the pre-0023 behaviour; a
-- writer reaching this constraint with no key gets a loud 23514 instead of a
-- silent duplicate chase.
ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_replay_key_present;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_replay_key_present
  CHECK (
    created_by_event_id IS NOT NULL
    OR created_at < '2026-08-28T08:53:44.384+00:00'::timestamptz
  )
  NOT VALID;
--> statement-breakpoint
DROP INDEX IF EXISTS public.cadences_one_per_opened_event;
--> statement-breakpoint
CREATE UNIQUE INDEX cadences_one_per_opened_event
  ON public.cadences USING btree (created_by_event_id)
  WHERE created_by_event_id IS NOT NULL;
