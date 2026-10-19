# Phase 9: Landing Page & Audit Intake - Research

**Researched:** 2026-09-09
**Domain:** Next.js 16 App Router public site inside an authenticated console (host-aware routing, static marketing pages, a no-login multipart form), Vercel apex domain + DNS at Squarespace, Supabase Storage private uploads, tenant-independent Postgres table with RLS, operator notifications reusing Resend + ClickSend, Lighthouse evidence
**Confidence:** MEDIUM-HIGH (codebase facts VERIFIED by reading files this session; Next.js/Vercel/Supabase facts CITED from official docs fetched 2026-09-09; a small number of platform behaviours are ASSUMED and listed in the Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Delivery surface and routing
- **D-01:** The landing site ships inside this Next.js project (no second repo or Vercel project). A `(marketing)` route group holds `/`, `/audit`, `/audit/thanks` (confirmation) and `/privacy`. `backdesk.com.au` and `www.backdesk.com.au` are attached to the `backdesk` Vercel project; `www` 308-redirects to the apex. The console stays on `app.backdesk.com.au`.
- **D-02:** `proxy.ts` becomes host-aware: marketing routes are public on every host; on the apex/www host, console paths never render (redirect to the app host or 404 — research decides); on the app host, `/` keeps its current console behaviour. The existing invariant stands: server actions authorise their own callers; the proxy is only the first line.
- **D-03:** Apex DNS is a founder action (registrar = Squarespace): replace the four Squarespace parking A records with Vercel's recommended A record(s) and point `www` CNAME at Vercel's target; remove the Squarespace site binding. **Never touch** the apex MX (`smtp.google.com`), SPF, `google._domainkey`, `_dmarc`, or `google-site-verification` records — they are Google Workspace mail. Plan a `checkpoint:human-action` with the exact record list and DoH read-backs (sandbox `dig` is a stub). Expect Vercel to need `vercel certs issue` again if auto-issue stalls (Phase 8 lesson).

#### Brand, tokens, type (from the approved M1 build request `docs/gtm/requests/build-request-phase-8-brand-spec.md`)
- **D-04:** Adopt the M1 design tokens verbatim (Paper `#FAFAF7`, Ink `#14213D`, Slate `#5B6470`, line `#D9DDE3`, Recovered green `#1B7A4A` / dark `#4CBF86`, unchanged ok/warn/error) as the CSS variables in `src/app/globals.css`, replacing the generic blue accent. Both colour schemes are mandatory (operator uses the console in dark on a phone). Green is for dollar figures and the one primary action per page only — never chrome, borders or badges.
- **D-05:** Type: Inter 400/600/700 via `next/font/google` (self-hosted at build, no runtime external request) for the landing pages; headings 600 with `letter-spacing: -0.02em`; body 17–18 px on phone, line-height 1.55, max measure 38 em. Wordmark = the text `Backdesk` in Inter Tight 700, `letter-spacing: -0.03em`, Ink (Paper in dark), never green, never with a tagline inside. Console keeps `system-ui`.
- **D-06:** Brand assets under `public/brand/`: `wordmark.svg`, `wordmark-paper.svg`, `favicon.svg` + `favicon.ico` (Paper "B" on an Ink rounded square), `og-image.png` 1200×630 (Paper background, wordmark left, tagline "Every quote chased until it's won or dead." in Ink, `backdesk.com.au` bottom-right in Slate). Generate the OG image at build time with `next/og` or ship a static PNG — research decides; the visual spec is fixed.
- **D-07:** Phase 8 deliberately deferred the visual restyle (Phase 8 D-04). This phase applies the tokens to the shared `globals.css`, so the console, login, audit page and monthly report pick up the palette; add `font-variant-numeric: tabular-nums` on dollar figures in the audit and report CSS. No layout changes to the A4 pages beyond that.

#### Copy (source of truth and timing)
- **D-08:** Copy source of truth is the Cowork thread: M1 positioning/tagline/voice (`docs/gtm/m1-brand-basics.docx`) and the M2 offer sheet (`docs/gtm/m2-offer-sheet.docx`). The dedicated landing-page copy build request arrives from the Cowork thread on Fri 11 Sep 2026 under `docs/gtm/requests/`. The UI-SPEC locks structure, hierarchy and the copywriting contract now and uses the M2 sentences as the initial copy; the planner treats "swap in the 11 Sep copy" as a task with a precondition, not a blocker.
- **D-09:** Voice rules are binding on every string: outcome first, never "AI-powered/automation/agent/bot/dashboard/platform/leverage/seamless"; AI appears once as "Run by AI, checked by a human"; no competitor names; ranges and "estimated" on figures; positioned against inaction. The positioning statement, tagline "Every quote chased until it's won or dead.", the four "How it works" steps, the pricing table (Quote Chaser $597, Pipeline Manager $997, setup $990, founding five $297 × 3 months), the guarantee paragraph, "Your customers, your name", "A good fit" and the footer are the sections — in that order.

#### The audit request form (LAND-02/03)
- **D-10:** Fields: business name, contact name, mobile, email, trade (select: electrical, plumbing, HVAC, solar, patios/outdoor, painting, landscaping, small builder, other), ServiceM8 user (yes/no), approximate quotes per month (select bands: <8, 8–15, 16–30, 30+), optional Job List CSV (`.csv`, text/csv, ≤ 5 MB), a privacy consent line linking to `/privacy`, honeypot field (visually hidden, named plausibly), and a submit button. Progressive enhancement: the form must work without client JS (server action / route handler POST) and enhance with inline validation.
- **D-11:** Storage: a new tenant-independent `audit_requests` table (id, created_at, fields above, `csv_object_path` nullable, `ip_hash`, `user_agent`, `status` enum new/contacted/audited/declined, `converted_prospect_id` nullable), written with the service-role client from the server; RLS denies anon/authenticated by default. CSV files go to a private Supabase Storage bucket (`audit-uploads`), never public, path keyed by request id; MIME and size checked server-side before upload.
- **D-12:** Abuse controls without paid infra: honeypot → silent 200 with no write; per-IP rate limit via a Postgres counter table (e.g. 5 submissions / hour / hashed IP) → refused with a plain message; server-side field validation with zod; no CAPTCHA in v1 (the anti-profile filter happens at the audit, not the form).
- **D-13:** Notification within one minute: after the insert, the same request sends an operator email via the existing `sendOperatorAlert` path (new alert kind `audit_request`) and an SMS via the existing ClickSend `sendSms` to the operator's handset (new env `OPERATOR_ALERT_PHONE`, E.164; documented in `docs/env-vars.md`), both from the brand sender. Notification failure must not lose the request: the row is written first; a failed notification is logged and shown in the console list as "notify failed".
- **D-14:** Confirmation: `/audit/thanks` says what happens next in the M1 voice ("We'll look at your ServiceM8 data and come back within one business day with the number") and repeats the contact email/phone. No account, no login link.

#### Console side (LAND-04)
- **D-15:** `/audits/requests` (list, newest first, status badges) and `/audits/requests/[id]` (detail: fields, CSV download link served through an authenticated route, status control, "Start audit" button). "Start audit" opens `audits/new` pre-filled: business name; `source=csv` with the stored file when present, else `source=api_key` (the operator obtains the key from the prospect). Converting sets `converted_prospect_id` and status `audited`.

#### Compliance, contact, metadata (LAND-05/06)
- **D-16:** `/privacy` is a real privacy notice in plain English (APP 1/5 shape): what is collected on the form and by the service, why, where it is held (Supabase Sydney), which providers process outside Australia (Resend, ClickSend, Anthropic), retention, access/correction, contact. Footer everywhere: `Backdesk · ABN [from config] · Perth WA · hello@backdesk.com.au · 0491 578 888`. The ABN is not yet issued: render the ABN segment only when the config value is set — never a placeholder in production.
- **D-17:** Contact and legal identity values live in the brand module (`src/core/brand.ts`) alongside the existing exports (business ABN optional, contact email, phone, suburb), so the landing page, privacy page, audit page footer and monthly report footer read one source. Keep the module import-free and update its structural test.
- **D-18:** Metadata per page (`title`, `description`, Open Graph, Twitter card), `robots` allow, `sitemap.xml` and `robots.txt` routes, `<link rel="icon">` from `public/brand/`. Lighthouse ≥ 90 mobile for performance and accessibility on `/` and `/audit`; measure with the Lighthouse CLI in CI or a documented manual run (record the numbers). No third-party scripts, no analytics in v1.
- **D-19:** Accessibility: semantic landmarks, one `h1` per page, form labels bound to inputs, errors announced via `aria-describedby` (reuse the console's `FieldError` pattern), visible focus, colour contrast per the M1 table, target size ≥ 44 px on the phone.

### Claude's Discretion
- Component structure of the marketing route group (server components only where possible), CSS approach (plain CSS modules or global classes consistent with the console — no Tailwind, no UI library), OG image generation method, exact rate-limit numbers, Storage bucket naming, sitemap route mechanics.
- Whether `www` redirects at Vercel domain settings (preferred) or in `proxy.ts`.

### Deferred Ideas (OUT OF SCOPE)
- **M1 build request §5 messaging copy** — SMS footer `[Business] · Reply STOP to opt out`, email From `[First name] at [Business] <quotes@…>`, expanded email footer (ABN, suburb, AI disclosure line), operator-alert subject prefix, audit/report footer wording with ABN. These change Spam Act identification strings Phase 8 built and tested (`"{business} via Backdesk"`, identity line). Needs a founder decision and its own quick task (or Phase 10 onboarding scope); flagged in the Phase 9 close-out.
- Analytics / conversion tracking — after the founding five; must stay privacy-respecting and script-light.
- Blog, case-study pages, bookkeeper partner page — Cowork M7/M8 deliverables; add routes when copy exists.
- CAPTCHA or Vercel WAF rate limiting — only if abuse appears.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LAND-01 | Public landing page at `https://backdesk.com.au` (www redirecting) presenting the offer, fully usable on a phone | §1 routing (single root layout + `(marketing)` nested layout, host-aware proxy), §2 Vercel/DNS record list and certificate rule, UI-SPEC sections/copy, §4 fonts |
| LAND-02 | Prospect requests a free audit without login via a form with the D-10 fields and optional CSV | §5 Server Action + `useActionState` with `encType="multipart/form-data"`, `bodySizeLimit`, the 4.5 MB Vercel ceiling (Pitfall 1), zod schema, `FieldError` pattern |
| LAND-03 | Request stored tenant-independently (service-role write, RLS-safe); operator emailed and texted within a minute; honeypot + per-IP rate limit | §7 schema/RLS/grants pattern (mirrors `prospects`), §6 Storage bucket, §8 notifications (alert kind `audit_request`, operator SMS bypassing the tenant arming gate), §5 honeypot + throttle table |
| LAND-04 | Operator opens the request in the console and starts an audit pre-filled in `audits/new` (CSV path when a file exists, API-key path otherwise) | §9 console list/detail patterns, `?request=` pre-fill, feeding the stored object into the existing staging code as a `File` |
| LAND-05 | Privacy notice + contact details (ABN, email, Perth address) linked from the form | §7 brand-module additions (`BUSINESS_ABN` optional), UI-SPEC privacy shape, retention facts (30-day CSV purge) to state in the notice |
| LAND-06 | Lighthouse ≥ 90 performance + accessibility on mobile; correct title/description/OG image/favicon | §10 Lighthouse CLI (verified runnable here), §4 static OG PNG + metadata API, matcher exclusions so static pages bypass the proxy |
</phase_requirements>

## Summary

The landing site is a **nested route group inside the existing app**, not a second root layout: `src/app/layout.tsx` keeps `<html lang="en-AU">` + `globals.css`, and `src/app/(marketing)/layout.tsx` adds the Inter / Inter Tight `next/font/google` variables on a `div.marketing` wrapper, the site header and footer. That avoids the two caveats of multiple root layouts (an experimental `global-not-found` and full reloads) while still preloading the webfonts only on marketing routes [CITED: nextjs.org font docs — "If it's a layout, it is preloaded on all the routes wrapped by the layout"]. The one real collision is `/`: the console's client list lives at `src/app/(console)/page.tsx` today [VERIFIED: read this session]. Move it to `(console)/clients/page.tsx` (the `clients/` folder exists with only `new` and `[id]`) and let `proxy.ts` rewrite app-host `/` → `/clients`, so the public `/` is a real, statically prerendered route whose failure mode (proxy bug) is "console host shows the landing page", never "public visitors hit the login wall". On the apex/www host the proxy answers a 404 rewrite for anything that is not a marketing path; `/audit`, `/audit/thanks`, `/privacy`, `/brand/*`, `robots.txt` and `sitemap.xml` are **excluded from the matcher** so they never invoke the proxy at all — which is also what keeps Lighthouse TTFB low.

The form is a Server Action with `useActionState` (the `audits/new` pattern) plus an explicit `encType="multipart/form-data"` for the no-JS path. Two platform facts change the locked numbers: Vercel Functions reject request bodies over **4.5 MB** with a 413 [CITED: vercel.com/docs/functions/limitations], and Server Actions default to a **1 MB** body [CITED: nextjs.org serverActions]. A "≤ 5 MB CSV" cannot be accepted in one request on this stack; the recommendation is a **4 MB** app-side cap with `experimental.serverActions.bodySizeLimit: '4400kb'`, and raising the console's `MAX_CSV_BYTES` (2 MiB today, test-pinned) to the same 4 MiB so the pre-fill path cannot reject a file the public form accepted. Storage goes to a private `audit-uploads` bucket via a service-role `supabase-js` client that lives in `src/db/repository/` (the only region allowed to hold that key). Notifications are sent inline after the insert (`Promise.allSettled` over `sendOperatorAlert` with a new `audit_request` kind and a new `sendOperatorSms` that reads the global SMS from-number **ignoring the `enabled` arming flag**), with outcomes written back to the row.

**Primary recommendation:** build in this order — (1) tokens + brand module + assets, (2) schema/migration/storage/repository, (3) marketing pages + form action + notifications, (4) console request pages + pre-fill, (5) `proxy.ts` host-awareness + `next.config.ts`, (6) the founder DNS checkpoint, cert issue, Lighthouse run and evidence entry. Every step has an automated test except DNS, HTTPS, OG rendering and the live SMS, which are proven live and recorded in `docs/external-registrations.md`.

## Project Constraints (from CLAUDE.md)

- Tech stack fixed: TypeScript, Next.js 16 App Router (`proxy.ts`, Turbopack), Supabase Sydney, Vercel; `zod` v4 at every boundary; drizzle-kit is the sole migration authority; no Prisma, no n8n/Zapier, no ClickSend SDK (thin `fetch` wrapper only — already `src/core/messaging/clicksend-client.ts`).
- Budget ≤ ~$200/mo, no paid infra beyond Supabase/Vercel/SMS/Anthropic — so no CAPTCHA service, no Vercel WAF paid rules, no Lighthouse SaaS.
- Compliance: Spam Act sender identification, Privacy Act APP compliance as vendor (the `/privacy` page is a real notice), AU data residency is a selling point and must be stated honestly (Supabase Sydney; Resend/ClickSend/Anthropic process outside AU).
- Repo conventions verified this session: `src/core` is framework-free (no `next/*` imports); every mutating server action authorises itself first (`requireOperator()` from `src/app/(console)/_auth.ts`); raw DB client and deep repository imports are lint-banned (`eslint.config.mjs`); `'use server'` files export only async functions (`tests/lint-ban.test.ts`); `SUPABASE_SERVICE_ROLE_KEY` must never be referenced under `src/app` (CI grep in `.github/workflows/ci.yml`); every new public table needs RLS + at least one non-trivial policy + explicit GRANT/REVOKE block (`tests/rls-coverage.test.ts`); provider errors reach the UI as fixed sentences, codes go to the log (`tests/console-error-leak.test.ts`).
- GSD workflow: file edits only through `/gsd-execute-phase` / `/gsd-quick`.
- Environment: `.env*` reads are denied to the agent; `dig` is a stub (use `https://dns.google/resolve`); hosted Supabase is production (`npm run cron:status` read-only only; never `npm run test:remote` unattended); `vercel api` read-only calls work with `teamId=team_XXXXXXXX`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Landing/privacy/thanks pages | Frontend Server (SSR, statically prerendered) | CDN / Static (Vercel edge serves the prerendered HTML) | No data dependency; static output is the Lighthouse win and the proxy is excluded on these paths |
| Host classification (apex vs console) | Frontend Server (`proxy.ts`, Node runtime) | Vercel domain settings (www → apex 308) | Vercel routes only its own project domains to the app, so the `host` header is trustworthy; the redirect belongs in Vercel settings (decided, preferred) |
| Audit request form validation + honeypot + throttle | API / Backend (Server Action) | Browser (native constraint validation as enhancement only) | The no-JS path must be fully correct server-side; the browser only improves UX |
| Request persistence | Database (Postgres, service-role write via drizzle) | — | Tenant-independent table with `is_operator()` policy, mirrors `prospects` |
| CSV object storage | Database / Storage (Supabase Storage private bucket) | API (service-role upload, operator-gated download route) | Files never public; RLS on `storage.objects` has no policy, so only service role reaches the bucket |
| Operator notification | API / Backend (same request, after the insert) | External (Resend, ClickSend) | Outcome recorded on the row; failure never loses the request |
| Console request list/detail/pre-fill | Frontend Server (console route group) | Database (RLS read through operator JWT; writes via repository after `requireOperator`) | Same shape as `/audits` and `audits/[id]` |
| Brand assets, OG image, favicon | CDN / Static (`public/brand/`) | Build (one-off generation scripts, committed output) | Zero request-time rendering |
| DNS + certificate | External (Squarespace DNS, Vercel) | Founder (checkpoint) | Human action; proven by DoH + `curl -sI https://` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.3.2 (installed) [VERIFIED: package.json] | Route groups, `proxy.ts`, Server Actions, `next/font/google`, metadata API, `sitemap.ts`/`robots.ts` | Already the app; every needed feature is built in (no `next/og` runtime use recommended — see §4) |
| `react` / `react-dom` | 19.2.8 [VERIFIED: package.json] | `useActionState` with progressive enhancement | Console already uses it |
| `zod` | 4.4.3 [VERIFIED: package.json] | Form schema, env schema additions | House rule; `z.email()` top-level API already used in `env.ts` |
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 [VERIFIED: package.json] | `audit_requests` + throttle tables, `pgPolicy`, `check()` | `check()` from `drizzle-orm/pg-core` IS emitted into migrations here (0026 carries `CONSTRAINT "messaging_config_channel_known" CHECK (...)` from `messaging-config.ts`) [VERIFIED: src/db/migrations/0026_messaging_config_delivery.sql:78] |
| `@supabase/supabase-js` | 2.112.4 [VERIFIED: package.json] | Service-role Storage client (`upload`, `download`) | Only sanctioned Storage API; SQL must not write objects [CITED: supabase.com storage schema design] |
| `@supabase/ssr` | 0.12.5 [VERIFIED] | Existing console client + proxy session | Unchanged |
| `resend` | 6.22.1 [VERIFIED] | Operator email via existing `sendOperatorAlert` | Unchanged |
| `papaparse` | 5.7.0 [VERIFIED] | Existing CSV staging; also the "first line parses with ≥ 2 columns" sniff | Already the parser |

### Supporting (one-off tooling, NOT added to package.json)
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `lighthouse` (via `npx lighthouse@13`) | 13.4.1 [VERIFIED: npm view 2026-09-09; `npx --yes lighthouse@13 --version` printed `13.4.1` on this machine] | Mobile performance + accessibility scores | Documented manual run against production and a local `next start`; not a devDependency |
| Google Chrome 145 / puppeteer `chrome-headless-shell` 145 | present [VERIFIED: `/Applications/Google Chrome.app`, `~/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46`] | Lighthouse's browser; `--headless=new --screenshot` for the OG PNG and favicon rasters | One-off asset generation and Lighthouse |
| `png-to-ico` (via `npx`) | 3.0.2 [VERIFIED: npm view; legitimacy OK] | Pack 16/32/48 PNG rasters into `favicon.ico` | One-off |
| `opentype.js` (via `npx`) | 1.3.4 (latest per registry; verify at run) [VERIFIED: legitimacy OK] | Convert the text `Backdesk` in Inter Tight 700 to SVG paths for `wordmark.svg` | One-off |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single root layout + nested `(marketing)/layout.tsx` | Two root layouts (one per group) | Two roots need `experimental.globalNotFound` for unmatched URLs and force full reloads; nothing on the marketing side needs its own `<html>` [CITED: nextjs.org route-groups, not-found docs] |
| Static committed `public/brand/og-image.png` | `opengraph-image.tsx` route with `ImageResponse` (built at build time) | Route needs TTF font files committed and satori rendering at build; static PNG is deterministic and matches D-06's `public/brand/` path |
| Server Action for the form | Route Handler `POST /audit` | Route handler loses `useActionState` and the console's error pattern; body limit is the same Vercel 4.5 MB either way |
| Throttle counter table with atomic upsert | `COUNT(*)` over `audit_requests` in the last hour | Count-only misses refused/honeypot attempts and races; D-12 names a counter table |
| Inline notifications (`await` both) | `after()` from `next/server` (stable since 15.1) [CITED: nextjs.org after] | `after()` returns the confirmation ~1–2 s sooner but the outcome must be written from a detached callback; inline is simpler to test and to prove |
| 404 on apex for console paths | 308 to `app.backdesk.com.au` | Redirect chains land crawlers on `/login` (apex → app → 307 `/login`); 404 is clean and the operator bookmarks the app host |

**Installation:** none. No new runtime or dev dependency is required for this phase.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `lighthouse` | npm | published 2026-07-20 (13.4.1); project ~10 yrs | 3.14M/wk | github.com/GoogleChrome/lighthouse | OK | Approved — one-off via `npx`, not installed |
| `png-to-ico` | npm | 2026-07-06 (3.0.2) | 397k/wk | github.com/steambap/png-to-ico | OK | Approved — one-off via `npx` |
| `opentype.js` | npm | 2026-05-06 | 1.76M/wk | github.com/opentypejs/opentype.js | OK | Approved — one-off via `npx` |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

No `postinstall` scripts on any of the three [VERIFIED: `gsd-tools query package-legitimacy check`, `postinstall: null`].

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build/tests | ✓ | 22.20.0 | — |
| npm | scripts | ✓ | 10.9.3 | — |
| Vercel CLI (`vercel api`, `domains`, `certs`) | domain attach, cert issue, read-backs | ✓ | 59.10.0, linked to project `backdesk` (`.vercel/project.json`) | — |
| Google Chrome / headless shell | Lighthouse, OG/favicon rasters | ✓ | 145 | — |
| Lighthouse CLI | LAND-06 evidence | ✓ via `npx lighthouse@13` | 13.4.1 | manual Chrome DevTools Lighthouse (record screenshots) |
| DNS-over-HTTPS (`dns.google/resolve`) | read-backs | ✓ | — | — (`dig` is a stub here) |
| Supabase local stack (Docker) | CI only | ✗ locally (dev machine has no Docker; CI runs `supabase start`) | CLI 2.115.0 pinned | pure tests locally; integration tests run in CI |
| Hosted Supabase Sydney | production | ✓ (read-only from here) | — | — |
| ImageMagick / rsvg / inkscape | SVG rasterising | ✗ (only `sips`, which cannot rasterise SVG) | — | Chrome `--headless=new --screenshot` |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** SVG rasteriser → Chrome headless screenshot; Docker → CI.

## 1. Host-aware routing in `proxy.ts` (LAND-01, D-01/D-02)

### What exists today `[VERIFIED: proxy.ts, src/lib/supabase/proxy.ts, src/app/layout.tsx, src/app/(console)/layout.tsx, src/app/(console)/page.tsx read this session]`
- `proxy.ts` exports `proxy(request)` → `updateSession(request)` and a **single-string** matcher: `'/((?!_next/static|_next/image|favicon.ico|api/|login$|login/).*)'`.
- Three route tests read that matcher with the regex `/matcher:\s*\['([^']+)'\]/` and throw if it is not a single string (`tests/cadence-tick-route.test.ts:582-588`, `tests/clicksend-inbound-route.test.ts:386`, `tests/clicksend-dlr-route.test.ts:348`). **The matcher must stay one string.**
- `updateSession` builds a Supabase SSR client, calls `auth.getClaims()` on every request, and redirects unauthenticated requests to `/login` unless `pathname` is under `PUBLIC_PATHS = ['/login']`.
- `src/app/layout.tsx` is the only root layout: `<html lang="en-AU"><body>{children}</body>` with `metadata.title.template = '%s · Backdesk'`.
- `src/app/(console)/layout.tsx` re-checks `getClaims()` and renders the nav (`Link href="/"` brand → the client list).
- `src/app/(console)/page.tsx` is the **client list** (`ClientListPage`) at `/`. `src/app/(console)/clients/` contains only `new/` and `[id]/` — `/clients` is free.
- `revalidatePath('/')` is called in `src/app/(console)/clients/new/actions.ts:128` and `src/app/(console)/audits/[id]/actions.ts:67` — both must become `revalidatePath('/clients')` when the page moves.
- There is **no** `src/app/not-found.tsx` today.

### Decision: one root layout, a nested marketing layout, console root moved to `/clients`
- Route groups may hold multiple root layouts, but with the caveats "full page load" between groups, "conflicting paths … would both resolve to `/about` and cause an error", and "make sure your home route (/) is defined within one of the route groups" [CITED: nextjs.org/docs/app/api-reference/file-conventions/route-groups]. A global 404 for two root layouts requires the experimental `global-not-found.js` (`experimental.globalNotFound`) [CITED: nextjs.org not-found docs]. Nothing marketing-side needs its own `<html>`; `lang="en-AU"` is already right. **Use one root layout.**
- The `/` conflict is resolved by moving the console list to `src/app/(console)/clients/page.tsx` and rewriting app-host `/` → `/clients` in the proxy. The public `/` is then a plain static route.
- Fonts: `next/font/google` "CSS and font files are downloaded at build time and self-hosted … No requests are sent to Google by the browser" [CITED: nextjs.org font docs]. Load `Inter` and `Inter_Tight` in `src/app/(marketing)/fonts.ts` with `variable: '--font-inter'` / `'--font-inter-tight'`, apply both `.variable` classes on the marketing layout's wrapper `<div className="marketing">`, and set `.marketing { font-family: var(--font-inter), system-ui, … }` in `marketing.css`. The UI-SPEC wrote `body.marketing`; with a single root layout the class lands on a wrapper `div` — same effect, note it in the plan.
- Metadata per group: page-level `metadata` exports override the root template; `/` uses `title: { absolute: 'Backdesk · Quote chasing for Perth trade businesses' }` [CITED: generate-metadata `title.absolute` "ignores title.template set in parent segments"]; `(marketing)/layout.tsx` sets `metadataBase: new URL('https://backdesk.com.au')` so `openGraph.images: ['/brand/og-image.png']` resolves absolute, plus `alternates.canonical` per page.

### The new matcher (single string, prefix-anchored exclusions)
```ts
// proxy.ts — Source: existing matcher + nextjs.org proxy docs negative-matching example
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|login$|login/|audit$|audit/|privacy$|brand/|robots.txt$|sitemap.xml$).*)',
  ],
};
```
- `audit$|audit/` excludes `/audit` and `/audit/thanks` but **not** `/audits` (console) — the anchors matter; add a pure test that `/audits`, `/audits/requests` still match and `/audit`, `/audit/thanks`, `/privacy`, `/brand/og-image.png`, `/robots.txt`, `/sitemap.xml` do not (extend the existing pattern in `tests/cadence-tick-route.test.ts:580-`).
- Server Functions are POSTs to the page route, "so a Proxy matcher that excludes a path will also skip Server Function calls on that path" [CITED: nextjs.org proxy docs] — exactly right for the public form: the action self-protects (honeypot, throttle, zod, service-role write), never the proxy.
- `next/experimental/testing/server` ships `unstable_doesProxyMatch`, `isRewrite`, `getRewrittenUrl` [CITED: proxy docs; VERIFIED: `node_modules/next/dist/experimental/testing/server/` exists] — use them for a pure host-routing test.

### The proxy function
```ts
// proxy.ts — recommended shape (Node runtime; `runtime` config is not allowed in proxy files)
import { NextResponse, type NextRequest } from 'next/server';
import { APEX_DOMAIN } from '@/core/brand';
import { updateSession } from '@/lib/supabase/proxy';

/** Hosts that serve the public site. 127.0.0.1 is the local stand-in so `next start` + Lighthouse can hit `/`. */
const MARKETING_HOSTS = new Set([APEX_DOMAIN, `www.${APEX_DOMAIN}`, '127.0.0.1']);

export async function proxy(request: NextRequest) {
  const hostname = request.nextUrl.hostname; // Vercel only routes the project's own domains here
  const { pathname } = request.nextUrl;

  if (MARKETING_HOSTS.has(hostname)) {
    if (pathname === '/') return NextResponse.next();          // static landing page
    // Everything else reaching the proxy on the public host is a console path: 404, never a redirect chain.
    return NextResponse.rewrite(new URL('/__not_found', request.url), { status: 404 });
  }

  // Console host (app.backdesk.com.au, localhost, preview URLs): `/` keeps the client list.
  return updateSession(request, pathname === '/' ? { rewriteTo: '/clients' } : undefined);
}
```
- `updateSession` needs one small extension: when `rewriteTo` is given, the final response is `NextResponse.rewrite(new URL(rewriteTo, request.url), { request })` instead of `NextResponse.next({ request })`, and the cookie `setAll` branch must rebuild the same rewrite response so refreshed session cookies survive. Unauthenticated `/` still redirects to `/login` before the rewrite.
- Rewriting to a path that matches no route renders `src/app/not-found.tsx` (add it — a small branded page inside the root layout) with a 404 [CITED: not-found docs — "the root app/not-found.js … handle any unmatched URLs"]. Passing `{ status: 404 }` to `rewrite` is belt-and-braces; verify the measured status with `curl -sI https://backdesk.com.au/inbox` (expect 404) at close-out. `[ASSUMED: status option on NextResponse.rewrite honoured — verify in the pure proxy test]`
- Host header trust: on Vercel, `host` "contains the custom domain" and `x-forwarded-host` "is identical to the host header" [CITED: vercel.com/docs/headers/request-headers]. A client cannot make the Vercel edge route a foreign `Host` to this project, and even if it could, the classification only chooses between *public pages* and *the auth wall* — console pages still gate on `getClaims()` in the layout and every action calls `requireOperator()`. No security decision rests on the host.
- `www` → apex: configure in **Vercel domain settings** (preferred, decided). The project already uses this mechanism: every `*.vercel.app` alias carries `"redirect": "app.backdesk.com.au", "redirectStatusCode": 308` [VERIFIED: `vercel api /v9/projects/backdesk/domains` 2026-09-09]. Set the same on `www.backdesk.com.au` with target `backdesk.com.au` (Phase 8 pattern: `POST /v10/projects/{id}/domains` with `redirect` + `redirectStatusCode`, or the dashboard "Redirect to" dropdown [CITED: vercel.com deploying-and-redirecting]). Vercel recommends `www` as primary, but explicitly says "redirect the www domain to the non-www also works" — D-01 locks apex-primary.

## 2. Vercel apex + www, Squarespace DNS, certificate (D-03)

### Current state `[VERIFIED: DoH read-backs and `vercel api` 2026-09-09]`
- `backdesk.com.au` A ×4 → `198.185.159.145`, `198.49.23.145`, `198.185.159.144`, `198.49.23.144` (Squarespace parking); no AAAA; NS `nsc1–4.squarespacedns.com`; MX `1 smtp.google.com.`; TXT `v=spf1 include:_spf.google.com ~all` and `google-site-verification=vWZK2lryw39-…`.
- `www.backdesk.com.au` CNAME → `ext-sq.squarespace.com.` (Squarespace).
- `app.backdesk.com.au` CNAME → `956ea6eb7ab36544.vercel-dns-017.com.` (unchanged, live).
- Project `backdesk` domains: `app.backdesk.com.au` + five `*.vercel.app` aliases (all 308 → app). Neither apex nor www is attached yet.
- `GET /v6/domains/backdesk.com.au/config` (unattached) reports `recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }]`, `recommendedCNAME: cname.vercel-dns.com.`, `misconfigured: true`. The **attached** `app.` subdomain reports a newer rank-1 anycast pair `["216.198.79.1","64.29.17.1"]` with `76.76.21.21` as rank 2 — so the apex value **may change once the domain is attached to the project**. Vercel's KB says the same: "Always use the value shown in your project's domain card. For most projects that value is 76.76.21.21 … newer projects may receive … 216.198.79.1" [CITED: vercel.com/kb/guide/a-record-and-caa-with-vercel].

### Sequence for the plan (agent steps, then the founder checkpoint)
1. `vercel domains add backdesk.com.au` and `vercel domains add www.backdesk.com.au` (project `backdesk`). Then **read back** `GET /v6/domains/backdesk.com.au/config?teamId=…` and `…/www.backdesk.com.au/config` and copy the rank-1 `recommendedIPv4` and `recommendedCNAME` verbatim into the founder's record list (Phase 8 rule: never a remembered generic value).
2. Set the www redirect (308 → `backdesk.com.au`) via the domains API/dashboard.
3. `checkpoint:human-action` — founder, in Squarespace: Domains → the domain → **DNS → DNS settings**. "In the Squarespace Defaults section, click the red trash can to delete your default records. Your domain can't point to another site when these defaults are in place." Then add `A @ <rank-1 IPv4(s)>` and `CNAME www <rank-1 CNAME>` [CITED: support.squarespace.com/hc/en-us/articles/215744668]. The Squarespace Defaults are exactly the four parking A records and the `www` CNAME to `ext-sq.squarespace.com`; the Google Workspace MX/SPF/DKIM/DMARC/site-verification rows sit outside that section and are **not** touched. If Squarespace shows a second A record in the recommendation (the anycast pair), add both. No AAAA ("Skip IPv6 … remove any AAAA records for the apex") and check CAA (none exists today; if one is ever added it must permit Let's Encrypt) [CITED: Vercel KB].
4. Read-backs (DoH, not `dig`): `A backdesk.com.au` = Vercel value(s) only; `CNAME www.backdesk.com.au` = Vercel target; `MX`, `TXT`, `_dmarc`, `google._domainkey` unchanged; `CNAME app.backdesk.com.au` unchanged.
5. Certificate: Phase 8 found `verified: true, misconfigured: false` for hours with no certificate; `vercel certs issue app.backdesk.com.au` fixed it [VERIFIED: docs/external-registrations.md:982-1005]. Plan the same: after DNS propagates, if `curl -sI https://backdesk.com.au/` does not return 200 within the hour, run `vercel certs issue backdesk.com.au` and `vercel certs issue www.backdesk.com.au` (`vercel certs issue cn [options]` takes one common name per invocation [VERIFIED: `vercel certs issue --help`]). **Proof of a live host is `HTTP/2 200` over HTTPS, never a status field.**
6. Proofs to record in `docs/external-registrations.md`: `curl -sI https://backdesk.com.au/` → 200 with `x-vercel-id: syd1…`; `curl -sI https://www.backdesk.com.au/` → 308 `location: https://backdesk.com.au/`; `curl -sI http://backdesk.com.au/` → 308 to https; `curl -sI https://backdesk.com.au/inbox` → 404; `curl -sI https://app.backdesk.com.au/` → 307 `/login` (unauthenticated, rewritten root) and `/audit` → 200 on both hosts.
- Standard Protection (Hobby) walls deployment URLs and leaves production custom domains public [VERIFIED: PROJECT.md Key Decisions, measured 2026-09-08] — the apex will be public with no bypass needed. Preview deployments stay walled, so **Lighthouse must run against production or a local `next start`**, never a preview URL.

## 3. Brand tokens and the console side effects (D-04, D-07)
- `src/app/globals.css` `:root` today: `--bg #ffffff; --fg #16181d; --muted #626875; --line #e2e5ea; --accent #1f6feb; --error; --ok; --warn` and a dark block [VERIFIED: read this session]. Replace both blocks with the UI-SPEC token set verbatim (adds `--surface`, `--accent-fg`).
- Consequential edits (UI-SPEC contract): `button`/`.button` hard-code `color: #fff` → `var(--accent-fg)`; `audit.css` print override of `--accent: #1f6feb` → `#1B7A4A`; `font-variant-numeric: tabular-nums` on every dollar figure rule in `audit.css` and `report.css`.
- `tests/layout-contract.test.ts` reads `globals.css`, `audit.css` and `report.css` and pins the console bar, `.table-scroll` and print rules [VERIFIED: file header + `describe` list]. The token swap must not touch those rules; run the pure suite after the CSS change.
- Accepted side effect (UI-SPEC): `--accent` and `--ok` become near-identical greens. Do not "fix".

## 4. Fonts, OG image, favicon, metadata, robots, sitemap (D-05, D-06, D-18)

### Fonts
```ts
// src/app/(marketing)/fonts.ts — Source: nextjs.org font docs ("Using a font definitions file", CSS variables)
import { Inter, Inter_Tight } from 'next/font/google';
export const inter = Inter({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-inter' });
export const interTight = Inter_Tight({ subsets: ['latin'], weight: ['700'], display: 'swap', variable: '--font-inter-tight' });
```
- Inter is a variable font on Google Fonts; passing an explicit `weight` array is allowed and keeps the payload small. `adjustFontFallback` defaults to `true` (CLS-safe fallback metrics). Preload happens only on routes under the marketing layout [CITED: font docs "Preloading"].
- Build-time download needs network access on the Vercel build and in CI (`npx next build` runs in `ci.yml` before the Supabase stack) — the CI runner has internet; note that an offline build would fail at font fetch. `[ASSUMED: CI build has outbound access to fonts.googleapis.com — it already does `npm ci`, so yes]`

### OG image — decision: static committed PNG
- D-06 fixes the file at `public/brand/og-image.png`; the UI-SPEC default is a static PNG "generated once by a script". `opengraph-image.tsx` would also be statically generated at build ("generated images are statically optimized (generated at build time and cached)") but needs TTF font files on disk for `ImageResponse` [CITED: nextjs.org opengraph-image docs] — extra committed fonts for no runtime benefit.
- Generation without new dependencies: `scripts/brand/og-image.html` (1200×630, Paper background, wordmark in Inter Tight 700, tagline Inter 600 64px, `backdesk.com.au` Inter 400 28px Slate, fonts via a Google Fonts `<link>` for this one-off render only) + `scripts/brand/render-og.sh` running `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1200,630 --screenshot=public/brand/og-image.png file://…/og-image.html`. Commit the PNG; keep the script for regeneration. Visual conformance to the spec is a human check (UI-SPEC C-13).
- Metadata wiring: `openGraph.images = [{ url: '/brand/og-image.png', width: 1200, height: 630, alt: "Backdesk. Every quote chased until it's won or dead." }]` resolved by `metadataBase`; `twitter.card = 'summary_large_image'`.

### Favicon and wordmark
- `logo/` already holds `backdesk-favicon.svg` (100×100 viewBox, contains a large C2PA `<metadata>` blob) and `backdesk-mark-720.svg`, plus PNG wordmarks (3696×924) and a lockup PNG [VERIFIED: `ls logo/`, `head` of the SVGs]. M1 §4 (8 Sep update) says "Copy into `public/brand/` rather than redrawing". Strip the `<metadata>` element when copying (it is most of the file) and confirm visually against the D-06 description (Paper "B" on Ink rounded square).
- `favicon.ico`: rasterise the SVG at 16/32/48 with Chrome `--screenshot --window-size=48,48` (or one 48px render downscaled via `sips -z`), then `npx png-to-ico 16.png 32.png 48.png > public/brand/favicon.ico`. Add `apple-touch-icon.png` 180×180 (UI-SPEC recommendation).
- `wordmark.svg` / `wordmark-paper.svg` as **paths** (no `<text>`): one-off `npx -p opentype.js node scripts/brand/wordmark.mjs` loading an Inter Tight 700 TTF (OFL) and emitting `font.getPath('Backdesk', 0, baseline, size).toPathData()` with the −0.03em tracking applied per glyph via `font.getAdvanceWidth`. Alternative that avoids the TTF: trace from the PNG — rejected (raster). `[ASSUMED: opentype.js API `getPath`/`toPathData` — standard, but verify at run]`
- `metadata.icons = { icon: [{ url: '/brand/favicon.svg', type: 'image/svg+xml' }, { url: '/brand/favicon.ico', sizes: 'any' }], apple: '/brand/apple-touch-icon.png' }` [CITED: generate-metadata `icons`]. The legacy `src/app/favicon.ico` (Next default) should be replaced or removed so the head does not carry two icons; the matcher already excludes `favicon.ico`.

### robots and sitemap
- `src/app/robots.ts` returning `{ rules: { userAgent: '*', allow: ['/', '/audit', '/privacy'], disallow: ['/login', '/inbox', '/queue', '/audits', '/reports', '/clients', '/settings', '/api/'] }, sitemap: 'https://backdesk.com.au/sitemap.xml' }` [CITED: nextjs.org robots docs]. Host-aware robots would need `headers()` and make the route dynamic; a single robots file with console paths disallowed is correct on both hosts. Add `robots: { index: false }` metadata on the `(console)` layout and `/login`, and on `/audit/thanks` (UI-SPEC).
- `src/app/sitemap.ts` returning `/`, `/audit`, `/privacy` with absolute apex URLs [CITED: sitemap docs — cached route handler, static]. Both files live at the `app` root (required), which is why the matcher excludes them by name.

## 5. The public form (LAND-02, D-10, D-12)

### Pattern `[VERIFIED: src/app/(console)/audits/new/form.tsx, actions.ts, action-state.ts]`
- Client component with `useActionState(action, BLANK_STATE)`; the state type `{ errors: Record<field, string|undefined>; formError: string|null; values: {...} }`; `FieldError({ id, message })` renders `<p className="field-error" id={id} role="alert">`; inputs carry `aria-invalid` and `aria-describedby="{name}-error"` only when an error exists; the blank state lives in a separate non-`'use server'` module (`invalid-use-server-value` rule).
- Copy the shape into `src/app/(marketing)/audit/{form.tsx, actions.ts, action-state.ts}`; extract `FieldError` into `src/app/(marketing)/audit/field-error.tsx` (or a shared `src/app/components/field-error.tsx`) so the console keeps its copy or imports the shared one.
- **No-JS path:** add `encType="multipart/form-data"` and `method="post"` on the `<form>`; the browser default enctype drops file parts. With JS off, React 19 `useActionState` re-renders the page with the returned state; on success `redirect('/audit/thanks')` in the action yields a 303 without JS and a client navigation with JS. `[ASSUMED: encType needed for the no-JS file submit — standard HTML; harmless with JS]`
- Add `noValidate` on the form so JS-on and JS-off read the same server messages (UI-SPEC C-9), and wrap fields in `<fieldset disabled={pending}>`.

### Body size — the locked "≤ 5 MB" cannot be met as written (Pitfall 1)
- Vercel: "The maximum payload size for the request body … of a Vercel Function is 4.5 MB … 413: FUNCTION_PAYLOAD_TOO_LARGE" [CITED: vercel.com/docs/functions/limitations, updated 2026-08-24]. Server Actions: default 1 MB, raise with `experimental.serverActions.bodySizeLimit` (still under `experimental` in 16.3.4); "The limit applies to the raw HTTP request body, including the bytes that multipart/form-data adds … an additional 10–20 KB is a reasonable rule of thumb" [CITED: nextjs.org serverActions].
- Recommendation: `AUDIT_CSV_MAX_BYTES = 4 * 1024 * 1024` app-side, `bodySizeLimit: '4400kb'` in `next.config.ts`, copy "CSV only, up to 4 MB". Over 4.4 MB the platform 413s before the action runs (Vercel) — the error page is Vercel's, not ours; the hint copy prevents most of that. A ServiceM8 Job List export for a 1–10 staff business over 90 days is far below 1 MB, so the cap is not a real-world constraint.
- The console intake caps at `MAX_CSV_BYTES = 2 * 1024 * 1024` and 5,000 rows, and the cap is test-pinned (`tests/csv-mapping.test.ts:549 expect(MAX_CSV_BYTES).toBe(2 * 1024 * 1024)`) [VERIFIED]. Raise it to 4 MiB and update the pin in the same commit, or the pre-fill path rejects a 2–4 MB file the public form accepted. Row cap unchanged (papaparse `preview` stops the parse).

### zod schema (pure, `src/core/intake/audit-request.ts`)
- `businessName` trim 1..120; `contactName` trim 1..80; `phone` → `normalizeAuMobile()` from `src/core/cadence/primary-contact.ts` (accepts `04xxxxxxxx` and `+614…`, returns `+61…` or null) [VERIFIED: primary-contact.ts:129-141]; `email` → `normalizeEmail()` (same module) or `z.email()`; `trade` `z.enum([...9 values])`; `servicem8` `z.enum(['yes','no'])` → boolean; `quotesBand` `z.enum(['lt8','8_15','16_30','gt30'])`; `website` (honeypot) any string; CSV handled outside zod (a `File`). Error messages verbatim from the UI-SPEC Copywriting Contract. Return all field errors at once.
- CSV acceptance (UI-SPEC default): extension `.csv` AND MIME in `{text/csv, application/vnd.ms-excel, application/octet-stream, ''}` AND size ≤ cap AND `Papa.parse(text, { preview: 1 })` yields ≥ 2 columns; store the sanitised original filename (`[^A-Za-z0-9._-]` → `_`, max 80 chars). Content is treated as data; React escapes it; no CSV re-export exists (the T-2-14 reasoning in `actions.ts` applies).

### Honeypot
- `<input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true">` inside `div.hp` positioned off-screen (UI-SPEC C-8). Any non-empty value → `redirect('/audit/thanks')` with **no write, no throttle bump, no notification**. Do not name it `honeypot`; do not use `display:none` (some bots skip hidden inputs, which is fine either way, but off-screen catches more). No timing checks in v1 (not locked; skip).

### Per-IP throttle (counter table, atomic)
- IP: `x-forwarded-for` on Vercel is "the public IP address of the client … we currently overwrite the X-Forwarded-For header and do not forward external IPs … to prevent IP spoofing"; `x-real-ip` and `x-vercel-forwarded-for` are identical [CITED: vercel.com/docs/headers/request-headers]. Read the first comma-separated value of `x-forwarded-for` via `headers()` in the action; `null` locally.
- Hash: `sha256(`${AUDIT_IP_HASH_SALT}:${ip}`)` hex (Node `crypto`), new required env `AUDIT_IP_HASH_SALT` (≥ 32 chars, `openssl rand -hex 32`), CI dummy in `ci.yml` and `tests/helpers/env.ts` REQUIRED list, pushed with `npm run env:push --project backdesk`. IPv6: hash the /64 prefix (first four hextets) rather than the full address so rotation inside one allocation shares a bucket; IPv4 whole address.
- Table `audit_request_throttle (ip_hash text, window_start timestamptz, hits int not null, primary key (ip_hash, window_start))`; `window_start = date_trunc('hour', now())`. One statement: `INSERT … VALUES ($hash, date_trunc('hour', now()), 1) ON CONFLICT (ip_hash, window_start) DO UPDATE SET hits = audit_request_throttle.hits + 1 RETURNING hits` — race-free; refuse when `hits > 5` (UI-SPEC copy, HTTP 200 re-render). Bump **before** the insert so refused attempts count. Sweep rows older than 24 h inside the same daily purge (see §6) or opportunistically (`DELETE … WHERE window_start < now() - interval '1 day'` after a successful insert).
- RLS: enable + a deliberate `is_operator()` policy (the coverage test refuses policy-less RLS tables); no grants to anon/authenticated (nothing reads it through PostgREST; a table with zero grants is simply absent from the exact-grants map).

## 6. Storage: private bucket, upload, download, retention (D-11)

- Bucket creation via SQL is documented: `insert into storage.buckets (id, name, public) values (...)` [CITED: supabase.com/docs/guides/storage/buckets/creating-buckets]; the `storage.buckets` table carries `public boolean`, `file_size_limit bigint`, `allowed_mime_types text[]` [CITED: supabase.com/docs/guides/storage/schema/design]. Objects must never be written by SQL ("All operations, including uploading, copying, moving, and deleting, should exclusively go through the API") — bucket rows are configuration and are fine.
- Migration (hand-written, idempotent, same file as the tables): `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('audit-uploads','audit-uploads', false, 4194304, ARRAY['text/csv','application/vnd.ms-excel','application/octet-stream']) ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;`. CI's local stack has storage enabled (`supabase/config.toml` `[storage] enabled = true`, `file_size_limit = "50MiB"`) [VERIFIED]. `[ASSUMED: the `postgres` role used by `MIGRATE_DATABASE_URL` may INSERT into `storage.buckets` on hosted Supabase — Supabase's own SQL examples run as that role; fallback if it 42501s: an idempotent `scripts/setup-storage.mjs` calling `supabase.storage.createBucket()` with the service role, and a `[storage.buckets.audit-uploads]` block in config.toml for CI]`
- Access control: "Service keys entirely bypass RLS policies" on `storage.objects`; with no policies, anon/authenticated can do nothing [CITED: supabase.com storage access-control]. Do **not** add any `storage.objects` policy — the console downloads through the operator-gated route with the service role, so the bucket stays unreachable from the browser. Free-plan global file cap is 50 MB; per-bucket limit must be ≤ global [CITED: file-limits doc].
- Client placement: the service-role `supabase-js` client must live in `src/db/repository/audit-uploads.ts` (reads `getServerEnv().SUPABASE_SERVICE_ROLE_KEY`; `createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })`), exported through the barrel — the CI secret scan fails on any reference under `src/app`, and the deep-import ban means the barrel is the only door [VERIFIED: ci.yml, eslint.config.mjs]. Nothing in `src/` instantiates a service-role supabase-js client today (only `scripts/` and `tests/helpers`); this is the first — say so in the module header.
- Upload: `storage.from('audit-uploads').upload(`${requestId}/${safeName}`, bytes, { contentType: 'text/csv', upsert: false })` after the row insert (path stored on the row on success; on failure the row keeps `csv_object_path = null` and the operator sees "No file attached" plus the logged error name — the request is not lost).
- Download: `src/app/(console)/audits/requests/[id]/csv/route.ts` `GET` → `requireOperator()` first (route handlers are not wrapped by the console layout) → uuid shape check → `download(path)` returns a `Blob` [CITED: supabase downloads doc] → `new Response(blob, { headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${safeName}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } })`. The proxy still gates this path on the app host (it is under `/audits/`), but the route's own check is the real control.
- Retention: a CSV is a stranger's customer PII — the same class as `prospect_quote_lines` (30-day `purge_after`, daily `prospect-line-purge` cron) [VERIFIED: src/db/schema/prospects.ts header, migration 0014]. Stamp `csv_purge_after = now() + 30 days` on upload; conversion (pre-fill consumed the file into `prospects.csv_staging`, which has its own 24 h expiry) deletes the object immediately. Objects cannot be deleted from `pg_cron` SQL (API only), so the purge needs an authenticated HTTP path: **piggyback on the existing daily `/api/internal/stalled-digest` tick** (already a bearer-protected, daily, pg_cron-driven route) by calling `purgeExpiredAuditUploads()` from its handler — no new secret, no new cron entry. Alternative: a seventh internal route + bearer + `cron:apply` entry (heavier; only if the digest route's owner objects). State the 30 days in `/privacy`.

## 7. Schema, migration, RLS, brand module (D-11, D-16, D-17)

### How tables are defined here `[VERIFIED: src/db/schema/prospects.ts, operators.ts, messaging-config.ts; migrations 0003, 0014, 0026, 0034; migrations/README.md; drizzle.config.ts]`
- One file per table under `src/db/schema/`, exported from `src/db/schema/index.ts` (drizzle-kit reads only the barrel). Policies are authored in-schema with `pgPolicy(..., { to: authenticatedRole, using: sql`is_operator()`, withCheck: sql`is_operator()` })` — attaching a policy auto-enables RLS. CHECK vocabularies use `check('name', sql`col IN (...)`)` and are emitted by `db:generate` (0026 proves it).
- GRANTs are **not** modelled: every new table needs a hand-written block appended to the generated migration, in the 0014 shape: `REVOKE ALL … FROM anon; REVOKE ALL … FROM authenticated;` then `GRANT SELECT … TO anon; GRANT SELECT … TO authenticated; GRANT ALL … TO service_role;` with `--> statement-breakpoint` between statements. `tests/rls-coverage.test.ts` then requires: RLS on, ≥ 1 policy, no literal-`true` policy, and the exact-grants map updated for any table that grants anything to anon/authenticated.
- `npm run db:generate` → `0035_phase9_audit_requests.sql` (+ hand-written GRANT/REVOKE/bucket block appended) → `npm run db:migrate` (session pooler 5432, `scripts/migrate.mjs`). **Journal trap** [VERIFIED: STATE.md:396, 411]: `drizzle-kit generate` stamps `when` behind the head if the journal is dirty and the migrator applies entries only when `created_at < folderMillis`; generate once on a clean tree, confirm idx 35 with a `when` greater than 0034's `1788412215830`, and prove with a no-op `db:migrate` that the hosted journal agrees. `tests/lint-ban.test.ts` carries a monotonicity guard.

### `audit_requests` (tenant-independent — the `prospects` shape, not `forTenant()`)
- `forTenant()` "closes over the tenant id and exposes no method that accepts one" (STATE.md, Phase 1); prospects deliberately have **no closure** because they are operator-scoped, and the barrel exports them on their own line under a comment naming the exception [VERIFIED: src/db/repository/prospects.ts header, index.ts]. Mirror that: `src/db/repository/audit-requests.ts` with `createAuditRequest`, `attachAuditRequestCsv`, `recordAuditRequestNotify`, `listAuditRequests`, `getAuditRequest`, `updateAuditRequestStatus`, `markAuditRequestConverted`, `bumpAuditRequestThrottle`, `purgeExpiredAuditUploads`; every id shape-checked at the boundary (`assertProspectId` pattern); nothing accepts a `tenantId`. Export on its own barrel line. The lint ban is on *importing the raw client*, not on tenant-less repositories — a module inside `src/db/repository/` is the sanctioned place.
- Columns: `id uuid pk default random`, `created_at`, `business_name text`, `contact_name text`, `phone text` (E.164 after normalisation), `email text`, `trade text` + `check(trade IN (...))`, `servicem8_user boolean`, `quotes_band text` + check, `csv_object_path text null`, `csv_filename text null`, `csv_bytes integer null`, `csv_purge_after timestamptz null`, `ip_hash text`, `user_agent text` (cap 512 at insert), `status text not null default 'new'` + `check(status IN ('new','contacted','audited','declined'))`, `converted_prospect_id uuid null references prospects.id on delete set null`, `notify_email text` / `notify_sms text` (closed vocabulary `'sent' | 'failed' | 'not_configured'`), `notify_detail text null` (error *name* only), `notified_at timestamptz null`. Index on `(created_at desc)` and on `(status)`.
- Policy: `audit_requests_operator_access FOR ALL TO authenticated USING (is_operator()) WITH CHECK (is_operator())` (the prospects policy verbatim, same reasoning: a `tenant_members` EXISTS check would leak the sales pipeline to v2 client logins) [VERIFIED: prospects.ts policy comment]. Grants: SELECT to anon and authenticated (an anonymous read returns `[]`, not 42501 — the Phase 1 denial-equals-absence rule), ALL to service_role, no write grant to authenticated (status updates go through the repository after `requireOperator()`, the `convertProspectAction` pattern [VERIFIED: audits/[id]/actions.ts]).
- `SUPABASE_SERVICE_ROLE_KEY` is already REQUIRED in `serverEnvSchema` [VERIFIED: env.ts:14]; drizzle writes go through `getDb()` (Postgres `postgres` role via `DATABASE_URL`, RLS-inert) — the "service-role write" of D-11 is this existing path.

### Brand module additions (D-17) `[VERIFIED: src/core/brand.ts exports; tests/brand.test.ts pins]`
- Today exactly nine exports (`SERVICE_NAME, APEX_DOMAIN, CONSOLE_HOST, SENDING_DOMAIN, CONSOLE_DESCRIPTION, PROVIDER_SOURCE_TAG, DEFAULT_ALERT_FROM, identityLine, viaDisplayName`) pinned by name; the test also forbids any `import`/`require`/`export … from`, and forbids a sanitiser. Add `TAGLINE`, `CONTACT_EMAIL = 'hello@backdesk.com.au'`, `CONTACT_PHONE_DISPLAY = '0491 578 888'`, `CONTACT_PHONE_E164 = '+61491578888'`, `BUSINESS_SUBURB = 'Perth WA'`, `OPERATOR_LEGAL_NAME = 'Hesam Abbaszadi'`, and `footerIdentityLine(abn: string | null): string` (pure; omits the ABN segment when null). Update the pin to the new sorted list in the same commit.
- **Do not read `process.env` inside brand.ts.** The module is imported by client-reachable code paths in principle, and `process.env.BUSINESS_ABN` inlines to `undefined` in a browser bundle — a server-rendered ABN segment would then hydrate away. Instead add `BUSINESS_ABN: z.string().regex(/^\d{11}$/).optional()` to `serverEnvSchema` (+ the pick-list in `getServerEnv`) and have the server components pass `getServerEnv().BUSINESS_ABN ?? null` into `footerIdentityLine`. Never a placeholder: `null` → no segment.

## 8. Notifications (D-13) `[VERIFIED: src/core/alerts/operator-email.ts, src/core/messaging/clicksend-client.ts, routing-sender.ts, repository/messaging-config.ts, escalation/escalate-hot-leads.ts, message.ts]`

### Email
- `sendOperatorAlert(input)` today takes `{ tenantId, tenantName, kind: 'auth_failed' | 'degraded', detail: SyncOutcome, at? }`, resolves `to = OPERATOR_ALERT_EMAIL`, `from = OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM` (live value `Backdesk <alerts@quotes.backdesk.com.au>` since 08-07), builds a **plain-text** body from a closed vocabulary, never throws, returns `{ ok } | { ok:false, kind:'not_configured'|'send_failed', detail: error name }`.
- Add a discriminated input: `{ kind: 'audit_request', requestId, businessName, contactName, phone, trade, quotesBand, servicem8: boolean, hasCsv: boolean, at? }` with `alertSubject` → `Backdesk · Audit request: {business_name}` and a new pure `auditRequestAlertBody()` linking `${consoleBaseUrl()}/audits/requests/${id}`. The T-2-16 "closed vocabulary" rule is deliberately relaxed here — the prospect's own strings are the content — so: zod-bounded lengths, strip `\r\n` and control characters before interpolation, plain text only (no HTML), and a test that the body contains no caught error text.

### SMS — the arming gate must not block it, and it must not page anyone but the operator
- `sendSms(input: { to, from, body, customString }, creds: { username, apiKey })` never throws and posts verbatim to ClickSend with `source = PROVIDER_SOURCE_TAG` [VERIFIED: clicksend-client.ts:179-216]; creds come from the OPTIONAL `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` env (absent → no send, record `not_configured`).
- The cadence path resolves the from-number with `resolveSmsFrom(tenantId)`, which returns `null` unless the effective `messaging_config` row is `enabled` — the D-04 arming switch that the escalation pass deliberately honours so a remote test cannot page a tradie [VERIFIED: escalate-hot-leads.ts header]. The operator alert is different: the recipient is `OPERATOR_ALERT_PHONE` from env — never a customer or tradie — so read the global row directly with `getChannelConfig('sms')` (tenantId omitted → global row alone [VERIFIED: messaging-config.ts:80-110]) and use its `fromAddress` **regardless of `enabled`**. New `sendOperatorSms()` in `src/core/alerts/operator-sms.ts`: no row or no `from_address` → `not_configured`; no creds → `not_configured`; else `sendSms`. `customString = audit-request:${id}` so a delivery receipt never matches a ledger row (files as `unmatched`, the escalation precedent).
- `OPERATOR_ALERT_PHONE`: REQUIRED in `serverEnvSchema`, `z.string().regex(/^\+61\d{9}$/)`; CI dummy `+61400000000` in `ci.yml` and the `tests/helpers/env.ts` REQUIRED list (fake is safe: no suite has ClickSend creds); push with `env:push`; document in `docs/env-vars.md`.
- **Segment budget:** the UI-SPEC SMS `Backdesk: audit request from {business} ({trade}, {band}/mo). {contact} {phone}. app.backdesk.com.au/audits/requests/{id}` overruns 160 GSM-7 characters once a 36-char UUID is appended (≈ 180 with typical values). Drop the id from the URL (`app.backdesk.com.au/audits/requests`) and cap the business name at 40 chars in the SMS builder; assert `segmentCount(countSeptets(normalizeForGsm7(body)).septets) === 1` in a pure test using `src/core/drafting/gsm7.ts` (the escalation message test does exactly this) [VERIFIED: escalation/message.ts:31-56, gsm7.ts exports].

### Timing and reliability
- Order inside the action: validate → honeypot exit → throttle bump/refuse → insert row → upload CSV (attach path) → `Promise.allSettled([sendOperatorAlert, sendOperatorSms])` → `recordAuditRequestNotify(id, outcomes)` → `redirect('/audit/thanks')`. Provider timeouts: ClickSend 20 s (`REQUEST_TIMEOUT_MS = 20_000` [VERIFIED]); Resend SDK default. Worst case the prospect waits ~20 s on a ClickSend outage — acceptable for a rare failure, and inside Hobby's 300 s max duration. `after()` is available if latency ever matters ("executed even if … `redirect` is called" [CITED: nextjs.org after]) but the outcome write then happens after the response; stay inline in v1.
- "Within one minute" is satisfied by construction (same request). Evidence: the row's `notified_at`, plus the operator's inbox/handset during UAT.

## 9. Console pages and the pre-filled `audits/new` (LAND-04, D-15) `[VERIFIED: audits/page.tsx, audits/[id]/page.tsx, convert-form.tsx, components/action-message.tsx, action-state.ts]`
- List pattern: server component, `export const dynamic = 'force-dynamic'`, reads through `createClient()` (anon key + cookie session, so the `is_operator()` policy decides), explicit select list (never a column a browser has no business holding), `.order('created_at', { ascending: false }).order('id', …)`, error → `console.error('[audit-requests] … ${error.code}')` + fixed sentence in `p.error role="alert"`. Any `<table>` under `src/app` must sit inside `.table-scroll` (layout-contract test) — the UI-SPEC chose `.touch-list` rows, so no table.
- Detail: `notFound()` on a bad uuid or a missing row; `dl.profile`; status form = a small client component with `useActionState` and `ActionMessage` (`role="status"` on success, `role="alert"` on failure) whose state is the shared `ControlState` from `src/app/(console)/components/action-state.ts`; the action calls `requireOperator()` first, shape-checks the uuid, then `updateAuditRequestStatus` through the barrel and `revalidatePath`.
- `/audits` entry point: add a `Requests` link in the existing `.row` beside `New audit` (the nav's comment refuses a fifth item; UI-SPEC agrees).
- Pre-fill: `audits/new/page.tsx` reads `searchParams.request`, validates the uuid, reads the row through `createClient()` (RLS; a non-operator gets null and the plain form), renders the hint and passes `initial: { businessName, source: csv|api_key, requestId, csvFilename, csvBytes }` to `NewAuditForm`; the form emits `<input type="hidden" name="request_id">`. `createAuditAction` (already `requireOperator()`-first) gains: if `request_id` present and `source === 'csv'` and no new file, download the object via the repository, wrap as `new File([await blob.arrayBuffer()], filename, { type: 'text/csv' })` (Node 22 `File` is global) and pass it to the existing `stageCsvUpload(file, values, timezone)` unchanged; after `createProspect`/`generateAuditFromApiKey` succeed, `markAuditRequestConverted(requestId, prospectId)` (status `audited`, `converted_prospect_id`), and delete the storage object. Both branches keep their current behaviour when `request_id` is absent.

## 10. Lighthouse (LAND-06, D-18)
- Toolchain proven on this machine: `npx --yes lighthouse@13 --version` → `13.4.1`; Chrome 145 present. Command (mobile is the default emulation): `npx lighthouse@13 https://backdesk.com.au/ --only-categories=performance,accessibility --output=json --output=html --output-path=./docs/lighthouse/2026-09-XX-home --chrome-flags="--headless=new"` and the same for `/audit`; `CHROME_PATH` selects the binary if needed [CITED: GoogleChrome/lighthouse readme]. Run three times and record the median (performance varies ±5 between runs on a phone-throttled profile).
- Where: production apex after DNS lands (deployment URLs are walled by Standard Protection). Before DNS: local `npx next build && npx next start` and audit `http://127.0.0.1:3000/` (the `127.0.0.1` marketing stand-in in §1) — scores on localhost are indicative only (no CDN, no HTTP/2).
- Record: commit the JSON/HTML under `docs/lighthouse/` (small) or, at minimum, the four numbers + run date + URL + Lighthouse version in the phase VERIFICATION and a dated entry in `docs/external-registrations.md`. CI integration is deferred (would need `next start` + Chrome on the runner + a Supabase-free build; the run is ~2 min and adds flake) — D-18 allows the documented manual run.
- What costs points on this page: any render-blocking third-party request (there are none), webfont FOIT (`display: 'swap'` + `adjustFontFallback` handle it), layout shift from images without dimensions (only the OG image exists and it is not rendered on the page), colour contrast (the M1 table passes AA; the `--line` border on inputs fails 3:1, hence `--muted` borders), tap-target size (44 px rule), a missing `<meta name="viewport">` (Next adds it), and the proxy invocation on `/` (kept minimal: `NextResponse.next()` with no Supabase call on the apex host).

