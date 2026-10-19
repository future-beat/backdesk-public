/**
 * CAD-02: when a tenant is allowed to be contacted, and where the next slot is.
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*`. Contact-hours
 * discipline is a fact about Australian consumer contact, not about a request
 * handler — the cadence tick, the re-window pass, the operator console's "next
 * touch" copy and any later bulk tool must all reach the identical answer, so
 * the rule cannot live behind a route.
 *
 * WHAT THE CALLER MUST STILL DO: decide whether to send. These functions place
 * and classify instants. They have no opinion about suppression, pause flags,
 * quote status or ledger claims — every one of those is a separate refusal the
 * dispatcher owns (CAD-05).
 *
 * ── THREE WAYS THIS GOES WRONG SILENTLY, AND WHAT STOPS EACH ────────────────
 *
 * ISO WEEKDAYS (RESEARCH Pitfall 2). `tenants.contact_days` is documented
 * "ISO weekdays, Monday = 1 .. Sunday = 7"; `Date.prototype.getDay()` returns
 * Sunday = 0 .. Saturday = 6. `contactDays.includes(d.getDay())` therefore
 * makes Sunday permanently unreachable and shifts every other day back by one,
 * with no error at any layer. There is exactly ONE conversion in this codebase
 * and it is `isoWeekdayInZone` below.
 *
 * TIME STRINGS (RESEARCH Pitfall 3). `contact_hours_start`/`_end` are Postgres
 * `time` columns; the driver hands them over as 'HH:MM:SS' STRINGS. Comparing
 * one to a `Date`, or accepting an unpadded '9:30' whose lexical order puts it
 * after '17:00:00', produces a wrong answer that looks like a right one. So
 * every comparison in this file is between INTEGER minutes-since-midnight,
 * and `parseTimeOfDay` refuses anything that is not exactly 'HH:MM[:SS]'.
 *
 * OVERNIGHT WINDOWS (RESEARCH Assumption A1). Both available readings of a
 * 20:00–06:00 row — "wraps past midnight" and "is empty" — are guesses, and one
 * of them sends at 3am. `assertValidWindow` throws a named error instead. If a
 * real overnight tenant ever appears, wrap support gets designed then, in
 * daylight.
 *
 * The row itself is unreachable through any writer: migration 0004's
 * `tenants_hours_ordered` CHECK (`start < end`) rejects both the overnight and
 * the zero-width window at the database, where no caller can route around it,
 * and `tenants_days_nonempty` does the same for the empty `contact_days` that
 * raises `NoAllowedContactDayError`. So this module's two named errors are the
 * FLOOR under a constraint rather than the only thing standing between an
 * operator's typo and a 3am text — which matters, because the outbox consumer
 * treats either of them as a reason to hold the shared cursor.
 *
 * ── THE ZONE BOUNDARY ───────────────────────────────────────────────────────
 *
 * Stored instants are UTC and every comparison of two instants is UTC
 * milliseconds. Zone resolution happens at exactly two points: reading the
 * tenant-local wall clock of a candidate instant, and constructing the instant
 * for a chosen wall-clock slot. `TZDate`'s constructor reads its numeric
 * components AS WALL-CLOCK TIME in the given zone and resolves that date's
 * offset including DST — the operation a stored UTC offset cannot perform
 * (the idiom is `src/core/servicem8/normalize.ts:104-117`).
 */
import { TZDate } from '@date-fns/tz';
import { addDays } from 'date-fns';

import { SAME_DAY_MARGIN_MINUTES } from './constants';

/**
 * The contact-hours configuration of one tenant.
 *
 * Structurally the four `tenants` columns (`src/db/schema/tenants.ts:35-39`),
 * declared as a plain interface rather than imported from the schema so that
 * this module stays free of the database layer and a caller can hand it a
 * hypothetical window — which the re-window preview in the console will want.
 */
