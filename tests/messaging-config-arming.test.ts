/**
 * THE ARMING WRITER'S CONTRACT, ON A REAL DATABASE (ARM-02, D-04/D-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `armChannel` IS THE ONE WRITE THAT TURNS REAL CUSTOMER MESSAGING ON.     │
 * │ No deploy, no code change: `enabled = true` on a row carrying a          │
 * │ from-address and the next cadence tick sends to real people. Its         │
 * │ atomicity, its identity re-supply and its refusals are therefore proven  │
 * │ against Postgres — a mocked repository would only assert that the caller │
 * │ behaves, which is the guarantee 02-04 learned not to accept.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHERE THIS RUNS, AND WHERE IT MUST NOT ──────────────────────────────────
 *
 * DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS: `supabase start` on the runner,
 * a database created and destroyed with the job. It is NEVER run through
 * `npm run test:remote` (D-11) — the hosted Sydney project is production, and
 * the remote runner pauses the deployed pg_cron ticks to do it. A go-live
 * window is the worst possible hour to have paused the thing that sends.
 *
 * ── WHY IT IS SAFE FOR A TEST TO ARM ANYTHING AT ALL ────────────────────────
 *
 * One test here arms, because "the flip and its audit row are one transaction"
 * cannot be proven without a flip. It is bounded the four ways
 * `tests/routing-dispatch.test.ts` set out for the same manoeuvre, plus a
 * fifth:
 *
 *   1. EVERY ROW IT TOUCHES BELONGS TO A TENANT IT SEEDED SECONDS EARLIER —
 *      throwaway clients with no quotes, no cadences and no touches, so no tick
 *      could find anything of theirs to send.
 *   2. THE SHARED ROW IS NEVER READ AND NEVER WRITTEN. This suite poses no
 *      question about the row that belongs to everybody, which is what makes it
 *      true on any database where its own two tenants are fresh — including one
 *      where the founding client is armed.
 *   3. THE NUMBER IS FICTION. `0491 570 1xx` is the block ACMA reserves for it.
 *   4. NOTHING IS EVER SENT. No sender is constructed anywhere in this file.
 *   5. IT LEAVES NOTHING ARMED, asserted in the last test and enforced in
 *      `afterAll`, which deletes every config row BY ID before the tenants go —
 *      `messaging_config` has no foreign key to `tenants`, so `teardownTenants`
 *      cannot reach it and never will.
 *
 * And the fixture cannot arm: `seedMessagingConfigOverride` throws on
 * `enabled: true` before it runs a statement (04-03). Arming is an act
 * performed by a named operator through `armChannel`, which is the function
 * under test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveSmsFrom } from '../src/core/messaging/routing-sender';
import {
  armChannel,
  closeDb,
  disarmChannel,
  forAllTenants_armedBySmsGlobal,
  listChannelAudit,
} from '../src/db/repository';

import {
  admin,
  ensureOperatorExists,
  seedConnection,
  seedMessagingConfigOverride,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

/** ACMA's fiction block — this file writes a from-address that could be dialled. */
const SMS_FROM = '+61491570161';
const EMAIL_FROM = 'followups@quotes.example.test';

/**
 * The operator's real user id: `operator_user_id` is a uuid column, required on
 * every `actor = 'operator'` row (since 0039 a CHECK, not NOT NULL: a SYSTEM
 * disarm carries none — Phase 12, D-21).
 */
let operatorId: string;

/** The client with its OWN sms and email rows — every refusal is asked of these. */
let tenantA: string;
/** A client with NO sms row of its own, until the explicit-off case creates one. */
let tenantB: string;
/** Connected, and never given an sms row — the shared row's blast radius. */
let tenantC: string;

const tenantIds: string[] = [];
/** Every `messaging_config` row this suite created. Deleted BY ID, see `afterAll`. */
const configIds: string[] = [];

/** This client's own sms row — the exact row every arm here must update. */
let smsRowIdA: string;

/** The audit rows for one tenant and channel, oldest first. */
async function auditRows(
  tenantId: string,
  channel: 'sms' | 'email' | 'text_back',
): Promise<
  { id: string; action: string; reason: string | null; operator_user_id: string; actor: string }[]
