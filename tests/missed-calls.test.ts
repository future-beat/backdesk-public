/**
 * EVERY DIVERTED CALL, ONE ROW EACH, AND NOBODY BUT THE SERVER WRITES IT —
 * `missed_calls` and `tenant_divert_numbers` proven at the database
 * (Phase 11, CAP-01/CAP-03, D-06/D-08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PROPERTIES UNDER TEST ARE THE DATABASE'S, NOT THE REPOSITORY'S.      │
 * │ The arbiter, the CHECK vocabularies, the two UNIQUEs, the SELECT-only    │
 * │ grants and the two-arm policy are each exercised through a path with     │
 * │ EVERY REASON TO SUCCEED — the service-role client, or a signed-in        │
 * │ operator — and refused anyway. The tenant_proofs mould (10-04).          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * Every assertion here is a query. It runs against `supabase start` on the
 * runner and NEVER through `npm run test:remote` (D-11): the hosted Sydney
 * project is production, and a `missed_calls` row manufactured there is a
 * diverted call that never rang — manufactured evidence on the table the
 * verification-call proof and Phase 12's text-back gate both read.
 *
 * ── TEARDOWN ────────────────────────────────────────────────────────────────
 *
 * Both tables carry `tenant_id` with no FK, so `teardownTenants` sweeps them by
 * tenant (11-04 added both to NO_CASCADE_TABLES). A DEAD LETTER (`tenant_id`
 * NULL) matches no tenant predicate — the `inbound_messages` caveat — so every
 * one this file writes is tracked in `deadLetterIds` and deleted BY ID in
 * `afterAll`, first.
 *
 * Every number here is from ACMA's fiction block. Nothing is dialled and no
 * provider is called.
 */
import { randomInt, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDb,
  completeMissedCall,
  forTenant,
  getMissedCallForTenant,
  insertMissedCallArrival,
  upsertMissedCallFromLog,
  type MissedCallArrivalInsert,
} from '../src/db/repository';

import {
  admin,
  ensureOperatorAllowlisted,
  seedDivertNumber,
  seedMissedCall,
  seedTenant,
  seedTwoTenants,
  signInAsOperator,
  teardownTenants,
  type TwoTenants,
} from './helpers/seed';

/** ACMA fiction-block numbers. */
const CALLED = '+61891570156';
const CALLER = '+61491570156';

let seeded: TwoTenants;
let operator: SupabaseClient;
const tenantIds: string[] = [];
/** Dead letters (tenant_id NULL) — no tenant predicate reaches them. By id. */
const deadLetterIds: string[] = [];

/** A fresh Twilio-shaped CallSid: `CA` + 32 hex. */
function callSid(): string {
  return `CA${randomUUID().replace(/-/g, '')}`;
}

/** One arrival, as the voice webhook would build it, for tenant A by default. */
function arrival(overrides: Partial<MissedCallArrivalInsert> = {}): MissedCallArrivalInsert {
  return {
    tenantId: seeded.tenantA,
    divertNumberId: null,
    providerCallId: callSid(),
    calledNumberE164: CALLED,
    callerE164: CALLER,
    callerWithheld: false,
    callerKind: 'mobile',
    callerRaw: CALLER,
    forwardedFromRaw: null,
    fromCountry: 'AU',
    startedAt: new Date(),
    afterHours: false,
    callStatus: 'ringing',
    source: 'webhook',
    deadLetterReason: null,
    rawPayload: null,
    ...overrides,
  };
}

