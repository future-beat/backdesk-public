---
phase: 08-brand-domains
verified: 2026-09-08T10:10:00Z
status: passed
score: 50/51 must-haves verified
behavior_unverified: 0
overrides_applied: 0
requirements:
  BRAND-01: satisfied
  BRAND-02: satisfied
  BRAND-03: satisfied
  DOM-01: satisfied
  DOM-02: satisfied
  DOM-03: satisfied  # console badge confirmed by the operator in UAT test 1 (2026-09-09); the live cadence-send clause is deferred to Phase 10 (DOM-04)
deferred:

  - truth: "quotes.backdesk.com.au is the sending domain for cadence email (a real cadence email sent from the verified domain)"
    addressed_in: "Phase 10"
    evidence: "Phase 10 requirements include DOM-04: 'The deferred MSG-02 live email proof is executed end to end on the verified domain in production'; CONTEXT D-11 and 08-07 both defer the live send there"
prohibitions_flagged: 16  # all judgment-tier (no verification: field on any item); non-authoritative LLM-judge verdicts below — unverified-prohibition, human review recommended
human_verification:

  - test: "Log in and open https://app.backdesk.com.au/settings/email"
    expected: "quotes.backdesk.com.au is listed with the status badge 'Verified', region ap-northeast-1, the residency note unchanged, and the from-address placeholder reads followups@quotes.backdesk.com.au"
    why_human: "The badge renders behind the operator login from a live Resend read (page.tsx line 150 listDomains -> statusBadge); no session is available here. The status behind it is proven (Resend API status=verified recorded 08-07; all four DNS records resolve publicly today). This is the single clause holding DOM-03 open."

  - test: "Supabase dashboard -> Authentication -> URL Configuration"
    expected: "Site URL and every Redirect URL name https://app.backdesk.com.au or are the local defaults; none names quote-recovery-mvp.vercel.app"
    why_human: "Dashboard-only setting (research A7); not readable from the repo, the CLI or this workspace. Consequence if stale: password-reset/confirmation links take an extra 308 hop (every old host now redirects), not a dead link."

  - test: "Open the triage inbox at https://app.backdesk.com.au and look for the synthetic inbound row dated 2026-09-08 (attribution unmatched, ClickSend sample content)"
    expected: "Exactly one such row; it is test residue from the 08-05 webhook proof on the new host. Decision already taken: leave it, per the 2026-08-29 precedent."
    why_human: "Visible only behind the operator login; the database side (1 new inbound_messages row) was already reported by the setup script."

  - test: "On the first real operator alert (or as a Phase 10 go-live checklist item), open the alert email and read the From header"
    expected: "From: Backdesk <alerts@quotes.backdesk.com.au>"
    why_human: "Event-gated: the stalled digest sends nothing when empty and no alert condition exists; manufacturing one on the production database was refused. OPERATOR_ALERT_FROM is present in Vercel Production as Config (read back today by name) and a redeploy followed the push."

  - test: "(Already closed by the founder on 2026-09-08 — listed for the record, no action required) On a phone on mobile data open https://app.backdesk.com.au/login"
    expected: "Loads over HTTPS with no certificate warning; heading reads Backdesk; tab reads 'Sign in · Backdesk'; nothing redirects"
    why_human: "A handset certificate chain and a rendered heading cannot be proven by curl. The operator's checkpoint reply 'release-now, phone check done' is recorded in 08-06 and STATE.md; server-side corroboration today: HTTP/2 200 from syd1, HSTS, title 'Sign in · Backdesk', 6x Backdesk / 0x Quote Recovery in the served HTML."

  - test: "Review the 16 judgment-tier prohibitions table below and confirm each non-authoritative verdict"
    expected: "Each prohibition holds; none needs a corrective task"
    why_human: "No prohibition in this phase carries a verification: field, so all are judgment-tier. ADR-550 D4 requires explicit human resolution rather than a silent pass."
---

# Phase 8: Brand & Domains Verification Report

**Phase Goal:** The service presents as Backdesk on every surface a prospect or client sees, on its own domains, with the commercial assumptions the audit and the invoice depend on confirmed and recorded
**Verified:** 2026-09-08T10:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification
**Mode:** standard goal-backward (phase has no `mode: mvp`; the D-04 UI-gate skip is recorded in CONTEXT and honoured — no CSS or layout file has a commit since 2026-09-06)

## Method note

