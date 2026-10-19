/**
 * Did the proof email actually get delivered? (D-07)
 *
 * Usage:  npm run resend:email-status -- <resend-email-id>
 *
 * READS ONLY. One `GET /emails/{id}`, through the same `getEmailStatus`
 * wrapper the proof action uses — deliberately not a second call with a second
 * idea of what `delivered` means.
 *
 * ── THE EXIT CODES ARE THE POINT ────────────────────────────────────────────
 *
 *   0   it reached the recipient    the MSG-02 delivery evidence
 *   2   it did not (yet)            not delivered YET, or not delivered at all
 *   1   the read itself failed      bad id, bad key, provider unreachable
 *
 * "It reached the recipient" is `status.delivered`, decided in the wrapper and
 * not re-spelled here: `last_event` is the LATEST event, so `opened` and
 * `clicked` are post-delivery answers and exit 0 (WR-02).
 *
 * Resend's delivery event lands seconds to minutes after the send, so the
 * honest first answer is usually `queued` or `sent`. A runbook step that polls
 * this needs "not yet" and "the read is broken" to be different things — a loop
 * that retried on exit 1 would spin forever against a mistyped id, and a loop
 * that gave up on exit 2 would fail a send that was about to succeed. Hence
 * two failure codes rather than one.
 *
 * `bounced` also exits 2, and that is correct: it is not a delivery, and a
 * bounce on a freshly verified sending domain is exactly the finding that must
 * stop a go-live rather than be retried past.
 *
 * ── WHAT IT PRINTS ──────────────────────────────────────────────────────────
 *
 * The id (which the operator already has), the bounded `last_event`, the
 * recipient's DOMAIN and the created timestamp. Never the subject and never the
 * message — see the wrapper's header. This line gets pasted into
 * `docs/external-registrations.md`.
 */
import { register } from 'node:module';

import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
requireEnv('RESEND_API_KEY');

// Teach node the `@/` alias, then import the real module — the same one the
// proof action calls (verify-email-pipe.mjs:62).
register('./lib/ts-alias-hook.mjs', import.meta.url);
const { getEmailStatus } = await import('@/core/messaging/resend-emails');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [id] = process.argv.slice(2);
if (!id) {
  fail('Usage: npm run resend:email-status -- <resend-email-id>');
}

/**
 * Validated HERE rather than by Resend.
 *
 * A Resend email id is a uuid. The realistic mistake is pasting the adjacent
 * line from the terminal — a tenant uuid, or the provider id from an SMS — and
 * the failure for that is a `not_found` from the provider, which reads exactly
 * like "the email was never sent" at the moment an operator is deciding
 * whether the pipe works.
 */
if (!/^[0-9a-f-]{20,64}$/.test(id)) {
  fail(`That is not a Resend email id (expected a uuid), got: ${id}`);
}

const status = await getEmailStatus(id);

if (!status.ok) {
  fail(`resend read failed: ${status.reason}`);
}

console.log(
  `resend email ${status.id}: last_event=${status.lastEvent} ` +
    `to_domain=${status.toDomain ?? '-'} created_at=${status.createdAt ?? '-'}`,
);

// Spelled out rather than a ternary: these two exit codes ARE the contract
// this script publishes to the runbook, and `grep 'process.exit(2)'` is how
// somebody checks that the loop they are about to write is correct.
//
// THE PREDICATE IS THE WRAPPER'S. `status.delivered` rather than a second
// comparison against `last_event` here — `opened` and `clicked` are
// post-delivery events, and a script that exited 2 on them would tell an
// operator their proof email had not arrived moments after they read it.
if (status.delivered) {
  process.exit(0);
}
process.exit(2);
