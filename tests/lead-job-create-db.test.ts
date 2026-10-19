/**
 * D-04/D-05/D-13, SM8-01..03 — ONE TAP CREATES THE SERVICEM8 JOB EXACTLY ONCE,
 * PRE-INSERTS THE MIRROR, CONVERTS THE LEAD, AND THE SYNC STAYS SILENT ABOUT
 * IT (Phase 14, plan 14-02 — the tracer's DB-backed proof).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   D-04 — exactly once AT THE DATABASE. Two concurrent taps: one `created`,
 *          the other `already_in_progress` (or `already_created` when the
 *          first finished first — the pair is asserted, not the order), and
 *          ServiceM8 saw ONE job POST. A tap on the converted lead is
 *          `already_created`. `leads_sm8_job_created_uniq` refuses a second
 *          created lead for one job uuid and admits an uncreated one.
 *   D-05 — the pre-insert: in the same unit of work as the read-back, the job
 *          is in `quotes` as `needs_review` / `lead`, the caller's contact is
 *          in `quote_contacts`, the lead is `converted` / `job_created` with
 *          its linkage, its lead cadence stopped `lead_closed` and its unsent
 *          touches skipped `cadence_stopped`.
 *   D-13 — THE SYNC'S SILENCE: the next cycle over the same job emits zero
 *          events, leaves `needs_review` and keeps `sync_source = 'lead'`
 *          (the sticky CASE, research Pitfall 1 — its first execution), and
 *          opens no quote cadence. A later status flip still yields exactly
 *          one `won` event: the status machine tracks a lead-born job as any
 *          other.
 *   SM8-03 — a failed attempt leaves the lead `open`, `failed`, the kind and
 *          the count recorded, the company uuid kept; the retry creates the
 *          job without a second company POST.
 *   D-01 — the refusals: no reply, a thread that changed after the preview,
 *          a paused connection — each before any claim and any ServiceM8 call.
 *   SM8-02 — THE ORPHAN (plan 14-03, deviation A): a job whose contact POST
 *          failed is first seen by the sync, which finds its uuid on the lead
 *          and mirrors it `needs_review` / `lead` with NO event; the retry
 *          adopts it and completes the linkage on that row.
 *   CR-01  — THE READ-BACK ORPHAN (14-REVIEW): the job POST answered a uuid
 *          and the GET after it failed. The uuid is persisted on the failed
 *          lead, so the next cycle mirrors the job `needs_review` / `lead`
 *          with zero events, and the retry adopts it by that uuid.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` (via the seed
 * helper) and MUST NEVER run through `npm run test:remote`: the hosted Sydney
 * project is production. The ONLY ServiceM8 here is `createSm8Stub()`, handed
 * in through `clientFactory` (D-11) — no request reaches api.servicem8.com.
 * Every number is from ACMA's fiction block (0491 570 60x), a sub-block no
 * other suite uses; every word is invented. Clocks are pinned. Teardown is by
 * this suite's tenant ids (`teardownTenants` sweeps quotes, quote_contacts,
 * quote_status_events, leads, cadences, touches and inbound rows).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createJobForLead, type CreateJobInput } from '../src/core/leads/create-job';
import { buildJobDescription } from '../src/core/leads/job-description';
import { previewSha256For } from '../src/core/leads/job-provision';
import type { Sm8Client } from '../src/core/servicem8/types';
import { decodeEncryptionKey, encryptCredential } from '../src/core/shared/crypto';
import { runSyncForConnection } from '../src/core/sync/run-sync';
import { closeDb, forTenant, type DueConnection } from '../src/db/repository';

import {
  admin,
  ensureOperatorExists,
  seedConnection,
  seedInbound,
  seedLead,
  seedLeadCadence,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';
import { createSm8Stub, type Sm8Stub } from './helpers/sm8-stub';

/** THE PINNED CLOCK: Saturday 10 October 2026, 09:00 in Perth (01:00 UTC). */
const NOW = new Date('2026-10-10T01:00:00.000Z');
/** The missed call: 07:30 Perth on 10 Oct — 9 Oct in UTC, so the note proves the zone. */
const CALLED_AT = '2026-10-09T23:30:00.000Z';
const REPLIED_AT = '2026-10-09T23:40:00.000Z';
const TIMEZONE = 'Australia/Perth';