SUMMARY claims were not accepted as evidence. Every truth below was checked against the working tree, the running test suites, or the live public state. Environment constraints followed: DNS read over Google DNS-over-HTTPS (the sandbox resolver is a stub), `npm run cron:status` as the only database read, pure vitest suites run bare with no `ALLOW_REMOTE_TESTS`, `npm run test:remote` never run, no `.env*` file named in any command, no secret printed (Vercel env read by name only; the one "Bearer" pattern hit in `docs/external-registrations.md:1553` is the deliberately invalid 64-zero probe token).

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Audit page, monthly report, cadence email, operator alert, console title and login page all name the service Backdesk; no rendered "Quote Recovery" string remains (package name may) | ✓ VERIFIED | `src/core/brand.ts` (9 exports, no imports) imported by 10 files: login h1 (`login/page.tsx:23`), root metadata default/template/description (`layout.tsx:8-12`), console nav wordmark (`(console)/layout.tsx:103`), audit footer (`audits/[id]/page.tsx:295`), report footer (`reports/.../page.tsx:406`), `resend-sender.ts:226,233`, `unsubscribe/route.ts:95`, both alert modules, `clicksend-client.ts:59`. `grep -rliE 'quote[- ]recovery' src` → 0 files. `tests/brand.test.ts` walks `src/` (line 340) asserting the same, 26 tests green. Live: `curl https://app.backdesk.com.au/login` → title `Sign in · Backdesk`, 6x Backdesk, 0x Quote Recovery. `package.json` name stays `quote-recovery` (exempt) |
| SC2 | Every outbound SMS and email names the tradie as sender, Backdesk only as the service; STOP / one-click unsubscribe still suppresses both channels | ✓ VERIFIED | From header `"${viaDisplayName(business)}" <fromAddress>` with `business = displayName(identity.businessName)` sanitised first (`resend-sender.ts:224-233`); identity line in html+text via `identityLine(business)`; `List-Unsubscribe` / `List-Unsubscribe-Post` headers unchanged (lines 262-263). SMS: `src/core/drafting` contains no "Backdesk" / "on behalf of" — only the tradie is named. Pure suites `resend-sender`, `unsubscribe`, `clicksend-sender`, `brand` green locally (286 tests / 9 files). DB-backed suppression suites (`unsubscribe-suppression`, `inbound-stop`) ran green in CI on `0344b85` (run 34211583609, 2026-09-08T09:43Z), which contains every code change of this phase — the three later commits are docs-only |
| SC3 | Operator confirmed AUDIT_RECOVERY_RATE, default baseline win rate + min-quotes threshold, and the setup-fee exclusion; values in one documented config location; PROJECT.md records the decision before any real audit/invoice | ✓ VERIFIED | Checkpoint reply `keep-all, grace-window confirmed` dated 2026-09-07 recorded verbatim in `docs/commercial-assumptions.md:3-5` (165 lines), STATE.md:370-371, commit `b3d4e95`. `src/core/audit/constants.ts`: 0 import lines, 8 `export const`, header names `docs/commercial-assumptions.md` exactly once; values 0.15 / 0.7 / 10 at lines 45/118/137. `.planning/PROJECT.md`: 0 "Flagged assumption" rows, 2 rows pointing at the record (lines 96, 106). Basis-point pin `Number.isInteger(rate*10000)` at `tests/audit-aggregate.test.ts:125-126`. `/audits` fixture torn down 4 Sep (memory), so no stored estimate predates the confirmation |
| SC4 | Console at https://app.backdesk.com.au on a phone (syd1 unchanged); `*.vercel.app` production URL redirects there; previews protected again while pg_cron ticks and every public page keep working; bypass/exclusions documented in docs/ | ✓ VERIFIED | Live today: `app.backdesk.com.au/login` → HTTP/2 200, `x-vercel-id: syd1::syd1`, HSTS; `/api/unsubscribe` → 200. `vercel.json` = `{"regions":["syd1"]}`. All four `*.vercel.app` aliases (`quote-recovery-mvp`, `quote-recovery-mvp-git-main-…`, `backdesk-hesams-projects-…`, `backdesk-git-main-…`) → 308 `location: https://app.backdesk.com.au/login`. Two deployment URLs → 302 `vercel.com/sso-api` + `_vercel_sso_nonce` cookie (the wall exists). `npm run cron:status` → 4 jobs `active=t` at `https://app.backdesk.com.au/api/internal/…`, `net._http_response` 200 at 10:00–10:03Z today (after protection was enabled 09:34Z), lease rows 0. `docs/vercel-domains-and-protection.md` §5–§7 hold measured values; 0 fill markers. Phone check: operator checkpoint `release-now, phone check done` recorded (STATE.md:377) — listed under human verification for the record only |
| SC5 | Console email settings page shows quotes.backdesk.com.au verified (SPF, DKIM, DMARC published) and it is the sending domain for cadence email and operator alerts | ? UNCERTAIN (3 of 4 clauses proven) | Published, live today via DoH: `resend._domainkey.quotes` TXT (218-char DKIM `p=…IDAQAB`), `send.quotes` MX `10 feedback-smtp.ap-northeast-1.amazonses.com.`, `send.quotes` TXT `v=spf1 include:amazonses.com ~all`, `_dmarc.quotes` TXT `v=DMARC1; p=none;` (no rua). Resend `status=verified region=ap-northeast-1` recorded from a read-only API GET in 08-07 (not re-observable here without the key). Operator alerts: `OPERATOR_ALERT_FROM` present in Vercel Production as Config (read by name today), consumed at `operator-email.ts:191` / `stalled-drafts.ts:249`. **Open:** the badge render on `/settings/email` (307 → /login without a session; page reads live via `listDomains()` at line 150 and renders `statusBadge(record.status)` — real data flow, not static). **Deferred:** the live cadence send → Phase 10 / DOM-04 |

