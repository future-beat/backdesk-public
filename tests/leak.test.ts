/**
 * ONB-05: the two-tenant leak test. CI-blocking.
 *
 * Two halves, because the product has two data paths and each has its own
 * failure mode (01-RESEARCH.md Pitfall 2 — test the real code path, not a
 * stand-in):
 *
 *   RLS half        — the console path. The operator holds an anon-key JWT and
 *                     Postgres policies decide what exists.
 *   Repository half — the worker path. `DATABASE_URL` is a service-role-
 *                     equivalent login that BYPASSES RLS entirely, so the only
 *                     guard is the `forTenant()` closure. This half is the one
 *                     that fails if someone writes a raw query in Phase 3.
 *
 * The fixture is deliberately adversarial: tenants A and B are identical except
 * for their names, so nothing but the uuid can be doing the isolating.
 */
import { randomUUID } from 'node:crypto';

import { type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, forTenant } from '../src/db/repository';

import {
  admin,
  nextSeededEventId,
  seedConnection,
  seedQuotes,
  seedTwoTenants,
  signInAsOperator,
  teardownTenants,
  type TwoTenants,
} from './helpers/seed';

let seeded: TwoTenants;
let operator: SupabaseClient;

/** A value unique to tenant B, searched for in every serialised response. */
const B_MARKER = `B-ONLY-${randomUUID()}`;

/**
 * Tenant B's suppressed mobile — a real customer's phone number, in the table
 * whose whole purpose is remembering that this person asked to be left alone.
 * Searched for by value in every cadence-table response.
 */
const B_SUPPRESSED_MOBILE = `+6149${Math.floor(Math.random() * 1e6)
  .toString()
  .padStart(6, '0')}`;

/** The cadence rows seeded for each tenant, so assertions can name their ids. */
let cadenceA: string;
let cadenceB: string;

/**
 * Seed one live cadence with one scheduled touch and one ledger row.
 *
 * Written inline with the admin client rather than through a helper because the
 * fixture IS the experiment here (see the file header): A and B get byte-
 * identical shapes apart from the marker values, so nothing but the tenant uuid
 * can be doing the isolating.
 */
