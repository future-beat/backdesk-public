# Phase 11: Telephony Capture - Research

**Researched:** 2026-09-27
**Domain:** Twilio Programmable Voice inbound capture (AU local numbers, signed webhooks, TwiML greeting, call-log reconcile) bolted onto the existing Backdesk Next.js 16 / Supabase / Drizzle codebase
**Confidence:** MEDIUM overall — HIGH on the codebase map (every `path:line` read this session at HEAD `ccbd039`) and on the `twilio` 6.1.1 package internals (read from the registry tarball); MEDIUM on Twilio platform behaviour (official docs fetched 2026-09-27, single-source); LOW on AU carrier behaviour and on two Twilio details that no fetched page settled (listed in the Assumptions Log)

> Scope discipline: this file does NOT repeat `.planning/research/STACK.md` (provider comparison, pricing, provisioning sketch, webhook params table), `ARCHITECTURE.md` (§1 webhook placement, §8 migration/RLS conventions, reconcile pattern), `PITFALLS.md` (§3 greeting, §4 telco, §6 operational) or `SUMMARY.md` (S1–S7, R1–R7). It verifies and deepens what the planner needs to write concrete tasks, and corrects the milestone research where the Twilio docs disagree with it (three corrections, flagged inline with **CORRECTION**).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 Provider: Twilio Programmable Voice.** ClickSend cannot take inbound voice (its dedicated numbers answer with a busy tone; AU call forwarding is not offered). ClickSend stays for SMS. Telnyx Call Control is the fallback only if Twilio refuses the sole-trader regulatory bundle (S1).
- **D-02 One Australian local (08) number per client, tenant identity = the called number (`To`).** `ForwardedFrom`/Diversion is carrier-dependent and is captured as evidence only, never routed on (S2, S3). Numbers are never shared and never released while the client is active. No 1300/1800 (Vodafone cannot divert to them) and no 04 mobile numbers (heavier KYC, no benefit).
- **D-03 Greeting = static TwiML `<Say>` + `<Hangup/>`, Twilio Olivia-Neural en-AU (founder 27 Sep: TTS, per-client recorded audio later if a trade name mispronounces).** Script ≤ 12 s, one fixed template with the business name substituted: "Hi, you've reached {business}. This is an automated message and the call isn't recorded. We're texting you now — if your number is private, text us instead." Says "automated" (founder, D10). The greeting never depends on a ClickSend or database round trip (rule R3): the voice webhook returns TwiML from data it already holds.
- **D-04 Nothing is recorded.** No `<Record>`, `<Dial>`, `<Gather>`, transcription, voicemail or provider-side recording anywhere; a structural test fails if any is introduced; recording features disabled at the Twilio account level and asserted by the reconcile (WA Surveillance Devices Act stays out of scope because no audio is retained).
- **D-05 Two signed webhooks:** `voice` (call arrival → log + TwiML) and `voice-status` (call completed → the Phase 12 text-back trigger). Authentication = Twilio request signature over the canonical public URL (`APP_BASE_URL`, not `request.url` behind Vercel's proxy) PLUS a per-route URL token, per the four-bearer rule. Never 5xx to the provider: on any failure answer the uniform greeting/200 and log a fixed string the ops probe surfaces.
- **D-06 Capture is double-sourced and idempotent:** `missed_calls` unique on `(provider, provider_call_id)`; the arrival webhook writes the row, the status callback completes it, and a provider call-log reconcile (existing reconcile-tick pattern) recovers any dropped callback with no duplicate row. Every diverted call is stored, including withheld (`anonymous`/`unknown`/`+266696687` → withheld marker, no number), landline and international callers — Phase 12's gate decides who is texted, not capture.
- **D-07 Stored fields:** tenant id, caller CLI (E.164) or withheld marker, called number, start time (UTC; Perth-time derivation in the read path), after-hours flag computed from the tenant's contact hours at arrival, provider call id, call status, `ForwardedFrom` raw value, duration; no audio, no transcript.
- **D-08 Provisioning from the console, gated:** operator buys a number for a client from the client page (Twilio API: search AU local by Perth area, buy, set voice URL + status callback with the route token); stored in `tenant_divert_numbers`; the go-live checklist shows the number and the divert-health state; releasing a number is impossible while the client is active (no delete path in v1.2).
- **D-09 Divert health (CAP-05):** arming text-back (Phase 12) requires an observed verification call; the console shows "verification call received on {date}" and "days since last diverted call"; Phase 11 ships the recording and display, Phase 12 consumes it in the gate.
- **D-10 Twilio region:** US1 with `edge: "sydney"` unless the S7 spike shows AU1 is needed for call-log visibility; recordings disabled either way; data at rest stays in Supabase Sydney.
- **D-11 One migration journal entry for the phase**, and its header documents the `cadences` generalisation decision (`kind`, nullable `quote_id`, `lead_id`, one-live-per-lead arbiter) even though Phase 12 executes it (ARCH §8).
- **D-12 Founder actions inside this phase (checkpoints):** open the Twilio account and submit the AU regulatory bundle as a sole trader (ABN Lookup record + ASIC business-name extract) on day 1 — number purchase and every live check wait on approval; then the live divert spike on real Telstra, Optus and Vodafone handsets (no-answer, busy, unreachable; one `#31#` withheld call) is a human-action checkpoint whose recorded outcome is the gate for Phase 12.

### Claude's Discretion
CONTEXT.md has no `## Claude's Discretion` section. Everything not locked above is the researcher's/planner's call; the recommendations below mark each such choice **[discretion]**.

### Deferred Ideas (OUT OF SCOPE)
- Per-client recorded greeting (`<Play>`), AU1 region migration, shared-number attribution, texting the tradie on every miss — not in this phase.

### Scope and constraints carried (verbatim from CONTEXT.md)
- In: CAP-01..05 exactly as REQUIREMENTS.md states; the spikes S1 (bundle), S2/S3 (CLI survival, `ForwardedFrom` fill), S5 (greeting intelligibility), S7 (region/call-log).
- Out (later phases): any SMS (Phase 12), leads (13), ServiceM8 writes (14), lead queue and reporting (15). No recording, ever (milestone Out of Scope).
- Hosted Supabase is production; migration push protocol (cron:status lease gate, journal `when` monotonic, exit captured, no-op second run) before pushing code that writes the new tables.
- Bash commands naming `.env*` are denied; new env keys (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_WEBHOOK_SECRET`) documented in `docs/env-vars.md`, pushed to Vercel via the existing `env:push` path, never printed.
- Tooling budget: ~A$3.50/client/month on Twilio; pre-revenue ≈ A$14/month for design partners.
- Existing conventions: `forTenant()` repositories, RLS from the first migration, `tests/rls-coverage.test.ts` pins for new tables, `src/proxy.ts` matcher exclusion for the new public webhook paths, ops probes in the `audit-requests-count.mjs` mould, pure vitest bare / DB suites in CI.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md:14-18) | Research Support |
|----|-------------|------------------|
| CAP-01 | Operator can provision one Australian local (08) Twilio number per client from the console, recorded against the tenant; never shared, never released while active | §Twilio 1e (search/purchase params, bundle), §Codebase map (client page action pattern, `forTenant` conventions), Pattern 4 (claim-then-buy), schema `tenant_divert_numbers` with `tenant_id UNIQUE` + `number_e164 UNIQUE` and no delete path |
| CAP-02 | Static unrecorded greeting ≤ 12 s, then hangup; no `<Record>`/`<Dial>`/`<Gather>`/transcription/voicemail anywhere, asserted by a test | §Twilio 1d (voice names, `<Pause>`, escaping), Pattern 2 (string-template TwiML, no SDK in the route), Validation §structural test, §Twilio 1f (no account-level auto-record exists; reconcile asserts `recordings.list` empty) |
| CAP-03 | Every diverted call → one `missed_calls` row (tenant from `To`, caller CLI or withheld marker, Perth-time start, after-hours flag, provider call id), idempotent on call id, captured from the signed webhook AND reconciled from the call log | §Twilio 1b/1c (params, sentinels, Calls list filters), Pattern 3 (arrival insert / status complete / reconcile upsert on `UNIQUE (provider, provider_call_id)`), `isInsideWindow` for the flag, `classifyCaller` for withheld/landline/international |
| CAP-04 | Webhooks verify the Twilio signature over the canonical public URL AND a per-route token before any write, never 5xx, log a fixed string the ops probe can find | §Twilio 1a (signature algorithm, four-variant `validateRequest`, query-string token is inside the signed URL), Pattern 1 (auth ladder + fail-closed base URL), pitfall on `APP_BASE_URL` being optional |
| CAP-05 | Per-client divert health: verification call observed and recorded before text-back can be armed; console shows days since last diverted call | Pattern 5 (verification call as a `tenant_proofs` kind `divert_verification_call`, artefact = `missed_calls.id`), checklist keys `divertNumber` + `divertVerified`, `forTenant().missedCalls.latest()` for the days-since read |
</phase_requirements>

## Summary

Phase 11 adds one provider adapter (`src/core/telephony/`), two public webhook routes under `src/app/api/webhooks/twilio/`, one migration (two tables + one widened CHECK), two checklist items, one console section with one server action, one reconcile pass riding the existing nightly `messaging-reconcile` route, and two read-only ops scripts. Every one of those has a near-identical analog already in the repo (table in §Codebase map → "Analog for every new file"); the planner's job is mostly to point the executor at the analog and name the three places where Twilio differs from ClickSend: **it signs its requests**, **its 200 body is executed as the call**, and **its incoming-call webhook is not retried on a slow or 5xx response** (only on TCP/TLS connect failure, once).

The Twilio facts that shape the design were verified against the official docs and the `twilio@6.1.1` tarball this session: the signature is HMAC-SHA1 over the *exact* requested URL — query string and therefore our `?token=` included — plus the sorted form fields; `validateRequest` already tolerates the `:443` port and legacy-querystring variants, so the only thing the route must get right is rebuilding the URL from configuration (`APP_BASE_URL`, which is **optional** in `serverEnvSchema` and whose existing fallback chain would pick the marketing apex on Vercel — so the telephony URL builder must fail closed rather than inherit that fallback). Twilio imposes a hard 15 s ceiling on all call-related HTTP requests (TLS included), retries a failed webhook once and only on connect failure by default, and — **CORRECTION to STACK §5.3 / PITFALLS §6.2** — does not retry on 5xx or read timeout unless connection overrides are set. The Calls list API filters by `To`/`StartTime>` and pages automatically in the SDK; records live only in the Region that processed the call, which under D-10 (US1 + `edge: 'sydney'`) is US1, so the reconcile sees them. AU `Local` numbers cannot be searched by `AreaCode`/`InRegion` (US/CA only) — **CORRECTION to STACK §5.2**, which was right about `contains` but the robust filter is `inLocality` (documented as global) with a client-side `region`/`locality` check, settled by a read-only search script before the console action is built. Test credentials cannot buy regulated numbers, so the first purchase is real.

**Primary recommendation:** build the voice route as a copy of `clicksend/inbound/route.ts` with the ClickSend `JSON.parse` replaced by `URLSearchParams` and the token gate followed by `validateRequest` from `twilio/lib/webhooks/webhooks` over a URL produced by ONE builder that provisioning also uses; return a string-templated TwiML from a framework-free `greeting.ts` that a structural test scans for forbidden verbs; make `missed_calls` an evidence table in the `escalations`/`tenant_proofs` posture; record the verification call as a third `tenant_proofs` kind so the checklist, `recordProofAction` and Phase 12's gate reuse the proof machinery unchanged; and treat the bundle approval and the live divert spike as the two human checkpoints that bracket the phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Answer the diverted call, play the greeting, hang up | Twilio (telephony provider) executing our TwiML | API route (Vercel Node, `syd1`) producing the TwiML | The provider owns media; we own only the 200 body, which is why it must be static and computed from one DB read |
| Authenticate the provider (signature + token) | API route handler | — | `proxy.ts` excludes `api/` (VERIFIED `src/proxy.ts:156`), so the route is the only auth (the WR-01 argument at `cadence-tick/route.ts:22-42`) |
| Identify the tenant from `To`, compute after-hours, insert the row | `src/core/telephony/*` (framework-free) via `@/db/repository` | Postgres (Supabase Sydney) — `UNIQUE (provider, provider_call_id)` is the idempotency | Business rules stay out of the route (house rule: routes "decide nothing"); the database owns once-only |
| Complete the row from the status callback | API route → core → repository UPDATE by exact match | — | Same shape as `delivery-receipts.ts` (hint half) |
| Recover dropped callbacks; assert no recordings | Core reconcile pass invoked by the existing `/api/internal/messaging-reconcile` route (pg_cron 03:30 AWST) | Twilio REST (Calls list, Recordings list) via `edge: 'sydney'` | Guarantee half; no new cron job (planning note S8) |
| Buy a number, wire voice URL + status callback | Console server action → core provisioning → Twilio REST | Postgres `tenant_divert_numbers` (claim-then-buy) | Operator-only; `requireOperatorId` + RLS read gate, service-role write (the arming actions' shape) |
| Show divert health, record the verification call | Console page + checklist reader (`readGoLiveChecklist`) + `recordProofAction` third arm | Postgres `tenant_proofs`, `missed_calls` | Reuses the D-01/D-02 proof machinery; Phase 12 adds the gate |
| Evidence for the live spike | Read-only ops scripts (`scripts/*.mjs`) → `docs/external-registrations.md` | — | D-10 rule: repeatable, server-side, secret-free, no PII |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `twilio` (Node helper library) | **6.1.1** (published 2026-09-10; `engines.node >=20`; no `postinstall`; deps `axios`, `qs`, `scmp`, `dayjs`, `xmlbuilder`, `jsonwebtoken`, `https-proxy-agent`) `[VERIFIED: npm registry — npm view twilio; tarball inspected]` | Signature validation (`validateRequest`), REST client for number search/purchase, Calls list, Recordings list | Official Twilio SDK; `validateRequest` encodes the four URL-variant check Twilio's own backend inconsistency requires (`[VERIFIED: tarball package/lib/webhooks/webhooks.js:124-146]`). Pin exactly, as every dependency in `package.json` is pinned (`"next": "16.3.2"`, `"zod": "4.4.3"` — `[VERIFIED: package.json]`) |
| Existing stack (Next 16.3.2 App Router route handlers, `zod` 4.4.3, `drizzle-orm` 0.45.2, `postgres` 3.4.9, `@date-fns/tz` 1.5.0, vitest 4.1.11) | as pinned | Everything else | Already in `package.json` `[VERIFIED: package.json dependencies/devDependencies]`; no other additions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` `timingSafeEqual` | built-in | The per-route `?token=` gate | Copy `tokenMatches` from `clicksend/inbound/route.ts:129-134` verbatim, per that file's own "deliberately not shared" rule |
| `twilio/lib/webhooks/webhooks` (deep import) | in `twilio` | `validateRequest` without loading the REST client module graph in the voice route | The package ships no `exports` map (`npm view twilio exports` → empty; `main = './lib'`) `[VERIFIED: npm registry]`, so the deep path resolves; `lib/index.js:39,82` re-exports the same function if the deep import is ever refused by lint/TS `[VERIFIED: tarball package/lib/index.js:39-88]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `twilio` SDK for `validateRequest` | Hand-rolled HMAC-SHA1 (`createHmac('sha1', token).update(url + sortedKV).digest('base64')`) | 10 lines, but drops the four-variant port/legacy-querystring tolerance Twilio's own SDK carries because "signature generation on the back end is inconsistent" (`[VERIFIED: tarball webhooks.js:127-130]` — the comment is verbatim). Not worth it; the SDK is official and the module is 28 KB of `lib/` for that file |
| `twilio.twiml.VoiceResponse` builder | String template + `escapeXml` in `greeting.ts` | The builder pulls `xmlbuilder`; a template is greppable by the structural test and keeps the route import-light. **[discretion] Use the template** |
| `twilio` SDK REST client for reconcile/provisioning | Thin `fetch` wrapper (the ClickSend rule) | CLAUDE.md bans ClickSend's generated SDK specifically ("auto-generated, poorly maintained"); Twilio's is hand-maintained, typed, auto-pages `list()`, and handles `edge`/`region` hostnames (`[VERIFIED: tarball package/lib/base/BaseTwilio.d.ts:12-13,56-57,104-108]`). **[discretion] Use the SDK client in core, behind `src/core/telephony/twilio-client.ts`**, never imported by a route directly |

**Installation:**
```bash
npm install --save-exact twilio@6.1.1
```

**Version verification (run 2026-09-27):** `npm view twilio version` → `6.1.1`; `time.modified` `2026-09-10T06:27:05.718Z`; `repository.url` `git+https://github.com/twilio/twilio-node.git`; `scripts.postinstall` absent (`prepublish: npm run build` only) `[VERIFIED: npm registry]`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `twilio` | npm | package: 10+ yrs; **this version: 17 days** (6.1.1, 2026-09-10) | 6,858,561/wk | github.com/twilio/twilio-node | `[SUS]` — seam reason `too-new` (version recency) | Flagged — planner adds `checkpoint:human-verify` before the install task; mitigation is the exact pin `6.1.1` and the fact that the seam's other signals (downloads, repo, no deprecation, no postinstall) are all clean `[VERIFIED: gsd-tools query package-legitimacy check --ecosystem npm twilio]` |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `twilio` [WARNING: flagged as suspicious — verify before using.] — the flag is the *version's* age, not the package's. The package name was confirmed from Twilio's own docs (webhooks-security page documents `client.validateRequest(...)` of the Node helper library) `[CITED: twilio.com/docs/usage/webhooks/webhooks-security]`, so this is not a slopsquat candidate; the human step is "confirm 6.1.1 is the version you want, or step back to the previous minor".

*No other package is discovered or recommended by this research.*

## Twilio: verified facts for the planner (Question 1)

Confidence rule used here: `[CITED: url]` = official Twilio page fetched 2026-09-27 (MEDIUM); `[VERIFIED: tarball …]` = read from the `twilio@6.1.1` package downloaded from the registry this session (HIGH for SDK behaviour); `[ASSUMED]` = not settled by any fetched page. The `classify-confidence` seam rates every web provider LOW; the tags below follow the source-hierarchy in this agent's role instead, and the Metadata section records the seam's verdict.

### 1a. Request validation behind Vercel

- **Algorithm.** Twilio combines "Your account auth token … The Webhook URL set in Twilio … All request parameters", hashed with "HMAC-SHA1" using "your account auth token as the secret key" `[CITED: twilio.com/docs/usage/webhooks/webhooks-security]`. The SDK's `getExpectedTwilioSignature(authToken, url, params)` is `Object.keys(params).sort().reduce((acc, key) => acc + toFormUrlEncodedParam(key, params[key]), url)` → `createHmac('sha1', authToken)…digest('base64')` `[VERIFIED: tarball package/lib/webhooks/webhooks.js:92-123]`. Values are appended **decoded** (key then value, no separators), so `Object.fromEntries(new URLSearchParams(rawBody))` is exactly the `params` shape it wants.
- **The query string IS part of the signed URL.** "Pass the exact URL from Twilio including any URL-encoded characters … If you decode or re-encode the URL, signature validation fails" `[CITED: webhooks-security]`. Consequence: the per-route token lives inside the signed material. The canonical URL the route rebuilds must be **byte-identical to the `VoiceUrl`/`StatusCallback` string written at purchase**, token included: `https://app.backdesk.com.au/api/webhooks/twilio/voice?token=<64-hex>`. A 64-hex token has no characters that encode differently, which is why hex (the `openssl rand -hex 32` shape the four Phase 4 bearers use — `[VERIFIED: .github/workflows/ci.yml` comment block]`) is the right token alphabet here.
- **Ports and encoding tolerance.** `validateRequest(authToken, twilioHeader, url, params)` tries four variants in order — URL without port, with port, legacy-querystring without port, legacy-querystring with port — each compared with `scmp` (constant time) `[VERIFIED: tarball webhooks.js:124-149]`. So `https://app.backdesk.com.au/...` and `https://app.backdesk.com.au:443/...` both validate; the route does not need to care which form Twilio signed.
- **Trailing slash / 308.** Not tolerated by the algorithm (a different path is a different string) and not addressed by any fetched page. Whether Twilio follows redirects is `[ASSUMED: unknown]`. Avoid by construction: the URL builder emits no trailing slash, and the number is configured with the canonical `app.backdesk.com.au` host directly, so no alias/308 is ever in the path. (ARCH §1.2 already flags the `-git-main-` alias 308.)
- **How to compute the URL.** NOT from `request.url`/`host`/`x-forwarded-*` (the SDK's `validateIncomingRequest` does that from Express headers — `[VERIFIED: tarball webhooks.js` `validateIncomingRequest` reconstructs from `request.headers.host`]` — and behind Vercel's proxy that is the classic mismatch). Rebuild from configuration. **Pitfall the planner must design around:** `APP_BASE_URL` is `z.url().optional()` (`[VERIFIED: src/core/shared/env.ts:214]`, verbatim `APP_BASE_URL: z.url().optional(),`) and the only existing resolver, `consoleBaseUrl()` (`[VERIFIED: src/core/alerts/operator-email.ts:133-139]`), falls back to `https://${VERCEL_PROJECT_PRODUCTION_URL}` — a Vercel-chosen value that is the *shortest* production domain, i.e. potentially the marketing apex `backdesk.com.au` rather than `app.backdesk.com.au` `[ASSUMED: Vercel's documented "shortest production custom domain" rule; not fetched]`. The telephony URL builder must therefore read `APP_BASE_URL` directly and **fail closed when it is unset** (provisioning refuses; verification treats it as a signature failure). Recommend also asserting `new URL(APP_BASE_URL).host === CONSOLE_HOST` (`CONSOLE_HOST = 'app.backdesk.com.au'`, `[VERIFIED: src/core/brand.ts:31]`) in the provisioning action before any purchase, so a preview-host or apex value can never be written onto a live number.
- **JSON bodies / `bodySHA256`.** Irrelevant here (Twilio Voice posts `application/x-www-form-urlencoded`); noted only so nobody reaches for `validateRequestWithBody` `[CITED: webhooks-security; VERIFIED: tarball webhooks.js:165-170]`.

### 1b. Inbound-call parameters, status events, timeouts, retries

- **Parameters on the Voice URL request** (verbatim descriptions `[CITED: twilio.com/docs/voice/twiml]`): `CallSid` "A unique identifier for this call, generated by Twilio."; `AccountSid`; `From` "The phone number or client identifier of the party that initiated the call. Phone numbers are formatted with a '+' and country code" — and when unavailable "you may receive values like 'anonymous', 'unknown', or similar"; `To`; `CallStatus` with values `queued`, `initiated`, `ringing`, `in-progress`, `completed`, `busy`, `failed`, `no-answer`, `canceled`; `ApiVersion`; `Direction` `inbound` | `outbound-api` | `outbound-dial`; `ForwardedFrom` "set only when Twilio receives a forwarded call, but its value depends on the caller's carrier including information when forwarding. Not all carriers support passing this information."; `CallerName` "set when the IncomingPhoneNumber … has had its `VoiceCallerIdLookup` value set to `true`" (leave it `false` — CNAM is US; every extra field is a field to keep out of logs); `ParentCallSid` (absent on the first leg); `CallToken`; geographic `FromCity/FromState/FromZip/FromCountry/ToCity/ToState/ToZip/ToCountry` "when available". **No timestamp parameter** on the arrival request — use server receipt time for `started_at`.
- **AU CLI format.** STACK source 22 (Twilio AU voice guideline, LOW) says inbound CLI arrives "in local format", while the TwiML page says "+ and country code". The parser must accept both (`normalizeAuMobile` already accepts `04…` and `+614…` — `[VERIFIED: src/core/cadence/primary-contact.ts:110-141]`); the spike settles which arrives. `[ASSUMED: E.164 is the common case]`
- **Withheld sentinels.** Twilio's changelog: "Any Programmable Voice calls where the caller ID has been withheld will now display anonymous in the From field" `[CITED (search snippet): twilio.com/en-us/changelog/changes-to-withheld-caller-id-behavior]`. The `+266696687` ("ANONYMOUS" on a keypad) sentinel is from the help article STACK cites as source 23; that article returned 403/empty this session, so the full sentinel list (`+7378742833` RESTRICTED, `+86282452253` UNAVAILABLE, `+2562533` BLOCKED) is `[ASSUMED — training knowledge; treat as a non-exhaustive allowlist]`. Design rule that makes the exact list non-load-bearing: **any `From` that is not a well-formed E.164 number (`/^\+[1-9]\d{6,14}$/`) is withheld**, and the known sentinel numbers are additionally mapped to withheld even though they parse as E.164. Landline and international E.164 values are stored as numbers with `caller_withheld = false` (Phase 12's gate rejects them; D-06).
- **Status callback.** Events: `initiated`, `ringing`, `answered`, `completed`; "`completed`: The call is completed, regardless of the termination status" is the default when no event is specified `[CITED: twilio.com/docs/voice/api/call-resource]`. The number-level `StatusCallback` (IncomingPhoneNumber `statusCallback` + `statusCallbackMethod`, no event selector on that resource — `[VERIFIED: tarball package/lib/rest/api/v2010/account/incomingPhoneNumber.d.ts:45-47,94-96]`) therefore fires once, at completion. Parameters added on the callback: `CallDuration` "The duration in seconds of the just-completed call", `Timestamp` "given as UTC in RFC 2822 format", `CallbackSource` "Always `call-progress-events`", `SequenceNumber` `[CITED: call-resource]`. **Subscribe to `completed` only** (it is the only option on a number). `no-answer`/`busy` are statuses of *our* leg, which Twilio answers itself the moment it fetches TwiML, so they should not occur; store whatever `CallStatus` arrives (the CHECK vocabulary must include all nine values above). `CallDuration` on a `completed` callback ≈ `<Pause>` + greeting length — a free measurement for the ≤ 12 s claim (S5).
- **Timeouts and retries** `[CITED: twilio.com/docs/usage/webhooks/webhooks-connection-overrides]`: "Twilio imposes a hard upper timeout of 15 seconds on all call-related HTTP requests." Defaults: connect timeout `ct` 5000 ms, read timeout `rt` 15000 ms, total `tt` 15000 ms, retry count `rc` **1**, retry policy `rp` **`ct`** ("TCP connect or TLS handshake failure" only), origin edge `e` **`ashburn`**. Overrides apply to "all product webhooks except Twilio Conversations and Twilio Frontline" and are written as a URL fragment (`https://example.com/foo#ct=1000&rt=5000&rc=2&rp=4xx,5xx`). **CORRECTION:** PITFALLS §6.2 ("status callbacks are retried only a few times with backoff") and the hookdeck-derived "retried up to 3 times" are not what Twilio's own page says: with no override, a 5xx, a 4xx or a read timeout is **not retried** at all, and a connect failure is retried once. The incoming-call webhook's failure path is the number's `VoiceFallbackUrl` ("The URL that we should call when an error occurs retrieving or executing the TwiML" `[CITED: twilio.com/docs/phone-numbers/api/incomingphonenumber-resource]`). Whether a fragment on the configured URL is included in the signed URL is `[ASSUMED: unknown]` — do not add overrides in v1; the reconcile is the guarantee (D-06). The `e=ashburn` default means every webhook to `syd1` crosses the Pacific; `#e=sydney` is the tuning to try in S4 once the fragment-vs-signature question is answered by one live call.
- **Fallback URL.** A TwiML Bin holding the *generic* greeting (no business name) is the cheapest provider-hosted fallback so a Vercel outage still plays something and the reconcile still recovers the row. TwiML Bins have no public REST API as far as any fetched page shows `[ASSUMED]`, so the bin is a founder console action recorded in the D-12 checkpoint, and its URL is an optional env `TWILIO_VOICE_FALLBACK_URL` passed as `voiceFallbackUrl` at purchase. **[discretion]** — ship without it if it costs the phase a day; the caller then hears Twilio's default application-error message and the row is recovered by the reconcile.

### 1c. Calls list API for the reconcile, and Region visibility

- Filters: `To`, `From`, `ParentCallSid`, `Status`, `StartTime`, `StartTime>`, `StartTime<`, `EndTime`; paging `PageSize`/`Page`/`PageToken` `[CITED: call-resource]`. SDK spelling: `client.calls.list({ to, from, status, startTime, startTimeAfter, startTimeBefore, endTime, pageSize, limit })` with `Date` values `[VERIFIED: tarball package/lib/rest/api/v2010/account/call.d.ts:130-156]`; `list()` auto-pages up to `limit`. Resource fields the reconcile needs: `sid`, `status`, `direction`, `from`, `to`, `forwarded_from`, `start_time`, `end_time`, `duration` `[CITED: call-resource]`.
- **Recommended query shape:** one account-wide `calls.list({ startTimeAfter: now − 48 h, limit: 500 })` per pass, filtered client-side to `direction === 'inbound'` and `to ∈ tenant_divert_numbers.number_e164` (the `forAllTenants_ledgerOwners` posture: one paged provider read, mapped onto our rows), rather than one `To`-filtered query per client — 15 clients would be 15 round trips a night for no gain. 48 h mirrors `reconcile.ts` `WINDOW_HOURS = 48` and its "a missed day is recovered by the next run" argument `[VERIFIED: src/core/messaging/reconcile.ts:63-71]`.
- **Region.** "Twilio stores most data generated by a workload in the same Region where the workload is processed" and, of a call handled outside US1, "the resulting records do not exist in that Region" `[CITED: twilio.com/docs/global-infrastructure/understanding-twilio-regions]`. Under D-10 (numbers and account in US1, client `edge: 'sydney'`), inbound calls are processed in US1 and the US1 API — reached through the Sydney edge hostname the SDK builds from `edge`/`region` (`[VERIFIED: tarball BaseTwilio.d.ts:104-108` "Adds a region and/or edge to a given hostname … targetEdge (e.g. sydney) … targetRegion (e.g. au1)"]`) — sees them. The edge only changes where our API traffic enters Twilio; it does not move where the call is processed `[ASSUMED — the edge-locations page fetched does not say either way]`. The per-number Region routing tutorial 404'd; AU1 migration stays deferred per CONTEXT. S7 is therefore a one-line check: after the first live call, `calls.list({ to: <number>, limit: 1 })` returns it.

### 1d. `<Say>` with Olivia-Neural

- en-AU voices: Polly `Polly.Nicole`, `Polly.Russell` (Standard), **`Polly.Olivia-Neural`** (Neural), `Polly.Olivia-Generative` (Generative); Google `en-AU-Standard-A..D`, `en-AU-Neural2-A..D`, `en-AU-Wavenet-A..D`, `en-AU-Chirp3-HD-*` `[CITED: twilio.com/docs/voice/twiml/say/text-speech]`. Attribute syntax `voice="{Provider}.{Voice}"`, `language="en-AU"`; defaults `voice=man`, `language=en-US`, `loop=1` `[CITED: twilio.com/docs/voice/twiml/say]`.
- Character limit: "varies depending on the Text-to-Speech option used" — the exact figure is on a page not fetched `[ASSUMED: thousands of characters; the greeting is ~190]`. SSML is supported ("SSML tags … adjust the pronunciation") but tag list not fetched `[ASSUMED]`; **do not use SSML in v1** — use the verb `<Pause length="1"/>` (a TwiML verb, not SSML) before `<Say>` as STACK §5.3 recommends, and let S5 decide whether a `<break>` is ever needed.
- Escaping: TwiML is XML; `&`, `<`, `>`, `"` in the spoken business name must be entity-escaped (`Smith & Sons` is a real trading name) — the string template needs an `escapeXml` and the structural test needs the `&` case.
- Cost: STACK §7 figure (Neural per 100 characters, ~A$0.0064 per call at ~150 chars) not re-fetched; unchanged `[CITED: STACK.md source 3/8, MEDIUM]`.
- Length: the locked D-03 script is 31 words / ~185 characters with a 20-character business name. At neural TTS pace (~150 wpm) that is ~12.5 s **including** the 1 s pause — right at the ceiling. The planner should give the executor a word budget (≤ 30 words after substitution) and let `CallDuration` from the first live calls be the measurement; if it lands over 12 s, the founder trims "This is an automated message and" → "This is automated and" (D-03 requires "automated" to be said, not the exact sentence).

### 1e. AU local number search and purchase; the bundle; account-level recording

- **Search.** `AreaCode`, `InRegion`, `InPostalCode`, `InRateCenter`, `InLata`, `NearNumber`, `NearLatLong`, `Distance` all "Applies to only phone numbers in the US and Canada"; `Contains`, `InLocality`, `VoiceEnabled`, `ExcludeAllAddressRequired`/`ExcludeLocalAddressRequired`/`ExcludeForeignAddressRequired`, `Beta`, `PageSize` apply globally `[CITED: twilio.com/docs/phone-numbers/api/availablephonenumberlocal-resource]`. **CORRECTION to STACK §5.2's comment** ("area-code filters are US/CA only" was right; `InRegion` is also US/CA-only, so "Perth area" cannot be expressed as a region filter). Response carries `locality`, `region`, `iso_country`, `address_requirements` (`local` = "address in the phone number's country required" — *country*, not charging district). **Recommendation:** `client.availablePhoneNumbers('AU').local.list({ inLocality: 'Perth', voiceEnabled: true, limit: 10 })`, falling back to `{ contains: '618*******', voiceEnabled: true, limit: 50 }` filtered client-side to `region === 'WA'` (08 also covers SA/NT: Adelaide `08 7/8`, Darwin `08 89`), and show `locality`/`region` to the operator before the buy. Whether `inLocality: 'Perth'` returns anything for AU inventory is `[ASSUMED]` — settle it with the read-only search script (Validation §evidence scripts) the day the bundle is approved, before the console action is written against a guess.
- **Purchase.** `incomingPhoneNumbers.create({ phoneNumber, bundleSid, addressSid, friendlyName, voiceUrl, voiceMethod: 'POST', statusCallback, statusCallbackMethod: 'POST', voiceFallbackUrl?, voiceCallerIdLookup: false })` — `BundleSid` "Some regions require a Bundle to meet local Regulations", `AddressSid` "Some regions require addresses", `FriendlyName` ≤ 64 chars `[CITED: incomingphonenumber-resource; VERIFIED: tarball incomingPhoneNumber.d.ts:33-73]`. Set `voiceUrl` and `statusCallback` **in the create call**, never in a second update: a new number otherwise carries Twilio's demo TwiML until the update lands, and a failed second call leaves a live number playing a demo to a real customer. `smsUrl` stays unset (S4: SMS never on Twilio). `friendlyName` = `backdesk-divert-<tenantId>` — a uuid, never the business name (Twilio's console is a third-party surface).
- **Bundle, sole trader.** AU Local, Business end-user: identity "Current Company Extract" or "Record of Registration for Business" from the "ASIC Portal", business ID "ABN … or ACN", address "Must be within Australia; a PO Box is not acceptable", authorised representative on the registry or "Letter of Authorization signed by one of the Directors" `[CITED: twilio.com/en-us/guidelines/au/regulatory]`. A sole trader with a **registered business name** has an ASIC business-name record (the "Record of Registration for Business"); the ABN goes in the Document Number field (search snippet, `[CITED: support.twilio.com/…/8338625205147]`). A sole trader trading under their own name only has no ASIC record → fall back to the **Individual** end-user type ("business use only"; AU government ID or passport + AU address proof) `[CITED: au/regulatory]`. D-12 already plans both documents. Review: "We do our best to verify documents submitted within 24 business hours", contact support after 72 h `[CITED: twilio.com/docs/phone-numbers/regulatory/faq]`; "up to three business days … in some regions several weeks" (search snippets, MEDIUM). Trial accounts cannot use regulated numbers `[CITED: regulatory/faq]`; test credentials only exercise magic numbers (`+15005550006`) and "can't interact with resources in your live account" and "Do not trigger status callbacks" `[CITED: twilio.com/docs/iam/test-credentials]` — **the first purchase is a real, paid, production purchase**, so the search step must be a read and the buy step must be a single deliberate action with the operator shown exactly which number.
- **One bundle, many numbers.** The FAQ does not state it explicitly; the console guidance "assign it to any previously purchased local number that doesn't already have one" (search snippet) implies an approved bundle is reusable across numbers of the same regulation `[ASSUMED: MEDIUM]`. Plan on one `TWILIO_AU_BUNDLE_SID` + one `TWILIO_AU_ADDRESS_SID` for the cohort; if Twilio ever rejects the second purchase, that is a founder checkpoint, not a code change.
- **Charging district.** Twilio's notice: "Calls to the number will be charged as if you were located within the relevant charging district of the allocated number. You may not be able to port the number to another service provider." `[CITED: au/regulatory]`. `address_requirements: local` means an address in Australia, not in the number's district `[CITED: availablephonenumberlocal-resource]`. The founder already holds an AU street address that satisfied ClickSend's IPND requirement (resolved 2026-08-29, `[VERIFIED: docs/external-registrations.md:49-134]`); reuse it for the Twilio Address resource. The district only affects what a *caller* pays and porting — irrelevant to a number nobody dials back.
- **Recording at account level.** Recordings are created only by `<Record>`, `<Dial record>`, `<Conference record>`, `<Start><Recording>`, REST `Record=true`, or a POST to a call's Recordings subresource; "The documentation does not mention any account-level automatic recording feature" `[CITED: twilio.com/docs/voice/api/recording]`. The three account-wide Voice Recording settings (external storage, encryption, dual-channel conference) "only configure how recordings that are already triggered … are handled" `[CITED: twilio.com/docs/voice/recording-settings]`. Recording Configurations are "reusable recording settings", listed in Console under Voice > Recordings > Configurations; whether one can auto-apply to inbound calls is not addressed `[ASSUMED: it cannot without a TwiML/API reference]`. So "disabled at the account level" (D-04) reduces to: nothing in our TwiML or code creates one (structural test), the founder confirms the Configurations page is empty (D-12 checkpoint), and the reconcile asserts `client.recordings.list({ dateCreatedAfter: since })` is empty (`[VERIFIED: tarball recording.d.ts:28-36` — `dateCreated`, `dateCreatedAfter`, `callSid` filters]`) and alerts the operator if not.

## Codebase map for the planner (Question 2)

All paths relative to the repo root; every line reference was read this session at HEAD `ccbd039`.

### The two ClickSend webhook doors — the moulds for the two Twilio routes
| Fact | Where | What to copy / what changes |
|---|---|---|
| Token gate before the body is read; `timingSafeEqual` with the length pre-check; "deliberately not shared" | `src/app/api/webhooks/clicksend/inbound/route.ts:129-134` (`tokenMatches`), `:152-158` (auth first) | Copy verbatim into each Twilio route. Secret names: `TWILIO_VOICE_WEBHOOK_SECRET` (voice), `TWILIO_VOICE_STATUS_WEBHOOK_SECRET` (status) — see Open Question 1 on the CONTEXT naming |
| `request.text()` never `.json()`; raw kept for dead-letter; 8 000-char cap (`MAX_RAW_PAYLOAD_CHARS = 8_000`) | `inbound/route.ts:160-195`, `:90` | Same, but decode with `URLSearchParams` — the guarded form decoder already exists at `clicksend/dlr/route.ts:138-151` (`decodeBody`: JSON first, then form only if it "contains an `=` and does not open like JSON"). For Twilio the body is always a form, so the JSON attempt is dropped and the `=` guard kept |
| Uniform 200 body (`{ received: true }`) as an anti-oracle | `inbound/route.ts:144-150`, test `tests/clicksend-inbound-route.test.ts:5-14` | Status route: identical. Voice route: the 200 body is TwiML and must be uniform in **shape** (always `Pause`/`Say`/`Hangup`); the greeting names the business for a known `To` and is generic otherwise — the caller already dialled that business, so this is not an oracle (ARCH §1.3) |
| Dead-letter on unparseable → row with `raw_payload`, `console.warn` with counts only; "every interpolation … a single plain expression" so the test can pin them | `inbound/route.ts:211-247` | `missed_calls` dead-letter row with `tenant_id NULL`, `raw_payload` capped; same single-expression log discipline (the pinned-interpolation assertion at `tests/clicksend-inbound-route.test.ts:148-153` reads `console.*(` calls with a regex) |
| Logs: "THE RESULT KIND, AND NOTHING ELSE … a closed union — no number" | `inbound/route.ts:204-206` | Voice route logs `[twilio] voice handled: <kind>.` where kind ∈ `{recorded, duplicate, unknown_number, dead_letter, signature_rejected, base_url_unset, db_failed}` — the fixed strings CAP-04 asks the ops probe to find |
| `maxDuration = 60`, `runtime = 'nodejs'` | `inbound/route.ts:77-80`, `dlr/route.ts:81-84` | Voice route: **`maxDuration = 15`** is not needed (Vercel kills at its own limit; Twilio gives up at 15 s regardless) — keep 60 like the siblings, but the handler must *respond* inside ~10 s; see Pattern 1 step 6 |
| The DLR route's per-endpoint-secret test ("THE PER-ENDPOINT RULE: the INBOUND webhook secret does not open this door") | `tests/clicksend-dlr-route.test.ts:115-120` | Replicate: the voice secret must not open the status door and vice versa |
| Proxy pin in the route tests (`PROXY_SOURCE` read and asserted to exclude `api/`) | `tests/clicksend-inbound-route.test.ts:65`, `tests/clicksend-dlr-route.test.ts:60` | Same assertion in both Twilio route suites |

### `src/proxy.ts` — nothing to change
`matcher: ['/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png$|api/|audit$|audit/|privacy$|guides/|brand/|robots.txt$|sitemap.xml$).*)']` `[VERIFIED: src/proxy.ts:156]` — `api/` is already excluded; the comment at `:116-119` gives the reason ("API ROUTES ENFORCE THEIR OWN CREDENTIAL"). Placing the routes under `src/app/api/webhooks/twilio/` satisfies CONTEXT's "matcher exclusion for the new public webhook paths" by construction; the route tests pin it.

### The reconcile — the mould for `reconcileMissedCalls`
| Fact | Where |
|---|---|
| "THIS MODULE CONTAINS NO DECISION OF ITS OWN. It re-runs the SAME … application paths the callbacks use"; injectable `ReconcileDeps`; `WINDOW_HOURS = 48`; failed poll is `console.warn` + 0, never a throw; counts-only `console.info` | `src/core/messaging/reconcile.ts:1-157` |
| The route: bearer `MESSAGING_RECONCILE_SECRET`, `maxDuration = 300`, response enumerated field by field ("never `...result`") | `src/app/api/internal/messaging-reconcile/route.ts:72-93` |
| Schedule `30 19 * * *` (03:30 AWST), applied by `scripts/apply-cron-schedules.mjs` (4 jobs; `tests/cron-schedules.test.ts` pins `MANAGED_JOBS` of four) | `scripts/apply-cron-schedules.mjs:100-102`, `tests/cron-schedules.test.ts:41` |
| Route test pins the exact response object `RESULT = { skipped, receiptsApplied, inboundReplayed, optOutsRecorded }` with `toEqual` | `tests/messaging-reconcile-route.test.ts:45,117` — **breaks by design** when two fields are added; update it |
| Pure test mould (captured real payloads pinned as fixtures; every collaborator observed) | `tests/messaging-reconcile.test.ts:1-100` |

**What an "AU call-log reconcile" pass mirrors:** `applyHistory` (`reconcile.ts:176-240`) — list from the provider since `now − 48 h`, translate field names only, hand each entry to the *same* core function the webhook uses (`recordMissedCallFromLog` ≡ the arrival insert + completion, in one upsert), count `applied`. Add the recordings assertion as a fourth step. Wire it as a second call in the messaging-reconcile route handler, **after** `reconcileMessaging()` and **outside** its `anyChannelEnabled('sms')` guard (telephony has its own guard: any `tenant_divert_numbers` row + Twilio creds present).

### Schema, repository and migration conventions
| Convention | Where (verbatim) |
|---|---|
| Barrel: "Every future table must be exported from here or it will not reach a migration." | `src/db/schema/index.ts:1-31` — add `export * from './tenant-divert-numbers'; export * from './missed-calls';` |
| Evidence-family posture: "No FK on `tenant_id` and no cascade … APPEND-ONLY … `recorded_at` is SERVER-SET"; `pgPolicy` authored in the schema so RLS cannot ship off | `src/db/schema/tenant-proofs.ts:31-42,125-131`; `src/db/schema/escalations.ts:127-128` "No FK, no cascade — see the header." |
| CHECK vocabularies for closed columns: `check('tenant_proofs_kind_known', sql\`kind IN ('escalation_handset_proof', 'email_pipe_proof')\`)` | `tenant-proofs.ts:118-121`; `TENANT_PROOF_KINDS = ['escalation_handset_proof', 'email_pipe_proof'] as const` at `:61` — Phase 11 widens both to add `'divert_verification_call'` |
| Two-arm policy for a table with tenant-less rows: `(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())` | `src/db/migrations/0036_phase10_go_live.sql:67` (messaging_config_audit); `inbound_messages.tenantId` "NULL MEANS UNATTRIBUTED … No FK, no cascade." `src/db/schema/inbound-messages.ts:162-165` — `missed_calls` takes the two-arm form (dead letters for unknown `To`) |
| Grant block: REVOKE ALL from anon/authenticated; GRANT SELECT to both; GRANT ALL to service_role; "EVERY NEW TABLE NEEDS ITS OWN GRANT BLOCK" | `0036_phase10_go_live.sql:71-122` |
| One journal entry per phase; generated by drizzle-kit, renamed, `when` re-stamped **ahead** of the last entry ("drizzle's migrator silently SKIPS an entry older than the last applied one") | `0036:1-21`; last entry `{ "idx": 37, "when": 1789806076213, "tag": "0037_audit_request_arrival_source" }` `[VERIFIED: src/db/migrations/meta/_journal.json tail]` → Phase 11 is `idx 38`, `when > 1789806076213`, tag `0038_phase11_telephony_capture` |
| Hand-written objects invisible to snapshots; "Check generated SQL before applying it"; `IF NOT EXISTS` / `DROP … IF EXISTS` first | `src/db/migrations/README.md` §"Hand-written objects…" |
| `forTenant(id)`: "no method ever accepts a `tenantId` parameter"; cross-tenant reads are `forAllTenants_<operation>()` "so a reviewer can grep one string" | `src/db/repository/for-tenant.ts:1-16` |
| `forAllTenants_webhookHint(sm8JobUuid)` — the "resolve an external identifier to a tenant" shape, with `ORDER BY … LIMIT 1` made deterministic | `src/db/repository/for-all-tenants.ts:286-389` — model `forAllTenants_divertNumberByE164(to)` on it (no ORDER BY needed: `number_e164` is UNIQUE) |
| `tests/sync-upsert.test.ts` **counts `forAllTenants_*` names** | `for-all-tenants.ts:1347` comment — adding one export requires updating that count |
| Pool `max: 5` "IS A CEILING ON CONCURRENCY, NOT A HINT … Keep `Promise.all` batches of repository reads well under this number" | `src/db/repository/client.ts:22-30` — the voice route does ≤ 2 queries; `readGoLiveChecklist` already issues 12 in one `Promise.all` (`checklist.ts:307-334`); adding two more reads there follows existing practice but the planner should note the ceiling |
| `proofs.append({ kind, artefactId, artefactDetail, note, recordedBy })` / `proofs.latest(kind)` | `for-tenant.ts:1652-1696` — the verification-call proof reuses these unchanged once the kind union is widened |
| The idempotent-insert shape for a provider-keyed row: `insertInboundMessage` (service-role, tenant supplied explicitly, may be null) | `src/db/repository/inbound-messages.ts` (used at `clicksend/inbound/route.ts:69,223`) — `insertMissedCall` follows it, with `ON CONFLICT (provider, provider_call_id) DO NOTHING RETURNING id` |
| The exact-match UPDATE shape for a hint: "an UPDATE with an exact-match predicate, so a forgery cannot invent a send" | `clicksend/dlr/route.ts:26-34` describing `src/db/repository/delivery-receipts.ts` — `completeMissedCall` follows it |

### Onboarding checklist and proofs — where CAP-05 attaches
| Fact | Where |
|---|---|
| `CHECKLIST_ITEM_KEYS = ['sm8Connected','contactHours','voiceProfile','templatesApproved','sm8AutomationOff','escalationPhone','sendingDomainVerified','smsArmed','emailArmed','escalationHandsetProof','emailPipeProof'] as const` ("The eleven items … THE ORDER IS THE ONBOARDING ORDER") | `src/core/onboarding/checklist.ts:142-154` — add `'divertNumber'` and `'divertVerified'` **after** `emailPipeProof` (they gate nothing in Phase 11; Phase 12's text-back gate consumes them). Every "eleven"/"exactly eleven" literal (`checklist.ts:123,260`; `tests/go-live-checklist.test.ts`) must move to thirteen |
| `readGoLiveChecklist(tenantId, now, deps)` — 12 reads in one `Promise.all`, proofs via `repo.proofs.latest('escalation_handset_proof')` | `checklist.ts:292-334` — add `repo.divertNumber.get()` and `repo.proofs.latest('divert_verification_call')` and `repo.missedCalls.latest()` |
| Proof rows: `detail: handsetProof ? \`recorded · ${handsetProof.artefactId}\` : null` and "THE DATE is deliberately absent … the page prepends it, formatted in the CLIENT's zone" | `checklist.ts:494-511` — `divertVerified` copies this; the page adds "verification call received on {date}" via `formatInTenantZone` (`src/core/shared/tenant.ts:312-329`) |
| `ProofRecord { recordedAt, artefactId }`; `GoLiveChecklist.proofs: { escalationHandset, emailPipe }` | `checklist.ts:232-272` — add `divertVerification` |
| `ARMING_GATES` (`as const satisfies`) and `firstUnmetGate` — **unchanged in Phase 11** (SMS/email gates do not depend on the divert) | `src/core/onboarding/arming.ts:59-105` |
| Card labels `ITEM_LABELS` and `ITEM_FIX: Record<ItemKey, …>` ("a tenth item added later is a COMPILE ERROR here") | `src/app/(console)/clients/[id]/checklist-card.tsx:58-104` — two entries each; `divertNumber` fix links to `#divert-number` on the same page |
| `recordProofAction`: `proofSchema = z.object({ kind: z.enum(TENANT_PROOF_KINDS), … })`; per-kind artefact verification (escalation via `getEscalationForTenant(tenantId, id)`, email via `getEmailStatus`); refuses an unarmed channel (`PROOF_CHANNEL_NOT_ARMED_MESSAGE`); `forTenant(tenantId).proofs.append(...)` | `src/app/(console)/clients/[id]/actions.ts:780-1019`; copy at `action-state.ts:344-520` — add a third arm: artefact = `missed_calls.id` (uuid), verified with a new `getMissedCallForTenant(tenantId, id)` (tenant in the predicate, `null` for foreign/unknown — the `PROOF_ESCALATION_NOT_FOUND_MESSAGE` argument at `action-state.ts:413-421`), requiring `call_status = 'completed'` and an active divert row instead of an armed channel; `proofRecordedMessage` gains "Recorded. The divert for this client is verified." |
| Pure action test mould (Supabase client faked "ONE LEVEL BELOW `requireOperatorId`"; repository mocked; "A `tenant_proofs` row is evidence about production; a suite that could write one is a suite that could manufacture it") | `tests/proof-actions.test.ts:1-60` |
| DB-backed proof-table mould ("DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS … never through `npm run test:remote` (D-11)") | `tests/tenant-proofs.test.ts:1-80` |

### Client page and server-action pattern (CAP-01 console)
| Fact | Where |
|---|---|
| `'use server'` module; `requireOperatorId()` from `../../_auth` ("The import path ends in `_auth` by rule"); `authorize(tenantId)` = RLS-scoped read with the operator's JWT before any service-role write; zod schema per form; `revalidatePath(\`/clients/${tenantId}\`)`; state shapes + `BLANK_*` in `action-state.ts` because "a 'use server' module may export only async functions" | `src/app/(console)/clients/[id]/actions.ts:1-163`, `action-state.ts:1-9` |
| `requireOperatorId(): Promise<{ ok: true; userId } \| { ok: false; reason: 'unauthenticated' \| 'forbidden' }>`; allowlist read through the operator's own JWT; read error = denial | `src/app/(console)/_auth.ts:73-110` |
| Page: `dynamic = 'force-dynamic'`; typed read contracts with explicit select lists ("NOTE THE SELECT LIST WHEREVER THIS IS QUERIED"); `readGoLiveChecklist` consumed by `ChecklistCard`; `formatInTenantZone` for client-zone dates | `src/app/(console)/clients/[id]/page.tsx:1-48,55-84,141-165` |
| The highest-consequence-control shape (two taps, blast radius named, `ARM_REFUSAL: Record<GatingKey, string>`) | `action-state.ts:159-338`, `actions.ts:571-775` — the buy action is a real purchase: copy the two-tap confirm with the candidate number, locality and monthly cost in the sentence |

### Environment handling
| Fact | Where |
|---|---|
| `serverEnvSchema` + explicit pick-list in `getServerEnv()`; "a key present in one list and absent from the other validates as `undefined` and fails at the first use" | `src/core/shared/env.ts:12-223`, `:244-290` — add `TWILIO_ACCOUNT_SID` (`z.string().regex(/^AC[0-9a-f]{32}$/)`), `TWILIO_AUTH_TOKEN` (`min(32)`), `TWILIO_VOICE_WEBHOOK_SECRET` (`min(32)`), `TWILIO_VOICE_STATUS_WEBHOOK_SECRET` (`min(32)`), `TWILIO_AU_BUNDLE_SID` (`regex(/^BU[0-9a-f]{32}$/).optional()`), `TWILIO_AU_ADDRESS_SID` (`regex(/^AD[0-9a-f]{32}$/).optional()`), `TWILIO_VOICE_FALLBACK_URL` (`z.url().optional()`) to BOTH lists |
| Required secrets propagate to: `tests/helpers/env.ts` `REQUIRED` (`:21-89`) and the CI dummy block (`.github/workflows/ci.yml:120-175`, "FOUR DISTINCT DUMMIES … Each is 64 characters") | Four new required keys → four new distinct dummies in both places (`TWILIO_ACCOUNT_SID` dummy must satisfy the `AC` + 32-hex regex; `TWILIO_AUTH_TOKEN` 32+ chars) |
| `docs/env-vars.md` "Who reads what" table and the `.env` block | `docs/env-vars.md:203-230` — seven rows to add |
| `scripts/push-vercel-env.mjs --project backdesk --envs production,preview NAME…` (secrets via stdin, "never `--value`"); `--public NAME=value` for config | `scripts/push-vercel-env.mjs:1-60` — runbook line: `node scripts/push-vercel-env.mjs --project backdesk --envs production,preview TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_VOICE_WEBHOOK_SECRET TWILIO_VOICE_STATUS_WEBHOOK_SECRET`, then redeploy |
| `APP_BASE_URL: z.url().optional()` and the fallback resolver `consoleBaseUrl()` | `env.ts:214`; `src/core/alerts/operator-email.ts:133-139` — **do not reuse for Twilio** (see §1a) |

### Contact hours (after-hours flag)
`isInsideWindow(instant: Date, win: ContactWindow): boolean` — half-open `[start, end)`, ISO weekday conversion, `TZDate` in `win.timezone` `[VERIFIED: src/core/cadence/window.ts:185-195]`; `ContactWindow = { timezone, contactHoursStart 'HH:MM:SS', contactHoursEnd, contactDays: readonly number[] }` `[VERIFIED: window.ts:69-77]`; throws `InvalidContactWindowError` / a no-allowed-day error for windows migration 0004's CHECKs already make unreachable (`window.ts:37-44`). `after_hours = !isInsideWindow(receivedAt, windowOf(tenant))`; on a thrown window error, store `true` (the conservative direction — an after-hours caller gets the after-hours template in Phase 12) and log a fixed string. The tenant columns come from `tenants.timezone/contact_hours_start/contact_hours_end/contact_days` `[VERIFIED: src/db/schema/tenants.ts:35-39]` — join them into the `forAllTenants_divertNumberByE164` read so the voice route needs exactly one query before it can answer.

### Ops-probe mould (evidence scripts)
| Fact | Where |
|---|---|
| `process.loadEnvFile('.env.local')` in a try; `MIGRATE_DATABASE_URL`; `new URL(url)` inside `try` whose failure "NEVER echoes the value"; `postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 })`; explicit select list, "never `SELECT *`"; both arms `sql.end` | `scripts/audit-requests-count.mjs:34-101`, `scripts/escalations-recent.mjs:39-140` (`--tenant <uuid> --limit 1..50` parser at `:51-82`) |
| Source-level pins: `expectReadOnlyDbScript(CODE)` (no `INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|REVOKE`, no `SELECT *`, CR-01 URL guard, ≥ 2 `sql.end(`); provider scripts: one `fetch(`, `method: 'GET'`, no write verb, `e instanceof Error ? e.name :` only, `status !== 200` naming the status and not the body | `tests/ops-scripts.test.ts:39-127` |
| `scripts/lib/support.mjs`: `loadEnv()`, `requireEnv(...names)`, `withRetry(label, fn)` | `scripts/lib/support.mjs:9-64` |
| Evidence log format (dated H2/H3 entries, "identifiers and dates only") | `docs/external-registrations.md:1-22` and the dated sections thereafter |

### Analog for every new file
| New file | Analog to copy from | Notes |
|---|---|---|
| `src/app/api/webhooks/twilio/voice/route.ts` | `src/app/api/webhooks/clicksend/inbound/route.ts` | + `validateRequest`; 200 body is TwiML `text/xml`; dead-letter to `missed_calls` |
| `src/app/api/webhooks/twilio/voice-status/route.ts` | `src/app/api/webhooks/clicksend/dlr/route.ts` | Hint half: UPDATE by exact match; unreadable body = counted log, no row |
| `src/core/telephony/webhook-url.ts` | `src/core/messaging/unsubscribe-token.ts:202` (`unsubscribeUrl(baseUrl, token)`) | ONE builder used by verification and provisioning; fails closed on unset `APP_BASE_URL` |
| `src/core/telephony/verify-signature.ts` | — (thin: `validateRequest` + URL builder) | Deep import `twilio/lib/webhooks/webhooks` |
| `src/core/telephony/parse-voice-webhook.ts` | `clicksend/dlr/route.ts:138-151` (`decodeBody`) + `z.looseObject` at `inbound/route.ts:106-113` | Hard-require `CallSid`, `From`, `To`; everything else optional; `Direction === 'inbound'` else dead-letter |
| `src/core/telephony/caller.ts` (`classifyCaller`) | `src/core/cadence/primary-contact.ts:129-141` (`normalizeAuMobile`) | Returns `{ kind: 'mobile' \| 'other_number' \| 'withheld', e164 }`; E.164 regex + sentinel set; **does not replace** `normalizeAuMobile` (Phase 12's gate calls that) |
| `src/core/telephony/greeting.ts` | `src/core/brand.ts` (constants) + `src/core/escalation/message.ts` (fixed template) | `greetingTwiml(spokenName \| null)`; `escapeXml`; exports `GREETING_TEMPLATE`, `GREETING_VOICE = 'Polly.Olivia-Neural'`, `GREETING_LANGUAGE = 'en-AU'` |
| `src/core/telephony/missed-call.ts` (`recordMissedCallArrival`, `completeMissedCall`, `recordMissedCallFromLog`) | `src/core/messaging/inbound.ts:236-266` (unnormalizable arm) + `src/core/messaging/receipts.ts` | Framework-free; deps injectable |
| `src/core/telephony/twilio-client.ts` | `src/core/messaging/clicksend-client.ts:1-38` (header rules: creds never in returned strings; nothing throws) | `new Twilio(sid, token, { edge: 'sydney', timeout: 20_000 })`; wraps `calls.list`, `recordings.list`, `availablePhoneNumbers('AU').local.list`, `incomingPhoneNumbers.create` into closed-union results |
| `src/core/telephony/reconcile.ts` | `src/core/messaging/reconcile.ts` | Called from the messaging-reconcile route after `reconcileMessaging()` |
| `src/core/telephony/provision.ts` | `src/core/sync/connect.ts` (verify-then-write) + `src/core/cadence/dispatch.ts` (claim → act → outcome) | Claim `tenant_divert_numbers` row (`status='pending'`), buy, fill SID/number, `status='active'`; on purchase failure mark `status='failed'` with the fixed reason code (never Twilio prose) |
| `src/db/schema/tenant-divert-numbers.ts`, `src/db/schema/missed-calls.ts` | `src/db/schema/tenant-proofs.ts`, `src/db/schema/inbound-messages.ts` | See Pattern 3 for columns |
| `src/db/repository/missed-calls.ts` (+ `forTenant` additions, `forAllTenants_divertNumberByE164`) | `src/db/repository/inbound-messages.ts`, `delivery-receipts.ts`, `for-all-tenants.ts:352-389` | Export from `src/db/repository/index.ts` |
| `src/db/migrations/0038_phase11_telephony_capture.sql` | `0036_phase10_go_live.sql` | Header documents the `cadences` generalisation decision (D-11) as prose only |
| `src/app/(console)/clients/[id]/divert-number-form.tsx` + action in `actions.ts` + state in `action-state.ts` | `escalation-phone-form.tsx` / `armChannelAction` two-tap | Purchase confirm names number, locality, A$/month |
| `scripts/missed-calls-recent.mjs`, `scripts/twilio-numbers-search.mjs` | `scripts/escalations-recent.mjs`, `scripts/clicksend-balance.mjs` | See Validation §evidence scripts |
| `docs/telephony-runbook.md` (bundle, purchase, TwiML Bin fallback, rotation, spike protocol) | `docs/first-client-go-live-runbook.md` | Phase 12 adds the client-facing divert-code runbook (COMP-03); Phase 11's is founder-facing |

## Architecture Patterns

### System Architecture Diagram

```
 customer dials tradie ──▶ carrier conditional divert (61/62/67) ──▶ Twilio AU local number (US1, one per client)
                                                                            │
                          ┌─────────────────────────────────────────────────┴──────────────────────────────┐
                          ▼  POST form (signed; origin edge ashburn by default; 15 s hard ceiling)          ▼  POST form on completion
   /api/webhooks/twilio/voice?token=A                                                    /api/webhooks/twilio/voice-status?token=B
   1 token gate (401 before body)                                                        1 token gate
   2 raw = text(); params = URLSearchParams                                              2 raw → params
   3 url = webhookUrl('voice')  ← APP_BASE_URL required, else FAIL CLOSED                3 validateRequest(...) else 200 {received:true}, no write
   4 validateRequest(authToken, X-Twilio-Signature, url, params)                         4 completeMissedCall({callSid, status, duration, endedAt})
       ✗ → log '[twilio] voice signature_rejected' → GENERIC TwiML 200, NO WRITE           (UPDATE … WHERE provider='twilio' AND provider_call_id=$1)
   5 parse (looseObject; CallSid/From/To required; Direction='inbound')                  5 log '[twilio] status handled: <kind>.' → 200 {received:true}
       ✗ → dead-letter row (tenant NULL, raw ≤ 8k) → GENERIC TwiML 200
   6 ONE read: forAllTenants_divertNumberByE164(To) → {tenantId, spokenName, window}
       none → dead-letter (unknown_number) → GENERIC TwiML 200
   7 classifyCaller(From); after_hours = !isInsideWindow(now, window)
   8 INSERT missed_calls … ON CONFLICT (provider, provider_call_id) DO NOTHING
       (raced against a deadline; on timeout/throw → log fixed string, still answer)
   9 200 text/xml: <Response><Pause length="1"/><Say voice="Polly.Olivia-Neural" language="en-AU">…{spokenName}…</Say><Hangup/></Response>

   pg_cron 03:30 AWST ──▶ /api/internal/messaging-reconcile ──▶ reconcileMessaging() ──▶ reconcileMissedCalls():
                                                                   calls.list({startTimeAfter: now-48h}) via edge sydney
                                                                   → inbound && to ∈ divert numbers → recordMissedCallFromLog (same upsert)
                                                                   recordings.list({dateCreatedAfter}) must be [] else alert + '[twilio] RECORDING_PRESENT'

   console client page ──▶ provisionDivertNumberAction ──▶ claim row → search (inLocality Perth) → create({voiceUrl, statusCallback, bundleSid…}) → fill row
                      ──▶ recordProofAction(kind='divert_verification_call', artefact=missed_calls.id) ──▶ tenant_proofs
                      ◀── readGoLiveChecklist: divertNumber (number), divertVerified (proof date), days since last diverted call
```

### Recommended Project Structure
```
src/core/telephony/
├── webhook-url.ts          # ONE builder: `${APP_BASE_URL}/api/webhooks/twilio/<route>?token=<secret>`; throws BaseUrlUnsetError
├── verify-signature.ts     # validateRequest wrapper; returns boolean, never throws
├── parse-voice-webhook.ts  # form → z.looseObject; the Twilio vocabulary constants (CALL_STATUSES)
├── caller.ts               # classifyCaller(from): mobile | other_number | withheld (+ sentinel set)
├── greeting.ts             # greetingTwiml(spokenName|null); GREETING_* constants; escapeXml
├── missed-call.ts          # recordMissedCallArrival / completeMissedCall / recordMissedCallFromLog (deps injectable)
├── twilio-client.ts        # the only file that imports `twilio` (REST); closed-union results; edge: 'sydney'
├── reconcile.ts            # reconcileMissedCalls(deps)
└── provision.ts            # provisionDivertNumber({tenantId, spokenName}, deps): claim → search → buy → fill
src/app/api/webhooks/twilio/{voice,voice-status}/route.ts
src/db/schema/{tenant-divert-numbers,missed-calls}.ts
src/db/repository/missed-calls.ts (+ for-tenant.ts, for-all-tenants.ts, index.ts edits)
src/db/migrations/0038_phase11_telephony_capture.sql (+ meta/_journal.json, meta/0038_snapshot.json)
src/app/(console)/clients/[id]/divert-number-form.tsx (+ actions.ts, action-state.ts, checklist-card.tsx, page.tsx edits)
scripts/{missed-calls-recent,twilio-numbers-search}.mjs
tests/{twilio-voice-route,twilio-voice-status-route,telephony-greeting,telephony-webhook-url,telephony-caller,missed-call-reconcile,provision-divert-number,missed-calls}.test.ts (+ edits listed in Validation)
docs/telephony-runbook.md, docs/env-vars.md, docs/external-registrations.md
```

### Pattern 1: The voice route's auth ladder and fail-closed response
**What:** token → raw body → canonical URL → signature → parse → one read → insert (deadline-bounded) → TwiML; every failure after the token gate answers the **generic** greeting with 200 and a fixed-string log; only the token gate answers 401.
**When to use:** both Twilio routes (the status route answers `{ received: true }` instead of TwiML).
**Why the split between 401 and 200:** a request without the token cannot be Twilio (the token is in the configured URL), so 401 costs nothing and matches the house rule of refusing before reading a byte. A request *with* the token but a bad signature may be Twilio after an auth-token rotation or a URL drift — a 401 there plays an application error to a real customer (Twilio does not retry a 4xx by default, §1b) — so the honest answer is the generic greeting, no write, and a log line the ops probe finds. **[discretion — planner to confirm]**
**Example:**
```typescript
// src/app/api/webhooks/twilio/voice/route.ts  (skeleton — analog: clicksend/inbound/route.ts)
import { timingSafeEqual } from 'node:crypto';
import { validateRequest } from 'twilio/lib/webhooks/webhooks'; // [VERIFIED: tarball; no exports map]
import { getServerEnv } from '@/core/shared/env';
import { greetingTwiml } from '@/core/telephony/greeting';
import { webhookUrl } from '@/core/telephony/webhook-url';
import { parseVoiceWebhook } from '@/core/telephony/parse-voice-webhook';
import { recordMissedCallArrival } from '@/core/telephony/missed-call';

export const maxDuration = 60;
export const runtime = 'nodejs';

function twiml(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } });
}

export async function POST(request: Request): Promise<Response> {
  const env = getServerEnv();
  const token = new URL(request.url).searchParams.get('token');
  if (!tokenMatches(token, env.TWILIO_VOICE_WEBHOOK_SECRET)) return unauthorized(); // copied verbatim from clicksend/inbound

  const raw = await request.text().catch(() => null);
  if (raw === null) { console.warn('[twilio] voice body_unreadable; served generic greeting.'); return twiml(greetingTwiml(null)); }

  const url = webhookUrl('voice', env);            // throws BaseUrlUnsetError when APP_BASE_URL is unset
  if (url === null) { console.warn('[twilio] voice base_url_unset; served generic greeting.'); return twiml(greetingTwiml(null)); }

  const params = Object.fromEntries(new URLSearchParams(raw));
  if (!validateRequest(env.TWILIO_AUTH_TOKEN, request.headers.get('x-twilio-signature') ?? '', url, params)) {
    console.warn('[twilio] voice signature_rejected; served generic greeting.');   // THE fixed string CAP-04 names
    return twiml(greetingTwiml(null));
  }

  const parsed = parseVoiceWebhook(params);        // looseObject: CallSid, From, To required; Direction === 'inbound'
  const result = await recordMissedCallArrival(parsed, raw, { receivedAt: new Date() }); // never throws; returns { kind, spokenName }
  console.log(`[twilio] voice handled: ${result.kind}.`);   // closed union — no number, no name
  return twiml(greetingTwiml(result.spokenName));  // null → generic wording, same element shape
}
```

### Pattern 2: String-templated TwiML with a structural invariant
**What:** `greeting.ts` owns the only TwiML in the codebase; a test parses its output and scans the telephony sources for forbidden verbs.
**When to use:** always — D-04 says "a structural test fails if any is introduced".
**Example:**
```typescript
// src/core/telephony/greeting.ts
export const GREETING_VOICE = 'Polly.Olivia-Neural';   // [CITED: twilio.com/docs/voice/twiml/say/text-speech]
export const GREETING_LANGUAGE = 'en-AU';
export const SPOKEN_NAME_MAX = 60;

const GENERIC = "Hi, you've reached this business's after-hours line.";
export function greetingTwiml(spokenName: string | null): string {
  const lead = spokenName ? `Hi, you've reached ${escapeXml(spokenName)}.` : escapeXml(GENERIC);
  const text = `${lead} This is an automated message and the call isn't recorded. ` +
    `We're texting you now — if your number is private, text us instead.`;   // D-03 verbatim, "automated" kept
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Pause length="1"/><Say voice="${GREETING_VOICE}" language="${GREETING_LANGUAGE}">${text}</Say><Hangup/></Response>`;
}
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
```
```typescript
// tests/telephony-greeting.test.ts (structural half)
const FORBIDDEN = /<\s*(Record|Dial|Gather|Transcription|Start|Stop|Stream|Connect|Enqueue|Queue|Conference|Play|Redirect)\b/;
const FORBIDDEN_API = /\b(record\s*[:=]\s*true|recordings\.create|transcribe|\.record\()/i;
for (const file of glob(['src/core/telephony/**/*.ts', 'src/app/api/webhooks/twilio/**/*.ts'])) {
  expect(readFileSync(file, 'utf8')).not.toMatch(FORBIDDEN);
  expect(readFileSync(file, 'utf8')).not.toMatch(FORBIDDEN_API);
}
const elements = [...greetingTwiml('Smith & Sons').matchAll(/<([A-Za-z]+)[\s/>]/g)].map((m) => m[1]);
expect(new Set(elements)).toEqual(new Set(['Response', 'Pause', 'Say', 'Hangup']));
expect(greetingTwiml('Smith & Sons')).toContain('Smith &amp; Sons');
expect(greetingTwiml('X'.repeat(SPOKEN_NAME_MAX)).replace(/<[^>]+>/g, '').split(/\s+/).length).toBeLessThanOrEqual(32);
```
`Play` and `Redirect` are in the forbidden set deliberately: `<Play>` is the deferred per-client audio (CONTEXT), and a `<Redirect>` would let a second URL smuggle any verb in. When the deferred idea lands, the test is edited on purpose.

### Pattern 3: Double-sourced, idempotent capture on one arbiter
**What:** three writers, one unique index, all converging.
| Writer | Statement | Converges because |
|---|---|---|
| Arrival webhook | `INSERT … (provider, provider_call_id, tenant_id, divert_number_id, called_number_e164, caller_e164, caller_withheld, caller_raw, forwarded_from_raw, from_country, started_at, after_hours, call_status, source='webhook') ON CONFLICT (provider, provider_call_id) DO NOTHING RETURNING id` | second delivery of the same `CallSid` returns `[]` → `kind: 'duplicate'` |
| Status callback | `UPDATE missed_calls SET call_status=$2, duration_seconds=$3, ended_at=$4, completed_via='callback', updated_at=now() WHERE provider='twilio' AND provider_call_id=$1` | re-applying identical values moves only `updated_at`; unknown sid updates 0 rows → `kind: 'unmatched'` (no insert from a hint — the DLR rule) |
| Reconcile | `INSERT … (…, source='reconcile', call_status, duration_seconds, ended_at, completed_via='reconcile') ON CONFLICT (provider, provider_call_id) DO UPDATE SET call_status = EXCLUDED.call_status, duration_seconds = COALESCE(missed_calls.duration_seconds, EXCLUDED.duration_seconds), ended_at = COALESCE(missed_calls.ended_at, EXCLUDED.ended_at), completed_via = COALESCE(missed_calls.completed_via, 'reconcile')` | fills only what a dropped callback left NULL; never overwrites the arrival's `started_at`/`after_hours` (computed at arrival, D-07's "stored fact" rule in ARCH §1.6) |

**Columns (proposed; planner may rename):** `id uuid pk`, `tenant_id uuid NULL` (no FK), `divert_number_id uuid NULL` (no FK), `provider text NOT NULL CHECK (provider IN ('twilio'))`, `provider_call_id text NOT NULL`, `called_number_e164 text NOT NULL`, `caller_e164 text NULL`, `caller_withheld boolean NOT NULL DEFAULT false`, `caller_kind text NOT NULL CHECK (caller_kind IN ('mobile','other_number','withheld'))`, `caller_raw text NULL` (the raw `From`, evidence for S2; never printed), `forwarded_from_raw text NULL`, `from_country text NULL`, `started_at timestamptz NOT NULL` (UTC; Perth in the read path), `after_hours boolean NOT NULL`, `call_status text NOT NULL CHECK (call_status IN ('queued','initiated','ringing','in-progress','completed','busy','failed','no-answer','canceled'))` (the nine values `[CITED: twilio.com/docs/voice/twiml]`), `duration_seconds integer NULL`, `ended_at timestamptz NULL`, `source text NOT NULL CHECK (source IN ('webhook','reconcile'))`, `completed_via text NULL CHECK (completed_via IN ('callback','reconcile'))`, `raw_payload jsonb NULL` (dead letters only, ≤ 8 000 chars), `created_at`, `updated_at`; `UNIQUE (provider, provider_call_id)`; index `(tenant_id, started_at DESC)` for "latest call" and the recent list. **No text-back columns** — Phase 12 owns those in its own journal entry (one entry per phase, D-11).

`tenant_divert_numbers`: `id`, `tenant_id uuid NOT NULL UNIQUE` (D-02: one per client; the UNIQUE is the double-provision guard), `provider text NOT NULL CHECK ('twilio')`, `provider_number_sid text NULL` (PN…; NULL while `pending`), `number_e164 text NULL UNIQUE` (NULL while pending; `UNIQUE` allows multiple NULLs), `spoken_name text NOT NULL CHECK (length BETWEEN 1 AND 60)`, `status text NOT NULL CHECK (status IN ('pending','active','failed'))`, `failure_code text NULL` (closed code, never Twilio prose), `locality text NULL`, `purchased_at timestamptz NULL`, `created_by uuid NOT NULL` (operator id), `created_at`, `updated_at`. No FK to tenants (the `messaging_config` posture — "has no foreign key to `tenants`" `[VERIFIED: tests/go-live-checklist.test.ts:27-31]`), no delete path in the repository or the grants (D-08).

### Pattern 4: Claim-then-buy provisioning
**What:** `provisionDivertNumber` inserts the `pending` row first (the `tenant_id UNIQUE` refuses a concurrent second click with the duplicate-key error mapped to a sentence, the `isDuplicateNameError` shape at `src/core/shared/tenant.ts:241`), then searches, then buys with `voiceUrl`/`statusCallback` built by `webhookUrl()`, then fills `provider_number_sid`/`number_e164`/`locality`/`purchased_at` and flips `status='active'`. A purchase that throws leaves `status='failed'` + `failure_code` and the row stays (an operator retry is `UPDATE … WHERE status='failed'`, not a second insert); a *fill* that fails after a successful purchase logs the fixed string `[twilio] provision orphaned_number` with the PN sid (an identifier, not PII) so the founder attaches it by hand — the same "record what happened before the outcome" discipline as `dispatchOne`'s claim → send → outcome.
**Guard before buying:** `new URL(APP_BASE_URL).host === CONSOLE_HOST` and both `TWILIO_AU_BUNDLE_SID`/`TWILIO_AU_ADDRESS_SID` present; otherwise refuse with a sentence naming the missing thing (the `ARM_REFUSAL` style).

### Pattern 5: The verification call is a proof, not a column
**What:** widen `TENANT_PROOF_KINDS` to `['escalation_handset_proof', 'email_pipe_proof', 'divert_verification_call']` and the `tenant_proofs_kind_known` CHECK to match (drop-if-exists-then-add, the `0032:66-84` idempotence rule ARCH §8 cites); artefact = the `missed_calls.id` of the founder's own test call; `artefact_detail` = `{ provider_call_id, call_status, duration_seconds, after_hours, caller_kind, forwarded_from_present }` (no numbers). The checklist reads `proofs.latest('divert_verification_call')` exactly as it reads the other two; Phase 12's text-back gate adds `divertVerified` to its own gate list. "Days since last diverted call" is `repo.missedCalls.latest()` → `started_at`, rendered by the page as `formatInTenantZone(startedAt, tenant.timezone)` plus a day count computed from `now` in core (framework-free, like `attestationAgeDays` at `checklist.ts:97`).
**Why:** the proof table already encodes "artefact required, operator id required, server-set date, append-only, no delete grant" — properties D-09 wants and that a `verified_at` column would have to re-earn.

### Anti-Patterns to Avoid
- **Deriving the signed URL from the request** (`request.url`, `host`, `x-forwarded-*`): Vercel's proxy and any alias make it differ from what Twilio signed. Build from config, and only from `APP_BASE_URL`.
- **Inheriting `consoleBaseUrl()`'s fallback** for telephony: its `VERCEL_PROJECT_PRODUCTION_URL` arm can name the apex; a number wired to the apex answers with the marketing 404 page's bytes as "TwiML".
- **A second `incomingPhoneNumbers(sid).update()` to set the voice URL** after purchase: a window where a live number plays Twilio's demo.
- **Putting the ClickSend send, Anthropic, or any second network call in the voice route** (STACK §5.3's inline send is superseded by ARCH §2 and D-05): the 15 s ceiling includes TLS and cold start; the greeting must never wait on anyone.
- **Routing on `ForwardedFrom`** in any form, including "as a fallback when `To` is unknown" — D-02; pin it in the route test (`forAllTenants_divertNumberByE164` is called with `To` only).
- **`SELECT *` or a caller column in an evidence script** — `tests/ops-scripts.test.ts` will fail it, and the output is pasted into a file that lives forever.
- **A new pg_cron job** for the call-log reconcile — planning note S8; ride `messaging-reconcile`.
- **Storing local wall-clock time** — `started_at` is UTC; Perth is a read-path derivation (D-07, `tenants.timezone`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signature validation | A single-variant HMAC compare | `validateRequest` from `twilio/lib/webhooks/webhooks` | Four URL variants Twilio's backend may have signed; `scmp` constant-time compare `[VERIFIED: tarball webhooks.js:124-149]` |
| Twilio REST paging, edge hostnames, retries | A `fetch` wrapper with hand-built `PageToken` loops and `api.sydney.us1.twilio.com` strings | The SDK client with `{ edge: 'sydney' }` and `list({ limit })` | Hostname composition and paging are in `BaseTwilio` `[VERIFIED: tarball BaseTwilio.d.ts:104-108]`; the CLAUDE.md SDK ban is specific to ClickSend's generated client |
| Constant-time token compare | `===` | `tokenMatches` copied from the ClickSend routes | Length pre-check prevents `timingSafeEqual` throwing → 500 `[VERIFIED: clicksend/inbound/route.ts:115-134]` |
| Contact-hours arithmetic | A `getHours()` on a UTC `Date` | `isInsideWindow` | ISO-weekday and `time`-string traps documented at `window.ts:15-44` |
| AU mobile normalisation | A new regex in `caller.ts` | `normalizeAuMobile` for the `mobile` arm; `caller.ts` adds only the E.164 + sentinel classification around it | "the ONE normalizer" (ARCH §1.4; `primary-contact.ts:129-141`) |
| Proof/evidence semantics for the verification call | A `verified_at` column with its own action | `tenant_proofs` + `recordProofAction` third arm | Append-only, artefact-required, operator-stamped, already tested at the database (`tests/tenant-proofs.test.ts`) |
| XML escaping | String concat of the business name | `escapeXml` (5 entities) in `greeting.ts`, tested with `&` | TwiML is XML; `Smith & Sons` breaks the call |

**Key insight:** every Twilio-specific hazard in this phase (signed URL drift, 15 s ceiling, no retry on 5xx, demo TwiML on a freshly bought number) is a *configuration* hazard, not a logic one — the mitigations are "one builder for the URL", "set everything in the create call", "answer from one read", and "let the reconcile be the guarantee", all of which are shapes the codebase already has.

## Common Pitfalls (Question 4 — beyond PITFALLS.md)

### Pitfall 1: `APP_BASE_URL` is optional, and its fallback is the wrong host
**What goes wrong:** the route validates against a URL built from `consoleBaseUrl()`; in an environment without `APP_BASE_URL` it becomes `https://backdesk.com.au/...` (or localhost) and every real call fails signature → generic greeting forever, rows recovered only by the nightly reconcile.
**Why:** `APP_BASE_URL: z.url().optional()` `[VERIFIED: env.ts:214]`; fallback chain at `operator-email.ts:137-139`; Vercel's "shortest custom domain" rule `[ASSUMED]`.
**How to avoid:** `webhookUrl()` reads `APP_BASE_URL` only and returns `null` when unset; the voice route logs `base_url_unset`; provisioning refuses; a pure test pins the builder's exact output and the absence of a trailing slash; `docs/external-registrations.md:315` records that `APP_BASE_URL` was once absent from Vercel Production — it happened before.
**Warning signs:** `[twilio] voice signature_rejected` on every call while Twilio's debugger shows 200s.

### Pitfall 2: The token is inside the signed URL, so rotating it is a two-sided change
**What goes wrong:** rotating `TWILIO_VOICE_WEBHOOK_SECRET` in Vercel alone → the number still posts the old token → 401 → Twilio plays an application error (no retry on 4xx, §1b) until every number's `voiceUrl` is updated.
**How to avoid:** rotation runbook order: push new env → redeploy → run a `twilio:rewire` script that updates `voiceUrl`/`statusCallback` on every `tenant_divert_numbers` row → verify with one call. Accept the seconds-long 401 window, or have the route accept the previous secret for a grace period (`TWILIO_VOICE_WEBHOOK_SECRET_PREVIOUS`, optional) — **[discretion; document, do not build in Phase 11]**.

### Pitfall 3: 15 s includes TLS and the cold start; a slow Supabase connect must not hold the greeting
**What goes wrong:** cold Vercel function (~1 s) + pooled Postgres connect (Sydney, cold: up to several seconds; `connect_timeout: 30` at `client.ts:66`) + the insert → past 15 s → Twilio abandons the request → error tone, and *no retry*.
**How to avoid:** one read before the greeting is unavoidable (the name); bound the insert with `Promise.race` against a deadline (~6 s) and answer anyway on timeout with the fixed string `db_timeout`; the reconcile fills the row. Measure with S4's timestamps; if the read itself is the problem, cache the `To → {tenant, name, window}` map in module scope with a short TTL (the divert-number set changes once per client, ever).
**Warning signs:** Twilio error 11200/11205 in the console debugger; `CallDuration` of 0–1 s on completed callbacks.

### Pitfall 4: `From` is not always a number, and "withheld" is a set with unknown members
**What goes wrong:** `normalizeAuMobile('anonymous')` → `null` is indistinguishable from a landline → a withheld caller stored as "other_number" with `caller_e164 = null` and no marker, or `+266696687` stored as a real international number that Phase 12 might text.
**How to avoid:** `classifyCaller` order: (1) known sentinel numbers → withheld; (2) not E.164 and not a local `04…` → withheld (`caller_raw` kept); (3) `normalizeAuMobile` → `mobile`; (4) else `other_number` with the E.164. The spike's `#31#` call proves the first branch on Telstra/Optus/Vodafone; the sentinel list is `[ASSUMED]` beyond `anonymous`/`unknown`/`+266696687`.

### Pitfall 5: The incoming-call webhook is not retried; the status callback is not retried on 5xx either
Covered in §1b (**CORRECTION** to PITFALLS §6.2). Consequence for the planner: the dropped-callback drill in the runbook must be *simulated* (temporarily point the number's `statusCallback` at a wrong-token URL for one call, or block it), not "return a 500 and wait for the retry".

### Pitfall 6: Test credentials cannot buy an AU number; the first buy is real
`[CITED: twilio.com/docs/iam/test-credentials; regulatory/faq]`. Consequence: the console action is developed against an injected client stub (pure test), the search is rehearsed with the read-only script on the live account after bundle approval, and the first purchase is a checkpoint with the founder watching the Twilio console.

### Pitfall 7: Number-in-bundle assignment and the `voiceUrl` default
Passing `bundleSid` at create assigns the number to the bundle `[CITED: incomingphonenumber-resource]`; buying without it (or with a bundle for a different regulation) fails or leaves a number "at risk of regulatory reclamation" `[CITED: regulatory/faq]`. And a number bought without `voiceUrl` plays Twilio's demo. Both are avoided by the single create call in Pattern 4.

### Pitfall 8: Charging district and a Perth number for a business with a non-Perth street address
The address requirement is "within Australia" (`local` = in-country) `[CITED: availablephonenumberlocal-resource; au/regulatory]`; the charging-district notice affects callers' charges and porting, not eligibility. The one real constraint is *no PO box*. The founder's address that cleared ClickSend's IPND check (2026-08-29) is the one to register. If Twilio's Perth inventory is empty on the day (`inLocality: 'Perth'` returns nothing), any WA 08 number is acceptable — the tradie's customers never dial it.

### Pitfall 9: Tests that break by design when the phase lands
`tests/messaging-reconcile-route.test.ts:117` (`toEqual(RESULT)`), `tests/go-live-checklist.test.ts` ("Exactly eleven"), `tests/sync-upsert.test.ts` (`forAllTenants_*` count), `tests/rls-coverage.test.ts:116-137` (pinned grants map — add `tenant_divert_numbers` and `missed_calls`), the `ITEM_LABELS`/`ITEM_FIX` `Record`s (compile errors). List them in the plan so a red CI is expected, not investigated.

### Pitfall 10: Next 16 route handlers and `application/x-www-form-urlencoded`
No pitfall: route handlers hand over the raw stream; `request.text()` + `URLSearchParams` is exactly what `clicksend/dlr/route.ts:138-151` already does for ClickSend's form posts `[VERIFIED]`. Do not use `request.formData()` — it consumes the body before a dead-letter can keep the raw bytes.

### Pitfall 11: RFC 2822 `Timestamp` on the status callback
"given as UTC in RFC 2822 format" `[CITED: call-resource]`, e.g. `Tue, 29 Sep 2026 03:14:15 +0000`. `new Date(rfc2822)` parses in V8 `[ASSUMED]`; use `Date.parse` with a fallback to server receipt time, and never fail the callback on it.

### Pitfall 12: The reconcile must skip cleanly when telephony is not configured
`reconcileMessaging` skips with zero HTTP calls when SMS is not armed (`reconcile.ts:115-137`). The telephony pass needs the same total guard — no `tenant_divert_numbers` rows, or Twilio creds absent → `skipped: true`, zero calls — or CI's placeholder credentials would authenticate against Twilio nightly.

## Code Examples

### Signed fixture for the route tests (independent oracle, no SDK on the test side)
```typescript
// tests/twilio-voice-route.test.ts
import { createHmac } from 'node:crypto';
const AUTH_TOKEN = 'test-auth-token-of-32-plus-characters!!';
const VOICE_SECRET = 'a'.repeat(64);
const URL_ = `https://app.backdesk.com.au/api/webhooks/twilio/voice?token=${VOICE_SECRET}`;
vi.mock('@/core/shared/env', () => ({ getServerEnv: () => ({
  APP_BASE_URL: 'https://app.backdesk.com.au', TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  TWILIO_VOICE_WEBHOOK_SECRET: VOICE_SECRET, TWILIO_VOICE_STATUS_WEBHOOK_SECRET: 'b'.repeat(64),
}) }));
function sign(url: string, params: Record<string, string>): string {
  // The documented algorithm: url + sorted(key + value), HMAC-SHA1, base64 [CITED: webhooks-security]
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', AUTH_TOKEN).update(Buffer.from(data, 'utf8')).digest('base64');
}
function twilioPost(params: Record<string, string>, opts: { token?: string; signature?: string } = {}): Request {
  const body = new URLSearchParams(params).toString();
  const url = opts.token === undefined ? URL_ : `https://app.backdesk.com.au/api/webhooks/twilio/voice?token=${opts.token}`;
  return new Request(url, { method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': opts.signature ?? sign(URL_, params) } });
}
const CALL = { CallSid: 'CA' + 'f'.repeat(32), AccountSid: 'AC' + '0'.repeat(32), From: '+61491570156', To: '+61891570156',
  CallStatus: 'ringing', Direction: 'inbound', ApiVersion: '2010-04-01' };   // ACMA fiction-block numbers
```

### Reconcile pass (shape only)
```typescript
// src/core/telephony/reconcile.ts — analog: src/core/messaging/reconcile.ts
export async function reconcileMissedCalls(deps: MissedCallReconcileDeps = {}): Promise<MissedCallReconcileResult> {
  const numbers = await (deps.divertNumbers ?? forAllTenants_activeDivertNumbers)();
  const creds = deps.creds ?? twilioCredsFromEnv();
  if (numbers.length === 0 || creds === null) return NOTHING;                 // total guard, zero HTTP
  const since = new Date((deps.now ?? new Date()).getTime() - WINDOW_HOURS * 3_600_000);
  const calls = await (deps.listCalls ?? listInboundCalls)({ creds, since });  // calls.list({ startTimeAfter: since, limit: 500 })
  if (!calls.ok) { console.warn(`[twilio] reconcile calls poll failed: ${calls.reason}`); /* code, never prose */ }
  let recovered = 0;
  for (const call of calls.ok ? calls.items : []) {
    if (call.direction !== 'inbound') continue;
    const owner = numbers.find((n) => n.numberE164 === call.to); if (!owner) continue;
    const r = await (deps.recordFromLog ?? recordMissedCallFromLog)(call, owner);  // the SAME upsert the webhooks converge on
    if (r.kind === 'recovered') recovered += 1;
  }
  const recordings = await (deps.listRecordings ?? listRecordingsSince)({ creds, since });
  const recordingsFound = recordings.ok ? recordings.count : 0;
  if (recordingsFound > 0) { console.error('[twilio] RECORDING_PRESENT — D-04 violated; alerting operator.'); await (deps.alert ?? alertOperator)(...); }
  console.info(`[twilio] reconcile recovered=${recovered} recordings=${recordingsFound}`);
  return { skipped: false, missedCallsRecovered: recovered, recordingsFound };
}
```

### Provisioning — the Twilio calls (SDK spellings verified from the tarball)
```typescript
// src/core/telephony/twilio-client.ts
import Twilio from 'twilio';
const client = new Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, { edge: 'sydney', timeout: 20_000 }); // [VERIFIED: BaseTwilio.d.ts:12-24]
const candidates = await client.availablePhoneNumbers('AU').local.list({ inLocality: 'Perth', voiceEnabled: true, limit: 10 }); // [VERIFIED: local.d.ts:14-44]
const bought = await client.incomingPhoneNumbers.create({                       // [VERIFIED: incomingPhoneNumber.d.ts:33-73]
  phoneNumber: candidates[0].phoneNumber, bundleSid: env.TWILIO_AU_BUNDLE_SID, addressSid: env.TWILIO_AU_ADDRESS_SID,
  friendlyName: `backdesk-divert-${tenantId}`, voiceUrl: webhookUrl('voice', env), voiceMethod: 'POST',
  statusCallback: webhookUrl('voice-status', env), statusCallbackMethod: 'POST', voiceCallerIdLookup: false,
  ...(env.TWILIO_VOICE_FALLBACK_URL ? { voiceFallbackUrl: env.TWILIO_VOICE_FALLBACK_URL, voiceFallbackMethod: 'GET' } : {}),
});
// reconcile reads: client.calls.list({ startTimeAfter: since, limit: 500 })  [VERIFIED: call.d.ts:138-156]
//                  client.recordings.list({ dateCreatedAfter: since, limit: 50 }) [VERIFIED: recording.d.ts:28-36]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Twilio Basic `voice="woman"` TTS | Amazon Polly Neural/Generative and Google Chirp3-HD voices via `{Provider}.{Voice}` | Generative voices added 2024–25 `[CITED: say/text-speech]` | `Polly.Olivia-Neural` is current; `Polly.Olivia-Generative` exists if S5 finds Neural mispronounces trade names (cost differs; not researched) |
| Withheld CLI arriving as sentinel numbers | `anonymous` in `From` for withheld Programmable Voice calls `[CITED (snippet): Twilio changelog]` | 2024–26 | Keep both branches in `classifyCaller` |
| Twilio Regions US-only | AU1 Region with per-number incoming-call routing | GA | Deferred (D-10); S7 is a one-call check |
| Webhook retries "a few times with backoff" (secondary sources) | Documented defaults: `rc=1`, `rp=ct` (connect failures only), 15 s hard ceiling `[CITED: webhooks-connection-overrides]` | — | Reconcile is the guarantee; do not design around retries |

**Deprecated/outdated:** nothing in the fetched Twilio pages affects this phase. The `twilio` 5.x → 6.x major (2026) is the current line; 6.1.1 is 17 days old (see Package Legitimacy Audit).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `VERCEL_PROJECT_PRODUCTION_URL` is Vercel's *shortest* production custom domain (could be the apex) | §1a, Pitfall 1 | Low if the builder ignores the fallback anyway (recommended); High if a plan reuses `consoleBaseUrl()` |
| A2 | Twilio does not follow HTTP redirects on webhooks / a 308 would break the signature | §1a | Nil if the number is configured with the canonical host (recommended) |
| A3 | Full withheld-sentinel list beyond `anonymous`/`unknown`/`+266696687` (RESTRICTED `+7378742833`, UNAVAILABLE `+86282452253`, BLOCKED `+2562533`) | §1b, Pitfall 4 | Low — the "not E.164 ⇒ withheld" rule catches the alpha strings; a numeric sentinel not in the list would be stored as `other_number`, which Phase 12's AU-mobile gate rejects anyway |
| A4 | A URL fragment (`#e=sydney&rc=…`) on the configured webhook URL is not part of the signed URL | §1b | Medium — verify with one live call before adopting overrides; not used in v1 |
| A5 | `inLocality: 'Perth'` returns AU local inventory | §1e | Low — the search script settles it before the action is coded; fallback `contains` + client-side `region === 'WA'` |
| A6 | One approved AU-local-business bundle is assignable to every number the cohort needs | §1e | Medium — a second-purchase refusal is a founder checkpoint, not code |
| A7 | No Twilio account-level or Recording-Configuration setting records inbound calls without a TwiML/API instruction | §1e, D-04 | Low — the founder confirms the Configurations page is empty (D-12) and the reconcile alarms on any recording |
| A8 | Client `edge: 'sydney'` does not change where an inbound PSTN call is processed (stays US1) | §1c, D-10 | Low — S7's one-call check; if AU1 processing appeared, the reconcile would see nothing and the spike would show it |
| A9 | `<Say>` character ceiling is in the thousands; SSML tag list | §1d | Nil at ~190 characters; SSML unused |
| A10 | V8 parses RFC 2822 `Timestamp` via `Date.parse` | Pitfall 11 | Nil — fallback to receipt time |
| A11 | TwiML Bins have no public REST API (fallback URL is a console action) | §1b | Low — optional feature |
| A12 | Inbound CLI arrives as E.164 (Twilio TwiML page) rather than "local format" (AU guideline, STACK source 22) | §1b | Low — parser accepts both; the spike records which |
| A13 | Twilio Neural TTS per-100-character price and A$3.00/month number rent (STACK §7, not re-fetched) | Cost | Low — inside the tooling budget by an order of magnitude |

## Open Questions (RESOLVED)

1. **One or two route tokens? CONTEXT names only `TWILIO_VOICE_WEBHOOK_SECRET`, but D-05 says "a per-route URL token, per the four-bearer rule".**
   **RESOLVED — two route tokens (plan 11-01).**
   - What we know: the ClickSend pair uses two secrets and `tests/clicksend-dlr-route.test.ts:115-120` pins that one does not open the other's door; the constraint list in CONTEXT may simply be abbreviated.
   - Recommendation: two secrets (`TWILIO_VOICE_WEBHOOK_SECRET`, `TWILIO_VOICE_STATUS_WEBHOOK_SECRET`), documented in `docs/env-vars.md` and pushed together; note the naming in the plan so the discuss-phase record is reconciled.
2. **Signature failure → 401 or generic greeting 200?**
   **RESOLVED — 401 for token failure before the body; generic greeting/200 on signature failure (plans 11-01/11-02).**
   - What we know: CAP-04 requires "never 5xx" and a fixed-string log; both options satisfy it; Twilio does not retry a 4xx (§1b) so a 401 on a real call is an error tone.
   - Recommendation: token failure → 401 (cannot be Twilio); signature failure → generic greeting, 200, no write, `signature_rejected` log (Pattern 1). Status route: signature failure → `{ received: true }`, no write.
3. **Where does the call-log reconcile run, and how often?**
   **RESOLVED — reconcile rides messaging-reconcile, no new job (plan 11-03).**
   - What we know: S8 forbids a new cron job; `messaging-reconcile` runs 03:30 AWST daily with a 48 h window; Phase 12's text-back guarantee is the cadence-tick sweep over *rows*, not the provider.
   - Recommendation: ride `messaging-reconcile` (daily) in Phase 11. If Phase 12's spike shows dropped *arrival* webhooks are real (a call with no row until 03:30), tighten by changing that one job's schedule to hourly — a schedule edit, not a new job — and let Phase 12 decide whether a row recovered hours later is still textable (it should not be).
4. **Fallback URL (TwiML Bin) in v1?**
   **RESOLVED — optional TwiML Bin fallback URL, env optional (plans 11-01/11-06).**
   - Recommendation: yes if the founder can create the bin in the D-12 checkpoint in ten minutes (generic wording, no business name); otherwise ship without and rely on the reconcile. Make `TWILIO_VOICE_FALLBACK_URL` optional so the code path exists either way.
5. **Spoken name source: `tenants.name` or a dedicated field?**
   **RESOLVED — `spoken_name` on tenant_divert_numbers, editable (plans 11-01/11-05).**
   - What we know: `tenants.name` is the console label (e.g. "Perth Sparks Electrical (Test)"); the email identity carries `businessName` on `messaging_config` (`checklist.ts:210-214`).
   - Recommendation: `tenant_divert_numbers.spoken_name` typed by the operator at provisioning, defaulted from `tenants.name`, ≤ 60 chars — the greeting must read aloud well, which neither existing field promises.
6. **How is the "deliberately dropped status callback" (success criterion 3) staged on production?**
   **RESOLVED — wrong-token callback drill + verify-missed-call-reconcile.mjs (plans 11-06/11-07).**
   - Recommendation: the runbook step is: place one call with the number's `statusCallback` temporarily pointed at the correct route with a *wrong* token (Twilio will log a 401; nothing is written), confirm the row is incomplete via `npm run missed-calls:recent`, run the reconcile once (a `scripts/verify-missed-call-reconcile.mjs` that loads the TS core through `scripts/lib/ts-alias-hook.mjs`, the way `verify-drafting.mjs` runs core code), confirm the row completed with `completed_via = reconcile` and no duplicate, then restore the callback URL via the same rewire script Pitfall 2 needs anyway.
7. **`maxDuration` for the voice route.**
   **RESOLVED — maxDuration 60 with an in-handler deadline (plan 11-01).**
   - Recommendation: keep 60 like its siblings (a decision, not a default — their comment); the real bound is the in-handler deadline in Pitfall 3.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v22.20.0 `[VERIFIED: node --version]` | — |
| npm | install `twilio` | ✓ | 10.9.3 | — |
| `twilio` package | routes, reconcile, provisioning | ✗ (not installed; registry reachable) | 6.1.1 on registry | — (install is a task) |
| Supabase CLI | migrations / local stack (CI) | ✓ devDependency | 2.115.0 (`package.json`; CI pins the same) | — |
| Docker / local Supabase | DB-backed suites | ✗ on the dev machine ("The dev machine has no Docker" `[VERIFIED: .github/workflows/ci.yml:3-5]`) | — | CI runs `supabase start`; locally only pure suites |
| Vercel project + `APP_BASE_URL` in Production | webhook URL | ✓ (set 2026-08-29, `docs/external-registrations.md:322-338`) | `https://app.backdesk.com.au` | — |
| Twilio account, AU regulatory bundle, Address resource | number purchase, every live check | ✗ — founder action (D-12) | — | Telnyx (D-01) only if the bundle is refused |
| Twilio Perth 08 inventory | CAP-01 | unknown until the search script runs | — | any WA 08 number |
| Three carrier handsets (Telstra, Optus, Vodafone) | live spike (criterion 4) | founder + design partners | — | — |

**Missing dependencies with no fallback:** the Twilio account/bundle (gates all live work — submit day 1); carrier handsets for the spike.
**Missing dependencies with fallback:** Docker locally (CI covers the DB suites); Perth inventory (any WA 08).

## Validation Architecture (Question 3)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.11 `[VERIFIED: package.json]`; `include: ['tests/**/*.test.ts']`, `setupFiles: ['tests/helpers/env.ts']`, `fileParallelism: false`, `testTimeout: 30000` `[VERIFIED: vitest.config.mts:14-46]` |
| Config file | `vitest.config.mts` |
| Quick run command | `npx vitest run tests/twilio-voice-route.test.ts tests/telephony-greeting.test.ts` (pure; no credentials) |
| Full suite command | `npm test` (pure suites locally; DB suites only where `NEXT_PUBLIC_SUPABASE_URL` is local — CI); `npm run test:remote` is **forbidden for the new DB suites** (D-11 rule in `tests/tenant-proofs.test.ts:16-21`, and MEMORY: hosted DB is production) |
| Estimated runtime | pure additions < 5 s; CI full run ~8 min (global-setup comment) |

### Three tiers, by what they may touch
| Tier | Runs where | Suites (new or edited) |
|---|---|---|
| **Pure** (no DB, no provider; `vi.mock` env + repository; signed fixtures built with `node:crypto`) | bare `npm test`, every task commit | `tests/twilio-voice-route.test.ts`, `tests/twilio-voice-status-route.test.ts`, `tests/telephony-greeting.test.ts`, `tests/telephony-webhook-url.test.ts`, `tests/telephony-caller.test.ts`, `tests/missed-call-reconcile.test.ts`, `tests/provision-divert-number.test.ts`, `tests/divert-proof-action.test.ts` (or extend `tests/proof-actions.test.ts`), `tests/ops-scripts.test.ts` (+2 scripts), `tests/messaging-reconcile-route.test.ts` (edit `RESULT`), `tests/cron-schedules.test.ts` (unchanged — no new job) |
| **DB-backed** (`supabase start` on the CI runner only) | CI per push | `tests/missed-calls.test.ts` (new), `tests/tenant-divert-numbers.test.ts` (new, or folded into the former), `tests/rls-coverage.test.ts` (grants map + policy pins), `tests/go-live-checklist.test.ts` (13 items; `divertNumber`/`divertVerified` states), `tests/tenant-proofs.test.ts` (third kind accepted; unknown kind still refused), `tests/sync-upsert.test.ts` (forAllTenants count) |
| **Live / human** (production, founder) | D-12 checkpoints | bundle approval; first purchase from the console; TwiML fallback bin; recordings page empty; the divert spike (3 carriers × no-answer/busy/unreachable + one `#31#`); the dropped-callback drill (Open Question 6); S4/S5/S7 measurements — all recorded with the evidence scripts into `docs/external-registrations.md` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAP-01 | Claim-then-buy; refuses a second number for a tenant; `voiceUrl`/`statusCallback` carry the route tokens from the ONE builder; `smsUrl` never set; `voiceCallerIdLookup` false; refuses when `APP_BASE_URL` host ≠ `CONSOLE_HOST` or bundle/address SIDs absent | unit (pure, injected Twilio stub) | `npx vitest run tests/provision-divert-number.test.ts` | ❌ Wave 0 |
| CAP-01 | `tenant_divert_numbers`: `tenant_id` UNIQUE, `number_e164` UNIQUE, status CHECK, no console-role INSERT/UPDATE/DELETE grant, RLS `has_tenant_access` | DB (CI) | `npx vitest run tests/missed-calls.test.ts` | ❌ Wave 0 |
| CAP-01 | Console action authorizes (`requireOperatorId` + RLS read) before any Twilio call; two-tap confirm names number/locality/cost | unit (pure, faked session one level below `requireOperatorId`) | `npx vitest run tests/divert-proof-action.test.ts` | ❌ Wave 0 |
| CAP-02 | TwiML elements ⊆ {Response, Pause, Say, Hangup}; forbidden-verb regex over telephony sources; `&` escaped; voice/language constants; word budget | unit (structural) | `npx vitest run tests/telephony-greeting.test.ts` | ❌ Wave 0 |
| CAP-02 | Reconcile alarms and logs `RECORDING_PRESENT` when `listRecordings` returns > 0 | unit (pure) | `npx vitest run tests/missed-call-reconcile.test.ts` | ❌ Wave 0 |
| CAP-02 | Live: `CallDuration` on completed callbacks ≤ 13 s (greeting + pause); listening check (S5) | manual | `npm run missed-calls:recent` | — |
| CAP-03 | Arrival inserts with tenant from `To`, `caller_kind`, `after_hours` from `isInsideWindow`, `started_at` UTC; duplicate `CallSid` → `[]`; unknown `To` → tenant-less dead letter; `ForwardedFrom` never used for lookup | unit (pure) | `npx vitest run tests/twilio-voice-route.test.ts` | ❌ Wave 0 |
| CAP-03 | Status callback completes by exact match; unknown sid = counted, no row | unit (pure) | `npx vitest run tests/twilio-voice-status-route.test.ts` | ❌ Wave 0 |
| CAP-03 | Reconcile: call in log with no row → inserted once; existing row → completed, not duplicated; poll failure → warn + 0; total guard = zero HTTP | unit (pure) | `npx vitest run tests/missed-call-reconcile.test.ts` | ❌ Wave 0 |
| CAP-03 | `UNIQUE (provider, provider_call_id)` at the database; CHECK vocabularies refuse unknown status/kind/source; two-arm RLS (operator sees own tenant's rows + tenant-null dead letters; not another tenant's); no console-role write grant | DB (CI) | `npx vitest run tests/missed-calls.test.ts` | ❌ Wave 0 |
| CAP-03 | `classifyCaller`: `anonymous`/`unknown`/`+266696687` → withheld; `04…`/`+614…` → mobile; `08…`/`+61 8` landline and `+44…` → other_number with E.164 | unit (pure) | `npx vitest run tests/telephony-caller.test.ts` | ❌ Wave 0 |
| CAP-03 | Live divert spike + dropped-callback drill | manual (checkpoint) | `npm run missed-calls:recent -- --tenant <uuid> --limit 20` | — |
| CAP-04 | 401 without token / wrong same-length / truncated / empty, body never read; signature mismatch → 200 generic TwiML, no write, fixed log; unset `APP_BASE_URL` → fixed log, generic TwiML; DB throw → generic TwiML 200; response byte-identical across failure kinds; the OTHER route's secret rejected; no `console.*` interpolates From/To; proxy excludes `api/` | unit (pure) | `npx vitest run tests/twilio-voice-route.test.ts tests/twilio-voice-status-route.test.ts` | ❌ Wave 0 |
| CAP-04 | `webhookUrl()` exact string, https, no trailing slash, token present, `null` when unset; provisioning imports the same builder (source pin) | unit (pure) | `npx vitest run tests/telephony-webhook-url.test.ts` | ❌ Wave 0 |
| CAP-05 | `readGoLiveChecklist` returns 13 items in order; `divertNumber` satisfied only for an `active` row; `divertVerified` satisfied only with a `divert_verification_call` proof; days-since read | DB (CI) | `npx vitest run tests/go-live-checklist.test.ts` | ✅ (edit) |
| CAP-05 | Proof action third arm: refuses a foreign or non-completed `missed_calls` id without writing; refuses without an active divert row; writes detail with no numbers | unit (pure) | `npx vitest run tests/divert-proof-action.test.ts` | ❌ Wave 0 |
| CAP-05 | `tenant_proofs_kind_known` accepts the new kind, still refuses unknown | DB (CI) | `npx vitest run tests/tenant-proofs.test.ts` | ✅ (edit) |
| all | Ops scripts read-only, no PII columns, CR-01 URL guard, GET-only provider call | unit (source pins) | `npx vitest run tests/ops-scripts.test.ts` | ✅ (edit) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/twilio-voice-route.test.ts tests/telephony-greeting.test.ts` (< 5 s), plus `npx tsc --noEmit`
- **Per wave merge:** `npm test` (pure) locally; CI green (DB tier) before the next wave
- **Phase gate:** CI green + the live spike recorded in `docs/external-registrations.md` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/twilio-voice-route.test.ts`, `tests/twilio-voice-status-route.test.ts` — CAP-03/04 (copy the two ClickSend route suites; add the `sign()` oracle)
- [ ] `tests/telephony-greeting.test.ts`, `tests/telephony-webhook-url.test.ts`, `tests/telephony-caller.test.ts` — CAP-02/04/03
- [ ] `tests/missed-call-reconcile.test.ts`, `tests/provision-divert-number.test.ts`, `tests/divert-proof-action.test.ts` — CAP-03/01/05
- [ ] `tests/missed-calls.test.ts` (DB) — CAP-01/03; seed helpers `seedDivertNumber`, `seedMissedCall` added to `tests/helpers/seed.ts` (stamped names, teardown by id — the `seedEscalation` pattern at `tests/tenant-proofs.test.ts:55-80`)
- [ ] Edits: `tests/rls-coverage.test.ts` grants map; `tests/go-live-checklist.test.ts` (13); `tests/tenant-proofs.test.ts` (3 kinds); `tests/sync-upsert.test.ts` (count); `tests/messaging-reconcile-route.test.ts` (`RESULT` + 2 fields); `tests/ops-scripts.test.ts` (+2 scripts); `tests/helpers/env.ts` `REQUIRED` (+4); `.github/workflows/ci.yml` dummies (+4)
- [ ] Framework install: none (vitest present)

### Evidence scripts (the live spike's record)
- `scripts/missed-calls-recent.mjs` — `npm run missed-calls:recent -- [--tenant <uuid>] [--limit <1..50>]`. Select list (explicit): `id, tenant_id, provider_call_id, started_at, ended_at, call_status, duration_seconds, after_hours, caller_kind, caller_withheld, (caller_e164 IS NOT NULL) AS caller_present, (forwarded_from_raw IS NOT NULL) AS forwarded_from_present, from_country, source, completed_via, created_at`. **Never** `caller_e164`, `caller_raw`, `forwarded_from_raw`, `raw_payload`. Prints one line per row, newest first, ISO timestamps. Carrier is **not** a stored fact (Twilio does not send it); the founder writes the carrier and divert type beside each script line in the evidence entry, matched by time — that is the "ForwardedFrom fill-rate per carrier" table criterion 4 asks for.
- `scripts/twilio-numbers-search.mjs` — one GET to `https://api.sydney.us1.twilio.com/2010-04-01/Accounts/{sid}/AvailablePhoneNumbers/AU/Local.json?InLocality=Perth&VoiceEnabled=true` via `fetch` with Basic auth (or the SDK — but the ops-scripts pins expect one `fetch(`, `method: 'GET'`, `e.name` only, status-not-body on failure `[VERIFIED: tests/ops-scripts.test.ts:50-99]`); prints `phone_number`, `locality`, `region`, `address_requirements` per candidate and nothing else. Settles A5 and rehearses CAP-01 read-only.
- Evidence entry template for `docs/external-registrations.md`: `## 2026-10-DD — Phase 11 live divert spike` with a table `carrier | divert type | handset | call time (AWST) | script line id | caller_present | forwarded_from_present | caller_kind | call_status | duration_seconds`, then the S4/S5/S7 numbers and the dropped-callback drill (row id, `completed_via`).

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (machine) | Twilio HMAC-SHA1 signature via `validateRequest` + per-route 64-hex token compared with `timingSafeEqual`; operator actions via `requireOperatorId` |
| V3 Session Management | no (new) | existing Supabase session for console actions |
| V4 Access Control | yes | RLS-scoped authorize read before service-role write (`actions.ts:113-127` pattern); `has_tenant_access` / two-arm policies on both tables; no console-role write grants |
| V5 Input Validation | yes | `z.looseObject` for form params; E.164 regex; `spoken_name` bounded (≤ 60, XML-escaped); `raw_payload` ≤ 8 000 chars; uuid check before any artefact read |
| V6 Cryptography | yes | `node:crypto` HMAC via the SDK; `scmp`/`timingSafeEqual`; secrets 32+/64-hex generated with `openssl rand -hex 32` |
| V13 API / webhooks | yes | Uniform responses (anti-oracle), never 5xx, counts-only logs |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged webhook (fake call rows, fake completions) | Spoofing | Signature + token; a forgery without the auth token cannot produce a valid signature; token alone yields the generic greeting and no write |
| Replay of a captured valid request | Tampering | Idempotent insert (`DO NOTHING`), convergent UPDATE; a replay changes nothing but `updated_at` |
| Tenant enumeration via the greeting | Information disclosure | Greeting names a business only for a `To` the caller already dialled; unknown `To` → generic; status route body uniform |
| PII in logs / evidence files | Information disclosure | Closed-union log kinds; scripts' explicit select lists; `caller_raw` never printed; `tests/ops-scripts.test.ts` pins |
| XML injection into TwiML via `spoken_name` | Tampering | `escapeXml` + length cap; structural test with `&` |
| Log injection via `From`/`To`/`ForwardedFrom` | Tampering | Never interpolated (regex pin copied from `tests/clicksend-inbound-route.test.ts:148-153`) |
| Call flood → Twilio cost / DB growth | DoS | Phase 11 cost per junk call ≈ A$0.01 + TTS; rows are small; Phase 12 owns caps; `raw_payload` only on dead letters |
| Purchase action invoked out of band (global action id) | Elevation | `requireOperatorId` + RLS read + `tenant_id UNIQUE` claim; the buy is idempotent per tenant |
| Secret in URL (token in Twilio's config and logs) | Information disclosure | Accepted per the four-bearer rule (`clicksend/inbound/route.ts:15-24`); its own secret, rotatable; grants only the route's write surface (one idempotent insert) |
| Orphaned purchased number | Repudiation | Claim row + fixed-string log with PN sid; reconcile lists `incomingPhoneNumbers` vs rows (optional Phase 12 add) |

## Sources

### Primary (HIGH confidence)
- The codebase at HEAD `ccbd039` — every `path:line` above read this session: `src/app/api/webhooks/clicksend/{inbound,dlr}/route.ts`, `src/app/api/internal/{messaging-reconcile,cadence-tick,sync-tick}/route.ts`, `src/proxy.ts`, `src/core/messaging/{reconcile,clicksend-client,inbound}.ts`, `src/core/cadence/{window,primary-contact}.ts`, `src/core/onboarding/{checklist,arming}.ts`, `src/core/shared/{env,tenant}.ts`, `src/core/alerts/operator-email.ts`, `src/core/brand.ts`, `src/db/schema/{tenants,tenant-proofs,inbound-messages,escalations,index}.ts`, `src/db/repository/{for-tenant,for-all-tenants,client}.ts`, `src/db/migrations/{0036,0037}*.sql`, `meta/_journal.json`, `README.md`, `src/app/(console)/clients/[id]/{page,actions,action-state,checklist-card}.*`, `src/app/(console)/_auth.ts`, `scripts/{audit-requests-count,escalations-recent,push-vercel-env,apply-cron-schedules}.mjs`, `scripts/lib/support.mjs`, `tests/{clicksend-inbound-route,clicksend-dlr-route,messaging-reconcile,messaging-reconcile-route,ops-scripts,rls-coverage,go-live-checklist,proof-actions,tenant-proofs,lint-ban,cron-schedules}.test.ts`, `tests/helpers/{env,global-setup,seed}.ts`, `vitest.config.mts`, `vercel.json`, `next.config.ts`, `package.json`, `.github/workflows/ci.yml`, `docs/{env-vars,external-registrations,first-client-go-live-runbook}.md`
- `twilio@6.1.1` tarball from registry.npmjs.org (2026-09-27): `package/lib/index.js`, `lib/webhooks/webhooks.js`, `lib/base/BaseTwilio.d.ts`, `lib/rest/api/v2010/account/{call,incomingPhoneNumber,recording}.d.ts`, `availablePhoneNumberCountry/local.d.ts`; `npm view twilio version time.modified scripts repository engines dependencies exports main`

### Secondary (MEDIUM confidence — official pages fetched 2026-09-27)
- https://www.twilio.com/docs/usage/webhooks/webhooks-security — algorithm, exact-URL rule, `validateRequest`/`validateRequestWithBody`, `bodySHA256`
- https://www.twilio.com/docs/voice/twiml — request parameters, `From` anonymous note, `ForwardedFrom`, `CallStatus` values
- https://www.twilio.com/docs/voice/api/call-resource — status-callback events/params, list filters, resource fields
- https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides — 15 s ceiling, `ct/rt/tt/rc/rp/e` defaults, fragment syntax
- https://www.twilio.com/docs/voice/twiml/say and /say/text-speech — en-AU voices, attribute syntax, defaults
- https://www.twilio.com/docs/phone-numbers/api/availablephonenumberlocal-resource — which filters are US/CA-only; `address_requirements`
- https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource — create parameters (`BundleSid`, `AddressSid`, `VoiceUrl`, `VoiceFallbackUrl`, `StatusCallback`, `VoiceCallerIdLookup`, `FriendlyName` ≤ 64)
- https://www.twilio.com/en-us/guidelines/au/regulatory — AU local requirements (individual/business documents, no PO box, charging-district notice, Scam Prevention Framework)
- https://www.twilio.com/docs/phone-numbers/regulatory/faq — 24 business-hour review target, trial accounts, reclamation risk
- https://www.twilio.com/docs/iam/test-credentials — magic numbers, no status callbacks, no live-account interaction
- https://www.twilio.com/docs/global-infrastructure/understanding-twilio-regions — Region data isolation, per-number Region config
- https://www.twilio.com/docs/global-infrastructure/edge-locations — `sydney` edge exists
- https://www.twilio.com/docs/voice/api/recording, https://www.twilio.com/docs/voice/recording-settings, https://www.twilio.com/docs/configurations/recording — how recordings are created; account settings govern, never create
- Search snippets (official Twilio changelog / support): withheld caller ID → `anonymous`; bundle assignment to purchased numbers; AU review "up to three business days"

### Tertiary (LOW confidence)
- `+266696687` and sibling sentinels (STACK.md source 23; help article returned 403/empty this session); Vercel `VERCEL_PROJECT_PRODUCTION_URL` "shortest domain" rule; TwiML Bin API absence; hookdeck/inventivehq retry claims (superseded by the official overrides page)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for `twilio@6.1.1` internals (tarball read) and the repo's pinned stack; the seam flags the version as `SUS: too-new` — human confirm before install
- Architecture: HIGH — every seam and analog file read; the design is the ClickSend doors with a signature and a TwiML body
- Twilio platform behaviour: MEDIUM — official pages, single-source, fetched today; three corrections to the milestone research recorded inline
- Pitfalls: MEDIUM — the `APP_BASE_URL` fallback and the no-retry-on-5xx facts are the two the planner must not lose
- AU carrier behaviour / regulatory timing: LOW — the spike and the bundle checkpoint exist because no page can settle them

**classify-confidence seam:** `webfetch` → LOW, `webfetch --verified` → LOW, `websearch` → LOW (recorded as the seam returned it; the tags above follow the role's source hierarchy, with official-doc fetches as `[CITED]` = MEDIUM).

**Research date:** 2026-09-27
**Valid until:** 2026-10-27 for Twilio API shapes and the codebase map (re-verify `path:line` after any merge to `main`); the `twilio` version pin and the AU regulatory timing should be re-checked at plan time if more than two weeks pass.
