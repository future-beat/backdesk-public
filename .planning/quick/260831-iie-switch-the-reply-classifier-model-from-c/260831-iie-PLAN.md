---
phase: quick-260831-iie
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/classification/classify-inbound.ts
  - src/core/cadence/run-tick.ts
  - scripts/verify-drafting.mjs
  - tests/classification-privilege.test.ts
  - tests/classify-inbound.test.ts
  - .planning/STATE.md
autonomous: true
requirements: [AI-02]

estimate:
  tokens: 30000
  raw_tokens: 30000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The inbound reply classifier sends live requests with model claude-opus-5; drafting still sends claude-sonnet-5 (user decision 2026-08-31: classification is critical and cheap at our volume)"
    - "The classification request still carries no temperature, no top_p, no top_k, no thinking param, no tools key and no beta header — the absence-is-the-configuration discipline survives the model swap"
    - "A real claude-opus-5 messages.parse call with output_config.format returns a schema-valid label + confidence (A1 re-settled live by one verify:drafting run)"
    - "STATE.md records the 2026-08-31 user decision as superseding the 05-01 Sonnet-for-classification decision, and notes CLAUDE.md's classification model-table row is historical"
  artifacts:
    - "src/core/classification/classify-inbound.ts — CLASSIFY_MODEL = 'claude-opus-5' with updated decision comment"
    - "scripts/verify-drafting.mjs — classification leg on claude-opus-5, drafting leg untouched on claude-sonnet-5"
    - "tests/classification-privilege.test.ts — source-read assertion pins the new constant literal"
  key_links:
    - "CLASSIFY_MODEL constant -> the messages.parse request's model field (classify-inbound.ts line ~410)"
    - "classification-privilege.test.ts reads classify-inbound.ts source and asserts the exact constant literal — flipping one without the other fails the suite"
    - "verify-drafting.mjs classification leg uses max_tokens: 100, identical to production MAX_CLASSIFY_TOKENS — the live run re-proves the production request shape, including Opus 5's thinking-on-by-default behavior at that cap"
---

<objective>
Switch the inbound reply classifier from claude-sonnet-5 to claude-opus-5, per the user's 2026-08-31 decision: classification is critical and cheap at our volume. Drafting stays on claude-sonnet-5 — DRAFT_MODEL and the drafting pipeline are out of scope.

Purpose: The classifier's label drives pause-on-reply, opt-out handling and hot-lead escalation — the highest-stakes read in the product. Opus 5 ($5/$25 per MTok) at ~2k replies/mo of ~1.2k tokens each is still low single-digit dollars, well inside the <$10/client inference budget.

Output: Model constant flipped in source and live-proof script, classification test pins updated, STATE.md decision record updated, one live structured-output smoke proof on claude-opus-5, full pure test suite + typecheck + lint green.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/core/classification/classify-inbound.ts
@scripts/verify-drafting.mjs
@tests/classification-privilege.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Flip CLASSIFY_MODEL to claude-opus-5 in source and live-proof script</name>
  <files>src/core/classification/classify-inbound.ts, src/core/cadence/run-tick.ts, scripts/verify-drafting.mjs</files>
  <action>
    In src/core/classification/classify-inbound.ts:
    1. Line 77: change the CLASSIFY_MODEL export value to 'claude-opus-5'.
    2. Update the doc comment above it (lines ~63-76): the model is now claude-opus-5 by USER DECISION 2026-08-31 ("classification is critical and cheap at our volume"), superseding the 05-01 operator decision that chose Sonnet 5 over CLAUDE.md's research-time claude-haiku-4-5 row. Keep the paragraph explaining why the request sends no sampling params, updated for the new model: claude-opus-5 REMOVES temperature/top_p/top_k (400 on send) exactly as Sonnet 5 does, so the absence-is-the-configuration discipline is unchanged and required, not merely harmless. Keep the no-date-suffix note and the exported-for-the-privilege-suite note. Cost note: $5/$25 per MTok — still low single-digit dollars/mo at ~2k replies.
    3. Update the request-site comment (lines ~400-402) beside the no-sampling-params explanation: name claude-opus-5 and note that the A2 negative probe plus this quick task's live re-run are the proof. Do NOT touch the request shape itself: no temperature, no top_p, no top_k, no thinking, no tools key, no beta header, no cache_control — leave every absence exactly as it is. One behavioral note worth adding to the comment: on claude-opus-5, omitting the thinking param runs adaptive thinking by default, and thinking tokens count against max_tokens; MAX_CLASSIFY_TOKENS=100 is deliberately re-proven live by verify:drafting (Task 3).
    4. In src/core/cadence/run-tick.ts, line ~45: the pass-5 CLASSIFY doc comment names the classification model inline — update the model name to claude-opus-5. Comment-only change; touch nothing else in the file.
    5. In scripts/verify-drafting.mjs, line 83: change the CLASSIFY_MODEL const value to 'claude-opus-5'. Update the adjacent line-82 comment with the decision lineage (research said Haiku; 05-01 operator chose Sonnet 5; 2026-08-31 user chose Opus 5).
    6. In the same script, line ~32: update the header banner section "THE CLASSIFICATION MODEL IS ..." to name claude-opus-5 and the 2026-08-31 user decision.
    7. Leave DRAFT_MODEL (script line 81) at 'claude-sonnet-5' and leave the drafting leg (section 1) and the A2 negative probe (section 3) untouched — the A2 probe deliberately proves the DRAFTING model rejects temperature, and drafting is not changing.

    Out of scope — do not touch: src/core/drafting/draft-touches.ts (DRAFT_MODEL and both request sites), tests/helpers/seed.ts line 486 (a touch_drafts DRAFTING seed row), tests/draft-touches.test.ts.
  </action>
  <verify>
    <automated>grep -F "export const CLASSIFY_MODEL = 'claude-opus-5'" src/core/classification/classify-inbound.ts && grep -F "const CLASSIFY_MODEL = 'claude-opus-5'" scripts/verify-drafting.mjs && grep -F "const DRAFT_MODEL = 'claude-sonnet-5'" scripts/verify-drafting.mjs && grep -F "export const DRAFT_MODEL = 'claude-sonnet-5'" src/core/drafting/draft-touches.ts && grep -F "model: 'claude-sonnet-5'" tests/helpers/seed.ts && grep -F "claude-opus-5" src/core/cadence/run-tick.ts</automated>
  </verify>
  <done>CLASSIFY_MODEL is 'claude-opus-5' in both classify-inbound.ts and verify-drafting.mjs; DRAFT_MODEL is still 'claude-sonnet-5' in both draft-touches.ts and the script; the seed.ts drafting row is untouched; all decision comments name the 2026-08-31 user decision.</done>
