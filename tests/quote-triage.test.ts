/**
 * D-15: operator triage is the ONLY path from backfilled to chase-eligible.
 *
 * This suite exists because the prohibition it guards is a promise made to the
 * client's brand, not a nicety: a newly connected tradie's 90-day backfill can
 * contain months-old quotes that were already declined over the phone, already
 * won off-system, or belong to a customer they never want contacted again.
 * Chasing that pile automatically is the single fastest way to lose a design
 * partner, and no amount of good copy makes up for it.
 *
 * So the property under test is not "the checkbox works". It is:
 *
 *   1. Nothing becomes chase-eligible except by an explicit save naming it.
 *   2. Every flip emits EXACTLY ONE `quote_opened` — the stream Phase 3 acts
 *      on. One too few is a quote nobody chases (silent). One too many is a
 *      customer texted twice about the same job (loud, and the client hears
 *      about it).
 *   3. The tenant closure holds: another client's quote id flips nothing, even
 *      when the caller passes it deliberately.
 *
 * The idempotence mechanism is the WHERE clause — `chase_eligibility =
 * 'needs_review'` is evaluated by Postgres inside the same statement that does
 * the update, so a double-submitted form cannot flip a row twice regardless of
 * timing. The double-save test below is what proves that mechanism is actually
 * the one in use, rather than a check-then-write that happens to be fast.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { markChaseEligible } from '@/core/sync/eligibility';
import { closeDb } from '@/db/repository';

import { admin, seedQuotes, seedTenant, teardownTenants } from './helpers/seed';

const tenantIds: string[] = [];

/** The instant the quote was issued upstream — what `occurred_at` must carry. */
const QUOTE_DATE = '2026-06-01T02:30:00.000Z';

interface EventRow {
  quote_id: string;
  sm8_job_uuid: string;
  from_status: string;
  to_status: string;
  event_type: string;
  occurred_at: string | null;
}

async function eventsFor(tenantId: string): Promise<EventRow[]> {
  const { data, error } = await admin
    .from('quote_status_events')
    .select('quote_id, sm8_job_uuid, from_status, to_status, event_type, occurred_at')
    .eq('tenant_id', tenantId)
    .order('id', { ascending: true });
  if (error) throw new Error(`Reading events failed: ${error.message}`);
  return (data ?? []) as EventRow[];
}

async function eligibilityOf(quoteId: string): Promise<string> {
  const { data, error } = await admin
    .from('quotes')
    .select('chase_eligibility')
    .eq('id', quoteId)
    .single();
  if (error) throw new Error(`Reading a quote failed: ${error.message}`);
  return (data as { chase_eligibility: string }).chase_eligibility;
}

/** A tenant with the four quote shapes triage has to tell apart. */
async function seedTriageTenant(prefix: string) {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);

  const [needsReviewA, needsReviewB, alreadyEligible, won, lost] = await seedQuotes(tenantId, [
    { chase_eligibility: 'needs_review', quote_date_utc: QUOTE_DATE },
    { chase_eligibility: 'needs_review', quote_date_utc: QUOTE_DATE },
    { chase_eligibility: 'eligible', quote_date_utc: QUOTE_DATE },
    { status: 'Work Order', chase_eligibility: 'needs_review', quote_date_utc: QUOTE_DATE },
    { status: 'Unsuccessful', chase_eligibility: 'needs_review', quote_date_utc: QUOTE_DATE },
  ]);

  return { tenantId, needsReviewA, needsReviewB, alreadyEligible, won, lost };
}

beforeAll(async () => {
  // The suite's own seeding uses the service-role client; nothing here depends
  // on an allowlist or a signed-in session.
});

afterAll(async () => {
  await teardownTenants(tenantIds);
  await closeDb();
});

