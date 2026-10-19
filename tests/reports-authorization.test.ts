/**
 * T-7-17/T-7-18: BOTH reports actions prove entitlement BEFORE they touch the
 * core — and the ORDERING is the property, not the outcome.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY ORDER, AND NOT JUST "IT RETURNED AN ERROR". `generateMonthlyReport`  │
 * │ and `fees.append` write through `forTenant()`, the SERVICE-ROLE path,    │
 * │ where the `monthly_reports` and `tenant_fees` policies are inert by      │
 * │ design. So an action that called the core first and checked the caller   │
 * │ afterwards would STILL return the denial message — and would still have  │
 * │ frozen a report, or written a fee, for a client the caller cannot see.   │
 * │ The assertions below are therefore about the MOCKS' CALL COUNTS on the   │
 * │ denied paths, which is the only thing that can fail on that mistake.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A Server Action id is GLOBAL: both of these are POSTable at any route in the
 * app, including ones `proxy.ts` never sees, by anyone who can guess a tenant
 * uuid. The `(console)` layout is not the enforcement — it runs only when a
 * layout renders, which is after the action has finished. `authorize()` is.
 *
 * ── PURE, AND THE REAL GATE ─────────────────────────────────────────────────
 *
 * No database and no network: the repository barrel, the generator and
 * `next/cache` are mocked. `authorize()` itself is NOT mocked — Supabase's
 * client is, one level below it, so the real gate runs against a fake session.
 * Mocking the gate would leave the thing under test out of the test.
 *
 * Sibling suite: tests/inbox-authorization.test.ts pins the same property over
 * the inbox's one action, and this one is written in its shape deliberately.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenerateReportResult } from '@/core/reporting/generate';

const feesAppend = vi.fn(async () => [{ id: 'fee-1' }]);
const reportsList = vi.fn(async () => []);

/**
 * Typed over the WHOLE result union, not over the one shape the default returns.
 *
 * Inferred from the implementation, its type admits only `generated`, and a
 * `mockResolvedValueOnce` for any other arm fails to compile. A `import type`
 * line is erased at runtime, so it does not fight the `vi.mock` below.
 */
const generateMonthlyReport = vi.fn<() => Promise<GenerateReportResult>>(async () => ({
  kind: 'generated' as const,
  reportId: '99999999-9999-4999-8999-999999999999',
  version: 1,
  periodStart: '2026-08-01',
}));
const revalidatePath = vi.fn();

vi.mock('@/db/repository', () => ({
  forTenant: () => ({
    fees: { append: feesAppend, list: vi.fn(async () => []) },
    reports: { list: reportsList, byId: vi.fn(async () => []), insertVersion: vi.fn() },
  }),
}));

vi.mock('@/core/reporting/generate', () => ({
  generateMonthlyReport: (...args: unknown[]) => generateMonthlyReport(...(args as [])),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const TENANT = '11111111-1111-4111-8111-111111111111';

/**
 * The session under test, swapped per case.
 *
 * `userId` null   → no session at all.
 * `member` false  → the RLS-scoped `tenants` read returns ZERO ROWS, which is
 *                   what a non-member gets: indistinguishable from a client
 *                   that does not exist, and deliberately so.
 */
let session: { userId: string | null; member: boolean } = { userId: 'operator-1', member: true };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: session.userId ? { claims: { sub: session.userId } } : null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'tenants' && session.member
              ? {
                  data: { id: TENANT, name: 'Perth Sparks', timezone: 'Australia/Perth' },
                  error: null,
                }
              : { data: null, error: null },
        }),
      }),
    }),
  }),
}));

const { appendFeeAction, generateReportAction } = await import(
  '@/app/(console)/reports/[client]/actions'
);
const { BLANK_FEE_STATE, BLANK_GENERATE_STATE } = await import(
  '@/app/(console)/reports/[client]/action-state'
);

function generateForm(fields: Record<string, string> = { month: '8', year: '2026' }): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function feeForm(
  fields: Record<string, string> = {
    kind: 'monthly',
    amount: '597.00',
    effective_from: '2026-08-01',
  },
): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  feesAppend.mockClear();
  reportsList.mockClear();
  generateMonthlyReport.mockClear();
  revalidatePath.mockClear();
  session = { userId: 'operator-1', member: true };
});

