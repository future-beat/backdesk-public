/**
 * The ONLY code in this repository that talks to rest.clicksend.com.
 *
 * Written against the same two invariants `src/core/servicem8/client.ts` states,
 * for the same reasons, because it is the same kind of boundary — our
 * credentials and a customer's phone number crossing to a third party:
 *
 *  1. **The credentials are never interpolated into a returned string.** Every
 *     failure result is built from the HTTP STATUS CODE, a sanitized provider
 *     status code, or the error's `name` — never `String(e)`, because a `fetch`
 *     rejection can stringify to a message containing the request URL, and never
 *     the response body, because ClickSend has no obligation to keep our
 *     credential (or the recipient's number) out of its own error text.
 *  2. **Nothing throws.** A thrown fetch error carries the Request object,
 *     headers included — and the Basic-auth header is in there — to whatever
 *     logs it. `ClickSendSender` wraps this in a second try/catch anyway; that
 *     backstop exists so a bug HERE cannot strand a tick's remaining sends, not
 *     as permission for this file to throw.
 *
 * DIRECT `fetch`, NOT ClickSend's generated Node SDK. CLAUDE.md bans it by name:
 * it is auto-generated, poorly maintained, and adds nothing over a REST call
 * this small. `src/core` is framework-free — global `fetch` only.
 *
 * ── THE RESPONSE PARSE IS TOLERANT ON PURPOSE ───────────────────────────────
 *
 * The payload shape below is MEDIUM-to-LOW confidence research (nothing in this
 * repository has ever received a real ClickSend response — the dedicated AU
 * number is blocked on the IPND business-address requirement, D-08). So the
 * schema hard-requires only what is actually READ and passes everything else
 * through. A strict schema here would turn "ClickSend added a field" into a
 * `parse_error` on a message that was in fact accepted and delivered — a ledger
 * row reading `failed` beside a customer who got the text, which is the one
 * error direction that invites a human to send it again.
 *
 * [CITED: research A1 — POST https://rest.clicksend.com/v3/sms/send, HTTP Basic
 * (username:api_key), body { messages: [{ to, from, body, source,
 * custom_string }] }, 200 → data.messages[0].message_id + status]
 */
import { z } from 'zod';

import { PROVIDER_SOURCE_TAG } from '@/core/brand';

const API_BASE = 'https://rest.clicksend.com/v3';
const ENDPOINT = `${API_BASE}/sms/send`;

/**
 * A stalled request must not hold the tick. Same budget the ServiceM8 client
 * uses — dispatch invokes senders in sequence after its transactions have
 * committed, so a hung socket here delays every subsequent customer's message.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Identifies US as the sending platform in ClickSend's own reporting. Not
 * customer-visible and not the Spam Act sender identification — that is the
 * tradie's business name in the message copy, because the channel is a shared
 * virtual number rather than a per-client alpha tag (CLAUDE.md).
 */
const SOURCE = PROVIDER_SOURCE_TAG;

export interface ClickSendCreds {
  username: string;
  apiKey: string;
}

export interface SendSmsInput {
  /** NORMALIZED E.164 recipient. */
  to: string;
  /** The dedicated AU virtual number, from `messaging_config.from_address`. */
  from: string;
  /** The approved body, VERBATIM. Never truncated or transformed here. */
  body: string;
  /** The `send_ledger` row id — how 04-04's delivery receipt finds its row. */
  customString: string;
}

/**
 * A CLOSED UNION, and `reason` carries codes and names only — never provider
 * prose. See the header.
 *
 * `optedOut` is its own boolean rather than a magic `reason` value because the
 * caller does two different things with it: map it to a stable label the state
 * machine knows, and (in 04-04) turn it into suppression evidence. A caller
 * string-matching on a reason to decide whether somebody opted out would be
 * matching on a third party's vocabulary.
 */
export type SendSmsResult =
  | { ok: true; messageId: string | null; status: string }
  | { ok: false; reason: string; retryable: boolean; optedOut: boolean };