## Architecture Patterns

### System Architecture Diagram
```
Prospect phone ──GET https://backdesk.com.au/── Vercel edge ── proxy.ts (host=apex, path=/) ── next() ── prerendered (marketing)/page.tsx
                 ──GET /audit, /privacy, /brand/*, robots, sitemap ── (matcher excluded) ── static route / public file
                 ──GET /inbox (apex) ── proxy.ts ── rewrite /__not_found ── app/not-found.tsx (404)
www.backdesk.com.au ── Vercel domain redirect 308 ── backdesk.com.au

POST /audit (Server Action, multipart ≤ 4.4 MB)
  └─ zod parse ── honeypot? ──yes── redirect /audit/thanks (no write)
       └─ no ── throttle upsert (ip_hash, hour) ── hits > 5? ──yes── re-render with refusal copy (200)
            └─ no ── INSERT audit_requests (service-role drizzle) ── CSV? ── upload audit-uploads/{id}/{name} ── attach path
                 └─ Promise.allSettled( sendOperatorAlert(audit_request) [Resend], sendOperatorSms [ClickSend, global from-number, OPERATOR_ALERT_PHONE] )
                      └─ record notify outcomes on row ── redirect 303 /audit/thanks

Operator phone ──GET app.backdesk.com.au/audits/requests ── proxy.ts (updateSession) ── (console) layout getClaims ── RLS read (is_operator)
  ├─ /audits/requests/[id]/csv ── requireOperator ── storage.download ── attachment
  └─ Start audit ── /audits/new?request={id} ── createAuditAction(request_id) ── File from bucket ── stageCsvUpload ── mapping ── markAuditRequestConverted

pg_cron daily ── /api/internal/stalled-digest (bearer) ── purgeExpiredAuditUploads (storage delete + null path) + throttle sweep
```