**Roadmap score:** 4/5 verified, 1 uncertain (human check + one clause deferred by decision D-11).

### Observable Truths — PLAN must_haves (merged; 08-07 T1 restates SC5 and is deduplicated)

| # | Plan | Truth (abridged) | Status | Evidence |
|---|------|------------------|--------|----------|
| 1 | 08-01 | Login h1 and console titles render from the brand module; template `%s · Backdesk` | ✓ | `login/page.tsx:23`, `layout.tsx:8-11`; live title `Sign in · Backdesk` |
| 2 | 08-01 | `brand.ts` has no import and exactly nine exports, pinned by test | ✓ | File read: 0 imports, exports SERVICE_NAME, APEX_DOMAIN, CONSOLE_HOST, SENDING_DOMAIN, CONSOLE_DESCRIPTION, PROVIDER_SOURCE_TAG, DEFAULT_ALERT_FROM, identityLine, viaDisplayName; `tests/brand.test.ts:120` `not.toMatch(/^import /m)` |
| 3 | 08-01 | A4 pages and nav wordmark render SERVICE_NAME through JSX text with no layout/CSS change | ✓ | JSX text nodes at the three sites; `git log --since=2026-09-06` on `globals.css`, `audit.css`, `report.css` → no commits; no `dangerouslySetInnerHTML` (test line 246) |
| 4 | 08-01 | Adjacency: package.json keeps `quote-recovery`; grep-as-test walks src/ only | ✓ | `package.json:2`; walk pinned to `src` with >20 files (test lines 340, 360) |
| 5 | 08-01 | Ordering: title default = SERVICE_NAME, template = `%s · SERVICE_NAME` | ✓ | `layout.tsx:9-10` |
| 6 | 08-01 | Empty: builders total over strings | ✓ | Pure template literals in `brand.ts`; brand tests green |
| 7 | 08-01 | Encoding: brand module does no quoting/escaping; sanitiser stays in resend-sender | ✓ | `brand.ts` has no `.replace(`; `displayName()` at `resend-sender.ts:174` |
| 8 | 08-02 | From = `{business} via Backdesk`; identity line in both bodies; List-Unsubscribe headers unchanged | ✓ | `resend-sender.ts:226-263` |
| 9 | 08-02 | Unsubscribe pages carry the generic identity line with a constant argument, byte-identical | ✓ | `unsubscribe/route.ts:95` constant literal; `tests/unsubscribe.test.ts` (oracle assertion) green |
| 10 | 08-02 | Alerts default to `Backdesk <onboarding@resend.dev>` from one export; OPERATOR_ALERT_FROM overrides | ✓ | `brand.ts` DEFAULT_ALERT_FROM; `?? DEFAULT_ALERT_FROM` at `operator-email.ts:191`, `stalled-drafts.ts:249`; no local const remains |
| 11 | 08-02 | No file under src/ matches `/quote[- ]recovery/i`, enforced by a test | ✓ | grep → 0; `tests/brand.test.ts:93,340` |
| 12 | 08-02 | Adjacency: "Backdesk Plumbing via Backdesk" unambiguous | ✓ | brand tests green (BRAND-03 adjacency case) |
| 13 | 08-02 | Empty: builders total; production never passes empty business | ✓ | Builders pure; `email-settings-action` suite green (enabled-row gate) |
| 14 | 08-02 | Encoding: sanitise-then-brand; html escapes identity line | ✓ | `resend-sender.ts:224` sanitises before line 226/233; injection pin in `resend-sender.test.ts` green |
| 15 | 08-02 | Ordering: tradie first in From and subject; SMS never names the service | ✓ | `resend-sender.ts:233,240`; `src/core/drafting` grep for Backdesk → none |
| 16 | 08-03 | Operator explicitly confirmed/changed the three values + setup-fee rule at a recorded checkpoint | ✓ | Verbatim reply in `docs/commercial-assumptions.md:5`, STATE.md:370, commit `b3d4e95` |
| 17 | 08-03 | Values in exactly one location; header points at the record; eight exports, no import | ✓ | Counts 0 / 8 / 1 as above |
| 18 | 08-03 | PROJECT.md carries no "Flagged assumption" row; both rows confirmed with date + pointer | ✓ | grep 0 / 2; lines 96, 106 |
| 19 | 08-03 | Decision record has value, rationale, date, who, where it renders, what to edit (pins ~96/100/115) | ✓ | Record lines 22-145 name all four symbols, `feesNote`, and pins `:115`, `:96`, `:100` |
| 20 | 08-03 | Precision: both rates exact in basis points, asserted by test | ✓ | `tests/audit-aggregate.test.ts:125-126`; suite green |
| 21 | 08-03 | `[backstop]` boundary: equality uses measured baseline (strict `<`); win rates 0 and 1 resolve | ✓ (explicit evidence found) | Read `baseline.ts:79` → `(input.quotesIssued ?? 0) < BASELINE_MIN_QUOTES`; `tests/attribution-baseline.test.ts:68,78,90,124` cover MIN−1, MIN, `'0.0000'`, `'1.0000'`; suite green in this run |
| 22 | 08-04 | Founder chose a DNS host at a recorded checkpoint; NS resolves to it | ✓ | DoH NS → `nsc1–4.squarespacedns.com.`; decision recorded in DOM doc §1 |
| 23 | 08-04 | app.backdesk.com.au attached; exact CNAME recorded verbatim in both docs | ✓ | DoH CNAME → `956ea6eb7ab36544.vercel-dns-017.com.`; string present 2x in DOM doc, 6x in registrations |
| 24 | 08-04 | Founder received ONE complete record list; agent created no DNS record; apex untouched | ✓ | Record list in the 2026-09-08 entry (line 771); apex A = four Squarespace parking IPs only; apex `_dmarc` is Google Workspace's (`rua=mailto:hello@…`), documented as the founder's |
| 25 | 08-04 | quotes.backdesk.com.au added at Resend via console flow, region ap-northeast-1, records pasted DNS-only | ✓ | `EMAIL_DOMAIN_REGION = 'ap-northeast-1'` in code; the four published records match the Resend shapes byte-for-byte |
| 26 | 08-04 | Brand build pushed and READY on Vercel before the founder acted | ✓ | Live host serves the brand build; CI green on the phase commits |
| 27 | 08-04 | APP_BASE_URL=https://app.backdesk.com.au in .env.local | ✓ | `cron:status` prints `local APP_BASE_URL origin: https://app.backdesk.com.au` (no file named) |
| 28 | 08-05 | Custom domain serves production over TLS while old alias still served (D-06 step 1) | ✓ | 200 today; old alias later redirected (08-06), ordering preserved in the dated entries |
| 29 | 08-05 | Founder opens /login on a phone, h1 reads Backdesk | ✓ (recorded operator checkpoint) | STATE.md:377; server corroboration today; listed under human verification for the record |
| 30 | 08-05 | APP_BASE_URL in Vercel Production AND Preview equals the custom origin; redeployed | ✓ | `vercel env ls production` shows `APP_BASE_URL` (Config); every tick 200 at the new origin proves the running functions boot with it |
| 31 | 08-05 | All FOUR pg_cron jobs active at the custom origin; 200s recorded; read back by `cron:status` printing origin+path, never the bearer | ✓ | `cron:status` output today (4 jobs, 200s 10:00–10:03Z); `scripts/cron-status.mjs:121` extracts in-DB with `substring(command from …)`; comment-stripped `https://` literals → 0 |
| 32 | 08-05 | Both ClickSend rules point at the custom host; wrong-token 401 / real-token 200; not armed | ✓ (recorded read-back) | 08-05 entry: `UPDATED` on both rules, 401/200 probes, "NOT arming"; the synthetic inbound row proves the inbound route on the new host (human item to view) |
| 33 | 08-05 | Concurrency: re-running cron:apply / clicksend:setup converges to one job/rule per name | ✓ | Observed exactly one row per jobname, four names, no DUPLICATED line |
| 34 | 08-05 | No remote test run overlapped the switch | ✓ | Lease rows 0 / watchdog not scheduled, today and in the recorded before/after |
| 35 | 08-06 | Project named `backdesk`; link file, `supabase/config.toml`, push script relabelled | ✓ | `.vercel/project.json` projectName `backdesk`; `config.toml:5`; `push-vercel-env.mjs:7,103`; `vercel project ls` → `backdesk https://app.backdesk.com.au` |
| 36 | 08-06 | NEW default alias (read back, never `backdesk.vercel.app`) 308s to the custom domain via a Vercel domain setting; no next.config/proxy change | ✓ | `backdesk-hesams-projects-432a48c6.vercel.app/login` → 308 today; `next.config.ts` / `proxy.ts` contain no redirect/host logic and have no commits since 2026-09-06; `backdesk.vercel.app` referenced in docs only as "not ours" |
| 37 | 08-06 | Standard Protection on: previews walled; custom domain, unsubscribe and ticks keep working | ✓ (measured deviation recorded) | Deployment URLs 302 → sso-api + nonce; custom domain 200; ticks 200. Plan wording predicted the `-git-main-` alias would answer 401 — measured 200 and given the same 308 instead (DOM doc §6, honest) |
| 38 | 08-06 | Bypass secret revoked; nothing in the repo uses one; §7 says so | ✓ (repo side observed; platform side recorded) | Repo-wide grep for bypass headers/env → none; §7 records key count 1 → 0 via `PATCH /v1/projects/backdesk/protection-bypass` |
| 39 | 08-06 | Research A1 MEASURED and written into §6 | ✓ | §6 Documented/Measured table, row (b) |
| 40 | 08-06 | `vercel.json` still pins syd1 | ✓ | File content; `x-vercel-id: syd1` live |
| 41 | 08-06 | Old alias released only after the five 08-05 proofs — confirmed at the release-now decision | ✓ | Checkpoint reply recorded; aliases were retained and redirected (more conservative than release) |
| 42 | 08-07 | OPERATOR_ALERT_FROM set in Vercel Production and Preview, redeployed | ✓ | Present as Config in `vercel env ls production` (name only); 08-07 entry records targets + `updatedAt` + redeploy |
| 43 | 08-07 | Cadence email on the service domain = verified domain + documented convention; no email row enabled, no customer email sent | ✓ (documented; live send deferred) | DOM doc §4 status table; `email-settings-action` gate green; D-11 |
| 44 | 08-07 | Alert From-header observation recorded honestly as event-gated | ✓ | 08-07 entry and DOM doc §4 say so; observation itself is a human/event item |
| 45 | 08-07 | DOM doc has no fill marker; every section measured or event-gated; §8 indexes all dated entries | ✓ | `_To be filled` → 0; §8 lists 6 dated entries; 7 dated 2026-09-08 headings in registrations |
| 46 | 08-07 | Closing checks pass: pure suites, typecheck, lint, grep-as-test; cron:status healthy; syd1 | ✓ | Re-run here: 9 files / 286 tests pass; `tsc --noEmit` clean; `eslint --max-warnings=0` clean; cron:status as above |

