/**
 * The CSV fallback's column mapping and row validation (D-12, RESEARCH Pattern 7).
 *
 * FRAMEWORK-FREE, like the rest of `src/core/audit`. No React, no Next, no
 * database, no clock — everything here is a pure function of a header row, a
 * mapping, and some strings, which is what lets the whole thing be calibrated
 * against a real export in `tests/csv-mapping.test.ts`.
 *
 * ── WHY A MAPPING STEP EXISTS AT ALL ────────────────────────────────────────
 *
 * ServiceM8's Job List CSV comes from the Advanced Reporting Pack add-on and its
 * column layout is not publicly documented (RESEARCH A5). Any hard-coded column
 * index or name is a guess about a format the vendor may change without telling
 * anybody, and the failure would be silent: a shifted column produces an audit
 * full of plausible, wrong numbers rather than an error. So the layout is
 * INFERRED, SHOWN TO THE OPERATOR, AND CONFIRMED. This is the one interaction in
 * the product where an inference is put in front of a human before it is acted
 * on, and that is deliberate — the output is a document handed to a stranger as
 * evidence about their own business.
 *
 * ── THE HEURISTIC MATCHES EXACTLY, AND THAT IS THE POINT ────────────────────
 *
 * Matching is normalized-EQUALITY against a curated synonym list, never
 * substring containment. The real export carries eight date-shaped columns
 * (`Date`, `Invoice Date`, `Quote Date`, `Work Order Date`, `Unsuccessful Date`,
 * `Payment Received Date`, `Invoice Sent Stamp`, `Completion Date`) and two
 * money-shaped ones (`Total Invoice Amount`, `Payment Amount`). A `contains`
 * rule would bind `quote_date` to whichever date column happened to come first,
 * silently ageing every quote in the audit and moving the leakage figure.
 *
 * The cost of exact-only matching is that an unrecognised header leaves a field
 * unmapped — which surfaces as a dropdown the operator fills in, in a step they
 * are already looking at. An unmapped field costs one click. A wrongly-mapped
 * field costs the meeting.
 */
import { SM8_TIMESTAMP_ZONE, parseMoneyToCents, sm8ToUtc } from '@/core/servicem8/normalize';

import { isFollowedUp } from './followup';

/**
 * Reject before parsing: an upload larger than this is not a job list.
 *
 * 4 MiB since Phase 9 (09-03), raised from 2 MiB and NOT an independent choice:
 * it must equal `AUDIT_CSV_MAX_BYTES`, the cap the public audit form promises a
 * prospect. If this were the smaller of the two, 09-06's pre-fill would refuse a
 * file the public form had already accepted and stored — an operator looking at
 * a request whose attachment cannot be used. The row cap below is untouched;
 * papaparse's `preview` still bounds the parse itself.
 */
export const MAX_CSV_BYTES = 4 * 1024 * 1024;

/**
 * The row ceiling (T-2-06). Enforced with papaparse's `preview`, so the parse
 * itself stops here rather than running to the end of an oversized file and
 * then being rejected — the check has to bound the work, not just the result.
 */
export const MAX_CSV_ROWS = 5000;

export type CanonicalFieldKey =
  | 'status'
  | 'quote_date'
  | 'value'
  | 'description'
  | 'contact_name'
  | 'contact_phone'
  | 'contact_email'
  // The status-change stamps (WR-05). Optional, and the reason they exist is in
  // `STATUS_DATE_FIELDS` below.
  | 'work_order_date'
  | 'unsuccessful_date'
  | 'completion_date';

export interface CanonicalField {
  key: CanonicalFieldKey;
  /**
   * Operator-facing prose, NOT the key. It is interpolated straight into the
   * unmappable-column error ("Couldn't find a column for {field name}…"), and
   * an error that says `quote_date` tells the operator about our schema when
   * they need to be told about their spreadsheet.
   */
  label: string;
  required: boolean;
  /**
   * Normalized header forms that bind to this field, IN PRIORITY ORDER — the
   * first one present in the header row wins.
   *
   * Order is load-bearing in two places. `value` lists ServiceM8's own
   * `totalinvoiceamount` ahead of the generic `total`/`amount` forms so the
   * real export never falls through to `Payment Amount` (which is `0.0000` on
   * every unpaid job — an audit reporting a book worth nothing). `contact_phone`
   * lists mobile forms ahead of landline ones because the mobile is both the
   * SMS-reachable number and the one actually populated in the export.
   */
  synonyms: readonly string[];
}

