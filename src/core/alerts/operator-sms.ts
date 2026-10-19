/**
 * The operator alert SMS (Phase 9, D-13, LAND-03).
 *
 * The email lands in an inbox the founder reads between meetings; this lands on
 * the handset in their pocket. Both go out inside the same request as the row
 * that caused them, which is how "within one minute" is satisfied by
 * construction rather than by a queue nobody is watching.
 *
 * ── THE RECIPIENT IS AN ENVIRONMENT VARIABLE, NOT AN ARGUMENT (T-9-07) ──────
 *
 * `sendOperatorSms` takes a body and a request id. It does NOT take a
 * recipient, and that is the mitigation: the one number it can ever text is
 * `OPERATOR_ALERT_PHONE`, read here from `getServerEnv()`. There is no
 * parameter through which a value typed into a public form could become a
 * destination — the worst a hostile submitter can do is make the operator's own
 * phone buzz.
 *
 * ── THE TENANT ARMING FLAG IS THE WRONG GATE HERE (Pitfall 5, T-9-13) ───────
 *
 * The cadence path resolves its from-number through `resolveSmsFrom(tenantId)`
 * in `src/core/messaging/routing-sender.ts`, which returns null unless the
 * effective `messaging_config` row is `enabled`. That switch exists so a remote
 * test or a half-finished activation cannot page a TRADIE'S CUSTOMER, and the
 * escalation pass honours it deliberately.
 *
 * This is a different question. The recipient here is the operator: the person
 * who owns the switch. Gating their own notification on it would mean that with
 * SMS disarmed — which is the current production state — every audit request
 * arrives silently, and the failure looks exactly like nobody asking for an
 * audit. So this module reads the GLOBAL messaging-config row for the sms
 * channel and uses `row.fromAddress` REGARDLESS of `row.enabled`. The arming
 * flag is never read here, and `routing-sender.ts` is deliberately not used.
 *
 * ── NOTHING THROWS ──────────────────────────────────────────────────────────
 *
 * Same rule as `operator-email.ts`, for a sharper reason: the caller is a
 * public server action that has ALREADY STORED the request. A ClickSend outage
 * must degrade to a `not_configured` / `send_failed` recorded on the row, never
 * to an exception that turns a stored request into a 500 the prospect reads as
 * "it didn't work" (D-13).
 *
 * `src/core` is framework-free by contract — nothing here imports from `next/*`.
 * `getChannelConfig` is a repository import, which `routing-sender.ts` already
 * makes from this layer.
 */
import { CONSOLE_HOST, SERVICE_NAME } from '@/core/brand';
import { normalizeForGsm7 } from '@/core/drafting/gsm7';
import { stripControlCharacters } from '@/core/intake/audit-request';
import { sendSms } from '@/core/messaging/clicksend-client';
import { getServerEnv } from '@/core/shared/env';
import { getChannelConfig } from '@/db/repository';

/**
 * Code points kept from the business name and the contact name before they are
 * interpolated (Pitfall 6).
 *
 * THE BUDGET IS THE REASON, and it is arithmetic rather than taste. The fixed
 * text below is 69 septets; one GSM-7 segment is 160. 69 + 40 + 30 + a
 * 12-character E.164 number is 151, which leaves 9 septets of headroom for the
 * extended-table characters (`{`, `}`, `[`, `]`, `~`, `^`, `|`, `\`, `€`) that
 * cost two septets each. An earlier shape carried the trade and the band and
 * reached 159 BEFORE the contact name — hence both caps, and hence the trade,
 * the band and the request id living in the email instead.
 *
 * Cut, not ellipsised: an ellipsis costs a septet to say something the operator
 * can already see, and the full name is in the email that arrives beside this.
 */
const SMS_BUSINESS_NAME_MAX = 40;
const SMS_CONTACT_NAME_MAX = 30;

