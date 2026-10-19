'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import {
  armChannelAction,
  attestSm8AutomationOffAction,
  disarmChannelAction,
  recordProofAction,
} from './actions';
import {
  BLANK_ARM_STATE,
  BLANK_ATTEST_STATE,
  BLANK_PROOF_STATE,
  smsBlastRadiusSentence,
} from './action-state';

/**
 * "READY TO SEND?" — the answer to "why is this client not sending yet?", at a
 * glance (D-16, 06-UI-SPEC §3; extended to eleven rows, the arming controls and
 * the two proof forms by ARM-01/ARM-02/ARM-03, to thirteen by the two divert
 * rows and their health line in Phase 11, CAP-05, and to seventeen by the four
 * text-back rows, the Text-back live line, the per-client text-back controls
 * and the text-back proof slot in Phase 12, TXT-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS COMPONENT DERIVES NOTHING. Every satisfied/unmet answer on screen   │
 * │ was computed by `src/core/onboarding/checklist.ts`, which reads the SAME │
 * │ condition readers the activation gate asks. A second derivation here     │
 * │ would be the one that says green while the gate says no.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THIS IS A CLIENT COMPONENT AT ALL ───────────────────────────────────
 *
 * Most of the rows are pure output and would render happily on the server. The
 * writable ones carry forms that need `useActionState` for their
 * pending-disabled submits and their inline refusals — and the SMS control
 * needs `useState` for the arm-then-confirm step. Splitting the list to keep the
 * read-only rows on the server would put the label map in two files, and a
 * checklist whose rows disagree about their own vocabulary is worse than one
 * client component.
 *
 * ITS PROPS ARE PLAIN DATA, and deliberately: nothing here imports the
 * repository, `checklist.ts` or anything that reaches Postgres — a VALUE import
 * from a server-only module is a real edge in the browser bundle and is exactly
 * what broke `next build` in 06-02. Dates arrive pre-formatted in the CLIENT's
 * timezone; the browser's zone is the operator's, and these dates belong to the
 * tradie's business.
 *
 * ── THE ARM CONTROL IS A SWITCH WITH CONSEQUENCES, NOT A TOGGLE ─────────────
 *
 * Arming SMS writes the SHARED row: every connected client starts sending on
 * the next tick, from one number, and a message that has left cannot be
 * recalled. So it is a two-step arm-then-confirm whose warning states that
 * between the taps (`cadence-controls.tsx`'s never-contact pattern), never a
 * `confirm()` dialog and never a one-tap toggle.
 *
 * TEXT-BACK HAS NO EVERY-CLIENT CONTROL, AND NONE MAY BE ADDED (D-09). Its
 * controls are per-client only, like email's; the action refuses an
 * `everyone` post for it, the repository refuses a null tenant, and the
 * database CHECK refuses the row.
 */

/** Fixed labels — 06-UI-SPEC Copywriting Contract, extended for ARM-01. */
const ITEM_LABELS = {
  sm8Connected: 'ServiceM8 connected',
  contactHours: 'Contact hours set',
  voiceProfile: 'Voice profile set',
  templatesApproved: 'Templates approved',
  sm8AutomationOff: 'ServiceM8 auto follow-up off',
  escalationPhone: 'Escalation phone set',
  sendingDomainVerified: 'Sending domain verified',
  smsArmed: 'SMS armed',
  emailArmed: 'Email armed',
  escalationHandsetProof: 'Escalation handset proof recorded',
  emailPipeProof: 'Email pipe proof recorded',
  // Phase 11 (CAP-05). These two strings are reused verbatim by the telephony
  // runbook and the provisioning form — change them in all three or none.
  divertNumber: 'Divert number provisioned',
  divertVerified: 'Verification call recorded',
  // Phase 12 (TXT-05). docs/client-divert-onboarding-runbook.md reuses these
  // four VERBATIM, and tests/client-divert-runbook.test.ts cross-checks them
  // against this file — change them in both or neither.
  textBackTemplates: 'Text-back templates attested',
  neverTextOwnNumber: 'Own numbers on the never-text list',
  textBackArmed: 'Text-back armed',
  textBackProof: 'Text-back proof recorded',
} as const;

type ItemKey = keyof typeof ITEM_LABELS;

/**
 * WHERE TO GO WHEN A ROW IS UNMET, and its link text.
 *
 * `null` where the remedy is a control ON THIS CARD — the attested row's form,
 * and the two arming rows, whose whole point is that turning sending on happens
 * here, deliberately, with the consequence stated. `escalationPhone`'s remedy is
 * the collapsed form directly above this card on the same page.
 *
 * A `Record` over the key union, so a tenth item added later is a COMPILE ERROR
 * here rather than a row that silently renders with no way to fix it.
 */
