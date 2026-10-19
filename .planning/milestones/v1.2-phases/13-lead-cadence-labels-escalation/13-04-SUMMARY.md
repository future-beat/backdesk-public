---
phase: 13-lead-cadence-labels-escalation
plan: 04
subsystem: inbound door / reply classification / lead closing tick pass
status: complete
tags: [keyword-rule, lead-vocabulary, structured-output, hot-rule, label-effects, tie-break, d-05, d-06, d-07, d-10, d-11]
requires:
  - 13-01 URGENT_KEYWORDS, LEAD_LABELS / LEAD_URGENCIES and migration 0040's by-kind CHECKs
  - 13-02 closeLead / closeLeadInTx, the null-safe killContactAction, the seed knobs
  - 13-03 inbound.closingLabelRowsForOpenLeads, listUnclassified.leadId, writeClassification's five columns, insertInboundMessage.keywordHot, the (is_hot OR keyword_hot) hot scan
provides:
  - isUrgentKeyword (src/core/leads/urgency-keywords.ts)
  - the door's keyword_hot mark on a non-STOP lead reply, and the single-tenant quote-wins arm in handleManyMatches
  - LeadReplyLabel, LeadUrgency, LeadReplyClassification (src/core/classification/schema.ts)
  - LEAD_CLASSIFIER_INSTRUCTIONS, isHotLeadReply, the lead vocabulary selected by row.leadId (classify-inbound.ts)
  - applyLeadLabelEffects (src/core/leads/label-effects.ts) and the leadsClosedByLabel tick count
affects:
  - 13-05 (digest) — no new surface needed; cold lead replies are now labelled in the lead vocabulary
  - 13-06 (hold/release, ring-twice) — the escalation pass now sees lead rows hot by is_hot (D-07) or keyword_hot (D-06); see Hazards
  - 13-07 (CI gate) — first DB run of the extended tests/lead-reply.test.ts and the inbound-threading log pin
tech-stack:
  added: []
  patterns:
    - "Vocabulary triple: one ask(), one request literal, the (instructions, format, read-with-hot-rule) object picked by row.leadId"
    - "Label effects as a separate tick pass that READS labels, so the classifier keeps its write-a-label-only boundary"
    - "Hand-drawn 120-cell X/. grid as the hot-rule oracle, driven through classifyInbound"
key-files:
  created:
    - src/core/leads/urgency-keywords.ts
    - src/core/leads/label-effects.ts
    - tests/urgency-keywords.test.ts
    - tests/lead-labels.test.ts
    - tests/lead-label-effects.test.ts
  modified:
    - src/core/messaging/inbound.ts
    - src/core/classification/schema.ts
    - src/core/classification/classify-inbound.ts
    - src/core/cadence/run-tick.ts
    - src/app/api/internal/cadence-tick/route.ts
    - tests/classify-inbound.test.ts
    - tests/classification-privilege.test.ts
    - tests/cadence-tick-route.test.ts
    - tests/inbound-threading.test.ts
    - tests/lead-reply.test.ts
decisions:
  - "The D-10 tie-break applies to ordinary replies only; a STOP matching a quote and a lead at one client still honours every candidate (D-03), and the reconciling sweep closes the lead opt_out"
  - "The tie-break closes the leads BEFORE threading the reply to the quote cadence, so a failed row write retries as an ordinary single match"
  - "Quote classification writes now state urgency: null (the interface declares it as required), closing the 13-03 bivariance hole; the DB row is unchanged"
  - "applyLeadLabelEffects walks every tenant from forAllTenants_cadenceTick, paused ones included: a close sends nothing and stops a chase"
  - "LEAD-02 marked complete here (code and pure proof); its DB proof runs at 13-07's CI gate. LEAD-03 stays pending until 13-06 (hold, ring-twice)"
metrics:
  duration: "~35 min"
  completed: 2026-10-08
  tasks: 3
  files: 15
estimate:
  tokens: 70000
  tasks: 3
actuals:
  tokens: 21200
  tasks: 3
  commits: 4
requirements-completed: [LEAD-02]
requirements-contributed: [LEAD-03, LEAD-01]
---

# Phase 13 Plan 04: STOP first, the keyword rule, the lead vocabulary and its effects Summary

