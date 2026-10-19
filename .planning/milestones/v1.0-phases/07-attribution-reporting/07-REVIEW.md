---
phase: 07-attribution-reporting
reviewed: 2026-09-03T16:54:09Z
depth: standard
scope: gap-closure follow-up (plan 07-07) — source files changed since 11bba83 only
supersedes: the scoped 07-06 review (12 findings, all closed); preserved in git history at ce5b6ad. That review itself superseded the full-phase review at 48794fd.
diff_base: 11bba835a106c45c013cea379e6178334d7459f3
files_reviewed: 13
files_reviewed_list:
  - src/app/(console)/page.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/audits/page.tsx
  - src/app/(console)/audits/[id]/mapping/mapping-form.tsx
  - src/app/(console)/reports/page.tsx
  - src/app/(console)/reports/[client]/[reportId]/page.tsx
  - src/app/(console)/reports/[client]/[reportId]/print-button.tsx
  - src/app/(console)/reports/[client]/[reportId]/print-feedback.ts
  - src/core/reporting/copy.ts
  - tests/layout-contract.test.ts
  - tests/lint-ban.test.ts
  - tests/print-feedback.test.ts
  - tests/reporting-copy.test.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
resolution: all_fixed
resolved_at: 2026-09-03T17:14:36Z
resolution_report: .planning/phases/07-attribution-reporting/07-REVIEW-FIX.md
resolution_note: >-
  All six in-scope findings (CR-01, WR-01…WR-05) closed. CR-01's premise was REFUTED — caniuse
  `beforeafterprint` and WebKit bug 196478 / changeset r243762 record `beforeprint`/`afterprint`
  as shipped in Safari 13 and iOS Safari 13, and the operator's device is iOS 26.5.2 — so it is
  closed as hardening (a `matchMedia('print')` second signal plus corrected header comments),
  not as the blocker it was filed as. Of the Info findings, IN-02 and IN-03 were applied and
  IN-01 was declined (it would change deliberate, asserted client-facing output).
  `status:` above is left at the review's own finding, per the convention every other phase
  follows; this block is the outcome.
---

# Phase 07: Code Review Report (07-07 gap closure)

**Reviewed:** 2026-09-03T16:54:09Z
**Depth:** standard
**Files Reviewed:** 13 (source changes between `11bba83` and `HEAD` — commits `43d245f`, `c7b45ff`, `271107e`)
**Status:** issues_found

## Summary

Three changes are in scope: four `.table-scroll` wraps plus a source-level gate for them (G-07-6), the print-press acknowledgement reducer and island (G-07-4), and `followUpRange` moving into `@/core/reporting/copy` with a same-day collapse.

What holds up under adversarial reading:

- The four table wraps are **pure wrappers**. `git diff -w` reduces the 337-line churn across the four files to 27 added lines, all of which are the comment plus `<div className="table-scroll">`/`</div>`. No key, fragment, `caption`, `thead` or conditional-branch change. The mapping-form wrap does not break the form's width contract: `form { display: flex; flex-direction: column }` (globals.css:147) makes the new `div` a stretched flex item at the form's own width, and `overflow-x: auto` contains the 388px table inside it.
- The new gate is **not vacuous**. I mutated `audits/page.tsx` to `<div>` and the suite failed with `"src/app/(console)/audits/page.tsx: 1 table(s), 0 wrapped"`, then restored the file. `uncommentedTsx` also does not eat any real table: stripping all 36 console `.tsx` files preserves all 9 `<table` occurrences.
- The reducer's transition table is correct for the events it models, and the island's listener registration, cleanup and timer discipline are right (stale timers cleared before every state change; ref-based timer is strict-mode safe).
- All four test files pass (`93 passed`).

What does not hold up: **the print feature's only success signal does not exist on the browser it was built for.** The entire G-07-4 hardening is keyed to `beforeprint`/`afterprint`, which WebKit does not implement. On the iPhone Safari that produced the original UAT report, the fallback hint will fire after every press — including successful ones — and then stay on screen permanently, because the reducer has no other exit from `fallback`. That is CR-01 and it inverts the feature's intent. Around it sit an incomplete prefetch mitigation, a live region that is mounted at the same moment as its content, four new scroll boxes no keyboard can scroll, and two source-pin tests whose stated guarantees are wider than what they actually assert.