export interface ContactWindow {
  /** IANA identifier, never a UTC offset — offsets break across DST. */
  timezone: string;
  /** 'HH:MM:SS' as the `time` column's driver representation returns it. */
  contactHoursStart: string;
  contactHoursEnd: string;
  /** ISO weekdays, Monday = 1 .. Sunday = 7. */
  contactDays: readonly number[];
}

/** Thrown for a window this module refuses to interpret. Named, so callers can catch it. */
export class InvalidContactWindowError extends Error {
  override readonly name = 'InvalidContactWindowError';
}

/** Thrown when `contact_days` admits no day at all — a tenant nobody may ever contact. */
export class NoAllowedContactDayError extends Error {
  override readonly name = 'NoAllowedContactDayError';
}

const MS_PER_MINUTE = 60_000;

/**
 * The search bound for "the next allowed day".
 *
 * A full year and a day. Any tenant configuration with at least one contact day
 * resolves inside seven iterations; the bound exists so that a configuration
 * with none terminates with a NAMED error rather than spinning, and so the
 * failure names the cause instead of appearing as a hung tick.
 */
const MAX_DAY_ROLL = 366;

/** Exactly 'HH:MM' or 'HH:MM:SS'. Unpadded hours are refused — see the header. */
const TIME_OF_DAY = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * 'HH:MM:SS' → minutes since midnight.
 *
 * THROWS rather than returning null, and that direction is chosen. A malformed
 * contact-hours value is a fact about OUR data — a `time` column that cannot be
 * a time, or a hand-written config constant — not about anything a customer
 * did. Every fallback available here (treat as midnight, treat as always-open,
 * skip the tenant) is a compliance decision made by accident at 3am.
 *
 * Seconds are parsed for validation and then DISCARDED: contact hours are a
 * policy boundary expressed in minutes, and a window ending at 17:00:30 is not
 * a distinction anybody intends.
 */
export function parseTimeOfDay(value: string): number {
  const match = TIME_OF_DAY.exec(value);
  if (!match) {
    throw new InvalidContactWindowError(
      `Not a time of day: ${JSON.stringify(value)}. Expected 'HH:MM' or 'HH:MM:SS' ` +
        "with a zero-padded hour (a Postgres `time` column returns '09:30:00').",
    );
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);

  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new InvalidContactWindowError(
      `Not a time of day: ${JSON.stringify(value)}. Hours 00-23, minutes and seconds 00-59.`,
    );
  }

  return hours * 60 + minutes;
}

/**
 * The ISO weekday (Mon = 1 .. Sun = 7) of an instant, read in `zone`.
 *
 * THE ONLY `getDay()` CALL THAT SHOULD EXIST IN THE CADENCE ENGINE. It is read
 * off a `TZDate`, so it is the TENANT's weekday: a Perth Sunday morning is
 * still Saturday in UTC, and a UTC-based reading would find that day allowed
 * for a Monday-to-Friday tenant.
 */
export function isoWeekdayInZone(instant: Date, zone: string): number {
  assertUsableInstant(instant, 'instant');
  return ((new TZDate(instant, zone).getDay() + 6) % 7) + 1;
}

/**
 * Refuse a window this module cannot interpret. See Assumption A1 in the header.
 *
 * Takes minutes-since-midnight, so a caller that has already parsed does not
 * parse twice, and so the comparison is unambiguously numeric.
 */
export function assertValidWindow(startMinutes: number, endMinutes: number): void {
  if (!(startMinutes < endMinutes)) {
    throw new InvalidContactWindowError(
      `Contact-hours window must satisfy start < end; got start=${startMinutes} ` +
        `end=${endMinutes} (minutes since midnight). An overnight or zero-width ` +
        'window is not supported, and guessing which of the two readings was ' +
        'meant would decide a compliance question by accident.',
    );
  }
}

/** The parsed, validated bounds of a window. */
function windowBounds(win: ContactWindow): { start: number; end: number } {
  const start = parseTimeOfDay(win.contactHoursStart);
  const end = parseTimeOfDay(win.contactHoursEnd);
  assertValidWindow(start, end);
  return { start, end };
}

