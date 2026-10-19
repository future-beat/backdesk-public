---
phase: 05-ai-drafting-classification
plan: 06
subsystem: classification
tags: [ai, classification, ai-02, ai-03, d-13, d-14, d-15, d-16, least-privilege, prompt-injection]
status: complete
requires:
  - "05-01: ReplyClassification schema derived from INBOUND_LABELS; inbound_messages classification columns (migration 0028); buildClassifyClient"
  - "05-04: describeAnthropicError().kind — the closed failure vocabulary both AI passes branch on"
  - "04-01: the LLM-free inbound webhook that records, threads, pauses and suppresses before this pass ever sees a row"
provides:
  - "classifyInbound — the async tick pass that labels inbound replies"
  - "listUnclassified / writeClassification / bumpClassifyAttempts — the ENTIRE write surface reachable from model output (D-13)"
  - "is_hot, the flag Phase 6's hot-lead escalation consumes"
  - "four enumerated classification counts on CadenceTickResult and the tick route"
  - "the structural D-16 gate: no file under src/app/api/webhooks/ may import core/classification"
affects:
  - "05-07 (triage surfacing reads label/confidence/is_hot; opt_out priority is its half of D-13)"
  - "Phase 6 CON-02 hot-lead SMS escalation (reads is_hot)"
tech-stack:
  added: []
  patterns:
    - "the privilege boundary written as a THREE-MEMBER repository interface, so the whole of what a model may do to the database is one greppable type"
    - "structural test suites that assert what a module COULD do, not only what it did — a behavioural injection fixture proves one path, an import pin proves all of them"
    - "a count field shaped like a flag (classificationUnconfigured: 1) when there is no population to count"
key-files:
  created:
    - src/core/classification/classify-inbound.ts
    - tests/classify-inbound.test.ts
    - tests/classification-privilege.test.ts
    - tests/cadence-tick-classification.test.ts
  modified:
    - src/db/repository/inbound-messages.ts
    - src/db/repository/index.ts
    - src/core/cadence/run-tick.ts
    - src/app/api/internal/cadence-tick/route.ts
    - tests/cadence-tick-route.test.ts
    - tests/cadence-tick.test.ts
    - tests/cadence-tick-isolation.test.ts
    - tests/cadence-completion-sweep.test.ts
    - tests/cadence-dispatch.test.ts
    - tests/lint-ban.test.ts
key-decisions:
  - "The classification model is claude-sonnet-5, so the request sends NO temperature — the plan prescribed `temperature: 0` on the strength of Haiku's rules, and Sonnet 5 answers that with a 400"
  - "writeClassification is guarded on `label IS NULL`: a second, slower answer must not overwrite the first, which an operator may already have acted on"
  - "An `unknown` API error defers WITHOUT counting an attempt; a deterministic 400 counts one. The attempt cap is for poison in the row, and an unknown throw is at least as likely to be ours"
  - "No cache_control marker on the classification system block — it is far under the ~1024-token minimum, and a marker on a prefix that cannot cache is a claim the usage counters would contradict"
  - "The three unlabelled arms collapse into ONE tick count, against 05-04's split-by-what-an-operator-does rule, because every arm's answer is 'nothing' and the deploy-level 400 an operator would act on already surfaces per-tenant as draftsDeterministicFailed"
  - "classificationUnconfigured is 1 rather than a row count: with no key the pass does not read the queue at all, so there is no population to report"
