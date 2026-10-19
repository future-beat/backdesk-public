/**
 * LEAD-04, D-06, D-07, D-12 — THE LEAD THE TRADIE BOOKED HIMSELF CLOSES ON THE
 * SYNC, ONCE, AND A LEAD-BORN JOB IS NEVER BILLED (Phase 14, plan 14-03 — the
 * DB-backed proof).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   D-07 — THE MATCH: an open lead at `sm8_job_state = 'none'` whose caller's
 *          mobile (spelled locally on the job contact) is on an active job
 *          dated inside [call date, call date + 14] in the client's zone is
 *          `converted` / `booked_by_tradie` after one sync cycle, with the job
 *          uuid recorded, its lead cadence stopped `lead_closed` and its unsent
 *          touches skipped — through the post-commit pass, on its own
 *          transaction.
 *   IDEMPOTENT — a second cycle changes no column of the lead, the cadence or
 *          the touches (full rows compared, `updated_at` included).
 *   THE BOUNDARIES — D+15 and D−1 stay open; exactly D+14 resolves.
 *   UNTOUCHED — a lead in `creating` (the operator's) and a lead whose only
 *          match is an INACTIVE job stay open.
 *   TIER (ii) — a job with no job contact is matched through ONE
 *          `companycontact.json` read filtered by its company; a second cycle
 *          spends none.
 *   TWO LEADS, ONE JOB — both resolve to it; the partial unique (scoped to
 *          `created`) does not refuse the second.
 *   THE STALE CLAIM (deviation B) — a lead `creating` for longer than
 *          LEAD_JOB_CLAIM_STALE_MINUTES is released to `failed` / `stale_claim`
 *          on the same pass; exactly fifteen minutes is still live.
 *   D-06 — LEAD-BORN WONS ARE UNQUALIFIED: a `won` on a job our tap created,
 *          and on a job the tradie booked, is unqualified through the real
 *          consumer although each carries a ledger row that DOES qualify — the
 *          control job with the same ledger and no lead is attributed, which
 *          is what makes "would qualify" a fact rather than a claim.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` (via the seed
 * helper) and MUST NEVER run through `npm run test:remote`: the hosted Sydney
 * project is production. The ONLY ServiceM8 here is `createSm8Stub()`, handed
 * in through `clientFactory` — no request reaches api.servicem8.com, and the
 * sync never writes to the stub (D-12). Every number is from ACMA's fiction
 * block (0491 570 62x and 63x), sub-blocks no other suite uses; every word is
 * invented. Clocks are pinned. Teardown is by this suite's tenant ids; the
 * shared attribution cursor is parked before the D-06 case emits and restored
 * exactly as found, the rule tests/attribution-consume.test.ts states.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consumeWonEvents } from '../src/core/attribution/consume-wins';
import { ATTRIBUTION_CONSUMER } from '../src/core/cadence/constants';
import type { Sm8Client } from '../src/core/servicem8/types';
import { decodeEncryptionKey, encryptCredential } from '../src/core/shared/crypto';
import { runSyncForConnection } from '../src/core/sync/run-sync';
import { closeDb, forTenant, readConsumerCursor, type DueConnection } from '../src/db/repository';

import {
  admin,
  ensureOperatorExists,
  seedCadence,
  seedConnection,
  seedLead,
  seedLeadCadence,
  seedLedgerRow,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';
import { createSm8Stub, type Sm8Stub } from './helpers/sm8-stub';

const TIMEZONE = 'Australia/Perth';
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** THE CALL, D: Wednesday 7 October 2026, 10:00 in Perth (02:00 UTC). */
const CALLED_AT = '2026-10-07T02:00:00.000Z';
/** THE PINNED CYCLE CLOCK: Saturday 10 October 2026, 09:00 in Perth. */
const NOW = new Date('2026-10-10T01:00:00.000Z');

const D_MINUS_1 = '2026-10-06';
const D_PLUS_3 = '2026-10-10';
const D_PLUS_14 = '2026-10-21';
const D_PLUS_15 = '2026-10-22';

