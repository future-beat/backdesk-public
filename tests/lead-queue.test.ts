/**
 * D-01 / D-09 — THE `/leads` QUEUE'S TWO-AUTHORITY READ AND THE DIGEST'S
 * OVERDUE COUNT (Phase 15, plan 15-03; CON-05, CON-06).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   D-01 — `listOpenLeadsForQueue()` (the lead family, cross-tenant) returns
 *          every OPEN lead and no closed one, ordered by its live lead
 *          cadence's next unsent touch `scheduled_at ASC NULLS LAST`, then
 *          `first_missed_at`, then id — IN SQL, BEFORE THE CAP — with the TRUE
 *          total beside the capped rows. A lead whose cadence is stopped has no
 *          next touch and sorts last. No row carries a mobile or a body.
 *        — `forTenant(t).leads.queueCards(ids)` returns the caller's mobile
 *          and the NEWEST threaded, non-STOP reply per lead, tenant-scoped: a
 *          STOP newer than the replies is not the card's reply, and another
 *          tenant's lead id matches nothing.
 *   D-09 — `countOverdueOpenLeads(now)` counts, per tenant, OPEN leads whose
 *          LIVE lead cadence holds a touch in STALLABLE_TOUCH_STATUSES with
 *          `scheduled_at <= now`. An `approved` touch past its slot is the
 *          machine's and is not overdue; a stopped cadence's or a closed
 *          lead's past-slot touch never counts.
 *
 * A source pin beside the DB proof: the comment-stripped body of
 * `listOpenLeadsForQueue` names no `contactMobile`, no `body:` and no
 * `inboundMessages` (the `tests/inbox-authorization.test.ts` idiom).
 *
 * ── THIS SUITE READS ACROSS EVERY TENANT ────────────────────────────────────
 *
 * `listOpenLeadsForQueue` is cross-tenant by design, so the database's other
 * rows can be in its result. Its assertions are RELATIVE (my rows, in this
 * order, within whatever else is there) or checked against an INDEPENDENT
 * count through the admin client — never an absolute row count (the
 * `tests/approval-queue.test.ts` rule). The overdue count is per tenant, so
 * it is asserted exactly for this suite's tenants.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production.
 * Every row is TENANT-SCOPED and swept by `teardownTenants` in `afterAll`.
 * The clock is pinned. Every assertion is keyed on this suite's own tenants
 * and ids; the suite compares values and never prints a number. Every number
 * is from ACMA's fiction block, in the Phase 15 lead-queue sub-block
 * (0491 570 32x) no other suite uses (research Pitfall 10); every word is
 * invented.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDb,
  countOverdueOpenLeads,
  forTenant,
  LEAD_QUEUE_CAP,
  listOpenLeadsForQueue,
  type LeadQueueRow,
} from '../src/db/repository';

import {
  admin,
  seedInbound,
  seedLead,
  seedLeadCadence,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** THE PINNED CLOCK: Tuesday 13 October 2026, 10:00 in Perth (02:00 UTC). */
const NOW = new Date('2026-10-13T02:00:00.000Z');

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** One fiction-block mobile per lead, so `leads_one_open_per_mobile` never meets itself. */
const OVERDUE_CALLER = '+61491570321';
const DRAFT_CALLER = '+61491570322';
const SCHEDULED_CALLER = '+61491570323';
const STOPPED_CALLER = '+61491570324';
const CLOSED_CALLER = '+61491570325';
const OTHER_TENANT_CALLER = '+61491570326';

const tenantIds: string[] = [];
let tenantA = '';
let tenantB = '';

let overdueLead = '';
let draftLead = '';
let scheduledLead = '';
let stoppedLead = '';
let closedLead = '';
let otherTenantLead = '';
let overdueTouch = '';
let newestReplyId = '';

/** An open lead at `tenantId` for `mobile`, first missed `firstMissedAt`. */
async function openLead(tenantId: string, mobile: string, firstMissedAt: Date): Promise<string> {
  return seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: firstMissedAt.toISOString(),
    last_missed_at: firstMissedAt.toISOString(),
  });
}

