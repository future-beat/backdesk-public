/**
 * CAP-01 / D-08: `provisionDivertNumber` refuses on every configuration guard
 * WITHOUT touching Twilio, CLAIMS THE ROW BEFORE IT BUYS, writes both webhook
 * URLs from the ONE builder in the single create call, and records a refused
 * purchase as a bounded code the column's CHECK admits.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A REAL PURCHASE IS A REAL CHARGE AND A NUMBER THAT CANNOT BE RELEASED    │
 * │ WHILE THE CLIENT IS ACTIVE. So this suite is PURE: the repository is a   │
 * │ fake whose methods record their calls in ONE ordered log, and search and │
 * │ purchase are stubs. The first real purchase is plan 11-07's founder      │
 * │ checkpoint — by then every branch below has run.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Never reached — every test injects its own repo — but the module's default
// import must not open a connection.
vi.mock('@/db/repository', () => ({ forTenant: vi.fn() }));

const {
  checkProvisionGuards,
  DIVERT_HOLD_MS,
  divertFailureCode,
  findDivertNumberCandidate,
  isRecoverablePending,
  provisionDivertNumber,
} = await import('@/core/telephony/provision');
const { DIVERT_STALE_CLAIM_MINUTES } = await import('@/app/(console)/clients/[id]/action-state');
const { twilioWebhookUrl } = await import('@/core/telephony/webhook-url');

const TENANT_ID = '13e8f2aa-edee-4eb1-b699-09b650674f81';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
const NUMBER = '+61891570156';
const PN_SID = 'PN' + 'c'.repeat(32);
const CREDS = { accountSid: 'AC' + '0'.repeat(32), authToken: 'x'.repeat(32) };

const ENV = {
  APP_BASE_URL: 'https://app.backdesk.com.au',
  TWILIO_AU_BUNDLE_SID: 'BU' + 'a'.repeat(32),
  TWILIO_AU_ADDRESS_SID: 'AD' + 'b'.repeat(32),
  TWILIO_VOICE_WEBHOOK_SECRET: 'a1'.repeat(32),
  TWILIO_VOICE_STATUS_WEBHOOK_SECRET: 'b2'.repeat(32),
  TWILIO_VOICE_FALLBACK_URL: undefined,
};

type Row = {
  status: 'pending' | 'active' | 'failed';
  numberE164: string | null;
  failureCode?: string | null;
  updatedAt?: Date;
};

/** The fake clock every test runs on (`deps().now`). */
const NOW = new Date('2026-09-28T02:00:00.000Z');
/** A held row inside / beyond the ten-minute hold. */
const HELD_FRESH = new Date(NOW.getTime() - 2 * 60_000);
const HELD_STALE = new Date(NOW.getTime() - 11 * 60_000);
const OTHER_PN_SID = 'PN' + 'd'.repeat(32);
const EARLIER_NUMBER = '+61891570157';

/** ONE ordered log across the repository AND the provider stubs. */
let calls: string[];
let row: Row | null;
let claim: ReturnType<typeof vi.fn>;
let reclaim: ReturnType<typeof vi.fn>;
let activate: ReturnType<typeof vi.fn>;
let fail: ReturnType<typeof vi.fn>;
let hold: ReturnType<typeof vi.fn>;
let reclaimStale: ReturnType<typeof vi.fn>;
let listOwned: ReturnType<typeof vi.fn>;
let attach: ReturnType<typeof vi.fn>;
let setSpokenName: ReturnType<typeof vi.fn>;
let search: ReturnType<typeof vi.fn>;
let purchase: ReturnType<typeof vi.fn>;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    repo: () => ({
      divertNumber: {
        get: async () => {
          calls.push('get');
          return row ? [{ failureCode: null, updatedAt: NOW, ...row }] : [];
        },
        claim,
        reclaim,
        reclaimStale,
        activate,
        fail,
        hold,
        setSpokenName,
      },
    }),
    search,
    purchase,
    listOwned,
    attachBundle: attach,
    creds: CREDS,
    env: ENV,
    now: () => NOW,
    ...overrides,
  } as never;
}