/** One fiction mobile per lead, so `leads_one_open_per_mobile` never meets itself. */
const MATCH_CALLER = '+61491570621';
const COMPANY_TIER_CALLER = '+61491570622';
const PAIR_FIRST = '+61491570623';
const PAIR_SECOND = '+61491570624';
const PAST_EDGE_CALLER = '+61491570625';
const BEFORE_CALL_CALLER = '+61491570626';
const AT_EDGE_CALLER = '+61491570627';
const INACTIVE_JOB_CALLER = '+61491570628';
const CREATING_CALLER = '+61491570620';
const LEAD_BORN_CALLER = '+61491570629';
const STALE_CALLER = '+61491570630';
const AT_STALE_EDGE_CALLER = '+61491570631';
const FRESH_CLAIM_CALLER = '+61491570632';

/** `+61491570621` → `0491 570 621`: how a tradie types it on a job contact. */
const spaced = (e164: string): string =>
  `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;

const tenantIds: string[] = [];
let operatorId: string;

async function connectedTenant(prefix: string): Promise<string> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);
  const key = decodeEncryptionKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
  await seedConnection(tenantId, {
    api_key_ciphertext: encryptCredential('fixture-api-key', key),
    key_last4: 'ture',
  });
  return tenantId;
}

/** An open lead at D with a live lead cadence and two scheduled touches. */
async function openLead(
  tenantId: string,
  mobile: string,
  overrides: Record<string, unknown> = {},
): Promise<{ leadId: string; cadenceId: string }> {
  const leadId = await seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: CALLED_AT,
    last_missed_at: CALLED_AT,
    ...overrides,
  });
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: mobile,
    contact_name: 'Fiction Caller',
    anchor_at: CALLED_AT,
  });
  await seedTouches(cadenceId, tenantId, [{}, {}]);
  return { leadId, cadenceId };
}

const COMPANY = '5a1e0000-0000-4000-8000-000000000001';

/** A ServiceM8 job row as the stub serves it to the sync. */
function job(uuid: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    uuid,
    status: 'Work Order',
    date: `${date} 00:00:00`,
    company_uuid: COMPANY,
    generated_job_id: 'FICTION-1',
    job_description: 'Fiction job, Fiction Street',
    total_invoice_amount: '1500.00',
    active: 1,
    ...overrides,
  };
}

/** A JOB contact carrying a caller's mobile in the local spaced spelling. */
function jobContact(jobUuid: string, mobile: string) {
  return {
    uuid: randomUUID(),
    job_uuid: jobUuid,
    first: 'Fiction',
    last: 'Caller',
    mobile: spaced(mobile),
    type: 'JOB',
    active: 1,
  };
}

/**
 * The sync's view of the stub. The sync's own `edit_date gt` filters are
 * outside the stub's `$filter` subset, so those reads answer every row (as in
 * tests/lead-job-create-db.test.ts); the pass's `companycontact.json` filter
 * IS in the subset and is passed through, so tier (ii) is filtered exactly.
 */
function syncView(stub: Sm8Stub): Sm8Client {
  return {
    get: (resource, options) =>
      resource === 'companycontact.json' ? stub.get(resource, options) : stub.get(resource),
  };
}

async function dueConnection(tenantId: string): Promise<DueConnection> {
  const [connection] = await forTenant(tenantId).connection.get();
  return {
    tenantId,
    tenantName: 'Lead Booked By Tradie',
    tenantTimezone: TIMEZONE,
    apiKeyCiphertext: connection.apiKeyCiphertext,
    jobCursor: connection.jobCursor,
    contactCursor: connection.contactCursor,
    consecutiveFailures: 0,
    alertedAt: null,
  };
}

async function cycle(tenantId: string, stub: Sm8Stub) {
  const result = await runSyncForConnection(await dueConnection(tenantId), {
    clientFactory: () => syncView(stub),
    retryDelaysMs: [],
    now: NOW,
  });
  expect(result.outcome).toBe('ok');
  return result;
}

async function leadRow(leadId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('leads').select('*').eq('id', leadId).single();
  if (error) throw new Error(`reading the lead failed: ${error.code}`);
  return data as Record<string, unknown>;
}

async function cadenceRow(cadenceId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('cadences').select('*').eq('id', cadenceId).single();
  if (error) throw new Error(`reading the cadence failed: ${error.code}`);
  return data as Record<string, unknown>;
}

async function touchRows(cadenceId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('cadence_touches')
    .select('*')
    .eq('cadence_id', cadenceId)
    .order('touch_number');
  if (error) throw new Error(`reading the touches failed: ${error.code}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

const companyContactReads = (stub: Sm8Stub) =>
  stub.calls.filter((c) => c.method === 'GET' && c.resource === 'companycontact.json');

