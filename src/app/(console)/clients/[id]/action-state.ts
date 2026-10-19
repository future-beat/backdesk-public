/**
 * Action state shapes + blank initial values for the client-detail forms.
 *
 * These live OUTSIDE actions.ts because a `'use server'` module may export only
 * async functions — a const export is a module-evaluation error under Turbopack
 * (nextjs.org/docs/messages/invalid-use-server-value). Types alone would be
 * erased, but the BLANK_* constants are runtime values, so they need a plain
 * module both the server actions and the client form components can import.
 */

// Type-only imports: erased at build time, so this module stays importable from
// the client component that renders these sentences (the 06-02 bundle rule).
import type { GatingKey } from '@/core/onboarding/arming';
import type { MessagingChannel } from '@/db/schema';

export type ConnectState = {
  /** Message under the key input. */
  error: string | null;
  /** A failure belonging to no single control. */
  formError: string | null;
  /** Confirmation copy after a successful connect. */
  success: string | null;
};

export const BLANK_CONNECT_STATE: ConnectState = {
  error: null,
  formError: null,
  success: null,
};

export type EligibilityState = {
  error: string | null;
  success: string | null;
};

export const BLANK_ELIGIBILITY_STATE: EligibilityState = { error: null, success: null };

/* ------------------------------------------------------------------------- *
 * The escalation number (CON-03) — editable after creation from 06-06
 * ------------------------------------------------------------------------- */

export type EscalationPhoneState = {
  /** The refusal, under the input — this failure belongs to that one field. */
  error: string | null;
  success: string | null;
};

export const BLANK_ESCALATION_PHONE_STATE: EscalationPhoneState = {
  error: null,
  success: null,
};

/** Bounds a FORGED post; a real AU mobile is eleven characters at most. */
export const ESCALATION_PHONE_MAX = 32;

/**
 * THE WRITE ITSELF FAILED, AND THE NUMBER DID NOT CHANGE (WR-08).
 *
 * `tenant.update` throws by design on an empty, unknown or immutable patch, and
 * any driver error propagates through it. Without this arm the action had no
 * `try` at all, so a throw surfaced as Next's generic error page with a digest —
 * on a form whose entire purpose is a fixed sentence under one input.
 *
 * IT SAYS "NOTHING CHANGED" BECAUSE NOTHING DID. This is the one write in the
 * console whose success is a hot lead arriving on a particular handset, so an
 * operator who cannot tell whether it landed will either re-check ServiceM8 or,
 * worse, assume it saved. The retry is safe: the write is a named-column update.
 */
export const ESCALATION_PHONE_WRITE_FAILED_MESSAGE =
  'Could not save that number — nothing changed. Try again in a moment.';

/**
 * THE ATTESTATION WAS NOT RECORDED (WR-08).
 *
 * `attestSm8AutomationOff` throws explicitly and runs a transaction, so a
 * failure leaves no half-written row — but it also left the action with nothing
 * to say. An attestation is one of the two keys that starts real messaging, and
 * "did that save?" is not a question to answer with an error digest.
 */
export const ATTEST_WRITE_FAILED_MESSAGE =
  'Could not record that — nothing was saved. Try again in a moment.';

/**
 * Saved, and what that means for the tradie's phone.
 *
 * The cleared case gets its OWN sentence and names the consequence, because
 * "Saved." beside an empty field is the one outcome an operator could read as
 * either result. Clearing the number is legitimate — the escalation pass
 * records `no_escalation_number` honestly rather than failing — but it means hot
 * leads stop arriving on a handset, and that is worth saying out loud on the
 * screen where somebody just did it.
 */
export function escalationPhoneSavedMessage(phone: string | null): string {
  if (phone === null) {
    return 'Cleared. Hot-lead alerts will not be texted to anyone for this client until a number is set.';
  }
  return `Saved. Hot leads for this client will be texted to ${phone}.`;
}

/* ------------------------------------------------------------------------- *
 * The after-hours escalation switch (Phase 13, D-09)
 * ------------------------------------------------------------------------- */

export type AfterHoursEscalationState = {
  /** The write failed — nothing changed. */
  error: string | null;
  success: string | null;
};

export const BLANK_AFTER_HOURS_ESCALATION_STATE: AfterHoursEscalationState = {
  error: null,
  success: null,
};

/**
 * THE WRITE FAILED, AND THE SWITCH DID NOT MOVE. Same reasoning as the
 * escalation number's sentence (WR-08): an operator who cannot tell whether the
 * switch landed will either assume it did or flip it again blind. The retry is
 * safe — the write is a one-column update.
 */
export const AFTER_HOURS_ESCALATION_WRITE_FAILED_MESSAGE =
  'Could not save that setting — nothing changed. Try again in a moment.';

/**
 * Saved, and what that means for the tradie's phone at night.
 *
 * Both sentences name the exception that never changes: an emergency or an
 * URGENT reply is texted at once whichever way the switch is set (D-09). An
 * operator turning it off must not read that as "nothing reaches the tradie at
 * night".
 */
