/**
 * The shape a reply classification must have. STRUCTURED OUTPUT, never parsed
 * from prose (AI-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE VOCABULARY, THREE PLACES, BYTE-IDENTICAL — OR THE LABEL IS LOST.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * These enums are DERIVED from `INBOUND_LABELS` and `LABEL_CONFIDENCES` in
 * src/db/schema/inbound-messages.ts rather than retyped beside them, and that is
 * the entire reason this file exists as its own module. The same words appear in
 * three places that cannot check each other at compile time:
 *
 *   1. the TypeScript const           (inbound-messages.ts)
 *   2. the Postgres CHECK constraint  (migration 0028)
 *   3. the schema the model is bound to  (here)
 *
 * A hyphen in one of them — `not-interested` instead of `not_interested` —
 * produces a label the model happily returns, zod happily accepts, and Postgres
 * rejects at 3am; or, if the CHECK is the one that is wrong, a row that is
 * written successfully and that no `label = …` predicate ever matches. Deriving
 * (1) → (3) removes one of the two ways to get this wrong. The CHECK is pinned
 * to the same spelling by hand and asserted in the remote suite.
 *
 * ── AND A SECOND VOCABULARY, UNDER THE SAME RULE (Phase 13, D-05) ──────────
 *
 * A reply to a LEAD cadence (a caller who rang, was missed and was texted
 * back) is classified into `LEAD_LABELS` with an urgency from
 * `LEAD_URGENCIES`. Same three places — the consts, the lead arm of
 * `inbound_messages_label_known` and `inbound_messages_urgency_known`
 * (migration 0040), and the zod enums below — and the same derivation, so
 * `tests/lead-labels.test.ts` reads all three and compares them member for
 * member. The classifier picks the vocabulary by the row's `lead_id`.
 *
 * ── WHY A SCHEMA AND NOT A PARSED SENTENCE ──────────────────────────────────
 *
 * CLAUDE.md bans free-text classification parsing by name: the label feeds a
 * state machine, and a state machine's inputs must be exact. With
 * `output_config.format` the enum is guaranteed by the API rather than by a
 * regex over prose that reads "I'd classify this as interested, though it's
 * ambiguous". `messages.parse()` returns `parsed_output: null` when the model's
 * output does not satisfy the schema — a null the caller must check, and which
 * is a far better failure than a confident mis-parse.
 *
 * ── THIS SCHEMA DOES NOT DECIDE COMPLIANCE ──────────────────────────────────
 *
 * `opt_out` is a SEMANTIC label for triage. It is NOT what honours a STOP —
 * `isStopMessage()` runs deterministically at the webhook, before any model, and
 * that is what writes suppression. Nothing about a customer's Spam Act rights
 * waits on an LLM being available or being right. See the `INBOUND_LABELS`
 * header for the same statement from the database's side.
 */
import { z } from 'zod';

import { INBOUND_LABELS, LABEL_CONFIDENCES, LEAD_LABELS, LEAD_URGENCIES } from '@/db/schema';

/**
 * `z.enum` over the schema const — see the header. The `[string, ...string[]]`
 * shape is what zod needs; the spread of a `readonly` tuple preserves the exact
 * member list, so adding a label to the database const adds it here with no
 * second edit.
 */
export const ReplyLabel = z.enum(INBOUND_LABELS);
export const ReplyConfidence = z.enum(LABEL_CONFIDENCES);

/**
 * TWO FIELDS, AND DELIBERATELY NO FREE-TEXT ONE.
 *
 * A `reason` or `summary` field would be the model's prose about a customer's
 * message — more customer-adjacent content to store, redact and keep out of
 * logs, in exchange for something no code branches on. The operator reads the
 * ORIGINAL message on the triage screen; a model's paraphrase of it sitting
 * alongside is worse than nothing, because it is the thing that gets skimmed
 * instead.
 */
export const ReplyClassification = z.object({
  label: ReplyLabel,
  confidence: ReplyConfidence,
});

export type ReplyClassification = z.infer<typeof ReplyClassification>;

/**
 * The lead vocabulary (Phase 13, D-05), derived the same way: `z.enum` over
 * the schema consts, never retyped. `LeadReplyLabel` is the label set a reply
 * to a missed-call text is classified into; `LeadUrgency` is how soon the
 * caller needs the work.
 */
export const LeadReplyLabel = z.enum(LEAD_LABELS);
export const LeadUrgency = z.enum(LEAD_URGENCIES);

/**
 * THREE FIELDS NOW, AND STILL NO FREE-TEXT ONE (D-05: "no free-text summary").
 *
 * The urgency is a closed enum the hot rule branches on (D-07), not prose.
 * Confidence is the same three buckets as the quote vocabulary.
 */
export const LeadReplyClassification = z.object({
  label: LeadReplyLabel,
  urgency: LeadUrgency,
  confidence: ReplyConfidence,
});

export type LeadReplyClassification = z.infer<typeof LeadReplyClassification>;
