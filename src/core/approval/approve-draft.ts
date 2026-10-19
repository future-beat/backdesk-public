/**
 * THE APPROVAL CORE — the one implementation of "an operator accepted this text".
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERYTHING BELOW USED TO LIVE INSIDE ONE SERVER-ACTION FILE, BESIDE THE  │
 * │ ONE SURFACE THAT CALLED IT. Phase 6 adds a SECOND approval surface (the  │
 * │ cross-client queue, CON-01), and the obvious way to build it — a second  │
 * │ correct copy of these rules — is exactly the shape that produced CR-02.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The CR-02 lesson, stated in STATE.md in the project's own words: "A second
 * correct copy would leave the exact structure that produced the bug, waiting
 * for the next payload surprise." The copies were correct when written; one was
 * widened when live data arrived and the other was not, and the surface that
 * silently kept the old rule reported success for months.
 *
 * So this module is extracted BEFORE the second surface exists, not after the
 * drift is found. Both `clients/[id]/quotes/[quoteId]/actions.ts` and
 * `queue/actions.ts` call these two functions and neither carries its own
 * latest-attempt check, its own whitelist rebuild, its own suffix resolution or
 * its own edit-distance write.
 *
 * ── FRAMEWORK-FREE, DELIBERATELY ────────────────────────────────────────────
 *
 * Nothing here imports from `next/*`. Two consequences, both wanted:
 *
 *   1. Revalidation is the CALLER's — each surface knows which paths it renders,
 *      and a core that guessed would either miss one or revalidate a route that
 *      does not exist on the other surface.
 *   2. COPY IS THE CALLER'S TOO. This module returns a discriminated union of
 *      OUTCOMES, never a sentence. The sentences live in
 *      `src/app/(console)/components/action-state.ts`, shared by both surfaces
 *      through one mapping function — because two surfaces answering a
 *      double-tap with different words is the same drift class in the DOM.
 *
 * ── AUTHORIZATION IS *NOT* HERE, AND THAT IS NOT AN OVERSIGHT ───────────────
 *
 * Every function below takes a `tenantId` it TRUSTS, and reads and writes
 * through `forTenant(tenantId)`. The proof that the caller may act for that
 * tenant is an RLS-scoped read made with the operator's OWN JWT, and it belongs
 * in the `'use server'` module where WR-01's before-any-formData ordering can be
 * asserted. A core that tried to authorize would have to be given a Supabase
 * client, which would make it a framework module wearing a core module's name.
 *
 * The rule for every caller: authorize FIRST, pass the AUTHORIZED tenant id, and
 * never the one the form supplied.
 */
import { complianceSuffix } from '@/core/cadence/sender';
import { normalizedEditDistance } from '@/core/drafting/edit-distance';
import { buildMergeFacts } from '@/core/drafting/merge-facts';
import { type DraftViolation, validateDraft } from '@/core/drafting/validate';
import { forTenant, type TenantScopedRepository } from '@/db/repository';

/**
 * RE-EXPORTED, not declared here — see `./limits.ts` for the number and for why
 * it moved. Short version: a client component needs this value, and reaching it
 * through this module put the `postgres` driver in the browser bundle and broke
 * `next build` with four `Module not found` errors that named `fs` and `tls`
 * rather than anything a reader would connect to an edit form's character cap.
 *
 * Every server-side caller keeps its existing import path.
 */
export { EDITED_BODY_MAX } from './limits';

/**
 * What happened, as a fact rather than as a sentence.
 *
 * Two of these are SUCCESSES that look like failures and are worth naming as
 * such at the type level:
 *
 *   `already_approved` — two taps from a phone on a bad connection, or two
 *     operators. Nothing went wrong and the draft goes out; calling it an error
 *     invites a third tap.
 *   `superseded` — the draft EXISTS. Saying "not found" would send the operator
 *     hunting for a bug when the honest answer is "reload the page".
 */
