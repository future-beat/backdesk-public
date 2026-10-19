---
phase: 09-landing-page-audit-intake
plan: 02
subsystem: ui
tags: [brand, css-tokens, design-system, metadata, favicon, open-graph, abn, spam-act]

requires:
  - phase: 08-rebrand
    provides: "src/core/brand.ts (the import-free name module) and tests/brand.test.ts's nine-export structural pin"
  - phase: 07-monthly-report
    provides: "tests/layout-contract.test.ts — the readFileSync CSS harness this plan's token test copies, and the A4 print rules it must not disturb"
provides:
  - "BUSINESS_ABN, BUSINESS_SUBURB, OPERATOR_LEGAL_NAME, CONTACT_EMAIL, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_E164, TAGLINE and footerIdentityLine() in src/core/brand.ts"
  - "The M1 palette live in src/app/globals.css in both colour schemes, with --surface and --accent-fg as new tokens"
  - ".button--secondary and .button--lg for the landing CTAs"
  - "public/brand/{lockup,wordmark-ink-on-paper,wordmark-paper-on-ink}.png, {mark-720,favicon}.svg, favicon.ico, apple-touch-icon.png, og-image.png"
  - "scripts/brand/render-brand-assets.sh + og-image.html — regeneration with no dependency"
  - "metadata.icons on the root layout pointing at /brand/*"
affects: [09-05 landing page, 09-06 console detail, 09-07 privacy notice, any phase rendering a footer or a dollar figure]

actuals:
  tokens: 38827
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Legal identity as brand-module constants with a null-tolerant renderer"
    - "Structural CSS contract tests (readFileSync + brace-balanced block extraction) over the token blocks"
    - "One-off asset generation by a committed shell script; outputs committed as static files"

key-files:
  created:
    - tests/brand-tokens.test.ts
    - tests/brand-assets.test.ts
    - scripts/brand/render-brand-assets.sh
    - scripts/brand/og-image.html
    - public/brand/og-image.png
    - public/brand/favicon.ico
    - public/brand/apple-touch-icon.png
  modified:
    - src/core/brand.ts
    - tests/brand.test.ts
    - src/app/globals.css
    - src/app/(console)/audits/[id]/audit.css
    - src/app/(console)/reports/[client]/[reportId]/report.css
    - src/app/(console)/audits/[id]/page.tsx
    - src/app/(console)/reports/[client]/[reportId]/page.tsx
    - src/app/layout.tsx

key-decisions:
  - "src/core/brand.ts now pins SEVENTEEN exports, not the sixteen the plan's prose said: the plan's own enumerated name list and its artifact `exports` contract both describe eight new exports on top of nine existing ones. The name list is authoritative; the count was arithmetic."
  - "BUSINESS_ABN is typed `string | null` rather than as a string literal, so 'set it to null and the segment disappears' is a real code path a type-checker enforces, not a comment."
  - "The favicon.ico is packed by fifteen lines of node in the render script instead of by `npx png-to-ico@3`: v3 appends an upscaled 256x256 UNCOMPRESSED entry to whatever it is given, producing a 285 KB favicon against a Lighthouse >= 90 mobile target. Packed directly it is 2.3 KB, and the script now fetches and installs nothing at all."
  - "apple-touch-icon.png is rendered OPAQUE on Ink rather than transparent: iOS applies its own superellipse mask and composites transparency onto black, so a rounded-corner PNG grows four black wedges on a home screen."
  - "mark-720.svg has its C2PA <metadata> blob stripped as well as favicon.svg. The plan only required it of the favicon; both are served from a world-readable directory and both carried the same 7.7 KB manifest (T-9-15)."
  - "The OG image uses the supplied lockup PNG rather than a text wordmark (09-02 action step 2 over 09-UI-SPEC C-13's pre-8-Sep wording), and the lockup's own canvas margin supplies the clear space — its background is #FAFAF7 to the byte, so it composites onto Paper seamlessly."

patterns-established:
  - "Null-tolerant identity rendering: footerIdentityLine builds an array of segments, filters the empty ones and joins — so an absent legal fact removes a segment instead of printing a placeholder. Any future optional identity fact (ACN, licence number) follows the same shape."
  - "Token blocks asserted EXHAUSTIVELY with toEqual over a parsed declaration map, not with per-token toContain: an unasserted extra token is a colour decision made outside the brand spec, and toEqual is what notices."
  - "One-off asset scripts assert their own output before exiting, because a Chrome flag that stops being honoured produces a plausible file at the wrong size and the only symptom is a cropped preview weeks later."

requirements-completed: [LAND-01, LAND-05, LAND-06]

