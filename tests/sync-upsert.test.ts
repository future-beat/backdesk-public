/**
 * SYNC-01/02/04 against the real database: a cycle must be idempotent, isolated
 * and honest about failure.
 *
 * These run `runSyncForConnection` end to end — real Postgres, real transaction,
 * real RLS-bypassing repository — with ONLY the ServiceM8 HTTP call stubbed. The
 * stub returns the sanitized page captured from the live trial account, so the
 * data flowing through is the data ServiceM8 actually sends (including
 * `quote_sent: false` as a JSON boolean and a four-decimal money string, the two
 * fields the reference documentation gets wrong).
 *
 * IDEMPOTENCE IS THE HEADLINE PROPERTY. The cursor deliberately re-fetches an
 * overlap window, and the spike measured `gt` behaving inclusively on top of
 * that, so the same rows arrive on essentially every poll. If a repeat produced
 * a duplicate event, the cadence engine would send the same customer the same
 * follow-up every five minutes.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sm8Client } from '@/core/servicem8/types';
import { decodeEncryptionKey, encryptCredential } from '@/core/shared/crypto';
import { runSyncForConnection, runSyncTick } from '@/core/sync/run-sync';
import { closeDb, forTenant, type DueConnection } from '@/db/repository';

import { admin, seedConnection, seedTenant, teardownTenants } from './helpers/seed';

const JOB_FIXTURE = JSON.parse(
  readFileSync('tests/fixtures/sm8/job.json', 'utf8'),
) as Array<Record<string, unknown>>;
const CONTACT_FIXTURE = JSON.parse(
  readFileSync('tests/fixtures/sm8/jobcontact.json', 'utf8'),
) as Array<Record<string, unknown>>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A ServiceM8 client that answers from memory.
 *
 * It ignores the `cursor` parameter, which is not laziness — the spike measured
 * the real API ignoring it too (A2). `fetchAllPages`'s no-new-uuids termination
 * rule is what stops the walk in both cases, so stubbing this way exercises the
 * same code path production takes.
 */
function stubClient(
  jobs: unknown[],
  contacts: unknown[],
  onRequest?: (resource: string, filter?: string) => void,
): Sm8Client {
  return {
    async get(resource, options) {
      onRequest?.(resource, options?.filter);
      const rows = resource.startsWith('jobcontact') ? contacts : jobs;
      return { ok: true, data: { rows, headers: new Headers() } };
    },
  };
}

/** A client that fails every request with a given classified kind. */
function failingClient(kind: 'auth_failed' | 'rate_limited'): Sm8Client {
  return {
    async get() {
      return { ok: false, kind, status: kind === 'auth_failed' ? 401 : 429 };
    },
  };
}

const tenants: string[] = [];

async function freshConnection(prefix: string): Promise<DueConnection> {
  const tenantId = await seedTenant(prefix);
  tenants.push(tenantId);

  // A REAL enc:v1 envelope, not the placeholder seedConnection defaults to:
  // runSyncForConnection decrypts before it does anything else, so a fake
  // ciphertext would fail the cycle for a reason unrelated to what is under
  // test — and would leave the decrypt path itself unexercised.
  const key = decodeEncryptionKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
  await seedConnection(tenantId, {
    api_key_ciphertext: encryptCredential('fixture-api-key', key),
    key_last4: 'ture',
  });

  return {
    tenantId,
    tenantName: prefix,
    tenantTimezone: 'Australia/Perth',
    apiKeyCiphertext: (await forTenant(tenantId).connection.get())[0].apiKeyCiphertext,
    jobCursor: null,
    contactCursor: null,
    consecutiveFailures: 0,
    alertedAt: null,
  };
}

async function eventsFor(tenantId: string) {
  return forTenant(tenantId).events.since(0);
}

beforeAll(() => {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error('These suites need CREDENTIALS_ENCRYPTION_KEY — see docs/env-vars.md');
  }
});

afterAll(async () => {
  await teardownTenants(tenants);
  await closeDb();
});

describe('runSyncForConnection — idempotence (SYNC-01)', () => {
  it('running the identical page twice produces identical rows and zero new events', async () => {
    const conn = await freshConnection('Sync Idempotent');
    const client = stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE));
    const options = { clientFactory: () => client, retryDelaysMs: [] };

    const first = await runSyncForConnection(conn, options);

    expect(first.outcome).toBe('ok');
    expect(first.jobsUpserted).toBe(JOB_FIXTURE.length);
    expect(first.contactsFetched).toBe(CONTACT_FIXTURE.length);
    // Two open quotes in the captured page, and only open quotes announce
    // themselves on arrival.
    expect(first.eventsEmitted).toBe(2);

    const [afterFirst] = await forTenant(conn.tenantId).connection.get();
    const quotesAfterFirst = await forTenant(conn.tenantId).quotes.list();

    // The second cycle starts from the cursor the first one wrote, which is
    // exactly what production does five minutes later.
    const second = await runSyncForConnection(
      { ...conn, jobCursor: afterFirst.jobCursor, contactCursor: afterFirst.contactCursor },
      options,
    );

    expect(second.outcome).toBe('ok');
    expect(
      second.eventsEmitted,
      'a re-fetched page emitted events. The overlap window guarantees this ' +
        'happens on every poll, so a duplicate here is the same customer being ' +
        'sent the same follow-up every five minutes.',
    ).toBe(0);

    const quotesAfterSecond = await forTenant(conn.tenantId).quotes.list();
    expect(quotesAfterSecond.length).toBe(quotesAfterFirst.length);

    const [afterSecond] = await forTenant(conn.tenantId).connection.get();
    expect(afterSecond.jobCursor).toBe(afterFirst.jobCursor);
    expect(afterSecond.contactCursor).toBe(afterFirst.contactCursor);

    expect((await eventsFor(conn.tenantId)).length).toBe(2);
  });

  it('advances the cursor to the maximum observed edit_date, never our clock', async () => {
    const conn = await freshConnection('Sync Cursor');
    const client = stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE));

    await runSyncForConnection(conn, { clientFactory: () => client, retryDelaysMs: [] });

    const [row] = await forTenant(conn.tenantId).connection.get();
    const expected = JOB_FIXTURE.map((j) => j.edit_date as string).sort().at(-1);

    expect(row.jobCursor).toBe(expected);
  });

  it('sends a filter derived from the cursor, and never filters on the active flag', async () => {
    // Pitfall 6: filtering `active eq 1` makes an upstream deletion invisible,
    // and the row stays 'Quote' forever while the cadence chases a ghost.
    const conn = await freshConnection('Sync Filter');
    const seen: string[] = [];
    const client = stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE), (_r, filter) => {
      if (filter) seen.push(filter);
    });

    await runSyncForConnection(
      { ...conn, jobCursor: '2026-08-26 09:20:00' },
      { clientFactory: () => client, retryDelaysMs: [] },
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe("edit_date gt '2026-08-26 09:05:00'");
    for (const filter of seen) {
      expect(filter, 'the fetch filtered on active').not.toContain('active');
    }
  });
});

