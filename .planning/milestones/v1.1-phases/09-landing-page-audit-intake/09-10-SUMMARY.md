---
phase: 09-landing-page-audit-intake
plan: "10"
subsystem: ui
tags: [gap-closure, uat, forms, multipart, css, specificity, nextjs]

gap_closure: true
gap_ids: ["G-09-1", "G-09-2"]

requires:
  - phase: 09-landing-page-audit-intake
    provides: "09-03's public audit action, its `sniffCsv` boundary and the `tests/audit-request-action.test.ts` harness"
  - phase: 09-landing-page-audit-intake
    provides: "09-05's `marketing.css`, its rationed-accent header and the `.button` rules in `src/app/globals.css`"
  - phase: 07-reporting
    provides: "`tests/layout-contract.test.ts` — the parse-don't-pattern-match CSS-contract harness this plan's new suite copies"
provides:
  - "`attachedFile()` in the public audit action: an empty `<input type=\"file\">` part (zero bytes, or a runtime-invented name) reads as no attachment instead of as a bad one"
  - "Two regression cases pinning both shapes a runtime hands that empty part back — the browser shape the old suite never exercised"
  - "`.marketing a.button` / `.marketing a.button--secondary`: the button label out-ranks the prose link colour inside the marketing subtree, without touching the console's `globals.css`"
  - "`tests/marketing-css-contract.test.ts`: declarations AND source order, since the two button selectors tie on specificity"
affects: [09 UAT re-test 1, 10 go-live]

actuals:
  tokens: 3479
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Presence of an upload is decided by BYTES, not by `instanceof File` — a form part exists whether or not a file was chosen"
    - "A cross-file specificity collision is resolved in the narrower stylesheet and pinned by a contract test that asserts source ORDER, not just declarations"

key-files:
  created:
    - tests/marketing-css-contract.test.ts
  modified:
    - src/app/(marketing)/audit/actions.ts
    - src/app/(marketing)/marketing.css
    - tests/audit-request-action.test.ts

key-decisions:
  - "Zero bytes is the primary reading and the empty name only the second: the runtime's name for an absent file is not dependable (`''`, `blob`, `undefined`), but a real attachment always has bytes"
  - "`sniffCsv` was left untouched, so a named non-empty `.txt` and an oversized export are refused by exactly the code that refused them before — the change narrows what reaches the sniff and nothing else (T-9-04)"
  - "The collision was fixed in `marketing.css` rather than by weakening `.marketing a` or editing `globals.css`: the prose rule is correct for prose (D-19 underline) and `globals.css` is shared with the console, so the narrower file is the only place the fix costs nothing elsewhere"
  - "`.marketing a.button--secondary` is placed AFTER `.marketing a.button` deliberately — they are the same specificity and a secondary button carries both classes, so source order is what makes the Ink label win; the contract test asserts that order"
  - "The new unit cases assert that the action returns NO state, because the action returns a state only to re-render a refusal — a written row and a `csv_file` sentence are mutually exclusive"

patterns-established:
  - "Test fixtures for a form boundary must model what a BROWSER sends (the part is always present), not what a hand-built FormData sends (the field is absent) — the old suite passed for a year against a shape no browser produces"
  - "CSS-contract tests read the stylesheet, run in the pure suite, and fail loudly on a missing or ambiguous rule rather than returning an empty string"

requirements-completed: [LAND-01, LAND-02]

coverage:
  - id: D1
    description: "Submitting /audit with the optional ServiceM8 export left empty succeeds and stores a row with no CSV; a named non-empty non-CSV and an oversized CSV are still refused with their own sentences (G-09-1)"
    requirement: LAND-02
    verification:
      - kind: unit
        ref: "tests/audit-request-action.test.ts#treats a browser's empty file part as no attachment, not as a bad one"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#does the same when the runtime NAMES that empty part (blob, undefined)"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#refuses a non-CSV with the locked sentence and writes NOTHING"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#refuses an oversized file with the SIZE sentence"
        status: pass
    human_judgment: true
    rationale: "A POST to the live form writes a row and pages the operator, so the fix cannot be exercised end-to-end from here. The unit cases prove the decision; only the operator repeating UAT test 1 from the phone proves the multipart part their browser actually sends is the shape these cases model."
  - id: D2
    description: "The landing page's green buttons render their label in --accent-fg on --accent (and the secondary button in --fg), while prose links keep their green underline (G-09-2)"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/marketing-css-contract.test.ts#a link that is a button is painted as a button (G-09-2)"
        status: pass
      - kind: integration
        ref: "curl https://backdesk.com.au/_next/static/immutable/chunks/3hcvg3le18yro.css | grep '.marketing a.button{color:var(--accent-fg)' — present, at offset 8856, after the prose rule at 8797"
        status: pass
    human_judgment: true
    rationale: "The shipped stylesheet is proven on production, but 'readable' is what the operator reported as broken from a phone in two colour schemes; only their eyes close that gap."

duration: 22min
completed: 2026-09-10
status: complete
---

# Phase 09 Plan 10: UAT Gap Closure (G-09-1, G-09-2) Summary

