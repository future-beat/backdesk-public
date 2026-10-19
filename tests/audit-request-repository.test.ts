/**
 * The audit-request repository against a real Postgres (Phase 9, LAND-03).
 *
 * ── WHAT ONLY A DATABASE CAN PROVE ──────────────────────────────────────────
 *
 * Four of the properties below are not assertions about TypeScript, they are
 * assertions about SQL, and a mock would agree with a broken implementation:
 *
 *  1. `recordAuditRequestNotify` is WRITE-ONCE. The guard is
 *     `WHERE notified_at IS NULL`, and only Postgres can tell you the second
 *     call changed nothing.
 *  2. `bumpAuditRequestThrottle` counts. The `ON CONFLICT … DO UPDATE …
 *     RETURNING` is one statement precisely so two concurrent submissions
 *     cannot both read 5 and both write 6.
 *  3. `markAuditRequestConverted` links ONCE. Same shape, different column.
 *  4. An ANONYMOUS read returns `[]`, not `42501`. Denial and absence must be
 *     indistinguishable — a permission error would confirm the table exists,
 *     and the Phase 1 rule is that it must not.
 *
 * Runs in CI against `supabase start`. Bare, the env gate in tests/helpers/env.ts
 * refuses it, and that refusal is correct: these writes are real.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bumpAuditRequestThrottle,
  closeDb,
  createAuditRequest,
  getAuditRequest,
  listAuditRequests,
  markAuditRequestConverted,
  recordAuditRequestNotify,
  sweepAuditRequestThrottle,
  updateAuditRequestStatus,
} from '@/db/repository';

import { testEnv } from './helpers/env';
import { ensureOperatorAllowlisted, seedProspect, signInAsOperator, teardownProspects } from './helpers/seed';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
});

/** Everything this suite creates, torn down whatever happens. */
const requestIds: string[] = [];
const prospectIds: string[] = [];
const throttleHashes: string[] = [];

/** A hash-shaped value that cannot collide with another run's. */
function testHash(label: string): string {
  const value = `test-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  throttleHashes.push(value);
  return value;
}

async function newRequest(overrides: Record<string, unknown> = {}) {
  const row = await createAuditRequest({
    businessName: `Repo Test ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    contactName: 'Dave Rowley',
    phone: '+61412345678',
    email: 'dave@example.invalid',
    trade: 'electrical',
    servicem8User: true,
    quotesBand: '8_15',
    ...overrides,
  });
  requestIds.push(row.id);
  return row;
}

beforeAll(async () => {
  await ensureOperatorAllowlisted();
}, 60_000);

afterAll(async () => {
  if (requestIds.length > 0) {
    await sql`DELETE FROM audit_requests WHERE id = ANY(${sql.array(requestIds)}::uuid[])`.catch(
      () => {},
    );
  }
  if (throttleHashes.length > 0) {
    await sql`DELETE FROM audit_request_throttle WHERE ip_hash = ANY(${sql.array(
      throttleHashes,
    )})`.catch(() => {});
  }
  await teardownProspects(prospectIds).catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
  await closeDb();
}, 60_000);

describe('createAuditRequest', () => {
  it('writes a row that is new, unnotified and carrying no file', async () => {
    const row = await newRequest();

    expect(row.status).toBe('new');
    expect(row.csvObjectPath).toBeNull();
    expect(row.csvFilename).toBeNull();
    expect(row.csvBytes).toBeNull();
    expect(row.csvPurgeAfter).toBeNull();
    expect(row.notifyEmail).toBeNull();
    expect(row.notifySms).toBeNull();
    expect(row.notifiedAt).toBeNull();
    expect(row.convertedProspectId).toBeNull();
  });

  /** Bounded at the boundary so a hostile header cannot fill a column. */
  it('caps the user agent at 512 characters', async () => {
    const row = await newRequest({ userAgent: 'u'.repeat(2000) });
    expect(row.userAgent).toHaveLength(512);
  });

  /* ── WHERE THE REQUEST CAME FROM (migration 0037, 19 Sep 2026) ── */

  it('leaves all four arrival columns null when nothing was recorded', async () => {
    // The ORDINARY state, not an edge case: outreach emails stay link-free
    // because Gmail rewrites every link, so an email-sourced request genuinely
    // arrives with nothing attached. The console reads this as "Unknown".
    const row = await newRequest();

    expect(row.utmSource).toBeNull();
    expect(row.utmMedium).toBeNull();
    expect(row.utmCampaign).toBeNull();
    expect(row.referrerHost).toBeNull();
  });

  it('stores the four values a tagged link produces, unchanged', async () => {
    // Already parsed and lower-cased by `@/core/intake/arrival-source` before
    // they get here, exactly as `phone` arrives already in E.164 — the
    // repository stores what the boundary decided and normalises nothing.
    const row = await newRequest({
      utmSource: 'gbp',
      utmMedium: 'organic',
      utmCampaign: 'booking',
      referrerHost: 'www.google.com',
    });

    expect(row.utmSource).toBe('gbp');
    expect(row.utmMedium).toBe('organic');
    expect(row.utmCampaign).toBe('booking');
    expect(row.referrerHost).toBe('www.google.com');
  });

  it('accepts a partial arrival — the columns fall independently', async () => {
    // The Facebook page button carries a source and a medium and no campaign;
    // a plain referral carries a host and nothing else. Neither is a half-empty
    // row that some constraint should have refused.
    const row = await newRequest({ utmSource: 'facebook', utmMedium: 'social' });

    expect(row.utmSource).toBe('facebook');
    expect(row.utmMedium).toBe('social');
    expect(row.utmCampaign).toBeNull();
    expect(row.referrerHost).toBeNull();
  });

  it('takes a tag nobody has invented yet — there is no closed vocabulary here', async () => {
    // Marketing owns these words and will add channels without asking. A CHECK
    // constraint would turn a new campaign into a 23514 on the ONE write path an
    // unauthenticated stranger can reach; the parser bounds the shape instead.
    const row = await newRequest({ utmSource: 'a-channel-that-did-not-exist-yesterday' });

    expect(row.utmSource).toBe('a-channel-that-did-not-exist-yesterday');
  });
});

