'use client';

import { useActionState } from 'react';

import {
  BLANK_TEXT_BACK_STATE,
  NEVER_TEXT_KIND_LABEL,
  NEVER_TEXT_LABEL_FIELD_MAX,
  NEVER_TEXT_NUMBER_FIELD_MAX,
  TEXT_BACK_BODY_FIELD_MAX,
  TEXT_BACK_NOTE_MAX,
  type TextBackState,
} from './action-state';
import {
  addNeverTextNumberAction,
  attestTextBackTemplateAction,
  removeNeverTextNumberAction,
  saveTextBackTemplateAction,
} from './actions';

/**
 * The text-back controls, as the operator's thumb meets them (Phase 12).
 *
 * Filled in during an onboarding call, on a phone: one column, full-width
 * fields, real keyboards, and `useActionState` so a refused wording comes back
 * with the operator's typing intact.
 *
 * PLAIN PROPS, NOTHING DERIVED. Every value here — the pre-filled wording, the
 * version and its segment count, whether it is attested — was read and decided
 * on the server. The only value imports are the sibling leaf `action-state.ts`
 * and the actions; `tests/lint-ban.test.ts` pins this file against a value
 * import from `@/db/*`.
 */

function Feedback({ state }: { state: TextBackState }) {
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

/**
 * One wording: the textarea and "Save version". Saving is NOT attesting — the
 * saved version is not in use until the form beneath it is submitted.
 */
export function TextBackTemplateForm({
  tenantId,
  variant,
  label,
  body,
}: {
  tenantId: string;
  variant: string;
  label: string;
  body: string;
}) {
  const [state, formAction, pending] = useActionState(
    saveTextBackTemplateAction.bind(null, tenantId),
    BLANK_TEXT_BACK_STATE,
  );

  const fieldId = `text-back-body-${variant}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="variant" value={variant} />
      <Feedback state={state} />

      <label htmlFor={fieldId}>{label} wording</label>
      <textarea
        id={fieldId}
        name="body"
        rows={6}
        required
        maxLength={TEXT_BACK_BODY_FIELD_MAX}
        defaultValue={body}
      />
      <p className="hint muted">
        Sent exactly as written — no AI, nothing filled in. It must name the business, say
        &ldquo;Reply STOP&rdquo;, carry backdesk.com.au/privacy and no other link, and fit in 2 text
        segments.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save version'}
      </button>
    </form>
  );
}

/**
 * THE WRITE-ONCE ATTESTATION (D-02). Rendered only beneath an UNATTESTED latest
 * version. The note is required and has no default: typing what was checked is
 * the deliberation, and what is typed is kept as the evidence. There is no
 * un-attest anywhere.
 */
export function AttestTextBackForm({
  tenantId,
  variant,
  versionId,
  version,
}: {
  tenantId: string;
  variant: string;
  versionId: string;
  version: number;
}) {
  const [state, formAction, pending] = useActionState(
    attestTextBackTemplateAction.bind(null, tenantId),
    BLANK_TEXT_BACK_STATE,
  );

  const fieldId = `text-back-note-${variant}-${version}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="version_id" value={versionId} />
      <Feedback state={state} />

      <label htmlFor={fieldId}>What did you check before attesting version {version}?</label>
      <input
        id={fieldId}
        name="attestation_note"
        type="text"
        required
        maxLength={TEXT_BACK_NOTE_MAX}
        autoComplete="off"
        placeholder="Read back to the client on the phone, 6/10"
      />
      <p className="hint muted">
        Attests version {version} as saved — save first if you changed the wording above. It cannot
        be edited or withdrawn afterwards.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? 'Recording…' : 'Attest this wording'}
      </button>
    </form>
  );
}

/** Add one number to the never-text list. */
export function NeverTextAddForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, pending] = useActionState(
    addNeverTextNumberAction.bind(null, tenantId),
    BLANK_TEXT_BACK_STATE,
  );

  return (
    <form action={formAction}>
      <Feedback state={state} />

      <label htmlFor="never-text-number">Number</label>
      {/* `inputMode="tel"` puts the number pad under the thumb. */}
      <input
        id="never-text-number"
        name="number"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        required
        maxLength={NEVER_TEXT_NUMBER_FIELD_MAX}
        placeholder="0412 345 678 or (08) 9123 4567"
      />

      <fieldset>
        <legend>Kind</legend>
        <label className="check">
          <input type="radio" name="kind" value="own_line" defaultChecked />
          {NEVER_TEXT_KIND_LABEL.own_line}
        </label>
        <label className="check">
          <input type="radio" name="kind" value="never_text" />
          {NEVER_TEXT_KIND_LABEL.never_text}
        </label>
      </fieldset>

      <label htmlFor="never-text-label">Label (optional)</label>
      <input
        id="never-text-label"
        name="label"
        type="text"
        autoComplete="off"
        maxLength={NEVER_TEXT_LABEL_FIELD_MAX}
        placeholder="Office line"
      />

      <button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add number'}
      </button>
    </form>
  );
}

/** One entry's Remove button. The armed-client refusal is the server's. */
export function NeverTextRemoveForm({ tenantId, entryId }: { tenantId: string; entryId: string }) {
  const [state, formAction, pending] = useActionState(
    removeNeverTextNumberAction.bind(null, tenantId),
    BLANK_TEXT_BACK_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="entry_id" value={entryId} />
      <Feedback state={state} />
      <button type="submit" className="button-quiet" disabled={pending}>
        {pending ? 'Removing…' : 'Remove'}
      </button>
    </form>
  );
}
