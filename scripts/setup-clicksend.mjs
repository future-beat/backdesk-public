/**
 * Arm the messaging gateway: point ClickSend's inbound + delivery-receipt rules
 * at production, prove they can reach us, and (with `--activate`) flip the one
 * database row that turns real customer SMS on (MSG-01, MSG-04, D-04).
 *
 * Usage:
 *   node scripts/setup-clicksend.mjs --number +61491579212
 *   node scripts/setup-clicksend.mjs --number +61491579212 --activate
 *
 * ── WHY THIS IS A SCRIPT AND NOT A MIGRATION ────────────────────────────────
 *
 * The same argument `scripts/apply-cron-schedules.mjs` makes, and this file is
 * deliberately built in its mould: the values it writes embed a bearer token,
 * and a migration is a committed file. The inbound and DLR callback URLs carry
 * their secret AS A QUERY PARAMETER — ClickSend's automation rules POST to a URL
 * of our choosing and cannot send a header, so the URL is the only place an
 * authenticator can live. Committing that URL would commit the secret.
 *
 * It is also not a migration for a second reason the cron script does not have:
 * half of what this does is not in our database at all. Automation rules live in
 * ClickSend's account, which no migration can reach.
 *
 * ── WHAT IS AND IS NOT COMMITTED ────────────────────────────────────────────
 *
 * Committed: this file, containing no URL, no number and no secret.
 * Not committed: `APP_BASE_URL`, `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`,
 * `CLICKSEND_WEBHOOK_SECRET`, `CLICKSEND_DLR_SECRET`,
 * `MESSAGING_RECONCILE_SECRET`, `DATABASE_URL` — all read from the environment
 * at RUN time. The dedicated number arrives on the command line.
 * In ClickSend's account: the rule's `action_address` holds the interpolated
 * secret, which is inherent to a provider callback with no signing scheme and is
 * exactly why each endpoint has its OWN secret (the 04-01 four-bearer rule) —
 * a leaked one grants that endpoint's powers and nothing else.
 *
 * Nothing here prints a secret. Every URL passes through `mask()` on its way to
 * the console: the token is shown as its first four characters and an ellipsis,
 * which is enough to tell two secrets apart in a terminal and not enough to use.
 *
 * ── THE ORDER IS THE WHOLE DESIGN ───────────────────────────────────────────
 *
 * VERIFY, then POINT, then PROVE, then ARM — and the last step is a separate
 * word on the command line.
 *
 *   1. Verify the number is really on the account, by asking ClickSend.
 *   2. Verify the three production endpoints are DEPLOYED and hold their
 *      secrets, by sending each a deliberately wrong token and requiring a 401.
 *   3. Point the two automation rules at production, idempotently.
 *   4. Re-read the rules back and confirm exactly one of each.
 *   5. Only with `--activate`: upsert the global sms `messaging_config` row.
 *
 * Step 5 is gated behind a flag rather than run by default because it is the
 * step with a blast radius. `buildRoutingSender` reads that row once per tick;
 * setting `enabled = true` on a row carrying a from-address arms real messaging
 * for every connected client on the NEXT tick, with no deploy and no further
 * confirmation. Steps 1-4 are all reversible and none of them can send anything.
 * A single command that did all five would mean the only way to point the rules
 * — including re-pointing them after a secret rotation — is a command that also
 * turns customer messaging on.
 *
 * Step 2 is not defensive padding; it is the check that would have caught the
 * real thing. A rule pointing at a URL that 404s is a rule that looks correct in
 * ClickSend's dashboard and silently drops every customer reply — no error, no
 * dead letter, nothing on the triage screen, because the request never reaches
 * our code at all. A wrong-token POST distinguishes the three states precisely:
 * 401 means the route is deployed AND `getServerEnv()` parsed (so every required
 * secret is present in the deployment); 404 means the code is not deployed; 5xx
 * means it is deployed with an incomplete environment.
 *
 * ── RE-RUNNING IS SAFE, ALWAYS ──────────────────────────────────────────────
 *
 * Every write is a list-then-update-or-create. Rules are matched by
 * `rule_name`, updated in place via PUT when they differ and left alone when
 * they already match; the config row upsert conflicts on
 * `(channel, tenant_id) NULLS NOT DISTINCT`. Two consecutive runs produce the
 * same account state and the same row, and the second one says so.
 *
 * ── ROTATION ────────────────────────────────────────────────────────────────
 *
 * Rotating `CLICKSEND_WEBHOOK_SECRET` or `CLICKSEND_DLR_SECRET` means: update
 * the Vercel env, redeploy, then re-run this script WITHOUT `--activate`. The
 * rule's `action_address` is rewritten to carry the new token. In between, that
 * one endpoint 401s every callback ClickSend sends it — which is the reason the
 * two endpoints do not share a secret, and the reason the nightly
 * `messaging-reconcile` poll exists to recover what was missed.
 */
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

