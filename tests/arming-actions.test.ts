/**
 * ARM-02: the arming actions authorize FIRST, refuse on the first unmet gate
 * WITHOUT WRITING, and target the row they say they target.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE HIGHEST-CONSEQUENCE POST IN THE PRODUCT. One request and the │
 * │ next tick sends real messages to real customers from a real number, for  │
 * │ every connected client if the shared row is the target. A Server Action  │
 * │ id is global, so that request can be made from any route by anyone with  │
 * │ a session — which is why every assertion below is about the SERVER's     │
 * │ behaviour, never about what the card chose to render.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE: the repository, `readGoLiveChecklist` and `next/cache` are mocked, and
 * Supabase's client is faked ONE LEVEL BELOW `requireOperatorId` so the real
 * allowlist gate runs against a fake session. `firstUnmetGate` and the sentences
 * are REAL — they are the rules under test, and a mocked gate would prove the
 * action calls something rather than that it refuses anything.
 *
 * AND NO TEST HERE TOUCHES A DATABASE. An `enabled` `messaging_config` row on
 * the hosted database is, by D-04's design, the switch that arms real client
 * messaging with no deploy; 04-03 established that such a row must never be a
 * test's to leave behind, and this suite is about the code path that writes one.
 *
 * Sibling suites: tests/messaging-config-arming.test.ts (the transactional
 * writer, DB-backed) and tests/operator-authorization.test.ts (the source scan
 * that pins these actions as guarded paths).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const armChannel = vi.fn();
const disarmChannel = vi.fn();
const forTenant = vi.fn();
const forAllTenants_armedBySmsGlobal = vi.fn();
const readGoLiveChecklist = vi.fn();
const revalidatePath = vi.fn();
/** The privacy predicate — driven per test; true on the shipped copy. */
const privacyCoversCallers = vi.fn();

vi.mock('@/db/repository', () => ({
  armChannel: (input: unknown) => armChannel(input),
  disarmChannel: (input: unknown) => disarmChannel(input),
  forTenant: (tenantId: string) => forTenant(tenantId),
  forAllTenants_armedBySmsGlobal: () => forAllTenants_armedBySmsGlobal(),
  // Imported by the same actions module (the proof arms); never reached here.
  getEscalationForTenant: vi.fn(),
  getMissedCallForTenant: vi.fn(),
  getTextBackEvidenceForTenant: vi.fn(),
}));

// THE PRIVACY PREDICATE (D-09, D-11), mocked so both branches can be driven.
// The real predicate is pinned TRUE on the shipped copy in
// tests/privacy-page.test.ts; this suite proves the action asks it, and when.
vi.mock('@/core/onboarding/privacy-coverage', () => ({
  privacyCoversCallers: (sections: unknown) => privacyCoversCallers(sections),
}));

