/**
 * THE SHAPE OF A FROZEN REPORT, AND THE ONLY PLACE IT IS ASSERTED (D-11, RPT-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A LEAF MODULE. It imports `zod` and nothing else — no database, no        │
 * │ generator, no formatter. That is the whole reason it exists as its own    │
 * │ file rather than as a section of `generate.ts`.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THE SCHEMAS LIVE APART FROM THE GENERATOR ───────────────────────────
 *
 * The render-from-the-row mandate (UI-SPEC) says the printed page computes
 * NOTHING: every number, label and footnote value comes from the stored row.
 * `tests/monthly-report.test.ts` enforces that as a source assertion — the page
 * may not value-import `figures`, `fees`, `metrics` or `generate`. But the page
 * must still PARSE the row, and a zod schema is a value, not a type.
 *
 * So the shape lives here and the generator re-exports it. The page can assert
 * the row it renders without being able to reach the function that computed it,
 * which is a stronger guarantee than the assertion asked for: not "the page
 * does not recompute" but "the page cannot".
 *
 * ── WHY THE COLUMNS ARE UNCONSTRAINED IN POSTGRES AND STRICT HERE ───────────
 *
 * `monthly_reports.figures/lines/baseline/constants/fees` carry no CHECK
 * constraints, deliberately (07-01): they are frozen documents whose shape is
 * versioned by the generator that wrote them, and a key constraint would make
 * an old report unreadable the first time a report gains a figure. NOT NULL is
 * the whole database-level guarantee. That makes THIS the place where a row
 * that cannot describe itself fails loudly — better a page that errors than a
 * document reading `Recovered — conservative $NaN` that somebody attaches to an
 * invoice.
 *
 * ── THE OPTIONAL MISSED-CALL BLOCK (Phase 15, RPT-04 / D-03, D-10, D-11) ────
 *
 * `figures.missedCalls` is OPTIONAL and the LAST key, and no existing key moved.
 * Every row frozen before Phase 15 has no such key, so it parses to `undefined`
 * and renders exactly as it did the day it was sent (D-11, pinned by
 * `tests/report-frozen-fixture.test.ts` against a stored pre-Phase-15 row). A
 * row generated after it carries the block — and because `figures` is one of
 * the five compared documents, the first regenerate of a month after deploy is
 * version N+1 with N kept, which is D-03's intent, not a bug.
 *
 * Hour buckets are tenant-zone hours 0–23; weekdays are ISO, Monday..Sunday.
 * `medianSeconds` / `p90Seconds` are `null` when no text-back was delivered —
 * the page says "no samples", never a number (D-10). Every rate carries the
 * numerator and denominator it was divided from. `funnel.jobsWon` is a COUNT,
 * never cents: recovered value stays a quotes figure (D8).
 */
import { z } from 'zod';

import { codePointMax } from '@/core/attribution/evidence';

/** The description cap, before the ellipsis — `truncateCodePoints`' bound. */
const DESCRIPTION_MAX = 60;

/** The first-name cap. The Phase 6 escalation number, carried forward. */
const FIRST_NAME_MAX = 32;

/** A rate with the two integers it came from; `rateBp` is null at a zero denominator. */
const rateSchema = z.object({
  numerator: z.number().int(),
  denominator: z.number().int(),
  rateBp: z.number().int().nullable(),
});

/** The frozen missed-call block — see the header's Phase 15 section. */
export const reportMissedCallsSchema = z.object({
  captured: z.number().int(),
  withheld: z.number().int(),
  /** Tenant-zone hour of day, 0..23. */
  byHour: z.array(z.number().int()).length(24),
  /** ISO weekday, Monday..Sunday. */
  byIsoWeekday: z.array(z.number().int()).length(7),
  afterHoursByIsoWeekday: z.array(z.number().int()).length(7),
  afterHours: rateSchema,
  textBacks: z.object({
    sent: z.number().int(),
    delivered: z.number().int(),
    medianSeconds: z.number().int().nullable(),
    p90Seconds: z.number().int().nullable(),
  }),
  /** Replied leads over DELIVERED text-backs. */
  replyRate: rateSchema,
  funnel: z.object({
    leads: z.number().int(),
    jobsCreated: z.number().int(),
    jobsWon: z.number().int(),
    bookedByTradie: z.number().int(),
  }),
});

export type ReportMissedCallsDocument = z.infer<typeof reportMissedCallsSchema>;

export const reportFiguresSchema = z.object({
  quotesChased: z.number().int(),
  replies: z.number().int(),
  jobsWonAttributed: z.number().int(),
  jobsWonTotal: z.number().int(),
  grossCents: z.number().int(),
  conservativeCents: z.number().int(),
  feesMonthlyCents: z.number().int().nullable(),
  feesSetupCents: z.number().int(),
  multipleConservativeBp: z.number().int().nullable(),
  multipleGrossBp: z.number().int().nullable(),
  valueMissingCount: z.number().int(),
  // OPTIONAL and LAST (Phase 15, D-03/D-11): a pre-Phase-15 row parses to undefined.
  missedCalls: reportMissedCallsSchema.optional(),
});

export type ReportFiguresDocument = z.infer<typeof reportFiguresSchema>;

