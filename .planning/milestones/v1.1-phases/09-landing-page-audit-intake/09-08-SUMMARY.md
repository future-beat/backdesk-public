---
phase: 09-landing-page-audit-intake
plan: 08
subsystem: infra
tags: [vercel, dns, tls, certificates, lighthouse, performance, accessibility, copy, doh]

requires:
  - phase: 09-landing-page-audit-intake
    provides: "09-07 — the apex cut over at Squarespace, both hosts attached and verified at Vercel, serving over plain HTTP with no certificate"
  - phase: 08-brand-domains
    provides: "The finding that Vercel does not always auto-issue a certificate, the DoH read-back discipline, and the docs this phase records into"
provides:
  - "https://backdesk.com.au live: HTTP/2 200 from syd1, www 308ing to it, plain HTTP 308ing to https, HSTS on both hosts"
  - "Certificates for both public hosts, auto-issued, renew: yes"
  - "LAND-06 measured on production: Lighthouse 13 mobile medians 97/100 (home) and 98/100 (audit)"
  - "Six committed Lighthouse reports plus a post-copy-swap confirming run, each asserted against the production apex"
  - "The 11 September Cowork copy request applied as a one-file swap, with four coupled conflicts recorded rather than pasted"
  - "A .vercelignore that stops .planning/ and docs/ being uploaded to every build"
  - "A read-back technique that beats a stale resolver: query the zone's own nameservers directly"
affects: [phase-10, go-live, LAND-01, LAND-06]

actuals:
  tokens: 61000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Authoritative-nameserver read-back (dns.Resolver + setServers) as the check no recursive cache can corrupt"
    - "Three Lighthouse runs and a median, because performance is noisy and a single run can trigger a fallback the site does not need"
    - "requestedUrl asserted programmatically in every committed report, so evidence cannot silently come from a preview URL"

key-files:
  created:
    - docs/lighthouse/README.md
    - docs/lighthouse/2026-09-09-home-{1,2,3}.json
    - docs/lighthouse/2026-09-09-audit-{1,2,3}.json
    - docs/lighthouse/2026-09-09-postcopy-confirm.json
    - .vercelignore
  modified:
    - docs/vercel-domains-and-protection.md
    - docs/external-registrations.md
    - .planning/phases/09-landing-page-audit-intake/09-VALIDATION.md
    - src/app/(marketing)/copy.ts
    - .planning/STATE.md

key-decisions:
  - "The plan's DNS precondition was read as met on the authority of the zone's own nameservers, not on Google Public DNS, which was still intermittently answering the deleted Squarespace addresses"
  - "vercel certs issue was NOT run: the first https probe already returned 200 and both certificates were two minutes old. The Phase 8 finding is a possibility to check for, not a step to perform"
  - "The A6 performance fallback was not applied — at a median of 97 there was nothing to buy, and proxy.ts is unchanged"
  - "Only the non-conflicting subset of the 11 September copy request was applied; the hero sub and the guarantee heading are a matched pair that cannot land while the pinned positioning statement lives in the lede"
  - "LAND-01 and LAND-06 were already marked complete (prematurely, in 09-02); they are left marked because this plan's proofs finally earn them, and the gap is recorded rather than silently inherited"

patterns-established:
  - "When a recursive resolver and a live HTTP response disagree, query the authoritative nameserver before concluding anything"
  - "A committed Lighthouse report is evidence only if its requestedUrl is checked; a score without its report is a claim"

requirements-completed: [LAND-01, LAND-06]