requirements-completed: [AI-03]
coverage:
  - id: C1
    description: "Inbound replies classify into the closed enum via structured output with NO tools key — schema-only as a property of the wire request"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "tests/classification-privilege.test.ts#contains NO tools property and no tool_choice"
        status: pass
      - kind: unit
        ref: "tests/classify-inbound.test.ts#every label round-trips verbatim (6 parameterised cases)"
        status: pass
    human_judgment: false
  - id: C2
    description: "The pass writes label, confidence, is_hot, classified_at, classify_attempts and NOTHING else — no cadence, no suppression, no send path (D-13, D-14)"
    requirement: AI-03
    verification:
      - kind: unit
        ref: "tests/classification-privilege.test.ts#writeClassification sets EXACTLY the four classification columns"
        status: pass
      - kind: unit
        ref: "tests/classification-privilege.test.ts#references ONLY the three sanctioned repository functions"
        status: pass
      - kind: unit
        ref: "tests/classify-inbound.test.ts#prompt injection: the blast radius is one label (5 fixtures, full call list asserted)"
        status: pass
    human_judgment: false
  - id: C3
    description: "Below-high confidence is needs-human: is_hot only for high-confidence interested/question (D-15)"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "tests/classify-inbound.test.ts#the is_hot matrix — 18 combinations, decided once"
        status: pass
    human_judgment: false
  - id: C4
    description: "An empty or whitespace-only body never reaches the model; the 1000-code-point cap affects only the prompt"
    requirement: AI-03
    verification:
      - kind: unit
        ref: "tests/classify-inbound.test.ts#labels %s as other/low with ZERO API calls (3 cases)"
        status: pass
      - kind: unit
        ref: "tests/classify-inbound.test.ts#slices CODE POINTS, so an emoji at the boundary is never cut in half"
        status: pass
    human_judgment: false
  - id: C5
    description: "A null or schema-invalid parsed_output leaves the row unlabelled with attempts incremented; a row at the cap is never fetched"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "tests/classify-inbound.test.ts#a model answer that is not usable (4 tests)"
        status: pass
      - kind: unit
        ref: "tests/classification-privilege.test.ts#listUnclassified carries all three predicates"
        status: pass
    human_judgment: false
  - id: C6
    description: "Classification runs asynchronously in the tick, last, for all tenants, and cannot delay STOP handling (D-16)"
    requirement: AI-03
    verification:
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#NO file under src/app/api/webhooks imports the classification module"
        status: pass
      - kind: unit
        ref: "tests/cadence-tick-classification.test.ts#a THROWING classification pass leaves every other count intact"
        status: pass
      - kind: integration
        ref: "tests/cadence-tick.test.ts#completes a tick with no due work as an all-zero result (CAD-05)"
        status: pass
    human_judgment: false
  - id: C7
    description: "The labels a real claude-sonnet-5 call returns are useful — i.e. the classifier agrees with a human on real replies often enough for triage priority to be worth anything"
    verification: []
    human_judgment: true
    rationale: "A1 (structured outputs, no beta header, no tools key) is SETTLED live on this exact model by 05-01's verify:drafting, and this plan sends the same wire shape. What no test here can settle is label QUALITY on real Australian trade SMS — that needs real replies from a real client, and the confidence buckets are self-reported with no logprobs to check them against (research A2). The 'high'-only acting threshold is tunable from data without a schema change, and every guess is recorded, so the answer arrives as evidence rather than as an estimate."
metrics:
  duration: "~45m (36m execution + an 8m serialized remote suite)"
  completed: 2026-08-31
actuals:
  tokens: 25000
  tasks: 3
  commits: 4
---

# Phase 5 Plan 06: Reply Classification with Structural Least Privilege Summary

**An inbound reply now gains a schema-guaranteed label and confidence within a
tick of arriving, and the worst a customer can do by typing anything at all is
change one word on one row a human still reads — proven by an import pin, a
four-column SET list and a full-call-list assertion rather than by intent.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3
- **Files changed:** 14 (4 created)
- **Commits:** 4

## What Was Built

**Task 1 — the boundary, then the pass (commit `70e8750`).** Three functions
were added to the cross-tenant `inbound-messages` family and they are the
*entire* write surface reachable from model output: `listUnclassified` (the
queue — unlabelled, not `dead_letter`, under the attempt cap, oldest first),
`writeClassification` (four pinned columns, guarded on `label IS NULL`) and
`bumpClassifyAttempts` (one column, incremented in SQL). The family's one-table
no-joins promise still holds.

`classifyInbound` then does the smallest possible thing around a model call.
An empty or whitespace-only body is labelled `other`/`low` deterministically with
no API call. Everything else goes to `claude-sonnet-5` capped at 1000 **code
points**, inside `<customer_reply>` delimiters, with a fixed system block that
names the six labels and says the delimited content is data. `is_hot` is set only
for high-confidence `interested`/`question`; `opt_out` is recorded at any
confidence and is never hot.

