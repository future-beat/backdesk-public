/**
 * WR-06: a re-key that stored nothing must not report success.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `repo.connection.update` returns `[]` when its `WHERE tenant_id = ...`
 * predicate matches nothing — reachable when the connection row is deleted
 * between the `connection.get()` existence check and the write. `updated` is
 * then `undefined`, and the immediate-sync block below it read
 * `updated.apiKeyCiphertext`, throwing a TypeError that the very next `catch`
 * swallowed as "a LOCAL failure (the database went away)".
 *
 * So `resumeConnection` returned `{ ok: true }` and the console rendered "Key
 * replaced. Sync resumed" for a re-key that wrote nothing at all — and the
 * operator, who is re-keying precisely because the client is already broken,
 * had no way to tell.
 *
 * ── WHY MOCKED RATHER THAN AGAINST POSTGRES ─────────────────────────────────
 *
 * The trigger is a race: the row must vanish between two statements. Reproducing
 * that against a real database means either a second connection timed against
 * the first or a deliberate hook inside the repository, and both prove less than
 * they cost. What matters is the CONTRACT — "an update that matched no rows is
 * not a success" — and that is exactly what a stubbed repository can state.
 * tests/rekey-resume.test.ts still covers the happy path end to end.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const connectionGet = vi.fn();
const connectionUpdate = vi.fn();
const runSyncForConnection = vi.fn();
const clientGet = vi.fn();
const listLive = vi.fn();
const applyResumeRewindow = vi.fn();

vi.mock('@/db/repository', () => ({
  forTenant: () => ({
    tenant: { get: async () => [{ name: 'Acme Plumbing', timezone: 'Australia/Perth' }] },
    connection: { get: connectionGet, update: connectionUpdate },
    cadences: { listLive: (...args: unknown[]) => listLive(...args) },
  }),
}));

// Stubbed so the SCOPE this path passes is observable. The rule itself — where
// each touch lands — is proven in tests/cadence-rewindow.test.ts (pure) and
// tests/cadence-resume.test.ts (against the database); what this suite owns is
// WHICH cadences the auth-recovery path hands it.
vi.mock('@/core/cadence/resume', () => ({
  applyResumeRewindow: (...args: unknown[]) => applyResumeRewindow(...args),
}));

vi.mock('@/core/servicem8/client', () => ({
  createSm8Client: () => ({ get: clientGet }),
}));

// The credential envelope is exercised exhaustively in
// tests/credential-crypto.test.ts; here it only has to not need a real key.
vi.mock('@/core/shared/crypto', () => ({
  decodeEncryptionKey: () => new Uint8Array(32),
  encryptCredential: () => 'enc:v1:aa:bb:cc',
  credentialLast4: (key: string) => key.slice(-4),
}));

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({ CREDENTIALS_ENCRYPTION_KEY: 'x'.repeat(44) }),
}));

vi.mock('@/core/sync/run-sync', () => ({
  runSyncForConnection: (...args: unknown[]) => runSyncForConnection(...args),
}));

const { resumeConnection } = await import('@/core/sync/connect');

/** The moment the key died. Cadences created after it did not slip. */
const PAUSED_AT = new Date('2026-08-25T02:00:00Z');

const STORED_CONNECTION = {
  apiKeyCiphertext: 'enc:v1:old:old:old',
  jobCursor: null,
  contactCursor: null,
  consecutiveFailures: 4,
  alertedAt: new Date(),
  pausedAt: PAUSED_AT,
};

beforeEach(() => {
  connectionGet.mockReset();
  connectionUpdate.mockReset();
  runSyncForConnection.mockReset();
  clientGet.mockReset();
  listLive.mockReset();
  applyResumeRewindow.mockReset();

  connectionGet.mockResolvedValue([STORED_CONNECTION]);
  clientGet.mockResolvedValue({ ok: true, data: { rows: [], headers: new Headers() } });
  runSyncForConnection.mockResolvedValue({ outcome: 'ok' });
  listLive.mockResolvedValue([]);
  applyResumeRewindow.mockResolvedValue({
    stillPaused: false,
    cadencesRewindowed: 0,
    touchesRescheduled: 0,
  });
});

