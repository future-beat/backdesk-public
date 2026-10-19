/**
 * "WHY IS THIS CLIENT NOT SENDING YET?" — answered once, for both the gate and
 * the screen (ONB-04, D-16).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY DERIVED ITEM HERE COMPUTES FROM THE SAME CONDITION READER THE GATE │
 * │ ASKS. Display and gate cannot disagree, because there is nothing for     │
 * │ them to disagree about — one derivation, two consumers.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * That is `deriveHealth`'s rule (the banner and the badge read one derivation
 * of one row) applied to a seventeen-item list — and to `live`, which is derived
 * from two of those items per channel rather than stored as an eighteenth fact. A checklist that re-derived its
 * "Templates approved" row from `message_templates` would be a SECOND reading
 * of the activation rule — and the second reading is always the one that says
 * green while the gate says no, which is worse than having no checklist at all:
 * the operator stops believing the screen and starts guessing.
 *
 * Two readers in particular are easy to get subtly wrong, and both have a
 * recorded precedent:
 *
 *   TEMPLATES APPROVED  — `hasApprovedTemplateSet`, which reads
 *     `approvedSetStatus()` (driven from the TIMING table). Reading
 *     `message_templates` directly answers "is every wording they happen to
 *     have approved, approved" — vacuously TRUE for a tenant with none, which
 *     is exactly the tenant this list exists to describe (T-5-13).
 *
 *   SMS / EMAIL ARMED   — the PER-TENANT identity resolvers
 *     (`resolveSmsFrom` / `resolveEmailIdentity`), never `anyChannelEnabled`.
 *     That function answers "is sms armed anywhere on this deployment", which
 *     is the DEPLOYMENT question; a client with `enabled = false` on their own
 *     row would read green here while every send of theirs is refused
 *     (04-08 CR-01, the two-readings-of-one-activation-rule defect).
 *
 *   SENDING DOMAIN      — `isSendingDomainVerified`, the predicate
 *     `/settings/email` refuses an unverified from-address with. THREE-STATE,
 *     and a failed read is neither "verified" nor "not yet" but UNKNOWN: during
 *     a Resend outage, "not yet" sends an operator to fix a domain that is fine
 *     and — on the arming path — "verified" would arm email on a domain nobody
 *     has checked (Pitfall 5).
 *
 * ── THE GATE READS THESE ITEMS, AND ONLY SOME OF THEM ───────────────────────
 *
 * `src/core/onboarding/arming.ts` walks a subset of these keys to decide whether
 * arming is permitted (D-01). It reads the list this function returns rather
 * than re-asking the readers, so the refusal an operator gets and the row they
 * are looking at are the same fact. Nothing about arming is decided HERE: this
 * module reports state, including the arming state itself.
 *
 * ── FRAMEWORK-FREE ──────────────────────────────────────────────────────────
 *
 * No `next/*` import and no copy. It returns FACTS; the card owns the labels,
 * the link text and the badge classes (06-01's rule: cores return outcomes,
 * copy lives in one mapping). That is also what keeps this module callable from
 * the digest, which renders no DOM at all.
 */
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import {
  hasApprovedTemplateSet,
  SM8_AUTOMATION_ATTESTATION_KIND,
} from '@/core/drafting/onboarding-gate';
import { isSendingDomainVerified } from '@/core/messaging/resend-domains';
import { resolveEmailIdentity, resolveSmsFrom } from '@/core/messaging/routing-sender';
import { formatContactDays, formatContactTime } from '@/core/shared/tenant';
import { validateTextBackTemplate } from '@/core/leads/template';
import { forTenant, getChannelConfig, isTextBackArmed } from '@/db/repository';
import { TEXT_BACK_VARIANTS } from '@/db/schema';

/**
 * D-15's nag threshold. THIRTY DAYS, AND IT NAGS — IT NEVER PAUSES.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING ON THE STALENESS PATH MAY WRITE A PAUSE, A STATUS OR A REASON.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A calendar rolling over is not evidence that a client switched ServiceM8's
 * own follow-up back on. Stopping a healthy client's follow-ups on that basis
 * would be the product harming the customer it exists to serve, and it would
 * do so silently — the operator would find out when a tradie asked why nothing
 * went out for a fortnight. So staleness produces exactly two things: a badge
 * on this list, and one line in the daily digest.
 *
 * The condition that COULD justify a pause is behavioural — seeing ServiceM8's
 * own follow-up actually go out beside ours — and it is probe-gated, not built
 * (D-15 tier 1). Until it exists, the honest answer to "has this drifted?" is
 * "ask a human to look again", which is what the nag does.
 */
