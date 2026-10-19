/**
 * The Resend domains boundary (MSG-02). PURE — the SDK is mocked, no network.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO PROPERTIES, AND NEITHER IS "THE HAPPY PATH WORKS".                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 1. THE REGION IS PASSED ON EVERY CREATE. Resend's default is `us-east-1`. A
 *    domain created without the explicit argument is a client's mail processed
 *    in Virginia while the settings page beside it says Tokyo — and nothing in
 *    the UI would ever show the difference, because the region is only ever read
 *    back from the domain we just created. This is the assertion that can fail
 *    on that, and it is asserted with `toBe` on the literal rather than
 *    "contains a region", because every value of that field is a plausible
 *    region.
 *
 * 2. THE DNS VALUES ARE BYTE-IDENTICAL. Same shape of assertion as the
 *    220-character SMS body in `clicksend-sender.test.ts`, for the same reason:
 *    a DKIM public key is ~400 characters of base64 and the operator copies it
 *    by hand. `toContain` or a length check would pass on a truncated key, and a
 *    truncated key is a domain that verifies nowhere and mail that lands in
 *    spam. Statuses, by contrast, ARE bounded here — they reach a comparison and
 *    a log line, and their enum-ness is the least-confident part of the research
 *    (the `codeOf` trade `clicksend-client.ts` makes).
 *
 * And the invariant underneath both: NOTHING THROWS. These are called from a
 * server action rendering a page whose entire purpose is to say what is wrong
 * with a domain; an exception there is a 500 on the diagnostic screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const list = vi.fn();
const get = vi.fn();
const verify = vi.fn();

/** Every key the module constructed a client with — see the T-4-27 assertion. */
const constructedWith: string[] = [];

/**
 * A CLASS, not an arrow function returning an object.
 *
 * `new (() => ({...}))()` throws `TypeError: not a constructor`, and this
 * module's own non-throwing contract would swallow that into
 * `{ok: false, reason: 'typeerror'}` — every test below would fail on the same
 * uninformative reason while proving nothing about the code.
 */
class FakeResend {
  readonly domains = { create, list, get, verify };

  constructor(apiKey: string) {
    constructedWith.push(apiKey);
  }
}

vi.mock('resend', () => ({ Resend: FakeResend }));

const { createDomain, domainOfAddress, EMAIL_DOMAIN_REGION, getDomain, listDomains, verifyDomain } =
  await import('@/core/messaging/resend-domains');

/**
 * A real-shaped DKIM value: long, base64, and the thing that must survive
 * untouched. Trimmed at either end, this key verifies nowhere.
 */
const DKIM_VALUE = `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC${'A1b2C3d4E5f6G7h8I9j0'.repeat(12)}wIDAQAB`;

const SPF_RECORD = {
  record: 'SPF',
  type: 'TXT',
  name: 'send.quotes.example.com.au',
  value: 'v=spf1 include:amazonses.com ~all',
  ttl: 'Auto',
  status: 'pending',
};

const DKIM_RECORD = {
  record: 'DKIM',
  type: 'CNAME',
  name: 'resend._domainkey',
  value: DKIM_VALUE,
  ttl: 'Auto',
  status: 'not_started',
};

const MX_RECORD = {
  record: 'SPF',
  type: 'MX',
  name: 'send',
  value: 'feedback-smtp.ap-northeast-1.amazonses.com',
  ttl: 'Auto',
  status: 'verified',
  priority: 10,
};

function createdDomain() {
  return {
    id: 'dom_abc123',
    name: 'quotes.example.com.au',
    status: 'not_started',
    created_at: '2026-08-29T02:00:00.000Z',
    region: 'ap-northeast-1',
    records: [SPF_RECORD, DKIM_RECORD, MX_RECORD],
  };
}

/** Resend's own error shape: a `name` (a code) and a `message` (prose). */
const RESEND_ERROR = {
  name: 'validation_error',
  message: 'The domain quotes.example.com.au is already registered to account acct_9f2b1',
};

beforeEach(() => {
  create.mockReset();
  list.mockReset();
  get.mockReset();
  verify.mockReset();
  constructedWith.length = 0;
});