coverage:
  - id: D1
    description: "The legal and contact identity lives in one module: ABN, suburb, operator name, email, both phone spellings and the tagline, plus a footer builder that omits the ABN segment rather than ever printing a placeholder"
    requirement: LAND-05
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#contact and legal identity (D-16, D-17)"
        status: pass
      - kind: unit
        ref: "tests/brand.test.ts#exports exactly the seventeen pinned names, in EVERY export syntax"
        status: pass
    human_judgment: false
  - id: D2
    description: "The printed audit sheet and the monthly report render the identity line from the brand module and carry no ABN digits of their own"
    requirement: LAND-05
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#the A4 footers render the identity from the module (D-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The M1 palette is live in globals.css in both colour schemes, with button labels reading --accent-fg so a dark-mode button stays legible"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/brand-tokens.test.ts#the M1 token set lives in globals.css, in both schemes (D-04)"
        status: pass
      - kind: unit
        ref: "tests/brand-tokens.test.ts#button text is paid for out of --accent-fg, not #fff (D-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The A4 sheets print their figures in Recovered green with tabular digits, and nothing else about their layout moved"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/brand-tokens.test.ts#the printed sheets carry the Recovered green and tabular figures (D-07)"
        status: pass
      - kind: unit
        ref: "tests/layout-contract.test.ts (all 25 print/console rules, unchanged)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every brand asset is served as a static file from public/brand/, at the size its platform demands, with the supplied art copied byte-identical from logo/"
    requirement: LAND-06
    verification:
      - kind: unit
        ref: "tests/brand-assets.test.ts#public/brand holds every asset the metadata points at (D-06)"
        status: pass
      - kind: unit
        ref: "tests/brand-assets.test.ts#the derived rasters decode to the sizes their platforms demand"
        status: pass
    human_judgment: false
  - id: D6
    description: "The root layout's metadata.icons points every icon at /brand/*, and the Next default favicon is gone"
    requirement: LAND-06
    verification:
      - kind: unit
        ref: "tests/brand-assets.test.ts#the root layout points every icon at /brand/ (D-18)"
        status: pass
      - kind: integration
        ref: "npm run build (24 routes compiled, no duplicate icon convention)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The OG image and the touch icon look right: Paper background, lockup top-left, tagline in Ink over two lines, backdesk.com.au bottom-right in Slate, nothing clipped; the touch icon is the mark, crisp, full-bleed"
    requirement: LAND-01
    verification:
      - kind: manual_procedural
        ref: "open public/brand/og-image.png and public/brand/apple-touch-icon.png; load any console page and check the tab icon is the Backdesk mark"
        status: pass
    human_judgment: true
    rationale: "Visual conformance to a brand spec — proportion, optical balance, whether the green rule is respected — is a judgment no structural test can make. The executor inspected both renders and they match the D-06 description, but the founder owns the identity and signs off on it."

duration: 26min
completed: 2026-09-09
status: complete
---

# Phase 09 Plan 02: Brand Identity Pass Summary

**The M1 identity applied in one pass: ABN and contact facts as brand-module constants behind a placeholder-proof footer builder, the Paper/Ink/Slate/Recovered-green palette live in both colour schemes on every existing surface, and the supplied logo art served from `public/brand/` with a 2.3 KB favicon, an opaque touch icon and a 1200×630 OG image generated by a committed dependency-free script.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-09-09T10:57:00Z
- **Completed:** 2026-09-09T11:23:00Z
- **Tasks:** 3
- **Files modified:** 26 (8 source, 3 test, 2 script, 13 asset)

## Accomplishments

- **One spelling of the legal identity.** `src/core/brand.ts` grew from nine exports to seventeen: the ASIC-issued ABN, the suburb, the operator's legal name, the contact email, the phone in both display and E.164 form, the tagline, and `footerIdentityLine(abn)`. The builder joins an array of segments and drops the empty ones, so passing `null` or `''` removes the ABN segment cleanly — there is no code path that can emit a placeholder. The printed audit sheet and the monthly report now render that line instead of typing the name themselves, and a test asserts neither page contains ABN digits or the word `ABN` anywhere.

- **The palette is live everywhere at once.** `globals.css` carries the ten M1 tokens in `:root` and all ten again in the dark block — `--surface` and `--accent-fg` are new, everything else is a value change on an existing name, so every `var(--…)` already shipped in the console, login, audit and report stylesheets picked it up with no further edits. `button` and `.button` now take their label colour from `--accent-fg`, which is the difference between Ink-on-green at 8.1:1 and white-on-green at ~2.1:1 in dark mode.

