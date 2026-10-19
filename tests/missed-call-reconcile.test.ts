/**
 * The nightly call-log sweep and the recording alarm (Phase 11, 11-03,
 * CAP-03/CAP-02, D-04/D-06/D-10).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PURE. Every collaborator is injected, and that is a SAFETY property.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The hosted database is production, and the Twilio account is real: a suite
 * that reached either would write `missed_calls` rows against live clients or
 * authenticate against Twilio with CI's placeholder credentials. So every
 * reconcile assertion is made by OBSERVING WHICH DEPENDENCY WAS CALLED WITH
 * WHAT — the messaging-reconcile suite's rule — and the client half is proved
 * against a mocked `twilio` default export, never the network.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------------- *
 * The SDK, mocked at the package boundary (the client half, below)
 * ------------------------------------------------------------------------- */

const sdk = {
  callsList: vi.fn(),
  recordingsList: vi.fn(),
  localList: vi.fn(),
  numbersCreate: vi.fn(),
  numbersList: vi.fn(),
  numberUpdate: vi.fn(),
  numberFetch: vi.fn(),
  countries: [] as string[],
};
/** Typed as the SDK's `(sid, token, opts)` so call arguments can be asserted. */
type Factory = (sid: string, token: string, opts: unknown) => unknown;
const twilioFactory = vi.fn<Factory>(() => ({
  calls: { list: sdk.callsList },
  recordings: { list: sdk.recordingsList },
  availablePhoneNumbers: (country: string) => {
    sdk.countries.push(country);
    return { local: { list: sdk.localList } };
  },
  // Callable like the SDK's list instance: `incomingPhoneNumbers(sid)` is the
  // number's context (update / fetch), and the list methods hang off it.
  incomingPhoneNumbers: Object.assign(
    (sid: string) => ({
      update: (params: unknown) => sdk.numberUpdate(sid, params),
      fetch: () => sdk.numberFetch(sid),
    }),
    { create: sdk.numbersCreate, list: sdk.numbersList },
  ),
}));
vi.mock('twilio', () => ({ default: twilioFactory }));

/** The environment, observed: the guard must return before it is ever read. */
const ENV_SID = `AC${'e'.repeat(32)}`;
const ENV_TOKEN = 'e'.repeat(32);
const getServerEnv = vi.fn(() => ({ TWILIO_ACCOUNT_SID: ENV_SID, TWILIO_AUTH_TOKEN: ENV_TOKEN }));
vi.mock('@/core/shared/env', () => ({ getServerEnv: () => getServerEnv() }));

const { reconcileMissedCalls, RECORDING_ALARM_SMS } = await import('@/core/telephony/reconcile');
type Deps = NonNullable<Parameters<typeof reconcileMissedCalls>[0]>;
const {
  TWILIO_EDGE,
  countRecordingsSince,
  isDeterminateRefusal,
  isWaGeographicNumber,
  attachBundle,
  listInboundCalls,
  listNumbersByFriendlyName,
  purchaseNumber,
  searchAuLocalNumbers,
  twilioCredsFromEnv,
  twilioReasonOf,
} = await import('@/core/telephony/twilio-client');

/* ------------------------------------------------------------------------- *
 * Fixtures — ACMA fiction-block numbers only
 * ------------------------------------------------------------------------- */

const CREDS = { accountSid: `AC${'0'.repeat(32)}`, authToken: 't'.repeat(32) };
const OWNED = '+61891570156';
const UNOWNED = '+61891570999';
const CALLER_MOBILE = '+61491570156';

/** Monday 28 Sep 2026, 03:30 AWST — the tick. */
const NOW = new Date('2026-09-27T19:30:00Z');
/** Monday 28 Sep 2026 is a weekday; 10:00 AWST is inside 08:00–17:00. */
const INSIDE = new Date('2026-09-28T02:00:00Z');
/** 20:00 AWST the Sunday before — outside on two counts. */
const OUTSIDE = new Date('2026-09-27T12:00:00Z');

const OWNER = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  divertNumberId: '22222222-2222-4222-8222-222222222222',
  numberE164: OWNED,
  spokenName: 'Fictional Plumbing',
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

function loggedCall(over: Record<string, unknown> = {}) {
  return {
    sid: `CA${'a'.repeat(32)}`,
    status: 'completed',
    direction: 'inbound',
    from: CALLER_MOBILE,
    to: OWNED,
    forwardedFrom: null,
    startTime: INSIDE,
    endTime: new Date(INSIDE.getTime() + 11_000),
    durationSeconds: 11,
    ...over,
  };
}

let divertNumbers: ReturnType<typeof vi.fn>;
let listCalls: ReturnType<typeof vi.fn>;
let countRecordings: ReturnType<typeof vi.fn>;
let upsert: ReturnType<typeof vi.fn>;
let alert: ReturnType<typeof vi.fn>;
let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function deps(over: Partial<Deps> = {}): Deps {
  return {
    divertNumbers,
    creds: CREDS,
    listCalls,
    countRecordings,
    upsert,
    alert,
    now: NOW,
    ...over,
  } as Deps;
}

/** The deps with `creds` OMITTED — "read the environment", the production default. */
function depsReadingEnv(): Deps {
  const all = deps();
  delete all.creds;
  return all;
}

