/**
 * Turning ServiceM8's two ambiguous value types into ones we can compute with.
 *
 * TIMESTAMPS (SYNC-03). ServiceM8 sends naive strings — `'2026-08-26 09:00:00'`
 * with no zone — and the reference documentation never states which zone they
 * are in.
 *
 * MEASURED, 26 Aug 2026 (scripts/sm8-spike.mjs, A3): they are **UTC**. Every
 * response carries an `x-platform-date-utc` header stating ServiceM8's own UTC
 * clock, and a job edited 24 minutes earlier had an `edit_date` reading 24
 * minutes BEHIND that header when read as UTC. Had the timestamps been Perth
 * local (UTC+8), the same string would have read ~8 hours AHEAD of it.
 *
 * This CONTRADICTS research assumption A3 ("timestamps are account-local") and
 * the community report of future-skewed values that motivated it. Interpreting
 * a UTC timestamp in Australia/Perth would put every displayed time 8 hours
 * out — which is why the source zone is now an explicit, per-connection value
 * (`SM8_TIMESTAMP_ZONE`) rather than an assumption buried in a call site: if a
 * future account really does store local time, that is a stored calibration
 * change, not a code change.
 *
 * Two consequences the design already accounts for:
 *   - Sync correctness does NOT depend on this being right. The cursor compares
 *     ServiceM8 strings to ServiceM8 strings inside ServiceM8's own filter
 *     (RESEARCH Pattern 1), so an 8-hour skew changes nothing there.
 *   - Only display and 3-day grace math consume the UTC values, both of which
 *     tolerate hours of error. Nothing in the state machine may depend on
 *     sub-day precision of a normalized ServiceM8 timestamp.
 *
 * MONEY (Pitfall 4). `parseMoneyToCents` never lets a money value touch binary
 * floating point. `parseFloat('0.1') * 100` is `10.000000000000002`, and
 * `Math.round` hides that until the value that matters is `1234.565`. Integer
 * string math has no such rounding step, because there is no fraction to round.
 */
import { TZDate } from '@date-fns/tz';

import type { sm8Job } from './schemas';
import type { NormalizedQuote } from './types';

/**
 * The zone ServiceM8's naive timestamps are interpreted IN.
 *
 * Measured, not assumed — see the header. Named and exported so every call site
 * says out loud which zone it is interpreting in, and so the day an account is
 * found storing local time, the fix is to pass a different zone rather than to
 * re-derive this reasoning from scratch.
 *
 * NOTE THIS IS NOT THE TENANT'S TIMEZONE. The tenant's IANA zone governs
 * contact hours and DISPLAY; this governs how a ServiceM8 string is READ. They
 * are different questions and conflating them is an 8-hour error in Perth.
 */
export const SM8_TIMESTAMP_ZONE = 'UTC';

/**
 * IANA identifiers only, validated by membership — the Phase 1 rule
 * (src/db/schema/tenants.ts: "IANA identifier, never a UTC offset").
 *
 * Computed once: `Intl.supportedValuesOf` builds a ~600-entry array per call.
 */
let supportedZones: Set<string> | undefined;

function isSupportedZone(zone: string): boolean {
  if (!supportedZones) supportedZones = new Set(Intl.supportedValuesOf('timeZone'));
  if (supportedZones.has(zone)) return true;
  // 'UTC' is universally accepted but absent from some runtimes' list.
  return zone === 'UTC';
}

/** '2026-08-26 09:00:00' or '2026-08-26T09:00:00', with optional seconds. */
const NAIVE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Interpret a naive ServiceM8 timestamp in `ianaZone` and return the UTC
 * instant.
 *
 * Returns `null` — never `Invalid Date` — for null, empty, zero-date and
 * unparseable input. The whole point of this function is that its output is
 * either a real instant or an explicit absence; a third "technically a Date but
 * arithmetic on it yields NaN" state is what SYNC-03 exists to eliminate.
 *
 * THROWS on an invalid zone identifier, because that is a programming or data
 * error about OUR configuration, not about ServiceM8's payload. Silently
 * falling back to UTC would put every displayed time 8 hours out for a Perth
 * client and nothing would ever go red.
 */
