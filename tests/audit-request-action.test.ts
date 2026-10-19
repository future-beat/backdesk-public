/**
 * The public audit action, at the boundary (Phase 9, LAND-02/LAND-03, D-13).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ORDER IS THE GUARANTEE. The row is written BEFORE either             │
 * │ notification is attempted, and no notification failure can un-write it.  │
 * │ A prospect who filled in a form on a phone must never be asked to do it  │
 * │ again because Resend was having an afternoon (D-13).                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Also asserted here, because this is the only place they can be: nothing is
 * written when validation fails (T-9-02 — a hostile submitter cannot make us
 * send email by failing), the page never reads a caught error (T-9-05), and
 * every repository function the action reaches arrives through the single
 * barrel import, all of them tenant-less (T-9-12).
 *
 * PURE. The repository, both senders, and the three `next/*` modules are
 * mocked; `redirect` records rather than throws, so the assertions can inspect
 * what happened after it.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const REQUEST_ID = '2f1c8f8e-0000-4000-8000-000000000000';

const createAuditRequest = vi.fn(async () => ({ id: REQUEST_ID }));
const recordAuditRequestNotify = vi.fn(async () => undefined);
const attachAuditRequestCsv = vi.fn(async () => undefined);
const putAuditUpload = vi.fn(async () => ({ ok: true }));
const bumpAuditRequestThrottle = vi.fn(async () => 1);
const sendOperatorAlert = vi.fn(async () => ({ ok: true, id: 'email_1' }));
const sendOperatorSms = vi.fn(async () => ({ ok: true }));
const redirect = vi.fn();
const revalidatePath = vi.fn();
const userAgent = { value: 'Mozilla/5.0 (iPhone)' as string | null };
/** What `x-forwarded-for` carries. `null` is local dev and every unit test by default. */
const forwardedFor = { value: null as string | null };

vi.mock('@/db/repository', () => ({
  createAuditRequest: (...args: unknown[]) => createAuditRequest(...(args as [])),
  recordAuditRequestNotify: (...args: unknown[]) => recordAuditRequestNotify(...(args as [])),
  attachAuditRequestCsv: (...args: unknown[]) => attachAuditRequestCsv(...(args as [])),
  putAuditUpload: (...args: unknown[]) => putAuditUpload(...(args as [])),
  bumpAuditRequestThrottle: (...args: unknown[]) => bumpAuditRequestThrottle(...(args as [])),
}));
vi.mock('@/core/alerts/operator-email', () => ({
  sendOperatorAlert: (...args: unknown[]) => sendOperatorAlert(...(args as [])),
}));
vi.mock('@/core/alerts/operator-sms', () => ({
  sendOperatorSms: (...args: unknown[]) => sendOperatorSms(...(args as [])),
  auditRequestSmsBody: (input: { businessName: string }) => `sms:${input.businessName}`,
}));
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => {
      if (name === 'user-agent') return userAgent.value;
      if (name === 'x-forwarded-for') return forwardedFor.value;
      return null;
    },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { requestAuditAction } = await import('../src/app/(marketing)/audit/actions');
const { AUDIT_FORM_COPY } = await import('../src/app/(marketing)/copy');
const { BLANK_AUDIT_REQUEST_STATE } = await import(
  '../src/app/(marketing)/audit/action-state'
);

const ACTION_SOURCE = readFileSync('src/app/(marketing)/audit/actions.ts', 'utf8');

function form(overrides: Record<string, string> = {}, file?: File): FormData {
  const data = new FormData();
  const values: Record<string, string> = {
    business_name: 'Northbridge Electrical',
    contact_name: 'Dave Rowley',
    phone: '0412 345 678',
    email: 'Dave@Example.COM ',
    trade: 'electrical',
    servicem8: 'yes',
    quotes_per_month: '8_15',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  if (file) data.set('csv_file', file);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  createAuditRequest.mockResolvedValue({ id: REQUEST_ID });
  sendOperatorAlert.mockResolvedValue({ ok: true, id: 'email_1' });
  sendOperatorSms.mockResolvedValue({ ok: true });
  recordAuditRequestNotify.mockResolvedValue(undefined);
  attachAuditRequestCsv.mockResolvedValue(undefined);
  putAuditUpload.mockResolvedValue({ ok: true });
  bumpAuditRequestThrottle.mockResolvedValue(1);
  userAgent.value = 'Mozilla/5.0 (iPhone)';
  forwardedFor.value = null;
});

