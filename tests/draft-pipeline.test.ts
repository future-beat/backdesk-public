/**
 * THE 05-01 TRACER, end to end against the real database.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ needs_draft → [model] → pending_approval → [human] → approved →          │
 * │ SendRequest.body                                                         │
 * │                                                                          │
 * │ Every arrow is a real write to the hosted Postgres. Only the MODEL is    │
 * │ faked.                                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THE CLIENT IS FAKE AND NOTHING ELSE IS ──────────────────────────────
 *
 * The claims this file makes are about the STATE MACHINE and the BYTES: that a
 * draft cannot skip the approval gate, that dispatch refuses without one, and
 * that the string a human approved is the string that reaches the sender. None
 * of those are claims about Claude, and a suite that called the real API would
 * pay a per-run cost and a flake risk to test something it is not asking about.
 *
 * The seam that DOES need a real call — "does the API accept the request shape
 * we build" — is closed by `npm run verify:drafting`, which makes two real
 * calls against synthetic data. The two are complements: this file proves the
 * plumbing, that script proves the connection.
 *
 * ── THE NEGATIVE ASSERTIONS ARE THE POINT ───────────────────────────────────
 *
 * A test that only walked the happy path would pass just as well against the
 * Phase 3 auto-pass gate it replaced. So the ones that matter are:
 *
 *   - dispatch REFUSES while the touch is `pending_approval` (D-12 is real)
 *   - `promoteDue` CANNOT produce `approved` (the gate has one source status)
 *   - a THROWING client leaves the touch in `needs_draft` with no draft row
 *     (D-10: no fallback, ever)
 *   - a tenant with no APPROVED template is not drafted for (ONB-03)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dispatchDueTouches } from '../src/core/cadence/dispatch';
import { DRAFT_MODEL, draftTouches, type DraftClient } from '../src/core/drafting/draft-touches';
import { PROMPT_VERSION } from '../src/core/drafting/prompt';
import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { isInsideWindow, type ContactWindow } from '../src/core/cadence/window';
import { closeDb, forTenant } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedCadenceSettings,
  seedConnection,
  seedMessageTemplate,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const WINDOW: ContactWindow = {
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

const MS_PER_HOUR = 3_600_000;

/** The first whole hour after `from` at which this tenant may be messaged. */
function firstOpenHour(from: number): Date {
  for (let step = 1; step <= 24 * 14; step += 1) {
    const candidate = new Date(from + step * MS_PER_HOUR);
    if (isInsideWindow(candidate, WINDOW)) return candidate;
  }
  throw new Error('The contact window never opens within a fortnight.');
}

class CapturingSender implements TouchSender {
  readonly provider = 'stub';
  readonly sent: SendRequest[] = [];

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return { kind: 'sent', provider: this.provider, providerMessageId: null };
  }
}

/** A model that returns one fixed body, and counts how often it was asked. */
function fakeClient(body: string): DraftClient & { calls: number } {
  const client = {
    calls: 0,
    messages: {
      parse: async () => {
        client.calls += 1;
        return {
          parsed_output: { body },
          usage: { input_tokens: 812, output_tokens: 41, cache_read_input_tokens: 0 },
        };
      },
    },
  };
  return client;
}

/** A model that is down. The D-10 case. */
const throwingClient: DraftClient = {
  messages: {
    parse: async () => {
      throw new Error('upstream exploded');
    },
  },
};

const DRAFT_BODY = 'Hi Robin, just checking in on the meter box quote. Any questions? Mick';

let tenantId: string;
let onboardingTenantId: string;
let cadenceId: string;
let touchId: string;
let touchNumber: number;
let dueAt: Date;
let templateId: string;