const writesTo = (stub: Sm8Stub) => stub.calls.filter((c) => c.method === 'POST');

beforeAll(async () => {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error('These suites need CREDENTIALS_ENCRYPTION_KEY — see docs/env-vars.md');
  }
  operatorId = await ensureOperatorExists();
});

afterAll(async () => {
  await teardownTenants(tenantIds);
  await closeDb();
});

describe('THE MATCH: one cycle resolves the lead booked_by_tradie, and a second changes nothing (D-07)', () => {
  let tenantId: string;
  let stub: Sm8Stub;
  let lead: { leadId: string; cadenceId: string };
  const jobUuid = randomUUID();

  beforeAll(async () => {
    tenantId = await connectedTenant('Lead Booked Match');
    lead = await openLead(tenantId, MATCH_CALLER);
    stub = createSm8Stub({
      jobs: [job(jobUuid, D_PLUS_3)],
      contacts: [jobContact(jobUuid, MATCH_CALLER)],
    });
  });

  it('converts the lead, records the job, stops the cadence and skips the touches', async () => {
    await cycle(tenantId, stub);

    const row = await leadRow(lead.leadId);
    expect(row).toMatchObject({
      status: 'converted',
      closed_reason: 'booked_by_tradie',
      sm8_job_uuid: jobUuid,
      // State stays none: the job is the tradie's, not our creation.
      sm8_job_state: 'none',
      sm8_job_created_at: null,
      sm8_job_created_by: null,
    });
    expect(new Date(row.closed_at as string).toISOString()).toBe(NOW.toISOString());

    expect(await cadenceRow(lead.cadenceId)).toMatchObject({
      status: 'stopped',
      stop_reason: 'lead_closed',
    });
    const touches = await touchRows(lead.cadenceId);
    expect(touches).toHaveLength(2);
    for (const touch of touches) {
      expect(touch).toMatchObject({ status: 'skipped', skip_reason: 'cadence_stopped' });
    }

    // D-12: the sync read ServiceM8 and wrote nothing to it.
    expect(writesTo(stub)).toEqual([]);
    // Tier (i) answered: no company read was needed.
    expect(companyContactReads(stub)).toEqual([]);
  });

  it('IDEMPOTENT: a second cycle changes no column of the lead, the cadence or the touches', async () => {
    const before = {
      lead: await leadRow(lead.leadId),
      cadence: await cadenceRow(lead.cadenceId),
      touches: await touchRows(lead.cadenceId),
    };
    expect(before.lead.updated_at).toEqual(expect.any(String));

    await cycle(tenantId, stub);

    expect(await leadRow(lead.leadId)).toEqual(before.lead);
    expect(await cadenceRow(lead.cadenceId)).toEqual(before.cadence);
    expect(await touchRows(lead.cadenceId)).toEqual(before.touches);
    expect(writesTo(stub)).toEqual([]);
  });
});

describe('THE BOUNDARIES: D+15 and D−1 stay open; exactly D+14 resolves (T-14-15)', () => {
  it('judges each lead on calendar dates in the client zone', async () => {
    const tenantId = await connectedTenant('Lead Booked Edges');
    const pastEdge = await openLead(tenantId, PAST_EDGE_CALLER);
    const beforeCall = await openLead(tenantId, BEFORE_CALL_CALLER);
    const atEdge = await openLead(tenantId, AT_EDGE_CALLER);

    const pastJob = randomUUID();
    const beforeJob = randomUUID();
    const edgeJob = randomUUID();
    const stub = createSm8Stub({
      jobs: [job(pastJob, D_PLUS_15), job(beforeJob, D_MINUS_1), job(edgeJob, D_PLUS_14)],
      contacts: [
        jobContact(pastJob, PAST_EDGE_CALLER),
        jobContact(beforeJob, BEFORE_CALL_CALLER),
        jobContact(edgeJob, AT_EDGE_CALLER),
      ],
    });

    await cycle(tenantId, stub);

    expect(await leadRow(pastEdge.leadId)).toMatchObject({
      status: 'open',
      closed_reason: null,
      sm8_job_uuid: null,
    });
    expect(await leadRow(beforeCall.leadId)).toMatchObject({
      status: 'open',
      closed_reason: null,
      sm8_job_uuid: null,
    });
    expect(await leadRow(atEdge.leadId)).toMatchObject({
      status: 'converted',
      closed_reason: 'booked_by_tradie',
      sm8_job_uuid: edgeJob,
    });
  });
});

