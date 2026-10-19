/**
 * ONB-03 / D-07 — the activation gate, against the hosted database.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FIRST TEST IN THIS FILE IS THE ONE THAT MATTERS MOST.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * "Every touch has an approved template" is VACUOUSLY TRUE of a tenant with no
 * touches configured — and that tenant is precisely the one nobody has onboarded
 * yet. A `hasApprovedTemplateSet` built on `every()` alone therefore returns TRUE
 * for a brand-new client, every cadence they gain is born active, and the
 * drafting pass starts working against templates nobody wrote (T-5-13).
 *
 * The completion sweep paid for this lesson once already, with an `EXISTS(touch)`
 * beside its `NOT EXISTS(live touch)`. The failure mode is identical and the
 * symptom is worse, because here the empty case is not an edge — it is the state
 * every client is in on the day they sign.
 *
 * ── AND THE SECOND-MOST IMPORTANT IS THE SCOPE OF THE RESUME ────────────────
 *
 * A template approval is a TENANT-WIDE act. At the moment it lands, the client
 * may hold cadences paused for entirely different reasons — a customer wrote
 * back, the client pulled their handbrake — and cadences that were never paused
 * at all. Asserting `pause_reason = 'onboarding'` came back active proves a
 * column changed. The block that proves the SCOPE is right also reads the
 * reply-paused cadence and its touches and requires BOTH to be untouched: an
 * implementation that resumed by status, or re-windowed by tenant, passes the
 * first assertion and fails those.
 *
 * ── ORDERED, AND ONE TENANT PER CONCERN ─────────────────────────────────────
 *
 * `vitest.config.mts` disables file parallelism and a file's tests run in order.
 * Each block below seeds its OWN tenant rather than sharing one, because the
 * whole subject is a per-tenant boolean: a stray approved template seeded by an
 * earlier block would silently open the gate for a later one, and the later
 * block would pass for a reason that has nothing to do with what it asserts.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  approveTemplateVersion,
  hasApprovedTemplateSet,
  unapprovedTouchNumbers,
} from '../src/core/drafting/onboarding-gate';
import { closeDb, forTenant } from '../src/db/repository';
import { ONBOARDING_PAUSE_REASON } from '../src/db/schema';

import {
  seedAttestation,
  seedCadence,
  seedConnection,
  seedLeadTemplates,
  seedMessageTemplate,
  seedQuotes,
  seedTenant,
  seedTouchTemplates,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const tenantIds: string[] = [];

async function newTenant(prefix: string): Promise<string> {
  const id = await seedTenant(prefix);
  tenantIds.push(id);
  return id;
}

afterAll(async () => {
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

/** The default shape: five sms touches, day 0/3/7/14/21. */
const TOUCH_NUMBERS = [1, 2, 3, 4, 5];

/* ------------------------------------------------------------------------- *
 * hasApprovedTemplateSet
 * ------------------------------------------------------------------------- */