describe('runSyncForConnection — status changes and deletions (SYNC-02)', () => {
  it('a status flip produces exactly one event of the right type', async () => {
    const conn = await freshConnection('Sync Flip');
    const first = clone(JOB_FIXTURE);
    await runSyncForConnection(conn, {
      clientFactory: () => stubClient(first, clone(CONTACT_FIXTURE)),
      retryDelaysMs: [],
    });

    const before = await eventsFor(conn.tenantId);

    const flipped = clone(JOB_FIXTURE);
    const openQuote = flipped.find((j) => j.status === 'Quote')!;
    openQuote.status = 'Work Order';
    openQuote.work_order_date = '2026-08-27 04:00:00';
    openQuote.edit_date = '2026-08-27 04:00:01';

    const [row] = await forTenant(conn.tenantId).connection.get();
    const cycle = await runSyncForConnection(
      { ...conn, jobCursor: row.jobCursor, contactCursor: row.contactCursor },
      {
        clientFactory: () => stubClient(flipped, clone(CONTACT_FIXTURE)),
        retryDelaysMs: [],
      },
    );

    expect(cycle.eventsEmitted).toBe(1);

    const after = await eventsFor(conn.tenantId);
    const fresh = after.filter((e) => !before.some((b) => b.id === e.id));

    expect(fresh.length).toBe(1);
    expect(fresh[0].eventType).toBe('won');
    expect(fresh[0].fromStatus).toBe('Quote');
    expect(fresh[0].toStatus).toBe('Work Order');
    expect(fresh[0].sm8JobUuid).toBe(openQuote.uuid);
  });

  it('an active-0 row emits removed exactly once and PRESERVES the quote row', async () => {
    const conn = await freshConnection('Sync Removed');
    await runSyncForConnection(conn, {
      clientFactory: () => stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE)),
      retryDelaysMs: [],
    });

    const deleted = clone(JOB_FIXTURE);
    const target = deleted.find((j) => j.status === 'Quote')!;
    target.active = 0;
    target.edit_date = '2026-08-27 05:00:00';

    const [row] = await forTenant(conn.tenantId).connection.get();
    const cursorState = { jobCursor: row.jobCursor, contactCursor: row.contactCursor };

    const removal = await runSyncForConnection(
      { ...conn, ...cursorState },
      {
        clientFactory: () => stubClient(deleted, clone(CONTACT_FIXTURE)),
        retryDelaysMs: [],
      },
    );

    expect(removal.eventsEmitted).toBe(1);

    const events = await eventsFor(conn.tenantId);
    const removed = events.filter((e) => e.eventType === 'removed');
    expect(removed.length).toBe(1);
    expect(removed[0].sm8JobUuid).toBe(target.uuid);

    // The row survives, flagged. A deleted job that merely vanished from our
    // mirror would leave nothing to explain why the cadence stopped.
    const stored = await forTenant(conn.tenantId).quotes.list();
    const kept = stored.find((q) => q.sm8JobUuid === target.uuid);
    expect(kept, 'the quote row was deleted rather than flagged').toBeDefined();
    expect(kept!.sm8Active).toBe(false);

    // AND the deletion does not re-announce itself on every subsequent poll.
    const [after] = await forTenant(conn.tenantId).connection.get();
    const repeat = await runSyncForConnection(
      { ...conn, jobCursor: after.jobCursor, contactCursor: after.contactCursor },
      {
        clientFactory: () => stubClient(deleted, clone(CONTACT_FIXTURE)),
        retryDelaysMs: [],
      },
    );

    expect(
      repeat.eventsEmitted,
      'a job deleted upstream keeps returning active: 0 forever — re-emitting ' +
        'removed every five minutes is the bug the edge-not-state rule prevents',
    ).toBe(0);
  });

  it('mirrors job contacts onto their own cursor', async () => {
    const conn = await freshConnection('Sync Contacts');
    await runSyncForConnection(conn, {
      clientFactory: () => stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE)),
      retryDelaysMs: [],
    });

    const contacts = await forTenant(conn.tenantId).quoteContacts.list();
    expect(contacts.length).toBe(CONTACT_FIXTURE.length);

    // The Phase 3/4 recipient data actually landed, rather than a row of nulls.
    const withMobileOrEmail = contacts.filter((c) => c.email || c.mobile || c.phone);
    expect(withMobileOrEmail.length).toBeGreaterThan(0);
    expect(contacts.every((c) => c.contactType !== null)).toBe(true);

    const [row] = await forTenant(conn.tenantId).connection.get();
    const expected = CONTACT_FIXTURE.map((c) => c.edit_date as string).sort().at(-1);
    expect(row.contactCursor).toBe(expected);
  });
});

