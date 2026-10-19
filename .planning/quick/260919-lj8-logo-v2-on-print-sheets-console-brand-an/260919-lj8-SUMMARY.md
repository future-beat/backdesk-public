---
phase: quick
plan: "260919-lj8"
quick_id: 260919-lj8
status: complete
subsystem: ui
tags: [brand, logo, favicon, print, console-nav, css-cascade, next-metadata, proxy]

requires:
  - phase: quick-260919-kel
    provides: the logo v2 (Graphite) art in public/brand/, the scheme-scoped icon metadata, and --fg on Graphite — this task finished the three surfaces that quick listed as still on v1
provides:
  - /favicon.ico and /apple-touch-icon.png answering on both hosts, closing a carry-forward open since Phase 9
  - a BRAND_ASSET_VERSION cache buster on every icon URL, so returning browsers refetch art whose URL did not change
  - the console nav wearing the supplied lockup instead of a typeset name
  - both A4 sheets printing in Graphite with a v2 letterhead, verified through Chrome's real print path
affects: [search-result favicons, link unfurlers, the operator console, every audit and report handed to a prospect or client]

actuals:
  tokens: 16400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A scheme switch that has to survive PRINT is a CSS `display` toggle over two <img>, never a <picture> media query — measured, not assumed"
    - "When two rules fight over a property, the specificity relationship is itself a testable fact: assert the higher-specificity selector does not set the property"
    - "Numbers inside a comment are load-bearing; re-measure them when the thing they describe changes, or they mislead the next change"

key-files:
  created:
    - public/favicon.ico
    - public/apple-touch-icon.png
  modified:
    - src/app/layout.tsx
    - src/proxy.ts
    - scripts/brand/render-brand-assets.sh
    - src/app/(console)/layout.tsx
    - src/app/globals.css
    - src/app/(console)/audits/[id]/page.tsx
    - src/app/(console)/audits/[id]/audit.css
    - src/app/(console)/reports/[client]/[reportId]/page.tsx
    - src/app/(console)/reports/[client]/[reportId]/report.css
    - tests/brand-assets.test.ts
    - tests/brand-tokens.test.ts
    - tests/layout-contract.test.ts
    - tests/proxy-host-routing.test.ts

key-decisions:
  - "The sheets do NOT reuse the nav's <picture> pattern: printed from a dark-mode browser it selects the Paper lockup and puts a white wordmark on white paper (measured through Page.printToPDF)"
  - "No mark-only fallback in the nav under the phone breakpoint — the 390px measurement says the lockup costs 31px and changes nothing the contract names"
  - "The root icons carry no ?v= — they are well-known addresses with no head to read them from"
  - "The stale brand arithmetic in globals.css was re-measured and pinned in a test, because it misled this very change"

patterns-established:
  - "Print verification means Page.printToPDF with prefers-color-scheme forced dark, and then READING the PDF"
  - "A contrast claim in a comment is computed in tests/brand-tokens.test.ts, never narrated"

duration: 60min
completed: 2026-09-19
---

# Quick task 260919-lj8: logo v2 on the print sheets, the console brand, and the root favicon — Summary

The three surfaces quick-260919-kel listed as still wearing v1 now wear v2: the well-known favicon addresses answer on both hosts and browsers are made to refetch them, the console bar shows the supplied lockup instead of a typeset name, and the two A4 documents that leave the building print in Graphite under a v2 letterhead.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `0c566ec` | feat(260919-lj8): answer the root icon paths and bust the favicon cache |
| 2 | `0fc7225` | feat(260919-lj8): put the v2 lockup in the console nav |
| 3 | `2d2b8cf` | feat(260919-lj8): print the audit and the report in Graphite, with the v2 lockup |

Pushed to `main`. Production deployment `backdesk-aivd2wgm0` reached **Ready** in 52s.

## What shipped

### 1. The favicon actually changing for a returning visitor

Two independent faults, and the diagnosis in the plan was right about both.

**The root addresses 404'd.** `/favicon.ico` and `/apple-touch-icon.png` have been missing since Phase 9. Google's search-result favicon crawler, most link unfurlers, several feed readers and Safari's older touch-icon lookup request those paths **directly** and never open the document head — so the carefully scoped `icons` block was invisible to every one of them. The render script now writes both root copies, byte-identical to the `public/brand/` pair and asserted so in the script itself and in tests.