export function afterHoursEscalationSavedMessage(on: boolean): string {
  if (on) {
    return 'Saved. Hot leads outside contact hours will be texted to the escalation phone straight away.';
  }
  return 'Saved. Hot leads outside contact hours will wait until contact hours open. Emergencies and URGENT replies are still sent at once.';
}

/* ------------------------------------------------------------------------- *
 * The ONB-04 attestation (D-14/D-16) — the checklist card's one writable row
 * ------------------------------------------------------------------------- */

export type AttestState = {
  error: string | null;
  success: string | null;
};

export const BLANK_ATTEST_STATE: AttestState = { error: null, success: null };

/**
 * THE NOTE IS REQUIRED AT THE BOUNDARY AS WELL AS AT THE CORE (T-5-12/T-5-20).
 *
 * `attestSm8AutomationOff` takes the note as a required PARAMETER and the
 * column is NOT NULL with no default, so a caller cannot OMIT it. Neither can
 * stop a caller passing `''` — and an attestation with an empty evidence string
 * is a checkbox wearing a textarea's clothes, which is exactly what the column
 * exists to replace. This message is the third layer.
 */
export const ATTEST_NOTE_REQUIRED_MESSAGE =
  'Say what you saw — "opened Settings → Automation with Dave, Quote Follow Up is off". Typing it is the record that somebody actually looked.';

export const ATTEST_NOTE_TOO_LONG_MESSAGE =
  'Keep it under 500 characters — it records what you saw, not the whole conversation.';

/** The evidence note's ceiling, matching the template-approval note's. */
export const ATTEST_NOTE_MAX = 500;

/**
 * Recorded, and the gate did or did not open as a result.
 *
 * `cadencesResumed` is REPORTED rather than assumed, for the reason
 * `approvedSetCompleteMessage` reports it: an operator who just recorded an
 * attestation finds out that nine follow-ups which had been piling up, paused,
 * since Tuesday are now live. Zero is an ordinary answer — the OTHER condition
 * is still open, or this client simply has no quotes waiting — and it gets its
 * own sentence rather than a confusing "0 sequences restarted".
 */
export function attestRecordedMessage(input: {
  templatesApproved: boolean;
  cadencesResumed: number;
}): string {
  if (!input.templatesApproved) {
    return (
      'Recorded. This client still needs approved message templates before their ' +
      'follow-ups can send.'
    );
  }

  if (input.cadencesResumed === 0) {
    return 'Recorded. This client is ready to send — nothing was waiting to restart.';
  }

  return `Recorded. ${input.cadencesResumed} ${
    input.cadencesResumed === 1 ? 'sequence' : 'sequences'
  } waiting on this ${input.cadencesResumed === 1 ? 'has' : 'have'} restarted.`;
}

/* ------------------------------------------------------------------------- *
 * ARMING (ARM-02, D-03/D-04/D-05) — the console's highest-consequence control
 * ------------------------------------------------------------------------- */

export type ArmState = {
  error: string | null;
  success: string | null;
};

export const BLANK_ARM_STATE: ArmState = { error: null, success: null };

/** Bounds a FORGED post as much as a rambling one — the action id is global. */
export const ARM_REASON_MAX = 500;

/**
 * THE REFUSAL NAMES THE FIRST MISSING THING, AND WHERE TO FIX IT (D-05).
 *
 * A `Record` over `GatingKey`, so a gate added to `ARMING_GATES` is a COMPILE
 * ERROR here rather than an arming refused with `undefined` on screen.
 *
 * Each sentence says what is missing and where the remedy is, because the
 * operator reading it is mid-onboarding with a tradie on the phone. None of
 * them says "cannot arm": the refusal is not the news, the missing thing is.
 */
export const ARM_REFUSAL: Record<GatingKey, string> = {
  sm8Connected:
    "Connect this client's ServiceM8 first (above). Arming a client whose key is dead would chase quotes nobody can win-detect.",
  contactHours: 'Set contact hours first (above).',
  templatesApproved: 'Approve every template first — Voice & templates →',
  sm8AutomationOff: 'Record that ServiceM8 auto follow-up is off first (below).',
  escalationPhone: 'Set an escalation number first (above).',
  sendingDomainVerified:
    "The sending domain for this client's from-address is not verified yet — Email settings →",
  // ── TEXT-BACK'S OWN FIVE (Phase 12, 12-08, D-09/D-15) ──────────────────────
  smsArmed: 'Arm SMS for this client first — text-backs leave from the same number.',
  divertNumber: 'Provision the divert number first (below).',
  divertVerified:
    "Record a verification call first — a diverted call from a second phone that shows the caller's number.",
  textBackTemplates: 'Attest all three text-back wordings first — Text-back →',
  neverTextOwnNumber: "Add the client's own lines to the never-text list first — Text-back →",
};

