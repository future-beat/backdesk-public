---
phase: 4
slug: messaging-gateway
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-28
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 (installed) |
| **Config file** | present (WR-09 disposable-stack gate on testEnv getters) |
| **Quick run command** | `npm test -- <file>` |
| **Full suite command** | `npm test` (pure, 586 tests) / `npm run test:remote` (hosted Sydney DB — pauses deployed crons via globalSetup; never overlap runs) |
| **Estimated runtime** | ~30 seconds (pure) / minutes (remote, serialized) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (pure suites, fast)
- **After every plan wave:** Run `npm run test:remote` (serialized — hosted DB is production-shared)
- **Before `/gsd-verify-work`:** Full suite green + typecheck + lint; live-number UAT item carried as blocked-external if the IPND address hasn't landed
- **Max feedback latency:** ~60 seconds (pure suites)

---

## Per-Task Verification Map

*(Seeded from RESEARCH.md §Validation Architecture — task IDs filled by planner.)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-03.T2 | 04-03 | 3 | MSG-01 | T-4-14 | ClickSendSender maps success/failure/non-2xx to SendOutcome without throwing | unit (fetch mocked) | `npm test -- tests/clicksend-sender.test.ts` | ❌ W0 | ⬜ pending |
| 04-04.T1 | 04-04 | 4 | MSG-01 | T-4-15 (forged DLR) | DLR applies only where custom_string/message_id matches ledger; non-match is recorded no-op | integration | `npm run test:remote -- tests/receipts.test.ts` | ❌ W0 | ⬜ pending |
| 04-05.T2 | 04-05 | 5 | MSG-02 | T-4-22 | Email send carries List-Unsubscribe + one-click headers; footer identifies client business + authorising service | unit (SDK mocked) | `npm test -- tests/resend-sender.test.ts` | ❌ W0 | ⬜ pending |
| 04-05.T1 | 04-05 | 5 | MSG-02 | T-4-19/20 (suppression oracle) | Unsubscribe: valid token suppresses both channels; invalid token indistinguishable | integration | `npm run test:remote -- tests/unsubscribe.test.ts` | ❌ W0 | ⬜ pending |
| 04-01.T2 | 04-01 | 1 | MSG-03 | — | STOP regex: exhaustive keyword/punctuation/case matrix; non-STOP never matches | unit (pure) | `npm test -- tests/stop-keywords.test.ts` | ❌ W0 | ⬜ pending |
| 04-01.T2 | 04-01 | 1 | MSG-03 | T-4-01 (forged inbound) | STOP → both-channel suppression + cadence stop → next dispatch refuses `suppressed` | integration | `npm run test:remote -- tests/inbound-stop.test.ts` | ❌ W0 | ⬜ pending |
| 04-02.T2 | 04-02 | 2 | MSG-04 | T-4-06 (reply-bomb) | Unique live-cadence match threads; zero/multiple → triage row, no pause, no guess | integration | `npm run test:remote -- tests/inbound-threading.test.ts` | ❌ W0 | ⬜ pending |
| 04-02.T1 | 04-02 | 2 | MSG-04 | — | paused(client_paused) + reply → paused(customer_reply); client resume does NOT revive | integration | `npm run test:remote -- tests/pause-upgrade.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/stop-keywords.test.ts` — MSG-03 regex matrix
- [ ] `tests/clicksend-sender.test.ts`, `tests/resend-sender.test.ts` — MSG-01/02 outcome mapping
- [ ] `tests/inbound-threading.test.ts`, `tests/inbound-stop.test.ts` — MSG-03/04
- [ ] `tests/receipts.test.ts`, `tests/unsubscribe.test.ts`, `tests/pause-upgrade.test.ts`
- [ ] Framework install: none — vitest present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live two-way SMS on real number | MSG-01 | Dedicated AU number IPND-blocked (external); requires provisioned number + pointed webhook rules | After number lands: run activation script, send test cadence touch to operator's own mobile, reply, verify inbound row + pause; send STOP, verify suppression + ClickSend passthrough behaviour (research A3) |
| DLR/inbound payload shape capture | MSG-01 | ClickSend push payloads under-documented (research A1/A2) | Use `POST /v3/sms/inbound` test endpoint (and first live traffic) to capture real shapes; confirm tolerant zod schemas accept them |
| Client-domain DNS verification | MSG-02 | Requires real DNS access to a domain | Add domain via console surface, apply DNS records, confirm Resend verification transitions to verified |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
