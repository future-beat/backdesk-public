/**
 * SYNC-02: the outbox as Phase 3 will actually consume it.
 *
 * The contract documented in src/db/schema/quote-events.ts is only worth what a
 * test proves, so this suite exercises the three claims a consumer depends on
 * and cannot verify for itself:
 *
 *   1. An event carries the ServiceM8 timestamp of when the thing HAPPENED,
 *      not merely when we noticed. Attribution in Phase 7 asks "when was this
 *      job won", and `detected_at` cannot answer it.
 *   2. A cursor scan past `event_consumer_cursors.last_event_id` returns
 *      exactly the new events, in detection order.
 *   3. A cycle that fails to parse writes NOTHING but a classified run row.
 *      "No partial writes" is a promise the cadence engine relies on to know
 *      that a quote row and the event announcing it always agree.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sm8Client } from '@/core/servicem8/types';
import { decodeEncryptionKey, encryptCredential } from '@/core/shared/crypto';
import { runSyncForConnection } from '@/core/sync/run-sync';
import { closeDb, forTenant, type DueConnection } from '@/db/repository';

import {
  admin,
  ensureOperatorAllowlisted,
  seedConnection,
  seedQuotes,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const JOB_FIXTURE = JSON.parse(
  readFileSync('tests/fixtures/sm8/job.json', 'utf8'),
) as Array<Record<string, unknown>>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function stubClient(jobs: unknown[], contacts: unknown[] = []): Sm8Client {
  return {
    async get(resource) {
      const rows = resource.startsWith('jobcontact') ? contacts : jobs;
      return { ok: true, data: { rows, headers: new Headers() } };
    },
  };
}

const tenants: string[] = [];
const consumers: string[] = [];

async function freshConnection(prefix: string): Promise<DueConnection> {
  const tenantId = await seedTenant(prefix);
  tenants.push(tenantId);

  const key = decodeEncryptionKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
  await seedConnection(tenantId, {
    api_key_ciphertext: encryptCredential('fixture-api-key', key),
    key_last4: 'ture',
  });

  const [row] = await forTenant(tenantId).connection.get();

  return {
    tenantId,
    tenantName: prefix,
    tenantTimezone: 'Australia/Perth',
    apiKeyCiphertext: row.apiKeyCiphertext,
    jobCursor: null,
    contactCursor: null,
    consecutiveFailures: 0,
    alertedAt: null,
  };
}

beforeAll(() => {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error('These suites need CREDENTIALS_ENCRYPTION_KEY — see docs/env-vars.md');
  }
});

afterAll(async () => {
  if (consumers.length > 0) {
    await admin.from('event_consumer_cursors').delete().in('consumer', consumers);
  }
  await teardownTenants(tenants);
  await closeDb();
});

describe('quote_status_events — occurred_at (SYNC-02)', () => {
  it('takes occurred_at from work_order_date for a win, not from our clock', async () => {
    const conn = await freshConnection('Events Won');
    const openOnly = clone(JOB_FIXTURE).filter((j) => j.status === 'Quote');

    await runSyncForConnection(conn, {
      clientFactory: () => stubClient(openOnly),
      retryDelaysMs: [],
    });

    const won = clone(openOnly);
    won[0].status = 'Work Order';
    won[0].work_order_date = '2026-08-20 03:15:00';
    won[0].edit_date = '2026-08-27 06:00:00';

    const [row] = await forTenant(conn.tenantId).connection.get();
    await runSyncForConnection(
      { ...conn, jobCursor: row.jobCursor },
      { clientFactory: () => stubClient(won), retryDelaysMs: [] },
    );

    const events = await forTenant(conn.tenantId).events.since(0);
    const winEvent = events.find((e) => e.eventType === 'won')!;

    expect(winEvent, 'no won event was emitted').toBeDefined();
    // ServiceM8 timestamps are UTC (measured, A3) — so the instant is the
    // literal read as UTC. Note it is a WEEK before detection: an event that
    // reported `detected_at` here would make "when did the tradie win it"
    // unanswerable, which is the question the recovered-revenue report asks.
    expect(winEvent.occurredAt?.toISOString()).toBe('2026-08-20T03:15:00.000Z');
    expect(winEvent.detectedAt.getTime()).toBeGreaterThan(winEvent.occurredAt!.getTime());
  });

  it('leaves occurred_at null for a removal rather than inventing one', async () => {
    const conn = await freshConnection('Events Removed');
    const openOnly = clone(JOB_FIXTURE).filter((j) => j.status === 'Quote');

    await runSyncForConnection(conn, {
      clientFactory: () => stubClient(openOnly),
      retryDelaysMs: [],
    });

    const deleted = clone(openOnly);
    deleted[0].active = 0;
    deleted[0].edit_date = '2026-08-27 07:00:00';

    const [row] = await forTenant(conn.tenantId).connection.get();
    await runSyncForConnection(
      { ...conn, jobCursor: row.jobCursor },
      { clientFactory: () => stubClient(deleted), retryDelaysMs: [] },
    );

    const events = await forTenant(conn.tenantId).events.since(0);
    const removal = events.find((e) => e.eventType === 'removed')!;

    expect(removal).toBeDefined();
    // ServiceM8 records no deletion timestamp. Saying "we don't know" is more
    // useful to Phase 7 than a plausible-looking value that means "when we ran".
    expect(removal.occurredAt).toBeNull();
  });
});

describe('quote_status_events — the consumer cursor contract', () => {
  it('a scan past last_event_id returns exactly the new events, in id order', async () => {
    const conn = await freshConnection('Events Cursor');
    const openOnly = clone(JOB_FIXTURE).filter((j) => j.status === 'Quote');

    await runSyncForConnection(conn, {
      clientFactory: () => stubClient(openOnly),
      retryDelaysMs: [],
    });

    const firstBatch = await forTenant(conn.tenantId).events.since(0);
    expect(firstBatch.length).toBe(openOnly.length);

    // Register a consumer exactly as Phase 3 will: no row is seeded by the
    // schema, because a pre-seeded cursor would let a consumer that has never
    // run appear to be caught up.
    const consumer = `test-consumer-${Date.now()}`;
    consumers.push(consumer);

    const lastSeen = firstBatch.at(-1)!.id;
    const registered = await admin
      .from('event_consumer_cursors')
      .insert({ consumer, last_event_id: lastSeen })
      .select('consumer,last_event_id');
    expect(registered.error).toBeNull();

    // Two more transitions, in a known order.
    const changed = clone(openOnly);
    changed[0].status = 'Work Order';
    changed[0].work_order_date = '2026-08-27 08:00:00';
    changed[0].edit_date = '2026-08-27 08:00:01';
    changed[1].status = 'Unsuccessful';
    changed[1].unsuccessful_date = '2026-08-27 08:05:00';
    changed[1].edit_date = '2026-08-27 08:05:01';

    const [row] = await forTenant(conn.tenantId).connection.get();
    await runSyncForConnection(
      { ...conn, jobCursor: row.jobCursor },
      { clientFactory: () => stubClient(changed), retryDelaysMs: [] },
    );

    const { data: cursorRow } = await admin
      .from('event_consumer_cursors')
      .select('last_event_id')
      .eq('consumer', consumer)
      .single();

    const fresh = await forTenant(conn.tenantId).events.since(cursorRow!.last_event_id);

    expect(fresh.length).toBe(2);
    expect(fresh.map((e) => e.eventType).sort()).toEqual(['lost', 'won']);

    // Ordered on `id`, which is monotonic. A batch written in one transaction
    // shares a `detected_at` to the microsecond, so ordering on the timestamp
    // would be ordering on a tie.
    expect(fresh[0].id).toBeLessThan(fresh[1].id);
    for (const event of fresh) {
      expect(event.id).toBeGreaterThan(cursorRow!.last_event_id);
    }

    // And the already-consumed events are NOT re-delivered.
    expect(fresh.some((e) => firstBatch.some((f) => f.id === e.id))).toBe(false);
  });

  it('keeps the consumer cursor table reachable only through is_operator()', async () => {
    // T-2-08. The table has no tenant_id, so the only thing between it and
    // every authenticated caller is the allowlist. An enrolled operator sees
    // it; the service-role seeding above proves the worker can write it.
    await ensureOperatorAllowlisted();

    const { data, error } = await admin.from('event_consumer_cursors').select('consumer');

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('runSyncForConnection — transactionality (T-2-09)', () => {
  it('a parse failure writes NO quotes and NO events, but DOES write a run row', async () => {
    const conn = await freshConnection('Events Parse Fail');

    // `edit_date` removed: the cursor field, required by the schema because a
    // record that exists always has one. A page containing this row is drift,
    // and drift must not be half-applied.
    const malformed = clone(JOB_FIXTURE).map((job) => {
      const copy = { ...job };
      delete copy.edit_date;
      return copy;
    });

    const cycle = await runSyncForConnection(conn, {
      clientFactory: () => stubClient(malformed),
      retryDelaysMs: [],
    });

    expect(cycle.outcome).toBe('parse_error');

    expect(
      (await forTenant(conn.tenantId).quotes.list()).length,
      'a parse failure wrote quote rows. A partial page looks exactly like a ' +
        'client with fewer quotes than they have, and nothing downstream can tell.',
    ).toBe(0);
    expect((await forTenant(conn.tenantId).events.since(0)).length).toBe(0);

    const runs = await forTenant(conn.tenantId).syncRuns.recent();
    expect(runs.length).toBe(1);
    expect(runs[0].outcome).toBe('parse_error');
    expect(runs[0].errorDetail).toBe('parse_error');

    // Schema drift is not a credential problem: pausing here would send the
    // operator chasing a re-key that changes nothing.
    const [row] = await forTenant(conn.tenantId).connection.get();
    expect(row.pausedAt).toBeNull();
  });

  it('one malformed row fails the whole page rather than importing the rest', async () => {
    const conn = await freshConnection('Events Partial Fail');

    const mixed = clone(JOB_FIXTURE);
    delete mixed[2].edit_date;

    const cycle = await runSyncForConnection(conn, {
      clientFactory: () => stubClient(mixed),
      retryDelaysMs: [],
    });

    expect(cycle.outcome).toBe('parse_error');
    expect((await forTenant(conn.tenantId).quotes.list()).length).toBe(0);
  });
});

describe('the backfill prohibition, behaviourally (SYNC-02)', () => {
  it('never announces a quote that predates the connection', async () => {
    // The structural guarantee is that connect.ts cannot reach the outbox. This
    // is the other half: a quote already mirrored by the backfill, seen again by
    // a poll, must not produce a quote_opened as if it had just arrived.
    // Replaying three months of history into the cadence engine on connect day
    // would fire follow-ups for jobs that closed in June.
    const conn = await freshConnection('Events Backfill');
    const openOnly = clone(JOB_FIXTURE).filter((j) => j.status === 'Quote');

    await seedQuotes(
      conn.tenantId,
      openOnly.map((job) => ({
        sm8_job_uuid: job.uuid as string,
        status: 'Quote',
        edit_date_raw: job.edit_date as string,
        sync_source: 'backfill',
        chase_eligibility: 'needs_review',
      })),
    );

    const cycle = await runSyncForConnection(conn, {
      clientFactory: () => stubClient(openOnly),
      retryDelaysMs: [],
    });

    expect(cycle.outcome).toBe('ok');
    expect(
      cycle.eventsEmitted,
      'a backfilled quote re-announced itself as newly opened',
    ).toBe(0);
    expect((await forTenant(conn.tenantId).events.since(0)).length).toBe(0);
  });

  it("leaves an operator's triage decision untouched when the poll re-sees the row", async () => {
    // D-15, and the reason chase_eligibility is absent from the upsert's
    // conflict set: a quote the operator excluded must never quietly become
    // chaseable again because ServiceM8 edited an address field.
    const conn = await freshConnection('Events Triage');
    const openOnly = clone(JOB_FIXTURE).filter((j) => j.status === 'Quote');

    await seedQuotes(conn.tenantId, [
      {
        sm8_job_uuid: openOnly[0].uuid as string,
        status: 'Quote',
        edit_date_raw: openOnly[0].edit_date as string,
        sync_source: 'backfill',
        chase_eligibility: 'needs_review',
      },
    ]);

    await runSyncForConnection(conn, {
      clientFactory: () => stubClient(openOnly),
      retryDelaysMs: [],
    });

    const stored = await forTenant(conn.tenantId).quotes.list();
    const backfilled = stored.find((q) => q.sm8JobUuid === openOnly[0].uuid)!;
    expect(backfilled.chaseEligibility).toBe('needs_review');

    // The genuinely new one arrives chaseable — nobody has had a chance to
    // mishandle a quote that landed after the client was connected.
    const fresh = stored.find((q) => q.sm8JobUuid === openOnly[1].uuid)!;
    expect(fresh.chaseEligibility).toBe('eligible');
  });
});