/**
 * Is this instant inside the tenant's contact hours, on a day they allow?
 *
 * THE BOUNDARY IS HALF-OPEN, [start, end). `contact_hours_end` is the moment
 * the window CLOSES, so an instant exactly at 17:00:00 is outside it. Treating
 * it as inclusive would put one message per day outside permitted hours,
 * forever, with a customer complaint as the only witness.
 */
export function isInsideWindow(instant: Date, win: ContactWindow): boolean {
  assertUsableInstant(instant, 'instant');
  const { start, end } = windowBounds(win);

  const zoned = new TZDate(instant, win.timezone);
  const isoWeekday = ((zoned.getDay() + 6) % 7) + 1;
  if (!win.contactDays.includes(isoWeekday)) return false;

  const minutes = zoned.getHours() * 60 + zoned.getMinutes();
  return minutes >= start && minutes < end;
}

/** The tenant-zone calendar date of an instant. */
interface ZoneDate {
  year: number;
  /** 1-based, as a human writes it. */
  month: number;
  day: number;
}

function zoneDateOf(instant: Date, zone: string): ZoneDate {
  const zoned = new TZDate(instant, zone);
  return { year: zoned.getFullYear(), month: zoned.getMonth() + 1, day: zoned.getDate() };
}

/**
 * Calendar-day arithmetic on a tenant-zone date, performed in UTC.
 *
 * The `followup.ts` idiom (`addDays` on a `TZDate` pinned to UTC): UTC has no
 * DST, so "+ 3 days" is exactly three 24-hour steps and lands on the calendar
 * date a human would name. Doing the same addition on a zoned instant would
 * cross a DST boundary as 23 or 25 hours and could land on the wrong DATE for
 * a slot near midnight. The result here is a date, not a moment — the moment is
 * built afterwards from the tenant's wall clock.
 */
function addCalendarDays(date: ZoneDate, days: number): ZoneDate {
  const base = new TZDate(Date.UTC(date.year, date.month - 1, date.day), 'UTC');
  const shifted = new Date(addDays(base, days).getTime());
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** ISO weekday of a bare calendar date, with no instant involved. */
function isoWeekdayOfDate(date: ZoneDate): number {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return ((utc.getUTCDay() + 6) % 7) + 1;
}

/**
 * A tenant-zone wall clock (date + minutes) → the UTC instant it names.
 *
 * `TZDate`'s constructor reads these components as wall-clock time in the zone
 * and resolves that date's offset, DST included. This is the one place a
 * chosen slot becomes a storable instant.
 */
function instantAtWallClock(date: ZoneDate, minutes: number, zone: string): Date {
  const zoned = new TZDate(
    date.year,
    date.month - 1,
    date.day,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    zone,
  );
  const instant = new Date(zoned.getTime());
  if (Number.isNaN(instant.getTime())) {
    throw new InvalidContactWindowError(
      `Could not resolve ${date.year}-${date.month}-${date.day} ${minutes}m in ${zone}.`,
    );
  }
  return instant;
}

/**
 * The wall-clock minute a preferred send time actually lands on, given a window.
 *
 * TWO CLAMPS, both deliberate:
 *
 *   PREFERRED OUTSIDE THE WINDOW → window start. A tenant whose window opens at
 *   10:00 while the preferred time is the 09:30 default gets 10:00 + jitter.
 *   The alternatives are sending outside permitted hours or refusing to
 *   schedule the tenant at all, and both are worse than sending on the hour
 *   they said they open.
 *
 *   JITTER PUSHING PAST THE CLOSE → the last minute inside the window. Cannot
 *   occur while `JITTER_MAX_MINUTES` stays far below the width of any real
 *   window, which is exactly why it is written down: the day someone raises the
 *   jitter bound, this clamp is what keeps the half-open boundary true.
 */
function slotMinutes(
  preferredSendTime: string,
  start: number,
  end: number,
  jitter: number,
): number {
  const preferred = parseTimeOfDay(preferredSendTime);
  const base = preferred >= start && preferred < end ? preferred : start;
  const withJitter = base + jitter;
  return withJitter < end ? withJitter : Math.max(start, end - 1);
}

/** A jitter draw the caller cannot have made accidentally unusable. */
function drawJitter(jitterMinutes: () => number): number {
  const raw = jitterMinutes();
  if (!Number.isFinite(raw)) {
    throw new InvalidContactWindowError(`jitterMinutes() returned ${raw}; expected a number.`);
  }
  // Negative jitter would move a slot BACKWARDS, which is how a touch is born
  // overdue by a route nothing else in this file admits.
  return Math.max(0, Math.trunc(raw));
}

function assertUsableInstant(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidContactWindowError(
      `${label} must be a real Date; got ${String(value)}. An Invalid Date compares ` +
        'false to everything, which reads as "not due yet" forever.',
    );
  }
}