/** One listing of the account, logged in the same ordered log as the repo. */
function listOwnedOnce(result: unknown) {
  listOwned.mockImplementationOnce(async () => (calls.push('list'), result));
}

const INPUT = {
  tenantId: TENANT_ID,
  spokenName: "Dave's Plumbing",
  phoneNumber: NUMBER,
  operatorId: OPERATOR_ID,
  locality: 'Perth',
};

beforeEach(() => {
  calls = [];
  row = null;
  claim = vi.fn(async () => (calls.push('claim'), [{}]));
  reclaim = vi.fn(async () => (calls.push('reclaim'), [{}]));
  activate = vi.fn(async () => (calls.push('activate'), [{}]));
  fail = vi.fn(async () => (calls.push('fail'), [{}]));
  hold = vi.fn(async () => (calls.push('hold'), [{}]));
  reclaimStale = vi.fn(async () => (calls.push('reclaimStale'), [{}]));
  listOwned = vi.fn(async () => (calls.push('list'), { ok: true, items: [] }));
  attach = vi.fn(async () => (calls.push('attach'), { ok: true, bundleSid: ENV.TWILIO_AU_BUNDLE_SID }));
  setSpokenName = vi.fn(async () => (calls.push('setSpokenName'), [{}]));
  search = vi.fn(async () => {
    calls.push('search');
    return {
      ok: true,
      candidates: [{ phoneNumber: NUMBER, locality: 'Perth', region: 'WA', addressRequirements: 'any' }],
    };
  });
  purchase = vi.fn(async () => {
    calls.push('purchase');
    return { ok: true, sid: PN_SID, phoneNumber: NUMBER, bundleSid: ENV.TWILIO_AU_BUNDLE_SID };
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the guards refuse by name, before any provider call (T-11-11)', () => {
  it.each([
    ['APP_BASE_URL unset', { APP_BASE_URL: undefined }, { kind: 'base_url_unset' }],
    ['the marketing apex', { APP_BASE_URL: 'https://backdesk.com.au' }, { kind: 'wrong_host', host: 'backdesk.com.au' }],
    [
      'a preview deployment',
      { APP_BASE_URL: 'https://backdesk-git-main-x.vercel.app' },
      { kind: 'wrong_host', host: 'backdesk-git-main-x.vercel.app' },
    ],
    ['no bundle', { TWILIO_AU_BUNDLE_SID: undefined }, { kind: 'bundle_missing' }],
    ['no address', { TWILIO_AU_ADDRESS_SID: undefined }, { kind: 'address_missing' }],
  ])('%s', async (_label, patch, expected) => {
    const env = { ...ENV, ...patch };

    expect(await provisionDivertNumber(INPUT, deps({ env }))).toEqual(expected);
    expect(await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps({ env }))).toEqual(expected);

    // NOTHING READ, NOTHING CLAIMED, NOTHING BOUGHT.
    expect(calls).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
  });

  it('checks the host before the bundle — the order the sentences assume', () => {
    expect(
      checkProvisionGuards({ ...ENV, APP_BASE_URL: 'https://backdesk.com.au', TWILIO_AU_BUNDLE_SID: undefined }),
    ).toEqual({ kind: 'wrong_host', host: 'backdesk.com.au' });
    expect(checkProvisionGuards(ENV)).toBeNull();
  });

  it('refuses when the Twilio credentials cannot be read', async () => {
    expect(await provisionDivertNumber(INPUT, deps({ creds: null }))).toEqual({ kind: 'config_unreadable' });
    expect(purchase).not.toHaveBeenCalled();
  });
});

describe('the row state decides before anything is bought', () => {
  it('an ACTIVE row is already provisioned — no search, no purchase', async () => {
    row = { status: 'active', numberE164: NUMBER };

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({
      kind: 'already_provisioned',
      numberE164: NUMBER,
    });
    expect(await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps())).toEqual({
      kind: 'already_provisioned',
      numberE164: NUMBER,
    });
    expect(search).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a PENDING row is in progress — no search, no claim, no purchase', async () => {
    row = { status: 'pending', numberE164: null };

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({ kind: 'in_progress' });
    expect(await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps())).toEqual({ kind: 'in_progress' });
    expect(claim).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
  });
});

