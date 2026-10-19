/**
 * One sync cycle, and the tick that runs one per connection (SYNC-01/02/03/04).
 *
 * This is the file the phase's guarantees actually live in. The pure modules
 * next to it decide WHAT should happen — which filter value, which event,
 * whether to pause — and this one arranges for those decisions to be applied
 * atomically, in isolation, exactly once.
 *
 * ── ORDER OF OPERATIONS, AND WHY ────────────────────────────────────────────
 *
 *   1. DECRYPT the client's key, in memory, once.
 *   2. FETCH jobs and contacts. **Outside any transaction**, following the
 *      precedent set by `connect.ts` in the previous wave: an open Postgres
 *      transaction held across several seconds of third-party HTTP occupies a
 *      pooled connection and can outlive the pool's own timeouts. At fifteen
 *      clients on a five-minute tick that is a live outage waiting for a slow
 *      day at ServiceM8. Nothing is written yet, so a failed or malformed fetch
 *      leaves no residue at all.
 *   3. PARSE through zod. A single bad row aborts the cycle as `parse_error`
 *      before the transaction opens, so the "no partial writes" guarantee is
 *      structural rather than dependent on a rollback firing.
 *   4. WRITE, in ONE transaction that opens by taking `SELECT ... FOR UPDATE`
 *      on the connection row.
 *
 * ── WHY THE LOCK IS TAKEN AT WRITE TIME AND NOT AT FETCH TIME ───────────────
 *
 * The plan specified the fetch inside the locked transaction. It is here
 * instead, for the pooling reason above, and the guarantee it was protecting is
 * fully preserved — because the guarantee is about EMISSION, not about fetching.
 *
 * Two overlapping runs (the five-minute poll and a webhook hint arriving
 * mid-poll) may now both fetch. They cannot both emit. The stored state a run
 * diffs against is read INSIDE its own locked transaction, so whichever run
 * commits second sees the first one's upserted statuses and classifies no
 * change. The lock also makes the cursor advance safe: `prev` is re-read from
 * the locked row rather than from the snapshot the cycle started with, so a
 * concurrent run that got further cannot be rewound.
 *
 * ── WHAT THIS FILE MUST NEVER DO ────────────────────────────────────────────
 *
 * Emit events for the backfill. `connect.ts` writes ninety days of quote rows
 * and calls nothing here; event emission exists ONLY in this file's diff path,
 * which is the structural enforcement of the plan's prohibition. Replaying three
 * months of status transitions into the cadence engine on connect day would
 * fire follow-ups for jobs that closed in June and would credit Phase 7 with
 * wins the service never touched.
 *
 * Put anything but a classified kind into `sync_runs.error_detail` (T-2-02). The
 * ServiceM8 boundary returns typed results precisely so that no `catch (e)` here
 * can put a request URL — and with it an `X-API-Key` header — into a table the
 * console renders.
 */
import { sendOperatorAlert } from '@/core/alerts/operator-email';
import { resolveLeadsBookedByTradie } from '@/core/leads/booked-by-tradie';
import { LEAD_JOB_MATCH_PASS_MARGIN_MS } from '@/core/leads/constants';
import { createSm8Client } from '@/core/servicem8/client';
import { normalizeJob, SM8_TIMESTAMP_ZONE } from '@/core/servicem8/normalize';
import { fetchAllPages } from '@/core/servicem8/pagination';
import { sm8Job, sm8JobContact, type Sm8Status } from '@/core/servicem8/schemas';
import type { Sm8Client, Sm8FailureKind, NormalizedQuote } from '@/core/servicem8/types';
import { decodeEncryptionKey, decryptCredential } from '@/core/shared/crypto';
import { getServerEnv } from '@/core/shared/env';
import { advanceCursor, filterFrom } from '@/core/sync/cursor';
import { applyFailurePolicy } from '@/core/sync/failure-policy';
import { classifyTransition } from '@/core/sync/transitions';
import {
  forAllTenants_syncTick,
  forTenant,
  type DueConnection,
  type QuoteContactUpsert,
  type QuoteStatusEventInsert,
  type QuoteUpsert,
} from '@/db/repository';
import { FIRST_SIGHT, type QuoteEventType, type SyncOutcome } from '@/db/schema';