const API_BASE = 'https://rest.clicksend.com/v3';

/** Our two rules, matched by name on every re-run. */
const INBOUND_RULE_NAME = 'inbound-to-gateway';
const DLR_RULE_NAME = 'dlr-to-gateway';

/** A stalled provider call must not hang an ops run. */
const REQUEST_TIMEOUT_MS = 30_000;

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Arguments
 * -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const ACTIVATE = args.includes('--activate');

const numberIndex = args.indexOf('--number');
const NUMBER = numberIndex === -1 ? undefined : args[numberIndex + 1];

if (!NUMBER) {
  fail(
    'Missing --number.\n' +
      '  Usage: node scripts/setup-clicksend.mjs --number +61XXXXXXXXX [--activate]\n' +
      '  The number is the dedicated AU virtual number, in E.164 form.',
  );
}

/**
 * E.164 AU, validated HERE rather than by ClickSend.
 *
 * A local number (`0491…`) is the realistic typo, and it is the one that fails
 * furthest from here: the rules would be pointed correctly, the config row would
 * read `enabled = true`, and every send would be refused by the provider one at
 * a time with the failure recorded per message rather than as a setup error.
 */
if (!/^\+61\d{9}$/.test(NUMBER)) {
  fail(
    `--number must be an AU number in E.164 form (+61 followed by 9 digits), got: ${NUMBER}\n` +
      '  A leading 0 is a local number, not E.164 — +61491579212, never 0491579212.',
  );
}

/* -------------------------------------------------------------------------- *
 * Environment
 * -------------------------------------------------------------------------- */

// ALL missing names at once, for the reason apply-cron-schedules.mjs states:
// failing on the first makes an operator run this twice to learn two facts that
// were both knowable on the first run.
const REQUIRED = [
  'CLICKSEND_USERNAME',
  'CLICKSEND_API_KEY',
  'CLICKSEND_WEBHOOK_SECRET',
  'CLICKSEND_DLR_SECRET',
  'MESSAGING_RECONCILE_SECRET',
  'APP_BASE_URL',
  'DATABASE_URL',
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(`Not set: ${missing.join(', ')} — see docs/env-vars.md`);
}

let origin;
try {
  const parsed = new URL(process.env.APP_BASE_URL);
  if (parsed.protocol !== 'https:') {
    fail(`APP_BASE_URL must be https (got ${parsed.protocol}//).`);
  }
  origin = parsed;
} catch {
  fail('APP_BASE_URL is not a valid absolute URL (include the scheme).');
}

const AUTHORIZATION = `Basic ${Buffer.from(
  `${process.env.CLICKSEND_USERNAME}:${process.env.CLICKSEND_API_KEY}`,
).toString('base64')}`;

/** The three callback/tick URLs. Built once; never printed unmasked. */
const INBOUND_URL = `${new URL('/api/webhooks/clicksend/inbound', origin).toString()}?token=${process.env.CLICKSEND_WEBHOOK_SECRET}`;
const DLR_URL = `${new URL('/api/webhooks/clicksend/dlr', origin).toString()}?token=${process.env.CLICKSEND_DLR_SECRET}`;
const RECONCILE_URL = new URL('/api/internal/messaging-reconcile', origin).toString();

/**
 * Show a URL with its token reduced to four characters.
 *
 * Four is enough to answer "did the rule pick up the new secret" after a
 * rotation and useless to anyone reading a terminal over a shoulder or a CI log.
 */
function mask(url) {
  return String(url).replace(/(token=)([^&]{0,4})[^&]*/, '$1$2…');
}

/* -------------------------------------------------------------------------- *
 * ClickSend HTTP
 * -------------------------------------------------------------------------- */

/**
 * One ClickSend call. Returns `{ status, body }` and NEVER throws on an HTTP
 * error — the caller decides what a status means, because "404 from a rule
 * update" and "404 from the account" are different problems with different
 * advice, and an exception here would flatten them into one stack trace.
 */
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: AUTHORIZATION,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // `e.name` only. A fetch rejection stringifies to a message that can carry
    // the request URL, and this URL is built from our credentials' account.
    fail(`ClickSend ${method} ${path} failed: ${e instanceof Error ? e.name : 'UnknownError'}`);
  }

  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Leave null — the caller reports the status, which is the diagnosable part.
  }
  return { status: res.status, body: parsed };
}

