/**
 * GENERATE ONE MONTH'S REPORT — the write that freezes a document (D-11, RPT-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERYTHING THE PRINTED PAGE WILL EVER SAY IS DECIDED HERE, ONCE.         │
 * │ The page reads the row and computes nothing. This module is therefore    │
 * │ the only place where a figure, a per-job line, a baseline, a constant or │
 * │ a fee amount enters the document — and after `insertVersion` returns,    │
 * │ none of them can change.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THE REFUSALS COME FIRST, AND WHY THEY ARE VALUES ────────────────────
 *
 * Four things make a month unreportable, and none of them is an error: a month
 * that has not started, a client with no ServiceM8 connection, a month that
 * ended before we were connected, and a client with no monthly fee on file. All
 * four are ordinary operator situations with a named fix, so they come back as
 * a `kind` the action maps to a sentence — never as a throw, which would reach
 * the operator as an error digest and tell them nothing.
 *
 * A RECORDED `$0.00` MONTHLY FEE IS NOT ONE OF THEM (U-4). "No fee entered yet"
 * and "this client is on a deliberate $0.00 month" are different facts and are
 * never conflated: the first refuses and names the fix, the second generates a
 * real report whose return-on-fees is `—` and whose footnote says why. That
 * distinction is `hasMonthlyFeeInForce`'s, and it is read here rather than
 * re-derived.
 *
 * ── ONE TRANSACTION, ONE SNAPSHOT ───────────────────────────────────────────
 *
 * The counts, the attributions, the fee schedule and the insert all run inside
 * ONE `forTenant().transaction`. Not for write atomicity — there is a single
 * write — but so the six reads see one consistent snapshot. A `won` event
 * consumed between the attribution list and the win count would otherwise
 * produce a document whose own per-job table contradicts its own headline, on
 * the one page whose entire value is that it does not.
 *
 * ── THE 23505 IS CAUGHT OUTSIDE THE TRANSACTION, ON PURPOSE ─────────────────
 *
 * `reports.insertVersion` computes `COALESCE(MAX(version), 0) + 1` inside the
 * INSERT and `monthly_reports_version_uniq` arbitrates two concurrent generates
 * (07-01). The loser's raise ABORTS ITS TRANSACTION, so it is caught out here
 * where the rollback has already happened and there is nothing left to commit —
 * catching it inside would leave the callback returning a value into a
 * transaction Postgres has already condemned.
 */
import {
  ATTRIBUTION_WINDOW_DAYS,
  BASELINE_MIN_QUOTES,
  DEFAULT_BASELINE_WIN_RATE,
} from '@/core/audit/constants';
import { resolveBaseline } from '@/core/attribution/baseline';
import { attributionEvidenceSchema, truncateCodePoints } from '@/core/attribution/evidence';
import { forTenant, getProspect } from '@/db/repository';
import { asAttributionValueSource } from '@/db/schema';

import type {
  ReportBaselineDocument,
  ReportConstantsDocument,
  ReportFeesDocument,
  ReportLineDocument,
} from './document';
import { feesInForce, hasMonthlyFeeInForce, type FeeRow } from './fees';
import { reportDocumentsUnchanged } from './unchanged';
import { computeReportFigures } from './figures';
import { computeMissedCallFigures } from './missed-call-figures';
import { calendarMonth, localDateString } from './period';

/** The description cap the frozen line is held to. The evidence builder's number. */
const DESCRIPTION_MAX = 60;

/* ------------------------------------------------------------------------- *
 * The five frozen documents
 *
 * DECLARED IN `./document.ts`, A LEAF MODULE, AND RE-EXPORTED HERE.
 *
 * The split is the render-from-the-row mandate made structural: the printed page
 * has to PARSE the row it renders, and a zod schema is a value — so importing
 * the schemas from this module would give the page a value edge to the
 * GENERATOR, and `tests/monthly-report.test.ts` asserts there is none. Keeping
 * the shape in a leaf both modules import means the page can assert the document
 * without being able to reach the function that computed it.
 *
 * They are re-exported because this module is where a reader looks for "what
 * does a report row contain" — the generator is the only thing that ever writes
 * one.
 * ------------------------------------------------------------------------- */

