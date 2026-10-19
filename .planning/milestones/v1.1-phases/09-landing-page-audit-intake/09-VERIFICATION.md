---
phase: 09-landing-page-audit-intake
verified: 2026-09-09T10:31:00Z
status: passed
score: 107/123 must-haves verified
behavior_unverified: 2 # present + wired, real-provider / live-row behaviour never exercised on production (audit_requests rows: 0)
overrides_applied: 0
re_verification:
  previous_verified: 2026-09-09T09:40:00Z
  previous_status: gaps_found
  previous_score: 106/123
  gaps_closed:

    - "On backdesk.com.au, www.backdesk.com.au and 127.0.0.1, GET / is served as the public landing route with no Supabase call, and any non-marketing path (/inbox, /login, /audits/…) is rewritten to the branded root not-found page with a 404 status — never a redirect chain to the app host (D-02, research decision)"
  gaps_remaining: []
  regressions: []
  closing_commits: [3ab6e19, a295607, 4b73af1, 91412a7, abfc14f, be4d1ae, 68cbf10]
  production_deployment: backdesk-a2e7559xq
behavior_unverified_items:

  - truth: "ROADMAP SC3 — Within one minute of a submission the operator receives an email and an SMS, and the request is stored tenant-independently and visible in the console"
    test: "Signed out on the operator's phone, submit a real request on https://backdesk.com.au/audit with the operator's own mobile and email; note the submit time; then run `node scripts/audit-requests-count.mjs` and open app.backdesk.com.au/audits/requests"
    expected: "/audit/thanks renders; an email 'Backdesk · Audit request: <business>' and one SMS from the global from-number arrive on the operator inbox/handset within 60 s; the count reads 1 (baseline 0) with status=new email=sent sms=sent and a notified_at; the row is first in the console list with no notify-failed badge"
    why_human: "The senders are real providers (Resend, ClickSend) that no suite may call; the action-level tests prove ordering and outcome recording with mocked senders only. `audit_requests rows: 0` on the hosted DB at verification time means this path has never run on production."

  - truth: "A stored row is provable without the console: node scripts/audit-requests-count.mjs prints the audit_requests row count and the newest row's status and notify outcomes … and it rises by one per live submission (09-01)"
    test: "Run `node scripts/audit-requests-count.mjs` before and after the live submission above"
    expected: "Count rises from 0 to 1 and the newest-row line shows status and both notify outcomes, never a name, phone, email, hash or agent string"
    why_human: "The script ran read-only (prints `audit_requests rows: 0`) but 'rises by one per live submission' needs a live submission, which is a production write with real notifications"
human_verification:

  - test: "Live audit request from the operator's phone (JS on): submit on https://backdesk.com.au/audit with own mobile + email; record submit time, email arrival time, SMS arrival time; then `node scripts/audit-requests-count.mjs`; then open /audits/requests and /audits on app.backdesk.com.au"
    expected: "/audit/thanks; email + SMS within 60 s; count 1, status=new email=sent sms=sent; row listed newest-first with Perth received time, no notify-failed badge; /audits header shows 'Requests (1 new)'. Record both arrival times in 09-VALIDATION.md"
    why_human: "Real providers and a production write (SC3, LAND-03; 09-01 and 09-09 human-checks; 09-08 outstanding item 3)"

  - test: "Repeat one submission with JavaScript disabled in the phone browser"
    expected: "Native multipart POST lands on /audit/thanks; a second row and a second email + SMS"
    why_human: "Progressive-enhancement round trip needs a real browser with JS off (09-01 human-check)"

  - test: "Attach a small CSV on /audit and submit; then submit a .txt renamed .csv or a real .txt; optionally submit six times from one phone inside one hour"
    expected: "First: row shows 'CSV attached' in the list and Download CSV on the detail page. Second: the CSV type sentence, other values preserved, re-attach hint shown. Sixth: the rate-limit sentence over 200 with no email or SMS for it (the fifth is accepted)"
    why_human: "Bucket write and throttle counter on the hosted DB; visual placement of the re-attach hint and the off-screen decoy (09-03 human-check). Note the six-submission check produces five real rows and five real alert pairs"

  - test: "Console walkthrough on the phone, signed in: open the CSV request from /audits/requests → Download CSV → change status → Start audit → confirm the mapping step opens with the stored file → finish → back on the request detail"
    expected: "File downloads with the stored filename; status badge updates; audits/new arrives pre-filled (business name, source=csv, 'Using the file attached to the request', hint 'Pre-filled from the audit request by …'); mapping step behaves as for a manual CSV; request badge reads 'audited' and the primary action becomes 'Open audit' → /audits/{prospectId}; the stored object is gone AND the detail page now reads 'No file attached' with no Download CSV button (WR-05, abfc14f) — the list no longer says 'CSV attached'"
    why_human: "End-to-end through Storage, the staging path and two console screens on a live session (SC4, LAND-04; 09-06 human-check; 09-08 item 4)"

  - test: "Signed in on the phone, open https://app.backdesk.com.au/ ; then create a test client from /clients/new"
    expected: "The client list renders at / (URL bar still /); after creating a client the list refreshes with it; signed out, / redirects to /login"
    why_human: "The signed-out half is proven by curl (307 → /login); the signed-in rewrite path needs a session (09-04 human-check; 09-08 item 5)"

  - test: "On a phone, light AND dark scheme, at ~390 px: open https://backdesk.com.au/ , /audit, /audit/thanks, /privacy"
    expected: "Favicon on the tab; the lockup crisp in the header, switching to the Paper variant in dark, word ≥ 96 px wide, header 64 px; no sideways scroll on any page; the only green is the two 'Get the free audit' actions and the dollar figures; prices tabular and aligned; long headings, the guarantee paragraph, the privacy lists and the thanks paragraph wrap at the measure with no clipping; footer mailto: and tel: links work"
    why_human: "Visual render in both schemes (LAND-01 'fully usable on a phone', LAND-06 favicon; 09-05/09-08 items 1 and 7). Also closes the rendered-state backstops the probe left non-inferable: C-9 overflow/long-text, thanks overflow, C-4 overflow/long-text, /privacy no-data/overflow/zero-one-many"

  - test: "Paste https://backdesk.com.au into WhatsApp, iMessage and Slack"
    expected: "A card with the 1200×630 OG image (lockup on Paper with the tagline) and the title 'Backdesk · Quote chasing for Perth trade businesses'"
    why_human: "Link-preview rendering is done by each chat client (09-08 truth 4 and item 2, LAND-06). Note: the root https://backdesk.com.au/favicon.ico is 404 — some preview services fetch it as a fallback"

  - test: "Open /brand/og-image.png and /brand/apple-touch-icon.png on a phone and compare against D-06"
    expected: "OG image: Paper background, lockup left, tagline in Ink, backdesk.com.au small bottom-right in Slate; touch icon: the square mark, not green, no tagline inside the mark"
    why_human: "Visual conformance (09-02 human-check; 09-08 item 6)"

  - test: "Console request list and detail rendered states on the phone: with 0 rows (before the live submission) and with 1–2 rows; a 120-character single-word business name if one is submitted"
    expected: "Empty state sentence 'No audit requests yet. Requests from backdesk.com.au/audit appear here, newest first.'; rows wrap rather than widen the page; no visible loading flash; detail page wraps the long name and truncates the agent string to one line"
    why_human: "Backstops C-10 loading/partial/overflow and C-11 loading/long-text are rendered states a source scan cannot see (insufficient_spec)"

  - test: "Ratify the 27 must_haves.prohibitions (all judgment-tier) — see the Prohibitions table below for the non-authoritative LLM-judge verdict and evidence per item"
    expected: "Each prohibition marked resolved by the operator, or a follow-up filed"
    why_human: "Judgment-tier prohibitions are flagged unverified by construction (ADR-550 D4); the verifier's verdict is non-authoritative"
