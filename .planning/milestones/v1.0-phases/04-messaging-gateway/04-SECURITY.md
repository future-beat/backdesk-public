---
phase: 4
slug: messaging-gateway
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-30
---

# Phase 4 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (all 10 PLAN.md `<threat_model>` blocks); mitigations verified against source by gsd-security-auditor 2026-08-30. All evidence references below are file:line as of commit `99645d9`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Internet → /api/webhooks/clicksend/inbound | Unsigned provider webhook (research A4); token-in-URL auth | Customer reply bodies, mobile numbers (untrusted) |
| Internet → /api/webhooks/clicksend/dlr | Delivery-receipt push, form-encoded default transport | Delivery status annotations for existing ledger rows |
| Internet → /api/unsubscribe | Public one-click endpoint, HMAC-token-only | Suppression intent (no address/id in URL) |
| pg_cron → /api/internal/messaging-reconcile | Bearer-authed sweep tick | None (trigger only) |
| payload → attribution → cadence state | Untrusted content drives suppress/pause/record decisions | Fail-safe writes only — never send/resume |
| Operator console → messaging config | is_operator()-gated server actions | Sender identity, activation switches |
| Repo/scripts → ClickSend/Vercel accounts | Activation + env-push scripts using operator credentials | Secrets (masked/length-only in output) |

---

## Threat Register

