---
phase: 04-messaging-gateway
plan: 05
subsystem: messaging
tags: [email, resend, unsubscribe, rfc-8058, spam-act, hmac, suppression, msg-02, msg-03, d-01, d-02]

requires:
  - phase: 04-messaging-gateway
    plan: 01
    provides: suppressFromInbound + the email_unsubscribe source arm, UNSUBSCRIBE_SIGNING_SECRET and APP_BASE_URL in env.ts, the four-bearer rule
  - phase: 04-messaging-gateway
    plan: 03
    provides: RoutingSender/buildRoutingSender, chooseSmsSender as the gate template, messaging_config with reply_to and business_name, the pure/remote suite split
  - phase: 04-messaging-gateway
    plan: 04
    provides: serialization of remote runs against the shared hosted database
  - phase: 04-messaging-gateway
    plan: 06
    provides: domainOfAddress, the Resend error-name-only boundary shape, and the console screen that writes the enabled email row this plan's gate reads
  - phase: 03-cadence-engine
    provides: the untouchable TouchSender contract (D-13), the just-in-time suppression probe in dispatch, StubSender
provides:
  - mintUnsubscribeToken / verifyUnsubscribeToken / unsubscribeUrl — the HMAC token and the one spelling of the link
  - GET/POST /api/unsubscribe — the public one-click endpoint, byte-identical on every path
  - ResendSender — TouchSender over Resend, provider 'resend', non-throwing
  - buildEmailMessage — the pure message builder (Spam Act footer, RFC 8058 headers, D-01 reply-to)
  - isOwnerOnlySender / OWNER_ONLY_SENDER_DOMAIN — the resend.dev refusal both the sender and the script ask
  - chooseEmailSender + resolveEmailIdentity — the D-04 email activation gate and its per-tenant resolver
  - scripts/verify-email-pipe.mjs + npm run verify:email-pipe — the D-02 live proof
affects: [04-07 activation + the live send, 05 email touch templates, 07 attribution]

actuals:
  tokens: 32000
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "A public endpoint whose only credential is a token in a customer's inbox answers every request with the SAME bytes — valid, forged, malformed, replayed and database-down — so that it cannot be asked a question about who is being chased"
    - "A GET that must not vary by input is written as a handler that TAKES NO INPUT: the property becomes a fact about the function signature rather than a promise about the body, and `GET.length === 0` is what stops a later edit reintroducing the parameter"
    - "A confirmation form with no `action` posts to the current URL, so a credential in the query string never has to be echoed into the markup to survive the round trip"
    - "When a compliance input is missing, REFUSE rather than degrade: there is no version of a follow-up email worth sending with a localhost unsubscribe link, an unidentified sender or a reply-to nobody reads"
    - "An operator-typed string that lands in a mail header is stripped of control characters and quoting characters but never of words — the injection is the newline, and deleting text a human typed would break the identification the header exists to provide"

key-files:
  created:
    - src/core/messaging/unsubscribe-token.ts
    - src/app/api/unsubscribe/route.ts
    - src/core/messaging/resend-sender.ts
    - scripts/verify-email-pipe.mjs
    - tests/unsubscribe.test.ts
    - tests/unsubscribe-suppression.test.ts
    - tests/resend-sender.test.ts
  modified:
    - src/core/messaging/routing-sender.ts
    - package.json
    - tests/inbox-authorization.test.ts

