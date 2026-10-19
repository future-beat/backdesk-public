/**
 * The CSV path's two steps: stage an upload, then confirm a mapping (D-12).
 *
 * ── WHY THIS IS NOT INSIDE THE SERVER ACTIONS ───────────────────────────────
 *
 * The same reason `generate.ts` is not: a `'use server'` module may export only
 * async functions, and EVERY function it exports becomes a Server Action with a
 * globally-POSTable id. `confirmCsvMapping` writes `prospect_quote_lines` and
 * publishes an audit; exported from an action module it would be an
 * unauthenticated endpoint that does so for any prospect id a caller can name.
 * It lives here, framework-free, and the thin auth-first actions wrap it.
 *
 * ── THE OPERATOR SUBMITS A MAPPING, NEVER DATA ──────────────────────────────
 *
 * `confirmCsvMapping` re-reads the staged rows from `prospects.csv_staging`
 * rather than accepting them from the request. The browser's contribution to
 * this step is seven column NAMES, each of which must already appear in the
 * stored header row. There is therefore no path by which a forged submission can
 * inject a quote, a dollar value or a customer's phone number into an audit —
 * the worst it can do is mis-map columns of the operator's own upload, which is
 * the thing the confirmation screen exists for them to check.
 */
import { isInWindow, computeAuditFigures, computeBaseline, windowDate, auditWindow, type AuditLine } from './aggregate';
import {
  CANONICAL_FIELDS,
  MAX_CSV_ROWS,
  validateRows,
  type CanonicalField,
  type CsvAuditRow,
  type CsvMapping,
  type CsvRow,
} from './csv-mapping';

import { getProspectStaging, storeAuditResults, type ProspectLineInput } from '@/db/repository';

/** What sits in `prospects.csv_staging` between upload and confirmation. */
export interface CsvStaging {
  headers: string[];
  rows: CsvRow[];
}

export type ConfirmCsvMappingResult =
  | { ok: true; quotesIssued: number; linesStored: number; skipped: number }
  | { ok: false; kind: 'no_staging' }
  | { ok: false; kind: 'unknown_header'; header: string }
  | { ok: false; kind: 'missing_columns'; missing: CanonicalField[] }
  | { ok: false; kind: 'no_usable_rows'; skipped: number; reason: string }
  | {
      ok: false;
      kind: 'needs_acknowledgement';
      skipped: number;
      usable: number;
      reason: string;
    };

export interface ConfirmCsvMappingInput {
  prospectId: string;
  mapping: CsvMapping;
  /**
   * The operator has seen the skipped-row count and chosen to proceed. Ignored
   * when nothing was skipped — a clean upload never asks a second time.
   */
  acknowledgedSkips: boolean;
  /** Injectable so a fixture audit never depends on the wall clock. */
  now?: Date;
}

/**
 * Collapse per-row reasons into the one phrase the warning copy interpolates.
 *
 * Distinct reasons, most common first, capped at three: "4 rows skipped —
 * unrecognised job status "Awaiting Parts"; quote date outside the 90-day
 * window." The alternative — one line per row — is unreadable at any real row
 * count and buries the fact that matters, which is how many.
 */
function summarizeReasons(reasons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason]) => reason)
    .join('; ');
}

/**
 * Validate a confirmed mapping, aggregate, and publish the audit.
 *
 * Order matters and mirrors `generateAuditFromApiKey`: everything that can be
 * rejected is rejected before anything is written, so a failed confirmation
 * leaves the staged upload exactly as it was and the operator can re-map rather
 * than re-upload.
 */
export async function confirmCsvMapping(
  input: ConfirmCsvMappingInput,
): Promise<ConfirmCsvMappingResult> {
  const { prospectId, mapping, acknowledgedSkips, now = new Date() } = input;

  const staged = await getProspectStaging(prospectId);
  if (!staged) return { ok: false, kind: 'no_staging' };

  // Every submitted column name must be one the upload actually produced.
  // Without this, the mapping is a free-text field naming a key in a jsonb
  // document — harmless today, and exactly the shape that stops being harmless
  // when someone later stages something richer than a CSV row.
  const known = new Set(staged.headers);
  for (const field of CANONICAL_FIELDS) {
    const header = mapping[field.key];
    if (header !== null && !known.has(header)) {
      return { ok: false, kind: 'unknown_header', header };
    }
  }

  const missing = CANONICAL_FIELDS.filter((f) => f.required && mapping[f.key] === null);
  if (missing.length > 0) return { ok: false, kind: 'missing_columns', missing };

  const { valid, skipped } = validateRows(staged.rows, mapping);

  // ── The 90-day window, applied here rather than trusted from the export ────
  //
  // The API path filters to the window at fetch time; a CSV export covers
  // whatever range the operator happened to select in ServiceM8's reporting UI.
  // The report's headline claim is "Last 90 days", so the window is enforced on
  // this side — and rows outside it are COUNTED AND NAMED like any other
  // exclusion, because "we used 12 of your 40 rows" is a fact the operator must
  // see before the document is generated.
  const window = auditWindow(now);
  const reasons = skipped.map((s) => s.reason);
  const usable: CsvAuditRow[] = [];

  for (const row of valid) {
    if (row.quoteDateUtc === null) {
      reasons.push('never issued as a quote (no quote date)');
      continue;
    }
    if (!isInWindow(row.quoteDateUtc, window)) {
      reasons.push('quote date outside the 90-day window');
      continue;
    }
    usable.push(row);
  }

  const skippedCount = reasons.length;
  const summary = summarizeReasons(reasons);

  if (usable.length === 0) {
    // Not a "0 quotes" finding — that is what an in-window export with no
    // quotes produces. This is an unusable mapping, and generating zeros from
    // it would hand the operator a fabricated result.
    return { ok: false, kind: 'no_usable_rows', skipped: skippedCount, reason: summary };
  }

  if (skippedCount > 0 && !acknowledgedSkips) {
    return {
      ok: false,
      kind: 'needs_acknowledgement',
      skipped: skippedCount,
      usable: usable.length,
      reason: summary,
    };
  }

  const lines: AuditLine[] = usable.map((row) => ({
    status: row.status,
    quoteDateUtc: row.quoteDateUtc,
    valueCents: row.valueCents,
    followedUp: row.followedUp,
  }));

  const figures = computeAuditFigures(lines, now);
  const baseline = computeBaseline(lines);

  const lineInputs: ProspectLineInput[] = usable.map((row) => ({
    // A CSV export has no uuid column worth trusting (RESEARCH Pattern 7).
    sm8JobUuid: null,
    status: row.status,
    quoteDateRaw: row.quoteDateRaw,
    quoteDateUtc: row.quoteDateUtc,
    valueCents: row.valueCents,
    description: row.description,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    followedUp: row.followedUp,
    lineSource: 'csv',
  }));

  await storeAuditResults(
    prospectId,
    {
      ...figures,
      baselineWinRate: baseline.winRate,
      baselineQuotesIssued: baseline.quotesIssued,
      windowStart: windowDate(window.start),
      windowEnd: windowDate(window.end),
      // D-10: the report's addendum footnote is driven by this flag, and this
      // is the one code path that sets it. `storeAuditResults` clears
      // `csv_staging` in the same transaction — the staged copy of every
      // contact detail must not outlive the confirmation that consumed it.
      csvNoteDegraded: true,
    },
    lineInputs,
  );

  return {
    ok: true,
    quotesIssued: figures.quotesIssued,
    linesStored: lineInputs.length,
    skipped: skippedCount,
  };
}

/** The row ceiling, re-exported so the upload action reads one name. */
export { MAX_CSV_ROWS };
