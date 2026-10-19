/**
 * D-06's "dispatch keeps ONE sender", made true for two channels — and the
 * claim-time wiring bug it would otherwise hide.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE LEDGER MUST RECORD THE DELEGATE, NEVER THE COMPOSITE (T-4-11).       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `dispatch.ts` writes `send_ledger.sender` at CLAIM time — before the send runs
 * — from the sender it was handed. With one sender that was exactly right. With
 * a routing composite it silently becomes wrong: every row would read
 * `'routing'`, a value no real provider ever has.
 *
 * That is not cosmetic. `sender` is the column Phase 7 uses to EXCLUDE stub rows
 * from recovered-revenue attribution, forever, against rows written today — the
 * whole reason `'stub'`/`'stub_sent'` were made structural in Phase 3. A ledger
 * full of `'routing'` cannot answer "was this really sent", so an invoice would
 * be stapled to proof that is not true.
 *
 * ── NOTHING IN THIS FILE CAN FAIL ON THAT BUG, AND THAT IS WHY IT IS SPLIT ──
 *
 * Every assertion here passes whether the claim reads the delegate or the
 * composite — the wiring only becomes observable in a real `send_ledger` row.
 * That assertion lives in `tests/routing-dispatch.test.ts`, which is a REMOTE
 * suite; keeping it out of this file is what lets these tests run on a bare
 * `npm test` (WR-09 refuses any file that reaches for hosted credentials, and
 * `helpers/seed` reaches for them at module scope). Same split 04-02 made
 * between `clicksend-inbound-route.test.ts` and `inbound-threading.test.ts`.
 *
 * ── ONE ROUTING RULE, ASKED TWICE ──────────────────────────────────────────
 *
 * `providerFor(channel)` and `send(request)` both resolve through the SAME
 * private `delegateFor`. Two copies of "which sender handles email" is two
 * answers, and the disagreement would show up as a ledger row claiming one
 * provider and a message leaving through another — the house pattern
 * `contactWindowOf` and `nextAllowedSlot` already follow.
 *
 * ── WHY THE ACTIVATION GATE IS TESTED PURELY ───────────────────────────────
 *
 * `chooseSmsSender` is a pure function over (channel-enabled, credentials)
 * precisely so its cases can be enumerated WITHOUT writing an enabled sms row to
 * the hosted database. That database is shared with production, and an enabled
 * global sms row left behind by a test run is the switch that turns real
 * messaging on for every client — D-04's whole point is that it needs no deploy.
 * The remote suite only ever READS that state, or writes a provably inert
 * `email` row it then deletes by id.
 *
 * ── THE GATE IS DEPLOYMENT-LEVEL; THE IDENTITY IS PER TENANT (CR-01) ────────
 *
 * The boolean this gate takes is `anyChannelEnabled('sms')` — "is sms armed
 * ANYWHERE" — not the global row's `enabled`. Gating on the global row alone was
 * the CR-01 defect: enabling ONE client's override row while the global row
 * stayed off produced a `StubSender`, so the one-client-at-a-time rollout the
 * `messaging_config` table exists for could not be performed at all. The
 * from-address question moved WHOLLY to `resolveSmsFrom`, whose `null` becomes a
 * RECORDED `sms_not_configured` refusal on the ledger (asserted in
 * `tests/clicksend-sender.test.ts`) instead of a silent stub. The
 * tenant-override activation itself is asserted end-to-end against the hosted
 * database in `tests/routing-dispatch.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { isChannelAware } from '../src/core/cadence/dispatch';
import { StubSender, type SendOutcome, type SendRequest, type TouchSender } from '../src/core/cadence/sender';
import { chooseSmsSender, RoutingSender } from '../src/core/messaging/routing-sender';

/** A delegate that answers like the stub but under its own name. */
class NamedSender implements TouchSender {
  readonly seen: SendRequest[] = [];
  constructor(readonly provider: string) {}

  async send(request: SendRequest): Promise<SendOutcome> {
    this.seen.push(request);
    return { kind: 'sent', provider: this.provider, providerMessageId: `${this.provider}-1` };
  }
}

function request(channel: 'sms' | 'email'): SendRequest {
  return {
    ledgerId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    quoteId: '33333333-3333-4333-8333-333333333333',
    leadId: null,
    cadenceId: '44444444-4444-4444-8444-444444444444',
    touchNumber: 1,
    channel,
    to: { address: channel === 'sms' ? '+61491570158' : 'dana@example.test', contactName: 'Dana' },
    body: 'Following up on that quote.',
  };
}

