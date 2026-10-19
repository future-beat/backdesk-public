'use server';

import { revalidatePath } from 'next/cache';

import {
  approvalChangedState,
  approvalControlState,
  BAD_REQUEST_MESSAGE,
  BLANK_CONTROL_STATE,
  type ControlState,
  draftIdsSchema,
  editedBodySchema,
  SESSION_EXPIRED_MESSAGE,
  UNKNOWN_QUOTE_MESSAGE,
} from '@/app/(console)/components/action-state';
import { approveUnchanged, editThenApprove } from '@/core/approval/approve-draft';
import { forTenant } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { requireOperator } from '../_auth';
import { skipControlState, type SkipOutcome, skipTouchSchema } from './action-state';

export type { ControlState };

/**
 * THE CROSS-CLIENT APPROVAL ACTIONS (CON-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY EXPORT BELOW IS A GLOBALLY-POSTABLE ENDPOINT. Server Action ids    │
 * │ are global: either of these can be invoked by POSTing its id to ANY      │
 * │ route, including one the proxy never sees, and the (console) layout's    │
 * │ own gate runs when a LAYOUT renders — which is after the action has      │
 * │ finished.                                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So both open with `authorize(tenantId)` BEFORE reading a byte of `formData`
 * (WR-01), and both then delegate to `src/core/approval/approve-draft.ts` — the
 * SAME core the quote page's two actions call. Nothing about which draft may be
 * approved, which whitelist judges an edit, or what `edit_distance` records is
 * decided in this file. That is the whole reason the core was extracted before
 * this surface existed (the CR-02 lesson).
 *
 * ── TWO GATES, AND NEITHER IS REDUNDANT ─────────────────────────────────────
 *
 * `requireOperator()` answers "may this session use a CROSS-CLIENT surface at
 * all" — the same question the queue page and the inbox ask, because a session
 * proves somebody signed in, not that they may see a stranger's customers'
 * messages (CR-01).
 *
 * The RLS-scoped `tenants` read answers a narrower one: "may this caller act for
 * THIS client". It is made with the operator's OWN JWT, so Postgres decides
 * membership rather than this file, and a tenant they are not on returns zero
 * rows — indistinguishable from one that does not exist. That matters because
 * the core writes through the service-role repository, where RLS is inert by
 * design (T-6-01).
 *
 * It also returns the two facts the edit path needs — the client's business name
 * (the Spam Act suffix an edited body must still end with) and their timezone
 * (the zone the quote date in the fact whitelist was rendered in) — from the
 * read that PROVED the caller is entitled to them, rather than from a second
 * read that assumed it. Same argument the quote page's `authorize` makes.
 *
 * ── NO BATCH PATH EXISTS, ANYWHERE (D-03, one-way) ──────────────────────────
 *
 * Both actions take ONE `draft_id` and ONE `touch_id`, parsed by a schema with
 * no array arm. There is no select-all, no approve-all and no form input that
 * accepts multiple ids — not because the UI omits one, but because nothing here
 * could consume it. Batch approval is a V2-01 graduated-autonomy policy gated on
 * edit-rate data; adding it is a product decision, not a UX tweak.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cleared caller, with the tenant facts the gate's own read already holds. */
type Authorized =
  | { ok: true; name: string; timezone: string }
  | { ok: false; state: ControlState };

function denied(message: string): { ok: false; state: ControlState } {
  return { ok: false, state: { ...BLANK_CONTROL_STATE, error: message } };
}

