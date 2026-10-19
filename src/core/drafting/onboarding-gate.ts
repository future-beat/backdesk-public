/**
 * ONB-03 + ONB-04 — the activation gate. NO CADENCE SENDS UNTIL BOTH CHECKLIST
 * CONDITIONS PASS, and each of the two writers that can satisfy one of them
 * asks the SAME composed question afterwards.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE GATE IS A PAUSE, NOT A REFUSAL, AND NOT A DISABLED BUTTON.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE TWO CONDITIONS, AND WHY THEY SHARE ONE PAUSE REASON (D-14) ──────────
 *
 *   templatesApproved      — ONB-03. Every sms touch in this client's cadence
 *                            shape has an approved wording. Without it there
 *                            are no words to send.
 *   sm8AutomationAttested  — ONB-04. An operator has looked at this client's
 *                            ServiceM8 settings and recorded that the native
 *                            Quote Follow Up automation is OFF. Without it our
 *                            cadence is the second voice chasing one customer,
 *                            which is the harm ONB-04 exists to prevent.
 *
 * ONE `pause_reason`, ONE resume path. Splitting them into
 * `paused(onboarding_templates)` / `paused(onboarding_sm8)` would buy a more
 * precise column and cost a CHECK-vocabulary migration plus a resume matrix
 * that grows a row per condition — and Phase 5 proved what that costs. The
 * precision the operator actually needs is in the REFUSAL, which names the
 * condition(s) missing; the state machine only ever needs to know "not yet".
 *
 * Three functions, and between them the whole of D-07 and D-14:
 *
 *   `readOnboardingConditions` — the ONE place both conditions are asked
 *                                together. `consume-events.ts` asks it once per
 *                                run before creating cadences; FALSE on either
 *                                condition means every cadence it creates is
 *                                born `paused(onboarding)`, fully materialized,
 *                                visible, and unable to send.
 *   `resumeIfOnboardingComplete` — the ONE place the conjunction is written and
 *                                the ONE resume path. Called IN-TRANSACTION by
 *                                both writers below.
 *   `approveTemplateVersion` /  — the two operator attestations, each of which
 *   `attestSm8AutomationOff`      satisfies one condition and then asks the
 *                                 composed question about both.
 *
 * WHY A PAUSE AND NOT A REFUSAL AT CREATION. The quote is genuinely live and the
 * schedule is genuinely correct; the only missing thing is configuration a human
 * supplies in an hour. Declining to create the cadence would mean re-deriving the
 * whole schedule later from an anchor that has since moved — and, worse, would
 * leave nothing on any screen to show an operator that four quotes came in while
 * the client was still being onboarded. "No cadence" and "no quotes" look
 * identical; a list of paused cadences with materialized touches does not.
 *
 * WHY A STATE-MACHINE GATE AND NOT A UI ONE. A disabled button in the console is
 * a rule one caller obeys. This gate is a `pause_reason` the matrix knows about
 * (`transitions.ts` note 7), a predicate on the operator resume
 * (`operatorResumeWherePaused`), and a `pause_reason` CHECK in the database —
 * so a tenant with unapproved templates cannot be made to send by any route,
 * including one written next year by somebody who never read this file.
 *
 * ── THE VACUOUS-TRUTH TRAP, WHICH IS THE WHOLE RISK IN `hasApprovedTemplateSet` ─
 *
 * "Every touch has an approved template" is TRIVIALLY TRUE of a tenant with no
 * touches configured — which is precisely a tenant nobody has onboarded. The
 * completion sweep (`completeWhereAllTouchesDone`) paid for this lesson with an
 * `EXISTS` beside its `NOT EXISTS`; the same shape appears here, and the failure
 * it would produce is worse: a brand-new client whose cadences activate on day
 * one and start drafting against templates nobody wrote (T-5-13).
 *
 * FRAMEWORK-FREE, and service-role by construction: every read and write goes
 * through a `forTenant()` scope the caller has already proven it is entitled to.
 * `authenticated` holds SELECT only on `message_templates` (migration 0028), so
 * the console reaches `approveTemplateVersion` through a server action rather
 * than through an UPDATE of its own — which is what keeps the write-once
 * attestation a guarantee rather than a convention.
 */
import { forTenant, type TenantScopedRepository } from '@/db/repository';
import { ONBOARDING_PAUSE_REASON } from '@/db/schema/cadences';
import type { TenantAttestationKind } from '@/db/schema/tenant-attestations';

import { applyResumeRewindow } from '../cadence/resume';