/** Every string any console method was called with, in one haystack. */
function everyLogLine(): string {
  return [info, warn, error]
    .flatMap((spy) => spy.mock.calls.flat())
    .map((v) => String(v))
    .join('\n');
}

beforeEach(() => {
  divertNumbers = vi.fn().mockResolvedValue([OWNER]);
  listCalls = vi.fn().mockResolvedValue({ ok: true, items: [] });
  countRecordings = vi.fn().mockResolvedValue({ ok: true, count: 0 });
  upsert = vi.fn().mockResolvedValue({ kind: 'inserted' });
  alert = vi.fn().mockResolvedValue({ ok: true });
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});

  twilioFactory.mockClear();
  getServerEnv.mockClear();
  for (const fn of [
    sdk.callsList,
    sdk.recordingsList,
    sdk.localList,
    sdk.numbersCreate,
    sdk.numbersList,
    sdk.numberUpdate,
    sdk.numberFetch,
  ]) {
    fn.mockReset();
  }
  sdk.countries = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- *
 * The guard (RESEARCH Pitfall 12, T-11-13)
 * ------------------------------------------------------------------------- */

describe('the reconcile guard is first and total', () => {
  it('no active divert number → skipped, and ZERO provider calls (asserted, not assumed)', async () => {
    divertNumbers.mockResolvedValue([]);

    const result = await reconcileMissedCalls(deps());

    expect(result).toEqual({ skipped: true, missedCallsRecovered: 0, recordingsFound: 0, recordingsCheckFailed: false });
    expect(listCalls).not.toHaveBeenCalled();
    expect(countRecordings).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('no active divert number → the credentials are not even read', async () => {
    divertNumbers.mockResolvedValue([]);
    // `creds` omitted means "read the env" — which, with the guard first, must
    // never happen.
    await reconcileMissedCalls(depsReadingEnv());

    expect(getServerEnv).not.toHaveBeenCalled();
    expect(twilioFactory).not.toHaveBeenCalled();
    expect(listCalls).not.toHaveBeenCalled();
  });

  it('creds omitted + an active number → the env credentials are the ones polled with', async () => {
    await reconcileMissedCalls(depsReadingEnv());

    expect(getServerEnv).toHaveBeenCalled();
    expect(listCalls).toHaveBeenCalledWith(
      expect.objectContaining({ creds: { accountSid: ENV_SID, authToken: ENV_TOKEN } }),
    );
  });

  it('an unreadable environment → twilioCredsFromEnv is null → skipped, zero provider calls', async () => {
    getServerEnv.mockImplementationOnce(() => {
      throw new Error('Invalid server environment: TWILIO_ACCOUNT_SID');
    });
    const result = await reconcileMissedCalls(depsReadingEnv());

    expect(twilioCredsFromEnv).toBeTypeOf('function');
    expect(result).toEqual({ skipped: true, missedCallsRecovered: 0, recordingsFound: 0, recordingsCheckFailed: false });
    expect(listCalls).not.toHaveBeenCalled();
    expect(countRecordings).not.toHaveBeenCalled();
  });

  it('credentials absent (null) → skipped, and the same zero provider calls', async () => {
    const result = await reconcileMissedCalls(deps({ creds: null }));

    expect(result).toEqual({ skipped: true, missedCallsRecovered: 0, recordingsFound: 0, recordingsCheckFailed: false });
    expect(listCalls).not.toHaveBeenCalled();
    expect(countRecordings).not.toHaveBeenCalled();
  });

  it('polls a 48-hour window ending now', async () => {
    await reconcileMissedCalls(deps());

    const expected = new Date(NOW.getTime() - 48 * 3_600_000);
    expect(listCalls).toHaveBeenCalledWith({ creds: CREDS, since: expected });
    expect(countRecordings).toHaveBeenCalledWith({ creds: CREDS, since: expected });
  });
});

/* ------------------------------------------------------------------------- *
 * The convergence (D-06, CAP-03)
 * ------------------------------------------------------------------------- */

describe('the call-log convergence', () => {
  it('a logged call to an owned number with no row is upserted once and counted', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall()] });

    const result = await reconcileMissedCalls(deps());

    expect(result).toEqual({ skipped: false, missedCallsRecovered: 1, recordingsFound: 0, recordingsCheckFailed: false });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toEqual({
      tenantId: OWNER.tenantId,
      divertNumberId: OWNER.divertNumberId,
      provider: 'twilio',
      providerCallId: `CA${'a'.repeat(32)}`,
      calledNumberE164: OWNED,
      callerE164: CALLER_MOBILE,
      callerWithheld: false,
      callerKind: 'mobile',
      callerRaw: CALLER_MOBILE,
      forwardedFromRaw: null,
      fromCountry: null,
      startedAt: INSIDE,
      afterHours: false,
      callStatus: 'completed',
      durationSeconds: 11,
      endedAt: new Date(INSIDE.getTime() + 11_000),
      source: 'reconcile',
      completedVia: 'reconcile',
      deadLetterReason: null,
      rawPayload: null,
    });
  });

  it('after_hours is computed from the OWNER’s window at the call’s start — inside', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall({ startTime: INSIDE })] });

    await reconcileMissedCalls(deps());

    expect(upsert.mock.calls[0][0].afterHours).toBe(false);
  });

  it('after_hours is computed from the OWNER’s window at the call’s start — outside', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall({ startTime: OUTSIDE })] });

    await reconcileMissedCalls(deps());

    expect(upsert.mock.calls[0][0].afterHours).toBe(true);
    expect(upsert.mock.calls[0][0].startedAt).toEqual(OUTSIDE);
  });

  it('the window is the owner’s, not a default: an evening-hours owner flips the answer', async () => {
    divertNumbers.mockResolvedValue([
      { ...OWNER, contactHoursStart: '18:00:00', contactHoursEnd: '22:00:00', contactDays: [7] },
    ]);
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall({ startTime: OUTSIDE })] });

    await reconcileMissedCalls(deps());

    // Sunday 20:00 AWST is INSIDE an 18:00–22:00 Sunday window.
    expect(upsert.mock.calls[0][0].afterHours).toBe(false);
  });

  it('a window it cannot interpret stores after_hours = true (the arrival path’s answer)', async () => {
    divertNumbers.mockResolvedValue([{ ...OWNER, timezone: 'Not/AZone' }]);
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall()] });

    const result = await reconcileMissedCalls(deps());

    expect(upsert.mock.calls[0][0].afterHours).toBe(true);
    expect(result.missedCallsRecovered).toBe(1);
  });

  it('a call with no start time is started "now" and still recorded', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall({ startTime: null })] });

    await reconcileMissedCalls(deps());

    expect(upsert.mock.calls[0][0].startedAt).toEqual(NOW);
  });

  it('the caller is classified by classifyCaller — withheld, landline, sentinel', async () => {
    listCalls.mockResolvedValue({
      ok: true,
      items: [
        loggedCall({ sid: `CA${'1'.repeat(32)}`, from: 'anonymous' }),
        loggedCall({ sid: `CA${'2'.repeat(32)}`, from: '+61891570100' }),
        loggedCall({ sid: `CA${'3'.repeat(32)}`, from: '+266696687' }),
        loggedCall({ sid: `CA${'4'.repeat(32)}`, from: null }),
      ],
    });

    await reconcileMissedCalls(deps());

    const rows = upsert.mock.calls.map((c) => c[0]);
    expect(rows.map((r) => [r.callerKind, r.callerE164, r.callerWithheld])).toEqual([
      ['withheld', null, true],
      ['other_number', '+61891570100', false],
      ['withheld', null, true],
      ['withheld', null, true],
    ]);
    expect(rows[3].callerRaw).toBeNull();
  });

  it('an unknown call status is stored as NULL, never as an unchecked string', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall({ status: 'something-new' })] });

    await reconcileMissedCalls(deps());

    expect(upsert.mock.calls[0][0].callStatus).toBeNull();
  });

  it('a call to an UNOWNED number is skipped silently — no upsert, not counted', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall({ to: UNOWNED })] });

    const result = await reconcileMissedCalls(deps());

    expect(upsert).not.toHaveBeenCalled();
    expect(result.missedCallsRecovered).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the tenant key is the called number ONLY — a ForwardedFrom matching an owner is ignored', async () => {
    listCalls.mockResolvedValue({
      ok: true,
      items: [loggedCall({ to: UNOWNED, forwardedFrom: OWNED })],
    });

    await reconcileMissedCalls(deps());

    expect(upsert).not.toHaveBeenCalled();
  });

  it('an existing row completed or adopted by the reconcile (`updated`) is counted too', async () => {
    upsert.mockResolvedValue({ kind: 'updated' });
    listCalls.mockResolvedValue({
      ok: true,
      items: [loggedCall(), loggedCall({ sid: `CA${'b'.repeat(32)}` })],
    });

    const result = await reconcileMissedCalls(deps());

    expect(result.missedCallsRecovered).toBe(2);
  });

  it('a call whose row was already complete (`unchanged`) is NOT counted as recovered (WR-06)', async () => {
    upsert.mockResolvedValueOnce({ kind: 'unchanged' }).mockResolvedValueOnce({ kind: 'inserted' });
    listCalls.mockResolvedValue({
      ok: true,
      items: [loggedCall(), loggedCall({ sid: `CA${'b'.repeat(32)}` })],
    });

    const result = await reconcileMissedCalls(deps());

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(result.missedCallsRecovered).toBe(1);
  });

  it('a failed calls poll is a warning with the bounded code and zero — never a throw', async () => {
    listCalls.mockResolvedValue({ ok: false, reason: 'TimeoutError' });

    const result = await reconcileMissedCalls(deps());

    expect(result).toEqual({ skipped: false, missedCallsRecovered: 0, recordingsFound: 0, recordingsCheckFailed: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('calls poll failed'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TimeoutError'));
    expect(countRecordings).toHaveBeenCalledTimes(1);
  });

  it('an empty call-log page is zero recovered and NO warning', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [] });

    const result = await reconcileMissedCalls(deps());

    expect(result.missedCallsRecovered).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('[telephony] reconcile recovered=0 recordings=0');
  });

  it('an upsert that THROWS returns the NOTHING shape and a fixed error — never a rejection', async () => {
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall()] });
    upsert.mockRejectedValue(new Error(`insert failed for ${CALLER_MOBILE}`));

    const result = await reconcileMissedCalls(deps());

    expect(result).toEqual({ skipped: true, missedCallsRecovered: 0, recordingsFound: null, recordingsCheckFailed: true });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('reconcile failed'));
  });

  it('the owner-map read THROWING is the same NOTHING — the cron route must never 500', async () => {
    divertNumbers.mockRejectedValue(new Error('connect ETIMEDOUT'));

    await expect(reconcileMissedCalls(deps())).resolves.toEqual({
      skipped: true,
      missedCallsRecovered: 0,
      recordingsFound: null,
      recordingsCheckFailed: true,
    });
    expect(listCalls).not.toHaveBeenCalled();
  });

  it('no caller number, called number or thrown prose reaches ANY log line (T-11-04)', async () => {
    listCalls.mockResolvedValue({
      ok: true,
      items: [loggedCall(), loggedCall({ sid: `CA${'c'.repeat(32)}`, to: UNOWNED })],
    });
    countRecordings.mockResolvedValue({ ok: true, count: 1 });
    await reconcileMissedCalls(deps());

    upsert.mockRejectedValue(new Error(`duplicate key (${CALLER_MOBILE})`));
    await reconcileMissedCalls(deps());

    const logs = everyLogLine();
    expect(logs).not.toMatch(/\+61\d/);
    expect(logs).not.toContain('duplicate key');
  });
});

