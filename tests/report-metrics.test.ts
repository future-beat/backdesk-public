/**
 * RPT-03 AGAINST THE REAL DATABASE: the instrument panel counts what it says it
 * counts, and it counts it for ONE client at a time.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS SUITE EXISTS. Every metric on `/reports` is an EXCLUSION as     │
 * │ much as a count, and every exclusion is invisible in a passing page      │
 * │ render. A first-touch rate that quietly counted quotes opened before the │
 * │ client could send would blame the service for messages it was forbidden  │
 * │ to send; an opt-out rate that counted the Phase 4 STOP fan-out would put │
 * │ a red badge on every client in the same minute because one stranger      │
 * │ texted the shared number. Both are arithmetic that LOOKS right.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the fixture is built around the exclusions rather than around the happy
 * path: tenant A has one quote opened BEFORE it was onboarded and one after,
 * one suppression against an address we messaged and one against an address we
 * never did, one edited draft and one untouched. Tenant B exists to prove the
 * grouping is a grouping — its single ledger row must not appear in A's counts,
 * and A's replies, opt-outs, drafts and money must not appear in B's.
 *
 * AND THE PRIVACY HALF IS ASSERTED TWICE. `forAllTenants_reportMetrics` escapes
 * tenant scoping (T-7-23), so the suite checks both the SHAPE — no select list
 * in the accessor yields an address, a body or a customer name — and the
 * BEHAVIOUR: the stringified result of a fixture built entirely from phone
 * numbers and email-shaped strings contains no `@` and no `+61`.
 *
 * REMOTE. It seeds and tears down against the hosted Sydney project, so it runs
 * only under `npm run test:remote`.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OPT_OUT_ALARM_MIN_CONTACTS } from '@/core/audit/constants';
import {
  computeTenantMetrics,
  LIVE_METRICS_WINDOW_DAYS,
  OPT_OUT_ALARM_BP,
  type TenantMetricCounts,
} from '@/core/reporting/metrics';
import { rollingWindow } from '@/core/reporting/period';
import { closeDb, forAllTenants_reportMetrics, forTenant } from '@/db/repository';

import {
  admin,
  seedApprovedDraft,
  seedAttestation,
  seedAttribution,
  seedCadence,
  seedDivertNumber,
  seedFee,
  seedInbound,
  seedLead,
  seedLeadCadence,
  seedLedgerRow,
  seedMessageTemplate,
  seedMissedCall,
  seedQuotes,
  seedSuppression,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const ACCESSOR_SOURCE = 'src/db/repository/for-all-tenants.ts';

/**
 * The fixture's clock, fixed at module load.
 *
 * Everything is seeded at an explicit offset from it, and the WINDOW is built
 * from a `now` read after seeding — so the rows whose timestamp the database
 * chooses (`suppressed_contacts.created_at` is `defaultNow()`) land strictly
 * inside `[now − 30d, now]` rather than a millisecond past its end.
 */
const BASE = new Date();
const daysAgo = (days: number): Date => new Date(BASE.getTime() - days * 86_400_000);

/** The address `seedLedgerRow` sends to — ACMA fiction range, never a real mobile. */
const MESSAGED_ADDRESS = '+61491570156';
/** An address nobody was ever messaged at. The A6 exclusion's whole point. */
const NEVER_MESSAGED_ADDRESS = '+61491570199';
/** A caller who rang A, was missed, and got the text-back (12-REVIEW WR-03). */
const TEXT_BACK_ADDRESS = '+61491570177';

let tenantA: string;
let tenantB: string;
let nameA: string;
let nameB: string;

/** When A became able to send: the LATER of first template approval and first attestation. */
const A_TEMPLATE_APPROVED_AT = daysAgo(20);
const A_ATTESTED_AT = daysAgo(25);
/** Opened BEFORE `A_TEMPLATE_APPROVED_AT` — inside the window, outside the metric. */
const A_PRE_ONBOARDING_OPENED_AT = daysAgo(22);
/** Opened after onboarding — the one quote the first-touch rate is about. */
const A_OPENED_AT = daysAgo(10);