vi.mock('@/core/onboarding/checklist', () => ({
  readGoLiveChecklist: (tenantId: string, now: Date) => readGoLiveChecklist(tenantId, now),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

let session: { userId: string | null; allowlisted: boolean } = {
  userId: '11111111-1111-4111-8111-111111111111',
  allowlisted: true,
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
            // The membership read: the tenant exists and the operator may see it.
            return { data: { id: TENANT_ID }, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { armChannelAction, disarmChannelAction } = await import(
  '@/app/(console)/clients/[id]/actions'
);
const {
  ARM_ALREADY_MESSAGE,
  ARM_DOMAIN_UNKNOWN_MESSAGE,
  ARM_REFUSAL,
  ARM_TEXT_BACK_PER_CLIENT_MESSAGE,
  ARM_TEXT_BACK_PRIVACY_MESSAGE,
  ARM_WRITE_FAILED_MESSAGE,
  armedMessage,
  armNoIdentityMessage,
  BLANK_ARM_STATE,
  DISARM_ALREADY_MESSAGE,
  DISARM_REASON_REQUIRED_MESSAGE,
  disarmedMessage,
  smsBlastRadiusSentence,
} = await import('@/app/(console)/clients/[id]/action-state');
const { PRIVACY_COPY } = await import('@/app/(marketing)/copy');
const { OPERATOR_DENIED_MESSAGE } = await import('@/app/(console)/_auth');
const TENANT_ID = '77777777-7777-4777-8777-777777777777';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';

/**
 * THE BLAST RADIUS, as the cross-tenant read returns it (D-03).
 *
 * Two clients, neither of them the one whose page is being looked at — because
 * the set the shared row governs is "every connected client without an sms row
 * of its own", and the client in front of the operator is only one of them.
 */
const ARMED_CLIENTS = [
  { id: '22222222-2222-4222-8222-222222222222', name: "Dave's Plumbing" },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Perth Electrical' },
];

/** Every gate met — each test breaks exactly one thing. */
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

/** The ten text-back gates, in checklist order (ARMING_GATES.text_back). */
const TEXT_BACK_GATES = [
  'sm8Connected',
  'contactHours',
  'templatesApproved',
  'sm8AutomationOff',
  'escalationPhone',
  'smsArmed',
  'divertNumber',
  'divertVerified',
  'textBackTemplates',
  'neverTextOwnNumber',
] as const;

function checklistFixture(
  overrides: {
    unsatisfied?: readonly string[];
    emailDomain?: 'verified' | 'unverified' | 'unknown' | 'none';
  } = {},
) {
  const unsatisfied = new Set(overrides.unsatisfied ?? []);

  return {
    items: ALL_KEYS.map((key) => ({
      key,
      satisfied: !unsatisfied.has(key),
      detail: null,
    })),
    attestation: { attestedAt: new Date(), note: 'seeded', isStale: false, ageDays: 0 },
    arming: {
      sms: { from: '+61491579212', source: 'global', tenantRow: null, globalEnabled: false },
      email: {
        from: 'quotes@quotes.example.com.au',
        tenantRow: {
          enabled: false,
          fromAddress: 'quotes@quotes.example.com.au',
          replyTo: 'dave@daveplumbing.com.au',
          businessName: "Dave's Plumbing",
        },
        domain: overrides.emailDomain ?? 'verified',
      },
    },
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  armChannel.mockReset();
  disarmChannel.mockReset();
  forAllTenants_armedBySmsGlobal.mockReset();
  forAllTenants_armedBySmsGlobal.mockResolvedValue(ARMED_CLIENTS);
  readGoLiveChecklist.mockReset();
  revalidatePath.mockClear();
  privacyCoversCallers.mockReset();
  privacyCoversCallers.mockReturnValue(true);
  session = { userId: OPERATOR_ID, allowlisted: true };
  readGoLiveChecklist.mockResolvedValue(checklistFixture());
  armChannel.mockResolvedValue({
    kind: 'armed',
    config: { fromAddress: '+61491579212' },
    auditId: 'audit-1',
  });
  disarmChannel.mockResolvedValue({ kind: 'disarmed', config: {}, auditId: 'audit-2' });
  // The write-failure test logs one fixed line by design.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('authorization runs before anything else (WR-01, T-10-01)', () => {
  it('refuses an unauthenticated session and writes nothing', async () => {
    session = { userId: null, allowlisted: false };

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.unauthenticated);
    expect(armChannel).not.toHaveBeenCalled();
    // Not even the gate is read: there is nothing worth asking about a client
    // for a caller with no session.
    expect(readGoLiveChecklist).not.toHaveBeenCalled();
  });

  it('refuses a signed-in session that is not on the operator allowlist', async () => {
    session = { userId: OPERATOR_ID, allowlisted: false };

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.forbidden);
    expect(armChannel).not.toHaveBeenCalled();
  });

  it('refuses a disarm from a non-operator too — stopping is ungated, not unauthorized', async () => {
    session = { userId: OPERATOR_ID, allowlisted: false };

    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', scope: 'everyone', reason: 'stop everything' }),
    );

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.forbidden);
    expect(disarmChannel).not.toHaveBeenCalled();
  });
});

describe('the target the action says it is writing (D-03)', () => {
  it('sms/everyone writes the SHARED row and says so', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(armChannel).toHaveBeenCalledTimes(1);
    expect(armChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sms',
        // NULL — the shared row, not this client's.
        tenantId: null,
        operatorUserId: OPERATOR_ID,
      }),
    );
    expect(state.success).toBe(armedMessage('sms', 'everyone', ARMED_CLIENTS));
    expect(state.success).toContain('every connected client');
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it('sms/client lifts THIS client’s override and nobody else’s', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'client' }),
    );

    expect(armChannel).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
    expect(state.success).toBe(armedMessage('sms', 'client'));
  });

  it('email always targets this client’s own row — there is no shared email identity', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      // `everyone` posted on the email channel must NOT reach the global row.
      form({ channel: 'email', target: 'everyone' }),
    );

    expect(armChannel).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
    expect(state.success).toBe(armedMessage('email', 'everyone'));
  });
});