key-decisions:
  - "The GET confirmation handler takes NO request argument at all. 'Identical for every token' stops being an assertion about output and becomes a property of the signature — and the form carries no `action`, so the token stays in the query string it arrived in and is never echoed into markup that a cache, a screenshot or a scanner could hold"
  - "The MAC covers `v1.<payload>`, not the payload alone: the version travels INSIDE the signed material, so a future v2 scheme cannot have its tokens replayed as v1 by editing three characters"
  - "The MAC is verified BEFORE the payload is parsed, and the parsed payload is STILL shape-checked afterwards — a token we signed can be malformed if a future caller passes the wrong thing, and the failure would be a silent `forTenant('')` rather than a loud one"
  - "`verifyUnsubscribeToken` FAILS CLOSED on a short secret (returns null for everything) while `mintUnsubscribeToken` THROWS on one. A weak key must make every token invalid, never every token valid — and minting under one is a caller about to put a forgeable link in a customer's inbox"
  - "No expiry, deliberately: the Spam Act requires the facility to work for at least 30 days after a send, nothing bounds when a human may click a link in an email they kept, and the operation behind it is one-way and idempotent — an expiry could only ever break a right somebody still holds"
  - "A POST that verifies is answered identically to one that does not, INCLUDING when the suppression itself throws. A forged click is told it worked; the alternative discloses, and what is (not) being done is the one thing this system is always allowed to do"
  - "The sender REFUSES rather than degrades on a missing APP_BASE_URL or signing secret, before it even asks the database: a relative or localhost unsubscribe link in a real inbox is a Spam Act breach that every test would pass"
  - "`owner_only_sender` is its own refusal reason rather than `email_not_configured` — that row IS configured, and what is wrong with it is a specific fixable mistake an operator needs told by name"
  - "`business_name` is stripped of control and quoting characters but never of words before it enters the From header: the newline is the injection, and deleting text an operator typed would break the sender identification the Spam Act requires"
  - "`resolveEmailIdentity` lives in routing-sender.ts, not in the sender: senders in this codebase read no configuration and open no connection, because dispatch invokes them outside its claim transaction precisely so no pooled connection is held across a provider's HTTP call"
  - "A per-tenant email row with `enabled = false` returns null rather than falling back to the global identity — the same reading `resolveSmsFrom` gives it, and without it 'turn this client's email off' would mean turning all fifteen off"
  - "MSG-02 stays Pending. D-02 defines it as the email pipe PROVEN by a real send, and no client domain is verified yet — the code is complete and the proof is one command away, which is not the same thing as done"

patterns-established:
  - "The pure/remote split now has a third instance (unsubscribe / unsubscribe-suppression), and the remote half's job is always the same: prove the write lands in the exact spelling the production probe asks about, by driving the production probe"
  - "A rule two callers must never disagree about is exported as a predicate (`isOwnerOnlySender`) rather than written twice — the same shape as `domainOfAddress` and `delegateFor`"
  - "An ops proof script refuses more often than it runs, and each refusal names the screen that fixes it"

requirements-completed: []

