/**
 * Is this attachment a Job List export? (Phase 9, LAND-02, D-10, threat T-9-04)
 *
 * PURE and framework-free, like every other module in this directory: it takes
 * a DESCRIPTION of a file — name, MIME, size, and its first few kilobytes as
 * text — and answers `ok` or one of two refusals. It never touches a `File`, a
 * request or the filesystem, so the one acceptance decision an unauthenticated
 * stranger can reach is exercised by a unit test rather than only through a
 * server action.
 *
 * ── THE CAP IS 4 MiB, AND D-10 SAID 5 MB ────────────────────────────────────
 *
 * A deliberate, recorded deviation (09-03 checkpoint, option `cap-4mib`). Vercel
 * Functions reject a request body over 4.5 MB with `FUNCTION_PAYLOAD_TOO_LARGE`
 * before the action runs, and Server Actions default to a 1 MB body
 * [09-RESEARCH §5, Pitfall 1 — vercel.com/docs/functions/limitations]. A cap of
 * 5 MB would mean accepting, in the copy on the first screen a prospect ever
 * sees, files that die against a platform error page nobody here wrote. So the
 * number is one number in four places:
 *
 *   this constant · `bodySizeLimit: '4400kb'` (next.config.ts, plus multipart
 *   overhead) · `MAX_CSV_BYTES` (the console intake, 09-06's pre-fill) ·
 *   `storage.buckets.file_size_limit = 4194304` (migration 0035)
 *
 * A ServiceM8 Job List export for a 1–10 staff business over 90 days is far
 * under 1 MB, so the difference is a promise problem, never a real one.
 *
 * ── WHY THE MIME LIST IS SO PERMISSIVE ──────────────────────────────────────
 *
 * The browser guesses the MIME from the OS file association, and on a machine
 * with Excel installed a .csv is `application/vnd.ms-excel`. An Android picker
 * and a drag-and-drop send `application/octet-stream` or nothing at all.
 * Refusing those refuses the export we asked for, from the tradie most likely
 * to have one to hand. The REAL gate is the pair below it: the `.csv`
 * extension, and a first line that actually parses as a row of at least two
 * columns. A renamed spreadsheet fails the parse; a text file fails it too.
 *
 * ── CONTENT IS DATA, NOT CODE (T-9-04) ──────────────────────────────────────
 *
 * Nothing here evaluates a cell. The file's bytes are stored and later shown to
 * one operator through React (which escapes) and re-parsed by papaparse; no CSV
 * is ever re-exported from this system, so the formula-injection path that
 * would need an escape has no exit. This module's only interest in the content
 * is whether the first line has commas in it.
 *
 * The two refusal SENTENCES live in `src/app/(marketing)/copy.ts`, not here —
 * this module says which refusal, the copy module says it in words.
 */
import Papa from 'papaparse';

/**
 * The largest attachment the public form accepts, in bytes. See the header for
 * why this is 4 MiB and not D-10's 5 MB, and for the three other places that
 * must agree with it.
 */
export const AUDIT_CSV_MAX_BYTES = 4 * 1024 * 1024;

/** What browsers actually send for a .csv. `''` is "the picker had no idea". */
export const AUDIT_CSV_MIME: readonly string[] = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
  '',
];

/** The longest stored filename, suffix included. Long enough for any export. */
const FILENAME_MAX = 80;

/** Used when a prospect's filename sanitises away to nothing. */
const FILENAME_FALLBACK = 'export';

const CSV_SUFFIX = '.csv';

/** What the action knows about the attachment without reading all of it. */
export interface CsvCandidate {
  /** The prospect's filename, as the browser reported it. */
  name: string;
  /** The browser's MIME guess. May be an empty string. */
  type: string;
  /** `File.size`, read BEFORE any byte is loaded into memory. */
  size: number;
  /** The first few KB decoded as text — enough for one line. */
  firstBytes: string;
}

export type CsvSniffResult =
  | { ok: true; columns: number }
  /** `type` covers "not a CSV" AND "empty"; `size` covers only the cap. */
  | { ok: false; kind: 'type' | 'size' };

/** Does the first line parse as a CSV row of two or more columns? */
function columnsInFirstLine(firstBytes: string): number {
  // `preview: 1` stops the parse after one row, so a hostile 4 MB single-line
  // file cannot make this expensive; the action only hands us the first 4 KB
  // anyway. No `header: true` — an unheaded first row is still a row, and all
  // this asks is whether the shape is tabular.
  const parsed = Papa.parse<string[]>(firstBytes, { preview: 1 });
  const first = parsed.data[0];
  return Array.isArray(first) ? first.length : 0;
}

/**
 * Accept or refuse, in the order the action can afford: name and MIME are free,
 * the size is free, and only then is anything parsed.
 */
export function sniffCsv(candidate: CsvCandidate): CsvSniffResult {
  const name = candidate.name.trim();

  if (!name.toLowerCase().endsWith(CSV_SUFFIX)) return { ok: false, kind: 'type' };
  if (!AUDIT_CSV_MIME.includes(candidate.type)) return { ok: false, kind: 'type' };

  // BEFORE the parse: refusing an oversized file must not require reading it.
  if (candidate.size > AUDIT_CSV_MAX_BYTES) return { ok: false, kind: 'size' };

  const columns = columnsInFirstLine(candidate.firstBytes);
  // An empty file lands here with 0 columns and is refused as a TYPE problem,
  // which is the truthful answer: an empty .csv is not a job list, and the size
  // sentence would send the prospect hunting for a cap they are nowhere near.
  if (columns < 2) return { ok: false, kind: 'type' };

  return { ok: true, columns };
}

/**
 * The prospect's filename, made safe to be a storage object key segment and a
 * `Content-Disposition: attachment; filename="…"` value (09-06's download).
 *
 * The character class is an ALLOWLIST, which is what makes this a boundary
 * rather than a filter: `/`, `\`, `..` segments, quotes, newlines and control
 * characters all become `_` because they are simply not in `[A-Za-z0-9._-]`.
 * Nothing has to be anticipated for that to hold.
 */
export function sanitiseCsvFilename(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]/g, '_');

  // Strip the suffix before capping, so the cap never eats the extension.
  const stem = cleaned.toLowerCase().endsWith(CSV_SUFFIX)
    ? cleaned.slice(0, -CSV_SUFFIX.length)
    : cleaned;

  const safeStem = stem === '' ? FILENAME_FALLBACK : stem;

  return `${safeStem.slice(0, FILENAME_MAX - CSV_SUFFIX.length)}${CSV_SUFFIX}`;
}
