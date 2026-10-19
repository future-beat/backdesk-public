/**
 * The daily messaging sweep — the GUARANTEE behind two webhook HINTS
 * (MSG-01, T-4-18).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS MODULE CONTAINS NO DECISION OF ITS OWN. It re-runs the SAME three   │
 * │ application paths the callbacks use, over data pulled from the provider. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `applyDeliveryReceipt`, `handleInboundSms` and `suppressFromInbound` are
 * imported, not re-implemented. That is the whole design: a second copy of "is
 * this a STOP", "which cadence does this thread to" or "what does this status
 * mean" would drift from the first, and the drift would only ever be visible as
 * a customer being treated differently depending on whether their message
 * arrived by callback or by poll.
 *
 * ── WHY A POLL AT ALL (SYNC-03's split, one channel over) ───────────────────
 *
 * Three holes, and the third is the one that matters:
 *
 *   1. A delivery receipt callback can be dropped. Cost: a NULL column.
 *   2. An inbound callback can be dropped, or fail while the deploy is mid-flight.
 *      Cost: a customer's reply is never seen — including a STOP.
 *   3. ClickSend maintains its OWN opt-out list and can refuse a send outright
 *      because the recipient opted out with them (research A3 / Pitfall 2). That
 *      opt-out may never have passed through our inbound door at all, so no
 *      amount of webhook reliability would produce it. Cost: our suppression
 *      evidence is missing a person who asked to be left alone, and the next
 *      quote for them starts a fresh cadence.
 *
 * ── IT RECORDS FACTS. IT NEVER CREATES SENDS (D-07) ─────────────────────────
 *
 * Nothing here resends, re-enqueues, resets a touch or clears an outcome. The
 * client functions it calls are GETs. A reconciliation that could send would
 * turn a provider outage into a customer being messaged twice, which is the
 * exact failure the whole ledger design exists to prevent.
 *
 * ── IDEMPOTENT BY CONSTRUCTION, WHICH IS WHY THE WINDOW CAN OVERLAP ─────────
 *
 * Every run looks back 48 hours, so a missed day is recovered by the next run
 * with no state to track and no cursor to corrupt. That is only safe because
 * each of the three writes converges: a receipt re-applies identical values and
 * moves only `delivery_updated_at`, an inbound replay is skipped on
 * `provider_message_id`, and a suppression insert hits the unique index.
 */
import { suppressFromInbound } from '@/core/cadence/controls';
import { getServerEnv } from '@/core/shared/env';
import {
  anyChannelEnabled,
  findInboundByProviderMessageId,
  forAllTenants_ledgerOwners,
} from '@/db/repository';

import {
  isOptOutCode,
  listInboundSms,
  listSmsHistory,
  type ClickSendCreds,
} from './clicksend-client';
import { handleInboundSms } from './inbound';
import { applyDeliveryReceipt, providerVerdictCorpus } from './receipts';

/**
 * 48 hours, not 24.
 *
 * The sweep runs daily, so a 24-hour window has no margin at all: one skipped
 * run — a deploy, a cron outage, a function timeout — and the messages from
 * that day are never looked at again by anything. Doubling it costs one extra
 * page of a provider query and buys a full missed run.
 */
const WINDOW_HOURS = 48;

export interface ReconcileResult {
  /** True when sms is not activated — every count below is then 0. */
  skipped: boolean;
  receiptsApplied: number;
  inboundReplayed: number;
  optOutsRecorded: number;
}

const NOTHING: ReconcileResult = {
  skipped: true,
  receiptsApplied: 0,
  inboundReplayed: 0,
  optOutsRecorded: 0,
};

/**
 * Every collaborator, injectable.
 *
 * Not for tidiness: the alternative is a test that reaches the hosted database
 * and a live ClickSend account to prove that a STOP found by a poll is honoured.
 * With these, every branch below is assertable by observing which dependency was
 * called with what — and the suite cannot write a `messaging_config` row, which
 * on this production-shared database is the switch that arms real messaging for
 * every client (the rule 04-03 established for `chooseSmsSender`).
 */
export interface ReconcileDeps {
  anyEnabled?: typeof anyChannelEnabled;
  creds?: { username?: string; apiKey?: string };
  listHistory?: typeof listSmsHistory;
  listInbound?: typeof listInboundSms;
  applyReceipt?: typeof applyDeliveryReceipt;
  findInbound?: typeof findInboundByProviderMessageId;
  handleInbound?: typeof handleInboundSms;
  ledgerOwners?: typeof forAllTenants_ledgerOwners;
  suppress?: typeof suppressFromInbound;
  now?: Date;
}

