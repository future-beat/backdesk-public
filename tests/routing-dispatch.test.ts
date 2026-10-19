/**
 * The routing composite against the hosted Sydney database — the two facts no
 * pure test can establish.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 1. THE CLAIM RECORDS THE DELEGATE, NEVER THE COMPOSITE (T-4-11).         │
 * │ 2. A CLIENT HELD EXPLICITLY OFF RESOLVES NO IDENTITY — whatever the      │
 * │    shared row says. (This was "production is still stub-only" until      │
 * │    Phase 10; see that assertion's own comment for why the deployment-    │
 * │    level form of the question had to go.)                                │
 * │ 3. ARMING ONE CLIENT ARMS ONE CLIENT — AND REFUSES EVERY OTHER (CR-01).  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * SPLIT FROM `tests/routing-sender.test.ts` so that file's delegation, guard and
 * activation-gate tests run on a bare `npm test`: WR-09 refuses any suite that
 * reaches for hosted credentials, and `helpers/seed` reaches for them at module
 * scope. The same split 04-02 made between `clicksend-inbound-route.test.ts`
 * (pure) and `inbound-threading.test.ts` (remote).
 *
 * ── WHY ASSERTION 1 HAS TO BE REAL ─────────────────────────────────────────
 *
 * `dispatch.ts` writes `send_ledger.sender` at CLAIM time, before the send runs.
 * With a routing composite that silently became `'routing'` — a provider that
 * does not exist — on the column Phase 7 excludes stub rows by when computing
 * recovered revenue. Every pure test in the sibling file passes either way. Only
 * a row read back out of the database can fail on it.
 *
 * ── WHY ASSERTION 3 HAS TO BE REAL ─────────────────────────────────────────
 *
 * The CR-01 defect was that `buildRoutingSender` gated on the GLOBAL row alone,
 * so enabling ONE client's `messaging_config` row — the whole reason this is a
 * table and not an env var — produced `StubSender` silently while the console
 * said "Email is on for this client." Every pure test passed either way: the
 * gate takes a boolean and the resolvers take a tenant id, and nothing that
 * mocks both can fail on the two disagreeing. Only a real tenant-override row,
 * read back through the real deployment-level activation read and the real
 * `resolveEmailIdentity`, can. (That repository function's literal spelling is
 * avoided throughout this file, prose included: it is grepped for, and a
 * history note is not an assertion.)
 *
 * ── THIS SUITE RUNS AGAINST PRODUCTION DATA, SO IT WRITES ALMOST NOTHING ────
 *
 * `messaging_config` is the switch that turns real customer messaging on with no
 * deploy (D-04). An enabled global `sms` row left behind by an interrupted run
 * would arm the whole system. So: THE SHARED ROW IS NEVER WRITTEN, the sms rows
 * this suite writes are its own tenant's and are `enabled = false` by
 * construction (`seedMessagingConfigOverride` throws on `enabled: true`), and
 * every row it writes is deleted BY ID in `afterAll` — a global row carries no
 * tenant and `teardownTenants` cannot reach it (the rule 04-01 established for
 * unattributed `inbound_messages` rows).
 *
 * ONE of those rows is `enabled: true`, and that is deliberate: it is what
 * assertion 3 is about. It is bounded four ways. It is TENANT-SCOPED to a
 * throwaway tenant this suite seeded seconds earlier, which has no quotes, no
 * cadences and no touches, so no tick could find anything of its to send. Its
 * identity is complete but fictional (`example.test`), so a send that somehow
 * happened would reach nobody. NOTHING IS EVER SENT — the `ResendSender` is
 * constructed and never invoked; there is no `.send(` in the block. And the
 * deployed pg_cron ticks are PAUSED for the duration of any `test:remote` run
 * (`tests/helpers/global-setup.ts`), so the seconds in which email is armed for
 * this one fictional tenant are seconds no production tick is running in.
 *
 * Every phone number is from the `0491 570 1xx` block ACMA reserves for fiction:
 * this suite runs a REAL dispatch tick, and a live number in a fixture is a live
 * number that eventually receives something.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { dispatchDueTouches } from '../src/core/cadence/dispatch';
import { StubSender } from '../src/core/cadence/sender';
import { isInsideWindow, type ContactWindow } from '../src/core/cadence/window';
import {
  buildRoutingSender,
  resolveEmailIdentity,
  resolveSmsFrom,
  RoutingSender,
} from '../src/core/messaging/routing-sender';
import { closeDb, getChannelConfig, upsertChannelConfig } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedMessagingConfigOverride,
  seedQuotes,
  seedTenant,
  seedApprovedDraft,
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

/** The first whole hour after `from` at which the window is OPEN. */
function firstOpenHour(from: number): Date {
  for (let step = 1; step <= 24 * 14; step += 1) {
    const candidate = new Date(from + step * 3_600_000);
    if (isInsideWindow(candidate, WINDOW)) return candidate;
  }
  throw new Error('No in-window hour within a fortnight.');
}