/**
 * ONE PER-JOB LINE, AND NOTHING A CUSTOMER COULD BE IDENTIFIED BY (U-3, T-7-20).
 *
 * Job number, a truncated description, a first name. No phone, no email, no
 * address, no message body, no reply text — the `attributionEvidenceSchema`
 * boundary carried one table forward, onto the document that leaves the
 * building. The description and the first name are the two bounded, deliberate
 * exceptions, and they are bounded HERE as well as upstream: a line is frozen
 * at generation and read back years later, so the caps are asserted on the way
 * in AND on the way out.
 */
export const reportLineSchema = z.object({
  attributionId: z.uuid(),
  quoteId: z.uuid(),
  generatedJobId: z.string().nullable(),
  // Code points, not UTF-16 units — the same unit the upstream truncator and
  // `attributionEvidenceSchema` count in. A cap asserted in a different unit on
  // the way out than on the way in is a frozen document that cannot be read
  // back (see `codePointMax`).
  jobDescription: codePointMax(DESCRIPTION_MAX + 1).nullable(),
  contactFirstName: codePointMax(FIRST_NAME_MAX).nullable(),
  wonDetectedAt: z.iso.datetime(),
  touchCount: z.number().int(),
  firstTouchAt: z.iso.datetime(),
  lastTouchAt: z.iso.datetime(),
  replyCount: z.number().int(),
  replyLabels: z.array(z.string()),
  grossCents: z.number().int(),
  conservativeCents: z.number().int(),
  valueSource: z.enum(['mirror', 'missing']),
});

export type ReportLineDocument = z.infer<typeof reportLineSchema>;

/**
 * The baseline the conservative figure was struck against — footnote 3's input.
 *
 * `prospectRateBp` IS A FOOTNOTE AND NEVER A SOURCE (D-06). Where a converted
 * prospect's audit rate differs from the rate measured at connect, the report
 * says so for continuity with what they were sold on; nothing is computed from
 * it.
 */
export const reportBaselineSchema = z.object({
  rateBp: z.number().int(),
  source: z.enum(['connect', 'default']),
  sampleSize: z.number().int().nullable(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  prospectRateBp: z.number().int().nullable(),
});

export type ReportBaselineDocument = z.infer<typeof reportBaselineSchema>;

/**
 * Every constant the arithmetic used.
 *
 * D-01 is costly to change precisely because of this: footnote 1 renders
 * `constants.attributionWindowDays` FROM THE ROW, not from today's value of the
 * import, so a frozen report keeps saying what it actually did. The page
 * compares the two and warns on screen; it never restates the figure.
 */
export const reportConstantsSchema = z.object({
  attributionWindowDays: z.number().int(),
  defaultBaselineWinRate: z.number(),
  baselineMinQuotes: z.number().int(),
});

export type ReportConstantsDocument = z.infer<typeof reportConstantsSchema>;

/**
 * The fees in force, plus the rows they were derived from.
 *
 * The rows are carried so "why is the retainer $385.16 and not $597" is
 * answerable from the row alone six months later — a mid-month price change,
 * pro-rated by local day, is exactly the figure a client queries.
 *
 * `createdAt` is an ISO STRING here and a `Date` on `FeeRow`: this shape has
 * round-tripped through `jsonb`, where a Date is serialised and never revives.
 * Typing it as a Date would compile and then hand the page a string.
 */
export const reportFeesSchema = z.object({
  monthlyCents: z.number().int().nullable(),
  setupCents: z.number().int(),
  daysCharged: z.number().int(),
  daysInPeriod: z.number().int(),
  rows: z.array(
    z.object({
      kind: z.enum(['monthly', 'setup']),
      amountCents: z.number().int(),
      effectiveFrom: z.string(),
      createdAt: z.iso.datetime(),
      note: z.string().nullable(),
    }),
  ),
});

export type ReportFeesDocument = z.infer<typeof reportFeesSchema>;

/**
 * A frozen report, parsed — the argument every renderer and every copy function
 * takes.
 *
 * Declared over the five parsed documents rather than as the drizzle row type,
 * because the row's jsonb columns are `Record<string, unknown>` / `unknown[]`
 * and nothing downstream of the read edge should ever have to cast.
 */
export interface ReportDocument {
  id: string;
  /** `YYYY-MM-DD`, local to `timezone`. */
  periodStart: string;
  /** `YYYY-MM-DD`, EXCLUSIVE — the next month's first local day. */
  periodEnd: string;
  timezone: string;
  version: number;
  generatedAt: Date;
  figures: ReportFiguresDocument;
  lines: ReportLineDocument[];
  baseline: ReportBaselineDocument;
  constants: ReportConstantsDocument;
  fees: ReportFeesDocument;
}

/** The stored row, as far as this module needs to know it. */
export interface StoredReportRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  version: number;
  generatedAt: Date;
  figures: unknown;
  lines: unknown;
  baseline: unknown;
  constants: unknown;
  fees: unknown;
}

/**
 * Parse one stored row into the document the page renders.
 *
 * THROWS on a row that does not match, deliberately. The alternative — falling
 * back to zeros — produces a plausible-looking report with wrong numbers on it,
 * and the whole point of the frozen row is that what it says is what was sent.
 * A page that fails is recoverable; a document that lies is not.
 */
export function parseReportDocument(row: StoredReportRow): ReportDocument {
  return {
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    timezone: row.timezone,
    version: row.version,
    generatedAt: row.generatedAt,
    figures: reportFiguresSchema.parse(row.figures),
    lines: z.array(reportLineSchema).parse(row.lines),
    baseline: reportBaselineSchema.parse(row.baseline),
    constants: reportConstantsSchema.parse(row.constants),
    fees: reportFeesSchema.parse(row.fees),
  };
}
