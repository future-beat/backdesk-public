/**
 * The text-back operator emails (Phase 12, D-10, TXT-06).
 *
 * BUILDERS ONLY, AND PURE. They are sent through the `stalled-drafts.ts`
 * closed-vocabulary sender the tick route already injects
 * (`resendStalledEmailSender`), never by SMS: an SMS about an empty SMS balance
 * goes nowhere, and an SMS about a failed SMS is the same channel failing twice.
 *
 * ── THE BODY IS ASSEMBLED FROM A CLOSED VOCABULARY (T-12-07) ───────────────
 *
 * A client's name (the operator's own words from onboarding), integer counts,
 * a balance and floors in dollars we formatted, a closed failure code we
 * produced, a timestamp we formatted and a URL we built. THAT LIST IS
 * EXHAUSTIVE. No caller's number, no message body, no ledger or call id, no
 * tenant id and no credential has an argument through which it could reach an
 * inbox — and `tests/text-back-balance.test.ts` asserts the output carries no
 * `+61` and no run of eight or more digits.
 *
 * Never throws: an empty input renders the honest zero sentence, so a
 * formatting decision can never become a lost pass inside the tick.
 * `src/core` is framework-free — nothing here imports from `next/*`.
 */
import { consoleBaseUrl, formatAlertTimestamp } from '@/core/alerts/operator-email';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * The console's client list — the page the operator acts on any of these from.
 * The LIST, not one client's page: a client page URL carries the tenant id, and
 * no id belongs in an inbox. Reads the environment, so callers compute it
 * inside the try that follows their claim.
 */
export function clientsPageUrl(): string {
  return `${consoleBaseUrl()}/clients`;
}

/**
 * Whole cents as `A$12.34`, an overdraft as `-A$20.87` (12-REVIEW CR-01: a
 * negative ClickSend balance is a readable one and reaches the auto-disarm
 * email). Integer arithmetic only, on the magnitude.
 */
export function formatAud(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const magnitude = Math.abs(cents);
  const whole = Math.floor(magnitude / 100);
  const part = String(magnitude % 100).padStart(2, '0');
  return `${sign}A$${whole}.${part}`;
}

/** One client's share of the failed / unconfirmed text-backs. A name and integers. */
export interface TextBackFailureCount {
  tenantName: string;
  /** The provider refused the text (`failed`). */
  failed: number;
  /** Claimed more than two minutes ago with no recorded outcome. */
  unknown: number;
  /**
   * About-quote texts SENT whose quote cadence could not be paused (12-05,
   * D-08). Absent means zero.
   */
  pauseFailed?: number;
  /**
   * Callers NOT texted because the armed client's attested wording no longer
   * validates against its current name (`no_template`; 12-REVIEW WR-02).
   * Absent means zero.
   */
  noTemplate?: number;
  /**
   * Callers NOT texted because SMS is not armed, or has no identity, for a
   * client armed for text-back (`sms_not_armed`; WR-02). Absent means zero.
   */
  smsNotArmed?: number;
}

export interface TextBackFailureAlertInput {
  perClient: readonly TextBackFailureCount[];
  /** Defaults to now. Injectable so the body is assertable. */
  at?: Date;
  clientsUrl: string;
}

/**
 * FAILED AND STUCK TEXT-BACKS, ONCE (D-10). Sent by `runTextBackAlertPass` in
 * the tick that claims them; a row is never alerted twice.
 *
 * Says plainly that nothing is re-sent automatically, because that is the one
 * fact the operator must not assume otherwise: a failed or unconfirmed text
 * may already have reached the caller (D-04).
 */
