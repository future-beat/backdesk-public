---
phase: quick
plan: "260915-ec0"
quick_id: 260915-ec0
status: complete
subsystem: marketing-site
tags: [guide, content, servicem8, publish-flag, seo, sitemap, copy-module, accessibility]

# Dependency graph
requires:
  - phase: 09-landing-page-audit-intake
    provides: "the one copy module (D-08) and its voice gate, the marketing layout, `.wrap` / `.measure` / `.button`, `METADATA_COPY`, the sitemap, and `/audit/how-to` as the mould for a verified-steps page"
  - phase: 08-brand-spec
    provides: "the M1 type, palette and token set both colour schemes are built from"
  - phase: 07-instrumentation-and-reporting
    provides: "`.table-scroll` and its keyboard-reachability gate (G-07-6), reused verbatim for the schedule table"
provides:
  - "`/guides/servicem8-quote-follow-up` — the M7 guide, built and deployed, 404 until published"
  - "`GUIDE_PUBLISHED` / `GUIDE_PUBLISHED_ON` / `guideIsPublished()` — one publish predicate read by both the route and the sitemap"
  - "`MERGE_FIELDS` — the ONE FOUNDER-VERIFY map the five message templates render from"
  - "`guideDisclaimer(iso)` — the required non-affiliation sentence with a Perth-formatted date"
  - "`GUIDE_COPY`, `METADATA_COPY.guide` — the approved M7 copy, pinned verbatim by `tests/guide-page.test.ts`"
  - "docs/gtm/requests/response-phase-10-guide-page.md — the verification note Cowork asked for"
affects: [sitemap, marketing-copy-gate, guides-namespace]

actuals:
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A page whose copy contains one unverified third-party fact ships BUILT and DARK: the route calls `notFound()` behind a flag, so the work is deployed, reviewable and diffable while the claim is still unverified — publishing is then a three-line code change with a human in it, not a toggle"
    - "The route and the sitemap read ONE predicate (`guideIsPublished()`). Two spellings of 'published' is a sitemap entry that answers 404, which is worse than being unlisted: it is an instruction to index a page that does not exist"
    - "`guideIsPublished()` requires the flag AND the date, so a required disclaimer can never render with a hole in it"
    - "An unverified third-party syntax is quarantined in ONE map that the copy renders from, so the verifying human's correction is one edit rather than five — and the three tokens are spelled once in the whole file, comments included, so `grep` is as good a tool for it as the test is"
    - "A forbidden-word exemption is scoped to one word AND one export, carries its reason beside it, and is asserted in both directions (it fires, and it does not widen)"

key-files:
  created:
    - "src/app/(marketing)/guides/servicem8-quote-follow-up/page.tsx"
    - "tests/guide-page.test.ts"
    - "docs/gtm/requests/response-phase-10-guide-page.md"
  modified:
    - "src/app/(marketing)/copy.ts"
    - "src/app/(marketing)/marketing.css"
    - "src/app/sitemap.ts"
    - "tests/marketing-copy.test.ts"
    - "tests/marketing-metadata.test.ts"

key-decisions:
  - "Held the WHOLE page behind a flag rather than publishing it with the placeholders rewritten out. The merge fields appear in every one of the five templates, so a version without them is a different page marketing did not approve; a 404 costs nothing while the founder has not opened the editor, and LAND-05 forbids publishing invented field syntax"
  - "Made the publish predicate require the DATE as well as the flag. The build request called the disclaimer non-optional and said to insert the real publish date, so the code refuses to publish without one instead of rendering 'accurate as at {date}'"
  - "The 'automation' exemption is scoped to `GUIDE_COPY` and to that word alone, asserted from both sides: it must fire (a dead exemption gets deleted) and it must not widen (any other export saying it still fails). 'Dashboard' stays forbidden INSIDE the guide too, which is what forced the step-1 rewording"
  - "Declared NO page-level `openGraph`. Next replaces the parent's `openGraph` object wholesale when a page declares one, so a page-level block would have to respell `/brand/og-image.png` — the second spelling D-16 exists to prevent. Inheriting is how every other public page already reuses that image"
  - "Labelled the table's scroll region with the section's own heading (`aria-label={schedule.h2}`) rather than inventing a label. The region a screen reader announces should be the one the page already named, and it adds no copy marketing has not approved"
  - "Kept the button's `/#audit` target exactly as the copy specified even though no `#audit` anchor exists on the home page (it lands at the top, whose first item is the same call to action). Changing a marketing-approved link silently is worse than flagging it, so it is flagged in the response doc for Cowork to rule on"
  - "Left `robots.ts` alone. It carries `Allow` rules and a `Disallow` list; `/guides` matches no `Disallow`, so it is crawlable the moment it stops answering 404, and touching the pinned allow-list would have been a change with no effect"