/* -------------------------------------------------------------------------- *
 * Step 1 — the number is really on the account
 * -------------------------------------------------------------------------- */

/**
 * `GET /v3/numbers` is the OWNED-numbers listing, established empirically on
 * 2026-08-29 rather than assumed: `/v3/numbers/dedicated`, `/v3/dedicated-
 * numbers`, `/v3/sms/numbers` and `/v3/my-numbers` all 404, while this path
 * answers `"Here are you dedicated numbers."` (ClickSend's typo) and returns
 * exactly the numbers the account holds. Recorded in
 * docs/external-registrations.md because 04-RESEARCH.md never captured it.
 */
async function verifyNumber() {
  console.log('\n1. Verifying the dedicated number is on the account…');

  const { status, body } = await api('GET', '/numbers');
  if (status !== 200) {
    fail(
      `  GET /v3/numbers returned ${status}.\n` +
        (status === 401 || status === 403
          ? '  The credentials were rejected. Check CLICKSEND_USERNAME and CLICKSEND_API_KEY.'
          : '  Cannot confirm the number exists, so nothing further is safe to configure.'),
    );
  }

  const rows = body?.data?.data ?? [];
  const match = rows.find((row) => row.dedicated_number === NUMBER);

  if (!match) {
    fail(
      `  ${NUMBER} is NOT on this ClickSend account.\n` +
        `  The account holds ${rows.length} dedicated number(s): ` +
        `${rows.map((row) => row.dedicated_number).join(', ') || '(none)'}\n` +
        '  Pointing rules or arming config for a number we do not own would produce\n' +
        '  a send refused per message rather than a setup error.',
    );
  }

  console.log(`   OK  ${NUMBER} — ${match.country} ${match.number_type}, status: ${match.status?.label}`);

  // A `longcode` can receive replies; an alphanumeric sender ID cannot, and the
  // entire product depends on replies (classification, pause-on-reply,
  // opt-out). Worth one line of output rather than an assumption.
  if (match.number_type && match.number_type !== 'longcode') {
    console.warn(
      `   WARNING: number_type is '${match.number_type}', not 'longcode'.\n` +
        '   Replies drive this system; confirm this number can receive them.',
    );
  }
}

/* -------------------------------------------------------------------------- *
 * Step 2 — production is deployed and holds its secrets
 * -------------------------------------------------------------------------- */

/**
 * A deliberately WRONG token, of the right length.
 *
 * The length matters: both webhook routes compare with `timingSafeEqual`, which
 * throws on unequal lengths, and the routes guard that with a length check that
 * returns false. A short token would still produce a 401, but a same-length one
 * exercises the comparison itself.
 */
const WRONG_TOKEN = '0'.repeat(64);

async function probe(label, url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { label, status: res.status };
  } catch (e) {
    return { label, status: 0, error: e instanceof Error ? e.name : 'UnknownError' };
  }
}

