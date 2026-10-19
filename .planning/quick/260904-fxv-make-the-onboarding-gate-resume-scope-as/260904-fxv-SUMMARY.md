---
phase: quick-260904-fxv
plan: 01
subsystem: testing
tags: [onboarding-gate, cadence-resume, jitter, flake, ONB-03]
status: complete

requires:
  - "src/core/cadence/resume.ts applyResumeRewindow(tenantId, now, { onlyCadenceIds })"
  - "src/core/cadence/window.ts nextAllowedSlot branch 1 (from + jitter)"
  - "src/core/cadence/jitter.ts randomJitterMinutes (inclusive of 0)"
provides:
  - "A resume-scope assertion in tests/onboarding-gate.test.ts that survives a zero-minute jitter draw"
affects:
  - "CI: tests/onboarding-gate.test.ts no longer fails 1 run in 11 on the draw"

tech-stack:
  added: []
  patterns:
    - "Resume-slot assertions use `>=`, matching tests/cadence-resume.test.ts:152-161 (d4661cf, 03-06)"

key-files:
  created: []
  modified:
    - tests/onboarding-gate.test.ts

decisions:
  - "The zero-jitter equality is the 03-05 design, not a bug — the matcher was widened and src/ left untouched, rather than pinning the draw or the clock"
  - "No test-only jitter seam was added to approveTemplateVersion / finishResume for the sake of one assertion"

metrics:
  duration: ~8 min
  completed: 2026-09-04
  tasks: 1
  commits: 1
  files: 1

actuals:
  tokens: 1148
  tasks: 1
  commits: 1
---

# Quick Task 260904-fxv: Make the onboarding-gate resume-scope assertion tolerate a zero jitter draw — Summary

The ONB-03 resume-scope case now accepts a first touch placed exactly on `approvedAt`, with the reason written beside it: a zero-minute jitter draw is the designed answer to "may we send now", not a defect.

## What Was Built

One two-hunk change to `tests/onboarding-gate.test.ts`, inside
`resumes ONLY the onboarding-paused cadences, and re-windows only those`:

1. **The matcher.** The loop over every touch of `gatedCadenceId` now asserts
   `toBeGreaterThanOrEqual(approvedAt.getTime())` instead of the strict
   `toBeGreaterThan(...)`. The loop shape is unchanged — it still covers both
   touches, with no special case for touch 1.
2. **The comment.** A 34-line `//` block immediately before the loop, in the
   file's established voice, recording the mechanism (`approvedAt` → `resumeAt`
   → `nextAllowedSlot` branch 1 → `from + jitter`, where
   `floor(random * (JITTER_MAX_MINUTES + 1))` is inclusive of zero, so
   P = 1/11), the evidence (CI run 33825524839, commit 890160d, docs-only:
   `expected 1788485276468 to be greater than 1788485276468` at 2026-09-04
   09:27:56 AWST), the precedent (`tests/cadence-resume.test.ts:152-161`,
   commit d4661cf, 03-06), why a fake clock was rejected, and why `>=` is still
   load-bearing.

No file under `src/` was touched. `git diff --quiet HEAD -- src` exited 0
before the commit, and `git show --stat --format= HEAD` lists exactly one file.

## Why `>=` Still Proves the Re-Window

Both gated touches are seeded at `hoursAgo(30)` and `hoursAgo(29)` — i.e. 30
and 29 hours BEFORE `approvedAt` — and the result literal pins
`touchesRescheduled: 2`. Any instant `>= approvedAt` is therefore roughly
thirty hours later than what the fixture wrote. A touch that was NOT
re-windowed still fails the assertion by about 30 hours. Only touch 1 can ever
equal `approvedAt`; touch 2 is chained from it by a 3-day delta
(`slotAtOffsetDays`, resume.ts:159).

## Key Decisions

**The equality is designed, so the test moved and the code did not.** 03-05
decided that "may we send now" is answered by asking `nextAllowedSlot` whether
the next allowed slot from now IS now, and window.ts:360 documents the property
as "the return is never before `from`" — never-before, not strictly-after. A
strict `>` was asserting something the system never promised.

