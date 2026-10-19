/**
 * The pre-arm balance check (D-10): one line, one GET, no credentials.
 *
 * Usage:  npm run clicksend:balance
 *
 * ── WHY A RUNBOOK STEP EXISTS FOR THIS ──────────────────────────────────────
 *
 * The first live SMS this system ever attempted failed with INSUFFICIENT_CREDIT
 * (Phase 9). Nothing was broken; the account simply had no money in it. That is
 * a fact which was knowable BEFORE the send, from a read that costs nothing,
 * and the reason it was not known is that no step asked. Arming a founding
 * client is the worst possible moment to discover it a second time: the tick
 * runs every minute, the refusal is recorded per message, and the operator is
 * on the phone.
 *
 * So this is the step that asks, and it runs before the switch is flipped.
 *
 * ── WHAT IT PRINTS, AND WHAT IT CANNOT PRINT ────────────────────────────────
 *
 * ONE line: the balance, its currency, the low-credit threshold and whether
 * auto-recharge is on. Auto-recharge is an OPERATOR choice made in ClickSend's
 * dashboard — this script reports it and never sets it (see COVERAGE.md).
 *
 * It never prints the username, the API key, the Authorization header or a URL.
 * The Authorization header is built from the two credentials, a fetch rejection
 * stringifies to a message that can carry the request URL, and the output of
 * this script is PASTED INTO AN EVIDENCE LOG — so a leak here is a leak into a
 * file somebody re-reads next quarter. `e.name` only, status codes only, and
 * never the response body: a provider error body can echo the request that was
 * authorised by the header (T-10-08).
 *
 * ── READ-ONLY BY CONSTRUCTION (T-10-10) ─────────────────────────────────────
 *
 * `setup-clicksend.mjs` is the only script permitted to change the ClickSend
 * account, and it announces every write it makes. This one is a read an
 * operator runs while nervous, minutes before arming, and it must be incapable
 * of changing the thing it is measuring. One GET, one path, no write verb in
 * the file — pinned by `tests/ops-scripts.test.ts`.
 *
 * ── THE FIELD NAMES ARE AN ASSUMPTION UNTIL THE FIRST RUN (A1) ──────────────
 *
 * `balance`, `_currency.currency_name_short`, `low_credit_amount` and
 * `auto_recharge` come from the OpenAPI mirror of ClickSend's spec, not from a
 * response this repository has seen — the official docs page 404'd during
 * research (10-RESEARCH.md Q8, MEDIUM confidence). So the not-found arm prints
 * the top-level keys the account endpoint ACTUALLY returned and exits 1, which
 * turns a wrong guess into a one-run correction instead of a silent `undefined`
 * in an evidence log. Keys only: a key name is not a value.
 */
import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
const env = requireEnv('CLICKSEND_USERNAME', 'CLICKSEND_API_KEY');

const API_BASE = 'https://rest.clicksend.com/v3';

/** The ONE path this script may request. */
const ACCOUNT_PATH = '/account';

/** A stalled provider call must not hang a runbook step. */
const REQUEST_TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const AUTHORIZATION = `Basic ${Buffer.from(
  `${env.CLICKSEND_USERNAME}:${env.CLICKSEND_API_KEY}`,
).toString('base64')}`;

/**
 * The `api()` helper from `setup-clicksend.mjs:203`, reduced to a GET.
 *
 * Same shape on purpose: it never throws on an HTTP status, because the caller
 * is the one that knows what a status means here, and it returns the parsed
 * body or `null` rather than letting a non-JSON error page become a stack
 * trace with a URL in it.
 */
async function get(path) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: {
        authorization: AUTHORIZATION,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    fail(`ClickSend GET /v3/account failed: ${e instanceof Error ? e.name : 'UnknownError'}`);
  }

  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Leave null — the status is the diagnosable part, and the body is not
    // ours to print.
  }
  return { status: res.status, body: parsed };
}

const { status, body } = await get(ACCOUNT_PATH);

if (status !== 200) {
  // The advice names the docs page rather than the two variables, because the
  // rule "no credential identifier appears inside a fail() or a console call"
  // is enforced by regex and a regex cannot tell a variable from prose about a
  // variable. An absolute rule that a machine can check beats a nuanced one it
  // cannot — and docs/env-vars.md is where the names live anyway.
  fail(
    `GET /v3/account returned ${status} — check the ClickSend credentials against ` +
      'docs/env-vars.md (401 is a wrong key; 403 is a key without account scope).',
  );
}

const data = body?.data ?? {};

if (data.balance === undefined || data.balance === null) {
  // A1 did not hold. Print the shape, not the contents.
  const keys = Object.keys(data).sort().join(', ');
  fail(
    `clicksend balance: field not found in response (keys: ${keys || 'none'}) — ` +
      'correct the field names in this script and record the correction.',
  );
}

const currency = data._currency?.currency_name_short ?? '?';
const threshold = data.low_credit_amount ?? '?';
const autoRecharge = data.auto_recharge ? 'on' : 'off';

console.log(
  `clicksend balance: ${data.balance} ${currency} ` +
    `(low-credit threshold ${threshold}, auto-recharge ${autoRecharge})`,
);
