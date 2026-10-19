---
phase: 05-ai-drafting-classification
plan: 01
subsystem: drafting
tags: [ai, drafting, schema, migration, d-12, ai-04, onb-03]
status: complete
requires:
  - "cadence_touches vocabulary (Phase 3, 0017)"
  - "complianceSuffix + SendRequest (Phase 3 sender.ts)"
  - "dispatch claim transaction (Phase 3, 04-08 routing)"
provides:
  - "message_templates + touch_drafts tables (migration 0028)"
  - "the real D-12 approval gate — promoteDue can no longer reach 'approved'"
  - "dispatch body seam: SendRequest.body is touch_drafts.final_body verbatim"
  - "src/core/drafting/{prompt,validate,draft-touches}.ts"
  - "src/core/shared/anthropic.ts + optional ANTHROPIC_API_KEY"
  - "ReplyClassification schema derived from INBOUND_LABELS"
affects:
  - "05-02 (validator mechanics, prompt caching), 05-03 (onboarding pause arms)"
  - "05-04 (classification pass), 05-06 (classification model), 05-07 (console approve)"
tech-stack:
  added:
    - "@anthropic-ai/sdk@0.122.0"
  patterns:
    - "DraftClient seam: the one call, injected — remote tests need no API key"
    - "optional-env + null-client: an absent credential parks work, never throws"
    - "whitelist validator over model output at the trust boundary"
key-files:
  created:
    - src/db/schema/message-templates.ts
    - src/db/schema/touch-drafts.ts
    - src/db/migrations/0028_phase5_drafting.sql
    - src/core/shared/anthropic.ts
    - src/core/drafting/prompt.ts
    - src/core/drafting/validate.ts
    - src/core/drafting/draft-touches.ts
    - src/core/classification/schema.ts
    - scripts/verify-drafting.mjs
    - tests/draft-pipeline.test.ts
  modified:
    - src/db/repository/for-tenant.ts
    - src/core/cadence/dispatch.ts
    - src/core/cadence/run-tick.ts
    - src/core/shared/env.ts
    - src/db/schema/{cadence-settings,inbound-messages,cadences,index}.ts
    - src/app/api/internal/cadence-tick/route.ts
    - tests/helpers/seed.ts
decisions:
  - "Classification runs on claude-sonnet-5, not claude-haiku-4-5 (user-directed)"
  - "promoteDue promotes scheduled -> needs_draft ONLY; approveWhere is the sole path to approved"
  - "no_approved_draft is a refusal, never a stub or merge-fill fallback"
  - "final_body frozen at draft time; approval and dispatch both read that column"
  - "templates namespace spans two tables; version/approval names disambiguate"
metrics:
  duration: "~2h 45m"
  completed: 2026-08-31
actuals:
  tokens: 41000
  tasks: 3
  commits: 2
---

# Phase 5 Plan 01: Drafted-Touch Tracer Summary

The D-12 review gate is real: a touch now travels `needs_draft` → a live
`claude-sonnet-5` structured-output draft → a mechanical validator → a
`touch_drafts` evidence row → `pending_approval` → an operator-attributable
approve write → `approved`, and dispatch carries that draft's exact bytes into
`SendRequest.body` or refuses. All Phase 5 schema landed in one migration round.

## What Was Built

**Task 1 — package legitimacy gate (blocking-human).** The Package Legitimacy
Audit returned `[SUS]` for `@anthropic-ai/sdk` on a `too-new` signal. Execution
stopped and returned the checkpoint. Registry metadata gathered read-only for the
human (`npm view`, no package code executed): created 2023-01-31, 13 maintainers
all `@anthropic.com`, repo `anthropics/anthropic-sdk-typescript`, **no install
lifecycle scripts**. Human approved; `0.122.0` installed — the exact version
verified.

**Task 2 — schema, env, client** (commit `8453445`). Two new tables. Config vs
evidence split held: `message_templates` cascades from `tenants`,
`touch_drafts` has **no foreign key at all**. Voice-profile columns on
`cadence_settings`, classification columns on `inbound_messages`,
`CADENCE_PAUSE_REASONS` widened with `onboarding` (vocabulary + CHECK only).
`ANTHROPIC_API_KEY` optional; `buildAnthropicClient()` returns `null` when absent.

**Task 3 — the tracer** (commit `ac1364f`). `PROMOTABLE_TOUCH_STATUSES` narrowed
from three statuses to one. Dispatch resolves `drafts.approvedFinalBody` *before*
the ledger claim and refuses `no_approved_draft` when absent. `stubTouchBody` is
off the dispatch path entirely.

## Deviations from Plan

### User-directed

**1. [USER-DIRECTED] Classification model is `claude-sonnet-5`, not `claude-haiku-4-5`**

- **Directed at:** the Task 1 checkpoint, by the operator
- **Rationale:** operator choice. **Supersedes CLAUDE.md's Haiku classification
  row for this project.**