export function sm8ToUtc(raw: string | null | undefined, ianaZone: string): Date | null {
  if (!isSupportedZone(ianaZone)) {
    throw new Error(
      `sm8ToUtc received an unsupported timezone: ${JSON.stringify(ianaZone)}. ` +
        'Must be an IANA identifier such as Australia/Perth.',
    );
  }

  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('0000-00-00')) return null;

  const m = NAIVE_TIMESTAMP.exec(trimmed);
  if (!m) return null;

  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;

  // TZDate's constructor reads the numeric components AS WALL-CLOCK TIME in the
  // given zone and resolves the offset — including DST — for that date, which
  // is exactly the operation a fixed offset cannot perform correctly.
  const zoned = new TZDate(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    ianaZone,
  );

  const instant = new Date(zoned.getTime());
  // A syntactically valid but impossible date ('2026-02-31') lands here.
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Optional sign, digits, optional decimal part. Commas and $ are rejected. */
const MONEY = /^(-?)(\d*)(?:\.(\d*))?$/;

/**
 * Parse a ServiceM8 money string to an integer number of cents.
 *
 * Pure string manipulation: split on the decimal point, pad or truncate the
 * fractional part to exactly two digits, concatenate, parse as an integer once.
 * No floating-point operation occurs at any step.
 *
 * Truncation rather than rounding on a third decimal is deliberate — ServiceM8
 * totals are already cent-denominated, so a third digit means something
 * unexpected happened upstream and inventing a rounding rule would hide it.
 */
export function parseMoneyToCents(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const m = MONEY.exec(trimmed);
  if (!m) return null;

  const [, sign, whole = '', fraction = ''] = m;
  if (whole === '' && fraction === '') return null;

  const cents = `${fraction}00`.slice(0, 2);
  const value = Number.parseInt(`${whole || '0'}${cents}`, 10);
  if (!Number.isFinite(value)) return null;

  return sign === '-' ? -value : value;
}

/**
 * Integer cents → the decimal string a `numeric(12,2)` column takes.
 *
 * A STRING, not a number: handing drizzle a JS number for a numeric column
 * reintroduces the float round-trip this module exists to prevent, one layer
 * further down where it is harder to see.
 */
export function centsToNumeric(cents: number | null): string | null {
  if (cents == null) return null;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${remainder}`;
}

/** The convenience composition: ServiceM8 money string → numeric(12,2) string. */
export function moneyToNumeric(raw: string | null | undefined): string | null {
  return centsToNumeric(parseMoneyToCents(raw));
}

/**
 * Parsed ServiceM8 job → the shape the `quotes` table takes.
 *
 * LIVES HERE, NOT IN `sync/connect.ts`, AND THAT MOVE IS NOT COSMETIC. Every
 * value this function produces comes from one of the three functions above it
 * in this file, so this was always a normalization concern wearing a connect
 * module's address. Keeping it there forced `sync/run-sync.ts` to import from
 * `sync/connect.ts` — and once `connect.ts` gained `resumeConnection`, which
 * has to trigger an immediate cycle, those two modules imported each other.
 * ESM tolerates that cycle today because both bindings are hoisted function
 * declarations; it stops being tolerated the moment either file grows a
 * module-level constant that reads across the boundary, and the failure mode
 * is an `undefined` at import time with a stack that names neither cause.
 *
 * `sourceZone` is the zone ServiceM8's naive strings are READ in — measured as
 * UTC (see the header). It is deliberately NOT the tenant's timezone: the
 * tenant's zone governs contact hours and display, this one governs
 * interpretation, and conflating them is an 8-hour error in Perth.
 */
export function normalizeJob(
  job: ReturnType<typeof sm8Job.parse>,
  sourceZone: string = SM8_TIMESTAMP_ZONE,
): NormalizedQuote {
  return {
    sm8JobUuid: job.uuid,
    status: job.status,
    sm8Active: job.active,
    generatedJobId: job.generated_job_id ?? null,
    jobAddress: job.job_address ?? null,
    jobDescription: job.job_description ?? null,
    companyUuid: job.company_uuid ?? null,
    totalInvoiceAmount: moneyToNumeric(job.total_invoice_amount),
    quoteSent: job.quote_sent ?? null,
    editDateRaw: job.edit_date,
    editDateUtc: sm8ToUtc(job.edit_date, sourceZone),
    dateRaw: job.date,
    quoteDateRaw: job.quote_date,
    quoteDateUtc: sm8ToUtc(job.quote_date, sourceZone),
    workOrderDateRaw: job.work_order_date,
    workOrderDateUtc: sm8ToUtc(job.work_order_date, sourceZone),
    completionDateRaw: job.completion_date,
    completionDateUtc: sm8ToUtc(job.completion_date, sourceZone),
    unsuccessfulDateRaw: job.unsuccessful_date,
    unsuccessfulDateUtc: sm8ToUtc(job.unsuccessful_date, sourceZone),
    quoteSentStampRaw: job.quote_sent_stamp,
    quoteSentStampUtc: sm8ToUtc(job.quote_sent_stamp, sourceZone),
  };
}
