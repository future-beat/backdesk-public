/**
 * CAP-01 / D-08 / T-11-07: the three divert actions authorize OPERATOR-FIRST,
 * then membership, and only then read `formData` — and none of them reaches
 * the provisioning core (so none reaches Twilio) on a denial or a malformed
 * post.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `provisionDivertNumberAction` SPENDS MONEY. Its Server Action id is      │
 * │ global, so the POST can be made from any route by anyone with a session. │
 * │ Every assertion below is about the SERVER's behaviour, never about what  │
 * │ the form chose to render.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE, in the proof-actions mould: the repository, the provisioning core,
 * the checklist and `next/cache` are mocked, and Supabase's client is faked
 * ONE LEVEL BELOW `requireOperatorId` so the REAL allowlist gate runs. The
 * sentences are real — they are the rules under test.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const findDivertNumberCandidate = vi.fn();
const provisionDivertNumber = vi.fn();
const setSpokenName = vi.fn();
const forTenant = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/db/repository', () => ({
  forTenant: (tenantId: string) => forTenant(tenantId),
  // Every name actions.ts imports from the repository barrel.
  armChannel: vi.fn(),
  disarmChannel: vi.fn(),
  forAllTenants_armedBySmsGlobal: vi.fn(),
  getEscalationForTenant: vi.fn(),
  getMissedCallForTenant: vi.fn(),
  // The text_back_proof arm's tenant-scoped read (12-08); never reached here.
  getTextBackEvidenceForTenant: vi.fn(),
}));

vi.mock('@/core/telephony/provision', () => ({
  findDivertNumberCandidate: (input: unknown) => findDivertNumberCandidate(input),
  provisionDivertNumber: (input: unknown) => provisionDivertNumber(input),
}));

vi.mock('@/core/onboarding/checklist', () => ({ readGoLiveChecklist: vi.fn() }));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

let session: { userId: string | null; allowlisted: boolean; member: boolean } = {
  userId: '11111111-1111-4111-8111-111111111111',
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
            // The membership read through the operator's own JWT: a tenant
            // they are not on returns zero rows under RLS.
            return session.member
              ? { data: { id: TENANT_ID }, error: null }
              : { data: null, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { provisionDivertNumberAction, searchDivertNumberAction, updateSpokenNameAction } =
  await import('@/app/(console)/clients/[id]/actions');
const {
  BLANK_DIVERT_NUMBER_STATE,
  DIVERT_BUNDLE_UNATTACHED_MESSAGE,
  DIVERT_CONFIRM_MESSAGE,
  DIVERT_ORPHANED_MESSAGE,
  DIVERT_REFUSAL,
  DIVERT_SPOKEN_NAME_MESSAGE,
  DIVERT_SPOKEN_NAME_NO_NUMBER_MESSAGE,
  DIVERT_SPOKEN_NAME_SAVED_MESSAGE,
  divertAdoptedMessage,
  divertAlreadyProvisionedMessage,
  divertCandidateMessage,
  divertLookupFailedMessage,
  divertOutcomeUnknownMessage,
  divertProvisionedMessage,
  divertPurchaseFailedMessage,
} = await import('@/app/(console)/clients/[id]/action-state');
const { OPERATOR_DENIED_MESSAGE } = await import('@/app/(console)/_auth');

const TENANT_ID = '13e8f2aa-edee-4eb1-b699-09b650674f81';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
const NUMBER = '+61891570156';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function buyForm(overrides: Record<string, string> = {}): FormData {
  return form({
    phone_number: NUMBER,
    locality: 'Perth',
    spoken_name: "Dave's Plumbing",
    confirm: 'buy',
    ...overrides,
  });
}

beforeEach(() => {
  session = { userId: OPERATOR_ID, allowlisted: true, member: true };
  findDivertNumberCandidate.mockReset();
  findDivertNumberCandidate.mockResolvedValue({
    kind: 'candidate',
    phoneNumber: NUMBER,
    locality: 'Perth',
    region: 'WA',
  });
  provisionDivertNumber.mockReset();
  provisionDivertNumber.mockResolvedValue({
    kind: 'provisioned',
    numberE164: NUMBER,
    locality: 'Perth',
    bundleAttached: true,
  });
  setSpokenName.mockReset();
  setSpokenName.mockResolvedValue([{ id: 'row' }]);
  forTenant.mockReset();
  forTenant.mockReturnValue({ divertNumber: { setSpokenName } });
  revalidatePath.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('authorization runs before anything else (T-11-07)', () => {
  it.each([
    ['unauthenticated', { userId: null, allowlisted: false, member: false }, OPERATOR_DENIED_MESSAGE.unauthenticated],
    ['not allowlisted', { userId: OPERATOR_ID, allowlisted: false, member: true }, OPERATOR_DENIED_MESSAGE.forbidden],
    ['not a member', { userId: OPERATOR_ID, allowlisted: true, member: false }, 'Unknown client.'],
  ])('%s: all three actions refuse, and neither core function runs', async (_l, who, sentence) => {
    session = who;

    const searched = await searchDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: 'Dave' }));
    const bought = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm());
    const renamed = await updateSpokenNameAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: 'Dave' }));

    for (const state of [searched, bought, renamed]) {
      expect(state.error).toBe(sentence);
      expect(state.success).toBeNull();
      expect(state.candidate).toBeNull();
    }
    expect(findDivertNumberCandidate).not.toHaveBeenCalled();
    expect(provisionDivertNumber).not.toHaveBeenCalled();
    expect(setSpokenName).not.toHaveBeenCalled();
  });

  it('refuses a malformed tenant id before any read', async () => {
    const state = await provisionDivertNumberAction('not-a-uuid', BLANK_DIVERT_NUMBER_STATE, buyForm());

    expect(state.error).toBe('Unknown client.');
    expect(provisionDivertNumber).not.toHaveBeenCalled();
  });
});

describe('tap two validates its post before the core', () => {
  it.each([
    ['a national-format number', { phone_number: '0891570156' }],
    ['a mobile, not an 08 number', { phone_number: '+61491570156' }],
    ['a number with a suffix', { phone_number: NUMBER + '1' }],
    // WR-08: `+618` is not WA — SA, the NT and Broken Hill share the area code.
    ['an SA 08 7… number (the F-11-07-1 purchase)', { phone_number: '+61875570101' }],
    ['an Adelaide 08 8… number', { phone_number: '+61882345678' }],
    ['a Darwin NT number', { phone_number: '+61889234567' }],
  ])('refuses %s', async (_l, patch) => {
    const state = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm(patch));

    expect(state.error).toBe(DIVERT_CONFIRM_MESSAGE);
    expect(provisionDivertNumber).not.toHaveBeenCalled();
  });

  it('refuses without confirm=buy — the second tap is a deliberate act', async () => {
    const data = buyForm();
    data.delete('confirm');
    expect((await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, data)).error).toBe(
      DIVERT_CONFIRM_MESSAGE,
    );
    expect(
      (await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm({ confirm: 'yes' }))).error,
    ).toBe(DIVERT_CONFIRM_MESSAGE);
    expect(provisionDivertNumber).not.toHaveBeenCalled();
  });

  it.each([
    ['seven words', 'Dave and Sons Plumbing and Gas Fitting'],
    ['sixty-one characters', 'x'.repeat(61)],
    ['blank', '   '],
    ['a control character', 'Dave\u0007Plumbing'],
  ])('refuses a spoken name of %s', async (_l, spokenName) => {
    const state = await provisionDivertNumberAction(
      TENANT_ID,
      BLANK_DIVERT_NUMBER_STATE,
      buyForm({ spoken_name: spokenName }),
    );

    expect(state.error).toBe(DIVERT_SPOKEN_NAME_MESSAGE);
    expect(provisionDivertNumber).not.toHaveBeenCalled();
  });

  it('passes the VERIFIED operator id and the trimmed name to the core', async () => {
    await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm({ spoken_name: '  Dave  ' }));

    expect(provisionDivertNumber).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      spokenName: 'Dave',
      phoneNumber: NUMBER,
      locality: 'Perth',
      operatorId: OPERATOR_ID,
    });
  });
});

describe('every core outcome maps to its sentence', () => {
  it.each([
    ['bundle_missing', { kind: 'bundle_missing' }, DIVERT_REFUSAL.bundle_missing],
    ['wrong_host', { kind: 'wrong_host', host: 'backdesk.com.au' }, DIVERT_REFUSAL.wrong_host],
    ['base_url_unset', { kind: 'base_url_unset' }, DIVERT_REFUSAL.base_url_unset],
    ['address_missing', { kind: 'address_missing' }, DIVERT_REFUSAL.address_missing],
    ['in_progress', { kind: 'in_progress' }, DIVERT_REFUSAL.in_progress],
    ['already_provisioned', { kind: 'already_provisioned', numberE164: NUMBER }, divertAlreadyProvisionedMessage(NUMBER)],
    ['purchase_failed', { kind: 'purchase_failed', code: 'provider_rejected' }, divertPurchaseFailedMessage('provider_rejected')],
    ['orphaned_number', { kind: 'orphaned_number', sid: 'PN' + 'c'.repeat(32) }, DIVERT_ORPHANED_MESSAGE],
    ['outcome_unknown', { kind: 'outcome_unknown', code: 'network_error' }, divertOutcomeUnknownMessage('network_error')],
    ['lookup_failed', { kind: 'lookup_failed', code: 'http_503' }, divertLookupFailedMessage('http_503')],
  ])('%s', async (_l, outcome, sentence) => {
    provisionDivertNumber.mockResolvedValue(outcome);

    const state = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm());

    expect(state.error).toBe(sentence);
    expect(state.success).toBeNull();
  });

  it('an unknown outcome NEVER says nothing was bought — it says do not buy again (CR-01)', async () => {
    provisionDivertNumber.mockResolvedValue({ kind: 'outcome_unknown', code: 'network_error' });

    const state = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm());

    expect(state.error).toContain('may have gone through');
    expect(state.error).toContain('Do not buy');
    expect(state.error).not.toContain('nothing was bought');
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it('an adopted number is a success sentence naming it, and the page is revalidated', async () => {
    provisionDivertNumber.mockResolvedValue({ kind: 'adopted', numberE164: NUMBER, bundleAttached: true });

    const state = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm());

    expect(state.error).toBeNull();
    expect(state.success).toBe(divertAdoptedMessage(NUMBER));
    expect(state.success).toContain('nothing new was bought');
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it('bought but the bundle is NOT attached → the bought sentence AND the bundle warning (WR-09)', async () => {
    provisionDivertNumber.mockResolvedValue({
      kind: 'provisioned',
      numberE164: NUMBER,
      locality: 'Perth',
      bundleAttached: false,
    });

    const state = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm());

    expect(state.success).toBe(divertProvisionedMessage(NUMBER));
    expect(state.error).toBe(DIVERT_BUNDLE_UNATTACHED_MESSAGE);
    expect(state.error).toContain('regulatory bundle');
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it('the refusal sentences name the missing thing', () => {
    expect(DIVERT_REFUSAL.bundle_missing).toContain('TWILIO_AU_BUNDLE_SID');
    expect(DIVERT_REFUSAL.address_missing).toContain('TWILIO_AU_ADDRESS_SID');
    expect(DIVERT_REFUSAL.wrong_host).toContain('APP_BASE_URL');
    expect(divertAlreadyProvisionedMessage(NUMBER)).toContain(NUMBER);
    expect(divertPurchaseFailedMessage('provider_rejected')).toContain('provider_rejected');
    // A code that is not ours never reaches the page.
    expect(divertPurchaseFailedMessage('Number +61412345678 is taken')).not.toContain('+61');
  });

  it('the orphaned sentence adds no sid — the core logged it', async () => {
    const sid = 'PN' + 'c'.repeat(32);
    provisionDivertNumber.mockResolvedValue({ kind: 'orphaned_number', sid });

    const state = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm());

    expect(state.error).not.toContain(sid);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('provisioned → the bought sentence and the page is revalidated', async () => {
    const state = await provisionDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, buyForm());

    expect(state.error).toBeNull();
    expect(state.success).toBe(divertProvisionedMessage(NUMBER));
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });
});

describe('tap one carries the candidate back', () => {
  it('returns the number, its locality and the cost sentence', async () => {
    const state = await searchDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: 'Dave' }));

    expect(state.candidate).toEqual({ phoneNumber: NUMBER, locality: 'Perth', region: 'WA' });
    expect(state.success).toBe(divertCandidateMessage({ phoneNumber: NUMBER, locality: 'Perth' }));
    expect(state.success).toContain(NUMBER);
    expect(state.success).toContain('A$3 a month');
    expect(findDivertNumberCandidate).toHaveBeenCalledWith({ tenantId: TENANT_ID });
    // A READ: nothing bought, nothing to re-render.
    expect(provisionDivertNumber).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a bad spoken name before searching', async () => {
    const state = await searchDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: '' }));

    expect(state.error).toBe(DIVERT_SPOKEN_NAME_MESSAGE);
    expect(findDivertNumberCandidate).not.toHaveBeenCalled();
  });

  it('no inventory is its own sentence', async () => {
    findDivertNumberCandidate.mockResolvedValue({ kind: 'no_inventory' });

    const state = await searchDivertNumberAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: 'Dave' }));

    expect(state.error).toBe(DIVERT_REFUSAL.no_inventory);
    expect(state.candidate).toBeNull();
  });
});

describe('the spoken name can be corrected without touching the number', () => {
  it('saves a valid name through setSpokenName only', async () => {
    const state = await updateSpokenNameAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: 'Davey Plumbing' }));

    expect(state.success).toBe(DIVERT_SPOKEN_NAME_SAVED_MESSAGE);
    expect(setSpokenName).toHaveBeenCalledWith('Davey Plumbing');
    expect(provisionDivertNumber).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it.each([['seven words', 'one two three four five six seven'], ['61 characters', 'y'.repeat(61)]])(
    'refuses %s',
    async (_l, name) => {
      const state = await updateSpokenNameAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: name }));

      expect(state.error).toBe(DIVERT_SPOKEN_NAME_MESSAGE);
      expect(setSpokenName).not.toHaveBeenCalled();
    },
  );

  it('with no row, says there is nothing to rename yet', async () => {
    setSpokenName.mockResolvedValue([]);

    const state = await updateSpokenNameAction(TENANT_ID, BLANK_DIVERT_NUMBER_STATE, form({ spoken_name: 'Dave' }));

    expect(state.error).toBe(DIVERT_SPOKEN_NAME_NO_NUMBER_MESSAGE);
  });
});

describe('source pins (D-08)', () => {
  const actions = readFileSync('src/app/(console)/clients/[id]/actions.ts', 'utf-8');
  const formSrc = readFileSync('src/app/(console)/clients/[id]/divert-number-form.tsx', 'utf-8');

  it('actions.ts has no release, delete or reassign path for divert numbers', () => {
    expect(actions).not.toMatch(/release\w*\s*\(|releaseDivert|deleteDivert|reassign\w*\s*\(/i);
    expect(actions).not.toMatch(/divertNumber\.(delete|remove|release)/);
  });

  it('the form imports nothing from the database layer', () => {
    expect(formSrc).not.toContain('@/db');
    expect(formSrc).not.toMatch(/\brelease\b.*button|onRelease|releaseAction/i);
  });
});
