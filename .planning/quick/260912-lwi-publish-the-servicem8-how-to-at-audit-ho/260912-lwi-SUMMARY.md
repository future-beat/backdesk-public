---
phase: quick
plan: "260912-lwi"
quick_id: 260912-lwi
subsystem: ui
tags: [marketing, landing-page, copy, servicem8, sitemap, metadata, vitest]

# Dependency graph
requires:
  - phase: 09-landing-page-audit-intake
    provides: "the public site shell, the one copy module (D-08), the .wrap/.measure containers, the sitemap/robots pair and the voice-gate test suite this extends"
provides:
  - "`/audit/how-to`: a public, indexable page with two ordered lists of five documented ServiceM8 steps and the marketing-approved closing sentence"
  - "`HOWTO_COPY` in the one copy module, with the closing sentence defined once and rendered on both pages by reference"
  - "the same how-to block on `/audit/thanks`, so a prospect who has just submitted can act without waiting for a call"
  - "`tests/howto-page.test.ts`: 16 gates over the shape, the wording, and the two claims the page withholds"
  - "`docs/gtm/requests/response-phase-9-how-to.md`: the final wording handed back to the Cowork thread for M4 §4.8"
affects: [landing-page, audit-intake, outreach-scripts, m4-outreach-kit, servicem8-onboarding]

actuals:
  tokens: 6571
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A public claim is pinned by a NEGATIVE test: `tests/howto-page.test.ts` asserts the words 'read-only' never reach this page, so the next edit that pastes the console's wording fails a gate instead of a prospect"
    - "One sentence, two pages, one definition: the confirmation renders `HOWTO_COPY.options` and `HOWTO_COPY.sentence` from the same object the how-to page does, so the founder's verification edits land in one place"

key-files:
  created:
    - "src/app/(marketing)/audit/how-to/page.tsx"
    - "tests/howto-page.test.ts"
    - "docs/gtm/requests/response-phase-9-how-to.md"
  modified:
    - "src/app/(marketing)/copy.ts"
    - "src/app/(marketing)/audit/thanks/page.tsx"
    - "src/app/sitemap.ts"
    - "tests/marketing-copy.test.ts"
    - "tests/marketing-metadata.test.ts"

key-decisions:
  - "Wrote 'Option 1: an API key', not the plan's 'Option 1 — an API key': the voice gate in tests/marketing-copy.test.ts forbids an em dash in any public string, and the plan's literal wording would have failed a pinned test the moment it was typed"
  - "Published no 'read-only' claim and no date filter on the export — ServiceM8's public docs describe neither — and recorded both as a FOUNDER-VERIFY comment in copy.ts rather than as a guess on the page"
  - "Avoided the word 'dashboard' in the export steps even though the ServiceM8 article puts the Reports tab in its Online Dashboard: 'dashboard' is on the D-09 forbidden list, and 'Open the Reports tab' is the same instruction without it"
  - "Rendered the two FULL lists on /audit/thanks rather than the permitted one-line link: a prospect who has just submitted is the most willing they will ever be, and a click is where that willingness is spent"
  - "Listed /audit/how-to in the sitemap (unlike /audit/thanks, which stays noindex): it is a page an owner searches for again a week later and forwards to whoever actually logs into ServiceM8"
  - "Added no nav item, no CSS, no dependency — the page is the marketing layout, the 38em measure and the copy module, per the LAND-01 prohibition"

patterns-established:
  - "Strip comments before counting markup in a structural test: a doc comment that says 'two `<ol>` lists' must not be what satisfies, or breaks, a count of `<ol>`"
  - "Hand marketing the wording as a file in docs/gtm/requests/, in the Code → Cowork direction the launch plan §4 defines, with the founder's outstanding verifications named in it"

requirements-completed: []

