/**
 * The drafting pass — one tenant's `needs_draft` queue, once a minute.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONLY OUTCOMES ARE: A DRAFT AWAITING A HUMAN, OR THE TOUCH LEFT       │
 * │ EXACTLY WHERE IT WAS. There is no third branch, and specifically there   │
 * │ is no fallback that sends something (D-10).                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Every failure here — no key, no approved template, an API error, a validator
 * refusal — leaves the touch in `needs_draft` or parks it for a human. The
 * cadence tick runs every minute, so "leave it alone" IS the retry, and the D-14
 * draft lead time means a touch surfaces hours before its slot. A touch that
 * cannot be drafted for an hour is a touch that goes out on time once the
 * problem is fixed.
 *
 * What must NEVER happen is the tempting alternative: filling the template's
 * merge fields in and sending that. It would look like a working system and it
 * would send a customer a message no model wrote and no human read. D-10 forbids
 * it, and the absence of any code path to it here is the enforcement.
 *
 * ── THE BATCH IS PER TENANT, AND THAT IS WHAT MAKES CACHING POSSIBLE (D-09) ─
 *
 * One system block is built ONCE per tenant per pass — their voice profile,
 * their examples, their whole approved template set — and every call in the
 * batch sends those identical bytes with a single `cache_control` breakpoint on
 * them. Calls are issued SEQUENTIALLY, because a cache entry is only readable
 * after the response that wrote it has begun; a parallel batch would write the
 * same entry N times and read it none.
 *
 * The saving is real but small at this volume, and the honest reason to do it
 * this way is not the money: a per-touch prefix means every request is unique,
 * and a unique request is one nobody can compare against another when a voice
 * regression appears.
 *
 * ── AND THE BATCH IS BOUNDED, IN BOTH DIRECTIONS ────────────────────────────
 *
 * `DRAFT_BATCH_LIMIT` caps what one tick will attempt, because 25 sequential
 * calls at a 60s per-call timeout is the worst case this tick's `maxDuration`
 * can absorb (research A6). And the batch is drawn from `listNeedsDraft` FIRST,
 * so touches whose draft failed on an earlier tick are picked up ahead of newly
 * promoted ones — the tracer fed this pass the promotion RETURNING alone, which
 * looks at each touch exactly once and then abandons it forever.
 *
 * ── NOTHING IN THIS FILE LOGS A BODY OR A PROMPT (T-5-03) ───────────────────
 *
 * Not the generated text, not the final text, not the quote description, not the
 * customer's name, and not a caught error's message (which for an SDK error
 * contains the request body — i.e. the whole prompt). Counts and error class
 * names only, via `describeAnthropicError`. The bodies live in `touch_drafts`
 * behind RLS, which is deletable per-customer; a platform log is not.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { describeAnthropicError, type AnthropicFailure } from '@/core/shared/anthropic';
import type {
  Cadence,
  CadenceSettings,
  CadenceTouch,
  Lead,
  MessageTemplate,
  MessageTemplateKind,
  Quote,
  TouchChannel,
  TouchDraft,
} from '@/db/schema';
import type { TouchDraftInsert } from '@/db/repository';
import {
  seedLeadTemplateDefaults,
  type LeadTemplateSeedRepository,
} from '@/core/leads/lead-templates';

import { complianceSuffix } from '../cadence/sender';
import { buildMergeFacts } from './merge-facts';
import {
  buildDraftPrompt,
  PROMPT_VERSION,
  type LeadFacts,
  type QuoteFacts,
  type TouchTemplate,
  type VoiceProfile,
} from './prompt';
import { validateDraft, type DraftViolation } from './validate';

/**
 * The drafting model.
 *
 * NO DATE SUFFIX (CLAUDE.md): the exact id, pinned. It is recorded on every
 * `touch_drafts` row from the first attempt, so changing this constant is
 * visible in the evidence rather than silently rewriting history.
 */
export const DRAFT_MODEL = 'claude-sonnet-5';

/**
 * How many touches one tenant may be drafted for in a single tick.
 *
 * 25 sequential calls against a 60s per-call budget is the worst case the tick
 * route's `maxDuration` (300s, Vercel Fluid) can absorb alongside the other
 * passes — and the worst case is not reachable in practice, because the first
 * retryable failure stops the batch. Research A6's fallback if this ever bites
 * is drafting on its own internal route with its own secret; nothing else about
 * this file would change.
 *
 * Exported because the anti-starvation read takes it as its `limit`, and the
 * cap and the read must be the same number.
 */
export const DRAFT_BATCH_LIMIT = 25;

/**
 * How many RECORDED attempts a single touch may accumulate before this pass
 * stops asking (research Pitfall 4).
 *
 * Five, not two, because the normal path spends at most two per tick and the
 * ceiling is not the D-11 rule — it is the stop on a touch that keeps coming
 * back: a draft rejected, then a regeneration that hit a connection error, is
 * two recorded attempts and a touch still on the queue. Three such ticks and
 * something is wrong with this specific input, not with the minute.
 *
 * A touch that reaches the ceiling is COUNTED AND LEFT ALONE, not retired: the
 * cadence engine's own staleness rules (D-10/D-11) decide whether a touch this
 * late should still go out, and that decision does not belong to the drafter.
 */
export const MAX_DRAFT_ATTEMPTS = 5;

/**
 * How long a drafting claim may be held before another tick may take it back.
 *
 * CRASH RECOVERY ONLY. This pass releases every claim it does not convert to
 * `pending_approval`, so in normal operation nothing ever reaches this window —
 * a touch whose draft failed at 09:01 is claimable again at 09:02 exactly as it
 * was before claims existed. What this number covers is the claim held by a
 * function that was killed mid-batch, where nothing ran the release.
 *
 * Six minutes: longer than the 300s `maxDuration` a killed invocation can have
 * been holding it for, so a tick that is merely SLOW is never robbed of a touch
 * it is actively drafting — which would reintroduce the duplicate paid call the
 * claim exists to prevent. Shorter than anything a customer would notice.
 */
export const DRAFT_CLAIM_STALE_MS = 6 * 60_000;

/**
 * Enough for a two-segment SMS and its overhead, and little enough that a model
 * that starts rambling is cut off rather than billed for.
 */
const MAX_DRAFT_TOKENS = 400;

/**
 * What the model returns. ONE FIELD.
 *
 * A `reasoning` or `notes` field would be model prose about a real customer's
 * job, stored or discarded, that nothing branches on. The draft IS the output.
 */
const DraftOutput = z.object({
  body: z.string(),
});

/** What one `messages.parse` call gives back, narrowed to what this pass reads. */
export interface DraftResponse {
  parsed_output: unknown;
  /**
   * `'refusal'` and `'max_tokens'` are both HTTP 200 outcomes that carry no
   * usable body — see the failure taxonomy. Optional because the seam must stay
   * satisfiable by a four-line fake.
   */
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
  } | null;
}

/**
 * The seam the tick injects across — and the reason the remote suite needs no
 * API key.
 *
 * DELIBERATELY NARROWER THAN `Anthropic`. It exposes the ONE call this pass
 * makes, so a fake in a test is four lines rather than a mock of a client
 * surface, and so nothing here can quietly start using a second endpoint. The
 * real `Anthropic` client satisfies it structurally.
 */
export interface DraftClient {
  messages: {
    parse(body: Anthropic.MessageCreateParamsNonStreaming): Promise<DraftResponse>;
  };
}

/**
 * The repository surface this pass uses — the same narrowing discipline as
 * `DraftClient`, one layer down.
 *
 * Every member is a `Pick` of the real row type, so the failure-matrix suite can
 * build a fake repository out of object literals with no database, no casts and
 * no `as never`. The real `TenantScopedRepository` satisfies this structurally,
 * which the call in `run-tick.ts` typechecks. (05-01 learned what a cast costs
 * here: a `seedTouches` return smuggled in behind `as never` made a throwing-
 * client test pass without the client ever being called.)
 */
export interface DraftRepository {
  settings: {
    get(): Promise<readonly VoiceRow[]>;
  };
  templates: {
    latestApprovedSet(
      channel: TouchChannel,
      kind?: MessageTemplateKind,
    ): Promise<readonly TemplateRow[]>;
    /** The lead-default belt (Phase 13, D-02) — see `seedLeadTemplateDefaults`. */
    ensureLeadDefaults: LeadTemplateSeedRepository['templates']['ensureLeadDefaults'];
  };
  cadences: {
    getById(cadenceId: string): Promise<readonly CadenceRow[]>;
  };
  quotes: {
    byId(quoteId: string): Promise<readonly QuoteRow[]>;
  };
  /** Phase 13 (D-13): the after-hours flag of the lead a lead touch chases. */
  leads: {
    byId(leadId: string): Promise<readonly LeadRow[]>;
  };
  /** Phase 13 (D-13): the caller's newest threaded reply — drafting's one body read. */
  inbound: {
    latestForLead(leadId: string): Promise<string | null>;
  };
  drafts: {
    insertAttempt(row: TouchDraftInsert): Promise<readonly { id: string }[]>;
    latestForTouch(touchId: string): Promise<readonly AttemptRow[]>;
    markSuperseded(draftId: string): Promise<unknown>;
    sentBodiesForCadence(cadenceId: string): Promise<readonly string[]>;
  };
  touches: {
    listNeedsDraft(limit: number): Promise<readonly TouchRow[]>;
    claimForDrafting(
      touchIds: readonly string[],
      now: Date,
      staleBefore: Date,
    ): Promise<readonly { id: string }[]>;
    releaseDraftingClaim(touchIds: readonly string[]): Promise<unknown>;
    bumpDraftFailures(touchId: string): Promise<unknown>;
    markPendingApproval(touchIds: readonly string[]): Promise<unknown>;
  };
}

export type VoiceRow = Pick<
  CadenceSettings,
  'greetingStyle' | 'signOff' | 'formality' | 'bannedPhrases' | 'exampleMessages' | 'voiceNotes'
>;
export type TemplateRow = Pick<MessageTemplate, 'id' | 'touchNumber' | 'version' | 'body'>;
export type AttemptRow = Pick<TouchDraft, 'id' | 'attempt' | 'status'>;
export type CadenceRow = Pick<Cadence, 'quoteId' | 'contactName' | 'anchorAt' | 'kind' | 'leadId'>;
export type LeadRow = Pick<Lead, 'afterHours'>;

/** One kind's approved wording, as the prompt and the per-touch lookup want it. */
interface TemplateSet {
  /** The whole set, for the stable system block. */
  templates: TouchTemplate[];
  /** The row behind each touch number, for the attempt's template id and version. */
  templateByTouch: Map<number, TemplateRow>;
}

function templateSetOf(rows: readonly TemplateRow[]): TemplateSet {
  return {
    templates: rows.map((t) => ({ touchNumber: t.touchNumber, body: t.body })),
    templateByTouch: new Map(rows.map((t) => [t.touchNumber, t])),
  };
}
export type QuoteRow = Pick<Quote, 'jobDescription' | 'totalInvoiceAmount' | 'quoteDateUtc'>;
export type TouchRow = Pick<
  CadenceTouch,
  'id' | 'cadenceId' | 'touchNumber' | 'channel' | 'scheduledAt'
>;

/**
 * Counts only — the T-3-24 discipline this codebase applies to every tick
 * result. Nothing here is a body, an address or an id.
 */
