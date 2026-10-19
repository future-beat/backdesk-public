/**
 * "WHY IS THIS CLIENT NOT SENDING YET?" — THE SEVENTEEN ANSWERS, THE ONE GATE
 * THAT READS THEM, AND THE `live` DERIVED FROM TWO OF THEM PER CHANNEL
 * (ARM-01, D-01/D-02; widened by TXT-05 in 12-08, 2026-10-06).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE DERIVATION AND THE GATE ARE ONE THING, ASKED TWICE. `firstUnmetGate` │
 * │ walks the items `readGoLiveChecklist` returned rather than re-asking the │
 * │ readers, so the refusal an operator gets and the row they are looking at │
 * │ are the same fact. This suite asserts that on a real database: the same  │
 * │ tenant, the same instant, the list and the gate.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * Every reader on this path is a query. It runs against `supabase start` on the
 * runner and never through `npm run test:remote` (D-11) — the hosted Sydney
 * project is production, and the remote runner pauses the deployed ticks.
 *
 * ── THE ONE THIRD-PARTY CALL IS INJECTED, NOT MOCKED ────────────────────────
 *
 * `readGoLiveChecklist` takes `deps.isSendingDomainVerified`, so the three
 * states a Resend read can be in are exercised by handing the reader each one
 * rather than by intercepting a module. That matters beyond convenience:
 * UNKNOWN IS UNMET (Pitfall 5). During a Resend outage, "verified" would arm
 * email on a domain nobody has checked, and "not yet" would send an operator to
 * fix a domain that is fine. Both are asserted below.
 *
 * ── EVERY QUESTION HERE IS PER-TENANT ───────────────────────────────────────
 *
 * The arming rows this suite writes are its own tenants' and are deleted BY ID
 * in `afterAll` — `messaging_config` has no foreign key to `tenants`. Nothing
 * here reads or writes the row that belongs to everybody, so the file stays
 * true on a database where the founding client is armed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ARMING_GATES, firstUnmetGate } from '../src/core/onboarding/arming';
import {
  CHECKLIST_ITEM_KEYS,
  readGoLiveChecklist,
  type ChecklistItem,
  type GoLiveChecklist,
} from '../src/core/onboarding/checklist';
import { armChannel, closeDb, disarmChannel } from '../src/db/repository';

import {
  admin,
  ensureOperatorExists,
  seedAttestation,
  seedConnection,
  seedDivertNumber,
  seedMissedCall,
  seedMessageTemplate,
  seedMessagingConfigOverride,
  seedProof,
  seedNeverTextNumber,
  seedTenant,
  seedTextBackTemplates,
  seedTouchTemplates,
  teardownTenants,
} from './helpers/seed';

/** ACMA's fiction block; `.test` is RFC 2606's. Nothing here is dialable or mailable. */
const SMS_FROM = '+61491570162';
const ESCALATION_PHONE = '0491570163';
const EMAIL_FROM = 'followups@example.test';
/** A client's own line for the never-text list — ACMA fiction block. */
const OWN_LINE = '+61491570164';

/** The three states the injected domain read can return, as stubs. */
const VERIFIED = {
  isSendingDomainVerified: async () => ({ kind: 'verified' as const, domain: 'example.test' }),
};
const UNVERIFIED = {
  isSendingDomainVerified: async () => ({ kind: 'unverified' as const, domain: 'example.test' }),
};
const UNKNOWN = {
  isSendingDomainVerified: async () => ({ kind: 'unknown' as const, reason: 'boom' }),
};

let operatorId: string;
const tenantIds: string[] = [];
/** Every `messaging_config` row this suite wrote. No FK to tenants; by id. */
const configIds: string[] = [];

async function newTenant(prefix: string): Promise<string> {
  const id = await seedTenant(prefix);
  tenantIds.push(id);
  return id;
}

/** The items by key — the shape every assertion below reads. */
function byKey(checklist: GoLiveChecklist): Map<string, ChecklistItem> {
  return new Map(checklist.items.map((item) => [item.key, item]));
}

/** Everything the five common gates ask for, seeded in one call. */
async function satisfyEveryGate(tenantId: string): Promise<void> {
  await seedConnection(tenantId);
  await seedTouchTemplates(tenantId);
  for (const touchNumber of [1, 2, 3, 4, 5]) {
    await seedMessageTemplate(tenantId, touchNumber);
  }
  await seedAttestation(tenantId);
  const { error } = await admin
    .from('tenants')
    .update({ escalation_phone: ESCALATION_PHONE })
    .eq('id', tenantId);
  if (error) throw new Error(`Setting escalation_phone failed: ${error.message}`);
}

beforeAll(async () => {
  operatorId = await ensureOperatorExists();
});

