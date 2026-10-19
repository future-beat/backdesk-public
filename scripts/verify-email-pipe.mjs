/**
 * The D-02 proof for plan 04-05: ONE REAL EMAIL, through the ACTUAL
 * `TouchSender` path (MSG-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT MAKES THIS A PROOF RATHER THAN A DEMO                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * It calls `ResendSender.send()` — the same object `buildRoutingSender` hands to
 * dispatch on a real cadence tick — with a real `SendRequest`, against the real
 * Resend account, using the real `messaging_config` row for the named tenant. A
 * script that re-implemented the message would prove only that the script works;
 * D-02 says MSG-02 is not complete until the pipe has carried something.
 *
 * Every unit test in `tests/resend-sender.test.ts` mocks the SDK. The seam
 * NOTHING in this repository can close is whether a real Resend response carries
 * the fields the installed types promise, and whether a real receiving server
 * accepts SPF/DKIM on the verified domain. That closes here, or it does not
 * close at all.
 *
 * ── IT REFUSES MORE OFTEN THAN IT SENDS, AND THAT IS THE DESIGN ─────────────
 *
 *   no `messaging_config` email row for the tenant → refuse
 *   the row has no reply-to (D-01) or no business name (Spam Act) → refuse
 *   no `APP_BASE_URL` or `UNSUBSCRIBE_SIGNING_SECRET` → refuse
 *   the from-address is on `resend.dev` → REFUSE LOUDLY
 *
 * That last one is the reason this file exists in the shape it does. Resend's
 * onboarding sender works before any domain is verified — but only to the
 * ACCOUNT OWNER's own inbox. A "successful" proof carried by it would prove
 * nothing about client-facing mail while looking exactly like a proof that did,
 * and the claim it would underwrite is one made to a paying tradie about their
 * customers. `ResendSender` refuses the same address for the same reason; this
 * check exists so the refusal is a sentence rather than a `failed` outcome.
 *
 * ── THE UNSUBSCRIBE LINK IN THE PROOF EMAIL IS DELIBERATELY INERT ───────────
 *
 * The token is minted over (tenant, a random cadence uuid), so it is a genuine,
 * verifiable, one-click-compliant link whose POST resolves to `no_cadence` and
 * writes nothing. Pointing it at a real cadence would mean the proof
 * permanently suppresses a real customer if anyone clicks it.
 *
 * `--cadence <uuid>` OPTS OUT OF THAT, and only for a cadence you created to be
 * clicked. It mints the token over the named cadence instead, which makes the
 * link LIVE: the POST stops that cadence and suppresses its contact on BOTH
 * channels, permanently, for anyone who clicks it — including a mail client
 * prefetching links. DOM-04 asks for a real one-click suppression observed on
 * production, and this is how it is produced, against a cadence whose contact
 * is the operator's own (10-RESEARCH.md Q6, option A+).
 *
 * The flag is guarded three ways before anything is sent: the id must be a
 * uuid, the cadence must belong to `--tenant` (the repository is tenant-scoped,
 * so another tenant's cadence simply is not found), and its status must be
 * `active` or `paused` — suppressing the contact of an already-stopped cadence
 * proves nothing and still blocks a person. All three run BEFORE the identity
 * is resolved and long before the send, so a refusal costs nothing.
 *
 * Usage:
 *   node scripts/verify-email-pipe.mjs --tenant <tenant-uuid> --to <address>
 *   node scripts/verify-email-pipe.mjs --tenant <uuid> --to <address> --cadence <uuid>
 *
 * The `--to` address should be one you control. This sends a real email.
 */
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';

import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
const env = requireEnv(
  'RESEND_API_KEY',
  'APP_BASE_URL',
  'UNSUBSCRIBE_SIGNING_SECRET',
  'DATABASE_URL',
);

// Teach node the `@/` alias, then import the real modules.
register('./lib/ts-alias-hook.mjs', import.meta.url);
const { ResendSender, buildEmailMessage, isOwnerOnlySender, OWNER_ONLY_SENDER_DOMAIN } =
  await import('@/core/messaging/resend-sender');
