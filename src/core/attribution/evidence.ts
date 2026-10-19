/**
 * The evidence chain (D-05) — the part of an attribution row that has to
 * survive everything it describes.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * "The invoice must arrive stapled to proof it paid for itself." When a client
 * asks, six months later, why a $12,400 job is on their recovered-revenue
 * report, the answer has to be reconstructible FROM THE ROW ALONE — after the
 * cadence has been stopped and swept, after the touch drafts are gone, after
 * ServiceM8 has re-synced the quote to a different total. Ids, timestamps,
 * labels, counts, and the constants and baseline the arithmetic used.
 *
 * ── WHAT THIS MUST NEVER BE ─────────────────────────────────────────────────
 *
 * T-7-07. Every table this chain draws from carries a customer's phone number,
 * email address, street address or the verbatim text of what they wrote:
 * `send_ledger.to_address`, `inbound_messages.from_address` / `body` /
 * `raw_payload`, `escalations.to_address`, `cadences.contact_mobile` /
 * `contact_email`. This row OUTLIVES all of them — it is the one place in the
 * system where a customer's mobile number could quietly become permanent, in a
 * jsonb column nobody re-reads, long after the retention rules that governed
 * the source rows stopped applying to it.
 *
 * So the schema is a zod `strictObject` AT EVERY DEPTH — unknown keys are a
 * parse ERROR, not a silent passthrough — and `tests/attribution-decide.test.ts`
 * walks the schema recursively and fails on any key matching
 * `/address|mobile|phone|email|body|raw|from|to$/i`. The two defences are
 * deliberately different in kind: the strict schema stops a field being added
 * by accident at runtime, the walking test stops one being added on purpose at
 * review time.
 *
 * The two exceptions are BOUNDED and DELIBERATE: a job description truncated to
 * 60 code points (so the report line says "Bathroom reno, Scarborough" and not
 * just a job number) and a contact's FIRST NAME capped at 32 (so a per-job line
 * is readable), both operator-facing on a document the client already has.
 */
import { z } from 'zod';

import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';

import type { ResolvedBaseline } from './baseline';
import type { LedgerTouchFields } from './qualify';

/** The description cap, before the ellipsis. See `truncateCodePoints`. */
const DESCRIPTION_MAX = 60;

/**
 * The first-name cap, in code points — the SAME 32 the Phase 6 escalation SMS
 * uses (`src/core/escalation/message.ts`). One number, because a name that
 * renders one way in an alert and another on the report is a name the operator
 * has to reconcile by eye.
 */
const FIRST_NAME_MAX = 32;

const ELLIPSIS = '…';

/**
 * `z.string()` bounded in CODE POINTS, which is the unit everything else here
 * counts in.
 *
 * EXPORTED because the report document (07-04) asserts the same two caps on the
 * way out and must assert them in the same unit. `zod`'s `.max()` counts UTF-16
 * code units, so a description of 60 non-BMP code points plus the ellipsis is
 * 61 code points but 121 units and `.max(61)` rejects it — a string this
 * module's own truncator just produced. The trigger is wider than the
 * truncation path: any description whose UTF-16 length exceeds the cap fails,
 * including a short one carrying a couple of dozen emoji that `truncateCodePoints`
 * never touches. Since `decideAttribution` parses and THROWS, that rejection is
 * a poison pill on a shared cursor, and ServiceM8 job descriptions are free
 * text typed by tradies.
 */
export const codePointMax = (limit: number) =>
  z.string().refine((s) => Array.from(s).length <= limit, {
    message: `must be at most ${limit} code points`,
  });

/**
 * Cut to `limit` CODE POINTS, not UTF-16 units.
 *
 * `String.prototype.slice` cuts surrogate pairs in half and produces mojibake;
 * an emoji or a non-BMP character in a ServiceM8 job description is not exotic.
 * With `ellipsis` (the default) the result is at most `limit + 1` code points
 * and visibly marked as cut — the schema's `max(61)` is that bound stated back.
 */
export function truncateCodePoints(
  text: string,
  limit: number,
  options: { ellipsis?: boolean } = {},
): string {
  const points = Array.from(text);
  if (points.length <= limit) return text;
  if (limit <= 0) return '';

  const cut = points.slice(0, limit).join('').trimEnd();
  return options.ellipsis === false ? cut : `${cut}${ELLIPSIS}`;
}

/**
 * The first whitespace-delimited token of a contact name, capped.
 *
 * EXPORTED so the report generator (07-04) applies the SAME rule rather than
 * its own: the name on a frozen report line and the name in the evidence chain
 * of the row it was generated from must be the same string, or the row stops
 * being evidence for the document.
 *
 * No ellipsis — a truncated name marked with a `…` reads as a system error to
 * the person whose name it is (the `CUSTOMER_NAME_MAX` argument, Phase 6).
 */