async function verifyEndpoints() {
  console.log('\n2. Verifying production endpoints are deployed and hold their secrets…');

  const results = await Promise.all([
    probe('inbound webhook', `${new URL('/api/webhooks/clicksend/inbound', origin)}?token=${WRONG_TOKEN}`, {
      method: 'POST',
      body: '{}',
    }),
    probe('dlr webhook', `${new URL('/api/webhooks/clicksend/dlr', origin)}?token=${WRONG_TOKEN}`, {
      method: 'POST',
      body: '{}',
    }),
    probe('messaging-reconcile', RECONCILE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${WRONG_TOKEN}` },
    }),
  ]);

  const bad = results.filter((r) => r.status !== 401);

  for (const r of results) {
    console.log(`   ${r.status === 401 ? 'OK ' : 'FAIL'} ${r.label}: ${r.error ?? r.status}${r.status === 401 ? ' (rejected a wrong token, as it must)' : ''}`);
  }

  // THIS CHECK RUNS FIRST, before the real-value probes below. A route that is
  // not deployed answers 404 to every token, right or wrong — diagnosing that as
  // "your secrets disagree" would send an operator to the Vercel env screen to
  // fix something that is not broken.
  if (bad.length > 0) {
    const has404 = bad.some((r) => r.status === 404);
    const has5xx = bad.some((r) => r.status >= 500);
    fail(
      '  Refusing to point ClickSend at endpoints that cannot answer.\n\n' +
        (has404
          ? `  A 404 means THE PHASE 4 CODE IS NOT DEPLOYED to ${origin.host}.\n` +
            '  Deploy first. A rule pointing at a 404 looks correct in ClickSend\'s\n' +
            '  dashboard and silently drops every customer reply — the request never\n' +
            '  reaches our code, so there is no dead-letter row and nothing on the\n' +
            '  triage screen to notice.\n\n'
          : '') +
        (has5xx
          ? '  A 5xx means the code IS deployed but `getServerEnv()` could not parse.\n' +
            '  The most likely cause is a required Phase 4 secret missing from the\n' +
            '  deployment environment: CLICKSEND_WEBHOOK_SECRET, CLICKSEND_DLR_SECRET,\n' +
            '  UNSUBSCRIBE_SIGNING_SECRET, MESSAGING_RECONCILE_SECRET (all min 32\n' +
            '  chars) or RESEND_API_KEY. Note this breaks the cadence tick too — every\n' +
            '  route calling getServerEnv() fails the same way.\n\n'
          : '') +
        '  Fix the above, then re-run this script.',
    );
  }

  /**
   * THE WRONG-TOKEN PROBE ABOVE PROVES "DEPLOYED", NOT "HOLDS THIS VALUE".
   *
   * That distinction is not academic — it is the failure this script hit on its
   * first real run. Every route answered 401 to a wrong token, so the deployment
   * was confirmed healthy, both rules were pointed at production carrying the
   * tokens from THIS environment, and the rules were read back and verified. All
   * of it correct, and all of it useless: the deployment held different values
   * for two of the four secrets, so every callback ClickSend ever sent to those
   * URLs would have been 401'd at the door. ClickSend does not report that back.
   * The dashboard shows a healthy rule; our logs show nothing, because the
   * request never reaches our code; and the first symptom is a customer's reply
   * that no human ever sees.
   *
   * So: probe with the REAL values and require a 200.
   *
   *   • The DLR route is the ideal probe subject — it has no write surface at
   *     all (04-04), so a real-token POST with an empty object proves the secret
   *     matches and cannot change a byte of any table.
   *   • `messaging-reconcile` is probed with its real bearer here as well as in
   *     step 7. The duplication is deliberate: step 7 reports counts and runs
   *     after the rules are pointed, and this must fail BEFORE anything is
   *     written to the ClickSend account.
   *   • The INBOUND webhook cannot be probed positively without writing a
   *     dead-letter row into a production table an operator triages from. It is
   *     left unprobed rather than given a fake customer reply to look at, and
   *     the shape capture in step 5 is what confirms its secret — a step whose
   *     "no row appeared" branch names this exact cause first.
   */
  const positives = await Promise.all([
    probe('dlr webhook (REAL token)', `${new URL('/api/webhooks/clicksend/dlr', origin)}?token=${process.env.CLICKSEND_DLR_SECRET}`, {
      method: 'POST',
      body: '{}',
    }),
    probe('messaging-reconcile (REAL bearer)', RECONCILE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.MESSAGING_RECONCILE_SECRET}` },
    }),
  ]);

  for (const r of positives) {
    console.log(`   ${r.status === 200 ? 'OK ' : 'FAIL'} ${r.label}: ${r.error ?? r.status}${r.status === 200 ? ' (the deployment holds THIS value)' : ''}`);
  }

  const mismatched = positives.filter((r) => r.status !== 200);
  if (mismatched.length > 0) {
    fail(
      '  The deployment does not hold the same secret(s) this environment does:\n' +
        mismatched.map((r) => `    - ${r.label}: ${r.error ?? r.status}`).join('\n') +
        '\n\n' +
        '  Refusing to point ClickSend at URLs carrying tokens the deployment will\n' +
        '  reject. Set the Vercel Production values to match this environment (or the\n' +
        '  reverse), REDEPLOY so the running functions pick them up, and re-run.\n' +
        '  A mismatch is invisible from both ends: ClickSend reports a healthy rule\n' +
        '  and we never see the request at all.',
    );
  }
}

/* -------------------------------------------------------------------------- *
 * Step 3 — the two automation rules
 * -------------------------------------------------------------------------- */

/**
 * Compare a field we intend against the value ClickSend echoes back.
 *
 * Loose on purpose: the API returns `null` where we send `''` and returns
 * numbers as numbers or strings depending on the field. A strict comparison
 * would report "differs" on every run and PUT an identical rule every time —
 * idempotency that writes.
 */
function same(intended, actual) {
  const norm = (v) => (v === null || v === undefined ? '' : String(v));
  return norm(intended) === norm(actual);
}