afterAll(async () => {
  // BY ID and FIRST — nothing else can reach these rows. The text-back rows
  // `armChannel` CREATES (12-08) are found by tenant and deleted by id too.
  const { data: created } = await admin
    .from('messaging_config')
    .select('id')
    .in('tenant_id', tenantIds);
  for (const id of new Set([...configIds, ...((created ?? []) as { id: string }[]).map((r) => r.id)])) {
    await admin.from('messaging_config').delete().eq('id', id);
  }
  const { error } = await admin
    .from('messaging_config_audit')
    .delete()
    .in('tenant_id', tenantIds);
  if (error) throw new Error(`Teardown failed, audit rows left behind: ${error.message}`);

  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

/* -------------------------------------------------------------------------- *
 * The seventeen keys
 * -------------------------------------------------------------------------- */

// 2026-10-06 (12-08, TXT-05): thirteen → seventeen, deliberately. The four
// text-back rows append after the divert rows, in the order the operator does
// the work.
describe('readGoLiveChecklist renders seventeen keys in a fixed order (ARM-01, CAP-05, TXT-05)', () => {
  it('answers every key for a brand-new client, with a fact or an honest null', async () => {
    const tenantId = await newTenant('Go Live Bare');
    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);

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
      // LAST, AND AFTER THE ARMING ROWS BECAUSE THEY DEPEND ON THEM: a live
      // proof is produced by the product, so it cannot exist until the channel
      // is armed. That is why neither gates arming (D-01).
      'escalationHandsetProof',
      'emailPipeProof',
      // THE TWO DIVERT ROWS (Phase 11, CAP-05) — they gate text_back only.
      'divertNumber',
      'divertVerified',
      // THE FOUR TEXT-BACK ROWS (Phase 12, 12-08, TXT-05). The first two gate
      // text_back; the switch and its proof cannot (D-01 circularity).
      'textBackTemplates',
      'neverTextOwnNumber',
      'textBackArmed',
      'textBackProof',
    ]);
    expect(checklist.items.map((item) => item.key)).toEqual([...CHECKLIST_ITEM_KEYS]);
    expect(checklist.items).toHaveLength(17);

    const by = byKey(checklist);
    for (const key of [
      'sm8Connected',
      'voiceProfile',
      'templatesApproved',
      'sm8AutomationOff',
      'escalationPhone',
      'sendingDomainVerified',
      'emailArmed',
      'escalationHandsetProof',
      'emailPipeProof',
      'divertNumber',
      'divertVerified',
      'textBackTemplates',
      'neverTextOwnNumber',
      'textBackArmed',
      'textBackProof',
    ]) {
      expect(by.get(key)?.satisfied, `${key} was satisfied for a brand-new client`).toBe(false);
    }

    // A brand-new client has no text-back row and so is NOT ARMED — the
    // exact-target read never falls back to a global row (there is none).
    expect(checklist.live.textBack).toBe('not_armed');
    expect(checklist.arming.textBack).toEqual({ armed: false });
    expect(checklist.proofs.textBack).toBeNull();

    // `create_tenant()` REQUIRES the window — there is no default contact window
    // anywhere in this system, by rule — so this one row is satisfied from the
    // client's first minute, and its detail is the fact rather than the boolean.
    expect(by.get('contactHours')?.satisfied).toBe(true);
    expect(by.get('contactHours')?.detail).toContain('(Australia/Perth)');

    // A DIAGNOSTIC OR AN HONEST NULL — never the empty string. Every unmet row
    // the card renders shows its detail in the warn badge, and `''` renders as a
    // badge with nothing in it: an operator reads that as a bug in the page
    // rather than as the answer to their question.
    for (const item of checklist.items) {
      if (item.detail !== null) expect(item.detail.trim()).not.toBe('');
    }

    // The one row whose diagnostic is its whole value: "not yet" would send an
    // operator to the Resend dashboard for a client who has no email identity
    // to check in the first place.
    expect(by.get('sendingDomainVerified')?.detail).toBe('no email identity for this client yet');
    expect(by.get('emailArmed')?.detail).toBeNull();

    // THE PER-TENANT FACT, asserted instead of the shared row's state: this
    // client has no sms row of their own, which is the only half of "are they
    // armed" that belongs to them. What the shared row says is the deployment's
    // business and is allowed to change the morning the founding client goes
    // live (10-04).
    expect(checklist.arming.sms.tenantRow).toBeNull();
  });
});

/* -------------------------------------------------------------------------- *
 * The arming rows
 * -------------------------------------------------------------------------- */

