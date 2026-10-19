/**
 * THE AFTER-HOURS ESCALATION SWITCH (Phase 13, 13-05, D-09) and THE LEAD
 * TEMPLATE SEED AT ARMING (D-02) — guard order, the one-column patch, the fixed
 * sentences, and when the seed runs.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A SERVER ACTION ID IS GLOBAL (T-13-12). The switch decides whether a     │
 * │ client's tradie is texted at 2 am; an operator who is not on that client │
 * │ is refused BEFORE a single form field is read — proven with a FormData   │
 * │ whose getters throw.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE: the repository barrel, the checklist read, the privacy predicate and
 * `next/cache` are mocked; Supabase's client is faked ONE LEVEL BELOW the
 * allowlist gate (the text-back-actions / arming-actions mould) so the real
 * `authorize` runs against a fake session. The sentences are REAL, imported
 * from `action-state.ts`. `seedLeadTemplateDefaults` is REAL too — the fake
 * repository records what it was asked to insert, so the test proves the two
 * default rows reach `ensureLeadDefaults` for THIS tenant, not merely that a
 * function was called. Its idempotency is the repository's targeted
 * `ON CONFLICT DO NOTHING` (13-02, DB-backed); here the fake answers [] on a
 * second call, as the database does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = '77777777-7777-4777-8777-777777777777';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';

const tenantUpdate = vi.fn();
const ensureLeadDefaults = vi.fn();
const forTenant = vi.fn();
const armChannel = vi.fn();
const readGoLiveChecklist = vi.fn();
const privacyCoversCallers = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/db/repository', () => ({
  armChannel: (input: unknown) => armChannel(input),
  disarmChannel: vi.fn(),
  forTenant: (tenantId: string) => forTenant(tenantId),
  forAllTenants_armedBySmsGlobal: vi.fn(async () => []),
  getEscalationForTenant: vi.fn(),
  getMissedCallForTenant: vi.fn(),
  getTextBackEvidenceForTenant: vi.fn(),
}));

vi.mock('@/core/onboarding/privacy-coverage', () => ({
  privacyCoversCallers: (sections: unknown) => privacyCoversCallers(sections),
}));

vi.mock('@/core/onboarding/checklist', () => ({
  readGoLiveChecklist: (tenantId: string, now: Date) => readGoLiveChecklist(tenantId, now),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

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
            return session.member
              ? { data: { id: TENANT_ID }, error: null }
              : { data: null, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { armChannelAction, updateAfterHoursEscalationAction } = await import(
  '@/app/(console)/clients/[id]/actions'
);
const copy = await import('@/app/(console)/clients/[id]/action-state');
const { OPERATOR_DENIED_MESSAGE } = await import('@/app/(console)/_auth');
const { DEFAULT_LEAD_TEMPLATE_BODIES, LEAD_TEMPLATE_APPROVAL_NOTE } = await import(
  '@/core/leads/lead-templates'
);

const BLANK = copy.BLANK_AFTER_HOURS_ESCALATION_STATE;

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

/** Every gate met (the arming-actions fixture, trimmed to what the action reads). */
const ALL_KEYS = [
  'sm8Connected',
  'contactHours',
  'voiceProfile',
  'templatesApproved',
  'sm8AutomationOff',
  'escalationPhone',
  'sendingDomainVerified',
  'smsArmed',
  'emailArmed',
  'escalationHandsetProof',
  'emailPipeProof',
  'divertNumber',
  'divertVerified',
  'textBackTemplates',
  'neverTextOwnNumber',
  'textBackArmed',
  'textBackProof',
] as const;

