/**
 * MSG-04 against the real database: WHOSE conversation is this, and what may we
 * do about it when we are not sure.
 *
 * ── WHAT THIS SUITE IS ACTUALLY PROVING ─────────────────────────────────────
 *
 * `tests/inbound-stop.test.ts` proves the one path 04-01 built: a STOP with
 * exactly one live cadence. Everything hard about inbound is in the branches it
 * did NOT cover, and every one of them fails silently:
 *
 *   • An AMBIGUOUS reply that pauses a cadence hands anyone who can guess a
 *     phone number a lever that stops two clients' chases at once (T-4-06).
 *     Nothing in the console would look wrong; the follow-ups just never leave.
 *   • An AMBIGUOUS STOP that honours only the first candidate leaves the second
 *     human being chased after asking to stop — and WHICH human depends on a
 *     database sort order, so the same code is correct or a breach depending on
 *     a `created_at` tie. That is why the order-independence block below runs
 *     the same scenario twice with the candidates arriving in opposite orders.
 *   • An UNMATCHED STOP that records and does nothing is the Spam Act gap 04-01
 *     named in `inbound.ts`'s header. The row looks like evidence of handling.
 *
 * So the assertions here are about what did NOT happen as much as what did: the
 * ambiguous-reply block reads both cadences back and requires them still
 * `active`, and the bare-mobile block drives a REAL DISPATCH TICK and requires
 * it to refuse — the only assertion that distinguishes "a suppression row was
 * written" from "a suppression that actually suppresses".
 *
 * ── TWO TENANTS, BECAUSE ONE CANNOT EXPRESS THE PROBLEM ─────────────────────
 *
 * The interesting ambiguity is two different tradies who quoted the same
 * person. A single-tenant fixture would make every ambiguous case a
 * within-client duplicate, which is the easy half.
 *
 * ── TEARDOWN REACHES ACROSS TENANTS, ON PURPOSE ─────────────────────────────
 *
 * The unmatched-STOP path suppresses a bare mobile for EVERY client in the
 * database (D-03) — including the long-lived seed tenant on this hosted stack,
 * which no `teardownTenants` call of ours would touch. So this file deletes
 * suppression rows BY ADDRESS across all tenants, and every address it uses is
 * from the `0491 570 1xx` block ACMA reserves for fiction, so the delete can
 * never reach a real one. Inbound rows are deleted by id for the reason
 * `tests/inbound-stop.test.ts` states: an unattributed row carries a NULL
 * tenant and matches no tenant-keyed predicate.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { dispatchDueTouches } from '../src/core/cadence/dispatch';
import { StubSender } from '../src/core/cadence/sender';
import { isInsideWindow, type ContactWindow } from '../src/core/cadence/window';
import { handleInboundSms } from '../src/core/messaging/inbound';
import {
  closeDb,
  forAllTenants_cadencesByContactMobile,
  forAllTenants_ids,
  forTenant,
  listInboundNeedingTriage,
} from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

/** The window `seedTenant` creates: a Perth office week. */
const WINDOW: ContactWindow = {
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

const MS_PER_HOUR = 3_600_000;

/**
 * Every number here is in `0491 570 1xx` — the block ACMA reserves for use in
 * fiction, which can never be allocated to a real person. That matters more
 * than usual in this file: the unmatched-STOP path writes a suppression for
 * EVERY tenant on this shared hosted database, and teardown removes them by
 * address. A realistic-looking number would make both the write and the delete
 * a gamble on whose row it was.
 */
const THREAD_MOBILE = '+61491570100';
const AMBIG_REPLY_MOBILE = '+61491570101';
const AMBIG_STOP_MOBILE_X = '+61491570102';
const AMBIG_STOP_MOBILE_Y = '+61491570103';
const BARE_STOP_MOBILE = '+61491570104';
const UNMATCHED_REPLY_MOBILE = '+61491570105';
/** The D-13/D-15 triage-ordering fixtures. Inserted directly, never threaded. */
const TRIAGE_ORDER_MOBILE = '+61491570106';

/** Every address this suite may have written a suppression under. */
const TEST_ADDRESSES = [
  THREAD_MOBILE,
  AMBIG_REPLY_MOBILE,
  AMBIG_STOP_MOBILE_X,
  AMBIG_STOP_MOBILE_Y,
  BARE_STOP_MOBILE,
  UNMATCHED_REPLY_MOBILE,
  TRIAGE_ORDER_MOBILE,
];

/** Our own inbound number, as the provider reports it. */
const INBOUND_TO = '+61480000000';

let tenantA: string;
let tenantB: string;

/** Every inbound row this suite wrote — deleted by id in afterAll. */
const inboundIds: string[] = [];

/** Emails are per-cadence so a suppression can be traced to the cadence that owned it. */
function emailFor(label: string): string {
  return `${label}@quote-recovery-test.invalid`;
}

async function seedThreadable(
  tenantId: string,
  label: string,
  mobile: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: `threading: ${label}`, chase_eligibility: 'eligible' },
  ]);

  return seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Threading Test',
    contact_mobile: mobile,
    contact_email: emailFor(label),
    ...overrides,
  });
}

