'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { attestSm8AutomationOff } from '@/core/drafting/onboarding-gate';
import { firstUnmetGate } from '@/core/onboarding/arming';
import { readGoLiveChecklist } from '@/core/onboarding/checklist';
import { privacyCoversCallers } from '@/core/onboarding/privacy-coverage';
import { seedLeadTemplateDefaults } from '@/core/leads/lead-templates';
import { ESCALATION_PHONE_MESSAGE, escalationPhoneSchema } from '@/core/shared/tenant';
import { connectServiceM8, resumeConnection } from '@/core/sync/connect';
import { markChaseEligible } from '@/core/sync/eligibility';
import { bareAddress, getEmailStatus } from '@/core/messaging/resend-emails';
import { findDivertNumberCandidate, provisionDivertNumber } from '@/core/telephony/provision';
import { isWaGeographicNumber } from '@/core/telephony/twilio-client';
import {
  armChannel,
  disarmChannel,
  forAllTenants_armedBySmsGlobal,
  forTenant,
  getEscalationForTenant,
  getMissedCallForTenant,
  getTextBackEvidenceForTenant,
} from '@/db/repository';
import { MESSAGING_CHANNELS, TENANT_PROOF_KINDS } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

// THE DEPLOYED PRIVACY NOTICE — the very object `/privacy` renders. The
// text-back arm asks it whether callers are covered (D-09, D-11): a build
// whose notice lacks the callers section cannot arm anyone.
import { PRIVACY_COPY } from '@/app/(marketing)/copy';

// The operator allowlist read, KEEPING the user id: every arm and disarm writes
// an audit row whose `operator_user_id` is NOT NULL, and the only trustworthy
// source for it is the claim this function verified. The import path ends in
// `_auth` by rule (tests/operator-authorization.test.ts).
import { OPERATOR_DENIED_MESSAGE, requireOperatorId } from '../../_auth';

/**
 * Copy is verbatim from the 02-UI-SPEC Copywriting Contract. Kept as constants
 * rather than inline strings so the form and any future re-key surface cannot
 * drift into two slightly different apologies for the same failure.
 */
const REJECTED_MESSAGE =
  'ServiceM8 rejected this key. Check it was copied in full from Settings → API Keys and try again.';
const BUSY_MESSAGE =
  'ServiceM8 is busy right now. Wait a minute and try again — nothing was saved.';
const UNAVAILABLE_MESSAGE =
  'Could not reach ServiceM8. Nothing was saved — try again in a moment.';
const SHAPE_MESSAGE =
  'ServiceM8 returned data in an unexpected shape. Nothing was saved; this needs a developer.';

// State shapes + BLANK_* constants live in ./action-state — a 'use server'
// module may export only async functions (invalid-use-server-value).
import {
  AFTER_HOURS_ESCALATION_WRITE_FAILED_MESSAGE,
  afterHoursEscalationSavedMessage,
  ARM_ALREADY_MESSAGE,
  ARM_DOMAIN_UNKNOWN_MESSAGE,
  ARM_REASON_MAX,
  ARM_REFUSAL,
  ARM_TEXT_BACK_PER_CLIENT_MESSAGE,
  ARM_TEXT_BACK_PRIVACY_MESSAGE,
  ARM_WRITE_FAILED_MESSAGE,
  armedMessage,
  armNoIdentityMessage,
  ATTEST_NOTE_MAX,
  ATTEST_NOTE_REQUIRED_MESSAGE,
  ATTEST_NOTE_TOO_LONG_MESSAGE,
  ATTEST_WRITE_FAILED_MESSAGE,
  attestRecordedMessage,
  BLANK_AFTER_HOURS_ESCALATION_STATE,
  BLANK_ARM_STATE,
  BLANK_ATTEST_STATE,
  BLANK_CONNECT_STATE,
  BLANK_DIVERT_NUMBER_STATE,
  BLANK_ESCALATION_PHONE_STATE,
  DISARM_ALREADY_MESSAGE,
  BLANK_PROOF_STATE,
  DISARM_REASON_REQUIRED_MESSAGE,
  DISARM_WRITE_FAILED_MESSAGE,
  disarmedMessage,
  DIVERT_BUNDLE_UNATTACHED_MESSAGE,
  DIVERT_CONFIRM_MESSAGE,
  DIVERT_ORPHANED_MESSAGE,
  DIVERT_REFUSAL,
  DIVERT_SPOKEN_NAME_MESSAGE,
  DIVERT_SPOKEN_NAME_NO_NUMBER_MESSAGE,
  DIVERT_SPOKEN_NAME_SAVED_MESSAGE,
  DIVERT_WRITE_FAILED_MESSAGE,
  divertAdoptedMessage,
  divertAlreadyProvisionedMessage,
  divertCandidateMessage,
  divertLookupFailedMessage,
  divertOutcomeUnknownMessage,
  divertProvisionedMessage,
  divertPurchaseFailedMessage,
  divertSearchFailedMessage,
  ESCALATION_PHONE_MAX,
  ESCALATION_PHONE_WRITE_FAILED_MESSAGE,
  escalationPhoneSavedMessage,
  PROOF_ARTEFACT_NOT_MISSED_CALL_ID_MESSAGE,
  PROOF_ARTEFACT_NOT_RESEND_ID_MESSAGE,
  PROOF_ARTEFACT_NOT_UUID_MESSAGE,
  PROOF_ARTEFACT_REQUIRED_MESSAGE,
  PROOF_CHANNEL_NOT_ARMED_MESSAGE,
  PROOF_DIVERT_NOT_ACTIVE_MESSAGE,
  PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE,
  PROOF_EMAIL_STATUS_UNKNOWN_MESSAGE,
  PROOF_ESCALATION_NOT_FOUND_MESSAGE,
  PROOF_MISSED_CALL_MAX_AGE_MS,
  PROOF_MISSED_CALL_NO_CALLER_MESSAGE,
  PROOF_MISSED_CALL_NOT_FOUND_MESSAGE,
  PROOF_MISSED_CALL_NOT_THIS_NUMBER_MESSAGE,
  PROOF_MISSED_CALL_STALE_MESSAGE,
  PROOF_ARTEFACT_NOT_TEXT_BACK_ID_MESSAGE,
  PROOF_TEXT_BACK_LEDGER_NOT_SENT_MESSAGE,
  PROOF_TEXT_BACK_NOT_DELIVERED_MESSAGE,
  PROOF_TEXT_BACK_NOT_LEAD_MESSAGE,
  PROOF_TEXT_BACK_STALE_MESSAGE,
  proofTextBackNotSentMessage,
  PROOF_NOTE_MAX,
  PROOF_NOTE_REQUIRED_MESSAGE,
  PROOF_WRITE_FAILED_MESSAGE,
  proofEmailNotDeliveredMessage,
  proofEscalationNotSentMessage,
  proofMissedCallNotCompletedMessage,
  proofRecordedMessage,
  SPOKEN_NAME_MAX,
  SPOKEN_NAME_MAX_WORDS,
  type AfterHoursEscalationState,
  type ArmState,
  type AttestState,
  type ConnectState,
  type DivertNumberState,
  type EligibilityState,
  type EscalationPhoneState,
  type ProofState,
} from './action-state';

export type { ConnectState };

/**
 * NOTE WHAT IS NOT ECHOED BACK: the key itself.
 *
 * Every other form in this console returns the operator's input on failure so a
 * rejection does not cost them their typing. This one deliberately does not —
 * re-rendering the key would put a live credential into the server-rendered
 * HTML payload and the client-side router cache, which is precisely the
 * plaintext-exposure this phase's prohibition forbids (threat T-2-02). Pasting
 * a key again costs the operator one Cmd-V.
 */
