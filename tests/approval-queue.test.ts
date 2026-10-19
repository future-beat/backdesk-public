/**
 * THE CROSS-CLIENT APPROVAL QUEUE (CON-01), against the hosted database.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO PROPERTIES THIS SUITE EXISTS TO HOLD, AND BOTH FAIL SILENTLY:        │
 * │                                                                          │
 * │  1. THE ORDER. A queue is a claim about WHICH message is most urgent. A  │
 * │     sort applied after the cap orders only what the cap happened to      │
 * │     admit, and two touches due at the same instant with no tie-break     │
 * │     swap between renders — on a list worked one-handed by thumb, that is │
 * │     how the wrong card gets approved.                                    │
 * │  2. THE POPULATION. Keyed on the TOUCH, so a `needs_draft` row with NO   │
 * │     draft attempt (05-04's deterministic-failure gap) still appears. An  │
 * │     inner join to `touch_drafts` would silently drop exactly the touches │
 * │     CON-04's stall alert is about, and the queue would look healthy.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── AND THE WRITE, THROUGH THE ONE CORE ─────────────────────────────────────
 *
 * `src/core/approval/approve-draft.ts` is what both approval surfaces call, so
 * it is what is driven here — against real rows, not mocks. The unit-level
 * refusals (validator, whitelist, WR-01 ordering) are pinned in
 * `tests/quote-draft-approval.test.ts` against a mocked repository; what only a
 * database can prove is that the two-statement write lands on EXACTLY the
 * targeted touch, that `edit_distance` is a real `'0'` in a `numeric` column
 * rather than a NULL, and that `approveWhere`'s equality guard is what stops a
 * second write.
 *
 * ── THIS SUITE READS ACROSS EVERY TENANT, INCLUDING ROWS IT DID NOT SEED ────
 *
 * `forAllTenants_approvalQueue` is cross-tenant by design, so the hosted
 * database's own rows are in every result. Assertions are therefore written as
 * RELATIVE claims (my rows, in this order, within whatever else is there) or as
 * global invariants (the whole page is non-decreasing by slot) — never as
 * absolute row counts, which would red on a run where the founder's test tenant
 * happens to hold a pending draft.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  skipConsequence,
  skipControlState,
  SKIP_MOVED_ON_MESSAGE,
  TOUCH_SKIPPED_MESSAGE,
} from '../src/app/(console)/queue/action-state';
import { URGENCY_LABELS } from '../src/core/aging/stall-policy';
import { approveUnchanged, editThenApprove } from '../src/core/approval/approve-draft';
import {
  APPROVAL_QUEUE_CAP,
  APPROVAL_QUEUE_STATUSES,
  closeDb,
  forAllTenants_approvalQueue,
  type ApprovalQueueRow,
  forTenant,
} from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedLead,
  seedLeadCadence,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const tenantIds: string[] = [];

afterAll(async () => {
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

async function newTenant(prefix: string): Promise<string> {
  const id = await seedTenant(prefix);
  tenantIds.push(id);
  await seedConnection(id);
  return id;
}

const SUFFIX = 'Test Business. Reply STOP to opt out.';

/**
 * THE SEEDED BODIES CARRY NO DIGITS, AND THAT IS NOT AN AESTHETIC CHOICE.
 *
 * `editThenApprove` rebuilds the fact whitelist from the quote and cadence rows
 * these helpers seed — no invoice amount, no quote date — so the ONLY permitted
 * display strings are whatever `renderDaysSince` produces. A body reading
 * "touch 1" therefore fails `unlisted_number` on the `1`, and the edit tests
 * would red for a reason that has nothing to do with what they assert.
 *
 * Keeping the fixtures digit-free means an `unlisted_number` violation in this
 * suite is always a real finding.
 */
const SEEDED_BODY = `Following up on that quote. ${SUFFIX}`;

/**
 * One `touch_drafts` attempt, returning its id.
 *
 * The shared `seedApprovedDraft` helper writes an APPROVED row and returns the
 * body; this queue is about rows that are still WAITING, and the tests need the
 * id to name in an approval. Kept local rather than widening the shared helper,
 * so no other suite inherits a defaulted `status: 'generated'`.
 */
