---
status: complete
phase: 05-ai-drafting-classification
source: [05-VERIFICATION.md]
started: 2026-08-31T04:45:00Z
updated: 2026-08-31T08:22:20Z
---

## Current Test

[testing complete]

## Tests

### 1. Judgment-tier prohibitions sign-off
expected: The three prohibitions above hold on reading the code/behavior; operator signs off (05-VERIFICATION.md lists the evidence pointers).
result: pass

### 2. Production deploy before arming any client
expected: |
  `git push origin main` → Vercel deploys the Phase 5 build → production's cadence tick runs the real D-12 gates
  (promoteDue stops at needs_draft; cadences for unapproved tenants are born paused('onboarding')).
  Until deployed, production still runs the Phase 4 build where promoteDue auto-approves — do NOT arm any real client before this.
result: pass
note: pushed b8f57b5..133ff9b; Vercel deployment dpl_5QtnUQKNfBy41ABsejrXLsjqwwwr READY on production (syd1) at commit 133ff9b; cadence-tick, sync-tick and inbound webhook all answer 401 to a wrong token (deployed, env parses)

### 3. Phone-viewport console ergonomics
expected: |
  On a ~390px phone viewport: the drafting settings page (voice profile + templates + attestation) is usable one-handed;
  the draft-review card on the quote-detail page allows approve / edit-then-approve comfortably;
  triage inbox badges (soft opt-out one-tap, needs-human, hot) are legible and tappable.
result: pass
note: |
  Initially reported as issue (badge layout at 390px, gap G-05-3); fixed by gap plan 05-08,
  deployed at a02a731, and user confirmed on device 2026-08-31: "inbox passed".
  Drafting settings page PASS. The PDF observations (pre-opened 'Write the wording' disclosure,
  no attestation control) verified as by-design empty states — attestation renders per saved version.
detail: |
  Screenshot (05-uat-test3-inbox-phone.png, iPhone ~390px): inbox row header wraps badly —
  the timestamp "5:55 pm" collides with the THREADED pill, and the "READS AS INTERESTED — NOT CERTAIN"
  pill wraps mid-text across two lines with text overflowing the pill border. Badges are readable but
  the layout reads as broken. Classification content itself is correct.
  Drafting settings page: PASS. Draft-review card: untestable until first draft exists in production
  (no approved templates yet) — deferred to first-client onboarding, not a gap.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-05-3
  truth: "Triage inbox badges are legible and correctly laid out on a ~390px phone viewport"
  status: resolved
  resolved_by: 05-08-PLAN.md
  resolved_at: 2026-08-31
  reason: "User reported: drafting settings page passed, inbox page unsure (see attachment) — screenshot shows timestamp/THREADED pill collision and the READS-AS pill wrapping mid-text outside its border on iPhone; fixed by 05-08, confirmed on device"
  severity: cosmetic
  test: 3
  root_cause: "Compound: (1) inbox row nests .badge pills inside the non-flex .touch-when block (breaking the direct-flex-item contract every other .badge usage follows) with JSX-stripped whitespace leaving zero gap after the timestamp; (2) .badge declares no display/white-space so inline boxes fragment mid-text across line boxes (border slices); (3) .touch-when (flex: 1 1 12rem) shares the wrapped flex line with .meta at 390px, squeezing the header so the ~280px classification pill always wraps. Latent since 05-07; first exposed when classification labels reached production."
  artifacts:
    - path: "src/app/(console)/inbox/page.tsx"
      issue: "lines 232-257: badges nested in non-flex .touch-when; timestamp bare text node with no separator"
    - path: "src/app/globals.css"
      issue: "lines 348-357 .badge missing display/white-space hardening; 468-470 .touch-when not a flex container"
    - path: ".planning/phases/05-ai-drafting-classification/05-uat-test3-inbox-phone.png"
      issue: "screenshot evidence"
  missing:
    - "Make .touch-when a wrapping flex container (display:flex; flex-wrap:wrap; align-items:center; gap:0.25rem 0.5rem)"
    - "Harden .badge: display:inline-block; white-space:nowrap; max-width:100%"
    - "Handle narrow viewports for the longest label (~320px rendered) — full-row .touch-when under a phone media query or equivalent"
    - "Eyeball the quote-detail .touch-when (shares the class) at 390px after the change"
  debug_session: .planning/debug/inbox-badge-layout-phone.md
