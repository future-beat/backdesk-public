/**
 * THE TEXT-BACK ACTIONS (Phase 12, 12-06) — guard order and copy mapping.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY ACTION HERE IS A GLOBALLY-POSTABLE ENDPOINT (T-12-11). The         │
 * │ assertions are about the SERVER: an operator who is not one, or a       │
 * │ client the operator does not hold, is refused BEFORE a single form      │
 * │ field is read — proven with a FormData whose getters throw.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE: the two core modules and `next/cache` are mocked, and Supabase's
 * client is faked ONE LEVEL BELOW `requireOperatorId` (the arming-actions
 * mould) so the real allowlist gate runs against a fake session. The
 * sentences are REAL, imported from `action-state.ts` — the mapping under test
 * is "this result kind becomes that sentence", not "some string came back".
 * The business rules themselves are tests/text-back-admin.test.ts's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveTextBackTemplate = vi.fn();
const attestTextBackTemplate = vi.fn();
const addNeverTextNumber = vi.fn();
const removeNeverTextNumber = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/core/leads/template-admin', () => ({
  saveTextBackTemplate: (...args: unknown[]) => saveTextBackTemplate(...args),
  attestTextBackTemplate: (...args: unknown[]) => attestTextBackTemplate(...args),
}));

vi.mock('@/core/leads/never-text', () => ({
  addNeverTextNumber: (...args: unknown[]) => addNeverTextNumber(...args),
  removeNeverTextNumber: (...args: unknown[]) => removeNeverTextNumber(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const TENANT_ID = '77777777-7777-4777-8777-777777777777';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const ENTRY_ID = '55555555-5555-4555-8555-555555555555';

let session: { userId: string | null; allowlisted: boolean; member: boolean } = {
  userId: OPERATOR_ID,
  allowlisted: true,
  member: true,
};

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
          maybeSingle: async () => {
            if (table === 'operator_allowlist') {
              return session.allowlisted
                ? { data: { user_id: session.userId }, error: null }
                : { data: null, error: null };
            }
            // The membership read, through the operator's own JWT.
            return session.member
              ? { data: { id: TENANT_ID }, error: null }
              : { data: null, error: null };
          },
        }),
      }),
    }),
  }),
}));

const {
  addNeverTextNumberAction,
  attestTextBackTemplateAction,
  removeNeverTextNumberAction,
  saveTextBackTemplateAction,
} = await import('@/app/(console)/clients/[id]/text-back/actions');
const copy = await import('@/app/(console)/clients/[id]/text-back/action-state');
const { OPERATOR_DENIED_MESSAGE } = await import('@/app/(console)/_auth');

const BLANK = copy.BLANK_TEXT_BACK_STATE;

/** A FormData whose every read throws — the guard must refuse without one. */
function poisonedFormData(): FormData {
  const fail = () => {
    throw new Error('formData was read before authorization');
  };
  return {
    get: fail,
    getAll: fail,
    has: fail,
    entries: fail,
    keys: fail,
    values: fail,
    forEach: fail,
    [Symbol.iterator]: fail,
  } as unknown as FormData;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const ACTIONS = [
  ['saveTextBackTemplateAction', saveTextBackTemplateAction, saveTextBackTemplate],
  ['attestTextBackTemplateAction', attestTextBackTemplateAction, attestTextBackTemplate],
  ['addNeverTextNumberAction', addNeverTextNumberAction, addNeverTextNumber],
  ['removeNeverTextNumberAction', removeNeverTextNumberAction, removeNeverTextNumber],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  session = { userId: OPERATOR_ID, allowlisted: true, member: true };
});

/* ------------------------------------------------------------------------- *
 * The guard order (T-12-11)
 * ------------------------------------------------------------------------- */