coverage:
  - id: D46
    description: "mint/verify round-trips the (tenantId, cadenceId) subject, and refuses a foreign secret, a payload edit, a single-byte tamper anywhere, a wrong-length MAC, a version-stripped MAC, nine malformed shapes and seven correctly-signed-but-unusable payloads — always by returning null, never by throwing"
    requirement: "MSG-03"
    verification:
      - kind: unit
        ref: "tests/unsubscribe.test.ts#verify refuses everything that is not a token we minted (8 blocks incl. two it.each matrices)"
        status: pass
      - kind: unit
        ref: "tests/unsubscribe.test.ts#FAILS CLOSED on a secret too short to be a signing key"
        status: pass
    human_judgment: false
  - id: D47
    description: "The GET confirmation page cannot vary by token (the handler takes no request), never echoes the token into markup, and writes nothing — a mail scanner prefetching the link is harmless"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/unsubscribe.test.ts#CANNOT vary by token — the handler takes no request at all"
        status: pass
      - kind: unit
        ref: "tests/unsubscribe.test.ts#SUPPRESSES NOTHING — a mail scanner prefetching the link must be harmless"
        status: pass
    human_judgment: false
  - id: D48
    description: "Six different POST outcomes — valid, replayed, no-such-cadence, forged, malformed and absent — return a byte-identical 200 with identical headers, and so does a suppression that throws (T-4-20)"
    requirement: "MSG-03"
    verification:
      - kind: unit
        ref: "tests/unsubscribe.test.ts#THE ORACLE ASSERTION: every outcome returns the identical body (T-4-20)"
        status: pass
      - kind: unit
        ref: "tests/unsubscribe.test.ts#answers 200 even when the suppression itself throws"
        status: pass
      - kind: integration
        ref: "tests/unsubscribe-suppression.test.ts#is idempotent on a replay, and indistinguishable from a forgery (T-4-20)"
        status: pass
    human_judgment: false
  - id: D49
    description: "One real POST against the hosted database suppresses BOTH snapshot channels verbatim with source email_unsubscribe, stops the cadence as contact_suppressed, and skips all three touches"
    requirement: "MSG-03"
    verification:
      - kind: integration
        ref: "tests/unsubscribe-suppression.test.ts#suppresses BOTH channels verbatim and stops the cadence on one click"
        status: pass
    human_judgment: false
  - id: D50
    description: "A real dispatch tick refuses a live APPROVED email touch for the unsubscribed address — the suppression was written in the exact spelling dispatch probes with, on the email channel (MSG-03 'immediate at the send gate')"
    requirement: "MSG-03"
    verification:
      - kind: integration
        ref: "tests/unsubscribe-suppression.test.ts#makes dispatch refuse a live approved EMAIL touch for the unsubscribed address"
        status: pass
    human_judgment: false
  - id: D51
    description: "Every outbound email carries List-Unsubscribe and List-Unsubscribe-Post one-click headers plus a footer that names the client business, says 'on behalf of', shows the reply address and links the SAME URL as the header; the header's token verifies back to that request's tenant and cadence"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/resend-sender.test.ts#carries the RFC 8058 one-click headers, spelled exactly"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#THE TOKEN NAMES THIS REQUEST — not some other conversation"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#puts the SAME link in the visible footer as in the header"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#identifies BOTH senders in the footer (Spam Act)"
        status: pass
    human_judgment: false
  - id: D52
    description: "Email sends From the service subdomain identifying the business, with Reply-To the tradie's own address (D-01), and a business name cannot inject a mail header"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/resend-sender.test.ts#sends AS the business, THROUGH Quote Recovery, from the verified address"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#replies to the TRADIE, never to us (D-01)"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#REFUSES to let a business name inject a header"
        status: pass
    human_judgment: false
  - id: D53
    description: "ResendSender maps a message id, an SDK error, an id-less response and a thrown SDK call onto the SendOutcome union without throwing, carrying error NAMES only and never the provider's prose"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/resend-sender.test.ts#ResendSender — the outcome union (5 blocks)"
        status: pass
    human_judgment: false
  - id: D54
    description: "Nine refusals never reach the provider: an empty or whitespace body, six unusable identities, a missing base URL and an unusable signing secret — plus the owner-only resend.dev sender under its own reason"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/resend-sender.test.ts#ResendSender — the refusals that never reach the provider (6 blocks incl. two it.each matrices)"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#isOwnerOnlySender recognises %s (5 rows)"
        status: pass
    human_judgment: false
  - id: D55
    description: "With no enabled email row, buildRoutingSender's email delegate is 'stub' — production cannot email anybody by being deployed; with one, it is 'resend', and the per-tenant identity resolves from the row else the tenant name"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/resend-sender.test.ts#chooseEmailSender — the D-04 activation gate for email (7 rows)"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#leaves the email delegate on the stub while no email config row exists"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#resolveEmailIdentity — per-tenant identity, resolved outside the sender (5 rows)"
        status: pass
      - kind: integration
        ref: "messaging_config verified to hold ZERO rows on the hosted database after the full remote run"
        status: pass
    human_judgment: false
  - id: D56
    description: "scripts/verify-email-pipe.mjs refuses with a clear message and a non-zero exit when no usable email identity exists for the tenant"
    requirement: "MSG-02"
    verification:
      - kind: command
        ref: "node scripts/verify-email-pipe.mjs --tenant 00000000-… --to nobody@example.test → exit 1, 'no usable email identity for this tenant…'"
        status: pass
    human_judgment: false
  - id: D57
    description: "A real email leaves through the actual TouchSender path, arrives, and its footer and one-click unsubscribe work in a real mail client (D-02, the definition of MSG-02)"
    requirement: "MSG-02"
    verification:
      - kind: command
        ref: "npm run verify:email-pipe -- --tenant <id> --to <address>"
        status: deferred
    human_judgment: true
    rationale: "Blocked on facts outside this repository, not on code. No client domain is verified at Resend, so `resolveEmailIdentity` returns null for every tenant and the script refuses (correctly) at its first assertion; the only currently-deliverable sender is `onboarding@resend.dev`, which reaches the account owner alone and which both the sender and the script deliberately refuse for customer mail. Making it run would require writing an ENABLED `messaging_config` email row to a database shared with production — the D-04 switch that arms email for every client. The remainder is one command the day a domain verifies (04-07)."

