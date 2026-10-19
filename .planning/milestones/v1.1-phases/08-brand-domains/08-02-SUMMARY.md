---
phase: 08-brand-domains
plan: 02
subsystem: messaging
tags: [brand, spam-act, sender-identity, resend, clicksend, alerts, grep-as-test]

requires:
  - phase: 08-brand-domains
    provides: "src/core/brand.ts — identityLine, viaDisplayName, PROVIDER_SOURCE_TAG, DEFAULT_ALERT_FROM (Plan 08-01)"
  - phase: 04-messaging
    provides: "buildEmailMessage, the displayName() header-injection sanitiser, the byte-identical unsubscribe route, the ClickSend client"
provides:
  - "Every cadence email's From display name and identity line built through @/core/brand — one spelling, one home"
  - "The unsubscribe confirm/done footer built at module scope from identityLine with a constant argument — byte-identity and the no-oracle property preserved"
  - "One DEFAULT_ALERT_FROM for both alert senders; the OPERATOR_ALERT_FROM override path byte-unchanged"
  - "ClickSend wire-level source tag = 'backdesk' from PROVIDER_SOURCE_TAG"
  - "tests/brand.test.ts: BRAND-03 rendered-surface assertions (ordering, adjacency, CR/LF, non-ASCII, byte-identity) + the BRAND-01 grep-as-test over src/"
affects: [08-03-alert-copy, 08-05-url-switch, 08-07-resend-domain, 09-landing-page, 10-first-client]

actuals:
  tokens: 5450
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Grep-as-test: readdirSync('src', { recursive: true }) walk asserting a forbidden literal matches no source file, comments NOT stripped, plus a companion assertion that the walk never leaves src/"
    - "Sanitise-then-brand: the header-injection control runs before the brand builder, and both live where their own test can see them"

key-files:
  created: []
  modified:
    - src/core/messaging/resend-sender.ts
    - src/app/api/unsubscribe/route.ts
    - src/core/messaging/clicksend-client.ts
    - src/core/alerts/operator-email.ts
    - src/core/alerts/stalled-drafts.ts
    - "src/app/(console)/settings/email/forms.tsx"
    - tests/brand.test.ts
    - tests/resend-sender.test.ts
    - tests/clicksend-sender.test.ts
    - scripts/verify-email-pipe.mjs
    - docs/env-vars.md

key-decisions:
  - "The quotes and angle brackets of the From header stay in resend-sender.ts, beside the displayName() sanitiser that makes them safe — brand.ts receives an already-safe string and does no escaping, so the injection pin changed only its suffix (T-8-01)"
  - "The unsubscribe footer passes a CONSTANT argument ('the business that quoted you') to identityLine, evaluated once at module scope: the page still resolves no tenant, so a real token and a forged one render the same bytes (T-8-09)"
  - "The grep-as-test does NOT strip comments, unlike tests/cron-schedules.test.ts's literal-URL scan — D-01 forbids the literal in src/ outright, and the prose in the sender's and the alert modules' header comments described the service by its old name in words a reader would believe"
  - "The walk is pinned to src/ by a second assertion (no path outside src/, and more than 20 files read), so package.json's exempt npm name is provably never opened rather than exempted by convention"
  - "The local DEFAULT_ALERT_FROM in stalled-drafts.ts carried a comment arguing it was 'imported from nowhere because it is a constant, not a decision'; D-03 inverts exactly that — the default is a brand decision with one home, so the comment went with the constant"

patterns-established:
  - "Grep-as-test over a directory walk: make a phase's acceptance grep executable in CI so the fact survives the phase that established it"
  - "Negative control on a structural test: temporarily reintroduce the forbidden literal, confirm the test fails, revert — a green structural test that reads no files is the failure mode it cannot see in itself"

requirements-completed: [BRAND-01, BRAND-03]

