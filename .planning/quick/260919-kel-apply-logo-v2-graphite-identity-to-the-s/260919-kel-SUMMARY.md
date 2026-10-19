---
phase: quick
plan: "260919-kel"
quick_id: 260919-kel
status: complete
subsystem: ui
tags: [brand, logo, favicon, open-graph, css-tokens, marketing-site, next-metadata]

requires:
  - phase: 09 (marketing site)
    provides: the served-brand contract (public/brand/, render-brand-assets.sh, og-image.html, brand-assets.test.ts) that this swap rewrote
provides:
  - public/brand/ serving the logo v2 (Graphite) set as byte-identical copies of logo/
  - a scheme-scoped favicon pair, solving v2's transparent mark being invisible on dark browser chrome
  - favicon.ico / apple-touch-icon.png rasterised from the supplied Graphite tile
  - a recomposed 1200x630 Open Graph image, measured off the v2 canvas
  - --fg moved from Ink #14213D to Graphite #1A1F2B, with the contrast claim now computed in tests
affects: [marketing site, link previews, any future brand or palette change, social profiles]

actuals:
  tokens: 11800
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Supplied art is copied byte-identical; problems with it are solved in metadata or in the raster source, never by editing the drawing"
    - "Colour-pair contrast is computed in the test suite rather than asserted in a comment"

key-files:
  created:
    - public/brand/lockup-graphite-transparent.png
    - public/brand/lockup-paper-transparent.png
    - public/brand/wordmark-graphite-transparent.png
    - public/brand/wordmark-paper-transparent.png
    - public/brand/mark-graphite.svg
    - public/brand/mark-paper.svg
    - public/brand/profile-720.svg
    - logo/ (the v2 set as supplied, 11 files incl. README.txt)
  modified:
    - src/app/layout.tsx
    - src/app/(marketing)/layout.tsx
    - src/app/(marketing)/marketing.css
    - src/app/globals.css
    - scripts/brand/render-brand-assets.sh
    - scripts/brand/og-image.html
    - tests/brand-assets.test.ts
    - tests/brand-tokens.test.ts

key-decisions:
  - "The icons are rasterised from the supplied profile-720.svg tile, not from favicon.svg: v2's mark is bare and transparent, so a straight raster is invisible on a dark tab strip"
  - "The dark-chrome favicon problem is solved in Next metadata (two media-scoped SVG icons), because logo/README.txt forbids recolouring the art"
  - "The OG composition's geometry was re-measured off the v2 canvas rather than adapted from v1's numbers, which describe a different drawing on a different canvas"
  - "The served SVGs keep the supplied C2PA manifest — v1 stripped it; see Deviations"
  - "The 3696px opaque lockups are never served; the OG page reads one out of logo/ on a workstation"

patterns-established:
  - "public/brand/ naming = supplied name minus the backdesk- prefix, enforced by a byte-equality test per pair"
  - "Exhaustive readdirSync assertions on public/brand and logo, so a stray file in a world-readable directory fails a test"

duration: 55min
completed: 2026-09-19
---

# Quick task 260919-kel: apply logo v2 (Graphite) to the site — Summary

Marketing's logo v2 (Graphite #1A1F2B on Paper #FAFAF7, Archivo 700 lowercase wordmark) is now what the site serves, what the browser tab shows, what a link preview renders, and what the body text is painted in — replacing v1's Ink navy, rounded tile and capitalised Inter Tight wordmark.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `c0a9c17` | feat(260919-kel): serve the logo v2 (Graphite) art, icons and OG image |
| 2 | `f615b45` | feat(260919-kel): move the light foreground from Ink to Graphite |
| 3 | `d95c084` | fix(260919-kel): accept marketing's v2 social set; stop the listing test failing on it |

Pushed to `main`. Production deployments `backdesk-h5qr7dkqg` (after commit 2) and `backdesk-bvxd4l7rb` (after commit 3) both reached **Ready** (~30s builds). Live checks below were run against both.