/**
 * TEXT-BACK IS ARMED ONE CLIENT AT A TIME (D-09) — the refusal for a text-back
 * arm or disarm aimed at "every client". There is no shared text-back row and
 * no control that posts one; a POST that asks anyway is refused before any read.
 */
export const ARM_TEXT_BACK_PER_CLIENT_MESSAGE =
  'Text-back is turned on and off one client at a time — there is no every-client switch. Nothing changed.';

/**
 * THE DEPLOYED PRIVACY NOTICE DOES NOT COVER CALLERS (D-09, D-11). Asked of the
 * copy this build serves at /privacy before any checklist read; the remedy is a
 * deploy, not anything on this page.
 */
export const ARM_TEXT_BACK_PRIVACY_MESSAGE =
  'Text-back cannot be turned on until the privacy notice covers callers.';

/**
 * THE PROVIDER READ FAILED, SO NOTHING WAS ARMED (Pitfall 5).
 *
 * Distinct from the `sendingDomainVerified` refusal above, and the distinction
 * is the operator's next move: that one means go and add DNS records, this one
 * means change nothing and try again. Treating a Resend outage as "not
 * verified" sends somebody to fix a domain that is fine; treating it as
 * verified arms email on a domain nobody has checked.
 */
export const ARM_DOMAIN_UNKNOWN_MESSAGE =
  'Could not check the sending domain right now. Nothing was armed — try again in a moment.';

/**
 * There is no identity to arm — and WHICH field is missing, because "add the
 * identity first" beside a row that has a from-address and no reply-to is a
 * sentence that reads as a bug.
 */
export function armNoIdentityMessage(
  channel: MessagingChannel,
  missing: 'row' | 'from_address' | 'reply_to' | 'business_name',
): string {
  if (channel === 'sms') {
    return 'There is no SMS sender number on the shared row to arm — the ClickSend number setup has not been recorded.';
  }

  // The text-back switch has no identity, so `armChannel` never answers
  // `no_identity` for it; the branch exists so the sentence is never email's.
  if (channel === 'text_back') {
    return 'Text-back could not be armed for this client. Nothing changed — try again in a moment.';
  }

  switch (missing) {
    case 'reply_to':
      return 'Add a reply-to for this client first — customer replies go to the tradie, not to us — Email settings →';
    case 'business_name':
      return 'Add the business name first — every message must say who it is from — Email settings →';
    default:
      return "Add this client's email identity first — Email settings →";
  }
}

/** Already on, and nothing was written — so the audit shows one row, not two. */
export const ARM_ALREADY_MESSAGE: Readonly<Record<MessagingChannel, string>> = {
  sms: 'SMS is already on.',
  email: 'Email is already on for this client.',
  text_back: 'Text-back is already on for this client.',
};

export const DISARM_ALREADY_MESSAGE: Readonly<Record<MessagingChannel, string>> = {
  sms: 'SMS is already off for this client.',
  email: 'Email is already off for this client.',
  text_back: 'Text-back is already off for this client.',
};

/**
 * THE REASON IS THE RECORD (D-04).
 *
 * A disarm is the interesting event — something went wrong, or somebody decided
 * it had — and the sentence typed at that moment is the only place that
 * judgement is ever written down. The column's CHECK refuses an empty one; this
 * is the sentence that explains why.
 */
export const DISARM_REASON_REQUIRED_MESSAGE = 'Say why — the reason is the audit record.';

export const ARM_WRITE_FAILED_MESSAGE =
  'Could not write the arming change. Nothing was armed — try again in a moment.';

export const DISARM_WRITE_FAILED_MESSAGE =
  'Could not write the arming change. Nothing changed — try again in a moment.';

/**
 * THE BLAST RADIUS, COUNTED AND NAMED (10-03, D-03, T-10-12).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "Every connected client" is a true sentence an operator reads as "this   │
 * │ plumber", on a page showing one client's name. The names are what make   │
 * │ the claim checkable.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The list comes from `forAllTenants_armedBySmsGlobal` — connected clients with
 * no sms row of their own, which is exactly the set the shared row governs.
 *
 * THREE CASES, AND THE THIRD IS THE ONE THAT MATTERS. A list says who; an EMPTY
 * list says plainly that nobody rides the shared row today, rather than printing
 * "0 clients"; and `null` — the read failed — says NOTHING at all, because "no
 * connected client is without its own row" is a claim, and a claim made out of a
 * failed query is the kind of false comfort this clause exists to remove.
 */
function blastRadiusClause(armedClients: readonly { name: string }[] | null): string {
  if (armedClients === null) return '';
  if (armedClients.length === 0) return ' — no connected client is without its own row today';

  const names = armedClients.map((client) => client.name).join(', ');
  return ` — ${armedClients.length} ${armedClients.length === 1 ? 'client' : 'clients'}: ${names}`;
}