describe('the gate refuses, and refusing writes NOTHING (D-05, T-10-01)', () => {
  it('names the first unmet item and never reaches the repository', async () => {
    readGoLiveChecklist.mockResolvedValue(
      checklistFixture({ unsatisfied: ['templatesApproved'] }),
    );

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(state.error).toBe(ARM_REFUSAL.templatesApproved);
    expect(state.success).toBeNull();
    expect(armChannel).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('walks the items in ORDER — the FIRST unmet one is the one named', async () => {
    readGoLiveChecklist.mockResolvedValue(
      checklistFixture({ unsatisfied: ['contactHours', 'escalationPhone'] }),
    );

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(state.error).toBe(ARM_REFUSAL.contactHours);
  });

  it('a FAILED domain read is its own refusal, never a pass (Pitfall 5, T-10-04)', async () => {
    readGoLiveChecklist.mockResolvedValue(
      checklistFixture({ unsatisfied: ['sendingDomainVerified'], emailDomain: 'unknown' }),
    );

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'email', target: 'client' }),
    );

    // "Not verified yet" would send the operator to fix a domain that is fine.
    expect(state.error).toBe(ARM_DOMAIN_UNKNOWN_MESSAGE);
    expect(state.error).not.toBe(ARM_REFUSAL.sendingDomainVerified);
    expect(armChannel).not.toHaveBeenCalled();
  });

  it('an unverified domain gates EMAIL and not SMS', async () => {
    readGoLiveChecklist.mockResolvedValue(
      checklistFixture({ unsatisfied: ['sendingDomainVerified'], emailDomain: 'unverified' }),
    );

    const email = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'email', target: 'client' }),
    );
    expect(email.error).toBe(ARM_REFUSAL.sendingDomainVerified);
    expect(armChannel).not.toHaveBeenCalled();

    const sms = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );
    expect(sms.success).toBe(armedMessage('sms', 'everyone', ARMED_CLIENTS));
  });
});

/**
 * D-03, T-10-12: the operator must not be able to arm N clients without knowing
 * which N. The warning states the count and the names between the two taps, and
 * the success sentence repeats them from a FRESH read taken after the write.
 */
describe('the shared row names the clients it arms (D-03, T-10-12)', () => {
  it('the success sentence names the count and every client by name', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(forAllTenants_armedBySmsGlobal).toHaveBeenCalledTimes(1);
    expect(state.success).toBe(armedMessage('sms', 'everyone', ARMED_CLIENTS));
    expect(state.success).toContain('2 clients');
    expect(state.success).toContain("Dave's Plumbing");
    expect(state.success).toContain('Perth Electrical');
  });

  it('reads the list AFTER the write, so the sentence describes what just happened', async () => {
    await armChannelAction(TENANT_ID, BLANK_ARM_STATE, form({ channel: 'sms', target: 'everyone' }));

    // A list read BEFORE the arm is a list that can be a tick out of date — and
    // this sentence is the record the operator remembers having read.
    expect(armChannel.mock.invocationCallOrder[0]).toBeLessThan(
      forAllTenants_armedBySmsGlobal.mock.invocationCallOrder[0],
    );
  });

  it('says so plainly when the shared row governs nobody today', async () => {
    forAllTenants_armedBySmsGlobal.mockResolvedValue([]);

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(state.success).toBe(armedMessage('sms', 'everyone', []));
    expect(state.success).toContain('no connected client is without its own row today');
  });

  it('makes NO cross-tenant read for an email arm or a client-target sms arm', async () => {
    await armChannelAction(TENANT_ID, BLANK_ARM_STATE, form({ channel: 'email', target: 'client' }));
    await armChannelAction(TENANT_ID, BLANK_ARM_STATE, form({ channel: 'sms', target: 'client' }));

    // Neither write touches the shared row, so neither sentence may claim a
    // blast radius — and a cross-tenant read nobody needs is a crossing that
    // does not have to be justified.
    expect(forAllTenants_armedBySmsGlobal).not.toHaveBeenCalled();
  });

  it('a failed list read never unsays the arming — the clause is dropped, not guessed', async () => {
    forAllTenants_armedBySmsGlobal.mockRejectedValue(new Error('connection terminated'));

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    // The row IS armed; the sentence must not claim "nobody" because a read
    // failed, and it must not claim a refusal either.
    expect(state.error).toBeNull();
    expect(state.success).toBe(armedMessage('sms', 'everyone', null));
    expect(state.success).not.toContain('no connected client');
  });
});