</task>

<task type="auto">
  <name>Task 2: Update classification test pins and record the decision in STATE.md</name>
  <files>tests/classification-privilege.test.ts, tests/classify-inbound.test.ts, .planning/STATE.md</files>
  <action>
    In tests/classification-privilege.test.ts:
    1. Line 187: the source-read assertion pins the exact constant literal — update it to expect "export const CLASSIFY_MODEL = 'claude-opus-5'".
    2. Line ~176: the comment explaining that the model rejects all four sampling params with a 400 — update the model name to claude-opus-5 (the fact itself is unchanged: Opus 5 removes temperature/top_p/top_k/thinking-budget the same way).

    In tests/classify-inbound.test.ts:
    3. Line 267 asserts request.model against the imported CLASSIFY_MODEL constant — correct as-is, no change.
    4. Line ~268: update the comment naming the model to claude-opus-5.

    Classification pins ONLY — tests/draft-touches.test.ts pins DRAFT_MODEL (drafting, unchanged) and tests/helpers/seed.ts line 486 is a touch_drafts drafting seed: leave both alone. No file under tests/remote/ references the classification model (verified by grep during planning), so NO test:remote run is needed and the production-shared Sydney DB is not touched by this task.

    In .planning/STATE.md (use Edit, scoped — never a whole-file Write):
    5. Append a new bullet at the end of the "### Decisions" list: "[Quick / 260831-iie]: USER-DIRECTED — classification moves from claude-sonnet-5 to claude-opus-5 (user decision 2026-08-31: 'classification is critical and cheap at our volume'). Drafting STAYS on claude-sonnet-5. Supersedes the 05-01 Sonnet-for-classification decision; CLAUDE.md's model-table classification row is now doubly historical. The no-sampling-params discipline is unchanged — claude-opus-5 also rejects temperature/top_p/top_k with a 400. A1 re-settled on claude-opus-5 by re-running scripts/verify-drafting.mjs live."
    6. Annotate the existing 05-01 USER-DIRECTED decision entry (the bullet beginning "[Phase ?]: [Phase 05 / 05-01]: USER-DIRECTED — classification runs on claude-sonnet-5") by appending to its end: " (SUPERSEDED 2026-08-31: classification now claude-opus-5 — quick task 260831-iie.)" Do not rewrite the entry body — history stays intact.
  </action>
  <verify>
    <automated>grep -F "CLASSIFY_MODEL = 'claude-opus-5'" tests/classification-privilege.test.ts && grep -F "claude-opus-5" .planning/STATE.md && grep -F "SUPERSEDED 2026-08-31" .planning/STATE.md && npx vitest run tests/classification-privilege.test.ts tests/classify-inbound.test.ts tests/cadence-tick-classification.test.ts tests/draft-touches.test.ts</automated>
  </verify>
  <done>The privilege suite's source-read assertion expects the claude-opus-5 literal and passes; classify-inbound, cadence-tick-classification and draft-touches suites all pass unmodified in behavior; STATE.md carries the new dated decision bullet and the supersession annotation on the 05-01 entry.</done>
