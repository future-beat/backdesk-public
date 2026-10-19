---
phase: quick-260831-iie
plan: 01
subsystem: classification
status: complete
tags: [ai, classification, model-selection, claude-opus-5]

requires:
  - "src/core/classification/classify-inbound.ts (AI-02 classification pass)"
  - "scripts/verify-drafting.mjs (live A1/A2 proof harness)"
provides:
  - "Inbound reply classification running on claude-opus-5"
  - "A1 (structured outputs, no beta header, no tools key) re-settled live on claude-opus-5"
affects:
  - "src/core/cadence/run-tick.ts (pass-5 CLASSIFY doc comment only)"
  - "tests/classification-privilege.test.ts (source-read model pin)"

tech-stack:
  added: []
  patterns:
    - "Model id pinned in exactly two places (source constant + live-proof script), consumed by reference everywhere else"
    - "absence-is-the-configuration: no sampling params, no thinking, no tools key, no beta header"

key-files:
  created: []
  modified:
    - src/core/classification/classify-inbound.ts
    - src/core/cadence/run-tick.ts
    - scripts/verify-drafting.mjs
    - tests/classification-privilege.test.ts
    - tests/classify-inbound.test.ts
    - .planning/STATE.md

decisions:
  - "Classification runs on claude-opus-5 (user decision 2026-08-31); drafting stays on claude-sonnet-5"
  - "MAX_CLASSIFY_TOKENS stays at 100 — proven live to survive Opus 5's default adaptive thinking, so the contingency cap-raise was not exercised"

metrics:
  duration: ~9 min
  completed: 2026-08-31

actuals:
  tokens: 29800
  tasks: 3
  commits: 2
---

# Quick Task 260831-iie: Switch Reply Classifier to claude-opus-5 Summary

Inbound reply classification now runs on `claude-opus-5` with the request shape byte-identical apart from the model string, re-proven against the live API in one run.

## What Was Built

The classifier's label drives pause-on-reply, opt-out handling and hot-lead escalation — the highest-stakes read in the product. Per the user's 2026-08-31 decision ("classification is critical and cheap at our volume"), `CLASSIFY_MODEL` moved from `claude-sonnet-5` to `claude-opus-5`. Drafting was deliberately left on `claude-sonnet-5`.

The two legs of `verify:drafting` now run on **different models on purpose**: drafting on Sonnet 5, classification on Opus 5. The A2 negative probe still targets the drafting model, which is correct — it proves the *drafting* model rejects `temperature`, and drafting did not change.

### Task-by-task

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Flip CLASSIFY_MODEL in source and live-proof script | `a282a91` | classify-inbound.ts, run-tick.ts, verify-drafting.mjs |
| 2 | Update test pins + record decision in STATE.md | `5762e79` | classification-privilege.test.ts, classify-inbound.test.ts, STATE.md* |
| 3 | Live smoke proof + full verification | — (verification only, no files changed) | none |

\* STATE.md is a docs artifact, left uncommitted for the orchestrator's docs commit per execution constraints.

## Key Decisions

**The no-sampling-params discipline survived the swap, and is now more load-bearing, not less.** Verified against the bundled Claude API reference: `claude-opus-5` *removes* `temperature`/`top_p`/`top_k` and returns a 400 on send — the same rule as Sonnet 5. Sending none remains required rather than merely harmless. Comments were updated to say this explicitly so a future reader doesn't "restore" a `temperature: 0` on the assumption the constraint was Sonnet-specific.

**MAX_CLASSIFY_TOKENS stays at 100.** This was the one genuine behavioural risk in the swap and the reason the live run mattered. On `claude-opus-5`, omitting `thinking` runs **adaptive thinking by default** (unlike Opus 4.8/4.7, where omission meant no thinking), and thinking tokens count against `max_tokens`. A 100-token cap could plausibly have been consumed by reasoning before any structured output was emitted. The live run returned a schema-valid `label=objection confidence=high` with no truncation, so the plan's contingency (raise the cap to ~300 in both places) was **not** exercised and no cap change was made.

## Deviations from Plan

**1. [Process] `verify:drafting` ran twice, not once**

- **Found during:** Task 3
- **Issue:** The first run was invoked through a pipeline (`| tail -50`), and the trailing `echo "EXIT: ${PIPESTATUS[0]}"` printed an empty value because `PIPESTATUS` had already been clobbered. The run's own output clearly said `verify:drafting PASSED` with zero `FAIL` lines, but the plan's verification gate asks for the command's exit code specifically.
- **Fix:** Re-ran the script once without a pipeline to capture a clean `$?` (exit 0).
- **Cost:** One extra set of real API calls — roughly one Sonnet draft, one Opus classification and one 400 probe, i.e. a fraction of a cent. Within the plan's bounded "one contingency re-run" budget, though spent on exit-code capture rather than the truncation contingency it was reserved for.
- **Files modified:** none

**2. [Environment] Precondition checked indirectly**

- **Found during:** Task 3 precondition
- **Issue:** The read-only check for `ANTHROPIC_API_KEY` in `.env.local` was denied by the sandbox, so the precondition could not be verified directly.
- **Fix:** No workaround was attempted. The script itself performs exactly this check and refuses loudly with a non-zero exit if the key is absent, so running it *is* the precondition check — and it passed, which proves the key was present.
- **Files modified:** none

## Verification Results

| Check | Result |
|-------|--------|
| `grep -rn CLASSIFY_MODEL src scripts tests` | Defined as `'claude-opus-5'` in exactly 2 places; all other references are by-reference |
| `DRAFT_MODEL` in draft-touches.ts + script | Still `'claude-sonnet-5'` — drafting untouched |
| `tests/helpers/seed.ts:486` drafting seed row | Untouched |
| Four affected suites (privilege, classify-inbound, cadence-tick-classification, draft-touches) | 4 files, **139 tests passed** |
| `npm test` (full pure suite) | **1590 tests passed, zero assertion failures**; 31 failed *files* are the pre-existing WR-09 remote-refusal gate |
| `npm run verify:drafting` | **Exit 0** — `A1 SETTLED on claude-opus-5: label=objection confidence=high`; A2 probe still `temperature rejected with 400` |
| `npx tsc --noEmit` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run test:remote` | **Not run** — no remote suite pins the classification model, and remote runs share the production Sydney DB |

## Known Stubs

None. No stubs, TODOs, skipped tests or unrun verifications were introduced.

## Threat Flags

None. The model swap introduces no new trust boundary. T-Q-01 (injection surface) is byte-identical — no `tools` key, schema-only output, zod re-validation after `messages.parse`, and the privilege suite still reads the source and fails on any `tools` property. T-Q-02 (token-cap DoS under Opus 5's default thinking) was dispositioned `mitigate` and is now **closed by live proof** rather than by argument.

## Self-Check: PASSED

- `src/core/classification/classify-inbound.ts` — FOUND, contains `export const CLASSIFY_MODEL = 'claude-opus-5'`
- `scripts/verify-drafting.mjs` — FOUND, contains `const CLASSIFY_MODEL = 'claude-opus-5'`
- `tests/classification-privilege.test.ts` — FOUND, pins the new literal
- Commit `a282a91` — FOUND in git log
- Commit `5762e79` — FOUND in git log
- `.planning/STATE.md` — carries the dated decision bullet and the `SUPERSEDED 2026-08-31` annotation on the 05-01 entry
