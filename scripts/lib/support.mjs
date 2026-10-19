/**
 * Shared helpers for the operational scripts.
 *
 * No new dependencies: env loading uses Node 22's built-in loadEnvFile, which
 * (like --env-file) leaves already-set variables alone, so CI-provided secrets
 * always win over the local file.
 */

export function loadEnv() {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local — rely on the ambient environment.
  }
}

/** Fail loudly, naming every missing variable at once rather than one per run. */
export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('See docs/env-vars.md for the contract.');
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

const TRANSIENT = /ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i;

function looksTransient(err) {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (TRANSIENT.test(String(e.code ?? '')) || TRANSIENT.test(String(e.message ?? ''))) {
      return true;
    }
  }
  return false;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry only genuinely transient network failures, with linear backoff.
 *
 * A real assertion failure or auth rejection must surface on the first attempt —
 * retrying those would turn a red test green by accident.
 */
export async function withRetry(label, fn, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!looksTransient(e) || attempt === attempts) throw e;
      console.error(`  ${label}: transient failure (${e.code ?? e.message}), retry ${attempt}/${attempts - 1}`);
      await wait(3000 * attempt);
    }
  }

  // Unreachable while the loop condition and the `attempt === attempts` rethrow
  // agree. Kept because the implicit `return undefined` they currently prevent
  // would be indistinguishable from a legitimate result at the call site — a
  // caller doing `created.data.user.id` would fail with "cannot read properties
  // of undefined" and no mention of which operation gave up.
  throw new Error(`${label}: retry loop exited without a result`);
}
