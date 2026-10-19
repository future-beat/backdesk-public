---
phase: 9
slug: landing-page-audit-intake
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-09
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (`environment: node`, `fileParallelism: false`, `setupFiles: tests/helpers/env.ts`, `globalSetup: tests/helpers/global-setup.ts`) |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run tests/<file>.test.ts` — pure suites run bare; NEVER set `ALLOW_REMOTE_TESTS` (it pauses the production tick jobs); DB-backed suites (`rls-coverage`, `audit-request-repository`) run only in CI against `supabase start` |
| **Full suite command** | `npm test` (CI, local stack) plus `npm run typecheck && npm run lint && npx next build` |
| **Estimated runtime** | ~9 seconds for the pure suites named below; `next build` ~2 minutes |

---

## Sampling Rate

- **After every task commit:** Run the pure suite(s) named in that task's `<verify><automated>` (pure suites only, so the timed gate stays under 10 s), then `npm run typecheck && npm run lint` as the task's static gate outside the timed block
- **After every plan wave:** `npx vitest run` over every pure suite in the map below (no remote), `npm run lint`, `npx next build`; push and read the CI run (DB-backed suites)
- **Before `/gsd-verify-work`:** CI green on `main`; the seven curl proofs, eight DoH read-backs and six Lighthouse JSONs recorded (09-08)
- **Max feedback latency:** 9 seconds (pure suites); CI ~6 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | LAND-02, LAND-03 | T-9-02 / T-9-07 / T-9-08 / T-9-12 / T-9-13 | Recipient is env-fixed; arming flag ignored for the operator SMS; action writes one tenant-less table; control chars stripped from the alert body; one notification per stored row | unit (pure) | `npx vitest run tests/audit-request-schema.test.ts tests/audit-request-notify.test.ts tests/audit-request-action.test.ts tests/proxy-host-routing.test.ts` | ❌ created by the task | ⬜ pending |
| 9-01-02 | 01 | 1 | LAND-03 | T-9-19 / T-9-14 | `cron:status` gate inside the automated block (lease 0, no watchdog) before `db:migrate`; journal agrees with the hosted DB (no-op re-run); env pushed over stdin, read back by metadata; stored row proven by a read-only count that prints no PII | hosted + CI integration | `npm run cron:status` (gate) · `npm run db:migrate` (twice) · `node scripts/setup-storage.mjs --check` · `node scripts/audit-requests-count.mjs` · CI: `npx vitest run tests/rls-coverage.test.ts tests/audit-request-repository.test.ts` | ❌ repository test created by the task; rls-coverage ✅ (edit) | ⬜ pending |
| 9-02-01 | 02 | 1 | LAND-05 | T-9-20 | Sixteen-export pin; no imports; no sanitiser; ABN never a placeholder | unit (structural) | `npx vitest run tests/brand.test.ts tests/layout-contract.test.ts` | ✅ (edit) | ⬜ pending |
| 9-02-02 | 02 | 1 | LAND-01 | — | Tokens both schemes; --accent-fg; tabular-nums; no stray hex | unit (structural) | `npx vitest run tests/brand-tokens.test.ts tests/layout-contract.test.ts` | ❌ created by the task | ⬜ pending |
| 9-02-03 | 02 | 1 | LAND-06 | T-9-15 | Only the expected static assets under /brand; metadata stripped | unit (structural) | `npx vitest run tests/brand-assets.test.ts tests/brand.test.ts` | ❌ created by the task | ⬜ pending |
| 9-03-01 | 03 | 2 | LAND-02 | — | checkpoint:decision (CSV cap) | manual | — | — | ⬜ pending |
| 9-03-02 | 03 | 2 | LAND-02 | T-9-04 / T-9-10 / T-9-11 | Size before bytes; sniff; private bucket; service-role client outside src/app | unit (pure) | `npx vitest run tests/audit-request-csv.test.ts tests/csv-mapping.test.ts tests/audit-request-action.test.ts tests/lint-ban.test.ts` | ❌ created / ✅ edit | ⬜ pending |
| 9-03-03 | 03 | 2 | LAND-03 | T-9-02 / T-9-03 / T-9-05 / T-9-06 / T-9-22 | Decoy field silent; throttle before insert; IP hashed with salt (/64); purge on the daily tick | unit (pure + structural) | `npx vitest run tests/audit-request-throttle.test.ts tests/audit-request-action.test.ts tests/audit-request-csv.test.ts` | ❌ created by the task | ⬜ pending |
| 9-04-01 | 04 | 2 | LAND-01 | — | checkpoint:decision (console `/` → `/clients`) | manual | — | — | ⬜ pending |
| 9-04-02 | 04 | 2 | LAND-01 | T-9-01 / T-9-23 / T-9-24 | Host chooses public-vs-wall only; apex console paths 404; cookies survive the rewrite | unit (pure, next/experimental/testing/server) | `npx vitest run tests/proxy-host-routing.test.ts tests/cadence-tick-route.test.ts tests/clicksend-inbound-route.test.ts tests/clicksend-dlr-route.test.ts tests/console-error-leak.test.ts tests/layout-contract.test.ts` | ✅ (edit, created in 9-01-01) | ⬜ pending |
| 9-09-01 | 09 | 2 | LAND-03 | T-9-18 / T-9-05 | List reads through RLS (`createClient()`, never the service role); explicit select without `user_agent` / `ip_hash`; error code to the log, fixed sentence to the page (the three NAMED_PAGES rules mirrored in the suite because 09-04 owns `console-error-leak` in wave 2) | unit (structural) | `npx vitest run tests/audit-request-console.test.ts tests/console-error-leak.test.ts tests/layout-contract.test.ts` | ❌ created by the task | ⬜ pending |
| 9-09-02 | 09 | 2 | LAND-03 | T-9-18 | `Requests (N new)` count read through `createClient()`; a failed count renders the plain label; the nav bar is not widened | unit (structural) | `npx vitest run tests/audit-request-console.test.ts tests/layout-contract.test.ts` | ✅ (edit, created in 9-09-01) | ⬜ pending |
| 9-05-01 | 05 | 3 | LAND-01 | T-9-26 / T-9-27 | No env read in the marketing tree; forbidden words absent; one AI phrase | unit (structural) | `npx vitest run tests/marketing-copy.test.ts tests/brand.test.ts tests/brand-tokens.test.ts` | ❌ created / ✅ edit | ⬜ pending |
| 9-05-02 | 05 | 3 | LAND-05, LAND-06 | T-9-28 / T-9-29 | Residency sentences pinned; console noindex; static build (`next build` runs in the plan-level verification, not the timed gate) | unit (structural) | `npx vitest run tests/privacy-page.test.ts tests/marketing-metadata.test.ts tests/marketing-copy.test.ts tests/layout-contract.test.ts` | ❌ created by the task | ⬜ pending |
| 9-06-01 | 06 | 3 | LAND-04 | T-9-09 / T-9-18 | requireOperator first; 404 for every denial; nosniff + attachment + no-store; route-handler `params` awaited; list (09-09) + detail pages added to NAMED_PAGES | unit (actions with mocked repository; structural) | `npx vitest run tests/audit-request-console.test.ts tests/console-error-leak.test.ts tests/lint-ban.test.ts tests/layout-contract.test.ts` | ✅ (edit) | ⬜ pending |
| 9-06-02 | 06 | 3 | LAND-04 | T-9-04 / T-9-06 / T-9-30 | Stored object fed to the unchanged staging path; conversion once-only; object deleted | unit (actions with mocked repository) | `npx vitest run tests/audit-request-console.test.ts tests/csv-mapping.test.ts tests/lint-ban.test.ts` | ✅ (edit) | ⬜ pending |
| 9-07-01 | 07 | 4 | LAND-01 | T-9-31 / T-9-14 | Values read back after attaching; no secrets in docs | live (vercel api) | `vercel api /v9/projects/backdesk/domains …` (see plan) | — | ⬜ pending |
| 9-07-02 | 07 | 4 | LAND-01 | — | checkpoint:decision (apex cut-over) | manual | — | — | ⬜ pending |
| 9-07-03 | 07 | 4 | LAND-01 | T-9-17 | checkpoint:human-action (founder publishes records) | manual | — | — | ⬜ pending |
| 9-08-01 | 08 | 5 | LAND-01 | T-9-17 / T-9-14 | Google Workspace records unchanged; HTTPS 200 is the only proof of a live host | live (DoH + curl) | `curl -sI https://backdesk.com.au/ …` (see plan) | — | ✅ passed 2026-09-09 — HTTPS 200 apex / 308 www / 404 `/inbox`; MX, SPF, DKIM, DMARC, `app` unchanged, read from the authoritative nameservers |
| 9-08-02 | 08 | 5 | LAND-06 | T-9-16 | Production apex only, never a preview URL | live (Lighthouse 13 CLI) | `npx --yes lighthouse@13 https://backdesk.com.au/ --only-categories=performance,accessibility --output=json …` ×3 per page + the median check in the plan | — | ✅ passed 2026-09-09 — medians home 97/100, audit 98/100; all six `requestedUrl` on the production apex |
| 9-08-03 | 08 | 5 | LAND-01 | T-9-33 | Forbidden-word test re-runs on the copy swap (optional task) | unit (structural) | `npx vitest run tests/marketing-copy.test.ts tests/privacy-page.test.ts tests/marketing-metadata.test.ts` | ✅ (from 9-05) | ✅ passed 2026-09-09 — request arrived; the non-conflicting subset applied, the rest recorded as conflicts; suites green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No framework install and no separate Wave 0 plan: every new suite is created inside the task it verifies (listed as "❌ created by the task" above), following the tracer-first shape, and each existing suite that gains cases is edited in the task that changes the behaviour it pins:

- `tests/audit-request-schema.test.ts`, `tests/audit-request-notify.test.ts`, `tests/audit-request-action.test.ts`, `tests/proxy-host-routing.test.ts` — 9-01-01
- `tests/audit-request-repository.test.ts` (CI) + edit `tests/rls-coverage.test.ts` — 9-01-02
- `tests/audit-request-console.test.ts` — 9-09-01 (extended in 9-09-02, 9-06-01, 9-06-02); edit `tests/console-error-leak.test.ts` — 9-04-02 (NAMED_PAGES rename) and 9-06-01 (list + detail pages added; 9-09 does not touch this file because 9-04 owns it in wave 2)
- edit `tests/brand.test.ts` (sixteen-name pin) — 9-02-01; `tests/brand-tokens.test.ts` — 9-02-02; `tests/brand-assets.test.ts` — 9-02-03
- `tests/audit-request-csv.test.ts` + edit `tests/csv-mapping.test.ts` — 9-03-02; `tests/audit-request-throttle.test.ts` — 9-03-03
- `tests/marketing-copy.test.ts` — 9-05-01; `tests/privacy-page.test.ts`, `tests/marketing-metadata.test.ts` — 9-05-02
- Env dummies for `OPERATOR_ALERT_PHONE` and `AUDIT_IP_HASH_SALT` in `tests/helpers/env.ts` REQUIRED + `.github/workflows/ci.yml` — 9-01-01 (same commit as the schema keys)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email + SMS arrive on the operator's inbox and handset within a minute of a real submission | LAND-03 | Real providers; no suite may send | 9-01-02 human-check: submit on `app.backdesk.com.au/audit` (JS on, then JS off); record arrival times; `node scripts/audit-requests-count.mjs` shows the count up by two with `email=sent sms=sent`; 9-09-01 human-check: both rows on `/audits/requests`, newest first, no notify-failed badge |
| Apex live over HTTPS, www 308, apex console paths 404, Google Workspace records intact | LAND-01 | Founder DNS action + certificate issuance | **✅ done 2026-09-09.** Eight authoritative read-backs + eight `curl -sI` proofs in `docs/external-registrations.md`. Certificates auto-issued; `vercel certs issue` never needed |
| Lighthouse ≥ 90 performance + accessibility, mobile, `/` and `/audit` | LAND-06 | CLI run against production (never a walled preview); not in CI | **✅ done 2026-09-09.** Medians home **97**/100, audit **98**/100. Six JSONs under `docs/lighthouse/`, every `requestedUrl` on the production apex |
| OG image / title / description in a link preview; favicon on the phone tab; dark-mode rendering | LAND-06 | Visual | ⬜ **open — founder, on a phone.** Machine-side is done: `/brand/og-image.png` returns `HTTP/2 200 content-type: image/png` on the apex and the `og:*` tags carry the absolute apex URL, 1200×630. Whether the preview *renders* and the favicon shows on a tab is not measurable from here |
| Landing page readable on a 390px phone in both schemes; one green action; prices green/tabular | LAND-01 | Visual | ⬜ **open — founder, on a phone.** Now checkable at `https://backdesk.com.au` rather than the walled app host. Lighthouse a11y is 100/100 at 412×823, which is evidence about contrast and labels, not about whether it reads well |
| Console detail → Download CSV → Start audit → mapping step → Open audit | LAND-04 | Interactive flow through the existing mapping UI | 9-06-02 human-check |
| Console `/` still lands on the client list after the move | LAND-01 | Interactive (session + rewrite) | 9-04-02 human-check |
| OG image and touch icon visual conformance to D-06 | LAND-06 | Visual | 9-02-03 human-check |