export interface DraftCounts {
  /** Drafted, validated, recorded, and moved to `pending_approval`. */
  drafted: number;
  /**
   * ONB-03 — the tenant has no approved template for this touch. Not an error:
   * they have not finished onboarding. The touch waits for words.
   */
  noApprovedTemplate: number;
  /**
   * ONB-03's other half — no `cadence_settings` row at all, so there is no
   * voice to write in. Counted separately from `noApprovedTemplate` because the
   * two are fixed on different screens, even though both mean "this client is
   * not finished being set up".
   */
  noVoiceProfile: number;
  /**
   * Two attempts and the result was still not sendable — a validator rejection
   * twice, a refusal, or a truncation. The attempts are RECORDED and the touch
   * is parked at `pending_approval` for mandatory edit-then-approve. One per
   * TOUCH, not per attempt.
   */
  validatorFailed: number;
  /** 429 after the SDK's own retries. The tenant's batch stopped here. */
  rateLimited: number;
  /** Connection, 5xx or 529 — their side. The tenant's batch stopped here. */
  apiDeferred: number;
  /**
   * 400/401/403 — OURS, and identical on every retry. No attempt row: there is
   * no model output to be evidence of. The touch stays in `needs_draft` and the
   * batch CONTINUES; see the taxonomy comment in the loop for why.
   */
  deterministicFailed: number;
  /**
   * `MAX_DRAFT_ATTEMPTS` attempts already recorded for this touch, so it was not
   * attempted again (research Pitfall 4). The stop on a poisoned input.
   */
  attemptsExhausted: number;
  /**
   * The arm that means "we do not know": a non-Anthropic throw, a vanished
   * cadence, an unclassifiable API error. Touch untouched. Kept apart from the
   * named arms precisely because collapsing an unknown into a known one is how
   * a new failure mode goes unnoticed for a month.
   */
  deferred: number;
  /**
   * In this tick's batch, but an overlapping tick holds the claim — so this one
   * did not spend a model call on it. NOT an error and NOT lost work: the tick
   * that holds it is drafting it right now.
   *
   * Counted rather than ignored because a non-zero here is the one visible
   * symptom of ticks overlapping, which is the condition the claim exists for.
   * Persistently non-zero means batches are running past 60s and the batch limit
   * or the cron interval wants looking at.
   */
  claimedElsewhere: number;
  /**
   * `1` when there is no `ANTHROPIC_API_KEY` and this pass did not run at all.
   *
   * A FLAG SHAPED LIKE A COUNT, matching `ClassifyCounts.unconfigured` — with no
   * client we do not read the queue, so there is no number of touches to report.
   * It was `touches.length` (this minute's promotions), which in the steady
   * state is zero, so an unconfigured deployment reported the same numbers as a
   * quiet minute. That is the one thing this field must never do.
   */
  unconfigured: number;
}

export const NO_DRAFTS: DraftCounts = {
  drafted: 0,
  noApprovedTemplate: 0,
  noVoiceProfile: 0,
  validatorFailed: 0,
  rateLimited: 0,
  apiDeferred: 0,
  deterministicFailed: 0,
  attemptsExhausted: 0,
  deferred: 0,
  claimedElsewhere: 0,
  unconfigured: 0,
};

export interface DraftTouchesInput {
  repo: DraftRepository;
  tenant: {
    tenantId: string;
    /** `tenants.name` — the Spam Act sender identification in the copy. */
    name: string;
    timezone: string;
  };
  /**
   * The rows `promoteDue` just returned. Already `needs_draft`, and already
   * visible to `listNeedsDraft` — they are passed anyway so a touch promoted by
   * this tick is drafted by this tick even if the queue read raced the promotion
   * write. De-duplicated by id against the queue read below.
   */
  touches: readonly TouchRow[];
  /** `null` when unconfigured — see `buildAnthropicClient`. */
  client: DraftClient | null;
  now: Date;
}

/** Usage counters as they are stored — nulls when the call produced no body. */
interface UsageCounters {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
}

const NO_USAGE: UsageCounters = {
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
};

/**
 * A 200 that carried no usable draft. All three are MODEL OUTPUT EVENTS, which
 * is what separates them from an API failure: the model answered, and what it
 * answered is evidence worth recording.
 */
type UnusableReason = 'refusal' | 'truncated' | 'unparseable';

/** Stored on the attempt row. Safe: it names the failure, never the content. */
const UNUSABLE_DETAIL: Record<UnusableReason, string> = {
  refusal: 'the model declined to write this message (stop_reason: refusal)',
  truncated: 'the model ran past max_tokens before finishing (stop_reason: max_tokens)',
  unparseable: 'the response did not satisfy the draft schema',
};

/** Sent back to the model on the one regeneration a rejection earns. */
const UNUSABLE_FEEDBACK: Record<UnusableReason, string> = {
  // Never sent — a refusal is not regenerated. Present so the record is total.
  refusal: 'Write a shorter, plainer message.',
  truncated:
    'Your previous reply was cut off because it was too long. Write a much shorter message — well under 110 characters.',
  unparseable:
    'Your previous reply was not in the required format. Reply with the message body only, in the required output format.',
};

/**
 * One violation, as a sentence a model can act on (D-11).
 *
 * `nearest` is what makes this worth doing: "you wrote $2,540, which was not
 * provided; the provided value is $2,450" is an instruction, where "invalid
 * number" is a complaint. 05-02 shaped the violations for exactly this.
 */
function violationFeedback(violation: DraftViolation): string {
  const detail = violation.detail ?? '';
  switch (violation.rule) {
    case 'unlisted_number':
      return (
        `You wrote "${detail}", which is not one of the values you were given. ` +
        (violation.nearest === undefined
          ? 'Use only the values listed, exactly as written, or leave the number out.'
          : `The provided value is "${violation.nearest}" — copy it exactly, or leave it out.`)
      );
    case 'unlisted_date_word':
      return `You wrote the date word "${detail}", which was not provided. Do not name a day or month unless it is in the provided values.`;
    case 'non_gsm_character':
      return `The character "${detail}" cannot be sent in a plain SMS. Use plain ASCII letters and punctuation only — no emoji, no curly quotes, no dashes other than a hyphen.`;
    case 'too_many_segments':
      return 'Your message was too long. Write well under 110 characters of your own text.';
    case 'missing_suffix':
      return 'Write only the message body. Do not add a sign-off, an opt-out line or the business name.';
    case 'link':
      return `You wrote "${detail}", which looks like a link or web address. Do not include any link, web address or domain name.`;
    case 'empty_body':
      return 'Your previous reply was empty. Write the message body.';
  }
}