const ITEM_FIX: Record<ItemKey, { href: (tenantId: string) => string; label: string } | null> = {
  sm8Connected: { href: () => '#servicem8-connection', label: 'Set it up →' },
  contactHours: null,
  voiceProfile: {
    href: (tenantId) => `/clients/${tenantId}/drafting`,
    label: 'Set it up →',
  },
  templatesApproved: {
    href: (tenantId) => `/clients/${tenantId}/drafting`,
    label: 'Approve templates →',
  },
  sm8AutomationOff: null,
  escalationPhone: null,
  sendingDomainVerified: { href: () => '/settings/email', label: 'Verify it →' },
  smsArmed: null,
  emailArmed: null,
  // The remedy is the form on this row: there is nowhere to send an operator,
  // because producing the proof is done in the world and recorded here.
  escalationHandsetProof: null,
  emailPipeProof: null,
  // The anchor the provisioning form carries (plan 11-05).
  divertNumber: { href: () => '#divert-number', label: 'Provision it →' },
  // Its remedy is a proof form on this row (plan 11-05), like the two above.
  divertVerified: null,
  // The wordings and the never-text list live on the client's Text-back page
  // (12-06); the switch and its proof are controls on THIS card.
  textBackTemplates: {
    href: (tenantId) => `/clients/${tenantId}/text-back`,
    label: 'Set it up →',
  },
  neverTextOwnNumber: {
    href: (tenantId) => `/clients/${tenantId}/text-back`,
    label: 'Set it up →',
  },
  textBackArmed: null,
  textBackProof: null,
};

export interface ChecklistCardItem {
  key: ItemKey;
  satisfied: boolean;
  detail: string | null;
}

/** The arming facts, exactly as `readGoLiveChecklist` returned them. */
export interface ChecklistCardArming {
  sms: {
    from: string | null;
    source: 'tenant' | 'global' | 'none';
    tenantRow: { enabled: boolean } | null;
    globalEnabled: boolean;
  };
  email: {
    from: string | null;
    tenantRow: {
      enabled: boolean;
      fromAddress: string | null;
      replyTo: string | null;
      businessName: string | null;
    } | null;
    domain: 'verified' | 'unverified' | 'unknown' | 'none';
  };
  /** This client's own text-back switch (D-09) — the exact-target read. */
  textBack: { armed: boolean };
}

/**
 * WHO THE SHARED SMS ROW GOVERNS (10-03, D-03) — read by the page from
 * `forAllTenants_armedBySmsGlobal` and named in the warning between the taps.
 *
 * The client whose page this is appears in the list like any other when it has
 * no sms row of its own, because it IS armed by the shared row. Hiding it would
 * make the count on screen disagree with the count that gets armed.
 */
export interface ChecklistCardArmedClient {
  id: string;
  name: string;
}

/** One flip of the switch, with its date already formatted by the page. */
export interface ChecklistCardAuditLine {
  action: 'arm' | 'disarm';
  on: string;
  scope: 'every client' | 'this client';
  /**
   * WHOSE HAND (D-21). `system` is the low-balance auto-disarm — rendered as
   * "system" with its reason, never as an operator's action.
   */
  actor: 'operator' | 'system';
  reason: string | null;
}

type ArmChannel = 'sms' | 'email' | 'text_back';

/**
 * Which control was last tapped — so one message renders, not two.
 *
 * `proof` joins `arm` and `disarm` for the same reason they are here: the two
 * proof forms share ONE `useActionState` hook (one action, bound once), so
 * without this, recording the SMS proof would leave "Recorded. SMS is live for
 * this client." sitting under the EMAIL row as well.
 */
type LastTapped = { channel: ProofSlot; kind: 'arm' | 'disarm' | 'proof' };

/** What the card needs to render one recorded proof — date already formatted. */
export interface ChecklistCardProof {
  /** Pre-formatted in the CLIENT's timezone by the page. */
  recordedOn: string;
  artefactId: string;
}

export interface ChecklistCardProofs {
  escalationHandset: ChecklistCardProof | null;
  emailPipe: ChecklistCardProof | null;
  /** The verification call (CAP-05) — a captured `missed_calls` row's id. */
  divertVerification: ChecklistCardProof | null;
  /** A delivered text-back (D-13) — the `missed_calls` row id it answered. */
  textBack: ChecklistCardProof | null;
}

/**
 * DIVERT HEALTH, as `readGoLiveChecklist` derived it — the last-call instant
 * already formatted in the CLIENT's zone by the page. `daysSinceLastCall` is the
 * core's floored count; this card only chooses the words for it.
 */
export interface ChecklistCardDivert {
  numberE164: string | null;
  status: 'none' | 'pending' | 'active' | 'failed';
  /** Pre-formatted in the CLIENT's timezone. `null` = no diverted call ever. */
  lastCallOn: string | null;
  daysSinceLastCall: number | null;
}