/**
 * Normalise for GSM-7, then cut to `max` CODE POINTS, not UTF-16 units.
 *
 * `Array.from` iterates code points, so a name containing an astral character
 * cannot be cut between surrogates into a replacement glyph on the operator's
 * screen. `.slice()` on the raw string would.
 *
 * ── THE NORMALISE IS THE FIX, AND IT HAPPENS BEFORE THE CUT (WR-03) ─────────
 *
 * `sendSms` sends the body VERBATIM — `clicksend-client.ts` says so in as many
 * words ("no charset normalization"). This builder capped code points and
 * never normalised, so the one-segment budget above held only for ASCII names,
 * while the suite that claimed to prove it measured `normalizeForGsm7(body)` —
 * a string production never sent. An iOS keyboard types `’` by default, and
 * one of those flips the whole 151-character body from GSM-7 to UCS-2 (70 per
 * segment) — three segments instead of one, silently.
 *
 * BEFORE the cut, not after, because normalising can GROW a string: `…` becomes
 * `...`. Normalising a name already cut to its cap would push it back over.
 *
 * THE HONEST RESIDUAL: `normalizeForGsm7` repairs lookalikes (curly quotes,
 * dashes, ellipsis, no-break spaces) and transliterates nothing. `ë` is not on
 * the GSM 03.38 basic table and has no lookalike, so `Zoë's Electrical` is
 * still a UCS-2 body. That is a correct outcome — the operator gets the name
 * they can read back — and at one alert per request the cost is noise. It is
 * stated rather than claimed away, and pinned by a test.
 *
 * ── AND THE CONTROL CHARACTERS GO FIRST (WR-04) ─────────────────────────────
 *
 * `stripControlCharacters` is the SAME function the email uses — imported from
 * the intake boundary rather than re-spelled here, because two spellings of one
 * rule is how the email got it and the SMS did not. `business_name` and
 * `contact_name` pass zod with `\n`, `\r`, `\t` and `\u0085` intact: the
 * recipient is only the operator's own handset (T-9-07 holds — there is no
 * recipient parameter), so this is not a routing risk, but a newline splits
 * `${contact} ${phone}` and the console link across lines, a `\r` can hide the
 * tail of the message on some handsets, and both break the septet arithmetic
 * above, which assumes no such characters.
 *
 * The strip runs BEFORE the normalise and both run before the cut, so the code
 * points counted against the cap are the ones that will actually be sent.
 */
function cut(value: string, max: number): string {
  const points = Array.from(normalizeForGsm7(stripControlCharacters(value)).trim());
  return points.length <= max ? points.join('') : points.slice(0, max).join('');
}

/**
 * The SMS body. PURE, and exported so the one-segment budget is asserted by a
 * test rather than trusted.
 *
 * NO REQUEST ID IN THE LINK. A uuid is 36 characters — a quarter of the segment
 * — to save one tap on a list that is sorted newest-first and, at this volume,
 * has the request in question at the top of it.
 */
export function auditRequestSmsBody(input: {
  businessName: string;
  contactName: string;
  phone: string;
}): string {
  const business = cut(input.businessName, SMS_BUSINESS_NAME_MAX);
  const contact = cut(input.contactName, SMS_CONTACT_NAME_MAX);

  return (
    `${SERVICE_NAME}: audit request from ${business}. ` +
    `${contact} ${input.phone}. ` +
    `${CONSOLE_HOST}/audits/requests`
  );
}

export type OperatorSmsResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * `not_configured` is a deployment problem (no global from-number, no
       * ClickSend credentials, an unreadable environment); `send_failed` is a
       * provider problem. Separated for the reason `OperatorAlertResult`
       * separates them: only the first means every future alert is also lost.
       */
      kind: 'not_configured' | 'send_failed';
      /** A classified name or reason CODE. NEVER a provider message. */
      detail: string;
    };

/**
 * Text the operator about one audit request. Resolves to a typed outcome in
 * every case, including a missing configuration and a provider outage.
 */
export async function sendOperatorSms(input: {
  requestId: string;
  body: string;
}): Promise<OperatorSmsResult> {
  let to: string;
  let username: string | undefined;
  let apiKey: string | undefined;
  try {
    const env = getServerEnv();
    to = env.OPERATOR_ALERT_PHONE;
    username = env.CLICKSEND_USERNAME;
    apiKey = env.CLICKSEND_API_KEY;
  } catch {
    // The thrown value is a zod report naming the offending VARIABLES, which is
    // safe — but it is deliberately not forwarded, because this string is
    // written to `audit_requests.notify_detail` and read in the console.
    return {
      ok: false,
      kind: 'not_configured',
      detail: 'operator sms environment is invalid or missing',
    };
  }

  if (!username || !apiKey) {
    return { ok: false, kind: 'not_configured', detail: 'clicksend credentials absent' };
  }

  let from: string | null;
  try {
    // THE GLOBAL ROW, no tenant id — see the header. `enabled` is not read.
    const row = await getChannelConfig('sms');
    from = row?.fromAddress ?? null;
  } catch (e) {
    const name = e instanceof Error ? e.name : 'UnknownError';
    return { ok: false, kind: 'not_configured', detail: `sms config read failed (${name})` };
  }

  if (!from) {
    return { ok: false, kind: 'not_configured', detail: 'no global sms from-number' };
  }

  const result = await sendSms(
    {
      to,
      from,
      body: input.body,
      // PREFIXED so a delivery receipt can never match a `send_ledger` row id:
      // an operator alert is not a cadence touch, and 04-04's DLR handler files
      // an unmatched custom string as `unmatched` rather than mislabelling a
      // customer's message.
      customString: `audit-request:${input.requestId}`,
    },
    { username, apiKey },
  );

  return result.ok ? { ok: true } : { ok: false, kind: 'send_failed', detail: result.reason };
}
