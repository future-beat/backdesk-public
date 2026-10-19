/**
 * ONE TEXT PER HOT REPLY, PROVEN AT THE DATABASE (CON-03, D-05/D-08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The property is not "the pass sends one SMS". It is that a SECOND pass    │
 * │ over the same hot reply claims NOTHING — because the guarantee lives in   │
 * │ `escalations_inbound_message_uniq` and `ON CONFLICT DO NOTHING            │
 * │ RETURNING`, not in caller discipline. A unit test with a mocked           │
 * │ repository would assert the caller's good behaviour, which is the         │
 * │ guarantee 02-04 learned not to accept: "a caller-dependent guarantee is   │
 * │ not a guarantee".                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── NOTHING IS EVER SENT TO ANYBODY ────────────────────────────────────────
 *
 * The sender is INJECTED and fake, and `runCadenceTick` defaults its escalation
 * seam to `undefined` (which means the pass does not even scan), so the real
 * ClickSend path is unreachable from this file by construction rather than by an
 * env check. The fake counts its invocations, and "zero HTTP calls while
 * disarmed" is asserted on that counter — the `reconcile.ts` property, one
 * module over.
 *
 * Every phone number here is from the `0491 570 1xx` block ACMA reserves for
 * fiction, tradie and customer alike.
 *
 * ── IT RUNS AGAINST THE HOSTED, SHARED DATABASE ────────────────────────────
 *
 * `forAllTenants_hotUnescalated` is cross-tenant BY DESIGN, so every assertion
 * here is written as a RELATIVE claim (my inbound row, my escalation row) or as
 * a global invariant — never an absolute count.
 *
 * It also means a run of this file will CLAIM AND RECORD any other hot,
 * threaded, unescalated reply present at the time. Stated rather than
 * discovered: on the CI stack — a database created and destroyed with the job,
 * where the only clients are the ones the suites seeded — those rows are this
 * file's own. On the hosted database they would be REAL CLIENTS' replies, and
 * once the founding client is armed (Phase 10) claiming one would text a real
 * tradie about a real customer, from this suite, at whatever hour it ran. That
 * is the sharpest edge of D-11: THIS FILE MUST NEVER RUN THROUGH
 * `npm run test:remote`. The one enabled row it writes is TENANT-SCOPED to a
 * throwaway tenant it seeded seconds earlier and is deleted by id in `afterAll`,
 * following exactly the four bounds `tests/routing-dispatch.test.ts` sets out
 * for the same manoeuvre.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCadenceTick } from '../src/core/cadence/run-tick';
import {
  escalateHotLeads,
  buildEscalationSender,
  type EscalationSmsSender,
} from '../src/core/escalation/escalate-hot-leads';
import { ESCALATION_COOLDOWN_MINUTES } from '../src/core/escalation/message';
import { applyDeliveryReceipt } from '../src/core/messaging/receipts';
import type { SendSmsInput } from '../src/core/messaging/clicksend-client';
import { resolveSmsFrom } from '../src/core/messaging/routing-sender';
import {
  claimEscalation,
  closeDb,
  forAllTenants_hotUnescalated,
  upsertChannelConfig,
} from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedMessagingConfigOverride,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const PASS_SOURCE = readFileSync('src/core/escalation/escalate-hot-leads.ts', 'utf8');

/**
 * The pass with its prose stripped — comments name the things these assertions
 * forbid (that is what makes them readable), so an assertion over the raw file
 * would fail on its own explanation.
 */
const PASS_CODE = PASS_SOURCE.split('\n')
  .filter((line) => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
  })
  .join('\n');
const PRIVILEGE_SUITE = readFileSync('tests/classification-privilege.test.ts', 'utf8');

/** ACMA's fiction block, both ends of the conversation. */
const TRADIE_PHONE_LOCAL = '0491570156';
const TRADIE_PHONE_E164 = '+61491570156';
const CUSTOMER_MOBILE = '+61491570157';
/** The dedicated virtual number an armed deployment would send FROM. */
const FROM_NUMBER = '+61491570158';

