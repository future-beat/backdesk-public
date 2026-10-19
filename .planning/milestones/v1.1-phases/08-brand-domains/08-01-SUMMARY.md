---
phase: 08-brand-domains
plan: 01
subsystem: infra
tags: [brand, rebrand, nextjs, constants-module, dns, resend, vercel]

requires:
  - phase: 02-console-foundation
    provides: "The console shell, root metadata and login page whose name literals this plan replaces"
  - phase: 05-audit
    provides: "src/core/audit/constants.ts + tests/audit-aggregate.test.ts — the import-free-module-pinned-by-a-structural-test analog copied here"
provides:
  - "src/core/brand.ts — the single place the service names itself (nine exports: name, three domains, provider tag, alert-from default, console description, two identity builders)"
  - "tests/brand.test.ts — structural pin (export list, import-freedom, no sanitiser, no legacy literal) plus builder and console-surface assertions"
  - "The console half of the BRAND-01 fan-out: login h1, root title default/template, meta description, console nav wordmark, both A4 print footers"
  - "docs/vercel-domains-and-protection.md — the DOM-01/02/03 record-shape reference with explicit fill markers for the live plans"
  - ".planning/phases/08-brand-domains/COVERAGE.md — the API-coverage declaration for the seal-time detector"
affects: [08-02-messaging-brand, 08-04-domain-attach, 08-05-url-switch, 08-06-rename-protection, 08-07-resend-domain, 09-landing-page]

actuals:
  tokens: 6200
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Import-free product-fact module pinned by a readFileSync structural test (second instance, after src/core/audit/constants.ts)"
    - "Brand strings imported from @/core/brand by every rendered surface; no service-name literal in src/app"

key-files:
  created:
    - src/core/brand.ts
    - tests/brand.test.ts
    - docs/vercel-domains-and-protection.md
    - .planning/phases/08-brand-domains/COVERAGE.md
  modified:
    - src/app/login/page.tsx
    - src/app/layout.tsx
    - "src/app/(console)/layout.tsx"
    - "src/app/(console)/audits/[id]/page.tsx"
    - "src/app/(console)/reports/[client]/[reportId]/page.tsx"

key-decisions:
  - "The brand module lives at src/core/brand.ts with zero imports, asserted as a test rather than a convention — a print page, an email builder, a public route handler and an alert sender all read it, so it may never acquire a dependency any one of them cannot take (D-01)"
  - "The identity phrasings exist exactly once each: identityLine(business) and viaDisplayName(business). A second spelling anywhere is a test failure rather than a discrepancy a recipient finds (D-01, D-02)"
  - "brand.ts performs no quoting, escaping or sanitising; the From-header injection control stays with the header builder in resend-sender.ts, and the test asserts brand.ts contains no .replace( so a second untested control cannot be smuggled in (T-8-01)"
  - "The root title template ('%s · Backdesk') and the default both derive from SERVICE_NAME, so the page-sets-its-own-title path and the fallback path can never disagree on the name"
  - "DMARC is published as v=DMARC1; p=none; with the aggregate-report tag deliberately omitted — RFC 7489 §7.1 makes a published report address a commitment to process what arrives, and no mailbox exists for it yet"

patterns-established:
  - "Import-free constants module + structural test: readFileSync the source, pin the export list with /export (?:const|function) (\\w+)/g, assert not.toMatch(/^import /m)"
  - "Surface-swap assertion: for each rendered file, assert it contains \"from '@/core/brand'\" and does not match /quote[- ]recovery/i — the per-file precursor to 08-02's repo-wide grep-as-test"
  - "docs/ reference in measured-vs-documented style with explicit '_To be filled in Plan 08-0N_' markers, so a skeleton written before the live work is unambiguous about what is claim and what is evidence"

requirements-completed: []

