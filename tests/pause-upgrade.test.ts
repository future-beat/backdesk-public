/**
 * D-05's last open hole, closed at the database: the PAUSE UPGRADE.
 *
 * ── WHAT WAS BROKEN, AND WHY IT WAS NOT VISIBLE ─────────────────────────────
 *
 * The matrix has always prescribed `paused(client_paused)` + `customer_reply` →
 * `paused(customer_reply)` (transitions.ts note 3). Until this plan no
 * repository method could WRITE it: `pauseWhereActive` pauses only from
 * `active`, deliberately, so that re-pausing can never downgrade a reply pause.
 * So `pauseForReply` returned a named gap (`upgrade_unsupported`) and left the
 * row alone.
 *
 * The consequence is one sentence long and it is the reason this suite exists:
 *
 *   A client who had paused their own messaging, whose customer then wrote
 *   back, could tap "resume messaging" and the machine would re-enter a live
 *   conversation — because the pause still said `client_paused`, and a client
 *   resume is allowed to lift that one.
 *
 * That is D-05 breached from the direction nobody watches. Every unit test of
 * the matrix passed the whole time, because the matrix was right; what was
 * missing was a write.
 *
 * ── SO THE CENTRAL ASSERTION IS NOT THE UPGRADE, IT IS THE RESUME AFTER IT ──
 *
 * Asserting `pause_reason = 'customer_reply'` proves a column changed. The
 * block that proves the HOLE is closed drives the real client resume path
 * (`resumeClient`, the same function the console's client-level un-pause calls)
 * across the upgraded cadence and requires it to stay paused. An implementation
 * that wrote the reason into some other column, or that upgraded a copy, would
 * pass the first assertion and fail that one.
 *
 * ── THE GUARD IS ASSERTED AT THE REPOSITORY, NOT ONLY THROUGH THE CONTROL ───
 *
 * `upgradePauseReason` is a guard-as-WHERE write in the house style
 * (`pauseWhereActive`, `resumeWherePaused`): the WHERE clause is the guard and
 * `RETURNING id` is the proof. A guard that only exists because the caller
 * checked first is not a guard, so the last block calls it directly at an
 * `active` and a `stopped` cadence and requires ZERO rows back.
 *
 * ── ORDERED, AND THAT IS LOAD-BEARING ───────────────────────────────────────
 *
 * `vitest.config.mts` disables file parallelism and a file's tests run in
 * order. Fixtures are seeded INSIDE the blocks that need them rather than in
 * `beforeAll`, for the reason `tests/cadence-controls.test.ts` states: a stray
 * `client_paused` cadence sitting in the tenant would be swept up by the
 * `resumeClient` block, whose whole point is which cadences it does and does
 * not move.
 */
import { afterAll, expect, it } from 'vitest';

import {
  pauseClient,
  pauseForReply,
  resumeCadence,
  resumeClient,
} from '../src/core/cadence/controls';
import { closeDb, forTenant } from '../src/db/repository';
import { CADENCE_PAUSE_REASONS, ONBOARDING_PAUSE_REASON } from '../src/db/schema';