/** One inbound row by id, read with the admin client (service role, no RLS). */
async function inboundRow(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from('inbound_messages')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Reading inbound_messages failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Suppression rows for one address ACROSS EVERY TENANT — the D-03 fan-out. */
async function suppressionFor(
  address: string,
): Promise<Array<{ tenant_id: string; channel: string; source: string }>> {
  const { data, error } = await admin
    .from('suppressed_contacts')
    .select('tenant_id, channel, source')
    .eq('address', address);
  if (error) throw new Error(`Reading suppression failed: ${error.message}`);
  return (data ?? []) as Array<{ tenant_id: string; channel: string; source: string }>;
}

async function cadenceState(
  tenantId: string,
  cadenceId: string,
): Promise<{ status: string; pauseReason: string | null; stopReason: string | null }> {
  const [cadence] = await forTenant(tenantId).cadences.getById(cadenceId);
  return {
    status: cadence.status,
    pauseReason: cadence.pauseReason,
    stopReason: cadence.stopReason,
  };
}

/** `count` successive whole hours inside the tenant's contact window. */
function inWindowHours(count: number, from: number): Date[] {
  const found: Date[] = [];
  for (let step = 1; step <= 24 * 14 && found.length < count; step += 1) {
    const candidate = new Date(from + step * MS_PER_HOUR);
    if (isInsideWindow(candidate, WINDOW)) found.push(candidate);
  }
  if (found.length < count) {
    throw new Error(`Found only ${found.length} in-window hours within a fortnight.`);
  }
  return found;
}

beforeAll(async () => {
  tenantA = await seedTenant('Threading A');
  tenantB = await seedTenant('Threading B');
  // Unpaused, so the dispatch block below refuses for the reason under test
  // rather than skipping the tenant before it opens a claim transaction.
  await seedConnection(tenantA);
});

afterAll(async () => {
  if (inboundIds.length > 0) {
    const { error } = await admin.from('inbound_messages').delete().in('id', inboundIds);
    if (error) {
      throw new Error(`Teardown failed, inbound_messages left behind: ${error.message}`);
    }
  }

  // ACROSS EVERY TENANT, not just ours — see the header. The D-03 fan-out wrote
  // rows for tenants this suite did not create and must not delete.
  const { error } = await admin
    .from('suppressed_contacts')
    .delete()
    .in('address', [...TEST_ADDRESSES, ...['thread', 'ambig-reply', 'ambig-x-a', 'ambig-x-b', 'ambig-y-a', 'ambig-y-b', 'bare-dispatch', 'unmatched-reply'].map(emailFor)]);
  if (error) {
    throw new Error(`Teardown failed, suppressed_contacts left behind: ${error.message}`);
  }

  await teardownTenants([tenantA, tenantB]);
  await closeDb();
});

/* ------------------------------------------------------------------------- *
 * One candidate — the only branch that may pause
 * ------------------------------------------------------------------------- */

it('threads a unique reply, PAUSES its cadence, and records the pause result', async () => {
  const cadenceId = await seedThreadable(tenantA, 'thread', THREAD_MOBILE);

  const result = await handleInboundSms({
    // Local and spaced, deliberately unlike the `+614…` snapshot: MSG-04's
    // encoding edge on the path that matters most, since a failure to normalize
    // here would silently become an "unmatched" reply from the very customer we
    // just texted.
    from: '0491 570 100',
    to: INBOUND_TO,
    body: 'Yes please — can you do next Tuesday?',
    providerMessageId: 'test-threading-reply-1',
  });

  expect(result.kind).toBe('reply_threaded');
  if (result.kind !== 'reply_threaded') throw new Error('unreachable');
  inboundIds.push(result.inboundId);

  expect(result.tenantId).toBe(tenantA);
  expect(result.cadenceId).toBe(cadenceId);
  // D-05 performed, not merely intended. `pauseForReply` has been exported
  // since 03-05 waiting for exactly this caller.
  expect(result.pause).toBe('paused');

  expect(await cadenceState(tenantA, cadenceId)).toEqual({
    status: 'paused',
    pauseReason: 'customer_reply',
    stopReason: null,
  });

  const row = await inboundRow(result.inboundId);
  expect(row.attribution).toBe('threaded');
  expect(row.is_stop).toBe(false);
  expect(row.matched_cadence_count).toBe(1);
  expect(row.tenant_id).toBe(tenantA);
  expect(row.cadence_id).toBe(cadenceId);
  expect(row.quote_id).not.toBeNull();
  expect(row.normalized_from).toBe(THREAD_MOBILE);
  expect(row.candidate_tenant_ids).toBeNull();

  // A REPLY IS NOT AN OPT-OUT. Nothing about "can you do next Tuesday" should
  // ever reach the suppression list — that would end the conversation the pause
  // exists to protect.
  expect(await suppressionFor(THREAD_MOBILE)).toEqual([]);
});

/* ------------------------------------------------------------------------- *
 * Two candidates, ordinary reply — the branch that must do NOTHING
 * ------------------------------------------------------------------------- */

it('pauses NOTHING when a reply matches two clients (T-4-06)', async () => {
  const cadenceA = await seedThreadable(tenantA, 'ambig-reply', AMBIG_REPLY_MOBILE);
  const cadenceB = await seedThreadable(tenantB, 'ambig-reply', AMBIG_REPLY_MOBILE);

  const result = await handleInboundSms({
    from: AMBIG_REPLY_MOBILE,
    to: INBOUND_TO,
    body: 'sounds good, call me',
    providerMessageId: 'test-threading-ambiguous-reply',
  });

  expect(result.kind).toBe('reply_ambiguous');
  if (result.kind !== 'reply_ambiguous') throw new Error('unreachable');
  inboundIds.push(result.inboundId);
  expect(result.candidateCount).toBe(2);

  // ── THE ASSERTION THIS BLOCK EXISTS FOR ──────────────────────────────────
  //
  // Both cadences untouched. A reply-bomb from a spoofed number that two
  // cadences share must not be able to stop two clients' chases; a pause is
  // scheduling, not compliance, so it requires a UNIQUE match.
  expect(await cadenceState(tenantA, cadenceA)).toEqual({
    status: 'active',
    pauseReason: null,
    stopReason: null,
  });
  expect(await cadenceState(tenantB, cadenceB)).toEqual({
    status: 'active',
    pauseReason: null,
    stopReason: null,
  });

  const row = await inboundRow(result.inboundId);
  expect(row.attribution).toBe('ambiguous');
  expect(row.is_stop).toBe(false);
  expect(row.matched_cadence_count).toBe(2);
  // NOBODY OWNS IT. `has_tenant_access(NULL)` can never admit this row, so only
  // the operator arm of the policy sees it — which is the point.
  expect(row.tenant_id).toBeNull();
  expect(row.cadence_id).toBeNull();
  // The triage surface (04-06) renders these; without them an operator has a
  // row saying "two clients" and no way to learn which two.
  expect(new Set(row.candidate_tenant_ids as string[])).toEqual(
    new Set([tenantA, tenantB]),
  );
});

/* ------------------------------------------------------------------------- *
 * No candidate, ordinary reply
 * ------------------------------------------------------------------------- */

it('records an unmatched reply and writes nothing else', async () => {
  const result = await handleInboundSms({
    from: UNMATCHED_REPLY_MOBILE,
    to: INBOUND_TO,
    body: 'who is this?',
    providerMessageId: 'test-threading-unmatched-reply',
  });

  expect(result.kind).toBe('reply_unmatched');
  inboundIds.push(result.inboundId);

  const row = await inboundRow(result.inboundId);
  expect(row.attribution).toBe('unmatched');
  expect(row.is_stop).toBe(false);
  expect(row.matched_cadence_count).toBe(0);
  expect(row.tenant_id).toBeNull();
  expect(row.normalized_from).toBe(UNMATCHED_REPLY_MOBILE);

  // A wrong number is not an opt-out. Suppressing it would silently delete a
  // future customer of whichever client eventually quotes that person.
  expect(await suppressionFor(UNMATCHED_REPLY_MOBILE)).toEqual([]);
});

/* ------------------------------------------------------------------------- *
 * Two candidates, STOP — honoured for all, in any order
 * ------------------------------------------------------------------------- */

/**
 * The same scenario twice, with the candidate list arriving REVERSED.
 *
 * `forAllTenants_cadencesByContactMobile` orders by `(created_at, id)`. Scenario
 * X seeds tenant A's cadence first and scenario Y seeds tenant B's first, so the
 * two lists come back in opposite tenant orders — which the block asserts before
 * acting, because a test claiming order independence while feeding the same
 * order twice proves nothing at all.
 *
 * The `created_at` values are set explicitly rather than left to two successive
 * `now()` calls: a tie would make the order fall through to `id`, which is
 * random, and the suite would pass or fail on a uuid.
 */
async function seedOrderedPair(
  mobile: string,
  first: { tenantId: string; label: string },
  second: { tenantId: string; label: string },
): Promise<{ firstCadence: string; secondCadence: string }> {
  const base = Date.now() - 2 * MS_PER_HOUR;

  const firstCadence = await seedThreadable(first.tenantId, first.label, mobile, {
    created_at: new Date(base).toISOString(),
  });
  const secondCadence = await seedThreadable(second.tenantId, second.label, mobile, {
    created_at: new Date(base + 60_000).toISOString(),
  });

  return { firstCadence, secondCadence };
}

it('honours an ambiguous STOP for EVERY candidate, in either arrival order (D-03)', async () => {
  // Scenario X: tenant A's cadence sorts first.
  const x = await seedOrderedPair(
    AMBIG_STOP_MOBILE_X,
    { tenantId: tenantA, label: 'ambig-x-a' },
    { tenantId: tenantB, label: 'ambig-x-b' },
  );
  // Scenario Y: tenant B's cadence sorts first — the reversal.
  const y = await seedOrderedPair(
    AMBIG_STOP_MOBILE_Y,
    { tenantId: tenantB, label: 'ambig-y-b' },
    { tenantId: tenantA, label: 'ambig-y-a' },
  );

  // THE PREMISE, ASSERTED. Without this the two runs below could be identical
  // inputs dressed up as a symmetry test.
  const orderX = await forAllTenants_cadencesByContactMobile(AMBIG_STOP_MOBILE_X);
  const orderY = await forAllTenants_cadencesByContactMobile(AMBIG_STOP_MOBILE_Y);
  expect(orderX.map((c) => c.tenantId)).toEqual([tenantA, tenantB]);
  expect(orderY.map((c) => c.tenantId)).toEqual([tenantB, tenantA]);

  const resultX = await handleInboundSms({
    from: AMBIG_STOP_MOBILE_X,
    to: INBOUND_TO,
    body: 'STOP',
    providerMessageId: 'test-threading-ambiguous-stop-x',
  });
  const resultY = await handleInboundSms({
    from: AMBIG_STOP_MOBILE_Y,
    to: INBOUND_TO,
    body: 'STOP',
    providerMessageId: 'test-threading-ambiguous-stop-y',
  });

  expect(resultX.kind).toBe('stop_ambiguous');
  expect(resultY.kind).toBe('stop_ambiguous');
  if (resultX.kind !== 'stop_ambiguous' || resultY.kind !== 'stop_ambiguous') {
    throw new Error('unreachable');
  }
  inboundIds.push(resultX.inboundId, resultY.inboundId);

  // ── ORDER INDEPENDENCE, AS ONE COMPARISON ────────────────────────────────
  //
  // Every count identical, with the ids stripped. If the handler returned on
  // its first candidate, one of these would report one client and one cadence.
  const shape = (r: typeof resultX) => ({
    candidateCount: r.candidateCount,
    tenantsSuppressed: r.tenantsSuppressed,
    cadencesStopped: r.cadencesStopped,
    addressesSuppressed: r.addressesSuppressed,
  });
  expect(shape(resultX)).toEqual(shape(resultY));
  expect(shape(resultX)).toEqual({
    candidateCount: 2,
    tenantsSuppressed: 2,
    cadencesStopped: 2,
    // Two channels each, mobile and the paired email: honouring "stop
    // contacting me" on SMS while emailing them anyway is a loophole.
    addressesSuppressed: 4,
  });

  // BOTH CADENCES STOPPED, IN BOTH SCENARIOS. Terminal, never a pause — the
  // human asked us to stop, and a pause is a thing that can be resumed.
  for (const [tenantId, cadenceId] of [
    [tenantA, x.firstCadence],
    [tenantB, x.secondCadence],
    [tenantB, y.firstCadence],
    [tenantA, y.secondCadence],
  ] as const) {
    expect(await cadenceState(tenantId, cadenceId)).toEqual({
      status: 'stopped',
      pauseReason: null,
      // From the matrix's `contact_killed` arm, not a Phase 4 literal.
      stopReason: 'contact_suppressed',
    });
  }

  // Each mobile suppressed at BOTH clients, under the inbound source.
  for (const mobile of [AMBIG_STOP_MOBILE_X, AMBIG_STOP_MOBILE_Y]) {
    const rows = await suppressionFor(mobile);
    expect(rows.every((row) => row.source === 'sms_stop')).toBe(true);
    expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([tenantA, tenantB]));
    expect(rows.every((row) => row.channel === 'sms')).toBe(true);
  }

  // And the triage rows say who it could have been, for both.
  for (const result of [resultX, resultY]) {
    const row = await inboundRow(result.inboundId);
    expect(row.attribution).toBe('ambiguous');
    expect(row.is_stop).toBe(true);
    expect(row.matched_cadence_count).toBe(2);
    expect(row.tenant_id).toBeNull();
    expect(new Set(row.candidate_tenant_ids as string[])).toEqual(
      new Set([tenantA, tenantB]),
    );
  }
});

