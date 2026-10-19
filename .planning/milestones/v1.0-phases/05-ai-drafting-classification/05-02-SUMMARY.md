---
phase: 05-ai-drafting-classification
plan: 02
subsystem: drafting
tags: [ai, drafting, validator, gsm7, prompt-caching, injection, ai-01, ai-03, ai-04, d-03]
status: complete
requires:
  - "05-01 tracer: validateDraft/buildDraftPrompt signatures, draft-touches call site"
  - "complianceSuffix (Phase 3 sender.ts) — the suffix the validator checks for"
provides:
  - "src/core/drafting/gsm7.ts — septet-true length policy (replaces the interim char count)"
  - "src/core/drafting/edit-distance.ts — the owned AI-04 metric"
  - "the real trust boundary: run-to-run verbatim whitelist + date-word guard + UCS-2 hard fail"
  - "byte-stable per-tenant system prefix + user-turn-only untrusted quote text"
  - "PROMPT_VERSION 'p2' — the full prompt contract"
  - "validateDraft returns normalizedBody: the canonical bytes for approval AND dispatch"
affects:
  - "05-04 (regeneration loop consumes the violation list; batching supplies the full template set)"
  - "05-07 (console edit-and-approve stores normalizedEditDistance)"
tech-stack:
  added: []
  patterns:
    - "discriminated count result: a UCS-2 flip is distinguishable from 'too long', never an integer"
    - "run-to-run whitelist membership: compare digit runs, not substrings"
    - "one canonical form: the validator returns the bytes it checked"
key-files:
  created:
    - src/core/drafting/gsm7.ts
    - src/core/drafting/edit-distance.ts
    - tests/gsm7.test.ts
    - tests/drafting-validate.test.ts
    - tests/edit-distance.test.ts
    - tests/drafting-prompt.test.ts
  modified:
    - src/core/drafting/validate.ts
    - src/core/drafting/prompt.ts
    - src/core/drafting/draft-touches.ts
decisions:
  - "Whitelist membership is run-to-run, not substring — closes the hole where 45 passed as part of $2,450"
  - "Date-word guard is case-SENSITIVE canonical capitalization; may/sat/sun/march stay usable English"
  - "The dollar-sign relaxation runs one way: dropping ours is faithful, adding one fabricates a price"
  - "validateDraft returns normalizedBody on both arms; draft-touches stores it as final_body"
  - "The compliance line is described to the model by LENGTH, never by text"
  - "Edit distance owned outright (T-5-09 accepted) because the metric IS the stored record"
metrics:
  duration: "~25m"
  completed: 2026-08-31
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
---

# Phase 5 Plan 02: Prompt & Validator Hardening Summary

The tracer's two interim arms are gone. Draft length is now measured in GSM-7
septets over the final body, a fabricated price cannot reach the whitelist by
sharing digits with a real one, quote text from ServiceM8 lives only in the
user turn behind a fence it cannot write its way out of, and the AI-04 metric
is owned and pinned. Four pure modules, 92 known-answer tests, no dependencies
added.

## What Was Built

**Task 1 — `gsm7.ts`** (commit `2a540fe`). The 127-member GSM 03.38 basic table
(128 slots less ESC), the exactly-nine extension table, and three functions.
`countSeptets` returns a **discriminated** result rather than a number, so a
caller can tell "this message is long" from "this message is not being sent as
septets at all" — the distinction the interim `ceil(length/153)` erased.
`segmentCount` implements the 160-single / 153-concatenated split with a
documented vacuous floor at 0. `normalizeForGsm7` repairs the five predictable
Claude lookalikes and **deliberately nothing else**: an emoji survives so the
validator can name it, because a body silently edited on the way to a customer
is worse than a body refused.

