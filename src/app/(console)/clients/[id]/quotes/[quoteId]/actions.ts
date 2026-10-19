'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  approvalChangedState,
  approvalControlState,
} from '@/app/(console)/components/action-state';
import { approveUnchanged, editThenApprove } from '@/core/approval/approve-draft';
import {
  killContact,
  pauseClient,
  resumeCadence,
  resumeClient,
} from '@/core/cadence/controls';
import { createClient } from '@/lib/supabase/server';

import {
  BAD_REQUEST_MESSAGE,
  BLANK_CONTROL_STATE,
  type ControlState,
  draftIdsSchema,
  editedBodySchema,
  KILL_ALREADY_STOPPED_MESSAGE,
  KILL_NO_ADDRESSES_MESSAGE,
  KILL_NUMBER_RETIRED_MESSAGE,
  KILL_SUCCESS_MESSAGE,
  PAUSE_CLIENT_ALREADY_MESSAGE,
  PAUSE_CLIENT_SUCCESS_MESSAGE,
  RESUME_CADENCE_DEFERRED_MESSAGE,
  RESUME_CADENCE_NOT_PAUSED_MESSAGE,
  resumeCadenceGatedState,
  RESUME_CADENCE_SUCCESS_MESSAGE,
  RESUME_CLIENT_DEFERRED_MESSAGE,
  RESUME_CLIENT_NOT_PAUSED_MESSAGE,
  RESUME_CLIENT_SUCCESS_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  UNKNOWN_QUOTE_MESSAGE,
} from './action-state';

export type { ControlState };

/**
 * The D-16 kill switches, as server actions.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY EXPORT BELOW IS A GLOBALLY-POSTABLE ENDPOINT. Server Action ids are │
 * │ global: any of these can be invoked by POSTing its id to ANY route,       │
 * │ including one the proxy never sees, and the (console) layout's own gate    │
 * │ runs when a LAYOUT renders — which is after the action has finished.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So every one of them opens with `authorize(tenantId)` BEFORE reading a byte of
 * `formData` (WR-01), and the authorization is an RLS-scoped read made with the
 * OPERATOR'S OWN JWT. That read is the whole defence: the control functions in
 * `@/core/cadence/controls` write through the service-role repository path,
 * where RLS is inert by design, so without it any authenticated session could
 * kill or resume a cadence belonging to any client whose uuid they could guess
 * (threats T-3-18, T-3-19).
 *
 * ── THE RESUMES ARE THE SENSITIVE ONES, NOT THE KILL ────────────────────────
 *
 * The intuition runs the other way — the kill is irreversible, so surely it is
 * the dangerous one. But an unauthorized kill STOPS messages; an unauthorized
 * resume STARTS them, at a stranger's customers, in a tradie's name, possibly
 * at somebody who is mid-conversation. The gate is identical for all four
 * because it has to be, and the resumes are why it is not optional.
 *
 * ── SECOND LAYER: THE TENANT CLOSURE ────────────────────────────────────────
 *
 * Even a forged body naming another client's cadence id changes nothing, because
 * `forTenant(tenantId)` inside every control function scopes the read AND the
 * write on the tenantId this call authorized — `cadences.getById` returns `[]`
 * for a cadence belonging to anybody else, and the caller answers `no_cadence`.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ids these actions accept, and nothing that is not a uuid.
 *
 * Not politeness about shape: these values reach Postgres in a parameterised
 * predicate, and a non-uuid surfaces as a `22P02` thrown three layers below a
 * page the operator is looking at. Rejecting here names the failure where it
 * happened. The form can only ever submit the ids the page rendered — but the
 * action id is global and the body belongs to whoever POSTs it.
 */
const cadenceIdSchema = z.object({ cadence_id: z.uuid() });

/** A cleared caller, with the tenant facts the gate's own read already holds. */
type Authorized =
  | { ok: true; name: string; timezone: string }
  | { ok: false; state: ControlState };

function denied(message: string): { ok: false; state: ControlState } {
  return { ok: false, state: { ...BLANK_CONTROL_STATE, error: message } };
}

/**
 * Authentication AND authorization, in that order, both load-bearing.
 *
 * ── WHY IT RETURNS THE TENANT ROW RATHER THAN `null` FOR "CLEARED" ──────────
 *
 * The draft-approval actions need the client's BUSINESS NAME (the Spam Act
 * compliance suffix an edited body must still end with) and their TIMEZONE (the
 * zone the quote date in the fact whitelist was rendered in). Both are columns
 * of the row this gate is already selecting.
 *
 * The alternative was a second helper beside this one, and the reason not to is
 * the reason there is one gate at all: two authorization functions in one
 * `'use server'` module is how the fifth action added later gets the weaker one.
 * Returning the row costs nothing — it is the same query with two more columns —
 * and it makes the tenant facts arrive from the read that PROVED the caller is
 * entitled to them, rather than from a second read that assumed it.
 */