- **The A4 sheets print in brand colour with lining figures.** Both print blocks force `--accent` to `#1B7A4A`, and the hero-figure rules that used to hard-code the old blue now read `var(--accent)` — one place decides the printed colour instead of two. `font-variant-numeric: tabular-nums` on `.audit-figure dd` and `.report-figure dd`. `tests/layout-contract.test.ts` passes unchanged, which is the proof the A4 layout did not move.

- **The brand art is committed twice and generated once.** `logo/` is the source of record; `public/brand/` holds byte-identical copies plus three derived files. `scripts/brand/render-brand-assets.sh` rebuilds all three from headless Chrome, `sips` and node — no npm install, no `npx`, no network — and asserts its own output sizes before exiting.

- **Two new structural suites, 46 assertions.** `brand-tokens` parses the token blocks into maps and compares them whole (an unasserted extra token fails), pins `--accent-fg` on both button rules, pins the print accent and `tabular-nums`, and enforces a no-loose-hex rule with a documented grandfather list. `brand-assets` decodes PNG IHDR chunks and the ICO directory rather than trusting filenames, and asserts the served copies are byte-equal to `logo/`.

## Task Commits

1. **Task 1: Brand module — ABN, contact and legal constants, footerIdentityLine, and the A4 footers** — `dac95ad` (feat)
2. **Task 2: M1 tokens in globals.css both schemes, --accent-fg buttons, print accent and tabular-nums, .button--secondary / .button--lg** — `8227dcb` (feat)
3. **Task 3: Brand assets — copy logo/ into public/brand/, generate favicon.ico / apple-touch-icon / OG image, wire metadata.icons** — `4149dfa` (feat)

_All three tasks were TDD. Each commit carries its failing-test-first work and its implementation together: the plan's Task 1 action explicitly requires the export pin and the module change to land "in the same commit", and this executor runs on the main working tree, where a RED-only commit would leave `main` red for anyone who pulled between the two._

## Files Created/Modified

### Source
- `src/core/brand.ts` — eight new exports (seven constants + `footerIdentityLine`); header comment updated from nine to seventeen. Still no imports, still no string-rewriting call.
- `src/app/globals.css` — M1 token set in both schemes; `--accent-fg` on `button` and `.button`; new `.button--secondary` and `.button--lg` beside `.button-quiet`.
- `src/app/(console)/audits/[id]/audit.css`, `.../report.css` — print `:root` accent → `#1B7A4A`; hero figure reads `var(--accent)`; `tabular-nums` on the figure rules.
- `src/app/(console)/audits/[id]/page.tsx`, `.../[reportId]/page.tsx` — footers render `footerIdentityLine(BUSINESS_ABN)`; both dropped the `SERVICE_NAME` import in favour of `BUSINESS_ABN, footerIdentityLine`.
- `src/app/layout.tsx` — `metadata.icons` for the SVG, the ICO and the Apple touch icon.
- `src/app/favicon.ico` — **deleted** (Next file convention; it emitted a second `<link>` into the head).

### Assets
- `logo/backdesk-{lockup.png, wordmark-ink-on-paper.png, wordmark-paper-on-ink.png, mark-720.svg, favicon.svg}` — the five supplied files, committed as the source of record.
- `public/brand/{lockup.png, wordmark-ink-on-paper.png, wordmark-paper-on-ink.png}` — byte-identical copies.
- `public/brand/{mark-720.svg, favicon.svg}` — copies with the C2PA `<metadata>` element sliced out (7,994 → 258 bytes).
- `public/brand/favicon.ico` — 2,282 bytes, three PNG-compressed rasters at 16/32/48.
- `public/brand/apple-touch-icon.png` — 180×180, opaque Ink.
- `public/brand/og-image.png` — 1200×630, 44 KB.

### Scripts and tests
- `scripts/brand/render-brand-assets.sh`, `scripts/brand/og-image.html`
- `tests/brand-tokens.test.ts` (354 lines), `tests/brand-assets.test.ts` (29 assertions), `tests/brand.test.ts` (+125 lines)

## Decisions Made

See `key-decisions` in the frontmatter. The two worth reading in full:

**The plan's export count was off by one, and the name list is what was implemented.** 09-02 says "+7 exports, sixteen total" and its acceptance criterion expects `grep -cE "^export (const|function) "` to print 16 — but the plan's own enumerated pin lists seventeen names, and its `artifacts.exports` contract lists eight new exports against a module that had nine. Seventeen is the number that satisfies both of those; sixteen satisfies neither. Implemented as seventeen, pinned as seventeen, header comment says seventeen.