/** A believable Job List export, small enough to live in a test. */
function csv(
  name = 'Job List (Aug).csv',
  type = 'text/csv',
  body = 'Job,Client,Status\r\n1,Bob,Quote\r\n',
): File {
  return new File([body], name, { type });
}

describe('a valid submission: one row, two notifications, one redirect', () => {
  it('inserts the NORMALISED values exactly once', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(createAuditRequest).toHaveBeenCalledTimes(1);
    expect(createAuditRequest).toHaveBeenCalledWith({
      businessName: 'Northbridge Electrical',
      contactName: 'Dave Rowley',
      // E.164 and lowercased — the schema's transforms, not the form's strings.
      phone: '+61412345678',
      email: 'dave@example.com',
      trade: 'electrical',
      servicem8User: true,
      quotesBand: '8_15',
      // The salted hash and the throttle it keys are 09-03's; until then the
      // column that would hold an address is not written with one.
      ipHash: null,
      userAgent: 'Mozilla/5.0 (iPhone)',
      // Where it came from (19 Sep 2026). This `form()` carries no hidden
      // arrival fields, which is the ordinary state — an outreach email stays
      // link-free because Gmail rewrites every link, and a JS-disabled browser
      // never ran the capture. All four arrive as an explicit null rather than
      // as absent keys, so the row states "nothing recorded" instead of
      // leaving the columns to a default.
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      referrerHost: null,
    });
  });

  it('emails and texts the operator, then records both outcomes as sent', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(sendOperatorAlert).toHaveBeenCalledTimes(1);
    expect(sendOperatorAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'audit_request',
        requestId: REQUEST_ID,
        businessName: 'Northbridge Electrical',
        // HUMAN LABELS, resolved from the closed vocabularies here so the
        // email, the SMS and the console cannot spell a trade three ways.
        trade: 'Electrical',
        quotesBand: '8–15',
        servicem8: true,
        hasCsv: false,
      }),
    );
    expect(sendOperatorSms).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      body: 'sms:Northbridge Electrical',
    });

    expect(recordAuditRequestNotify).toHaveBeenCalledWith(REQUEST_ID, {
      email: 'sent',
      sms: 'sent',
      detail: null,
    });
  });

  it('revalidates the console list and redirects to the confirmation', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(revalidatePath).toHaveBeenCalledWith('/audits/requests');
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });

  it('writes the row BEFORE it attempts either notification', async () => {
    const order: string[] = [];
    createAuditRequest.mockImplementationOnce(async () => {
      order.push('insert');
      return { id: REQUEST_ID };
    });
    sendOperatorAlert.mockImplementationOnce(async () => {
      order.push('email');
      return { ok: true, id: 'email_1' };
    });
    sendOperatorSms.mockImplementationOnce(async () => {
      order.push('sms');
      return { ok: true };
    });
    recordAuditRequestNotify.mockImplementationOnce(async () => {
      order.push('record');
    });

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(order[0]).toBe('insert');
    expect(order[order.length - 1]).toBe('record');
  });
});

