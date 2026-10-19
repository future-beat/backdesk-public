/**
 * The operator alert email (SYNC-04, D-05).
 *
 * This is the half of "no silent dead client" that happens while nobody is
 * looking at the console. The banner (02-04 Task 3) tells an operator who has
 * already opened the client's page; this tells the operator who has not, at
 * 4pm on a Friday, that a client's follow-ups stopped an hour ago.
 *
 * ── THREE RULES, NONE OF THEM STYLISTIC ─────────────────────────────────────
 *
 * 1. **NOTHING HERE THROWS.** `sendOperatorAlert` returns a typed outcome in
 *    the same shape as the ServiceM8 boundary (`Sm8Result`), for the same
 *    reason: it is called from inside the sync cycle, and a mail provider
 *    having a bad afternoon must not turn a *recorded, classified, paused*
 *    sync failure into an unhandled throw that skips the `sync_runs` write and
 *    takes the tick down with it. The email is the least important thing
 *    happening in that code path.
 *
 * 2. **THE BODY IS ASSEMBLED FROM A CLOSED VOCABULARY** (T-2-16): the tenant
 *    name, a label from `SYNC_OUTCOME_LABELS`, a timestamp, and a URL we
 *    constructed. No caught error, no response body, no request header, no key
 *    material. `alertBody` is exported and pure precisely so this is provable
 *    by assertion rather than by reading the file and believing it.
 *
 * 3. **FAILURE DETAIL IS THE ERROR'S `name`, NEVER ITS MESSAGE.** Same
 *    invariant as `src/core/servicem8/client.ts`. Resend's error names
 *    (`validation_error`, `missing_api_key`, `invalid_access`, …) are already
 *    the classification; the message adds prose and the risk that some future
 *    version of it echoes a request we made.
 *
 * `src/core` is framework-free by contract — nothing here imports from `next/*`.
 */
import { Resend } from 'resend';

import { DEFAULT_ALERT_FROM, SERVICE_NAME } from '@/core/brand';
import { DONE_LOOKBACK_HOURS } from '@/core/leads/constants';
// THE STRIP IS SHARED, NOT RE-SPELLED (WR-04). It was private to this file, so
// the SMS notifier had no equivalent and this file's own subject line missed
// it. One rule, at the boundary module where the prospect's strings arrive.
import { stripControlCharacters } from '@/core/intake/audit-request';
import { getServerEnv } from '@/core/shared/env';
import { SYNC_OUTCOME_LABELS } from '@/core/sync/outcomes';
import type { SyncOutcome } from '@/db/schema';

/** Where the console runs when neither env var says otherwise. */
const DEV_BASE_URL = 'http://localhost:3000';

/**
 * What happened, in the three shapes an operator has to act on differently.
 *
 * `auth_failed` — the client is PAUSED. Nothing is going out for them until a
 * human pastes a new key. Act now.
 * `degraded` — sync keeps failing but the client is NOT paused; follow-ups
 * continue from the data already mirrored. Act today.
 * `audit_request` — a stranger asked for an audit. Nothing is broken; somebody
 * is waiting for a reply by tomorrow.
 *
 * `audit_request` (Phase 9, D-13) is a THIRD kind on the same sender, not a
 * sibling module, because it is the same act: telling the one operator, by
 * email, that something needs them. It carries a different payload, which is
 * why the input below became a discriminated union rather than gaining four
 * optional fields — optional fields would let a caller build an
 * `audit_request` with a `tenantId` and no business name, and the compiler
 * would agree.
 *
 * `done_no_lead` (Phase 14, D-08) — a tradie texted DONE from one of the
 * client's own numbers and no lead was escalated to that number inside the
 * lookback, so nothing was closed. The reply waits in the inbox; this email
 * says so. ONE EMAIL PER EVENT, not a once-per-day claim: the number that
 * texted is the client's own, so the volume is bounded by the client, and a
 * daily latch would need `operator_alert_log`'s kind CHECK widened.
 */