beforeAll(async () => {
  tenantA = await seedTenant('Report Metrics A');
  tenantB = await seedTenant('Report Metrics B');

  const names = await admin.from('tenants').select('id,name').in('id', [tenantA, tenantB]);
  if (names.error) throw names.error;
  const rows = names.data as Array<{ id: string; name: string }>;
  nameA = rows.find((row) => row.id === tenantA)!.name;
  nameB = rows.find((row) => row.id === tenantB)!.name;

  // ── A's ONBOARDING INSTANT, CHOSEN RATHER THAN DEFAULTED ────────────────
  //
  // `seedMessageTemplate` and `seedAttestation` both default their instant to
  // now, which would put A's onboarding AFTER every event below and exclude
  // all of them. The two instants are what this suite is testing against, so
  // they are said out loud (the `seedCadence` rule).
  await seedMessageTemplate(tenantA, 1, {
    approved_at: A_TEMPLATE_APPROVED_AT.toISOString(),
  });
  await seedAttestation(tenantA, { attested_at: A_ATTESTED_AT.toISOString() });

  const quotesA = await seedQuotes(tenantA, [{}, {}]);
  const preOnboardingQuote = quotesA[0];
  const chasedQuote = quotesA[1];

  await admin.from('quote_status_events').insert([
    {
      tenant_id: tenantA,
      quote_id: preOnboardingQuote.id,
      sm8_job_uuid: preOnboardingQuote.sm8_job_uuid,
      from_status: '(new)',
      to_status: 'Quote',
      event_type: 'quote_opened',
      detected_at: A_PRE_ONBOARDING_OPENED_AT.toISOString(),
    },
    {
      tenant_id: tenantA,
      quote_id: chasedQuote.id,
      sm8_job_uuid: chasedQuote.sm8_job_uuid,
      from_status: '(new)',
      to_status: 'Quote',
      event_type: 'quote_opened',
      detected_at: A_OPENED_AT.toISOString(),
    },
  ]);

  const cadenceA = await seedCadence(tenantA, chasedQuote.id);

  // Touch 1 at 23h59m after the quote was opened: INSIDE the 24-hour service
  // level, and close enough to the edge that an off-by-an-hour interval would
  // show up here rather than in production.
  await seedLedgerRow(tenantA, {
    cadenceId: cadenceA,
    quoteId: chasedQuote.id,
    touchNumber: 1,
    claimedAt: new Date(A_OPENED_AT.getTime() + 23 * 3_600_000 + 59 * 60_000).toISOString(),
  });
  // A second touch to the SAME address: one more cadence touched? No — one
  // cadence, one contact. Both counts are DISTINCT for this reason.
  await seedLedgerRow(tenantA, {
    cadenceId: cadenceA,
    quoteId: chasedQuote.id,
    touchNumber: 2,
    claimedAt: daysAgo(5).toISOString(),
  });

  await seedInbound(tenantA, {
    cadenceId: cadenceA,
    quoteId: chasedQuote.id,
    receivedAt: daysAgo(4).toISOString(),
    attribution: 'threaded',
  });

  await seedSuppression(tenantA, [
    // In the denominator: we messaged this address inside the window.
    { channel: 'sms', address: MESSAGED_ADDRESS },
    // NOT in the denominator — the D-03 fan-out's shape. Counting it would
    // make the rate exceed 100% and put a red badge on a client who did
    // nothing wrong.
    { channel: 'sms', address: NEVER_MESSAGED_ADDRESS },
  ]);

  const touchesA = await seedTouches(cadenceA, tenantA, [{}, {}]);
  await seedApprovedDraft(tenantA, cadenceA, touchesA[0].id, 1, {
    edit_distance: '0.2',
    approved_at: daysAgo(6).toISOString(),
  });
  await seedApprovedDraft(tenantA, cadenceA, touchesA[1].id, 2, {
    edit_distance: '0',
    approved_at: daysAgo(3).toISOString(),
  });

  await seedAttribution(tenantA, chasedQuote.id, {
    conservative_cents: 30_000,
    won_detected_at: daysAgo(2).toISOString(),
  });

  // From the 1st of last month, so the whole 30-day window is covered by one
  // fee and `feesInForce` has a real denominator to pro-rate.
  const lastMonth = new Date(Date.UTC(BASE.getUTCFullYear(), BASE.getUTCMonth() - 1, 1));
  await seedFee(tenantA, {
    kind: 'monthly',
    amountCents: 59_700,
    effectiveFrom: lastMonth.toISOString().slice(0, 10),
  });

  // ── B: ONE QUALIFYING SEND AND NOTHING ELSE ─────────────────────────────
  //
  // No templates and no attestation, so B has NO onboarding instant and every
  // quote of theirs is excluded — the null arm of `onboardedAt()`, proved
  // structurally rather than argued.
  const quotesB = await seedQuotes(tenantB, [{}]);
  const cadenceB = await seedCadence(tenantB, quotesB[0].id);
  await seedLedgerRow(tenantB, {
    cadenceId: cadenceB,
    quoteId: quotesB[0].id,
    touchNumber: 1,
    claimedAt: daysAgo(7).toISOString(),
  });

  // ── A MISSED-CALL TEXT-BACK ON A LEAD CADENCE (12-REVIEW WR-03) ─────────
  //
  // `quote_id` NULL, `lead_id` set, touch 1 — and every OTHER clause of the
  // qualifying-send predicate holds for it (sent, not stub, no undelivered
  // receipt, inside the window). Then the caller replied STOP. If the report
  // counted it, A would read two cadences, two contacts and two opt-outs —
  // and the client's quote follow-up figures would include a text the quote
  // engine never sent.
  const leadA = await seedLead(tenantA, { contact_mobile: TEXT_BACK_ADDRESS });
  const leadCadenceA = await seedLeadCadence(tenantA, leadA, { contact_mobile: TEXT_BACK_ADDRESS });
  const textBackRow = await admin.from('send_ledger').insert({
    tenant_id: tenantA,
    cadence_id: leadCadenceA,
    quote_id: null,
    lead_id: leadA,
    touch_number: 1,
    claimed_at: daysAgo(3).toISOString(),
    channel: 'sms',
    to_address: TEXT_BACK_ADDRESS,
    sender: 'clicksend',
    outcome: 'sent',
  });
  if (textBackRow.error) throw new Error(`Seeding the text-back ledger row failed: ${textBackRow.error.message}`);
  await seedSuppression(tenantA, [{ channel: 'sms', address: TEXT_BACK_ADDRESS }]);

  // ── 2026-10 (Phase 15, 15-03; RPT-04): THE OVERVIEW'S CALLS COLUMN ──────
  //
  // A diverts through an ACTIVE number and was rung three times: twice inside
  // the window (one after hours) and once forty days ago, outside it. B has no
  // number and no calls. Seeded HERE, before every describe, so the parity
  // describe below compares the three new fields at non-zero values too.
  // Withheld callers: the calls column counts, it never needs a number.
  await seedDivertNumber(tenantA);
  await seedMissedCall(tenantA, {}, { caller: null, startedAt: daysAgo(2), afterHours: false });
  await seedMissedCall(tenantA, {}, { caller: null, startedAt: daysAgo(3), afterHours: true });
  await seedMissedCall(tenantA, {}, { caller: null, startedAt: daysAgo(40), afterHours: true });
});