/** One fiction-block mobile per lead, so `leads_one_open_per_mobile` never meets itself. */
const TRACER_CALLER = '+61491570601';
const TRACER_SPACED = '0491 570 601';
const RETRY_CALLER = '+61491570602';
const UNIQUE_SECOND = '+61491570603';
const UNIQUE_THIRD = '+61491570604';
const NO_REPLY_CALLER = '+61491570605';
const THREAD_CALLER = '+61491570606';
const PAUSED_CALLER = '+61491570607';
/** Plan 14-03 deviation A: the orphan of a failed attempt, first seen by the sync. */
const ORPHAN_CALLER = '+61491570608';
/** 14-REVIEW CR-01: the job POST answered a uuid, its read-back failed. */
const READBACK_CALLER = '+61491570609';
/** 14-REVIEW WR-01: the persisted job is deleted by the tradie before the retry. */
const DELETED_CALLER = '+61491570610';
/** 14-REVIEW WR-02: two mobiles of one ServiceM8 company, the same words, the same call minute. */
const SHARED_FIRST = '+61491570611';
const SHARED_SECOND = '+61491570612';
const SHARED_COMPANY = '01a1c0de-0000-7bb1-957b-0000000c0611';
/** 14-REVIEW WR-04: the classifier labels the reply between render and confirm. */
const URGENCY_CALLER = '+61491570613';

const REPLY = 'Need a quote for a fence, Fiction Street';

const tenantIds: string[] = [];
let operatorId: string;

/** A tenant with a connection whose ciphertext really decrypts (the core decrypts first). */
async function connectedTenant(prefix: string, connection: Record<string, unknown> = {}) {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);
  const key = decodeEncryptionKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
  await seedConnection(tenantId, {
    api_key_ciphertext: encryptCredential('fixture-api-key', key),
    key_last4: 'ture',
    ...connection,
  });
  return tenantId;
}

/** An open lead with a live lead cadence, two scheduled touches and (optionally) one threaded reply. */
async function openLead(
  tenantId: string,
  mobile: string,
  options: { reply?: boolean } = {},
): Promise<{ leadId: string; cadenceId: string; replyId: string | null }> {
  const leadId = await seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: CALLED_AT,
    last_missed_at: CALLED_AT,
  });
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: mobile,
    contact_name: 'Fiction Caller',
    anchor_at: CALLED_AT,
  });
  await seedTouches(cadenceId, tenantId, [{}, {}]);
  const replyId =
    options.reply === false
      ? null
      : await seedInbound(tenantId, {
          cadenceId,
          quoteId: null,
          leadId,
          receivedAt: REPLIED_AT,
          attribution: 'threaded',
          fromAddress: mobile,
          body: REPLY,
        });
  return { leadId, cadenceId, replyId };
}

/**
 * What the sheet posts. Every lead here is previewed with its ONE seeded reply
 * (`REPLY`, unlabelled, called at CALLED_AT, tenant zone Perth), so the
 * preview digest is that preview's (14-REVIEW WR-04).
 */
function input(expectedLatestInboundId: string, suburb: string | null = null): CreateJobInput {
  return {
    companyName: 'Fiction Caller',
    contactFirst: 'Fiction',
    contactLast: 'Caller',
    suburb,
    expectedLatestInboundId,
    expectedPreviewSha256: previewSha256For({
      replies: [{ id: expectedLatestInboundId, body: REPLY, urgency: null }],
      firstMissedAt: new Date(CALLED_AT),
      timezone: TIMEZONE,
    }),
  };
}

/**
 * The sync's view of the stub. The sync asks with an `edit_date gt` filter,
 * which the stub's `$filter` subset does not parse; like sync-upsert's
 * `stubClient`, this answers every row and lets `fetchAllPages`'
 * no-new-uuids rule end the walk — the path production takes.
 */
function syncView(stub: Sm8Stub): Sm8Client {
  return { get: (resource) => stub.get(resource) };
}