Lead replies now have their own path, and the quote path is unchanged:
- **STOP first.** The STOP check is untouched.
- **Keyword rule at the door.** A lead reply containing one of the urgent keywords is marked `keyword_hot` before any model runs.
- **Lead vocabulary.** Lead replies are classified into `LEAD_LABELS` plus an urgency, through a structured output. The vocabulary is chosen by the row's `lead_id`.
- **Label effects.** A new tick pass closes the lead on a high-confidence closing label.
- **Quote wins (D-10).** When a quote and a lead at the same client share one mobile, the reply goes to the quote and the lead is closed.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Keyword rule at the door; single-tenant quote-wins tie-break | `93e2336` | urgency-keywords.ts, inbound.ts, urgency-keywords.test.ts, inbound-threading.test.ts (log pin) |
| 2 | Lead vocabulary in three places, lead hot rule, vocabulary by `lead_id` | `92210b7` | schema.ts, classify-inbound.ts, lead-labels.test.ts, classify-inbound.test.ts, classification-privilege.test.ts |
| 3 | Label effects pass; DB-backed lead-reply proof extended | `146dc49` | label-effects.ts, run-tick.ts, route.ts, lead-label-effects.test.ts, cadence-tick-route.test.ts, lead-reply.test.ts |

## `URGENT_KEYWORDS`, as pinned

`'urgent', 'emergency', 'burst', 'flooding', 'flooded', 'gas leak', 'smell gas', 'no power', 'locked out', 'sparking'`

`tests/urgency-keywords.test.ts` pins this list, in order. The rule is built at module load as `\b(?:…)\b`. It is case-insensitive and not global. Each keyword is regex-escaped, and the spaces inside a phrase become `\s+`.

The test pins:
- **Hot:** `"URGENT"`, `"Urgent!"`, `"urgent, no power"`, `"no  power"`, `"gas\nleak"`.
- **Cold:** `"urgently"`, `"no worries"`, `"sparky"`, `"spark plug"`, `"gas hot water quote"`, `"no hot water"`.
- **`"not urgent"` is hot.** This is the locked rule from research Open Question 4. A comment in the test names the cost: one extra SMS to the tradie, after which the model's `flexible` urgency sits on the row.

## The three-place identity test: what it reads

`tests/lead-labels.test.ts` compares three sources, member for member and in order:
- **TS consts:** `LEAD_LABELS` and `LEAD_URGENCIES`.
- **Schema file CHECK text** (`readFileSync('src/db/schema/inbound-messages.ts')`):
  - the `lead_id IS NOT NULL AND label IN (…)` arm of `inbound_messages_label_known`;
  - `inbound_messages_urgency_known`;
  - `inbound_messages_label_confidence_known`.
- **Migration CHECK text** (`readFileSync('src/db/migrations/0040_phase13_lead_cadence.sql')`): the `ADD CONSTRAINT "inbound_messages_label_known"` lead arm and `"inbound_messages_urgency_known"`.
- **zod:** `LeadReplyLabel.options` and `LeadUrgency.options`.

It also checks that `INBOUND_LABELS` is unchanged and is still the quote arm of the same CHECK in both files.

The hot matrix has 120 cells: 10 labels × 4 urgencies × 3 confidences. Its oracle is a hand-written X/. grid with 33 hot cells. Every cell is checked twice: directly against `isHotLeadReply`, and through `classifyInbound` with a fake client.

## The tick pass order after the edit (`src/core/cadence/run-tick.ts`)

```ts
const cadencesCompleted = await runCompletionSweep();                    // :1444
const leadsClosed = await runLeadCloseSweep(now);                        // :1447
const classification = await runClassificationPass(now, classifyClient); // :1450
const leadsClosedByLabel = await runLeadLabelEffectsPass(now);           // :1454
const escalation = await runEscalationPass(now, escalationSender);       // :1458
```

`leadsClosedByLabel` is a field of `CadenceTickResult`. It is listed field by field in the return and mirrored by the route. The ordered key pin in `tests/cadence-tick-route.test.ts` moved, with fixture value 37.

## Verification (local, pure only)