/** Transient failures retried inside the cycle before the tick becomes the retry. */
const IN_CYCLE_RETRY_DELAYS_MS = [1_000, 4_000] as const;

/** Retrying these changes nothing: a revoked key stays revoked, drift stays drift. */
const NON_RETRYABLE: ReadonlySet<Sm8FailureKind> = new Set(['auth_failed', 'parse_error']);

/**
 * How long `runSyncTick` may spend STARTING cycles (WR-03).
 *
 * ── WHY THE HEADROOM IS 80 SECONDS AND NOT 60 ───────────────────────────────
 *
 * The deadline is checked BEFORE a cycle begins, never during it, because a
 * cycle that has started owns a transaction and a decrypted credential —
 * abandoning it partway is how a half-written mirror happens. That means the
 * last connection admitted can start at the deadline and still run its full
 * worst case: `REQUEST_TIMEOUT_MS` (20s) x 3 attempts x 2 resources, plus
 * jittered sleeps, is roughly 65 seconds.
 *
 * So the headroom inside the route's `maxDuration = 300` has to EXCEED one
 * worst-case cycle. An earlier draft of this constant was 240_000, leaving
 * exactly 60s — less than the 65s it has to cover, which would let the platform
 * kill a cycle mid-transaction. That is strictly worse than the starvation this
 * deadline exists to bound, and it is pinned by a test in
 * tests/sync-tick-budget.test.ts rather than left to arithmetic in a comment.
 *
 * Skipped connections are REPORTED, not silently dropped — the tick's response
 * carries the count, and the next tick reaches them first because
 * `forAllTenants_syncTick` orders by how far behind each client is.
 *
 * ── THE TRADIE-BOOKED PASS SPENDS INSIDE THIS BUDGET (14-REVIEW WR-06) ──────
 *
 * Phase 14 added a post-commit pass to every cycle that may read ServiceM8 up
 * to `LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE` times. Unbounded, those reads
 * (20 s each) would run after the last admitted cycle and past the headroom
 * above. So the pass gets a deadline of this tick's deadline (from the tick's
 * start) less `LEAD_JOB_MATCH_PASS_MARGIN_MS`, each read is capped at
 * `LEAD_JOB_MATCH_READ_TIMEOUT_MS` and never waits past that deadline, and
 * whatever is left is skipped and counted. The last admitted cycle's pass is
 * therefore past its deadline and spends no read: the 65 s worst case above
 * still covers it, plus the pass's few database statements.
 */
export const TICK_DEADLINE_MS = 220_000;

export interface SyncAlert {
  kind: 'auth' | 'degraded';
  tenantId: string;
  tenantName: string;
  /** The classified reason, never free text — safe to put in an email. */
  outcome: SyncOutcome;
}

export interface SyncCycleResult {
  tenantId: string;
  /** `null` only when the cycle failed locally and could not be classified. */
  outcome: SyncOutcome | null;
  /** Whether a `sync_runs` row exists for this cycle. */
  recorded: boolean;
  /**
   * The tick ran out of budget before reaching this connection (WR-03).
   *
   * DISTINCT FROM A FAILURE, and the distinction matters in both directions:
   * nothing was attempted, so there is no `sync_runs` row, no
   * `consecutive_failures` increment and nothing to alert on — but the client
   * also did not sync, which is invisible everywhere else. Reporting it is what
   * makes "which clients did this tick actually reach" answerable, which is the
   * question `forAllTenants_syncTick`'s ordering comment already claims to
   * answer.
   */
  skipped: boolean;
  jobsFetched: number;
  jobsUpserted: number;
  contactsFetched: number;
  eventsEmitted: number;
  paused: boolean;
  alert: SyncAlert | null;
}