const connectSchema = z.object({
  // Length only. ServiceM8 does not document a key format, and inventing a
  // regex here would reject a valid key with a message blaming the operator.
  api_key: z.string().trim().min(8, 'Paste the full API key — this looks too short.'),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Connect a client's ServiceM8 account (ONB-02).
 *
 * TWO CHECKS BEFORE ANY WORK, and they are different checks:
 *
 *  1. AUTHENTICATION (WR-01). Server Action IDs are global — this action can be
 *     invoked by POSTing its ID to any route, including one the proxy never
 *     sees — and the (console) layout's own gate runs only when a layout
 *     renders, which is after the action has finished.
 *  2. AUTHORIZATION, through an RLS-scoped read of the target tenant. This one
 *     matters more than usual here: `connectServiceM8` writes through the
 *     service-role repository path, which BYPASSES RLS by design. Without this
 *     check, any authenticated operator could attach a ServiceM8 account to any
 *     tenant uuid they could guess. The read below is deliberately made with
 *     the operator's own JWT so Postgres — not this file — decides whether they
 *     are a member.
 */
export async function connectServiceM8Action(
  tenantId: string,
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const denied = await authorize(tenantId);
  if (denied) return denied;

  const raw = formData.get('api_key');
  const parsed = connectSchema.safeParse({ api_key: typeof raw === 'string' ? raw : '' });
  if (!parsed.success) {
    return {
      ...BLANK_CONNECT_STATE,
      error: parsed.error.issues[0]?.message ?? REJECTED_MESSAGE,
    };
  }

  const result = await connectServiceM8(tenantId, parsed.data.api_key);

  if (!result.ok) {
    switch (result.kind) {
      case 'auth_failed':
        return { ...BLANK_CONNECT_STATE, error: REJECTED_MESSAGE };
      case 'rate_limited':
        return { ...BLANK_CONNECT_STATE, formError: BUSY_MESSAGE };
      case 'network_error':
      case 'server_error':
        return { ...BLANK_CONNECT_STATE, formError: UNAVAILABLE_MESSAGE };
      case 'parse_error':
        return { ...BLANK_CONNECT_STATE, formError: SHAPE_MESSAGE };
      case 'no_such_tenant':
        return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
    }
  }

  revalidatePath(`/clients/${tenantId}`);
  return {
    ...BLANK_CONNECT_STATE,
    success: `Connected. Pulled ${result.quotesWritten} job${
      result.quotesWritten === 1 ? '' : 's'
    } from the last 90 days.`,
  };
}

/**
 * The two authorization checks, factored out because `rekeyAction` needs
 * exactly the same pair and for exactly the same reasons.
 *
 * They are DIFFERENT checks and both are load-bearing — see the header of
 * `connectServiceM8Action`. Copying them would be the kind of duplication that
 * survives until one copy is updated.
 *
 * Returns `null` when the caller is cleared to proceed.
 */
async function authorize(tenantId: string): Promise<ConnectState | null> {
  if (!UUID_PATTERN.test(tenantId)) {
    return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return {
      ...BLANK_CONNECT_STATE,
      formError: 'Your session has expired. Sign in again.',
    };
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  }

  return null;
}

/**
 * Replace a dead ServiceM8 key and resume the client's sync (D-08).
 *
 * SAME AUTHORIZATION SHAPE AS CONNECT, and it matters more here, not less: this
 * action is reachable by POSTing its global Server Action ID from anywhere, it
 * accepts a live credential, and `resumeConnection` writes through the
 * service-role repository path, which bypasses RLS. Without the membership read
 * below, any authenticated operator could re-key any client they could guess
 * the uuid of.
 *
 * NOTE WHAT SUCCESS DOES NOT DEPEND ON. The immediate sync that `resume`
 * triggers may fail — a 429 a second after a key verified cleanly is weather —
 * and that is still a successful re-key. Reporting it as a failure would send
 * the operator hunting for a third key that does not exist.
 */
export async function rekeyAction(
  tenantId: string,
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const denied = await authorize(tenantId);
  if (denied) return denied;

  const raw = formData.get('api_key');
  const parsed = connectSchema.safeParse({ api_key: typeof raw === 'string' ? raw : '' });
  if (!parsed.success) {
    return {
      ...BLANK_CONNECT_STATE,
      error: parsed.error.issues[0]?.message ?? REJECTED_MESSAGE,
    };
  }

  const result = await resumeConnection(tenantId, parsed.data.api_key);

  if (!result.ok) {
    switch (result.kind) {
      case 'auth_failed':
        // The one failure that belongs on the FIELD rather than the form: the
        // operator can fix it by pasting a different value into that input.
        return { ...BLANK_CONNECT_STATE, error: REJECTED_MESSAGE };
      case 'rate_limited':
        return { ...BLANK_CONNECT_STATE, formError: BUSY_MESSAGE };
      case 'network_error':
      case 'server_error':
        return { ...BLANK_CONNECT_STATE, formError: UNAVAILABLE_MESSAGE };
      case 'parse_error':
        return { ...BLANK_CONNECT_STATE, formError: SHAPE_MESSAGE };
      case 'no_such_tenant':
        return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
      case 'not_connected':
        return {
          ...BLANK_CONNECT_STATE,
          formError: 'This client has no ServiceM8 connection yet. Connect one first.',
        };
    }
  }

  revalidatePath(`/clients/${tenantId}`);
  return {
    ...BLANK_CONNECT_STATE,
    success:
      result.syncOutcome === 'ok'
        ? 'Key replaced and sync resumed.'
        : // Honest about the half that did not land. The pause IS cleared, so
          // the banner is gone and the next tick retries — saying "resumed"
          // flatly would make the next five minutes of stale data confusing.
          'Key replaced. Sync resumed — the first cycle did not complete; the next one runs within 5 minutes.',
  };
}

/* ------------------------------------------------------------------------- *
 * Triage (D-15)
 * ------------------------------------------------------------------------- */

export type { EligibilityState };

/**
 * The submitted selection. UUIDs, and nothing that is not a uuid.
 *
 * This is not politeness about input shape: `markChaseEligible` puts these
 * values into a parameterised `IN` list, and a non-uuid reaches Postgres as a
 * `22P02` thrown from three layers below a form the operator is looking at.
 * Rejecting here means the failure is named where it happened.
 *
 * `.max()` bounds a forged POST: the form itself can only ever submit the rows
 * on screen, but the action ID is global and the body is the attacker's.
 */
const eligibilitySchema = z.object({
  quote_ids: z.array(z.uuid()).min(1).max(1000),
});

/**
 * Mark backfilled quotes as chase-eligible (SYNC-02, D-15).
 *
 * THE MOST CONSEQUENTIAL ACTION IN THE CONSOLE, and the least obviously so. It
 * does not spend money, delete anything, or change a credential — it writes
 * `quote_opened` events, and every one of those is a real SMS to a real
 * customer of a real tradie whose brand is on it.
 *
 * Which is why the authorization here is the same shape as the re-key action's
 * and runs for the same reason (WR-01, T-2-13): Server Action IDs are global,
 * so this is POST-able from any route by anyone with a session, and
 * `markChaseEligible` writes through the service-role repository path, which
 * bypasses RLS. Without the membership read inside `authorize`, an
 * authenticated operator could start a cadence on a client they are not on.
 *
 * The tenant closure inside `markChaseEligible` is the second layer: even a
 * forged body naming another client's quote ids flips nothing, because the
 * UPDATE's `tenant_id` predicate comes from this call's argument and not from
 * the request.
 */
export async function saveEligibilityAction(
  tenantId: string,
  _previous: EligibilityState,
  formData: FormData,
): Promise<EligibilityState> {
  // BEFORE the body is read, deliberately. There is nothing in `formData` worth
  // parsing for a caller who is not entitled to this client.
  const denied = await authorize(tenantId);
  if (denied) {
    return { error: denied.formError ?? 'Unknown client.', success: null };
  }

  const parsed = eligibilitySchema.safeParse({
    quote_ids: formData.getAll('quote_ids').map((value) => String(value)),
  });

  if (!parsed.success) {
    return {
      error: 'Tick at least one quote to mark it for follow-up.',
      success: null,
    };
  }

  const result = await markChaseEligible(tenantId, parsed.data.quote_ids);

  revalidatePath(`/clients/${tenantId}`);

  if (result.flipped === 0) {
    // Not an error: a re-submitted form, or a second operator who saved the
    // same list first. Saying "saved" would imply work that did not happen.
    return {
      error: null,
      success: 'Nothing changed — those quotes were already marked for follow-up.',
    };
  }

  return {
    error: null,
    success: `${result.flipped} quote${result.flipped === 1 ? '' : 's'} marked for follow-up.`,
  };
}

/* ------------------------------------------------------------------------- *
 * The escalation number (CON-03)
 * ------------------------------------------------------------------------- */

export type { EscalationPhoneState };

/**
 * Set or change the number the escalation pass texts (CON-03, D-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE WRITE IS ONE NAMED COLUMN. `forTenant(id).tenant.update({           │
 * │ escalationPhone })` sets `escalation_phone` and nothing else — it does   │
 * │ not read the row first and it does not write back the fields it read.    │
 * │ A settings save that rewrote its row siblings would silently revert a    │
 * │ contact-hours change made in another tab (the 05-05 named-conflict-set   │
 * │ discipline), and the columns beside this one are the DNCR window every   │
 * │ send obeys.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * TWO CHECKS BEFORE A BYTE OF `formData` IS READ (WR-01, T-6-22). Server Action
 * ids are global, so this is POST-able from any route by anyone with a session,
 * and the repository write bypasses RLS by design. Without the membership read
 * inside `authorize`, an authenticated operator could redirect another client's
 * hot-lead alerts to a phone of their choosing — which is the one write in this
 * console whose success is a text message to an attacker's handset carrying a
 * customer's name and number.
 *
 * AN INVALID NUMBER IS REFUSED, NEVER REPAIRED. See the schema's header: a
 * mobile missing its leading zero comes back as an error the operator fixes, not
 * as a zero we added for them.
 */
export async function updateEscalationPhoneAction(
  tenantId: string,
  _previous: EscalationPhoneState,
  formData: FormData,
): Promise<EscalationPhoneState> {
  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_ESCALATION_PHONE_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const raw = formData.get('escalation_phone');
  const submitted = typeof raw === 'string' ? raw : '';

  // A bound on a FORGED body, not on a person's typing: eleven digits plus the
  // separators anyone actually types is nowhere near this, and the action id is
  // global. Checked before the schema so an enormous string is refused rather
  // than regex-matched.
  if (submitted.length > ESCALATION_PHONE_MAX) {
    return { ...BLANK_ESCALATION_PHONE_STATE, error: ESCALATION_PHONE_MESSAGE };
  }

  // THE SAME SCHEMA OBJECT `tenantCreateSchema` VALIDATES THIS COLUMN WITH —
  // imported, not re-spelled. A second AU-mobile pattern on the field that
  // decides which handset receives a hot lead is the CR-01 defect at its worst:
  // two spellings agree until one is loosened, and the loosened one is the one
  // that texts a stranger.
  const parsed = escalationPhoneSchema.safeParse(submitted);

  if (!parsed.success) {
    return {
      ...BLANK_ESCALATION_PHONE_STATE,
      error: parsed.error.issues[0]?.message ?? ESCALATION_PHONE_MESSAGE,
    };
  }

  const phone = parsed.data;

  // The named-column update. `escalationPhone` is the only key in the patch, and
  // `forTenant().tenant.update()` refuses any key that is not a column — so a
  // typo here is an error rather than a write that looks applied and is not.
  //
  // THAT REFUSAL IS A THROW, AND SO IS EVERY DRIVER ERROR (WR-08). This action
  // returns a state whose whole purpose is a fixed sentence; letting either
  // escape produced Next's generic error page with a digest instead.
  try {
    await forTenant(tenantId).tenant.update({ escalationPhone: phone });
  } catch {
    // The caught value is DISCARDED (T-5-03/WR-08): a postgres error from this
    // statement carries the statement, and the parameter is the tradie's own
    // mobile number.
    console.error('[clients] escalation phone write failed');
    return {
      ...BLANK_ESCALATION_PHONE_STATE,
      error: ESCALATION_PHONE_WRITE_FAILED_MESSAGE,
    };
  }

  revalidatePath(`/clients/${tenantId}`);

  return {
    ...BLANK_ESCALATION_PHONE_STATE,
    success: escalationPhoneSavedMessage(phone),
  };
}

/* ------------------------------------------------------------------------- *
 * The after-hours escalation switch (Phase 13, D-09)
 * ------------------------------------------------------------------------- */

export type { AfterHoursEscalationState };

/**
 * A checkbox posts `on` when ticked and nothing at all when not. The boolean is
 * derived from that one comparison and then put through zod anyway — the action
 * id is global, and the schema is the record of what this write admits.
 */
const afterHoursEscalationSchema = z.boolean();

/**
 * SHOULD A HOT LEAD AT NIGHT TEXT THE TRADIE NOW, OR AT OPENING? (D-09)
 *
 * `tenants.after_hours_escalation`, default OFF: a hot lead reply that arrives
 * outside the client's contact hours is held until the window opens. ON sends
 * it at once. Emergencies and URGENT replies are sent at once whichever way it
 * is set — that rule lives in the escalation pass, not here.
 *
 * THE ESCALATION-NUMBER ACTION'S GUARD ORDER, EXACTLY (WR-01, T-13-12):
 * `authorize(tenantId)` before a byte of `formData` is read. The action id is
 * global and the write bypasses RLS; without the membership read an
 * authenticated operator could decide whether another client's tradie is woken
 * at 2 am.
 *
 * A ONE-COLUMN PATCH. It does not read the row and does not write back anything
 * it read — the columns beside this one are the DNCR window every send obeys
 * (the 05-05 named-conflict-set discipline). `tenant.update` refuses any key
 * that is not a column, so a typo is an error, not a write that looks applied.
 */
export async function updateAfterHoursEscalationAction(
  tenantId: string,
  _previous: AfterHoursEscalationState,
  formData: FormData,
): Promise<AfterHoursEscalationState> {
  const denied = await authorize(tenantId);
  if (denied) {
    return {
      ...BLANK_AFTER_HOURS_ESCALATION_STATE,
      error: denied.formError ?? 'Unknown client.',
    };
  }

  const parsed = afterHoursEscalationSchema.safeParse(
    formData.get('after_hours_escalation') === 'on',
  );
  if (!parsed.success) {
    return {
      ...BLANK_AFTER_HOURS_ESCALATION_STATE,
      error: AFTER_HOURS_ESCALATION_WRITE_FAILED_MESSAGE,
    };
  }

  const afterHoursEscalation = parsed.data;

  try {
    await forTenant(tenantId).tenant.update({ afterHoursEscalation });
  } catch {
    // The caught value is DISCARDED (T-5-03/WR-08): a driver error carries the
    // statement and its parameters.
    console.error('[clients] after-hours escalation write failed');
    return {
      ...BLANK_AFTER_HOURS_ESCALATION_STATE,
      error: AFTER_HOURS_ESCALATION_WRITE_FAILED_MESSAGE,
    };
  }

  revalidatePath(`/clients/${tenantId}`);

  return {
    ...BLANK_AFTER_HOURS_ESCALATION_STATE,
    success: afterHoursEscalationSavedMessage(afterHoursEscalation),
  };
}

/* ------------------------------------------------------------------------- *
 * The ONB-04 attestation (D-14/D-16)
 * ------------------------------------------------------------------------- */

export type { AttestState };

/**
 * The evidence note. REQUIRED, BOUNDED, AND NEVER DEFAULTED.
 *
 * `.trim().min(1)` rather than `.min(1)`, because a textarea holding one space
 * is what a hurried operator submits when a form asks them to type something
 * they have not done. That is the exact submission this column exists to
 * refuse (T-5-12): a checkbox records that somebody clicked, a sentence records
 * that somebody looked.
 *
 * `.max()` bounds a FORGED post as much as a rambling one — the action id is
 * global and the body is the attacker's (T-6-15).
 */
const attestSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, ATTEST_NOTE_REQUIRED_MESSAGE)
    .max(ATTEST_NOTE_MAX, ATTEST_NOTE_TOO_LONG_MESSAGE),
});

