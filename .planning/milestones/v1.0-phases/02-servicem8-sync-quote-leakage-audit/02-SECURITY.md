---
phase: 2
slug: servicem8-sync-quote-leakage-audit
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-27
---

# Phase 2 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (T-2-01…T-2-17 across all 7 PLAN.md threat models);
> mitigations verified against HEAD by gsd-security-auditor on 2026-08-27, after the
> 02-REVIEW fix pass (CR-01/CR-02/CR-03 + 9 warnings) and UAT.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| console form → server actions | operator-supplied credentials and triage decisions | live third-party API keys (high) |
| app → api.servicem8.com | untrusted third-party payloads on every poll/backfill | job, contact, note data (client + prospect PII) |
| internet → /api/internal/sync-tick | anyone can POST; bearer secret is the only gate | trigger for cross-tenant sync |
| internet → /api/webhooks/servicem8 | unauthenticated third-party callbacks | hints only — no payload field reaches a write |
| app → Postgres | ciphertext at rest; RLS is the tenant boundary; is_operator() gates non-tenant tables | tenant + prospect data |
| app → api.resend.com | outbound operator alerts | classified vocabulary only, no secrets |
| operator browser → CSV upload | untrusted file content (prospect-influenceable) | prospect quote data |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-2-01 | Info Disclosure | api_key_ciphertext (sm8_connections + prospects) | high | mitigate | AES-256-GCM enc:v1 (crypto.ts:61-103), fresh IV, auth-tag verify; DB CHECK `LIKE 'enc:v%'` (0008:64, 0014:112); tamper tests (credential-crypto.test.ts:74-121) | closed |
| T-2-02 | Info Disclosure | Sm8Client / connect + re-key + audit actions / logs | high | mitigate | Typed no-throw results; errorDetail = classified kind only; action state cannot carry the key (typed values); last-4 rendering; serialized-result assertions (prospect-audit.test.ts:95-98,180) | closed |
| T-2-03 | EoP / DoS | sync-tick route | high | mitigate | Bearer + length pre-check + timingSafeEqual (route.ts:55-74); proxy api/ exclusion (proxy.ts:35); 401-no-redirect tests (sync-tick-route.test.ts:68-107) | closed |
| T-2-04 | Info Disclosure | all new tenant tables | high | mitigate | pgPolicy `has_tenant_access` on all 5 tenant tables; 11 tables in rls-coverage.test.ts:122-191; two-direction leak tests (leak.test.ts:203-566) | closed |
| T-2-05 | Spoofing / DoS | webhook route | medium | mitigate | Hint-only (zod strict union reads uuid only, zero write surface imported); authenticated re-fetch; 60s debounce on max(lastSuccess, lastAttempt) (WR-02); constant response closes enumeration oracle (WR-01); challenge handshake | closed |
| T-2-06 | Tampering / DoS | CSV parsing | high | mitigate | 2MB size gate before any byte read; papaparse preview cap (5000 rows) enforced; closed STATUS_VOCABULARY with named skip reasons — unknown never defaulted (csv-mapping.ts:343-429) | closed |
| T-2-07 | Info Disclosure (APP 11) | prospect PII retention (lines + csv_staging) | high | mitigate | purge_after stamped at the single insert site; daily prospect-line-purge asserted against live cron.job; csv_staging_expires_at unrepresentable-if-absent + hourly sweep (CR-03, migration 0015); conversion is the only purge-clearing site | closed |
| T-2-08 | Info Disclosure | non-tenant tables (operators, cursors, prospects) | high | mitigate | is_operator() SECURITY DEFINER + SET search_path + null-uid→false (0009); EXECUTE revoked from public/anon; repo-wide sweep found zero USING(true) policies | closed |
| T-2-09 | Tampering | ServiceM8 response parsing | medium | mitigate | safeParse BEFORE the transaction opens — no-partial-writes is structural; pagination cap-hit is parse_error, never silent truncation (WR-04) | closed |
| T-2-10 | DoS / Repudiation | alert flooding vs silent dead client | medium | mitigate | Episode dedupe inside failure-policy itself; decision evaluated inside the row lock (review fixes); degraded-at-3 threshold; live-verified in UAT (exactly one email across two failing ticks) | closed |
| T-2-11 | Tampering | event fabrication via backfill | medium | mitigate | Exactly two emission sites repo-wide (run-sync diff path + eligibility triage flip); connect.ts backfill references no outbox symbol; tenantId forced from forTenant closure | closed |
| T-2-13 | EoP | saveEligibility / audit / convert actions | high | mitigate | Auth-first ordering asserted by tests; z.uuid() arrays; forTenant closure. CR-01 fix verified: requireOperator() RLS-scoped allowlist read in all three audit actions + mapping page (operator-authorization.test.ts:38-73) | closed |
| T-2-14 | Tampering | formula-injection cell values | medium | mitigate | Zero dangerouslySetInnerHTML/innerHTML in src/; no CSV re-export surface; React escaping is the sole render path | closed |
| T-2-15 | Info Disclosure | tick response / cron logs | medium | mitigate | Kinds + counts only, alerted reduced to boolean; apply script prints jobname/schedule, never the bearer (cron-schedules.test.ts:130,159) | closed |
| T-2-16 | Info Disclosure | alert email body | medium | mitigate | Pure alertBody renders classified labels only; provider failures reported via error.name; body asserted to exclude X-API-Key/enc:v/Bearer/stack frames (sync-failure-alerts.test.ts:417-422) | closed |
| T-2-17 | Tampering | audit figures handed to a prospect | medium | mitigate | Integer cents end-to-end; recoverable estimate derives solely from AUDIT_RECOVERY_RATE via integer basis points; constants module has zero imports so figure and footnote cannot diverge | closed |
| T-2-SC | Tampering (supply chain) | resend@6.22.1, papaparse@5.7.0, @types/papaparse@5.5.2, date-fns@4.4.0, @date-fns/tz@1.5.0 | high/low | mitigate + accept | Blocking-human gates (never auto-approved) with recorded verdict reasoning for resend + papaparse; exact pins, no ranges, installed packages confirmed script-free. date-fns pair accepted → AR-01 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-2-SC | `date-fns@4.4.0` / `@date-fns/tz@1.5.0` accepted at plan time: both [OK] in the RESEARCH Package Legitimacy Audit (first-party date-fns org, 101.7M and 37.3M weekly downloads), pinned exact in package.json, no postinstall scripts | Operator (via secure-phase run) | 2026-08-27 |