**Task 2 — the trust boundary and the metric** (commit `a9b2b9b`).
`validate.ts` keeps its signature and replaces every mechanic behind it:
normalize first, run-to-run digit whitelist with maximal runs, case-sensitive
date-word guard, septet-true charset and segment cap, suffix presence. Six
violation rules, each carrying enough detail to feed a D-11 regeneration
verbatim. `edit-distance.ts` is a two-row Wagner-Fischer over code points,
hand-written on the argument that the metric is a **stored record** — a
dependency bump that changed its Unicode handling would silently redefine every
historical measurement in a column nobody re-derives.

**Task 3 — the prompt contract** (commit `c7927fb`). The system block now takes
the tenant's whole approved template set, sorted ascending by touch **on a
copy**, with the touch named in the user turn — one cache entry per tenant
instead of one per touch. Untrusted quote text is fenced, control-stripped,
delimiter-stripped, whitespace-collapsed and capped over code points. The
compliance line is described by length and never by text. `PROMPT_VERSION` is
`'p2'`.

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — Missing critical mitigation] The whitelist compares runs, not substrings**

- **Found during:** Task 2, writing the adversarial fixtures for T-5-06.
- **Issue:** the plan (and the tracer) specify "the token must equal, or be an
  exact substring of, a member of `allowedDisplayStrings`". `45` **is** a
  substring of `$2,450`. So "I'll be there in 45 minutes" — a number nobody
  supplied, about an appointment nobody booked — passes the rule that exists to
  stop exactly that. Every supplied price silently whitelists dozens of
  fabricated numbers.
- **Fix:** the allowed set is decomposed into its own maximal digit runs, and a
  body token must equal one of those runs. `$2,450` contributes exactly
  `$2,450`, so `45` matches nothing. The case the substring arm existed for —
  a sentence-long display string like `your quote from 12 August for $2,450` —
  still works, because that member contributes both `12` and `$2,450` as runs.
  Pinned by two opposing tests.
- **Why this is Rule 2 and not a redesign:** T-5-06 is `critical / mitigate` in
  this plan's own threat register. A mitigation with a hole this size is an
  absent mitigation.
- **One-way relaxation retained:** a run beginning `$` also matches without it,
  because we render `$2,450` and "the 2,450 quote" is faithful reproduction.
  The reverse is refused — `$14` where `14` was supplied turns a day count into
  a price. Both directions are tested.
- **Commit:** `a9b2b9b`

**2. [Rule 2 — Missing critical functionality] The suffix is normalized before comparison**

- **Found during:** Task 2, writing the suffix-presence rule.
- **Issue:** `tenants.name` is operator-typed. "Mick's Plumbing" entered on a
  phone keyboard carries U+2019. That character then lands in **our own**
  mechanically-appended text, fails the charset rule, and produces a draft that
  no amount of regeneration can fix — the model is not the one who wrote it. An
  infinite-refusal loop on a legitimate tenant name.
- **Fix:** both the body and `expectedSuffix` are normalized before comparison,
  so the apostrophe is repaired on both sides and the match holds. Pinned by a
  test using a smart-apostrophe business name.
- **Commit:** `a9b2b9b`

**3. [Rule 3 — Blocking] `draft-touches.ts` updated for the new contracts**

- **Found during:** Tasks 2 and 3 — the call site did not compile otherwise.
- **Changes:** passes `expectedSuffix` (composed once, handed over rather than
  re-derived, so the two halves cannot drift); stores `verdict.normalizedBody`
  as `final_body` while `generated_body` stays raw as evidence of what the model
  actually emitted; passes the template as `{ touchNumber, body }`.
- **Verified against the hosted stack** rather than assumed — see below.
- **Commits:** `a9b2b9b`, `c7927fb`

### Judgement calls, recorded because they differ from the plan's wording

**4. The date-word guard is case-SENSITIVE**

The plan says "any month name (full or three-letter) or weekday name not
appearing inside a member of `allowedDisplayStrings` is a violation", and to
keep it conservative because a false failure is the cheap direction.