/**
 * Record that ServiceM8's own Quote Follow Up is off for this client — one of
 * the two keys that starts real messaging (ONB-04, D-14).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS ACTION CAN OPEN THE ACTIVATION GATE. It is as consequential as the  │
 * │ template approval and the eligibility flip, and it is authorized the     │
 * │ same way and for the same reasons.                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * TWO CHECKS BEFORE A BYTE OF `formData` IS READ (WR-01, T-6-15). Server Action
 * IDs are global, so this is POST-able from any route by anyone with a session,
 * and `attestSm8AutomationOff` writes through the service-role repository path,
 * which bypasses RLS. Without the membership read inside `authorize`, an
 * authenticated operator could arm a client they are not on. There is nothing
 * in the body worth parsing for a caller who is not entitled to this client.
 *
 * NO BUSINESS RULE LIVES HERE. The core owns all of it: the append-only INSERT,
 * the server-set `attested_at`, the in-transaction ask of the composed
 * predicate, the reason-scoped resume and the re-window over exactly the ids
 * the resume RETURNED. This action authorizes, validates one field, and turns
 * one result into one sentence.
 *
 * THERE IS NO FAILURE ARM TO MAP. An attestation recorded while the templates
 * are still unapproved is a SUCCESS that resumed nothing — the operator did
 * exactly what was asked and the other condition is still open, which the
 * sentence says out loud.
 */