/**
 * WHAT THE CONFIRMING TAP IS ABOUT TO DO, in one sentence (D-03).
 *
 * Rendered between the two taps of the shared-row arm. It shares
 * `blastRadiusClause` with `armedMessage` deliberately: the warning and the
 * confirmation are the same promise before and after, and two spellings of it
 * would drift into a warning that names three clients and a receipt that names
 * four.
 */
export function smsBlastRadiusSentence(
  armedClients: readonly { name: string }[] | null,
  from: string,
): string {
  return (
    `This arms SMS for every connected client on the next tick${blastRadiusClause(armedClients)}. ` +
    `Real customer messages will send from the shared number ${from}. ` +
    'A message that has left cannot be recalled.'
  );
}

/**
 * Armed, and WHO IT IS ARMED FOR — the blast radius repeated after the fact.
 *
 * The confirm warning states it between the two taps; this states it again once
 * it is done, because "Armed." on a page showing one client's name is exactly
 * how an operator remembers having armed one client — now with the names, read
 * FRESH after the write so the receipt describes what actually happened.
 *
 * `armedClients` is ignored by every branch but the shared row's: a per-client
 * arm touches nobody else, and a list beside it would say otherwise.
 */
export function armedMessage(
  channel: MessagingChannel,
  target: 'everyone' | 'client',
  armedClients: readonly { name: string }[] | null = [],
): string {
  if (channel === 'email') {
    return 'Armed. Email is on for this client from the next tick.';
  }

  if (channel === 'text_back') {
    return "Armed. Text-back is on for this client from the next missed call to their diverted number. Nobody else is affected.";
  }

  return target === 'everyone'
    ? `Armed. SMS is on for every connected client from the next tick, from the shared number${blastRadiusClause(
        armedClients,
      )}.`
    : "Armed. SMS is on for this client from the next tick — this client's override is lifted.";
}

/** Off, and for whom — the same distinction, in the direction that matters less. */
export function disarmedMessage(channel: MessagingChannel, scope: 'everyone' | 'client'): string {
  if (channel === 'email') {
    return 'Off. Email is off for this client from the next tick.';
  }

  if (channel === 'text_back') {
    return 'Off. Text-back is off for this client from the next missed call. The greeting keeps answering and calls keep being logged.';
  }

  return scope === 'everyone'
    ? 'Off. SMS is off for every client from the next tick.'
    : 'Off. SMS is off for this client only — the shared number stays as it is for the others.';
}

/* ------------------------------------------------------------------------- *
 * THE LIVE PROOFS (ARM-03 / DOM-04, D-02) — evidence, not a checkbox
 * ------------------------------------------------------------------------- */

export type ProofState = {
  error: string | null;
  success: string | null;
};

export const BLANK_PROOF_STATE: ProofState = { error: null, success: null };

/** The observation note's ceiling, matching the attestation note's. */
export const PROOF_NOTE_MAX = 500;

/**
 * THE NOTE IS THE RECORD THAT SOMEBODY LOOKED (D-02, the T-5-12 argument).
 *
 * The artefact id proves the SYSTEM did something. The note is the only record
 * that a human was at the other end of it — which handset buzzed, which inbox
 * it landed in — and that is the half nobody can reconstruct from the database
 * six months later.
 */
export const PROOF_NOTE_REQUIRED_MESSAGE =
  'Say what you observed — which handset buzzed, or which inbox received it and what the headers showed. The note is the record that somebody looked.';

/**
 * NO PROOF WITHOUT AN ARTEFACT ID (D-02), and the sentence says WHERE TO GET IT.
 *
 * "Artefact id is required" would be true and useless at the moment it is read:
 * the operator is mid-runbook with a tradie waiting, and the id is printed by a
 * script they have already run. Naming the two commands is the difference
 * between a refusal and an instruction.
 */
export const PROOF_ARTEFACT_REQUIRED_MESSAGE =
  'Paste the artefact id — the escalation row id from npm run escalations:recent, the Resend email id printed by verify:email-pipe, or the missed-call id from npm run missed-calls:recent.';

/**
 * THE ESCALATION ARTEFACT IS A ROW ID, which is a uuid — checked before any
 * repository read so a malformed paste costs a query rather than a round trip.
 */
export const PROOF_ARTEFACT_NOT_UUID_MESSAGE =
  'That is not an escalation row id. It looks like 0f8c…-…-…-…-…, printed by npm run escalations:recent — not the ClickSend message id.';

/**
 * THE EMAIL ARTEFACT IS A RESEND ID, CHECKED BEFORE IT BECOMES A URL (WR-03).
 *
 * `emails.get(id)` interpolates this string into `GET /emails/{id}` unencoded,
 * so a paste such as `../domains` reaches a different authenticated endpoint on
 * the account. The realistic outcome is a bounded `unknown` refusal rather than
 * anything worse, but an operator's paste does not get to choose which endpoint
 * the request goes to — and the escalation half already validates its id before
 * its own read, as does the runbook script before this same provider call.
 *
 * The sentence names the command that PRINTS the id, for the same reason
 * `PROOF_ARTEFACT_REQUIRED_MESSAGE` does: the operator is mid-runbook, and
 * naming the source is the difference between a refusal and an instruction.
 */
