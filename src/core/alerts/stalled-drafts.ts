/**
 * The stalled-draft alert and the daily digest (CON-04, D-10, D-11).
 *
 * A SIBLING OF `operator-email.ts`, NOT AN EXTENSION OF IT. `OperatorAlertKind`
 * carries a typed `SyncOutcome` as its detail; widening it to also mean "some
 * touches are aging" would make that detail a union of two unrelated
 * vocabularies and put the ServiceM8 alert one careless edit away from
 * interpolating a touch. Two small modules that share three helpers beat one
 * module with a discriminant nobody reads. The three header rules below are
 * copied VERBATIM from that file because they are the rules, not the style:
 *
 * 1. **NOTHING HERE THROWS.** The senders return a typed outcome in every case,
 *    including a missing configuration and a provider outage. They are called
 *    from inside the per-minute cadence tick, and a mail provider having a bad
 *    afternoon must not turn a claimed, recorded stall into an unhandled throw
 *    that takes dispatch down for every client. The email is the least important
 *    thing happening in that code path — the `stall_alerted_at` claim already
 *    happened, and the queue's own count badge is the persistent signal.
 *
 * 2. **THE BODY IS ASSEMBLED FROM A CLOSED VOCABULARY** (T-2-02/T-2-16): a
 *    tenant name, an integer count, the threshold, a timestamp we formatted, and
 *    a URL we built. THAT LIST IS EXHAUSTIVE, and it is the mitigation for the
 *    threat this feature actually carries — an email is the one output of this
 *    system that leaves it unencrypted, unlogged and unrecallable, and the rows
 *    being counted here are attached to a customer's name, their address and a
 *    draft written about their job. None of those four things has an argument
 *    through which it could reach this file. `buildStalledAlert` and
 *    `buildDailyDigest` are PURE and EXPORTED precisely so that claim is proven
 *    by byte-verbatim assertion rather than by reading the file and believing it.
 *
 * 3. **FAILURE DETAIL IS THE ERROR'S `name`, NEVER ITS MESSAGE.** Resend's
 *    error names are already the classification; the message adds prose and the
 *    risk that some future version of it echoes a request we made.
 *
 * `src/core` is framework-free by contract — nothing here imports from `next/*`.
 */
import { Resend } from 'resend';

import { STALL_THRESHOLD_HOURS } from '@/core/aging/stall-policy';
import { DEFAULT_ALERT_FROM } from '@/core/brand';
import { consoleBaseUrl, formatAlertTimestamp } from '@/core/alerts/operator-email';
import { getServerEnv } from '@/core/shared/env';

/**
 * ONE CLIENT'S SHARE OF THE PROBLEM — a name and an integer.
 *
 * There is no touch id here, no quote, no contact, no slot. The operator's next
 * action is "open the queue", and every fact needed to decide that is in these
 * two fields. Anything more would be detail that has to travel through an inbox
 * to be useful, which is the trade this vocabulary refuses.
 */
export interface StalledTenantCount {
  tenantName: string;
  count: number;
}

/**
 * The extension seam (06-04). An ordered list of pre-built sections, each of
 * which is ITSELF from a closed vocabulary decided by whoever built it — the
 * attestation-staleness line 06-04 appends is a client name and a day count.
 *
 * A seam rather than a widened parameter list, because the alternative is that
 * every future digest line becomes a new argument here and this file slowly
 * learns about attestations, onboarding and whatever comes after. Strings in,
 * strings out: the caller owns its own vocabulary and its own assertion.
 */
export interface DigestSection {
  heading: string;
  lines: readonly string[];
}

export interface StalledAlertInput {
  /** One entry per client with newly-stalled touches. May not be empty. */
  perTenantCounts: readonly StalledTenantCount[];
  /** Hours. Passed rather than imported so the body is pinnable in a test. */
  thresholdHours?: number;
  /** Defaults to now. Injectable so the body is assertable. */
  at?: Date;
  /** Defaults to the console's own `/queue`. */
  queueUrl?: string;
}

export interface DailyDigestInput extends StalledAlertInput {
  /** Appended after the counts, before the link. See `DigestSection`. */
  sections?: readonly DigestSection[];
}