afterAll(async () => {
  await teardownTenants([tenantA, tenantB]);
  await closeDb();
});

/** `now` is read per test, AFTER seeding — see `BASE`. */
function currentWindow() {
  const now = new Date();
  return { now, window: rollingWindow(now, LIVE_METRICS_WINDOW_DAYS) };
}

async function countsFor(): Promise<{
  now: Date;
  window: ReturnType<typeof rollingWindow>;
  a: TenantMetricCounts;
  b: TenantMetricCounts;
  all: TenantMetricCounts[];
}> {
  const { now, window } = currentWindow();
  const all = await forAllTenants_reportMetrics(window);

  const a = all.find((row) => row.tenantId === tenantA);
  const b = all.find((row) => row.tenantId === tenantB);
  if (!a || !b) throw new Error('The accessor did not return a row for every seeded tenant');

  return { now, window, a, b, all };
}

describe('forAllTenants_reportMetrics counts the window (RPT-03, D-14..D-18)', () => {
  it('returns a row for EVERY client, including one with no activity', async () => {
    const { all } = await countsFor();
    const ids = all.map((row) => row.tenantId);

    // Driving the list off any count statement would have hidden exactly the
    // client nobody has sent anything for — the one the overview exists to
    // surface.
    expect(ids).toContain(tenantA);
    expect(ids).toContain(tenantB);
  });

  it('excludes a quote opened before the client could send (D-18)', async () => {
    const { a } = await countsFor();

    // TWO `quote_opened` events are inside the window. One is before A's
    // onboarding instant, and only one is counted.
    expect(
      a.quotesOpened,
      'A quote opened before the client had approved wording and attested was ' +
        'born paused for onboarding. Counting it blames the service for not ' +
        'sending a message it was forbidden to send.',
    ).toBe(1);
    expect(a.quotesFirstTouch24h).toBe(1);
  });

  it('gives a client with no onboarding instant no quotes at all', async () => {
    const { b } = await countsFor();

    // B has neither an approved template nor an attestation, so `onboardedAt`
    // is null and every quote is EXCLUDED rather than defaulted in.
    expect(b.quotesOpened).toBe(0);
    expect(b.quotesFirstTouch24h).toBe(0);
  });

  it('counts cadences and contacts DISTINCTLY, not touches', async () => {
    const { a } = await countsFor();

    // Two qualifying ledger rows, one cadence, one address.
    expect(a.cadencesTouched).toBe(1);
    expect(a.contactsTouched).toBe(1);
    expect(a.cadencesReplied).toBe(1);
  });

  it('counts quote follow-ups only — a lead-route text-back is not one (12-REVIEW WR-03)', async () => {
    const { window } = currentWindow();
    const { a } = await countsFor();
    const scoped = await forTenant(tenantA).metrics.windowCounts(window);

    // The fixture's text-back row and its STOP are in the window; neither is
    // counted, by the overview or by the client page's twin.
    for (const counts of [a, scoped]) {
      expect(counts.cadencesTouched).toBe(1);
      expect(counts.contactsTouched).toBe(1);
      expect(counts.contactsOptedOut).toBe(1);
    }
  });

  it('counts only opt-outs from contacts we actually messaged (A6)', async () => {
    const { a } = await countsFor();

    // Two suppressions in the window; one is for an address that appears in no
    // ledger row. The numerator must be a SUBSET of the denominator or the
    // rate is not a rate.
    expect(a.contactsOptedOut).toBe(1);
    expect(a.contactsOptedOut).toBeLessThanOrEqual(a.contactsTouched);
  });

  it('keeps one client out of another client counts', async () => {
    const { b } = await countsFor();

    expect(b.cadencesTouched).toBe(1);
    expect(b.cadencesReplied).toBe(0);
    expect(b.contactsOptedOut).toBe(0);
    expect(b.conservativeCents).toBe(0);
    expect(b.draftsApproved).toBe(0);
    expect(b.fees).toEqual([]);
  });

  it('sums the edit distance as a STRING and counts edits by non-zero (D-17)', async () => {
    const { a } = await countsFor();

    expect(a.draftsApproved).toBe(2);
    expect(a.draftsEdited).toBe(1);
    // numeric arrives from postgres.js as text and is converted ONCE, in
    // `meanEditDistanceBp`. A `::float8` in the SQL would be a second
    // conversion nobody can see.
    expect(typeof a.editDistanceSum).toBe('string');
    expect(Number(a.editDistanceSum)).toBeCloseTo(0.2, 10);
  });

  it('sums attributed cents and carries the fee schedule whole', async () => {
    const { a } = await countsFor();

    expect(a.conservativeCents).toBe(30_000);
    expect(typeof a.conservativeCents).toBe('number');
    expect(a.fees).toHaveLength(1);
    expect(a.fees[0].amountCents).toBe(59_700);
    expect(a.fees[0].kind).toBe('monthly');
  });

  it('carries the client name and zone the digest and the page both render', async () => {
    const { a, b } = await countsFor();

    expect(a.tenantName).toBe(nameA);
    expect(b.tenantName).toBe(nameB);
    expect(a.timezone).toBe('Australia/Perth');
  });
});

