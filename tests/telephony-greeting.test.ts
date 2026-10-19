/**
 * D-04, PINNED: NOTHING A DIVERTED CALLER SAYS IS EVER RECORDED — and the
 * greeting that tells them so is D-03's script, escaped, in the shape Twilio
 * executes as the live call (Phase 11, CAP-02).
 *
 * TWO HALVES, and the first is the one that matters most.
 *
 *  1. THE STRUCTURAL HALF scans EVERY `.ts` file under `src/core/telephony/`
 *     and `src/app/api/webhooks/twilio/` — comments stripped, so a header that
 *     names what it refuses cannot trip it and deleting the explanation cannot
 *     satisfy it — for any TwiML verb other than the three the greeting uses,
 *     and for any recording or transcription API. A future file added to either
 *     directory is scanned without anybody remembering to list it.
 *  2. THE GREETING HALF parses what `greetingTwiml` actually returns: exactly
 *     Response, Pause, Say and Hangup; the D-03 clauses present; the name
 *     escaped and capped.
 *
 * NEGATIVE CONTROL, RUN DURING AUTHORING (the 08-01 pattern): a `<Record/>`
 * element was temporarily added to the TwiML string in `greeting.ts` and this
 * suite was run — the structural scan and the element-set assertions both
 * FAILED — then the line was removed and the suite went green again. A scan
 * that has never been seen to fail is a scan nobody knows works.
 *
 * WHEN THE DEFERRED PER-CLIENT RECORDED GREETING LANDS (CONTEXT, deferred
 * ideas), `Play` comes out of the forbidden list ON PURPOSE, in the same commit,
 * with its own argument. Until then an audio verb in these sources is a
 * regression.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GREETING_GENERIC_LEAD,
  GREETING_LANGUAGE,
  GREETING_TEMPLATE,
  GREETING_VOICE,
  SPOKEN_NAME_MAX,
  escapeXml,
  greetingTwiml,
} from '@/core/telephony/greeting';

const SCANNED_DIRS = ['src/core/telephony', 'src/app/api/webhooks/twilio'];

/** Every `.ts` file under the two telephony directories, recursively. */
function telephonySources(): string[] {
  return SCANNED_DIRS.flatMap((dir) =>
    (readdirSync(dir, { recursive: true }) as string[])
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => join(dir, entry)),
  ).sort();
}

/** Source with comments stripped — the `tests/ops-scripts.test.ts` rule. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * TwiML elements that must never appear. Written as an element — an opening
 * angle bracket, the verb, then whitespace, `/` or `>` — so a TypeScript
 * generic such as `Readonly<Record<string, string>>` is not an element.
 */
const FORBIDDEN_ELEMENTS: ReadonlyArray<readonly [string, RegExp, string]> = [
  ['Record', /<\s*Record(?=[\s/>])/, 'records the caller — the one thing D-04 exists to forbid'],
  ['Dial', /<\s*Dial(?=[\s/>])/, 'connects the caller onward; its `record` attribute is a second recorder'],
  ['Gather', /<\s*Gather(?=[\s/>])/, 'collects digits or SPEECH — speech gathering is a transcript'],
  ['Transcription', /<\s*Transcription(?=[\s/>])/, 'real-time transcription of the call'],
  ['Start', /<\s*Start(?=[\s/>])/, 'opens a Recording, Stream or Siprec fork of the call audio'],
  ['Stream', /<\s*Stream(?=[\s/>])/, 'ships live call audio to a websocket'],
  ['Connect', /<\s*Connect(?=[\s/>])/, 'bridges the call to a stream, an assistant or a conversation'],
  ['Enqueue', /<\s*Enqueue(?=[\s/>])/, 'holds the caller in a queue nobody answers'],
  ['Queue', /<\s*Queue(?=[\s/>])/, 'dials into a queue — the same hold, the other end'],
  ['Conference', /<\s*Conference(?=[\s/>])/, 'a conference, with its own `record` attribute'],
  ['Play', /<\s*Play(?=[\s/>])/, 'plays audio — the DEFERRED per-client recorded greeting, not v1.2'],
  ['Redirect', /<\s*Redirect(?=[\s/>])/, 'hands the call to a second URL, which could return ANY verb'],
];