async function seedDraftAttempt(
  tenantId: string,
  cadenceId: string,
  quoteId: string,
  touchId: string,
  touchNumber: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from('touch_drafts')
    .insert({
      tenant_id: tenantId,
      cadence_id: cadenceId,
      quote_id: quoteId,
      touch_id: touchId,
      touch_number: touchNumber,
      attempt: 1,
      model: 'claude-sonnet-5',
      prompt_version: 'p1',
      generated_body: 'Following up on that quote.',
      final_body: SEEDED_BODY,
      compliance_suffix: SUFFIX,
      merge_now: new Date().toISOString(),
      status: 'generated',
      segments: 1,
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a draft attempt failed: ${error.message}`);
  return (data as { id: string }).id;
}

/** A whole waiting touch: quote → cadence → touch → (optionally) a draft. */
async function seedWaitingTouch(
  tenantId: string,
  options: {
    scheduledAt: Date;
    touchStatus?: string;
    withDraft?: boolean;
    cadenceOverrides?: Record<string, unknown>;
    quoteOverrides?: Record<string, unknown>;
    draftOverrides?: Record<string, unknown>;
  },
): Promise<{ touchId: string; draftId: string | null; cadenceId: string; quoteId: string }> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: 'Meter box and mains upgrade', ...options.quoteOverrides },
  ]);
  const cadenceId = await seedCadence(tenantId, quote!.id, options.cadenceOverrides);
  const [touch] = await seedTouches(cadenceId, tenantId, [
    {
      status: options.touchStatus ?? 'pending_approval',
      scheduled_at: options.scheduledAt.toISOString(),
    },
  ]);

  const draftId =
    options.withDraft === false
      ? null
      : await seedDraftAttempt(
          tenantId,
          cadenceId,
          quote!.id,
          touch!.id,
          touch!.touch_number,
          options.draftOverrides,
        );

  return { touchId: touch!.id, draftId, cadenceId, quoteId: quote!.id };
}

function rowFor(page: { rows: ApprovalQueueRow[] }, touchId: string): ApprovalQueueRow {
  const row = page.rows.find((candidate) => candidate.touchId === touchId);
  if (!row) throw new Error(`Touch ${touchId} was not on the queue`);
  return row;
}

/* ========================================================================= *
 * 1. The order — the claim a queue actually makes
 * ========================================================================= */

describe('the queue is deadline-sorted, with a tie-break (D-01)', () => {
  let tenantA = '';
  let tenantB = '';
  let soon = '';
  let later = '';
  /** Two touches due at the IDENTICAL instant, in two different clients. */
  let tiedLow = '';
  let tiedHigh = '';

  beforeAll(async () => {
    tenantA = await newTenant('Queue Order A');
    tenantB = await newTenant('Queue Order B');

    // Far enough out that nothing the hosted database already holds is likely
    // to interleave, and far enough apart that the ordering is unambiguous.
    const base = Date.now() + 30 * 86_400_000;
    const tiedAt = new Date(base + 5 * 3_600_000);

    soon = (await seedWaitingTouch(tenantA, { scheduledAt: new Date(base) })).touchId;
    later = (await seedWaitingTouch(tenantB, { scheduledAt: new Date(base + 9 * 3_600_000) }))
      .touchId;

    // Two rows on ONE instant, one per tenant, so the tie can only be broken by
    // the id — not by tenant, not by insertion order, not by the planner.
    const first = (await seedWaitingTouch(tenantA, { scheduledAt: tiedAt })).touchId;
    const second = (await seedWaitingTouch(tenantB, { scheduledAt: tiedAt })).touchId;
    [tiedLow, tiedHigh] = [first, second].sort();
  });

  it('returns my four touches in (scheduled_at ASC, id ASC) order', async () => {
    const page = await forAllTenants_approvalQueue();
    const mine = page.rows
      .filter((row) => [soon, later, tiedLow, tiedHigh].includes(row.touchId))
      .map((row) => row.touchId);

    // All four must be present — a cap that dropped one would fail here rather
    // than quietly weaken the ordering assertion below.
    expect(mine).toHaveLength(4);
    expect(mine).toEqual([soon, tiedLow, tiedHigh, later]);
  });

  it('orders the WHOLE page, not just the rows this suite seeded', async () => {
    // The property is about the SQL, and the SQL sees every tenant. A sort
    // applied in the page component would satisfy the assertion above and fail
    // this one the moment another client's row lands in the middle.
    const { rows } = await forAllTenants_approvalQueue();

    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1]!;
      const current = rows[i]!;
      const gap = current.scheduledAt.getTime() - previous.scheduledAt.getTime();
      expect(gap).toBeGreaterThanOrEqual(0);
      if (gap === 0) expect(current.touchId > previous.touchId).toBe(true);
    }
  });

  it('caps the rows and reports the TRUE total beside them', async () => {
    const page = await forAllTenants_approvalQueue();

    expect(page.rows.length).toBeLessThanOrEqual(APPROVAL_QUEUE_CAP);

    // Counted independently, over the same predicate, through a different
    // client — so `total` cannot be `rows.length` wearing a different name.
    // That equality is the only thing that can tell an operator the cap is
    // engaged; without it 50 waiting drafts and 500 render identically.
    const { count, error } = await admin
      .from('cadence_touches')
      .select('id', { count: 'exact', head: true })
      .in('status', [...APPROVAL_QUEUE_STATUSES]);

    expect(error).toBeNull();
    expect(page.total).toBe(count);
    expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
  });

  it('sorts BEFORE it limits, in SQL', () => {
    // The structural half. Sort-after-cap returns the same TYPE and is only
    // wrong about which rows — which no assertion over a database this suite
    // does not exclusively own can reliably catch.
    const source = readFileSync('src/db/repository/for-all-tenants.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const accessor = source.slice(source.indexOf('export async function forAllTenants_approvalQueue'));

    const order = accessor.indexOf('.orderBy(');
    const limit = accessor.indexOf('.limit(');
    expect(order).toBeGreaterThanOrEqual(0);
    expect(limit).toBeGreaterThan(order);
  });
});

/* ========================================================================= *
 * 2. The population rule — keyed on the touch (D-09)
 * ========================================================================= */

describe('the queue is built from TOUCH state, never from draft rows (D-09)', () => {
  let tenantId = '';

  beforeAll(async () => {
    tenantId = await newTenant('Queue Population');
  });

  it('includes a needs_draft touch with NO draft row, with null draft fields', async () => {
    // ── THE 05-04 GAP, AND THE REASON THE LEFT JOIN IS LEFT ───────────────
    //
    // A deterministic API refusal (400/401/403) records NO draft row at all, so
    // a touch can sit in `needs_draft` forever with nothing in `touch_drafts`.
    // An inner join would drop it — and it is precisely the row an operator
    // most needs to see, because nothing else will ever surface it.
    const { touchId } = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 31 * 86_400_000),
      touchStatus: 'needs_draft',
      withDraft: false,
    });

    const row = rowFor(await forAllTenants_approvalQueue(), touchId);

    expect(row.touchStatus).toBe('needs_draft');
    expect(row.draftId).toBeNull();
    expect(row.draftFinalBody).toBeNull();
    // The card still carries everything it needs to be acted on.
    expect(row.quoteDescription).toBe('Meter box and mains upgrade');
    expect(row.quoteId).toBeTruthy();
  });

  it('keeps a PAUSED cadence’s pending draft visible — the pause is context', async () => {
    // No cadence-status filter, deliberately (see the accessor's header). A
    // paused cadence's unapproved draft is still unapproved; hiding it would
    // make "nothing is waiting on me" and "everything is approved" render
    // identically, and would put this predicate out of step with the nav badge
    // and the stall alert, which must mean the same thing.
    const { touchId } = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 32 * 86_400_000),
      cadenceOverrides: { status: 'paused', pause_reason: 'client_paused' },
    });

    expect(rowFor(await forAllTenants_approvalQueue(), touchId).touchStatus).toBe(
      'pending_approval',
    );
  });

  it('carries no address column of any kind (T-2-02)', async () => {
    const { touchId } = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 33 * 86_400_000),
    });

    const row = rowFor(await forAllTenants_approvalQueue(), touchId);
    const keys = Object.keys(row);

    // The cadence snapshot holds a real mobile (`+61400000000` from the seed
    // helper). A card is approved by reading the MESSAGE, not by reading who it
    // is going to, so the mobile has no business crossing tenants.
    expect(keys).not.toContain('contactMobile');
    expect(keys).not.toContain('contactEmail');
    expect(JSON.stringify(row)).not.toContain('+61400000000');
  });

  it('excludes touches that are not waiting on the operator', async () => {
    // `scheduled` is not yet drafted and `approved` is already through the gate.
    // Neither is a thing to approve, and either appearing here would be a queue
    // that never empties.
    const notWaiting = await Promise.all([
      seedWaitingTouch(tenantId, {
        scheduledAt: new Date(Date.now() + 34 * 86_400_000),
        touchStatus: 'scheduled',
        withDraft: false,
      }),
      seedWaitingTouch(tenantId, {
        scheduledAt: new Date(Date.now() + 35 * 86_400_000),
        touchStatus: 'approved',
      }),
    ]);

    const { rows } = await forAllTenants_approvalQueue();
    const present = rows.map((row) => row.touchId);
    for (const seeded of notWaiting) {
      expect(present).not.toContain(seeded.touchId);
    }
  });
});

/* ========================================================================= *
 * 2b. Lead rows (Phase 13, 2026-10, 13-02, research Pitfall 1)
 * ========================================================================= */

describe('a lead touch waiting on a human is on the queue, as a lead (Phase 13)', () => {
  // 2026-10 (Phase 13, 13-02): since the tracer, a lead's touches 2 and 3 are
  // drafted and parked here. The row must arrive with no quote id, its kind
  // and its lead — the card renders it as a missed call with no quote link —
  // and the quote rows beside it must be exactly what they were.
  let tenantId = '';

  beforeAll(async () => {
    tenantId = await newTenant('Queue Lead Rows');
  });

  it('carries quoteId null, kind lead and the lead id, and is approvable through the core', async () => {
    const leadId = await seedLead(tenantId, { contact_mobile: '+61491570191' });
    const cadenceId = await seedLeadCadence(tenantId, leadId, { contact_mobile: '+61491570191' });
    const [touch] = await seedTouches(cadenceId, tenantId, [
      {
        status: 'pending_approval',
        scheduled_at: new Date(Date.now() + 36 * 86_400_000).toISOString(),
        touch_number: 2,
      },
    ]);
    const { data, error } = await admin
      .from('touch_drafts')
      .insert({
        tenant_id: tenantId,
        cadence_id: cadenceId,
        quote_id: null,
        touch_id: touch!.id,
        touch_number: 2,
        attempt: 1,
        model: 'claude-sonnet-5',
        prompt_version: 'p5',
        generated_body: 'Still need a hand?',
        final_body: `Still need a hand? ${SUFFIX}`,
        compliance_suffix: SUFFIX,
        merge_now: new Date().toISOString(),
        status: 'generated',
        segments: 1,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Seeding a lead draft failed: ${error.message}`);
    const draftId = (data as { id: string }).id;

    const row = rowFor(await forAllTenants_approvalQueue(), touch!.id);
    expect(row.quoteId).toBeNull();
    expect(row.kind).toBe('lead');
    expect(row.leadId).toBe(leadId);
    expect(row.draftId).toBe(draftId);
    expect(row.quoteDescription).toBeNull();
    // Still no address column, lead or not (T-2-02).
    expect(JSON.stringify(row)).not.toContain('+61491570191');

    expect(await approveUnchanged({ tenantId, touchId: touch!.id, draftId })).toEqual({
      kind: 'approved',
      edited: false,
    });
  });

  it('leaves a quote row as it was: kind quote, no lead, its quote id set', async () => {
    const { touchId, quoteId } = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 37 * 86_400_000),
    });

    const row = rowFor(await forAllTenants_approvalQueue(), touchId);
    expect(row.kind).toBe('quote');
    expect(row.leadId).toBeNull();
    expect(row.quoteId).toBe(quoteId);
    expect(row.quoteDescription).toBe('Meter box and mains upgrade');
  });
});

