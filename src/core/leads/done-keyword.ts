/**
 * The tradie's DONE (Phase 14, LEAD-04, D-08): one word from a client's own
 * number closes the lead that number was last alerted about.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS MODULE NEVER TEXTS ANYBODY BACK. It imports nothing that can put a  │
 * │ message on a phone; its only writes are the close (through the one      │
 * │ wrapper) and the evidence row. The tradie's word is the decision, and    │
 * │ the operator hears about a DONE with nothing to close by email.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHERE IT RUNS ──────────────────────────────────────────────────────────
 *
 * `handleInboundSms` calls `handleTradieDone` after the STOP decision, the
 * one normalisation and the cadence lookup, and only when the body is not a
 * STOP, contains DONE, AND NO LIVE CADENCE ANSWERS THE NUMBER (14-REVIEW
 * WR-05). A STOP from an own number is still a STOP. The text-back gate
 * refuses `own_number` before a lead can exist, so a client's own number
 * carries no cadence AT THAT CLIENT — but a tradie can be another client's
 * customer, and his "all done, thanks" to that client's cadence is that
 * cadence's reply: it threads and pauses there, and this branch is never
 * taken. For every number that is no client's own this is a `null` and the
 * door goes on exactly as before.
 *
 * ── WHO IS AN OWN NUMBER, AND WHICH LEAD ───────────────────────────────────
 *
 * A number on the client's never-text list (`own_line` or `never_text`) or
 * the client's escalation phone (`tenantsOwningNumber`). A DONE from any other
 * number is not this module's: it returns `null` and the reply is an ordinary
 * one — a customer typing "all done, thanks" closes nothing.
 *
 * The lead is the one whose escalation was most recently SENT to that number
 * within `DONE_LOOKBACK_HOURS` (`latestSentLeadEscalationTo`; at the boundary
 * is inside). Found: closed `closed_by_tradie` through `closeLead` — the
 * WRAPPER, because the door holds no transaction — and the row is recorded
 * pre-triaged with the tenant: the tradie already decided, and the inbox is
 * for things a human must decide. `already_closed` is honoured silently.
 * Not found: the row is recorded untriaged (it shows in the inbox, the
 * visible half of the alert) and ONE operator email of kind `done_no_lead`
 * names the client.
 *
 * Compliance before evidence (`inbound.ts`'s T-4-01 order): the close first,
 * then the row.
 *
 * ── A NUMBER ON TWO CLIENTS' SETS ──────────────────────────────────────────
 *
 * The escalation read takes EVERY owning tenant, so the lead closed is the one
 * that number was actually alerted about, wherever it lives. With nothing to
 * close, the row and the alert go to the lowest tenant id (`ids[0]`, sorted).
 * Either way the log names every owning tenant id: a shared own number is an
 * operator configuration question, not a reason to drop the reply.
 *
 * Logs carry ids and kinds only — never the number that texted, never the
 * body (T-4-02, T-14-09).
 */
import type { OperatorAlertInput, OperatorAlertResult } from '@/core/alerts/operator-email';
import type { InboundSmsResult } from '@/core/messaging/inbound';
import {
  forTenant,
  insertInboundMessage,
  latestSentLeadEscalationTo,
  tenantsOwningNumber,
  type InboundMessageInsert,
} from '@/db/repository';

import { closeLead } from './close';
import { DONE_LOOKBACK_HOURS } from './constants';

const MS_PER_HOUR = 3_600_000;

/** What the client is called in the alert when its row cannot be read. */
const UNNAMED_CLIENT = 'unknown client';

/**
 * DONE as a whole word, anywhere in the body, any case — the URGENT precedent
 * (13-CONTEXT D-06): "DONE", "done thanks" and "all done." match; "undone"
 * and "DONEish" do not, because a letter touches the word. A hyphen is not a
 * letter, so "well-done" matches.
 *
 * NOT a global regex, deliberately: `/g` carries `lastIndex` between calls, so
 * a module-level constant would answer alternately for identical inputs — the
 * note `stop-keywords.ts` carries.
 */
