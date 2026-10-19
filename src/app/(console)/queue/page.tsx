import type { Metadata } from 'next';

import { deriveUrgency, relativeToSlot } from '@/core/aging/stall-policy';
import { formatInTenantZone } from '@/core/shared/tenant';
import {
  type ApprovalQueuePage,
  forAllTenants_approvalQueue,
  MAX_DRAFT_FAILURES,
} from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../_auth';
import { QueueCard, type QueueCardRow } from './queue-card';

export const metadata: Metadata = { title: 'Queue' };

/** Session-dependent — must never be cached or statically rendered (T-6-02). */
export const dynamic = 'force-dynamic';

/**
 * THE CROSS-CLIENT APPROVAL QUEUE (CON-01, D-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OPERATOR'S QUESTION IS "WHAT MUST I APPROVE NEXT, ACROSS EVERYONE".  │
 * │ One deadline-ordered screen answers it. Per-client lists do not: the     │
 * │ ordering that matters spans clients, and assembling it by visiting six   │
 * │ pages is how the 4pm touch gets approved after the 9am one.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── SERVICE-ROLE READ BEHIND AN EXPLICIT OPERATOR GATE (the inbox pattern) ──
 *
 * `forAllTenants_approvalQueue` goes through `getDb()`, where RLS is inert by
 * design — so no policy protects this page. `requireOperator()` is what does,
 * and it runs BEFORE the read, on the same argument the inbox and the audit
 * mapping page make (CR-01): a session proves somebody signed in, not that they
 * may read a stranger's customers' messages.
 *
 * The draft bodies rendered here carry a customer's name, their job and their
 * price. That is the same trade the inbox makes with inbound replies and for the
 * same reason: the operator IS the cross-tenant human (T-4-25, D-03). What must
 * not follow is any of it reaching a log — the read failure below discards its
 * caught value for exactly that reason.
 *
 * ── CLIENT NAMES COME FROM THE OPERATOR'S OWN JWT, NOT FROM THE ACCESSOR ────
 *
 * The repository read joins NOTHING to `tenants`, so the names (and the zones
 * every slot is rendered in) are resolved here through `createClient()` under
 * RLS. A client this operator cannot see is named `Another client` — never a
 * bare uuid, never an invented name — which is the inbox's `nameOf` precedent.
 * It is a narrower authority than the read above it, deliberately.
 *
 * ── TIMES ARE EACH CLIENT'S WALL CLOCK, AND THE ZONE IS NAMED PER CARD ──────
 *
 * Every other cadence surface is single-tenant and names the zone once beside
 * the list. THIS ONE MIXES TENANTS, so the one-zone-note shortcut does not
 * apply: a Perth slot and a Sydney slot on adjacent cards read as the same
 * number and are two hours apart. The relative time sits BESIDE the absolute
 * one, never instead of it — "due in 2h" answers urgency, and "9:12 am
 * (Australia/Perth)" answers whether that is a reasonable hour for the customer.
 */

const CHANNEL_LABELS: Record<string, string> = { sms: 'SMS', email: 'Email' };

/** The em-dash-free "no client name" answer. See the header. */
const UNKNOWN_CLIENT = 'Another client';

/*
 * `relativeToSlot` USED TO LIVE HERE, AND THAT WAS THE BUG (WR-05).
 *
 * Its header claimed the sentence and the urgency badge "cannot say different
 * things about one slot" because both come from the same clock — but the badge
 * asked `slot <= now` while the sentence rounded to whole minutes and then
 * tested the sign, so a slot twenty seconds away printed `overdue` beside an
 * amber `due_soon`. It now sits directly beneath `deriveUrgency` in
 * `stall-policy.ts`, where the claim is enforced by proximity and by a test
 * rather than asserted by a comment in a different file.
 */

/** Everything a card needs to name its client and render its zone, resolved once. */
type TenantFacts = ReadonlyMap<string, { name: string; timezone: string }>;