/**
 * THE TEST VERIFICATION GAP 2 NAMES. One client armed, every other refused.
 *
 * FIRST IN THE FILE, AND SCOPED TO ITS OWN HOOKS, so the enabled row exists only
 * between this block's `beforeAll` and its `afterAll` — the per-tenant refusal
 * assertion below therefore runs against a database this block has already
 * cleaned up after.
 *
 * The deployed pg_cron ticks are paused for the whole `test:remote` run
 * (`tests/helpers/global-setup.ts`), so the transiently-armed email gate can be
 * seen by no production tick. Nothing here sends: `buildRoutingSender` builds a
 * `ResendSender`, and the assertion is about which object was built.
 */
describe('one client armed, every other refused — the D-04 rollout (CR-01)', () => {
  /** The tenant whose own `messaging_config` row is switched ON. */
  let armedTenantId: string;
  /** A tenant with NO row of its own — the "every other client" case. */
  let otherTenantId: string;
  const createdConfigIds: string[] = [];

  /**
   * Complete, so `resolveEmailIdentity` never falls back to reading `tenants`,
   * and fictional, so nothing here is an address anybody holds. `.test` is
   * reserved by RFC 2606 for exactly this.
   */
  const IDENTITY = {
    fromAddress: 'followups@quotes.example.test',
    replyTo: 'dana@danaselectrical.example.test',
    businessName: "Dana's Electrical (test)",
  };

  beforeAll(async () => {
    armedTenantId = await seedTenant('Routing Activation Armed');
    otherTenantId = await seedTenant('Routing Activation Other');

    // PRODUCTION'S STATE IS THE PREMISE OF THIS TEST, not an assumption inside
    // it. An ENABLED global email row would arm every client, make the refusal
    // assertion below pass for the wrong reason, and be a much bigger thing to
    // discover than a red test.
    const globalEmail = await getChannelConfig('email');
    expect(
      globalEmail?.enabled ?? false,
      'A global email config row is ENABLED. This test needs the global row ' +
        'absent or disabled — and an enabled one means email is armed for every ' +
        'client right now. Resolve that by hand before re-running.',
    ).toBe(false);

    // NEITHER OF THIS BLOCK'S TENANTS RESOLVES AN EMAIL IDENTITY YET — the
    // premise, asked per tenant. Both were created seconds ago, so an identity
    // here would mean an id was recycled or a row this block failed to delete
    // outlived it (`messaging_config` has no foreign key to `tenants`, so
    // `teardownTenants` cannot sweep one). Either way the assertion below would
    // pass for the wrong reason.
    //
    // It used to ask the DEPLOYMENT-level question — "is any email row enabled
    // anywhere" — which was also a residue alarm for the shared hosted database.
    // Phase 10 arms clients for real, so "no email row is enabled anywhere" is
    // a demand this system is no longer allowed to meet; the per-tenant form is
    // the half that stays true and is the half this block actually needs.
    for (const id of [armedTenantId, otherTenantId]) {
      expect(
        await resolveEmailIdentity(id),
        'A freshly seeded tenant already resolves an email identity. Find its ' +
          'messaging_config row by tenant_id and delete it by id before re-running.',
      ).toBeNull();
    }

    const armedRow = await upsertChannelConfig({
      channel: 'email',
      tenantId: armedTenantId,
      ...IDENTITY,
      enabled: true,
    });
    createdConfigIds.push(armedRow.id);
  });

  afterAll(async () => {
    // BY ID, and BEFORE the tenants go: `teardownTenants` cannot reach
    // `messaging_config`. Runs even when the assertions above failed, which is
    // the point — the enabled row must not outlive this block either way.
    for (const id of createdConfigIds) {
      await admin.from('messaging_config').delete().eq('id', id);
    }
    await teardownTenants([armedTenantId, otherTenantId]);
  });

  it('arms the REAL email delegate from one tenant row, with the global row off', async () => {
    const routing = await buildRoutingSender();

    // THE ASSERTION THE GAP EXISTS FOR. Before the fix this read 'stub': the
    // gate asked the global row, saw it absent/disabled, and wired the stub in
    // for everybody — `sender = 'stub'`, `outcome = 'stub_sent'`, nothing sent,
    // console reporting success. The one-client-at-a-time rollout the
    // `messaging_config` table exists for was unreachable.
    expect(
      routing.providerFor('email'),
      'A tenant messaging_config row with enabled = true did not arm the email ' +
        'delegate. That is CR-01: per-tenant activation is unreachable and the ' +
        'only working switch is the global row, which arms every client at once.',
    ).toBe('resend');

    // ARMING EMAIL MUST NOT ARM SMS. The gate is asked per channel, and the sms
    // row is disarmed (04-07), so this stays the stub — proof the widened gate
    // did not widen anything beyond the channel it was asked about.
    expect(routing.providerFor('sms')).toBe('stub');
  });

  it('activates exactly the tenant whose row it is', async () => {
    // The per-tenant resolver is the identity AUTHORITY: the gate above only
    // decided that a real sender was worth constructing.
    const identity = await resolveEmailIdentity(armedTenantId);

    expect(identity).toEqual(IDENTITY);
  });

  it('REFUSES every other tenant, on the record, while that one client sends', async () => {
    // The other tenant's effective row is the absent/disabled global one, so the
    // resolver returns null and `ResendSender` records `email_not_configured` on
    // the ledger — a refusal a human can read, which is the thing the silent
    // stub never was.
    //
    // This is what keeps the deployment-level gate safe to widen (T-4GC-01): a
    // `true` from the "is this channel armed anywhere" read builds ONE object;
    // it grants nobody an identity.
    const identity = await resolveEmailIdentity(otherTenantId);

    expect(
      identity,
      'A tenant with no messaging_config row of its own resolved an identity. ' +
        'Arming one client would be arming more than one client.',
    ).toBeNull();
  });
});