export const CANONICAL_FIELDS: readonly CanonicalField[] = [
  {
    key: 'status',
    label: 'job status',
    required: true,
    synonyms: ['jobstatus', 'status', 'quotestatus', 'state'],
  },
  {
    key: 'quote_date',
    label: 'quote date',
    required: true,
    // Deliberately WITHOUT bare 'date'. See the file header.
    synonyms: ['quotedate', 'datequoted', 'quotesent', 'quotesentdate', 'dateofquote'],
  },
  {
    key: 'value',
    label: 'quote value',
    required: true,
    synonyms: [
      'totalinvoiceamount',
      'quotevalue',
      'quotedvalue',
      'quoteamount',
      'jobvalue',
      'totalamount',
      'totalvalue',
      'total',
      'amount',
      'value',
    ],
  },
  {
    key: 'description',
    label: 'description',
    required: false,
    synonyms: [
      'descriptionofwork',
      'jobdescription',
      'workdescription',
      'description',
      'jobwork',
      'work',
    ],
  },
  {
    key: 'contact_name',
    label: 'contact name',
    required: false,
    synonyms: [
      'contactname',
      'customername',
      'clientname',
      'company',
      'companyname',
      'customer',
      'client',
    ],
  },
  {
    key: 'contact_phone',
    label: 'contact phone',
    required: false,
    synonyms: [
      'jobcontactmobilenumber',
      'contactmobilenumber',
      'contactmobile',
      'mobilenumber',
      'mobile',
      'contactphone',
      'jobtelephonenumber',
      'telephonenumber',
      'phonenumber',
      'telephone',
      'phone',
    ],
  },
  {
    key: 'contact_email',
    label: 'contact email',
    required: false,
    synonyms: ['jobemailaddress', 'contactemail', 'emailaddress', 'email'],
  },
  // ── The status-change stamps (WR-05) ──────────────────────────────────────
  //
  // Optional, because an export that lacks them must still produce an audit —
  // see the fallback in `validateRows`. When present they let the CSV path apply
  // the SAME 72-hour grace rule the API path applies, through the same
  // `isFollowedUp` function, instead of a timing-free `status !== 'Quote'`.
  //
  // `Invoice Sent Stamp` is deliberately NOT among these. It is an invoicing
  // event rather than a status change on the quote, the API path does not treat
  // it as a follow-up signal either, and adding it here would recreate exactly
  // the divergence these three fields exist to remove.
  {
    key: 'work_order_date',
    label: 'work order date',
    required: false,
    synonyms: ['workorderdate', 'dateworkordered', 'wondate', 'acceptedate', 'accepteddate'],
  },
  {
    key: 'unsuccessful_date',
    label: 'unsuccessful date',
    required: false,
    synonyms: ['unsuccessfuldate', 'dateunsuccessful', 'lostdate', 'datelost', 'declineddate'],
  },
  {
    key: 'completion_date',
    label: 'completion date',
    required: false,
    synonyms: ['completiondate', 'datecompleted', 'completeddate', 'jobcompletiondate'],
  },
];

/**
 * The three fields that carry a status-change INSTANT (WR-05).
 *
 * Named as a set rather than spelled out at the one call site, because "which
 * columns are follow-up evidence" is a claim about the audit's methodology and
 * belongs next to the fields themselves — a fourth one added to
 * `CANONICAL_FIELDS` without being added here would silently not count.
 */
export const STATUS_DATE_FIELDS = [
  'work_order_date',
  'unsuccessful_date',
  'completion_date',
] as const satisfies readonly CanonicalFieldKey[];

/** Which header (verbatim, as it appears in the file) feeds each field. */
export type CsvMapping = Record<CanonicalFieldKey, string | null>;

/**
 * An all-unmapped mapping, derived from `CANONICAL_FIELDS`.
 *
 * Exists so no caller has to write the key list out by hand — a literal drifts
 * the moment a field is added, and the drift is invisible in the one place it
 * matters (a field the operator is never offered a dropdown for).
 */
export function blankMapping(): CsvMapping {
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [field.key, null])) as CsvMapping;
}

/** One parsed CSV record, keyed by its verbatim header. */
export type CsvRow = Record<string, string | undefined>;

/**
 * A validated CSV row in the shape both `AuditLine` and `ProspectLineInput`
 * consume — the whole reason the two input paths produce identical audits.
 */
export interface CsvAuditRow {
  status: string;
  quoteDateRaw: string | null;
  quoteDateUtc: Date | null;
  valueCents: number | null;
  description: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  followedUp: boolean;
}

export interface SkippedRow {
  /** Index into the array handed to `validateRows` — 0-based. */
  index: number;
  /** Operator-facing prose; interpolated into the proceed-with-warning copy. */
  reason: string;
}

export interface ValidationResult {
  valid: CsvAuditRow[];
  skipped: SkippedRow[];
}