describe('markChaseEligible — the D-15 gate', () => {
  it('flips ticked needs_review quotes and emits exactly one quote_opened each', async () => {
    const seeded = await seedTriageTenant('Triage Flip');

    const result = await markChaseEligible(seeded.tenantId, [
      seeded.needsReviewA.id,
      seeded.needsReviewB.id,
    ]);

    expect(result.flipped).toBe(2);
    expect(result.eventsEmitted).toBe(2);

    expect(await eligibilityOf(seeded.needsReviewA.id)).toBe('eligible');
    expect(await eligibilityOf(seeded.needsReviewB.id)).toBe('eligible');

    const events = await eventsFor(seeded.tenantId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.quote_id).sort()).toEqual(
      [seeded.needsReviewA.id, seeded.needsReviewB.id].sort(),
    );
  });

  it('writes the outbox row Phase 3 expects — first-sight, opened, upstream timestamp', async () => {
    const seeded = await seedTriageTenant('Triage Shape');

    await markChaseEligible(seeded.tenantId, [seeded.needsReviewA.id]);

    const [event] = await eventsFor(seeded.tenantId);
    expect(event.event_type).toBe('quote_opened');
    // '(new)' — we never watched this quote transition INTO Quote; the operator
    // approving it is the first thing that ever happened to it under our watch.
    expect(event.from_status).toBe('(new)');
    expect(event.to_status).toBe('Quote');
    expect(event.sm8_job_uuid).toBe(seeded.needsReviewA.sm8_job_uuid);
    // When the tradie issued the quote, NOT when the operator ticked the box —
    // `detected_at` already records the latter, and Phase 3's cadence offsets
    // are measured from the former.
    expect(new Date(event.occurred_at!).toISOString()).toBe(QUOTE_DATE);
  });

  it('leaves unticked quotes needs_review and re-triageable', async () => {
    const seeded = await seedTriageTenant('Triage Unticked');

    await markChaseEligible(seeded.tenantId, [seeded.needsReviewA.id]);

    expect(await eligibilityOf(seeded.needsReviewB.id)).toBe('needs_review');

    // ...and a later save picks it up, which is the whole point of "unticked
    // is not a decision, it is a not-yet".
    const second = await markChaseEligible(seeded.tenantId, [seeded.needsReviewB.id]);
    expect(second.flipped).toBe(1);
    expect(await eligibilityOf(seeded.needsReviewB.id)).toBe('eligible');
  });

  it('flips nothing and emits nothing for an already-eligible quote', async () => {
    const seeded = await seedTriageTenant('Triage Already');

    const result = await markChaseEligible(seeded.tenantId, [seeded.alreadyEligible.id]);

    expect(result.flipped).toBe(0);
    expect(result.eventsEmitted).toBe(0);
    expect(await eventsFor(seeded.tenantId)).toHaveLength(0);
  });

  it('flips nothing for a won or lost quote — eligibility is an open-quote question', async () => {
    const seeded = await seedTriageTenant('Triage Closed');

    const result = await markChaseEligible(seeded.tenantId, [seeded.won.id, seeded.lost.id]);

    expect(result.flipped).toBe(0);
    expect(result.eventsEmitted).toBe(0);
    expect(await eligibilityOf(seeded.won.id)).toBe('needs_review');
    expect(await eligibilityOf(seeded.lost.id)).toBe('needs_review');
    expect(await eventsFor(seeded.tenantId)).toHaveLength(0);
  });

  it('flips nothing for ANOTHER tenant’s quote id, passed deliberately (T-2-13)', async () => {
    const mine = await seedTriageTenant('Triage Mine');
    const theirs = await seedTriageTenant('Triage Theirs');

    const result = await markChaseEligible(mine.tenantId, [
      theirs.needsReviewA.id,
      theirs.needsReviewB.id,
    ]);

    expect(result.flipped).toBe(0);
    expect(result.eventsEmitted).toBe(0);
    expect(await eligibilityOf(theirs.needsReviewA.id)).toBe('needs_review');
    expect(await eventsFor(mine.tenantId)).toHaveLength(0);
    expect(await eventsFor(theirs.tenantId)).toHaveLength(0);
  });

  it('mixes safely: a valid id alongside a foreign one flips only the valid one', async () => {
    const mine = await seedTriageTenant('Triage Mixed');
    const theirs = await seedTriageTenant('Triage Mixed Other');

    const result = await markChaseEligible(mine.tenantId, [
      mine.needsReviewA.id,
      theirs.needsReviewA.id,
      randomUUID(),
    ]);

    expect(result.flipped).toBe(1);
    expect(result.eventsEmitted).toBe(1);
    expect(await eligibilityOf(theirs.needsReviewA.id)).toBe('needs_review');
  });

  it('is idempotent: the second save flips 0 and the event count does not move', async () => {
    const seeded = await seedTriageTenant('Triage Double');
    const ids = [seeded.needsReviewA.id, seeded.needsReviewB.id];

    const first = await markChaseEligible(seeded.tenantId, ids);
    const afterFirst = await eventsFor(seeded.tenantId);

    const second = await markChaseEligible(seeded.tenantId, ids);
    const afterSecond = await eventsFor(seeded.tenantId);

    expect(first.flipped).toBe(2);
    expect(second.flipped).toBe(0);
    expect(second.eventsEmitted).toBe(0);
    // The assertion that matters: a re-submitted form cannot double the stream
    // Phase 3 acts on.
    expect(afterSecond).toHaveLength(afterFirst.length);
  });

  it('does nothing at all for an empty selection', async () => {
    const seeded = await seedTriageTenant('Triage Empty');

    const result = await markChaseEligible(seeded.tenantId, []);

    expect(result.flipped).toBe(0);
    expect(result.eventsEmitted).toBe(0);
    expect(await eligibilityOf(seeded.needsReviewA.id)).toBe('needs_review');
    expect(await eventsFor(seeded.tenantId)).toHaveLength(0);
  });
});