/* ========================================================================= *
 * 3. The write — through the ONE core, onto real rows
 * ========================================================================= */

describe('approving from the queue moves exactly one touch, through the core', () => {
  let tenantId = '';

  beforeAll(async () => {
    tenantId = await newTenant('Queue Approve');
  });

  async function touchStatus(touchId: string): Promise<string> {
    const { data } = await admin
      .from('cadence_touches')
      .select('status')
      .eq('id', touchId)
      .single();
    return (data as { status: string }).status;
  }

  async function draftRow(
    draftId: string,
  ): Promise<{ status: string; edit_distance: string | null; final_body: string }> {
    const { data } = await admin
      .from('touch_drafts')
      .select('status, edit_distance, final_body')
      .eq('id', draftId)
      .single();
    return data as { status: string; edit_distance: string | null; final_body: string };
  }

  it('approves the targeted touch and records edit_distance 0, never NULL (AI-04)', async () => {
    const target = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 36 * 86_400_000),
    });
    // A SECOND waiting touch for the same client, so "moved exactly one" is a
    // real claim rather than a vacuous one.
    const bystander = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 37 * 86_400_000),
    });

    const result = await approveUnchanged({
      tenantId,
      touchId: target.touchId,
      draftId: target.draftId!,
    });

    expect(result).toEqual({ kind: 'approved', edited: false });
    expect(await touchStatus(target.touchId)).toBe('approved');
    expect(await touchStatus(bystander.touchId)).toBe('pending_approval');

    const draft = await draftRow(target.draftId!);
    expect(draft.status).toBe('approved');
    // ── THE ZERO IS THE POINT ─────────────────────────────────────────────
    //
    // "Reviewed and untouched" is the data point V2-01 is gated on. A NULL here
    // is indistinguishable from "never approved", and `numeric` comes back as a
    // string so this is asserted as a NUMBER rather than by string equality
    // (the driver may render it '0' or '0.0000').
    expect(draft.edit_distance).not.toBeNull();
    expect(Number(draft.edit_distance)).toBe(0);

    // The card leaves the queue.
    const { rows } = await forAllTenants_approvalQueue();
    expect(rows.map((row) => row.touchId)).not.toContain(target.touchId);
  });

  it('reports SUCCESS on a double tap rather than an error', async () => {
    // Two taps from a phone on a patchy connection. `drafts.approve` is guarded
    // on the row not already being approved, so the second write flips nothing —
    // and calling that an error would invite a third tap.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 38 * 86_400_000),
    });
    const ids = { tenantId, touchId: seeded.touchId, draftId: seeded.draftId! };

    expect(await approveUnchanged(ids)).toEqual({ kind: 'approved', edited: false });
    expect(await approveUnchanged(ids)).toEqual({ kind: 'already_approved' });

    expect(await touchStatus(seeded.touchId)).toBe('approved');
  });

  it('REPAIRS a torn approval: approved draft + pending touch → touch approved (CR-01)', async () => {
    // The wedged state a pre-transaction interrupt produced: the draft row
    // flipped to `approved` but the touch never moved. Dispatch claims only
    // `approved` touches, so this message would never send while the queue
    // kept rendering the card forever. A second tap must REPAIR it, not
    // merely report `already_approved`.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 41 * 86_400_000),
    });

    // Tear the pair by hand, the way an interrupt between the two writes did
    // before the transaction existed: draft approved, touch untouched.
    const { error: tearError } = await admin
      .from('touch_drafts')
      .update({ status: 'approved', edit_distance: 0 })
      .eq('id', seeded.draftId!);
    expect(tearError).toBeNull();
    expect(await touchStatus(seeded.touchId)).toBe('pending_approval');

    const result = await approveUnchanged({
      tenantId,
      touchId: seeded.touchId,
      draftId: seeded.draftId!,
    });

    // The report reads as the double-tap success…
    expect(result).toEqual({ kind: 'already_approved' });
    // …and the repair actually happened: the touch is now claimable.
    expect(await touchStatus(seeded.touchId)).toBe('approved');
  });

  it('refuses a SUPERSEDED attempt and writes nothing', async () => {
    // The operator's page was rendered before a regeneration landed. Approving
    // the older attempt would send text the drafting pass had already replaced.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 39 * 86_400_000),
    });
    const older = seeded.draftId!;
    await seedDraftAttempt(
      tenantId,
      seeded.cadenceId,
      seeded.quoteId,
      seeded.touchId,
      1,
      { attempt: 2, final_body: `A newer draft. ${SUFFIX}` },
    );

    const result = await approveUnchanged({ tenantId, touchId: seeded.touchId, draftId: older });

    expect(result).toEqual({ kind: 'superseded' });
    expect(await touchStatus(seeded.touchId)).toBe('pending_approval');
    expect((await draftRow(older)).status).toBe('generated');
  });

  it('answers a FORGED draft/touch pair with the not-found outcome, no oracle', async () => {
    // A draft id that names no attempt of this touch is what a forged pair looks
    // like, and it gets the same answer as a touch with no attempts at all —
    // deliberately. Distinguishing them would turn the refusal into an existence
    // oracle over another client's drafts.
    const mine = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 40 * 86_400_000),
    });
    const strangerTenant = await newTenant('Queue Forged');
    const stranger = await seedWaitingTouch(strangerTenant, {
      scheduledAt: new Date(Date.now() + 41 * 86_400_000),
    });

    const forged = await approveUnchanged({
      tenantId,
      touchId: mine.touchId,
      draftId: stranger.draftId!,
    });
    const absent = await approveUnchanged({
      tenantId,
      touchId: mine.touchId,
      draftId: '00000000-0000-4000-8000-000000000000',
    });

    expect(forged).toEqual({ kind: 'not_found' });
    expect(absent).toEqual(forged);
    expect(await touchStatus(mine.touchId)).toBe('pending_approval');
    // And the stranger's draft is untouched — `forTenant` scoped the read.
    expect((await draftRow(stranger.draftId!)).status).toBe('generated');
  });

  it('cannot reach ANOTHER client’s touch, whatever the ids say', async () => {
    // The second layer of the cross-tenant defence, asserted rather than
    // assumed: the core reads and writes through `forTenant(<the tenant the
    // caller authorized>)`, so a fully valid pair belonging to somebody else
    // matches nothing.
    const strangerTenant = await newTenant('Queue Cross Tenant');
    const stranger = await seedWaitingTouch(strangerTenant, {
      scheduledAt: new Date(Date.now() + 42 * 86_400_000),
    });

    const result = await approveUnchanged({
      // The AUTHORIZED tenant is this suite's, and the ids are somebody else's.
      tenantId,
      touchId: stranger.touchId,
      draftId: stranger.draftId!,
    });

    expect(result).toEqual({ kind: 'not_found' });
    expect(await touchStatus(stranger.touchId)).toBe('pending_approval');
  });

  it('writes the operator’s own bytes and a real distance on edit-then-approve', async () => {
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 43 * 86_400_000),
    });
    const edited = `Checking in on that quote. ${SUFFIX}`;

    const result = await editThenApprove({
      tenantId,
      touchId: seeded.touchId,
      draftId: seeded.draftId!,
      editedBody: edited,
      tenantName: 'Test Business',
      timezone: 'Australia/Perth',
    });

    expect(result).toEqual({ kind: 'approved', edited: true });

    const draft = await draftRow(seeded.draftId!);
    expect(draft.final_body).toBe(edited);
    expect(draft.final_body).not.toBe(SEEDED_BODY);
    // A real, non-zero distance — the AI-04 measurement the edit-rate policy
    // (V2-01) is gated on, with the four decimal places the column must keep.
    expect(Number(draft.edit_distance)).toBeGreaterThan(0);
    expect(await touchStatus(seeded.touchId)).toBe('approved');
  });

  it('refuses an edit that deletes the compliance line, against real rows', async () => {
    // The Spam Act sender identification and opt-out line, on the only screen it
    // could be removed from. Pinned here as well as in the mocked suite because
    // the suffix comes off the DATABASE ROW (`compliance_suffix`), and a column
    // that stopped being written would make the mocked assertion vacuous.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 44 * 86_400_000),
    });

    const result = await editThenApprove({
      tenantId,
      touchId: seeded.touchId,
      draftId: seeded.draftId!,
      editedBody: 'Following up on that quote.',
      tenantName: 'Test Business',
      timezone: 'Australia/Perth',
    });

    expect(result.kind).toBe('violations');
    if (result.kind !== 'violations') return;
    expect(result.violations.map((violation) => violation.rule)).toContain('missing_suffix');

    // NOTHING was written — the draft stays approvable and the touch stays put.
    expect((await draftRow(seeded.draftId!)).status).toBe('generated');
    expect(await touchStatus(seeded.touchId)).toBe('pending_approval');
  });

  it('leaves approveWhere’s equality guard in charge of the touch', async () => {
    // A touch SKIPPED underneath an approval: the draft still flips (a human did
    // read and accept it, and that is evidence) but the touch does not move
    // backwards out of a terminal state. Dispatch reads the draft, so nothing
    // sends — which is the correct outcome, and the reason the zero-row case of
    // `approveWhere` is deliberately not an error.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 45 * 86_400_000),
    });

    await forTenant(tenantId).touches.skipWhere([seeded.touchId], 'cadence_stopped');

    const result = await approveUnchanged({
      tenantId,
      touchId: seeded.touchId,
      draftId: seeded.draftId!,
    });

    expect(result).toEqual({ kind: 'approved', edited: false });
    expect(await touchStatus(seeded.touchId)).toBe('skipped');
  });
});