## Critical Issues

### CR-01: The print acknowledgement's only success signal is unsupported on Safari — the "nothing opened" hint fires on every successful print and never clears

**File:** `src/app/(console)/reports/[client]/[reportId]/print-feedback.ts:59-80`, `src/app/(console)/reports/[client]/[reportId]/print-button.tsx:66-101`
**Severity:** BLOCKER

**Issue:**

`nextPrintFeedback` leaves the `fallback` state on exactly three events: `press`, `beforeprint`, `afterprint`. The island (`print-button.tsx:79-80`) obtains the latter two solely from `window.addEventListener('beforeprint'|'afterprint', …)`.

Safari — desktop and iOS — does not fire either event. The `beforeprint`/`afterprint` "Printing Events" feature is implemented in Chromium, Firefox and legacy Edge only; WebKit has never shipped it, and the documented cross-engine substitute is `window.matchMedia('print')` change notifications. Neither the plan (`07-07-PLAN.md:76-78, 89, 201-204`), the summary (`07-07-SUMMARY.md:56, 155`), the debug note (`.planning/debug/report-print-button-inert.md:23-24`) nor `WINDOWS.md` records any check of that support matrix; the header comments assert `beforeprint` is "the ONLY success signal" without it.

Trace the target device, which is the one the whole change exists for:

1. Operator taps. `press` → `opening`, timer armed for 1500ms, `window.print()` returns.
2. iOS Safari opens its print sheet correctly. **No `beforeprint` fires.**
3. 1500ms later the timer fires. `opening` + `timeout` → `fallback`. The operator is now reading *"Nothing opened? On iPhone use Share → Print…"* while the print sheet is open in front of them.
4. They save the PDF and dismiss the sheet. **No `afterprint` fires.** The state stays `fallback` for the life of the page — through scrolling, through reading the report, until they navigate away or press the button again (which restarts the same cycle).

So on WebKit the feature does the opposite of what it was built to do: it converts a *successful* print into a permanent on-screen claim of failure, and it never produces the "auto-clears on `beforeprint`" behaviour the plan's H3 rationale depends on. The deferred-print case the reducer was designed around (`press → timeout → beforeprint → idle`, asserted at `tests/print-feedback.test.ts:78-88`) is unreachable on the only engine that defers. Chromium is unaffected — the sheet opens, `beforeprint` fires inside `print()`, the timer is cleared — which is precisely why this will not show up in desktop testing.

This is worse than the pre-07-07 behaviour on Safari: before, a silent button was ambiguous; now a working button asserts it is broken, on the route whose output gets stapled to an invoice.

**Fix:**

Give the island the WebKit-supported signal, and give the reducer an engine-independent way out of `fallback` so no future support gap can strand it:

```tsx
useEffect(() => {
  const onBefore = () => { clearTimer(); setFeedback((s) => nextPrintFeedback(s, 'beforeprint')); };
  const onAfter  = () => { clearTimer(); setFeedback((s) => nextPrintFeedback(s, 'afterprint')); };

  window.addEventListener('beforeprint', onBefore);
  window.addEventListener('afterprint', onAfter);

  // WebKit (desktop Safari and iOS Safari) implements neither `beforeprint`
  // nor `afterprint`. The print media query IS observable there, and it is
  // the documented substitute: `matches` going true is the sheet opening,
  // false is it closing. Without this the 1.5s timer wins on every Safari
  // print — including the successful ones — and the hint never clears.
  const printMedia = window.matchMedia('print');
  const onMedia = (event: MediaQueryListEvent) => (event.matches ? onBefore() : onAfter());
  printMedia.addEventListener('change', onMedia);

  return () => {
    window.removeEventListener('beforeprint', onBefore);
    window.removeEventListener('afterprint', onAfter);
    printMedia.removeEventListener('change', onMedia);
    clearTimer();
  };
}, []);
```