/* ------------------------------------------------------------------------- *
 * The recording alarm (D-04, CAP-02, T-11-10)
 * ------------------------------------------------------------------------- */

describe('the recording alarm', () => {
  it('a recording on the account → recordingsFound, RECORDING_PRESENT and ONE operator SMS', async () => {
    countRecordings.mockResolvedValue({ ok: true, count: 2 });

    const result = await reconcileMissedCalls(deps());

    expect(result.recordingsFound).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[telephony] RECORDING_PRESENT'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(RECORDING_ALARM_SMS);
  });

  it('the alarm sentence is fixed, identifier-free and one GSM-7 segment', () => {
    expect(RECORDING_ALARM_SMS).toContain('Twilio recording exists');
    expect(RECORDING_ALARM_SMS).toContain('D-04');
    expect(RECORDING_ALARM_SMS.length).toBeLessThanOrEqual(160);
    expect(RECORDING_ALARM_SMS).toMatch(/^[A-Za-z0-9 .,;:()'-]+$/);
    expect(RECORDING_ALARM_SMS).not.toMatch(/\d{6,}|RE[0-9a-f]{8}|AC[0-9a-f]{8}/);
  });

  it('zero recordings → no error line and no alarm', async () => {
    await reconcileMissedCalls(deps());

    expect(error).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('a failed recordings count is NULL, flagged and logged — never a 0 that reads as clean (WR-05)', async () => {
    countRecordings.mockResolvedValue({ ok: false, reason: 'http_503' });
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall()] });

    const result = await reconcileMissedCalls(deps());

    expect(result).toEqual({
      skipped: false,
      missedCallsRecovered: 1,
      recordingsFound: null,
      recordingsCheckFailed: true,
    });
    expect(warn).toHaveBeenCalledWith('[telephony] reconcile recordings poll failed: http_503');
    expect(info).toHaveBeenCalledWith('[telephony] reconcile recovered=1 recordings=unknown');
    // Nothing was found, so there is nothing to alarm about — but nothing is
    // claimed clean either.
    expect(alert).not.toHaveBeenCalled();
  });

  it('a failed alert is a warning, not a throw — and the calls are still converged', async () => {
    countRecordings.mockResolvedValue({ ok: true, count: 1 });
    alert.mockRejectedValue(new Error('clicksend down'));
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall()] });

    const result = await reconcileMissedCalls(deps());

    expect(result).toEqual({ skipped: false, missedCallsRecovered: 1, recordingsFound: 1, recordingsCheckFailed: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('alarm sms not sent'));
  });

  it('an alert that RESOLVES with ok:false is also a warning', async () => {
    countRecordings.mockResolvedValue({ ok: true, count: 1 });
    alert.mockResolvedValue({ ok: false, kind: 'not_configured', detail: 'x' });

    await reconcileMissedCalls(deps());

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('alarm sms not sent'));
  });

  it('the alarm fires even when the call sweep then fails on the database', async () => {
    // The count runs BEFORE the sweep, so a database failure part-way through
    // the sweep cannot silence the D-04 invariant.
    countRecordings.mockResolvedValue({ ok: true, count: 1 });
    listCalls.mockResolvedValue({ ok: true, items: [loggedCall()] });
    upsert.mockRejectedValue(new Error('db down'));

    await reconcileMissedCalls(deps());

    expect(alert).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('RECORDING_PRESENT'));
  });
});