**Score:** 50/51 truths verified (5 SC + 46 plan truths; SC5 uncertain). 0 behavior-unverified.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | quotes.backdesk.com.au exercised as the sending domain for a real cadence email | Phase 10 | Phase 10 requirements list DOM-04 ("deferred MSG-02 live email proof executed end to end on the verified domain in production"); CONTEXT D-11 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/brand.ts` | Nine exports, no imports | ✓ VERIFIED | 80 lines; wired into 10 files |
| `tests/brand.test.ts` | Structural pin + BRAND-03 + grep-as-test | ✓ VERIFIED | 26 tests, walk over `src/` |
| `src/app/login/page.tsx`, `src/app/layout.tsx`, `(console)/layout.tsx`, audit + report pages | Render from brand module | ✓ VERIFIED | Imports + JSX usage confirmed |
| `src/core/messaging/resend-sender.ts` | identityLine/viaDisplayName, sanitiser unchanged | ✓ VERIFIED | Lines 174, 224-233 |
| `src/app/api/unsubscribe/route.ts` | Generic identity line, constant arg | ✓ VERIFIED | Line 95 |
| `src/core/alerts/operator-email.ts`, `stalled-drafts.ts` | Import DEFAULT_ALERT_FROM | ✓ VERIFIED | Lines 35/191, 40/249 |
| `src/core/messaging/clicksend-client.ts` | SOURCE = PROVIDER_SOURCE_TAG | ✓ VERIFIED | Line 59, used at 205 |
| `src/core/audit/constants.ts` | Header pointer; 8 exports; 0 imports | ✓ VERIFIED | Counts confirmed |
| `docs/commercial-assumptions.md` | Decision record ≥40 lines | ✓ VERIFIED | 165 lines |
| `.planning/PROJECT.md` | Confirmed rows | ✓ VERIFIED | 2 pointers, 0 flags |
| `tests/audit-aggregate.test.ts` | isInteger pin | ✓ VERIFIED | Lines 125-126 |
| `scripts/cron-status.mjs` + `package.json` `cron:status` | Read-only read-back | ✓ VERIFIED | 168 lines; runs; no URL literal |
| `supabase/config.toml` | `project_id = "backdesk"` | ✓ VERIFIED | Line 5 |
| `scripts/push-vercel-env.mjs` | `--project backdesk` | ✓ VERIFIED | Lines 7, 103 |
| `vercel.json` | syd1 | ✓ VERIFIED | Unchanged |
| `docs/vercel-domains-and-protection.md` | §1–§8 measured, 308, bypass statement, alerts@ | ✓ VERIFIED | 0 fill markers |
| `docs/external-registrations.md` | Dated entries: DNS delegation, attach, URL switch, rename, protection, Resend verified | ✓ VERIFIED | 7 dated 2026-09-08 headings |
| `.planning/phases/08-brand-domains/COVERAGE.md` | API-coverage declaration | ✓ VERIFIED | Present |

### Key Link Verification

`gsd-tools verify.key-links` reported misses on 08-01/02/05/06/07 that are tool artefacts (double-escaped regex, and `from:` entries that describe external state rather than files). Each was checked by hand:

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `login/page.tsx` | `brand.ts` | `import { SERVICE_NAME } from '@/core/brand'` | WIRED | Line 3, rendered line 23 |
| `layout.tsx` | `brand.ts` | CONSOLE_DESCRIPTION, SERVICE_NAME | WIRED | Tool-verified |
| audit page | `brand.ts` | SERVICE_NAME footer | WIRED | Tool-verified |
| `tests/brand.test.ts` | `brand.ts` | readFileSync structural pin | WIRED | Test green |
| `resend-sender.ts` | `brand.ts` | `viaDisplayName(business)` in From; `identityLine(business)` | WIRED | Lines 226, 233 |
| `unsubscribe/route.ts` | `brand.ts` | `identityLine('the business that quoted you')` | WIRED | Line 95 |
| `operator-email.ts` | `brand.ts` | `OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM` | WIRED | Line 191 (and stalled-drafts 249) |
| `tests/brand.test.ts` | `src/` | readdir walk, `/quote[- ]recovery/i` | WIRED | Lines 93, 340 |
| `docs/commercial-assumptions.md` ↔ `constants.ts` ↔ `PROJECT.md` | pointers | — | WIRED | Tool-verified 3/3 |
| `docs/external-registrations.md` | DOM doc | proof index cross-ref | WIRED | Tool-verified |
| `scripts/cron-status.mjs` | `cron.job` | `substring(command from …)` in-DB | WIRED | Line 121; runs today |
| `package.json` | `cron-status.mjs` | npm script | WIRED | Tool-verified |
| Vercel env APP_BASE_URL | cron.job / ClickSend rules | env:push → cron:apply → clicksend:setup | WIRED (live) | cron.job rows at custom origin; ClickSend read-back recorded |
| new default alias | `https://app.backdesk.com.au` | Vercel 308 | WIRED (live) | `curl -sI` → 308 + location |
| `push-vercel-env.mjs` | project backdesk | `--project backdesk` | WIRED | Tool-verified |
| Vercel env OPERATOR_ALERT_FROM | alert modules | `env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM` | WIRED | Env present by name; code path at 191/249 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `settings/email/page.tsx` | `record.status` → `statusBadge` | `await listDomains()` (Resend, line 150) compared to `VERIFIED_STATUS` (line 172) | Yes — live provider read, error branch at line 204 | ✓ FLOWING (render unobserved: human item) |
| Audit / report footers | `SERVICE_NAME` | brand constant | Static by design (a name) | ✓ n/a |
| `resend-sender.ts` From/identity line | `business` | `identity.businessName` → `displayName()` sanitiser | Yes | ✓ FLOWING |
| `cron-status.mjs` | job targets, response codes | `cron.job`, `net._http_response` | Yes — printed live today | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Brand + sender identification + unsubscribe + commercial pins | `npx vitest run tests/{brand,resend-sender,unsubscribe,clicksend-sender,audit-aggregate,attribution-baseline,resend-domains,email-settings-action,reporting-copy}.test.ts` | 9 files, 286 tests passed | ✓ PASS |
| Type + lint gates | `npm run typecheck`; `npm run lint` | both clean | ✓ PASS |
| Console live on custom domain | `curl -sI https://app.backdesk.com.au/login` | HTTP/2 200, syd1, HSTS | ✓ PASS |
| Public page unaffected by protection | `curl -sI https://app.backdesk.com.au/api/unsubscribe` | 200 | ✓ PASS |
| Old/new `*.vercel.app` aliases redirect | `curl -sI` × 4 | 308 → app.backdesk.com.au/login | ✓ PASS |
| Deployment URLs walled | `curl -sI` × 2 | 302 → vercel.com/sso-api + `_vercel_sso_nonce` | ✓ PASS |
| DNS: NS, CNAME, DKIM, MX, SPF, DMARC, apex A | `https://dns.google/resolve` | All Status 0, values as recorded | ✓ PASS |
| pg_cron ticks on the custom origin | `npm run cron:status` | 4 active, 200s 10:00–10:03Z, 0 lease rows | ✓ PASS |
| Vercel env presence (names only) | `vercel env ls production` | OPERATOR_ALERT_FROM, APP_BASE_URL present (Config) | ✓ PASS |
| Resend badge render | needs operator session | 307 → /login | ? SKIP → human |
| Commits cited in summaries | `verify.commits` × 19 | all valid | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and no plan declares a probe. Step 7c: not applicable.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| BRAND-01 | 08-01, 08-02 | Every surface identifies the service as Backdesk; no rendered "Quote Recovery" | ✓ SATISFIED | SC1 |
| BRAND-02 | 08-03 | Three assumptions confirmed, one config location, PROJECT.md records it | ✓ SATISFIED | SC3 |
| BRAND-03 | 08-02 | Sender identification names tradie as sender, Backdesk as service; opt-out unchanged | ✓ SATISFIED | SC2 |
| DOM-01 | 08-04, 08-05, 08-06 | Console at app.backdesk.com.au, syd1, default URL redirects | ✓ SATISFIED | SC4 (live 200 + four 308s + syd1) |
| DOM-02 | 08-06 | Protection re-enabled for previews without breaking ticks/public pages; documented | ✓ SATISFIED | SC4 (302+nonce on deployment URLs; ticks 200 after; DOM doc §6–§7) |
| DOM-03 | 08-04, 08-07 | quotes.backdesk.com.au verified at Resend, status visible in console, sending domain for cadence + alerts | ? NEEDS HUMAN | Records live; API status recorded; alerts configured; badge render open; cadence send deferred (DOM-04). `REQUIREMENTS.md` correctly still shows `[ ]` / Pending |

