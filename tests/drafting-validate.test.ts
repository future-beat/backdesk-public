/**
 * The trust boundary, under adversarial pressure.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE SUITE IS MOSTLY ATTACKS. A validator tested only on well-behaved     │
 * │ drafts proves nothing — well-behaved drafts pass a function that returns │
 * │ `{ ok: true }` unconditionally.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the cases below are the ways a fabricated fact tries to get through:
 * an invented price, a price whose digits happen to appear inside a supplied
 * one, two supplied values written with nothing between them, a month nobody
 * mentioned, a smart quote that triples the segment count, and a body that
 * quietly dropped the Spam Act line.
 *
 * Each of them ends with a customer receiving something wrong in a tradie's
 * name, which is the failure that ends the business relationship this product
 * exists to protect.
 *
 * PURE — no database, no credentials, no model. Runs on a bare `npm test`.
 * (One case reads two source files for the shared link pattern's import.)
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { complianceSuffix } from '../src/core/cadence/sender';
import { validateDraft, type DraftViolation } from '../src/core/drafting/validate';
import { DEFAULT_LEAD_TEMPLATE_BODIES } from '../src/core/leads/lead-templates';

const SUFFIX = complianceSuffix('Mick Plumbing');

/** The display strings a real touch supplies: amount, date, day count. */
const ALLOWED = ['$2,450', '12 August', '14'] as const;

/** Compose a body the way `draftTouches` does: generated text, then the suffix. */
function withSuffix(generated: string): string {
  return `${generated} ${SUFFIX}`;
}

function validate(generated: string, allowed: readonly string[] = ALLOWED) {
  return validateDraft({
    body: withSuffix(generated),
    allowedDisplayStrings: allowed,
    expectedSuffix: SUFFIX,
  });
}

/** The violations, or a hard failure if the draft unexpectedly passed. */
function violationsOf(result: ReturnType<typeof validate>): DraftViolation[] {
  if (result.ok) throw new Error('expected the draft to be refused, but it passed');
  return result.violations;
}

function rulesOf(result: ReturnType<typeof validate>): string[] {
  return violationsOf(result).map((v) => v.rule);
}

describe('the happy path', () => {
  it('accepts a draft that uses only supplied display strings', () => {
    const result = validate(
      'Hi Sarah, just checking in on that meter box quote from 12 August, $2,450. Any questions? Mick',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.segments).toBe(1);
  });

  it('accepts a draft containing no numbers or dates at all', () => {
    const result = validate('Hi Sarah, did you get a chance to look at that quote? Mick');
    expect(result.ok).toBe(true);
  });

  it('returns the canonical bytes the caller must store and send', () => {
    // Pitfall 6: approval and dispatch must cover identical bytes, so the
    // normalized form comes back rather than being left for the caller to
    // re-derive with a second, possibly different, normalizer.
    const result = validateDraft({
      body: withSuffix('Hi Sarah, it’s about that quote'),
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });
    expect(result.normalizedBody).toContain("it's");
    expect(result.normalizedBody).not.toContain('’');
  });
});