describe("UNTOUCHED: the operator's lead and an inactive job (D-07)", () => {
  it("a lead in 'creating' with a matching job stays open and the operator's", async () => {
    const tenantId = await connectedTenant('Lead Booked Creating');
    // A FRESH claim (attempted now), so the stale-claim release leaves it too.
    const lead = await openLead(tenantId, CREATING_CALLER, {
      sm8_job_state: 'creating',
      sm8_job_attempt_count: 1,
      sm8_job_attempted_at: NOW.toISOString(),
    });
    const jobUuid = randomUUID();
    const stub = createSm8Stub({
      jobs: [job(jobUuid, D_PLUS_3)],
      contacts: [jobContact(jobUuid, CREATING_CALLER)],
    });

    await cycle(tenantId, stub);

    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'open',
      closed_reason: null,
      sm8_job_state: 'creating',
      sm8_job_uuid: null,
    });
    expect(await cadenceRow(lead.cadenceId)).toMatchObject({ status: 'active' });
  });

  it('an INACTIVE job never resolves a lead', async () => {
    const tenantId = await connectedTenant('Lead Booked Inactive');
    const lead = await openLead(tenantId, INACTIVE_JOB_CALLER);
    const jobUuid = randomUUID();
    const stub = createSm8Stub({
      jobs: [job(jobUuid, D_PLUS_3, { status: 'Unsuccessful', active: 0 })],
      contacts: [jobContact(jobUuid, INACTIVE_JOB_CALLER)],
    });

    await cycle(tenantId, stub);

    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'open',
      closed_reason: null,
      sm8_job_uuid: null,
    });
  });
});

describe('TIER (ii): a job with no job contact is matched through its company contacts (D-07, D-12)', () => {
  it('spends exactly one filtered companycontact read, and none on the next cycle', async () => {
    const tenantId = await connectedTenant('Lead Booked Company');
    const lead = await openLead(tenantId, COMPANY_TIER_CALLER);
    const company = '5a1e0000-0000-4000-8000-0000000000c2';
    const jobUuid = randomUUID();
    const stub = createSm8Stub({
      jobs: [job(jobUuid, D_PLUS_3, { company_uuid: company })],
      companyContacts: [
        {
          uuid: randomUUID(),
          company_uuid: company,
          first: 'Fiction',
          last: 'Owner',
          mobile: spaced(COMPANY_TIER_CALLER),
          type: 'BILLING',
          active: 1,
        },
      ],
    });

    await cycle(tenantId, stub);

    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'converted',
      closed_reason: 'booked_by_tradie',
      sm8_job_uuid: jobUuid,
    });

    const reads = companyContactReads(stub);
    expect(reads).toHaveLength(1);
    expect(reads[0].filter).toBe(`company_uuid eq '${company}' and active eq 1`);

    // The lead is closed: the next cycle has no candidate and reads nothing.
    await cycle(tenantId, stub);
    expect(companyContactReads(stub)).toHaveLength(1);
    expect(writesTo(stub)).toEqual([]);
  });
});

describe('TWO LEADS, ONE JOB: both resolve to it (the partial unique is scoped to created)', () => {
  it('converts both callers on the one job, with no 23505', async () => {
    const tenantId = await connectedTenant('Lead Booked Pair');
    const first = await openLead(tenantId, PAIR_FIRST);
    const second = await openLead(tenantId, PAIR_SECOND);
    const jobUuid = randomUUID();
    const stub = createSm8Stub({
      jobs: [job(jobUuid, D_PLUS_3)],
      contacts: [jobContact(jobUuid, PAIR_FIRST), jobContact(jobUuid, PAIR_SECOND)],
    });

    await cycle(tenantId, stub);

    for (const lead of [first, second]) {
      expect(await leadRow(lead.leadId)).toMatchObject({
        status: 'converted',
        closed_reason: 'booked_by_tradie',
        sm8_job_uuid: jobUuid,
        sm8_job_state: 'none',
      });
    }
  });
});