/**
 * Every per-message field we actually read, and nothing required that we do not.
 *
 * `message_id` is `.nullish()` because a REFUSED message legitimately has none,
 * and `status` is optional because a response missing it is a shape we do not
 * understand rather than an error we can classify — handled below as its own
 * result, not by a schema failure.
 */
const messageSchema = z
  .object({
    message_id: z.string().nullish(),
    status: z.string().nullish(),
  })
  .loose();

const responseSchema = z
  .object({
    response_code: z.string().nullish(),
    data: z
      .object({ messages: z.array(messageSchema).nullish() })
      .loose()
      .nullish(),
  })
  .loose();

/**
 * Reduce a provider string to a BOUNDED CODE-SHAPED TOKEN.
 *
 * ClickSend's per-message `status` is documented as a code (`SUCCESS`,
 * `INVALID_RECIPIENT`), but that documentation is the LOW-confidence part of the
 * research and this value flows into `send_ledger`, an operator's screen and a
 * log line. If it ever turns out to be prose — or worse, prose that quotes the
 * recipient's number back at us — this bounds the damage structurally rather
 * than relying on the provider's discretion: uppercase, non-alphanumerics
 * collapsed to `_`, truncated. A phone number survives that transformation as
 * digits, so the length cap alone is not enough — `could not deliver to
 * +61491570156 because…` collapses to 32 characters WITH THE NUMBER STILL IN
 * IT. So any digit-led run of seven or more number-ish characters (digits plus
 * the separators a phone number is written with) is replaced outright before
 * the cap is applied. No status code in any provider's vocabulary is seven
 * digits long, and every AU mobile — `+61491570156`, `0491 570 156`,
 * `(08) 9000 0000` — is longer than that in every format it is written in. A
 * long numeric message id is redacted too, which costs nothing: the id is
 * recorded in its own column.
 *
 * EXPORTED because plan 04-04's delivery receipts classify a status string from
 * the same provider, arriving on a less-trusted channel (an unsigned callback),
 * into a column rendered on the same operator screen. Two copies of this rule
 * would be two answers to "what may a third party put in our database", and the
 * copy that drifts is the one that stops redacting.
 */
export function codeOf(raw: string): string {
  const token = raw
    .trim()
    .toUpperCase()
    .replace(/\d[\d\s()+.-]{5,}\d/g, 'N')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return token.slice(0, 48) || 'UNKNOWN';
}

/**
 * Whether a provider status says the RECIPIENT has opted out at ClickSend's end.
 *
 * Deliberately a tolerant substring check rather than an equality test against a
 * documented constant: the exact spelling is the least-confident fact in the
 * research (A1), and the two failure directions are not symmetric. A false
 * negative records a generic failure and loses a suppression the customer asked
 * for — a Spam Act problem. A false positive suppresses somebody who did not ask
 * — one client loses one follow-up. D-03 makes that trade explicitly for
 * ambiguous STOPs and it is the same trade here.
 *
 * The check is on `OPT` rather than `OPT_OUT` so `OPTOUT`, `OPT-OUT` and
 * `OPTED_OUT` all match after `codeOf` has normalized the separators away.
 */
function isOptOutCode(code: string): boolean {
  return code.includes('OPT');
}

/**
 * Whether a provider status says the ClickSend ACCOUNT is out of money
 * (Phase 12, D-10) — the reason the first live SMS this system ever attempted
 * failed (`INSUFFICIENT_CREDIT`, named as ClickSend's own reason in
 * `src/db/schema/escalations.ts` and in the header of
 * `scripts/clicksend-balance.mjs`).
 *
 * Matched on the `codeOf`-normalised token, so casing and separators cannot
 * matter (`insufficient credit`, `Insufficient-Credit`). A text-back failing
 * with it makes the tick probe the balance at once rather than at the next
 * quarter hour. The asymmetry is benign either way: a false positive costs
 * one GET, a false negative waits at most fifteen minutes.
 */