*Accepted risks do not resurface in future audit runs.*

---

## Open Findings (informational, non-blocking)

| ID | Finding | Severity | Note |
|----|---------|----------|------|
| OF-1 | `prospect-staging-sweep` cron asserted against migration source text, not the live `cron.job` catalog (unlike `prospect-line-purge`, which is) | low | Evidence-strength gap only — migration 0015's application is proven indirectly by passing DB-backed suites. Close by mirroring the prospect-purge.test.ts:79 catalog assertion |
| OF-2 | `createTenant` reads formData before getClaims() — deviates from the auth-first convention every other action follows | low | No authorization impact (no pre-existing target); Phase 1 code, outside this register |
| OF-3 | T-2-03 code-verified but not production-verified — pg_cron → deployed Vercel URL wiring untested (02-UAT.md test 3, blocked on deployment) | medium | The route's own auth is proven locally. Close when the deployment lands and UAT test 3 runs |
| OF-4 | Webhook timing channel knowingly open, documented in-source; durable queue deferred to Phase 3 | low | Within T-2-05's declared scope |
| OF-5 | T-2-06 mechanism substitution: hand-rolled per-row validation with closed vocabulary instead of the planned zod-per-row — stricter on the status field | info | Register accuracy note, not a gap |

---

## Security Audit 2026-08-27

| Metric | Count |
|--------|-------|
| Threats in register | 17 |
| Closed (verified with evidence) | 17 |
| Open (blocking, ≥ high) | 0 |
| Open (non-blocking) | 0 |
| Accepted risks logged | 1 (AR-01) |
| Informational findings | 5 (OF-1…OF-5) |

Auditor: gsd-security-auditor (verify-mitigations mode; register authored at plan time). Scope: all 7 PLAN threat models, 7 SUMMARYs, 02-REVIEW/02-REVIEW-FIX (fixed state verified), implementation at HEAD, and the test evidence base (664 tests incl. rls-coverage, leak, credential-crypto, sync-tick-route, prospect-purge, prospect-audit, operator-authorization, csv-mapping, sync-failure-alerts).
