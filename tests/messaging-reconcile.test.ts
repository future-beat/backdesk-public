/**
 * The daily messaging sweep — the guarantee behind two webhook hints
 * (MSG-01, T-4-18, D-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PURE. Every collaborator is injected, and that is a SAFETY property.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The alternative — a remote suite — would have to write an ENABLED global
 * `messaging_config` sms row to get past the activation guard, and on this
 * production-shared database that row is the switch that arms real customer
 * messaging for every client with no deploy (D-04). A test that can arm
 * production if it dies between `beforeAll` and `afterAll` is not a test worth
 * having; the same reasoning 04-03 applied to `chooseSmsSender`.
 *
 * So every assertion below is made by OBSERVING WHICH DEPENDENCY WAS CALLED,
 * which is also the only way to assert the property this module actually has:
 * that it makes no decisions of its own and delegates every one of them to the
 * same three functions the webhooks use.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileMessaging, type ReconcileDeps } from '../src/core/messaging/reconcile';

const CREDS = { username: 'test-user', apiKey: 'test-key' };

function historyRow(over: Record<string, unknown> = {}) {
  // THE CAPTURED REAL DELIVERED PAYLOAD, field for field
  // (docs/external-registrations.md, "The delivery half of MSG-01, proven",
  // observed 2026-08-30): the one-word `status` says 'Sent', the prose
  // `status_text` carries the actual verdict, and the error pair is populated
  // ON SUCCESS.
  return {
    messageId: 'CS-1',
    customString: '11111111-1111-4111-8111-111111111111',
    status: 'Sent',
    statusCode: '201',
    statusText: 'Message delivered to the handset',
    errorCode: '4',
    errorText: 'Message delivered to the handset',
    date: 1_756_351_200,
    ...over,
  };
}

/**
 * THE CAPTURED REAL FAILED PAYLOAD, field for field (same source, same day).
 *
 * The diagnosis lives in `status_text`; `error_text` is the vestigial half and
 * reads the useless 'Unknown error'. Neither field, nor `Failed`, nor `301`,
 * contains an `OPT` token — which is the whole point of pinning it here: the
 * opt-out backstop must stay SILENT on the only failure shape this account has
 * ever actually produced.
 */
const REAL_FAILED = historyRow({
  messageId: 'CS-FAILED',
  status: 'Failed',
  statusCode: '301',
  statusText:
    'Absent Subscriber. Phone is out of range or switched off. Likely to have been unavailable for 12 hours or more.',
  errorCode: '12',
  errorText: 'Unknown error',
});

function inboundRow(over: Record<string, unknown> = {}) {
  return {
    messageId: 'IN-1',
    from: '+61491570101',
    to: '+61491570100',
    body: 'sounds good',
    date: 1_756_351_200,
    ...over,
  };
}

let anyEnabled: ReturnType<typeof vi.fn>;
let listHistory: ReturnType<typeof vi.fn>;
let listInbound: ReturnType<typeof vi.fn>;
let applyReceipt: ReturnType<typeof vi.fn>;
let findInbound: ReturnType<typeof vi.fn>;
let handleInbound: ReturnType<typeof vi.fn>;
let ledgerOwners: ReturnType<typeof vi.fn>;
let suppress: ReturnType<typeof vi.fn>;

function deps(over: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    anyEnabled,
    creds: CREDS,
    listHistory,
    listInbound,
    applyReceipt,
    findInbound,
    handleInbound,
    ledgerOwners,
    suppress,
    ...over,
  } as ReconcileDeps;
}

beforeEach(() => {
  anyEnabled = vi.fn().mockResolvedValue(true);
  listHistory = vi.fn().mockResolvedValue({ ok: true, items: [], pages: 1 });
  listInbound = vi.fn().mockResolvedValue({ ok: true, items: [], pages: 1 });
  applyReceipt = vi.fn().mockResolvedValue({ kind: 'unmatched' });
  findInbound = vi.fn().mockResolvedValue([]);
  handleInbound = vi.fn().mockResolvedValue({ kind: 'reply_unmatched', inboundId: 'i' });
  ledgerOwners = vi.fn().mockResolvedValue([]);
  suppress = vi.fn().mockResolvedValue({ kind: 'killed', addressesSuppressed: 1, touchesSkipped: 0 });
});

