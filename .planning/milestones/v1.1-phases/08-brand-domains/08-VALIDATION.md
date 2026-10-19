---
phase: 8
slug: brand-domains
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-06
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (`package.json`), Node 22 |
| **Config file** | `vitest.config.mts` (alias `@` → `src`, `setupFiles: tests/helpers/env.ts`, `globalSetup: tests/helpers/global-setup.ts`, `fileParallelism: false`) |
| **Quick run command** | `npx vitest run tests/brand.test.ts tests/resend-sender.test.ts tests/unsubscribe.test.ts tests/clicksend-sender.test.ts tests/audit-aggregate.test.ts` — pure suites; the WR-09 gate fires on credential access, so these run with NO `ALLOW_REMOTE_TESTS` and pause no production tick (measured 2026-09-06: `tests/audit-aggregate.test.ts` alone runs bare in 0.8 s) |
| **Full suite command** | CI `npx vitest run` on the local Supabase stack (`.github/workflows/ci.yml`, after lint + `next build`). Locally the DB-backed suites need `npm run test:remote`, which pauses the two production tick jobs — **never during Plans 08-05..08-07 (the URL switch) and never overlapping `npm run cron:apply`** (STATE.md hosted-DB rule) |
| **Estimated runtime** | quick ≈ 3 s; CI full ≈ 4-6 min |

---

## Sampling Rate