function isInsufficientCreditCode(code: string): boolean {
  return codeOf(code).includes('INSUFFICIENT_CREDIT');
}

/** True only where asking again could plausibly produce a different answer. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Send one SMS. NOTHING THROWS — see the header.
 */
export async function sendSms(
  input: SendSmsInput,
  creds: ClickSendCreds,
): Promise<SendSmsResult> {
  // Built at call time and never stored, logged or returned (T-4-10).
  const authorization = `Basic ${Buffer.from(`${creds.username}:${creds.apiKey}`).toString('base64')}`;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            to: input.to,
            from: input.from,
            // VERBATIM. No truncation at the 160-character segment boundary and
            // no charset normalization: segmentation and encoding are the
            // provider's job, and a client-side `.slice()` is a message that
            // reaches a customer mid-sentence.
            body: input.body,
            source: SOURCE,
            custom_string: input.customString,
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // `e.name` only ('TimeoutError', 'TypeError'). NOT String(e) — see header.
    const name = e instanceof Error ? e.name : 'UnknownError';
    return { ok: false, reason: name, retryable: true, optedOut: false };
  }

  if (!res.ok) {
    // The status CLASS and nothing from the body. A 4xx body from a provider is
    // a place our own request — recipient number included — is commonly echoed.
    return {
      ok: false,
      reason: `http_${res.status}`,
      retryable: retryableStatus(res.status),
      optedOut: false,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'parse_error', retryable: false, optedOut: false };
  }

  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    // Reached only if `data.messages` is present and is not an array of objects.
    // NOT retryable: the same request produces the same shape.
    return { ok: false, reason: 'unexpected_response', retryable: false, optedOut: false };
  }

  const message = parsed.data.data?.messages?.[0];
  if (!message) {
    // A 200 with no message in it. We do not know whether it was queued, so we
    // must not claim it was: this becomes `failed` at the sender, and the
    // ledger's own rule applies — an honest refusal beats an optimistic 'sent'
    // that Phase 7 would attribute revenue against.
    return { ok: false, reason: 'no_message_in_response', retryable: false, optedOut: false };
  }

  const status = codeOf(message.status ?? parsed.data.response_code ?? '');

  if (status === 'SUCCESS') {
    // `message_id` may legitimately be absent even on success; `null` is honest
    // and the ledger column is nullable for exactly that. A fabricated id would
    // eventually be looked up against ClickSend by 04-04's reconciliation.
    return { ok: true, messageId: message.message_id ?? null, status };
  }

  return {
    ok: false,
    reason: status,
    // A per-message refusal is a verdict on THIS message, not on the connection:
    // the provider was reachable and answered. Asking again produces the same
    // answer, so nothing about a retry could differ.
    retryable: false,
    optedOut: isOptOutCode(status),
  };
}

/* ------------------------------------------------------------------------- *
 * THE POLLING HALF (plan 04-04) — the guarantee behind the webhook hints
 *
 * Two webhooks feed this system and both are allowed to miss: a delivery
 * receipt that never arrives leaves a NULL column, and — much worse — a STOP
 * ClickSend intercepts at their end never reaches `handleInboundSms` at all
 * (research A3 / Pitfall 2). SYNC-03 already answered this shape of problem for
 * ServiceM8: the webhook is a HINT and a poll is the GUARANTEE. These two
 * readers are that poll for messaging.
 *
 * READ-ONLY, both of them. Nothing in this section can send, resend or cancel
 * anything — a reconciliation that could send would turn a provider outage into
 * a customer being messaged twice (D-07).
 *
 * [CITED: research A1 — GET /v3/sms/history and GET /v3/sms/inbound, HTTP Basic,
 * `date_from`/`date_to` in epoch seconds, page/limit paging, results under
 * `data.data` with `data.last_page`.] LOW confidence, same as the send path, so
 * the parse is equally tolerant and every field is optional.
 * ------------------------------------------------------------------------- */