async function dueConnection(tenantId: string): Promise<DueConnection> {
  const [connection] = await forTenant(tenantId).connection.get();
  return {
    tenantId,
    tenantName: 'Lead Job Create',
    tenantTimezone: TIMEZONE,
    apiKeyCiphertext: connection.apiKeyCiphertext,
    jobCursor: connection.jobCursor,
    contactCursor: connection.contactCursor,
    consecutiveFailures: 0,
    alertedAt: null,
  };
}

async function leadRow(leadId: string) {
  const { data, error } = await admin.from('leads').select('*').eq('id', leadId).single();
  if (error) throw new Error(`reading the lead failed: ${error.code}`);
  return data as Record<string, unknown>;
}

const jobPosts = (stub: Sm8Stub) =>
  stub.calls.filter((c) => c.method === 'POST' && c.resource === 'job.json').length;

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

describe('the tracer: one tap, one job, one mirror row, one converted lead (D-04, D-05, D-13)', () => {
  let tenantId: string;
  let lead: { leadId: string; cadenceId: string; replyId: string | null };
  let stub: Sm8Stub;
  let jobUuid: string;

  beforeAll(async () => {
    tenantId = await connectedTenant('Lead Job Tracer');
    lead = await openLead(tenantId, TRACER_CALLER);
    stub = createSm8Stub();
  });

  it('the DOUBLE TAP: one created, one refused, ONE job POST', async () => {
    const tap = () =>
      createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, {
        clientFactory: () => stub,
        now: NOW,
      });

    const results = await Promise.all([tap(), tap()]);
    const kinds = results.map((r) => r.kind).sort();

    expect(kinds).toHaveLength(2);
    expect(kinds).toContain('created');
    const other = kinds.find((k) => k !== 'created');
    expect(['already_in_progress', 'already_created']).toContain(other);
    expect(jobPosts(stub)).toBe(1);

    const created = results.find((r) => r.kind === 'created');
    if (created?.kind !== 'created') throw new Error('no created result');
    jobUuid = created.jobUuid;
    expect(created.adopted).toEqual({ company: false, job: false, contact: false });
  });

  it('the UNIT OF WORK: mirror row, contact, converted lead, stopped cadence', async () => {
    const { data: quotes } = await admin
      .from('quotes')
      .select('id, sync_source, chase_eligibility, status, job_description, company_uuid')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', jobUuid);
    expect(quotes).toHaveLength(1);
    const quote = quotes![0] as Record<string, unknown>;
    expect(quote.sync_source).toBe('lead');
    expect(quote.chase_eligibility).toBe('needs_review');
    expect(quote.status).toBe('Quote');
    expect(quote.job_description).toBe(
      buildJobDescription(
        {
          replies: [{ body: REPLY, urgency: null }],
          firstMissedAt: new Date(CALLED_AT),
          timezone: TIMEZONE,
        },
        null,
      ),
    );
    expect(quote.job_description).toContain('Created by Backdesk from a missed call on 10 Oct 2026 at 7:30 am');

    const { data: contacts } = await admin
      .from('quote_contacts')
      .select('mobile, contact_type, first, last')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', jobUuid);
    expect(contacts).toEqual([
      { mobile: TRACER_SPACED, contact_type: 'JOB', first: 'Fiction', last: 'Caller' },
    ]);

    const row = await leadRow(lead.leadId);
    expect(row).toMatchObject({
      status: 'converted',
      closed_reason: 'job_created',
      sm8_job_state: 'created',
      sm8_job_uuid: jobUuid,
      sm8_job_created_by: operatorId,
      sm8_job_attempt_count: 1,
      sm8_job_error_kind: null,
    });
    expect(row.sm8_company_uuid).toEqual(quote.company_uuid);
    expect(row.sm8_job_contact_uuid).toEqual(expect.any(String));
    expect(row.sm8_job_description_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(row.sm8_job_created_at as string).toISOString()).toBe(NOW.toISOString());
    expect(new Date(row.closed_at as string).toISOString()).toBe(NOW.toISOString());

    const { data: cadence } = await admin
      .from('cadences')
      .select('status, stop_reason')
      .eq('id', lead.cadenceId)
      .single();
    expect(cadence).toEqual({ status: 'stopped', stop_reason: 'lead_closed' });

    const { data: touches } = await admin
      .from('cadence_touches')
      .select('status, skip_reason')
      .eq('cadence_id', lead.cadenceId);
    expect(touches).toHaveLength(2);
    for (const touch of touches ?? []) {
      expect(touch).toEqual({ status: 'skipped', skip_reason: 'cadence_stopped' });
    }
  });

  it('the row reads: jobLinkageFor joins the mirror, the mirror tier finds the company', async () => {
    const [linkage] = await forTenant(tenantId).leads.jobLinkageFor([lead.leadId]);
    expect(linkage).toMatchObject({
      leadId: lead.leadId,
      status: 'converted',
      closedReason: 'job_created',
      sm8JobUuid: jobUuid,
      sm8JobState: 'created',
      sm8JobAttemptCount: 1,
      jobStatus: 'Quote',
    });
    expect(linkage.jobGeneratedId).toEqual(expect.any(String));

    const row = await leadRow(lead.leadId);
    const candidates = await forTenant(tenantId).quoteContacts.companyCandidatesByMobileTail('601');
    expect(candidates).toContainEqual(
      expect.objectContaining({ mobile: TRACER_SPACED, companyUuid: row.sm8_company_uuid }),
    );
  });

  it("THE SYNC'S SILENCE: the next cycle emits nothing and keeps needs_review and lead", async () => {
    const result = await runSyncForConnection(await dueConnection(tenantId), {
      clientFactory: () => syncView(stub),
      retryDelaysMs: [],
    });

    expect(result.outcome).toBe('ok');
    expect(result.eventsEmitted).toBe(0);

    const { data: events } = await admin
      .from('quote_status_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', jobUuid);
    expect(events).toEqual([]);

    const { data: quote } = await admin
      .from('quotes')
      .select('sync_source, chase_eligibility, status')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', jobUuid)
      .single();
    // Pitfall 1: the poll's upsert must not turn 'lead' into 'poll'.
    expect(quote).toEqual({ sync_source: 'lead', chase_eligibility: 'needs_review', status: 'Quote' });

    const { data: quoteCadences } = await admin
      .from('cadences')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('kind', 'quote');
    expect(quoteCadences).toEqual([]);
  });

  it("THE WON EVENT: the tradie moves the job on and the status machine says 'won' once", async () => {
    stub.setJobStatus(jobUuid, 'Work Order');

    const result = await runSyncForConnection(await dueConnection(tenantId), {
      clientFactory: () => syncView(stub),
      retryDelaysMs: [],
    });
    expect(result.outcome).toBe('ok');

    const { data: events } = await admin
      .from('quote_status_events')
      .select('event_type, from_status, to_status')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', jobUuid);
    expect(events).toEqual([{ event_type: 'won', from_status: 'Quote', to_status: 'Work Order' }]);

    const { data: quote } = await admin
      .from('quotes')
      .select('sync_source, chase_eligibility')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', jobUuid)
      .single();
    expect(quote).toEqual({ sync_source: 'lead', chase_eligibility: 'needs_review' });
  });

  it('a tap on the converted lead is already_created, with no ServiceM8 call', async () => {
    const before = stub.calls.length;
    const result = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, {
      clientFactory: () => stub,
      now: NOW,
    });
    expect(result).toEqual({ kind: 'already_created', jobUuid });
    expect(stub.calls.length).toBe(before);
  });

  it('THE PARTIAL UNIQUE: a second created lead for the job is refused; an uncreated one is not', async () => {
    const second = await admin.from('leads').insert({
      tenant_id: tenantId,
      contact_mobile: UNIQUE_SECOND,
      first_missed_call_id: randomUUID(),
      first_missed_at: CALLED_AT,
      last_missed_at: CALLED_AT,
      after_hours: false,
      sm8_job_state: 'created',
      sm8_job_uuid: jobUuid,
    });
    expect(second.error?.code).toBe('23505');
    expect(second.error?.message).toContain('leads_sm8_job_created_uniq');

    // The booked-by-tradie shape: one tradie job, a second caller, state none.
    const third = await admin
      .from('leads')
      .insert({
        tenant_id: tenantId,
        contact_mobile: UNIQUE_THIRD,
        first_missed_call_id: randomUUID(),
        first_missed_at: CALLED_AT,
        last_missed_at: CALLED_AT,
        after_hours: false,
        sm8_job_state: 'none',
        sm8_job_uuid: jobUuid,
      })
      .select('id')
      .single();
    expect(third.error).toBeNull();
  });
});