- **After every task commit:** Run the quick run command (plus `npm run typecheck && npm run lint` — both database-free)
- **After every plan wave:** push `main`; CI full suite must be green before the next wave (waves 3-6 also depend on CI green because the brand build must be deployed before the phone check)
- **Before `/gsd-verify-work`:** CI green on the final `main` commit; `npm run cron:status` shows four active jobs at the custom-domain origin with a recent 200 and zero lease rows
- **Max feedback latency:** ~3 s locally (pure suites); the live proofs (dig, curl, cron:status) each < 60 s except the deliberate two-minute waits for a cadence-tick minute

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | BRAND-01 | T-8-01 | brand module import-free; builders do no sanitising (sanitiser stays in resend-sender) | unit (structural + builders) | `npx vitest run tests/brand.test.ts && npm run typecheck && npm run lint` | ❌ W0 (created by this tracer task) | ⬜ pending |
| 8-01-02 | 01 | 1 | BRAND-01 | T-8-08 | console/print surfaces render SERVICE_NAME as escaped text; no dangerouslySetInnerHTML | unit (structural) | `npx vitest run tests/brand.test.ts tests/audit-aggregate.test.ts && npm run typecheck && npm run lint` | ✅ (after 8-01-01) | ⬜ pending |
| 8-01-03 | 01 | 1 | BRAND-01 (records) | — | docs contain no secret/token shapes | grep | `test "$(wc -l < .planning/phases/08-brand-domains/COVERAGE.md)" -le 1 && grep -c '^No external API integration:' …COVERAGE.md && grep -c 'followups@quotes.backdesk.com.au' docs/vercel-domains-and-protection.md` | n/a | ⬜ pending |
| 8-03-01 | 03 | 1 | BRAND-02 | T-8-13 | checkpoint:decision — no automation | human decision | — (resume-signal recorded) | n/a | ⬜ pending |
| 8-03-02 | 03 | 1 | BRAND-02 | T-8-13 / T-8-14 | eight exports, no column-0 import, basis-point precision | unit (structural) | `npx vitest run tests/audit-aggregate.test.ts tests/attribution-baseline.test.ts tests/reporting-copy.test.ts && npm run typecheck && npm run lint && test "$(grep -c 'Flagged assumption' .planning/PROJECT.md)" = "0"` | ✅ | ⬜ pending |
| 8-02-01 | 02 | 2 | BRAND-03 | T-8-01 / T-8-09 | From-header injection sanitiser unchanged; unsubscribe pages byte-identical | unit | `npx vitest run tests/brand.test.ts tests/resend-sender.test.ts tests/unsubscribe.test.ts && npm run typecheck && npm run lint` | ✅ (pins updated in-task) | ⬜ pending |
| 8-02-02 | 02 | 2 | BRAND-01 / BRAND-03 | T-8-12 | alert default stays Resend's owner-only sender; env override path unchanged | unit | `npx vitest run tests/clicksend-sender.test.ts tests/brand.test.ts && npm run typecheck && npm run lint` | ✅ | ⬜ pending |
| 8-02-03 | 02 | 2 | BRAND-01 | T-8-08 | no legacy service-name literal anywhere under src/ (comments included) | unit (filesystem walk) + grep | `npx vitest run tests/brand.test.ts tests/email-settings-action.test.ts tests/resend-domains.test.ts && npm run typecheck && npm run lint && test "$(grep -rli 'quote[- ]recovery' src \| wc -l \| tr -d ' ')" = "0"` | ✅ (grep-as-test added in-task) | ⬜ pending |
| 8-04-01 | 04 | 3 | DOM-01 | T-8-04 | checkpoint:decision (DNS host) — founder-only zone control | human decision | — | n/a | ⬜ pending |
| 8-04-02 | 04 | 3 | DOM-01 | T-8-16 / T-8-17 | CNAME value copied verbatim from `vercel domains inspect`; evidence entry holds no token | CLI read-back + grep | `vercel domains inspect app.backdesk.com.au \| grep -ci 'vercel-dns' && grep -c 'vercel-dns' docs/vercel-domains-and-protection.md && grep -c 'DNS delegation decided' docs/external-registrations.md && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"` | n/a | ⬜ pending |
| 8-04-03 | 04 | 3 | DOM-01 / DOM-03 | T-8-04 | checkpoint:human-action — records published only by the founder, DNS-only | dig read-backs (7) | `dig +short NS backdesk.com.au`, `dig +short CNAME app.backdesk.com.au`, DKIM/MX/SPF/DMARC `dig +short`, `dig +short A backdesk.com.au` empty | n/a | ⬜ pending |
| 8-05-01 | 05 | 4 | DOM-01 | T-8-05 / T-8-18 | `cron:status` prints origin+path only, never the bearer; lease rows 0; our 401 (JSON) not Vercel's | live (curl/dig/CLI) + script grep | `npm run cron:status \| grep -c 'active=t' \| grep -qx 4 && … && curl -sI https://app.backdesk.com.au/login \| head -1 \| grep -q ' 200' && test "$(curl … cadence-tick wrong bearer)" = "401" && npm run lint` (full command in the plan) | ❌ W0 (`scripts/cron-status.mjs` created in-task) | ⬜ pending |
| 8-05-02 | 05 | 4 | DOM-01 | T-8-02 / T-8-19 / T-8-18 | four cron targets + both ClickSend rules at the new origin; `--activate` never passed; lease rows 0 | live read-backs | `npm run cron:status \| grep -E '^(sm8-sync-tick\|cadence-tick\|messaging-reconcile\|stalled-digest) ' \| grep -c 'https://app.backdesk.com.au/api/internal/' \| grep -qx 4 && … net._http_response 200 … && grep -c 'URL switch' docs/external-registrations.md` | ✅ (after 8-05-01) | ⬜ pending |
| 8-06-01 | 06 | 5 | DOM-01 | T-8-02 | checkpoint:decision (release-now / hold) gated on the five 08-05 proofs | human decision | — | n/a | ⬜ pending |
| 8-06-02 | 06 | 5 | DOM-01 | T-8-02 | rename only after the gate; link refreshed; no legacy project name in config/script | CLI read-back + grep | `vercel project inspect backdesk >/dev/null && test "$(node -p "require('./.vercel/project.json').projectName")" = "backdesk" && grep -q '^project_id = "backdesk"$' supabase/config.toml && … && npm run lint` | n/a | ⬜ pending |
| 8-06-03 | 06 | 5 | DOM-01 / DOM-02 | T-8-06 / T-8-03 / T-8-10 / T-8-20 / T-8-07 | Standard scope only; bypass secret revoked; token never printed; custom domain + ticks public | live curl measurements | `curl -sI https://app.backdesk.com.au/login … 200 && … git-main alias 401 && wrong-bearer 401 && npm run cron:status … 200 && grep -q '"syd1"' vercel.json && git diff --quiet -- next.config.ts proxy.ts && …` (full command in the plan) | n/a | ⬜ pending |
| 8-07-01 | 07 | 6 | DOM-03 | T-8-16 / T-8-12 / T-8-21 | alert sender switched only after Verified + DKIM read-back; no email row enabled | dig + CLI read-backs | `dig +short TXT resend._domainkey.quotes.backdesk.com.au \| grep -q 'p=' && … && vercel env ls production \| grep -q OPERATOR_ALERT_FROM && vercel env ls preview \| grep -q OPERATOR_ALERT_FROM && grep -c 'verified at Resend' docs/external-registrations.md` | n/a | ⬜ pending |
| 8-07-02 | 07 | 6 | all | — | phase-wide closing gates | unit + lint + typecheck + live read-back | `test "$(grep -c '_To be filled' docs/vercel-domains-and-protection.md)" = "0" && npx vitest run <seven pure suites> && npm run typecheck && npm run lint && git diff --quiet -- vercel.json && npm run cron:status \| grep -c 'active=t' \| grep -qx 4` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

