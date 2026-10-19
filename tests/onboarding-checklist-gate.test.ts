/**
 * ONB-04 / D-14 — the TWO-CONDITION activation gate, against the hosted database.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS SUITE EXTENDS `onboarding-gate.test.ts`, IT DOES NOT REPLACE IT.    │
 * │ That file still owns the template half; this one owns the COMPOSITION —  │
 * │ the second condition, and the three call sites that must all ask ONE     │
 * │ predicate about both.                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE TEST THAT MATTERS MOST IS THE DEPLOY-ORDERING ONE ───────────────────
 *
 * A client onboarded BEFORE Phase 6 has approved templates and no attestation.
 * They are the exact client ONB-04 was added for, and they are also the one a
 * half-composed gate silently exempts: if creation still asks only about
 * templates while the resume paths ask about both, their new cadences are born
 * ACTIVE and start sending beside ServiceM8's own follow-up, while the console
 * insists the gate is on. The gate must engage for them at CREATION, which is
 * the question `createCadenceForQuoteOpened` asks — not merely at resume.
 *
 * ── AND THE VACUOUS-TRUTH GUARD, ONE CONDITION OVER ─────────────────────────
 *
 * `hasSm8AutomationAttestation` on a tenant with ZERO attestation rows must be
 * FALSE. "No evidence" and "evidence that it is fine" are different claims and
 * only a gate that says so keeps a brand-new client from activating on day one.
 * That is the T-5-13 lesson `hasApprovedTemplateSet` paid for; this asserts the
 * same decision was made again rather than inherited.
 *
 * ── ORDERED, AND ONE TENANT PER CONCERN ─────────────────────────────────────
 *
 * `vitest.config.mts` disables file parallelism and a file's tests run in order.
 * Each block seeds its OWN tenant, because the whole subject is a pair of
 * per-tenant booleans: a stray attestation seeded by an earlier block would
 * open half the gate for a later one, and that block would pass for a reason
 * unrelated to what it asserts.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  buildStaleAttestationSection,
  runStalledDigest,
} from '../src/core/aging/stalled-digest';
import { consumeQuoteEvents } from '../src/core/cadence/consume-events';
import { resumeCadence } from '../src/core/cadence/controls';
import {
  approveTemplateVersion,
  attestSm8AutomationOff,
  hasApprovedTemplateSet,
  hasSm8AutomationAttestation,
  onboardingComplete,
  readOnboardingConditions,
  SM8_AUTOMATION_ATTESTATION_KIND,
} from '../src/core/drafting/onboarding-gate';
import {
  ATTESTATION_STALE_DAYS,
  attestationAgeDays,
  CHECKLIST_ITEM_KEYS,
  isAttestationStale,
  readGoLiveChecklist,
} from '../src/core/onboarding/checklist';
import { markChaseEligible } from '../src/core/sync/eligibility';
import {
  closeDb,
  forAllTenants_latestAttestations,
  forTenant,
} from '../src/db/repository';
import { ONBOARDING_PAUSE_REASON } from '../src/db/schema';

import {
  seedAttestation,
  seedCadence,
  seedCadenceSettings,
  seedConnection,
  seedMessageTemplate,
  seedQuoteContacts,
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

const TOUCH_NUMBERS = [1, 2, 3, 4, 5];

/** The full template half: five sms timing rows, five approved wordings. */
async function approveEveryTemplate(tenantId: string): Promise<void> {
  await seedTouchTemplates(tenantId);
  for (const touchNumber of TOUCH_NUMBERS) {
    await seedMessageTemplate(tenantId, touchNumber);
  }
}

/* ------------------------------------------------------------------------- *
 * hasSm8AutomationAttestation — the vacuous-truth guard, one condition over
 * ------------------------------------------------------------------------- */