> {
  const { data, error } = await admin
    .from('messaging_config_audit')
    .select('id, action, reason, operator_user_id, actor')
    .eq('tenant_id', tenantId)
    .eq('channel', channel)
    // `id` breaks a same-instant tie deterministically; the rows' ORDER is
    // what the on → off → on case asserts.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`Reading messaging_config_audit failed: ${error.message}`);
  return (data ?? []) as {
    id: string;
    action: string;
    reason: string | null;
    operator_user_id: string;
    actor: string;
  }[];
}

/** One tenant's own row for a channel, read with the admin client (no fallback). */
async function ownRow(
  tenantId: string,
  channel: 'sms' | 'email' | 'text_back',
): Promise<{ id: string; enabled: boolean; from_address: string | null } | null> {
  const { data, error } = await admin
    .from('messaging_config')
    .select('id, enabled, from_address')
    .eq('tenant_id', tenantId)
    .eq('channel', channel)
    .maybeSingle();
  if (error) throw new Error(`Reading messaging_config failed: ${error.message}`);
  return (data as { id: string; enabled: boolean; from_address: string | null } | null) ?? null;
}

beforeAll(async () => {
  operatorId = await ensureOperatorExists();

  tenantA = await seedTenant('Arming A');
  tenantB = await seedTenant('Arming B');
  tenantC = await seedTenant('Arming C Connected');
  tenantIds.push(tenantA, tenantB, tenantC);
  await seedConnection(tenantC);

  // THE PREMISE, ASKED OF THESE TENANTS ALONE. Three clients created seconds
  // ago must own no configuration at all; anything here would mean an id was
  // recycled or a previous run left residue that `teardownTenants` cannot
  // sweep. Scoped to our own ids on purpose — "no enabled row anywhere" is a
  // question about the deployment, and the deployment's answer is allowed to be
  // yes from the day the founding client goes live.
  const { data, error } = await admin
    .from('messaging_config')
    .select('id')
    .in('tenant_id', tenantIds);
  if (error) throw new Error(`Reading messaging_config failed: ${error.message}`);
  expect(
    data ?? [],
    'A freshly seeded tenant already owns a messaging_config row. Find it by ' +
      'tenant_id and delete it by id before re-running.',
  ).toHaveLength(0);

  // The identity, DISARMED — which is the state an operator arms FROM.
  smsRowIdA = await seedMessagingConfigOverride(tenantA, 'sms', { from_address: SMS_FROM });
  configIds.push(smsRowIdA);

  // Email with a from-address and a business name and NO reply-to: the
  // half-built identity `/settings/email` is allowed to save and `armChannel`
  // must refuse, because v1 captures no inbound email and a customer's "yes"
  // would land in a mailbox nobody reads (D-01).
  configIds.push(
    await seedMessagingConfigOverride(tenantA, 'email', {
      from_address: EMAIL_FROM,
      business_name: 'Arming A Pty Ltd (test)',
    }),
  );
});

afterAll(async () => {
  // BY ID and FIRST, whether or not the assertions passed: an enabled row must
  // not outlive this suite, and nothing else can delete it.
  const { data } = await admin
    .from('messaging_config')
    .select('id')
    .in('tenant_id', tenantIds);
  for (const id of new Set([...configIds, ...((data ?? []) as { id: string }[]).map((r) => r.id)])) {
    await admin.from('messaging_config').delete().eq('id', id);
  }

  // The audit rows for these throwaway tenants go too. They are evidence about
  // clients that never existed; the rows this suite must never touch — the ones
  // about the row that belongs to everybody — carry no tenant id and are
  // unreachable from this predicate by construction.
  const { error } = await admin
    .from('messaging_config_audit')
    .delete()
    .in('tenant_id', tenantIds);
  if (error) throw new Error(`Teardown failed, audit rows left behind: ${error.message}`);

  await teardownTenants(tenantIds);
  await closeDb();
});

/* -------------------------------------------------------------------------- *
 * The flip and the record of it
 * -------------------------------------------------------------------------- */