duration: 30min
completed: 2026-08-29
status: complete
---

# Phase 4 Plan 05: The Email Pipe and Its Unsubscribe Summary

**A compliant follow-up email can now be built, signed, sent and unsubscribed from end to end in code: RFC 8058 one-click headers whose token verifies back to exactly one cadence, a Spam Act footer naming both the tradie and the service, a public endpoint that suppresses both channels irreversibly and answers every request with the same bytes so it cannot be asked who is being chased — and a single command that proves it live the day a domain verifies.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-29T05:08:13Z
- **Completed:** 2026-08-29T05:38:00Z
- **Tasks:** 2
- **Files modified:** 10 (7 created, 3 modified)
- **Pure suite:** 1149 tests green on a bare `npm test`; 28 integration files refusing, which is the WR-09 guard and one more than before this plan (the new remote suite)
- **Full remote suite:** 68 files, 1487 tests green against the hosted Sydney database; production crons paused and re-armed cleanly
- **`npm run build`:** green, `/api/unsubscribe` listed as a dynamic route
- **`npm run lint` / `npx tsc --noEmit`:** both clean

## Accomplishments

- **The unsubscribe endpoint cannot be asked a question.** Six materially different POST outcomes — a real suppression, a replay of one, a token naming no cadence, a forgery, a malformed string and no token at all — return a byte-identical 200 with identical headers, and so does a request whose database write throws. That is asserted with `toBe` rather than by status code, because the thing being defended is a customer list: anyone probing tokens against a body that varied would be sorting guesses into "being chased by a client of this service" and "not".
- **The GET page cannot vary by token, as a fact about the signature.** The handler takes no request argument, so there is no input it could branch on; the form carries no `action`, so the browser posts back to the URL the token already arrived in and the token never enters the markup. `expect(GET.length).toBe(0)` is what stops a later edit quietly reintroducing the parameter — and `GET` writes nothing at all, because corporate mail scanners follow every link in an inbound email and a suppressing GET would opt people out of conversations they wanted.
- **The suppression is proven in the spelling that suppresses.** `tests/unsubscribe-suppression.test.ts` does not assert "rows were written" and stop. It clicks, then seeds a second live cadence for the same human with an APPROVED EMAIL touch, then drives a real `dispatchDueTouches` and requires `refusals.suppressed` to be non-zero. That number can only be non-zero if the click stored the email address byte-identically to the cadence snapshot dispatch probes with — the one failure mode where every other assertion in the file still passes and the customer keeps being emailed.
- **Both channels, from an email click.** A human who clicks unsubscribe in an email is suppressed on SMS too, verbatim, through the same `controls.ts` transaction `killContact` and the texted STOP use. Honouring "stop emailing me" while continuing to text them is a loophole, not compliance — and the only thing that distinguishes this write from the other two is `source = 'email_unsubscribe'`, which is evidence rather than behaviour.
- **The sender refuses rather than degrades, nine ways.** Empty body, no config row, no from-address, no reply-to, no business name, a from-address that is not an address, a reply-to that is not an address, no `APP_BASE_URL`, an unusable signing secret — plus `owner_only_sender` for `resend.dev` under its own name. Each is asserted to make NO provider call, because in every one of those states the email that would have gone out is one a tradie would have to apologise for.
- **A business name cannot inject a mail header.** `business_name` is typed by an operator on `/settings/email` and lands in a `From` header. Control characters are collapsed and quoting characters removed, so `Evil\r\nBcc: everyone@…` becomes a strange-looking display name on one line rather than an extra header. Words are never deleted: the injection is the newline, and stripping text a human typed would break the sender identification the header exists to provide.
- **Production still cannot email anybody.** `messaging_config` holds zero rows, verified directly against the hosted database after the full remote run. Both delegates are `StubSender`, `chooseEmailSender` refuses on any of five independent grounds, and activation remains a row an operator writes on a screen — no deploy, and no code in this plan can reach a customer until they do.