export type OperatorAlertKind = 'auth_failed' | 'degraded' | 'audit_request' | 'done_no_lead';

/**
 * The two kinds that describe a CLIENT'S sync. Named separately because
 * `alertBody` and `SyncAlertInput` are about a tenant and an outcome, and
 * widening them to the full `OperatorAlertKind` would let an `audit_request`
 * reach a body builder that would render `Reason: undefined`.
 */
export type SyncAlertKind = Exclude<OperatorAlertKind, 'audit_request' | 'done_no_lead'>;

/** The two sync kinds — a client, and what stopped working for them. */
export interface SyncAlertInput {
  kind: SyncAlertKind;
  tenantId: string;
  tenantName: string;
  /** The classified sync outcome — never free text. */
  detail: SyncOutcome;
  /** Defaults to now. Injectable so the body is assertable. */
  at?: Date;
}

/**
 * A stranger asked for an audit (D-13, LAND-03).
 *
 * Every field here is a zod-bounded value off the public form or a boolean we
 * derived — see `auditRequestAlertBody` for why that list, and only that list,
 * is what makes interpolating a stranger's own strings acceptable.
 */
export interface AuditRequestAlertInput {
  kind: 'audit_request';
  requestId: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  /** A human label, resolved from the closed trade vocabulary by the caller. */
  trade: string;
  /** A human label, resolved from the closed band vocabulary by the caller. */
  quotesBand: string;
  servicem8: boolean;
  hasCsv: boolean;
  /** Defaults to now. Injectable so the body is assertable. */
  at?: Date;
}

/**
 * A DONE with nothing to close (Phase 14, D-08). The client's name and when —
 * never the number that texted and never the body: both are in the inbox row
 * behind RLS, which is where the operator reads them.
 */
export interface DoneNoLeadAlertInput {
  kind: 'done_no_lead';
  tenantId: string;
  tenantName: string;
  /** Defaults to now. Injectable so the body is assertable. */
  at?: Date;
}

export type OperatorAlertInput = SyncAlertInput | AuditRequestAlertInput | DoneNoLeadAlertInput;

export type OperatorAlertResult =
  | { ok: true; id: string | null }
  | {
      ok: false;
      /**
       * `not_configured` is a deployment problem (no/invalid Resend
       * credentials); `send_failed` is a provider problem. They are separated
       * because only the first one means every future alert is also lost.
       */
      kind: 'not_configured' | 'send_failed';
      /** A classified name or a fixed string. NEVER a provider message. */
      detail: string;
    };

/**
 * The console's origin: explicit override, then Vercel's production domain,
 * then local dev.
 *
 * The fallback is a real URL rather than a relative path because the output is
 * pasted into an email client, where a relative path is not a link at all.
 */
export function consoleBaseUrl(): string {
  const env = getServerEnv();

  const explicit =
    env.APP_BASE_URL ??
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);

  return (explicit ?? DEV_BASE_URL).replace(/\/+$/, '');
}

/** The page the operator needs to be on to fix this. */
export function clientDetailUrl(tenantId: string): string {
  return `${consoleBaseUrl()}/clients/${tenantId}`;
}

/** The page the operator opens to act on one audit request (D-15). */
export function auditRequestUrl(requestId: string): string {
  return `${consoleBaseUrl()}/audits/requests/${requestId}`;
}

/**
 * `2026-08-26 09:14:03 UTC`.
 *
 * UTC, and labelled as such. The tenant's timezone governs how THEIR customers
 * are contacted; it says nothing about where the operator is reading email, and
 * an unlabelled local-looking timestamp in an incident alert is how an hour of
 * an outage gets misattributed.
 */
