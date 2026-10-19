/**
 * ONB-01 integration: the operator can create a client tenant, and only the
 * operator can. Runs against the configured Supabase project.
 *
 * Self-seeding (ensures the operator auth user exists) and self-cleaning
 * (deletes every tenant it creates), so it is safe to run repeatedly and in CI.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDuplicateNameError } from '@/core/shared/tenant';

import { testEnv } from './helpers/env';
// One implementation of "make sure the operator exists", shared with every other
// suite: the two local copies raced each other on a fresh database and neither
// paginated (WR-05, IN-03).
import { admin, ensureOperatorExists } from './helpers/seed';

const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };

/** Tenants created by this suite, torn down in afterAll. */
const createdTenantIds: string[] = [];

let operator: SupabaseClient;

const profile = {
  p_trade_type: 'Electrical',
  p_timezone: 'Australia/Perth',
  p_hours_start: '08:00',
  p_hours_end: '17:00',
  p_days: [1, 2, 3, 4, 5],
  p_escalation_phone: null,
};

beforeAll(async () => {
  await ensureOperatorExists();

  operator = createClient(testEnv.url, testEnv.anonKey, noPersist);
  const { error } = await operator.auth.signInWithPassword({
    email: testEnv.operatorEmail,
    password: testEnv.operatorPassword,
  });
  if (error) throw new Error(`Operator sign-in failed: ${error.message}`);
});

afterAll(async () => {
  if (createdTenantIds.length > 0) {
    // Service role bypasses RLS — the only place in the suite that is acceptable.
    await admin.from('tenants').delete().in('id', createdTenantIds);
  }
});

