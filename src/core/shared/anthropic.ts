/**
 * The ONLY code in this repository that constructs an Anthropic client.
 *
 * Written against the two invariants `src/core/messaging/clicksend-client.ts`
 * and `src/core/servicem8/client.ts` both state, because it is the same kind of
 * boundary — our credential and a customer's details crossing to a third party:
 *
 *  1. **The credential is never interpolated into a returned string.** Callers
 *     build failure results from an error's CLASS NAME and HTTP status, never
 *     `String(e)` and never the response body. `describeAnthropicError()` below
 *     exists so no caller has to be trusted to remember that.
 *  2. **Bodies never reach a log.** T-5-03: draft prompts, generated bodies and
 *     customer reply text are the inputs and outputs here. Nothing in this file
 *     or its callers may write them to a platform log, a `console.error`
 *     argument, or a tick response body — counts and error class names only.
 *
 * ── RETURNS `null` RATHER THAN THROWING WHEN UNCONFIGURED (D-10) ────────────
 *
 * `ANTHROPIC_API_KEY` is optional in the env schema (see env.ts for why), so the
 * absent case is ORDINARY rather than exceptional and the signature says so. A
 * null client means the drafting pass counts `drafting_unconfigured` and leaves
 * every touch in `needs_draft`, where the next tick will find it again once a
 * key exists.
 *
 * Throwing instead would be worse in both directions: on the tick it would
 * abort a per-tenant pass over a condition that is not an error, and in tests it
 * would make constructing the module a thing that needs a key.
 *
 * ── THE TIMEOUT IS IN MILLISECONDS (research Pitfall 8) ─────────────────────
 *
 * The TypeScript SDK's `timeout` option is milliseconds, unlike the Python
 * SDK's seconds. `60` here would be a 60-millisecond budget: every request
 * would abort before the first token and the symptom would be a total drafting
 * outage that looks like an API failure. The `_MS` suffix on both constants is
 * there to make the unit un-mistakable at the call site.
 *
 * Two budgets because the two workloads are not alike. Drafting generates a few
 * hundred tokens of prose and runs on a per-minute tick that has other tenants
 * waiting; classification is a two-field structured output over one short
 * message and should never take half a minute. A classification call that
 * needs 30s has failed at something, and waiting 60s to find out costs the
 * remaining tenants in the pass.
 */
import Anthropic from '@anthropic-ai/sdk';

import { getServerEnv } from './env';

/** Drafting: prose generation, a few hundred output tokens. MILLISECONDS. */
export const DRAFT_TIMEOUT_MS = 60_000;
/** Classification: two enum fields over one short reply. MILLISECONDS. */
export const CLASSIFY_TIMEOUT_MS = 30_000;

/**
 * Retries inside the SDK, on top of which the callers do NOT retry. The SDK
 * retries only connection errors, 408/409/429 and 5xx — never a 400, which is
 * what a malformed request produces and what retrying could not fix.
 *
 * The callers' own non-retry is D-10: a drafting failure leaves the touch in
 * `needs_draft` and the per-minute tick is the retry. A second retry loop in
 * application code would multiply against this one and turn a provider blip
 * into a burst.
 */
const MAX_RETRIES = 2;

/**
 * Construct a client, or `null` when no key is configured.
 *
 * @param timeoutMs Request budget in MILLISECONDS — see the header. Defaults to
 *                  the drafting budget; pass `CLASSIFY_TIMEOUT_MS` for the
 *                  classification path.
 */
export function buildAnthropicClient(
  timeoutMs: number = DRAFT_TIMEOUT_MS,
): Anthropic | null {
  const apiKey = getServerEnv().ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return new Anthropic({
    apiKey,
    timeout: timeoutMs,
    maxRetries: MAX_RETRIES,
  });
}

/**
 * The classification client — the same construction on the shorter budget,
 * named so a call site cannot pass the wrong number by accident.
 */
export function buildClassifyClient(): Anthropic | null {
  return buildAnthropicClient(CLASSIFY_TIMEOUT_MS);
}