/** Recording / transcription APIs that must never be called from these sources. */
const FORBIDDEN_APIS: ReadonlyArray<readonly [string, RegExp, string]> = [
  ['record: true', /\brecord\s*[:=]\s*['"]?true/i, 'the REST `Record=true` call option records the call'],
  ['recordings.create', /recordings\s*\.\s*create/i, "starts a recording on a live call via the call's subresource"],
  ['transcribe', /transcribe/i, 'the transcription attribute/option — a transcript is a recording in text'],
  ['.record(', /\.record\s*\(/i, 'the TwiML builder verb for recording'],
];

describe('D-04: no recording verb or API anywhere in the telephony sources', () => {
  const sources = telephonySources();

  it('scans the files that matter — an empty glob would pass everything', () => {
    expect(sources).toContain(join('src/core/telephony', 'greeting.ts'));
    expect(sources).toContain(join('src/app/api/webhooks/twilio', 'voice/route.ts'));
    expect(sources.length).toBeGreaterThanOrEqual(7);
  });

  it.each(FORBIDDEN_ELEMENTS)('no <%s> element in any telephony source', (name, pattern, why) => {
    for (const path of sources) {
      expect(pattern.test(code(path)), `${path} contains a <${name}> element — forbidden: ${why}`).toBe(
        false,
      );
    }
  });

  it.each(FORBIDDEN_APIS)('no `%s` call in any telephony source', (name, pattern, why) => {
    for (const path of sources) {
      expect(pattern.test(code(path)), `${path} contains ${name} — forbidden: ${why}`).toBe(false);
    }
  });

  it('the scanner is not blind: it catches each forbidden element in a string', () => {
    for (const [name, pattern] of FORBIDDEN_ELEMENTS) {
      expect(pattern.test(`'<Response><${name}/></Response>'`)).toBe(true);
      expect(pattern.test(`'<${name} action="x">'`)).toBe(true);
    }
    // ...and is not tripped by a TypeScript generic.
    expect(FORBIDDEN_ELEMENTS[0][1].test('const x: Readonly<Record<string, string>> = {};')).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * The greeting half
 * ------------------------------------------------------------------------- */

/** Every element name in a TwiML document (the XML declaration excluded). */
function elements(xml: string): Set<string> {
  return new Set(
    [...xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<([A-Za-z]+)[\s/>]/g)].map((m) => m[1]),
  );
}

/** The text inside the one Say element. */
function sayText(xml: string): string {
  const found = xml.match(/<Say[^>]*>([\s\S]*?)<\/Say>/);
  if (!found) throw new Error('no Say element');
  return found[1];
}

/** Words, as a listener hears them: punctuation and the dash are not words. */
function words(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z']*/g) ?? [];
}

describe('D-03: the greeting TwiML', () => {
  const named = greetingTwiml('Smith & Sons');

  it('is exactly Response, Pause, Say and Hangup', () => {
    expect(elements(named)).toEqual(new Set(['Response', 'Pause', 'Say', 'Hangup']));
    expect(named.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response>')).toBe(true);
    expect(named).toContain('<Pause length="1"/>');
    expect(named.endsWith('<Hangup/></Response>')).toBe(true);
    // Exactly one of each.
    expect(named.match(/<Say\b/g)).toHaveLength(1);
    expect(named.match(/<Pause\b/g)).toHaveLength(1);
    expect(named.match(/<Hangup\b/g)).toHaveLength(1);
  });

  it('escapes the ampersand in a real trading name', () => {
    expect(named).toContain('Smith &amp; Sons');
    expect(named).not.toContain('Smith & Sons');
  });

  it('escapes an apostrophe in the name', () => {
    expect(greetingTwiml("O'Brien's Plumbing")).toContain('O&apos;Brien&apos;s Plumbing');
  });

  it('speaks with the Australian neural voice', () => {
    expect(named).toContain(`<Say voice="${GREETING_VOICE}" language="${GREETING_LANGUAGE}">`);
    expect(GREETING_VOICE).toBe('Polly.Olivia-Neural');
    expect(GREETING_LANGUAGE).toBe('en-AU');
  });

  it('says the four D-03 clauses, and never promises what nothing is there to do', () => {
    const spoken = sayText(named);
    for (const clause of ['automated', "isn't recorded", 'texting you now', 'text us instead']) {
      expect(spoken).toContain(clause);
    }
    // Nothing is listening and nobody will ring back from this line.
    expect(spoken.toLowerCase()).not.toContain('leave a message');
    expect(spoken.toLowerCase()).not.toContain('call you back');
  });

  it('is D-03 VERBATIM with the name substituted', () => {
    expect(GREETING_TEMPLATE).toBe(
      "Hi, you've reached {business}. This is an automated message and the call isn't recorded. We're texting you now — if your number is private, text us instead.",
    );
    expect(sayText(greetingTwiml('Acme Electrical'))).toBe(
      GREETING_TEMPLATE.replace('{business}', 'Acme Electrical'),
    );
  });

  it('the template WITHOUT the name is at most 25 words (the 12-second budget)', () => {
    expect(words(GREETING_TEMPLATE.replace('{business}', '')).length).toBeLessThanOrEqual(25);
  });

  it('with no name: the generic lead, the same element shape, the rest unchanged', () => {
    for (const blank of [null, '', '   ']) {
      const generic = greetingTwiml(blank);
      expect(elements(generic)).toEqual(new Set(['Response', 'Pause', 'Say', 'Hangup']));
      expect(generic).toContain(GREETING_GENERIC_LEAD);
      expect(generic).not.toContain('reached');
      expect(sayText(generic)).toContain("This is an automated message and the call isn't recorded.");
    }
  });

  it(`caps the spoken name at SPOKEN_NAME_MAX (${SPOKEN_NAME_MAX}) characters`, () => {
    expect(SPOKEN_NAME_MAX).toBe(60);
    const long = greetingTwiml('X'.repeat(200));
    expect(long.match(/X/g)).toHaveLength(SPOKEN_NAME_MAX);
  });

  it('never yields a raw angle bracket inside the Say text', () => {
    const hostile = greetingTwiml('<Record/> & <Dial>+61400000000</Dial>');
    const text = sayText(hostile);

    expect(text).not.toMatch(/[<>]/);
    expect(elements(hostile)).toEqual(new Set(['Response', 'Pause', 'Say', 'Hangup']));
  });

  it('is not fooled by replacement patterns in the name', () => {
    // A string replacement would expand `$&` into the matched `{business}`.
    expect(sayText(greetingTwiml('Cash $& Carry'))).toContain('Cash $&amp; Carry');
  });

  it('escapeXml covers the five entities', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});