describe('every action authorizes BEFORE reading the form', () => {
  it.each(ACTIONS)('%s refuses a signed-out caller without reading formData', async (_n, action, core) => {
    session = { userId: null, allowlisted: false, member: false };

    const state = await action(TENANT_ID, BLANK, poisonedFormData());

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.unauthenticated);
    expect(core).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s refuses a session that is not an operator', async (_n, action, core) => {
    session = { userId: OPERATOR_ID, allowlisted: false, member: true };

    const state = await action(TENANT_ID, BLANK, poisonedFormData());

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.forbidden);
    expect(core).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s refuses an operator who does not hold the client', async (_n, action, core) => {
    session = { userId: OPERATOR_ID, allowlisted: true, member: false };

    const state = await action(TENANT_ID, BLANK, poisonedFormData());

    expect(state.error).toBe(copy.UNKNOWN_CLIENT_MESSAGE);
    expect(core).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s refuses a malformed tenant id', async (_n, action, core) => {
    const state = await action('not-a-uuid', BLANK, poisonedFormData());

    expect(state.error).toBe(copy.UNKNOWN_CLIENT_MESSAGE);
    expect(core).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * The zod boundary — refused before the core is asked
 * ------------------------------------------------------------------------- */

describe('malformed fields never reach the core', () => {
  it('an unknown variant', async () => {
    const state = await saveTextBackTemplateAction(
      TENANT_ID,
      BLANK,
      form({ variant: 'weekend', body: 'Hi' }),
    );

    expect(state.error).toBe(copy.BAD_REQUEST_MESSAGE);
    expect(saveTextBackTemplate).not.toHaveBeenCalled();
  });

  it('an empty body', async () => {
    const state = await saveTextBackTemplateAction(
      TENANT_ID,
      BLANK,
      form({ variant: 'business_hours', body: '' }),
    );

    expect(state.error).toBe(copy.TEMPLATE_RULE_MESSAGE.empty);
    expect(saveTextBackTemplate).not.toHaveBeenCalled();
  });

  it('a body past the field bound', async () => {
    const state = await saveTextBackTemplateAction(
      TENANT_ID,
      BLANK,
      form({ variant: 'business_hours', body: 'x'.repeat(copy.TEXT_BACK_BODY_FIELD_MAX + 1) }),
    );

    expect(state.error).toBe(copy.TEMPLATE_BODY_TOO_LONG_MESSAGE);
    expect(saveTextBackTemplate).not.toHaveBeenCalled();
  });

  it('a version id that is not a uuid', async () => {
    const state = await attestTextBackTemplateAction(
      TENANT_ID,
      BLANK,
      form({ version_id: '1', attestation_note: 'read back' }),
    );

    expect(state.error).toBe(copy.TEMPLATE_VERSION_NOT_FOUND_MESSAGE);
    expect(attestTextBackTemplate).not.toHaveBeenCalled();
  });

  it('an unknown never-text kind', async () => {
    const state = await addNeverTextNumberAction(
      TENANT_ID,
      BLANK,
      form({ number: '0412 345 678', kind: 'supplier', label: '' }),
    );

    expect(state.error).toBe(copy.BAD_REQUEST_MESSAGE);
    expect(addNeverTextNumber).not.toHaveBeenCalled();
  });

  it('an entry id that is not a uuid', async () => {
    const state = await removeNeverTextNumberAction(TENANT_ID, BLANK, form({ entry_id: 'x' }));

    expect(state.error).toBe(copy.NEVER_TEXT_NOT_FOUND_MESSAGE);
    expect(removeNeverTextNumber).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * What the core is given
 * ------------------------------------------------------------------------- */

describe('the core receives the verified operator, never a form field', () => {
  it('save passes the variant, the body and the operator id', async () => {
    saveTextBackTemplate.mockResolvedValue({ kind: 'saved', version: 3, segments: 2 });

    await saveTextBackTemplateAction(
      TENANT_ID,
      BLANK,
      form({ variant: 'after_hours', body: 'Hi there', operator_user_id: 'attacker' }),
    );

    expect(saveTextBackTemplate).toHaveBeenCalledWith(TENANT_ID, {
      variant: 'after_hours',
      body: 'Hi there',
      operatorUserId: OPERATOR_ID,
    });
  });

  it('attest passes the note as typed (the core trims and requires it)', async () => {
    attestTextBackTemplate.mockResolvedValue({
      kind: 'attested',
      variant: 'business_hours',
      version: 1,
    });

    await attestTextBackTemplateAction(
      TENANT_ID,
      BLANK,
      form({ version_id: VERSION_ID, attestation_note: '  by phone ' }),
    );

    const [tenantId, input] = attestTextBackTemplate.mock.calls[0] as [
      string,
      { versionId: string; note: string; operatorUserId: string; now: Date },
    ];
    expect(tenantId).toBe(TENANT_ID);
    expect(input.versionId).toBe(VERSION_ID);
    expect(input.note).toBe('  by phone ');
    expect(input.operatorUserId).toBe(OPERATOR_ID);
    expect(input.now).toBeInstanceOf(Date);
  });

  it('add passes the raw number to the one normaliser', async () => {
    addNeverTextNumber.mockResolvedValue({ kind: 'added', id: ENTRY_ID });

    await addNeverTextNumberAction(
      TENANT_ID,
      BLANK,
      form({ number: '0412 345 678', kind: 'own_line', label: 'office' }),
    );

    expect(addNeverTextNumber).toHaveBeenCalledWith(TENANT_ID, {
      input: '0412 345 678',
      kind: 'own_line',
      label: 'office',
      operatorUserId: OPERATOR_ID,
    });
  });
});

/* ------------------------------------------------------------------------- *
 * Every result kind → its sentence
 * ------------------------------------------------------------------------- */

describe('saveTextBackTemplateAction maps every result kind', () => {
  const FIELDS = { variant: 'business_hours', body: 'Hi' };

  it('saved → the version, its segments, and "not in use until you attest it"', async () => {
    saveTextBackTemplate.mockResolvedValue({ kind: 'saved', version: 2, segments: 2 });

    const state = await saveTextBackTemplateAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state).toEqual({ error: null, success: copy.templateSavedMessage(2, 2) });
    expect(state.success).toBe(
      'Saved as version 2 — 2 segments. Not in use until you attest it.',
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}/text-back`);
  });

  it('invalid → one sentence per violated rule', async () => {
    saveTextBackTemplate.mockResolvedValue({
      kind: 'invalid',
      violations: [{ rule: 'missing_stop' }, { rule: 'extra_link' }],
    });

    const state = await saveTextBackTemplateAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state.error).toBe(
      `${copy.TEMPLATE_RULE_MESSAGE.missing_stop} ${copy.TEMPLATE_RULE_MESSAGE.extra_link}`,
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(Object.keys({
    empty: 1,
    not_gsm7: 1,
    too_many_segments: 1,
    missing_identity: 1,
    missing_stop: 1,
    missing_privacy_pointer: 1,
    extra_link: 1,
    merge_token_left: 1,
  }))('the %s rule has its own sentence', async (rule) => {
    saveTextBackTemplate.mockResolvedValue({ kind: 'invalid', violations: [{ rule }] });

    const state = await saveTextBackTemplateAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state.error).toBe(
      copy.TEMPLATE_RULE_MESSAGE[rule as keyof typeof copy.TEMPLATE_RULE_MESSAGE],
    );
    expect(state.error).toBeTruthy();
  });

  it('unchanged → nothing changed', async () => {
    saveTextBackTemplate.mockResolvedValue({ kind: 'unchanged' });

    const state = await saveTextBackTemplateAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state.error).toBe(copy.TEMPLATE_UNCHANGED_MESSAGE);
  });

  it('tenant_missing → unknown client', async () => {
    saveTextBackTemplate.mockResolvedValue({ kind: 'tenant_missing' });

    const state = await saveTextBackTemplateAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state.error).toBe(copy.UNKNOWN_CLIENT_MESSAGE);
  });
});

describe('attestTextBackTemplateAction maps every result kind', () => {
  const FIELDS = { version_id: VERSION_ID, attestation_note: 'read back' };

  it.each([
    [{ kind: 'attested', variant: 'business_hours', version: 1 }, 'success', 'Attested. This is the wording callers will receive.'],
    [{ kind: 'note_required' }, 'error', copy.ATTEST_NOTE_REQUIRED_MESSAGE],
    [{ kind: 'note_too_long' }, 'error', copy.ATTEST_NOTE_TOO_LONG_MESSAGE],
    [{ kind: 'already_attested' }, 'success', 'That version is already attested.'],
    [
      { kind: 'invalid', violations: [{ rule: 'missing_identity' }] },
      'error',
      'Save the wording again — the business name has changed since this version.',
    ],
    [{ kind: 'not_found' }, 'error', copy.TEMPLATE_VERSION_NOT_FOUND_MESSAGE],
    [{ kind: 'tenant_missing' }, 'error', copy.UNKNOWN_CLIENT_MESSAGE],
  ] as const)('%o → its sentence', async (result, field, sentence) => {
    attestTextBackTemplate.mockResolvedValue(result);

    const state = await attestTextBackTemplateAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state[field]).toBe(sentence);
  });

  it('a non-identity re-validation failure names the rule', async () => {
    attestTextBackTemplate.mockResolvedValue({
      kind: 'invalid',
      violations: [{ rule: 'too_many_segments' }],
    });

    const state = await attestTextBackTemplateAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state.error).toContain(copy.TEMPLATE_RULE_MESSAGE.too_many_segments);
  });
});

describe('addNeverTextNumberAction maps every result kind', () => {
  const FIELDS = { number: '0412 345 678', kind: 'own_line', label: '' };

  it.each([
    [{ kind: 'added', id: ENTRY_ID }, 'success', 'Added.'],
    [{ kind: 'already_listed' }, 'error', 'That number is already on the list.'],
    [{ kind: 'invalid_number' }, 'error', 'Enter an Australian mobile or landline number.'],
    [{ kind: 'invalid_label' }, 'error', copy.NEVER_TEXT_LABEL_TOO_LONG_MESSAGE],
  ] as const)('%o → its sentence', async (result, field, sentence) => {
    addNeverTextNumber.mockResolvedValue(result);

    const state = await addNeverTextNumberAction(TENANT_ID, BLANK, form(FIELDS));

    expect(state[field]).toBe(sentence);
    // The number the operator typed is never echoed back in any sentence.
    expect(JSON.stringify(state)).not.toMatch(/0412|345 678/);
  });
});

describe('removeNeverTextNumberAction maps every result kind', () => {
  it.each([
    [{ kind: 'removed' }, 'success', 'Removed.'],
    [{ kind: 'not_found' }, 'error', copy.NEVER_TEXT_NOT_FOUND_MESSAGE],
    [
      { kind: 'last_own_line_while_armed' },
      'error',
      'Disarm text-back first — an armed client must keep at least one own line on this list.',
    ],
  ] as const)('%o → its sentence', async (result, field, sentence) => {
    removeNeverTextNumber.mockResolvedValue(result);

    const state = await removeNeverTextNumberAction(
      TENANT_ID,
      BLANK,
      form({ entry_id: ENTRY_ID }),
    );

    expect(state[field]).toBe(sentence);
    expect(removeNeverTextNumber).toHaveBeenCalledWith(TENANT_ID, ENTRY_ID);
  });
});

/* ------------------------------------------------------------------------- *
 * A throwing core — fixed log, generic sentence (T-12-07)
 * ------------------------------------------------------------------------- */

describe('a repository error becomes one fixed log line and one generic sentence', () => {
  const SECRET = 'duplicate key value violates unique constraint (number_e164)=(+61412345678)';

  it.each([
    [
      'saveTextBackTemplateAction',
      saveTextBackTemplateAction,
      saveTextBackTemplate,
      { variant: 'business_hours', body: 'Hi' },
      '[text-back] template save failed',
    ],
    [
      'attestTextBackTemplateAction',
      attestTextBackTemplateAction,
      attestTextBackTemplate,
      { version_id: VERSION_ID, attestation_note: 'read back' },
      '[text-back] template attest failed',
    ],
    [
      'addNeverTextNumberAction',
      addNeverTextNumberAction,
      addNeverTextNumber,
      { number: '0412 345 678', kind: 'own_line', label: '' },
      '[text-back] never-text add failed',
    ],
    [
      'removeNeverTextNumberAction',
      removeNeverTextNumberAction,
      removeNeverTextNumber,
      { entry_id: ENTRY_ID },
      '[text-back] never-text remove failed',
    ],
  ] as const)('%s', async (_name, action, core, fields, line) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    core.mockRejectedValue(new Error(SECRET));

    const state = await action(TENANT_ID, BLANK, form(fields));

    expect(state).toEqual({ error: copy.TEXT_BACK_WRITE_FAILED_MESSAGE, success: null });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(line);
    expect(JSON.stringify(log.mock.calls)).not.toContain('61412345678');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