### Recommended Project Structure
```
proxy.ts                                  # host-aware; single-string matcher (tests parse it)
next.config.ts                            # + experimental.serverActions.bodySizeLimit: '4400kb'
public/brand/                             # wordmark.svg, wordmark-paper.svg, favicon.svg, favicon.ico, apple-touch-icon.png, og-image.png
scripts/brand/                            # og-image.html + render-og.sh, wordmark.mjs (one-off, npx)
src/app/not-found.tsx                     # branded 404 inside the root layout (apex console-path rewrite target)
src/app/robots.ts, src/app/sitemap.ts
src/app/(marketing)/layout.tsx            # nested (NOT root): fonts vars, header, footer, metadataBase, div.marketing
src/app/(marketing)/marketing.css
src/app/(marketing)/copy.ts               # every landing string (D-08 one-file swap); NOT 'use server'
src/app/(marketing)/fonts.ts
src/app/(marketing)/page.tsx              # /
src/app/(marketing)/privacy/page.tsx
src/app/(marketing)/audit/{page.tsx, form.tsx, actions.ts, action-state.ts, field-error.tsx}
src/app/(marketing)/audit/thanks/page.tsx
src/app/(console)/clients/page.tsx        # moved from (console)/page.tsx; proxy rewrites app-host / here
src/app/(console)/audits/requests/{page.tsx}
src/app/(console)/audits/requests/[id]/{page.tsx, status-form.tsx, actions.ts, csv/route.ts}
src/app/(console)/audits/new/{page.tsx, form.tsx, actions.ts}   # + request_id pre-fill
src/core/intake/{audit-request.ts (zod), ip-hash.ts, throttle.ts (pure decision), csv-sniff.ts}
src/core/alerts/operator-email.ts         # + kind 'audit_request'
src/core/alerts/operator-sms.ts           # new
src/core/brand.ts                         # + contact/legal exports, footerIdentityLine
src/core/shared/env.ts                    # + OPERATOR_ALERT_PHONE, AUDIT_IP_HASH_SALT (required), BUSINESS_ABN (optional)
src/db/schema/{audit-requests.ts, audit-request-throttle.ts} + index.ts
src/db/repository/{audit-requests.ts, audit-uploads.ts} + index.ts barrel lines
src/db/migrations/0035_phase9_audit_requests.sql   # generated + hand-written GRANT/REVOKE + storage.buckets upsert
tests/{audit-request-schema, audit-request-throttle, audit-request-notify, marketing-copy, proxy-host-routing, brand, rls-coverage, csv-mapping}.test.ts
docs/env-vars.md, docs/external-registrations.md, docs/vercel-domains-and-protection.md, docs/lighthouse/
```

