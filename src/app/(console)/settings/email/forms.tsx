'use client';

import { useActionState } from 'react';

import { BLANK_EMAIL_SETTINGS_STATE, type EmailSettingsState } from './action-state';
import { addDomainAction, saveEmailConfigAction, verifyDomainAction } from './actions';

/**
 * The three controls of the email settings page.
 *
 * One file rather than three because they share the same state shape and the
 * same feedback block, and three files each holding four lines of JSX and one
 * hook is three places to fix the same copy.
 *
 * `useActionState` throughout, for the reason `NewClientForm` gives: a rejected
 * submission comes back with the operator's input intact instead of a redirect
 * that throws the form away. On this page that matters most for the config form
 * — the from-address, reply-to and business name are three fields nobody wants
 * to retype on a phone because a domain was not verified yet.
 */

function Feedback({ state }: { state: EmailSettingsState }) {
  return (
    <>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="muted" role="status">
          {state.success}
        </p>
      ) : null}
    </>
  );
}

export function AddDomainForm() {
  const [state, formAction, pending] = useActionState(addDomainAction, BLANK_EMAIL_SETTINGS_STATE);

  return (
    <form action={formAction}>
      <Feedback state={state} />

      <label htmlFor="domain">Sending domain</label>
      <input
        id="domain"
        name="domain"
        type="text"
        required
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={253}
        placeholder="quotes.example.com.au"
      />
      <p className="hint muted">
        A subdomain the client owns, or the service subdomain. Sending from their bare domain puts
        this system&rsquo;s reputation on the address they invoice from.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add domain'}
      </button>
    </form>
  );
}

export function VerifyDomainForm({ domainId }: { domainId: string }) {
  const [state, formAction, pending] = useActionState(
    verifyDomainAction,
    BLANK_EMAIL_SETTINGS_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="domain_id" value={domainId} />
      <Feedback state={state} />
      <button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Check DNS'}
      </button>
    </form>
  );
}

export interface TenantOption {
  id: string;
  name: string;
}

export interface VerifiedDomainOption {
  id: string;
  name: string;
}

/**
 * The enablement form.
 *
 * NOTHING IS PRE-TICKED and no client is pre-selected. Same discipline as the
 * quote triage checklist and the contact-hours fields: the operator states which
 * client, from what address, on whose behalf — or the form does not submit. A
 * pre-selected tenant on a form whose submit button turns real email on is one
 * mis-tap from sending as the wrong business.
 */
export function EmailConfigForm({
  tenants,
  verifiedDomains,
}: {
  tenants: readonly TenantOption[];
  verifiedDomains: readonly VerifiedDomainOption[];
}) {
  const [state, formAction, pending] = useActionState(
    saveEmailConfigAction,
    BLANK_EMAIL_SETTINGS_STATE,
  );

  return (
    <form action={formAction}>
      <Feedback state={state} />

      <label htmlFor="tenant_id">Client</label>
      <select id="tenant_id" name="tenant_id" defaultValue="">
        {/* The global row is an OPTION, not a separate form: it is the same row
            shape with no tenant, and giving it its own form would be a second
            writer of one decision. Its label says what enabling it does. */}
        <option value="">Every client (the default row)</option>
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>

      <label htmlFor="from_address">From address</label>
      <input
        id="from_address"
        name="from_address"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={
          verifiedDomains.length > 0
            ? `followups@${verifiedDomains[0].name}`
            : 'verify a domain first'
        }
      />
      <p className="hint muted">
        {verifiedDomains.length === 0
          ? 'No verified domains yet — add one above and check its DNS before switching email on.'
          : `Verified: ${verifiedDomains.map((domain) => domain.name).join(', ')}`}
      </p>

      <label htmlFor="reply_to">Reply-to (the tradie&rsquo;s own address)</label>
      <input
        id="reply_to"
        name="reply_to"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="dave@daveplumbing.com.au"
      />
      <p className="hint muted">
        Replies go straight to the tradie&rsquo;s inbox — this system never sees them, so a wrong
        address here is a customer saying yes to nobody.
      </p>

      <label htmlFor="business_name">Business name</label>
      <input id="business_name" name="business_name" type="text" maxLength={120} />
      <p className="hint muted">
        Shown in the message as the sender. The Spam Act requires the sender to be identified.
      </p>

      {/* ARMING IS NOT THIS FORM'S JOB (10-03, D-04). The checkbox that used to
          sit here flipped `messaging_config.enabled` with no audit row and no
          go-live gate — a second, unaudited path to sending real customer
          email. It now happens in one place, and this says where. */}
      <p className="hint muted">
        Arming email happens on the client&rsquo;s page (Ready to send?) once the checklist is
        green — saving here changes the identity only.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save email settings'}
      </button>
    </form>
  );
}