export {
  reportBaselineSchema,
  reportConstantsSchema,
  reportFeesSchema,
  reportFiguresSchema,
  reportLineSchema,
  parseReportDocument,
} from './document';

export type {
  ReportBaselineDocument,
  ReportConstantsDocument,
  ReportDocument,
  ReportFeesDocument,
  ReportFiguresDocument,
  ReportLineDocument,
} from './document';

/* ------------------------------------------------------------------------- *
 * The result
 * ------------------------------------------------------------------------- */

/**
 * What one generate attempt produced. SEVEN ANSWERS, SIX OF THEM ORDINARY.
 *
 * Every non-`generated` arm is a situation with a named fix that the operator
 * can act on, which is why none of them is a throw. The action turns each into
 * one sentence (`generateRefusalMessage`); a genuine write failure is the only
 * thing that propagates as an exception.
 *
 * `unchanged` IS NEITHER A REFUSAL NOR A WRITE. It means the newest stored
 * version of this month already says exactly this, down to the byte, so nothing
 * was written and the operator is pointed at the version that already exists.
 * Its sentence rides the SUCCESS slot for that reason: nothing went wrong, and
 * the next act is the same one a write leads to — open it.
 */
export type GenerateReportResult =
  | { kind: 'generated'; reportId: string; version: number; periodStart: string }
  | { kind: 'unchanged'; reportId: string; version: number; periodStart: string }
  | { kind: 'future_month' }
  | { kind: 'not_connected' }
  | { kind: 'before_connection'; connectedAt: Date }
  | { kind: 'no_fee' }
  | { kind: 'concurrent' };

/** The month an operator picked, as the form hands it over. `month` is 1-based. */
export interface GenerateReportInput {
  year: number;
  month: number;
}

/**
 * SQLSTATE 23505 — the concurrent-generate arbiter's raise.
 *
 * Checked on the error AND on its `cause`: postgres.js raises a `PostgresError`
 * carrying `code`, and drizzle re-throws it directly today — but a wrapper that
 * moved it one level down would silently turn "somebody just generated this"
 * into "could not generate the report", and the operator would reload and find
 * a report they were told did not exist.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current != null && depth < 4; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}

/**
 * A frozen document on its way into a jsonb column typed `Record<string, unknown>`.
 *
 * The column type is deliberately open (07-01: a key constraint would make an
 * old report unreadable the first time the document gains a figure), and a TS
 * interface has no index signature, so the two do not meet without this. It is
 * a GENERIC so the argument is still checked against its own document type at
 * every call site — the widening happens at the column boundary and nowhere
 * else, which is the whole point of writing it down instead of casting inline.
 */
function asDocument<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

/** `tenant_fees` rows as the pure fee rules take them. */
function toFeeRows(
  rows: ReadonlyArray<{
    kind: string;
    amountCents: number;
    effectiveFrom: string;
    createdAt: Date;
  }>,
): FeeRow[] {
  return rows.map((row) => ({
    // The column is CHECK-constrained to this vocabulary in migration 0033, so
    // the cast asserts a database guarantee rather than a hope.
    kind: row.kind as FeeRow['kind'],
    amountCents: row.amountCents,
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
  }));
}

/**
 * The converted prospect's audit rate, in basis points — footnote 3's `null`-able
 * aside, resolved on the POOL before any transaction is open (07 WR-02).
 *
 * TWO READS, IN SEQUENCE, AND NEITHER HOLDS A TRANSACTION. It costs a tenant
 * read the transaction below repeats, which is the price of not holding two
 * connections per in-flight generate against a `max: 5` pool.
 *
 * EVERY FAILURE TO RESOLVE IS `null`, NOT A THROW. This value is a sentence on a
 * footnote, not an input to any figure (D-06) — an unparseable or absent audit
 * rate means the report simply does not mention the audit, which is strictly
 * better than refusing to generate a month over a number nothing is computed
 * from.
 */