## Task Commits

1. **Task 1 (RED): failing unsubscribe token + endpoint suites** — `d9caf34` (test)
2. **Deviation: the lint gate** — `5b579ee` (chore)
3. **Task 1 (GREEN): unsubscribe token + public endpoint** — `445afe4` (feat)
4. **Task 2 (RED): failing ResendSender + activation-gate suite** — `d0c49ec` (test)
5. **Task 2 (GREEN): ResendSender, routing wire, verify-email-pipe** — `d197a5f` (feat)

_Both tasks carried `tdd="true"` and both kept the two-commit shape._

## Files Created/Modified

**Created**

- `src/core/messaging/unsubscribe-token.ts` — mint/verify/`unsubscribeUrl`. Version inside the signed material, base64url, a 512-character cap on what an unauthenticated request can make us hash, and a fail-closed guard on a weak secret.
- `src/app/api/unsubscribe/route.ts` — `GET` (a constant page, no request argument) and `POST` (query token first, form body second, one answer). Reads `UNSUBSCRIBE_SIGNING_SECRET` and none of the other four bearers.
- `src/core/messaging/resend-sender.ts` — `ResendSender`, the pure `buildEmailMessage`, `displayName`/`escapeHtml`, `isOwnerOnlySender`, and `chooseEmailSender`.
- `scripts/verify-email-pipe.mjs` — five assertions, four of which are refusals; `npm run verify:email-pipe`.
- `tests/unsubscribe.test.ts` — 48 pure assertions.
- `tests/unsubscribe-suppression.test.ts` — 3 remote assertions, including the dispatch gate chain.
- `tests/resend-sender.test.ts` — 47 pure assertions.

**Modified**

- `src/core/messaging/routing-sender.ts` — `resolveEmailIdentity` (the only piece that reads `messaging_config` and `tenants`), the email delegate behind `chooseEmailSender`, and both global rows now read in one `Promise.all`.
- `package.json` — one script line. `resend` stays pinned at `6.22.1`; no package was installed.
- `tests/inbox-authorization.test.ts` — the unused-parameter fix that restored `npm run lint`.

## Decisions Made

See `key-decisions` in the frontmatter. The three worth reading twice:

1. **A handler that takes no input cannot leak through its output.** The GET page had to be identical for every token. The obvious implementation reads the token, renders a hidden input, and is then defended by a test comparing two rendered bodies — which passes right up until somebody adds a "we could not find that link" branch. Removing the parameter makes the property structural: there is nothing to branch on, the token stays in the query string because the form has no `action`, and the assertion that survives is about the function's arity rather than about two strings that happened to match on the day it was written.