Orphaned requirements: none — REQUIREMENTS.md maps exactly BRAND-01..03 and DOM-01..03 to Phase 8, all claimed by plans. DOM-04 is mapped to Phase 10.

### Prohibitions (all judgment-tier — non-authoritative verdicts, human review recommended)

| Plan | Prohibition (abridged) | LLM-judge verdict | Evidence |
|------|------------------------|-------------------|----------|
| 08-01 | Never present Backdesk as the sender | holds | From/identity line name the tradie first; unsubscribe footer says "on behalf of" |
| 08-01 | No visual identity change (D-04) | holds | No CSS/layout commits since 2026-09-06 |
| 08-02 | Identity phrasings only via brand builders | holds | "Backdesk" appears in `src/` only in `brand.ts` and two comments in `resend-sender.ts` |
| 08-02 | Do not weaken displayName sanitiser or byte-identical unsubscribe page | holds | Sanitiser at line 174 runs before branding; oracle test green |
| 08-03 | No value change without recorded decision + matching docs/pins | holds | Values unchanged; pins untouched |
| 08-03 | No stored estimate under one rate beside another footnote | holds | Rate unchanged; fixture torn down 4 Sep |
| 08-04 | No DNS record created by the agent; never claim backdesk.vercel.app | holds | Records published by founder (recorded); `backdesk.vercel.app` referenced only as "not ours" |
| 08-04 | No A/CNAME on the apex | holds | Apex A = pre-existing Squarespace parking only |
| 08-05 | No rename/release in 08-05 | holds | Rename in 08-06 commit `99a48f9`, after 08-05's `6f04b20` |
| 08-05 | No `--activate` | holds (recorded) | 08-05 entry: "NOT arming the config row"; DB row state not readable here |
| 08-05 | No cron:apply during a lease; never test:remote | holds | Lease 0 before/after (recorded), 0 today; test:remote not run by executor or verifier |
| 08-06 | No All-Deployments scope or password on production | holds | Custom domain 200 anonymously; deployment type recorded as `prod_deployment_urls_and_all_previews` |
| 08-06 | No Protection Bypass secret introduced | holds | Repo-wide grep → none |
| 08-06 | No host-conditional redirect in next.config/proxy | holds | Files contain no redirect/host logic; no commits |
| 08-07 | No real cadence email sent; no messaging_config email row enabled | holds (recorded) | D-11; email-settings gate; DB state not readable here |
| 08-07 | No DMARC rua on another domain; not tighter than p=none | holds | `_dmarc.quotes` = `v=DMARC1; p=none;` no rua; apex rua is Google's, on the apex's own mailbox |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/placeholder in any file this phase modified | — | — |

