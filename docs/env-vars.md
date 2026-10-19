# Environment variables

Copy this contract into `.env.local` (gitignored) and fill in real values.
All values come from the Supabase project in `ap-southeast-2` (Sydney).

> **Note:** this file stands in for `.env.example`, which the plan asked for but
> which could not be written — this workspace has a permission deny rule covering
> `.env*`. To create the real `.env.example`, copy the block below into it (it
> contains placeholders only, no secrets). `.gitignore` already has
> `!.env.example` so it will be tracked once it exists.

```bash
# --- Supabase API (Dashboard -> Project Settings -> API) ---
# Safe to expose to the browser (NEXT_PUBLIC_*). RLS is what protects the data.
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-publishable-key

# SECRET. Bypasses RLS by design — server-only, never NEXT_PUBLIC, never imported
# under src/app. Used only by scripts/ and test helpers.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key

# --- Postgres connections (Dashboard -> Connect) ---
# Two URLs on purpose (see 01-RESEARCH.md Pitfall 3):
#   DATABASE_URL         = Transaction pooler, port 6543 — serverless runtime queries.
#                          Transaction mode has no prepared statements or advisory locks.
#   MIGRATE_DATABASE_URL = Session / direct connection, port 5432 — drizzle-kit migrate.
#                          Applying DDL through 6543 fails or partially applies.
DATABASE_URL=postgresql://postgres.your-ref:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres
MIGRATE_DATABASE_URL=postgresql://postgres.your-ref:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres

# --- Operator account (chosen by you) ---
# The single console login. Created idempotently by scripts/create-operator.mjs.
# Public signups are disabled in the Supabase dashboard — this is the only user.
OPERATOR_EMAIL=operator@example.com
OPERATOR_PASSWORD=choose-a-strong-password

# --- Credential encryption (Phase 2) ---
#   CREDENTIALS_ENCRYPTION_KEY = AES-256-GCM key for encrypting each client's
#   ServiceM8 API key at rest. Generate with:  openssl rand -base64 32
#
#   Must decode to EXACTLY 32 bytes — the env schema validates the decoded
#   length, not the string length, because a 32-CHARACTER base64 string decodes
#   to 24 bytes and would otherwise fail inside createCipheriv mid-connect, with
#   a real client's key in hand.
#
#   LOSING THIS KEY MEANS EVERY STORED CLIENT CREDENTIAL IS UNRECOVERABLE and
#   every client must be re-connected by hand. Set the same value in the Vercel
#   project environment; back it up wherever the other production secrets live.
CREDENTIALS_ENCRYPTION_KEY=base64-32-bytes

#   SYNC_TICK_SECRET = shared bearer secret for the pg_cron -> /api/internal/
#   sync-tick route. Generate with:  openssl rand -hex 32
#   Consumed by plan 02-03; declared now so the env schema is edited once.
SYNC_TICK_SECRET=hex-32-bytes

# --- Cadence tick (Phase 3, CAD-01 / CAD-02) ---
#   CADENCE_TICK_SECRET = bearer secret for the pg_cron -> /api/internal/
#   cadence-tick route, which runs every MINUTE. Generate with:
#     openssl rand -hex 32
#
#   A SEPARATE value from SYNC_TICK_SECRET, and it must stay separate. The two
#   ticks are separate cron jobs so a slow ServiceM8 sync can never delay a
#   customer's follow-up; sharing one bearer would re-couple them at the one
#   moment the separation matters most — ROTATION. Rotating a shared secret 401s
#   both ticks until the redeploy lands: no client synced AND no customer
#   contacted. Two secrets means a rotation can only break the half it names.
#
#   Rotating this one: update .env.local, update the Vercel project env,
#   redeploy, then re-run `npm run cron:apply`. In between, the cadence tick
#   401s and sends pause — the sync tick is unaffected.
CADENCE_TICK_SECRET=hex-32-bytes

# --- Operator alerting (Phase 2, SYNC-04 / D-05) ---
#   RESEND_API_KEY       = resend.com -> API Keys. REQUIRED, deliberately: the
#                          phase guarantee is "no silent dead client", and an
#                          optional alert credential degrades that into "no
#                          silent dead client, unless the alert channel was
#                          also silently unconfigured".
#   OPERATOR_ALERT_EMAIL = where those alerts land. Until a domain is verified,
#                          Resend only delivers to the ACCOUNT OWNER's own
#                          address, so this must be that address.
RESEND_API_KEY=re_your_api_key
OPERATOR_ALERT_EMAIL=operator@example.com

# --- Public audit intake (Phase 9, LAND-03 / D-12, D-13) ---
#   OPERATOR_ALERT_PHONE = the OPERATOR'S OWN handset, E.164 (+61...). Where the
#                          "someone asked for an audit" SMS lands. REQUIRED for
#                          the same reason RESEND_API_KEY is: an optional
#                          notification number degrades "every request reaches
#                          the operator" into "unless it was silently unset".
#                          NEVER a customer's or a tradie's number — sendOperatorSms
#                          reads this variable directly and takes no recipient
#                          argument, so there is no parameter through which a
#                          form value could become a recipient.
#   AUDIT_IP_HASH_SALT   = 32+ characters; `openssl rand -hex 32`. The public
#                          form's throttle keys on sha256(salt:ip) and the raw
#                          address is never stored. The salt is what makes that
#                          non-reversible: the IPv4 space is small enough to
#                          enumerate in seconds, so an unsalted hash of an
#                          address IS the address. Production and local values
#                          need not match — rotating it only resets the current
#                          hour's counters.
#   CALLER_PSEUDONYM_PEPPER = 32+ characters; `openssl rand -hex 32` (Phase 15,
#                          COMP-02 / D-06). The key of the HMAC-SHA-256 that
#                          replaces a caller's number ninety days after their
#                          lead closes without converting
#                          (`src/core/leads/pseudonym.ts` takes it as an
#                          argument). A KEYED hash, not a salted digest: the AU
#                          mobile space is ~10^8 values, so a hash under a
#                          public salt IS the number. REQUIRED — a retention
#                          promise that silently does not run is worse than a
#                          loud deploy failure. Rotating it changes every
#                          future hash, so a rotation is a recorded decision,
#                          never a routine. Production and local values need
#                          not match (no suite compares a hash to production).
#
#   ALL THREE ARE ADDED TO .env.local BY HAND. The agent cannot read or write
#   any `.env*` file, so the local values are the founder's to set (the 06-02
#   STALLED_DIGEST_SECRET precedent); the production values are pushed with
#   `npm run env:push -- --project backdesk` and the salt and the pepper are
#   generated in a subshell so they never touch a file at all. The pepper is
#   pushed to Production AND Preview with
#   `node scripts/push-vercel-env.mjs --project backdesk --envs production,preview CALLER_PSEUDONYM_PEPPER`
#   and the ORDER is the rule: it must exist on Vercel BEFORE the Phase 15 code
#   deploys, or every route fails at `getServerEnv()`.
OPERATOR_ALERT_PHONE=+61400000000
AUDIT_IP_HASH_SALT=hex-32-bytes
CALLER_PSEUDONYM_PEPPER=hex-32-bytes

# --- Telephony capture (Phase 11) ---
#   Twilio Programmable Voice answers the per-client divert numbers (D-01).
#   FOUR REQUIRED KEYS, and only two of them are bearers:
#
#   TWILIO_ACCOUNT_SID                 = Twilio Console -> Account -> Account
#                                        Info. `AC` + 32 hex; the schema checks
#                                        the shape.
#   TWILIO_AUTH_TOKEN                  = Twilio Console -> Account -> Account
#                                        Info -> Auth Token. A SIGNING KEY, NOT A
#                                        BEARER: Twilio computes the
#                                        X-Twilio-Signature header with it over
#                                        the configured URL (token included) and
#                                        the form params, and both voice routes
#                                        verify with it. Nothing ever presents it
#                                        as a credential to us. (It is also the
#                                        REST client's password.)
#   TWILIO_VOICE_WEBHOOK_SECRET        = the `voice` route's URL query token.
#                                        Generate with:  openssl rand -hex 32
#   TWILIO_VOICE_STATUS_WEBHOOK_SECRET = the `voice-status` route's URL query
#                                        token. A DIFFERENT value:
#                                        openssl rand -hex 32 again. Rotating
#                                        one door must 401 that door alone.
#
#   HEX, AND ONLY HEX, for the two route tokens: the token sits INSIDE the URL
#   Twilio signs, so the number's configured Voice URL / Status Callback must be
#   byte-identical to what the route rebuilds from APP_BASE_URL. A 64-hex value
#   has no character that encodes differently anywhere. ENFORCED (WR-04): the
#   schema requires ^[0-9a-f]{64}$ for both keys, so a base64 value fails the
#   deploy's first getServerEnv() instead of the first live call.
#
#   APP_BASE_URL IS LOAD-BEARING HERE. The voice routes rebuild the signed URL
#   from APP_BASE_URL alone and FAIL CLOSED when it is unset (generic greeting,
#   no row, log `[twilio] voice base_url_unset`) — they never fall back to
#   VERCEL_PROJECT_PRODUCTION_URL, which can name the marketing apex.
#
#   OPTIONAL (provisioning only, plan 11-04 — absent means "refuse to buy"):
#   TWILIO_AU_BUNDLE_SID      = Console -> Phone Numbers -> Regulatory
#                               Compliance -> Bundles (`BU` + 32 hex), once the
#                               AU local-number bundle is approved
#   TWILIO_AU_ADDRESS_SID     = Console -> Phone Numbers -> Regulatory
#                               Compliance -> Addresses (`AD` + 32 hex)
#   TWILIO_VOICE_FALLBACK_URL = a TwiML Bin holding the GENERIC greeting, set as
#                               each number's voiceFallbackUrl at purchase
#
#   ADDED TO .env.local BY HAND (the agent cannot read or write `.env*`), then
#   pushed with:
#     node scripts/push-vercel-env.mjs --project backdesk --envs production,preview TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_VOICE_WEBHOOK_SECRET TWILIO_VOICE_STATUS_WEBHOOK_SECRET
#   and a redeploy. The four keys are REQUIRED members of the env schema, so a
#   deploy without them fails at the first getServerEnv() call.
#
#   ROTATING A ROUTE TOKEN IS A TWO-SIDED CHANGE, because the token is inside
#   the URL Twilio posts to: push the new value -> redeploy -> update EVERY
#   number's Voice URL (or Status Callback) in the Twilio Console -> one test
#   call. Between the redeploy and the Console edit the door 401s and Twilio
#   plays its application-error message (it does not retry a 4xx).
TWILIO_ACCOUNT_SID=AC-plus-32-hex
TWILIO_AUTH_TOKEN=from-twilio-console
TWILIO_VOICE_WEBHOOK_SECRET=hex-32-bytes
TWILIO_VOICE_STATUS_WEBHOOK_SECRET=hex-32-bytes
# TWILIO_AU_BUNDLE_SID=BU...
# TWILIO_AU_ADDRESS_SID=AD...
# TWILIO_VOICE_FALLBACK_URL=https://handler.twilio.com/twiml/EH...

#   OPTIONAL. The alert sender. Defaults to Resend's onboarding sender, which is
#   the only one permitted before a domain is verified. Set this once Phase 8
#   verifies quotes.backdesk.com.au (Plan 08-07) — it is a fact about the Resend
#   account, not about the program, so it must not require a code change.
# OPERATOR_ALERT_FROM=Backdesk <alerts@quotes.backdesk.com.au>

#   OPTIONAL. Console origin, used to build the client-detail link inside an
#   alert email AND, since Phase 4, the base of every one-click unsubscribe URL
#   (plan 04-05). Resolution order:
#     APP_BASE_URL -> VERCEL_PROJECT_PRODUCTION_URL (injected by Vercel)
#                  -> http://localhost:3000
#   VERCEL_URL is deliberately NOT used: it is unique per deployment and 404s
#   once superseded, and an alert email outlives the deployment that sent it.
#
#   SET THIS EXPLICITLY IN PRODUCTION. A wrong base still yields a working alert
#   email (the operator can navigate by hand); it yields a BROKEN OPT-OUT LINK,
#   which is a Spam Act problem in a message a customer received.
# APP_BASE_URL=https://app.backdesk.com.au

# --- Messaging gateway (Phase 4, MSG-03 / MSG-04) ---
#   FOUR SEPARATE SECRETS, and the separation is the same argument
#   CADENCE_TICK_SECRET makes, extended to six endpoints. Rotating one shared
#   value would 401 EVERY endpoint reading it until the redeploy lands: inbound
#   replies rejected (so a customer's STOP is dropped at the door), delivery
#   receipts rejected, unsubscribe links broken and the reconcile tick dead —
#   all four from one rotation. Four secrets means a rotation can only break the
#   endpoint it names.
#
#   Generate each with:  openssl rand -hex 32
#   Set the same value in the Vercel project environment (Production).
#
#   CLICKSEND_WEBHOOK_SECRET   = shared secret for the ClickSend inbound-SMS
#                                callback, LIVE at
#                                POST /api/webhooks/clicksend/inbound (04-02).
#                                Travels as a URL QUERY PARAMETER, not a Bearer
#                                header — ClickSend inbound rules POST to a URL
#                                we configure and cannot set headers, so the
#                                rule's callback URL ends `?token=<this value>`.
#                                REQUIRED — an optional webhook secret is an
#                                UNAUTHENTICATED PUBLIC ENDPOINT accepting
#                                forged STOPs and forged replies, wearing the
#                                same code path as the safe one.
#   CLICKSEND_DLR_SECRET       = secret for the delivery-receipt callback,
#                                POST /api/webhooks/clicksend/dlr (04-04).
#                                ALSO a URL QUERY PARAMETER, not a Bearer, and
#                                for the same reason as the inbound one above —
#                                the DLR rule's callback URL ends
#                                `?token=<this value>`. Configured without it,
#                                every delivery receipt 401s silently and the
#                                send_ledger delivery columns stay NULL.
#                                ITS OWN VALUE, never the inbound one: rotating
#                                a token that appears in access logs must 401
#                                one endpoint.
#   UNSUBSCRIBE_SIGNING_SECRET = HMAC key for one-click unsubscribe links
#                                (04-05). NOT a bearer, and it must never be set
#                                to one of the values above: this key signs URLs
#                                that travel inside customers' inboxes, so a
#                                bearer reused here is a bearer a customer holds.
#   MESSAGING_RECONCILE_SECRET = bearer for the pg_cron -> messaging reconcile
#                                tick (04-04)
#   STALLED_DIGEST_SECRET      = bearer for the pg_cron -> stalled-draft digest
#                                (06-02, CON-04). The sixth, and its own value:
#                                sharing the cadence tick's would mean rotating
#                                that secret also silences the digest that tells
#                                the operator drafts are piling up.
CLICKSEND_WEBHOOK_SECRET=hex-32-bytes
CLICKSEND_DLR_SECRET=hex-32-bytes
UNSUBSCRIBE_SIGNING_SECRET=hex-32-bytes
MESSAGING_RECONCILE_SECRET=hex-32-bytes
STALLED_DIGEST_SECRET=hex-32-bytes

#   OPTIONAL — the ClickSend account itself. Absent, every SMS sender falls back
#   to the stub, which is what keeps the whole pipeline buildable and testable
#   while the AU dedicated number is blocked on the IPND business-address
#   requirement (see .planning/STATE.md and docs/external-registrations.md).
#   Making these required would put a regulator's postal requirement on the
#   critical path of `npm test`.
#     CLICKSEND_USERNAME = ClickSend Dashboard -> Account -> your login username
#     CLICKSEND_API_KEY  = ClickSend Dashboard -> Developers -> API Credentials
# CLICKSEND_USERNAME=your-clicksend-username
# CLICKSEND_API_KEY=your-clicksend-api-key

# --- ServiceM8 test account (developer machines only) ---
#   SM8_TEST_API_KEY = private API key from a ServiceM8 trial account with
#   seeded jobs across all four statuses. Read ONLY by scripts/verify-sm8-
#   connect.mjs, scripts/sm8-spike.mjs and the integration tests. Never read by
#   application code — production keys come from sm8_connections, encrypted.
#   Generate at: ServiceM8 -> Settings -> API Keys.
SM8_TEST_API_KEY=your-trial-account-private-key
```

