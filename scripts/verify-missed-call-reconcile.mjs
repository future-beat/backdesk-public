/**
 * One run of the nightly missed-call reconcile, on demand — the one-shot half
 * of the dropped-callback drill (Phase 11 success criterion 3).
 *
 * Usage:  npm run verify:missed-call-reconcile
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS A PRODUCTION WRITE. It runs the SAME `reconcileMissedCalls` the  │
 * │ nightly tick runs, against whatever database `.env.local` points at —    │
 * │ and the hosted Sydney database IS production.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY IT CALLS THE CORE AND HAS NO SQL OF ITS OWN ─────────────────────────
 *
 * The drill proves one claim: when Twilio's status callback never arrives, the
 * call-log reconcile completes the row anyway — once, without a duplicate. A
 * script that re-implemented the sweep would prove only that the script works
 * (the lesson `ts-alias-hook.mjs` records). So this file imports the real
 * module through the alias hook and calls it with no injected dependencies:
 * same guard (no active divert number → zero HTTP), same window, same upsert,
 * same recording alarm. What it can change is exactly what 02:00 AWST would
 * have changed a few hours later.
 *
 * ── THE S7 LINE ─────────────────────────────────────────────────────────────
 *
 * Before the sweep it asks the provider for the account's inbound calls over
 * the last 48 hours and prints the COUNT. A count of 1 or more after the
 * verification call proves the Sydney-edge, US1-region client sees calls made
 * to the number (research S7). Only the count: the call list carries callers'
 * numbers, and it is discarded unread.
 *
 * ── WHAT IT PRINTS ──────────────────────────────────────────────────────────
 *
 *   calls listed (inbound, 48h): N          (or the bounded reason code)
 *   reconcile: skipped=<bool> recovered=<n> recordings=<n|unknown> recordings_check_failed=<bool>
 *
 * `recovered` counts the inbound calls to one of our numbers in the 48-hour
 * window that the sweep actually RECOVERED (WR-06): inserted (the webhook never
 * saw it), completed (a dropped callback left the completion NULL), or adopted
 * (a dead letter, now attributed to its owner). A row that was already
 * attributed and complete is not touched and not counted: after a clean
 * verification call it reads 0. The drill's proof is still the row itself —
 * `missed-calls:recent` before and after shows the same row id, now
 * `completed_via reconcile`, with the row count unchanged — and the drill's
 * `recovered` is at least 1.
 *
 * Never a number, a CallSid list, a credential or a URL. Exit 0 when the run
 * completed (whatever it found), 1 when the modules or env could not be loaded
 * (the error's NAME only).
 */
import { register } from 'node:module';

import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
requireEnv('DATABASE_URL');
register('./lib/ts-alias-hook.mjs', import.meta.url);

console.log('NOTICE: this runs the SAME reconcileMissedCalls the nightly tick runs.');
console.log(
  'NOTICE: it may insert or complete missed_calls rows on the connected database — the hosted Sydney database is production.',
);

const WINDOW_MS = 48 * 60 * 60 * 1000;

let core;
let client;
let repository;
try {
  core = await import('../src/core/telephony/reconcile.ts');
  client = await import('../src/core/telephony/twilio-client.ts');
  repository = await import('@/db/repository');
} catch (e) {
  console.error(`verify:missed-call-reconcile could not load: ${e instanceof Error ? e.name : 'UnknownError'}`);
  process.exit(1);
}

let exitCode = 0;
try {
  const creds = client.twilioCredsFromEnv();
  if (creds === null) {
    console.log('calls listed (inbound, 48h): skipped — credentials unreadable');
  } else {
    const listed = await client.listInboundCalls({
      creds,
      since: new Date(Date.now() - WINDOW_MS),
    });
    console.log(
      listed.ok
        ? `calls listed (inbound, 48h): ${listed.items.length}`
        : `calls listed (inbound, 48h): failed — ${listed.reason}`,
    );
  }

  const result = await core.reconcileMissedCalls();
  console.log(
    `reconcile: skipped=${result.skipped} recovered=${result.missedCallsRecovered} ` +
      `recordings=${result.recordingsFound ?? 'unknown'} ` +
      `recordings_check_failed=${result.recordingsCheckFailed}`,
  );
} catch (e) {
  console.error(`verify:missed-call-reconcile failed: ${e instanceof Error ? e.name : 'UnknownError'}`);
  exitCode = 1;
} finally {
  await repository.closeDb().catch(() => {});
}
process.exit(exitCode);