const { resolveEmailIdentity } = await import('@/core/messaging/routing-sender');
const { verifyUnsubscribeToken } = await import('@/core/messaging/unsubscribe-token');
const { domainOfAddress } = await import('@/core/messaging/resend-domains');
const { forTenant, closeDb } = await import('@/db/repository');

/** `--tenant x --to y [--cadence z]`, with no dependency and no cleverness. */
function args(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--')) return null;
    parsed[argv[i].slice(2)] = argv[i + 1];
  }
  return parsed;
}

const parsed = args(process.argv.slice(2));
if (!parsed?.tenant || !parsed?.to) {
  console.error(
    'Usage: node scripts/verify-email-pipe.mjs --tenant <tenant-uuid> --to <address> [--cadence <uuid>]',
  );
  process.exit(1);
}

const TENANT_ID = parsed.tenant;
const TO = parsed.to;

/** Opt-in, and the only way this script's link can suppress anybody. */
const CADENCE_ID = parsed.cadence;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The two statuses a click can meaningfully act on (LIVE_CADENCE_STATUSES). */
const LIVE_STATUSES = ['active', 'paused'];

/**
 * OBVIOUSLY A PROOF, on purpose.
 *
 * Not plausible follow-up copy: this arrives in a real inbox, and a convincing
 * draft here would be indistinguishable from the approved messages Phase 5's
 * gate exists to produce. Copy authorship is ONB-03's, not this script's.
 */
const PROOF_BODY = [
  'This is a Backdesk pipeline test, not a real follow-up.',
  '',
  'It was sent through the same code path a live quote follow-up uses, to prove',
  'the email pipe works end to end: sender identity, reply-to, the Spam Act',
  'footer and the one-click unsubscribe headers.',
  '',
  'Nothing is expected of you. The unsubscribe link below is real and safe to',
  'click — it points at no live conversation.',
].join('\n');

let failed = false;

function fail(message) {
  console.error(`\n  FAIL — ${message}\n`);
  failed = true;
}