export const PROOF_ARTEFACT_NOT_RESEND_ID_MESSAGE =
  'That is not a Resend email id. It looks like 0f8c1a2b-…-…-…-…, printed by npm run verify:email-pipe — not the escalation row id and not a subject line.';

/**
 * A PROOF FOR AN UNARMED CHANNEL IS NOT A PROOF (T-10-18).
 *
 * It is refused rather than merely hidden, for the reason every gate on this
 * page is: the action id is global and the write goes through the service-role
 * repository. The sentence names the missing thing rather than the refusal,
 * because the operator's next move is the arm control directly above it.
 */
export const PROOF_CHANNEL_NOT_ARMED_MESSAGE: Readonly<Record<MessagingChannel, string>> = {
  sms: 'Arm SMS first — a proof records a message that actually left.',
  email: 'Arm email first — a proof records a message that actually left.',
  text_back:
    'Turn text-back on for this client first — a proof records a text-back that actually arrived.',
};

/**
 * ONE SENTENCE FOR BOTH "no such escalation" AND "somebody else's escalation".
 *
 * `getEscalationForTenant` puts the tenant in the predicate and returns `null`
 * for either, deliberately: a refusal that distinguished them would tell a
 * guesser which escalation uuids exist.
 */
export const PROOF_ESCALATION_NOT_FOUND_MESSAGE =
  'No escalation with that id belongs to this client.';

/**
 * THE ARM-03 EMPTY STATES, NAMED (D-02).
 *
 * `no_escalation_number`, `sms_not_configured` and `cooldown_suppressed` are
 * rows the escalation pass writes HONESTLY when it could not send — and each one
 * is a row an operator running the runbook can find, paste, and mistake for
 * evidence. Naming the outcome is what turns the refusal into the next step:
 * `no_escalation_number` means go and set the number, `cooldown_suppressed`
 * means send another reply.
 *
 * THE OUTCOME IS BOUNDED BEFORE IT ENTERS THE SENTENCE (T-10-20). The column is
 * `text` and also carries UPPERCASE provider codes, so the value reaching a
 * rendered surface is clipped to 32 characters of `[A-Za-z_]` or replaced
 * wholesale. A provider that one day writes an error string into that column
 * must not get to write it onto this page.
 */
export function proofEscalationNotSentMessage(outcome: string | null): string {
  const bounded =
    typeof outcome === 'string' && /^[A-Za-z_]{1,32}$/.test(outcome.trim())
      ? outcome.trim()
      : 'unknown';

  return `That escalation did not send — its outcome is ${bounded}. Only a row with outcome sent and a provider message id is a proof.`;
}

/**
 * THE PROVIDER READ FAILED, SO NOTHING WAS RECORDED (Pitfall 5, again).
 *
 * Distinct from "it bounced", and the distinction is the operator's next move:
 * that one means the pipe is broken, this one means change nothing and try
 * again. Treating a Resend outage as "not delivered" sends somebody to re-verify
 * a domain that is fine; treating it as delivered writes a proof for a message
 * nobody has confirmed arrived.
 */
export const PROOF_EMAIL_STATUS_UNKNOWN_MESSAGE =
  'Could not read that email at Resend right now. Nothing was recorded — try again in a moment.';

/**
 * ACCEPTED IS NOT DELIVERED, and `bounced` is the answer that must stop a
 * go-live — which is precisely the failure a proof about a newly verified
 * sending domain exists to catch.
 *
 * `lastEvent` arrives already bounded by `getEmailStatus`'s `boundedCode`; it is
 * bounded AGAIN here because this function is exported and the next caller may
 * not be that one.
 */
export function proofEmailNotDeliveredMessage(lastEvent: string | null): string {
  const bounded =
    typeof lastEvent === 'string' && /^[A-Za-z_]{1,32}$/.test(lastEvent.trim())
      ? lastEvent.trim()
      : 'unknown';

  return `That email has not been delivered — Resend's last event for it is ${bounded}. Only a message that reached the recipient is a proof; queued and sent mean ask again in a moment.`;
}

/**
 * THAT EMAIL IS NOT THIS CLIENT'S (CR-01) — the tenant-scoping the escalation
 * half gets from its predicate, spelled for the half that has no predicate.
 *
 * `getEscalationForTenant` puts the tenant in the WHERE clause, so a foreign
 * escalation id simply is not found. The Resend read has no such clause: the
 * account is shared by every founding client, by the operator alerts and by the
 * audit-request pipeline, so a delivered message id from ANY of them would
 * otherwise satisfy the proof and turn this client's `live.email` green without
 * their identity ever having sent anything.
 *
 * THE SENTENCE NAMES NEITHER ADDRESS. It is a refusal on an id the operator
 * pasted, and the addresses involved belong to two different businesses; naming
 * the one that did send would also be a way to read a foreign client's sending
 * identity out of this form, one paste at a time.
 */
