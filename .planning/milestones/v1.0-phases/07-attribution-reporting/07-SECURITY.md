---
phase: 7
slug: attribution-reporting
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-09-04
---

# Phase 7 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Outbox consumer (service role) → quote_attributions | the attribution consumer reads `quote_status_events`, `send_ledger`, `inbound_messages`, `escalations` and writes one frozen evidence row per won quote | ledger ids, timestamps, channel, delivery status, job number, ≤61-code-point description, first name, cents, basis points — never an address, body or raw payload |
| Migration → production-shared hosted DB | 0033 / 0034 ran against the live Sydney database while cron ticks were paused | full DDL, CHECK constraints, grants |
| Authenticated operator session → /reports, /reports/[client], /reports/[client]/[reportId] | RLS-gated reads with the operator's JWT; `'use server'` Generate and Fee actions are globally POSTable | tenant uuid, report uuid, year/month, fee kind/amount/date/note |
| Frozen report row → printed A4 sheet handed to a client | the browser is the PDF engine (D-12); the page renders only what the row holds | figures, per-job lines, constants, baseline, footnotes |
| Cadence tick (pg_cron → bearer route) → attribution seam | the same tick that drives messaging now also advances the attribution cursor | outbox cursor position, six numeric counters |
| Stalled-digest route → operator email (Resend) | opt-out drift and wedged-cursor sections ride the daily digest | tenant name, rate, counts — closed vocabulary |
| Local harness / seed scripts → production tables | 07-06-harness runs offline on fixtures; the UAT fixture seed wrote 20 fictional quotes/attributions for the test tenant | fictional data only, manifest kept for teardown |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-7-01 | Tampering | quote_attributions / monthly_reports / tenant_fees via a console session | high | mitigate | 0033: 6× REVOKE ALL, SELECT-only to anon/authenticated, ALL to service_role (3 grants); tests/rls-coverage.test.ts pins 18 table/role entries | closed |
| T-7-02 | Tampering | duplicate attribution under replay / overlapping ticks / second win | high | mitigate | quote_attributions_one_per_quote UNIQUE in 0033; targetless onConflictDoNothing in for-tenant.ts; replay/second-win cases in tests/attribution-consume.test.ts (10 refs) and tests/reporting-tables.test.ts | closed |
| T-7-03 | Tampering | a frozen report row being rewritten | high | mitigate | reports/attributions/fees namespaces in for-tenant.ts expose insertVersion/byId/list only — no update/delete; monthly_reports_version_uniq arbitrates concurrent generates; console roles SELECT-only (T-7-01) | closed |
| T-7-04 | Information disclosure | report id enumerated across tenants | medium | mitigate | reports.byId is a forTenant() closure method (for-tenant.ts:1762) — tenant_id pinned from the closure; tests/reports-authorization.test.ts | closed |
| T-7-05 | Denial of service | migration silently skipped by a non-monotonic journal | high | mitigate | Journal monotonicity guard (tests/quote-events.test.ts, tests/prospect-staging-retention.test.ts) green; 35 journal entries; 0033/0034 applied to production (07-01 checkpoint, 07-REVIEW-FIX) | closed |
| T-7-06 | Information disclosure | seed helpers writing real addresses / bodies into production evidence tables | medium | mitigate | tests/helpers/seed.ts uses stamped fiction numbers (+6149157…) / example.invalid and empty bodies; teardown manifest covers all tables | closed |
| T-7-07 | Information disclosure | evidence jsonb copying addresses / bodies / raw payloads into a long-lived row | high | mitigate | attributionEvidenceSchema: zod strictObject at every depth (10 strictObject calls in evidence.ts) plus a recursive forbidden-key walk; 07-02 summary | closed |
| T-7-08 | Tampering | overstated credit via float money or rounding toward the service | high | mitigate | Integer cents + basis points; single Math.round/Math.floor in money.ts; DEFAULT_BASELINE_BP 7000 pinned in tests/attribution-baseline.test.ts; CR-01 (multiple ×100) fixed in 07-REVIEW-FIX round 1 | closed |
| T-7-09 | Tampering | a figure and its footnote computed from different values | medium | mitigate | src/core/audit/constants.ts: exactly 8 exports, 0 imports (pinned); windowDays and evidence.constants.attributionWindowDays from one import | closed |
| T-7-10 | Denial of service | NaN / Infinity rate reaching a page or digest line | low | mitigate | rateBasisPoints / multipleBasisPoints return null before division (metrics.ts); asserted per metric in tests/reporting-metrics.test.ts | closed |
| T-7-11 | Tampering | duplicate attribution under cursor rewind / overlapping ticks / reopen→won | high | mitigate | Same targetless claim as T-7-02; replay + second-win cases assert row identity (tests/attribution-consume.test.ts) | closed |
| T-7-12 | Tampering / DoS | a remote suite or script draining real won history into production quote_attributions | high | mitigate | run-tick.ts attribution seam defaults to 'skip' (line 207/231); only src/app/api/internal/cadence-tick/route.ts passes 'run'; no scripts/ caller | closed |
| T-7-13 | Denial of service | one tenant's failing run wedging attribution for every tenant | medium | mitigate | Head-of-line hold + per-tenant transaction (6 catch sites in consume-wins.ts); tests/attribution-consume-isolation.test.ts | closed |
| T-7-14 | Information disclosure | tick body or consumer log carrying tenant id / quote id / amount / driver error | medium | mitigate | Six enumerated numeric fields; route key set pinned (11 attribution fields in cadence-tick route); catch discards the caught value. Residual: one console.error interpolates a tenant uuid — recorded in 07-VERIFICATION as a judgment-tier prohibition (07-03 P3), not a customer-data leak | closed |
| T-7-15 | Information disclosure | evidence reads pulling to_address / body / raw_payload into the attribution row | high | mitigate | Explicit select lists in for-tenant.ts:3203-3247 ('THE SELECT LIST IS THE PRIVACY BOUNDARY (T-7-15)'); consume-wins.ts has 0 references to those columns; serialized row asserted free of @ / +61 in tests/attribution-consume.test.ts | closed |
| T-7-16 | Tampering | the cadence-engine cursor moved or read by the attribution consumer | high | mitigate | consume-wins.ts: 0 occurrences of CADENCE_CONSUMER; advances only ATTRIBUTION_CONSUMER (line 493); cursor equality asserted before/after a pass | closed |
| T-7-17 | Elevation of privilege | IDOR on /reports/[client]/[reportId] and both actions | high | mitigate | UUID_PATTERN checks in actions.ts (2) and page.tsx (2); RLS tenants read with the operator JWT; forTenant(tenantId).reports.byId (4 forTenant calls); tests/reports-authorization.test.ts | closed |
| T-7-18 | Tampering | malformed month / fee input | medium | mitigate | 8 zod/parseMoneyToCents sites in reports/[client]/actions.ts; invalid amount → 0 writes | closed |
| T-7-19 | Tampering | two concurrent Generates producing two 'version 2's | medium | mitigate | monthly_reports_version_uniq + single-statement version subselect; isUniqueViolation → { kind: 'concurrent' } (6 refs in generate.ts) | closed |
| T-7-20 | Information disclosure | customer content in frozen lines / printed page / logs | high | mitigate | Lines built only from evidence fields (job number, ≤61-code-point description, first name); row JSON asserted free of @ / +61 (tests/monthly-report.test.ts); CR-02 UTF-16 vs code-point cap fixed in 07-REVIEW-FIX round 1 | closed |
| T-7-21 | Repudiation | a report that disagrees with itself (figure vs footnote, live vs frozen) | high | mitigate | Page renders from parseReportDocument(row) (2 refs, computes nothing); footnotes interpolate row.constants / row.baseline; mismatch banner screen-only (.report-screen-note hidden in print) | closed |
| T-7-22 | Denial of service | unbounded list reads on the reports page | low | mitigate | reports.list() capped by REPORT_LIST_LIMIT (repository/index.ts), ordered before the limit; WR-05 (round 1) made the page consume the constant | closed |
| T-7-23 | Information disclosure | forAllTenants_reportMetrics selecting an address, body or quote column across tenants | high | mitigate | for-all-tenants.ts:94 select lists hold counts, sums, fee rows, name, timezone only; no quotes.* / cadences.*; tests/report-metrics.test.ts | closed |
| T-7-24 | Elevation of privilege | /reports readable without the operator gate | high | mitigate | requireOperator() (3 refs) before the read in reports/page.tsx; OPERATOR_DENIED_MESSAGE on denial; layout gains no service-role read (stall-tick source assertion) | closed |
| T-7-25 | Tampering | a metric writing to a cadence / tenant / suppression | high | mitigate | metrics.ts and opt-out-section.ts contain 0 insert/update/delete; digest writes-nothing invariant re-asserted (tests/onboarding-checklist-gate.test.ts, tests/stall-tick.test.ts) | closed |
| T-7-26 | Repudiation | overview and detail disagreeing for the same client | medium | mitigate | One computeTenantMetrics (7 files reference it, one definition); field-by-field parity test in tests/report-metrics.test.ts | closed |
| T-7-27 | Information disclosure | digest line carrying an address or body | medium | mitigate | Closed vocabulary byte-asserted in tests/opt-out-section.test.ts; output scanned for @ / +61 | closed |
| T-7-28 | Denial of service | the metrics read failing takes the whole digest down | low | mitigate | Own try/catch around the opt-out read in stalled-digest.ts (2 catch sites); other sections still send | closed |
| T-07-06-01 | Information disclosure | title={jobLabel(line)} on the printed Job cell | low | accept | Hover text equals the frozen '#id · description' already in the cell; operator-only page; no address/phone/amount. Superseded in 07-07 (description now unclipped on screen, 38f3855) | closed |
| T-07-06-02 | Tampering | 07-06 harness (run.sh, gen.mjs, wkprint.swift, nav-check.sh) | low | accept | Reads two stylesheets, writes to mktemp -d, runs local Chrome/WebKit on fictional fixtures; never imports app code; lives under .planning/ | closed |
| T-07-06-03 | Denial of service | WebKit-only print zoom 0.75 under @media print | low | accept | Print-only; WR-04 (round 2) gated it additionally on max-width 560px; worst case a mis-scaled sheet caught by the iPhone check (UAT test 4 passed) | closed |
| T-07-07-01 | Information disclosure | print-button.tsx status line | low | accept | One of two fixed strings from an import-free module; server render is idle so nothing is in the HTML; .report-actions hidden in print (UAT print-press check passed) | closed |
| T-07-07-02 | Denial of service | print-button.tsx timer + listeners | low | mitigate | clearTimer before every arm; beforeprint/afterprint/matchMedia listeners removed on unmount (9 cleanup refs); disabled= never rendered (0); reducer idempotence pinned in tests/print-feedback.test.ts | closed |
| T-07-07-03 | Tampering | 07-06-harness/gen-tables.mjs reading .tsx as text | low | accept | Reads known source paths; writes only to a temp dir; never imports or executes app code; under .planning/ (0 app imports) | closed |
| T-07-07-04 | Tampering | prefetch={false} on the version link and back link | low | accept | Removes a speculative RSC fetch; navigation on click unchanged and still authorized by the target page | closed |
| T-7-SC | Tampering | npm/pip/cargo installs | low | accept | No package installed in any of the seven plans; package.json untouched (07-RESEARCH Package Legitimacy Audit: none) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-7-01 | T-7-SC | No package installed in Phase 7 (seven plans); `@date-fns/tz`, `date-fns`, `zod` were already present; no PDF library (D-12) | plan-time disposition (07-01..07-07 PLAN.md), verified at audit | 2026-09-04 |
| AR-7-02 | T-07-06-01, T-07-06-02, T-07-06-03 | Presentation-only and offline-harness risks from the first gap-closure plan; each is low severity, operator-only or print-only, and covered by the passed UAT prints | plan-time disposition (07-06-PLAN.md), verified at audit | 2026-09-04 |
| AR-7-03 | T-07-07-01, T-07-07-03, T-07-07-04 | Import-free status text, an offline harness generator, and a prefetch flag; low severity, no data crosses a boundary | plan-time disposition (07-07-PLAN.md), verified at audit | 2026-09-04 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-04 | 36 | 36 | 0 | secure-phase orchestrator (L1 grep-depth; short-circuit rule — plan-time register in all seven plans, threats_open 0, ASVS L1). Post-fix state audited: two code-review rounds (15 findings fixed after 07-01..07-05; 9 after 07-06; 8 fixed + 1 declined after 07-07 — 28 `fix(07)` commits), UAT 5 passed / 2 issues all resolved, 07-VERIFICATION 112/113. |

Notes:
- T-7-14 residual: `consume-wins.ts` logs `consumption threw for tenant <uuid>` on a per-tenant failure. A tenant uuid is an internal identifier, not customer data, and the mitigation's purpose (no quote id, amount, address or driver error in the tick body or log) holds; the contradiction with 07-03's own P3 prohibition is recorded in 07-VERIFICATION.md as a judgment-tier item for the operator to rule on, not an open threat. [Ruling 2026-09-04: tenant uuid permitted in that one fixed sentence — opaque internal id; sync-tick bodies already carry tenantId; needed to act on a wedge. Quote id, amount, customer data and the caught error remain forbidden.]
- The July-2026-era UAT fixture for tenant 13e8f2aa… (20 quotes, 40 ledger rows, 7 inbound, 20 attributions, 3 report versions, 2 fees) is fictional and still present in production; the teardown manifest lives in the session scratchpad and the rows are removable by id. Not a threat — recorded so the next audit does not mistake it for real client data.
- Every SUMMARY's `## Threat Flags` section reports no new boundary beyond the plan-time register; 07-06 and 07-07 changed presentation, tests and planning documents only.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-04