/**
 * 2026-10 (Phase 15, 15-03; RPT-04). The overview's calls column, on both
 * reads: the window's diverted calls, the after-hours share, and whether the
 * client diverts at all — zeros and `false` for a client with neither, so the
 * overview still renders a row for them.
 */
describe('the window carries the diverted calls (Phase 15, 2026-10)', () => {
  it('counts A\'s two calls in the window, one after hours, and sees its divert number', async () => {
    const { a, window } = await countsFor();
    const scoped = await forTenant(tenantA).metrics.windowCounts(window);

    for (const counts of [a, scoped]) {
      expect(counts.missedCalls).toBe(2);
      expect(counts.missedCallsAfterHours).toBe(1);
      expect(counts.hasDivertNumber).toBe(true);
    }
  });

  it('gives B, with no number and no calls, zeros and false', async () => {
    const { b, window } = await countsFor();
    const scoped = await forTenant(tenantB).metrics.windowCounts(window);

    for (const counts of [b, scoped]) {
      expect(counts.missedCalls).toBe(0);
      expect(counts.missedCallsAfterHours).toBe(0);
      expect(counts.hasDivertNumber).toBe(false);
    }
  });
});

describe('the counts derive through the ONE pure derivation', () => {
  it('measures A at 100% opt-out and REFUSES to alarm on one contact', async () => {
    const { a, window, now } = await countsFor();
    const metrics = computeTenantMetrics(a, window, now);

    // One contact messaged, one suppressed. The RATE is real, measured and
    // still rendered — the page shows "1 of 1 contacts" — and it is above the
    // threshold by every comparison.
    expect(metrics.optOut.rateBp).toBe(10_000);
    expect(metrics.optOut.rateBp!).toBeGreaterThanOrEqual(OPT_OUT_ALARM_BP);

    // AND THE ALARM STILL DOES NOT FIRE (quick 260913-ind). This fixture is
    // the exact production shape that caused the change: the live test
    // tenant's one contact is the operator's own handset, opted out during the
    // Phase 4 STOP test, and it put the same digest line in the operator's
    // inbox every morning for a rolling thirty days. One contact is not a
    // sample, and an alarm nobody can act on is an alarm they learn to delete.
    expect(a.contactsTouched).toBeLessThan(OPT_OUT_ALARM_MIN_CONTACTS);
    expect(metrics.optOut.alarming).toBe(false);

    // And the first touch landed inside the service level.
    expect(metrics.firstTouch.rateBp).toBe(10_000);
  });

  it('gives a client with no fee schedule a NULL multiple, never a zero', async () => {
    const { b, window, now } = await countsFor();
    const metrics = computeTenantMetrics(b, window, now);

    expect(metrics.recovery.feesCents).toBeNull();
    expect(
      metrics.recovery.multipleBp,
      'A client with no fee has no multiple. `0.0×` would accuse a working ' +
        'service of failing, and an infinity would reach the page as text.',
    ).toBeNull();

    // NULL AND ZERO ARE DIFFERENT ANSWERS, and B carries one of each. It
    // opened no quotes in the window, so there is nothing to measure a
    // first-touch rate over — `null`. It DID message one contact and nobody
    // opted out, which is a real, measured 0% and must render as `0.0%`
    // rather than as `—`: a client with a clean opt-out record has earned the
    // number, and an em dash there would read as "we do not know".
    expect(metrics.firstTouch.rateBp).toBeNull();
    expect(metrics.reply.rateBp).toBe(0);
    expect(metrics.optOut.rateBp).toBe(0);
    expect(metrics.optOut.alarming).toBe(false);
    expect(metrics.escalation.medianMinutes).toBeNull();
  });
});