import {
  seedCadence,
  seedCadenceSettings,
  seedQuotes,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

/**
 * THE TWO REASONS, READ FROM THE SCHEMA VOCABULARY RATHER THAN TYPED TWICE.
 *
 * The upgrade introduces no new member — that is what makes this plan
 * migration-free — so the value the write lands must be the same constant the
 * column is CHECK-constrained against. Destructuring pins the order, and the
 * assertion below is what makes the destructure safe to read: if a member is
 * ever inserted at the front, this file fails here rather than silently
 * asserting the wrong reason everywhere.
 */
const [REPLY_REASON, CLIENT_REASON] = CADENCE_PAUSE_REASONS;

it('reads its two pause reasons from the schema vocabulary', () => {
  // 05-01 appended a THIRD member, `onboarding` (D-07), so this can no longer
  // be a whole-array equality. The guard the comment above describes is about
  // POSITION — a member inserted at the FRONT would silently repoint
  // `REPLY_REASON` at the wrong string — so that is what is asserted now:
  // the first two slots by index, which is exactly what the destructure reads.
  // A whole-array equality would have failed on an append that changes nothing
  // about this file's correctness, and the fix for that failure is the one
  // that quietly deletes the real guard.
  expect(CADENCE_PAUSE_REASONS[0]).toBe('customer_reply');
  expect(CADENCE_PAUSE_REASONS[1]).toBe('client_paused');
  expect(REPLY_REASON).toBe('customer_reply');
  expect(CLIENT_REASON).toBe('client_paused');

  // The third member, whose behavioural arms 05-03 added below.
  expect([...CADENCE_PAUSE_REASONS]).toContain('onboarding');
  expect(ONBOARDING_PAUSE_REASON).toBe('onboarding');
});

let tenantId: string;

/** One quote + one cadence in the requested state, returning the cadence id. */
async function seedCadenceIn(
  description: string,
  overrides: Record<string, unknown>,
): Promise<string> {
  tenantId ??= await seedTenant('Pause Upgrade');

  const [quote] = await seedQuotes(tenantId, [
    { job_description: `pause-upgrade: ${description}`, chase_eligibility: 'eligible' },
  ]);

  return seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_mobile: '+61400778899',
    ...overrides,
  });
}

async function readCadence(
  cadenceId: string,
): Promise<{ status: string; pauseReason: string | null }> {
  const [cadence] = await forTenant(tenantId).cadences.getById(cadenceId);
  return { status: cadence.status, pauseReason: cadence.pauseReason };
}

afterAll(async () => {
  if (tenantId) await teardownTenants([tenantId]);
  await closeDb();
});

/* ------------------------------------------------------------------------- *
 * The upgrade, and the resume it exists to defeat
 * ------------------------------------------------------------------------- */

/** Shared by the two blocks below: the upgrade, then the resume that must fail. */
let upgradedCadenceId: string;

it('upgrades a client pause to a customer-reply pause', async () => {
  upgradedCadenceId = await seedCadenceIn('the upgrade target', {
    status: 'paused',
    pause_reason: CLIENT_REASON,
  });

  expect(await pauseForReply(tenantId, upgradedCadenceId)).toEqual({ kind: 'upgraded' });

  // STILL PAUSED — the upgrade changes the REASON, never the status. A cadence
  // that became active here would start sending at somebody who just wrote back.
  expect(await readCadence(upgradedCadenceId)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });
});

it('THE D-05 ASSERTION: a client resume does NOT revive the upgraded cadence', async () => {
  // The real client-level un-pause, not a hand-written UPDATE — `resumeClient`
  // is what the console calls, and `resumeWherePaused`'s reason-matched WHERE
  // clause is the thing under test. DEPENDS ON THE BLOCK ABOVE.
  await seedCadenceSettings(tenantId, { paused_at: new Date().toISOString() });

  const result = await resumeClient(tenantId, new Date());

  expect(result.kind).toBe('resumed');
  if (result.kind !== 'resumed') throw new Error('unreachable');
  // Nothing to resume: the only paused cadence in this tenant now carries the
  // reason a client resume may not lift.
  expect(result.cadencesResumed).toBe(0);

  // THE WHOLE POINT OF THE PLAN, IN ONE ASSERTION. Before the upgrade write
  // existed this row still said `client_paused` and this resume revived it.
  expect(await readCadence(upgradedCadenceId)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });
});

/* ------------------------------------------------------------------------- *
 * The unregressed paths
 * ------------------------------------------------------------------------- */

it('still pauses an ACTIVE cadence for a reply, and repeats idempotently', async () => {
  const activeId = await seedCadenceIn('the active target', { status: 'active' });

  expect(await pauseForReply(tenantId, activeId)).toEqual({ kind: 'paused' });
  expect(await readCadence(activeId)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });

  // A SECOND REPLY IS `paused`, NOT `not_active`. The two answers are different
  // facts for the caller: this cadence IS standing down for a conversation,
  // which is the state a reply asks for — whereas `not_active` means there is
  // nothing to stand down. `handleInboundSms` records the kind, and an operator
  // reading "not_active" against a cadence that is visibly paused-for-reply
  // would be reading a lie about which of the two happened.
  expect(await pauseForReply(tenantId, activeId)).toEqual({ kind: 'paused' });
  expect(await readCadence(activeId)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });
});