/**
 * Case, whitespace and punctuation all removed: `Job Status`, `job_status` and
 * ` JOB-STATUS ` are the same column to a human and must be the same column
 * here. Nothing else is stripped — the synonym lists carry whole words.
 */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Infer which header feeds each canonical field.
 *
 * Fields are resolved in `CANONICAL_FIELDS` order and a header, once claimed,
 * is out of the running for later fields — otherwise `Company` could feed both
 * `contact_name` and something else, and a single column would be silently
 * counted twice in the preview the operator is confirming.
 *
 * A field with no exact synonym match stays `null`. That is a RESULT, not a
 * failure: `missingRequiredFields` turns it into the named-column error and the
 * operator picks the column from a dropdown.
 */
export function inferMapping(headers: readonly string[]): CsvMapping {
  // DERIVED FROM `CANONICAL_FIELDS`, not spelled out. A hand-written literal
  // here silently drifts every time a field is added — the compiler catches a
  // missing key, but only until someone adds it in one of the two places.
  const mapping = blankMapping();

  const claimed = new Set<string>();

  // Built once: the normalized form of every header, paired with the verbatim
  // string, because the mapping must round-trip to the file's own spelling.
  const normalized = headers
    .filter((header) => header.trim() !== '')
    .map((header) => ({ header, key: normalizeHeader(header) }));

  for (const field of CANONICAL_FIELDS) {
    for (const synonym of field.synonyms) {
      const hit = normalized.find(
        (candidate) => candidate.key === synonym && !claimed.has(candidate.header),
      );
      if (hit) {
        mapping[field.key] = hit.header;
        claimed.add(hit.header);
        break;
      }
    }
  }

  return mapping;
}

/**
 * A stable identity for a mapping.
 *
 * Field order is fixed by `CANONICAL_FIELDS`, so the same selections always
 * produce the same string — which is what lets the confirmation screen tell
 * whether a proceed-with-warning acknowledgement still belongs to the mapping
 * currently in the selects. Lives here rather than in the action module because
 * both sides of that comparison need it, and every export from a `'use server'`
 * file is a globally-POSTable endpoint.
 */
export function mappingKey(mapping: CsvMapping): string {
  return CANONICAL_FIELDS.map((field) => `${field.key}=${mapping[field.key] ?? ''}`).join('|');
}

/** The required fields with no column behind them — empty means good to go. */
export function missingRequiredFields(mapping: CsvMapping): CanonicalField[] {
  return CANONICAL_FIELDS.filter((field) => field.required && mapping[field.key] === null);
}

/**
 * The export's status strings → the four canonical ServiceM8 statuses.
 *
 * Only the four are real (RESEARCH: statuses cannot be customized), but the
 * export's exact spelling is not documented and a re-export from a different
 * report may differ in case or wording. Synonyms are accepted; ANYTHING
 * UNRECOGNISED IS SKIPPED WITH A REASON rather than defaulted.
 *
 * The reason for that is the baseline (AUD-02). A status silently defaulted to
 * `Quote` is a job counted as neither won nor lost, which deflates the win rate
 * handed to a prospect in a sales meeting with nothing going red — the same
 * failure the database CHECK constraints defend against from the other side.
 */
const STATUS_VOCABULARY: ReadonlyMap<string, string> = new Map([
  ['quote', 'Quote'],
  ['quoted', 'Quote'],
  ['quotesent', 'Quote'],
  ['pending', 'Quote'],
  ['workorder', 'Work Order'],
  ['won', 'Work Order'],
  ['accepted', 'Work Order'],
  ['approved', 'Work Order'],
  ['completed', 'Completed'],
  ['complete', 'Completed'],
  ['invoiced', 'Completed'],
  ['unsuccessful', 'Unsuccessful'],
  ['lost', 'Unsuccessful'],
  ['declined', 'Unsuccessful'],
  ['rejected', 'Unsuccessful'],
  ['cancelled', 'Unsuccessful'],
  ['canceled', 'Unsuccessful'],
]);

function canonicalStatus(raw: string): string | null {
  return STATUS_VOCABULARY.get(normalizeHeader(raw)) ?? null;
}