/* ------------------------------------------------------------------------- *
 * No candidate, STOP — the Spam Act gap 04-01 named
 * ------------------------------------------------------------------------- */

it('suppresses the bare mobile for EVERY client when a STOP matches nothing (D-03)', async () => {
  // The premise: nothing live carries this number, anywhere.
  expect(await forAllTenants_cadencesByContactMobile(BARE_STOP_MOBILE)).toEqual([]);

  const allTenants = await forAllTenants_ids();
  expect(allTenants).toContain(tenantA);
  expect(allTenants).toContain(tenantB);

  const result = await handleInboundSms({
    from: '0491 570 104',
    to: INBOUND_TO,
    body: 'Stop',
    providerMessageId: 'test-threading-bare-stop',
  });

  expect(result.kind).toBe('stop_unmatched');
  if (result.kind !== 'stop_unmatched') throw new Error('unreachable');
  inboundIds.push(result.inboundId);
  expect(result.tenantsSuppressed).toBe(allTenants.length);

  // ONE ROW PER TENANT, and the set is exactly the tenant set — not "at least
  // ours". Over-suppression is the compliant failure mode (D-03); a fan-out
  // that quietly covered only the tenants it happened to enumerate first would
  // leave the customer chaseable by whoever it missed.
  const rows = await suppressionFor(BARE_STOP_MOBILE);
  expect(rows).toHaveLength(allTenants.length);
  expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set(allTenants));
  expect(rows.every((row) => row.channel === 'sms' && row.source === 'sms_stop')).toBe(true);

  // MOBILE ONLY. There is no cadence, so there is no snapshot email to pair it
  // with — and guessing one would suppress an address this person may not own.
  const row = await inboundRow(result.inboundId);
  expect(row.attribution).toBe('unmatched');
  expect(row.is_stop).toBe(true);
  expect(row.matched_cadence_count).toBe(0);
  expect(row.tenant_id).toBeNull();
  expect(row.normalized_from).toBe(BARE_STOP_MOBILE);
});