/**
 * The sentences themselves — pure, and asserted apart from the action because
 * the CARD renders the same clause between the two taps.
 */
describe('the blast-radius clause (D-03)', () => {
  it('armedMessage counts and names them', () => {
    expect(armedMessage('sms', 'everyone', [{ name: 'A' }, { name: 'B' }])).toBe(
      'Armed. SMS is on for every connected client from the next tick, from the shared number — 2 clients: A, B.',
    );
  });

  it('armedMessage says nobody rather than "0 clients"', () => {
    expect(armedMessage('sms', 'everyone', [])).toBe(
      'Armed. SMS is on for every connected client from the next tick, from the shared number — no connected client is without its own row today.',
    );
  });

  it('one client is a client, not clients', () => {
    expect(armedMessage('sms', 'everyone', [{ name: 'A' }])).toContain('1 client: A');
  });

  it('the warning carries the same clause, the number and the irreversibility', () => {
    const warning = smsBlastRadiusSentence([{ name: 'A' }, { name: 'B' }], '+61491579212');

    expect(warning).toContain('2 clients: A, B');
    expect(warning).toContain('+61491579212');
    expect(warning).toContain('cannot be recalled');
  });

  it('the per-client sentences are untouched by the clause', () => {
    expect(armedMessage('sms', 'client', ARMED_CLIENTS)).not.toContain('2 clients');
    expect(armedMessage('email', 'client', ARMED_CLIENTS)).toBe(
      'Armed. Email is on for this client from the next tick.',
    );
  });
});

describe('the repository’s outcomes become sentences', () => {
  it('no_identity names the missing field', async () => {
    armChannel.mockResolvedValue({ kind: 'no_identity', missing: 'reply_to' });

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'email', target: 'client' }),
    );

    expect(state.error).toBe(armNoIdentityMessage('email', 'reply_to'));
    expect(state.error).toContain('reply-to');
    expect(state.success).toBeNull();
  });

  it('already_armed says so rather than claiming a second arming', async () => {
    armChannel.mockResolvedValue({ kind: 'already_armed', config: {} });

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone' }),
    );

    expect(state.error).toBe(ARM_ALREADY_MESSAGE.sms);
    expect(state.success).toBeNull();
  });

  it('a thrown write NEVER leaks the database error text (T-10-06)', async () => {
    const MARKER = 'reason-typed-by-the-operator-about-this-client';
    armChannel.mockRejectedValue(new Error(`insert failed: ${MARKER}`));

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'everyone', reason: MARKER }),
    );

    expect(state.error).toBe(ARM_WRITE_FAILED_MESSAGE);
    // The statement's parameters carry the operator's own words; the caught
    // value is discarded and a fixed line is logged instead.
    expect(JSON.stringify(state)).not.toContain(MARKER);
  });
});

