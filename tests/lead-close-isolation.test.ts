/**
 * Phase 13 (D-11/D-14/D-15; checker B1) — closing a lead never opens a
 * transaction inside another.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE HANG THIS SUITE EXISTS FOR: the expiry pass and the dispatch lead    │
 * │ branch already hold a transaction (and its row locks) when they close a  │
 * │ lead. A close that opened its OWN transaction would take a second pooled │
 * │ connection and wait on the lock the first one holds, while the first    │
 * │ waits for it to return — the tick hangs for that tenant every minute,    │
 * │ and the per-tenant catch hides it.                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the close has two forms, and this suite pins both and who calls which:
 * `closeLeadInTx(tx, …)` uses ONLY the handle it is given; `closeLead(…)` is
 * the one wrapper, which opens exactly one tenant transaction and hands its
 * handle to the core; the sweep calls the wrapper. Two source pins (comments
 * stripped) hold the call sites to the rule.
 *
 * PURE: it imports neither `tests/helpers/seed` nor a database client — the
 * repository module is a `vi.mock`, and every handle is a recording object.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type TxWork = (tx: unknown) => Promise<unknown>;

const forTenantCalls = vi.fn<(tenantId: string) => void>();
const runTransaction = vi.fn<(tenantId: string, work: TxWork) => Promise<unknown>>();
const listOpenWithEndedCadence = vi.fn<
  (tenantId: string) => Promise<Array<{ leadId: string; cadenceStatus: string; stopReason: string | null }>>
>();

vi.mock('@/db/repository', () => ({
  forTenant: (tenantId: string) => {
    forTenantCalls(tenantId);
    return {
      transaction: (work: TxWork) => runTransaction(tenantId, work),
      leads: { listOpenWithEndedCadence: () => listOpenWithEndedCadence(tenantId) },
    };
  },
}));

const { closeLead, closeLeadInTx, closeLeadsWithEndedCadences } = await import(
  '@/core/leads/close'
);

const TENANT = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';
const CADENCE = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-07T02:00:00Z');

/**
 * A transaction handle that records every call, in order. `live` decides
 * whether the lead still has a live cadence; `leadOpen` whether the guarded
 * lead UPDATE finds an open row.
 */
function recordingHandle(options: { live: boolean; leadOpen: boolean }) {
  const calls: string[] = [];
  const handle = {
    calls,
    cadences: {
      liveForLead: vi.fn(async (leadId: string) => {
        calls.push(`liveForLead:${leadId}`);
        return options.live ? [{ id: CADENCE }] : [];
      }),
      stopWhereLive: vi.fn(async (ids: readonly string[], reason: string) => {
        calls.push(`stopWhereLive:${ids.join(',')}:${reason}`);
        return ids.map((id) => ({ id }));
      }),
      markExpired: vi.fn(async (ids: readonly string[]) => {
        calls.push(`markExpired:${ids.join(',')}`);
        return ids.map((id) => ({ id }));
      }),
    },
    touches: {
      skipUnsentForCadences: vi.fn(async (ids: readonly string[], reason: string) => {
        calls.push(`skipUnsentForCadences:${ids.join(',')}:${reason}`);
        return [];
      }),
    },
    leads: {
      close: vi.fn(async (leadId: string, reason: string) => {
        calls.push(`leads.close:${leadId}:${reason}`);
        return options.leadOpen ? [{ id: leadId }] : [];
      }),
    },
  };
  return handle;
}

/** The handle as the core's parameter type — the recording object is structural. */
type Handle = Parameters<typeof closeLeadInTx>[0];

beforeEach(() => {
  forTenantCalls.mockReset();
  runTransaction.mockReset();
  listOpenWithEndedCadence.mockReset();
});

