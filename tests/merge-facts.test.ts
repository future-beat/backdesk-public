/**
 * The merge-fact renderers, and the one property that makes them dangerous.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHATEVER THIS FILE RENDERS, `validateDraft` PERMITS. The rendered        │
 * │ strings ARE `allowedDisplayStrings` — the validator's whole contract is  │
 * │ "the model may only reproduce what the caller supplied", so a renderer   │
 * │ that supplies a wrong figure is whitelisted by construction and both     │
 * │ defences pass it through to a customer's handset.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * That is why the money cases below are round-tripped through the real
 * validator rather than merely string-compared: the assertion that matters is
 * not "renderMoney produced this text", it is "the price a tradie actually
 * quoted is a price the model is allowed to write, and nothing else is".
 *
 * The cents cases exist because the original renderer did `Math.trunc(cents /
 * 100)`. Every fixture in the rest of the suite used a whole-dollar amount
 * (`'2450.00'`), so a truncation that understated a $2,437.50 quote as `$2,437`
 * was invisible to the entire test suite.
 *
 * PURE — no database, no credentials, no model. Runs on a bare `npm test`.
 */
import { describe, expect, it } from 'vitest';

import {
  buildMergeFacts,
  firstName,
  renderDaysSince,
  renderMoney,
  renderQuoteDate,
} from '../src/core/drafting/merge-facts';
import { validateDraft } from '../src/core/drafting/validate';

describe('renderMoney', () => {
  it('renders a whole-dollar quote without a decimal part', () => {
    expect(renderMoney('2450.00')).toBe('$2,450');
    expect(renderMoney('2450')).toBe('$2,450');
  });

  it('renders the cents when the quote has cents', () => {
    // The regression. `Math.trunc(cents / 100)` produced '$2,437' here — a
    // price 50c under the one the tradie quoted, whitelisted for the model and
    // plausible enough that an operator skims past it.
    expect(renderMoney('2437.50')).toBe('$2,437.50');
    expect(renderMoney('2450.99')).toBe('$2,450.99');
    expect(renderMoney('0.50')).toBe('$0.50');
    expect(renderMoney('0.05')).toBe('$0.05');
  });

  it('omits an absent fact rather than rendering it as $0 (D-02)', () => {
    // `Number('')` is 0, so the pre-fix renderer turned an empty numeric column
    // into a quote that reads as free.
    expect(renderMoney(null)).toBeNull();
    expect(renderMoney('')).toBeNull();
    expect(renderMoney('   ')).toBeNull();
  });

  it('refuses a non-numeric column rather than coercing it', () => {
    expect(renderMoney('not a number')).toBeNull();
    expect(renderMoney('$2,450')).toBeNull();
  });

  it('groups thousands in en-AU', () => {
    expect(renderMoney('1234567.89')).toBe('$1,234,567.89');
  });
});

describe('a rendered price is a price the model may write', () => {
  const SUFFIX = 'Perth Sparks Electrical. Reply STOP to opt out.';

  /** The draft a model would write if it reproduced the supplied price exactly. */
  function draftQuoting(total: string): ReturnType<typeof validateDraft> {
    const { allowedDisplayStrings, totalDisplay } = buildMergeFacts({
      totalInvoiceAmount: total,
      quoteDateUtc: null,
      anchorAt: null,
      contactName: 'Robin Vasquez',
      timezone: 'Australia/Perth',
      now: new Date('2026-08-26T02:00:00Z'),
    });
    return validateDraft({
      body: `Hi Robin, just checking in on the ${totalDisplay} quote. ${SUFFIX}`,
      allowedDisplayStrings,
      expectedSuffix: SUFFIX,
    });
  }

  it.each(['2450.00', '2437.50', '2450.99', '0.50', '1234567.89'])(
    'round-trips %s through the production validator',
    (total) => {
      expect(draftQuoting(total).ok).toBe(true);
    },
  );

  it('still refuses a price the renderer did not supply', () => {
    const { allowedDisplayStrings } = buildMergeFacts({
      totalInvoiceAmount: '2437.50',
      quoteDateUtc: null,
      anchorAt: null,
      contactName: 'Robin Vasquez',
      timezone: 'Australia/Perth',
      now: new Date('2026-08-26T02:00:00Z'),
    });
    // The truncated form is now a number NOBODY supplied, which is the whole
    // point: the old renderer made this exact string legal.
    const verdict = validateDraft({
      body: `Hi Robin, the quote came to $2,437. ${SUFFIX}`,
      allowedDisplayStrings,
      expectedSuffix: SUFFIX,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.violations.some((v) => v.rule === 'unlisted_number')).toBe(true);
  });
});

describe('the other renderers', () => {
  it('renders the quote date in the tenant zone, or omits it', () => {
    // 2026-08-12T18:00Z is already the 13th in Perth (UTC+8).
    expect(renderQuoteDate(new Date('2026-08-12T18:00:00Z'), 'Australia/Perth')).toBe(
      '13 August',
    );
    expect(renderQuoteDate(null, 'Australia/Perth')).toBeNull();
    expect(renderQuoteDate(new Date('2026-08-12T02:00:00Z'), 'Not/AZone')).toBeNull();
  });

  it('floors days since the anchor and clamps at zero', () => {
    const anchor = new Date('2026-08-20T02:00:00Z');
    expect(renderDaysSince(anchor, new Date('2026-08-26T02:00:00Z'))).toBe('6');
    expect(renderDaysSince(anchor, new Date('2026-08-26T01:59:00Z'))).toBe('5');
    expect(renderDaysSince(anchor, new Date('2026-08-19T02:00:00Z'))).toBe('0');
    expect(renderDaysSince(null, new Date('2026-08-26T02:00:00Z'))).toBeNull();
  });

  it('takes the first word of a contact name, or nothing', () => {
    expect(firstName('Robin Vasquez')).toBe('Robin');
    expect(firstName('  Robin  ')).toBe('Robin');
    expect(firstName('')).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  it('keeps the contact name out of the whitelist', () => {
    const { allowedDisplayStrings } = buildMergeFacts({
      totalInvoiceAmount: null,
      quoteDateUtc: null,
      anchorAt: null,
      contactName: '24/7 Bob',
      timezone: 'Australia/Perth',
      now: new Date('2026-08-26T02:00:00Z'),
    });
    expect(allowedDisplayStrings).toEqual([]);
  });
});