/**
 * Roll forward from `from` (a tenant-zone date) to the first allowed day whose
 * slot is at or after `notBefore`, and return that slot's instant.
 */
function rollToAllowedSlot(
  from: ZoneDate,
  win: ContactWindow,
  minutes: number,
  notBefore: Date | null,
): Date {
  for (let offset = 0; offset < MAX_DAY_ROLL; offset += 1) {
    const candidate = offset === 0 ? from : addCalendarDays(from, offset);
    if (!win.contactDays.includes(isoWeekdayOfDate(candidate))) continue;

    const instant = instantAtWallClock(candidate, minutes, win.timezone);
    if (notBefore && instant.getTime() < notBefore.getTime()) continue;

    return instant;
  }

  throw new NoAllowedContactDayError(
    `No contact day found within ${MAX_DAY_ROLL} days of ` +
      `${from.year}-${from.month}-${from.day} for contact_days ` +
      `[${win.contactDays.join(', ')}] in ${win.timezone}.`,
  );
}

/**
 * D-09: the next moment this tenant may be contacted, at or after `from`.
 *
 * "Later today if the contact window is still open, otherwise the next allowed
 * contact day at the preferred slot" — with the same-day branch qualified by a
 * margin, because a touch becoming due at 16:55 against a 17:00 close is
 * technically compliant and practically an ambush at knock-off.
 *
 * The three branches, in the order they are tried:
 *
 *   1. SAME-DAY CONTINUATION. `from` is already inside the window on an allowed
 *      day, and at least `sameDayMarginMinutes` of the window remain. The slot
 *      is `from + jitter` — deliberately NOT the preferred time, which is
 *      already behind us. This is the branch that makes D-01 true for a quote
 *      the operator ticks eligible at 10am: it goes out this morning.
 *
 *   2. PREFERRED SLOT TODAY. `from` is before the window opens (or before the
 *      preferred time) on an allowed day, so today's slot is still ahead.
 *
 *   3. NEXT ALLOWED DAY. Everything else — after the window, inside it with too
 *      little left, or on a day the tenant does not contact — rolls forward
 *      day by day until `contact_days` admits one.
 *
 * THE RETURN IS NEVER BEFORE `from`. That is the property D-01 rests on, and
 * branches 2 and 3 share the same `notBefore` filter to guarantee it rather
 * than arguing it.
 *
 * JITTER IS DRAWN EXACTLY ONCE per call, before any branch is chosen, so the
 * number of candidate days examined cannot influence the result.
 */
export function nextAllowedSlot(
  from: Date,
  win: ContactWindow,
  preferredSendTime: string,
  jitterMinutes: () => number,
  opts?: { sameDayMarginMinutes?: number },
): Date {
  assertUsableInstant(from, 'from');
  const { start, end } = windowBounds(win);

  const jitter = drawJitter(jitterMinutes);
  const margin = opts?.sameDayMarginMinutes ?? SAME_DAY_MARGIN_MINUTES;

  const zoned = new TZDate(from, win.timezone);
  const today: ZoneDate = {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
  };
  const nowMinutes = zoned.getHours() * 60 + zoned.getMinutes();
  const todayAllowed = win.contactDays.includes(isoWeekdayOfDate(today));

  // Branch 1 — later today, from where we are.
  if (
    todayAllowed &&
    nowMinutes >= start &&
    nowMinutes + margin <= end &&
    nowMinutes + jitter < end
  ) {
    return new Date(from.getTime() + jitter * MS_PER_MINUTE);
  }

  // Branches 2 and 3 — the preferred slot, on the first day that can hold it.
  return rollToAllowedSlot(today, win, slotMinutes(preferredSendTime, start, end, jitter), from);
}