describe('a notification failure costs the operator a late reply, never the request', () => {
  it('records failed with the CODE and still redirects', async () => {
    sendOperatorSms.mockResolvedValueOnce({
      ok: false,
      kind: 'send_failed',
      detail: 'http_429',
    } as never);

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(recordAuditRequestNotify).toHaveBeenCalledWith(REQUEST_ID, {
      email: 'sent',
      sms: 'failed',
      detail: 'http_429',
    });
    // The prospect sees the confirmation. They are not told, and must not be
    // told, that the operator's phone did not buzz — their request is stored.
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });

  it('distinguishes a deployment problem from a provider one', async () => {
    sendOperatorAlert.mockResolvedValueOnce({
      ok: false,
      kind: 'not_configured',
      detail: 'operator alert environment is invalid or missing',
    } as never);

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(recordAuditRequestNotify).toHaveBeenCalledWith(
      REQUEST_ID,
      expect.objectContaining({ email: 'not_configured', sms: 'sent' }),
    );
  });

  it('survives a sender that throws, recording the error NAME only', async () => {
    sendOperatorSms.mockRejectedValueOnce(new TypeError('fetch failed for +61491578888'));

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(recordAuditRequestNotify).toHaveBeenCalledWith(
      REQUEST_ID,
      expect.objectContaining({ sms: 'failed', detail: 'TypeError' }),
    );
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });
});

describe('an invalid submission writes nothing and notifies nobody (T-9-02)', () => {
  it('returns every failing field and echoes the input back', async () => {
    const state = await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({ business_name: '   ', phone: '12345', trade: '' }),
    );

    expect(createAuditRequest).not.toHaveBeenCalled();
    expect(sendOperatorAlert).not.toHaveBeenCalled();
    expect(sendOperatorSms).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();

    expect(state.errors).toEqual({
      business_name: 'Enter your business name.',
      phone: 'Enter an Australian mobile number, like 0412 345 678.',
      trade: 'Choose the closest trade.',
    });
    expect(state.formError).toBeNull();
    // The typing survives — on a phone, that is the difference between a second
    // attempt and an abandoned one.
    expect(state.values).toEqual({
      business_name: '   ',
      contact_name: 'Dave Rowley',
      phone: '12345',
      email: 'Dave@Example.COM ',
      trade: '',
      servicem8: 'yes',
      quotes_per_month: '8_15',
    });
  });
});

describe('a failed insert is a fixed sentence, never a driver message (T-9-05)', () => {
  it('returns the UI-SPEC server-error copy and sends nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createAuditRequest.mockRejectedValueOnce(
      new Error('insert into audit_requests ... dave@example.com'),
    );

    const state = await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(state.formError).toBe(AUDIT_FORM_COPY.serverError);
    expect(state.errors).toEqual({});
    expect(sendOperatorAlert).not.toHaveBeenCalled();
    expect(sendOperatorSms).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();

    // The NAME only. A driver's message carries the failing statement, and the
    // statement carries every value in the form.
    const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('[audit-request] insert failed: Error');
    expect(logged).not.toContain('dave@example.com');
    spy.mockRestore();
  });
});

describe('the action reaches nothing it should not (T-9-12)', () => {
  it('imports the repository through the barrel and never the tenant closure', () => {
    expect(ACTION_SOURCE.match(/from '@\/db\/repository'/g)).toHaveLength(1);
    expect(ACTION_SOURCE).not.toMatch(/forTenant|createProspect/);
  });

  it('fans the two senders out with allSettled, so neither can block the other', () => {
    expect(ACTION_SOURCE).toContain('Promise.allSettled');
  });
});

/**
 * The optional Job List export (LAND-02, D-10, T-9-04/T-9-06).
 *
 * The whole point of the ordering below: a WRONG file costs a sentence and no
 * row, while a STORAGE FAILURE costs the attachment and keeps the row. Those
 * are different failures with different prices, and getting them the wrong way
 * round means either a lost request or a promise of a file nobody has.
 */