/* ========================================================================= *
 * 4. The operator's own skip — the equality-guarded write (CON-01, D-02)
 * ========================================================================= */

describe('skipPendingWhere moves only what is still waiting on a human', () => {
  let tenantId = '';

  beforeAll(async () => {
    tenantId = await newTenant('Queue Skip');
  });

  async function touchRow(
    touchId: string,
  ): Promise<{ status: string; skip_reason: string | null }> {
    const { data } = await admin
      .from('cadence_touches')
      .select('status, skip_reason')
      .eq('id', touchId)
      .single();
    return data as { status: string; skip_reason: string | null };
  }

  it('skips a pending_approval touch and records operator_skipped', async () => {
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 46 * 86_400_000),
    });

    const moved = await forTenant(tenantId).touches.skipPendingWhere([seeded.touchId]);

    expect(moved).toHaveLength(1);
    expect(await touchRow(seeded.touchId)).toEqual({
      status: 'skipped',
      // The vocabulary member that names a PERSON rather than a rule. Phase 7
      // reads the difference, so a skip recorded under an engine reason would
      // be a real data defect, not a cosmetic one.
      skip_reason: 'operator_skipped',
    });

    // And it leaves the queue, which is the operator-visible half.
    const { rows } = await forAllTenants_approvalQueue();
    expect(rows.map((row) => row.touchId)).not.toContain(seeded.touchId);
  });

  it('skips a needs_draft touch that has NO draft row at all (the 05-04 gap)', async () => {
    // The touch an operator most wants to take off the schedule: drafting has
    // refused it deterministically and will keep refusing it. A guard keyed on
    // `pending_approval` alone would leave it stuck forever.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 47 * 86_400_000),
      touchStatus: 'needs_draft',
      withDraft: false,
    });

    const moved = await forTenant(tenantId).touches.skipPendingWhere([seeded.touchId]);

    expect(moved).toHaveLength(1);
    expect((await touchRow(seeded.touchId)).status).toBe('skipped');
  });

  it('CANNOT skip an APPROVED touch — zero rows, nothing changed (Pitfall 3, T-6-09)', async () => {
    // ── THE TEST THIS WHOLE METHOD EXISTS FOR ─────────────────────────────
    //
    // A queue card rendered ninety seconds ago, and a colleague approved this
    // touch in between. `skipWhere`'s guard is `notInArray(TERMINAL_…)`, and
    // `approved` is NOT terminal — so reusing it here would let the stale card
    // silently un-approve a message somebody had already read and cleared, and
    // the operator would be told the skip worked.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 48 * 86_400_000),
    });

    const approval = await approveUnchanged({
      tenantId,
      touchId: seeded.touchId,
      draftId: seeded.draftId!,
    });
    expect(approval).toEqual({ kind: 'approved', edited: false });

    const moved = await forTenant(tenantId).touches.skipPendingWhere([seeded.touchId]);

    expect(moved).toEqual([]);
    expect(await touchRow(seeded.touchId)).toEqual({ status: 'approved', skip_reason: null });
  });

  it('cannot skip a SENT touch either, and does not overwrite an existing skip reason', async () => {
    const sent = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 49 * 86_400_000),
      touchStatus: 'sent',
    });
    const alreadySkipped = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 50 * 86_400_000),
    });
    await forTenant(tenantId).touches.skipWhere([alreadySkipped.touchId], 'cadence_stopped');

    const moved = await forTenant(tenantId).touches.skipPendingWhere([
      sent.touchId,
      alreadySkipped.touchId,
    ]);

    expect(moved).toEqual([]);
    expect((await touchRow(sent.touchId)).status).toBe('sent');
    // The engine's reason survives: the operator did not skip this one, and a
    // rewrite would make Phase 7 read a rule's decision as a person's.
    expect(await touchRow(alreadySkipped.touchId)).toEqual({
      status: 'skipped',
      skip_reason: 'cadence_stopped',
    });
  });

  it('leaves the rest of the cadence alone — a skip is not a stop (D-02)', async () => {
    const [quote] = await seedQuotes(tenantId, [{ job_description: 'Switchboard replacement' }]);
    const cadenceId = await seedCadence(tenantId, quote!.id);
    const base = Date.now() + 51 * 86_400_000;
    const touches = await seedTouches(cadenceId, tenantId, [
      { touch_number: 1, status: 'pending_approval', scheduled_at: new Date(base).toISOString() },
      {
        touch_number: 2,
        status: 'scheduled',
        scheduled_at: new Date(base + 86_400_000).toISOString(),
      },
      {
        touch_number: 3,
        status: 'scheduled',
        scheduled_at: new Date(base + 2 * 86_400_000).toISOString(),
      },
    ]);

    await forTenant(tenantId).touches.skipPendingWhere([touches[0]!.id]);

    expect((await touchRow(touches[0]!.id)).status).toBe('skipped');
    // THE OTHER TWO ARE UNTOUCHED, including their slots. There is no defer:
    // the skipped message is gone and the sequence carries on unchanged.
    expect(await touchRow(touches[1]!.id)).toEqual({ status: 'scheduled', skip_reason: null });
    expect(await touchRow(touches[2]!.id)).toEqual({ status: 'scheduled', skip_reason: null });
  });

  it('cannot reach ANOTHER client’s touch, whatever the id says', async () => {
    const strangerTenant = await newTenant('Queue Skip Cross Tenant');
    const stranger = await seedWaitingTouch(strangerTenant, {
      scheduledAt: new Date(Date.now() + 52 * 86_400_000),
    });

    const moved = await forTenant(tenantId).touches.skipPendingWhere([stranger.touchId]);

    expect(moved).toEqual([]);
    expect((await touchRow(stranger.touchId)).status).toBe('pending_approval');
    // And the re-read the action makes is scoped the same way, so the honest
    // report cannot become an existence oracle over somebody else's schedule.
    expect(await forTenant(tenantId).touches.statusOf(stranger.touchId)).toBeNull();
  });

  it('statusOf reports the state the honest sentence is chosen from', async () => {
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 53 * 86_400_000),
    });

    expect(await forTenant(tenantId).touches.statusOf(seeded.touchId)).toEqual({
      status: 'pending_approval',
      skipReason: null,
    });

    await approveUnchanged({ tenantId, touchId: seeded.touchId, draftId: seeded.draftId! });

    // This is the exact pair the zero-row branch turns into "This one was
    // already approved." — the sentence is chosen from a re-read, never from
    // what the stale card believed.
    expect(await forTenant(tenantId).touches.statusOf(seeded.touchId)).toEqual({
      status: 'approved',
      skipReason: null,
    });
  });

  it('is a DIFFERENT statement from skipWhere, guarded on the source statuses', () => {
    // The structural half, and it is worth asserting because the two methods are
    // eight lines apart and differ in one predicate. Widening `skipWhere` and
    // deleting this one would pass every behavioural test above on the day it
    // was done and fail them the first time two people used the console at once.
    const source = readFileSync('src/db/repository/for-tenant.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const skipPending = source.slice(
      source.indexOf('skipPendingWhere:'),
      source.indexOf('statusOf:'),
    );

    expect(skipPending).toContain('STALLABLE_TOUCH_STATUSES');
    expect(skipPending).toContain("skipReason: 'operator_skipped'");
    // NEVER the not-terminal guard: `approved` is not terminal.
    expect(skipPending).not.toContain('TERMINAL_TOUCH_STATUSES');
    // The reason is written here, not taken as a parameter — nothing may record
    // an engine rule's vocabulary through the human-guarded write.
    expect(skipPending).not.toContain('skipReason: TouchSkipReason');
  });
});