export type ApprovalResult =
  /** Written. `edited` distinguishes the AI-04 zero from a real rewrite. */
  | { kind: 'approved'; edited: boolean }
  | { kind: 'already_approved' }
  | { kind: 'not_found' }
  | { kind: 'superseded' }
  /** D-11: this attempt failed the fact check, so it is edit-only. */
  | { kind: 'validator_failed' }
  /** The operator's own bytes were refused. Nothing was written. */
  | { kind: 'violations'; violations: DraftViolation[] }
  /** A database failure. The caught value is discarded (WR-08, T-5-03). */
  | { kind: 'write_failed' };

/** The two draft statuses an operator may still act on, plus the whitelist inputs. */
type ApprovableDraft = {
  id: string;
  cadenceId: string;
  quoteId: string | null;
  finalBody: string;
  status: string;
  /**
   * WHEN THE DRAFT WAS WRITTEN — and this is a whitelist input, not metadata.
   *
   * One of the merge facts is "days since the quote", and it is derived from a
   * clock. Rebuilding the whitelist at `new Date()` would compute a DIFFERENT
   * number from the one the model was given the moment the approval crossed a
   * midnight — and D-14 gives drafts hours of lead time, so a draft written at
   * 6pm and approved at 9am is the ORDINARY case, not an edge one. The body
   * says "14 days"; the fresh whitelist says 15; the validator refuses a figure
   * the model was legitimately handed, and no amount of editing fixes it
   * because the operator cannot see why.
   *
   * KEPT AS THE FALLBACK ONLY. `mergeNow` below is the instant the whitelist was
   * genuinely built from; `created_at` is a different clock written later in the
   * same tick and is merely the closest thing available on rows written before
   * that column existed.
   */
  createdAt: Date;
  /**
   * THE INSTANT THE DRAFT'S OWN WHITELIST WAS BUILT FROM.
   *
   * `created_at` is Postgres `now()` at INSERT time; the whitelist was built
   * from the tick's JS `now`, captured before the consume pass, the progress
   * passes and up to two model calls. `renderDaysSince` floors the difference,
   * so once per day per cadence those two instants fall on opposite sides of a
   * day boundary — and then a whitelist rebuilt from `created_at` says `15`
   * where the body says `14`, and the approval refuses `unlisted_number` for a
   * figure the model was legitimately handed. `null` on pre-existing rows.
   */
  mergeNow: Date | null;
  /**
   * THE COMPLIANCE LINE THIS DRAFT WAS ACTUALLY WRITTEN WITH.
   *
   * `complianceSuffix(tenants.name)` reads a MUTABLE column. After a rename the
   * textarea is pre-filled with this draft's `final_body` — carrying the OLD
   * suffix — and re-deriving the expected one would fail `missing_suffix` on a
   * body the operator did not change. `null` on pre-existing rows.
   */
  complianceSuffix: string | null;
};

type DraftLookup = { ok: true; draft: ApprovableDraft } | { ok: false; result: ApprovalResult };

/**
 * THE REPAIR BEHIND EVERY `already_approved` (CR-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `already_approved` USED TO BE A BARE REPORT, AND THAT MADE THE ONE STATE │
 * │ NOBODY CAN RECOVER FROM PERMANENT. This function is what makes the       │
 * │ idempotent path actually idempotent instead of merely quiet.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `writeApproval` moves the draft and then the touch. Those two writes are now
 * one transaction, so a fresh approval can no longer tear — but rows torn by an
 * approval that ran BEFORE that transaction existed are still out there, and a
 * duplicate-index conflict still lands here from outside any transaction of
 * ours. In that state the draft reads `approved` while its touch is still
 * `pending_approval`, and dispatch only claims `approved` touches, so the
 * message never sends. Worse, every path that could fix it returned
 * `already_approved` FIRST — the console said "it goes out at its scheduled
 * time", removed the controls, and the quote page hid the row entirely.
 *
 * So every route to `already_approved` re-runs the touch write on the way past.
 * `approveWhere` is equality-guarded on `pending_approval` (D-12, and it remains
 * the ONE statement that writes `approved`), which is precisely why this is
 * safe to run unconditionally:
 *
 *   • ordinary double-tap — the touch is already `approved`, zero rows, no-op;
 *   • skipped/stopped/paused underneath — not `pending_approval`, zero rows,
 *     and the touch correctly stays where the later decision put it;
 *   • the wedged state — one row, and the message becomes dispatchable again.
 *
 * A FAILURE HERE IS REPORTED AS `write_failed`, NOT SWALLOWED. The operator's
 * copy for that outcome asks them to retry, and the retry is idempotent — which
 * is a far better answer than a second false "already approved".
 */
