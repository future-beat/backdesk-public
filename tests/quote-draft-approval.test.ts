/**
 * THE D-12 GATE, at the action boundary.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THESE TWO ACTIONS ARE THE ONLY WAY AI TEXT REACHES A CUSTOMER. Dispatch  │
 * │ refuses any touch with no approved draft, the tick cannot write          │
 * │ `approved`, and `touches.approveWhere` is called from nowhere else. So   │
 * │ every assertion below is about the last door.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Three properties this suite exists to hold, each of which fails silently in
 * production if it breaks:
 *
 *  1. **A `validator_failed` draft cannot be approved unchanged (D-11).** The
 *     UI omits the button; the UI is not the enforcement, because a Server
 *     Action id is POSTable without rendering anything.
 *  2. **A human edit is re-validated with the REBUILT whitelist (T-5-26).** The
 *     temptation is "a person read it, so send it" — and the validator's own
 *     header says why that is wrong: the human gate catches what a person
 *     notices, this catches what a person skims past. `$2,450` retyped as
 *     `$2,540` is the second kind.
 *  3. **Edit distance is written on EVERY approval, including the zero (AI-04).**
 *     "Reviewed and untouched" is the data point V2-01 is gated on; a NULL there
 *     is indistinguishable from "never approved".
 *
 * PURE, DELIBERATELY. The repository barrel and `next/cache` are mocked;
 * Supabase is mocked one level BELOW `authorize`, so the real gate runs against
 * a fake session — the same shape `drafting-settings-action.test.ts` and
 * `inbox-authorization.test.ts` use. The validator, the edit-distance metric and
 * the merge-fact builder are all REAL: mocking them would leave the thing under
 * test out of the test, since the whole claim is that the edit meets the same
 * mechanical rules the draft did.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------------- *
 * The fixture — one tenant, one quote, one draft
 * ------------------------------------------------------------------------- */

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const CADENCE_ID = '33333333-3333-4333-8333-333333333333';
const TOUCH_ID = '44444444-4444-4444-8444-444444444444';
const DRAFT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_DRAFT_ID = '66666666-6666-4666-8666-666666666666';

const BUSINESS_NAME = 'Mick Plumbing';
const SUFFIX = `${BUSINESS_NAME}. Reply STOP to opt out.`;

const GENERATED_BODY =
  'Hi Sarah, just checking in on that quote from 12 August, $2,450. Any questions?';
/** `generated_body` + the mechanical compliance suffix — the STORED column. */
const FINAL_BODY = `${GENERATED_BODY} ${SUFFIX}`;

/**
 * The quote date is chosen so that BOTH facts land where the whitelist needs
 * them: 02:00Z on 12 August is 10:00 in `Australia/Perth`, so the tenant-zone
 * rendering is `12 August` and not `11 August`. A fixture that straddled the
 * date line would pass or fail depending on the server's zone, which is the
 * exact bug `renderQuoteDate` takes a timezone to prevent.
 */
const QUOTE_DATE = new Date('2026-08-12T02:00:00Z');

/**
 * Fourteen days and an hour ago, so `Math.floor` gives 14 for any moment this
 * suite could plausibly run at. A whole number of days would sit exactly on the
 * boundary and flip to 13 on a slow machine.
 */
function anchorFourteenDaysAgo(): Date {
  return new Date(Date.now() - 14 * 86_400_000 - 3_600_000);
}

type DraftRow = {
  id: string;
  cadenceId: string;
  quoteId: string | null;
  finalBody: string;
  status: string;
  createdAt: Date;
  mergeNow: Date | null;
  complianceSuffix: string | null;
};

/* ------------------------------------------------------------------------- *
 * Mocks
 * ------------------------------------------------------------------------- */

const latestForTouch = vi.fn<(touchId: string) => Promise<DraftRow[]>>();
const approve =
  vi.fn<
    (
      draftId: string,
      patch: { finalBody: string; editDistance: string; approvedAt: Date },
    ) => Promise<unknown[]>
  >();
const approveWhere = vi.fn<(touchIds: readonly string[]) => Promise<unknown[]>>();
const cadenceGetById = vi.fn<(id: string) => Promise<unknown[]>>();
const quoteById = vi.fn<(id: string) => Promise<unknown[]>>();
const revalidatePath = vi.fn();

/**
 * Which tenant id the closure was built with — the second layer of the
 * cross-tenant defence, and worth recording rather than assuming. A forged form
 * naming another client's draft still reads through `forTenant(<the tenant this
 * call authorized>)`, so it matches nothing.
 */
const forTenantCalls: string[] = [];

/**
 * HOW DEEP INSIDE `repo.transaction` THE CURRENT STATEMENT IS (CR-01).
 *
 * The atomicity claim is not observable from any RESULT: a `writeApproval` that
 * ran the two statements bare returns the identical `approved` outcome as one
 * that wrapped them. The only thing that can fail on it is whether each write
 * saw a non-zero depth, so the fake repository records that per statement.
 */
let txDepth = 0;

/** Every write, with the transaction depth it ran at, in order. */
const writeDepths: { statement: string; depth: number }[] = [];

/**
 * The slice of `TenantScopedRepository` the approval core actually reaches.
 *
 * Spelled out rather than inferred because `transaction` takes a callback over
 * this same shape, and an inferred `repo` referenced inside its own initializer
 * is a TS7022 circularity.
 */
type FakeRepo = {
  drafts: {
    latestForTouch: (touchId: string) => Promise<DraftRow[]>;
    approve: (draftId: string, patch: never) => Promise<unknown[]>;
  };
  touches: { approveWhere: (ids: readonly string[]) => Promise<unknown[]> };
  cadences: { getById: (id: string) => Promise<unknown[]> };
  quotes: { byId: (id: string) => Promise<unknown[]> };
  transaction: <T>(fn: (tx: FakeRepo) => Promise<T>) => Promise<T>;
};