describe('the two arming rows say WHICH row is sending', () => {
  it('reads an explicit OFF override as unmet, and says so in the operator\'s words', async () => {
    const tenantId = await newTenant('Go Live Override Off');
    configIds.push(
      await seedMessagingConfigOverride(tenantId, 'sms', { from_address: SMS_FROM }),
    );

    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get('smsArmed');

    // An explicit per-client `enabled = false` means STOP, not "fall back to
    // the shared row" — so this stays unmet however the shared row is set, which
    // is exactly the property that keeps one client held off while the rest of
    // the cohort sends.
    expect(item?.satisfied).toBe(false);
    expect(item?.detail?.startsWith('off for this client (override)')).toBe(true);
  });

  it('reads THIS CLIENT\'S OWN armed row as met, and names it', async () => {
    const tenantId = await newTenant('Go Live Override Armed');
    const rowId = await seedMessagingConfigOverride(tenantId, 'sms', { from_address: SMS_FROM });
    configIds.push(rowId);

    const armed = await armChannel({
      channel: 'sms',
      tenantId,
      operatorUserId: operatorId,
      reason: 'checklist derivation test',
    });
    expect(armed.kind).toBe('armed');

    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get('smsArmed');
    expect(item?.satisfied).toBe(true);
    // WHOSE ROW IT IS, in the detail. The same row armed through the shared
    // number reads "shared number, every connected client" — one sentence is
    // the difference between a client who is on because somebody chose them and
    // a client who is on because everybody is.
    expect(item?.detail).toContain(SMS_FROM);
    expect(item?.detail).toContain("this client's row");

    // Off again immediately: this suite arms only inside the test about arming.
    await disarmChannel({
      channel: 'sms',
      tenantId,
      operatorUserId: operatorId,
      reason: 'end of the checklist derivation test',
    });
    expect(
      byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get('smsArmed')?.satisfied,
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * The three-state domain read
 * -------------------------------------------------------------------------- */

describe('the sending domain is a THREE-state read (Pitfall 5, T-4-26)', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await newTenant('Go Live Domain');
    configIds.push(
      await seedMessagingConfigOverride(tenantId, 'email', {
        from_address: EMAIL_FROM,
        reply_to: 'dana@example.test',
        business_name: 'Dana (test)',
      }),
    );
  });

  it('is MET when the provider says the domain is verified', async () => {
    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), VERIFIED)).get(
      'sendingDomainVerified',
    );

    expect(item?.satisfied).toBe(true);
    expect(item?.detail).toContain('verified at Resend');
  });

  it('is UNMET, naming the domain, when the provider says it is not verified', async () => {
    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'sendingDomainVerified',
    );

    expect(item?.satisfied).toBe(false);
    expect(item?.detail).toBe('example.test is not verified');
  });

  it('is UNMET — never a pass — when the provider read FAILS', async () => {
    // A Resend outage must not read as "verified" on the row the email arming
    // gate consults. Unknown is not "not yet" either: the detail says the check
    // did not happen, so an operator is not sent to fix a domain that is fine.
    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNKNOWN);
    const item = byKey(checklist).get('sendingDomainVerified');

    expect(item?.satisfied).toBe(false);
    expect(item?.detail).toBe('could not check the sending domain');
    expect(checklist.arming.email.domain).toBe('unknown');

    // AND THE GATE AGREES, which is the whole point of the row: an unknown
    // domain cannot arm email.
    expect(firstUnmetGate('email', checklist.items)).not.toBeNull();
  });

  it('does not arm email merely because an identity is saved', async () => {
    // `emailArmed` reads the per-tenant resolver, so a complete-but-disabled
    // identity is "identity saved, not armed" — the distinction a boolean over
    // `messaging_config` existence cannot make.
    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), VERIFIED)).get('emailArmed');

    expect(item?.satisfied).toBe(false);
    expect(item?.detail).toBe('identity saved, not armed');
  });
});

/* -------------------------------------------------------------------------- *
 * The two proof rows, and the `live` derived from them
 * -------------------------------------------------------------------------- */