2. **Refuse rather than degrade, and refuse before asking the database.** `APP_BASE_URL` is optional in `env.ts` with a documented fallback chain that ends at `localhost` — correct for the operator-alert link it was added for, and catastrophic here, because this value builds a link that goes into a customer's inbox and a broken opt-out is the Spam Act breach itself. The sender checks the base URL and the signing secret *before* it resolves the identity: neither is per-tenant, so a deployment missing either can never send a compliant email for anybody, and there is nothing to be learned by asking the database first.

3. **MSG-02 is still not ticked.** The pipe is built, tested and provable. D-02 defines MSG-02 as the email pipe proven by a real send through the actual `TouchSender` path, and no client domain is verified at Resend — so the script that exists to make that proof correctly refuses at its first assertion, and the only currently-deliverable sender is one this plan deliberately forbids for customer mail. `REQUIREMENTS.md` is unchanged, exactly as 04-06 left it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm run lint` was red before this plan started**
- **Found during:** Task 1 verification
- **Issue:** `tests/inbox-authorization.test.ts` (04-06) declared `_id` on a mock body that never read it. `npm run lint` runs with `--max-warnings=0`, so that single warning failed the whole lint gate — and while it failed, no later plan could distinguish its own lint errors from the inherited one.
- **Fix:** The signature moved onto `vi.fn<(id: string) => …>()` so the call site still typechecks and the id stays asserted through `toHaveBeenCalledWith`. First attempt (deleting the parameter outright) broke `tsc`; caught and corrected before commit.
- **Verification:** `npm run lint` clean, `npx tsc --noEmit` clean, that suite's 19 tests still green.
- **Committed in:** `5b579ee`

**2. [Rule 2 - Missing Critical] The signing secret is a constructor argument the plan's option list omits**
- **Found during:** Task 2
- **Issue:** The plan specifies `ResendSender({ apiKey, appBaseUrl, resolveEmailConfig, client? })`. Minting the unsubscribe token needs `UNSUBSCRIBE_SIGNING_SECRET`, and with no way in, the sender would have had to read `getServerEnv()` itself — which makes it undrivable by a unit test with no environment and re-couples a file whose whole discipline is that it reads no configuration.
- **Fix:** `signingSecret` joins the options, injected by `buildRoutingSender` exactly as the api key is, and is one of the five conditions `chooseEmailSender` gates on.
- **Committed in:** `d197a5f`

**3. [Rule 2 - Missing Critical] A business name could inject a mail header**
- **Found during:** Task 2
- **Issue:** The plan's `from` format interpolates `business_name` into a `From` header. That field is free text an operator pastes into a form. A CR or LF in a header value starts a new header (`Bcc:` being the obvious one), and `"`, `<` or `>` terminate the display name so the address beside it can be rewritten. Nothing in the plan or in 04-06's action sanitizes it.
- **Fix:** `displayName()` — control characters collapsed to a space, quoting characters removed, whitespace normalized, capped at 78. Words are deliberately preserved: the injection is the newline, and deleting an operator's text would break the identification the header exists to provide.
- **Verification:** `tests/resend-sender.test.ts#REFUSES to let a business name inject a header`, asserting no line break, exactly two quotes, and no angle bracket inside the display name.
- **Committed in:** `d197a5f`

**4. [Rule 2 - Missing Critical] The owner-only `resend.dev` refusal belongs in the SENDER, not only in the script**
- **Found during:** Task 2
- **Issue:** The plan puts the `resend.dev` check in `scripts/verify-email-pipe.mjs` alone. But the prohibition is about what a CUSTOMER receives, and the script is not what sends to customers — a `messaging_config` row saved with an onboarding-sender address would produce follow-ups that silently reach nobody, with a green ledger row for each.
- **Fix:** `isOwnerOnlySender()` is exported and asked by both, with its own outcome reason (`owner_only_sender`, not `email_not_configured`) so an operator is told the specific fixable thing. Subdomains match, because `mail.resend.dev` is no more deliverable than the apex.
- **Committed in:** `d197a5f`

