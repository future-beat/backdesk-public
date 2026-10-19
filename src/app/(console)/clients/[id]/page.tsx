import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';

import {
  formatContactDays,
  formatContactTime,
  formatInTenantZone,
  NO_VALUE,
} from '@/core/shared/tenant';
import { readGoLiveChecklist } from '@/core/onboarding/checklist';
import {
  formatRelative,
  groupRank,
  lastActivity,
  nextTouchForQuote,
  NEXT_TOUCH_STATE_LABELS,
  PIPELINE_GROUP_HEADINGS,
  PIPELINE_GROUPS,
  weeklyTouchCount,
  weekHorizon,
  type CadenceSnapshot,
  type LastActivity,
  type NextTouch,
  type PipelineGroup,
  type TouchSnapshot,
} from '@/core/pipeline/grouping';
import { deriveHealth, HEALTH_BADGE_CLASS, HEALTH_LABELS } from '@/core/sync/health';
import { syncOutcomeLabel } from '@/core/sync/outcomes';
import { forAllTenants_armedBySmsGlobal, listChannelAudit } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { labelGuess } from '../../components/label-guess';
import {
  ChecklistCard,
  type ChecklistCardArmedClient,
  type ChecklistCardAuditLine,
  type ChecklistCardItem,
} from './checklist-card';
import { AfterHoursEscalationForm } from './after-hours-escalation-form';
import { ConnectServiceM8Form } from './connect-form';
import { DivertNumberForm } from './divert-number-form';
import { EscalationPhoneForm } from './escalation-phone-form';
import { CALLS_BEFORE_PARAM } from './missed-calls-cursor';
import { MissedCallsSection } from './missed-calls-list';
import { TriageForm, type TriageQuote } from './triage-form';

