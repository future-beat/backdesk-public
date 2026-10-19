/**
 * THE TEXT-BACK ADMIN RULES (Phase 12, D-02, D-06, IN-07) — save, attest, add,
 * remove. The operator's hand on the exact wording, and the client's own lines
 * on the never-text list.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT IS PROVEN HERE IS WHAT THE DATABASE IS NEVER ASKED. A refused       │
 * │ wording inserts nothing; a blank note stamps nothing; a number that is   │
 * │ not Australian is never offered to the column CHECK; the last own line   │
 * │ of an armed client is never deleted. Each assertion below is about a     │
 * │ write that did NOT happen as much as one that did.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE: `@/db/repository` is replaced by recording fakes for exactly the
 * namespaces these functions touch (`tenant`, `textBackTemplates`,
 * `neverText`) and `isTextBackArmed`. The validator, the defaults and
 * `classifyCaller` are REAL — they are the rules under test, and a mocked
 * validator would prove the save calls something rather than that it refuses
 * anything. Runs on a bare `npx vitest run`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTextBackBody } from '@/core/leads/template';
import type { TenantNeverTextNumber, TextBackTemplate } from '@/db/schema';

const TENANT_ID = '77777777-7777-4777-8777-777777777777';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const NAME = "Dave's Electrical";

/* ------------------------------------------------------------------------- *
 * The recording fakes
 * ------------------------------------------------------------------------- */

let tenantRows: { id: string; name: string; timezone: string }[] = [];
let templateRows: TextBackTemplate[] = [];
let neverTextRows: TenantNeverTextNumber[] = [];
let armed = false;

const insertVersion = vi.fn();
const attestWhereUnattested = vi.fn();
const latestForVariant = vi.fn();
const byId = vi.fn();
const neverTextAdd = vi.fn();
const neverTextRemove = vi.fn();
const countOwnLines = vi.fn();
const isTextBackArmed = vi.fn();

function templateRow(overrides: Partial<TextBackTemplate> = {}): TextBackTemplate {
  return {
    id: VERSION_ID,
    tenantId: TENANT_ID,
    variant: 'business_hours',
    version: 1,
    body: defaultTextBackBody('business_hours', NAME),
    segments: 2,
    attestedAt: null,
    attestedBy: null,
    attestationNote: null,
    createdBy: OPERATOR_ID,
    createdAt: new Date('2026-10-06T00:00:00Z'),
    ...overrides,
  };
}

function neverTextRow(overrides: Partial<TenantNeverTextNumber> = {}): TenantNeverTextNumber {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tenantId: TENANT_ID,
    numberE164: '+61412345678',
    kind: 'own_line',
    label: null,
    createdBy: OPERATOR_ID,
    createdAt: new Date('2026-10-06T00:00:00Z'),
    ...overrides,
  };
}

vi.mock('@/db/repository', () => ({
  forTenant: (tenantId: string) => ({
    tenant: {
      get: async () => tenantRows.filter((row) => row.id === tenantId),
    },
    textBackTemplates: {
      insertVersion: (row: unknown) => insertVersion(row),
      attestWhereUnattested: (...args: unknown[]) => attestWhereUnattested(...args),
      latestForVariant: (variant: string) => latestForVariant(variant),
      byId: (id: string) => byId(id),
    },
    neverText: {
      list: async () => neverTextRows.filter((row) => row.tenantId === tenantId),
      add: (row: unknown) => neverTextAdd(row),
      remove: (id: string) => neverTextRemove(id),
      countOwnLines: () => countOwnLines(),
    },
  }),
  isTextBackArmed: (tenantId: string) => isTextBackArmed(tenantId),
}));

const { saveTextBackTemplate, attestTextBackTemplate } = await import(
  '@/core/leads/template-admin'
);
const { addNeverTextNumber, normalizeNeverTextInput, removeNeverTextNumber } = await import(
  '@/core/leads/never-text'
);

