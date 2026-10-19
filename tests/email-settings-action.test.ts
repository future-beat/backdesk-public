/**
 * T-4-26: email cannot be switched on for a domain nobody has verified — and the
 * check is SERVER-SIDE, not a filtered `<select>`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY AN UNVERIFIED SEND IS A SILENT FAILURE, WHICH IS THE WORST KIND.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Mail sent from a domain without aligned SPF/DKIM is rejected or spam-foldered
 * by the RECEIVING side. Nothing in this system sees that happen: Resend accepts
 * the send, the ledger records `sent`, and the observable symptom is a client's
 * follow-ups quietly not landing — attributed to "email doesn't work" rather
 * than to a config row saved a week too early. So the refusal has to happen
 * before the row is written, and it has to happen in the action, whose id is
 * global and whose body is the caller's.
 *
 * PURE: the Resend wrapper's network calls, the repository and `next/cache` are
 * mocked. `requireOperator()` is NOT — Supabase's client is mocked one level
 * below it, so the real gate runs against a fake session. And no test here
 * writes a `messaging_config` row anywhere: an ENABLED row on the hosted
 * database is, by D-04's own design, the switch that arms real client messaging
 * with no deploy, and 04-03 established that such a row must never be a test's
 * to leave behind.
 *
 * Sibling suite: tests/resend-domains.test.ts covers the wrapper this consumes.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListDomainsResult } from '@/core/messaging/resend-domains';

type DomainVerdict =
  | { kind: 'verified'; domain: string }
  | { kind: 'unverified'; domain: string }
  | { kind: 'invalid_address' }
  | { kind: 'unknown'; reason: string };

const upsertChannelConfig = vi.fn(async (row: unknown) => row);
const getChannelConfig =
  vi.fn<
    (
      channel: string,
      tenantId?: string | null,
    ) => Promise<{ tenantId: string | null; enabled: boolean } | null>
  >();
const createDomain = vi.fn();
const verifyDomain = vi.fn();
const listDomains = vi.fn<() => Promise<ListDomainsResult>>();
const isSendingDomainVerified = vi.fn<(address: string) => Promise<DomainVerdict>>();
const revalidatePath = vi.fn();

vi.mock('@/db/repository', () => ({
  upsertChannelConfig: (row: unknown) => upsertChannelConfig(row),
  getChannelConfig: (channel: string, tenantId?: string | null) =>
    getChannelConfig(channel, tenantId),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

// The network calls are replaced, AND SO IS `isSendingDomainVerified` — the
// one predicate the action now shares with the go-live checklist (10-03,
// T-10-14). It is mocked DIRECTLY rather than through `listDomains`, because
// the wrapper binds its default lister inside the real module: overriding
// `listDomains` alone would not intercept it, and the suite would be asserting
// against the real provider's absence rather than against three states.
//
// `tests/resend-domains.test.ts` owns the predicate's own behaviour; what is
// under test HERE is that the action refuses on two of its three states and
// never treats a failed read as a pass.
vi.mock('@/core/messaging/resend-domains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/messaging/resend-domains')>()),
  createDomain: (name: string) => createDomain(name),
  verifyDomain: (id: string) => verifyDomain(id),
  listDomains: () => listDomains(),
  isSendingDomainVerified: (address: string) => isSendingDomainVerified(address),
}));

let session: { userId: string | null; allowlisted: boolean } = {
  userId: 'operator-1',
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
          maybeSingle: async () =>
            table === 'operator_allowlist' && session.allowlisted
              ? { data: { user_id: session.userId }, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
  }),
}));

const { addDomainAction, saveEmailConfigAction, verifyDomainAction } = await import(
  '@/app/(console)/settings/email/actions'
);
const { BLANK_EMAIL_SETTINGS_STATE, EMAIL_IDENTITY_LOCKED_MESSAGE } = await import(
  '@/app/(console)/settings/email/action-state'
);

const TENANT_ID = '77777777-7777-4777-8777-777777777777';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/**
 * A complete, valid identity submission — each test breaks exactly one thing.
 *
 * `enabled: 'on'` is still posted BY EVERY CASE and that is deliberate: the form
 * no longer renders the checkbox, but this action's id is global and its body is
 * the caller's, so "a forged `enabled` changes nothing" has to be asserted
 * rather than assumed (T-10-13).
 */