/* ------------------------------------------------------------------------- *
 * The activation guard (D-04)
 * ------------------------------------------------------------------------- */

describe('the reconcile guard', () => {
  it('skips with NO HTTP CALLS when NO sms row is enabled anywhere', async () => {
    anyEnabled.mockResolvedValue(false);

    const result = await reconcileMessaging(deps());

    expect(result).toEqual({
      skipped: true,
      receiptsApplied: 0,
      inboundReplayed: 0,
      optOutsRecorded: 0,
    });
    // Asserted, not assumed: a sweep that "harmlessly" polled an unconfigured
    // account would authenticate with empty credentials every night forever.
    expect(listHistory).not.toHaveBeenCalled();
    expect(listInbound).not.toHaveBeenCalled();
  });

  it('RUNS when any sms row is enabled — a TENANT-ONLY activation is still swept', async () => {
    // The gap 04-08 opened and this closes: after `buildRoutingSender` started
    // gating on `anyChannelEnabled`, one client's override row arms REAL sms
    // with the global row still off. A guard that read the global row alone
    // would leave those sends — and the STOPs answering them — unreconciled,
    // which is the T-4-18 hole with a second door.
    anyEnabled.mockResolvedValue(true);

    const result = await reconcileMessaging(deps());

    expect(result.skipped).toBe(false);
    expect(listHistory).toHaveBeenCalledTimes(1);
    expect(listInbound).toHaveBeenCalledTimes(1);
  });

  const CRED_GAPS: Array<[string, { username?: string; apiKey?: string }]> = [
    ['no username', { apiKey: 'k' }],
    ['no api key', { username: 'u' }],
    ['neither', {}],
  ];

  it.each(CRED_GAPS)('skips with %s — production’s state today (D-08)', async (_label, creds) => {
    const result = await reconcileMessaging(deps({ creds }));

    expect(result.skipped).toBe(true);
    expect(listHistory).not.toHaveBeenCalled();
    expect(listInbound).not.toHaveBeenCalled();
  });

  it('asks the DEPLOYMENT-level question — "is there any account activity to poll"', async () => {
    await reconcileMessaging(deps());

    expect(anyEnabled).toHaveBeenCalledWith('sms');
  });
});

/* ------------------------------------------------------------------------- *
 * The window
 * ------------------------------------------------------------------------- */

describe('the reconcile window', () => {
  it('looks back 48 hours, so ONE skipped run costs nothing', async () => {
    const now = new Date('2026-08-29T19:30:00.000Z');

    await reconcileMessaging(deps({ now }));

    const [call] = listHistory.mock.calls[0] as [{ since: Date; now: Date }];
    // A 24-hour window has no margin: one deploy, cron outage or timeout during
    // the nightly slot and that day's messages are never looked at again by
    // anything. The overlap is only safe because all three writes converge.
    expect(call.since.toISOString()).toBe('2026-08-27T19:30:00.000Z');
    expect(call.now).toBe(now);
  });

  it('polls history and inbound over the SAME window', async () => {
    const now = new Date('2026-08-29T19:30:00.000Z');

    await reconcileMessaging(deps({ now }));

    const history = listHistory.mock.calls[0][0] as { since: Date };
    const inbound = listInbound.mock.calls[0][0] as { since: Date };
    expect(inbound.since.toISOString()).toBe(history.since.toISOString());
  });
});

/* ------------------------------------------------------------------------- *
 * Pass 1 — delivery receipts
 * ------------------------------------------------------------------------- */

