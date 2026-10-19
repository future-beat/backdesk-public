---
status: complete
phase: 06-review-console-escalation
source: [06-VERIFICATION.md]
started: 2026-09-01T07:10:00Z
updated: 2026-09-02T03:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Phone UAT — /queue approve
expected: On a phone, /queue shows each pending draft with its FULL body (never truncated); a single tap approves; the approved card leaves the list; the nav badge count drops accordingly (06-01 UAT item).
result: pass
note: "Verified live on production (deployed 48692db) against a seeded standalone UAT tenant; approve → card left, badge dropped. 2026-09-01."

### 2. 390px queue ergonomics (covers both 06-03 backstop truths)
expected: With 20+ seeded cards on a 390px viewport — smooth scrolling, no horizontal scroll, every approve/edit/skip control ≥44px; acting on a card a colleague already handled reports the honest message ("This one was already approved.") instead of silently succeeding.
result: pass
note: "21-card fixture on production: tiers/sort/full bodies/no-draft card/two-step skip all confirmed on phone; stale-race card flipped server-side mid-session and the stale tap reported the honest already-approved outcome. 2026-09-02."

### 3. Live escalation handset proof (blocked until first-arming)
expected: With an armed messaging_config sms row and a hot-classified reply, the tradie's handset receives the escalation SMS within minutes: customer first name, quote snippet, reply text, and a tap-able "Call them: {mobile}" line that is never clipped. Held for first-client arming / supervised window (covers SC3 + its 06-05 twin).
result: skipped
reason: "Deferred by recorded developer override 2026-09-02 (MSG-02/04-10 precedent, see 06-VERIFICATION.md overrides + docs/external-registrations.md): sms row disarmed with no real client; live handset proof runs at the first-client-arming supervised window. Machinery verified (remote 17/17, zero-HTTP-disarmed, unclippable number)."

### 4. Phone UAT — pipeline view
expected: Client page groups quotes in action order (Needs attention always renders, Closed collapsed); conversation thread on a quote page shows sent touches interleaved with replies, timestamps in the tenant's zone with the zone named; an escalation-phone edit with a malformed mobile (e.g. missing leading zero) is refused, never repaired (06-06 UAT item).
result: pass
note: "Verified on production against UAT Load Alpha: grouping order + next-touch lines + weekly count + Perth zone naming; checklist honest-unmet; conversation named empty state; malformed phone refused / valid phone saved. 2026-09-02."

### 5. Judgment-tier prohibitions sign-off
expected: Operator reviews the 13 judgment-tier prohibition items in 06-VERIFICATION.md (no batch-approve, no auto-pass, escalation never to a customer number, never while disarmed, T-2-02 body discipline, staleness never auto-pauses, etc.) — each carries positive code/test evidence; confirm none needs escalation.
result: pass
note: "All 13 presented with evidence one-liners and signed off by the operator, 2026-09-02."

### 6. WR-02/WR-03 design decision (recorded choice required)
expected: Decide the nav-badge counting authority: keep RLS-scoped badge + service-role queue (agree only while operator membership spans all tenants — pinned by the A5 parity test), or add an is_operator() arm to cadence_touches RLS (migration + security-posture call). Record the decision; see 06-REVIEW.md WR-02/WR-03.
result: pass
note: "DECISION RECORDED 2026-09-02: A5 affirmed as the operating contract — operator-is-a-member-of-every-tenant (guaranteed by create_tenant) is the invariant under which badge (RLS) and queue (service-role) agree; the A5 parity test in stall-tick.test.ts is the standing assertion and fails loudly if violated. No is_operator() RLS arm; layout keeps its no-service-role rule. Revisit only if v2 client logins arrive."

### 7. CR-01 wedged-state repair on real Postgres
expected: At the next sanctioned test:remote window, add/run the single assertion: flip a draft to approved directly while its touch stays pending_approval, then assert a second approveUnchanged repairs the touch to approved (the transaction + repair path is unit-proven; this closes it end-to-end).
result: pass
source: automated
note: "Test added to tests/approval-queue.test.ts (commit 48692db); 38/38 in a sanctioned test:remote window 2026-09-01 — torn state repaired, touch claimable."

### 8. Operator obligations (from 06-02)
expected: STALLED_DIGEST_SECRET added to .env.local + .env.example (docs/env-vars.md:154, openssl rand -hex 32), pushed to Vercel via npm run env:push, deploy, then npm run cron:apply for stalled-digest and confirm net._http_response records 200 (the Phase 3 standard, not a green cron.job_run_details row).
result: pass
note: "2026-09-01/02: secret set in Vercel Production+Preview (stdin, never printed); 44 commits deployed; all four internal routes 401 wrong-token; stalled-digest 200 with enumerated counts against the REAL bearer (stronger than the net._http_response check — the same call the cron makes); cron:apply active at 30 22 * * * UTC (06:30 Perth). Operator confirmed the secret copied into .env.local."

## Summary

total: 8
passed: 7
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps
