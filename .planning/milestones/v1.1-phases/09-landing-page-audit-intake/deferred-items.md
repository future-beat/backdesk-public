# Phase 09 — deferred items

Out-of-scope discoveries logged rather than fixed, per the executor scope boundary.

## From 09-02 (brand identity pass)

### 1. Two supplied lockup variants are not tracked

`logo/` was delivered with **seven** brand files, not the five D-06 and 09-02 name:

| File | Size | Status |
|------|------|--------|
| `logo/backdesk-lockup-ink-transparent.png` | 1152×220 | **untracked** |
| `logo/backdesk-lockup-paper-transparent.png` | 1152×220 | **untracked** |

Both are transparent-background variants of the lockup (Ink art and Paper art
respectively), cropped tight — noticeably more useful for compositing than the
opaque `backdesk-lockup.png` when the surface behind is not Paper.

They were left untracked because D-06, the 09-02 asset list and the plan's
acceptance criterion all pin `git ls-files logo` to exactly five files, and the
`tests/brand-assets.test.ts` enumeration is written against that set. They are
still on disk.

**RESOLVED in 09-05** (operator instruction, 9 Sep). Both variants are now
committed as source files (`logo/` holds seven) and served as
`public/brand/lockup-ink-transparent.png` and
`public/brand/lockup-paper-transparent.png`; the site header picks between them
with a `<picture>` + `prefers-color-scheme` source pair, so the dark scheme gets
the Paper artwork with no card behind it. `tests/brand-assets.test.ts` now
enumerates seven sources and ten served files. The opaque `lockup.png` stays as
the OG image's source, which is always Paper.

### 2. Next starter assets still in `public/`

`public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg` and `window.svg` are
`create-next-app` leftovers. Nothing references them. Harmless, but they are
world-readable files that are not ours and will read as clutter beside
`public/brand/`. Delete in any phase that touches `public/`.

### 3. `logo/.DS_Store`

Present on disk, already covered by `.gitignore`. No action.