describe('an attached export lands privately, and its failure is survivable', () => {
  it('uploads under {requestId}/{sanitised name} and records it on the row', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({}, csv()));

    expect(putAuditUpload).toHaveBeenCalledTimes(1);
    const [path, bytes] = putAuditUpload.mock.calls[0] as unknown as [string, Uint8Array];
    // The uuid is this bucket's tenant boundary: two prospects' exports cannot
    // collide, and neither can name a path into the other's.
    expect(path).toBe(`${REQUEST_ID}/Job_List__Aug_.csv`);
    expect(bytes).toBeInstanceOf(Uint8Array);

    expect(attachAuditRequestCsv).toHaveBeenCalledWith(REQUEST_ID, {
      objectPath: `${REQUEST_ID}/Job_List__Aug_.csv`,
      filename: 'Job_List__Aug_.csv',
      bytes: expect.any(Number),
    });
    expect(sendOperatorAlert).toHaveBeenCalledWith(expect.objectContaining({ hasCsv: true }));
  });

  it('writes the row BEFORE it uploads, so Storage cannot cost the request', async () => {
    const order: string[] = [];
    createAuditRequest.mockImplementationOnce(async () => {
      order.push('insert');
      return { id: REQUEST_ID };
    });
    putAuditUpload.mockImplementationOnce(async () => {
      order.push('upload');
      return { ok: true };
    });

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({}, csv()));

    expect(order).toEqual(['insert', 'upload']);
  });

  it('survives a failed upload: the request stands, hasCsv is false, the NAME is logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    putAuditUpload.mockResolvedValueOnce({ ok: false, detail: 'StorageApiError' } as never);

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({}, csv()));

    expect(createAuditRequest).toHaveBeenCalledTimes(1);
    // The row must NOT claim a file that is not there — the console would show
    // a download button for an object the bucket does not hold.
    expect(attachAuditRequestCsv).not.toHaveBeenCalled();
    expect(sendOperatorAlert).toHaveBeenCalledWith(expect.objectContaining({ hasCsv: false }));
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');

    const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('[audit-request] upload failed: StorageApiError');
    // Never the object key: it carries the prospect's own filename.
    expect(logged).not.toContain('Job_List');
    spy.mockRestore();
  });

  it('refuses a non-CSV with the locked sentence and writes NOTHING', async () => {
    const state = await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({}, csv('quotes.xlsx', 'application/vnd.ms-excel')),
    );

    expect(state.errors.csv_file).toBe(AUDIT_FORM_COPY.csvErrors.type);
    expect(createAuditRequest).not.toHaveBeenCalled();
    expect(putAuditUpload).not.toHaveBeenCalled();
    expect(sendOperatorAlert).not.toHaveBeenCalled();
    // The typing survives the rejection; only the file has to be re-attached.
    expect(state.values.business_name).toBe('Northbridge Electrical');
  });

  it('refuses an oversized file with the SIZE sentence', async () => {
    const big = csv('jobs.csv', 'text/csv', `Job,Client\n${'x'.repeat(4 * 1024 * 1024)}`);

    const state = await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({}, big));

    expect(state.errors.csv_file).toBe(AUDIT_FORM_COPY.csvErrors.size);
    expect(createAuditRequest).not.toHaveBeenCalled();
  });

  /**
   * G-09-1, from the phone on 2026-09-10: every submission that LEFT THE
   * OPTIONAL FIELD OPTIONAL was refused with the not-a-CSV sentence.
   *
   * The cases above and below this pair could not catch it, because the helper
   * only sets `csv_file` when a file is passed — i.e. it modelled the field as
   * ABSENT, which is what a `fetch` with a hand-built FormData does and what a
   * browser never does. A browser sends the part regardless: `filename=""`,
   * zero bytes. The two shapes below are the two ways a runtime hands that part
   * back, and both must read as "no attachment".
   */
  it('treats a browser\'s empty file part as no attachment, not as a bad one', async () => {
    const state = await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({}, new File([], '', { type: 'application/octet-stream' })),
    );

    // NO STATE IS THE PROOF: the action returns a state only to re-render a
    // refusal, and reaches `redirect` (mocked, so it returns) on success. An
    // `errors.csv_file` sentence and a written row are mutually exclusive here.
    expect(state).toBeUndefined();
    expect(createAuditRequest).toHaveBeenCalledTimes(1);
    expect(putAuditUpload).not.toHaveBeenCalled();
    expect(attachAuditRequestCsv).not.toHaveBeenCalled();
    expect(sendOperatorAlert).toHaveBeenCalledWith(expect.objectContaining({ hasCsv: false }));
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });

  it('does the same when the runtime NAMES that empty part (blob, undefined)', async () => {
    const state = await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({}, new File([], 'blob')),
    );

    // The name is the half that lies; the zero bytes are the half that does not.
    expect(state).toBeUndefined();
    expect(createAuditRequest).toHaveBeenCalledTimes(1);
    expect(putAuditUpload).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });

  it('leaves the whole upload path untouched when nothing is attached', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(putAuditUpload).not.toHaveBeenCalled();
    expect(attachAuditRequestCsv).not.toHaveBeenCalled();
    expect(sendOperatorAlert).toHaveBeenCalledWith(expect.objectContaining({ hasCsv: false }));
  });
});