/* ------------------------------------------------------------------------- *
 * The Twilio client (D-10, T-11-14, T-11-SC) — against the mocked SDK
 * ------------------------------------------------------------------------- */

describe('the Twilio client', () => {
  it('constructs the SDK with the Sydney edge and a bounded timeout', async () => {
    sdk.callsList.mockResolvedValue([]);

    await listInboundCalls({ creds: CREDS, since: NOW });

    expect(TWILIO_EDGE).toBe('sydney');
    expect(twilioFactory).toHaveBeenCalledWith(CREDS.accountSid, CREDS.authToken, {
      edge: 'sydney',
      timeout: 20_000,
    });
  });

  it('lists calls since the window start, capped at 500, and keeps INBOUND only', async () => {
    sdk.callsList.mockResolvedValue([
      {
        sid: 'CA1',
        status: 'completed',
        direction: 'inbound',
        from: CALLER_MOBILE,
        to: OWNED,
        forwardedFrom: '',
        startTime: INSIDE,
        endTime: null,
        duration: '11',
      },
      { sid: 'CA2', status: 'completed', direction: 'outbound-api', to: OWNED, duration: '5' },
    ]);

    const result = await listInboundCalls({ creds: CREDS, since: NOW });

    expect(sdk.callsList).toHaveBeenCalledWith({ startTimeAfter: NOW, limit: 500 });
    expect(result).toEqual({
      ok: true,
      items: [
        {
          sid: 'CA1',
          status: 'completed',
          direction: 'inbound',
          from: CALLER_MOBILE,
          to: OWNED,
          forwardedFrom: null,
          startTime: INSIDE,
          endTime: null,
          durationSeconds: 11,
        },
      ],
    });
  });

  it('a duration Twilio has not set yet is null, not NaN', async () => {
    sdk.callsList.mockResolvedValue([
      { sid: 'CA1', status: 'in-progress', direction: 'inbound', to: OWNED, duration: null },
    ]);

    const result = await listInboundCalls({ creds: CREDS, since: NOW });

    expect(result.ok && result.items[0].durationSeconds).toBeNull();
  });

  it('a RestException becomes http_<status>; its message never leaves the client', async () => {
    const e = Object.assign(new Error(`The number ${CALLER_MOBILE} is invalid`), { status: 404 });
    sdk.callsList.mockRejectedValue(e);

    const result = await listInboundCalls({ creds: CREDS, since: NOW });

    expect(result).toEqual({ ok: false, reason: 'http_404' });
  });

  it('a constructor throw (bad account SID) is a code too — nothing throws', async () => {
    twilioFactory.mockImplementationOnce(() => {
      throw new Error('accountSid must start with AC');
    });

    await expect(
      countRecordingsSince({ creds: { accountSid: 'nope', authToken: 'x' }, since: NOW }),
    ).resolves.toEqual({ ok: false, reason: 'Error' });
  });

  it('counts recordings since the window start, capped at 50, and returns ONLY the count', async () => {
    sdk.recordingsList.mockResolvedValue([{ sid: 'RE1', mediaUrl: 'https://x' }, { sid: 'RE2' }]);

    const result = await countRecordingsSince({ creds: CREDS, since: NOW });

    expect(sdk.recordingsList).toHaveBeenCalledWith({ dateCreatedAfter: NOW, limit: 50 });
    expect(result).toEqual({ ok: true, count: 2 });
  });

  it('searches Perth first — AU local, voice-enabled', async () => {
    sdk.localList.mockResolvedValueOnce([
      { phoneNumber: '+61891570101', locality: 'Perth', region: 'WA', addressRequirements: 'local' },
    ]);

    const result = await searchAuLocalNumbers({ creds: CREDS });

    expect(sdk.countries).toEqual(['AU']);
    expect(sdk.localList).toHaveBeenCalledTimes(1);
    expect(sdk.localList).toHaveBeenCalledWith({ inLocality: 'Perth', voiceEnabled: true, limit: 10 });
    expect(result).toEqual({
      ok: true,
      candidates: [
        { phoneNumber: '+61891570101', locality: 'Perth', region: 'WA', addressRequirements: 'local' },
      ],
    });
  });

  it('drops a non-WA number that Twilio lists under the Perth locality (D-11-06-1)', async () => {
    // The 11-06 live search returned a +613 number first among ten "Perth"
    // results; the Buy step only accepts +618, so Find must never offer it.
    sdk.localList.mockResolvedValueOnce([
      { phoneNumber: '+61391570199', locality: 'Perth', region: 'VIC', addressRequirements: 'local' },
      { phoneNumber: '+61891570101', locality: 'Perth', region: 'WA', addressRequirements: 'local' },
    ]);

    const result = await searchAuLocalNumbers({ creds: CREDS });

    expect(sdk.localList).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      candidates: [
        { phoneNumber: '+61891570101', locality: 'Perth', region: 'WA', addressRequirements: 'local' },
      ],
    });
  });

  it('an empty Perth inventory falls back to ANY WA number, filtered client-side, in provider order', async () => {
    sdk.localList.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { phoneNumber: '+61291570101', locality: 'Sydney', region: 'NSW' },
      { phoneNumber: '+61891570102', locality: 'Bunbury', region: 'WA' },
      { phoneNumber: '+61891570103', locality: null, region: null },
      { phoneNumber: '+61391570104', locality: 'Melbourne', region: 'VIC' },
    ]);

    const result = await searchAuLocalNumbers({ creds: CREDS });

    expect(sdk.localList).toHaveBeenLastCalledWith({ voiceEnabled: true, limit: 50 });
    expect(result.ok && result.candidates.map((c) => c.phoneNumber)).toEqual([
      '+61891570102',
      '+61891570103',
    ]);
  });

  it('drops an SA +618 7… number Twilio labels "Perth", even FIRST on the page (WR-08, F-11-07-1)', async () => {
    sdk.localList.mockResolvedValueOnce([
      // What the first purchase got: "Perth" in the search, Waikerie SA in the Console.
      { phoneNumber: '+61875570101', locality: 'Perth', region: 'WA', addressRequirements: 'local' },
      { phoneNumber: '+61885570102', locality: 'Perth', region: 'Western Australia', addressRequirements: 'local' },
      { phoneNumber: '+61861570103', locality: 'Perth', region: 'Western Australia', addressRequirements: 'local' },
    ]);

    const result = await searchAuLocalNumbers({ creds: CREDS });

    expect(result.ok && result.candidates.map((c) => c.phoneNumber)).toEqual(['+61861570103']);
    expect(sdk.localList).toHaveBeenCalledTimes(1);
  });

  it('a Perth page with ONLY SA/NT numbers falls back, and the fallback is range-filtered too', async () => {
    sdk.localList
      .mockResolvedValueOnce([{ phoneNumber: '+61875570101', locality: 'Perth', region: 'WA' }])
      .mockResolvedValueOnce([
        { phoneNumber: '+61889570102', locality: 'Darwin', region: 'NT' },
        // `region === 'WA'` no longer admits anything: the region arm is gone.
        { phoneNumber: '+61291570103', locality: 'Perth', region: 'WA' },
        { phoneNumber: '+61897570104', locality: 'Bunbury', region: 'WA' },
      ]);

    const result = await searchAuLocalNumbers({ creds: CREDS });

    expect(result.ok && result.candidates.map((c) => c.phoneNumber)).toEqual(['+61897570104']);
  });

  it.each([
    ['+61892345678', true, 'Perth 08 92'],
    ['+61861234567', true, 'Perth 08 61'],
    ['+61841234567', true, 'Port Hedland 08 41'],
    ['+61851234567', true, 'Port Hedland 08 51'],
    ['+61855512345', true, 'Bullsbrook East 08 55'],
    ['+61855501234', false, '(08) 5550 is excluded by the Plan'],
    ['+61857123456', true, 'Bunbury 08 57'],
    ['+61858123456', true, 'Albany 08 58'],
    ['+61856123456', false, '08 56 is not a WA range'],
    ['+61875570101', false, 'Riverland SA 08 75'],
    ['+61882345678', false, 'Adelaide 08 82'],
    ['+61889234567', false, 'Darwin NT 08 89'],
    ['+61880123456', false, 'Broken Hill NSW 08 80'],
    ['+61820123456', false, 'Adelaide 08 20'],
    ['+61391570199', false, 'Melbourne 03'],
    ['+6189234567', false, 'one digit short'],
    ['+618923456789', false, 'one digit long'],
  ])('isWaGeographicNumber(%s) → %s (%s)', (e164, expected) => {
    expect(isWaGeographicNumber(e164)).toBe(expected);
  });

  it('purchases with EVERYTHING in the one create call, and no sms URL', async () => {
    sdk.numbersCreate.mockResolvedValue({
      sid: `PN${'0'.repeat(32)}`,
      phoneNumber: OWNED,
      bundleSid: `BU${'0'.repeat(32)}`,
    });

    const result = await purchaseNumber({
      creds: CREDS,
      phoneNumber: OWNED,
      friendlyName: 'backdesk-divert-x',
      voiceUrl: 'https://app.example/voice?token=v',
      statusCallback: 'https://app.example/voice-status?token=s',
      bundleSid: `BU${'0'.repeat(32)}`,
      addressSid: `AD${'0'.repeat(32)}`,
      voiceFallbackUrl: 'https://fallback.example/twiml',
    });

    // WR-09: the bundle Twilio REPORTS is read back from the response.
    expect(result).toEqual({
      ok: true,
      sid: `PN${'0'.repeat(32)}`,
      phoneNumber: OWNED,
      bundleSid: `BU${'0'.repeat(32)}`,
    });
    expect(sdk.numbersCreate).toHaveBeenCalledTimes(1);
    const args = sdk.numbersCreate.mock.calls[0][0];
    expect(args).toMatchObject({
      phoneNumber: OWNED,
      voiceMethod: 'POST',
      statusCallbackMethod: 'POST',
      voiceCallerIdLookup: false,
      voiceFallbackUrl: 'https://fallback.example/twiml',
      voiceFallbackMethod: 'GET',
      bundleSid: `BU${'0'.repeat(32)}`,
      addressSid: `AD${'0'.repeat(32)}`,
    });
    expect(Object.keys(args).filter((k) => /sms/i.test(k))).toEqual([]);
  });

  it('no fallback URL → no fallback keys at all', async () => {
    sdk.numbersCreate.mockResolvedValue({ sid: 'PN1', phoneNumber: OWNED });

    await purchaseNumber({
      creds: CREDS,
      phoneNumber: OWNED,
      friendlyName: 'f',
      voiceUrl: 'https://a/v',
      statusCallback: 'https://a/s',
      bundleSid: `BU${'0'.repeat(32)}`,
      addressSid: `AD${'0'.repeat(32)}`,
    });

    expect(sdk.numbersCreate.mock.calls[0][0]).not.toHaveProperty('voiceFallbackUrl');
    expect(sdk.numbersCreate.mock.calls[0][0]).not.toHaveProperty('voiceFallbackMethod');
  });

  it('a purchase failure says whether Twilio DEFINITELY refused it (CR-01)', async () => {
    const refusal = Object.assign(new Error('Number not available'), { status: 400, code: 21422 });
    sdk.numbersCreate.mockRejectedValueOnce(refusal);
    const input = {
      creds: CREDS,
      phoneNumber: OWNED,
      friendlyName: 'f',
      voiceUrl: 'https://a/v',
      statusCallback: 'https://a/s',
      bundleSid: `BU${'0'.repeat(32)}`,
      addressSid: `AD${'0'.repeat(32)}`,
    };

    expect(await purchaseNumber(input)).toEqual({ ok: false, reason: 'http_400', determinate: true });

    sdk.numbersCreate.mockRejectedValueOnce(Object.assign(new Error('t'), { code: 'ETIMEDOUT' }));
    expect(await purchaseNumber(input)).toEqual({ ok: false, reason: 'ETIMEDOUT', determinate: false });

    sdk.numbersCreate.mockRejectedValueOnce(Object.assign(new Error('u'), { status: 503, code: 20500 }));
    expect(await purchaseNumber(input)).toEqual({ ok: false, reason: 'http_503', determinate: false });
  });

  it.each([
    ['a 4xx with a Twilio code', { status: 400, code: 21422 }, true],
    ['a 429 with a Twilio code', { status: 429, code: 20429 }, true],
    ['a 4xx WITHOUT a Twilio code', { status: 400 }, false],
    ['a 408 request timeout', { status: 408, code: 20408 }, false],
    ['a 5xx', { status: 502, code: 20500 }, false],
    ['a socket errno', { code: 'ECONNRESET' }, false],
    ['a bare Error', {}, false],
  ])('isDeterminateRefusal: %s → %s', (_l, fields, expected) => {
    expect(isDeterminateRefusal(Object.assign(new Error('x'), fields))).toBe(expected);
  });

  it('lists OUR numbers by EXACT friendly name — a READ, nothing else', async () => {
    sdk.numbersList.mockResolvedValue([
      { sid: 'PN1', phoneNumber: OWNED, friendlyName: 'backdesk-divert-t1' },
      { sid: 'PN2', phoneNumber: UNOWNED, friendlyName: 'backdesk-divert-t1-other' },
    ]);

    const result = await listNumbersByFriendlyName({ creds: CREDS, friendlyName: 'backdesk-divert-t1' });

    expect(sdk.numbersList).toHaveBeenCalledWith({ friendlyName: 'backdesk-divert-t1', limit: 5 });
    expect(result).toEqual({ ok: true, items: [{ sid: 'PN1', phoneNumber: OWNED, bundleSid: null }] });

    sdk.numbersList.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
    expect(await listNumbersByFriendlyName({ creds: CREDS, friendlyName: 'x' })).toEqual({
      ok: false,
      reason: 'http_503',
    });
  });

  it('a create response with bundle_sid null is reported as null, not assumed (F-11-07-2)', async () => {
    sdk.numbersCreate.mockResolvedValue({ sid: 'PN1', phoneNumber: OWNED, bundleSid: null });

    const result = await purchaseNumber({
      creds: CREDS,
      phoneNumber: OWNED,
      friendlyName: 'f',
      voiceUrl: 'https://a/v',
      statusCallback: 'https://a/s',
      bundleSid: `BU${'0'.repeat(32)}`,
      addressSid: `AD${'0'.repeat(32)}`,
    });

    expect(result).toEqual({ ok: true, sid: 'PN1', phoneNumber: OWNED, bundleSid: null });
  });

  it('attachBundle sets the bundle ONLY, then READS IT BACK — the fetch decides (WR-09)', async () => {
    sdk.numberUpdate.mockResolvedValue({ sid: 'PN1' });
    sdk.numberFetch.mockResolvedValue({ sid: 'PN1', bundleSid: `BU${'0'.repeat(32)}` });

    const result = await attachBundle({ creds: CREDS, sid: 'PN1', bundleSid: `BU${'0'.repeat(32)}` });

    expect(sdk.numberUpdate).toHaveBeenCalledTimes(1);
    expect(sdk.numberUpdate).toHaveBeenCalledWith('PN1', { bundleSid: `BU${'0'.repeat(32)}` });
    expect(sdk.numberFetch).toHaveBeenCalledWith('PN1');
    expect(result).toEqual({ ok: true, bundleSid: `BU${'0'.repeat(32)}` });
  });

  it('attachBundle reports a read-back that STILL shows no bundle as null', async () => {
    sdk.numberUpdate.mockResolvedValue({ sid: 'PN1' });
    sdk.numberFetch.mockResolvedValue({ sid: 'PN1', bundleSid: null });

    expect(await attachBundle({ creds: CREDS, sid: 'PN1', bundleSid: `BU${'0'.repeat(32)}` })).toEqual({
      ok: true,
      bundleSid: null,
    });
  });

  it('attachBundle is a code on failure — and does not read back after a refused update', async () => {
    sdk.numberUpdate.mockRejectedValue(Object.assign(new Error(`bundle for ${CALLER_MOBILE}`), { status: 400, code: 21649 }));

    expect(await attachBundle({ creds: CREDS, sid: 'PN1', bundleSid: `BU${'0'.repeat(32)}` })).toEqual({
      ok: false,
      reason: 'http_400',
    });
    expect(sdk.numberFetch).not.toHaveBeenCalled();
  });

  it('reason codes are bounded to [A-Za-z0-9_]{1,32} and never carry prose', () => {
    const cases: unknown[] = [
      Object.assign(new Error('x'), { status: 401 }),
      Object.assign(new Error(`connect to ${CALLER_MOBILE}`), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('y'), { name: 'Some Very-Long Error Name With Spaces And More Words' }),
      new TypeError(`bad ${CREDS.authToken}`),
      'a thrown string',
      null,
      Object.assign(new Error('z'), { name: '' }),
    ];
    const reasons = cases.map(twilioReasonOf);

    expect(reasons.slice(0, 4)).toEqual([
      'http_401',
      'ETIMEDOUT',
      'Some_Very_Long_Error_Name_With_S',
      'TypeError',
    ]);
    expect(reasons[4]).toBe('sdk_error');
    expect(reasons[5]).toBe('sdk_error');
    for (const r of reasons) expect(r).toMatch(/^[A-Za-z0-9_]{1,32}$/);
    expect(reasons.join(' ')).not.toContain(CREDS.authToken);
  });
});

