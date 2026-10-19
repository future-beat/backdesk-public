---
created: 2026-09-05T00:30:00Z
title: Drafting should call the onboarding-gate helpers instead of re-deriving the rule
area: general
severity: minor
milestone: v1.1
files:
  - src/core/drafting/draft-touches.ts (inline onboarding check via repo.settings.get() + template lookup)
  - src/core/drafting/onboarding-gate.ts (hasApprovedTemplateSet / hasSm8AutomationAttestation / onboardingComplete helpers)
  - tests/onboarding-checklist-gate.test.ts, tests/draft-touches.test.ts
---

## Problem

The v1.0 milestone integration check (2026-09-05) found that `draft-touches.ts` re-implements the onboarding "complete" rule inline (settings row + approved template set) rather than calling the exported helpers in `onboarding-gate.ts` that cadence creation and both resume paths use. It is functionally equivalent today, but a change to the gate's definition of complete (e.g. a third condition) could silently diverge from what drafting checks — the ONB-03/ONB-04 gate would then have two truths.

## Solution

Make drafting consume the same predicate family (`onboardingComplete` / `readOnboardingConditions`) the gate exports; keep drafting's refusal vocabulary (`draftsNotOnboarded`). Add a parity test asserting that for every combination of (approved set present/absent × attestation present/absent) the gate and drafting agree. Pure change; no schema; no remote tests needed beyond the existing suites. Cost: small.
