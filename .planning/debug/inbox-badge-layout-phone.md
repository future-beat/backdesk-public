---
status: resolved
trigger: "UAT test 3, Phase 05 — Triage inbox badges are legible and correctly laid out on a ~390px phone viewport"
created: 2026-08-31T00:00:00+08:00
updated: 2026-08-31T00:40:00+08:00
resolved: 2026-09-05
resolution: "Resolved in Phase 5/6 gap closure (Phase 05 UAT test 3 re-verified on the phone; 05-UAT.md status complete)"
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: Bohrbug (deterministic layout defect — reproduces at any ~390px viewport with a classified row)
hypothesis: CONFIRMED compound cause — (a) inbox 05-07 markup nests badge spans inside `.touch-when`, a plain block div with no flex context/gap, unlike every prior `.badge` usage which is a direct flex item of `.touch-list li`; (b) JSX strips the newline whitespace between the timestamp text node and the first badge span, so with no flex gap the rendered HTML is `...5:55 pm<span>Threaded</span><span>reads as...` — zero separation; (c) `.badge` has no `display` declaration → `display: inline`, so when the long Phase-05 label wraps, the pill fragments across line boxes (default `box-decoration-break: slice`) and the border breaks mid-text; (d) `.touch-when { flex: 1 1 12rem }` shares the li's first flex line with `.meta` (phone number) at 390px, squeezing the header to ~200px, which forces the wrap.
test: Static analysis of globals.css + JSX vs screenshot artifacts — every observed artifact matches one mechanism
expecting: n/a — confirmed
next_action: Return ROOT CAUSE FOUND (goal: find_root_cause_only — no fix applied; plan-phase --gaps owns the fix)

reasoning_checkpoint:
  hypothesis: "Inbox row-header badges break on ~390px because 05-07 nested `.badge` spans inside `.touch-when` (a plain block div) instead of the flex context the class was designed for: JSX whitespace-stripping leaves zero separation between the timestamp text node and the pills, `.badge`'s missing `display` declaration leaves the pills `display: inline` so the long Phase-05 classification label fragments across line boxes with a broken rounded border, and `.touch-when`'s `flex: 1 1 12rem` sharing the li's first flex line with `.meta` squeezes the header to ~200px, forcing the wrap."
  confirming_evidence:
    - "Screenshot: 'pm' touches the THREADED pill border with zero gap, pills abut each other, and the READS-AS pill renders as two border fragments with text at the fragment edges — exact signature of inline-box fragmentation (box-decoration-break: slice) plus stripped whitespace"
    - "globals.css 348-357: `.badge` sets border/border-radius/padding/uppercase but no `display` and no `white-space`; sets `align-self: center` which is inert outside a flex container"
    - "globals.css 468-470: `.touch-when` is only `flex: 1 1 12rem` — a flex item, not a flex container; the li's `gap` applies to `.touch-when` itself, not to the badges inside it"
    - "inbox/page.tsx 232-257: timestamp is a bare text node followed (across newlines/JSX comments) by badge spans — JSX strips whitespace containing newlines between children"
    - "Differential: quotes/[quoteId]/page.tsx renders every `.badge` as a DIRECT flex item of `.touch-list li` (blockified, gap-separated, never fragments) and uses explicit `{' '}` inside `.touch-when` — the pre-existing pattern renders correctly"
    - "Screenshot: `.meta` phone number sits on the same visual row, right side — confirming `.touch-when` is squeezed to roughly half the viewport"
  falsification_test: "Render /inbox at 390px with the badges moved out of `.touch-when` (or `.touch-when` made a flex container with gap and `.badge` given `display: inline-block; white-space: nowrap`) — if the collision/fragmentation persists, the hypothesis is wrong. Conversely, at desktop width (wide `.touch-when`) nothing wraps and no artifact shows, which matches why local dev checks passed."
  fix_rationale: "The fix must restore the layout contract `.badge` assumes (flex-item context with gap) rather than patch symptoms: making `.touch-when` a wrapping flex container with gap fixes the missing separation for ALL children regardless of JSX whitespace, blockifies the pills so they can never fragment mid-text, and reactivates `align-self: center`. Adding `white-space: nowrap`/`display: inline-block` to `.badge` hardens the class against any future non-flex parent."
  blind_spots: "Not re-rendered locally after diagnosis (static analysis + screenshot only — but both behaviors, JSX whitespace stripping and inline fragmentation, are spec-defined and deterministic). Longest label 'READS AS NONE OF THE ABOVE — A GUESS' (~320px at 0.8rem uppercase + letter-spacing) may still overflow a 320px viewport even with nowrap — fix planner should check the smallest supported width. Making `.touch-when` a flex container changes the quote-detail page too (the `{' '}` between `#N` and the timestamp becomes a gap) — visually equivalent but should be eyeballed."
  candidate_causes:
    - "code (markup): badges nested inside plain-block `.touch-when` with no whitespace separators — first usage to break the direct-flex-item pattern"
    - "code (CSS): `.badge` lacks `display`/`white-space` — latent inline-fragmentation defect in the shared class"
    - "data: Phase-05 classification label is ~3x longer than any prior badge text; labels only reached production with ANTHROPIC_API_KEY on UAT day"
    - "environment (viewport): 390px phone width plus `.meta` sharing the flex line squeezes `.touch-when` to ~200px; desktop never triggers it"
  and_gate: "yes — the visible breakage requires the markup placement AND the long label AND the narrow squeezed container simultaneously; the CSS defect is latent everywhere but only bites when a badge's own text wraps. Removing any one condition hides (not fixes) the defect."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Inbox row header shows timestamp, THREADED/attribution badge, and the "READS AS {label} — {certainty}" classification pill cleanly; badges legible and tappable one-handed on ~390px phone viewport.