describe('closeLeadInTx — the core, on the caller\'s handle only', () => {
  it('stops the live cadence lead_closed, retires its touches, then closes the lead', async () => {
    const tx = recordingHandle({ live: true, leadOpen: true });

    const result = await closeLeadInTx(tx as unknown as Handle, LEAD, 'operator', NOW);

    expect(result).toEqual({ kind: 'closed' });
    expect(tx.calls).toEqual([
      `liveForLead:${LEAD}`,
      `stopWhereLive:${CADENCE}:lead_closed`,
      `skipUnsentForCadences:${CADENCE}:cadence_stopped`,
      `leads.close:${LEAD}:operator`,
    ]);
    expect(tx.leads.close).toHaveBeenCalledWith(LEAD, 'operator', NOW);
    // NEVER the repository factory: no second connection, no second transaction.
    expect(forTenantCalls).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('expires (not stops) the cadence for an expired close', async () => {
    const tx = recordingHandle({ live: true, leadOpen: true });

    await closeLeadInTx(tx as unknown as Handle, LEAD, 'expired', NOW);

    expect(tx.calls).toEqual([
      `liveForLead:${LEAD}`,
      `markExpired:${CADENCE}`,
      `skipUnsentForCadences:${CADENCE}:cadence_expired`,
      `leads.close:${LEAD}:expired`,
    ]);
    expect(tx.cadences.stopWhereLive).not.toHaveBeenCalled();
    expect(forTenantCalls).not.toHaveBeenCalled();
  });

  it('a second close is already_closed and writes nothing to the cadence', async () => {
    // The first close stopped the cadence (no live one remains) and closed the
    // lead (the guarded UPDATE now matches no open row).
    const tx = recordingHandle({ live: false, leadOpen: false });

    const result = await closeLeadInTx(tx as unknown as Handle, LEAD, 'touches_exhausted', NOW);

    expect(result).toEqual({ kind: 'already_closed' });
    expect(tx.calls).toEqual([`liveForLead:${LEAD}`, `leads.close:${LEAD}:touches_exhausted`]);
    expect(tx.cadences.stopWhereLive).not.toHaveBeenCalled();
    expect(tx.cadences.markExpired).not.toHaveBeenCalled();
    expect(tx.touches.skipUnsentForCadences).not.toHaveBeenCalled();
  });
});

describe('closeLead — the one wrapper', () => {
  it('opens exactly one tenant transaction and runs the core on ITS handle', async () => {
    const tx = recordingHandle({ live: true, leadOpen: true });
    runTransaction.mockImplementation(async (_tenantId, work) => work(tx));

    const result = await closeLead(TENANT, LEAD, 'quote_cadence_wins', NOW);

    expect(result).toEqual({ kind: 'closed' });
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(runTransaction.mock.calls[0]?.[0]).toBe(TENANT);
    // Every write landed on the handle the transaction callback received.
    expect(tx.calls).toEqual([
      `liveForLead:${LEAD}`,
      `stopWhereLive:${CADENCE}:lead_closed`,
      `skipUnsentForCadences:${CADENCE}:cadence_stopped`,
      `leads.close:${LEAD}:quote_cadence_wins`,
    ]);
  });
});

describe('closeLeadsWithEndedCadences — the reconciling sweep', () => {
  it('maps each way a lead cadence ends to the lead\'s closed reason, one wrapper call each', async () => {
    listOpenWithEndedCadence.mockResolvedValue([
      { leadId: 'lead-completed', cadenceStatus: 'completed', stopReason: null },
      { leadId: 'lead-expired', cadenceStatus: 'expired', stopReason: null },
      { leadId: 'lead-stop', cadenceStatus: 'stopped', stopReason: 'contact_suppressed' },
      { leadId: 'lead-operator', cadenceStatus: 'stopped', stopReason: 'operator_closed' },
    ]);
    const closedReasons: string[] = [];
    runTransaction.mockImplementation(async (_tenantId, work) => {
      const tx = recordingHandle({ live: false, leadOpen: true });
      const result = await work(tx);
      closedReasons.push(...tx.calls.filter((c) => c.startsWith('leads.close:')));
      return result;
    });

    const closed = await closeLeadsWithEndedCadences(TENANT, NOW);

    expect(closed).toBe(4);
    expect(runTransaction).toHaveBeenCalledTimes(4);
    expect(closedReasons).toEqual([
      'leads.close:lead-completed:touches_exhausted',
      'leads.close:lead-expired:expired',
      'leads.close:lead-stop:opt_out',
      'leads.close:lead-operator:operator',
    ]);
  });

  it('reconciles an unexpected stop reason as operator, logging the reason only', async () => {
    listOpenWithEndedCadence.mockResolvedValue([
      { leadId: 'lead-odd', cadenceStatus: 'stopped', stopReason: 'lead_closed' },
    ]);
    runTransaction.mockImplementation(async (_tenantId, work) =>
      work(recordingHandle({ live: false, leadOpen: false })),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const closed = await closeLeadsWithEndedCadences(TENANT, NOW);

    // The guard found the lead already closed: nothing counted.
    expect(closed).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("'lead_closed'");
    expect(String(error.mock.calls[0]?.[0])).not.toContain('lead-odd');
    error.mockRestore();
  });
});

// ── The call sites, read as source (comments stripped) ─────────────────────

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('who calls which form', () => {
  it('the dispatch lead branch closes on its own claim transaction handle', () => {
    const dispatch = code('src/core/cadence/dispatch.ts');
    expect(dispatch).toMatch(/closeLeadInTx\(\s*tx\s*,/);
    expect(dispatch).not.toMatch(/\bcloseLead\(/);
  });

  it('the expiry pass closes on the expiry transaction handle, inside it', () => {
    const tick = code('src/core/cadence/run-tick.ts');
    const expiry = tick.slice(
      tick.indexOf('async function expireOverdueCadences('),
      tick.indexOf('async function rewindowCadence('),
    );
    expect(expiry.length).toBeGreaterThan(0);
    expect(expiry).toMatch(/closeLeadInTx\(\s*tx\s*,/);
    expect(expiry).not.toMatch(/\bcloseLead\(/);
    // One transaction, the expiry's own.
    expect(expiry.match(/\.transaction\(/g) ?? []).toHaveLength(1);
  });

  it('the close module names the tenant repository factory exactly once, and opens one transaction', () => {
    const close = code('src/core/leads/close.ts');
    expect(close.match(/forTenant\(/g) ?? []).toHaveLength(1);
    expect(close.match(/\.transaction\(/g) ?? []).toHaveLength(1);
  });
});