/** Which proof a row shows: one per arming channel (text-back included), plus the divert call. */
type ProofSlot = ArmChannel | 'divert';

/** Derived by `readGoLiveChecklist` from armed + proof. Never re-derived here. */
export type ChecklistCardLive = 'not_armed' | 'armed' | 'live';

/**
 * ONE LINE PER CHANNEL, at the top of the card (D-01).
 *
 * The three states are three different situations with three different next
 * moves, and collapsing them into a green/red dot is how "armed" — real messages
 * can leave, nobody has watched one arrive — becomes invisible.
 */
const LIVE_LABEL: Readonly<Record<ChecklistCardLive, string>> = {
  not_armed: 'Not armed',
  armed: 'Armed, not yet proven',
  live: 'Live',
};

/** Which id each proof asks for, named on the field that wants it. */
const PROOF_FIELD_HINT: Readonly<Record<ProofSlot, string>> = {
  sms: 'The escalation row id — a uuid, printed by npm run escalations:recent. Not the ClickSend message id.',
  email:
    'The Resend email id printed by npm run verify:email-pipe (or npm run resend:email-status).',
  divert:
    "printed by npm run missed-calls:recent — the founder's own test call after the divert is set",
  text_back:
    'The missed call id printed by npm run text-back:timing — a call that was texted and shows a delivered time.',
};

/** The proof kind each slot's form posts. Decided by the row, never the operator. */
const PROOF_KIND: Readonly<
  Record<
    ProofSlot,
    'escalation_handset_proof' | 'email_pipe_proof' | 'divert_verification_call' | 'text_back_proof'
  >
> = {
  sms: 'escalation_handset_proof',
  email: 'email_pipe_proof',
  divert: 'divert_verification_call',
  text_back: 'text_back_proof',
};

/** What the operator is asked to write down, per slot. */
const PROOF_NOTE_HINT: Readonly<Record<ProofSlot, string>> = {
  sms: 'Whose handset it arrived on, and what it said.',
  email: 'Which inbox it arrived in, and what the headers showed.',
  divert: 'Which line you rang, that it diverted, and what the greeting said.',
  text_back: 'Whose handset it arrived on, how long it took, and what it said.',
};