function enablement(overrides: Record<string, string> = {}): FormData {
  return form({
    tenant_id: '',
    from_address: 'quotes@quotes.example.com.au',
    reply_to: 'dave@daveplumbing.com.au',
    business_name: "Dave's Plumbing",
    enabled: 'on',
    ...overrides,
  });
}

function domainList(
  domains: { name: string; status: string }[],
): Extract<ListDomainsResult, { ok: true }> {
  return {
    ok: true,
    domains: domains.map((domain, index) => ({
      id: `dom_${index}`,
      name: domain.name,
      status: domain.status,
      region: 'ap-northeast-1',
      createdAt: null,
    })),
  };
}

beforeEach(() => {
  upsertChannelConfig.mockClear();
  getChannelConfig.mockReset();
  createDomain.mockReset();
  verifyDomain.mockReset();
  listDomains.mockReset();
  isSendingDomainVerified.mockReset();
  revalidatePath.mockClear();
  session = { userId: 'operator-1', allowlisted: true };
  listDomains.mockResolvedValue(
    domainList([{ name: 'quotes.example.com.au', status: 'verified' }]),
  );
  // No row yet — the state every client is in before the first save.
  getChannelConfig.mockResolvedValue(null);
  isSendingDomainVerified.mockResolvedValue({
    kind: 'verified',
    domain: 'quotes.example.com.au',
  });
});

describe('every export is gated before it does anything (T-4-24)', () => {
  it.each([
    ['saveEmailConfigAction', () => saveEmailConfigAction(BLANK_EMAIL_SETTINGS_STATE, enablement())],
    [
      'addDomainAction',
      () => addDomainAction(BLANK_EMAIL_SETTINGS_STATE, form({ domain: 'x.example.com.au' })),
    ],
    [
      'verifyDomainAction',
      () => verifyDomainAction(BLANK_EMAIL_SETTINGS_STATE, form({ domain_id: 'dom_0' })),
    ],
  ])('%s refuses an unauthenticated caller and does nothing', async (_name, run) => {
    session = { userId: null, allowlisted: false };

    const state = await run();

    // The counts are the assertion. An action that acted first and checked
    // afterwards returns this same message having already spent the call.
    expect(upsertChannelConfig).not.toHaveBeenCalled();
    expect(createDomain).not.toHaveBeenCalled();
    expect(verifyDomain).not.toHaveBeenCalled();
    expect(isSendingDomainVerified).not.toHaveBeenCalled();
    expect(state.error).toBe('Your session has expired. Sign in again.');
  });

  it.each([
    ['saveEmailConfigAction', () => saveEmailConfigAction(BLANK_EMAIL_SETTINGS_STATE, enablement())],
    [
      'addDomainAction',
      () => addDomainAction(BLANK_EMAIL_SETTINGS_STATE, form({ domain: 'x.example.com.au' })),
    ],
    [
      'verifyDomainAction',
      () => verifyDomainAction(BLANK_EMAIL_SETTINGS_STATE, form({ domain_id: 'dom_0' })),
    ],
  ])('%s refuses an authenticated non-operator and does nothing', async (_name, run) => {
    session = { userId: 'signed-in-stranger', allowlisted: false };

    const state = await run();

    expect(upsertChannelConfig).not.toHaveBeenCalled();
    expect(createDomain).not.toHaveBeenCalled();
    expect(verifyDomain).not.toHaveBeenCalled();
    expect(state.error).toBe('You do not have access to audits.');
  });
});