/**
 * The decoy (D-12, T-9-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A HONEYPOT HIT MUST BE INDISTINGUISHABLE FROM A SUCCESS. If a bot can    │
 * │ tell that filling `website` is what got it refused, the operator of that │
 * │ bot stops filling it — and the control is worth nothing from then on.    │
 * │ Same redirect, no row, no bump, no notification, and no log line.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
describe('a filled decoy is silently thanked and nothing happens', () => {
  it('redirects exactly as a success does, having written nothing', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({ website: 'http://spam.example' }));

    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
    expect(createAuditRequest).not.toHaveBeenCalled();
    expect(bumpAuditRequestThrottle).not.toHaveBeenCalled();
    expect(sendOperatorAlert).not.toHaveBeenCalled();
    expect(sendOperatorSms).not.toHaveBeenCalled();
    expect(putAuditUpload).not.toHaveBeenCalled();
  });

  /**
   * The decoy is checked BEFORE zod, so a bot that fills the decoy AND botches
   * the phone number gets the same silent thanks — never a field error that
   * would tell it which of its answers the server disliked.
   */
  it('exits before validation, so a bot learns nothing from a bad field', async () => {
    // Three failing fields, and the answer is still the confirmation: the decoy
    // is read before zod, so nothing about which answers were wrong leaks back.
    await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({ website: 'x', phone: 'nonsense', business_name: '' }),
    );

    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
    expect(createAuditRequest).not.toHaveBeenCalled();
  });

  it('logs nothing at all on the decoy path (T-9-05)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({ website: 'x' }));

    expect(spy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });

  it('treats an empty decoy as what it is: a human who never saw the field', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({ website: '' }));

    expect(createAuditRequest).toHaveBeenCalledTimes(1);
  });
});