That needed a proxy change too: `favicon.ico` had been excluded from the matcher since the beginning, `apple-touch-icon.png` never was (neither file existed). Without the exclusion the console host answers a **307 to /login for an icon request** and the apex rewrites it to 404 — the well-known address stays broken on both hosts, which is the entire defect.

**The URLs never changed.** The v2 swap replaced the bytes under `/brand/favicon.*` and kept the paths, and a browser caches a favicon in its own store, outside the HTTP cache — Vercel serving `public/` immutable makes it worse. All four icon URLs now carry `?v=2` from one `BRAND_ASSET_VERSION` constant, bumped by hand when the drawing moves (not a build id or content hash, either of which would re-fetch four files on every deploy for a copy edit).

The head is still exactly four icon links — a file under `public/` emits no markup, unlike the `src/app/favicon.ico` convention that stays deliberately absent. That count is now read out of the real `metadata` object rather than grepped for.

### 2. The console nav

`{SERVICE_NAME}` in system-ui at weight 600 became the supplied lockup at 105x20, through the same `<picture>` pair as the marketing header. Above README's 100px floor, at the source's 5.236 ratio rounded exactly the way the marketing header's 147x28 already rounds it.

**The plan invited a mark-only fallback under the phone breakpoint if the lockup crowded the nav. The measurement says it does not, so there is none.** At 390px:

| | brand | row box | content | visible at rest | cut | max scroll |
|---|---|---|---|---|---|---|
| text (before) | 73.6px | 268px | 502px | Inbox Queue Audits | Reports | 234px |
| lockup (after) | 105px | 237px | 502px | Inbox Queue Audits | Reports | 265px |

The row is 31px shorter and **nothing the contract names moved**: the same three items whole, Reports still the item cut at the right edge (which is the documented scroll cue, not an accident), one 72px row, document exactly 390px, every hit box 44px, none intersecting, 4px of focus-ring headroom inside the scroll container.

**The cost, stated plainly:** the bar takes its two-line wrap fallback below ~353px, where the text brand held one line to ~322px. A 320px phone gets a 124px bar instead of 72px. 360px, 390px, 604px and 700px are all unchanged. That band is one discontinued screen size, the wrap is the fallback `globals.css` already describes and reserves for exactly this, the document never widens and every control stays reachable — so it is written into the comment with its number rather than bought back with a second identity. If a 320px device ever matters, the mark swap is the change and the number is there waiting.

The brand also joined the file's own focus-ring rule. A UA `auto` outline was tolerable around text and is not around a transparent PNG whose ink stops well inside its box.

### 3. The two sheets a prospect and a client are handed

`--fg` in both print blocks moved from `#16181d` — a near-black that is neither Ink nor Graphite, picked for print contrast before the palette had a dark of its own — to Graphite `#1A1F2B`, so the sheet and the screen it was read on are finally the same colour. Contrast is **computed** in `brand-tokens`, not narrated: 16.47:1 on white against the old 17.76:1.

Both sheets gained a letterhead above the title: 147x28 on screen, **32mm in print** against README's 24mm floor, with `height: auto` so the source's exact 1508:288 governs the one dimension that has a legal minimum. The footer identity line stays **text** — it carries a legal identifier that has to remain selectable and searchable on a document somebody may quote back at us.

**The mechanism is the interesting part, and it is measured rather than argued.** A printed page is always a light ground, but the browser still reports dark while printing — which is the entire reason these files re-declare their tokens. Printed through Chrome's real `Page.printToPDF` with the scheme forced dark:

| variant | printed result |
|---|---|
| `<picture>`, `media="(prefers-color-scheme: dark)"` — the nav's exact pattern | **Paper lockup: a white wordmark on white paper** |
| `<picture>`, `media="screen and (prefers-color-scheme: dark)"` | Graphite, correct |
| two `<img>`, toggled by CSS `display` | Graphite, correct |

