/**
 * D-03 / D-10 — THE MISSED-CALL FIGURE COUNTS, IN THE TENANT'S ZONE (Phase 15,
 * plan 15-03; RPT-04).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   D-03 — `forTenant(t).metrics.missedCallCounts(period, timezone)` counts a
 *          HALF-OPEN calendar month cut in the client's zone: a call at 23:30
 *          Perth on the last day of the previous month and one at exactly
 *          00:00 Perth on the first of the next are outside; one at 00:30
 *          Perth on the 1st (16:30 UTC on the previous day) is inside.
 *        — the hour and weekday buckets are computed IN SQL in the TENANT's
 *          zone: the 00:30 Perth call lands in hour 0 on Tuesday (its UTC
 *          clock reads 16:30 on Monday), the 23:30 Perth call in hour 23 on
 *          Wednesday (15:30 UTC). The arrays have 24 / 7 / 7 entries and each
 *          sums to its count.
 *        — text-backs SENT are lead-route `sent` rows (a quote-route one is
 *          not); DELIVERED are those whose ledger receipt says `delivered`;
 *          each delivered one carries ONE whole-second duration from arrival
 *          (`started_at`) to the receipt instant (`delivered_at`), CLAMPED at
 *          zero when the provider's clock reads earlier than ours.
 *        — replied leads are counted ONCE each, on the DELIVERED set: a lead
 *          with two threaded replies counts one; a lead whose text-back was
 *          undelivered never counts.
 *        — the funnel counts leads OPENED in the period: jobs created by the
 *          operator's tap, of those the ones the mirror shows won (`Work
 *          Order`/`Completed`, a COUNT), and tradie-booked resolutions.
 *        — a second tenant's rows change nothing.
 *   D-10 — counts only cross the boundary: no rate, median or percentile is
 *          returned (the pure derivation, `tests/missed-call-figures.test.ts`,
 *          owns those).
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production.
 * Every row is TENANT-SCOPED and swept by `teardownTenants` in `afterAll`.
 * Every instant is written out. The suite compares counts and never prints a
 * number. Every number is from ACMA's fiction block, in the Phase 15
 * report-missed-calls sub-block (0491 570 34x) no other suite uses (research
 * Pitfall 10); every word is invented.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MissedCallCounts } from '../src/core/reporting/missed-call-figures';
import { calendarMonth } from '../src/core/reporting/period';
import { closeDb, forTenant } from '../src/db/repository';

import {
  seedInbound,
  seedLead,
  seedLeadCadence,
  seedLedgerRow,
  seedMissedCall,
  seedQuotes,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const PERTH = 'Australia/Perth';
/** September 2026 in Perth: [2026-08-31T16:00Z, 2026-09-30T16:00Z). */
const PERIOD = calendarMonth(PERTH, 2026, 9);

/** Fiction-block callers, the 0491 570 34x sub-block. */
const MIDNIGHT_CALLER = '+61491570341';
const UNDELIVERED_CALLER = '+61491570342';
const SKEW_CALLER = '+61491570343';
const QUOTE_ROUTE_CALLER = '+61491570344';
const BEFORE_CALLER = '+61491570345';
const AFTER_CALLER = '+61491570346';
const EARLIER_LEAD_CALLER = '+61491570347';
const OTHER_TENANT_CALLER = '+61491570348';

/** Instants, written in Perth time (UTC+08:00, no DST). */
const C1_MIDNIGHT = new Date('2026-09-01T00:30:00+08:00'); // Tue, hour 0 (16:30 Mon UTC)
const C3_LAST_NIGHT = new Date('2026-09-30T23:30:00+08:00'); // Wed, hour 23 (15:30 Wed UTC)
const C4_TUESDAY = new Date('2026-09-15T10:00:00+08:00'); // Tue, hour 10
const C5_WEDNESDAY = new Date('2026-09-16T11:00:00+08:00'); // Wed, hour 11
const C6_THURSDAY = new Date('2026-09-17T12:00:00+08:00'); // Thu, hour 12
const BEFORE_PERIOD = new Date('2026-08-31T23:30:00+08:00'); // the previous month
const AT_PERIOD_END = new Date('2026-10-01T00:00:00+08:00'); // the end, exclusive

const tenantIds: string[] = [];
let tenant = '';
let otherTenant = '';