describe('FAILED AND RETRY: the kind is recorded, the company kept, the retry never re-creates it (SM8-03)', () => {
  it('a 500 on the job POST fails the lead; the retry creates the job with no second company', async () => {
    const tenantId = await connectedTenant('Lead Job Retry');
    const lead = await openLead(tenantId, RETRY_CALLER);
    const stub = createSm8Stub();
    const options = { clientFactory: () => stub, now: NOW };

    stub.failNext('job.json', 500);
    const first = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(first).toEqual({ kind: 'failed', errorKind: 'server_error' });

    const failed = await leadRow(lead.leadId);
    expect(failed).toMatchObject({
      status: 'open',
      closed_reason: null,
      sm8_job_state: 'failed',
      sm8_job_error_kind: 'server_error',
      sm8_job_uuid: null,
      sm8_job_attempt_count: 1,
    });
    expect(failed.sm8_company_uuid).toEqual(expect.any(String));

    const { data: cadence } = await admin
      .from('cadences')
      .select('status')
      .eq('id', lead.cadenceId)
      .single();
    expect(cadence).toEqual({ status: 'active' });

    const [linkage] = await forTenant(tenantId).leads.jobLinkageFor([lead.leadId]);
    expect(linkage).toMatchObject({
      sm8JobState: 'failed',
      sm8JobErrorKind: 'server_error',
      sm8JobAttemptCount: 1,
      jobStatus: null,
    });

    // The retry — the operator retyped a suburb; the company is reused by uuid.
    const retry = await createJobForLead(
      tenantId,
      lead.leadId,
      input(lead.replyId!, 'Fictionville'),
      operatorId,
      options,
    );
    expect(retry.kind).toBe('created');
    if (retry.kind !== 'created') return;
    expect(retry.adopted.company).toBe(true);

    expect(stub.calls.filter((c) => c.method === 'POST' && c.resource === 'company.json')).toHaveLength(1);
    expect(stub.rows('company.json')).toHaveLength(1);
    expect(stub.rows('job.json')).toHaveLength(1);

    const done = await leadRow(lead.leadId);
    expect(done).toMatchObject({
      status: 'converted',
      closed_reason: 'job_created',
      sm8_job_state: 'created',
      sm8_job_uuid: retry.jobUuid,
      sm8_job_attempt_count: 2,
      sm8_job_error_kind: null,
      sm8_company_uuid: failed.sm8_company_uuid,
    });
  });
});

