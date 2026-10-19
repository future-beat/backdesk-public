/**
 * THE TEXT-BACK WORDING (Phase 12, D-02/D-03/D-23) — defaults and validator.
 *
 * Pure. Every length below is measured with the SAME counter the validator
 * uses (`countSeptets` / `segmentCount`), never typed as a magic number — the
 * one known answer pinned here is the fixed text of D-03's default, which the
 * research measured at 179 and this suite re-measures.
 */
import { describe, expect, it } from 'vitest';

import { countSeptets, segmentCount } from '@/core/drafting/gsm7';
import {
  defaultTextBackBody,
  TEXT_BACK_MAX_SEGMENTS,
  TEXT_BACK_PRIVACY_POINTER,
  validateTextBackTemplate,
  type TextBackTemplateResult,
} from '@/core/leads/template';
import { TEXT_BACK_VARIANTS, type TextBackVariant } from '@/db/schema';

const NAME = "Dave's Electrical";

function septets(body: string): number {
  const counted = countSeptets(body);
  if (counted.encoding !== 'gsm7') throw new Error('fixture is not GSM-7');
  return counted.septets;
}

function rules(result: TextBackTemplateResult): string[] {
  return result.ok ? [] : result.violations.map((v) => v.rule);
}

function validate(body: string, businessName = NAME, variant: TextBackVariant = 'business_hours') {
  return validateTextBackTemplate(body, { businessName, variant });
}

describe('the defaults (D-03, D-23)', () => {
  it('business hours is D-03 verbatim with the name typed in', () => {
    expect(defaultTextBackBody('business_hours', NAME)).toBe(
      "Hi, it's Dave's Electrical. Sorry we missed your call. What do you need a hand with, " +
        "and which suburb? Reply here and we'll get back to you. Reply STOP to opt out. " +
        'Privacy: backdesk.com.au/privacy',
    );
  });

  it('after hours inserts the morning clause after "we\'ll get back to you."', () => {
    expect(defaultTextBackBody('after_hours', NAME)).toContain(
      "we'll get back to you. We read replies in the morning unless it's urgent. Reply STOP",
    );
  });

  it('about quote is the D-23 wording', () => {
    expect(defaultTextBackBody('about_quote', NAME)).toBe(
      "Hi, it's Dave's Electrical. Sorry we missed your call. Is it about your quote? " +
        "Reply here and we'll get back to you. Reply STOP to opt out. Privacy: backdesk.com.au/privacy",
    );
  });

  it.each(TEXT_BACK_VARIANTS)('the %s default validates for a short name', (variant) => {
    const result = validate(defaultTextBackBody(variant, NAME), NAME, variant);
    expect(result).toMatchObject({ ok: true });
  });

  it('the fixed text of the business-hours default is 179 septets (known answer, re-measured)', () => {
    // The default with an EMPTY name, minus nothing: `Hi, it's . Sorry …`.
    const fixed = septets(defaultTextBackBody('business_hours', ''));
    expect(fixed).toBe(179);
    // So it can never be one segment, whatever the name.
    expect(segmentCount(fixed)).toBe(2);
  });

  it('the business-hours default for a 120-character name (the tenants_name_len cap) is exactly 2 segments', () => {
    const name = 'A'.repeat(120);
    const result = validate(defaultTextBackBody('business_hours', name), name);
    expect(result).toEqual({
      ok: true,
      segments: 2,
      normalizedBody: defaultTextBackBody('business_hours', name),
    });
  });

  it('the after-hours default for a name past its budget is REFUSED too_many_segments, never truncated', () => {
    const fixed = septets(defaultTextBackBody('after_hours', ''));
    const budget = 306 - fixed; // two segments of 153
    expect(segmentCount(fixed + budget)).toBe(2);
    expect(segmentCount(fixed + budget + 1)).toBe(3);

    const fits = 'B'.repeat(budget);
    expect(validate(defaultTextBackBody('after_hours', fits), fits, 'after_hours')).toMatchObject({
      ok: true,
      segments: 2,
    });

    const over = 'B'.repeat(budget + 1);
    const body = defaultTextBackBody('after_hours', over);
    const result = validate(body, over, 'after_hours');
    expect(rules(result)).toEqual(['too_many_segments']);
    // The default is returned whole — the validator refuses, it never shortens.
    expect(body).toContain(over);
  });
});

