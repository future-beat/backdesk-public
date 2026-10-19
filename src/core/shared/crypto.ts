/**
 * Credential encryption at rest (ONB-02, threat T-2-01).
 *
 * A client's ServiceM8 private API key is a bearer credential to their entire
 * business: every job, every customer's name, address and phone number. It is
 * therefore encrypted in the APPLICATION layer, so the key that decrypts it
 * never enters the database. A database compromise on its own — a dump, a
 * misconfigured replica, an RLS bug, a support engineer with read access —
 * yields ciphertext and nothing else.
 *
 * AES-256-GCM rather than CBC or a bare cipher: GCM is authenticated, so a
 * tampered ciphertext FAILS TO DECRYPT rather than silently producing garbage
 * that gets sent to ServiceM8 as an API key. That property is tested, not
 * assumed (tests/credential-crypto.test.ts).
 *
 * FORMAT: `enc:v1:<base64 iv>:<base64 tag>:<base64 ciphertext>`
 * The version prefix is not decoration. Rotating to a new scheme (v2) becomes a
 * data migration that can run gradually, because every stored value says which
 * scheme produced it. Reading an unknown version THROWS rather than guessing —
 * a wrong guess here means sending a corrupted key to a client's account.
 *
 * `src/core` is framework-free by contract: `node:crypto` only, no dependency.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** GCM's standard nonce length. 12 bytes is what the spec optimises for. */
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc';
const VERSION = 'v1';

/**
 * The 32-byte key, decoded from base64.
 *
 * Kept separate from `getServerEnv()` so `src/core/shared/crypto.ts` stays a
 * pure function module that unit tests can drive with a throwaway key — the
 * crypto is testable without any environment at all.
 */
export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    // Deliberately reports the LENGTH and not the value.
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes; got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

/**
 * Encrypt a credential for storage.
 *
 * A fresh random IV per call is mandatory, not merely good practice: reusing a
 * nonce under the same key in GCM is a catastrophic failure that leaks the
 * plaintext XOR and forges the authentication tag. Two encryptions of the same
 * key therefore produce different ciphertext — which the tests assert, because
 * identical output would be the visible symptom of a fixed IV.
 */
export function encryptCredential(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryptCredential requires a ${KEY_BYTES}-byte key; got ${key.length}.`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/**
 * Decrypt a stored credential.
 *
 * Throws on: an unknown version, a malformed envelope, or a failed
 * authentication tag. All three are "the stored value is not what we wrote",
 * and continuing past any of them means using an attacker-influenced string as
 * a credential.
 */
export function decryptCredential(stored: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`decryptCredential requires a ${KEY_BYTES}-byte key; got ${key.length}.`);
  }

  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== PREFIX) {
    throw new Error('Malformed credential envelope: expected enc:v1:<iv>:<tag>:<data>.');
  }

  const [, version, ivB64, tagB64, dataB64] = parts;
  if (version !== VERSION) {
    // Loudly, per the header: a future v2 reader must be written, never guessed.
    throw new Error(`Unknown credential format version: ${version}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  // The tamper check. Without this call `final()` would not verify anything.
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * The last four characters of a credential — the only part ever rendered.
 *
 * Lives here rather than at the call site so there is exactly one definition of
 * "how much of a key may be displayed", and so a future change to that answer is
 * a one-line change rather than a grep.
 */
export function credentialLast4(plaintext: string): string {
  return plaintext.slice(-4);
}
