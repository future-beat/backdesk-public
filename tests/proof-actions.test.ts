/**
 * ARM-03 / DOM-04: `recordProofAction` authorizes FIRST, refuses an unarmed
 * channel and an unverifiable artefact WITHOUT WRITING, and never records a
 * proof whose artefact it has not just read back live (D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OPERATOR'S PASTE IS UNTRUSTED INPUT THAT NAMES A PRODUCTION ROW.     │
 * │ A Server Action id is global, so this POST can be made from any route by │
 * │ anyone with a session, and the write goes through the service-role       │
 * │ repository where RLS is inert by design. Every assertion below is about  │
 * │ the SERVER's behaviour, never about what the card chose to render.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE: the repository, `readGoLiveChecklist`, the Resend read and `next/cache`
 * are mocked, and Supabase's client is faked ONE LEVEL BELOW `requireOperatorId`
 * so the REAL allowlist gate runs against a fake session. The sentences are real
 * — they are the rules under test, and a mocked message would prove the action
 * returns something rather than that it refuses anything.
 *
 * AND NO TEST HERE TOUCHES A DATABASE OR A PROVIDER. A `tenant_proofs` row is
 * evidence about production; a suite that could write one is a suite that could
 * manufacture it (D-06). The DB-backed half of this plan is
 * tests/tenant-proofs.test.ts, and it proves the table's own refusals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const append = vi.fn();
const forTenant = vi.fn();
const getEscalationForTenant = vi.fn();
const getMissedCallForTenant = vi.fn();
const getTextBackEvidenceForTenant = vi.fn();
const getEmailStatus = vi.fn();
const readGoLiveChecklist = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/db/repository', () => ({
  forTenant: (tenantId: string) => forTenant(tenantId),
  getEscalationForTenant: (tenantId: string, id: string) => getEscalationForTenant(tenantId, id),
  // The verification-call arm's tenant-scoped read (CAP-05, 11-05).
  getMissedCallForTenant: (tenantId: string, id: string) => getMissedCallForTenant(tenantId, id),
  // The text_back_proof arm's tenant-scoped read (12-08, D-13).
  getTextBackEvidenceForTenant: (tenantId: string, id: string) =>
    getTextBackEvidenceForTenant(tenantId, id),
  // The arming actions live in the same module and are imported by it.
  armChannel: vi.fn(),
  disarmChannel: vi.fn(),
  forAllTenants_armedBySmsGlobal: vi.fn(),
}));

// ONLY THE PROVIDER READ IS FAKED. `bareAddress` is the REAL normaliser both
// sides of the CR-01 ownership comparison go through, and a stubbed one would
// prove the action calls something rather than that the comparison holds.
vi.mock('@/core/messaging/resend-emails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/messaging/resend-emails')>()),
  getEmailStatus: (id: string) => getEmailStatus(id),
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
            return { data: { id: TENANT_ID }, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { recordProofAction } = await import('@/app/(console)/clients/[id]/actions');
const {
  BLANK_PROOF_STATE,
  PROOF_ARTEFACT_NOT_MISSED_CALL_ID_MESSAGE,
  PROOF_ARTEFACT_NOT_RESEND_ID_MESSAGE,
  PROOF_ARTEFACT_NOT_TEXT_BACK_ID_MESSAGE,
  PROOF_ARTEFACT_NOT_UUID_MESSAGE,
  PROOF_ARTEFACT_REQUIRED_MESSAGE,
  PROOF_CHANNEL_NOT_ARMED_MESSAGE,
  PROOF_DIVERT_NOT_ACTIVE_MESSAGE,
  PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE,
  PROOF_EMAIL_STATUS_UNKNOWN_MESSAGE,
  PROOF_ESCALATION_NOT_FOUND_MESSAGE,
  PROOF_MISSED_CALL_NO_CALLER_MESSAGE,
  PROOF_MISSED_CALL_NOT_FOUND_MESSAGE,
  PROOF_MISSED_CALL_NOT_THIS_NUMBER_MESSAGE,
  PROOF_MISSED_CALL_STALE_MESSAGE,
  PROOF_NOTE_REQUIRED_MESSAGE,
  PROOF_TEXT_BACK_LEDGER_NOT_SENT_MESSAGE,
  PROOF_TEXT_BACK_NOT_DELIVERED_MESSAGE,
  PROOF_TEXT_BACK_NOT_LEAD_MESSAGE,
  PROOF_TEXT_BACK_STALE_MESSAGE,
  PROOF_WRITE_FAILED_MESSAGE,
  proofEmailNotDeliveredMessage,
  proofTextBackNotSentMessage,
  proofEscalationNotSentMessage,
  proofMissedCallNotCompletedMessage,
  proofRecordedMessage,
} = await import('@/app/(console)/clients/[id]/action-state');
const { OPERATOR_DENIED_MESSAGE } = await import('@/app/(console)/_auth');

const TENANT_ID = '77777777-7777-4777-8777-777777777777';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
const ESCALATION_ID = '44444444-4444-4444-8444-444444444444';
/**
 * UUID-SHAPED, because Resend email ids are (WR-03). The old fixture
 * (`resend-message-0001`) was the reason a wrong premise looked proven: it is
 * not an id the provider would ever mint, and the test built on it asserted
 * that no shape was required at all.
 */