function differences(intended, actual) {
  return Object.keys(intended).filter((key) => !same(intended[key], actual?.[key]));
}

/**
 * List-then-update-or-create, matched by `rule_name`.
 *
 * `PUT /v3/automations/sms/{family}/{id}` and `DELETE` are both routed — probed
 * on 2026-08-29 against an id that cannot exist, which answered
 * `"Inbound rule not found."` / `"SMS receipt not found."` rather than a 405.
 */
async function upsertRule({ family, ruleName, intended, idField }) {
  const path = `/automations/sms/${family}`;

  const listed = await api('GET', path);
  if (listed.status !== 200) {
    fail(`  GET /v3${path} returned ${listed.status} — cannot configure ${family} rules.`);
  }

  const rules = listed.body?.data?.data ?? [];
  const existing = rules.find((rule) => rule.rule_name === ruleName);

  if (!existing) {
    const created = await api('POST', path, intended);
    if (created.status < 200 || created.status >= 300) {
      fail(
        `  POST /v3${path} returned ${created.status}: ${created.body?.response_msg ?? '(no message)'}\n` +
          `  Could not create the '${ruleName}' rule.`,
      );
    }
    console.log(`   CREATED  ${ruleName} -> ${mask(intended.action_address)}`);
    return { action: 'created', rule: created.body?.data ?? null, rules };
  }

  const drift = differences(intended, existing);
  if (drift.length === 0) {
    console.log(`   ALREADY CONFIGURED  ${ruleName} -> ${mask(existing.action_address)}`);
    return { action: 'unchanged', rule: existing, rules };
  }

  const id = existing[idField];
  const updated = await api('PUT', `${path}/${id}`, intended);
  if (updated.status < 200 || updated.status >= 300) {
    fail(
      `  PUT /v3${path}/${id} returned ${updated.status}: ${updated.body?.response_msg ?? '(no message)'}\n` +
        `  Could not update the '${ruleName}' rule (differs in: ${drift.join(', ')}).`,
    );
  }
  console.log(`   UPDATED  ${ruleName} (${drift.join(', ')}) -> ${mask(intended.action_address)}`);
  return { action: 'updated', rule: updated.body?.data ?? null, rules };
}

/**
 * Rules other than ours that could see the same message.
 *
 * ClickSend seeds a new account with default inbound rules — on this account, a
 * `Default rule` matching ANY message on ALL numbers, an `Opt-out contact` rule
 * moving STOP senders to a contact list, and a `Send to messenger` rule. Whether
 * ClickSend's engine runs every matching rule or stops at the first is the
 * question research A3 exists to answer, and it is not answerable from a rule
 * listing. So this REPORTS rather than deletes: a script that silently removed
 * an account's other automation would be making that decision on the operator's
 * behalf, and the STOP-handling rules in particular are the thing the live test
 * is designed to observe rather than pre-empt.
 */
function reportConflicts(rules) {
  const others = rules.filter(
    (rule) =>
      rule.rule_name !== INBOUND_RULE_NAME &&
      rule.enabled &&
      (rule.dedicated_number === '*' || rule.dedicated_number === NUMBER),
  );

  if (others.length === 0) return;

  console.log(
    `\n   NOTE: ${others.length} other enabled inbound rule(s) also match this number:`,
  );
  for (const rule of others) {
    console.log(
      `     - "${rule.rule_name}" on ${rule.dedicated_number} ` +
        `(search_type ${rule.message_search_type}` +
        `${rule.message_search_term ? `, term "${rule.message_search_term}"` : ''}) -> ${rule.action}`,
    );
  }
  console.log(
    '     Whether ClickSend runs every matching rule or stops at the first is\n' +
      '     research question A3 — the live STOP test answers it. The nightly\n' +
      '     messaging-reconcile sweep is the designed backstop either way.',
  );
}

