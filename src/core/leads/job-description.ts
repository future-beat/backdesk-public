/**
 * The ServiceM8 job description for a lead (Phase 14, D-01, D-02). PURE, and
 * CLIENT-SAFE: the confirm sheet (a `'use client'` component) composes its
 * preview through `composeJobDescription`, so this module imports nothing from
 * the database layer, the ServiceM8 client or the classifier — only the
 * timezone date it formats the note with (tests/lint-ban.test.ts,
 * CLIENT_REACHABLE).
 *
 * ── VERBATIM WORDS ONLY (D-02) ──────────────────────────────────────────────
 *
 * The description is the caller's replies exactly as they arrived, in the
 * order they arrived, then three fixed lines: the suburb the OPERATOR typed on
 * the sheet (nothing stores one), the urgency as a closed-vocabulary label
 * (`URGENCY_LINES` — a label, never model prose), and the note naming the call.
 * No summary, no model text: the builder takes reply bodies and typed facts
 * and nothing else can enter.
 *
 * ── THE PREVIEW AND THE WRITE CANNOT DISAGREE (checker W3) ──────────────────
 *
 * The page hands the form `previewLinesFor(facts)`; the form composes the
 * preview with the typed suburb through `composeJobDescription`. The action
 * never trusts that preview: it re-reads the facts and calls
 * `buildJobDescription(facts, suburb)`, which is `previewLinesFor` composed the
 * same way. Same facts, same suburb → byte-identical text, by construction.
 *
 * DETERMINISTIC: same input, same bytes. The retry adopts an orphaned job by
 * the SHA-256 of the text persisted before the first POST (job-provision.ts),
 * never by re-composing it — the operator may retype the suburb on a retry.
 */
import { TZDate } from '@date-fns/tz';

/**
 * The fixed note line's prefix; the tenant-zone call date AND time (to the
 * minute) follow. The time is what makes two leads' descriptions differ when
 * two callers of one company send the same words on the same day — the job's
 * SHA-256 is the adopt-by-digest key, so equal descriptions would let one
 * lead's retry adopt the other's job (14-REVIEW WR-02).
 */
export const JOB_NOTE_PREFIX = 'Created by Backdesk from a missed call on ';

/** `LEAD_URGENCIES`, spelled here as a literal union — this module stays client-safe. */
export type JobUrgency = 'emergency' | 'this_week' | 'flexible' | 'unknown';

/**
 * A map, not an underscore-to-space string replace: an urgency the map does
 * not know writes NO line (`urgencyLineFor` returns `null`) rather than ship
 * as snake_case into a tradie's ServiceM8. `unknown` writes no line at all.
 */
const URGENCY_LINES: Record<string, string | null> = {
  emergency: 'Urgency: emergency',
  this_week: 'Urgency: this week',
  flexible: 'Urgency: flexible',
  unknown: null,
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The three lines a preview carries beside the operator's suburb. */
export interface JobPreviewLines {
  replies: string[];
  urgencyLine: string | null;
  noteLine: string;
}

/** The facts the description is built from — bodies and typed facts only. */
export interface JobDescriptionFacts {
  /** Oldest first, as `jobSheetFacts` returns them. */
  replies: ReadonlyArray<{ body: string; urgency: string | null }>;
  firstMissedAt: Date;
  /** The tenant's IANA zone — the note names the tradie's local date. */
  timezone: string;
}

/**
 * Compose the description: each reply on its own line in the order given
 * (trimmed, inner newlines kept, empty ones dropped), then `Suburb: …` when
 * given, then the urgency line when given, then the note line; joined by `\n`.
 */
export function composeJobDescription(input: {
  replies: readonly string[];
  suburb: string | null;
  urgencyLine: string | null;
  noteLine: string;
}): string {
  const lines: string[] = [];
  for (const reply of input.replies) {
    const trimmed = reply.trim();
    if (trimmed !== '') lines.push(trimmed);
  }
  const suburb = input.suburb === null ? '' : input.suburb.trim();
  if (suburb !== '') lines.push(`Suburb: ${suburb}`);
  if (input.urgencyLine !== null) lines.push(input.urgencyLine);
  lines.push(input.noteLine);
  return lines.join('\n');
}

/** The fixed urgency line, or `null` for `unknown`, a null urgency or anything unrecognised. */
export function urgencyLineFor(urgency: string | null): string | null {
  if (urgency === null) return null;
  return URGENCY_LINES[urgency] ?? null;
}

/**
 * `Created by Backdesk from a missed call on 10 Oct 2026 at 7:30 am` — the
 * date and the time to the minute, both in `timezone`. Hand-formatted (no
 * `Intl`), so server and browser render the same bytes.
 */
export function noteLineFor(firstMissedAt: Date, timezone: string): string {
  const local = new TZDate(new Date(firstMissedAt).getTime(), timezone);
  const hours = local.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(local.getMinutes()).padStart(2, '0');
  const meridiem = hours < 12 ? 'am' : 'pm';
  return (
    `${JOB_NOTE_PREFIX}${local.getDate()} ${MONTHS[local.getMonth()]} ${local.getFullYear()}` +
    ` at ${hour12}:${minutes} ${meridiem}`
  );
}

/**
 * The preview's lines from the sheet facts. The urgency is the NEWEST
 * labelled reply's (a later "actually it's urgent" wins); none labelled → no
 * line.
 */
export function previewLinesFor(facts: JobDescriptionFacts): JobPreviewLines {
  let urgencyLine: string | null = null;
  for (let i = facts.replies.length - 1; i >= 0; i -= 1) {
    const urgency = facts.replies[i].urgency;
    // `unknown` is the classifier declining to say — not a label, so an
    // "ok thanks" after "it's flooding" does not erase the emergency.
    if (urgency !== null && urgency !== 'unknown') {
      urgencyLine = urgencyLineFor(urgency);
      break;
    }
  }
  return {
    replies: facts.replies.map((reply) => reply.body),
    urgencyLine,
    noteLine: noteLineFor(facts.firstMissedAt, facts.timezone),
  };
}

/** What the action writes: `previewLinesFor(facts)` composed with the suburb. */
export function buildJobDescription(facts: JobDescriptionFacts, suburb: string | null): string {
  return composeJobDescription({ ...previewLinesFor(facts), suburb });
}