describe('generateReportAction is gated before it reaches the generator', () => {
  it('rejects an unauthenticated caller WITHOUT generating anything', async () => {
    session = { userId: null, member: false };

    const state = await generateReportAction(TENANT, BLANK_GENERATE_STATE, generateForm());

    expect(state.error).toBe('Your session has expired. Sign in again.');
    // THE COUNT IS THE ASSERTION. A generator-first action would return this
    // same sentence and would already have frozen a report row.
    expect(generateMonthlyReport).toHaveBeenCalledTimes(0);
  });

  it('rejects a caller who is not a member of the client', async () => {
    session = { userId: 'operator-1', member: false };

    const state = await generateReportAction(TENANT, BLANK_GENERATE_STATE, generateForm());

    // "Unknown client." rather than "not yours": denial and absence stay
    // indistinguishable for a uuid somebody typed into a URL.
    expect(state.error).toBe('Unknown client.');
    expect(generateMonthlyReport).toHaveBeenCalledTimes(0);
  });

  it('rejects a malformed tenant id before it reaches Postgres', async () => {
    const state = await generateReportAction('not-a-uuid', BLANK_GENERATE_STATE, generateForm());

    expect(state.error).toBe('Unknown client.');
    expect(generateMonthlyReport).toHaveBeenCalledTimes(0);
  });

  it('refuses a month outside the schema WITHOUT generating anything', async () => {
    const state = await generateReportAction(
      TENANT,
      BLANK_GENERATE_STATE,
      generateForm({ month: '13', year: '2026' }),
    );

    expect(state.error).toBe('Pick a month and a year, then generate.');
    expect(generateMonthlyReport).toHaveBeenCalledTimes(0);
  });

  it('calls the generator ONCE, with the parsed month, for a cleared caller', async () => {
    const state = await generateReportAction(TENANT, BLANK_GENERATE_STATE, generateForm());

    expect(generateMonthlyReport).toHaveBeenCalledTimes(1);
    expect(generateMonthlyReport).toHaveBeenCalledWith(
      TENANT,
      { year: 2026, month: 8 },
      expect.any(Date),
    );
    expect(state.success).toBe('Version 1 for August 2026 is ready.');
    expect(state.error).toBeNull();
  });

  it('reports an unchanged month in the SUCCESS slot, carrying the version to open', async () => {
    const existing = '77777777-7777-4777-8777-777777777777';
    generateMonthlyReport.mockResolvedValueOnce({
      kind: 'unchanged',
      reportId: existing,
      version: 3,
      periodStart: '2026-08-01',
    });

    const state = await generateReportAction(TENANT, BLANK_GENERATE_STATE, generateForm());

    // NOT THE ERROR SLOT. Nothing went wrong: the month already says exactly
    // this, so no fourth identical version was created. Routing it to `error`
    // would report a correct outcome as a failure and send the operator looking
    // for a fix that does not exist.
    expect(state.success).toBe('August 2026 is already up to date (version 3).');
    expect(state.error).toBeNull();
    // The id of the version that ALREADY EXISTS — the island's `Open it →`
    // link points at it, which is the operator's next act either way.
    expect(state.reportId).toBe(existing);
    expect(revalidatePath).toHaveBeenCalledWith(`/reports/${TENANT}`);
  });
});