export async function reconcileMessaging(deps: ReconcileDeps = {}): Promise<ReconcileResult> {
  const anyEnabled = deps.anyEnabled ?? anyChannelEnabled;
  const now = deps.now ?? new Date();

  // THE GUARD IS FIRST AND IT IS TOTAL. With no enabled sms row ANYWHERE
  // (production's state while the AU dedicated number is blocked on the IPND
  // business-address requirement, D-08) or no credentials on this deploy, there
  // is no account to poll and every message in the ledger is a stub. Zero HTTP
  // calls, which the suite asserts rather than assumes: a sweep that
  // "harmlessly" queried an unconfigured account would authenticate with empty
  // credentials on every tick, forever.
  //
  // THE QUESTION IS DEPLOYMENT-LEVEL — "is there any account activity to poll"
  // — and so is the accessor. It used to read the GLOBAL row alone, which was
  // the right question only while the send path asked the same one. 04-08 moved
  // `buildRoutingSender` onto `anyChannelEnabled`, so a single client's override
  // row now arms real sms with the global row still off; a guard left on the
  // global row would skip the nightly sweep for exactly that client — no
  // recovered receipts, and worse, no recovered STOPs. The identity question
  // ("as whom does THIS client send") stays where 04-08 put it, in the
  // per-tenant resolvers; nothing here needs it, because the poll is
  // account-wide by construction.
  const rawCreds = deps.creds ?? {
    username: getServerEnv().CLICKSEND_USERNAME,
    apiKey: getServerEnv().CLICKSEND_API_KEY,
  };
  if (!(await anyEnabled('sms')) || !rawCreds.username || !rawCreds.apiKey) return NOTHING;

  const creds: ClickSendCreds = { username: rawCreds.username, apiKey: rawCreds.apiKey };
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);

  const receipts = await applyHistory({ ...deps, creds, since, now });
  const inboundReplayed = await replayInbound({ ...deps, creds, since, now });
  const optOutsRecorded = await recordOptOuts({ ...deps, ledgerIds: receipts.optedOutLedgerIds });

  console.info(
    `[messaging] reconcile applied=${receipts.applied} replayed=${inboundReplayed} ` +
      `optouts=${optOutsRecorded}`,
  );

  return {
    skipped: false,
    receiptsApplied: receipts.applied,
    inboundReplayed,
    optOutsRecorded,
  };
}

interface Pass extends ReconcileDeps {
  creds: ClickSendCreds;
  since: Date;
  now: Date;
}

/**
 * Pass 1 — the delivery facts a DLR callback may have missed.
 *
 * Every history row goes through `applyDeliveryReceipt` unfiltered, rather than
 * being pre-filtered to rows whose `delivery_status IS NULL`. Re-applying a
 * receipt we already hold moves only `delivery_updated_at`, so the pre-filter
 * would buy nothing and cost a second read that could disagree with the update's
 * own predicate. Rows matching no send are the ordinary case — the account's
 * history includes anything sent outside this system — and are counted as
 * nothing, not as errors.
 */
async function applyHistory(
  pass: Pass,
): Promise<{ applied: number; optedOutLedgerIds: string[] }> {
  const listHistory = pass.listHistory ?? listSmsHistory;
  const applyReceipt = pass.applyReceipt ?? applyDeliveryReceipt;

  const result = await listHistory({ creds: pass.creds, since: pass.since, now: pass.now });
  if (!result.ok) {
    // The reason is a code by construction (see the client). A failed poll is
    // not an error to raise: tomorrow's sweep covers the same window.
    console.warn(`[messaging] reconcile history poll failed: ${result.reason}`);
    return { applied: 0, optedOutLedgerIds: [] };
  }

  let applied = 0;
  const optedOutLedgerIds: string[] = [];

  for (const entry of result.items) {
    // TRANSLATION ONLY. The history row's field names differ from the callback's
    // and nothing else about it does — the classification, the timestamp unit
    // and the match rule all live in receipts.ts and are used here unchanged.
    //
    // `status` USED TO BE PASSED AS `status_text`, AND THAT LOST THE VERDICT.
    // ClickSend's history carries both: `status: 'Sent'` (one word, and
    // ambiguous — "we handed it over" or "it arrived"?) and `status_text:
    // 'Message delivered to the handset'` (unambiguous). Folding the first into
    // the second's slot meant the sweep classified every delivered message
    // `unknown`, observed on the first live send. All four fields now travel.
    const outcome = await applyReceipt({
      custom_string: entry.customString,
      message_id: entry.messageId,
      status: entry.status,
      status_text: entry.statusText,
      status_code: entry.statusCode,
      error_code: entry.errorCode,
      error_text: entry.errorText,
      timestamp: entry.date,
    });

    if (outcome.kind !== 'applied') continue;
    applied += 1;

    // THE SAME CORPUS THE CLASSIFIER READS, FROM THE SAME BUILDER, IN THE SAME
    // FIELD ORDER (CR-02, T-4-18).
    //
    // This probe used to read `status` + `status_code` only — and the account's
    // own live capture proves those two fields never carry a verdict: they are
    // `Sent`/`Failed` and `201`/`301`, whose codes are `SENT_201` and
    // `FAILED_301`. Neither contains `OPT`, so `optedOutLedgerIds` came back
    // empty on every real sweep and the pass reported `optOutsRecorded: 0`
    // indistinguishably from "nothing was missed". The prose verdict lives in
    // `status_text` / `error_text`, which is precisely why `classify` was
    // widened to four fields one file over; this is the same defect, found one
    // file later.
    if (
      isOptOutCode(
        providerVerdictCorpus([entry.status, entry.statusText, entry.statusCode, entry.errorText]),
      )
    ) {
      optedOutLedgerIds.push(outcome.ledgerId);
    }
  }

  return { applied, optedOutLedgerIds };
}