describe('THE REFUSALS: answered before any claim and any ServiceM8 call (D-01)', () => {
  let tenantId: string;
  const stub = createSm8Stub();
  const options = { clientFactory: () => stub, now: NOW };

  beforeAll(async () => {
    tenantId = await connectedTenant('Lead Job Refusals');
  });

  it('a lead with no reply is no_reply', async () => {
    const lead = await openLead(tenantId, NO_REPLY_CALLER, { reply: false });
    const result = await createJobForLead(
      tenantId,
      lead.leadId,
      input('00000000-0000-4000-8000-000000000000'),
      operatorId,
      options,
    );
    expect(result).toEqual({ kind: 'no_reply' });
    expect(await leadRow(lead.leadId)).toMatchObject({ sm8_job_state: 'none', sm8_job_attempt_count: 0 });
    expect(stub.calls).toHaveLength(0);
  });

  it('a reply that landed after the preview is thread_changed — never created over', async () => {
    const lead = await openLead(tenantId, THREAD_CALLER);
    const facts = await forTenant(tenantId).leads.jobSheetFacts(lead.leadId);
    const previewedId = facts!.replies.at(-1)!.id;
    expect(previewedId).toBe(lead.replyId);

    // The caller writes again between the preview and the confirm.
    await seedInbound(tenantId, {
      cadenceId: lead.cadenceId,
      quoteId: null,
      leadId: lead.leadId,
      receivedAt: '2026-10-10T00:30:00.000Z',
      attribution: 'threaded',
      fromAddress: THREAD_CALLER,
      body: 'Actually it is the back fence too',
    });

    const result = await createJobForLead(tenantId, lead.leadId, input(previewedId), operatorId, options);
    expect(result).toEqual({ kind: 'thread_changed' });
    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'open',
      sm8_job_state: 'none',
      sm8_job_attempt_count: 0,
    });
    expect(stub.calls).toHaveLength(0);
  });

  it('an urgency label set between the preview and the confirm is thread_changed (WR-04)', async () => {
    const lead = await openLead(tenantId, URGENCY_CALLER);
    // The sheet rendered with the reply unlabelled — no urgency line.
    const previewed = input(lead.replyId!);

    // The classifier labels it before the operator confirms: the server-side
    // description would now carry "Urgency: emergency", which the operator
    // never saw. The newest reply id is unchanged.
    const { error } = await admin
      .from('inbound_messages')
      .update({ label: 'new_enquiry', urgency: 'emergency' })
      .eq('id', lead.replyId!);
    if (error) throw new Error(`labelling the reply failed: ${error.code}`);

    const result = await createJobForLead(tenantId, lead.leadId, previewed, operatorId, options);
    expect(result).toEqual({ kind: 'thread_changed' });
    expect(await leadRow(lead.leadId)).toMatchObject({ sm8_job_state: 'none', sm8_job_attempt_count: 0 });
    expect(stub.calls).toHaveLength(0);
  });

  it('a paused connection is connection_paused, with no claim', async () => {
    const pausedTenant = await connectedTenant('Lead Job Paused', {
      paused_at: NOW.toISOString(),
    });
    const lead = await openLead(pausedTenant, PAUSED_CALLER);
    const result = await createJobForLead(pausedTenant, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(result).toEqual({ kind: 'connection_paused' });
    expect(await leadRow(lead.leadId)).toMatchObject({ sm8_job_state: 'none', sm8_job_attempt_count: 0 });
    expect(stub.calls).toHaveLength(0);
  });
});