async function configureRules() {
  console.log('\n3. Pointing the automation rules at production…');

  const inbound = await upsertRule({
    family: 'inbound',
    ruleName: INBOUND_RULE_NAME,
    idField: 'inbound_rule_id',
    intended: {
      // '*' rather than the number: a second number added later is covered
      // without a re-run, and there is exactly one gateway either way.
      dedicated_number: '*',
      rule_name: INBOUND_RULE_NAME,
      // 0 = any message. MESSAGE FILTERING IS OURS, NEVER THEIRS — `isStopMessage`
      // is an anchored whole-message regex we can test and version; a provider
      // -side "contains stop" would silently reclassify "please stop by Tuesday".
      message_search_type: 0,
      message_search_term: '',
      action: 'URL',
      action_address: INBOUND_URL,
      enabled: 1,
      webhook_type: 'json',
    },
  });

  reportConflicts(inbound.rules);

  const dlr = await upsertRule({
    family: 'receipts',
    ruleName: DLR_RULE_NAME,
    idField: 'receipt_rule_id',
    intended: {
      rule_name: DLR_RULE_NAME,
      // REQUIRED, and its absence is why the first live run 400'd with
      // "Invalid input." A receipts rule takes a `match_type` the inbound family
      // has no equivalent of: documented as "0=All reports", confirmed by the
      // validator, which rejects anything outside 0-2. 0 is the only correct
      // value here — a rule that matched only delivered reports would leave
      // every FAILURE unrecorded, which is the half of the delivery picture an
      // operator actually needs.
      match_type: 0,
      action: 'URL',
      action_address: DLR_URL,
      enabled: 1,
      // Deliberately ABSENT, unlike the inbound rule.
      //
      // `webhook_type` is not among the five properties ClickSend documents for
      // a receipts rule (rule_name, match_type, action, action_address,
      // enabled), and sending it is not harmless-but-ignored territory worth
      // guessing at: `differences()` would compare a field we sent against a
      // field the API never echoes and PUT the rule on every single run.
      // The consequence is that this rule uses ClickSend's DEFAULT transport,
      // documented as `post` — form-encoded, not JSON. The DLR route parses
      // both, for exactly that reason; see its header.
    },
  });

  // The receipts-rule field set is the least-documented thing here (the account
  // had zero of them, so nothing could be read from an example). Print what
  // ClickSend echoed back so the real shape is recorded the first time.
  if (dlr.rule && dlr.action !== 'unchanged') {
    const echoed = { ...dlr.rule };
    if (echoed.action_address) echoed.action_address = mask(echoed.action_address);
    console.log(`   DLR rule as ClickSend stored it: ${JSON.stringify(echoed)}`);
  }
}

/**
 * Read both rule families back and require exactly one of ours in each,
 * pointing where we intended.
 *
 * A separate read rather than trusting the write's response: the acceptance
 * criterion is a property of the ACCOUNT, and a POST that returned 200 having
 * stored something slightly different is precisely the failure this catches.
 */
async function verifyRules() {
  console.log('\n4. Reading the rules back…');

  const checks = [
    { family: 'inbound', ruleName: INBOUND_RULE_NAME, url: INBOUND_URL },
    { family: 'receipts', ruleName: DLR_RULE_NAME, url: DLR_URL },
  ];

  for (const check of checks) {
    const { status, body } = await api('GET', `/automations/sms/${check.family}`);
    if (status !== 200) fail(`  GET /v3/automations/sms/${check.family} returned ${status}.`);

    const ours = (body?.data?.data ?? []).filter((rule) => rule.rule_name === check.ruleName);

    if (ours.length !== 1) {
      fail(
        `  Expected exactly one '${check.ruleName}' rule, found ${ours.length}.\n` +
          '  Duplicates mean a callback is delivered more than once; remove the extras\n' +
          '  in the ClickSend dashboard and re-run.',
      );
    }
    if (ours[0].action !== 'URL' || !same(check.url, ours[0].action_address)) {
      fail(
        `  '${check.ruleName}' does not point where intended.\n` +
          `    stored:   ${ours[0].action} ${mask(ours[0].action_address)}\n` +
          `    intended: URL ${mask(check.url)}`,
      );
    }
    if (!ours[0].enabled) fail(`  '${check.ruleName}' exists but is disabled.`);

    console.log(`   OK  exactly one '${check.ruleName}', enabled, -> ${mask(ours[0].action_address)}`);
  }
}

/* -------------------------------------------------------------------------- *
 * Step 5 — payload-shape capture (research A1/A2/A8)
 * -------------------------------------------------------------------------- */