**An empty file input no longer reads as a bad attachment, and a link that is also a button no longer paints its label green on green — both fixes pinned by tests and the CSS proven live on backdesk.com.au.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-10T05:09:00Z
- **Completed:** 2026-09-10T05:31:00Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- **G-09-1 (blocker) closed.** `attachedFile()` decides whether an attachment exists from `size` and `name`, not from `instanceof File`. A browser sends an untouched `<input type="file">` as a zero-byte part with `filename=""`; the old guard passed that into `sniffCsv`, which failed it on the `.csv` suffix and returned the not-a-CSV sentence — so the optional field refused every submission that left it optional.
- **The blind spot that hid it is now covered.** The suite's `form()` helper only ever set `csv_file` when a file was passed, i.e. it modelled the field as *absent* — what a hand-built `FormData` does and what a browser never does. Two cases now pin both shapes a runtime hands the empty part back (unnamed, and named `blob`).
- **G-09-2 (major) closed.** `.marketing a` (0,1,1) out-specified `.button` (0,1,0) in `globals.css`, so `<a class="button button--lg">` was painted `--accent` on `--accent`. `.marketing a.button` and `.marketing a.button--secondary` (0,1,2) restate the tokens `globals.css` already sets, scoped to the marketing subtree.
- **Neither refusal path was weakened.** A renamed `.txt` and an oversized export are still refused by the same untouched `sniffCsv`, and prose links keep the green underline D-19 requires.

## Task Commits

1. **Task 1: Treat an empty file part as no attachment (G-09-1)** — `34e3777` (fix)
2. **Task 2: Give button labels precedence over the prose link colour (G-09-2)** — `c851879` (fix)

## Files Created/Modified

- `src/app/(marketing)/audit/actions.ts` — `attachedFile()` helper replaces the inline `attachment instanceof File && attachment.name !== ''` guard; its header records the browser behaviour that made the old guard wrong.
- `tests/audit-request-action.test.ts` — two regression cases for the empty multipart part; the type and size refusal cases untouched.
- `src/app/(marketing)/marketing.css` — `.marketing a.button` and `.marketing a.button--secondary` after the prose link rule, with the specificity arithmetic in the comment.
- `tests/marketing-css-contract.test.ts` — new: parses the stylesheet, asserts the declarations, the source order, that the prose rule survives, and that no colour literal was introduced.

## Verification

| Gate | Result |
| --- | --- |
| `npx vitest run tests/audit-request-action.test.ts` | 32 passed |
| `npx vitest run tests/marketing-css-contract.test.ts tests/layout-contract.test.ts` | 23 passed |
| `npm test` (pure) | 2923 passed, 0 failed. 40 files refused to load — the integration suites declining the hosted project without `ALLOW_REMOTE_TESTS`, the pre-existing state of a bare run here. |
| `npm run typecheck` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npx next build` | clean |
| Deploy | `backdesk-86x4th7br` READY (Production, 27s) after `c851879` pushed to `main` |

**Live proofs on production (2026-09-10):**

- `https://backdesk.com.au/` → HTTP 200, `class="button button--lg"` appears **2×**.
- CSS chunk `/_next/static/immutable/chunks/3hcvg3le18yro.css` contains, in this order:
  - `.marketing a{color:var(--accent);text-decoration:underline}` @ 8797
  - `.marketing a.button{color:var(--accent-fg);text-decoration:none}` @ 8856
  - `.marketing a.button--secondary{color:var(--fg);text-decoration:none}` @ 8920
- `https://backdesk.com.au/audit` → HTTP 200. **No POST was made**: submitting the live form writes a row and pages the operator, so G-09-1 is proven by the unit cases here and re-proven by the operator repeating UAT test 1.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: zero bytes is the reliable half of "is there a file?", because the name of an absent file is whatever the runtime decided to call it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's suggested assertion could not hold**

- **Found during:** Task 1
- **Issue:** The plan asked the new cases to assert `state.errors.csv_file` is undefined. On the success path the action ends in `redirect()`, which the suite mocks to return rather than throw — so it resolves to `undefined` and `state.errors` threw a `TypeError`.
- **Fix:** Assert `expect(state).toBeUndefined()` instead, with a comment saying why that is the stronger claim: the action returns a state *only* to re-render a refusal, so "no state" and "a written row" prove the absence of a `csv_file` sentence between them.
- **Files modified:** `tests/audit-request-action.test.ts`
- **Verification:** 32/32 pass; the surrounding refusal cases still capture and inspect their returned state.
- **Committed in:** `34e3777` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug, in a test assertion).
**Impact on plan:** None on behaviour or scope. Every acceptance criterion in the plan was met verbatim.

## Behaviour Note (intentional, worth recording)

A *named but genuinely empty* `.csv` (zero bytes) now reads as "no attachment" and the submission succeeds without one, where previously it was refused with the not-a-CSV sentence. That is the plan's explicit requirement — the runtime's name for an empty part cannot be trusted, so bytes decide — and it fails safe: nothing is stored, `hasCsv` is false, and the operator's email says "No file attached", which is true. The comment in `csv-sniff.ts` about an empty file being refused as a type problem still describes `sniffCsv` accurately; it is simply no longer reachable from the public action, which is the only caller that could reach it with zero bytes. `sniffCsv` was not modified.

## Issues Encountered

- The `vercel ls` polling loop misread line numbers with stderr suppressed and ran past its window while the deployment had in fact been READY for minutes. Resolved by checking status directly; no effect on the work.

## Known Stubs

None.

## Threat Flags

None. The change to the attachment path **narrows** what counts as an attachment (T-9-04, disposition `mitigate`): the sniff, the 4 MiB cap and the private-bucket path are untouched, and the retained refusal tests prove it. The CSS change touches no trust boundary.

## User Setup Required

None.

## Next Phase Readiness

- Both blocker/major gaps from UAT test 1 are closed in production. **UAT test 1 must be re-run from the operator's phone** — it is the only proof that the multipart part a real browser sends matches the shape the new unit cases model, and the only eyes that can confirm the button labels now read.
- UAT tests 2–10 remain pending and were not affected by these changes.

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-10*

## Self-Check: PASSED

All four source/test files exist on disk; both task commits (`34e3777`, `c851879`) are reachable in git history and pushed to `origin/main`.
