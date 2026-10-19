/**
 * SYNC-04 / D-05 / D-06: exactly one operator email per failure EPISODE.
 *
 * The property under test is a count, and both directions of getting it wrong
 * are expensive in the same way — they both end with the operator not reading
 * the alert:
 *
 *   TOO MANY. A dead key at a five-minute tick is 288 emails a day about one
 *   problem. The operator filters the sender, and the next alert — the one
 *   about a different client — lands in a folder nobody opens.
 *
 *   TOO FEW. An episode that alerted once, recovered, and broke again must
 *   alert again. A dedupe keyed on "have we ever told them about this client"
 *   silences every future failure for that client forever, which is the silent
 *   dead client this whole phase exists to prevent.
 *
 * These run the real cycle against real Postgres — real transaction, real
 * `FOR UPDATE`, real policy — with the ServiceM8 HTTP call stubbed and the
 * alert sink replaced by a SPY. No live email is sent, by construction rather
 * than by an env check: `onAlert` is injected, so the send path is never
 * reached from here.
 *
 * The send path itself is covered by source assertions at the bottom, which is
 * the honest coverage boundary — asserting Resend's API responds correctly
 * would be testing Resend.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  alertBody,
  alertSubject,
  type SyncAlertKind,
} from '@/core/alerts/operator-email';
import type { Sm8Client, Sm8FailureKind } from '@/core/servicem8/types';
import { decodeEncryptionKey, encryptCredential } from '@/core/shared/crypto';
import { runSyncForConnection, type SyncAlert } from '@/core/sync/run-sync';
import { SYNC_OUTCOME_LABELS } from '@/core/sync/outcomes';
import { closeDb, forTenant, type DueConnection } from '@/db/repository';
import { SYNC_OUTCOMES } from '@/db/schema';

import { seedConnection, seedTenant, teardownTenants } from './helpers/seed';

const JOB_FIXTURE = JSON.parse(
  readFileSync('tests/fixtures/sm8/job.json', 'utf8'),
) as Array<Record<string, unknown>>;
const CONTACT_FIXTURE = JSON.parse(
  readFileSync('tests/fixtures/sm8/jobcontact.json', 'utf8'),
) as Array<Record<string, unknown>>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A client that fails every request with one classified kind. */
function failingClient(kind: Sm8FailureKind): Sm8Client {
  return {
    async get() {
      return { ok: false, kind, status: kind === 'auth_failed' ? 401 : 503 };
    },
  };
}

/** A client that answers from the captured live page. */
function okClient(): Sm8Client {
  return {
    async get(resource) {
      const rows = resource.startsWith('jobcontact')
        ? clone(CONTACT_FIXTURE)
        : clone(JOB_FIXTURE);
      return { ok: true, data: { rows, headers: new Headers() } };
    },
  };
}

const tenants: string[] = [];

async function freshConnection(prefix: string): Promise<DueConnection> {
  const tenantId = await seedTenant(prefix);
  tenants.push(tenantId);

  const key = decodeEncryptionKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
  await seedConnection(tenantId, {
    api_key_ciphertext: encryptCredential('fixture-api-key', key),
    key_last4: 'ture',
  });

  return reload(tenantId, prefix);
}

/**
 * Rebuild the cycle's input from what is actually stored.
 *
 * The tick does exactly this every five minutes — it re-reads every connection
 * from Postgres rather than carrying state between cycles — so driving repeat
 * cycles this way is the production shape, not a test convenience.
 */
async function reload(tenantId: string, name: string): Promise<DueConnection> {
  const [row] = await forTenant(tenantId).connection.get();
  return {
    tenantId,
    tenantName: name,
    tenantTimezone: 'Australia/Perth',
    apiKeyCiphertext: row.apiKeyCiphertext,
    jobCursor: row.jobCursor,
    contactCursor: row.contactCursor,
    consecutiveFailures: row.consecutiveFailures,
    alertedAt: row.alertedAt,
  };
}