it('makes a LATER cadence for that number refuse at the send gate', async () => {
  // ── THE ASSERTION THE BLOCK ABOVE CANNOT MAKE ────────────────────────────
  //
  // A suppression row looks right in the console whatever spelling it holds.
  // Only a real dispatch tick, probing with the cadence's own snapshot address,
  // can tell "a row exists" from "a row that suppresses". Seeded AFTER the
  // fan-out on purpose: created before it, this cadence would have been a
  // candidate and the STOP would not have been unmatched at all.
  const [dueAt] = inWindowHours(1, Date.now());

  const cadenceId = await seedThreadable(tenantA, 'bare-dispatch', BARE_STOP_MOBILE);
  const [touch] = await seedTouches(cadenceId, tenantA, [
    {
      status: 'approved',
      scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
      original_offset_days: 0,
    },
  ]);

  const result = await dispatchDueTouches({ sender: new StubSender(), now: dueAt });
  expect(result.refusals.suppressed).toBeGreaterThanOrEqual(1);

  const repo = forTenant(tenantA);
  const [refused] = (await repo.touches.listForCadence(cadenceId)).filter(
    (t) => t.id === touch.id,
  );
  expect(refused.status).toBe('skipped');
  expect(refused.skipReason).toBe('suppressed');

  expect(await cadenceState(tenantA, cadenceId)).toEqual({
    status: 'stopped',
    pauseReason: null,
    stopReason: 'contact_suppressed',
  });
});