const tenantIds: string[] = [];
/** Every inbound row this suite wrote — deleted BY ID, see `afterAll`. */
const inboundIds: string[] = [];
/** Every `messaging_config` row this suite wrote. No FK to tenants; by id. */
const configIds: string[] = [];

interface FakeSender {
  send: EscalationSmsSender;
  calls: SendSmsInput[];
}

/** A sender that records what it was asked to send and never leaves the process. */
function fakeSender(
  reply: (input: SendSmsInput) => Awaited<ReturnType<EscalationSmsSender>> = () => ({
    ok: true,
    messageId: 'CS-FAKE-1',
    status: 'SUCCESS',
  }),
): FakeSender {
  const calls: SendSmsInput[] = [];
  return {
    calls,
    send: async (input) => {
      calls.push(input);
      return reply(input);
    },
  };
}

async function newTenant(prefix: string, escalationPhone: string | null): Promise<string> {
  const id = await seedTenant(prefix);
  tenantIds.push(id);
  await seedConnection(id);

  if (escalationPhone !== null) {
    const { error } = await admin
      .from('tenants')
      .update({ escalation_phone: escalationPhone })
      .eq('id', id);
    if (error) throw new Error(`Setting escalation_phone failed: ${error.message}`);
  }

  return id;
}

/** One quote and one live cadence carrying the customer snapshot. */
async function newCadence(
  tenantId: string,
  description: string,
): Promise<{ cadenceId: string; quoteId: string }> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: description, chase_eligibility: 'eligible' },
  ]);
  const cadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Sarah Jones',
    contact_mobile: CUSTOMER_MOBILE,
  });
  return { cadenceId, quoteId: quote.id };
}

/**
 * A threaded inbound reply that classification has already marked HOT.
 *
 * Written directly rather than through `classifyInbound`: this suite is about
 * what happens to a hot row, and routing it through a real model call would make
 * it a test of Anthropic's availability.
 */