describe('the verified-domain check is server-side, through ONE predicate (T-4-26, T-10-14)', () => {
  it('REFUSES an unverified domain, naming it and what to do about it', async () => {
    isSendingDomainVerified.mockResolvedValue({
      kind: 'unverified',
      domain: 'quotes.example.com.au',
    });

    const state = await saveEmailConfigAction(BLANK_EMAIL_SETTINGS_STATE, enablement());

    expect(upsertChannelConfig).not.toHaveBeenCalled();
    expect(state.error).toContain('quotes.example.com.au');
    expect(state.error).toContain('not verified');
  });

  it('REFUSES when the domain cannot be checked — a read failure is not a pass', async () => {
    // Key revoked, provider down, network gone: every one of these is a state in
    // which "write it anyway" means possibly saving an identity on a domain
    // nobody has verified, which the client page would then happily arm.
    isSendingDomainVerified.mockResolvedValue({ kind: 'unknown', reason: 'missing_api_key' });

    const state = await saveEmailConfigAction(BLANK_EMAIL_SETTINGS_STATE, enablement());

    expect(upsertChannelConfig).not.toHaveBeenCalled();
    expect(state.error).toContain('Nothing was saved');
    // The provider's code stays out of the rendered sentence (WR-08).
    expect(state.error).not.toContain('missing_api_key');
  });

  it('REFUSES an address the predicate cannot read a domain out of', async () => {
    isSendingDomainVerified.mockResolvedValue({ kind: 'invalid_address' });

    const state = await saveEmailConfigAction(BLANK_EMAIL_SETTINGS_STATE, enablement());

    expect(upsertChannelConfig).not.toHaveBeenCalled();
    expect(state.error).toContain('valid from-address');
  });

  it('THE CHECKLIST AND THIS ACTION ASK THE SAME QUESTION, spelled once', () => {
    // T-10-14 is two spellings drifting apart. The action must not carry its own
    // copy of "is this domain on the account and verified" — the one it shares
    // with `readGoLiveChecklist` is the only one allowed to exist.
    const source = readFileSync(ACTIONS, 'utf-8');

    expect(source).toContain('isSendingDomainVerified');
    expect(source).not.toContain('VERIFIED_STATUS');
  });

  it('checks the domain even when nothing is being armed', async () => {
    // A row's only purpose is to be armed later. A rule with one state exempted
    // is a rule somebody reasons around — and a saved-but-unverified
    // from-address is a row the next operator arms believing it was checked.
    isSendingDomainVerified.mockResolvedValue({
      kind: 'unverified',
      domain: 'quotes.example.com.au',
    });

    await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ enabled: 'off', reply_to: '', business_name: '' }),
    );

    expect(upsertChannelConfig).not.toHaveBeenCalled();
  });

  it('accepts a verified domain and writes through upsertChannelConfig', async () => {
    const state = await saveEmailConfigAction(BLANK_EMAIL_SETTINGS_STATE, enablement());

    expect(state.error).toBeNull();
    expect(upsertChannelConfig).toHaveBeenCalledTimes(1);
    expect(upsertChannelConfig).toHaveBeenCalledWith({
      channel: 'email',
      // The GLOBAL row: null, not the empty string a `<select>` submits.
      tenantId: null,
      fromAddress: 'quotes@quotes.example.com.au',
      replyTo: 'dave@daveplumbing.com.au',
      businessName: "Dave's Plumbing",
      enabled: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/settings/email');
  });

  it('writes a per-tenant identity under that tenant id', async () => {
    await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID }),
    );

    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it('normalises the address before asking, so one spelling is checked and stored', async () => {
    await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ from_address: '  QUOTES@Quotes.Example.com.au ' }),
    );

    expect(isSendingDomainVerified).toHaveBeenCalledWith('quotes@quotes.example.com.au');
    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ fromAddress: 'quotes@quotes.example.com.au' }),
    );
  });
});