describe('hasApprovedTemplateSet', () => {
  it('IS FALSE FOR A TENANT WITH NO SMS TIMING TEMPLATES — the vacuous-truth guard', async () => {
    // The T-5-13 case, and the reason this is the first test in the file. A
    // brand-new client has no `cadence_touch_templates` rows at all (they are
    // seeded lazily, on the first cadence). "Every one of zero touches has an
    // approved wording" is TRUE, and an implementation that reads `every()`
    // without checking for emptiness activates the client on day one.
    const tenantId = await newTenant('Onboarding Gate Empty');

    expect(await forTenant(tenantId).templates.approvedSetStatus()).toEqual([]);
    expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(false);
  });

  it('is FALSE with five timing rows and no approved wording at all', async () => {
    const tenantId = await newTenant('Onboarding Gate Unwritten');
    await seedTouchTemplates(tenantId);

    expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(false);
    expect(await unapprovedTouchNumbers(forTenant(tenantId))).toEqual(TOUCH_NUMBERS);
  });

  it('is FALSE with FOUR of five approved — the set is the unit, not the template', async () => {
    // The whole point of "set": four approved templates are not four-fifths of a
    // working client, they are a client whose fifth follow-up would have no
    // words. Partial approval must not activate anything.
    const tenantId = await newTenant('Onboarding Gate Four');
    await seedTouchTemplates(tenantId);
    for (const touchNumber of [1, 2, 3, 4]) {
      await seedMessageTemplate(tenantId, touchNumber);
    }

    expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(false);
    expect(await unapprovedTouchNumbers(forTenant(tenantId))).toEqual([5]);
  });

  it('is FALSE when the fifth version EXISTS but is unapproved — approval is the fact', async () => {
    // `approved_at IS NULL` means "not approved", never "pending" (the table
    // header). A saved-but-unattested version must count for nothing, or "save"
    // becomes the act that arms a client's messaging.
    const tenantId = await newTenant('Onboarding Gate Unattested');
    await seedTouchTemplates(tenantId);
    for (const touchNumber of [1, 2, 3, 4]) {
      await seedMessageTemplate(tenantId, touchNumber);
    }
    await seedMessageTemplate(tenantId, 5, { approved_at: null, approval_note: null });

    expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(false);
    expect(await unapprovedTouchNumbers(forTenant(tenantId))).toEqual([5]);
  });

  it('is TRUE once every sms touch has an approved wording', async () => {
    const tenantId = await newTenant('Onboarding Gate Complete');
    await seedTouchTemplates(tenantId);
    for (const touchNumber of TOUCH_NUMBERS) {
      await seedMessageTemplate(tenantId, touchNumber);
    }

    expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(true);
    expect(await unapprovedTouchNumbers(forTenant(tenantId))).toEqual([]);
  });

  it('IGNORES an email timing row (D-04) — onboarding requires the five SMS templates', async () => {
    // The vocabulary admits `email` from day one and Phase 5 drafts SMS only. An
    // email timing row must not hold a client's activation hostage to wording
    // nothing in this build will send — the client would sit paused waiting to
    // approve a template the console has no screen for.
    const tenantId = await newTenant('Onboarding Gate Email');
    await seedTouchTemplates(tenantId);
    for (const touchNumber of TOUCH_NUMBERS) {
      await seedMessageTemplate(tenantId, touchNumber);
    }
    await seedTouchTemplates(tenantId, [28], { channel: 'email', touch_number: 6 });

    expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(true);
  });

  // 2026-10 (Phase 13, 13-02, research Pitfall 2): THE VACUOUS-TRUTH TRAP THE
  // LEAD DEFAULTS WOULD OPEN. The shipped lead wording for touches 2 and 3 is
  // seeded PRE-APPROVED (the operator approves every draft, not the template).
  // Without `kind = 'quote'` in `approvedSetStatus`'s EXISTS, those two rows
  // would answer "approved" for the QUOTE cadence's touches 2 and 3, and a
  // client who never approved quote wording for them would read complete.
  it('is FALSE when only LEAD wording is approved for touches 2 and 3 — lead rows never stand in for quote ones', async () => {
    const tenantId = await newTenant('Onboarding Gate Lead Rows');
    await seedTouchTemplates(tenantId);
    for (const touchNumber of [1, 4, 5]) {
      await seedMessageTemplate(tenantId, touchNumber);
    }
    // Quote wording for 2 and 3 saved but UNAPPROVED; lead wording approved.
    for (const touchNumber of [2, 3]) {
      await seedMessageTemplate(tenantId, touchNumber, { approved_at: null, approval_note: null });
    }
    await seedLeadTemplates(tenantId);

    expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(false);
    expect(await unapprovedTouchNumbers(forTenant(tenantId))).toEqual([2, 3]);
    const status = await forTenant(tenantId).templates.approvedSetStatus();
    expect(status.filter((row) => !row.approved).map((row) => row.touchNumber)).toEqual([2, 3]);
    // The lead rows are there, approved — they are simply not quote wording.
    expect((await forTenant(tenantId).templates.latestApprovedSet('sms', 'lead')).map((t) => t.touchNumber)).toEqual([2, 3]);
  });
});

/* ------------------------------------------------------------------------- *
 * approveTemplateVersion — the attestation, and the gate it opens
 * ------------------------------------------------------------------------- */