- **Applied to:** `scripts/verify-drafting.mjs` (`CLASSIFY_MODEL`), and the live
  A1 proof, which now settles the assumption **for Sonnet 5 — the model that will
  actually classify**, rather than for a model this project will not use.
- **Downstream:** plans 05-04 and 05-06 must use `claude-sonnet-5` for
  classification. `src/core/classification/schema.ts` is model-agnostic and needs
  no change. Cost implication: Sonnet is $3/$15 per MTok against Haiku's $1/$5 —
  at ~2k classifications/month this is still comfortably inside the `<$10/client`
  inference budget, but it is no longer *sub-cent per reply*.

### Auto-fixed

**2. [Rule 3 — Blocking] Added `quotes.byId` to the tenant repository**

- **Found during:** Task 3, assembling merge facts
- **Issue:** the plan said to read `jobDescription`, `totalInvoiceAmount` and
  `quoteDateUtc` from the mirror, but the only existing by-id read is
  `quotes.stateFor`, a five-column projection for the sync diff that omits all
  three.
- **Fix:** a tenant-scoped `byId(quoteId): Promise<Quote[]>` rather than widening
  `stateFor` — two readers with different questions get two accessors, so the
  sync path does not start carrying columns it never reads.
- **Commit:** `ac1364f`

**3. [Rule 1 — Bug] Fixed two of my own tests that passed for the wrong reason**

- **Found during:** Task 3, first run of `draft-pipeline.test.ts`
- **Issue:** I passed `seedTouches`'s `{ id, touch_number }` return to
  `draftTouches` behind an `as never` cast. It is not a `CadenceTouch`, so the
  query built from it had undefined bindings and threw a `DrizzleQueryError` —
  which lands in the *same* `deferred` count a throwing client does. The
  throwing-client test was green **without the client ever being called**. The
  ONB-03 test failed loudly and exposed it.
- **Fix:** read the real rows back via `repo.touches.listForCadence` and deleted
  both casts.
- **Commit:** `ac1364f`

**4. [Rule 3 — Blocking] Repaired `pause-upgrade` without deleting its guard**

- **Issue:** `expect([...CADENCE_PAUSE_REASONS]).toEqual([...])` failed on the
  `onboarding` append.
- **Why the obvious fix was wrong:** the test's own comment says its purpose is
  to catch a member inserted **at the front**, which would silently repoint the
  destructured `REPLY_REASON`. Widening the equality would have satisfied the
  failure while deleting the guard.
- **Fix:** assert positions `[0]` and `[1]` by index — exactly what the
  destructure reads — plus a `toContain('onboarding')`.
- **Commit:** `ac1364f`

**5. [Rule 3 — Blocking] Lint repairs** — removed the now-unused `stubTouchBody`
import from dispatch (function retained in `sender.ts`, still pinned by
`tests/touch-body.test.ts`), and switched `draft-touches.ts` to the repository
barrel per the project's `no-restricted-imports` rule.

**6. [Rule 1 — Bug] Reverted a premature requirement completion**

- **Found during:** state updates, after running `requirements mark-complete`
  on this plan's frontmatter IDs as the workflow prescribes.
- **Issue:** `AI-01`, `AI-04` and `ONB-03` were flipped to Complete. They are
  **also claimed by later plans in this same phase** — AI-01 by 05-02 and 05-04,
  AI-04 by 05-02/05-04/05-07, ONB-03 by 05-03 and 05-05. This plan built the
  *tracer slice* of each, not the requirement.
- **Why it mattered:** the same argument 04-10 recorded about MSG-02 — a gap that
  disappears is indistinguishable from a gap that was fixed. A Complete AI-01
  would tell `/gsd-ship` that drafting is done while the validator is still an
  interim stub and no regeneration loop exists.
- **Fix:** reverted `.planning/REQUIREMENTS.md`; all three are back to Pending.
  They should be marked by the **last** plan that claims them (AI-01/AI-04 at
  05-07, ONB-03 at 05-05).

### Naming hazard recorded, not deviated from

`templates.latestApproved` was placed on the **existing** `templates` namespace
per the plan's phase-wide symbol inventory, so 05-02…05-07 find it where they
expect. That namespace now spans two tables with different meanings —
`cadence_touch_templates` (timing) and `message_templates` (wording). Documented
with a header block; the disambiguator is that anything naming a *version* or an
*approval* is the wording table. **Flagged for later plans**: if this proves
confusing in 05-07's console work, splitting it is a rename, not a redesign.

## Verification Evidence

