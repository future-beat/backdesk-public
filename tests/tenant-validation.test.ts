/**
 * ONB-01 validation unit tests — the rejection rules for tenant creation.
 *
 * Pure: no database, no network, no Next.js. `tenantCreateSchema` is the single
 * validation authority the server action delegates to, so every rule the
 * compliance-critical cadence engine depends on (timezone, contact-hours
 * window, contact days) is pinned here rather than in a form the operator can
 * bypass with curl.
 */
import { describe, expect, it } from 'vitest';

import {
  DUPLICATE_NAME_MESSAGE,
  ESCALATION_PHONE_MESSAGE,
  escalationPhoneSchema,
  TENANT_NAME_MAX_LENGTH,
  formatContactDays,
  formatContactTime,
  isDuplicateNameError,
  tenantCreateSchema,
  toFieldErrors,
  type TenantFieldErrors,
} from '@/core/shared/tenant';

/** A complete, valid submission — each test perturbs exactly one field. */
const VALID = {
  name: 'Perth Sparks',
  trade_type: 'Electrical',
  timezone: 'Australia/Perth',
  contact_hours_start: '08:00',
  contact_hours_end: '17:00',
  contact_days: ['1', '2', '3', '4', '5'],
  escalation_phone: '',
} as const;

/** Parse an input expected to fail, and return its field-error map. */
function errorsFor(input: Record<string, unknown>): TenantFieldErrors {
  const result = tenantCreateSchema.safeParse(input);
  if (result.success) {
    throw new Error(`Expected validation to fail but it passed: ${JSON.stringify(result.data)}`);
  }
  return toFieldErrors(result.error);
}

describe('tenantCreateSchema — valid input', () => {
  it('accepts a complete submission and normalises it', () => {
    const result = tenantCreateSchema.safeParse(VALID);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: 'Perth Sparks',
      trade_type: 'Electrical',
      timezone: 'Australia/Perth',
      contact_hours_start: '08:00',
      contact_hours_end: '17:00',
      contact_days: [1, 2, 3, 4, 5],
      escalation_phone: null,
    });
  });

  it('deduplicates and sorts contact days rather than rejecting duplicates', () => {
    const result = tenantCreateSchema.safeParse({
      ...VALID,
      contact_days: ['5', '1', '5', '3', '1'],
    });

    expect(result.success).toBe(true);
    expect(result.data?.contact_days).toEqual([1, 3, 5]);
  });

  it('trims surrounding whitespace from free-text fields', () => {
    const result = tenantCreateSchema.safeParse({
      ...VALID,
      name: '  Perth Sparks  ',
      trade_type: ' Electrical ',
    });

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Perth Sparks');
    expect(result.data?.trade_type).toBe('Electrical');
  });
});