export const ATTESTATION_STALE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between an attestation and now, floored. `null` in, `null` out.
 *
 * FLOORED, so an attestation is "29 days old" for the whole of its thirtieth
 * day and becomes 30 exactly once — which is what makes the boundary below a
 * single testable instant rather than a rounding argument.
 */
export function attestationAgeDays(attestedAt: Date | null, now: Date): number | null {
  if (!attestedAt) return null;
  return Math.floor((now.getTime() - attestedAt.getTime()) / MS_PER_DAY);
}

/**
 * INCLUSIVE at the threshold: exactly 30 days old IS stale.
 *
 * Decided once, here, rather than three times at three call sites — the same
 * reason `stallBoundary()` exists one subsystem over. The inclusive direction
 * matches `deriveUrgency`'s: when a boundary is ambiguous, the tier that
 * prompts a human wins, because the cost of one unnecessary look is a minute
 * and the cost of a missed one is a customer chased twice.
 *
 * NO attestation at all is NOT stale — it is UNMET, which is a different item
 * state and a different sentence. A tenant with nothing on file is answered by
 * `hasSm8AutomationAttestation` (false, and the gate holds); calling that
 * "stale" would put a re-attest nag beside a client who has never attested.
 */
export function isAttestationStale(attestedAt: Date | null, now: Date): boolean {
  const age = attestationAgeDays(attestedAt, now);
  if (age === null) return false;
  return age >= ATTESTATION_STALE_DAYS;
}

/**
 * The seventeen items, in the fixed order the card renders them (06-UI-SPEC §3,
 * extended by ARM-01, by CAP-05 and by TXT-05).
 *
 * THE ORDER IS THE ONBOARDING ORDER, and it is load-bearing twice over: the
 * card renders it, and `firstUnmetGate` walks it to decide WHICH missing thing
 * an arming refusal names. A refusal that names the fifth missing item sends an
 * operator to fix something that will not help until the first one is done.
 *
 * `messagingArmed` (Phase 6) is gone, split into `smsArmed` and `emailArmed`:
 * one row for two channels answered "armed" for a client whose email was on and
 * whose SMS — the channel the cadence actually sends on — was not.
 *
 * THE TWO PROOF ROWS COME LAST, AND THEY COME AFTER THE ARMING ROWS BECAUSE
 * THEY DEPEND ON THEM. A live proof is produced BY the product — a real reply
 * escalating to a real handset, a real email leaving a verified identity — so it
 * cannot exist until the channel is armed, which is why neither is in
 * `ARMING_GATES` and why the order here is also the order an operator does the
 * work in (D-01, the ARM-01/02/03 circularity resolved).
 *
 * THE TWO DIVERT ROWS COME AFTER THAT (Phase 11, CAP-05). `divertNumber` (a
 * Backdesk number is bought and active) and `divertVerified` (a real DIVERTED
 * call that kept its caller was recorded as a proof on the active number) gate
 * `text_back` ONLY — SMS and email arming never depended on the phone line.
 *
 * THE FOUR TEXT-BACK ROWS COME LAST (Phase 12, 12-08, TXT-05, D-09/D-13), in
 * the order the operator does the work: the three wordings attested, the
 * client's own lines on the never-text list, the switch, then the proof that a
 * text-back was delivered. The first two gate `text_back`; the switch and its
 * proof cannot (the D-01 circularity — producing the proof needs the switch on).
 */
export const CHECKLIST_ITEM_KEYS = [
  'sm8Connected',
  'contactHours',
  'voiceProfile',
  'templatesApproved',
  'sm8AutomationOff',
  'escalationPhone',
  'sendingDomainVerified',
  'smsArmed',
  'emailArmed',
  'escalationHandsetProof',
  'emailPipeProof',
  'divertNumber',
  'divertVerified',
  'textBackTemplates',
  'neverTextOwnNumber',
  'textBackArmed',
  'textBackProof',
] as const;

export type ChecklistItemKey = (typeof CHECKLIST_ITEM_KEYS)[number];

export interface ChecklistItem {
  key: ChecklistItemKey;
  satisfied: boolean;
  /**
   * THE ACTUAL FACT, where one exists — the contact window with its zone, the
   * identity a client is armed to send from.
   *
   * `done` is a weaker answer than the thing itself, and on two of these rows
   * the thing itself is what an operator is actually checking: a contact window
   * they believe is 8–5 and is really 8–5 in the WRONG ZONE reads as a green
   * boolean forever. `null` where the item has no fact worth showing.
   */
  detail: string | null;
}

