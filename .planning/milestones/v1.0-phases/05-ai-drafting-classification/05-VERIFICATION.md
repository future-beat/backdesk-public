---
phase: 05-ai-drafting-classification
verified: 2026-08-31T08:40:00Z
status: passed
score: 57/57 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 53/53
  gaps_closed:
    - "G-05-3: triage inbox badges legible and correctly laid out on a ~390px phone viewport (05-08, deployed a02a731, user-confirmed on device)"
    - "Human item 1 — judgment-tier prohibitions signed off by operator (05-UAT.md test 1: pass)"
    - "Human item 2 — Phase 5 build deployed to production before arming any client (05-UAT.md test 2: Vercel dpl_5QtnUQKNfBy41ABsejrXLsjqwwwr READY at 133ff9b, then a02a731 with the CSS fix; protected routes 401 a wrong token)"
    - "Human item 3 — phone-viewport console ergonomics (05-UAT.md test 3: pass after 05-08)"
  gaps_remaining: []
  regressions: []
gaps: []
---

# Phase 5: AI Drafting & Classification — Verification Report

**Phase Goal:** Every touch is Claude-drafted in the client's approved voice with facts injected from data, and inbound replies classify safely without being able to steer the system
**Verified:** 2026-08-31T08:40:00Z
**Status:** passed
**Re-verification:** Yes — refresh after gap plan 05-08, completed UAT, security sign-off, and the classifier model swap

## What Changed Since the Prior Run (2026-08-31T04:40Z, human_needed 53/53)

1. **Gap plan 05-08 executed and verified in code** (commit 6334881): G-05-3 inbox badge layout fix. All four static assertions re-run first-hand this verification — `.touch-when` is a wrapping flex container (`display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem`, keeping `flex: 1 1 12rem`); `.badge` hardened (`display: inline-block; white-space: nowrap; max-width: 100%` — exactly 3 new declarations); `.touch-when--stack` defined (globals.css:497,512,524) and applied at inbox/page.tsx:232; `@media (max-width: 22.5rem)` fallback present; quote-detail page file has zero working-tree changes.
2. **All 3 human-verification items resolved** via completed 05-UAT.md (status: complete, 3/3 pass, 0 issues) — see re_verification frontmatter.
3. **Classifier model swap (USER-DIRECTED, quick task 260831-iie):** `CLASSIFY_MODEL = 'claude-opus-5'` (classify-inbound.ts:85) supersedes the 05-01 Sonnet decision, which superseded CLAUDE.md's Haiku row. Recorded in STATE.md (two entries + quick-task ledger row, commits a282a91/5762e79) and in an extensive in-code decision comment. Request discipline unchanged and re-proven live on the exact model per the quick task: no `tools`, no `temperature`/`top_p`/`top_k`/`thinking` (400 on send), `output_config: { format: zodOutputFormat(ReplyClassification) }` + mandatory zod re-parse (verified at classify-inbound.ts:427-432,447). **Recorded decision, not a gap.**
4. **Security sign-off:** 05-SECURITY.md `threats_open: 0`, 30/30 threats closed (27 verified-mitigated at HEAD post-review-fixes and post-opus-swap; 3 accepted risks logged, incl. R-5-03 covering the 05-08 CSS delta).
5. **Deploy lineage verified in git:** the opus-swap commit a282a91 is an ancestor of a02a731; commits after a02a731 (745ed68 UAT doc, 3073a84 security doc) touch `.planning/` only — `git diff --stat a02a731..HEAD -- src/ package.json` is empty, so the deployed build matches HEAD's source exactly.

## Goal Achievement

### Observable Truths — Roadmap Success Criteria (regression-checked this run)

| # | Truth | Status | Evidence (re-verified at HEAD 3073a84) |
|---|-------|--------|----------------------------------------|
| SC1 | Operator captures voice profile + records client approval of per-touch templates; no cadence activates before approval | ✓ VERIFIED | Born-paused same-txn: consume-events.ts:530 `pauseWhereActive([cadence.id], ONBOARDING_PAUSE_REASON)`; promoteDue does exactly one thing `scheduled → needs_draft` (for-tenant.ts:330); write-once attestation; operator resume cannot lift an onboarding pause. Onboarding-gate/cadence-transitions suites green in the recorded serialized remote run |
| SC2 | Drafts from templates + merge fields; validator proves every price/date verbatim; failures force mandatory review | ✓ VERIFIED | Run-to-run whitelist validator (validate.ts, 348 lines); 115 trust-boundary tests (drafting-validate, gsm7, edit-distance, merge-facts, classification-privilege) **re-run first-hand this verification — all pass (625ms)**; live probe evidence (real Sonnet draft passed production validator; `45`-from-`$2,450` substring probe refused) recorded prior run + re-proven on opus by 260831-iie |
| SC3 | Replies classify into the closed enum via structured output; low-confidence routed to operator | ✓ VERIFIED | `messages.parse` with `output_config: { format: zodOutputFormat(ReplyClassification) }` + zod re-parse of `parsed_output` (classify-inbound.ts:427-432,447); model now `claude-opus-5` (user decision, A1 re-settled live on this exact model incl. MAX_CLASSIFY_TOKENS=100 surviving default adaptive thinking); below-high rows surface via `listInboundNeedingTriage`; **badges now render correctly on-device (UAT test 3 pass post-05-08)** |
| SC4 | Inbound text cannot alter system behaviour — schema-only, no tools, least-privilege | ✓ VERIFIED | NO `tools` key in the request (classify-inbound.ts:400-433, pinned by classification-privilege.test.ts — passed first-hand this run); `grep -rn "core/classification" src/app/api/webhooks/` empty; 4-column pinned write surface guarded `label IS NULL`; STOP/pause happen in the LLM-free Phase 4 path |
| SC5 | Every draft records model, template/prompt version, and human edit distance from the very first draft | ✓ VERIFIED | touch_drafts evidence columns (migration 0028); explicit-zero on approve-unchanged; `normalizedEditDistance` on edit-then-approve; edit-distance suite (incl. the 4-decimal backstop tests) passed first-hand this run |

