/**
 * The public form's trust boundary, at the schema (Phase 9, LAND-02, D-10).
 *
 * This is the ONLY validation standing between a stranger on the internet and a
 * row in the database, so the assertions below are about two different things
 * and both matter:
 *
 *  1. WHAT IS ACCEPTED — normalised, bounded, and stored in the shape the rest
 *     of the product already speaks (E.164, lowercased email, closed enums).
 *  2. WHAT IS READ BACK — every message is pinned by value against the
 *     09-UI-SPEC Copywriting Contract, because the person reading it is on a
 *     phone with no other help available and "Invalid input" is not a sentence
 *     anybody can act on.
 *
 * PURE: no mocks, no environment, no database. The schema is framework-free on
 * purpose so this suite can run bare.
 */
import { describe, expect, it } from 'vitest';

import {
  AUDIT_REQUEST_BANDS,
  AUDIT_REQUEST_FIELDS,
  AUDIT_REQUEST_TRADES,
  BAND_LABELS,
  TRADE_LABELS,
  auditRequestSchema,
  toAuditFieldErrors,
} from '../src/core/intake/audit-request';

/** A submission that passes, as the object the action assembles from FormData. */
function valid(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    business_name: 'Northbridge Electrical',
    contact_name: 'Dave Rowley',
    phone: '0412 345 678',
    email: 'dave@example.com',
    trade: 'electrical',
    servicem8: 'yes',
    quotes_per_month: '8_15',
    ...overrides,
  };
}

/** Every failing field's message, keyed by field name. */
function errorsFor(input: Record<string, string>) {
  const parsed = auditRequestSchema.safeParse(input);
  if (parsed.success) throw new Error('expected the parse to fail');
  return toAuditFieldErrors(parsed.error);
}

describe('a blank form reports EVERY field at once, in the UI-SPEC words', () => {
  /**
   * All seven, not the first one. A form that reveals one problem per submit is
   * a form somebody abandons on the third round trip, and this one is filled in
   * by a person who owes us nothing.
   */
  it('names all seven fields with their locked messages', () => {
    const errors = errorsFor({
      business_name: '',
      contact_name: '',
      phone: '',
      email: '',
      trade: '',
      servicem8: '',
      quotes_per_month: '',
    });

    expect(errors).toEqual({
      business_name: 'Enter your business name.',
      contact_name: 'Enter your name.',
      phone: 'Enter an Australian mobile number, like 0412 345 678.',
      email: 'Enter an email address we can reply to.',
      trade: 'Choose the closest trade.',
      servicem8: "Tell us whether you're on ServiceM8.",
      quotes_per_month: 'Choose a rough number of quotes a month.',
    });

    // Totality: the error keys are exactly the form's field list, so a field
    // added to the form without a message cannot pass unnoticed.
    expect(Object.keys(errors).sort()).toEqual([...AUDIT_REQUEST_FIELDS].sort());
  });

  it('treats a whitespace-only business name as blank', () => {
    expect(errorsFor(valid({ business_name: '   ' })).business_name).toBe(
      'Enter your business name.',
    );
  });

  it('treats a whitespace-only contact name as blank', () => {
    expect(errorsFor(valid({ contact_name: ' \t ' })).contact_name).toBe('Enter your name.');
  });
});

describe('the phone is normalised to E.164, not merely checked', () => {
  it('turns a spaced local mobile into +61…', () => {
    const parsed = auditRequestSchema.parse(valid({ phone: '0412 345 678' }));
    expect(parsed.phone).toBe('+61412345678');
  });

  it('accepts a number already in E.164 unchanged', () => {
    const parsed = auditRequestSchema.parse(valid({ phone: '+61412345678' }));
    expect(parsed.phone).toBe('+61412345678');
  });

  it('refuses something that is not an Australian mobile', () => {
    expect(errorsFor(valid({ phone: '12345' })).phone).toBe(
      'Enter an Australian mobile number, like 0412 345 678.',
    );
  });
});

