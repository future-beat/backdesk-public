import type { Metadata } from 'next';

import { isStalled, relativeToSlot } from '@/core/aging/stall-policy';
import { LEAD_EXPIRY_DAYS } from '@/core/leads/constants';
import { toLocalSpacedMobile } from '@/core/leads/mobile-spellings';
import { leadDeadlineTier } from '@/core/leads/queue-deadline';
import { formatInTenantZone, NO_VALUE } from '@/core/shared/tenant';
import {
  forTenant,
  LEAD_QUEUE_CAP,
  type LeadJobLinkage,
  type LeadQueueCardFacts,
  type LeadQueuePage,
  listOpenLeadsForQueue,
} from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../_auth';
import { labelGuess, urgencyGuess } from '../components/label-guess';
import {
  type CreateJobSheet,
  leadJobChips,
  readLeadJobSheets,
} from '../components/lead-job-sheet';
import {
  LEADS_EMPTY_HINT,
  LEADS_EMPTY_TITLE,
  LEADS_HINT,
  LEADS_LOAD_FAILED_MESSAGE,
  NEXT_TOUCH_STATE_LABELS,
  STALLED_LABEL,
} from './action-state';
import { LeadCard, type LeadCardRow } from './lead-card';

export const metadata: Metadata = { title: 'Leads' };

/** Session-dependent — must never be cached or statically rendered (T-6-02). */
export const dynamic = 'force-dynamic';

/**
 * THE CROSS-CLIENT LEAD QUEUE (Phase 15, CON-05 / D-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OPERATOR'S QUESTION IS "WHICH MISSED CALLER NEEDS ME NEXT, ACROSS    │
 * │ EVERYONE". One deadline-ordered list answers it, in the approval queue's │
 * │ shape: every OPEN lead as a card, soonest next follow-up first.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── SERVICE-ROLE READS BEHIND AN EXPLICIT OPERATOR GATE (the queue pattern) ─
 *
 * Both reads below go through the service-role repository, where RLS is inert
 * by design. `requireOperator()` is what protects this page, and it runs
 * BEFORE the first read (T-6-02, T-15-03): a session proves somebody signed
 * in, not that they may read a stranger's customers' numbers and words.
 *
 * ── TWO AUTHORITIES, TWO READS (14-REVIEW IN-08) ────────────────────────────
 *
 * `listOpenLeadsForQueue` crosses tenants and returns ids, instants, an
 * integer, booleans and a status word — nothing personal. The caller's mobile
 * and their newest reply come PER TENANT through
 * `forTenant(tenantId).leads.queueCards(ids)`, so every read that returns a
 * customer fact is scoped to one client by construction. Both run in ONE
 * `try`: the mobile and the reply are what the card is for, and a page that
 * cannot read them has nothing honest to render. The caught value is
 * DISCARDED (WR-08) — a postgres error carries the predicate, and the
 * predicate names customer columns.
 *
 * Client names and zones come through `createClient()` under the operator's
 * own JWT — a narrower authority than the reads above. A client this operator
 * cannot see is `Another client`, never a uuid.
 *
 * ── THE READ CAP, THE TRUE TOTAL, AND WHERE THEY DIVERGE ────────────────────
 *
 * The read returns at most `LEAD_QUEUE_CAP` cards, sorted in SQL before the
 * LIMIT, and the TRUE total beside them. The count line's `{n} open leads` is
 * that true total. Its `{m} overdue` counts tiers among the RENDERED cards
 * only: when the cap is hit it covers the `LEAD_QUEUE_CAP` soonest, and since
 * overdue cards sort first an undercount needs more than fifty overdue leads.
 * The digest's `countOverdueOpenLeads` is uncapped and is the authoritative
 * overdue count — the count line is a hint, never a figure.
 *
 * ── ONE `now`, AND EVERY TIME IN ITS CLIENT'S ZONE, NAMED ───────────────────
 *
 * The deadline tier, the relative time and the stalled word are derived on the
 * server from ONE `now` (D-12): a client component would derive them from the
 * browser's clock at hydration. The list mixes tenants, so the zone is named
 * on every card.
 */