/* ------------------------------------------------------------------------- *
 * Unnormalizable — recorded, never dropped, never guessed at
 * ------------------------------------------------------------------------- */

it('records an unnormalizable STOP and suppresses nothing', async () => {
  const before = await admin
    .from('suppressed_contacts')
    .select('id', { count: 'exact', head: true });
  if (before.error) throw new Error(before.error.message);

  const result = await handleInboundSms({
    from: 'SERVICEM8',
    to: INBOUND_TO,
    body: 'STOP',
    providerMessageId: 'test-threading-unnormalizable',
  });

  expect(result.kind).toBe('unnormalizable');
  inboundIds.push(result.inboundId);

  const row = await inboundRow(result.inboundId);
  // NULL rather than an empty string: a message with no matching key can never
  // be threaded, and NULL says so structurally instead of leaving a value a
  // `=` predicate would happily match against.
  expect(row.normalized_from).toBeNull();
  // And the RAW form beside it, untouched — the only thing an operator has.
  expect(row.from_address).toBe('SERVICEM8');
  expect(row.attribution).toBe('unmatched');
  expect(row.is_stop).toBe(true);
  expect(row.tenant_id).toBeNull();

  // NOT ONE SUPPRESSION ROW ANYWHERE. Suppression works by storing the exact
  // spelling dispatch probes with, and the normalizer just said there is no
  // such spelling for this sender. A row under the raw string would look like
  // compliance and match no probe ever — worse than the honest gap, because it
  // would stop anyone looking for it.
  const after = await admin
    .from('suppressed_contacts')
    .select('id', { count: 'exact', head: true });
  if (after.error) throw new Error(after.error.message);
  expect(after.count).toBe(before.count);
});