describe('rule 1: no number the caller did not supply (T-5-06)', () => {
  /**
   * THE CASE THE HUMAN GATE DOES NOT RELIABLY CATCH. `$2,540` and `$2,450`
   * are one transposition apart and read identically to a person skimming on a
   * phone at 7am. To a string comparison they are simply different.
   */
  it('refuses a transposed price', () => {
    const result = validate('Hi Sarah, the quote came to $2,540 - still keen? Mick');
    const [violation] = violationsOf(result);
    expect(violation?.rule).toBe('unlisted_number');
    expect(violation?.detail).toBe('$2,540');
  });

  it('names the nearest supplied value so the D-11 regeneration is actionable', () => {
    const result = validate('Hi Sarah, the quote came to $2,540 - still keen? Mick');
    expect(violationsOf(result)[0]?.nearest).toBe('$2,450');
  });

  it('refuses an invented discount', () => {
    expect(rulesOf(validate('Hi Sarah, I can knock 10% off the $2,450. Mick'))).toContain(
      'unlisted_number',
    );
  });

  /**
   * ANYTHING NUMERIC THAT DID NOT COME FROM DATA FAILS — including a phone
   * number, which is a model helpfully inventing a way for a customer to reach
   * somebody who may not exist.
   */
  it('refuses a fabricated phone number', () => {
    const result = validate('Hi Sarah, call me on 0412 345 678 about the $2,450 quote. Mick');
    expect(violationsOf(result).filter((v) => v.rule === 'unlisted_number').length).toBe(3);
  });

  /**
   * THE ADJACENCY EDGE. Two supplied values written with nothing between them
   * form ONE maximal run that was never supplied. A per-value scan would find
   * `$2,450` and `14` on the whitelist and pass `$2,45014` — a number that
   * means nothing, in a message about money.
   */
  it('refuses two supplied values concatenated with no separator', () => {
    const result = validate('Hi Sarah, the quote is $2,45014 - still keen? Mick');
    const [violation] = violationsOf(result);
    expect(violation?.rule).toBe('unlisted_number');
    expect(violation?.detail).toBe('$2,45014');
  });

  /**
   * THE SUBSTRING HOLE, closed. `45` is a substring of `$2,450`, so a
   * naive membership test passes a number about an appointment nobody booked.
   * Runs are compared to runs, so it does not.
   */
  it('refuses a number whose digits merely appear inside a supplied value', () => {
    const result = validate("Hi Sarah, I'll be there in 45 minutes about the $2,450. Mick");
    expect(violationsOf(result).map((v) => v.detail)).toContain('45');
  });

  it('accepts a supplied value quoted from inside a sentence-long display string', () => {
    // The caller sometimes supplies a rendered phrase rather than a bare value;
    // a model quoting either fact out of it is reproducing supplied data.
    const result = validate('Hi Sarah, that $2,450 quote from 12 August - still keen? Mick', [
      'your quote from 12 August for $2,450',
    ]);
    expect(result.ok).toBe(true);
  });

  it('accepts the amount with the dollar sign we supplied dropped', () => {
    // Faithful reproduction: we rendered `$2,450`, the sentence reads better as
    // "the 2,450 quote", and no fact has been invented.
    expect(validate('Hi Sarah, about the 2,450 quote from 12 August. Mick').ok).toBe(true);
  });

  /**
   * THE RELAXATION RUNS ONE WAY. Dropping our dollar sign is faithful; ADDING
   * one turns the day count into a price.
   */
  it('refuses a dollar sign the caller did not supply', () => {
    const result = validate('Hi Sarah, it has been $14 since the quote. Mick');
    expect(violationsOf(result).map((v) => v.detail)).toContain('$14');
  });

  it('accepts a number that ends a sentence', () => {
    expect(validate('Hi Sarah, the quote was $2,450. Let me know. Mick').ok).toBe(true);
  });

  describe('the empty whitelist', () => {
    /**
     * A quote with no total, no date and no day count supplies nothing. The
     * model must then write a follow-up with no numbers in it at all — which
     * is exactly what the prompt tells it to do.
     */
    it('refuses every digit-bearing token', () => {
      const result = validate('Hi Sarah, the quote was $2,450. Mick', []);
      expect(rulesOf(result)).toContain('unlisted_number');
    });

    it('accepts a digit-free body', () => {
      expect(validate('Hi Sarah, did you get a chance to look at that quote? Mick', []).ok).toBe(
        true,
      );
    });

    it('omits `nearest` when there is no supplied value to name', () => {
      const result = validate('Hi Sarah, the quote was $2,450. Mick', []);
      expect(violationsOf(result)[0]?.nearest).toBeUndefined();
    });
  });
});