async function settleAlreadyApproved(
  repo: TenantScopedRepository,
  tenantId: string,
  touchId: string,
): Promise<ApprovalResult> {
  try {
    await repo.touches.approveWhere([touchId]);
  } catch {
    // NO BODY, NO ERROR MESSAGE (T-5-03/WR-08) — same rule as the write above.
    console.error(`[approval] touch repair failed for tenant ${tenantId}.`);
    return { kind: 'write_failed' };
  }
  return { kind: 'already_approved' };
}

/**
 * Load the attempt this approval is for, and refuse every way it can be wrong.
 *
 * ── THE LATEST ATTEMPT IS THE ONLY APPROVABLE ONE ───────────────────────────
 *
 * `latestForTouch` returns the touch's attempts newest first. If the newest is
 * not the one the form names, the page the operator is looking at was rendered
 * before a regeneration landed — and approving the older attempt would send the
 * text the drafting pass had already superseded, from a screen that showed it as
 * current. That is refused with its OWN outcome: the draft exists, so answering
 * "not found" would send the operator hunting for a bug.
 *
 * The `[]` case is genuinely not-found, and so is a `draftId` naming no attempt
 * of this touch — which is also what a forged pair looks like. Both get the same
 * outcome, deliberately: distinguishing them would turn the refusal into an
 * existence oracle over another client's drafts.
 */
async function loadApprovableDraft(
  tenantId: string,
  touchId: string,
  draftId: string,
): Promise<DraftLookup> {
  // Through `forTenant`, so the read is scoped to the tenant the CALLER
  // authorized — a draft id belonging to another client returns nothing,
  // whatever the form said.
  const repo = forTenant(tenantId);
  const attempts = await repo.drafts.latestForTouch(touchId);

  const latest = attempts[0];
  if (!latest) return { ok: false, result: { kind: 'not_found' } };

  if (latest.id !== draftId) {
    return {
      ok: false,
      result: attempts.some((row) => row.id === draftId)
        ? { kind: 'superseded' }
        : { kind: 'not_found' },
    };
  }

  // A SUCCESS, not an error — two taps from a phone on a bad connection reach
  // here and nothing went wrong.
  //
  // AND IT IS THE EARLIEST POINT THE WEDGED STATE IS REACHABLE FROM (CR-01):
  // this branch returns before `writeApproval` is ever entered, so it is the
  // one place a torn approval can be repaired from a second tap. See
  // `settleAlreadyApproved` for why re-running the guarded touch write is a
  // no-op in every case except the one that needs it.
  if (latest.status === 'approved') {
    return { ok: false, result: await settleAlreadyApproved(repo, tenantId, touchId) };
  }
  if (latest.status === 'superseded') {
    return { ok: false, result: { kind: 'superseded' } };
  }

  return {
    ok: true,
    draft: {
      id: latest.id,
      cadenceId: latest.cadenceId,
      quoteId: latest.quoteId,
      finalBody: latest.finalBody,
      status: latest.status,
      createdAt: latest.createdAt,
      mergeNow: latest.mergeNow,
      complianceSuffix: latest.complianceSuffix,
    },
  };
}

/**
 * Is this the unique partial index refusing a SECOND approved draft?
 *
 * `drafts.approve` is guarded on the ROW not already being approved, which
 * handles a double-tap on the same draft. It cannot handle two DIFFERENT
 * attempts of one touch being approved concurrently — that is
 * `touch_drafts_one_approved_per_touch`'s job, and Postgres answers it with a
 * 23505 rather than a coin-flip at send time (see the schema header).
 *
 * The SQLSTATE is checked on the error and on its `cause`, because the driver's
 * error is wrapped by the query builder; the index name is the fallback for the
 * same reason `isDuplicateNameError` carries one.
 */