describe('the history pass', () => {
  it('delegates every history row to applyDeliveryReceipt, translated', async () => {
    listHistory.mockResolvedValue({ ok: true, items: [historyRow()], pages: 1 });
    applyReceipt.mockResolvedValue({ kind: 'applied', ledgerId: 'led-1' });

    const result = await reconcileMessaging(deps());

    // TRANSLATION ONLY. The classification, the timestamp unit and the match
    // rule stay in receipts.ts — a second copy here would drift, and the drift
    // would show up as a message treated differently depending on whether its
    // receipt arrived by callback or by poll.
    //
    // EVERY VERDICT-BEARING FIELD TRAVELS, and this assertion is what pins that.
    // `status` used to be passed in `status_text`'s slot with the real prose
    // dropped, so the sweep saw only 'Sent' + '201' and classified a delivered
    // message `unknown` — the exact drift this test was written to prevent,
    // arriving as a lossy translation rather than a duplicated rule.
    expect(applyReceipt).toHaveBeenCalledWith({
      custom_string: '11111111-1111-4111-8111-111111111111',
      message_id: 'CS-1',
      status: 'Sent',
      status_text: 'Message delivered to the handset',
      status_code: '201',
      error_code: '4',
      error_text: 'Message delivered to the handset',
      timestamp: 1_756_351_200,
    });
    expect(result.receiptsApplied).toBe(1);
  });

  it('counts only what actually landed on a ledger row', async () => {
    listHistory.mockResolvedValue({
      ok: true,
      items: [historyRow(), historyRow({ customString: null, messageId: 'CS-2' })],
      pages: 1,
    });
    applyReceipt
      .mockResolvedValueOnce({ kind: 'applied', ledgerId: 'led-1' })
      .mockResolvedValueOnce({ kind: 'unmatched' });

    const result = await reconcileMessaging(deps());

    // Rows matching no send are ORDINARY — the account's history includes
    // anything sent outside this system — not errors and not receipts.
    expect(result.receiptsApplied).toBe(1);
  });

  it('carries on when the history poll fails, and still runs the inbound pass', async () => {
    listHistory.mockResolvedValue({ ok: false, reason: 'http_503', retryable: true });

    const result = await reconcileMessaging(deps());

    expect(result.skipped).toBe(false);
    expect(result.receiptsApplied).toBe(0);
    // A missed STOP is a compliance event and a missed receipt is a NULL
    // column. One provider endpoint being down must not cost us the other.
    expect(listInbound).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- *
 * Pass 2 — inbound replay
 * ------------------------------------------------------------------------- */

describe('the inbound pass', () => {
  it('replays an unseen message through handleInboundSms — the SAME entry point', async () => {
    listInbound.mockResolvedValue({ ok: true, items: [inboundRow()], pages: 1 });

    const result = await reconcileMessaging(deps());

    expect(findInbound).toHaveBeenCalledWith('IN-1');
    // Every attribution rule, the STOP regex, the D-03 fan-out and the D-05
    // pause upgrade apply identically to a message that arrived late.
    expect(handleInbound).toHaveBeenCalledWith({
      from: '+61491570101',
      to: '+61491570100',
      body: 'sounds good',
      providerMessageId: 'IN-1',
    });
    expect(result.inboundReplayed).toBe(1);
  });

  it('SKIPS a message already recorded — dedupe on provider_message_id', async () => {
    listInbound.mockResolvedValue({ ok: true, items: [inboundRow()], pages: 1 });
    findInbound.mockResolvedValue([{ id: 'existing-1' }]);

    const result = await reconcileMessaging(deps());

    expect(handleInbound).not.toHaveBeenCalled();
    expect(result.inboundReplayed).toBe(0);
  });

  it('replays a message with NO provider id rather than dropping it', async () => {
    listInbound.mockResolvedValue({
      ok: true,
      items: [inboundRow({ messageId: null })],
      pages: 1,
    });

    const result = await reconcileMessaging(deps());

    // It cannot be deduped, so the cost of replaying is a duplicate row on the
    // triage screen and the cost of skipping is a STOP. D-03's trade.
    expect(findInbound).not.toHaveBeenCalled();
    expect(handleInbound).toHaveBeenCalledTimes(1);
    expect(result.inboundReplayed).toBe(1);
  });

  it('ignores a message with no sender — there is nothing to thread or suppress', async () => {
    listInbound.mockResolvedValue({ ok: true, items: [inboundRow({ from: null })], pages: 1 });

    await reconcileMessaging(deps());

    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('replays an empty body as an empty body, not as a skip', async () => {
    listInbound.mockResolvedValue({ ok: true, items: [inboundRow({ body: null })], pages: 1 });

    await reconcileMessaging(deps());

    expect(handleInbound).toHaveBeenCalledWith(expect.objectContaining({ body: '' }));
  });
});

/* ------------------------------------------------------------------------- *
 * Pass 3 — provider-side opt-outs (T-4-18, research Pitfall 2)
 * ------------------------------------------------------------------------- */

describe('the opt-out evidence pass', () => {
  /**
   * A SYNTHESISED opt-out, shaped like the real failure and differing in the one
   * field that carries a verdict.
   *
   * It replaces a fixture that put an opt-out token in the `status` field —
   * invented before any real payload existed, and contradicted by the live
   * capture the moment one arrived: ClickSend's
   * `status` is a one-word `Sent`/`Failed` and its `status_code` a number, so a
   * probe reading only those two fields could never fire and the suite was green
   * on a shape the provider does not emit. The `OPT` token here sits ONLY in
   * `status_text` — where the provider actually writes its prose — so this
   * fixture fails against any probe that does not read that field.
   */
  const OPTED_OUT = historyRow({
    status: 'Failed',
    statusCode: '301',
    statusText: 'Recipient has opted out of receiving messages from this sender.',
    errorCode: '12',
    errorText: 'Unknown error',
  });

  it('suppresses through suppressFromInbound with source provider_opt_out', async () => {
    listHistory.mockResolvedValue({ ok: true, items: [OPTED_OUT], pages: 1 });
    applyReceipt.mockResolvedValue({ kind: 'applied', ledgerId: 'led-1' });
    ledgerOwners.mockResolvedValue([
      { id: 'led-1', tenantId: 'tenant-1', cadenceId: 'cadence-1', outcome: 'failed' },
    ]);

    const result = await reconcileMessaging(deps());

    expect(ledgerOwners).toHaveBeenCalledWith(['led-1']);
    // The canonical suppression path — the one transaction every "stop chasing
    // this person" write in this codebase shares. Not a second spelling of it.
    expect(suppress).toHaveBeenCalledWith('tenant-1', 'cadence-1', 'provider_opt_out');
    expect(result.optOutsRecorded).toBe(1);
  });

  it('THE OPT_IN GUARD: a non-failed send is not evidence of an opt-out', async () => {
    listHistory.mockResolvedValue({ ok: true, items: [OPTED_OUT], pages: 1 });
    applyReceipt.mockResolvedValue({ kind: 'applied', ledgerId: 'led-1' });
    ledgerOwners.mockResolvedValue([
      { id: 'led-1', tenantId: 'tenant-1', cadenceId: 'cadence-1', outcome: 'sent' },
    ]);

    const result = await reconcileMessaging(deps());

    // `isOptOutCode` is a tolerant `OPT` substring — D-03's trade at the
    // provider boundary — and `OPT_IN` satisfies it. On a send RESPONSE that is
    // harmless because the check only runs on a refusal; polled history has no
    // such context, so `outcome = 'failed'` supplies it.
    expect(suppress).not.toHaveBeenCalled();
    expect(result.optOutsRecorded).toBe(0);
  });

  it('does not look up owners at all when no history row said opt-out', async () => {
    // `historyRow()`'s default IS the captured real DELIVERED payload.
    listHistory.mockResolvedValue({ ok: true, items: [historyRow()], pages: 1 });
    applyReceipt.mockResolvedValue({ kind: 'applied', ledgerId: 'led-1' });

    const result = await reconcileMessaging(deps());

    // The cross-tenant ledger read is the widest thing this sweep can do. It
    // must not run speculatively.
    expect(ledgerOwners).not.toHaveBeenCalled();
    expect(result.optOutsRecorded).toBe(0);
  });

  it('stays SILENT on the captured real FAILED payload, even on a failed send', async () => {
    listHistory.mockResolvedValue({ ok: true, items: [REAL_FAILED], pages: 1 });
    applyReceipt.mockResolvedValue({ kind: 'applied', ledgerId: 'led-1' });
    ledgerOwners.mockResolvedValue([
      { id: 'led-1', tenantId: 'tenant-1', cadenceId: 'cadence-1', outcome: 'failed' },
    ]);

    const result = await reconcileMessaging(deps());

    // Widening the corpus to four fields makes the probe able to fire; it must
    // not make it fire on an absent subscriber. `Failed`, `301`, the absent-
    // subscriber sentence and `Unknown error` carry no `OPT` token between them,
    // and a false positive here suppresses a customer who never asked.
    expect(ledgerOwners).not.toHaveBeenCalled();
    expect(suppress).not.toHaveBeenCalled();
    expect(result.optOutsRecorded).toBe(0);
  });

  it('never suppresses on a row the receipt could not match', async () => {
    listHistory.mockResolvedValue({ ok: true, items: [OPTED_OUT], pages: 1 });
    applyReceipt.mockResolvedValue({ kind: 'unmatched' });

    await reconcileMessaging(deps());

    // No ledger row means no tenant and no cadence — suppressing anyway would
    // mean guessing whose customer this is.
    expect(ledgerOwners).not.toHaveBeenCalled();
    expect(suppress).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * D-07 and the delegation contract
 * ------------------------------------------------------------------------- */

describe('the reconcile module itself', () => {
  const SOURCE = readFileSync('src/core/messaging/reconcile.ts', 'utf8');

  it('IMPORTS the three application paths rather than re-implementing them', () => {
    expect(SOURCE).toContain("from './receipts'");
    expect(SOURCE).toContain("from './inbound'");
    expect(SOURCE).toContain("from '@/core/cadence/controls'");
    // The specific decisions that must have exactly one home.
    expect(SOURCE).toContain('applyDeliveryReceipt');
    expect(SOURCE).toContain('handleInboundSms');
    expect(SOURCE).toContain('suppressFromInbound');
  });

  it('RECORDS FACTS AND NEVER CREATES SENDS (D-07)', () => {
    // A reconciliation that could send turns a provider outage into a customer
    // being messaged twice — the exact failure the whole ledger design exists
    // to prevent. Asserted against the source rather than by behaviour, because
    // the guarantee is that no such path exists at all.
    expect(SOURCE).not.toContain('sendSms');
    expect(SOURCE).not.toContain('dispatchDueTouches');
    expect(SOURCE).not.toContain('TouchSender');
    expect(SOURCE).not.toMatch(/\.send\(/);
  });

  it('interpolates ONLY counts and codes into its log lines', () => {
    const interpolated = new Set(
      [...SOURCE.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim()),
    );

    // A history row carries a customer's number and an inbound row carries
    // their words. Pinning the set makes a future `${entry.from}` a test
    // failure rather than a leak into a platform log with no tenant scoping.
    // The two `entry.*` entries left this set with CR-02's fix: the opt-out
    // probe's template literal is gone, replaced by `providerVerdictCorpus`,
    // which builds its string through `codeOf` rather than by interpolation.
    expect(interpolated).toEqual(
      new Set(['receipts.applied', 'inboundReplayed', 'optOutsRecorded', 'result.reason']),
    );
  });
});
