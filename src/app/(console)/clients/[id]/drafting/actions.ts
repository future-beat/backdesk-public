'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { countSeptets, normalizeForGsm7, segmentCount } from '@/core/drafting/gsm7';
import { approveTemplateVersion, unapprovedTouchNumbers } from '@/core/drafting/onboarding-gate';
import { formatInTenantZone } from '@/core/shared/tenant';
import { forTenant } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import {
  alreadyApprovedMessage,
  APPROVAL_NOTE_REQUIRED_MESSAGE,
  APPROVAL_NOTE_TOO_LONG_MESSAGE,
  approvedSetCompleteMessage,
  approvedStillWaitingMessage,
  BAD_REQUEST_MESSAGE,
  BLANK_DRAFTING_STATE,
  type DraftingState,
  SESSION_EXPIRED_MESSAGE,
  TEMPLATE_BODY_REQUIRED_MESSAGE,
  TEMPLATE_BODY_TOO_LONG_MESSAGE,
  TEMPLATE_NO_CHANGE_MESSAGE,
  TEMPLATE_NOT_FOUND_MESSAGE,
  templateLongWarning,
  templateSavedMessage,
  UNKNOWN_CLIENT_MESSAGE,
  VOICE_EXAMPLE_TOO_LONG_MESSAGE,
  VOICE_FIELD_TOO_LONG_MESSAGE,
  VOICE_PROFILE_SAVED_MESSAGE,
  VOICE_TOO_MANY_BANNED_MESSAGE,
  VOICE_TOO_MANY_EXAMPLES_MESSAGE,
} from './action-state';

export type { DraftingState };

/**
 * THE ONB-03 ONBOARDING WRITES, as server actions.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY EXPORT BELOW IS A GLOBALLY-POSTABLE ENDPOINT. Server Action ids are │
 * │ global: any of these can be invoked by POSTing its id to ANY route,       │
 * │ including one the proxy never sees, and the (console) layout's own gate   │
 * │ runs when a LAYOUT renders — which is after the action has finished.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So every one opens with `authorize(tenantId)` BEFORE reading a byte of
 * `formData` (WR-01), and that authorization is an RLS-scoped read made with the
 * OPERATOR'S OWN JWT. It is the whole cross-tenant defence: everything below it
 * writes through `forTenant()`, the service-role path, where RLS is inert by
 * design. `authenticated` holds SELECT and nothing else on `message_templates`
 * (migration 0028) precisely so these writes have to come through here.
 *
 * ── ONE OF THESE OPENS THE ACTIVATION GATE, AND THAT IS THE THREAT (T-5-18) ─
 *
 * `attestTemplateApproval` is the single act in this codebase that resumes an
 * onboarding-paused cadence — no operator resume can (05-03), by matrix arm and
 * by database predicate. An unauthenticated POST to it would therefore start
 * real SMS to a stranger's customers in a tradie's name, using wording nobody
 * approved, through the one door that is *supposed* to open. The gate above it
 * is not a formality; it is the reason the rest of the gate means anything.
 *
 * ── NO "RESUME ANYWAY" EXISTS HERE, DELIBERATELY (05-03's closing note) ─────
 *
 * The refusal is the product. The only affordance this surface offers beside a
 * gated cadence is the one that supplies the missing fact: approved words.
 *
 * ── OPERATOR TEXT ENTERS A PROMPT, SO IT IS SANITIZED AT THIS BOUNDARY ──────
 *
 * Voice profiles and template bodies become the drafting prompt's system block.
 * The operator is the sole trusted author in v1 (T-5-19 accepted), so this is
 * not a defence against them — it is a defence against what they paste. Control
 * and invisible characters are stripped and every field is length-capped;
 * `validateDraft` and the human review gate remain the boundaries that matter.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bounded strings, per D-05. Each cap is a prompt-size decision, not politeness. */