/* ------------------------------------------------------------------------- *
 * T-4-02 / T-4-08 — what the logs may say
 * ------------------------------------------------------------------------- */

it('interpolates ONLY ids and counts into its log lines', () => {
  // A platform log is readable by anyone with project access, forever, and
  // cannot be redacted per customer. `inbound.ts` handles a phone number, a
  // message body and two suppression addresses on every call, so "we were
  // careful" is not a guarantee — this is.
  //
  // The set is PINNED rather than scanned for banned words: a deny-list only
  // catches the spellings somebody thought of, and the failure mode here is a
  // future contributor adding `${input.from}` to a debug line. Every new
  // interpolation has to be typed into this list on purpose.
  const source = readFileSync('src/core/messaging/inbound.ts', 'utf8');

  const consoleCalls = [...source.matchAll(/console\.\w+\(([\s\S]*?)\n\s*\);/g)];
  expect(consoleCalls.length).toBeGreaterThan(0);

  const interpolations = new Set(
    consoleCalls.flatMap((call) =>
      [...call[1].matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()),
    ),
  );

  expect(interpolations).toEqual(
    new Set([
      'id',
      'isStop',
      'pause.kind',
      'outcome.kind',
      'candidate.cadenceId',
      'candidate.tenantId',
      'candidates.length',
      'cadencesStopped',
      'addressesSuppressed',
      'tenantsCovered.size',
      'outcome.addressesSuppressed',
      'suppression.tenantsSuppressed',
      'suppression.rowsWritten',
      "outcome.kind === 'killed' ? 'stopped' : 'already terminal'",
      // 2026-10 (Phase 13, plan 13-04): the D-10 quote-wins arm logs the lead
      // it closed and closeLead's closed-union result — an id and a kind.
      'candidate.leadId',
      'closed.kind',
    ]),
  );
});