const DONE_PATTERN = /(^|[^a-z])done([^a-z]|$)/i;

/**
 * True when the body contains the word DONE.
 *
 * Non-strings answer `false` rather than throwing, the `isStopMessage`
 * convention: this sits one step from an untrusted provider payload.
 */
export function isDoneKeyword(body: string): boolean {
  if (typeof body !== 'string') return false;
  return DONE_PATTERN.test(body);
}

/** What the door writes for every inbound row, minus its verdict. */
type InboundRowBase = Omit<InboundMessageInsert, 'attribution' | 'matchedCadenceCount'>;

export interface TradieDoneDeps {
  /** The operator email — `sendOperatorAlert` in production, a spy in tests. */
  alert: (input: OperatorAlertInput) => Promise<OperatorAlertResult>;
}

/**
 * The door's DONE branch. `null` when the number is no client's own — the
 * caller then handles the reply exactly as it would have. Otherwise the reply
 * is recorded and the result says what it did.
 */
export async function handleTradieDone(
  base: InboundRowBase,
  normalizedFrom: string,
  now: Date,
  deps: TradieDoneDeps,
): Promise<InboundSmsResult | null> {
  const ids = await tenantsOwningNumber(normalizedFrom);
  // Sorted by the read, so the first owner is a stable choice.
  const [firstOwnerId] = ids;
  if (firstOwnerId === undefined) return null;

  const since = new Date(now.getTime() - DONE_LOOKBACK_HOURS * MS_PER_HOUR);
  const answered = await latestSentLeadEscalationTo(ids, normalizedFrom, since);

  if (answered !== null) {
    const { tenantId, leadId } = answered;
    const closeResult = await closeLead(tenantId, leadId, 'closed_by_tradie', now);
    const { id: inboundId } = await insertInboundMessage({
      ...base,
      tenantId,
      attribution: 'unmatched',
      matchedCadenceCount: 0,
      triagedAt: now,
    });

    console.log(
      `[leads] inbound ${inboundId}: DONE from an own number closed lead ${leadId} ` +
        `(tenant ${tenantId}); close result '${closeResult.kind}'.`,
    );
    logSharedOwnNumber(inboundId, ids);

    return { kind: 'done_closed', inboundId, tenantId, leadId, close: closeResult.kind };
  }

  const tenantId = firstOwnerId;
  const { id: inboundId } = await insertInboundMessage({
    ...base,
    tenantId,
    attribution: 'unmatched',
    matchedCadenceCount: 0,
  });

  console.warn(
    `[leads] inbound ${inboundId}: DONE from an own number, but no lead was escalated ` +
      `to this number inside the DONE lookback; operator alerted (tenant ${tenantId}).`,
  );
  logSharedOwnNumber(inboundId, ids);

  // The row is written; nothing below may turn this call into a throw, or the
  // provider's retry would record the reply twice.
  try {
    const [tenant] = await forTenant(tenantId).tenant.get();
    const alertResult = await deps.alert({
      kind: 'done_no_lead',
      tenantId,
      tenantName: tenant?.name ?? UNNAMED_CLIENT,
      at: now,
    });
    if (!alertResult.ok) {
      console.error(
        `[leads] inbound ${inboundId}: the done_no_lead alert was not sent ('${alertResult.kind}').`,
      );
    }
  } catch {
    // Discarded: a driver error can name columns, and this line is a log.
    console.error(
      `[leads] inbound ${inboundId}: the done_no_lead alert could not be prepared.`,
    );
  }

  return { kind: 'done_no_lead', inboundId, tenantId };
}

/** One line per further owning tenant, when a number is on two clients' sets. */
function logSharedOwnNumber(inboundId: string, ids: readonly string[]): void {
  if (ids.length < 2) return;
  const [firstTenantId, ...others] = ids;
  for (const otherTenantId of others) {
    console.warn(
      `[leads] inbound ${inboundId}: DONE came from a number on two clients' ` +
        `own-number sets (tenant ${firstTenantId} and tenant ${otherTenantId}); ` +
        'check the never-text lists and escalation phones.',
    );
  }
}