function isDuplicateApprovalError(error: unknown): boolean {
  const seen = [error, (error as { cause?: unknown } | null)?.cause];
  return seen.some((candidate) => {
    if (candidate === null || typeof candidate !== 'object') return false;
    const { code, message } = candidate as { code?: unknown; message?: unknown };
    if (code === '23505') return true;
    return (
      typeof message === 'string' && message.includes('touch_drafts_one_approved_per_touch')
    );
  });
}

/**
 * Write the approval. Both entry points end here, so there is one approve path.
 *
 * ORDER IS LOAD-BEARING: the draft row flips to `approved` FIRST, and only a
 * draft that actually flipped moves its touch. The other order would produce an
 * `approved` touch whose approved draft does not exist — which dispatch reads as
 * `no_approved_draft` and refuses forever, silently, on a touch that looks
 * cleared on the screen.
 *
 * ── AND THE PAIR IS ATOMIC, BECAUSE ORDER ALONE WAS NEVER ENOUGH (CR-01) ────
 *
 * The order argument above only rules out ONE of the two half-applied states.
 * The symmetric one — an approved draft whose touch never moved — has exactly
 * the same consequence: dispatch claims only `approved` touches, so the message
 * never sends, while the queue keeps rendering the card and the stall alarm
 * keeps firing on it forever. Anything between the two statements produces it:
 * a Vercel function timeout, a pooled-connection drop, a redeploy mid-request,
 * a driver error on the second write.
 *
 * So both writes go through `repo.transaction`, which hands the callback a
 * repository bound to the SAME tenant and to the transaction — the scoping
 * guarantee survives the boundary rather than being suspended for it. Either
 * both rows move or neither does.
 *
 * The transaction closes the door on NEW tears; `settleAlreadyApproved` is what
 * reopens the rows torn before it existed.
 */
async function writeApproval(
  tenantId: string,
  draftId: string,
  touchId: string,
  finalBody: string,
  editDistance: number,
  /**
   * WHICH ENTRY POINT THIS WAS, not whether the distance came out above zero.
   *
   * An operator who opens the edit box, changes nothing and taps "Approve my
   * version" has an edit distance of 0 and must still be told their version is
   * what goes out — because from where they are sitting that is the sentence
   * they are checking. Deriving this from `editDistance > 0` would answer them
   * with the approve-unchanged copy instead, on the one screen where the
   * difference between "the model's words" and "my words" is the whole point.
   */
  edited: boolean,
): Promise<ApprovalResult> {
  const repo = forTenant(tenantId);

  let outcome: 'written' | 'already';
  try {
    outcome = await repo.transaction(async (tx) => {
      const approved = await tx.drafts.approve(draftId, {
        finalBody,
        // `numeric` is carried as a string end to end — the rounding contract on
        // `normalizedEditDistance` requires at least four decimal places, and a
        // float round-trip through the driver is exactly where those go.
        editDistance: String(editDistance),
        approvedAt: new Date(),
      });

      // Zero rows means the row-level guard held — somebody approved it between
      // the read above and this write. Same honest answer as the index
      // conflict, and the repair is left to the caller so that all three routes
      // to `already_approved` run the SAME statement outside this transaction.
      if (approved.length === 0) return 'already' as const;

      // `pending_approval → approved`, guarded on `pending_approval`. Its
      // zero-row case is deliberately NOT an error: the draft is approved either
      // way, and dispatch reads the draft. A touch that was skipped or stopped
      // underneath this approval simply never sends, which is the correct
      // outcome.
      //
      // THIS IS THE ONLY STATEMENT IN THE CODEBASE THAT WRITES `approved`
      // (D-12), and after this extraction there is exactly ONE call site of it.
      await tx.touches.approveWhere([touchId]);

      return 'written' as const;
    });
  } catch (error) {
    if (isDuplicateApprovalError(error)) {
      // Another attempt of this touch is already approved, and the transaction
      // rolled back, so nothing of OURS was written. The touch may still be
      // wedged behind that other attempt's approval, which is what the repair
      // is for.
      return settleAlreadyApproved(repo, tenantId, touchId);
    }
    // NO BODY, NO ERROR MESSAGE (T-5-03/WR-08): a database error from this write
    // can carry the statement, and the statement carries the draft text.
    console.error(`[approval] approve failed for tenant ${tenantId}.`);
    return { kind: 'write_failed' };
  }

  if (outcome === 'already') {
    return settleAlreadyApproved(repo, tenantId, touchId);
  }

  return { kind: 'approved', edited };
}