patterns-established:
  - "Dark deploys for content: build the page, pin the copy, gate the route, and hand the verifier a one-edit correction surface — the page can be reviewed, screenshotted in preview and diffed long before the fact it depends on is confirmed"
  - "When a site-wide copy gate meets a page that quotes ANOTHER product's UI, exempt the exact word in the exact object and write the reason into the test — the list governs how we describe ourselves, not what a menu item is called"

requirements-completed: []

coverage:
  - id: T1
    description: "The route renders the approved M7 copy verbatim (title, meta, H1, every section, the schedule table, the five templates, the closing CTA) in the marketing layout at a long-form measure"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#carries the head the request specified, with the name printed once"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#opens on the sentence that gives the tool away, before it sells anything"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#prints the five-row schedule exactly"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#lists the five cancel conditions that quietly stop the sequence"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#keeps the four things the tool does NOT do, in the reader-first order"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#gives the guide the long-form measure and line height it was asked for"
        status: pass
      - kind: other
        ref: "Phone and desktop screenshots in light and dark: OWED, and impossible while the route answers 404 (request §7)"
        status: pending
    human_judgment: true
    rationale: "Every sentence is pinned by value and the layout classes are pinned by source, but 'reads well on a phone in both schemes' is a judgment a test cannot make. It is the acceptance set §7 asks for, and five of its six items cannot be photographed until the page publishes."
  - id: T2
    description: "Exactly one button, at the bottom, 'Get the free audit' to /#audit; no link to /audit/how-to anywhere on the page"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#renders exactly one button, and it is the free audit"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#puts it after every word of the guide, and before only the disclaimer"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#never links to /audit/how-to, from the page or from the copy"
        status: pass
      - kind: other
        ref: "grep -c '/audit/how-to' 'src/app/(marketing)/guides/servicem8-quote-follow-up/page.tsx' -> 0 (the path is absent from the file, comments included)"
        status: pass
    human_judgment: false
  - id: T3
    description: "The five templates render as visually distinct blocks whose plain text is selectable as a unit"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#makes each message a block whose text selects as one unit (figure.template + pre with user-select: all, white-space: pre-wrap)"
        status: pass
      - kind: other
        ref: "Selecting a whole message with one click in a browser: OWED with the §7 screenshots, on publish"
        status: pending
    human_judgment: true
    rationale: "`user-select: all` is asserted at source; whether one click takes the whole block is a browser behaviour, and the page cannot be opened until it publishes."
  - id: T4
    description: "The ServiceM8 merge fields appear in ONE map (MERGE_FIELDS), marked FOUNDER-VERIFY with its third-party source, and the templates render from it"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#spells the brace syntax in MERGE_FIELDS and NOWHERE else"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#substitutes the fields into the first line of every message"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#leaves the reader their own words, and none of the draft placeholders"
        status: pass
      - kind: other
        ref: "grep -c 'job.contact_first' 'src/app/(marketing)/copy.ts' -> 1; 'job.quote_date' -> 1; the brace literal for job.description -> 1 (the second grep hit is the unrelated phrase 'job descriptions' in the privacy copy)"
        status: pass
      - kind: other
        ref: "FOUNDER-VERIFY: read the Insert Field list in Settings > Automation > Quote Follow Up > Edit and confirm or correct the three tokens"
        status: pending
    human_judgment: true
    rationale: "ServiceM8 publishes no merge-field syntax anywhere. Only a human looking at the template editor can settle it, which is exactly why the page is dark."
  - id: T5
    description: "While GUIDE_PUBLISHED is false the route 404s, the page is absent from the sitemap, and no publish date is rendered; flipping the flag with GUIDE_PUBLISHED_ON publishes it with the real date"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#is unpublished today, because the founder has not read the editor yet"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#never reports published without a date for the disclaimer"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#404s the route from that one predicate"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#omits the guide while it is unpublished / lists it as soon as the flag says published (sitemap module re-imported with the predicate mocked)"
        status: pass
      - kind: unit
        ref: "tests/marketing-metadata.test.ts#holds the guide out of the count until it is published (260915-ec0)"
        status: pass
      - kind: integration
        ref: "curl -s -o /dev/null -w '%{http_code}' https://backdesk.com.au/guides/servicem8-quote-follow-up -> 404, against production deployment dpl_8oji9k53pk51eeDU7v4qWfKnG7zv"
        status: pass
      - kind: integration
        ref: "curl https://backdesk.com.au/sitemap.xml -> the same four URLs as before; /audit/how-to and / still 200"
        status: pass
    human_judgment: false
  - id: T6
    description: "The footer disclaimer is present verbatim, with the real publish date"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#renders the disclaimer verbatim, with a real date, when it is published (guideDisclaimer('2026-09-15') -> '... accurate as at 15 September 2026; ...')"
        status: pass
      - kind: other
        ref: "The disclaimer as rendered, with the real publish date: OWED with the §7 screenshots, on publish"
        status: pending
    human_judgment: true
    rationale: "The sentence and the date format are pinned as values; the rendered footer is part of the acceptance set that waits on publication."
  - id: P1
    description: "LAND-05 prohibition: MUST NOT publish while any merge-field name is unverified; MUST NOT invent field syntax beyond the single FOUNDER-VERIFY map"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#is unpublished today + #spells the brace syntax in MERGE_FIELDS and NOWHERE else"
        status: pass
      - kind: other
        ref: "Live 404 recorded above; the response doc states in writing that ServiceM8's own docs do not print the syntax and names the third-party source"
        status: pass
    human_judgment: false
  - id: P2
    description: "LAND-01 prohibition: no images of AI, robots, dashboards or stock tradies, no sticky bar, no mid-page CTA, no pop-up, no blog index, tags, author bio, comments or newsletter signup; no new dependency"
    verification:
      - kind: unit
        ref: "tests/guide-page.test.ts#adds no image, no script, no client component and no dependency"
        status: pass
      - kind: unit
        ref: "tests/guide-page.test.ts#renders exactly one button ... #puts it after every word of the guide"
        status: pass
      - kind: other
        ref: "package.json unchanged in both commits; the page imports only next/link, next/navigation, react and the copy module"
        status: pass
    human_judgment: false
---

# Quick task 260915-ec0: the ServiceM8 quote-follow-up guide, built and deliberately dark

**The M7 guide is complete, deployed and answering 404: every sentence is pinned verbatim, the menu path is verified against ServiceM8's own help centre, and the one fact nobody can verify from a desk — the merge-field syntax — is quarantined in a single map that holds the whole page behind a flag until the founder reads the Quote Follow Up template editor.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 of 2
- **Commits:** 2 (`90a9d7d`, `f19d734`), both pushed to `origin/main`

## Accomplishments

- **`/guides/servicem8-quote-follow-up`**, a server component in the marketing layout: the M7 copy in full, at the shared 38em measure with a 1.65 line height (the one page on this site that is genuinely long-form), one `h1` and seven `h2`, both colour schemes by construction because every value is a token. The build lists it as a static route.
- **The publish gate is one predicate.** `guideIsPublished()` returns `GUIDE_PUBLISHED && GUIDE_PUBLISHED_ON !== null`, and BOTH the route (`notFound()` on the first line of the component) and `sitemap.ts` read it. A page that 404s while sitting in the sitemap is an instruction to index something that does not exist, and requiring the date as well means the non-optional disclaimer can never render with a hole in it.
- **`MERGE_FIELDS`, one map, FOUNDER-VERIFY.** ServiceM8's help centre says the fields exist and tells you to type the brackets, but never prints the tokens; the three candidates come from a third-party cheatsheet, cited in the JSDoc. All five templates render from the map, and the three tokens are spelled exactly once in the whole file — comments included — so the founder's correction is one edit and `grep` confirms it.
- **The templates are copyable blocks**: `<figure class="template">` with a caption line ("1. Two hours, SMS") and a `<pre>` at `white-space: pre-wrap; user-select: all`, so a message selects as a unit and pastes into the ServiceM8 editor with its paragraph breaks intact. `[your business]` and `[your name]` stay literal — they are the reader's own words, not merge fields.
- **The schedule table scrolls in its own box, reachable by keyboard.** It reuses the console's `.table-scroll` convention (`tabIndex={0} role="region" aria-label=...`), labelled with the section's own heading so no new copy was invented. This was caught by the existing G-07-6 gate, not by me.
- **The voice gate now reads the guide**, with exactly one exemption. `tests/marketing-copy.test.ts` walks every string of every export, so `GUIDE_COPY` was scanned the moment it existed. "Automation" is exempted for that object alone — it is the literal name of the ServiceM8 add-on a reader has to find in their own menu — and the exemption is asserted in both directions: it must fire, and no other export may say the word. "Dashboard" stays forbidden inside the guide too, which is why step 1 was reworded.
- **The response doc** hands Cowork what was verified (menu path, two help-centre article URLs, all five cancel conditions), what was not (the syntax), the one copy change to carry into M5 and the outreach kit, the founder's four-step check, and exactly what publishing will do.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Missing] The schedule table's scroll box was not reachable by keyboard**