/**
 * Sorted copies of the two array fields, so a comparison is about VALUES rather
 * than about two statements' row order.
 */
function comparable(counts: TenantMetricCounts): TenantMetricCounts {
  return {
    ...counts,
    escalationLatencyMinutes: [...counts.escalationLatencyMinutes].sort((a, b) => a - b),
    fees: [...counts.fees].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.getTime() - b.createdAt.getTime(),
    ),
  };
}

describe('the two reads agree field for field (T-7-26, the E1 backstop)', () => {
  it.each([
    ['A', () => tenantA],
    ['B', () => tenantB],
  ])(
    'tenant %s: forTenant().metrics.windowCounts equals its overview row',
    async (_label, id) => {
      // ONE window for both, deliberately: two `new Date()` calls a millisecond
      // apart would make a genuine disagreement indistinguishable from a row
      // that fell out of the window between them.
      const { window } = currentWindow();
      const tenantId = id();

      const [all, scoped] = [
        await forAllTenants_reportMetrics(window),
        await forTenant(tenantId).metrics.windowCounts(window),
      ];

      const overviewRow = all.find((row) => row.tenantId === tenantId);
      expect(overviewRow, 'the overview must carry a row for this client').toBeDefined();

      // THE WHOLE OBJECT, not a sampled field. The two bodies are duplicated
      // SQL (see the `metrics` namespace header for why), and this equality is
      // the only thing stopping one predicate being changed without the other
      // — which would show up as the overview and the detail page quoting a
      // client two different opt-out rates.
      expect(comparable(scoped)).toEqual(comparable(overviewRow!));
    },
  );
});