beforeAll(async () => {
  tenantId = await seedTenant('Draft Pipeline');
  onboardingTenantId = await seedTenant('Draft Pipeline Onboarding');
  await seedConnection(tenantId);
  await seedConnection(onboardingTenantId);

  // THE VOICE ROW. `create_tenant` does not write one; in production
  // `consume-events` calls `settings.ensure()` before it materializes a single
  // touch, so every touch that can reach drafting has one. These suites seed
  // cadences with the admin client and bypass that path, so the invariant has
  // to be seeded explicitly — 05-04's drafting pass refuses a tenant with no
  // `cadence_settings` row rather than inventing a voice for them.
  await seedCadenceSettings(tenantId);
  await seedCadenceSettings(onboardingTenantId);

  // The words. APPROVED — an unapproved version would be the ONB-03 case.
  const template = await seedMessageTemplate(tenantId, 1, {
    body: 'Friendly check-in on the quote, ask if they have any questions.',
  });
  templateId = template.id;

  const [quote] = await seedQuotes(tenantId, [
    {
      job_description: 'Replace meter box and mains upgrade',
      chase_eligibility: 'eligible',
      total_invoice_amount: '2450.00',
    },
  ]);

  cadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Robin Vasquez',
    // ACMA fiction block — a live number in a fixture is a live number
    // somebody eventually sends to.
    contact_mobile: '+61491570158',
  });

  dueAt = firstOpenHour(Date.now());
  const [touch] = await seedTouches(cadenceId, tenantId, [
    {
      status: 'needs_draft',
      scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
      original_offset_days: 0,
    },
  ]);
  touchId = touch.id;
  touchNumber = touch.touch_number;
});

afterAll(async () => {
  await teardownTenants([tenantId, onboardingTenantId]);
  await closeDb();
});