/**
 * Ask ClickSend to manufacture an inbound message, then look for what arrived.
 *
 * The point is not the message; it is the SHAPE. Both webhook payloads are
 * parsed by deliberately tolerant zod schemas because nothing in this repository
 * had ever seen a real one (research A1/A2) — a dead-letter row here is the
 * cheapest possible way to learn which keys ClickSend actually sends, before a
 * customer's reply is the thing being parsed.
 *
 * ── A8, ANSWERED, AND THE FIRST ATTEMPT ASKED THE WRONG QUESTION ─────────────
 *
 * This endpoint is not "inject an inbound message into the account and see
 * whose rules fire". It takes `{ url, webhook_type }` and posts a sample
 * payload STRAIGHT at the URL you name — nothing else. The first version of
 * this function sent `{ to, from, body, message_id }` and was answered with
 * `400 Invalid input.`, which read as "A8 answered: no" when it actually meant
 * "wrong arguments". Worth stating plainly, because the failure was
 * indistinguishable from the finding it was mistaken for.
 *
 * Two consequences follow from what it really is:
 *
 *   • It bypasses the automation rules entirely, so it proves the URL, the
 *     token and OUR parse — not that the rule is wired. The rule is proven by
 *     the readback above and by the live test.
 *   • `webhook_type` is ours to choose here, so we pass the same `json` the
 *     inbound rule stores. Passing anything else would capture the shape of a
 *     transport the rule will never use.
 *
 * KEYS ONLY are printed, never values: a captured payload contains a phone
 * number and a message body (T-2-02).
 */
async function captureShape(sql, startedAt) {
  console.log('\n5. Capturing the inbound payload shape (research A1/A2)…');

  const { status, body } = await api('POST', '/sms/inbound', {
    url: INBOUND_URL,
    // The transport the RULE stores, so what lands here is what a real reply
    // will land as.
    webhook_type: 'json',
  });

  if (status < 200 || status >= 300) {
    console.log(
      `   POST /v3/sms/inbound returned ${status}: ${body?.response_msg ?? '(no message)'}\n` +
        '   No sample was sent, so the shape is captured by the live handset test\n' +
        '   instead; the tolerant schemas hold either way.',
    );
    return;
  }

  console.log(`   POST /v3/sms/inbound accepted (${status}). Waiting 5s for the callback…`);
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  const rows = await sql`
    SELECT attribution, is_stop, raw_payload IS NOT NULL AS has_raw, raw_payload, created_at
    FROM inbound_messages
    WHERE created_at >= ${startedAt}
    ORDER BY created_at DESC
    LIMIT 5
  `;

  if (rows.length === 0) {
    console.log(
      '   No inbound_messages row appeared, and ClickSend posted the sample DIRECTLY\n' +
        '   at the URL — so the rule is not what failed. Either the deployment holds a\n' +
        '   different CLICKSEND_WEBHOOK_SECRET than this environment (the callback 401s\n' +
        '   and ClickSend does not report that back to us), or the route errored. Check\n' +
        '   the secret first: it is the failure that leaves no trace anywhere.',
    );
    return;
  }

  console.log(`   ${rows.length} new inbound_messages row(s) — the callback ARRIVED and parsed:`);
  for (const row of rows) {
    // The KEY SET is the diagnosis; the values are a customer's number and words.
    const keys =
      row.raw_payload && typeof row.raw_payload === 'object'
        ? Object.keys(row.raw_payload).sort().join(', ')
        : '(none — payload parsed cleanly against the current schema)';
    console.log(`     attribution=${row.attribution} is_stop=${row.is_stop} raw_payload keys: ${keys}`);
  }
}

/* -------------------------------------------------------------------------- *
 * Step 6 — activation (--activate only)
 * -------------------------------------------------------------------------- */

/**
 * The global sms `messaging_config` row.
 *
 * THIS SQL MUST STAY COLUMN-IDENTICAL TO `upsertChannelConfig`
 * (src/db/repository/messaging-config.ts). The repository is TypeScript and this
 * is a plain `.mjs` ops script with no build step, so the statement is written
 * out rather than imported — which makes "identical" a thing a human maintains.
 * What must not drift:
 *
 *   • The conflict target is `(channel, tenant_id)`, inferring the
 *     `NULLS NOT DISTINCT` unique constraint. Without that clause Postgres
 *     treats NULLs as distinct, every run INSERTs another "global" row, and
 *     `getChannelConfig` returns whichever the planner picks — this system
 *     sending from an arbitrary one of two numbers, with no error anywhere.
 *   • The SET list is EXHAUSTIVE over the mutable columns. The repository
 *     coalesces absent fields to their defaults rather than leaving them alone,
 *     because an upsert here is a caller stating the whole identity. A partial
 *     update that kept a previous `from_address` would let a re-run with a new
 *     number leave the old one live.
 *
 * `reply_to` and `business_name` are NULL deliberately. `reply_to` is email-only
 * (a virtual number receives its own replies). `business_name` is an OVERRIDE —
 * null means fall back to `tenants.name`, which is the name the operator typed
 * at onboarding and the one the Spam Act identification in the message copy
 * uses. Writing a value here would identify every client as the same business.
 *
 * The transaction pooler (`DATABASE_URL`, 6543) is correct for this, unlike
 * apply-cron-schedules.mjs which needs the session pooler: this is ordinary DML,
 * not a `cron.schedule` catalog write.
 */