describe('the search step (tap one) is a read', () => {
  it('returns the first Perth candidate and writes nothing', async () => {
    const result = await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps());

    expect(result).toEqual({ kind: 'candidate', phoneNumber: NUMBER, locality: 'Perth', region: 'WA' });
    expect(search).toHaveBeenCalledWith({ creds: CREDS, locality: 'Perth' });
    expect(calls).toEqual(['get', 'search']);
  });

  it('no candidates is no_inventory; a failed search carries its bounded reason', async () => {
    search.mockResolvedValueOnce({ ok: true, candidates: [] });
    expect(await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps())).toEqual({ kind: 'no_inventory' });

    search.mockResolvedValueOnce({ ok: false, reason: 'http_503' });
    expect(await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps())).toEqual({
      kind: 'search_failed',
      code: 'http_503',
    });
  });
});

describe('claim-then-buy (D-08)', () => {
  it('runs get → claim → purchase → activate, with the claim strictly BEFORE the purchase', async () => {
    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toEqual({ kind: 'provisioned', numberE164: NUMBER, locality: 'Perth', bundleAttached: true });
    expect(calls).toEqual(['get', 'claim', 'purchase', 'activate']);
    expect(calls.indexOf('claim')).toBeLessThan(calls.indexOf('purchase'));

    expect(claim).toHaveBeenCalledWith({ spokenName: "Dave's Plumbing", createdBy: OPERATOR_ID });
    expect(activate).toHaveBeenCalledWith({
      providerNumberSid: PN_SID,
      numberE164: NUMBER,
      locality: 'Perth',
      purchasedAt: new Date('2026-09-28T02:00:00.000Z'),
      failureCode: null,
    });
  });

  it('writes both URLs from the ONE builder, the uuid friendly name, and no sms URL', async () => {
    await provisionDivertNumber(INPUT, deps());

    const args = purchase.mock.calls[0][0] as Record<string, unknown>;
    expect(args.voiceUrl).toBe(twilioWebhookUrl('voice', ENV));
    expect(args.statusCallback).toBe(twilioWebhookUrl('voice-status', ENV));
    expect(args.voiceUrl).not.toBe(args.statusCallback);
    expect(args.friendlyName).toBe('backdesk-divert-' + TENANT_ID);
    expect(args.bundleSid).toBe(ENV.TWILIO_AU_BUNDLE_SID);
    expect(args.addressSid).toBe(ENV.TWILIO_AU_ADDRESS_SID);
    expect(args.phoneNumber).toBe(NUMBER);
    // The CLIENT sets caller-ID lookup off; provisioning never passes it, and
    // sms stays on ClickSend — no messaging URL of any spelling.
    expect(Object.keys(args)).not.toContain('voiceCallerIdLookup');
    expect(Object.keys(args).some((k) => /sms/i.test(k))).toBe(false);
    // The friendly name is visible in Twilio's console: never the business name.
    expect(String(args.friendlyName)).not.toContain('Dave');
  });

  it.each([
    ['a bare 23505', { code: '23505' }],
    ['a drizzle-wrapped 23505', Object.assign(new Error('Failed query'), { cause: { code: '23505' } })],
  ])('a claim losing the UNIQUE race (%s) is in_progress, and nothing is bought', async (_l, err) => {
    claim.mockRejectedValueOnce(err);

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({ kind: 'in_progress' });
    expect(purchase).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('any other claim failure is claim_failed, and nothing is bought', async () => {
    claim.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({
      kind: 'purchase_failed',
      code: 'claim_failed',
    });
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a refused purchase records a CHECK-safe code via fail, and reports it', async () => {
    purchase.mockResolvedValueOnce({ ok: false, reason: 'http_400', determinate: true });

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toEqual({ kind: 'purchase_failed', code: 'provider_rejected' });
    expect(hold).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith({ failureCode: 'provider_rejected' });
    expect(activate).not.toHaveBeenCalled();
    // `failure_code ~ '^[a-z_]{1,32}$'` — `http_400` itself would violate it.
    expect(fail.mock.calls[0][0].failureCode).toMatch(/^[a-z_]{1,32}$/);
  });

  it('a fill that fails AFTER a purchase logs orphaned_number with the PN sid', async () => {
    activate.mockRejectedValueOnce(new Error('insert ... +61891570156 ...'));

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toEqual({ kind: 'orphaned_number', sid: PN_SID });
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes('orphaned_number') && l.includes(PN_SID))).toBe(true);
    // The caught value is discarded — the statement text never reaches the log.
    expect(logged.join('\n')).not.toContain('+61891570156');
  });

  it('a FAILED row is re-claimed (no second INSERT), carrying the new spoken name', async () => {
    row = { status: 'failed', numberE164: null };

    const result = await provisionDivertNumber({ ...INPUT, spokenName: 'Dave Plumbing' }, deps());

    expect(result.kind).toBe('provisioned');
    expect(claim).not.toHaveBeenCalled();
    expect(reclaim).toHaveBeenCalledWith('Dave Plumbing');
    // LOOK BEFORE BUYING AGAIN (CR-01): the account is searched first.
    expect(listOwned).toHaveBeenCalledWith({ creds: CREDS, friendlyName: 'backdesk-divert-' + TENANT_ID });
    expect(calls).toEqual(['get', 'list', 'reclaim', 'purchase', 'activate']);
  });

  it('two retries of a failed row race like two claims: the loser buys nothing', async () => {
    row = { status: 'failed', numberE164: null };
    reclaim.mockResolvedValueOnce([]);

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({ kind: 'in_progress' });
    expect(purchase).not.toHaveBeenCalled();
  });
});