describe('disarming is never gated, and always explained (D-04, D-05)', () => {
  it('refuses an empty reason before any write and without reading the gate', async () => {
    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', scope: 'everyone', reason: '   ' }),
    );

    expect(state.error).toBe(DISARM_REASON_REQUIRED_MESSAGE);
    expect(disarmChannel).not.toHaveBeenCalled();
    expect(readGoLiveChecklist).not.toHaveBeenCalled();
  });

  it('turns one client off without consulting the checklist at all', async () => {
    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', scope: 'client', reason: 'test tenant — keep off' }),
    );

    expect(disarmChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sms',
        tenantId: TENANT_ID,
        operatorUserId: OPERATOR_ID,
        reason: 'test tenant — keep off',
      }),
    );
    expect(state.success).toBe(disarmedMessage('sms', 'client'));
    // THE RULE, AS AN ASSERTION: nothing may stand between an operator and
    // stopping sending, including a gate that cannot be read.
    expect(readGoLiveChecklist).not.toHaveBeenCalled();
  });

  it('turns EVERY client off on the shared row', async () => {
    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', scope: 'everyone', reason: 'opt-out spike' }),
    );

    expect(disarmChannel).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null }));
    expect(state.success).toBe(disarmedMessage('sms', 'everyone'));
    expect(state.success).toContain('every client');
  });

  it('still refuses a disarm whose reason the repository rejects', async () => {
    disarmChannel.mockResolvedValue({ kind: 'reason_required' });

    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'email', scope: 'client', reason: 'x' }),
    );

    expect(state.error).toBe(DISARM_REASON_REQUIRED_MESSAGE);
  });
});

describe('the posted body is bounded (T-6-15)', () => {
  it('refuses a channel that is not one of the two', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'carrier-pigeon', target: 'everyone' }),
    );

    expect(state.success).toBeNull();
    expect(armChannel).not.toHaveBeenCalled();
  });

  it('refuses a reason longer than the column’s ceiling', async () => {
    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', scope: 'everyone', reason: 'x'.repeat(501) }),
    );

    expect(state.success).toBeNull();
    expect(disarmChannel).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * TEXT-BACK — per client, behind the gate and the privacy predicate (12-08)
 * -------------------------------------------------------------------------- */

describe('text_back arms ONE client, behind the gate and the privacy notice (D-09, D-11)', () => {
  it('arms this client when every gate is met and the notice covers callers', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBeNull();
    expect(state.success).toBe(armedMessage('text_back', 'client'));
    expect(armChannel).toHaveBeenCalledTimes(1);
    expect(armChannel).toHaveBeenCalledWith({
      channel: 'text_back',
      tenantId: TENANT_ID,
      operatorUserId: OPERATOR_ID,
      reason: undefined,
    });
    // The gate was re-read on the server, not trusted from the browser.
    expect(readGoLiveChecklist).toHaveBeenCalledTimes(1);
    // The DEPLOYED copy was asked — the very sections /privacy renders.
    expect(privacyCoversCallers).toHaveBeenCalledWith(PRIVACY_COPY.sections);
    // A per-client arm names nobody else.
    expect(forAllTenants_armedBySmsGlobal).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it('refuses target everyone with the per-client sentence, before ANY read', async () => {
    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'everyone' }),
    );

    expect(state.error).toBe(ARM_TEXT_BACK_PER_CLIENT_MESSAGE);
    expect(armChannel).not.toHaveBeenCalled();
    expect(readGoLiveChecklist).not.toHaveBeenCalled();
    expect(privacyCoversCallers).not.toHaveBeenCalled();
  });

  it('refuses a disarm aimed at everyone the same way — there is no shared text-back row', async () => {
    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', scope: 'everyone', reason: 'stop everything' }),
    );

    expect(state.error).toBe(ARM_TEXT_BACK_PER_CLIENT_MESSAGE);
    expect(disarmChannel).not.toHaveBeenCalled();
  });

  it('refuses when the privacy notice does not cover callers, BEFORE the checklist is read', async () => {
    privacyCoversCallers.mockReturnValue(false);

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(ARM_TEXT_BACK_PRIVACY_MESSAGE);
    expect(state.error).toBe('Text-back cannot be turned on until the privacy notice covers callers.');
    expect(readGoLiveChecklist).not.toHaveBeenCalled();
    expect(armChannel).not.toHaveBeenCalled();
  });

  it('the privacy predicate gates TEXT-BACK only — an sms arm never asks it', async () => {
    privacyCoversCallers.mockReturnValue(false);

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'sms', target: 'client' }),
    );

    expect(state.error).toBeNull();
    expect(privacyCoversCallers).not.toHaveBeenCalled();
  });

  it.each(TEXT_BACK_GATES)('refuses naming %s when it alone is unmet, and writes nothing', async (key) => {
    readGoLiveChecklist.mockResolvedValue(checklistFixture({ unsatisfied: [key] }));

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(ARM_REFUSAL[key]);
    expect(state.success).toBeNull();
    expect(armChannel).not.toHaveBeenCalled();
  });

  it('every one of the ten refusals is its own non-empty sentence', () => {
    const sentences = TEXT_BACK_GATES.map((key) => ARM_REFUSAL[key]);
    for (const sentence of sentences) expect(sentence.trim()).not.toBe('');
    expect(new Set(sentences).size).toBe(TEXT_BACK_GATES.length);
    expect(ARM_REFUSAL.smsArmed).toBe(
      'Arm SMS for this client first — text-backs leave from the same number.',
    );
  });

  it('names the EARLIER of two unmet items', async () => {
    readGoLiveChecklist.mockResolvedValue(
      checklistFixture({ unsatisfied: ['neverTextOwnNumber', 'divertVerified'] }),
    );

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(ARM_REFUSAL.divertVerified);
  });

  it('an item ABSENT from the read is unmet — never vacuously satisfied', async () => {
    const fixture = checklistFixture();
    fixture.items = fixture.items.filter((item) => item.key !== 'textBackTemplates');
    readGoLiveChecklist.mockResolvedValue(fixture);

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(ARM_REFUSAL.textBackTemplates);
    expect(armChannel).not.toHaveBeenCalled();
  });

  it('an UNREADABLE checklist is a refusal, not a pass', async () => {
    readGoLiveChecklist.mockRejectedValue(new Error('pool exhausted'));

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(ARM_WRITE_FAILED_MESSAGE);
    expect(armChannel).not.toHaveBeenCalled();
  });

  it("maps the repository's per_tenant_only answer to the per-client sentence", async () => {
    armChannel.mockResolvedValue({ kind: 'per_tenant_only' });

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(ARM_TEXT_BACK_PER_CLIENT_MESSAGE);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('already_armed says so, and writes no second history', async () => {
    armChannel.mockResolvedValue({ kind: 'already_armed', config: {} });

    const state = await armChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', target: 'client' }),
    );

    expect(state.error).toBe(ARM_ALREADY_MESSAGE.text_back);
  });
});