export const PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE =
  "That email was not sent from this client's identity. Only a delivered message from their own from-address is a proof — re-run npm run verify:email-pipe for this client and paste the id it prints.";

/**
 * THE WRITE ITSELF FAILED, AND NOTHING WAS RECORDED (WR-08).
 *
 * The thrown value never reaches this sentence: a postgres error from that
 * INSERT carries the statement, and its parameters include the operator's note
 * and a provider id.
 */
export const PROOF_WRITE_FAILED_MESSAGE =
  'Could not record that proof — nothing was saved. Try again in a moment.';

/**
 * Recorded — and what it MEANS, which is the news.
 *
 * "Recorded." alone describes a row. The operator's question is whether this
 * client is finished, and the answer is that the channel is now live: armed,
 * and observed working, which is the pair D-01 defines.
 */
export function proofRecordedMessage(
  kind:
    | 'escalation_handset_proof'
    | 'email_pipe_proof'
    | 'divert_verification_call'
    | 'text_back_proof',
): string {
  if (kind === 'divert_verification_call') {
    return 'Recorded. The divert for this client is verified.';
  }
  if (kind === 'text_back_proof') {
    return 'Recorded. Text-back is live for this client.';
  }
  return kind === 'escalation_handset_proof'
    ? 'Recorded. SMS is live for this client.'
    : 'Recorded. Email is live for this client.';
}

/* ------------------------------------------------------------------------- *
 * THE VERIFICATION CALL (CAP-05, D-09) — the third proof, a missed_calls row
 * ------------------------------------------------------------------------- */

/**
 * THE ARTEFACT IS A `missed_calls` ROW ID — a uuid, checked before the
 * repository read, and the sentence names the script that prints it.
 */
export const PROOF_ARTEFACT_NOT_MISSED_CALL_ID_MESSAGE =
  'That is not a missed-call row id. It looks like 0f8c…-…, printed by npm run missed-calls:recent.';

/**
 * One sentence for "no such call" and "another client's call" — the read puts
 * the tenant in the predicate, and a refusal that told them apart would tell a
 * guesser which call ids exist.
 */
export const PROOF_MISSED_CALL_NOT_FOUND_MESSAGE =
  'No missed call with that id belongs to this client.';

/**
 * A CALL THAT DID NOT COMPLETE VERIFIES NOTHING: `ringing` means the status
 * callback has not landed yet, `no-answer` / `failed` / `busy` mean the divert
 * did not deliver the call to the greeting. The status is bounded before it
 * enters the sentence, like every provider value on this page.
 */
export function proofMissedCallNotCompletedMessage(status: string | null): string {
  const bounded =
    typeof status === 'string' && /^[a-z-]{1,32}$/.test(status.trim()) ? status.trim() : 'unknown';

  return `That call has not completed — its status is ${bounded}. Only a completed call to this client's divert number is a verification.`;
}

/*
 * THE VERIFICATION CALL MUST BE A DIVERTED CALL THAT KEPT ITS CALLER (WR-02).
 *
 * The three-carrier spike was skipped by founder override (11-08, 5 Oct 2026),
 * so each client's verification call IS the proof that the caller's number
 * survives a divert on that client's carrier. A direct dial, a `#31#` call, a
 * call to some other number or yesterday's call proves none of it — and each
 * refusal says what to do instead, in the same words: a DIVERTED call, from a
 * second phone, with caller ID on.
 */

/** The call did not arrive on this client's ACTIVE divert number. */
export const PROOF_MISSED_CALL_NOT_THIS_NUMBER_MESSAGE =
  "That call did not arrive on this client's active divert number. Set the divert on the client's handset, ring the client's own line from a second phone with caller ID on, let it divert, and record that call.";

/** Withheld, or the carrier stripped the caller: the divert's CLI is unproven. */
export const PROOF_MISSED_CALL_NO_CALLER_MESSAGE =
  "That call arrived without the caller's number (withheld, or stripped by the carrier), so it does not prove the divert keeps the caller. Make a DIVERTED call from a second phone with caller ID on — ring the client's own line with the divert set, not the Backdesk number directly — and record that one. If the number is missing again, this carrier strips it: do not arm text-back for this client.";

/** Older than a day: the divert may have been changed since. */
export const PROOF_MISSED_CALL_STALE_MESSAGE =
  "That call is more than 24 hours old. Make a fresh DIVERTED call from a second phone with caller ID on — ring the client's own line with the divert set — and record it within 24 hours.";

/** How recent the verification call must be, at the moment it is recorded. */
export const PROOF_MISSED_CALL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------------- *
 * THE TEXT-BACK PROOF (Phase 12, 12-08, D-13) — a DELIVERED text-back
 * ------------------------------------------------------------------------- */

/** The artefact is the missed-call row id the timing reader prints. */
export const PROOF_ARTEFACT_NOT_TEXT_BACK_ID_MESSAGE =
  'That is not a missed-call row id. It looks like 0f8c…-…, printed by npm run text-back:timing — not the ClickSend message id.';