| Check | Result |
| --- | --- |
| Migration 0028 applied to hosted Sydney DB | journal 28 → 29 |
| **Second `db:migrate` is a no-op** (the STATE.md journal trap) | exit 0, journal unchanged at 29 |
| `db:generate` reports no changes | "No schema changes" — snapshot chain coherent |
| Journal monotonicity | idx 28 `when` 1788102451657 > idx 27's 1788070075672; `lint-ban` green |
| `touch_drafts` FK count | 0 (evidence rule) |
| `message_templates` FK | `CASCADE` (config rule) |
| Unique partial index | `... ON touch_drafts (touch_id) WHERE (status = 'approved')` |
| Pause CHECK | `IN ('customer_reply','client_paused','onboarding')` |
| Grants | `anon` + `authenticated` hold **SELECT only** on both new tables |
| `PROMOTABLE_TOUCH_STATUSES` | `['scheduled']` — one member |
| `stubTouchBody(` calls in dispatch.ts | **0** |
| Full `npm run test:remote` (serialized, one at a time) | **72 files, 1525 tests, all pass** (baseline was 71/1516) |
| `npx tsc --noEmit`, `npm run lint` | both clean |
| `npm run verify:drafting` | **exit 0** |

**`npm test` (pure) reports 30 failed files — this is pre-existing, not a
regression.** Every one is the WR-09 disposable-stack gate ("Refusing to run
integration tests against a non-local Supabase") correctly refusing remote
suites without `ALLOW_REMOTE_TESTS`. 1169 tests pass with **zero assertion
failures**; the count rose 29 → 30 only because `draft-pipeline.test.ts` is a new
remote suite. Verified by grepping the distinct failure causes, not assumed.

### Live proof — assumptions settled

`npm run verify:drafting`, two real calls plus a negative probe on synthetic data:

- **A1 SETTLED, on `claude-sonnet-5`:** structured outputs via
  `output_config.format` work with **no beta header and no `tools` key**.
  Returned `label=objection confidence=high` for a price complaint.
- **A2 CONFIRMED as a real 400:** a deliberate probe sending `temperature` was
  rejected. The drafting call's omission of sampling params is now an enforced
  constraint rather than folklore.
- Real draft, in voice, using only whitelisted display strings: *"Hi Sarah, just
  checking in on that meter box and mains upgrade quote from 12 August, $2,450.
  Any questions? Mick"*

## Surprises & Findings

**Prompt caching did NOT engage — the prefix is too short.** The live proof
reports `cache_read=0 cache_write=0` at **753 input tokens**, below the ~1024-token
minimum cacheable prefix. The `cache_control` marker is correctly placed and the
stable/volatile split is correct, but a per-tenant prefix of this size will never
cache. **Plan 05-02 must either accept that caching does not apply at v1 volumes,
or deliberately lengthen the stable block** (fuller voice guide, more examples,
the whole approved template set rather than one). Recording it because the plan
assumed the split alone would deliver caching "without restructuring".

**`zodOutputFormat` takes one argument in 0.122.0**, not two. Verified against
the installed source rather than assumed after a `TS2554`.

**`APIConnectionError` is confirmed a subclass of `APIError`** — checked first in
`describeAnthropicError`, or every connection failure would collapse into the
generic arm.

## Known Stubs

| Stub | File | Reason / resolved by |
| --- | --- | --- |
| Charset gate is printable-ASCII, standing in for a real GSM-7 alphabet check | `src/core/drafting/validate.ts` | **Intentional, tracer scope.** Marked at the definition. Replaced by `gsm7.ts` in **05-02** without changing the signature or result shape. Interim arm is *stricter* than the real rule, so it can only over-refuse (recoverable — the tick retries), never under-refuse. |
| Segment count is `ceil(length / 153)`, standing in for a septet counter | `src/core/drafting/validate.ts` | **Intentional, tracer scope.** Same marking and same replacement in **05-02**. |
| `attempt` is always 1; no regeneration loop | `src/core/drafting/draft-touches.ts` | **Intentional, tracer scope** (plan: "no batching, no regeneration loop"). The column and the seam exist; **05-02** adds the loop, **05-04** the attempt ceiling. |
| `priorBodies` always `[]` | `src/core/drafting/draft-touches.ts` | Tracer scope — `drafts.sentBodiesForCadence` is in the phase inventory for a later plan. Touch 1 has no priors, so the tracer path is unaffected. |
| `src/core/classification/schema.ts` has no caller | `src/core/classification/schema.ts` | **Intentional** — the plan created it now so `verify-drafting.mjs` could settle A1. `classify-inbound.ts` lands in **05-04**. |

None of these prevent the plan's goal: the single happy path works end to end on
the hosted stack and the live API.

## Deferred / Owed

- **Nothing owed from this plan.** Every verification in the plan's `<verification>`
  block was run and passed.
- Pre-existing, unrelated, still open: the undeployed-commit note (`e658ea1` and
  later) from Phase 4 — this plan's changes are **also** undeployed. The cadence
  tick in production still runs the Phase 4 build, where `promoteDue` auto-passes
  to `approved`. **Deploy before arming any real client**, or the production tick
  and this code disagree about what `approved` means.

## Threat Flags

None. The threat register's five mitigations (T-5-01 validator, T-5-02 gate
narrowing + unique index, T-5-03 no bodies in logs, T-5-04 key handling,
T-5-05 no stub fallback) are all implemented and asserted. T-5-SC was the Task 1
gate.

## Self-Check: PASSED

All ten created files verified present on disk. Both commits verified in
`git log`: `8453445`, `ac1364f`.