actual: On an iPhone (~390px viewport) the row header wraps badly - the timestamp "29 Aug 2026, 5:55 pm" collides with the THREADED pill ("pm( THREADED )" with no gap), and the "READS AS INTERESTED — NOT CERTAIN" pill wraps mid-text onto a second line with text appearing to overflow the pill's rounded border. Content is correct; layout reads as broken. Verbatim user report - "drafting settings page passed, inbox page unsure (see attachment)"
errors: None reported
reproduction: Production /inbox at quote-recovery-mvp.vercel.app on iPhone (~390px); the row is the threaded "Sounds good" reply from Phase 4 testing. Locally reproducible with dev server at 390px width or by inspecting markup/classes.
started: Discovered during UAT (2026-08-31), first time /inbox rendered with classification label pills on a phone (labels only exist since ANTHROPIC_API_KEY reached production today).

## Eliminated
<!-- APPEND only - prevents re-investigating -->

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-08-31T00:05+08:00
  checked: .planning/debug/knowledge-base.md
  found: Does not exist — no prior resolved sessions
  implication: No known-pattern candidates; investigate from scratch

- timestamp: 2026-08-31T00:10+08:00
  checked: 05-uat-test3-inbox-phone.png (iPhone, ~390px)
  found: Three distinct artifacts — (1) timestamp wraps after "5:55"; "pm" sits on line 2 with the THREADED pill's left border touching it, zero gap; (2) THREADED pill and READS-AS pill abut with no gap; (3) "READS AS INTERESTED — NOT CERTAIN" pill fragments — "READS AS" on line 2 with a partial border, "INTERESTED — NOT CERTAIN" on line 3 inside a separate rounded fragment, text running to the fragment edges. Meanwhile the phone number "+61491578888 · sms" sits top-RIGHT on the same visual row as the header, meaning `.touch-when` occupies only ~half the 390px width.
  implication: Header block is width-constrained AND its inline children have no whitespace between them AND the pill is an inline box that fragments across lines