const RESEND_ID = '0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const NOTE = 'Dave held up his phone on the driveway and read it out.';

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

const MISSED_CALL_ID = '99999999-9999-4999-8999-999999999999';
/** The client's ACTIVE divert row — the number the verification call must hit (WR-02). */
const DIVERT_NUMBER_ID = '22222222-2222-4222-8222-222222222222';
/** Five minutes before the test ran: inside the 24-hour recency window. */
const RECENT_START = new Date(Date.now() - 5 * 60_000);

/** Every item satisfied — each test unsatisfies exactly the one it is about. */
function checklistFixture(
  unsatisfied: readonly string[] = [],
  divertStatus: 'none' | 'pending' | 'active' | 'failed' = 'active',
) {
  const off = new Set(unsatisfied);
  return {
    items: ALL_KEYS.map((key) => ({ key, satisfied: !off.has(key), detail: null })),
    attestation: { attestedAt: new Date(), note: 'seeded', isStale: false, ageDays: 0 },
    arming: {
      sms: { from: '+61491570162', source: 'global', tenantRow: null, globalEnabled: true },
      email: {
        from: 'quotes@example.test',
        tenantRow: {
          enabled: true,
          fromAddress: 'quotes@example.test',
          replyTo: 'dave@example.test',
          businessName: "Dave's Plumbing",
        },
        domain: 'verified',
      },
    },
    proofs: { escalationHandset: null, emailPipe: null, divertVerification: null, textBack: null },
    divert: {
      numberE164: divertStatus === 'active' ? '+61891570156' : null,
      divertNumberId: divertStatus === 'active' ? DIVERT_NUMBER_ID : null,
      status: divertStatus,
      spokenName: "Dave's Plumbing",
      statusSince: null,
      failureCode: null,
      lastCallAt: null,
      daysSinceLastCall: null,
    },
    live: { sms: 'armed', email: 'armed', textBack: 'armed' },
  };
}

/** A delivered lead text-back, as `getTextBackEvidenceForTenant` returns it. */
function textBackEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: MISSED_CALL_ID,
    textBackStatus: 'sent',
    textBackRoute: 'lead',
    afterHours: true,
    startedAt: RECENT_START,
    endedAt: new Date(RECENT_START.getTime() + 12_000),
    forwardedFromPresent: false,
    outcome: 'sent',
    providerMessageId: 'clicksend-tb-0001',
    claimedAt: new Date(RECENT_START.getTime() + 13_000),
    deliveryStatus: 'delivered',
    deliveredAt: new Date(RECENT_START.getTime() + 21_600),
    ...overrides,
  };
}

function textBackForm(overrides: Record<string, string> = {}): FormData {
  return form({
    kind: 'text_back_proof',
    artefact_id: MISSED_CALL_ID,
    note: 'Arrived on my second phone 22 seconds after hanging up; the after-hours wording.',
    ...overrides,
  });
}

/** A completed verification call, as `getMissedCallForTenant` returns it. */
function missedCall(overrides: Record<string, unknown> = {}) {
  return {
    id: MISSED_CALL_ID,
    providerCallId: 'CA' + 'd'.repeat(32),
    callStatus: 'completed',
    durationSeconds: 11,
    afterHours: false,
    callerKind: 'mobile',
    callerWithheld: false,
    callerPresent: true,
    forwardedFromPresent: true,
    startedAt: RECENT_START,
    endedAt: new Date(RECENT_START.getTime() + 11_000),
    divertNumberId: DIVERT_NUMBER_ID,
    completedVia: 'callback',
    ...overrides,
  };
}