- **Found during:** Task 1, on the full pure suite
- **Issue:** `tests/layout-contract.test.ts` walks every `.tsx` under `src/app` and requires every `.table-scroll` box to carry `tabIndex={0}` and an `aria-label` (WCAG 2.1.1: an `overflow-x: auto` container with no focusable descendant cannot be scrolled without a pointer in Chrome, Edge or Safari). The new wrapper had neither, so the columns the box exists to hide would have been pointer-only.
- **Fix:** `tabIndex={0} role="region" aria-label={schedule.h2}`, matching the four console tables exactly. The label is the section heading the page already prints, so no copy was invented.
- **Files modified:** `src/app/(marketing)/guides/servicem8-quote-follow-up/page.tsx`, `tests/guide-page.test.ts` (the assertion moved local too)
- **Commit:** `90a9d7d`

**2. [Rule 1 - Bug] My own test's comment-stripper ate the JSX it was asserting over**

- **Found during:** Task 1
- **Issue:** The `uncommentedTsx` shape copied from `tests/marketing-css-contract.test.ts` strips `{/* … */}` as one unit. The opening brace of a function whose first statement is a block comment also matches `\{\s*\/\*`, and the non-greedy sweep then ran to the first `*/}` in the JSX below — deleting the `h1`, the `wrap` and half the page. Four assertions failed for a reason that had nothing to do with the page.
- **Fix:** Strip block comments first, as `tests/howto-page.test.ts` does; a JSX comment becomes an inert `{}`. The trap is written into the helper's doc comment.
- **Files modified:** `tests/guide-page.test.ts`
- **Commit:** `90a9d7d`
- **Note:** the same latent bug exists in `tests/marketing-css-contract.test.ts`'s `uncommentedTsx`. It is harmless there today (no page in its walk opens a function with a comment) and fixing another suite's helper is outside this task — logged below.

**3. [Rule 3 - Blocking] Two acceptance greps counted comment text**

- **Found during:** Task 1, running the plan's own acceptance commands
- **Issue:** `grep -c 'job.contact_first' copy.ts` returned 2 and `grep -c '/audit/how-to' page.tsx` returned 1, both from doc comments (the cheatsheet list, and the sentence explaining why the guide does not link there). The tests passed because they strip comments — but the criterion is a raw grep, and the point of it is that the founder can run it.
- **Fix:** Reworded both comments to describe the other cheatsheet fields in prose and to name the how-to page without its path. The invariant is now true at the character level, not just the AST level.
- **Files modified:** `src/app/(marketing)/copy.ts`, `src/app/(marketing)/guides/servicem8-quote-follow-up/page.tsx`
- **Commit:** `90a9d7d`

### Recorded, not auto-fixed

**4. Commit attribution line.** The task brief specified `Co-Authored-By: Claude Fable 5.1`; both commits carry `Co-Authored-By: Claude Opus 5 (1M context)`, which is the model that actually did the work and the line the current session attribution mandates. Attributing work to a model that did not do it is the kind of small untruth this project's copy rules exist to prevent. (The repository's own history carries no co-author trailer at all — worth a ruling either way.)

