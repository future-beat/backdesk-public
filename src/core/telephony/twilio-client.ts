/**
 * The Twilio REST client — the ONE file in the repository that imports the
 * `twilio` REST client (Phase 11, CAP-01/CAP-02/CAP-03, D-10).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CLICKSEND-CLIENT INVARIANTS, RESTATED FOR A SECOND PROVIDER:         │
 * │   1. Credentials are never interpolated into a returned string.         │
 * │   2. NOTHING THROWS. Every function resolves to a closed union.          │
 * │   3. A failure is a CODE — `http_<status>`, an error's `name`, a system  │
 * │      errno, or `sdk_error` — bounded to [A-Za-z0-9_]{1,32}. Never the    │
 * │      provider's prose: a Twilio error message can quote the number that  │
 * │      was dialled or searched, and these reasons reach log lines.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The webhook routes do NOT import this file. They import only the signature
 * validator, by deep path (`twilio/lib/webhooks/webhooks`, through
 * `verify-signature.ts`), so a route's bundle carries no REST surface and a
 * route cannot place a call, buy a number or read a call log.
 *
 * ── WHY THE SDK HERE AND NOT A `fetch` WRAPPER ──────────────────────────────
 *
 * CLAUDE.md's SDK ban is specific to ClickSend's generated client. Twilio's is
 * hand-maintained and typed, pages `list()` itself, and composes the edge /
 * region hostname (`BaseTwilio.d.ts:104-108`) — the two things a hand-rolled
 * wrapper would get subtly wrong (RESEARCH "Don't hand-roll").
 *
 * ── THE EDGE (D-10) ─────────────────────────────────────────────────────────
 *
 * `edge: 'sydney'` changes where OUR API traffic enters Twilio; it does not
 * move where a call is processed (US1 under D-10), so the call log the
 * reconcile reads is the US1 log. The edge is one constant so the deferred AU1
 * migration is one edit (add `region: 'au1'` beside it).
 *
 * ── THE SURFACE IS SIX OPERATIONS AND NO MORE (T-11-SC) ─────────────────────
 *
 * List inbound calls, COUNT recordings, search AU local numbers, purchase one
 * number, list OUR numbers by friendly name (the CR-01 adopt path's read), and
 * ATTACH THE REGULATORY BUNDLE to a number we own (WR-09) — the one, narrowly
 * named update in this file, which sets `bundleSid` and nothing else.
 * There is no release, no delete, no other update, no outbound call and no
 * recording fetch: a capability that does not exist in this file cannot be
 * reached by any caller of it. The recordings list exists to prove that there
 * is nothing to list (D-04) — it reads the count and discards the items.
 *
 * `src/core` is framework-free by contract — nothing here imports `next/*`.
 */
import twilio from 'twilio';

import { getServerEnv } from '@/core/shared/env';

/**
 * Where our API traffic enters Twilio (D-10). The SDK builds
 * `api.sydney.us1.twilio.com` from this — no hostname is written here.
 */
export const TWILIO_EDGE = 'sydney';

/**
 * Per-request ceiling. The nightly reconcile runs inside a 300 s route; a hung
 * connection must fail as a code rather than hold the route to its limit.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/** The failure half of every result in this file. */
export type TwilioFailure = { ok: false; reason: string };

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
}

/**
 * The account credentials from the environment, or `null` when they cannot be
 * read.
 *
 * `null` rather than a throw: the four Twilio keys are REQUIRED by the env
 * schema, so an unreadable environment is a deployment fault, and the nightly
 * reconcile's answer to a deployment fault is "skip, zero HTTP" — never a 500
 * on the cron tick (RESEARCH Pitfall 12). The thrown zod report is discarded.
 */
export function twilioCredsFromEnv(): TwilioCreds | null {
  try {
    const env = getServerEnv();
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null;
    return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN };
  } catch {
    return null;
  }
}