/**
 * D-04, T-10-13: ARMING IS AUDITED, SO ARMING HAPPENS IN ONE PLACE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `enabled` is the switch that sends real messages to real customers. Every │
 * │ flip of it must leave an audit row saying who and why — which is only     │
 * │ true if THIS action cannot flip it at all.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the settings form builds IDENTITIES: from-address, reply-to, business name.
 * The stored `enabled` is read and written back unchanged, and the only path
 * that changes it is `armChannel` / `disarmChannel` on the client page.
 */
describe('the settings form saves identity only (D-04, T-10-13)', () => {
  it('writes enabled false on a new row, whatever the posted body says', async () => {
    await saveEmailConfigAction(BLANK_EMAIL_SETTINGS_STATE, enablement());

    // `enabled: 'on'` was posted. The action's id is global and its body is the
    // caller's, so this is the assertion that the checkbox's removal is a
    // CONTROL rather than a cosmetic change.
    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('an already-on row keeps sending — the stored value is preserved', async () => {
    getChannelConfig.mockResolvedValue({ tenantId: TENANT_ID, enabled: true });

    await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      // Posted with the checkbox OFF: an identity edit must not disarm a live
      // client either, which would be a flip with no audit row just as much.
      enablement({ tenant_id: TENANT_ID, enabled: 'off' }),
    );

    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, enabled: true }),
    );
  });

  it('does not inherit the GLOBAL row’s enabled onto a tenant that has no row', async () => {
    // `getChannelConfig` reads override-then-default, so a tenant with no row of
    // its own is answered with the GLOBAL row. Writing that row's `enabled` onto
    // a new per-client row would arm a client nobody armed.
    getChannelConfig.mockResolvedValue({ tenantId: null, enabled: true });

    await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID }),
    );

    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, enabled: false }),
    );
  });

  it('REFUSES when the stored row cannot be read — nothing is written', async () => {
    // Defaulting to `false` here would DISARM a live client on a driver blip,
    // with no audit row and no operator involved. The refusal is the only
    // outcome that cannot silently stop somebody's follow-ups.
    getChannelConfig.mockRejectedValue(new Error('connection terminated'));

    const state = await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID }),
    );

    expect(upsertChannelConfig).not.toHaveBeenCalled();
    expect(state.error).toContain('Nothing was saved');
  });

  it('points at the client page for arming rather than claiming anything was armed', async () => {
    const state = await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID }),
    );

    expect(state.error).toBeNull();
    expect(state.success).toContain('Ready to send?');
    expect(state.success).not.toContain('is on');
  });

  it('says nothing changed about sending when the row was already on', async () => {
    getChannelConfig.mockResolvedValue({ tenantId: TENANT_ID, enabled: true });

    const state = await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID }),
    );

    expect(state.success).toContain('stays on');
  });
});