/**
 * THE CALL WAS NOT TEXTED. The status is bounded before it enters the
 * sentence, like every stored value on this page.
 */
export function proofTextBackNotSentMessage(status: string | null): string {
  const bounded =
    typeof status === 'string' && /^[a-z_]{1,32}$/.test(status.trim()) ? status.trim() : 'not decided';

  return `That call was not texted — its text-back is ${bounded}. Only a call whose text-back was sent and delivered is a proof.`;
}

/** An about-quote text answered an open quote's caller; it opens no lead. */
export const PROOF_TEXT_BACK_NOT_LEAD_MESSAGE =
  "That call's text was the about-quote text for an open quote, not a missed-call text-back. Record a call from a number with no open quote.";

/** The ledger does not show the text leaving with a provider id. */
export const PROOF_TEXT_BACK_LEDGER_NOT_SENT_MESSAGE =
  "That text-back has no sent record with a ClickSend message id. Only a text that left the provider is a proof — check npm run text-back:timing for that call's outcome.";

/** Sent, but no delivery receipt yet (or a failed one). */
export const PROOF_TEXT_BACK_NOT_DELIVERED_MESSAGE =
  'That text-back has no delivered receipt yet. Wait for the delivery receipt and try again — npm run text-back:timing shows a delivered time once it lands.';

/** Older than a day: the setup may have changed since. */
export const PROOF_TEXT_BACK_STALE_MESSAGE =
  'That call is more than 24 hours old. Make a fresh diverted call from a second phone, check the text arrives, and record that call within 24 hours.';

/** No active number → nothing to have diverted to. The next move is above. */
export const PROOF_DIVERT_NOT_ACTIVE_MESSAGE =
  'Provision the divert number first — a verification call needs a number to be diverted to.';

/* ------------------------------------------------------------------------- *
 * THE DIVERT NUMBER (CAP-01, D-08) — buy one Perth number, two taps
 * ------------------------------------------------------------------------- */

export type DivertNumberState = {
  error: string | null;
  success: string | null;
  /** What tap one found — carried to tap two, where the operator confirms it. */
  candidate: { phoneNumber: string; locality: string | null; region: string | null } | null;
};

export const BLANK_DIVERT_NUMBER_STATE: DivertNumberState = {
  error: null,
  success: null,
  candidate: null,
};

/** The spoken name's ceilings: the column's 60 characters, and six words. */
export const SPOKEN_NAME_MAX = 60;
export const SPOKEN_NAME_MAX_WORDS = 6;

/**
 * EVERY REFUSAL NAMES THE MISSING THING AND THE NEXT MOVE — the `ARM_REFUSAL`
 * rule. None of them spent anything: each is returned before a provider call.
 */
export const DIVERT_REFUSAL: Readonly<
  Record<
    | 'base_url_unset'
    | 'wrong_host'
    | 'bundle_missing'
    | 'address_missing'
    | 'config_unreadable'
    | 'already_provisioned'
    | 'in_progress'
    | 'no_inventory',
    string
  >
> = {
  base_url_unset:
    'APP_BASE_URL is not set, so there is no console address to wire a number to — set it to https://app.backdesk.com.au before buying.',
  wrong_host:
    'The console base URL is not the production console host, so a number cannot be wired to it — fix APP_BASE_URL before buying.',
  bundle_missing:
    'The AU regulatory bundle is not approved or its SID is not configured — set TWILIO_AU_BUNDLE_SID after Twilio approves the bundle.',
  address_missing:
    'The regulatory address SID is not configured — set TWILIO_AU_ADDRESS_SID before buying.',
  config_unreadable:
    'The Twilio configuration could not be read on the server — nothing was searched or bought. Check the TWILIO_* variables on Vercel.',
  already_provisioned: 'This client already has a divert number — nothing was bought.',
  in_progress:
    'A purchase for this client is already in progress — nothing more was bought. Reload in a moment.',
  no_inventory:
    'Twilio has no Perth local numbers right now — try again later, or accept any WA 08 number from the runbook step.',
};

/** Tap one's answer: the exact number, where it is, and what it costs. */
export function divertCandidateMessage(candidate: {
  phoneNumber: string;
  locality: string | null;
}): string {
  return `Found ${candidate.phoneNumber} (${candidate.locality ?? 'WA'}). Buying it costs about A$3 a month on the Backdesk Twilio account and it cannot be released while this client is active — confirm to buy.`;
}

export function divertProvisionedMessage(numberE164: string): string {
  return `Bought ${numberE164}. Give the client this number for their divert; the verification call comes next.`;
}

export function divertAlreadyProvisionedMessage(numberE164: string): string {
  return `This client already has ${numberE164} — nothing was bought.`;
}

/**
 * The code is ours and closed; bounded again because this is exported. Only a
 * DETERMINATE refusal reaches this sentence (CR-01) — Twilio answered no — so
 * "nothing was bought" is true here and nowhere else.
 */
