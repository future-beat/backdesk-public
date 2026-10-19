/**
 * `decideAttribution` end to end, and the evidence chain's privacy boundary
 * (RPT-01, T-7-07, T-7-09).
 *
 * PURE — rows in, decision out, no database and no clock. This is the function
 * that decides whether a won job appears on a client's invoice and how many
 * dollars of it the service claims, so the suite is written as a set of claims
 * about an invoice rather than about a return value.
 *
 * The most important test in this file is the LAST one, and it is a negative:
 * the evidence chain is the one place in this system where a customer's mobile
 * number could quietly become permanent — a jsonb column nobody re-reads,
 * outliving the cadence, the touches and the retention rules that governed the
 * rows it was copied from. It walks the schema recursively rather than
 * inspecting one built value, so it fails on a key that is ADDED, not merely on
 * one that happens to be populated by this fixture.
 */
import { describe, expect, it } from 'vitest';

import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';
import { decideAttribution, type DecideAttributionInput } from '@/core/attribution/decide';
import {
  attributionEvidenceSchema,
  buildEvidence,
  firstNameOf,
  truncateCodePoints,
} from '@/core/attribution/evidence';
import type { LedgerTouchFields } from '@/core/attribution/qualify';

const DAY_MS = 86_400_000;

/** A fixed instant, so no assertion here depends on when the suite runs. */
const DETECTED_AT = new Date('2026-08-26T00:00:00.000Z');

const QUOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CADENCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function touch(over: Partial<LedgerTouchFields> = {}): LedgerTouchFields {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    cadenceId: CADENCE_ID,
    touchNumber: 1,
    channel: 'sms',
    sender: 'clicksend',
    outcome: 'sent',
    claimedAt: new Date(DETECTED_AT.getTime() - 5 * DAY_MS),
    deliveryStatus: 'delivered',
    ...over,
  };
}

function input(over: Partial<DecideAttributionInput> = {}): DecideAttributionInput {
  return {
    event: { id: 9_001, quoteId: QUOTE_ID, detectedAt: DETECTED_AT },
    ledger: [
      touch(),
      touch({
        id: '22222222-2222-4222-8222-222222222222',
        touchNumber: 2,
        channel: 'email',
        sender: 'resend',
        deliveryStatus: null,
        claimedAt: new Date(DETECTED_AT.getTime() - 2 * DAY_MS),
      }),
    ],
    quote: {
      sm8JobUuid: JOB_UUID,
      generatedJobId: '1482',
      jobDescription: 'Bathroom reno, Scarborough',
      totalInvoiceAmount: '12400.00',
    },
    connection: {
      baselineWinRate: '0.4000',
      baselineQuotesIssued: 55,
      baselineWindowStart: '2026-05-01',
      baselineWindowEnd: '2026-07-30',
    },
    inbound: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        receivedAt: new Date(DETECTED_AT.getTime() - DAY_MS),
        label: 'interested',
        isHot: true,
      },
    ],
    escalations: [],
    cadences: [
      {
        id: CADENCE_ID,
        createdByEventId: 8_400,
        stopReason: 'won',
        createdAt: new Date(DETECTED_AT.getTime() - 10 * DAY_MS),
      },
    ],
    contactName: 'Sarah-Jane Dampier',
    ...over,
  };
}