/**
 * The one attestation kind the gate reads. Named here rather than spelled at
 * each call site so a typo is a compile error rather than a client gated
 * forever with an attestation sitting in the table (the schema's own argument
 * for the CHECK constraint, one layer up).
 */
export const SM8_AUTOMATION_ATTESTATION_KIND: TenantAttestationKind = 'sm8_automation_off';

/**
 * Is EVERY sms touch in this tenant's cadence shape covered by an approved
 * wording?
 *
 * Takes the repository rather than a tenant id so it can be asked inside a
 * transaction — `consume-events.ts` asks it beside the `ensureDefaults` seed
 * that creates the very timing rows it counts, and a second connection would
 * read the world before that seed committed.
 *
 * ── THE `length > 0` IS NOT A NULL CHECK, IT IS THE GATE ────────────────────
 *
 * `Array.prototype.every` returns TRUE for an empty array. A tenant with no
 * `cadence_touch_templates` rows — i.e. one nobody has onboarded — would
 * therefore read as fully approved, and every cadence they gained would be born
 * active and start drafting against templates that do not exist. That is T-5-13,
 * and this line is its mitigation. It is written out rather than folded into the
 * `every` because a reader must be able to see that the empty case was decided
 * on purpose.
 */
export async function hasApprovedTemplateSet(repo: TenantScopedRepository): Promise<boolean> {
  const touches = await repo.templates.approvedSetStatus();
  if (touches.length === 0) return false;
  return touches.every((touch) => touch.approved);
}

/** Which sms touch numbers are still waiting for an approved wording. */
export async function unapprovedTouchNumbers(
  repo: TenantScopedRepository,
): Promise<number[]> {
  const touches = await repo.templates.approvedSetStatus();
  return touches.filter((touch) => !touch.approved).map((touch) => touch.touchNumber);
}

/**
 * ONB-04 — has ANYBODY recorded that this client's own ServiceM8 Quote Follow
 * Up automation is off?
 *
 * ── THE VACUOUS-TRUTH GUARD, WRITTEN OUT AGAIN ON PURPOSE ───────────────────
 *
 * A tenant with ZERO attestation rows reads FALSE, and this early return exists
 * so a reader can see that the empty case was decided rather than inherited.
 * That is `hasApprovedTemplateSet`'s `length === 0` one condition over, and it
 * is the T-5-13 lesson: "no evidence" and "evidence that it is fine" are
 * different claims, and only a gate that says so keeps a brand-new client from
 * activating on day one.
 *
 * ── STALENESS DOES NOT FALSIFY THIS (D-15), AND THAT IS DELIBERATE ──────────
 *
 * An attestation older than `ATTESTATION_STALE_DAYS` is STALE, not void. This
 * function does not look at `attestedAt` at all: staleness is D-15 tier 2, a
 * NAG — a badge on the checklist and one line in the daily digest — and it must
 * never pause or block anything. A calendar rolling over is not evidence that a
 * client switched their automation back on, and stopping a healthy client's
 * follow-ups because thirty days elapsed would be the product harming the
 * customer it exists to serve. If the condition ever becomes falsifiable it
 * will be by BEHAVIOURAL evidence, which is probe-gated and not built.
 */
export async function hasSm8AutomationAttestation(
  repo: TenantScopedRepository,
): Promise<boolean> {
  const rows = await repo.attestations.latest(SM8_AUTOMATION_ATTESTATION_KIND);
  if (rows.length === 0) return false;
  return true;
}

/**
 * The two conditions, as they stood at the moment they were asked.
 *
 * Reported as a RECORD rather than collapsed to a boolean because the callers
 * need different things from it: the state machine needs the conjunction, and
 * the console needs to say WHICH condition is missing so its refusal can point
 * at the one screen that fixes it (T-5-10 — a refusal that does not name the
 * missing thing sends an operator to reload the page instead).
 */