/* ------------------------------------------------------------------------- *
 * D-13 / D-15 — the triage queue's PRIORITY, which only a database can prove
 * ------------------------------------------------------------------------- */

/**
 * Insert one inbound row directly, with the columns the classifier would have
 * written. Returns its id, registered for teardown.
 *
 * WHY `admin` AND NOT `handleInboundSms`: the rows under test are ones a MODEL
 * labelled, and the classification pass is a separate tick pass with an API key
 * behind it. Driving the whole pipeline here would make an ordering test depend
 * on Anthropic being reachable, which is the opposite of what it should depend
 * on.
 *
 * `received_at` is set EXPLICITLY and the values are chosen so that arrival
 * order and priority order DISAGREE. A fixture where the soft opt-out is also
 * the newest row would pass under the old `received_at DESC` ordering and prove
 * nothing at all — the same trap `seedOrderedPair` above documents.
 */
async function seedLabelledInbound(row: {
  attribution: string;
  label: string | null;
  labelConfidence: string | null;
  isStop: boolean;
  isHot?: boolean;
  minutesAgo: number;
}): Promise<string> {
  const { data, error } = await admin
    .from('inbound_messages')
    .insert({
      tenant_id: tenantA,
      channel: 'sms',
      from_address: TRIAGE_ORDER_MOBILE,
      normalized_from: TRIAGE_ORDER_MOBILE,
      to_address: INBOUND_TO,
      body: 'triage ordering fixture',
      attribution: row.attribution,
      is_stop: row.isStop,
      matched_cadence_count: row.attribution === 'threaded' ? 1 : 0,
      label: row.label,
      label_confidence: row.labelConfidence,
      is_hot: row.isHot ?? false,
      classified_at: row.label === null ? null : new Date().toISOString(),
      received_at: new Date(Date.now() - row.minutesAgo * 60_000).toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding inbound_messages failed: ${error.message}`);
  const id = (data as { id: string }).id;
  inboundIds.push(id);
  return id;
}

it('puts a soft opt-out above an OLDER unmatched row, and a needs-human between them (D-13, D-15)', async () => {
  // The soft opt-out is the OLDEST of the three and must still come first: a
  // reply saying "please stop texting me" that the STOP regex did not match is
  // the one row on this screen where a person has asked for something
  // irreversible and the system has deliberately not done it.
  const softOptOut = await seedLabelledInbound({
    attribution: 'threaded',
    label: 'opt_out',
    labelConfidence: 'high',
    isStop: false,
    minutesAgo: 180,
  });
  const needsHuman = await seedLabelledInbound({
    attribution: 'threaded',
    label: 'question',
    labelConfidence: 'low',
    isStop: false,
    minutesAgo: 120,
  });
  // The NEWEST row, and the one the previous ordering would have put on top.
  const unmatched = await seedLabelledInbound({
    attribution: 'unmatched',
    label: null,
    labelConfidence: null,
    isStop: false,
    minutesAgo: 60,
  });

  const queue = await listInboundNeedingTriage();
  const at = (id: string) => queue.findIndex((r) => r.id === id);

  // Every one of the three is in the queue at all — the widening's first claim.
  expect(at(softOptOut)).toBeGreaterThanOrEqual(0);
  expect(at(needsHuman)).toBeGreaterThanOrEqual(0);
  expect(at(unmatched)).toBeGreaterThanOrEqual(0);

  // RELATIVE positions, not absolute: this database is shared with production
  // rows and other suites, so an index assertion would be a test of whatever
  // else is in the table today.
  expect(at(softOptOut)).toBeLessThan(at(needsHuman));
  expect(at(needsHuman)).toBeLessThan(at(unmatched));

  // The classification columns reach the screen. Without these the page can
  // render a priority it cannot explain.
  const soft = queue[at(softOptOut)];
  expect(soft.label).toBe('opt_out');
  expect(soft.isStop).toBe(false);
  expect(queue[at(needsHuman)].labelConfidence).toBe('low');
});

it('does NOT drag every threaded reply into the queue (D-14 — a label moves nothing)', async () => {
  // A high-confidence `interested` on a threaded row is the system working:
  // placed, paused by the deterministic reply-pause, and hot for Phase 6's
  // escalation to read. Putting it in the one screen that means "a human must
  // look at this" would fill that screen with rows that do not.
  const hotButHandled = await seedLabelledInbound({
    attribution: 'threaded',
    label: 'interested',
    labelConfidence: 'high',
    isStop: false,
    isHot: true,
    minutesAgo: 5,
  });

  const queue = await listInboundNeedingTriage();

  expect(queue.some((r) => r.id === hotButHandled)).toBe(false);
});

it('keeps a hard STOP in the queue and OUT of the soft-opt-out rank', async () => {
  // A deterministic STOP was already suppressed and stopped by the webhook
  // (04-01) — it is here as compliance evidence, not as work. It must not
  // outrank a soft opt-out, which is the row nobody has acted on yet.
  const hardStop = await seedLabelledInbound({
    attribution: 'threaded',
    label: 'opt_out',
    labelConfidence: 'high',
    isStop: true,
    minutesAgo: 1,
  });
  const softOptOut = await seedLabelledInbound({
    attribution: 'threaded',
    label: 'opt_out',
    labelConfidence: 'high',
    isStop: false,
    minutesAgo: 240,
  });

  const queue = await listInboundNeedingTriage();
  const at = (id: string) => queue.findIndex((r) => r.id === id);

  expect(at(hardStop)).toBeGreaterThanOrEqual(0);
  // Four hours older and still first, because `is_stop = false` is what puts a
  // row in rank 0.
  expect(at(softOptOut)).toBeLessThan(at(hardStop));
});