function divertForm(overrides: Record<string, string> = {}): FormData {
  return form({
    kind: 'divert_verification_call',
    artefact_id: MISSED_CALL_ID,
    note: 'Rang my own mobile from the office line; it diverted and the greeting played.',
    ...overrides,
  });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The happy-path SMS post. Each test changes one field. */
function smsForm(overrides: Record<string, string> = {}): FormData {
  return form({
    kind: 'escalation_handset_proof',
    artefact_id: ESCALATION_ID,
    note: NOTE,
    ...overrides,
  });
}

function emailForm(overrides: Record<string, string> = {}): FormData {
  return form({
    kind: 'email_pipe_proof',
    artefact_id: RESEND_ID,
    note: 'Landed in the ops inbox; SPF and DKIM both pass in the headers.',
    ...overrides,
  });
}

beforeEach(() => {
  append.mockReset();
  append.mockResolvedValue([{ id: 'proof-1' }]);
  forTenant.mockReset();
  forTenant.mockReturnValue({ proofs: { append } });
  getEscalationForTenant.mockReset();
  getEscalationForTenant.mockResolvedValue({
    id: ESCALATION_ID,
    inboundMessageId: '55555555-5555-4555-8555-555555555555',
    cadenceId: '66666666-6666-4666-8666-666666666666',
    quoteId: '88888888-8888-4888-8888-888888888888',
    sentAt: new Date('2026-09-03T02:15:00.000Z'),
    outcome: 'sent',
    providerMessageId: 'clicksend-abc123',
    createdAt: new Date('2026-09-03T02:14:59.000Z'),
  });
  getMissedCallForTenant.mockReset();
  getMissedCallForTenant.mockResolvedValue(missedCall());
  getTextBackEvidenceForTenant.mockReset();
  getTextBackEvidenceForTenant.mockResolvedValue(textBackEvidence());
  getEmailStatus.mockReset();
  getEmailStatus.mockResolvedValue({
    ok: true,
    id: RESEND_ID,
    lastEvent: 'delivered',
    delivered: true,
    toDomain: 'example.test',
    // The SAME address the checklist fixture's armed row carries — the proof
    // only holds when those two agree (CR-01).
    fromAddress: 'quotes@example.test',
    createdAt: '2026-09-03T02:20:00.000Z',
  });
  readGoLiveChecklist.mockReset();
  readGoLiveChecklist.mockResolvedValue(checklistFixture());
  revalidatePath.mockClear();
  session = { userId: OPERATOR_ID, allowlisted: true };
  // The write-failure tests log one fixed line by design.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- *
 * Authorization runs before anything else
 * -------------------------------------------------------------------------- */

describe('authorization runs before anything else (WR-01, T-10-19)', () => {
  it('refuses an unauthenticated session and reads nothing', async () => {
    session = { userId: null, allowlisted: false };

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.unauthenticated);
    expect(append).not.toHaveBeenCalled();
    // NOT EVEN THE CHECKLIST OR THE ARTEFACT: there is nothing worth asking
    // about a client for a caller with no session.
    expect(readGoLiveChecklist).not.toHaveBeenCalled();
    expect(getEscalationForTenant).not.toHaveBeenCalled();
  });

  it('refuses a signed-in session that is not on the operator allowlist', async () => {
    session = { userId: OPERATOR_ID, allowlisted: false };

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBe(OPERATOR_DENIED_MESSAGE.forbidden);
    expect(append).not.toHaveBeenCalled();
    expect(getEscalationForTenant).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * What the form itself must carry
 * -------------------------------------------------------------------------- */

describe('no proof without an artefact id and a note (D-02)', () => {
  it('refuses an empty note, and writes nothing', async () => {
    // The note is the only record that a HUMAN was at the other end of the
    // artefact. An id with no sentence beside it is a row, not an observation.
    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm({ note: '   ' }));

    expect(state.error).toBe(PROOF_NOTE_REQUIRED_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses an artefact id under eight characters, naming where to get one', async () => {
    const state = await recordProofAction(
      TENANT_ID,
      BLANK_PROOF_STATE,
      smsForm({ artefact_id: 'abc' }),
    );

    expect(state.error).toBe(PROOF_ARTEFACT_REQUIRED_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses an unknown kind — the field is not the operator\'s to choose', async () => {
    const state = await recordProofAction(
      TENANT_ID,
      BLANK_PROOF_STATE,
      smsForm({ kind: 'everything_is_fine' }),
    );

    expect(state.error).not.toBeNull();
    expect(state.success).toBeNull();
    expect(append).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * The channel must be armed
 * -------------------------------------------------------------------------- */

describe('a proof for an unarmed channel is refused (T-10-18)', () => {
  it('refuses the handset proof when SMS is not armed, without reading the artefact', async () => {
    readGoLiveChecklist.mockResolvedValue(checklistFixture(['smsArmed']));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBe(PROOF_CHANNEL_NOT_ARMED_MESSAGE.sms);
    // NOT READ, NOT WRITTEN: a proof records a message that actually left, and
    // a disarmed channel cannot have sent one.
    expect(getEscalationForTenant).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses the email proof when email is not armed', async () => {
    readGoLiveChecklist.mockResolvedValue(checklistFixture(['emailArmed']));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

    expect(state.error).toBe(PROOF_CHANNEL_NOT_ARMED_MESSAGE.email);
    expect(getEmailStatus).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses when the checklist cannot be read — a read that failed did not pass', async () => {
    readGoLiveChecklist.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBe(PROOF_WRITE_FAILED_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * The escalation artefact, verified live
 * -------------------------------------------------------------------------- */

describe('the escalation artefact is verified live and tenant-scoped (T-10-17)', () => {
  it('refuses a non-uuid artefact before touching the repository', async () => {
    const state = await recordProofAction(
      TENANT_ID,
      BLANK_PROOF_STATE,
      smsForm({ artefact_id: 'clicksend-abc123' }),
    );

    expect(state.error).toBe(PROOF_ARTEFACT_NOT_UUID_MESSAGE);
    expect(getEscalationForTenant).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses an id that belongs to no escalation of this client', async () => {
    getEscalationForTenant.mockResolvedValue(null);

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBe(PROOF_ESCALATION_NOT_FOUND_MESSAGE);
    // THE TENANT TRAVELS IN THE READ — the scoping is the query's, not a
    // comparison made afterwards.
    expect(getEscalationForTenant).toHaveBeenCalledWith(TENANT_ID, ESCALATION_ID);
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    'no_escalation_number',
    'sms_not_configured',
    'cooldown_suppressed',
    'INVALID_RECIPIENT',
  ])('refuses the ARM-03 empty state %s, naming the outcome', async (outcome) => {
    // These are rows the escalation pass writes HONESTLY when it could not
    // send — findable, pasteable, and exactly what an operator working through
    // the runbook might mistake for evidence.
    getEscalationForTenant.mockResolvedValue({
      id: ESCALATION_ID,
      inboundMessageId: '55555555-5555-4555-8555-555555555555',
      cadenceId: '66666666-6666-4666-8666-666666666666',
      quoteId: '88888888-8888-4888-8888-888888888888',
      sentAt: null,
      outcome,
      providerMessageId: null,
      createdAt: new Date(),
    });

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBe(proofEscalationNotSentMessage(outcome));
    expect(state.error).toContain(outcome);
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses a CLAIMED row — outcome sent but no provider message id', async () => {
    // `outcome IS NULL` means "claimed, outcome unknown", and a sent row with no
    // provider id is the same shape of unknown: nothing survives outside this
    // database for anybody to re-check.
    getEscalationForTenant.mockResolvedValue({
      id: ESCALATION_ID,
      inboundMessageId: '55555555-5555-4555-8555-555555555555',
      cadenceId: '66666666-6666-4666-8666-666666666666',
      quoteId: '88888888-8888-4888-8888-888888888888',
      sentAt: new Date(),
      outcome: 'sent',
      providerMessageId: null,
      createdAt: new Date(),
    });

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toContain('Only a row with outcome sent and a provider message id');
    expect(append).not.toHaveBeenCalled();
  });

  it('records a sent escalation with ids and a timestamp — and nothing else', async () => {
    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBeNull();
    expect(state.success).toBe(proofRecordedMessage('escalation_handset_proof'));

    expect(forTenant).toHaveBeenCalledWith(TENANT_ID);
    expect(append).toHaveBeenCalledWith({
      kind: 'escalation_handset_proof',
      artefactId: ESCALATION_ID,
      artefactDetail: {
        provider_message_id: 'clicksend-abc123',
        sent_at: '2026-09-03T02:15:00.000Z',
      },
      note: NOTE,
      // THE VERIFIED CLAIM, never a form field: `recorded_by` answers "whose
      // hand was on this", and a caller-supplied id answers it with the
      // caller's opinion of themselves.
      recordedBy: OPERATOR_ID,
    });

    // IDS, STATUSES AND TIMESTAMPS ONLY (T-10-20). The tradie's mobile is on
    // the escalation row and must never reach the artefact.
    const detail = append.mock.calls[0][0].artefactDetail as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(['provider_message_id', 'sent_at']);

    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });
});

/* -------------------------------------------------------------------------- *
 * The email artefact, verified live
 * -------------------------------------------------------------------------- */

describe('the email artefact is read back at Resend (DOM-04, D-07)', () => {
  it('refuses — without writing — when the provider read fails', async () => {
    getEmailStatus.mockResolvedValue({ ok: false, reason: 'not_found' });

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

    // A FAILED READ IS NOT A BOUNCE. Treating an outage as not-delivered sends
    // an operator to re-verify a domain that is fine.
    expect(state.error).toBe(PROOF_EMAIL_STATUS_UNKNOWN_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it.each(['bounced', 'queued', 'sent', 'complained', 'delivery_delayed'])(
    'refuses last_event %s, naming it',
    async (lastEvent) => {
      getEmailStatus.mockResolvedValue({
        ok: true,
        id: RESEND_ID,
        lastEvent,
        // The WRAPPER decides this, and for these five it is false. Passing it
        // explicitly is what makes the refusal a test of the action's reading
        // of the wrapper rather than of its own second comparison.
        delivered: false,
        toDomain: 'example.test',
        fromAddress: 'quotes@example.test',
        createdAt: null,
      });

      const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

      // ACCEPTED IS NOT DELIVERED: a message Resend took can still bounce at the
      // receiving server minutes later, which is precisely the failure a proof
      // about a newly verified sending domain exists to catch.
      expect(state.error).toBe(proofEmailNotDeliveredMessage(lastEvent));
      expect(state.error).toContain(lastEvent);
      expect(append).not.toHaveBeenCalled();
    },
  );

  it.each(['opened', 'clicked'])(
    'RECORDS a post-delivery last_event (%s) — D-07 produces these itself (WR-02)',
    async (lastEvent) => {
      // The runbook has the operator open the proof email in a real inbox and
      // exercise the one-click link BEFORE recording the proof. On a domain with
      // open or click tracking, `last_event` reads `opened`/`clicked` by then —
      // and a refusal would make D-07's sequence unable to record its own proof.
      getEmailStatus.mockResolvedValue({
        ok: true,
        id: RESEND_ID,
        lastEvent,
        delivered: true,
        toDomain: 'example.test',
        fromAddress: 'quotes@example.test',
        createdAt: null,
      });

      const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

      expect(state.error).toBeNull();
      expect(state.success).toBe(proofRecordedMessage('email_pipe_proof'));
      // The artefact records WHAT RESEND SAID, not the boolean we derived: the
      // row has to stay re-checkable against the provider by somebody who was
      // not there.
      expect(append).toHaveBeenCalledWith(
        expect.objectContaining({
          artefactDetail: { last_event: lastEvent, to_domain: 'example.test' },
        }),
      );
    },
  );

  it('records a delivered email with its last event and the recipient DOMAIN', async () => {
    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

    expect(state.success).toBe(proofRecordedMessage('email_pipe_proof'));
    expect(getEmailStatus).toHaveBeenCalledWith(RESEND_ID);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'email_pipe_proof',
        artefactId: RESEND_ID,
        artefactDetail: { last_event: 'delivered', to_domain: 'example.test' },
        recordedBy: OPERATOR_ID,
      }),
    );

    // THE DOMAIN, NEVER THE ADDRESS. The whole message — subject, html, the
    // recipient in full — is in Resend's response and none of it may land in a
    // row that outlives the client.
    const detail = append.mock.calls[0][0].artefactDetail as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(['last_event', 'to_domain']);
  });

  it.each([
    ['another founding client’s cadence', 'quotes@othertradie.test'],
    ['the operator alert address', 'alerts@quotes.backdesk.com.au'],
  ])('refuses a delivered email sent from %s — without writing (CR-01)', async (_label, from) => {
    // THE TENANT SCOPING THE PREDICATE GIVES THE OTHER HALF FOR FREE. One
    // Resend account carries every client's cadence, the operator alerts and
    // the audit pipeline, so `delivered` alone proves only that SOME email on
    // the account arrived — and this client's `live.email` would go green on
    // somebody else's message.
    getEmailStatus.mockResolvedValue({
      ok: true,
      id: RESEND_ID,
      lastEvent: 'delivered',
      delivered: true,
      toDomain: 'example.test',
      fromAddress: from,
      createdAt: null,
    });

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

    expect(state.error).toBe(PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE);
    // AND NEITHER ADDRESS IS NAMED: the sender belongs to another business, and
    // a refusal that echoed it would read one out of this form per paste.
    expect(state.error).not.toContain(from);
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses when the provider will not say who sent it (CR-01)', async () => {
    // `null` is "unparseable", which is not "it was this client" — there is
    // nothing to compare against, and that has never meant yes.
    getEmailStatus.mockResolvedValue({
      ok: true,
      id: RESEND_ID,
      lastEvent: 'delivered',
      delivered: true,
      toDomain: 'example.test',
      fromAddress: null,
      createdAt: null,
    });

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

    expect(state.error).toBe(PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it('matches the armed identity case-insensitively, display name and all', async () => {
    // BOTH SIDES GO THROUGH THE SAME NORMALISER, which is why this is asserted
    // on the stored side too: `from_address` is a bare lowercase address today,
    // but the value Resend echoes is whatever header was sent (`Dave's Plumbing
    // <…>`), and a comparison that a display name or a capital letter can fail
    // is one that refuses a real client's own proof.
    getEmailStatus.mockResolvedValue({
      ok: true,
      id: RESEND_ID,
      lastEvent: 'delivered',
      delivered: true,
      toDomain: 'example.test',
      fromAddress: 'quotes@example.test',
      createdAt: null,
    });
    readGoLiveChecklist.mockResolvedValue({
      ...checklistFixture(),
      arming: {
        ...checklistFixture().arming,
        email: {
          ...checklistFixture().arming.email,
          from: "Dave's Plumbing <Quotes@Example.TEST>",
        },
      },
    });

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

    expect(state.error).toBeNull();
    expect(append).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a path traversal into another endpoint', '../domains'],
    ['a query string', 'abcdef0123456789abcd?expand=true'],
    ['an escalation row id pasted by mistake', 'NOT-A-RESEND-ID-BUT-LONG-ENOUGH'],
  ])('refuses %s before it reaches the provider URL (WR-03)', async (_label, id) => {
    // `emails.get(id)` interpolates this into `GET /emails/{id}` unencoded, so
    // the paste picks the endpoint if nothing checks it first. The escalation
    // half validates before its read and so does the runbook script before this
    // same call; this was the one caller that did neither.
    const state = await recordProofAction(
      TENANT_ID,
      BLANK_PROOF_STATE,
      emailForm({ artefact_id: id }),
    );

    expect(state.error).toBe(PROOF_ARTEFACT_NOT_RESEND_ID_MESSAGE);
    expect(getEmailStatus).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('accepts the id shape the runbook script accepts — one spelling, two readers', async () => {
    // `scripts/resend-email-status.mjs` validates with the same pattern. An id
    // that script takes and this form refuses is a mid-go-live dead end.
    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, emailForm());

    expect(state.error).toBeNull();
    expect(getEmailStatus).toHaveBeenCalledWith(RESEND_ID);
  });
});

/* -------------------------------------------------------------------------- *
 * The write itself
 * -------------------------------------------------------------------------- */

describe('a failed write says so, and says nothing else (WR-08, T-10-20)', () => {
  it('returns the fixed sentence and never the thrown text', async () => {
    append.mockRejectedValue(
      new Error(
        'insert into "tenant_proofs" ... note = "Dave held up his phone" provider_message_id = "clicksend-abc123"',
      ),
    );

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, smsForm());

    expect(state.error).toBe(PROOF_WRITE_FAILED_MESSAGE);
    // A postgres error from that INSERT carries the statement, and its
    // parameters include the operator's note and a provider id.
    expect(state.error).not.toContain('clicksend-abc123');
    expect(state.error).not.toContain('Dave held up his phone');
    expect(state.success).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * The verification call (CAP-05, D-09, T-11-15)
 * -------------------------------------------------------------------------- */

describe('the divert_verification_call artefact is a completed call of THIS client', () => {
  it('refuses a non-uuid before the repository read', async () => {
    const state = await recordProofAction(
      TENANT_ID,
      BLANK_PROOF_STATE,
      divertForm({ artefact_id: 'CAdddddddddddddddd' }),
    );

    expect(state.error).toBe(PROOF_ARTEFACT_NOT_MISSED_CALL_ID_MESSAGE);
    expect(getMissedCallForTenant).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses an unknown or foreign id — the tenant travels in the read', async () => {
    getMissedCallForTenant.mockResolvedValue(null);

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBe(PROOF_MISSED_CALL_NOT_FOUND_MESSAGE);
    expect(getMissedCallForTenant).toHaveBeenCalledWith(TENANT_ID, MISSED_CALL_ID);
    expect(append).not.toHaveBeenCalled();
  });

  it.each(['no-answer', 'ringing', 'failed', 'busy'])(
    'refuses a call whose status is %s, naming it',
    async (callStatus) => {
      getMissedCallForTenant.mockResolvedValue(missedCall({ callStatus }));

      const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

      expect(state.error).toBe(proofMissedCallNotCompletedMessage(callStatus));
      expect(state.error).toContain(callStatus);
      expect(append).not.toHaveBeenCalled();
    },
  );

  it('refuses a call with no status yet (the callback has not landed)', async () => {
    getMissedCallForTenant.mockResolvedValue(missedCall({ callStatus: null }));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBe(proofMissedCallNotCompletedMessage(null));
    expect(append).not.toHaveBeenCalled();
  });

  it.each(['pending', 'failed', 'none'] as const)(
    'refuses while the divert row is %s — without reading the call',
    async (status) => {
      readGoLiveChecklist.mockResolvedValue(checklistFixture([], status));

      const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

      expect(state.error).toBe(PROOF_DIVERT_NOT_ACTIVE_MESSAGE);
      expect(getMissedCallForTenant).not.toHaveBeenCalled();
      expect(append).not.toHaveBeenCalled();
    },
  );

  it('is NOT gated on a messaging channel being armed — it proves the divert', async () => {
    readGoLiveChecklist.mockResolvedValue(checklistFixture(['smsArmed', 'emailArmed']));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBeNull();
    expect(append).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['withheld (#31#)', { callerWithheld: true, callerPresent: false, callerKind: 'withheld' }],
    ['present-flag false (the carrier stripped the CLI)', { callerWithheld: false, callerPresent: false }],
    ['withheld flag with a number somehow present', { callerWithheld: true, callerPresent: true }],
  ])('refuses a call whose caller is %s — the divert kept nobody (WR-02)', async (_l, patch) => {
    getMissedCallForTenant.mockResolvedValue(missedCall(patch));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBe(PROOF_MISSED_CALL_NO_CALLER_MESSAGE);
    expect(state.error).toContain('DIVERTED call from a second phone');
    expect(append).not.toHaveBeenCalled();
  });

  it("refuses a call that arrived on a number other than the client's ACTIVE one (WR-02)", async () => {
    getMissedCallForTenant.mockResolvedValue(
      missedCall({ divertNumberId: '33333333-3333-4333-8333-333333333333' }),
    );

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBe(PROOF_MISSED_CALL_NOT_THIS_NUMBER_MESSAGE);
    expect(state.error).toContain('second phone');
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses a call with no divert row id at all (a dead letter adopted later) (WR-02)', async () => {
    getMissedCallForTenant.mockResolvedValue(missedCall({ divertNumberId: null }));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBe(PROOF_MISSED_CALL_NOT_THIS_NUMBER_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses a call more than 24 hours old, and one stamped in the future (WR-02)', async () => {
    getMissedCallForTenant.mockResolvedValue(
      missedCall({ startedAt: new Date(Date.now() - 25 * 3_600_000) }),
    );
    expect((await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm())).error).toBe(
      PROOF_MISSED_CALL_STALE_MESSAGE,
    );

    getMissedCallForTenant.mockResolvedValue(missedCall({ startedAt: new Date(Date.now() + 3_600_000) }));
    expect((await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm())).error).toBe(
      PROOF_MISSED_CALL_STALE_MESSAGE,
    );
    expect(append).not.toHaveBeenCalled();
  });

  it('accepts a call 23 hours old — the window is a day, not "today"', async () => {
    getMissedCallForTenant.mockResolvedValue(
      missedCall({ startedAt: new Date(Date.now() - 23 * 3_600_000) }),
    );

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBeNull();
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('refuses with the fixed sentence when the call read throws', async () => {
    getMissedCallForTenant.mockRejectedValue(new Error('select ... +61412345678 ...'));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBe(PROOF_WRITE_FAILED_MESSAGE);
    expect(state.error).not.toContain('+61');
    expect(append).not.toHaveBeenCalled();
  });

  it('records ids, statuses, booleans and timestamps — and no number of any kind', async () => {
    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, divertForm());

    expect(state.error).toBeNull();
    expect(state.success).toBe(proofRecordedMessage('divert_verification_call'));
    expect(state.success).toBe('Recorded. The divert for this client is verified.');

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'divert_verification_call',
        artefactId: MISSED_CALL_ID,
        recordedBy: OPERATOR_ID,
      }),
    );

    const detail = append.mock.calls[0][0].artefactDetail as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(
      [
        'after_hours',
        'call_status',
        'caller_kind',
        'caller_present',
        'caller_withheld',
        'completed_via',
        'divert_number_id',
        'duration_seconds',
        'forwarded_from_present',
        'provider_call_id',
        'started_at',
      ].sort(),
    );
    expect(detail.started_at).toBe(RECENT_START.toISOString());
    expect(detail.forwarded_from_present).toBe(true);
    // WR-02: the relocated spike proof, as booleans and an id — never a number.
    expect(detail.caller_present).toBe(true);
    expect(detail.caller_withheld).toBe(false);
    expect(detail.divert_number_id).toBe(DIVERT_NUMBER_ID);
    for (const value of Object.values(detail)) {
      expect(String(value)).not.toContain('+61');
    }

    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });
});

/* -------------------------------------------------------------------------- *
 * The text-back proof (12-08, D-13, T-12-31)
 * -------------------------------------------------------------------------- */

describe('text_back_proof records only a DELIVERED lead text-back of this client (D-13)', () => {
  it('records ids, statuses, booleans and timestamps — exactly the documented keys, no number', async () => {
    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBeNull();
    expect(state.success).toBe(proofRecordedMessage('text_back_proof'));
    expect(state.success).toBe('Recorded. Text-back is live for this client.');
    expect(getTextBackEvidenceForTenant).toHaveBeenCalledWith(TENANT_ID, MISSED_CALL_ID);

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text_back_proof',
        artefactId: MISSED_CALL_ID,
        recordedBy: OPERATOR_ID,
      }),
    );
    expect(forTenant).toHaveBeenCalledWith(TENANT_ID);

    const detail = append.mock.calls[0][0].artefactDetail as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(
      [
        'after_hours',
        'delivered_at',
        'forwarded_from_present',
        'provider_message_id',
        'route',
        'seconds_to_delivered',
        'started_at',
      ].sort(),
    );
    expect(detail).toEqual({
      provider_message_id: 'clicksend-tb-0001',
      delivered_at: new Date(RECENT_START.getTime() + 21_600).toISOString(),
      started_at: RECENT_START.toISOString(),
      // WHOLE seconds, floored: 21.6 s → 21.
      seconds_to_delivered: 21,
      after_hours: true,
      forwarded_from_present: false,
      route: 'lead',
    });

    // NO VALUE LOOKS LIKE A PHONE NUMBER (T-12-07).
    for (const value of Object.values(detail)) {
      expect(String(value)).not.toMatch(/\+?61\d{8,9}|\b0[2-478]\d{8}\b|\d{9,}/);
    }

    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
  });

  it('refuses while text-back is not armed for this client — before the artefact read', async () => {
    readGoLiveChecklist.mockResolvedValue(checklistFixture(['textBackArmed']));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBe(PROOF_CHANNEL_NOT_ARMED_MESSAGE.text_back);
    expect(getTextBackEvidenceForTenant).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('reads the TEXT-BACK switch, not the sms row — the armed gate for this kind is textBackArmed', async () => {
    // SMS unmet, text-back met: the proof is about the text-back switch. (A
    // text-back with SMS off records sms_not_armed and never reaches `sent`,
    // which the evidence checks below refuse on their own.)
    readGoLiveChecklist.mockResolvedValue(checklistFixture(['smsArmed']));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBeNull();
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-uuid paste before any read', async () => {
    const state = await recordProofAction(
      TENANT_ID,
      BLANK_PROOF_STATE,
      textBackForm({ artefact_id: 'clicksend-tb-0001' }),
    );

    expect(state.error).toBe(PROOF_ARTEFACT_NOT_TEXT_BACK_ID_MESSAGE);
    expect(state.error).toContain('npm run text-back:timing');
    expect(getTextBackEvidenceForTenant).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("refuses an unknown or another client's call with one sentence", async () => {
    getTextBackEvidenceForTenant.mockResolvedValue(null);

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBe(PROOF_MISSED_CALL_NOT_FOUND_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    ['skipped', 'skipped'],
    ['failed', 'failed'],
    ['claimed (still in flight)', 'claimed'],
    ['undecided', null],
  ])('refuses a text-back that is %s', async (_label, status) => {
    getTextBackEvidenceForTenant.mockResolvedValue(textBackEvidence({ textBackStatus: status }));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBe(proofTextBackNotSentMessage(status));
    expect(append).not.toHaveBeenCalled();
  });

  it('bounds a stored status before it enters the sentence', () => {
    expect(proofTextBackNotSentMessage('<script>')).toContain('not decided');
    expect(proofTextBackNotSentMessage(null)).toContain('not decided');
  });

  it('refuses the about-quote route — the proof is of the missed-call text-back', async () => {
    getTextBackEvidenceForTenant.mockResolvedValue(textBackEvidence({ textBackRoute: 'quote' }));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBe(PROOF_TEXT_BACK_NOT_LEAD_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    ['a ledger outcome that is not sent', { outcome: 'sms_not_configured' }],
    ['an unknown ledger outcome', { outcome: null }],
    ['no provider message id', { providerMessageId: null }],
  ])('refuses %s', async (_label, patch) => {
    getTextBackEvidenceForTenant.mockResolvedValue(textBackEvidence(patch));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBe(PROOF_TEXT_BACK_LEDGER_NOT_SENT_MESSAGE);
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    ['no receipt yet', { deliveryStatus: null, deliveredAt: null }],
    ['a failed receipt', { deliveryStatus: 'failed', deliveredAt: null }],
    ['an undelivered receipt', { deliveryStatus: 'undelivered', deliveredAt: null }],
    ['delivered with no time', { deliveryStatus: 'delivered', deliveredAt: null }],
  ])('refuses %s — wait for the delivery receipt', async (_label, patch) => {
    getTextBackEvidenceForTenant.mockResolvedValue(textBackEvidence(patch));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBe(PROOF_TEXT_BACK_NOT_DELIVERED_MESSAGE);
    expect(state.error).toContain('Wait for the delivery receipt and try again');
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses a call older than the proof age limit, and one stamped in the future', async () => {
    getTextBackEvidenceForTenant.mockResolvedValue(
      textBackEvidence({ startedAt: new Date(Date.now() - 25 * 3_600_000) }),
    );
    expect((await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm())).error).toBe(
      PROOF_TEXT_BACK_STALE_MESSAGE,
    );

    getTextBackEvidenceForTenant.mockResolvedValue(
      textBackEvidence({ startedAt: new Date(Date.now() + 3_600_000) }),
    );
    expect((await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm())).error).toBe(
      PROOF_TEXT_BACK_STALE_MESSAGE,
    );
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses with the fixed sentence when the evidence read throws', async () => {
    getTextBackEvidenceForTenant.mockRejectedValue(new Error('select ... +61412345678 ...'));

    const state = await recordProofAction(TENANT_ID, BLANK_PROOF_STATE, textBackForm());

    expect(state.error).toBe(PROOF_WRITE_FAILED_MESSAGE);
    expect(state.error).not.toContain('+61');
    expect(append).not.toHaveBeenCalled();
  });

  it('no refusal sentence carries a number', () => {
    for (const sentence of [
      PROOF_ARTEFACT_NOT_TEXT_BACK_ID_MESSAGE,
      PROOF_TEXT_BACK_NOT_LEAD_MESSAGE,
      PROOF_TEXT_BACK_LEDGER_NOT_SENT_MESSAGE,
      PROOF_TEXT_BACK_NOT_DELIVERED_MESSAGE,
      PROOF_TEXT_BACK_STALE_MESSAGE,
      PROOF_CHANNEL_NOT_ARMED_MESSAGE.text_back,
      proofTextBackNotSentMessage('skipped'),
    ]) {
      expect(sentence).not.toMatch(/\+61|\d{8,}/);
    }
  });
});