Recorded results (filled by 9-08-02):

| Page | Run 1 perf/a11y | Run 2 | Run 3 | Median perf | Median a11y | Date | Lighthouse |
|------|-----------------|-------|-------|-------------|-------------|------|------------|
| `/` | 99 / 100 | 97 / 100 | 97 / 100 | **97** | **100** | 2026-09-09 | 13.4.1, mobile preset, Chrome 152 |
| `/audit` | 98 / 100 | 98 / 100 | 98 / 100 | **98** | **100** | 2026-09-09 | 13.4.1, mobile preset, Chrome 152 |

Both pages clear LAND-06's bar of 90 on both categories; the lowest single measurement
across all twelve is 97. The A6 performance fallback was not applied and `proxy.ts` is
unchanged. Full reports: `docs/lighthouse/2026-09-09-{home,audit}-{1,2,3}.json`, each
carrying `requestedUrl: https://backdesk.com.au/…` (T-9-16 asserted, not assumed).

**Still open, and only a human with a phone can close them:** the link-preview render, the
favicon on a tab, the dark-mode read at 390px, the live email + SMS arrival times, and the
console CSV walkthrough. They are listed in the table above and carried into 09-08-SUMMARY.md.
| https://backdesk.com.au/ | — | — | — | — | — | — | 13.x |
| https://backdesk.com.au/audit | — | — | — | — | — | — | 13.x |