/** The em-dash-free "no client name" answer (the inbox/queue precedent). */
const UNKNOWN_CLIENT = 'Another client';

/** A tenant whose zone could not be read is rendered in the service's home zone. */
const FALLBACK_TIMEZONE = 'Australia/Perth';

/**
 * How sure the model said it was — shown ONLY when it was not sure. The
 * inbox's map and its argument (`inbox/page.tsx`): `high` is the acting
 * threshold, so below-high is what gets said.
 */
const LOW_CONFIDENCE_LABELS: Record<string, string> = {
  medium: 'not certain',
  low: 'a guess',
};

/** `13 Oct, 9:12 am` — the short form for a second time on one line. */
const SHORT_WHEN: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
};

const DAY_MS = 24 * 60 * 60 * 1000;

type TenantFacts = ReadonlyMap<string, { name: string; timezone: string }>;

/**
 * The spaced local form. `leads.contact_mobile` is CHECKed to be `+614…` on an
 * open lead (only a closed lead is ever pseudonymised), so the throw is a
 * schema violation; it renders as an em dash rather than taking the queue down.
 */
function callerLabelOf(contactMobile: string | undefined): string {
  if (contactMobile === undefined) return NO_VALUE;
  try {
    return toLocalSpacedMobile(contactMobile);
  } catch {
    return NO_VALUE;
  }
}