The naive copy of the nav pattern would have shipped a near-invisible wordmark on the page a paying client reads, and nothing in the product would ever have reported it. The `screen and` form fixes it in Chromium, but it makes the printed identity depend on an engine re-running source selection for a print layout — a promise WebKit does not make, and this page is opened on an iPhone in a sales meeting. `display` inside `@media print` cannot be got wrong by an engine, so that is what both sheets use. Price: one extra ~34 KB PNG on an auth-gated, operator-only page that is on no performance budget.

## Deviations from plan

**1. [Rule 1 — my bug, caught by looking] Both lockups printed at once.**

`.audit-lockup img` opened with `display: block`. It is specificity (0,1,1); the two modifiers are (0,1,0). The descendant selector beat both of them, so **both drawings rendered — in every scheme and on paper**: the Graphite lockup with the Paper one ghosting underneath it on the printed sheet.

Every assertion in the new test block passed the whole time. The modifier rules existed exactly as written; they simply never won the cascade. A test that a rule EXISTS is not a test that it APPLIES. `display` is now owned by the two modifiers alone at equal specificity, and a new test pins that the sizing rule does not touch the property being fought over — the only way source-reading can close that gap.

This was found by printing the sheet to PDF and reading it, not by any test.

**2. [Rule 1 — stale comment, actively misleading] The nav's arithmetic described a bar that had not existed for weeks.**

`globals.css` sized everything against a 121px brand: "brand plus seven links measure ~497px", "the row gets 221px", "one row at every width from ~365px up". Those numbers were computed when the service carried its pre-rebrand name. The rename to "Backdesk" cut the brand to 73.6px and nobody updated the arithmetic.

**It misled this change.** I wrote a CSS comment claiming the 105px lockup "gives 16px back" because 105 < 121, committed to that reasoning, and only found out it was backwards when the harness reported the real 73.6px. Every figure is now what headless Chrome reports today, and `layout-contract` pins the re-measured numbers so the next drift fails a test instead of a reader.

**3. [Rule 3 — blocked the task] `apple-touch-icon.png` added to the proxy matcher.**

Not in the plan's file list, but the plan's `read_first` anticipated it ("check apple-touch-icon.png is reachable unauthenticated on the app host — add it to the exclusion with a routing test if not"). It was not. Anchored with `$` so nothing under a same-named path is exempted by accident — verified live: `/apple-touch-icon.png/secret` still 307s to login.

**4. [Rule 2 — the rule is wrong about this case] `no-img-element` disabled four times.**

The sheets' lockups are bare `<img>` rather than `<picture>` children, so `@next/next/no-img-element` fires (which is why the nav and marketing header never tripped it). Its advice — `next/image` — would put an optimiser in front of a committed, exactly-sized PNG with nothing left to optimise, and would emit its own `srcset`, which is the one thing that must not happen on a page whose printed size is set in millimetres against a legal minimum. Disabled per-line with that reason written above it; no repo-wide rule change.

**5. [Housekeeping] Two of my own comments tripped existing brand gates, and both gates were right.**

`tests/brand.test.ts` greps `src/` for the pre-rebrand name including comments (D-10 acceptance), and forbids a bare `ABN` in the two A4 pages (D-17, so the identifier has exactly one spelling). My explanatory comments used both. Rephrased — the gates stay as they are.

## Verification

**What was LIVE and what was HARNESS — stated plainly.**

The console and both sheets sit behind Supabase Auth on `app.backdesk.com.au` and I cannot sign in, so:

- **Live (real production, real requests):** every favicon/icon claim, on both hosts. The head's icon links. Byte-equality of the served root icons against the repo. Console gating around the new proxy exclusion.
- **Harness (real CSS + real markup, fixture data, rendered through Chrome):** the console nav geometry and appearance; both sheets on screen and through `Page.printToPDF`. The stylesheets and the markup are the actual ones — only the server data is fixture — so everything the identity depends on (which lockup is selected, its printed size, the foreground colour) is decided by the real files.
- **Not verified on a real device:** WebKit/Safari printing. The `display` mechanism was chosen precisely because it does not depend on engine behaviour WebKit leaves unspecified, but no WebKit print was actually run this task.

**Live checks** (production `backdesk-aivd2wgm0`, both hosts):