function checklistFixture() {
  return {
    items: ALL_KEYS.map((key) => ({ key, satisfied: true, detail: null })),
    attestation: { attestedAt: new Date(), note: 'seeded', isStale: false, ageDays: 0 },
    arming: {
      sms: { from: null, source: 'global', tenantRow: null, globalEnabled: false },
      email: { from: null, tenantRow: null, domain: 'verified' },
    },
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  session = { userId: OPERATOR_ID, allowlisted: true, member: true };
  tenantUpdate.mockResolvedValue([{ id: TENANT_ID }]);
  ensureLeadDefaults.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  forTenant.mockImplementation(() => ({
    tenant: { update: (patch: unknown) => tenantUpdate(patch) },
    templates: {
      ensureLeadDefaults: (rows: unknown, note: unknown) => ensureLeadDefaults(rows, note),
    },
  }));
  readGoLiveChecklist.mockResolvedValue(checklistFixture());
  privacyCoversCallers.mockReturnValue(true);
  armChannel.mockResolvedValue({ kind: 'armed', config: {}, auditId: 'audit-1' });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

/* ------------------------------------------------------------------------- *
 * updateAfterHoursEscalationAction (D-09)
 * ------------------------------------------------------------------------- */

describe('updateAfterHoursEscalationAction authorizes BEFORE reading the form (T-13-12)', () => {
  it('refuses a signed-out caller without reading formData or writing', async () => {
    session = { userId: null, allowlisted: false, member: false };

    const state = await updateAfterHoursEscalationAction(TENANT_ID, BLANK, poisonedFormData());

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.unauthenticated);
    expect(state.success).toBeNull();
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a non-uuid tenant id without reading formData', async () => {
    const state = await updateAfterHoursEscalationAction('not-a-uuid', BLANK, poisonedFormData());

    expect(state.error).toBe('Unknown client.');
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  // The membership read is made through the caller's own JWT, so RLS decides:
  // a session that is not on this client — or not an operator at all — sees no
  // tenant row. The escalation-number action's guard, exactly (WR-01).
  it('refuses a session RLS shows no tenant row to, without reading formData', async () => {
    session = { userId: OPERATOR_ID, allowlisted: true, member: false };

    const state = await updateAfterHoursEscalationAction(TENANT_ID, BLANK, poisonedFormData());

    expect(state.error).not.toBeNull();
    expect(state.success).toBeNull();
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(forTenant).not.toHaveBeenCalled();
  });
});

describe('updateAfterHoursEscalationAction writes ONE column', () => {
  it("a ticked box ('on') patches { afterHoursEscalation: true } and nothing else", async () => {
    const state = await updateAfterHoursEscalationAction(
      TENANT_ID,
      BLANK,
      form({ after_hours_escalation: 'on' }),
    );

    expect(forTenant).toHaveBeenCalledWith(TENANT_ID);
    expect(tenantUpdate).toHaveBeenCalledTimes(1);
    expect(tenantUpdate.mock.calls[0]?.[0]).toStrictEqual({ afterHoursEscalation: true });
    expect(state).toEqual({ error: null, success: copy.afterHoursEscalationSavedMessage(true) });
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it('an unticked box (no field posted) patches { afterHoursEscalation: false }', async () => {
    const state = await updateAfterHoursEscalationAction(TENANT_ID, BLANK, form({}));

    expect(tenantUpdate.mock.calls[0]?.[0]).toStrictEqual({ afterHoursEscalation: false });
    expect(state.success).toBe(copy.afterHoursEscalationSavedMessage(false));
  });

  it("any value other than 'on' is OFF — a forged post cannot smuggle a truthy string", async () => {
    await updateAfterHoursEscalationAction(
      TENANT_ID,
      BLANK,
      form({ after_hours_escalation: 'true', escalation_phone: '0400000000' }),
    );

    // Only the switch's column, and only false: the extra field is never read.
    expect(tenantUpdate.mock.calls[0]?.[0]).toStrictEqual({ afterHoursEscalation: false });
  });

  it('a throwing write answers the fixed failure sentence and logs a fixed string', async () => {
    tenantUpdate.mockRejectedValue(new Error('duplicate key 0412 345 678 SECRET'));

    const state = await updateAfterHoursEscalationAction(
      TENANT_ID,
      BLANK,
      form({ after_hours_escalation: 'on' }),
    );

    expect(state).toEqual({ error: copy.AFTER_HOURS_ESCALATION_WRITE_FAILED_MESSAGE, success: null });
    expect(consoleError).toHaveBeenCalledWith('[clients] after-hours escalation write failed');
    // The caught value never reaches the log or the screen.
    for (const call of consoleError.mock.calls) {
      expect(call).toHaveLength(1);
      expect(String(call[0])).not.toContain('SECRET');
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('both saved sentences name the always-sent exception or the immediate send', () => {
    expect(copy.afterHoursEscalationSavedMessage(true)).toMatch(/straight away/);
    expect(copy.afterHoursEscalationSavedMessage(false)).toMatch(/Emergencies and URGENT/);
    expect(copy.afterHoursEscalationSavedMessage(true)).not.toBe(
      copy.afterHoursEscalationSavedMessage(false),
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The lead template seed at arming (D-02)
 * ------------------------------------------------------------------------- */

describe('armChannelAction seeds the lead template defaults after a successful text_back arm', () => {
  it('a successful text_back arm seeds the two default rows once, for this tenant', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      copy.BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBeNull();
    expect(state.success).toBe(copy.armedMessage('text_back', 'client'));
    expect(forTenant).toHaveBeenCalledWith(TENANT_ID);
    expect(ensureLeadDefaults).toHaveBeenCalledTimes(1);
    expect(ensureLeadDefaults).toHaveBeenCalledWith(
      [
        { touchNumber: 2, body: DEFAULT_LEAD_TEMPLATE_BODIES[2] },
        { touchNumber: 3, body: DEFAULT_LEAD_TEMPLATE_BODIES[3] },
      ],
      LEAD_TEMPLATE_APPROVAL_NOTE,
    );
  });

  it('a second arm after a disarm seeds again and the repository inserts nothing — still a success', async () => {
    ensureLeadDefaults.mockResolvedValue([]);

    const state = await armChannelAction(
      TENANT_ID,
      copy.BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.success).toBe(copy.armedMessage('text_back', 'client'));
    expect(ensureLeadDefaults).toHaveBeenCalledTimes(1);
  });

  it('a seed that throws never unsays the arm (T-13-18)', async () => {
    ensureLeadDefaults.mockRejectedValue(new Error('connection reset SECRET'));

    const state = await armChannelAction(
      TENANT_ID,
      copy.BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBeNull();
    expect(state.success).toBe(copy.armedMessage('text_back', 'client'));
    expect(consoleError).toHaveBeenCalledWith('[clients] lead template seed failed after arming');
    for (const call of consoleError.mock.calls) {
      expect(String(call[0])).not.toContain('SECRET');
    }
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it.each([
    ['already_armed', { kind: 'already_armed', config: {} }],
    ['no_identity', { kind: 'no_identity', missing: ['from'] }],
    ['per_tenant_only', { kind: 'per_tenant_only' }],
  ])('a refused text_back arm (%s) does not seed', async (_name, result) => {
    armChannel.mockResolvedValue(result);

    const state = await armChannelAction(
      TENANT_ID,
      copy.BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.success).toBeNull();
    expect(ensureLeadDefaults).not.toHaveBeenCalled();
  });

  it('a throwing arm write does not seed', async () => {
    armChannel.mockRejectedValue(new Error('boom'));

    const state = await armChannelAction(
      TENANT_ID,
      copy.BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(copy.ARM_WRITE_FAILED_MESSAGE);
    expect(ensureLeadDefaults).not.toHaveBeenCalled();
  });

  it('a refused privacy notice does not seed', async () => {
    privacyCoversCallers.mockReturnValue(false);

    await armChannelAction(
      TENANT_ID,
      copy.BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(armChannel).not.toHaveBeenCalled();
    expect(ensureLeadDefaults).not.toHaveBeenCalled();
  });

  it.each([
    ['sms', 'client'],
    ['sms', 'everyone'],
    ['email', 'client'],
  ] as const)('arming %s (%s) does not seed lead wording', async (channel, target) => {
    const state = await armChannelAction(
      TENANT_ID,
      copy.BLANK_ARM_STATE,
      form({ channel, target }),
    );

    expect(state.error).toBeNull();
    expect(armChannel).toHaveBeenCalledTimes(1);
    expect(ensureLeadDefaults).not.toHaveBeenCalled();
  });
});
