/**
 * Connecting a client's ServiceM8 account (ONB-02, SYNC-01, SYNC-03).
 *
 * ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER:
 *
 *   1. VERIFY the candidate key with a live call, BEFORE anything is written.
 *      A stored-but-invalid key produces a connection that looks healthy in the
 *      console and silently syncs nothing — the client's quotes go unchased and
 *      the first anyone notices is a month later when the report is empty. A
 *      typo must fail at the form, loudly, while the operator still has the
 *      correct key on screen.
 *   2. FETCH the 90-day backfill. Outside the transaction, deliberately: an
 *      open Postgres transaction held across several seconds of third-party
 *      HTTP occupies a pooled connection and can outlive the pool's own
 *      timeouts. Nothing is written yet, so a failed fetch leaves no residue.
 *   3. ENCRYPT, then WRITE — connection row and every quote row in ONE
 *      transaction. Either the client is connected with their history mirrored,
 *      or nothing happened. A connection row without quotes is the state that
 *      would make the operator think the backfill ran.
 *
 * CONCURRENCY (ONB-02 edge): step 3 upserts against the UNIQUE `tenant_id`, so
 * two concurrent connects — a double-clicked form, two browser tabs — produce
 * one row, decided by Postgres. There is no check-then-insert anywhere in this
 * file, because two requests can both pass a check.
 *
 * THE BACKFILL IS NOT A SYNC (D-15). Every open quote it finds lands as
 * `chase_eligibility = 'needs_review'`. These quotes are up to three months old;
 * the client may have already spoken to those customers, or written them off.
 * Chasing them unreviewed is how the service embarrasses a client in week one.
 * The operator triages them into eligibility deliberately, in a later plan.
 *
 * IT ALSO EMITS NO EVENTS. Events do not exist yet (plan 02-02 adds them), and
 * when they do, backfill still must not emit: replaying three months of status
 * transitions into the cadence engine on connect day would fire a burst of
 * follow-ups for jobs that closed in June.
 */
import {
  auditWindow,
  computeBaseline,
  isInWindow,
  windowDate,
  type AuditLine,
} from '@/core/audit/aggregate';
import { applyResumeRewindow } from '@/core/cadence/resume';
import { createSm8Client } from '@/core/servicem8/client';
import {
  normalizeJob,
  parseMoneyToCents,
  SM8_TIMESTAMP_ZONE,
} from '@/core/servicem8/normalize';
import { fetchAllPages } from '@/core/servicem8/pagination';
import { sm8Job } from '@/core/servicem8/schemas';
import type { Sm8FailureKind, NormalizedQuote } from '@/core/servicem8/types';
import { credentialLast4, decodeEncryptionKey, encryptCredential } from '@/core/shared/crypto';
import { getServerEnv } from '@/core/shared/env';
import { runSyncForConnection } from '@/core/sync/run-sync';
import { forTenant, type QuoteUpsert } from '@/db/repository';
import type { SyncOutcome } from '@/db/schema';

/** D-14: the pre-service window. One extra day absorbs SM8/our clock skew. */
export const BACKFILL_DAYS = 90;

export type ConnectResult =
  | {
      ok: true;
      keyLast4: string;
      quotesWritten: number;
      openQuotes: number;
      jobCursor: string | null;
      /** D-14 — `null` when they issued no quotes in the window, NEVER 0. */
      baselineWinRate: string | null;
      baselineQuotesIssued: number;
    }
  | { ok: false; kind: Sm8FailureKind | 'no_such_tenant'; detail?: string };

/**
 * The date-only literal ServiceM8's filter documentation demonstrates.
 *
 * The Wave-0 spike measured that datetime literals ARE parsed correctly (A1),
 * so second precision is available here — but a 90-day backfill has no use for
 * it, and the extra day of slack costs one extra day of jobs. Date-only stays.
 *
 * The incremental poll (plan 02-03) is where the precision matters, and it
 * inherits a second finding from the same probe: `gt` behaves INCLUSIVELY, so
 * the record at the cursor boundary comes back on every poll. That is the safe
 * direction — Pitfall 2 is about LOSING same-second edits, not re-reading them
 * — and the (tenant_id, sm8_job_uuid) upsert dedupes the repeat.
 */