describe('RoutingSender — one rule, asked twice', () => {
  it('delegates by channel and returns the delegate outcome UNCHANGED', async () => {
    const sms = new NamedSender('clicksend');
    const email = new NamedSender('resend');
    const routing = new RoutingSender({ sms, email });

    const smsOutcome = await routing.send(request('sms'));
    const emailOutcome = await routing.send(request('email'));

    // The PROVIDER on the outcome is the delegate's. `performSends` reads it to
    // decide between 'sent' and 'stub_sent', so a composite rewriting it here
    // would make every real send look like a stub — or every stub look real.
    expect(smsOutcome).toEqual({
      kind: 'sent',
      provider: 'clicksend',
      providerMessageId: 'clicksend-1',
    });
    expect(emailOutcome).toEqual({
      kind: 'sent',
      provider: 'resend',
      providerMessageId: 'resend-1',
    });

    // T-4-12: an email touch must never reach the SMS provider.
    expect(sms.seen).toHaveLength(1);
    expect(sms.seen[0].channel).toBe('sms');
    expect(email.seen).toHaveLength(1);
    expect(email.seen[0].channel).toBe('email');
  });

  it('answers providerFor(channel) with the same delegate send() would use', () => {
    const routing = new RoutingSender({
      sms: new NamedSender('clicksend'),
      email: new NamedSender('resend'),
    });

    expect(routing.providerFor('sms')).toBe('clicksend');
    expect(routing.providerFor('email')).toBe('resend');
  });

  it('carries a provider label that must never reach the ledger', () => {
    const routing = new RoutingSender({ sms: new StubSender(), email: new StubSender() });

    // The label exists because `TouchSender` requires it. It is deliberately a
    // word no provider uses, so a ledger row carrying it is unambiguously the
    // claim-time wiring bug rather than a plausible provider name somebody has
    // to investigate.
    expect(routing.provider).toBe('routing');
    expect(routing.providerFor('sms')).not.toBe(routing.provider);
  });
});

describe('isChannelAware — the guard dispatch resolves the claim through', () => {
  it('recognises a routing composite and a plain sender', () => {
    expect(isChannelAware(new RoutingSender({ sms: new StubSender(), email: new StubSender() }))).toBe(
      true,
    );
    // Phase 3's sender, and every test sender in this repository, is unchanged
    // by this plan: no `providerFor`, so the claim reads `.provider` exactly as
    // it always did.
    expect(isChannelAware(new StubSender())).toBe(false);
    expect(isChannelAware(new NamedSender('clicksend'))).toBe(false);
  });
});

describe('chooseSmsSender — the D-04 activation gate', () => {
  const CREDS = { username: 'u', apiKey: 'k' };

  const fallback = new StubSender();

  it.each([
    { name: 'sms enabled nowhere, with credentials', enabled: false, creds: CREDS },
    { name: 'sms enabled nowhere and no credentials', enabled: false, creds: {} },
    { name: 'sms armed but no credentials', enabled: true, creds: {} },
    { name: 'sms armed with only half the credentials', enabled: true, creds: { username: 'u' } },
    { name: 'sms armed with only the api key', enabled: true, creds: { apiKey: 'k' } },
  ])('falls back to the stub for $name', ({ enabled, creds }) => {
    // THE PRODUCTION INVARIANT. Until both are satisfied, dispatch behaves
    // byte-identically to Phase 3 — same ledger `sender`, same `stub_sent`
    // outcome — so nothing here can send a real message by being deployed.
    expect(chooseSmsSender(enabled, creds, fallback)).toBe(fallback);
  });

  it('builds a ClickSendSender once sms is armed anywhere and credentialed', () => {
    const chosen = chooseSmsSender(true, CREDS, fallback);

    expect(chosen).not.toBe(fallback);
    expect(chosen.provider).toBe('clicksend');
  });

  it('does NOT ask about a from-address — that question moved to resolveSmsFrom (CR-01)', () => {
    // The gate is handed a boolean and nothing else, so there is no address for
    // it to read: an armed channel wires the real provider in even though no
    // number has been named anywhere in this call. That is the point. The
    // deployment-level question is "is sms armed anywhere"; WHICH number this
    // tenant sends from is re-asked per tenant by `resolveSmsFrom`, and its
    // `null` produces a RECORDED `sms_not_configured` ledger refusal (asserted
    // in tests/clicksend-sender.test.ts) rather than the silent stub the
    // address condition used to produce here for every tenant at once.
    expect(chooseSmsSender(true, CREDS, fallback).provider).toBe('clicksend');
  });
});