The repository is INJECTED as a three-member structural interface. That is what
makes the whole matrix suite pure, and it has a second effect worth more: the
complete list of what classification may do to the database is three signatures
a reader can see at once.

**Task 2 — pass 5, and the D-16 gate (commit `c03b74b`).** Classification runs
**last**, after the completion sweep, in its own `catch {}` — dead last because
nothing above reads a label (D-14 forbids a label moving any state), so a model
call standing in front of a send would buy this tick nothing.

The plan's `<verify>` includes a shell grep proving no webhook file imports the
classification module, and correctly noted that a `git diff` check would pass
vacuously once committed. The grep has the same problem in reverse — it is not
run again after this plan. So the gate was made permanent as a test that walks
`src/app/api/webhooks/` from disk, matches the **import-path form** (never the
bare word — the ServiceM8 route legitimately says "classifiable" in a comment),
and *first asserts that the walk found files at all*, because a structural gate
pointed at the wrong directory passes forever.

**Task 3 — the two proofs (commit `ab5d57c`).** `classify-inbound.test.ts` grew
to 57 tests: all six labels round-tripping verbatim, the 18-cell label × confidence
hot matrix written out as a cross product (exactly two hot cells), the four
unusable-answer paths, the full API taxonomy, and five injection fixtures whose
assertion is the **complete repository call list** rather than the absence of one
feared call. `classification-privilege.test.ts` is the structural half: the whole
import list pinned as an equality, eleven forbidden barrel names checked absent,
the request literal proven to carry `output_config` and no `tools`/`tool_choice`/
`betas`/sampling parameter, and the repository's own SET lists and WHERE
predicates read out of the source.

## Deviations from Plan

### Inherited user direction, with a concrete consequence

**1. [USER-DIRECTED] The model is `claude-sonnet-5`, and therefore the request
sends NO `temperature`**

- **Recorded in:** 05-01-SUMMARY.md and STATE.md; supersedes CLAUDE.md's Haiku
  classification row for this project.
- **Why it is not merely a string swap:** the plan's `<interfaces>` block says
  *"`temperature: 0` — temperature IS allowed on Haiku 4.5"*. It is not allowed
  on Sonnet 5, which answers all four sampling parameters (and `thinking`) with a
  400 — proven live by `verify:drafting`'s negative probe. Following the plan
  literally would have produced a total classification outage behind an error
  nobody can read. The absence is asserted twice: behaviourally in the matrix
  suite and structurally in the privilege suite.

### Judgement calls that differ from the plan's wording

**2. [Rule 2] The three "left unlabelled" arms collapse into ONE tick count**

- The plan pins exactly four route fields, one of which is
  `inboundClassifyDeferred`. Internally the pass distinguishes `deferred`,
  `unparseable` and `deterministicFailed`, and 05-04's rule is one field per
  different thing to DO.
