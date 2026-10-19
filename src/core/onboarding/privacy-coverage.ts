/**
 * Does the public privacy notice cover the people who call a client? (D-09, D-11)
 *
 * The text-back arm action calls `privacyCoversCallers` against the DEPLOYED
 * copy, so a build without the callers section cannot arm anyone for
 * text-back (research rule 5: no caller is texted before the notice tells
 * them what was captured and who processes it).
 *
 * The test is deliberately small and structural: a section with the callers id
 * exists, and between its paragraphs it names BOTH offshore processors a caller
 * meets, Twilio (the call) and ClickSend (the text). A section that loses
 * either name has stopped describing what happens to a caller's number.
 *
 * NO IMPORTS of any kind, so the console's server action and the pure test
 * suite can both take it without dragging the copy module's dependencies in.
 * `tests/privacy-page.test.ts` asserts that.
 */

/** The `id` of the callers section in `PRIVACY_COPY.sections`. */
export const PRIVACY_CALLERS_SECTION_ID = 'callers';

/** The two processors a caller's details pass through, by the name the notice uses. */
const CALLER_PROCESSORS = ['Twilio', 'ClickSend'] as const;

/**
 * True only when the callers section exists and its paragraphs, joined, name
 * both Twilio and ClickSend.
 */
export function privacyCoversCallers(
  sections: readonly { readonly id: string; readonly paragraphs: readonly string[] }[],
): boolean {
  const callers = sections.find((section) => section.id === PRIVACY_CALLERS_SECTION_ID);

  if (!callers) return false;

  const text = callers.paragraphs.join('\n');

  return CALLER_PROCESSORS.every((name) => text.includes(name));
}