Implemented on canonical capitalization only, matched case-sensitively. The
reason is that five of these words are ordinary English — "you **may** want
to", "we **sat** down", "in the **sun**", "**March**" — and a case-insensitive
rule refuses correct drafts on all of them. A validator that refuses correct
output teaches an operator to click past refusals, which costs far more than
the residue it buys. A date written to a customer is capitalized; those are the
forms checked. Three false-positive cases are pinned as passing tests, and the
lowercase residue is covered by the digit rule (a fabricated date almost always
carries a digit) plus the human gate. This is still the conservative direction
where it matters: every capitalized month, abbreviation and weekday not in the
whitelist fails.

**5. Violation rule names changed and the set grew**

`non_ascii` → `non_gsm_character` (the interim name described the interim
mechanic), plus `unlisted_date_word` and `missing_suffix`. `DraftViolation`
gains an optional `nearest` — the supplied display string a rejected token most
resembles, computed with the new edit-distance function. D-11 feedback of the
form "your draft contained `$2,540`, which is not a provided value; the
provided value is `$2,450`" is something a model can act on; "invalid number"
is not, and a regeneration loop whose feedback cannot be acted on burns two
calls and fails twice. `validator_failures` is `jsonb` with no CHECK, and no
production rows exist, so the rename costs nothing.

## Verification Evidence