describe('the per-IP throttle, counted before the row is written (LAND-03)', () => {
  it('hashes the first x-forwarded-for value and bumps that bucket', async () => {
    forwardedFor.value = '203.0.113.9, 10.0.0.1';

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(bumpAuditRequestThrottle).toHaveBeenCalledTimes(1);
    const [hash] = bumpAuditRequestThrottle.mock.calls[0] as unknown as [string];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // The SAME hash reaches the row, so the counter and the record agree.
    expect(createAuditRequest).toHaveBeenCalledWith(expect.objectContaining({ ipHash: hash }));
  });

  it('refuses the sixth with the locked sentence, over a 200 re-render', async () => {
    forwardedFor.value = '203.0.113.9';
    bumpAuditRequestThrottle.mockResolvedValueOnce(6);

    const state = await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(state.formError).toBe(AUDIT_FORM_COPY.rateLimited);
    expect(state.errors).toEqual({});
    // The typing survives: the sentence names a way forward and this is a
    // person who may well be a real prospect on a shared office connection.
    expect(state.values.business_name).toBe('Northbridge Electrical');

    expect(createAuditRequest).not.toHaveBeenCalled();
    expect(sendOperatorAlert).not.toHaveBeenCalled();
    expect(sendOperatorSms).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('accepts the fifth', async () => {
    forwardedFor.value = '203.0.113.9';
    bumpAuditRequestThrottle.mockResolvedValueOnce(5);

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(createAuditRequest).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });

  /**
   * A refused attempt STILL COUNTS, which is only true because the bump happens
   * before the decision. Bumping afterwards would let a submitter sit at the
   * limit forever, refused and never counted.
   */
  it('bumps before the insert, and before the decision that refuses', async () => {
    forwardedFor.value = '203.0.113.9';
    const order: string[] = [];
    bumpAuditRequestThrottle.mockImplementationOnce(async () => {
      order.push('bump');
      return 1;
    });
    createAuditRequest.mockImplementationOnce(async () => {
      order.push('insert');
      return { id: REQUEST_ID };
    });

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(order).toEqual(['bump', 'insert']);
  });

  /**
   * No address, no bucket. A fabricated placeholder would collide every
   * server-side and local-development submission into one counter.
   */
  it('does not throttle a request with no client address', async () => {
    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(bumpAuditRequestThrottle).not.toHaveBeenCalled();
    expect(createAuditRequest).toHaveBeenCalledWith(expect.objectContaining({ ipHash: null }));
  });

  /**
   * T-9-22. A counter that is DOWN must not become a counter that is OFF: the
   * failure mode of "carry on and write anyway" is unbounded writes and
   * unbounded operator notifications during exactly the outage nobody is
   * watching. Treated like a failed insert — fixed sentence, nothing written.
   */
  it('refuses to write at all when the counter itself is unavailable', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    forwardedFor.value = '203.0.113.9';
    bumpAuditRequestThrottle.mockRejectedValueOnce(
      new Error('connect ETIMEDOUT db.example:6543'),
    );

    const state = await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    expect(state.formError).toBe(AUDIT_FORM_COPY.serverError);
    expect(createAuditRequest).not.toHaveBeenCalled();
    expect(sendOperatorAlert).not.toHaveBeenCalled();

    const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('[audit-request] throttle failed: Error');
    expect(logged).not.toContain('db.example');
    spy.mockRestore();
  });

  it('never lets the raw address reach the row or the log (T-9-05)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    forwardedFor.value = '203.0.113.9';

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form());

    const [[created]] = createAuditRequest.mock.calls as unknown as [[{ ipHash: string }]];
    expect(created.ipHash).not.toContain('203.0.113.9');
    expect(spy.mock.calls.map(String).join('\n')).not.toContain('203.0.113.9');
    spy.mockRestore();
  });
});

describe('the whole order, proven by call sequence (D-12/D-13)', () => {
  it('runs decoy → zod → bump → insert → upload → notify', async () => {
    forwardedFor.value = '203.0.113.9';
    const order: string[] = [];
    bumpAuditRequestThrottle.mockImplementationOnce(async () => {
      order.push('bump');
      return 1;
    });
    createAuditRequest.mockImplementationOnce(async () => {
      order.push('insert');
      return { id: REQUEST_ID };
    });
    putAuditUpload.mockImplementationOnce(async () => {
      order.push('upload');
      return { ok: true };
    });
    sendOperatorAlert.mockImplementationOnce(async () => {
      order.push('notify');
      return { ok: true, id: 'email_1' };
    });

    await requestAuditAction(BLANK_AUDIT_REQUEST_STATE, form({}, csv()));

    expect(order).toEqual(['bump', 'insert', 'upload', 'notify']);
  });

  /** Source-level, because a comment is not a guarantee but an order is. */
  it('reads the decoy before it validates, and bumps before it inserts', () => {
    const decoy = ACTION_SOURCE.indexOf("readString(formData, 'website')");
    const zod = ACTION_SOURCE.indexOf('auditRequestSchema.safeParse');
    const bump = ACTION_SOURCE.indexOf('bumpAuditRequestThrottle(');
    const insert = ACTION_SOURCE.indexOf('createAuditRequest(');

    expect(decoy).toBeGreaterThan(-1);
    expect(decoy).toBeLessThan(zod);
    expect(zod).toBeLessThan(bump);
    expect(bump).toBeLessThan(insert);
  });
});