async function seedCadenceFixture(
  tenantId: string,
  quoteId: string,
  contactName: string,
  contactMobile: string,
): Promise<string> {
  const { data, error } = await admin
    .from('cadences')
    .insert({
      tenant_id: tenantId,
      quote_id: quoteId,
      sm8_job_uuid: randomUUID(),
      status: 'active',
      anchor_at: new Date().toISOString(),
      // The one field A and B cannot share: `cadences_one_per_opened_event` is
      // global, and migration 0023 requires the key on every new row. Both
      // values are synthetic negatives, so neither carries meaning the
      // experiment could accidentally rest on.
      created_by_event_id: nextSeededEventId(),
      contact_name: contactName,
      contact_mobile: contactMobile,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Seeding a cadence failed: ${error.message}`);

  const cadenceId = (data as { id: string }).id;

  const touch = await admin.from('cadence_touches').insert({
    tenant_id: tenantId,
    cadence_id: cadenceId,
    touch_number: 1,
    channel: 'sms',
    status: 'scheduled',
    scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
    original_offset_days: 0,
  });
  if (touch.error) throw new Error(`Seeding a touch failed: ${touch.error.message}`);

  const ledger = await admin.from('send_ledger').insert({
    tenant_id: tenantId,
    cadence_id: cadenceId,
    quote_id: quoteId,
    touch_number: 1,
    channel: 'sms',
    to_address: contactMobile,
    sender: 'stub',
    outcome: 'stub_sent',
  });
  if (ledger.error) throw new Error(`Seeding a ledger row failed: ${ledger.error.message}`);

  return cadenceId;
}

beforeAll(async () => {
  seeded = await seedTwoTenants();

  // Both tenants get a connection and quotes, so the ServiceM8 tables are held
  // to the same standard as `tenants`: identical data on both sides, nothing
  // but the uuid doing the isolating.
  const [, , quotesA, quotesB] = await Promise.all([
    seedConnection(seeded.tenantA, { key_last4: '1111' }),
    seedConnection(seeded.tenantB, { key_last4: '2222' }),
    seedQuotes(seeded.tenantA, [{ job_description: 'A-only work' }]),
    seedQuotes(seeded.tenantB, [{ job_description: B_MARKER }]),
  ]);

  // The Phase 3 tables get the same adversarial treatment, and they raise the
  // stakes: `cadences` and `send_ledger` carry a customer's NAME and PHONE
  // NUMBER alongside the record of what we sent them, and `suppressed_contacts`
  // is a list of people who asked a specific tradie to stop contacting them —
  // which leaks the complaint itself, not merely a contact detail.
  [cadenceA, cadenceB] = await Promise.all([
    seedCadenceFixture(seeded.tenantA, quotesA[0].id, 'A Customer', '+61400111222'),
    seedCadenceFixture(seeded.tenantB, quotesB[0].id, B_MARKER, B_SUPPRESSED_MOBILE),
  ]);

  const suppression = await admin.from('suppressed_contacts').insert([
    {
      tenant_id: seeded.tenantA,
      channel: 'sms',
      address: '+61400111222',
      reason: 'A-only suppression',
      source: 'operator_kill',
    },
    {
      tenant_id: seeded.tenantB,
      channel: 'sms',
      address: B_SUPPRESSED_MOBILE,
      reason: B_MARKER,
      source: 'operator_kill',
    },
  ]);
  if (suppression.error) {
    throw new Error(`Seeding suppression failed: ${suppression.error.message}`);
  }

  operator = await signInAsOperator();
});

afterAll(async () => {
  await teardownTenants([seeded.tenantA, seeded.tenantB]);
  await closeDb();
});

describe('RLS half — the console path (operator holds an anon-key JWT)', () => {
  it('shows the operator tenant A and never tenant B', async () => {
    const { data, error } = await operator.from('tenants').select('id,name');

    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);

    expect(ids).toContain(seeded.tenantA);
    expect(ids).not.toContain(seeded.tenantB);
    expect(JSON.stringify(data)).not.toContain(seeded.nameB);
  });

  it('grants visibility through membership and nothing else', async () => {
    // The general form of the assertion above: the set of tenants the operator
    // can see is EXACTLY the set they hold a membership row for. This keeps
    // holding after the operator onboards real clients, which a bare
    // "sees only tenant A" assertion would not.
    const [tenantRows, memberRows] = await Promise.all([
      operator.from('tenants').select('id'),
      operator.from('tenant_members').select('tenant_id'),
    ]);

    expect(tenantRows.error).toBeNull();
    expect(memberRows.error).toBeNull();

    const visible = (tenantRows.data ?? []).map((r) => r.id).sort();
    const member = (memberRows.data ?? []).map((r) => r.tenant_id).sort();

    expect(visible).toEqual(member);
    expect(member).not.toContain(seeded.tenantB);
  });

  it('returns only the operator’s own membership rows', async () => {
    const { data, error } = await operator.from('tenant_members').select('tenant_id,user_id');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.user_id).toBe(seeded.operatorId);
    }
  });

  // The assertions above are about what the operator can SEE. These are about
  // what the operator can DO (WR-04) — the policy is FOR ALL with a WITH CHECK
  // and 0003 really does grant UPDATE and DELETE to `authenticated`, so this is
  // a live write surface, not a hypothetical one.
  //
  // Note the deliberate use of a VALID status below: 'paused' is in the
  // tenants_status_known vocabulary, so a rejection here can only be RLS. A junk
  // value like 'hijacked' would be refused by the CHECK constraint added in 0004
  // and the test would pass without ever exercising the policy.
  it('cannot write to a tenant it is not a member of', async () => {
    const { data, error } = await operator
      .from('tenants')
      .update({ status: 'paused' })
      .eq('id', seeded.tenantB)
      .select();

    // RLS filters the row out rather than erroring, so the correct outcome is
    // zero rows affected — denial and absence stay indistinguishable (T-03-02).
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    const { data: row } = await admin
      .from('tenants')
      .select('status')
      .eq('id', seeded.tenantB)
      .single();
    expect(row!.status).toBe('onboarding');
  });

  it('cannot enrol itself in another tenant', async () => {
    // THE escalation move: if this ever succeeds the attacker grants themselves
    // full access to tenant B and every other assertion in this file goes green
    // anyway. It is blocked today only by the ABSENCE of a GRANT INSERT — i.e.
    // by something not written down — so it needs a test that would notice a
    // future "grant everything to authenticated" convenience migration.
    const { error } = await operator
      .from('tenant_members')
      .insert({ tenant_id: seeded.tenantB, user_id: seeded.operatorId });

    expect(error).not.toBeNull();

    const { data } = await admin
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', seeded.tenantB);
    expect(data).toEqual([]);
  });

  it('cannot delete a tenant it is not a member of', async () => {
    // DELETE cascades to tenant_members, so an unscoped delete is destructive
    // well beyond the one row it names.
    const { data, error } = await operator
      .from('tenants')
      .delete()
      .eq('id', seeded.tenantB)
      .select();

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    const { data: row } = await admin
      .from('tenants')
      .select('id,name')
      .eq('id', seeded.tenantB)
      .maybeSingle();
    expect(row).not.toBeNull();
    expect(row!.name).toBe(seeded.nameB);
  });

  it('cannot repoint its own membership row at another tenant', async () => {
    // The subtler form of self-enrolment: no INSERT needed if UPDATE is open.
    //
    // Two legitimate denial shapes, and the test accepts either: 42501 when the
    // UPDATE privilege is absent (the posture 0005 enforces), or zero rows when
    // the privilege exists but no UPDATE policy makes any row visible. What must
    // hold in BOTH cases is the invariant asserted below — no membership in B.
    const { error, data } = await operator
      .from('tenant_members')
      .update({ tenant_id: seeded.tenantB })
      .eq('user_id', seeded.operatorId)
      .select();

    expect(error !== null || (data ?? []).length === 0).toBe(true);

    const { data: rows } = await admin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', seeded.operatorId)
      .eq('tenant_id', seeded.tenantB);
    expect(rows).toEqual([]);
  });

  // --- ONB-05 regression surface for the Phase 2 tables --------------------
  //
  // Two new tenant-scoped tables means two new ways to leak a client's data.
  // `quotes` carries customer addresses and job descriptions; `sm8_connections`
  // carries a credential envelope. Both must behave exactly like `tenants`.

  it('shows the operator tenant A’s connection and never tenant B’s', async () => {
    const { data, error } = await operator
      .from('sm8_connections')
      .select('tenant_id, key_last4');

    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.tenant_id);

    expect(ids).toContain(seeded.tenantA);
    expect(ids).not.toContain(seeded.tenantB);
    // The last4 is the only credential fragment that exists; B's must not appear.
    expect(JSON.stringify(data)).not.toContain('2222');
  });

  it('returns an empty array — not an error — for tenant B’s connection', async () => {
    // Denial and absence must stay indistinguishable (T-03-02). A 42501 here
    // would confirm to an attacker that tenant B exists.
    const { data, error } = await operator
      .from('sm8_connections')
      .select('tenant_id')
      .eq('tenant_id', seeded.tenantB);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('shows the operator tenant A’s quotes and never tenant B’s', async () => {
    const { data, error } = await operator.from('quotes').select('tenant_id, job_description');

    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.tenant_id);

    expect(ids).toContain(seeded.tenantA);
    expect(ids).not.toContain(seeded.tenantB);
    expect(JSON.stringify(data)).not.toContain(B_MARKER);
  });

  it('returns an empty array — not an error — for tenant B’s quotes', async () => {
    const { data, error } = await operator
      .from('quotes')
      .select('id')
      .eq('tenant_id', seeded.tenantB);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('cannot modify tenant B’s connection or quotes', async () => {
    // `authenticated` genuinely holds UPDATE on both tables (0007), so this is a
    // live write surface. RLS filters the rows out rather than erroring, so the
    // correct outcome is zero rows affected.
    const [conn, quote] = await Promise.all([
      operator
        .from('sm8_connections')
        .update({ key_last4: '6666' })
        .eq('tenant_id', seeded.tenantB)
        .select(),
      operator
        .from('quotes')
        .update({ chase_eligibility: 'eligible' })
        .eq('tenant_id', seeded.tenantB)
        .select(),
    ]);

    expect(conn.error).toBeNull();
    expect(conn.data ?? []).toEqual([]);
    expect(quote.error).toBeNull();
    expect(quote.data ?? []).toEqual([]);

    // Prove the stored state is untouched, read with no scoping of its own.
    const [{ data: connRow }, { data: quoteRows }] = await Promise.all([
      admin.from('sm8_connections').select('key_last4').eq('tenant_id', seeded.tenantB).single(),
      admin.from('quotes').select('chase_eligibility').eq('tenant_id', seeded.tenantB),
    ]);
    expect(connRow!.key_last4).toBe('2222');
    for (const row of quoteRows!) expect(row.chase_eligibility).toBe('needs_review');
  });

  it('cannot attach a ServiceM8 connection to a tenant it does not belong to', async () => {
    // THE escalation on these tables: writing a connection row for tenant B
    // pointed at an attacker-controlled key would redirect that client's sync.
    // Blocked today by the absence of GRANT INSERT — i.e. by something not
    // written down — so it needs a test that notices a future convenience grant.
    const { error } = await operator.from('sm8_connections').insert({
      tenant_id: seeded.tenantB,
      api_key_ciphertext: 'enc:v1:AAAA:BBBB:CCCC',
      key_last4: '6666',
    });

    expect(error).not.toBeNull();

    const { data } = await admin
      .from('sm8_connections')
      .select('key_last4')
      .eq('tenant_id', seeded.tenantB);
    expect(data).toHaveLength(1);
    expect(data![0].key_last4).toBe('2222');
  });

  it('cannot invent a quote row for another tenant', async () => {
    const { error } = await operator.from('quotes').insert({
      tenant_id: seeded.tenantB,
      sm8_job_uuid: randomUUID(),
      status: 'Quote',
      edit_date_raw: '2026-08-26 09:00:00',
      sync_source: 'backfill',
    });

    expect(error).not.toBeNull();

    const { data } = await admin.from('quotes').select('id').eq('tenant_id', seeded.tenantB);
    expect(data).toHaveLength(1);
  });

  // --- ONB-05 regression surface for the Phase 3 cadence tables -------------
  //
  // Six new tenant-scoped tables means six new ways to leak a client's data,
  // and this set is worse than the Phase 2 set. `cadences` holds the customer's
  // name and mobile; `send_ledger` is the record of exactly what was sent to
  // exactly whom and when; `suppressed_contacts` is a list of the people who
  // asked THAT TRADIE to stop contacting them — leaking it discloses the
  // complaint, not just the phone number.

  it('shows the operator tenant A’s cadences and never tenant B’s', async () => {
    const { data, error } = await operator
      .from('cadences')
      .select('id, tenant_id, contact_name, contact_mobile');

    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);

    expect(ids).toContain(cadenceA);
    expect(ids).not.toContain(cadenceB);
    expect(JSON.stringify(data)).not.toContain(B_MARKER);
    expect(JSON.stringify(data)).not.toContain(B_SUPPRESSED_MOBILE);
  });

  it('shows the operator only cadence data for tenants they are a member of', async () => {
    // ── WHY THIS ASKS MEMBERSHIP AND NOT `=== tenantA` ───────────────────────
    //
    // It used to assert every visible row belonged to `seeded.tenantA`, which
    // silently assumed the operator belongs to exactly ONE tenant — true only
    // while the database held nothing but this file's own seeds. The first live
    // messaging test (04-07) created a real tenant the operator is genuinely a
    // member of, and the assertion failed on a row RLS was right to return.
    //
    // The general form is the one the tenants-visibility test above already
    // uses, and it is STRONGER, not weaker: a row from a tenant the operator
    // does not hold a membership for still fails, including a hypothetical
    // third tenant that `not.toBe(tenantB)` would have waved through.
    const [touches, ledger, suppression, templates, settings, memberships] = await Promise.all([
      operator.from('cadence_touches').select('tenant_id, cadence_id'),
      operator.from('send_ledger').select('tenant_id, cadence_id, to_address'),
      operator.from('suppressed_contacts').select('tenant_id, address, reason'),
      operator.from('cadence_touch_templates').select('tenant_id'),
      operator.from('cadence_settings').select('tenant_id'),
      operator.from('tenant_members').select('tenant_id'),
    ]);

    expect(memberships.error).toBeNull();
    const memberOf = (memberships.data ?? []).map((r) => r.tenant_id);
    // The seeded membership must be among them, or the loop below is vacuous.
    expect(memberOf).toContain(seeded.tenantA);
    expect(memberOf).not.toContain(seeded.tenantB);

    for (const [name, result] of [
      ['cadence_touches', touches],
      ['send_ledger', ledger],
      ['suppressed_contacts', suppression],
      ['cadence_touch_templates', templates],
      ['cadence_settings', settings],
    ] as const) {
      expect(result.error, `${name} errored instead of filtering`).toBeNull();

      for (const row of result.data ?? []) {
        expect(
          memberOf,
          `${name} returned a row for a tenant the operator is not a member of`,
        ).toContain(row.tenant_id);
      }

      const serialised = JSON.stringify(result.data);
      expect(serialised, `${name} leaked tenant B's marker`).not.toContain(B_MARKER);
      expect(serialised, `${name} leaked tenant B's cadence id`).not.toContain(cadenceB);
      expect(
        serialised,
        `${name} leaked a suppressed customer's number from another client`,
      ).not.toContain(B_SUPPRESSED_MOBILE);
    }
  });

  it('returns an empty array — not an error — for tenant B’s cadence data', async () => {
    // Denial and absence must stay indistinguishable (T-03-02, T-3-01). A 42501
    // here would confirm to an attacker that tenant B has cadences at all.
    for (const table of [
      'cadences',
      'cadence_touches',
      'send_ledger',
      'suppressed_contacts',
      'cadence_touch_templates',
      'cadence_settings',
    ]) {
      const { data, error } = await operator
        .from(table)
        .select('tenant_id')
        .eq('tenant_id', seeded.tenantB);

      expect(error, `${table} errored instead of returning []`).toBeNull();
      expect(data, `${table} leaked rows for tenant B`).toEqual([]);
    }
  });

  it('cannot write to any cadence table at all — not even its own (WR-01)', async () => {
    // Unlike `quotes`, `authenticated` holds NO write grant on these six (0017).
    // Every D-16 control is a server action that authorizes with this JWT and
    // then writes through the service-role repository, because each is a
    // multi-table transaction. So the correct outcome here is an ERROR from the
    // missing privilege, for tenant A's OWN rows — a scoped write that succeeds
    // would mean a caller could stop a cadence without skipping its touches.
    const attempts = await Promise.all([
      operator.from('cadences').update({ status: 'stopped' }).eq('id', cadenceA).select(),
      operator
        .from('cadence_touches')
        .update({ scheduled_at: new Date().toISOString() })
        .eq('tenant_id', seeded.tenantA)
        .select(),
      operator
        .from('cadence_settings')
        .update({ paused_at: null })
        .eq('tenant_id', seeded.tenantA)
        .select(),
    ]);

    for (const attempt of attempts) {
      expect(attempt.error !== null || (attempt.data ?? []).length === 0).toBe(true);
    }

    const { data: row } = await admin
      .from('cadences')
      .select('status')
      .eq('id', cadenceA)
      .single();
    expect(row!.status, 'a console UPDATE changed cadence state directly').toBe('active');
  });

  it('cannot un-suppress a contact, its own or anyone else’s (T-3-02)', async () => {
    // THE one-way guarantee, exercised rather than assumed. D-06 makes the
    // per-contact kill terminal BY DESIGN — the suppression entry is the Spam
    // Act safety mechanism, and a delete path re-arms the cadence against
    // somebody who complained. It is blocked today only by the ABSENCE of a
    // GRANT, i.e. by something not written down, which is exactly the kind of
    // guarantee that needs a test.
    const [ownDelete, foreignDelete] = await Promise.all([
      operator
        .from('suppressed_contacts')
        .delete()
        .eq('tenant_id', seeded.tenantA)
        .select(),
      operator
        .from('suppressed_contacts')
        .delete()
        .eq('tenant_id', seeded.tenantB)
        .select(),
    ]);

    expect(ownDelete.error !== null || (ownDelete.data ?? []).length === 0).toBe(true);
    expect(foreignDelete.error !== null || (foreignDelete.data ?? []).length === 0).toBe(
      true,
    );

    const { data } = await admin
      .from('suppressed_contacts')
      .select('address')
      .in('tenant_id', [seeded.tenantA, seeded.tenantB]);
    expect(
      data,
      'a suppression row disappeared — "never chase again" must mean never',
    ).toHaveLength(2);
  });

  it('cannot invent a cadence or a send-ledger row for another tenant', async () => {
    // The escalation on these tables: a fabricated `cadences` row is a chase
    // against a customer the client never quoted, and a fabricated `send_ledger`
    // row is an invoice line Phase 7 bills for a message nobody sent.
    const [cadence, ledger] = await Promise.all([
      operator.from('cadences').insert({
        tenant_id: seeded.tenantB,
        quote_id: randomUUID(),
        sm8_job_uuid: randomUUID(),
        anchor_at: new Date().toISOString(),
        // Supplied so RLS is the ONLY thing that can refuse this row. Without
        // it, migration 0023's `cadences_replay_key_present` would also reject
        // the insert, and the assertion below would pass for a reason that has
        // nothing to do with tenant isolation.
        created_by_event_id: nextSeededEventId(),
      }),
      operator.from('send_ledger').insert({
        tenant_id: seeded.tenantB,
        cadence_id: cadenceB,
        quote_id: randomUUID(),
        touch_number: 9,
        channel: 'sms',
        to_address: '+61400999888',
        sender: 'stub',
      }),
    ]);

    expect(cadence.error).not.toBeNull();
    expect(ledger.error).not.toBeNull();

    const { data } = await admin
      .from('cadences')
      .select('id')
      .eq('tenant_id', seeded.tenantB);
    expect(data).toHaveLength(1);
  });

  it('returns nothing at all to a caller with no session', async () => {
    // Fresh anon client, never signed in. Not an error — absence and denial are
    // indistinguishable, which is the point.
    const { createClient } = await import('@supabase/supabase-js');
    const { testEnv } = await import('./helpers/env');
    const anon = createClient(testEnv.url, testEnv.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await anon.from('tenants').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    // The same must hold for the Phase 2 and Phase 3 tables — an unauthenticated
    // read of a credential table (or of a suppression list) returning 42501
    // would confirm the table exists.
    for (const table of [
      'sm8_connections',
      'quotes',
      'cadences',
      'cadence_touches',
      'send_ledger',
      'suppressed_contacts',
      'cadence_touch_templates',
      'cadence_settings',
    ]) {
      const result = await anon.from(table).select('tenant_id');
      expect(result.error, `${table} errored instead of returning []`).toBeNull();
      expect(result.data, `${table} leaked rows to anon`).toEqual([]);
    }
  });
});

