import Link from 'next/link';

import { TEXT_BACK_STUCK_MINUTES } from '@/core/leads/constants';
import { toLocalSpacedMobile } from '@/core/leads/mobile-spellings';
import type { LiveState } from '@/core/onboarding/checklist';
import { formatInTenantZone, NO_VALUE } from '@/core/shared/tenant';
import { forTenant, type MissedCallLogRow } from '@/db/repository';
import { TEXT_BACK_VARIANTS } from '@/db/schema';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../_auth';
import { LEAD_RESOLUTION_LABELS } from '../../components/lead-job-sheet';
import {
  AFTER_HOURS_LABEL,
  CALLER_KIND_LABELS,
  NUMBER_RETIRED_LABEL,
  resolveTextBackOutcome,
  type TextBackOutcomeTone,
} from '../../components/text-back-outcome';
import { CALLS_BEFORE_PARAM, formatCallsBefore, parseCallsBefore } from './missed-calls-cursor';

/**
 * THE CLIENT PAGE'S MISSED CALLS (Phase 15, CON-06 / D-02; UI-SPEC §2).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE GATED SECTION ON AN RLS PAGE. `clients/[id]/page.tsx` reads      │
 * │ through the operator's own JWT and selects no phone number (T-6-21).    │
 * │ This component DOES — `missedCalls.listForLog` returns each caller's    │
 * │ number — so its read runs only after `requireOperator()` returns `ok`,  │
 * │ for the one human allowed to read it. Listed in `GUARDED_PATHS`         │
 * │ (`tests/operator-authorization.test.ts`).                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THE NUMBER GOES INTO THE ROW'S JSX AND NOWHERE ELSE: never a log line, an
 * attribute, a link or a key. A landline's digits are not shown at all (D-02:
 * the number only for mobiles); a row the privacy pass stamped renders the
 * retired label, never its hash (D-06), and nothing here claims to mask.
 *
 * ITS FAILURE COSTS THE SECTION, NOT THE PAGE. Every read sits in one `try`;
 * the caught value is discarded (a driver error carries the statement and its
 * parameters are this client's callers) and one fixed string is logged. The
 * state line still renders from the props the page already holds.
 *
 * THE STATE LINE READS THE CHECKLIST'S OWN FACTS. The divert number and the
 * text-back live state arrive as props from the same `readGoLiveChecklist`
 * result the checklist card renders, so the line and the card cannot
 * disagree. Template attestation is the send path's own read
 * (`latestAttested`, the text-back page's rule): what goes out is what was
 * attested.
 *
 * PAGES ARE A KEYSET over `missed_calls_tenant_started_idx` (started_at DESC,
 * id DESC), twenty at a time — never a skip count, so a call arriving while the
 * operator scrolls cannot put a row on two pages. A malformed cursor is page
 * one (`missed-calls-cursor.ts`).
 */

/**
 * One phone screen is ~6 rows; 20 is three swipes and one query (UI-SPEC §2).
 * THE ONE PAGE SIZE (15-REVIEW WR-07): the read's `limit` and the "Show older
 * calls" test (`rows.length === PAGE_SIZE`) are two halves of one rule, so
 * both name this constant and neither is a literal.
 */
const PAGE_SIZE = 20;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const DAY_ONLY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

const TONE_CLASS: Record<TextBackOutcomeTone, string> = {
  ok: 'badge badge--ok',
  warn: 'badge badge--warn',
  error: 'badge badge--error',
  neutral: 'badge',
};

/** A closed lead's word on the link line. A map, never the raw status. */
const LEAD_STATUS_WORDS: Record<string, string> = {
  closed: 'closed',
  converted: 'booked',
  expired: 'expired',
};

export type MissedCallsSectionProps = {
  tenantId: string;
  timezone: string;
  /** `checklist.divert.numberE164` — the active divert number, or null. */
  divertNumber: string | null;
  /** `checklist.live.textBack` — the card's own live state. */
  textBackLive: LiveState;
  /** The page's raw `searchParams[CALLS_BEFORE_PARAM]`. */
  callsBefore: string | string[] | undefined;
  /** The page's one `now`. */
  now: Date;
};