---

## Spec-less probe accounting (Dimension 8)

No SPEC file for this phase (EDGE_ABSENT=1, PROHIB_ABSENT=1). The edge probe returned 10 items; the UI-consideration probe returned 64. Resolution:

- **Edge probe (10):** 7 resolved explicit → `must_haves.truths` (LAND-02 empty/encoding/concurrency in 09-01; LAND-03 boundary/precision/concurrency in 09-03 (boundary + precision + concurrency) and 09-01 (precision "within one minute"); LAND-04 concurrency in 09-06). 3 `unclassified` rows (LAND-01, LAND-05, LAND-06) stay **unresolved** and are surfaced as flagged assumptions in the planning return — never auto-resolved.
- **UI considerations (64):** 44 explicit → plain truths; 19 backstop → flat-scalar `[backstop] …` truths; 1 unresolved (E6 C-7 site footer, probe could not classify) → flagged assumption. Distribution: 09-01 carries E7, E8, E9; 09-09 carries E11 (moved with the list page in the plan-checker revision); 09-02 carries E13; 09-05 carries E1–E5 and E10; 09-06 carries E12. E12 empty is authored once, in 09-06; 09-04's root not-found truth is wiring for it and carries no E12 tag, so it is not a second row.
- **Prohibitions:** 27 kept across the nine plans (09-01 6, 09-02 3, 09-03 3, 09-04 2, 09-05 4, 09-06 3, 09-07 2, 09-08 2, 09-09 2), authored descriptor-less under `must_haves.prohibitions` (flagged-unverified by construction). Canon items (injection, path traversal, upload validation, generic retention law) were NOT minted — breadcrumb: covered by `/gsd-secure-phase` and the STRIDE registers.

Equality: 10 = 7 authored + 3 flagged; 64 = 63 authored + 1 flagged.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (the three checkpoint tasks are manual by nature and never adjacent to more than one other manual task)
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 9s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
