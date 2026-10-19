/**
 * The label-effects pass (Phase 13, D-11; LEAD-02) — what a high-confidence
 * closing label does to its lead, proven purely.
 *
 * PURE: it imports neither `tests/helpers/seed` nor a database client. The
 * repository module and `closeLead` are `vi.mock`s, and every call is
 * recorded. What the high-confidence filter itself does is SQL
 * (`inbound.closingLabelRowsForOpenLeads`, 13-03) and is proven end to end in
 * the DB-backed `tests/lead-reply.test.ts` (CI only); this suite pins what the
 * pass does with the rows that read hands it:
 *
 *   - one `closeLead` per distinct lead, with the label as the reason, the
 *     NEWEST row's label winning;
 *   - per-tenant isolation with a fixed-string log that names the tenant id
 *     and nothing else;
 *   - a counts-only result, `{ leadsClosed }`, counting `closed` and not
 *     `already_closed`;
 *   - no model client and no sender anywhere in the module.
 */
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { inboundMessageId: string; leadId: string; label: string };

const tenants = vi.fn<() => Promise<Array<Record<string, unknown>>>>();
const closingRows = vi.fn<(tenantId: string) => Promise<Row[]>>();
const closeLead = vi.fn<
  (tenantId: string, leadId: string, reason: string, now: Date) => Promise<{ kind: string }>
>();

vi.mock('@/db/repository', () => ({
  forAllTenants_cadenceTick: () => tenants(),
  forTenant: (tenantId: string) => ({
    inbound: { closingLabelRowsForOpenLeads: () => closingRows(tenantId) },
  }),
}));

vi.mock('@/core/leads/close', () => ({
  closeLead: (tenantId: string, leadId: string, reason: string, now: Date) =>
    closeLead(tenantId, leadId, reason, now),
}));

const { applyLeadLabelEffects } = await import('@/core/leads/label-effects');

const NOW = new Date('2026-10-08T02:00:00.000Z');
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';