async function activate(sql) {
  console.log('\n6. Arming the global sms config row (--activate)…');

  const [row] = await sql`
    INSERT INTO messaging_config (tenant_id, channel, from_address, reply_to, business_name, enabled)
    VALUES (NULL, 'sms', ${NUMBER}, NULL, NULL, true)
    ON CONFLICT (channel, tenant_id) DO UPDATE SET
      from_address = EXCLUDED.from_address,
      reply_to     = EXCLUDED.reply_to,
      business_name = EXCLUDED.business_name,
      enabled      = EXCLUDED.enabled,
      updated_at   = now()
    RETURNING id, tenant_id, channel, from_address, enabled, created_at, updated_at
  `;

  const created = row.created_at.getTime() === row.updated_at.getTime();
  console.log(
    `   ${created ? 'CREATED' : 'UPDATED'}  channel=${row.channel} tenant_id=${row.tenant_id ?? 'NULL (global)'} ` +
      `from_address=${row.from_address} enabled=${row.enabled}`,
  );

  // Read it back through a second statement, because the row IS the switch and
  // "the INSERT returned something" is a weaker claim than "the table holds
  // exactly this". A second global sms row would mean the arbiter is not doing
  // its job, which is invisible in a RETURNING clause.
  const all = await sql`
    SELECT id, tenant_id, from_address, enabled FROM messaging_config WHERE channel = 'sms'
  `;
  const globals = all.filter((r) => r.tenant_id === null);
  if (globals.length !== 1) {
    fail(
      `  Expected exactly one GLOBAL sms row, found ${globals.length}.\n` +
        '  The NULLS NOT DISTINCT arbiter is not doing its job — do not send until this is resolved.',
    );
  }
  console.log(`   OK  exactly one global sms row; ${all.length - 1} tenant override(s).`);
}

/**
 * What an authenticated reconcile tick reports right now.
 *
 * Before activation this returns `skipped: true` — the sweep's guard is total
 * and deliberate: no enabled sms row means no account to poll. After activation
 * it returns real counts. Both are worth seeing, because a 200 here is also the
 * proof that `MESSAGING_RECONCILE_SECRET` matches between this environment and
 * the deployment, which is the first thing to suspect when the cron job 401s.
 */
async function checkReconcile() {
  console.log('\n7. Calling messaging-reconcile with the real bearer…');

  let res;
  try {
    res = await fetch(RECONCILE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.MESSAGING_RECONCILE_SECRET}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn(`   Could not reach it: ${e instanceof Error ? e.name : 'UnknownError'}`);
    return;
  }

  const text = await res.text();
  if (res.status === 401) {
    console.warn(
      '   401 — MESSAGING_RECONCILE_SECRET here does not match the deployment.\n' +
        '   Fix before running `npm run cron:apply`, or the nightly job 401s silently\n' +
        '   while cron.job_run_details records success.',
    );
    return;
  }
  console.log(`   ${res.status} ${text.slice(0, 200)}`);
}

/* -------------------------------------------------------------------------- *
 * Run
 * -------------------------------------------------------------------------- */

console.log(`Target: ${origin.host}   Number: ${NUMBER}   Activate: ${ACTIVATE ? 'YES' : 'no'}`);

const startedAt = new Date();
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  connect_timeout: 30,
  max: 1,
  idle_timeout: 20,
});

try {
  await verifyNumber();
  await verifyEndpoints();
  await configureRules();
  await verifyRules();
  await captureShape(sql, startedAt);

  if (ACTIVATE) {
    await activate(sql);
  } else {
    console.log(
      '\n6. NOT arming the config row — `--activate` was not passed.\n' +
        '   The rules above are pointed and verified; nothing sends yet. Re-run with\n' +
        '   --activate when you are ready for the next cadence tick to send real SMS.',
    );
  }

  await checkReconcile();

  console.log('\nNext steps:');
  console.log('  1. npm run cron:apply    (applies the messaging-reconcile schedule alongside the two ticks)');
  if (!ACTIVATE) {
    console.log(`  2. node scripts/setup-clicksend.mjs --number ${NUMBER} --activate    (arms real sending)`);
  } else {
    console.log('  2. Run the live two-way + STOP proof from a handset (plan 04-07, Task 3).');
  }

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // The message can name a missing privilege or a constraint; it cannot contain
  // a secret, because every statement carrying one is parameterised and every
  // URL printed goes through `mask()`.
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
}