export function formatAlertTimestamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/**
 * `tenantName` is the client for the two sync kinds and the PROSPECT'S BUSINESS
 * NAME for `audit_request` — one parameter because it answers one question in
 * every case: whose problem is this. The audit subject is built from
 * `SERVICE_NAME` so the console, the email and the SMS cannot drift apart.
 *
 * ── THE STRIP RUNS HERE TOO (WR-02, T-9-08) ─────────────────────────────────
 *
 * `auditRequestAlertBody` passes every interpolated value through
 * `stripControlCharacters`; this function did not, and it is the one that
 * builds an actual MIME HEADER. zod's `.trim()` takes leading and trailing
 * whitespace only, so an embedded `\r\n` inside a 120-character business name
 * reached the `subject` field intact. Resend's JSON API most likely folds or
 * rejects it, which makes this defence in depth rather than a demonstrated
 * exploit — but "most likely" is the wrong standard for the field where a
 * newline means something structural, and the relaxation that lets a
 * stranger's own strings into this email is only safe because of this strip.
 *
 * Applied to every kind, not just `audit_request`: the sync kinds carry a name
 * the operator typed themselves, so stripping there costs nothing and leaves
 * one rule instead of a conditional somebody has to reason about.
 */
export function alertSubject(kind: OperatorAlertKind, tenantName: string): string {
  const name = stripControlCharacters(tenantName);
  if (kind === 'audit_request') return `${SERVICE_NAME} · Audit request: ${name}`;
  if (kind === 'done_no_lead') return `DONE received for ${name} — no lead to close`;
  return kind === 'auth_failed'
    ? `ServiceM8 connection failed — follow-ups paused for ${name}`
    : `ServiceM8 sync degraded for ${name}`;
}

/**
 * The audit-request email body. PURE, and exported so it can be asserted
 * verbatim — including with a header-injection fixture.
 *
 * Plain text only, no HTML: there is no markup for an injected string to
 * escape into. Every interpolation is either a zod-bounded form value passed
 * through `stripControlCharacters`, a label the caller resolved from a closed
 * vocabulary, a boolean we rendered, or a URL we built.
 */
export function auditRequestAlertBody(input: {
  requestId: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  trade: string;
  quotesBand: string;
  servicem8: boolean;
  hasCsv: boolean;
  at: Date;
  url: string;
}): string {
  const clean = stripControlCharacters;

  return [
    'Someone asked for a Quote Leakage Audit.',
    '',
    `Business: ${clean(input.businessName)}`,
    `Contact: ${clean(input.contactName)}`,
    `Mobile: ${clean(input.phone)}`,
    `Email: ${clean(input.email)}`,
    `Trade: ${clean(input.trade)}`,
    `Quotes a month: ${clean(input.quotesBand)}`,
    `On ServiceM8: ${input.servicem8 ? 'yes' : 'no'}`,
    `Job List export attached: ${input.hasCsv ? 'yes' : 'no'}`,
    `Received: ${formatAlertTimestamp(input.at)}`,
    '',
    'Open the request to start the audit:',
    '',
    input.url,
    '',
  ].join('\n');
}

/**
 * The done_no_lead email body (Phase 14, D-08). PURE, and exported so it can
 * be asserted verbatim.
 *
 * Fixed sentences, the client's name (control characters stripped), a
 * timestamp we formatted and a URL we built. No number and no body: there is
 * no argument through which either could arrive.
 */
export function doneNoLeadAlertBody(input: { tenantName: string; url: string; at: Date }): string {
  return [
    'A DONE reply arrived from one of this client’s own numbers, but no lead',
    `was escalated to that number in the last ${DONE_LOOKBACK_HOURS} hours, so nothing was closed.`,
    '',
    `Client: ${stripControlCharacters(input.tenantName)}`,
    `Received: ${formatAlertTimestamp(input.at)}`,
    '',
    'The reply is waiting in the inbox. Find the lead the tradie meant and',
    'close it there, or mark the reply handled.',
    '',
    input.url,
    '',
  ].join('\n');
}