describe('the email is trimmed and lowercased before it is stored', () => {
  it('normalises case and surrounding space', () => {
    const parsed = auditRequestSchema.parse(valid({ email: 'Dave@Example.COM ' }));
    expect(parsed.email).toBe('dave@example.com');
  });

  it('refuses a value that is not an address', () => {
    expect(errorsFor(valid({ email: 'dave at example' })).email).toBe(
      'Enter an email address we can reply to.',
    );
  });
});

describe('lengths and encoding', () => {
  it('accepts a 120-code-point business name and refuses 121', () => {
    expect(auditRequestSchema.safeParse(valid({ business_name: 'a'.repeat(120) })).success).toBe(
      true,
    );
    expect(auditRequestSchema.safeParse(valid({ business_name: 'a'.repeat(121) })).success).toBe(
      false,
    );
  });

  it('accepts an 80-code-point contact name and refuses 81', () => {
    expect(auditRequestSchema.safeParse(valid({ contact_name: 'a'.repeat(80) })).success).toBe(
      true,
    );
    expect(auditRequestSchema.safeParse(valid({ contact_name: 'a'.repeat(81) })).success).toBe(
      false,
    );
  });

  /**
   * THE ENCODING EDGE. A Perth trade business may be called anything, and the
   * schema's job is to store what was typed — not a transliteration of it.
   * Nothing here normalises, strips accents or folds case on a name.
   */
  it("keeps a non-ASCII business name exactly as typed", () => {
    const parsed = auditRequestSchema.parse(valid({ business_name: "Zoë's Électrique" }));
    expect(parsed.business_name).toBe("Zoë's Électrique");
  });
});

describe('the closed vocabularies are closed', () => {
  it.each([...AUDIT_REQUEST_TRADES])('accepts the trade %s', (trade) => {
    expect(auditRequestSchema.safeParse(valid({ trade })).success).toBe(true);
  });

  it('refuses a trade that is not on the list', () => {
    expect(errorsFor(valid({ trade: 'locksmith' })).trade).toBe('Choose the closest trade.');
  });

  it.each([...AUDIT_REQUEST_BANDS])('accepts the band %s', (band) => {
    expect(auditRequestSchema.safeParse(valid({ quotes_per_month: band })).success).toBe(true);
  });

  it('refuses a band that is not on the list', () => {
    expect(errorsFor(valid({ quotes_per_month: '31_40' })).quotes_per_month).toBe(
      'Choose a rough number of quotes a month.',
    );
  });

  /**
   * The labels are what the form, the email and the console all render, so a
   * vocabulary value with no label is a screen reading `undefined`.
   */
  it('has a label for every trade and every band', () => {
    for (const trade of AUDIT_REQUEST_TRADES) expect(TRADE_LABELS[trade]).toBeTruthy();
    for (const band of AUDIT_REQUEST_BANDS) expect(BAND_LABELS[band]).toBeTruthy();
  });
});

describe('the ServiceM8 answer becomes a boolean here, once', () => {
  it('maps yes to true and no to false', () => {
    expect(auditRequestSchema.parse(valid({ servicem8: 'yes' })).servicem8).toBe(true);
    expect(auditRequestSchema.parse(valid({ servicem8: 'no' })).servicem8).toBe(false);
  });

  it('refuses anything else', () => {
    expect(errorsFor(valid({ servicem8: 'maybe' })).servicem8).toBe(
      "Tell us whether you're on ServiceM8.",
    );
  });
});

describe('toAuditFieldErrors writes no key the form does not render', () => {
  /**
   * The returned object is spread into JSX and indexed by field name. An issue
   * from an unexpected path must not be able to put an arbitrary key into it.
   */
  it('ignores an issue whose path is not a known field', () => {
    const parsed = auditRequestSchema.safeParse({ ...valid(), extra: 'x' });
    expect(parsed.success).toBe(true);

    const errors = errorsFor({ ...valid(), business_name: '' });
    for (const key of Object.keys(errors)) {
      expect(AUDIT_REQUEST_FIELDS).toContain(key);
    }
  });
});