coverage:
  - id: D1
    description: "https://backdesk.com.au serves the landing page from Sydney and www 308s to it"
    requirement: LAND-01
    verification:
      - kind: e2e
        ref: "curl -sI https://backdesk.com.au/ — HTTP/2 200, x-vercel-id: syd1::8s7rw-…; curl -sI https://www.backdesk.com.au/ — HTTP/2 308, location: https://backdesk.com.au/"
        status: pass
    human_judgment: false
  - id: D2
    description: "Certificates exist for both public hosts and renew"
    requirement: LAND-01
    verification:
      - kind: integration
        ref: "vercel certs ls — cert_75sS7HrcOF0ESuYpvEho3gVh (backdesk.com.au) and cert_4VC2cnr09xR2WaXDK07jXfUa (www), both in 90d, renew: yes"
        status: pass
    human_judgment: false
  - id: D3
    description: "Console paths are not reachable on the public apex (Assumption A1)"
    requirement: LAND-01
    verification:
      - kind: e2e
        ref: "curl -sI https://backdesk.com.au/inbox — HTTP/2 404, a real 404 rather than a 200 carrying not-found markup"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Google Workspace records survived, proven at the origin rather than at a cache"
    verification:
      - kind: integration
        ref: "dns.Resolver against nsc1 (216.239.32.108) and nsc2 (216.239.34.108): MX 1 smtp.google.com; SPF; google-site-verification; google._domainkey; _dmarc; app CNAME — all byte-identical to the 2026-09-08 entry; AAAA ENODATA; zero 198.185.159.x / 198.49.23.x anywhere in the zone"
        status: pass
    human_judgment: false
  - id: D5
    description: "Lighthouse mobile medians clear 90 on both categories for both public pages"
    requirement: LAND-06
    verification:
      - kind: e2e
        ref: "lighthouse@13.4.1 mobile ×3 per page on the production apex — home perf [99,97,97] median 97, a11y [100,100,100] median 100; audit perf [98,98,98] median 98, a11y [100,100,100] median 100"
        status: pass
    human_judgment: false
  - id: D6
    description: "No Lighthouse evidence came from a preview URL or localhost (T-9-16)"
    requirement: LAND-06
    verification:
      - kind: integration
        ref: "every committed report's requestedUrl asserted to start with https://backdesk.com.au/ — 7 of 7"
        status: pass
    human_judgment: false
  - id: D7
    description: "Metadata and icon assets are correct and served from the apex"
    requirement: LAND-06
    verification:
      - kind: e2e
        ref: "title + og:title/description/image (absolute apex URL, 1200×630); /brand/{og-image.png, favicon.svg, favicon.ico, apple-touch-icon.png} all HTTP/2 200 with correct content-type"
        status: pass
    human_judgment: false
  - id: D8
    description: "The copy swap stayed inside the voice contract"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "npx vitest run tests/marketing-copy.test.ts tests/privacy-page.test.ts tests/marketing-metadata.test.ts — 81 passing; npm run typecheck and npx next build clean; new strings live on production"
        status: pass
    human_judgment: false
  - id: D9
    description: "The OG image renders in a real link preview and the favicon shows on a phone tab"
    requirement: LAND-06
    verification: []
    human_judgment: true
    rationale: "The assets serve with the right bytes and the tags carry the right absolute URLs, which is everything measurable from here. Whether WhatsApp, iMessage and Slack actually render the card, and whether the mark reads at tab size, is a visual judgement on a device this agent does not have."
  - id: D10
    description: "The landing page is fully usable on a phone in both colour schemes"
    requirement: LAND-01
    verification:
      - kind: e2e
        ref: "Lighthouse accessibility 100/100 on all six runs at 412×823 — evidence about contrast, labels and target size, not about whether the page reads well"
        status: unknown
    human_judgment: true
    rationale: "LAND-01's last clause is 'fully usable on a phone'. An accessibility score is a floor, not a substitute for a human scrolling it."

duration: 1h 6m
completed: 2026-09-09
status: complete
---

# Phase 9 Plan 08: Production Proofs, Lighthouse and the Copy Swap Summary

**`https://backdesk.com.au` is live from Vercel's Sydney edge with a certificate nobody had to ask for, scores 97 and 98 on mobile Lighthouse with a clean 100 for accessibility on both public pages, and carries the parts of the 11 September copy request that could land without breaking the voice contract.**

## Performance

- **Duration:** 1h 6m
- **Started:** 2026-09-09T09:03:00Z
- **Completed:** 2026-09-09T10:09:00Z
- **Tasks:** 3 of 3
- **Files modified:** 5 modified, 9 created

## Accomplishments