export function firstNameOf(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const first = raw.trim().split(/\s+/)[0] ?? '';
  if (first === '') return null;
  return truncateCodePoints(first, FIRST_NAME_MAX, { ellipsis: false });
}

/**
 * The chain, as a closed vocabulary.
 *
 * `strictObject` at every depth — see the header. Timestamps are ISO strings
 * rather than Date objects because this value round-trips through a `jsonb`
 * column and has to compare equal to itself after that round trip.
 */
export const attributionEvidenceSchema = z.strictObject({
  /** `quote_status_events.id` of the win this row was decided from. */
  wonEventId: z.number().int(),

  /**
   * The qualifying touches, in the order they were SENT — `claimedAt` then
   * `touchNumber`, the same order `qualifyingTouches` produced and the same
   * order the row's `firstTouchClaimedAt` / `lastTouchClaimedAt` anchors were
   * taken from.
   */
  ledger: z.array(
    z.strictObject({
      id: z.uuid(),
      /**
       * WHICH CHASE THIS TOUCH BELONGED TO (07 WR-12).
       *
       * A reopened quote gets a second cadence, and each cadence numbers its own
       * touches 1..N. Without this field the stored chain interleaves two chases
       * with no way to tell them apart — on the one artefact whose entire
       * purpose is to be reconstructible when somebody disputes the line.
       *
       * A uuid, so it carries no customer data and passes the schema-walking
       * PII test: it is an id, not an address.
       *
       * ── OPTIONAL, AND THAT IS NOT SLOPPINESS ─────────────────────────────
       *
       * THIS SCHEMA IS A READ SCHEMA AS WELL AS A WRITE ONE. `generateMonthlyReport`
       * calls `attributionEvidenceSchema.parse(row.evidence)` on every stored
       * row, and `quote_attributions` is append-only with no update method and
       * no backfill path — by design, because a row whose evidence changed after
       * a client was invoiced from it is not evidence. So rows frozen BEFORE
       * this field existed have no `cadenceId` key at all, and a required field
       * in a `strictObject` would make them unparseable — turning a legibility
       * improvement into a hard failure to generate any month containing one.
       *
       * `buildEvidence` always writes it, so every row from here on carries it.
       * Optional is what "this evidence store must read every version it has
       * ever written" looks like in a schema.
       */
      cadenceId: z.uuid().optional(),
      touchNumber: z.number().int(),
      channel: z.string(),
      /** The sent (claimed) moment — `send_ledger` has no `sent_at`. */
      claimedAt: z.iso.datetime(),
      /**
       * DELIVERY AS IT STOOD AT CONSUMPTION, AND NEVER RE-CHECKED (Pitfall 7).
       *
       * D-02 counts a touch whose receipt has not arrived (`null`), and the
       * attribution consumer runs within a minute of the win while carrier
       * receipts arrive minutes to hours later. So this field can say `null`
       * for a touch that reports `undelivered` two seconds afterwards, and the
       * row STANDS: there is no re-check path and no update method on
       * `forTenant().attributions`, by design. The honest thing is to record
       * what was known when the figure was struck — which is what this field
       * is — rather than to let an invoiced dollar amount change underneath a
       * document the client already has.
       */
      deliveryStatus: z.string().nullable(),
    }),
  ),

  /** Threaded replies, ordered by receipt. Ids and labels only — never the text. */
  inbound: z.array(
    z.strictObject({
      id: z.uuid(),
      receivedAt: z.iso.datetime(),
      label: z.string().nullable(),
      isHot: z.boolean(),
    }),
  ),

  /** Hot-lead escalations that fired, ordered by creation. */
  escalations: z.array(
    z.strictObject({
      id: z.uuid(),
      sentAt: z.iso.datetime().nullable(),
      outcome: z.string().nullable(),
    }),
  ),

  /**
   * Every cadence on this quote, ordered by creation.
   *
   * PLURAL, deliberately: a reopened quote gets a second cadence, and the chain
   * has to show which one was running when the win landed.
   */
  cadences: z.array(
    z.strictObject({
      id: z.uuid(),
      createdByEventId: z.number().int().nullable(),
      stopReason: z.string().nullable(),
    }),
  ),

  /** The tradie's own job number, as printed on the report line. */
  generatedJobId: z.string().nullable(),
  /** 60 code points plus an ellipsis. See `truncateCodePoints` and `codePointMax`. */
  jobDescription: codePointMax(DESCRIPTION_MAX + 1).nullable(),
  /** First name only, capped in code points. See `firstNameOf`. */
  contactFirstName: codePointMax(FIRST_NAME_MAX).nullable(),

  /**
   * The constants THIS row was computed under.
   *
   * D-01 is costly to change precisely because of this field: a row computed
   * under a 30-day window and one computed under 45 are not comparable, and the
   * report's methodology footnote renders this number rather than the current
   * value of the constant. A frozen report keeps saying what it actually did.
   */
  constants: z.strictObject({
    attributionWindowDays: z.number().int(),
  }),

  /** The baseline used, and where it came from — the footnote branches on `source`. */
  baseline: z.strictObject({
    rateBp: z.number().int(),
    source: z.enum(['connect', 'default']),
    sampleSize: z.number().int().nullable(),
    /** `YYYY-MM-DD` as the `date` column returns it, or null on the default branch. */
    windowStart: z.string().nullable(),
    windowEnd: z.string().nullable(),
  }),
});