describe('rule 2: no date word the caller did not supply', () => {
  it('accepts a month that appears in a supplied display string', () => {
    expect(validate('Hi Sarah, about that 12 August quote. Mick').ok).toBe(true);
  });

  it('refuses a month nobody supplied', () => {
    const result = validate('Hi Sarah, I can start in September if that suits. Mick');
    const [violation] = violationsOf(result);
    expect(violation?.rule).toBe('unlisted_date_word');
    expect(violation?.detail).toBe('September');
  });

  it('refuses a fabricated weekday', () => {
    expect(rulesOf(validate('Hi Sarah, I could swing by Tuesday. Mick'))).toContain(
      'unlisted_date_word',
    );
  });

  it('refuses a three-letter month abbreviation nobody supplied', () => {
    expect(rulesOf(validate('Hi Sarah, how about early Sep? Mick'))).toContain(
      'unlisted_date_word',
    );
  });

  /**
   * THE FALSE-POSITIVE CASES, and the reason the scan is case-sensitive. Every
   * one of these is a correct draft, and a validator that refused them would
   * teach an operator to click past refusals.
   */
  it('does not fire on ordinary English words that share a spelling', () => {
    for (const body of [
      'Hi Sarah, you may want to look at that quote. Mick',
      'Hi Sarah, we sat down and had another look at the price. Mick',
      'Hi Sarah, happy to get this done before the sun goes. Mick',
    ]) {
      expect(validate(body).ok).toBe(true);
    }
  });

  it('matches a supplied month case-insensitively', () => {
    expect(validate('Hi Sarah, about that August quote. Mick', ['12 august']).ok).toBe(true);
  });
});

describe('rule 3: charset and length in septets (D-03)', () => {
  /**
   * The normalizer repairs the lookalike, so a draft whose only sin was a smart
   * apostrophe PASSES rather than costing a regeneration.
   */
  it('accepts a curly-quoted body the normalizer can repair', () => {
    const result = validateDraft({
      body: withSuffix('Hi Sarah, it’s about that quote — still keen?'),
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });
    expect(result.ok).toBe(true);
  });

  /**
   * An emoji survives normalization on purpose, so the refusal can NAME it.
   * A body silently edited on the way to a customer is worse than one refused.
   */
  it('refuses a character the normalizer cannot repair, naming it', () => {
    const result = validate('Hi Sarah, still keen on that quote? 👍 Mick');
    const violation = violationsOf(result).find((v) => v.rule === 'non_gsm_character');
    expect(violation?.detail).toBe('👍');
  });

  it('refuses a UCS-2 flip however short the body is', () => {
    expect(rulesOf(validate('Ω 👍'))).toContain('non_gsm_character');
  });

  /**
   * THE D-03 BOUNDARY, both sides, measured in septets over the FINAL body
   * (suffix included — the customer pays for that too).
   */
  it('accepts exactly two segments and refuses three', () => {
    const suffixSeptets = SUFFIX.length + 1; // the joining space
    const twoSegments = 'a'.repeat(306 - suffixSeptets);
    const threeSegments = 'a'.repeat(307 - suffixSeptets);

    const pass = validate(twoSegments);
    expect(pass.ok).toBe(true);
    if (!pass.ok) throw new Error('unreachable');
    expect(pass.segments).toBe(2);

    const fail = validate(threeSegments);
    const violation = violationsOf(fail).find((v) => v.rule === 'too_many_segments');
    expect(violation?.detail).toBe('3');
  });

  /**
   * The tracer's interim `length / 153` would call this two segments. Two
   * euro signs are four septets, not two characters, and the difference is a
   * whole extra segment on the invoice.
   */
  it('counts extension characters at two septets when deciding the cap', () => {
    const suffixSeptets = SUFFIX.length + 1;
    // 304 septets of text + 2 for the euro sign = 307 over the whole body.
    const body = 'a'.repeat(306 - suffixSeptets) + '€';
    expect(body.length).toBe(307 - suffixSeptets); // 307 characters, 308 septets
    expect(rulesOf(validate(body))).toContain('too_many_segments');
  });
});