/* ------------------------------------------------------------------------- *
 * Source pins
 * ------------------------------------------------------------------------- */

/** Source with comments stripped — the `tests/ops-scripts.test.ts` rule. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const RECONCILE = 'src/core/telephony/reconcile.ts';
const CLIENT = 'src/core/telephony/twilio-client.ts';

/**
 * Restated from `tests/telephony-greeting.test.ts` (not exported there): the
 * recording verbs and APIs D-04 forbids. That suite scans these two files too;
 * this is the local, named assertion.
 */
const FORBIDDEN = [
  /<\s*Record(?=[\s/>])/,
  /<\s*Dial(?=[\s/>])/,
  /<\s*Gather(?=[\s/>])/,
  /recordings\s*\.\s*create/i,
  /\brecord\s*[:=]\s*['"]?true/i,
  /transcribe/i,
  /\.record\s*\(/i,
];

describe('source pins', () => {
  it('the reconcile IMPORTS the webhook’s classifier, window and upsert — no local copies', () => {
    const src = code(RECONCILE);

    expect(src).toMatch(/import \{[^}]*\bisInsideWindow\b[^}]*\} from '@\/core\/cadence\/window'/);
    expect(src).toMatch(/import \{ classifyCaller \} from '\.\/caller'/);
    expect(src).toMatch(/\bupsertMissedCallFromLog\b[\s\S]*from '@\/db\/repository'/);
    expect(src).toContain('forAllTenants_activeDivertNumbers');
    expect(src).not.toContain('normalizeAuMobile');
    expect(src).not.toContain('WITHHELD_SENTINELS');
    expect(src).not.toMatch(/function\s+(classifyCaller|isInsideWindow)\b/);
  });

  it('the reconcile never creates, fetches or downloads a recording (D-04)', () => {
    const src = code(RECONCILE);

    expect(src).not.toMatch(/\.fetch\s*\(/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    for (const pattern of FORBIDDEN) expect(src, String(pattern)).not.toMatch(pattern);
  });

  it('the client lists recordings and does nothing else with them', () => {
    const src = code(CLIENT);

    expect(src.match(/\.recordings\b/g)).toHaveLength(1);
    expect(src).toContain('.recordings.list(');
    for (const pattern of FORBIDDEN) expect(src, String(pattern)).not.toMatch(pattern);
  });

  it('the client has no release, delete, outbound-call or general update operation (T-11-SC)', () => {
    const src = code(CLIENT);

    expect(src).not.toMatch(/\.remove\s*\(/);
    expect(src).not.toMatch(/calls\s*\.\s*create/);
    expect(src).not.toMatch(/incomingPhoneNumbers\s*\(/);
    expect(src).not.toMatch(/\bmessages\b/);
  });

  it('its ONE update is attachBundle, and it sets bundleSid and nothing else (WR-09)', () => {
    const src = code(CLIENT);

    // Exactly one `.update(` in the file, and its argument is `{ bundleSid: … }`
    // alone — no URL, name, owner or messaging field can ride it.
    expect(src.match(/\.update\s*\(/g)).toHaveLength(1);
    expect(src).toMatch(/\.update\(\{ bundleSid: input\.bundleSid \}\)/);
    const body = src.slice(src.indexOf('export async function attachBundle'));
    expect(body.indexOf('.update(')).toBeGreaterThan(0);
    expect(body.indexOf('.update(')).toBeLessThan(body.indexOf('\n}\n'));
    // The number-resource context is reached ONLY there, through one local
    // alias (`numbers(sid)`): twice — the update and its read-back — and the
    // `incomingPhoneNumbers(` pin above still forbids any other spelling.
    expect(src.match(/\bnumbers\(/g)).toHaveLength(2);
    expect(src.match(/\.fetch\s*\(/g)).toHaveLength(1);
  });

  it('the client never reads an error message', () => {
    const src = code(CLIENT);

    expect(src).not.toMatch(/\.message\b/);
    expect(src).not.toMatch(/String\(e\)/);
  });

  it('twilio-client.ts is the ONLY file under src/ importing the twilio REST client', () => {
    const importers = (readdirSync('src', { recursive: true }) as string[])
      .filter((entry) => /\.(ts|tsx)$/.test(entry))
      .map((entry) => join('src', entry))
      .filter((path) => /from 'twilio'/.test(readFileSync(path, 'utf8')));

    expect(importers).toEqual([CLIENT]);
  });
});