export type AttributionEvidence = z.infer<typeof attributionEvidenceSchema>;

/** A threaded inbound reply, as the evidence read selects it — never `body` or `from_address`. */
export interface EvidenceInbound {
  id: string;
  receivedAt: Date;
  label: string | null;
  isHot: boolean;
}

/** An escalation, as the evidence read selects it — never `to_address`. */
export interface EvidenceEscalation {
  id: string;
  sentAt: Date | null;
  outcome: string | null;
  createdAt: Date;
}

/** A cadence, as the evidence read selects it — never `contact_mobile` / `contact_email`. */
export interface EvidenceCadence {
  id: string;
  createdByEventId: number | null;
  stopReason: string | null;
  createdAt: Date;
}

export interface BuildEvidenceInput {
  wonEventId: number;
  ledger: readonly LedgerTouchFields[];
  inbound: readonly EvidenceInbound[];
  escalations: readonly EvidenceEscalation[];
  cadences: readonly EvidenceCadence[];
  generatedJobId: string | null;
  jobDescription: string | null;
  contactName: string | null;
  baseline: ResolvedBaseline;
  baselineWindowStart: string | null;
  baselineWindowEnd: string | null;
}

/**
 * Assemble the chain. Pure, total, and deterministic.
 *
 * DETERMINISTIC MATTERS: every collection is sorted here rather than trusted
 * from the caller's `ORDER BY`, so the same inputs produce the same jsonb —
 * which is what makes a stored row diffable against a re-derivation when
 * somebody disputes it.
 *
 * The window days come from the SAME import the decision's `windowDays` column
 * does, so the row and its own footnote cannot disagree (T-7-09).
 */
export function buildEvidence(input: BuildEvidenceInput): AttributionEvidence {
  return {
    wonEventId: input.wonEventId,
    // ── SORTED THE WAY THE ANCHORS WERE CHOSEN (07 WR-12) ─────────────────
    //
    // `qualifyingTouches` orders by `claimedAt` then `touchNumber`, and
    // `decideAttribution` takes `firstTouchClaimedAt` / `lastTouchClaimedAt`
    // from the ends of THAT order. Re-sorting here by `touchNumber` alone meant
    // a reopened quote's two cadences interleaved — cadence B's touch 1 landing
    // between cadence A's touches 1 and 2 — so a row's own `firstTouchClaimedAt`
    // need not have been the first element of its own `ledger`. On the evidence
    // chain, that is the row disagreeing with itself.
    //
    // Identical to the qualifying order, so the stored chain reads as the chase
    // actually happened. Determinism is unchanged: `Array.prototype.sort` is
    // stable and the input order is fixed by the caller's `ORDER BY`.
    ledger: [...input.ledger]
      .sort((a, b) => a.claimedAt.getTime() - b.claimedAt.getTime() || a.touchNumber - b.touchNumber)
      .map((row) => ({
        id: row.id,
        cadenceId: row.cadenceId,
        touchNumber: row.touchNumber,
        channel: row.channel,
        claimedAt: row.claimedAt.toISOString(),
        deliveryStatus: row.deliveryStatus,
      })),
    inbound: [...input.inbound]
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .map((row) => ({
        id: row.id,
        receivedAt: row.receivedAt.toISOString(),
        label: row.label,
        isHot: row.isHot,
      })),
    escalations: [...input.escalations]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => ({
        id: row.id,
        sentAt: row.sentAt === null ? null : row.sentAt.toISOString(),
        outcome: row.outcome,
      })),
    cadences: [...input.cadences]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => ({
        id: row.id,
        createdByEventId: row.createdByEventId,
        stopReason: row.stopReason,
      })),
    generatedJobId: input.generatedJobId,
    jobDescription:
      input.jobDescription === null ? null : truncateCodePoints(input.jobDescription, DESCRIPTION_MAX),
    contactFirstName: firstNameOf(input.contactName),
    constants: { attributionWindowDays: ATTRIBUTION_WINDOW_DAYS },
    baseline: {
      rateBp: input.baseline.rateBp,
      source: input.baseline.source,
      sampleSize: input.baseline.sampleSize,
      windowStart: input.baselineWindowStart,
      windowEnd: input.baselineWindowEnd,
    },
  };
}