function pass(label, detail) {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

try {
  console.log(`\nVerifying the email pipe for tenant ${TENANT_ID} → ${TO}\n`);

  // --- 0. the cadence the one-click link will name --------------------------
  //
  // FIRST, deliberately: everything after this point costs something. The
  // identity resolution opens the database, and the send puts a real message in
  // a real inbox. A `--cadence` typo must be refused while nothing has
  // happened, which is also what makes the fictional-id refusal safe to run
  // against production as an acceptance check.
  let cadenceId = randomUUID();

  if (CADENCE_ID) {
    if (!UUID.test(CADENCE_ID)) {
      throw new Error(`--cadence must be a uuid, got: ${CADENCE_ID}`);
    }

    // Tenant-scoped by construction: `forTenant(t).cadences.getById(c)` filters
    // on BOTH ids, so another tenant's cadence is not "forbidden", it is simply
    // not found — and the refusal below says so without confirming it exists.
    const [cadence] = await forTenant(TENANT_ID).cadences.getById(CADENCE_ID);

    if (!cadence) {
      throw new Error(
        `--cadence ${CADENCE_ID} is not a cadence of tenant ${TENANT_ID}. Nothing was sent.`,
      );
    }

    if (!LIVE_STATUSES.includes(cadence.status)) {
      throw new Error(
        `--cadence ${CADENCE_ID} has status ${cadence.status}; only ` +
          `${LIVE_STATUSES.join(' or ')} can be stopped by a click. Suppressing the contact ` +
          'of a finished cadence blocks a person and proves nothing. Nothing was sent.',
      );
    }

    console.log(
      `\n  THIS LINK SUPPRESSES A REAL CONTACT ON BOTH CHANNELS: cadence ${cadence.id} ` +
        `(${cadence.status}) — the click stops the cadence and blocks its contact for good.\n` +
        '  Use this ONLY for a cadence you created to be clicked.\n',
    );

    cadenceId = CADENCE_ID;
  }

  // --- 1. identity-resolved -------------------------------------------------
  const identity = await resolveEmailIdentity(TENANT_ID);
  if (!identity) {
    throw new Error(
      'no usable email identity for this tenant. Open /settings/email and save an ' +
        'ENABLED row with a from-address on a verified domain, the tradie’s own ' +
        'reply-to (D-01) and their business name (Spam Act).',
    );
  }
  pass('identity-resolved', `${identity.businessName} <${identity.fromAddress}>`);

  // --- 2. not-the-owner-only-sender ----------------------------------------
  if (isOwnerOnlySender(identity.fromAddress)) {
    throw new Error(
      `the from-address is on ${OWNER_ONLY_SENDER_DOMAIN}, which Resend delivers only ` +
        'to the account owner. A proof carried by it says nothing about client-facing ' +
        'mail. Verify a real sending domain first (/settings/email).',
    );
  }
  pass('not-the-owner-only-sender', domainOfAddress(identity.fromAddress));

  // --- 3. the request, and the message it produces --------------------------
  const request = {
    ledgerId: 'verify-email-pipe',
    tenantId: TENANT_ID,
    quoteId: randomUUID(),
    // A RANDOM CADENCE by default: the link must verify and must suppress
    // nothing. `--cadence` is the only way this becomes a live id (step 0).
    cadenceId,
    touchNumber: 1,
    channel: 'email',
    to: { address: TO, contactName: null },
    body: PROOF_BODY,
  };

  const message = buildEmailMessage({
    request,
    identity,
    appBaseUrl: env.APP_BASE_URL,
    signingSecret: env.UNSUBSCRIBE_SIGNING_SECRET,
  });

  console.log('\n  Headers this send will carry:');
  for (const [name, value] of Object.entries(message.headers)) {
    console.log(`    ${name}: ${value}`);
  }
  console.log(`    From: ${message.from}`);
  console.log(`    Reply-To: ${message.replyTo}`);
  console.log(`    Subject: ${message.subject}\n`);

  // RFC 8058 requires the angle brackets in the header and forbids them in the
  // URL. Printing the exact command removes the one step an operator does by
  // hand at 200 characters of signed token — and a mis-stripped bracket is a
  // 400 that reads like a broken endpoint.
  const link = message.headers['List-Unsubscribe'].slice(1, -1);
  console.log(
    `  one-click POST: curl -sS -o /dev/null -w '%{http_code}\\n' -X POST '${link}' ` +
      "-H 'content-type: application/x-www-form-urlencoded' --data 'List-Unsubscribe=One-Click'\n",
  );

  // --- 4. token-round-trips -------------------------------------------------
  const token = new URL(link).searchParams.get('token');
  const subject = verifyUnsubscribeToken(token ?? '', env.UNSUBSCRIBE_SIGNING_SECRET);
  if (subject?.tenantId !== TENANT_ID || subject?.cadenceId !== request.cadenceId) {
    throw new Error('the minted unsubscribe token does not verify back to this request');
  }
  pass('token-round-trips', 'the link names this send and no other');

  // --- 5. the real send -----------------------------------------------------
  const sender = new ResendSender({
    apiKey: env.RESEND_API_KEY,
    appBaseUrl: env.APP_BASE_URL,
    signingSecret: env.UNSUBSCRIBE_SIGNING_SECRET,
    // The same resolver `buildRoutingSender` injects — not a copy.
    resolveEmailConfig: resolveEmailIdentity,
  });

  const outcome = await sender.send(request);

  if (outcome.kind !== 'sent') {
    throw new Error(
      `the provider refused it: ${outcome.reason} (retryable: ${outcome.retryable}). ` +
        'If the domain is still Resend-status "pending", this is the expected answer — ' +
        'record the exact reason above against the plan’s flagged assumption.',
    );
  }
  pass('real-send-accepted', `provider message id ${outcome.providerMessageId}`);

  console.log('\n  5/5 live assertions passed. Check the inbox: the footer must name');
  console.log('  the business, say "on behalf of", and carry a working unsubscribe link.\n');
} catch (e) {
  fail(e.message);
} finally {
  await closeDb();
  process.exit(failed ? 1 : 0);
}
