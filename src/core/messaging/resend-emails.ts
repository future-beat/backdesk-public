/**
 * The delivery read-back (D-07) — did the one real email actually arrive?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A READ, WHEN EVERY OTHER CHANNEL GETS A CALLBACK                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * SMS delivery is pushed to us: ClickSend posts a delivery receipt to
 * `/api/webhooks/clicksend/dlr` and `send_ledger` learns the outcome without
 * anybody asking. Email has no such path here — no Resend webhook is configured
 * on this account and no `email.delivered` route exists (Phase 8 runtime
 * inventory). So `accepted by the provider` is the last thing the system knows
 * on its own, and `accepted` is NOT `delivered`: a message Resend took can
 * still bounce at the receiving server minutes later, which is precisely the
 * failure a proof about a newly verified sending domain exists to catch.
 *
 * `GET /emails/{id}` closes that gap with a read. `last_event` carries the
 * furthest point the message reached — `delivered` is the evidence MSG-02 needs,
 * `bounced` is the answer that must stop a go-live, and `queued` / `sent` mean
 * ask again in a moment.
 *
 * ONE WRAPPER, TWO CALLERS, AND THE COMPARISON ITSELF LIVES HERE. The proof
 * action (plan 05) requires `delivered` before it writes an `email_pipe` proof
 * row, and `scripts/resend-email-status.mjs` exits on the same boolean for the
 * runbook. Two spellings of "what counts as delivered" is how a proof row gets
 * written for a message that bounced — and, the way it actually went wrong
 * (WR-02), how a proof gets REFUSED for a message that arrived and was then
 * opened. Neither caller compares `lastEvent` to anything; see
 * `DELIVERED_EVENTS`.
 *
 * ── THE HOUSE RULES (resend-domains.ts, restated because they bind here) ────
 *
 * 1. NOTHING THROWS. A closed result union, like every other provider boundary
 *    in `src/core`. This is called from a server action rendering a page.
 *
 * 2. FAILURE DETAIL IS THE ERROR'S `name`, NEVER ITS MESSAGE. Resend's names —
 *    `not_found`, `validation_error`, `missing_api_key` — ARE the
 *    classification; the message adds prose and the risk that a future version
 *    of it echoes the request, and the response to this request contains a
 *    customer's address.
 *
 * 3. `last_event` IS BOUNDED to a short lowercase code. It reaches a rendered
 *    surface, a stored proof artefact and a comparison, and the enum
 *    documenting it is a third party's promise about a string.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT RETURN (T-10-09) ────────────────────────
 *
 * `GET /emails/{id}` returns the WHOLE message: `subject`, `html`, `text`, and
 * `to` as a full address. Neither caller has a use for any of it, and both put
 * what they receive somewhere permanent — a proof row in the database, or an
 * evidence log in the repository. So the recipient is reduced to its DOMAIN
 * (enough to prove the mail went where the proof says it went, useless to
 * anyone reading the log later) and the body never leaves this function.
 *
 * ── AND THE ONE FIELD IT DOES RETURN IN FULL: THE SENDER (CR-01) ────────────
 *
 * `fromAddress` is the whole address, because it is the ONLY thing in this
 * response that says WHICH CLIENT the email belongs to. This Resend account is
 * shared by every founding client, the operator alerts and the audit pipeline,
 * so `last_event = delivered` on its own proves only that some email somewhere
 * arrived — which is not the claim a `email_pipe_proof` row makes. It is safe
 * where the recipient is not: a sending identity is the client's own published
 * business address and already stored in their config row, and the caller
 * compares it against exactly that.
 */
import { Resend } from 'resend';

import { getServerEnv } from '@/core/shared/env';

import { domainOfAddress } from './resend-domains';

export type EmailStatusResult =
  | {
      ok: true;
      id: string;
      /** `delivered` / `bounced` / `queued` / … — bounded, never raw. */
      lastEvent: string;
      /**
       * DID IT ARRIVE? The one question both callers actually ask (WR-02).
       *
       * Spelled HERE rather than at each call site, because `last_event` is the
       * LATEST event and not the furthest one: a message that was delivered and
       * then opened reads `opened`, and `lastEvent === 'delivered'` at two call
       * sites is two chances to refuse a proof for an email that arrived. See
       * `DELIVERED_EVENTS`.
       */
      delivered: boolean;
      /** The recipient's DOMAIN. `null` when the address is unparseable. */
      toDomain: string | null;
      /**
       * WHO SENT IT — the bare address, lowercased, `null` when unparseable.
       *
       * THE ONLY THING THAT TIES A RESEND EMAIL TO A CLIENT (CR-01). The proof
       * action's other artefact is an escalation row read with the tenant in the
       * predicate; this one is fetched from an account shared by every founding
       * client, the operator alerts and the audit pipeline, so without the
       * sender "delivered" means only that SOME email on this account arrived.
       * The caller compares it against the tenant's own armed from-address.
       *
       * The SENDER, never the recipient: a from-address is the client's own
       * published business identity and already sits in their config row, where
       * the recipient is a customer's address (hence `toDomain` above).
       */
      fromAddress: string | null;
      createdAt: string | null;
    }
  | { ok: false; reason: string };