function plus(base: Date, ms: number): string {
  return new Date(base.getTime() + ms).toISOString();
}

/**
 * A CONVERTED lead opened at `openedAt`, with a stopped lead cadence and,
 * when `textBack` is given, its touch-0 ledger row and a SENT lead-route
 * missed call pointing at it. Returns the lead and cadence ids.
 */
async function leadWithTextBack(
  tenantId: string,
  input: {
    mobile: string;
    openedAt: Date;
    lead: Record<string, unknown>;
    textBack?: { deliveryStatus: string | null; deliveredAt: string | null; afterHours: boolean };
  },
): Promise<{ leadId: string; cadenceId: string }> {
  const leadId = await seedLead(tenantId, {
    contact_mobile: input.mobile,
    first_missed_at: input.openedAt.toISOString(),
    last_missed_at: input.openedAt.toISOString(),
    ...input.lead,
  });
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: input.mobile,
    status: 'stopped',
    stop_reason: 'lead_closed',
    anchor_at: input.openedAt.toISOString(),
  });

  if (input.textBack !== undefined) {
    const ledgerId = await seedLedgerRow(tenantId, {
      cadenceId,
      quoteId: null,
      leadId,
      touchNumber: 0,
      claimedAt: plus(input.openedAt, 20_000),
      toAddress: input.mobile,
      deliveryStatus: input.textBack.deliveryStatus,
      deliveredAt: input.textBack.deliveredAt,
    });
    await seedMissedCall(
      tenantId,
      {
        text_back_status: 'sent',
        text_back_route: 'lead',
        text_back_decided_at: plus(input.openedAt, 15_000),
        lead_id: leadId,
        cadence_id: cadenceId,
        text_back_ledger_id: ledgerId,
      },
      { caller: input.mobile, startedAt: input.openedAt, afterHours: input.textBack.afterHours },
    );
  }

  return { leadId, cadenceId };
}

/** A converted lead's closing columns, by reason. */
function converted(reason: 'job_created' | 'booked_by_tradie', jobUuid: string, at: Date) {
  return {
    status: 'converted',
    closed_reason: reason,
    closed_at: at.toISOString(),
    sm8_job_uuid: jobUuid,
    ...(reason === 'job_created'
      ? { sm8_job_state: 'created', sm8_job_created_at: at.toISOString() }
      : {}),
  };
}

let counts: MissedCallCounts;

