/**
 * Delivery receipts against the hosted Sydney database (MSG-01, T-4-15, T-4-17).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE WHERE-MATCH IS THE ENTIRE SECURITY MODEL. There is no insert path.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The DLR callback is unsigned and its token travels in a URL, so "somebody
 * else holds it" is a state to design for. What makes that survivable is that a
 * receipt can only ever ANNOTATE a row that a real send already created: the
 * update is `WHERE id = … OR provider_message_id = …`, and a payload matching
 * nothing writes nothing. A forged DLR cannot invent a send, cannot reach
 * `outcome`, and cannot reach any tenant's row it does not already know an id
 * for.
 *
 * ── WHY THIS SUITE IS REMOTE AND ITS SIBLING IS PURE ────────────────────────
 *
 * `tests/clicksend-dlr-route.test.ts` covers the gate, the parse and the uniform
 * 200 with no database at all. This file exists for the three assertions only a
 * real row can make: that the four delivery columns actually move, that
 * `outcome` and `provider_message_id` actually do NOT, and that an unmatched
 * payload leaves every row in the table byte-identical. The same split 04-02 made
 * between `clicksend-inbound-route.test.ts` and `inbound-threading.test.ts`.
 *
 * Numbers come from the `0491 570 1xx` block ACMA reserves for fiction (the
 * 04-02 rule), because this database is shared with production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyDeliveryReceipt } from '../src/core/messaging/receipts';
import { closeDb, updateDeliveryWhereMatch } from '../src/db/repository';

import { admin, seedCadence, seedQuotes, seedTenant, teardownTenants } from './helpers/seed';

interface LedgerRow {
  id: string;
  outcome: string | null;
  provider_message_id: string | null;
  delivery_status: string | null;
  delivery_detail: string | null;
  delivered_at: string | null;
  delivery_updated_at: string | null;
}

const LEDGER_COLUMNS =
  'id,outcome,provider_message_id,delivery_status,delivery_detail,delivered_at,delivery_updated_at';

describe('applyDeliveryReceipt against the hosted database', () => {
  let tenantId: string;
  let quoteId: string;
  let cadenceId: string;
  /** Matched by `custom_string` — the ledger id ClickSendSender sends. */
  let byIdLedger: string;
  /** Matched by `message_id` only — the provider-id fallback. */
  let byProviderLedger: string;

  const PROVIDER_ID = 'CS-RECEIPTS-PROVIDER-ID';

  async function readLedger(id: string): Promise<LedgerRow> {
    const { data, error } = await admin
      .from('send_ledger')
      .select(LEDGER_COLUMNS)
      .eq('id', id)
      .single();
    if (error) throw new Error(`Reading the ledger failed: ${error.message}`);
    return data as unknown as LedgerRow;
  }

  beforeAll(async () => {
    tenantId = await seedTenant('Delivery Receipts');

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'receipts: delivery is a new fact', chase_eligibility: 'eligible' },
    ]);
    quoteId = quote.id;

    cadenceId = await seedCadence(tenantId, quoteId, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Alex Receipts',
      contact_mobile: '+61491570156',
    });

    const { data, error } = await admin
      .from('send_ledger')
      .insert([
        {
          tenant_id: tenantId,
          cadence_id: cadenceId,
          quote_id: quoteId,
          touch_number: 1,
          channel: 'sms',
          to_address: '+61491570156',
          sender: 'clicksend',
          outcome: 'sent',
          provider_message_id: null,
        },
        {
          tenant_id: tenantId,
          cadence_id: cadenceId,
          quote_id: quoteId,
          touch_number: 2,
          channel: 'sms',
          to_address: '+61491570157',
          sender: 'clicksend',
          outcome: 'sent',
          provider_message_id: PROVIDER_ID,
        },
      ])
      .select('id,touch_number');
    if (error) throw new Error(`Seeding the ledger failed: ${error.message}`);

    const rows = data as { id: string; touch_number: number }[];
    byIdLedger = rows.find((row) => row.touch_number === 1)!.id;
    byProviderLedger = rows.find((row) => row.touch_number === 2)!.id;
  });

  afterAll(async () => {
    await teardownTenants([tenantId]);
    await closeDb();
  });

  /* ----------------------------------------------------------------------- *
   * The match, and what it may and may not touch
   * ----------------------------------------------------------------------- */

  it('applies a custom_string receipt to the delivery columns ONLY', async () => {
    const before = await readLedger(byIdLedger);
    expect(before.delivery_status).toBeNull();

    const result = await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status_code: '201',
      status_text: 'Delivered',
      timestamp: 1_756_351_200,
    });

    expect(result).toEqual({ kind: 'applied', ledgerId: byIdLedger });

    const after = await readLedger(byIdLedger);
    expect(after.delivery_status).toBe('delivered');
    expect(after.delivery_detail).toBe('201');
    expect(after.delivered_at).not.toBeNull();
    expect(after.delivery_updated_at).not.toBeNull();

    // THE ASSERTION THIS FILE EXISTS FOR. `outcome` answers "did the provider
    // accept it from us" and no receipt path may answer it: folding an
    // undelivered receipt into 'failed' invites the retry that messages a
    // customer twice (send-ledger.ts header, D-07).
    expect(after.outcome).toBe('sent');
    expect(after.provider_message_id).toBe(before.provider_message_id);
  });

  it('falls back to provider_message_id when only message_id is present', async () => {
    const result = await applyDeliveryReceipt({
      message_id: PROVIDER_ID,
      status_text: 'Delivered',
    });

    expect(result).toEqual({ kind: 'applied', ledgerId: byProviderLedger });

    const after = await readLedger(byProviderLedger);
    expect(after.delivery_status).toBe('delivered');
    expect(after.outcome).toBe('sent');
  });

  it('prefers custom_string over message_id when BOTH are present', async () => {
    // A payload naming one row by id and a DIFFERENT row by provider id must
    // move exactly one of them. An `OR` over both keys would annotate two rows
    // from one forged callback — which is the difference between "a receipt
    // annotates the send it belongs to" and "a receipt annotates whatever it
    // can reach".
    const beforeOther = await readLedger(byProviderLedger);

    const result = await applyDeliveryReceipt({
      custom_string: byIdLedger,
      message_id: PROVIDER_ID,
      status_text: 'Undelivered',
      error_code: '400',
    });

    expect(result).toEqual({ kind: 'applied', ledgerId: byIdLedger });

    const afterOther = await readLedger(byProviderLedger);
    expect(afterOther.delivery_updated_at).toBe(beforeOther.delivery_updated_at);
    expect(afterOther.delivery_status).toBe(beforeOther.delivery_status);

    const target = await readLedger(byIdLedger);
    expect(target.delivery_status).toBe('undelivered');
    // Set only for a delivered verdict — "when did the non-delivery happen" is
    // not a fact `delivered_at` can hold without lying about what it means.
    expect(target.delivered_at).toBeNull();
    expect(target.outcome).toBe('sent');
  });

  it('writes NOTHING for a payload that matches no row', async () => {
    const beforeA = await readLedger(byIdLedger);
    const beforeB = await readLedger(byProviderLedger);

    const result = await applyDeliveryReceipt({
      custom_string: '00000000-0000-4000-8000-0000000000ff',
      message_id: 'CS-NOT-A-REAL-MESSAGE-ID',
      status_text: 'Delivered',
    });

    expect(result).toEqual({ kind: 'unmatched' });

    // A forged DLR can only ever ANNOTATE a send that already exists. Compared
    // column by column rather than by row count, because "no new row" is a
    // weaker claim than "no existing row moved".
    expect(await readLedger(byIdLedger)).toEqual(beforeA);
    expect(await readLedger(byProviderLedger)).toEqual(beforeB);
  });

  it('treats a NON-UUID custom_string as no key at all rather than a 22P02', async () => {
    // `send_ledger.id` is a uuid column. An unvalidated `WHERE id = 'garbage'`
    // is an invalid-text-representation error raised inside the webhook — and
    // the provider's response to an error is to re-deliver for 72 hours.
    const result = await applyDeliveryReceipt({
      custom_string: 'not-a-uuid',
      status_text: 'Delivered',
    });

    expect(result).toEqual({ kind: 'unmatched' });
  });

  /* ----------------------------------------------------------------------- *
   * The status mapping
   * ----------------------------------------------------------------------- */

  it('THE SUBSTRING TRAP: "Undelivered" is undelivered, not delivered', async () => {
    // `UNDELIVERED` CONTAINS `DELIVER`. A mapping that tested the
    // delivered-class first would record the carrier's clearest possible
    // statement of failure as a success — on the column Phase 7 reads.
    await applyDeliveryReceipt({ custom_string: byIdLedger, status_text: 'Undelivered' });

    const row = await readLedger(byIdLedger);
    expect(row.delivery_status).toBe('undelivered');
  });

  it('maps a status it cannot place to "unknown" rather than guessing', async () => {
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status_text: 'Queued for onward routing',
    });

    const row = await readLedger(byIdLedger);
    // 'unknown' is a receipt that CAME and was unreadable — a different fact
    // from NULL ("none has arrived"), and a different operator response.
    expect(row.delivery_status).toBe('unknown');
    expect(row.delivered_at).toBeNull();
  });

  /* ----------------------------------------------------------------------- *
   * The two REAL payloads, captured from the first live sends (2026-08-30)
   *
   * These replace an assumption with an observation, and the assumption was
   * wrong in the direction that matters: `error_code` is populated on SUCCESS,
   * so the old "an error code is dispositive" rule recorded every delivered
   * message as undelivered. Both fixtures below are copied field-for-field from
   * ClickSend's own history rows for ledger `0711539f` and `77433ea2`.
   * ----------------------------------------------------------------------- */

  it('reads a REAL delivered receipt as delivered, error_code and all', async () => {
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status: 'Sent',
      status_code: '201',
      status_text: 'Message delivered to the handset',
      // ClickSend sends BOTH of these on a success. This is the whole finding.
      error_code: '4',
      error_text: 'Message delivered to the handset',
      timestamp: 1_788_023_160,
    });

    const row = await readLedger(byIdLedger);
    expect(row.delivery_status).toBe('delivered');
    // '201', not '4': the status pair is the diagnosis, the error pair is
    // vestigial. An operator reading `4` learns nothing.
    expect(row.delivery_detail).toBe('201');
    expect(row.delivered_at).not.toBeNull();
    expect(row.outcome).toBe('sent');
  });

  it('reads a REAL failed receipt as undelivered, and keeps the useful code', async () => {
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status: 'Failed',
      status_code: '301',
      status_text:
        'Absent Subscriber. Phone is out of range or switched off. Likely to have been unavailable for 12 hours or more.',
      error_code: '12',
      // The failure's error_text is the USELESS half of the payload — and the
      // only recognisable failure token in it, which is why `classify` reads it.
      error_text: 'Unknown error',
      timestamp: 1_788_022_080,
    });

    const row = await readLedger(byIdLedger);
    expect(row.delivery_status).toBe('undelivered');
    expect(row.delivery_detail).toBe('301');
    expect(row.delivered_at).toBeNull();
    expect(row.outcome).toBe('sent');
  });

  it('still refuses to claim delivery when the payload says a failure word', async () => {
    // The conservatism that survived the rule change: failure tokens are
    // checked BEFORE success tokens, so a payload asserting both is read as the
    // one that does not tell an operator a customer received something.
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status_text: 'Delivered',
      error_text: 'Rejected by carrier',
    });

    const row = await readLedger(byIdLedger);
    expect(row.delivery_status).toBe('undelivered');
    expect(row.delivered_at).toBeNull();
  });

  it('stores a bounded CODE in delivery_detail, never provider prose (T-4-17)', async () => {
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status_text: `could not deliver to +61491570156 because the handset ${'x'.repeat(200)}`,
    });

    const row = await readLedger(byIdLedger);
    const detail = row.delivery_detail!;
    // The column is rendered on the operator's screen and this value is a third
    // party's free text. The length cap is what actually bounds the damage — a
    // phone number survives uppercasing as digits.
    expect(detail.length).toBeLessThanOrEqual(48);
    expect(detail).not.toContain('61491570156');
    expect(detail).toMatch(/^[A-Z0-9_]+$/);
  });

  /* ----------------------------------------------------------------------- *
   * The timestamp unit, and its research-A1 backstop
   * ----------------------------------------------------------------------- */

  it('reads a numeric timestamp below the boundary as epoch SECONDS', async () => {
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status_text: 'Delivered',
      timestamp: 1_756_351_200,
    });

    const row = await readLedger(byIdLedger);
    expect(new Date(row.delivered_at!).toISOString()).toBe('2025-08-28T03:20:00.000Z');
  });

  it('reads a numeric timestamp at or above the boundary as MILLISECONDS', async () => {
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status_text: 'Delivered',
      timestamp: 1_756_351_200_000,
    });

    const row = await readLedger(byIdLedger);
    // The same instant. Interpreting milliseconds as seconds would land in the
    // year 57644 — a `delivered_at` no operator query would ever return.
    expect(new Date(row.delivered_at!).toISOString()).toBe('2025-08-28T03:20:00.000Z');
  });

  it('prefers timestamp_send when no delivery timestamp is present', async () => {
    await applyDeliveryReceipt({
      custom_string: byIdLedger,
      status_text: 'Delivered',
      timestamp_send: 1_756_351_200,
    });

    const row = await readLedger(byIdLedger);
    expect(new Date(row.delivered_at!).toISOString()).toBe('2025-08-28T03:20:00.000Z');
  });

  /* ----------------------------------------------------------------------- *
   * The repository, driven directly
   * ----------------------------------------------------------------------- */

  it('updateDeliveryWhereMatch with NEITHER key writes nothing and returns []', async () => {
    const before = await readLedger(byIdLedger);

    const rows = await updateDeliveryWhereMatch({
      status: 'delivered',
      detail: 'X',
      deliveredAt: new Date(),
    });

    // No predicate means no statement. A `WHERE true` here would stamp every
    // row in the table — every client's — from one empty callback.
    expect(rows).toEqual([]);
    expect(await readLedger(byIdLedger)).toEqual(before);
  });

  it('the repository module contains no INSERT — it is update-only by construction', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/db/repository/delivery-receipts.ts', 'utf8');

    // The security argument is structural, not behavioural: there is no code
    // path from a delivery receipt to a new ledger row, so a forged callback
    // cannot invent a send even if every other guard were wrong.
    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\binsert into\b/i);
  });
});