describe('hasSm8AutomationAttestation', () => {
  it('IS FALSE FOR A TENANT WITH ZERO ATTESTATION ROWS — named on purpose', async () => {
    // The T-5-13 direction restated. There is nothing clever to get wrong here
    // and that is exactly why it is asserted: the day somebody rewrites this as
    // `rows.every(...)` or `!rows.some(r => r.revoked)`, an empty table starts
    // reading TRUE and every brand-new client activates on day one.
    const tenantId = await newTenant('Checklist Gate Unattested');

    expect(await forTenant(tenantId).attestations.latest(SM8_AUTOMATION_ATTESTATION_KIND))
      .toEqual([]);
    expect(await hasSm8AutomationAttestation(forTenant(tenantId))).toBe(false);
  });

  it('is TRUE once one attestation exists, whatever the templates say', async () => {
    const tenantId = await newTenant('Checklist Gate Attested');
    const repo = forTenant(tenantId);

    await repo.attestations.append({
      kind: SM8_AUTOMATION_ATTESTATION_KIND,
      note: 'Opened Settings → Automation with Dave on the phone; Quote Follow Up is off.',
    });

    expect(await hasSm8AutomationAttestation(repo)).toBe(true);
    // The conditions are INDEPENDENT: this tenant has no templates at all, and
    // the composed answer must still be false.
    expect(await readOnboardingConditions(repo)).toEqual({
      templatesApproved: false,
      sm8AutomationAttested: true,
    });
    expect(onboardingComplete(await readOnboardingConditions(repo))).toBe(false);
  });

  it('APPENDS rather than updates — the second attestation leaves the first byte-unchanged', async () => {
    // The staleness policy (D-15) reads "the latest row", which only means
    // something if the earlier rows survive. An updatable row would erase
    // exactly the trail the nag is computed from.
    const tenantId = await newTenant('Checklist Gate Append');
    const repo = forTenant(tenantId);

    const [first] = await repo.attestations.append({
      kind: SM8_AUTOMATION_ATTESTATION_KIND,
      note: 'first look, 2pm',
    });
    const [second] = await repo.attestations.append({
      kind: SM8_AUTOMATION_ATTESTATION_KIND,
      note: 'checked again a month later',
    });

    expect(second.id).not.toBe(first.id);

    // LATEST WINS on the append-only rows.
    const [latest] = await repo.attestations.latest(SM8_AUTOMATION_ATTESTATION_KIND);
    expect(latest.id).toBe(second.id);
    expect(latest.note).toBe('checked again a month later');

    // …and the first row is still exactly as written. Read through a fresh
    // scope so this is a database fact, not an object we happen to be holding.
    const rows = await forTenant(tenantId).attestations.latest(
      SM8_AUTOMATION_ATTESTATION_KIND,
    );
    expect(rows).toHaveLength(1);
    expect(first.note).toBe('first look, 2pm');
    expect(first.attestedAt.getTime()).toBeLessThanOrEqual(second.attestedAt.getTime());
  });

  it('the repository namespace exposes APPEND AND LATEST AND NOTHING ELSE', async () => {
    // A SURFACE assertion, not a behaviour one. The append-only rule is enforced
    // by the absence of a method: nothing that compiles can update or delete an
    // attestation row (T-6-12). A guard that only exists because callers are
    // polite is not a guard.
    const tenantId = await newTenant('Checklist Gate Surface');
    const namespace = forTenant(tenantId).attestations as Record<string, unknown>;

    expect(Object.keys(namespace).sort()).toEqual(['append', 'latest']);
    for (const forbidden of ['update', 'delete', 'remove', 'revoke', 'upsert', 'set']) {
      expect(namespace[forbidden]).toBeUndefined();
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The composed gate at CREATION — the Pitfall 6 deploy-ordering case
 * ------------------------------------------------------------------------- */

describe('the pre-Phase-6 client: templates approved, no attestation', () => {
  let tenantId: string;
  let gatedCadenceId: string;

  it('BIRTHS ITS CADENCES PAUSED(onboarding) — creation asks the composed predicate', async () => {
    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ THE TEST THIS PLAN EXISTS FOR. A gate composed only on the resume    │
    // │ paths never engages for this client: their cadences are born ACTIVE  │
    // │ and never need resuming, so the refusal that names the missing       │
    // │ attestation is never reached and they send beside ServiceM8's own    │
    // │ follow-up — the exact ONB-04 harm — while the console says the gate  │
    // │ is on.                                                               │
    // └──────────────────────────────────────────────────────────────────────┘
    tenantId = await newTenant('Checklist Gate Pre Phase 6');
    await approveEveryTemplate(tenantId);
    await seedConnection(tenantId);

    const repo = forTenant(tenantId);
    expect(await hasApprovedTemplateSet(repo)).toBe(true);
    expect(await hasSm8AutomationAttestation(repo)).toBe(false);

    // Driven through the PRODUCTION emit path (`markChaseEligible` → the
    // outbox → `consumeQuoteEvents`), because the question this test asks is
    // about `createCadenceForQuoteOpened`'s born-paused decision and a
    // hand-inserted event would still exercise it while a hand-inserted CADENCE
    // would not exercise it at all.
    const [quote] = await seedQuotes(tenantId, [
      {
        job_description: 'a quote that arrived after the upgrade',
        chase_eligibility: 'needs_review',
      },
    ]);
    await seedQuoteContacts(tenantId, [
      { sm8_job_uuid: quote.sm8_job_uuid, first: 'Gated', last: 'Customer' },
    ]);

    expect(await markChaseEligible(tenantId, [quote.id])).toEqual({
      flipped: 1,
      eventsEmitted: 1,
    });

    await consumeQuoteEvents({ jitterMinutes: () => 0 });

    const [cadence] = await repo.cadences.getByQuoteId(quote.id);
    expect(cadence, 'no cadence was created at all — the fixture, not the gate, is wrong')
      .toBeDefined();
    gatedCadenceId = cadence.id;

    expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
      status: 'paused',
      pauseReason: ONBOARDING_PAUSE_REASON,
    });

    // FULLY MATERIALIZED, not refused (D-07). The operator must be able to see
    // exactly what is waiting, not merely that something is.
    expect((await repo.touches.listForCadence(gatedCadenceId)).length).toBeGreaterThan(0);
  });

  it('and resumeCadence REFUSES, naming the ATTESTATION rather than the templates', async () => {
    // DEPENDS ON THE BLOCK ABOVE. A refusal that blamed templates here would
    // send the operator to a screen where everything is already green (T-5-10),
    // and they would conclude the button is broken.
    expect(await resumeCadence(tenantId, gatedCadenceId, new Date())).toEqual({
      kind: 'onboarding_gated',
      conditions: { templatesApproved: true, sm8AutomationAttested: false },
    });

    const [cadence] = await forTenant(tenantId).cadences.getById(gatedCadenceId);
    expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
      status: 'paused',
      pauseReason: ONBOARDING_PAUSE_REASON,
    });
  });

  it('ATTESTING resumes it, and re-windows only the RETURNING ids', async () => {
    // DEPENDS ON THE TWO BLOCKS ABOVE. The attestation is the LAST missing
    // condition for this client, so this is the write that opens the gate —
    // through the same one predicate the template approval reaches.
    const repo = forTenant(tenantId);

    // An ACTIVE cadence with overdue touches, OUTSIDE the resume. This is the
    // fixture that makes the scope assertion mean anything: a tenant-wide
    // re-window moves these too and messages those customers days early.
    const [other] = await seedQuotes(tenantId, [
      { job_description: 'already running', chase_eligibility: 'eligible' },
    ]);
    const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
    const activeCadenceId = await seedCadence(tenantId, other.id, {
      sm8_job_uuid: other.sm8_job_uuid,
      status: 'active',
    });
    await seedTouches(activeCadenceId, tenantId, [
      { scheduled_at: hoursAgo(30), original_offset_days: 0 },
      { scheduled_at: hoursAgo(29), original_offset_days: 3 },
    ]);
    const activeSchedule = (await repo.touches.listForCadence(activeCadenceId)).map(
      (touch) => touch.scheduledAt.getTime(),
    );

    // Drag the gated cadence's touches into the past too, so the re-window has
    // something to move. A future-dated fixture reports "nothing moved" and the
    // count assertion below would pass without the re-window running.
    for (const touch of await repo.touches.listForCadence(gatedCadenceId)) {
      await repo.touches.reschedule(touch.id, new Date(Date.now() - 30 * 3_600_000));
    }

    const attestedNow = new Date();
    const result = await attestSm8AutomationOff(
      tenantId,
      'Opened their ServiceM8 → Settings → Automation on a screen share; Quote Follow Up is off.',
      attestedNow,
    );

    expect(result.kind).toBe('attested');
    expect(result.conditions).toEqual({
      templatesApproved: true,
      sm8AutomationAttested: true,
    });
    expect(result.cadencesResumed).toBe(1);
    expect(result.touchesRescheduled).toBeGreaterThan(0);
    expect(result.rewindowDeferred).toBe(false);

    // The gate opened for the cadence it was holding …
    const [gated] = await repo.cadences.getById(gatedCadenceId);
    expect({ status: gated.status, pauseReason: gated.pauseReason }).toEqual({
      status: 'active',
      pauseReason: null,
    });

    // … AND THE ACTIVE CADENCE OUTSIDE THE RESUME IS UNTOUCHED. A re-window
    // scoped to the tenant rather than to the RETURNING ids fails exactly here.
    expect(
      (await repo.touches.listForCadence(activeCadenceId)).map((touch) =>
        touch.scheduledAt.getTime(),
      ),
      'an active cadence outside the resume was re-windowed — the scope is the tenant, ' +
        'not the ids the resume write RETURNED',
    ).toEqual(activeSchedule);
  });

  it('the attestation timestamp is the DATABASE\'s, not the caller\'s', async () => {
    // DEPENDS ON THE BLOCK ABOVE. `attested_at` is `defaultNow()` and is not a
    // parameter of `append`, because an attestation whose moment a caller could
    // choose is a date somebody could type — and the whole value of the row is
    // that the moment is ours. Passing an obviously-wrong `now` proves the
    // column ignored it.
    const stale = new Date('2001-01-01T00:00:00Z');
    const result = await attestSm8AutomationOff(tenantId, 're-checked today', stale);

    expect(result.attestedAt.getTime()).toBeGreaterThan(stale.getTime());
    expect(Math.abs(result.attestedAt.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

/* ------------------------------------------------------------------------- *
 * The mirror image: attested first, templates last
 * ------------------------------------------------------------------------- */

describe('the attestation-first client: attested, templates unapproved', () => {
  let tenantId: string;
  let gatedCadenceId: string;

  it('is STILL GATED, and the refusal names the TEMPLATES', async () => {
    tenantId = await newTenant('Checklist Gate Attestation First');
    await seedConnection(tenantId);
    await seedTouchTemplates(tenantId);
    for (const touchNumber of [1, 2, 3, 4]) {
      await seedMessageTemplate(tenantId, touchNumber);
    }

    const repo = forTenant(tenantId);
    await repo.attestations.append({
      kind: SM8_AUTOMATION_ATTESTATION_KIND,
      note: 'Confirmed off before we wrote any wording.',
    });

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'gated on words', chase_eligibility: 'eligible' },
    ]);
    gatedCadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      status: 'paused',
      pause_reason: ONBOARDING_PAUSE_REASON,
    });
    await seedTouches(gatedCadenceId, tenantId, [
      { scheduled_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), original_offset_days: 0 },
    ]);

    expect(await resumeCadence(tenantId, gatedCadenceId, new Date())).toEqual({
      kind: 'onboarding_gated',
      conditions: { templatesApproved: false, sm8AutomationAttested: true },
    });
  });

  it('APPROVING THE LAST TEMPLATE resumes it — both writers converge on one predicate', async () => {
    // DEPENDS ON THE BLOCK ABOVE. This is the other half of D-14: the SAME
    // resume happens whichever of the two conditions was satisfied last, because
    // both writers call `resumeIfOnboardingComplete` rather than each deciding.
    const repo = forTenant(tenantId);
    const [fifth] = await repo.templates.insertVersion({
      touchNumber: 5,
      channel: 'sms',
      body: 'Just checking in on that quote.',
    });

    const result = await approveTemplateVersion(
      tenantId,
      fifth.id,
      'Client signed off on the fifth over the phone.',
      new Date(),
    );

    expect(result.kind).toBe('approved');
    if (result.kind !== 'approved') throw new Error('unreachable');
    expect(result.setComplete).toBe(true);
    expect(result.conditions).toEqual({
      templatesApproved: true,
      sm8AutomationAttested: true,
    });
    expect(result.cadencesResumed).toBe(1);

    const [cadence] = await repo.cadences.getById(gatedCadenceId);
    expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
      status: 'active',
      pauseReason: null,
    });
  });
});