describe('repository half — the worker path (service role, RLS bypassed)', () => {
  it('cannot emit tenant B data even though tenant B exists', async () => {
    const rows = await forTenant(seeded.tenantA).tenant.get();
    const serialised = JSON.stringify(rows);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(seeded.tenantA);
    expect(serialised).not.toContain(seeded.tenantB);
    expect(serialised).not.toContain(seeded.nameB);
  });

  it('keeps two identical-profile tenants apart (adjacency edge)', async () => {
    // A and B differ only by name and uuid. If anything but the uuid were doing
    // the scoping, this would return two rows.
    const a = await forTenant(seeded.tenantA).tenant.get();
    const b = await forTenant(seeded.tenantB).tenant.get();

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].name).toBe(seeded.nameA);
    expect(b[0].name).toBe(seeded.nameB);
    expect(a[0].tradeType).toBe(b[0].tradeType);
    expect(a[0].timezone).toBe(b[0].timezone);
    expect(a[0].contactDays).toEqual(b[0].contactDays);
  });

  it('returns an empty array for a tenant with no rows — never null, never a throw (empty edge)', async () => {
    const rows = await forTenant(randomUUID()).tenant.get();

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toEqual([]);
  });

  it('scopes writes as tightly as reads', async () => {
    const updated = await forTenant(seeded.tenantA).tenant.update({ status: 'active' });

    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(seeded.tenantA);
    expect(updated[0].status).toBe('active');

    // Read B back through the service-role client — a path with no scoping of
    // its own, so this observes the true stored state.
    const { data: rowB, error } = await admin
      .from('tenants')
      .select('id,status')
      .eq('id', seeded.tenantB)
      .single();

    expect(error).toBeNull();
    expect(rowB!.status).toBe('onboarding');
  });

  it('refuses a tenant id that is not a uuid rather than guessing', async () => {
    expect(() => forTenant('' as string)).toThrow(/tenant uuid/);
    expect(() => forTenant(undefined as unknown as string)).toThrow(/tenant uuid/);
  });

  it('refuses to repoint a row at another tenant through the patch object (WR-02)', async () => {
    // The escalation this guards: `TenantPatch` erases at compile time, so a
    // patch that arrives as parsed JSON can carry an `id` drizzle will happily
    // map to a column — `UPDATE tenants SET id = B WHERE id = A` moves the row.
    expect(() =>
      forTenant(seeded.tenantA).tenant.update({ id: seeded.tenantB } as never),
    ).toThrow(/cannot patch id/);

    // Mixing the illegal key in with a legitimate one must not sneak it past.
    expect(() =>
      forTenant(seeded.tenantA).tenant.update({
        status: 'active',
        id: seeded.tenantB,
      } as never),
    ).toThrow(/cannot patch id/);

    expect(() =>
      forTenant(seeded.tenantA).tenant.update({ createdAt: new Date() } as never),
    ).toThrow(/cannot patch createdAt/);

    // Prove nothing moved: both rows still exist under their original ids, read
    // through the service-role client which has no scoping of its own.
    const { data, error } = await admin
      .from('tenants')
      .select('id,name')
      .in('id', [seeded.tenantA, seeded.tenantB]);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.find((r) => r.id === seeded.tenantA)!.name).toBe(seeded.nameA);
    expect(data!.find((r) => r.id === seeded.tenantB)!.name).toBe(seeded.nameB);
  });

  it('scopes the connection namespace to the closed-over tenant', async () => {
    // The worker path is where a forgotten `where` leaks a CREDENTIAL rather
    // than a business name, so it gets the same adversarial treatment.
    const a = await forTenant(seeded.tenantA).connection.get();
    const b = await forTenant(seeded.tenantB).connection.get();

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].keyLast4).toBe('1111');
    expect(b[0].keyLast4).toBe('2222');
    expect(JSON.stringify(a)).not.toContain('2222');
    expect(JSON.stringify(a)).not.toContain(seeded.tenantB);
  });

  it('scopes the quotes namespace to the closed-over tenant', async () => {
    const a = await forTenant(seeded.tenantA).quotes.list();
    const serialised = JSON.stringify(a);

    expect(a.length).toBeGreaterThan(0);
    for (const row of a) expect(row.tenantId).toBe(seeded.tenantA);
    expect(serialised).not.toContain(B_MARKER);
    expect(serialised).not.toContain(seeded.tenantB);
  });

  it('scopes the open-quotes read as tightly as the full list', async () => {
    const open = await forTenant(seeded.tenantA).quotes.listOpen();
    for (const row of open) {
      expect(row.tenantId).toBe(seeded.tenantA);
      expect(row.status).toBe('Quote');
    }
    expect(JSON.stringify(open)).not.toContain(B_MARKER);
  });

  it('returns empty arrays for a tenant with no ServiceM8 data', async () => {
    const repo = forTenant(randomUUID());

    expect(await repo.connection.get()).toEqual([]);
    expect(await repo.quotes.list()).toEqual([]);
    expect(await repo.quotes.listOpen()).toEqual([]);
  });

  it('writes quotes only under the closed-over tenant', async () => {
    const before = await forTenant(seeded.tenantB).quotes.list();

    const written = await forTenant(seeded.tenantA).quotes.upsertMany([
      {
        sm8JobUuid: randomUUID(),
        status: 'Completed',
        editDateRaw: '2026-08-27 10:00:00',
        syncSource: 'poll',
      },
    ]);
    expect(written).toBe(1);

    // Tenant B is untouched — there is no query surface here that is not
    // already scoped, so this is asserting the closure, not a `where` clause.
    const after = await forTenant(seeded.tenantB).quotes.list();
    expect(after).toHaveLength(before.length);
  });

  it('upserts rather than duplicating on (tenant_id, sm8_job_uuid)', async () => {
    const jobUuid = randomUUID();
    const repo = forTenant(seeded.tenantA);
    const row = {
      sm8JobUuid: jobUuid,
      status: 'Quote' as const,
      editDateRaw: '2026-08-27 11:00:00',
      syncSource: 'backfill' as const,
    };

    await repo.quotes.upsertMany([row]);
    await repo.quotes.upsertMany([{ ...row, status: 'Work Order', editDateRaw: '2026-08-27 12:00:00' }]);

    const matches = (await repo.quotes.list()).filter((q) => q.sm8JobUuid === jobUuid);
    expect(matches, 'the overlap re-fetch must update, never duplicate').toHaveLength(1);
    expect(matches[0].status).toBe('Work Order');
    expect(matches[0].editDateRaw).toBe('2026-08-27 12:00:00');
  });

  it('never reverts an operator’s chase_eligibility decision on re-sync', async () => {
    const jobUuid = randomUUID();
    const repo = forTenant(seeded.tenantA);
    const row = {
      sm8JobUuid: jobUuid,
      status: 'Quote' as const,
      editDateRaw: '2026-08-27 13:00:00',
      syncSource: 'backfill' as const,
    };

    await repo.quotes.upsertMany([row]);

    // The operator triages it into eligibility.
    const [seededRow] = (await repo.quotes.list()).filter((q) => q.sm8JobUuid === jobUuid);
    await admin.from('quotes').update({ chase_eligibility: 'eligible' }).eq('id', seededRow.id);

    // A later sync touches the same job and tries to write needs_review again.
    await repo.quotes.upsertMany([{ ...row, chaseEligibility: 'needs_review' }]);

    const [after] = (await repo.quotes.list()).filter((q) => q.sm8JobUuid === jobUuid);
    expect(
      after.chaseEligibility,
      'chase_eligibility holds a HUMAN decision — a sync must not overwrite it',
    ).toBe('eligible');
  });

  it('rolls back the whole transaction when any part fails', async () => {
    const repo = forTenant(seeded.tenantA);
    const before = (await repo.quotes.list()).length;

    // A connection row plus a quote with an invalid status: the CHECK
    // constraint rejects the quote, and the connection write must go with it.
    // A connection stored without its quotes is the state that makes an
    // operator believe the backfill ran.
    await expect(
      repo.transaction(async (tx) => {
        await tx.connection.upsert({
          apiKeyCiphertext: 'enc:v1:AAAA:BBBB:DDDD',
          keyLast4: '7777',
        });
        await tx.quotes.upsertMany([
          {
            sm8JobUuid: randomUUID(),
            status: 'NotAStatus',
            editDateRaw: '2026-08-27 14:00:00',
            syncSource: 'backfill',
          },
        ]);
      }),
    ).rejects.toThrow();

    const [connection] = await repo.connection.get();
    expect(connection.keyLast4, 'the connection write must have rolled back').toBe('1111');
    expect((await repo.quotes.list()).length).toBe(before);
  });

  it('refuses an unknown field rather than silently dropping it', async () => {
    // A typo'd key that the driver quietly ignores is a write that reports
    // success and changed nothing.
    expect(() =>
      forTenant(seeded.tenantA).tenant.update({ statuss: 'active' } as never),
    ).toThrow(/unknown field/);
  });
});