/**
 * The email body. PURE, and exported so its output can be asserted verbatim.
 *
 * Every interpolation below is one of: the tenant name, a label looked up in
 * the closed outcome vocabulary, a timestamp we formatted, or a URL we built.
 * That exhaustive list IS the T-2-16 mitigation — there is no argument to this
 * function through which a caught error, a response body or an API key could
 * reach an inbox.
 */
export function alertBody(input: {
  tenantName: string;
  kind: SyncAlertKind;
  detail: SyncOutcome;
  at: Date;
  url: string;
}): string {
  const { tenantName, kind, detail, at, url } = input;

  const facts = [
    `Client: ${tenantName}`,
    `Reason: ${SYNC_OUTCOME_LABELS[detail]}`,
    `Detected: ${formatAlertTimestamp(at)}`,
  ].join('\n');

  if (kind === 'auth_failed') {
    return [
      'ServiceM8 rejected this client’s API key, so their follow-ups are paused.',
      '',
      facts,
      '',
      'Nothing will go out for this client until a new key is saved. Open the',
      'client below and use “Replace key” — the new key is verified with a live',
      'call and sync resumes automatically.',
      '',
      url,
      '',
    ].join('\n');
  }

  return [
    'ServiceM8 sync has failed three times in a row for this client.',
    '',
    facts,
    '',
    'This client is NOT paused — follow-ups continue from the quotes already',
    'mirrored, which means they are working from data that has stopped being',
    'updated. Worth a look today.',
    '',
    url,
    '',
  ].join('\n');
}

/**
 * Send one operator alert.
 *
 * Resolves to a typed outcome in every case, including a missing configuration
 * and a provider outage. See rule 1 in the header for why that matters more
 * here than it does at most call sites.
 */
export async function sendOperatorAlert(
  input: OperatorAlertInput,
): Promise<OperatorAlertResult> {
  const at = input.at ?? new Date();

  let to: string;
  let from: string;
  let apiKey: string;
  let url: string;
  try {
    const env = getServerEnv();
    to = env.OPERATOR_ALERT_EMAIL;
    from = env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM;
    apiKey = env.RESEND_API_KEY;
    // The URL is resolved from the KIND, not from an optional field, so an
    // audit request cannot end up linking at `/clients/undefined`.
    url =
      input.kind === 'audit_request'
        ? auditRequestUrl(input.requestId)
        : clientDetailUrl(input.tenantId);
  } catch {
    // The thrown value is a zod report naming the offending VARIABLES, which is
    // safe — but it is deliberately not forwarded, because this string is
    // logged by the sync cycle and the rule about what may be logged from that
    // depth is absolute rather than case-by-case.
    return {
      ok: false,
      kind: 'not_configured',
      detail: 'operator alert environment is invalid or missing',
    };
  }

  try {
    const { data, error } = await new Resend(apiKey).emails.send({
      from,
      to,
      subject: alertSubject(
        input.kind,
        input.kind === 'audit_request' ? input.businessName : input.tenantName,
      ),
      text:
        input.kind === 'done_no_lead'
          ? doneNoLeadAlertBody({ tenantName: input.tenantName, url, at })
          : input.kind === 'audit_request'
          ? auditRequestAlertBody({
              requestId: input.requestId,
              businessName: input.businessName,
              contactName: input.contactName,
              phone: input.phone,
              email: input.email,
              trade: input.trade,
              quotesBand: input.quotesBand,
              servicem8: input.servicem8,
              hasCsv: input.hasCsv,
              at,
              url,
            })
          : alertBody({
              tenantName: input.tenantName,
              kind: input.kind,
              detail: input.detail,
              at,
              url,
            }),
    });

    if (error) {
      // `name` only — see rule 3 in the header.
      return { ok: false, kind: 'send_failed', detail: error.name ?? 'unknown_error' };
    }

    return { ok: true, id: data?.id ?? null };
  } catch (e) {
    const name = e instanceof Error ? e.name : 'UnknownError';
    return { ok: false, kind: 'send_failed', detail: `send threw (${name})` };
  }
}
