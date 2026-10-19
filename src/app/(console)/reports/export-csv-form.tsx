'use client';

/**
 * THE DESIGN-PARTNER EXPORT ISLAND (Phase 15, RPT-05, D-04; UI-SPEC §3a).
 *
 * VALUE IMPORTS: `react`, the action and its import-free leaf — nothing else.
 * This file is in `CLIENT_REACHABLE` (tests/lint-ban.test.ts): a value from the
 * database layer here would put `postgres` in the browser bundle.
 *
 * The action returns the CSV as a string; this island turns it into a Blob,
 * clicks a temporary `<a download>` and revokes the URL AFTER the download has
 * started — on a timer, never in the same tick as the click (15-REVIEW WR-06):
 * Safari (iOS included) and Firefox can cancel the download, or save an empty
 * file, when the URL is revoked before the browser has read the Blob, while
 * the status line still says the file was exported. No navigation, no
 * confirm — nothing is written and nothing leaves the operator's device unasked.
 *
 * The status line is in the tree FROM FIRST PAINT and empty until it speaks
 * (07-07 WR-01, the print button's live-region rule): a region inserted at the
 * moment it has something to say is not announced by every screen reader.
 */
import { useActionState, useEffect } from 'react';

import { exportDesignPartnerCsv } from './export-actions';
import {
  BLANK_EXPORT_STATE,
  EXPORT_EMPTY_MESSAGE,
  EXPORT_LABEL,
  EXPORT_PENDING_LABEL,
  exportedMessage,
} from './export-state';

/** How long the Blob URL outlives the click (15-REVIEW WR-06). */
const REVOKE_AFTER_MS = 10_000;

export function ExportCsvForm() {
  const [state, formAction, pending] = useActionState(exportDesignPartnerCsv, BLANK_EXPORT_STATE);

  // KEYED ON THE RESULT OBJECT, not on `[state.csv, state.filename]`: a second
  // press on the same day with nothing new frozen returns byte-identical
  // strings, and an effect keyed on them would not re-run — the operator would
  // press and get no file. Every completed action is a new state object.
  useEffect(() => {
    if (typeof state.csv !== 'string' || state.filename === null) return;

    const url = URL.createObjectURL(new Blob([state.csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = state.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked once the navigation has started, not before (WR-06). The
    // cleanup covers the next export and an unmount: the timer is cleared and
    // the URL revoked then, so no Blob outlives the island.
    const timer = setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [state]);

  let status = '';
  if (state.error === null && state.rows !== null && state.filename !== null) {
    status = state.rows === 0 ? EXPORT_EMPTY_MESSAGE : exportedMessage(state.rows, state.filename);
  }

  return (
    <form action={formAction}>
      <div className="controls">
        <button type="submit" disabled={pending}>
          {pending ? EXPORT_PENDING_LABEL : EXPORT_LABEL}
        </button>
      </div>

      <p className="muted" role="status">
        {status}
      </p>

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
