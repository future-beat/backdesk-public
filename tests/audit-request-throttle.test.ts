/**
 * The abuse controls on the one public write path (Phase 9, LAND-03, D-12,
 * threats T-9-02/T-9-03/T-9-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ADDRESS IS NEVER STORED. `ip_hash` is a salted SHA-256, and the only │
 * │ thing it is ever used for is keying an hourly counter. A hashed address  │
 * │ is still a stable identifier for a person, which is why the salt is a    │
 * │ required secret and why the console's list query does not select the     │
 * │ column at all.                                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE. Three small functions and two structural reads; no database, no
 * request, no `next/*`. The atomicity that makes the counter a real limit is a
 * property of one SQL statement in the repository, so what is asserted here is
 * that the statement is still the shape that has it.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { AUDIT_THROTTLE_LIMIT } from '@/db/schema';
import { clientIpFromHeaders, hashClientIp } from '@/core/intake/ip-hash';
import { AUDIT_THROTTLE_WINDOW, throttleDecision } from '@/core/intake/throttle';

const SALT = 'a'.repeat(32);
const OTHER_SALT = 'b'.repeat(32);

const REPOSITORY_SOURCE = readFileSync('src/db/repository/audit-requests.ts', 'utf8');
const DIGEST_ROUTE = readFileSync('src/app/api/internal/stalled-digest/route.ts', 'utf8');
const IP_HASH_SOURCE = readFileSync('src/core/intake/ip-hash.ts', 'utf8');

/** A `headers()`-shaped reader, without a request. */
function headers(map: Record<string, string>) {
  return (name: string) => map[name] ?? null;
}

describe('the client address, hashed and then forgotten (T-9-05)', () => {
  it('produces a 64-character hex digest, stably', () => {
    const hash = hashClientIp('203.0.113.9', SALT);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClientIp('203.0.113.9', SALT)).toBe(hash);
  });

  /**
   * The salt is what stops the hash being a lookup table: without it, anybody
   * holding a database dump could confirm whether a given address submitted the
   * form by hashing it themselves — there are only four billion IPv4 addresses.
   */
  it('gives a different digest under a different salt', () => {
    expect(hashClientIp('203.0.113.9', OTHER_SALT)).not.toBe(
      hashClientIp('203.0.113.9', SALT),
    );
  });

  it('never contains the address it was built from', () => {
    expect(hashClientIp('203.0.113.9', SALT)).not.toContain('203');
  });

  /**
   * IPv6 IS THE ONE THAT MATTERS HERE. A residential IPv6 allocation is
   * commonly a whole /64, so a submitter can present a fresh full address on
   * every request without changing networks at all — hashing the full address
   * would give an attacker a new counter per submission, which is a limit that
   * does not limit. Keying on the /64 puts the whole allocation in one bucket.
   */
  it('shares one bucket across a whole IPv6 /64', () => {
    expect(hashClientIp('2001:db8:1:2:3:4:5:6', SALT)).toBe(
      hashClientIp('2001:db8:1:2:ffff:ffff:ffff:ffff', SALT),
    );
  });

  it('still separates two different /64s', () => {
    expect(hashClientIp('2001:db8:1:2:3:4:5:6', SALT)).not.toBe(
      hashClientIp('2001:db8:1:3::1', SALT),
    );
  });

  /**
   * Local development and any server-side call have no client address at all.
   * A fabricated placeholder would collide every such request into ONE bucket
   * and throttle the founder out of their own form after five test submissions.
   */
  it('answers null for a null address, rather than inventing one', () => {
    expect(hashClientIp(null, SALT)).toBeNull();
    expect(hashClientIp('', SALT)).toBeNull();
  });
});