describe('the API key never leaves the server module (T-4-27)', () => {
  it('is read from validated env at CALL time, not baked in at import', async () => {
    // Read per call rather than at module load for the same reason
    // `buildRoutingSender` re-reads config per tick: a missing or rotated key is
    // a deployment state that gets fixed, and a module-scope read would hold
    // whatever was true when the serverless instance cold-started.
    list.mockResolvedValue({ data: { object: 'list', has_more: false, data: [] }, error: null });

    await listDomains();
    await listDomains();

    expect(constructedWith).toHaveLength(2);
    expect(constructedWith[0]).toBe(process.env.RESEND_API_KEY);
    expect(constructedWith[0]).not.toBe('');
  });
});

describe('createDomain', () => {
  it('passes the ap-northeast-1 region EXPLICITLY', async () => {
    create.mockResolvedValue({ data: createdDomain(), error: null });

    await createDomain('quotes.example.com.au');

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0];
    expect(payload.name).toBe('quotes.example.com.au');
    // `toBe` on the literal: every other region string is also a valid region,
    // so nothing weaker can distinguish "we chose Tokyo" from "we chose".
    expect(payload.region).toBe('ap-northeast-1');
    expect(payload.region).toBe(EMAIL_DOMAIN_REGION);
  });

  it('returns the DNS records with values BYTE-IDENTICAL', async () => {
    create.mockResolvedValue({ data: createdDomain(), error: null });

    const result = await createDomain('quotes.example.com.au');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dkim = result.domain.records.find((record) => record.record === 'DKIM');
    // The whole key, not a prefix. A well-meaning display truncation added later
    // fails here rather than in a client's spam folder.
    expect(dkim?.value).toBe(DKIM_VALUE);
    expect(result.domain.records.map((record) => record.value)).toEqual([
      SPF_RECORD.value,
      DKIM_VALUE,
      MX_RECORD.value,
    ]);
  });

  it('carries type, name, ttl and priority through for the operator to paste', async () => {
    create.mockResolvedValue({ data: createdDomain(), error: null });

    const result = await createDomain('quotes.example.com.au');
    if (!result.ok) throw new Error('expected ok');

    expect(result.domain.records[0]).toEqual({
      record: 'SPF',
      type: 'TXT',
      name: 'send.quotes.example.com.au',
      value: 'v=spf1 include:amazonses.com ~all',
      ttl: 'Auto',
      status: 'pending',
      // Explicit null rather than absent: a TXT record carries no priority, and
      // an undefined would not survive the server-component boundary.
      priority: null,
    });
    expect(result.domain.records[2].priority).toBe(10);
  });

  it('reports an error by NAME and never carries the provider message', async () => {
    create.mockResolvedValue({ data: null, error: RESEND_ERROR });

    const result = await createDomain('quotes.example.com.au');

    expect(result).toEqual({ ok: false, reason: 'validation_error' });
    // The message names another ACCOUNT id. `name`-only is not stylistic here.
    expect(JSON.stringify(result)).not.toContain('acct_9f2b1');
    expect(JSON.stringify(result)).not.toContain(RESEND_ERROR.message);
  });

  it('does not throw when the SDK does', async () => {
    create.mockRejectedValue(new TypeError('fetch failed: ENOTFOUND api.resend.com'));

    const result = await createDomain('quotes.example.com.au');

    expect(result).toEqual({ ok: false, reason: 'typeerror' });
    // The host, and anything else the message named, stays out of the result.
    expect(JSON.stringify(result)).not.toContain('api.resend.com');
  });

  it('treats a 200 with no body as a failure, not as an empty domain', async () => {
    // `{ok: true, domain: undefined}` would render as a domain with no records
    // and no status — indistinguishable on screen from a domain that needs no
    // DNS, which does not exist.
    create.mockResolvedValue({ data: null, error: null });

    expect(await createDomain('quotes.example.com.au')).toEqual({
      ok: false,
      reason: 'empty_response',
    });
  });
});

