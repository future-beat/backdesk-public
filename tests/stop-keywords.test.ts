/**
 * MSG-03's first rule, and the one with two opposite failure modes.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MISSING A REAL STOP IS A SPAM ACT BREACH. MATCHING A FAKE ONE IS A      │
 * │ CUSTOMER SILENTLY DELETED FROM A LIVE CONVERSATION, IRREVERSIBLY.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The second half is why this suite spends as much effort on the NON-matches as
 * on the matches. A suppression written by `handleInboundSms` inherits D-06's
 * never-chase-again semantics: there is no unsuppress function, no repository
 * mutator and no grant for one (see src/db/schema/suppressed-contacts.ts). So a
 * substring match on "can't stop thinking about the quote" — an ENTHUSIASTIC
 * reply — would end that customer's cadence forever, and nobody would find out
 * until the tradie asked why their hottest lead went quiet.
 *
 * Hence the rule under test: the regex is ANCHORED TO THE WHOLE TRIMMED
 * MESSAGE. A keyword is an opt-out only when it is the entire message.
 *
 * PURE, so it runs on a bare `npm test` with no database and no credentials.
 */
import { describe, expect, it } from 'vitest';

import { isStopMessage } from '../src/core/messaging/stop-keywords';

/**
 * Bodies that ARE an opt-out.
 *
 * The casing and punctuation variants are not padding: a phone keyboard
 * autocapitalises and autocorrects, and providers routinely wrap the body in
 * whitespace or a trailing newline. Every one of these is a real human trying to
 * be left alone, and a regex that missed any of them would be a compliance
 * failure wearing the disguise of a typo.
 */
const OPT_OUTS = [
  'STOP',
  'stop',
  'Stop',
  'Stop.',
  'STOP!',
  ' stop ',
  '\nSTOP\n',
  'STOPALL',
  'STOP ALL',
  'stopall',
  'UNSUBSCRIBE',
  'unsubscribe',
  'CANCEL',
  'Cancel.',
  'END',
  'QUIT',
  'quit!',
  'OPT OUT',
  'OPT-OUT',
  'OPTOUT',
  'opt out',
];

/**
 * Bodies that are NOT an opt-out, and the reason each one is here.
 *
 * The first three are the whole argument for anchoring: all three CONTAIN a
 * keyword and all three are somebody still talking to us. The `unsubscribe me
 * from the newsletter` line is the same trap one register up — a sentence about
 * a DIFFERENT mailing list should not end this tradie's follow-up.
 *
 * The word-boundary cases (`ended`, `stopper`, `cancelled`) are the other half:
 * a regex anchored with `^...$` but written without care about where the keyword
 * ends would match a longer word that merely starts with one.
 */
const NOT_OPT_OUTS = [
  "please don't stop by",
  "can't stop thinking about the quote",
  'stop by tomorrow?',
  'unsubscribe me from the newsletter please',
  'Can you cancel the quote?',
  'ended',
  'stopper',
  'cancelled',
  'quitting time',
  '',
  '   ',
  '.',
  '!!!',
];

describe('isStopMessage — the anchored whole-message rule', () => {
  it.each(OPT_OUTS)('treats %j as an opt-out', (body) => {
    expect(isStopMessage(body)).toBe(true);
  });

  it.each(NOT_OPT_OUTS)('does NOT treat %j as an opt-out', (body) => {
    expect(isStopMessage(body)).toBe(false);
  });

  /**
   * Asserted rather than left to fall out of the punctuation set, because it is
   * a DECISION and not an oversight: `.` and `!` end a statement, `?` makes the
   * same word a question ("stop?" — as in "stop what?"), and acting on a
   * question with an irreversible suppression is exactly the asymmetry this file
   * opens with.
   *
   * NOTHING IS LOST BY REFUSING IT. A body that does not match still produces an
   * `inbound_messages` row — recorded, attributed honestly, and visible to the
   * operator — so the outcome of this branch is "a human reads it", not "we
   * ignored them".
   */
  it('leaves an ambiguous "STOP?" to a human rather than acting on it', () => {
    expect(isStopMessage('STOP?')).toBe(false);
  });

  /**
   * The boundary hands us whatever the provider sent, and zod validates the
   * SHAPE of the payload rather than guaranteeing this function is never reached
   * with something odd. `false` is the right answer for a non-string: there is
   * no text here, so there is no opt-out to honour — and the caller still writes
   * the row.
   */
  it('answers false for a body that is not a string at all', () => {
    expect(isStopMessage(undefined as unknown as string)).toBe(false);
    expect(isStopMessage(null as unknown as string)).toBe(false);
  });
});