**5. [Rule 2 - Missing Critical] An id-less success response is a failure, not a send**
- **Found during:** Task 2
- **Issue:** The plan's mapping is "SDK error → failed; `data.id` → sent". It says nothing about `{ data: null, error: null }`, which the installed types permit. Treating it as sent would write a delivered-looking row into the ledger Phase 7 computes recovered revenue from.
- **Fix:** `no_id_in_response`, retryable — the same distinction `clicksend-client.ts` draws with `no_message_in_response`.
- **Committed in:** `d197a5f`

### Structural deviations

**6. The plan's single `tests/unsubscribe.test.ts` was split into a pure suite and a remote one**
- The plan's verify block runs `npm test -- tests/unsubscribe.test.ts && npm run test:remote -- tests/unsubscribe.test.ts` on ONE file containing both halves. Those conflict: `tests/helpers/seed.ts` reads hosted credentials at module scope, so WR-09 refuses the whole file on a bare `npm test` and the pure assertions become unrunnable. `tests/unsubscribe-suppression.test.ts` holds the three remote assertions. Exactly the split 04-02 and 04-03 each made, for the same reason, and each file's header names the other.

**7. `unsubscribeUrl` and `UNSUBSCRIBE_PATH` are exported from the token module, which the plan's artifact list does not mention**
- The header link, the footer link and the route must be the same string. Two spellings is a footer link that 404s while the header one works — and the footer link is the one a human clicks. Same argument as `domainOfAddress` in 04-06.