Informational only:

- `main` is 3 commits ahead of `origin/main` (`ff9c630`, `720917e`, `a404402`, all docs-only). CI last ran green on `0344b85`, which contains every code change of the phase. Push when convenient.
- Working tree carries an uncommitted `.env.example` modification (not read here; the 08-02 summary asked the operator to mirror two example lines by hand and noted a pre-existing change from another workstream). `docs/env-vars.md` — the committed, mandatory mirror — has both lines (89, 102).
- `tests/inbound-threading.test.ts:120` builds fixture addresses at `@quote-recovery-test.invalid` — outside `src/`, invisible to customers, cosmetic.
- The 08-06 plan's inline verify string asserts the `-git-main-` alias answers 401; it measures 308 (deviation recorded honestly in §6). Not a defect in the phase; the plan text is stale.

### Human Verification Required

1. **Resend Verified badge on the console (the open DOM-03 clause)**
   **Test:** Log in and open https://app.backdesk.com.au/settings/email
   **Expected:** `quotes.backdesk.com.au` listed with badge "Verified", region `ap-northeast-1`, residency note unchanged, from-address placeholder `followups@quotes.backdesk.com.au`
   **Why human:** Rendered behind the operator login from a live Resend read; no session here. Once seen, DOM-03 can be marked complete.