describe('armChannel writes the flip and its audit row together (D-04)', () => {
  it('arms THIS CLIENT\'S OWN ROW and records exactly one arm beside it', async () => {
    const result = await armChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: 'go-live rehearsal',
    });

    expect(result.kind).toBe('armed');

    // THE EXACT ROW, not a second one. An arm that INSERTED would leave two
    // rows for one client, and `getChannelConfig` would then return whichever
    // the planner picked — this system sending from an arbitrary number with no
    // error anywhere (the NULLS NOT DISTINCT argument, one table over).
    const row = await ownRow(tenantA, 'sms');
    expect(row?.id).toBe(smsRowIdA);
    expect(row?.enabled).toBe(true);

    const audit = await auditRows(tenantA, 'sms');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('arm');
    // THE HAND ON THE SWITCH. `requireOperatorId()` supplies this, never a form
    // field, and an operator row must carry it (`messaging_config_audit_actor_
    // identity`, 0039) because an arming with nobody's name on it is the row
    // this table exists to refuse. Only a SYSTEM disarm has no operator.
    expect(audit[0].operator_user_id).toBe(operatorId);
    expect(audit[0].reason).toBe('go-live rehearsal');

    // And the identity resolver — the authority the senders actually ask —
    // agrees. A green badge over a row whose number never reaches the resolver
    // is Pitfall 4.
    expect(await resolveSmsFrom(tenantA)).toBe(SMS_FROM);
  });

  it('arming an armed row is already_armed, and manufactures no history', async () => {
    const result = await armChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: 'second tap',
    });

    expect(result.kind).toBe('already_armed');
    // ONE AUDIT ROW PER EFFECTIVE ACTION. A second tap on a control that
    // already did its job is an ordinary answer, not an event — and a history
    // padded with flips that never happened is a history nobody can read.
    expect(await auditRows(tenantA, 'sms')).toHaveLength(1);
  });

  it('disarms with a reason, and the reason is on the record', async () => {
    const result = await disarmChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: 'rehearsal over',
    });

    expect(result.kind).toBe('disarmed');
    expect((await ownRow(tenantA, 'sms'))?.enabled).toBe(false);
    expect(await resolveSmsFrom(tenantA)).toBeNull();

    const audit = await auditRows(tenantA, 'sms');
    expect(audit).toHaveLength(2);
    expect(audit[1].action).toBe('disarm');
    // THE ONLY ACCOUNT ANYBODY WILL EVER HAVE OF WHY SENDING STOPPED, and the
    // database refuses a disarm row without one (the CHECK constraint).
    expect(audit[1].reason).toBe('rehearsal over');
  });

  it('disarming a disarmed row is already_disarmed, and writes nothing', async () => {
    const result = await disarmChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: 'already off',
    });

    expect(result.kind).toBe('already_disarmed');
    expect(await auditRows(tenantA, 'sms')).toHaveLength(2);
  });

  it('RE-SUPPLIES THE IDENTITY across an arm → disarm → arm cycle (Pitfall 4)', async () => {
    // The upsert's SET clause is exhaustive by design, so a writer that passed
    // only `{channel, tenant, enabled}` would null the from-address on every
    // flip: the row would arm, the resolver would return null, every send would
    // record `sms_not_configured`, and the console would show a green "Armed"
    // badge over it. The row is read INSIDE the transaction and every identity
    // field goes back in — which this asserts on the third flip, after the
    // number has survived being written twice.
    const result = await armChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
    });
    expect(result.kind).toBe('armed');

    const row = await ownRow(tenantA, 'sms');
    expect(row?.from_address).toBe(SMS_FROM);
    expect(row?.id).toBe(smsRowIdA);
    expect(await resolveSmsFrom(tenantA)).toBe(SMS_FROM);

    // An arm needs no reason; the audit row records the flip either way.
    const audit = await auditRows(tenantA, 'sms');
    expect(audit).toHaveLength(3);
    expect(audit[2].action).toBe('arm');
    expect(audit[2].reason).toBeNull();

    // Back off before the next test — this suite arms only inside the test that
    // is about arming.
    await disarmChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: 'end of the identity cycle',
    });
    expect((await ownRow(tenantA, 'sms'))?.enabled).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * Refusals — every one of them leaves the database untouched
 * -------------------------------------------------------------------------- */

