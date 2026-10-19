---
phase: quick
plan: "261016-1xw"
quick_id: 261016-1xw
status: complete
subsystem: marketing
tags: [landing, positioning, missed-call, text-back, og-image, metadata, copy]

requires:
  - phase: v1.2 (Phases 11-15)
    provides: the missed-call text-back product the site now leads with
provides:
  - Landing h1 (TAGLINE) "Every missed call texted back in seconds." and a lede that carries the quote line second
  - Four steps with missed-call text-back as step 3 and the monthly report merged into step 4
  - Fit paragraph that welcomes emergency and after-hours trades
  - Home title/description and console description leading with missed-call text-back
  - Re-rendered OG image, pinned to TAGLINE so picture and alt cannot drift
  - README line 3 and a dated deploy entry in docs/external-registrations.md
affects: [marketing copy, link previews, Cowork marketing thread]

tech-stack:
  added: []
  patterns:
    - "OG source page pinned to the TAGLINE constant (entity-normalised) by tests/brand-assets.test.ts"

key-files:
  created: []
  modified:
    - src/core/brand.ts
    - src/app/(marketing)/copy.ts
    - tests/brand.test.ts
    - tests/marketing-copy.test.ts
    - tests/marketing-metadata.test.ts
    - scripts/brand/og-image.html
    - public/brand/og-image.png
    - tests/brand-assets.test.ts
    - README.md
    - docs/external-registrations.md

decisions:
  - "Site repositioned 16 Oct 2026 (founder): h1 is 'Every missed call texted back in seconds.'; quote chasing is the lede's second line; the 3x guarantee is tied to recovered quote value; the free Quote Leakage Audit stays the only CTA"
  - "Fit paragraph drops the 'emergency-only' and 'fewer than about 8 quotes' exclusions; the 10+ quotes floor moves to the quote-side list"

metrics:
  duration: ~20min
  completed: 2026-10-16

actuals:
  tokens: 5100
  tasks: 3
  commits: 3
---

# Quick 261016-1xw: Reposition the site around missed-call text-back Summary

The public site now leads with "Every missed call texted back in seconds." The quote cadence moved to the lede's second line and to step 4, and the OG image was re-rendered and pinned to the TAGLINE constant. All of this is live on backdesk.com.au at `bb1c83c`, and the four production probes are unchanged.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `f5abd64` | feat(quick-261016-1xw): the site leads with missed-call text-back; quote chasing is the second line |
| 2 | `bb1c83c` | feat(quick-261016-1xw): OG image and README carry the missed-call positioning |
| 3 | `7176af7` | docs(quick-261016-1xw): site repositioning deployed and probed |

## What changed

- **brand.ts:** TAGLINE and CONSOLE_DESCRIPTION now use the plan's exact strings. The TAGLINE doc comment is dated.
- **copy.ts:** The hero lede, steps 2 to 4, Quote Chaser's new first bullet, the first sentence of founding.body, the fit body and METADATA_COPY.home all use the plan's exact strings. The guarantee comment is replaced by a short dated "resolved" note. The header comment now points the second AI disclosure at step 4. Unchanged: tier names, prices, setup fee, founding figure, reassurance line, guarantee body, Spam Act and opt-out sentences, residency sentences, GUIDE_COPY, PRIVACY_COPY and page.tsx.
- **Pins moved, each with a dated comment, none deleted:**
  - brand.test (tagline)
  - marketing-copy.test (the hero case was rewritten; a new emergency and lead-generation fit case was added; the four step titles and the Quote Chaser first bullet were added)
  - marketing-metadata.test (absolute title, plus a `missed call` check on the description)
- **OG:** The og-image.html tagline was replaced and the image re-rendered with `scripts/brand/render-brand-assets.sh`. Only `public/brand/og-image.png` changed bytes; no restores were needed. It is still 1200x630. On visual check the tagline sits on two lines with nothing clipped, and the lockup and domain have not moved. A new brand-assets case pins `<p class="tagline">${TAGLINE}</p>` (with `&rsquo;` normalised).
- **README** line 3 is the plan's sentence. It contains no phone number, SID or credential.

## Verification

- Task 1: 7 pure suites, 230/230 passed. `typecheck`, `lint` and `next build` all exit 0.
- Task 2: brand-assets, marketing-copy and brand suites, 165/165 passed. `typecheck` and `lint` exit 0. `git status public/brand` showed only og-image.png before the commit.
- Copy invariants still hold: 4 steps, 2 tiers, "Run by AI, checked by a human" exactly once, no em dash, no exclamation mark, no "up to $", no domain except ours, the residency sentences unchanged, and one h1 with six h2 (page.tsx untouched).
- CI: run `38865872740` on `bb1c83c` succeeded.
- Deploy:
  - Vercel `dpl_3WcpLcyiCQi2bZLg6WPgFQAkuPhE`, target production, status Ready, created 2026-10-16 15:13 AWST.
  - GitHub deployment `7113246365`, Production, on `bb1c83c`.

### Live evidence (2026-10-16, after deploy)

| Check | Result |
|-------|--------|
| `curl -s https://backdesk.com.au/ \| grep -c 'Every missed call texted back in seconds.'` | 1 line (6 occurrences in the minified HTML; h1, og:image alt and others) |
| `grep -c 'done-for-you'` on the same HTML | 0 |
| `<title>` | `Backdesk · Missed-call text-back for Perth trade businesses` |
| `POST /api/webhooks/twilio/voice?token=wrong` | 401 |
| `POST /api/webhooks/twilio/voice-status?token=wrong` | 401 |
| `POST /api/internal/cadence-tick` with `Bearer wrong` | 401 |
| `GET /leads` unauthenticated | 307 |

The plan's Task 3 `<verify>` block, run after the evidence commit, exited 0.

## Deviations from Plan

None in substance. Three small notes:
- tests/brand-assets.test.ts had no existing `@/core/brand` imports, so `TAGLINE` is imported on its own line next to the layout import.
- `vercel inspect` does not expose a separate Ready timestamp, so the entry in external-registrations.md records the created time (15:13 AWST) along with status Ready.
- The first push also carried the plan commit `d5dccac`, which was not pushed before this task (range `e263db1..bb1c83c`).

## Known Stubs

None.

## Self-Check: PASSED

- All ten modified files are present. Commits f5abd64, bb1c83c and 7176af7 are in `git log`.