describe('an indeterminate purchase is HELD, never failed, and is adopted before any retry (CR-01)', () => {
  it.each([
    ['a client timeout', 'ETIMEDOUT', 'network_error'],
    ['a connection reset', 'ECONNRESET', 'network_error'],
    ['a provider 5xx', 'http_503', 'provider_unavailable'],
    ['an unknown throw', 'TypeError', 'sdk_error'],
  ])('%s keeps the row pending under the hold code — no fail, no second create', async (_l, reason, code) => {
    purchase.mockResolvedValueOnce({ ok: false, reason, determinate: false });

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toEqual({ kind: 'outcome_unknown', code });
    expect(hold).toHaveBeenCalledWith({ failureCode: 'outcome_unknown' });
    expect(fail).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(purchase).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(logged).toContain(`[telephony] provision outcome_unknown ${code}`);
  });

  it('the click after a timeout ADOPTS the number Twilio did buy — create runs once in total', async () => {
    purchase.mockResolvedValueOnce({ ok: false, reason: 'ETIMEDOUT', determinate: false });
    expect((await provisionDivertNumber(INPUT, deps())).kind).toBe('outcome_unknown');

    // The row as the hold left it; the account now shows the number.
    row = { status: 'pending', numberE164: null, failureCode: 'outcome_unknown', updatedAt: HELD_FRESH };
    listOwnedOnce({ ok: true, items: [{ sid: OTHER_PN_SID, phoneNumber: EARLIER_NUMBER, bundleSid: ENV.TWILIO_AU_BUNDLE_SID }] });
    calls = [];

    const retry = await provisionDivertNumber(INPUT, deps());

    expect(retry).toEqual({ kind: 'adopted', numberE164: EARLIER_NUMBER, bundleAttached: true });
    expect(calls).toEqual(['get', 'list', 'activate']);
    expect(purchase).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith({
      providerNumberSid: OTHER_PN_SID,
      numberE164: EARLIER_NUMBER,
      locality: null,
      purchasedAt: NOW,
      failureCode: null,
    });
  });

  it('a held row with NOTHING on the account inside the hold waits — no claim, no purchase', async () => {
    row = { status: 'pending', numberE164: null, failureCode: 'outcome_unknown', updatedAt: HELD_FRESH };

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({
      kind: 'outcome_unknown',
      code: 'outcome_unknown',
    });
    expect(calls).toEqual(['get', 'list']);
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a held row with nothing on the account AFTER the hold is re-claimed (guarded on age) and bought', async () => {
    row = { status: 'pending', numberE164: null, failureCode: 'outcome_unknown', updatedAt: HELD_STALE };

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result.kind).toBe('provisioned');
    expect(calls).toEqual(['get', 'list', 'reclaimStale', 'purchase', 'activate']);
    expect(reclaimStale).toHaveBeenCalledWith(INPUT.spokenName, new Date(NOW.getTime() - 10 * 60_000));
    expect(reclaim).not.toHaveBeenCalled();
  });

  it('a stale re-claim that loses the race buys nothing', async () => {
    row = { status: 'pending', numberE164: null, failureCode: 'outcome_unknown', updatedAt: HELD_STALE };
    reclaimStale.mockResolvedValueOnce([]);

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({ kind: 'in_progress' });
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a FAILED row whose number is on the account is adopted, not re-bought', async () => {
    row = { status: 'failed', numberE164: null, failureCode: 'provider_rejected' };
    listOwnedOnce({ ok: true, items: [{ sid: OTHER_PN_SID, phoneNumber: EARLIER_NUMBER, bundleSid: ENV.TWILIO_AU_BUNDLE_SID }] });

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({
      kind: 'adopted',
      numberE164: EARLIER_NUMBER,
      bundleAttached: true,
    });
    expect(reclaim).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
  });

  it('two numbers under one name: the first is adopted and the count is logged', async () => {
    row = { status: 'failed', numberE164: null };
    listOwnedOnce({
      ok: true,
      items: [
        { sid: OTHER_PN_SID, phoneNumber: EARLIER_NUMBER, bundleSid: ENV.TWILIO_AU_BUNDLE_SID },
        { sid: PN_SID, phoneNumber: NUMBER, bundleSid: ENV.TWILIO_AU_BUNDLE_SID },
      ],
    });

    expect((await provisionDivertNumber(INPUT, deps())).kind).toBe('adopted');
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(logged).toContain('[telephony] provision duplicate_numbers 2');
  });

  it('a lookup that fails buys NOTHING — a blind retry is the double purchase', async () => {
    row = { status: 'pending', numberE164: null, failureCode: 'outcome_unknown', updatedAt: HELD_STALE };
    listOwnedOnce({ ok: false, reason: 'http_503' });

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({ kind: 'lookup_failed', code: 'http_503' });
    expect(reclaimStale).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a held row can be searched again (tap one), and a plain pending row still cannot', async () => {
    row = { status: 'pending', numberE164: null, failureCode: 'outcome_unknown', updatedAt: HELD_FRESH };
    expect((await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps())).kind).toBe('candidate');

    row = { status: 'pending', numberE164: null, failureCode: null, updatedAt: HELD_FRESH };
    expect(await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps())).toEqual({ kind: 'in_progress' });
  });

  it('a fill whose guard matches NO row is the orphan path, not "provisioned" (IN-08)', async () => {
    activate.mockResolvedValueOnce([]);

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({ kind: 'orphaned_number', sid: PN_SID });
  });

  it('a first claim (no row) does not search the account — the claim is the guard', async () => {
    await provisionDivertNumber(INPUT, deps());

    expect(listOwned).not.toHaveBeenCalled();
  });
});