**5. No page-level `openGraph`.** The plan said "openGraph reusing the existing OG image the other pages use". Next replaces the parent's `openGraph` object wholesale when a page declares one, so declaring it would have meant respelling `/brand/og-image.png` in a second place. The page inherits the layout's block exactly as `/audit`, `/audit/how-to` and `/privacy` do, which is the same image by the same mechanism. Noted in the page's own comment and in the response doc.

**6. `/#audit` has no matching anchor.** The copy specified it and the plan pinned it, so it ships as specified; there is no `id="audit"` on the home page, so the link lands at the top of `/` (whose first item is the same "Get the free audit" button). Flagged in the response doc for Cowork to rule on rather than silently changed.

No Rule 4 questions arose. No new dependency, no schema change, no change to any existing page.

## Verification

Task 1, local:

- `npx vitest run tests/guide-page.test.ts tests/marketing-copy.test.ts tests/marketing-metadata.test.ts tests/howto-page.test.ts tests/layout-contract.test.ts tests/marketing-css-contract.test.ts` — **151 passed**
- `npx vitest run` (bare, no `ALLOW_REMOTE_TESTS`) — **3147 passed**; the 43 file-level failures are the integration suites refusing to run against a non-local Supabase, their pre-existing behaviour on a bare run and out of scope
- `npm run typecheck`, `npm run lint`, `npx next build` — all clean; the build lists `○ /guides/servicem8-quote-follow-up` as a static route
- `grep -c 'job.contact_first' 'src/app/(marketing)/copy.ts'` → **1**
- `grep -c '/audit/how-to' 'src/app/(marketing)/guides/servicem8-quote-follow-up/page.tsx'` → **0**

Task 2, live:

- pushed `7ec1cc1..90a9d7d` then `90a9d7d..f19d734` to `main`
- production deployment **`dpl_8oji9k53pk51eeDU7v4qWfKnG7zv`** (`backdesk-e5hrozr9y`) **Ready**, 15 Sep 2026 10:38 AWST
- `https://backdesk.com.au/guides/servicem8-quote-follow-up` → **404** (the gate, live)
- `https://backdesk.com.au/audit/how-to` → 200, `https://backdesk.com.au/` → 200, `sitemap.xml` → the same four URLs as before
- `test -f docs/gtm/requests/response-phase-10-guide-page.md` → exists, and names all three candidate fields

## Owed: the founder's verification is the publish gate

Nothing else is outstanding. On the ServiceM8 trial account:

1. **Settings > ServiceM8 Add-ons** — confirm the add-on is named **Automation**.
2. **Settings > Automation > Quote Follow Up > Edit** — open the message template editor.
3. Read the **Insert Field** / field list and report the exact tokens for the customer's first name, the job or quote description, and the quote date.
4. Confirm or correct `{job.contact_first}`, `{job.description}`, `{job.quote_date}`. If the editor offers no field for one of them, that line is rewritten without it and the same wording is corrected in M5 and the outreach kit.

Publishing is then three edits in `src/app/(marketing)/copy.ts` — `GUIDE_PUBLISHED = true`, `GUIDE_PUBLISHED_ON = '<ISO date>'`, and any correction to `MERGE_FIELDS` — plus the deliberate edit to `tests/guide-page.test.ts#is unpublished today`, which exists so publication cannot happen by accident. On the next deploy the route stops 404ing, the sitemap gains the path, and the disclaimer carries the real date. The §7 acceptance screenshots follow then, because five of the six things in that set cannot be photographed while the page answers 404.

## Deferred, out of scope

- `tests/marketing-css-contract.test.ts`'s `uncommentedTsx` carries the same `{`-then-comment stripping trap described in deviation 2. It is inert against today's tree and belongs to another suite; worth a one-line fix next time that file is opened.

## Self-Check: PASSED

- `src/app/(marketing)/guides/servicem8-quote-follow-up/page.tsx` — FOUND
- `tests/guide-page.test.ts` — FOUND
- `docs/gtm/requests/response-phase-10-guide-page.md` — FOUND
- commit `90a9d7d` — FOUND (pushed, `origin/main`)
- commit `f19d734` — FOUND (pushed, `origin/main`)
- live 404 on the guide, 200 on the four existing pages — RECORDED