/**
 * The preferred slot on `dayAnchor`'s tenant-zone DATE, or the first allowed
 * day after it.
 *
 * The offset-touch placement (D-02/D-03), and deliberately a different function
 * from `nextAllowedSlot` rather than an option on it. This one is asked about a
 * DATE: touch 4 belongs on anchor + 14 days at the preferred time, whatever
 * time of day the anchor happened to fall at. Folding the two together would
 * mean an anchor at 14:00 pulling every later touch to 14:00 through the
 * same-day branch, which is not what "9:30 in the tradie's voice" means.
 */
export function preferredSlotOnOrAfter(
  dayAnchor: Date,
  win: ContactWindow,
  preferredSendTime: string,
  jitterMinutes: () => number,
): Date {
  assertUsableInstant(dayAnchor, 'dayAnchor');
  const { start, end } = windowBounds(win);
  const jitter = drawJitter(jitterMinutes);

  return rollToAllowedSlot(
    zoneDateOf(dayAnchor, win.timezone),
    win,
    slotMinutes(preferredSendTime, start, end, jitter),
    null,
  );
}

/**
 * The preferred slot `offsetDays` calendar days after `anchor`'s tenant-zone
 * date, rolled forward past any day the tenant does not contact.
 *
 * Exported for `materialize.ts`, which owns the offsets but must not own the
 * zone arithmetic — keeping `addCalendarDays` and `instantAtWallClock` private
 * to this file is what makes "there is one weekday conversion and one wall-clock
 * constructor" checkable rather than aspirational.
 */
export function slotAtOffsetDays(
  anchor: Date,
  offsetDays: number,
  win: ContactWindow,
  preferredSendTime: string,
  jitterMinutes: () => number,
): Date {
  assertUsableInstant(anchor, 'anchor');
  const { start, end } = windowBounds(win);
  const jitter = drawJitter(jitterMinutes);

  const target = addCalendarDays(zoneDateOf(anchor, win.timezone), offsetDays);

  return rollToAllowedSlot(target, win, slotMinutes(preferredSendTime, start, end, jitter), null);
}

/**
 * Phase 13 (D-09): the instant this tenant's contact window next OPENS, at or
 * after `from` — or `from` itself when it is already inside the window.
 *
 * THE OPENING MINUTE, NEVER THE PREFERRED SEND TIME. A tradie's held hot-lead
 * alert goes out when the shop opens, not mid-morning: a window of 08:00–17:00
 * with a 09:30 preferred send time opens at 08:00, and that is what this
 * returns. It is deliberately not given a preferred time to read — the
 * `start` bound of `windowBounds` is passed to the same private roll
 * `nextAllowedSlot` uses for its preferred slot, so the two cannot disagree
 * about which days are allowed, only about the minute (research gap 5: every
 * test whose preferred time equals the start would pass a helper built on the
 * wrong one, and production would release at 09:30).
 *
 * No jitter: this is a release instant for one alert to the business owner,
 * not a slot for a consumer touch, and a few minutes of spread buys nothing.
 * Never before `from`, by the same `notBefore` filter `nextAllowedSlot` uses.
 */
export function nextWindowOpen(from: Date, win: ContactWindow): Date {
  assertUsableInstant(from, 'from');
  if (isInsideWindow(from, win)) return from;

  const { start } = windowBounds(win);
  return rollToAllowedSlot(zoneDateOf(from, win.timezone), win, start, from);
}