coverage:
  - id: D1
    description: "/audit/how-to renders two ordered lists of at most five documented steps each, in the M1 voice, followed by the approved sentence word for word"
    requirement: "LAND-05"
    verification:
      - kind: unit
        ref: "tests/howto-page.test.ts#two lists, five steps each (copy request §3.2)"
        status: pass
      - kind: unit
        ref: "tests/howto-page.test.ts#the approved sentence, once on each page"
        status: pass
      - kind: unit
        ref: "tests/marketing-copy.test.ts#the D-09 voice rules hold over every string (LAND-01)"
        status: pass
      - kind: integration
        ref: "curl -s -o /dev/null -w '%{http_code}' https://backdesk.com.au/audit/how-to -> 200; https://app.backdesk.com.au/audit/how-to -> 200"
        status: pass
    human_judgment: false
  - id: D2
    description: "The confirmation page /audit/thanks carries the same how-to block and a link to the page"
    verification:
      - kind: unit
        ref: "tests/howto-page.test.ts#the confirmation carries the same block (copy request §3.3)"
        status: pass
      - kind: integration
        ref: "curl -s https://backdesk.com.au/audit/thanks | grep -c 'Send the key or the file to' -> 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "The page names documented menu paths only and makes no claim ServiceM8's docs do not support"
    requirement: "LAND-05"
    verification:
      - kind: unit
        ref: "tests/howto-page.test.ts#the steps name documented paths only (LAND-05 prohibition)"
        status: pass
      - kind: integration
        ref: "curl -s https://backdesk.com.au/audit/how-to | grep -ci 'read-only' -> 0"
        status: pass
    human_judgment: true
    rationale: "Only the founder, signed into the ServiceM8 trial account, can confirm the two screens exist as written and whether a read-only key or a date filter is offered. The automated gates prove the page does not CLAIM either; they cannot prove the documented paths are current."
  - id: D4
    description: "The final wording is handed to marketing as docs/gtm/requests/response-phase-9-how-to.md"
    verification:
      - kind: other
        ref: "grep -c 'Send the key or the file to' docs/gtm/requests/response-phase-9-how-to.md -> 1; committed as 27f3ae0"
        status: pass
    human_judgment: false
  - id: D5
    description: "/audit/how-to is in the sitemap and live on both hosts"
    verification:
      - kind: unit
        ref: "tests/marketing-metadata.test.ts#lists exactly four URLs"
        status: pass
      - kind: integration
        ref: "curl -s https://backdesk.com.au/sitemap.xml | grep -c how-to -> 1"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-09-12
status: complete
---

# Quick task 260912-lwi: the ServiceM8 how-to, published

**The page the outreach scripts promise now exists at `backdesk.com.au/audit/how-to`: two five-step lists built only from paths ServiceM8 documents in public, the approved sentence word for word, the same block on the confirmation, and the two things the docs do not support left unclaimed and written down as owed.**

## Performance

- **Duration:** 22 min
- **Tasks:** 2 of 2
- **Commits:** 2

## Accomplishments

- **`HOWTO_COPY` in the one copy module.** Title/description metadata, h1, intro, two options of five steps each with a note under each, the closing sentence built from `CONTACT_EMAIL` rather than a literal, the back-link text, and the two strings the confirmation page needs. Defined once; both pages render it by reference, so `grep -c "Send the key or the file to" copy.ts` is 1.
- **`/audit/how-to`.** A server component in the marketing layout at the 38em measure: one `h1`, two `h2`, two `<ol>`, the sentence as a paragraph, a "Back to the audit form" link. Indexable, canonical, its own title and description, listed in the sitemap, prerendered as a static route (`○ /audit/how-to` in the build output). No nav item, no script, no dependency.
- **The same block on `/audit/thanks`.** Both lists (as `h3` under an `h2`, so heading levels never skip) and the same sentence, from the same object, plus a link to the page for anyone who wants it on its own. The page stays `noindex`.
- **`tests/howto-page.test.ts`.** 16 gates: two options in key-first order, ≤5 steps each, one `<ol>` element and no `<ul>`, the sentence byte for byte and rendered exactly once per page, the six documented menu words present, the metadata and canonical wired, the sitemap entry, one `h1` and two `h2`, and — the load-bearing one — the words "read-only" and "read only" appearing nowhere in the page's text.
- **The hand-off.** `docs/gtm/requests/response-phase-9-how-to.md` gives the Cowork thread the live URL, both lists and the sentence verbatim for M4 §4.8, the two claims the page withholds and why, the founder's two verification items, and a one-liner for an SMS.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The plan's own heading wording would have failed a pinned voice test**

- **Found during:** Task 1
- **Issue:** The plan specified the list headings as "Option 1 — an API key" and "Option 2 — the Job List export". `tests/marketing-copy.test.ts` asserts that no string leaf of any copy export contains an em dash (M1 punctuation), and it walks every export, so the new one is covered the moment it exists. The plan's literal wording fails that gate.
- **Fix:** Wrote "Option 1: an API key" and "Option 2: the Job List export". Same words, a colon instead of the dash.
- **Files modified:** `src/app/(marketing)/copy.ts`
- **Commit:** 9374976

**2. [Rule 3 - Blocking] Two existing suites pinned counts that a new export and a fourth URL change**

