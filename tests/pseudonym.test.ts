/**
 * THE CALLER PSEUDONYM LEAF (Phase 15, COMP-02 / D-06).
 *
 * PURE — no database, no environment, no network. The pepper here is an
 * invented test literal; nothing in this suite compares a hash to one produced
 * in production.
 *
 * The leaf is a keyed hash, so the suite checks the three properties the
 * retention pass relies on: determinism (repeat-caller identity survives the
 * hash), sensitivity to both the value and the key, and the exact 64-lower-hex
 * shape migration 0042's widened CHECK admits on a stamped row. The source pin
 * keeps the secret an ARGUMENT: a leaf that read the environment itself could
 * not be tested without one, and would read it on every call.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PEPPER_MIN_CHARS,
  PSEUDONYM_PATTERN,
  isPseudonym,
  pseudonymiseCaller,
} from '@/core/leads/pseudonym';

// 40 characters, invented for this file. Fiction-block numbers (0491 570 3xx).
const P = 'test-pepper-for-the-pseudonym-suite-0001';
const NUMBER = '+61491570311';

describe('pseudonymiseCaller', () => {
  it('is deterministic and equals the node:crypto HMAC-SHA-256 reference', () => {
    const first = pseudonymiseCaller(NUMBER, P);
    expect(pseudonymiseCaller(NUMBER, P)).toBe(first);
    expect(first).toBe(createHmac('sha256', P).update(NUMBER).digest('hex'));
  });

  it('differs for a different value and for a different pepper', () => {
    const base = pseudonymiseCaller(NUMBER, P);
    expect(pseudonymiseCaller('+61491570312', P)).not.toBe(base);
    expect(pseudonymiseCaller(NUMBER, `${P}-other`)).not.toBe(base);
  });

  it('is 64 lower-case hex', () => {
    expect(pseudonymiseCaller(NUMBER, P)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a pepper under the floor and accepts one at it', () => {
    expect(PEPPER_MIN_CHARS).toBe(32);
    expect(() => pseudonymiseCaller(NUMBER, 'x'.repeat(31))).toThrow('pseudonym: pepper too short');
    expect(() => pseudonymiseCaller(NUMBER, 'x'.repeat(32))).not.toThrow();
  });
});

describe('isPseudonym', () => {
  it('recognises exactly a 64-lower-hex string', () => {
    const hash = pseudonymiseCaller(NUMBER, P);
    expect(isPseudonym(hash)).toBe(true);
    expect(isPseudonym(NUMBER)).toBe(false);
    expect(isPseudonym(hash.toUpperCase())).toBe(false);
    expect(isPseudonym(hash.slice(1))).toBe(false);
    expect(isPseudonym(`${hash}0`)).toBe(false);
    expect(PSEUDONYM_PATTERN.source).toBe('^[0-9a-f]{64}$');
  });
});

describe('the leaf never reads the environment (source pin)', () => {
  const code = readFileSync(join(process.cwd(), 'src/core/leads/pseudonym.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('imports node:crypto and nothing else', () => {
    const imports = code.match(/^import[\s\S]*?from\s+'([^']+)';/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("'node:crypto'");
  });

  it('contains no environment read', () => {
    expect(code).not.toContain('process.env');
    expect(code).not.toContain('getServerEnv');
  });
});