async function authorize(tenantId: string): Promise<Authorized> {
  if (!UUID_PATTERN.test(tenantId)) {
    return denied(UNKNOWN_QUOTE_MESSAGE);
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return denied(SESSION_EXPIRED_MESSAGE);
  }

  // THE OPERATOR'S OWN JWT, so Postgres decides membership rather than this
  // file. A tenant they are not on returns zero rows, indistinguishable from one
  // that does not exist.
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, timezone')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return denied(UNKNOWN_QUOTE_MESSAGE);
  }

  const row = tenant as { name: string; timezone: string };
  return { ok: true, name: row.name, timezone: row.timezone };
}

/** Read the cadence id out of a submitted form, or fail with fixed copy. */
function readCadenceId(formData: FormData): { ok: true; id: string } | { ok: false } {
  const parsed = cadenceIdSchema.safeParse({
    cadence_id: String(formData.get('cadence_id') ?? ''),
  });
  return parsed.success ? { ok: true, id: parsed.data.cadence_id } : { ok: false };
}

/**
 * Every page the operator could be looking at when one of these actions lands.
 *
 * The quote page shows the cadence's own state; the client page shows the
 * Follow-up glance column and the pause banner. A kill that refreshed only the
 * first would leave a stopped cadence reading `active` one tap back.
 *
 * ── AND `/inbox`, WHICH IS THIS ACTION'S SECOND CALLER ──────────────────────
 *
 * `inbox/suppress-contact-form.tsx` reuses `killContactAction` — the right call,
 * for the reason stated there. The revalidation set was not widened to match.
 * An operator suppressing a soft opt-out from the triage list got the success
 * sentence while the row kept its "Suppress this contact" affordance and the
 * cadence still read as live until they navigated away.
 *
 * On a scrolling list of rows about DIFFERENT customers, a control that still
 * looks actionable after acting is an invitation to tap a second time one row
 * down — which is precisely the mis-tap T-5-27 and the arm-then-confirm pattern
 * exist to prevent, and this one is irreversible.
 */
function revalidateBoth(tenantId: string, quoteId: string): void {
  // The quoteId is not an authorization input — it only names a path — but it
  // arrives from the same globally-POSTable call as everything else, and a
  // revalidation key is not somewhere to interpolate an unvalidated string.
  if (UUID_PATTERN.test(quoteId)) {
    revalidatePath(`/clients/${tenantId}/quotes/${quoteId}`);
  }
  revalidatePath(`/clients/${tenantId}`);
  // A static path with nothing interpolated — no validation to do, and nothing
  // a caller could steer.
  revalidatePath('/inbox');
}

/* ------------------------------------------------------------------------- *
 * killContactAction — D-06/D-15, no undo exists anywhere
 * ------------------------------------------------------------------------- */

/**
 * A NULL `quoteId` NAMES A LEAD REPLY (Phase 13, D-11): the inbox offers this
 * kill for a missed caller's soft opt-out, whose cadence has no quote. The
 * write is identical — authorize first, then `killContact` on the cadence id —
 * and `revalidateBoth` receives the empty string, which its UUID guard skips,
 * so no `/quotes/null` path is ever built.
 */
export async function killContactAction(
  tenantId: string,
  quoteId: string | null,
  _previous: ControlState,
  formData: FormData,
): Promise<ControlState> {
  // BEFORE the body is read, deliberately. There is nothing in `formData` worth
  // parsing for a caller who is not entitled to this client.
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const cadence = readCadenceId(formData);
  if (!cadence.ok) return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };

  const result = await killContact(tenantId, cadence.id);

  switch (result.kind) {
    case 'killed':
      revalidateBoth(tenantId, quoteId ?? '');
      return { ...BLANK_CONTROL_STATE, success: KILL_SUCCESS_MESSAGE };
    case 'already_stopped':
      // The suppression WAS written; only the stop was refused. The copy says
      // both, because "already stopped" alone would read as "nothing happened"
      // for an action whose whole point is that something permanent did.
      // (For a lead already closed `lead_closed`, the suppression still landed.)
      revalidateBoth(tenantId, quoteId ?? '');
      return { ...BLANK_CONTROL_STATE, success: KILL_ALREADY_STOPPED_MESSAGE };
    case 'no_addresses':
      return { ...BLANK_CONTROL_STATE, error: KILL_NO_ADDRESSES_MESSAGE };
    case 'number_retired':
      // 15-REVIEW CR-01: nothing was written — see the message.
      return { ...BLANK_CONTROL_STATE, error: KILL_NUMBER_RETIRED_MESSAGE };
    case 'no_cadence':
      return { ...BLANK_CONTROL_STATE, error: UNKNOWN_QUOTE_MESSAGE };
  }
}