beforeAll(async () => {
  tenant = await seedTenant('Missed Call Figures');
  tenantIds.push(tenant);
  otherTenant = await seedTenant('Missed Call Figures Other');
  tenantIds.push(otherTenant);

  const wonJob = randomUUID();
  const openJob = randomUUID();
  const bookedJob = randomUUID();
  const earlierJob = randomUUID();
  await seedQuotes(tenant, [
    { sm8_job_uuid: wonJob, status: 'Work Order' },
    { sm8_job_uuid: openJob, status: 'Quote' },
    { sm8_job_uuid: earlierJob, status: 'Completed' },
  ]);

  // C1 — 00:30 Perth on the 1st, after hours: DELIVERED 42 s after arrival.
  // Its lead: created by the operator's tap, the mirror shows the job WON, and
  // the caller replied twice (one replied lead, not two).
  const c1 = await leadWithTextBack(tenant, {
    mobile: MIDNIGHT_CALLER,
    openedAt: C1_MIDNIGHT,
    lead: converted('job_created', wonJob, new Date('2026-09-03T09:00:00+08:00')),
    textBack: { deliveryStatus: 'delivered', deliveredAt: plus(C1_MIDNIGHT, 42_000), afterHours: true },
  });
  for (const [minutes, body] of [
    [5, 'Water is coming through the ceiling light'],
    [9, 'Can someone come today'],
  ] as const) {
    await seedInbound(tenant, {
      cadenceId: c1.cadenceId,
      quoteId: null,
      leadId: c1.leadId,
      receivedAt: plus(C1_MIDNIGHT, minutes * 60_000),
      fromAddress: MIDNIGHT_CALLER,
      body,
    });
  }

  // C4 — a Tuesday morning, UNDELIVERED. Its lead: created, the job still a
  // quote. A reply on an undelivered text-back is not counted.
  const c4 = await leadWithTextBack(tenant, {
    mobile: UNDELIVERED_CALLER,
    openedAt: C4_TUESDAY,
    lead: converted('job_created', openJob, new Date('2026-09-16T09:00:00+08:00')),
    textBack: { deliveryStatus: 'undelivered', deliveredAt: null, afterHours: false },
  });
  await seedInbound(tenant, {
    cadenceId: c4.cadenceId,
    quoteId: null,
    leadId: c4.leadId,
    receivedAt: plus(C4_TUESDAY, 30 * 60_000),
    fromAddress: UNDELIVERED_CALLER,
    body: 'Reached you another way',
  });

  // C5 — a Wednesday, DELIVERED with the provider's receipt 5 s BEFORE our
  // arrival instant: clamped to 0. Its lead: the tradie booked it himself.
  await leadWithTextBack(tenant, {
    mobile: SKEW_CALLER,
    openedAt: C5_WEDNESDAY,
    lead: converted('booked_by_tradie', bookedJob, new Date('2026-09-18T09:00:00+08:00')),
    textBack: { deliveryStatus: 'delivered', deliveredAt: plus(C5_WEDNESDAY, -5_000), afterHours: false },
  });

  // C3 — 23:30 Perth on the LAST day, after hours, WITHHELD: no text-back.
  await seedMissedCall(
    tenant,
    { text_back_status: 'skipped', text_back_skip_reason: 'withheld', text_back_decided_at: plus(C3_LAST_NIGHT, 10_000) },
    { caller: null, startedAt: C3_LAST_NIGHT, afterHours: true },
  );

  // C6 — a Thursday, a QUOTE-route text-back marked sent: the quote engine's
  // touch 0, not a lead text-back. Captured, not counted as sent.
  await seedMissedCall(
    tenant,
    { text_back_status: 'sent', text_back_route: 'quote', text_back_decided_at: plus(C6_THURSDAY, 10_000) },
    { caller: QUOTE_ROUTE_CALLER, startedAt: C6_THURSDAY },
  );

  // OUTSIDE the period at both ends.
  await seedMissedCall(tenant, {}, { caller: BEFORE_CALLER, startedAt: BEFORE_PERIOD, afterHours: true });
  await seedMissedCall(tenant, {}, { caller: AFTER_CALLER, startedAt: AT_PERIOD_END, afterHours: true });

  // A lead opened in the PREVIOUS month whose job is created and completed:
  // not in this month's funnel.
  await seedLead(tenant, {
    contact_mobile: EARLIER_LEAD_CALLER,
    first_missed_at: BEFORE_PERIOD.toISOString(),
    last_missed_at: BEFORE_PERIOD.toISOString(),
    ...converted('job_created', earlierJob, new Date('2026-09-02T09:00:00+08:00')),
  });

  // ANOTHER tenant: a delivered text-back, a created-and-won lead, a reply —
  // all inside the period. None of it may reach the first tenant's counts.
  const otherJob = randomUUID();
  await seedQuotes(otherTenant, [{ sm8_job_uuid: otherJob, status: 'Completed' }]);
  const other = await leadWithTextBack(otherTenant, {
    mobile: OTHER_TENANT_CALLER,
    openedAt: C4_TUESDAY,
    lead: converted('job_created', otherJob, new Date('2026-09-20T09:00:00+08:00')),
    textBack: { deliveryStatus: 'delivered', deliveredAt: plus(C4_TUESDAY, 7_000), afterHours: true },
  });
  await seedInbound(otherTenant, {
    cadenceId: other.cadenceId,
    quoteId: null,
    leadId: other.leadId,
    receivedAt: plus(C4_TUESDAY, 60_000),
    fromAddress: OTHER_TENANT_CALLER,
    body: 'Thanks',
  });

  counts = await forTenant(tenant).metrics.missedCallCounts(PERIOD, PERTH);
});