### Plan-Level Truths

- **05-01 through 05-07 (48 truths):** all verified in the prior run at the same HEAD source tree; regression-checked this run via artifact existence (all 16 artifacts present at expected sizes), key-link spot-checks (run-tick.ts:107/113/512/673 wiring; dispatch.ts:488-494 `approvedFinalBody` + `no_approved_draft` refusal; consume-events.ts:530 born-paused; needs_draft-only promotion), and the first-hand 115-test trust-boundary run. No regressions. The only source delta since the prior verification is the 05-08 CSS fix (globals.css +45 lines, inbox/page.tsx 1 line) and the opus-swap commit — both verified above.
- **05-08 (4 new truths):** timestamp/badge gap separation (flex gap mechanism — static assertions pass + on-device confirmation); no mid-text pill fragmentation (inline-block + nowrap); 320px longest-label wraps inside an intact pill (22.5rem fallback present); quote-detail file untouched (`git status --porcelain` empty on it, and 05-08 delta confirmed via `git diff --stat 133ff9b..a02a731`). Rendered confirmation: user on device 2026-08-31, "inbox passed" (05-UAT.md test 3 note).

**Score:** 57/57 truths verified (5 roadmap SCs + 48 plan truths 05-01..07 + 4 gap-plan truths 05-08; 0 present-but-behavior-unverified)

### Required Artifacts (regression existence check, this run)

| Artifact | Lines | Status |
|----------|-------|--------|
| `src/db/schema/message-templates.ts` | 150 | ✓ VERIFIED |
| `src/db/schema/touch-drafts.ts` | 280 | ✓ VERIFIED |
| `src/db/migrations/0028_phase5_drafting.sql` (+0029/0030/0031) | 175 | ✓ VERIFIED |
| `src/core/shared/anthropic.ts` | 206 | ✓ VERIFIED |
| `src/core/drafting/prompt.ts` | 434 | ✓ VERIFIED |
| `src/core/drafting/validate.ts` | 348 | ✓ VERIFIED |
| `src/core/drafting/gsm7.ts` / `edit-distance.ts` / `merge-facts.ts` | 208/113/166 | ✓ VERIFIED |
| `src/core/drafting/draft-touches.ts` | 1065 | ✓ VERIFIED |
| `src/core/drafting/onboarding-gate.ts` | 234 | ✓ VERIFIED |
| `src/core/classification/schema.ts` / `classify-inbound.ts` | 71/544 | ✓ VERIFIED (grew 527→544: opus decision comment block) |
| `src/db/repository/inbound-messages.ts` | 475 | ✓ VERIFIED |
| `src/app/(console)/clients/[id]/drafting/*`, quote-detail draft-review + actions | — | ✓ VERIFIED (prior run; untouched since) |
| `src/app/(console)/inbox/page.tsx` | 322 | ✓ VERIFIED (05-08 modifier applied, line 232) |
| `src/app/globals.css` | — | ✓ VERIFIED (05-08 contract fix, all 4 static assertions pass) |
| `scripts/verify-drafting.mjs` | 312 | ✓ VERIFIED (grew 305→312: opus re-proof) |

### Key Link Verification

All 13 links from the prior run spot-checked at HEAD — WIRED (run-tick→draft-touches:512, run-tick→classify-inbound:673 via runClassificationPass:617, dispatch→drafts.approvedFinalBody:488, consume-events→onboarding-gate:530, classify-inbound→schema zodOutputFormat:431, inbox→listInboundNeedingTriage, plus the new 05-08 link: `.badge` flex-item contract now provided by `.touch-when` itself, with `.touch-when--stack` scoping phone stacking away from the quote-detail consumers).

