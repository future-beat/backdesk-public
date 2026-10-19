---
phase: quick
plan: "260919-kel"
quick_id: 260919-kel
type: quick
wave: "1"
depends_on: []
files_modified:
  - public/brand/
  - logo/
  - src/app/globals.css
  - src/app/layout.tsx
  - src/app/(marketing)/layout.tsx
  - src/app/(marketing)/marketing.css
  - scripts/brand/render-brand-assets.sh
  - scripts/brand/og-image.html
  - tests/brand-assets.test.ts
  - tests/brand-tokens.test.ts
autonomous: "true"
must_haves:
  truths:
    - "Every served brand file under public/brand/ is either a byte-identical copy of a logo/ v2 source or derived from one by scripts/brand/render-brand-assets.sh; no v1 art (rounded Ink square with a Paper bar, capitalised Inter Tight wordmark, #14213D) remains in public/, src/ or scripts/"
    - "The marketing header shows the v2 lockup: graphite-transparent on the light scheme, paper-transparent on the dark scheme, 28px tall at its true aspect ratio, alt text 'Backdesk'"
    - "favicon.ico, apple-touch-icon.png and og-image.png are regenerated from v2 art; the tab icon is legible on both light and dark browser chrome"
    - "The light-scheme foreground token is Graphite #1A1F2B in globals.css, pinned in tests/brand-tokens.test.ts with the reason, and every contrast assertion in the suite still passes"
    - "logo/ is committed exactly as supplied on 19 Sep 2026 (11 files incl. README.txt); the v1 files marketing removed are removed from git"
  prohibitions:
    - requirement_id: BRAND-01
      category: design
      statement: "MUST NOT redraw, recolour, respace, split or capitalise the supplied art (logo/README.txt); derived rasters come from the supplied SVGs/PNGs unchanged"
    - requirement_id: LAND-06
      category: performance
      statement: "MUST NOT add a webfont (no Archivo download: the wordmark is an image), a dependency, or serve the 3696px opaque lockups to browsers"
---

# Quick task: apply logo v2 (Graphite) to the site

## What changed in logo/ (supplied by marketing 19 Sep 2026, logo/README.txt)
"Backdesk logo v2. Graphite #1A1F2B · Paper #FAFAF7 · Wordmark: Archivo 700, lowercase, -0.04em. Mark = ascender height of wordmark, gap 0.3x. Clear space = mark height. Min lockup 100px / 24mm. Never green, never capitalised, never split, never respace the mark."
New files: backdesk-favicon.svg (bare graphite mark, two paths, transparent ground), backdesk-mark-graphite.svg, backdesk-mark-paper.svg, backdesk-profile-720.svg (graphite square, paper mark at 56%), backdesk-lockup-graphite-transparent.png + backdesk-lockup-paper-transparent.png (1508x288), backdesk-lockup-on-paper.png + backdesk-lockup-on-graphite.png (3696x928, opaque), backdesk-wordmark-graphite-transparent.png + backdesk-wordmark-paper-transparent.png (1236x288). Removed by marketing: v1 lockup/wordmark/mark files and the five social PNGs (fb/wa/gbp).

Prose is unaffected: the business name is still written "Backdesk" (the README itself does). "never capitalised" governs the wordmark art only. Alt text stays "Backdesk".

## Tasks