describe('AI-01 / D-12 — the drafted-touch pipeline', () => {
  it('drafts a needs_draft touch into pending_approval with full AI-04 evidence', async () => {
    const repo = forTenant(tenantId);
    const client = fakeClient(DRAFT_BODY);

    const [touch] = await repo.touches.listForCadence(cadenceId);
    const counts = await draftTouches({
      repo,
      tenant: { tenantId, name: 'Perth Sparks Electrical', timezone: 'Australia/Perth' },
      touches: [touch],
      client,
      now: new Date(),
    });

    expect(counts.drafted).toBe(1);
    expect(counts.deferred).toBe(0);
    expect(counts.validatorFailed).toBe(0);
    expect(client.calls).toBe(1);

    // ── The touch moved exactly one step. NOT to `approved`. ───────────────
    const [after] = await repo.touches.listForCadence(cadenceId);
    expect(after.status).toBe('pending_approval');

    // ── AI-04: the evidence row, with every provenance column populated FROM
    //    THE FIRST ATTEMPT. These four are what answers "why did the model
    //    write that" months later, and none can be reconstructed afterwards.
    const [draft] = await repo.drafts.latestForTouch(touchId);
    expect(draft.model).toBe(DRAFT_MODEL);
    expect(draft.templateId).toBe(templateId);
    expect(draft.templateVersion).toBe(1);
    expect(draft.promptVersion).toBe(PROMPT_VERSION);
    expect(draft.attempt).toBe(1);
    expect(draft.status).toBe('generated');
    expect(draft.inputTokens).toBe(812);
    expect(draft.outputTokens).toBe(41);

    // ── D-01/D-03: the compliance suffix is MECHANICAL. The fake model never
    //    produced it, and it is on the end of `final_body` verbatim.
    expect(draft.generatedBody).toBe(DRAFT_BODY);
    expect(draft.finalBody).toBe(
      `${DRAFT_BODY} Perth Sparks Electrical. Reply STOP to opt out.`,
    );
    expect(draft.finalBody.endsWith('Perth Sparks Electrical. Reply STOP to opt out.')).toBe(
      true,
    );
  });

  it('REFUSES to dispatch a touch that is only pending_approval (D-12)', async () => {
    const sender = new CapturingSender();

    // The touch is due and the window is open. The ONLY thing standing between
    // it and a customer is that no human has approved it.
    const result = await dispatchDueTouches({ sender, now: dueAt });

    expect(sender.sent).toEqual([]);
    expect(result.dispatched).toBe(0);
    expect(await forTenant(tenantId).ledger.listForCadence(cadenceId)).toEqual([]);

    // Still parked, not skipped: a touch awaiting approval is not a touch that
    // failed, and retiring it would silently drop a customer's follow-up.
    const [touch] = await forTenant(tenantId).touches.listForCadence(cadenceId);
    expect(touch.status).toBe('pending_approval');
  });

  it('sends the approved draft BYTE FOR BYTE once a human approves it', async () => {
    const repo = forTenant(tenantId);
    const [draft] = await repo.drafts.latestForTouch(touchId);

    // ── THE APPROVE WRITE — the only path to `approved`, both halves. ──────
    const approvedAt = new Date();
    const [approved] = await repo.drafts.approve(draft.id, {
      finalBody: draft.finalBody,
      // 0 — approved unchanged. The V2-01 evidence column.
      editDistance: '0',
      approvedAt,
    });
    expect(approved.status).toBe('approved');
    expect(approved.editDistance).toBe('0');

    const [touchApproved] = await repo.touches.approveWhere([touchId]);
    expect(touchApproved.status).toBe('approved');

    const sender = new CapturingSender();
    const result = await dispatchDueTouches({ sender, now: dueAt });

    expect(result.dispatched).toBe(1);
    expect(sender.sent).toHaveLength(1);

    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ THE CLAIM THIS WHOLE PLAN EXISTS TO PROVE.                           │
    // └──────────────────────────────────────────────────────────────────────┘
    //
    // Not "contains", not "matches a pattern" — the EXACT bytes of the column
    // the human approved. Dispatch composed nothing, merge-filled nothing, and
    // did not recompose the compliance suffix from the tenant's current name
    // (research Pitfall 6).
    expect(sender.sent[0].body).toBe(draft.finalBody);
    expect(sender.sent[0].to.address).toBe('+61491570158');

    const [sent] = await repo.touches.listForCadence(cadenceId);
    expect(sent.status).toBe('sent');
  });

  it('refuses a second approved draft for the same touch (the unique partial index)', async () => {
    const repo = forTenant(tenantId);

    // A second attempt row, then an attempt to approve it too. Postgres decides,
    // not whichever request arrived first.
    const [second] = await repo.drafts.insertAttempt({
      cadenceId,
      quoteId: null,
      touchId,
      touchNumber,
      attempt: 2,
      model: DRAFT_MODEL,
      templateId,
      templateVersion: 1,
      promptVersion: PROMPT_VERSION,
      generatedBody: 'A competing draft.',
      finalBody: 'A competing draft. Perth Sparks Electrical. Reply STOP to opt out.',
      status: 'generated',
      validatorFailures: null,
      segments: 1,
      inputTokens: null,
      outputTokens: null,
      cacheReadInputTokens: null,
    });

    await expect(
      repo.drafts.approve(second.id, {
        finalBody: second.finalBody,
        editDistance: '0',
        approvedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe('D-10 — nothing is ever sent that the model did not write', () => {
  it('leaves the touch in needs_draft when the client throws, with no draft row', async () => {
    const repo = forTenant(tenantId);

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'model is down', chase_eligibility: 'eligible' },
    ]);
    const failCadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Dana Fisher',
      contact_mobile: '+61491570157',
    });
    await seedTouches(failCadenceId, tenantId, [
      {
        status: 'needs_draft',
        scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
        original_offset_days: 0,
      },
    ]);

    // READ THE REAL ROW BACK. `seedTouches` returns `{ id, touch_number }`, not
    // a `CadenceTouch` — handing that to `draftTouches` produces a query with
    // undefined bindings, which fails, which lands in the same `deferred` count
    // the throwing client does. The test would then pass without the client
    // ever being called. Casting it away is exactly how that goes unnoticed.
    const [touch] = await repo.touches.listForCadence(failCadenceId);

    const counts = await draftTouches({
      repo,
      tenant: { tenantId, name: 'Perth Sparks Electrical', timezone: 'Australia/Perth' },
      touches: [touch],
      client: throwingClient,
      now: new Date(),
    });

    expect(counts.deferred).toBe(1);
    expect(counts.drafted).toBe(0);

    // UNTOUCHED — the next tick retries. Not skipped, not approved, and above
    // all not sent from a merge-filled template.
    const [after] = await repo.touches.listForCadence(failCadenceId);
    expect(after.status).toBe('needs_draft');
    expect(await repo.drafts.latestForTouch(touch.id)).toEqual([]);
    expect(await repo.drafts.approvedFinalBody(touch.id)).toBeNull();
  });

  it('does not draft for a tenant whose templates are not approved (ONB-03)', async () => {
    const repo = forTenant(onboardingTenantId);

    // A template exists — it has simply never been attested to.
    await seedMessageTemplate(onboardingTenantId, 1, { approved_at: null });

    const [quote] = await seedQuotes(onboardingTenantId, [
      { job_description: 'not onboarded yet', chase_eligibility: 'eligible' },
    ]);
    const onboardingCadenceId = await seedCadence(onboardingTenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Sam Reilly',
      contact_mobile: '+61491570156',
    });
    await seedTouches(onboardingCadenceId, onboardingTenantId, [
      {
        status: 'needs_draft',
        scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
        original_offset_days: 0,
      },
    ]);

    // The real row, for the reason given in the previous test.
    const [touch] = await repo.touches.listForCadence(onboardingCadenceId);

    const client = fakeClient(DRAFT_BODY);
    const counts = await draftTouches({
      repo,
      tenant: {
        tenantId: onboardingTenantId,
        name: 'Not Onboarded Pty Ltd',
        timezone: 'Australia/Perth',
      },
      touches: [touch],
      client,
      now: new Date(),
    });

    expect(counts.noApprovedTemplate).toBe(1);
    expect(counts.drafted).toBe(0);
    // THE MODEL WAS NEVER CALLED. Not "called and discarded" — the belt is
    // checked before the request is built, so an un-onboarded client costs
    // nothing and, more importantly, cannot produce a draft to approve.
    expect(client.calls).toBe(0);

    const [after] = await repo.touches.listForCadence(onboardingCadenceId);
    expect(after.status).toBe('needs_draft');
  });

  it('does nothing at all when no API key is configured', async () => {
    const repo = forTenant(tenantId);
    const [touch] = await repo.touches.listForCadence(cadenceId);

    const counts = await draftTouches({
      repo,
      tenant: { tenantId, name: 'Perth Sparks Electrical', timezone: 'Australia/Perth' },
      touches: [touch],
      client: null,
      now: new Date(),
    });

    expect(counts.unconfigured).toBe(1);
    expect(counts.drafted).toBe(0);
  });
});

describe('D-12 — promoteDue cannot reach `approved`', () => {
  it('promotes scheduled → needs_draft and stops there', async () => {
    const repo = forTenant(tenantId);

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'promotion gate', chase_eligibility: 'eligible' },
    ]);
    const promoteCadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Alex Ng',
      contact_mobile: '+61491570155',
    });
    await seedTouches(promoteCadenceId, tenantId, [
      {
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 60_000).toISOString(),
        original_offset_days: 0,
      },
    ]);

    const promoted = await repo.touches.promoteDue(new Date(), 48 * MS_PER_HOUR);
    const ours = promoted.filter((t) => t.cadenceId === promoteCadenceId);
    expect(ours).toHaveLength(1);
    expect(ours[0].status).toBe('needs_draft');

    // AND NOT ONE ROW ANYWHERE went to `approved` — asserted over the whole
    // returned set, because a widened source list would show up here first.
    expect(promoted.every((t) => t.status === 'needs_draft')).toBe(true);
  });

  it('will not approve a touch that has not been through drafting', async () => {
    const repo = forTenant(tenantId);

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'guarded approve', chase_eligibility: 'eligible' },
    ]);
    const guardCadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Jo Park',
      contact_mobile: '+61491570154',
    });
    const [touch] = await seedTouches(guardCadenceId, tenantId, [
      {
        status: 'needs_draft',
        scheduled_at: new Date(Date.now() + 60_000).toISOString(),
        original_offset_days: 0,
      },
    ]);

    // `approveWhere` is guarded on `pending_approval`. A touch still in
    // `needs_draft` has no draft for anyone to have read.
    expect(await repo.touches.approveWhere([touch.id])).toEqual([]);

    const { data } = await admin
      .from('cadence_touches')
      .select('status')
      .eq('id', touch.id)
      .single();
    expect((data as { status: string }).status).toBe('needs_draft');
  });
});