coverage:
  - id: D1
    description: "src/core/brand.ts exists, is import-free, and exports exactly the nine pinned names"
    requirement: BRAND-01
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#brand module structure (D-01) > exports exactly the nine pinned names"
        status: pass
      - kind: unit
        ref: "tests/brand.test.ts#brand module structure (D-01) > is a module with NO imports — stated as a test, not as a convention"
        status: pass
    human_judgment: false
  - id: D2
    description: "The locked identity phrasings render correctly, are total over empty strings, and stay unambiguous when the business name contains the service name"
    requirement: BRAND-01
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#identity builders (D-01, D-02) (4 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Login page, root metadata, console nav wordmark and both A4 footers render SERVICE_NAME from the brand module with no legacy literal left"
    requirement: BRAND-01
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#console and print surfaces render the name from the module (D-01, D-04) (7 tests)"
        status: pass
      - kind: other
        ref: "grep -rli 'quote[- ]recovery' over the five modified src/app files — no matches"
        status: pass
    human_judgment: false
  - id: D4
    description: "No visual identity change: A4 layouts, audit.css, report.css and globals.css are byte-unchanged (D-04)"
    verification:
      - kind: other
        ref: "git diff --stat -- src/app/(console)/audits/audit.css src/app/(console)/reports/[client]/[reportId]/report.css src/app/globals.css — empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "The console at app.backdesk.com.au shows 'Backdesk' on a phone (the D-11 phone proof)"
    verification: []
    human_judgment: true
    rationale: "The domain does not exist yet — it is attached in Plan 08-04 and proved in 08-05. This plan can only prove the string renders from the module, not that a human opening the deployed console reads it."
  - id: D6
    description: "docs/vercel-domains-and-protection.md holds every DNS/protection record shape knowable before delegation, with explicit fill markers"
    requirement: DOM-01
    verification:
      - kind: other
        ref: "grep for feedback-smtp.ap-northeast-1.amazonses.com, 'v=spf1 include:amazonses.com ~all', 'v=DMARC1; p=none;', followups@quotes.backdesk.com.au — all present; 'rua=' and secret patterns absent"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-09-06
status: complete
---

# Phase 8 Plan 01: Brand Module & Console Fan-Out Summary

**The service now names itself in exactly one place — `src/core/brand.ts`, import-free and pinned to nine exports by a structural test — and all five console/print surfaces render from it, with the DNS/protection reference skeleton in place for the live domain plans.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 3 of 3
- **Files modified:** 9 (4 created, 5 modified)
- **Tests:** 20 in `tests/brand.test.ts` (47 with `tests/audit-aggregate.test.ts`), all passing

## Accomplishments

- **`src/core/brand.ts`** — one module, no imports, nine exports: `SERVICE_NAME`, `APEX_DOMAIN`, `CONSOLE_HOST`, `SENDING_DOMAIN`, `CONSOLE_DESCRIPTION`, `PROVIDER_SOURCE_TAG`, `DEFAULT_ALERT_FROM`, `identityLine()`, `viaDisplayName()`. Its file-level JSDoc argues the constraint the test enforces: four unrelated runtimes read this file, so a dependency here is a second spelling of the sender's identity somewhere else.
- **The swap proven end to end on the login page first** (the D-11 phone-proof surface) before any other file was touched, then fanned out to root metadata, the console nav wordmark and both A4 print footers. The two A4 pages lost their local `SERVICE_NAME` constants; their footer JSX is byte-identical.
- **`tests/brand.test.ts` (20 tests)** covers the structural pin, the locked phrasings, and four BRAND-01 probe edges: adjacency (a tradie trading as "Backdesk Plumbing" still reads as the sender), ordering (title template vs default both from `SERVICE_NAME`), empty (`identityLine('')` returns a string, never throws), and encoding (no `dangerouslySetInnerHTML` on either print page; the module itself contains no `.replace(`).
- **`docs/vercel-domains-and-protection.md`** — eight sections holding the Vercel CNAME shape, the four Resend records for `quotes.backdesk.com.au` at `ap-northeast-1`, the from-address conventions, the 308 on the post-rename default alias, and the D-07 Standard Protection answers as documented-vs-measured rows awaiting 08-06.

## Task Commits

1. **Task 1 (tracer): brand module → login page → structural test** — `bf7da2e` (feat)
2. **Task 2: fan out to root metadata, console nav and the two A4 footers** — `6d3bdf8` (feat)
3. **Task 3: COVERAGE declaration and the DOM reference skeleton** — `6e974ef` (docs)