/* ------------------------------------------------------------------------- *
 * approveUnchanged — accept the model's text exactly as written (D-12)
 * ------------------------------------------------------------------------- */

/**
 * Approve a draft EXACTLY as written, recording an edit distance of 0.
 *
 * ── A `validator_failed` DRAFT CANNOT COME THROUGH HERE (D-11) ──────────────
 *
 * The mechanical validator refused this text twice, and the refusal is about a
 * fact — an invented price, a fabricated date, a character that would triple the
 * message's cost. D-11 says such a draft "can never be auto-approved… only
 * edited-then-approved", and the enforcement is this branch rather than the
 * absence of a button: the button's absence is a rendering decision, and a
 * Server Action id is POSTable without rendering anything.
 *
 * ── AI-04 IS RECORDED ON EVERY CROSSING, INCLUDING THE ZERO ─────────────────
 *
 * `edit_distance = 0` is written EXPLICITLY. "Reviewed and untouched" is the
 * single most important data point in the dataset V2-01 is gated on — it is the
 * one that would justify relaxing this gate — and leaving the column NULL would
 * make it indistinguishable from "never approved".
 */
export async function approveUnchanged(input: {
  /** The AUTHORIZED tenant. Never the one the form named. */
  tenantId: string;
  touchId: string;
  draftId: string;
}): Promise<ApprovalResult> {
  const found = await loadApprovableDraft(input.tenantId, input.touchId, input.draftId);
  if (!found.ok) return found.result;

  if (found.draft.status === 'validator_failed') {
    return { kind: 'validator_failed' };
  }

  return writeApproval(
    input.tenantId,
    found.draft.id,
    input.touchId,
    // THE STORED BYTES, RE-WRITTEN UNCHANGED. Not re-validated: this is the
    // exact string the validator already passed and the column already holds.
    found.draft.finalBody,
    // EXPLICIT ZERO, not an omission. See the block comment above.
    0,
    false,
  );
}

/* ------------------------------------------------------------------------- *
 * editThenApprove — the operator's own words (D-11, D-12, AI-04)
 * ------------------------------------------------------------------------- */

/**
 * Approve an operator's REWRITE of a draft, re-validated first.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE EDIT CROSSES THE TRUST BOUNDARY AGAIN (T-5-26). A human edit is not  │
 * │ a bypass of the fact validator; it is another body that has to pass it.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The obvious shape — "a human read it, so send whatever they typed" — is wrong
 * for the same reason the validator exists at all. `validate.ts` opens by saying
 * the two defences are not redundant: the human gate catches what a person
 * notices, and the validator catches what a person SKIMS PAST. `$2,450` retyped
 * as `$2,540` at 7am on a phone is precisely the second kind.
 *
 * ── THE WHITELIST IS REBUILT FROM THE SAME MERGE SOURCES (D-02) ─────────────
 *
 * Not stored on the draft row and not passed through the form — a whitelist that
 * arrived in a globally-POSTable body is a whitelist the caller chose. It is
 * rebuilt here from the quote and cadence rows, through the ONE function the
 * drafting pass also uses (`buildMergeFacts`), so the set that judges the edit
 * is the set that judged the draft.
 *
 * ── THE COMPLIANCE LINE IS RE-CHECKED, WHICH IS WHY THE WHOLE BODY IS EDITED ─
 *
 * The form pre-fills `final_body`, suffix included, and the validator's
 * `missing_suffix` rule then means an operator cannot delete the Spam Act sender
 * identification and opt-out line — by accident while trimming for length, or
 * deliberately. That is a legal requirement on every message, and the only
 * screen it could be removed from is an approval surface.
 */