function tenant(tenantId: string, paused = false): Record<string, unknown> {
  return {
    tenantId,
    connectionPausedAt: paused ? new Date('2026-10-01T00:00:00Z') : null,
    settingsPausedAt: null,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tenants.mockReset();
  closingRows.mockReset();
  closeLead.mockReset();
  closeLead.mockResolvedValue({ kind: 'closed' });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('one close per distinct lead, the label as the reason (D-11)', () => {
  it('closes each lead once with its row label, for every tenant', async () => {
    tenants.mockResolvedValue([tenant(T1), tenant(T2)]);
    closingRows.mockImplementation(async (tenantId) =>
      tenantId === T1
        ? [
            { inboundMessageId: 'm1', leadId: 'lead-a', label: 'spam' },
            { inboundMessageId: 'm2', leadId: 'lead-b', label: 'complaint' },
          ]
        : [{ inboundMessageId: 'm3', leadId: 'lead-c', label: 'existing_job' }],
    );

    const result = await applyLeadLabelEffects(NOW);

    expect(closingRows.mock.calls).toEqual([[T1], [T2]]);
    expect(closeLead.mock.calls).toEqual([
      [T1, 'lead-a', 'spam', NOW],
      [T1, 'lead-b', 'complaint', NOW],
      [T2, 'lead-c', 'existing_job', NOW],
    ]);
    expect(result).toEqual({ leadsClosed: 3 });
  });

  it('several closing rows on one lead close it ONCE, with the newest label', async () => {
    tenants.mockResolvedValue([tenant(T1)]);
    // The read is ordered by received_at ascending: the last row is the newest.
    closingRows.mockResolvedValue([
      { inboundMessageId: 'old', leadId: 'lead-a', label: 'already_sorted' },
      { inboundMessageId: 'mid', leadId: 'lead-b', label: 'not_a_lead' },
      { inboundMessageId: 'new', leadId: 'lead-a', label: 'opt_out' },
    ]);

    await applyLeadLabelEffects(NOW);

    expect(closeLead.mock.calls).toEqual([
      [T1, 'lead-a', 'opt_out', NOW],
      [T1, 'lead-b', 'not_a_lead', NOW],
    ]);
  });

  it('counts closed, never already_closed — the pass is self-healing, not double-counting', async () => {
    tenants.mockResolvedValue([tenant(T1)]);
    closingRows.mockResolvedValue([
      { inboundMessageId: 'm1', leadId: 'lead-a', label: 'spam' },
      { inboundMessageId: 'm2', leadId: 'lead-b', label: 'spam' },
    ]);
    closeLead.mockResolvedValueOnce({ kind: 'already_closed' }).mockResolvedValueOnce({ kind: 'closed' });

    expect(await applyLeadLabelEffects(NOW)).toEqual({ leadsClosed: 1 });
  });

  it('no closing rows means no close and a zero count', async () => {
    tenants.mockResolvedValue([tenant(T1)]);
    closingRows.mockResolvedValue([]);

    expect(await applyLeadLabelEffects(NOW)).toEqual({ leadsClosed: 0 });
    expect(closeLead).not.toHaveBeenCalled();
  });

  it('a paused tenant is still walked — a close sends nothing and stops a chase', async () => {
    tenants.mockResolvedValue([tenant(T1, true)]);
    closingRows.mockResolvedValue([{ inboundMessageId: 'm1', leadId: 'lead-a', label: 'spam' }]);

    await applyLeadLabelEffects(NOW);

    expect(closeLead.mock.calls).toEqual([[T1, 'lead-a', 'spam', NOW]]);
  });
});

describe('per-tenant isolation with a value-discarding catch', () => {
  it('a tenant whose read throws is skipped, logged by id only, and the next still runs', async () => {
    tenants.mockResolvedValue([tenant(T1), tenant(T2), tenant(T3)]);
    closingRows.mockImplementation(async (tenantId) => {
      if (tenantId === T2) {
        throw new Error('select … where body = $1 [SECRET BODY +61491570199]');
      }
      return [{ inboundMessageId: `m-${tenantId}`, leadId: `lead-${tenantId}`, label: 'spam' }];
    });

    const result = await applyLeadLabelEffects(NOW);

    expect(closeLead.mock.calls.map((call) => call[0])).toEqual([T1, T3]);
    expect(result).toEqual({ leadsClosed: 2 });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toBe(`[leads] label effects failed for tenant ${T2}.`);
    // THE CAUGHT VALUE IS DISCARDED: nothing from the error reaches the log.
    expect(line).not.toContain('SECRET');
    expect(line).not.toContain('+61');
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
  });

  it('a close that throws costs that tenant the rest of this tick, not the next tenant', async () => {
    tenants.mockResolvedValue([tenant(T1), tenant(T2)]);
    closingRows.mockImplementation(async (tenantId) => [
      { inboundMessageId: `m-${tenantId}`, leadId: `lead-${tenantId}`, label: 'complaint' },
    ]);
    closeLead.mockImplementation(async (tenantId) => {
      if (tenantId === T1) throw new Error('deadlock');
      return { kind: 'closed' };
    });

    expect(await applyLeadLabelEffects(NOW)).toEqual({ leadsClosed: 1 });
    expect(closeLead.mock.calls.map((call) => call[0])).toEqual([T1, T2]);
    expect(String(errorSpy.mock.calls[0]?.[0])).toBe(
      `[leads] label effects failed for tenant ${T1}.`,
    );
  });
});

describe('what the module can reach (D-13 boundary, carried)', () => {
  const source = readFileSync('src/core/leads/label-effects.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports the repository barrel and closeLead, and nothing else', () => {
    const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(['./close', '@/db/repository'].sort());
  });

  it('names no model, no sender and no classifier', () => {
    expect(source).not.toMatch(/anthropic|claude-|messages\.|classif|sender|send\(/i);
  });

  it('logs only the fixed string with a tenant id', () => {
    const interpolations = [...source.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].flatMap((call) =>
      [...call[1].matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()),
    );
    expect(interpolations).toEqual(['tenant.tenantId']);
  });
});
