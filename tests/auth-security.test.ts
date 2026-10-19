/**
 * Security posture assertions for the operator-only console.
 *
 * These encode decisions that live partly in the Supabase dashboard, where they
 * are easy to change by accident and invisible in code review. If someone
 * re-enables public signups, this suite is what catches it.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testEnv } from './helpers/env';
import {
  admin,
  ensureOperatorExists,
  seedTwoTenants,
  teardownTenants,
  type TwoTenants,
} from './helpers/seed';

const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };

function anonClient() {
  return createClient(testEnv.url, testEnv.anonKey, noPersist);
}

let seeded: TwoTenants;

/**
 * WR-06: this suite used to seed nothing and depend on another file's beforeAll.
 *
 * Both consequences were bad. The isolation assertions ran against a database
 * that may legitimately have been empty — on CI it is created seconds earlier by
 * `supabase start` — so `expect(data).toEqual([])` was true whether RLS worked
 * or not. A test that cannot distinguish denial from absence is not testing the
 * property it names. And "accepts the correct operator credentials" relied on an
 * operator user this file never created, which is a cross-file ordering
 * dependency in a parallel runner.
 */
beforeAll(async () => {
  await ensureOperatorExists();
  seeded = await seedTwoTenants();
});

afterAll(async () => {
  await teardownTenants([seeded.tenantA, seeded.tenantB]);
});

describe('tenant isolation (ONB-05)', () => {
  it('returns zero rows to an unauthenticated reader even though rows exist', async () => {
    const { data, error } = await anonClient().from('tenants').select('*');

    // RLS filters rows rather than erroring, so the correct result is an empty
    // array. A null would mean the query failed for some other reason and the
    // isolation guarantee would be untested.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // …and the rows really are there. Without this the assertion above passes on
    // an empty database, which is exactly the vacuous case it exists to exclude.
    const { data: real } = await admin
      .from('tenants')
      .select('id')
      .in('id', [seeded.tenantA, seeded.tenantB]);
    expect(real).toHaveLength(2);
  });

  it('returns zero membership rows to an unauthenticated reader even though rows exist', async () => {
    const { data, error } = await anonClient().from('tenant_members').select('*');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: real } = await admin
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', seeded.tenantA);
    expect(real).toHaveLength(1);
  });
});

describe('operator-only auth posture', () => {
  it('rejects public signup — the project must not accept new users', async () => {
    const random = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    const { data, error } = await anonClient().auth.signUp({
      email: random,
      password: `Aa1!${Math.random().toString(36).slice(2)}`,
    });

    // If this fails, the "Disable new user signups" toggle was turned off in
    // Supabase Dashboard -> Authentication -> Sign In / Providers.
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it('rejects a wrong password for the operator account', async () => {
    const { data, error } = await anonClient().auth.signInWithPassword({
      email: testEnv.operatorEmail,
      password: 'definitely-not-the-right-password',
    });

    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });

  it('accepts the correct operator credentials', async () => {
    const { data, error } = await anonClient().auth.signInWithPassword({
      email: testEnv.operatorEmail,
      password: testEnv.operatorPassword,
    });

    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });
});