describe('THE STALE CLAIM: an abandoned creating claim is released on the same pass (14-03 deviation B)', () => {
  it('releases a claim older than fifteen minutes to failed / stale_claim; fifteen exactly and fresher stay creating', async () => {
    const tenantId = await connectedTenant('Lead Booked Stale');
    const persistedJob = randomUUID();
    const stale = await openLead(tenantId, STALE_CALLER, {
      sm8_job_state: 'creating',
      sm8_job_attempt_count: 1,
      sm8_job_attempted_at: new Date(NOW.getTime() - 15 * MINUTE_MS - 1000).toISOString(),
      // A job the dead request did create: KEPT, so the retry adopts it.
      sm8_job_uuid: persistedJob,
    });
    const atEdge = await openLead(tenantId, AT_STALE_EDGE_CALLER, {
      sm8_job_state: 'creating',
      sm8_job_attempt_count: 1,
      sm8_job_attempted_at: new Date(NOW.getTime() - 15 * MINUTE_MS).toISOString(),
    });
    const fresh = await openLead(tenantId, FRESH_CLAIM_CALLER, {
      sm8_job_state: 'creating',
      sm8_job_attempt_count: 1,
      sm8_job_attempted_at: new Date(NOW.getTime() - 14 * MINUTE_MS - 59_000).toISOString(),
    });
    const stub = createSm8Stub();

    await cycle(tenantId, stub);

    expect(await leadRow(stale.leadId)).toMatchObject({
      status: 'open',
      sm8_job_state: 'failed',
      sm8_job_error_kind: 'stale_claim',
      sm8_job_attempt_count: 1,
      sm8_job_uuid: persistedJob,
    });
    for (const live of [atEdge, fresh]) {
      expect(await leadRow(live.leadId)).toMatchObject({
        status: 'open',
        sm8_job_state: 'creating',
        sm8_job_error_kind: null,
      });
    }
    // The lead stays open with its cadence live: only the claim was released.
    expect(await cadenceRow(stale.cadenceId)).toMatchObject({ status: 'active' });

    // The Retry is back: the guarded claim admits a failed lead again.
    const claimed = await forTenant(tenantId).leads.claimJobCreation(stale.leadId, NOW);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].sm8JobUuid).toBe(persistedJob);

    // IDEMPOTENT: a second cycle releases nothing new (the edge claims are
    // judged against the same pinned clock).
    const before = await leadRow(atEdge.leadId);
    await cycle(tenantId, stub);
    expect(await leadRow(atEdge.leadId)).toEqual(before);
    expect(writesTo(stub)).toEqual([]);
  });
});

