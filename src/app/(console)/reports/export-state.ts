/**
 * The design-partner export island's words and state (Phase 15, RPT-05 /
 * D-04; UI-SPEC §3a).
 *
 * A LEAF. IT IMPORTS NOTHING. The island that reads it is `'use client'`, and
 * this directory's other files reach the repository barrel — the shortest
 * path from `postgres` into the browser bundle is a convenient re-export
 * here (`tests/lint-ban.test.ts` CLIENT_REACHABLE). It also has to be a
 * sibling rather than part of the action module: a `'use server'` file may
 * export only async functions.
 */

export const EXPORT_LABEL = 'Export design-partner CSV';
export const EXPORT_PENDING_LABEL = 'Exporting…';
export const EXPORT_EMPTY_MESSAGE = 'Nothing to export yet — the file has its header row only.';
export const EXPORT_FAILED_MESSAGE = 'Could not export the CSV. Try again in a moment.';

export const EXPORT_HINT =
  'One row per client per month: missed calls, after-hours share, text-back speed, reply rate and ' +
  'leads → jobs, each with its denominator. Client names only — no phone numbers, no message ' +
  'bodies, no caller details of any kind.';

/** `backdesk-design-partner-stats-{YYYY-MM-DD}.csv` — the date is the operator's, UTC. */
export const EXPORT_FILENAME_PREFIX = 'backdesk-design-partner-stats-';

export function exportedMessage(rows: number, filename: string): string {
  return `Exported ${rows} row${rows === 1 ? '' : 's'} as ${filename}.`;
}

/** What the export action returns to the island. All null until it answers. */
export interface ExportState {
  csv: string | null;
  filename: string | null;
  rows: number | null;
  error: string | null;
}

export const BLANK_EXPORT_STATE: ExportState = { csv: null, filename: null, rows: null, error: null };
