---
phase: 09-landing-page-audit-intake
plan: 05
subsystem: ui
tags: [nextjs, app-router, next-font, metadata, open-graph, robots, sitemap, css, accessibility, privacy, spam-act]

requires:
  - phase: 09-landing-page-audit-intake
    provides: "09-01's `(marketing)` route group, the one-file copy module and the `/audit` form this plan completes; 09-02's M1 tokens in globals.css, the seventeen brand exports (ABN, contact pair, TAGLINE, footerIdentityLine) and the committed `/brand/*` assets; 09-03's 4 MiB cap and the honeypot markup; 09-04's host-aware proxy, which is why `/` is a free route at all"
  - phase: 08-brand-and-domains
    provides: "app.backdesk.com.au on the `backdesk` Vercel project — the host these pages are live on before the apex DNS cut-over"
provides:
  - "`src/app/(marketing)/page.tsx`: the eight-section landing page in the D-09 order, one h1, six h2, one green action rendered twice"
  - "`src/app/(marketing)/copy.ts`: LANDING_COPY, PRIVACY_COPY and METADATA_COPY beside the form and thanks copy — the ONE file the 11 Sep Cowork copy request replaces"
  - "`src/app/(marketing)/marketing.css`: the public stylesheet on the M1 tokens (64px header, 38em measure, steps, tier cards, callouts, footer, form field anatomy on --muted borders); no hex literal, no motion"
  - "`src/app/(marketing)/fonts.ts`: Inter 400/600/700 + Inter Tight 700 self-hosted at build, scoped to the marketing subtree"
  - "`src/app/(marketing)/layout.tsx`: the lockup header switching artwork on prefers-color-scheme, metadataBase + OG image + Twitter card, and the footer identity line with mailto:/tel:"
  - "`src/app/(marketing)/privacy/page.tsx`: the seven-section APP 1/5 notice with the pinned residency and offshore-processor sentences and the 30-day upload retention"
  - "`src/app/robots.ts` and `src/app/sitemap.ts`: static, apex-addressed, console paths disallowed"
  - "noindex on the console layout, the login page and /audit/thanks"
  - "`public/brand/lockup-{ink,paper}-transparent.png` served, both committed under `logo/` (seven sources)"
  - "tests: marketing-copy (the D-09 voice contract over every string leaf), privacy-page, marketing-metadata"
affects: [09-06 console detail and pre-fill, 09-07 apex DNS cut-over, 09-08 copy swap and Lighthouse, 10 go-live]

actuals:
  tokens: 33408
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A copy module with a voice contract as a test: every string leaf of every export is walked for a forbidden-word list, punctuation rules and a single locked disclosure phrase, so a wholesale copy swap is reviewed by CI rather than by memory"
    - "Comment-stripped negative gates (the layout-contract rule) so a file may explain why it does NOT call the thing a test forbids"
    - "Art direction by `<picture>` + prefers-color-scheme over committed transparent PNGs: one file fetched, no filter, no redraw, no runtime image work"
    - "Metadata asserted by importing the page module rather than grepping it — `index: false` and `follow: false` read identically to a regex"

key-files:
  created:
    - src/app/(marketing)/fonts.ts
    - src/app/(marketing)/marketing.css
    - src/app/(marketing)/page.tsx
    - src/app/(marketing)/privacy/page.tsx
    - src/app/robots.ts
    - src/app/sitemap.ts
    - public/brand/lockup-ink-transparent.png
    - public/brand/lockup-paper-transparent.png
    - logo/backdesk-lockup-ink-transparent.png
    - logo/backdesk-lockup-paper-transparent.png
    - tests/marketing-copy.test.ts
    - tests/privacy-page.test.ts
    - tests/marketing-metadata.test.ts
  modified:
    - src/app/(marketing)/layout.tsx
    - src/app/(marketing)/copy.ts
    - src/app/(marketing)/audit/page.tsx
    - src/app/(marketing)/audit/thanks/page.tsx
    - src/app/(marketing)/audit/form.tsx
    - src/app/(console)/layout.tsx
    - src/app/login/page.tsx
    - tests/brand.test.ts
    - tests/brand-assets.test.ts

