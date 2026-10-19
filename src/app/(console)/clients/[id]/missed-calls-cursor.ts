/**
 * THE MISSED-CALL LOG'S KEYSET CURSOR (Phase 15, CON-06 / D-02; T-15-12).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A LEAF. It imports zod and nothing else, so the page, the section and    │
 * │ the pure suite share one spelling of the cursor without a database.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The cursor is the LAST ROW of the previous page, `{ISO instant}_{uuid}` —
 * exactly what `missedCalls.listForLog({ before })` compares against with
 * `(started_at, id) < (before.startedAt, before.id)`. Never a page number: an
 * offset shifts a row onto two pages (or off both) when a call arrives while
 * the operator scrolls; a keyset cannot.
 *
 * THE VALUE IS TYPED BY WHOEVER HOLDS THE URL, so it is parsed before it
 * reaches a predicate. The instant must be a real instant (the strict ISO form
 * `formatCallsBefore` writes, round-tripped), the id a real uuid; anything
 * else — the parameter repeated, a bad date, a path, a fragment of SQL — is
 * page one, silently. A malformed cursor is not an error worth a sentence: it
 * is a link someone edited.
 */
import { z } from 'zod';

/** The query parameter, named once for the page, the section and the links. */
export const CALLS_BEFORE_PARAM = 'calls_before';

const instantSchema = z.iso.datetime();
const idSchema = z.uuid();

/** The parsed cursor, or `null` — page one. */
export function parseCallsBefore(
  raw: string | string[] | undefined,
): { startedAt: Date; id: string } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  // The LAST underscore: an ISO instant carries none, a uuid carries none, so
  // either split works for a well-formed value — the last one is the honest one.
  const cut = raw.lastIndexOf('_');
  if (cut <= 0) return null;
  const instant = raw.slice(0, cut);
  const id = raw.slice(cut + 1);

  if (!instantSchema.safeParse(instant).success) return null;
  if (!idSchema.safeParse(id).success) return null;

  const startedAt = new Date(instant);
  if (Number.isNaN(startedAt.getTime())) return null;
  // The strict round trip: an instant the calendar does not have (30 February,
  // hour 25) never survives `toISOString()` unchanged.
  if (startedAt.toISOString() !== instant) return null;

  return { startedAt, id: id.toLowerCase() };
}

/** The cursor for the page after the one ending in `row`. */
export function formatCallsBefore(row: { startedAt: Date; id: string }): string {
  return `${row.startedAt.toISOString()}_${row.id}`;
}