describe('THE ORPHAN (SM8-02, plan 14-03 deviation A): first sight of a failed attempt’s job is silent', () => {
  // The job POST succeeded and the contact POST failed, so the job exists in
  // ServiceM8 with no mirror row, and the lead is `failed` with the job uuid
  // persisted. Before the guard, the next poll first-sighted it as `poll` and
  // emitted `quote_opened` — the event SM8-02 exists to prevent. Now the sync
  // finds the uuid on the lead, mirrors the job `needs_review` / `lead`, and
  // emits nothing; the retry then completes the linkage on that row.
  it('mirrors the orphan needs_review / lead with no event, and the retry adopts it', async () => {
    const tenantId = await connectedTenant('Lead Job Orphan');
    const lead = await openLead(tenantId, ORPHAN_CALLER);
    const stub = createSm8Stub();
    const options = { clientFactory: () => stub, now: NOW };

    stub.failNext('jobcontact.json', 500);
    const first = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(first).toEqual({ kind: 'failed', errorKind: 'server_error' });

    const failed = await leadRow(lead.leadId);
    expect(failed).toMatchObject({ status: 'open', sm8_job_state: 'failed', sm8_job_error_kind: 'server_error' });
    const orphanUuid = failed.sm8_job_uuid as string;
    expect(orphanUuid).toEqual(expect.any(String));
    expect(stub.rows('job.json')).toHaveLength(1);

    const mirrorRows = async () => {
      const { data } = await admin
        .from('quotes')
        .select('sync_source, chase_eligibility, status')
        .eq('tenant_id', tenantId)
        .eq('sm8_job_uuid', orphanUuid);
      return data ?? [];
    };
    const eventRows = async () => {
      const { data } = await admin
        .from('quote_status_events')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('sm8_job_uuid', orphanUuid);
      return data ?? [];
    };
    expect(await mirrorRows()).toEqual([]);

    // FIRST SIGHT, twice: the guard on the first cycle, a known row on the second.
    for (let cycle = 0; cycle < 2; cycle++) {
      const result = await runSyncForConnection(await dueConnection(tenantId), {
        clientFactory: () => syncView(stub),
        retryDelaysMs: [],
        now: NOW,
      });
      expect(result.outcome).toBe('ok');
      expect(result.eventsEmitted).toBe(0);
      expect(await mirrorRows()).toEqual([
        { sync_source: 'lead', chase_eligibility: 'needs_review', status: 'Quote' },
      ]);
      expect(await eventRows()).toEqual([]);
    }

    // The lead is the operator's: still failed, still open — the tradie-booked
    // match reads only leads at `none`, so it cannot close this one.
    expect(await leadRow(lead.leadId)).toMatchObject({ status: 'open', sm8_job_state: 'failed' });

    const { data: quoteCadences } = await admin
      .from('cadences')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('kind', 'quote');
    expect(quoteCadences).toEqual([]);

    // THE RETRY completes the linkage on the row the sync wrote: the job is
    // adopted by its persisted uuid, only the contact is created.
    const retry = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(retry.kind).toBe('created');
    if (retry.kind !== 'created') return;
    expect(retry.jobUuid).toBe(orphanUuid);
    expect(retry.adopted.job).toBe(true);
    expect(stub.rows('job.json')).toHaveLength(1);

    expect(await mirrorRows()).toEqual([
      { sync_source: 'lead', chase_eligibility: 'needs_review', status: 'Quote' },
    ]);
    expect(await eventRows()).toEqual([]);
    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'converted',
      closed_reason: 'job_created',
      sm8_job_state: 'created',
      sm8_job_uuid: orphanUuid,
    });
  });
});