describe('which header carries the address, and which value in it', () => {
  /**
   * Vercel OVERWRITES `x-forwarded-for` and does not forward externally-supplied
   * values, precisely to stop spoofing, so the first value is the client and
   * the rest are the hops. Reading the last value — the other common habit —
   * would key the counter on a proxy and throttle everybody behind it at once.
   */
  it('takes the FIRST value of x-forwarded-for', () => {
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })),
    ).toBe('203.0.113.9');
  });

  it('trims the whitespace a comma-separated list carries', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '  203.0.113.9  ' }))).toBe(
      '203.0.113.9',
    );
  });

  it('answers null when the header is absent or empty', () => {
    expect(clientIpFromHeaders(headers({}))).toBeNull();
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '' }))).toBeNull();
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': ' , ' }))).toBeNull();
  });

  it('reads x-forwarded-for and nothing a client could set instead', () => {
    expect(IP_HASH_SOURCE).toContain('x-forwarded-for');
  });
});

describe('the fifth submission is allowed and the sixth is not (D-12)', () => {
  it('refuses only once the running total EXCEEDS the limit', () => {
    expect(throttleDecision(1, 5)).toBe('allow');
    expect(throttleDecision(5, 5)).toBe('allow');
    expect(throttleDecision(6, 5)).toBe('refuse');
    expect(throttleDecision(50, 5)).toBe('refuse');
  });

  it('defaults to the schema-owned limit rather than a second spelling of 5', () => {
    expect(throttleDecision(AUDIT_THROTTLE_LIMIT)).toBe('allow');
    expect(throttleDecision(AUDIT_THROTTLE_LIMIT + 1)).toBe('refuse');
  });

  /**
   * The window is a fixed hour bucket, not a rolling one, and that is a
   * deliberate, bounded imprecision: a burst straddling the boundary can reach
   * 2 × limit inside some rolling 60 minutes. Ten submissions from one
   * connection in an hour is still not the flood this control exists to stop,
   * and the alternative — a rolling window — cannot be a primary key, which is
   * what makes the counter atomic.
   */
  it('names the window, and the repository truncates to the same one in UTC', () => {
    expect(AUDIT_THROTTLE_WINDOW).toBe('hour');
    expect(REPOSITORY_SOURCE).toContain("date_trunc('hour', now())");
  });

  /**
   * ONE STATEMENT OR IT IS NOT A LIMIT. A read-then-write lets two concurrent
   * submissions both read 5 and both write 6; `ON CONFLICT … DO UPDATE …
   * RETURNING` serialises them under Postgres' own row lock, so every caller
   * gets a distinct count.
   */
  it('keeps the bump atomic', () => {
    expect(REPOSITORY_SOURCE).toContain('onConflictDoUpdate');
    expect(REPOSITORY_SOURCE).toContain('returning');
  });
});

/**
 * The retention promise `/privacy` makes (09-05) has to be kept by something
 * that runs. Storage objects cannot be deleted from SQL, so pg_cron alone
 * cannot do it: the purge borrows the daily digest tick's authenticated clock
 * (09-RESEARCH §6, assumption A8).
 */
describe('the daily tick is the purge’s clock', () => {
  it('imports the purge through the barrel and calls it', () => {
    expect(DIGEST_ROUTE).toContain('purgeExpiredAuditUploads');
    expect(DIGEST_ROUTE).toMatch(/from '@\/db\/repository'/);
  });

  it('runs the digest first, so a purge failure cannot cost the operator the email', () => {
    expect(DIGEST_ROUTE.indexOf('runStalledDigest')).toBeLessThan(
      DIGEST_ROUTE.indexOf('purgeExpiredAuditUploads()'),
    );
  });

  it('enumerates the new counts by name and never spreads a result', () => {
    expect(DIGEST_ROUTE).toContain('uploadsPurged');
    expect(DIGEST_ROUTE).toContain('uploadsPurgeFailed');
    expect(DIGEST_ROUTE).toContain('throttleSwept');
    // T-3-24: this body reaches cron.job_run_details and the Vercel log. A
    // spread would let a field added later for an operator's benefit ride there.
    expect(DIGEST_ROUTE).not.toMatch(/\.\.\.result|\.\.\.purge/);
  });
});