key-decisions:
  - "The header lockup is the two SUPPLIED TRANSPARENT variants behind a `<picture>` media pair, not the opaque `lockup.png` the plan pinned: the opaque canvas is Paper to the byte, so a dark-scheme header would have shown a Paper card floating on an Ink bar. Both variants are now committed sources (logo/ holds seven files, not five)."
  - "The lockup renders 147x28 inside 18px vertical padding, not the plan's 164x60 inside 2px. The numbers are derived from the transparent asset, which is cropped tight and therefore brings no clear space of its own: measured word share 0.804 of 1152px (word at x 226-1151), cap height 161 of 220 rows. At 147px the word is ~118px (D-06 floor is 96px) and the padding supplies ~21.4px of clear space against a ~20.5px cap. The header is still exactly 64px."
  - "The footer is `footerIdentityLine(BUSINESS_ABN).split(' · ')` with the email and phone segments matched BY VALUE against the constants, rather than a second segment array built beside the builder (which is what the plan's action text suggested). One spelling of the line survives; `tests/marketing-metadata.test.ts` pins the split so a separator change fails a test instead of silently rendering one flat unlinked string."
  - "Pipeline Manager's Included list is the 9 September offer-sheet sentence (one line: everything in Quote Chaser plus reactivation, invoice chasing and review requests), not the UI-SPEC's transcribed four bullets — the last of which promised founding clients the extras first, a promise the current docx has withdrawn (D-08)."
  - "Internal links in the marketing tree are `next/link`, not plain anchors: `@next/next/no-html-link-for-pages` is an ERROR in this project's config and `--max-warnings=0` also rejects an unused disable directive, so the plan's `<a href=\"/\">` could not ship."
  - "METADATA_COPY.audit and .thanks reference AUDIT_FORM_COPY and THANKS_COPY instead of restating their title/description pairs — the page heading and the search result should not be able to drift apart."
  - "Negative structural gates strip comments before matching (the tests/layout-contract.test.ts precedent). A file that explains why it never calls `getServerEnv()` or `headers()` must not be failed by its own explanation; the source comments were also reworded so the plan's raw greps still return 0."

patterns-established:
  - "Voice-contract test over a copy module: flatten every string leaf with its path, then assert the forbidden list, the single disclosure phrase, punctuation, spelling and the figures. The path in the failure names the sentence, not the offence."
  - "Public pages carry their own gutter (`.wrap`) because the marketing `main` resets the console's padding and max-width; a new marketing page that forgets it sits against the screen edge."

requirements-completed: [LAND-01, LAND-05]

coverage:
  - id: D1
    description: "The landing page presents the offer in the D-09 order (positioning, four steps, the two tiers with $597/$997/$990 and the founding five $297, the guarantee, Your customers your name with the residency sentence, A good fit, How to start) with one green action rendered twice"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/marketing-copy.test.ts#the landing page renders the sections in the D-09 order"
        status: pass
      - kind: unit
        ref: "tests/marketing-copy.test.ts#the offer is on the page, in the M2 numbers (LAND-01, D-09)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every public string lives in copy.ts, in the M1 voice: no forbidden word, no competitor domain, no em dash or exclamation mark, and 'Run by AI, checked by a human' exactly once"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/marketing-copy.test.ts#the D-09 voice rules hold over every string (LAND-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "/privacy is a real APP 1/5 notice: seven sections in order, Supabase Sydney and the Resend/ClickSend/Anthropic offshore sentence byte for byte, the 30-day upload retention, contact details, linked from the form's consent line before submission"
    requirement: LAND-05
    verification:
      - kind: unit
        ref: "tests/privacy-page.test.ts#the two load-bearing sentences, byte for byte (T-9-28, LAND-05)"
        status: pass
      - kind: unit
        ref: "tests/privacy-page.test.ts#the retention promises are stated as periods a reader can hold us to"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every public page carries title, description, canonical, Open Graph (og-image.png 1200x630 absolute) and twitter summary_large_image; robots.txt allows the three public paths and disallows the console; sitemap.xml lists the three apex URLs; console, login and /audit/thanks are noindex"
    requirement: LAND-06
    verification:
      - kind: unit
        ref: "tests/marketing-metadata.test.ts#robots.txt lets the public site in and keeps the console out (D-18)"
        status: pass
      - kind: unit
        ref: "tests/marketing-metadata.test.ts#every public page carries its own title, description and canonical"
        status: pass
      - kind: integration
        ref: "curl https://app.backdesk.com.au/{robots.txt,sitemap.xml} — 200, rules and three apex URLs as written"
        status: pass
    human_judgment: false
  - id: D5
    description: "The site builds statically: /, /audit, /audit/thanks, /privacy, /robots.txt and /sitemap.xml are prerendered, with no route conflict at /, and the fonts are self-hosted from /_next/static/media with no third-party request on the page"
    requirement: LAND-06
    verification:
      - kind: integration
        ref: "npx next build — route table shows the six as ○ (static)"
        status: pass
      - kind: integration
        ref: "curl -H 'Host: apex.localhost' http://127.0.0.1:3117/ — only backdesk.com.au appears as an external host; @font-face src resolves to /_next/static/media"
        status: pass
    human_judgment: false
  - id: D6
    description: "The rendered page reads correctly on a phone in both colour schemes: no horizontal scroll at 390px, the lockup crisp and switching with the scheme, prices aligned and green, the footer line with ABN and working mailto:/tel:, and a link preview showing the OG image"
    requirement: LAND-01
    verification: []
    human_judgment: true
    rationale: "Visual and device behaviour: colour-scheme switching, tap targets, reflow and a third-party link-preview render cannot be proven by a structural test. Blocked from the app host for `/` (see Issues) — do it on the apex after 09-07, or locally against apex.localhost."

