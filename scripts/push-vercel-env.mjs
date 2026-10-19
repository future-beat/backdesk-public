/**
 * Push environment values from `.env.local` into a Vercel environment without
 * any of them passing through a terminal, a shell history, a process argument
 * list or an agent's context.
 *
 * Usage:
 *   node scripts/push-vercel-env.mjs --project backdesk \
 *     --envs production,preview \
 *     CLICKSEND_WEBHOOK_SECRET CLICKSEND_DLR_SECRET \
 *     --public APP_BASE_URL=https://app.backdesk.com.au
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `scripts/setup-clicksend.mjs` documents the rotation story as three steps —
 * "update the Vercel env, redeploy, then re-run this script" — and only ever
 * implemented the third. This is the first. It also closes the failure that
 * produced this file: on 2026-08-29 the four Phase 4 secrets existed in Vercel
 * Production and held DIFFERENT VALUES from `.env.local`, which is invisible
 * from both ends (a wrong-token probe and a right-token probe both return 401
 * from a route holding a different secret, and ClickSend reports a healthy rule
 * either way). Hand-copying four 64-character secrets through a dashboard is
 * exactly the operation that produces that state.
 *
 * ── THE VALUES ARE NEVER SEEN, BY DESIGN AND NOT BY DISCIPLINE ──────────────
 *
 * A value goes from `process.env` (populated by `loadEnvFile`) straight into
 * the Vercel CLI's STDIN. It is never interpolated into a command string, never
 * passed as `--value` (argv is world-readable via `ps`), never logged, and
 * never returned. The only things printed are the variable's NAME, its LENGTH,
 * and what happened to it.
 *
 * Length is printed rather than a masked prefix. Four leading characters are
 * the conventional "enough to tell two secrets apart" compromise, and they are
 * also four characters of a secret on a screen and in a scrollback buffer. A
 * length catches the realistic accident this script can cause — a truncated or
 * whitespace-padded paste — and reveals nothing.
 *
 * Nothing here reports whether the pushed value MATCHES the deployment. That
 * question has a real answer already, and it is a stronger one than any
 * fingerprint: `setup-clicksend.mjs` step 2 probes the live endpoints with the
 * real tokens and requires a 200. Run it after the redeploy.
 *
 * ── SECRET vs CONFIG ────────────────────────────────────────────────────────
 *
 * Positional names are stored `--sensitive` (Vercel type `Secret`): write-only,
 * unreadable afterwards even by us, which is right for a bearer token.
 * `--public NAME=value` stores `--no-sensitive` (type `Config`): readable in
 * the dashboard, which is right for `APP_BASE_URL` — a URL that appears in
 * every unsubscribe link is not a secret, and being able to READ it back is the
 * whole point when the bug you are chasing is "which host did production mint
 * that link against".
 *
 * ── AFTERWARDS ──────────────────────────────────────────────────────────────
 *
 * A running deployment does not pick up an environment change. REDEPLOY, then
 * re-run `npm run clicksend:setup`, which fails closed if the deployment still
 * disagrees.
 */
import { spawn } from 'node:child_process';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Rely on ambient env — the CI/one-off case where values arrive another way.
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Arguments
 * -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);

let project;
let envs = 'production';
/** Names whose value is read from the environment and stored as a Secret. */
const secretNames = [];
/** `[name, value]` pairs given literally on the command line, stored as Config. */
const publicPairs = [];

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--project') {
    project = argv[++i];
  } else if (arg === '--envs') {
    envs = argv[++i];
  } else if (arg === '--public') {
    const pair = argv[++i] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) fail(`--public expects NAME=value, got: ${pair}`);
    publicPairs.push([pair.slice(0, eq), pair.slice(eq + 1)]);
  } else if (arg.startsWith('--')) {
    fail(`Unknown option: ${arg}`);
  } else {
    secretNames.push(arg);
  }
}

if (!project) fail('Missing --project <name>. Example: --project backdesk');
if (secretNames.length === 0 && publicPairs.length === 0) {
  fail('Nothing to push. Pass variable names positionally and/or --public NAME=value.');
}

// ALL missing names at once — the same argument apply-cron-schedules.mjs makes:
// failing on the first would make an operator run this twice to learn two facts
// that were both knowable on the first run.
const missing = secretNames.filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(
    `Not set in .env.local or the ambient environment: ${missing.join(', ')}\n` +
      '  Nothing was pushed. See docs/env-vars.md.',
  );
}

/* -------------------------------------------------------------------------- *
 * The push
 * -------------------------------------------------------------------------- */

/**
 * One `vercel env add`, with the value delivered over stdin.
 *
 * `--force` overwrites an existing variable for the same target rather than
 * erroring, which makes this re-runnable and — more importantly — makes the
 * overwrite ATOMIC from the deployment's point of view. The alternative,
 * `env rm` followed by `env add`, leaves a window in which the variable does
 * not exist at all; a deployment triggered inside that window fails
 * `getServerEnv()` and every route 500s, including the two cadence ticks.
 *
 * Output is captured rather than inherited. The CLI echoes back what it stored
 * on some paths, and a stray value in a terminal is the one thing this script
 * exists to prevent — so its output is read, and only its exit status and a
 * value-free summary line are printed.
 */
function pushOne(name, value, sensitive) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      [
        'vercel',
        'env',
        'add',
        name,
        envs,
        '--force',
        sensitive ? '--sensitive' : '--no-sensitive',
        '--project',
        project,
        '--yes',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stderr = '';
    // Drain stdout without keeping it: the CLI's progress chatter is not worth
    // the risk of echoing a stored value back onto the screen.
    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (e) => resolve({ ok: false, detail: e.name }));
    child.on('close', (code) => {
      if (code === 0) return resolve({ ok: true });
      // Report only the LAST line of stderr and only after checking it does not
      // contain the value — a CLI that echoes a rejected value into an error
      // message would otherwise defeat everything above.
      const lastLine = stderr.trim().split('\n').filter(Boolean).pop() ?? `exit ${code}`;
      const safe = lastLine.includes(value) ? `exit ${code} (message redacted: it contained the value)` : lastLine;
      resolve({ ok: false, detail: safe });
    });

    child.stdin.end(value);
  });
}

console.log(`Project: ${project}   Environments: ${envs}`);
console.log(`Pushing ${secretNames.length} secret(s) and ${publicPairs.length} config value(s).\n`);

const jobs = [
  ...secretNames.map((name) => ({ name, value: process.env[name], sensitive: true })),
  ...publicPairs.map(([name, value]) => ({ name, value, sensitive: false })),
];

let failures = 0;

// Serially, not in parallel. These are writes to one project's environment and
// a partial concurrent failure is harder to reason about than a slow run.
for (const job of jobs) {
  const kind = job.sensitive ? 'secret' : 'config';
  const result = await pushOne(job.name, job.value, job.sensitive);
  if (result.ok) {
    console.log(`   OK    ${job.name}  (${kind}, ${job.value.length} chars)`);
  } else {
    failures += 1;
    console.error(`   FAIL  ${job.name}  (${kind}): ${result.detail}`);
  }
}

if (failures > 0) {
  fail(
    `\n${failures} of ${jobs.length} did not push. The rest DID — the environment is now\n` +
      '  partially updated. Re-run this command; it is safe to repeat.',
  );
}

console.log('\nAll pushed. Two things remain, and neither is optional:');
console.log('  1. REDEPLOY — a running deployment holds the values it booted with.');
console.log('  2. npm run clicksend:setup — its step 2 probes production with the real');
console.log('     tokens and fails closed if the deployment still disagrees.');