vi.mock('@/db/repository', () => ({
  forTenant: (tenantId: string) => {
    forTenantCalls.push(tenantId);
    const repo: FakeRepo = {
      drafts: {
        latestForTouch: (touchId: string) => latestForTouch(touchId),
        approve: (draftId: string, patch: never) => {
          writeDepths.push({ statement: 'drafts.approve', depth: txDepth });
          return approve(draftId, patch);
        },
      },
      touches: {
        approveWhere: (ids: readonly string[]) => {
          writeDepths.push({ statement: 'touches.approveWhere', depth: txDepth });
          return approveWhere(ids);
        },
      },
      cadences: { getById: (id: string) => cadenceGetById(id) },
      quotes: { byId: (id: string) => quoteById(id) },
      /**
       * The real one hands the callback a repository bound to the SAME tenant
       * and to the transaction, so the fake hands back the same object — a
       * `tx` that reached a different tenant's rows would be the bug the real
       * signature exists to prevent.
       */
      transaction: async <T,>(fn: (tx: FakeRepo) => Promise<T>): Promise<T> => {
        txDepth += 1;
        try {
          return await fn(repo);
        } finally {
          txDepth -= 1;
        }
      },
    };
    return repo;
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

/**
 * Every observable step, in the order it happened.
 *
 * ── WHY AN ORDER LOG AND NOT JUST A CALL COUNT ──────────────────────────────
 *
 * WR-01 is an ORDERING property: authorize before a byte of `formData` is read.
 * An action that parsed the body first and checked the caller afterwards returns
 * the identical denial state, so no assertion on the RESULT can fail on it. The
 * only thing that can is the sequence.
 */
const trace: string[] = [];

let session: { userId: string | null; memberOf: string[] } = {
  userId: 'operator-1',
  memberOf: [TENANT_ID],
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => {
        trace.push('getClaims');
        return { data: session.userId ? { claims: { sub: session.userId } } : null };
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => {
            trace.push('tenantRead');
            return table === 'tenants' && session.memberOf.includes(value)
              ? {
                  data: { id: value, name: BUSINESS_NAME, timezone: 'Australia/Perth' },
                  error: null,
                }
              : { data: null, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { approveDraft, editAndApproveDraft } = await import(
  '@/app/(console)/clients/[id]/quotes/[quoteId]/actions'
);
const {
  BAD_REQUEST_MESSAGE,
  BLANK_CONTROL_STATE,
  DRAFT_ALREADY_APPROVED_MESSAGE,
  DRAFT_APPROVED_MESSAGE,
  DRAFT_BODY_REQUIRED_MESSAGE,
  DRAFT_EDITED_APPROVED_MESSAGE,
  DRAFT_NOT_FOUND_MESSAGE,
  DRAFT_SUPERSEDED_MESSAGE,
  DRAFT_VALIDATOR_FAILED_MESSAGE,
  EDITED_BODY_MAX,
  SESSION_EXPIRED_MESSAGE,
  UNKNOWN_QUOTE_MESSAGE,
  describeDraftViolation,
} = await import('@/app/(console)/clients/[id]/quotes/[quoteId]/action-state');

/* ------------------------------------------------------------------------- *
 * Harness
 * ------------------------------------------------------------------------- */

/** A form whose every `get` is recorded, so WR-01's ordering is observable. */
function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(key, value);
  }
  const original = data.get.bind(data);
  data.get = (key: string) => {
    trace.push('formData.get');
    return original(key);
  };
  return data;
}

function ids(overrides: Partial<{ draft_id: string; touch_id: string }> = {}) {
  return { draft_id: DRAFT_ID, touch_id: TOUCH_ID, ...overrides };
}

function draft(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: DRAFT_ID,
    cadenceId: CADENCE_ID,
    quoteId: QUOTE_ID,
    finalBody: FINAL_BODY,
    status: 'generated',
    createdAt: new Date(),
    // Recorded on the row by the drafting pass. Defaulted to `null` here so the
    // existing fixtures exercise the pre-migration FALLBACK path (created_at +
    // a re-derived suffix); the two tests below pin the recorded path.
    mergeNow: null,
    complianceSuffix: null,
    ...overrides,
  };
}

const doApprove = (fields = ids()) =>
  approveDraft(TENANT_ID, QUOTE_ID, BLANK_CONTROL_STATE, form(fields));

const doEdit = (body: string, fields = ids()) =>
  editAndApproveDraft(TENANT_ID, QUOTE_ID, BLANK_CONTROL_STATE, form({ ...fields, edited_body: body }));

/** The patch `drafts.approve` was called with, as a typed object. */
function approvedPatch(): { finalBody: string; editDistance: string; approvedAt: Date } {
  expect(approve).toHaveBeenCalledTimes(1);
  return approve.mock.calls[0]![1];
}

function expectNothingWritten(): void {
  expect(approve).not.toHaveBeenCalled();
  expect(approveWhere).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  trace.length = 0;
  forTenantCalls.length = 0;
  writeDepths.length = 0;
  txDepth = 0;
  session = { userId: 'operator-1', memberOf: [TENANT_ID] };

  latestForTouch.mockResolvedValue([draft()]);
  approve.mockResolvedValue([{ id: DRAFT_ID }]);
  approveWhere.mockResolvedValue([{ id: TOUCH_ID }]);
  cadenceGetById.mockResolvedValue([
    { quoteId: QUOTE_ID, contactName: 'Sarah Chen', anchorAt: anchorFourteenDaysAgo() },
  ]);
  quoteById.mockResolvedValue([
    {
      jobDescription: 'Meter box and mains upgrade',
      totalInvoiceAmount: '2450.00',
      quoteDateUtc: QUOTE_DATE,
    },
  ]);
});

/* ========================================================================= *
 * 1. The gate runs before the body is read (WR-01, T-5-25)
 * ========================================================================= */

describe('both actions authorize BEFORE they read formData (WR-01, T-5-25)', () => {
  it.each([
    ['approveDraft', () => doApprove()],
    ['editAndApproveDraft', () => doEdit(FINAL_BODY)],
  ])('%s: the tenant read happens before the first formData.get', async (_name, run) => {
    await run();

    const firstRead = trace.indexOf('formData.get');
    const gate = trace.indexOf('tenantRead');

    expect(gate).toBeGreaterThanOrEqual(0);
    expect(firstRead).toBeGreaterThanOrEqual(0);
    // THE ASSERTION. An action that parsed first and checked afterwards returns
    // the same denial state, so only the sequence can fail on it.
    expect(gate).toBeLessThan(firstRead);
    expect(trace.indexOf('getClaims')).toBeLessThan(gate);
  });

  it.each([
    ['approveDraft', () => doApprove()],
    ['editAndApproveDraft', () => doEdit(FINAL_BODY)],
  ])('%s: an unauthenticated caller writes NOTHING', async (_name, run) => {
    session = { userId: null, memberOf: [] };

    const state = await run();

    expect(state.error).toBe(SESSION_EXPIRED_MESSAGE);
    expect(latestForTouch).not.toHaveBeenCalled();
    expectNothingWritten();
    expect(trace).not.toContain('formData.get');
  });

  it.each([
    ['approveDraft', () => doApprove()],
    ['editAndApproveDraft', () => doEdit(FINAL_BODY)],
  ])('%s: a signed-in caller who is not on this client writes NOTHING', async (_name, run) => {
    // The threat is not a stranger off the internet — it is an authenticated
    // session POSTing a guessed tenant uuid at a globally-reachable action id.
    // The RLS-scoped read returns zero rows and that is the whole defence.
    session = { userId: 'operator-2', memberOf: ['99999999-9999-4999-8999-999999999999'] };

    const state = await run();

    expect(state.error).toBe(UNKNOWN_QUOTE_MESSAGE);
    expect(latestForTouch).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it('reads through forTenant scoped to the AUTHORIZED tenant, never the form', async () => {
    await doEdit(FINAL_BODY);

    expect(forTenantCalls.length).toBeGreaterThan(0);
    expect(new Set(forTenantCalls)).toEqual(new Set([TENANT_ID]));
  });
});

/* ========================================================================= *
 * 2. D-11 — a validator_failed draft is unapprovable UNCHANGED
 * ========================================================================= */

describe('a validator_failed draft can never be approved unchanged (D-11)', () => {
  it('refuses approveDraft with its OWN distinct message', async () => {
    latestForTouch.mockResolvedValue([draft({ status: 'validator_failed' })]);

    const state = await doApprove();

    expect(state.error).toBe(DRAFT_VALIDATOR_FAILED_MESSAGE);
    expectNothingWritten();
  });

  it('keeps that refusal DISTINCT from every other refusal on this surface', async () => {
    // The operator must be able to tell "the machine found something wrong with
    // this text" from "that draft is gone" and from "somebody beat you to it".
    // Only the first one is fixed by editing.
    latestForTouch.mockResolvedValue([draft({ status: 'validator_failed' })]);
    const failed = await doApprove();

    latestForTouch.mockResolvedValue([]);
    const missing = await doApprove();

    latestForTouch.mockResolvedValue([draft({ status: 'approved' })]);
    const already = await doApprove();

    expect(failed.error).not.toBe(missing.error);
    expect(failed.error).not.toBe(already.success);
    expect(missing.error).toBe(DRAFT_NOT_FOUND_MESSAGE);
    expect(already.success).toBe(DRAFT_ALREADY_APPROVED_MESSAGE);
  });

  it('ALLOWS edit-then-approve on that same draft — the one path D-11 leaves open', async () => {
    // A `validator_failed` attempt from `parkUnusable` has an EMPTY final body:
    // the model refused or was truncated, so there is nothing to accept and
    // everything to write. The distance is therefore 1 — a total rewrite, which
    // is exactly what happened.
    latestForTouch.mockResolvedValue([draft({ status: 'validator_failed', finalBody: '' })]);

    const state = await doEdit(FINAL_BODY);

    expect(state.success).toBe(DRAFT_EDITED_APPROVED_MESSAGE);
    expect(approvedPatch().finalBody).toBe(FINAL_BODY);
    expect(Number(approvedPatch().editDistance)).toBe(1);
  });
});

/* ========================================================================= *
 * 3. T-5-26 — the edit crosses the trust boundary again
 * ========================================================================= */

describe('an operator edit is re-validated with the REBUILT whitelist (T-5-26)', () => {
  it('refuses an unwhitelisted price and writes NOTHING', async () => {
    // The transposition the human gate does not reliably catch, and the one a
    // string comparison catches every time. `$2,540` was never supplied.
    const state = await doEdit(FINAL_BODY.replace('$2,450', '$2,540'));

    expect(state.success).toBeNull();
    expect(state.error).toContain('$2,540');
    // The nearest supplied value is NAMED, so the operator can see the digit
    // they transposed rather than being told "invalid number".
    expect(state.error).toContain('$2,450');
    expectNothingWritten();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses an unwhitelisted DATE the quote never carried', async () => {
    const state = await doEdit(FINAL_BODY.replace('12 August', 'Tuesday'));

    expect(state.error).toContain('Tuesday');
    expectNothingWritten();
  });

  it('refuses an edit that DELETES the compliance line (Spam Act, D-01/D-03)', async () => {
    // The only screen in the system from which the sender identification and
    // opt-out line could be removed — by accident while trimming for length, or
    // deliberately. `missing_suffix` is what makes that impossible rather than
    // unlikely.
    const state = await doEdit(GENERATED_BODY);

    expect(state.error).toContain('opt-out line');
    expectNothingWritten();
  });

  it('refuses a body over the two-segment cap (D-03)', async () => {
    const long = `${'Just following up on your quote when you have a moment. '.repeat(8)}${SUFFIX}`;

    const state = await doEdit(long);

    expect(state.error).toContain('segments');
    expectNothingWritten();
  });

  it('refuses a character that cannot be sent as GSM-7', async () => {
    // An emoji flips the WHOLE message to UCS-2 — 67 characters a segment
    // instead of 153 — so this is a cost refusal as much as a correctness one.
    const state = await doEdit(FINAL_BODY.replace('Any questions?', 'Any questions? 👍'));

    expect(state.error).toContain('👍');
    expectNothingWritten();
  });

  it('ACCEPTS an edit that only changes wording — the whitelist is not a straitjacket', async () => {
    const reworded = FINAL_BODY.replace(
      'Any questions?',
      'Happy to talk it through whenever suits.',
    );

    const state = await doEdit(reworded);

    expect(state.success).toBe(DRAFT_EDITED_APPROVED_MESSAGE);
    expect(approvedPatch().finalBody).toBe(reworded);
  });

  it('builds the whitelist from the MIRROR, not from anything the form supplied', async () => {
    // The quote row is what says `$2,450` and `12 August` are legitimate. The
    // SAME body is accepted with the quote present and refused without it —
    // which is the property that makes a forged form useless: nothing the caller
    // sends can widen the set.
    const accepted = await doEdit(FINAL_BODY);
    expect(accepted.success).toBe(DRAFT_EDITED_APPROVED_MESSAGE);

    vi.clearAllMocks();
    latestForTouch.mockResolvedValue([draft()]);
    cadenceGetById.mockResolvedValue([
      { quoteId: QUOTE_ID, contactName: 'Sarah Chen', anchorAt: anchorFourteenDaysAgo() },
    ]);
    quoteById.mockResolvedValue([]);

    const refused = await doEdit(FINAL_BODY);

    expect(refused.success).toBeNull();
    // `12` is the first digit run in the body and it is no longer supplied by
    // anything — the quote date it came from is gone.
    expect(refused.error).toContain('12');
    expectNothingWritten();
  });

  it('rebuilds the whitelist at the DRAFT’s moment, so an overnight approval still passes', async () => {
    // ── THE ORDINARY CASE, not an edge one. ──────────────────────────────
    //
    // D-14 gives drafts hours of lead time, so a draft written at 6pm and
    // approved at 9am is normal. One of the merge facts is "days since the
    // quote", and it is derived from a clock: rebuilt at `new Date()` it would
    // read 15 where the model was handed 14, and the validator would refuse a
    // figure it supplied — with the operator unable to see why, and no edit
    // that fixes it.
    //
    // The body here quotes the day count, so the fixture actually exercises the
    // rule rather than passing because nothing referenced it.
    const withDays = `Hi Sarah, it has been 14 days since that quote, $2,450. Any questions? ${SUFFIX}`;
    const draftedYesterday = new Date(Date.now() - 26 * 3_600_000);

    latestForTouch.mockResolvedValue([
      draft({ finalBody: withDays, createdAt: draftedYesterday }),
    ]);
    // Anchored 14 days before the DRAFT was written — so "14" is right at draft
    // time and "15" is right now. The two answers must differ, or this test
    // passes without touching the rule.
    cadenceGetById.mockResolvedValue([
      {
        quoteId: QUOTE_ID,
        contactName: 'Sarah Chen',
        anchorAt: new Date(draftedYesterday.getTime() - 14 * 86_400_000 - 3_600_000),
      },
    ]);

    const state = await doEdit(withDays.replace('Any questions?', 'Any question?'));

    expect(state.error).toBeNull();
    expect(state.success).toBe(DRAFT_EDITED_APPROVED_MESSAGE);
  });

  it('prefers the RECORDED merge instant over created_at, which is a different clock', async () => {
    // ── THE SEAM `created_at` LEAVES OPEN ─────────────────────────────────
    //
    // The whitelist was built from the tick's JS `now`, captured at the top of
    // the tick. `created_at` is Postgres `now()` written when the row lands —
    // after the consume pass, the progress passes and up to two model calls. The
    // day count is FLOORED, so once per day per cadence the two instants fall on
    // opposite sides of a boundary and a whitelist rebuilt from `created_at`
    // refuses a number the model was legitimately handed.
    //
    // This fixture makes the two disagree on purpose: `merge_now` is a day
    // earlier than `created_at`, so "14" is right for one and wrong for the
    // other. If the action read `created_at` the body would be refused.
    const withDays = `Hi Sarah, it has been 14 days since that quote, $2,450. Any questions? ${SUFFIX}`;
    const mergeNow = new Date(Date.now() - 26 * 3_600_000);
    const createdAt = new Date(mergeNow.getTime() + 25 * 3_600_000);

    latestForTouch.mockResolvedValue([draft({ finalBody: withDays, createdAt, mergeNow })]);
    cadenceGetById.mockResolvedValue([
      {
        quoteId: QUOTE_ID,
        contactName: 'Sarah Chen',
        anchorAt: new Date(mergeNow.getTime() - 14 * 86_400_000 - 3_600_000),
      },
    ]);

    const state = await doEdit(withDays.replace('Any questions?', 'Any question?'));

    expect(state.error).toBeNull();
    expect(state.success).toBe(DRAFT_EDITED_APPROVED_MESSAGE);
  });

  it('checks the suffix the DRAFT was written with, so a rename does not refuse it', async () => {
    // ── A RENAME MUST NOT BREAK A DRAFT ALREADY ON SCREEN ─────────────────
    //
    // `tenants.name` is patchable. The textarea is pre-filled with this draft's
    // `final_body`, which carries the suffix frozen at draft time — so
    // re-deriving `expectedSuffix` from the CURRENT name fails `missing_suffix`
    // on text the operator did not touch. `approveDraft` meanwhile re-writes
    // those same stored bytes unchanged, so the two approve paths would disagree
    // about what the compliance line is.
    const oldSuffix = 'Sparks Electrical Co. Reply STOP to opt out.';
    const bodyWithOldSuffix = `Hi Sarah, following up on that $2,450 quote. ${oldSuffix}`;

    latestForTouch.mockResolvedValue([
      draft({ finalBody: bodyWithOldSuffix, complianceSuffix: oldSuffix }),
    ]);

    const state = await doEdit(bodyWithOldSuffix.replace('following up on', 'checking in on'));

    expect(state.error).toBeNull();
    expect(state.success).toBe(DRAFT_EDITED_APPROVED_MESSAGE);
  });

  it('still requires the recorded suffix — it is checked, not merely accepted', async () => {
    // Freezing the suffix must not mean skipping the rule. The Spam Act line is
    // a legal requirement on every message and this screen is the only place it
    // could be removed from.
    const oldSuffix = 'Sparks Electrical Co. Reply STOP to opt out.';
    const bodyWithOldSuffix = `Hi Sarah, following up on that $2,450 quote. ${oldSuffix}`;

    latestForTouch.mockResolvedValue([
      draft({ finalBody: bodyWithOldSuffix, complianceSuffix: oldSuffix }),
    ]);

    const state = await doEdit('Hi Sarah, following up on that $2,450 quote.');

    expect(state.error).toContain(oldSuffix);
    expectNothingWritten();
  });

  it('refuses when the cadence has vanished rather than approving with an empty whitelist', async () => {
    cadenceGetById.mockResolvedValue([]);

    const state = await doEdit(FINAL_BODY);

    expect(state.error).toBe(DRAFT_NOT_FOUND_MESSAGE);
    expectNothingWritten();
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n  '],
  ])('refuses a %s body before it reaches the validator', async (_label, body) => {
    const state = await doEdit(body);

    expect(state.error).toBe(DRAFT_BODY_REQUIRED_MESSAGE);
    expectNothingWritten();
  });

  it('refuses a body past the outer size bound without validating it', async () => {
    const state = await doEdit('x'.repeat(EDITED_BODY_MAX + 1));

    expect(state.error).toContain(String(EDITED_BODY_MAX));
    expectNothingWritten();
  });
});

/* ========================================================================= *
 * 4. AI-04 — the measurement, on every crossing
 * ========================================================================= */

describe('edit distance is recorded at the moment of approval (AI-04)', () => {
  it('writes EXACTLY 0 for an approve-unchanged, never NULL', async () => {
    const state = await doApprove();

    expect(state.success).toBe(DRAFT_APPROVED_MESSAGE);
    const patch = approvedPatch();
    // The string, not the number: `numeric` is carried as a string end to end so
    // the rounding contract survives the driver. `'0'` and `0` are different
    // things to assert, and only one of them is what lands in the column.
    expect(patch.editDistance).toBe('0');
    expect(patch.finalBody).toBe(FINAL_BODY);
  });

  it('writes the pinned normalized value for a ONE-CHARACTER edit', async () => {
    // "Any questions?" → "Any question?" is one deletion. The fixture length is
    // asserted first so a later edit to the fixture fails HERE, loudly, rather
    // than quietly redefining the number this test claims to pin.
    expect([...FINAL_BODY].length).toBe(117);

    const state = await doEdit(FINAL_BODY.replace('Any questions?', 'Any question?'));

    expect(state.success).toBe(DRAFT_EDITED_APPROVED_MESSAGE);
    // 1 edit over the longer of the two bodies (117 code points) = 0.008547…
    expect(Number(approvedPatch().editDistance)).toBeCloseTo(1 / 117, 12);
  });

  it('keeps at least four decimal places — a two-place column would erase this', async () => {
    // The rounding contract `edit-distance.ts` states, asserted where it is
    // actually stored. 0.0085 rounded to two places is 0.01; rounded to zero
    // places it is 0, which is indistinguishable from an untouched draft — the
    // precise signal AI-04 exists to measure.
    await doEdit(FINAL_BODY.replace('Any questions?', 'Any question?'));

    const stored = approvedPatch().editDistance;
    expect(Number(stored)).toBeGreaterThan(0);
    expect(stored).toMatch(/^0\.00\d/);
  });

  it('measures against the CANONICAL bytes, not the raw submission', async () => {
    // A smart apostrophe the operator's phone inserted is repaired by the
    // normalizer, and the repaired text is what gets stored and sent. Counting
    // the normalizer's own repairs as operator edits would inflate every
    // distance in the column by work no human did.
    const withSmartQuote = FINAL_BODY.replace('Any questions?', 'Any question’s?');

    await doEdit(withSmartQuote);

    const patch = approvedPatch();
    expect(patch.finalBody).toContain("question's?");
    expect(patch.finalBody).not.toContain('’');
  });

  it('stamps approvedAt on the write', async () => {
    const before = Date.now();
    await doApprove();
    expect(approvedPatch().approvedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

/* ========================================================================= *
 * 5. The write pairing, and the ways it can race
 * ========================================================================= */

describe('the approve write moves the draft and then the touch, in that order', () => {
  it('approves the draft FIRST and the touch only after', async () => {
    const order: string[] = [];
    approve.mockImplementation(async () => {
      order.push('draft');
      return [{ id: DRAFT_ID }];
    });
    approveWhere.mockImplementation(async () => {
      order.push('touch');
      return [{ id: TOUCH_ID }];
    });

    await doApprove();

    // The other order produces an `approved` touch whose approved draft does not
    // exist — which dispatch reads as `no_approved_draft` and refuses forever,
    // silently, on a touch that looks cleared on screen.
    expect(order).toEqual(['draft', 'touch']);
    expect(approveWhere).toHaveBeenCalledWith([TOUCH_ID]);
  });

  /* ----------------------------------------------------------------------- *
   * CR-01 — the pair is ATOMIC, and every `already_approved` REPAIRS
   * ----------------------------------------------------------------------- */

  it('runs BOTH statements inside one transaction (CR-01)', async () => {
    await doApprove();

    // Order alone only rules out ONE of the two half-applied states. The
    // symmetric one — an approved draft whose touch never moved — wedges the
    // touch just as permanently, because dispatch claims only `approved`
    // touches. Anything between two bare statements produces it: a function
    // timeout, a pooled-connection drop, a redeploy mid-request.
    expect(writeDepths).toEqual([
      { statement: 'drafts.approve', depth: 1 },
      { statement: 'touches.approveWhere', depth: 1 },
    ]);
  });

  it('REPAIRS the touch when the draft write flipped nothing (CR-01)', async () => {
    // Somebody approved it between the read and this write — or an approval
    // from before the transaction existed flipped the draft and died before the
    // touch moved. Reporting `already_approved` and stopping was what made that
    // second state permanent: this branch returns before any other repair path
    // is reachable, and the console then says "it goes out at its scheduled
    // time" about a message that never sends.
    approve.mockResolvedValue([]);

    const state = await doApprove();

    expect(state.success).toBe(DRAFT_ALREADY_APPROVED_MESSAGE);
    // The repair is the SAME equality-guarded statement (D-12) — a no-op on an
    // already-approved touch, and the fix on a wedged one.
    expect(approveWhere).toHaveBeenCalledWith([TOUCH_ID]);
    // Outside the rolled-back transaction, deliberately: it is a single
    // statement and it must survive the abort that brought us here.
    expect(writeDepths.at(-1)).toEqual({ statement: 'touches.approveWhere', depth: 0 });
  });

  it('REPAIRS the touch when the draft is ALREADY approved on re-read (CR-01)', async () => {
    // The earliest reachable route to `already_approved`: `loadApprovableDraft`
    // returns before `writeApproval` is ever entered, so a second tap on a
    // wedged touch used to be answered with a false success and nothing else.
    latestForTouch.mockResolvedValue([draft({ status: 'approved' })]);

    const state = await doApprove();

    expect(state.success).toBe(DRAFT_ALREADY_APPROVED_MESSAGE);
    expect(approve).not.toHaveBeenCalled();
    expect(approveWhere).toHaveBeenCalledWith([TOUCH_ID]);
  });

  it('reports a FAILED repair as a retryable error, not a second false success', async () => {
    latestForTouch.mockResolvedValue([draft({ status: 'approved' })]);
    approveWhere.mockRejectedValue(new Error(`update failed near "${FINAL_BODY}"`));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const state = await doApprove();

    expect(state.error).toBe(BAD_REQUEST_MESSAGE);
    expect(state.success).toBeNull();
    // Same no-body rule as the write above (T-5-03/WR-08).
    for (const call of logged.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Sarah');
      expect(JSON.stringify(call)).not.toContain('$2,450');
    }
    logged.mockRestore();
  });

  it('turns the unique-index conflict into a sentence, never a throw', async () => {
    // Two DIFFERENT attempts of one touch approved concurrently. The row guard
    // cannot see that; `touch_drafts_one_approved_per_touch` can, and answers
    // with 23505 rather than a coin-flip at send time.
    approve.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }));

    const state = await doApprove();

    expect(state.success).toBe(DRAFT_ALREADY_APPROVED_MESSAGE);
    expect(state.error).toBeNull();
    // The transaction rolled back, so nothing of OURS was written — but the
    // touch may still be wedged behind the OTHER attempt's approval, and the
    // guarded repair is what unwedges it (CR-01).
    expect(approveWhere).toHaveBeenCalledWith([TOUCH_ID]);
  });

  it('recognises the conflict through a wrapping query error', async () => {
    approve.mockRejectedValue(
      Object.assign(new Error('Failed query'), {
        cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
      }),
    );

    const state = await doApprove();

    expect(state.success).toBe(DRAFT_ALREADY_APPROVED_MESSAGE);
  });

  it('reports an unrelated database failure WITHOUT leaking it (WR-08, T-5-03)', async () => {
    const leak = new Error(`insert failed near "${FINAL_BODY}"`);
    approve.mockRejectedValue(leak);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const state = await doApprove();

    expect(state.error).toBe(BAD_REQUEST_MESSAGE);
    expect(state.error).not.toContain('Sarah');
    // A database error from this write carries the statement, and the statement
    // carries the draft text.
    for (const call of logged.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Sarah');
      expect(JSON.stringify(call)).not.toContain('$2,450');
    }
    logged.mockRestore();
    expect(approveWhere).not.toHaveBeenCalled();
  });

  it('revalidates EVERY page so none of them keeps serving a stale draft', async () => {
    await doApprove();

    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}/quotes/${QUOTE_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${TENANT_ID}`);
    // ── /inbox IS THE SECOND CALLER'S PAGE (WR-13). ──────────────────────
    //
    // `revalidateBoth` is shared by every control action here, and
    // `inbox/suppress-contact-form.tsx` reuses `killContactAction` through it.
    // Without this path an operator suppressing a soft opt-out from the triage
    // list got the success sentence while the row kept its "Suppress this
    // contact" button and the cadence still read as live — a control that still
    // looks actionable after acting, on a scrolling list of rows about
    // different customers, one tap from an irreversible action on the wrong one.
    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
  });
});

/* ========================================================================= *
 * 6. Which draft an approval may name
 * ========================================================================= */

describe('only the touch’s LATEST attempt is approvable', () => {
  it('refuses a superseded attempt with the stale-page message', async () => {
    // The operator's page was rendered before a regeneration landed. Approving
    // the older attempt would send the text the drafting pass had already
    // replaced, from a screen that showed it as current.
    latestForTouch.mockResolvedValue([
      draft({ id: OTHER_DRAFT_ID }),
      draft({ id: DRAFT_ID, status: 'validator_failed' }),
    ]);

    const state = await doApprove();

    expect(state.error).toBe(DRAFT_SUPERSEDED_MESSAGE);
    expectNothingWritten();
  });

  it('refuses a draft id that names no attempt of this touch', async () => {
    latestForTouch.mockResolvedValue([draft({ id: OTHER_DRAFT_ID })]);

    const state = await doApprove();

    // The SAME sentence as "no attempts at all", deliberately: distinguishing
    // them would turn the refusal into an existence oracle over another client's
    // drafts.
    expect(state.error).toBe(DRAFT_NOT_FOUND_MESSAGE);
    expectNothingWritten();
  });

  it('refuses when the latest attempt is itself superseded', async () => {
    latestForTouch.mockResolvedValue([draft({ status: 'superseded' })]);

    const state = await doApprove();

    expect(state.error).toBe(DRAFT_SUPERSEDED_MESSAGE);
    expectNothingWritten();
  });

  it('reads the attempts for the touch the FORM named, scoped to the tenant', async () => {
    await doApprove();
    expect(latestForTouch).toHaveBeenCalledWith(TOUCH_ID);
  });

  it.each([
    ['a non-uuid draft id', { draft_id: 'not-a-uuid' }],
    ['a non-uuid touch id', { touch_id: "' OR 1=1 --" }],
    ['an absent draft id', { draft_id: '' }],
  ])('refuses %s WITHOUT reaching the repository', async (_label, overrides) => {
    const state = await doApprove(ids(overrides as Partial<{ draft_id: string; touch_id: string }>));

    // A non-uuid reaches Postgres as a 22P02 thrown two layers below a screen the
    // operator is looking at. Rejecting here names the failure where it happened.
    expect(state.error).toBe(BAD_REQUEST_MESSAGE);
    expect(latestForTouch).not.toHaveBeenCalled();
    expectNothingWritten();
  });
});

/* ========================================================================= *
 * 7. Source assertions — the half a behavioural test cannot reach
 * ========================================================================= */

function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const ACTIONS = 'src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts';

describe('the actions module carries the gate structurally', () => {
  it('EVERY exported action opens with the authorize call', () => {
    // The failure mode is an absence: a SIXTH action added later without the
    // gate. Driving the ones that exist proves nothing about that.
    const source = code(ACTIONS);
    const bodies = source.split(/^export async function /m).slice(1);

    expect(bodies.length).toBeGreaterThanOrEqual(6);
    for (const body of bodies) {
      const gate = body.indexOf('await authorize(');
      expect(gate).toBeGreaterThanOrEqual(0);
      const read = body.indexOf('formData.get(');
      if (read >= 0) expect(gate).toBeLessThan(read);
    }
  });

  it('delegates BOTH approvals to the extracted core, not to its own copy', () => {
    // 06-01: the four subtleties moved to `src/core/approval/approve-draft.ts`
    // so a SECOND approval surface (the cross-client queue, CON-01) could not be
    // built as a second correct copy — the CR-02 structure. This asserts the
    // delegation exists; the block below asserts the copy does NOT.
    const source = code(ACTIONS);
    expect(source).toMatch(
      /import\s*\{[^}]*\bapproveUnchanged\b[^}]*\}\s*from\s*'@\/core\/approval\/approve-draft'/,
    );
    expect(source).toMatch(/\bapproveUnchanged\s*\(/);
    expect(source).toMatch(/\beditThenApprove\s*\(/);
  });

  it('passes the AUTHORIZED tenant name and zone into the core, never the form’s', () => {
    // The suffix an edited body must still end with, and the zone the quote date
    // was rendered in, both have to come from the read that PROVED the caller is
    // entitled to this client.
    const source = code(ACTIONS);
    expect(source).toMatch(/tenantName:\s*access\.name/);
    expect(source).toMatch(/timezone:\s*access\.timezone/);
  });

  it('logs no draft body anywhere in the module', () => {
    // T-5-03: bodies live in `touch_drafts` behind RLS, which is deletable per
    // customer; a platform log is not.
    const source = code(ACTIONS);
    const logs = source.match(/console\.\w+\([\s\S]*?\);/g) ?? [];
    for (const line of logs) {
      expect(line).not.toMatch(/finalBody|final_body|editedBody|edited_body|normalizedBody/);
    }
  });

  it('keeps NO copy of the four subtleties — they live only in the core', () => {
    // ── THE HALF THAT MATTERS AFTER AN EXTRACTION ─────────────────────────
    //
    // Delegation plus a leftover copy is worse than either alone: the copy
    // still compiles, still looks correct, and is the one a later fix lands in
    // half the time. Each pattern below is one of the four load-bearing rules —
    // latest-attempt selection, the whitelist rebuild, the frozen suffix and the
    // explicit AI-04 zero — asserted ABSENT here and PRESENT in the core below.
    const source = code(ACTIONS);
    expect(source).not.toMatch(/latestForTouch/);
    expect(source).not.toMatch(/buildMergeFacts/);
    expect(source).not.toMatch(/validateDraft/);
    expect(source).not.toMatch(/complianceSuffix/);
    expect(source).not.toMatch(/normalizedEditDistance/);
    expect(source).not.toMatch(/approveWhere/);
  });
});

/* ========================================================================= *
 * 7b. The extracted core (06-01) — where the four subtleties now live
 *
 * These are the SAME assertions that used to point at the actions file, moved
 * with the code they are about. The property has not changed: the rules are
 * implemented once, from the owned modules, with no second rendering of a price
 * or a date anywhere near them.
 * ========================================================================= */

const CORE = 'src/core/approval/approve-draft.ts';

describe('the approval core is the ONE implementation both surfaces call', () => {
  it('is framework-free — nothing from next/* may reach it', () => {
    // A core that imported `revalidatePath` would be a route module wearing a
    // core module's name, and could not be called from a script, a test or a
    // future non-console surface. Revalidation is each surface's own.
    const source = code(CORE);
    expect(source).not.toMatch(/from\s*'next\//);
    expect(source).not.toMatch(/revalidatePath/);
  });

  it('runs the REAL validator over the edited body — not a second copy of the rules', () => {
    const source = code(CORE);
    expect(source).toMatch(
      /import\s*\{[^}]*\bvalidateDraft\b[^}]*\}\s*from\s*'@\/core\/drafting\/validate'/,
    );
    expect(source).toMatch(/validateDraft\s*\(/);
  });

  it('rebuilds the whitelist through the ONE merge-fact builder', () => {
    // A second rendering of `$2,450` here would not fail loudly — it would make
    // the re-validation refuse the exact price the draft was written with, or
    // accept one the model was never given.
    const source = code(CORE);
    expect(source).toMatch(
      /import\s*\{[^}]*\bbuildMergeFacts\b[^}]*\}\s*from\s*'@\/core\/drafting\/merge-facts'/,
    );
    expect(source).not.toMatch(/toLocaleString\s*\(/);
    expect(source).not.toMatch(/Intl\.DateTimeFormat/);
  });

  it('uses the OWNED edit-distance metric, not an inline computation', () => {
    expect(code(CORE)).toMatch(
      /import\s*\{[^}]*\bnormalizedEditDistance\b[^}]*\}\s*from\s*'@\/core\/drafting\/edit-distance'/,
    );
  });

  it('composes the compliance suffix from the tenant name the CALLER authorized', () => {
    // Not from the form and not re-derived from a live read: the fallback name
    // is a parameter, so it can only be the one the caller's own gate proved.
    expect(code(CORE)).toMatch(/complianceSuffix\(\s*input\.tenantName\s*\)/);
  });

  it('rebuilds the whitelist at the DRAFT’s merge instant, with created_at only as fallback', () => {
    expect(code(CORE)).toMatch(/now:\s*found\.draft\.mergeNow\s*\?\?\s*found\.draft\.createdAt/);
    // Never a fresh clock — that is the midnight-boundary refusal.
    expect(code(CORE)).not.toMatch(/now:\s*new Date\(\)/);
  });

  it('writes the AI-04 zero EXPLICITLY on the approve-unchanged path', () => {
    // The single most important data point in the dataset V2-01 is gated on. A
    // NULL here is indistinguishable from "never approved".
    const source = code(CORE);
    const unchanged = source.slice(source.indexOf('export async function approveUnchanged'));
    expect(unchanged).toMatch(/writeApproval\([\s\S]*?found\.draft\.finalBody,\s*0,/);
  });

  it('is the ONLY module in src that calls touches.approveWhere (D-12)', async () => {
    // ── THE SOLE PATH TO `approved`, ASSERTED AS A COUNT OF CALL SITES ────
    //
    // Before the extraction there was one call site because there was one
    // surface. After it there is one because there is one CORE — the stronger
    // property, and the one a third approval surface must not break: adding a
    // second caller here is precisely how a surface acquires its own copy of
    // the latest-attempt and whitelist rules along the way.
    //
    // Comments are stripped first, because half this repository's files mention
    // `approveWhere` in prose explaining that it is the only writer.
    const { execSync } = await import('node:child_process');
    const files = execSync(
      String.raw`grep -rl "approveWhere" src --include='*.ts' --include='*.tsx' || true`,
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);

    const callers = files.filter((path) => /\.approveWhere\s*\(/.test(code(path))).sort();

    // The repository DEFINES it (`approveWhere:` / `approveWhere(...)`, no
    // leading dot) and is therefore not a caller. Exactly one module invokes it.
    expect(callers).toEqual([CORE]);
  });
});

/* ========================================================================= *
 * 8. The review surface (D-12) — source assertions
 *
 * The card and the page cannot be driven without a renderer, and the properties
 * that matter about them are structural anyway: which control exists on which
 * status, which client reads the bodies, and what reaches a log.
 * ========================================================================= */

/**
 * 06-01: the CARD moved to a shared component so the quote page and the
 * cross-client queue render one implementation (UI-SPEC component reuse
 * mandate). These assertions moved with it — every property below is about the
 * card, and pinning them on the surface that merely mounts it would leave the
 * shared component unguarded on the day a third surface appears.
 */
const CARD = 'src/app/(console)/components/draft-card.tsx';
const REVIEW = 'src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx';
const PAGE = 'src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx';

describe('the draft card offers no approve-unchanged control on a failed draft (D-11)', () => {
  const source = code(CARD);

  it('renders the approve form ONLY on the non-failed branch', () => {
    // The absence is a courtesy, not the enforcement — `approveDraft` refuses a
    // `validator_failed` attempt server-side, and the suite above pins that.
    // What this pins is that the operator is never offered a tap the server
    // would decline.
    expect(source).toMatch(/failed\s*\?\s*null\s*:\s*\(/);
    // And the guard is derived from the STORED status, not from a prop a caller
    // could set independently of it.
    expect(source).toMatch(/const failed = draft\.status === 'validator_failed'/);
  });

  it('submits both ids on every approval form', () => {
    const hiddenDraft = source.match(/name="draft_id"/g) ?? [];
    const hiddenTouch = source.match(/name="touch_id"/g) ?? [];
    expect(hiddenDraft.length).toBe(2);
    expect(hiddenTouch.length).toBe(2);
  });

  it('pre-fills the edit box with the WHOLE final body, opt-out line included', () => {
    // What makes the server's `missing_suffix` rule fair: the line is on screen,
    // and deleting it is a decision rather than an omission.
    expect(source).toMatch(/useState\(draft\.finalBody\)/);
  });

  it('shows the model recorded ON THE ROW, never a constant re-read at render', () => {
    // The project's model choice has already changed once by operator direction;
    // the question this column answers is which model wrote THIS text.
    expect(source).toMatch(/\{draft\.model\}/);
    expect(source).not.toMatch(/claude-/);
  });

  it('counts segments with the SAME pure function the validator uses', () => {
    // A second length rule here would let the box say "2 segments" about a body
    // the server refuses as three.
    expect(source).toMatch(
      /import\s*\{[^}]*\bcountSeptets\b[^}]*\}\s*from\s*'@\/core\/drafting\/gsm7'/,
    );
  });

  it('logs nothing at all', () => {
    // A client component's `console.*` lands in the browser, but this one is
    // rendered on the server first and its props ARE the draft bodies.
    expect(source).not.toMatch(/console\./);
  });

  it('never truncates, clamps or collapses the body (D-03, the full-review invariant)', () => {
    // ── THE INVARIANT MADE PHYSICAL ───────────────────────────────────────
    //
    // The whole argument for one-at-a-time approval is that every approve tap
    // has the WHOLE message on screen. A `line-clamp`, a `max-height`, a
    // `<details>` around the body, or a `.slice()` on it would quietly turn
    // full review into skim review while every test above still passed.
    expect(source).toMatch(/<pre className="draft-body">\{draft\.finalBody\}<\/pre>/);
    expect(source).not.toMatch(/line-clamp|maxHeight|max-height|truncate/);
    expect(source).not.toMatch(/finalBody\.slice|finalBody\.substring/);
  });

  it('offers NO batch affordance of any kind (D-03, one-way)', () => {
    // Extends the Phase 2 no-select-all precedent. A card owns one draft and one
    // touch; a checkbox, a multiple-select or an array-named input here is the
    // first half of an approve-all, which is a V2-01 policy decision gated on
    // edit-rate data rather than a UX tweak.
    expect(source).not.toMatch(/type="checkbox"/);
    expect(source).not.toMatch(/name="draft_ids"|name="touch_ids"|multiple/);
  });
});

describe('the two approval surfaces render ONE card (UI-SPEC reuse mandate)', () => {
  it('both mount components/draft-card.tsx rather than their own', () => {
    const QUEUE_CARD = 'src/app/(console)/queue/queue-card.tsx';
    for (const path of [REVIEW, QUEUE_CARD]) {
      expect(code(path)).toMatch(
        /import\s*\{[^}]*\bDraftCard\b[^}]*\}\s*from\s*'@\/app\/\(console\)\/components\/draft-card'/,
      );
    }
  });

  it('neither surface re-implements the body, the buttons or the edit box', () => {
    // The CR-02 defect class in the DOM: two renderings that agree today and
    // drift the first time one is corrected. Whatever each surface adds — a
    // client name, a link, a skip control — it adds through the shared card's
    // slots, never by growing its own copy of these.
    const QUEUE_CARD = 'src/app/(console)/queue/queue-card.tsx';
    for (const path of [REVIEW, QUEUE_CARD]) {
      const source = code(path);
      expect(source).not.toMatch(/draft-body/);
      expect(source).not.toMatch(/Approve and send as written/);
      expect(source).not.toMatch(/<textarea/);
    }
  });

  it('both bind their actions to the SAME core, one surface apart', () => {
    // The only difference between the two renderings that is allowed to exist:
    // which tenant is written to. Never which rules are checked.
    expect(code('src/app/(console)/queue/actions.ts')).toMatch(
      /import\s*\{[^}]*\bapproveUnchanged\b[^}]*\}\s*from\s*'@\/core\/approval\/approve-draft'/,
    );
    expect(code(ACTIONS)).toMatch(
      /import\s*\{[^}]*\bapproveUnchanged\b[^}]*\}\s*from\s*'@\/core\/approval\/approve-draft'/,
    );
  });
});

describe('the quote page reads drafts under RLS and shows only sendable bytes', () => {
  const source = code(PAGE);

  it('reads touch_drafts through the operator session client, not service-role', () => {
    expect(source).toMatch(/supabase\s*\n?\s*\.from\('touch_drafts'\)/);
    // `forTenant` / `getDb` is the service-role path, where RLS is inert by
    // design. Neither belongs on a page: the policy is what scopes these bodies.
    expect(source).not.toMatch(/\bforTenant\s*\(/);
    expect(source).not.toMatch(/\bgetDb\s*\(/);
  });

  it('scopes the draft read by tenant as well as by touch', () => {
    expect(source).toMatch(/\.from\('touch_drafts'\)[\s\S]{0,400}?\.eq\('tenant_id', tenant\.id\)/);
  });

  it('does NOT select generated_body', () => {
    // What an operator approves is `final_body`. Rendering the model's raw
    // output beside it would put a second, un-sendable version of the message on
    // screen for somebody to read as "the message".
    expect(source).not.toMatch(/generated_body/);
  });

  it('renders only the newest attempt of each touch', () => {
    expect(source).toMatch(/\.order\('attempt', \{ ascending: false \}\)/);
    // ── THE FIRST ROW PER TOUCH DECIDES, WHATEVER IT SAYS. ────────────────
    //
    // The `seen` set is what makes the status filter drop the TOUCH rather than
    // skip to its previous attempt. Without it, rows of
    // `[2: approved, 1: validator_failed]` rendered attempt 1 with an edit form
    // that `loadApprovableDraft` refuses on every tap — an unapprovable card no
    // reload can clear.
    expect(source).toMatch(/if \(seen\.has\(row\.touch_id\)\) continue;/);
    expect(source).toMatch(/seen\.add\(row\.touch_id\);/);
  });

  it('offers a card only for a touch actually at pending_approval', () => {
    expect(source).toMatch(/touch\.status === 'pending_approval'/);
  });

  it('adds no log statement carrying a draft body', () => {
    const logs = source.match(/console\.\w+\([\s\S]*?\);/g) ?? [];
    for (const line of logs) {
      expect(line).not.toMatch(/final_body|finalBody|draft|pendingDrafts/);
    }
  });
});

describe('an empty draft explains WHY it is empty', () => {
  // `parkUnusable` records the real cause in the violation's `detail` — a
  // refusal, a truncation, an output the schema rejected. Discarding it left the
  // operator with an empty <pre>, an empty edit box, a "failed the fact check"
  // badge, and a sentence that described neither what happened nor what to do.
  it.each([
    ['a refusal', 'the model declined to write this message (stop_reason: refusal)'],
    ['a truncation', 'the model ran past max_tokens before finishing (stop_reason: max_tokens)'],
    ['an unparseable response', 'the response did not satisfy the draft schema'],
  ])('surfaces the recorded detail for %s', (_name, detail) => {
    const message = describeDraftViolation({ rule: 'empty_body', detail });

    expect(message).toContain(detail);
    expect(message).not.toBe(DRAFT_BODY_REQUIRED_MESSAGE);
  });

  it('still gives the plain instruction when there is no recorded cause', () => {
    // A genuinely empty SUBMISSION — the operator cleared the box — has no
    // detail, and "write the message" is the right sentence for that.
    expect(describeDraftViolation({ rule: 'empty_body' })).toBe(DRAFT_BODY_REQUIRED_MESSAGE);
  });
});
