/**
 * THE CLASSIFICATION, IN THE OPERATOR'S WORDS — AND PHRASED AS A GUESS (D-15).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY ONE OF THESE READS AS AN OPINION, NOT A FINDING. "Reads as an      │
 * │ opt-out", not "Opt-out". The difference is the whole of D-14 and D-15:   │
 * │ the label moved nothing, decided nothing and suppressed nobody — it      │
 * │ sorted this row and put a suggestion on it, and the human still reads    │
 * │ the message underneath.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A label that rendered as a verdict would teach an operator to act on the badge
 * instead of the reply, which is exactly the trust a prompt injection would be
 * spending.
 *
 * ── WHY THIS IS A MODULE AND NOT A CONST IN THE INBOX (06-06) ───────────────
 *
 * Three surfaces now show it: the inbox, the quote page's conversation thread,
 * and the pipeline's reply chip. 06-06 required the pipeline to reuse the inbox
 * phrasing "verbatim", and a second copy is verbatim exactly until somebody
 * softens one of them. A guess must stay phrased as a guess ON EVERY SURFACE —
 * that is a rule, not a style, so it is one array of words in one file rather
 * than a comment asking three files to agree.
 *
 * This is the same reason `components/action-state.ts` holds the approval copy
 * that two surfaces answer a double-tap with.
 *
 * A map, not a `.replace('_', ' ')` — the house rule. A member added to
 * `INBOUND_LABELS` or `LEAD_LABELS` later must fail loudly here rather than ship
 * as snake_case on the operator's phone — and since 13-REVIEW WR-03 a pure test
 * reads both vocabularies and fails on any member without an entry.
 *
 * ── A LEAF MODULE, DELIBERATELY ─────────────────────────────────────────────
 *
 * It imports NOTHING. Two of its three consumers are (or may become) client
 * components, and a value import from a module that reaches the repository is
 * the real edge that broke `next build` in 06-02. Typing the keys as `string`
 * rather than as `InboundLabel` is what keeps that true: the schema module is
 * where that union lives, and it imports drizzle.
 */
export const LABEL_GUESS_LABELS: Record<string, string> = {
  interested: 'reads as interested',
  question: 'reads as a question',
  objection: 'reads as an objection',
  not_interested: 'reads as not interested',
  opt_out: 'reads as an opt-out',
  other: 'reads as none of the above',
  // ── The LEAD vocabulary (Phase 13, D-05; 13-REVIEW WR-03) ────────────────
  // A missed caller's reply is labelled in `LEAD_LABELS`. `question`,
  // `opt_out` and `other` are shared with the quote vocabulary and read the
  // same; the seven below are the lead-only members. Every member of both
  // vocabularies is pinned to an entry here (tests/lead-labels.test.ts).
  new_enquiry: 'reads as a new enquiry',
  callback_request: 'reads as a call-back request',
  existing_job: 'reads as an existing customer',
  complaint: 'reads as a complaint',
  not_a_lead: 'reads as not a lead',
  already_sorted: 'reads as already sorted',
  spam: 'reads as spam',
};

/**
 * The model's URGENCY on a lead reply (D-05), phrased as a guess like the label.
 *
 * `unknown` has no entry ON PURPOSE: "the model could not tell" is not news on
 * a phone, and a chip saying so would sit on most rows. `emergency` is the one
 * that changes what the operator does next, which is why the inbox colours it.
 */
export const URGENCY_GUESS_LABELS: Record<string, string> = {
  emergency: 'sounds like an emergency',
  this_week: 'wants it this week',
  flexible: 'sounds flexible on timing',
};

/**
 * The guess for an urgency, or `null` when there is none to show: a quote reply
 * (NULL urgency), `unknown`, or nothing at all. An unrecognised member falls
 * through to the raw value, for `labelGuess`'s reason.
 */
export function urgencyGuess(urgency: string | null | undefined): string | null {
  if (!urgency || urgency === 'unknown') return null;
  return URGENCY_GUESS_LABELS[urgency] ?? urgency;
}

/**
 * The guess for a label, or `null` when there is no guess to show.
 *
 * `null` for an UNCLASSIFIED reply (the classifier has not run, or gave up) is
 * the honest answer and the caller renders no chip for it — an invented "not
 * classified" pill on a surface of one-word indicators reads as a finding about
 * the message rather than a fact about us.
 *
 * An unrecognised member falls through to the raw value rather than to `null`:
 * the row still says something, and what it says is visibly wrong, which is how
 * a missing map entry gets noticed at all.
 */
export function labelGuess(label: string | null | undefined): string | null {
  if (!label) return null;
  return LABEL_GUESS_LABELS[label] ?? label;
}