/** The caller, by kind — the retired stamp first, so a hash can never render. */
function CallerLine({ row }: { row: MissedCallLogRow }) {
  if (row.pseudonymisedAt !== null) {
    return <span className="meta">{NUMBER_RETIRED_LABEL}</span>;
  }
  if (row.callerKind === 'mobile') {
    let spaced: string = NO_VALUE;
    if (row.callerE164 !== null) {
      try {
        spaced = toLocalSpacedMobile(row.callerE164);
      } catch {
        // A mobile row whose number is not a normalised AU mobile breaks the
        // schema's own CHECK; say nothing rather than render the raw value.
        spaced = NO_VALUE;
      }
    }
    return (
      <span className="meta">
        <strong>{spaced}</strong>
      </span>
    );
  }
  const word = CALLER_KIND_LABELS[row.callerKind as keyof typeof CALLER_KIND_LABELS];
  return <span className="meta">{word ?? NO_VALUE}</span>;
}

/** Where the call led: the open lead, the closed lead's word, or the quote. */
function LinkLine({ row, tenantId }: { row: MissedCallLogRow; tenantId: string }) {
  if (row.leadId !== null && row.leadStatus === 'open') {
    return (
      <span className="touch-meta muted">
        <Link href={`/leads#lead-${row.leadId}`}>Open lead →</Link>
      </span>
    );
  }
  if (row.leadId !== null && row.leadStatus !== null) {
    const status = LEAD_STATUS_WORDS[row.leadStatus];
    if (status !== undefined) {
      const resolution =
        row.leadClosedReason === null ? undefined : LEAD_RESOLUTION_LABELS[row.leadClosedReason];
      return (
        <span className="touch-meta muted">
          Lead {status}
          {resolution === undefined ? null : ` · ${resolution}`}
        </span>
      );
    }
  }
  if (row.textBackRoute === 'quote' && row.quoteId !== null) {
    return (
      <span className="touch-meta muted">
        <Link href={`/clients/${tenantId}/quotes/${row.quoteId}`}>Attached to the quote →</Link>
      </span>
    );
  }
  return null;
}

/**
 * The state line (UI-SPEC §2). `attestedOn` / `recentCount` are `undefined`
 * when the section's read failed — the parts it cannot vouch for are omitted,
 * not guessed.
 */
function StateLine({
  tenantId,
  divertNumber,
  textBackLive,
  attestedOn,
  recentCount,
}: {
  tenantId: string;
  divertNumber: string | null;
  textBackLive: LiveState;
  attestedOn?: string | null;
  recentCount?: number;
}) {
  return (
    <p className="muted meta">
      {divertNumber === null ? (
        <a href="#divert-number">No divert number — provision one above</a>
      ) : (
        `Divert number ${divertNumber}`
      )}
      {` · text-back ${textBackLive === 'not_armed' ? 'not armed' : 'armed'}`}
      {attestedOn === undefined ? null : attestedOn === null ? (
        ' · templates not attested'
      ) : (
        <>
          {' · '}
          <Link href={`/clients/${tenantId}/text-back`}>templates attested {attestedOn}</Link>
        </>
      )}
      {recentCount === undefined
        ? null
        : ` · ${recentCount} call${recentCount === 1 ? '' : 's'} in the last 30 days`}
    </p>
  );
}

function Heading({ timezone }: { timezone: string }) {
  return (
    <h2>
      Missed calls <span className="muted zone-note">times in {timezone}</span>
    </h2>
  );
}