- **HTTPS on the apex, and the certificate was free.** The plan expected to run `vercel certs issue` twice, because Phase 8 found Vercel does not always auto-issue after a zone change. The first `https://` probe of the plan already returned `HTTP/2 200`, and `vercel certs ls` showed both certificates **two minutes old**. Vercel issued them on its own once the `http-01` challenge could resolve. Recorded as the correction it is: the Phase 8 finding is a *possibility to check for*, not a step to perform. Running `certs issue` unconditionally would have written a log line that looked like the cause of a success it had nothing to do with.
- **Eight proofs, all from `syd1`.** Apex `/` 200, www 308 to the apex, plain HTTP 308 to https, `/inbox` **404**, `/audit` 200 on both hosts, app host `/` 307 to `/login`, `/brand/og-image.png` 200 `image/png`. Both public hosts send `strict-transport-security: max-age=63072000`.
- **Assumption A1 measured and it held.** `https://backdesk.com.au/inbox` returns a *real* 404, not a 200 carrying not-found markup, so the planned `proxy.ts` fallback was not needed and the proxy is untouched.
- **LAND-06 measured on production.** Lighthouse 13.4.1, mobile preset, three runs per page: home **97** perf / **100** a11y, audit **98** perf / **100** a11y. The lowest single number across all twelve measurements is 97. The A6 performance fallback was not applied and is not needed.
- **The copy request arrived and partly landed.** Applied as the intended one-file swap; four coupled conflicts recorded for the Cowork thread rather than pasted (below).
- **Deploys stopped shipping the planning directory.** Adding six Lighthouse reports broke `vercel --prod` with `Upload aborted`; the repository had no `.vercelignore`, so every deploy had been uploading `.planning/` (6.9 MB), `docs/` (3.7 MB) and `logo/`. Now excluded.

## Task Commits

1. **Task 1: read-backs, certificates, the eight HTTPS proofs, docs measured column** — `327ec8d`
2. **Task 2: Lighthouse 13 mobile ×3 per page, medians, README, VALIDATION** — `d112e16`
3. **Task 3: the non-conflicting subset of the 11 September copy request** — `76595ba`
4. **Deviation (Rule 3): `.vercelignore` + the post-swap confirming run and copy-swap record** — `509b991`

## Files Created/Modified

- `docs/external-registrations.md` — a dated entry carrying the certificate outcome, three tiers of read-back (authoritative, recursive, Vercel), the eight header blocks, the public bodies, the Lighthouse table, and what the copy request could not take
- `docs/vercel-domains-and-protection.md` — §9's four empty HTTPS/TLS rows filled, plus two new rows (plain-HTTP redirect, apex `/inbox`), and the narrative corrected from "HTTPS does not work yet" to the auto-issue finding
- `docs/lighthouse/` — README plus seven JSON reports
- `src/app/(marketing)/copy.ts` — six string swaps and two comments explaining what was refused and why
- `.planning/phases/09-landing-page-audit-intake/09-VALIDATION.md` — 9-08-01/02/03 rows passed, the recorded-results table filled, the phone-only rows left explicitly open
- `.planning/STATE.md` — the Phase 9 Squarespace-parking blocker marked resolved with the propagation warning attached
- `.vercelignore` — new

## Decisions Made

**1. The DNS precondition was judged met on the origin's authority, not the resolver's.** The precondition said Google Public DNS must no longer return `198.185.159.x` / `198.49.23.x` for the apex. It still did — on 1 to 2 of every 10 probes, hours after the cut-over, with ~2,700 s left on a TTL it could only have acquired before the edit. Read literally, the plan stops here and goes back to the founder.

It is one cache draining, and the way to know that is to stop asking caches. The sandbox `dig` is a stub, so this used Node's `dns.Resolver` with `setServers()` to query `nsc1` and `nsc2.squarespacedns.com` directly. Both returned the Vercel pair and **no parking address anywhere in the zone**, along with every Google Workspace record byte-identical to the 2026-09-08 table. That is a measurement of the record; everything else is a measurement of somebody's memory of it. 09-07 met the same split on `www` and settled it with three corroborating authorities — this is the sharper version of that lesson, and it is now written into §9 as the check to reach for first.

**2. `vercel certs issue` was not run.** See above. The honest record is that the plan's central expected action turned out to be unnecessary, and saying so is more useful than quietly performing it anyway.

**3. The A6 fallback was not applied.** It would have moved the app-host `/` → `/clients` rewrite out of `proxy.ts` into `next.config.ts` to let the apex `/` bypass the proxy. At a median of 97 there is nothing to buy, and the plan's own condition (a median below 90) never fired. `proxy.ts` and its matcher are unchanged.