and, because iOS Safari's print-preview behaviour is not something this codebase can assert without a device, add a bounded exit from the hint rather than leaving it permanent — a `'dismiss'` event on the reducer (`fallback → idle`) driven by a second timer, or by `document.visibilitychange` returning to visible after a press. Extend `tests/print-feedback.test.ts` with the WebKit sequence end to end (`press → timeout → dismiss → idle`) and pin `matchMedia('print')` in the island's source-pin `it` alongside the two `addEventListener` pins, so the substitute cannot be deleted silently. Update the `print-feedback.ts` and `print-button.tsx` header comments: `beforeprint` is *a* success signal, not the only one, and it is absent on the engine the file spends four paragraphs describing.

## Warnings

### WR-01: The `role="status"` live region is mounted at the same instant as its text — screen readers routinely announce nothing

**File:** `src/app/(console)/reports/[client]/[reportId]/print-button.tsx:105-115`

**Issue:** The `<p role="status">` only exists when `message` is non-null:

```tsx
{message ? (
  <p className="muted hint" role="status">{message}</p>
) : null}
```

A live region has to be present in the accessibility tree *before* its contents change for the change to be announced. When the region and its text are inserted in the same commit, VoiceOver (the reader an operator on the iPhone in question would be using) and NVDA frequently announce nothing at all. So the one affordance CR-01's fallback depends on — telling an operator who cannot see the line that the press was received — is not reliably delivered, while `tests/print-feedback.test.ts:147` asserts only that the string `role="status"` appears somewhere in the file, which passes either way.

**Fix:** Render the region unconditionally and swap only its text, so the region is in the tree from first paint:

```tsx
<p className="muted hint" role="status">
  {message ?? ''}
</p>
```

If the empty paragraph's line box is unwanted, keep the element and collapse it with a class rather than unmounting it (`.report-actions p[role='status']:empty { margin: 0; min-height: 0 }`). Then tighten the pin to assert the region is not inside the conditional — e.g. that `role="status"` occurs before the `{message` expression in the source, or assert on the rendered output.

### WR-02: The prefetch mitigation was applied to the wrong link — the one the diagnosis actually blames still prefetches

**File:** `src/app/(console)/reports/[client]/[reportId]/page.tsx:174` (unchanged), vs. `:413` (changed)

**Issue:** `prefetch={false}` was added only to the "Open version N" link inside `.report-actions`. But the causal story every header comment in this diff tells is: *"Next's default `<Link>` prefetch keeps a burst of RSC requests in flight for exactly the seconds after hydration, which is exactly when the button first works"* (`print-feedback.ts:11-14`). The link that prefetches *at hydration* is the back-link at the top of the same page:

```tsx
<p className="muted report-backlink">
  <Link href={`/reports/${tenant.id}`}>← {tenant.name}</Link>
</p>
```

It is above the fold on load, so its viewport-triggered prefetch is in flight during precisely the window described. The version link, by contrast, sits beside the print button near the bottom and (a) only renders when a newer version exists, and (b) only prefetches once scrolled into view. The change hardened the conditional, rarely-rendered link and left the unconditional one that matches the stated mechanism.

**Fix:** Add `prefetch={false}` to the `.report-backlink` `<Link>` at :174 with the same one-line rationale. Two links on a single operator-only route lose nothing measurable from disabled prefetch, and leaving one live means the diff does not close the hypothesis it claims to.

### WR-03: Four new scroll containers that a keyboard cannot scroll (WCAG 2.1.1)

**File:** `src/app/(console)/clients/[id]/page.tsx:1048`, `src/app/(console)/audits/page.tsx:105`, `src/app/(console)/page.tsx:160`, `src/app/(console)/audits/[id]/mapping/mapping-form.tsx:78`