/**
 * Reduce a thrown value to something SAFE TO RECORD.
 *
 * This is the whole of invariant 1, in one place, because the alternative is
 * every caller's catch block being individually trusted to remember it. An
 * Anthropic error's `message` can contain the request body — which is the draft
 * prompt, which contains a customer's name, job and price — so it is never
 * returned. Neither is the response body, for the same reason plus the
 * credential.
 *
 * What comes back is a CLASS NAME, an HTTP status when the SDK exposes one, and
 * a `kind` from the closed `AnthropicFailureKind` vocabulary below — enough to
 * tell a 429 from a 400 from a dropped socket, which is every distinction the
 * callers actually branch on. The `kind` is here rather than at the call sites
 * so the drafting pass and the classification pass cannot come to different
 * conclusions about the same error.
 *
 * `APIConnectionError` is checked BEFORE `APIError` deliberately — it is a
 * SUBCLASS of it (verified against the installed SDK), so the general arm first
 * would swallow every connection failure into the generic case and hide the one
 * class that means "we never reached them at all".
 */
export function describeAnthropicError(error: unknown): AnthropicFailure {
  // ── MOST SPECIFIC FIRST. Every class below except the last two is a SUBCLASS
  //    of `APIError`, so the generic arm must come after all of them or it
  //    swallows the distinctions the callers branch on.

  // 429. The SDK has ALREADY retried this twice with backoff, honouring
  // `retry-after`. Reaching here means the account is genuinely over its limit,
  // and the only useful response is to stop asking this minute.
  if (error instanceof Anthropic.RateLimitError) {
    return { kind: 'rate_limited', errorClass: 'RateLimitError', status: 429 };
  }

  // We never reached them at all. Checked BEFORE `APIError` — it is a subclass
  // (verified against the installed SDK), and the generic arm first would hide
  // the one class that means the request never landed.
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: 'retryable', errorClass: 'APIConnectionError', status: null };
  }

  // 5xx — theirs, not ours. Retrying next tick is exactly right.
  if (error instanceof Anthropic.InternalServerError) {
    return {
      kind: 'retryable',
      errorClass: 'InternalServerError',
      status: typeof error.status === 'number' ? error.status : null,
    };
  }

  // OURS, and identical on every retry: a malformed request (a sampling
  // parameter sent to Sonnet 5), a revoked key, a workspace permission. These
  // are deploy or operator problems and no amount of waiting fixes them.
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return {
      kind: 'deterministic',
      errorClass: error.constructor.name,
      status: typeof error.status === 'number' ? error.status : null,
    };
  }

  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : null;
    // 529 arrives as a bare `APIError` with this type rather than as its own
    // class — the one place the STRING is load-bearing.
    const overloaded = error.type === 'overloaded_error';
    const serverSide = status !== null && status >= 500;
    return {
      kind: overloaded || serverSide ? 'retryable' : 'unknown',
      errorClass: error.constructor.name,
      status,
    };
  }

  if (error instanceof Error) {
    return { kind: 'unknown', errorClass: error.constructor.name, status: null };
  }
  return { kind: 'unknown', errorClass: 'UnknownError', status: null };
}

/**
 * How a caller should respond to a failure — the closed vocabulary the drafting
 * and classification passes branch on, so neither has to run its own
 * `instanceof` chain that can drift from this one.
 *
 * (04-09's CR-02 is the lesson: two copies of a classifier, one widened when
 * real payloads arrived and the other not, left a compliance backstop reporting
 * zero indistinguishably from "nothing was missed".)
 *
 *  - `rate_limited`  — 429 after the SDK's own retries. Stop asking this tick.
 *  - `retryable`     — connection, 5xx, 529. Their side; the per-minute tick is
 *                      the retry, and the work stays exactly where it was.
 *  - `deterministic` — 400/401/403. Ours. Every retry fails identically, so a
 *                      retry loop is pure burn; the honest record is a count.
 *  - `unknown`       — anything else, including a non-Anthropic throw from our
 *                      own code inside the try block. Treated as retryable-ish
 *                      by callers (leave the work alone) but counted apart,
 *                      because it is the arm that means "we do not know".
 */
export type AnthropicFailureKind =
  | 'rate_limited'
  | 'retryable'
  | 'deterministic'
  | 'unknown';

export interface AnthropicFailure {
  kind: AnthropicFailureKind;
  errorClass: string;
  status: number | null;
}