<task type="auto" id="1">
<name>Served assets, header, icons, OG image, render script</name>
<files>public/brand/, src/app/layout.tsx, src/app/(marketing)/layout.tsx, src/app/(marketing)/marketing.css, scripts/brand/render-brand-assets.sh, scripts/brand/og-image.html, tests/brand-assets.test.ts</files>
<read_first>
- logo/README.txt and every file in logo/ (view the PNGs; render the SVGs with headless Chrome if needed)
- scripts/brand/render-brand-assets.sh + og-image.html IN FULL (the OG composition's margins are computed from the v1 lockup canvas 1472x540 with ink y=187..349 — the v2 opaque lockup is 3696x928 with different geometry: MEASURE the content box and recompute, do not reuse the old numbers)
- src/app/(marketing)/layout.tsx header <picture> block and its comments; src/app/layout.tsx metadata icons; marketing.css header image rules
- tests/brand-assets.test.ts IN FULL (it pins filenames, PNG sizes, byte-equality with logo/, SVG structure incl. a <rect fill="#14213D"> assertion, and supplied-vs-served size)
</read_first>
<action>
public/brand/ naming convention = source name minus the "backdesk-" prefix. Copy byte-identical: favicon.svg, mark-graphite.svg, mark-paper.svg, profile-720.svg, lockup-graphite-transparent.png, lockup-paper-transparent.png, wordmark-graphite-transparent.png, wordmark-paper-transparent.png. Do NOT serve the two 3696px opaque lockups; the OG composition reads logo/backdesk-lockup-on-paper.png directly (update og-image.html's img src and the script's required-inputs list accordingly). git rm the v1 served files: lockup-ink-transparent.png, lockup.png, wordmark-ink-on-paper.png, wordmark-paper-on-ink.png, mark-720.svg.
Header: <source media="(prefers-color-scheme: dark)" srcSet="/brand/lockup-paper-transparent.png"> + <img src="/brand/lockup-graphite-transparent.png" alt="Backdesk" height 28, width from the true ratio 1508:288 (= 147)>; update the surrounding comments (they describe lockup.png / Ink).
Icons: the supplied favicon.svg is a bare Graphite mark on a transparent ground — invisible on dark browser chrome. Keep supplied art byte-identical and solve it in metadata: icons.icon = [{ url: '/brand/favicon.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' }, { url: '/brand/mark-paper.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' }, plus the .ico fallback as today]. favicon.ico (16/32/48) and apple-touch-icon.png (180, opaque) are rasterised from profile-720.svg (graphite square + paper mark — legible on any chrome, and iOS needs an opaque tile). Update render-brand-assets.sh: inputs, the raster source, the background colour #14213D → #1A1F2B, header comments. Run the script and commit its outputs. OG image: 1200x630 on Paper, the v2 lockup at the same optical size and position the v1 composition used (cap/x-height comparable, left-aligned to the same margin), tagline unchanged in the site's type, colour #1A1F2B. View the result.
Rewrite tests/brand-assets.test.ts to the v2 contract: the served list, the supplied list (11 files incl. README.txt), byte-equality pairs, PNG sizes (1508x288, 1236x288), SVG assertions (two <path> elements with fill #1A1F2B in favicon.svg / #FAFAF7 in mark-paper.svg; profile has the graphite <rect>; no <rect rx=18>, no #14213D anywhere under public/brand), header references both transparent lockups, metadata declares both media-scoped icons, og-image.png is 1200x630, no v1 filename exists under public/brand or logo.
</action>
<acceptance_criteria>
- `grep -rniE "#14213d|lockup-ink|mark-720|wordmark-ink-on-paper|wordmark-paper-on-ink" src scripts public tests/brand-assets.test.ts` → no matches (tests/brand-tokens.test.ts is Task 2)
- `npx vitest run tests/brand-assets.test.ts tests/marketing-metadata.test.ts tests/layout-contract.test.ts tests/marketing-css-contract.test.ts` passes
- `npm run typecheck && npm run lint && npx next build` clean
</acceptance_criteria>
<verify><automated>npx vitest run tests/brand-assets.test.ts</automated></verify>
<done>v2 art is what the site serves.</done>
</task>

<task type="auto" id="2">
<name>Ink → Graphite token; accept logo/ as supplied; deploy and look</name>
<files>src/app/globals.css, src/app/(marketing)/marketing.css, tests/brand-tokens.test.ts, logo/</files>
<read_first>
- src/app/globals.css token block (both schemes) and every comment that names "Ink"; tests/brand-tokens.test.ts (LIGHT map + any contrast-ratio assertions computed from --fg)
- marketing.css .wordmark fallback rule (unused text wordmark, Inter Tight -0.03em)
</read_first>
<action>
globals.css light scheme: `--fg: #1A1F2B; /* Graphite (logo v2, 19 Sep 2026; was Ink #14213D) */`. A Graphite lockup beside Ink body text is two different darks on one page; the brand's stated palette is Graphite + Paper. Dark scheme untouched. Update comments that say "Ink" where they name the token (leave historical notes in .planning alone). tests/brand-tokens.test.ts: '--fg': '#1a1f2b' with a one-line reason; re-run every contrast assertion (Graphite on Paper is higher contrast than Ink was; muted/accent pairs do not involve --fg but verify). The unused `.marketing .wordmark` text fallback: make it honest to v2 without a font download — `text-transform: lowercase; letter-spacing: -0.04em;` and a comment that the true wordmark is Archivo 700 and is always an image. Do not touch the console's text brand (operator-only; flagged in the summary).
git add -A logo/ (accept the supplied set and marketing's deletions). Push main; wait for production READY. Capture with the CDP script at the scratchpad path given in the environment notes: home header at 390px and 1280px in light AND dark, the guide page top at 390px, plus the three icon rasters and og-image.png; LOOK at them and record paths in the SUMMARY. Fetch https://backdesk.com.au/brand/favicon.svg and /brand/lockup-graphite-transparent.png → 200, and an old URL (/brand/lockup-ink-transparent.png) → 404.
</action>
<acceptance_criteria>
- `grep -c "1A1F2B" src/app/globals.css` ≥ 1 and `grep -ci "14213d" src/app/globals.css` = 0
- bare `npx vitest run` shows no new failures beyond the pre-existing remote-suite refusals
- live checks recorded; screenshots inspected
</acceptance_criteria>
<verify><automated>npx vitest run tests/brand-tokens.test.ts tests/brand-assets.test.ts</automated></verify>
<done>The page's dark is the logo's dark; live and looked at.</done>
</task>