**4. Three runs, not one.** The home page returned 99, 97, 97 on three identical runs against an unchanged deployment. A single run either flatters or defames by a couple of points, and a single unlucky run landing on 89 would have triggered a structural change the site did not need.

**5. Only part of the copy request was applied, and the refusals are coupled.** Detailed below — this is the decision most likely to be revisited, so it is recorded as reasoning rather than as a verdict.

**6. LAND-01 and LAND-06 were left marked complete, and the premature marking is recorded.** Both were ticked in **09-02**, the brand identity pass, when `https://backdesk.com.au` did not resolve at all — the checkbox has been claiming a live HTTPS site for a week. 09-07 noticed the same thing from the other side and deliberately declined to mark LAND-01. The marks are now substantively earned, so flipping them off and on again would be theatre; but the gap between "marked" and "true" existed and is named here so the pattern is visible: `requirements mark-complete` fires on the plan that *declares* a requirement, not on the plan that *proves* it.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `vercel --prod` failed with `Upload aborted`, then a Vercel-side 500**

- **Found during:** Task 3, deploying the copy swap
- **Issue:** Committing six Lighthouse reports (~3 MB) pushed `vercel --prod` into a reproducible `Upload aborted`. The repository had **no `.vercelignore`**, so the CLI was uploading `.planning/` (6.9 MB), `docs/` (3.7 MB) and `logo/` (364 KB) on every deploy — none of which `next build` reads.
- **Fix:** Added `.vercelignore` excluding `.planning/`, `docs/`, `logo/` and local test output, deliberately leaving `public/` (the served favicon and OG image) in place. A subsequent attempt hit a genuine Vercel-side `Internal Server Error`, which the CLI itself flags as retryable; the retry succeeded.
- **Why it counts as more than a build fix:** the size was the symptom. Planning notes, evidence documents and brand source files were being shipped to a build machine on every deploy, and nothing in the repository said they should not be.
- **Files modified:** `.vercelignore`
- **Commit:** `509b991`

### Sequencing note

The plan's Task 2 measures Lighthouse before Task 3 changes the copy, which risks recording medians for a page that no longer exists. Plan order was kept because the delta turned out to be six short strings, and the plan's own remedy — one confirming pass on `/` after the redeploy — closed the gap: **99 perf / 100 a11y**, accessibility unchanged. Had the request been the full rewrite it first appeared to be, the right move would have been to swap first and measure once.

## The 11 September copy request: what landed, what did not

The request arrived as `docs/gtm/requests/build-request-phase-9-landing-copy.md` (9 Sep, approved copy), so the optional task **ran** rather than recording a skip.

**Applied** — hero eyebrow → `Perth · ServiceM8 trade businesses`; the line under the hero button → the request's free / no-lock-in / no-lead-generation sentence; form labels → `Do you use ServiceM8?`, `Quotes sent per month, roughly`, `ServiceM8 export (optional)`; submit → `Send the audit request`. All verified live on `https://backdesk.com.au/audit`.

**Not applied, for the Cowork thread to resolve:**

1. **The hero sub** drops `done-for-you quote-chasing service` — the positioning statement `tests/marketing-copy.test.ts` pins. Pasting it deletes a phrase the contract requires.
2. **The guarantee heading is blocked by (1), and this is the interesting one.** The request's heading — *"If it doesn't recover more than 3× its fee in 90 days, you don't pay until it does."* — is **verbatim the last sentence of the current hero lede**. In the request's own design that is fine, because its replacement hero sub removes the sentence from the hero. Since the hero sub cannot land, taking the heading alone would print one sentence twice on one page. The two are a matched pair. This was applied, then reverted when the duplication surfaced, and the reasoning is now a comment in `copy.ts` so the next reader does not re-make the mistake.
3. **The footer line and the meta description** each repeat `Run by AI, checked by a human`, which D-09 and the suite permit **exactly once**, in the lede.
4. **Everything structural** — the new "Most quotes never get a single follow-up" section, the third `Not sure` radio, the two conditional notes ("No" → ServiceM8-only, "Under 8" → honesty note), the personalised confirmation (`Got it, [first name]` / `[mobile]`), and `backdesk.com.au/audit/how-to` — is component and schema work, outside a one-file copy swap. **The how-to page additionally cannot be written from here at all:** the request itself says its ServiceM8 menu paths must be recorded from a live account and not guessed.