/* ------------------------------------------------------------------------- *
 * The negative that makes all of the above mean something
 * ------------------------------------------------------------------------- */

describe('one condition is not enough, from either side', () => {
  it('an ATTESTATION on a template-less client resumes NOTHING, and that is a success', async () => {
    // `attestSm8AutomationOff` has no failure arm. The operator did exactly
    // what was asked and the OTHER condition is still open — reporting that as
    // an error would teach them the attest form is broken.
    const tenantId = await newTenant('Checklist Gate Attest Only');
    await seedConnection(tenantId);

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'no words yet', chase_eligibility: 'eligible' },
    ]);
    const cadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      status: 'paused',
      pause_reason: ONBOARDING_PAUSE_REASON,
    });

    const result = await attestSm8AutomationOff(tenantId, 'Verified off.', new Date());

    expect(result.kind).toBe('attested');
    expect(result.cadencesResumed).toBe(0);
    expect(result.touchesRescheduled).toBe(0);
    expect(result.conditions).toEqual({
      templatesApproved: false,
      sm8AutomationAttested: true,
    });

    const [cadence] = await forTenant(tenantId).cadences.getById(cadenceId);
    expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
      status: 'paused',
      pauseReason: ONBOARDING_PAUSE_REASON,
    });
  });

  it('COMPLETING THE TEMPLATE SET on an unattested client resumes NOTHING', async () => {
    // The pre-06-04 behaviour, now correctly refused. Before this plan, the
    // fifth approval here opened the gate on its own.
    const tenantId = await newTenant('Checklist Gate Templates Only');
    await seedConnection(tenantId);
    await seedTouchTemplates(tenantId);
    for (const touchNumber of [1, 2, 3, 4]) {
      await seedMessageTemplate(tenantId, touchNumber);
    }

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'words but no attestation', chase_eligibility: 'eligible' },
    ]);
    const cadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      status: 'paused',
      pause_reason: ONBOARDING_PAUSE_REASON,
    });

    const repo = forTenant(tenantId);
    const [fifth] = await repo.templates.insertVersion({
      touchNumber: 5,
      channel: 'sms',
      body: 'Last nudge on that quote.',
    });

    const result = await approveTemplateVersion(tenantId, fifth.id, 'signed off', new Date());

    expect(result.kind).toBe('approved');
    if (result.kind !== 'approved') throw new Error('unreachable');
    // The TEMPLATE set IS complete — `setComplete` is deliberately not widened
    // to mean "this client can send", so the drafting page's partial-progress
    // sentence keeps telling the truth about templates.
    expect(result.setComplete).toBe(true);
    expect(result.conditions).toEqual({
      templatesApproved: true,
      sm8AutomationAttested: false,
    });
    expect(result.cadencesResumed).toBe(0);

    const [cadence] = await forTenant(tenantId).cadences.getById(cadenceId);
    expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
      status: 'paused',
      pauseReason: ONBOARDING_PAUSE_REASON,
    });
  });
});