/** What the console needs to render the one attested row (D-15/D-16). */
export interface AttestationState {
  /** The LATEST attestation, on the append-only rows. `null` = never attested. */
  attestedAt: Date | null;
  /** The operator's own words. `null` when there is no attestation. */
  note: string | null;
  /** `>= ATTESTATION_STALE_DAYS`. Never true when `attestedAt` is null. */
  isStale: boolean;
  /** Whole days since the latest attestation, for the digest's sentence. */
  ageDays: number | null;
}

/**
 * WHICH ROW IS IN FORCE, and what it carries — the facts the arm/disarm
 * controls need that a satisfied/unmet boolean cannot express.
 *
 * The card renders a different control for "no rows at all", "the shared row is
 * on and this client has no row of their own" and "this client is explicitly
 * off while the shared row is on", and those three are indistinguishable from
 * `smsArmed.satisfied === false`. The distinction lives here rather than in the
 * card because it is a fact about two database rows, and the card derives
 * nothing (its header's rule).
 */
export interface ChannelArmingState {
  sms: {
    /**
     * The number the effective row carries, ARMED OR NOT — the identity, not
     * the activation. The confirm warning has to name the number it is about to
     * send from, which is precisely the moment it is not sending from it yet.
     */
    from: string | null;
    /** Which row is effective: this client's own, the shared one, or neither. */
    source: 'tenant' | 'global' | 'none';
    /** This client's OWN row, when one exists. `null` = they ride the shared row. */
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
    /** `none` = no identity to check yet. `unknown` = the provider read failed. */
    domain: 'verified' | 'unverified' | 'unknown' | 'none';
  };
  /**
   * THIS CLIENT'S OWN `text_back` ROW (Phase 12, D-09) — from the EXACT-TARGET
   * read `isTextBackArmed`, never the fallback reader: there is no global
   * text-back row for a client to ride. `armed` decides which control the card
   * offers (turn on / turn off); it carries no identity because the switch has
   * none.
   */
  textBack: { armed: boolean };
}

/**
 * ONE RECORDED PROOF, as the card needs it (D-02).
 *
 * The DATE IS A RAW INSTANT here, not a formatted string: this module is
 * framework-free and has no business knowing the tenant's zone (the page formats
 * it in the CLIENT's timezone, because the browser's zone is the operator's and
 * this date belongs to the tradie's business). `null` = never proven, and it
 * must be read that way rather than as "nothing to worry about".
 */
export interface ProofRecord {
  recordedAt: Date;
  /** The observable the claim rests on — never a body, never an address. */
  artefactId: string;
}

/**
 * LIVE IS A DERIVATION OF TWO FACTS, AND IT IS NEVER STORED (D-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `not_armed` → the switch is off. `armed` → real messages can leave, and  │
 * │ nobody has yet watched one arrive. `live` → armed AND a proof row with   │
 * │ an artefact id and an operator's name on it exists.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This is `deriveHealth`'s rule again: a `live` COLUMN would be a second
 * reading of the same two facts, and the second reading is always the one that
 * says live while the channel is disarmed — which on this card would be the
 * screen telling an operator a client is sending when they are not.
 *
 * A STALE ATTESTATION CHANGES NOTHING HERE. D-15's tier 2 is a nag: it puts a
 * badge beside `sm8AutomationOff`, leaves that row satisfied, and never touches
 * arming or `live`.
 */
export type LiveState = 'not_armed' | 'armed' | 'live';

/**
 * DIVERT HEALTH (CAP-05, D-09) — the facts the client page shows beside the two
 * divert rows, and the facts the text-back gate reads (12-08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING HERE IS STORED. "Days since the last diverted call" is derived   │
 * │ at read time from the newest `missed_calls` row, every time. A stored   │
 * │ counter would be a second reading of that row, and the second reading   │
 * │ is always the one that says "rang yesterday" about a divert the tradie  │
 * │ switched off a month ago.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `lastCallAt` is a RAW INSTANT for the `ProofRecord` reason: the page formats
 * it in the CLIENT's zone.
 */