2. **Supabase Auth URL Configuration**
   **Test:** Supabase dashboard → Authentication → URL Configuration
   **Expected:** Site URL and Redirect URLs name `https://app.backdesk.com.au` (or local defaults); none names `quote-recovery-mvp.vercel.app`
   **Why human:** Dashboard-only; not readable from the repo or CLI.

3. **Synthetic inbound row in the triage inbox**
   **Test:** Open the triage inbox on the console
   **Expected:** Exactly one unattributed row dated 2026-09-08 with ClickSend sample content; leave it (2026-08-29 precedent)
   **Why human:** Behind the operator login.

4. **First real operator alert From header (event-gated)**
   **Test:** When the first real alert arrives (or on the Phase 10 go-live checklist), read its From header
   **Expected:** `Backdesk <alerts@quotes.backdesk.com.au>`
   **Why human:** No alert condition exists and manufacturing one on production was correctly refused.

5. **Phone check — already closed by the founder 2026-09-08 (for the record only)**
   **Test:** https://app.backdesk.com.au/login on a phone
   **Expected:** No certificate warning; heading Backdesk; tab "Sign in · Backdesk"
   **Why human:** Handset certificate chain and rendered heading; recorded as done in 08-06 / STATE.md.

6. **Prohibitions review** — confirm the 16 non-authoritative verdicts in the table above.