export function backfillFilterFrom(now: Date = new Date(), days = BACKFILL_DAYS): string {
  const cutoff = new Date(now.getTime() - (days + 1) * 86_400_000);
  return cutoff.toISOString().slice(0, 10);
}

/**
 * New cursor = the maximum `edit_date` OBSERVED in their data.
 *
 * Never `now()`. If ServiceM8's clock runs hours ahead of ours (a documented
 * community report for Perth accounts), a cursor from our clock would skip
 * every record edited in that window — permanently, because the next poll moves
 * it forward again. Their own maximum is correct regardless of the offset
 * (RESEARCH Pattern 1).
 */
export function maxEditDate(rows: { editDateRaw: string }[]): string | null {
  return rows.reduce<string | null>(
    (max, r) => (max === null || r.editDateRaw > max ? r.editDateRaw : max),
    null,
  );
}

/**
 * Connect a tenant's ServiceM8 account and mirror their last 90 days.
 *
 * Returns a typed outcome, never a throw for an expected failure — the form
 * renders the failure kind as copy, and an exception would be indistinguishable
 * from a crash.
 */
export async function connectServiceM8(
  tenantId: string,
  apiKey: string,
): Promise<ConnectResult> {
  const repo = forTenant(tenantId);

  // Existence check, and the row every later phase reads for contact hours.
  // NOTE: `tenant.timezone` is deliberately NOT used to interpret ServiceM8
  // timestamps — the Wave-0 spike measured those as UTC (A3, see
  // normalize.ts). Passing the tenant's zone here would put every normalized
  // timestamp 8 hours out for a Perth client.
  const [tenant] = await repo.tenant.get();
  if (!tenant) return { ok: false, kind: 'no_such_tenant' };

  const client = createSm8Client({ kind: 'apiKey', key: apiKey });

  // --- 1. Verify, before writing anything ----------------------------------
  const probe = await client.get('job.json', { cursor: '-1' });
  if (!probe.ok) return { ok: false, kind: probe.kind, detail: probe.detail };

  // --- 2. Fetch the backfill (outside the transaction — see the header) -----
  //
  // One filter on `quote_date` spans all four statuses, because any job that
  // ever became a quote carries a quote_date; jobs created straight to Work
  // Order have a zero-date and fall out of a `gt` comparison. CONFIRMED by the
  // Wave-0 spike (A4): of 4 jobs with a zero `work_order_date`, zero survived
  // `work_order_date gt '2000-01-01'` — so `gt` really does exclude zero-dates,
  // and the four-request per-status fallback is not needed.
  //
  // All four statuses are then PERSISTED — win/loss history is what the
  // baseline and the recovered-revenue report are computed from (D-14/D-16).
  const filter = `quote_date gt '${backfillFilterFrom()}'`;
  const page = await fetchAllPages(client, 'job.json', { filter });
  if (!page.ok) return { ok: false, kind: page.kind, detail: page.detail };

  const normalized: NormalizedQuote[] = [];
  for (const row of page.data) {
    const parsed = sm8Job.safeParse(row);
    if (!parsed.success) {
      // A partial write is worse than no write: it looks like a client with
      // fewer quotes than they have, and nothing downstream can tell.
      return {
        ok: false,
        kind: 'parse_error',
        detail: `a job did not match the expected shape: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.code}`)
          .join('; ')}`,
      };
    }
    normalized.push(normalizeJob(parsed.data, SM8_TIMESTAMP_ZONE));
  }

  // --- 3. Encrypt and write, atomically ------------------------------------
  const key = decodeEncryptionKey(getServerEnv().CREDENTIALS_ENCRYPTION_KEY);
  const ciphertext = encryptCredential(apiKey, key);
  const last4 = credentialLast4(apiKey);

  const cursor = maxEditDate(normalized);

  // --- D-14: the pre-service baseline, computed from the SAME rows ----------
  //
  // WHY THIS MOMENT AND NO OTHER. The baseline answers "how were they doing
  // before we touched anything", and the instant the cadence starts running
  // there is no un-chased population left to measure. It cannot be
  // reconstructed later from a bigger fetch, because by then some of those
  // quotes were won BECAUSE of the service — which is the very thing the
  // baseline exists to subtract.
  //
  // Computed with `computeBaseline`, the same function the prospect audit uses,
  // over the same 90-day window: a prospect who converts must not find that
  // their audit and their first monthly report disagree about their own
  // history (D-12/D-14 shared code path).
  //
  // The backfill deliberately fetches 91 days of slack, so the window is
  // re-applied precisely here rather than inherited from the API filter.
  const window = auditWindow();
  const baselineLines: AuditLine[] = normalized
    .filter((q) => q.sm8Active && isInWindow(q.quoteDateUtc, window))
    .map((q) => ({
      status: q.status,
      quoteDateUtc: q.quoteDateUtc,
      valueCents: parseMoneyToCents(q.totalInvoiceAmount),
      // Irrelevant to a win rate, and honestly unknown for a client we have
      // only just met — `computeBaseline` reads status and quote date alone.
      followedUp: false,
    }));
  const baseline = computeBaseline(baselineLines);

  const rows: QuoteUpsert[] = normalized.map((q) => ({
    ...q,
    syncSource: 'backfill' as const,
    // D-15 — see the header. Never 'eligible' from a backfill.
    chaseEligibility: 'needs_review' as const,
  }));

  const written = await repo.transaction(async (tx) => {
    await tx.connection.upsert({
      apiKeyCiphertext: ciphertext,
      keyLast4: last4,
      jobCursor: cursor,
      lastSuccessAt: new Date(),
      // A successful (re-)connect clears any prior auth pause: this is the
      // D-08 auto-resume path, and it is the same code as first connect
      // precisely so the two can never drift apart.
      pausedAt: null,
      statusReason: null,
      consecutiveFailures: 0,
      alertedAt: null,

      // In the SAME transaction as the connection row and the quotes. A
      // connection that commits without its baseline is a client whose
      // pre-service window can never be recovered — the data was in memory and
      // the moment has passed. `baselineWinRate` is null-for-no-data by
      // construction (see aggregate.ts); it must never be written as 0.
      baselineWinRate: baseline.winRate,
      baselineQuotesIssued: baseline.quotesIssued,
      baselineWindowStart: windowDate(window.start),
      baselineWindowEnd: windowDate(window.end),
      baselineComputedAt: new Date(),
    });
    return tx.quotes.upsertMany(rows);
  });

  return {
    ok: true,
    keyLast4: last4,
    baselineWinRate: baseline.winRate,
    baselineQuotesIssued: baseline.quotesIssued,
    quotesWritten: written,
    openQuotes: normalized.filter((q) => q.status === 'Quote' && q.sm8Active).length,
    jobCursor: cursor,
  };
}

export type ResumeResult =
  | {
      ok: true;
      keyLast4: string;
      /** The outcome of the immediate cycle, or `null` if it failed locally. */
      syncOutcome: SyncOutcome | null;
    }
  | {
      ok: false;
      kind: Sm8FailureKind | 'no_such_tenant' | 'not_connected';
      detail?: string;
    };

/**
 * Replace a client's ServiceM8 key and resume their sync (D-08 auto-resume).
 *
 * ── WHY THIS IS NOT `connectServiceM8` ──────────────────────────────────────
 *
 * `connectServiceM8` already clears the pause fields, so it would *appear* to
 * serve this case. It would also re-run a 90-day backfill, and the backfill
 * writes `chase_eligibility = 'needs_review'` on every open quote it finds.
 * Using it here would silently un-triage every quote the operator had already
 * reviewed and approved for chasing — the exact decision D-15 and the upsert's
 * omitted conflict-set column exist to protect. A re-key is a credential
 * change, not a re-onboarding.
 *
 * ── ORDER, AND WHAT EACH STEP DEFENDS ───────────────────────────────────────
 *
 *   1. VERIFY LIVE, before writing. Identical to first connect, and identical
 *      for the identical reason: a stored-but-invalid key produces a connection
 *      that reads healthy in the console and syncs nothing. A re-key is
 *      typically performed while a client is already broken, which is the worst
 *      moment to accept a second bad key silently.
 *   2. WRITE the new ciphertext AND clear all four pause fields in ONE update.
 *      A key stored without the pause cleared leaves the client paused with a
 *      working key; a pause cleared without the key stored resumes polling with
 *      the revoked one.
 *   3. SYNC IMMEDIATELY. Without this the operator pastes a key, sees the
 *      banner clear, and then stares at stale quote data for up to five
 *      minutes with no way to tell whether the fix worked. The cycle is the
 *      SAME `runSyncForConnection` the tick runs — not a reimplementation —
 *      so a resume can never verify differently from a poll.
 *
 * A FAILED IMMEDIATE SYNC IS STILL A SUCCESSFUL RE-KEY. The key verified
 * against the live API one moment earlier; if the cycle then hits a 429, that
 * is weather, the connection is correctly unpaused, and the next tick retries.
 * Reporting failure here would send the operator hunting for a third key.
 */
export async function resumeConnection(
  tenantId: string,
  apiKey: string,
): Promise<ResumeResult> {
  const repo = forTenant(tenantId);

  const [tenant] = await repo.tenant.get();
  if (!tenant) return { ok: false, kind: 'no_such_tenant' };

  const [existing] = await repo.connection.get();
  // Re-keying something that was never connected is a different operation with
  // a different shape (it needs the backfill). Saying so beats half-performing
  // a connect that leaves the client with no quote history.
  if (!existing) return { ok: false, kind: 'not_connected' };

  // --- 1. Verify, before writing anything ----------------------------------
  const client = createSm8Client({ kind: 'apiKey', key: apiKey });
  const probe = await client.get('job.json', { cursor: '-1' });
  if (!probe.ok) return { ok: false, kind: probe.kind, detail: probe.detail };

  // --- 2. Store the key and close the failure episode, atomically ----------
  const key = decodeEncryptionKey(getServerEnv().CREDENTIALS_ENCRYPTION_KEY);
  const ciphertext = encryptCredential(apiKey, key);
  const last4 = credentialLast4(apiKey);

  const [updated] = await repo.connection.update({
    apiKeyCiphertext: ciphertext,
    keyLast4: last4,
    pausedAt: null,
    statusReason: null,
    consecutiveFailures: 0,
    // Cleared with the rest, so the NEXT failure is a new episode and alerts
    // again. A resume that left this set would mute this client permanently.
    alertedAt: null,
  });

  // THE WRITE IS CHECKED BEFORE THE CYCLE, NOT INSIDE IT (WR-06).
  //
  // `connection.update` returns `[]` when its `WHERE tenant_id = ...` predicate
  // matches nothing — reachable if the row was deleted between the existence
  // check above and this write. `updated` is then `undefined`, and reading
  // `updated.apiKeyCiphertext` in the cycle below throws a TypeError that the
  // very next catch swallows as "a LOCAL failure (the database went away)". The
  // function returned `ok: true` and the console rendered "Key replaced. Sync
  // resumed" for a re-key that stored nothing.
  //
  // Guarding here also un-blurs that catch: it now covers only what its comment
  // claims, so a genuine programming error is no longer indistinguishable from a
  // transient database blip. `recordFailure` handles the same deleted-mid-cycle
  // case explicitly (run-sync.ts) — this follows that precedent.
  if (!updated) return { ok: false, kind: 'not_connected' };

  // --- 3. One cycle now, so the console tells the truth immediately --------
  //
  // The cursors are deliberately carried over untouched: the mirror is stale,
  // not wrong, and everything edited during the outage has an `edit_date` past
  // the stored cursor. Resetting them would re-fetch and re-diff months of
  // jobs for no benefit.
  let syncOutcome: SyncOutcome | null = null;
  try {
    const cycle = await runSyncForConnection({
      tenantId,
      tenantName: tenant.name,
      tenantTimezone: tenant.timezone,
      apiKeyCiphertext: updated.apiKeyCiphertext,
      jobCursor: updated.jobCursor,
      contactCursor: updated.contactCursor,
      consecutiveFailures: updated.consecutiveFailures,
      alertedAt: updated.alertedAt,
    });
    syncOutcome = cycle.outcome;
  } catch {
    // A LOCAL failure (the database went away between the update and the
    // cycle). The re-key itself is committed and correct; the caught value is
    // deliberately not logged, because a throw from that depth can carry a
    // Request with the client's key in its headers (T-2-02).
    syncOutcome = null;
  }

  // --- 4. The D-07 re-window, because a pause just lifted -------------------
  //
  // THE PART OF A RESUME THAT IS NOT ABOUT THE KEY. While the connection was
  // paused the cadence tick skipped this client's progress and dispatch passes
  // entirely, so every touch that came due during the outage is sitting in the
  // past. Clearing `paused_at` without moving them means the very next tick
  // finds a pile of overdue, approved touches and — for the ones still inside
  // the staleness cap — sends them within a minute of each other. A client
  // whose key was dead for two days would resume by texting six customers at
  // once, which is precisely the burst CAD-02 exists to prevent, arriving
  // through the door marked "good news".
  //
  // The SAME rule every other resume path uses (D-05's operator resume and
  // D-06's client resume, plan 03-05): one implementation, so the three cannot
  // drift into three different answers to "when does messaging start again".
  //
  // AFTER the unpause and after the immediate cycle, and NEVER on a failure
  // path: every early return above leaves the pause in force, and re-windowing
  // a still-paused client would place their touches relative to a moment that
  // is not their resume. `applyResumeRewindow` refuses that case itself, but
  // the call site should not be relying on it.
  //
  // A FAILURE HERE IS NOT A FAILED RE-KEY. The key verified and is stored; the
  // schedule repair is recoverable (the next resume, or the operator's own
  // re-window) and reporting failure would send the operator hunting for a
  // third key. The caught value is not logged, for the reason above it.
  //
  // SCOPED TO THE CADENCES THE PAUSE IS RESPONSIBLE FOR, which is the same rule
  // the console's two resumes follow. `consumeQuoteEvents` keeps running for
  // connection-paused tenants by design, and an operator can triage quotes to
  // `eligible` while a client's key is dead — so brand-new cadences DO
  // accumulate during a connection pause, materialized from a fresh anchor with
  // slots that are already correct and in the future. Re-windowing those would
  // drag touch one to the re-key moment and send a customer their first message
  // days early, which is exactly the hazard `onlyCadenceIds` was added for. An
  // unscoped call here was the third of three resume paths giving a second
  // answer to a question this module's comment says has one.
  //
  // `existing.pausedAt` is null when nothing was paused — a proactive key
  // rotation. Then no touch slipped on our account and there is nothing here to
  // repair; the empty scope says "nothing was resumed", which is what the option
  // documents it to mean. The tick's own re-window pass owns anything overdue
  // for an unrelated reason.
  const pausedAt = existing.pausedAt;
  try {
    const frozen =
      pausedAt === null
        ? []
        : (await repo.cadences.listLive())
            .filter(
              (cadence) =>
                cadence.status === 'active' && cadence.createdAt.getTime() < pausedAt.getTime(),
            )
            .map((cadence) => cadence.id);

    await applyResumeRewindow(tenantId, new Date(), { onlyCadenceIds: frozen });
  } catch {
    console.error(
      `[sync] re-key succeeded for tenant ${tenantId} but the D-07 re-window did not ` +
        'run; overdue touches keep their old slots until the next resume.',
    );
  }

  return { ok: true, keyLast4: last4, syncOutcome };
}
