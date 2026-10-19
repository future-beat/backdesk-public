/**
 * Phase 15 (15-06, RPT-05, D-04, T-15-03, T-15-09) — the design-partner CSV
 * action: gated first, names through the operator's JWT, every document parsed.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ORDERING IS THE PROPERTY. `listLatestReportFiguresForExport` reads   │
 * │ every tenant's frozen figures through the service-role path. An action   │
 * │ that read first and checked the caller afterwards would still return the │
 * │ denial sentence — so the assertions on the denied path are about the     │
 * │ MOCKS' CALL COUNTS, the only thing that fails on that mistake (the       │
 * │ `reports-authorization` mould).                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE: the gate, the repository barrel and the Supabase server client are
 * mocked; the real writer (`partnerCsv`) and the real schema run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperatorCheck } from '@/app/(console)/_auth';

let access: OperatorCheck = 'ok';

const requireOperator = vi.fn(async () => access);
const listLatestReportFiguresForExport = vi.fn<() => Promise<unknown[]>>(async () => []);
const createClient = vi.fn();

let tenantNames: { id: string; name: string }[] = [];
let namesError: { code: string } | null = null;

vi.mock('@/app/(console)/_auth', () => ({
  requireOperator: () => requireOperator(),
  OPERATOR_DENIED_MESSAGE: {
    unauthenticated: 'Your session has expired. Sign in again.',
    forbidden: 'You do not have access to audits.',
  },
}));

vi.mock('@/db/repository', () => ({
  listLatestReportFiguresForExport: () => listLatestReportFiguresForExport(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    createClient();
    return {
      from: (table: string) => ({
        select: async () =>
          table === 'tenants'
            ? { data: namesError ? null : tenantNames, error: namesError }
            : { data: null, error: { code: 'unexpected-table' } },
      }),
    };
  },
}));

const { exportDesignPartnerCsv } = await import('@/app/(console)/reports/export-actions');
const { EXPORT_FAILED_MESSAGE } = await import('@/app/(console)/reports/export-state');
const { PARTNER_CSV_HEADER } = await import('@/core/reporting/partner-csv');

const ACME = '11111111-1111-4111-8111-111111111111';
const UNNAMED = '22222222-2222-4222-8222-222222222222';

/** The eleven quote figures — a month frozen before Phase 15 carries only these. */
const ELEVEN = {
  quotesChased: 4,
  replies: 2,
  jobsWonAttributed: 1,
  jobsWonTotal: 2,
  grossCents: 100_000,
  conservativeCents: 30_000,
  feesMonthlyCents: 59_700,
  feesSetupCents: 0,
  multipleConservativeBp: 5025,
  multipleGrossBp: 16_750,
  valueMissingCount: 0,
};

const BLOCK = {
  captured: 5,
  withheld: 1,
  byHour: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 5 : 0)),
  byIsoWeekday: [5, 0, 0, 0, 0, 0, 0],
  afterHoursByIsoWeekday: [2, 0, 0, 0, 0, 0, 0],
  afterHours: { numerator: 2, denominator: 5, rateBp: 4000 },
  textBacks: { sent: 4, delivered: 3, medianSeconds: 21, p90Seconds: 40 },
  replyRate: { numerator: 2, denominator: 3, rateBp: 6667 },
  funnel: { leads: 4, jobsCreated: 2, jobsWon: 1, bookedByTradie: 1 },
};

function exportRow(tenantId: string, periodStart: string, figures: unknown) {
  return { tenantId, periodStart, timezone: 'Australia/Perth', version: 1, figures };
}

beforeEach(() => {
  access = 'ok';
  tenantNames = [{ id: ACME, name: 'Acme Plumbing' }];
  namesError = null;
  requireOperator.mockClear();
  listLatestReportFiguresForExport.mockReset();
  listLatestReportFiguresForExport.mockResolvedValue([]);
  createClient.mockClear();
});

