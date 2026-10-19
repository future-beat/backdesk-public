/**
 * Action state shapes + blank initial values for the email settings forms.
 *
 * OUTSIDE actions.ts because a `'use server'` module may export only async
 * functions — a const export is a module-evaluation error under Turbopack
 * (nextjs.org/docs/messages/invalid-use-server-value). Same split, same reason,
 * as `clients/[id]/action-state.ts` and `inbox/action-state.ts`.
 */

export type EmailSettingsState = {
  /** A fixed sentence the operator can act on. Never a provider message. */
  error: string | null;
  success: string | null;
};

export const BLANK_EMAIL_SETTINGS_STATE: EmailSettingsState = { error: null, success: null };

/**
 * CLEARING A LIVE CLIENT'S IDENTITY IS A DISARM, AND DISARMS ARE AUDITED (WR-01).
 *
 * This form saves identity only and preserves the stored `enabled` — which is
 * the right rule for the flag and the wrong one on its own for the fields.
 * `resolveEmailIdentity` needs BOTH a from-address and a reply-to before it will
 * return anything, so saving either as empty against an enabled row stops that
 * client's follow-ups just as completely as turning the switch off, except that
 * nothing appears in `messaging_config_audit`, the client page still offers
 * "Turn email off", and the first anyone hears of it is the tradie asking why
 * the chasing stopped.
 *
 * SO IT IS REFUSED, AND THE SENTENCE POINTS AT THE CONTROL THAT DOES AUDIT IT.
 * The rule binds only while the row is ENABLED: a half-built identity on a
 * disabled row sends nothing and is a real mid-onboarding state (the arming gate
 * is what refuses to arm it).
 *
 * `business_name` IS DELIBERATELY NOT IN THE LIST. It falls back to the tenant's
 * own name in `resolveEmailIdentity`, so clearing it is not by itself a stop —
 * and a rule that refuses a save which changes nothing is a rule operators learn
 * to route around.
 */
export const EMAIL_IDENTITY_LOCKED_MESSAGE =
  "Email is on for this client. Turn it off from the client's page (Ready to send?) before clearing its from-address or reply-to — stopping a client's email has to be audited.";