/**
 * Pages are capped, and the cap is a decision.
 *
 * The sweep runs daily over a 48-hour window for at most fifteen clients, so a
 * few hundred messages is the realistic upper bound and five pages of 100 is
 * already generous. The cap exists because the loop's exit condition is a field
 * IN A THIRD PARTY'S RESPONSE: without it, a `last_page` that never stops
 * incrementing is an unbounded loop inside a cron-invoked function.
 */
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

/** Read budget per page. Larger than the send budget: this is a bulk query. */
const LIST_TIMEOUT_MS = 30_000;

/** A CLOSED UNION, and `reason` carries codes only — the same rule as sends. */
export type ClickSendListResult<T> =
  | { ok: true; items: T[]; pages: number }
  | { ok: false; reason: string; retryable: boolean };

/** One row of ClickSend's outbound history, reduced to what we act on. */
export interface SmsHistoryEntry {
  messageId: string | null;
  /** OUR `send_ledger.id`, echoed back — how a history row finds its send. */
  customString: string | null;
  /** The one-word verdict: `'Sent'`, `'Failed'`. Ambiguous on its own. */
  status: string | null;
  statusCode: string | null;
  /**
   * The PROSE verdict, and the only unambiguous field in the row.
   *
   * A delivered message comes back `status: 'Sent'`, `status_code: '201'`,
   * `status_text: 'Message delivered to the handset'` — and `'Sent'` alone
   * cannot distinguish "we handed it over" from "it arrived", which is exactly
   * the distinction `delivery_status` exists to record. Carried through to
   * `applyDeliveryReceipt` rather than dropped here; without it the daily sweep
   * classified every delivered message `unknown` (observed 2026-08-30).
   */
  statusText: string | null;
  errorCode: string | null;
  /** ClickSend's error prose, populated on SUCCESS too. See `receipts.ts`. */
  errorText: string | null;
  /** Epoch SECONDS, as ClickSend documents `date`. */
  date: number | null;
}

/** One inbound message from ClickSend's own store. */
export interface InboundSmsEntry {
  messageId: string | null;
  from: string | null;
  to: string | null;
  body: string | null;
  date: number | null;
}

/** Everything optional, unknown keys allowed. See the section header. */
const listRowSchema = z.looseObject({
  message_id: z.union([z.string(), z.number()]).nullish(),
  custom_string: z.string().nullish(),
  status: z.union([z.string(), z.number()]).nullish(),
  status_code: z.union([z.string(), z.number()]).nullish(),
  status_text: z.string().nullish(),
  error_code: z.union([z.string(), z.number()]).nullish(),
  error_text: z.string().nullish(),
  date: z.union([z.string(), z.number()]).nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
  body: z.string().nullish(),
  original_body: z.string().nullish(),
  /**
   * `'in'` or `'out'` on a `/sms/history` row — the field that makes one
   * endpoint serve both polls. See `listInboundSms`.
   */
  direction: z.string().nullish(),
});

const listResponseSchema = z.looseObject({
  data: z
    .looseObject({
      data: z.array(listRowSchema).nullish(),
      last_page: z.union([z.string(), z.number()]).nullish(),
    })
    .nullish(),
});

type ListRow = z.infer<typeof listRowSchema>;