describe('2026-10-13 (15-06): the export is gated before any read', () => {
  it.each(['unauthenticated', 'forbidden'] as const)(
    'a %s caller gets the denied sentence and NOTHING is read',
    async (denied) => {
      access = denied;
      const state = await exportDesignPartnerCsv();

      expect(state.error).toBe(
        denied === 'unauthenticated'
          ? 'Your session has expired. Sign in again.'
          : 'You do not have access to audits.',
      );
      expect(state.csv).toBeNull();
      expect(requireOperator).toHaveBeenCalledTimes(1);
      expect(listLatestReportFiguresForExport, 'The cross-tenant read ran.').not.toHaveBeenCalled();
      expect(createClient, 'The names read ran.').not.toHaveBeenCalled();
    },
  );
});

describe('2026-10-13 (15-06): the file', () => {
  it('writes the pinned header first and one row per client-month', async () => {
    listLatestReportFiguresForExport.mockResolvedValue([
      exportRow(ACME, '2026-09-01', { ...ELEVEN, missedCalls: BLOCK }),
      exportRow(UNNAMED, '2026-07-01', ELEVEN),
    ]);

    const state = await exportDesignPartnerCsv();

    expect(state.error).toBeNull();
    expect(state.rows).toBe(2);
    expect(state.filename).toMatch(/^backdesk-design-partner-stats-\d{4}-\d{2}-\d{2}\.csv$/);

    const csv = state.csv ?? '';
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(PARTNER_CSV_HEADER.join(','));
    expect(lines.filter((line) => line !== '')).toHaveLength(3);

    // A tenant the operator's JWT cannot name is never named — and never a uuid.
    expect(csv).toContain('Another client,2026-07');
    expect(csv).not.toContain(UNNAMED);
    // The month is sliced from `period_start`; the block's figures land.
    expect(csv).toContain('Acme Plumbing,2026-09,5,2,1,4,3,21,40,2,4,2,1,1');
  });

  it('a month frozen before the block exports empty cells, never zeros', async () => {
    listLatestReportFiguresForExport.mockResolvedValue([exportRow(ACME, '2026-07-01', ELEVEN)]);

    const state = await exportDesignPartnerCsv();
    const [, row] = (state.csv ?? '').split('\r\n');
    expect(row).toBe(`Acme Plumbing,2026-07${','.repeat(PARTNER_CSV_HEADER.length - 2)}`);
  });

  it('nothing frozen: the header line only, and zero rows — the file still downloads', async () => {
    const state = await exportDesignPartnerCsv();

    expect(state.error).toBeNull();
    expect(state.rows).toBe(0);
    expect(state.csv).toBe(`${PARTNER_CSV_HEADER.join(',')}\r\n`);
    expect(state.filename).not.toBeNull();
  });
});

describe('2026-10-13 (15-06): every failure is the one sentence', () => {
  it('the read throws → the failure sentence, no file, the caught value discarded', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listLatestReportFiguresForExport.mockRejectedValue(new Error('relation "secret_column"'));

    const state = await exportDesignPartnerCsv();

    expect(state.error).toBe(EXPORT_FAILED_MESSAGE);
    expect(state.csv).toBeNull();
    expect(errors).toHaveBeenCalledWith('[reports] export read failed');
    expect(JSON.stringify(errors.mock.calls)).not.toContain('secret_column');
    errors.mockRestore();
  });

  it('a stored document missing a required key fails the parse — never a half row', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { quotesChased: _dropped, ...broken } = ELEVEN;
    void _dropped;
    listLatestReportFiguresForExport.mockResolvedValue([
      exportRow(ACME, '2026-09-01', { ...ELEVEN, missedCalls: BLOCK }),
      exportRow(ACME, '2026-08-01', broken),
    ]);

    const state = await exportDesignPartnerCsv();

    expect(state.error).toBe(EXPORT_FAILED_MESSAGE);
    expect(state.csv).toBeNull();
    errors.mockRestore();
  });

  it('the names read errors → the failure sentence, not a file of "Another client"', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    namesError = { code: '42501' };
    listLatestReportFiguresForExport.mockResolvedValue([
      exportRow(ACME, '2026-09-01', { ...ELEVEN, missedCalls: BLOCK }),
    ]);

    const state = await exportDesignPartnerCsv();

    expect(state.error).toBe(EXPORT_FAILED_MESSAGE);
    expect(state.csv).toBeNull();
    errors.mockRestore();
  });
});
