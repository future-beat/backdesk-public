---
phase: quick-260904-fxv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tests/onboarding-gate.test.ts
autonomous: true
requirements: [ONB-03]

estimate:
  tokens: 20000
  raw_tokens: 20000
  tasks: 1
  confidence: low

must_haves:
  truths:
    - "The resume-scope case in tests/onboarding-gate.test.ts no longer reddens when the production jitter draw is ZERO minutes: a first touch placed exactly ON `approvedAt` passes, exactly as tests/cadence-resume.test.ts:161 already accepts a first touch ON `resumeAt` (D-07 / decision 03-05)"
    - "The assertion still proves the re-window happened: both gated touches were seeded 30h and 29h BEFORE `approvedAt` and the result literal pins `touchesRescheduled: 2`, so any instant `>= approvedAt` is ~30 hours later than what was seeded"
    - "No production code changes — the equality is the designed answer to 'may we send now', not a bug, so src/ is untouched and `approveTemplateVersion` gains no test-only jitter seam"
    - "The hosted Sydney Supabase is never touched by this task: no `npm run test:remote`, no `ALLOW_REMOTE_TESTS=yes`; the documented local vitest step is EXPECTED to stop at the WR-09 remote-gate refusal, and the behavioural proof is CI's next run against its `supabase start` stack"
  artifacts:
    - "tests/onboarding-gate.test.ts — line 356 uses `toBeGreaterThanOrEqual`, preceded by a comment block in the file's voice citing the zero-jitter draw, CI run 33825524839, the rejected fake-clock route, and why `>=` still proves the re-window"
  key_links:
    - "test:333 `approvedAt` -> onboarding-gate.ts:387 `now` -> onboarding-gate.ts:311 `applyResumeRewindow(tenantId, now, { onlyCadenceIds })` -> resume.ts:132 `nextAllowedSlot(resumeAt, …, jitterMinutes)` -> window.ts:396 `from + jitter * MS_PER_MINUTE` with `jitterMinutes` defaulting to `randomJitterMinutes` (resume.ts:245), whose draw jitter.ts:36 `floor(random * (JITTER_MAX_MINUTES + 1))` is inclusive of 0 — one run in eleven lands touch 1 exactly on `approvedAt`"
    - "test:279-280 `hoursAgo(30)` / `hoursAgo(29)` + test:340 `touchesRescheduled: 2` -> the fixture and the result literal are what make `>=` sufficient; the loop at test:355-357 still covers BOTH touches, and touch 2 is chained from touch 1 by resume.ts:159 `slotAtOffsetDays(previous.at, 3, …)` so only touch 1 can ever equal `approvedAt`"
    - "tests/helpers/env.ts:141 `!LOCAL_HOST_PATTERN.test(url) && process.env.ALLOW_REMOTE_TESTS !== 'yes'` -> an unflagged local `npx vitest run tests/onboarding-gate.test.ts` in this worktree (`.env.local` only, no `.env.test`) throws the refusal before `beforeAll`; that refusal is the documented, expected outcome of the local step"
---

<objective>
Make the onboarding-gate resume-scope assertion tolerate a zero jitter draw. Replace the strict comparator at tests/onboarding-gate.test.ts:356 with `toBeGreaterThanOrEqual(approvedAt.getTime())` and record, in the file's own voice, why equality is the designed outcome (D-07 / 03-05), which CI run exposed it, why a fake clock was rejected, and why `>=` still proves the re-window.

Purpose: CI run 33825524839 (commit 890160d, docs-only) failed `approveTemplateVersion > the version that completes the set > resumes ONLY the onboarding-paused cadences, and re-windows only those` with `expected 1788485276468 to be greater than 1788485276468` — 2026-09-04 09:27:56 AWST, a Friday inside Perth contact hours. That is not a clock race: `approvedAt` is passed in explicitly and the first unsent touch is placed by `nextAllowedSlot` branch 1 at `from + jitter`, where the production draw is inclusive of zero. One run in eleven puts touch 1 exactly ON `approvedAt`, and the strict `>` fails on the draw rather than on the behaviour. tests/cadence-resume.test.ts:152-161 already made this exact call for the same reason (commit d4661cf, `fix(03-06): resume-slot assertions accept a slot equal to now`); this brings the ONB-03 suite in line with it.

Output: one edited test file, one commit `fix(05): …`. No src/ change.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@tests/onboarding-gate.test.ts
@tests/cadence-resume.test.ts
@src/core/cadence/window.ts
@src/core/cadence/jitter.ts
@src/core/cadence/resume.ts
@src/core/drafting/onboarding-gate.ts
@tests/helpers/env.ts
</context>