/** A spy standing in for the mail send. Captures intents, sends nothing. */
function spy() {
  const captured: SyncAlert[] = [];
  return {
    captured,
    onAlert: (alert: SyncAlert) => {
      captured.push(alert);
    },
  };
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

describe('auth failure — pause and alert, once (D-05)', () => {
  it('pauses the connection and fires exactly one auth alert', async () => {
    const conn = await freshConnection('Alert Auth Once');
    const alerts = spy();

    const result = await runSyncForConnection(conn, {
      clientFactory: () => failingClient('auth_failed'),
      retryDelaysMs: [],
      onAlert: alerts.onAlert,
    });

    expect(result.outcome).toBe('auth_failed');
    expect(result.recorded).toBe(true);
    expect(result.paused).toBe(true);

    expect(alerts.captured).toHaveLength(1);
    expect(alerts.captured[0].kind).toBe('auth');
    expect(alerts.captured[0].tenantId).toBe(conn.tenantId);
    // The classified outcome travels with the intent, so the email body never
    // has to reach back for an error object to describe what happened.
    expect(alerts.captured[0].outcome).toBe('auth_failed');

    const [stored] = await forTenant(conn.tenantId).connection.get();
    expect(stored.pausedAt).not.toBeNull();
    expect(stored.statusReason).toBe('auth_failed');
    // Written in the SAME update as paused_at — the pause and the record that
    // we told somebody about it are one fact.
    expect(stored.alertedAt).not.toBeNull();
  });

  it('a SECOND auth-failed cycle re-asserts the pause but sends no second email', async () => {
    // The tick would not reach a paused connection — but that is a property of
    // the tick's WHERE clause, not of the cycle. This asserts the guarantee
    // where it is actually made, so a future third caller cannot reintroduce
    // the flood by simply not filtering first.
    const conn = await freshConnection('Alert Auth Twice');
    const options = {
      clientFactory: () => failingClient('auth_failed'),
      retryDelaysMs: [],
    };

    const first = spy();
    await runSyncForConnection(conn, { ...options, onAlert: first.onAlert });
    expect(first.captured).toHaveLength(1);

    const [afterFirst] = await forTenant(conn.tenantId).connection.get();

    const second = spy();
    const result = await runSyncForConnection(
      await reload(conn.tenantId, 'Alert Auth Twice'),
      { ...options, onAlert: second.onAlert },
    );

    expect(second.captured, 'a dead key must not email once per tick').toHaveLength(0);
    // Still paused, still classified — silence is about the EMAIL, not about
    // the state.
    expect(result.paused).toBe(true);

    const [afterSecond] = await forTenant(conn.tenantId).connection.get();
    expect(afterSecond.pausedAt).not.toBeNull();
    expect(afterSecond.statusReason).toBe('auth_failed');
    // The dedupe stamp is not refreshed either; the episode began when the key
    // died, not when we last noticed it was still dead.
    expect(afterSecond.alertedAt?.getTime()).toBe(afterFirst.alertedAt?.getTime());
    // Two failed cycles were both counted.
    expect(afterSecond.consecutiveFailures).toBe(2);

    const runs = await forTenant(conn.tenantId).syncRuns.recent();
    expect(runs, 'every cycle writes a row, alert or not').toHaveLength(2);
  });
});

describe('transient failures — never pause, alert only at three (D-06)', () => {
  it('two consecutive transient failures alert nobody and pause nothing', async () => {
    const conn = await freshConnection('Alert Transient Two');
    const alerts = spy();
    const options = {
      clientFactory: () => failingClient('server_error'),
      retryDelaysMs: [],
      onAlert: alerts.onAlert,
    };

    await runSyncForConnection(conn, options);
    const second = await runSyncForConnection(
      await reload(conn.tenantId, 'Alert Transient Two'),
      options,
    );

    expect(
      alerts.captured,
      'ten minutes of ServiceM8 being unwell is weather, not an incident',
    ).toHaveLength(0);
    expect(second.paused).toBe(false);

    const [stored] = await forTenant(conn.tenantId).connection.get();
    expect(stored.pausedAt).toBeNull();
    expect(stored.statusReason).toBeNull();
    expect(stored.alertedAt).toBeNull();
    expect(stored.consecutiveFailures).toBe(2);
  });

  it('the third consecutive transient failure fires exactly one degraded alert', async () => {
    const conn = await freshConnection('Alert Transient Three');
    const alerts = spy();
    const options = {
      clientFactory: () => failingClient('rate_limited'),
      retryDelaysMs: [],
      onAlert: alerts.onAlert,
    };

    let current = conn;
    for (let cycle = 0; cycle < 3; cycle++) {
      await runSyncForConnection(current, options);
      current = await reload(conn.tenantId, 'Alert Transient Three');
    }

    expect(alerts.captured).toHaveLength(1);
    expect(alerts.captured[0].kind).toBe('degraded');
    expect(alerts.captured[0].outcome).toBe('rate_limited');

    const [afterThree] = await forTenant(conn.tenantId).connection.get();
    expect(afterThree.alertedAt).not.toBeNull();
    // Degraded is an alert, not a pause: the cadence keeps running on the state
    // we already have while somebody looks at it.
    expect(afterThree.pausedAt).toBeNull();

    // A fourth and fifth failing cycle must stay silent — this is the 288
    // emails a day case.
    await runSyncForConnection(current, options);
    await runSyncForConnection(
      await reload(conn.tenantId, 'Alert Transient Three'),
      options,
    );

    expect(alerts.captured).toHaveLength(1);
  });
});

describe('recovery closes the episode and re-arms it (D-05)', () => {
  it('a successful cycle clears consecutive_failures AND alerted_at', async () => {
    const conn = await freshConnection('Alert Episode Reset');
    const alerts = spy();

    // Three failures to get an alert on the board.
    let current = conn;
    for (let cycle = 0; cycle < 3; cycle++) {
      await runSyncForConnection(current, {
        clientFactory: () => failingClient('network_error'),
        retryDelaysMs: [],
        onAlert: alerts.onAlert,
      });
      current = await reload(conn.tenantId, 'Alert Episode Reset');
    }
    expect(alerts.captured).toHaveLength(1);

    const recovered = await runSyncForConnection(current, {
      clientFactory: okClient,
      retryDelaysMs: [],
      onAlert: alerts.onAlert,
    });

    expect(recovered.outcome).toBe('ok');
    expect(recovered.alert).toBeNull();

    const [afterSuccess] = await forTenant(conn.tenantId).connection.get();
    expect(afterSuccess.consecutiveFailures).toBe(0);
    expect(
      afterSuccess.alertedAt,
      'a closed episode must re-arm — otherwise the SECOND outage for this ' +
        'client is silent forever',
    ).toBeNull();

    // And the proof that it re-armed: three more failures alert again.
    current = await reload(conn.tenantId, 'Alert Episode Reset');
    for (let cycle = 0; cycle < 3; cycle++) {
      await runSyncForConnection(current, {
        clientFactory: () => failingClient('network_error'),
        retryDelaysMs: [],
        onAlert: alerts.onAlert,
      });
      current = await reload(conn.tenantId, 'Alert Episode Reset');
    }

    expect(alerts.captured).toHaveLength(2);
    expect(alerts.captured[1].kind).toBe('degraded');
  });

  it('a recovered auth pause re-arms too, once the key is replaced', async () => {
    // The pause itself is cleared by the re-key path (02-04 Task 3); what is
    // asserted here is that the SUCCESS half of the cycle drops alerted_at, so
    // the connection that comes back is not permanently muted.
    const conn = await freshConnection('Alert Auth Rearm');
    const alerts = spy();

    await runSyncForConnection(conn, {
      clientFactory: () => failingClient('auth_failed'),
      retryDelaysMs: [],
      onAlert: alerts.onAlert,
    });
    expect(alerts.captured).toHaveLength(1);

    await runSyncForConnection(await reload(conn.tenantId, 'Alert Auth Rearm'), {
      clientFactory: okClient,
      retryDelaysMs: [],
      onAlert: alerts.onAlert,
    });

    const [afterSuccess] = await forTenant(conn.tenantId).connection.get();
    expect(afterSuccess.alertedAt).toBeNull();

    await runSyncForConnection(await reload(conn.tenantId, 'Alert Auth Rearm'), {
      clientFactory: () => failingClient('auth_failed'),
      retryDelaysMs: [],
      onAlert: alerts.onAlert,
    });

    expect(alerts.captured).toHaveLength(2);
    expect(alerts.captured[1].kind).toBe('auth');
  });
});

describe('alert content — classified vocabulary only (T-2-16)', () => {
  const AT = new Date('2026-08-26T09:14:03.512Z');
  const URL = 'https://console.example.com/clients/11111111-1111-1111-1111-111111111111';

  it('subjects name the client and the consequence', () => {
    expect(alertSubject('auth_failed', 'Acme Plumbing')).toBe(
      'ServiceM8 connection failed — follow-ups paused for Acme Plumbing',
    );
    expect(alertSubject('degraded', 'Acme Plumbing')).toBe(
      'ServiceM8 sync degraded for Acme Plumbing',
    );
  });

  it('the body carries the classified reason, the timestamp and the URL', () => {
    const body = alertBody({
      tenantName: 'Acme Plumbing',
      kind: 'auth_failed',
      detail: 'auth_failed',
      at: AT,
      url: URL,
    });

    expect(body).toContain('Client: Acme Plumbing');
    expect(body).toContain('Reason: auth failed');
    expect(body).toContain('Detected: 2026-08-26 09:14:03 UTC');
    expect(body).toContain(URL);
  });

  it('renders a label from the closed vocabulary for EVERY outcome', () => {
    // Totality, so a sixth outcome cannot reach an inbox as `undefined` — the
    // one case where the operator is told a client is broken and not told why.
    for (const outcome of SYNC_OUTCOMES) {
      for (const kind of ['auth_failed', 'degraded'] as SyncAlertKind[]) {
        const body = alertBody({
          tenantName: 'Acme Plumbing',
          kind,
          detail: outcome,
          at: AT,
          url: URL,
        });

        expect(body).toContain(`Reason: ${SYNC_OUTCOME_LABELS[outcome]}`);
        expect(body).not.toContain('undefined');
        // The raw snake_case enum value is our vocabulary, not the operator's.
        expect(body).not.toContain(`Reason: ${outcome}_`);
      }
    }
  });

  it('never renders credential-shaped or transport-level text', () => {
    const bodies = SYNC_OUTCOMES.map((outcome) =>
      alertBody({
        tenantName: 'Acme Plumbing',
        kind: 'degraded',
        detail: outcome,
        at: AT,
        url: URL,
      }),
    );

    for (const body of bodies) {
      // T-2-16: a caught fetch rejection stringifies to the request URL, and
      // the one header on that request is the client's ServiceM8 key.
      expect(body).not.toMatch(/X-API-Key/i);
      expect(body).not.toMatch(/api\.servicem8\.com/i);
      expect(body).not.toMatch(/api_1\.0/i);
      expect(body).not.toMatch(/enc:v\d/i);
      expect(body).not.toMatch(/Bearer /i);
      expect(body).not.toMatch(/\bat .*\(.*:\d+:\d+\)/); // a stack frame
    }
  });
});

describe('operator-email module contract (source assertions)', () => {
  const SOURCE = readFileSync('src/core/alerts/operator-email.ts', 'utf8');

  it('imports nothing from next/*', () => {
    // src/core is framework-free by contract. A `next/*` import here would also
    // make the module unusable from the pg_cron-driven tick, which has no
    // request context to borrow.
    expect(SOURCE).not.toMatch(/from\s+['"]next\//);
    expect(SOURCE).not.toMatch(/from\s+['"]next['"]/);
  });

  it('returns a typed outcome rather than throwing', () => {
    // The failure arm has to exist in the TYPE, or a caller has no reason to
    // handle it — and the sync cycle's swallow-and-log becomes dead code
    // guarding an exception that arrives by a different route.
    expect(SOURCE).toMatch(/OperatorAlertResult\s*=/);
    expect(SOURCE).toMatch(/ok:\s*false/);
    expect(SOURCE).toMatch(/'not_configured'\s*\|\s*'send_failed'/);
    // Every await of the provider is inside a try.
    expect(SOURCE).toMatch(/try\s*\{[\s\S]*resend[\s\S]*catch/i);
  });

  it('reports a provider failure by name, never by message', () => {
    // Same invariant as src/core/servicem8/client.ts. `error.message` is prose
    // written by somebody else about a request WE made.
    expect(SOURCE).toContain('error.name');
    expect(SOURCE).not.toMatch(/error\.message/);
    expect(SOURCE).not.toMatch(/String\(e\)/);
  });

  it('the sync cycle wires this module as the default alert sink', () => {
    const runSync = readFileSync('src/core/sync/run-sync.ts', 'utf8');

    expect(runSync).toMatch(/sendOperatorAlert/);
    // The no-op default from 02-02 is gone: an alert intent that resolves to
    // nothing is the silent dead client with extra steps.
    expect(runSync).not.toMatch(/onAlert\s*=\s*\(\)\s*=>\s*\{\s*\}/);
    expect(runSync).toMatch(/onAlert\s*=\s*emailOperator/);
  });
});