/* ------------------------------------------------------------------------- *
 * pauseClientAction / resumeClientAction — D-06, reversible
 * ------------------------------------------------------------------------- */

/**
 * NOTE THE ABSENT PARAMETERS. `useActionState` calls its action with
 * `(previousState, formData)` and this one declares neither, because it has no
 * input: the client to pause is the argument the caller already bound and
 * already authorized. A declared-and-ignored `formData` would read as a body
 * this action might one day parse, and the WR-01 rule is precisely that nothing
 * in a body is worth parsing before the gate — so the honest shape is not to
 * accept one. JavaScript discards the extra arguments; the two actions with a
 * cadence id to read do declare them.
 */
export async function pauseClientAction(
  tenantId: string,
  quoteId: string,
): Promise<ControlState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  // No id to read: the pause is the client's, and the client is the argument
  // this call already authorized.
  const result = await pauseClient(tenantId, new Date());

  switch (result.kind) {
    case 'paused':
      revalidateBoth(tenantId, quoteId);
      return { ...BLANK_CONTROL_STATE, success: PAUSE_CLIENT_SUCCESS_MESSAGE };
    case 'already_paused':
      return { ...BLANK_CONTROL_STATE, success: PAUSE_CLIENT_ALREADY_MESSAGE };
  }
}

/**
 * Start a paused client's messaging again (D-06).
 *
 * THE MOST CONSEQUENTIAL OF THE FOUR. It does not spend money or change a
 * credential — it restarts real SMS to real customers of a real tradie whose
 * brand is on them, and it does so for every cadence the pause froze at once.
 * That is why the gate above it is the same one the re-key and triage actions
 * use, and why `resumeClient` routes through the guarded `resumeWherePaused`
 * plus the D-07 applier rather than writing a status directly (T-3-19).
 */
export async function resumeClientAction(
  tenantId: string,
  quoteId: string,
): Promise<ControlState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const result = await resumeClient(tenantId, new Date());

  switch (result.kind) {
    case 'resumed':
      revalidateBoth(tenantId, quoteId);
      return {
        ...BLANK_CONTROL_STATE,
        success: result.rewindowDeferred
          ? RESUME_CLIENT_DEFERRED_MESSAGE
          : RESUME_CLIENT_SUCCESS_MESSAGE,
      };
    case 'not_paused':
      return { ...BLANK_CONTROL_STATE, success: RESUME_CLIENT_NOT_PAUSED_MESSAGE };
  }
}

/* ------------------------------------------------------------------------- *
 * resumeCadenceAction — D-05's explicit human act
 * ------------------------------------------------------------------------- */

/**
 * Restart ONE paused sequence, including one paused because the customer
 * replied.
 *
 * D-05 says no automated resume after a live conversation; a human decides. This
 * action IS that decision, which is exactly why the authorization above it is
 * not a formality: without it, "only a human may restart this" would mean "only
 * an HTTP request may restart this".
 */
export async function resumeCadenceAction(
  tenantId: string,
  quoteId: string,
  _previous: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const cadence = readCadenceId(formData);
  if (!cadence.ok) return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };

  const result = await resumeCadence(tenantId, cadence.id, new Date());

  switch (result.kind) {
    case 'resumed':
      revalidateBoth(tenantId, quoteId);
      return {
        ...BLANK_CONTROL_STATE,
        success: result.rewindowDeferred
          ? RESUME_CADENCE_DEFERRED_MESSAGE
          : RESUME_CADENCE_SUCCESS_MESSAGE,
      };
    case 'onboarding_gated':
      // NOT an `error`: nothing failed and the operator did nothing wrong. The
      // gate is the product working (ONB-03/ONB-04). Revalidated so the page
      // re-renders with the cadence still visibly paused, which is the true
      // state. The sentence and the link come from the conditions the core
      // reported, so the refusal names what is ACTUALLY missing.
      revalidateBoth(tenantId, quoteId);
      return {
        ...BLANK_CONTROL_STATE,
        ...resumeCadenceGatedState(tenantId, result.conditions),
      };
    case 'not_paused':
      revalidateBoth(tenantId, quoteId);
      return { ...BLANK_CONTROL_STATE, success: RESUME_CADENCE_NOT_PAUSED_MESSAGE };
    case 'no_cadence':
      return { ...BLANK_CONTROL_STATE, error: UNKNOWN_QUOTE_MESSAGE };
  }
}