it('upgrades a REASONLESS pause too — the row the schema permits and no writer makes', async () => {
  // transitions.ts note 6: `paused` with a NULL reason is a state the schema
  // allows, no writer in this codebase produces, and the matrix answers anyway
  // — `customer_reply` "should record the reason it now knows". A guard that
  // could only express `WHERE pause_reason = $from` would silently skip it, so
  // the guard takes a nullable `from` and this block is why.
  const reasonlessId = await seedCadenceIn('the reasonless pause', {
    status: 'paused',
    pause_reason: null,
  });

  expect(await pauseForReply(tenantId, reasonlessId)).toEqual({ kind: 'upgraded' });
  expect(await readCadence(reasonlessId)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });
});

it('refuses a reply pause at every terminal status', async () => {
  for (const status of ['stopped', 'completed', 'expired'] as const) {
    const terminalId = await seedCadenceIn(`terminal ${status}`, {
      status,
      stop_reason: status === 'stopped' ? 'operator_closed' : null,
    });

    expect(await pauseForReply(tenantId, terminalId)).toEqual({
      kind: 'not_active',
      status,
    });
    expect((await readCadence(terminalId)).pauseReason).toBeNull();
  }
});

it('reports no_cadence for a cadence this tenant does not have', async () => {
  expect(
    await pauseForReply(tenantId, '00000000-0000-4000-8000-000000000000'),
  ).toEqual({ kind: 'no_cadence' });
});

/* ------------------------------------------------------------------------- *
 * The guard, at the repository, where it actually lives
 * ------------------------------------------------------------------------- */

it('changes ZERO rows when the cadence is not paused for the expected reason', async () => {
  const repo = forTenant(tenantId);

  const activeId = await seedCadenceIn('guard: active', { status: 'active' });
  const stoppedId = await seedCadenceIn('guard: stopped', {
    status: 'stopped',
    stop_reason: 'operator_closed',
  });
  const replyPausedId = await seedCadenceIn('guard: already reply-paused', {
    status: 'paused',
    pause_reason: REPLY_REASON,
  });

  // An ACTIVE cadence has no pause to upgrade. Without `status = 'paused'` in
  // the WHERE clause this write would silently pause a live cadence.
  expect(
    await repo.cadences.upgradePauseReason([activeId], {
      from: CLIENT_REASON,
      to: REPLY_REASON,
    }),
  ).toEqual([]);
  expect(await readCadence(activeId)).toEqual({ status: 'active', pauseReason: null });

  // A TERMINAL cadence must never be revived, nor quietly re-labelled.
  expect(
    await repo.cadences.upgradePauseReason([stoppedId], {
      from: CLIENT_REASON,
      to: REPLY_REASON,
    }),
  ).toEqual([]);
  expect(await readCadence(stoppedId)).toEqual({ status: 'stopped', pauseReason: null });

  // AND THE REASON PREDICATE IS REAL: a cadence already paused for a reply is
  // not matched by `from: client_paused`. This is the assertion that stops the
  // guard from being reduced to `status = 'paused'` alone — which is the shape
  // that would let a future caller DOWNGRADE a reply pause.
  expect(
    await repo.cadences.upgradePauseReason([replyPausedId], {
      from: CLIENT_REASON,
      to: REPLY_REASON,
    }),
  ).toEqual([]);
  expect(await readCadence(replyPausedId)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });

  // An empty id list is a no-op round-trip-free, like every sibling write.
  expect(
    await repo.cadences.upgradePauseReason([], { from: CLIENT_REASON, to: REPLY_REASON }),
  ).toEqual([]);
});

it('returns the rows it actually upgraded, and only those', async () => {
  const repo = forTenant(tenantId);

  const clientPausedId = await seedCadenceIn('guard: upgradable', {
    status: 'paused',
    pause_reason: CLIENT_REASON,
  });
  const untouchedId = await seedCadenceIn('guard: untouched active', { status: 'active' });

  const upgraded = await repo.cadences.upgradePauseReason(
    [clientPausedId, untouchedId],
    { from: CLIENT_REASON, to: REPLY_REASON },
  );

  // RETURNING drives what happens next, so the set must be exact: one row moved.
  expect(upgraded.map((row) => row.id)).toEqual([clientPausedId]);
  expect(await readCadence(untouchedId)).toEqual({ status: 'active', pauseReason: null });
});