describe('a stale pending claim is recoverable through the same adopt-or-reclaim path (WR-07)', () => {
  it('a claim older than the hold, with nothing on the account, is re-claimed (guarded) and bought', async () => {
    row = { status: 'pending', numberE164: null, failureCode: null, updatedAt: HELD_STALE };

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result.kind).toBe('provisioned');
    expect(calls).toEqual(['get', 'list', 'reclaimStale', 'purchase', 'activate']);
    expect(reclaimStale).toHaveBeenCalledWith(INPUT.spokenName, new Date(NOW.getTime() - DIVERT_HOLD_MS));
  });

  it('a stale claim whose purchase DID go through is adopted — never bought twice', async () => {
    row = { status: 'pending', numberE164: null, failureCode: null, updatedAt: HELD_STALE };
    listOwnedOnce({ ok: true, items: [{ sid: OTHER_PN_SID, phoneNumber: EARLIER_NUMBER, bundleSid: ENV.TWILIO_AU_BUNDLE_SID }] });

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({
      kind: 'adopted',
      numberE164: EARLIER_NUMBER,
      bundleAttached: true,
    });
    expect(purchase).not.toHaveBeenCalled();
    expect(reclaimStale).not.toHaveBeenCalled();
  });

  it('a FRESH claim (inside the hold) is still a purchase in flight — nothing searched or bought', async () => {
    row = { status: 'pending', numberE164: null, failureCode: null, updatedAt: HELD_FRESH };

    expect(await provisionDivertNumber(INPUT, deps())).toEqual({ kind: 'in_progress' });
    expect(listOwned).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
  });

  it('tap one searches for a stale claim (so the operator can reach tap two)', async () => {
    row = { status: 'pending', numberE164: null, failureCode: null, updatedAt: HELD_STALE };

    expect((await findDivertNumberCandidate({ tenantId: TENANT_ID }, deps())).kind).toBe('candidate');
  });

  it('isRecoverablePending: held at any age, plain pending only past the hold, never another status', () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms);
    expect(isRecoverablePending({ status: 'pending', failureCode: 'outcome_unknown', updatedAt: NOW }, NOW)).toBe(true);
    expect(isRecoverablePending({ status: 'pending', failureCode: null, updatedAt: at(DIVERT_HOLD_MS - 1) }, NOW)).toBe(false);
    expect(isRecoverablePending({ status: 'pending', failureCode: null, updatedAt: at(DIVERT_HOLD_MS) }, NOW)).toBe(true);
    expect(isRecoverablePending({ status: 'failed', failureCode: null, updatedAt: at(DIVERT_HOLD_MS * 9) }, NOW)).toBe(false);
  });

  it("the console's stale threshold is the core's hold — one number, two spellings", () => {
    expect(DIVERT_STALE_CLAIM_MINUTES * 60_000).toBe(DIVERT_HOLD_MS);
  });
});