/** A lead cadence with ONE touch in `status` at `scheduledAt`. Returns both ids. */
async function cadenceWithTouch(
  tenantId: string,
  leadId: string,
  mobile: string,
  cadence: Record<string, unknown>,
  touch: { status: string; scheduledAt: Date },
): Promise<{ cadenceId: string; touchId: string }> {
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: mobile,
    anchor_at: at(NOW, -MS_PER_DAY).toISOString(),
    ...cadence,
  });
  const [row] = await seedTouches(cadenceId, tenantId, [
    { status: touch.status, scheduled_at: touch.scheduledAt.toISOString() },
  ]);
  return { cadenceId, touchId: row!.id };
}

async function setTouchStatus(touchId: string, status: string): Promise<void> {
  const { error } = await admin.from('cadence_touches').update({ status }).eq('id', touchId);
  if (error) throw new Error(`Updating a touch failed: ${error.message}`);
}

function overdueFor(rows: Array<{ tenantId: string; count: number }>, tenantId: string): number | undefined {
  return rows.find((row) => row.tenantId === tenantId)?.count;
}

/** The leads.ts body of one exported function, line and block comments stripped. */
function functionBody(source: string, start: string): string {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const from = stripped.indexOf(start);
  const to = stripped.indexOf('export ', from + start.length);
  return stripped.slice(from, to === -1 ? undefined : to);
}

beforeAll(async () => {
  tenantA = await seedTenant('Lead Queue A');
  tenantIds.push(tenantA);
  tenantB = await seedTenant('Lead Queue B');
  tenantIds.push(tenantB);

  // Distinct first-missed instants, so the tie-break below the slot is never
  // what orders two of these rows.
  overdueLead = await openLead(tenantA, OVERDUE_CALLER, at(NOW, -10 * MS_PER_HOUR));
  draftLead = await openLead(tenantA, DRAFT_CALLER, at(NOW, -9 * MS_PER_HOUR));
  scheduledLead = await openLead(tenantA, SCHEDULED_CALLER, at(NOW, -8 * MS_PER_HOUR));
  stoppedLead = await openLead(tenantA, STOPPED_CALLER, at(NOW, -7 * MS_PER_HOUR));
  closedLead = await seedLead(tenantA, {
    contact_mobile: CLOSED_CALLER,
    first_missed_at: at(NOW, -6 * MS_PER_HOUR).toISOString(),
    last_missed_at: at(NOW, -6 * MS_PER_HOUR).toISOString(),
    status: 'closed',
    closed_reason: 'operator',
    closed_at: at(NOW, -MS_PER_HOUR).toISOString(),
  });
  otherTenantLead = await openLead(tenantB, OTHER_TENANT_CALLER, at(NOW, -5 * MS_PER_HOUR));

  const overdue = await cadenceWithTouch(tenantA, overdueLead, OVERDUE_CALLER, {}, {
    status: 'pending_approval',
    scheduledAt: at(NOW, -2 * MS_PER_HOUR),
  });
  overdueTouch = overdue.touchId;
  await cadenceWithTouch(tenantA, draftLead, DRAFT_CALLER, {}, {
    status: 'needs_draft',
    scheduledAt: at(NOW, MS_PER_HOUR),
  });
  await cadenceWithTouch(tenantA, scheduledLead, SCHEDULED_CALLER, {}, {
    status: 'scheduled',
    scheduledAt: at(NOW, 3 * MS_PER_HOUR),
  });
  // A STOPPED cadence holding a waiting touch past its slot: the cadence-status
  // filter is what keeps it out of both reads (it is not the touch's status).
  await cadenceWithTouch(
    tenantA,
    stoppedLead,
    STOPPED_CALLER,
    { status: 'stopped', stop_reason: 'operator_closed' },
    { status: 'pending_approval', scheduledAt: at(NOW, -5 * MS_PER_HOUR) },
  );
  // A CLOSED lead whose (still-live) cadence holds a waiting touch past its
  // slot: the lead-status filter is what keeps it out.
  await cadenceWithTouch(tenantA, closedLead, CLOSED_CALLER, {}, {
    status: 'pending_approval',
    scheduledAt: at(NOW, -4 * MS_PER_HOUR),
  });
  await cadenceWithTouch(tenantB, otherTenantLead, OTHER_TENANT_CALLER, {}, {
    status: 'scheduled',
    scheduledAt: at(NOW, 5 * MS_PER_HOUR),
  });

  // Two threaded replies and a NEWER STOP on the overdue lead. Invented words.
  await seedInbound(tenantA, {
    cadenceId: overdue.cadenceId,
    quoteId: null,
    leadId: overdueLead,
    receivedAt: at(NOW, -3 * MS_PER_HOUR).toISOString(),
    fromAddress: OVERDUE_CALLER,
    body: 'Hot water unit is leaking under the laundry tub',
    label: 'new_enquiry',
    urgency: 'this_week',
    labelConfidence: 'medium',
  });
  newestReplyId = await seedInbound(tenantA, {
    cadenceId: overdue.cadenceId,
    quoteId: null,
    leadId: overdueLead,
    receivedAt: at(NOW, -150 * 60_000).toISOString(),
    fromAddress: OVERDUE_CALLER,
    body: 'Any chance of Thursday morning',
    label: 'callback_request',
    urgency: 'this_week',
    labelConfidence: 'high',
    isHot: true,
  });
  await seedInbound(tenantA, {
    cadenceId: overdue.cadenceId,
    quoteId: null,
    leadId: overdueLead,
    receivedAt: at(NOW, -MS_PER_HOUR).toISOString(),
    fromAddress: OVERDUE_CALLER,
    body: 'STOP',
    isStop: true,
  });
});

