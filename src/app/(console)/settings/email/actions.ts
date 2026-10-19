'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createDomain, isSendingDomainVerified, verifyDomain } from '@/core/messaging/resend-domains';
import { getChannelConfig, upsertChannelConfig } from '@/db/repository';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../_auth';
import {
  BLANK_EMAIL_SETTINGS_STATE,
  EMAIL_IDENTITY_LOCKED_MESSAGE,
  type EmailSettingsState,
} from './action-state';

export type { EmailSettingsState };

/**
 * THE THREE ACTIONS BELOW ARE THE ONLY EXPORTS OF THIS MODULE, and each one
 * re-checks the operator gate before it reads a byte of the body (WR-01,
 * T-4-24).
 *
 * Every export of a `'use server'` module is a globally-POSTable endpoint whose
 * id is reachable from any route, including ones `proxy.ts` never sees. Two of
 * these spend money at a third party and the third one writes the row that
 * decides whether this system sends email as a real business at all — none of
 * them may rely on the `(console)` layout, which renders after an action has
 * already finished, or on RLS, which `upsertChannelConfig` bypasses by design.
 *
 * Orchestration (reading the domain list, resolving tenant names, formatting)
 * stays in `page.tsx`, which is reachable only by rendering it.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A domain name, and deliberately a loose check.
 *
 * Resend is the authority on what it will accept; a strict regex here rejects a
 * valid domain with a message blaming the operator for the provider's rules —
 * the same argument `connectSchema` makes about ServiceM8 API keys. What this
 * catches is the mistake a tired human actually makes: pasting an email address
 * or a URL into the domain field.
 */
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, 'Enter the domain to send from, like quotes.example.com.au.')
  .max(253, 'That does not look like a domain name.')
  .refine((value) => !value.includes('@'), 'Enter the domain only — no @ and no address.')
  .refine((value) => !value.includes('/'), 'Enter the domain only — no https:// and no path.')
  .refine((value) => value.includes('.'), 'That does not look like a domain name.');

/**
 * The per-tenant (or global) email identity.
 *
 * `tenant_id` empty means the GLOBAL row — the deployment-wide default, the row
 * `buildRoutingSender` reads to decide whether email is switched on at all. An
 * empty string is the honest spelling of "no tenant" coming out of a `<select>`;
 * it is converted to `null` at the write, never stored.
 */
const configSchema = z.object({
  tenant_id: z.union([z.literal(''), z.uuid()]),
  from_address: z.union([z.literal(''), z.email('Enter a valid from-address.')]),
  reply_to: z.union([z.literal(''), z.email("Enter the tradie's own email address.")]),
  business_name: z.string().trim().max(120),
});

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function denial(access: 'unauthenticated' | 'forbidden'): EmailSettingsState {
  return { ...BLANK_EMAIL_SETTINGS_STATE, error: OPERATOR_DENIED_MESSAGE[access] };
}

/**
 * Register a client's sending domain (MSG-02).
 *
 * The DNS records come back on THIS response and are re-read on every page load
 * afterwards, so nothing is stored here — Resend is the record of what a domain
 * needs, and a copy in our database is a copy that goes stale the first time
 * they rotate a DKIM key.
 */
export async function addDomainAction(
  _previous: EmailSettingsState,
  formData: FormData,
): Promise<EmailSettingsState> {
  const access = await requireOperator();
  if (access !== 'ok') return denial(access);

  const parsed = domainSchema.safeParse(readString(formData, 'domain'));
  if (!parsed.success) {
    return {
      ...BLANK_EMAIL_SETTINGS_STATE,
      error: parsed.error.issues[0]?.message ?? 'That does not look like a domain name.',
    };
  }

  const result = await createDomain(parsed.data);
  if (!result.ok) {
    // The CODE to the log, a fixed sentence to the page. Resend's `reason` is
    // already classified — `validation_error`, `not_found`, `missing_api_key` —
    // and it is the operator's only diagnostic, so it is logged. It is not
    // rendered, because it is not a sentence and the page must not teach the
    // operator to read provider internals (WR-08).
    console.error(`[settings/email] domain create failed: ${result.reason}`);
    return {
      ...BLANK_EMAIL_SETTINGS_STATE,
      error: 'Could not add that domain. Check it is spelled correctly and try again.',
    };
  }

  revalidatePath('/settings/email');
  return {
    error: null,
    // Names the next action rather than announcing success: adding a domain
    // does nothing at all until the records exist in DNS, and an operator who
    // reads "Added" and closes the tab has a domain that will never verify.
    success: `${result.domain.name} added. Add the DNS records below at your DNS host, then press Check DNS.`,
  };
}