coverage:
  - id: D1
    description: "Cadence email From display name and identity line are built through @/core/brand; the tradie is named first, the service second"
    requirement: BRAND-03
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-03 rendered surfaces — the cadence email > sends AS the tradie, THROUGH Backdesk, in the one line every client shows"
        status: pass
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-03 rendered surfaces — the cadence email > carries the locked identity line in BOTH bodies (Spam Act, D-01)"
        status: pass
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-03 rendered surfaces — the cadence email > names the tradie FIRST — in the display name and in the subject (ordering)"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#buildEmailMessage — what a customer actually receives > sends AS the business, THROUGH Backdesk, from the verified address"
        status: pass
    human_judgment: false
  - id: D2
    description: "The BRAND-03 probe edges hold: adjacency (a business named after the service), encoding (CR/LF and quoting characters stripped before branding; non-ASCII preserved), emptiness (builders total)"
    requirement: BRAND-03
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-03 rendered surfaces — the cadence email > stays unambiguous when the trading name CONTAINS the service name (adjacency)"
        status: pass
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-03 rendered surfaces — the cadence email > SANITISES BEFORE IT BRANDS — CR/LF and quoting characters never reach the header (T-8-01)"
        status: pass
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-03 rendered surfaces — the cadence email > leaves a non-ASCII trading name intact (encoding)"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#buildEmailMessage — the injected display name (unchanged prefix, Backdesk suffix)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The unsubscribe confirm/done pages carry the generic Backdesk identity line and stay byte-identical; the RFC 8058 one-click headers are untouched"
    requirement: BRAND-03
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-03 rendered surfaces — the unsubscribe page (2 tests)"
        status: pass
      - kind: unit
        ref: "tests/unsubscribe.test.ts#THE ORACLE ASSERTION: every outcome returns the identical body (T-4-20)"
        status: pass
      - kind: unit
        ref: "tests/resend-sender.test.ts#carries the RFC 8058 one-click headers, spelled exactly"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both alert senders read one DEFAULT_ALERT_FROM from the brand module; OPERATOR_ALERT_FROM still overrides with no code change"
    requirement: BRAND-01
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#brand constants > defaults alerts to Resend pre-verification sender under the new name (D-03)"
        status: pass
      - kind: other
        ref: "grep -c 'env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM' src/core/alerts/{operator-email,stalled-drafts}.ts → 1, 1; grep -c '^const DEFAULT_ALERT_FROM' → 0, 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "The ClickSend wire-level source tag is 'backdesk', read from PROVIDER_SOURCE_TAG"
    requirement: BRAND-01
    verification:
      - kind: unit
        ref: "tests/clicksend-sender.test.ts#message.source === 'backdesk'"
        status: pass
    human_judgment: false
  - id: D6
    description: "BRAND-01's acceptance criterion is executable: no file under src/ names the legacy service, comments included, enforced on every CI run"
    requirement: BRAND-01
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#BRAND-01 acceptance: the grep, as a test (D-10) (2 tests)"
        status: pass
      - kind: other
        ref: "grep -rli 'quote[- ]recovery' src | wc -l → 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "The proof body that lands in a real inbox, the env-contract examples and the from-address placeholder all say Backdesk / followups@"
    requirement: BRAND-01
    verification:
      - kind: other
        ref: "grep -c 'This is a Backdesk pipeline test, not a real follow-up.' scripts/verify-email-pipe.mjs → 1; docs/env-vars.md OPERATOR_ALERT_FROM + APP_BASE_URL examples → 1, 1; forms.tsx followups@ → 1"
        status: pass
      - kind: unit
        ref: "tests/email-settings-action.test.ts, tests/resend-domains.test.ts (89 tests green)"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-09-06
status: complete
---

# Phase 8 Plan 02: Messaging Brand Fan-Out Summary

**Every Spam Act sender identification a customer reads — the From display name, the body identity line, the unsubscribe footer — is now built by one builder in `src/core/brand.ts`, and BRAND-01's repo-wide grep is a test that runs on every CI run instead of a check somebody remembered to do once.**

## Performance

- **Duration:** 9 min
- **Tasks:** 3 (one TDD)
- **Commits:** 4
- **Files changed:** 11 (212 insertions, 48 deletions)

## Accomplishments