const FIELD_MAX = 500;
const EXAMPLE_MAX = 480;
const EXAMPLES_MAX = 3;
const BANNED_PHRASE_MAX = 100;
const BANNED_PHRASES_MAX = 20;
const TEMPLATE_BODY_MAX = 480;
const APPROVAL_NOTE_MAX = 500;

/** D-03: a draft over two segments is rejected by the validator. */
const SEGMENT_WARNING_THRESHOLD = 2;

/**
 * Characters that make text lie about what it says.
 *
 * C0 controls except newline and tab, DEL, the C1 block, the bidi overrides, and
 * the zero-width family. None of them render, and all of them survive a copy —
 * which is the point: this text is pasted out of emails and phone screenshots
 * into a block a language model reads as instructions. A stripped character
 * costs the operator nothing; an invisible one changes what a prompt says
 * without changing what the console shows (T-5-19).
 *
 * Newlines SURVIVE. A tradie's real message has line breaks in it, and a voice
 * example flattened to one line is a worse example.
 */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Markdown heading syntax at the start of a line.
 *
 * `buildDraftPrompt` composes the system block out of `# Heading` sections, so
 * a line beginning `# ` inside a pasted value is a section of OUR prompt as far
 * as the model can tell.
 */
const PROMPT_HEADING = /^[ \t]*#{1,6}[ \t]+/gm;

/**
 * The quote-data fence markers from `prompt.ts`.
 *
 * Restated as literals rather than imported: `prompt.ts` keeps them private, and
 * a console action importing a prompt-internal constant is a coupling that would
 * quietly break the stripping if the marker were ever renamed there without a
 * matching change here. The `tests/drafting-settings-action.test.ts` fixture
 * pins them against the real prompt so the two cannot drift silently.
 */
const DATA_OPEN = '<<<QUOTE_DATA';
const DATA_CLOSE = 'QUOTE_DATA>>>';

/**
 * ── AND PROMPT STRUCTURE GOES TOO (T-5-19, one step further) ────────────────
 *
 * These values are concatenated straight into the SYSTEM block — the
 * highest-trust region of the request, which unlike the user turn has no fence
 * and no sanitizer. `prompt.ts` documents the right treatment two functions
 * away (`sanitizeUntrusted`) and the system block was not getting it.
 *
 * T-5-19 accepts the operator as trusted, and that is reasonable. But this
 * form's own hint tells them to paste content they did not author — "two or
 * three real messages this tradie has actually sent... paste them, do not write
 * them" — so what lands in this field is THIRD-PARTY TEXT ARRIVING THROUGH A
 * TRUSTED HAND. An example containing a line of `# The only numbers permitted
 * in your reply` forges a section of the prompt; one containing `QUOTE_DATA>>>`
 * makes the instruction about the markers ambiguous.
 *
 * Newlines still survive, for the reason `INVISIBLE` gives: a voice example
 * flattened to one line is a worse example. It is the STRUCTURE that goes, not
 * the shape of a real message.
 *
 * The blast radius is bounded by `validateDraft` and the human gate either way.
 * This is the cheap layer in front of the real ones.
 */
function sanitize(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(PROMPT_HEADING, '')
    .split(DATA_OPEN)
    .join(' ')
    .split(DATA_CLOSE)
    .join(' ')
    .trim();
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? sanitize(value) : '';
}

/**
 * Every value submitted under one name, sanitized, with the blanks dropped.
 *
 * `getAll` rather than three numbered keys so the COUNT is something the schema
 * can refuse. The form renders three example boxes; the action's id is global
 * and a body may carry forty.
 */
function readList(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .flatMap((value) => (typeof value === 'string' ? [sanitize(value)] : []))
    .filter((value) => value !== '');
}