## What shipped

**Served assets.** `public/brand/` holds eight byte-identical copies of `logo/` (source name minus the `backdesk-` prefix) plus three derived rasters. The five v1 served files are removed. The two 3696x928 opaque lockups are deliberately *not* served — the OG composition reads `logo/backdesk-lockup-on-paper.png` directly, on a workstation, so no browser is ever asked for 93 KB (LAND-06).

**Header.** `<picture>` switches `lockup-graphite-transparent.png` (light) against `lockup-paper-transparent.png` (dark) at 147x28. v2 kept v1's canvas ratio to four decimal places (1508/288 = 1152/220 = 5.236), so the swap moved no pixel of the bar. The word spans 0.808 of the source, rendering ~119px — above D-06's 96px floor.

**Icons — the one real design problem in this task.** v1's `favicon.svg` drew its own Ink tile behind the mark, so any raster of it was legible anywhere. v2's is the *bare* Graphite mark on a transparent ground: a #1A1F2B shape on a dark tab strip is an empty tab. Recolouring supplied art is forbidden, so the fix is split across the two places that can take it without touching a drawing:

- **Metadata:** `icons.icon` now declares `favicon.svg` scoped to `(prefers-color-scheme: light)` and `mark-paper.svg` — the same two paths in #FAFAF7 — scoped to dark, with the `.ico` still behind them as the fallback for anything that ignores `media`.
- **Raster source:** `favicon.ico` and `apple-touch-icon.png` are now rendered from the supplied `profile-720.svg` (a full-bleed Graphite square with the Paper mark at 56%), which reads on light chrome, dark chrome and an iOS home screen alike.

**OG image.** Every number in `og-image.html` was re-measured. v1's geometry (canvas 1472x540, ink at x=160, y=187..349, rendered at 212px with -73/-63 margins) describes a different drawing; v2's canvas is 3696x928 with ink at x=1108, y=351..563. The recomputed composition (`height: 279px; margin: -105px 0 -35px -333px`) lands the ink at **(80, 81), 451x63** against v1's **(80, 81), 456x64** — the same optical size and position, verified by decoding both PNGs.

**Render script.** New inputs and raster source, Graphite background, and `file://` URLs percent-encoded through a `url_for` helper — the repo moved under `Venture building` on 17 Sep, and an unencoded space would have made Chrome render `about:blank` into a plausible, blank PNG. This was latent: the script had not been run since the move.

**Token.** `--fg: #1A1F2B` in the light scheme, pinned in `tests/brand-tokens.test.ts` with its reason. The dark scheme is untouched.

## Verification

**Tests.** `brand-assets` (56), `brand-tokens` (28), `marketing-metadata`, `layout-contract`, `marketing-css-contract` — all green. Bare `npx vitest run`: **3187 tests passed, 0 test failures**; 43 files fail to load, all 43 with the single pre-existing `Refusing to run integration tests against a non-local Supabase stack` refusal (confirmed by counting distinct error strings). No new failures.

`npm run typecheck`, `npm run lint --max-warnings=0`, `npx next build` — all clean.

Acceptance greps: `grep -rniE "#14213d|lockup-ink|mark-720|wordmark-ink-on-paper|wordmark-paper-on-ink" src scripts public tests/brand-assets.test.ts` → no matches. `grep -c 1A1F2B src/app/globals.css` → 1; `grep -ci 14213d src/app/globals.css` → 0.