describe('turning text-back OFF is never gated (D-09, T-12-32)', () => {
  it('reads no checklist and no privacy notice, and disarms THIS client with the reason', async () => {
    privacyCoversCallers.mockReturnValue(false);
    readGoLiveChecklist.mockRejectedValue(new Error('must not be read'));

    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', scope: 'client', reason: 'client is on holiday' }),
    );

    expect(state.error).toBeNull();
    expect(state.success).toBe(disarmedMessage('text_back', 'client'));
    expect(state.success).toContain('The greeting keeps answering');
    expect(disarmChannel).toHaveBeenCalledWith({
      channel: 'text_back',
      tenantId: TENANT_ID,
      operatorUserId: OPERATOR_ID,
      reason: 'client is on holiday',
    });
    expect(readGoLiveChecklist).not.toHaveBeenCalled();
    expect(privacyCoversCallers).not.toHaveBeenCalled();
  });

  it('requires a reason — refused before any write', async () => {
    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', scope: 'client', reason: '   ' }),
    );

    expect(state.error).toBe(DISARM_REASON_REQUIRED_MESSAGE);
    expect(disarmChannel).not.toHaveBeenCalled();
  });

  it('already off says so', async () => {
    disarmChannel.mockResolvedValue({ kind: 'already_disarmed', config: {} });

    const state = await disarmChannelAction(
      TENANT_ID,
      BLANK_ARM_STATE,
      form({ channel: 'text_back', scope: 'client', reason: 'double tap' }),
    );

    expect(state.error).toBe(DISARM_ALREADY_MESSAGE.text_back);
  });
});