export interface RunSyncOptions {
  /**
   * Builds the ServiceM8 client from the DECRYPTED key. Injectable so tests can
   * drive a cycle from a captured fixture page without a live account — and so
   * the decrypt path stays on the tested path rather than being stubbed away.
   */
  clientFactory?: (apiKey: string) => Sm8Client;
  /**
   * Where an alert intent goes. Defaults to the operator email (D-05).
   *
   * The hook exists so the decision to alert is made and tested in the cycle
   * that made it, rather than being re-derived later from stored state — and so
   * the dedupe/episode tests can capture intents without a mail provider.
   */
  onAlert?: (alert: SyncAlert) => void | Promise<void>;
  now?: Date;
  /** Overridden to `[]` in tests so a retry case does not cost five seconds. */
  retryDelaysMs?: readonly number[];
  /**
   * Wall-clock epoch ms at which the tick stops admitting cycles — set by
   * `runSyncTick`. The post-commit pass stops spending ServiceM8 reads
   * `LEAD_JOB_MATCH_PASS_MARGIN_MS` before it (WR-06). A cycle run on its own
   * takes its start plus `TICK_DEADLINE_MS`.
   */
  tickDeadlineAt?: number;
}

const sleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** ±25% jitter, so fifteen clients failing together do not retry in lockstep. */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

/**
 * A parsed job contact → the `quote_contacts` row shape.
 *
 * `is_primary_contact` is deprecated upstream and is deliberately not mirrored;
 * `type` is the field Phase 3 selects a recipient on.
 */
export function normalizeContact(
  contact: ReturnType<typeof sm8JobContact.parse>,
): QuoteContactUpsert {
  return {
    sm8ContactUuid: contact.uuid,
    sm8JobUuid: contact.job_uuid,
    first: contact.first ?? null,
    last: contact.last ?? null,
    phone: contact.phone ?? null,
    mobile: contact.mobile ?? null,
    email: contact.email ?? null,
    contactType: contact.type ?? null,
    sm8Active: contact.active,
    editDateRaw: contact.edit_date,
  };
}

/**
 * The best-effort ServiceM8 timestamp for an event kind.
 *
 * Returns `null` rather than falling back to `now()`: `detected_at` already
 * records when WE noticed, and conflating the two would make "when the tradie
 * won it" unanswerable — which is exactly the question Phase 7's attribution
 * asks.
 */
function occurredAtFor(type: QuoteEventType, quote: NormalizedQuote): Date | null {
  switch (type) {
    case 'won':
      // A direct Quote → Completed win has no work_order_date at all.
      return quote.workOrderDateUtc ?? quote.completionDateUtc;
    case 'lost':
      return quote.unsuccessfulDateUtc;
    case 'quote_opened':
    case 'reopened':
      return quote.quoteDateUtc;
    case 'removed':
      // ServiceM8 records no deletion timestamp. Saying so is more useful than
      // inventing one.
      return null;
  }
}

interface FetchedPages {
  jobs: NormalizedQuote[];
  contacts: QuoteContactUpsert[];
}

type FetchOutcome =
  | { ok: true; data: FetchedPages }
  | { ok: false; kind: Sm8FailureKind };

/**
 * Fetch and parse both resources, retrying transient failures in-cycle.
 *
 * The 5-minute tick is the OUTER backoff — there is no long sleep here, because
 * the next cycle is the real retry. Two quick attempts absorb a dropped socket
 * or a single 429 without letting the cadence fall five minutes behind.
 */
async function fetchAndParse(
  client: Sm8Client,
  conn: DueConnection,
  now: Date,
  retryDelays: readonly number[],
): Promise<FetchOutcome> {
  let lastKind: Sm8FailureKind = 'network_error';

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (attempt > 0) await sleep(jitter(retryDelays[attempt - 1]));

    const result = await attemptFetch(client, conn, now);
    if (result.ok) return result;

    lastKind = result.kind;
    if (NON_RETRYABLE.has(result.kind)) return result;
  }

  return { ok: false, kind: lastKind };
}