describe('runSyncForConnection — failure classification (SYNC-04, D-06)', () => {
  it('pauses the connection on the FIRST auth failure and records the cycle', async () => {
    const conn = await freshConnection('Sync Auth Fail');
    const alerts: unknown[] = [];

    const cycle = await runSyncForConnection(conn, {
      clientFactory: () => failingClient('auth_failed'),
      onAlert: (a) => void alerts.push(a),
      retryDelaysMs: [],
    });

    expect(cycle.outcome).toBe('auth_failed');
    expect(cycle.paused).toBe(true);
    expect(alerts.length).toBe(1);

    const [row] = await forTenant(conn.tenantId).connection.get();
    expect(row.pausedAt).not.toBeNull();
    expect(row.statusReason).toBe('auth_failed');

    const runs = await forTenant(conn.tenantId).syncRuns.recent();
    expect(runs.length).toBe(1);
    expect(runs[0].outcome).toBe('auth_failed');
  });

  it('a single transient failure never pauses, and still writes a run row', async () => {
    const conn = await freshConnection('Sync Transient');
    const alerts: unknown[] = [];

    const cycle = await runSyncForConnection(conn, {
      clientFactory: () => failingClient('rate_limited'),
      onAlert: (a) => void alerts.push(a),
      retryDelaysMs: [],
    });

    expect(cycle.outcome).toBe('rate_limited');
    expect(cycle.paused).toBe(false);
    expect(alerts.length).toBe(0);

    const [row] = await forTenant(conn.tenantId).connection.get();
    expect(row.pausedAt).toBeNull();
    expect(row.consecutiveFailures).toBe(1);

    const runs = await forTenant(conn.tenantId).syncRuns.recent();
    expect(runs[0].outcome).toBe('rate_limited');
    expect(
      runs[0].errorDetail,
      'error_detail must be the classified kind — never a stack, a header or a key',
    ).toBe('rate_limited');
  });

  it('a successful cycle clears the failure counter and the alert dedupe', async () => {
    const conn = await freshConnection('Sync Recovery');

    await runSyncForConnection(conn, {
      clientFactory: () => failingClient('rate_limited'),
      retryDelaysMs: [],
    });

    const [failed] = await forTenant(conn.tenantId).connection.get();
    expect(failed.consecutiveFailures).toBe(1);

    await runSyncForConnection(
      { ...conn, consecutiveFailures: failed.consecutiveFailures },
      {
        clientFactory: () => stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE)),
        retryDelaysMs: [],
      },
    );

    const [recovered] = await forTenant(conn.tenantId).connection.get();
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.alertedAt).toBeNull();
    expect(recovered.lastSuccessAt).not.toBeNull();
  });

  it('retries a transient failure in-cycle before recording it', async () => {
    const conn = await freshConnection('Sync Retry');
    let attempts = 0;

    const flaky: Sm8Client = {
      async get(resource, options) {
        attempts++;
        if (attempts === 1) return { ok: false, kind: 'network_error' };
        return stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE)).get(
          resource,
          options,
        );
      },
    };

    const cycle = await runSyncForConnection(conn, {
      clientFactory: () => flaky,
      retryDelaysMs: [0],
    });

    expect(cycle.outcome).toBe('ok');
    expect(attempts).toBeGreaterThan(1);
  });

  it('does not retry an auth failure — a revoked key does not un-revoke', async () => {
    const conn = await freshConnection('Sync No Retry');
    let attempts = 0;

    const client: Sm8Client = {
      async get() {
        attempts++;
        return { ok: false, kind: 'auth_failed', status: 401 };
      },
    };

    await runSyncForConnection(conn, {
      clientFactory: () => client,
      retryDelaysMs: [0, 0],
    });

    expect(attempts).toBe(1);
  });
});

describe('runSyncTick — per-connection isolation (Pitfall 8)', () => {
  it("one client's failure cannot abort the tick for the others", async () => {
    const healthy = await freshConnection('Tick Healthy');
    // A ciphertext this key cannot decrypt: GCM authenticates, so this THROWS
    // rather than yielding garbage — a local failure, not a ServiceM8 one, and
    // therefore the case that would take the whole loop down with it.
    const broken: DueConnection = {
      ...(await freshConnection('Tick Broken')),
      apiKeyCiphertext: 'enc:v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCCCCCC',
    };

    const results = await runSyncTick({
      connections: [broken, healthy],
      clientFactory: () => stubClient(clone(JOB_FIXTURE), clone(CONTACT_FIXTURE)),
      retryDelaysMs: [],
    });

    expect(results.length).toBe(2);

    const brokenResult = results.find((r) => r.tenantId === broken.tenantId)!;
    expect(brokenResult.recorded).toBe(false);
    expect(brokenResult.outcome).toBeNull();

    const healthyResult = results.find((r) => r.tenantId === healthy.tenantId)!;
    expect(
      healthyResult.outcome,
      'the healthy client did not sync — one revoked key took the tick down',
    ).toBe('ok');
    expect(healthyResult.jobsUpserted).toBe(JOB_FIXTURE.length);
  });

  it('skips paused connections', async () => {
    // D-06/D-08: a paused connection means we no longer trust what we know
    // about that client's quotes. Polling it would emit transition events
    // computed against state that has been stale since the key was revoked.
    const paused = await freshConnection('Tick Paused');
    await admin
      .from('sm8_connections')
      .update({ paused_at: new Date().toISOString(), status_reason: 'auth_failed' })
      .eq('tenant_id', paused.tenantId);

    const { forAllTenants_syncTick } = await import('@/db/repository');
    const due = await forAllTenants_syncTick();

    expect(due.some((c) => c.tenantId === paused.tenantId)).toBe(false);
  });
});