| URL | backdesk.com.au | app.backdesk.com.au |
|---|---|---|
| `/favicon.ico` | 200 `image/vnd.microsoft.icon` 1840B | 200, same, **no redirect** |
| `/apple-touch-icon.png` | 200 `image/png` 2378B | 200, same, **no redirect** |
| `/brand/favicon.ico`, `/brand/apple-touch-icon.png` | 200 | 200 |
| `/brand/{favicon.svg,mark-paper.svg,favicon.ico,apple-touch-icon.png}?v=2` | 200, correct types | — |
| `/inbox`, `/audits` | 404 (apex) | 307 → /login |
| `/apple-touch-icon.png/secret` | — | 307 → /login (exclusion is narrow) |

Live head: **exactly four** icon links, every one `?v=2`. Live `/favicon.ico` and `/apple-touch-icon.png` bytes compared with `cmp` against the committed files — identical.

**Gates.** `npm run typecheck`, `npm run lint --max-warnings=0`, `npx next build` — all clean. Bare `npx vitest run`: **3217 tests passed, 0 test failures**; 43 files fail to load, all 43 with the single pre-existing `Refusing to run integration tests against a non-local Supabase stack` refusal (one distinct error string, matching the documented baseline). No new failures.

`grep -rn "16181d" src/` returns only the two comment lines recording that the colour was replaced.

**Captures — every one opened and read, not merely produced** (not committed; under `/private/tmp/claude-501/-Users-hesamabbaszadi-Documents-Venture-building-Backdesk/da08d900-56e4-4558-9e6a-c676e30cb011/scratchpad/`):

| What | Path |
|---|---|
| Console bar, 390px light / dark | `shots/lj8-console-390-light.png`, `…-dark.png` |
| Console bar, 1280px light / dark | `shots/lj8-console-1280-light.png`, `…-dark.png` |
| **Audit sheet, printToPDF, scheme forced dark** | `shots/lj8-audit-print-dark.pdf` |
| **Report sheet, printToPDF, scheme forced dark** | `shots/lj8-report-print-dark.pdf` |
| Sheets on screen, 390px light / dark | `shots/lj8-{audit,report}-screen-{light,dark}.png` |
| The `<picture>` vs `display` print probe (the decisive one) | `shots/probe-dark.pdf` |
| Root icons at 96/32/16 and the touch icon, on light and dark chrome | `shots/lj8-root-icons.png` |

Harness sources, also under the scratchpad: `navlab/gen-nav.mjs` (the archived 07-06 nav probe with the brand swapped and a `brandWidth` readout), `navlab/gen-sheet.mjs`, `navlab/measure.sh`, `cdp-print.mjs` (`Page.printToPDF` with `prefers-color-scheme` forced), `probe-media.mjs` (computed styles across the four media/scheme combinations).

Computed-style probe on the audit sheet, all four combinations — the check that caught deviation 1 and then confirmed the fix:

| media | scheme | graphite | paper | `--fg` |
|---|---|---|---|---|
| screen | light | block, 147x28 | none | `#1A1F2B` |
| screen | dark | none | block, 147x28 | `#E9ECF1` |
| print | light | block, 120.9px (**32.0mm**) | none | `#1A1F2B` |
| print | dark | block, 120.9px (**32.0mm**) | none | `#1A1F2B` |

## Known stubs

None.

## Still on v1 — unchanged by this task, your call

The social and third-party profiles. Marketing's `logo/social-v2/` set is committed and ready; until you upload it, the Facebook page, WhatsApp Business profile and Google Business Profile still show v1 Ink. No deploy can fix that one — carried forward from quick-260919-kel unchanged.

## Self-Check: PASSED

- `public/favicon.ico` and `public/apple-touch-icon.png` verified present on disk and byte-identical to their `public/brand/` counterparts (asserted by the suite, which passed).
- Commits `0c566ec`, `0fc7225` and `2d2b8cf` verified present in `git log` and on `origin/main` (`main -> main 9a42352..2d2b8cf`).
- Production `backdesk-aivd2wgm0` verified **Ready** via `vercel ls backdesk`.
- Live URLs verified 200/307/404 as tabled above; two live assets verified byte-identical to the committed files with `cmp`.
- Every capture listed above was opened and read. The two PDFs were read twice — once showing the ghosting bug, once showing it fixed.