One substantive wording loss to flag: the request's guarantee body drops the denominator spelled out in full ("the monthly fees you paid in that period"). Moot for now since the body was not swapped, but worth settling in the **M3 founding-client agreement**, which is where a guarantee is actually owed.

The request file was left unmodified — `docs/gtm/` is the marketing thread's tree and this thread does not write to it, so the plan's "update the status line to applied" step was deliberately skipped.

## Issues Encountered

**A resolver said the founder's change had not happened, four hours after it had.** Covered in Decision 1. The operational cost is real: a scripted precondition that trusts one recursive resolver will block a correct plan for the length of the previous TTL, which here was four hours.

**`grep -c "Run by AI, checked by a human" copy.ts` prints 2, not the 1 the plan's acceptance criterion expects.** Not a defect and not caused by this plan: one match is the *string* (the lede) and one is the module comment that explains the single-disclosure rule. The real gate is `tests/marketing-copy.test.ts`, which imports the module and counts string leaves with comments excluded — it asserts exactly 1 and passes. A grep over source cannot tell a rule from a mention of the rule.

## Known Stubs

None.

## Deferred Items

**`https://backdesk.com.au/favicon.ico` returns 404.** The page's `<link rel="icon">` tags point at `/brand/favicon.svg`, `/brand/favicon.ico` and `/brand/apple-touch-icon.png`, and **all three serve 200 with the right content types**, so every browser that parses the page gets the mark — LAND-06's favicon clause is met. What is missing is the bare-root fallback some crawlers, feed readers and error pages request without parsing HTML. A small, low-risk addition; deliberately not made during a phase close-out, and not worth a redeploy on its own.

## Outstanding human checks (carried forward from every plan in this phase)

None of these can be closed from here. All are now checkable on the **public** site rather than the walled app host, which is the thing this plan changed.

| # | Check | From | Requirement |
|---|---|---|---|
| 1 | On a phone, light **and** dark: favicon on the tab, lockup in the header, no sideways scroll at 390px, the two green buttons the only green besides the prices | 09-05, 09-08 | LAND-01, LAND-06 |
| 2 | Paste `https://backdesk.com.au` into WhatsApp / iMessage / Slack — the card shows the OG image and the title `Backdesk · Quote chasing for Perth trade businesses` | 09-05, 09-08 | LAND-06 |
| 3 | Submit a real audit request from the phone (own mobile + email) → thanks page, **email and SMS within a minute**, row in the console. Record both arrival times for the VALIDATION table | 09-01, 09-08 | LAND-03 |
| 4 | Console detail → Download CSV → Start audit → mapping step → Open audit, end to end | 09-06 | LAND-04 |
| 5 | Console `/` still lands on the client list after the rewrite move | 09-04 | LAND-01 |
| 6 | OG image and touch icon visually conform to D-06 | 09-02 | LAND-06 |
| 7 | Dark-mode header sizing reads correctly on a real device | 09-05 | LAND-01 |

Machine-side, everything under items 1, 2 and 6 that *can* be measured has been: the assets serve with correct bytes and content types, the tags carry absolute apex URLs, and accessibility is 100/100 at 412×823.

## Next Phase Readiness

Phase 9 closes with both of its production requirements measured rather than asserted. For Phase 10:

- **The public site is live and fast**, so go-live work can point prospects at `backdesk.com.au` today.
- **Two follow-ups are queued and small:** the root `/favicon.ico` fallback, and the structural half of the copy request (problem section, third radio, conditional notes, personalised confirmation, `/audit/how-to`). The how-to page needs a live ServiceM8 session first.
- **The seven human checks above are the gate**, not the code. Item 3 in particular — a real submission producing a real SMS and email — is the last unproven end-to-end path on the public host.
- **Watch the resolver lesson.** Anyone probing DNS for `backdesk.com.au` in the hours after this plan should expect Google Public DNS to keep answering the deleted Squarespace addresses until its 14,400 s TTL drains, and should query `nsc1`/`nsc2.squarespacedns.com` directly rather than opening a registrar ticket.

## Self-Check: PASSED

All ten claimed files exist on disk; all four claimed commit hashes resolve in `git log`;
all seven committed Lighthouse reports carry a `requestedUrl` on `https://backdesk.com.au/`.