**`npx png-to-ico@3` was dropped after being run.** The plan named it and the RESEARCH audited it as legitimate — that assessment stands, this is not a supply-chain finding. It simply produces the wrong file: v3 appends an upscaled 256×256 *uncompressed* entry to whatever inputs it is given, so three small rasters came out as a 285 KB `favicon.ico`. A favicon is fetched on every cold page load and LAND-06 wants Lighthouse ≥ 90 on mobile. The ICO container is a 6-byte header plus a 16-byte entry per image, and modern browsers read PNG payloads directly, so it is packed inline in the render script: 2,282 bytes, and the script now has no network dependency and no third-party package at all.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] The plan's export count contradicted its own name list**
- **Found during:** Task 1
- **Issue:** The plan asks for "sixteen total" exports and pins a seventeen-name list; its artifact contract names eight new exports on a nine-export module. The acceptance criterion `grep -c` expecting 16 is derived from the wrong number.
- **Fix:** Implemented and pinned the seventeen enumerated names. Header comment and test title say seventeen.
- **Files modified:** `src/core/brand.ts`, `tests/brand.test.ts`
- **Verification:** `grep -cE "^export (const|function) " src/core/brand.ts` → 17; `tests/brand.test.ts` green with the structural describe unchanged in name.
- **Committed in:** `dac95ad`

**2. [Rule 1 — Bug] `npx png-to-ico@3` produced a 285 KB favicon**
- **Found during:** Task 3
- **Issue:** Run exactly as the plan specifies, png-to-ico@3 emitted four images — 48, 32, 16 and an upscaled 256×256 uncompressed entry of 270,376 bytes. The plan's own `<behavior>` requires the ICO to declare **3** images, so the tool cannot satisfy the plan as written.
- **Fix:** Packed the ICO directly in the render script (ICONDIR + three ICONDIRENTRYs + the PNG payloads). Result: 2,282 bytes, 3 images, header `00 00 01 00`.
- **Files modified:** `scripts/brand/render-brand-assets.sh`
- **Verification:** `tests/brand-assets.test.ts` decodes the directory and asserts count 3 and sizes `[[16,16],[32,32],[48,48]]`; each payload's first four bytes are the PNG signature.
- **Committed in:** `4149dfa`

**3. [Rule 1 — Bug] The 180 px touch-icon render came out as a crop, at the right size**
- **Found during:** Task 3
- **Issue:** `--window-size=180,180` is below Chrome's minimum window width; Chrome clamped the viewport and screenshotted it, yielding a 180×180 PNG that was a top-left crop of an oversized mark — a plain Ink square with one corner of the Paper bar showing. The size read-back would never have caught it: the file was exactly 180×180 and exactly wrong.
- **Fix:** Render at 720 like the favicon path already did, then `sips -z 180 180`.
- **Files modified:** `scripts/brand/render-brand-assets.sh`
- **Verification:** The regenerated PNG was opened and inspected — full-bleed Ink with the centred Paper bar.
- **Committed in:** `4149dfa`

**4. [Rule 2 — Missing critical] `mark-720.svg` also carried the C2PA manifest**
- **Found during:** Task 3
- **Issue:** The plan required the metadata strip only on `favicon.svg`, but `logo/backdesk-mark-720.svg` carries the identical 7.7 KB C2PA blob and is served from the same world-readable directory. T-9-15's disposition is `mitigate` for `public/brand/*` as a whole.
- **Fix:** Both SVGs stripped by the same slice; the asset test asserts neither contains `<metadata`, that both still declare a viewBox and the Ink rect, and that the served favicon is under a quarter of the supplied file's size.
- **Files modified:** `public/brand/mark-720.svg`, `tests/brand-assets.test.ts`
- **Committed in:** `4149dfa`

**5. [Rule 2 — Missing critical] The transparent touch-icon background**
- **Found during:** Task 3
- **Issue:** The plan describes the touch icon as "the 180 px raster" of the same transparent render used for the ICO. iOS composites a transparent `apple-touch-icon` onto black and applies its own superellipse mask, so the mark's 18 % rounded corners would appear as four black wedges on a home screen.
- **Fix:** A second wrapper page with an Ink background; the touch icon is full-bleed and iOS cuts the corner.
- **Files modified:** `scripts/brand/render-brand-assets.sh`
- **Committed in:** `4149dfa`

