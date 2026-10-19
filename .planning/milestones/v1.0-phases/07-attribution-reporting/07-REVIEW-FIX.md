---
phase: 07-attribution-reporting
fixed_at: 2026-09-03T17:14:36Z
review_path: .planning/phases/07-attribution-reporting/07-REVIEW.md
review_scope: gap-closure follow-up (plan 07-07, commits 43d245f / c7b45ff / 271107e) — supersedes the 07-06 fix report at 265a6bc, which is preserved in git history
iteration: 1
findings_in_scope: 6
findings_total: 9
fixed: 8
declined: 1
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report (07-07 gap-closure scope)

**Fixed at:** 2026-09-03T17:14:36Z
**Source review:** `.planning/phases/07-attribution-reporting/07-REVIEW.md` (scoped to plan 07-07)
**Iteration:** 1

This report **overwrites** the previous `07-REVIEW-FIX.md`, which covered the scoped 07-06
review (9 findings, all closed); that one is preserved in git history at `265a6bc`, and the
full-phase report it in turn superseded at `c7dec87`.

**Summary:**
- Findings in scope (`critical_warning`): 6 — CR-01, WR-01 … WR-05. All six closed.
- Info findings (IN-01 … IN-03) were taken on the one-line-and-zero-risk rule: **IN-02 and
  IN-03 applied, IN-01 declined** with the reason below.
- **CR-01's premise was refuted, not applied.** It is recorded as closed-by-hardening, not
  as a blocker fixed. Details in its section — this is the one finding where the shipped
  code and the review disagree about a fact, and the fact is checkable.