describe('rule 4: the compliance line is present', () => {
  it('refuses a body that dropped the suffix', () => {
    const result = validateDraft({
      body: 'Hi Sarah, still keen on that quote?',
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });
    expect(rulesOf(result)).toContain('missing_suffix');
  });

  it('refuses a suffix that is present but not at the end', () => {
    const result = validateDraft({
      body: `${SUFFIX} Hi Sarah, still keen on that quote?`,
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });
    expect(rulesOf(result)).toContain('missing_suffix');
  });

  /**
   * `tenants.name` is operator-typed, so a smart apostrophe in the business
   * name is a realistic row. Un-normalized it would land in OUR OWN appended
   * text and produce a draft no amount of regeneration could fix.
   */
  it('matches a suffix whose business name contains a smart apostrophe', () => {
    const suffix = complianceSuffix('Mick’s Plumbing');
    const result = validateDraft({
      body: `Hi Sarah, still keen on that quote? ${suffix}`,
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: suffix,
    });
    expect(result.ok).toBe(true);
    expect(result.normalizedBody).toContain("Mick's Plumbing");
  });
});

describe('our own suffix is not judged by the rules written for the model', () => {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ "A1 Plumbing" AND "24/7 Electrical" ARE REAL AUSTRALIAN TRADE NAMES.     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Those digits are OURS — we compose `complianceSuffix(tenants.name)` and
   * append it. Judging them as fabricated numbers produces a violation the
   * model cannot fix however many times it regenerates, because the characters
   * are reappended to every attempt: a permanently undraftable client whose
   * only symptom is that every draft needs authoring by hand.
   *
   * Same shape as the smart-apostrophe case above, one rule over.
   */
  it('accepts a business name containing digits', () => {
    const suffix = complianceSuffix('A1 Plumbing 24/7');
    const result = validateDraft({
      body: `Hi Sarah, still keen on that quote? ${suffix}`,
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: suffix,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a business name containing a date word', () => {
    const suffix = complianceSuffix('March Electrical');
    const result = validateDraft({
      body: `Hi Sarah, still keen on that quote? ${suffix}`,
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: suffix,
    });
    expect(result.ok).toBe(true);
  });

  it('still refuses a fabricated number in the MODEL’s half of the same body', () => {
    // The exclusion is the trailing suffix region and nothing else — a number
    // the model invented is still caught when the business name has digits too.
    const suffix = complianceSuffix('A1 Plumbing');
    const result = validateDraft({
      body: `Hi Sarah, I can swing past in 45 minutes. ${suffix}`,
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: suffix,
    });
    expect(rulesOf(result)).toContain('unlisted_number');
    expect(violationsOf(result).map((v) => v.detail)).toEqual(['45']);
  });

  it('scans the WHOLE body when the suffix is absent, so nothing hides behind an imitation', () => {
    const suffix = complianceSuffix('A1 Plumbing');
    const result = validateDraft({
      // Ends with something suffix-SHAPED but not the expected bytes.
      body: 'Hi Sarah, pay the 999 deposit. A1 Plumbing. Reply STOP to opt-out.',
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: suffix,
    });
    expect(rulesOf(result)).toContain('missing_suffix');
    expect(violationsOf(result).map((v) => v.detail)).toContain('999');
    // The imitation's own digits are judged too, precisely because they are not
    // provably ours.
    expect(violationsOf(result).map((v) => v.detail)).toContain('1');
  });
});

describe('the empty body', () => {
  it('is a single hard violation, not a very short message', () => {
    const result = validateDraft({
      body: '   ',
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });
    expect(violationsOf(result)).toEqual([{ rule: 'empty_body' }]);
  });

  it('does not report a missing suffix as well (one problem, one instruction)', () => {
    const result = validateDraft({
      body: '',
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });
    expect(rulesOf(result)).toEqual(['empty_body']);
  });
});

describe('the violation list', () => {
  it('reports every rule that fired, not just the first', () => {
    // D-11 feeds the whole list back to the model in one regeneration. A
    // first-failure-wins validator would need four round trips to surface four
    // problems, and the attempt ceiling only allows two.
    const result = validateDraft({
      body: 'Hi Sarah, $2,540 in September 👍',
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });
    expect(new Set(rulesOf(result))).toEqual(
      new Set(['unlisted_number', 'unlisted_date_word', 'non_gsm_character', 'missing_suffix']),
    );
  });
});

describe('the documented limit: a number written in WORDS', () => {
  // ── AN HONEST TEST OF A REAL GAP ──────────────────────────────────────────
  //
  // This does not assert that the validator catches a spelled-out price. It
  // asserts that it does NOT — because that is true, and a suite that quietly
  // omitted the case would leave the file's "MECHANICAL, NOT PERSUASIVE...
  // catches what a person skims past" framing reading as a total guarantee. It
  // is not total: `NUMBER_TOKEN` only matches runs containing an ASCII digit.
  //
  // The gap is mitigated on the PROMPT side and backstopped by the human
  // approval gate. Pinning it here means anyone who later extends Rule 1 to
  // English numerals gets a failing test telling them to delete this block —
  // rather than a silent one that never described the boundary at all.
  it.each([
    'the job comes to about two and a half grand',
    'a shade under twenty-five hundred',
    'give us about a fortnight',
  ])('passes: %s (digits are covered; words are not)', (phrase) => {
    const result = validateDraft({
      body: `Hi Sarah, ${phrase}. ${SUFFIX}`,
      allowedDisplayStrings: ALLOWED,
      expectedSuffix: SUFFIX,
    });

    expect(result.ok).toBe(true);
  });

  it('the prompt names the words the validator cannot see', async () => {
    // The mitigation and the gap are one decision, so they are pinned together:
    // deleting the instruction without extending the scan would leave nothing
    // at all in front of the human gate.
    const { INSTRUCTIONS_TEXT } = await import('../src/core/drafting/prompt');

    expect(INSTRUCTIONS_TEXT).toContain('numbers written in WORDS');
    expect(INSTRUCTIONS_TEXT).toContain('two and a half grand');
  });
});

// ── Phase 13 (2026-10, 13-02, D-02): the shipped lead defaults ──────────────

describe('the default lead wording survives the validator at the longest business name', () => {
  /**
   * The defaults are the model's INPUT, but a draft that reproduces one
   * verbatim must still pass: if the wording plus the compliance line could
   * overflow two segments for a long business name, the first client with one
   * would have every lead follow-up refused before a human saw it. 120
   * characters is past any name a sole trader registers. The only display
   * string a lead may state is the day count.
   */
  const LONG_NAME = 'Perth Northern Suburbs Emergency Plumbing Gas Fitting Hot Water and Blocked Drain Specialists of Western Australia Group';
  const LEAD_SUFFIX = complianceSuffix(LONG_NAME);

  it('uses a business name of exactly 120 characters', () => {
    expect(LONG_NAME.length).toBe(120);
  });

  it.each([2, 3] as const)('touch %i passes at two segments or fewer with the day count only', (touch) => {
    const result = validateDraft({
      body: `${DEFAULT_LEAD_TEMPLATE_BODIES[touch]} ${LEAD_SUFFIX}`,
      allowedDisplayStrings: ['1'],
      expectedSuffix: LEAD_SUFFIX,
      // As the drafting pass judges a lead draft (13-REVIEW WR-02).
      forbidLinks: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.segments).toBeLessThanOrEqual(2);
  });

  it.each([2, 3] as const)('touch %i carries no digit, link or price of its own', (touch) => {
    const body = DEFAULT_LEAD_TEMPLATE_BODIES[touch];
    expect(body).not.toMatch(/\d/);
    expect(body).not.toMatch(/https?:|www\.|\.com/);
    expect(body).not.toContain('$');
  });

  // 2026-10-09 (13-REVIEW WR-04): touch 2 lands one to four days after the call
  // (rolled past weekends and public holidays), touch 3 two or more, so a
  // relative day word in a shipped default is false on some day it sends.
  it.each([2, 3] as const)('touch %i names no relative day ("yesterday", "today", …)', (touch) => {
    expect(DEFAULT_LEAD_TEMPLATE_BODIES[touch]).not.toMatch(/\b(?:yesterday|today|tonight|tomorrow)\b/i);
  });

  it('touch 2 is the shipped wording, byte for byte', () => {
    expect(DEFAULT_LEAD_TEMPLATE_BODIES[2]).toBe(
      "Following up on your recent call. Still need a hand? Reply with the job and your suburb and we'll be in touch.",
    );
  });

  it('refuses a lead draft that adds a number the day count does not cover', () => {
    const result = validateDraft({
      body: `${DEFAULT_LEAD_TEMPLATE_BODIES[2]} We can be there by 3. ${LEAD_SUFFIX}`,
      allowedDisplayStrings: ['1'],
      expectedSuffix: LEAD_SUFFIX,
    });
    expect(rulesOf(result)).toContain('unlisted_number');
  });
});

// ── 13-REVIEW WR-02 (2026-10-09): "no links" on a lead draft is mechanical ──

describe('rule 5: a lead draft carries no link (D-13)', () => {
  /**
   * The prompt asked for "no links"; this is the rule that makes asking
   * unnecessary. `backdesk.com.au/book` has no digit and no date word, so
   * before this rule it passed Rules 1–4 and reached the queue with only a
   * human between it and a stranger's phone. Opt-in: a QUOTE draft passes no
   * `forbidLinks` and is judged exactly as before (D-17).
   */
  function lead(generated: string, suffix: string = SUFFIX) {
    return validateDraft({
      body: `${generated} ${suffix}`,
      allowedDisplayStrings: ['1'],
      expectedSuffix: suffix,
      forbidLinks: true,
    });
  }

  it.each([
    ['www.', 'Still need a hand? Book at www.mickplumbing.au', 'www.'],
    ['a bare host', 'Still need a hand? Book at backdesk.com.au/book', 'backdesk.com'],
    ['a scheme', 'Still need a hand? See https://example.org', 'https://'],
  ])('refuses %s, naming the fragment', (_case, generated, fragment) => {
    const violations = violationsOf(lead(generated));
    const link = violations.find((v) => v.rule === 'link');
    expect(link).toBeDefined();
    expect(link?.detail).toBe(fragment);
  });

  it('accepts the plain default wording and an ordinary sentence', () => {
    expect(lead(DEFAULT_LEAD_TEMPLATE_BODIES[2]).ok).toBe(true);
    expect(lead('Still need a hand with the job? Reply with your suburb. Mick').ok).toBe(true);
  });

  it('judges the MODEL’s text only: a host-shaped business name in our suffix is not a link', () => {
    const suffix = complianceSuffix('Mick.Plumbing');
    expect(lead('Still need a hand with the job?', suffix).ok).toBe(true);
  });

  it('one spelling: both validators import the import-free shared leaf, and neither re-declares it', () => {
    const strip = (path: string) =>
      readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(strip('src/core/shared/link-pattern.ts')).not.toMatch(/^\s*import\b/m);
    for (const path of ['src/core/drafting/validate.ts', 'src/core/leads/template.ts']) {
      const source = strip(path);
      // Either spelling of the same leaf: the drafting validator must use the
      // relative form because scripts/verify-drafting.mjs loads it through a
      // resolver that refuses `@/` aliases (scripts/lib/ts-resolve-hooks.mjs).
      expect(source, path).toMatch(
        /import \{ LINK_PATTERN \} from '(?:@\/core|\.\.)\/shared\/link-pattern';/,
      );
      expect(source, path).not.toMatch(/const LINK_PATTERN\s*=/);
    }
  });

  it('a QUOTE draft (no forbidLinks) is unchanged: the same URL passes Rules 1–4 as before', () => {
    // Not an endorsement of links in quote drafts — the record that the quote
    // path's behaviour did not move with this rule (D-17).
    expect(validate('Hi Sarah, the quote is at www.mickplumbing.au. Mick').ok).toBe(true);
  });
});