### Pattern 1: Tenant-less repository family (the `prospects` shape)
**What:** a module inside `src/db/repository/` that takes no `tenantId`, shape-checks every id, is the only writer of retention stamps, and is exported on its own barrel line with a comment.
**When to use:** any table that is operator-scoped rather than client-scoped (`audit_requests`, the throttle).
**Example:** `src/db/repository/prospects.ts` header + `createProspect` [VERIFIED].

### Pattern 2: Auth-first Server Action, service-role write, RLS read
**What:** `requireOperator()` before the body is parsed; writes through the barrel; page reads through `createClient()` so `is_operator()` is exercised on every render.
**Example:** `src/app/(console)/audits/[id]/actions.ts` (`convertProspectAction`) and `src/app/(console)/audits/page.tsx` [VERIFIED].

### Pattern 3: Never-throwing provider boundary with error *names*
**What:** every provider call resolves to a typed outcome; the UI gets a fixed sentence; only `error.name`/status class reaches a log or a column.
**Example:** `sendOperatorAlert` rules 1–3, `sendSms` header [VERIFIED]. The new `sendOperatorSms` and the notify columns follow it.

### Pattern 4: Structural tests for contracts
**What:** tests that read source files (`proxy.ts` matcher, `brand.ts` exports, CSS rules) and pin them.
**Example:** `tests/brand.test.ts` export pin; `tests/cadence-tick-route.test.ts:580` matcher parse [VERIFIED]. Add the same for the marketing copy (forbidden words), the matcher exclusions and the SMS segment budget.