/**
 * Pass 2 — the replies, and the STOPs, that never reached the inbound door.
 *
 * Dedupe is on `provider_message_id` via `findInboundByProviderMessageId`, the
 * accessor 04-01 wrote for exactly this and that had no caller until now. A
 * message ClickSend stores without an id CANNOT be deduped, and is replayed
 * anyway: the duplicate costs a second row on the triage screen, and the
 * alternative — skipping it — costs a STOP. D-03's trade, again.
 */
async function replayInbound(pass: Pass): Promise<number> {
  const listInbound = pass.listInbound ?? listInboundSms;
  const findInbound = pass.findInbound ?? findInboundByProviderMessageId;
  const handleInbound = pass.handleInbound ?? handleInboundSms;

  const result = await listInbound({ creds: pass.creds, since: pass.since, now: pass.now });
  if (!result.ok) {
    console.warn(`[messaging] reconcile inbound poll failed: ${result.reason}`);
    return 0;
  }

  let replayed = 0;

  for (const entry of result.items) {
    // No sender means nothing to thread to and no address to suppress — the
    // same field the inbound route hard-requires, for the same reason.
    if (!entry.from) continue;

    if (entry.messageId && (await findInbound(entry.messageId)).length > 0) continue;

    // THE SAME ENTRY POINT THE WEBHOOK USES. Every attribution rule, the STOP
    // regex, the D-03 fan-out and the D-05 pause upgrade apply identically to a
    // message that arrived late.
    await handleInbound({
      from: entry.from,
      to: entry.to,
      body: entry.body ?? '',
      providerMessageId: entry.messageId,
    });
    replayed += 1;
  }

  return replayed;
}

/**
 * Pass 3 — turn a provider-side opt-out into OUR suppression evidence (T-4-18).
 *
 * ── WHY THIS READS THE LEDGER'S `outcome` AND NOT A REASON COLUMN ───────────
 *
 * `send_ledger` records WHAT happened to a send but not WHY it failed: dispatch
 * stores an outcome and a provider message id, and `ClickSendSender`'s
 * `recipient_opted_out` label lives only in a log line. So the reason has to
 * come from the same place the sweep gets everything else — ClickSend's own
 * history row — and `outcome = 'failed'` on our side is the corroboration.
 *
 * THAT CORROBORATION IS LOAD-BEARING, not belt-and-braces. `isOptOutCode` is a
 * tolerant `OPT` substring (D-03's trade at the provider boundary, where a false
 * negative loses a suppression a customer asked for), and `OPT_IN` satisfies it.
 * On a send response that is harmless because the check only runs on a message
 * the provider REFUSED; polled history has no such context, so this pass
 * supplies it by requiring the send to have failed on our side too.
 *
 * ── ALREADY SUPPRESSED IS A NO-OP, AND STILL COUNTS ─────────────────────────
 *
 * `suppressFromInbound` writes through the one transaction every "stop chasing
 * this person" path shares, and its insert hits the `suppressed_contacts` unique
 * index. The count reports the STATE this pass guarantees rather than the rows
 * it happened to write — the same distinction `killContact` draws.
 */
async function recordOptOuts(
  deps: ReconcileDeps & { ledgerIds: readonly string[] },
): Promise<number> {
  if (deps.ledgerIds.length === 0) return 0;

  const ledgerOwners = deps.ledgerOwners ?? forAllTenants_ledgerOwners;
  const suppress = deps.suppress ?? suppressFromInbound;

  let recorded = 0;
  for (const owner of await ledgerOwners(deps.ledgerIds)) {
    if (owner.outcome !== 'failed') continue;

    await suppress(owner.tenantId, owner.cadenceId, 'provider_opt_out');
    recorded += 1;
  }

  return recorded;
}