/**
 * Ask Resend to re-check a domain's DNS (MSG-02).
 *
 * Verification is ASYNCHRONOUS: a successful call means "we will look", not "it
 * is verified". The copy says so, and the status the operator reads afterwards
 * comes from re-reading the domain on the next render — never from this result.
 */
export async function verifyDomainAction(
  _previous: EmailSettingsState,
  formData: FormData,
): Promise<EmailSettingsState> {
  const access = await requireOperator();
  if (access !== 'ok') return denial(access);

  const id = readString(formData, 'domain_id');
  if (id === '' || id.length > 64) {
    return { ...BLANK_EMAIL_SETTINGS_STATE, error: 'That domain could not be found.' };
  }

  const result = await verifyDomain(id);
  if (!result.ok) {
    console.error(`[settings/email] domain verify failed: ${result.reason}`);
    return {
      ...BLANK_EMAIL_SETTINGS_STATE,
      error: 'Could not check that domain. Try again in a moment.',
    };
  }

  revalidatePath('/settings/email');
  return {
    error: null,
    success: 'Checking DNS. Refresh in a minute — propagation can take longer than the check.',
  };
}

/**
 * Write a tenant's (or the global) email sending IDENTITY — and only that
 * (MSG-02, D-01, D-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS ACTION CANNOT ARM OR DISARM ANYTHING. `enabled` is read from the    │
 * │ stored row and written back unchanged; `false` when there is no row yet. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THE CHECKBOX IS GONE (10-03, D-04, T-10-13) ─────────────────────────
 *
 * `enabled` is the switch that sends real messages to real customers, and D-04
 * requires every flip of it to leave an audit row naming the operator and the
 * reason. That is only TRUE if there is exactly one path that flips it:
 * `armChannel` / `disarmChannel`, which write the config row and its audit row
 * in one transaction, behind the go-live gate, from the client page. A second
 * path here — a checkbox on a settings form — would make "every arm is audited"
 * a sentence in a document rather than a property of the system.
 *
 * It is preserved rather than ignored in BOTH directions: writing `false` on an
 * identity edit would DISARM a live client with no audit row, which is the same
 * defect pointing the other way and worse, because nobody would notice until a
 * tradie asked why the follow-ups stopped.
 *
 * ── WHY IDENTITY COMPLETENESS IS NOT CHECKED HERE ANYMORE ───────────────────
 *
 * The three refusals this action used to make — no from-address, no reply-to, no
 * business name — belonged to enabling, and enabling has moved. They now live in
 * `armChannel` (src/db/repository/messaging-config.ts), which re-reads the row
 * inside the arming transaction and returns `no_identity` with the missing
 * field. That is the stronger place for them: it catches a row made complete by
 * one path and armed by another. Refusing here as well would block an operator
 * deliberately saving a half-built identity mid-onboarding, on a row that is
 * disabled and sends nothing.
 *
 * ── …AND THE ONE CASE WHERE THAT ARGUMENT DOES NOT HOLD (WR-01) ─────────────
 *
 * "On a row that is disabled and sends nothing" is the whole premise, and the
 * row may not be disabled. An ENABLED row whose from-address or reply-to is
 * saved empty is a client whose follow-ups stop on the next tick —
 * `resolveEmailIdentity` returns `null` without both — with no
 * `messaging_config_audit` row, no operator decision recorded, and the client
 * page still offering "Turn email off" because `enabled` is still true. That is
 * precisely the silent stop the preserved `enabled` exists to prevent, reached
 * through the identity fields instead of the flag, so those two fields are
 * refused while the stored row is on and the sentence names the disarm control.
 *
 * ── THE VERIFIED-DOMAIN CHECK IS SERVER-SIDE, AND SPELLED ONCE (T-4-26) ─────
 *
 * The form only offers verified domains. That is a convenience, not a control:
 * this action's id is global and the body is the caller's. Sending as an
 * unverified domain is not a cosmetic failure — mail without aligned SPF/DKIM is
 * rejected or spam-foldered by the receiving side, so the visible symptom is a
 * client's follow-ups silently not arriving, attributed to "email is unreliable"
 * rather than to a row somebody saved too early.
 *
 * `isSendingDomainVerified` is the ONE predicate, shared with the go-live
 * checklist. Two spellings is T-10-14's shape: the copy that treats a provider
 * outage as a pass saves an identity on a domain nobody has verified. The check
 * runs whenever a from-address is supplied at all — a row's only purpose is to
 * be armed later, and a rule with one state exempted is a rule somebody reasons
 * around.
 */