### Gaps Summary

No gaps. Every roadmap success criterion is achieved in the codebase and live state except one clause of SC5 — the Verified badge rendering on `/settings/email` — which is an operator-session observation, not a missing implementation (the page reads Resend live and the underlying status and all four DNS records are proven). The live cadence-send clause of DOM-03 is deferred to Phase 10 (DOM-04) by decision D-11 and is not actionable here. The executor's choice to leave DOM-03 `Pending` in REQUIREMENTS.md is correct and should flip to complete once item 1 above is observed.

---

_Verified: 2026-09-08T10:10:00Z_
_Verifier: Claude (gsd-verifier)_

## Acknowledged Gaps

- **UAT test 4 — alert From header (`Backdesk <alerts@quotes.backdesk.com.au>`)** — skipped with reason on 2026-09-09: event-gated (the stalled digest sends nothing when empty; manufacturing an alert on the production database was refused). `OPERATOR_ALERT_FROM` is present in Vercel Production and the deployment followed the push. Carried to the Phase 10 go-live checklist (first real operator alert). Acknowledged by the operator during UAT; recorded so `phase uat-passed` reports the skip as a known deferral, not an unresolved test.
- **UAT test 2 — Supabase Auth URL Configuration** — passed (only the local default Site URL exists; nothing names the old host). Recommended non-blocking follow-up: Site URL `https://app.backdesk.com.au`, Redirect URLs `http://localhost:3000/**`.