**Verification:** every gate ran in the **main checkout**, not a worktree
(`workflow.use_worktrees` is `false` in `.planning/config.json`, so this agent honoured the
opt-out and edited/committed in place). The numbers below are reproducible from the tree you
are reading. The database was never touched; `test:remote` was never run and
`ALLOW_REMOTE_TESTS` was never set.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm run build` | compiled, all 13 routes |
| `npm test` | **2407 passed, 0 assertion failures**; 39 failing FILES are the documented remote-gated refusals |
| `npx vitest run tests/print-feedback.test.ts` | 23 → **25** passed |
| `npx vitest run tests/layout-contract.test.ts` | 13 → **15** passed |
| `npx vitest run tests/lint-ban.test.ts` | 27 → **28** passed |
| `npx vitest run tests/reporting-copy.test.ts` | 30 passed (one assertion added to an existing case) |

Baselines measured by checking the four files out at `f50ec25` and running them, not by
memory. One of those runs is itself a finding: the **pre-fix `layout-contract.test.ts` fails
against the post-fix source** (`1 failed | 12 passed`), because its byte-string wrapper regex
cannot see the WR-03 attributes. That is WR-05 demonstrated rather than argued.
| `07-06-harness/tables-check.sh` | **RESULT: PASS** (all five fixtures `wrapperInSource: true`, control-bare still widens to 620px) |

No schema change, no migration, no new dependency — markup, one CSS rule, two comments and
four test files.

## Fixed Issues

### CR-01: "the print success signal does not exist on WebKit" — REFUTED, closed as hardening

**Files modified:** `src/app/(console)/reports/[client]/[reportId]/print-button.tsx`,
`print-feedback.ts`, `tests/print-feedback.test.ts`
**Commit:** `8678233`

The review's blocking claim — *"WebKit has never shipped `beforeprint`/`afterprint`"* — is
false, and the design was not rewritten around `matchMedia('print')`.

Sources checked before touching the file:

- **caniuse feature `beforeafterprint`** records `beforeprint`/`afterprint` as supported in
  **Safari 13+** and **iOS Safari 13.0+**, continuously through 18.
- **WebKit bug 196478 / changeset r243762**, *"[WK2] Add support for Window's beforeprint /
  afterprint events"*, is the implementation, and it lives in shared WebKit2 code rather
  than a macOS-only path. The same changeset crashed the **iOS-simulator** layout test
  `editing/execCommand/print.html` — direct evidence the events dispatch on iOS, not an
  inference from the desktop port.
- The operator's device is **iOS 26.5.2**.

So the review's trace (step 2, *"No `beforeprint` fires"*) does not happen on the device the
feature was built for, and the consequence it derives — a permanent on-screen claim of
failure after every successful print — is not a live defect. Rewriting the feature around
the media query would have been a change made on a false premise.

What was done instead, per the ruling, is the cheap belt-and-braces:

- `print-button.tsx` also subscribes to `window.matchMedia('print')` `change` and dispatches
  **the same two events** into the same reducer (`matches` → `beforeprint`, `!matches` →
  `afterprint`), so an embedded webview or an engine older than Safari 13 still has an exit
  from `fallback`.
- Guarded twice, and both guards are the point rather than defensive noise: `matchMedia` may
  be absent (jsdom, some webviews), and its `addEventListener` form only exists from Safari
  14 — the versions below that being exactly the ones `beforeprint` already covers, which is
  why no deprecated `addListener` fallback was added.
- **The reducer is unchanged.** Both routes feeding it is only safe because it is
  idempotent, so that is now asserted rather than assumed: a new test sends `beforeprint`
  twice and `afterprint` twice and pins that each pair is one transition.
- **Both header comments corrected.** `print-feedback.ts` said `beforeprint` is *"the ONLY
  success signal"*; `print-button.tsx` implied the same. Both now say it is the **primary**
  signal, name the support floor (Safari 13 / iOS 13, bug 196478 / r243762), and describe the
  media query as belt and braces for anything older or embedded.
- The island's source pin requires `matchMedia('print')` alongside the two `addEventListener`
  pins, so the second route cannot be deleted by somebody who tested on Chromium only.

**Not done, deliberately:** the review's second suggestion — a `'dismiss'` event giving
`fallback` a timed or `visibilitychange`-driven exit. It exists to bound a hint that never
clears, and on a supported engine the hint always clears on `afterprint`. Adding a timer that
erases a message the operator may still be reading (the manual `Share → Print` route, which
is precisely what they would be following when the app is backgrounded) would trade a
non-problem for a real one.

### WR-01: the `role="status"` live region was mounted with its own text

**Files modified:** `print-button.tsx`, `report.css`, `tests/print-feedback.test.ts`
**Commit:** `5a844f7`

The region is now permanent inside `.report-actions` and only its text changes
(`{message ?? ''}`), so assistive tech has it in the accessibility tree from first paint and
announces the transition.

Screen-only was **verified, not added to**: `report.css:269` already lists `.report-actions`
in the `display: none !important` group under `@media print`, and the existing pin asserts
that selector is in the list. No print rule was written. The one new screen rule is a
collapse, because an always-mounted `<p class="hint">` would otherwise carry a 0.5rem bottom
margin under the button on every idle report:

```css
.report-actions p[role='status']:empty { margin: 0; min-height: 0; }
```

The plan-era pin was tightened rather than deleted: `role="status"` must occur exactly once,
must appear **before** any `{message` expression, and a `{message ? … role="status"`
conditional is rejected outright. The old pin (`toContain('role="status"')`) passed either
way, which is what let the defect through review in the first place.

### WR-02: the prefetch mitigation was on the wrong link

**Files modified:** `src/app/(console)/reports/[client]/[reportId]/page.tsx`
**Commit:** `8981ffd`

`prefetch={false}` on `.report-backlink` as well. The comment on each link now explains both:
the back link is above the fold and prefetches **at hydration** — the window every header
comment in this feature blames — while the version link prefetches on scroll. Two links on an
operator-only route lose nothing measurable by not prefetching.

### WR-03 / WR-05: scroll boxes no keyboard could reach, and the gate that would have broken on the fix

**Files modified:** `src/app/(console)/page.tsx`, `clients/[id]/page.tsx`, `audits/page.tsx`,
`audits/[id]/mapping/mapping-form.tsx`, `reports/page.tsx`,
`reports/[client]/[reportId]/page.tsx`, `settings/email/page.tsx`, `src/app/globals.css`,
`tests/layout-contract.test.ts`, `07-06-harness/gen-tables.mjs`
**Commit:** `b74ae65`

One commit, because WR-03 changes the exact byte string WR-05's gate matched.

**Count: nine wrappers, not seven.** The ruling said seven; counting them myself:
`/` Clients, `clients/[id]` Recent sync runs, `audits` Audits, `reports` Client metrics,
`reports/[client]/[reportId]` Jobs recovered, `settings/email` DNS records **and** Who sends
as what, `mapping-form` Column mapping **and** Column preview. All nine now carry
`tabIndex={0}`, `role="region"` and that `aria-label`.

`globals.css` has no `:focus-visible` rule anywhere — I looked before inventing one — so this
sets the convention at 2px `var(--accent)` with 2px offset, offset clear of the table's own
top border.

The gate now:

- walks **all of `src/app`**, not `src/app/(console)`. Nothing is excluded — every `<table>`
  in the tree today is a console table on a phone, and `src/app/login` and `src/app/layout`
  have none. The comment says an exemption must be written by path with a reason rather than
  achieved by a walk that never looked.
- matches the wrapper **by class**: any attribute order, either quote style, extra classes,
  tag split across lines.
- **rejects a wrapper with no `tabIndex={0}` / `aria-label`**, as a second assertion with its
  own failure message.
- **falsifies itself in the suite**, which the previous version did not: synthetic sources
  assert that a commented-out wrapper reads as unwrapped, that an intervening element is not
  a wrapper, and that a bare wrapper is counted **and** rejected.

Both mutations were also run against the real tree before committing: stripping the
attributes from `audits/page.tsx` fails with `1 of 1 box(es) unreachable`, replacing the
wrapper with `<div>` fails with `1 table(s), 0 wrapped`. File restored via the pre-mutation
copy and confirmed.

**The harness generator needed the same fix and would otherwise have failed loudly:**
`gen-tables.mjs`'s `wrappedInSource()` used the identical one-byte-string regex, so with the
new attributes in place it returns `false` on the shipped source — I verified that directly
(`old matcher: false`, `new matcher: true`) rather than discovering it from a red harness.
Its matcher now mirrors `tableWrapping()`. `tables-check.sh` re-run afterwards:
**RESULT: PASS**, all five fixtures `wrapperInSource: true`, `control-bare` still widening the
document to 620px so the probe is demonstrably not blind.

### WR-04: both import pins were blind to the shape that actually breaks the bundle

**Files modified:** `tests/lint-ban.test.ts`, `tests/print-feedback.test.ts`
**Commit:** `ee4ed4a`

`valueImportSpecifiers()` now reads `import 'x'`, `import "x"`, `import x from "x"`,
`import { a } from "x"`, `import * as ns from 'x'`, multi-line clauses, `export … from 'x'`
and dynamic `import('x')`, while still ignoring `import type` / `export type` and still
counting `{ type A, b }` as a value import. A quoted string alone is not enough to be an
import, so `export const X = 'hi';` is not mistaken for one — the obvious trap in widening
the regex.

It takes a **source string**, so the file carries a self-test over fifteen synthetic sources
including the review's exact scenario (the island with `import '@/db/repository';`
prepended). The island's own pin rejects any statement with no `from` clause outright and
additionally asserts no dynamic import and no `export … from`.

**Verified against the live tree:** inserting `import '@/db/repository';` into
`print-button.tsx` now fails **both** guards —
`lint-ban … print-button.tsx pulls no database module into the browser bundle` and
`print-feedback … imports react and its sibling, and nothing else` — where before this commit
both passed. The island was restored from a pre-mutation copy and the suites re-run green.

### IN-02: `followUpRange` silently coupled to `shortDate`'s token count

**Files modified:** `tests/reporting-copy.test.ts`
**Commit:** `7c2e481`

One assertion beside the existing `shortDate` case:
`expect(shortDate('2026-03-01', PERTH)).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/)`. A format change
that grew a year now fails there rather than silently dropping the year from a client-facing
range.

### IN-03: `uncommentedTsx` is a stripper, not a parser

**Files modified:** `tests/layout-contract.test.ts`
**Commit:** `7c2e481`

Comment only. The header now records that a `//`-leading line inside a template literal or
JSX text is eaten, that a `/*` inside a string literal would open a false block comment, that
the current tree is unaffected, and that the `seen > 0` / `boxes > 0` guards are the backstop.

## Declined

### IN-01: make `followUpRange`'s marker handling explicit

**File:** `src/core/reporting/copy.ts:112-120`
**Reason:** not a one-line, zero-risk change — it alters client-facing output that is
deliberate and already asserted.

The review's fix would make `followUpRange(2, '1 Aug', NO_VALUE)` return `2 · 1 Aug` instead
of `2 · 1 Aug–—`. That second form is not an oversight: `tests/reporting-copy.test.ts:165`
pins it with the reason — *"the honest reading is that one of the two dates is unavailable,
not that they match"* — and silently printing the surviving date would present a half-known
range as a known one on a document a client is billed by. The function's doc comment already
states the actual rule (a range whose two **rendered** dates are identical collapses, and a
degraded end falls through to the long form), so the "comment claims what the code does not
do" half of the finding does not hold either.

The residual is the review's real observation: the asymmetric case prints an en dash beside
an em dash (`1 Aug–—`). Both branches require data zod already rejects
(`document.ts:83-84` types both touch timestamps as required `z.iso.datetime()`), which is
why the review filed it as Info. If it is ever wanted, the change belongs with a decision
about what a half-known range should say — not smuggled in as a lint-level fix.

## Skipped

None. Every in-scope finding was applied or, for IN-01, declined with a reason above.

## Follow-ups for the phase owner

1. **CR-01 is closed on evidence, not on a code change to the signal.** If the print button
   ever misbehaves on a real device again, the first thing to check is whether `beforeprint`
   fires there — not to assume it does not. The support floor is now written into both
   header comments with the WebKit changeset number, so the check starts from a fact.
2. **The nine new tab stops are worth one pass on a real phone.** `role="region"` +
   `tabIndex={0}` adds nine stops to the console's tab order; the labels were chosen from
   each table's own heading or caption, and only a screen reader will confirm they read
   naturally in sequence.
3. **`gen-tables.mjs` and `tests/layout-contract.test.ts` now carry the same wrapper regex in
   two places.** They diverged once already (that is this finding), and the harness is not
   wired into CI, so the divergence would be silent again. A comment in each names the other;
   a shared module would be better if the harness outlives the phase.
