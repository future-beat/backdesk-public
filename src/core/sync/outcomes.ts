/**
 * Human labels for the closed `sync_runs.outcome` vocabulary (T-2-16).
 *
 * WHY THIS IS A MAP AND NOT A `.replace('_', ' ')` AT EACH RENDER SITE: the
 * strings below are the ONLY vocabulary permitted to leave the sync subsystem
 * and reach a human — an operator alert email and the console's sync-runs
 * table. Both are surfaces where a raw error string would be a credential leak
 * (a caught `fetch` rejection stringifies to a URL, and the one header on that
 * request is the client's ServiceM8 API key).
 *
 * Centralising them makes the rule checkable: "no raw error text in the email
 * body" is provable by showing the body is assembled from this map plus the
 * tenant name and a URL, and by nothing else. Two independent `.replace()`
 * calls at two render sites would make the same claim unprovable, and would
 * drift the moment one of them was "improved".
 *
 * The keys are exhaustive over `SyncOutcome` by type, so a sixth outcome added
 * to the vocabulary fails to compile here rather than rendering as `undefined`
 * in an email the operator is supposed to act on.
 *
 * `import type` only — this module is framework-free AND dependency-free at
 * runtime, so a React server component can import it without pulling drizzle
 * into the page's module graph for the sake of a string map.
 */
import type { SyncOutcome } from '@/db/schema';

/**
 * Copy is verbatim from the 02-UI-SPEC Copywriting Contract, row
 * "Error — sync run failure detail".
 */
export const SYNC_OUTCOME_LABELS: Readonly<Record<SyncOutcome, string>> = {
  ok: 'ok',
  auth_failed: 'auth failed',
  rate_limited: 'rate limited',
  server_error: 'server error',
  network_error: 'network error',
  parse_error: 'response parse error',
};

/**
 * The label for an outcome, or the literal string `unknown` for a value that
 * somehow escaped the vocabulary.
 *
 * The fallback is deliberately NOT the value itself. This function is called
 * with data read back out of Postgres, and echoing an unrecognised stored value
 * into an email or a rendered page is precisely the hole the CHECK constraint
 * and this map exist to close.
 */
export function syncOutcomeLabel(outcome: string | null): string {
  if (outcome === null) return 'unknown';
  return SYNC_OUTCOME_LABELS[outcome as SyncOutcome] ?? 'unknown';
}
