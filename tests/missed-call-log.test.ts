/**
 * D-02 — THE CLIENT PAGE'S MISSED-CALL LOG READ (Phase 15, plan 15-03; CON-05).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   D-02 — `forTenant(t).missedCalls.listForLog({ before?, limit })` pages this
 *          client's diverted calls NEWEST FIRST over `(started_at DESC, id
 *          DESC)` with a STRICT keyset cursor: page two holds exactly the rows
 *          strictly older than page one's last row, and two calls at the same
 *          instant split across the boundary by id with no duplicate and no
 *          loss. Never an OFFSET.
 *        — each row carries the ledger's delivery verdict, the skip reason, the
 *          lead's status and reason, the quote id of a quote-route call and the
 *          pseudonymisation stamp; a dead letter (no tenant) never appears; a
 *          second tenant's calls never appear.
 *        — `missedCalls.countInWindow(since)` counts only this client's calls
 *          at or after `since`.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production.
 * Tenant rows are swept by `teardownTenants` in `afterAll`; the one DEAD
 * LETTER (no tenant, so no teardown can reach it) is deleted BY ID, first.
 * The clock is pinned. Every assertion is keyed on this suite's own tenants
 * and ids; the suite compares values and counts rows and never prints a
 * number. Every number is from ACMA's fiction block, in the Phase 15
 * missed-call-log sub-block (0491 570 33x) no other suite uses (research
 * Pitfall 10).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, forTenant, type MissedCallLogRow } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedLead,
  seedLeadCadence,
  seedLedgerRow,
  seedMissedCall,
  seedQuotes,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** THE PINNED CLOCK: Tuesday 13 October 2026, 10:00 in Perth (02:00 UTC). */
const NOW = new Date('2026-10-13T02:00:00.000Z');

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** Fiction-block callers, the 0491 570 33x sub-block. */
const PAGING_CALLER = '+61491570331';
const SENT_CALLER = '+61491570332';
const STALE_CALLER = '+61491570333';
const QUOTE_CALLER = '+61491570334';
const STAMPED_CALLER = '+61491570335';
const OLD_CALLER = '+61491570336';
const OTHER_TENANT_CALLER = '+61491570337';
const DEAD_LETTER_CALLER = '+61491570338';

const tenantIds: string[] = [];
const deadLetterIds: string[] = [];

/** The paging tenant holds EXACTLY 23 calls; the facts tenant holds the per-row cases. */
let pagingTenant = '';
let factsTenant = '';
let otherTenant = '';

/** The paging tenant's 23 ids in the order the log must return them. */
let expectedOrder: string[] = [];
/** The two calls on one instant, the higher id first. */
let tiedHigh = '';
let tiedLow = '';

let sentCall = '';
let sentLead = '';
let sentCadence = '';
let sentLedger = '';
let staleCall = '';
let quoteCall = '';
let quoteId = '';
let stampedCall = '';
let oldCall = '';
let otherTenantCall = '';

const STAMPED_AT = at(NOW, -MS_PER_DAY);

function ids(rows: MissedCallLogRow[]): string[] {
  return rows.map((row) => row.id);
}