All 38 rows CLOSED. Full per-threat evidence (file:line / test name) in the audit record below; canonical STRIDE tables remain in each plan's `<threat_model>` block.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-4-01 | Spoofing | inbound effects surface | medium | mitigate | Import surface limited to fail-safe writes (inbound.ts:91-105) | closed |
| T-4-02 | Info disclosure | inbound logging | high | mitigate | Ids/counts-only log lines, test-pinned (inbound-threading.test.ts:602) | closed |
| T-4-03 | Tampering | suppression spellings | medium | mitigate | Verbatim snapshot addresses; single normalizeAuMobile call site | closed |
| T-4-04 | Elevation | inbound_messages RLS | medium | mitigate | RLS + is_operator()/has_tenant_access policy (0025 migration) | closed |
| T-4-05 | Spoofing | inbound webhook auth | high | mitigate | 64-hex token-in-URL, timingSafeEqual + length guard, own secret | closed |
| T-4-06 | DoS | reply-bomb pause abuse | medium | mitigate | Pause only on unique live match; ambiguous → triage, no pause | closed |
| T-4-07 | Tampering | hostile payloads | medium | mitigate | Tolerant zod (from/body only), dead-letter path, 8k cap | closed |
| T-4-08 | Info disclosure | webhook responses/logs | high | mitigate | Uniform 200 body; token never referenced after compare | closed |
| T-4-09 | Repudiation | dropped inbound evidence | medium | mitigate | Every authed request produces an inbound_messages row | closed |
| T-4-10 | Info disclosure | ClickSend client errors | high | mitigate | Closed failure-code set; auth header built at call time | closed |
| T-4-11 | Tampering | ledger sender identity | high | mitigate | providerFor/send share one delegateFor resolver | closed |
| T-4-12 | Spoofing | channel routing | medium | mitigate | Delegate strictly by request.channel | closed |
| T-4-13 | DoS | send retry loops | low | accept | No retry loop by design; NULL outcome surfaced, never auto-resent | closed |
| T-4-14 | Info disclosure | sender logging | high | mitigate | Ids/outcome-only logging in sender and client | closed |
| T-4-15 | Tampering | forged DLR | high | mitigate | Update only WHERE id/provider_message_id matches; outcome never in set() | closed |
| T-4-16 | Spoofing | rule re-application | low | accept | Idempotent re-apply; test-corroborated | closed |
| T-4-17 | Info disclosure | delivery detail prose | high | mitigate | codeOf 48-char cap + digit-run redaction | closed |
| T-4-18 | Repudiation | swallowed opt-out evidence | high | mitigate | Reconcile replays via handleInboundSms; provider_opt_out suppression on failed sends (four-field corpus, 04-09) | closed |
| T-4-19 | Elevation | unsubscribe as suppression oracle | high | mitigate | HMAC token minted at send; no address/id-keyed path | closed |
| T-4-20 | Info disclosure | unsubscribe enumeration | high | mitigate | Identical response body for every outcome (oracle assertion test) | closed |
| T-4-21 | Spoofing | token forgery | high | mitigate | Fail-closed min-length secret, timingSafeEqual, versioned MAC | closed |
| T-4-22 | Spoofing | owner-only sender | medium | mitigate | resend.dev (incl. subdomains) refused in the sender | closed |
| T-4-23 | Repudiation | GET prefetch suppression | low | accept | RFC 8058 trade-off; GET suppresses nothing | closed |
| T-4-24 | Elevation | console server actions | high | mitigate | is_operator() gate first in all four 'use server' exports; export count pinned | closed |
| T-4-25 | Info disclosure | cross-tenant suppression visibility | medium | accept | By design per D-03 (locked user decision); operator-only visibility via RLS | closed |
| T-4-26 | Tampering | unverified-domain sends | medium | mitigate | Server-side verified-domain check; enabled-row requirement in resolver | closed |
| T-4-27 | Info disclosure | Resend key exposure | high | mitigate | Key read server-side at call time; settings page is server-rendered | closed |
| T-4-28 | Repudiation | STOP passthrough (A3) | high | mitigate | Empirically answered — STOP reaches our webhook; reconcile backstop behind it | closed |
| T-4-29 | Info disclosure | secrets in script output | high | mitigate | mask()/length-only printing; redacted error output | closed |
| T-4-30 | Tampering | live-test blast radius | high | mitigate | Operator's own handset only; DISARMED teardown verified | closed |
| T-4GC-01 | Elevation | activation resolvers | high | mitigate | resolveSmsFrom/resolveEmailIdentity refuse disabled/incomplete rows | closed |
| T-4GC-02 | Repudiation | false console copy | medium | mitigate | Honest copy, exact string test-pinned | closed |
| T-4GC-03 | Tampering | test-vs-production crons | medium | mitigate | globalSetup pauses production cron jobs during test:remote | closed |
| T-4GC-04 | DoS | tick abandonment | high | mitigate | Per-send/per-outcome/per-tenant guards (CR-03), failure-injection suite | closed |
| T-2-02 | Info disclosure | catch-block leakage | high | mitigate | Bare catches bind nothing; ids-only logs; spy test | closed |
| T-4GC-05 | Tampering | joined-field verdict spoof | medium | mitigate | Per-field codeOf, never joined before classification | closed |
| T-4GC-06 | Repudiation | premature MSG-02 claim | low | mitigate | Checkbox verified unflipped, annotated with flip condition | closed |
| T-4-SC | Tampering | package installs | low | accept | Verified: phase-4 package.json commits add npm scripts only; resend@6.22.1 pinned | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity note: T-4-11 rated medium (04-01) and high (04-08) — recorded at high per fail-closed.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-4-01 | T-4-13 | No auto-retry by product rule; NULL outcome is the honest record and surfaces to the operator | plan-time disposition, verified 2026-08-30 | 2026-08-30 |
| AR-4-02 | T-4-16 | Rule application is idempotent; re-runs replace rather than duplicate | plan-time disposition | 2026-08-30 |
| AR-4-03 | T-4-23 | RFC 8058: GET renders confirmation and suppresses nothing, so scanner prefetch is harmless | plan-time disposition | 2026-08-30 |
| AR-4-04 | T-4-25 | Cross-tenant suppression visibility accepted by locked user decision D-03 (over-suppression is the compliant failure mode) | user (discuss-phase 2026-08-28) | 2026-08-30 |
| AR-4-05 | T-4-SC | No dependency changes shipped in Phase 4 (verified against commit diffs) | auditor verification | 2026-08-30 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-30 | 38 | 38 | 0 | gsd-security-auditor (opus), verify-mitigations mode, ASVS L1, block-on high |

**Advisories (non-blocking, recorded for follow-up):**
- Secret-length floor: env schema enforces `.min(32)` while plans describe 64-hex tokens; all deployed values are 64 chars. Tightening to `.min(64)` would make the declared width load-bearing.
- Automated scan flagged `?token=` in unsubscribe-token.ts:203 — false positive (the intended RFC 8058 one-click link builder).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-30
