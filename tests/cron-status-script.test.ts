import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* ------------------------------------------------------------------------- *
 * scripts/cron-status.mjs — the script's own contract, as a test
 *
 * `scripts/apply-cron-schedules.mjs` has been pinned by a source-level suite
 * since Phase 3 (`tests/cron-schedules.test.ts`, "the committed script itself").
 * Its read-only sibling had none, and it prints MORE of `cron.job` than the
 * apply script does — including a column whose value embeds a bearer token.
 *
 * This suite is PURE on purpose. `cron-schedules.test.ts` reads a connection
 * string at module scope and needs a database, which is why the pin was
 * deferred; a `readFileSync` assertion needs neither, so it runs bare on every
 * `npm test` with no `ALLOW_REMOTE_TESTS` and no stack.
 *
 * CR-01 — the port guard parsing the connection string outside a `try`, so an
 * uncaught `ERR_INVALID_URL` printed the whole value — is exactly the class of
 * regression a source-level pin catches, and it is pinned below.
 * ------------------------------------------------------------------------- */

const SOURCE = readFileSync('scripts/cron-status.mjs', 'utf8');

/**
 * Comments stripped before every rule below.
 *
 * The file's header exists to explain WHY nothing is printed, and it names the
 * things it refuses to print in order to name them. A rule that read the
 * comments would be obeyed by deleting the explanation.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('scripts/cron-status.mjs — read-only and credential-free by construction', () => {
  it('never reads or prints the raw command column', () => {
    // `cron.job.command` embeds the tick's bearer token. The only sanctioned
    // reference to it is the server-side `substring(...)` that extracts the URL
    // literal, so the headers never cross the wire.
    const mentions = CODE.match(/\bcommand\b/g) ?? [];
    const guarded = CODE.match(/substring\(command from/g) ?? [];
    expect(mentions).toHaveLength(guarded.length);
    expect(guarded.length).toBeGreaterThan(0);

    expect(CODE).not.toMatch(/console\.(log|error)\([^)]*command/);
  });

  it('reduces every extracted URL to origin + path, never the query string', () => {
    // A callback URL carrying `?token=` leaks the moment this output is pasted
    // into an evidence log, which is what this script is for.
    expect(CODE).toContain('parsed.origin + parsed.pathname');
    expect(CODE).not.toMatch(/\.href|\.search\b|\btoString\(\)/);
  });

  it('writes nothing — this script is not a second writer of cron.job', () => {
    // `apply-cron-schedules.mjs` is the only sanctioned writer, and it replaces
    // jobs by name. A mixed state found here is recovered by re-running that,
    // never by editing the catalog from this script.
    expect(CODE).not.toMatch(/cron\.(schedule|unschedule|alter_job)/i);
    expect(CODE).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it('contains no hard-coded origin — the URL is env-supplied', () => {
    expect(CODE.match(/https?:\/\/[a-z0-9]/gi) ?? []).toEqual([]);
    expect(SOURCE).toContain('process.env.APP_BASE_URL');
  });

  it('parses MIGRATE_DATABASE_URL only inside a try, and never echoes it (CR-01)', () => {
    // An uncaught `new URL()` throw prints `ERR_INVALID_URL` with an `input:`
    // property holding the string it could not parse — here the connection
    // string, password included. A malformed value is what an operator has
    // while editing the env file, which is when they run this script.
    expect(CODE).toMatch(/try \{\s*\n\s*port = new URL\(url\)\.port;\s*\n\s*\} catch \{/);
    expect(CODE).not.toMatch(/if \(new URL\(url\)/);
    expect(CODE).toContain('MIGRATE_DATABASE_URL is not a parseable URL');
    // The failure names the variable and the docs page. Not the value.
    expect(CODE).not.toMatch(/fail\([^)]*\$\{url\}|console\.\w+\([^)]*\burl\b\)/);
  });

  it('names the same jobs the apply script owns (IN-06 in the interim)', () => {
    // Both lists are hand-maintained; a rename in the writer would make this
    // script print MISSING for a job that exists, with nothing to say so.
    const apply = readFileSync('scripts/apply-cron-schedules.mjs', 'utf8');

    for (const name of ['sm8-sync-tick', 'cadence-tick', 'messaging-reconcile', 'stalled-digest']) {
      expect(apply).toContain(`name: '${name}'`);
      expect(SOURCE).toContain(`'${name}'`);
    }
  });

  it('names the watchdog job the remote-test setup schedules', () => {
    // The other duplicated list: `tests/helpers/global-setup.ts` owns this name,
    // and an adopted-and-paused tick reads `active=f` for a reason this script
    // can only name if the two spellings agree.
    const globalSetup = readFileSync('tests/helpers/global-setup.ts', 'utf8');

    expect(globalSetup).toContain("'remote-test-watchdog'");
    expect(SOURCE).toContain("'remote-test-watchdog'");
  });
});