/** A mapped cell, trimmed, with empty read as absent rather than as `''`. */
function cell(row: CsvRow, header: string | null): string | null {
  if (header === null) return null;
  const raw = row[header];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Validate and normalize every row under a confirmed mapping.
 *
 * ── WHAT IS A SKIP AND WHAT IS A NULL ───────────────────────────────────────
 *
 * A SKIP is a row we cannot honestly say anything about: an unrecognised
 * status, a date string that is not a date, a value that is negative or is not
 * a number. Those rows are counted and named, and the operator confirms
 * proceeding without them — never dropped silently, because "12 quotes" and
 * "12 of your 40 quotes" are different claims about somebody's business.
 *
 * A NULL is a legitimately absent value. A blank money cell is a job with no
 * amount recorded, and a ServiceM8 zero-date (`0000-00-00 00:00:00`) is a job
 * that was never issued as a quote at all — both are facts about the export,
 * not defects in it, and both are handled downstream exactly as the API path
 * handles them (`wasQuoted` excludes the second from every figure).
 */
export function validateRows(rows: readonly CsvRow[], mapping: CsvMapping): ValidationResult {
  const valid: CsvAuditRow[] = [];
  const skipped: SkippedRow[] = [];

  rows.forEach((row, index) => {
    const statusRaw = cell(row, mapping.status);
    if (statusRaw === null) {
      skipped.push({ index, reason: 'no job status' });
      return;
    }

    const status = canonicalStatus(statusRaw);
    if (status === null) {
      skipped.push({ index, reason: `unrecognised job status "${statusRaw}"` });
      return;
    }

    const quoteDateRaw = cell(row, mapping.quote_date);
    // `sm8ToUtc` returns null for BOTH a zero-date and a garbage string, so the
    // two are told apart here rather than downstream: only a non-zero string
    // that fails to parse is a defect.
    const quoteDateUtc = sm8ToUtc(quoteDateRaw, SM8_TIMESTAMP_ZONE);
    if (quoteDateRaw !== null && quoteDateUtc === null && !quoteDateRaw.startsWith('0000-00-00')) {
      skipped.push({ index, reason: `unreadable quote date "${quoteDateRaw}"` });
      return;
    }

    const valueRaw = cell(row, mapping.value);
    let valueCents: number | null = null;
    if (valueRaw !== null) {
      valueCents = parseMoneyToCents(valueRaw);
      if (valueCents === null) {
        skipped.push({ index, reason: `unreadable quote value "${valueRaw}"` });
        return;
      }
      if (valueCents < 0) {
        skipped.push({ index, reason: `negative quote value "${valueRaw}"` });
        return;
      }
    }

    // The status-change instants this row actually carries (WR-05). An
    // unmapped column and a blank cell both yield null and drop out here, so
    // `statusSignals.length` answers "is there any timing evidence at all?" —
    // which is the question the follow-up rule below branches on.
    const statusSignals = STATUS_DATE_FIELDS.map((field) =>
      sm8ToUtc(cell(row, mapping[field]), SM8_TIMESTAMP_ZONE),
    ).filter((at): at is Date => at !== null);

    valid.push({
      status,
      quoteDateRaw,
      quoteDateUtc,
      valueCents,
      description: cell(row, mapping.description),
      contactName: cell(row, mapping.contact_name),
      contactPhone: cell(row, mapping.contact_phone),
      contactEmail: cell(row, mapping.contact_email),
      /**
       * ── THE CSV DEGRADATION (D-10, csv_note_degraded) ─────────────────────
       *
       * The API path measures follow-up from notes, job activities and the
       * quote-sent stamp. A CSV export carries none of those, so the evidence
       * available is weaker: only that the job MOVED. The report says so,
       * verbatim — "'never followed up' here means no status change after the
       * quote".
       *
       * ── BUT THE TIMING RULE IS THE SAME RULE (WR-05) ──────────────────────
       *
       * An earlier revision computed this as `status !== 'Quote'`, with no
       * timing test at all, while the API path required a signal at or after
       * quote + 72h. Those disagree on ordinary cases: a quote won two hours
       * after it was issued read as CHASED here and as a LEAK through the API,
       * and so did a quote whose status changed on day one and never again.
       *
       * That divergence is the one `fetch-history.ts` argues hardest against —
       * the audit is a promise, the client's monthly report is the delivery
       * against it, and a prospect who converts from a CSV audit then gets an
       * API-derived baseline at connect. The disclosed degradation covered the
       * difference in EVIDENCE honestly; it said nothing about a different
       * RULE, which nobody had been told about.
       *
       * So the timing rule now comes from `isFollowedUp` — one function, one
       * grace deadline, one inclusive boundary — with the signals being whichever
       * status-change stamps the operator mapped.
       *
       * ── AND WHEN THERE ARE NO STAMPS, THE OLD ANSWER STANDS ───────────────
       *
       * `STATUS_DATE_FIELDS` are optional: an export without them (or with them
       * blank on this row) yields no signals, and `isFollowedUp` would then
       * return false for every row — turning a whole book into "never followed
       * up", which is the wrongly-claimed-leak error that discredits the
       * document. With no timing evidence there is no timing test to apply, so
       * the fallback is the movement test, unchanged.
       */
      followedUp:
        statusSignals.length > 0
          ? isFollowedUp(quoteDateUtc, statusSignals)
          : status !== 'Quote',
    });
  });

  return { valid, skipped };
}