beforeAll(async () => {
  pagingTenant = await seedTenant('Call Log Paging');
  tenantIds.push(pagingTenant);
  factsTenant = await seedTenant('Call Log Facts');
  tenantIds.push(factsTenant);
  otherTenant = await seedTenant('Call Log Other');
  tenantIds.push(otherTenant);

  // ── 23 CALLS: 21 distinct instants, NOW − k minutes for k = 1..22 with k = 20
  // carrying TWO calls. Sorted newest first, the pair lands at positions 20
  // and 21 — exactly across the boundary of a 20-row page.
  const seeded: Array<{ id: string; startedAt: Date }> = [];
  for (let k = 1; k <= 22; k += 1) {
    const startedAt = at(NOW, -k * MS_PER_MINUTE);
    const copies = k === 20 ? 2 : 1;
    for (let c = 0; c < copies; c += 1) {
      const id = await seedMissedCall(pagingTenant, {}, { caller: PAGING_CALLER, startedAt });
      seeded.push({ id, startedAt });
    }
  }
  expectedOrder = [...seeded]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || (a.id < b.id ? 1 : -1))
    .map((row) => row.id);
  const pair = seeded.filter((row) => row.startedAt.getTime() === at(NOW, -20 * MS_PER_MINUTE).getTime());
  [tiedLow, tiedHigh] = pair.map((row) => row.id).sort();

  // ── THE FACTS TENANT ──────────────────────────────────────────────────────

  // A SENT lead-route text-back whose ledger row the receipt marked delivered,
  // on a lead since closed `complaint`.
  sentLead = await seedLead(factsTenant, {
    contact_mobile: SENT_CALLER,
    first_missed_at: at(NOW, -2 * 3_600_000).toISOString(),
    last_missed_at: at(NOW, -2 * 3_600_000).toISOString(),
    status: 'closed',
    closed_reason: 'complaint',
    closed_at: at(NOW, -3_600_000).toISOString(),
  });
  sentCadence = await seedLeadCadence(factsTenant, sentLead, {
    contact_mobile: SENT_CALLER,
    status: 'stopped',
    stop_reason: 'lead_closed',
  });
  sentLedger = await seedLedgerRow(factsTenant, {
    cadenceId: sentCadence,
    quoteId: null,
    leadId: sentLead,
    touchNumber: 0,
    claimedAt: at(NOW, -2 * 3_600_000 + 20_000).toISOString(),
    toAddress: SENT_CALLER,
    deliveryStatus: 'delivered',
    deliveredAt: at(NOW, -2 * 3_600_000 + 45_000).toISOString(),
  });
  sentCall = await seedMissedCall(
    factsTenant,
    {
      text_back_status: 'sent',
      text_back_route: 'lead',
      text_back_decided_at: at(NOW, -2 * 3_600_000 + 15_000).toISOString(),
      lead_id: sentLead,
      cadence_id: sentCadence,
      text_back_ledger_id: sentLedger,
    },
    { caller: SENT_CALLER, startedAt: at(NOW, -2 * 3_600_000) },
  );

  // A call decided too late: skipped `stale`.
  staleCall = await seedMissedCall(
    factsTenant,
    {
      text_back_status: 'skipped',
      text_back_skip_reason: 'stale',
      text_back_decided_at: at(NOW, -3 * 3_600_000).toISOString(),
    },
    { caller: STALE_CALLER, startedAt: at(NOW, -4 * 3_600_000), afterHours: true },
  );

  // A QUOTE-route call: an open quote's customer rang, so the quote cadence
  // carries the conversation and the call reads the quote's id through it.
  const [quote] = await seedQuotes(factsTenant, [{}]);
  quoteId = quote!.id;
  const quoteCadence = await seedCadence(factsTenant, quoteId, {
    sm8_job_uuid: quote!.sm8_job_uuid,
    contact_mobile: QUOTE_CALLER,
  });
  quoteCall = await seedMissedCall(
    factsTenant,
    {
      text_back_status: 'skipped',
      text_back_skip_reason: 'quote_open',
      text_back_route: 'quote',
      text_back_decided_at: at(NOW, -5 * 3_600_000).toISOString(),
      cadence_id: quoteCadence,
    },
    { caller: QUOTE_CALLER, startedAt: at(NOW, -5 * 3_600_000) },
  );

  // A row the privacy pass has stamped (the stamp column is 0042's).
  stampedCall = await seedMissedCall(
    factsTenant,
    { pseudonymised_at: STAMPED_AT.toISOString() },
    { caller: STAMPED_CALLER, startedAt: at(NOW, -6 * 3_600_000) },
  );

  // Outside a 30-day window.
  oldCall = await seedMissedCall(factsTenant, {}, { caller: OLD_CALLER, startedAt: at(NOW, -45 * MS_PER_DAY) });

  // ANOTHER tenant's call, newer than all of the above.
  otherTenantCall = await seedMissedCall(
    otherTenant,
    {},
    { caller: OTHER_TENANT_CALLER, startedAt: at(NOW, -30_000) },
  );

  // A DEAD LETTER (no tenant), newest of all. Deleted by id in afterAll.
  deadLetterIds.push(
    await seedMissedCall(null, {}, { caller: DEAD_LETTER_CALLER, startedAt: at(NOW, -10_000) }),
  );
});