describe('identity completeness is the arming gate’s job, not this form’s', () => {
  it.each([
    ['no reply-to', { reply_to: '' }],
    ['no business name', { business_name: '  ' }],
    ['no from-address at all', { from_address: '', reply_to: '', business_name: '' }],
  ])('saves a partial identity (%s) instead of refusing it', async (_label, overrides) => {
    // The three refusals that used to live here have moved INTO `armChannel`,
    // which re-reads the row inside the same transaction as the audit write
    // (10-01). Keeping a copy here would refuse a half-built identity an
    // operator is deliberately saving mid-onboarding, while the row it protects
    // is disabled and sends nothing.
    const state = await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID, ...overrides }),
    );

    expect(state.error).toBeNull();
    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, enabled: false }),
    );
  });

  it.each([
    ['the from-address', { from_address: '' }],
    ['the reply-to', { reply_to: '' }],
  ])(
    'REFUSES to clear %s on an ENABLED row — that is a disarm, and disarms are audited (WR-01)',
    async (_label, overrides) => {
      // `resolveEmailIdentity` refuses without both fields, so this save would
      // stop a live client's follow-ups on the next tick with no audit row, no
      // recorded decision, and "Turn email off" still on the client page
      // because `enabled` is still true. Exactly the silent stop the preserved
      // `enabled` exists to prevent, reached through the identity instead.
      getChannelConfig.mockResolvedValue({ tenantId: TENANT_ID, enabled: true });

      const state = await saveEmailConfigAction(
        BLANK_EMAIL_SETTINGS_STATE,
        enablement({ tenant_id: TENANT_ID, ...overrides }),
      );

      expect(state.error).toBe(EMAIL_IDENTITY_LOCKED_MESSAGE);
      expect(state.success).toBeNull();
      // NOTHING WAS WRITTEN, which is the half that matters: a refusal that
      // saved anyway would be a worse bug than the one it replaced.
      expect(upsertChannelConfig).not.toHaveBeenCalled();
    },
  );

  it('still allows a complete identity to be edited on an enabled row', async () => {
    // The rule is about CLEARING, not about editing: an operator fixing a typo
    // in a live client's reply-to must not have to disarm them to do it.
    getChannelConfig.mockResolvedValue({ tenantId: TENANT_ID, enabled: true });

    const state = await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID, reply_to: 'office@daveplumbing.com.au' }),
    );

    expect(state.error).toBeNull();
    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'office@daveplumbing.com.au', enabled: true }),
    );
  });

  it('lets a DISABLED row keep its half-built identity cleared', async () => {
    // The relaxed rule survives where its premise holds: this row sends
    // nothing, and the arming gate is what refuses to arm it.
    getChannelConfig.mockResolvedValue({ tenantId: TENANT_ID, enabled: false });

    const state = await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ tenant_id: TENANT_ID, reply_to: '' }),
    );

    expect(state.error).toBeNull();
    expect(upsertChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: null, enabled: false }),
    );
  });

  it('stores a cleared field as NULL, never as an empty string', async () => {
    // Clearing a field must clear the column: `upsertChannelConfig`'s SET clause
    // is exhaustive precisely so it can, and a stored '' would be a from-address
    // that passes every `if (!from)` check it is read by.
    await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      form({ tenant_id: TENANT_ID, from_address: '', reply_to: '', business_name: '' }),
    );

    expect(upsertChannelConfig).toHaveBeenCalledWith({
      channel: 'email',
      tenantId: TENANT_ID,
      fromAddress: null,
      replyTo: null,
      businessName: null,
      enabled: false,
    });
    // No address to check, so the provider was never asked.
    expect(isSendingDomainVerified).not.toHaveBeenCalled();
  });

  it('refuses a malformed from-address before asking the provider', async () => {
    const state = await saveEmailConfigAction(
      BLANK_EMAIL_SETTINGS_STATE,
      enablement({ from_address: 'not-an-address' }),
    );

    expect(isSendingDomainVerified).not.toHaveBeenCalled();
    expect(upsertChannelConfig).not.toHaveBeenCalled();
    expect(state.error).toContain('valid from-address');
  });
});

describe('addDomainAction', () => {
  it('sends the trimmed, lowercased domain to the provider', async () => {
    createDomain.mockResolvedValue({
      ok: true,
      domain: { id: 'dom_0', name: 'quotes.example.com.au', status: 'not_started', region: 'ap-northeast-1', createdAt: null, records: [] },
    });

    const state = await addDomainAction(
      BLANK_EMAIL_SETTINGS_STATE,
      form({ domain: '  Quotes.Example.COM.AU ' }),
    );

    expect(createDomain).toHaveBeenCalledWith('quotes.example.com.au');
    expect(revalidatePath).toHaveBeenCalledWith('/settings/email');
    // Names the NEXT action rather than announcing success: a domain added and
    // left alone never verifies.
    expect(state.success).toContain('DNS records');
  });

  it.each([
    ['an email address', 'quotes@example.com.au'],
    ['a URL', 'https://example.com.au/quotes'],
    ['no dot', 'localhost'],
  ])('refuses %s without calling the provider', async (_label, value) => {
    const state = await addDomainAction(BLANK_EMAIL_SETTINGS_STATE, form({ domain: value }));

    expect(createDomain).not.toHaveBeenCalled();
    expect(state.error).not.toBeNull();
  });

  it('renders a fixed sentence, never the provider reason (WR-08)', async () => {
    createDomain.mockResolvedValue({ ok: false, reason: 'validation_error' });

    const state = await addDomainAction(
      BLANK_EMAIL_SETTINGS_STATE,
      form({ domain: 'quotes.example.com.au' }),
    );

    expect(state.error).toBe(
      'Could not add that domain. Check it is spelled correctly and try again.',
    );
    expect(state.error).not.toContain('validation_error');
  });
});