export async function MissedCallsSection({
  tenantId,
  timezone,
  divertNumber,
  textBackLive,
  callsBefore,
  now,
}: MissedCallsSectionProps) {
  // THE GATE FIRST. Nothing below runs for a session that is not an operator.
  const access = await requireOperator();
  if (access !== 'ok') {
    return (
      <section id="missed-calls">
        <h2>Missed calls</h2>
        <p className="error" role="alert">
          {OPERATOR_DENIED_MESSAGE[access]}
        </p>
      </section>
    );
  }

  const cursor = parseCallsBefore(callsBefore);

  let rows: MissedCallLogRow[];
  let recentCount: number;
  let attestedAt: Date | null;
  try {
    const repo = forTenant(tenantId);
    const [attested, count, page] = await Promise.all([
      Promise.all(TEXT_BACK_VARIANTS.map((variant) => repo.textBackTemplates.latestAttested(variant))),
      repo.missedCalls.countInWindow(new Date(now.getTime() - THIRTY_DAYS_MS)),
      repo.missedCalls.listForLog({ before: cursor ?? undefined, limit: PAGE_SIZE }),
    ]);
    rows = page;
    recentCount = count;
    // The newest attestation of the three variants, or none.
    attestedAt = null;
    for (const [template] of attested) {
      const at = template?.attestedAt ?? null;
      if (at !== null && (attestedAt === null || at.getTime() > attestedAt.getTime())) {
        attestedAt = at;
      }
    }
  } catch {
    console.error('[client] missed calls read failed');
    return (
      <section id="missed-calls">
        <Heading timezone={timezone} />
        <StateLine tenantId={tenantId} divertNumber={divertNumber} textBackLive={textBackLive} />
        <p className="error" role="alert">
          Could not load the missed calls. Try again in a moment.
        </p>
      </section>
    );
  }

  const stuckAfterMs = TEXT_BACK_STUCK_MINUTES * 60_000;
  const last = rows.length === PAGE_SIZE ? rows[rows.length - 1] : undefined;

  return (
    <section id="missed-calls">
      <Heading timezone={timezone} />

      <StateLine
        tenantId={tenantId}
        divertNumber={divertNumber}
        textBackLive={textBackLive}
        attestedOn={attestedAt === null ? null : formatInTenantZone(attestedAt, timezone, DAY_ONLY)}
        recentCount={recentCount}
      />

      {cursor === null ? null : (
        <>
          <p className="muted meta">Calls before {formatInTenantZone(cursor.startedAt, timezone)}</p>
          <p>
            <Link className="button-quiet" href={`/clients/${tenantId}#missed-calls`}>
              ← Newest calls
            </Link>
          </p>
        </>
      )}

      {rows.length === 0 ? (
        cursor === null ? (
          <>
            <p className="muted">No diverted calls yet.</p>
            <p className="hint muted">
              {divertNumber === null
                ? "Provision a divert number above first — calls appear here once the tradie's phone diverts to it."
                : `Calls the tradie's phone diverts to ${divertNumber} appear here newest first, with whether a text went back and, if not, why.`}
            </p>
          </>
        ) : (
          <p className="muted">No older calls.</p>
        )
      ) : (
        <ul className="touch-list">
          {rows.map((row) => {
            const outcome = resolveTextBackOutcome(
              {
                textBackStatus: row.textBackStatus,
                textBackSkipReason: row.textBackSkipReason,
                deliveryStatus: row.deliveryStatus,
                startedAt: row.startedAt,
              },
              now,
              stuckAfterMs,
            );
            return (
              <li key={row.id}>
                <span className="touch-when touch-when--stack">
                  {formatInTenantZone(row.startedAt, timezone)}
                  {row.afterHours ? <span className="badge">{AFTER_HOURS_LABEL}</span> : null}
                  <span className={TONE_CLASS[outcome.tone]}>{outcome.word}</span>
                </span>
                <CallerLine row={row} />
                <LinkLine row={row} tenantId={tenantId} />
              </li>
            );
          })}
        </ul>
      )}

      {last === undefined ? null : (
        <p>
          <Link
            className="button-quiet"
            href={`/clients/${tenantId}?${CALLS_BEFORE_PARAM}=${encodeURIComponent(formatCallsBefore(last))}#missed-calls`}
          >
            Show older calls →
          </Link>
        </p>
      )}
    </section>
  );
}