export function divertPurchaseFailedMessage(code: string): string {
  const bounded = /^[a-z0-9_]{1,32}$/.test(code) ? code : 'unknown';
  return `The purchase did not go through (${bounded}) — nothing was bought. Search again, or check the bundle status at Twilio.`;
}

/** The search itself failed — not "no numbers". */
export function divertSearchFailedMessage(code: string): string {
  const bounded = /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : 'unknown';
  return `Could not search Twilio right now (${bounded}) — nothing was bought. Try again in a moment.`;
}

/**
 * THE PURCHASE MAY HAVE GONE THROUGH (CR-01) — a timeout, a reset or a provider
 * 5xx after the create left. The sentence says exactly that, because "nothing
 * was bought, search again" here is how a second number gets bought.
 */
export function divertOutcomeUnknownMessage(code: string): string {
  const bounded = /^[a-z0-9_]{1,32}$/.test(code) ? code : 'unknown';
  return `Twilio did not answer clearly (${bounded}) — the purchase may have gone through. Do not buy a number for this client anywhere else. Wait 10 minutes, then Find and Buy here again: it checks Twilio for this client's number first and records it instead of buying (docs/telephony-runbook.md).`;
}

/** The adopt path found the earlier purchase and recorded it. */
export function divertAdoptedMessage(numberE164: string): string {
  return `Found ${numberE164} already bought for this client on Twilio and recorded it — nothing new was bought. Give the client this number for their divert.`;
}

/** The account could not be searched for an earlier purchase, so nothing was bought. */
export function divertLookupFailedMessage(code: string): string {
  const bounded = /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : 'unknown';
  return `Could not check Twilio for an earlier purchase (${bounded}) — nothing was bought. Try again in a moment.`;
}

/**
 * How long a pending claim stands before the console offers to recover it
 * (WR-07). The SAME ten minutes as the core's `DIVERT_HOLD_MS` — pinned equal by
 * the provision suite — restated here because a client component cannot import
 * the provisioning core.
 */
export const DIVERT_STALE_CLAIM_MINUTES = 10;

/** A fresh pending claim: a purchase in flight, with its age. */
export function divertClaimInProgressMessage(minutes: number | null): string {
  const age =
    minutes === null ? '' : minutes < 1 ? ' — claimed under a minute ago' : ` — claimed ${minutes} min ago`;
  return `Purchase in progress${age}. Reload in a moment. If it is still here after ${DIVERT_STALE_CLAIM_MINUTES} minutes, Find and Buy will check Twilio for this client's number and recover it.`;
}

/** A stale pending claim (WR-07): nobody is still buying on it. */
export function divertStaleClaimMessage(minutes: number): string {
  return `A purchase claimed ${minutes} min ago never finished. It may or may not have bought a number — do not buy one for this client anywhere else. Find and Buy below check Twilio for this client's number first and record it instead of buying.`;
}

/** The console's standing sentence for a held row (CR-01). */
export const DIVERT_HELD_MESSAGE =
  'The last purchase timed out or Twilio answered with an error — it may have gone through. Do not buy a number for this client anywhere else. Find and Buy below check Twilio for this client\'s number first and record it instead of buying; if none is there, a new purchase is allowed 10 minutes after the attempt.';

/**
 * WR-09 (F-11-07-2): the number is bought and recorded, but after the attach and
 * read-back Twilio still does not show the AU regulatory bundle on it. Shown
 * after the purchase and, from the stored `bundle_unattached` code, on the
 * active section until the row changes — worded to stay true after the founder
 * has attached it by hand.
 */
export const DIVERT_BUNDLE_UNATTACHED_MESSAGE =
  'Twilio did not show the AU regulatory bundle on this number when it was bought — an unattached regulated number can be reclaimed. Confirm the bundle is attached in the Twilio Console (Phone Numbers → the number → Regulatory) before the client sets the divert; see docs/telephony-runbook.md §5.';

export const DIVERT_ORPHANED_MESSAGE =
  'The number was bought but could not be recorded — do not buy again; attach the PN sid from the Vercel log by hand (see docs/telephony-runbook.md).';

export const DIVERT_SPOKEN_NAME_MESSAGE =
  "Spoken name: 1–60 characters, at most 6 words — what Olivia should say after 'you've reached'.";

export const DIVERT_SPOKEN_NAME_SAVED_MESSAGE =
  'Saved. The greeting says the new name from the next call.';

/** Nothing to rename: no row exists yet. */
export const DIVERT_SPOKEN_NAME_NO_NUMBER_MESSAGE =
  'There is no divert number for this client yet — the spoken name is set when you buy one.';

export const DIVERT_WRITE_FAILED_MESSAGE =
  'Could not save that — nothing changed. Try again in a moment.';

/** A forged or stale second tap. */
export const DIVERT_CONFIRM_MESSAGE =
  'Find a number first, then confirm the one shown — nothing was bought.';