**Live (https://backdesk.com.au).**

| URL | Result |
|---|---|
| `/brand/favicon.svg`, `mark-paper.svg`, `profile-720.svg` | 200, `image/svg+xml` |
| `/brand/lockup-graphite-transparent.png`, `lockup-paper-transparent.png` | 200, `image/png` |
| `/brand/favicon.ico`, `apple-touch-icon.png`, `og-image.png` | 200 |
| `/brand/lockup-ink-transparent.png`, `lockup.png`, `mark-720.svg` | **404** |

Live bytes compared byte-for-byte against the committed files for five assets — identical. The live `<head>` carries both media-scoped icon links, the `.ico` and the apple-touch icon, plus `og:image` at 1200x630.

**Screenshots inspected** (all captured with real device emulation and *looked at*, not just produced):

| What | Path |
|---|---|
| Home header, 390px light | `…/scratchpad/shots/home-390-light.png` |
| Home header, 390px dark | `…/scratchpad/shots/home-390-dark.png` |
| Home header, 1280px light | `…/scratchpad/shots/home-1280-light.png` |
| Home header, 1280px dark | `…/scratchpad/shots/home-1280-dark.png` |
| Guide page top, 390px | `…/scratchpad/shots/guide-390-light.png` |
| Tab icons on light + dark chrome | `…/scratchpad/shots/icons-both-chromes.png` |
| favicon.ico 48px and 16px rasters | `…/scratchpad/shots/ico-48-zoom.png`, `ico-16-zoom.png` |
| apple-touch-icon.png, og-image.png | read directly from `public/brand/` and from the live URL |

(Full scratchpad prefix: `/private/tmp/claude-501/-Users-hesamabbaszadi-Documents-Venture-building-Backdesk/da08d900-56e4-4558-9e6a-c676e30cb011/scratchpad/`)

What the captures show: the Graphite lockup on Paper and the Paper lockup on the dark ground, at both widths, switching correctly; the guide page matching; both SVG icons legible on their intended chrome; the 48px `.ico` raster crisp and the 16px soft but recognisable (inherent at 16px, unchanged from v1); the OG image with the lowercase Graphite lockup left-aligned at the 80px margin.

## Deviations from plan

**1. [Rule 3 — atomicity] `logo/` committed with Task 1, not Task 2.**
The plan put `git add -A logo/` in Task 2. Task 1's tests read `logo/` for byte-equality and for the OG input, so committing Task 1 without it would have left an intermediate commit that could not pass its own test suite. Both commits went out in one push, so nothing was published in the broken state. Files and content are exactly as the plan specified.

**2. [Decision — needs your eye] The served SVGs keep their C2PA manifest; v1 stripped it.**
v1 removed the `<metadata>` provenance blob before serving (decision T-9-15: `public/` is world-readable, and the blob was ~97% of the file). The plan for v2 says *copy byte-identical*, `logo/README.txt` forbids editing the supplied art, and C2PA Content Credentials are designed to travel with an asset in public — so the copies are unedited and the old strip is gone.

The price, measured: `favicon.svg` is **7,974 bytes instead of ~258**, and `mark-paper.svg` the same, on assets a browser fetches on a cold load. Against a 33 KB lockup and a 42 KB OG image this is noise, and Lighthouse will not notice it — but it is a reversal of a recorded decision, so it is asserted explicitly in `brand-assets.test.ts` ("carries the supplied C2PA manifest, unedited — a deliberate v2 change") rather than left to be discovered. **If you would rather have the strip back**, it belongs in `render-brand-assets.sh` as a copy step, which would also keep truth #1 intact ("derived by the script"). Say the word and it is a ten-line change.

**3. [Rule 2 — the claim should be checkable] Contrast is now computed, not narrated.**
`tests/brand-tokens.test.ts` asserted colour *literals* and argued about ratios in prose, so "Graphite is strictly better on contrast" was a sentence nothing could fail on. Ten rendered pairs across both schemes are now computed against the WCAG AA floor, plus the specific claim this swap was argued on. Measured: Graphite on Paper **15.75:1** (Ink was 15.28), on `--surface` **16.47:1** (was 15.97). Tightest pair in the palette is the light accent at 5.11:1. Nothing failed.

**4. [Conflict in the plan, resolved] The v1 filenames are not listed in the test.**
Task 1's acceptance grep demands no `lockup-ink|mark-720|…` anywhere in `tests/brand-assets.test.ts`, while its test spec asks the suite to assert "no v1 filename exists". Both cannot hold. Resolved in favour of the stronger check: exhaustive `readdirSync` assertions on `public/brand` and `logo` against the expected sets, which prove absence for files nobody thought to enumerate — and name no dead files. A stale temp filename in the render script (`$TMP/mark-720.png` → `tile-720.png`) was renamed for the same reason.

**5. [Rule 1 — my bug] The directory-listing assertions were too strict, and a real delivery caught them.**
While this task was running, marketing delivered `logo/social-v2/` — Facebook, WhatsApp and GBP profile and cover art built from the same v2 lockup. My new `readdirSync('logo')` assertion compared the raw listing, so an ordinary subfolder failed the suite; a `.DS_Store`, which macOS writes into any directory Finder opens, did the same. The delivery was not wrong, the test was. Both listings now go through one helper counting committed files only (no dotfiles, no subdirectories), and I verified the fix by writing `.DS_Store` into both directories and re-running. The guarantee the assertion existed for is unchanged: no loose file beside the set, in either directory. The social set is committed as supplied — nothing under it is served.

**6. [Housekeeping] Three comment renames beyond the token.**
`marketing.css` had three comments reading "Ink not green"; they name the `--fg` colour and now read "Graphite". `globals.css` described `--accent-fg`'s dark value as "Ink", which it never was (Ink was the light foreground) — corrected with a note.

## Still on the v1 identity — outside this task's scope, your call

1. **Social and third-party profiles — art is ready, upload is yours.** Marketing deleted the five v1 social PNGs and, an hour later, delivered `logo/social-v2/` (committed in `d95c084`): Facebook profile + two cover variants, WhatsApp profile + two covers, GBP logo + cover. Their README records that the WhatsApp crop was measured off a real screenshot after two wrong guesses, and that the Facebook cover content sits inside the ~1110px phones show.

   **Until you upload these, your Facebook page, WhatsApp Business profile and Google Business Profile still show the v1 Ink identity** — the most publicly visible leftover, and the one thing here no deploy can fix. Their READMEs name which file goes where; the paper cover is their recommendation for Facebook (it contrasts with the dark profile circle).

2. **The console's text brand.** `src/app/(console)/layout.tsx` renders `SERVICE_NAME` as text in system-ui at weight 600 — not the wordmark art, and not Archivo. It picks up Graphite automatically now (it uses `--fg`), so it is not *wrong*, just not branded. Operator-only surface, so left alone deliberately; putting the lockup image there is a small change if you want it.

3. **The A4 audit and report sheets.** `audit.css` / `report.css` force `--fg: #16181d` inside `@media print` (a forced-light near-black, because the browser still reports dark mode while printing). That is neither Ink nor Graphite. These are the pages **handed to a client**, so they are the strongest candidate for a follow-up: changing the two print values to `#1A1F2B` would put the sheet in the brand's dark. Not touched here because it is a print-contrast decision, not a logo swap.

4. **Email.** Operator alerts and customer messages carry no brand art or colour at all (one neutral `#e5e5e5` rule in the Resend footer) — by design, since customer-facing messages go out in the tradie's voice. Nothing to do unless you want branded operator alerts.

5. **`docs/lighthouse/*.json`** still records v1 asset URLs. Historical artefacts of a past run; left as-is.

## Self-Check: PASSED

- All eleven files in `EXPECTED` and all eleven in `SOURCES` verified present on disk (asserted by the suite, which passed).
- Commits `c0a9c17`, `f615b45` and `d95c084` verified present in `git log`, and on `origin/main` after push (`HEAD == origin/main`).
- Live URLs verified 200/404 as tabled above; five live assets verified byte-identical to the committed files.
- Every screenshot listed above was opened and read, not merely generated.
