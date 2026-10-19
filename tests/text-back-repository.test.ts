/**
 * THE TEXT-BACK REPOSITORY SURFACE, PROVEN AT THE DATABASE (Phase 12, plan
 * 12-02; TXT-02/TXT-03, D-02/D-06/D-10/D-16/D-20/D-21).
 *
 * Plan 12-02 declares, once, every repository method plans 12-04..12-08
 * consume. This suite holds each one to the semantics those plans rely on:
 *
 *   - textBackTemplates — versions numbered per (tenant, variant) INSIDE the
 *     INSERT; WRITE-ONCE attestation; the newest-attested read ignores a later
 *     unattested edit; the set status is driven from the vocabulary (D-02).
 *   - neverText         — one row per number; removal is tenant-scoped; the
 *     own-line count counts own lines only (D-06, IN-07).
 *   - disarmChannelBySystem — `text_back` only, OFF only, one `actor = 'system'`
 *     audit row with no operator in the same transaction; nothing written for
 *     an absent or already-off row; and the database refuses the two forgeries
 *     (a system ARM, an operator row with no user id) on its own (D-21).
 *   - claimOperatorAlert — true once per (kind, day), false after (D-10).
 *   - listPendingTextBacks / markStaleTextBacks — the sweep window on the
 *     `coalesce(ended_at, started_at)` reference instant; decided rows and dead
 *     letters are never returned or marked (D-20).
 *   - claimTextBackAlerts — failed and stuck rows claimed once (D-10).
 *   - claimEscalationForMissedCall / listUnescalatedQuoteCalls — never twice
 *     per missed call (D-16).
 *   - getTextBackEvidenceForTenant — tenant in the predicate, no number.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production.
 *
 * ── THE GLOBAL READS RUN ON PINNED CLOCKS IN 2020 ────────────────────────────
 *
 * `listPendingTextBacks`, `markStaleTextBacks` and `claimTextBackAlerts` are
 * tenant-less by design (the tick asks them for EVERY client), so their
 * fixtures sit at fixed instants in 2020 — far from anything another suite
 * writes — and every assertion is filtered to this suite's own row ids or
 * tenant. The `operator_alert_log` latch is keyed on (kind, day), so this suite
 * uses days in 1999 and deletes them by key before and after.
 *
 * Every number is from ACMA's fiction block (0491 570 1xx / 08 9157 01xx).
 */
import { randomUUID } from 'node:crypto';

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimEscalationForMissedCall,
  claimOperatorAlert,
  claimTextBackAlerts,
  closeDb,
  disarmChannelBySystem,
  forTenant,
  getTextBackEvidenceForTenant,
  listArmedTextBackTenantIds,
  listPendingTextBacks,
  listUnescalatedQuoteCalls,
  markStaleTextBacks,
} from '../src/db/repository';

import { testEnv } from './helpers/env';
import {
  admin,
  ensureOperatorExists,
  seedCadence,
  seedLead,
  seedLeadCadence,
  seedMissedCall,
  seedQuotes,
  seedTenant,
  seedTextBackArmed,
  teardownTenants,
} from './helpers/seed';

/** Fiction-block numbers. */
const OWN_LINE = '+61491570181';
const OFFICE_LANDLINE = '+61891570182';
const NOT_LISTED = '+61491570189';
const ESCALATION_E164 = '+61491570152';

/** The `operator_alert_log` keys this suite owns. Deleted before and after. */
const ALERT_KIND = 'clicksend_balance_low';
const ALERT_DAY_1 = '1999-01-01';
const ALERT_DAY_2 = '1999-01-02';

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

let operatorId: string;
/** The working tenant. */
let tenantA: string;
/** A fresh tenant that owns nothing — the cross-tenant probe. */
let tenantB: string;
/** The alert-claim tenant, so the global claim's rows are attributable. */
let tenantC: string;

const configIds: string[] = [];
/** Dead letters carry no tenant: teardown cannot reach them, so they go BY ID. */
const deadLetterIds: string[] = [];

let sql: Sql;

async function deleteAlertKeys(): Promise<void> {
  for (const day of [ALERT_DAY_1, ALERT_DAY_2]) {
    const { error } = await admin
      .from('operator_alert_log')
      .delete()
      .eq('kind', ALERT_KIND)
      .eq('alert_day', day);
    if (error) throw new Error(`Deleting operator_alert_log rows failed: ${error.message}`);
  }
}