async function resolveProspectRate(tenantId: string): Promise<number | null> {
  const [tenant] = await forTenant(tenantId).tenant.get();
  if (!tenant || tenant.prospectId === null) return null;

  const prospect = await getProspect(tenant.prospectId);
  const raw = prospect?.baselineWinRate ?? null;
  if (raw === null) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 10_000) : null;
}

/**
 * Freeze one calendar month as the next version of this client's report.
 *
 * `now` is a PARAMETER and not `new Date()` — the future-month refusal is a
 * comparison against it, and a rule whose boundary can only be exercised by
 * waiting is a rule with no test.
 */
export async function generateMonthlyReport(
  tenantId: string,
  input: GenerateReportInput,
  now: Date,
): Promise<GenerateReportResult> {
  try {
    // ── READ BEFORE THE TRANSACTION, NOT INSIDE IT (07 WR-02) ───────────────
    //
    // `max: 5` in `src/db/repository/client.ts` is a CEILING ON CONCURRENCY,
    // not a hint. A pool read issued while this call already holds a
    // transaction's connection makes each in-flight generate hold two, and at
    // three concurrent generates all five connections are held by transactions
    // each waiting for a sixth — a starvation deadlock that resolves only when
    // the statement timeout fires, and that does not look like a pool problem
    // from the outside. The report page, the /reports overview and the
    // per-minute tick share this pool in this process.
    //
    // Reading it FIRST is safe for the same reason the value is a footnote:
    // `prospects.baseline_win_rate` is an onboarding artefact that nothing on
    // this path writes, so there is no write inside the transaction that this
    // read could fail to see.
    const prospectRateBp = await resolveProspectRate(tenantId);

    return await forTenant(tenantId).transaction(async (repo) => {
      const [tenant] = await repo.tenant.get();
      if (!tenant) {
        // Not a refusal arm: the action authorized this tenant through RLS
        // before calling, so an absent row here is a programming error and must
        // not be dressed up as an operator situation with a fix.
        throw new Error('generateMonthlyReport: no such tenant.');
      }

      const timezone = tenant.timezone;
      const period = calendarMonth(timezone, input.year, input.month);

      // A month that has not begun. `>=` and not `>`: at the exact millisecond
      // a month starts there is nothing in it, and offering to report on it
      // would hand the operator an all-zero document to send a client.
      if (period.start.getTime() >= now.getTime()) return { kind: 'future_month' };

      const [connection] = await repo.connection.get();
      if (!connection) return { kind: 'not_connected' };

      // A month that ENDED before we connected. The comparison is on the
      // exclusive end, so the month we connected DURING still reports — it has
      // real, partial history in it, which is the honest thing to send.
      if (period.end.getTime() <= connection.createdAt.getTime()) {
        return { kind: 'before_connection', connectedAt: connection.createdAt };
      }

      const feeRowsRaw = await repo.fees.list();
      const feeRows = toFeeRows(feeRowsRaw);

      // MISSING is the refusal; a recorded $0.00 is a fact. See the header.
      if (!hasMonthlyFeeInForce(feeRows, period, timezone)) return { kind: 'no_fee' };

      const attributions = await repo.attributions.listForPeriod(period.start, period.end);
      const quotesChased = await repo.ledger.countQuotesChasedInPeriod(period.start, period.end);
      const replies = await repo.inbound.countThreadedInPeriod(period.start, period.end);
      const jobsWonTotal = await repo.events.countWonQuotesInPeriod(period.start, period.end);

      // ── THE MISSED-CALL BLOCK RIDES THE SAME TRANSACTION AND PERIOD (D-03) ──
      //
      // Counts only (no caller, no body), bucketed in the tenant's zone in SQL,
      // read on `repo` — the transaction's connection — so the block and the
      // quote figures describe one snapshot of one month. It is composed onto
      // the figures DOCUMENT below rather than inside `computeReportFigures`:
      // `figures.ts` returns the eleven quote figures and stays untouched, and
      // the twelfth key is added here, at the document boundary.
      const missedCallCounts = await repo.metrics.missedCallCounts(period, timezone);

      const fees = feesInForce(feeRows, period, timezone);

      const figures = computeReportFigures({
        attributions: attributions.map((row) => ({
          grossCents: row.grossCents,
          conservativeCents: row.conservativeCents,
          valueSource: asAttributionValueSource(row.valueSource),
        })),
        quotesChased,
        replies,
        jobsWonTotal,
        fees,
      });

      // IN `listForPeriod`'S ORDER, WHICH IS `won_detected_at ASC, quote_id ASC`
      // and is the order the printed table's rows appear in. Sorting again here
      // would put the print order in two places, and two renders of one frozen
      // report must not order a tie differently.
      const lines: ReportLineDocument[] = attributions.map((row) => {
        // 07-03's evidence builder already truncated and capped these. Parsed
        // and re-truncated anyway: this row is about to become permanent in a
        // document that leaves the building, and the chain it came from is a
        // jsonb column typed `Record<string, unknown>` — the one place where a
        // widened writer upstream would arrive here unannounced.
        const evidence = attributionEvidenceSchema.parse(row.evidence);

        return {
          attributionId: row.id,
          quoteId: row.quoteId,
          generatedJobId: evidence.generatedJobId,
          jobDescription:
            evidence.jobDescription === null
              ? null
              : truncateCodePoints(evidence.jobDescription, DESCRIPTION_MAX),
          contactFirstName: evidence.contactFirstName,
          wonDetectedAt: row.wonDetectedAt.toISOString(),
          touchCount: row.qualifyingTouchCount,
          firstTouchAt: row.firstTouchClaimedAt.toISOString(),
          lastTouchAt: row.lastTouchClaimedAt.toISOString(),
          replyCount: evidence.inbound.length,
          // Labels only — never the text beside them (T-7-20). A null label is
          // a reply nothing classified, and it is dropped rather than rendered
          // as the word "null" on a client's document.
          replyLabels: evidence.inbound
            .map((reply) => reply.label)
            .filter((label): label is string => label !== null),
          grossCents: row.grossCents,
          conservativeCents: row.conservativeCents,
          valueSource: asAttributionValueSource(row.valueSource),
        };
      });

      const resolved = resolveBaseline({
        winRate: connection.baselineWinRate,
        quotesIssued: connection.baselineQuotesIssued,
      });

      // THE PROSPECT RATE IS READ, NOT COMPUTED FROM (D-06). It exists on this
      // row so footnote 3 can say "your audit showed 18%; this report uses the
      // 25% measured when your account was connected" — the sentence that stops
      // a client noticing the discrepancy themselves. Resolved above, BEFORE
      // this transaction opened; see the note there.
      const baseline: ReportBaselineDocument = {
        rateBp: resolved.rateBp,
        source: resolved.source,
        sampleSize: resolved.sampleSize,
        windowStart: connection.baselineWindowStart,
        windowEnd: connection.baselineWindowEnd,
        prospectRateBp,
      };

      const constants: ReportConstantsDocument = {
        attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
        defaultBaselineWinRate: DEFAULT_BASELINE_WIN_RATE,
        baselineMinQuotes: BASELINE_MIN_QUOTES,
      };

      const feesDocument: ReportFeesDocument = {
        monthlyCents: fees.monthlyCents,
        setupCents: fees.setupCents,
        daysCharged: fees.daysCharged,
        daysInPeriod: fees.daysInPeriod,
        rows: feeRowsRaw.map((row) => ({
          kind: row.kind as FeeRow['kind'],
          amountCents: row.amountCents,
          effectiveFrom: row.effectiveFrom,
          createdAt: row.createdAt.toISOString(),
          note: row.note,
        })),
      };

      // LOCAL CALENDAR DATES, in the zone frozen beside them. `period.end` is
      // the next month's local midnight, so this stores `2026-09-01` for
      // August — exclusive, as the column's header says out loud. Computed ONCE
      // and read three times below: the value that is compared, the value that
      // is written and the value that is returned have to be the same string.
      const periodStart = localDateString(period.start, timezone);
      const periodEnd = localDateString(period.end, timezone);

      // ── THE OBJECT COMPARED IS THE OBJECT WRITTEN ───────────────────────────
      //
      // One `documents` const, passed to the comparator AND spread into the
      // insert. Building a second literal for the insert is precisely how a
      // comparison and a write drift apart: the day somebody adds a figure to
      // one of them, the comparator says "unchanged" about a document that did
      // change, and a correction is swallowed with the operator told the month
      // is already up to date.
      //
      // THE BLOCK IS PART OF THE COMPARED OBJECT, ON PURPOSE (D-03, research
      // Pitfall 6). `reportDocumentsUnchanged` sees `missedCalls` through
      // `documents`, so the first regenerate of any month stored before Phase 15
      // produces version N+1 and KEEPS N — a document that gained a block is a
      // changed document, and the client's copy of N stays readable as sent.
      const documents = {
        figures: asDocument({
          ...figures,
          missedCalls: computeMissedCallFigures(missedCallCounts),
        }),
        lines,
        baseline: asDocument(baseline),
        constants: asDocument(constants),
        fees: asDocument(feesDocument),
      };

      // ── IS THIS PRESS A DUPLICATE? (RPT-02) ─────────────────────────────────
      //
      // TWO READS, BOTH ON `repo` — THE TRANSACTION'S CONNECTION. A pool-side
      // `forTenant(tenantId).reports.…` here would hold a SECOND connection
      // while this transaction holds its first, and at three concurrent
      // generates all five connections in the `max: 5` pool are held by
      // transactions each waiting for a sixth (07 WR-02, and the note at the
      // top of this function).
      //
      // `latestVersionOf` is index-only — the same `(tenant_id, period_start,
      // version)` index the unique constraint already maintains. `byId` fetches
      // the five documents once, which costs exactly what rendering one report
      // page costs, and only when a version for this month already exists.
      //
      // CONCURRENCY: this check reads the SAME SNAPSHOT as the six reads above
      // it. A generate that commits an identical version between this check and
      // the insert is arbitrated exactly as it was before — `MAX(version) + 1`
      // is computed inside the INSERT and `monthly_reports_version_uniq` raises
      // 23505, which the catch below maps to `concurrent`. So the worst case
      // under a genuine race is ONE EXTRA IDENTICAL VERSION, which is today's
      // behaviour, and never a lost correction.
      const [latest] = await repo.reports.latestVersionOf(periodStart);
      if (latest) {
        const [previous] = await repo.reports.byId(latest.id);
        if (previous && reportDocumentsUnchanged(documents, previous)) {
          return {
            kind: 'unchanged',
            reportId: latest.id,
            version: latest.version,
            periodStart,
          };
        }
      }

      const [written] = await repo.reports.insertVersion({
        periodStart,
        periodEnd,
        timezone,
        ...documents,
      });

      if (!written) {
        // `insertVersion` is an INSERT with no ON CONFLICT clause: it either
        // returns a row or raises. An empty return is a contract break, not a
        // business outcome, and must not be reported as one.
        throw new Error('generateMonthlyReport: insertVersion returned no row.');
      }

      return {
        kind: 'generated',
        reportId: written.id,
        version: written.version,
        periodStart,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'concurrent' };
    throw error;
  }
}