describe('verifyDomainAction', () => {
  it('asks the provider to re-check and says the outcome is not yet known', async () => {
    verifyDomain.mockResolvedValue({ ok: true, id: 'dom_0' });

    const state = await verifyDomainAction(
      BLANK_EMAIL_SETTINGS_STATE,
      form({ domain_id: 'dom_0' }),
    );

    expect(verifyDomain).toHaveBeenCalledWith('dom_0');
    // Verification is asynchronous. Copy that claimed success here would have
    // the operator enabling a domain on the strength of a 200 that only means
    // "we will look".
    expect(state.success).toContain('Checking DNS');
  });

  it('refuses an empty or oversized id without calling the provider', async () => {
    for (const id of ['', 'x'.repeat(65)]) {
      const state = await verifyDomainAction(BLANK_EMAIL_SETTINGS_STATE, form({ domain_id: id }));
      expect(state.error).toBe('That domain could not be found.');
    }
    expect(verifyDomain).not.toHaveBeenCalled();
  });
});

/**
 * Source assertions — the half a behavioural test cannot reach. The failure mode
 * is a FOURTH export added to this module later without the gate, or a residency
 * note quietly softened.
 */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const ACTIONS = 'src/app/(console)/settings/email/actions.ts';
const PAGE = 'src/app/(console)/settings/email/page.tsx';

describe('the email settings surfaces in source', () => {
  it.each([ACTIONS, PAGE])('%s calls requireOperator()', (path) => {
    expect(code(path)).toMatch(/\brequireOperator\s*\(/);
  });

  it.each([ACTIONS, PAGE])('%s imports it from the shared module', (path) => {
    expect(code(path)).toMatch(
      /import\s*\{[^}]*\brequireOperator\b[^}]*\}\s*from\s*['"][^'"]*_auth['"]/,
    );
  });

  it.each([ACTIONS, PAGE])('%s does not treat a bare getClaims() as authorization', (path) => {
    expect(code(path)).not.toMatch(/getClaims\s*\(/);
  });

  it('every export of the action module is gated — the count is pinned', () => {
    // Each export of a `'use server'` module is a globally-POSTable endpoint.
    // Adding a fourth means editing this number, which is the point.
    const exports = code(ACTIONS).match(/^export\s+async\s+function\s+(\w+)/gm) ?? [];
    expect(exports).toHaveLength(3);
    // And every one of them opens with the gate, before anything else runs.
    const bodies = code(ACTIONS).split(/^export\s+async\s+function\s+/m).slice(1);
    for (const body of bodies) {
      const firstStatement = body.slice(body.indexOf('{') + 1).trim();
      expect(firstStatement.startsWith('const access = await requireOperator()')).toBe(true);
    }
  });

  it('the RESIDENCY NOTE names ap-northeast-1 on the rendered page (CONTEXT, MSG-02)', () => {
    // The prohibition this pins: email processing must never be represented as
    // AU-resident anywhere the operator reads. A region CODE is checkable — a
    // prospect's IT person checks it — where "offshore" is a word that softens
    // every time somebody edits the copy.
    const page = code(PAGE);
    expect(page).toContain('ap-northeast-1');
    expect(page).toContain('AU-resident');
    expect(page).toContain('Resend');
    // Rendered, not merely declared: the note has to reach the screen.
    expect(page).toMatch(/\{\s*RESIDENCY_NOTE\s*\}/);
  });
});