### Anti-Patterns to Avoid
- **A second root layout** for marketing: buys nothing, costs an experimental flag for 404s.
- **Reading the ABN from `process.env` inside `brand.ts`** (hydration mismatch risk; module must stay import-free and pure).
- **`resolveSmsFrom()` for the operator SMS**: it is gated on the tenant arming flag and would silently record `sms_not_configured` while customer sends are disarmed — the exact case D-13 forbids.
- **Storage client or `SUPABASE_SERVICE_ROLE_KEY` under `src/app`**: CI fails the secret scan.
- **`storage.objects` policies for the console**: unnecessary and widens the browser-reachable surface.
- **Redirecting apex console paths to the app host**: crawlers chase a redirect chain to `/login`.
- **A route-level rate limit in the proxy**: the matcher excludes `/audit`, and the action is the only place that can count writes.
- **`revalidatePath('/')` after the move**: the console list lives at `/clients`; two callers must change.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webfont hosting | Manual `@font-face` + copied woff2 | `next/font/google` with `variable` | Build-time self-host, subsetting, CLS-safe fallback metrics, per-layout preload [CITED] |
| AU mobile / email normalisation | New regexes | `normalizeAuMobile`, `normalizeEmail` from `src/core/cadence/primary-contact.ts` | Already refuse-rather-than-repair, tested |
| SMS segment counting | Length check | `countSeptets` / `segmentCount` / `normalizeForGsm7` (`src/core/drafting/gsm7.ts`) | GSM-7 extended chars cost two septets |
| CSV sniffing | Custom splitter | `papaparse` with `preview: 1` | Quoted commas, BOMs, CRLF |
| Operator email/SMS plumbing | New Resend/ClickSend calls | `sendOperatorAlert` + `sendSms` | Never-throw, name-only error discipline already tested |
| Console form UX | New state shape | `useActionState` + `FieldError` + `ActionMessage`/`ControlState` | UI-SPEC reuse mandate; WR-10 "one Message component" |
| 404 on the apex | Custom HTML response in the proxy | Rewrite to an unmatched path → `app/not-found.tsx` | Branded, inside the root layout, correct status |
| www redirect | Proxy code | Vercel domain redirect (308) | Already how every alias redirects; cached in browsers |
| Favicon packing | Binary ICO writer | one-off `npx png-to-ico` | ICO directory format has enough gotchas |

