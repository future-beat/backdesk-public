---
phase: 3
slug: cadence-engine
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-28
---

# Phase 3 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Audit run 2026-08-28 by gsd-security-auditor (register authored at plan time across all 9 plans; verified against post-gap-closure, post-review-fix code through migration 0024).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| pg_cron ↔ cadence-tick route | Per-minute HTTP POST with bearer secret | CADENCE_TICK_SECRET (header), counts-only response body |
| Operator console ↔ server actions | Quote control surface (kill/pause/resume) | Operator JWT, tenant/quote/cadence UUIDs |
| Tick orchestrator ↔ tenant data | forAllTenants_cadenceTick cross-tenant scan | Tenant rows, cadence/touch/ledger writes (service-role) |
| Cadence engine ↔ customer PII | Contact name/mobile/email snapshotted on cadences | PII at rest under RLS; masked on the quote detail page |
| Cron logs / net._http_response ↔ operator | Lower-trust observability surfaces | Counts and internal UUIDs only — no PII, no message content |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-3-01 | Info disclosure | Six cadence tables | high | mitigate | RLS triple: pgPolicy in all six schemas + 0017 REVOKE-then-GRANT + exact-grants tests (rls-coverage, leak) | closed |
| T-3-02 | Tampering | suppressed_contacts | high | mitigate | SELECT-only grants (0017); named test "holds no write grant of any kind on suppressed_contacts" | closed |
| T-3-03 | Tampering | Cadence/ledger uniqueness | high | mitigate | send_ledger_cadence_touch_uniq (0016), cadences_one_live_per_quote (0016), cadences_one_live_per_job (0024) | closed |
| T-3-04 | Elevation | Repository tenant scoping | medium | mitigate | tenantId fixed at closure construction; cross-tenant only via named forAllTenants_* exports with justification headers | closed |
| T-3-05 | Tampering | Consumer cursor | high | mitigate | Cursor advance co-committed in run transaction; never-rewind WHERE guard; replay test | closed |
| T-3-06 | Tampering | Send claim | critical | mitigate | insertClaim before sender; zero-row → claim_lost; ON CONFLICT DO NOTHING; FOR UPDATE SKIP LOCKED | closed |
| T-3-07 | Tampering (compliance) | JIT revalidation | high | mitigate | In-claim re-reads of pause, quote status, suppression, window; enqueue→suppress→refuse test | closed |
| T-3-08 | Elevation | Paused-tenant handling | high | mitigate | Both pause flags block dispatch (dispatch.ts:250–251); consume still runs for paused tenants (documented, strictly stronger than plan wording) | closed |
| T-3-09 | Repudiation | Stub sends | high | mitigate | sender='stub' + outcome='stub_sent' columns, asserted by tests | closed |
| T-3-10 | Tampering | State machines | high | mitigate | Hand-written total matrix with completeness/totality/never-throws guards | closed |
| T-3-11 | Tampering (values) | Reopened quotes | medium | mitigate | reopened → stop('reopened') + same-transaction flagNeedsReviewOnReopen (D-08) | closed |
| T-3-12 | Repudiation | Stop idempotence | medium | mitigate | Guarded UPDATEs from LIVE_CADENCE_STATUSES only; replay no-op tested | closed |
| T-3-13 | Tampering (compliance) | Re-window | high | mitigate | rewindowTouch policy + dispatch JIT window refusal; rewindow runs before dispatch | closed |
| T-3-14 | Tampering | Concurrent ticks | critical | mitigate | Ledger unique + SKIP LOCKED; two-connection race test (exactly one row, both interleavings) | closed |
| T-3-15 | Tampering (compliance) | Suppression at dispatch | high | mitigate | Same-transaction suppression re-read; refusal test asserts empty ledger | closed |
| T-3-16 | Tampering | Resume schedules | medium | mitigate | Pure computeResumeSchedule + applyResumeRewindow shared by console resume and connect recovery | closed |
| T-3-17 | DoS | Tick contention | low | mitigate | SKIP LOCKED; refusals counted not thrown | closed |
| T-3-18 | Elevation | Server actions | high | mitigate | WR-01 authorize-first (RLS-scoped read with operator JWT before formData); z.uuid(); membership-oracle-proof message | closed |
| T-3-19 | Elevation | Pause/resume actions | high | mitigate | Same gate; guarded resumeWherePaused / operatorResumeWherePaused; no direct status write | closed |
| T-3-20 | Repudiation (compliance) | Un-suppress paths | high | mitigate | Zero deletes in controls.ts; no console-reachable suppression mutator; SELECT-only grants; three-layer test coverage | closed |
| T-3-21 | Info disclosure | Quote detail page | medium | mitigate | Authenticated-client reads; zero rows → notFound(); foreign and nonexistent indistinguishable | closed |
| T-3-22 | Tampering | Kill control | low | mitigate | Arm-then-confirm; confirm control does not render until armed | closed |
| T-3-23 | Elevation | Tick route auth | high | mitigate | Length-guarded timingSafeEqual; 401 suite incl. identical-length wrong secret and no-redirect assertion | closed |
| T-3-24 | Info disclosure | Tick response body | medium | mitigate | Enumerated counts-only body; recursive every-leaf-is-a-number test | closed |
| T-3-25 | Info disclosure | Cron apply script | medium | mitigate | Secrets from env, never printed; secret-from-env test | closed |
| T-3-26 | DoS | Tick overrun | low | accept | SKIP LOCKED + maxDuration 300 bound the blast radius; per-minute overlap benign by construction | closed |
| T-3-27 | Tampering (compliance) | Window math | medium | mitigate | Half-open [start,end); sole ISO-weekday mapping; never-born-overdue suite | closed |
| T-3-28 | Info disclosure | primary-contact module | low | accept | Pure module, zero console/fetch/process references; PII persists only under T-3-01's RLS tables | closed |
| T-3-G2-01 | Tampering (evidence) | Replay dedupe | high | mitigate | cadences_one_per_opened_event unique index (0021), structural via 0023 NOT VALID CHECK + narrowed index | closed |
| T-3-G2-02 | DoS | Cursor wedge | high | mitigate | Targetless onConflictDoNothing() absorbs any unique violation as zero rows | closed |
| T-3-G2-03 | DoS | Deploy ordering | medium | mitigate | Nullable ADD COLUMN IF NOT EXISTS; hosted-apply-before-push recorded in 03-08 SUMMARY | closed |
| T-3-G5-01 | Repudiation (evidence) | Stop-reason vocabulary | medium | mitigate | mirror_missing member + 8-member CHECK (0022); own refusal label + IDs-only log | closed |
| T-3-G5-02 | DoS | CHECK deploy ordering | medium | mitigate | CHECK widened on hosted DB before writer committed (0018 ordering principle); 0022 journaled behind 0021 | closed |
| T-3-29 | Info disclosure | Quote detail PII | medium | mitigate | maskMobile/maskEmail applied to server-rendered payload (page.tsx:202–208, 324–325) — registered retroactively from 03-05 SUMMARY threat flag | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-3-01 | T-3-26 | Tick overrun DoS (low): FOR UPDATE SKIP LOCKED means overlapping ticks skip each other's claims rather than contend; maxDuration=300 bounds any single run; per-minute cadence makes sustained overlap self-limiting. Code-verified by auditor. | gsd-security-auditor (plan-time disposition) | 2026-08-28 |
| AR-3-02 | T-3-28 | primary-contact info-disclosure (low): pure selection module with zero I/O surface (no console/fetch/process references); the PII it handles persists only in RLS-protected tables covered by T-3-01. Code-verified by auditor. | gsd-security-auditor (plan-time disposition) | 2026-08-28 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-28 | 33 (+1 registered retroactively: T-3-29) | 34 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

Process note: SUMMARYs 03-01, 03-06, 03-08 and 03-09 carried no `## Threat Flags` section; their register threats were verified directly against code — nothing unaccounted for, convention gap only.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