/* ------------------------------------------------------------------------- *
 * 05-03: the THIRD pause, and the order it sits at the bottom of
 *
 * `onboarding` (D-07/ONB-03) is the weakest reason, because its unlock is the
 * broadest AUTOMATIC one: approving a tenant's template set resumes every
 * onboarding-paused cadence they have, in one write, with nobody looking at any
 * individual conversation. The two stickier reasons each carry a specific human
 * signal about a specific cadence, so both must survive that approval — which is
 * what the two upgrades below buy, one per signal.
 * ------------------------------------------------------------------------- */

/**
 * Shared by the three operator-resume blocks: an onboarding pause nobody lifts.
 *
 * SEEDED INSIDE THE FIRST OF THEM, NOT UP HERE AND NOT IN A `beforeAll`, for the
 * reason this file's header gives and which this fixture demonstrated the hard
 * way: `pauseClient` in the block above upgrades EVERY onboarding-paused cadence
 * in the tenant, so a fixture seeded before it arrives at the operator-resume
 * test reading `client_paused` — and `resumeCadence` lifts that one, exactly as
 * it should. The first version of this suite asserted the gate against a row the
 * gate no longer applied to, and failed loudly. Ordered, and load-bearing.
 */
let onboardingPausedCadenceId: string;

it('upgrades an ONBOARDING pause to a customer-reply pause', async () => {
  // WHAT THIS BUYS: without it, the row still reads `onboarding` when the
  // operator approves the client's fifth template — and that approval resumes
  // every onboarding-paused cadence at once, restarting this one at somebody who
  // is mid-conversation with the tradie. Identical breach to the client-resume
  // one this file opens with; different door.
  const replyDuringOnboarding = await seedCadenceIn('reply during onboarding', {
    status: 'paused',
    pause_reason: ONBOARDING_PAUSE_REASON,
  });

  expect(await pauseForReply(tenantId, replyDuringOnboarding)).toEqual({ kind: 'upgraded' });
  expect(await readCadence(replyDuringOnboarding)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });
});

it('upgrades an ONBOARDING pause to a client pause, through pauseClient', async () => {
  // The other signal: the client pulled their own handbrake while still being
  // onboarded. Leaving the row at `onboarding` would let the template approval
  // release it — the client's cadences running again, released by paperwork they
  // never saw. `pauseWhereActive` alone cannot do this write; it pauses only
  // from `active`, which is the guard that stops it downgrading a reply pause.
  const onboardingThenClientPause = await seedCadenceIn('client pause during onboarding', {
    status: 'paused',
    pause_reason: ONBOARDING_PAUSE_REASON,
  });

  const result = await pauseClient(tenantId, new Date());
  expect(result.kind).toBe('paused');

  expect(await readCadence(onboardingThenClientPause)).toEqual({
    status: 'paused',
    pauseReason: CLIENT_REASON,
  });

  // AND THE REPLY PAUSE FROM THE BLOCK ABOVE IS UNTOUCHED. A client pause never
  // downgrades a reply pause — that is the guard `pauseWhereActive` has always
  // held, and widening this path to reach `onboarding` must not have widened it
  // to reach that too.
  expect(await readCadence(upgradedCadenceId)).toEqual({
    status: 'paused',
    pauseReason: REPLY_REASON,
  });
});