/* ========================================================================= *
 * 5. The skip's COPY — the honest sentence for a write that moved nothing
 * ========================================================================= */

describe('a zero-row skip is never reported as a success (Pitfall 3)', () => {
  it('names the specific thing that happened instead', () => {
    expect(skipControlState({ kind: 'skipped' })).toEqual({
      error: null,
      success: TOUCH_SKIPPED_MESSAGE,
      settled: true,
    });

    // An ERROR, and settled: the operator asked for something and did not get
    // it, and the card must stop offering the button that will answer the same
    // way again.
    const stale = skipControlState({ kind: 'stale', status: 'approved' });
    expect(stale.success).toBeNull();
    expect(stale.error).toContain('already approved');
    expect(stale.settled).toBe(true);

    expect(skipControlState({ kind: 'stale', status: 'sent' }).error).toContain('already gone out');
    expect(skipControlState({ kind: 'stale', status: 'skipped' }).error).toContain(
      'already skipped',
    );
  });

  it('answers a status it has no entry for with a sentence, never snake_case', () => {
    // A touch status added to the schema later must reach the operator as
    // something they can act on. The house rule is a map, and the fallback is
    // what keeps the map from being a liability the day it is out of date.
    const unknown = skipControlState({ kind: 'stale', status: 'awaiting_dispatch' });
    expect(unknown.error).toBe(SKIP_MOVED_ON_MESSAGE);
    expect(unknown.error).not.toContain('_');
  });

  it('does not settle a not-found row — that one is worth retrying', () => {
    const missing = skipControlState({ kind: 'not_found' });
    expect(missing.error).toBeTruthy();
    expect(missing.settled).toBeUndefined();
  });

  it('states BOTH halves in the confirm sentence: this one goes, the rest stays', () => {
    const sentence = skipConsequence(3);
    expect(sentence).toBe('Touch #3 will never send. The rest of the cadence carries on.');
  });
});