duration: 32min
completed: 2026-09-09
status: complete
---

# Phase 9 Plan 05: Landing page, privacy notice and metadata Summary

**The public site is real: the M2 offer laid out for a phone in the M1 tokens and self-hosted Inter, every string in one guarded module, a working APP 1/5 privacy notice, and static robots/sitemap/OG metadata — all six public routes prerendered and live on the app host.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-09-09T12:44Z
- **Completed:** 2026-09-09T13:16Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 22 (13 source, 5 tests, 4 assets)

## Accomplishments

- `/` renders the offer sheet as a phone page: eyebrow, the tagline as `h1`, the positioning lede carrying the one AI disclosure, four numbered steps, two tier cards with green tabular figures, the founding-five callout, the guarantee in an Ink-bordered callout, the four "Your customers, your name" paragraphs ending in the residency sentence that links the notice, "A good fit", and a closing "How to start" with the same green action.
- Every public string is in `src/app/(marketing)/copy.ts` and guarded by `tests/marketing-copy.test.ts`, which walks each string leaf for the D-09 forbidden list, the single `Run by AI, checked by a human`, no em dash, no exclamation mark, the exact spellings, the four figures and the absence of any domain but ours. The 11 September Cowork copy request is now a one-file swap that CI reads.
- The header shows the supplied lockup in both colour schemes through a `<picture>` media pair over two transparent PNGs, sized from the WORD (147x28 puts it at ~118px, above the 96px floor) inside 18px of clear space, header height exactly 64px.
- `/privacy` states, in plain sentences, what is collected (including what a ServiceM8 export contains and the hashed connection identifier), why, that storage is Supabase Sydney, that Resend, ClickSend and Anthropic process content outside Australia, the 30-day life of an uploaded export, 12 months for request details, 7 years for financial records, the access/correction path and the OAIC route.
- Metadata is complete and absolute: `metadataBase` on the apex, OG image 1200x630 with alt text, `summary_large_image`, per-page canonicals, `title.absolute` on `/`; `robots.txt` allows the three public paths and disallows eight console prefixes; `sitemap.xml` lists three apex URLs; the console layout, `/login` and `/audit/thanks` are `noindex`.
- The build reports `/`, `/audit`, `/audit/thanks`, `/privacy`, `/robots.txt`, `/sitemap.xml` as static, and the served page references no host but `backdesk.com.au` — the fonts come from `/_next/static/media`.

## Task Commits