describe('LIVE is armed PLUS a recorded proof, derived and never stored (D-01, D-02)', () => {
  it('is not_armed on both channels for a client with no proofs and no rows', async () => {
    const tenantId = await newTenant('Go Live Proofs Bare');
    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    const by = byKey(checklist);

    expect(by.get('escalationHandsetProof')?.satisfied).toBe(false);
    expect(by.get('emailPipeProof')?.satisfied).toBe(false);
    // NULL, NOT A PLACEHOLDER. The card renders an unmet row's detail in its
    // warn badge, and 'not recorded' typed here would be a second spelling of a
    // sentence the card already owns.
    expect(by.get('escalationHandsetProof')?.detail).toBeNull();
    expect(by.get('emailPipeProof')?.detail).toBeNull();

    expect(checklist.proofs.escalationHandset).toBeNull();
    expect(checklist.proofs.emailPipe).toBeNull();

    // This client has no sms row of their own, so `smsArmed` reads the shared
    // row — which the founding client's go-live is allowed to turn on (10-04).
    // The EMAIL half is unambiguous and is the one asserted absolutely.
    expect(checklist.live.email).toBe('not_armed');
    expect(['not_armed', 'armed']).toContain(checklist.live.sms);
  });

  it('is ARMED, not live, when the channel is on and nobody has watched a message arrive', async () => {
    const tenantId = await newTenant('Go Live Proofs Armed');
    configIds.push(await seedMessagingConfigOverride(tenantId, 'sms', { from_address: SMS_FROM }));

    const armed = await armChannel({
      channel: 'sms',
      tenantId,
      operatorUserId: operatorId,
      reason: 'live derivation test',
    });
    expect(armed.kind).toBe('armed');

    // ARMED IS THE HONEST MIDDLE STATE and the reason `live` is three-valued
    // rather than a boolean: real messages can leave, and nothing has yet been
    // observed arriving. Collapsing it into "live" is precisely the claim D-02
    // refuses to let an arming state make on its own.
    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(checklist.live.sms).toBe('armed');
    expect(byKey(checklist).get('escalationHandsetProof')?.satisfied).toBe(false);

    await seedProof(tenantId, 'escalation_handset_proof', { artefact_id: 'abcdef123456' });

    const proven = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    const item = byKey(proven).get('escalationHandsetProof');
    expect(item?.satisfied).toBe(true);
    // THE ARTEFACT ID IS THE DETAIL, because that is the thing somebody goes and
    // re-checks. The date is added by the page, formatted in the CLIENT's zone.
    expect(item?.detail?.endsWith('abcdef123456')).toBe(true);
    expect(proven.proofs.escalationHandset?.artefactId).toBe('abcdef123456');
    expect(proven.proofs.escalationHandset?.recordedAt).toBeInstanceOf(Date);

    expect(proven.live.sms).toBe('live');
    // ONE CHANNEL AT A TIME. An escalation reaching a handset says nothing about
    // whether this client's email identity can deliver, and a derivation that
    // let one channel's proof colour the other would be the single worst way to
    // be told email was live.
    expect(proven.live.email).toBe('not_armed');
    expect(byKey(proven).get('emailPipeProof')?.satisfied).toBe(false);

    // DISARMED, AND THE PROOF ROW STAYS SATISFIED. It happened; it is simply no
    // longer the current state — which is why `live` falls back to `not_armed`
    // while the row it was derived from is untouched.
    await disarmChannel({
      channel: 'sms',
      tenantId,
      operatorUserId: operatorId,
      reason: 'end of the live derivation test',
    });

    const disarmed = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(disarmed.live.sms).toBe('not_armed');
    expect(byKey(disarmed).get('escalationHandsetProof')?.satisfied).toBe(true);
  });

  it('derives EMAIL independently — armed identity plus an email pipe proof is live', async () => {
    const tenantId = await newTenant('Go Live Proofs Email');
    configIds.push(
      await seedMessagingConfigOverride(tenantId, 'email', {
        from_address: EMAIL_FROM,
        reply_to: 'dana@example.test',
        business_name: 'Dana (test)',
      }),
    );

    const armed = await armChannel({
      channel: 'email',
      tenantId,
      operatorUserId: operatorId,
      reason: 'live derivation test, email',
    });
    expect(armed.kind).toBe('armed');

    expect((await readGoLiveChecklist(tenantId, new Date(), VERIFIED)).live.email).toBe('armed');

    await seedProof(tenantId, 'email_pipe_proof', { artefact_id: 'resend-live00001' });

    const proven = await readGoLiveChecklist(tenantId, new Date(), VERIFIED);
    expect(proven.live.email).toBe('live');
    // AND THE OTHER CHANNEL IS UNMOVED. Two derivations, one per channel, from
    // that channel's own two facts.
    expect(proven.live.sms).not.toBe('live');

    await disarmChannel({
      channel: 'email',
      tenantId,
      operatorUserId: operatorId,
      reason: 'end of the live derivation test, email',
    });
  });

  it('never reads LIVE from a proof alone — an unarmed channel stays not_armed', async () => {
    const tenantId = await newTenant('Go Live Proof Only');
    // The explicit OFF row: per-client OFF means STOP, never "fall back to the
    // shared row", so this stays unarmed whatever the deployment is doing.
    configIds.push(await seedMessagingConfigOverride(tenantId, 'sms', { from_address: SMS_FROM }));

    await seedProof(tenantId, 'escalation_handset_proof', { artefact_id: 'fedcba654321' });
    await seedProof(tenantId, 'email_pipe_proof', { artefact_id: 'resend-abcdef01' });

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);

    expect(byKey(checklist).get('escalationHandsetProof')?.satisfied).toBe(true);
    expect(byKey(checklist).get('emailPipeProof')?.satisfied).toBe(true);
    expect(checklist.live.sms).toBe('not_armed');
    expect(checklist.live.email).toBe('not_armed');
  });

  it('is LATEST-WINS: a second proof of a kind replaces the first on the row', async () => {
    const tenantId = await newTenant('Go Live Proof Latest');

    await seedProof(tenantId, 'email_pipe_proof', { artefact_id: 'resend-first0001' });
    await seedProof(tenantId, 'email_pipe_proof', { artefact_id: 'resend-second002' });

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    // Re-proving is a NEW ROW and the newest one is the answer — "when did this
    // last actually work" rather than "did it ever".
    expect(checklist.proofs.emailPipe?.artefactId).toBe('resend-second002');
    expect(byKey(checklist).get('emailPipeProof')?.detail?.endsWith('resend-second002')).toBe(true);
  });

  it('a STALE attestation nags and changes nothing about live (D-15 tier 2)', async () => {
    const tenantId = await newTenant('Go Live Proof Stale');
    const staleAt = new Date(Date.now() - 45 * 86_400_000).toISOString();
    await seedAttestation(tenantId, { attested_at: staleAt });

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);

    // The row stays SATISFIED — the badge beside it says stale, and that is the
    // whole of tier 2. Nothing on the staleness path writes a pause, and nothing
    // on it may reach into `live`.
    expect(byKey(checklist).get('sm8AutomationOff')?.satisfied).toBe(true);
    expect(checklist.attestation.isStale).toBe(true);
    expect(checklist.live.email).toBe('not_armed');
  });
});