export async function attestSm8AutomationOffAction(
  tenantId: string,
  _previous: AttestState,
  formData: FormData,
): Promise<AttestState> {
  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_ATTEST_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const raw = formData.get('note');
  const parsed = attestSchema.safeParse({ note: typeof raw === 'string' ? raw : '' });
  if (!parsed.success) {
    return {
      ...BLANK_ATTEST_STATE,
      error: parsed.error.issues[0]?.message ?? ATTEST_NOTE_REQUIRED_MESSAGE,
    };
  }

  // THERE IS NO FAILURE ARM TO MAP, BUT THERE IS A THROW TO CATCH (WR-08).
  // `attestSm8AutomationOff` throws explicitly and runs a transaction, so a
  // failure writes nothing — and left unguarded it took the operator to an
  // error digest from the card that opens the activation gate.
  let result: Awaited<ReturnType<typeof attestSm8AutomationOff>>;
  try {
    result = await attestSm8AutomationOff(tenantId, parsed.data.note, new Date());
  } catch {
    // The caught value is DISCARDED: the statement's parameters include the
    // operator's own evidence note about this client.
    console.error('[clients] attestation write failed');
    return { ...BLANK_ATTEST_STATE, error: ATTEST_WRITE_FAILED_MESSAGE };
  }

  revalidatePath(`/clients/${tenantId}`);

  return {
    ...BLANK_ATTEST_STATE,
    success: attestRecordedMessage({
      templatesApproved: result.conditions.templatesApproved,
      cadencesResumed: result.cadencesResumed,
    }),
  };
}

/* ------------------------------------------------------------------------- *
 * ARMING (ARM-02, D-03/D-04/D-05) — turning real customer messaging on
 * ------------------------------------------------------------------------- */

export type { ArmState };

/**
 * `target` is meaningful for SMS ALONE.
 *
 * SMS in v1 sends every client from ONE shared number, so "arm SMS" has two
 * possible meanings and they differ by the number of businesses affected:
 * `everyone` writes the shared row (tenant_id NULL), `client` lifts this
 * client's own OFF override. Email always targets this client's own row —
 * there is no shared email identity to arm.
 */
const armSchema = z.object({
  // All three since 12-08 — `text_back` behind the per-client refusal and the
  // privacy predicate below.
  channel: z.enum(MESSAGING_CHANNELS),
  target: z.enum(['everyone', 'client']),
  reason: z.string().trim().max(ARM_REASON_MAX).optional(),
});

const disarmSchema = z.object({
  channel: z.enum(MESSAGING_CHANNELS),
  scope: z.enum(['everyone', 'client']),
  // REQUIRED on a disarm, at the boundary as well as in the CHECK constraint:
  // the sentence typed here is the only account anybody will ever have of why
  // sending stopped.
  reason: z
    .string()
    .trim()
    .min(1, DISARM_REASON_REQUIRED_MESSAGE)
    .max(ARM_REASON_MAX, 'Keep the reason under 500 characters.'),
});

/**
 * TURN REAL CUSTOMER MESSAGING ON for this client — or, for SMS, for every
 * connected client on the shared number (ARM-02, D-03).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE HIGHEST-CONSEQUENCE ACTION IN THE PRODUCT. One POST and the next     │
 * │ tick sends real messages to real customers from a real number, with no   │
 * │ deploy in between and no way to recall a message that has left.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THREE CHECKS BEFORE A BYTE OF `formData` IS READ, and each is a different one:
 *
 *  1. OPERATOR (`requireOperatorId`) — a Server Action id is global, so this is
 *     POSTable from any route by anyone with a session, and the write goes
 *     through the service-role repository where RLS is inert by design. It also
 *     yields the user id the audit row records; a form field would be the
 *     caller's, which here means the attacker's.
 *  2. MEMBERSHIP (`authorize`) — the tenant read through the operator's own JWT,
 *     so an operator cannot arm a client they are not on.
 *  3. THE GATE (`firstUnmetGate`) — server-side, on the same checklist the card
 *     renders (D-05). Nothing is written on a refusal.
 *
 * THE GATE IS EVALUATED AGAINST THIS CLIENT even when the write is the shared
 * row: the shared row belongs to nobody and has no checklist of its own, and
 * the client the operator is arming FOR is the one whose readiness matters.
 * The blast radius is stated in the card's confirm warning and repeated in the
 * success sentence.
 *
 * ── TEXT-BACK (Phase 12, 12-08, D-09/D-11) ──────────────────────────────────
 *
 * Two more refusals, both BEFORE the checklist is read: a `text_back` request
 * aimed at `everyone` (there is no shared text-back row — the repository and
 * the CHECK refuse it as well), and a deployed privacy notice that does not
 * cover callers (`privacyCoversCallers` on the copy `/privacy` renders). Then
 * the same gate, `firstUnmetGate('text_back')`, on a fresh server-side read.
 */
export async function armChannelAction(
  tenantId: string,
  _previous: ArmState,
  formData: FormData,
): Promise<ArmState> {
  const operator = await requireOperatorId();
  if (!operator.ok) {
    return { ...BLANK_ARM_STATE, error: OPERATOR_DENIED_MESSAGE[operator.reason] };
  }

  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_ARM_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const parsed = armSchema.safeParse({
    channel: formData.get('channel'),
    target: formData.get('target'),
    reason: typeof formData.get('reason') === 'string' ? formData.get('reason') : undefined,
  });
  if (!parsed.success) {
    return { ...BLANK_ARM_STATE, error: 'That control posted something unexpected — reload the page.' };
  }

  const { channel, target } = parsed.data;

  if (channel === 'text_back') {
    // ONE CLIENT AT A TIME (D-09). Refused before any read: there is no shared
    // text-back row, and nothing on the card posts this.
    if (target === 'everyone') {
      return { ...BLANK_ARM_STATE, error: ARM_TEXT_BACK_PER_CLIENT_MESSAGE };
    }

    // THE DEPLOYED NOTICE DECIDES (D-11, research rule 5): no caller is texted
    // before the privacy notice tells them what was captured and who processes
    // it. Asked of the copy this build serves at /privacy, not of a flag.
    if (!privacyCoversCallers(PRIVACY_COPY.sections)) {
      return { ...BLANK_ARM_STATE, error: ARM_TEXT_BACK_PRIVACY_MESSAGE };
    }
  }

  // THE SAME DERIVATION THE CARD RENDERS, re-read here rather than trusted from
  // the browser: the page the operator is looking at may be minutes old, and
  // "templates approved" can have been un-done since it rendered.
  let checklist: Awaited<ReturnType<typeof readGoLiveChecklist>>;
  try {
    checklist = await readGoLiveChecklist(tenantId, new Date());
  } catch {
    // A checklist that cannot be read is not a checklist that passed.
    console.error('[clients] arm gate read failed');
    return { ...BLANK_ARM_STATE, error: ARM_WRITE_FAILED_MESSAGE };
  }

  const unmet = firstUnmetGate(channel, checklist.items);
  if (unmet) {
    // A FAILED DOMAIN READ IS ITS OWN REFUSAL (Pitfall 5): "not verified yet"
    // would send the operator to fix a domain that is fine.
    const refusal =
      unmet === 'sendingDomainVerified' && checklist.arming.email.domain === 'unknown'
        ? ARM_DOMAIN_UNKNOWN_MESSAGE
        : ARM_REFUSAL[unmet];
    return { ...BLANK_ARM_STATE, error: refusal };
  }

  let result: Awaited<ReturnType<typeof armChannel>>;
  try {
    result = await armChannel({
      channel,
      // ONLY SMS HAS A SHARED ROW, and `everyone` is it. Email and text-back
      // always target this client's own row (text-back `everyone` was refused
      // above; the repository would refuse it again as `per_tenant_only`).
      tenantId: channel === 'sms' && target === 'everyone' ? null : tenantId,
      operatorUserId: operator.userId,
      reason: parsed.data.reason,
    });
  } catch {
    // The caught value is DISCARDED: a postgres error from this statement
    // carries the statement, and its parameters include the operator's reason.
    console.error('[clients] arm write failed');
    return { ...BLANK_ARM_STATE, error: ARM_WRITE_FAILED_MESSAGE };
  }

  if (result.kind === 'per_tenant_only') {
    return { ...BLANK_ARM_STATE, error: ARM_TEXT_BACK_PER_CLIENT_MESSAGE };
  }

  if (result.kind === 'no_identity') {
    return { ...BLANK_ARM_STATE, error: armNoIdentityMessage(channel, result.missing) };
  }

  if (result.kind === 'already_armed') {
    return { ...BLANK_ARM_STATE, error: ARM_ALREADY_MESSAGE[channel] };
  }

  // THE LEAD WORDING EXISTS FROM THE MOMENT TEXT-BACK IS ON (Phase 13, D-02 "at
  // arming"). Touches 2 and 3 of every lead are drafted from these two rows; the
  // seed is idempotent (`ON CONFLICT DO NOTHING`), so a re-arm inserts nothing.
  //
  // ITS OWN TRY, AFTER THE ARM RESULT (T-13-18): the row is armed, and a default
  // wording that could not be written must not unsay that. The drafting pass
  // seeds again at first use, so a failure here costs nothing but this log line.
  if (channel === 'text_back') {
    try {
      await seedLeadTemplateDefaults(forTenant(tenantId));
    } catch {
      // The caught value is DISCARDED: a driver error carries the statement.
      console.error('[clients] lead template seed failed after arming');
    }
  }

  revalidatePath(`/clients/${tenantId}`);

  // THE RECEIPT NAMES WHO WAS ARMED, FROM A FRESH READ AFTER THE WRITE (D-03,
  // T-10-12). Only the shared row has a blast radius to state — a per-client arm
  // touches nobody else — so the crossing is not made for the other targets.
  //
  // A FAILED READ NEVER UNSAYS THE ARMING. The row is armed; this is the
  // sentence describing it. `null` drops the clause rather than claiming
  // "nobody", which is what an empty array would have said.
  let armedClients: Awaited<ReturnType<typeof forAllTenants_armedBySmsGlobal>> | null = null;
  if (channel === 'sms' && target === 'everyone') {
    try {
      armedClients = await forAllTenants_armedBySmsGlobal();
    } catch {
      console.error('[clients] blast-radius read failed after arming');
    }
  }

  return { ...BLANK_ARM_STATE, success: armedMessage(channel, target, armedClients) };
}