export async function saveEmailConfigAction(
  _previous: EmailSettingsState,
  formData: FormData,
): Promise<EmailSettingsState> {
  const access = await requireOperator();
  if (access !== 'ok') return denial(access);

  const parsed = configSchema.safeParse({
    tenant_id: readString(formData, 'tenant_id'),
    from_address: readString(formData, 'from_address').trim().toLowerCase(),
    reply_to: readString(formData, 'reply_to').trim().toLowerCase(),
    business_name: readString(formData, 'business_name'),
  });

  if (!parsed.success) {
    return {
      ...BLANK_EMAIL_SETTINGS_STATE,
      error: parsed.error.issues[0]?.message ?? 'Check the details and try again.',
    };
  }

  const { tenant_id, from_address, reply_to, business_name } = parsed.data;

  if (tenant_id !== '' && !UUID_PATTERN.test(tenant_id)) {
    return { ...BLANK_EMAIL_SETTINGS_STATE, error: 'That client could not be found.' };
  }

  if (from_address !== '') {
    const domain = await isSendingDomainVerified(from_address);

    if (domain.kind === 'invalid_address') {
      return { ...BLANK_EMAIL_SETTINGS_STATE, error: 'Enter a valid from-address.' };
    }

    if (domain.kind === 'unknown') {
      // A read failure is treated as REFUSAL, not as a pass. Every failure mode
      // here — key revoked, provider down, network gone — is a state in which
      // "let the write through" means saving an identity on a domain nobody has
      // verified, which the client page would then happily arm.
      console.error(`[settings/email] domain list failed: ${domain.reason}`);
      return {
        ...BLANK_EMAIL_SETTINGS_STATE,
        error: 'Could not check the domain right now. Nothing was saved — try again in a moment.',
      };
    }

    if (domain.kind === 'unverified') {
      return {
        ...BLANK_EMAIL_SETTINGS_STATE,
        error: `${domain.domain} is not verified yet. Add its DNS records and check DNS before sending from it.`,
      };
    }
  }

  const targetTenantId = tenant_id === '' ? null : tenant_id;

  // THE STORED `enabled`, READ BEFORE THE WRITE (D-04). A failure here is a
  // REFUSAL rather than a default: `false` on a driver blip would stop a live
  // client's follow-ups with no audit row and no operator involved, and nobody
  // would find out until the tradie asked.
  let stored: Awaited<ReturnType<typeof getChannelConfig>>;
  try {
    stored = await getChannelConfig('email', targetTenantId);
  } catch {
    // The caught value is discarded: a driver error carries the statement, and
    // this one's parameters are the client's own identity.
    console.error('[settings/email] stored config read failed');
    return {
      ...BLANK_EMAIL_SETTINGS_STATE,
      error: 'Could not read the current settings. Nothing was saved — try again in a moment.',
    };
  }

  // `getChannelConfig` reads OVERRIDE-THEN-DEFAULT, so a tenant with no row of
  // its own is answered with the GLOBAL row. Carrying that row's `enabled` onto
  // a new per-client row would arm a client nobody armed.
  const existing = stored !== null && stored.tenantId === targetTenantId ? stored : null;

  // AN ENABLED ROW MAY NOT HAVE ITS IDENTITY CLEARED HERE (WR-01). Preserving
  // `enabled` keeps the FLAG out of this form; without this, the FIELDS are a
  // way around it — `resolveEmailIdentity` refuses without both a from-address
  // and a reply-to, so an empty one against a live client is a silent,
  // unaudited stop reached through the identity instead of the switch. The
  // relaxed rule still holds for a disabled row, which sends nothing.
  if (existing?.enabled && (from_address === '' || reply_to === '')) {
    return { ...BLANK_EMAIL_SETTINGS_STATE, error: EMAIL_IDENTITY_LOCKED_MESSAGE };
  }

  await upsertChannelConfig({
    channel: 'email',
    tenantId: targetTenantId,
    // Empty strings become NULL: the upsert's SET clause is exhaustive over the
    // mutable columns precisely so clearing a field clears the column, and a
    // stored '' would be a from-address that passes `if (!from)` checks
    // everywhere it is read.
    fromAddress: from_address === '' ? null : from_address,
    replyTo: reply_to === '' ? null : reply_to,
    businessName: business_name === '' ? null : business_name,
    enabled: existing?.enabled ?? false,
  });

  revalidatePath('/settings/email');
  return {
    error: null,
    // NAMES THE NEXT ACTION rather than announcing that anything now sends —
    // saving an identity changes nothing about whether email goes out, and an
    // operator who reads "Saved." and closes the tab has a client whose
    // follow-ups are still waiting on a tap they never made.
    success: existing?.enabled
      ? targetTenantId === null
        ? 'Saved. Email stays on by default for every client.'
        : 'Saved. Email stays on for this client.'
      : "Saved. Arm email from the client's page (Ready to send?) once the checklist is green.",
  };
}