<planner_evidence>
Read from source by the planner on 2026-09-04 (worktree HEAD fcb5bf7). Line numbers are exact.

- **The assertion.** tests/onboarding-gate.test.ts:355-357 loops over EVERY touch of `gatedCadenceId` and asserts `scheduledAt` is strictly greater than `approvedAt`. `approvedAt` is `new Date()` at :232 and is passed as the fourth argument at :333.
- **The fixture.** :271 `hoursAgo(n)`; :278-281 seeds the gated cadence's two touches at `hoursAgo(30)` (offset 0) and `hoursAgo(29)` (offset 3). :336-347 pins the result literal including `touchesRescheduled: 2` — both touches provably moved.
- **The path.** onboarding-gate.ts:383-387 `approveTemplateVersion(tenantId, versionId, note, now)`; :427 `finishResume(tenantId, now, written.resumedIds)`; :311-313 `applyResumeRewindow(tenantId, now, { onlyCadenceIds: [...resumedIds] })` — NO `jitterMinutes` in the options. resume.ts:245 `const { jitterMinutes = randomJitterMinutes, onlyCadenceIds } = options;`.
- **The placement.** resume.ts:128-153: the first unsent touch (`previous === null`) is `nextAllowedSlot(resumeAt, …)` (:132), then clamped so it is never EARLIER than the touch's current slot (:153) — a 30h-overdue touch is therefore moved to the slot, not left alone. Later touches (:154-170) are `slotAtOffsetDays(previous.at, delta, …)` with `delta = max(0, 3 - 0) = 3` days — strictly later than touch 1.
- **Branch 1.** window.ts:389-397: on a contact day, inside the window with margin, `return new Date(from.getTime() + jitter * MS_PER_MINUTE)`. window.ts:360 documents "THE RETURN IS NEVER BEFORE `from`" as the property D-01 rests on — never-before, not strictly-after.
- **The draw.** jitter.ts:35-37 `Math.floor(Math.random() * (JITTER_MAX_MINUTES + 1))`, constants.ts:66 `JITTER_MAX_MINUTES = 10`; jitter.ts:27-33 explains the inclusive bound on purpose. P(jitter = 0) = 1/11.
- **The precedent.** tests/cadence-resume.test.ts:152-161: "`>=`, NOT `>`: when this suite runs INSIDE Perth contact hours the first rescheduled touch lands exactly on `resumeAt`, because 03-05 decided that 'may we send now' is answered by asking nextAllowedSlot whether the next allowed slot from now IS now. A strict `>` therefore failed on the clock rather than on the behaviour." Introduced by commit d4661cf. (The pre-diagnosis attributed it to quick task 260828-jx0; git blame says d4661cf under 03-06. Cite d4661cf.)
- **The gate.** tests/helpers/env.ts:141-153 throws "Refusing to run integration tests against a non-local Supabase stack." when the URL is not local and `ALLOW_REMOTE_TESTS !== 'yes'`. This worktree has `.env.local` and no `.env.test` (`ls .env*`), so the refusal is what an unflagged run produces here. vitest.config.mts `globalSetup` (tests/helpers/global-setup.ts) is a no-op unless the run is sanctioned. CI (`.github/workflows/*.yml:90,199`) runs `supabase start` then `npx vitest run` — the local stack is where this test actually executes.
- **Baselines.** `grep -c 'toBeGreaterThanOrEqual' tests/onboarding-gate.test.ts` → 0 today; `grep -c '33825524839'` → 0; the vitest import is `import { afterAll, describe, expect, it } from 'vitest';` (no `vi`).
</planner_evidence>

<tasks>

<task type="auto">
  <name>Task 1: Accept a first touch ON approvedAt in the resume-scope case, and say why in the file's voice</name>
  <files>tests/onboarding-gate.test.ts</files>
  <action>
Run everything from the worktree root `~/Documents/Projects/Productised service/.claude/worktrees/strange-mcclintock-0f7402`. Do NOT cd to the original repository root. Edit with `Edit` (scoped); this is a two-hunk change to one file.

**1. The matcher (line 356).** Inside the `for (const touch of await repo.touches.listForCadence(gatedCadenceId))` loop at :355-357, change the matcher on the `scheduledAt` assertion from the strict form to `toBeGreaterThanOrEqual(approvedAt.getTime())`. Keep the loop covering BOTH touches — do not special-case touch 1; touch 2 is strictly later anyway (chained from touch 1 by `slotAtOffsetDays` with a 3-day delta, resume.ts:159) and the loop shape is the same one cadence-resume.test.ts:152 uses.