export const metadata: Metadata = { title: 'Client' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many cycles the operator can see at a glance (02-UI-SPEC Screen 2). */
const RECENT_RUNS = 10;

/** The console has no generated database types yet; this is the read contract. */
type TenantRow = {
  id: string;
  name: string;
  trade_type: string;
  timezone: string;
  status: string;
  contact_hours_start: string | null;
  contact_hours_end: string | null;
  contact_days: number[] | null;
  escalation_phone: string | null;
  /** Phase 13, D-09 — hot leads outside contact hours: texted now, or held. */
  after_hours_escalation: boolean;
  created_at: string;
};

/**
 * The connection read contract.
 *
 * NOTE THE SELECT LIST WHEREVER THIS IS QUERIED: `key_last4` and never
 * `api_key_ciphertext`. The ciphertext is useless without the server-side key,
 * but a page prop is serialised into the HTML payload and into the client
 * router cache, and there is no reason for a credential envelope to be there at
 * all (threat T-2-02).
 */
type ConnectionRow = {
  key_last4: string;
  last_success_at: string | null;
  paused_at: string | null;
  status_reason: string | null;
  consecutive_failures: number;
};

/**
 * The pipeline read contract. NO ADDRESS, AND NO SERVICEM8 UUID (WR-06).
 *
 * Both used to be here and neither was ever read — see the select list's own
 * comment. The type is what keeps them out: a column added back to the query
 * without a consumer is a compile-time no-op, but a column added to THIS type
 * is a claim that something renders it.
 */
type QuoteRow = {
  id: string;
  generated_job_id: string | null;
  job_description: string | null;
  total_invoice_amount: string | null;
  quote_date_utc: string | null;
  status: string;
  chase_eligibility: string;
};

/** The triage read — open, live, and still awaiting an operator decision. */
type NeedsReviewRow = {
  id: string;
  generated_job_id: string | null;
  job_description: string | null;
  total_invoice_amount: string | null;
  quote_date_utc: string | null;
};

/**
 * The pipeline's cadence read — one query for every row on screen, never one
 * per row.
 *
 * A cadence per quote looks like an obvious `.map(fetch)` and is an N+1 against
 * a 500-row table: 500 round trips to Sydney to render one column. Keyed on the
 * visible quote ids, exactly as the contact read below already is.
 *
 * `id` is selected because the touch read below is keyed on it — `cadence_touches`
 * has no `quote_id`, and joining through the cadence is what keeps that read to
 * one round trip as well.
 */
type QuoteCadenceRow = {
  id: string;
  quote_id: string;
  status: string;
  pause_reason: string | null;
  stop_reason: string | null;
};

/** The touch facts a pipeline row needs. No draft, no body, no address. */
type QuoteTouchRow = {
  cadence_id: string;
  touch_number: number;
  status: string;
  scheduled_at: string;
};

/**
 * ── THE TWO ACTIVITY READS, AND WHAT THEIR SELECT LISTS DO NOT NAME (T-6-21) ─
 *
 * `body` is not selected. Not filtered out downstream, not truncated, not
 * masked: NOT SELECTED. Every column named here is serialised into this page's
 * HTML payload and into the client router cache, and a customer's words belong
 * on exactly two surfaces — the inbox and the quote page, both behind the
 * operator gate. This page is a scan surface an operator opens in a client's
 * kitchen, and the chips it renders are indicators.
 *
 * `to_address` is absent for the same reason on the sent side, and `from_address`
 * on the reply side: the chip says "sent 2 hours ago", and a phone number would
 * be a fact it does not use.
 */
type QuoteSendRow = {
  quote_id: string;
  claimed_at: string;
  outcome: string | null;
};

type QuoteReplyRow = {
  quote_id: string | null;
  received_at: string;
  label: string | null;
};

/**
 * The ledger outcomes that count as "we sent something" for the chip.
 *
 * A `failed` row is not a message the customer received, and a NULL outcome is a
 * send still in flight — neither is evidence of contact, and a `sent 2 hours
 * ago` chip over either one would tell an operator a conversation started that
 * did not. `stub_sent` IS counted, because in a stubbed environment it is the
 * only send there is; the quote page's ledger list is where a stub is labelled
 * as a stub, and it is one tap away.
 */
const SENT_OUTCOMES = ['sent', 'stub_sent'];

/**
 * SHORT reason labels for the row's state badge — deliberately shorter than the
 * quote page's version of the same facts.
 *
 * This one is scanned down a list at speed; that one is read while deciding
 * whether to kill a cadence. Two audiences, two lengths, and the long form
 * living on the page that has room for it.
 *
 * Maps rather than a `.replace('_', ' ')`, per the house rule the eligibility
 * labels below state: a vocabulary member added later must be VISIBLE as an
 * unknown rather than shipped to an operator in snake_case.
 */
const PAUSE_GLANCE_LABELS: Record<string, string> = {
  customer_reply: 'replied',
  client_paused: 'client paused',
  onboarding: 'not set up yet',
};

const STOP_GLANCE_LABELS: Record<string, string> = {
  won: 'won',
  lost: 'declined',
  removed: 'removed',
  reopened: 'reopened',
  contact_suppressed: 'contact suppressed',
  operator_closed: 'you closed it',
  no_contact: 'no contact',
  mirror_missing: 'record missing',
};

/**
 * WHY this row is where it is, in two or three words.
 *
 * `null` means there is nothing worth saying — an ordinary active cadence in
 * `Chasing` needs no badge repeating its own heading. A quote awaiting triage
 * has no cadence at all and would otherwise carry no state at all, which is the
 * one case where the absence of a badge would be the absence of the reason.
 */
function stateGlance(quote: QuoteRow, cadence: QuoteCadenceRow | null): string | null {
  if (cadence) {
    if (cadence.status === 'paused') {
      return cadence.pause_reason
        ? (PAUSE_GLANCE_LABELS[cadence.pause_reason] ?? cadence.pause_reason)
        : 'paused';
    }
    if (cadence.status === 'stopped') {
      return cadence.stop_reason
        ? (STOP_GLANCE_LABELS[cadence.stop_reason] ?? cadence.stop_reason)
        : 'stopped';
    }
    if (cadence.status === 'active') return null;
    return cadence.status;
  }

  // Through the SAME map the table's Eligibility column read from, so the
  // phrase an operator learns in the triage checklist below is the phrase the
  // badge above it uses.
  if (quote.status === 'Quote' && quote.chase_eligibility === 'needs_review') {
    return ELIGIBILITY_LABELS.needs_review;
  }
  return null;
}

/**
 * How many quotes the pipeline renders. A founding-cohort client's 90-day
 * backfill is well inside this; pagination is premature at this scale
 * (02-UI-SPEC overflow row) but an unbounded select is not something to ship
 * either.
 */
const QUOTE_LIMIT = 500;

/**
 * The evidence caps for the two keyed reads under the quote list.
 *
 * Neither is expected to bind at founding-cohort scale — a cadence carries a
 * handful of touches and only chase-eligible quotes have one at all — but an
 * unbounded `.in()` is a select whose size is decided by the data, and PostgREST
 * will happily cap it somewhere invisible. Both reads are ORDERED before the
 * limit so, if a cap ever binds, what it drops is the far end of the schedule
 * rather than the touch due this afternoon.
 */
const TOUCH_LIMIT = 2000;
const ACTIVITY_LIMIT = 2000;

/**
 * The eligibility vocabulary, rendered from a map rather than a `.replace()`.
 *
 * A `.replace('_', ' ')` at the render site means the string the operator reads
 * is derived from the database value by string surgery — so a new eligibility
 * state ships as a lowercase snake_case word in the UI and nobody notices. An
 * exhaustive map makes an unknown value visible as exactly that.
 */
const ELIGIBILITY_LABELS: Record<string, string> = {
  needs_review: 'needs review',
  eligible: 'eligible',
};

/**
 * TWO DIFFERENT EMPTY STATES, and the difference between them is the whole
 * value of this function (02-UI-SPEC Copywriting Contract).
 *
 *  - Never synced — the operator's next action is CONNECT, so the copy points
 *    at the form directly above.
 *  - Synced, genuinely nothing there. Saying "connect ServiceM8" here would
 *    send the operator to re-key a connection that is working perfectly.
 *
 * The third state this function used to carry — "a filter matched nothing" — is
 * gone with the filter itself (D-18): the pipeline shows the whole synced
 * history at once, with won and lost quotes inside the collapsed `Closed`
 * group, so there is no longer a slice the operator can be stranded in.
 *
 * NOTE WHAT THIS IS NOT. "This client has no quotes" and "this client has
 * quotes and none of them need you" are different answers, and the second one
 * belongs to the `Needs attention` group's own empty copy — which is why that
 * group renders even when it is empty and this sentence does not appear beside
 * it.
 */
function emptyQuotesCopy(connected: boolean): string {
  if (!connected) {
    return 'No quotes yet. Connect ServiceM8 above — the first sync runs within 5 minutes and pulls the last 90 days.';
  }
  return 'No quotes in the synced history.';
}

/**
 * One cycle's health-log row.
 *
 * `error_detail` is selected but is deliberately NOT rendered: it is a
 * classified kind, redundant with `outcome` by design, and rendering both would
 * make the table look like it is showing detail it is not. What the operator
 * gets is the classified outcome and the time — never a stack trace, never a
 * request header, never key material (T-2-16).
 */
type SyncRunRow = {
  id: string;
  started_at: string;
  outcome: string;
  jobs_fetched: number;
  jobs_upserted: number;
};

/**
 * `numeric` arrives from PostgREST as a STRING, deliberately — see
 * src/core/servicem8/normalize.ts. It is parsed for FORMATTING only, at the
 * last possible moment, and never fed back into any calculation.
 */
function formatMoney(value: string | null): string {
  if (value === null) return NO_VALUE;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NO_VALUE;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * The badge class for one cycle's outcome (02-UI-SPEC Screen 2).
 *
 * `auth_failed` is the only failure that stops the client dead, so it is the
 * only one that gets the error colour; the rest are weather and read as
 * warnings. Colour reinforces the label, which is always present.
 */
function runBadgeClass(outcome: string): string {
  if (outcome === 'ok') return 'badge badge--ok';
  if (outcome === 'auth_failed') return 'badge badge--error';
  return 'badge badge--warn';
}

/** One row of the pipeline: the quote, its current cadence, and what is next. */
type PipelineRowData = {
  quote: QuoteRow;
  cadence: QuoteCadenceRow | null;
  next: NextTouch | null;
  activity: LastActivity;
};

/**
 * "in 3 hours" up close, a wall-clock slot further out.
 *
 * The switch is the SAME horizon the weekly summary line counts to — one
 * constant asked twice rather than two sevens that agree until one changes. Up
 * close a relative label is what the operator is actually asking ("do I have
 * time before lunch"); a fortnight out it is noise and the date is the fact.
 */
function nextTouchWhen(next: NextTouch, timezone: string, now: Date): string {
  return next.scheduledAt.getTime() <= weekHorizon(now).getTime()
    ? formatRelative(next.scheduledAt, now)
    : formatInTenantZone(next.scheduledAt, timezone);
}

/**
 * A PIPELINE ROW — a `.touch-list` item, NOT a table row.
 *
 * The seven-column table this replaces could not hold what a pipeline row
 * carries: a next-touch line and last-activity chips are sentences, and a table
 * would push the fact the operator came for off the right-hand edge of a 390px
 * screen inside `.table-scroll`. This is the schedule list's "A LIST, NOT A
 * TABLE" decision applied to the surface that needed it more.
 *
 * The job number stays the tap target, for the reason the table stated: it is
 * the shortest, most stable cell, and a link wrapped around a truncated
 * description puts the target under an ellipsis.
 */
function PipelineQuoteRow({
  row,
  group,
  tenantId,
  timezone,
  now,
}: {
  row: PipelineRowData;
  group: PipelineGroup;
  tenantId: string;
  timezone: string;
  now: Date;
}) {
  const glance = stateGlance(row.quote, row.cadence);

  return (
    <li>
      <span className="touch-when">
        <strong>
          <Link href={`/clients/${tenantId}/quotes/${row.quote.id}`}>
            {row.quote.generated_job_id ?? 'Open'}
          </Link>
        </strong>
        {/* One line, with the full text in `title`. The whole description is on
            the quote page, one tap away (the established long-text rule). */}
        <span className="cell-truncate" title={row.quote.job_description ?? undefined}>
          {row.quote.job_description || NO_VALUE}
        </span>
      </span>

      <span className="touch-meta muted">
        {formatMoney(row.quote.total_invoice_amount)} ·{' '}
        {formatInTenantZone(row.quote.quote_date_utc, timezone, { dateStyle: 'medium' })}
      </span>

      {/* Colour reinforces the word; it never carries the meaning alone. Warn
          only inside `Needs attention`, where the heading already said so. */}
      {glance ? (
        <span className={group === 'needs_attention' ? 'badge badge--warn' : 'badge'}>
          {glance}
        </span>
      ) : null}

      {row.next ? (
        <span className="touch-line muted">
          Next: <strong>#{row.next.touchNumber}</strong>{' '}
          {nextTouchWhen(row.next, timezone, now)} ·{' '}
          {NEXT_TOUCH_STATE_LABELS[row.next.state]}
        </span>
      ) : null}

      {/* ── D-19 CHIPS: INDICATORS, NEVER CONTENT ──────────────────────────
          Each renders only when its fact EXISTS — no placeholder chip, for the
          reason the nav badge hides its zero: a pill on every row is noise that
          trains the eye past the rows that carry one.

          NEITHER CHIP CAN RENDER A MESSAGE BODY. `row.activity` has no field for
          one and the reads that built it never selected the column (T-2-02,
          T-6-21). Bodies live on the quote page and the inbox. */}
      {row.activity.lastSentAt || row.activity.lastReply ? (
        <span className="touch-line">
          {row.activity.lastSentAt ? (
            <span className="badge">sent {formatRelative(row.activity.lastSentAt, now)}</span>
          ) : null}
          {row.activity.lastReply ? (
            <span className="badge">
              reply {formatRelative(row.activity.lastReply.at, now)}
              {/* A GUESS STAYS PHRASED AS A GUESS on every surface — the inbox's
                  own words, from the module both surfaces import. */}
              {row.activity.lastReply.label
                ? ` — ${labelGuess(row.activity.lastReply.label)}`
                : ''}
            </span>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // 2026-10 (Phase 15, 15-05): the missed-call log's keyset cursor, and
  // nothing else. Passed through RAW — the section parses it.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const callsBefore = (await searchParams)[CALLS_BEFORE_PARAM];

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked before the query. A guessed-but-wrong uuid falls
  // through to the RLS-scoped read below and comes back empty.
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();

  // The AUTHENTICATED client, so the tenants policy decides visibility: a
  // tenant this operator is not a member of returns zero rows, indistinguishable
  // from one that does not exist (threat T-03-02).
  const { data, error } = await supabase
    .from('tenants')
    .select(
      'id, name, trade_type, timezone, status, contact_hours_start, contact_hours_end, contact_days, escalation_phone, after_hours_escalation, created_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // A genuine failure is not a 404 — saying "not found" here would send the
    // operator looking for a client that exists. But the message itself never
    // reaches the page (WR-08, T-2-02/T-2-16): a PostgREST error can carry
    // column names, constraint names, SQLSTATE detail and the internals of
    // has_tenant_access(). The code goes to the log; the page gets a fixed
    // sentence, which is all "a genuine failure is not a 404" ever needed.
    console.error(`[clients] tenant read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Client</h1>
        <p className="error" role="alert">
          Could not load this client. Try again in a moment.
        </p>
        <p>
          <Link href="/">Back to clients</Link>
        </p>
      </section>
    );
  }

  const tenant = data as TenantRow | null;
  if (!tenant) {
    notFound();
  }

  const hours = `${formatContactTime(tenant.contact_hours_start)}–${formatContactTime(
    tenant.contact_hours_end,
  )}`;

  // All three reads go through the AUTHENTICATED client, so the same policies
  // that govern the tenant row govern these. An error is tolerated rather than
  // fatal: a broken connection read must not take the client profile down with
  // it — the operator came here to see the client, and half a page beats none.
  // The WHOLE synced history in one read (D-18). The `?status=` filter is gone:
  // the grouping is what separates "what needs chasing" from "what happened",
  // and `Closed` — collapsed — is where the won and lost quotes live.
  const quotesQuery = supabase
    .from('quotes')
    // ── NO `job_address`, AND NO `sm8_job_uuid` (WR-06, T-2-02). ───────────
    //
    // Both were selected and NEITHER was ever rendered — the row shows a job
    // id, a description, money and dates. A customer's physical address was
    // therefore serialised into this page's HTML payload and into the client
    // router cache with no consumer at all, on the one surface this file's own
    // comments describe as "a scan surface an operator opens in a client's
    // kitchen". It is the same rule `key_last4` follows above and the same one
    // the two activity reads follow below: a column that nothing renders is a
    // column that is not selected. `job_address` stays on the quote DETAIL
    // page, which renders it.
    .select(
      'id, generated_job_id, job_description, total_invoice_amount, quote_date_utc, status, chase_eligibility',
    )
    .eq('tenant_id', tenant.id)
    // Deleted upstream stays out of the pipeline entirely: a job the tradie
    // removed from ServiceM8 is not part of the history they would recognise,
    // and showing it would invite the operator to make it chase-eligible
    // (Pitfall 6 — we keep the row, we do not surface it).
    .eq('sm8_active', true);

  const [connectionResult, quotesResult, runsResult, needsReviewResult] = await Promise.all([
    supabase
      .from('sm8_connections')
      .select('key_last4, last_success_at, paused_at, status_reason, consecutive_failures')
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    quotesQuery
      // Newest quote first, with `id` breaking the tie — two quotes issued the
      // same day must not swap places between renders, or the operator ticks a
      // checkbox in a list that reordered underneath them.
      .order('quote_date_utc', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(QUOTE_LIMIT),
    supabase
      .from('sync_runs')
      .select('id, started_at, outcome, jobs_fetched, jobs_upserted')
      .eq('tenant_id', tenant.id)
      .order('started_at', { ascending: false })
      .limit(RECENT_RUNS),
    // Triage is read INDEPENDENTLY OF THE FILTER, on purpose. It is an
    // outstanding task, not a view of the current slice — an operator who
    // switched to `Won` to check something must not find the checklist gone,
    // and must not have to remember which filter it lives under.
    supabase
      .from('quotes')
      .select('id, generated_job_id, job_description, total_invoice_amount, quote_date_utc')
      .eq('tenant_id', tenant.id)
      .eq('status', 'Quote')
      .eq('sm8_active', true)
      .eq('chase_eligibility', 'needs_review')
      .order('quote_date_utc', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(QUOTE_LIMIT),
  ]);

  const connection = (connectionResult.data as ConnectionRow | null) ?? null;
  const visibleQuotes = (quotesResult.data as QuoteRow[] | null) ?? [];
  const runs = (runsResult.data as SyncRunRow[] | null) ?? [];

  // Formatted HERE, in the client's timezone and en-AU currency, so the
  // checklist and the table above it cannot render the same quote two ways.
  const triageQuotes: TriageQuote[] = (
    (needsReviewResult.data as NeedsReviewRow[] | null) ?? []
  ).map((quote) => ({
    id: quote.id,
    jobId: quote.generated_job_id ?? NO_VALUE,
    description: quote.job_description || NO_VALUE,
    value: formatMoney(quote.total_invoice_amount),
    quoteDate: formatInTenantZone(quote.quote_date_utc, tenant.timezone, {
      dateStyle: 'medium',
    }),
  }));

  // The cadence and touch facts for the rows actually on screen, not for the
  // whole tenant. Read second because they need the quote ids — and scoped to
  // them, so a client with a long synced history does not pay for the rows
  // off-page.
  //
  // THE CONTACT READ IS GONE with the seven-column table (D-18). The pipeline
  // row shape carries a next-touch line and activity chips instead, and the
  // customer's name lives on the quote page where the decision that needs it is
  // made — one fewer round trip, and one fewer customer identifier on a surface
  // whose whole job is to be scanned in public.
  const cadenceByQuote = new Map<string, QuoteCadenceRow>();
  const touchesByQuote = new Map<string, TouchSnapshot[]>();
  const activityByQuote = new Map<string, LastActivity>();
  if (visibleQuotes.length > 0) {
    // Newest first, so the FIRST row seen for a quote wins below. A quote may
    // legitimately have had sequential cadences (reopened → re-triaged → a fresh
    // one), and the pipeline must show the current one, not the first.
    const { data: cadenceRows } = await supabase
      .from('cadences')
      .select('id, quote_id, status, pause_reason, stop_reason')
      .eq('tenant_id', tenant.id)
      .in(
        'quote_id',
        visibleQuotes.map((quote) => quote.id),
      )
      .order('created_at', { ascending: false });

    for (const cadence of (cadenceRows as QuoteCadenceRow[] | null) ?? []) {
      if (!cadenceByQuote.has(cadence.quote_id)) cadenceByQuote.set(cadence.quote_id, cadence);
    }

    // The touches behind the next-touch line and the weekly count (D-20).
    //
    // Keyed on the CURRENT cadences only — `cadence_touches` carries no
    // `quote_id`, and reading through the superseded cadence of a reopened
    // quote would put a schedule the engine abandoned on screen beside a live
    // one. One round trip for every row on the page.
    const cadenceIds = [...cadenceByQuote.values()].map((cadence) => cadence.id);
    const quoteByCadence = new Map(
      [...cadenceByQuote.entries()].map(([quoteId, cadence]) => [cadence.id, quoteId]),
    );

    if (cadenceIds.length > 0) {
      const { data: touchRows } = await supabase
        .from('cadence_touches')
        .select('cadence_id, touch_number, status, scheduled_at')
        .eq('tenant_id', tenant.id)
        .in('cadence_id', cadenceIds)
        .order('scheduled_at', { ascending: true })
        .limit(TOUCH_LIMIT);

      for (const touch of (touchRows as QuoteTouchRow[] | null) ?? []) {
        const quoteId = quoteByCadence.get(touch.cadence_id);
        if (!quoteId) continue;
        const list = touchesByQuote.get(quoteId) ?? [];
        list.push({
          touchNumber: touch.touch_number,
          status: touch.status,
          // Parsed HERE, once, so the pure derivations below take instants
          // rather than strings and cannot each pick their own parse.
          scheduledAt: new Date(touch.scheduled_at),
        });
        touchesByQuote.set(quoteId, list);
      }
    }

    // The D-19 chips. Two keyed reads, ordered newest-first so a bound cap drops
    // the OLDEST evidence — which is the half these chips do not show.
    const quoteIds = visibleQuotes.map((quote) => quote.id);

    const [sendResult, replyResult] = await Promise.all([
      supabase
        .from('send_ledger')
        .select('quote_id, claimed_at, outcome')
        .eq('tenant_id', tenant.id)
        .in('quote_id', quoteIds)
        .order('claimed_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
      supabase
        .from('inbound_messages')
        .select('quote_id, received_at, label')
        .eq('tenant_id', tenant.id)
        .in('quote_id', quoteIds)
        .order('received_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
    ]);

    const sentByQuote = new Map<string, { at: Date }[]>();
    for (const row of (sendResult.data as QuoteSendRow[] | null) ?? []) {
      if (!row.outcome || !SENT_OUTCOMES.includes(row.outcome)) continue;
      const list = sentByQuote.get(row.quote_id) ?? [];
      list.push({ at: new Date(row.claimed_at) });
      sentByQuote.set(row.quote_id, list);
    }

    const repliesByQuote = new Map<string, { at: Date; label: string | null }[]>();
    for (const row of (replyResult.data as QuoteReplyRow[] | null) ?? []) {
      // A reply the threader could not attribute to a quote has a NULL
      // `quote_id`. It belongs to the inbox, which is where an operator triages
      // it — hanging it off an arbitrary row here would be a guess wearing a
      // chip's clothes.
      if (!row.quote_id) continue;
      const list = repliesByQuote.get(row.quote_id) ?? [];
      list.push({ at: new Date(row.received_at), label: row.label });
      repliesByQuote.set(row.quote_id, list);
    }

    for (const quoteId of quoteIds) {
      activityByQuote.set(
        quoteId,
        lastActivity(sentByQuote.get(quoteId) ?? [], repliesByQuote.get(quoteId) ?? []),
      );
    }
  }

  // ONB-04 / D-16. Read through the SERVICE-ROLE core rather than re-queried
  // here with the operator's client, deliberately: this list must be the same
  // six answers the activation gate gives, and a second set of queries in this
  // file is the second derivation the card's header refuses. The operator's
  // entitlement to see this client was already established by the RLS-scoped
  // `tenants` read above — the same order `connectServiceM8Action` uses.
  //
  // The render's single `now` is passed in, so the staleness badge and anything
  // else derived below cannot disagree by a few milliseconds of clock drift
  // (06-03's server-side urgency rule, one page over).
  //
  // ── AND IT IS TOLERATED, LIKE EVERY OTHER READ ON THIS PAGE (WR-08). ─────
  //
  // This was the one unguarded await on a page whose own rule three hundred
  // lines up is "half a page beats none" — the connection, quotes and runs
  // reads all degrade. `readGoLiveChecklist` fans out to NINETEEN parallel reads
  // through the service-role core (and one third-party domain check), so it is
  // the MOST likely of them to throw, and an unhandled throw here is a blank
  // error boundary on the one screen that carries the activation gate. The
  // operator came to see the client; a checklist that cannot be read must cost
  // them the checklist, not the page.
  //
  // THE AUDIT READS RIDE THE SAME TRY, and deliberately: the arming controls
  // and the history of what was armed are one section. A card that rendered its
  // switches beside an empty history would read as "nobody has ever touched
  // this", which is the one thing the audit rows exist to be able to deny.
  const now = new Date();
  let checklist: Awaited<ReturnType<typeof readGoLiveChecklist>> | null = null;
  let armedClients: ChecklistCardArmedClient[] = [];
  let smsAudit: ChecklistCardAuditLine[] = [];
  let emailAudit: ChecklistCardAuditLine[] = [];
  let textBackAudit: ChecklistCardAuditLine[] = [];
  try {
    const [readChecklist, armedBySmsGlobal, smsRows, emailRows, textBackRows] = await Promise.all([
      readGoLiveChecklist(tenant.id, now),
      // WHO THE SHARED SMS ROW ARMS (10-03, D-03) — named in the warning the
      // operator reads between the two taps. It rides this try for the reason
      // the audit reads do: a control whose warning could not name its blast
      // radius must not be rendered at all, and the card is what carries it.
      forAllTenants_armedBySmsGlobal(),
      // The SHARED row's history belongs on every client page: every client is
      // affected by it, and it has no page of its own.
      listChannelAudit('sms', { tenantId: tenant.id, includeGlobal: true }, 3),
      // Email is per-client, so another client's arming is none of this page's
      // business.
      listChannelAudit('email', { tenantId: tenant.id, includeGlobal: false }, 3),
      // TEXT-BACK IS PER CLIENT (D-09) — and there is no global text-back row
      // for a history to include. Its rows include the system auto-disarm
      // (D-21), shown as "system" with its reason.
      listChannelAudit('text_back', { tenantId: tenant.id, includeGlobal: false }, 3),
    ]);

    checklist = readChecklist;
    armedClients = armedBySmsGlobal;
    // FORMATTED HERE, in the CLIENT's zone, like every other date this page
    // hands the card — the card is a client component and the browser's zone is
    // the operator's, not the tradie's.
    const toLine = (row: Awaited<ReturnType<typeof listChannelAudit>>[number]) => ({
      action: row.action === 'arm' ? ('arm' as const) : ('disarm' as const),
      on: formatInTenantZone(row.createdAt, tenant.timezone, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      scope: row.tenantId === null ? ('every client' as const) : ('this client' as const),
      // D-21: anything but the literal 'system' is an operator's row.
      actor: row.actor === 'system' ? ('system' as const) : ('operator' as const),
      reason: row.reason,
    });
    smsAudit = smsRows.map(toLine);
    emailAudit = emailRows.map(toLine);
    textBackAudit = textBackRows.map(toLine);
  } catch {
    // The caught value is discarded, not logged, for this file's usual reason:
    // a driver error carries the statement and this one's parameters are the
    // client's own rows.
    console.error('[clients] onboarding checklist read failed');
  }

  // ONE derivation, feeding BOTH the banner and the badge. They read the same
  // fields of the same row, so they cannot contradict each other — which is the
  // whole reason health is derived rather than stored (D-07).
  const health = deriveHealth(
    connection
      ? {
          pausedAt: connection.paused_at,
          statusReason: connection.status_reason,
          consecutiveFailures: connection.consecutive_failures,
          lastSuccessAt: connection.last_success_at,
        }
      : null,
  );

  /**
   * ── THE D-18 PIPELINE, FROM THE RENDER'S ONE CLOCK ────────────────────────
   *
   * NOTHING ABOUT THE GROUPING IS DECIDED IN THE JSX BELOW. `groupRank` is pure
   * and lives in `@/core/pipeline/grouping`, where the order is an exported
   * array and the rank is assertable without a browser; the render walks
   * `PIPELINE_GROUPS` and prints what the rank put in each bucket. A page that
   * decided its own order would be the second statement of a decision, and the
   * pair stays correct exactly until somebody reorders one of them.
   *
   * The same `now` the checklist's staleness badge used, for 06-03's reason: two
   * clocks a few milliseconds apart can put a stalled badge beside a next-touch
   * line that disagrees with it.
   */
  const grouped: Record<PipelineGroup, PipelineRowData[]> = {
    needs_attention: [],
    chasing: [],
    waiting: [],
    closed: [],
  };
  let weeklyTouches = 0;

  for (const quote of visibleQuotes) {
    const cadenceRow = cadenceByQuote.get(quote.id) ?? null;
    const touches = touchesByQuote.get(quote.id) ?? [];
    const cadence: CadenceSnapshot | null = cadenceRow
      ? {
          status: cadenceRow.status,
          pauseReason: cadenceRow.pause_reason,
          stopReason: cadenceRow.stop_reason,
        }
      : null;

    const group = groupRank(
      {
        quoteStatus: quote.status,
        chaseEligibility: quote.chase_eligibility,
        cadence,
        touches,
      },
      now,
    );

    weeklyTouches += weeklyTouchCount(touches, now);
    grouped[group].push({
      quote,
      cadence: cadenceRow,
      next: nextTouchForQuote(touches, now),
      activity: activityByQuote.get(quote.id) ?? { lastSentAt: null, lastReply: null },
    });
  }

  return (
    <section>
      <p className="muted">
        <Link href="/">← Clients</Link>
      </p>

      <div className="row">
        <h1>{tenant.name}</h1>
        <span className="badge">{tenant.status}</span>
      </div>

      {/* Directly under the h1 row, persistent, not dismissible. It clears when
          the underlying condition does — a verified re-key — and by no other
          means (D-05/D-08). */}
      {health === 'auth-failed' ? (
        <div className="banner-error" role="alert">
          <h2>ServiceM8 connection failed — follow-ups paused.</h2>
          <p>
            The API key was rejected on{' '}
            {formatInTenantZone(connection?.paused_at ?? null, tenant.timezone)}. Save a new
            key below to verify and resume automatically.
          </p>
        </div>
      ) : null}

      <dl className="profile">
        <dt>Trade type</dt>
        <dd>{tenant.trade_type}</dd>

        <dt>Timezone</dt>
        <dd>{tenant.timezone}</dd>

        <dt>Contact hours</dt>
        <dd>
          {hours} <span className="muted">({tenant.timezone})</span>
        </dd>

        <dt>Contact days</dt>
        <dd>{formatContactDays(tenant.contact_days)}</dd>

        <dt>Escalation phone</dt>
        {/* "Not set" rather than the em-dash every other empty cell uses: this
            one is not a missing FACT, it is a missing SETTING with a control
            directly below it, and the two readings need different words. */}
        <dd>{tenant.escalation_phone ?? 'Not set'}</dd>

        <dt>After-hours escalation</dt>
        {/* D-09. Off: a hot lead outside contact hours waits for the window to
            open. Emergencies and URGENT replies are sent at once either way. */}
        <dd>{tenant.after_hours_escalation ? 'On' : 'Off'}</dd>

        <dt>Created</dt>
        <dd>{formatInTenantZone(tenant.created_at, tenant.timezone)}</dd>
      </dl>

      {/* CON-03. Collapsed — checking the number is the common act, changing it
          is rare, and an always-open input beside a working number is an
          invitation to paste the wrong client's (the `Replace key` argument). */}
      <EscalationPhoneForm tenantId={tenant.id} current={tenant.escalation_phone} />

      {/* Phase 13, D-09. Directly below the number it decides the timing of;
          collapsed for the same reason — set once at onboarding. */}
      <AfterHoursEscalationForm tenantId={tenant.id} current={tenant.after_hours_escalation} />

      {/* CAP-01 / D-08. Directly above the checklist whose "Provision it →"
          link lands on it. It reads the SAME `divert` block the card renders,
          so the section and the row can never disagree about whether a number
          exists. When the checklist could not be read, neither renders: a buy
          control drawn without knowing the row's state is the one this page
          must never show. */}
      {checklist ? (
        <DivertNumberForm
          tenantId={tenant.id}
          tenantName={tenant.name}
          current={{
            numberE164: checklist.divert.numberE164,
            status: checklist.divert.status,
            spokenName: checklist.divert.spokenName,
            failureCode: checklist.divert.failureCode,
            // WR-07: how long a pending claim has stood, in whole minutes —
            // computed here on the server, with the page's one `now`.
            claimedMinutesAgo:
              checklist.divert.status === 'pending' && checklist.divert.statusSince
                ? Math.max(
                    0,
                    Math.floor((now.getTime() - checklist.divert.statusSince.getTime()) / 60_000),
                  )
                : null,
          }}
        />
      ) : null}

      {/* Directly after the profile dl (06-UI-SPEC §3 section order). It is the
          first thing an operator opening a client wants to know, and it is the
          only place the ONB-04 attestation can be recorded. */}
      {checklist ? (
        <ChecklistCard
          tenantId={tenant.id}
          items={checklist.items as ChecklistCardItem[]}
          attestation={{
            // FORMATTED HERE, in the CLIENT's zone — the card is a client
            // component and must never build a date from a raw instant, because
            // the browser's zone is the operator's and this date belongs to the
            // tradie's business (the one-zone rule this page already follows).
            attestedOn: checklist.attestation.attestedAt
              ? formatInTenantZone(checklist.attestation.attestedAt, tenant.timezone, {
                  dateStyle: 'medium',
                })
              : null,
            note: checklist.attestation.note,
            isStale: checklist.attestation.isStale,
          }}
          arming={checklist.arming}
          armedClients={armedClients}
          audit={{ sms: smsAudit, email: emailAudit, textBack: textBackAudit }}
          proofs={{
            // FORMATTED HERE for the same reason the attestation date is: the
            // card is a client component, and a date built in the browser would
            // be built in the OPERATOR's zone while this one belongs to the
            // tradie's business.
            escalationHandset: checklist.proofs.escalationHandset
              ? {
                  recordedOn: formatInTenantZone(
                    checklist.proofs.escalationHandset.recordedAt,
                    tenant.timezone,
                    { dateStyle: 'medium' },
                  ),
                  artefactId: checklist.proofs.escalationHandset.artefactId,
                }
              : null,
            emailPipe: checklist.proofs.emailPipe
              ? {
                  recordedOn: formatInTenantZone(
                    checklist.proofs.emailPipe.recordedAt,
                    tenant.timezone,
                    { dateStyle: 'medium' },
                  ),
                  artefactId: checklist.proofs.emailPipe.artefactId,
                }
              : null,
            divertVerification: checklist.proofs.divertVerification
              ? {
                  recordedOn: formatInTenantZone(
                    checklist.proofs.divertVerification.recordedAt,
                    tenant.timezone,
                    { dateStyle: 'medium' },
                  ),
                  artefactId: checklist.proofs.divertVerification.artefactId,
                }
              : null,
            textBack: checklist.proofs.textBack
              ? {
                  recordedOn: formatInTenantZone(
                    checklist.proofs.textBack.recordedAt,
                    tenant.timezone,
                    { dateStyle: 'medium' },
                  ),
                  artefactId: checklist.proofs.textBack.artefactId,
                }
              : null,
          }}
          // DERIVED BY THE CORE (D-01). The page passes it through untouched;
          // re-deriving "armed and proven" here would be the second reading of
          // the rule, and the second reading is the one that says Live while the
          // channel is off.
          live={checklist.live}
          // DIVERT HEALTH (CAP-05, D-09). The last-call instant is formatted
          // here in the CLIENT's zone; `daysSinceLastCall` is the core's floored
          // count, derived at read time and passed through — never stored and
          // never recomputed in the browser.
          divert={{
            numberE164: checklist.divert.numberE164,
            status: checklist.divert.status,
            lastCallOn: checklist.divert.lastCallAt
              ? formatInTenantZone(checklist.divert.lastCallAt, tenant.timezone, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : null,
            daysSinceLastCall: checklist.divert.daysSinceLastCall,
          }}
        />
      ) : (
        /* THE READ FAILED, AND THE SECTION STAYS (WR-08). The `ready-to-send`
           id is the anchor a gated-cadence refusal on the quote page links to
           ("record it on the client page"), so dropping the element entirely
           would turn that link into a scroll to nowhere. It says it does not
           know rather than showing six rows it cannot vouch for — a checklist
           that guessed is the one thing this card's header forbids. */
        <section id="ready-to-send" className="draft-card">
          <h2>Ready to send?</h2>
          <p className="error" role="alert">
            Could not load this client&rsquo;s readiness checks. Everything else on this page is
            current — reload to try again.
          </p>
        </section>
      )}

      {/* ABOVE the connection block, because it is the other half of onboarding
          and the one with no other route to it. A connected ServiceM8 account
          with no approved wording produces cadences that are born paused
          (ONB-03) — the operator needs to be able to get from a client they just
          connected to the page that makes them able to send, without knowing a
          URL. */}
      <p className="meta">
        <Link href={`/clients/${tenant.id}/drafting`}>Voice &amp; templates →</Link>
      </p>

      {/* Beside its sibling for the same reason (12-06): the attested text-back
          wording and the client's own lines are both arming preconditions, and
          neither should need a typed URL to reach. */}
      <p className="meta">
        <Link href={`/clients/${tenant.id}/text-back`}>
          Text-back templates and never-text list →
        </Link>
      </p>

      {/* A LINK AND NOTHING ELSE (D-14). The pipeline page answers "what is
          happening with this client's quotes"; the reports page answers "is the
          service keeping its promises" — and putting the second question's
          numbers here would mean two screens computing them. */}
      <p className="meta">
        <Link href={`/reports/${tenant.id}`}>Reports &amp; metrics →</Link>
      </p>

      {/* The id is the checklist's `Set it up →` target for an unconnected
          client — the unmet row lands the operator on the form that fixes it. */}
      <section id="servicem8-connection">
        <h2>ServiceM8 connection</h2>

        {connection ? (
          <>
            <div className="row">
              {/* last4 ONLY. The plaintext key does not exist after connect, and
                  the ciphertext is never selected into this page. */}
              <p className="meta">Connected — key ending in {connection.key_last4}</p>
              <span className={HEALTH_BADGE_CLASS[health]}>{HEALTH_LABELS[health]}</span>
            </div>
            <p className="muted meta">
              Last successful sync:{' '}
              {connection.last_success_at
                ? formatInTenantZone(connection.last_success_at, tenant.timezone)
                : 'never'}
            </p>

            {/* Collapsed by default: on a healthy client this control is noise,
                and an always-visible key field next to a working connection is
                an invitation to paste the wrong client's key. Open by default
                when the client is broken, because then it IS the task. */}
            <details className="disclosure" open={health === 'auth-failed'}>
              <summary>Replace key</summary>
              <ConnectServiceM8Form tenantId={tenant.id} mode="rekey" />
            </details>
          </>
        ) : (
          <ConnectServiceM8Form tenantId={tenant.id} />
        )}
      </section>

      <section>
        <h2>
          Quotes <span className="muted zone-note">times in {tenant.timezone}</span>
        </h2>

        {/* D-20. Under the h2, before the groups — the one number that says how
            heavy the week is before the operator reads a single row. */}
        <p className="muted meta">
          {weeklyTouches} touch{weeklyTouches === 1 ? '' : 'es'} scheduled this week
        </p>

        {visibleQuotes.length === 0 ? (
          <p className="muted">{emptyQuotesCopy(connection !== null)}</p>
        ) : (
          PIPELINE_GROUPS.map((group) => {
            const rows = grouped[group];

            const list = (
              <ul className="touch-list">
                {rows.map((row) => (
                  <PipelineQuoteRow
                    key={row.quote.id}
                    row={row}
                    group={group}
                    tenantId={tenant.id}
                    timezone={tenant.timezone}
                    now={now}
                  />
                ))}
              </ul>
            );

            // CLOSED IS COLLAPSED, and it holds the won/lost history the
            // `?status=` filter used to hold. Present whenever it has rows —
            // the count in the summary is what makes it worth opening — and
            // absent when it does not, because an empty disclosure is a control
            // that does nothing.
            if (group === 'closed') {
              if (rows.length === 0) return null;
              return (
                <details className="disclosure" key={group}>
                  <summary>
                    {PIPELINE_GROUP_HEADINGS.closed} ({rows.length})
                  </summary>
                  {list}
                </details>
              );
            }

            // `Chasing` and `Waiting` hide when empty: their heading carries no
            // information a missing heading does not. `Needs attention` does
            // not hide, and the difference is the whole rule — a section that
            // vanishes when it empties leaves the operator unable to tell
            // "nothing needs me" from "the list failed to load", and the second
            // reading is the one that costs somebody a missed quote. Same
            // argument as `Nothing needs review.` directly below.
            if (rows.length === 0 && group !== 'needs_attention') return null;

            return (
              <Fragment key={group}>
                <h3>{PIPELINE_GROUP_HEADINGS[group]}</h3>
                {rows.length === 0 ? <p className="muted">Nothing needs attention.</p> : list}
              </Fragment>
            );
          })
        )}

        {/* Triage lives inside the quotes section, below the table, and it is
            rendered for every connected client — including when there is
            nothing to do. A section that vanishes when the list empties leaves
            the operator unable to tell "triage is done" from "triage is
            missing", and the second reading is the one that costs a support
            message. */}
        {connection ? (
          <>
            <h3>Needs review</h3>
            {triageQuotes.length === 0 ? (
              <p className="muted">Nothing needs review.</p>
            ) : (
              <TriageForm tenantId={tenant.id} quotes={triageQuotes} />
            )}
          </>
        ) : null}
      </section>

      {/* 2026-10 (Phase 15, 15-05; CON-06 / D-02). 06-UI-SPEC's section order
          extended: the third work list belongs beside the pipeline, after
          Quotes and before the sync runs. The state line reads the SAME
          `checklist` facts the card above renders, so the two cannot disagree.
          The section is the one component on this page that reads a caller's
          number — behind `requireOperator()`, inside its own try; this page's
          own reads still select none (T-6-21). */}
      <MissedCallsSection
        tenantId={tenant.id}
        timezone={tenant.timezone}
        divertNumber={checklist?.divert.numberE164 ?? null}
        textBackLive={checklist?.live.textBack ?? 'not_armed'}
        callsBefore={callsBefore}
        now={now}
      />

      <section>
        <h2>Recent sync runs</h2>

        {runs.length === 0 ? (
          <p className="muted">No sync runs yet.</p>
        ) : (
          /* The box scrolls, not the page: a `response parse error` pill is
             nowrap and takes the four columns past a 390px phone (measured
             437px). The quotes table's rule (02-05, 8de755c); G-07-6. */
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Recent sync runs">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Outcome</th>
                  <th>Fetched</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatInTenantZone(run.started_at, tenant.timezone)}</td>
                    <td>
                      {/* The classified outcome and nothing else. */}
                      <span className={runBadgeClass(run.outcome)}>
                        {syncOutcomeLabel(run.outcome)}
                      </span>
                    </td>
                    <td>{run.jobs_fetched}</td>
                    <td>{run.jobs_upserted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