async function seedHotReply(
  tenantId: string,
  cadenceId: string,
  body: string,
  receivedAt: Date = new Date(),
): Promise<string> {
  const { data, error } = await admin
    .from('inbound_messages')
    .insert({
      tenant_id: tenantId,
      cadence_id: cadenceId,
      channel: 'sms',
      provider_message_id: `seed-${Math.random().toString(36).slice(2)}`,
      from_address: CUSTOMER_MOBILE,
      normalized_from: CUSTOMER_MOBILE,
      to_address: FROM_NUMBER,
      body,
      attribution: 'threaded',
      matched_cadence_count: 1,
      is_stop: false,
      received_at: receivedAt.toISOString(),
      label: 'interested',
      label_confidence: 'high',
      is_hot: true,
      classified_at: receivedAt.toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a hot inbound reply failed: ${error.message}`);
  const id = (data as { id: string }).id;
  inboundIds.push(id);
  return id;
}

/** The escalation row for one inbound id, read with the admin client. */
async function escalationFor(inboundMessageId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('escalations')
    .select('*')
    .eq('inbound_message_id', inboundMessageId)
    .maybeSingle();
  if (error) throw new Error(`Reading escalations failed: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

/* -------------------------------------------------------------------------- *
 * Fixtures
 * -------------------------------------------------------------------------- */

/** ARMED: has an escalation number AND an enabled per-tenant sms row. */
let armedTenantId: string;
let armedCadenceId: string;
/** DISARMED: has an escalation number and NO enabled sms row (production's state). */
let disarmedTenantId: string;
/** NUMBERLESS: no `escalation_phone` at all. */
let numberlessTenantId: string;

beforeAll(async () => {
  armedTenantId = await newTenant('Escalation Armed', TRADIE_PHONE_LOCAL);
  disarmedTenantId = await newTenant('Escalation Disarmed', TRADIE_PHONE_LOCAL);
  numberlessTenantId = await newTenant('Escalation No Number', null);

  // ── THE DISARMED PREMISE, MADE EXPLICIT RATHER THAN INHERITED ───────────
  //
  // The `sms_not_configured` cases below rest on these two clients resolving no
  // number. Until Phase 10 that was inherited from the DEPLOYMENT: the suite
  // opened by asserting that no sms row was enabled ANYWHERE — the 04-08 CR-01
  // question, which the tick itself asks once per pass — and that assertion was
  // both the premise and a residue alarm for a row an interrupted run had left
  // enabled. (The literal spelling of that repository function is avoided even
  // in this comment: it is grepped for, prose included, and a history note is
  // not an assertion.)
  //
  // Phase 10 arms the founding client on purpose, so "no sms row is enabled
  // anywhere" becomes a demand the system is no longer allowed to meet, and a
  // premise that can only be red is a premise nobody reads.
  //
  // An explicit `enabled = false` row per tenant says the same thing in the
  // form that stays true: routing reads a per-client OFF as STOP, never as
  // "fall back to the shared row". The rows are tracked by id and deleted first
  // in `afterAll` like every other row this suite writes to that table — and
  // the seed helper cannot arm one (04-03).
  configIds.push(await seedMessagingConfigOverride(disarmedTenantId, 'sms'));
  configIds.push(await seedMessagingConfigOverride(numberlessTenantId, 'sms'));
  expect(
    await resolveSmsFrom(disarmedTenantId),
    'The disarmed fixture resolved a number. Its refusal cases would then be ' +
      'asserting nothing — an explicit enabled = false row must mean STOP.',
  ).toBeNull();

  ({ cadenceId: armedCadenceId } = await newCadence(armedTenantId, 'Replace hot water system'));

  // TENANT-SCOPED, fictional, and deleted by id below. See the file header.
  const row = await upsertChannelConfig({
    channel: 'sms',
    tenantId: armedTenantId,
    fromAddress: FROM_NUMBER,
    enabled: true,
  });
  configIds.push(row.id);
});

afterAll(async () => {
  // BY ID and FIRST: an enabled sms row must not outlive this suite whether or
  // not the assertions passed.
  for (const id of configIds) {
    await admin.from('messaging_config').delete().eq('id', id);
  }
  if (inboundIds.length > 0) {
    const { error } = await admin.from('inbound_messages').delete().in('id', inboundIds);
    if (error) throw new Error(`Teardown failed, inbound_messages left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

/* -------------------------------------------------------------------------- *
 * The claim
 * -------------------------------------------------------------------------- */

describe('exactly one SMS per hot reply (D-08, T-6-16)', () => {
  it('sends once across two successive passes over the same reply', async () => {
    const inboundId = await seedHotReply(
      armedTenantId,
      armedCadenceId,
      'Yes please, when can you start?',
    );

    const sender = fakeSender();
    const now = new Date();

    const first = await escalateHotLeads({ sender: sender.send, now });
    const second = await escalateHotLeads({ sender: sender.send, now });

    // RELATIVE: other tenants' hot rows may also have been in the scan.
    expect(first.hotEscalated).toBeGreaterThanOrEqual(1);
    // The second pass found nothing of ours to send, and sent nothing at all
    // for it: the anti-join no longer returns the row, and the claim would
    // refuse it even if it did (asserted directly below).
    expect(second.hotEscalated).toBe(0);

    const mine = sender.calls.filter((call) => call.to === TRADIE_PHONE_E164);
    expect(mine).toHaveLength(1);

    const row = await escalationFor(inboundId);
    expect(row?.outcome).toBe('sent');
  });

  it('refuses a second claim on the same inbound id, at the database', async () => {
    // The UNIQUE index, asked directly — not through the pass, whose anti-join
    // would hide it. THIS is the guarantee; the pass merely relies on it.
    const inboundId = await seedHotReply(armedTenantId, armedCadenceId, 'yes go ahead');

    const first = await claimEscalation({
      inboundMessageId: inboundId,
      tenantId: armedTenantId,
      cadenceId: armedCadenceId,
      quoteId: armedTenantId, // any uuid: this test is about the unique index
      toAddress: TRADIE_PHONE_E164,
      // 2026-10 (13-03): every claim states its hold; this one is not held.
      holdUntil: null,
      at: new Date(),
    });
    const second = await claimEscalation({
      inboundMessageId: inboundId,
      tenantId: armedTenantId,
      cadenceId: armedCadenceId,
      quoteId: armedTenantId,
      toAddress: TRADIE_PHONE_E164,
      // 2026-10 (13-03): every claim states its hold; this one is not held.
      holdUntil: null,
      at: new Date(),
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

/* -------------------------------------------------------------------------- *
 * What the tradie receives
 * -------------------------------------------------------------------------- */

describe('the message, and who it goes to (CON-03, D-06/D-07)', () => {
  it('texts the TRADIE, with the customer number only inside the body', async () => {
    const { cadenceId } = await newCadence(armedTenantId, 'Rewire the shed');
    const inboundId = await seedHotReply(armedTenantId, cadenceId, 'Yes, lets do it');

    const sender = fakeSender();
    const now = new Date();
    await escalateHotLeads({ sender: sender.send, now });

    const row = await escalationFor(inboundId);
    expect(row).not.toBeNull();
    expect(row?.outcome).toBe('sent');

    const sent = sender.calls.find((c) => c.customString === row?.id);
    expect(sent, 'the escalation row id is the customString').toBeDefined();

    // THE PROHIBITION, ASSERTED: the recipient is the tradie's normalized
    // escalation number and never a customer's mobile.
    expect(sent?.to).toBe(TRADIE_PHONE_E164);
    expect(sent?.to).not.toBe(CUSTOMER_MOBILE);
    expect(row?.to_address).toBe(TRADIE_PHONE_E164);

    // And the customer's number IS in the message, whole, at the end.
    expect(sent?.body.endsWith(`\nCall them: ${CUSTOMER_MOBILE}`)).toBe(true);
    expect(sent?.body.startsWith('Sarah replied about "Rewire the shed": ')).toBe(true);

    // Evidence a receipt and Phase 7 both read.
    expect(row?.sent_at).not.toBeNull();
    expect(row?.provider_message_id).toBe('CS-FAKE-1');
    expect(row?.body_segments).toBe(1);
    expect(sent?.from).toBe(FROM_NUMBER);
  });

  it('suppresses a second reply on the same conversation, and records it', async () => {
    const { cadenceId } = await newCadence(armedTenantId, 'Paint the eaves');
    const base = Date.now();
    const firstId = await seedHotReply(
      armedTenantId,
      cadenceId,
      'yes please',
      new Date(base - 2000),
    );
    const secondId = await seedHotReply(
      armedTenantId,
      cadenceId,
      'also the back gate',
      new Date(base - 1000),
    );

    const sender = fakeSender();
    const counts = await escalateHotLeads({ sender: sender.send, now: new Date() });

    expect(counts.cooldownSuppressed).toBeGreaterThanOrEqual(1);

    const first = await escalationFor(firstId);
    const second = await escalationFor(secondId);

    expect(first?.outcome).toBe('sent');
    // RECORDED, not dropped: Phase 7 needs the row to compute honest reach.
    expect(second?.outcome).toBe('cooldown_suppressed');
    expect(second?.sent_at).toBeNull();

    // ONE send for this conversation, not two.
    expect(sender.calls.filter((c) => c.customString === first?.id)).toHaveLength(1);
    expect(sender.calls.filter((c) => c.customString === second?.id)).toHaveLength(0);

    // The window itself is what the cooldown constant says it is.
    expect(ESCALATION_COOLDOWN_MINUTES).toBe(30);
  });
});

/* -------------------------------------------------------------------------- *
 * Refusals — recorded, with zero provider calls
 * -------------------------------------------------------------------------- */

describe('refusals are recorded rows and NOT provider calls (D-04, T-6-19)', () => {
  it('records sms_not_configured for a disarmed client, sending nothing', async () => {
    const { cadenceId } = await newCadence(disarmedTenantId, 'Fix the gutter');
    const inboundId = await seedHotReply(disarmedTenantId, cadenceId, 'yes go ahead');

    const sender = fakeSender();
    const counts = await escalateHotLeads({ sender: sender.send, now: new Date() });

    expect(counts.notConfigured).toBeGreaterThanOrEqual(1);

    const row = await escalationFor(inboundId);
    expect(row?.outcome).toBe('sms_not_configured');
    expect(row?.sent_at).toBeNull();
    // THE ZERO-HTTP PROPERTY, asserted on the fake rather than assumed: this
    // client's escalation was never handed to the sender at all, so a disarmed
    // deployment reaches the provider zero times on its behalf.
    expect(sender.calls.some((c) => c.customString === row?.id)).toBe(false);
  });

  it('records no_escalation_number when the client has no mobile on file', async () => {
    const { cadenceId } = await newCadence(numberlessTenantId, 'Replace the fence');
    const inboundId = await seedHotReply(numberlessTenantId, cadenceId, 'yes please');

    const sender = fakeSender();
    const counts = await escalateHotLeads({ sender: sender.send, now: new Date() });

    expect(counts.noNumber).toBeGreaterThanOrEqual(1);

    const row = await escalationFor(inboundId);
    expect(row?.outcome).toBe('no_escalation_number');
    // The empty string is "there was nobody" — not a mobile, and not NULL.
    expect(row?.to_address).toBe('');
    expect(sender.calls.some((c) => c.customString === row?.id)).toBe(false);
  });

  it('records a bounded provider code on a refusal, and does not retry it', async () => {
    const { cadenceId } = await newCadence(armedTenantId, 'Tile the laundry');
    const inboundId = await seedHotReply(armedTenantId, cadenceId, 'yes thanks');

    const sender = fakeSender(() => ({
      ok: false,
      // Prose WITH A PHONE NUMBER IN IT — exactly what `codeOf` exists to bound.
      reason: 'could not deliver to +61491570156 because the handset is off',
      retryable: false,
      optedOut: false,
    }));

    const counts = await escalateHotLeads({ sender: sender.send, now: new Date() });
    expect(counts.sendFailed).toBeGreaterThanOrEqual(1);

    const row = await escalationFor(inboundId);
    const outcome = row?.outcome as string;

    expect(row?.sent_at).toBeNull();
    expect(outcome.length).toBeLessThanOrEqual(48);
    expect(outcome).not.toContain('61491570156');
    // A provider verdict is UPPERCASE; ours are lower_snake_case.
    expect(outcome).toBe(outcome.toUpperCase());

    // NO RETRY. A second pass does not pick the row up again.
    const again = fakeSender();
    await escalateHotLeads({ sender: again.send, now: new Date() });
    expect(again.calls.some((c) => c.customString === row?.id)).toBe(false);
  });

  it('leaves outcome NULL and continues when the sender throws', async () => {
    const { cadenceId: poisoned } = await newCadence(armedTenantId, 'Poisoned row');
    const { cadenceId: healthy } = await newCadence(armedTenantId, 'Healthy row');
    const base = Date.now();
    const poisonedId = await seedHotReply(
      armedTenantId,
      poisoned,
      'first, and it throws',
      new Date(base - 2000),
    );
    const healthyId = await seedHotReply(
      armedTenantId,
      healthy,
      'second, and it must still go',
      new Date(base - 1000),
    );

    let thrown = false;
    const sender = fakeSender();
    const throwOnce: EscalationSmsSender = async (input) => {
      if (!thrown) {
        thrown = true;
        throw new Error('provider exploded, and this message must not leak');
      }
      return sender.send(input);
    };

    const counts = await escalateHotLeads({ sender: throwOnce, now: new Date() });

    expect(counts.deferred).toBeGreaterThanOrEqual(1);

    const poisonedRow = await escalationFor(poisonedId);
    const healthyRow = await escalationFor(healthyId);

    // CLAIMED, OUTCOME UNKNOWN — never defaulted to a failure, because the
    // response to a definite failure is a retry (03-01's rule).
    expect(poisonedRow).not.toBeNull();
    expect(poisonedRow?.outcome).toBeNull();

    // AND THE NEXT ROW STILL WENT (04-09 per-row isolation).
    expect(healthyRow?.outcome).toBe('sent');
  });
});

/* -------------------------------------------------------------------------- *
 * The seams and the boundaries
 * -------------------------------------------------------------------------- */

describe('the pass does not run without a sender, and never builds one', () => {
  it('scans nothing when no sender is injected', async () => {
    const { cadenceId } = await newCadence(armedTenantId, 'Unsent by construction');
    const inboundId = await seedHotReply(armedTenantId, cadenceId, 'yes');

    const counts = await escalateHotLeads({ sender: undefined, now: new Date() });

    expect(counts).toEqual({
      hotEscalated: 0,
      cooldownSuppressed: 0,
      noNumber: 0,
      notConfigured: 0,
      sendFailed: 0,
      // 13-06 (2026-10, D-09): the hold count joins the shape.
      held: 0,
      deferred: 0,
      unconfigured: 1,
    });

    // NOTHING WAS CLAIMED. This is the property that matters: claiming is
    // irreversible, so a tick with nowhere to send must leave the row for the
    // next one rather than burning it.
    expect(await escalationFor(inboundId)).toBeNull();

    const still = await forAllTenants_hotUnescalated();
    expect(still.some((row) => row.inboundMessageId === inboundId)).toBe(true);
  });

  it('refuses to build a sender without credentials', () => {
    expect(buildEscalationSender({ username: undefined, apiKey: 'x' })).toBeUndefined();
    expect(buildEscalationSender({ username: 'x', apiKey: undefined })).toBeUndefined();
    expect(buildEscalationSender({ username: 'x', apiKey: 'y' })).toBeTypeOf('function');
  });

  it('the tick defaults the seam to undefined, so a remote run claims nothing', async () => {
    const { cadenceId } = await newCadence(armedTenantId, 'Tick default');
    const inboundId = await seedHotReply(armedTenantId, cadenceId, 'yes');

    // The FULL tick, with no escalation sender — the shape every other remote
    // suite in this repository runs it in.
    const result = await runCadenceTick({
      now: new Date(),
      classifyClient: null,
      draftClient: null,
    });

    expect(result.escalationUnconfigured).toBe(1);
    expect(result.hotEscalated).toBe(0);
    expect(await escalationFor(inboundId)).toBeNull();
  });

  it('the tick runs the pass and enumerates its counts when a sender is given', async () => {
    const { cadenceId } = await newCadence(armedTenantId, 'Tick wired');
    const inboundId = await seedHotReply(armedTenantId, cadenceId, 'yes please do');

    const sender = fakeSender();
    const result = await runCadenceTick({
      now: new Date(),
      classifyClient: null,
      draftClient: null,
      escalationSender: sender.send,
    });

    expect(result.escalationUnconfigured).toBe(0);
    expect(result.hotEscalated).toBeGreaterThanOrEqual(1);
    for (const field of [
      'hotEscalated',
      'escalationCooldownSuppressed',
      'escalationNoNumber',
      'escalationNotConfigured',
      'escalationSendFailed',
      'escalationDeferred',
      'escalationUnconfigured',
    ] as const) {
      expect(typeof result[field], `${field} must be a number`).toBe('number');
    }

    expect((await escalationFor(inboundId))?.outcome).toBe('sent');
  });
});

describe('the classification privilege boundary is untouched (Phase 5 D-14)', () => {
  it('the escalation pass is not reachable from classification', () => {
    // The pinned import-equality suite one file over must not gain escalation
    // members — asserted here by ABSENCE, in both directions.
    expect(PRIVILEGE_SUITE).not.toContain('escalation');
    expect(PRIVILEGE_SUITE).not.toContain('escalateHotLeads');

    // And the classifier IMPORTS nothing from the escalation module. Asserted
    // on the imports rather than on the prose: the file's header legitimately
    // mentions the escalation as the downstream consumer of `is_hot`, which is
    // exactly the sentence a reader needs.
    const classifyImports = readFileSync('src/core/classification/classify-inbound.ts', 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n');
    expect(classifyImports).not.toContain('escalation');
  });

  it('the pass READS is_hot and never re-derives it', () => {
    // `isHotLead` stays private to the classifier so the product rule can change
    // without rewriting history. A copy here would be a second answer.
    expect(PASS_CODE).not.toContain('isHotLead');
    expect(PASS_CODE).not.toContain("'interested'");
  });

  it('asks the SAME per-tenant arming question dispatch asks', () => {
    // Not a second reading of `row?.enabled ? row.fromAddress : null` — the
    // CR-01 shape. One rule, asked twice.
    expect(PASS_CODE).toContain("from '@/core/messaging/routing-sender'");
    expect(PASS_CODE).toContain('resolveSmsFrom');
    expect(PASS_CODE).not.toContain('getChannelConfig');
  });

  it('logs counts only — never a body, an address or a caught value', () => {
    const logs = [...PASS_CODE.matchAll(/console\.[a-z]+\(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log).not.toContain('row.body');
      expect(log).not.toContain('message.body');
      expect(log).not.toContain('contactMobile');
      expect(log).not.toContain('escalationPhone');
      expect(log).not.toMatch(/\berror\b/);
    }
  });
});

/* -------------------------------------------------------------------------- *
 * Research A4 — the receipts path
 * -------------------------------------------------------------------------- */

describe('an escalation custom_string misfiles nothing (research A4, T-6-20)', () => {
  it('stamps no send_ledger row and answers unmatched', async () => {
    const { cadenceId, quoteId } = await newCadence(armedTenantId, 'A4 ledger bystander');
    const [touch] = await seedTouches(cadenceId, armedTenantId, [
      { status: 'sent', scheduled_at: new Date().toISOString() },
    ]);
    void touch;

    // A real ledger row for the same tenant — the bystander that must not move.
    const { data: ledger, error } = await admin
      .from('send_ledger')
      .insert({
        tenant_id: armedTenantId,
        cadence_id: cadenceId,
        quote_id: quoteId,
        touch_number: 1,
        channel: 'sms',
        to_address: CUSTOMER_MOBILE,
        sender: 'stub',
        outcome: 'stub_sent',
      })
      .select('id')
      .single();
    if (error) throw new Error(`Seeding a ledger row failed: ${error.message}`);
    const ledgerId = (ledger as { id: string }).id;

    // An escalation row id — a uuid that names no send.
    const inboundId = await seedHotReply(armedTenantId, cadenceId, 'yes, a4');
    const sender = fakeSender();
    await escalateHotLeads({ sender: sender.send, now: new Date() });
    const escalationId = (await escalationFor(inboundId))?.id as string;
    expect(escalationId).toBeDefined();

    const result = await applyDeliveryReceipt({
      custom_string: escalationId,
      message_id: `no-such-message-${escalationId}`,
      status: 'Delivered',
      status_code: '201',
    });

    // The match keys are tried in PRECEDENCE and simply find nothing.
    expect(result).toEqual({ kind: 'unmatched' });

    const { data: after } = await admin
      .from('send_ledger')
      .select('delivery_status, delivery_detail, delivered_at, delivery_updated_at')
      .eq('id', ledgerId)
      .single();

    const row = after as Record<string, unknown>;
    expect(row.delivery_status).toBeNull();
    expect(row.delivery_detail).toBeNull();
    expect(row.delivered_at).toBeNull();
    expect(row.delivery_updated_at).toBeNull();
  });
});