1. **Task 1: Fonts, marketing.css, the full layout, copy.ts and the landing page** — `f5f0fcb` (test, RED) → `3a9d120` (feat, GREEN)
2. **Task 2: Privacy notice, page metadata, robots.ts, sitemap.ts, console/login noindex, the build** — `c67bcd0` (test, RED) → `026c9e6` (feat, GREEN)

Pushed to `main` at `026c9e6`; production redeployed and answered.

## Files Created/Modified

- `src/app/(marketing)/fonts.ts` — Inter 400/600/700 and Inter Tight 700, self-hosted at build, scoped to this subtree so no console bundle pays for a webfont
- `src/app/(marketing)/marketing.css` (515 lines) — the public stylesheet: header, hero, steps, tiers, callouts, footer, form field anatomy on `--muted` borders, focus rings; every colour a `var(--…)`, zero hex, nothing that moves
- `src/app/(marketing)/layout.tsx` — the two-scheme lockup header, the OG/Twitter metadata, the footer identity line with `mailto:` and `tel:`
- `src/app/(marketing)/copy.ts` — LANDING_COPY, PRIVACY_COPY, METADATA_COPY; THANKS_COPY's contact literals replaced by the brand constants
- `src/app/(marketing)/page.tsx` — the eight sections
- `src/app/(marketing)/privacy/page.tsx` — the seven-section notice
- `src/app/robots.ts`, `src/app/sitemap.ts` — static, apex-addressed
- `src/app/(marketing)/audit/{page,thanks/page,form}.tsx` — canonicals, metadata from METADATA_COPY, the page gutter, and the honeypot rule moved out of its inline style
- `src/app/(console)/layout.tsx`, `src/app/login/page.tsx` — `robots: { index: false, follow: false }`
- `tests/{marketing-copy,privacy-page,marketing-metadata}.test.ts` — 59 new assertions; `tests/brand{,-assets}.test.ts` extended

## Decisions Made

See `key-decisions` in the frontmatter. The two that change what a later plan will see:

1. **The lockup pin moved.** `logo/` is now seven files and `public/brand/` ten; the header numbers are `147x28` with `padding: 18px 20px`, not the plan's `164x60` with `padding: 2px 20px`. The three acceptance-criteria greps that named the old pair are superseded by this measurement, which is recorded in both the CSS comment and `tests/brand-assets.test.ts`.
2. **`/` is not reachable on the app host.** 09-04 gave app-host `/` to the console, so the landing page can only be looked at on the apex (after 09-07) or locally against `apex.localhost`. `/audit` and `/privacy` do render publicly on the app host today.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] The header lockup would have been a Paper card on an Ink bar in dark mode**
- **Found during:** Task 1
- **Issue:** The plan pinned `public/brand/lockup.png`, whose canvas is opaque Paper (`#FAFAF7` to the byte). Both colour schemes are mandatory (D-04), and on a dark-scheme phone that renders as a light rectangle floating in the header.
- **Fix:** Committed the two supplied transparent variants as sources and served them from `/brand/`; the header is a `<picture>` with a `(prefers-color-scheme: dark)` source, so exactly one file is fetched and neither is filtered or redrawn. Re-derived the sizing from the transparent asset's measured geometry (see below) and extended `tests/brand-assets.test.ts` to enumerate seven sources, the 1152x220 byte-identical copies, and the header's use of both.
- **Files modified:** `src/app/(marketing)/layout.tsx`, `src/app/(marketing)/marketing.css`, `logo/backdesk-lockup-{ink,paper}-transparent.png`, `public/brand/lockup-{ink,paper}-transparent.png`, `tests/brand-assets.test.ts`
- **Verification:** `tests/brand-assets.test.ts` (35 assertions, green); the served HTML carries both sources and `width="147" height="28"`.
- **Committed in:** `f5f0fcb`, `3a9d120`