- **Task 1 (TDD).** RED: the three `tests/resend-sender.test.ts` pins moved to `via Backdesk` (the injection pin's stripped prefix byte-identical), and eight new BRAND-03 rendered-surface assertions were added to `tests/brand.test.ts` — 7 failing, 21 passing. GREEN: `buildEmailMessage` now calls `identityLine(business)` for the html and text footer and `viaDisplayName(business)` inside the quoted From; `src/app/api/unsubscribe/route.ts` builds its footer from `identityLine('the business that quoted you')`. 122 tests green across the three suites.
- **Task 2.** `clicksend-client.ts` sets `const SOURCE = PROVIDER_SOURCE_TAG`; the duplicated `DEFAULT_ALERT_FROM` literal is deleted from both alert modules, which now import the one brand default. The `env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM` expression and its silent try/catch are byte-unchanged in both files.
- **Task 3.** `tests/brand.test.ts` gained the grep-as-test: a `readdirSync('src', { recursive: true })` walk over `.ts/.tsx/.css/.mjs` asserting zero matches for `/quote[- ]recovery/i`, plus a companion assertion that no path leaves `src/` and that the walk read more than 20 files. `scripts/verify-email-pipe.mjs`, `docs/env-vars.md` and the email-settings from-address placeholder updated.

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run tests/brand.test.ts tests/resend-sender.test.ts tests/unsubscribe.test.ts tests/clicksend-sender.test.ts tests/email-settings-action.test.ts tests/resend-domains.test.ts` | 6 files, **207 tests passed** |
| `grep -rli 'quote[- ]recovery' src \| wc -l` | **0** (the D-10 acceptance criterion) |
| `npm run typecheck` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm test` (whole local suite) | 75 pure suites pass, **2467 tests passed, 0 test failures**; 39 DB-backed suites refuse to start locally by design (`tests/helpers/env.ts:142` guard — the hosted project is production) |
| `node --check scripts/verify-email-pipe.mjs` | parses |

**Negative control on the grep-as-test.** A green structural test that reads no files is indistinguishable from a green one that reads all of them, so the assertion was proven non-vacuous: appending `// negative control: quote-recovery` to `src/core/brand.ts` made both the walk test and the brand-module test fail with `expected [ 'src/core/brand.ts' ] to deeply equal []`; the line was reverted with `git checkout --` and the suite returned to 30 passing.

**DB-backed suites, verified structurally by hand** (they cannot run locally): `tests/unsubscribe-suppression.test.ts`, `tests/inbound-stop.test.ts`, `tests/convert-prospect.test.ts` and `tests/cron-schedules.test.ts` were grepped for every literal this plan moved. None pins a brand string, a From header, an identity line or the alert-from default. The only `source` fields they assert are the suppression-source enum values `email_unsubscribe` and `sms_stop`, which are unrelated to the ClickSend `SOURCE` tag this plan re-pointed. The phase gate for them remains CI on the next push to `main`.

## Deviations from Plan

None — the plan executed as written, with one documented best-effort skip (below).

## Operator Obligations

- **`.env.example` was NOT mirrored.** This workspace has a permission deny rule covering `.env*` (recorded at `docs/env-vars.md:6-10`), and the file additionally carries a pre-existing uncommitted modification from another workstream, so it was neither read nor written. The two example lines to mirror by hand, matching `docs/env-vars.md` exactly:
  ```bash
  # OPERATOR_ALERT_FROM=Backdesk <alerts@quotes.backdesk.com.au>
  # APP_BASE_URL=https://app.backdesk.com.au
  ```
  `docs/env-vars.md` is the mandatory mirror and is updated and committed.

## Known Stubs

None. No stub, placeholder, TODO or skipped test was introduced.

## Notes for Future Phases

- **`package.json` still reads `"name": "quote-recovery"`** — the BRAND-01 carve-out, deliberately left, and the grep-as-test provably never opens the file. Renaming it is a separate decision (it changes the npm identity and every `npm run` banner line), not a leak.
- **One legacy string survives outside `src/`:** `tests/inbound-threading.test.ts:120` builds fixture addresses at `@quote-recovery-test.invalid`. It is a fake RFC 2606 domain in a test fixture, invisible to any customer and outside D-10's `src/` scope. Left as is; a future rename is cosmetic.
- **The alert-from address is still `onboarding@resend.dev`** — only the display name changed (D-03, T-8-12). It becomes `alerts@quotes.backdesk.com.au` in Plan 08-07, after the domain verifies, with no code change: `OPERATOR_ALERT_FROM` is already in the env schema and the pick-list.
- **The from-address placeholder now suggests `followups@`**, matching the cadence convention in `docs/vercel-domains-and-protection.md` §4 — worth keeping in mind when 08-07 creates the first service-owned identity.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change was introduced; every mitigation in the plan's threat register (T-8-01, T-8-08, T-8-09, T-8-12) is asserted by a passing test listed above.

## Self-Check: PASSED

All 11 modified files and the SUMMARY exist on disk; all four task commits (`ec4dd40`, `a56bdbc`, `0a476b9`, `f1757e8`) are present in `git log`.