/* ------------------------------------------------------------------------- *
 * The conjunction is written ONCE — a source assertion (D-14)
 * ------------------------------------------------------------------------- */

describe('one predicate, three call sites', () => {
  it('the two-condition conjunction appears exactly once in src', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');

    /** Every `.ts`/`.tsx` under `src`, path-joined with `/` on every platform. */
    function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return walk(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
      });
    }

    const files = walk('src');
    const hits: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      // Any expression ANDing the two condition names together, in either
      // order, with or without a receiver (`conditions.` / `c?.` / bare).
      // `onboardingComplete` is the one place that may do it.
      const RECEIVER = String.raw`(?:[\w$]+\??\.)?`;
      if (
        new RegExp(`templatesApproved\\s*&&\\s*${RECEIVER}sm8AutomationAttested`).test(source) ||
        new RegExp(`sm8AutomationAttested\\s*&&\\s*${RECEIVER}templatesApproved`).test(source)
      ) {
        hits.push(file);
      }
    }

    expect(
      hits,
      'the activation conjunction is written in more than one place — two readings of ' +
        'one rule agree until somebody widens the wrong one (CR-01)',
    ).toEqual(['src/core/drafting/onboarding-gate.ts']);
  });

  it('consume-events reaches the composed predicate, not the template half alone', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/cadence/consume-events.ts', 'utf8');

    expect(source).toMatch(/readOnboardingConditions/);
    expect(source).toMatch(/onboardingComplete\(/);
    // The born-paused branch must not be keyed on the template half. A
    // `hasApprovedTemplateSet` call surviving here IS the Pitfall 6 defect.
    expect(
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
    ).not.toMatch(/hasApprovedTemplateSet\s*\(/);
  });
});