describe('the anonymous read (denial equals absence)', () => {
  it('returns an empty array, never 42501', async () => {
    await newRequest();

    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(testEnv.url, testEnv.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await anon.from('audit_requests').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  /** The counter has no grant at all; it must be invisible the same way. */
  it('returns nothing for the throttle counter either', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(testEnv.url, testEnv.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data } = await anon.from('audit_request_throttle').select('ip_hash');
    expect(data ?? []).toEqual([]);
  });
});

describe('the operator read', () => {
  it('sees the row the anonymous client could not', async () => {
    const row = await newRequest();
    const operator = await signInAsOperator();

    const { data, error } = await operator
      .from('audit_requests')
      .select('id, status')
      .eq('id', row.id);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: row.id, status: 'new' }]);
  });
});

describe('recordAuditRequestNotify is write-once', () => {
  it('writes the first outcome and ignores the second', async () => {
    const row = await newRequest();

    await recordAuditRequestNotify(row.id, { email: 'sent', sms: 'sent', detail: null });
    const first = await getAuditRequest(row.id);
    expect(first?.notifyEmail).toBe('sent');
    expect(first?.notifySms).toBe('sent');
    expect(first?.notifiedAt).not.toBeNull();

    // A retry must not rewrite the first, truthful record of what happened.
    await recordAuditRequestNotify(row.id, {
      email: 'failed',
      sms: 'failed',
      detail: 'http_500',
    });

    const second = await getAuditRequest(row.id);
    expect(second?.notifyEmail).toBe('sent');
    expect(second?.notifySms).toBe('sent');
    expect(second?.notifyDetail).toBeNull();
    expect(second?.notifiedAt?.toISOString()).toBe(first?.notifiedAt?.toISOString());
  });
});

describe('bumpAuditRequestThrottle counts within the hour window', () => {
  it('returns 1 through 6 for six attempts on one hash', async () => {
    const hash = testHash('bump');
    const seen: number[] = [];
    for (let i = 0; i < 6; i += 1) seen.push(await bumpAuditRequestThrottle(hash));

    // 1..5 are permitted (AUDIT_THROTTLE_LIMIT); the sixth is what the 09-03
    // refusal reads.
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keys separately per hash', async () => {
    const a = testHash('a');
    const b = testHash('b');
    await bumpAuditRequestThrottle(a);
    await bumpAuditRequestThrottle(a);
    expect(await bumpAuditRequestThrottle(b)).toBe(1);
  });

  it('sweeps nothing while the rows are inside the day', async () => {
    const hash = testHash('sweep');
    await bumpAuditRequestThrottle(hash);
    await sweepAuditRequestThrottle();

    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_request_throttle WHERE ip_hash = ${hash}
    `;
    expect(n).toBe(1);
  });
});

describe('markAuditRequestConverted links once', () => {
  it('returns true the first time and false the second', async () => {
    const row = await newRequest();
    const prospectId = await seedProspect();
    prospectIds.push(prospectId);
    const second = await seedProspect();
    prospectIds.push(second);

    expect(await markAuditRequestConverted(row.id, prospectId)).toBe(true);

    const linked = await getAuditRequest(row.id);
    expect(linked?.convertedProspectId).toBe(prospectId);
    expect(linked?.status).toBe('audited');

    // Two prospects for one request is an operator mistake worth seeing, not a
    // link worth overwriting.
    expect(await markAuditRequestConverted(row.id, second)).toBe(false);

    const still = await getAuditRequest(row.id);
    expect(still?.convertedProspectId).toBe(prospectId);
  });
});

describe('updateAuditRequestStatus', () => {
  it('moves the row through the vocabulary', async () => {
    const row = await newRequest();
    await updateAuditRequestStatus(row.id, 'contacted');
    expect((await getAuditRequest(row.id))?.status).toBe('contacted');
  });

  it('refuses a status outside the vocabulary at the boundary', async () => {
    const row = await newRequest();
    await expect(
      updateAuditRequestStatus(row.id, 'archived' as never),
    ).rejects.toThrow(/archived/);
  });
});

describe('listAuditRequests', () => {
  it('returns the newest first and carries no ip hash or user agent', async () => {
    const older = await newRequest({ userAgent: 'older-agent' });
    // Distinct timestamps: two rows in the same millisecond are ordered by id,
    // which this assertion is not about.
    await sql`UPDATE audit_requests SET created_at = now() - interval '1 hour' WHERE id = ${older.id}`;
    const newer = await newRequest({ userAgent: 'newer-agent' });

    const rows = await listAuditRequests(50);
    const olderAt = rows.findIndex((r) => r.id === older.id);
    const newerAt = rows.findIndex((r) => r.id === newer.id);

    expect(newerAt).toBeGreaterThanOrEqual(0);
    expect(olderAt).toBeGreaterThan(newerAt);

    // A page prop is serialised into the HTML payload and the client router
    // cache; a hashed address is still a stable identifier for a person.
    const [first] = rows;
    expect(first).not.toHaveProperty('userAgent');
    expect(first).not.toHaveProperty('ipHash');
  });
});