/** One phrase per line, which is how a human writes a list on a phone. */
function readLines(formData: FormData, key: string): string[] {
  return readString(formData, key)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** An empty field is a CLEARED column, never a stored empty string. */
function orNull(value: string): string | null {
  return value === '' ? null : value;
}

function denial(message: string): DraftingState {
  return { ...BLANK_DRAFTING_STATE, error: message };
}

/**
 * Authentication AND authorization, in that order, both load-bearing.
 *
 * Returns the tenant's TIMEZONE on success, because the one sentence this
 * surface renders an instant in — the write-once attestation refusal — must
 * render it in the client's own wall clock, never the operator's. Reading it
 * here costs nothing: the gate is already selecting the row.
 */
type Authorized = { ok: true; timezone: string } | { ok: false; state: DraftingState };

async function authorize(tenantId: string): Promise<Authorized> {
  if (!UUID_PATTERN.test(tenantId)) {
    return { ok: false, state: denial(UNKNOWN_CLIENT_MESSAGE) };
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return { ok: false, state: denial(SESSION_EXPIRED_MESSAGE) };
  }

  // THE OPERATOR'S OWN JWT, so Postgres decides membership rather than this
  // file. A tenant they are not on returns zero rows, indistinguishable from one
  // that does not exist.
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, timezone')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return { ok: false, state: denial(UNKNOWN_CLIENT_MESSAGE) };
  }

  return { ok: true, timezone: (tenant as { timezone: string }).timezone };
}

function revalidateDrafting(tenantId: string): void {
  revalidatePath(`/clients/${tenantId}/drafting`);
  // The client page carries the follow-up glance and the pause banner, and an
  // approval that resumed four cadences changes both. Refreshing only the page
  // the operator is standing on leaves the other one lying.
  revalidatePath(`/clients/${tenantId}`);
}

/* ------------------------------------------------------------------------- *
 * saveVoiceProfile — D-05
 * ------------------------------------------------------------------------- */

/**
 * The voice profile is the DRAFTING PROMPT'S STABLE PREFIX, so the caps here are
 * a cost decision as well as a safety one — 05-01 measured a live drafting call
 * at 753 input tokens against Sonnet 5's ~1024-token minimum cacheable prefix.
 * A fuller profile is what pushes a tenant's batch over that line.
 *
 * NOTHING IS REQUIRED. A profile can be saved a field at a time between phone
 * calls, and a half-filled one is genuinely better than none: drafting falls
 * back to the approved template and the quote facts alone (see the nullable
 * columns' note in `cadence-settings.ts`), which is thinner and honestly
 * thinner, rather than confidently wrong in somebody else's register.
 */
const voiceProfileSchema = z.object({
  greetingStyle: z.string().max(FIELD_MAX, VOICE_FIELD_TOO_LONG_MESSAGE),
  signOff: z.string().max(FIELD_MAX, VOICE_FIELD_TOO_LONG_MESSAGE),
  formality: z.string().max(FIELD_MAX, VOICE_FIELD_TOO_LONG_MESSAGE),
  voiceNotes: z.string().max(FIELD_MAX, VOICE_FIELD_TOO_LONG_MESSAGE),
  bannedPhrases: z
    .array(z.string().max(BANNED_PHRASE_MAX, VOICE_FIELD_TOO_LONG_MESSAGE))
    .max(BANNED_PHRASES_MAX, VOICE_TOO_MANY_BANNED_MESSAGE),
  exampleMessages: z
    .array(z.string().max(EXAMPLE_MAX, VOICE_EXAMPLE_TOO_LONG_MESSAGE))
    .max(EXAMPLES_MAX, VOICE_TOO_MANY_EXAMPLES_MESSAGE),
});

