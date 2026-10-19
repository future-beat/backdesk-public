/**
 * 14-REVIEW WR-06: the tradie-booked pass spends its ServiceM8 reads inside a
 * deadline handed down from the sync tick, with each read's wait capped, and
 * skips — counts and logs by kind — whatever is left when the deadline passes.
 *
 * PURE: the repository barrel and the close helper are mocked by name, the
 * ServiceM8 client is a fake that advances a FAKE CLOCK on every read, and no
 * request leaves the process. Every number is from ACMA's fiction block.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listOpenForJobMatch = vi.fn();
const listActiveByDateRange = vi.fn();
const forJobs = vi.fn();
const setMatchedJob = vi.fn();

vi.mock('@/db/repository', () => ({
  forTenant: () => ({
    leads: {
      failStaleJobClaims: async () => [],
      listOpenForJobMatch: () => listOpenForJobMatch(),
    },
    quotes: { listActiveByDateRange: (from: string, to: string) => listActiveByDateRange(from, to) },
    quoteContacts: { forJobs: (uuids: readonly string[]) => forJobs(uuids) },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({ leads: { setMatchedJob: (...args: unknown[]) => setMatchedJob(...args) } }),
  }),
}));
vi.mock('@/core/leads/close', () => ({
  closeLeadInTx: async () => ({ kind: 'closed' }),
}));

const { resolveLeadsBookedByTradie } = await import('@/core/leads/booked-by-tradie');
const { LEAD_JOB_MATCH_READ_TIMEOUT_MS } = await import('@/core/leads/constants');

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-10T01:00:00.000Z');
/** 07:30 Perth on 10 Oct — every job below is dated inside the window. */
const CALLED_AT = new Date('2026-10-09T23:30:00.000Z');

/** A lead no mirrored job matches, so every contactless job is a read request. */
const WAITING_LEAD = { id: 'lead-waiting', contactMobile: '+61491570691', firstMissedAt: CALLED_AT };
/** A lead the mirror tier matches for free — no ServiceM8 read. */
const MIRROR_LEAD = { id: 'lead-mirror', contactMobile: '+61491570692', firstMissedAt: CALLED_AT };

const company = (n: number) => `0000000${n}-0000-4000-8000-0000000000c${n}`;
const contactlessJobs = [1, 2, 3, 4].map((n) => ({
  sm8JobUuid: `0000000${n}-0000-4000-8000-0000000000a${n}`,
  companyUuid: company(n),
  dateRaw: '2026-10-12 00:00:00',
  status: 'Quote',
}));
const MIRROR_JOB = {
  sm8JobUuid: '00000009-0000-4000-8000-0000000000a9',
  companyUuid: null,
  dateRaw: '2026-10-11 00:00:00',
  status: 'Quote',
};

/** A fake ServiceM8 read client whose every read costs `costMs` of the fake clock. */
function fakeClient(clock: { now: number }, costMs: number) {
  const timeouts: Array<number | undefined> = [];
  const client = {
    async get(_resource: string, options: { filter?: string; timeoutMs?: number } = {}) {
      timeouts.push(options.timeoutMs);
      clock.now += costMs;
      return { ok: true as const, data: { rows: [], headers: new Headers() } };
    },
  };
  return { client, timeouts };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  listOpenForJobMatch.mockResolvedValue([WAITING_LEAD, MIRROR_LEAD]);
  listActiveByDateRange.mockResolvedValue([MIRROR_JOB, ...contactlessJobs]);
  forJobs.mockResolvedValue([
    { sm8JobUuid: MIRROR_JOB.sm8JobUuid, mobile: '0491 570 692', phone: null, sm8Active: true },
  ]);
  setMatchedJob.mockResolvedValue([{ id: MIRROR_LEAD.id }]);
});

describe('the pass reads only inside its deadline (WR-06)', () => {
  it('caps each read at the per-read limit and at the time left, then skips the rest — counted and logged', async () => {
    const clock = { now: 0 };
    const { client, timeouts } = fakeClient(clock, 3_000);

    const result = await resolveLeadsBookedByTradie(TENANT, {
      client,
      tenantTimezone: 'Australia/Perth',
      now: NOW,
      deadlineAt: 7_000,
      clock: () => clock.now,
    });

    // t=0: 7 s left → capped at 5 s. t=3: 4 s left. t=6: 1 s left. t=9: past it.
    expect(timeouts).toEqual([LEAD_JOB_MATCH_READ_TIMEOUT_MS, 4_000, 1_000]);
    expect(result).toMatchObject({ companyReads: 3, companyReadsSkipped: 1, resolved: 1 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('kind tick_deadline'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('1 company-contact read(s) skipped'));
  });

  it('past its deadline the pass spends no read, but the free mirror tier still resolves', async () => {
    const clock = { now: 10_000 };
    const { client, timeouts } = fakeClient(clock, 3_000);

    const result = await resolveLeadsBookedByTradie(TENANT, {
      client,
      tenantTimezone: 'Australia/Perth',
      now: NOW,
      deadlineAt: 10_000,
      clock: () => clock.now,
    });

    expect(timeouts).toEqual([]);
    expect(result).toMatchObject({ companyReads: 0, companyReadsSkipped: 4, resolved: 1 });
    expect(setMatchedJob).toHaveBeenCalledWith(MIRROR_LEAD.id, MIRROR_JOB.sm8JobUuid, NOW);
  });

  it('with no deadline every read is still capped at the per-read limit, and nothing is skipped', async () => {
    const clock = { now: 0 };
    const { client, timeouts } = fakeClient(clock, 3_000);

    const result = await resolveLeadsBookedByTradie(TENANT, {
      client,
      tenantTimezone: 'Australia/Perth',
      now: NOW,
      clock: () => clock.now,
    });

    expect(timeouts).toEqual(Array(4).fill(LEAD_JOB_MATCH_READ_TIMEOUT_MS));
    expect(result).toMatchObject({ companyReads: 4, companyReadsSkipped: 0 });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('the per-read cap is far below the client’s own 20 s timeout', () => {
    expect(LEAD_JOB_MATCH_READ_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});