it('cannot be asked to write ONBOARDING as an upgrade target — it does not compile', async () => {
  const repo = forTenant(tenantId);

  // A REPLY-PAUSED row, deliberately: the downgrade this test exists to forbid
  // is `customer_reply` → `onboarding`, which would hand a live conversation to
  // the next bulk template approval.
  const replyPaused = await seedCadenceIn('downgrade target', {
    status: 'paused',
    pause_reason: REPLY_REASON,
  });

  // THE ASSERTION IS THE `@ts-expect-error`, checked by `npx tsc --noEmit` (the
  // test files are inside tsconfig's include). `upgradePauseReason`'s `to` takes
  // `UpgradablePauseReason`, which excludes `onboarding` — so the downgrade is
  // not a rule anybody has to remember. If the exclusion is ever removed, this
  // line stops erroring and tsc fails on the unused directive.
  const rows = await repo.cadences.upgradePauseReason([replyPaused], {
    from: REPLY_REASON,
    // @ts-expect-error — `onboarding` is not an UpgradablePauseReason (note 7)
    to: ONBOARDING_PAUSE_REASON,
  });

  // The runtime half is deliberately WEAK and says so: with the directive above
  // deleted this write WOULD land, because the column's CHECK admits the value.
  // Types are the whole guard here, which is why the compile-time assertion is
  // the one that matters — but the row is read back anyway, so a future edit
  // that keeps the directive while breaking the guard is still caught.
  expect(rows.map((row) => row.id)).toEqual([replyPaused]);
  expect((await readCadence(replyPaused)).pauseReason).toBe(ONBOARDING_PAUSE_REASON);
});

/* ------------------------------------------------------------------------- *
 * The operator resume, and the one pause it cannot lift (ONB-03 / T-5-10)
 * ------------------------------------------------------------------------- */

it('AN OPERATOR RESUME CANNOT LIFT AN ONBOARDING PAUSE — approval is the only unlock', async () => {
  onboardingPausedCadenceId = await seedCadenceIn('the gate that holds', {
    status: 'paused',
    pause_reason: ONBOARDING_PAUSE_REASON,
  });

  // Every other paused row in this codebase yields to `resumeCadence`: that is
  // D-05's whole shape, a human overruling a machine's caution. This one does
  // not, because it is not caution — it is the absence of client-approved words.
  // Resuming would produce a cadence the console calls "running" whose every
  // touch parks unsent in `needs_draft`, which is worse than a visible pause.
  //
  // DEPENDS ON THE `pauseClient` BLOCK ABOVE for its fixture.
  //
  // 06-04: the refusal now carries the CONDITIONS, so the console can name the
  // one that is actually missing rather than blaming templates for everything
  // (T-5-10). This tenant has neither, which is what a client mid-onboarding
  // looks like.
  expect(await resumeCadence(tenantId, onboardingPausedCadenceId, new Date())).toEqual({
    kind: 'onboarding_gated',
    conditions: { templatesApproved: false, sm8AutomationAttested: false },
  });

  // The row did not move — not the status, not the reason.
  expect(await readCadence(onboardingPausedCadenceId)).toEqual({
    status: 'paused',
    pauseReason: ONBOARDING_PAUSE_REASON,
  });
});

it('the repository guard refuses it too, called directly — not only through the control', async () => {
  // A guard that only exists because the caller checked first is not a guard
  // (this file's opening argument, applied to the new predicate). `resumeCadence`
  // refuses at the matrix before it ever reaches the write, so the write's own
  // `IS DISTINCT FROM 'onboarding'` is unexercised by the block above.
  const repo = forTenant(tenantId);

  expect(await repo.cadences.operatorResumeWherePaused([onboardingPausedCadenceId])).toEqual(
    [],
  );
  expect(await readCadence(onboardingPausedCadenceId)).toEqual({
    status: 'paused',
    pauseReason: ONBOARDING_PAUSE_REASON,
  });
});

it('AND STILL RESUMES A PAUSED ROW WITH NO REASON — the note-6 row stays reachable', async () => {
  // THE REGRESSION THE NEW PREDICATE COULD HAVE CAUSED, asserted rather than
  // reasoned about. `pause_reason <> 'onboarding'` evaluates to NULL for a null
  // column and matches nothing, so the obvious spelling would have quietly taken
  // the one row this method exists to reach out of scope — leaving a paused
  // cadence that nothing on earth can resume. `IS DISTINCT FROM` is what keeps
  // it in, and this is the test that says so.
  const reasonlessPaused = await seedCadenceIn('note-6 row, operator resume', {
    status: 'paused',
    pause_reason: null,
  });

  const result = await resumeCadence(tenantId, reasonlessPaused, new Date());
  expect(result.kind).toBe('resumed');

  expect(await readCadence(reasonlessPaused)).toEqual({
    status: 'active',
    pauseReason: null,
  });
});