/**
 * TURN IT OFF — and say why (D-04, D-05).
 *
 * NO CHECKLIST READ, AND THAT IS THE RULE RATHER THAN AN OMISSION: every gate
 * on the arming path exists to stop sending STARTING. None of them may stand
 * between an operator and stopping it, and a gate that could refuse a disarm
 * would do so at exactly the moment somebody is trying to stop messages going
 * to real customers.
 *
 * The operator and membership checks stay, for the reason they always do: the
 * action id is global and the write bypasses RLS. Turning off a client you are
 * not on is still not yours to do.
 */
export async function disarmChannelAction(
  tenantId: string,
  _previous: ArmState,
  formData: FormData,
): Promise<ArmState> {
  const operator = await requireOperatorId();
  if (!operator.ok) {
    return { ...BLANK_ARM_STATE, error: OPERATOR_DENIED_MESSAGE[operator.reason] };
  }

  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_ARM_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const parsed = disarmSchema.safeParse({
    channel: formData.get('channel'),
    scope: formData.get('scope'),
    reason: typeof formData.get('reason') === 'string' ? formData.get('reason') : '',
  });
  if (!parsed.success) {
    return {
      ...BLANK_ARM_STATE,
      error: parsed.error.issues[0]?.message ?? DISARM_REASON_REQUIRED_MESSAGE,
    };
  }

  const { channel, scope, reason } = parsed.data;

  // ONE CLIENT AT A TIME, in this direction too (D-09): there is no shared
  // text-back row to turn off. Not a gate — a request that names a row which
  // cannot exist — so it is refused before any write.
  if (channel === 'text_back' && scope === 'everyone') {
    return { ...BLANK_ARM_STATE, error: ARM_TEXT_BACK_PER_CLIENT_MESSAGE };
  }

  let result: Awaited<ReturnType<typeof disarmChannel>>;
  try {
    result = await disarmChannel({
      channel,
      // Only SMS has a shared row (the `target` rule of the arm action).
      tenantId: channel === 'sms' && scope === 'everyone' ? null : tenantId,
      operatorUserId: operator.userId,
      reason,
    });
  } catch {
    console.error('[clients] disarm write failed');
    return { ...BLANK_ARM_STATE, error: DISARM_WRITE_FAILED_MESSAGE };
  }

  if (result.kind === 'reason_required') {
    return { ...BLANK_ARM_STATE, error: DISARM_REASON_REQUIRED_MESSAGE };
  }

  if (result.kind === 'per_tenant_only') {
    return { ...BLANK_ARM_STATE, error: ARM_TEXT_BACK_PER_CLIENT_MESSAGE };
  }

  if (result.kind === 'already_disarmed') {
    return { ...BLANK_ARM_STATE, error: DISARM_ALREADY_MESSAGE[channel] };
  }

  revalidatePath(`/clients/${tenantId}`);

  return { ...BLANK_ARM_STATE, success: disarmedMessage(channel, scope) };
}

/**
 * THE KINDS THIS ACTION CAN VERIFY — each one listed here has a verification
 * arm below. Spelled out rather than imported as `TENANT_PROOF_KINDS`, so a
 * kind a future migration adds to the table is REFUSED at this boundary until
 * somebody writes the arm that re-checks its artefact: a proof nobody's code
 * re-checked is exactly what this action exists to prevent. The third kind
 * (the verification call, CAP-05) arrived with the divert console in 11-05;
 * the fourth (a delivered text-back, D-13) with the text-back arming in 12-08.
 */
const ACTION_PROOF_KINDS = [
  'escalation_handset_proof',
  'email_pipe_proof',
  'divert_verification_call',
  'text_back_proof',
] as const satisfies readonly (typeof TENANT_PROOF_KINDS)[number][];

const proofSchema = z.object({
  kind: z.enum(ACTION_PROOF_KINDS),
  // THE LENGTH FLOOR IS THE COLUMN'S (8..128), restated at the boundary so a
  // placeholder is refused with a sentence rather than a constraint violation.
  artefact_id: z
    .string()
    .trim()
    .min(8, PROOF_ARTEFACT_REQUIRED_MESSAGE)
    .max(128, PROOF_ARTEFACT_REQUIRED_MESSAGE),
  note: z
    .string()
    .trim()
    .min(1, PROOF_NOTE_REQUIRED_MESSAGE)
    .max(PROOF_NOTE_MAX, 'Keep it under 500 characters — it records what you saw.'),
});

/**
 * THE SHAPE OF A RESEND EMAIL ID (WR-03), and deliberately the SCRIPT'S pattern.
 *
 * `scripts/resend-email-status.mjs` already validates with exactly this regex,
 * and the two readers of the same paste must not disagree about what they will
 * accept — an id the runbook script takes and this form refuses is a mid-go-live
 * dead end with a tradie waiting.
 *
 * Loose on purpose: Resend ids are uuids, but a strict uuid test would make this
 * form fail the day the provider changes its id format, on a field whose only
 * job is to be handed straight back to that provider. What it has to catch is
 * the paste that is not an id at all, before it becomes part of a URL.
 */
const RESEND_ID_PATTERN = /^[0-9a-f-]{20,64}$/;

/**
 * Which messaging channel each proof is about — `null` for the verification
 * call, which proves a DIVERT, not a channel. A null channel swaps the armed
 * gate for the divert gate (an active number) rather than skipping gating.
 * The text-back proof's armed gate is the `textBackArmed` row.
 */
const PROOF_CHANNEL: Readonly<
  Record<(typeof ACTION_PROOF_KINDS)[number], (typeof MESSAGING_CHANNELS)[number] | null>
> = {
  escalation_handset_proof: 'sms',
  email_pipe_proof: 'email',
  divert_verification_call: null,
  text_back_proof: 'text_back',
};

/** The checklist row that says each channel is armed — read, never assumed. */
const ARMED_ITEM = {
  sms: 'smsArmed',
  email: 'emailArmed',
  text_back: 'textBackArmed',
} as const;