describe('approveTemplateVersion', () => {
  it('reports not_found for a version this tenant does not have', async () => {
    const tenantId = await newTenant('Onboarding Gate Missing');

    expect(
      await approveTemplateVersion(
        tenantId,
        '00000000-0000-4000-8000-000000000000',
        'note',
        new Date(),
      ),
    ).toEqual({ kind: 'not_found' });
  });

  it('APPROVES WITHOUT RESUMING while the set is still incomplete', async () => {
    // The negative that makes the positive below mean something. An approval
    // that resumed on every call would pass the completion test too, and would
    // activate a client after their FIRST template.
    const tenantId = await newTenant('Onboarding Gate Partial');
    await seedTouchTemplates(tenantId);
    await seedConnection(tenantId);
    for (const touchNumber of [1, 2, 3]) {
      await seedMessageTemplate(tenantId, touchNumber);
    }
    const fourth = await seedMessageTemplate(tenantId, 4, {
      approved_at: null,
      approval_note: null,
    });

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'partial approval', chase_eligibility: 'eligible' },
    ]);
    const cadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      status: 'paused',
      pause_reason: ONBOARDING_PAUSE_REASON,
    });

    expect(
      await approveTemplateVersion(tenantId, fourth.id, 'looks right to me', new Date()),
    ).toEqual({
      kind: 'approved',
      setComplete: false,
      cadencesResumed: 0,
      touchesRescheduled: 0,
      rewindowDeferred: false,
      // 06-04's approved arm reports both conditions as they stood after the
      // write, so the console's refusal can name the missing one. Both honestly
      // read false here: the fifth template is still unapproved, and this
      // tenant's missing ONB-04 attestation is left missing ON PURPOSE — the
      // subject of this test is that an approval does not resume while the SET
      // is incomplete, and a tenant short of both conditions is the plainest
      // case of that.
      conditions: { templatesApproved: false, sm8AutomationAttested: false },
    });

    const [cadence] = await forTenant(tenantId).cadences.getById(cadenceId);
    expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
      status: 'paused',
      pauseReason: ONBOARDING_PAUSE_REASON,
    });
  });

  describe('the version that completes the set', () => {
    let tenantId: string;
    let fifthId: string;
    let gatedCadenceId: string;
    let replyPausedCadenceId: string;
    let replyPausedSchedule: number[];
    let alreadyActiveCadenceId: string;
    let alreadyActiveSchedule: number[];
    const approvedAt = new Date();

    it('resumes ONLY the onboarding-paused cadences, and re-windows only those', async () => {
      tenantId = await newTenant('Onboarding Gate Unlock');
      await seedTouchTemplates(tenantId);
      // A live connection with no pause, so `applyResumeRewindow` actually runs
      // rather than reporting `stillPaused` — the deferred answer would make the
      // scope assertion below vacuous.
      await seedConnection(tenantId);
      // AND THE ONB-04 HALF OF THE GATE, SATISFIED UP FRONT (06-04). Under the
      // two-condition conjunction, "the version that completes the set" can only
      // mean the fifth approval is the LAST missing condition — which requires a
      // tenant that already holds the `sm8_automation_off` attestation. Without
      // it `resumeIfOnboardingComplete` correctly refuses and this block would be
      // asserting the gate rather than the resume SCOPE that is its subject.
      //
      // The gate's own arms are proven elsewhere on purpose: the partial-set test
      // above holds both conditions false, and the deliberate absence in
      // tests/cadence-consume-events.test.ts proves an unattested tenant stays
      // shut.
      await seedAttestation(tenantId);

      for (const touchNumber of [1, 2, 3, 4]) {
        await seedMessageTemplate(tenantId, touchNumber);
      }
      fifthId = (
        await seedMessageTemplate(tenantId, 5, { approved_at: null, approval_note: null })
      ).id;

      const quotes = await seedQuotes(tenantId, [
        { job_description: 'gated by onboarding', chase_eligibility: 'eligible' },
        { job_description: 'paused by a reply', chase_eligibility: 'eligible' },
        { job_description: 'already running', chase_eligibility: 'eligible' },
      ]);

      // OVERDUE ON PURPOSE, in both cadences. A touch already sitting ahead of
      // the resume moment is left alone by D-07's clamp, so a future-dated
      // fixture would produce "nothing moved" for both cadences and the scope
      // assertion would pass without the scope existing.
      const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

      gatedCadenceId = await seedCadence(tenantId, quotes[0].id, {
        sm8_job_uuid: quotes[0].sm8_job_uuid,
        status: 'paused',
        pause_reason: ONBOARDING_PAUSE_REASON,
      });
      await seedTouches(gatedCadenceId, tenantId, [
        { scheduled_at: hoursAgo(30), original_offset_days: 0 },
        { scheduled_at: hoursAgo(29), original_offset_days: 3 },
      ]);

      replyPausedCadenceId = await seedCadence(tenantId, quotes[1].id, {
        sm8_job_uuid: quotes[1].sm8_job_uuid,
        status: 'paused',
        pause_reason: 'customer_reply',
      });
      await seedTouches(replyPausedCadenceId, tenantId, [
        { scheduled_at: hoursAgo(30), original_offset_days: 0 },
        { scheduled_at: hoursAgo(29), original_offset_days: 3 },
      ]);

      // ┌────────────────────────────────────────────────────────────────────┐
      // │ THE FIXTURE THAT MAKES THE SCOPE ASSERTION MEAN ANYTHING.          │
      // └────────────────────────────────────────────────────────────────────┘
      //
      // The reply-paused cadence above is NOT sufficient on its own:
      // `applyResumeRewindow` skips every non-active cadence anyway, so it stays
      // put whether the scope is the RETURNING ids or the whole tenant. The
      // first version of this suite asserted the scope against exactly that row
      // and passed for a reason that had nothing to do with the scope.
      //
      // THIS cadence is the discriminating one: ACTIVE, with overdue touches, and
      // NOT among the ids the resume returned. It is the real case the scope
      // exists for — event consumption keeps running while a client is
      // onboarding, so by the time the templates are approved the tenant may hold
      // cadences that were never gated. A tenant-wide re-window moves these too,
      // producing `touchesRescheduled: 4` and messaging those customers against a
      // schedule this approval had no business rewriting.
      alreadyActiveCadenceId = await seedCadence(tenantId, quotes[2].id, {
        sm8_job_uuid: quotes[2].sm8_job_uuid,
        status: 'active',
      });
      await seedTouches(alreadyActiveCadenceId, tenantId, [
        { scheduled_at: hoursAgo(30), original_offset_days: 0 },
        { scheduled_at: hoursAgo(29), original_offset_days: 3 },
      ]);

      const repo = forTenant(tenantId);
      replyPausedSchedule = (await repo.touches.listForCadence(replyPausedCadenceId)).map(
        (touch) => touch.scheduledAt.getTime(),
      );
      alreadyActiveSchedule = (
        await repo.touches.listForCadence(alreadyActiveCadenceId)
      ).map((touch) => touch.scheduledAt.getTime());

      expect(await hasApprovedTemplateSet(repo)).toBe(false);

      const result = await approveTemplateVersion(
        tenantId,
        fifthId,
        'Client signed off on all five over the phone, 2pm.',
        approvedAt,
      );

      expect(result).toEqual({
        kind: 'approved',
        setComplete: true,
        cadencesResumed: 1,
        touchesRescheduled: 2,
        rewindowDeferred: false,
        // Both TRUE, which is what makes this the version that completes the
        // set: the attestation was seeded above and this call approved the last
        // template. `setComplete` is the conjunction; this is the record of
        // which two facts produced it (06-04).
        conditions: { templatesApproved: true, sm8AutomationAttested: true },
      });

      // The gate opened for the cadence it was holding …
      const [gated] = await repo.cadences.getById(gatedCadenceId);
      expect({ status: gated.status, pauseReason: gated.pauseReason }).toEqual({
        status: 'active',
        pauseReason: null,
      });
      // `>=`, NOT `>` — the same call tests/cadence-resume.test.ts:152-161 makes
      // (commit d4661cf, 03-06), for the same reason. "Never in the past" is what
      // D-07 promises and what `>=` states.
      //
      // `approvedAt` goes in as `now` and becomes `resumeAt` in
      // `computeResumeSchedule` (src/core/cadence/resume.ts:132). Inside Perth
      // contact hours on a contact day, `nextAllowedSlot` branch 1
      // (src/core/cadence/window.ts:390-397) answers `from + jitter`, and the
      // production draw `randomJitterMinutes()` (src/core/cadence/jitter.ts:35-37)
      // is `floor(random * (JITTER_MAX_MINUTES + 1))` — inclusive of ZERO on
      // purpose. One run in eleven therefore places touch 1 exactly ON
      // `approvedAt`. That equality is the 03-05 design — "may we send now" is
      // answered by whether the next allowed slot from now IS now — not a bug,
      // which is why nothing under src/ changed for it.
      //
      // CI run 33825524839 (commit 890160d, a docs-only change) failed right here
      // with `expected 1788485276468 to be greater than 1788485276468`, at
      // 2026-09-04 09:27:56 AWST, a Friday inside hours. The strict `>` failed on
      // the draw, not on the behaviour.
      //
      // A FAKE CLOCK WAS THE WRONG REPAIR. `approveTemplateVersion` ->
      // `finishResume` -> `applyResumeRewindow(tenantId, now, { onlyCadenceIds })`
      // (src/core/drafting/onboarding-gate.ts:311-313) passes no `jitterMinutes`,
      // so the draw cannot be pinned from this test; pinning the clock OUTSIDE
      // contact hours would route the placement through branches 2/3 — a roll to
      // the next day's preferred slot, a different path from the one this block
      // exercises — and adding a test-only jitter seam to a production signature
      // for the sake of one assertion is the wrong trade.
      //
      // `>=` STILL PROVES THE RE-WINDOW HAPPENED: both touches were seeded 30 and
      // 29 hours BEFORE `approvedAt` (`hoursAgo` above) and the result literal
      // pins `touchesRescheduled: 2`, so any instant `>= approvedAt` is roughly
      // thirty hours later than what was seeded. Only touch 1 can ever equal
      // `approvedAt`; touch 2 is chained from it by a 3-day delta
      // (src/core/cadence/resume.ts:159), so the loop still covers both.
      for (const touch of await repo.touches.listForCadence(gatedCadenceId)) {
        expect(touch.scheduledAt.getTime()).toBeGreaterThanOrEqual(approvedAt.getTime());
      }

      // … AND NOT FOR THE ONE IT WAS NOT. A resume guarded on status alone, or a
      // re-window scoped to the tenant, passes everything above and fails here.
      const [reply] = await repo.cadences.getById(replyPausedCadenceId);
      expect({ status: reply.status, pauseReason: reply.pauseReason }).toEqual({
        status: 'paused',
        pauseReason: 'customer_reply',
      });
      expect(
        (await repo.touches.listForCadence(replyPausedCadenceId)).map((touch) =>
          touch.scheduledAt.getTime(),
        ),
        'the reply-paused cadence was re-windowed — the scope is not the RETURNING ids',
      ).toEqual(replyPausedSchedule);

      // AND THE ACTIVE CADENCE THIS APPROVAL NEVER TOUCHED. Its touches are just
      // as overdue as the gated one's, and a tenant-wide re-window would have
      // moved them. Both its status and its schedule must be exactly as seeded.
      const [running] = await repo.cadences.getById(alreadyActiveCadenceId);
      expect(running.status).toBe('active');
      expect(
        (await repo.touches.listForCadence(alreadyActiveCadenceId)).map((touch) =>
          touch.scheduledAt.getTime(),
        ),
        'an active cadence outside the resume was re-windowed — the scope is the tenant, ' +
          'not the ids the resume write RETURNED',
      ).toEqual(alreadyActiveSchedule);
    });

    it('flipped hasApprovedTemplateSet to true', async () => {
      // DEPENDS ON THE BLOCK ABOVE. Asked through the same function the consumer
      // asks, rather than by re-reading the column, because the consumer's answer
      // is the thing that changes what happens to the next quote.
      expect(await hasApprovedTemplateSet(forTenant(tenantId))).toBe(true);
    });

    it('REFUSES A SECOND APPROVAL AND LEAVES THE ATTESTATION BYTE-UNCHANGED (D-06)', async () => {
      // An attestation that can be overwritten is not evidence of anything: the
      // version somebody approved and the version recorded as approved could then
      // differ with no trace. DEPENDS ON THE BLOCK ABOVE.
      //
      // "ATTESTATION" HERE MEANS THE APPROVAL RECORD — the approver's note and
      // instant on the template version. Not the ONB-04 `sm8_automation_off`
      // row this block now seeds, which is the gate's other condition and a
      // different thing entirely. Both are append-only evidence for the same
      // reason, which is why they ended up sharing a word.
      const repo = forTenant(tenantId);
      const before = (await repo.templates.listVersions(5, 'sms')).find(
        (row) => row.id === fifthId,
      );
      expect(before?.approvedAt).not.toBeNull();

      const second = await approveTemplateVersion(
        tenantId,
        fifthId,
        'a different note, written later',
        new Date(),
      );

      expect(second).toEqual({
        kind: 'already_approved',
        approvedAt: before?.approvedAt,
        approvalNote: before?.approvalNote,
      });

      const after = (await repo.templates.listVersions(5, 'sms')).find(
        (row) => row.id === fifthId,
      );
      expect(after?.approvedAt?.getTime()).toBe(before?.approvedAt?.getTime());
      expect(after?.approvalNote).toBe(before?.approvalNote);
      expect(after?.body).toBe(before?.body);
    });
  });
});