describe('the segment boundary (D-02)', () => {
  it('the largest accepted body is 306 septets; one more is too_many_segments', () => {
    expect(TEXT_BACK_MAX_SEGMENTS).toBe(2);
    const fixed = septets(defaultTextBackBody('business_hours', ''));
    const name306 = 'C'.repeat(306 - fixed);
    const at = defaultTextBackBody('business_hours', name306);
    expect(septets(at)).toBe(306);
    expect(validate(at, name306)).toMatchObject({ ok: true, segments: 2 });

    const name307 = 'C'.repeat(307 - fixed);
    const over = defaultTextBackBody('business_hours', name307);
    expect(septets(over)).toBe(307);
    expect(rules(validate(over, name307))).toEqual(['too_many_segments']);
  });

  it('an extension character costs TWO septets: the euro sign', () => {
    expect(septets('€')).toBe(2);
    const fixed = septets(defaultTextBackBody('business_hours', ''));
    // A name of (306 - fixed - 1) basic characters plus one euro sign = 307.
    const name = `${'D'.repeat(306 - fixed - 1)}€`;
    const body = defaultTextBackBody('business_hours', name);
    expect(septets(body)).toBe(307);
    expect(rules(validate(body, name))).toEqual(['too_many_segments']);
  });

  it('a non-GSM character is not_gsm7 — refused to be rewritten, never shortened', () => {
    const body = `${defaultTextBackBody('business_hours', NAME)} 👍`;
    const result = validate(body);
    expect(rules(result)).toEqual(['not_gsm7']);
    expect(result.ok ? null : result.violations[0].detail).toBe('👍');
  });

  it('a curly apostrophe normalises and passes', () => {
    const curly = defaultTextBackBody('business_hours', NAME).replace("it's", 'it’s');
    const result = validate(curly);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.normalizedBody).toBe(defaultTextBackBody('business_hours', NAME));
  });

  it('a business name with a curly apostrophe still identifies a straight-apostrophe body', () => {
    expect(validate(defaultTextBackBody('business_hours', NAME), 'Dave’s Electrical')).toMatchObject({
      ok: true,
    });
  });
});

describe('the content rules', () => {
  const base = defaultTextBackBody('business_hours', NAME);

  it('an empty body is empty — and only that', () => {
    expect(rules(validate(''))).toEqual(['empty']);
    expect(rules(validate('   \n '))).toEqual(['empty']);
  });

  it('missing STOP is missing_stop', () => {
    expect(rules(validate(base.replace('Reply STOP to opt out. ', '')))).toEqual(['missing_stop']);
  });

  it('"ReplySTOP" is not "Reply STOP"', () => {
    expect(rules(validate(base.replace('Reply STOP', 'ReplySTOP')))).toEqual(['missing_stop']);
  });

  it('a missing privacy pointer is missing_privacy_pointer', () => {
    expect(rules(validate(base.replace(` Privacy: ${TEXT_BACK_PRIVACY_POINTER}`, '')))).toEqual([
      'missing_privacy_pointer',
    ]);
  });

  it.each([
    ['a scheme', 'https://example.com.au'],
    ['a www host', 'www.example'],
    ['a bare domain', 'davesparks.com.au'],
    ['a second backdesk path', 'backdesk.com.au/book'],
  ])('a second link (%s) is extra_link', (_label, link) => {
    expect(rules(validate(`${base} ${link}`))).toContain('extra_link');
  });

  it('the pointer itself is not a second link', () => {
    expect(validate(base)).toMatchObject({ ok: true });
  });

  it('a leftover merge token is merge_token_left', () => {
    const body = base.replace(NAME, '{business}');
    expect(rules(validate(body, '{business}'))).toContain('merge_token_left');
    expect(rules(validate(`${base} }`))).toContain('merge_token_left');
  });

  it('a body without the business name is missing_identity', () => {
    expect(rules(validate(base, 'Perth Sparks'))).toEqual(['missing_identity']);
  });

  it('identity is case-insensitive and trimmed', () => {
    expect(validate(base, '  dave\'s ELECTRICAL  ')).toMatchObject({ ok: true });
  });

  it('a blank business name can never be satisfied', () => {
    expect(rules(validate(base, '   '))).toEqual(['missing_identity']);
  });
});
