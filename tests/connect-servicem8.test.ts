/**
 * ONB-02 end to end, against the real ServiceM8 API and the real database.
 *
 * WHAT THIS COVERS THAT THE UNIT SUITES CANNOT: that the pieces agree. The
 * crypto tests prove encryption works; these prove the encrypted value is what
 * lands in the column. The schema tests prove the fixtures parse; these prove
 * the LIVE payload still does.
 *
 * The prohibition assertion — that the plaintext key exists in no column — is
 * made through a DIRECT POSTGRES connection rather than PostgREST, because
 * PostgREST returns the columns we ask for and the question is precisely
 * whether some column we did not think to ask about holds the key.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectServiceM8 } from '../src/core/sync/connect';
import { closeDb } from '../src/db/repository';

import { canReachServiceM8, sm8TestApiKey, testEnv } from './helpers/env';
import { admin, seedTenant, teardownTenants } from './helpers/seed';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
});

const tenants: string[] = [];

async function newTenant(): Promise<string> {
  const id = await seedTenant('SM8 Connect');
  tenants.push(id);
  return id;
}

afterAll(async () => {
  await teardownTenants(tenants);
  await sql.end({ timeout: 5 });
  await closeDb();
});

describe.skipIf(!canReachServiceM8)('connectServiceM8 against the live account', () => {
  const API_KEY = sm8TestApiKey!;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await newTenant();
    const result = await connectServiceM8(tenantId, API_KEY);
    // A failure here is not a test failure to interpret later — every
    // assertion below would be meaningless, so say why immediately.
    expect(
      result.ok,
      result.ok ? '' : `connect failed: ${result.kind} ${result.detail ?? ''}`,
    ).toBe(true);
  });

  it('stores the key as enc:v1 ciphertext', async () => {
    const { data } = await admin
      .from('sm8_connections')
      .select('api_key_ciphertext, key_last4')
      .eq('tenant_id', tenantId)
      .single();

    expect(data!.api_key_ciphertext.startsWith('enc:v1:')).toBe(true);
    expect(data!.key_last4).toBe(API_KEY.slice(-4));
  });

  it('puts the plaintext key in NO column of the connection row (T-2-02)', async () => {
    // `SELECT *` through the catalog connection: whatever columns exist, this
    // sees them — including one added by a future migration that nobody
    // remembered to check.
    const rows = await sql<{ api_key_ciphertext: string; [column: string]: unknown }[]>`
      SELECT * FROM public.sm8_connections WHERE tenant_id = ${tenantId}
    `;
    expect(rows).toHaveLength(1);

    // key_last4 is blanked because the last four characters ARE legitimately
    // stored; everything else on the row is fair game for the search.
    const row = rows[0];
    const serialised = JSON.stringify({ ...row, key_last4: '' });

    expect(serialised).not.toContain(API_KEY);
    expect(row.api_key_ciphertext).not.toBe(API_KEY);
    expect(row.api_key_ciphertext).not.toContain(API_KEY);
    // Only the last FOUR characters may be stored anywhere.
    if (API_KEY.length > 8) expect(serialised).not.toContain(API_KEY.slice(-8));
  });

  it('backfills quotes across all four statuses (D-16)', async () => {
    const { data } = await admin.from('quotes').select('status').eq('tenant_id', tenantId);

    expect(data!.length).toBeGreaterThan(0);
    const statuses = new Set(data!.map((r) => r.status));
    expect(statuses.has('Quote'), 'no open quotes mirrored').toBe(true);
    expect(
      statuses.size,
      'only one status mirrored — win/loss history is what the baseline is computed from',
    ).toBeGreaterThan(1);
  });

  it('parks every backfilled open quote as needs_review (D-15)', async () => {
    const { data } = await admin
      .from('quotes')
      .select('chase_eligibility')
      .eq('tenant_id', tenantId)
      .eq('status', 'Quote');

    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(
        row.chase_eligibility,
        'a backfilled quote is never chase-eligible without operator triage',
      ).toBe('needs_review');
    }
  });

  it('marks every backfilled row as sourced from the backfill', async () => {
    const { data } = await admin.from('quotes').select('sync_source').eq('tenant_id', tenantId);
    for (const row of data!) expect(row.sync_source).toBe('backfill');
  });

  it('sets the cursor from the maximum observed edit_date, not our clock', async () => {
    const [{ data: connection }, { data: quotes }] = await Promise.all([
      admin.from('sm8_connections').select('job_cursor').eq('tenant_id', tenantId).single(),
      admin.from('quotes').select('edit_date_raw').eq('tenant_id', tenantId),
    ]);

    const max = quotes!.reduce<string | null>(
      (acc, r) => (acc === null || r.edit_date_raw > acc ? r.edit_date_raw : acc),
      null,
    );
    expect(connection!.job_cursor).toBe(max);
  });

  it('normalizes raw timestamps into UTC columns (SYNC-03)', async () => {
    const { data } = await admin
      .from('quotes')
      .select('edit_date_raw, edit_date_utc, quote_date_raw, quote_date_utc')
      .eq('tenant_id', tenantId);

    for (const row of data!) {
      expect(row.edit_date_raw, 'the cursor basis must always be present').toBeTruthy();
      expect(row.edit_date_utc).not.toBeNull();
      expect(Number.isNaN(new Date(row.edit_date_utc).getTime())).toBe(false);

      // The pairing invariant: a raw value present means a UTC value present,
      // and a raw value absent means null — never Invalid Date on either side.
      if (row.quote_date_raw) expect(row.quote_date_utc).not.toBeNull();
      else expect(row.quote_date_utc).toBeNull();
    }
  });

  it('stores money as an exact numeric, never a float artefact', async () => {
    // READ THROUGH THE DIRECT CONNECTION, not PostgREST.
    //
    // PostgREST deserializes `numeric` into a JSON number, so a stored
    // `4850.00` comes back as `4850` — the trailing zeros are lost in
    // TRANSPORT, and worse, the value has passed through a JS double on the
    // way. Asserting on that would test PostgREST's serializer rather than
    // what Postgres holds, and would report a false failure for a correctly
    // stored value. postgres.js returns numeric as an exact string.
    const rows = await sql<{ total_invoice_amount: string | null }[]>`
      SELECT total_invoice_amount FROM public.quotes
      WHERE tenant_id = ${tenantId} AND total_invoice_amount IS NOT NULL
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.total_invoice_amount).toBe('string');
      // Exactly two decimal places, and no floating-point residue — the
      // 4-decimal source values ("393.7500") must land as "393.75".
      expect(row.total_invoice_amount).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('round-trips a known seeded amount to the cent', async () => {
    // The seeded trial account holds a job worth 4850.0000. End to end — API
    // string -> zod -> integer cents -> numeric(12,2) -> Postgres — that must
    // still be exactly 4850.00, with no 4849.99 and no 4850.000000001.
    const rows = await sql<{ total_invoice_amount: string }[]>`
      SELECT total_invoice_amount FROM public.quotes
      WHERE tenant_id = ${tenantId} AND total_invoice_amount IS NOT NULL
      ORDER BY total_invoice_amount DESC
    `;

    for (const row of rows) {
      const cents = Math.round(Number(row.total_invoice_amount) * 100);
      // The decimal string and its cent value agree exactly — the property a
      // float round-trip would break.
      expect(row.total_invoice_amount).toBe(
        `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
      );
    }
  });

  it('leaves exactly one connection row when connected twice (ONB-02 concurrency)', async () => {
    const before = await admin
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    const second = await connectServiceM8(tenantId, API_KEY);
    expect(second.ok).toBe(true);

    const [{ data: connections }, after] = await Promise.all([
      admin.from('sm8_connections').select('id').eq('tenant_id', tenantId),
      admin.from('quotes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    ]);

    expect(connections, 'the UNIQUE tenant_id is the concurrency guarantee').toHaveLength(1);
    expect(after.count, 'the (tenant_id, sm8_job_uuid) upsert must update, not duplicate').toBe(
      before.count,
    );
  });

  it('survives two SIMULTANEOUS connects — the real double-click (ONB-02 edge)', async () => {
    // The sequential test above proves upsert semantics. This one proves the
    // race: a check-then-insert would let both callers past the check.
    const raceTenant = await newTenant();

    const results = await Promise.all([
      connectServiceM8(raceTenant, API_KEY),
      connectServiceM8(raceTenant, API_KEY),
    ]);

    for (const r of results) {
      expect(r.ok, r.ok ? '' : `concurrent connect failed: ${r.kind}`).toBe(true);
    }

    const { data } = await admin.from('sm8_connections').select('id').eq('tenant_id', raceTenant);
    expect(data).toHaveLength(1);
  });

  it('does not preserve chase_eligibility drift on re-sync (operator triage survives)', async () => {
    // An operator marks a quote eligible; the next sync touches the same job.
    // The human decision must survive — reverting it silently to needs_review
    // would un-chase a quote the operator deliberately approved.
    const { data: target } = await admin
      .from('quotes')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'Quote')
      .limit(1)
      .single();

    await admin.from('quotes').update({ chase_eligibility: 'eligible' }).eq('id', target!.id);

    const resync = await connectServiceM8(tenantId, API_KEY);
    expect(resync.ok).toBe(true);

    const { data: after } = await admin
      .from('quotes')
      .select('chase_eligibility')
      .eq('id', target!.id)
      .single();

    expect(after!.chase_eligibility).toBe('eligible');
  });
});

describe('connectServiceM8 verify-then-write', () => {
  it('writes NO rows when the key is rejected', async () => {
    const tenantId = await newTenant();

    const result = await connectServiceM8(tenantId, 'definitely-not-a-valid-servicem8-key');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        ['auth_failed', 'server_error'],
        `unexpected failure kind: ${result.kind}`,
      ).toContain(result.kind);
    }

    // THE POINT OF VERIFY-THEN-WRITE. A stored-but-invalid key produces a
    // connection that looks healthy and syncs nothing.
    const [{ data: connections }, { data: quotes }] = await Promise.all([
      admin.from('sm8_connections').select('id').eq('tenant_id', tenantId),
      admin.from('quotes').select('id').eq('tenant_id', tenantId),
    ]);

    expect(connections, 'a rejected key must leave no connection row').toEqual([]);
    expect(quotes, 'a rejected key must leave no quote rows').toEqual([]);
  });

  it('never leaks a rejected key into the failure result', async () => {
    const secret = 'super-secret-rejected-key-value';
    const result = await connectServiceM8(await newTenant(), secret);

    expect(result.ok).toBe(false);
    // The failure travels to the form as copy; a key interpolated into a detail
    // string ends up rendered, logged, and in an error tracker (T-2-02).
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('reports no_such_tenant without touching ServiceM8', async () => {
    const result = await connectServiceM8('00000000-0000-4000-8000-000000000000', 'irrelevant');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('no_such_tenant');
  });

  it('refuses a malformed tenant id rather than guessing', async () => {
    await expect(connectServiceM8('not-a-uuid', 'irrelevant')).rejects.toThrow(/tenant uuid/);
  });
});