afterAll(async () => {
  // BY ID and FIRST: a dead letter carries no tenant, so no teardown reaches it.
  if (deadLetterIds.length > 0) {
    const { error } = await admin.from('missed_calls').delete().in('id', deadLetterIds);
    if (error) throw new Error(`Teardown failed, dead letters left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

describe('listForLog — newest first, keyset-paged (D-02)', () => {
  it('returns the 20 newest in (started_at DESC, id DESC)', async () => {
    const page = await forTenant(pagingTenant).missedCalls.listForLog({ limit: 20 });

    expect(ids(page)).toEqual(expectedOrder.slice(0, 20));
    // The higher id of the tied pair closes page one.
    expect(page[19]!.id).toBe(tiedHigh);
  });

  it('pages strictly older than the cursor, with no duplicate and no loss across a tie', async () => {
    const first = await forTenant(pagingTenant).missedCalls.listForLog({ limit: 20 });
    const last = first[first.length - 1]!;
    const second = await forTenant(pagingTenant).missedCalls.listForLog({
      before: { startedAt: last.startedAt, id: last.id },
      limit: 20,
    });

    expect(ids(second)).toEqual(expectedOrder.slice(20));
    expect(second).toHaveLength(3);
    // The lower id of the tied pair opens page two — on the same instant as
    // the cursor, admitted only because its id is smaller.
    expect(second[0]!.id).toBe(tiedLow);
    expect(second[0]!.startedAt).toEqual(last.startedAt);

    const both = [...ids(first), ...ids(second)];
    expect(new Set(both).size).toBe(23);
    expect(both).toEqual(expectedOrder);
  });

  it('returns nothing past the oldest row', async () => {
    const all = await forTenant(pagingTenant).missedCalls.listForLog({ limit: 100 });
    const oldest = all[all.length - 1]!;

    expect(all).toHaveLength(23);
    expect(
      await forTenant(pagingTenant).missedCalls.listForLog({
        before: { startedAt: oldest.startedAt, id: oldest.id },
        limit: 20,
      }),
    ).toEqual([]);
  });
});

describe('listForLog — the per-row facts (D-02)', () => {
  async function rowsById(): Promise<Map<string, MissedCallLogRow>> {
    const rows = await forTenant(factsTenant).missedCalls.listForLog({ limit: 100 });
    return new Map(rows.map((row) => [row.id, row]));
  }

  it('reads a sent text-back\'s delivery verdict, its lead\'s status and reason', async () => {
    const row = (await rowsById()).get(sentCall)!;

    expect(row.textBackStatus).toBe('sent');
    expect(row.textBackRoute).toBe('lead');
    expect(row.textBackSkipReason).toBeNull();
    expect(row.textBackLedgerId).toBe(sentLedger);
    expect(row.deliveryStatus).toBe('delivered');
    expect(row.leadId).toBe(sentLead);
    expect(row.leadStatus).toBe('closed');
    expect(row.leadClosedReason).toBe('complaint');
    expect(row.cadenceId).toBe(sentCadence);
    // A lead cadence has no quote.
    expect(row.quoteId).toBeNull();
    expect(row.callerKind).toBe('mobile');
    expect(row.callerE164).toBe(SENT_CALLER);
    expect(row.afterHours).toBe(false);
    expect(row.pseudonymisedAt).toBeNull();
  });

  it('reads a skipped call\'s reason, with no verdict and no lead', async () => {
    const row = (await rowsById()).get(staleCall)!;

    expect(row.textBackStatus).toBe('skipped');
    expect(row.textBackSkipReason).toBe('stale');
    expect(row.deliveryStatus).toBeNull();
    expect(row.leadStatus).toBeNull();
    expect(row.leadClosedReason).toBeNull();
    expect(row.afterHours).toBe(true);
  });

  it('reads the quote id of a quote-route call through its cadence', async () => {
    const row = (await rowsById()).get(quoteCall)!;

    expect(row.textBackRoute).toBe('quote');
    expect(row.textBackSkipReason).toBe('quote_open');
    expect(row.quoteId).toBe(quoteId);
  });

  it('reads the pseudonymisation stamp back', async () => {
    const row = (await rowsById()).get(stampedCall)!;

    expect(row.pseudonymisedAt).toEqual(STAMPED_AT);
  });

  it('never returns a dead letter or another tenant\'s call', async () => {
    const facts = await rowsById();
    const paging = await forTenant(pagingTenant).missedCalls.listForLog({ limit: 100 });
    const seen = new Set([...facts.keys(), ...ids(paging)]);

    for (const id of [...deadLetterIds, otherTenantCall]) expect(seen.has(id)).toBe(false);
    expect(facts.size).toBe(5);
    expect(facts.has(oldCall)).toBe(true);

    const other = await forTenant(otherTenant).missedCalls.listForLog({ limit: 100 });
    expect(ids(other)).toEqual([otherTenantCall]);
  });

  it('names every column it returns — no raw payload, no CallSid, no forwarded number', async () => {
    const [row] = await forTenant(factsTenant).missedCalls.listForLog({ limit: 1 });

    expect(Object.keys(row!).sort()).toEqual(
      [
        'afterHours',
        'cadenceId',
        'callerE164',
        'callerKind',
        'deliveryStatus',
        'id',
        'leadClosedReason',
        'leadId',
        'leadStatus',
        'pseudonymisedAt',
        'quoteId',
        'startedAt',
        'textBackDecidedAt',
        'textBackLedgerId',
        'textBackRoute',
        'textBackSkipReason',
        'textBackStatus',
      ].sort(),
    );
  });
});

describe('countInWindow — the state line\'s count (D-02)', () => {
  it('counts only this client\'s calls at or after the instant', async () => {
    const since = at(NOW, -30 * MS_PER_DAY);

    // Four of the facts tenant's five calls are inside 30 days; the fifth is 45 days old.
    expect(await forTenant(factsTenant).missedCalls.countInWindow(since)).toBe(4);
    expect(await forTenant(pagingTenant).missedCalls.countInWindow(since)).toBe(23);
    expect(await forTenant(otherTenant).missedCalls.countInWindow(since)).toBe(1);
    // At the instant is inside.
    expect(
      await forTenant(factsTenant).missedCalls.countInWindow(at(NOW, -6 * 3_600_000)),
    ).toBe(4);
    expect(
      await forTenant(factsTenant).missedCalls.countInWindow(at(NOW, -6 * 3_600_000 + 1)),
    ).toBe(3);
  });
});