/**
 * A reason code from anything thrown. The local twin of clicksend-client's
 * `codeOf`, which upper-cases and allows 48 characters — a different shape
 * from the `[A-Za-z0-9_]{1,32}` bound this phase's logs are pinned to.
 *
 * Order: the HTTP status when the SDK exposes one (`RestException.status`),
 * then a Node system errno (`ETIMEDOUT`, `ECONNRESET` — more useful than the
 * transport's class name), then the error's `name`, then `sdk_error`. The
 * message is NEVER read.
 */
export function twilioReasonOf(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const status = (e as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status)) return `http_${status}`;

    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^E[A-Z_]{2,30}$/.test(code)) return code;
  }
  if (e instanceof Error) return boundedCode(e.name);
  return 'sdk_error';
}

function boundedCode(raw: string): string {
  const token = raw
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return token === '' ? 'sdk_error' : token;
}

/**
 * The SDK client. `twilio(accountSid, authToken, opts)` — the package's default
 * export is `TwilioSDK(accountSid?, authToken?, opts?: ClientOpts)`
 * (`lib/index.d.ts`), and `ClientOpts` carries `edge` and `timeout`
 * (`lib/base/BaseTwilio.d.ts:12-24`). Built per call and never cached: the
 * credentials live no longer than the operation that needed them.
 *
 * The constructor itself can throw (an account SID not starting `AC`), so it is
 * only ever called inside a caller's `try`.
 */
function client(creds: TwilioCreds) {
  return twilio(creds.accountSid, creds.authToken, {
    edge: TWILIO_EDGE,
    timeout: REQUEST_TIMEOUT_MS,
  });
}

/* ------------------------------------------------------------------------- *
 * Calls — the reconcile's source (CAP-03, D-06)
 * ------------------------------------------------------------------------- */

/**
 * One call from Twilio's log, mapped field by field. The caller numbers are
 * carried because the reconcile must classify them exactly as the webhook
 * does; they are never logged by this file or its callers.
 */
export interface LoggedCall {
  sid: string;
  status: string;
  direction: string;
  from: string | null;
  to: string;
  forwardedFrom: string | null;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number | null;
}