afterAll(async () => {
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

describe('listOpenLeadsForQueue — every open lead, soonest deadline first (D-01)', () => {
  const mine = () => [overdueLead, draftLead, scheduledLead, stoppedLead, closedLead, otherTenantLead];

  it('returns my five OPEN leads in slot order, the touch-less one last, and not the closed one', async () => {
    // A cap wide enough that every open lead in the database is admitted, so
    // the ORDER is what is asserted here; the cap has its own case below.
    const page = await listOpenLeadsForQueue(10_000);
    const ordered = page.rows.filter((row) => mine().includes(row.leadId)).map((row) => row.leadId);

    expect(ordered).toEqual([overdueLead, draftLead, scheduledLead, otherTenantLead, stoppedLead]);
    expect(ordered).not.toContain(closedLead);
  });

  it('carries the next touch, and NULL for a lead with no live cadence touch', async () => {
    const { rows } = await listOpenLeadsForQueue(10_000);
    const byId = new Map(rows.map((row) => [row.leadId, row]));

    const overdue = byId.get(overdueLead)!;
    expect(overdue.tenantId).toBe(tenantA);
    expect(overdue.touchId).toBe(overdueTouch);
    expect(overdue.touchStatus).toBe('pending_approval');
    expect(overdue.touchNumber).toBe(1);
    expect(overdue.scheduledAt).toEqual(at(NOW, -2 * MS_PER_HOUR));
    expect(overdue.firstMissedAt).toEqual(at(NOW, -10 * MS_PER_HOUR));
    expect(overdue.missedCallCount).toBe(1);
    expect(overdue.afterHours).toBe(false);
    expect(overdue.sm8JobState).toBe('none');

    const stopped = byId.get(stoppedLead)!;
    expect(stopped.touchId).toBeNull();
    expect(stopped.scheduledAt).toBeNull();
    expect(stopped.touchStatus).toBeNull();

    expect(byId.get(otherTenantLead)!.tenantId).toBe(tenantB);
  });

  it('orders the WHOLE page by slot with NULLS LAST, not just my rows', async () => {
    const { rows } = await listOpenLeadsForQueue(10_000);
    let seenNull = false;
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1]!;
      const current = rows[i]!;
      if (previous.scheduledAt === null) seenNull = true;
      if (seenNull) {
        expect(current.scheduledAt).toBeNull();
        continue;
      }
      if (current.scheduledAt !== null) {
        expect(current.scheduledAt.getTime()).toBeGreaterThanOrEqual(previous.scheduledAt!.getTime());
      }
    }
  });

  it('caps the rows and reports the TRUE total, counted independently', async () => {
    const { count, error } = await admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');
    if (error) throw new Error(`Counting open leads failed: ${error.message}`);

    const capped = await listOpenLeadsForQueue(2);
    expect(capped.rows).toHaveLength(2);
    expect(capped.total).toBe(count);
    expect(capped.total).toBeGreaterThanOrEqual(5);

    const defaulted = await listOpenLeadsForQueue();
    expect(defaulted.rows.length).toBeLessThanOrEqual(LEAD_QUEUE_CAP);
    expect(defaulted.total).toBe(count);
  });

  it('returns no mobile and no body on any row', async () => {
    const { rows } = await listOpenLeadsForQueue(10_000);
    const keys = new Set(rows.flatMap((row: LeadQueueRow) => Object.keys(row)));
    expect(keys.has('contactMobile')).toBe(false);
    expect(keys.has('body')).toBe(false);
    expect([...keys].sort()).toEqual(
      [
        'afterHours',
        'firstMissedAt',
        'lastMissedAt',
        'leadId',
        'missedCallCount',
        'scheduledAt',
        'sm8JobState',
        'tenantId',
        'touchId',
        'touchNumber',
        'touchStatus',
      ].sort(),
    );
  });
});