**2. [Rule 1 - Bug] The plan's 164x60 / 2px-padding header does not hold for the transparent art**
- **Found during:** Task 1
- **Issue:** The plan's numbers were derived from the opaque 1472x540 lockup, whose canvas margin supplies the M1 §4 clear space. The transparent variants are cropped tight (measured: content rows 27-190 of 220, word at x 226-1151 = 0.804 of the width, cap height 161 rows), so at 2px padding the wordmark would have had ~5px of clear space against a ~44px cap.
- **Fix:** 147x28 image inside `padding: 18px 20px`. Word renders ~118px (D-06 floor 96px), clear space ~21.4px against a ~20.5px cap, header 18+28+18 = 64px at every breakpoint. Numbers pinned in the CSS, on the `<img>` element and in the asset test.
- **Files modified:** `src/app/(marketing)/marketing.css`, `src/app/(marketing)/layout.tsx`, `tests/brand-assets.test.ts`
- **Verification:** measured by decoding the PNGs (alpha column/row profile) before choosing the numbers; served HTML and CSS agree.
- **Committed in:** `3a9d120`

**3. [Rule 3 - Blocking] `/audit` and `/audit/thanks` lost their gutter when the marketing `main` reset landed**
- **Found during:** Task 1
- **Issue:** `marketing.css` sets `.marketing main { padding: 0; max-width: none }` so landing sections can run edge to edge with their own `.wrap`. That removed the console `main`'s 20px padding from the two pages 09-01 shipped, putting the form against the screen edge.
- **Fix:** Both pages wrap their content in `.wrap.measure`, and the pattern is recorded in `patterns-established`.
- **Files modified:** `src/app/(marketing)/audit/page.tsx`, `src/app/(marketing)/audit/thanks/page.tsx`
- **Verification:** rendered locally against `apex.localhost`; `npm run lint`, `npm run typecheck`, `npx next build` green.
- **Committed in:** `3a9d120`

**4. [Rule 3 - Blocking] The plan's plain `<a href="/">` fails this project's lint gate**
- **Found during:** Task 1
- **Issue:** `@next/next/no-html-link-for-pages` is an error under `eslint-config-next/core-web-vitals`, and `--max-warnings=0` additionally rejected the `no-img-element` disable directive the plan implied would be needed (that rule does not fire here).
- **Fix:** Internal marketing links use `next/link`; the unused disable directive was replaced by a plain explanatory comment on the `<img>`.
- **Files modified:** `src/app/(marketing)/layout.tsx`, `src/app/(marketing)/page.tsx`
- **Verification:** `npm run lint` clean.
- **Committed in:** `3a9d120`

**5. [Rule 3 - Blocking] Structural gates were failing on the comments that explain them**
- **Found during:** Tasks 1 and 2
- **Issue:** `tests/marketing-copy.test.ts` forbids `'use server'` and `getServerEnv` in the marketing tree, and `tests/marketing-metadata.test.ts` forbids `headers()` in robots/sitemap — each of which the files' own headers name while explaining why they are absent.
- **Fix:** Both suites strip block and line comments before the negative matches (the `tests/layout-contract.test.ts` precedent, cited in the code), and the source comments were reworded so the plan's raw `grep` acceptance criteria still return 0.
- **Files modified:** `tests/marketing-copy.test.ts`, `tests/marketing-metadata.test.ts`, `src/app/(marketing)/{copy.ts,layout.tsx}`
- **Verification:** suites green; `grep -c "getServerEnv"` returns 0 on all three named files.
- **Committed in:** `3a9d120`, `026c9e6`

**6. [Rule 2 - Missing Critical] The honeypot's inline style outlived its reason**
- **Found during:** Task 1
- **Issue:** 09-03 left the `.hp` rule inline with a note that it should move once `marketing.css` existed. Leaving both would have been two spellings of the same rule, with the inline one silently winning.
- **Fix:** `.hp` is in `marketing.css`; the inline style is gone and the comment updated. (`audit/form.tsx` was not in this plan's `files_modified`; 09-03's summary asked for exactly this, conditioned on the stylesheet landing.)
- **Files modified:** `src/app/(marketing)/audit/form.tsx`, `src/app/(marketing)/marketing.css`
- **Verification:** `tests/audit-request-action.test.ts` and the console/lint suites green; the decoy still renders off-screen in the served HTML.
- **Committed in:** `3a9d120`

### Planned-work adjustments (not auto-fixes)