describe('the refusals write nothing (D-01, D-05)', () => {
  it('refuses an email arm with no reply-to, and records no attempt', async () => {
    const result = await armChannel({
      channel: 'email',
      tenantId: tenantA,
      operatorUserId: operatorId,
    });

    expect(result).toEqual({ kind: 'no_identity', missing: 'reply_to' });

    // A REFUSAL IS NOT AN EVENT AND NOT A WRITE. The row stands as the settings
    // form left it, and nothing in the history claims an arming was attempted —
    // the audit table records flips, and no flip happened.
    const row = await ownRow(tenantA, 'email');
    expect(row?.enabled).toBe(false);
    expect(row?.from_address).toBe(EMAIL_FROM);
    expect(await auditRows(tenantA, 'email')).toHaveLength(0);
  });

  it('refuses a blank disarm reason BEFORE any statement runs', async () => {
    const before = await auditRows(tenantA, 'sms');

    const result = await disarmChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: '   ',
    });

    // The CHECK constraint would refuse this as a 23514 raised from inside the
    // transaction; the writer refuses it as an outcome the action turns into a
    // sentence. Whitespace is not a reason.
    expect(result).toEqual({ kind: 'reason_required' });
    expect(await auditRows(tenantA, 'sms')).toHaveLength(before.length);
  });

  it('ROLLS THE FLIP BACK when the audit row cannot be written', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. The upsert runs first and the audit
    // insert second, in ONE transaction: if they were two awaits, a failure
    // here would leave production ARMED with nothing to explain it, and the
    // next tick would send real customer messages.
    //
    // The failure is forced through the audit row's own NOT NULL uuid column —
    // an operator id Postgres cannot parse — so the rollback is exercised by
    // the real constraint rather than by a mock throwing on cue.
    const auditBefore = await auditRows(tenantA, 'sms');
    const rowBefore = await ownRow(tenantA, 'sms');
    expect(rowBefore?.enabled).toBe(false);

    await expect(
      armChannel({
        channel: 'sms',
        tenantId: tenantA,
        operatorUserId: 'not-a-uuid',
      }),
    ).rejects.toThrow();

    const rowAfter = await ownRow(tenantA, 'sms');
    expect(
      rowAfter?.enabled,
      'The config row is ENABLED after the audit insert failed. The flip and ' +
        'its audit row are not in one transaction: real customer messaging is ' +
        'armed with no record of who armed it.',
    ).toBe(false);
    expect(rowAfter?.from_address).toBe(SMS_FROM);
    expect(await auditRows(tenantA, 'sms')).toHaveLength(auditBefore.length);
  });
});

/* -------------------------------------------------------------------------- *
 * The explicit-off override, and the history read
 * -------------------------------------------------------------------------- */