### Behavioral Spot-Checks & Probe Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Trust boundary: validator, GSM-7, edit distance, merge facts, classification privilege pins | `npx vitest run tests/{drafting-validate,edit-distance,classification-privilege,gsm7,merge-facts}.test.ts` | 5 files / 115 tests passed (625ms) | ✓ PASS (**re-run first-hand this verification**) |
| G-05-3 static assertions | awk/grep block from 05-08 verify | All pass; quote-detail file clean | ✓ PASS (re-run first-hand) |
| Live drafting + classification probe | `npm run verify:drafting` | PASSED prior run (Sonnet); re-proven on claude-opus-5 by quick task 260831-iie (A1 re-settled, MAX_CLASSIFY_TOKENS=100 survives adaptive thinking, sampling params → 400) | ✓ PASS (reused recorded evidence) |
| Full pure suite / tsc / lint | `npm test` / `npx tsc --noEmit` / `npm run lint` | 1590 assertions 0 failures; tsc + lint clean (05-08 self-check, post-CSS-fix) | ✓ PASS (reused) |
| Full remote suite (hosted Sydney DB) | `npm run test:remote` | 82 files / 1965 green (post-fix full run) | ✓ PASS (reused — **NOT re-run: production-shared DB, per operating constraint**) |
| Production deploy | Vercel | dpl_5QtnUQKNfBy41ABsejrXLsjqwwwr READY (syd1) at 133ff9b; a02a731 deployed after; protected routes 401 a wrong token; `git diff a02a731..HEAD -- src/` empty | ✓ PASS (05-UAT.md test 2 + git lineage verified this run) |

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| AI-01 | 05-01, 05-02, 05-04 | ✓ SATISFIED | SC2; run-to-run validator; single merge-facts builder; live probe |
| AI-02 | 05-06, 05-07 | ✓ SATISFIED | SC3; needs-human triage; low-confidence surfacing now legible on-device (05-08) |
| AI-03 | 05-02, 05-06, 05-08 | ✓ SATISFIED | SC4; injection fencing both directions; 05-08 fixed the phone surface AI-03's routing lands on |
| AI-04 | 05-01, 05-02, 05-04, 05-07 | ✓ SATISFIED | SC5; explicit-zero; evidence columns notNull |
| ONB-03 | 05-01, 05-03, 05-05 | ✓ SATISFIED | SC1; born-paused + approval-only unlock, **now deployed to production** |

No orphaned requirements: REQUIREMENTS.md maps exactly these 5 IDs to Phase 5 (traceability rows 107-111, all "Complete"), and every ID is claimed by at least one plan. 05-08 adds AI-03 coverage, already in the set.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers in the 05-08-modified files or classify-inbound.ts | — | Clean |

### Prohibitions (3, judgment-tier — HUMAN-RESOLVED)

The prior run's NON-AUTHORITATIVE LLM-judge verdicts (all pass) are now backed by explicit operator sign-off: 05-UAT.md test 1 ("Judgment-tier prohibitions sign-off", result: **pass**, 2026-08-31). Per the mode-dependent soft-gate, the interactive human checkpoint has been satisfied — no longer flagged.

1. Compliance line never model-produced — mechanically appended at draft-touches.ts:623; prompt describes it by length only. **Human-signed.**
2. No bodies/prompts in logs or tick responses — all console.error sites emit class/counts only. **Human-signed.**
3. Classification write surface pinned to 4 label columns — structurally tested (classification-privilege.test.ts, passed first-hand this run). **Human-signed.**

### Human Verification Required

None. All three prior items are resolved with recorded evidence in 05-UAT.md (complete, 3/3 pass, 0 issues, 0 pending).

### Deferred / Known-Not-Gaps

- **Draft-review card on-device check** — untestable until the first draft exists in production (no approved templates yet); 05-UAT.md defers it to first-client onboarding. The approve/edit-approve server actions are test-verified; Phase 6 CON-01 builds the approval queue around the same surface. Not a gap.
- **STATE.md NEEDS DEPLOY notes (lines 329/335/336) are stale** — the deploys they demand happened (133ff9b + a02a731, UAT test 2). Housekeeping for the phase-transition pass, not a code gap.
- **MSG-02 live email proof** — event-gated on first-client domain verification (Phase 4 carry-over).
- **Hot-lead escalation consumption / approval queue** — Phase 6 CON-01/CON-02; Phase 5's obligation (produce `is_hot`, minimal per-quote action) is met.
- **WR-12 residue (accepted):** prices written in English words are not caught by the fact validator — closed prompt-side, limitation pinned by tests. Documented trade-off.
- **Classifier model = claude-opus-5** — USER-DIRECTED deviation from CLAUDE.md's Haiku row and 05-01's Sonnet decision; recorded in STATE.md, quick task 260831-iie, and in-code. Not a gap.

### Gaps Summary

None. The prior run found zero code gaps and three human items; all three are now evidenced — prohibitions operator-signed, the Phase 5 build (D-12 gate, ONB-03 activation gate, opus classifier) deployed to production and answering correctly, and phone ergonomics passing after the 05-08 fix which this run verified line-by-line in the codebase and via git lineage into the deployed commit. No regressions: all 16 artifacts present, all key links wired, and the 115-test trust-boundary suite re-run green first-hand. The phase goal — Claude-drafted touches in the client's approved voice with data-injected facts, and steering-proof classification — is achieved and live.

---

_Verified: 2026-08-31T08:40:00Z_
_Verifier: Claude (gsd-verifier)_