describe('the AU bundle is read back after purchase, attached if missing, and flagged if still missing (WR-09)', () => {
  it('create reports the bundle → no attach call, provisioned with bundleAttached', async () => {
    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toMatchObject({ kind: 'provisioned', bundleAttached: true });
    expect(attach).not.toHaveBeenCalled();
    expect(calls).toEqual(['get', 'claim', 'purchase', 'activate']);
  });

  it('create reports bundle_sid NULL (F-11-07-2) → attach by update, re-read, attached', async () => {
    purchase.mockImplementationOnce(async () => {
      calls.push('purchase');
      return { ok: true, sid: PN_SID, phoneNumber: NUMBER, bundleSid: null };
    });

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toMatchObject({ kind: 'provisioned', bundleAttached: true });
    expect(attach).toHaveBeenCalledWith({ creds: CREDS, sid: PN_SID, bundleSid: ENV.TWILIO_AU_BUNDLE_SID });
    expect(calls).toEqual(['get', 'claim', 'purchase', 'attach', 'activate']);
    expect(activate.mock.calls[0][0].failureCode).toBeNull();
  });

  it.each([
    ['the read-back still shows null', { ok: true, bundleSid: null }],
    ['the read-back shows ANOTHER bundle', { ok: true, bundleSid: 'BU' + 'f'.repeat(32) }],
    ['the attach call fails', { ok: false, reason: 'http_400' }],
  ])('%s → bundle_unattached logged with the PN sid and RECORDED on the row', async (_l, attached) => {
    purchase.mockResolvedValueOnce({ ok: true, sid: PN_SID, phoneNumber: NUMBER, bundleSid: null });
    attach.mockResolvedValueOnce(attached);

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toEqual({ kind: 'provisioned', numberE164: NUMBER, locality: 'Perth', bundleAttached: false });
    expect(activate.mock.calls[0][0].failureCode).toBe('bundle_unattached');
    expect(activate.mock.calls[0][0].failureCode).toMatch(/^[a-z_]{1,32}$/);
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(logged).toContain(`[telephony] provision bundle_unattached ${PN_SID}`);
  });

  it('an ADOPTED number without the bundle gets the same attach-and-read-back', async () => {
    row = { status: 'failed', numberE164: null };
    listOwnedOnce({ ok: true, items: [{ sid: OTHER_PN_SID, phoneNumber: EARLIER_NUMBER, bundleSid: null }] });

    const result = await provisionDivertNumber(INPUT, deps());

    expect(result).toEqual({ kind: 'adopted', numberE164: EARLIER_NUMBER, bundleAttached: true });
    expect(attach).toHaveBeenCalledWith({ creds: CREDS, sid: OTHER_PN_SID, bundleSid: ENV.TWILIO_AU_BUNDLE_SID });
    expect(calls).toEqual(['get', 'list', 'attach', 'activate']);
  });

  it('passes the bundle and address SIDs as REQUIRED values, never undefined', async () => {
    await provisionDivertNumber(INPUT, deps());

    const args = purchase.mock.calls[0][0] as Record<string, unknown>;
    expect(args.bundleSid).toBe(ENV.TWILIO_AU_BUNDLE_SID);
    expect(args.addressSid).toBe(ENV.TWILIO_AU_ADDRESS_SID);
  });
});