describe('the explicit-off override and listChannelAudit', () => {
  it('CREATES a disabled row for a client that had none — off, while a sibling sends', async () => {
    // Disarming a client with no row of their own is not a no-op: it is the one
    // way to hold a single client off while the shared row is on. The row exists
    // to say OFF.
    const siblingArm = await armChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: 'sibling sends while B is held off',
    });
    expect(siblingArm.kind).toBe('armed');

    expect(await ownRow(tenantB, 'sms')).toBeNull();

    const result = await disarmChannel({
      channel: 'sms',
      tenantId: tenantB,
      operatorUserId: operatorId,
      reason: 'hold this client off',
    });
    expect(result.kind).toBe('disarmed');

    const created = await ownRow(tenantB, 'sms');
    expect(created).not.toBeNull();
    expect(created?.enabled).toBe(false);
    if (created) configIds.push(created.id);

    // THE PER-TENANT QUESTION, both ways round, in one breath: one client's row
    // arms that client and nobody else.
    expect(await resolveSmsFrom(tenantB)).toBeNull();
    expect(await resolveSmsFrom(tenantA)).toBe(SMS_FROM);

    await disarmChannel({
      channel: 'sms',
      tenantId: tenantA,
      operatorUserId: operatorId,
      reason: 'back off after the sibling case',
    });
  });

  it('returns the last flips NEWEST FIRST, and only this client\'s', async () => {
    const rows = await listChannelAudit('sms', { tenantId: tenantA, includeGlobal: false }, 3);

    expect(rows).toHaveLength(3);
    expect(rows[0].action).toBe('disarm');

    // NEWEST FIRST, asserted as an ordering rather than a fixed list: the card
    // renders these top-to-bottom as "what happened to this switch most
    // recently", and an ascending sort would put the oldest flip at the top
    // while looking entirely plausible.
    const times = rows.map((row) => row.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // `includeGlobal: false` means exactly that. Email's history is another
    // client's business, and the row that belongs to everybody has its own
    // arm in the predicate — asked for here, and refused.
    for (const row of rows) {
      expect(row.tenantId).toBe(tenantA);
      expect(row.channel).toBe('sms');
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The blast radius the two-tap warning names (10-03, D-03)
 * -------------------------------------------------------------------------- */

describe('forAllTenants_armedBySmsGlobal', () => {
  it('names the CONNECTED clients with no sms row of their own', async () => {
    const listed = await forAllTenants_armedBySmsGlobal();
    const ids = listed.map((client) => client.id);

    // RELATIVE, never an absolute count: this is a cross-tenant read on a
    // shared database, and every other client on it is a legitimate member of
    // the answer.
    expect(
      ids,
      'A connected client with no sms row of its own was NOT named. The shared ' +
        'row governs them, so one tap starts real messages to their customers ' +
        'and the warning would not have said so.',
    ).toContain(tenantC);

    // OWN ROW ⇒ NOT GOVERNED BY THE SHARED ONE, whatever that row says. The
    // predicate is absence of a row, not `enabled`: filtering on enabled would
    // drop a client the tap is about to start messaging for, and including a
    // client who has opted out of the shared row would name somebody the tap
    // cannot reach.
    expect(ids).not.toContain(tenantA);
    expect(ids).not.toContain(tenantB);

    // IDS AND NAMES ONLY — the whole return surface, because the consumer is
    // one sentence read between two taps.
    const mine = listed.find((client) => client.id === tenantC);
    expect(Object.keys(mine ?? {}).sort()).toEqual(['id', 'name']);
    expect(mine?.name).toContain('Arming C Connected');
  });

  it('drops a client whose connection is PAUSED — not connected, not messaged', async () => {
    const { error } = await admin
      .from('sm8_connections')
      .update({ paused_at: new Date().toISOString(), status_reason: 'auth_failed' })
      .eq('tenant_id', tenantC);
    if (error) throw new Error(`Pausing the connection failed: ${error.message}`);

    // A paused connection is a dead ServiceM8 key: no quotes are syncing, so no
    // cadence of theirs reaches a send, so the tap does not start anything for
    // them and the warning must not claim it does.
    expect(await forAllTenants_armedBySmsGlobal()).not.toContainEqual(
      expect.objectContaining({ id: tenantC }),
    );
  });
});

/* -------------------------------------------------------------------------- *
 * text_back — the per-client switch with no identity (12-08, D-09)
 * -------------------------------------------------------------------------- */

describe('text_back is armed and disarmed ONE CLIENT AT A TIME (D-09, TXT-05)', () => {
  it('refuses a NULL tenant on arm — per_tenant_only — and writes nothing', async () => {
    const before = await admin
      .from('messaging_config_audit')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'text_back')
      .is('tenant_id', null);

    const result = await armChannel({
      channel: 'text_back',
      tenantId: null,
      operatorUserId: operatorId,
      reason: 'a global text-back must not exist',
    });
    expect(result).toEqual({ kind: 'per_tenant_only' });

    const { count, error } = await admin
      .from('messaging_config')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'text_back')
      .is('tenant_id', null);
    if (error) throw new Error(`Reading messaging_config failed: ${error.message}`);
    expect(count).toBe(0);

    const after = await admin
      .from('messaging_config_audit')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'text_back')
      .is('tenant_id', null);
    expect(after.count).toBe(before.count);
  });

  it('refuses a NULL tenant on disarm too — there is no global row to turn off', async () => {
    const result = await disarmChannel({
      channel: 'text_back',
      tenantId: null,
      operatorUserId: operatorId,
      reason: 'a global text-back must not exist',
    });
    expect(result).toEqual({ kind: 'per_tenant_only' });
  });

  it('the database refuses a tenant-less text_back row outright (the CHECK)', async () => {
    const { error } = await admin
      .from('messaging_config')
      .insert({ channel: 'text_back', tenant_id: null, enabled: false })
      .select('id');

    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('messaging_config_text_back_per_tenant');
  });

  it('CREATES an enabled row with NULL identity for a client with none, beside one arm audit row', async () => {
    expect(await ownRow(tenantB, 'text_back')).toBeNull();

    const result = await armChannel({
      channel: 'text_back',
      tenantId: tenantB,
      operatorUserId: operatorId,
      reason: 'first text-back arm',
    });
    expect(result.kind).toBe('armed');
    if (result.kind !== 'armed') return;
    expect(result.config.tenantId).toBe(tenantB);
    expect(result.config.fromAddress).toBeNull();
    expect(result.config.replyTo).toBeNull();
    expect(result.config.businessName).toBeNull();

    const row = await ownRow(tenantB, 'text_back');
    expect(row?.enabled).toBe(true);
    expect(row?.from_address).toBeNull();

    const audit = await auditRows(tenantB, 'text_back');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'arm',
      actor: 'operator',
      operator_user_id: operatorId,
      reason: 'first text-back arm',
    });
  });

  it('on → off → on writes three rows IN ORDER; a repeat of the current state writes none', async () => {
    // (On from the case above.) A repeat arm is not an event.
    const again = await armChannel({
      channel: 'text_back',
      tenantId: tenantB,
      operatorUserId: operatorId,
    });
    expect(again.kind).toBe('already_armed');
    expect(await auditRows(tenantB, 'text_back')).toHaveLength(1);

    const off = await disarmChannel({
      channel: 'text_back',
      tenantId: tenantB,
      operatorUserId: operatorId,
      reason: 'client asked to pause',
    });
    expect(off.kind).toBe('disarmed');
    expect((await ownRow(tenantB, 'text_back'))?.enabled).toBe(false);

    const offAgain = await disarmChannel({
      channel: 'text_back',
      tenantId: tenantB,
      operatorUserId: operatorId,
      reason: 'second tap',
    });
    expect(offAgain.kind).toBe('already_disarmed');

    const on = await armChannel({
      channel: 'text_back',
      tenantId: tenantB,
      operatorUserId: operatorId,
      reason: 'client back on',
    });
    expect(on.kind).toBe('armed');

    const audit = await auditRows(tenantB, 'text_back');
    expect(audit.map((row) => [row.action, row.reason])).toEqual([
      ['arm', 'first text-back arm'],
      ['disarm', 'client asked to pause'],
      ['arm', 'client back on'],
    ]);

    // Leave nothing armed (the suite's rule).
    const end = await disarmChannel({
      channel: 'text_back',
      tenantId: tenantB,
      operatorUserId: operatorId,
      reason: 'end of the text-back arming test',
    });
    expect(end.kind).toBe('disarmed');
  });

  it('a disarm still needs a reason, before any statement', async () => {
    expect(
      await disarmChannel({
        channel: 'text_back',
        tenantId: tenantB,
        operatorUserId: operatorId,
        reason: '   ',
      }),
    ).toEqual({ kind: 'reason_required' });
  });

  it('arming one client\'s text_back writes no other client\'s row', async () => {
    expect(await ownRow(tenantA, 'text_back')).toBeNull();
    expect(await ownRow(tenantC, 'text_back')).toBeNull();
    expect(await ownRow(tenantC, 'sms')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- *
 * The rule the whole phase rests on
 * -------------------------------------------------------------------------- */

describe('this suite leaves nothing armed', () => {
  it('has no enabled row for any tenant it seeded', async () => {
    const { data, error } = await admin
      .from('messaging_config')
      .select('id, channel, tenant_id')
      .in('tenant_id', tenantIds)
      .eq('enabled', true);
    if (error) throw new Error(`Reading messaging_config failed: ${error.message}`);

    // Belt to `afterAll`'s braces. A test that armed and failed before its
    // disarm would leave a row enabled, and the alarm should be here — in the
    // file that did it — rather than in whichever suite runs next.
    expect(data ?? []).toHaveLength(0);
  });
});
