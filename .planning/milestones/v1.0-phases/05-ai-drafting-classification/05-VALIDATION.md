---
phase: 5
slug: ai-drafting-classification
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-30
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | vitest.config.ts (pure suites) + vitest.remote.config.ts (hosted-DB suites) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` then one serialized `npm run test:remote` |
| **Estimated runtime** | ~30s pure; test:remote several minutes (pauses production crons — never overlap runs) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`; `npm run test:remote` once per wave when the wave touched hosted-DB behavior (serialized — hosted Sydney DB is production)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds (pure suites)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-T1 | 05-01 | 1 | — | T-5-SC | @anthropic-ai/sdk verified on npmjs before install ([SUS] gate) | human checkpoint | — (blocking-human) | — | ⬜ pending |
| 05-01-T2 | 05-01 | 1 | ONB-03, AI-04 | T-5-02 | Migration 0028 applied + no-op re-run proven; evidence-table grants | migration proof | `npm run db:migrate` (x2, second is no-op) + `npx vitest run tests/lint-ban.test.ts` | ✅ guard exists | ⬜ pending |
| 05-01-T3 | 05-01 | 1 | AI-01, AI-04 | T-5-01, T-5-05 | Gate narrowed; dispatch refuses without approved draft; live Sonnet+Haiku proof (A1) | remote + live smoke | `npm run test:remote -- tests/draft-pipeline.test.ts` + `npm run verify:drafting` | ❌ Wave 0 (this task creates both) | ⬜ pending |
| 05-02-T1 | 05-02 | 2 | AI-01 | T-5-08 | GSM-7 septet arithmetic + UCS-2 flip detection pinned (A4) | unit (pure) | `npx vitest run tests/gsm7.test.ts` | ❌ created here | ⬜ pending |
| 05-02-T2 | 05-02 | 2 | AI-01, AI-04 | T-5-06 | Verbatim whitelist; edit-distance known answers | unit (pure) | `npx vitest run tests/drafting-validate.test.ts tests/edit-distance.test.ts` | ❌ created here | ⬜ pending |
| 05-02-T3 | 05-02 | 2 | AI-01, AI-03 | T-5-07 | Byte-stable prefix; untrusted text user-turn-only | unit (pure) | `npx vitest run tests/drafting-prompt.test.ts` | ❌ created here | ⬜ pending |
| 05-03-T1 | 05-03 | 2 | ONB-03 | T-5-10 | Matrix total over 'onboarding'; operator resume excluded | unit (pure matrix) | `npx vitest run tests/cadence-transitions.test.ts tests/pause-upgrade.test.ts` | ✅ extend | ⬜ pending |
| 05-03-T2 | 05-03 | 2 | ONB-03 | T-5-11, T-5-13 | Write-once attestation; vacuous-set guard; reason-scoped resume | integration (remote) | `npm run test:remote -- tests/onboarding-gate.test.ts` | ❌ created here | ⬜ pending |
| 05-03-T3 | 05-03 | 2 | ONB-03 | T-5-13 | Cadence born paused('onboarding') in one transaction | integration (remote) | `npm run test:remote -- tests/cadence-consume-events.test.ts` | ✅ extend | ⬜ pending |
| 05-04-T1 | 05-04 | 3 | AI-01 | T-5-17 | Deterministic batch order; single cached system block; no Sonnet sampling params | unit (fake client) | `npx vitest run tests/draft-touches.test.ts` | ❌ created here | ⬜ pending |
| 05-04-T2 | 05-04 | 3 | AI-01 | T-5-14, T-5-15 | Failure taxonomy; one regen; sentinel proves no merge-fill fallback | unit (fake client) | `npx vitest run tests/draft-touches.test.ts` | ❌ created here | ⬜ pending |
| 05-04-T3 | 05-04 | 3 | AI-01 | T-5-16 | Enumerated tick/route count fields pinned | unit + remote | `npx vitest run tests/cadence-tick-route.test.ts` + `npm run test:remote -- tests/cadence-tick.test.ts` | ✅ extend | ⬜ pending |
| 05-05-T1 | 05-05 | 3 | ONB-03 | T-5-18 | authorize-first voice-profile save; bounded zod inputs | unit (pure, mocked) | `npx vitest run tests/drafting-settings-action.test.ts` | ❌ created here | ⬜ pending |
| 05-05-T2 | 05-05 | 3 | ONB-03 | T-5-20 | Byte-equality no-change refusal; required attestation note | unit (pure, mocked) | `npx vitest run tests/drafting-settings-action.test.ts` | ❌ created here | ⬜ pending |
| 05-05-T3 | 05-05 | 3 | ONB-03 | T-5-18 | Full action suite green under bare npm test | unit (pure, mocked) | `npm test` | ❌ created here | ⬜ pending |
| 05-06-T1 | 05-06 | 4 | AI-02, AI-03 | T-5-21 | Pinned two-function write surface; empty-body deterministic path | unit (fake client) | `npx vitest run tests/classify-inbound.test.ts` | ❌ created here | ⬜ pending |
| 05-06-T2 | 05-06 | 4 | AI-02 | T-5-23 | Classification last-pass isolation; webhook untouched (D-16) | unit + structural grep gate | `npx vitest run tests/cadence-tick-route.test.ts` + `! grep -rq "from.*core/classification" src/app/api/webhooks/` | ✅ extend | ⬜ pending |
| 05-06-T3 | 05-06 | 4 | AI-03 | T-5-21, T-5-22 | Structural privilege proof; injection fixture writes labels only | unit (structural) | `npx vitest run tests/classification-privilege.test.ts` | ❌ created here | ⬜ pending |
| 05-07-T1 | 05-07 | 5 | AI-04 | T-5-25, T-5-26 | validator_failed unapprovable-unchanged; edited body re-validated; distance recorded | unit (mocked) | `npx vitest run tests/quote-draft-approval.test.ts` | ❌ created here | ⬜ pending |
| 05-07-T2 | 05-07 | 5 | AI-04 | T-5-28 | Draft review renders under RLS; no approve control on validator_failed | typecheck + lint + review | `npx tsc --noEmit && npm run lint` | — | ⬜ pending |
| 05-07-T3 | 05-07 | 5 | AI-02 | T-5-27 | Soft opt-out tops triage; one-tap delegates to existing killContact only | unit + remote spot-check | `npx vitest run tests/inbox-authorization.test.ts` + serialized `npm run test:remote` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Live structured-output smoke call proving `output_config.format` on `claude-haiku-4-5` without a beta header (research assumption A1)
- [ ] `@anthropic-ai/sdk` install behind a human-verify checkpoint (npm legitimacy probe returned `too-new`)

*Existing vitest infrastructure covers all other phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Draft reads in the client's voice | AI-01 | Tone quality is subjective; validator only proves facts | Operator reviews a generated draft against the voice profile in the console |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
