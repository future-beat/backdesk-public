import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  mergeConversation,
  nextTouchForQuote,
  type ReplyEvidence,
  type SentEvidence,
} from '@/core/pipeline/grouping';
// WR-01: the ONE rule for "which draft may still be offered", shared with the
// cross-client queue's accessor. A LEAF module — importing it pulls in nothing,
// which is exactly why the rule can live in one place at all.
import { isApprovableDraftStatus } from '@/core/approval/limits';
import { ABOUT_QUOTE_TOUCH_NUMBER } from '@/core/leads/constants';
import { formatInTenantZone, NO_VALUE } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

import { labelGuess } from '../../../../components/label-guess';
import { CadenceControls } from './cadence-controls';
import { DraftReview, type PendingDraft } from './draft-review';

export const metadata: Metadata = { title: 'Quote' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE PER-QUOTE CONTROL SURFACE (D-16).
 *
 * ── WHY THIS IS A ROUTE AND NOT A DISCLOSURE ON THE CLIENT PAGE ─────────────
 *
 * The kill switch needs somewhere stable to live. An operator who is told "stop
 * chasing the Hendersons" is looking for one quote, on a phone, and a control
 * that only exists inside an expanded row of a 200-row table is one the client
 * page's own filter can hide. A URL can be opened, bookmarked, and re-opened
 * after the resume to check the schedule actually moved — which is the second
 * half of what this page is for.
 *
 * ── EVERY READ IS RLS-SCOPED, AND THAT IS THE WHOLE CROSS-TENANT DEFENCE ────
 *
 * `createClient()` is the anon key plus the operator's session cookie, so every
 * query below runs as `authenticated` and `has_tenant_access(tenant_id)` decides
 * what comes back. A quoteId belonging to another client returns ZERO ROWS,
 * indistinguishable from one that does not exist, and both render `notFound()`.
 * No membership check in this file could be more trustworthy than that one, and
 * a page that checked membership itself and then read through service-role would
 * be strictly worse (threat T-3-21).
 *
 * ── TIMES ARE THE CLIENT'S WALL CLOCK, NEVER THE OPERATOR'S ─────────────────
 *
 * Every instant on this page goes through `formatInTenantZone(value,
 * tenant.timezone)`, and the zone is NAMED beside the schedule. An operator
 * reading this in Sydney is deciding whether a Perth tradie's customer is about
 * to be texted at a reasonable hour; rendering "4:15 pm" in the browser's zone
 * would answer a question nobody asked, and answer it wrongly by eight hours.
 */

type TenantRow = {
  id: string;
  name: string;
  timezone: string;
};

type QuoteRow = {
  id: string;
  sm8_job_uuid: string;
  generated_job_id: string | null;
  job_description: string | null;
  job_address: string | null;
  total_invoice_amount: string | null;
  quote_date_utc: string | null;
  status: string;
  chase_eligibility: string;
};

type CadenceRow = {
  id: string;
  status: string;
  pause_reason: string | null;
  stop_reason: string | null;
  anchor_at: string;
  contact_name: string | null;
  contact_mobile: string | null;
  contact_email: string | null;
};

type TouchRow = {
  id: string;
  touch_number: number;
  channel: string;
  status: string;
  skip_reason: string | null;
  scheduled_at: string;
};

/**
 * `to_address` is NOT selected.
 *
 * It was, and nothing rendered it — the row reads "SMS via {sender}". A
 * customer's mobile in the server-rendered payload and the client router cache
 * for a fact nothing on screen uses is the `key_last4` discipline one table
 * over: select what the page renders.
 */
type LedgerRow = {
  id: string;
  touch_number: number;
  channel: string;
  sender: string;
  outcome: string | null;
  delivery_status: string | null;
  claimed_at: string;
};

/**
 * A customer's reply, threaded to this quote.
 *
 * `body` IS selected here, and this page is one of the two places in the console
 * where that is true (the other is the inbox). Both are behind the operator
 * gate, and on this page the body is the evidence the operator is deciding
 * from — whether to keep chasing, pause, or kill the sequence. It is forbidden
 * in logs, in emails, and in every chip on the client page (T-2-02, T-6-21).
 */
type ReplyRow = {
  id: string;
  received_at: string;
  channel: string;
  body: string;
  label: string | null;
};

/**
 * A `touch_drafts` row, read UNDER RLS like everything else on this page.
 *
 * `generated_body` is deliberately NOT selected. What an operator approves is
 * `final_body` — the frozen bytes dispatch sends — and rendering the model's raw
 * output beside it would put a second, un-sendable version of the message on
 * screen for somebody to read as "the message". The raw text is evidence, and it
 * is a database question.
 *
 * The token counters and `prompt_version` are absent for the same reason: they
 * are AI-04 evidence, not review material, and every column selected here is
 * serialised into the HTML payload and the client router cache.
 */
type DraftRow = {
  id: string;
  touch_id: string;
  touch_number: number;
  attempt: number;
  final_body: string;
  status: string;
  validator_failures: { rule: string; detail?: string; nearest?: string }[] | null;
  segments: number | null;
  model: string;
};

/**
 * The cadence lifecycle in the operator's own words, not the column's.
 *
 * A status of `stopped` with a reason of `contact_suppressed` is precise and
 * unreadable at speed. The operator's question is always "is this still going
 * out, and if not, why" — so the label answers it in one line and the reason
 * line underneath carries the consequence, including the two that are
 * irreversible.
 */
const CADENCE_STATUS_LABELS: Record<string, string> = {
  active: 'Following up',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Finished',
  expired: 'Expired',
};

const PAUSE_REASON_LABELS: Record<string, string> = {
  customer_reply: 'the customer replied — only you can restart this one',
  client_paused: 'the client paused all follow-ups',
};

const STOP_REASON_LABELS: Record<string, string> = {
  won: 'the job was won',
  lost: 'the quote was declined',
  removed: 'the job was removed from ServiceM8',
  reopened: 'the quote was reopened and is back on the review list',
  contact_suppressed: 'this contact was killed — they are never chased again, on any quote',
  operator_closed: 'you closed it',
  no_contact: 'no usable mobile or email on the job',
  mirror_missing: 'the quote vanished from our records — not a deletion ServiceM8 told us about',
};

const TOUCH_STATUS_LABELS: Record<string, string> = {
  scheduled: 'scheduled',
  needs_draft: 'needs draft',
  pending_approval: 'awaiting approval',
  approved: 'approved',
  sent: 'sent',
  skipped: 'skipped',
};

const SKIP_REASON_LABELS: Record<string, string> = {
  min_gap: 'too close to the next follow-up',
  stale: 'more than 72 hours late',
  suppressed: 'this contact is suppressed',
  quote_closed: 'the quote closed',
  cadence_stopped: 'the follow-up sequence stopped',
  cadence_expired: 'the sequence ran out of time',
  no_address: 'no mobile or email stored for this channel',
  // Phase 6 D-02. Every other entry names a RULE; this one names a person, and
  // the wording says so — "skipped" alone would read as one more thing the
  // engine decided. The writer lands in 06-03; the label ships with the
  // vocabulary member so the member can never render as snake_case on the
  // operator's phone in the gap between (the house rule: a map, not a
  // `.replace('_', ' ')`).
  operator_skipped: 'you skipped this one',
};

/** `stub_sent` is rendered as what it is, so nobody reads a demo as a delivery. */
const OUTCOME_LABELS: Record<string, string> = {
  stub_sent: 'stub (not really sent)',
  sent: 'sent',
  failed: 'failed',
};

/**
 * The carrier receipt, which answers a DIFFERENT question from `outcome`.
 *
 * `outcome` is "did the provider accept it from us"; `delivery_status` is "did
 * the carrier get it to the handset". A NULL is not a failure and must not read
 * as one — no receipt has arrived yet, and for email it may never — so it
 * renders as nothing at all rather than as "unknown", which is a real
 * `DELIVERY_STATUSES` member meaning the carrier told us it could not say.
 */
const DELIVERY_LABELS: Record<string, string> = {
  delivered: 'delivered',
  undelivered: 'not delivered',
  unknown: 'delivery unknown',
};

function deliveryBadgeClass(status: string): string {
  if (status === 'delivered') return 'badge badge--ok';
  if (status === 'undelivered') return 'badge badge--error';
  return 'badge badge--warn';
}

const CHANNEL_LABELS: Record<string, string> = { sms: 'SMS', email: 'Email' };

/**
 * Colour reinforces the label; it never carries the meaning alone.
 *
 * `skipped` is a warning rather than an error: a skip is a rule doing its job
 * (too late, too close, suppressed), and four red pills down a schedule would
 * read as four faults on a cadence that behaved correctly.
 */
/**
 * Touch 0 is the "about your quote" text a missed call from this customer
 * triggered (12-05, D-08) — not one of the chase's numbered touches, so it is
 * named rather than numbered.
 */
function touchLabel(touchNumber: number): string {
  return touchNumber === ABOUT_QUOTE_TOUCH_NUMBER ? 'Missed-call reply' : `#${touchNumber}`;
}

function touchBadgeClass(status: string): string {
  if (status === 'sent') return 'badge badge--ok';
  if (status === 'skipped') return 'badge badge--warn';
  return 'badge';
}

function cadenceBadgeClass(status: string): string {
  if (status === 'active') return 'badge badge--ok';
  if (status === 'paused') return 'badge badge--warn';
  if (status === 'stopped') return 'badge badge--error';
  return 'badge';
}

/**
 * `numeric` arrives from PostgREST as a STRING, deliberately. Parsed for
 * FORMATTING only and never fed back into a calculation — the same rule the
 * client page states at its own copy of this function.
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
 * A recipient the operator can RECOGNISE but not read off the screen.
 *
 * The decision this page supports is "should this person still be chased", and
 * the digits are not evidence for it — the name and the shape of the number are.
 * What the digits do add is a customer's mobile in a server-rendered payload, in
 * the client router cache, and in whatever screenshot ends up in a chat thread.
 * Masking costs the operator nothing and removes all three.
 */
function maskMobile(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(Math.max(0, value.length - 7))}${value.slice(-3)}`;
}

function maskEmail(value: string | null): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  if (at <= 0) return '•'.repeat(value.length);
  return `${value[0]}${'•'.repeat(Math.max(1, at - 1))}${value.slice(at)}`;
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked before either query. A well-formed but wrong uuid falls
  // through to the RLS-scoped reads and comes back empty.
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(quoteId)) {
    notFound();
  }

  const supabase = await createClient();

  const [tenantResult, quoteResult] = await Promise.all([
    supabase.from('tenants').select('id, name, timezone').eq('id', id).maybeSingle(),
    supabase
      .from('quotes')
      .select(
        'id, sm8_job_uuid, generated_job_id, job_description, job_address, total_invoice_amount, quote_date_utc, status, chase_eligibility',
      )
      .eq('id', quoteId)
      // BOTH predicates, even though RLS already scopes the read: this one stops
      // a quote of ANOTHER client the operator is also a member of rendering
      // under this client's heading, which RLS has no opinion about.
      .eq('tenant_id', id)
      .maybeSingle(),
  ]);

  if (tenantResult.error || quoteResult.error) {
    // A genuine failure is not a 404 — saying "not found" would send the operator
    // looking for a quote that exists. The PostgREST message never reaches the
    // page: it can carry column names, constraint names and the internals of
    // has_tenant_access() (WR-08, T-2-16).
    console.error(
      `[quotes] read failed: ${tenantResult.error?.code ?? quoteResult.error?.code ?? 'unknown'}`,
    );
    return (
      <section>
        <h1>Quote</h1>
        <p className="error" role="alert">
          Could not load this quote. Try again in a moment.
        </p>
        <p>
          <Link href={`/clients/${id}`}>Back to the client</Link>
        </p>
      </section>
    );
  }

  const tenant = tenantResult.data as TenantRow | null;
  const quote = quoteResult.data as QuoteRow | null;
  // Absent, or belonging to a client this operator is not on — the same answer
  // for both, deliberately.
  if (!tenant || !quote) {
    notFound();
  }

  // Newest first: a quote may legitimately have had sequential cadences over its
  // life (reopened → re-triaged → a fresh one), and the CURRENT one is the only
  // one the controls may act on.
  const { data: cadenceRows } = await supabase
    .from('cadences')
    .select(
      'id, status, pause_reason, stop_reason, anchor_at, contact_name, contact_mobile, contact_email',
    )
    .eq('tenant_id', tenant.id)
    .eq('quote_id', quote.id)
    .order('created_at', { ascending: false });

  const cadence = ((cadenceRows as CadenceRow[] | null) ?? [])[0] ?? null;

  // The D-06 client-wide flag, which decides whether the controls below offer
  // Pause or Resume. Read here rather than inferred from the cadence's pause
  // reason: a client can be paused while this particular sequence is paused for
  // a customer reply instead, and those two facts have different buttons.
  const { data: settingsRow } = await supabase
    .from('cadence_settings')
    .select('paused_at')
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  const clientPausedAt = (settingsRow as { paused_at: string | null } | null)?.paused_at ?? null;

  let touches: TouchRow[] = [];
  let ledger: LedgerRow[] = [];

  if (cadence) {
    const [touchResult, ledgerResult] = await Promise.all([
      supabase
        .from('cadence_touches')
        .select('id, touch_number, channel, status, skip_reason, scheduled_at')
        .eq('tenant_id', tenant.id)
        .eq('cadence_id', cadence.id)
        .order('touch_number', { ascending: true }),
      supabase
        .from('send_ledger')
        .select('id, touch_number, channel, sender, outcome, delivery_status, claimed_at')
        .eq('tenant_id', tenant.id)
        .eq('cadence_id', cadence.id)
        .order('claimed_at', { ascending: true }),
    ]);

    touches = (touchResult.data as TouchRow[] | null) ?? [];
    ledger = (ledgerResult.data as LedgerRow[] | null) ?? [];
  }

  /**
   * ── THE CUSTOMER'S HALF OF THE CONVERSATION (D-19) ────────────────────────
   *
   * Keyed on the QUOTE rather than on the cadence: a quote that was reopened and
   * re-triaged has had sequential cadences, and a reply sent to the first one is
   * still part of this customer's conversation about this job. The thread is a
   * history, not a view of the current sequence.
   *
   * Read through the same RLS-scoped client as everything else on this page —
   * `has_tenant_access(tenant_id)` decides what comes back, and a reply the
   * threader could not attribute carries a NULL `tenant_id` and belongs to the
   * inbox, which this predicate excludes by construction.
   */
  const { data: replyRows } = await supabase
    .from('inbound_messages')
    .select('id, received_at, channel, body, label')
    .eq('tenant_id', tenant.id)
    .eq('quote_id', quote.id)
    .order('received_at', { ascending: true });

  const replies = (replyRows as ReplyRow[] | null) ?? [];

  // The merge is a PURE function in `@/core/pipeline/grouping`, tested against
  // mixed fixtures: strictly oldest-first, with a sent row winning a shared
  // instant because a reply cannot precede the message it answers.
  const conversation = mergeConversation(
    ledger.map(
      (row): SentEvidence => ({
        kind: 'sent',
        id: row.id,
        touchNumber: row.touch_number,
        at: new Date(row.claimed_at),
        channel: row.channel,
        outcome: row.outcome,
        deliveryStatus: row.delivery_status,
      }),
    ),
    replies.map(
      (row): ReplyEvidence => ({
        kind: 'reply',
        id: row.id,
        at: new Date(row.received_at),
        channel: row.channel,
        body: row.body,
        label: row.label,
      }),
    ),
  );

  // For the empty state's second half. The SAME derivation the client page's
  // next-touch line uses, so "the first touch is scheduled for…" here and
  // "Next: #1…" there cannot name two different slots.
  const firstScheduled = nextTouchForQuote(
    touches.map((touch) => ({
      touchNumber: touch.touch_number,
      status: touch.status,
      scheduledAt: new Date(touch.scheduled_at),
    })),
    new Date(),
  );

  /**
   * ── THE D-12 APPROVAL QUEUE FOR THIS QUOTE ────────────────────────────────
   *
   * Read through the SAME anon-key-plus-session client as everything else, so
   * `has_tenant_access(tenant_id)` decides what comes back. There is no
   * service-role read on this page and there must not be: `touch_drafts` bodies
   * carry a customer's name, their job and their price, and the policy is what
   * scopes them.
   *
   * ONE ROW PER TOUCH, THE NEWEST ATTEMPT. The table keeps every attempt as AI-04
   * evidence — a rejected first draft and its regeneration are two rows — and the
   * approval action refuses anything but the latest. Rendering the older one
   * would offer a tap the server declines.
   */
  const pendingTouches = touches.filter((touch) => touch.status === 'pending_approval');
  let pendingDrafts: PendingDraft[] = [];

  if (pendingTouches.length > 0) {
    const { data: draftRows } = await supabase
      .from('touch_drafts')
      .select('id, touch_id, touch_number, attempt, final_body, status, validator_failures, segments, model')
      .eq('tenant_id', tenant.id)
      .in(
        'touch_id',
        pendingTouches.map((touch) => touch.id),
      )
      // Newest attempt first WITHIN each touch, so the first row seen for a
      // touch id is the one to render. `attempt` and not `created_at`: the
      // column the drafting pass increments is the one that orders attempts,
      // and two attempts of one tick can share a timestamp.
      .order('touch_number', { ascending: true })
      .order('attempt', { ascending: false });

    const seen = new Set<string>();
    const byTouch = new Map<string, DraftRow>();
    for (const row of (draftRows as DraftRow[] | null) ?? []) {
      // ── THE FIRST ROW PER TOUCH DECIDES, WHATEVER IT SAYS. ──────────────
      //
      // Rows arrive newest-attempt-first, so a touch whose LATEST attempt is
      // `superseded` or `approved` is not awaiting anybody: the first is the
      // loser of a regeneration, the second is already through the gate on a
      // touch whose status has not caught up.
      //
      // The `continue` used to advance to the next ROW, which is the PREVIOUS
      // attempt of the same touch — so a touch whose rows are
      // `[2: approved, 1: validator_failed]` rendered attempt 1 in "Waiting on
      // you", complete with an edit form. `loadApprovableDraft` then refuses it
      // on every tap (`latest.id !== draftId`, and the id IS among the attempts,
      // so: "Reload the page to see it"), and reloading renders the same card.
      // Reachable whenever the draft is `approved` and the touch has not caught
      // up — now only a concurrent skip, since CR-01 put the two statements in
      // one transaction and gave every `already_approved` path a repair.
      if (seen.has(row.touch_id)) continue;
      seen.add(row.touch_id);
      // ── THE SAME ARRAY THE QUEUE'S ACCESSOR JOINS ON (WR-01). ────────────
      //
      // This used to be two inline string comparisons, and the queue's
      // cross-client read carried no equivalent at all — so the two approval
      // surfaces disagreed about the same touch, and only this one was right.
      // Imported rather than restated: a comment asking two files to agree is
      // what produced CR-02.
      if (!isApprovableDraftStatus(row.status)) continue;
      byTouch.set(row.touch_id, row);
    }

    pendingDrafts = pendingTouches.flatMap((touch) => {
      const row = byTouch.get(touch.id);
      if (!row) return [];
      return [
        {
          draftId: row.id,
          touchId: touch.id,
          touchNumber: row.touch_number,
          // Formatted HERE, in the CLIENT's zone, for the reason this page's
          // header gives: the operator is deciding whether a Perth tradie's
          // customer is about to be texted at a reasonable hour.
          scheduledLabel: formatInTenantZone(touch.scheduled_at, tenant.timezone),
          channelLabel: CHANNEL_LABELS[touch.channel] ?? touch.channel,
          finalBody: row.final_body,
          status: row.status,
          segments: row.segments,
          model: row.model,
          attempt: row.attempt,
          violations: row.validator_failures ?? [],
        },
      ];
    });
  }

  const contactMobile = maskMobile(cadence?.contact_mobile ?? null);
  const contactEmail = maskEmail(cadence?.contact_email ?? null);

  return (
    <section>
      <p className="muted">
        <Link href={`/clients/${tenant.id}`}>← {tenant.name}</Link>
      </p>

      <h1>{quote.generated_job_id ?? 'Quote'}</h1>

      <dl className="profile">
        <dt>Description</dt>
        <dd>{quote.job_description || NO_VALUE}</dd>

        <dt>Address</dt>
        <dd>{quote.job_address || NO_VALUE}</dd>

        <dt>Value</dt>
        <dd>{formatMoney(quote.total_invoice_amount)}</dd>

        <dt>Quote date</dt>
        <dd>{formatInTenantZone(quote.quote_date_utc, tenant.timezone, { dateStyle: 'medium' })}</dd>

        <dt>ServiceM8 status</dt>
        <dd>
          <span className="badge">{quote.status}</span>
        </dd>

        <dt>Follow-up</dt>
        <dd>{quote.chase_eligibility === 'eligible' ? 'approved for chasing' : 'needs review'}</dd>
      </dl>

      <section>
        <h2>Follow-up sequence</h2>

        {cadence === null ? (
          /* NAMES WHY, and names the next action — the emptyQuotesCopy
             precedent. "No cadence" would leave the operator unable to tell a
             quote awaiting their own approval from one the engine dropped. */
          <p className="muted">
            {quote.chase_eligibility === 'eligible'
              ? 'Approved for chasing — the follow-up sequence starts on the next tick, within a minute.'
              : 'Not being followed up yet. Tick this quote in “Needs review” on the client page to start chasing it.'}
          </p>
        ) : (
          <>
            <div className="row">
              <p className="meta">
                <strong>{CADENCE_STATUS_LABELS[cadence.status] ?? cadence.status}</strong>
                {cadence.pause_reason
                  ? ` — ${PAUSE_REASON_LABELS[cadence.pause_reason] ?? cadence.pause_reason}`
                  : ''}
                {cadence.stop_reason
                  ? ` — ${STOP_REASON_LABELS[cadence.stop_reason] ?? cadence.stop_reason}`
                  : ''}
              </p>
              <span className={cadenceBadgeClass(cadence.status)}>{cadence.status}</span>
            </div>

            <p className="muted meta">
              Chasing {cadence.contact_name ?? 'an unnamed contact'}
              {contactMobile ? ` · ${contactMobile}` : ''}
              {contactEmail ? ` · ${contactEmail}` : ''}
            </p>
            <p className="muted meta">
              Started {formatInTenantZone(cadence.anchor_at, tenant.timezone)}
              {clientPausedAt
                ? ` · client paused ${formatInTenantZone(clientPausedAt, tenant.timezone)}`
                : ''}
            </p>

            {/* THE APPROVAL GATE FIRST, above the schedule and the controls.
                It is the only thing on this page that is WAITING on the
                operator; everything below it is state to read. */}
            <DraftReview tenantId={tenant.id} quoteId={quote.id} drafts={pendingDrafts} />

            <CadenceControls
              tenantId={tenant.id}
              quoteId={quote.id}
              cadenceId={cadence.id}
              cadenceStatus={cadence.status}
              clientPaused={clientPausedAt !== null}
            />

            <h3>
              Schedule{' '}
              <span className="muted zone-note">times in {tenant.timezone}</span>
            </h3>

            {touches.length === 0 ? (
              <p className="muted">
                No follow-ups were ever scheduled — this sequence stopped before it started.
              </p>
            ) : (
              <ul className="touch-list">
                {touches.map((touch) => (
                  <li key={touch.id}>
                    <span className="touch-when">
                      <strong>{touchLabel(touch.touch_number)}</strong>{' '}
                      {formatInTenantZone(touch.scheduled_at, tenant.timezone)}
                    </span>
                    <span className="touch-meta muted">
                      {CHANNEL_LABELS[touch.channel] ?? touch.channel}
                      {touch.skip_reason
                        ? ` · ${SKIP_REASON_LABELS[touch.skip_reason] ?? touch.skip_reason}`
                        : ''}
                    </span>
                    <span className={touchBadgeClass(touch.status)}>
                      {TOUCH_STATUS_LABELS[touch.status] ?? touch.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ── THE CONVERSATION (D-19) ─────────────────────────────────────────
          This REPLACES the old `Messages sent` list rather than sitting beside
          it: that list was the sent half of this one, and two lists of the same
          sends is a pair that agrees until one of them is changed.

          THE SECTION ALWAYS RENDERS, empty or not. An operator who cannot tell
          "nobody has replied" from "the replies did not load" is an operator who
          checks their phone instead — which is the triage checklist's argument,
          on the surface where the stakes are a customer's actual words.

          RAW BODIES RENDER HERE. This page and the inbox are the only two
          surfaces where that is true, and both are behind the operator gate. */}
      <section>
        <h2>
          Conversation{' '}
          <span className="muted zone-note">times in {tenant.timezone}</span>
        </h2>

        {conversation.length === 0 ? (
          <p className="muted">
            {firstScheduled
              ? `No messages yet — the first touch is scheduled for ${formatInTenantZone(
                  firstScheduled.scheduledAt,
                  tenant.timezone,
                )}.`
              : 'No messages yet.'}
          </p>
        ) : (
          <ul className="touch-list">
            {conversation.map((entry) =>
              entry.kind === 'sent' ? (
                <li key={`sent-${entry.id}`}>
                  <span className="touch-when">
                    <strong>{touchLabel(entry.touchNumber)} sent</strong>{' '}
                    {formatInTenantZone(entry.at, tenant.timezone)}
                  </span>
                  <span className="touch-meta muted">
                    {CHANNEL_LABELS[entry.channel] ?? entry.channel}
                  </span>
                  {/* A stub send is labelled as a stub wherever it appears. The
                      one thing this list must never do is let a demo read as a
                      real message to a real customer. */}
                  <span
                    className={entry.outcome === 'sent' ? 'badge badge--ok' : 'badge badge--warn'}
                  >
                    {entry.outcome === null
                      ? 'outcome unknown'
                      : (OUTCOME_LABELS[entry.outcome] ?? entry.outcome)}
                  </span>
                  {/* Only when a receipt has actually arrived — a NULL is "no
                      receipt yet", which is not a delivery problem. */}
                  {entry.deliveryStatus ? (
                    <span className={deliveryBadgeClass(entry.deliveryStatus)}>
                      {DELIVERY_LABELS[entry.deliveryStatus] ?? entry.deliveryStatus}
                    </span>
                  ) : null}
                </li>
              ) : (
                <li key={`reply-${entry.id}`}>
                  <span className="touch-when">
                    <strong>Reply</strong> {formatInTenantZone(entry.at, tenant.timezone)}
                  </span>
                  {/* The guess, in the inbox's own words, from the module both
                      surfaces import — a guess stays phrased as a guess on every
                      surface. Absent when the classifier has not run: an
                      invented "unclassified" pill reads as a finding about the
                      message rather than a fact about us. */}
                  {entry.label ? (
                    <span className="badge">{labelGuess(entry.label)}</span>
                  ) : null}
                  {/* VERBATIM AND UN-TRUNCATED. A trimmed reply is a reply whose
                      meaning may have been trimmed off, and this is the screen
                      where somebody decides whether to keep texting a person.
                      The empty case is named rather than rendered as a blank
                      row — a provider can deliver a message with no text, and
                      `(empty message)` is the inbox's word for it. */}
                  <p className="reply-body">
                    {entry.body === '' ? <em>(empty message)</em> : entry.body}
                  </p>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </section>
  );
}