**Key insight:** every hard part of this phase already has a tested house implementation (forms, provider boundaries, RLS/grant discipline, retention purge); the new work is composition plus two genuinely new pieces — the host-aware proxy and the throttle upsert — both of which get pure tests.

## Common Pitfalls

### Pitfall 1: The 5 MB CSV promise vs the 4.5 MB platform ceiling
**What goes wrong:** a 4.6–5 MB upload dies with Vercel's 413 before the action runs, or the Server Action's 1 MB default rejects every real file.
**Why:** Vercel Functions body limit 4.5 MB; Server Actions default 1 MB [CITED].
**How to avoid:** `bodySizeLimit: '4400kb'`, app cap 4 MiB, copy says "up to 4 MB", raise `MAX_CSV_BYTES` + its test pin to match. Record the D-10 deviation in the plan.
**Warning signs:** `FUNCTION_PAYLOAD_TOO_LARGE` in Vercel logs; `Body exceeded 1 MB limit` in dev.

### Pitfall 2: The matcher stops being a single string
**What goes wrong:** three route tests throw "proxy.ts no longer exposes a single-string matcher".
**How to avoid:** keep `matcher: ['<one string>']`; put host logic in the function, not in `has` objects.

### Pitfall 3: `/audit` vs `/audits`
**What goes wrong:** an unanchored `audit` exclusion (`audit|`) opens the console's `/audits/*` to the public (proxy skipped).
**How to avoid:** `audit$|audit/` exactly like the existing `login$|login/`; pure test both directions.

### Pitfall 4: Console `/` and the moved page
**What goes wrong:** `(console)/page.tsx` and `(marketing)/page.tsx` both resolve to `/` → build error; or after the move, `revalidatePath('/')` no longer invalidates the list.
**How to avoid:** move to `(console)/clients/page.tsx`, proxy rewrite, update the two `revalidatePath` callers, keep the nav brand link at `/` (rewritten).