/** What one attempt produced, with API failures already classified. */
type ModelOutcome =
  | { kind: 'body'; body: string; usage: UsageCounters }
  | { kind: 'unusable'; reason: UnusableReason }
  | { kind: 'failed'; failure: AnthropicFailure };

/**
 * The batch: the drafting queue first, this tick's promotions appended, capped.
 *
 * ORDERED BY `scheduled_at` THEN `id` — `claimDue`'s tie-break, and the same one
 * `listNeedsDraft` applies in SQL. Re-sorted here rather than trusted from the
 * read, because the promoted rows arrive from a different statement and a batch
 * whose order depends on which of two queries contributed a row is a batch whose
 * order nobody can reproduce.
 *
 * THE CAP IS APPLIED BEFORE THE SORT, and that is the anti-starvation rule: the
 * queue read (oldest first, including everything a previous tick failed on) fills
 * the 25 slots first, and a newly promoted touch takes a slot only if one is
 * left. Ordering WITHIN the batch is then purely by slot time.
 */
function buildBatch(
  queued: readonly TouchRow[],
  promoted: readonly TouchRow[],
  limit: number,
): TouchRow[] {
  const batch: TouchRow[] = [];
  const seen = new Set<string>();

  for (const touch of [...queued, ...promoted]) {
    if (batch.length >= limit) break;
    if (seen.has(touch.id)) continue;
    seen.add(touch.id);
    batch.push(touch);
  }

  return batch.sort((a, b) => {
    const byTime = a.scheduledAt.getTime() - b.scheduledAt.getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

/**
 * Draft this tenant's queue. Returns counts; writes rows.
 *
 * PER-TOUCH ISOLATION. One touch's failure must not cost the rest of the
 * tenant's queue their drafts — the same rule `runProgressPass` applies per
 * tenant, one level down, because a single quote with an unparseable total
 * would otherwise strand every later touch in the batch.
 */
export async function draftTouches(input: DraftTouchesInput): Promise<DraftCounts> {
  const { repo, tenant, touches, client, now } = input;
  const counts: DraftCounts = { ...NO_DRAFTS };

  // THE QUEUE READ COMES FIRST, and it is what the batch is mostly made of.
  // Skipped entirely when there is no client: an unconfigured deployment must
  // not run a query per tenant per minute to discover that it still has no key.
  if (client === null) {
    // ── A FLAG SHAPED LIKE A COUNT, as in `classify-inbound`. ─────────────
    //
    // `touches.length` was the number of touches promoted THIS MINUTE, and in
    // the steady state that is zero: every touch has already been promoted and
    // is sitting in `needs_draft`. So a deployment with no key reported
    // `touchesPromoted: 0, touchesDrafted: 0, draftingUnconfigured: 0` — byte-
    // identical to a quiet minute with nothing to do, which is the exact failure
    // `listNeedsDraft`'s own header rails against.
    //
    // With no client we do not read the queue, so there is no number of touches
    // to report. One tenant whose drafting could not run is what this says.
    counts.unconfigured = 1;
    return counts;
  }

  const candidates = buildBatch(
    await repo.touches.listNeedsDraft(DRAFT_BATCH_LIMIT),
    touches,
    DRAFT_BATCH_LIMIT,
  );
  if (candidates.length === 0) return counts;

  // ┌──────────────────────────────────────────────────────────────────────────┐
  // │ CLAIM BEFORE SPENDING A MODEL CALL. The read above claimed nothing.      │
  // └──────────────────────────────────────────────────────────────────────────┘
  //
  // pg_cron fires every 60s and does not wait for the response; a full batch of
  // 25 touches at two 60s calls each can occupy the whole 300s budget. So a tick
  // overlapping the next two is this file's own documented worst case, not an
  // exotic one — and two ticks drafting the same touch means two paid Sonnet
  // calls and two `touch_drafts` rows racing for one `attempt` number, which is
  // what can leave the approval screen refusing a draft it is rendering.
  //
  // `claimForDrafting` is a guarded UPDATE ... RETURNING, so exactly one tick
  // gets each id back. Whatever it does not return belongs to somebody else this
  // minute and is not ours to draft. This is drafting's `claimDue`.
  const claimedIds = new Set(
    (
      await repo.touches.claimForDrafting(
        candidates.map((touch) => touch.id),
        now,
        new Date(now.getTime() - DRAFT_CLAIM_STALE_MS),
      )
    ).map((row) => row.id),
  );
  const batch = candidates.filter((touch) => claimedIds.has(touch.id));
  counts.claimedElsewhere += candidates.length - batch.length;
  if (batch.length === 0) return counts;

  /**
   * Every claim this pass is still holding.
   *
   * A touch is removed the moment it is parked at `pending_approval` — it has
   * left the drafting queue and the claim is meaningless. Everything still in
   * here when the loop ends is a touch left in `needs_draft`, and its claim is
   * RELEASED so the next tick picks it up in sixty seconds rather than waiting
   * out `DRAFT_CLAIM_STALE_MS`. That includes the `break` arms: a 429 stops the
   * batch, and the touches it never reached must not be held hostage by it.
   */
  const heldClaims = new Set(batch.map((touch) => touch.id));

  try {
    await draftClaimedBatch({ repo, tenant, client, now, batch, counts, heldClaims });
  } finally {
    // ── THE CLAIM IS ALWAYS GIVEN BACK. ───────────────────────────────────
    //
    // In a `finally` rather than after the call, because the alternative is a
    // repository throw somewhere in the batch stranding every touch it had
    // claimed for six minutes — a customer's follow-up delayed by our own error
    // handling. `DRAFT_CLAIM_STALE_MS` is for the invocation that was KILLED and
    // could not run this; it is not a substitute for running it.
    if (heldClaims.size > 0) {
      try {
        await repo.touches.releaseDraftingClaim([...heldClaims]);
      } catch {
        // Nothing to do about it and nothing worth failing the tick over: the
        // staleness window is exactly the backstop for this. Class-name-free
        // because a repository error may carry row content (T-5-03).
        console.error(
          `[drafting] tenant ${tenant.tenantId}: could not release ` +
            `${heldClaims.size} drafting claim(s); the staleness window will.`,
        );
      }
    }
  }

  return counts;
}

/**
 * The batch, once it is OURS. Split from `draftTouches` for one reason: the
 * claim taken above must be released on every exit, and a `finally` around a
 * call is the only shape that survives a `return`, a `break` and a throw alike.
 *
 * Mutates `counts` and `heldClaims` in place. That is deliberate — the caller
 * still reports the counts accumulated before a throw, and still releases the
 * claims not yet converted, which is the whole point of the split.
 */
async function draftClaimedBatch(args: {
  repo: DraftRepository;
  tenant: DraftTouchesInput['tenant'];
  client: DraftClient;
  now: Date;
  batch: readonly TouchRow[];
  counts: DraftCounts;
  heldClaims: Set<string>;
}): Promise<void> {
  const { repo, tenant, client, now, batch, counts, heldClaims } = args;

  /**
   * `pending_approval` — and the claim goes with it.
   *
   * THE ONLY PLACE `markPendingApproval` IS CALLED, so "left the drafting queue"
   * and "no longer claimed" cannot drift apart. A touch still in `heldClaims`
   * when this batch ends is by construction one still in `needs_draft`.
   */
  const park = async (touchId: string): Promise<void> => {
    await repo.touches.markPendingApproval([touchId]);
    heldClaims.delete(touchId);
  };

  // ── THE STABLE HALF, BUILT ONCE (D-09). ─────────────────────────────────
  const [settings] = await repo.settings.get();
  if (!settings) {
    // No `cadence_settings` row means this tenant has no voice at all. Drafting
    // anyway would produce messages in a stranger's name in a register nobody
    // chose — the ONB-03 belt, in the one place that can see it.
    //
    // The claims stay in `heldClaims` and the caller's `finally` gives them back:
    // these touches are still on the drafting queue and will be again next
    // minute, right up until somebody finishes onboarding this client.
    counts.noVoiceProfile += batch.length;
    return;
  }

  const voiceProfile: VoiceProfile = {
    greetingStyle: settings.greetingStyle,
    signOff: settings.signOff,
    formality: settings.formality,
    bannedPhrases: settings.bannedPhrases,
    exampleMessages: settings.exampleMessages,
    voiceNotes: settings.voiceNotes,
  };

  // THE WHOLE APPROVED SET, not one template per call. This is the caller half
  // of the caching fix 05-02 recorded as missing: the same bytes for every touch
  // of this tenant, long enough to have a chance of clearing Sonnet 5's ~1024
  // token minimum cacheable prefix.
  //
  // ONE SET PER CADENCE KIND (Phase 13, D-02). A lead touch 2 and a quote touch
  // 2 are different messages with different wording; picking by touch number
  // alone would draft a missed caller's follow-up from quote wording. The quote
  // set is read here as it always was; the lead set is read at the first lead
  // touch of the batch, and only then.
  const quoteApproved = await repo.templates.latestApprovedSet('sms', 'quote');
  const quoteSet = templateSetOf(quoteApproved);

  let leadSet: TemplateSet | null = null;
  const leadTemplateSet = async (): Promise<TemplateSet> => {
    if (leadSet !== null) return leadSet;
    let rows = await repo.templates.latestApprovedSet('sms', 'lead');
    if (rows.length === 0) {
      // THE BELT (D-02, "at first use"): a client with no approved lead wording
      // gets the shipped defaults, pre-approved — the operator approves every
      // DRAFT made from them. Idempotent; the arming-time seed is 13-05's.
      await seedLeadTemplateDefaults(repo);
      rows = await repo.templates.latestApprovedSet('sms', 'lead');
    }
    leadSet = templateSetOf(rows);
    return leadSet;
  };

  const suffix = complianceSuffix(tenant.name);

  /** ONE call, its failures already reduced to the closed vocabulary. */
  const ask = async (prompt: {
    system: string;
    user: string;
  }): Promise<ModelOutcome> => {
    let response: DraftResponse;
    try {
      // NO `temperature`, `top_p` or `top_k`, and NO `thinking`: claude-sonnet-5
      // rejects all four with a 400 (research Pitfall, proven live by
      // `verify:drafting`). Their absence is the configuration, not an oversight.
      //
      // ONE `cache_control` BREAKPOINT, ON THE ONE SYSTEM BLOCK. The block is
      // byte-identical for every call in this batch (`buildDraftPrompt` reads
      // nothing per-quote into it, and `prompt.ts` has a test that says so), so
      // the marker describes a prefix that actually repeats. A second breakpoint
      // would buy nothing here: there is only one stable segment.
      response = await client.messages.parse({
        model: DRAFT_MODEL,
        max_tokens: MAX_DRAFT_TOKENS,
        system: [
          {
            type: 'text',
            text: prompt.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: prompt.user }],
        output_config: { format: zodOutputFormat(DraftOutput) },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (error) {
      return { kind: 'failed', failure: describeAnthropicError(error) };
    }

    // ── `stop_reason` IS READ BEFORE THE CONTENT. Both of these arrive as a
    //    perfectly successful HTTP 200, and reading `parsed_output` first would
    //    turn a refusal into an indistinguishable "schema not satisfied".
    if (response.stop_reason === 'refusal') {
      return { kind: 'unusable', reason: 'refusal' };
    }
    if (response.stop_reason === 'max_tokens') {
      return { kind: 'unusable', reason: 'truncated' };
    }

    // `parsed_output` is null when the output did not satisfy the schema. The
    // SDK does not throw for it, so an unchecked read here would put
    // `undefined` into a body column.
    const parsed = DraftOutput.safeParse(response.parsed_output);
    if (!parsed.success) return { kind: 'unusable', reason: 'unparseable' };

    return {
      kind: 'body',
      body: parsed.data.body.trim(),
      usage: {
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? null,
      },
    };
  };

  /**
   * Apply an API failure. Returns whether the tenant's batch should STOP.
   *
   * ── WHY TWO ARMS STOP AND ONE DOES NOT ──────────────────────────────────
   *
   * A 429 or an outage is ACCOUNT-WIDE: the next 24 calls fail the same way, so
   * continuing is hammering a service that has just asked us not to, and every
   * one of those touches is retried by the next tick anyway.
   *
   * A 400/401/403 is deployment-wide OR touch-specific and we cannot tell which
   * from here — and that ambiguity is exactly why this arm CONTINUES. Stopping
   * on a touch-specific 400 (an unusual job description, say) would park it at
   * the head of an oldest-first queue and block every later touch of that tenant
   * behind it, silently, every minute, until a human noticed. Continuing costs a
   * burst of fast failures on a deploy bug — 4xx responses are not billed — and
   * a deploy bug fails on every tenant at once, which is loud in the counts.
   */
  const applyFailure = async (
    failure: AnthropicFailure,
    touchId: string,
  ): Promise<boolean> => {
    // Class name and status ONLY — never the message, which for an SDK error
    // carries the request body, i.e. the whole prompt (T-5-03).
    console.error(
      `[drafting] tenant ${tenant.tenantId}: draft attempt failed ` +
        `(${failure.kind}/${failure.errorClass}` +
        `${failure.status === null ? '' : ` ${failure.status}`}). ` +
        `Touch left in needs_draft.`,
    );

    switch (failure.kind) {
      case 'rate_limited':
        counts.rateLimited += 1;
        return true;
      case 'retryable':
        counts.apiDeferred += 1;
        return true;
      case 'deterministic':
        // ── COUNTED AGAINST THE ROW. ────────────────────────────────────
        //
        // No attempt row is written — there is still no model output to be
        // evidence of — but SOMETHING has to terminate the touch-specific case.
        // `MAX_DRAFT_ATTEMPTS` reads `touch_drafts`, which a 400 never adds to,
        // so a touch whose input makes every request a 400 accumulated zero
        // recorded attempts and came back for two more calls every minute until
        // D-12 expired the cadence six weeks later.
        //
        // The classification pass reached this conclusion for the identical
        // situation and states it: this pass cannot tell a deployment-wide 400
        // from one unusual input, and only the counter makes the second case
        // terminate. `listNeedsDraft` stops offering a touch at the cap.
        await repo.touches.bumpDraftFailures(touchId);
        counts.deterministicFailed += 1;
        return false;
      default:
        // "We do not know", and deliberately NOT counted against the row: an
        // unknown throw is at least as likely to be ours as the input's, and
        // spending the touch's budget on our own bug would retire a customer's
        // follow-up for a reason that has nothing to do with it.
        counts.deferred += 1;
        return false;
    }
  };

  for (const touch of batch) {
    try {
      // ── SMS ONLY (D-04), AND THE CHANNEL IS CHECKED RATHER THAN ASSUMED. ─
      //
      // Every rule this pass applies is an SMS rule: the templates come from
      // `latestApprovedSet('sms')`, the validator judges GSM-7 septets against a
      // two-segment cap, and `complianceSuffix()` is the SMS opt-out line. The
      // batch, though, is `listNeedsDraft`'s — every `needs_draft` touch of the
      // tenant, whatever its channel.
      //
      // Nothing produces an email timing row today (`ensureDefaults` writes
      // `channel: 'sms'`), so this is latent. But `cadence_touch_templates`
      // accepts 'email', `TOUCH_CHANNELS` includes it, and `approvedSetStatus()`
      // is deliberately SMS-only — so an email touch would NOT be caught by the
      // activation gate on its way here. Keyed by touch number alone it would be
      // drafted from the SMS template, measured in septets, given the SMS
      // opt-out line, and handed to the email arm.
      //
      // Counted as ONB-03 because that is what it is: a schedule this pass has
      // no wording for. Writing a message badly is not the better failure.
      if (touch.channel !== 'sms') {
        counts.noApprovedTemplate += 1;
        continue;
      }

      // The cadence is read FIRST (Phase 13): its kind decides which approved
      // set the touch is drafted from, so it has to be known before the
      // template lookup rather than after it.
      const [cadence] = await repo.cadences.getById(touch.cadenceId);
      if (!cadence) {
        // The cadence vanished between promotion and drafting. Nothing to draft
        // FOR; leave the touch alone and let the next tick's own passes decide.
        counts.deferred += 1;
        continue;
      }

      const isLead = cadence.kind === 'lead';
      const { templates, templateByTouch } = isLead ? await leadTemplateSet() : quoteSet;

      // ── The ONB-03 belt. No approved words, no draft, no send. ───────────
      const template = templateByTouch.get(touch.touchNumber);
      if (!template) {
        counts.noApprovedTemplate += 1;
        continue;
      }

      // ── THE ATTEMPT CEILING (research Pitfall 4). ────────────────────────
      //
      // Read from the evidence table rather than held in memory, because the
      // burn this stops happens ACROSS ticks: a touch whose first draft is
      // rejected and whose regeneration then hits a connection error keeps two
      // recorded attempts and comes back next minute for two more. Without a
      // ceiling that is a permanent per-minute cost for one poisoned input.
      const priorAttempts = await repo.drafts.latestForTouch(touch.id);
      const priorHighest = priorAttempts.reduce(
        (highest, row) => Math.max(highest, row.attempt),
        0,
      );
      if (priorHighest >= MAX_DRAFT_ATTEMPTS) {
        counts.attemptsExhausted += 1;
        continue;
      }

      // ── The facts, ALL from our own mirror (D-02). ───────────────────────
      //
      // A lead has no quote (`quoteId` is NULL), so this read is skipped and
      // `buildMergeFacts` sees null money and a null date: the whitelist below
      // is then the day count alone, and the validator refuses any other digit
      // run in a lead draft.
      const [quote] = cadence.quoteId ? await repo.quotes.byId(cadence.quoteId) : [];

      // The validator's whitelist and the prompt's permitted list are ONE list,
      // and it is built by ONE function — `merge-facts.ts`. The console's
      // edit-then-approve action (05-07) re-validates an operator's edit against
      // this same whitelist, and it can only be the same whitelist if there is
      // one implementation of it. See that file's header.
      const facts = buildMergeFacts({
        totalInvoiceAmount: quote?.totalInvoiceAmount ?? null,
        quoteDateUtc: quote?.quoteDateUtc ?? null,
        anchorAt: cadence.anchorAt,
        contactName: cadence.contactName,
        timezone: tenant.timezone,
        now,
      });

      const { allowedDisplayStrings } = facts;

      // ── THE KIND'S FACTS (D-13). A lead's are the missed call: whether it
      //    came after hours, how long ago, and what the caller has said since
      //    — their own words, untrusted, which the prompt sanitizes, caps and
      //    fences. No name: a lead has none.
      const kindFacts:
        | { kind: 'lead'; leadFacts: LeadFacts }
        | { kind: 'quote'; quoteFacts: QuoteFacts } = isLead
        ? {
            kind: 'lead',
            leadFacts: {
              afterHours: cadence.leadId
                ? ((await repo.leads.byId(cadence.leadId))[0]?.afterHours ?? false)
                : false,
              daysSinceCallDisplay: facts.daysSinceDisplay ?? '',
              callerSaid: cadence.leadId ? await repo.inbound.latestForLead(cadence.leadId) : null,
              touchNumber: touch.touchNumber,
            },
          }
        : {
            kind: 'quote',
            quoteFacts: {
              contactFirstName: facts.contactFirstName,
              jobDescription: quote?.jobDescription ?? null,
              totalDisplay: facts.totalDisplay,
              quoteDateDisplay: facts.quoteDateDisplay,
              daysSinceQuoteDisplay: facts.daysSinceDisplay,
            },
          };

      // D-02 — what this cadence has already SAID, so touch 3 does not repeat
      // touch 1's angle. Read from our own evidence table, never composed.
      const priorBodies = await repo.drafts.sentBodiesForCadence(touch.cadenceId);

      const promptFor = (regenerationFeedback?: readonly string[]) =>
        buildDraftPrompt({
          ...kindFacts,
          voiceProfile,
          templates,
          priorBodies,
          touchNumber: touch.touchNumber,
          allowedDisplayStrings,
          regenerationFeedback,
        });

      /**
       * One attempt row. `attempt` numbers RECORDED attempts and continues from
       * what is already on record, so it is contiguous and never re-used.
       *
       * A call that produced nothing recordable (a truncation, an output the
       * schema rejected) does NOT consume a number: the column is the index of
       * the evidence, and the ceiling counts the same thing it does.
       */
      let attemptNumber = priorHighest;
      const recordAttempt = async (row: {
        generatedBody: string;
        finalBody: string;
        status: 'generated' | 'validator_failed';
        validatorFailures: DraftViolation[] | null;
        segments: number | null;
        usage: UsageCounters;
      }): Promise<string | null> => {
        attemptNumber += 1;
        const [inserted] = await repo.drafts.insertAttempt({
          cadenceId: touch.cadenceId,
          quoteId: cadence.quoteId,
          touchId: touch.id,
          touchNumber: touch.touchNumber,
          attempt: attemptNumber,
          model: DRAFT_MODEL,
          templateId: template.id,
          templateVersion: template.version,
          promptVersion: PROMPT_VERSION,
          // ── THE REPRODUCTION INPUTS, RECORDED RATHER THAN RE-DERIVED. ──
          //
          // `mergeNow` is the instant `buildMergeFacts` was actually called
          // with, which is NOT `created_at` (a different clock, written later in
          // the same tick) — and "days since the quote" is floored from it, so
          // the two can name different days. `complianceSuffix` is frozen with
          // the body because `tenants.name` is mutable and a rename would
          // otherwise make the approval screen's pre-filled text fail its own
          // `missing_suffix` check. See the columns in the schema.
          mergeNow: now,
          complianceSuffix: suffix,
          generatedBody: row.generatedBody,
          finalBody: row.finalBody,
          status: row.status,
          validatorFailures: row.validatorFailures,
          segments: row.segments,
          inputTokens: row.usage.inputTokens,
          outputTokens: row.usage.outputTokens,
          cacheReadInputTokens: row.usage.cacheReadInputTokens,
        });
        return inserted?.id ?? null;
      };

      /**
       * ── THE COMPLIANCE SUFFIX IS APPENDED, NEVER REQUESTED (D-01/D-03). ──
       *
       * And note what this function does NOT have access to: the template body.
       * There is no path from a rejected draft to a merge-filled one, because
       * the only string that becomes a `final_body` is one the model wrote plus
       * a suffix we wrote (D-10).
       */
      const judge = (body: string) =>
        validateDraft({
          body: `${body} ${suffix}`,
          allowedDisplayStrings,
          // Handed over rather than re-derived inside the validator: the belt on
          // the brace only means something if the two halves are the same string
          // object's worth of certainty, and composing it twice invites them to
          // drift.
          expectedSuffix: suffix,
          // D-13 "no links" on a LEAD draft, mechanically (13-REVIEW WR-02).
          // A quote draft never asks, so the quote path is unchanged (D-17).
          forbidLinks: isLead,
        });

      /**
       * A response the model gave us that is not a draft — a refusal, a
       * truncation, an output the schema rejected.
       *
       * RECORDED WITH AN EMPTY BODY AND PARKED FOR A HUMAN. Both halves are
       * deliberate. Recorded, because the model DID answer and a refusal nobody
       * can see is indistinguishable from a model that was never called. Parked
       * at `pending_approval` rather than left in `needs_draft`, because
       * re-asking the same question of the same input gets the same answer
       * forever — the touch needs a person to write it, and `validator_failed`
       * is the status the approve action refuses to pass through unedited.
       */
      const parkUnusable = async (reason: UnusableReason) => {
        await recordAttempt({
          // NOTHING FROM THE MODEL, because there was nothing.
          generatedBody: '',
          // ── BUT THE MECHANICAL HALF SURVIVES. ────────────────────────
          //
          // `final_body` pre-fills the operator's edit box. Left as `''` they
          // were handed a blank textarea and had to reproduce the exact Spam Act
          // suffix from memory; their first submission failed `missing_suffix`,
          // and only THAT refusal finally told them the required text. Two round
          // trips for a message they were never shown.
          //
          // The operator writes the message. They should not also have to write
          // the compliance line, which is ours and is identical every time.
          finalBody: suffix,
          status: 'validator_failed',
          validatorFailures: [{ rule: 'empty_body', detail: UNUSABLE_DETAIL[reason] }],
          segments: null,
          usage: NO_USAGE,
        });
        await park(touch.id);
        counts.validatorFailed += 1;
      };

      // ── ATTEMPT 1 ────────────────────────────────────────────────────────
      const first = await ask(promptFor());

      if (first.kind === 'failed') {
        if (await applyFailure(first.failure, touch.id)) break;
        continue;
      }

      // A REFUSAL IS NEVER REGENERATED. The input is identical on a second call
      // and the model has already said what it thinks of it; a retry would burn
      // a call to be told the same thing (research Pattern 5).
      if (first.kind === 'unusable' && first.reason === 'refusal') {
        await parkUnusable('refusal');
        continue;
      }

      let feedback: string[];
      let rejectedDraftId: string | null = null;

      if (first.kind === 'unusable') {
        feedback = [UNUSABLE_FEEDBACK[first.reason]];
      } else {
        const verdict = judge(first.body);
        if (verdict.ok) {
          await recordAttempt({
            generatedBody: first.body,
            // THE CANONICAL BYTES, from the validator that checked them.
            // `generatedBody` stays raw — evidence of what the model actually
            // emitted — while `final_body` is what an operator approves and what
            // ClickSend sends, and those two must be one string (Pitfall 6).
            finalBody: verdict.normalizedBody,
            status: 'generated',
            validatorFailures: null,
            segments: verdict.segments,
            usage: first.usage,
          });
          // The touch moves ONLY after the draft row exists. The other order
          // would put a touch on the approval queue with nothing to approve.
          await park(touch.id);
          counts.drafted += 1;
          continue;
        }

        // RECORDED BEFORE THE REGENERATION, not after. If the second call throws
        // we still hold the evidence of the first, which is both the AI-04
        // record and what makes the attempt ceiling above able to count.
        rejectedDraftId = await recordAttempt({
          generatedBody: first.body,
          finalBody: verdict.normalizedBody,
          status: 'validator_failed',
          validatorFailures: verdict.violations,
          segments: null,
          usage: first.usage,
        });
        feedback = verdict.violations.map(violationFeedback);
      }

      // ── ATTEMPT 2 — THE ONE REGENERATION, AND THERE IS NO THIRD (D-11). ──
      //
      // Not a loop. A model that has been told exactly which value it invented
      // and still invents one is not going to be talked round by a third
      // request, and every extra call is a customer's follow-up sitting later
      // for it. The rejection stands and a human writes this one.
      const second = await ask(promptFor(feedback));

      if (second.kind === 'failed') {
        // The first attempt's row (if any) stands, the touch stays in
        // `needs_draft`, and the ceiling has one more attempt on record.
        if (await applyFailure(second.failure, touch.id)) break;
        continue;
      }

      if (second.kind === 'unusable') {
        await parkUnusable(second.reason);
        continue;
      }

      const verdict = judge(second.body);
      const secondId = await recordAttempt({
        generatedBody: second.body,
        finalBody: verdict.normalizedBody,
        status: verdict.ok ? 'generated' : 'validator_failed',
        validatorFailures: verdict.ok ? null : verdict.violations,
        segments: verdict.ok ? verdict.segments : null,
        usage: second.usage,
      });
      void secondId;

      if (verdict.ok && rejectedDraftId !== null) {
        // The loser is kept, relabelled. See `markSuperseded`.
        await repo.drafts.markSuperseded(rejectedDraftId);
      }

      // EITHER WAY THE TOUCH LEAVES `needs_draft`. A second validator failure is
      // a draft a human must edit before approving, and leaving it on the
      // drafting queue would re-ask a question already answered twice.
      await park(touch.id);
      if (verdict.ok) counts.drafted += 1;
      else counts.validatorFailed += 1;
    } catch (error) {
      // NOT an API failure — `ask` already reduced those. Reaching here means
      // our own code or the database threw. Class name only, for the reason
      // every catch in this file gives (T-5-03).
      const { errorClass } = describeAnthropicError(error);
      console.error(
        `[drafting] tenant ${tenant.tenantId}: drafting pass threw ` +
          `(${errorClass}). Touch left in needs_draft.`,
      );
      counts.deferred += 1;
    }
  }
}