describe('resumeConnection when the write matches no rows (WR-06)', () => {
  beforeEach(() => {
    // The row existed at the check and was gone by the write.
    connectionUpdate.mockResolvedValue([]);
  });

  it('does not report success', async () => {
    const result = await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(result.ok).toBe(false);
  });

  it('reports not_connected — the honest description of the end state', async () => {
    const result = await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('not_connected');
  });

  it('does not run a sync cycle against a connection it did not write', async () => {
    await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    // The old code reached the cycle and threw inside it. Nothing should be
    // polled on behalf of a row that no longer exists.
    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it('does not throw — the failure is a returned value, not an exception', async () => {
    await expect(resumeConnection(TENANT_ID, 'sm8-key-abcd')).resolves.toBeDefined();
  });
});

describe('resumeConnection still succeeds when the write lands', () => {
  beforeEach(() => {
    connectionUpdate.mockResolvedValue([
      {
        apiKeyCiphertext: 'enc:v1:aa:bb:cc',
        jobCursor: '2026-08-01 00:00:00',
        contactCursor: null,
        consecutiveFailures: 0,
        alertedAt: null,
      },
    ]);
  });

  it('reports success and the new key last4', async () => {
    const result = await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keyLast4).toBe('abcd');
  });

  it('runs the immediate cycle with the freshly written ciphertext', async () => {
    await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(runSyncForConnection).toHaveBeenCalledTimes(1);
    expect(runSyncForConnection.mock.calls[0][0]).toMatchObject({
      tenantId: TENANT_ID,
      apiKeyCiphertext: 'enc:v1:aa:bb:cc',
      // Cursors carried over untouched: the mirror is stale, not wrong.
      jobCursor: '2026-08-01 00:00:00',
    });
  });

  it('a FAILED immediate cycle is still a successful re-key (D-08)', async () => {
    // The key verified against the live API one moment earlier; a 429 a second
    // later is weather. Reporting failure would send the operator hunting for a
    // third key that does not exist.
    runSyncForConnection.mockRejectedValue(new Error('database unreachable'));

    const result = await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.syncOutcome).toBeNull();
  });
});

/**
 * WR-06 (the second one, in the 03 review): the auth-recovery re-window must be
 * SCOPED, exactly as the console's two resumes are.
 *
 * `consumeQuoteEvents` deliberately keeps running for connection-paused tenants,
 * and an operator can triage quotes to `eligible` while a client's key is dead —
 * so brand-new cadences accumulate during the pause, materialized from a fresh
 * anchor with slots already correct and in the future. An unscoped re-window
 * drags touch one of those to the re-key moment and sends a customer their FIRST
 * message days early, which is the hazard `onlyCadenceIds` exists for.
 */
describe('the auth-recovery re-window is scoped to what the pause froze', () => {
  const before = {
    id: 'cadence-before',
    status: 'active',
    createdAt: new Date(PAUSED_AT.getTime() - 86_400_000),
  };
  const during = {
    id: 'cadence-during',
    status: 'active',
    createdAt: new Date(PAUSED_AT.getTime() + 3_600_000),
  };
  const pausedItself = {
    id: 'cadence-paused',
    status: 'paused',
    createdAt: new Date(PAUSED_AT.getTime() - 86_400_000),
  };

  beforeEach(() => {
    connectionUpdate.mockResolvedValue([
      {
        apiKeyCiphertext: 'enc:v1:aa:bb:cc',
        jobCursor: null,
        contactCursor: null,
        consecutiveFailures: 0,
        alertedAt: null,
      },
    ]);
  });

  it('passes only the cadences that existed before the pause began', async () => {
    listLive.mockResolvedValue([before, during, pausedItself]);

    await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(applyResumeRewindow).toHaveBeenCalledTimes(1);
    expect(applyResumeRewindow.mock.calls[0][2]).toEqual({ onlyCadenceIds: ['cadence-before'] });
  });

  it('passes an EMPTY scope when nothing was paused — a proactive key rotation', async () => {
    // `onlyCadenceIds: []` means "nothing was resumed", which is what the option
    // documents it to mean. Omitting it would mean "every active cadence", and
    // repairing schedules nobody paused is the tick re-window pass's job.
    connectionGet.mockResolvedValue([{ ...STORED_CONNECTION, pausedAt: null }]);
    listLive.mockResolvedValue([before, during]);

    await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(applyResumeRewindow.mock.calls[0][2]).toEqual({ onlyCadenceIds: [] });
  });

  it('a failed re-window is still a successful re-key', async () => {
    listLive.mockRejectedValue(new Error('database unreachable'));

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await resumeConnection(TENANT_ID, 'sm8-key-abcd');
    logged.mockRestore();

    expect(result.ok).toBe(true);
  });
});

describe('the earlier guards still fire before any write', () => {
  it('an unknown tenant never reaches the update', async () => {
    connectionGet.mockResolvedValue([STORED_CONNECTION]);
    connectionUpdate.mockResolvedValue([]);

    // A connection that was never made is a different operation with a
    // different shape (it needs the backfill), and says so.
    connectionGet.mockResolvedValue([]);

    const result = await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('not_connected');
    expect(connectionUpdate).not.toHaveBeenCalled();
  });

  it('a rejected key never reaches the update', async () => {
    clientGet.mockResolvedValue({ ok: false, kind: 'auth_failed' });

    const result = await resumeConnection(TENANT_ID, 'sm8-key-abcd');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('auth_failed');
    // VERIFY BEFORE WRITE: a second bad key must not overwrite a stored one.
    expect(connectionUpdate).not.toHaveBeenCalled();
  });
});
