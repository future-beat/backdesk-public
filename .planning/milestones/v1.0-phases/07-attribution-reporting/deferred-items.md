# Deferred Items — Phase 07

Out-of-scope discoveries logged during execution. Recorded so they are not
rediscovered as "new" later. Both entries were resolved at milestone close on 2026-09-05 — see the `status:` field under each.

## From 07-02 (attribution & reporting rules)

- **`src/core/audit/aggregate.ts:88-98` — a doc comment states a false floating-point fact.**
  The `RECOVERY_RATE_BASIS_POINTS` comment claims `0.15 * 10_000` is
  `1500.0000000000002`. It is exactly `1500`. The CODE is correct and the
  `Math.round` is still worth keeping (it guards the constant against being
  edited to a value that is inexact, e.g. `0.07` or `0.57`) — only the stated
  reason is wrong. The equivalent comment in `src/core/attribution/baseline.ts`
  was written correctly in 07-02.
  - Owner file is Phase 2's and untouched by 07-02; fixing it here would be
    scope creep into another plan's `files_modified`.
  - Cost to fix: one comment rewrite, no behaviour change, no test change.
  status: resolved
  resolution: "Comment rewritten at milestone close, 2026-09-05 (`fix(02)`, commit 576cc22): `0.15 × 10 000` is exactly `1500`; the round now reads as the guard it is."

## From 07-03 (attribution consumer)

- **`tests/onboarding-gate.test.ts:356` — a wall-clock boundary flake in the
  re-window assertion.** `resumes ONLY the onboarding-paused cadences, and
  re-windows only those` asserts
  `touch.scheduledAt.getTime() > approvedAt.getTime()`, where
  `approvedAt = new Date()` (line 232) is the REAL clock. Observed failing once
  during 07-03's full-suite regression run with
  `expected 1788329815516 to be greater than 1788329815516` — the re-windowed
  slot landed on exactly the approval millisecond. Re-run in isolation
  immediately afterwards: 13/13 passed.
  - NOT caused by 07-03. Nothing in this plan is reachable from
    `approveTemplateVersion` — the diff is the attribution consumer, three new
    evidence reads, the tick's attribution seam and doc comments.
  - The honest fix is a boundary decision somebody has to make, not a retry:
    either the assertion becomes `toBeGreaterThanOrEqual` (a touch scheduled AT
    the approval instant has not been pulled earlier, which is what
    `b020f01 fix(03): a resume must never pull a not-yet-due touch earlier`
    actually guarantees), or `rewindowTouch` is specified to place strictly
    after its input and the assertion stays. Owner is Phase 3/5, not this plan.
  - Cost to fix: one line, plus the paragraph explaining which of the two rules
    is the real one.
  status: resolved
  resolution: "Fixed by quick task 260904-fxv (commit 78b7e71, merged a57416f): the assertion is `>=` because D-07's jitter draw is inclusive of zero; CI green on the merge."