export type StalledEmailResult =
  | { ok: true; id: string | null }
  | {
      ok: false;
      /**
       * `not_configured` is a deployment problem (no/invalid Resend
       * credentials); `send_failed` is a provider problem. Separated because
       * only the first one means every future alert is also lost.
       */
      kind: 'not_configured' | 'send_failed';
      /** A classified name or a fixed string. NEVER a provider message. */
      detail: string;
    };

/** The one page an operator can act on this from. */
export function queueUrl(): string {
  return `${consoleBaseUrl()}/queue`;
}

/** Total across clients. Exported because both builders and both routes ask. */
export function totalOf(perTenantCounts: readonly StalledTenantCount[]): number {
  return perTenantCounts.reduce((sum, entry) => sum + entry.count, 0);
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * `Acme Plumbing: 2` per line, largest first.
 *
 * Sorted by count DESCENDING then by name, so the client the operator should
 * open first is the first line rather than whichever tenant id sorted low. The
 * name is interpolated verbatim: it is the operator's own words from onboarding
 * and the ONE piece of free text in this vocabulary, which is why the closed
 * list in rule 2 names it explicitly rather than leaving it implied.
 */
function countLines(perTenantCounts: readonly StalledTenantCount[]): string[] {
  return [...perTenantCounts]
    .sort((a, b) => b.count - a.count || a.tenantName.localeCompare(b.tenantName))
    .map((entry) => `${entry.tenantName}: ${entry.count}`);
}

/** The 06-UI-SPEC sentence, with its three agreement points resolved together. */
function stalledSentence(total: number, thresholdHours: number): string {
  return (
    `${total} unapproved ${plural(total, 'message', 'messages')} ` +
    `${plural(total, 'is', 'are')} inside ${thresholdHours}h of ` +
    `${plural(total, 'its', 'their')} send slot or already past it.`
  );
}

function renderSections(sections: readonly DigestSection[]): string[] {
  return sections.flatMap((section) => [section.heading, ...section.lines, '']);
}

/** `{n} draft{s} stalled — send slots at risk` (06-UI-SPEC, verbatim). */
export function stalledAlertSubject(total: number): string {
  return `${total} ${plural(total, 'draft', 'drafts')} stalled — send slots at risk`;
}

/** `Daily digest: {n} draft{s} still waiting` (06-UI-SPEC, verbatim). */
export function dailyDigestSubject(total: number): string {
  return `Daily digest: ${total} ${plural(total, 'draft', 'drafts')} still waiting`;
}

/**
 * THE IMMEDIATE ALERT — sent once per touch per threshold crossing (D-11).
 *
 * PURE, and exported so its output can be asserted verbatim. Every
 * interpolation below is one of: a tenant name, an integer, the threshold, a
 * timestamp we formatted, or a URL we built. That exhaustive list IS the
 * T-2-16 mitigation — there is no argument to this function through which a
 * customer name, a message body, an address or a draft could reach an inbox.
 *
 * Never throws on an empty input: it renders the honest zero sentence. A
 * builder that threw would move a formatting decision into the tick's catch
 * block, where the consequence of getting it wrong is a lost pass rather than a
 * strange email.
 */
export function buildStalledAlert(input: StalledAlertInput): { subject: string; body: string } {
  const thresholdHours = input.thresholdHours ?? STALL_THRESHOLD_HOURS;
  const at = input.at ?? new Date();
  const url = input.queueUrl ?? queueUrl();
  const total = totalOf(input.perTenantCounts);

  return {
    subject: stalledAlertSubject(total),
    body: [
      stalledSentence(total, thresholdHours),
      '',
      ...countLines(input.perTenantCounts),
      ...(input.perTenantCounts.length > 0 ? [''] : []),
      `Detected: ${formatAlertTimestamp(at)}`,
      '',
      `Open the queue: ${url}`,
      '',
    ].join('\n'),
  };
}

/**
 * THE DAILY ROLL-UP (06:30 Australia/Perth) — everything STILL stalled.
 *
 * ── IT DOES NOT FILTER ON `stall_alerted_at`, AND THAT IS THE DESIGN ────────
 *
 * Every touch in this list has already been alerted about individually; that is
 * what makes it still stalled rather than newly stalled. Filtering the digest on
 * "not yet alerted" would produce an empty digest every single day while the
 * queue quietly grew — the exact failure a roll-up exists to prevent. The
 * once-only guard lives on the immediate alert (`stall_alerted_at`), and the
 * digest is the only roll-up there is: no hourly nagging, because a repeated
 * alert is not an escalating signal, it is trained blindness.
 *
 * The zero case renders honestly rather than being suppressed here. Whether to
 * SEND an empty digest is the route's decision, not the builder's — see
 * `runStalledDigest`.
 */
export function buildDailyDigest(input: DailyDigestInput): { subject: string; body: string } {
  const thresholdHours = input.thresholdHours ?? STALL_THRESHOLD_HOURS;
  const at = input.at ?? new Date();
  const url = input.queueUrl ?? queueUrl();
  const total = totalOf(input.perTenantCounts);

  const opening =
    total === 0
      ? `Nothing is waiting on you — no unapproved message is inside ${thresholdHours}h of its send slot.`
      : stalledSentence(total, thresholdHours);

  return {
    subject: dailyDigestSubject(total),
    body: [
      opening,
      '',
      ...countLines(input.perTenantCounts),
      ...(input.perTenantCounts.length > 0 ? [''] : []),
      ...renderSections(input.sections ?? []),
      `As at ${formatAlertTimestamp(at)}`,
      '',
      `Open the queue: ${url}`,
      '',
    ].join('\n'),
  };
}

/**
 * ONE RESEND PATH, TWO CALLERS.
 *
 * The alert and the digest differ in what they SAY, never in how they are sent —
 * so there is one send here rather than two, for the reason 06-01 extracted the
 * approval core before its second surface existed: a second correct copy is a
 * copy that drifts the first time one of them is widened.
 */
async function sendClosedVocabularyEmail(message: {
  subject: string;
  body: string;
}): Promise<StalledEmailResult> {
  let to: string;
  let from: string;
  let apiKey: string;
  try {
    const env = getServerEnv();
    to = env.OPERATOR_ALERT_EMAIL;
    from = env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM;
    apiKey = env.RESEND_API_KEY;
  } catch {
    // The thrown value is a zod report naming the offending VARIABLES, which is
    // safe — but it is deliberately not forwarded, because this string is
    // logged from inside the tick and the rule about what may be logged from
    // that depth is absolute rather than case-by-case.
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
      subject: message.subject,
      text: message.body,
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

/**
 * The seam both callers inject in tests, and the reason no suite here sends a
 * real email. Same shape as `sendClosedVocabularyEmail`, so a fake is a
 * one-liner.
 */
export type StalledEmailSender = (message: {
  subject: string;
  body: string;
}) => Promise<StalledEmailResult>;

/*
 * `sendStalledDraftAlert` AND `sendDailyDigest` USED TO SIT HERE, AND NOTHING
 * CALLED EITHER (WR-09).
 *
 * Each was a one-line `build*` + `sendClosedVocabularyEmail` pair. Both routes
 * inject `resendStalledEmailSender` and call the builders themselves — which is
 * the shape the injection seam exists to produce — so these were two additional
 * entry points onto the live Resend path that no code and no test exercised.
 * An unexercised path to a real send is not spare capacity; it is a function
 * whose first caller will be the one that discovers it was wrong.
 *
 * The composition is one line at either call site if it is ever wanted again.
 */

/** The production sender, as a value — what the ROUTES inject. */
export const resendStalledEmailSender: StalledEmailSender = sendClosedVocabularyEmail;

/**
 * THE DEFAULT INSIDE THE ENGINE — sends nothing, and SAYS SO.
 *
 * The same composition-root split `TouchSender`/`StubSender` already makes, and
 * for a sharper version of the same reason. `runCadenceTick` is reachable from a
 * script and from every remote suite in this repository, all of which run
 * against the hosted database; a real Resend default there would mean `npm run
 * test:remote` mails the operator a stall alert about seeded rows. The routes
 * are the composition roots that know about configuration and pass
 * `resendStalledEmailSender`.
 *
 * It reports `not_configured` rather than `ok`, deliberately. A no-op that
 * returned success would make "nothing was sent because nobody wired a sender"
 * indistinguishable from "the operator was told" — and the touch has already
 * been claimed by then, so the difference is a permanently missing alert. This
 * way it lands in `stallAlertFailed`, which is a number in the tick's response.
 */
export const noopStalledEmailSender: StalledEmailSender = async () => ({
  ok: false,
  kind: 'not_configured',
  detail: 'no stall alert sender was injected',
});