async function attemptFetch(
  client: Sm8Client,
  conn: DueConnection,
  now: Date,
): Promise<FetchOutcome> {
  // NO `active eq 1` FILTER (Pitfall 6). A deleted open quote must arrive as
  // deleted rather than merely stop appearing — otherwise its row stays 'Quote'
  // forever and the cadence chases a job that no longer exists.
  const jobFilter = `edit_date gt '${filterFrom(conn.jobCursor, { now })}'`;
  const jobPage = await fetchAllPages(client, 'job.json', { filter: jobFilter });
  if (!jobPage.ok) return { ok: false, kind: jobPage.kind };

  const contactFilter = `edit_date gt '${filterFrom(conn.contactCursor, { now })}'`;
  const contactPage = await fetchAllPages(client, 'jobcontact.json', {
    filter: contactFilter,
  });
  if (!contactPage.ok) return { ok: false, kind: contactPage.kind };

  const jobs: NormalizedQuote[] = [];
  for (const row of jobPage.data) {
    const parsed = sm8Job.safeParse(row);
    // One bad row fails the whole cycle. A partial write looks exactly like a
    // client with fewer quotes than they have, and nothing downstream can tell.
    if (!parsed.success) return { ok: false, kind: 'parse_error' };
    jobs.push(normalizeJob(parsed.data, SM8_TIMESTAMP_ZONE));
  }

  const contacts: QuoteContactUpsert[] = [];
  for (const row of contactPage.data) {
    const parsed = sm8JobContact.safeParse(row);
    if (!parsed.success) return { ok: false, kind: 'parse_error' };
    contacts.push(normalizeContact(parsed.data));
  }

  return { ok: true, data: { jobs, contacts } };
}

/**
 * The default alert sink: the operator's inbox (D-05).
 *
 * A FAILED SEND IS LOGGED AND SWALLOWED, deliberately. By the time this runs,
 * the important work is already committed — the connection is paused, the
 * `sync_runs` row is written, and the console banner will render from that
 * state whether or not this email ever arrives. Letting a mail provider's bad
 * afternoon throw out of here would abort `runSyncForConnection`, which
 * `runSyncTick` would then report as an unclassified local failure: a client
 * that IS correctly paused, recorded as a cycle that could not be recorded.
 *
 * Only classified values reach the log line — the alert kind, the outcome, and
 * the alert module's own failure classification. Never the caught value.
 */
async function emailOperator(alert: SyncAlert): Promise<void> {
  const result = await sendOperatorAlert({
    tenantId: alert.tenantId,
    tenantName: alert.tenantName,
    kind: alert.kind === 'auth' ? 'auth_failed' : 'degraded',
    detail: alert.outcome,
  });

  if (!result.ok) {
    console.error(
      `[sync] operator alert NOT sent (${alert.kind}/${alert.outcome}): ` +
        `${result.kind} — ${result.detail}`,
    );
  }
}

/**
 * Record a failed cycle: apply the D-06 policy, patch the connection, and write
 * the `sync_runs` row.
 *
 * Always writes the run row. A failed cycle that records nothing is
 * indistinguishable from a cycle that never ran, and those two need different
 * responses — fix the client's key, versus fix our cron.
 *
 * THE POLICY IS EVALUATED INSIDE THE LOCK, against the locked row rather than
 * against the snapshot this cycle started with. This is the same argument the
 * success path already makes for the cursor: two overlapping failing runs (the
 * five-minute poll and a webhook hint that arrived mid-poll) would otherwise
 * both read `alerted_at = null` from their own stale snapshots and both decide
 * to email. "Exactly one email per episode" is the guarantee; reading the
 * dedupe field from a value fetched before the lock was taken is exactly how it
 * would quietly become "usually one".
 */