---

# Phase 9: Landing Page & Audit Intake Verification Report

**Phase Goal:** A prospect can find Backdesk, understand the offer, and request a free Quote Leakage Audit from their phone without an account — and that request reaches the operator's console and phone within a minute
**Verified:** 2026-09-09T10:31:00Z (re-verification; initial run 2026-09-09T09:40:00Z)
**Status:** human_needed (the one gap is closed and measured on production; the roadmap goal is achieved on every dimension a machine can measure, with the real-provider notification path still awaiting its first live run)
**Re-verification:** Yes — after gap closure (code-review fixer commits 3ab6e19 … 68cbf10, production deployment `backdesk-a2e7559xq`)
**Mode:** null (not an MVP-mode phase; standard goal-backward verification)

## Summary of what was actually checked

- Nine PLAN frontmatters (118 truths incl. 19 `[backstop]`, 27 prohibitions, 33 artifacts, 24 key links) merged with the five ROADMAP success criteria → 123 must-haves.
- `gsd-tools query verify.artifacts` / `verify.key-links` on all nine plans, then every reported failure re-checked by reading the file (six were tool false negatives; two were the documented `proxy.ts → src/proxy.ts` move; one a 54-vs-60-line threshold on a page whose content lives in `copy.ts`).
- Source read in full: `src/app/(marketing)/audit/actions.ts`, `form.tsx`, `layout.tsx`, `fonts.ts`, `robots.ts`, `sitemap.ts`, `src/core/intake/{audit-request,csv-sniff,throttle,ip-hash}.ts`, `src/core/alerts/operator-sms.ts` (+ the `audit_request` half of `operator-email.ts`), `src/core/brand.ts`, `src/db/schema/audit-requests.ts`, migration `0035`, `src/db/repository/{audit-requests,audit-uploads}.ts`, `src/proxy.ts`, `src/lib/supabase/proxy.ts`, the console list/detail/csv-route/status-action, the `audits/new` action's request branch and form pre-fill, the stalled-digest purge wiring.
- Live site: 22 `curl -sI` header proofs across apex, www, http, and app hosts; full HTML bodies of `/`, `/audit`, `/audit/thanks`, `/privacy`, `/login` (apex), `/inbox` (apex), `robots.txt`, `sitemap.xml`.
- DNS: Google + Cloudflare DoH for A/CNAME/MX and Node `dns.Resolver` against the authoritative `nsc1.squarespacedns.com` (216.239.32.108).
- Seven committed Lighthouse JSONs parsed for `requestedUrl`, version, form factor and scores.
- One bare vitest run over the 17 pure phase suites (736 tests, 8.4 s). No `ALLOW_REMOTE_TESTS`, no `test:remote`.
- Read-only hosted checks: `npm run cron:status`, `node scripts/audit-requests-count.mjs`.
- CI on the closing commit `862b204`: run 34335017668 completed success.
- Anti-pattern scan over the 62 phase-modified source files.

## Re-verification — what changed since 09:40 and what was re-checked

The initial run returned `gaps_found` on one plan truth (09-04 T2 / threat T-9-23): `https://backdesk.com.au/login` served the console sign-in form with HTTP/2 200. Since then the code-review fixer landed five source commits and two evidence commits, all on `main` (HEAD `68cbf10`, `main...origin/main` in sync, working tree clean under `src/` and `tests/`), deployed to production as `backdesk-a2e7559xq`. This run is a focused re-check, not a re-derivation: the failed truth got the full three-level treatment; the previously verified truths that the same commits could plausibly have disturbed were regression-probed; everything else carries forward from the 09:40 findings below, which are kept verbatim.

### The gap, three levels

| Level | Check | Result |
| --- | --- | --- |
| Exists | `src/proxy.ts` `config.matcher` no longer carries `login$\|login/`; the string is `'/((?!_next/static\|_next/image\|favicon.ico\|api/\|audit$\|audit/\|privacy$\|brand/\|robots.txt$\|sitemap.xml$).*)'` (read from the file, not the diff) | ✓ |
| Substantive | The `MARKETING_HOSTS` branch therefore sees `/login` and returns `NextResponse.rewrite('/__not_found', {status: 404})`; console hosts hand `/login` to `updateSession`, where `PUBLIC_PATHS = ['/login']` in `src/lib/supabase/proxy.ts` keeps the form open without a redirect | ✓ |
| Wired (tests) | `tests/proxy-host-routing.test.ts`: new `it.each` rows `[APEX_DOMAIN, '/login']` and `[www, '/login']` assert `isRewrite`, pathname `/__not_found`, `status 404`, `location` null, `updateSession` not called; `matches('/login') === true`; Next's own `unstable_doesMiddlewareMatch` runs the proxy for `/login`; console hosts reach the gate for `/login` with no rewrite; `PUBLIC_PATHS` pinned at source. `tests/sync-tick-route.test.ts` inverted its `/login` case. Ran: `npx vitest run proxy-host-routing sync-tick-route audit-request-notify audit-request-console cadence-tick-route` → 5 files, 211 tests passed (3.08 s); `-t login` on the routing suite → 7 passed. The seven suites that parse the matcher string (`cadence-tick-route`, `clicksend-dlr-route`, `clicksend-inbound-route`, `messaging-reconcile-route`, `proxy-host-routing`, `sync-tick-route`, `unsubscribe`) still find exactly one single-string matcher | ✓ |
| Live (this verifier's own curl, 2026-09-09 ~10:29 UTC) | `https://backdesk.com.au/login` → **HTTP/2 404**, `content-type: text/html`, **no `location` header**, **no `set-cookie`**, body `<title>Page not found · Backdesk</title>` with `<meta name="robots" content="noindex">`, served from `syd1`. `https://www.backdesk.com.au/login` → 308 → `https://backdesk.com.au/login` (Vercel's www redirect, unchanged) → 404. `https://app.backdesk.com.au/login` → **HTTP/2 200**, `<title>Sign in · Backdesk</title>`, `type="password"` input present — the operator's door is intact | ✓ |
| Evidence docs | `docs/external-registrations.md` gained a dated append-only entry with the seven-probe table and the `x-vercel-id`; `docs/vercel-domains-and-protection.md` §9 gained three measured rows and the account of the cause (`be4d1ae`). `09-REVIEW.md` marks WR-01 fixed with the commit (`68cbf10`) | ✓ |