### Pitfall 5: Operator SMS silently `not_configured` because the global row is disarmed
**What goes wrong:** using `resolveSmsFrom` returns null while `messaging_config.enabled = false` (the current production state).
**How to avoid:** read the global row's `from_address` directly; a pure test with `enabled: false` must still send.

### Pitfall 6: SMS over one segment
**How to avoid:** drop the UUID from the SMS link, cap the business name, assert segment count = 1.

### Pitfall 7: Certificate never issues for the apex
**What goes wrong:** `verified: true`, plain HTTP 200, HTTPS handshake fails for hours (Phase 8, measured).
**How to avoid:** `vercel certs issue backdesk.com.au` (and www) if HTTPS is not 200 within the hour; proof is `curl -sI https://…` → 200.

### Pitfall 8: Founder deletes the wrong DNS rows
**What goes wrong:** Google Workspace mail breaks.
**How to avoid:** the record list names exactly the five Squarespace Defaults to delete (4 × A `@`, 1 × CNAME `www`) and lists MX/TXT/DKIM/DMARC/app/quotes rows as "do not touch"; read every one back over DoH after.

### Pitfall 9: Journal ordering on `db:generate`
**How to avoid:** generate once on a clean journal; check idx 35 `when` > 1788412215830; no-op `db:migrate` after applying proves hosted agreement (STATE.md lesson).

### Pitfall 10: New required env vars break CI and the deploy
**What goes wrong:** `OPERATOR_ALERT_PHONE` / `AUDIT_IP_HASH_SALT` added to `serverEnvSchema` without the CI dummies and the Vercel push → `tests/helpers/env.ts` refuses to run; production `getServerEnv()` throws on first use.
**How to avoid:** same commit: `env.ts` schema + pick-list, `tests/helpers/env.ts` REQUIRED, `ci.yml` block, `docs/env-vars.md`; then `npm run env:push --project backdesk` + redeploy before the feature is reachable.

### Pitfall 11: `'use server'` module exporting a constant
**How to avoid:** `BLANK_STATE`, copy, enums live in non-action modules (`tests/lint-ban.test.ts` enforces).

### Pitfall 12: Lighthouse on a walled preview URL
**How to avoid:** production apex or local `127.0.0.1` only.

## Code Examples

### Throttle upsert (drizzle `sql`, repository)
```ts
// src/db/repository/audit-requests.ts — Source: pattern from claimEscalation (INSERT … ON CONFLICT … RETURNING)
export async function bumpAuditRequestThrottle(ipHash: string): Promise<number> {
  const [row] = await getDb().execute<{ hits: number }>(sql`
    INSERT INTO audit_request_throttle (ip_hash, window_start, hits)
    VALUES (${ipHash}, date_trunc('hour', now()), 1)
    ON CONFLICT (ip_hash, window_start)
    DO UPDATE SET hits = audit_request_throttle.hits + 1
    RETURNING hits
  `);
  return row.hits;
}
```

### IP hash (pure, `src/core/intake/ip-hash.ts`)
```ts
import { createHash } from 'node:crypto';
export function hashClientIp(ip: string | null, salt: string): string | null {
  if (!ip) return null;
  const key = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip; // IPv6 /64, IPv4 whole
  return createHash('sha256').update(`${salt}:${key}`).digest('hex');
}
```

### Operator SMS from-number, ignoring the arming flag
```ts
// src/core/alerts/operator-sms.ts — reads the GLOBAL sms row (tenantId omitted) — see repository/messaging-config.ts getChannelConfig
const row = await getChannelConfig('sms');            // global row alone
const from = row?.fromAddress ?? null;                 // NOT row.enabled — the operator is not a customer
if (!from) return { ok: false, kind: 'not_configured', detail: 'no global sms from-number' };
const { CLICKSEND_USERNAME: username, CLICKSEND_API_KEY: apiKey, OPERATOR_ALERT_PHONE: to } = getServerEnv();
if (!username || !apiKey) return { ok: false, kind: 'not_configured', detail: 'clicksend credentials absent' };
return sendSms({ to, from, body, customString: `audit-request:${requestId}` }, { username, apiKey });
```
(`src/core` must stay framework-free — `getChannelConfig` is a repository import, which `src/core/messaging/routing-sender.ts` already does [VERIFIED].)

### Storage upload/download (repository, service role)
```ts
// src/db/repository/audit-uploads.ts — Source: supabase-js storage docs (upload / download)
import { createClient } from '@supabase/supabase-js';
const BUCKET = 'audit-uploads';
function storage() {
  const env = getServerEnv();
  const { NEXT_PUBLIC_SUPABASE_URL } = getClientEnv();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(BUCKET);
}
export async function putAuditUpload(path: string, bytes: Uint8Array) {
  const { error } = await storage().upload(path, bytes, { contentType: 'text/csv', upsert: false });
  return error ? { ok: false as const, detail: error.name ?? 'StorageError' } : { ok: true as const };
}
export async function getAuditUpload(path: string): Promise<Blob | null> {
  const { data, error } = await storage().download(path);
  return error ? null : data;
}
```

### Proxy pure test (host routing)
```ts
// tests/proxy-host-routing.test.ts — Source: nextjs.org proxy docs "Unit testing (experimental)"
import { NextRequest } from 'next/server';
import { getRewrittenUrl, isRewrite, unstable_doesProxyMatch } from 'next/experimental/testing/server';
import { config, proxy } from '../proxy';
// matcher: /audit excluded, /audits included
expect(unstable_doesProxyMatch({ config, nextConfig: {}, url: '/audit' })).toBe(false);
expect(unstable_doesProxyMatch({ config, nextConfig: {}, url: '/audits/requests' })).toBe(true);
// apex console path → 404 rewrite; app host / → /clients rewrite (mock updateSession's Supabase env)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` (edge) | `proxy.ts` (Node runtime default) | Next 16.0 | Node APIs (`crypto`) usable; `runtime` export forbidden in proxy |
| `unstable_after` | `after()` stable | Next 15.1 | Available for post-response work if ever needed |
| `experimental.serverActions.bodySizeLimit` | unchanged (still `experimental` key in 16.3.4) | — | Keep under `experimental` |
| Vercel apex A `76.76.21.21` only | Per-project domain card may issue an anycast pair (`216.198.79.1`, `64.29.17.1`) | 2025–26 | Read the value after attaching; never paste from memory |
| ACMA alpha-tag register (1 Jul 2026) | n/a here — operator SMS comes from the dedicated number | — | No sender-ID registration for this phase |

**Deprecated/outdated:** `middleware` file convention (renamed); `next lint` (removed in 16 — the repo already runs `eslint .`).

## Runtime State Inventory

> Not a rename/refactor phase in the runtime-state sense, but two moves touch live state; answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | none renamed; new tables/bucket only | migration 0035 |
| Live service config | Vercel domains (apex + www to add; www redirect); Squarespace DNS records; `messaging_config` global sms row read for the from-number (no change) | agent `vercel domains add` + API redirect; founder DNS checkpoint |
| OS-registered state | none | — |
| Secrets/env vars | new `OPERATOR_ALERT_PHONE`, `AUDIT_IP_HASH_SALT` (required), `BUSINESS_ABN` (optional) | env.ts + CI dummies + `env:push --project backdesk` + redeploy |
| Build artifacts | `public/brand/*` committed; `.next` font cache | none |
| Bookmarks/links | console `/` still works (rewrite); `revalidatePath('/')` × 2 → `/clients` | code edit |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `NextResponse.rewrite(url, { status: 404 })` to an unmatched path renders `app/not-found.tsx` with a 404 status | §1 | Apex console paths return 200 not-found markup; fix by returning `new NextResponse(null, { status: 404 })` or a `not-found` page route — verify in the pure proxy test and with `curl -sI` |
| A2 | The `postgres` role behind `MIGRATE_DATABASE_URL` may `INSERT INTO storage.buckets` on hosted Supabase | §6 | Migration 0035 fails with 42501 on hosted; fallback `scripts/setup-storage.mjs` (`createBucket` with service role) + `config.toml` bucket for CI — keep the bucket upsert in a separate, last statement so the table DDL is not lost |
| A3 | The no-JS Server Action submit needs an explicit `encType="multipart/form-data"` to carry the file | §5 | Without it the CSV silently arrives empty on the no-JS path; with it nothing breaks |
| A4 | Vercel build and CI have outbound access to Google Fonts at build time | §4 | `next build` fails on font fetch; fallback `next/font/local` with committed woff2 |
| A5 | `opentype.js` `font.getPath().toPathData()` produces the wordmark outlines | §4 | One-off script needs adjusting; not a runtime risk |
| A6 | Lighthouse ≥ 90 performance is reachable with the proxy invoked on `/` (Node function, `syd1`) | §10 | If TTFB drags the score below 90, exclude `/` from the matcher and move the console list rewrite to a `next.config.ts` `rewrites` rule with `has: [{ type: 'host', value: 'app.backdesk.com.au' }]` |
| A7 | `x-forwarded-for` first value is the client IP on Vercel Hobby (no trusted proxy) | §5 | Throttle keys on the wrong value; still bounded per key |
| A8 | Piggybacking the CSV purge on the stalled-digest daily route is acceptable to the owner of that route | §6 | Alternative: dedicated internal route + bearer + cron entry |

## Open Questions (RESOLVED)

1. **D-10's "≤ 5 MB" vs the 4.5 MB platform limit**
   - What we know: hard Vercel limit; console cap is 2 MiB and pinned.
   - Recommendation: 4 MiB everywhere, copy "up to 4 MB"; planner records the deviation from D-10 with this citation. No user decision needed unless the founder insists on 5 MB (then the only route is a browser-side signed upload, which breaks the no-JS requirement).
   - **Resolved (planning, 9 Sep):** gated by the `checkpoint:decision` that opens 09-03 (Task 1: `cap-4mib` recommended / `keep-5mb-copy` / `signed-browser-upload`). Migration 0035 (09-01, wave 1) already fixes the bucket `file_size_limit` at 4194304, so `cap-4mib` needs no further change and either other option would cost a follow-up migration, not a code edit.