/**
 * RECORD THAT IT ACTUALLY WORKED, WITH THE ARTEFACT TO SHOW FOR IT (D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ARTEFACT IS VERIFIED LIVE, TENANT-SCOPED, BEFORE ANYTHING IS         │
 * │ WRITTEN. An operator's paste is untrusted input that NAMES A PRODUCTION  │
 * │ ROW, and a proof nobody re-checked is the "yeah, saw it work" this whole │
 * │ table exists to replace (T-10-17).                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * FOUR CHECKS BEFORE THE INSERT, and each is a different one:
 *
 *  1. OPERATOR (`requireOperatorId`) — the action id is global, the write goes
 *     through the service-role repository where RLS is inert by design, and the
 *     `recorded_by` column is NOT NULL. The only trustworthy source for that id
 *     is the claim this function verified; a form field would be the caller's.
 *  2. MEMBERSHIP (`authorize`) — the tenant read through the operator's own JWT.
 *  3. THE CHANNEL IS ARMED, read from the SAME derivation the card renders. A
 *     proof for a channel that cannot send is not a proof (T-10-18) — and it is
 *     refused rather than merely hidden, because the button being absent from
 *     the page stops nobody who can POST.
 *  4. THE ARTEFACT IS REAL, BELONGS TO THIS CLIENT, AND SAYS THE MESSAGE LEFT:
 *     an escalation row of this tenant whose `outcome` is `sent` with a provider
 *     message id, or a Resend email that was `delivered` AND WAS SENT FROM THIS
 *     CLIENT'S OWN FROM-ADDRESS. The escalation half takes its tenant scoping
 *     from the repository predicate; the Resend account is shared across every
 *     client, the operator alerts and the audit pipeline, so the email half has
 *     to spell the same scoping as a comparison against the armed identity
 *     (CR-01). Without it, any delivered message on the account proves any
 *     client.
 *
 * NOTHING FROM `formData` IS READ BEFORE 1 AND 2 BOTH PASS.
 *
 * THE ARM-03 EMPTY STATES ARE REFUSED BY NAME. `no_escalation_number`,
 * `sms_not_configured` and `cooldown_suppressed` are rows the escalation pass
 * writes honestly when it could NOT send — findable, pasteable, and exactly the
 * thing an operator working through the runbook might mistake for evidence.
 *
 * WHAT GOES INTO `artefact_detail`: IDS, STATUSES, DOMAINS AND TIMESTAMPS ONLY.
 * Never a customer address, a handset number or a message body (T-10-20) — the
 * same evidence-family rule `escalations` follows, applied to the table that
 * outlives the client.
 */