**Issue:** `.table-scroll` is `overflow-x: auto` (globals.css:319-321) with no `tabIndex`; `grep -rn "tabIndex" src` returns nothing. In Chrome, Edge and Safari a scroll container that holds no focusable descendant is not reachable by keyboard, so its off-screen content is unreachable without a mouse or touch. The sync-runs table (`clients/[id]/page.tsx:1049-1073`) is the clear case — Time, an outcome `<span>` badge, and two integers, with **zero focusable elements** — and it is the table whose own comment says the `response parse error` pill pushes it to 437px on a 390px phone. So the columns the wrapper pushes off-screen are exactly the ones a keyboard user can no longer reach. The Clients and Audits tables are partially rescued by their row links (focus scrolls the box), and the mapping form by its `<select>`s, but none of that is by design.

This mirrors the pre-existing wrappers on `/reports` and `/settings/email`, so it is a pattern defect rather than a novel one — but this diff quadruples the exposure and adds the one table with no focusable content at all.

**Fix:** Make the box a labelled, focusable region — the standard remedy, and a one-line change now that all seven wrappers are uniform:

```tsx
<div className="table-scroll" tabIndex={0} role="region" aria-label="Sync runs">
```

Then extend the new gate in `tests/layout-contract.test.ts` to require `tabIndex={0}` on every `.table-scroll` wrapper, and add a `:focus-visible` outline to the `.table-scroll` rule so the focus stop is visible.

### WR-04: The island's "imports react and its sibling, and nothing else" pin cannot see the import shape that would actually break the bundle

**File:** `tests/print-feedback.test.ts:133-142`; same regex shape at `tests/lint-ban.test.ts:603`

**Issue:** The pin collects specifiers with `/^import\s[\s\S]*?from\s+'([^']+)';$/gm`. Two import forms are invisible to it, and I verified both against the actual regex:

- **Side-effect imports.** Inserting `import '@/db/repository';` at the top of the island yields the specifier list `["react","./print-feedback"]` — the offending line has no `from` clause, so it is simply never matched, the allowlist loop passes, and `specifiers.length > 0` still holds. This is the exact import shape that drags Postgres into a browser bundle, and it is the shape the `describe` block's own header (`lint-ban.test.ts:529-537`) says broke `next build` with four `Module not found` errors.
- **Double-quoted specifiers.** `import x from "@/db/repository";` produces an empty match list.

`lint-ban.test.ts`'s `valueImportSources()` shares the identical blind spot, so the newly added `print-feedback.ts` entry in `CLIENT_REACHABLE` (07-07's own addition) inherits it. The tests therefore pass on code they are advertised to reject.

Note the reducer's own pin at `print-feedback.test.ts:129` (`not.toMatch(/^import\b/m)`) is correct — it catches every form. The island's pin should be equally absolute.

**Fix:** Assert over every import statement, not just the ones with a `from` clause:

```ts
const lines = [...ISLAND.matchAll(/^import\b.*?;$/gms)].map(([line]) => line);
expect(lines.length).toBeGreaterThan(0);
for (const line of lines) {
  const [, specifier] = /from\s+['"]([^'"]+)['"]/.exec(line) ?? [, null];
  // A side-effect import has no `from` — it is never allowed here.
  expect(specifier).not.toBeNull();
  expect(['react', './print-feedback']).toContain(specifier);
}
```

Apply the same `['"]` widening and the same no-`from` rejection to `valueImportSources()` in `lint-ban.test.ts`, where it guards fifteen client-reachable modules rather than one.

### WR-05: The new table gate's scope is narrower than the promise its own comment makes

**File:** `tests/layout-contract.test.ts:62-73, 295-318`

**Issue:** The block is documented as *"A recursive walk rather than a list of pages: the gate below has to fail on the table nobody has written yet, which is the one thing an allowlist of today's pages cannot do."* It does not do that in two ways:

1. **The walk is one route group.** `consoleTsxFiles()` hardcodes `base = 'src/app/(console)'` (36 files walked, confirmed). A table added under any other route group, under `src/app/` directly, or in a shared component outside `(console)` and rendered into the console — the natural place a second table-bearing page would put a `<ClientTable>` — is silently outside the gate while the walk still reports `seen > 0` and passes.
2. **The wrapper must be one exact byte string.** `/<div className="table-scroll">\s*<table\b/` fails on `className="table-scroll wide"`, on a `tabIndex` attribute added to the wrapper (which WR-03's fix requires, and which would break this gate on all seven wrappers at once), on Prettier splitting the div across lines, and on any `<TableScroll>` component abstraction. Those are false positives rather than misses, but the fragility means the first person to touch the wrapper markup will be tempted to relax the regex rather than the scope.

**Fix:** Walk `src/app` and exclude only what legitimately must not be wrapped (email/React-Email templates, if any land under `src/`), and match the class attribute rather than the whole opening tag:

```ts
const WRAPPED = /<div[^>]*className="[^"]*\btable-scroll\b[^"]*"[^>]*>\s*<table\b/g;
```

Keep the `seen > 0` guard. If the scope is deliberately one route group, say so in the comment and drop the "the table nobody has written yet" claim, which is what makes the current text misleading.

## Info

### IN-01: `followUpRange`'s same-day collapse is string equality, not same-day — and the mixed case prints two different dashes together

**File:** `src/core/reporting/copy.ts:112-120`

**Issue:** `if (first === last) return \`${count} · ${first}\`;` runs before anything knows whether the operands are dates. Two `NO_VALUE` markers collapse to `2 · —` (asserted at `tests/reporting-copy.test.ts:160`, so it is intentional), but the asymmetric case falls through to `2 · 1 Aug–—` — an en dash immediately followed by an em dash, on a document a client is billed by. Both branches are near-unreachable in practice (`document.ts:83-84` types `firstTouchAt`/`lastTouchAt` as required `z.iso.datetime()`, so `shortDate` only degrades on data zod already rejected), which is why this is Info and not a Warning — but the doc comment claims a "same-day rule" that the code does not implement.

**Fix:** Make the marker explicit rather than incidental:

```ts
export function followUpRange(count: number, first: string, last: string): string {
  if (first === NO_VALUE && last === NO_VALUE) return `${count} · ${NO_VALUE}`;
  if (first === NO_VALUE || last === NO_VALUE) return `${count} · ${first === NO_VALUE ? last : first}`;
  if (first === last) return `${count} · ${first}`;
  …
}
```

and reword the comment to say what it does: a range whose two *rendered* dates are identical collapses.

### IN-02: `followUpRange` is silently coupled to `shortDate` emitting exactly two space-separated tokens

**File:** `src/core/reporting/copy.ts:114-118`

**Issue:** `sameMonth` is `lastParts.length === 2 && firstMonth === lastParts[1]`. If `shortDate` ever gains a year (`'1 Aug 2026'`), `firstMonth` becomes `'Aug'` while `lastParts.length` becomes 3, so `sameMonth` is false and the long form is printed — safe. But the reverse pairing (`first` three tokens, `last` two) yields `sameMonth === true` and returns `1–2 Aug`, dropping the year from a client-facing figure. The two functions live in the same file with no assertion tying them together.

**Fix:** Add one line to `tests/reporting-copy.test.ts` pinning `shortDate`'s shape — `expect(shortDate('2026-08-01', 'Australia/Perth')).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/)` — so a format change fails at the pin rather than inside the range builder.

### IN-03: `uncommentedTsx` strips any line beginning with `//`, including inside template literals and JSX text

**File:** `tests/layout-contract.test.ts:47-52`

**Issue:** `.replace(/^\s*\/\/.*$/gm, '')` is a line-anchored strip with no string awareness, so a template-literal or JSX-text line that happens to start with `//` (a bare protocol-relative URL, an example comment in copy) is deleted from the text the gate then searches. Likewise the block-comment strip would start a false comment at a `/*` inside a string literal. I verified the current tree is unaffected — all 9 `<table` occurrences survive stripping across all 36 console files — so this is a latent trap, not a live defect. The header comment already explains the anchoring choice; it does not mention the residual risk.

**Fix:** Note the limitation in the comment (it is a heuristic stripper, not a parser, and a `//`-leading line inside a literal will be eaten), and keep the `seen > 0` guard as the backstop against a stripper that eats everything.

---

_Reviewed: 2026-09-03T16:54:09Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Scope: source changes in `11bba83..HEAD` only — prior findings are closed and preserved at `ce5b6ad` and `48794fd`_
