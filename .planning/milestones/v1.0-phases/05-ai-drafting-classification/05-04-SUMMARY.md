---
phase: 05-ai-drafting-classification
plan: 04
subsystem: drafting
tags: [ai, drafting, anthropic, prompt-caching, failure-taxonomy, regeneration, ai-01, ai-04, t-3-24]
status: complete
requires:
  - "05-01 tracer: DraftClient seam, touch_drafts evidence table, drafts.insertAttempt"
  - "05-02: validateDraft violations shaped as D-11 feedback; buildDraftPrompt takes the whole template set"
  - "05-03: the onboarding gate, so paused cadences never reach this pass"
provides:
  - "the production drafting pass: per-tenant batch, one cached prefix, full failure taxonomy, one regeneration, attempt ceiling"
  - "templates.latestApprovedSet(channel) — the caller half of the D-09 caching fix"
  - "drafts.markSuperseded(draftId) — the rejected attempt is kept, relabelled"
  - "describeAnthropicError().kind — the closed failure vocabulary both AI passes branch on"
  - "buildDraftPrompt regenerationFeedback (PROMPT_VERSION p3)"
  - "eight enumerated drafting counts on CadenceTickResult and the tick route"
affects:
  - "05-06 (classification reuses the failure vocabulary and the batch discipline)"
  - "05-07 (console approve must refuse a validator_failed draft unedited — this plan parks them at pending_approval)"
  - "Phase 6 CON-04 (draft aging reads the touches this pass leaves in needs_draft)"
tech-stack:
  added: []
  patterns:
    - "narrow structural repository interface (DraftRepository) so a pass can be tested with no database and no casts"
    - "one classifier for a provider's errors, in the file that owns the boundary — never a second instanceof chain at a call site"
    - "count fields split by what an operator would DO, not by code branch"
key-files:
  created:
    - tests/draft-touches.test.ts
  modified:
    - src/core/drafting/draft-touches.ts
    - src/core/drafting/prompt.ts
    - src/core/drafting/validate.ts
    - src/core/shared/anthropic.ts
    - src/core/cadence/run-tick.ts
    - src/app/api/internal/cadence-tick/route.ts
    - src/db/repository/for-tenant.ts
    - src/db/repository/index.ts
    - tests/cadence-tick.test.ts
    - tests/cadence-tick-route.test.ts
    - tests/draft-pipeline.test.ts
    - tests/drafting-prompt.test.ts
    - tests/drafting-validate.test.ts
key-decisions:
  - "A rate limit or an outage STOPS the tenant's batch; a deterministic 400/401/403 does NOT — a batch stop on a touch-specific 400 would park the tenant's whole oldest-first queue behind one poisoned input, silently and permanently"
  - "Deterministic API failures record NO attempt row: the line is 'record what the model DID', and a 400 is a request that never produced model output"
  - "Refusal, double validator failure and double truncation all end the same way — an attempt row plus pending_approval, where only edit-then-approve can pass it"
  - "The attempt ceiling counts RECORDED attempts read from the evidence table, so the burn it bounds is the cross-tick one"
  - "PROMPT_VERSION bumped to p3 because the regeneration section is part of the prompt contract; the attempt number says which branch produced a row"
  - "Rules 1 and 2 of the validator judge the model's half of the body, never our own appended compliance suffix"