- **Kept the plan's four**, because every arm's answer here is *nothing*: an
  unlabelled reply costs a triage row sorted by arrival instead of by label
  (Phase 4's behaviour, and fine), `classify_attempts` bounds the retry burn
  without anybody looking, and the deploy-level 400 an operator *would* act on
  already surfaces loudly and per tenant as `draftsDeterministicFailed`. The
  argument is written out on the field so a later reader can disagree with the
  reasoning rather than with a silence.

**3. [Rule 2] An `unknown` API error defers without counting an attempt**

- The plan's taxonomy line says "deterministic errors bump attempts" and is
  silent on `unknown`. That arm includes throws from our own code.
- Spending a row's five attempts on OUR bug would retire a customer's reply for
  a reason that has nothing to do with it, so `unknown` leaves the row entirely
  alone. The residue — a persistently-unknown failure retrying every minute — is
  bounded by nothing here, deliberately and narrowly, exactly as 05-04 left the
  same arm in drafting.

**4. [Rule 2] `writeClassification` is guarded on `label IS NULL`**

- Not in the plan. Added in the house style (`markInboundTriaged`,
  `pauseWhereActive`): two ticks overlapping on one row — a slow call and a fast
  one, or a redeploy mid-pass — must not let the second answer overwrite the
  first. The first label is the one an operator may already have acted on, and a
  silent replacement would leave `is_hot` flipping under a human's hands with
  nothing in the record to explain it.

**5. [Rule 2] One test file beyond the plan's list:
`tests/cadence-tick-classification.test.ts`**

- Task 2's acceptance criteria ask for "a thrown classification error leaves
  every other count intact (test with a throwing fake)", but list only
  `tests/cadence-tick-route.test.ts` — which mocks `run-tick` and therefore
  cannot see inside it. A pure suite that mocks the repository to return no
  tenants proves the claim without a database: every other pass legitimately
  does nothing, and the assertion is that the tick still returns a complete,
  fully-populated result after its last pass has thrown.

### Auto-fixed

**6. [Rule 2 — Missing critical] Explicit `classifyClient: null` at all seventeen
existing tick call sites** (commit `c03b74b`)

- **Found during:** Task 2, auditing what a new `undefined`-means-build-one seam
  does to existing callers.
- **Issue:** `cadence-tick`, `cadence-completion-sweep`, `cadence-dispatch` and
  `cadence-tick-isolation` call `runCadenceTick({ draftClient: null, … })`
  without a `classifyClient`, which builds the REAL Anthropic client from the
  environment. And this pass is worse than drafting's equivalent: **the
  classification scan is GLOBAL, not per tenant**, so those suites would have
  read real inbound replies off the production-shared hosted database and put a
  stranger's words into a billed request, from any machine with a key in
  `.env.local` — and this machine has one.
- **This is 05-04's deviation 5 repeating one pass over**, which is itself the
  finding: a seam whose `undefined` means "build a real client" will do this to
  every caller that predates it, every time one is added.
- **Fix:** explicit `null` at all seventeen, with the reason recorded at the
  first site in each file.

**7. [Rule 3 — Blocking] The `lint-ban` barrel pin fired, and was extended rather
than widened** (commit `c03b74b`)

- `tests/lint-ban.test.ts` asserts the repository barrel's export list
  exhaustively. Three additions failed it — the guard doing precisely its job.
  The names were added with a paragraph saying *why these three are worth naming*
  (they are the entire write surface reachable from model output), rather than
  the assertion being relaxed.

**8. [Rule 3 — Blocking] `cadence-tick-isolation`'s repository mock, and
`cadence-tick`'s exhaustive CAD-05 assertion** (commits `c03b74b`, `b4e072e`)

- `run-tick.ts` now transitively imports the classification module, which binds
  the three repository functions at load. The isolation suite's `vi.mock` had to
  resolve them; they were given **throwing** bodies rather than no-ops, so a
  future omitted `classifyClient` fails loudly instead of quietly reading the
  real hosted table.
- `cadence-tick.test.ts`'s all-zero CAD-05 assertion is a deliberate `toEqual`,
  so the four new fields had to be acknowledged. **`classificationUnconfigured`
  is 1 there, not 0** — that tick passes `classifyClient: null`, the pass does
  not read the queue at all, and a 0 would be indistinguishable from a healthy
  pass with nothing to do. This one is remote-only, which is why the full
  `test:remote` run below was not optional.

---

**Total deviations:** 1 inherited user direction, 4 judgement calls recorded,
3 auto-fixed (1 × Rule 2 correctness, 2 × Rule 3 blocking).
**Impact:** no scope creep. Deviation 6 is a defect this plan's own changes would
otherwise have shipped — and would have paid for, on customer data.

## Verification Evidence

| Check | Result |
| --- | --- |
| `npx vitest run tests/classify-inbound.test.ts` | **57 passed** (new suite, pure) |
| `npx vitest run tests/classification-privilege.test.ts` | **25 passed** (new suite, pure) |
| `npx vitest run tests/cadence-tick-classification.test.ts` | 4 passed (new suite, pure) |
| `npx vitest run tests/cadence-tick-route.test.ts` | 26 passed (22 + 4 D-16 gate + 1 ordering + 1 catch-shape) |
| The plan's `<verification>` line 1 (three suites together) | **108 passed** |
| `! grep -rq "from.*core/classification" src/app/api/webhooks/` | **exit 0** — gate passes, and is now also a permanent test |
| Full `npm test` (pure) | **1461 tests passed, ZERO assertion failures** |
| `npm test` failed *files* | 31 — every one the WR-09 remote-refusal gate at import, verified by counting the distinct error string (31 FAIL lines, 31 "Refusing to run"). Unchanged from the 05-04 baseline |
| **Full `npm run test:remote`** (serialized, foreground) | **82 files, 1841 tests, ALL PASS** |
| Crons after the remote run | re-armed, lease released — confirmed in the run output |
| `npx tsc --noEmit` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| File deletions across the four commits | **0** (`git diff --diff-filter=D`) |
| New `console.error` calls reviewed | two, emitting failure kind + error CLASS + status only. Pinned by a test that throws a `BadRequestError` whose *message contains the fixture's reply body* and asserts the log does not |

### The must_haves truths, each pinned

| Truth | Where |
| --- | --- |
| Closed enum via structured output, NO tools key on the wire (AI-02, AI-03) | privilege: "contains NO tools property and no tool_choice"; matrix: six label round-trips |
| Async, all tenants, over rows the LLM-free webhook already handled (D-16) | "NO file under src/app/api/webhooks imports the classification module"; "the tick runs classification LAST"; the throwing-fake isolation test |
| Label columns only — no cadence, no suppression, no send path (D-13, D-14) | "writeClassification sets EXACTLY the four classification columns"; "references ONLY the three sanctioned repository functions"; five injection fixtures asserting the full call list |
| Below-high is needs-human; is_hot only for high interested/question (D-15) | the 18-cell matrix, with the two hot cells asserted by enumeration |
| An empty body never reaches the model (AI-03 empty edge) | "labels %s as other/low with ZERO API calls", three whitespace shapes |
| The 1000-cap affects the prompt, never the row (AI-03 encoding edge) | "caps the PROMPT and never the row"; "slices CODE POINTS…" |
| Null/invalid parse leaves the row unlabelled with attempts bumped; a capped row is never fetched | four unusable-answer tests; "listUnclassified carries all three predicates" |

## Surprises & Findings

**A comment sentence parsed as an import.** The privilege suite's first run
failed with an unexpected import specifier of `"how\n * much got labelled"` — a
`from "…"` in an English sentence inside a header block. Fixed by running the
scanner over comment-stripped source, and worth recording because the failure
mode of a *lax* structural gate is a false positive somebody deletes; the failure
mode of a *strict* one is a false negative nobody sees. This one failed in the
safe direction by luck.

**The prompt-caching thread ends here, deliberately, with no marker.** 05-01
measured 753 tokens against a ~1024 minimum; 05-04 lengthened the drafting prefix
and left the question to real usage counters. The classification system block is
about forty lines and will never come close, so **no `cache_control` was placed
at all** — a marker on a prefix that cannot cache is a claim the usage counters
would quietly contradict, and research explicitly says classification prompts
essentially never cache. Recorded as a decision rather than an omission.

**`classificationUnconfigured` is a flag wearing a count's clothes.** With no
API key the pass returns before reading the queue (running that scan every minute
to rediscover a missing key answers a question the environment already answered),
so there is no number of rows to report. It returns 1. This surfaces in the
CAD-05 all-zero remote assertion as the one non-zero field, which is honest and
initially looks wrong — the comment there says why.

**The plan's own `<verify>` gate could not verify itself.** Task 2's shell grep
is correct today and is never run again. The same is true of most one-shot
verification commands; the difference here is that D-16 is a compliance
guarantee, so the gate was promoted into a test with an explicit
"did-the-walk-find-anything" assertion in front of it.

## Known Stubs

| Stub | File | Reason / resolved by |
| --- | --- | --- |
| `is_hot` is written and nothing reads it | `src/core/classification/classify-inbound.ts` | **By design (D-14): labels are evidence + triage priority only in Phase 5.** The flag is what Phase 6's CON-02 hot-lead SMS escalation consumes; writing it now is what makes that a read rather than a backfill. |
| Nothing yet surfaces `opt_out` at the top of the triage queue, so D-13's soft-opt-out path has a recorded label and no screen | `src/core/classification/classify-inbound.ts` | **The other half is 05-07's**, which the plan says explicitly ("the triage surfacing in plan 05-07 decides priority"). Nothing is lost meanwhile: the row is already in the existing triage read, and a deterministic STOP was suppressed by the webhook without any of this. |
| The `high`-only acting threshold and the three confidence buckets are self-reported guesses with no calibration | `src/core/classification/classify-inbound.ts` | **Deliberate, and tunable without a schema change** (research A2 — structured outputs carry no logprobs). Every guess is recorded with its confidence, so the threshold can be moved from data rather than from opinion. |
| No live API proof of a classification call in this plan | — | A1 was settled live on `claude-sonnet-5` by 05-01's `verify:drafting`, and this plan sends the same wire shape (same model, same `output_config.format`, no tools, no sampling params) — asserted structurally. What remains unproven is label QUALITY on real replies; see coverage C7. |

None of these prevent the plan's goal.

## Requirements

**AI-03 marked Complete.** This is the LAST plan claiming it (05-02, 05-06),
which is the rule 05-01 set after reverting a premature completion. Every clause
now holds and is asserted rather than intended: templates constrain drafting
(05-01/05-02/05-04), classification is schema-only as a property of the wire
request, and no inbound text can alter system behaviour directly — the write
surface is three functions and four columns, pinned by a suite that fails on the
import rather than on the outcome.

**AI-02 stays Pending** — 05-07 also claims it, and the requirement's second
half ("low-confidence classifications route to the operator") is only half done
here: the routing DECISION is made and recorded, but the operator's screen that
acts on it is 05-07's.

## Deferred / Owed

- **Nothing owed from this plan.** Every command in `<verification>` ran, plus
  the full serialized remote suite rather than the pure ones alone.
- **Label quality on real replies** — coverage C7. Needs a real client's inbound
  messages; the confidence column is already recording what would settle it.
- Pre-existing and still open: the undeployed-commit note from Phase 4. This
  plan's changes are also undeployed, so production's tick has no classification
  pass at all. Nothing is at risk from that — an unlabelled reply is Phase 4
  behaviour — but **deploy before arming any real client**, for the D-12/D-14
  reasons 05-01 and 05-04 both recorded.

## Note on `actuals`

`tokens: 25000` is **chars/4 over the realized diff** (99,509 characters of added
lines). Flagged because 05-04's `32000` was computed on an unstated basis over an
almost identical diff (99,830 characters), so the two numbers are not directly
comparable and the series should not be read as a trend until one basis is
chosen. Against this plan's `estimate.tokens: 60000` (confidence `low`) the
same-basis reading is a ~2.4× over-estimate.

## Threat Flags

None. This plan's four register entries are implemented and asserted:

- **T-5-21** (injection steering system state) — no `tools` on the wire, closed
  enum via `output_config.format`, write surface of two pinned functions, and
  five injection fixtures whose assertion is the full repository call list.
- **T-5-22** (injected soft opt-out triggering suppression) — the classification
  module cannot import `cadence/controls`, `repository/for-tenant`, dispatch, any
  sender, or the suppression schema; asserted by an import-list equality, not by
  a deny-list.
- **T-5-23** (reply bodies in logs or responses) — counts-only tick fields, an
  enumerated route body, and a leak test that throws an SDK error carrying the
  fixture's reply text and asserts it never reaches the log.
- **T-5-24** (poisoned row retried every minute) — `classify_attempts < 5` in the
  read's own predicate, incremented in SQL, plus the batch stop on a rate limit
  or outage.

## Next Phase Readiness

- 05-07 is unblocked and owns three things this plan deliberately left: the
  `opt_out`-first triage ordering (D-13's operator-confirmed suppression), the
  below-high "model's guess shown but not acted on" presentation (D-15), and
  AI-02's completion.
- Phase 6's hot-lead escalation can read `is_hot` directly; it is written on
  every high-confidence `interested`/`question` reply from the moment this
  deploys.

## Self-Check: PASSED

All four created files verified present on disk. All four commits verified in
`git log`: `70e8750`, `c03b74b`, `ab5d57c`, `b4e072e`.

---
*Phase: 05-ai-drafting-classification*
*Completed: 2026-08-31*