describe('buildRoutingSender against the hosted database', () => {
  let tenantId: string;
  let cadenceId: string;
  let dueAt: Date;
  const createdConfigIds: string[] = [];

  beforeAll(async () => {
    // Park the shared cadence cursor at the outbox head so this suite's dispatch
    // call does no event consumption it did not ask for.
    const { data } = await admin
      .from('quote_status_events')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    await admin
      .from('event_consumer_cursors')
      .upsert(
        { consumer: CADENCE_CONSUMER, last_event_id: (data?.[0]?.id as number | undefined) ?? 0 },
        { onConflict: 'consumer' },
      );

    tenantId = await seedTenant('Routing Sender');
    await seedConnection(tenantId);

    // THE EXPLICIT OFF OVERRIDE, on both channels, for this suite's own client.
    // Routing reads a per-client `enabled = false` as STOP rather than as "fall
    // back to the shared row", so these two rows are what make the refusal
    // asserted below a fact about THIS tenant — one that survives the morning
    // the founding client's shared sms row is armed. The helper refuses to seed
    // an enabled row at all (04-03), so neither of these can arm anything.
    createdConfigIds.push(await seedMessagingConfigOverride(tenantId, 'sms'));
    createdConfigIds.push(await seedMessagingConfigOverride(tenantId, 'email'));

    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'routing: claim records the delegate', chase_eligibility: 'eligible' },
    ]);

    cadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Robin Vasquez',
      // The ACMA fiction block — this suite dispatches for real, and a live
      // number in a fixture is a live number somebody eventually sends to.
      contact_mobile: '+61491570159',
    });

    dueAt = firstOpenHour(Date.now());
    const [touch] = await seedTouches(cadenceId, tenantId, [
      {
        status: 'approved',
        scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
        original_offset_days: 0,
      },
    ]);

    // 05-01 / D-10: dispatch refuses `no_approved_draft` without this row, so
    // an approved touch alone no longer reaches the sender. This suite is about
    // WHICH SENDER gets invoked and what name lands in the ledger, so the draft
    // is scaffolding — but scaffolding it cannot do without.
    await seedApprovedDraft(tenantId, cadenceId, touch.id, touch.touch_number);
  });

  afterAll(async () => {
    // BY ID. `messaging_config` rows carry no tenant for the global case, so
    // `teardownTenants` cannot reach them — the same rule 04-01 established for
    // unattributed `inbound_messages` rows.
    for (const id of createdConfigIds) {
      await admin.from('messaging_config').delete().eq('id', id);
    }
    await teardownTenants([tenantId]);
    await closeDb();
  });

  it('resolves NO sending identity for a client held explicitly OFF (D-04)', async () => {
    // ── WHAT THIS ASSERTION USED TO BE, AND WHY IT IS NOW PER-TENANT ────────
    //
    // It used to ask the DEPLOYMENT-level question — "is any sms row enabled
    // anywhere" — and require the answer NO: "the deployed system cannot send a
    // real message right now", as a fact about the database. That was the right alarm for as long as the answer was allowed
    // to be no. 04-07 bought the number, armed the row for the live handset
    // test and disarmed it afterwards (which is why it asks `enabled` rather
    // than `EXISTS`); 04-08's CR-01 fix widened the question from the shared
    // row alone to any row, so the alarm would fire the moment ONE client's
    // override armed real SMS.
    //
    // Phase 10 arms the founding client on purpose. From that morning the
    // deployment-level question answers YES — permanently, and correctly — and
    // an assertion that demands NO can only ever be red. A blocking gate that
    // is red for a reason unrelated to the property under test gets re-run
    // until green, which is how a real red eventually gets waved through.
    //
    // THE DEPLOYMENT-LEVEL GUARANTEE NOW LIVES WITH THE CI DATABASE — a stack
    // created and destroyed with the job, where nothing is armed unless a test
    // armed it, and `tests/messaging-config-arming.test.ts` asserts it leaves
    // nothing armed behind — and with the arming audit trail, which records
    // every flip and the hand that made it. It no longer lives here.
    //
    // What survives is the question that stays meaningful after go-live: is
    // THIS client armed? The answer is no because of two explicit `enabled =
    // false` rows this suite seeded for its own tenant — routing reads a
    // per-client OFF as STOP, never as "fall back to the shared row" — so it
    // stays no whatever the shared number is doing for everybody else.
    expect(
      await resolveSmsFrom(tenantId),
      'A tenant with an explicit enabled = false sms row resolved a number. An ' +
        'override that falls back to the shared row is a client who cannot be ' +
        'held off while the rest of the cohort sends.',
    ).toBeNull();

    expect(
      await resolveEmailIdentity(tenantId),
      'A tenant with an explicit enabled = false email row resolved an identity.',
    ).toBeNull();
  });

  it('prefers a tenant override row over the global default', async () => {
    // CHANNEL 'email', enabled FALSE, no from-address — provably inert. An sms
    // row here would be the live activation switch, and a global one at that.
    const existing = await getChannelConfig('email');
    expect(
      existing,
      'A global email config row already exists. This test would overwrite and ' +
        'then DELETE it. Resolve by hand rather than letting the suite proceed.',
    ).toBeNull();

    const globalRow = await upsertChannelConfig({
      channel: 'email',
      tenantId: null,
      businessName: 'GLOBAL (test)',
      enabled: false,
    });
    createdConfigIds.push(globalRow.id);

    const tenantRow = await upsertChannelConfig({
      channel: 'email',
      tenantId,
      businessName: 'OVERRIDE (test)',
      enabled: false,
    });
    createdConfigIds.push(tenantRow.id);

    // The override wins for the tenant that has one...
    const resolved = await getChannelConfig('email', tenantId);
    expect(resolved?.id).toBe(tenantRow.id);
    expect(resolved?.businessName).toBe('OVERRIDE (test)');

    // ...and the global row is still what everybody else gets. Asserted because
    // an ORDER BY that sorted the wrong way would satisfy the first assertion
    // for a tenant and quietly hand every OTHER tenant that tenant's identity.
    const other = await getChannelConfig('email', '00000000-0000-4000-8000-000000000000');
    expect(other?.id).toBe(globalRow.id);
    expect((await getChannelConfig('email'))?.id).toBe(globalRow.id);
  });

  it('claims the ledger under the DELEGATE name, never the composite (T-4-11)', async () => {
    const routing = new RoutingSender({ sms: new StubSender(), email: new StubSender() });

    const result = await dispatchDueTouches({ sender: routing, now: dueAt });
    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    const { data, error } = await admin
      .from('send_ledger')
      .select('sender,outcome,channel,provider_message_id')
      .eq('cadence_id', cadenceId);
    if (error) throw new Error(`Reading the ledger failed: ${error.message}`);

    expect(data).toHaveLength(1);
    const [row] = data as { sender: string; outcome: string; channel: string }[];

    // THE ASSERTION THIS WHOLE FILE EXISTS FOR. Before the wiring fix this read
    // 'routing' — a provider that does not exist, on the column Phase 7
    // excludes stub rows by.
    expect(
      row.sender,
      "The claim recorded the composite's own label instead of the delegate's. " +
        'Phase 7 excludes stub rows from recovered-revenue attribution on this ' +
        'column, and no real provider is called "routing".',
    ).toBe('stub');
    expect(row.channel).toBe('sms');

    // And the outcome side agrees, because RoutingSender returns the delegate's
    // outcome unchanged and `performSends` reads `outcome.provider`.
    expect(row.outcome).toBe('stub_sent');
  });
});