requirements-completed: [AI-01]
coverage:
  - id: D1
    description: "Drafting is batched per tenant with one byte-identical system block carrying a single cache_control breakpoint, and calls are sequential"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "tests/draft-touches.test.ts#sends a byte-identical system block with exactly one cache breakpoint"
        status: pass
      - kind: unit
        ref: "tests/draft-touches.test.ts#sends no sampling parameter and no thinking key (the Sonnet 5 400 trap)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The batch takes the needs_draft queue first (anti-starvation), caps at 25, de-duplicates the promotion, and drafts in scheduled_at-then-id order"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "tests/draft-touches.test.ts#takes the queue read first, so a prior tick’s failures cannot starve"
        status: pass
      - kind: unit
        ref: "tests/draft-touches.test.ts#drafts in scheduled_at then id order, whichever read supplied the row"
        status: pass
    human_judgment: false
  - id: D3
    description: "The full Anthropic failure taxonomy: rate limit and outage stop the batch, a deterministic 400 continues it and records no body row, and logging is class names only"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "tests/draft-touches.test.ts#D-10 — the API failure taxonomy (6 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exactly one regeneration per validator rejection, with the violations fed back as instructions naming the provided value; the loser is superseded, never deleted"
    requirement: AI-04
    verification:
      - kind: unit
        ref: "tests/draft-touches.test.ts#D-11 — exactly one regeneration, and never a third call (3 tests)"
        status: pass
      - kind: unit
        ref: "tests/drafting-prompt.test.ts#the D-11 regeneration section (4 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A 200 carrying no draft (refusal, max_tokens, schema miss) is recorded and parked for mandatory human authoring; a refusal is never re-asked"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "tests/draft-touches.test.ts#D-10 — a 200 that carries no draft (4 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A poisoned touch cannot burn calls forever — MAX_DRAFT_ATTEMPTS recorded attempts stops the pass asking"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "tests/draft-touches.test.ts#Pitfall 4 — a poisoned touch cannot burn calls forever (2 tests)"
        status: pass
    human_judgment: false
  - id: D7
    description: "No failure path composes a sendable body from the raw template (D-10), proven over nine scenarios with a sentinel token"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "tests/draft-touches.test.ts#never records template text as a body (9 parameterised cases)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every generation attempt is a touch_drafts row with attempt, model, template version, prompt version, validator result and usage counters"
    requirement: AI-04
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#promotes and drafts a touch in the same tick, reporting it in the counts (AI-01)"
        status: pass
      - kind: integration
        ref: "tests/draft-pipeline.test.ts#drafts a needs_draft touch into pending_approval with full AI-04 evidence"
        status: pass
    human_judgment: false
  - id: D9
    description: "The tick reports drafting in eight enumerated count fields and the route response key set is pinned exactly (T-3-24)"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#reports EXACTLY the agreed key set — additions are deliberate, never a spread"
        status: pass
      - kind: integration
        ref: "tests/cadence-tick.test.ts#completes a tick with no due work as an all-zero result (CAD-05)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Prompt caching engages at the new prefix length on a real Sonnet 5 call (cache_read_input_tokens > 0 across a tenant's batch)"
    verification: []
    human_judgment: true
    rationale: "The structure is proven (one breakpoint, byte-identical block, sequential calls, counters recorded) but whether the longer prefix actually clears Sonnet 5's ~1024-token minimum can only be settled by a real batch of 2+ live calls for one tenant. No such tenant exists yet — it needs a client with five approved templates and a voice profile."
metrics:
  duration: "~45m"
  completed: 2026-08-31
actuals:
  tokens: 32000
  tasks: 3
  commits: 4
---

# Phase 5 Plan 04: Production Drafting Pass Summary

**The drafting pass now survives the real world: one cached prefix per tenant
batch, an oldest-first queue that cannot starve a failed touch, the full
Anthropic failure taxonomy split by what an operator would do about it, exactly
one regeneration per rejection, an attempt ceiling read from the evidence table,
and eight enumerated counts in the tick — with every failure still resolving
toward "don't send".**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (plus one deviation fix)
- **Files modified:** 17 (1 created)
- **Commits:** 4

## What Was Built

**Task 1 — the batch (commit `4a0f134`).** `draftTouches` reads its own queue via
`touches.listNeedsDraft(25)` and appends the promotion `RETURNING`
de-duplicated, so a touch whose draft failed at 09:01 is picked up at 09:02
rather than abandoned forever. The cap is applied BEFORE the sort — the queue
read fills the 25 slots first (anti-starvation is about inclusion), and order
within the batch is purely `scheduled_at` then `id`, `claimDue`'s tie-break.