beforeEach(() => {
  vi.clearAllMocks();
  tenantRows = [{ id: TENANT_ID, name: NAME, timezone: 'Australia/Perth' }];
  templateRows = [];
  neverTextRows = [];
  armed = false;

  insertVersion.mockImplementation(async (row: { variant: string; body: string; segments: number }) => {
    const created = templateRow({
      id: '66666666-6666-4666-8666-666666666666',
      variant: row.variant,
      body: row.body,
      segments: row.segments,
      version: templateRows.length + 1,
    });
    templateRows.push(created);
    return [created];
  });
  latestForVariant.mockImplementation(async (variant: string) =>
    templateRows.filter((row) => row.variant === variant).slice(-1),
  );
  byId.mockImplementation(async (id: string) => templateRows.filter((row) => row.id === id));
  attestWhereUnattested.mockImplementation(
    async (id: string, note: string, by: string, at: Date) => {
      const row = templateRows.find((r) => r.id === id && r.attestedAt === null);
      if (!row) return [];
      row.attestedAt = at;
      row.attestedBy = by;
      row.attestationNote = note;
      return [row];
    },
  );
  neverTextAdd.mockImplementation(
    async (row: { numberE164: string; kind: string; label: string | null }) => {
      if (neverTextRows.some((r) => r.numberE164 === row.numberE164)) return [];
      const created = neverTextRow({
        id: `55555555-5555-4555-8555-${String(neverTextRows.length).padStart(12, '0')}`,
        numberE164: row.numberE164,
        kind: row.kind,
        label: row.label,
      });
      neverTextRows.push(created);
      return [created];
    },
  );
  neverTextRemove.mockImplementation(async (id: string) => {
    const index = neverTextRows.findIndex((r) => r.id === id);
    if (index === -1) return [];
    return neverTextRows.splice(index, 1);
  });
  countOwnLines.mockImplementation(
    async () => neverTextRows.filter((r) => r.kind === 'own_line').length,
  );
  isTextBackArmed.mockImplementation(async () => armed);
});

/* ------------------------------------------------------------------------- *
 * saveTextBackTemplate
 * ------------------------------------------------------------------------- */