export interface DivertHealth {
  /** The active number, E.164. `null` while pending, failed or never bought. */
  numberE164: string | null;
  /**
   * The ACTIVE row's id — `null` unless `status` is `active`. The verification
   * proof (WR-02) requires the call to have arrived on exactly this number.
   */
  divertNumberId: string | null;
  /** `none` = no `tenant_divert_numbers` row at all. */
  status: 'none' | 'pending' | 'active' | 'failed';
  /** What the greeting says after "you've reached". `null` when no row. */
  spokenName: string | null;
  /**
   * When the row last changed state (`updated_at`) — for a `pending` row, when
   * it was claimed or held. The console shows its age so a claim from two days
   * ago never reads like one from two seconds ago (WR-07). `null` when no row.
   */
  statusSince: Date | null;
  /**
   * The row's stored code: our closed code for a refused purchase on `failed`;
   * the hold code `outcome_unknown` on a `pending` row whose purchase may have
   * gone through (CR-01); `bundle_unattached` on an `active` row Twilio did not
   * show the AU bundle on (WR-09). `null` when there is nothing to say.
   */
  failureCode: string | null;
  /** When the newest captured call started. `null` = no diverted call ever. */
  lastCallAt: Date | null;
  /**
   * Whole 24-hour periods since `lastCallAt`, floored — `attestationAgeDays`,
   * the ONE age rule on this list, reused rather than re-decided. Calendar days
   * in the tenant's zone were considered and rejected: this core is
   * framework-free and formats no dates, and "0" for a call 23 hours ago is the
   * same honest answer the attestation badge already gives.
   */
  daysSinceLastCall: number | null;
}

export interface GoLiveChecklist {
  /** Exactly seventeen, in `CHECKLIST_ITEM_KEYS` order. */
  items: ChecklistItem[];
  attestation: AttestationState;
  arming: ChannelArmingState;
  /** The LATEST proof of each kind, or `null` for never proven (D-02). */
  proofs: {
    escalationHandset: ProofRecord | null;
    emailPipe: ProofRecord | null;
    /** The verification call (CAP-05): a captured `missed_calls` row's id. */
    divertVerification: ProofRecord | null;
    /** A delivered text-back (D-13): the `missed_calls` row id it answered. */
    textBack: ProofRecord | null;
  };
  /** Derived from the armed item AND the proof item, per channel (D-01, D-13). */
  live: { sms: LiveState; email: LiveState; textBack: LiveState };
  /** The divert number and the last diverted call, derived at read time. */
  divert: DivertHealth;
}

/**
 * The Phase 6 name for the same object, kept so nothing else has to move.
 */
export type OnboardingChecklist = GoLiveChecklist;

/**
 * Read every go-live condition for one client.
 *
 * Nineteen independent reads, issued together. They are independent by
 * construction — no item's answer depends on another's — so serialising them
 * would cost the client page nineteen round trips to Sydney for no ordering
 * guarantee anyone needs. (The pool-ceiling note in `src/db/repository/client.ts`
 * applies: the three divert reads joined the existing twelve in the ONE batch,
 * and the four text-back reads joined those fifteen, rather than opening a
 * second batch.)
 * The ONE dependent read (the Resend domain check) waits for the email row,
 * because it needs the from-address that row carries.
 *
 * `deps.isSendingDomainVerified` is INJECTED so the DB-backed suites can run
 * this reader without reaching Resend. It is the only third-party call on the
 * path, and a test tenant whose checklist depends on a live API key is a test
 * that fails for reasons that have nothing to do with the tenant.
 */