describe('source guarantees', () => {
  const runSyncSource = readFileSync('src/core/sync/run-sync.ts', 'utf8');

  it('takes the connection-row lock inside the cycle transaction (SYNC-03)', () => {
    // Asserted against the source because the property is an ABSENCE — two
    // overlapping cycles double-emitting — which no single-threaded test can
    // demonstrate reliably.
    expect(runSyncSource).toContain('tx.connection.lock()');

    const forTenantSource = readFileSync('src/db/repository/for-tenant.ts', 'utf8');
    expect(forTenantSource).toContain(".for('update')");
  });

  it('writes only classified kinds into error_detail (T-2-02)', () => {
    // The one column an operator reads that a caught exception could reach.
    expect(runSyncSource).toMatch(/errorDetail:\s*kind/);
    expect(runSyncSource).toMatch(/errorDetail:\s*null/);
    expect(runSyncSource).not.toMatch(/errorDetail:\s*(String\(|`|e\.|err|error\b)/);
  });

  it('keeps event emission out of the backfill path (the plan prohibition)', () => {
    // Structural enforcement: connect.ts cannot emit even by accident, because
    // it has no way to reach the outbox.
    const connectSource = readFileSync('src/core/sync/connect.ts', 'utf8');
    expect(connectSource).not.toContain('quoteStatusEvents');
    expect(connectSource).not.toContain('events.insertMany');
    expect(connectSource).not.toContain('classifyTransition');
  });

  it('keeps the cross-tenant surface to exactly sixteen named exports', () => {
    const source = readFileSync('src/db/repository/for-all-tenants.ts', 'utf8');
    const matches = source.match(/forAllTenants_\w+/g) ?? [];

    // This assertion is a tripwire, not a formality: every name added here is a
    // query that escapes tenant scoping, so growing the list must be a decision
    // someone typed on purpose. It went from two to four in 03-01, and this
    // comment is the record of that decision rather than a number that drifted.
    //
    //   forAllTenants_syncTick    — which connections are due (02-02)
    //   forAllTenants_webhookHint — whose job is this uuid (02-03, SYNC-03).
    //     A webhook arrives unauthenticated with a job uuid and no tenant;
    //     "whose is this?" cannot be asked from inside a scope.
    //   forAllTenants_cadenceTick — whose cadences might have work this minute
    //     (03-01). The same shape of question as the sync tick, one minute apart
    //     instead of five, and it returns window metadata only.
    //   forAllTenants_pendingQuoteEvents — the outbox scan (03-01). See the
    //     next test: this is the one that returns tenant DATA, and it is the
    //     one the quote-events consumption contract explicitly calls for.
    //   forAllTenants_cadencesByContactMobile — whose live cadence has this
    //     mobile (04-01, MSG-03). Four to five, and this comment is the record
    //     of that decision. An inbound SMS arrives carrying a phone number and
    //     NOTHING else — no tenant, no cadence, no job — so it is the same
    //     unaskable-from-inside-a-scope question `forAllTenants_webhookHint`
    //     faces, one channel over. It is the SECOND accessor here that returns
    //     tenant data, and the reason that is acceptable is the same as the
    //     outbox scan's: the question genuinely has no tenant to scope to, the
    //     select list is confined to the columns the threading decision needs,
    //     and everything the caller then DOES with a match runs through
    //     `forTenant(match.tenantId)` via `suppressFromInbound`.
    //   forAllTenants_ids — every tenant id, IDS ONLY (04-02, D-03). Five to
    //     six, and this comment is the record. A STOP from a number matching no
    //     live cadence must still be honoured, and `suppressed_contacts` is
    //     tenant-scoped, so "suppress this bare mobile" has no single row to be:
    //     D-03 chooses to suppress it for every client, because the alternative
    //     is a human who asked to be left alone being chased by whichever client
    //     quotes them next. It is the NARROWEST export here rather than the
    //     widest — it returns a column of primary keys and no tenant data at
    //     all, so unlike its two siblings there is nothing in the result a
    //     caller could render or leak, and growing it into a dashboard query
    //     would require changing its return type.
    //   forAllTenants_ledgerOwners — whose send is this ledger id (04-04,
    //     T-4-18). Six to seven, and this comment is the record. It is the first
    //     cross-tenant read of `send_ledger`, a table this file's header
    //     previously listed as having none, so it is a REVERSAL and is recorded
    //     as one. What changed: the reconciliation sweep polls ClickSend's own
    //     message history, a history row echoes back the `custom_string` we
    //     generated (a `send_ledger.id`) and carries no tenant, and turning "the
    //     provider refused this because the recipient opted out" into Spam Act
    //     suppression evidence means asking whose send it was.
    //
    //     It is KEYED, not filtered — no date range, no tenant list, no "recent
    //     sends" arm, and an empty id list returns nothing rather than
    //     everything — so unlike its two data-returning siblings it cannot
    //     enumerate its table at all. A caller must already hold primary keys it
    //     could only have learned from the provider echoing back ids we made.
    //
    // ── PHASE 6 ADDED FIVE, SEVEN TO TWELVE ────────────────────────────────
    //
    // The tripwire fired exactly as designed and the widening was RATIFIED
    // (2026-09-02) rather than absorbed. Each entry below is the record of one
    // decision, in the established form: what it asks, why that question has no
    // tenant scope to be asked from, and what contains it.
    //
    //   forAllTenants_approvalQueue — what must I approve next, ACROSS EVERYONE
    //     (06-01, CON-01, T-6-02). Seven to eight. The operator's question is an
    //     ORDERING over every client's due touches (D-01), and an ordering
    //     cannot be assembled from N scoped reads without either fetching
    //     everything anyway or capping per tenant — which would push a client
    //     with fifteen due drafts behind a client with one. Contained by a
    //     pinned select list, by a deliberate refusal to join `tenants` (its
    //     consumer is a PAGE, which must learn a client name only from the
    //     operator's own JWT under RLS), and by being consumed solely from the
    //     requireOperator-gated page.
    //   forAllTenants_claimNewlyStalled — who is about to miss a slot (06-02,
    //     CON-04, T-6-05/T-6-08). Eight to nine. Same shape of question as the
    //     cadence tick, and one alert covering every client is the whole point:
    //     fifteen emails a minute is the trained blindness D-11 forbids.
    //     Contained by being a guarded UPDATE with RETURNING that writes exactly
    //     two columns — `stall_alerted_at` and `updated_at`, never `status`,
    //     `skip_reason` or `scheduled_at`, because an aging pass that also moved
    //     a touch would be a second schedule authority quietly disagreeing with
    //     the first.
    //   forAllTenants_stalledTally — the 06:30 digest's per-tenant roll-up
    //     (06-02). Nine to ten. COUNTS ONLY, grouped in SQL, bounded by the
    //     number of tenants rather than of touches: an operator with 400 stalled
    //     drafts gets fifteen lines and one true total. It joins `tenants` for a
    //     name where the queue accessor refuses to, on the split 06-02 drew —
    //     this consumer is a tick that holds the service-role key by
    //     construction, renders nothing, and puts the name in an email addressed
    //     to the operator alone.
    //   forAllTenants_latestAttestations — every client's latest evidence
    //     instant for one kind (06-04, ONB-04, T-6-12). Ten to eleven. Reads an
    //     append-only table and applies NO staleness predicate on purpose: a
    //     `WHERE attested_at < now() - interval '30 days'` here would be a
    //     SECOND reading of `ATTESTATION_STALE_DAYS`, one in Postgres and one in
    //     `isAttestationStale`, agreeing until somebody changed the threshold
    //     and found only one of them. The whole return surface is an id, a name
    //     and a timestamp.
    //   forAllTenants_hotUnescalated — which hot replies have not been
    //     escalated yet (06-05, CON-03, T-6-16/T-6-19). Eleven to twelve. A hot
    //     reply is found by scanning `inbound_messages`, which has no tenant
    //     scope to run inside — the same unaskable-from-inside-a-scope question
    //     `forAllTenants_cadencesByContactMobile` faces, one pass further on.
    //     Contained by a CLOSED narrow predicate (`is_hot` AND
    //     `attribution = 'threaded'` AND no `escalations` row, which cannot be
    //     widened into "recent replies" without editing the function), a pinned
    //     select list that omits `raw_payload`, `from_address`, `label` and
    //     every delivery column, NO join to `tenants`, and an escalation pass
    //     whose every write goes through the keyed `escalations` family under a
    //     UNIQUE claim.
    //
    // ── PHASE 7 ADDED ONE, TWELVE TO THIRTEEN ──────────────────────────────
    //
    //   forAllTenants_reportMetrics — which client is drifting (07-05, RPT-03,
    //     T-7-23). Twelve to thirteen, and this comment is the record of that
    //     decision. WHAT IT ASKS: every client's rolling-30-day counts — quotes
    //     opened and first-touched inside the service level, cadences touched
    //     and replied to, contacts messaged and opted out, drafts approved and
    //     edited, cents attributed, escalation latencies, and the fee schedule.
    //     WHY IT HAS NO TENANT SCOPE: the question is ABOUT the set of clients
    //     ("who is drifting"), and there is no client to scope it to until it
    //     has been answered — the `forAllTenants_approvalQueue` argument with
    //     counts instead of an ordering. Asked per tenant it is fifteen clients
    //     × five metrics = seventy-five round trips to render one table.
    //
    //     WHAT CONTAINS IT: counts, sums, fee rows, a client name and an IANA
    //     zone — nothing else is in a select list. The customer ADDRESS is
    //     compared inside the statement (the opt-out numerator must be a subset
    //     of the contacts we messaged, A6) and never selected; the suite
    //     `tests/report-metrics.test.ts` asserts both halves — no select list
    //     yields an address value, and the stringified result carries no `@`
    //     and no `+61`. It references NO `quotes.*` and NO `cadences.*`, because
    //     first-touch is derived from `quote_status_events` (D-18) rather than
    //     from cadence rows, so the Phase 6 cadence pins below are untouched by
    //     it. Consumed by exactly two callers: the `requireOperator()`-gated
    //     `/reports` page and the 06:30 cron digest.
    //
    //     IT JOINS `tenants` FOR A NAME (U-10), on the split 06-02 drew for the
    //     aging pair rather than on the queue accessor's refusal: both consumers
    //     hold the service-role key by construction, and the digest is a cron
    //     route with no JWT that could resolve a name any other way. A second
    //     name-bearing export would have made this list fourteen to say the same
    //     thing twice.
    //
    //     AND IT WRITES NOTHING. A metric NAGS (D-16): the >5% opt-out alarm is
    //     a badge and one digest line. Nothing on this path pauses a cadence,
    //     stops a tenant or records a suppression.
    //
    // ── PHASE 10 ADDED ONE, THIRTEEN TO FOURTEEN ───────────────────────────
    //
    //   forAllTenants_armedBySmsGlobal — who does this tap start messaging for
    //     (10-03, ARM-02). Thirteen to fourteen, and this comment is the record
    //     of that decision. WHAT IT ASKS: which CONNECTED clients have no sms
    //     `messaging_config` row of their own — the set the shared row governs,
    //     because a client with a row of their own is governed by THAT row, on
    //     or off. WHY IT HAS NO TENANT SCOPE: the shared row belongs to nobody,
    //     so the set it governs spans tenants by definition; the client page
    //     offering the tap shows exactly one client's name, and "arms SMS for
    //     every connected client" is a true sentence an operator can read as
    //     "arms this plumber". Naming them is what makes the claim checkable.
    //
    //     WHAT CONTAINS IT: IDS AND NAMES ONLY — no connection metadata, no key
    //     last-4, no config column, because its consumer is one warning sentence
    //     read between two taps and repeated in the receipt after the write. It
    //     reaches `messaging_config` as a NOT EXISTS predicate and selects
    //     nothing from it (see the table set below). Both callers are behind the
    //     operator gate: the `requireOperator()`-gated client page and
    //     `armChannelAction`, which calls `requireOperatorId()` before it reads
    //     a byte of the body. Bounded by the number of TENANTS, so no cap.
    //
    //     AND IT WRITES NOTHING. The write it informs — the flip and its audit
    //     row — goes through `armChannel`, in one transaction, from the
    //     messaging-config file.
    //
    // ── PHASE 11 ADDED TWO, FOURTEEN TO SIXTEEN ────────────────────────────
    //
    //   forAllTenants_divertNumberByE164 — whose Backdesk number is this `To`?
    //     (11-01, CAP-03/D-02). The `forAllTenants_webhookHint` question one
    //     provider over: a diverted call arrives carrying the number it was
    //     dialled on and nothing else, so the tenant IS the answer and cannot be
    //     the scope. KEYED ON THE CALLED NUMBER ONLY — never ForwardedFrom,
    //     which is carrier-dependent evidence, not identity. `number_e164` is
    //     UNIQUE and the predicate is `status = 'active'`, so `LIMIT 1` needs no
    //     ORDER BY to be deterministic.
    //
    //   forAllTenants_activeDivertNumbers — every active number and its owner
    //     (11-01 declares it; the 11-02 reconcile consumes it). The owner map one
    //     paged Twilio call-log read is matched against — the
    //     `forAllTenants_ledgerOwners` posture — rather than a provider round
    //     trip per client. Bounded by the number of TENANTS (one number each).
    //
    //     WHAT CONTAINS BOTH: a divert-number id, the number, a spoken name and
    //     the four contact-window columns. No caller number, no quote, no
    //     cadence. They join `tenants` for the window on the 06-02 split — the
    //     consumers are a service-role webhook and a service-role cron pass,
    //     neither of which renders anything — and the after-hours flag must be
    //     computed from the window in force at arrival, from ONE read, because
    //     the greeting may not wait on a second round trip (D-03, rule R3).
    //
    //     AND THEY WRITE NOTHING. Every write a diverted call can cause goes
    //     through the tenant-less `missed-calls` family, keyed on the
    //     `(provider, provider_call_id)` arbiter.
    const expected = [
      'forAllTenants_syncTick',
      'forAllTenants_webhookHint',
      'forAllTenants_cadenceTick',
      'forAllTenants_pendingQuoteEvents',
      'forAllTenants_cadencesByContactMobile',
      'forAllTenants_ids',
      'forAllTenants_ledgerOwners',
      'forAllTenants_approvalQueue',
      'forAllTenants_claimNewlyStalled',
      'forAllTenants_stalledTally',
      'forAllTenants_latestAttestations',
      'forAllTenants_hotUnescalated',
      'forAllTenants_reportMetrics',
      'forAllTenants_armedBySmsGlobal',
      'forAllTenants_divertNumberByE164',
      'forAllTenants_activeDivertNumbers',
    ];

    expect(new Set(matches)).toEqual(new Set(expected));
    for (const name of expected) {
      expect(source).toContain(`export async function ${name}`);
    }

    // THE NARROWNESS IS ASSERTED, NOT PROMISED. `forAllTenants_ids` is the one
    // accessor here with no tenant scope AND no filter of any kind — it returns
    // every client this service has. Its select list is pinned to the primary
    // key so that adding `tenants.name` "for a nicer log line" is a test
    // failure rather than a cross-tenant read of the client list.
    //
    // THE SLICE IS BOUNDED TO THE FUNCTION, which it was not before Phase 6.
    // It ran to end-of-file, which was harmless while `forAllTenants_ids` was
    // the last accessor and became wrong the moment five followed it: two of
    // them (`stalledTally`, `latestAttestations`) read `tenants.name` under
    // their own recorded decisions above, so an EOF slice asserts about THEIR
    // bodies rather than about this one. The narrowness rule is unchanged — the
    // extent it is asserted over is what was wrong.
    const idsBody = source.slice(
      source.indexOf('export async function forAllTenants_ids'),
      source.indexOf('export async function forAllTenants_ledgerOwners'),
    );
    expect(idsBody).toContain('select({ id: tenants.id })');
    expect(idsBody).not.toMatch(/tenants\.(?!id\b)[a-z]/);

    // AND THE LEDGER READER'S SELECT LIST IS PINNED FOR THE SAME REASON (04-04).
    // The difference between "whose send is this" and a cross-tenant read of
    // every message this service has ever sent is nothing but the length of a
    // select list. `to_address` is a customer's mobile; the delivery columns and
    // `provider_message_id` are the receipt evidence. None of them is an
    // ownership answer, and none may be added here without editing this line.
    //
    // BOUNDED FOR THE SAME REASON, and 07-05 is why it had to be: an
    // end-of-file slice USED to pass by luck, because no accessor after
    // `forAllTenants_ledgerOwners` referenced `sendLedger`. One does now —
    // `forAllTenants_reportMetrics` reads the ledger for its reply and contact
    // counts and compares `to_address` inside a predicate — and an unbounded
    // slice would have quietly absorbed those references into what this
    // assertion allows. A pin that holds by luck is precisely the
    // caller-dependent guarantee this codebase already named and stopped
    // accepting.
    const ownersBody = source.slice(
      source.indexOf('export async function forAllTenants_ledgerOwners'),
      source.indexOf('export async function forAllTenants_approvalQueue'),
    );
    const ledgerRefs = new Set(ownersBody.match(/sendLedger\.\w+/g) ?? []);
    expect(ledgerRefs).toEqual(
      new Set(['sendLedger.id', 'sendLedger.tenantId', 'sendLedger.cadenceId', 'sendLedger.outcome']),
    );
  });

  it('reaches exactly nineteen tables from the cross-tenant file, and no more', () => {
    const source = readFileSync('src/db/repository/for-all-tenants.ts', 'utf8');

    // ── WHY THE IMPORT LIST IS THE ASSERTION ────────────────────────────────
    //
    // Earlier this test banned two identifiers by substring, which was fine
    // while the answer was "no outbox access at all" and stopped meaning
    // anything the moment the header prose had to NAME the tables it excludes.
    // The import block is the file's true reachability surface: a table that is
    // not imported cannot be queried, whatever the comments say. Adding one
    // requires editing this line, which is the point.
    // `[^}]*` rather than `[\s\S]*?`: a lazy any-character match starts at the
    // FIRST `import {` in the file (drizzle-orm's) and runs through to the
    // schema import's closing brace, swallowing both lists into one.
    const importBlock = source.match(/import \{([^}]*)\} from '@\/db\/schema';/)?.[1];
    expect(importBlock, 'the schema import block moved or changed shape').toBeDefined();

    const imported = new Set(
      importBlock!
        .split(',')
        .map((entry) => entry.trim().replace(/^type\s+/, ''))
        .filter(Boolean),
    );

    expect(
      imported,
      'A new table became reachable from the cross-tenant file. Every table ' +
        'here is one a query can read WITHOUT a tenant scope, and every one of ' +
        'them is reachable for exactly one recorded reason written beside it. ' +
        'Adding a table needs the same argument typed out: which question has ' +
        'no tenant to be asked from, which single accessor reaches it, and ' +
        'what bounds what that accessor may return. An accessor added "just ' +
        'for a dashboard" is how the scoping erodes.',
    ).toEqual(
      new Set([
        'cadenceSettings',
        // ADDED IN 04-01, and this line is where the argument for it lives.
        //
        // `cadences` was previously named in this test's own failure message as
        // a table that "must stay" per-tenant, so widening it is a reversal and
        // is recorded as one. What changed is that an inbound SMS gave us a
        // question with no tenant in it: a reply carries a phone number and
        // nothing else, and `forAllTenants_cadencesByContactMobile` is the only
        // way to ask whose live cadence that number belongs to.
        //
        // The narrow rule the header states, and the next assertion enforces:
        // this table may be reached ONLY by that one accessor, whose select list
        // is the eight columns the threading decision needs. Nothing here may
        // read cadences across tenants for the console, for a dashboard, or for
        // a count — those are all reachable through `forTenant(id).cadences`.
        'cadences',
        // ADDED IN PHASE 6, and this line is where the argument for it lives.
        //
        // A REVERSAL, and the sharpest one here: `cadence_touches` was named in
        // this test's OWN failure message (just above) as a table that "must
        // stay" per-tenant, and that sentence has been rewritten rather than
        // left standing while the set below contradicts it.
        //
        // What changed is two questions that have no tenant to be asked from.
        // 06-01: the approval queue is an ORDERING over every client's due
        // touches, and an ordering cannot be assembled from N scoped reads.
        // 06-02: "who is about to miss a slot" is the same shape of question as
        // the cadence tick, and the answer is one covering alert rather than
        // fifteen.
        //
        // The narrow rule: reached only by `forAllTenants_approvalQueue` (pinned
        // select list, no join to `tenants`) and `forAllTenants_claimNewlyStalled`
        // (a guarded UPDATE writing `stall_alerted_at` and `updated_at` alone).
        // Nothing here may read touches for a dashboard or a count — those are
        // reachable through `forTenant(id)`.
        'cadenceTouches',
        // ADDED IN 06-01 (CON-01). The latest offerable draft per queue row,
        // LEFT-joined so a `needs_draft` touch with no draft row survives — an
        // inner join would silently drop precisely the touches CON-04 alerts
        // about. Reached only by `forAllTenants_approvalQueue`, through a
        // grouped max(attempt) subquery carrying APPROVABLE_DRAFT_STATUSES.
        'touchDrafts',
        // ADDED IN 06-04 (ONB-04). Every client's latest attestation instant for
        // one kind, for the operator console and the digest. Append-only
        // evidence; reached only by `forAllTenants_latestAttestations`, whose
        // whole return surface is an id, a name and a timestamp, and which
        // applies no staleness predicate because `isAttestationStale` is the ONE
        // derivation of that threshold.
        'tenantAttestations',
        // ADDED IN 06-05 (CON-03). The hot-reply scan. `inbound_messages` has no
        // tenant scope at all — a reply arrives carrying a phone number — which
        // is the same reason it already lives outside `forTenant()`. Reached
        // only by `forAllTenants_hotUnescalated`, whose closed predicate and
        // pinned select list omit `raw_payload`, `from_address`, `label` and
        // every delivery column.
        'inboundMessages',
        // ADDED IN 06-05 (CON-03). The already-claimed exclusion join: the
        // escalation pass asks "hot and NOT yet escalated" every minute rather
        // than being handed the rows classification just marked, so a tick that
        // died in the gap costs a minute instead of a customer. Read here only
        // as the anti-join target; every WRITE goes through the keyed
        // `escalations` family under its UNIQUE claim.
        'escalations',
        'quotes',
        'quoteStatusEvents',
        // ADDED IN 04-04, and this line is where the argument for it lives.
        //
        // `send_ledger` was named in this test's own failure message as a table
        // that "must stay" per-tenant, so widening it is a reversal and is
        // recorded as one. What changed: a polled ClickSend history row echoes
        // back a ledger id and carries no tenant, and a provider-side opt-out
        // found that way must become suppression evidence under a real client.
        //
        // The narrow rule: this table may be reached ONLY by
        // `forAllTenants_ledgerOwners`, which is keyed by primary key and whose
        // four-column select list is pinned in the assertion above. Nothing here
        // may read the ledger for the console, for a dashboard, or for a count —
        // all of those are reachable through `forTenant(id).ledger`.
        'sendLedger',
        'sm8Connections',
        'syncRuns',
        'tenants',
        // ── FOUR ADDED IN 07-05 (RPT-03), THIRTEEN TO SEVENTEEN ────────────
        //
        // All four are reached by ONE accessor, `forAllTenants_reportMetrics`,
        // and by nothing else. Its containment is recorded in full in the
        // export tripwire above; each line here is why THIS table has to be
        // readable without a tenant scope for the overview to exist at all.
        //
        // The D-18 onboarding exclusion: the first instant a client's wording
        // was approved. Read as `min(approved_at)` grouped by tenant, joined
        // INNER so a client with no approved templates contributes no quotes at
        // all rather than being defaulted in. No `body`, no `subject`.
        'messageTemplates',
        // The recovery multiple's numerator: `sum(conservative_cents)` over
        // wins detected in the window. Bucketed by the same `won_detected_at`
        // a frozen monthly report uses, so the rolling figure and the invoiced
        // one describe the same events. No evidence chain, no quote id.
        'quoteAttributions',
        // The recovery multiple's denominator. Read WHOLE and unfiltered
        // because `feesInForce` pro-rates by local day and the row usually
        // being charged is one whose `effective_from` predates the window.
        // Five columns, all of them money and dates.
        'tenantFees',
        // ADDED IN 07-05, and it is a REVERSAL: this test's own failure message
        // used to name `suppressed_contacts` as the table that "must stay"
        // per-tenant, and that sentence has been rewritten rather than left
        // standing while the set below contradicts it.
        //
        // What changed is the opt-out RATE (D-16). Its numerator must be
        // restricted to addresses that are in its denominator (A6) — otherwise
        // the Phase 4 D-03 STOP fan-out, which writes a bare STOP into every
        // tenant's list, pushes every client past the alarm threshold in the
        // same minute because one stranger texted the shared number. That
        // restriction is a join between two tenant-scoped tables inside one
        // grouped statement, and it cannot be assembled from N scoped reads
        // without fetching every suppression into node.
        //
        // The narrow rule: reached ONLY by `forAllTenants_reportMetrics`, and
        // only as `count(DISTINCT (channel, address))` plus an EXISTS
        // predicate. The address is COMPARED, never selected. Nothing here may
        // read suppression rows for a console list or an export — those are
        // reachable through `forTenant(id).suppression`.
        'suppressedContacts',
        // ── ONE ADDED IN 10-03 (ARM-02), SEVENTEEN TO EIGHTEEN ─────────────
        //
        // `messaging_config` — read here by ONE accessor,
        // `forAllTenants_armedBySmsGlobal`, and only as a NOT EXISTS predicate
        // on `(channel = 'sms', tenant_id = tenants.id)`. Not a single column
        // of it is selected: the question is whether a client HAS a row of
        // their own, not what that row says.
        //
        // Why it has to be readable without a tenant scope: the shared sms row
        // belongs to nobody, so "which clients does arming it start messaging
        // for" is a question about the set of clients and cannot be posed from
        // inside one client's scope. The blast radius is the answer, and a
        // warning that cannot state it is a warning an operator reads as being
        // about the one client whose page they are on.
        //
        // The narrow rule: this table is reached here for that predicate alone.
        // Every READ of what a row says, and every WRITE to one, goes through
        // `src/db/repository/messaging-config.ts` — where the arm/disarm
        // writers put the flip and its audit row in one transaction. An
        // accessor here that returned `enabled`, a from-address or a business
        // name would be a second reading of the activation rule, which is the
        // 04-08 CR-01 defect with a different spelling.
        'messagingConfig',
        // ── ONE ADDED IN 11-01 (CAP-03), EIGHTEEN TO NINETEEN ──────────────
        //
        // `tenant_divert_numbers` — reached by exactly two accessors,
        // `forAllTenants_divertNumberByE164` (the voice webhook's one read) and
        // `forAllTenants_activeDivertNumbers` (the reconcile's owner map).
        //
        // Why it has to be readable without a tenant scope: a diverted call
        // arrives carrying the number it was dialled on and no tenant, so
        // "whose number is this" is the webhookHint question — the tenant is
        // the answer, not the scope. Both accessors select an id, the number,
        // the spoken name and the contact window, and neither writes: every
        // write to this table (claim, activate, fail, rename — and NO delete,
        // D-08) goes through `forTenant(id).divertNumber`.
        'tenantDivertNumbers',
        'QuoteStatusEvent',
        // A TYPE, not a table — the parser above strips the `type ` prefix, so
        // it lands in this set beside `QuoteStatusEvent`. It carries no
        // reachability of its own: it is the kind argument
        // `forAllTenants_latestAttestations` is parameterized on (06-04).
        'TenantAttestationKind',
      ]),
    );

    // The webhook resolver reads `quotes`, which is tenant data, so the rule the
    // file's header states needs an assertion rather than a promise.
    //
    // THE OLD RULE HERE WAS "no quote column may be selected", `quotes`
    // appearing only as a join target and a uuid predicate. PHASE 6 REVERSED
    // IT, and this pin is what keeps the reversal a typed decision rather than a
    // drift: exactly two more accessors now select quote columns, each through
    // its own pinned select list — `forAllTenants_approvalQueue` (06-01) needs
    // enough of the quote for an operator to recognise which job a draft is
    // about, and `forAllTenants_hotUnescalated` (06-05) needs it for the text
    // that reaches the tradie.
    //
    // The containment is no longer "none" but "exactly these five", which is the
    // same move `cadenceRefs` made in 04-01 for the same reason: once a table IS
    // selected from, the difference between a lookup and a cross-tenant
    // dashboard query is nothing but the length of a select list. A sixth column
    // fails here.
    const quoteRefs = new Set(source.match(/quotes\.\w+/g) ?? []);
    expect(quoteRefs).toEqual(
      new Set([
        'quotes.tenantId',
        'quotes.sm8JobUuid',
        'quotes.id',
        'quotes.generatedJobId',
        'quotes.jobDescription',
      ]),
    );

    // ── `cadences` GETS THE SAME TREATMENT, AND IT NEEDS IT MORE (04-01) ────
    //
    // Unlike `quotes`, this table IS selected from here — `forAllTenants_
    // cadencesByContactMobile` returns cadence rows across every client. So the
    // containment cannot be "no columns"; it has to be "exactly these columns",
    // pinned, because the difference between a threading lookup and a
    // cross-tenant dashboard query is nothing but the length of a select list.
    //
    // Read from ONE accessor and never joined, for the same reason the outbox
    // is not joined below: a join would let cadence rows drag `quotes`,
    // `cadence_touches` or `send_ledger` columns across the tenant boundary with
    // them, which is the actual leak this file guards.
    //
    // The pattern matches the drizzle CAMEL-CASE property form only, so prose
    // naming a snake_case column (`contact_mobile`) does not register as a read.
    // A reference in a comment is not reachability, and an assertion that
    // counted one would be gamed by rewording rather than by rewriting a query.
    //
    // ── 12-03 ADMITTED ONE COLUMN, `leadId`, AND THIS IS THE RECORD ────────
    //
    // Phase 12 D-04: a reply to an instant text-back threads to a `kind='lead'`
    // cadence, which has no quote. The inbound row records the lead beside the
    // cadence exactly as it records `quoteId` for a quote cadence, so `leadId`
    // IS the threading decision for that cadence — the same role, the same kind
    // of value (an opaque uuid, no client data). Nothing else was admitted: the
    // cadence's `kind` is implied by which of the two ids is set and is not
    // selected. First caught by CI on the 12-03 throwaway branch.
    const cadenceRefs = new Set(source.match(/cadences\.[a-z][a-zA-Z]*\b/g) ?? []);
    expect(
      cadenceRefs,
      'The cross-tenant cadence read grew a column. It exists to answer "whose ' +
        'live cadence has this mobile?" for an inbound reply, and every column ' +
        'beyond the threading decision is a client\'s data leaving its scope.',
    ).toEqual(
      new Set([
        'cadences.tenantId',
        'cadences.id',
        'cadences.quoteId',
        'cadences.leadId',
        'cadences.status',
        'cadences.pauseReason',
        'cadences.contactMobile',
        'cadences.contactEmail',
        'cadences.contactName',
        'cadences.createdAt',
      ]),
    );

    const cadenceReads = source.match(/\.from\(cadences\)/g) ?? [];
    expect(
      cadenceReads,
      'cadences must be read from exactly one cross-tenant accessor',
    ).toHaveLength(1);

    // ── THE JOIN BAN WAS REVERSED IN PHASE 6, AND IS NOW A PINNED COUNT ─────
    //
    // This line used to read `not.toMatch(/Join\(\s*cadences/)`. Two accessors
    // now join `cadences` and both do it because their starting table has no
    // tenant in it: `forAllTenants_approvalQueue` reaches cadences FROM
    // `cadence_touches` (06-01), and `forAllTenants_hotUnescalated` reaches it
    // FROM `inbound_messages` (06-05), which is the table that has no tenant
    // scope at all. Neither could ask its question from the cadence side.
    //
    // What the ban used to provide — "a join cannot drag columns across the
    // boundary" — now lives in the pinned column-ref sets asserted in this test
    // (`cadenceRefs` above, `quoteRefs` below) plus each accessor's own pinned
    // select list. So a THIRD join fails here, and a widened select through
    // either existing join fails there. The containment moved; it did not go.
    const cadenceJoins = source.match(/Join\(\s*cadences/g) ?? [];
    expect(
      cadenceJoins,
      'A third cross-tenant join to cadences appeared. Two are recorded ' +
        'decisions (06-01 approval queue, 06-05 hot-reply escalation); a new ' +
        'one needs the same argument written down.',
    ).toHaveLength(2);

    // ── THE OUTBOX IS THE ONE DELIBERATE EXCEPTION, AND IT IS NARROW ────────
    //
    // `forAllTenants_pendingQuoteEvents` returns whole event rows across every
    // client. That is not a hole in the rule — it is the rule the outbox itself
    // writes down: "Read your cursor … WHERE consumer = 'cadence-engine' …
    // SELECT * FROM quote_status_events WHERE id > $cursor ORDER BY id". A
    // single ordered stream is the design; per-tenant cursors could not answer
    // "have I processed everything up to id N".
    //
    // What kept it narrow used to be "ONE read, and never joined to anything".
    //
    // ── 07-05 MADE IT TWO, AND THIS IS THE RECORD OF THAT DECISION ─────────
    //
    // `forAllTenants_reportMetrics` reads the outbox a second time, for the
    // D-18 first-touch DENOMINATOR: "how many quotes were opened in the window"
    // is a question about `quote_opened` EVENTS, and asking it of `cadences`
    // instead would have added cadence column references to this file — the
    // pins directly above are stronger than this one, and the choice was to
    // keep them intact.
    //
    // It also JOINS, which the old rule forbade outright. The reason the ban
    // existed was that "a join would let the events drag `quotes` or `cadences`
    // columns across the tenant boundary with them" — so the containment moved
    // to naming what may be dragged, exactly as `cadenceRefs` and `quoteRefs`
    // did when their own bans were reversed. The second read joins
    // `send_ledger` (was touch 1 claimed inside the service level) and two
    // grouped subqueries over `message_templates` / `tenant_attestations` (the
    // onboarding exclusion). It touches no quote and no cadence column, and its
    // whole select list is a tenant id and two `count(DISTINCT …)::int`
    // aggregates — asserted below rather than promised.
    const outboxReads = source.match(/\.from\(quoteStatusEvents\)/g) ?? [];
    expect(
      outboxReads,
      'A third cross-tenant read of the outbox appeared. Two are recorded ' +
        'decisions (03-01 the consumer stream, 07-05 the first-touch ' +
        'denominator); a new one needs the same argument written down.',
    ).toHaveLength(2);
    expect(source).not.toMatch(/Join\(\s*quoteStatusEvents/);

    // THE SECOND READER'S EVENT COLUMNS ARE PINNED, for the reason every other
    // reversal in this file is pinned: once a table is read from twice, the
    // difference between a denominator and a cross-tenant event feed is nothing
    // but the length of a select list. Five references, none of them a value
    // that reaches a caller — `id` is counted, `tenant_id` is grouped by, and
    // the other three are predicates.
    const metricsBody = source.slice(
      source.indexOf('export async function forAllTenants_reportMetrics'),
    );
    const metricsEventRefs = new Set(metricsBody.match(/quoteStatusEvents\.\w+/g) ?? []);
    expect(metricsEventRefs).toEqual(
      new Set([
        'quoteStatusEvents.tenantId',
        'quoteStatusEvents.id',
        'quoteStatusEvents.quoteId',
        'quoteStatusEvents.detectedAt',
        'quoteStatusEvents.eventType',
      ]),
    );

    // ORDER BY `id`, never a timestamp — the contract is explicit that
    // `detected_at` ties across a batch and `occurred_at` can move backwards.
    expect(source).toContain('.orderBy(quoteStatusEvents.id)');
  });
});