describe('listDomains', () => {
  it('maps the account list and bounds each status to a code', async () => {
    list.mockResolvedValue({
      data: {
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'dom_abc123',
            name: 'quotes.example.com.au',
            status: 'Verified',
            region: 'ap-northeast-1',
            created_at: '2026-08-29T02:00:00.000Z',
          },
          {
            id: 'dom_def456',
            name: 'mail.other.com.au',
            // Prose where an enum was documented — the case `codeOf` exists for.
            status: 'Pending: awaiting DNS propagation for user dana@other.com.au',
            region: 'us-east-1',
            created_at: null,
          },
        ],
      },
      error: null,
    });

    const result = await listDomains();
    if (!result.ok) throw new Error('expected ok');

    // Lowercased so `status === VERIFIED_STATUS` is a comparison against one
    // spelling, not against a third party's capitalisation.
    expect(result.domains[0]).toEqual({
      id: 'dom_abc123',
      name: 'quotes.example.com.au',
      status: 'verified',
      region: 'ap-northeast-1',
      createdAt: '2026-08-29T02:00:00.000Z',
    });

    // Bounded: the address in that status string cannot reach a log line whole.
    expect(result.domains[1].status.length).toBeLessThanOrEqual(48);
    expect(result.domains[1].status).not.toContain('dana@other.com.au');
    expect(result.domains[1].createdAt).toBeNull();
  });

  it('returns an empty list rather than failing when the account has no domains', async () => {
    list.mockResolvedValue({ data: { object: 'list', has_more: false, data: [] }, error: null });

    expect(await listDomains()).toEqual({ ok: true, domains: [] });
  });

  it('reports an error by name and does not throw', async () => {
    list.mockResolvedValue({ data: null, error: { name: 'missing_api_key', message: 'no key' } });
    expect(await listDomains()).toEqual({ ok: false, reason: 'missing_api_key' });

    list.mockRejectedValue(new Error('boom'));
    expect(await listDomains()).toEqual({ ok: false, reason: 'error' });
  });
});

describe('getDomain', () => {
  it('returns the domain WITH its records — the read the DNS table needs', async () => {
    get.mockResolvedValue({
      data: { ...createdDomain(), object: 'domain', status: 'pending' },
      error: null,
    });

    const result = await getDomain('dom_abc123');
    if (!result.ok) throw new Error('expected ok');

    expect(get).toHaveBeenCalledWith('dom_abc123');
    expect(result.domain.status).toBe('pending');
    expect(result.domain.records).toHaveLength(3);
    expect(result.domain.records[1].value).toBe(DKIM_VALUE);
  });

  it('reports an error by name and does not throw', async () => {
    get.mockResolvedValue({ data: null, error: { name: 'not_found', message: 'no such domain' } });
    expect(await getDomain('dom_missing')).toEqual({ ok: false, reason: 'not_found' });

    get.mockRejectedValue(new Error('boom'));
    expect(await getDomain('dom_abc123')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('verifyDomain', () => {
  it('returns ONLY the id — verification is asynchronous', async () => {
    verify.mockResolvedValue({ data: { id: 'dom_abc123', object: 'domain' }, error: null });

    const result = await verifyDomain('dom_abc123');

    expect(verify).toHaveBeenCalledWith('dom_abc123');
    // No status field to mistake for an answer: a 200 here means "we will
    // look", and the caller must re-read the domain to learn the outcome.
    expect(result).toEqual({ ok: true, id: 'dom_abc123' });
  });

  it('reports an error by name and does not throw', async () => {
    verify.mockResolvedValue({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'too many requests from 10.1.2.3' },
    });
    expect(await verifyDomain('dom_abc123')).toEqual({
      ok: false,
      reason: 'rate_limit_exceeded',
    });

    verify.mockRejectedValue(new Error('boom'));
    expect(await verifyDomain('dom_abc123')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('domainOfAddress — the one spelling of "the domain part"', () => {
  it.each([
    ['quotes@example.com.au', 'example.com.au'],
    ['  Quotes@Example.Com.AU  ', 'example.com.au'],
    ['dave+jobs@daveplumbing.com.au', 'daveplumbing.com.au'],
  ])('%s → %s', (address, expected) => {
    expect(domainOfAddress(address)).toBe(expected);
  });

  it.each([
    ['no at sign', 'example.com.au'],
    ['two at signs', 'a@b@example.com.au'],
    ['no local part', '@example.com.au'],
    ['no domain', 'quotes@'],
    ['no dot in the domain', 'quotes@localhost'],
    ['empty', ''],
  ])('refuses %s', (_label, address) => {
    // `null`, not a best guess. This value decides whether a from-address is on
    // a verified domain, and a guess there is an unverified send.
    expect(domainOfAddress(address)).toBeNull();
  });
});