**6. [Rule 1 — Bug] The ABN and the brand hexes were each spelled twice**
- **Found during:** Tasks 1 and 2 (acceptance-criteria pass)
- **Issue:** The doc comment on `footerIdentityLine` quoted the rendered line including the ABN digits, and the token-block comment quoted `#1B7A4A` and `#1A7F37` while explaining the accepted collision — a second spelling in each case, exactly what both files exist to prevent, and both broke the plan's `grep -c … → 1` criteria.
- **Fix:** Both comments rewritten to describe the shape and name the tokens rather than repeat the values.
- **Files modified:** `src/core/brand.ts`, `src/app/globals.css`
- **Verification:** `grep -c "00 000 000 000" src/core/brand.ts` → 1; `grep -ci "#1B7A4A" src/app/globals.css` → 1.
- **Committed in:** `dac95ad`, `8227dcb`

### Scope boundary

Two supplied lockup variants (`backdesk-lockup-ink-transparent.png`,
`backdesk-lockup-paper-transparent.png`) arrived in `logo/` but are named by
neither D-06 nor this plan, whose acceptance criterion pins `git ls-files logo`
to five. Left untracked and logged to
[`deferred-items.md`](./deferred-items.md) for 09-05 to decide — a dark-scheme
landing header would want the transparent Paper variant.

---

**Total deviations:** 6 auto-fixed (4 bugs, 2 missing-critical).
**Impact on plan:** No scope creep. Three of the six are defects in the plan's own instructions that would have shipped a wrong artifact (a count that contradicts itself, a 285 KB favicon, a cropped touch icon); the other three are one-line corrections found by running the plan's own acceptance criteria.

## Issues Encountered

- **Node heredoc + `String.raw` ate a backtick.** The first attempt to splice the new test block in via a `node <<'NODE'` heredoc failed because the block's prose contained a backtick, which terminated the template literal. Switched to writing the block to a scratch file with a quoted heredoc and splicing with a small `.mjs` — no JS parser sees the content.
- **A stale read of `globals.css`.** The dark-scheme comment in the file says `only in :root renders`, without the backticks an earlier read appeared to show. The replace was guarded by an `includes` check and failed loudly rather than silently writing nothing.
- **40 test files fail on a bare `npm test`.** Pre-existing and unrelated: they are the integration suites, which refuse to run against the hosted Sydney Supabase without `ALLOW_REMOTE_TESTS`. The count was 40 before this plan and 40 after; test assertions went 2,561 → 2,607, all passing.

## Notes for the record

- **Render commands used:** `scripts/brand/render-brand-assets.sh` with Chrome 152.0.7977.83 at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (RESEARCH recorded 145; the script takes `CHROME=` as an override and pins nothing). `sips` for every downscale. `node` for the ICO pack and the size read-back.
- **Accepted side effect (09-UI-SPEC):** `--accent` (`#1B7A4A`) and `--ok` (`#1A7F37`) are now near-identical greens, so a console link and a healthy sync badge read as the same colour. M1 leaves ok/warn/error unchanged on purpose. **Do not "fix" this by tinting either token** — the comment in `globals.css` says so at the point of temptation.
- **M1 §5 messaging copy remains DEFERRED.** Nothing in this plan touched a cadence SMS or email string. The §5 rewrite is a separate piece of work.
- **No new npm dependency.** `package.json` is untouched.

## Verification Run

| Check | Result |
|---|---|
| `npx vitest run tests/brand.test.ts tests/brand-tokens.test.ts tests/brand-assets.test.ts tests/layout-contract.test.ts` | 4 files, **106 passed** |
| `npm test` (full, bare) | **2,607 assertions passed**; 40 integration files skipped by the remote-DB guard (unchanged from before this plan) |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm run build` | 24 routes compiled |
| OG image / touch icon visual | inspected — conform to D-06 |

## User Setup Required

None.

## Next Phase Readiness

- **09-05 (landing page)** can import `TAGLINE`, `CONTACT_EMAIL`, `CONTACT_PHONE_E164` and `footerIdentityLine` directly, use `.button--lg` for the hero CTA and `.button--secondary` beside it, and `<img src="/brand/lockup.png" alt="Backdesk">` in the header. Read `deferred-items.md` first if the header is ever on a dark surface.
- **09-07 (privacy notice)** has the same footer builder and `OPERATOR_LEGAL_NAME` for the APP 1 "who we are" section.
- **Still open for the phase:** `openGraph.images` and `twitter.card` metadata are NOT wired — 09-02 only covered `metadata.icons`. The file `public/brand/og-image.png` exists and is the right size; a later plan points `metadata.openGraph` at it. `proxy.ts`'s matcher still exempts only `favicon.ico`, so `/brand/*` must be added to the exclusion list before an unauthenticated crawler can fetch these assets on the app host (RESEARCH §1, UI-SPEC "Reachability contract").

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-09*

## Self-Check: PASSED

Every file this summary claims exists on disk (26 checked), `src/app/favicon.ico`
is confirmed gone, and all three task commits resolve in `git log`.