export async function saveVoiceProfile(
  tenantId: string,
  _previous: DraftingState,
  formData: FormData,
): Promise<DraftingState> {
  // BEFORE the body is read, deliberately. There is nothing in `formData` worth
  // parsing for a caller who is not entitled to this client.
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = voiceProfileSchema.safeParse({
    greetingStyle: readString(formData, 'greeting_style'),
    signOff: readString(formData, 'sign_off'),
    formality: readString(formData, 'formality'),
    voiceNotes: readString(formData, 'voice_notes'),
    bannedPhrases: readLines(formData, 'banned_phrases'),
    exampleMessages: readList(formData, 'example_message'),
  });

  if (!parsed.success) {
    return denial(parsed.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE);
  }

  const { greetingStyle, signOff, formality, voiceNotes, bannedPhrases, exampleMessages } =
    parsed.data;

  await forTenant(tenantId).settings.updateVoiceProfile({
    greetingStyle: orNull(greetingStyle),
    signOff: orNull(signOff),
    formality: orNull(formality),
    voiceNotes: orNull(voiceNotes),
    // An empty list is a CLEARED column, not an empty array: "they have no
    // banned phrases" and "nobody has asked them" are different facts, and the
    // prompt should not render an empty prohibition block for the second one.
    bannedPhrases: bannedPhrases.length === 0 ? null : bannedPhrases,
    exampleMessages: exampleMessages.length === 0 ? null : exampleMessages,
  });

  revalidateDrafting(tenantId);
  return { ...BLANK_DRAFTING_STATE, success: VOICE_PROFILE_SAVED_MESSAGE };
}

/* ------------------------------------------------------------------------- *
 * saveTemplateVersion — D-04, D-08
 * ------------------------------------------------------------------------- */

/**
 * `channel` IS A LITERAL, NOT A DEFAULT (D-04).
 *
 * v1 onboarding requires exactly the five SMS templates. The `subject` column
 * exists on `message_templates` so the email arm needs no migration, and it stays
 * NULL — nothing here authors an email template, and `approvedSetStatus` is
 * SMS-only so no email timing row can hold a client's activation hostage to
 * wording nothing will send.
 *
 * Refusing a submitted `channel=email` rather than coercing it is the difference
 * between "the form does not offer that" and "the system does not do that". The
 * form is a convenience; this is the rule.
 */
/**
 * ── THE BOUND IS THE TENANT'S OWN CADENCE SHAPE, NOT A LITERAL ──────────────
 *
 * This used to be `.max(5)`, which is `DEFAULT_TOUCH_OFFSET_DAYS.length`
 * restated as a number. But the shape is per-tenant CONFIGURATION and is
 * explicitly meant to vary — `cadence/constants.ts` says so in its own header:
 * "onboarding can say 'not three weeks, my quotes go cold in five days' without
 * a deploy". A tenant with a six-touch shape got a "Touch 6 — Needs approved
 * wording" card from `drafting/page.tsx`, whose form posts `touch_number=6`,
 * which a hardcoded 5 refused with "Check the details and try again". That
 * client could never complete the template set, so `hasApprovedTemplateSet`
 * never returned true and every cadence they gained was born
 * `paused(onboarding)` forever, with no error anywhere explaining it.
 *
 * MEMBERSHIP, not a maximum, and the set comes from `approvedSetStatus()` — the
 * exact rows the page renders cards from. So the form and this schema agree by
 * construction rather than by two numbers being kept in step, and a shape with a
 * gap in it (1, 2, 4, 5) is handled without anybody thinking about gaps.
 */
const templateVersionSchema = (touchNumbers: ReadonlySet<number>) =>
  z.object({
    touchNumber: z
      .number(BAD_REQUEST_MESSAGE)
      .int(BAD_REQUEST_MESSAGE)
      .refine((value) => touchNumbers.has(value), BAD_REQUEST_MESSAGE),
    channel: z.literal('sms', BAD_REQUEST_MESSAGE),
    body: z
      .string()
      .min(1, TEMPLATE_BODY_REQUIRED_MESSAGE)
      .max(TEMPLATE_BODY_MAX, TEMPLATE_BODY_TOO_LONG_MESSAGE),
  });