async function recordFailure(
  conn: DueConnection,
  kind: Sm8FailureKind,
  startedAt: Date,
  now: Date,
): Promise<{ paused: boolean; alert: SyncAlert | null }> {
  const repo = forTenant(conn.tenantId);

  let paused = false;
  let alert: SyncAlert | null = null;

  await repo.transaction(async (tx) => {
    const [locked] = await tx.connection.lock();
    // The connection was deleted mid-cycle. Nothing to patch and nothing to log
    // against — the tenant cascade already removed the sync_runs rows too.
    if (!locked) return;

    const decision = applyFailurePolicy({
      kind,
      consecutiveFailures: locked.consecutiveFailures,
      alertedAt: locked.alertedAt,
    });

    await tx.connection.update({
      // HONOURED, NOT ASSUMED (WR-07). This read `locked.consecutiveFailures + 1`
      // unconditionally, so a third of the policy's decision was decorative: a
      // future `incrementFailures: false` branch — "do not count a 429 against
      // the degraded threshold", say — would have been written, tested at the
      // policy level, and silently ignored here. The policy module's own header
      // argues the pure/effectful split exists so its branches get exercised;
      // that argument only holds if the effects actually read the decision.
      consecutiveFailures: decision.incrementFailures
        ? locked.consecutiveFailures + 1
        : locked.consecutiveFailures,
      pausedAt: decision.pauseReason ? now : locked.pausedAt,
      statusReason: decision.pauseReason ?? locked.statusReason,
      // Set in the SAME update as `paused_at` (D-05): the decision to pause and
      // the record that the operator was told about it are one fact, and a
      // crash between two writes would produce either a silent pause or a
      // repeating alert.
      alertedAt: decision.alertKind ? now : locked.alertedAt,
    });

    await tx.syncRuns.insert({
      startedAt,
      finishedAt: now,
      outcome: kind,
      // The classified kind, never caught-error text (T-2-02). Redundant with
      // `outcome` on purpose: a single provable rule about what may appear in
      // this column is worth more than a more informative one that has to be
      // re-audited at every write site.
      errorDetail: kind,
    });

    paused = decision.pauseReason !== null;
    alert = decision.alertKind
      ? {
          kind: decision.alertKind,
          tenantId: conn.tenantId,
          tenantName: conn.tenantName,
          outcome: kind,
        }
      : null;
  });

  return { paused, alert };
}

/**
 * One complete cycle for one connection.
 *
 * Throws only on a LOCAL failure (the database is unreachable, the encryption
 * key is malformed). Every ServiceM8-side failure resolves to a classified
 * result with a `sync_runs` row behind it — see `src/core/servicem8/types.ts`
 * for why that distinction is enforced at the boundary rather than here.
 */