export type ListInboundCallsResult = { ok: true; items: LoggedCall[] } | TwilioFailure;

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function dateOrNull(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

/** Twilio's `duration` is a string of whole seconds, or null before the call ends. */
function durationOrNull(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Every INBOUND call started after `since`, account-wide, at most `limit`.
 *
 * ONE account-wide read, filtered client-side to `direction === 'inbound'`,
 * rather than one `To`-filtered read per client (RESEARCH §1c): the reconcile
 * maps the result onto its owner table the way `forAllTenants_ledgerOwners` is
 * used for sms. The SDK pages `list()` itself and never returns more than
 * `limit` records.
 */
export async function listInboundCalls(input: {
  creds: TwilioCreds;
  since: Date;
  limit?: number;
}): Promise<ListInboundCallsResult> {
  try {
    const calls = await client(input.creds).calls.list({
      startTimeAfter: input.since,
      limit: input.limit ?? 500,
    });

    const items: LoggedCall[] = [];
    for (const call of calls) {
      if (call.direction !== 'inbound') continue;
      items.push({
        sid: call.sid,
        status: String(call.status),
        direction: call.direction,
        from: textOrNull(call.from),
        to: typeof call.to === 'string' ? call.to : '',
        forwardedFrom: textOrNull(call.forwardedFrom),
        startTime: dateOrNull(call.startTime),
        endTime: dateOrNull(call.endTime),
        durationSeconds: durationOrNull(call.duration),
      });
    }
    return { ok: true, items };
  } catch (e) {
    return { ok: false, reason: twilioReasonOf(e) };
  }
}

/* ------------------------------------------------------------------------- *
 * Recordings — COUNTED, never read (CAP-02, D-04)
 * ------------------------------------------------------------------------- */

export type CountRecordingsResult = { ok: true; count: number } | TwilioFailure;

/**
 * How many recordings exist on the account created after `since` (capped at
 * 50 — any number above zero is the alarm, so the exact count past the cap is
 * immaterial). The list's items are discarded unread: no media, no metadata
 * beyond the count leaves this function.
 */
export async function countRecordingsSince(input: {
  creds: TwilioCreds;
  since: Date;
}): Promise<CountRecordingsResult> {
  try {
    const found = await client(input.creds).recordings.list({
      dateCreatedAfter: input.since,
      limit: 50,
    });
    return { ok: true, count: found.length };
  } catch (e) {
    return { ok: false, reason: twilioReasonOf(e) };
  }
}

/* ------------------------------------------------------------------------- *
 * Numbers — search and purchase (CAP-01, consumed by provisioning)
 * ------------------------------------------------------------------------- */

export interface NumberCandidate {
  phoneNumber: string;
  locality: string | null;
  region: string | null;
  addressRequirements: string | null;
}

export type SearchNumbersResult = { ok: true; candidates: NumberCandidate[] } | TwilioFailure;

/**
 * GENUINE WESTERN AUSTRALIAN GEOGRAPHIC NUMBERS, BY RANGE (WR-08, F-11-07-1).
 *
 * The `08` area code is NOT Western Australia: it is the whole Central and West
 * Region — WA, SA, the NT and Broken Hill (NSW). The first purchase took an
 * `08 75…` number that Twilio's search had labelled "Perth" and its Console
 * then showed as Waikerie, South Australia. So the provider's locality and
 * region strings are not evidence, and a `+618` prefix is not a filter.
 *
 * VERIFIED 2026-10-05 against the ACMA Telecommunications Numbering Plan 2025
 * (F2025L00409, registered 24/03/2025), Schedule 1 — Geographic numbers,
 * Part 4 "Central and West Region":
 * https://www.legislation.gov.au/F2025L00409/asmade/2025-03-24/text/original/pdf
 * Every `(08)` range whose localities are Western Australian charging
 * districts:
 *
 *   (08) 41, 51, 91      Derby, Great Sandy, Port Hedland (the same rows also
 *                        list Christmas Island and Cocos (Keeling) Islands,
 *                        which are administered under WA law)
 *   (08) 52, 53, 54      Perth
 *   (08) 55 except 5550  Bullsbrook East, Pinjarra, Northam (Bakers Hill/Toodyay)
 *   (08) 57, 67, 97      Bridgetown, Bunbury, Busselton, Lake Clifton/Waroona
 *   (08) 58, 68, 98      Albany, Katanning, Kondinin, Narrogin, Wagin
 *   (08) 60, 90          Bruce Rock, Great Victoria, Kalgoorlie, Merredin
 *   (08) 610–659         Perth, Fremantle, Wanneroo, Armadale, Kalamunda, …
 *   (08) 66, 96          Moora, Wongan Hills, Wyalkatchem, York, Northam
 *   (08) 69, 99          Carnamah, Carnarvon, Geraldton, Meekatharra, …
 *   (08) 920–949, 95     Perth, Fremantle, Wanneroo, Bullsbrook East, Pinjarra
 *
 * Everything else under `(08)` — 20, 21, 25–29, 70–89 — is SA, the NT or
 * Broken Hill. (08) 5550 is excluded by the Plan itself.
 *
 * E.164: `+61` `8` and the eight-digit local number.
 */
const WA_GEOGRAPHIC_E164 = /^\+618(?!5550)(?:41|5[1-578]|6\d|9\d)\d{6}$/;

/**
 * THE ONE PREDICATE for "a Western Australian geographic number" (WR-08) —
 * used by the search (both the locality page and the fallback) and by the
 * console's Buy validation, so Find can never offer a number Buy refuses, and
 * neither can accept an SA, NT or Broken Hill number.
 */
export function isWaGeographicNumber(e164: string): boolean {
  return WA_GEOGRAPHIC_E164.test(e164);
}

function candidateOf(n: {
  phoneNumber: string;
  locality?: unknown;
  region?: unknown;
  addressRequirements?: unknown;
}): NumberCandidate {
  return {
    phoneNumber: n.phoneNumber,
    locality: textOrNull(n.locality),
    region: textOrNull(n.region),
    addressRequirements: textOrNull(n.addressRequirements),
  };
}

/**
 * Voice-capable AU LOCAL numbers, Perth first.
 *
 * `inLocality` is documented as a global filter; `AreaCode` / `InRegion` are
 * US/CA-only (RESEARCH correction 2), so the WA filter cannot be server-side.
 * BOTH pages — the Perth locality page and, when nothing on it survives, a
 * second unfiltered voice-enabled page — are narrowed CLIENT-side by NUMBER
 * RANGE with `isWaGeographicNumber` (WR-08), never by the provider's
 * `locality` / `region` strings. Any WA number is acceptable (Pitfall 8): the
 * tradie's customers never dial it. There is deliberately no "any 08" fallback:
 * an SA number is what F-11-07-1 bought. Candidates keep the provider's order.
 */
export async function searchAuLocalNumbers(input: {
  creds: TwilioCreds;
  locality?: string;
  limit?: number;
}): Promise<SearchNumbersResult> {
  try {
    const local = client(input.creds).availablePhoneNumbers('AU').local;

    const inLocality = await local.list({
      inLocality: input.locality ?? 'Perth',
      voiceEnabled: true,
      limit: input.limit ?? 10,
    });
    // Twilio's "Perth" locality results have included a +613 number (11-06,
    // D-11-06-1) and SA +618 7… numbers (11-07, F-11-07-1). The range decides.
    const perth = inLocality.filter((n) => isWaGeographicNumber(n.phoneNumber));
    if (perth.length > 0) return { ok: true, candidates: perth.map(candidateOf) };

    const anyVoice = await local.list({ voiceEnabled: true, limit: 50 });
    const wa = anyVoice.filter((n) => isWaGeographicNumber(n.phoneNumber));
    return { ok: true, candidates: wa.map(candidateOf) };
  } catch (e) {
    return { ok: false, reason: twilioReasonOf(e) };
  }
}

/**
 * A failed purchase, and whether Twilio DEFINITELY refused it (CR-01).
 *
 * `IncomingPhoneNumbers.create` is not idempotent. A timeout, a connection reset
 * after the request left, or a 5xx can each hide a purchase that went through —
 * so only an answer that carries Twilio's own refusal (a 4xx WITH a numeric
 * Twilio error code) is `determinate: true`. Everything else is "may have been
 * bought", and the caller must not open the retry path on it.
 */
export type PurchaseFailure = TwilioFailure & { determinate: boolean };

export type PurchaseNumberResult =
  | {
      ok: true;
      sid: string;
      phoneNumber: string;
      /**
       * The bundle Twilio REPORTS on the created number — read back from the
       * create response, not assumed from the request (WR-09, F-11-07-2: the
       * first live purchase came back `bundle_sid: null` although it was sent).
       */
      bundleSid: string | null;
    }
  | PurchaseFailure;

/**
 * True only for a refusal Twilio answered in full: an HTTP 4xx (not 408, a
 * request timeout, which says nothing about the outcome) carrying a numeric
 * Twilio error code (`RestException.code`, e.g. 21422). A thrown value without
 * both is indeterminate.
 */
export function isDeterminateRefusal(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const status = (e as { status?: unknown }).status;
  const code = (e as { code?: unknown }).code;
  return (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    typeof code === 'number' &&
    Number.isInteger(code)
  );
}

/**
 * Buy ONE number, fully configured in the SAME create call.
 *
 * Everything is set at creation (Pitfall 7): a purchase followed by a second
 * update call leaves a live number on Twilio's demo TwiML for the gap between
 * them — and, if the update fails, indefinitely. `bundleSid` assigns it to the
 * AU regulatory bundle at purchase — and the response's `bundleSid` is returned
 * so the caller can check it took (WR-09); `attachBundle` below is the bundle-
 * only follow-up when it did not.
 *
 * Caller-ID lookup is OFF — a CNAM dip per call is a cost with no reader.
 * NO messaging URL is passed at all: sms stays on ClickSend (S4), and a Twilio
 * number that silently accepted texts would be a second inbound door nobody
 * reconciles. The fallback URL is optional and GET, the static-TwiML shape.
 */
export async function purchaseNumber(input: {
  creds: TwilioCreds;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string;
  statusCallback: string;
  /** REQUIRED (WR-09): an AU local number is not bought without its bundle. */
  bundleSid: string;
  /** REQUIRED (WR-09): nor without the regulatory address. */
  addressSid: string;
  voiceFallbackUrl?: string;
}): Promise<PurchaseNumberResult> {
  const { voiceFallbackUrl } = input;
  try {
    const bought = await client(input.creds).incomingPhoneNumbers.create({
      phoneNumber: input.phoneNumber,
      friendlyName: input.friendlyName,
      bundleSid: input.bundleSid,
      addressSid: input.addressSid,
      voiceUrl: input.voiceUrl,
      voiceMethod: 'POST',
      statusCallback: input.statusCallback,
      statusCallbackMethod: 'POST',
      voiceCallerIdLookup: false,
      ...(voiceFallbackUrl ? { voiceFallbackUrl, voiceFallbackMethod: 'GET' } : {}),
    });
    return {
      ok: true,
      sid: bought.sid,
      phoneNumber: bought.phoneNumber,
      bundleSid: textOrNull(bought.bundleSid),
    };
  } catch (e) {
    return { ok: false, reason: twilioReasonOf(e), determinate: isDeterminateRefusal(e) };
  }
}

export type AttachBundleResult = { ok: true; bundleSid: string | null } | TwilioFailure;

/**
 * ATTACH THE AU REGULATORY BUNDLE TO A NUMBER WE OWN, AND READ IT BACK (WR-09).
 *
 * The one update this file makes, and it sets `bundleSid` ONLY — never a URL,
 * a name or an owner. The first live purchase came back with `bundle_sid: null`
 * although the create call carried it (F-11-07-2), and the founder had to
 * attach it by hand; an unattached regulated number risks reclamation. So the
 * provisioning path calls this when the create response does not show the
 * bundle, then FETCHES the number again and returns what Twilio now reports —
 * the read-back is the answer, not the update's success.
 */
export async function attachBundle(input: {
  creds: TwilioCreds;
  sid: string;
  bundleSid: string;
}): Promise<AttachBundleResult> {
  try {
    const numbers = client(input.creds).incomingPhoneNumbers;
    await numbers(input.sid).update({ bundleSid: input.bundleSid });
    const after = await numbers(input.sid).fetch();
    return { ok: true, bundleSid: textOrNull(after.bundleSid) };
  } catch (e) {
    return { ok: false, reason: twilioReasonOf(e) };
  }
}

/** A number already on the account, as the adopt path needs it. */
export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  /** What Twilio reports as attached (WR-09) — checked on adoption too. */
  bundleSid: string | null;
}

export type ListOwnedNumbersResult = { ok: true; items: OwnedNumber[] } | TwilioFailure;

/**
 * The account's numbers carrying EXACTLY this friendly name — a READ (CR-01).
 *
 * Provisioning names every number `backdesk-divert-<tenantId>`, so this is how a
 * purchase whose outcome was never seen is found again: before any retry, the
 * caller looks here and ADOPTS what it finds instead of buying a second number.
 * The provider filter is exact-match; the client-side filter restates it so a
 * looser server behaviour can never adopt another client's number.
 */
export async function listNumbersByFriendlyName(input: {
  creds: TwilioCreds;
  friendlyName: string;
}): Promise<ListOwnedNumbersResult> {
  try {
    const found = await client(input.creds).incomingPhoneNumbers.list({
      friendlyName: input.friendlyName,
      limit: 5,
    });
    const items: OwnedNumber[] = [];
    for (const n of found) {
      if (n.friendlyName !== input.friendlyName) continue;
      if (typeof n.sid !== 'string' || typeof n.phoneNumber !== 'string') continue;
      items.push({ sid: n.sid, phoneNumber: n.phoneNumber, bundleSid: textOrNull(n.bundleSid) });
    }
    return { ok: true, items };
  } catch (e) {
    return { ok: false, reason: twilioReasonOf(e) };
  }
}