## Files Created/Modified

- `src/core/brand.ts` (new) — the only place the service names itself; constants plus two pure identity builders, no imports, no sanitising
- `tests/brand.test.ts` (new) — structural pin + builder assertions + console-surface assertions
- `docs/vercel-domains-and-protection.md` (new) — DOM-01/02/03 reference; record shapes now, measured values from 08-04..08-07
- `.planning/phases/08-brand-domains/COVERAGE.md` (new) — one-line API-coverage declaration
- `src/app/login/page.tsx` — `<h1>{SERVICE_NAME}</h1>`
- `src/app/layout.tsx` — `title.default`/`title.template`/`description` from the module
- `src/app/(console)/layout.tsx` — nav wordmark renders `{SERVICE_NAME}`
- `src/app/(console)/audits/[id]/page.tsx`, `src/app/(console)/reports/[client]/[reportId]/page.tsx` — local constants deleted in favour of the import; layout and CSS untouched

## Decisions Made

None beyond the plan — D-01 (module shape and export list), D-02 (phrasings), D-03 (alert-from default), D-04 (no visual change) and D-10 (structural tests) were all locked in CONTEXT.md and followed as written. The one judgement inside the plan's latitude: `tests/brand.test.ts` also asserts `src/core/brand.ts` contains no `.replace(`, making T-8-01 ("no second sanitiser smuggled into the module every surface imports") a test rather than a comment.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **`tests/convert-prospect.test.ts` cannot be run in this workspace.** The plan named it as a suite that must stay green (it structurally asserts the audit page imports `AUDIT_RECOVERY_RATE` and holds no rate literal). It is an integration suite: it fails at import with "Refusing to run integration tests against a non-local Supabase stack", because `.env.local` points at the hosted Sydney project and running it would touch production data. Its two invariants were verified by hand instead: the `@/core/audit/constants` import line is intact (1 match), and the only `15%`/`0.15` occurrence in the file is inside a JSDoc comment, which that test strips before asserting. Nothing this plan changed is in its blast radius.

## Verification

- `npx vitest run tests/brand.test.ts tests/audit-aggregate.test.ts` — 47 passed
- `npm run typecheck` — clean
- `npm run lint` — clean (`--max-warnings=0`)
- `grep -rli 'quote[- ]recovery'` over the five modified `src/app` files — no matches
- `git diff --stat` over `audit.css`, `report.css`, `globals.css` — empty (D-04)

## User Setup Required

None in this plan — it changes strings and writes documentation. The DNS records this phase needs are documented in `docs/vercel-domains-and-protection.md` and are requested from the operator by Plans 08-04 and 08-07.

## Next Phase Readiness

- **08-02 (messaging/alert half) is unblocked** and is what closes BRAND-01: it imports `identityLine`, `viaDisplayName`, `PROVIDER_SOURCE_TAG` and `DEFAULT_ALERT_FROM` into `resend-sender.ts`, `clicksend-client.ts`, both alert modules and the unsubscribe route, updates the test pins, and adds the repo-wide grep-as-test over `src/`.
- **Known open surfaces for 08-02** (deliberately out of this plan's scope, all still carrying the legacy literal): `src/core/messaging/resend-sender.ts`, `src/core/messaging/clicksend-client.ts`, `src/core/alerts/operator-email.ts`, `src/core/alerts/stalled-drafts.ts`, `src/app/api/unsubscribe/route.ts`, `scripts/verify-email-pipe.mjs`, plus `tests/resend-sender.test.ts` and `tests/clicksend-sender.test.ts` pins.
- **`package.json` name stays `quote-recovery`** — per the plan's BRAND-01 adjacency ruling, the package name is never a rendered surface and the grep-as-test walks `src/` only.
- **No stubs.** Every constant in `brand.ts` is a real value; the only placeholders in this plan are the explicit `_To be filled in Plan 08-0N_` markers in the DOM reference, which are the document's contract with the live plans rather than unfinished code.

---
*Phase: 08-brand-domains*
*Completed: 2026-09-06*

## Self-Check: PASSED

All five declared artifacts exist on disk and all four commit hashes resolve in `git log`.