/**
 * THE EVENTS THAT MEAN THE MESSAGE REACHED THE RECIPIENT (WR-02).
 *
 * `last_event` is the LATEST event Resend recorded, not the furthest point the
 * message reached, and the documented union includes `opened` and `clicked`
 * (resend `index.d.mts`). Both of them happen strictly AFTER delivery — a
 * human cannot open an email that never arrived — so both are delivery
 * evidence, and on a sending domain with open or click tracking enabled they
 * are what D-07's own sequence PRODUCES: the runbook has the operator open the
 * proof email and exercise the one-click link, and `last_event` then reads
 * `opened` or `clicked` by the time the proof is recorded.
 *
 * EVERYTHING ELSE STAYS A REFUSAL, and deliberately so. `sent` and `queued` mean
 * ask again in a moment; `bounced`, `complained` and `delivery_delayed` are the
 * answers a proof about a newly verified sending domain exists to catch, and
 * accepting any of them would write a proof row for a message nobody received.
 */
const DELIVERED_EVENTS: ReadonlySet<string> = new Set(['delivered', 'opened', 'clicked']);

/**
 * A short lowercase code, or `unknown`.
 *
 * Narrower than `resend-domains.ts`'s `codeOf` (48 chars) on purpose: a domain
 * status is compared against a list we know, whereas this value is COMPARED
 * AGAINST `delivered` and then WRITTEN INTO A PROOF ARTEFACT. Thirty-two
 * characters is longer than every documented member of the enum and far shorter
 * than any sentence worth leaking.
 */
function boundedCode(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown';
  const trimmed = raw.trim().toLowerCase();
  return /^[a-z_]{1,32}$/.test(trimmed) ? trimmed : 'unknown';
}

/**
 * The BARE ADDRESS inside Resend's `from`, lowercased — or `null`.
 *
 * Resend echoes the header as it was sent, which is either `dave@x.com.au` or
 * `Dave's Plumbing <dave@x.com.au>`. The caller compares this against an
 * address column, so the display name has to come off before the comparison
 * rather than at each call site — a comparison that a display name can fail is
 * one that silently refuses a real client's own proof.
 *
 * Everything after the angle brackets is still UNTRUSTED: the result is only
 * ever compared against a stored address and never rendered, so it is lowercased
 * for a case-insensitive match (addresses are compared case-insensitively in
 * practice) and rejected outright if it does not even contain an `@`.
 */
export function bareAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const inner = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  const address = inner.trim().toLowerCase();
  return address.includes('@') ? address : null;
}

/**
 * The API key, read at CALL time rather than module load — same reason
 * `resend-domains.ts` gives: a missing key is a deployment state that gets
 * fixed, and a module-scope read holds whatever was true at cold start.
 */
function apiKey(): string | null {
  try {
    return getServerEnv().RESEND_API_KEY;
  } catch {
    return null;
  }
}

/** The delivery fact for one Resend email id. Reads only; never throws. */
export async function getEmailStatus(id: string): Promise<EmailStatusResult> {
  const key = apiKey();
  if (!key) return { ok: false, reason: 'not_configured' };

  try {
    const { data, error } = await new Resend(key).emails.get(id);

    if (error) return { ok: false, reason: boundedCode(error.name) };
    // "The provider said nothing" is not "the email does not exist" — the
    // caller must be able to tell those apart before it refuses a go-live.
    if (!data) return { ok: false, reason: 'empty_response' };

    const lastEvent = boundedCode(data.last_event);

    return {
      ok: true,
      id: data.id,
      lastEvent,
      delivered: DELIVERED_EVENTS.has(lastEvent),
      toDomain: domainOfAddress(data.to?.[0] ?? ''),
      fromAddress: bareAddress(data.from),
      createdAt: data.created_at ?? null,
    };
  } catch (e) {
    return { ok: false, reason: boundedCode(e instanceof Error ? e.name : 'unknown_error') };
  }
}