export async function editThenApprove(input: {
  /** The AUTHORIZED tenant. Never the one the form named. */
  tenantId: string;
  touchId: string;
  draftId: string;
  /** Already length-checked by the caller's schema; validated for FACTS here. */
  editedBody: string;
  /** From the read that PROVED the caller is entitled to this client. */
  tenantName: string;
  /** The tenant's IANA zone — the quote date's whitelist rendering. */
  timezone: string;
}): Promise<ApprovalResult> {
  const found = await loadApprovableDraft(input.tenantId, input.touchId, input.draftId);
  if (!found.ok) return found.result;

  const repo = forTenant(input.tenantId);

  // ── Rebuild the facts, from OUR OWN MIRROR, scoped to this tenant. ───────
  const [cadence] = await repo.cadences.getById(found.draft.cadenceId);
  if (!cadence) {
    // The cadence vanished between the draft and this approval. There is nothing
    // to approve a message FOR, and approving without a whitelist would mean
    // approving with an EMPTY one — under which every digit in the body is
    // unlisted. Refusing is both the safe answer and the true one.
    return { kind: 'not_found' };
  }

  const [quote] = cadence.quoteId ? await repo.quotes.byId(cadence.quoteId) : [];

  const { allowedDisplayStrings } = buildMergeFacts({
    totalInvoiceAmount: quote?.totalInvoiceAmount ?? null,
    quoteDateUtc: quote?.quoteDateUtc ?? null,
    anchorAt: cadence.anchorAt,
    contactName: cadence.contactName,
    timezone: input.timezone,
    // THE INSTANT THE DRAFT'S OWN WHITELIST WAS BUILT FROM, read off the row.
    // NOT `created_at`, which is a different clock written later in the same
    // tick — see `ApprovableDraft.mergeNow`. `created_at` remains the fallback
    // for rows written before that column existed.
    now: found.draft.mergeNow ?? found.draft.createdAt,
  });

  // ── THE SAME VALIDATOR, over the operator's bytes. ───────────────────────
  const verdict = validateDraft({
    body: input.editedBody,
    allowedDisplayStrings,
    // THE SUFFIX THE OPERATOR IS LOOKING AT, not the one a rename would now
    // produce. The textarea is pre-filled with this draft's `final_body`, which
    // carries the suffix frozen at draft time; re-deriving it from the current
    // `tenants.name` would fail `missing_suffix` on text nobody edited, and
    // would disagree with `approveUnchanged`, which re-writes the stored bytes.
    expectedSuffix: found.draft.complianceSuffix ?? complianceSuffix(input.tenantName),
    // D-13: a LEAD follow-up carries no link, whoever typed it — the model at
    // drafting or the operator here (13-REVIEW WR-02). Quote edits unchanged.
    forbidLinks: cadence.kind === 'lead',
  });

  if (!verdict.ok) {
    // NOTHING IS WRITTEN. The operator gets the violation and retries — the
    // draft stays `pending_approval`, the touch stays where it was, and there is
    // no partial state to reconcile.
    return { kind: 'violations', violations: verdict.violations };
  }

  // ── AI-04, measured at the moment of approval. ───────────────────────────
  //
  // Between the STORED final body and the CANONICAL form of the edit — i.e.
  // between what the model produced and what will actually be sent. Measuring
  // against the raw submitted string instead would count the normalizer's own
  // repairs (a smart quote straightened, whitespace collapsed) as operator
  // edits, inflating every distance by work no human did.
  const editDistance = normalizedEditDistance(found.draft.finalBody, verdict.normalizedBody);

  return writeApproval(
    input.tenantId,
    found.draft.id,
    input.touchId,
    verdict.normalizedBody,
    editDistance,
    true,
  );
}