- **Found during:** Task 1
- **Issue:** `tests/marketing-copy.test.ts` asserted `Object.keys(COPY)` equals exactly five names, and `tests/marketing-metadata.test.ts` asserted the sitemap lists exactly three URLs. Both are deliberate exhaustive gates, and both fail on a correct change.
- **Fix:** Added `'HOWTO_COPY'` to the export list (with a comment saying why the list is exhaustive) and `/audit/how-to` to the expected sitemap URLs, renaming the test to "lists exactly four URLs". `tests/marketing-metadata.test.ts` was not in the plan's file list; changing it was unavoidable and is the smallest possible edit.
- **Files modified:** `tests/marketing-copy.test.ts`, `tests/marketing-metadata.test.ts`
- **Commit:** 9374976

**3. [Rule 2 - Missing] The documented export path runs through a word the voice gate forbids**

- **Found during:** Task 1
- **Issue:** ServiceM8's Help Centre puts the Reports tab inside the "Online Dashboard", and "dashboard" is on the D-09 forbidden list that `tests/marketing-copy.test.ts` enforces over every public string.
- **Fix:** "Open the Reports tab." The instruction is the same and the forbidden word is not needed to give it.
- **Files modified:** `src/app/(marketing)/copy.ts`
- **Commit:** 9374976

**4. [Rule 1 - Bug] A doc comment satisfied a structural count in the new test**

- **Found during:** Task 1
- **Issue:** The first version of `tests/howto-page.test.ts` counted `<ol>` in the page source and found two — one in the JSX and one in the doc comment that explains the JSX.
- **Fix:** Added the `uncommented()` helper `tests/marketing-copy.test.ts` and `tests/layout-contract.test.ts` already use, and applied it to all three sources the suite reads.
- **Files modified:** `tests/howto-page.test.ts`
- **Commit:** 9374976

## Verification

Task 1, local:

- `npx vitest run tests/howto-page.test.ts tests/marketing-copy.test.ts tests/privacy-page.test.ts` — 75 passed
- `npx vitest run tests/marketing-metadata.test.ts tests/proxy-host-routing.test.ts tests/layout-contract.test.ts` — passed
- `npm test` (bare, no `ALLOW_REMOTE_TESTS`) — 3106 tests passed; the 43 file-level failures are the integration suites refusing to run without a local Supabase, which is their pre-existing behaviour on a bare run and is out of this task's scope
- `npm run typecheck` and `npm run lint` — clean
- `npx next build` — lists `○ /audit/how-to` as a static route
- `grep -c "Send the key or the file to" 'src/app/(marketing)/copy.ts'` → 1; `grep -c "/audit/how-to" src/app/sitemap.ts` → 1

Task 2, live (production deployment `backdesk-ciueoa1dw`, Ready, 38s):

- `https://backdesk.com.au/audit/how-to` → **200**
- `https://app.backdesk.com.au/audit/how-to` → **200**
- `curl -s https://backdesk.com.au/sitemap.xml | grep -c how-to` → **1** (`<loc>https://backdesk.com.au/audit/how-to</loc>`)
- The approved sentence renders once on the live how-to page and once on the live `/audit/thanks`; "Advanced Reporting Pack" present; `grep -ci 'read-only'` on the live how-to page → **0**
- Live `<title>` is "How to send your ServiceM8 data · Backdesk" with canonical `https://backdesk.com.au/audit/how-to`

## Owed: founder verification (2 items)

Both are in `docs/gtm/requests/response-phase-9-how-to.md` and as a `FOUNDER-VERIFY` comment in `copy.ts`. Neither blocks the page being live; both should be closed before Tier 1 calls quote the steps.

1. **Settings → API Keys.** Confirm the path exists as written on the trial account, and whether a key can be limited or made read-only. If it can, the page may say so and Option 1 gains a sentence — which materially strengthens the ask.
2. **Settings → ServiceM8 Add-ons → Advanced Reporting Pack, then Reports → Job List Export.** Confirm it produces a CSV as written, and whether a date filter exists. If one does, Option 2 gains a step and the note under it goes.

Either answer is a copy edit in one object, not a rewrite.

## Known Stubs

None.

## Self-Check: PASSED

- `src/app/(marketing)/audit/how-to/page.tsx` — FOUND
- `tests/howto-page.test.ts` — FOUND
- `docs/gtm/requests/response-phase-9-how-to.md` — FOUND
- commit `9374976` — FOUND (pushed)
- commit `27f3ae0` — FOUND (pushed)