/* -------------------------------------------------------------------------- *
 * The two divert rows and the divert health (CAP-05, D-09)
 * -------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;

describe('the divert rows read their facts, and the health is derived at read time (CAP-05)', () => {
  it('reads "not yet" everywhere for a client with no number, no proof and no call', async () => {
    const tenantId = await newTenant('Go Live Divert Bare');
    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    const by = byKey(checklist);

    expect(by.get('divertNumber')?.satisfied).toBe(false);
    expect(by.get('divertNumber')?.detail).toBeNull();
    expect(by.get('divertVerified')?.satisfied).toBe(false);
    expect(by.get('divertVerified')?.detail).toBeNull();

    // THE FACTS PHASE 12'S GATE WILL READ, in their honest-null form.
    expect(checklist.proofs.divertVerification).toBeNull();
    expect(checklist.divert).toEqual({
      numberE164: null,
      divertNumberId: null,
      status: 'none',
      spokenName: null,
      statusSince: null,
      failureCode: null,
      lastCallAt: null,
      daysSinceLastCall: null,
    });
  });

  it('satisfies divertNumber only when the row is ACTIVE, with the number as its detail', async () => {
    const tenantId = await newTenant('Go Live Divert Active');
    const id = await seedDivertNumber(tenantId);
    const { data } = await admin
      .from('tenant_divert_numbers')
      .select('number_e164')
      .eq('id', id)
      .single();
    const number = (data as { number_e164: string }).number_e164;

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    const item = byKey(checklist).get('divertNumber');

    expect(item?.satisfied).toBe(true);
    expect(item?.detail).toBe(number);
    expect(checklist.divert.status).toBe('active');
    expect(checklist.divert.numberE164).toBe(number);
    // WR-02: the ACTIVE row's id, which the verification proof matches against.
    expect(checklist.divert.divertNumberId).toBe(id);
    expect(checklist.divert.spokenName).toBe('Seeded Sparks');
  });

  it('an ACTIVE row Twilio showed no bundle on says so beside the number (WR-09)', async () => {
    const tenantId = await newTenant('Go Live Divert Unbundled');
    const id = await seedDivertNumber(tenantId, { failure_code: 'bundle_unattached' });
    const { data } = await admin
      .from('tenant_divert_numbers')
      .select('number_e164')
      .eq('id', id)
      .single();
    const number = (data as { number_e164: string }).number_e164;

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    const item = byKey(checklist).get('divertNumber');

    expect(item?.satisfied).toBe(true);
    expect(item?.detail).toBe(`${number} · AU bundle not attached at purchase`);
    expect(checklist.divert.failureCode).toBe('bundle_unattached');
  });

  it('reads PENDING and FAILED as unmet, each naming its state', async () => {
    const pendingTenant = await newTenant('Go Live Divert Pending');
    await seedDivertNumber(pendingTenant, {
      status: 'pending',
      number_e164: null,
      provider_number_sid: null,
    });
    const pending = await readGoLiveChecklist(pendingTenant, new Date(), UNVERIFIED);
    expect(byKey(pending).get('divertNumber')?.satisfied).toBe(false);
    expect(byKey(pending).get('divertNumber')?.detail).toBe('purchase pending');
    expect(pending.divert.status).toBe('pending');
    expect(pending.divert.numberE164).toBeNull();
    expect(pending.divert.divertNumberId).toBeNull();
    // WR-07: the claim's age is readable — the console shows it.
    expect(pending.divert.statusSince).toBeInstanceOf(Date);

    const failedTenant = await newTenant('Go Live Divert Failed');
    await seedDivertNumber(failedTenant, {
      status: 'failed',
      number_e164: null,
      provider_number_sid: null,
      failure_code: 'bundle_rejected',
    });
    const failed = await readGoLiveChecklist(failedTenant, new Date(), UNVERIFIED);
    expect(byKey(failed).get('divertNumber')?.satisfied).toBe(false);
    expect(byKey(failed).get('divertNumber')?.detail).toBe('purchase failed: bundle_rejected');
    expect(failed.divert.status).toBe('failed');
    expect(failed.divert.failureCode).toBe('bundle_rejected');
    expect(pending.divert.failureCode).toBeNull();
  });

  it('reads a HELD pending row (purchase outcome unknown) as exactly that, code and all (CR-01)', async () => {
    const heldTenant = await newTenant('Go Live Divert Held');
    await seedDivertNumber(heldTenant, {
      status: 'pending',
      number_e164: null,
      provider_number_sid: null,
      failure_code: 'outcome_unknown',
    });
    const held = await readGoLiveChecklist(heldTenant, new Date(), UNVERIFIED);

    expect(byKey(held).get('divertNumber')?.satisfied).toBe(false);
    expect(byKey(held).get('divertNumber')?.detail).toBe(
      'purchase outcome unknown — do not buy elsewhere',
    );
    expect(held.divert.status).toBe('pending');
    expect(held.divert.failureCode).toBe('outcome_unknown');
  });

  // 2026-10-06 (12-08, WR-02-strict): a proof's EXISTENCE no longer satisfies
  // divertVerified. The latest proof must record caller_present true on the
  // ACTIVE divert row; anything else reads "needs a diverted call".
  it('satisfies divertVerified only from a proof showing the caller on the ACTIVE number', async () => {
    const tenantId = await newTenant('Go Live Divert Verified');
    const divertId = await seedDivertNumber(tenantId);
    const callId = await seedMissedCall(tenantId, { divert_number_id: divertId });
    await seedProof(tenantId, 'divert_verification_call', {
      artefact_id: callId,
      artefact_detail: { caller_present: true, divert_number_id: divertId },
    });

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    const item = byKey(checklist).get('divertVerified');

    expect(item?.satisfied).toBe(true);
    // THE ARTEFACT, NOT THE DATE — the page prepends "verified on {date}" in
    // the client's zone; a core that formatted it would use the runner's.
    expect(item?.detail).toBe(`recorded · ${callId}`);
    expect(checklist.proofs.divertVerification?.artefactId).toBe(callId);
    expect(checklist.proofs.divertVerification?.recordedAt).toBeInstanceOf(Date);
  });

  it('reads a proof with an artefact id ONLY as unmet — recorded, needs a diverted call', async () => {
    // The shape of every proof recorded before the strict rule, including the
    // test tenant's 2 Oct proof: the row stays, the row is shown, and it does
    // not verify the divert.
    const tenantId = await newTenant('Go Live Divert Old Proof');
    await seedDivertNumber(tenantId);
    const callId = await seedMissedCall(tenantId);
    await seedProof(tenantId, 'divert_verification_call', { artefact_id: callId });

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    const item = byKey(checklist).get('divertVerified');

    expect(item?.satisfied).toBe(false);
    expect(item?.detail).toBe(
      `recorded · ${callId} · needs a diverted call showing the caller on the active number`,
    );
    // The proof itself is still reported — never edited, never deleted.
    expect(checklist.proofs.divertVerification?.artefactId).toBe(callId);
  });

  it.each([
    ['caller_present false', (divertId: string) => ({ caller_present: false, divert_number_id: divertId })],
    ['caller_present missing', (divertId: string) => ({ divert_number_id: divertId })],
    ['caller_present a string', (divertId: string) => ({ caller_present: 'true', divert_number_id: divertId })],
    ['divert_number_id missing', () => ({ caller_present: true })],
    [
      'a different divert_number_id',
      () => ({ caller_present: true, divert_number_id: '00000000-0000-4000-8000-000000000000' }),
    ],
  ])('reads %s as unmet, still showing the recorded id', async (_label, detail) => {
    const tenantId = await newTenant('Go Live Divert Strict');
    const divertId = await seedDivertNumber(tenantId);
    const callId = await seedMissedCall(tenantId);
    await seedProof(tenantId, 'divert_verification_call', {
      artefact_id: callId,
      artefact_detail: detail(divertId),
    });

    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'divertVerified',
    );

    expect(item?.satisfied).toBe(false);
    expect(item?.detail).toContain(`recorded · ${callId}`);
    expect(item?.detail).toContain('needs a diverted call');
  });

  it('reads a good proof as unmet when the number is no longer ACTIVE', async () => {
    const tenantId = await newTenant('Go Live Divert Failed Since');
    const divertId = await seedDivertNumber(tenantId, {
      status: 'failed',
      number_e164: null,
      provider_number_sid: null,
      failure_code: 'bundle_rejected',
    });
    const callId = await seedMissedCall(tenantId);
    await seedProof(tenantId, 'divert_verification_call', {
      artefact_id: callId,
      artefact_detail: { caller_present: true, divert_number_id: divertId },
    });

    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'divertVerified',
    );
    expect(item?.satisfied).toBe(false);
  });

  it('is LATEST-WINS: a fresh good proof supersedes an old one without touching it', async () => {
    const tenantId = await newTenant('Go Live Divert Superseded');
    const divertId = await seedDivertNumber(tenantId);
    const oldCall = await seedMissedCall(tenantId);
    // recorded_at is the database's (server-set); the second insert, in a
    // later transaction, is the later row.
    const oldProof = await seedProof(tenantId, 'divert_verification_call', {
      artefact_id: oldCall,
    });
    expect(
      byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get('divertVerified')
        ?.satisfied,
    ).toBe(false);

    const newCall = await seedMissedCall(tenantId, { divert_number_id: divertId });
    await seedProof(tenantId, 'divert_verification_call', {
      artefact_id: newCall,
      artefact_detail: { caller_present: true, divert_number_id: divertId },
    });

    const item = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'divertVerified',
    );
    expect(item?.satisfied).toBe(true);
    expect(item?.detail).toBe(`recorded · ${newCall}`);

    // The old row is still there, unedited.
    const { data } = await admin
      .from('tenant_proofs')
      .select('artefact_id, artefact_detail')
      .eq('id', oldProof)
      .single();
    expect(data).toEqual({ artefact_id: oldCall, artefact_detail: {} });
  });

  it('derives days since the last diverted call — floored, newest call wins', async () => {
    const tenantId = await newTenant('Go Live Divert Last Call');

    // THREE DAYS AND AN HOUR AGO: floored to 3, the attestationAgeDays rule.
    const threeDaysAgo = new Date(Date.now() - (3 * MS_PER_DAY + 3_600_000));
    await seedMissedCall(tenantId, { started_at: threeDaysAgo.toISOString() });

    const older = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(older.divert.lastCallAt?.toISOString()).toBe(threeDaysAgo.toISOString());
    expect(older.divert.daysSinceLastCall).toBe(3);

    // A CALL NOW: the newest row answers, and zero is "today".
    await seedMissedCall(tenantId);
    const now = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(now.divert.lastCallAt).toBeInstanceOf(Date);
    expect(now.divert.daysSinceLastCall).toBe(0);
  });

  // 2026-10-06 (12-08): was "gates NOTHING this phase". The divert and
  // text-back rows now gate text_back — and still nothing else.
  it('the divert and text-back rows gate text_back only — a divert-less client still opens SMS (D-09)', async () => {
    const tenantId = await newTenant('Go Live Divert Gate');
    await satisfyEveryGate(tenantId);

    const checklist = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(byKey(checklist).get('divertNumber')?.satisfied).toBe(false);
    expect(byKey(checklist).get('divertVerified')?.satisfied).toBe(false);
    expect(firstUnmetGate('sms', checklist.items)).toBeNull();
    // Text-back is refused on the first of ITS gates this client lacks.
    expect(firstUnmetGate('text_back', checklist.items)).not.toBeNull();

    // AND THE MESSAGING GATE LISTS DO NOT NAME THEM.
    for (const channel of ['sms', 'email'] as const) {
      for (const key of [
        'divertNumber',
        'divertVerified',
        'textBackTemplates',
        'neverTextOwnNumber',
        'textBackArmed',
        'textBackProof',
      ]) {
        expect([...ARMING_GATES[channel]]).not.toContain(key);
      }
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The gate that reads the list
 * -------------------------------------------------------------------------- */