export async function recordProofAction(
  tenantId: string,
  _previous: ProofState,
  formData: FormData,
): Promise<ProofState> {
  const operator = await requireOperatorId();
  if (!operator.ok) {
    return { ...BLANK_PROOF_STATE, error: OPERATOR_DENIED_MESSAGE[operator.reason] };
  }

  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_PROOF_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const parsed = proofSchema.safeParse({
    kind: formData.get('kind'),
    artefact_id: formData.get('artefact_id'),
    note: formData.get('note'),
  });
  if (!parsed.success) {
    return {
      ...BLANK_PROOF_STATE,
      error: parsed.error.issues[0]?.message ?? PROOF_ARTEFACT_REQUIRED_MESSAGE,
    };
  }

  const { kind, artefact_id: artefactId, note } = parsed.data;
  const channel = PROOF_CHANNEL[kind];

  // THE SAME DERIVATION THE CARD RENDERS, re-read here rather than trusted from
  // the browser: the page the operator is looking at may be minutes old, and a
  // channel can have been disarmed since it rendered.
  let checklist: Awaited<ReturnType<typeof readGoLiveChecklist>>;
  try {
    checklist = await readGoLiveChecklist(tenantId, new Date());
  } catch {
    // A checklist that cannot be read is not a checklist that passed.
    console.error('[clients] proof gate read failed');
    return { ...BLANK_PROOF_STATE, error: PROOF_WRITE_FAILED_MESSAGE };
  }

  if (channel === null) {
    // THE VERIFICATION CALL'S GATE IS THE NUMBER, NOT A CHANNEL (CAP-05). A
    // call cannot have been diverted to a number that is not bought, and a
    // pending or failed row is not bought.
    if (checklist.divert.status !== 'active') {
      return { ...BLANK_PROOF_STATE, error: PROOF_DIVERT_NOT_ACTIVE_MESSAGE };
    }
  } else {
    const armedKey = ARMED_ITEM[channel];
    const armed = checklist.items.find((item) => item.key === armedKey)?.satisfied ?? false;
    if (!armed) {
      // AN ABSENT ITEM IS UNMET, never "no objection" (T-5-13) — hence the
      // `?? false` above rather than an optional chain that reads as satisfied.
      return { ...BLANK_PROOF_STATE, error: PROOF_CHANNEL_NOT_ARMED_MESSAGE[channel] };
    }
  }

  // ── THE LIVE VERIFICATION ────────────────────────────────────────────────
  let artefactDetail: Record<string, unknown>;

  if (kind === 'escalation_handset_proof') {
    if (!UUID_PATTERN.test(artefactId)) {
      // BEFORE THE REPOSITORY READ: a malformed paste costs a refusal, not a
      // round trip, and the sentence says which of the two ids this field wants.
      return { ...BLANK_PROOF_STATE, error: PROOF_ARTEFACT_NOT_UUID_MESSAGE };
    }

    let escalation: Awaited<ReturnType<typeof getEscalationForTenant>>;
    try {
      escalation = await getEscalationForTenant(tenantId, artefactId);
    } catch {
      console.error('[clients] proof artefact read failed');
      return { ...BLANK_PROOF_STATE, error: PROOF_WRITE_FAILED_MESSAGE };
    }

    if (escalation === null) {
      return { ...BLANK_PROOF_STATE, error: PROOF_ESCALATION_NOT_FOUND_MESSAGE };
    }

    // BOTH HALVES, and the provider id is the half that matters most: it is the
    // only handle that survives outside this database, so it is what makes the
    // proof re-checkable at ClickSend by somebody who was not there.
    if (escalation.outcome !== 'sent' || !escalation.providerMessageId) {
      return {
        ...BLANK_PROOF_STATE,
        error: proofEscalationNotSentMessage(escalation.outcome),
      };
    }

    artefactDetail = {
      provider_message_id: escalation.providerMessageId,
      sent_at: escalation.sentAt?.toISOString() ?? null,
    };
  } else if (kind === 'divert_verification_call') {
    // ── THE VERIFICATION CALL (CAP-05, D-09, T-11-15) ────────────────────
    if (!UUID_PATTERN.test(artefactId)) {
      // BEFORE THE REPOSITORY READ, the escalation half's rule.
      return { ...BLANK_PROOF_STATE, error: PROOF_ARTEFACT_NOT_MISSED_CALL_ID_MESSAGE };
    }

    let call: Awaited<ReturnType<typeof getMissedCallForTenant>>;
    try {
      // THE TENANT IS IN THE PREDICATE: another client's call is simply not
      // found, indistinguishable from an unknown id.
      call = await getMissedCallForTenant(tenantId, artefactId);
    } catch {
      console.error('[clients] proof artefact read failed');
      return { ...BLANK_PROOF_STATE, error: PROOF_WRITE_FAILED_MESSAGE };
    }

    if (call === null) {
      return { ...BLANK_PROOF_STATE, error: PROOF_MISSED_CALL_NOT_FOUND_MESSAGE };
    }

    // A CALL THAT DID NOT COMPLETE DID NOT REACH THE GREETING — `ringing` is a
    // status callback that has not landed yet, and `no-answer` / `failed` are
    // exactly the divert faults this proof exists to catch.
    if (call.callStatus !== 'completed') {
      return { ...BLANK_PROOF_STATE, error: proofMissedCallNotCompletedMessage(call.callStatus) };
    }

    // ── THE RELOCATED SPIKE PROOF (WR-02, 11-08) ─────────────────────────
    //
    // The three-carrier spike was skipped by founder override, so THIS call is
    // the evidence that the caller's number survives a divert on this
    // client's carrier — the thing Phase 12's text-back gate rests on. Three
    // more facts, each refused with a sentence naming the call to make:

    // 1. ON THIS CLIENT'S ACTIVE NUMBER. Tenant + completed is not enough: a
    //    call to a number since replaced verifies nothing about today's divert.
    if (
      checklist.divert.divertNumberId === null ||
      call.divertNumberId !== checklist.divert.divertNumberId
    ) {
      return { ...BLANK_PROOF_STATE, error: PROOF_MISSED_CALL_NOT_THIS_NUMBER_MESSAGE };
    }

    // 2. THE CALLER ARRIVED. Withheld, or present-but-stripped by the carrier,
    //    is exactly the failure this proof exists to catch.
    if (call.callerWithheld || !call.callerPresent) {
      return { ...BLANK_PROOF_STATE, error: PROOF_MISSED_CALL_NO_CALLER_MESSAGE };
    }

    // 3. RECENT. A call from last week says nothing about the divert as it is
    //    set now. A start in the future beyond a minute's clock skew is not a
    //    call that happened.
    const ageMs = Date.now() - call.startedAt.getTime();
    if (ageMs > PROOF_MISSED_CALL_MAX_AGE_MS || ageMs < -60_000) {
      return { ...BLANK_PROOF_STATE, error: PROOF_MISSED_CALL_STALE_MESSAGE };
    }

    // IDS, STATUSES, BOOLEANS AND TIMESTAMPS ONLY (T-10-20). No number of any
    // kind — the evidence read cannot even select the caller's, and
    // `forwarded_from_present` answers the S3 question (did the carrier tell
    // us it was a divert) without the number.
    artefactDetail = {
      provider_call_id: call.providerCallId,
      call_status: call.callStatus,
      duration_seconds: call.durationSeconds,
      after_hours: call.afterHours,
      caller_kind: call.callerKind,
      caller_withheld: call.callerWithheld,
      caller_present: call.callerPresent,
      forwarded_from_present: call.forwardedFromPresent,
      divert_number_id: call.divertNumberId,
      started_at: call.startedAt.toISOString(),
      completed_via: call.completedVia,
    };
  } else if (kind === 'text_back_proof') {
    // ── A DELIVERED TEXT-BACK (D-13, T-12-31) ───────────────────────────────
    if (!UUID_PATTERN.test(artefactId)) {
      // BEFORE THE REPOSITORY READ: the field wants the missed-call id the
      // timing reader prints, not the ClickSend message id.
      return { ...BLANK_PROOF_STATE, error: PROOF_ARTEFACT_NOT_TEXT_BACK_ID_MESSAGE };
    }

    let evidence: Awaited<ReturnType<typeof getTextBackEvidenceForTenant>>;
    try {
      // THE TENANT IS IN THE PREDICATE (and in the ledger join): another
      // client's call is simply not found. The read selects no number.
      evidence = await getTextBackEvidenceForTenant(tenantId, artefactId);
    } catch {
      console.error('[clients] proof artefact read failed');
      return { ...BLANK_PROOF_STATE, error: PROOF_WRITE_FAILED_MESSAGE };
    }

    if (evidence === null) {
      return { ...BLANK_PROOF_STATE, error: PROOF_MISSED_CALL_NOT_FOUND_MESSAGE };
    }

    // 1. THE CALL WAS TEXTED. Skipped, failed or still claimed is not a text.
    if (evidence.textBackStatus !== 'sent') {
      return { ...BLANK_PROOF_STATE, error: proofTextBackNotSentMessage(evidence.textBackStatus) };
    }

    // 2. ON THE LEAD ROUTE. An about-quote text answers an open quote's caller
    //    and opens no lead; the proof is of the missed-call text-back itself.
    if (evidence.textBackRoute !== 'lead') {
      return { ...BLANK_PROOF_STATE, error: PROOF_TEXT_BACK_NOT_LEAD_MESSAGE };
    }

    // 3. THE LEDGER SAYS IT LEFT, with the provider's id — the handle that
    //    survives outside this database and makes the proof re-checkable.
    if (evidence.outcome !== 'sent' || !evidence.providerMessageId) {
      return { ...BLANK_PROOF_STATE, error: PROOF_TEXT_BACK_LEDGER_NOT_SENT_MESSAGE };
    }

    // 4. THE CARRIER DELIVERED IT. Accepted is not delivered.
    if (evidence.deliveryStatus !== 'delivered' || evidence.deliveredAt === null) {
      return { ...BLANK_PROOF_STATE, error: PROOF_TEXT_BACK_NOT_DELIVERED_MESSAGE };
    }

    // 5. RECENT — the verification call's window: the text as it is set now.
    const ageMs = Date.now() - evidence.startedAt.getTime();
    if (ageMs > PROOF_MISSED_CALL_MAX_AGE_MS || ageMs < -60_000) {
      return { ...BLANK_PROOF_STATE, error: PROOF_TEXT_BACK_STALE_MESSAGE };
    }

    // IDS, STATUSES, BOOLEANS AND TIMESTAMPS ONLY (T-12-07). No number of any
    // kind: the evidence read selects none, and these are the only keys.
    artefactDetail = {
      provider_message_id: evidence.providerMessageId,
      delivered_at: evidence.deliveredAt.toISOString(),
      started_at: evidence.startedAt.toISOString(),
      seconds_to_delivered: Math.floor(
        (evidence.deliveredAt.getTime() - evidence.startedAt.getTime()) / 1000,
      ),
      after_hours: evidence.afterHours,
      forwarded_from_present: evidence.forwardedFromPresent,
      route: evidence.textBackRoute,
    };
  } else {
    if (!RESEND_ID_PATTERN.test(artefactId)) {
      // BEFORE THE PROVIDER READ, for the same reason the escalation half
      // validates before the repository read — and for one more: `emails.get`
      // interpolates this string into `GET /emails/{id}` unencoded, so a paste
      // like `../domains` or `x?y` reaches a DIFFERENT authenticated endpoint
      // on the account (WR-03). The realistic outcome is a bounded `unknown`
      // refusal, but an operator's paste does not get to choose the URL.
      return { ...BLANK_PROOF_STATE, error: PROOF_ARTEFACT_NOT_RESEND_ID_MESSAGE };
    }

    const status = await getEmailStatus(artefactId);

    if (!status.ok) {
      // THE READ FAILED, WHICH IS NOT "IT BOUNCED". Treating a Resend outage as
      // not-delivered sends an operator to re-verify a domain that is fine.
      return { ...BLANK_PROOF_STATE, error: PROOF_EMAIL_STATUS_UNKNOWN_MESSAGE };
    }

    if (!status.delivered) {
      // ACCEPTED IS NOT DELIVERED. A message Resend took can still bounce at the
      // receiving server minutes later, which is precisely the failure a proof
      // about a newly verified sending domain exists to catch.
      //
      // THE COMPARISON IS THE WRAPPER'S, not this line's (WR-02): `last_event`
      // is the LATEST event, so a message delivered and then opened reads
      // `opened` — which is what D-07's own sequence produces, since the runbook
      // has the operator open the proof email before recording it.
      return { ...BLANK_PROOF_STATE, error: proofEmailNotDeliveredMessage(status.lastEvent) };
    }

    // ── AND IT HAS TO BE THIS CLIENT'S EMAIL (CR-01) ──────────────────────
    //
    // The escalation half gets its tenant scoping from the predicate
    // (`getEscalationForTenant`); this half has no predicate to put it in. One
    // Resend account carries every founding client's cadence, the operator
    // alerts and the audit-request pipeline, so without this comparison
    // "delivered" proves only that SOME email on the account arrived — and a
    // paste from another client's run would derive `live.email` for a client
    // whose identity has never sent anything.
    //
    // THE CLIENT'S OWN ROW IS THE AUTHORITY, read from the same checklist that
    // gated the arm above; `emailArmed` is satisfied, so the identity exists.
    // A missing one is still a refusal rather than a pass: there is nothing to
    // compare against, and "nothing to compare against" has never meant yes.
    const ownFrom = bareAddress(checklist.arming.email.from);
    if (ownFrom === null || status.fromAddress !== ownFrom) {
      return { ...BLANK_PROOF_STATE, error: PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE };
    }

    // THE DOMAIN, NEVER THE ADDRESS. `getEmailStatus` already reduced it; this
    // is the second half of the same rule, at the surface that stores it.
    artefactDetail = { last_event: status.lastEvent, to_domain: status.toDomain };
  }

  try {
    await forTenant(tenantId).proofs.append({
      kind,
      artefactId,
      artefactDetail,
      note,
      // THE VERIFIED CLAIM, never a form field: `recorded_by` is the answer to
      // "whose hand was on this", and a caller-supplied id answers it with the
      // caller's opinion of themselves.
      recordedBy: operator.userId,
    });
  } catch {
    // The caught value is DISCARDED: a postgres error from this statement
    // carries the statement, and its parameters include the operator's note.
    console.error('[clients] proof write failed');
    return { ...BLANK_PROOF_STATE, error: PROOF_WRITE_FAILED_MESSAGE };
  }

  revalidatePath(`/clients/${tenantId}`);

  return { ...BLANK_PROOF_STATE, success: proofRecordedMessage(kind) };
}

/* ------------------------------------------------------------------------- *
 * THE DIVERT NUMBER (CAP-01, D-08) — search, buy, rename. NO RELEASE.
 * ------------------------------------------------------------------------- */

/**
 * WHAT OLIVIA SAYS AFTER "YOU'VE REACHED" — bounded at the boundary (T-11-05).
 *
 * 1–60 characters is the column's CHECK, restated so a long name is a sentence
 * rather than a constraint violation; six words keeps the greeting under its
 * 12-second budget; no control characters, because this string is interpolated
 * into the TwiML a live call executes (the greeting escapes it as well).
 */