- timestamp: 2026-08-31T00:15+08:00
  checked: src/app/(console)/inbox/page.tsx lines 230-257 (05-07 markup)
  found: Badges are rendered INSIDE `<div className="touch-when">` alongside a bare text node `{formatReceived(row.receivedAt)}`. Children are separated only by newlines/JSX comments — JSX strips whitespace containing newlines between children, so the emitted HTML has NO whitespace between the timestamp text and the first `<span class="badge">`, nor between consecutive badges.
  implication: Explains artifacts (1) and (2) — separation was implicitly delegated to a flex `gap` that does not exist here

- timestamp: 2026-08-31T00:20+08:00
  checked: src/app/globals.css lines 348-357, 453-482
  found: `.badge` sets border, `border-radius: 999px`, padding, uppercase, letter-spacing — but NO `display` property and no `white-space` → spans compute to `display: inline`. `.badge` also sets `align-self: center`, which only has effect when the badge is a flex item. `.touch-when { flex: 1 1 12rem; }` — it is a flex ITEM of `.touch-list li` (display:flex; flex-wrap:wrap; gap:0.25rem 0.75rem) but is NOT itself a flex container. `.meta` (the phone-number p) has no flex property → content-sized flex item sharing the li's first flex line.
  implication: Inside `.touch-when` the badges are plain inline boxes: they fragment across line boxes when their text wraps (default box-decoration-break: slice → broken rounded borders, artifact 3), get no gap, and `align-self: center` is inert. At 390px the li lays `.touch-when` (basis 12rem, grow) and `.meta` (~160px) on one flex line, squeezing `.touch-when` to ~200px — guaranteeing the long label wraps.

- timestamp: 2026-08-31T00:25+08:00
  checked: grep for all `.touch-when`/`.badge` usages; read quotes/[quoteId]/page.tsx lines 526-577 (differential — the pre-existing working pattern)
  found: Everywhere else, `.badge` spans are DIRECT children of `.touch-list li` (or table cells) — i.e., flex items: blockified (never fragment), separated by the li's `gap`, vertically centred by `align-self`. Inside `.touch-when` on the quote page, whitespace is explicit (`{' '}` line 530). No other CSS rule sets `display` on `.badge` anywhere.
  implication: The `.badge` class was designed to live in a flex context; 05-07 is the first markup to nest badges inside the plain-block `.touch-when`, and the first with a badge label long enough to wrap ("reads as interested — not certain" → uppercased + letter-spaced ≈ 280px vs ~200px available)

- timestamp: 2026-08-31T00:30+08:00
  checked: Why it only appeared now (timeline consistency)
  found: Classification pills only render when `row.label` is non-null — labels exist in production only since ANTHROPIC_API_KEY was deployed (day of UAT). Prior inbox badges (Threaded/STOP) are short and never wrapped; the latent inline-fragmentation and missing-whitespace defects were invisible.
  implication: Timeline matches — data (long label) triggered latent markup/CSS defects at phone width

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "Compound (AND-gate): (1) src/app/(console)/inbox/page.tsx (05-07) nests `.badge` spans inside `<div class=\"touch-when\">` — a plain block, not the flex context the `.badge` class assumes — with the timestamp as a bare text node whose separating JSX newline-whitespace is stripped, so timestamp and pills render with zero gap; (2) `.badge` in src/app/globals.css declares no `display` (spans stay `display: inline`) and no `white-space`, so the long Phase-05 classification label fragments across line boxes and its 999px rounded border breaks mid-text (default box-decoration-break: slice); (3) at ~390px, `.touch-when { flex: 1 1 12rem }` shares `.touch-list li`'s first flex line with the content-sized `.meta` phone-number block, squeezing the header to ~200px and forcing the wrap. Trigger was data: classification labels (~280px rendered) first reached production on UAT day."
fix: "NOT APPLIED — goal was find_root_cause_only. Suggested direction recorded in return payload; plan-phase --gaps owns the fix plan."
verification: "Diagnosis only. Falsification test for the fix: /inbox at 390px (and 320px) with a classified threaded row — timestamp and pills separated by visible gaps, no pill border fragmentation, pills wrap as whole units; quote-detail schedule/ledger lists unchanged."
files_changed: []