describe('appendFeeAction is gated before it reaches the repository', () => {
  it('rejects an unauthenticated caller WITHOUT writing a fee', async () => {
    session = { userId: null, member: false };

    const state = await appendFeeAction(TENANT, BLANK_FEE_STATE, feeForm());

    expect(state.error).toBe('Your session has expired. Sign in again.');
    expect(feesAppend).toHaveBeenCalledTimes(0);
  });

  it('rejects a caller who is not a member of the client', async () => {
    session = { userId: 'operator-1', member: false };

    const state = await appendFeeAction(TENANT, BLANK_FEE_STATE, feeForm());

    expect(state.error).toBe('Unknown client.');
    expect(feesAppend).toHaveBeenCalledTimes(0);
  });

  it('rejects a malformed tenant id before it reaches Postgres', async () => {
    const state = await appendFeeAction('not-a-uuid', BLANK_FEE_STATE, feeForm());

    expect(state.error).toBe('Unknown client.');
    expect(feesAppend).toHaveBeenCalledTimes(0);
  });

  it('refuses `59.7` — a one-decimal amount is a typo, not $59.70', async () => {
    const state = await appendFeeAction(
      TENANT,
      BLANK_FEE_STATE,
      feeForm({ kind: 'monthly', amount: '59.7', effective_from: '2026-08-01' }),
    );

    expect(state.fieldErrors.amount).toBe('Amount must be a dollar figure like 597.00.');
    expect(feesAppend).toHaveBeenCalledTimes(0);
  });

  it('refuses a date that does not exist', async () => {
    const state = await appendFeeAction(
      TENANT,
      BLANK_FEE_STATE,
      feeForm({ kind: 'monthly', amount: '597.00', effective_from: '2026-02-31' }),
    );

    // The database would reject this with a 22008 the operator reads as
    // "something broke"; the fix is to say so beside the field.
    expect(state.fieldErrors.effective_from).toBe('Effective-from must be a date.');
    expect(feesAppend).toHaveBeenCalledTimes(0);
  });

  it('refuses a date outside the range a fee could mean', async () => {
    // A FORGED POST, not a form submission — the date picker cannot produce
    // these. `0001-01-01` passes shape and calendar validity, appends to a
    // table with no delete path, and then becomes "the fee in force" for every
    // month forever, because `monthlyFeeInForceOn` picks the greatest
    // `effective_from` not after the day. It can only be superseded by a row
    // dated even earlier.
    for (const effective_from of ['0001-01-01', '1999-12-31', '9999-12-31']) {
      const state = await appendFeeAction(
        TENANT,
        BLANK_FEE_STATE,
        feeForm({ kind: 'monthly', amount: '597.00', effective_from }),
      );

      expect(state.fieldErrors.effective_from).toBe('Effective-from must be a date.');
    }

    expect(feesAppend).toHaveBeenCalledTimes(0);
  });

  it('accepts both ends of the range a fee CAN mean', async () => {
    // The bounds `generateSchema` already states, so the two schemas cannot
    // drift into disagreeing about which months this product exists for.
    for (const effective_from of ['2024-01-01', '2100-12-31']) {
      const state = await appendFeeAction(
        TENANT,
        BLANK_FEE_STATE,
        feeForm({ kind: 'monthly', amount: '597.00', effective_from }),
      );

      expect(state.fieldErrors.effective_from).toBeUndefined();
    }
  });

  it('refuses an unchosen fee kind', async () => {
    const state = await appendFeeAction(
      TENANT,
      BLANK_FEE_STATE,
      feeForm({ kind: '', amount: '597.00', effective_from: '2026-08-01' }),
    );

    expect(state.fieldErrors.kind).toBe('Pick a fee kind.');
    expect(feesAppend).toHaveBeenCalledTimes(0);
  });

  it('echoes back what the operator typed on a refusal, verbatim', async () => {
    // THE FORM'S OWN COMMENT PROMISED THIS AND NOTHING IMPLEMENTED IT. React 19
    // resets an uncontrolled field once a `<form action={…}>` submission
    // resolves, so a state carrying no values blanks the amount, the kind and
    // the date while the error renders — the operator reads what is wrong and
    // loses the three fields that were right.
    const state = await appendFeeAction(
      TENANT,
      BLANK_FEE_STATE,
      feeForm({
        kind: 'monthly',
        amount: '59.7',
        effective_from: '2026-08-01',
        note: 'Founding rate',
      }),
    );

    expect(state.fieldErrors.amount).toBe('Amount must be a dollar figure like 597.00.');
    // VERBATIM, INCLUDING THE TYPO. Re-seeding from a normalised value would
    // silently correct the very character the operator has to see to fix it.
    expect(state.values).toEqual({
      kind: 'monthly',
      amount: '59.7',
      effective_from: '2026-08-01',
      note: 'Founding rate',
    });
  });

  it('clears the echoed values on success, so the next fee starts blank', async () => {
    // The no-defaults rule: a pre-filled amount is a fee nobody agreed to, one
    // accidental submit away from being the denominator on a client's invoice.
    const state = await appendFeeAction(
      TENANT,
      BLANK_FEE_STATE,
      feeForm({ kind: 'monthly', amount: '597.00', effective_from: '2026-08-01' }),
    );

    expect(state.success).not.toBeNull();
    expect(state.values).toEqual({ kind: '', amount: '', effective_from: '', note: '' });
  });

  it('writes ONE row in INTEGER CENTS for a cleared caller', async () => {
    const state = await appendFeeAction(
      TENANT,
      BLANK_FEE_STATE,
      feeForm({
        kind: 'monthly',
        amount: '597.00',
        effective_from: '2026-08-01',
        note: 'Founding rate',
      }),
    );

    expect(feesAppend).toHaveBeenCalledTimes(1);
    // 59_700, not 59_699 — the string is parsed to integer cents with no float
    // in between. `Number('597.00') * 100` is the bug this pins.
    expect(feesAppend).toHaveBeenCalledWith({
      kind: 'monthly',
      amountCents: 59_700,
      effectiveFrom: '2026-08-01',
      note: 'Founding rate',
    });
    expect(state.success).toBe('Fee recorded.');
    expect(state.error).toBeNull();
  });

  it('records an omitted note as NULL rather than as an empty string', async () => {
    await appendFeeAction(TENANT, BLANK_FEE_STATE, feeForm());

    expect(feesAppend).toHaveBeenCalledWith(
      expect.objectContaining({ note: null }),
    );
  });
});
