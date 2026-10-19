'use client';

import { useActionState } from 'react';

import { BLANK_DRAFTING_STATE, type DraftingState } from './action-state';
import { attestTemplateApproval, saveTemplateVersion, saveVoiceProfile } from './actions';

/**
 * The onboarding controls, as the operator's thumb meets them.
 *
 * This whole screen is filled in ON A PHONE, usually while the tradie is on the
 * other end of a call reading their own old messages out. So: full-width fields,
 * real keyboards (`inputMode`), no multi-column layout, and `useActionState`
 * throughout — a rejected submission comes back with the operator's typing
 * intact rather than a redirect that throws away three example messages they
 * transcribed by hand.
 *
 * `defaultValue` rather than controlled inputs: this is a form, not an editor,
 * and the server render is the source of truth for what is stored.
 */

function Feedback({ state }: { state: DraftingState }) {
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

export interface VoiceProfileValues {
  greetingStyle: string | null;
  signOff: string | null;
  formality: string | null;
  bannedPhrases: string[] | null;
  exampleMessages: string[] | null;
  voiceNotes: string | null;
}

/**
 * The D-05 voice profile.
 *
 * ── THREE EXAMPLE BOXES, AND THEY ARE THE POINT OF THE FORM ─────────────────
 *
 * The structured fields make review fast; the examples carry the voice. A
 * register is easier to SHOW than to describe, and "2-3 real messages in the
 * tradie's own words" is what the onboarding conversation actually collects —
 * so the examples get the most room, the loosest constraints and a hint that
 * says to paste rather than to compose.
 *
 * NOTHING IS REQUIRED. An operator between meetings saves what they have; the
 * drafting pass refuses on its own terms if the profile is too thin.
 */
export function VoiceProfileForm({
  tenantId,
  values,
}: {
  tenantId: string;
  values: VoiceProfileValues;
}) {
  const [state, formAction, pending] = useActionState(
    saveVoiceProfile.bind(null, tenantId),
    BLANK_DRAFTING_STATE,
  );

  // Always three boxes, whatever is stored — an operator adding a third example
  // should not have to work out how to make a field appear.
  const examples = [0, 1, 2].map((index) => values.exampleMessages?.[index] ?? '');

  return (
    <form action={formAction}>
      <Feedback state={state} />

      <label htmlFor="greeting_style">Greeting</label>
      <input
        id="greeting_style"
        name="greeting_style"
        type="text"
        maxLength={500}
        defaultValue={values.greetingStyle ?? ''}
        placeholder="Hi Sarah — / Hey mate,"
      />
      <p className="hint muted">How they open. Copy the way they actually type it.</p>

      <label htmlFor="sign_off">Sign-off</label>
      <input
        id="sign_off"
        name="sign_off"
        type="text"
        maxLength={500}
        defaultValue={values.signOff ?? ''}
        placeholder="Cheers, Mick"
      />
      <p className="hint muted">
        How they close. Not the opt-out line — that is added by us and is not theirs.
      </p>

      <label htmlFor="formality">Formality</label>
      <input
        id="formality"
        name="formality"
        type="text"
        maxLength={500}
        defaultValue={values.formality ?? ''}
        placeholder="casual, no jargon"
      />
      <p className="hint muted">Free text — it goes into the prompt, it is not a setting.</p>

      <label htmlFor="banned_phrases">Words they would never say</label>
      <textarea
        id="banned_phrases"
        name="banned_phrases"
        rows={4}
        defaultValue={(values.bannedPhrases ?? []).join('\n')}
        placeholder={'reach out\ntouch base\nsolutions'}
      />
      <p className="hint muted">
        One per line, up to twenty. Fed to the model as a prohibition — you still catch a survivor
        at the review gate, so this is taste, not safety.
      </p>

      <fieldset>
        <legend>Example messages</legend>
        <p className="hint muted">
          Two or three real messages this tradie has actually sent. This is the highest-signal
          thing on the page — paste them, do not write them.
        </p>
        {examples.map((example, index) => (
          <textarea
            // The index IS the identity here: three fixed boxes that never
            // reorder, all submitted under one name so the action can count them.
            key={`example-${index}`}
            name="example_message"
            rows={3}
            maxLength={480}
            defaultValue={example}
            aria-label={`Example message ${index + 1}`}
            placeholder={index === 0 ? 'Gday Sarah, just following up on that quote…' : ''}
          />
        ))}
      </fieldset>

      <label htmlFor="voice_notes">Anything else the model should know</label>
      <textarea
        id="voice_notes"
        name="voice_notes"
        rows={3}
        maxLength={500}
        defaultValue={values.voiceNotes ?? ''}
      />

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save voice profile'}
      </button>
    </form>
  );
}

/**
 * Author (or reword) one touch's SMS template — D-04, D-08.
 *
 * ── THE BOX IS PRE-FILLED WITH THE CURRENT WORDING, DELIBERATELY ────────────
 *
 * Rewording touch 3 is an EDIT, and an empty box asks the operator to retype
 * something that already exists — on a phone, from memory, which is how a
 * carefully-agreed sentence loses a word. Submitting it unchanged is refused
 * server-side as a no-change save, so the pre-fill cannot mint a duplicate
 * version.
 *
 * ── THERE IS NO CHANNEL PICKER, AND THAT IS D-04 ────────────────────────────
 *
 * v1 onboarding requires the five SMS templates and nothing else. The hidden
 * `sms` is a statement of what this form authors; the action refuses anything
 * else regardless of what a body claims.
 */
export function TemplateVersionForm({
  tenantId,
  touchNumber,
  currentBody,
}: {
  tenantId: string;
  touchNumber: number;
  currentBody: string;
}) {
  const [state, formAction, pending] = useActionState(
    saveTemplateVersion.bind(null, tenantId),
    BLANK_DRAFTING_STATE,
  );

  const fieldId = `template-body-${touchNumber}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="touch_number" value={touchNumber} />
      <input type="hidden" name="channel" value="sms" />
      <Feedback state={state} />

      <label htmlFor={fieldId}>Touch {touchNumber} wording</label>
      <textarea
        id={fieldId}
        name="body"
        rows={4}
        required
        maxLength={480}
        defaultValue={currentBody}
        placeholder="Following up on the quote — is there anything you wanted changed?"
      />
      <p className="hint muted">
        The SHAPE of the message, not the message. Claude rewrites it per quote in this
        client&rsquo;s voice, with the price, the date and the customer&rsquo;s name injected from
        the job — never invented, and proven against the source before an operator sees it.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : `Save as new version`}
      </button>
    </form>
  );
}

/**
 * The attestation (D-06) — and the write that can open the activation gate.
 *
 * ── THE NOTE IS THE CONFIRMATION STEP ───────────────────────────────────────
 *
 * The kill switch uses arm-then-confirm because it is one tap from permanent.
 * This control does not, because it already has a better one: it cannot be
 * submitted without the operator TYPING how the client approved. That is a
 * deliberation an arm-then-confirm pattern only simulates — and unlike a second
 * tap, what they type is kept as the evidence.
 *
 * WRITE-ONCE. There is no un-approve here or anywhere: re-recording an
 * attestation would destroy the thing it is evidence of.
 */
export function AttestApprovalForm({
  tenantId,
  versionId,
  touchNumber,
  version,
}: {
  tenantId: string;
  versionId: string;
  touchNumber: number;
  version: number;
}) {
  const [state, formAction, pending] = useActionState(
    attestTemplateApproval.bind(null, tenantId),
    BLANK_DRAFTING_STATE,
  );

  const fieldId = `approval-note-${touchNumber}-${version}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="version_id" value={versionId} />
      <Feedback state={state} />

      <label htmlFor={fieldId}>How did the client approve this?</label>
      <input
        id={fieldId}
        name="approval_note"
        type="text"
        required
        maxLength={500}
        placeholder="Approved by email 30/8 / read back on the phone"
      />
      <p className="hint muted">
        Kept as the record that they did. It cannot be edited afterwards — an attestation that can
        be rewritten is not evidence of anything.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? 'Recording…' : `Client approved version ${version}`}
      </button>
    </form>
  );
}