export interface OnboardingConditions {
  /** ONB-03 — every sms touch has an approved wording. */
  templatesApproved: boolean;
  /** ONB-04 — an operator has recorded ServiceM8's own follow-up as off. */
  sm8AutomationAttested: boolean;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CONJUNCTION IS WRITTEN EXACTLY ONCE, AND THIS IS IT.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Every caller — creation, both resume writers, and the console's refusal —
 * reaches this function rather than writing `a && b` of its own. Two readings
 * of one activation rule is the CR-01 defect class, and an activation rule is
 * the worst place in this system to have it: the two copies agree until one is
 * widened, and the one that was not is the one that lets a client send.
 */
export function onboardingComplete(conditions: OnboardingConditions): boolean {
  return conditions.templatesApproved && conditions.sm8AutomationAttested;
}

/**
 * Ask both conditions of one tenant.
 *
 * Takes the REPOSITORY rather than a tenant id, exactly as
 * `hasApprovedTemplateSet` does and for the same reason: it must be askable
 * inside a transaction, beside the seed that creates the timing rows it counts
 * and after the write that may have just satisfied one of the two.
 */
export async function readOnboardingConditions(
  repo: TenantScopedRepository,
): Promise<OnboardingConditions> {
  const [templatesApproved, sm8AutomationAttested] = await Promise.all([
    hasApprovedTemplateSet(repo),
    hasSm8AutomationAttestation(repo),
  ]);

  return { templatesApproved, sm8AutomationAttested };
}

/* ------------------------------------------------------------------------- *
 * resumeIfOnboardingComplete — THE ONE RESUME PATH (D-14)
 * ------------------------------------------------------------------------- */

/** What the in-transaction half of a gate-opening write actually did. */
export interface ResumeIfCompleteOutcome {
  /**
   * Exactly the cadences this call moved out of `paused(onboarding)` — the
   * write's own `RETURNING`, never a list assembled from an earlier SELECT.
   * EMPTY when the gate is still closed, and empty is an ordinary answer.
   */
  resumedIds: string[];
  /** Both conditions as they stood AFTER the caller's write. */
  conditions: OnboardingConditions;
}

/**
 * Ask the composed question, and resume if the answer is yes.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CALLED INSIDE THE CALLER'S TRANSACTION, ALWAYS. Both writers pass their  │
 * │ own `tx`, so the conditions are read in a world that already contains    │
 * │ the row they just wrote.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Asking BEFORE the caller's write would answer about the world without it —
 * which is the world every caller already knows about, and the reason
 * `approveTemplateVersion` re-asked in-transaction from the day it was written.
 *
 * ── REASON-SCOPED, NOT STATUS-SCOPED ────────────────────────────────────────
 *
 * `resumeWherePaused(ids, ONBOARDING_PAUSE_REASON)` is what says so, rather
 * than a filter in a caller that the next caller would forget. A cadence paused
 * because the customer wrote back, or because the client pulled their
 * handbrake, is not this write's to resume — and the same is true of the
 * ONB-04 attestation as it always was of the ONB-03 approval.
 *
 * ── AND IT DOES NOT RE-WINDOW ───────────────────────────────────────────────
 *
 * It cannot, and the placement rule is the whole reason this returns ids at
 * all: `applyResumeRewindow` reads through its OWN connection, so called from
 * inside this transaction it would see the pre-commit world, find the cadences
 * still paused, skip every one of them and report success. A gate that opens
 * and leaves every overdue touch where it was is the burst D-07 exists to
 * prevent, arriving through the door marked "we approved it". `finishResume`
 * below is the outside-the-transaction half, and both callers use it.
 */
export async function resumeIfOnboardingComplete(
  tx: TenantScopedRepository,
): Promise<ResumeIfCompleteOutcome> {
  const conditions = await readOnboardingConditions(tx);

  if (!onboardingComplete(conditions)) return { resumedIds: [], conditions };

  const resumed = await tx.cadences.resumeWherePaused(
    (await tx.cadences.listLive())
      .filter((cadence) => cadence.status === 'paused')
      .map((cadence) => cadence.id),
    ONBOARDING_PAUSE_REASON,
  );

  return { resumedIds: resumed.map((cadence) => cadence.id), conditions };
}

/** What the re-window did, reported rather than assumed. */
interface RewindowOutcome {
  cadencesResumed: number;
  touchesRescheduled: number;
  /**
   * The cadences ARE resumed; their schedules were not repaired, because a
   * pause is still in force (the client's own, or a dead ServiceM8 key). Same
   * honest half-answer `resumeClient` reports, for the same reason.
   */
  rewindowDeferred: boolean;
}

/**
 * The OUTSIDE-THE-TRANSACTION half. Call it after the caller's transaction has
 * COMMITTED, with the ids `resumeIfOnboardingComplete` returned.
 *
 * ── THE SCOPE IS THE RETURNING IDS, NEVER THE TENANT ────────────────────────
 *
 * Event consumption runs for paused tenants, and both of these attestations are
 * tenant-wide acts — so at the moment one lands, this client may hold cadences
 * that were never onboarding-paused at all: reply-paused ones, client-paused
 * ones, and ACTIVE ones whose schedules are perfectly correct. Re-windowing the
 * tenant would drag their next touch forward to the attestation moment and
 * message those customers days early.
 *
 * An EMPTY scope is not the same as an omitted one (see
 * `ApplyResumeRewindowOptions`): omitting it re-windows every active cadence
 * the tenant has, which is the opposite of what this write authorized. Hence
 * the early return rather than a call with an empty array.
 *
 * The cost of doing this after the commit is a crash window, and it is
 * survivable for the reason `resumeClient` states: the tick's progress pass
 * re-windows overdue touches of active cadences within the minute. Reversing
 * the order is not survivable.
 */
async function finishResume(
  tenantId: string,
  now: Date,
  resumedIds: readonly string[],
): Promise<RewindowOutcome> {
  if (resumedIds.length === 0) {
    return { cadencesResumed: 0, touchesRescheduled: 0, rewindowDeferred: false };
  }

  const rewindow = await applyResumeRewindow(tenantId, now, {
    onlyCadenceIds: [...resumedIds],
  });

  return {
    cadencesResumed: resumedIds.length,
    touchesRescheduled: rewindow.touchesRescheduled,
    rewindowDeferred: rewindow.stillPaused,
  };
}

export type ApproveTemplateVersionResult =
  | {
      /**
       * The attestation landed. `setComplete` says whether THIS approval was the
       * one that finished the set — and the resume/re-window figures are the
       * consequence, reported rather than assumed, because zero of them is an
       * ordinary answer (a client with no quotes open yet).
       */
      kind: 'approved';
      setComplete: boolean;
      cadencesResumed: number;
      touchesRescheduled: number;
      /**
       * The cadences ARE resumed; their schedules were not repaired, because a
       * pause is still in force (the client's own, or a dead ServiceM8 key).
       * Same honest half-answer `resumeClient` reports, for the same reason.
       */
      rewindowDeferred: boolean;
      /**
       * BOTH conditions after this write (ONB-04). `setComplete` still means
       * exactly what it always did — the TEMPLATE set is finished — and it is
       * deliberately not widened to mean "the client can send now", because the
       * console's partial-progress sentence is about templates and would start
       * lying the day a client approved their fifth wording with no attestation
       * on file. What "can this client send" needs is the record below.
       */
      conditions: OnboardingConditions;
    }
  | {
      /**
       * REFUSED, AND NOTHING WAS WRITTEN (D-06). The stored attestation is
       * returned so the caller can show WHO said what and WHEN rather than a
       * bare "already done" — an operator who tapped twice and an operator
       * looking at a colleague's approval need different sentences.
       */
      kind: 'already_approved';
      approvedAt: Date;
      approvalNote: string | null;
    }
  | { kind: 'not_found' };

/**
 * Attest to one template version, and open the gate if that satisfied the LAST
 * missing condition.
 *
 * ── FOUR STEPS, AND THE ORDER IS THE FUNCTION ───────────────────────────────
 *
 *   1. Write the attestation, guarded on `approved_at IS NULL` (write-once).
 *   2. Ask `resumeIfOnboardingComplete` — INSIDE the same transaction, so BOTH
 *      conditions are read in a world containing the row just written.
 *   3. It resumes exactly the cadences paused for `onboarding` when both pass;
 *      commit.
 *   4. OUTSIDE the transaction, `finishResume` re-windows exactly the ids
 *      step 3 RETURNED.
 *
 * Steps 2–4 used to be written out here. They are shared with
 * `attestSm8AutomationOff` now, and the reasoning behind step 4's placement and
 * its scope lives on those two functions — read them before changing either.
 * The important consequence of the extraction: THIS FUNCTION NO LONGER DECIDES
 * WHETHER THE CLIENT MAY SEND. It satisfies one condition and asks.
 */
export async function approveTemplateVersion(
  tenantId: string,
  versionId: string,
  note: string,
  now: Date,
): Promise<ApproveTemplateVersionResult> {
  const repo = forTenant(tenantId);

  const written = await repo.transaction(async (tx) => {
    const [approved] = await tx.templates.approveWhereUnapproved(versionId, note, now);

    if (!approved) {
      // ZERO ROWS HAS TWO CAUSES and they are different answers: the version does
      // not exist (or belongs to another tenant — deliberately indistinguishable,
      // as everywhere else in this repository), or it is already approved and the
      // guard refused to overwrite the evidence.
      const versions = await tx.templates.listVersions();
      const existing = versions.find((row) => row.id === versionId);
      if (!existing || existing.approvedAt === null) return { kind: 'not_found' as const };

      return {
        kind: 'already_approved' as const,
        approvedAt: existing.approvedAt,
        approvalNote: existing.approvalNote,
      };
    }

    // ASKED AFTER THE WRITE, IN THE SAME TRANSACTION — and it now asks about
    // BOTH conditions, because the approval is only half of the gate (D-14).
    // Asking before the write would answer about the world without this
    // approval in it, which is the world every caller already knows about.
    const { resumedIds, conditions } = await resumeIfOnboardingComplete(tx);

    return { kind: 'approved' as const, resumedIds, conditions };
  });

  if (written.kind !== 'approved') return written;

  return {
    kind: 'approved',
    // The TEMPLATE half, deliberately not the composed answer. See the field's
    // comment on `ApproveTemplateVersionResult`.
    setComplete: written.conditions.templatesApproved,
    conditions: written.conditions,
    ...(await finishResume(tenantId, now, written.resumedIds)),
  };
}

/* ------------------------------------------------------------------------- *
 * attestSm8AutomationOff — ONB-04's half of the gate
 * ------------------------------------------------------------------------- */

export type AttestSm8AutomationOffResult = {
  /**
   * THE ATTESTATION LANDED. There is no failure arm, and that absence is the
   * design: an append-only INSERT with a server-set timestamp has nothing to
   * lose a race against, and an attestation recorded for a client whose
   * templates are still unapproved is a SUCCESS that resumed nothing. Nothing
   * failed — the operator did exactly what was asked and the OTHER condition is
   * still open, which `conditions` says out loud so the console can name it.
   */
  kind: 'attested';
  /** The row that was written — its `attested_at` is the database's answer. */
  attestedAt: Date;
  cadencesResumed: number;
  touchesRescheduled: number;
  rewindowDeferred: boolean;
  /** Both conditions after this write. */
  conditions: OnboardingConditions;
};

/**
 * Record that an operator LOOKED at this client's ServiceM8 settings and saw
 * the native Quote Follow Up automation switched off — and open the gate if
 * that was the last missing condition (ONB-04, D-14).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A ROW HERE IS NOT A STATUS FLAG. It does not claim the automation IS     │
 * │ off; it claims a named human looked at a recorded moment and wrote down  │
 * │ what they saw. Only the second of those is something we can know.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE NOTE IS A REQUIRED PARAMETER, AND THAT IS THE MECHANISM (T-5-12) ────
 *
 * Typing HOW you verified it IS the deliberation. A checkbox records that
 * somebody clicked; a sentence records that somebody looked. The column is NOT
 * NULL with no default and this signature has no optional arm, so neither the
 * database nor the type system will accept the checkbox back. The console
 * enforces non-EMPTINESS on top (a `''` satisfies both of these and is an
 * attestation nobody can later show happened) — the same two-layer rule
 * `attestTemplateApproval` states.
 *
 * ── APPEND-ONLY: A RE-ATTESTATION IS A NEW ROW ──────────────────────────────
 *
 * `attestations.append` is an INSERT and the namespace exposes no update and no
 * delete, so the D-15 staleness policy — which nags at 30 days and reads
 * "the latest row" — always has the trail it reads from. Nothing is overwritten
 * and no history is lost.
 *
 * Same four-step shape as `approveTemplateVersion`, sharing steps 2–4 with it.
 */
export async function attestSm8AutomationOff(
  tenantId: string,
  note: string,
  now: Date,
): Promise<AttestSm8AutomationOffResult> {
  const repo = forTenant(tenantId);

  const written = await repo.transaction(async (tx) => {
    const [attestation] = await tx.attestations.append({
      kind: SM8_AUTOMATION_ATTESTATION_KIND,
      note,
    });

    // Unreachable in practice: an INSERT with no ON CONFLICT either returns its
    // row or throws. Named rather than non-null-asserted, because a silent
    // `undefined` here would report a resume that never happened.
    if (!attestation) throw new Error('attestSm8AutomationOff: the INSERT returned no row.');

    const { resumedIds, conditions } = await resumeIfOnboardingComplete(tx);

    return { attestedAt: attestation.attestedAt, resumedIds, conditions };
  });

  return {
    kind: 'attested',
    attestedAt: written.attestedAt,
    conditions: written.conditions,
    ...(await finishResume(tenantId, now, written.resumedIds)),
  };
}