</task>

<task type="auto">
  <name>Task 3: Live claude-opus-5 structured-output smoke proof, then full verification</name>
  <files>none — verification only</files>
  <precondition>ANTHROPIC_API_KEY is present in .env.local (the script loads it itself via process.loadEnvFile and refuses loudly if absent).</precondition>
  <action>
    1. Run `npm run verify:drafting` exactly ONCE. It spends a few real API calls: one claude-sonnet-5 drafting call (unchanged), one claude-opus-5 classification messages.parse with output_config.format at max_tokens 100 (the production shape), and one negative probe proving the drafting model rejects temperature. Expected: all legs pass, and the classification leg prints "A1 SETTLED on claude-opus-5" with a schema-valid label and confidence.
    2. Contingency — the one real behavioral difference on Opus 5 is adaptive thinking by default with thinking tokens counting against max_tokens. If (and only if) the classification leg fails on truncation (stop_reason max_tokens or a null parsed_output), raise the cap in BOTH places together — MAX_CLASSIFY_TOKENS in src/core/classification/classify-inbound.ts and the classification leg's max_tokens in scripts/verify-drafting.mjs (e.g. 100 -> 300, keeping the two identical) — then re-run the script once more, and record the finding + new cap in the SUMMARY. Do not add a thinking param and do not add sampling params; the cap is the only sanctioned knob.
    3. Run the pure verification suite: `npm test` — the ~31 failed FILES from the WR-09 remote-refusal gate are pre-existing and expected on a bare run; the pass bar is zero assertion failures in the pure suites and specifically green classify-inbound, classification-privilege, cadence-tick-classification and draft-touches suites (already proven in Task 2; this run proves no collateral damage elsewhere).
    4. Run `npx tsc --noEmit` and `npm run lint` — both must exit 0.
    5. Do NOT run test:remote: no remote suite pins the classification model, and remote runs share the production Sydney DB.
  </action>
  <verify>
    <automated>npm run verify:drafting && npx tsc --noEmit && npm run lint</automated>
  </verify>
  <done>verify:drafting exits 0 with the classification leg settled live on claude-opus-5; tsc and lint exit 0; npm test shows zero assertion failures outside the pre-existing WR-09 remote-refusal file failures; no remote test run was performed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| customer reply -> Claude API request | Attacker-controlled SMS/email text enters the classification prompt (unchanged by this task; capped at 1000 code points) |
| Claude output -> Postgres | Model output crosses into a CHECK-constrained column (unchanged; zod re-validation after messages.parse stays load-bearing) |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-Q-01 | Tampering | classify-inbound.ts request | low | accept | Model swap only; the injection surface (no tools key, schema-only output, zod re-validation) is byte-identical, and classification-privilege.test.ts still reads the source and fails on any tools property |
| T-Q-02 | Denial of service | MAX_CLASSIFY_TOKENS=100 vs Opus 5 default adaptive thinking | low | mitigate | Task 3's live run proves the cap holds on claude-opus-5; contingency raises the cap in lockstep in both places rather than adding a thinking param |
| T-Q-SC | Tampering | package installs | low | accept | No new packages installed by this plan |
</threat_model>

<verification>
- `grep -rn "CLASSIFY_MODEL" src scripts tests` shows the constant defined as 'claude-opus-5' in exactly two places (classify-inbound.ts, verify-drafting.mjs) and consumed everywhere else by reference.
- `grep -F "export const DRAFT_MODEL = 'claude-sonnet-5'" src/core/drafting/draft-touches.ts` still matches — drafting untouched.
- `npm run verify:drafting` exits 0 (one live run; classification leg on claude-opus-5).
- `npm test` pure suites green (WR-09 remote-refusal file failures are pre-existing); `npx tsc --noEmit` and `npm run lint` exit 0.
- STATE.md carries the 2026-08-31 decision bullet and the supersession annotation.
</verification>

<success_criteria>
- Classification runs on claude-opus-5, drafting on claude-sonnet-5, and every model-id pin (source constant, script constant, privilege-suite literal, comments) agrees.
- The request shape is byte-identical apart from the model string: no sampling params, no thinking param, no tools key, no beta header.
- A1 is re-settled live on claude-opus-5 by one verify:drafting run; the decision trail in STATE.md explains what changed, when, and why.
</success_criteria>

<output>
Create `.planning/quick/260831-iie-switch-the-reply-classifier-model-from-c/260831-iie-SUMMARY.md` when done.
</output>