- `npm run typecheck` and `npm run lint` (max-warnings 0) were clean after every task.
- Task 1 verify: `urgency-keywords`, `text-back-structure` and `lint-ban` passed (386 tests), and so did `clicksend-inbound-route`. The pin diff against plan base `78172a0` was clean: `stop-keywords.ts`, `sync-upsert`, `report-metrics`, `cron-schedules`, `apply-cron-schedules.mjs`. `isStopMessage` appears in `inbound.ts` 2 times, the same as at base.
- Task 2 verify: `lead-labels`, `classify-inbound`, `classification-privilege` and `cadence-tick-classification` passed (242 tests).
- Task 3 verify: `lead-label-effects`, `cadence-tick-route`, `cadence-tick-isolation`, `cadence-tick-classification` and `text-back-structure` passed (353 tests). Separately, the remaining pure tick suites passed: `attribution-consume-isolation`, `stall-claim-isolation`, `cadence-jitter`, `stalled-drafts`, `text-back-tick-passes`, `cadence-dispatch-isolation` and `lead-close-isolation`. The pin diff was clean again.
- **Every pure suite, from an explicit list of 114 files:** 4,598 tests passed. The list excludes every file importing `tests/helpers/seed`, plus `cron-schedules`, `rls-coverage` and `remote-test-watchdog`.
- Acceptance greps:
  - `export function isUrgentKeyword`: 1; `^import` in urgency-keywords.ts: 1
  - In `inbound.ts`: `quote_cadence_wins` ≥ 1, `isUrgentKeyword` ≥ 1
  - The three schema exports: 3; `z.enum(LEAD_LABELS)`: 1
  - Lead names in `classify-inbound.ts`: 10
  - `tools` lines in `classify-inbound.ts`: 3, unchanged from base; `output_format`: 0
  - `lead-labels.test.ts`: 261 lines, and it reads 0040
  - `applyLeadLabelEffects` in `run-tick.ts`: 3; `leadsClosedByLabel` across the three files: 6
  - In `lead-reply.test.ts`: `quote_cadence_wins` 2, `keyword_hot` 9, `complaint` 9, `contact_suppressed` 3, `killContactAction` 3
- **Not run here (DB-backed, CI only):** the extended `tests/lead-reply.test.ts` and the edited log-interpolation pin in `tests/inbound-threading.test.ts`. They first run at 13-07's gate.
  - I checked the new interpolation set offline: I ran the suite's own regex over `inbound.ts`, and it yields exactly the pinned 16 names.
  - No `ALLOW_REMOTE_TESTS` was set, no env file was named, and no migration was applied.

## Deviations from Plan

1. **[Rule 1, honest typing] Quote classification writes now carry `urgency: null`. Four quote assertions in `tests/classify-inbound.test.ts` (nine cases) moved to match.** The orchestrator's hazard 1 asked for this. The plan says "null for a quote row", and also says the quote cases "do not change", which cannot both hold. The cases are the empty-edge `toEqual` (three cases), the four-key set equality, and the injection key-set check (five cases). Each now includes `urgency` / `urgency: null`, with a dated comment. The database receives the same row as before: the column was NULL, and the CHECKs `urgency_lead_only` and `lead_label_has_urgency` hold for quote rows. `INBOUND_LABELS`, the quote prompt, the quote hot rule and the quote wire bytes are unchanged.
2. **[Rule 3] `tests/inbound-threading.test.ts` (DB-backed, not in the file list).** Its pinned log-interpolation set gained `candidate.leadId` and `closed.kind`, the two values the D-10 arm logs (an id and a closed-union kind). Without this change the suite goes red at CI by design.
3. **[Rule 3] The pins in `classification-privilege` moved, and the plan said they would.**
   - The request literal is now one shape for both vocabularies: `system: vocabulary.instructions` and `format: vocabulary.format`.
   - The pins now assert:
     - both `zodOutputFormat(ReplyClassification)` and `zodOutputFormat(LeadReplyClassification)` exist;
     - both `safeParse(parsedOutput)` calls exist;
     - there is exactly one `client.messages.parse(`;
     - the vocabulary is selected by `row.leadId !== null`.
   - The forbidden-import table also gained `core/leads`, so the classifier cannot reach `closeLead`.
4. **The D-10 arm is limited to non-STOP replies.** Calling `handleSingleMatch(quote)` for a STOP would replace D-03's "honour every candidate" with a single-cadence kill. The plan says the STOP branch stays byte-for-byte, so a STOP on both kinds at one client still suppresses and stops both. The sweep then closes the lead `opt_out`.
5. **The tie-break closes the leads first, then threads the reply.** The plan says "handleSingleMatch, then closeLead". The order was reversed for the header's T-4-01 reason: a failed row write then retries as an ordinary single match, because the lead cadence is no longer live.
6. **`applyLeadLabelEffects` walks `forAllTenants_cadenceTick()`, paused tenants included.** That is the set the tick already walks, and every pure tick suite already mocks it. A close sends nothing and only stops a chase.
7. **The comment on the run-tick pass order was corrected during the task.** The first draft claimed escalation would skip a closed lead. In fact the escalation pass reads `is_hot OR keyword_hot` and does not filter on lead state. A high-confidence `complaint` is both hot (D-07) and closing (D-11). The comment now says the lead is settled, with its follow-ups stopped, before the tradie is rung.
8. **DB suite robustness** (`tests/lead-reply.test.ts`):
   - The fake model answers by a per-case token in the body. Every other row in the database gets a cold, non-closing default, so the global classification pass cannot close other suites' leads.
   - Classification ticks loop up to ten times until this suite's rows are labelled, because the queue is oldest-first with 20 rows per tick. The keyword escalation case loops up to five ticks.
   - The restored hot case turns the client's after-hours switch ON, so it does not depend on the CI clock once 13-06's D-09 hold lands.