/* ------------------------------------------------------------------------- *
 * The staleness derivation — PURE, and the boundary is the whole of it (D-15)
 * ------------------------------------------------------------------------- */

describe('isAttestationStale', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const daysBefore = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it('is FALSE at 29 days and TRUE at exactly 30 — the boundary, pinned', () => {
    // INCLUSIVE at the threshold, decided once (see ATTESTATION_STALE_DAYS).
    // Pinned as a named test because "roughly a month" is the kind of rule that
    // silently becomes `> 30` in a refactor and then never fires on the day it
    // was written for.
    expect(isAttestationStale(daysBefore(29), now)).toBe(false);
    expect(isAttestationStale(daysBefore(30), now)).toBe(true);
    expect(isAttestationStale(daysBefore(31), now)).toBe(true);

    expect(attestationAgeDays(daysBefore(30), now)).toBe(30);
    expect(ATTESTATION_STALE_DAYS).toBe(30);
  });

  it('NO ATTESTATION IS NOT STALE — it is unmet, which is a different sentence', () => {
    // A re-attest nag beside a client who has never attested is nonsense: there
    // is nothing to re-do. `hasSm8AutomationAttestation` answers that case, and
    // the gate holds.
    expect(isAttestationStale(null, now)).toBe(false);
    expect(attestationAgeDays(null, now)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- *
 * The seventeen checklist readers (D-16, extended by ARM-01, CAP-05 and TXT-05)
 * ------------------------------------------------------------------------- */

/**
 * THE ONE THIRD-PARTY CALL ON THE CHECKLIST PATH, STUBBED.
 *
 * `sendingDomainVerified` asks Resend whether a from-address's domain is
 * verified. A DB-backed suite that reached the provider would fail for reasons
 * that have nothing to do with the tenant it seeded — a revoked key, an outage,
 * a rate limit — so the reader takes the predicate as an injected dependency and
 * every call here passes this. `unverified` rather than `verified`, because the
 * honest answer for a fictional tenant's fictional domain is "no".
 */
const NO_RESEND = {
  isSendingDomainVerified: async () => ({ kind: 'unverified' as const, domain: 'example.test' }),
};

/** The items by key — the shape every assertion below reads. */
function by0(checklist: Awaited<ReturnType<typeof readGoLiveChecklist>>) {
  return new Map(checklist.items.map((item) => [item.key, item]));
}

describe('readGoLiveChecklist', () => {
  // 2026-10-06 (12-08, TXT-05): thirteen → seventeen, deliberately — the four
  // text-back rows append after the divert rows.
  it('renders SEVENTEEN items in the fixed order, all unmet for a bare tenant', async () => {
    const tenantId = await newTenant('Checklist Readers Bare');
    const checklist = await readGoLiveChecklist(tenantId, new Date(), NO_RESEND);

    // THE LITERAL LIST, not a re-spelling of the export: an accidental reorder
    // in the core would still satisfy `toEqual([...CHECKLIST_ITEM_KEYS])`, and
    // the order is load-bearing twice over — the card renders it and
    // `firstUnmetGate` walks it to decide which missing thing a refusal names.
    expect(checklist.items.map((item) => item.key)).toEqual([
      'sm8Connected',
      'contactHours',
      'voiceProfile',
      'templatesApproved',
      'sm8AutomationOff',
      'escalationPhone',
      'sendingDomainVerified',
      'smsArmed',
      'emailArmed',
      // THE TWO PROOF ROWS COME LAST because they depend on the two above them:
      // a live proof is produced BY the product, so it cannot exist until the
      // channel is armed (D-01).
      'escalationHandsetProof',
      'emailPipeProof',
      // THE TWO DIVERT ROWS (Phase 11, CAP-05) come after the proofs and gate
      // text_back only (12-08, D-09).
      'divertNumber',
      'divertVerified',
      // THE FOUR TEXT-BACK ROWS (12-08, TXT-05) come last.
      'textBackTemplates',
      'neverTextOwnNumber',
      'textBackArmed',
      'textBackProof',
    ]);
    expect(checklist.items.map((item) => item.key)).toEqual([...CHECKLIST_ITEM_KEYS]);
    expect(checklist.items).toHaveLength(17);

    // A bare tenant: none of the four text-back rows is met, and no text-back
    // row exists to read as armed.
    for (const key of [
      'textBackTemplates',
      'neverTextOwnNumber',
      'textBackArmed',
      'textBackProof',
    ] as const) {
      expect(by0(checklist).get(key)?.satisfied, key).toBe(false);
    }

    // A BRAND-NEW CLIENT: no messaging_config rows of their own, no attestation.
    expect(by0(checklist).get('escalationPhone')?.satisfied).toBe(false);
    expect(by0(checklist).get('sendingDomainVerified')?.satisfied).toBe(false);
    expect(by0(checklist).get('emailArmed')?.satisfied).toBe(false);
    expect(by0(checklist).get('emailArmed')?.detail).toBeNull();
    // `smsArmed` reads the EFFECTIVE row, so it answers for the shared row this
    // client rides by default — armed or not, it is their answer too.
    expect(checklist.arming.sms.tenantRow).toBeNull();

    const by = new Map(checklist.items.map((item) => [item.key, item]));
    expect(by.get('sm8Connected')?.satisfied).toBe(false);
    expect(by.get('voiceProfile')?.satisfied).toBe(false);
    expect(by.get('templatesApproved')?.satisfied).toBe(false);
    expect(by.get('sm8AutomationOff')?.satisfied).toBe(false);

    // `create_tenant()` requires the window, so this one is satisfied from the
    // first minute — and its DETAIL is the fact, not the boolean. A window an
    // operator believes is 8–5 and is really 8–5 in the wrong zone reads as a
    // green tick forever; the row says the zone out loud.
    expect(by.get('contactHours')?.satisfied).toBe(true);
    expect(by.get('contactHours')?.detail).toContain('08:00–17:00');
    expect(by.get('contactHours')?.detail).toContain('(Australia/Perth)');

    expect(checklist.attestation).toEqual({
      attestedAt: null,
      note: null,
      isStale: false,
      ageDays: null,
    });
  });

  it('sm8Connected is FALSE for a PAUSED connection — present is not the same as live', async () => {
    // A dead ServiceM8 key (Phase 2 D-08) means the mirror is stale, so nothing
    // this client's cadences believe about a quote can be trusted. A tick here
    // would render green directly under the auth-failed banner.
    const tenantId = await newTenant('Checklist Readers Paused');
    await seedConnection(tenantId);

    expect(
      (await readGoLiveChecklist(tenantId, new Date(), NO_RESEND)).items.find(
        (item) => item.key === 'sm8Connected',
      )?.satisfied,
    ).toBe(true);

    await forTenant(tenantId).connection.update({
      pausedAt: new Date(),
      statusReason: 'auth_failed',
    });

    const item = (await readGoLiveChecklist(tenantId, new Date(), NO_RESEND)).items.find(
      (row) => row.key === 'sm8Connected',
    );
    expect(item?.satisfied).toBe(false);
  });

  it('voiceProfile is TRUE on ANY one voice column — a register is not six fields', async () => {
    const tenantId = await newTenant('Checklist Readers Voice');
    await seedCadenceSettings(tenantId);

    expect(
      (await readGoLiveChecklist(tenantId, new Date(), NO_RESEND)).items.find(
        (item) => item.key === 'voiceProfile',
      )?.satisfied,
      'a settings row with every voice column null read as configured',
    ).toBe(false);

    // ONE field set, the other five explicitly null — which is the shape the
    // patch type requires and the case this row exists to describe: a client
    // whose whole register is a sign-off is configured.
    await forTenant(tenantId).settings.updateVoiceProfile({
      greetingStyle: null,
      signOff: 'Cheers, Dave',
      formality: null,
      bannedPhrases: null,
      exampleMessages: null,
      voiceNotes: null,
    });

    expect(
      (await readGoLiveChecklist(tenantId, new Date(), NO_RESEND)).items.find(
        (item) => item.key === 'voiceProfile',
      )?.satisfied,
    ).toBe(true);
  });

  it('templatesApproved agrees with the GATE on every state it can be in', async () => {
    // The one-derivation rule as an assertion: whatever the gate says, the row
    // says. A checklist that re-derived this from `message_templates` reads TRUE
    // for the empty tenant below — vacuously — and the operator sees a green
    // tick beside a client whose cadences are all born paused (T-5-13).
    const tenantId = await newTenant('Checklist Readers Templates');
    const repo = forTenant(tenantId);

    const agrees = async () => {
      const [checklist, gate] = await Promise.all([
        readGoLiveChecklist(tenantId, new Date(), NO_RESEND),
        hasApprovedTemplateSet(repo),
      ]);
      const row = checklist.items.find((item) => item.key === 'templatesApproved');
      expect(row?.satisfied, 'the checklist row and the gate disagree').toBe(gate);
      return gate;
    };

    expect(await agrees()).toBe(false); // no cadence shape at all
    await seedTouchTemplates(tenantId);
    expect(await agrees()).toBe(false); // shape, no wording
    for (const touchNumber of [1, 2, 3, 4]) {
      await seedMessageTemplate(tenantId, touchNumber);
    }
    expect(await agrees()).toBe(false); // four of five
    await seedMessageTemplate(tenantId, 5);
    expect(await agrees()).toBe(true);
  });

  it('the attested row is SATISFIED-BUT-STALE at 30 days — never unmet (D-15)', async () => {
    // The distinction the whole of D-15 rests on. A stale attestation still
    // satisfies the condition and the gate stays OPEN; the badge asks a human to
    // look again. Reading staleness as unmet would re-gate a healthy client on a
    // calendar, which is the pause this plan is forbidden to build.
    const tenantId = await newTenant('Checklist Readers Stale');
    const now = new Date();
    await seedAttestation(tenantId, {
      note: 'Checked with Dave on the phone.',
      attested_at: new Date(now.getTime() - 34 * 86_400_000).toISOString(),
    });

    const checklist = await readGoLiveChecklist(tenantId, now, NO_RESEND);
    const row = checklist.items.find((item) => item.key === 'sm8AutomationOff');

    expect(row?.satisfied, 'a stale attestation was read as UNMET — that re-gates a client')
      .toBe(true);
    expect(checklist.attestation.isStale).toBe(true);
    expect(checklist.attestation.ageDays).toBe(34);
    expect(checklist.attestation.note).toBe('Checked with Dave on the phone.');

    // And the gate agrees: staleness does not falsify the condition.
    expect(await hasSm8AutomationAttestation(forTenant(tenantId))).toBe(true);
  });

  it('LATEST WINS on the append-only rows — a fresh re-attestation clears the nag', async () => {
    const tenantId = await newTenant('Checklist Readers Reattested');
    const now = new Date();
    await seedAttestation(tenantId, {
      note: 'the old look',
      attested_at: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
    });

    expect((await readGoLiveChecklist(tenantId, now, NO_RESEND)).attestation.isStale).toBe(true);

    await forTenant(tenantId).attestations.append({
      kind: SM8_AUTOMATION_ATTESTATION_KIND,
      note: 'looked again today',
    });

    const after = await readGoLiveChecklist(tenantId, now, NO_RESEND);
    expect(after.attestation.isStale).toBe(false);
    expect(after.attestation.note).toBe('looked again today');
  });

  it('the readers import the GATE and the PER-TENANT resolver, never the wrong sibling', async () => {
    // SOURCE assertions, because both of these are correct-looking mistakes that
    // no behavioural test on a fresh tenant would catch:
    //
    //  • a `message_templates` query here is vacuously TRUE for the empty
    //    tenant (T-5-13) and green for exactly the client who cannot send;
    //  • `anyChannelEnabled` answers the DEPLOYMENT question, so a client whose
    //    own override row is `enabled = false` reads armed while every send of
    //    theirs is refused (04-08 CR-01).
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/onboarding/checklist.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).toMatch(/hasApprovedTemplateSet/);
    expect(source).not.toMatch(/messageTemplates|message_templates/);

    expect(source).toMatch(/resolveSmsFrom/);
    expect(source).toMatch(/resolveEmailIdentity/);
    expect(source).not.toMatch(/anyChannelEnabled/);
  });
});

/* ------------------------------------------------------------------------- *
 * The digest staleness nag — and the pause it must never write (D-15, T-6-14)
 * ------------------------------------------------------------------------- */

describe('the daily digest staleness section', () => {
  it('lists ONLY stale clients, and NOTHING is paused by the run', async () => {
    const now = new Date();
    const staleId = await newTenant('Checklist Digest Stale');
    const freshId = await newTenant('Checklist Digest Fresh');

    await seedAttestation(staleId, {
      attested_at: new Date(now.getTime() - 45 * 86_400_000).toISOString(),
    });
    await seedAttestation(freshId, {
      attested_at: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
    });

    // A LIVE CADENCE on the stale client, so the prohibition has something to be
    // about. An assertion that nothing was paused is worthless if there was
    // nothing pausable in the first place.
    const staleRepo = forTenant(staleId);
    await seedConnection(staleId);
    const [quote] = await seedQuotes(staleId, [
      { job_description: 'still chasing', chase_eligibility: 'eligible' },
    ]);
    const cadenceId = await seedCadence(staleId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      status: 'active',
    });
    await seedTouches(cadenceId, staleId, [
      { scheduled_at: new Date(now.getTime() + 86_400_000).toISOString(), original_offset_days: 3 },
    ]);
    const before = await staleRepo.cadences.getById(cadenceId);

    const latest = await forAllTenants_latestAttestations(SM8_AUTOMATION_ATTESTATION_KIND);
    const staleNames = latest.map((row) => row.tenantName);
    expect(staleNames).toContain((await staleRepo.tenant.get())[0].name);

    const section = buildStaleAttestationSection(latest, now);
    expect(section, 'no section was built for a 45-day-old attestation').not.toBeNull();

    const freshName = (await forTenant(freshId).tenant.get())[0].name;
    const staleName = (await staleRepo.tenant.get())[0].name;

    const body = section!.lines.join('\n');
    expect(body).toContain(
      `${staleName}: ServiceM8 auto-follow-up attestation is 45 days old — re-verify and record it.`,
    );
    expect(body, 'a two-day-old attestation was nagged about').not.toContain(freshName);

    // ── THE PROHIBITION (D-15 / T-6-14) ────────────────────────────────────
    //
    // Run the WHOLE digest — the production orchestration, with the real
    // staleness read and a sender that records instead of mailing — and prove
    // the cadence is byte-identical afterwards. A pause written anywhere on the
    // staleness path fails here.
    const sent: Array<{ subject: string; body: string }> = [];
    const result = await runStalledDigest({
      now,
      send: async (message) => {
        sent.push(message);
        return { ok: true as const, id: null };
      },
    });

    expect(result.digestSent + result.digestSkippedEmpty).toBe(1);
    expect(result.digestFailed).toBe(0);
    // Something WAS said, because a stale attestation is something to say even
    // on a morning when the approval queue happens to be clear.
    expect(result.digestSkippedEmpty).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('ServiceM8 automation checks due:');
    expect(sent[0].body).toContain(staleName);

    const after = await staleRepo.cadences.getById(cadenceId);
    expect(
      {
        status: after[0].status,
        pauseReason: after[0].pauseReason,
        stopReason: after[0].stopReason,
      },
      'the staleness path changed a cadence — staleness NAGS, it never pauses (D-15)',
    ).toEqual({
      status: before[0].status,
      pauseReason: before[0].pauseReason,
      stopReason: before[0].stopReason,
    });

    // The touches did not move either: a re-window is a schedule write, and the
    // digest has no business having one.
    expect((await staleRepo.touches.listForCadence(cadenceId)).length).toBe(1);
  });

  it('the digest module contains NO write of any kind on the staleness path', async () => {
    // A structural backstop for the assertion above: the behavioural test can
    // only prove that today's code path wrote nothing to THIS cadence.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/aging/stalled-digest.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const forbidden of [
      'pauseWhereActive',
      'stopWhereLive',
      'resumeWherePaused',
      'skipWhere',
      'reschedule',
      'update(',
    ]) {
      expect(source, `the digest reached for \`${forbidden}\` — it must only READ`).not.toContain(
        forbidden,
      );
    }
  });
});
