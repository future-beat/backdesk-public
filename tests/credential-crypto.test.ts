/**
 * ONB-02 / threat T-2-01: the credential encryption contract.
 *
 * These are pure unit tests with a throwaway key — no database, no environment.
 * That is deliberate: the crypto must be provable in isolation, because it is
 * the last line of defence if everything else about the connection row leaks.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  credentialLast4,
  decodeEncryptionKey,
  decryptCredential,
  encryptCredential,
} from '../src/core/shared/crypto';

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const PLAINTEXT = 'sm8-private-api-key-abc123XYZ';

describe('encrypt/decrypt roundtrip', () => {
  it('returns exactly what went in', () => {
    expect(decryptCredential(encryptCredential(PLAINTEXT, KEY), KEY)).toBe(PLAINTEXT);
  });

  it('survives unicode and length extremes', () => {
    for (const value of ['', 'a', 'ключ-🔑-key', 'x'.repeat(4096)]) {
      expect(decryptCredential(encryptCredential(value, KEY), KEY)).toBe(value);
    }
  });

  it('writes the versioned enc:v1 envelope', () => {
    const stored = encryptCredential(PLAINTEXT, KEY);
    const parts = stored.split(':');

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('enc');
    expect(parts[1]).toBe('v1');
    // The database CHECK constraint keys on this prefix.
    expect(stored.startsWith('enc:v1:')).toBe(true);
  });

  it('never contains the plaintext', () => {
    // The whole point. A "ciphertext" that embeds its input is not encryption,
    // and base64 of a short key would be visually plausible.
    const stored = encryptCredential(PLAINTEXT, KEY);
    expect(stored).not.toContain(PLAINTEXT);
    expect(Buffer.from(stored.split(':')[4], 'base64').toString('utf8')).not.toContain(PLAINTEXT);
  });
});

describe('IV randomness', () => {
  it('produces different ciphertext for the same plaintext', () => {
    // Nonce reuse under one key in GCM leaks the plaintext XOR and allows tag
    // forgery. Identical output across two calls is the visible symptom of a
    // fixed IV, so this is the test that would catch it.
    const a = encryptCredential(PLAINTEXT, KEY);
    const b = encryptCredential(PLAINTEXT, KEY);

    expect(a).not.toBe(b);
    expect(decryptCredential(a, KEY)).toBe(decryptCredential(b, KEY));
  });

  it('does not repeat an IV across many encryptions', () => {
    const ivs = new Set(
      Array.from({ length: 200 }, () => encryptCredential(PLAINTEXT, KEY).split(':')[2]),
    );
    expect(ivs.size).toBe(200);
  });
});

describe('tamper detection (the reason GCM and not CBC)', () => {
  it('throws when a ciphertext byte is flipped', () => {
    const stored = encryptCredential(PLAINTEXT, KEY);
    const parts = stored.split(':');
    const data = Buffer.from(parts[4], 'base64');
    data[0] ^= 0xff;
    parts[4] = data.toString('base64');

    // Without the authentication tag this would return GARBAGE rather than
    // throw — and that garbage would be sent to ServiceM8 as an API key.
    expect(() => decryptCredential(parts.join(':'), KEY)).toThrow();
  });

  it('throws when the authentication tag is altered', () => {
    const parts = encryptCredential(PLAINTEXT, KEY).split(':');
    const tag = Buffer.from(parts[2 + 1], 'base64');
    tag[0] ^= 0xff;
    parts[3] = tag.toString('base64');

    expect(() => decryptCredential(parts.join(':'), KEY)).toThrow();
  });

  it('throws when the IV is altered', () => {
    const parts = encryptCredential(PLAINTEXT, KEY).split(':');
    const iv = Buffer.from(parts[2], 'base64');
    iv[0] ^= 0xff;
    parts[2] = iv.toString('base64');

    expect(() => decryptCredential(parts.join(':'), KEY)).toThrow();
  });

  it('throws when decrypted with the wrong key', () => {
    expect(() => decryptCredential(encryptCredential(PLAINTEXT, KEY), OTHER_KEY)).toThrow();
  });
});

describe('envelope validation', () => {
  it('refuses an unknown version rather than guessing', () => {
    const stored = encryptCredential(PLAINTEXT, KEY).replace('enc:v1:', 'enc:v2:');

    // Rotation must be a deliberate migration. A reader that guessed at a v2
    // layout would produce a corrupted key and no error.
    expect(() => decryptCredential(stored, KEY)).toThrow(/Unknown credential format version: v2/);
  });

  it('refuses a malformed envelope', () => {
    for (const bad of ['', 'plaintext-key', 'enc:v1:only:three', 'nope:v1:a:b:c']) {
      expect(() => decryptCredential(bad, KEY)).toThrow();
    }
  });
});

describe('key handling', () => {
  it('accepts a base64 key that decodes to 32 bytes', () => {
    expect(decodeEncryptionKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });

  it('rejects a key of the wrong decoded length, naming the length not the value', () => {
    // The trap this guards: a 32-CHARACTER base64 string decodes to 24 bytes
    // and looks correct to a human reading .env.local.
    const twentyFour = randomBytes(24).toString('base64');
    expect(twentyFour).toHaveLength(32);

    expect(() => decodeEncryptionKey(twentyFour)).toThrow(/exactly 32 bytes; got 24/);
    expect(() => decodeEncryptionKey(randomBytes(31).toString('base64'))).toThrow(/got 31/);
  });

  it('refuses to encrypt or decrypt with a wrong-sized key', () => {
    expect(() => encryptCredential(PLAINTEXT, randomBytes(16))).toThrow(/32-byte key/);
    expect(() => decryptCredential(encryptCredential(PLAINTEXT, KEY), randomBytes(16))).toThrow(
      /32-byte key/,
    );
  });
});

describe('credentialLast4', () => {
  it('exposes only the last four characters', () => {
    expect(credentialLast4('abcdefghijkl')).toBe('ijkl');
    expect(credentialLast4('abcdefghijkl')).toHaveLength(4);
  });
});