describe('firstUnmetGate names the FIRST missing thing, in checklist order (D-01)', () => {
  it('starts at sm8Connected for a brand-new client, on both channels', async () => {
    const tenantId = await newTenant('Go Live Gate Bare');
    const { items } = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);

    // A refusal that named the fifth missing item would send an operator to fix
    // something that will not help until the first one is done.
    expect(firstUnmetGate('sms', items)).toBe('sm8Connected');
    expect(firstUnmetGate('email', items)).toBe('sm8Connected');

    // The gates are a SUBSET of the checklist, and the two arming rows are not
    // in it: `smsArmed` gating the arm would be a control that refuses to run
    // until it has already run.
    expect([...ARMING_GATES.sms]).not.toContain('smsArmed');
    expect([...ARMING_GATES.email]).not.toContain('emailArmed');
  });

  it('opens for SMS once every common gate is met — and email still waits on the domain', async () => {
    const tenantId = await newTenant('Go Live Gate Satisfied');
    await satisfyEveryGate(tenantId);
    configIds.push(
      await seedMessagingConfigOverride(tenantId, 'email', {
        from_address: EMAIL_FROM,
        reply_to: 'dana@example.test',
        business_name: 'Dana (test)',
      }),
    );

    const unverified = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);

    // NULL MEANS THE ARM MAY PROCEED. Note what is NOT required for it: the
    // voice profile (drafting has its own belt) and the two live proofs, which
    // cannot gate arming because producing them requires the channel armed —
    // the whole resolution of the ARM-01/02/03 circularity.
    expect(firstUnmetGate('sms', unverified.items)).toBeNull();

    // Email adds exactly one gate, and it is the one whose failure nothing on
    // this side can observe: mail from an unaligned domain is rejected or
    // spam-foldered by the RECEIVING side.
    expect(firstUnmetGate('email', unverified.items)).toBe('sendingDomainVerified');

    const verified = await readGoLiveChecklist(tenantId, new Date(), VERIFIED);
    expect(firstUnmetGate('email', verified.items)).toBeNull();
  });

  it('treats an ABSENT item as unmet, never as no objection (T-5-13)', async () => {
    // Not a database fact, but it is the rule the two above depend on: if a
    // caller hands over a truncated list — a partial read, a refactor that drops
    // a row — the honest answer is "that condition is not established". The
    // whole class of defect this exists for is the gate that opens because the
    // thing it checks was not there to check.
    expect(firstUnmetGate('sms', [])).toBe('sm8Connected');
  });
});