export default async function QueuePage() {
  const access = await requireOperator();
  if (access !== 'ok') {
    return (
      <section>
        <h1>Queue</h1>
        <p className="error" role="alert">
          {OPERATOR_DENIED_MESSAGE[access]}
        </p>
      </section>
    );
  }

  let page: ApprovalQueuePage;
  try {
    page = await forAllTenants_approvalQueue();
  } catch {
    // The caught value is DELIBERATELY DISCARDED rather than logged or shown
    // (WR-08, T-2-02): a postgres error from this query can carry the predicate,
    // and the predicate names customer columns — and the row it failed on can
    // carry a draft body. The operator cannot act on any of it either way.
    console.error('[queue] approval queue read failed');
    return (
      <section>
        <h1>Queue</h1>
        <p className="error" role="alert">
          Could not load the queue. Try again in a moment.
        </p>
      </section>
    );
  }

  // Names and zones through the operator's OWN JWT, so RLS decides which clients
  // they may see — a narrower authority than the read above, and the reason the
  // repository accessor returns ids rather than joining `tenants` itself.
  const supabase = await createClient();
  const { data: tenantRows } = await supabase.from('tenants').select('id, name, timezone');
  const facts: TenantFacts = new Map(
    ((tenantRows as { id: string; name: string; timezone: string }[] | null) ?? []).map((row) => [
      row.id,
      { name: row.name, timezone: row.timezone },
    ]),
  );

  // ONE `now` for the whole render, so two cards a millisecond apart cannot
  // report relative times computed from different instants.
  const now = new Date();

  // EVERY ROW IS A CARD, QUOTE OR LEAD (Phase 13, research Pitfall 1). Since
  // 13-02 a lead's touches 2 and 3 are promoted, drafted and parked here; a
  // filter on the quote id would hide every one of them, they would stall, and
  // nothing would send. A lead card carries a NULL quote id, renders as a
  // missed-call follow-up with no quote link, and binds its actions to that
  // null id (the actions' UUID guard skips the quote page).
  const cards: QueueCardRow[] = page.rows.map((row) => {
    const tenant = facts.get(row.tenantId);
    const timezone = tenant?.timezone ?? 'UTC';

    return {
      touchId: row.touchId,
      tenantId: row.tenantId,
      clientName: tenant?.name ?? UNKNOWN_CLIENT,
      quoteId: row.quoteId,
      kind: row.kind,
      leadId: row.leadId,
      touchNumber: row.touchNumber,
      channelLabel: CHANNEL_LABELS[row.channel] ?? row.channel,
      // THE ZONE IS NAMED ON EVERY CARD — this list mixes tenants.
      slotLabel: `${formatInTenantZone(row.scheduledAt, timezone)} (${timezone})`,
      relativeLabel: relativeToSlot(row.scheduledAt, now),
      // ── THE ONE DERIVATION (D-12) ────────────────────────────────────────
      //
      // Computed HERE, from the one `now` the whole render shares, and never
      // re-derived in the card: a client component would compute it from the
      // browser's clock at hydration time, so a card rendered at 3:59 and
      // hydrated at 4:01 would carry a badge the server-side stall alert
      // disagrees with. The threshold itself is `STALL_THRESHOLD_HOURS` inside
      // `deriveUrgency` — no queue file spells the number 4 beside a slot.
      urgency: deriveUrgency(row.scheduledAt, now),
      quoteDescription: row.quoteDescription,
      draftFailures: row.draftFailures,
      /**
       * HAS DRAFTING GIVEN UP ON THIS TOUCH?
       *
       * `listNeedsDraft` stops offering a touch at `MAX_DRAFT_FAILURES`, so
       * past the cap nothing will ever be written for it and "it will keep
       * trying" is a sentence the operator would act on and be wrong. The
       * difference decides whether the card is reporting a delay or asking for
       * a decision.
       */
      draftingGaveUp: row.draftFailures >= MAX_DRAFT_FAILURES,
      draft:
        row.draftId === null || row.draftFinalBody === null || row.draftStatus === null
          ? null
          : {
              draftId: row.draftId,
              touchId: row.touchId,
              touchNumber: row.touchNumber,
              scheduledLabel: formatInTenantZone(row.scheduledAt, timezone),
              channelLabel: CHANNEL_LABELS[row.channel] ?? row.channel,
              finalBody: row.draftFinalBody,
              status: row.draftStatus,
              segments: row.draftSegments,
              model: row.draftModel ?? 'unknown model',
              attempt: row.draftAttempt ?? 1,
              violations: Array.isArray(row.draftViolations) ? row.draftViolations : [],
            },
    };
  });

  return (
    <section>
      <div className="row">
        <h1>Queue</h1>
        {/* THE TRUE TOTAL, not `cards.length` — the only thing on the page that
            can tell an operator the read cap is engaged. Absent at zero: a
            permanent "0 drafts waiting" trains the eye to skip the line. */}
        <span className="muted">
          {page.total === 0 ? null : `${page.total} draft${page.total === 1 ? '' : 's'} waiting`}
        </span>
      </div>

      <p className="hint muted">
        Every message here is written and checked but not sent. Soonest deadline first, across
        every client — read each one as the customer will, then approve it, fix it, or skip it.
      </p>

      {cards.length === 0 ? (
        <>
          <p className="muted">Nothing waiting on you.</p>
          <p className="hint muted">
            Every scheduled message is approved. New drafts appear here as touches come due.
          </p>
        </>
      ) : (
        cards.map((row) => <QueueCard key={row.touchId} row={row} />)
      )}
    </section>
  );
}