- **`PRIVACY_COPY` was drafted whole in Task 1's commit** rather than as a skeleton in Task 1 and paragraphs in Task 2. It is copy, and it belongs in the copy commit; Task 2 still owns the page and its test.
- **The footer splits `footerIdentityLine(BUSINESS_ABN)`** rather than rebuilding the segment array beside the builder, which the plan's action text preferred. Rationale and the test that makes the split safe are in `key-decisions`.
- **`METADATA_COPY.audit` / `.thanks` reference the existing copy objects** instead of restating the four title/description pairs.

---

**Total deviations:** 6 auto-fixed (2 missing critical, 1 bug, 3 blocking) plus 3 planned-work adjustments.
**Impact on plan:** No scope creep. Four of the six were forced by facts the plan could not see (the opaque canvas, the cropped art's geometry, the lint config, the comment-vs-gate collision); the other two were consequences of this plan's own CSS and a hand-off 09-03 asked for.

## Issues Encountered

1. **`/` cannot be reviewed on the app host.** The plan's human-check says to open `https://app.backdesk.com.au/`; 09-04 made that path the console (measured: 307 to `/login` when signed out). `/audit`, `/privacy`, `/robots.txt`, `/sitemap.xml` and `/brand/*` all return 200 there. The landing page was verified locally against `apex.localhost` on a production build; the phone check belongs on the apex after 09-07.
2. **One unaudited `npx` fetch.** `npx prettier --write` was run once on `audit/thanks/page.tsx` to reformat an edit; prettier is not a dependency of this repo, so npx fetched it into its cache. Nothing was written to `package.json` or the lockfile, and prettier's no-config defaults rewrote the file to double quotes, which was reverted by hand to the house style. It should not have been run — recorded here rather than quietly; no further `npx` package fetches were made.
3. **`npm test` (bare) reports 40 failed FILES and 0 failed tests.** Pre-existing and expected: those suites refuse to run without a local Supabase stack or `ALLOW_REMOTE_TESTS`. 2,829 tests pass. The pure suites touching this plan's surfaces were run explicitly and are green.

## Live checks recorded

Against `https://app.backdesk.com.au` after the push of `026c9e6`:

| Path | Result |
|------|--------|
| `/` | 307 (console host: proxy rewrites to `/clients`, session gate redirects) |
| `/audit`, `/audit/thanks`, `/privacy` | 200 |
| `/robots.txt` | 200, rules exactly as written, `Sitemap: https://backdesk.com.au/sitemap.xml` |
| `/sitemap.xml` | 200, three apex URLs |
| `/brand/lockup-ink-transparent.png`, `/brand/lockup-paper-transparent.png`, `/brand/og-image.png` | 200 |

Locally, on a production build served at `apex.localhost`: `/` 200 with the full `<title>`, description, canonical, og:image (absolute, 1200x630, alt) and `twitter:card`; one `h1`, six `h2`, two `button--lg`; the footer rendering `Backdesk · ABN 00 000 000 000 · Perth WA · mailto: · tel:`; `@font-face` sources under `/_next/static/media`; no external host referenced but `backdesk.com.au`.

## Known Stubs

None. Every string on every public page is real copy from the M2 offer sheet or the drafted notice; no placeholder, no "coming soon", no component wired to empty data.

## Open items for later plans

- **LAND-06's Lighthouse half is not measured.** The requirement is already ticked in REQUIREMENTS.md (before this plan ran); the metadata half is now true and tested, the ≥ 90 mobile performance/accessibility numbers are 09-08's to record.
- **The phone check in both schemes and the link-preview render (D6 above)** need a human on the apex after 09-07.
- **The 11 September Cowork copy request** replaces `src/app/(marketing)/copy.ts` and nothing else; `tests/marketing-copy.test.ts` re-reads it whole.

## Next Phase Readiness

- 09-06 (console request detail and pre-fill) is unblocked: nothing in this plan touched `audits/new`, the request detail or `tests/console-error-leak.test.ts`.
- 09-07 (apex DNS) now has a finished site to expose: the moment `backdesk.com.au` resolves to Vercel, `/`, `/audit` and `/privacy` are the pages that answer.
- 09-08 has a one-file copy swap and a page that already builds statically to measure.

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-09*

## Self-Check: PASSED

Every file named in `key-files.created` exists on disk, and all four task commits
(`f5f0fcb`, `3a9d120`, `c67bcd0`, `026c9e6`) are in the history and pushed.