/** Strip comments before asserting on a source file. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/*
 * THE `quotes table contract (source assertions, D-16)` BLOCK LIVED HERE, AND
 * HAS MOVED TO `tests/pipeline-grouping.test.ts` (06-06).
 *
 * Two reasons, and the second is the load-bearing one:
 *
 *  1. Three of its five assertions pinned the `?status=` filter — the
 *     filter→statuses map, the "unrecognised param resolves to open" rule, and
 *     the third empty state ("Switch the filter to see won and lost quotes.").
 *     D-18 supersedes that control with the pipeline grouping, so there is no
 *     slice for an operator to be stranded in and no param to resolve. The
 *     QUESTIONS they asked (is the won/lost history still reachable, is an empty
 *     list diagnosed rather than blanked) are still live and are asked of the
 *     grouping in the new home.
 *
 *  2. THIS FILE IS A DATABASE SUITE. It reads `helpers/seed`, which trips the
 *     WR-09 disposable-stack gate at import, so under a bare `npm test` this
 *     whole file errors out and every assertion in it — including five that
 *     need no database at all — is a check nobody runs except during a
 *     sanctioned remote run. A source assertion behind a remote gate is a
 *     source assertion that rots. The pure suite runs them on every commit.
 *
 * The triage console block below is in the same position and should move the
 * next time it is edited; it is left alone here rather than rewritten as a side
 * effect of a plan about grouping.
 */

describe('triage console contract (source assertions)', () => {
  const FORM = code(readFileSync('src/app/(console)/clients/[id]/triage-form.tsx', 'utf8'));
  const ACTIONS = code(readFileSync('src/app/(console)/clients/[id]/actions.ts', 'utf8'));
  const PAGE = code(readFileSync('src/app/(console)/clients/[id]/page.tsx', 'utf8'));
  const CSS = readFileSync('src/app/globals.css', 'utf8');

  it('wraps every checkbox in a label carrying the 44px row rule', () => {
    // A bare checkbox is a ~16px target. On a phone, mis-taps in a triage list
    // do not fail loudly — they approve the wrong quote.
    expect(FORM).toMatch(/<label[^>]*className="triage-row"/);
    expect(FORM).toMatch(/type="checkbox"/);

    const rule = CSS.match(/\.triage-row\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/min-height:\s*2\.75rem/);
  });

  it('carries the UI-SPEC explainer and the single primary CTA', () => {
    expect(FORM).toContain('Backfilled open quotes start as');
    expect(FORM).toContain('nothing is followed up until you save it here.');
    expect(FORM).toContain('Save eligibility');
  });

  it('renders "Nothing needs review." rather than vanishing when triage is done', () => {
    // A section that disappears reads as a missing feature; the operator cannot
    // tell "done" from "broken".
    expect(`${FORM}${PAGE}`).toContain('Nothing needs review.');
  });

  it('authorizes BEFORE it reads formData (WR-01 order)', () => {
    const body =
      ACTIONS.match(/export async function saveEligibilityAction[\s\S]*?\n}/)?.[0] ?? '';
    expect(body).not.toBe('');

    const authAt = body.search(/authorize\s*\(/);
    const formAt = body.search(/formData\./);
    expect(authAt).toBeGreaterThan(-1);
    expect(formAt).toBeGreaterThan(-1);
    // Server Action IDs are global: this action is POST-able from any route,
    // and it is the one that creates cadence-actionable events (T-2-13).
    expect(authAt).toBeLessThan(formAt);
  });

  it('validates the submitted ids as uuids before they reach the repository', () => {
    // The schema is a module constant (the same shape as `connectSchema`), so
    // the assertion is in two halves: the schema demands uuids, and the action
    // actually runs it before calling through.
    const schema = ACTIONS.match(/const eligibilitySchema[\s\S]*?\n\}\);/)?.[0] ?? '';
    expect(schema).toMatch(/z\.array\(z\.uuid\(\)\)/);

    const body =
      ACTIONS.match(/export async function saveEligibilityAction[\s\S]*?\n}/)?.[0] ?? '';
    const parseAt = body.search(/eligibilitySchema\.safeParse/);
    const callAt = body.search(/markChaseEligible\s*\(/);
    expect(parseAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(parseAt);
  });
});