export async function readGoLiveChecklist(
  tenantId: string,
  now: Date,
  deps: { isSendingDomainVerified?: typeof isSendingDomainVerified } = {},
): Promise<GoLiveChecklist> {
  const repo = forTenant(tenantId);
  const checkDomain = deps.isSendingDomainVerified ?? isSendingDomainVerified;

  const [
    tenantRows,
    connectionRows,
    settingsRows,
    templatesApproved,
    attestationRows,
    smsFrom,
    emailIdentity,
    smsEffectiveRow,
    smsGlobalRow,
    emailEffectiveRow,
    handsetProofRows,
    emailProofRows,
    divertRows,
    divertProofRows,
    lastCallRows,
    textBackAttested,
    ownLineCount,
    textBackArmed,
    textBackProofRows,
    textBackAttestedBodies,
  ] = await Promise.all([
    repo.tenant.get(),
    repo.connection.get(),
    repo.settings.get(),
    // THE GATE'S OWN READER (see the header). Never a fresh query against
    // `message_templates`.
    hasApprovedTemplateSet(repo),
    repo.attestations.latest(SM8_AUTOMATION_ATTESTATION_KIND),
    // THE PER-TENANT AUTHORITY, never `anyChannelEnabled` (04-08 CR-01).
    resolveSmsFrom(tenantId),
    resolveEmailIdentity(tenantId),
    // The rows BEHIND those two answers. The resolvers say "armed, from this
    // address"; these say which row said so, which is what the controls need.
    getChannelConfig('sms', tenantId),
    getChannelConfig('sms', null),
    getChannelConfig('email', tenantId),
    // THE TWO LIVE PROOFS (D-02). `[]` is "never proven", never "fine" — the
    // only reading that keeps `live` below honest for the client this list
    // exists to describe.
    repo.proofs.latest('escalation_handset_proof'),
    repo.proofs.latest('email_pipe_proof'),
    // THE DIVERT FACTS (CAP-05). They gate `text_back` only (D-09).
    repo.divertNumber.get(),
    repo.proofs.latest('divert_verification_call'),
    repo.missedCalls.latest(),
    // THE TEXT-BACK FACTS (Phase 12, TXT-05). The attested set is driven from
    // TEXT_BACK_VARIANTS (a missing variant reads false, never vacuously true);
    // the switch is the EXACT-TARGET read, never `getChannelConfig`'s fallback.
    repo.textBackTemplates.attestedSetStatus(),
    repo.neverText.countOwnLines(),
    isTextBackArmed(tenantId),
    repo.proofs.latest('text_back_proof'),
    // THE ATTESTED BYTES THEMSELVES (12-REVIEW WR-02), one read per variant —
    // the same `latestAttested` the send path reads, so the row below can ask
    // the send path's question: does this wording still validate TODAY?
    Promise.all(
      TEXT_BACK_VARIANTS.map((variant) => repo.textBackTemplates.latestAttested(variant)),
    ),
  ]);

  const tenant = tenantRows[0] ?? null;
  const connection = connectionRows[0] ?? null;
  const settings = settingsRows[0] ?? null;
  const attestation = attestationRows[0] ?? null;

  const attestedAt = attestation?.attestedAt ?? null;

  // THE LATEST PROOF OF EACH KIND, reduced to the two fields anything downstream
  // is allowed to see. `artefact_detail` stays in the table: it is the provider's
  // own reply, and a card that rendered it would be one schema change away from
  // putting a recipient on screen (T-10-20).
  const handsetProof = handsetProofRows[0] ?? null;
  const emailProof = emailProofRows[0] ?? null;
  const divertProof = divertProofRows[0] ?? null;
  const textBackProof = textBackProofRows[0] ?? null;

  const divert = divertRows[0] ?? null;
  const lastCallAt = lastCallRows[0]?.startedAt ?? null;
  const divertStatus: DivertHealth['status'] =
    divert === null
      ? 'none'
      : divert.status === 'active' || divert.status === 'pending' || divert.status === 'failed'
        ? divert.status
        : // The column CHECK admits only the three; an unknown value read back is
          // not "active", and the honest row for it is the refused one.
          'failed';
  const divertNumberE164 = divertStatus === 'active' ? (divert?.numberE164 ?? null) : null;

  // THE NUMBER ITSELF when active — the tenant key every diverted call resolves
  // through (D-02), and the thing the operator reads out to the tradie. Pending
  // and failed name their state rather than showing a blank "not yet": a failed
  // purchase is a different job from one nobody started.
  const divertNumberDetail =
    divertStatus === 'active'
      ? divert?.failureCode === 'bundle_unattached' && divertNumberE164
        ? // WR-09: the number, and the one thing still wrong with it.
          `${divertNumberE164} · AU bundle not attached at purchase`
        : divertNumberE164
      : divertStatus === 'pending'
        ? divert?.failureCode === 'outcome_unknown'
          ? // CR-01: the purchase may have gone through — never "pending" alone.
            'purchase outcome unknown — do not buy elsewhere'
          : 'purchase pending'
        : divertStatus === 'failed'
          ? `purchase failed: ${divert?.failureCode ?? 'unknown'}`
          : null;

  // THE CONNECTION MUST BE LIVE, NOT MERELY PRESENT. A row whose `paused_at` is
  // set is a dead ServiceM8 key (Phase 2 D-08): the mirror is stale, so nothing
  // this client's cadences believe about a quote can be trusted. A checklist
  // that ticked "connected" for a paused connection would say green on exactly
  // the client whose auth-failed banner is directly above it.
  const sm8Connected = connection !== null && connection.pausedAt === null;

  // ALWAYS SET POST-ONB-01 — there is no default contact window anywhere in
  // this system, by rule (Phase 1), so the operator supplied these at
  // onboarding or the tenant row would not exist. The row is here because the
  // FACT is worth showing, not because the boolean is in doubt.
  const contactHours =
    tenant !== null &&
    tenant.contactHoursStart !== null &&
    tenant.contactHoursEnd !== null &&
    (tenant.contactDays?.length ?? 0) > 0;

  // ANY of the voice columns. Every one is nullable on purpose (a DEFAULT would
  // be this service inventing a tradie's voice), so "set" cannot mean "all six"
  // — a client whose whole register is two example messages is configured.
  const voiceProfile =
    settings !== null &&
    ([settings.greetingStyle, settings.signOff, settings.formality, settings.voiceNotes].some(
      (value) => (value ?? '').trim() !== '',
    ) ||
      (settings.bannedPhrases?.length ?? 0) > 0 ||
      (settings.exampleMessages?.length ?? 0) > 0);

  // ── THE TWO ARMING STATES ───────────────────────────────────────────────
  //
  // A row whose `tenant_id` is this tenant is THEIR row; anything else the
  // effective read returned is the shared row they ride by default. That single
  // comparison is the whole of the override semantics on this side.
  const smsTenantRow = smsEffectiveRow?.tenantId === tenantId ? smsEffectiveRow : null;
  const emailTenantRow = emailEffectiveRow?.tenantId === tenantId ? emailEffectiveRow : null;
  const globalSmsEnabled = smsGlobalRow?.enabled ?? false;

  const smsSource: ChannelArmingState['sms']['source'] =
    smsEffectiveRow === null ? 'none' : smsTenantRow ? 'tenant' : 'global';

  // The domain check is the one third-party read on this path, and it only runs
  // when there is an address to check — a client with no email identity is
  // answered by the row's own "not yet", not by a call to Resend.
  const emailFromAddress = emailTenantRow?.fromAddress ?? null;
  const domainCheck =
    emailFromAddress !== null && emailFromAddress.trim() !== ''
      ? await checkDomain(emailFromAddress)
      : null;

  const domainState: ChannelArmingState['email']['domain'] =
    domainCheck === null
      ? 'none'
      : domainCheck.kind === 'verified'
        ? 'verified'
        : domainCheck.kind === 'unknown'
          ? 'unknown'
          : // `invalid_address` is an address nobody could ever verify, which is
            // the same answer for this row as an unverified domain — and the
            // detail below says which of the two it was.
            'unverified';

  const domainDetail =
    domainCheck === null
      ? emailTenantRow === null
        ? 'no email identity for this client yet'
        : 'no from-address for this client yet'
      : domainCheck.kind === 'verified'
        ? `${domainCheck.domain} verified at Resend`
        : domainCheck.kind === 'unverified'
          ? `${domainCheck.domain} is not verified`
          : domainCheck.kind === 'invalid_address'
            ? 'that from-address is not a valid address'
            : 'could not check the sending domain';

  // WHICH ROW IS SENDING, in the operator's words. The shared-number case names
  // its blast radius in the detail itself, because this row is the only place
  // an operator sees that this client's SMS is on for a reason that has nothing
  // to do with this client.
  const smsArmedDetail = smsFrom
    ? smsSource === 'tenant'
      ? `from ${smsFrom} (this client's row)`
      : `from ${smsFrom} (shared number, every connected client)`
    : smsTenantRow !== null
      ? `off for this client (override) — shared number ${globalSmsEnabled ? 'on' : 'off'}`
      : null;

  const escalationPhone = normalizeAuMobile(tenant?.escalationPhone ?? null) !== null;

  // ── THE VERIFICATION CALL, READ STRICTLY (WR-02-strict, D-09) ───────────
  //
  // The row's EXISTENCE is no longer the test. The verification call is the
  // evidence that the caller's number survives a divert on this client's
  // carrier, and the text-back gate rests on it — so the LATEST proof must say
  // so in its own recorded facts: `caller_present` exactly true, on exactly the
  // ACTIVE divert row. A proof recorded before that rule (or on a number since
  // replaced) stays in the table untouched and reads "recorded, needs a
  // diverted call" — never edited, never deleted; a fresh proof supersedes it.
  const activeDivertId = divertStatus === 'active' ? (divert?.id ?? null) : null;
  const divertProofFacts: Record<string, unknown> = divertProof?.artefactDetail ?? {};
  const divertVerified =
    divertProof !== null &&
    activeDivertId !== null &&
    divertProofFacts.caller_present === true &&
    divertProofFacts.divert_number_id === activeDivertId;

  // ── THE TEXT-BACK ROWS (Phase 12, TXT-05) ───────────────────────────────
  //
  // EVERY variant, read from the status object built over TEXT_BACK_VARIANTS —
  // the `hasApprovedTemplateSet` precedent: "all of the ones that exist are
  // attested" is vacuously true for a client with none.
  const missingVariants = TEXT_BACK_VARIANTS.filter(
    (variant) => textBackAttested[variant] !== true,
  );
  // AN ATTESTED WORDING THAT NO LONGER VALIDATES IS A DEAD SWITCH (12-REVIEW
  // WR-02). `sendTextBack` re-validates the attested body against the
  // tenant's CURRENT name at every send and refuses `no_template` when it
  // fails — a business renamed after attestation silences every text. So this
  // row asks the send path's exact question (validates, AND the stored bytes
  // are the validator's normalised output) and turns unmet when the answer is
  // no, rather than staying green over a client whose callers get nothing. A
  // missing tenant row validates nothing.
  const invalidVariants = TEXT_BACK_VARIANTS.filter((variant, index) => {
    const attested = textBackAttestedBodies[index]?.[0];
    if (attested === undefined) return false; // reported as missing above
    if (tenant === null) return true;
    const validated = validateTextBackTemplate(attested.body, {
      businessName: tenant.name,
      variant,
    });
    return !(validated.ok && validated.normalizedBody === attested.body);
  });
  const textBackTemplates = missingVariants.length === 0 && invalidVariants.length === 0;
  const variantList = (variants: readonly string[]): string =>
    variants.map((variant) => variant.replace(/_/g, ' ')).join(', ');

  const items: ChecklistItem[] = [
    {
      key: 'sm8Connected',
      satisfied: sm8Connected,
      detail: connection ? `key ending in ${connection.keyLast4}` : null,
    },
    {
      key: 'contactHours',
      satisfied: contactHours,
      detail:
        tenant && contactHours
          ? `${formatContactTime(tenant.contactHoursStart)}–` +
            `${formatContactTime(tenant.contactHoursEnd)} ` +
            `${formatContactDays(tenant.contactDays)} (${tenant.timezone})`
          : null,
    },
    { key: 'voiceProfile', satisfied: voiceProfile, detail: null },
    { key: 'templatesApproved', satisfied: templatesApproved, detail: null },
    {
      key: 'sm8AutomationOff',
      // THE ATTESTATION'S EXISTENCE, NOT ITS AGE. A stale attestation still
      // satisfies this row and still opens the gate — the badge beside it says
      // "stale", and that is the whole of D-15's tier 2 (see
      // ATTESTATION_STALE_DAYS).
      satisfied: attestedAt !== null,
      detail: null,
    },
    {
      key: 'escalationPhone',
      satisfied: escalationPhone,
      // THE NUMBER ITSELF, as stored. A green tick beside "escalation phone
      // set" is a boolean an operator cannot check; the number is the thing
      // they came to read, and a hot lead going to the wrong handset is the
      // failure this row exists to make visible.
      detail: tenant?.escalationPhone ?? null,
    },
    {
      key: 'sendingDomainVerified',
      // UNKNOWN IS UNMET, NEVER A PASS (Pitfall 5). A Resend outage must not
      // read as "verified" on the row the email arming gate consults.
      satisfied: domainState === 'verified',
      detail: domainDetail,
    },
    {
      key: 'smsArmed',
      satisfied: smsFrom !== null,
      detail: smsArmedDetail,
    },
    {
      key: 'emailArmed',
      satisfied: emailIdentity !== null,
      detail:
        emailIdentity?.fromAddress ??
        (emailTenantRow !== null ? 'identity saved, not armed' : null),
    },
    {
      key: 'escalationHandsetProof',
      // THE ROW'S EXISTENCE IS THE WHOLE TEST, and it can only exist through
      // `recordProofAction`, which verified the artefact live and tenant-scoped
      // before writing. Nothing here re-checks ClickSend: a checklist that
      // re-verified would be a second reading of the proof rule, and a Resend
      // or ClickSend outage would un-prove a client who is provably live.
      satisfied: handsetProof !== null,
      // THE ARTEFACT ID, because that is the thing somebody re-checks. The DATE
      // is deliberately absent from this string — the page prepends it, formatted
      // in the CLIENT's zone, and a core that formatted dates would be doing it
      // in the runner's.
      detail: handsetProof ? `recorded · ${handsetProof.artefactId}` : null,
    },
    {
      key: 'emailPipeProof',
      satisfied: emailProof !== null,
      detail: emailProof ? `recorded · ${emailProof.artefactId}` : null,
    },
    {
      key: 'divertNumber',
      // ACTIVE, NOT MERELY PRESENT. A pending claim has bought nothing and a
      // failed one never will; neither can receive a diverted call.
      satisfied: divertStatus === 'active',
      detail: divertNumberDetail,
    },
    {
      key: 'divertVerified',
      // STRICT (see `divertVerified` above). The date is the page's to format
      // in the client's zone; the recorded id is shown either way, so the
      // operator can see WHICH call fell short.
      satisfied: divertVerified,
      detail: divertProof
        ? divertVerified
          ? `recorded · ${divertProof.artefactId}`
          : `recorded · ${divertProof.artefactId} · needs a diverted call showing the caller on the active number`
        : null,
    },
    {
      key: 'textBackTemplates',
      satisfied: textBackTemplates,
      // WHICH wordings are still unattested, and which attested ones no longer
      // validate (WR-02) — the things the operator goes to fix.
      detail: textBackTemplates
        ? 'all three attested'
        : [
            ...(missingVariants.length > 0 ? [`not attested: ${variantList(missingVariants)}`] : []),
            ...(invalidVariants.length > 0
              ? [`no longer validates: ${variantList(invalidVariants)}`]
              : []),
          ].join('; '),
    },
    {
      key: 'neverTextOwnNumber',
      // AT LEAST ONE own line. The count, never the numbers: this row renders
      // in a browser and the numbers are the client's own lines.
      satisfied: ownLineCount >= 1,
      detail:
        ownLineCount >= 1
          ? `${ownLineCount} own ${ownLineCount === 1 ? 'line' : 'lines'} listed`
          : null,
    },
    {
      key: 'textBackArmed',
      // THE EXACT-TARGET READ. A missing row is "not armed", never "armed by
      // default" — there is no global text-back row to fall back to (D-09).
      satisfied: textBackArmed,
      detail: null,
    },
    {
      key: 'textBackProof',
      // The escalationHandsetProof rule: the row can only exist through
      // `recordProofAction`, which verified a delivered text of this client.
      satisfied: textBackProof !== null,
      detail: textBackProof ? `recorded · ${textBackProof.artefactId}` : null,
    },
  ];

  // ── LIVE, DERIVED HERE AND NOWHERE ELSE (D-01) ──────────────────────────
  //
  // The inputs are the two facts already computed above: is the channel armed,
  // and is there a proof row. A proof WITHOUT arming stays `armed: false` and so
  // reads `not_armed` — which is the honest answer for a client who was proven
  // live in the morning and disarmed at lunchtime, and the reason the proof row
  // itself stays satisfied (it happened; it is just not the current state).
  const deriveLive = (armed: boolean, proven: boolean): LiveState =>
    armed ? (proven ? 'live' : 'armed') : 'not_armed';

  return {
    items,
    proofs: {
      escalationHandset: handsetProof
        ? { recordedAt: handsetProof.recordedAt, artefactId: handsetProof.artefactId }
        : null,
      emailPipe: emailProof
        ? { recordedAt: emailProof.recordedAt, artefactId: emailProof.artefactId }
        : null,
      divertVerification: divertProof
        ? { recordedAt: divertProof.recordedAt, artefactId: divertProof.artefactId }
        : null,
      textBack: textBackProof
        ? { recordedAt: textBackProof.recordedAt, artefactId: textBackProof.artefactId }
        : null,
    },
    divert: {
      numberE164: divertNumberE164,
      divertNumberId: activeDivertId,
      status: divertStatus,
      spokenName: divert?.spokenName ?? null,
      statusSince: divert?.updatedAt ?? null,
      // The stored code on ANY row: a refusal on `failed`, the hold code on a
      // `pending` row whose purchase outcome is unknown (CR-01).
      failureCode: divert?.failureCode ?? null,
      lastCallAt,
      // DERIVED, NEVER STORED (D-09) — see DivertHealth.
      daysSinceLastCall: attestationAgeDays(lastCallAt, now),
    },
    live: {
      sms: deriveLive(smsFrom !== null, handsetProof !== null),
      email: deriveLive(emailIdentity !== null, emailProof !== null),
      // D-13: the third live line, through the SAME derivation.
      textBack: deriveLive(textBackArmed, textBackProof !== null),
    },
    attestation: {
      attestedAt,
      note: attestation?.note ?? null,
      isStale: isAttestationStale(attestedAt, now),
      ageDays: attestationAgeDays(attestedAt, now),
    },
    arming: {
      sms: {
        from: smsEffectiveRow?.fromAddress ?? null,
        source: smsSource,
        tenantRow: smsTenantRow ? { enabled: smsTenantRow.enabled } : null,
        globalEnabled: globalSmsEnabled,
      },
      email: {
        from: emailTenantRow?.fromAddress ?? null,
        tenantRow: emailTenantRow
          ? {
              enabled: emailTenantRow.enabled,
              fromAddress: emailTenantRow.fromAddress,
              replyTo: emailTenantRow.replyTo,
              businessName: emailTenantRow.businessName,
            }
          : null,
        domain: domainState,
      },
      textBack: { armed: textBackArmed },
    },
  };
}
