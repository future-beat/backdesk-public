/**
 * The A5 check and the CAP-01 rehearsal: does Twilio have a voice-capable AU
 * LOCAL number in Perth today, and what does it demand before selling it?
 *
 * Usage:  npm run twilio:numbers-search -- [--locality <name>]
 *
 * ONE GET. NOTHING IS BOUGHT.
 *
 * ── WHY A SCRIPT ────────────────────────────────────────────────────────────
 *
 * The console's "Find a Perth number" button asks the same question, but it
 * asks it for ONE client, from inside a server action, after four guards have
 * passed — which means it cannot be asked while the regulatory bundle is still
 * pending, and it cannot be asked by an operator who only wants to know whether
 * Perth inventory exists (research assumption A5) before promising a client a
 * local number. This is that question, on its own, repeatable and safe.
 *
 * The PURCHASE happens only from the console (claim-then-buy, plan 11-05). This
 * file has no write verb in it, pinned by `tests/ops-scripts.test.ts`, and it
 * must stay that way: a script that could buy a number is a script that can
 * buy one twice.
 *
 * ── WHAT IT PRINTS, AND WHAT IT CANNOT PRINT ────────────────────────────────
 *
 * One line per candidate: the number, its locality, its region and its
 * `address_requirements`. The number is OURS to buy — an unallocated Twilio
 * inventory number, not anybody's handset — so it is not personal information.
 *
 * It never prints the account SID, the auth token, the Authorization header or
 * the request URL (the URL carries the account SID). A fetch rejection
 * stringifies to a message that can carry the URL, so `e.name` only; a non-200
 * names the status and never the body, because a provider error body can echo
 * the request (T-11-14).
 *
 * ── SYDNEY EDGE, US1 REGION (D-10) ──────────────────────────────────────────
 *
 * Same host the REST client in `src/core/telephony/twilio-client.ts` reaches:
 * the Sydney edge in front of the US1 region. AU1 is deferred.
 *
 * Exit codes: 0 candidates printed; 1 refused or failed; 2 none for that
 * locality — the runbook's "try another WA town, or accept any WA 08" branch.
 */
import { loadEnv, requireEnv } from './lib/support.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Arguments — validated BEFORE a request is built
 * -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
let locality = 'Perth';
if (argv.length > 0) {
  if (argv.length !== 2 || argv[0] !== '--locality') {
    fail('Usage: npm run twilio:numbers-search -- [--locality <name>]');
  }
  locality = argv[1];
}

// Letters and spaces only: the value becomes a query parameter, and a
// locality is a town name. Anything else is a typo, not a place.
if (!/^[A-Za-z][A-Za-z ]{0,39}$/.test(locality)) {
  fail(`--locality must be letters and spaces (at most 40), got: ${locality}`);
}

/* -------------------------------------------------------------------------- *
 * The one request
 * -------------------------------------------------------------------------- */

loadEnv();
const env = requireEnv('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN');

const API_BASE = 'https://api.sydney.us1.twilio.com/2010-04-01';

/** The ONE provider path this script may request, under the account. */
const SEARCH_PATH = '/AvailablePhoneNumbers/AU/Local.json';

/** A stalled provider call must not hang a runbook step. */
const REQUEST_TIMEOUT_MS = 20_000;

async function search() {
  // `InLocality` is the one documented global filter; `AreaCode` / `InRegion`
  // are US/CA-only (RESEARCH correction 2).
  const query = `InLocality=${encodeURIComponent(locality)}&VoiceEnabled=true&PageSize=10`;

  let res;
  try {
    res = await fetch(
      `${API_BASE}/Accounts/${env.TWILIO_ACCOUNT_SID}${SEARCH_PATH}?${query}`,
      {
        method: 'GET',
        headers: {
          // Built here, at call time, and never stored, logged or returned.
          authorization: `Basic ${Buffer.from(
            `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
          ).toString('base64')}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (e) {
    fail(`twilio numbers search failed: ${e instanceof Error ? e.name : 'UnknownError'}`);
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

const { status, body } = await search();

if (status !== 200) {
  // 401 is a wrong credential pair; 403/404 on this resource before the
  // regulatory bundle is approved is itself A5 evidence — record the status.
  fail(`twilio numbers search returned ${status} — see docs/telephony-runbook.md`);
}

const list = Array.isArray(body?.available_phone_numbers) ? body.available_phone_numbers : [];

const field = (value) => (typeof value === 'string' && value !== '' ? value : '-');

if (list.length === 0) {
  console.log(`twilio numbers search: none for ${locality}`);
  process.exit(2);
}

console.log(`twilio numbers search: ${list.length} candidates for ${locality} (voice, AU local)`);
for (const n of list) {
  console.log(
    `${field(n?.phone_number)}  locality=${field(n?.locality)}  ` +
      `region=${field(n?.region)}  address_requirements=${field(n?.address_requirements)}`,
  );
}
process.exit(0);