**8. `buildEmailMessage` is exported as a pure function**
- The plan describes `send()` building the message inline. Exporting the builder is what lets `scripts/verify-email-pipe.mjs` print the EXACT headers a real send will carry (rather than a script's re-derivation of them, which would prove only that the script agrees with itself) and what lets the four compliance obligations be asserted without a provider.

**9. `resolveEmailIdentity` is exported from `routing-sender.ts` rather than being an anonymous closure**
- The plan says "resolve the tenant name inside the resolver, not the sender", which is what this does. Naming and exporting it means its three refusals (disabled row, missing reply-to, no name anywhere) are testable directly, and the script injects the SAME resolver the tick does rather than a copy.

### Process deviation

**10. Neither TDD RED was observed as an assertion-level failure**
- Both REDs were module-resolution failures: each suite is the first consumer of a module that did not yet exist. Same limitation 04-01, 04-02 and 04-03 recorded. Recorded rather than dressed up — a red that says "cannot find module" proves the test runs and the subject is absent, which is weaker than a red that proves the test discriminates.
- One assertion DID discriminate at the assertion level, in the other direction: the first run of the header-injection test failed on `not.toContain('Bcc:')`, which was the TEST being wrong (the string is harmless inside a quoted display name on one line; the newline is the injection). The assertion was corrected to pin the actual property — no line break, exactly two quotes, no angle bracket in the display name — rather than the code being changed to satisfy a wrong test.

---

**Total deviations:** 5 auto-fixed (1 blocking, 4 missing-critical), 4 structural, 1 process.
**Impact on plan:** No scope creep. Deviations 3 and 4 are the two that would have shipped something wrong — a `From` header an operator's typo could split in two, and a sender identity that produces follow-ups reaching nobody with a green ledger row for each.

## Issues Encountered

- **The D-02 live send could not be executed, and this is the honest state, not a skipped step.** No client domain is verified at Resend, so `messaging_config` has no usable email row, so `resolveEmailIdentity` returns null for every tenant and `scripts/verify-email-pipe.mjs` refuses at its first assertion — which was verified live (exit 1, with the message naming `/settings/email`). The only currently-deliverable sender is `onboarding@resend.dev`, which Resend delivers to the account owner alone and which both the sender and the script deliberately refuse for customer mail. Making the send run would mean writing an ENABLED email row to a database shared with production: by D-04's own design, the switch that arms email for every client. Recorded as coverage `D57`, deferred to 04-07.
- **The script's `resend.dev` refusal is proven through its predicate, not by running the script.** Reaching that branch live requires an enabled row (the activation switch again), and `resolveEmailIdentity` refuses on `enabled` first. So `isOwnerOnlySender` is exported and asserted directly over five address shapes, and both the sender and the script ask it rather than spelling the rule twice.
- **`npm test` (pure) now reports 28 refusing integration files, up from 27** — the WR-09 guard working on the one new remote suite, not a regression.
- **The cross-session `0025` journal collision is unchanged.** This plan generated no migration.
- **The plan's flagged assumption is untouched.** Whether a send to a `pending` domain surfaces as a named `failed` outcome rather than a silent drop still cannot be observed from here; the script prints the exact reason when it happens, and its error text tells the operator to record it against the assumption.

## User Setup Required

**Nothing new, and no new environment variable.** `UNSUBSCRIBE_SIGNING_SECRET`, `APP_BASE_URL` and `RESEND_API_KEY` are all already set locally and in Vercel Production.

**One thing to check before the first real email**, because it is the failure this plan can least afford: `APP_BASE_URL` must be set EXPLICITLY in Vercel Production. `env.ts` marks it optional with a fallback chain that ends at `localhost`, which is fine for an operator alert link and is a broken opt-out — a Spam Act problem — in a customer's inbox. `buildRoutingSender` refuses to build the email sender at all without it, so the failure mode is "no email goes out" rather than "a broken link goes out", but the right state is that it is set.

**To turn email on, in order (04-07):**
1. Verify a sending domain at `/settings/email` and paste the DNS records (04-06's flow).
2. Save an email identity with **Send email** ticked: the client, a from-address on the verified domain, the tradie's own address as reply-to, and their business name.
3. `npm run verify:email-pipe -- --tenant <id> --to <your address>` and read the inbox.

Step 2 alone arms email for that client on the next tick, with no deploy. Step 3 is the D-02 proof and is read-only apart from the one email it sends.

## Next Phase Readiness

**Ready for 04-07 (activation and the live proof):**
- The proof is one command, and it refuses safely four ways before it sends anything.
- The flagged assumption about a `pending` domain resolves the first time the script is run against a half-verified one; its failure message asks for exactly that.
- Nothing in this plan can send until an operator writes a row — verified, not asserted: `messaging_config` holds zero rows on the hosted database after the full remote run, and all five production cron jobs are `active`.

**Ready for Phase 5 (email touch templates):**
- `buildEmailMessage` wraps whatever `request.body` dispatch hands it and asserts the body travels verbatim into the text part, so an approved draft cannot be truncated or rewritten on its way out.
- The subject is fixed and neutral (`Quote follow-up from «business»`) precisely because copy authorship is ONB-03's; Phase 5 changes who fills the body in, not what this file does with it.
- Email cadences are now possible end to end: materialization already picks the channel a contact can be reached on (03-03), dispatch already probes suppression per channel, and the email delegate is real.

**Carried blockers unchanged:** the IPND business-address dependency still blocks the AU dedicated number, the ServiceM8 partner App ID/Secret is still unconfirmed, and the cross-session `0025` journal collision still needs a human at merge time.

---
*Phase: 04-messaging-gateway*
*Completed: 2026-08-29*

## Self-Check: PASSED

All 7 created artifacts and the SUMMARY exist on disk; all 5 commits
(`d9caf34`, `5b579ee`, `445afe4`, `d0c49ec`, `d197a5f`) are present in git
history. `messaging_config` verified to hold zero rows on the hosted database
after the full remote run, all five production cron jobs verified `active`, and
no proof-suite suppression row survived teardown.
