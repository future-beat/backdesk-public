# 07-06 verification harness (G-07-1, G-07-2, G-07-3)

Planner-created scaffold for the Phase 7 gap-closure plan `07-06-PLAN.md`. It exists so the
plan's `<verify>` steps are real prints and real layouts, not grep gates alone. Synthetic data
only; nothing here reads the database, the network or an env file.

| File | What it does |
|------|--------------|
| `run.sh` | Prints the report fixture through headless **Google Chrome** (A4, `@page` margins) and, when `swiftc` exists, through **WKWebView** (1 CSS px = 1 pt, the iPhone geometry). Asserts: no trailing blank page, every job row keeps its figures on one page, no page opens with a cut row, `#4200 · ` separated; Chrome additionally: header on every continuation page carrying rows. Section A applies the `@media print` block on screen at 661px and 688px and asserts trailing gap 0, one-line rows, table fits, `.table-scroll` overflow visible, thead `break-inside: avoid`. WebKit header repetition is reported as INFO (accepted engine debt). |
| `gen.mjs` | Writes the fixtures: a hand-mirrored copy of the report page's DOM (40 worst-case rows) that `<link>`s the real `globals.css` + `report.css`. Keep its table markup in step with `page.tsx`. |
| `wkprint.swift` | The WebKit leg: `WKWebView.printOperation` to PDF. `WK_MARGIN_PT` sets the page margins in points (default 49.7, measured on the operator's iOS PDF). Its absolute scale sits ~0.87 of the iPhone's — direction evidence; the iPhone print is the acceptance. |
| `nav-check.sh` / `gen-nav.mjs` (G-07-3, quick-260904-dwt) | Renders the console bar (brand + seven items + Queue badge) over the real `globals.css` inside a 390 / 604 / 700px iframe in headless Chrome. Asserts at **every** width: `document.documentElement.scrollWidth === viewport`, the bar itself (`barRight` — brand + the link row's own box) inside the viewport, **ONE row ≤ 72px**, `Sign out` box ≥ 44px, smallest tap box ≥ 44px, no two hit boxes intersecting, no label broken mid-phrase. At **390 / 604px** (the row scrolls): `.nav nav` `scrollWidth > clientWidth` with `overflow-x: auto`, resting at `scrollLeft 0`, **Inbox and Queue fully visible without a swipe**, a cue at the right edge (an item cut — `Reports` at 390 — or, where nothing is cut, the fade wired as a `linear-gradient` mask), ≥ 3px of focus-ring headroom on the first and the focused last item, `Sign out` fully in view **both** on keyboard focus (the row carries no `tabIndex`) **and** after scrolling the row to its end. At **700px**: nothing scrolls, `navRight` (all descendants) inside the viewport, bar exactly 72px, **no fade**. `--nav-fade` / the computed mask are printed as `INFO` at the scrolling widths — headless Chrome advances no scroll timeline under `--dump-dom`, so the fade's travel is the iPhone human check, not a gate. **Negative control:** `GLOBALS_CSS=$(git show 898bce3:src/app/globals.css)` (the 07-06 wrapping bar) must print `RESULT: FAIL`. |
| `tables-check.sh` / `gen-tables.mjs` (07-07, G-07-6) | Renders each console table that UAT found outside `.table-scroll` (Clients on `/`, sync runs, audits list, the mapping table) plus the `/reports` control, with worst realistic content, over the real `globals.css` inside a 390px and a 1000px iframe. **The wrapper in each fixture is read from the shipped `.tsx`** (comments stripped, nth `<table` checked for a preceding `<div className="table-scroll">`), so the script fails on unwrapped source and passes once the wrapper is in the file — no React render needed. Asserts at 390px: wrapper present in source, `document.documentElement.scrollWidth === 390`, the console bar (`barRight`) inside; a `control-bare` fixture (always unwrapped) must widen the document, proving the probe can see an overflow; at 1000px: document viewport-wide and no table scrollbar (the wrapper is inert on desktop). `ROOT=<dir>` points it at a patched copy of the tree. |

Run from the repo root:

    bash .planning/phases/07-attribution-reporting/07-06-harness/run.sh
    bash .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh
    bash .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh

Overrides for testing the harness itself: `GLOBALS_CSS=`, `REPORT_CSS=`, `OUT=`, `ROOT=`, `CHROME=`.
Requires: Google Chrome, poppler (`pdftotext`, `pdfinfo`), node; `swiftc` for the WebKit leg.

Planner evidence (2026-09-03): on today's source both scripts FAIL naming the UAT defects; on
patched copies embodying the plan's edits both print `RESULT: PASS`.

`tables-check.sh` FAILS on the pre-07-07 source (clients 620 / runs 437 / audits 464 / mapping
408px at 390px, against a 350px content box) and PASSES on a patched copy carrying the four
wraps (`ROOT=<copy>`) — every fixture exactly 390 at 390px, exactly 1000 with no table scrollbar
at 1000px, with `control-bare` still widening to 620 so the probe is demonstrably not blind.
Confirmed against the shipped tree by 07-07 execution: FAIL before the wraps, `RESULT: PASS`
after, with no CSS change (`globals.css` still at `6ed9105`).

Planner/executor evidence (quick-260904-dwt, 2026-09-04): `nav-check.sh` grew the scroll-row
gates and both nav probes moved from the all-descendants `navRight` to the bar-level `barRight`,
because a row that scrolls *inside* the viewport reports descendants at 651px at 390px and would
otherwise have failed "nav content reaches 651px" on correct CSS. On the shipped tree the script
prints `RESULT: PASS` — 390px: bar 72px / 1 row, document 390, row box 221px against 502px of
content, `Inbox, Queue, Audits` whole and `Reports` cut, ring headroom 4px, `Sign out` in view on
focus and at `scrollLeft 281` of 281; 604px: 72px, row 435/502, nothing cut (the edge falls in the
gap before `Sign out`) so the wired fade carries the cue; 700px: 72px, `rowScrollable false`,
`navRight` 684, no fade. Pointed at the pre-change CSS via `GLOBALS_CSS=` it exits 1 with
`RESULT: FAIL`, naming `bar is 3 lines / 176px, not one row` and `the link row does not scroll`
at 390px — so the PASSes above are not vacuous. `tables-check.sh` still prints `RESULT: PASS`
after the `navRight` → `barRight` change.
