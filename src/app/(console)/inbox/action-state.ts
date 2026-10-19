/**
 * Action state shape + blank initial value for the inbox mark-handled form.
 *
 * Lives OUTSIDE actions.ts because a `'use server'` module may export only async
 * functions — a const export is a module-evaluation error under Turbopack
 * (nextjs.org/docs/messages/invalid-use-server-value). Same split, and the same
 * reason, as `clients/[id]/action-state.ts`.
 */

export type TriageState = {
  /** A failure the operator can act on. Fixed sentences only — never a db error. */
  error: string | null;
  /** Confirmation copy. `null` on the initial render, not an empty string. */
  success: string | null;
};

export const BLANK_TRIAGE_STATE: TriageState = { error: null, success: null };

/**
 * The create-ServiceM8-job sheet (Phase 14, D-01, D-04). Same shape as the
 * triage state; `success` is set for `created` alone.
 */
export type CreateJobState = {
  /** A fixed sentence from `CREATE_JOB_SENTENCES` — never a driver or provider message. */
  error: string | null;
  success: string | null;
};

export const BLANK_CREATE_JOB_STATE: CreateJobState = { error: null, success: null };

/**
 * Every answer `createJobForLead` can give, in fixed words — keyed by each
 * `CreateJobResult` kind and by `failed:<kind>` for every member of
 * `LEAD_JOB_ERROR_KINDS` (tests/create-job-action.test.ts pins the key set
 * against the schema's list). The keys are string literals because this
 * module imports nothing: the sheet is a `'use client'` component and the
 * vocabulary's home reaches Postgres (tests/lint-ban.test.ts).
 *
 * A map, not a `.replace('_', ' ')`: a new kind with no sentence must fail
 * the pin, not ship as snake_case on the operator's phone.
 */
export const CREATE_JOB_SENTENCES: Record<string, string> = {
  created: 'ServiceM8 job created and read back. The lead is now converted.',
  already_in_progress: 'A job is already being created for this lead. Refresh in a moment.',
  already_created: 'A ServiceM8 job already exists for this lead.',
  not_open: 'This lead is no longer open.',
  no_reply: 'This lead has no reply yet, so there is nothing to put in a job.',
  thread_changed: 'The thread changed — review the preview again.',
  not_connected: 'This client has no ServiceM8 connection.',
  connection_paused: "This client's ServiceM8 connection is paused. Fix the connection first.",
  'failed:auth_failed':
    "ServiceM8 rejected the client's API key. Nothing was created — re-key the connection and retry.",
  'failed:rate_limited': 'ServiceM8 is busy. Retry in a minute.',
  'failed:server_error':
    'Could not reach ServiceM8, or it returned an error. Retry — anything already created is reused, never duplicated.',
  'failed:network_error':
    'Could not reach ServiceM8, or it returned an error. Retry — anything already created is reused, never duplicated.',
  'failed:parse_error':
    'ServiceM8 returned data in an unexpected shape. Retry; if it fails again this needs a developer.',
  'failed:bad_request':
    'ServiceM8 refused the request. Retry; if it fails again this needs a developer.',
  'failed:connection_paused':
    "This client's ServiceM8 connection is paused. Fix the connection first, then retry.",
  'failed:not_connected': 'This client has no ServiceM8 connection. Connect it first, then retry.',
  'failed:readback_mismatch':
    'The job could not be verified after creation. Retry — an existing job is adopted, never duplicated.',
  'failed:stale_claim':
    'The last attempt stopped before it finished. Retry — anything already created is reused, never duplicated.',
  // 2026-10 (Phase 15, D-08a; 14-REVIEW WR-02): the adopted job is already
  // another lead's created job; the linkage was cleared, so a retry creates fresh.
  'failed:job_linked_elsewhere':
    'That ServiceM8 job already belongs to another lead. Retry — a fresh job will be created.',
};

/** The fallback for a key the map does not know — fixed words, never the key itself. */
export const CREATE_JOB_UNKNOWN_SENTENCE =
  'The job could not be created. Retry; if it fails again this needs a developer.';