export default async function LeadsPage() {
  const access = await requireOperator();
  if (access !== 'ok') {
    return (
      <section>
        <h1>Leads</h1>
        <p className="error" role="alert">
          {OPERATOR_DENIED_MESSAGE[access]}
        </p>
      </section>
    );
  }

  let page: LeadQueuePage;
  const facts = new Map<string, LeadQueueCardFacts>();
  let linkage: ReadonlyMap<string, LeadJobLinkage>;
  let sheets: ReadonlyMap<string, CreateJobSheet>;
  try {
    page = await listOpenLeadsForQueue(LEAD_QUEUE_CAP);

    const idsByTenant = new Map<string, Set<string>>();
    for (const row of page.rows) {
      const set = idsByTenant.get(row.tenantId) ?? new Set<string>();
      set.add(row.leadId);
      idsByTenant.set(row.tenantId, set);
    }
    for (const [tenantId, ids] of idsByTenant) {
      const cards = await forTenant(tenantId).leads.queueCards([...ids]);
      for (const card of cards) facts.set(card.leadId, card);
    }

    // The Phase 14 sheet and chips, from the SAME builder the inbox uses
    // (15-04) — so the preview the operator confirms here is the one the
    // action recomputes (WR-04). Inside this try: a card is not honest
    // without its job state.
    ({ linkage, sheets } = await readLeadJobSheets(idsByTenant));
  } catch {
    // DISCARDED, never logged or shown — see the header.
    console.error('[leads] lead queue read failed');
    return (
      <section>
        <h1>Leads</h1>
        <p className="error" role="alert">
          {LEADS_LOAD_FAILED_MESSAGE}
        </p>
      </section>
    );
  }

  const supabase = await createClient();
  const { data: tenantRows } = await supabase.from('tenants').select('id, name, timezone');
  const tenants: TenantFacts = new Map(
    ((tenantRows as { id: string; name: string; timezone: string }[] | null) ?? []).map((row) => [
      row.id,
      { name: row.name, timezone: row.timezone },
    ]),
  );

  // ONE `now` for the whole render.
  const now = new Date();

  const cards: LeadCardRow[] = page.rows.map((row) => {
    const tenant = tenants.get(row.tenantId);
    const timezone = tenant?.timezone ?? FALLBACK_TIMEZONE;
    const card = facts.get(row.leadId);

    const nextTouch =
      row.touchId === null ||
      row.touchNumber === null ||
      row.scheduledAt === null ||
      row.touchStatus === null
        ? null
        : {
            touchId: row.touchId,
            touchNumber: row.touchNumber,
            scheduledAt: row.scheduledAt,
            status: row.touchStatus,
          };

    const reply = card?.reply ?? null;
    const lowConfidence =
      reply?.labelConfidence == null ? undefined : LOW_CONFIDENCE_LABELS[reply.labelConfidence];
    const label = reply === null ? null : labelGuess(reply.label);

    return {
      leadId: row.leadId,
      tenantId: row.tenantId,
      clientName: tenant?.name ?? UNKNOWN_CLIENT,
      timezone,
      // The inbox's job / resolution / creation-state chips, in its colours.
      chips: leadJobChips(linkage.get(row.leadId)),
      // Present only under the inbox's rule — open, `none` or `failed`, at
      // least one reply — which the builder applies.
      sheet: sheets.get(row.leadId),
      // THE ONE DEFINITION (D-01, D-09) — the count line counts this too.
      tier: leadDeadlineTier(nextTouch, now),
      afterHours: row.afterHours,
      callerLabel: callerLabelOf(card?.contactMobile),
      rangLabel: formatInTenantZone(row.firstMissedAt, timezone),
      callCount: row.missedCallCount > 1 ? row.missedCallCount : null,
      lastRangLabel:
        row.missedCallCount > 1 ? formatInTenantZone(row.lastMissedAt, timezone, SHORT_WHEN) : null,
      next:
        nextTouch === null
          ? null
          : {
              touchNumber: nextTouch.touchNumber,
              // THE ZONE IS NAMED ON EVERY CARD — this list mixes tenants.
              slotLabel: `${formatInTenantZone(nextTouch.scheduledAt, timezone)} (${timezone})`,
              relativeLabel: relativeToSlot(nextTouch.scheduledAt, now),
              stateWord: isStalled(
                { status: nextTouch.status, scheduledAt: nextTouch.scheduledAt },
                now,
              )
                ? STALLED_LABEL
                : (NEXT_TOUCH_STATE_LABELS[nextTouch.status] ?? nextTouch.status),
              // Only a touch that is ON the queue can be approved there.
              approveHref:
                nextTouch.status === 'pending_approval' || nextTouch.status === 'needs_draft'
                  ? `/queue#touch-${nextTouch.touchId}`
                  : null,
            },
      expiresLabel:
        nextTouch === null
          ? formatInTenantZone(
              new Date(row.firstMissedAt.getTime() + LEAD_EXPIRY_DAYS * DAY_MS),
              timezone,
              { dateStyle: 'medium' },
            )
          : null,
      reply:
        reply === null
          ? null
          : {
              body: reply.body,
              labelChip:
                label === null ? null : lowConfidence === undefined ? label : `${label} — ${lowConfidence}`,
              // A soft opt-out (the model's opt-out on a reply that is not a
              // plain STOP — `queueCards` never returns a STOP) carries the
              // inbox's colour: it is the label with something waiting on a human.
              softOptOut: reply.label === 'opt_out',
              urgencyChip: urgencyGuess(reply.urgency),
              emergency: reply.urgency === 'emergency',
              hot: reply.isHot,
              receivedLabel: formatInTenantZone(reply.receivedAt, timezone, SHORT_WHEN),
            },
    };
  });

  // Among the RENDERED cards — see the header for why this is a hint.
  const overdue = cards.filter((card) => card.tier === 'overdue').length;

  return (
    <section>
      <div className="row">
        <h1>Leads</h1>
        {/* THE TRUE TOTAL, not `cards.length`. Absent at zero. */}
        <span className="muted">
          {page.total === 0
            ? null
            : `${page.total} open lead${page.total === 1 ? '' : 's'}${
                overdue > 0 ? ` · ${overdue} overdue` : ''
              }`}
        </span>
      </div>

      <p className="hint muted">{LEADS_HINT}</p>

      {cards.length === 0 ? (
        <>
          <p className="muted">{LEADS_EMPTY_TITLE}</p>
          <p className="hint muted">{LEADS_EMPTY_HINT}</p>
        </>
      ) : (
        cards.map((row) => <LeadCard key={row.leadId} row={row} />)
      )}
    </section>
  );
}