describe('THE READ-BACK ORPHAN (14-REVIEW CR-01): a job whose read-back failed is still guarded', () => {
  // Before the fix the wrapper dropped the POST's uuid on a failed read-back,
  // so the lead went `failed` with no job uuid, the first-sight guard could
  // not see the job, and the next poll opened it `poll` / `eligible`.
  it('persists the uuid, the next cycle mirrors it needs_review / lead with zero events, the retry adopts it', async () => {
    const tenantId = await connectedTenant('Lead Job Readback');
    const lead = await openLead(tenantId, READBACK_CALLER);
    const stub = createSm8Stub();
    const options = { clientFactory: () => stub, now: NOW };

    stub.failNextReadBack('job.json', 500);
    const first = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(first).toEqual({ kind: 'failed', errorKind: 'readback_mismatch' });

    expect(stub.rows('job.json')).toHaveLength(1);
    const orphanUuid = stub.rows('job.json')[0].uuid as string;
    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'open',
      sm8_job_state: 'failed',
      sm8_job_error_kind: 'readback_mismatch',
      sm8_job_uuid: orphanUuid,
    });

    const result = await runSyncForConnection(await dueConnection(tenantId), {
      clientFactory: () => syncView(stub),
      retryDelaysMs: [],
      now: NOW,
    });
    expect(result.outcome).toBe('ok');
    expect(result.eventsEmitted).toBe(0);

    const { data: mirror } = await admin
      .from('quotes')
      .select('sync_source, chase_eligibility')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', orphanUuid);
    expect(mirror).toEqual([{ sync_source: 'lead', chase_eligibility: 'needs_review' }]);
    const { data: events } = await admin
      .from('quote_status_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('sm8_job_uuid', orphanUuid);
    expect(events).toEqual([]);

    const mark = stub.calls.length;
    const retry = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(retry.kind).toBe('created');
    if (retry.kind !== 'created') return;
    expect(retry.jobUuid).toBe(orphanUuid);
    expect(retry.adopted.job).toBe(true);
    expect(stub.calls.slice(mark).filter((c) => c.method === 'POST' && c.resource === 'job.json')).toHaveLength(0);
    expect(stub.rows('job.json')).toHaveLength(1);
    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'converted',
      closed_reason: 'job_created',
      sm8_job_state: 'created',
      sm8_job_uuid: orphanUuid,
    });
  });
});