export function ChecklistCard({
  tenantId,
  items,
  attestation,
  arming,
  armedClients,
  audit,
  proofs,
  live,
  divert,
}: {
  tenantId: string;
  items: readonly ChecklistCardItem[];
  attestation: {
    /** Pre-formatted in the CLIENT's timezone by the page — never re-formatted here. */
    attestedOn: string | null;
    note: string | null;
    isStale: boolean;
  };
  arming: ChecklistCardArming;
  /** The shared sms row's blast radius, named in its warning (D-03). */
  armedClients: readonly ChecklistCardArmedClient[] | null;
  audit: {
    sms: readonly ChecklistCardAuditLine[];
    email: readonly ChecklistCardAuditLine[];
    textBack: readonly ChecklistCardAuditLine[];
  };
  /** The latest proof of each kind, or `null` for never proven (D-02). */
  proofs: ChecklistCardProofs;
  /** DERIVED BY THE CORE from armed + proof. This card never computes it. */
  live: { sms: ChecklistCardLive; email: ChecklistCardLive; textBack: ChecklistCardLive };
  /** The divert number and the last diverted call (CAP-05, D-09). */
  divert: ChecklistCardDivert;
}) {
  const [state, formAction, pending] = useActionState(
    attestSm8AutomationOffAction.bind(null, tenantId),
    BLANK_ATTEST_STATE,
  );

  const [armState, armAction, armPending] = useActionState(
    armChannelAction.bind(null, tenantId),
    BLANK_ARM_STATE,
  );

  const [disarmState, disarmAction, disarmPending] = useActionState(
    disarmChannelAction.bind(null, tenantId),
    BLANK_ARM_STATE,
  );

  // ONE HOOK FOR BOTH PROOF FORMS — which is why `LastTapped` carries `proof`.
  const [proofState, proofAction, proofPending] = useActionState(
    recordProofAction.bind(null, tenantId),
    BLANK_PROOF_STATE,
  );

  // ONE MESSAGE SLOT, TAPPED-CONTROL-WINS (the cadence-controls pattern). Two
  // hooks feed four possible controls on this card; without this, arming SMS
  // would leave its sentence sitting under the email row as well.
  const [last, setLast] = useState<LastTapped | null>(null);

  return (
    // The id is the anchor a gated-cadence refusal on the quote page links to
    // ("record it on the client page") — the refusal names the missing
    // condition and lands the operator on the control that clears it.
    <section id="ready-to-send" className="draft-card">
      <h2>Ready to send?</h2>
      <p className="muted meta">
        Everything a client needs before follow-ups go out. Green means done.
      </p>

      {/* THE ANSWER TO "IS THIS CLIENT ACTUALLY GOING?", above the seventeen rows
          that explain it (D-01). Three states, never two: "armed" means real
          messages can leave and nobody has yet watched one arrive, which is a
          different thing from live and a different thing from off. Derived by
          the core; this card only renders which of the three it was told. */}
      <ul className="touch-list">
        <li>
          <div className="row">
            <span>SMS</span>
            <span className={live.sms === 'live' ? 'badge badge--ok' : 'badge badge--warn'}>
              {LIVE_LABEL[live.sms]}
            </span>
          </div>
        </li>
        <li>
          <div className="row">
            <span>Email</span>
            <span className={live.email === 'live' ? 'badge badge--ok' : 'badge badge--warn'}>
              {LIVE_LABEL[live.email]}
            </span>
          </div>
        </li>
        {/* THE THIRD LINE (D-13): the missed-call text-back, per client. */}
        <li>
          <div className="row">
            <span>Text-back</span>
            <span className={live.textBack === 'live' ? 'badge badge--ok' : 'badge badge--warn'}>
              {LIVE_LABEL[live.textBack]}
            </span>
          </div>
        </li>
      </ul>
      <p className="muted meta">
        Cadence follow-ups send by SMS; email arming covers this client&rsquo;s sending identity,
        which the email pipe proof uses.
      </p>

      <ul className="touch-list">
        {items.map((item) => {
          const fix = ITEM_FIX[item.key];
          const attested = item.key === 'sm8AutomationOff';
          const armChannel: ArmChannel | null =
            item.key === 'smsArmed'
              ? 'sms'
              : item.key === 'emailArmed'
                ? 'email'
                : item.key === 'textBackArmed'
                  ? 'text_back'
                  : null;
          // The SAME `key === '…'` switch, one row further down the list — with
          // a third arm for the verification call (CAP-05).
          const proofChannel: ProofSlot | null =
            item.key === 'escalationHandsetProof'
              ? 'sms'
              : item.key === 'emailPipeProof'
                ? 'email'
                : item.key === 'divertVerified'
                  ? 'divert'
                  : item.key === 'textBackProof'
                    ? 'text_back'
                    : null;
          const proof =
            proofChannel === null
              ? null
              : proofChannel === 'sms'
                ? proofs.escalationHandset
                : proofChannel === 'email'
                  ? proofs.emailPipe
                  : proofChannel === 'text_back'
                    ? proofs.textBack
                    : proofs.divertVerification;
          // ALL FOUR PROOF ROWS CARRY A FORM: the verification call's arm
          // landed in `recordProofAction` with the divert console (11-05), and
          // it refuses server-side while the number is not active; the
          // text-back proof's arm (12-08) refuses while text-back is off.
          const formChannel: ProofSlot | null = proofChannel;
          // THE DATE IS COMPOSED HERE, NOT DERIVED HERE. The core answered
          // "satisfied, and the artefact is this"; the date arrives already
          // formatted in the CLIENT's zone from the page, and joining the two
          // into one sentence is copy — which is this file's job (06-01's rule:
          // cores return outcomes, copy lives in one mapping). Composing it in
          // the core would have made that module format a date in the runner's
          // timezone; composing it twice would have put the id in the badge and
          // again under it.
          //
          // A VERIFICATION CALL THAT DOES NOT MEET THE STRICT RULE (WR-02-strict)
          // is never "verified on": the core marked it unmet, and its detail —
          // the recorded id and "needs a diverted call…" — is what is shown.
          const badgeText = proof
            ? proofChannel === 'divert'
              ? item.satisfied
                ? `verified on ${proof.recordedOn} · ${proof.artefactId}`
                : item.detail
              : `recorded on ${proof.recordedOn} · ${proof.artefactId}`
            : item.detail;

          return (
            <li key={item.key}>
              <div className="row">
                <span>{ITEM_LABELS[item.key]}</span>

                {item.satisfied ? (
                  <span className="badge badge--ok badge--wrap">
                    {/* THE FACT ITSELF WHERE ONE EXISTS. "done" beside "Contact
                        hours set" is a boolean an operator cannot check; the
                        window and its zone is the thing they came to read. On a
                        proof row it is the date and the artefact id — the two
                        things somebody re-checking this would need. */}
                    {badgeText ?? 'done'}
                  </span>
                ) : (
                  <span className="badge badge--warn badge--wrap">{badgeText ?? 'not yet'}</span>
                )}
              </div>

              {!item.satisfied && fix ? (
                <p className="meta">
                  <Link href={fix.href(tenantId)}>{fix.label}</Link>
                </p>
              ) : null}

              {attested ? (
                <AttestRow
                  attestation={attestation}
                  formAction={formAction}
                  pending={pending}
                  state={state}
                />
              ) : null}

              {formChannel ? (
                <ProofRow
                  channel={formChannel}
                  proof={proof}
                  formAction={proofAction}
                  pending={proofPending}
                  state={
                    last?.channel === formChannel && last.kind === 'proof'
                      ? proofState
                      : BLANK_PROOF_STATE
                  }
                  onTap={() => setLast({ channel: formChannel, kind: 'proof' })}
                />
              ) : null}

              {item.key === 'divertVerified' ? <DivertHealthLine divert={divert} /> : null}

              {armChannel ? (
                <ArmRow
                  channel={armChannel}
                  arming={arming}
                  armedClients={armedClients}
                  audit={
                    armChannel === 'sms'
                      ? audit.sms
                      : armChannel === 'email'
                        ? audit.email
                        : audit.textBack
                  }
                  armAction={armAction}
                  disarmAction={disarmAction}
                  pending={armPending || disarmPending}
                  state={
                    last?.channel === armChannel
                      ? last.kind === 'arm'
                        ? armState
                        : disarmState
                      : BLANK_ARM_STATE
                  }
                  onTap={setLast}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * ONE MUTED LINE UNDER THE VERIFICATION ROW: when did a diverted call last
 * arrive (CAP-05, D-09).
 *
 * The count is the core's (`daysSinceLastCall`, floored whole 24-hour periods,
 * derived at read time and never stored); the date is the page's, in the
 * client's zone. This component only picks the words — "today" for zero, because
 * "0 days ago" reads like a fault.
 */
function DivertHealthLine({ divert }: { divert: ChecklistCardDivert }) {
  if (divert.lastCallOn === null) {
    return <p className="muted meta">No diverted call yet.</p>;
  }

  const days = divert.daysSinceLastCall ?? 0;
  const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;

  return <p className="muted meta">{`Last diverted call ${divert.lastCallOn} — ${ago}`}</p>;
}

/**
 * The one attested row.
 *
 * UNMET → the disclosure with the required-note form. MET → the attested line,
 * plus the stale badge at 30 days — and the form again, because re-attesting is
 * the whole remedy for staleness and hiding it behind "already done" would
 * leave the nag with nothing to act on.
 *
 * THERE IS NO "SKIP THIS" OR "MARK OFF WITHOUT CHECKING" AFFORDANCE, and there
 * must never be one: the gate exists precisely for the moment somebody is in a
 * hurry, and that is the moment ONB-04's harm — our follow-up arriving beside
 * ServiceM8's own — actually happens.
 */
function AttestRow({
  attestation,
  formAction,
  pending,
  state,
}: {
  attestation: { attestedOn: string | null; note: string | null; isStale: boolean };
  formAction: (payload: FormData) => void;
  pending: boolean;
  state: { error: string | null; success: string | null };
}) {
  const attested = attestation.attestedOn !== null;

  return (
    <>
      {attested ? (
        <p className="meta">
          Verified off — {attestation.attestedOn}
          {attestation.note ? ` · “${attestation.note}”` : ''}
          {attestation.isStale ? (
            <>
              {' '}
              {/* A NAG, NOT A LOCK (D-15). The attestation is still valid and
                  the gate is still open; this asks a human to look again. */}
              <span className="badge badge--warn">stale — re-attest</span>
            </>
          ) : null}
        </p>
      ) : null}

      <details className="disclosure" open={!attested || attestation.isStale}>
        <summary>{attested ? 'Record it again' : "Record it's off"}</summary>

        <form action={formAction}>
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

          <label htmlFor="attest-note">How did you verify it?</label>
          <p className="muted meta">
            Open the client&rsquo;s ServiceM8 &rarr; Settings &rarr; Automation and confirm
            Quote Follow Up is off, then say what you saw.
          </p>
          {/* REQUIRED, and NO placeholder and NO defaultValue — a prefilled
              textarea is a checkbox with extra steps, and the typing IS the
              deliberation (T-5-12). `required` is the browser's copy of a rule
              the action and the column both enforce; it is the courtesy layer,
              never the guard. */}
          <textarea id="attest-note" name="note" rows={3} required disabled={pending} />

          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : "Record it's off"}
          </button>
        </form>
      </details>
    </>
  );
}

/**
 * THE EVIDENCE FORM, for one proof slot (ARM-03 / DOM-04, D-02; the divert
 * verification call, CAP-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT ASKS FOR AN ARTEFACT ID, AND THERE IS NO WAY TO SUBMIT IT WITHOUT     │
 * │ ONE. That is the whole difference between this row and the attestation   │
 * │ row above it: an attestation is a human saying "I looked", a proof       │
 * │ carries the id of the thing they looked at, so a second person can go    │
 * │ and look at it too — months later, when nobody remembers.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THERE IS NO "MARK AS PROVEN" AFFORDANCE and there must never be one. The
 * action verifies the pasted id against a LIVE row — an escalation of this
 * tenant whose outcome is `sent`, a Resend email whose `last_event` is
 * `delivered`, a missed call of this tenant whose status is `completed` — so
 * a checkbox here would not merely be weaker, it would be a
 * control that cannot write anything.
 *
 * RECORDED → the form stays, collapsed, because re-proving is legitimate: a
 * client who changes their escalation handset has proven yesterday's number,
 * not today's, and the table is append-only precisely so the new proof can be a
 * new row.
 */
function ProofRow({
  channel,
  proof,
  formAction,
  pending,
  state,
  onTap,
}: {
  channel: ProofSlot;
  proof: ChecklistCardProof | null;
  formAction: (payload: FormData) => void;
  pending: boolean;
  state: { error: string | null; success: string | null };
  onTap: () => void;
}) {
  const recorded = proof !== null;
  const kind = PROOF_KIND[channel];
  const fieldId = `proof-${channel}`;

  return (
    <details className="disclosure" open={!recorded}>
      <summary>{recorded ? 'Record it again' : 'Record proof'}</summary>

      <form action={formAction}>
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

        {/* THE KIND IS NOT THE OPERATOR'S CHOICE. It is decided by which row
            this form is on; the action re-derives the channel from it and
            refuses if that channel is not armed. */}
        <input type="hidden" name="kind" value={kind} />

        <label htmlFor={`${fieldId}-artefact`}>
          {channel === 'divert' || channel === 'text_back' ? 'Missed call id' : 'Artefact id'}
        </label>
        <p className="muted meta">{PROOF_FIELD_HINT[channel]}</p>
        {/* REQUIRED, and no placeholder and no defaultValue: a prefilled
            artefact field is a proof nobody checked. `required` is the
            browser's courtesy copy of a rule the action, the schema and the
            column's CHECK all enforce — never the guard. */}
        <input
          id={`${fieldId}-artefact`}
          name="artefact_id"
          type="text"
          required
          disabled={pending}
        />

        <label htmlFor={`${fieldId}-note`}>What did you observe?</label>
        <p className="muted meta">{PROOF_NOTE_HINT[channel]}</p>
        <textarea id={`${fieldId}-note`} name="note" rows={3} required disabled={pending} />

        <button type="submit" disabled={pending} onClick={onTap}>
          {pending ? 'Recording…' : 'Record proof'}
        </button>
      </form>
    </details>
  );
}

/**
 * THE SWITCH, for one channel.
 *
 * Which controls appear is decided by the TWO ROWS behind this channel, not by
 * the item's green/amber badge: "not armed" is three different situations — no
 * identity at all, the shared row is off, or this client is explicitly held off
 * while the shared row is on — and each has a different next move.
 *
 * ARMING IS ALWAYS TWO TAPS with the consequence stated between them.
 * DISARMING IS ONE, behind a disclosure with a required reason: stopping should
 * never be the harder direction (D-05), but it must be explained (D-04).
 */
function ArmRow({
  channel,
  arming,
  armedClients,
  audit,
  armAction,
  disarmAction,
  pending,
  state,
  onTap,
}: {
  channel: ArmChannel;
  arming: ChecklistCardArming;
  armedClients: readonly ChecklistCardArmedClient[] | null;
  audit: readonly ChecklistCardAuditLine[];
  armAction: (payload: FormData) => void;
  disarmAction: (payload: FormData) => void;
  pending: boolean;
  state: { error: string | null; success: string | null };
  onTap: (last: LastTapped) => void;
}) {
  return (
    <div className="arm-row">
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

      {channel === 'sms' ? (
        <SmsControls
          sms={arming.sms}
          armedClients={armedClients}
          armAction={armAction}
          disarmAction={disarmAction}
          pending={pending}
          onTap={onTap}
        />
      ) : channel === 'email' ? (
        <EmailControls
          email={arming.email}
          armAction={armAction}
          disarmAction={disarmAction}
          pending={pending}
          onTap={onTap}
        />
      ) : (
        <TextBackControls
          textBack={arming.textBack}
          armAction={armAction}
          disarmAction={disarmAction}
          pending={pending}
          onTap={onTap}
        />
      )}

      {audit.length > 0 ? (
        <ul className="meta arm-audit">
          {audit.map((line, index) => (
            <li key={`${line.action}-${line.on}-${index}`}>
              {line.action === 'arm' ? 'Armed' : 'Off'} · {line.on} · {line.scope}
              {/* D-21: a system disarm says so — never presented as a hand. */}
              {line.actor === 'system' ? ' · system' : ''}
              {line.reason ? ` · ${line.reason}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SmsControls({
  sms,
  armedClients,
  armAction,
  disarmAction,
  pending,
  onTap,
}: {
  sms: ChecklistCardArming['sms'];
  armedClients: readonly ChecklistCardArmedClient[] | null;
  armAction: (payload: FormData) => void;
  disarmAction: (payload: FormData) => void;
  pending: boolean;
  onTap: (last: LastTapped) => void;
}) {
  const ownRow = sms.tenantRow;
  const number = sms.from ?? 'the shared number';

  return (
    <>
      {/* THE SHARED-ROW ARM. Offered when this client rides the shared row and
          that row is off — which is the state every client is in before the
          first go-live, so this is the tap that starts the product. */}
      {ownRow === null && !sms.globalEnabled ? (
        <ArmConfirm
          label="Arm SMS for every client"
          confirmLabel="Yes — arm SMS for every client"
          /* THE CLAUSE IS SHARED WITH THE RECEIPT (10-03, D-03). The names
             come from the page's own read; the sentence is built in
             `action-state.ts` so the warning and the confirmation cannot
             describe two different sets of clients. */
          warning={smsBlastRadiusSentence(armedClients, number)}
          hidden={{ channel: 'sms', target: 'everyone' }}
          formAction={armAction}
          pending={pending}
          onTap={() => onTap({ channel: 'sms', kind: 'arm' })}
        />
      ) : null}

      {/* THE OVERRIDE LIFT. This client is explicitly held off; arming them
          touches nobody else, and the warning says so. */}
      {ownRow !== null && !ownRow.enabled ? (
        <ArmConfirm
          label="Turn SMS back on for this client"
          confirmLabel="Yes — turn SMS on for this client"
          warning={`This lifts this client's override on the next tick. Real customer messages will send to THIS client's customers from ${number}. Nobody else is affected. A message that has left cannot be recalled.`}
          hidden={{ channel: 'sms', target: 'client' }}
          formAction={armAction}
          pending={pending}
          onTap={() => onTap({ channel: 'sms', kind: 'arm' })}
        />
      ) : null}

      {/* PER-CLIENT OFF. Offered whenever this client is currently sending —
          on the shared row or on their own. */}
      {(ownRow === null && sms.globalEnabled) || ownRow?.enabled ? (
        <DisarmForm
          summary="Turn SMS off for this client only"
          note="Writes an OFF override for this client. The shared number stays as it is for everybody else."
          hidden={{ channel: 'sms', scope: 'client' }}
          formAction={disarmAction}
          pending={pending}
          fieldId="disarm-sms-client"
          onTap={() => onTap({ channel: 'sms', kind: 'disarm' })}
        />
      ) : null}

      {/* THE BIG OFF. Offered whenever the shared row is on, whatever this
          client's own row says — the fastest path to "stop everything" must not
          depend on which client's page the operator happens to be looking at. */}
      {sms.globalEnabled ? (
        <DisarmForm
          summary="Turn SMS off for every client"
          note="Stops SMS for every connected client from the next tick."
          hidden={{ channel: 'sms', scope: 'everyone' }}
          formAction={disarmAction}
          pending={pending}
          fieldId="disarm-sms-everyone"
          onTap={() => onTap({ channel: 'sms', kind: 'disarm' })}
        />
      ) : null}
    </>
  );
}

function EmailControls({
  email,
  armAction,
  disarmAction,
  pending,
  onTap,
}: {
  email: ChecklistCardArming['email'];
  armAction: (payload: FormData) => void;
  disarmAction: (payload: FormData) => void;
  pending: boolean;
  onTap: (last: LastTapped) => void;
}) {
  // NO ROW, NO CONTROL. The identity is created at /settings/email — arming a
  // row that does not exist is not a thing this card can offer, and pretending
  // otherwise would put a button here that can only ever refuse.
  if (email.tenantRow === null) {
    return (
      <p className="meta">
        Add this client&rsquo;s email identity first — <Link href="/settings/email">Email settings →</Link>
      </p>
    );
  }

  if (!email.tenantRow.enabled) {
    return (
      <ArmConfirm
        label="Arm email"
        confirmLabel="Yes — arm email for this client"
        warning={`This arms email for this client on the next tick, from ${email.from ?? 'their saved identity'}. Cadence follow-ups send by SMS; email arming covers this client's sending identity, which the email pipe proof uses.`}
        hidden={{ channel: 'email', target: 'client' }}
        formAction={armAction}
        pending={pending}
        onTap={() => onTap({ channel: 'email', kind: 'arm' })}
      />
    );
  }

  return (
    <DisarmForm
      summary="Turn email off"
      note="Stops email for this client from the next tick. SMS is unaffected."
      hidden={{ channel: 'email', scope: 'client' }}
      formAction={disarmAction}
      pending={pending}
      fieldId="disarm-email-client"
      onTap={() => onTap({ channel: 'email', kind: 'disarm' })}
    />
  );
}

/**
 * THE TEXT-BACK SWITCH, FOR THIS CLIENT ONLY (Phase 12, D-09) — the
 * `EmailControls` mould.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THERE IS NO "EVERY CLIENT" CONTROL HERE AND NONE MAY BE ADDED. Both      │
 * │ forms post `target` / `scope` = `client`; the action refuses `everyone`. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Turning it on is two taps with the consequence in words between them; the
 * gate is re-read on the server, so a refusal names the first missing row.
 * Turning it off is one tap and a reason, and is never gated.
 */
function TextBackControls({
  textBack,
  armAction,
  disarmAction,
  pending,
  onTap,
}: {
  textBack: ChecklistCardArming['textBack'];
  armAction: (payload: FormData) => void;
  disarmAction: (payload: FormData) => void;
  pending: boolean;
  onTap: (last: LastTapped) => void;
}) {
  if (!textBack.armed) {
    return (
      <ArmConfirm
        label="Turn text-back on for this client"
        confirmLabel="Yes — turn text-back on for this client"
        warning="From the next missed call, callers to this client's diverted number get the attested text from the shared SMS number. Nobody else is affected. A text that has left cannot be recalled."
        hidden={{ channel: 'text_back', target: 'client' }}
        formAction={armAction}
        pending={pending}
        onTap={() => onTap({ channel: 'text_back', kind: 'arm' })}
      />
    );
  }

  return (
    <DisarmForm
      summary="Turn text-back off for this client"
      note="Stops text-backs for this client from the next missed call. The greeting keeps answering and calls keep being logged."
      hidden={{ channel: 'text_back', scope: 'client' }}
      formAction={disarmAction}
      pending={pending}
      fieldId="disarm-text-back-client"
      onTap={() => onTap({ channel: 'text_back', kind: 'disarm' })}
    />
  );
}

/**
 * ARM-THEN-CONFIRM. The consequence is stated BETWEEN the two taps rather than
 * after them — this warning is the sentence the arm step exists to show.
 *
 * Not a `confirm()` dialog: a browser dialog is dismissed by muscle memory, it
 * cannot carry the number being armed, and it renders nothing a screen reader
 * announces as an alert.
 */
function ArmConfirm({
  label,
  confirmLabel,
  warning,
  hidden,
  formAction,
  pending,
  onTap,
}: {
  label: string;
  confirmLabel: string;
  warning: string;
  hidden: { channel: ArmChannel; target: 'everyone' | 'client' };
  formAction: (payload: FormData) => void;
  pending: boolean;
  onTap: () => void;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} disabled={pending}>
        {label}
      </button>
    );
  }

  return (
    <>
      <p className="kill-warning" role="alert">
        {warning}
      </p>
      <form action={formAction}>
        <input type="hidden" name="channel" value={hidden.channel} />
        <input type="hidden" name="target" value={hidden.target} />
        <button type="submit" className="kill-armed" disabled={pending} onClick={onTap}>
          {pending ? 'Arming…' : confirmLabel}
        </button>
      </form>
      <button type="button" onClick={() => setArmed(false)} disabled={pending}>
        Cancel
      </button>
    </>
  );
}

/**
 * The disarm form: one tap behind a disclosure, with a REQUIRED reason.
 *
 * No confirm step, deliberately. Stopping must never be the harder direction —
 * but the reason is the audit record, and the column's CHECK refuses an empty
 * one, so the textarea is `required` and carries no placeholder to submit
 * unchanged.
 */
function DisarmForm({
  summary,
  note,
  hidden,
  formAction,
  pending,
  fieldId,
  onTap,
}: {
  summary: string;
  note: string;
  hidden: { channel: ArmChannel; scope: 'everyone' | 'client' };
  formAction: (payload: FormData) => void;
  pending: boolean;
  fieldId: string;
  onTap: () => void;
}) {
  return (
    <details className="disclosure">
      <summary>{summary}</summary>

      <form action={formAction}>
        <p className="muted meta">{note}</p>

        <input type="hidden" name="channel" value={hidden.channel} />
        <input type="hidden" name="scope" value={hidden.scope} />

        <label htmlFor={fieldId}>Why?</label>
        <textarea id={fieldId} name="reason" rows={2} required disabled={pending} />

        <button type="submit" disabled={pending} onClick={onTap}>
          {pending ? 'Turning off…' : summary}
        </button>
      </form>
    </details>
  );
}