/* ------------------------------------------------------------------------- *
 * insertVersion — append-only, and the version number is the database's answer
 * ------------------------------------------------------------------------- */

describe('templates.insertVersion', () => {
  it('starts at 1 and appends, per (touch, channel), UNAPPROVED every time', async () => {
    const tenantId = await newTenant('Onboarding Gate Versions');
    const repo = forTenant(tenantId);

    const [first] = await repo.templates.insertVersion({
      touchNumber: 1,
      channel: 'sms',
      body: 'First wording.',
    });
    const [second] = await repo.templates.insertVersion({
      touchNumber: 1,
      channel: 'sms',
      body: 'Second wording.',
    });
    // A DIFFERENT TOUCH RESTARTS AT 1: the version counter is per
    // (tenant, touch, channel), which is the identity `touch_drafts` records.
    const [otherTouch] = await repo.templates.insertVersion({
      touchNumber: 2,
      channel: 'sms',
      body: 'Touch two, first wording.',
    });

    expect([first.version, second.version, otherTouch.version]).toEqual([1, 2, 1]);

    // SAVING IS NOT ATTESTING. If this ever came back non-null, "save" would be
    // the act that arms a client's messaging.
    expect([first.approvedAt, second.approvedAt, otherTouch.approvedAt]).toEqual([
      null,
      null,
      null,
    ]);

    // And an unapproved version changes nothing about what drafting reads.
    expect(await repo.templates.latestApproved(1, 'sms')).toEqual([]);
    expect(await hasApprovedTemplateSet(repo)).toBe(false);
  });

  it('approving version 1 leaves version 2 unapproved and drafting reading version 1', async () => {
    // The editing story the append-only table exists for: an operator rewords
    // touch 1, and nothing about what customers receive changes until somebody
    // attests to the new wording.
    const tenantId = await newTenant('Onboarding Gate Editing');
    const repo = forTenant(tenantId);

    const [v1] = await repo.templates.insertVersion({
      touchNumber: 1,
      channel: 'sms',
      body: 'Approved wording.',
    });
    await repo.templates.insertVersion({
      touchNumber: 1,
      channel: 'sms',
      body: 'A draft rewrite nobody has blessed.',
    });

    expect(
      (await approveTemplateVersion(tenantId, v1.id, 'signed off', new Date())).kind,
    ).toBe('approved');

    const [latest] = await repo.templates.latestApproved(1, 'sms');
    expect(latest.version).toBe(1);
    expect(latest.body).toBe('Approved wording.');
  });
});