| Check | Result |
| --- | --- |
| `npx vitest run tests/gsm7.test.ts` | 20 passed |
| `npx vitest run tests/drafting-validate.test.ts` | 33 passed |
| `npx vitest run tests/edit-distance.test.ts` | 14 passed |
| `npx vitest run tests/drafting-prompt.test.ts` | 25 passed |
| All four new suites together | **92 passed** |
| Full `npm test` (pure) | **1261 tests passed, ZERO assertion failures** (baseline 1169 + 92) |
| `npm test` failed *files* | 30 — unchanged from the 05-01 baseline; verified by counting the distinct cause, all 30 are the WR-09 remote-refusal gate, not regressions |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run test:remote -- tests/draft-pipeline.test.ts` | **9 passed** — the hosted-DB pipeline still green after the `draft-touches` changes; crons re-armed and lease released |
| File deletions across the three commits | **0** (`git diff --diff-filter=D`) |

### The must_haves truths, each pinned by a named test

| Truth | Test |
| --- | --- |
| Adjacency: concatenated whitelisted values fail | "refuses two supplied values concatenated with no separator" |
| Empty edges: empty priors legal, empty body a violation, empty whitelist fails digits | "renders a well-formed block for touch 1 with no prior history"; "is a single hard violation"; the whole `the empty whitelist` block |
| Encoding: septets after normalization, residual non-GSM is a violation, UCS-2 hard-fails | "refuses a character the normalizer cannot repair, naming it"; "refuses a UCS-2 flip however short the body is" |
| Exactly 2 segments passes, 3 fails, pinned at 306/307 | "accepts exactly two segments and refuses three" (validator) + "pins the 2-vs-3 segment boundary" (gsm7) |
| The stable block is byte-identical across a tenant's batch | "is byte-identical across two different quotes of one tenant"; "does not vary with the touch being written" |
| Quote text user-turn only, delimited, control-stripped, 500-capped | the whole `untrusted quote text` block — 8 tests |
| Edit distance: identity, 1/n, symmetry, both-empty, one-empty | the whole `normalizedEditDistance` block |
| Rounding contract preserves ≥4 dp (backstop) | "produces values that need at least four decimal places to survive storage" — asserts two places erase a one-character edit to a 300-character SMS |

## Surprises & Findings

**The plan's own whitelist rule had the hole the plan was written to close.**
"Equal to, or an exact substring of, a member" reads airtight and is not:
sharing digits with a real price is enough to pass. It survived the tracer and
the plan because the obvious test — "invented price fails" — passes under both
rules. It only shows up when the fixture is a number that *isn't* price-shaped.
Recorded because the same shape of error is available in the date rule and in
whatever 05-04 writes for regeneration.

**Prompt caching still does not engage, and this plan does not fix it.**
05-01 measured a live call at 753 input tokens against Sonnet 5's ~1024
minimum. `prompt.ts` now accepts the whole approved template set, which is the
structural half of the fix. The caller half is missing: `draftTouches` fetches
`templates.latestApproved(touchNumber, channel)` — one template — so the prefix
stays short **and** varies per touch, and there is nothing to reuse either way.
Fixing it means fetching the approved set once per tenant and drafting the
queue in one pass, which is the batching work 05-04 owns. **No padding was
added to force a cache hit**: inventing tokens to buy a discount on tokens is
not a saving, and the whole drafting bill is $3–8/mo. Recorded in the code at
the call site, not just here.

**Literal control characters in source are invisible until `grep` goes quiet.**
Writing ` ` and ESC as raw bytes into `prompt.ts` and the prompt test made
both files binary to `grep`, which silently returns nothing rather than
erroring. Caught because a `grep` that should have matched printed no output at
all. Both files now use `\uXXXX` escapes; a `/[\x00-\x1f]/` scan over each
confirms them clean.

## Known Stubs

| Stub | File | Reason / resolved by |
| --- | --- | --- |
| One template per prompt, not the tenant's approved set — so the cache prefix is short **and** per-touch | `src/core/drafting/draft-touches.ts` | **Intentional, out of this plan's scope.** Marked at the call site with the measured 753-token evidence. `prompt.ts` already accepts the full set; **05-04**'s batching supplies it. |
| `priorBodies` always `[]` | `src/core/drafting/draft-touches.ts` | Carried over from 05-01. `drafts.sentBodiesForCadence` is in the phase inventory for a later plan; touch 1 has no priors. |
| `attempt` always 1; no regeneration loop consumes the violation list | `src/core/drafting/draft-touches.ts` | Carried over from 05-01. The violations are now shaped for D-11 feedback (`detail` + `nearest`); **05-04** adds the loop and the attempt ceiling. |
| `normalizedEditDistance` has no *storage* caller — it only informs violation messages | `src/core/drafting/edit-distance.ts` | **Intentional.** The AI-04 measurement (draft vs. operator-edited body) is written by **05-07**'s edit-and-approve action. The metric is owned and pinned now so that plan stores a number whose definition is already fixed. |

None of these prevent this plan's goal: the trust boundary is mechanical, the
prompt contract is byte-stable and injection-hardened, and both are pinned by
pure tests that need no database, no credentials and no model.

## Deferred / Owed

- **Nothing owed from this plan.** Both commands in `<verification>` were run,
  plus the hosted `draft-pipeline` suite that this plan's `draft-touches`
  changes could have broken.
- **No requirements marked complete.** `AI-01` is also claimed by 05-04, `AI-03`
  by 05-06, `AI-04` by 05-04 and 05-07. Per the correction recorded in 05-01,
  a requirement is marked by the **last** plan that claims it — a gap that
  disappears is indistinguishable from a gap that was fixed.
- Pre-existing and still open: the undeployed-commit note from Phase 4. This
  plan's changes are also undeployed; production still runs the Phase 4 build.

## Threat Flags

None. This plan's four register entries are all implemented and asserted:
T-5-06 (run-to-run whitelist + date guard + conservative direction, with
adversarial fixtures), T-5-07 (user-turn-only placement, fence the content
cannot close, control-strip, 500-cap), T-5-08 (normalizer + hard fail on
residual non-GSM), T-5-09 (accepted; metric pinned by known-answer tests).

No new security-relevant surface was introduced — four pure modules, no
network, no I/O, no schema change.

## Self-Check: PASSED

All six created files verified present on disk. All three commits verified in
`git log`: `2a540fe`, `a9b2b9b`, `c7927fb`.