describe('tenantCreateSchema — name and trade type', () => {
  it('rejects an empty name', () => {
    expect(errorsFor({ ...VALID, name: '' }).name).toBeTruthy();
  });

  it('rejects a whitespace-only name', () => {
    expect(errorsFor({ ...VALID, name: '   \t ' }).name).toBeTruthy();
  });

  it('rejects a name longer than the column bound', () => {
    const errors = errorsFor({ ...VALID, name: 'x'.repeat(TENANT_NAME_MAX_LENGTH + 1) });
    expect(errors.name).toContain(String(TENANT_NAME_MAX_LENGTH));
  });

  it('accepts a name exactly at the bound', () => {
    const result = tenantCreateSchema.safeParse({
      ...VALID,
      name: 'x'.repeat(TENANT_NAME_MAX_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty trade type', () => {
    expect(errorsFor({ ...VALID, trade_type: '  ' }).trade_type).toBeTruthy();
  });
});

describe('tenantCreateSchema — timezone', () => {
  it('rejects a timezone the runtime does not recognise, naming it in the error', () => {
    const errors = errorsFor({ ...VALID, timezone: 'Australia/Perthh' });
    expect(errors.timezone).toContain('Australia/Perthh');
  });

  it('rejects a UTC offset masquerading as a timezone', () => {
    // Offsets break across DST — the cadence engine needs a real IANA zone.
    expect(errorsFor({ ...VALID, timezone: '+08:00' }).timezone).toBeTruthy();
  });

  it('rejects an empty timezone', () => {
    expect(errorsFor({ ...VALID, timezone: '' }).timezone).toBeTruthy();
  });

  it('accepts every Australian zone the runtime advertises', () => {
    const zones = Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('Australia/'));
    expect(zones.length).toBeGreaterThan(0);

    for (const timezone of zones) {
      expect(tenantCreateSchema.safeParse({ ...VALID, timezone }).success).toBe(true);
    }
  });
});

describe('tenantCreateSchema — contact hours window', () => {
  it('rejects a start equal to the end (adjacency: a zero-width window is not 24h)', () => {
    const errors = errorsFor({
      ...VALID,
      contact_hours_start: '09:00',
      contact_hours_end: '09:00',
    });
    expect(errors.contact_hours_end).toBeTruthy();
  });

  it('rejects a start after the end', () => {
    const errors = errorsFor({
      ...VALID,
      contact_hours_start: '18:00',
      contact_hours_end: '09:00',
    });
    expect(errors.contact_hours_end).toBeTruthy();
  });

  it('accepts a one-minute window', () => {
    const result = tenantCreateSchema.safeParse({
      ...VALID,
      contact_hours_start: '08:00',
      contact_hours_end: '08:01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing start or end — there is no default window', () => {
    expect(errorsFor({ ...VALID, contact_hours_start: '' }).contact_hours_start).toBeTruthy();
    expect(errorsFor({ ...VALID, contact_hours_end: '' }).contact_hours_end).toBeTruthy();
    expect(errorsFor({ ...VALID, contact_hours_start: undefined }).contact_hours_start).toBeTruthy();
  });

  it('rejects a malformed or out-of-range time', () => {
    expect(errorsFor({ ...VALID, contact_hours_start: '8am' }).contact_hours_start).toBeTruthy();
    expect(errorsFor({ ...VALID, contact_hours_start: '25:00' }).contact_hours_start).toBeTruthy();
    expect(errorsFor({ ...VALID, contact_hours_end: '17:60' }).contact_hours_end).toBeTruthy();
  });

  it('normalises an HH:MM:SS time down to HH:MM', () => {
    const result = tenantCreateSchema.safeParse({
      ...VALID,
      contact_hours_start: '08:30:00',
      contact_hours_end: '17:00:00',
    });
    expect(result.success).toBe(true);
    expect(result.data?.contact_hours_start).toBe('08:30');
    expect(result.data?.contact_hours_end).toBe('17:00');
  });
});

describe('tenantCreateSchema — contact days', () => {
  it('rejects an empty day selection', () => {
    expect(errorsFor({ ...VALID, contact_days: [] }).contact_days).toBeTruthy();
  });

  it('rejects a missing day selection', () => {
    expect(errorsFor({ ...VALID, contact_days: undefined }).contact_days).toBeTruthy();
  });

  it('rejects a day below the ISO weekday range', () => {
    expect(errorsFor({ ...VALID, contact_days: ['0', '1'] }).contact_days).toBeTruthy();
  });

  it('rejects a day above the ISO weekday range', () => {
    expect(errorsFor({ ...VALID, contact_days: ['1', '8'] }).contact_days).toBeTruthy();
  });

  it('rejects a non-numeric day', () => {
    expect(errorsFor({ ...VALID, contact_days: ['monday'] }).contact_days).toBeTruthy();
  });

  it('rejects a fractional day', () => {
    expect(errorsFor({ ...VALID, contact_days: ['1.5'] }).contact_days).toBeTruthy();
  });
});

describe('tenantCreateSchema — escalation phone', () => {
  it('treats an omitted or blank phone as absent', () => {
    const omitted = tenantCreateSchema.safeParse({ ...VALID, escalation_phone: undefined });
    expect(omitted.success).toBe(true);
    expect(omitted.data?.escalation_phone).toBeNull();

    const blank = tenantCreateSchema.safeParse({ ...VALID, escalation_phone: '   ' });
    expect(blank.success).toBe(true);
    expect(blank.data?.escalation_phone).toBeNull();
  });

  it('accepts a national AU mobile', () => {
    const result = tenantCreateSchema.safeParse({ ...VALID, escalation_phone: '0412345678' });
    expect(result.success).toBe(true);
    expect(result.data?.escalation_phone).toBe('0412345678');
  });

  it('accepts an E.164 AU mobile', () => {
    const result = tenantCreateSchema.safeParse({ ...VALID, escalation_phone: '+61412345678' });
    expect(result.success).toBe(true);
    expect(result.data?.escalation_phone).toBe('+61412345678');
  });

  it('strips the separators operators actually type', () => {
    const result = tenantCreateSchema.safeParse({ ...VALID, escalation_phone: '0412 345 678' });
    expect(result.success).toBe(true);
    expect(result.data?.escalation_phone).toBe('0412345678');
  });

  it('rejects a landline, a truncated mobile and free text', () => {
    expect(errorsFor({ ...VALID, escalation_phone: '0893451234' }).escalation_phone).toBeTruthy();
    expect(errorsFor({ ...VALID, escalation_phone: '041234567' }).escalation_phone).toBeTruthy();
    expect(errorsFor({ ...VALID, escalation_phone: 'call the office' }).escalation_phone).toBeTruthy();
  });
});

/**
 * THE ESCALATION NUMBER'S ONE VALIDATION PATH (CON-03, 06-06).
 *
 * The column became EDITABLE after creation — `updateEscalationPhoneAction` on
 * the client page — and the edit goes through this exact object rather than
 * through a second AU-mobile pattern beside it. This is the field that decides
 * which handset a hot lead lands on, so a second spelling is the CR-01 defect at
 * its worst: two rules agree until one is loosened, and the loosened one is the
 * one that texts a stranger.
 *
 * The identity is asserted BEHAVIOURALLY below — the same matrix, through both
 * entry points, expecting the same answers — rather than by grepping for an
 * import, because behaviour is what the two callers actually share.
 */
describe('escalationPhoneSchema — refuse, never repair', () => {
  /** Every case, and what each one is guarding. */
  const MATRIX: ReadonlyArray<{ input: string | null | undefined; expected: string | null }> = [
    // Accepted, in both stored forms.
    { input: '0412345678', expected: '0412345678' },
    { input: '+61412345678', expected: '+61412345678' },
    // Separators a person actually types are stripped — that is normalising the
    // TYPING, not repairing the NUMBER.
    { input: '0412 345 678', expected: '0412345678' },
    { input: '(04) 1234-5678', expected: '0412345678' },
    // Absent, in every shape that means it.
    { input: '', expected: null },
    { input: '   ', expected: null },
    { input: null, expected: null },
    { input: undefined, expected: null },
    // Refused. Each of these has an obvious "fix" and NONE of them is applied.
    { input: '412345678', expected: null }, // missing leading zero
    { input: '61412345678', expected: null }, // missing the +
    { input: '0893451234', expected: null }, // landline — not SMS-reachable
    { input: '041234567', expected: null }, // one digit short
    { input: '04123456789', expected: null }, // one digit long
    { input: '+14155550123', expected: null }, // a valid mobile, wrong country
    { input: 'call the office', expected: null },
    { input: '0412345678 or 0498765432', expected: null }, // two numbers, one column
  ];

  const REFUSED = MATRIX.filter(
    (row) => row.expected === null && typeof row.input === 'string' && row.input.trim() !== '',
  );

  it('accepts both AU mobile forms and the separators operators type', () => {
    for (const row of MATRIX.filter((r) => r.expected !== null)) {
      const result = escalationPhoneSchema.safeParse(row.input);
      expect(result.success, `expected ${String(row.input)} to be accepted`).toBe(true);
      expect(result.data).toBe(row.expected);
    }
  });

  it('REFUSES a number missing its leading zero — it does not add one', () => {
    // The Phase 3 rule, stated where it bites: a repaired digit is a text
    // message to a stranger, and the stranger it reaches is then sent a
    // tradie's customer's name and phone number.
    const result = escalationPhoneSchema.safeParse('412345678');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ESCALATION_PHONE_MESSAGE);
  });

  it('refuses every unrepairable shape with the same fixable message', () => {
    for (const row of REFUSED) {
      const result = escalationPhoneSchema.safeParse(row.input);
      expect(result.success, `expected ${String(row.input)} to be refused`).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(ESCALATION_PHONE_MESSAGE);
    }
  });

  it('treats blank, whitespace and a null as a deliberate clear, not a failure', () => {
    for (const input of ['', '   ', '()- .', null, undefined]) {
      const result = escalationPhoneSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    }
  });

  it('gives the SAME answer as the create form for every case in the matrix', () => {
    for (const row of MATRIX) {
      const direct = escalationPhoneSchema.safeParse(row.input);
      const viaForm = tenantCreateSchema.safeParse({ ...VALID, escalation_phone: row.input });

      expect(direct.success, `direct vs form disagreed on ${String(row.input)}`).toBe(
        viaForm.success,
      );
      if (direct.success && viaForm.success) {
        expect(direct.data).toBe(viaForm.data.escalation_phone);
      }
    }
  });
});

describe('toFieldErrors', () => {
  it('reports every failing field at once, not just the first', () => {
    const errors = errorsFor({
      name: '',
      trade_type: '',
      timezone: 'Nowhere/Nothing',
      contact_hours_start: '',
      contact_hours_end: '',
      contact_days: [],
      escalation_phone: 'nope',
    });

    expect(Object.keys(errors).sort()).toEqual(
      [
        'contact_days',
        'contact_hours_end',
        'contact_hours_start',
        'escalation_phone',
        'name',
        'timezone',
        'trade_type',
      ].sort(),
    );
  });

  it('attributes an error on an array element to its parent field', () => {
    // Element issues carry a path like ['contact_days', 0]; the form has one
    // control for the whole set, so the message must land on contact_days.
    const errors = errorsFor({ ...VALID, contact_days: ['1', '99'] });
    expect(errors.contact_days).toBeTruthy();
  });
});

describe('isDuplicateNameError', () => {
  it('recognises the Postgres unique-violation SQLSTATE', () => {
    expect(isDuplicateNameError({ code: '23505', message: 'duplicate key value' })).toBe(true);
  });

  it('recognises the index by name when the code is not surfaced', () => {
    expect(
      isDuplicateNameError({
        message: 'duplicate key value violates unique constraint "tenants_name_lower_key"',
      }),
    ).toBe(true);
  });

  it('does not claim unrelated failures', () => {
    expect(isDuplicateNameError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isDuplicateNameError({ message: 'network error' })).toBe(false);
    expect(isDuplicateNameError(null)).toBe(false);
  });

  it('exposes an operator-facing message for the duplicate case', () => {
    expect(DUPLICATE_NAME_MESSAGE).toMatch(/already exists/i);
  });
});

describe('contact-hours display helpers', () => {
  it('collapses a consecutive run of days', () => {
    expect(formatContactDays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
  });

  it('lists non-consecutive days', () => {
    expect(formatContactDays([1, 3, 5])).toBe('Mon, Wed, Fri');
  });

  it('mixes runs and singletons', () => {
    expect(formatContactDays([1, 2, 3, 6])).toBe('Mon–Wed, Sat');
  });

  it('names a full week', () => {
    expect(formatContactDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
  });

  it('sorts and deduplicates before formatting', () => {
    expect(formatContactDays([3, 1, 2, 3])).toBe('Mon–Wed');
  });

  it('has a placeholder for no days and unknown times', () => {
    expect(formatContactDays([])).toBe('—');
    expect(formatContactDays(null)).toBe('—');
    expect(formatContactTime(null)).toBe('—');
  });

  it('trims the seconds Postgres returns on a time column', () => {
    expect(formatContactTime('08:00:00')).toBe('08:00');
    expect(formatContactTime('17:30')).toBe('17:30');
  });
});