**A fake clock was rejected.** `approveTemplateVersion` → `finishResume` →
`applyResumeRewindow(tenantId, now, { onlyCadenceIds })`
(onboarding-gate.ts:311-313) passes no `jitterMinutes`, so the draw cannot be
pinned from the test. Pinning the clock outside contact hours would route
placement through branches 2/3 (roll to the next day's preferred slot) — a
different path from the one this block exercises. Adding a test-only jitter
seam to a production signature for one assertion is the wrong trade.

## Verification

| Check | Result |
|-------|--------|
| `grep -v '^\s*//' … \| grep -c 'toBeGreaterThan(approvedAt'` | `0` (was 1) |
| `grep -c 'toBeGreaterThanOrEqual(approvedAt.getTime())'` | `1` (was 0) |
| `grep -c '33825524839'` / `'cadence-resume.test.ts'` / `'d4661cf'` | `≥1` each (all 0 before) |
| `grep -c "^import { afterAll, describe, expect, it } from 'vitest';$"` | `1` — no `vi` import; the file has exactly one `from 'vitest'` line |
| `git diff --quiet HEAD -- src` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npx eslint tests/onboarding-gate.test.ts --max-warnings=0` | exit 0 |
| `env -u ALLOW_REMOTE_TESTS npx vitest run tests/onboarding-gate.test.ts` | non-zero exit, refused before any connection — **but at an earlier guard than planned** (see Deviations) |

**The hosted Sydney Supabase was never contacted.** `npm run test:remote` was
not run and `ALLOW_REMOTE_TESTS` was never set (confirmed unset in the
environment before the run, and the one vitest invocation was wrapped in
`env -u ALLOW_REMOTE_TESTS`).

## Pending Confirmation — CI

**Behavioural proof of this fix is CI's next run**, which executes this file
against its own `supabase start` local stack (`.github/workflows/*.yml:90,199`).
Nothing local can run the test: this worktree has no disposable stack, so the
assertion has been proven only by inspection and by the greps above. The claim
to confirm on the next CI run is that
`resumes ONLY the onboarding-paused cadences, and re-windows only those`
passes regardless of the jitter draw.

## Deviations from Plan

**1. [Rule 1 — Plan expectation was one guard off] The local vitest step refused earlier than documented.**

- **Found during:** Task 1, step 3.
- **Expected (per plan):** a non-zero exit whose output contains
  `Refusing to run integration tests against a non-local Supabase stack`
  (the WR-09 URL guard, `tests/helpers/env.ts:141`).
- **Actual:** a non-zero exit at the *preceding* guard,
  `tests/helpers/env.ts:130-138`:
  `Integration tests need these environment variables: CLICKSEND_WEBHOOK_SECRET, CLICKSEND_DLR_SECRET, UNSUBSCRIBE_SIGNING_SECRET, MESSAGING_RECONCILE_SECRET, STALLED_DIGEST_SECRET.`
  Both guards live in `resolveTestEnv`, and the missing-secrets check runs
  first, so in this worktree the URL check is unreachable — `.env.local` does
  not carry those five secrets. The throw happens on the first credential read
  (`Object.get url`, env.ts:184, via `tests/helpers/seed.ts:25`), before
  `beforeAll` and before any connection is opened.
- **Consequence:** the plan's `<automated>` verify chain has one clause that
  cannot pass in this worktree (the grep for the WR-09 refusal string). Every
  other clause passed.
- **Why nothing was done about it:** the safety property the step exists to
  demonstrate — that an unflagged local run cannot reach the hosted database —
  holds *more strongly* than planned, since the run aborts a guard earlier.
  Supplying the five missing secrets to force the URL guard to fire would move
  the run *toward* production credentials to satisfy a grep, which inverts the
  point of the check. **No code, env file, or command was changed to work
  around it.**
- **Files modified:** none.

## Known Stubs

None.

## Threat Flags

None. The change is confined to one assertion in one test file; T-fxv-02's
mitigation (30h fixture + `touchesRescheduled: 2` keep the loosened matcher
load-bearing) is intact and is now written into the file as a comment so a
later reader does not "fix" the `>=` back to `>`.

## Self-Check: PASSED

- `tests/onboarding-gate.test.ts` — FOUND (modified, committed)
- `.planning/quick/260904-fxv-make-the-onboarding-gate-resume-scope-as/260904-fxv-SUMMARY.md` — FOUND
- Commit `78b7e71` — FOUND in `git log`, one file, subject
  `fix(05): onboarding-gate scope assertion accepts a first touch equal to approvedAt`,
  trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` confirmed
  via `git log -1 --format='%(trailers)'`