const spokenNameSchema = z
  .string()
  .trim()
  .min(1, DIVERT_SPOKEN_NAME_MESSAGE)
  .max(SPOKEN_NAME_MAX, DIVERT_SPOKEN_NAME_MESSAGE)
  .regex(/^[^\u0000-\u001f\u007f]+$/, DIVERT_SPOKEN_NAME_MESSAGE)
  .refine((name) => name.split(/\s+/).length <= SPOKEN_NAME_MAX_WORDS, DIVERT_SPOKEN_NAME_MESSAGE);

/**
 * TAP TWO'S POST. The number must be a WA/SA/NT `08` number in E.164 — the
 * shape the search step returns — and `confirm` must be `buy`: the second tap
 * is a deliberate act, and a forged POST without it buys nothing.
 */
const provisionSchema = z.object({
  // WR-08: THE SAME PREDICATE THE SEARCH FILTERS WITH — a genuine WA
  // geographic range, never merely `+618` (which is also SA, the NT and
  // Broken Hill). Find cannot offer what Buy refuses, and Buy cannot take what
  // Find would never offer.
  phone_number: z.string().refine(isWaGeographicNumber, DIVERT_CONFIRM_MESSAGE),
  // Twilio's locality for the candidate, shown back to the operator. Letters
  // only: it is display text stored in a row, never a routing key.
  locality: z
    .string()
    .regex(/^[A-Za-z .'-]{0,40}$/, DIVERT_CONFIRM_MESSAGE)
    .transform((value) => (value.trim() === '' ? null : value.trim())),
  spoken_name: spokenNameSchema,
  confirm: z.literal('buy', { error: DIVERT_CONFIRM_MESSAGE }),
});

/**
 * TAP ONE: find a Perth number. A READ at Twilio — nothing is written, nothing
 * bought — but still operator-first and membership-checked: the search spends
 * our API quota and returns inventory tied to our account.
 *
 * THE SPOKEN NAME IS CHECKED HERE TOO, before the search: a name tap two would
 * refuse is cheaper to hear about before a number is on screen.
 */
export async function searchDivertNumberAction(
  tenantId: string,
  _previous: DivertNumberState,
  formData: FormData,
): Promise<DivertNumberState> {
  const operator = await requireOperatorId();
  if (!operator.ok) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: OPERATOR_DENIED_MESSAGE[operator.reason] };
  }

  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  if (!spokenNameSchema.safeParse(formData.get('spoken_name')).success) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_SPOKEN_NAME_MESSAGE };
  }

  let result: Awaited<ReturnType<typeof findDivertNumberCandidate>>;
  try {
    result = await findDivertNumberCandidate({ tenantId });
  } catch {
    // The core does not throw; this is the belt to its braces.
    console.error('[clients] divert search failed');
    return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_WRITE_FAILED_MESSAGE };
  }

  switch (result.kind) {
    case 'candidate':
      return {
        ...BLANK_DIVERT_NUMBER_STATE,
        success: divertCandidateMessage(result),
        candidate: {
          phoneNumber: result.phoneNumber,
          locality: result.locality,
          region: result.region,
        },
      };
    case 'already_provisioned':
      return {
        ...BLANK_DIVERT_NUMBER_STATE,
        error: divertAlreadyProvisionedMessage(result.numberE164),
      };
    case 'search_failed':
      return { ...BLANK_DIVERT_NUMBER_STATE, error: divertSearchFailedMessage(result.code) };
    default:
      return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_REFUSAL[result.kind] };
  }
}

/**
 * TAP TWO: BUY THE NUMBER THE OPERATOR WAS SHOWN (CAP-01, D-08, T-11-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS POST SPENDS MONEY AND CREATES A NUMBER THAT CANNOT BE GIVEN BACK    │
 * │ WHILE THE CLIENT IS ACTIVE. The action id is global, so the operator    │
 * │ and membership checks come before a byte of `formData` is read; the      │
 * │ core then guards configuration and claims the row before it buys, so a   │
 * │ second click — or a second operator — is refused without a provider     │
 * │ call.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export async function provisionDivertNumberAction(
  tenantId: string,
  _previous: DivertNumberState,
  formData: FormData,
): Promise<DivertNumberState> {
  const operator = await requireOperatorId();
  if (!operator.ok) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: OPERATOR_DENIED_MESSAGE[operator.reason] };
  }

  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const parsed = provisionSchema.safeParse({
    phone_number: formData.get('phone_number'),
    locality: typeof formData.get('locality') === 'string' ? formData.get('locality') : '',
    spoken_name: formData.get('spoken_name'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return {
      ...BLANK_DIVERT_NUMBER_STATE,
      error: parsed.error.issues[0]?.message ?? DIVERT_CONFIRM_MESSAGE,
    };
  }

  let result: Awaited<ReturnType<typeof provisionDivertNumber>>;
  try {
    result = await provisionDivertNumber({
      tenantId,
      spokenName: parsed.data.spoken_name,
      phoneNumber: parsed.data.phone_number,
      locality: parsed.data.locality,
      // THE VERIFIED CLAIM, never a form field — `created_by` answers "whose
      // hand bought this".
      operatorId: operator.userId,
    });
  } catch {
    console.error('[clients] divert provision failed');
    return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_WRITE_FAILED_MESSAGE };
  }

  switch (result.kind) {
    case 'provisioned':
      revalidatePath(`/clients/${tenantId}`);
      return {
        ...BLANK_DIVERT_NUMBER_STATE,
        success: divertProvisionedMessage(result.numberE164),
        // WR-09: bought and recorded — and the bundle is NOT on it.
        error: result.bundleAttached ? null : DIVERT_BUNDLE_UNATTACHED_MESSAGE,
      };
    case 'already_provisioned':
      return {
        ...BLANK_DIVERT_NUMBER_STATE,
        error: divertAlreadyProvisionedMessage(result.numberE164),
      };
    case 'purchase_failed':
      // THE ROW CHANGED (claimed, then failed) — re-render so the card and the
      // form read the stored code rather than this sentence alone.
      revalidatePath(`/clients/${tenantId}`);
      return { ...BLANK_DIVERT_NUMBER_STATE, error: divertPurchaseFailedMessage(result.code) };
    case 'adopted':
      // CR-01: an earlier purchase was found on the account and recorded.
      revalidatePath(`/clients/${tenantId}`);
      return {
        ...BLANK_DIVERT_NUMBER_STATE,
        success: divertAdoptedMessage(result.numberE164),
        error: result.bundleAttached ? null : DIVERT_BUNDLE_UNATTACHED_MESSAGE,
      };
    case 'outcome_unknown':
      // CR-01: the row stays pending and held — never "nothing was bought".
      revalidatePath(`/clients/${tenantId}`);
      return { ...BLANK_DIVERT_NUMBER_STATE, error: divertOutcomeUnknownMessage(result.code) };
    case 'lookup_failed':
      return { ...BLANK_DIVERT_NUMBER_STATE, error: divertLookupFailedMessage(result.code) };
    case 'orphaned_number':
      // The core already logged the PN sid; nothing further is logged here.
      revalidatePath(`/clients/${tenantId}`);
      return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_ORPHANED_MESSAGE };
    default:
      return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_REFUSAL[result.kind] };
  }
}

/**
 * CORRECT WHAT THE GREETING SAYS — the number is untouched (S5: a name the
 * voice mispronounces is fixed by respelling it, not by buying again).
 */
export async function updateSpokenNameAction(
  tenantId: string,
  _previous: DivertNumberState,
  formData: FormData,
): Promise<DivertNumberState> {
  const operator = await requireOperatorId();
  if (!operator.ok) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: OPERATOR_DENIED_MESSAGE[operator.reason] };
  }

  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const parsed = spokenNameSchema.safeParse(formData.get('spoken_name'));
  if (!parsed.success) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_SPOKEN_NAME_MESSAGE };
  }

  let rows: Awaited<ReturnType<ReturnType<typeof forTenant>['divertNumber']['setSpokenName']>>;
  try {
    rows = await forTenant(tenantId).divertNumber.setSpokenName(parsed.data);
  } catch {
    // Discarded: the statement's parameters include the name.
    console.error('[clients] spoken name write failed');
    return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_WRITE_FAILED_MESSAGE };
  }

  if (rows.length === 0) {
    return { ...BLANK_DIVERT_NUMBER_STATE, error: DIVERT_SPOKEN_NAME_NO_NUMBER_MESSAGE };
  }

  revalidatePath(`/clients/${tenantId}`);
  return { ...BLANK_DIVERT_NUMBER_STATE, success: DIVERT_SPOKEN_NAME_SAVED_MESSAGE };
}
