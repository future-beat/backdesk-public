'use client';

import { useActionState } from 'react';

import { convertProspectAction } from './actions';
import { BLANK_CONVERT_STATE } from './action-state';

export interface ConvertTarget {
  id: string;
  name: string;
  /** Already linked to some prospect — offered, but not selectable. */
  linked: boolean;
}

/**
 * Link this prospect to the client they became (D-02).
 *
 * SCREEN ONLY — `audit.css` hides every form under `@media print`. This is
 * operator machinery and the printed sheet is a document handed to a prospect;
 * a dropdown of the founder's other clients has no business on it.
 *
 * Already-linked clients are rendered DISABLED rather than filtered out. A
 * client silently missing from the list looks like a bug and sends the operator
 * looking for it; a client visibly present and unselectable, labelled with why,
 * answers the question on the screen where it is asked.
 */
export function ConvertForm({
  prospectId,
  targets,
}: {
  prospectId: string;
  targets: ConvertTarget[];
}) {
  const [state, formAction, pending] = useActionState(convertProspectAction, BLANK_CONVERT_STATE);

  if (targets.length === 0) {
    return (
      <p className="muted hint">
        No clients yet. Create the client first, then come back here to link this audit to them.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="prospect_id" value={prospectId} />

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

      <label htmlFor="tenant_id">Client</label>
      <select id="tenant_id" name="tenant_id" defaultValue="">
        <option value="">Choose a client…</option>
        {targets.map((target) => (
          <option key={target.id} value={target.id} disabled={target.linked}>
            {target.name}
            {target.linked ? ' — already linked to an audit' : ''}
          </option>
        ))}
      </select>

      <button type="submit" disabled={pending}>
        {pending ? 'Linking…' : 'Link to client'}
      </button>
    </form>
  );
}