async function authorize(tenantId: string): Promise<Authorized> {
  if (!UUID_PATTERN.test(tenantId)) {
    return denied(UNKNOWN_QUOTE_MESSAGE);
  }

  const access = await requireOperator();
  if (access === 'unauthenticated') return denied(SESSION_EXPIRED_MESSAGE);
  if (access !== 'ok') return denied(UNKNOWN_QUOTE_MESSAGE);

  const supabase = await createClient();

  // THE OPERATOR'S OWN JWT, so Postgres decides membership rather than this
  // file. A tenant they are not on returns zero rows.
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

/**
 * Every page that could be showing this draft when the action lands.
 *
 * The queue is the surface the operator is looking at; the quote page and the
 * client page render the same touch's state, and an operator who taps through
 * to a quote seconds later must not find the card they just cleared still
 * offering an approve button.
 *
 * ── ALL THREE PATHS, INCLUDING THE QUOTE (WR-04) ────────────────────────────
 *
 * The sentence above names the quote page as the whole reason this function
 * exists, and the body used to revalidate only `/queue` and `/clients/{id}` —
 * so the one surface the comment argued about was the one left stale. The quote
 * page's own `revalidateBoth` has always revalidated all three; two surfaces
 * clearing different sets of paths after the SAME write is the drift class this
 * phase is structured to prevent, and a comment asserting a behaviour the code
 * does not have is worse than either half.
 *
 * `quoteId` is bound onto the action from the row the server read returned, the
 * same way `tenantId` is — never submitted in the form.
 *
 * A LEAD ROW (Phase 13) has no quote: its actions are bound to a NULL quote id
 * and pass the empty string here, which the UUID guard below skips — so the
 * queue and the client page are revalidated and no `/quotes/null` path is
 * ever built.
 */
function revalidateQueue(tenantId: string, quoteId: string): void {
  revalidatePath('/queue');
  // A revalidation key is not somewhere to interpolate an unvalidated string —
  // and this id was uuid-checked by `authorize` before anything else ran.
  revalidatePath(`/clients/${tenantId}`);
  // The same rule for the second id, which `authorize` never sees. A bound
  // argument is signed by the framework and cannot be forged from a form, so
  // this is defence in depth rather than the gate — but a bad interpolation
  // here would surface as a cache key nobody can explain.
  if (UUID_PATTERN.test(quoteId)) {
    revalidatePath(`/clients/${tenantId}/quotes/${quoteId}`);
  }
}

/**
 * Approve a draft EXACTLY as written, from the queue (D-12).
 *
 * An already-approved draft reports SUCCESS, not an error: two taps from a phone
 * on a patchy connection reach here, the core's guard refuses the second write,
 * and nothing went wrong. The shared `approvalControlState` mapping is what makes
 * that answer identical to the quote page's.
 */
export async function approveFromQueue(
  tenantId: string,
  quoteId: string | null,
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

  if (approvalChangedState(result)) revalidateQueue(tenantId, quoteId ?? '');
  return approvalControlState(result);
}

/**
 * THE OPERATOR'S OWN SKIP — terminal, for ONE touch (CON-01, D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS NOT A DEFER, AND THERE IS NO DEFER. A skipped touch never sends; │
 * │ the cadence's later touches are untouched and carry on. Anything else    │
 * │ would need a second schedule authority, and D-09/D-10's re-window pass   │
 * │ is the only one.                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Same WR-01 discipline as the two approvals above: `authorize(tenantId)` — the
 * cross-client operator gate AND the RLS-scoped membership read, with the
 * caller's own JWT — before a byte of `formData` is read, then one zod-checked
 * uuid, then a write scoped to `forTenant(the authorized tenant)`.
 *
 * ── ZERO ROWS IS REPORTED HONESTLY, NEVER AS SUCCESS (Pitfall 3, T-6-09) ────
 *
 * `skipPendingWhere` is guarded on equality with the two unapproved statuses, so
 * a card rendered ninety seconds ago cannot skip a touch a colleague approved in
 * between. When it moves nothing, this re-reads the touch and says which thing
 * actually happened to it. Reporting a skip that did not occur is the failure
 * this whole shape exists to prevent: the operator would walk away believing a
 * message is stopped while it sits approved and scheduled.
 */
export async function skipFromQueue(
  tenantId: string,
  quoteId: string | null,
  _previous: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = skipTouchSchema.safeParse({
    touch_id: String(formData.get('touch_id') ?? ''),
  });
  if (!parsed.success) return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };

  const touchId = parsed.data.touch_id;
  const touches = forTenant(tenantId).touches;

  let outcome: SkipOutcome;
  try {
    const moved = await touches.skipPendingWhere([touchId]);

    if (moved.length > 0) {
      outcome = { kind: 'skipped' };
    } else {
      // THE RE-READ. Scoped to the authorized tenant, so another client's touch
      // id is `null` here exactly as it was zero rows above — the refusal is not
      // an existence oracle over somebody else's schedule.
      const current = await touches.statusOf(touchId);
      outcome =
        current === null ? { kind: 'not_found' } : { kind: 'stale', status: current.status };
    }
  } catch {
    // The caught value is DISCARDED (WR-08, T-2-16): a postgres error from this
    // statement carries the predicate, and the predicate names the touch. The
    // operator can act on none of it, and the dull sentence is the honest one.
    console.error('[queue] skip write failed');
    return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };
  }

  if (outcome.kind === 'skipped') revalidateQueue(tenantId, quoteId ?? '');
  return skipControlState(outcome);
}

/**
 * Approve the operator's REWRITE of a draft, from the queue (D-11, D-12, AI-04).
 *
 * The edited bytes cross the trust boundary again and are re-validated against
 * the whitelist rebuilt at the draft's own merge instant — in the core, so this
 * surface cannot be the one where that check is missing (T-5-26, T-6-03).
 */
export async function editAndApproveFromQueue(
  tenantId: string,
  quoteId: string | null,
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

  if (approvalChangedState(result)) revalidateQueue(tenantId, quoteId ?? '');
  return approvalControlState(result);
}