function textOf(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function numberOf(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ListOptions {
  creds: ClickSendCreds;
  /** Inclusive lower bound of the window. The caller owns the window width. */
  since: Date;
  /** Injected in tests. `src/core` is framework-free — global `fetch` only. */
  fetchImpl?: typeof fetch;
  /** Defaults to `new Date()`; injected so a window is assertable. */
  now?: Date;
}

/**
 * One paged GET, tolerant end to end. NOTHING THROWS — see the file header; the
 * argument is identical, and here there is a second one: this runs inside a
 * cron-invoked route, where an exception is a red job an operator investigates
 * instead of a NULL column the next sweep fills in.
 */
async function listPaged(
  path: string,
  options: ListOptions,
): Promise<ClickSendListResult<ListRow>> {
  const authorization = `Basic ${Buffer.from(`${options.creds.username}:${options.creds.apiKey}`).toString('base64')}`;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();

  const items: ListRow[] = [];
  let pages = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${API_BASE}${path}`);
    // Epoch SECONDS, per the cited research. A window expressed in the wrong
    // unit returns an empty page rather than an error, which is the failure
    // mode the activation step (04-07) has to look for explicitly.
    url.searchParams.set('date_from', String(Math.floor(options.since.getTime() / 1000)));
    url.searchParams.set('date_to', String(Math.floor(now.getTime() / 1000)));
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PAGE_SIZE));

    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'GET',
        headers: { authorization, accept: 'application/json' },
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
    } catch (e) {
      // `e.name` only. NOT String(e) — a fetch rejection stringifies to a
      // message that can contain the request URL, and this URL is built from
      // our credentials' account.
      const name = e instanceof Error ? e.name : 'UnknownError';
      return { ok: false, reason: name, retryable: true };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: `http_${res.status}`,
        retryable: retryableStatus(res.status),
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: 'parse_error', retryable: false };
    }

    const parsed = listResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: 'unexpected_response', retryable: false };

    const rows = parsed.data.data?.data ?? [];
    items.push(...rows);
    pages = page;

    const lastPage = numberOf(parsed.data.data?.last_page);
    // Stop on a short page as well as on `last_page`: the field is the
    // least-confident part of the shape, and a response that omits it entirely
    // would otherwise be read as "there is always another page".
    if (rows.length < PAGE_SIZE) break;
    if (lastPage !== null && page >= lastPage) break;
  }

  return { ok: true, items, pages };
}

/** Outbound history for the window — the delivery facts a DLR may have missed. */
export async function listSmsHistory(
  options: ListOptions,
): Promise<ClickSendListResult<SmsHistoryEntry>> {
  const result = await listPaged('/sms/history', options);
  if (!result.ok) return result;

  return {
    ok: true,
    pages: result.pages,
    items: result.items.map((row) => ({
      messageId: textOf(row.message_id),
      customString: textOf(row.custom_string),
      status: textOf(row.status),
      statusCode: textOf(row.status_code),
      statusText: textOf(row.status_text),
      errorCode: textOf(row.error_code),
      errorText: textOf(row.error_text),
      date: numberOf(row.date),
    })),
  };
}

/**
 * Inbound messages for the window — the STOPs the callback may have missed.
 *
 * ── IT READS `/sms/history`, NOT `/sms/inbound`, AND THAT IS THE WHOLE POINT ─
 *
 * `GET /v3/sms/inbound` is the obvious endpoint and it is the WRONG one. It was
 * what this function called until the first live two-way test (2026-08-30)
 * measured what it actually returns.
 *
 * The measurement: a real handset sent a reply and then a STOP to our dedicated
 * number. Both reached the inbound webhook and both are in ClickSend's account.
 * Queried immediately afterwards, over an explicit three-day window:
 *
 *   GET /v3/sms/inbound   -> total 0, zero rows
 *   GET /v3/sms/history   -> both messages, `direction: 'in'`, bodies intact
 *
 * `/v3/sms/receipts` behaves the same way — empty, though a delivery receipt had
 * demonstrably fired minutes earlier. Both read as PULL QUEUES that an
 * automation rule drains, while `/sms/history` is the durable log.
 *
 * Why that mattered more than a wrong URL usually does: this poll is the
 * BACKSTOP for threat T-4-28, the case where ClickSend's own account-level
 * `Opt-out contact` rule intercepts a STOP before our webhook sees it. In
 * exactly that scenario a rule has consumed the message — which is precisely
 * when `/sms/inbound` is empty. The guarantee half of SYNC-03's
 * "the webhook is a hint, the poll is the guarantee" was therefore reading the
 * one endpoint that is blank whenever it is needed, and reporting
 * `inboundReplayed: 0` in a way indistinguishable from "nothing was missed".
 *
 * `/sms/history` holds inbound and outbound in one paged resource separated by
 * `direction`, so the filter below is the entire difference.
 *
 * ── AN ABSENT `direction` IS DROPPED, AND THAT REVERSES THE USUAL TRADE ─────
 *
 * Everywhere else at this boundary we keep the doubtful row, because the cost
 * of dropping one is a STOP nobody honours (D-03). Here the resource is HALF
 * OUTBOUND, so "keep what we cannot classify" would replay OUR OWN follow-ups
 * back through `handleInboundSms` — messages whose sender is our dedicated
 * number, which threads to no cadence and lands on the operator's triage screen
 * as an unattributed reply, once per sweep, forever. That is not a cautious
 * failure; it is the triage queue filling with our own outbound traffic until
 * the real reply in it is invisible.
 *
 * So the doubtful row is dropped and COUNTED instead. A rising count is the
 * signal that ClickSend stopped sending the field, which is a code change
 * rather than a thing the next sweep fixes.
 */
export async function listInboundSms(
  options: ListOptions,
): Promise<ClickSendListResult<InboundSmsEntry>> {
  const result = await listPaged('/sms/history', options);
  if (!result.ok) return result;

  let undirected = 0;
  const inbound = result.items.filter((row) => {
    const direction = textOf(row.direction);
    if (direction === null) {
      undirected += 1;
      return false;
    }
    return direction.toLowerCase() === 'in';
  });

  if (undirected > 0) {
    console.warn(
      `[clicksend] ${undirected} history row(s) carried no direction and were not replayed; ` +
        'if this is not zero the inbound backstop needs a new discriminator.',
    );
  }

  return {
    ok: true,
    pages: result.pages,
    items: inbound.map((row) => ({
      messageId: textOf(row.message_id),
      from: textOf(row.from),
      to: textOf(row.to),
      // `original_body` is ClickSend's untruncated field where it exists; the
      // STOP decision is a regex over the body, and a truncated body is a STOP
      // we might not recognise.
      body: row.original_body ?? row.body ?? null,
      date: numberOf(row.date),
    })),
  };
}

/**
 * Exported for `reconcile.ts`, which has to recognise a provider-side opt-out
 * in a POLLED history row rather than in a send response. One spelling of "the
 * provider says this person opted out", asked from two places — the alternative
 * is a compliance write that depends on which file you read.
 *
 * It is only ever trusted in a FAILURE context (see `reconcile.ts`): the check
 * is a tolerant `OPT` substring, which `OPT_IN` would also satisfy.
 */
export { isOptOutCode };

/**
 * Exported for the text-back alert pass (`src/core/leads/sweep.ts`), which reads
 * the code `sendTextBack` recorded on a failed missed call. Beside
 * `isOptOutCode`, for the same one-spelling reason.
 */
export { isInsufficientCreditCode };

/* ------------------------------------------------------------------------- *
 * THE ACCOUNT BALANCE (Phase 12, plan 12-04; D-10, TXT-06)
 *
 * One GET, read by the per-minute tick's balance probe while any client is
 * armed for text-back. A provider response here DRIVES A WRITE THAT STOPS A
 * CLIENT'S SERVICE (below A$5 every armed client is disarmed), so the parse is
 * the opposite of tolerant: anything but a parseable AUD figure is
 * `ok: false`, and the caller treats `ok: false` as UNREADABLE — never as
 * empty. A provider outage is not an empty account (T-12-21). A NEGATIVE
 * figure is not unreadable: ClickSend reports an overdrawn account as a signed
 * decimal (production read −A$20.87 on 6 Oct 2026), and an overdraft is the
 * most readable low balance there is — it is below both floors (12-REVIEW
 * CR-01).
 *
 * The field names are the ones `scripts/clicksend-balance.mjs` read a real
 * answer from on this account (`0.029806 AUD`, recorded in the Phase 10
 * evidence): `data.balance` and `data._currency.currency_name_short`. That
 * script is not touched; this is the tick's own read, in this file's
 * never-throw shape.
 * ------------------------------------------------------------------------- */

/**
 * The balance read's budget. Short on purpose: it runs inside the per-minute
 * tick, behind every pass that touches a customer, and a slow answer is
 * simply an unreadable one this quarter hour.
 */
const BALANCE_TIMEOUT_MS = 5_000;

/** Why a balance could not be read. A CLOSED set — codes only, never prose. */
export type AccountBalanceFailure =
  | `http_${number}`
  | 'network'
  | 'timeout'
  | 'unparseable'
  | 'not_aud';

export type AccountBalanceResult =
  | { ok: true; balanceCents: number; currency: 'AUD' }
  | { ok: false; reason: AccountBalanceFailure };

const accountSchema = z
  .object({
    data: z
      .object({
        balance: z.union([z.string(), z.number()]).nullish(),
        _currency: z.object({ currency_name_short: z.string().nullish() }).loose().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

/** A decimal: an optional leading minus, digits, optionally a point and more digits. Nothing else. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/**
 * ClickSend's balance, a decimal string (or number) of DOLLARS, as whole
 * CENTS — rounded DOWN (towards minus infinity), with no floating-point
 * arithmetic on the fraction: the integer and fraction parts are read as digit
 * strings and only whole numbers are multiplied. `"19.999"` is 1999 (never
 * 2000, which would read as "at the floor" and not alert), `"0.029806"` is 2,
 * `"-20.87"` is -2087 and `"-0.001"` is -1 (an overdraft never rounds up to
 * zero).
 *
 * A leading minus is READ, not refused: an overdrawn account is a real, low
 * balance that must disarm (12-REVIEW CR-01). `null` for anything else that is
 * not a plain decimal — empty, a plus sign, an exponent, prose, `null`, a
 * non-finite number. The canonical name for callers is `parseBalanceCents` in
 * `src/core/leads/balance.ts`, which is this function; it lives here, at the
 * provider boundary, so the balance read below needs nothing from the probe
 * that calls it.
 */
export function centsFromDecimal(raw: unknown): number | null {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim();
  } else {
    return null;
  }

  if (!DECIMAL.test(text)) return null;

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const truncated = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  // Rounding DOWN a negative figure moves away from zero when any digit past
  // the cents is non-zero: -0.001 dollars is -1 cent, never 0.
  const magnitude = negative && /[1-9]/.test(fraction.slice(2)) ? truncated + 1 : truncated;
  if (!Number.isSafeInteger(magnitude)) return null;
  // `-0` is not a balance; zero has one spelling.
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

/**
 * Read the account balance: `GET https://rest.clicksend.com/v3/account`, HTTP
 * Basic, a five-second abort. NOTHING THROWS — see the file header — and the
 * failure reasons are the closed `AccountBalanceFailure` set: the HTTP status,
 * the error class, or a verdict on the body; never the body itself, which
 * can echo the request our credentials authorised.
 */
export async function getAccountBalance(
  creds: ClickSendCreds,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AccountBalanceResult> {
  // Built at call time and never stored, logged or returned (T-4-10).
  const authorization = `Basic ${Buffer.from(`${creds.username}:${creds.apiKey}`).toString('base64')}`;
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${API_BASE}/account`, {
      method: 'GET',
      headers: { authorization, accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? BALANCE_TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }

  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: 'unparseable' };

  const balanceCents = centsFromDecimal(parsed.data.data?.balance);
  if (balanceCents === null) return { ok: false, reason: 'unparseable' };

  // The floors are AUD. A figure in another currency is not comparable to
  // them, so it is unreadable — never converted, never compared.
  const currency = parsed.data.data?._currency?.currency_name_short?.trim().toUpperCase();
  if (currency !== 'AUD') return { ok: false, reason: 'not_aud' };

  return { ok: true, balanceCents, currency: 'AUD' };
}