Truth 09-04 T2 → ✓ VERIFIED. Prohibition 09-04 "never redirect apex console paths; apex answers 404" → holds in full (was "holds literally / intent partial").

### Regression probes on truths the fixer commits touched

| Commit | What it changed | Truths at risk | Re-check | Result |
| --- | --- | --- | --- | --- |
| `3ab6e19` WR-01 | matcher string | 09-01 T5 (public paths unmatched), 09-04 T1/T3, 09-08 T1, cron exemption (Pitfall 7) | Live: apex `/` 200, `/audit` 200, `/audit/thanks` 200, `/privacy` 200, `/robots.txt` 200 (still `Disallow: /login`), `/sitemap.xml` 200, `/brand/og-image.png` 200, `/inbox` 404, `/audits/requests` 404; app `/` 307 → `/login`, app `/inbox` 307, app `/audits/requests` 307; www `/` 308 → apex. `api/` exclusion untouched (sync-tick suite passes) | no regression |
| `a295607` WR-02 | `alertSubject` strips control chars for all three kinds | 09-01 T3 notify; sync alert subjects | notify suite: "leaves the two sync subjects exactly as they were" + "strips controls from the sync subjects as well" + "strips control characters out of a header-injection attempt" (now asserts the subject) pass | no regression |
| `4b73af1` WR-03 | `normalizeForGsm7` inside `cut`, before the cap | 09-01 T3 SMS one-segment claim | notify suite counts the raw return: "renders the locked shape and stays inside one segment", "repairs smart punctuation so a real name still costs one segment", and the honest residual "still flips to UCS-2 for a character with no GSM-7 lookalike" pass | no regression; the one-segment claim is now measured on the string actually sent |
| `91412a7` WR-04 | `stripControlCharacters` hoisted to `src/core/intake/audit-request.ts` (exported, line 162); both notifiers import it | 09-01 T7 "nothing normalises a business name on the way in" | `grep` shows the only `[\u0000-\u001f\u007f-\u009f]` spelling in the alerts path is the exported helper; it is called only from `alertSubject`, `auditRequestAlertBody` (`const clean = stripControlCharacters`) and the SMS `cut` — never inside `auditRequestSchema`, so the row still keeps what was typed. (`src/core/messaging/resend-sender.ts:180` carries a similar but separate regex for tenant email subjects — pre-existing, not this phase's alert path.) Tests "takes no newlines or control characters from a name (WR-04)" / "collapses a control-only name to empty" pass | no regression |
| `abfc14f` WR-05 | `convertRequest` calls `clearAuditRequestCsv(requestId)` guarded on `deleteAuditUpload` returning `true` | SC4 conversion path, 09-06 T-conversion | `clearAuditRequestCsv` now has two call sites (`audits/new/actions.ts:107` and the purge at `audit-uploads.ts:181`); console suite: "leaves the row pointing at the object when the delete fails", "decides the download on the object path, not the filename or the size", the API-key and own-file branches clear nothing — all pass. Dead `Download CSV` after conversion is gone by construction | no regression; SC4 walkthrough expectation updated: after Start audit the detail page reads "No file attached" rather than a 404-ing button |
| all | type soundness | — | `npx tsc --noEmit -p .` exit 0 | ✓ |

Hosted DB (read-only): `node scripts/audit-requests-count.mjs` → `audit_requests rows: 0` — unchanged, so SC3's live-provider minute is still unexercised and the two behaviour-unverified truths and the ten human items stand as written.

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria (the contract)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| SC1 | Prospect on a phone at https://backdesk.com.au (www redirecting) reads positioning, how it works, the two tiers and pricing, the 90-day guarantee, AU data-residency and compliance notes | ✓ VERIFIED (phone render → human) | `https://backdesk.com.au/` HTTP/2 200 from `syd1`; `https://www.backdesk.com.au/` 308 → apex; `http://` 308 → https; HSTS on both. Live body in D-09 order: h1 tagline, positioning lede with "Run by AI, checked by a human" once, four numbered steps, Quote Chaser $597 / Pipeline Manager $997, Setup $990, Founding five $297 × 3 months, "The guarantee, precisely" (3× in 90 days), "Your customers, your name" with the Sydney/offshore sentence and the /privacy link, "A good fit", "How to start", footer identity line. Lighthouse 13.4.1 mobile a11y 100/100 ×7. The visual phone read in both schemes is a human item |
| SC2 | Prospect submits business name, contact name, phone, email, trade, ServiceM8 yes/no, quotes per month, optional CSV — without logging in — and sees a confirmation; honeypot / over-limit IP refused without a stored request | ✓ VERIFIED | Live `/audit` form (no session, apex and app host both 200): inputs `business_name` (maxLength 120), `contact_name` (80), `phone` tel, `email`, `trade` select (9 options), `servicem8` radios yes/no, `quotes_per_month` select (4 bands), `csv_file` (`.csv,text/csv`, no `required`), off-screen `website` decoy (`aria-hidden`, `tabindex=-1`, `.hp{left:-10000px}`), consent line linking `/privacy`. `actions.ts` has no `requireOperator()` by design; order decoy → zod → bump → insert → upload → notify → record → redirect. Behavioural tests pass: decoy "redirects exactly as a success does, having written nothing", "exits before validation", "logs nothing at all"; throttle "refuses the sixth … over a 200 re-render", "accepts the fifth", "bumps before the insert"; `/audit/thanks` live 200, noindex |
| SC3 | Within one minute the operator receives an email and an SMS; request stored tenant-independently (service-role write, RLS-safe) and visible in the console | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Storage half verified: migration 0035 live (journal 36, `db:migrate` no-op re-run recorded), no `tenant_id` column, `is_operator()` policy, REVOKE-then-GRANT (anon/authenticated SELECT only, no INSERT; throttle table service-role only), FK to `prospects` only. Notify half wired: `Promise.allSettled([sendOperatorAlert{kind:'audit_request'}, sendOperatorSms])` inside the same request, row written first (test "writes the row BEFORE it attempts either notification"), recipient fixed to `OPERATOR_ALERT_PHONE` / `OPERATOR_ALERT_EMAIL` from env, global sms from-number read ignoring `enabled` (test "sends from the global row even when that row is DISARMED"). Console list reads via `createClient()` under RLS. BUT `node scripts/audit-requests-count.mjs` → `audit_requests rows: 0`: no live submission has ever exercised Resend + ClickSend on production. Real arrival within 60 s cannot be shown by a mocked test → human |
| SC4 | Operator opens the request in the console and starts a Quote Leakage Audit pre-filled in audits/new — CSV path when a file was uploaded, API-key path otherwise | ✓ VERIFIED (phone walkthrough → human) | `audits/requests/[id]/page.tsx` renders every field, Perth received time, per-channel notify outcome with error kind, Download CSV or "No file attached", `StatusForm`, and `Start audit` → `/audits/new?request={id}` (or `Open audit` after conversion). `audits/new/page.tsx` reads the request under RLS, picks `source: csv_object_path ? 'csv' : 'api_key'`, renders the hint; `form.tsx` carries `<input type="hidden" name="request_id">` and "Using the file attached to the request". `actions.ts` reads `request_id` after `requireOperator()`, feeds the stored object through the unchanged `stageCsvUpload`, and `convertRequest` → `markAuditRequestConverted` (guarded `converted_prospect_id IS NULL`) + `deleteAuditUpload`. Test "reads the object, parses it through the staging path, and lands on mapping" passes. CSV route: `requireOperator()` first, 404 for every denial, `attachment` + `nosniff` + `private, no-store` (tests 640–735) |
| SC5 | Privacy notice page and contact details (ABN, email, Perth address or PO box) linked from the form before submission; Lighthouse ≥ 90 perf + a11y mobile; correct title, description, OG image, favicon | ✓ VERIFIED | Live `/privacy`: h1 + seven h2 (collect / why / where / processors / retention / access / contact), "operated by Hesam Abbaszadi, Perth WA. ABN 00 000 000 000", Supabase Sydney, Resend/ClickSend/Anthropic offshore, explicit "does not claim full Australian data residency", 30-day CSV retention, access/correction, hello@backdesk.com.au and 0491 578 888. Form consent line: `<a href="/privacy">privacy notice</a>` directly above the submit button. Footer on every public page: `Backdesk · ABN 00 000 000 000 · Perth WA · hello@backdesk.com.au · 0491 578 888`. Lighthouse 13.4.1 mobile, all `requestedUrl` on `https://backdesk.com.au/…`: home 99/97/97 perf, 100 a11y ×3; audit 98/98/98, 100 ×3; post-copy confirm 99/100. `<title>Backdesk · Quote chasing for Perth trade businesses</title>`, description, `og:image https://backdesk.com.au/brand/og-image.png` 1200×630, `twitter:card summary_large_image`, `<link rel=icon>` svg + ico + apple-touch-icon — all four assets HTTP/2 200 with correct content-types |

### Observable Truths — PLAN must-haves (grouped; only deviations, failures and non-inferable items itemised)

| Plan | Truths | Verified | Failed | Behaviour-unverified | Uncertain / insufficient_spec | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 09-01 | 23 (3 backstop) | 19 | 0 | 1 | 3 | T4 "rises by one per live submission" → behaviour-unverified (count 0). Backstops C-9 overflow, C-9 long-text, thanks overflow → insufficient_spec (rendered state). T1 submit→thanks, T2 row-first, T3 notify+record, T5 matcher (test + live: apex `/audit` 200, app `/audits/requests` 307), T6 all-fields-at-once (test "returns every failing field and echoes the input back"), T7 code-point caps 120/80 with `.trim()` and no normalisation, T8 nothing dedupes (read: no dedupe key; throttle bounds), T9 inline notify (construction + ordering test), E7/E8/E9 states (form.tsx: `fieldset disabled={pending}`, `aria-busy`, `p.field-error role=alert`, `aria-describedby`, `noValidate`, native multipart POST) ✓ |
| 09-02 | 10 | 10 | 0 | 0 | 0 | `brand.ts`: 17 exports incl. `BUSINESS_ABN='00 000 000 000'`, `footerIdentityLine()` array/filter/join, no imports; used by audit sheet (`audits/[id]/page.tsx:298`), monthly report (`reports/.../page.tsx:408`) and marketing layout. `globals.css` ten M1 tokens in `:root` and the dark block, `--accent-fg` on `button`/`.button` (brand-tokens tests pass). `tabular-nums` in audit.css, report.css, marketing.css. `public/brand/` holds lockup, both wordmarks, mark svg, favicon.svg/.ico, apple-touch-icon, og-image (brand-assets tests: 1200×630, 180×180, three-raster ICO). `src/app/favicon.ico` gone; root layout `icons` → `/brand/*`. `logo/` tracked (7 files — 09-05 added the two transparent variants, recorded) |
| 09-03 | 10 | 10 | 0 | 0 | 0 | `sniffCsv`: `.csv` suffix, permissive MIME allowlist, size before parse, `Papa.parse preview:1`, ≥ 2 columns; `AUDIT_CSV_MAX_BYTES = 4 MiB`, `bodySizeLimit '4400kb'`, bucket `file_size_limit 4194304` (cap-4mib checkpoint, recorded deviation from D-10's 5 MB). Upload after insert, failure survived (tests 319–396). Honeypot tests 416–456. Throttle: `INSERT … ON CONFLICT DO UPDATE RETURNING hits`, `date_trunc('hour', now())`, `hits > 5` refuses, bump before insert, null IP not throttled, counter outage refuses (tests 464–562). `hashClientIp` sha256(salt:ip), IPv6 /64, first `x-forwarded-for`. `purgeExpiredAuditUploads` object-then-row, throttle sweep, called from `stalled-digest/route.ts:112` (cron `stalled-digest 30 22 * * *` active) |
| 09-04 | 5 | 5 | 0 | 0 | 0 | T2 ✓ on re-verification: apex and www `/login` → 404 rewrite, no `location`, no cookie; app `/login` 200 (commit 3ab6e19, measured live 10:29 UTC — was FAILED-partial at 09:40, see Re-verification). T1: app `/` → 307 `/login` signed out (live); `updateSession(request,{rewriteTo:'/clients'})` rebuilt in both places (test). T3: one-string matcher, three suites parse it; `getClaims()` gate; `requireOperator()` in every mutating action. T4: `revalidatePath('/clients')` in `clients/new/actions.ts:134` and `audits/[id]/actions.ts:70`; console brand link `href="/"`. T5: `src/app/not-found.tsx` (39 lines) — apex `/inbox` and `/zzz-nope` render "Page not found · Backdesk" with HTTP/2 404. Artifact `proxy.ts` now at `src/proxy.ts` (09-04 deviation: Next 16 only loads it beside `app/`; test "lives at src/proxy.ts, beside app/" + "has no leftover copy at the repo root"; `next build` prints "ƒ Proxy (Middleware)"; live 307/404 behaviour proves it runs) |
| 09-05 | 40 (9 backstop) | 33 | 0 | 0 | 7 | T1 D-09 order observed live (h1 + six h2 in order). T2 copy contract: marketing-copy suite passes (forbidden list, one disclosure phrase, no em dash, no competitor domain, four figures). T3 one green action per page (test "renders the one green action twice and nothing else green"). T4 `next/font/google` Inter 400/600/700 + Inter Tight 700, `display:swap`, variables on the marketing wrapper div only. T5 header lockup: **documented deviation** — the opaque 164×60 `lockup.png` was replaced by the two transparent variants in a `<picture>` at 147×28 (word ≈ 118 px ≥ 96 px floor, brand-assets test "switches the header lockup on the colour scheme, at the D-06 word size"); intent met. T6 privacy notice: seven h2, Sydney, three offshore processors, 30-day retention, contact line (privacy-page suite). T7 metadata: absolute home title, `/audit` template title, `/audit/thanks` `robots noindex`, robots.txt allows `/ /audit /privacy` and disallows console paths, sitemap.xml lists exactly the three apex URLs (observed live + marketing-metadata suite). Backstops: /privacy populated and /privacy partial ✓ (privacy-page "every section says something"), C-4 partial and C-5 partial ✓ (marketing-copy "lists four steps and two tiers"); C-4 overflow, C-4 long-text, /privacy no-data, /privacy overflow, /privacy zero-one-many → insufficient_spec (rendered state) |
| 09-06 | 11 (3 backstop) | 9 | 0 | 0 | 2 | T1–T6 verified by source + audit-request-console suite (status action refuses non-operator/no session/malformed id/bad status and revalidates both surfaces; CSV route four 404 cases, headers, filename re-sanitised; `markAuditRequestConverted` once-only; expired-CSV fallback to `api_key` with hint). E12 empty (unknown id → `notFound()`), E12 partial ("No file attached") ✓. Backstop C-11 error ✓ (test "reports a failed read without leaking, and logs the code"); C-11 loading and C-11 long-text → insufficient_spec |
| 09-07 | 3 | 3 | 0 | 0 | 0 | §9 documents the rank-1 pair `216.198.79.1` + `64.29.17.1` and CNAME `956ea6eb7ab36544.vercel-dns-017.com.` read back after attaching, the five Squarespace defaults to delete and the eleven do-not-touch rows; `docs/external-registrations.md` carries `recommendedIPv4` config JSON verbatim. Today's read-back: authoritative nsc1 A = exactly that pair; CNAME www = that target; MX `1 smtp.google.com` intact; CNAME app unchanged; Google + Cloudflare DoH agree. Decision checkpoint (`cut-over-now`, commit 0825469) and human-action checkpoint recorded |
| 09-08 | 5 | 4 | 0 | 0 | 1 | T1 re-measured live now: apex 200 `syd1`, www 308 → apex, http 308 → https, `/inbox` 404, `/audit` 200 on both hosts, app `/` 307 → `/login` ✓. T2 DoH/authoritative read-backs ✓. T3 Lighthouse: 7 JSONs, 13.4.1 mobile, every `requestedUrl` on the apex, medians 97/100 and 98/100 ✓; recorded in 09-VALIDATION.md. T4 OG preview / favicon on tab → UNCERTAIN (human). T5 copy request applied (six strings live: eyebrow "Perth · ServiceM8 trade businesses", "No lock-in. No lead generation.", "Do you use ServiceM8?", "Quotes sent per month, roughly", "ServiceM8 export (optional)", "Send the audit request"); marketing-copy suite still passes; four coupled conflicts recorded |
| 09-09 | 11 (4 backstop) | 8 | 0 | 0 | 3 | List page: `createClient()` (anon + cookie), `REQUEST_COLUMNS` names ten columns with no `user_agent`/`ip_hash`, no repository import, newest-first with id tiebreak, `notify failed` badge on either channel `failed`, fixed error sentence + `error.code` log, empty-state sentence verbatim, `.touch-list` not a table; `/audits` header `Requests (N new)` only when N > 0. Live: app `/audits/requests` 307 → login signed out; apex 404. Backstop C-10 error ✓ (tests 213/218); C-10 loading, C-10 partial, C-10 overflow → insufficient_spec |

**Score:** 107/123 truths verified (2 present, behaviour-unverified; 0 FAILED; 1 UNCERTAIN; 13 backstops abstained as insufficient_spec) — was 106/123 with 1 FAILED-partial at 09:40

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/db/schema/audit-requests.ts`, `src/db/migrations/0035_phase9_audit_requests.sql` | tables, CHECKs, RLS, grants, bucket | ✓ VERIFIED | Read in full; live (journal 36; `setup-storage.mjs --check` recorded `audit-uploads public=false`) |
| `src/db/repository/audit-requests.ts` (11 fns), `audit-uploads.ts` (4 fns) | service-role write/read, purge | ✓ VERIFIED | No `tenantId` anywhere; exported via the barrel only; `getDb()` / service-role storage client |
| `src/core/intake/{audit-request,csv-sniff,throttle,ip-hash}.ts` | pure schema/decisions | ✓ VERIFIED | Wired into `actions.ts`; suites pass |
| `src/core/alerts/operator-sms.ts`, `operator-email.ts` kind `audit_request` | never-throw senders to env-fixed recipients | ✓ VERIFIED | `getChannelConfig('sms')` ignoring `enabled`; `customString audit-request:{id}` |
| `src/app/(marketing)/{layout,copy,page,fonts,marketing.css}`, `audit/{page,form,actions,action-state,field-error}`, `audit/thanks/page`, `privacy/page` | public site | ✓ VERIFIED | Live on the apex; `privacy/page.tsx` is 54 lines (< the 60-line threshold) because the notice text lives in `copy.ts` — not a stub (seven populated sections observed live) |
| `src/app/robots.ts`, `src/app/sitemap.ts` | crawl rules | ✓ VERIFIED | Live output matches |
| `src/core/brand.ts` | ABN/contact constants + builder | ✓ VERIFIED | 17 exports, import-free; three footers use it |
| `public/brand/*` (10 files), `logo/*` (7 tracked) | supplied assets | ✓ VERIFIED | All four icon/OG assets 200 on the apex |
| `proxy.ts` (plan path) → `src/proxy.ts` (actual) | host-aware proxy | ✓ VERIFIED (moved) | Documented 09-04 deviation; running in production |
| `src/lib/supabase/proxy.ts` | `updateSession(request,{rewriteTo})` | ✓ VERIFIED | Rewrite rebuilt inside `setAll` |
| `src/app/not-found.tsx`, `src/app/(console)/clients/page.tsx` | branded 404, moved list | ✓ VERIFIED | 39 / 259 lines; 404 observed live |
| `src/app/(console)/audits/requests/page.tsx`, `[id]/page.tsx`, `[id]/csv/route.ts`, `[id]/actions.ts`, `[id]/status-form.tsx` | console surfaces | ✓ VERIFIED | Gated by proxy (307 live) + layout + `requireOperator()` |
| `src/app/(console)/audits/new/{actions,page,form}.tsx` | pre-fill + conversion | ✓ VERIFIED | `request_id` hidden input; `convertRequest` |
| `next.config.ts` `bodySizeLimit: '4400kb'` | platform cap | ✓ VERIFIED | Pinned by audit-request-csv test |
| `scripts/audit-requests-count.mjs` | read-only proof | ✓ VERIFIED | Ran: `audit_requests rows: 0` |
| `docs/vercel-domains-and-protection.md` §9, `docs/external-registrations.md` (2026-09-09 ×5 entries), `docs/lighthouse/README.md` + 7 JSON | evidence | ✓ VERIFIED | Measured column filled; JSONs parsed |
| `tests/*` — 17 pure suites + `rls-coverage`, `audit-request-repository` (CI) | pins | ✓ VERIFIED | 736 pass locally; CI 34335017668 success |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `audit/actions.ts` | `@/db/repository` | barrel import of `createAuditRequest`, `bumpAuditRequestThrottle`, `putAuditUpload`, `attachAuditRequestCsv`, `recordAuditRequestNotify` | WIRED | Read; test "imports the repository through the barrel and never the tenant closure" |
| `audit/actions.ts` | `operator-sms.ts` / `operator-email.ts` | `Promise.allSettled([...])` | WIRED | Present at the notify step (tool reported "not found" — false negative; the literal is on the `const [emailSettled, smsSettled] = await Promise.allSettled([` line) |
| `operator-sms.ts` | `messaging-config` repository | `getChannelConfig('sms')` | WIRED | Present; `enabled` not read (tool false negative) |
| `src/proxy.ts` matcher | `(marketing)/audit/page.tsx` | `audit$|audit/` exclusion | WIRED | Live: `/audit` 200 on both hosts with no session |
| `src/proxy.ts` | `src/lib/supabase/proxy.ts` | `updateSession(request, { rewriteTo: '/clients' })` | WIRED | Live app `/` → 307 `/login` |
| `src/proxy.ts` | `src/core/brand.ts` | `APEX_DOMAIN` in `MARKETING_HOSTS` | WIRED | Live apex `/inbox` → 404 |
| `clients/new/actions.ts` | `clients/page.tsx` | `revalidatePath('/clients')` | WIRED | Line 134 (tool false negative) |
| `(marketing)/layout.tsx` | `brand.ts` | `footerIdentityLine(BUSINESS_ABN).split(' · ')` | WIRED | Line 77; footer observed live (tool false negative) |
| `(marketing)/layout.tsx` | `fonts.ts` | `inter.variable`, `interTight.variable` | WIRED | Wrapper div class (tool false negative) |
| `(marketing)/page.tsx` | `copy.ts` | `LANDING_COPY` | WIRED | Tool verified |
| `(marketing)/layout.tsx` | `/brand/og-image.png` | `metadata.openGraph.images` with `metadataBase` apex | WIRED | Absolute URL observed live |
| `stalled-digest/route.ts` | `audit-uploads.ts` | `purgeExpiredAuditUploads()` | WIRED | Line 112; cron job active |
| `audits/[id]/page.tsx`, `reports/.../page.tsx` | `brand.ts` | `footerIdentityLine` | WIRED | Lines 298 / 408 |
| `layout.tsx` (root) | `/brand/favicon.svg` | `metadata.icons` | WIRED | Live `<link rel=icon>` |
| `audits/requests/page.tsx` | `@/lib/supabase/server` | `createClient()` | WIRED | Line `const supabase = await createClient();` (tool false negative) |
| `audits/page.tsx` | `/audits/requests` | `Requests (N new)` link | WIRED | Line 115 |
| `requests/[id]/csv/route.ts` | `_auth` | `requireOperator()` first statement | WIRED | Tool verified + test "checks the allowlist before it awaits params" |
| `audits/new/actions.ts` | `audit-uploads.ts` | `getAuditUpload` → `stageCsvUpload` | WIRED | Tool verified + behavioural test |
| `docs/external-registrations.md` | Vercel config | `recommendedIPv4`, `HTTP/2 200` | WIRED | Tool verified; matches today's DNS/HTTP |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| `(marketing)/page.tsx` | `LANDING_COPY` | static module | static by design (prerendered public copy, pinned by test) | ✓ FLOWING (static is the requirement — no env, no DB) |
| `audit/actions.ts` → DB | `createAuditRequest(...)` | `getDb()` service-role insert `.returning()` | yes | ✓ FLOWING (mocked in tests; production write never yet triggered) |
| `audit/actions.ts` → operator | `sendOperatorAlert`, `sendOperatorSms` | Resend / ClickSend via env + global `messaging_config` row | yes when providers answer | ⚠️ present, unexercised on production |
| `audits/requests/page.tsx` | `data` | `supabase.from('audit_requests').select(REQUEST_COLUMNS)` under RLS | yes (empty today) | ✓ FLOWING |
| `audits/requests/[id]/page.tsx` | `request` | RLS `.maybeSingle()` | yes | ✓ FLOWING |
| `[id]/csv/route.ts` | `blob` | `getAuditUpload(csvObjectPath)` service-role Storage | yes | ✓ FLOWING |
| `audits/new/page.tsx` → `form.tsx` | `initial` | RLS read of the request → props (`requestId`, `source`, `csvFilename`) | yes | ✓ FLOWING |
| `scripts/audit-requests-count.mjs` | count | hosted DB read-only | yes (`0`) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Public host proofs | `curl -sI` on 22 URLs (apex/www/http/app) | apex `/` 200 syd1; www 308; http 308; `/inbox` 404; `/audits/requests` 404 (apex) / 307 (app); `/audit` 200 ×2; `/audit/thanks` 200; `/privacy` 200 ×2; robots/sitemap 200; four `/brand/*` 200; app `/` 307 `/login`; app `/clients` 307; apex `/login` **404 on re-verification** (was 200; rewrite, no `location`, no `set-cookie`, branded 404 body); root `/favicon.ico` 404 | ✓ PASS (only the favicon fallback row remains a warning) |
| Landing content + metadata | fetch `/` body, strip tags | every D-09 section, prices, guarantee, residency sentence, ABN footer; no external `src`/`href`; title/description/OG/twitter/icons correct | ✓ PASS |
| Form fields | fetch `/audit` body | all eight controls + decoy + consent link + "CSV only, up to 4 MB" | ✓ PASS |
| DNS | DoH Google + Cloudflare; Node resolver → nsc1 | A = `64.29.17.1`, `216.198.79.1` on all three; CNAME www = `956ea6eb7ab36544.vercel-dns-017.com`; MX `1 smtp.google.com`; CNAME app unchanged | ✓ PASS |
| Lighthouse evidence | parse 7 JSON | all `https://backdesk.com.au/…`, 13.4.1, mobile, perf ≥ 97, a11y 100 | ✓ PASS |
| Pure suites (single run, 09:40) | `npx vitest run <17 files>` | 17 files, 736 tests passed, 8.40 s | ✓ PASS |
| Affected suites after the fixer commits (re-verification) | `npx vitest run` proxy-host-routing, sync-tick-route, audit-request-notify, audit-request-console, cadence-tick-route | 5 files, 211 tests passed, 3.08 s; `tsc --noEmit` exit 0 | ✓ PASS |
| Hosted DB (read-only) | `npm run cron:status`; `node scripts/audit-requests-count.mjs` | lease 0, watchdog no, four jobs active, last five ticks 200; `audit_requests rows: 0` | ✓ PASS (and proves no live submission yet) |
| CI on closing commit | `gh run list` | 34335017668 completed success (main, 862b204) | ✓ PASS |
| CI on the fixer commits (re-verification) | `gh run list` | 34338448274 (abfc14f) and 34339647904 (68cbf10, HEAD) both completed success on main | ✓ PASS |
| Live honeypot / sixth-submission / real notification | — | not run: production writes with real SMS/email side effects | ? SKIP → human |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and no PLAN/SUMMARY declares one. The phase's "proofs" are the curl/DoH/Lighthouse checks, all re-executed above in this verifier's own process rather than taken from 09-07/09-08's narration.

| Probe | Command | Result | Status |
| --- | --- | --- | --- |
| (none declared) | — | — | n/a |

### Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| LAND-01 | 09-02, 09-04, 09-05, 09-07, 09-08 | Public landing page at backdesk.com.au (www redirecting) with the offer, usable on a phone | ✓ SATISFIED (phone render → human) | SC1 row; today's HTTPS 200/308 proofs and DNS. Note 09-08's finding: LAND-01 and LAND-06 were ticked in 09-02 before the apex resolved; judged on today's evidence they are earned. The plan-level truth that was unmet at 09:40 (apex `/login` 404) is now met and measured live (3ab6e19) |
| LAND-02 | 09-01, 09-03 | Request without login via the eight-field form + optional CSV | ✓ SATISFIED | SC2 row |
| LAND-03 | 09-01, 09-03, 09-09 | Stored tenant-independently, service-role, RLS-safe; email + SMS within one minute; honeypot + per-IP limit | ✓ SATISFIED structurally / ? NEEDS HUMAN for the live minute | SC3 row; storage, gating, honeypot and throttle proven; real-provider timing unexercised (rows: 0) |
| LAND-04 | 09-06 | Open request in console, start pre-filled audit (CSV vs API-key path) | ✓ SATISFIED (walkthrough → human) | SC4 row |
| LAND-05 | 09-02, 09-05 | Privacy notice + contact details (ABN, email, Perth address) linked before submission | ✓ SATISFIED | SC5 row; "Perth WA" is the suburb-level address D-16 chose |
| LAND-06 | 09-02, 09-05, 09-08 | Lighthouse ≥ 90 perf + a11y mobile; title, description, OG image, favicon | ✓ SATISFIED (preview render → human) | SC5 row. Root `/favicon.ico` 404 is a fallback gap only; every page's `<link rel=icon>` serves |

Orphaned requirements: none — REQUIREMENTS.md maps exactly LAND-01..06 to Phase 9 and every one is claimed by at least one plan.

### Prohibitions (27, all judgment-tier — non-authoritative LLM-judge verdict; `unverified-prohibition — human review recommended`)

| Plan | Statement (abridged) | Judge | Evidence |
| --- | --- | --- | --- |
| 09-01 | No account/login/CAPTCHA to submit | holds | `actions.ts` has no `requireOperator()`; no captcha markup; `/audit` 200 without a session |
| 09-01 | Never refuse for lacking the CSV | holds | `csv_file` not `required`; action `file ? sniff : skip`; copy says optional |
| 09-01 | Never store/log raw IP or body | holds | `hashClientIp`; logs carry error names only; test "never lets the raw address reach the row or the log" |
| 09-01 | Never lose a request on notify failure | holds | Row first; `Promise.allSettled`; tests 170/196/230 |
| 09-01 | Text/email only the operator | holds | `sendOperatorSms` takes no recipient; `OPERATOR_ALERT_PHONE`/`_EMAIL` from env |
| 09-01 | Public action touches audit_requests only | holds | Five barrel imports, all audit-request/upload family; structural test |
| 09-02 | No placeholder ABN | holds | Real constant; builder drops the segment on null |
| 09-02 | Wordmark/lockup never green, no tagline in mark, no shadow/gradient | holds (structural) | `.wordmark{color:var(--fg)}`; lockup is the supplied PNG; "nothing else green" test; visual → human |
| 09-02 | OG/favicon only from static `/brand/*` | holds | Metadata paths; four assets 200 static |
| 09-03 | No public/signed URL or storage.objects policy for CSVs | holds | No `createSignedUrl`/`getPublicUrl` in `src/`; bucket `public=false`; migration creates no `storage.objects` policy |
| 09-03 | Honeypot: no notify, row or bump; indistinguishable response | holds | Tests 416–456 |
| 09-03 | CSV never kept past 30 days or conversion; purge scheduled | holds | `csv_purge_after` stamped in the one writer; `purgeExpiredAuditUploads` on the daily tick (active); `convertRequest` deletes the object |
| 09-04 | No security decision on the host header | holds | Proxy classifies public-vs-wall only; layout `getClaims()`; actions `requireOperator()` |
| 09-04 | Never redirect apex console paths to the app host; apex answers 404 | holds | `/inbox`, `/audits/*`, and since 3ab6e19 `/login` → 404 rewrite with no `location` (re-measured live on re-verification) |
| 09-05 | No forbidden words, competitor names, "software the tradie operates" | holds | marketing-copy suite |
| 09-05 | No dollar figure as a promise | holds | List prices, "estimated recoverable range", guarantee phrased as fee relief; test "never presents a dollar figure as a ceiling" |
| 09-05 | No third-party script, analytics, runtime font, external image | holds (observed) | Live `/` has zero non-apex `src`/`href`; fonts self-hosted at build |
| 09-05 | No full-AU-residency claim; names Sydney + the three offshore processors | holds (observed) | Landing sentence and privacy §"Who else processes it" live |
| 09-06 | No request row flows into a cadence | holds | Repository has no tenant path; only FK is `converted_prospect_id → prospects` |
| 09-06 | Never pre-fill/echo/store the ServiceM8 API key | holds | No key column; `api_key` read from operator's form only |
| 09-06 | Serve a stored CSV only to an operator session | holds | Route 404s every denial; tests |
| 09-07 | Never instruct touching MX/SPF/DKIM/DMARC/site-verification/app/quotes.* | holds | §9 do-not-touch table; today's MX and app CNAME intact |
| 09-07 | Never paste a remembered generic Vercel address | holds | Rank-1 pair read back post-attach (config JSON verbatim); live A matches |
| 09-08 | No Lighthouse from preview/localhost as production evidence | holds (observed) | 7/7 `requestedUrl` on the apex |
| 09-08 | No "live" claim on a status field; HTTPS 200 only | holds (observed) | Re-measured HTTP/2 200 today |
| 09-09 | Never read audit_requests with the service role from a console page | holds | List, detail and audits/new pre-fill all use `createClient()`; tests "holds no service-role door" |
| 09-09 | Never select/render user_agent or ip_hash on the list | holds | `REQUEST_COLUMNS` excludes both; test "is not a wildcard" |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (62 phase-modified source files) | — | no `TBD`/`FIXME`/`XXX`, no `TODO`/`HACK`/`PLACEHOLDER`, no `console.log` | — | none |
| `src/app/(marketing)/privacy/page.tsx` | — | 54 lines vs plan `min_lines: 60` | ℹ️ Info | Not a stub: content is in `copy.ts`, seven populated sections observed live |
| `https://backdesk.com.au/favicon.ico` | — | root fallback 404 (matcher exempts it; Next default icon removed per D-18) | ⚠️ Warning | Browsers use the `<link rel=icon>` tags (all 200); crawlers/preview services that request the bare root path get nothing. Recorded as deferred in 09-08; small follow-up, not a LAND-06 failure |
| `src/app/(marketing)/copy.ts` | — | 11 Sep copy request only partly applied (four coupled conflicts; structural half not started) | ℹ️ Info | Documented decision, not a LAND requirement; Cowork thread to resolve |

### Human Verification Required

Ten items (frontmatter `human_verification`), consolidated from the nine plans' `<human-check>` blocks, 09-08's outstanding table, the two behaviour-unverified truths, the 13 abstained backstops and the 27 flagged prohibitions. The load-bearing one is item 1: a real submission on the public apex producing a real email and SMS within a minute — the phase goal's last clause has never executed on production (`audit_requests rows: 0`).

### Gaps Summary

None remaining. The single gap from the 09:40 run — `https://backdesk.com.au/login` answering the console sign-in form — is closed by commit `3ab6e19` (the global `login$|login/` matcher exemption removed; `PUBLIC_PATHS` keeps the form open on console hosts), pinned in `tests/proxy-host-routing.test.ts` and `tests/sync-tick-route.test.ts`, documented in the two evidence files (`be4d1ae`), and measured by this verifier on production: apex `/login` → HTTP/2 404 rewrite with no `location` and no `set-cookie`, body "Page not found · Backdesk"; app `/login` → 200 with the sign-in form. The four sibling review fixes (WR-02 … WR-05) were regression-checked and each improves a previously verified truth without moving any of them (subject strip, GSM-7 normalisation measured on the sent string, one shared control-character strip that never touches the stored row, conversion clearing the CSV columns so no dead download exists).

What remains is unchanged and human: the first live submission on the apex producing a real email and SMS inside a minute (`audit_requests rows: 0` — still never run on production), the phone read in both schemes, the link preview, the console walkthrough (now expecting "No file attached" after conversion), and ratification of the 27 judgment-tier prohibitions. The root `/favicon.ico` fallback 404 and the structural half of the 11 Sep copy request stay as follow-up quick tasks, not gaps.

Deferred items (Step 9b): none — Phase 10 ("First-Client Go-Live") does not cover any of the human items above.

---

_Verified: 2026-09-09T10:31:00Z (re-verification of the 2026-09-09T09:40:00Z run)_
_Verifier: Claude (gsd-verifier)_