describe('forTenant().leads.queueCards — the personal facts, per tenant (D-01)', () => {
  it('returns each lead\'s mobile and the NEWEST threaded non-STOP reply', async () => {
    const cards = await forTenant(tenantA).leads.queueCards([overdueLead, draftLead]);
    const byId = new Map(cards.map((card) => [card.leadId, card]));

    expect(cards).toHaveLength(2);
    expect(byId.get(overdueLead)!.contactMobile).toBe(OVERDUE_CALLER);
    expect(byId.get(draftLead)!.contactMobile).toBe(DRAFT_CALLER);

    const reply = byId.get(overdueLead)!.reply!;
    expect(reply.id).toBe(newestReplyId);
    expect(reply.body).toBe('Any chance of Thursday morning');
    expect(reply.label).toBe('callback_request');
    expect(reply.labelConfidence).toBe('high');
    expect(reply.urgency).toBe('this_week');
    expect(reply.isHot).toBe(true);
    expect(reply.receivedAt).toEqual(at(NOW, -150 * 60_000));

    expect(byId.get(draftLead)!.reply).toBeNull();
  });

  it('matches nothing for another tenant\'s lead, and nothing for an empty list', async () => {
    expect(await forTenant(tenantA).leads.queueCards([otherTenantLead])).toEqual([]);
    expect(await forTenant(tenantB).leads.queueCards([overdueLead])).toEqual([]);
    expect(await forTenant(tenantA).leads.queueCards([])).toEqual([]);
  });
});

describe('countOverdueOpenLeads — the digest overdue line (D-09)', () => {
  it('counts only the open lead whose waiting touch is past its slot', async () => {
    await setTouchStatus(overdueTouch, 'pending_approval');
    const rows = await countOverdueOpenLeads(NOW);

    // The stopped cadence's and the closed lead's past-slot touches never count.
    expect(overdueFor(rows, tenantA)).toBe(1);
    // Tenant B's only touch is in the future.
    expect(overdueFor(rows, tenantB)).toBeUndefined();
  });

  it('an APPROVED touch past its slot is the machine\'s, not overdue', async () => {
    await setTouchStatus(overdueTouch, 'approved');
    try {
      expect(overdueFor(await countOverdueOpenLeads(NOW), tenantA)).toBeUndefined();
    } finally {
      await setTouchStatus(overdueTouch, 'pending_approval');
    }
  });

  it('a needs_draft touch past its slot IS overdue', async () => {
    await setTouchStatus(overdueTouch, 'needs_draft');
    try {
      expect(overdueFor(await countOverdueOpenLeads(NOW), tenantA)).toBe(1);
    } finally {
      await setTouchStatus(overdueTouch, 'pending_approval');
    }
  });

  it('a touch exactly at its slot is overdue (scheduled_at <= now)', async () => {
    expect(overdueFor(await countOverdueOpenLeads(at(NOW, -2 * MS_PER_HOUR)), tenantA)).toBe(1);
    expect(overdueFor(await countOverdueOpenLeads(at(NOW, -2 * MS_PER_HOUR - 1)), tenantA)).toBeUndefined();
  });
});

describe('the family read keeps its promise in source', () => {
  it('listOpenLeadsForQueue names no mobile, no body and no inbound table', () => {
    const body = functionBody(
      readFileSync('src/db/repository/leads.ts', 'utf8'),
      'export async function listOpenLeadsForQueue',
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/contactMobile/);
    expect(body).not.toMatch(/body:/);
    expect(body).not.toMatch(/inboundMessages/);
  });
});