async function missedCallRow(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('missed_calls').select('*').eq('id', id).single();
  if (error) throw new Error(`Reading the missed call failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** A completed call whose reference instant (`ended_at`) is `ageMs` before `now`. */
async function callEndedAgo(
  tenantId: string | null,
  now: Date,
  ageMs: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const endedAt = new Date(now.getTime() - ageMs);
  const id = await seedMissedCall(tenantId, overrides, {
    caller: '+61491570190',
    startedAt: new Date(endedAt.getTime() - 20 * MS_PER_SECOND),
    endedAt,
  });
  if (tenantId === null) deadLetterIds.push(id);
  return id;
}

async function auditRowsFor(
  tenantId: string,
): Promise<Array<{ id: string; action: string; actor: string; operator_user_id: string | null; reason: string | null }>> {
  const { data, error } = await admin
    .from('messaging_config_audit')
    .select('id, action, actor, operator_user_id, reason')
    .eq('tenant_id', tenantId)
    .eq('channel', 'text_back')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading messaging_config_audit failed: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    action: string;
    actor: string;
    operator_user_id: string | null;
    reason: string | null;
  }>;
}

/** The message a refused raw INSERT raised, or `null` if it was accepted. */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return String((error as { message?: string }).message);
  }
}

beforeAll(async () => {
  operatorId = await ensureOperatorExists();
  tenantA = await seedTenant('TB Repo A');
  tenantB = await seedTenant('TB Repo B');
  tenantC = await seedTenant('TB Repo C');
  sql = postgres(testEnv.databaseUrl, { prepare: false, max: 1 });
  await deleteAlertKeys();
}, 60_000);

afterAll(async () => {
  // BY ID and FIRST: `messaging_config` has no FK, so teardown cannot reach it.
  const tenantIds = [tenantA, tenantB, tenantC];
  const { data } = await admin.from('messaging_config').select('id').in('tenant_id', tenantIds);
  for (const id of new Set([...configIds, ...((data ?? []) as Array<{ id: string }>).map((r) => r.id)])) {
    await admin.from('messaging_config').delete().eq('id', id);
  }
  await admin.from('messaging_config_audit').delete().in('tenant_id', tenantIds);
  for (const id of deadLetterIds) await admin.from('missed_calls').delete().eq('id', id);
  await deleteAlertKeys();
  await sql?.end({ timeout: 5 });
  await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

/* ------------------------------------------------------------------------- *
 * textBackTemplates (D-02)
 * ------------------------------------------------------------------------- */

describe('textBackTemplates: versioned, write-once attested (D-02)', () => {
  const AT = new Date('2026-10-01T01:00:00.000Z');
  let v1: string;
  let v2: string;

  it('reads all false for a tenant with no rows — driven from the vocabulary', async () => {
    expect(await forTenant(tenantB).textBackTemplates.attestedSetStatus()).toEqual({
      business_hours: false,
      after_hours: false,
      about_quote: false,
    });
  });

  it('numbers two saves of one variant 1 and 2, per variant, and never attests on save', async () => {
    const repo = forTenant(tenantA).textBackTemplates;
    const [first] = await repo.insertVersion({
      variant: 'business_hours',
      body: 'Version one wording. Reply STOP to opt out.',
      segments: 1,
      createdBy: operatorId,
    });
    const [second] = await repo.insertVersion({
      variant: 'business_hours',
      body: 'Version two wording. Reply STOP to opt out.',
      segments: 1,
      createdBy: operatorId,
    });
    const [otherVariant] = await repo.insertVersion({
      variant: 'after_hours',
      body: 'After-hours wording. Reply STOP to opt out.',
      segments: 1,
      createdBy: operatorId,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    // PER VARIANT: the after-hours count starts at 1 whatever business_hours did.
    expect(otherVariant.version).toBe(1);
    for (const row of [first, second, otherVariant]) {
      expect(row.attestedAt).toBeNull();
      expect(row.attestedBy).toBeNull();
      expect(row.attestationNote).toBeNull();
    }
    v1 = first.id;
    v2 = second.id;

    expect(await repo.attestedSetStatus()).toEqual({
      business_hours: false,
      after_hours: false,
      about_quote: false,
    });
  });

  it('attests a version exactly once — a second call changes nothing and returns no row', async () => {
    const repo = forTenant(tenantA).textBackTemplates;

    const first = await repo.attestWhereUnattested(v1, 'checked the wording', operatorId, AT);
    expect(first).toHaveLength(1);
    expect(first[0].attestedAt?.getTime()).toBe(AT.getTime());
    expect(first[0].attestedBy).toBe(operatorId);

    const second = await repo.attestWhereUnattested(
      v1,
      'a later, different note',
      operatorId,
      new Date(AT.getTime() + MS_PER_MINUTE),
    );
    expect(second).toEqual([]);

    const [reread] = await repo.byId(v1);
    expect(reread.attestationNote).toBe('checked the wording');
    expect(reread.attestedAt?.getTime()).toBe(AT.getTime());
  });

  it('reads the newest ATTESTED version for sending and the newest version for the form', async () => {
    const repo = forTenant(tenantA).textBackTemplates;
    // Version 2 is newer and unattested: what goes out is still version 1.
    expect((await repo.latestAttested('business_hours')).map((r) => r.id)).toEqual([v1]);
    expect((await repo.latestForVariant('business_hours')).map((r) => r.id)).toEqual([v2]);
    expect(await repo.latestAttested('about_quote')).toEqual([]);
  });

  it('reports true per attested variant and false for the rest', async () => {
    expect(await forTenant(tenantA).textBackTemplates.attestedSetStatus()).toEqual({
      business_hours: true,
      after_hours: false,
      about_quote: false,
    });
  });

  it('scopes byId and attestation to the tenant — another client cannot read or attest a version', async () => {
    const foreign = forTenant(tenantB).textBackTemplates;
    expect(await foreign.byId(v1)).toEqual([]);
    expect(await foreign.attestWhereUnattested(v2, 'not mine', operatorId, AT)).toEqual([]);

    const [stillUnattested] = await forTenant(tenantA).textBackTemplates.byId(v2);
    expect(stillUnattested.attestedAt).toBeNull();
  });

  it('two concurrent saves never share a version number', async () => {
    const repo = forTenant(tenantA).textBackTemplates;
    const save = () =>
      repo.insertVersion({
        variant: 'about_quote',
        body: 'About your quote. Reply STOP to opt out.',
        segments: 1,
        createdBy: operatorId,
      });

    const settled = await Promise.allSettled([save(), save()]);
    const versions = settled
      .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof save>>> => s.status === 'fulfilled')
      .map((s) => s.value[0].version);

    // Either they serialised (1 and 2) or one lost on the unique index — never
    // two rows carrying the same number.
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(new Set(versions).size).toBe(versions.length);

    const { data, error } = await admin
      .from('text_back_templates')
      .select('version')
      .eq('tenant_id', tenantA)
      .eq('variant', 'about_quote');
    if (error) throw new Error(`Reading versions failed: ${error.message}`);
    const stored = ((data ?? []) as Array<{ version: number }>).map((r) => r.version);
    expect(stored).toHaveLength(versions.length);
    expect(new Set(stored).size).toBe(stored.length);
  });
});

/* ------------------------------------------------------------------------- *
 * neverText (D-06, IN-07)
 * ------------------------------------------------------------------------- */

describe('neverText: one row per number, tenant-scoped removal, own lines counted (D-06)', () => {
  let ownLineId: string;

  it('adding the same number twice yields one row; the second add answers []', async () => {
    const repo = forTenant(tenantA).neverText;
    const first = await repo.add({ numberE164: OWN_LINE, kind: 'own_line', label: 'office mobile', createdBy: operatorId });
    expect(first).toHaveLength(1);
    ownLineId = first[0].id;

    const second = await repo.add({ numberE164: OWN_LINE, kind: 'never_text', label: null, createdBy: operatorId });
    expect(second).toEqual([]);

    const { count, error } = await admin
      .from('tenant_never_text_numbers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantA)
      .eq('number_e164', OWN_LINE);
    if (error) throw new Error(`Counting never-text rows failed: ${error.message}`);
    expect(count).toBe(1);
  });

  it('counts own_line rows only, and answers has() for this tenant alone', async () => {
    const repo = forTenant(tenantA).neverText;
    await repo.add({ numberE164: OFFICE_LANDLINE, kind: 'never_text', label: 'supplier', createdBy: operatorId });

    expect(await repo.countOwnLines()).toBe(1);
    expect(await repo.has(OWN_LINE)).toBe(true);
    expect(await repo.has(OFFICE_LANDLINE)).toBe(true);
    expect(await repo.has(NOT_LISTED)).toBe(false);
    expect(await forTenant(tenantB).neverText.has(OWN_LINE)).toBe(false);
    expect(await forTenant(tenantB).neverText.countOwnLines()).toBe(0);
  });

  it('removal is tenant-scoped: another client\'s id removes nothing', async () => {
    expect(await forTenant(tenantB).neverText.remove(ownLineId)).toEqual([]);
    expect(await forTenant(tenantA).neverText.has(OWN_LINE)).toBe(true);

    const removed = await forTenant(tenantA).neverText.remove(ownLineId);
    expect(removed.map((r) => r.id)).toEqual([ownLineId]);
    expect(await forTenant(tenantA).neverText.has(OWN_LINE)).toBe(false);
    expect(await forTenant(tenantA).neverText.countOwnLines()).toBe(0);
  });
});

/* ------------------------------------------------------------------------- *
 * disarmChannelBySystem (D-21)
 * ------------------------------------------------------------------------- */

describe('disarmChannelBySystem: text_back only, off only, audited as the system (D-21)', () => {
  const REASON = 'auto: ClickSend balance below A$5';

  beforeAll(async () => {
    configIds.push(await seedTextBackArmed(tenantA, { from_address: '+61491570150' }));
  });

  it('lists the armed tenant before the disarm', async () => {
    const armed = await listArmedTextBackTenantIds();
    expect(armed).toContain(tenantA);
    expect(armed).not.toContain(tenantB);
  });

  it('flips an armed row off and writes exactly one system audit row with a NULL operator', async () => {
    const result = await disarmChannelBySystem({
      channel: 'text_back',
      tenantId: tenantA,
      reason: `  ${REASON}  `,
    });

    expect(result.kind).toBe('disarmed');
    if (result.kind !== 'disarmed') throw new Error('unreachable');
    expect(result.config.enabled).toBe(false);

    const { data: row, error } = await admin
      .from('messaging_config')
      .select('enabled')
      .eq('tenant_id', tenantA)
      .eq('channel', 'text_back')
      .single();
    if (error) throw new Error(`Reading the text_back row failed: ${error.message}`);
    expect((row as { enabled: boolean }).enabled).toBe(false);

    const audit = await auditRowsFor(tenantA);
    expect(audit).toHaveLength(1);
    expect(audit[0].id).toBe(result.auditId);
    expect(audit[0].action).toBe('disarm');
    expect(audit[0].actor).toBe('system');
    expect(audit[0].operator_user_id).toBeNull();
    // Trimmed before any statement.
    expect(audit[0].reason).toBe(REASON);

    expect(await listArmedTextBackTenantIds()).not.toContain(tenantA);
  });

  it('an already-disarmed row writes nothing — no flip, no second audit row', async () => {
    const result = await disarmChannelBySystem({ channel: 'text_back', tenantId: tenantA, reason: REASON });
    expect(result.kind).toBe('already_disarmed');
    expect(await auditRowsFor(tenantA)).toHaveLength(1);
  });

  it('an absent row is already_disarmed and creates no row and no audit', async () => {
    const result = await disarmChannelBySystem({ channel: 'text_back', tenantId: tenantB, reason: REASON });
    expect(result).toEqual({ kind: 'already_disarmed', config: null });

    const { data, error } = await admin.from('messaging_config').select('id').eq('tenant_id', tenantB);
    if (error) throw new Error(`Reading messaging_config failed: ${error.message}`);
    expect(data ?? []).toEqual([]);
    expect(await auditRowsFor(tenantB)).toEqual([]);
  });

  it('refuses a blank reason before any statement', async () => {
    await expect(
      disarmChannelBySystem({ channel: 'text_back', tenantId: tenantA, reason: '   ' }),
    ).rejects.toThrow(/reason/);
    expect(await auditRowsFor(tenantA)).toHaveLength(1);
  });

  it('the database refuses a SYSTEM ARM audit row (messaging_config_audit_system_disarms)', async () => {
    const message = await refusal(
      () => sql`
        INSERT INTO public.messaging_config_audit (channel, tenant_id, action, actor, operator_user_id, reason)
        VALUES ('text_back', ${tenantA}, 'arm', 'system', NULL, 'test: must be refused')
      `,
    );
    expect(message).toContain('messaging_config_audit_system_disarms');
  });

  it('the database refuses an OPERATOR row with no user id (messaging_config_audit_actor_identity)', async () => {
    const message = await refusal(
      () => sql`
        INSERT INTO public.messaging_config_audit (channel, tenant_id, action, actor, operator_user_id, reason)
        VALUES ('text_back', ${tenantA}, 'disarm', 'operator', NULL, 'test: must be refused')
      `,
    );
    expect(message).toContain('messaging_config_audit_actor_identity');
    expect(await auditRowsFor(tenantA)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------- *
 * claimOperatorAlert (D-10)
 * ------------------------------------------------------------------------- */

describe('claimOperatorAlert: once per kind per Perth day (D-10)', () => {
  it('is true the first time, false the second, and true again for a different day', async () => {
    expect(await claimOperatorAlert(ALERT_KIND, ALERT_DAY_1, { balance_cents: 1999 })).toBe(true);
    expect(await claimOperatorAlert(ALERT_KIND, ALERT_DAY_1, { balance_cents: 1500 })).toBe(false);
    expect(await claimOperatorAlert(ALERT_KIND, ALERT_DAY_2)).toBe(true);
    expect(await claimOperatorAlert(ALERT_KIND, ALERT_DAY_2)).toBe(false);

    // The first claim's detail stands: nothing un-claims or rewrites.
    const { data, error } = await admin
      .from('operator_alert_log')
      .select('detail')
      .eq('kind', ALERT_KIND)
      .eq('alert_day', ALERT_DAY_1)
      .single();
    if (error) throw new Error(`Reading operator_alert_log failed: ${error.message}`);
    expect((data as { detail: unknown }).detail).toEqual({ balance_cents: 1999 });
  });

  it('refuses a malformed day before any statement', async () => {
    await expect(claimOperatorAlert(ALERT_KIND, '1/1/1999')).rejects.toThrow(/YYYY-MM-DD/);
  });
});

/* ------------------------------------------------------------------------- *
 * listPendingTextBacks / markStaleTextBacks (D-20)
 * ------------------------------------------------------------------------- */

describe('the sweep window and the stale mark (D-20)', () => {
  /** Pinned, in 2020: see the header. */
  const NOW = new Date('2020-01-15T02:00:00.000Z');
  const OLDER_THAN = new Date(NOW.getTime() - 45 * MS_PER_SECOND);
  const NEWER_THAN = new Date(NOW.getTime() - 10 * MS_PER_MINUTE);

  let aged44: string;
  let aged46: string;
  let aged601: string;
  let decidedInWindow: string;
  let decidedOld: string;
  let deadInWindow: string;
  let deadOld: string;
  let mine: Set<string>;

  beforeAll(async () => {
    aged44 = await callEndedAgo(tenantA, NOW, 44 * MS_PER_SECOND);
    aged46 = await callEndedAgo(tenantA, NOW, 46 * MS_PER_SECOND);
    aged601 = await callEndedAgo(tenantA, NOW, 601 * MS_PER_SECOND);
    decidedInWindow = await callEndedAgo(tenantA, NOW, 50 * MS_PER_SECOND, {
      text_back_status: 'skipped',
      text_back_skip_reason: 'own_number',
      text_back_decided_at: new Date(NOW.getTime() - 49 * MS_PER_SECOND).toISOString(),
    });
    decidedOld = await callEndedAgo(tenantA, NOW, 700 * MS_PER_SECOND, {
      text_back_status: 'skipped',
      text_back_skip_reason: 'not_armed',
      text_back_decided_at: new Date(NOW.getTime() - 699 * MS_PER_SECOND).toISOString(),
    });
    deadInWindow = await callEndedAgo(null, NOW, 46 * MS_PER_SECOND);
    deadOld = await callEndedAgo(null, NOW, 601 * MS_PER_SECOND);
    mine = new Set([aged44, aged46, aged601, decidedInWindow, decidedOld, deadInWindow, deadOld]);
  });

  it('a 45 s / 10 min window returns exactly the 46-second row — ids only', async () => {
    const pending = await listPendingTextBacks({ olderThan: OLDER_THAN, newerThan: NEWER_THAN, limit: 1000 });
    expect(pending.filter((r) => mine.has(r.id))).toEqual([{ id: aged46 }]);
    // IDS ONLY: no tenant, no number travels through the tick from here.
    for (const row of pending) expect(Object.keys(row)).toEqual(['id']);
  });

  it('marks only the undecided tenant row older than the bound as skipped / stale', async () => {
    const marked = await markStaleTextBacks(NEWER_THAN, NOW);
    expect(marked).toBeGreaterThanOrEqual(1);

    const stale = await missedCallRow(aged601);
    expect(stale.text_back_status).toBe('skipped');
    expect(stale.text_back_skip_reason).toBe('stale');
    expect(new Date(stale.text_back_decided_at as string).getTime()).toBe(NOW.getTime());

    for (const id of [aged44, aged46]) {
      expect((await missedCallRow(id)).text_back_status).toBeNull();
    }
    // A DECIDED ROW IS NEVER TOUCHED — its reason is still its own.
    const decided = await missedCallRow(decidedOld);
    expect(decided.text_back_status).toBe('skipped');
    expect(decided.text_back_skip_reason).toBe('not_armed');
    // A DEAD LETTER has nobody whose text-back it could be.
    expect((await missedCallRow(deadOld)).text_back_status).toBeNull();
  });

  it('the stale row is not offered again', async () => {
    const pending = await listPendingTextBacks({
      olderThan: OLDER_THAN,
      newerThan: new Date(NOW.getTime() - 60 * MS_PER_MINUTE),
      limit: 1000,
    });
    expect(pending.filter((r) => mine.has(r.id))).toEqual([{ id: aged46 }]);
  });

  it('reads the reference instant as coalesce(ended_at, started_at)', async () => {
    const NOW2 = new Date('2020-02-15T02:00:00.000Z');
    // Started two minutes ago but ENDED 30 s ago: too young — the end is the
    // reference whenever it is known.
    const endedRecently = await seedMissedCall(
      tenantA,
      {},
      {
        caller: '+61491570191',
        startedAt: new Date(NOW2.getTime() - 120 * MS_PER_SECOND),
        endedAt: new Date(NOW2.getTime() - 30 * MS_PER_SECOND),
      },
    );
    // Started two minutes ago with NO end recorded (a dropped callback): the
    // start is the reference, so it is due.
    const neverEnded = await seedMissedCall(
      tenantA,
      {},
      { caller: '+61491570192', startedAt: new Date(NOW2.getTime() - 120 * MS_PER_SECOND) },
    );

    const pending = await listPendingTextBacks({
      olderThan: new Date(NOW2.getTime() - 45 * MS_PER_SECOND),
      newerThan: new Date(NOW2.getTime() - 10 * MS_PER_MINUTE),
      limit: 1000,
    });
    const ids = pending.map((r) => r.id);
    expect(ids).toContain(neverEnded);
    expect(ids).not.toContain(endedRecently);
  });
});

/* ------------------------------------------------------------------------- *
 * claimTextBackAlerts (D-10)
 * ------------------------------------------------------------------------- */

describe('claimTextBackAlerts: failed and stuck rows, claimed once (D-10)', () => {
  const NOW = new Date('2020-03-15T02:00:00.000Z');
  const STUCK_BEFORE = new Date(NOW.getTime() - 2 * MS_PER_MINUTE);

  let failed: string;
  let stuck: string;
  let fresh: string;
  let sent: string;

  beforeAll(async () => {
    const decided = (status: string, agoMs: number, detail: string | null = null) => ({
      text_back_status: status,
      text_back_decided_at: new Date(NOW.getTime() - agoMs).toISOString(),
      text_back_detail: detail,
    });
    failed = await callEndedAgo(tenantC, NOW, 90 * MS_PER_SECOND, decided('failed', MS_PER_MINUTE, 'INSUFFICIENT_CREDIT'));
    stuck = await callEndedAgo(tenantC, NOW, 6 * MS_PER_MINUTE, decided('claimed', 5 * MS_PER_MINUTE));
    fresh = await callEndedAgo(tenantC, NOW, 60 * MS_PER_SECOND, decided('claimed', 30 * MS_PER_SECOND));
    sent = await callEndedAgo(tenantC, NOW, 11 * MS_PER_MINUTE, decided('sent', 10 * MS_PER_MINUTE));
  });

  it('returns the failed row and the stuck claimed row once, as tenant / status / code only', async () => {
    const claimed = (await claimTextBackAlerts(NOW, STUCK_BEFORE)).filter((r) => r.tenantId === tenantC);

    expect(claimed.map((r) => r.status).sort()).toEqual(['claimed', 'failed']);
    expect(claimed.find((r) => r.status === 'failed')?.detail).toBe('INSUFFICIENT_CREDIT');
    for (const row of claimed) {
      expect(Object.keys(row).sort()).toEqual(['detail', 'repeatToday', 'skipReason', 'status', 'tenantId']);
      expect(row.skipReason).toBeNull();
      expect(row.repeatToday).toBe(false);
    }

    for (const id of [failed, stuck]) {
      expect(new Date((await missedCallRow(id)).text_back_alerted_at as string).getTime()).toBe(NOW.getTime());
    }
    for (const id of [fresh, sent]) {
      expect((await missedCallRow(id)).text_back_alerted_at).toBeNull();
    }
  });

  it('returns neither on a second call — the stamp IS the decision to alert', async () => {
    const again = (await claimTextBackAlerts(new Date(NOW.getTime() + MS_PER_MINUTE), STUCK_BEFORE)).filter(
      (r) => r.tenantId === tenantC,
    );
    expect(again).toEqual([]);
  });
});

describe("claimTextBackAlerts: an ARMED client's configuration skips (12-REVIEW WR-02)", () => {
  const MS_PER_HOUR = 60 * MS_PER_MINUTE;
  // 10:00 AWST on 16 Mar 2020; that Perth day began at 16:00 UTC on 15 Mar.
  const NOW = new Date('2020-03-16T02:00:00.000Z');
  const DAY_START = new Date('2020-03-15T16:00:00.000Z');
  const stuckBefore = (now: Date) => new Date(now.getTime() - 2 * MS_PER_MINUTE);
  const windowAt = (now: Date, dayStart: Date) => ({
    since: new Date(now.getTime() - 24 * MS_PER_HOUR),
    dayStart,
  });
  const skipped = (reason: string, at: Date) => ({
    text_back_status: 'skipped',
    text_back_skip_reason: reason,
    text_back_decided_at: at.toISOString(),
  });

  let armed: string;
  let unarmed: string;
  let noTemplate: string;
  let smsNotArmed: string;
  let otherSkip: string;
  let tooOld: string;
  let unarmedSkip: string;

  beforeAll(async () => {
    armed = await seedTenant('TB Repo Config Armed');
    unarmed = await seedTenant('TB Repo Config Unarmed');
    await seedTextBackArmed(armed);

    noTemplate = await callEndedAgo(armed, NOW, 5 * MS_PER_MINUTE, skipped('no_template', NOW));
    smsNotArmed = await callEndedAgo(armed, NOW, 6 * MS_PER_MINUTE, skipped('sms_not_armed', NOW));
    // A caller's circumstance, not the client's configuration: never this arm.
    otherSkip = await callEndedAgo(armed, NOW, 7 * MS_PER_MINUTE, skipped('daily_cap', NOW));
    // An earlier armed spell: outside the look-back.
    tooOld = await callEndedAgo(armed, NOW, 25 * MS_PER_HOUR, skipped('no_template', NOW));
    // Text-back is not armed for this client NOW: not alerted.
    unarmedSkip = await callEndedAgo(unarmed, NOW, 5 * MS_PER_MINUTE, skipped('no_template', NOW));
  });

  afterAll(async () => {
    const ids = [armed, unarmed];
    await admin.from('messaging_config').delete().in('tenant_id', ids);
    await admin.from('messaging_config_audit').delete().in('tenant_id', ids);
    await teardownTenants(ids);
  });

  it('without the window the arm does not run — the three failure arms are unchanged', async () => {
    const claimed = (await claimTextBackAlerts(NOW, stuckBefore(NOW))).filter((r) =>
      [armed, unarmed].includes(r.tenantId),
    );
    expect(claimed).toEqual([]);
    expect((await missedCallRow(noTemplate)).text_back_alerted_at).toBeNull();
  });

  it('claims the armed client\'s no_template and sms_not_armed rows once, and nothing else', async () => {
    const claimed = (await claimTextBackAlerts(NOW, stuckBefore(NOW), windowAt(NOW, DAY_START))).filter((r) =>
      [armed, unarmed].includes(r.tenantId),
    );

    expect(claimed.map((r) => r.skipReason).sort()).toEqual(['no_template', 'sms_not_armed']);
    for (const row of claimed) {
      expect(row).toMatchObject({ tenantId: armed, status: 'skipped', detail: null, repeatToday: false });
    }
    for (const id of [noTemplate, smsNotArmed]) {
      expect(new Date((await missedCallRow(id)).text_back_alerted_at as string).getTime()).toBe(NOW.getTime());
    }
    for (const id of [otherSkip, tooOld, unarmedSkip]) {
      expect((await missedCallRow(id)).text_back_alerted_at).toBeNull();
    }

    // The stamp is the decision: a second claim returns neither.
    const later = new Date(NOW.getTime() + MS_PER_MINUTE);
    const again = (await claimTextBackAlerts(later, stuckBefore(later), windowAt(later, DAY_START))).filter(
      (r) => r.tenantId === armed,
    );
    expect(again).toEqual([]);
  });

  it('a later caller the SAME Perth day is claimed as a repeat; the next Perth day is not', async () => {
    const sameDay = new Date(NOW.getTime() + MS_PER_HOUR);
    await callEndedAgo(armed, sameDay, MS_PER_MINUTE, skipped('no_template', sameDay));
    const repeat = (
      await claimTextBackAlerts(sameDay, stuckBefore(sameDay), windowAt(sameDay, DAY_START))
    ).filter((r) => r.tenantId === armed);
    expect(repeat).toHaveLength(1);
    expect(repeat[0]?.repeatToday).toBe(true);

    // 00:30 AWST on 17 Mar: a new Perth day.
    const nextDay = new Date('2020-03-16T16:30:00.000Z');
    await callEndedAgo(armed, nextDay, MS_PER_MINUTE, skipped('sms_not_armed', nextDay));
    const fresh = (
      await claimTextBackAlerts(nextDay, stuckBefore(nextDay), windowAt(nextDay, new Date('2020-03-16T16:00:00.000Z')))
    ).filter((r) => r.tenantId === armed);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.repeatToday).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * claimEscalationForMissedCall / listUnescalatedQuoteCalls (D-16)
 * ------------------------------------------------------------------------- */

describe('the missed-quote-call escalation claim (D-16)', () => {
  let quoteId: string;
  let quoteCadenceId: string;
  let quoteCall: string;
  let leadRouteCall: string;
  let tooOldCall: string;
  let inFlightCall: string;
  let stuckCall: string;

  /** The pass's two bounds at `at` (12-REVIEW WR-05): a day back, two minutes stuck. */
  const windowAt = (at: Date) => ({
    notBefore: new Date(at.getTime() - 24 * 60 * MS_PER_MINUTE),
    stuckBefore: new Date(at.getTime() - 2 * MS_PER_MINUTE),
  });

  beforeAll(async () => {
    const [quote] = await seedQuotes(tenantA, [
      { job_description: 'tb-repo: quote call', chase_eligibility: 'eligible' },
    ]);
    quoteId = quote.id;
    quoteCadenceId = await seedCadence(tenantA, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_mobile: '+61491570193',
    });
    const now = new Date();
    quoteCall = await callEndedAgo(tenantA, now, 30 * MS_PER_SECOND, {
      text_back_status: 'sent',
      text_back_route: 'quote',
      text_back_decided_at: now.toISOString(),
      cadence_id: quoteCadenceId,
    });
    leadRouteCall = await callEndedAgo(tenantA, now, 30 * MS_PER_SECOND, {
      text_back_status: 'sent',
      text_back_route: 'lead',
      text_back_decided_at: now.toISOString(),
      cadence_id: randomUUID(),
    });
    // WR-05: a day and a minute old — a backlog, not news.
    const dayAgo = new Date(now.getTime() - (24 * 60 + 1) * MS_PER_MINUTE);
    tooOldCall = await callEndedAgo(tenantA, now, (24 * 60 + 1) * MS_PER_MINUTE, {
      text_back_status: 'sent',
      text_back_route: 'quote',
      text_back_decided_at: dayAgo.toISOString(),
      cadence_id: quoteCadenceId,
    });
    // WR-05: the about-quote text is in flight (claimed ten seconds ago).
    inFlightCall = await callEndedAgo(tenantA, now, 30 * MS_PER_SECOND, {
      text_back_status: 'claimed',
      text_back_route: 'quote',
      text_back_decided_at: new Date(now.getTime() - 10 * MS_PER_SECOND).toISOString(),
      cadence_id: quoteCadenceId,
    });
    // …and one claimed five minutes ago with no outcome: stuck, told as unconfirmed.
    stuckCall = await callEndedAgo(tenantA, now, 6 * MS_PER_MINUTE, {
      text_back_status: 'claimed',
      text_back_route: 'quote',
      text_back_decided_at: new Date(now.getTime() - 5 * MS_PER_MINUTE).toISOString(),
      cadence_id: quoteCadenceId,
    });
  });

  it('never lists a call older than the bound, nor one whose text is still in flight (12-REVIEW WR-05)', async () => {
    const owed = await listUnescalatedQuoteCalls(1000, windowAt(new Date()));
    const ids = owed.map((r) => r.missedCallId);
    expect(ids).not.toContain(tooOldCall);
    expect(ids).not.toContain(inFlightCall);
    expect(ids).toContain(stuckCall);
  });

  it('lists a route-quote call with no escalation — three ids per row — and never a lead-route call', async () => {
    const owed = await listUnescalatedQuoteCalls(1000, windowAt(new Date()));
    expect(owed.filter((r) => r.missedCallId === quoteCall)).toEqual([
      { missedCallId: quoteCall, tenantId: tenantA, cadenceId: quoteCadenceId },
    ]);
    expect(owed.some((r) => r.missedCallId === leadRouteCall)).toBe(false);
  });

  it('claims once per missed call: the second claim is null and one row exists', async () => {
    const claim = {
      missedCallId: quoteCall,
      tenantId: tenantA,
      cadenceId: quoteCadenceId,
      quoteId,
      // 2026-10 (13-03): the claim names its lead (none, a quote call) and
      // states its hold (not held).
      leadId: null,
      toAddress: ESCALATION_E164,
      holdUntil: null,
      at: new Date(),
    };
    const first = await claimEscalationForMissedCall(claim);
    expect(first).not.toBeNull();
    expect(await claimEscalationForMissedCall(claim)).toBeNull();

    const { data, error } = await admin
      .from('escalations')
      .select('id, inbound_message_id, missed_call_id, outcome')
      .eq('missed_call_id', quoteCall);
    if (error) throw new Error(`Reading escalations failed: ${error.message}`);
    expect(data).toEqual([
      { id: first?.id, inbound_message_id: null, missed_call_id: quoteCall, outcome: null },
    ]);
  });

  it('stops listing the call once its escalation row exists', async () => {
    const owed = await listUnescalatedQuoteCalls(1000, windowAt(new Date()));
    expect(owed.some((r) => r.missedCallId === quoteCall)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * getTextBackEvidenceForTenant (12-08's proof read)
 * ------------------------------------------------------------------------- */

describe('getTextBackEvidenceForTenant: tenant in the predicate, no number', () => {
  const DELIVERED_AT = new Date('2026-10-01T02:00:30.000Z');
  let sentCall: string;
  let skippedCall: string;

  beforeAll(async () => {
    const leadId = await seedLead(tenantA, { contact_mobile: '+61491570194' });
    const leadCadenceId = await seedLeadCadence(tenantA, leadId, { contact_mobile: '+61491570194' });

    const { data: ledger, error } = await admin
      .from('send_ledger')
      .insert({
        tenant_id: tenantA,
        cadence_id: leadCadenceId,
        lead_id: leadId,
        quote_id: null,
        touch_number: 1,
        channel: 'sms',
        to_address: '+61491570194',
        sender: 'clicksend',
        outcome: 'sent',
        provider_message_id: 'cs-evidence-0001',
        claimed_at: '2026-10-01T02:00:00.000Z',
        delivery_status: 'delivered',
        delivered_at: DELIVERED_AT.toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`Seeding the text-back ledger row failed: ${error.message}`);

    const endedAt = new Date('2026-10-01T01:59:50.000Z');
    sentCall = await seedMissedCall(
      tenantA,
      {
        text_back_status: 'sent',
        text_back_route: 'lead',
        text_back_decided_at: '2026-10-01T02:00:00.000Z',
        lead_id: leadId,
        cadence_id: leadCadenceId,
        text_back_ledger_id: (ledger as { id: string }).id,
      },
      {
        caller: '+61491570194',
        forwardedFrom: '+61891570195',
        afterHours: true,
        startedAt: new Date(endedAt.getTime() - 20 * MS_PER_SECOND),
        endedAt,
      },
    );
    skippedCall = await callEndedAgo(tenantA, new Date('2026-10-01T03:00:00.000Z'), 30 * MS_PER_SECOND, {
      text_back_status: 'skipped',
      text_back_skip_reason: 'not_armed',
      text_back_decided_at: '2026-10-01T03:00:00.000Z',
    });
  });

  it('returns the call and its delivered ledger row, with no number anywhere in the answer', async () => {
    const evidence = await getTextBackEvidenceForTenant(tenantA, sentCall);
    expect(evidence).not.toBeNull();
    expect(Object.keys(evidence ?? {}).sort()).toEqual(
      [
        'afterHours',
        'claimedAt',
        'deliveredAt',
        'deliveryStatus',
        'endedAt',
        'forwardedFromPresent',
        'id',
        'outcome',
        'providerMessageId',
        'startedAt',
        'textBackRoute',
        'textBackStatus',
      ].sort(),
    );
    expect(evidence?.textBackStatus).toBe('sent');
    expect(evidence?.textBackRoute).toBe('lead');
    expect(evidence?.afterHours).toBe(true);
    expect(evidence?.forwardedFromPresent).toBe(true);
    expect(evidence?.outcome).toBe('sent');
    expect(evidence?.providerMessageId).toBe('cs-evidence-0001');
    expect(evidence?.deliveryStatus).toBe('delivered');
    expect(evidence?.deliveredAt?.getTime()).toBe(DELIVERED_AT.getTime());
    // T-12-07: the caller's number and the forwarding number never leave SQL.
    expect(JSON.stringify(evidence)).not.toMatch(/\+61|0491/);
  });

  it('null-fills the ledger half for a call that was never sent', async () => {
    const evidence = await getTextBackEvidenceForTenant(tenantA, skippedCall);
    expect(evidence?.textBackStatus).toBe('skipped');
    expect(evidence?.outcome).toBeNull();
    expect(evidence?.providerMessageId).toBeNull();
    expect(evidence?.deliveryStatus).toBeNull();
  });

  it('returns null for another tenant\'s row and for an unknown id, indistinguishably', async () => {
    expect(await getTextBackEvidenceForTenant(tenantB, sentCall)).toBeNull();
    expect(await getTextBackEvidenceForTenant(tenantA, randomUUID())).toBeNull();
  });
});