/**
 * Append the next version of one touch's wording, UNAPPROVED (D-08).
 *
 * ── EDITING AN APPROVED TEMPLATE DOES NOT TOUCH THE APPROVED ROW ────────────
 *
 * It inserts version+1 with `approved_at` NULL, and drafting keeps reading
 * MAX(version) WHERE approved — so a live client's follow-ups never go dark
 * mid-edit, and an unapproved rewording changes nothing about what customers
 * receive until somebody attests to it. Saving is not approving; they are two
 * steps of one decision and this action is only the first.
 *
 * ── THE NO-CHANGE REFUSAL IS BYTE EQUALITY, AND NOTHING SOFTER ──────────────
 *
 * A resubmission identical to the current latest version mints nothing. The
 * comparison is `===` between the exact bytes that WOULD be stored and the exact
 * bytes that ARE — no trimming, no case folding, no whitespace collapsing at the
 * comparison. Anything looser would silently equate two templates that read
 * differently to a customer, which is the one thing a versioned wording table
 * must never do. (Sanitization happens BEFORE the comparison, on both sides by
 * construction, because it is what produced the stored bytes in the first place.)
 *
 * The cost of getting this wrong is not a duplicate row: an unapproved copy of
 * an already-approved wording puts its touch back on the "needs approval" list
 * and closes the activation gate over nothing.
 */
export async function saveTemplateVersion(
  tenantId: string,
  _previous: DraftingState,
  formData: FormData,
): Promise<DraftingState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const repo = forTenant(tenantId);

  // THE TENANT'S OWN SHAPE, read before the body is judged — it IS the bound.
  // Scoped through `forTenant`, so this is the shape of the client this call
  // already authorized, never a number the form supplied.
  const shape = await repo.templates.approvedSetStatus();
  const touchNumbers = new Set(shape.map((touch) => touch.touchNumber));

  const rawTouch = readString(formData, 'touch_number');
  const parsed = templateVersionSchema(touchNumbers).safeParse({
    // `Number('')` is 0 and `Number('x')` is NaN, and zod refuses both — so an
    // absent or junk field lands on the same refusal as an out-of-range one.
    // A shape that does not exist yet is an EMPTY set, which refuses everything:
    // there is no touch to write wording for until the cadence shape is seeded.
    touchNumber: rawTouch === '' ? Number.NaN : Number(rawTouch),
    channel: readString(formData, 'channel'),
    body: readString(formData, 'body'),
  });

  if (!parsed.success) {
    return denial(parsed.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE);
  }

  const { touchNumber, channel, body } = parsed.data;

  // Newest first within the touch, so `[0]` is the current latest version —
  // approved or not. The comparison is against the LATEST, not the latest
  // APPROVED: re-saving an unapproved draft of a template unchanged is equally
  // not a new version.
  const [latest] = await repo.templates.listVersions(touchNumber, channel);
  if (latest && latest.body === body) {
    return denial(TEMPLATE_NO_CHANGE_MESSAGE);
  }

  const [created] = await repo.templates.insertVersion({
    touchNumber,
    channel,
    body,
    // D-04: NULL on every sms row, always.
    subject: null,
  });

  if (!created) {
    // The version number is computed inside the INSERT and guarded by a unique
    // index, so zero rows means two operators saved the same touch at the same
    // moment and Postgres refused the loser. Nothing was written; saying so is
    // more useful than a thrown 23505 three layers up.
    return denial(BAD_REQUEST_MESSAGE);
  }

  // ADVISORY, NOT A REFUSAL. The template is prompt input, not a message — the
  // model rewrites it per quote and the validator judges the DRAFT. But a
  // template already over two segments before the model adds a customer name and
  // a price will produce drafts that fail D-03 every time, and the operator
  // should learn that here rather than from an empty approval queue.
  const measured = countSeptets(normalizeForGsm7(body));
  const warning =
    measured.encoding === 'gsm7' && segmentCount(measured.septets) > SEGMENT_WARNING_THRESHOLD
      ? templateLongWarning(segmentCount(measured.septets))
      : '';

  revalidateDrafting(tenantId);
  return {
    ...BLANK_DRAFTING_STATE,
    success: `${templateSavedMessage(touchNumber, created.version)}${warning}`,
  };
}

