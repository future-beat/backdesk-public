'use client';

import { useActionState } from 'react';

import { ActionMessage } from '../../../components/action-message';

import { updateAuditRequestStatusAction } from './actions';
import { BLANK_CONTROL_STATE } from './action-state';

/** The four words, in the order the request moves through them (D-15). */
const STATUSES = ['new', 'contacted', 'audited', 'declined'] as const;

/**
 * The status control (UI-SPEC C-11).
 *
 * ── PLAIN PROPS, NO DATABASE MODULE ─────────────────────────────────────────
 *
 * The four statuses are SPELLED HERE rather than imported from the schema
 * module that declares them. That is the value/type asymmetry
 * `tests/lint-ban.test.ts` exists for: `AUDIT_REQUEST_STATUSES` is a VALUE in a
 * module that pulls in `drizzle-orm/pg-core`, and importing it from a
 * `'use client'` component is how `postgres` ends up in the browser bundle —
 * measured in 06-02 as four `Module not found` errors that named `fs`, `net`,
 * `tls` and `perf_hooks` and nothing about the form that caused them. The
 * action validates against the schema's own list; this component owns four
 * option labels.
 *
 * ── NO CONFIRMATION, BECAUSE NOTHING HERE IS DESTRUCTIVE (C-11) ─────────────
 *
 * Every status change is reversible by making the opposite one, so a dialog
 * would be a tap that teaches the operator to dismiss dialogs.
 */
export function StatusForm({ requestId, current }: { requestId: string; current: string }) {
  const [state, formAction, pending] = useActionState(
    updateAuditRequestStatusAction,
    BLANK_CONTROL_STATE,
  );

  return (
    <form action={formAction} className="row">
      <ActionMessage state={state} />

      <input type="hidden" name="request_id" value={requestId} />

      {/* `aria-label` rather than a visible `<label>`: the status is already
          named twice above this form — the badge beside the h1 and the word in
          the select itself — and a third "Status:" on a 390px row pushes the
          button onto its own line. The console's own convention for a control
          whose purpose is visible but whose name is not (`aria-label` on the
          scroll regions in clients/page.tsx and settings/email/page.tsx). */}
      <select
        id="request-status"
        name="status"
        aria-label="Status"
        defaultValue={current}
        disabled={pending}
      >
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>

      <button type="submit" className="button--secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Update status'}
      </button>
    </form>
  );
}