One system block per batch now carries a single `cache_control` breakpoint and
is built from the tenant's WHOLE approved set via the new
`templates.latestApprovedSet('sms')` — the caller half of the caching fix 05-02
recorded as missing. `priorBodies` is no longer `[]`: `drafts.sentBodiesForCadence`
feeds what this cadence has already SAID (D-02).

`draftTouches` also stopped taking `TenantScopedRepository` and now takes a
narrow structural `DraftRepository` of `Pick<>`ed row types. That is what makes
Task 2's failure matrix a PURE suite — object literals that typecheck against
the same contract production uses, no database and no casts. 05-01 recorded what
the alternative costs: one `as never` made a throwing-client test pass green
without the client ever being called.

**Task 2 — the taxonomy and the loop (commit `8c8e29d`).**
`describeAnthropicError` now also returns a `kind` from a closed vocabulary
(`rate_limited | retryable | deterministic | unknown`), so the drafting pass and
05-06's classification pass cannot run two `instanceof` chains that drift apart —
04-09's CR-02 is exactly that failure. `RateLimitError` and `APIConnectionError`
are still checked before `APIError`, and the connection-error test proves the
ordering: with `APIError` first, a dropped socket would classify as `unknown`
and the batch would not stop.

The per-touch loop: attempt ceiling → template → facts → call → judge →
one regeneration → park or record. Nine failure modes, each a named test.

**Task 3 — honest accounting (commit `5949e74`).** The single `draftsDeferred`
lump became eight fields, split by what an operator would DO about each. The
route enumerates every one by hand, and the route test now pins the EXACT
response key set so a field can neither appear nor vanish unnoticed (T-3-24).

## Deviations from Plan

### Judgement calls that differ from the plan's wording

