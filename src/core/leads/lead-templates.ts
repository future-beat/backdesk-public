/**
 * The shipped default wording for a lead's touches 2 and 3 (Phase 13, D-02).
 *
 * WHAT THESE ARE: the MODEL'S INPUT. Each body is the approved template the
 * drafting prompt rewrites in the client's own voice for one missed caller —
 * the same role a quote template plays for a quote touch. They are seeded per
 * client as `message_templates` rows of kind 'lead', pre-approved, because the
 * operator approves every DRAFT made from them, one message at a time, in the
 * existing queue; the template itself is never what a caller receives.
 *
 * WHAT THEY ARE NOT: the compliance line. Sender identification and the STOP
 * opt-out are appended to every draft mechanically at draft time — the same
 * suffix a quote touch carries — so neither body names the business or says
 * how to opt out. Touch 1 (the text-back itself) is not here: it is the
 * client's ATTESTED wording, sent verbatim from `text_back_templates`, and the
 * client attested identity and STOP there once (D-02).
 *
 * The rules the bodies follow (12-RESEARCH "Templates"): question-led, plain
 * ASCII, no links, no digits, no month or weekday names, no price — so the
 * draft validator can only refuse a draft for something the MODEL added.
 * NEITHER touch says "yesterday" (13-REVIEW WR-04): touch 2 is placed at the
 * call's day + 1 ROLLED TO THE NEXT ALLOWED DAY, so a Friday caller hears it
 * on Monday and a caller before a public holiday later still; touch 3 goes two
 * or more days after the call. "Your recent call" is true on every day either
 * can send. The warmer existing-customer variant (D7) is not built.
 *
 * WHICH OF THOSE RULES ARE MECHANICAL (13-REVIEW WR-02), i.e. enforced on the
 * draft by `validateDraft` rather than only asked for in the prompt: digits
 * (Rule 1), capitalised month and weekday names (Rule 2), plain GSM-7 and at
 * most two segments (Rule 3), the compliance line at the end (Rule 4), and —
 * for lead drafts only, through `forbidLinks` — link-shaped text (Rule 5,
 * `LINK_PATTERN`, the text-back validator's own pattern). PROMPT-ONLY, with
 * the approver as the belt: question-led tone, a price written in words, and
 * relative day words ("yesterday", "today").
 *
 * No imports: the seed takes any repository that can `ensureLeadDefaults`, so
 * this file stays a leaf the tests and the drafting pass can both read.
 */

/** The default lead wording, by touch number. Touch 2 nudges; touch 3 is the last word. */
export const DEFAULT_LEAD_TEMPLATE_BODIES = {
  2: "Following up on your recent call. Still need a hand? Reply with the job and your suburb and we'll be in touch.",
  3: 'Last one from us. If you still need a hand with the job you rang about, reply here any time. Otherwise, no worries.',
} as const satisfies Record<number, string>;

/** `message_templates.approval_note` on a seeded default — says who approved it, and why. */
export const LEAD_TEMPLATE_APPROVAL_NOTE = 'Backdesk default lead wording (Phase 13, D-02)';

/** The one repository method the seed needs — structural, so no import. */
export interface LeadTemplateSeedRepository {
  templates: {
    ensureLeadDefaults(
      rows: readonly { touchNumber: number; body: string }[],
      note: string,
    ): Promise<readonly unknown[]>;
  };
}

/**
 * Seed this client's lead wording, idempotently (the repository's targeted
 * `ON CONFLICT DO NOTHING` decides). Returns how many rows were inserted — 0 on
 * every call after the first. Called as a belt by the drafting pass when the
 * client has no approved lead set; the arming-time seed is plan 13-05's.
 */
export async function seedLeadTemplateDefaults(repo: LeadTemplateSeedRepository): Promise<number> {
  const inserted = await repo.templates.ensureLeadDefaults(
    [
      { touchNumber: 2, body: DEFAULT_LEAD_TEMPLATE_BODIES[2] },
      { touchNumber: 3, body: DEFAULT_LEAD_TEMPLATE_BODIES[3] },
    ],
    LEAD_TEMPLATE_APPROVAL_NOTE,
  );
  return inserted.length;
}