export function buildTextBackFailureAlert(input: TextBackFailureAlertInput): {
  subject: string;
  body: string;
} {
  const at = input.at ?? new Date();
  const total = input.perClient.reduce((sum, entry) => sum + entry.failed + entry.unknown, 0);
  const pausesOf = (entry: TextBackFailureCount): number => entry.pauseFailed ?? 0;
  const pauseTotal = input.perClient.reduce((sum, entry) => sum + pausesOf(entry), 0);
  const failedClients = input.perClient.filter((entry) => entry.failed + entry.unknown > 0);
  const pauseClients = input.perClient.filter((entry) => pausesOf(entry) > 0);

  const lines = [...failedClients]
    .sort(
      (a, b) =>
        b.failed + b.unknown - (a.failed + a.unknown) || a.tenantName.localeCompare(b.tenantName),
    )
    .map((entry) => `${entry.tenantName}: ${entry.failed} failed, ${entry.unknown} outcome unknown`);

  // The third category (12-05, D-08): the text DID go out, so it is reported
  // apart from the failures, with the one thing to do about it.
  const pauseLines = [...pauseClients]
    .sort((a, b) => pausesOf(b) - pausesOf(a) || a.tenantName.localeCompare(b.tenantName))
    .map(
      (entry) =>
        `${entry.tenantName}: ${pausesOf(entry)} sent, but the quote cadence could not be ` +
        'paused — pause it on the quote page',
    );

  // The fourth category (12-REVIEW WR-02): an ARMED client whose callers are
  // not being texted because its own configuration stopped allowing a send.
  // Nothing was sent, nothing can reach the caller, and the fix is the
  // operator's — so it gets its own sentence and its own remedy per reason.
  const noTemplateOf = (entry: TextBackFailureCount): number => entry.noTemplate ?? 0;
  const smsNotArmedOf = (entry: TextBackFailureCount): number => entry.smsNotArmed ?? 0;
  const configTotal = input.perClient.reduce(
    (sum, entry) => sum + noTemplateOf(entry) + smsNotArmedOf(entry),
    0,
  );
  const configLines = [...input.perClient]
    .filter((entry) => noTemplateOf(entry) + smsNotArmedOf(entry) > 0)
    .sort(
      (a, b) =>
        noTemplateOf(b) + smsNotArmedOf(b) - (noTemplateOf(a) + smsNotArmedOf(a)) ||
        a.tenantName.localeCompare(b.tenantName),
    )
    .flatMap((entry) => [
      ...(noTemplateOf(entry) > 0
        ? [
            `${entry.tenantName}: ${noTemplateOf(entry)} not texted — the attested wording no ` +
              'longer validates against the business name; save and attest it again on the ' +
              'Text-back page',
          ]
        : []),
      ...(smsNotArmedOf(entry) > 0
        ? [
            `${entry.tenantName}: ${smsNotArmedOf(entry)} not texted — SMS is not armed for ` +
              'this client; re-arm SMS, or disarm text-back',
          ]
        : []),
    ]);

  const failureSubject = `${total} missed-call ${plural(total, 'text', 'texts')} did not go through`;
  const pauseSubject = `${pauseTotal} quote ${plural(pauseTotal, 'cadence', 'cadences')} not paused after a missed call`;
  const configSubject = `${configTotal} missed ${plural(configTotal, 'caller', 'callers')} not texted: text-back cannot send for an armed client`;
  const subjects = [
    ...(total > 0 ? [failureSubject] : []),
    ...(pauseTotal > 0 ? [pauseSubject] : []),
    ...(configTotal > 0 ? [configSubject] : []),
  ];
  const subject = subjects.length === 0 ? failureSubject : subjects.join('; ');

  const failureSection =
    total > 0 || (pauseTotal === 0 && configTotal === 0)
      ? [
          `${total} missed-call ${plural(total, 'text', 'texts')} failed or ` +
            `${plural(total, 'has', 'have')} no confirmed outcome.`,
          '',
          ...lines,
          ...(lines.length > 0 ? [''] : []),
          'Nothing is re-sent automatically: an unconfirmed text may already have reached the caller.',
          'Check the client and the SMS balance, and call the caller back if needed.',
          '',
        ]
      : [];
  const pauseSection =
    pauseTotal > 0
      ? [
          `${pauseTotal} "about your quote" ${plural(pauseTotal, 'text was', 'texts were')} sent ` +
            `to a quote customer who rang, but the quote cadence could not be paused.`,
          '',
          ...pauseLines,
          '',
          'Pause the cadence on the quote page so no follow-up goes out mid-conversation.',
          '',
        ]
      : [];

  const configSection =
    configTotal > 0
      ? [
          `${configTotal} missed ${plural(configTotal, 'caller was', 'callers were')} not texted ` +
            'because a client armed for missed-call texts can no longer send one.',
          '',
          ...configLines,
          '',
          'Nothing was sent to these callers; call them back if needed. Until the setup is ' +
            'fixed every caller to that client goes untexted, and this is reported at most ' +
            'once a day per client.',
          '',
        ]
      : [];

  return {
    subject,
    body: [
      ...failureSection,
      ...pauseSection,
      ...configSection,
      `Detected: ${formatAlertTimestamp(at)}`,
      '',
      `Open the clients: ${input.clientsUrl}`,
      '',
    ].join('\n'),
  };
}