/* ========================================================================= *
 * THE D-12 APPROVAL GATE — approveDraft / editAndApproveDraft
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THESE TWO ACTIONS ARE THE ONLY WAY AI TEXT REACHES A CUSTOMER FROM THIS  │
 * │ PAGE. Dispatch refuses any touch without an approved draft               │
 * │ (`no_approved_draft`), the tick cannot write `approved`, and             │
 * │ `touches.approveWhere` is reached from exactly one place in the codebase │
 * │ — `src/core/approval/approve-draft.ts`, which is what both of these call.│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE RULES MOVED; THE GATE DID NOT (06-01) ───────────────────────────────
 *
 * Everything these two used to do themselves — the latest-attempt check, the
 * whitelist rebuilt at the draft's own merge instant, the compliance suffix read
 * off the row, the explicit `edit_distance = 0` — now lives in ONE core module,
 * because Phase 6 adds a second approval surface and a second correct copy is
 * exactly the structure that produced CR-02. What stays here is the half that
 * cannot move: the WR-01 authorization ordering, the form parsing, and the
 * revalidation of the pages THIS surface renders.
 *
 * ── WHAT IS APPROVED IS BYTES, NOT A DECISION (Pitfall 6) ───────────────────
 *
 * The core writes a `final_body` and dispatch sends THAT COLUMN verbatim.
 * Nothing recomposes a body at send time — not the compliance suffix, not a
 * merge field, not a re-render of the price. The operator approves the exact
 * string the customer receives, which is the only reading of "human approval"
 * that means anything.
 *
 * ── THE TWO ACTIONS ARE NOT THE SAME ACTION WITH A FLAG ─────────────────────
 *
 * `approveDraft` accepts a draft UNCHANGED. `editAndApproveDraft` accepts an
 * operator's REWRITE. They are separate exports — and the core keeps them as two
 * separate functions for the same reason — because the second one crosses the
 * trust boundary again (the edited bytes are re-validated with the rebuilt
 * whitelist, T-5-26) and the first one is refused outright on a
 * `validator_failed` attempt (D-11). Collapsing them into one export with an
 * optional body would make "was this text checked" depend on whether a field was
 * present in a globally-POSTable form.
 * ========================================================================= */

/**
 * Approve a draft EXACTLY as written (D-12), through the shared core.
 *
 * The `validator_failed` refusal, the superseded-attempt refusal and the
 * explicit AI-04 zero are all the core's — see its header. This function's own
 * contribution is the two things a core cannot do: prove the caller may act for
 * this client BEFORE reading a byte of `formData`, and re-render the pages that
 * were showing the draft.
 */
export async function approveDraft(
  tenantId: string,
  quoteId: string,
  _previous: ControlState,
  formData: FormData,
): Promise<ControlState> {
  // BEFORE the body is read, deliberately. There is nothing in `formData` worth
  // parsing for a caller who is not entitled to this client.
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const ids = draftIdsSchema.safeParse({
    draft_id: String(formData.get('draft_id') ?? ''),
    touch_id: String(formData.get('touch_id') ?? ''),
  });
  if (!ids.success) return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };

  const result = await approveUnchanged({
    // THE AUTHORIZED TENANT, never the one a form named.
    tenantId,
    touchId: ids.data.touch_id,
    draftId: ids.data.draft_id,
  });

  if (approvalChangedState(result)) revalidateBoth(tenantId, quoteId);
  return approvalControlState(result);
}

/**
 * Approve an operator's REWRITE of a draft (D-11, D-12, AI-04).
 *
 * The re-validation against the rebuilt whitelist, the frozen compliance suffix
 * and the edit-distance measurement are the core's. The `tenantName` and
 * `timezone` it needs arrive from the read that PROVED this caller is entitled
 * to this client — the same query, two more columns — rather than from a second
 * read that assumed it.
 */
export async function editAndApproveDraft(
  tenantId: string,
  quoteId: string,
  _previous: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const ids = draftIdsSchema.safeParse({
    draft_id: String(formData.get('draft_id') ?? ''),
    touch_id: String(formData.get('touch_id') ?? ''),
  });
  if (!ids.success) return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };

  const body = editedBodySchema.safeParse({
    edited_body: String(formData.get('edited_body') ?? ''),
  });
  if (!body.success) {
    return {
      ...BLANK_CONTROL_STATE,
      error: body.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE,
    };
  }

  const result = await editThenApprove({
    tenantId,
    touchId: ids.data.touch_id,
    draftId: ids.data.draft_id,
    editedBody: body.data.edited_body,
    tenantName: access.name,
    timezone: access.timezone,
  });

  if (approvalChangedState(result)) revalidateBoth(tenantId, quoteId);
  return approvalControlState(result);
}