describe('D-06: A LEAD-BORN WON IS UNQUALIFIED THROUGH THE CONSUMER, whatever its ledger holds (T-14-13)', () => {
  let tenantId: string;
  /** Where the shared attribution cursor stood before this block — `null` = never run. */
  let attributionCursorBefore: number | null;

  const createdJob = randomUUID();
  const bookedJob = randomUUID();
  const controlJob = randomUUID();
  let quoteIds: Record<'created' | 'booked' | 'control', string>;

  async function setCursor(lastEventId: number): Promise<void> {
    const { error } = await admin
      .from('event_consumer_cursors')
      .upsert({ consumer: ATTRIBUTION_CONSUMER, last_event_id: lastEventId }, { onConflict: 'consumer' });
    if (error) throw new Error(`Setting the attribution cursor failed: ${error.message}`);
  }

  async function attributionsFor(quoteId: string): Promise<unknown[]> {
    const { data, error } = await admin
      .from('quote_attributions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('quote_id', quoteId);
    if (error) throw new Error(`Reading attributions failed: ${error.message}`);
    return data ?? [];
  }

  /** A quote cadence and ONE touch that qualifies: sent, not a stub, two days ago. */
  async function qualifyingLedger(quoteId: string, sm8JobUuid: string): Promise<void> {
    const cadenceId = await seedCadence(tenantId, quoteId, {
      sm8_job_uuid: sm8JobUuid,
      contact_name: 'Fiction Customer',
      contact_mobile: LEAD_BORN_CALLER,
    });
    await seedLedgerRow(tenantId, {
      cadenceId,
      quoteId,
      touchNumber: 1,
      claimedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      toAddress: LEAD_BORN_CALLER,
    });
  }

  beforeAll(async () => {
    tenantId = await connectedTenant('Lead Born Won');

    const [created, booked, control] = await seedQuotes(tenantId, [
      // Our tap's job: pre-inserted needs_review / lead (D-05).
      {
        sm8_job_uuid: createdJob,
        status: 'Quote',
        sync_source: 'lead',
        chase_eligibility: 'needs_review',
        date_raw: `${D_PLUS_3} 00:00:00`,
      },
      // The tradie's own booking: mirrored by the poll, the lead never touched it.
      {
        sm8_job_uuid: bookedJob,
        status: 'Quote',
        sync_source: 'poll',
        chase_eligibility: 'eligible',
        date_raw: `${D_PLUS_3} 00:00:00`,
      },
      // THE CONTROL: the same ledger, no lead — it must be attributed.
      {
        sm8_job_uuid: controlJob,
        status: 'Quote',
        sync_source: 'poll',
        chase_eligibility: 'eligible',
        date_raw: `${D_PLUS_3} 00:00:00`,
      },
    ]);
    quoteIds = { created: created.id, booked: booked.id, control: control.id };

    // Every one of the three carries a touch that WOULD qualify.
    await qualifyingLedger(created.id, createdJob);
    await qualifyingLedger(booked.id, bookedJob);
    await qualifyingLedger(control.id, controlJob);

    const closedAt = new Date(NOW.getTime() - DAY_MS).toISOString();
    await seedLead(tenantId, {
      contact_mobile: LEAD_BORN_CALLER,
      first_missed_at: CALLED_AT,
      last_missed_at: CALLED_AT,
      status: 'converted',
      closed_reason: 'job_created',
      closed_at: closedAt,
      sm8_job_state: 'created',
      sm8_job_uuid: createdJob,
      sm8_job_attempt_count: 1,
      sm8_job_attempted_at: closedAt,
      sm8_job_created_at: closedAt,
      sm8_job_created_by: operatorId,
    });
    await seedLead(tenantId, {
      contact_mobile: LEAD_BORN_CALLER,
      first_missed_at: CALLED_AT,
      last_missed_at: CALLED_AT,
      status: 'converted',
      closed_reason: 'booked_by_tradie',
      closed_at: closedAt,
      sm8_job_state: 'none',
      sm8_job_uuid: bookedJob,
    });

    // PARK THE SHARED CURSOR AT THE HEAD before anything here emits, so the
    // consumer acts only on this block's own wins (tests/attribution-consume's
    // Pitfall 11 rule). Read first: `null` and 0 are different facts.
    attributionCursorBefore = await readConsumerCursor(ATTRIBUTION_CONSUMER);
    const { data, error } = await admin
      .from('quote_status_events')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw new Error(`Reading the outbox head failed: ${error.message}`);
    await setCursor((data?.[0]?.id as number | undefined) ?? 0);
  }, 60_000);

  afterAll(async () => {
    if (attributionCursorBefore === null) {
      const { error } = await admin
        .from('event_consumer_cursors')
        .delete()
        .eq('consumer', ATTRIBUTION_CONSUMER);
      if (error) throw new Error(`Restoring the attribution cursor failed: ${error.message}`);
    } else {
      await setCursor(attributionCursorBefore);
    }
  });

  it('the tradie wins all three; the sync emits three won events', async () => {
    const stub = createSm8Stub({
      jobs: [job(createdJob, D_PLUS_3), job(bookedJob, D_PLUS_3), job(controlJob, D_PLUS_3)],
    });

    const result = await cycle(tenantId, stub);
    expect(result.eventsEmitted).toBe(3);

    const { data: events } = await admin
      .from('quote_status_events')
      .select('event_type, sm8_job_uuid')
      .eq('tenant_id', tenantId);
    expect((events ?? []).map((e) => e.event_type)).toEqual(['won', 'won', 'won']);
  });

  it('the consumer unqualifies both lead-born wins, attributes the control, and advances past all three', async () => {
    const result = await consumeWonEvents();

    expect(result.tenantsBlocked).toBe(0);
    expect(result.attributionsPoisoned).toBe(0);
    expect(result.attributionsUnqualified).toBe(2);
    expect(result.attributionsRecorded).toBe(1);

    expect(await attributionsFor(quoteIds.created)).toEqual([]);
    expect(await attributionsFor(quoteIds.booked)).toEqual([]);
    expect(await attributionsFor(quoteIds.control)).toHaveLength(1);

    const { data: events } = await admin
      .from('quote_status_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('id', { ascending: false })
      .limit(1);
    const lastWon = events![0].id as number;
    expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBeGreaterThanOrEqual(lastWon);
  });
});
