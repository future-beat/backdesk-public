/**
 * `event_consumer_cursors` — where one consumer has read up to in the outbox.
 *
 * ── WHY THIS IS ITS OWN FILE AND NOT A `forAllTenants_*` EXPORT ─────────────
 *
 * This table carries NO `tenant_id`. It is not tenant data read across tenants
 * (which is what `for-all-tenants.ts` exists to make greppable) — it is the
 * cadence engine's own bookkeeping, gated by `is_operator()` rather than
 * `has_tenant_access(...)`, exactly like the prospect family in `prospects.ts`.
 * Putting it in the cross-tenant file would inflate the list a reviewer greps
 * to audit tenant-scope escapes with a row that has no tenant to escape.
 *
 * ── REGISTRATION IS `INSERT … ON CONFLICT DO NOTHING`, STARTING AT 0 ────────
 *
 * The outbox contract is explicit that no row is seeded
 * (`src/db/schema/quote-events.ts`): "a consumer that does not exist yet must
 * not silently appear to be up to date". So the consumer registers itself, and
 * registration is idempotent — two ticks starting at once must produce one
 * cursor row at 0, not an error and not a rewind.
 *
 * ── THE ADVANCE IS DELIBERATELY NOT HERE ────────────────────────────────────
 *
 * Advancing the cursor must commit in the SAME transaction as the actions taken
 * on the events it covers ("Advancing separately is how a consumer skips work
 * after a crash"). Those actions are tenant-scoped, so the advance lives on the
 * tenant-scoped repository as `forTenant(id).consumerCursor.advanceTo(...)`,
 * which is the only handle that can be inside that transaction. Two homes for
 * one table, on purpose: this one reads before any tenant is known, that one
 * writes inside a tenant's transaction. Neither can do the other's job.
 */
import { count, eq, gt, min } from 'drizzle-orm';

import { eventConsumerCursors, quoteStatusEvents } from '@/db/schema';

import { getDb } from './client';

/**
 * Register this consumer if it has never run, and return where it has read up
 * to. A brand-new consumer gets 0 — i.e. the whole history is ahead of it.
 *
 * The INSERT and the SELECT are two statements rather than an upsert with
 * RETURNING, for the reason `settings.ensure()` gives: an upsert that DID
 * something would have to choose what to overwrite, and the answer is nothing —
 * this row is the position of a consumer that may be mid-batch right now.
 */
export async function registerConsumerCursor(consumer: string): Promise<number> {
  const db = getDb();

  await db
    .insert(eventConsumerCursors)
    .values({ consumer, lastEventId: 0 })
    .onConflictDoNothing({ target: eventConsumerCursors.consumer });

  const [row] = await db
    .select({ lastEventId: eventConsumerCursors.lastEventId })
    .from(eventConsumerCursors)
    .where(eq(eventConsumerCursors.consumer, consumer));

  if (!row) {
    // Unreachable unless the row was deleted between the two statements. Loud
    // rather than a silent 0, which would replay the entire event history.
    throw new Error(
      `registerConsumerCursor('${consumer}') found no row after insert. ` +
        'Returning 0 here would replay every event ever written.',
    );
  }

  return row.lastEventId;
}

/**
 * Read a consumer's cursor without registering it. `null` means "this consumer
 * has never run", which is a different fact from "it is at 0" — the outbox
 * contract turns on that distinction, and tests assert it.
 */
export async function readConsumerCursor(consumer: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ lastEventId: eventConsumerCursors.lastEventId })
    .from(eventConsumerCursors)
    .where(eq(eventConsumerCursors.consumer, consumer));

  return row?.lastEventId ?? null;
}

/** How far behind a consumer's cursor the outbox has run. */
export interface ConsumerBacklog {
  /** Events written past the cursor, of every type. */
  pendingCount: number;
  /** When the OLDEST of them was detected. `null` when there is no backlog. */
  oldestPendingAt: Date | null;
}

/**
 * The backlog sitting past a consumer's cursor — the durable, self-derived
 * evidence that a consumer is wedged (07 CR-03).
 *
 * ── WHY AGE AND NOT A COUNTER FROM THE TICK ────────────────────────────────
 *
 * `attributionTenantsBlocked` and `attributionsPoisoned` are per-PASS numbers
 * that live for the length of one HTTP response. Reading them from a digest
 * that runs once a morning would mean persisting a counter, and a counter is a
 * derived fact that can drift from the thing it describes. THIS read is the
 * thing itself: if the oldest unconsumed event has been sitting there for
 * hours while a per-minute tick claims to be running, the consumer is stuck —
 * and it is stuck regardless of WHICH failure stuck it, including ones nobody
 * has thought of yet.
 *
 * ── IT RETURNS A COUNT AND A TIMESTAMP, AND NOTHING ELSE ───────────────────
 *
 * No tenant id, no quote id, no status. The caller is an email builder, and the
 * question it asks is "is the consumer moving", which is answerable without
 * naming a single client. `MIN(detected_at)` is our own committed clock (the
 * same value D-01 anchors on), never ServiceM8's `occurred_at`.
 *
 * NO REGISTRATION SIDE EFFECT, unlike `registerConsumerCursor`: a digest asking
 * a diagnostic question must not create the row whose absence is the answer.
 * A consumer that has never run has no backlog to report — it has no position.
 */
export async function readConsumerBacklog(consumer: string): Promise<ConsumerBacklog | null> {
  const cursor = await readConsumerCursor(consumer);
  if (cursor === null) return null;

  const [row] = await getDb()
    .select({
      pendingCount: count(),
      oldestPendingAt: min(quoteStatusEvents.detectedAt),
    })
    .from(quoteStatusEvents)
    .where(gt(quoteStatusEvents.id, cursor));

  return {
    pendingCount: Number(row?.pendingCount ?? 0),
    oldestPendingAt: row?.oldestPendingAt ?? null,
  };
}