/* ------------------------------------------------------------------------- *
 * WHERE THE REQUEST CAME FROM (Cowork build request "Phase 11", 19 Sep 2026)
 *
 * The parser itself is exercised exhaustively in `tests/arrival-source.test.ts`.
 * What can only be asserted HERE is what the ACTION does with it: that the
 * values reach the row, that rubbish reaches it as null rather than as a
 * refusal, and — the prohibition that matters most — that nothing about these
 * four fields can change whether a submission succeeds (LAND-03).
 * ------------------------------------------------------------------------- */

describe('the arrival source reaches the row, and can never refuse a submission', () => {
  it('stores the four values a tagged link produces', async () => {
    await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({
        utm_source: 'GBP',
        utm_medium: 'organic',
        utm_campaign: 'booking',
        referrer_host: 'www.google.com',
      }),
    );

    expect(createAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        // Lower-cased at the boundary, so `GBP` and `gbp` are one channel in the
        // console rather than two rows of the same thing.
        utmSource: 'gbp',
        utmMedium: 'organic',
        utmCampaign: 'booking',
        referrerHost: 'www.google.com',
      }),
    );
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });

  it('stores NULL for a hostile value and still writes the row', async () => {
    // The whole point. A stranger controls these strings, they are not
    // something the submitter typed, and the submitter cannot see them — so a
    // rejection would be the form refusing a request over a value its reader
    // never chose. Each field falls independently: `organic` survives beside a
    // refused source.
    await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({
        utm_source: '<script>alert(1)</script>',
        utm_medium: 'organic',
        utm_campaign: 'a'.repeat(65),
        referrer_host: 'evil.example.com:8080/path',
      }),
    );

    expect(createAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        utmSource: null,
        utmMedium: 'organic',
        utmCampaign: null,
        referrerHost: null,
      }),
    );
    // Written, notified and redirected exactly as any other submission.
    expect(createAuditRequest).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
  });

  it('adds no field error, for any value at all', async () => {
    // A REFUSAL IS A RETURNED STATE; a success redirects and returns nothing
    // (the action ends in `redirect`, which is mocked here to record rather
    // than throw). So "the state is undefined" IS the assertion that these four
    // fields produced no error — a returned object would be the form refusing a
    // submission over a value its reader never chose.
    const state = await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({ utm_source: '!!!', utm_medium: ' ', referrer_host: 'https://x.test' }),
    );

    expect(state).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith('/audit/thanks');
    expect(createAuditRequest).toHaveBeenCalledTimes(1);
  });

  it('drops a referrer that is one of OUR hosts, on the server too', async () => {
    // The capture component already refuses to store our own hosts; this is the
    // second reading, because the stored record travels back through a form
    // field a stranger can rewrite. Attributing every request to the site it
    // was made on is the one answer that is never useful.
    await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({ referrer_host: 'backdesk.com.au' }),
    );

    expect(createAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ referrerHost: null }),
    );
  });

  it('parses AFTER validation and BEFORE the insert, and nowhere near the decoy', () => {
    // Order, at source. Reading these before zod would mean work done for a
    // submission that is about to be refused; reading them after the insert
    // would mean the row exists without them.
    const zod = ACTION_SOURCE.indexOf('auditRequestSchema.safeParse');
    const arrival = ACTION_SOURCE.indexOf('parseArrivalSource(');
    const insert = ACTION_SOURCE.indexOf('createAuditRequest(');

    expect(arrival).toBeGreaterThan(zod);
    expect(arrival).toBeLessThan(insert);
  });

  it('leaves the operator SMS untouched (LAND-03)', async () => {
    // One pinned segment. The arrival source is a console fact, not a
    // notification fact, and a body that grew by a channel name would push the
    // callback number out of the visible part of a lock-screen notification.
    await requestAuditAction(
      BLANK_AUDIT_REQUEST_STATE,
      form({ utm_source: 'facebook', utm_medium: 'social' }),
    );

    expect(sendOperatorSms).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      body: 'sms:Northbridge Electrical',
    });
    expect(sendOperatorAlert).toHaveBeenCalledWith(
      expect.not.objectContaining({ utmSource: 'facebook' }),
    );
  });
});