DB-backed suites this phase must leave green but cannot run locally without pausing production ticks (they run in CI on the local stack): `tests/unsubscribe-suppression.test.ts`, `tests/inbound-stop.test.ts`, `tests/convert-prospect.test.ts` (structural audit-page check), `tests/cron-schedules.test.ts` (no-literal-URL discipline), `tests/inbound-threading.test.ts`.

---

## Wave 0 Requirements

- [ ] `tests/brand.test.ts` — created by 8-01-01 (the tracer) before any other surface is swapped: structural pin (no imports, nine exports), builder assertions, login-page assertion; extended by 8-01-02 (console surfaces), 8-02-01 (BRAND-03 rendered surfaces), 8-02-03 (BRAND-01 grep-as-test over `src/`)
- [ ] `scripts/cron-status.mjs` + `npm run cron:status` — created by 8-05-01 before the URL switch; the only secret-safe read-back of `cron.job` / `net._http_response` / `remote_test_lease` available to the executor (the workspace denies any command naming `.env*`)
- [ ] Pins updated in existing suites: `tests/resend-sender.test.ts` (three expectations + header prose, 8-02-01), `tests/clicksend-sender.test.ts:279` (8-02-02), `tests/audit-aggregate.test.ts` (one new `it` for basis-point precision, 8-03-02; the three literal pins only if the operator changes a value)
- No framework install: Vitest 4.1.11 and the CI local-stack workflow already exist

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Console reachable on a phone at `https://app.backdesk.com.au/login`, heading reads Backdesk, title "Sign in · Backdesk", no cert warning, no redirect | DOM-01 (SC4), BRAND-01 (SC1) | D-11 says "on a phone"; curl cannot prove the handset certificate chain or the rendered heading | 8-05-01 `<human-check>` — open on mobile data, harvested to UAT at end of phase |
| Synthetic ClickSend capture row (attribution unmatched) appears in the triage inbox after `clicksend:setup` | DOM-01 | Row is visible only behind the operator login; it is the end-to-end proof the inbound route parses on the custom domain | 8-05-02 `<human-check>` — leave or clear per the 2026-08-29 precedent; note which in the entry |
| Supabase Auth → URL Configuration holds no old-host Site URL / redirect | DOM-01 (research A7) | Dashboard-only setting; not readable from repo or CLI | 8-06-02 `<human-check>` |
| `/settings/email` shows `quotes.backdesk.com.au` Verified, region ap-northeast-1, placeholder `followups@quotes.backdesk.com.au` | DOM-03 (SC5) | Resend status rendered behind the operator login; no repo script reads it without a session | 8-07-01 `<human-check>` |
| DNS host chosen; nameservers delegated; six records published DNS-only; Resend domain added via the console; `.env.local` `APP_BASE_URL` set | DOM-01 / DOM-03 (D-05) | Founder-only registrar and console actions; `.env*` is write-denied to the agent | 8-04-01 `checkpoint:decision`, 8-04-03 `checkpoint:human-action` (verified afterwards by the seven dig read-backs) |
| Three commercial values + setup-fee rule confirmed; grace-window behaviour confirmed | BRAND-02 (SC3) | A recorded human decision, by definition | 8-03-01 `checkpoint:decision` — reply quoted verbatim in the SUMMARY |
| Release the old default alias now (rename) | DOM-01 (D-06 step 3) | One-way door; the go/no-go must be a human reading the five 08-05 proofs | 8-06-01 `checkpoint:decision` |
| Operator-alert From header actually reads `Backdesk <alerts@quotes.backdesk.com.au>` | DOM-03 / D-03 | Event-gated: the stalled digest sends nothing when empty and no real alert condition exists; no production fixture is manufactured for this | Recorded as outstanding in 8-07-01's entry; observed at the first real alert or the Phase 10 go-live checklist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (checkpoint tasks excepted — each is immediately followed by an auto task with an automated verify)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (longest gap: one checkpoint between two automated tasks)
- [ ] Wave 0 covers all MISSING references (`tests/brand.test.ts` in 8-01-01; `scripts/cron-status.mjs` in 8-05-01)
- [ ] No watch-mode flags (every command is `vitest run`)
- [ ] Feedback latency < 8s for the pure suites (measured 0.8 s for one suite; ≈3 s for the quick set); live proofs are bounded by the deliberate cadence-tick waits
- [ ] `nyquist_compliant: true` set in frontmatter (validate-phase §6)

**Approval:** pending
