/**
 * The report a client was actually sent. FROZEN, VERSIONED, EVIDENCE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ D-11, VERBATIM: GENERATING A REPORT WRITES A FROZEN, VERSIONED ROW.      │
 * │ THE PAGE RENDERS FROM THE ROW. THE ROW IS THE RECORD. THERE IS NO UPDATE │
 * │ PATH ANYWHERE — not in the repository, not in the grants, not here.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY A ROW AND NOT A LIVE-COMPUTED PAGE ─────────────────────────────────
 *
 * The product's promise is that the invoice arrives stapled to proof it paid for
 * itself. Proof means the PDF a client received in September is still, in
 * February, byte-for-byte the document they were handed — while everything it
 * was computed from keeps moving underneath it. ServiceM8 job values get edited.
 * Baselines get re-measured as more history accumulates. Fee schedules change.
 * `ATTRIBUTION_WINDOW_DAYS` may change. A page that recomputed would quietly
 * restate a figure the client already checked against their own account, and the
 * first time they noticed would be the last month they trusted the number.
 *
 * So EVERYTHING the page prints is in this row: the headline figures, the
 * per-job lines, the baseline used, every constant used, and the fee rows in
 * force with the arithmetic inputs. The renderer imports the constants module
 * only to compare `constants.attributionWindowDays` against today's value and
 * print a SCREEN-ONLY warning when they differ. It never recomputes a figure.
 *
 * ── UNIQUE (tenant_id, period_start, version) IS THE ARBITER ────────────────
 *
 * Re-generating a month creates version N+1 AND KEEPS N — that is what makes
 * "here is what we sent you last week, and here is the corrected one" a thing
 * the system can say. The unique index is what decides between two operators (or
 * one operator double-clicking) generating at the same moment: both compute
 * `COALESCE(MAX(version), 0) + 1` in one statement, the loser gets SQLSTATE
 * 23505 at the write, and the action maps it to "a report for this month was
 * just generated — reload to see it". The same trade `touch_drafts` makes for
 * its approved-draft index: a raise at the write rather than a silent coin-flip
 * at the read (touch-drafts.ts:31-39).
 *
 * A report for the CURRENT, unfinished month is allowed. The page labels it
 * "month to date" — the row is still frozen.
 *
 * ── THE EVIDENCE FAMILY RULES, RESTATED (escalations.ts, send-ledger.ts) ────
 *
 *   * `tenant_id` is a COLUMN, not a foreign key, and there is NO CASCADE from
 *     `tenants`. A client who disconnects must not take with them the documents
 *     we sent them — those are our billing record as much as their report.
 *   * RLS is authored HERE, as a `pgPolicy`, so a new table cannot ship
 *     unprotected by omission (the Phase 1 rule).
 *   * READ-ONLY to `authenticated`. Migration 0033 carries the argument: A
 *     CONSOLE UPDATE REWRITES A DOCUMENT A CLIENT WAS ALREADY SENT.
 */
import { sql } from 'drizzle-orm';
import {
  date,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const monthlyReports = pgTable(
  'monthly_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No foreign key, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),

    /**
     * The period as LOCAL CALENDAR DATES in `timezone`, `period_end` EXCLUSIVE.
     *
     * Dates rather than instants because "August 2026" is a calendar fact in the
     * client's own zone, and storing the boundary instants would make the row
     * unreadable without re-deriving the zone. The half-open convention is the
     * same one the period module computes with, restated here so a reader of the
     * row cannot mistake `2026-09-01` for "the report includes 1 September".
     */
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),

    /**
     * The IANA zone the bounds were computed in, frozen with them.
     *
     * `tenants.timezone` is editable. A report generated while a client was
     * `Australia/Perth` must keep meaning what it meant if they later move to
     * `Australia/Adelaide` — and without this column nothing could tell that the
     * August boundaries in the row were AWST ones.
     */
    timezone: text('timezone').notNull(),

    /** 1 for the first generation of a month, N+1 for each re-generation. */
    version: smallint('version').notNull(),

    /** When WE generated it — our clock, defaulted by the database. */
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * The five frozen documents. All `NOT NULL` — a report missing any of them
     * cannot be re-read as the thing that was sent, which is the only reason
     * this table exists.
     *
     *  figures    — the headline numbers, as integer cents and counts. Never
     *               floats: quotesChased, replies, jobsWonAttributed,
     *               jobsWonTotal, grossCents, conservativeCents, feesCents
     *               (monthly and setup separately), and the two multiples in
     *               basis points.
     *  lines      — one entry per attributed job: the client-recognisable
     *               evidence (job id, description, contact first name, when it
     *               was won, how many touches, first and last sent moments,
     *               replies, gross and conservative cents). NO message bodies
     *               and NO addresses — the client's customers' details are not
     *               ours to print in a document.
     *  baseline   — rate in basis points, source, sample size, the window it was
     *               measured over. The D-06 footnote's input.
     *  constants  — every constant the arithmetic used, so a reader can
     *               reproduce it: `{ attributionWindowDays,
     *               defaultBaselineWinRate, baselineMinQuotes }`. D-11's "every
     *               constant used", and the input to the drift warning above.
     *  fees       — the `tenant_fees` rows in force plus the pro-rating inputs,
     *               so the multiple's denominator is auditable after the
     *               schedule changes.
     */
    figures: jsonb('figures').$type<Record<string, unknown>>().notNull(),
    lines: jsonb('lines').$type<unknown[]>().notNull(),
    baseline: jsonb('baseline').$type<Record<string, unknown>>().notNull(),
    constants: jsonb('constants').$type<Record<string, unknown>>().notNull(),
    fees: jsonb('fees').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    /** THE VERSION ARBITER (D-11). See the header. */
    uniqueIndex('monthly_reports_version_uniq').on(
      table.tenantId,
      table.periodStart,
      table.version,
    ),

    pgPolicy('monthly_reports_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type MonthlyReport = typeof monthlyReports.$inferSelect;
export type NewMonthlyReport = typeof monthlyReports.$inferInsert;
