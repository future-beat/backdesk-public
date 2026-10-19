---
phase: 13
status: passed
verified: 2026-10-09
tester: founder (phone)
---

# Phase 13 UAT — founder, on the phone, 9 Oct 2026

| # | Check | Result |
|---|-------|--------|
| 1 | Test-tenant client page: "After-hours escalation" row reads Off; control shows the checkbox and the "Emergencies and URGENT replies are always sent" sentence; not saved | pass |
| 2 | `/queue`: no lead card (zero lead cadences on production); no `/quotes/null` links | pass |
| 3 | `/inbox`: no snake_case label, no stray urgency chip, no lead rows | pass |

Live clauses (touch 2 in the queue, a lead reply in the lead vocabulary, a held/released escalation, ring-twice) are event-gated on the first client, as declared in 13-VERIFICATION.md under the 12-09 override.
