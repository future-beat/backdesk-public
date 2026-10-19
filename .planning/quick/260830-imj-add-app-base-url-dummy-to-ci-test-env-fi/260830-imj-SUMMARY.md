---
quick_id: 260830-imj
slug: add-app-base-url-dummy-to-ci-test-env-fi
subsystem: infra
tags: [ci, github-actions, env, resend, email, vitest]

requires:
  - phase: 04-messaging-gateway
    provides: chooseEmailSender's three-way arming check (04-05) and the CR-01 per-tenant activation fix (04-08) that tests/routing-dispatch.test.ts proves
provides:
  - CI exports APP_BASE_URL so the email delegate can arm inside the runner
affects: [any future phase whose tests arm the real ResendSender]

actuals:
  tokens: 900
  tasks: 1
  commits: 1

tech-stack:
  added: []
  patterns:
    - "An optional() member of serverEnvSchema that a code path treats as mandatory must be supplied explicitly in CI — the tests/helpers/env.ts gate can only refuse on REQUIRED members"

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Fixed CI's env, not the sender or the test — the refusal is designed behaviour (04-05), and relaxing it would let a localhost unsubscribe link pass every test"
  - "APP_BASE_URL=https://ci.invalid: a full https:// URL because the schema is z.url() not a hostname, and the reserved .invalid TLD for the same reason as the neighbouring alerts@ci.invalid"

patterns-established: []

requirements-completed: []

coverage:
  - id: D1
    description: "CI's stack-env export block sets APP_BASE_URL, so chooseEmailSender can arm the real Resend delegate inside the runner"
    verification:
      - kind: other
        ref: "grep -n 'APP_BASE_URL=https://ci.invalid' .github/workflows/ci.yml — exactly 1 hit, at line 179"
        status: pass
      - kind: other
        ref: "node -e js-yaml parse of .github/workflows/ci.yml — file parses; the echo sits inside the 'Export local stack environment' step's supabase-status → $GITHUB_ENV block"
        status: pass
    human_judgment: true
    rationale: "Authoritative proof is the next CI run on the pushed commit — specifically the previously failing tests/routing-dispatch.test.ts:185 'arms the REAL email delegate…' assertion. That run had not happened at authoring time (the orchestrator pushes and watches after this returns), and the suite is an integration suite that refuses on non-local stacks so it could not be reproduced on this Docker-less machine."

duration: 1 min
completed: 2026-08-30
status: complete
---

# Quick Task 260830-imj: Add APP_BASE_URL dummy to the CI test env

**CI now exports `APP_BASE_URL=https://ci.invalid`, so `chooseEmailSender` arms the real Resend delegate in the runner instead of handing `tests/routing-dispatch.test.ts` the stub it asserted against.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-08-30T05:27:16Z
- **Completed:** 2026-08-30T05:28:19Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added one `echo "APP_BASE_URL=https://ci.invalid"` to the `Export local stack environment` step's `{ … } >> "$GITHUB_ENV"` block in `.github/workflows/ci.yml`, alongside the `RESEND_API_KEY` / `UNSUBSCRIBE_SIGNING_SECRET` material it is checked with.
- Carried a comment in the block's established voice recording the three things a reader needs: why the variable exists (the sender refuses rather than degrades), why its absence was silent rather than loud (it is `optional()` in `serverEnvSchema`, so the `tests/helpers/env.ts` gate has nothing to refuse on), and why a fake value is safe (`z.url()` is the only constraint; no suite reaches the Resend HTTP path; `.invalid` is unreachable by definition).

## Task Commits

1. **Task 1: export APP_BASE_URL dummy in ci.yml** — `d7b0ea4` (fix)

## Files Created/Modified

- `.github/workflows/ci.yml` — one `echo` line (now line 179) plus a 19-line rationale comment, both inside the existing shell block; no YAML structure touched.

## Decisions Made

- **The fix belongs in CI's env, not in the sender or the test.** `chooseEmailSender`'s `if (!apiKey || !appBaseUrl || !signingSecret) return fallback` is the 04-05 refuse-don't-degrade decision working exactly as designed — a localhost unsubscribe link in a customer inbox is a Spam Act breach that every test would pass. Loosening the check to make CI green would delete the guarantee the check exists to hold.
- **Value is a full `https://` URL.** `APP_BASE_URL` is `z.url()` in `serverEnvSchema` (src/core/shared/env.ts:156), not a hostname; a bare `ci.invalid` would fail the parse.
- **Comment placement at the end of the block rather than adjacent to `RESEND_API_KEY`.** The four-Phase-4-bearers comment (lines 143-155) is a single unit describing four `echo`s; splitting it to insert this one would have made both comments harder to read. The new comment opens by naming its neighbours ("belongs with the two above it"), which preserves the grouping the plan asked for without breaking an existing block.

## Deviations from Plan

None — plan executed exactly as written.

The plan hedged on YAML verification ("`node -e "require('js-yaml')"` is not installed… rely on the grep plus visual diff"). `js-yaml` turned out to be present in `node_modules` as a transitive dependency, so the file was parsed for real: it loads, and the assertion that the `echo` sits inside the `Export local stack environment` step's export block was made against the parsed step body rather than by eye. This is strictly stronger than the planned check, not a departure from it.

## Issues Encountered

None.

## Verification Results

- `grep -n 'APP_BASE_URL=https://ci.invalid' .github/workflows/ci.yml` → exactly one hit, line 179. **PASS**
- Block containment: the export block runs from `supabase status -o env` (line 95) to `} >> "$GITHUB_ENV"` (line 180); line 179 is inside it. **PASS**
- `js-yaml` parse of the whole workflow → loads; job `verify`, step `Export local stack environment` contains exactly one matching `echo`, and its `run` body both starts from the `supabase status` capture and ends at `} >> "$GITHUB_ENV"`. **PASS**
- `git diff --diff-filter=D` on the commit → no deletions. **PASS**
- No source, test or schema file changed — the commit is `1 file changed, 20 insertions(+)` on `.github/workflows/ci.yml` alone. **PASS**
- Local reproduction of the mechanism was **skipped as planned**: `tests/routing-dispatch.test.ts` is an integration suite that refuses on non-local stacks, and this machine has no Docker to run one.

## User Setup Required

None.

## Next Phase Readiness

- The authoritative proof is the next CI run on the pushed commit: the `Test suite` step should go green, specifically `tests/routing-dispatch.test.ts:185` "arms the REAL email delegate from one tenant row, with the global row off" (previously `expected 'stub' to be 'resend'`). The orchestrator pushes and watches — this executor deliberately did not push.
- Unrelated and still open: commit `e658ea1` (the T-4-28 inbound backstop fix) remains undeployed; pushing `main` for this CI run also carries it to production, which is the desired direction.

## Self-Check: PASSED

- `.github/workflows/ci.yml` exists and carries the change (verified by grep + js-yaml parse above).
- Commit `d7b0ea4` exists in `git log`.

---
*Quick task: 260830-imj*
*Completed: 2026-08-30*