## Who reads what

| Variable | Read by | Exposed to browser |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/*`, scripts, tests | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/supabase/*`, scripts, tests | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | `scripts/*.mjs`, `tests/*` only | **never** |
| `DATABASE_URL` | `src/db/repository/client.ts` | **never** |
| `MIGRATE_DATABASE_URL` | `drizzle.config.ts` (migrations only), `scripts/cron-status.mjs`, `scripts/audit-requests-count.mjs`, `scripts/escalations-recent.mjs`, `scripts/cadence-status.mjs` (read-only probes) | **never** |
| `CREDENTIALS_ENCRYPTION_KEY` | `src/core/sync/connect.ts` via `getServerEnv()` | **never** |
| `SYNC_TICK_SECRET` | sync-tick route (plan 02-03) | **never** |
| `CADENCE_TICK_SECRET` | cadence-tick route (plan 03-06) via `getServerEnv()` | **never** |
| `RESEND_API_KEY` | `src/core/alerts/operator-email.ts`, `src/core/messaging/resend-domains.ts`, `src/core/messaging/resend-emails.ts` via `getServerEnv()`; `scripts/verify-email-pipe.mjs`, `scripts/resend-email-status.mjs` | **never** |
| `OPERATOR_ALERT_EMAIL` | `src/core/alerts/operator-email.ts` via `getServerEnv()` | **never** |
| `OPERATOR_ALERT_FROM` (optional) | `src/core/alerts/operator-email.ts` via `getServerEnv()` | **never** |
| `APP_BASE_URL` (optional) | `src/core/alerts/operator-email.ts`, unsubscribe links (plan 04-05) via `getServerEnv()` | **never** |
| `CLICKSEND_WEBHOOK_SECRET` | `src/app/api/webhooks/clicksend/inbound/route.ts` (plan 04-02) via `getServerEnv()`, compared in constant time against the `?token=` query parameter | **never** |
| `CLICKSEND_DLR_SECRET` | delivery-receipt callback route (plan 04-04) via `getServerEnv()` | **never** |
| `UNSUBSCRIBE_SIGNING_SECRET` | unsubscribe link signing/verification (plan 04-05) via `getServerEnv()` | **never** |
| `MESSAGING_RECONCILE_SECRET` | messaging reconcile tick route (plan 04-04) via `getServerEnv()` | **never** |
| `STALLED_DIGEST_SECRET` | stalled-draft digest route (plan 06-02) via `getServerEnv()` | **never** |
| `OPERATOR_ALERT_PHONE` | `src/core/alerts/operator-sms.ts` via `getServerEnv()` | **never** |
| `AUDIT_IP_HASH_SALT` | the public audit action via `src/core/intake/ip-hash.ts` (plan 09-03) via `getServerEnv()` | **never** |
| `CALLER_PSEUDONYM_PEPPER` | `src/core/leads/pseudonymise.ts` via the messaging-reconcile route's `getServerEnv()` (plan 15-07); the key reaches `src/core/leads/pseudonym.ts` as an argument | **never** |
| `TWILIO_ACCOUNT_SID` | `src/core/telephony/twilio-client.ts` (plan 11-02) via `getServerEnv()` | **never** |
| `TWILIO_AUTH_TOKEN` | `src/app/api/webhooks/twilio/voice/route.ts` and `src/app/api/webhooks/twilio/voice-status/route.ts` via `getServerEnv()` (signature key, not a bearer); `src/core/telephony/twilio-client.ts` (REST password) | **never** |
| `TWILIO_VOICE_WEBHOOK_SECRET` | `src/app/api/webhooks/twilio/voice/route.ts` via `getServerEnv()`, compared in constant time against `?token=`; `src/core/telephony/webhook-url.ts` builds the signed URL with it | **never** |
| `TWILIO_VOICE_STATUS_WEBHOOK_SECRET` | `src/app/api/webhooks/twilio/voice-status/route.ts` via `getServerEnv()`, compared in constant time against `?token=`; `src/core/telephony/webhook-url.ts` | **never** |
| `TWILIO_AU_BUNDLE_SID` (optional) | `src/core/telephony/provision.ts` (plan 11-04) via `getServerEnv()` | **never** |
| `TWILIO_AU_ADDRESS_SID` (optional) | `src/core/telephony/provision.ts` (plan 11-04) via `getServerEnv()` | **never** |
| `TWILIO_VOICE_FALLBACK_URL` (optional) | `src/core/telephony/provision.ts` (plan 11-04) via `getServerEnv()` | **never** |
| `CLICKSEND_USERNAME` (optional) | ClickSend SMS sender (plan 04-03) via `getServerEnv()`; `scripts/setup-clicksend.mjs`, `scripts/clicksend-balance.mjs` | **never** |
| `CLICKSEND_API_KEY` (optional) | ClickSend SMS sender (plan 04-03) via `getServerEnv()`; `scripts/setup-clicksend.mjs`, `scripts/clicksend-balance.mjs` | **never** |
| `SM8_TEST_API_KEY` | `scripts/verify-sm8-connect.mjs`, `scripts/sm8-spike.mjs`, `tests/*` | **never** |
| `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` | `scripts/*.mjs`, `tests/*` | **never** |
| `ALLOW_REMOTE_TESTS` | `tests/helpers/env.ts` | **never** |

Loading is dependency-free: Node 22's built-in `process.loadEnvFile()` reads
`.env.local`. Variables already present in `process.env` always win, so CI-provided
secrets override the file without any code change.

## Running the tests (`ALLOW_REMOTE_TESTS`)

`tests/helpers/env.ts` prefers `.env.test` and falls back to `.env.local`. Since
`.env.local` points at the **hosted Sydney project**, and the integration suites
create auth users and insert, update and delete rows with the **service-role
key**, a bare `npm test` against it is writing to production. Cleanup is
`afterAll`-only, so a Ctrl-C or a throwing `beforeAll` leaves seeded tenants
behind where the operator will see them in the console.

So the suites refuse to run against a non-local stack unless you say so:

| Command | Target | Notes |
|---|---|---|
| `npm test` | local stack only | Refuses, with the target named, if the URL is not `127.0.0.1` / `localhost`. This is what CI runs against `supabase start`. |
| `npm run test:remote` | whatever `.env.local` points at | Sets `ALLOW_REMOTE_TESTS=yes`. Use this on a machine with no Docker — but know that it writes to the hosted project. |

The preferred fix is a `.env.test` pointing at a throwaway Supabase project or a
local `supabase start` stack; then `npm test` just works and needs no opt-in.
(`.env.test` is covered by the `.env*` rule in `.gitignore` — never commit it.)

### How CI supplies these variables

`.github/workflows/ci.yml` provides every `REQUIRED` variable from
`tests/helpers/env.ts` through the `GITHUB_ENV` block of its "Export local stack
environment" step — the gate throws before any suite runs, so a name on that list
with no matching export is a red job, not a skipped test. The values come from two
places: the Supabase vars are the CLI's real throwaway credentials read out of
`supabase status`, and the rest are deliberately fake dummies —
`OPERATOR_EMAIL` / `OPERATOR_PASSWORD`, `RESEND_API_KEY=re-ci-not-a-secret`,
`OPERATOR_ALERT_EMAIL=alerts@ci.invalid`, `CREDENTIALS_ENCRYPTION_KEY` (base64 of
the string `ci-only-key-not-a-secret-32bytes` — the schema requires base64 that
decodes to exactly 32 bytes), and `SYNC_TICK_SECRET` / `CADENCE_TICK_SECRET`
(any 32+ character string each — two distinct dummies, because they are two
distinct variables in production and a shared CI value would let a route reading
the wrong one pass CI and 401 in production). Since 04-01 the same block also
carries four 64-character dummies for `CLICKSEND_WEBHOOK_SECRET`,
`CLICKSEND_DLR_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET` and
`MESSAGING_RECONCILE_SECRET` — again four distinct values, for the same reason,
and 64 characters because that is the shape `openssl rand -hex 32` produces in
production. Since 06-02 it also carries a fifth, `STALLED_DIGEST_SECRET`, for
the nightly stalled-draft digest route.

Fakes are safe here because no suite ever sends email:
`tests/sync-failure-alerts.test.ts` injects an `onAlert` spy, so the Resend path is
never exercised, and `.invalid` is a reserved TLD that cannot resolve or deliver by
definition. The dummy key likewise cannot authenticate against Resend.

**The keep-in-sync rule:** when a variable joins the `REQUIRED` list in
`tests/helpers/env.ts`, `.github/workflows/ci.yml` must gain a matching entry in
the *same commit* — a dummy if the tests never exercise the real service, a
repository secret only if they do. Real credentials never go inline in the workflow
file; it is public.