describe('the cross-tenant surface carries no customer data (T-7-23)', () => {
  it('returns nothing that looks like an address, for a fixture full of them', async () => {
    const { all } = await countsFor();
    const serialized = JSON.stringify(all);

    // The fixture messaged `+61491570156` and suppressed it. If any select
    // list ever grows an address column, this is where it shows up — no
    // matter how the accessor is refactored.
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain('+61');
    expect(serialized).not.toContain(MESSAGED_ADDRESS);
    expect(serialized).not.toContain(NEVER_MESSAGED_ADDRESS);
  });

  it('yields no address, body or customer name from any select list (source)', () => {
    const source = readFileSync(ACCESSOR_SOURCE, 'utf8');
    const body = source.slice(source.indexOf('export async function forAllTenants_reportMetrics'));

    // THE ASSERTION IS PER SELECT LIST, NOT PER FILE. `to_address` MUST appear
    // in this accessor — the opt-out numerator is restricted to contacts we
    // messaged (A6), which is a comparison — and the property that matters is
    // that no address ever leaves the database as a VALUE. So a line inside a
    // `.select({ … })` block may name one only inside `count(DISTINCT …)`,
    // where what crosses the boundary is an integer.
    const banned = /(toAddress|\.address\b|\.body\b|fromAddress|normalizedFrom|contactMobile|contactEmail|contactName)/;

    for (const block of selectBlocks(body)) {
      for (const line of block.split('\n')) {
        if (!banned.test(line)) continue;
        expect(
          line,
          'A select list in the reports accessor names a customer column ' +
            'outside an aggregate. Counts, sums, fee rows, a client name and a ' +
            'zone are the whole permitted surface.',
        ).toContain('count(DISTINCT');
      }
    }
  });

  it('reads no quote or cadence column, so the Phase 6 pins still hold (source)', () => {
    const source = readFileSync(ACCESSOR_SOURCE, 'utf8');
    const body = source.slice(source.indexOf('export async function forAllTenants_reportMetrics'));

    // D-18's first-touch denominator is `quote_opened` EVENTS rather than
    // cadence rows, precisely so this accessor needs neither table. The pinned
    // `quoteRefs` / `cadenceRefs` sets in tests/sync-upsert.test.ts are
    // therefore unchanged by 07-05, and that is a property, not a coincidence.
    expect(body).not.toMatch(/\bquotes\.\w+/);
    expect(body).not.toMatch(/\bcadences\.[a-z]/);
    expect(body).not.toContain('from(cadences)');
  });
});

/**
 * Every `.select({ … })` block in `source`, matched by brace depth.
 *
 * Depth counting rather than a regex because these select lists contain
 * template literals whose `${…}` interpolations carry braces of their own — a
 * lazy `\{[\s\S]*?\}` stops at the first one and asserts about a fragment.
 */
function selectBlocks(source: string): string[] {
  const marker = '.select({';
  const blocks: string[] = [];

  for (let from = 0; ; ) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;

    let depth = 0;
    let index = start + marker.length - 1;
    for (; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    blocks.push(source.slice(start, index + 1));
    from = index + 1;
  }

  return blocks;
}