/* -------------------------------------------------------------------------- *
 * The four text-back rows and the third live line (12-08, TXT-05, D-13)
 * -------------------------------------------------------------------------- */

describe('the text-back rows read their facts (TXT-05, D-09, D-13)', () => {
  it('textBackTemplates needs ALL THREE variants attested, and names the missing ones', async () => {
    const tenantId = await newTenant('Go Live Text-back Templates');

    // Two attested, one missing.
    await seedTextBackTemplates(tenantId, { variants: ['business_hours', 'after_hours'] });
    const partial = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'textBackTemplates',
    );
    expect(partial?.satisfied).toBe(false);
    expect(partial?.detail).toBe('not attested: about quote');

    // The third saved but NOT attested still does not count.
    await seedTextBackTemplates(tenantId, { variants: ['about_quote'], attested: false });
    expect(
      byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get('textBackTemplates')
        ?.satisfied,
    ).toBe(false);

    // Attested as a newer version: met.
    await seedTextBackTemplates(tenantId, { variants: ['about_quote'], version: 2 });
    const full = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'textBackTemplates',
    );
    expect(full?.satisfied).toBe(true);
    expect(full?.detail).toBe('all three attested');
  });

  it('an attested wording that no longer validates (business renamed) turns the row unmet (12-REVIEW WR-02)', async () => {
    const tenantId = await newTenant('Go Live Text-back Renamed');
    await seedTextBackTemplates(tenantId);
    expect(
      byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get('textBackTemplates')
        ?.satisfied,
    ).toBe(true);

    // The send path re-validates against the CURRENT name and would refuse
    // `no_template` for every caller from here on; the card must say so.
    const { error } = await admin
      .from('tenants')
      .update({ name: 'Completely Different Trading' })
      .eq('id', tenantId);
    if (error) throw new Error(`Renaming the tenant failed: ${error.message}`);

    const renamed = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'textBackTemplates',
    );
    expect(renamed?.satisfied).toBe(false);
    expect(renamed?.detail).toBe('no longer validates: business hours, after hours, about quote');
  });

  it('neverTextOwnNumber needs at least one OWN line — a never-text entry is not one', async () => {
    const tenantId = await newTenant('Go Live Text-back Own Line');

    await seedNeverTextNumber(tenantId, '+61491570165', 'never_text');
    const none = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'neverTextOwnNumber',
    );
    expect(none?.satisfied).toBe(false);
    expect(none?.detail).toBeNull();

    await seedNeverTextNumber(tenantId, OWN_LINE, 'own_line');
    const one = byKey(await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).get(
      'neverTextOwnNumber',
    );
    expect(one?.satisfied).toBe(true);
    // The COUNT, never the number.
    expect(one?.detail).toBe('1 own line listed');
    expect(one?.detail).not.toContain(OWN_LINE);
  });

  it('live.textBack is not_armed → armed → live, through the one deriveLive', async () => {
    const tenantId = await newTenant('Go Live Text-back Live');

    expect((await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED)).live.textBack).toBe(
      'not_armed',
    );

    const armed = await armChannel({
      channel: 'text_back',
      tenantId,
      operatorUserId: operatorId,
      reason: 'live derivation test, text-back',
    });
    expect(armed.kind).toBe('armed');

    const on = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(on.live.textBack).toBe('armed');
    expect(byKey(on).get('textBackArmed')?.satisfied).toBe(true);
    expect(on.arming.textBack).toEqual({ armed: true });

    const callId = await seedMissedCall(tenantId);
    await seedProof(tenantId, 'text_back_proof', { artefact_id: callId });

    const proven = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(proven.live.textBack).toBe('live');
    expect(byKey(proven).get('textBackProof')?.detail).toBe(`recorded · ${callId}`);
    expect(proven.proofs.textBack?.artefactId).toBe(callId);
    // ONE CHANNEL AT A TIME: a text-back proof says nothing about email.
    expect(proven.live.email).toBe('not_armed');

    // Off: the proof row stays satisfied, live falls back to not_armed.
    const off = await disarmChannel({
      channel: 'text_back',
      tenantId,
      operatorUserId: operatorId,
      reason: 'end of the live derivation test, text-back',
    });
    expect(off.kind).toBe('disarmed');

    const disarmed = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(disarmed.live.textBack).toBe('not_armed');
    expect(byKey(disarmed).get('textBackArmed')?.satisfied).toBe(false);
    expect(byKey(disarmed).get('textBackProof')?.satisfied).toBe(true);
  });

  it('opens the text_back gate only when all ten items are met on a real database', async () => {
    const tenantId = await newTenant('Go Live Text-back Gate');
    await satisfyEveryGate(tenantId);

    // SMS armed for THIS client (its own row), so the gate does not depend on
    // the shared row's state on this database.
    configIds.push(await seedMessagingConfigOverride(tenantId, 'sms', { from_address: SMS_FROM }));
    const sms = await armChannel({
      channel: 'sms',
      tenantId,
      operatorUserId: operatorId,
      reason: 'text-back gate test',
    });
    expect(sms.kind).toBe('armed');

    const divertId = await seedDivertNumber(tenantId);
    const callId = await seedMissedCall(tenantId, { divert_number_id: divertId });
    await seedProof(tenantId, 'divert_verification_call', {
      artefact_id: callId,
      artefact_detail: { caller_present: true, divert_number_id: divertId },
    });
    await seedTextBackTemplates(tenantId);

    // Nine of ten: the own line is the one missing.
    const nine = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(firstUnmetGate('text_back', nine.items)).toBe('neverTextOwnNumber');

    await seedNeverTextNumber(tenantId, OWN_LINE, 'own_line');
    const ten = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(firstUnmetGate('text_back', ten.items)).toBeNull();

    // SMS off for this client → text-back refused naming 'SMS armed' (D-15).
    await disarmChannel({
      channel: 'sms',
      tenantId,
      operatorUserId: operatorId,
      reason: 'end of the text-back gate test',
    });
    const smsOff = await readGoLiveChecklist(tenantId, new Date(), UNVERIFIED);
    expect(firstUnmetGate('text_back', smsOff.items)).toBe('smsArmed');
  });
});