export async function runSyncForConnection(
  conn: DueConnection,
  options: RunSyncOptions = {},
): Promise<SyncCycleResult> {
  const {
    clientFactory = (apiKey: string) => createSm8Client({ kind: 'apiKey', key: apiKey }),
    onAlert = emailOperator,
    now = new Date(),
    retryDelaysMs = IN_CYCLE_RETRY_DELAYS_MS,
  } = options;

  const startedAt = new Date(now);
  // Wall clock, never `now` (which tests pin to a fixed date): the deadline
  // bounds real time spent inside the route's maxDuration (WR-06).
  const passDeadlineAt =
    (options.tickDeadlineAt ?? Date.now() + TICK_DEADLINE_MS) - LEAD_JOB_MATCH_PASS_MARGIN_MS;

  const encryptionKey = decodeEncryptionKey(getServerEnv().CREDENTIALS_ENCRYPTION_KEY);
  const apiKey = decryptCredential(conn.apiKeyCiphertext, encryptionKey);
  const client = clientFactory(apiKey);

  const fetched = await fetchAndParse(client, conn, now, retryDelaysMs);

  if (!fetched.ok) {
    const finishedAt = new Date();
    const { paused, alert } = await recordFailure(conn, fetched.kind, startedAt, finishedAt);
    if (alert) await onAlert(alert);

    return {
      tenantId: conn.tenantId,
      outcome: fetched.kind,
      recorded: true,
      skipped: false,
      jobsFetched: 0,
      jobsUpserted: 0,
      contactsFetched: 0,
      eventsEmitted: 0,
      paused,
      alert,
    };
  }

  const { jobs, contacts } = fetched.data;
  const repo = forTenant(conn.tenantId);

  const written = await repo.transaction(async (tx) => {
    // The lock, first (SYNC-03). Everything below reads state that an
    // overlapping run must not be changing underneath it.
    const [locked] = await tx.connection.lock();
    if (!locked) {
      return { jobsUpserted: 0, eventsEmitted: 0, contactsUpserted: 0 };
    }

    const stored = await tx.quotes.stateFor(jobs.map((j) => j.sm8JobUuid));
    const previous = new Map(stored.map((row) => [row.sm8JobUuid, row]));

    const rows: QuoteUpsert[] = jobs.map((job) => ({
      ...job,
      syncSource: 'poll' as const,
      // A quote that arrives AFTER the client is connected is one nobody has
      // had a chance to mishandle yet, so it is chaseable on arrival — unlike a
      // backfilled quote, which may be months old and already dealt with
      // (D-15). `chase_eligibility` is excluded from the upsert's conflict set,
      // so this value applies on INSERT only and never overwrites an operator's
      // triage decision on a row that already exists.
      chaseEligibility: 'eligible' as const,
    }));

    // SM8-02 (plan 14-03): a job we have never seen whose uuid a lead recorded is
    // a lead's own job — the orphan of an attempt that failed after the job POST.
    // It lands needs_review / lead (the retry completes the linkage), never eligible.
    const unseen = jobs.filter((j) => !previous.has(j.sm8JobUuid)).map((j) => j.sm8JobUuid);
    const leadLinked = new Set(await tx.leads.jobUuidsLinkedAmong(unseen));
    for (const row of rows) {
      if (!leadLinked.has(row.sm8JobUuid)) continue;
      row.syncSource = 'lead';
      row.chaseEligibility = 'needs_review';
    }

    const upserted = await tx.quotes.upsertManyReturning(rows);
    const idByUuid = new Map(upserted.map((row) => [row.sm8JobUuid, row.id]));

    const events: QuoteStatusEventInsert[] = [];

    for (const job of jobs) {
      const prev = previous.get(job.sm8JobUuid);
      const quoteId = idByUuid.get(job.sm8JobUuid);
      if (!quoteId) continue;
      // SM8-02: first sight of a lead's own job is announced to nobody.
      if (leadLinked.has(job.sm8JobUuid)) continue;

      // THE EDGE, NOT THE STATE. A job deleted upstream keeps returning
      // `active: 0` on every subsequent poll; passing the raw flag would emit a
      // fresh `removed` event every five minutes forever and break idempotence.
      // First sight of an already-deleted job stays silent for the same reason
      // first sight of an already-won one does: we never watched it happen.
      const becameInactive = !job.sm8Active && prev !== undefined && prev.sm8Active;

      const type = classifyTransition(
        (prev?.status as Sm8Status | undefined) ?? null,
        job.status as Sm8Status,
        becameInactive,
      );
      if (type === null) continue;

      // D-15 gate. `quote_opened` announces something the cadence engine may
      // act on, so it fires only for a row that lands chase-eligible — which,
      // given the conflict-set rule above, means a brand-new poll-sourced row.
      if (type === 'quote_opened' && prev !== undefined) continue;

      events.push({
        quoteId,
        sm8JobUuid: job.sm8JobUuid,
        fromStatus: prev?.status ?? FIRST_SIGHT,
        toStatus: job.status,
        eventType: type,
        occurredAt: occurredAtFor(type, job),
      });
    }

    const eventsEmitted = await tx.events.insertMany(events);
    const contactsUpserted = await tx.quoteContacts.upsertMany(contacts);

    await tx.connection.update({
      // `prev` re-read from the LOCKED row, not from the snapshot this cycle
      // started with: a concurrent run that advanced further must not be
      // rewound by ours.
      jobCursor: advanceCursor(
        locked.jobCursor,
        jobs.map((j) => j.editDateRaw),
      ),
      contactCursor: advanceCursor(
        locked.contactCursor,
        contacts.map((c) => c.editDateRaw),
      ),
      lastSuccessAt: now,
      consecutiveFailures: 0,
      // Cleared so a NEW degraded episode alerts again rather than being
      // deduped against an alert about a problem that has since been fixed.
      alertedAt: null,
    });

    await tx.syncRuns.insert({
      startedAt,
      finishedAt: new Date(),
      outcome: 'ok',
      jobsFetched: jobs.length,
      jobsUpserted: upserted.length,
      contactsFetched: contacts.length,
      eventsEmitted,
      errorDetail: null,
    });

    return { jobsUpserted: upserted.length, eventsEmitted, contactsUpserted };
  });

  // Post-commit, outside the lock: the tradie-booked pass (D-07, D-12) opens its
  // own transaction per hit — inside the one above it would be close.ts's nested
  // transaction. The caught value is deliberately not logged (runSyncTick's
  // rule); this cycle's outcome, its sync_runs row and its result are untouched.
  try {
    await resolveLeadsBookedByTradie(conn.tenantId, {
      client,
      tenantTimezone: conn.tenantTimezone,
      now,
      deadlineAt: passDeadlineAt,
    });
  } catch {
    console.error(`[sync] lead job match failed for tenant ${conn.tenantId}.`);
  }

  return {
    tenantId: conn.tenantId,
    outcome: 'ok',
    recorded: true,
    skipped: false,
    jobsFetched: jobs.length,
    jobsUpserted: written.jobsUpserted,
    contactsFetched: contacts.length,
    eventsEmitted: written.eventsEmitted,
    paused: false,
    alert: null,
  };
}

