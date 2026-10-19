/**
 * `decideAttribution` — the whole attribution rule as ONE pure function.
 *
 * Rows in, decision out. No database handle, no clock, no configuration
 * lookup: the consumer (07-03) does the IO, hands the rows here, and writes
 * what comes back. That split is the reason this rule can be tested
 * exhaustively on bare `npm test` — and the reason a client asking "why is this
 * job on my invoice" gets an answer from a function somebody can read, rather
 * than from a query plan.
 *
 * ── THE SHAPE IS DECLARED LOCALLY, ON PURPOSE ───────────────────────────────
 *
 * `AttributionRowValues` is a plain interface rather than the Drizzle insert
 * type: the consumer maps it onto the table. That keeps this module free of the
 * database layer (so the report generator and any future re-derivation can call
 * it), and it lets the rule and the schema be planned in the same wave without
 * one importing the other.
 *
 * ── THE TWO HONEST ANSWERS ──────────────────────────────────────────────────
 *
 * `'unqualified'` is a RESULT, not a failure. Most `won` events are jobs the
 * tradie closed themselves; claiming those is how a recovered-revenue report
 * becomes a document the client disproves from their own books.
 *
 * `'attributed'` with `valueSource: 'missing'` is the other honest answer: the
 * quote mirror can be gone by the time the win arrives (a deleted job, a
 * `mirror_missing` cadence stop). The touches happened and are evidence; the
 * DOLLAR figure is unknown. It attributes with `grossCents: 0` and flags the
 * gap so the report can show it as a line the operator must price by hand —
 * rather than holding the row (losing the evidence) or inventing a number.
 */
import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';
import type { AttributionValueSource } from '@/db/schema';

import { resolveBaseline } from './baseline';
import {
  attributionEvidenceSchema,
  buildEvidence,
  type AttributionEvidence,
  type EvidenceCadence,
  type EvidenceEscalation,
  type EvidenceInbound,
} from './evidence';
import { conservativeCents, grossCentsFromNumeric } from './money';
import { qualifyingTouches, type LedgerTouchFields } from './qualify';

/**
 * Where the dollar figure came from.
 *
 *  mirror  — `quotes.total_invoice_amount`, snapshotted and frozen (D-03).
 *  missing — no quote row, or a total that would not parse. See the header.
 *
 * RE-EXPORTED FROM THE SCHEMA MODULE, NOT RE-DECLARED (07 WR-11). This union
 * was written out a second time here with identical members, and a closed
 * vocabulary spelled in two places is exactly what the CHECK-constraint
 * discipline exists to prevent: the constraint in migration 0033 is derived
 * from `ATTRIBUTION_VALUE_SOURCES`, so a third member added there and not here
 * would compile while the database refused the write. One declaration, and the
 * column it describes is its source. (`decide.ts` already imports
 * `ATTRIBUTION_WINDOW_DAYS` across a module boundary for the same reason.)
 */
export type { AttributionValueSource } from '@/db/schema';

/** Everything the attribution row holds, as values rather than as columns. */
export interface AttributionRowValues {
  quoteId: string;
  sm8JobUuid: string | null;
  wonEventId: number;
  wonDetectedAt: Date;
  /** The FIRST qualifying touch — the start of the chase this win is credited to. */
  firstTouchClaimedAt: Date;
  /** The LAST qualifying touch — what D-01's window is anchored on. */
  lastTouchClaimedAt: Date;
  qualifyingTouchCount: number;
  grossCents: number;
  conservativeCents: number;
  valueSource: AttributionValueSource;
  baselineRateBp: number;
  baselineSource: 'connect' | 'default';
  baselineSample: number | null;
  /** Recorded per row, so a frozen report keeps saying what it actually did (D-01). */
  windowDays: number;
  evidence: AttributionEvidence;
}

export type AttributionDecision =
  | { kind: 'attributed'; row: AttributionRowValues }
  | { kind: 'unqualified' };

/** The quote mirror as the decision reads it — nullable in full (Pitfall 8). */
export interface DecisionQuote {
  sm8JobUuid: string | null;
  generatedJobId: string | null;
  jobDescription: string | null;
  /** `numeric(12,2)` as postgres.js returns it: a STRING. */
  totalInvoiceAmount: string | null;
}

/** The connect-time baseline columns. A null connection resolves to the default. */
export interface DecisionConnection {
  baselineWinRate: string | null;
  baselineQuotesIssued: number | null;
  baselineWindowStart: string | null;
  baselineWindowEnd: string | null;
}

export interface DecideAttributionInput {
  event: { id: number; quoteId: string; detectedAt: Date };
  ledger: readonly LedgerTouchFields[];
  quote: DecisionQuote | null;
  connection: DecisionConnection | null;
  inbound: readonly EvidenceInbound[];
  escalations: readonly EvidenceEscalation[];
  cadences: readonly EvidenceCadence[];
  contactName: string | null;
}

export function decideAttribution(input: DecideAttributionInput): AttributionDecision {
  // D-01 + D-02, in one call. Everything below assumes at least one touch.
  const touches = qualifyingTouches(input.ledger, input.event.detectedAt);
  if (touches.length === 0) return { kind: 'unqualified' };

  const first = touches[0]!;
  const last = touches[touches.length - 1]!;

  // A missing connection row is the same case as a missing baseline: it
  // resolves to the deliberately HIGH default, never to zero.
  const baseline = resolveBaseline({
    winRate: input.connection?.baselineWinRate ?? null,
    quotesIssued: input.connection?.baselineQuotesIssued ?? null,
  });

  // `null` covers BOTH "no quote row" and "a total that would not parse". The
  // second is as much a missing figure as the first, and treating an
  // unparseable string as 0 would bill a real job at zero without saying so.
  const parsedGross = input.quote === null ? null : grossCentsFromNumeric(input.quote.totalInvoiceAmount);
  const valueSource: AttributionValueSource = parsedGross === null ? 'missing' : 'mirror';
  const grossCents = parsedGross ?? 0;

  const evidence = buildEvidence({
    wonEventId: input.event.id,
    ledger: touches,
    inbound: input.inbound,
    escalations: input.escalations,
    cadences: input.cadences,
    generatedJobId: input.quote?.generatedJobId ?? null,
    jobDescription: input.quote?.jobDescription ?? null,
    contactName: input.contactName,
    baseline,
    baselineWindowStart: input.connection?.baselineWindowStart ?? null,
    baselineWindowEnd: input.connection?.baselineWindowEnd ?? null,
  });

  return {
    kind: 'attributed',
    row: {
      quoteId: input.event.quoteId,
      sm8JobUuid: input.quote?.sm8JobUuid ?? null,
      wonEventId: input.event.id,
      wonDetectedAt: input.event.detectedAt,
      firstTouchClaimedAt: first.claimedAt,
      lastTouchClaimedAt: last.claimedAt,
      qualifyingTouchCount: touches.length,
      grossCents,
      conservativeCents: conservativeCents(grossCents, baseline.rateBp),
      valueSource,
      baselineRateBp: baseline.rateBp,
      baselineSource: baseline.source,
      baselineSample: baseline.sampleSize,
      // The SAME import the evidence chain's `constants.attributionWindowDays`
      // uses — the column and the footnote cannot drift apart (T-7-09).
      windowDays: ATTRIBUTION_WINDOW_DAYS,
      // THROWS on failure, deliberately. A row whose evidence chain does not
      // validate cannot describe itself, and an attribution that cannot
      // describe itself must not reach an invoice. The consumer holds its
      // cursor and the operator sees it.
      evidence: attributionEvidenceSchema.parse(evidence),
    },
  };
}