**1. [Rule 1 — the plan's own mechanism did not bound what it claimed to bound]
A deterministic API failure CONTINUES the batch and records nothing**

- **Found during:** Task 2, writing the taxonomy.
- **Issue:** the plan says a bodiless deterministic failure should "increment a
  per-touch attempt guard … the attempt cap below stops the per-minute retry
  burn", while also forbidding an attempt row when no body exists. Those two
  cannot both hold: with no row there is no attempt to count, so the ceiling
  never bites and the touch retries every minute forever — the exact Pitfall 4
  the clause was written to close.
- **Fix, and the reasoning:** a 400/401/403 is not a property of the touch. It is
  either deployment-wide (a sampling parameter, a revoked key) or specific to one
  unusual input, and this pass cannot tell which. So the arm CONTINUES: stopping
  would park the tenant's whole oldest-first queue behind one poisoned touch,
  silently, every minute, until a human noticed — and 4xx responses are not
  billed, so a deploy bug costs a burst of fast failures that is loud in the
  counts rather than invisible. The forever-retry residue is bounded by the
  cadence engine's own staleness rules (D-10/D-11), which is where the research
  puts it until Phase 6's CON-04 alerting.
- **Rate limit and outage still stop the batch**, exactly as the plan says, and
  for the reason the plan gives: those are account-wide.
- **Commit:** `8c8e29d`

**2. [Rule 2 — closing the same hole one door over] Every "the model answered
with nothing usable" outcome gets one regeneration, then a human**

- **Issue:** the plan prescribes a regeneration for `max_tokens` only. A
  `parsed_output` of null (schema not satisfied) was left at the tracer's
  `deferred`, which leaves the touch in `needs_draft` with no attempt recorded —
  the same unbounded loop as above, reachable from a model that keeps emitting
  malformed output for one input.
- **Fix:** one rule for all three — refusal, truncation, schema miss. A refusal
  is never re-asked (identical input, identical answer; the plan and the research
  both say so). The other two earn ONE regeneration, and a second failure records
  an empty-bodied `validator_failed` attempt and parks the touch at
  `pending_approval` for mandatory edit-then-approve. Every path that is not an
  infrastructure failure now terminates.
- **Commit:** `8c8e29d`

**3. [Rule 2 — AI-04 honesty] `PROMPT_VERSION` bumped to `p3`, and the feedback
lives in `prompt.ts`**

- **Issue:** appending the violation list to the user turn inside
  `draft-touches.ts` would have left `prompt.ts` "the single owner of prompt
  bytes" untrue, and every row recording `p2` for a prompt the `p2` builder never
  produced. 05-02's own rule: bump whenever the field set changes.
- **Fix:** `regenerationFeedback` is a first-class optional input, rendered LAST
  in the user turn (most volatile, furthest from the cache boundary), never in
  the system block — pinned by a test asserting the system block is byte-identical
  with and without it. Which branch produced a row is answered by `attempt`.
- **Commit:** `8c8e29d`

### Auto-fixed

**4. [Rule 1 — Bug] The validator judged our own compliance suffix by the rules
written for the model** (commit `3117021`, its own fix commit)

- **Found during:** Task 3, designing the remote tick test — the seeded tenant
  name contains digits, and the draft would have been refused.
- **Issue:** rules 1 and 2 scanned the whole body, suffix included. But
  `complianceSuffix(tenants.name)` is text WE compose, and **"A1 Plumbing",
  "24/7 Electrical" and "March Electrical" are real Australian trade names**. Those
  clients produced an `unlisted_number` or `unlisted_date_word` violation on
  every attempt — one no regeneration can fix, because the characters are
  reappended to each one. A permanently undraftable client whose only symptom is
  that every single draft has to be authored by hand.
- **Why it is Rule 1 and not scope creep:** it is the same failure 05-02 closed
  for a smart apostrophe in a tenant name, one rule over, and it blocked this
  plan's own verification.
- **Fix:** rules 1 and 2 scan the model's half of the body. The excluded region
  is exactly the trailing bytes that ARE the expected suffix, and only when the
  body genuinely ends with them — an imitation gets `missing_suffix` AND is
  scanned whole. Rules 3 and 4 still cover everything, because the suffix's
  characters and length reach the customer either way. Four new tests, including
  a fabricated number surviving in the model's half of a body whose business
  name also has digits.

**5. [Rule 2 — Missing critical] Three remote suites now pass `draftClient: null`
explicitly** (commit `5949e74`)

- **Found during:** Task 3, auditing what the backlog read changed.
- **Issue:** `cadence-completion-sweep`, `cadence-dispatch` and
  `cadence-tick-isolation` called `runCadenceTick({ … })` without `draftClient`,
  which builds the REAL Anthropic client from the environment. Harmless while the
  pass only drafted what a tick had just promoted; with the backlog read it would
  make billed API calls, on customer-shaped fixture data, from any machine with a
  key in `.env.local` — and this machine has one.
- **Fix:** explicit `null` at all eight call sites, with the reason recorded at
  the first one in each file. This is precisely the distinction
  `RunCadenceTickOptions.draftClient` documents: `undefined` means "build one",
  `null` means "there is no client".

**6. [Rule 3 — Blocking] `seedCadenceSettings` added to `draft-pipeline`'s
`beforeAll`** (commit `4a0f134`)

- The pass now refuses a tenant with no `cadence_settings` row (the plan's
  `no_voice_profile` count). In production `consume-events` calls
  `settings.ensure()` before it materializes a single touch, so every touch that
  can reach drafting has one; the suite seeds cadences with the admin client and
  bypasses that path, so the invariant had to be seeded explicitly. The comment
  says which production path guarantees it.

**7. [Rule 3 — Blocking] `TouchDraftInsert` exported from the repository barrel** —
`DraftRepository` needs it to say what `insertAttempt` takes, and the project's
`no-restricted-imports` rule forbids reaching past the barrel.

---

**Total deviations:** 3 judgement calls recorded, 4 auto-fixed (2 × Rule 1/2
correctness, 2 × Rule 3 blocking).
**Impact:** no scope creep. Two of them (the suffix bug, the real-client test
calls) are defects this plan's own changes would otherwise have shipped or paid
for.

## Pre-existing working-tree state, adopted

`src/db/repository/for-tenant.ts` already carried **uncommitted** additions when
this plan started: `touches.listNeedsDraft` and `drafts.sentBodiesForCadence`,
both named verbatim in this plan's Task 1 and Task 2 actions, written in this
codebase's style and matching the plan's intent exactly. They were almost
certainly left by an interrupted earlier attempt at this plan. Reviewed line by
line, adopted, and committed as part of Task 1 rather than rewritten. Recorded
here because "code I did not write appeared in the commit" is a thing a reader
of the history is entitled to know.

## Verification Evidence

| Check | Result |
| --- | --- |
| `npx vitest run tests/draft-touches.test.ts` | **34 passed** (new suite, pure) |
| `npx vitest run tests/cadence-tick-route.test.ts` | 22 passed |
| `npx vitest run tests/drafting-prompt.test.ts` | 29 passed (25 + 4 new) |
| `npx vitest run tests/drafting-validate.test.ts` | 37 passed (33 + 4 new) |
| Full `npm test` (pure) | **1317 tests passed, ZERO assertion failures** |
| `npm test` failed *files* | 31 — every one the WR-09 remote-refusal gate at import (`Failed Suites 31`, no `Failed Tests` section, no AssertionError). Unchanged in kind from the 05-01/05-02 baseline |
| **Full `npm run test:remote`** (serialized, wave 3's only remote user) | **78 files, 1697 tests, ALL PASS** (baseline after 05-01 was 72/1525) |
| Crons after the remote run | re-armed, lease released — confirmed in the run output |
| `npx tsc --noEmit` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| File deletions across the four commits | **0** (`git diff --diff-filter=D`) |
| New `console.error` calls reviewed | two, both emitting tenant id + failure kind + error CLASS + status only — no message, no body, no prompt. Pinned by a test that greps the logged output for the fixture's customer name, job text and template sentinel |

### The must_haves truths, each pinned

| Truth | Where |
| --- | --- |
| Batched per tenant, sequential, stable prefix cached via one breakpoint (D-09) | "sends a byte-identical system block with exactly one cache breakpoint" |
| Retryable failure leaves the touch and stops the tenant's batch (D-10) | "stops the tenant’s batch on a rate limit…", "stops the batch on a connection error", "…on a 529 overload" |
| Deterministic failure records the attempt and does not retry forever | "CONTINUES the batch on a deterministic 400, recording no body row" — see deviation 1 for the correction to the plan's mechanism |
| Exactly ONE regeneration, violations fed back; second failure is `validator_failed` and can never be approved unchanged | "regenerates once on a validator rejection and supersedes the loser", "parks the touch for mandatory human authoring when both attempts fail" |
| NEVER a merge-filled fallback (D-10) | "never records template text as a body" — nine scenarios, sentinel token |
| Deterministic order, `scheduled_at` then `id` | "drafts in scheduled_at then id order, whichever read supplied the row" |
| Every attempt is its own row with full provenance (AI-04) | "records the usage counters…" + the two remote suites |
| The 25-cap bounds the tick; leftovers picked up before new promotions | "takes the queue read first, so a prior tick’s failures cannot starve" |

## Surprises & Findings

**The plan's Pitfall-4 mechanism did not bound the burn it claimed to.** Written
out in deviation 1. The interesting part is not the fix but the shape: the clause
read as airtight ("the attempt cap below stops the per-minute retry burn") and
was self-contradicting two sentences earlier. Same shape as 05-02's finding about
the whitelist rule — a rule that is correct about the case you picture and silent
about the case you did not.

**A real business name breaks the validator.** "A1 Plumbing" is not an edge case;
it is a naming convention (alphabetical listings). The suffix is our own text and
was being judged as if the model wrote it. Found only because a seeded tenant
name happens to carry a timestamp — i.e. by accident, in a fixture, one plan after
the rule shipped.

**Whether caching now engages is still unproven, and this plan does not prove
it.** The prefix is genuinely longer (whole approved set + full voice profile)
and the structure is right, but 05-01's measurement was 753 tokens against a
~1024 minimum and nothing here re-measured it against the live API: no tenant
exists with five approved templates AND a voice profile AND two due touches.
`cache_read_input_tokens` is recorded on every row, so the answer will arrive as
data from the first real client rather than as an estimate. **Deliberately not
padded** — inventing tokens to buy a discount on tokens is not a saving, and the
whole drafting bill is $3–8/mo (05-02 recorded the same refusal).

## Known Stubs

| Stub | File | Reason / resolved by |
| --- | --- | --- |
| `MAX_DRAFT_ATTEMPTS` is mostly a BACKSTOP: the normal paths all terminate at `pending_approval` within two attempts, so the ceiling only bites when a regeneration hits an API error (or a crash lands between `insertAttempt` and `markPendingApproval`) and the touch comes back next tick | `src/core/drafting/draft-touches.ts` | **Intentional and documented at the constant.** It is load-bearing for exactly the cross-tick case, which is the one Pitfall 4 describes. |
| A `validator_failed` draft parked at `pending_approval` has an empty `final_body` and relies on 05-07's approve action refusing it unedited | `src/core/drafting/draft-touches.ts` | **By design, and the other half is 05-07's.** Nothing can send it today either: dispatch requires an `approved` `touch_drafts` row and the unique partial index allows one per touch. |
| `no_voice_profile` means the `cadence_settings` ROW is absent, not that the voice fields are empty. A tenant with a present-but-blank profile is still drafted for | `src/core/drafting/draft-touches.ts` | **Deliberate, narrow reading of the plan.** Making an empty profile block drafting would move the ONB-03 activation gate, which is 05-03's and 05-05's, and is an architectural change this plan has no mandate for. |

None of these prevent the plan's goal.

## Requirements

**AI-01 marked Complete.** This is the LAST plan claiming it (05-01, 05-02,
05-04), which is the rule 05-01 set after reverting a premature completion.
Every clause is now implemented and proven: drafts come from the client's voice
profile and their approved template, and prices, dates and names are rendered by
us, whitelisted, and mechanically enforced by a validator with adversarial tests.

**AI-04 stays Pending** — 05-07 also claims it and owes the edit-distance
measurement that the requirement's second half is about. `requirements ready-ids`
independently reported it blocked.

## Deferred / Owed

- **Nothing owed from this plan.** Every command in `<verification>` ran, plus
  the FULL remote suite rather than the two listed files.
- **Live cache measurement** — see the coverage block's D10 and Surprises. Takes
  a real tenant; the counters that answer it are already being recorded.
- Pre-existing and still open: the undeployed-commit note from Phase 4. This
  plan's changes are also undeployed; production still runs the Phase 4 build,
  where `promoteDue` auto-passes to `approved`. **Deploy before arming any real
  client.**

## Threat Flags

None. This plan's four register entries are implemented and asserted:

- **T-5-14** (retry storm) — taxonomy split, batch stop on rate limit/outage,
  attempt ceiling, and the deviation-1 correction that stops a deterministic
  failure wedging a tenant's queue.
- **T-5-15** (merge-fill fallback) — the sentinel-token property test over nine
  scenarios; the only strings that can become a `final_body` are model output
  plus our suffix.
- **T-5-16** (prompts/bodies in logs or responses) — two `console.error` calls
  emitting class names and counts only, pinned by a leak test; the route's key
  set pinned exactly.
- **T-5-17** (tick overrun) — 25-call cap, sequential calls, and a batch that
  stops on the first retryable failure. The research A6 fallback (drafting on its
  own route with its own secret) is unchanged and unneeded: the full remote tick
  suite runs in seconds.

## Next Phase Readiness

- 05-05 (drafting console) and 05-06 (classification) are unblocked. 05-06 should
  branch on `describeAnthropicError().kind` rather than writing its own chain.
- 05-07's approve action must refuse a `validator_failed` draft unedited — this
  plan parks refusals and double failures there deliberately, and that refusal is
  the other half of the guarantee.

## Self-Check: PASSED

`tests/draft-touches.test.ts` verified present on disk. All four commits verified
in `git log`: `4a0f134`, `8c8e29d`, `3117021`, `5949e74`.

---
*Phase: 05-ai-drafting-classification*
*Completed: 2026-08-31*