describe('tenant creation (ONB-01)', () => {
  it('creates a tenant through the create_tenant RPC and returns its id', async () => {
    const { data, error } = await operator.rpc('create_tenant', {
      ...profile,
      p_name: `Test Sparks ${Date.now()}`,
    });

    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    // uuid v4 canonical form
    expect(data).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    createdTenantIds.push(data as string);
  });

  it('persists every profile field and returns the row to its member', async () => {
    const name = `Test Plumbing ${Date.now()}`;
    const { data: id, error: rpcError } = await operator.rpc('create_tenant', {
      ...profile,
      p_name: name,
      p_trade_type: 'Plumbing',
      p_escalation_phone: '+61400000000',
    });
    expect(rpcError).toBeNull();
    createdTenantIds.push(id as string);

    const { data: row, error } = await operator
      .from('tenants')
      .select('*')
      .eq('id', id)
      .single();

    expect(error).toBeNull();
    expect(row).toMatchObject({
      id,
      name,
      trade_type: 'Plumbing',
      timezone: 'Australia/Perth',
      escalation_phone: '+61400000000',
      // default applied by the schema, not passed in
      status: 'onboarding',
    });
    expect(row!.contact_hours_start).toMatch(/^08:00/);
    expect(row!.contact_hours_end).toMatch(/^17:00/);
    expect(row!.contact_days).toEqual([1, 2, 3, 4, 5]);
  });

  it('collides on a duplicate name and reports it as the mapped duplicate error', async () => {
    // ONB-01 idempotency edge: a double submit must yield ONE client. This
    // asserts against the error PostgREST actually returns, not a hand-written
    // stand-in — the shape is the whole reason isDuplicateNameError exists.
    const name = `Test Duplicate ${Date.now()}`;

    const first = await operator.rpc('create_tenant', { ...profile, p_name: name });
    expect(first.error).toBeNull();
    createdTenantIds.push(first.data as string);

    // Different case: the unique index is over lower(name).
    const second = await operator.rpc('create_tenant', {
      ...profile,
      p_name: name.toUpperCase(),
    });

    expect(second.error).not.toBeNull();
    expect(isDuplicateNameError(second.error)).toBe(true);

    const { data: rows } = await admin.from('tenants').select('id').ilike('name', name);
    expect(rows).toHaveLength(1);
  });

  it('returns no row for an unknown id — the detail page 404 path', async () => {
    const { data, error } = await operator
      .from('tenants')
      .select('id')
      .eq('id', '00000000-0000-4000-8000-000000000000')
      .maybeSingle();

    // Not an error: RLS filtering and genuine absence are indistinguishable,
    // which is exactly what threat T-03-02 requires.
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('refuses to create a tenant for a caller with no session', async () => {
    const anon = createClient(testEnv.url, testEnv.anonKey, noPersist);

    const { data, error } = await anon.rpc('create_tenant', {
      ...profile,
      p_name: `Should Never Exist ${Date.now()}`,
    });

    // EXECUTE is revoked from anon, so this is rejected before the body runs.
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // And nothing was written.
    const { data: rows } = await admin
      .from('tenants')
      .select('id')
      .like('name', 'Should Never Exist %');
    expect(rows).toEqual([]);
  });
});

/**
 * WR-03: the invariants hold for callers that never touch the form.
 *
 * `src/core/shared/tenant.ts` is the validation authority for the console, but
 * the console is not the only caller — `create_tenant` is granted to
 * `authenticated` and exposed on PostgREST, and 0003 also grants UPDATE on
 * `tenants`. These cases go straight at the RPC and at the table with a valid
 * operator JWT, i.e. exactly what a curl would do, and assert the DATABASE
 * refuses. That is what makes the authority a mechanism rather than a
 * convention.
 */
describe('database-level tenant invariants (WR-03)', () => {
  /** Every rejection below must be the database refusing, and nothing written. */
  async function expectRejected(
    label: string,
    overrides: Record<string, unknown>,
  ): Promise<void> {
    const name = `Junk ${label} ${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data, error } = await operator.rpc('create_tenant', {
      ...profile,
      p_name: name,
      ...overrides,
    });

    if (!error && typeof data === 'string') {
      // Do not leave the row behind if the guard is missing — the assertion
      // below is what fails the test, not the cleanup.
      createdTenantIds.push(data);
    }

    expect(error, `${label} was accepted by the database`).not.toBeNull();

    const { data: rows } = await admin.from('tenants').select('id').eq('name', name);
    expect(rows, `${label} left a row behind`).toEqual([]);
  }

  it('rejects a contact-hours window that ends before it starts', async () => {
    await expectRejected('reversed hours', {
      p_hours_start: '17:00',
      p_hours_end: '08:00',
    });
  });

  it('rejects a zero-width contact-hours window', async () => {
    await expectRejected('equal hours', {
      p_hours_start: '09:00',
      p_hours_end: '09:00',
    });
  });

  it('rejects contact days outside the ISO 1–7 range', async () => {
    await expectRejected('day 0 and 99', { p_days: [0, 99] });
  });

  it('rejects an empty contact-days array', async () => {
    // The COALESCE in tenants_days_nonempty is what makes this fail:
    // array_length('{}', 1) is NULL, and a NULL CHECK expression passes.
    await expectRejected('no days', { p_days: [] });
  });

  it('rejects a timezone that is not an IANA identifier', async () => {
    await expectRejected('bogus zone', { p_timezone: 'Mars/Phobos' });
  });

  it('rejects a name longer than the documented bound', async () => {
    await expectRejected('long name', { p_name: 'x'.repeat(10_000) });
  });

  it('rejects an unknown status on a direct PATCH, not only through the RPC', async () => {
    // The path the RPC cannot police: 0003 grants UPDATE on tenants to
    // `authenticated`, so an operator can PATCH their OWN tenant over PostgREST
    // with create_tenant never running. The constraint has to live on the table.
    const { data: id, error: rpcError } = await operator.rpc('create_tenant', {
      ...profile,
      p_name: `Test Patch Guard ${Date.now()}`,
    });
    expect(rpcError).toBeNull();
    createdTenantIds.push(id as string);

    const badStatus = await operator
      .from('tenants')
      .update({ status: 'hijacked' })
      .eq('id', id);
    expect(badStatus.error).not.toBeNull();

    const badZone = await operator
      .from('tenants')
      .update({ timezone: 'Mars/Phobos' })
      .eq('id', id);
    expect(badZone.error).not.toBeNull();

    // The row is untouched, read through the client that bypasses RLS.
    const { data: row } = await admin
      .from('tenants')
      .select('status,timezone')
      .eq('id', id)
      .single();
    expect(row).toMatchObject({ status: 'onboarding', timezone: 'Australia/Perth' });
  });

  it('still accepts a legitimate tenant — the constraints are not a blanket deny', async () => {
    const name = `Test Still Works ${Date.now()}`;
    const { data, error } = await operator.rpc('create_tenant', {
      ...profile,
      p_name: name,
      p_days: [1, 2, 3, 4, 5, 6, 7],
      p_timezone: 'Australia/Perth',
    });

    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    createdTenantIds.push(data as string);
  });
});