describe('failure codes are closed and fit the column', () => {
  it.each([
    ['http_400', 'provider_rejected'],
    ['http_401', 'provider_auth_refused'],
    ['http_404', 'number_not_found'],
    ['http_429', 'provider_rate_limited'],
    ['http_503', 'provider_unavailable'],
    ['ETIMEDOUT', 'network_error'],
    ['RestException', 'sdk_error'],
  ])('%s → %s', (reason, code) => {
    expect(divertFailureCode(reason)).toBe(code);
    expect(code).toMatch(/^[a-z_]{1,32}$/);
  });
});

describe('source pins', () => {
  const src = readFileSync('src/core/telephony/provision.ts', 'utf-8');

  it('takes the URLs from the ONE builder and spells no webhook path itself', () => {
    expect(src).toMatch(/import \{[^}]*twilioWebhookUrl[^}]*\} from '@\/core\/telephony\/webhook-url'/);
    expect(src).not.toContain('api/webhooks');
  });

  it('has no release, delete or number-resource call (D-08)', () => {
    expect(src).not.toMatch(/\.delete\(|\.remove\(|incomingPhoneNumbers\(/);
    expect(src).not.toMatch(/\brelease\w*\(/i);
  });

  it('takes the console host from the brand module', () => {
    expect(src).toMatch(/import \{ CONSOLE_HOST \} from '@\/core\/brand'/);
  });
});
