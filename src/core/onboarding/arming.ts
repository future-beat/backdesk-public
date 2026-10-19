/**
 * WHAT MUST BE TRUE BEFORE REAL CUSTOMER MESSAGING MAY BE TURNED ON (D-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE EVALUATION, READ FROM THE CHECKLIST THE OPERATOR IS LOOKING AT.      │
 * │ This module re-reads nothing. It walks the items `readGoLiveChecklist`   │
 * │ returned, in their fixed order, and names the FIRST unmet gating one.    │
 * │ A gate that asked its own questions would be the second reading of the   │
 * │ activation rule — the one that says "no" beside nine green rows.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY REFUSED AND NOT MERELY HIDDEN (D-05) ────────────────────────────────
 *
 * The arm controls are server actions, and a Server Action id is global: the
 * POST that arms SMS for every connected client can be made from any route by
 * anyone with a session, whatever the card chose to render. So the gate runs
 * server-side on every call, and the refusal is a sentence naming the missing
 * thing rather than a disabled button.
 *
 * ── WHICH ITEMS GATE, AND WHY EACH ONE ──────────────────────────────────────
 *
 *   sm8Connected      — GATING, and it is the addition to D-01's list. A client
 *     whose ServiceM8 key is dead has a stale mirror: their cadences would
 *     chase quotes that may already be won, and nothing could detect the win.
 *     `readGoLiveChecklist` already treats a PAUSED connection as unmet, so
 *     this gate closes on a dead key as well as a missing one.
 *   contactHours      — without a window there is no legal sending time.
 *   templatesApproved — the wording that would go out is nobody's yet.
 *   sm8AutomationOff  — ONB-04: our follow-up must not arrive beside the
 *     client's own ServiceM8 one.
 *   escalationPhone   — a hot lead with nowhere to go is the reply this whole
 *     product exists to catch, landing in a table nobody watches.
 *   sendingDomainVerified — EMAIL ONLY. Mail from an unaligned domain is
 *     rejected or spam-foldered by the RECEIVING side, which nothing here ever
 *     sees (T-4-26).
 *
 * NOT GATING SMS OR EMAIL, deliberately:
 *   voiceProfile — drafting has its own belt: an unapproved draft cannot send,
 *     and a client with a thin voice profile still gets human-approved copy.
 *   the live proofs — they CANNOT gate arming, because producing them
 *     requires the channel armed. They gate "live" and the runbook's last step
 *     (D-01), which is the whole resolution of the ARM-01/02/03 circularity.
 *   the divert and text-back rows — SMS and email arming never depended on the
 *     phone line. They gate `text_back` ONLY (below).
 *
 * ── TEXT-BACK: THE THIRD CHANNEL, PER CLIENT (Phase 12, D-09, D-15) ─────────
 *
 * Ten items, in checklist order. `BOTH_CHANNELS` WHOLE — "onboarding complete"
 * and `sm8Connected` (D-09), contact hours because the after-hours wording is
 * chosen from the window, and the escalation phone because an open-quote call
 * escalates to it (D-16) — then:
 *   smsArmed          — D-15: a text-back leaves from the shared SMS number, so
 *     a client whose SMS is not armed has nothing to send it from.
 *   divertNumber      — an ACTIVE Backdesk number the client's calls divert to.
 *   divertVerified    — the STRICT verification call: the latest proof shows the
 *     caller's number arriving on the active number (WR-02). The carrier that
 *     strips the caller is the one whose callers would be texted at random.
 *   textBackTemplates — all three wordings attested by a human.
 *   neverTextOwnNumber— the client's own lines listed, so a tradie ringing their
 *     own business line is never texted as a lead.
 * Not gating: `textBackArmed` (the switch itself) and `textBackProof` (it needs
 * the switch on to exist) — the D-01 circularity again.
 *
 * ── THE SMS GATE IS EVALUATED AGAINST THE CLIENT WHOSE PAGE THIS IS ─────────
 *
 * Arming SMS writes the SHARED row, which belongs to nobody, so it has no
 * checklist of its own. The gate therefore asks the questions of the client the
 * operator is looking at — the client they are turning sending on FOR — and the
 * control states the blast radius in words before the confirming tap.
 *
 * FRAMEWORK-FREE AND PURE: no `next/*`, no repository, no copy. The action maps
 * the returned key to a sentence.
 */
import type { MessagingChannel } from '@/db/schema';

import type { ChecklistItem, ChecklistItemKey } from './checklist';

/** Every channel's gates, in CHECKLIST_ITEM_KEYS order. Email adds one. */
const BOTH_CHANNELS = [
  'sm8Connected',
  'contactHours',
  'templatesApproved',
  'sm8AutomationOff',
  'escalationPhone',
] as const;

/**
 * `as const satisfies` rather than an annotation: the annotation would widen
 * every entry to `ChecklistItemKey`, and `GatingKey` below would then be all
 * SEVENTEEN checklist keys — so the refusal map beside the actions would demand
 * a sentence for "Text-back armed" and for the rows that never gate anything.
 * `satisfies` keeps the compile-time check that every member is a real
 * checklist key without throwing away which ones these are.
 */
export const ARMING_GATES = {
  sms: BOTH_CHANNELS,
  email: [...BOTH_CHANNELS, 'sendingDomainVerified'],
  text_back: [
    ...BOTH_CHANNELS,
    'smsArmed',
    'divertNumber',
    'divertVerified',
    'textBackTemplates',
    'neverTextOwnNumber',
  ],
} as const satisfies Record<MessagingChannel, readonly ChecklistItemKey[]>;

/** The keys that can appear in a refusal — a strict subset of the checklist's. */
export type GatingKey = (typeof ARMING_GATES)[MessagingChannel][number];

/**
 * The first gating item this client has not met, or `null` when arming may
 * proceed.
 *
 * AN ABSENT ITEM IS UNMET, NEVER VACUOUSLY SATISFIED (T-5-13). If a caller
 * hands over a truncated list — a partial read, a future refactor that drops a
 * row — the honest answer is "that condition is not established", not "no
 * objection". The whole class of defect this rule exists for is the gate that
 * opens because the thing it checks was not there to check.
 */
export function firstUnmetGate(
  channel: MessagingChannel,
  items: readonly ChecklistItem[],
): GatingKey | null {
  const byKey = new Map(items.map((item) => [item.key, item]));

  for (const key of ARMING_GATES[channel]) {
    const item = byKey.get(key);
    if (!item?.satisfied) return key;
  }

  return null;
}