afterAll(async () => {
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe('missedCallCounts — the calls in the month, in the tenant zone (D-03)', () => {
  it('cuts the period half-open in Perth', () => {
    expect(PERIOD.start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(PERIOD.end.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });

  it('captures the five calls inside the month, one withheld, two after hours', () => {
    expect(counts.captured).toBe(5);
    expect(counts.withheld).toBe(1);
    expect(counts.afterHours).toBe(2);
  });

  it('buckets by the PERTH hour, not the UTC hour', () => {
    const expected = Array.from({ length: 24 }, () => 0);
    for (const hour of [0, 10, 11, 12, 23]) expected[hour] = 1;

    expect(counts.byHour).toHaveLength(24);
    expect(counts.byHour).toEqual(expected);
    // The 00:30 Perth call reads 16:30 in UTC; the 23:30 one reads 15:30.
    expect(counts.byHour[16]).toBe(0);
    expect(counts.byHour[15]).toBe(0);
    expect(sum(counts.byHour)).toBe(counts.captured);
  });

  it('buckets by the PERTH ISO weekday, Monday first', () => {
    // Tue: C1 (Monday in UTC) and C4. Wed: C3 and C5. Thu: C6.
    expect(counts.byIsoWeekday).toEqual([0, 2, 2, 1, 0, 0, 0]);
    // After hours: C1 on Tuesday, C3 on Wednesday.
    expect(counts.afterHoursByIsoWeekday).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(sum(counts.byIsoWeekday)).toBe(counts.captured);
    expect(sum(counts.afterHoursByIsoWeekday)).toBe(counts.afterHours);
  });
});

describe('missedCallCounts — text-backs, delivery and replies (D-03, D-10)', () => {
  it('counts lead-route sends, and DELIVERED by the ledger receipt', () => {
    // C1, C4 and C5 are lead-route sends; C6 is a quote-route one.
    expect(counts.textBacksSent).toBe(3);
    expect(counts.textBacksDelivered).toBe(2);
  });

  it('carries one whole-second duration per delivered text-back, clamped at zero', () => {
    expect([...counts.deliveredSeconds].sort((a, b) => a - b)).toEqual([0, 42]);
    for (const seconds of counts.deliveredSeconds) expect(Number.isInteger(seconds)).toBe(true);
  });

  it('counts a replied lead ONCE, and only on a delivered text-back', () => {
    // C1's lead replied twice; C4's reply came on an undelivered text.
    expect(counts.repliedLeadsOnDelivered).toBe(1);
  });
});

describe('missedCallCounts — the funnel (D-03)', () => {
  it('counts leads opened in the month, jobs created, won in the mirror, and tradie-booked', () => {
    expect(counts.leads).toBe(3);
    expect(counts.jobsCreated).toBe(2);
    expect(counts.jobsWon).toBe(1);
    expect(counts.bookedByTradie).toBe(1);
  });
});

describe('missedCallCounts — counts only, one tenant (D-03)', () => {
  it('returns exactly the counts record — no rate, no median, no number', () => {
    expect(Object.keys(counts).sort()).toEqual(
      [
        'afterHours',
        'afterHoursByIsoWeekday',
        'byHour',
        'byIsoWeekday',
        'bookedByTradie',
        'captured',
        'deliveredSeconds',
        'jobsCreated',
        'jobsWon',
        'leads',
        'repliedLeadsOnDelivered',
        'textBacksDelivered',
        'textBacksSent',
        'withheld',
      ].sort(),
    );
    expect(JSON.stringify(counts)).not.toContain('+61');
  });

  it('keeps the other tenant\'s rows out, and counts them for that tenant alone', async () => {
    const other = await forTenant(otherTenant).metrics.missedCallCounts(PERIOD, PERTH);

    expect(other.captured).toBe(1);
    expect(other.textBacksDelivered).toBe(1);
    expect(other.deliveredSeconds).toEqual([7]);
    expect(other.repliedLeadsOnDelivered).toBe(1);
    expect(other.jobsWon).toBe(1);
    // Re-read: the first tenant's counts are unchanged by the second's existence.
    expect(await forTenant(tenant).metrics.missedCallCounts(PERIOD, PERTH)).toEqual(counts);
  });

  it('gives a month with no calls zeros and full-length empty buckets', async () => {
    const empty = await forTenant(tenant).metrics.missedCallCounts(calendarMonth(PERTH, 2026, 7), PERTH);

    expect(empty.captured).toBe(0);
    expect(empty.byHour).toEqual(Array.from({ length: 24 }, () => 0));
    expect(empty.byIsoWeekday).toEqual(Array.from({ length: 7 }, () => 0));
    expect(empty.afterHoursByIsoWeekday).toEqual(Array.from({ length: 7 }, () => 0));
    expect(empty.deliveredSeconds).toEqual([]);
    expect(empty.leads).toBe(0);
  });
});