9. **Restored skipped test, WINDOWS #42 marked fixed.** The 13-02 `it.skip` at `tests/lead-reply.test.ts:213` is now a live case in the lead vocabulary: `callback_request` / `this_week` / high, which is hot under D-07. Its escalation assertions are unchanged in intent. Its first run is at CI.

## TDD Gate Compliance

All three tasks carry `tdd="true"`. Implementation and pure tests were written in the same pass, and each task landed as one `feat(13-04)` commit. No separate RED `test(...)` commit precedes it.
- The pure suites assert behaviour that was absent before, so they would have been red at base: `isUrgentKeyword`, `LeadReplyClassification`, the lead arm and `applyLeadLabelEffects` did not exist.
- The DB-backed extension cannot run RED→GREEN locally (CI only).

The posture matches 13-02 and 13-03.

## Known Stubs

None. Nothing new was added to WINDOWS. The one open Phase 13 entry, #42 (the skipped lead-reply case), is now fixed.

## Threat Flags

None beyond the plan's threat model.
- T-13-08: `keyword_hot` is written only on a reply threaded to a live lead cadence.
- T-13-09: closes happen only on high confidence, enforced in SQL, and are pinned by the pure suite and the DB medium case.
- T-13-13: the door writes `keyword_hot` and never `is_hot`; the classifier's write is five columns; no `tools` key; `safeParse` per vocabulary.
- T-13-06: the tie-break requires `tenantIds.size === 1`, pinned by the existing cross-tenant case, which now also asserts the lead stays open.
- T-13-15: every new log line is a fixed string with ids and a closed-union kind only. Caught values are discarded.

## Hazards for 13-05 / 13-06 / 13-07

1. **13-06: D-09 hold.**
   - The escalation pass now sees lead rows that are hot by `is_hot` (D-07) or by `keyword_hot` (D-06). `isHotLeadReply` puts emergency urgency on `is_hot` at any confidence; the hold rule must read `urgency === 'emergency' || keywordHot` as "regardless".
   - The restored `lead-reply` hot case sets `after_hours_escalation = true` for that reason.
   - The keyword escalation case relies on keywords escalating regardless (D-09).
   - A label-closed lead (a high-confidence `complaint` / `existing_job`) is still escalated: closing never cancels the tradie hearing about it. If 13-06 words lead alerts by lead state, that row's lead reads `closed`.
2. **13-07: first DB runs.**
   - `tests/lead-reply.test.ts` (eleven new cases plus the restored one) reaches `killContactAction` through stubbed `next/cache` and `@/lib/supabase/server`, using the `quote-draft-approval` mould. Those `vi.mock`s apply to the whole file.
   - `tests/inbound-threading.test.ts`'s interpolation pin was edited without a local run.
   - The `[lead, lead]` case seeds two leads whose cadences snapshot one mobile at one client. This is a state the text-back cannot produce. It uses fresh fiction numbers from the 0491 570 6xx block.
3. **The classification cap is unproven live for the lead format.** `MAX_CLASSIFY_TOKENS = 100` was re-proven live for the two-field quote format (`verify:drafting`). The lead format adds one enum field, about ten tokens. Opus 5 adaptive thinking counts against `max_tokens`, so the first live lead reply is the proof.
   - If it comes back unparseable, the row is retried up to `MAX_CLASSIFY_ATTEMPTS` and then sits unlabelled in the inbox. It is never mislabelled.
   - `scripts/verify-drafting.mjs` still probes only the quote format.
4. **13-05:** cold lead replies (`countColdLeadRepliesSince`) are now labelled in the lead vocabulary with `is_hot` from `isHotLeadReply`. A medium-confidence `new_enquiry` is cold by design (D-15).

## State updates

- STATE.md: plan 4 of 7 complete; decisions recorded; metric row added.
- ROADMAP.md: 13-04 ticked, 4/7.
- REQUIREMENTS.md: LEAD-02 complete. LEAD-03 remains Pending (13-06).

## Self-Check: PASSED

- FOUND: src/core/leads/urgency-keywords.ts, src/core/leads/label-effects.ts, tests/urgency-keywords.test.ts, tests/lead-labels.test.ts, tests/lead-label-effects.test.ts
- FOUND commits: 93e2336, 92210b7, 146dc49
