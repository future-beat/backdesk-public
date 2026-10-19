---
phase: 6
slug: review-console-escalation
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-09-01
---

# Phase 6 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Authenticated session → queue/skip/edit/attest/phone server actions | 'use server' exports are globally POSTable; ids and form values arrive forgeable | touch/draft/tenant uuids, attestation note, escalation phone |
| Operator console → cross-tenant draft bodies | AI text bound for customers rendered across tenants on one page | customer-bound message bodies |
| Migration → production-shared hosted DB | 0032 runs against the live Sydney database | full schema DDL + grants |
| Internet → stalled-digest route | unauthenticated POSTs reach the bearer check | bearer token |
| System → operator email | alert/digest bodies leave the system via Resend | tenant names, counts, timestamps only (closed vocabulary) |
| Any authenticated session → nav badge count | the layout is not operator-gated | pending/stalled counts |
| Customer SMS content → tradie handset | untrusted reply text forwarded inside the escalation body | customer reply text |
| Tick (service role) → ClickSend REST | real-money, real-phone external sends | escalation SMS |
| ClickSend callbacks → receipts route | an escalation custom_string arrives at the ledger-matching path | provider callbacks |
| Operator attestation → cadence activation | an attest write is one of the two keys that starts real messaging | attestation evidence |
| Probe script → live ServiceM8 trial account | external API reads with a real key | SM8 API key |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-6-01 | Elevation | queue approve action (forged POST) | high | mitigate | `UUID_PATTERN` single-uuid checks + `requireOperator` re-check with caller's JWT inside the action; draft-touch pairing re-verified in the shared core (`queue/actions.ts`) | closed |
| T-6-02 | Information disclosure | /queue page (cached/static render, error leak) | high | mitigate | `force-dynamic` + `requireOperator()` before the read + catch-and-discard failures, counts-only logs (`queue/page.tsx`) | closed |
| T-6-03 | Tampering | approving a superseded/older draft attempt | medium | mitigate | Latest-attempt check in the ONE extracted core both surfaces call (`core/approval/approve-draft.ts`); WR-01 fix also filters non-latest from the queue read | closed |
| T-6-04 | Elevation | new tables without grant blocks (TRUNCATE not subject to RLS) | high | mitigate | 0017-pattern REVOKE-then-GRANT per table in 0032 (6 REVOKEs); SELECT-only to authenticated/anon; pinned in `tests/rls-coverage.test.ts` grant map | closed |
| T-6-05 | Information disclosure | alert/digest emails as exfil channel | high | mitigate | Closed-vocabulary pure builders exported + byte-asserted (`tests/stalled-drafts.test.ts`); never a customer name/body/address/draft | closed |
| T-6-06 | Elevation | stalled-digest route invoked without auth | medium | mitigate | Own bearer `STALLED_DIGEST_SECRET`, 401 on wrong token (`api/internal/stalled-digest/route.ts`); separate-bearers rule upheld | closed |
| T-6-07 | Information disclosure | nav badge leaking cross-tenant counts to non-operator sessions | medium | mitigate | RLS-scoped count via caller's own JWT; no service-role in the layout; A5 parity test pins the assumption (WR-02/WR-03 counting-authority choice tracked in 06-UAT.md item 6) | closed |
| T-6-08 | DoS (trust) | repeated alerts training blindness / alert storms | low | mitigate | `stall_alerted_at` guarded UPDATE RETURNING; one alert per crossing; daily digest as the only roll-up; WR-07 fix makes claim-then-throw visible | closed |
| T-6-09 | Tampering | stale card skipping an approved touch | high | mitigate | `skipPendingWhere` equality guard on the two unapproved statuses; zero rows → honest re-read report; source-asserted against widening | closed |
| T-6-10 | Elevation | forged skip/edit POST | high | mitigate | Same WR-01 action-hardening family as T-6-01 (uuid checks + operator re-check inside the action, shared core re-verification) | closed |
| T-6-11 | Tampering | batch approval smuggled via array form inputs | high | mitigate | Single-uuid pattern checks per action; no array-typed inputs accepted in queue actions; no select-all anywhere | closed |
| T-6-12 | Repudiation | attestation forged/backdated/overwritten | high | mitigate | Append-only rows, server-set `attested_at` (defaultNow), REQUIRED note at schema and action layers, service-role writes only, SELECT-only grants from 0032 | closed |
| T-6-13 | Elevation | creation or resume bypassing the composed gate | high | mitigate | ONE predicate family (`onboardingComplete`/`readOnboardingConditions` from `onboarding-gate.ts`) reached by `consume-events` (born-paused) AND both resume writers; pre-Phase-6 approved-but-unattested tenant tested | closed |
| T-6-14 | DoS | staleness auto-pausing healthy clients | medium | mitigate | Staleness produces UI state + one digest line only; cadence statuses asserted unchanged after the digest run (`tests/onboarding-checklist-gate.test.ts`) | closed |
| T-6-15 | Elevation | forged attest POST | high | mitigate | Action hardening (uuid check, operator re-check inside the action, bounded required note) | closed |
| T-6-16 | Tampering | escalation double-fire on replayed/overlapping ticks | high | mitigate | UNIQUE(inbound_message_id) claim, ON CONFLICT DO NOTHING RETURNING, only the inserter sends (`db/repository/escalations.ts`) | closed |
| T-6-17 | Information disclosure | reply text in logs/error details | high | mitigate | Counts-only logging; unknown throws discard the caught value; body exists only in the SMS (`core/escalation/escalate-hot-leads.ts`) | closed |
| T-6-18 | Tampering | injection via forwarded reply text (structure forgery) | medium | mitigate | Control characters sanitized; fixed-parts-first assembly; unclippable phone number; plain SMS to a human, no parser downstream (`core/escalation/message.ts`, `tests/escalation-message.test.ts`) | closed |
| T-6-19 | Elevation | sending while deployment disarmed (test runs paging tradies) | high | mitigate | `resolveSmsFrom` (shared with dispatch) resolved before any HTTP; refuse-and-record `sms_not_configured`; zero-HTTP-calls property test; post-run residue probe confirmed disarmed row untouched | closed |
| T-6-20 | Spoofing | escalation custom_string misfiling a DLR onto send_ledger | medium | mitigate | A4 named test: unmatched custom_string stamps nothing, normal 200 | closed |
| T-6-21 | Information disclosure | raw bodies leaking into pipeline chips/lists | high | mitigate | `lastActivity` signature takes `{at}`/`{at,label}` only — the client page's selects never include `body`, source-asserted; body rendering confined to quote page + inbox | closed |
| T-6-22 | Tampering | forged escalation-phone edit redirecting tradie alerts | medium | mitigate | Action hardening + `AU_MOBILE_PATTERN` refuse-never-repair + named-column update | closed |
| T-6-23 | Information disclosure | conversation thread reachable past the operator gate | high | mitigate | Quote page already gated; thread rides the page's existing RLS + gate; no new route added | closed |
| T-6-SC | Tampering | npm/pip/cargo installs | low | accept | No new packages this phase (06-RESEARCH.md Package Legitimacy Audit: none installed, none flagged) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-6-01 | T-6-SC | No new packages installed in Phase 6 — supply-chain surface unchanged; Package Legitimacy Audit in 06-RESEARCH.md is empty | plan-time disposition (06-01-PLAN.md), verified at audit | 2026-09-01 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-01 | 23 | 23 | 0 | secure-phase orchestrator (L1 grep-depth; short-circuit rule — plan-time register, threats_open 0, ASVS L1). Post-fix state audited (9 review fixes, commits 1020046..90c6201). |

Notes:
- The WR-02/WR-03 counting-authority design question (badge under RLS vs queue under service-role) is NOT an open threat — both reads are individually least-privilege and T-6-07's mitigation stands; the recorded-choice obligation lives in 06-UAT.md item 6.
- The plan-stated "zod z.uuid schemas" mitigation is implemented as the codebase's established `UUID_PATTERN` single-value checks — same refusal semantics (forged/array inputs rejected before any read), consistent with every prior console action.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-01