describe('A DELETED ORPHAN (14-REVIEW WR-01): the retry does not adopt a job the tradie deleted', () => {
  it('clears the stale uuid and converts the lead to a fresh, active job', async () => {
    const tenantId = await connectedTenant('Lead Job Deleted');
    const lead = await openLead(tenantId, DELETED_CALLER);
    const stub = createSm8Stub();
    const options = { clientFactory: () => stub, now: NOW };

    stub.failNext('jobcontact.json', 500);
    const first = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(first).toEqual({ kind: 'failed', errorKind: 'server_error' });
    const deleted = (await leadRow(lead.leadId)).sm8_job_uuid as string;
    expect(deleted).toEqual(expect.any(String));

    await stub.post(`job/${deleted}.json`, { active: 0 });

    const retry = await createJobForLead(tenantId, lead.leadId, input(lead.replyId!), operatorId, options);
    expect(retry.kind).toBe('created');
    if (retry.kind !== 'created') return;
    expect(retry.jobUuid).not.toBe(deleted);
    expect(retry.adopted.job).toBe(false);
    expect(await leadRow(lead.leadId)).toMatchObject({
      status: 'converted',
      sm8_job_state: 'created',
      sm8_job_uuid: retry.jobUuid,
    });
    expect(stub.rows('jobcontact.json').filter((c) => c.job_uuid === deleted)).toHaveLength(0);
  });
});

describe('A DIGEST SHARED WITH ANOTHER LEAD (14-REVIEW WR-02): the unique violation clears the linkage', () => {
  // Two callers of one company, the same words, the same call minute: the
  // descriptions (and so the adopt keys) are equal. The second lead's retry
  // adopts the FIRST lead's job by digest and loses to
  // leads_sm8_job_created_uniq. Before the fix that was recorded
  // readback_mismatch with the first lead's uuid kept, and every Retry looped.
  // 2026-10 (Phase 15, D-08a): the recovery records its own kind,
  // job_linked_elsewhere — the borrowed parse_error is retired by 0042.
  it('fails job_linked_elsewhere with the job linkage cleared (company kept); the next tap creates a fresh job', async () => {
    const tenantId = await connectedTenant('Lead Job Shared');
    const first = await openLead(tenantId, SHARED_FIRST);
    const second = await openLead(tenantId, SHARED_SECOND);
    const stub = createSm8Stub({
      companies: [{ uuid: SHARED_COMPANY, name: 'Fiction Holdings' }],
      companyContacts: [
        { company_uuid: SHARED_COMPANY, mobile: '0491 570 611', type: 'JOB' },
        { company_uuid: SHARED_COMPANY, mobile: '0491 570 612', type: 'JOB' },
      ],
    });
    const options = { clientFactory: () => stub, now: NOW };

    const a = await createJobForLead(tenantId, first.leadId, input(first.replyId!), operatorId, options);
    expect(a.kind).toBe('created');
    if (a.kind !== 'created') return;

    stub.failNext('job.json', 500);
    const b1 = await createJobForLead(tenantId, second.leadId, input(second.replyId!), operatorId, options);
    expect(b1).toEqual({ kind: 'failed', errorKind: 'server_error' });

    // The retry adopts the first lead's job by the shared digest → 23505.
    const b2 = await createJobForLead(tenantId, second.leadId, input(second.replyId!), operatorId, options);
    expect(b2).toEqual({ kind: 'failed', errorKind: 'job_linked_elsewhere' });
    expect(await leadRow(second.leadId)).toMatchObject({
      status: 'open',
      sm8_job_state: 'failed',
      sm8_job_error_kind: 'job_linked_elsewhere',
      sm8_job_uuid: null,
      sm8_job_contact_uuid: null,
      sm8_job_description_sha256: null,
      sm8_company_uuid: SHARED_COMPANY,
    });

    // The next tap creates a fresh job; the first lead keeps its own.
    const b3 = await createJobForLead(tenantId, second.leadId, input(second.replyId!), operatorId, options);
    expect(b3.kind).toBe('created');
    if (b3.kind !== 'created') return;
    expect(b3.jobUuid).not.toBe(a.jobUuid);
    expect(b3.adopted.job).toBe(false);
    expect(await leadRow(first.leadId)).toMatchObject({ sm8_job_state: 'created', sm8_job_uuid: a.jobUuid });
    expect(await leadRow(second.leadId)).toMatchObject({
      status: 'converted',
      sm8_job_state: 'created',
      sm8_job_uuid: b3.jobUuid,
    });
  });
});