**2. The comment.** Insert a `//` comment block immediately BEFORE the `for` at :355 — i.e. after the `expect({ status: gated.status, … }).toEqual({ status: 'active', pauseReason: null })` at :351-354, and leaving the existing "The gate opened for the cadence it was holding …" (:349) and "… AND NOT FOR THE ONE IT WAS NOT." (:359) ellipsis pair intact. Write it in this file's established voice (see :237-252, :267-270, :293-309: a capitalised headline phrase, then plain prose that names the mechanism, the evidence, and the rejected alternative; no bullet lists). It must state, in prose, ALL of the following:

- The headline: `>=`, NOT `>` — the same call tests/cadence-resume.test.ts:152-161 makes (commit d4661cf, 03-06), for the same reason, and "never in the past" is what D-07 promises and what `>=` states.
- The mechanism: `approvedAt` goes in as `now`, becomes `resumeAt` in `computeResumeSchedule` (src/core/cadence/resume.ts:132); inside Perth contact hours on a contact day `nextAllowedSlot` branch 1 (src/core/cadence/window.ts:390-397) answers `from + jitter`; the production draw `randomJitterMinutes()` (src/core/cadence/jitter.ts:35-37) is `floor(random × (JITTER_MAX_MINUTES + 1))`, inclusive of ZERO on purpose, so one run in eleven places touch 1 exactly ON `approvedAt`. That equality is the 03-05 design — "may we send now" is answered by whether the next allowed slot from now IS now — not a bug, which is why nothing in src/ changes.
- The evidence: CI run 33825524839 (commit 890160d, a docs-only change) failed here with `expected 1788485276468 to be greater than 1788485276468` — 2026-09-04 09:27:56 AWST, a Friday inside hours. A strict `>` failed on the draw, not on the behaviour.
- Why a fake clock was rejected: `approveTemplateVersion` → `finishResume` → `applyResumeRewindow(tenantId, now, { onlyCadenceIds })` (src/core/drafting/onboarding-gate.ts:311-313) passes NO `jitterMinutes`, so the draw cannot be pinned from this test; pinning the clock OUTSIDE contact hours would route the placement through branches 2/3 (roll to the next day's preferred slot) — a different path from the one this block exercises — and adding a test-only jitter seam to a production signature for one assertion is the wrong trade.
- Why `>=` still proves the re-window: both touches were seeded 30 and 29 hours BEFORE `approvedAt` (`hoursAgo` above), and the result literal already pins `touchesRescheduled: 2`, so any instant `>= approvedAt` is roughly thirty hours later than what was seeded. Only touch 1 can ever equal `approvedAt`; touch 2 is chained from it by a 3-day delta.

Do NOT: touch any file under src/; add a `jitterMinutes` option to `approveTemplateVersion` or `finishResume`; import `vi` or use any fake-clock helper; widen the change beyond the one loop; run `npm run test:remote` or set `ALLOW_REMOTE_TESTS` — the hosted Supabase is production shared with live cron ticks.

**3. Verify locally (typecheck + lint are the real gates here).** `npm run typecheck` and `npx eslint tests/onboarding-gate.test.ts --max-warnings=0` must both exit 0. Then run the documented step `env -u ALLOW_REMOTE_TESTS npx vitest run tests/onboarding-gate.test.ts` — its EXPECTED outcome is a non-zero exit whose output contains `Refusing to run integration tests against a non-local Supabase stack`. That proves the WR-09 gate held (this worktree has `.env.local` and no `.env.test`); it does not and cannot run the test. The behavioural proof of the fix is CI's next run, which executes this file against its `supabase start` stack — record that in the SUMMARY as the pending confirmation.

**4. Commit** exactly one file, `tests/onboarding-gate.test.ts`, with subject `fix(05): onboarding-gate scope assertion accepts a first touch equal to approvedAt` and a body that names the zero-jitter draw (1 in 11), CI run 33825524839, the cadence-resume precedent d4661cf, and that the 30h fixture + `touchesRescheduled: 2` keep the assertion load-bearing; end the message with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Confirm beforehand with `git diff --quiet HEAD -- src` (exit 0) that src/ is untouched.
  </action>
  <verify>
    <automated>cd "~/Documents/Projects/Productised service/.claude/worktrees/strange-mcclintock-0f7402" && test "$(grep -v '^\s*//' tests/onboarding-gate.test.ts | grep -c 'toBeGreaterThan(approvedAt')" = 0 && test "$(grep -c 'toBeGreaterThanOrEqual(approvedAt.getTime())' tests/onboarding-gate.test.ts)" = 1 && test "$(grep -c '33825524839' tests/onboarding-gate.test.ts)" -ge 1 && test "$(grep -c 'cadence-resume.test.ts' tests/onboarding-gate.test.ts)" -ge 1 && test "$(grep -c "^import { afterAll, describe, expect, it } from 'vitest';$" tests/onboarding-gate.test.ts)" = 1 && git diff --quiet HEAD -- src && npm run typecheck && npx eslint tests/onboarding-gate.test.ts --max-warnings=0 && (env -u ALLOW_REMOTE_TESTS npx vitest run tests/onboarding-gate.test.ts 2>&1 | grep -q 'Refusing to run integration tests against a non-local Supabase stack')</automated>
  </verify>
  <done>
Acceptance criteria (live-tree baselines in parentheses; every command from the worktree root):
- `grep -v '^\s*//' tests/onboarding-gate.test.ts | grep -c 'toBeGreaterThan(approvedAt'` → `0` (1) — the strict comparator is gone from code lines
- `grep -c 'toBeGreaterThanOrEqual(approvedAt.getTime())' tests/onboarding-gate.test.ts` → `1` (0)
- `grep -c '33825524839' tests/onboarding-gate.test.ts` → `≥ 1` (0); `grep -c 'cadence-resume.test.ts' tests/onboarding-gate.test.ts` → `≥ 1` (0); `grep -c 'd4661cf' tests/onboarding-gate.test.ts` → `≥ 1` (0)
- `grep -c "^import { afterAll, describe, expect, it } from 'vitest';$" tests/onboarding-gate.test.ts` → `1` (1) — no `vi` import, no fake clock
- `git diff --quiet HEAD -- src` → exit 0 before the commit; `git show --stat --format= HEAD` after the commit lists exactly `tests/onboarding-gate.test.ts`
- `npm run typecheck` → exit 0; `npx eslint tests/onboarding-gate.test.ts --max-warnings=0` → exit 0
- `env -u ALLOW_REMOTE_TESTS npx vitest run tests/onboarding-gate.test.ts` → non-zero exit with `Refusing to run integration tests against a non-local Supabase stack` in the output (the gate, not the test); `npm run test:remote` was NOT run
- Commit subject `fix(05): onboarding-gate scope assertion accepts a first touch equal to approvedAt`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- SUMMARY records that behavioural confirmation is CI's next run against its local stack
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer shell → hosted Supabase (Sydney, PRODUCTION) | The test file this task edits opens a service-role connection when run; the only thing standing between a local `vitest run` and production data is the WR-09 gate in tests/helpers/env.ts |
| test assertion → production behaviour | Loosening a matcher is where a real regression (touches NOT re-windowed) could start passing silently |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-fxv-01 | Information Disclosure / Tampering | tests/onboarding-gate.test.ts run against the hosted project | high | mitigate | Never run `npm run test:remote` or set `ALLOW_REMOTE_TESTS`; the documented local step is wrapped in `env -u ALLOW_REMOTE_TESTS` and its expected outcome is the refusal; behavioural proof deferred to CI's `supabase start` stack |
| T-fxv-02 | Tampering | the loosened `>=` matcher at :356 | medium | mitigate | The fixture seeds both touches 30h/29h in the past and the result literal pins `touchesRescheduled: 2`, so an un-rewindowed touch (≈30h before `approvedAt`) still fails `>=`; the loop still covers both touches; the comment records why equality is designed (03-05) so a future reader does not "fix" it back |
| T-fxv-03 | Repudiation | commit history | low | accept | Commit body cites the CI run id and the precedent commit so the reason survives the file; no package installs in this task, so no package-legitimacy gate applies |
</threat_model>

<verification>
- The `<automated>` command in Task 1 exits 0 from the worktree root.
- `git show --stat --format= HEAD` lists exactly one file: `tests/onboarding-gate.test.ts`.
- After the branch is pushed, the next CI run's `npx vitest run` step passes `tests/onboarding-gate.test.ts` regardless of the jitter draw — this is the behavioural confirmation and is recorded as pending in the SUMMARY, not claimed locally.
</verification>

<success_criteria>
- The resume-scope case accepts a first touch placed exactly on `approvedAt` (zero-minute jitter draw) and still fails if a gated touch was not moved off its 30h-ago seed.
- The reason is written next to the assertion in the file's voice, with the CI run id, the precedent, the rejected fake-clock route, and the fixture argument.
- No src/ changes; the hosted database was never contacted; one `fix(05): …` commit with the required trailer.
</success_criteria>

<output>
Create `.planning/quick/260904-fxv-make-the-onboarding-gate-resume-scope-as/260904-fxv-SUMMARY.md` when done
</output>