2. **Apex console paths: 404 or redirect?** — Resolved: 404 (rewrite to not-found). `/login` on the apex also 404s; the operator uses `app.` (bookmarked on the phone since Phase 8).
3. **Console `/`** — Resolved: page moves to `/clients`, proxy rewrites app-host `/`; URL unchanged for the operator.
4. **OG image method** — Resolved: static committed PNG rendered once by headless Chrome.
5. **Rate-limit numbers** — Resolved: 5 per rolling hour bucket per hashed IP (IPv6 /64), refused with the UI-SPEC copy, honeypot hits not counted.
6. **Where the operator SMS from-number comes from** — Resolved: global `messaging_config` sms row `from_address`, `enabled` ignored; if the row has no from-number the request still saves and the console shows `notify failed` (`not_configured`). Whether the dedicated AU number is provisioned today is not readable from here (STATE/registrations show the IPND blocker was unblocked for the inbound rules) — the live SMS proof is an event-gated UAT item.
7. **Retention of uploaded CSVs** — Recommendation: 30 days or until conversion, purged by the daily digest tick; stated in `/privacy`. Needs the planner's nod on the piggyback (A8). — **Resolved (planning, 9 Sep):** A8 accepted in 09-03 Task 3: `purgeExpiredAuditUploads()` runs after `runStalledDigest` on the daily authenticated tick; 30 days or conversion (09-06 deletes the object on convert); stated in `/privacy` by 09-05.
8. **11 Sep copy** — a task with precondition: replace `copy.ts` strings; the forbidden-word test and segment tests re-run. — **Resolved (planning, 9 Sep):** 09-08 Task 3, gated by a `<precondition>` on `docs/gtm/requests/build-request-phase-9-*.md`; skipped with a recorded line when the request has not arrived (D-08).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11, `environment: node`, `fileParallelism: false`, `setupFiles: tests/helpers/env.ts`, `globalSetup: tests/helpers/global-setup.ts` [VERIFIED: vitest.config.mts] |
| Config file | `vitest.config.mts` |
| Quick run command | `npx vitest run tests/<file>.test.ts` (pure suites run bare; never set `ALLOW_REMOTE_TESTS`) |
| Full suite command | `npm test` (local stack only; CI runs it against `supabase start` after `npm run db:migrate`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LAND-01 | Matcher excludes `/audit`, `/audit/thanks`, `/privacy`, `/brand/*`, `/robots.txt`, `/sitemap.xml`; includes `/audits`, `/inbox`; apex non-marketing path → 404 rewrite; app-host `/` → `/clients` rewrite | unit (pure, `next/experimental/testing/server`) | `npx vitest run tests/proxy-host-routing.test.ts` | ❌ Wave 0 |
| LAND-01 | Every landing string free of the D-09 forbidden words; "Run by AI, checked by a human" exactly once; no em dashes; `Backdesk` spelling | unit (reads `copy.ts`) | `npx vitest run tests/marketing-copy.test.ts` | ❌ Wave 0 |
| LAND-01 | Tokens applied: `globals.css` `:root` carries the M1 hex set in both schemes; `button`/`.button` use `--accent-fg`; `audit.css` print accent green; tabular-nums on figure rules | unit (structural, extends layout-contract) | `npx vitest run tests/layout-contract.test.ts tests/brand-tokens.test.ts` | ❌ Wave 0 (`brand-tokens`) |
| LAND-01 | www → apex 308; apex HTTPS 200; app host unaffected | live (curl) | manual, recorded in `docs/external-registrations.md` | — |
| LAND-02 | zod schema: every field's error copy; phone/email normalisation; trade/band enums; all errors returned at once | unit | `npx vitest run tests/audit-request-schema.test.ts` | ❌ Wave 0 |
| LAND-02 | CSV sniff: extension + MIME set + ≥ 2 columns; size cap 4 MiB; `MAX_CSV_BYTES` pin updated | unit | `npx vitest run tests/audit-request-csv.test.ts tests/csv-mapping.test.ts` | ❌ / ✅ (pin edit) |
| LAND-03 | Honeypot → no write, no throttle bump, redirect; throttle: 6th hit in the hour refused; IP hash stable, salted, IPv6 /64 | unit (pure decision fns + action with mocked repository) | `npx vitest run tests/audit-request-throttle.test.ts tests/audit-request-action.test.ts` | ❌ Wave 0 |
| LAND-03 | `audit_requests` + throttle: RLS on, `is_operator()` policy, exact grants (SELECT anon/authenticated on requests; none on throttle), no literal-true | integration (CI local stack) | `npx vitest run tests/rls-coverage.test.ts` (map updated) | ✅ (edit) |
| LAND-03 | Insert via repository; anon read returns `[]`; operator read returns the row; status update path | integration (CI) | `npx vitest run tests/audit-request-repository.test.ts` | ❌ Wave 0 |
| LAND-03 | Alert kind `audit_request`: subject/body pure, no error text, link built from `consoleBaseUrl()`; SMS body ≤ 1 GSM-7 segment; from-number read with `enabled: false` still sends; no creds → `not_configured`; outcomes recorded on the row | unit | `npx vitest run tests/audit-request-notify.test.ts tests/sync-failure-alerts.test.ts` | ❌ Wave 0 |
| LAND-03 | Real email + SMS arrive within a minute | live (UAT) | manual; timestamps recorded | — |
| LAND-04 | List/detail render through RLS; unknown id → 404; CSV route refuses non-operator (`requireOperator`), sets attachment headers; `?request=` pre-fills name/source; CSV branch stages from the bucket object as a `File`; conversion marks `audited` + `converted_prospect_id` | unit (actions with mocked repository) + integration (CI) | `npx vitest run tests/audit-request-console.test.ts tests/operator-authorization.test.ts` | ❌ Wave 0 |
| LAND-05 | `footerIdentityLine(null)` omits ABN; with ABN includes it; brand export pin updated; module still import-free | unit | `npx vitest run tests/brand.test.ts` | ✅ (edit) |
| LAND-05 | `/privacy` renders the seven headings and the Sydney/offshore sentences | unit (render to string or structural read of the page module) | `npx vitest run tests/privacy-page.test.ts` | ❌ Wave 0 |
| LAND-06 | `robots.ts`/`sitemap.ts` outputs; per-page metadata (absolute title on `/`, OG image path, twitter card, thanks noindex); `public/brand/*` files exist with expected sizes (og 1200×630 via PNG header bytes) | unit | `npx vitest run tests/marketing-metadata.test.ts tests/brand-assets.test.ts` | ❌ Wave 0 |
| LAND-06 | Lighthouse ≥ 90 perf + a11y mobile on `/` and `/audit` | live (CLI) | `npx lighthouse@13 <url> --only-categories=performance,accessibility --output=json --chrome-flags="--headless=new"` ×3, median recorded | — |
| all | Existing gates: `tsc --noEmit`, `eslint . --max-warnings=0`, `next build` with placeholder env, secret scans | static | `npm run typecheck && npm run lint && npx next build` | ✅ |

### Sampling Rate
- **Per task commit:** the touched pure suite(s) + `npm run typecheck` + `npm run lint`.
- **Per wave merge:** `npx vitest run` over all pure suites locally (no remote), `npx next build`; CI (push) runs the full suite against the local stack including RLS coverage and the new repository test.
- **Phase gate:** CI green on `main`, DNS/HTTPS/Lighthouse/notification proofs recorded in `docs/external-registrations.md` and the phase VERIFICATION before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/proxy-host-routing.test.ts` — LAND-01 (matcher + host rewrites)
- [ ] `tests/marketing-copy.test.ts` — LAND-01 (forbidden words, single AI mention)
- [ ] `tests/brand-tokens.test.ts` — LAND-01/D-04 (token hexes, accent-fg, tabular-nums)
- [ ] `tests/audit-request-schema.test.ts`, `tests/audit-request-csv.test.ts` — LAND-02
- [ ] `tests/audit-request-throttle.test.ts`, `tests/audit-request-action.test.ts` — LAND-03
- [ ] `tests/audit-request-repository.test.ts` (CI integration) — LAND-03
- [ ] `tests/audit-request-notify.test.ts` — LAND-03
- [ ] `tests/audit-request-console.test.ts` — LAND-04
- [ ] `tests/privacy-page.test.ts`, `tests/marketing-metadata.test.ts`, `tests/brand-assets.test.ts` — LAND-05/06
- [ ] Edits: `tests/brand.test.ts` export pin, `tests/rls-coverage.test.ts` grants map, `tests/csv-mapping.test.ts` size pin, `tests/helpers/env.ts` REQUIRED + `ci.yml` dummies for `OPERATOR_ALERT_PHONE` and `AUDIT_IP_HASH_SALT`
- [ ] `docs/lighthouse/` directory (or the VERIFICATION table) for the recorded runs
- Framework install: none needed.

## Security Domain

### Applicable ASVS Categories (Level 1)
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (console side only) | Supabase `getClaims()` in layout + `requireOperator()` in every action and the CSV route; public form has no auth by design |
| V3 Session Management | yes | `updateSession` cookie refresh unchanged; marketing paths never touch the session |
| V4 Access Control | yes | `is_operator()` RLS + withheld write grants; service-role only in `src/db/repository`; storage objects reachable only via the operator-gated route |
| V5 Input Validation | yes | zod 4 schema, `normalizeAuMobile`/`normalizeEmail`, CSV sniff + size cap, user-agent cap, uuid shape checks |
| V6 Cryptography | yes | `sha256` (Node `crypto`) with a ≥ 32-byte env salt for IP hashing; no hand-rolled primitives |
| V8 Data Protection | yes | PII minimisation (no address, no free text beyond name/business), 30-day CSV purge, `ip_hash` not IP, no PII in logs (error names only), `Cache-Control: private, no-store` on the CSV route |
| V12 File upload | yes | extension + MIME allowlist + parse sniff, size cap, private bucket, `nosniff` + `attachment` on download, filename sanitised |
| V13 API | yes | Server Action CSRF Origin check (same host; no `allowedOrigins` needed), throttle |
| V14 Configuration | yes | required env with CI dummies; no secrets in `src/app`; `robots` noindex on console |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Host header spoofing to reach console pages on the public host | Spoofing | Vercel routes only project domains; classification only chooses public-vs-wall; console auth is independent (layout + actions) |
| Bot form spam / notification flooding | DoS | Honeypot (silent), 5/hour/hashed-IP atomic counter, one email + one SMS per stored row only; no notification on refusal |
| IPv6 rotation to bypass the throttle | DoS | Hash the /64 prefix; accept residual risk (deferred: Vercel WAF if abuse appears) |
| Malicious CSV (formula injection, huge file, wrong type) | Tampering | Treated as data (React escapes; no re-export); 4 MiB + 5,000-row caps before parse; sniff; `text/csv` content type + `nosniff` on download |
| PII leak via logs/errors | Information disclosure | Error *names* only; fixed sentences to the UI (`console-error-leak` test); no request body in logs |
| Prospect PII retention | Privacy | 30-day object purge; conversion consumes and deletes; stated in `/privacy` |
| Operator SMS to a stranger | Spoofing/Repudiation | Recipient is env-fixed; never a form value; tests assert `to === OPERATOR_ALERT_PHONE` |
| Email header injection via business name | Tampering | Plain-text body; subject with CR/LF stripped; Resend SDK sets headers |
| Enumeration of request ids via the CSV route | Information disclosure | `requireOperator()` first; 404 for unknown/malformed ids indistinguishable |
| Service-role key in a client bundle | Information disclosure | CI grep on `src/app`; key read only inside `src/db/repository/audit-uploads.ts` |
| Storage bucket public exposure | Information disclosure | `public = false`, no `storage.objects` policies; download only through the operator route |

## Sources

### Primary (HIGH confidence — read this session)
- Codebase: `proxy.ts`, `src/lib/supabase/{proxy,server}.ts`, `src/app/layout.tsx`, `src/app/(console)/{layout,page}.tsx`, `src/app/(console)/_auth.ts`, `src/app/(console)/audits/{page.tsx,new/*,[id]/*}`, `src/app/(console)/components/*`, `src/core/{brand.ts,shared/env.ts,alerts/operator-email.ts,messaging/clicksend-client.ts,messaging/routing-sender.ts,escalation/*,audit/csv-intake.ts,audit/csv-mapping.ts,cadence/primary-contact.ts,drafting/gsm7.ts}`, `src/db/schema/{index,prospects,operators,messaging-config}.ts`, `src/db/repository/{index,prospects,client,messaging-config}.ts`, `src/db/migrations/{0003,0014,0026,0034}.sql`, `meta/_journal.json`, `migrations/README.md`, `drizzle.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `next.config.ts`, `vercel.json`, `.github/workflows/ci.yml`, `supabase/config.toml`, `tests/{brand,rls-coverage,layout-contract,lint-ban,console-error-leak,cadence-tick-route,csv-mapping}.test.ts`, `tests/helpers/env.ts`, `scripts/migrate.mjs`, `logo/*`, `public/*`
- Planning/docs: `09-CONTEXT.md`, `09-UI-SPEC.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `PROJECT.md`, `08-04-SUMMARY.md`, `08-06-SUMMARY.md`, `docs/vercel-domains-and-protection.md`, `docs/external-registrations.md`, `docs/env-vars.md`, `docs/gtm/requests/build-request-phase-8-brand-spec.md`
- Live reads 2026-09-09: DoH (`dns.google/resolve`) for apex/www/app A/AAAA/NS/MX/TXT/CNAME; `vercel api /v9/projects/backdesk/domains`, `/v6/domains/{backdesk.com.au,www.,app.}/config`; `vercel certs issue --help`; `npx lighthouse@13 --version`; `npm view` + `gsd-tools package-legitimacy` for lighthouse, png-to-ico, opentype.js

### Secondary (MEDIUM confidence — official docs fetched 2026-09-09)
- nextjs.org (v16.3.4 docs): proxy file convention, route groups, font module, opengraph-image, serverActions config, `after`, robots, sitemap, generate-metadata, not-found
- vercel.com: functions limitations (4.5 MB body, Hobby 300 s), add-a-domain, deploying-and-redirecting, request headers (`x-forwarded-for` overwrite), KB "A record and CAA with Vercel"
- supabase.com: storage access control (service key bypasses RLS), creating buckets (SQL insert), storage schema design (bucket columns; SQL read-only for objects), file limits (Free 50 MB), downloads (`download()`, `createSignedUrl`)
- support.squarespace.com 215744668 "Pointing a Squarespace domain" (delete Squarespace Defaults; A `@` / CNAME `www` entry)
- GoogleChrome/lighthouse readme (CLI flags, `CHROME_PATH`)

### Tertiary (LOW confidence)
- WebSearch summaries on Squarespace/Vercel presets and Supabase bucket SQL (cross-checked against the official pages above)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; every library is already installed and read.
- Architecture: MEDIUM-HIGH — routing decision grounded in official docs and the codebase; two behaviours (A1 rewrite status, A2 bucket insert privilege) to verify at execution.
- Pitfalls: HIGH — most are measured facts from Phase 8 and this session (matcher parsing tests, body limits, test pins).

**Research date:** 2026-09-09
**Valid until:** 2026-10-09 (Next 16.3 / Vercel limits are stable; re-read the Vercel domain card value at execution time regardless)