/* ------------------------------------------------------------------------- *
 * The ClickSend balance (D-07, D-10, D-21) — one email of each kind per Perth
 * day, latched by `claimOperatorAlert` in `src/core/leads/balance.ts`.
 *
 * The shared SMS balance is everybody's problem at once, so these name no
 * client: a balance, the floors, a count of clients, and what to do next.
 * No credential, no account name, no provider response body.
 * ------------------------------------------------------------------------- */

export interface BalanceLowAlertInput {
  balanceCents: number;
  alertFloorCents: number;
  disarmFloorCents: number;
  /** Clients currently armed for missed-call texts. */
  armedClients: number;
  at?: Date;
  clientsUrl: string;
}

/** Below the alert floor, above the disarm floor (D-07). */
export function buildBalanceLowAlert(input: BalanceLowAlertInput): { subject: string; body: string } {
  const at = input.at ?? new Date();
  const n = input.armedClients;
  return {
    subject: `ClickSend balance low: ${formatAud(input.balanceCents)}`,
    body: [
      `The ClickSend balance is ${formatAud(input.balanceCents)}, below the ` +
        `${formatAud(input.alertFloorCents)} alert floor.`,
      '',
      `${n} ${plural(n, 'client is', 'clients are')} armed for missed-call texts. ` +
        `Below ${formatAud(input.disarmFloorCents)} every client's missed-call text is ` +
        'switched off automatically.',
      '',
      'Top up the ClickSend account (or check auto-recharge) today.',
      '',
      `Detected: ${formatAlertTimestamp(at)}`,
      '',
      `Open the clients: ${input.clientsUrl}`,
      '',
    ].join('\n'),
  };
}

export interface AutoDisarmAlertInput {
  balanceCents: number;
  disarmFloorCents: number;
  /** Clients switched off by this probe. */
  disarmedClients: number;
  at?: Date;
  clientsUrl: string;
}

/** Below the disarm floor: what the system switched off, and how to undo it (D-21). */
export function buildAutoDisarmAlert(input: AutoDisarmAlertInput): { subject: string; body: string } {
  const at = input.at ?? new Date();
  const n = input.disarmedClients;
  return {
    subject: `Missed-call texts switched off for ${n} ${plural(n, 'client', 'clients')}: ClickSend balance ${formatAud(input.balanceCents)}`,
    body: [
      `The ClickSend balance is ${formatAud(input.balanceCents)}, below the ` +
        `${formatAud(input.disarmFloorCents)} floor, so missed-call texts were switched off ` +
        `for ${n} ${plural(n, 'client', 'clients')}.`,
      '',
      "Each switch-off is recorded in that client's arming history as a system action, with the reason.",
      '',
      'Top up the ClickSend account, then re-arm each client from its page.',
      '',
      `Detected: ${formatAlertTimestamp(at)}`,
      '',
      `Open the clients: ${input.clientsUrl}`,
      '',
    ].join('\n'),
  };
}

export interface BalanceUnreadableAlertInput {
  /** A closed failure code (`http_401`, `timeout`, `not_aud`, `no_credentials`, ...). */
  reason: string;
  armedClients: number;
  at?: Date;
  clientsUrl: string;
}

/**
 * The balance could not be read. Says that NOBODY was switched off, because
 * that is the decision the operator must be able to trust: an outage at the
 * provider is not an empty account (T-12-21).
 */
export function buildBalanceUnreadableAlert(input: BalanceUnreadableAlertInput): {
  subject: string;
  body: string;
} {
  const at = input.at ?? new Date();
  const n = input.armedClients;
  return {
    subject: 'ClickSend balance could not be read',
    body: [
      `The ClickSend balance could not be read (${input.reason}). Nobody was switched off: ` +
        'an unreadable balance is not an empty one.',
      '',
      `${n} ${plural(n, 'client is', 'clients are')} armed for missed-call texts, and a ` +
        'low balance would not be noticed while this persists.',
      '',
      'Check the ClickSend credentials and the account, and run the balance check before arming anyone else.',
      '',
      `Detected: ${formatAlertTimestamp(at)}`,
      '',
      `Open the clients: ${input.clientsUrl}`,
      '',
    ].join('\n'),
  };
}