/* ------------------------------------------------------------------------- *
 * attestTemplateApproval — D-06, and the D-07 gate it opens
 * ------------------------------------------------------------------------- */

/**
 * THE NOTE IS REQUIRED AT THE BOUNDARY AS WELL AS AT THE CORE (T-5-20).
 *
 * `approveTemplateVersion` takes the note as a required PARAMETER, so a caller
 * cannot omit it. It cannot stop a caller passing `''`, and an attestation with
 * an empty evidence string is an approval nobody can later show happened — which
 * is the entire thing `approved_at` is for. D-06 says the operator attests ON THE
 * CLIENT'S BEHALF; the note is where they say how the client said yes.
 */
const attestSchema = z.object({
  versionId: z.uuid(TEMPLATE_NOT_FOUND_MESSAGE),
  note: z
    .string()
    .min(1, APPROVAL_NOTE_REQUIRED_MESSAGE)
    .max(APPROVAL_NOTE_MAX, APPROVAL_NOTE_TOO_LONG_MESSAGE),
});

/**
 * Attest that the client approved this exact wording — and, if it completes the
 * set, open the activation gate.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE ONE ACT THAT RESUMES AN ONBOARDING-PAUSED CADENCE.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * No business rule lives here. `approveTemplateVersion` owns all of it: the
 * write-once guard, the same-transaction re-ask of `hasApprovedTemplateSet`, the
 * reason-scoped resume, and the re-window over exactly the ids that resume
 * RETURNED. This action authorizes the caller, validates two fields, and turns
 * three result kinds into three sentences.
 *
 * `cadencesResumed` is REPORTED rather than assumed, and it is the D-07
 * visibility the plan asks for: the operator who just approved touch 5 finds out
 * that eleven follow-ups which had been piling up, paused, since Tuesday are now
 * live. Zero is an ordinary answer and gets its own sentence.
 */
export async function attestTemplateApproval(
  tenantId: string,
  _previous: DraftingState,
  formData: FormData,
): Promise<DraftingState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = attestSchema.safeParse({
    versionId: readString(formData, 'version_id'),
    note: readString(formData, 'approval_note'),
  });

  if (!parsed.success) {
    return denial(parsed.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE);
  }

  const { versionId, note } = parsed.data;

  const result = await approveTemplateVersion(tenantId, versionId, note, new Date());

  switch (result.kind) {
    case 'approved': {
      revalidateDrafting(tenantId);
      if (!result.setComplete) {
        // Re-read rather than subtract one from what the page rendered: between
        // that render and this write a colleague may have approved another
        // touch, and a stale list sends the operator to a card that is done.
        const remaining = await unapprovedTouchNumbers(forTenant(tenantId));
        return { ...BLANK_DRAFTING_STATE, success: approvedStillWaitingMessage(remaining) };
      }
      return {
        ...BLANK_DRAFTING_STATE,
        success: approvedSetCompleteMessage(result.cadencesResumed, result.rewindowDeferred),
      };
    }
    case 'already_approved':
      // NOT an `error`: nothing failed and the operator did nothing wrong — the
      // wording IS approved, which is the state they were asking for. The
      // sentence carries the stored evidence, in the CLIENT'S timezone, because
      // an operator reading a colleague's approval needs the evidence itself and
      // an operator who double-tapped needs to know nothing broke.
      return {
        ...BLANK_DRAFTING_STATE,
        success: alreadyApprovedMessage(
          formatInTenantZone(result.approvedAt, access.timezone),
          result.approvalNote,
        ),
      };
    case 'not_found':
      // A version belonging to another client is deliberately indistinguishable
      // from one that does not exist — `approveWhereUnapproved` is tenant-scoped
      // and reports both the same way.
      return denial(TEMPLATE_NOT_FOUND_MESSAGE);
  }
}