/* ========================================================================= *
 * 6. The card's own contracts — one derivation, no forked copy (D-12)
 * ========================================================================= */

describe('the queue renders through the shared derivations, not its own', () => {
  /** Source with prose stripped, so a comment may NAME what the code may not do. */
  function code(path: string): string {
    return readFileSync(path, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  }

  const QUEUE_FILES = [
    'src/app/(console)/queue/page.tsx',
    'src/app/(console)/queue/queue-card.tsx',
  ];

  it('derives urgency from stall-policy and spells no threshold of its own', () => {
    const page = code('src/app/(console)/queue/page.tsx');

    expect(page).toContain("from '@/core/aging/stall-policy'");
    expect(page).toContain('deriveUrgency(row.scheduledAt, now)');

    for (const path of QUEUE_FILES) {
      const source = code(path);
      // ── THE ONE-DERIVATION RULE, AS AN ABSENCE ─────────────────────────
      //
      // A second threshold here would not crash: it would render a `due soon`
      // badge beside a stall alert that disagrees, which teaches an operator
      // that the colour means nothing. The number 4 and the hour in
      // milliseconds are the two shapes it would take.
      expect(source).not.toMatch(/3_?600_?000/);
      // Not even a REFERENCE to the constant or the boundary helper: the queue
      // asks `deriveUrgency` the question, it does not do the arithmetic. A file
      // holding `STALL_THRESHOLD_HOURS` is one edit from holding a comparison.
      expect(source).not.toContain('STALL_THRESHOLD_HOURS');
      expect(source).not.toContain('stallBoundary');
    }
  });

  it('maps every urgency tier to a badge class and a label — no string munging', () => {
    const card = code('src/app/(console)/queue/queue-card.tsx');

    // A `Record<UrgencyTier, string>` makes a new tier a COMPILE error rather
    // than a neutral pill somebody notices in three weeks.
    expect(card).toContain('Record<UrgencyTier, string>');
    for (const tier of Object.keys(URGENCY_LABELS)) {
      expect(card).toContain(tier);
    }
    // The house rule, asserted as an absence: labels are maps.
    expect(card).not.toContain(".replace('_'");
    expect(card).not.toContain('.replace("_"');
  });

  it('offers NO approve or edit control on a card with no draft (Pitfall 4)', () => {
    // The DOM mirroring a server-side refusal. `approveUnchanged` answers
    // `not_found` for a touch with no attempts (asserted below against real
    // rows), so a button here would be a tap that cannot land.
    const card = code('src/app/(console)/queue/queue-card.tsx');
    const noDraft = card.slice(
      card.indexOf('if (row.draft === null)'),
      card.indexOf('<DraftCard'),
    );

    expect(noDraft).toContain('no draft yet');
    expect(noDraft).toContain('skipControl');
    expect(noDraft).toContain('Open the quote');
    expect(noDraft).not.toContain('approveFromQueue');
    expect(noDraft).not.toContain('editAndApproveFromQueue');
    expect(noDraft).not.toContain('DraftCard');
  });

  it('renders the failed-fact-check card through the SHARED component, not a copy', () => {
    // The failed-draft badge, the `role="alert"` sentence and the edit-only
    // controls all live in `components/draft-card.tsx`. Byte-verbatim parity
    // with the quote page is therefore structural: there is one string.
    const card = code('src/app/(console)/queue/queue-card.tsx');
    const review = code('src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx');

    expect(card).toContain("from '@/app/(console)/components/draft-card'");
    expect(review).toContain('components/draft-card');
    for (const source of [card, review]) {
      expect(source).not.toContain('failed the fact check');
      expect(source).not.toContain('The fact check refused this message');
    }
  });

  it('adopts the 05-08 stacking modifier rather than forking it', () => {
    const card = code('src/app/(console)/queue/queue-card.tsx');
    const css = readFileSync('src/app/globals.css', 'utf-8');

    expect(card).toContain('touch-when touch-when--stack');
    // The rule that makes a long pill wrap inside an intact border below
    // 22.5rem — the whole reason to reuse the modifier instead of writing one.
    expect(css).toContain('@media (max-width: 22.5rem)');
    expect(css).toMatch(/\.touch-when--stack \.badge \{\s*white-space: normal;/);
  });

  it('.button-quiet spends no --error and hard-codes no colour', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    const rule = css.slice(css.indexOf('.button-quiet {'), css.indexOf('.controls .button-quiet'));

    expect(rule).toContain('background: transparent');
    expect(rule).toContain('border: 1px solid var(--line)');
    expect(rule).toContain('color: var(--fg)');
    expect(rule).toContain('min-height: 2.75rem');
    // ── THE ARMED KILL STAYS THE ONLY RED CONTROL (D-02) ────────────────
    expect(rule).not.toContain('--error');
    // A hex in a new rule renders the light value against a dark background.
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

/* ========================================================================= *
 * 7. Edit-then-approve parity — the two surfaces, one core (CR-02)
 * ========================================================================= */

describe('the queue and the quote page approve identically', () => {
  let tenantId = '';

  beforeAll(async () => {
    tenantId = await newTenant('Queue Parity');
  });

  it('produces IDENTICAL draft rows for the same edit from either surface', async () => {
    // Both surfaces call `editThenApprove` with the tenant name and timezone
    // their own `authorize()` read returned. Two touches seeded identically,
    // edited identically, through that one entry point: any divergence in what
    // a surface passes shows up as a different row here.
    const base = Date.now() + 54 * 86_400_000;
    const viaQueue = await seedWaitingTouch(tenantId, { scheduledAt: new Date(base) });
    const viaQuote = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(base + 3_600_000),
    });
    const edited = `Just checking in on that quote for you. ${SUFFIX}`;

    for (const seeded of [viaQueue, viaQuote]) {
      const result = await editThenApprove({
        tenantId,
        touchId: seeded.touchId,
        draftId: seeded.draftId!,
        editedBody: edited,
        tenantName: 'Test Business',
        timezone: 'Australia/Perth',
      });
      expect(result).toEqual({ kind: 'approved', edited: true });
    }

    const [a, b] = await Promise.all([
      draftRowOf(viaQueue.draftId!),
      draftRowOf(viaQuote.draftId!),
    ]);

    expect(a.final_body).toBe(edited);
    expect(a.final_body).toBe(b.final_body);
    expect(a.status).toBe(b.status);
    // Measured against `normalized_body`, so the SAME edit scores the same on
    // both surfaces — the AI-04 number V2-01's edit-rate policy is gated on.
    expect(Number(a.edit_distance)).toBe(Number(b.edit_distance));
    expect(Number(a.edit_distance)).toBeGreaterThan(0);
  });

  it('both action files delegate the edit, and neither re-derives it', () => {
    const queue = readFileSync('src/app/(console)/queue/actions.ts', 'utf-8');
    const quote = readFileSync(
      'src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts',
      'utf-8',
    );

    for (const source of [queue, quote]) {
      expect(source).toContain('editThenApprove');
      // The tenant facts come from the gate's OWN RLS read, never the form —
      // the suffix an edited body must keep and the zone the quote date was
      // rendered in are both authorization-derived facts.
      expect(source).toContain('access.name');
      expect(source).toContain('access.timezone');
      // Neither surface may hold a second copy of what the core decides.
      expect(source).not.toContain('buildFactWhitelist');
      expect(source).not.toContain('editDistance');
    }
  });

  it('refuses to approve a touch that has no draft at all — the server half', async () => {
    // What the missing buttons on the no-draft card mirror. A Server Action id
    // is POSTable without rendering anything, so the DOM's silence is a
    // courtesy and THIS is the enforcement.
    const seeded = await seedWaitingTouch(tenantId, {
      scheduledAt: new Date(Date.now() + 55 * 86_400_000),
      touchStatus: 'needs_draft',
      withDraft: false,
    });

    const result = await approveUnchanged({
      tenantId,
      touchId: seeded.touchId,
      draftId: '00000000-0000-4000-8000-000000000000',
    });

    expect(result).toEqual({ kind: 'not_found' });
    expect(
      (await forTenant(tenantId).touches.statusOf(seeded.touchId))?.status,
    ).toBe('needs_draft');
  });
});

async function draftRowOf(
  draftId: string,
): Promise<{ status: string; edit_distance: string | null; final_body: string }> {
  const { data } = await admin
    .from('touch_drafts')
    .select('status, edit_distance, final_body')
    .eq('id', draftId)
    .single();
  return data as { status: string; edit_distance: string | null; final_body: string };
}
