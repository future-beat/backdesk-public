---
phase: 15
status: passed
verified: 2026-10-15
tester: founder (phone) + orchestrator (browser pane at 375px, signed in by the founder)
---

# Phase 15 UAT — 15 Oct 2026

| # | Check | Result |
|---|-------|--------|
| 1 | `/leads`: "No open leads." empty state; Leads third in the nav | pass |
| 2 | Test-tenant client page: Missed calls section (six calls, outcome chips, no number for withheld rows, state line "text-back not armed") | pass — one fail-then-fix: the page scrolled sideways. Measured in the pane at 375px: the go-live checklist's status pills (`.badge`, nowrap) carried a proof id and the three template names (888px and 448px wide). Fixed in `a641750` (`.badge--wrap` on the checklist's status pills; pins, typecheck, lint, build green); re-measured live: scrollWidth 375 = viewport, no element wider than the viewport. |
| 3 | `/reports`: Missed calls column; month-to-date block with "no samples"; header-only CSV download | pass |
| 4 | `/privacy`: callers section (Twilio overseas, ClickSend Australian, Anthropic US, 90 days / no later than 12 months), "Last updated 15 October 2026" | pass (founder noted no console button — correct: it is the public notice, linked from the landing footer) |

Founder confirmations recorded: the example env file was replaced and committed (`0249c2c`, diff scanned for values: none). Pending founder confirmation of two facts in the notice: ClickSend processes in Australia; the 12-month converted-lead ceiling.

Live clauses (first real lead rows, first frozen report with figures, first CSV with data, first pseudonymisation in early January 2027) are event-gated on the first client, as declared in 15-VERIFICATION.md under the 12-09 override.
