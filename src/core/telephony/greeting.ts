/**
 * THE ONLY TWIML IN THE CODEBASE (Phase 11, D-03/D-04, CAP-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A PAUSE, ONE SENTENCE OF SPEECH, AND A HANG-UP. NOTHING ELSE, EVER.      │
 * │ Nothing is recorded, nothing is gathered, nothing is dialled onward, no  │
 * │ audio file is played and no second URL is fetched (D-04). The document   │
 * │ this module returns is executed by Twilio AS the live call, so its       │
 * │ element set IS the privacy promise the greeting speaks aloud — "the call │
 * │ isn't recorded" — and `tests/telephony-greeting.test.ts` scans every     │
 * │ telephony source for any other verb and fails if one appears.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THE SCRIPT IS D-03, VERBATIM, with one substitution: the client's spoken
 * business name. It says "automated" (founder decision D10) and "isn't
 * recorded", tells the caller a text is coming, and tells a caller whose number
 * is private how to reach the business instead. It never offers to take a
 * message or promises a call back — nothing is listening.
 *
 * WHEN NO NAME IS KNOWN (an unknown called number, a failed signature, an
 * unset base URL, an unreadable body) only the LEAD sentence changes, to a
 * generic greeting; the rest of the script and the element shape are identical.
 * A caller learns nothing about why from the shape of what they hear.
 *
 * ESCAPING IS NOT OPTIONAL. The spoken name is operator-typed text interpolated
 * into an XML document a phone call executes; "Smith & Sons" is a real trading
 * name and an unescaped ampersand is a malformed document — which Twilio
 * answers with its own application-error message to the tradie's customer. So
 * the name is truncated to SPOKEN_NAME_MAX characters (the database CHECK's
 * ceiling, repeated here because this is where the length is spoken) and then
 * entity-escaped. The fixed script needs no escaping: its apostrophes are legal
 * XML character data and it contains no ampersand or angle bracket.
 *
 * NO SSML. A plain `Say` with the Olivia neural voice; the live divert spike
 * (plan 11-06) measures whether the greeting fits in 12 seconds, and the
 * trim, if needed, is a founder edit to the template below.
 */

/** Amazon Polly's Australian-English neural voice, via Twilio. */
export const GREETING_VOICE = 'Polly.Olivia-Neural';

/** The `language` attribute on the one spoken element. */
export const GREETING_LANGUAGE = 'en-AU';

/** The longest spoken name, in characters. Matches the DB CHECK (1..60). */
export const SPOKEN_NAME_MAX = 60;

/** D-03, verbatim. `{business}` is the only substitution. */
export const GREETING_TEMPLATE =
  "Hi, you've reached {business}. This is an automated message and the call isn't recorded. We're texting you now — if your number is private, text us instead.";

/** The lead sentence when no name is known. The rest of the script is unchanged. */
export const GREETING_GENERIC_LEAD = 'Hi, thanks for calling.';

/** The named lead sentence, as it appears in the template. */
const NAMED_LEAD = "Hi, you've reached {business}.";

const XML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** The five XML entities. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);
}

/**
 * The greeting as a TwiML document. `spokenName` null, empty or whitespace →
 * the generic lead; otherwise the name, truncated to SPOKEN_NAME_MAX characters
 * (by code point, so a truncation can never split a character) and escaped.
 */
export function greetingTwiml(spokenName: string | null): string {
  const name = spokenName?.trim() ?? '';

  const text =
    name === ''
      ? GREETING_TEMPLATE.replace(NAMED_LEAD, GREETING_GENERIC_LEAD)
      : // A FUNCTION replacer, not a string: a string replacement interprets
        // `$&`, `$'` and friends, and the name is operator-typed text.
        GREETING_TEMPLATE.replace('{business}', () =>
          escapeXml([...name].slice(0, SPOKEN_NAME_MAX).join('')),
        );

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response>' +
    '<Pause length="1"/>' +
    `<Say voice="${GREETING_VOICE}" language="${GREETING_LANGUAGE}">${text}</Say>` +
    '<Hangup/>' +
    '</Response>'
  );
}