/** The row as the database holds it, read through the service role. */
async function rowByCallSid(sid: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await admin
    .from('missed_calls')
    .select('*')
    .eq('provider', 'twilio')
    .eq('provider_call_id', sid);
  if (error) throw new Error(`Reading missed_calls failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * The SQLSTATE of a thrown repository error, walking `cause` — postgres.js
 * raises a `PostgresError` carrying `code`, and a drizzle wrapper may move it
 * one level down (the `isUniqueViolation` walker in src/core/reporting).
 */
function sqlStateOf(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current != null && depth < 4; depth += 1) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') {
      return current.code;
    }
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return null;
}

beforeAll(async () => {
  seeded = await seedTwoTenants();
  tenantIds.push(seeded.tenantA, seeded.tenantB);
  // THE OPERATOR ARM of the two-arm policy (`is_operator()`) needs the
  // allowlist row; membership of A alone is the member arm.
  await ensureOperatorAllowlisted();
  operator = await signInAsOperator();
});

afterAll(async () => {
  // BY ID and FIRST — see the header.
  if (deadLetterIds.length > 0) {
    const { error } = await admin.from('missed_calls').delete().in('id', deadLetterIds);
    if (error) throw new Error(`Teardown failed, dead letters left behind: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

/* -------------------------------------------------------------------------- *
 * (a)–(c) One arbiter, three writers
 * -------------------------------------------------------------------------- */

describe('the (provider, provider_call_id) arbiter (D-06)', () => {
  let completedSid: string;

  it('a second arrival of the same CallSid returns null and writes nothing', async () => {
    const row = arrival();
    completedSid = row.providerCallId!;

    const first = await insertMissedCallArrival(row);
    expect(first?.id).toEqual(expect.any(String));

    // A REDELIVERY — Twilio retries a slow answer — is an answer, not a failure.
    const second = await insertMissedCallArrival({ ...row, startedAt: new Date() });
    expect(second).toBeNull();

    expect(await rowByCallSid(completedSid)).toHaveLength(1);
  });

  it('completes the call from its status callback — UPDATE only, exact match', async () => {
    const endedAt = new Date();
    const result = await completeMissedCall({
      providerCallId: completedSid,
      callStatus: 'completed',
      durationSeconds: 11,
      endedAt,
    });
    // 2026-10 (Phase 12): the completion returns the MATCHED ROW's id and
    // tenant (from RETURNING) — what the status door hands the text-back path.
    const [stored] = await rowByCallSid(completedSid);
    expect(result).toEqual({ completed: true, id: stored?.id, tenantId: seeded.tenantA });

    const [row] = await rowByCallSid(completedSid);
    expect(row?.call_status).toBe('completed');
    expect(row?.duration_seconds).toBe(11);
    expect(row?.ended_at).not.toBeNull();
    expect(row?.completed_via).toBe('callback');
  });

  it('never invents a call from a callback for an unknown CallSid', async () => {
    // A callback is a HINT (the delivery-receipt rule). A forged or stray one
    // must touch nothing — the reconcile creates the row if the call was real.
    const unknown = callSid();
    const result = await completeMissedCall({
      providerCallId: unknown,
      callStatus: 'completed',
      durationSeconds: 5,
      endedAt: new Date(),
    });

    expect(result).toEqual({ completed: false, id: null, tenantId: null });
    expect(await rowByCallSid(unknown)).toHaveLength(0);
  });

  it('the reconcile INSERTS a call the webhook never saw, marked source reconcile', async () => {
    const sid = callSid();
    const result = await upsertMissedCallFromLog({
      ...arrival({ providerCallId: sid, source: 'reconcile' }),
      callStatus: 'no-answer',
      durationSeconds: 0,
      endedAt: new Date(),
      completedVia: 'reconcile',
    });

    expect(result).toEqual({ kind: 'inserted' });
    const [row] = await rowByCallSid(sid);
    expect(row?.source).toBe('reconcile');
    expect(row?.tenant_id).toBe(seeded.tenantA);
  });

  it('the reconcile leaves a completed call UNCHANGED — not a single stored fact rewritten, not counted', async () => {
    const [before] = await rowByCallSid(completedSid);

    // Everything the log disagrees about, on purpose: a different start, the
    // opposite after-hours answer, a different caller, a different duration.
    const result = await upsertMissedCallFromLog({
      ...arrival({
        providerCallId: completedSid,
        startedAt: new Date(Date.now() - 86_400_000),
        afterHours: true,
        callerE164: '+61491570157',
        source: 'reconcile',
      }),
      callStatus: 'completed',
      durationSeconds: 99,
      endedAt: new Date(Date.now() - 86_000_000),
      completedVia: 'reconcile',
    });
    // WR-06: nothing to fill, so NOTHING is written and nothing is "recovered".
    expect(result).toEqual({ kind: 'unchanged' });

    const [after] = await rowByCallSid(completedSid);
    // STORED FACTS, computed at arrival — the log may not rewrite them.
    expect(after?.started_at).toBe(before?.started_at);
    expect(after?.after_hours).toBe(before?.after_hours);
    expect(after?.caller_e164).toBe(before?.caller_e164);
    expect(after?.source).toBe(before?.source);
    // WHAT THE CALLBACK ALREADY FILLED STAYS: coalesce, never overwrite.
    expect(after?.completed_via).toBe('callback');
    expect(after?.duration_seconds).toBe(before?.duration_seconds);
    expect(after?.ended_at).toBe(before?.ended_at);
    expect(after?.id).toBe(before?.id);
  });

  it('the reconcile FILLS what a dropped callback left NULL on an arrival-only row', async () => {
    const row = arrival();
    await insertMissedCallArrival(row);

    const result = await upsertMissedCallFromLog({
      ...row,
      source: 'reconcile',
      callStatus: 'completed',
      durationSeconds: 7,
      endedAt: new Date(),
      completedVia: 'reconcile',
    });
    expect(result).toEqual({ kind: 'updated' });

    const [after] = await rowByCallSid(row.providerCallId!);
    expect(after?.call_status).toBe('completed');
    expect(after?.duration_seconds).toBe(7);
    expect(after?.completed_via).toBe('reconcile');
    // The creator is still the webhook — the reconcile completed it, no more.
    expect(after?.source).toBe('webhook');
  });

  it('never erases a stored call_status with the log\'s NULL (IN-03)', async () => {
    const row = arrival({ callStatus: 'ringing' });
    await insertMissedCallArrival(row);

    await upsertMissedCallFromLog({
      ...row,
      source: 'reconcile',
      // A status outside the nine reaches the upsert as NULL.
      callStatus: null,
      durationSeconds: 4,
      endedAt: new Date(),
      completedVia: 'reconcile',
    });

    const [after] = await rowByCallSid(row.providerCallId!);
    expect(after?.call_status).toBe('ringing');
    expect(after?.duration_seconds).toBe(4);
  });

  it('ADOPTS a dead letter once the called number resolves — tenant, divert row and caller filled (WR-06)', async () => {
    const sid = callSid();
    // What the voice door writes for a number with no ACTIVE owner at arrival
    // (a pending row, or an orphaned purchase not yet attached).
    const dead = await insertMissedCallArrival({
      tenantId: null,
      divertNumberId: null,
      providerCallId: sid,
      calledNumberE164: CALLED,
      callerE164: null,
      callerWithheld: true,
      callerKind: 'withheld',
      callerRaw: null,
      forwardedFromRaw: null,
      fromCountry: null,
      startedAt: new Date(),
      afterHours: true,
      callStatus: 'ringing',
      source: 'webhook',
      deadLetterReason: 'unknown_number',
      rawPayload: null,
    });
    if (dead) deadLetterIds.push(dead.id);
    const divertNumberId = randomUUID();

    const result = await upsertMissedCallFromLog({
      ...arrival({
        providerCallId: sid,
        divertNumberId,
        forwardedFromRaw: '+61891570100',
        afterHours: false,
        source: 'reconcile',
      }),
      callStatus: 'completed',
      durationSeconds: 12,
      endedAt: new Date(),
      completedVia: 'reconcile',
    });

    expect(result).toEqual({ kind: 'updated' });
    const rows = await rowByCallSid(sid);
    expect(rows).toHaveLength(1);
    const [after] = rows;
    expect(after?.id).toBe(dead?.id);
    expect(after?.tenant_id).toBe(seeded.tenantA);
    expect(after?.divert_number_id).toBe(divertNumberId);
    expect(after?.caller_e164).toBe(CALLER);
    expect(after?.caller_kind).toBe('mobile');
    expect(after?.caller_withheld).toBe(false);
    expect(after?.after_hours).toBe(false);
    expect(after?.forwarded_from_raw).toBe('+61891570100');
    expect(after?.dead_letter_reason).toBeNull();
    expect(after?.call_status).toBe('completed');
    expect(after?.completed_via).toBe('reconcile');
  });
});

/* -------------------------------------------------------------------------- *
 * (d) The grants — SELECT only for the browser roles
 * -------------------------------------------------------------------------- */

describe('the operator JWT cannot write either table (T-11-12, 0038 grants)', () => {
  it('refuses an INSERT into missed_calls with a PERMISSION error, not a policy one', async () => {
    // Tenant A is the operator's own client, so the policy WOULD admit this row.
    // What refuses it is the absent INSERT grant — an authenticated INSERT
    // would fabricate a diverted call that never rang.
    const { error } = await operator.from('missed_calls').insert({
      tenant_id: seeded.tenantA,
      provider_call_id: callSid(),
      called_number_e164: CALLED,
      caller_kind: 'mobile',
      started_at: new Date().toISOString(),
      after_hours: false,
      source: 'webhook',
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(error?.message.toLowerCase()).toContain('permission denied');
  });

  it('refuses an INSERT into tenant_divert_numbers with a PERMISSION error', async () => {
    const { error } = await operator.from('tenant_divert_numbers').insert({
      tenant_id: seeded.tenantA,
      spoken_name: 'Posted from a browser',
      status: 'active',
      number_e164: '+61891570199',
      created_by: seeded.operatorId,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(error?.message.toLowerCase()).toContain('permission denied');
  });

  it('refuses an UPDATE and a DELETE on missed_calls, and the row is untouched', async () => {
    const id = await seedMissedCall(seeded.tenantA, { call_status: 'completed' });

    // TWO LEGITIMATE DENIAL SHAPES (the leak.test.ts rule): 42501 when the
    // privilege is absent — the posture 0038 enforces — or zero rows. What must
    // hold either way is the row below, unchanged.
    const update = await operator
      .from('missed_calls')
      .update({ started_at: new Date(0).toISOString(), call_status: 'busy' })
      .eq('id', id)
      .select();
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);

    const remove = await operator.from('missed_calls').delete().eq('id', id).select();
    expect(remove.error !== null || (remove.data ?? []).length === 0).toBe(true);

    const { data } = await admin
      .from('missed_calls')
      .select('id, call_status, started_at')
      .eq('id', id)
      .single();
    expect(data?.call_status).toBe('completed');
    expect(new Date(data!.started_at as string).getTime()).toBeGreaterThan(0);
  });

  it('refuses an UPDATE and a DELETE on tenant_divert_numbers — no release path (D-08)', async () => {
    const tenant = await seedTenant('Missed Calls Divert Grants');
    tenantIds.push(tenant);
    const id = await seedDivertNumber(tenant);

    const update = await operator
      .from('tenant_divert_numbers')
      .update({ number_e164: '+61891570198' })
      .eq('id', id)
      .select();
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);

    // DELETE IS THE RELEASE PATH, spelled as a statement. There is no grant.
    const remove = await operator.from('tenant_divert_numbers').delete().eq('id', id).select();
    expect(remove.error !== null || (remove.data ?? []).length === 0).toBe(true);

    const { data } = await admin
      .from('tenant_divert_numbers')
      .select('id, number_e164')
      .eq('id', id)
      .single();
    expect(data?.id).toBe(id);
    expect(data?.number_e164).not.toBe('+61891570198');
  });
});

/* -------------------------------------------------------------------------- *
 * (e) The two-arm policy
 * -------------------------------------------------------------------------- */

describe('the member-or-operator policy (T-11-15)', () => {
  let idA: string;
  let idB: string;
  let deadLetterId: string;

  beforeAll(async () => {
    idA = await seedMissedCall(seeded.tenantA);
    idB = await seedMissedCall(seeded.tenantB);
    // A DEAD LETTER: a call to a number nobody owns. No caller data (D-07).
    deadLetterId = await seedMissedCall(null, {
      caller_e164: null,
      caller_kind: 'withheld',
      caller_withheld: true,
      dead_letter_reason: 'unknown_number',
    });
    deadLetterIds.push(deadLetterId);
  });

  it("shows the operator their own client's calls (the member arm)", async () => {
    const { data, error } = await operator.from('missed_calls').select('id').eq('id', idA);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: idA }]);
  });

  it("hides another client's calls — empty, not an error", async () => {
    // Denial and absence indistinguishable (T-03-02): a 42501 here would tell
    // the caller the row exists.
    const { data, error } = await operator.from('missed_calls').select('id').eq('id', idB);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const tenantB = await operator
      .from('missed_calls')
      .select('id')
      .eq('tenant_id', seeded.tenantB);
    expect(tenantB.data).toEqual([]);
  });

  it('shows a tenant-NULL dead letter to the operator (the is_operator() arm)', async () => {
    // `has_tenant_access(NULL)` admits nobody, so without the second arm a
    // dead letter would be invisible to the one person who has to triage it.
    const { data, error } = await operator
      .from('missed_calls')
      .select('id, tenant_id, dead_letter_reason')
      .eq('id', deadLetterId);
    expect(error).toBeNull();
    expect(data).toEqual([
      { id: deadLetterId, tenant_id: null, dead_letter_reason: 'unknown_number' },
    ]);
  });

  it("hides another client's divert number, and shows their own", async () => {
    const own = await seedDivertNumber(seeded.tenantA);
    const theirs = await seedDivertNumber(seeded.tenantB);

    const mine = await operator.from('tenant_divert_numbers').select('id').eq('id', own);
    expect(mine.data).toEqual([{ id: own }]);

    const stranger = await operator.from('tenant_divert_numbers').select('id').eq('id', theirs);
    expect(stranger.error).toBeNull();
    expect(stranger.data).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * (f) The evidence read the verification-call proof uses
 * -------------------------------------------------------------------------- */

describe('getMissedCallForTenant — tenant in the predicate, no caller number', () => {
  it('returns null for ANOTHER tenant\'s call id and for an unknown id', async () => {
    const idB = await seedMissedCall(seeded.tenantB);

    expect(await getMissedCallForTenant(seeded.tenantA, idB)).toBeNull();
    expect(await getMissedCallForTenant(seeded.tenantA, randomUUID())).toBeNull();
    expect(await getMissedCallForTenant(seeded.tenantB, idB)).not.toBeNull();
  });

  it('returns the explicit evidence shape for the owner — and none of the three caller columns', async () => {
    const idA = await seedMissedCall(seeded.tenantA, {
      forwarded_from_raw: '+61891570100',
      caller_raw: CALLER,
      call_status: 'completed',
      duration_seconds: 9,
    });

    const row = await getMissedCallForTenant(seeded.tenantA, idA);

    expect(row?.id).toBe(idA);
    expect(row?.callStatus).toBe('completed');
    expect(row?.durationSeconds).toBe(9);
    // S3's question — did ForwardedFrom arrive — answered WITHOUT the number.
    expect(row?.forwardedFromPresent).toBe(true);
    expect(typeof row?.forwardedFromPresent).toBe('boolean');

    // T-10-20 / T-11-04: whatever this read returns ends up in a stored proof.
    const keys = Object.keys(row ?? {});
    expect(keys).not.toContain('callerE164');
    expect(keys).not.toContain('callerRaw');
    expect(keys).not.toContain('forwardedFromRaw');
  });

  it('answers forwardedFromPresent false when no ForwardedFrom arrived', async () => {
    const idA = await seedMissedCall(seeded.tenantA);
    expect((await getMissedCallForTenant(seeded.tenantA, idA))?.forwardedFromPresent).toBe(false);
  });

  it('answers callerPresent as a BOOLEAN — true with a caller, false when withheld (WR-02)', async () => {
    const present = await seedMissedCall(seeded.tenantA);
    const withheld = await seedMissedCall(seeded.tenantA, {
      caller_e164: null,
      caller_kind: 'withheld',
      caller_withheld: true,
    });

    const a = await getMissedCallForTenant(seeded.tenantA, present);
    const b = await getMissedCallForTenant(seeded.tenantA, withheld);

    expect(a?.callerPresent).toBe(true);
    expect(typeof a?.callerPresent).toBe('boolean');
    expect(b?.callerPresent).toBe(false);
    expect(b?.callerWithheld).toBe(true);
  });
});

/* -------------------------------------------------------------------------- *
 * (g) The CHECK vocabularies — refused through the SERVICE ROLE
 * -------------------------------------------------------------------------- */

describe('missed_calls refuses every value outside its vocabulary', () => {
  /** A valid row for tenant A, one column away from each refusal below. */
  function validRow(): Record<string, unknown> {
    return {
      tenant_id: seeded.tenantA,
      provider_call_id: callSid(),
      called_number_e164: CALLED,
      // 2026-10 (Phase 12, IN-04): a mobile caller now MUST carry its number
      // (`missed_calls_withheld_has_no_number`), so the valid row says so.
      caller_e164: CALLER,
      caller_kind: 'mobile',
      started_at: new Date().toISOString(),
      after_hours: false,
      source: 'webhook',
    };
  }

  it.each([
    ['an unknown call_status', { call_status: 'answered' }, 'missed_calls_call_status_known'],
    ['an unknown caller_kind', { caller_kind: 'landline' }, 'missed_calls_caller_kind_known'],
    ['an unknown source', { source: 'manual' }, 'missed_calls_source_known'],
    [
      'an unknown dead_letter_reason',
      // 2026-10 (Phase 12, IN-04): on a TENANT-LESS row, because a tenant row
      // carrying any reason now trips `missed_calls_dead_letter_iff_no_tenant`
      // first (Postgres checks CHECKs in name order) — that case has its own
      // row below.
      { tenant_id: null, dead_letter_reason: 'spam' },
      'missed_calls_dead_letter_reason_known',
    ],
    ['a negative duration_seconds', { duration_seconds: -1 }, 'missed_calls_duration_nonnegative'],
    [
      'a row with neither a CallSid nor a dead-letter reason',
      { provider_call_id: null, dead_letter_reason: null },
      'missed_calls_call_id_or_dead_letter',
    ],

    // ── 2026-10 (Phase 12, migration 0039) ────────────────────────────────
    // IN-04: the consistency the writers already keep, made structural.
    [
      'a withheld caller WITH a number',
      { caller_kind: 'withheld', caller_withheld: true },
      'missed_calls_withheld_has_no_number',
    ],
    [
      'a mobile caller with NO number',
      { caller_e164: null },
      'missed_calls_withheld_has_no_number',
    ],
    [
      'a withheld flag that disagrees with the kind',
      { caller_withheld: true },
      'missed_calls_withheld_flag_consistent',
    ],
    [
      'a tenant row carrying a dead-letter reason',
      { dead_letter_reason: 'unknown_number' },
      'missed_calls_dead_letter_iff_no_tenant',
    ],
    // The text-back vocabularies and their consistency.
    [
      'an unknown text_back_status',
      { text_back_status: 'queued' },
      'missed_calls_text_back_status_known',
    ],
    [
      'an unknown text_back_skip_reason',
      { text_back_status: 'skipped', text_back_skip_reason: 'busy' },
      'missed_calls_text_back_skip_reason_known',
    ],
    [
      'an unknown text_back_route',
      { text_back_status: 'claimed', text_back_route: 'job' },
      'missed_calls_text_back_route_known',
    ],
    [
      'a text_back_detail that could carry a number or prose',
      { text_back_status: 'failed', text_back_detail: '+61491570156 failed' },
      'missed_calls_text_back_detail_shape',
    ],
    [
      'a skip reason on a row that was SENT',
      { text_back_status: 'sent', text_back_skip_reason: 'not_armed' },
      'missed_calls_skip_reason_iff_skipped',
    ],
    [
      'a skip reason on an UNDECIDED row',
      { text_back_skip_reason: 'not_armed' },
      'missed_calls_skip_reason_iff_skipped',
    ],
    [
      'a skipped row with no reason',
      { text_back_status: 'skipped' },
      'missed_calls_skip_reason_iff_skipped',
    ],
  ])('refuses %s', async (_label, override, constraint) => {
    // The most privileged client this codebase has, and it is still refused:
    // the TypeScript unions erase before the INSERT is built.
    const { error } = await admin.from('missed_calls').insert({ ...validRow(), ...override });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain(constraint);
  });
});

describe('missed_calls refuses a text-back decision on a dead letter (Phase 12)', () => {
  it('a row with no tenant can never carry a text-back status', async () => {
    const { error } = await admin.from('missed_calls').insert({
      tenant_id: null,
      provider_call_id: callSid(),
      called_number_e164: CALLED,
      caller_e164: null,
      caller_kind: 'withheld',
      caller_withheld: true,
      started_at: new Date().toISOString(),
      after_hours: false,
      source: 'webhook',
      dead_letter_reason: 'unknown_number',
      text_back_status: 'claimed',
    });

    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('missed_calls_no_text_back_on_dead_letter');
  });

  it('a new arrival is UNDECIDED: the arrival door writes no text-back column', async () => {
    const row = arrival();
    const inserted = await insertMissedCallArrival(row);
    const [stored] = await rowByCallSid(row.providerCallId!);
    expect(inserted?.id).toBe(stored?.id);
    expect(stored?.text_back_status).toBeNull();
    expect(stored?.text_back_skip_reason).toBeNull();
    expect(stored?.text_back_decided_at).toBeNull();
  });
});

/* -------------------------------------------------------------------------- *
 * (h) tenant_divert_numbers — one per client, never shared (D-02, D-08)
 * -------------------------------------------------------------------------- */

describe('tenant_divert_numbers refuses a second, a shared or a malformed number', () => {
  let tenantC: string;
  let tenantD: string;
  let numberC: string;

  beforeAll(async () => {
    tenantC = await seedTenant('Missed Calls Divert Owner');
    tenantD = await seedTenant('Missed Calls Divert Empty');
    tenantIds.push(tenantC, tenantD);

    const id = await seedDivertNumber(tenantC);
    const { data, error } = await admin
      .from('tenant_divert_numbers')
      .select('number_e164')
      .eq('id', id)
      .single();
    if (error) throw new Error(`Reading the seeded number failed: ${error.message}`);
    numberC = (data as { number_e164: string }).number_e164;
  });

  /** A valid row for tenant D, one column away from each refusal below. */
  function rowForD(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      tenant_id: tenantD,
      spoken_name: 'Seeded Sparks',
      status: 'active',
      // RANDOM, not time-stamped: a stamp could land on the seeded number and
      // turn a CHECK refusal below into a UNIQUE one.
      number_e164: `+6188${String(randomInt(10_000_000)).padStart(7, '0')}`,
      created_by: seeded.operatorId,
      ...overrides,
    };
  }

  it('refuses a SECOND row for the same client (23505, tenant_divert_numbers_tenant_uniq)', async () => {
    const { error } = await admin.from('tenant_divert_numbers').insert({
      tenant_id: tenantC,
      spoken_name: 'Second number',
      status: 'pending',
      created_by: seeded.operatorId,
    });

    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('tenant_divert_numbers_tenant_uniq');
  });

  it('refuses the SAME number on another client (23505, tenant_divert_numbers_number_uniq)', async () => {
    // Two rows owning one number would make "whose call is this" a coin toss.
    const { error } = await admin
      .from('tenant_divert_numbers')
      .insert(rowForD({ number_e164: numberC }));

    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('tenant_divert_numbers_number_uniq');
  });

  it.each([
    [
      'a spoken name of 61 characters',
      { spoken_name: 'x'.repeat(61) },
      'tenant_divert_numbers_spoken_name_length',
    ],
    ["status 'released'", { status: 'released' }, 'tenant_divert_numbers_status_known'],
    [
      'a number that is not E.164',
      { number_e164: '0891570156' },
      'tenant_divert_numbers_number_shape',
    ],
  ])('refuses %s', async (_label, override, constraint) => {
    const { error } = await admin.from('tenant_divert_numbers').insert(rowForD(override));

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain(constraint);
  });

  it('reads the owner\'s row through forTenant, and [] for a client with none', async () => {
    const own = await forTenant(tenantC).divertNumber.get();
    expect(own).toHaveLength(1);
    expect(own[0]?.numberE164).toBe(numberC);
    expect(own[0]?.status).toBe('active');

    expect(await forTenant(tenantD).divertNumber.get()).toEqual([]);
  });

  it('lets a second claim PROPAGATE 23505 — the double-provision guard', async () => {
    // Two concurrent "buy" clicks both try to INSERT the pending claim; the
    // second must fail BEFORE anything is purchased, and loudly.
    let thrown: unknown = null;
    try {
      await forTenant(tenantC).divertNumber.claim({
        spokenName: 'Double click',
        createdBy: seeded.operatorId,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).not.toBeNull();
    expect(sqlStateOf(thrown)).toBe('23505');
  });

  it('HOLDS a pending claim under the hold code and re-claims it only once it is stale (CR-01)', async () => {
    const repo = forTenant(tenantD);
    await repo.divertNumber.claim({ spokenName: 'Held Sparks', createdBy: seeded.operatorId });

    const held = await repo.divertNumber.hold({ failureCode: 'outcome_unknown' });
    expect(held).toHaveLength(1);
    expect(held[0]?.status).toBe('pending');
    expect(held[0]?.failureCode).toBe('outcome_unknown');

    // INSIDE THE HOLD the guard matches nothing — no second purchase may start.
    const early = await repo.divertNumber.reclaimStale('Held Sparks', new Date(Date.now() - 600_000));
    expect(early).toEqual([]);

    // PAST IT (a cutoff after updated_at) it re-claims, clearing the code.
    const late = await repo.divertNumber.reclaimStale('Held Sparks Again', new Date(Date.now() + 60_000));
    expect(late).toHaveLength(1);
    expect(late[0]?.status).toBe('pending');
    expect(late[0]?.failureCode).toBeNull();
    expect(late[0]?.spokenName).toBe('Held Sparks Again');
  });
});

/* -------------------------------------------------------------------------- *
 * (i) missedCalls.latest — the "last diverted call" the checklist reads
 * -------------------------------------------------------------------------- */

describe('forTenant().missedCalls.latest orders by started_at DESC, id DESC', () => {
  it('returns [] for a client with no calls', async () => {
    const tenant = await seedTenant('Missed Calls Latest Empty');
    tenantIds.push(tenant);
    expect(await forTenant(tenant).missedCalls.latest()).toEqual([]);
  });

  it('returns the newest call, and breaks a tie on started_at by the HIGHER id', async () => {
    const tenant = await seedTenant('Missed Calls Latest');
    tenantIds.push(tenant);

    const older = new Date(Date.now() - 3_600_000).toISOString();
    await seedMissedCall(tenant, { started_at: older });

    // TWO CALLS AT ONE INSTANT. A stable answer matters more than which wins,
    // and the tiebreak is pinned so it cannot drift to insertion order.
    const instant = new Date().toISOString();
    const first = await seedMissedCall(tenant, { started_at: instant });
    const second = await seedMissedCall(tenant, { started_at: instant });
    // uuid ordering in Postgres is bytewise, which for lowercase hex is the
    // string order.
    const expected = [first, second].sort().at(-1);

    const latest = await forTenant(tenant).missedCalls.latest();
    expect(latest).toHaveLength(1);
    expect(latest[0]?.id).toBe(expected);
    expect(latest[0]?.startedAt.toISOString()).toBe(new Date(instant).toISOString());
  });

  it('never returns another client\'s call', async () => {
    const tenant = await seedTenant('Missed Calls Latest Stranger');
    tenantIds.push(tenant);
    await seedMissedCall(seeded.tenantB);

    expect(await forTenant(tenant).missedCalls.latest()).toEqual([]);
  });
});