describe('saveTextBackTemplate (D-02)', () => {
  it('saves a valid wording as one UNATTESTED version with its segment count', async () => {
    const body = defaultTextBackBody('business_hours', NAME);

    const result = await saveTextBackTemplate(TENANT_ID, {
      variant: 'business_hours',
      body,
      operatorUserId: OPERATOR_ID,
    });

    expect(result).toEqual({ kind: 'saved', version: 1, segments: 2 });
    expect(insertVersion).toHaveBeenCalledTimes(1);
    expect(insertVersion).toHaveBeenCalledWith({
      variant: 'business_hours',
      body,
      segments: 2,
      createdBy: OPERATOR_ID,
    });
    // A save is never an attestation.
    expect(attestWhereUnattested).not.toHaveBeenCalled();
    expect(templateRows[0]?.attestedAt).toBeNull();
  });

  it('stores the NORMALISED body — a curly apostrophe becomes a straight one', async () => {
    const curly = defaultTextBackBody('about_quote', NAME).replace(/'/g, '’');
    expect(curly).toContain('’');

    const result = await saveTextBackTemplate(TENANT_ID, {
      variant: 'about_quote',
      body: curly,
      operatorUserId: OPERATOR_ID,
    });

    expect(result.kind).toBe('saved');
    const stored = (insertVersion.mock.calls[0]?.[0] as { body: string }).body;
    expect(stored).not.toContain('’');
    expect(stored).toBe(defaultTextBackBody('about_quote', NAME));
  });

  it.each([
    ['empty', '   '],
    ['missing_identity', defaultTextBackBody('business_hours', 'Someone Else Plumbing')],
    ['missing_stop', defaultTextBackBody('business_hours', NAME).replace('Reply STOP', 'Text NO')],
    [
      'missing_privacy_pointer',
      defaultTextBackBody('business_hours', NAME).replace('backdesk.com.au/privacy', 'our site'),
    ],
    ['extra_link', `${defaultTextBackBody('about_quote', NAME)} www.example.com`],
    ['merge_token_left', defaultTextBackBody('about_quote', '{business}').replace('{business}', `${NAME} {name}`)],
    ['not_gsm7', `${defaultTextBackBody('about_quote', NAME)} \u{1F44D}`],
    ['too_many_segments', `${defaultTextBackBody('after_hours', NAME)} ${'x'.repeat(200)}`],
  ])('refuses a wording that fails %s and inserts NOTHING', async (rule, body) => {
    const result = await saveTextBackTemplate(TENANT_ID, {
      variant: 'business_hours',
      body,
      operatorUserId: OPERATOR_ID,
    });

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('unreachable');
    expect(result.violations.map((v) => v.rule)).toContain(rule);
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('refuses a resubmission identical to the latest version — no copy is minted', async () => {
    const body = defaultTextBackBody('business_hours', NAME);
    templateRows.push(templateRow({ body, attestedAt: new Date(), attestedBy: OPERATOR_ID, attestationNote: 'read back' }));

    const result = await saveTextBackTemplate(TENANT_ID, {
      variant: 'business_hours',
      body,
      operatorUserId: OPERATOR_ID,
    });

    expect(result).toEqual({ kind: 'unchanged' });
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('answers tenant_missing for a tenant with no row, and writes nothing', async () => {
    tenantRows = [];

    const result = await saveTextBackTemplate(TENANT_ID, {
      variant: 'business_hours',
      body: defaultTextBackBody('business_hours', NAME),
      operatorUserId: OPERATOR_ID,
    });

    expect(result).toEqual({ kind: 'tenant_missing' });
    expect(insertVersion).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * attestTextBackTemplate
 * ------------------------------------------------------------------------- */

describe('attestTextBackTemplate (D-02 — write-once, note required, re-validated)', () => {
  const NOW = new Date('2026-10-06T03:00:00Z');

  it('attests an unattested version with the operator and their note', async () => {
    templateRows.push(templateRow());

    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: '  Read back to Dave on the phone  ',
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result).toEqual({ kind: 'attested', variant: 'business_hours', version: 1 });
    expect(attestWhereUnattested).toHaveBeenCalledWith(
      VERSION_ID,
      'Read back to Dave on the phone',
      OPERATOR_ID,
      NOW,
    );
  });

  it('refuses a blank note BEFORE anything is read, and writes nothing', async () => {
    templateRows.push(templateRow());

    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: '   ',
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result).toEqual({ kind: 'note_required' });
    expect(byId).not.toHaveBeenCalled();
    expect(attestWhereUnattested).not.toHaveBeenCalled();
  });

  it('refuses a note over 500 characters', async () => {
    templateRows.push(templateRow());

    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: 'x'.repeat(501),
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result).toEqual({ kind: 'note_too_long' });
    expect(attestWhereUnattested).not.toHaveBeenCalled();
  });

  it('answers already_attested for an attested version and never re-stamps it', async () => {
    const first = new Date('2026-10-01T00:00:00Z');
    templateRows.push(
      templateRow({ attestedAt: first, attestedBy: OPERATOR_ID, attestationNote: 'by email' }),
    );

    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: 'again',
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result).toEqual({ kind: 'already_attested' });
    expect(attestWhereUnattested).not.toHaveBeenCalled();
    expect(templateRows[0]?.attestedAt).toBe(first);
    expect(templateRows[0]?.attestationNote).toBe('by email');
  });

  it('answers already_attested when the guarded UPDATE loses a race (zero rows)', async () => {
    templateRows.push(templateRow());
    attestWhereUnattested.mockResolvedValueOnce([]);

    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: 'read back',
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result).toEqual({ kind: 'already_attested' });
  });

  it('refuses a version whose stored body no longer names the business (renamed)', async () => {
    templateRows.push(templateRow());
    tenantRows = [{ id: TENANT_ID, name: 'Perth Sparkies', timezone: 'Australia/Perth' }];

    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: 'read back',
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('unreachable');
    expect(result.violations.map((v) => v.rule)).toEqual(['missing_identity']);
    expect(attestWhereUnattested).not.toHaveBeenCalled();
  });

  it('answers not_found for an unknown or another client’s version', async () => {
    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: 'read back',
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result).toEqual({ kind: 'not_found' });
    expect(attestWhereUnattested).not.toHaveBeenCalled();
  });

  it('answers tenant_missing when the tenant row is gone', async () => {
    templateRows.push(templateRow());
    tenantRows = [];

    const result = await attestTextBackTemplate(TENANT_ID, {
      versionId: VERSION_ID,
      note: 'read back',
      operatorUserId: OPERATOR_ID,
      now: NOW,
    });

    expect(result).toEqual({ kind: 'tenant_missing' });
    expect(attestWhereUnattested).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * normalizeNeverTextInput
 * ------------------------------------------------------------------------- */

describe('normalizeNeverTextInput — one spelling per number (T-12-24)', () => {
  it.each(['0412 345 678', '+61 412 345 678', '61412345678', '0412-345-678', '+61412345678'])(
    '%s stores as +61412345678',
    (raw) => {
      expect(normalizeNeverTextInput(raw)).toBe('+61412345678');
    },
  );

  it.each(['(08) 9123 4567', '08 9123 4567', '+61 8 9123 4567', '+61891234567'])(
    'the landline %s stores as +61891234567',
    (raw) => {
      expect(normalizeNeverTextInput(raw)).toBe('+61891234567');
    },
  );

  it.each([
    ['a UK number', '+44 1632 960123'],
    ['a UK number without spaces', '+441632960123'],
    ['the withheld word', 'anonymous'],
    ['a withheld keypad sentinel', '+266696687'],
    ['an empty string', ''],
    ['words', 'not a number'],
    ['a 1300 number', '1300 123 456'],
    ['a mobile that lost its zero', '412345678'],
  ])('refuses %s', (_label, raw) => {
    expect(normalizeNeverTextInput(raw)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- *
 * addNeverTextNumber
 * ------------------------------------------------------------------------- */

describe('addNeverTextNumber (D-06, IN-07)', () => {
  it('adds a new number in its normalised spelling, with the operator', async () => {
    const result = await addNeverTextNumber(TENANT_ID, {
      input: '0412 345 678',
      kind: 'own_line',
      label: '  Dave’s mobile ',
      operatorUserId: OPERATOR_ID,
    });

    expect(result.kind).toBe('added');
    expect(neverTextAdd).toHaveBeenCalledWith({
      numberE164: '+61412345678',
      kind: 'own_line',
      label: 'Dave’s mobile',
      createdBy: OPERATOR_ID,
    });
  });

  it('three spellings of one mobile land on ONE row', async () => {
    const first = await addNeverTextNumber(TENANT_ID, {
      input: '0412 345 678',
      kind: 'own_line',
      label: null,
      operatorUserId: OPERATOR_ID,
    });
    const second = await addNeverTextNumber(TENANT_ID, {
      input: '+61 412 345 678',
      kind: 'never_text',
      label: null,
      operatorUserId: OPERATOR_ID,
    });
    const third = await addNeverTextNumber(TENANT_ID, {
      input: '61412345678',
      kind: 'own_line',
      label: null,
      operatorUserId: OPERATOR_ID,
    });

    expect([first.kind, second.kind, third.kind]).toEqual([
      'added',
      'already_listed',
      'already_listed',
    ]);
    expect(neverTextRows).toHaveLength(1);
    expect(neverTextRows[0]?.numberE164).toBe('+61412345678');
  });

  it('accepts an Australian landline as an own line', async () => {
    const result = await addNeverTextNumber(TENANT_ID, {
      input: '(08) 9123 4567',
      kind: 'own_line',
      label: 'office',
      operatorUserId: OPERATOR_ID,
    });

    expect(result.kind).toBe('added');
    expect(neverTextRows[0]?.numberE164).toBe('+61891234567');
  });

  it.each(['+44 1632 960123', 'anonymous', '', 'not a number'])(
    'refuses %j as invalid_number and asks the database nothing',
    async (input) => {
      const result = await addNeverTextNumber(TENANT_ID, {
        input,
        kind: 'never_text',
        label: null,
        operatorUserId: OPERATOR_ID,
      });

      expect(result).toEqual({ kind: 'invalid_number' });
      expect(neverTextAdd).not.toHaveBeenCalled();
    },
  );

  it('refuses a label over 60 characters', async () => {
    const result = await addNeverTextNumber(TENANT_ID, {
      input: '0412 345 678',
      kind: 'own_line',
      label: 'x'.repeat(61),
      operatorUserId: OPERATOR_ID,
    });

    expect(result).toEqual({ kind: 'invalid_label' });
    expect(neverTextAdd).not.toHaveBeenCalled();
  });

  it('stores a blank label as null, not an empty string', async () => {
    await addNeverTextNumber(TENANT_ID, {
      input: '0412 345 678',
      kind: 'own_line',
      label: '   ',
      operatorUserId: OPERATOR_ID,
    });

    expect((neverTextAdd.mock.calls[0]?.[0] as { label: unknown }).label).toBeNull();
  });

  it('never returns the number it was given in any result', async () => {
    const results = [
      await addNeverTextNumber(TENANT_ID, {
        input: '0412 345 678',
        kind: 'own_line',
        label: null,
        operatorUserId: OPERATOR_ID,
      }),
      await addNeverTextNumber(TENANT_ID, {
        input: '0412 345 678',
        kind: 'own_line',
        label: null,
        operatorUserId: OPERATOR_ID,
      }),
      await addNeverTextNumber(TENANT_ID, {
        input: '+44 1632 960123',
        kind: 'own_line',
        label: null,
        operatorUserId: OPERATOR_ID,
      }),
    ];

    for (const result of results) {
      expect(JSON.stringify(result)).not.toMatch(/412|345|678|1632|960123/);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * removeNeverTextNumber
 * ------------------------------------------------------------------------- */

describe('removeNeverTextNumber — an armed client keeps an own line (IN-07, T-12-23)', () => {
  const OWN_A = neverTextRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'own_line' });
  const OWN_B = neverTextRow({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    kind: 'own_line',
    numberE164: '+61891234567',
  });
  const NEVER = neverTextRow({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    kind: 'never_text',
    numberE164: '+61498765432',
  });

  it('refuses to remove the LAST own line while text-back is armed', async () => {
    neverTextRows = [{ ...OWN_A }, { ...NEVER }];
    armed = true;

    const result = await removeNeverTextNumber(TENANT_ID, OWN_A.id);

    expect(result).toEqual({ kind: 'last_own_line_while_armed' });
    expect(neverTextRemove).not.toHaveBeenCalled();
    expect(neverTextRows).toHaveLength(2);
    expect(isTextBackArmed).toHaveBeenCalledWith(TENANT_ID);
  });

  it('removes the last own line when text-back is NOT armed', async () => {
    neverTextRows = [{ ...OWN_A }];
    armed = false;

    const result = await removeNeverTextNumber(TENANT_ID, OWN_A.id);

    expect(result).toEqual({ kind: 'removed' });
    expect(neverTextRemove).toHaveBeenCalledWith(OWN_A.id);
    expect(neverTextRows).toHaveLength(0);
  });

  it('removes one own line of two even while armed', async () => {
    neverTextRows = [{ ...OWN_A }, { ...OWN_B }];
    armed = true;

    const result = await removeNeverTextNumber(TENANT_ID, OWN_A.id);

    expect(result).toEqual({ kind: 'removed' });
    expect(neverTextRows.map((r) => r.id)).toEqual([OWN_B.id]);
  });

  it('removes a never_text entry while armed — only own lines are guarded', async () => {
    neverTextRows = [{ ...OWN_A }, { ...NEVER }];
    armed = true;

    const result = await removeNeverTextNumber(TENANT_ID, NEVER.id);

    expect(result).toEqual({ kind: 'removed' });
    // The arming read is not needed for a never_text row.
    expect(isTextBackArmed).not.toHaveBeenCalled();
  });

  it('answers not_found for an unknown id', async () => {
    neverTextRows = [{ ...OWN_A }];

    const result = await removeNeverTextNumber(TENANT_ID, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');

    expect(result).toEqual({ kind: 'not_found' });
    expect(neverTextRemove).not.toHaveBeenCalled();
  });

  it('answers not_found for ANOTHER client’s id — the list read is tenant-scoped', async () => {
    neverTextRows = [{ ...OWN_A, tenantId: '99999999-9999-4999-8999-999999999999' }];

    const result = await removeNeverTextNumber(TENANT_ID, OWN_A.id);

    expect(result).toEqual({ kind: 'not_found' });
    expect(neverTextRemove).not.toHaveBeenCalled();
  });

  it('answers not_found when the row vanished between the read and the delete', async () => {
    neverTextRows = [{ ...NEVER }];
    neverTextRemove.mockResolvedValueOnce([]);

    const result = await removeNeverTextNumber(TENANT_ID, NEVER.id);

    expect(result).toEqual({ kind: 'not_found' });
  });
});