describe('decideAttribution — the happy path', () => {
  const decision = decideAttribution(input());

  it('attributes, with the first and last qualifying touch bracketing the chase', () => {
    expect(decision.kind).toBe('attributed');
    if (decision.kind !== 'attributed') return;

    expect(decision.row.qualifyingTouchCount).toBe(2);
    expect(decision.row.firstTouchClaimedAt.toISOString()).toBe('2026-08-21T00:00:00.000Z');
    expect(decision.row.lastTouchClaimedAt.toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });

  it('freezes the gross figure and takes the conservative haircut from the measured baseline', () => {
    if (decision.kind !== 'attributed') return;

    expect(decision.row.grossCents).toBe(1_240_000);
    expect(decision.row.valueSource).toBe('mirror');
    expect(decision.row.baselineSource).toBe('connect');
    expect(decision.row.baselineRateBp).toBe(4_000);
    // 1_240_000 * 6_000 / 10_000 = 744_000 exactly.
    expect(decision.row.conservativeCents).toBe(744_000);
  });

  it('records the window it was computed under, from the SAME import as its own footnote', () => {
    if (decision.kind !== 'attributed') return;

    // T-7-09: the column and the evidence chain's `constants.attributionWindowDays`
    // are the same number from the same import, so a frozen report and the row
    // it was generated from cannot drift apart.
    expect(decision.row.windowDays).toBe(ATTRIBUTION_WINDOW_DAYS);
    expect(decision.row.windowDays).toBe(30);
    expect(decision.row.evidence.constants.attributionWindowDays).toBe(30);
  });

  it('orders the evidence chain so two runs produce identical jsonb', () => {
    if (decision.kind !== 'attributed') return;

    expect(decision.row.evidence.ledger.map((row) => row.touchNumber)).toEqual([1, 2]);
    expect(decision.row.evidence.ledger[1]?.channel).toBe('email');
    expect(decision.row.evidence.inbound).toHaveLength(1);
    expect(decision.row.evidence.inbound[0]?.isHot).toBe(true);
    expect(decision.row.evidence.cadences[0]?.stopReason).toBe('won');
    expect(decision.row.evidence.wonEventId).toBe(9_001);
  });

  it('carries the baseline window dates for the report footnote', () => {
    if (decision.kind !== 'attributed') return;

    expect(decision.row.evidence.baseline).toEqual({
      rateBp: 4_000,
      source: 'connect',
      sampleSize: 55,
      windowStart: '2026-05-01',
      windowEnd: '2026-07-30',
    });
  });
});

describe('decideAttribution — the honest negatives', () => {
  it('returns unqualified when no touch qualifies', () => {
    // Most `won` events are jobs the tradie closed themselves. Claiming those is
    // how a recovered-revenue report becomes a document the client disproves
    // from their own books.
    const decision = decideAttribution(input({ ledger: [touch({ sender: 'stub' })] }));

    expect(decision).toEqual({ kind: 'unqualified' });
  });

  it('returns unqualified for a win whose only in-window ledger row is the about-quote text (touch 0, D-17)', () => {
    // The customer rang the tradie, got the automatic "about your quote" text,
    // and then booked. That reply to their own call recovered nothing, so no
    // fee may rest on it.
    const aboutQuote = touch({ touchNumber: 0, sender: 'clicksend', outcome: 'sent' });

    expect(decideAttribution(input({ ledger: [aboutQuote] }))).toEqual({ kind: 'unqualified' });
  });

  it('a touch-0 row beside a real touch is ignored: the evidence names only the chase', () => {
    const aboutQuote = touch({
      id: '99999999-9999-4999-8999-999999999999',
      touchNumber: 0,
      claimedAt: new Date(DETECTED_AT.getTime() - DAY_MS),
    });
    const decision = decideAttribution(input({ ledger: [touch(), aboutQuote] }));

    expect(decision.kind).not.toBe('unqualified');
    expect(JSON.stringify(decision)).not.toContain('99999999-9999-4999-8999-999999999999');
  });

  it('returns unqualified when every touch predates the window', () => {
    const stale = touch({
      claimedAt: new Date(DETECTED_AT.getTime() - (ATTRIBUTION_WINDOW_DAYS * DAY_MS + 1)),
    });

    expect(decideAttribution(input({ ledger: [stale] })).kind).toBe('unqualified');
  });

  it('still attributes when the quote mirror is gone, and says the figure is missing', () => {
    // RESEARCH Pitfall 8. The touches happened and are evidence; the DOLLAR
    // figure is unknown. Holding the row would lose the evidence; inventing a
    // number would be worse.
    const decision = decideAttribution(input({ quote: null }));

    expect(decision.kind).toBe('attributed');
    if (decision.kind !== 'attributed') return;

    expect(decision.row.valueSource).toBe('missing');
    expect(decision.row.grossCents).toBe(0);
    expect(decision.row.conservativeCents).toBe(0);
    expect(decision.row.sm8JobUuid).toBeNull();
    expect(decision.row.evidence.generatedJobId).toBeNull();
    expect(decision.row.evidence.jobDescription).toBeNull();
  });

  it('treats an unparseable total as missing, never as a zero it could bill', () => {
    const decision = decideAttribution(
      input({
        quote: {
          sm8JobUuid: JOB_UUID,
          generatedJobId: '1482',
          jobDescription: 'Bathroom reno',
          totalInvoiceAmount: 'TBC',
        },
      }),
    );

    expect(decision.kind).toBe('attributed');
    if (decision.kind !== 'attributed') return;
    expect(decision.row.valueSource).toBe('missing');
    expect(decision.row.grossCents).toBe(0);
    // The job number and description survive — the operator needs them to price
    // the line by hand.
    expect(decision.row.evidence.generatedJobId).toBe('1482');
  });

  it('assumes the HIGH default baseline when there is no connection row', () => {
    const decision = decideAttribution(input({ connection: null }));

    expect(decision.kind).toBe('attributed');
    if (decision.kind !== 'attributed') return;

    expect(decision.row.baselineSource).toBe('default');
    expect(decision.row.baselineRateBp).toBe(7_000);
    // 1_240_000 * 3_000 / 10_000 = 372_000 — less than a third of gross. The
    // assumption costs the SERVICE, which is the direction D-08 requires.
    expect(decision.row.conservativeCents).toBe(372_000);
  });
});

describe('the evidence chain — bounded text', () => {
  it('cuts a long job description to 60 code points plus a visible marker', () => {
    const long = 'x'.repeat(90);
    const decision = decideAttribution(
      input({
        quote: {
          sm8JobUuid: JOB_UUID,
          generatedJobId: '1482',
          jobDescription: long,
          totalInvoiceAmount: '100.00',
        },
      }),
    );

    if (decision.kind !== 'attributed') return;
    const cut = decision.row.evidence.jobDescription ?? '';

    expect(Array.from(cut)).toHaveLength(61);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('cuts on CODE POINTS, not UTF-16 units', () => {
    // Slicing a surrogate pair in half produces mojibake, and a non-BMP
    // character in a ServiceM8 job description is not exotic.
    const emoji = '🛁'.repeat(90);

    expect(Array.from(truncateCodePoints(emoji, 60))).toHaveLength(61);
  });

  it('validates a description this module itself truncated, emoji and all', () => {
    // THE POISON PILL. `zod`'s `.max()` counts UTF-16 code units while
    // `truncateCodePoints` counts code points: 60 non-BMP code points plus the
    // ellipsis is 61 code points but 121 units, so `.max(61)` rejected a string
    // the truncator had just produced. `decideAttribution` parses and THROWS,
    // and the consumer reads that throw as a blocked run and holds the SHARED
    // cursor behind it — permanently, for every tenant. One emoji in a job
    // description would have stopped all recovered-revenue attribution.
    const decision = decideAttribution(
      input({
        quote: {
          sm8JobUuid: JOB_UUID,
          generatedJobId: '1482',
          jobDescription: '🔥'.repeat(80),
          totalInvoiceAmount: '100.00',
        },
      }),
    );

    expect(decision.kind).toBe('attributed');
    if (decision.kind !== 'attributed') return;

    const cut = decision.row.evidence.jobDescription ?? '';
    expect(Array.from(cut)).toHaveLength(61);
    expect(cut.length).toBeGreaterThan(61); // 121 UTF-16 units: the unit that used to be asserted
    expect(() => attributionEvidenceSchema.parse(decision.row.evidence)).not.toThrow();
  });

  it('rejects a description that is genuinely over the code-point cap', () => {
    // The bound still binds — it is the UNIT that was wrong, not the limit.
    const evidence = buildEvidence({
      wonEventId: 1,
      ledger: [],
      inbound: [],
      escalations: [],
      cadences: [],
      generatedJobId: null,
      jobDescription: null,
      contactName: null,
      baseline: { rateBp: 7_000, source: 'default', sampleSize: null },
      baselineWindowStart: null,
      baselineWindowEnd: null,
    });

    expect(() =>
      attributionEvidenceSchema.parse({ ...evidence, jobDescription: 'x'.repeat(62) }),
    ).toThrow();
    expect(() =>
      attributionEvidenceSchema.parse({ ...evidence, contactFirstName: '🔥'.repeat(33) }),
    ).toThrow();
  });

  it('reduces a contact name to its first token, uncapped by an ellipsis', () => {
    const decision = decideAttribution(input());

    if (decision.kind !== 'attributed') return;
    expect(decision.row.evidence.contactFirstName).toBe('Sarah-Jane');
  });

  it('caps a first name at 32 code points without marking it as cut', () => {
    // A truncated name marked with an ellipsis reads as a system error to the
    // person whose name it is (the Phase 6 CUSTOMER_NAME_MAX argument).
    const long = 'Z'.repeat(40);

    expect(firstNameOf(long)).toBe('Z'.repeat(32));
    expect(firstNameOf('   ')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });

  it('stores the chain in SENT order, and keeps the cadence each touch belonged to', () => {
    // A REOPENED QUOTE HAS TWO CADENCES, each numbering its own touches 1..N.
    // The chain used to be re-sorted by `touchNumber` ALONE, which interleaved
    // them — cadence B's touch 1 landing between cadence A's touches 1 and 2 —
    // while `firstTouchClaimedAt` / `lastTouchClaimedAt` were taken from the
    // `claimedAt` order. So the row's own anchors need not have matched the ends
    // of its own ledger, on the one artefact whose purpose is to be
    // reconstructible when somebody disputes the line. And with `cadenceId`
    // dropped from the stored chain, a reader could not disentangle them.
    const CADENCE_B = '44444444-4444-4444-8444-444444444444';
    const decision = decideAttribution(
      input({
        ledger: [
          touch({
            id: '11111111-1111-4111-8111-111111111111',
            touchNumber: 1,
            claimedAt: new Date(DETECTED_AT.getTime() - 9 * DAY_MS),
          }),
          touch({
            id: '22222222-2222-4222-8222-222222222222',
            touchNumber: 2,
            claimedAt: new Date(DETECTED_AT.getTime() - 8 * DAY_MS),
          }),
          // The second chase, after the reopen — LATER in time, but numbered 1.
          touch({
            id: '55555555-5555-4555-8555-555555555555',
            cadenceId: CADENCE_B,
            touchNumber: 1,
            claimedAt: new Date(DETECTED_AT.getTime() - 2 * DAY_MS),
          }),
        ],
      }),
    );

    expect(decision.kind).toBe('attributed');
    if (decision.kind !== 'attributed') return;

    const { row } = decision;
    const chain = row.evidence.ledger;

    // SENT ORDER, not touch-number order. Cadence B's touch 1 is LAST because it
    // happened last.
    expect(chain.map((t) => t.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '55555555-5555-4555-8555-555555555555',
    ]);

    // THE ROW AGREES WITH ITS OWN LEDGER — the property that was broken.
    expect(chain[0].claimedAt).toBe(row.firstTouchClaimedAt.toISOString());
    expect(chain[chain.length - 1].claimedAt).toBe(row.lastTouchClaimedAt.toISOString());

    // And the two chases are now separable.
    expect(chain.map((t) => t.cadenceId)).toEqual([CADENCE_ID, CADENCE_ID, CADENCE_B]);
  });

  it('still reads a chain frozen before `cadenceId` existed', () => {
    // THE READ PATH IS THE SAME SCHEMA. `generateMonthlyReport` parses
    // `row.evidence` on every stored row, and `quote_attributions` is
    // append-only with no update method and no backfill — by design, because a
    // row whose evidence changed after the client was invoiced from it is not
    // evidence. A REQUIRED `cadenceId` would therefore make every row written
    // before WR-12 unparseable, and generating any month containing one would
    // fail outright: a legibility fix turned into a hard outage.
    const decision = decideAttribution(input());
    if (decision.kind !== 'attributed') return;

    const old = {
      ...decision.row.evidence,
      ledger: decision.row.evidence.ledger.map((touchRow) => {
        const copy: Record<string, unknown> = { ...touchRow };
        delete copy.cadenceId;
        return copy;
      }),
    };

    expect(() => attributionEvidenceSchema.parse(old)).not.toThrow();
    expect(attributionEvidenceSchema.parse(old).ledger[0].cadenceId).toBeUndefined();

    // And every NEW row still carries it — optional on read, always written.
    expect(decision.row.evidence.ledger.every((t) => t.cadenceId === CADENCE_ID)).toBe(true);
  });

  it('refuses to build a row whose evidence does not validate', () => {
    // A row that cannot describe itself must not reach an invoice.
    const evidence = buildEvidence({
      wonEventId: 1,
      ledger: [],
      inbound: [],
      escalations: [],
      cadences: [],
      generatedJobId: null,
      jobDescription: null,
      contactName: null,
      baseline: { rateBp: 7_000, source: 'default', sampleSize: null },
      baselineWindowStart: null,
      baselineWindowEnd: null,
    });

    expect(() =>
      attributionEvidenceSchema.parse({ ...evidence, toAddress: '+61400000000' }),
    ).toThrow();
  });
});

describe('the evidence chain — T-7-07, the privacy boundary', () => {
  /** Every key name the schema declares, at any depth. */
  function keysOf(schema: unknown): string[] {
    const def = (schema as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
    if (!def) return [];

    if (def.type === 'object') {
      const shape = def.shape as Record<string, unknown>;
      return Object.entries(shape).flatMap(([key, value]) => [key, ...keysOf(value)]);
    }
    if (def.type === 'array') return keysOf(def.element);
    if (def.type === 'nullable' || def.type === 'optional') return keysOf(def.innerType);

    return [];
  }

  it('declares no key at any depth that could name a person or quote them', () => {
    // The two defences are deliberately different in kind. `strictObject` stops
    // a field being added by ACCIDENT at runtime; this walk stops one being
    // added ON PURPOSE at review time — including in a nested array element
    // three levels down, which is where nobody looks.
    const forbidden = /address|mobile|phone|email|body|raw|from|to$/i;
    const keys = keysOf(attributionEvidenceSchema);

    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
  });

  it('walks deep enough to see the nested array elements', () => {
    // Guards the guard: a keysOf() that silently stopped at the top level would
    // make the assertion above vacuously true.
    const keys = keysOf(attributionEvidenceSchema);

    expect(keys).toContain('touchNumber');
    expect(keys).toContain('deliveryStatus');
    expect(keys).toContain('createdByEventId');
    expect(keys).toContain('attributionWindowDays');
    expect(keys).toContain('sampleSize');
  });
});