/**
 * One cycle for every unpaused connection.
 *
 * PER-CONNECTION ISOLATION IS THE POINT (Pitfall 8). Each cycle runs in its own
 * try/catch and its own transaction, so client #2's revoked key cannot stop
 * clients #3–15 from syncing — which, with a stable iteration order, is exactly
 * how "the tick threw once and nobody synced for a week" happens.
 *
 * A cycle that fails LOCALLY (database unreachable) is reported with
 * `recorded: false` rather than given a fabricated outcome. There is no honest
 * member of the `sync_runs` vocabulary for "our own write failed", and the
 * database being down is precisely the condition under which recording it would
 * fail too.
 *
 * ── THE TICK IS BUDGETED, AND SAYS WHAT IT COULD NOT REACH (WR-03) ──────────
 *
 * The loop is sequential, and one slow client is expensive: with
 * `REQUEST_TIMEOUT_MS = 20_000`, three attempts and two resources per attempt,
 * a single unresponsive account burns ~65 seconds. Roughly five of those consume
 * the entire `maxDuration = 300` budget, so at the target of fifteen clients a
 * ServiceM8 slowdown meant two-thirds were simply never attempted — and, before
 * the ordering change described in `forAllTenants_syncTick`, it was the SAME
 * two-thirds every tick, because a stable order plus a timeout is a starvation
 * schedule rather than a fairness one.
 *
 * A starved client writes no `sync_runs` row and never increments
 * `consecutive_failures`. Without the deadline it did not appear in the tick's
 * response either, so the only remaining evidence was `last_success_at` going
 * stale — which is why CR-02's staleness rule and this deadline are the two
 * halves of one guarantee.
 */
export async function runSyncTick(
  options: RunSyncOptions & {
    /**
     * The connections to sync. Defaults to every unpaused one.
     *
     * Supplied explicitly by the 02-03 webhook adapter, which answers a hint
     * about ONE tenant by running this same cycle for that tenant — "hints to
     * poll" (SYNC-03), so the webhook path and the poll path can never drift
     * into two implementations of the same guarantee.
     */
    connections?: DueConnection[];
    /** Overridden in tests; see `TICK_DEADLINE_MS`. */
    deadlineMs?: number;
  } = {},
): Promise<SyncCycleResult[]> {
  const due = options.connections ?? (await forAllTenants_syncTick());
  const results: SyncCycleResult[] = [];

  const deadlineMs = options.deadlineMs ?? TICK_DEADLINE_MS;
  const tickStartedAt = Date.now();
  const tickDeadlineAt = tickStartedAt + deadlineMs;

  for (const conn of due) {
    // CHECKED BEFORE STARTING, never mid-cycle. A cycle that has begun owns a
    // transaction and a decrypted credential; abandoning it partway is how a
    // half-written mirror happens. The deadline's headroom exists precisely so
    // the last cycle admitted can finish.
    if (Date.now() - tickStartedAt > deadlineMs) {
      results.push({
        tenantId: conn.tenantId,
        outcome: null,
        recorded: false,
        skipped: true,
        jobsFetched: 0,
        jobsUpserted: 0,
        contactsFetched: 0,
        eventsEmitted: 0,
        paused: false,
        alert: null,
      });
      continue;
    }

    try {
      results.push(await runSyncForConnection(conn, { ...options, tickDeadlineAt }));
    } catch {
      // Deliberately NOT logging the caught value (T-2-02): a throw from this
      // depth can carry a Request, headers included, and the one header on it
      // is the client's API key.
      results.push({
        tenantId: conn.tenantId,
        outcome: null,
        recorded: false,
        skipped: false,
        jobsFetched: 0,
        jobsUpserted: 0,
        contactsFetched: 0,
        eventsEmitted: 0,
        paused: false,
        alert: null,
      });
    }
  }

  return results;
}
