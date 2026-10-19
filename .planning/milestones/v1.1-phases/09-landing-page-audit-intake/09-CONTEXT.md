# Phase 9: Landing Page & Audit Intake - Context

**Gathered:** 2026-09-09 (decisions from the product thread, the Phase 8 close-out, the Cowork M1 brand spec approved 7 Sep 2026 and the M2 offer sheet; no separate discuss-phase run)
**Status:** Ready for planning

<domain>
## Phase Boundary

A prospect on a phone finds `https://backdesk.com.au`, reads the offer, and requests a free Quote Leakage Audit without an account. The request is stored tenant-independently, the operator is notified by email and SMS within a minute, and the operator can open the request in the console and start the audit pre-filled in the existing `audits/new` flow. The site carries a privacy notice and contact details, and scores ≥ 90 Lighthouse performance and accessibility on mobile with correct metadata, Open Graph image and favicon. Requirements: LAND-01..LAND-06.

Not in this phase: arming, live proofs, go-live (Phase 10); changes to cadence SMS/email wording (see Deferred); blog/CMS/SEO content; analytics beyond what Lighthouse needs.

</domain>

<decisions>
## Implementation Decisions

### Delivery surface and routing
- **D-01:** The landing site ships inside this Next.js project (no second repo or Vercel project). A `(marketing)` route group holds `/`, `/audit`, `/audit/thanks` (confirmation) and `/privacy`. `backdesk.com.au` and `www.backdesk.com.au` are attached to the `backdesk` Vercel project; `www` 308-redirects to the apex. The console stays on `app.backdesk.com.au`.
- **D-02:** `proxy.ts` becomes host-aware: marketing routes are public on every host; on the apex/www host, console paths never render (redirect to the app host or 404 — research decides); on the app host, `/` keeps its current console behaviour. The existing invariant stands: server actions authorise their own callers; the proxy is only the first line.
- **D-03:** Apex DNS is a founder action (registrar = Squarespace): replace the four Squarespace parking A records with Vercel's recommended A record(s) and point `www` CNAME at Vercel's target; remove the Squarespace site binding. **Never touch** the apex MX (`smtp.google.com`), SPF, `google._domainkey`, `_dmarc`, or `google-site-verification` records — they are Google Workspace mail. Plan a `checkpoint:human-action` with the exact record list and DoH read-backs (sandbox `dig` is a stub). Expect Vercel to need `vercel certs issue` again if auto-issue stalls (Phase 8 lesson).

### Brand, tokens, type (from the approved M1 build request `docs/gtm/requests/build-request-phase-8-brand-spec.md`)
- **D-04:** Adopt the M1 design tokens verbatim (Paper `#FAFAF7`, Ink `#14213D`, Slate `#5B6470`, line `#D9DDE3`, Recovered green `#1B7A4A` / dark `#4CBF86`, unchanged ok/warn/error) as the CSS variables in `src/app/globals.css`, replacing the generic blue accent. Both colour schemes are mandatory (operator uses the console in dark on a phone). Green is for dollar figures and the one primary action per page only — never chrome, borders or badges.
- **D-05:** Type: Inter 400/600/700 via `next/font/google` (self-hosted at build, no runtime external request) for the landing pages; headings 600 with `letter-spacing: -0.02em`; body 17–18 px on phone, line-height 1.55, max measure 38 em. Wordmark = the text `Backdesk` in Inter Tight 700, `letter-spacing: -0.03em`, Ink (Paper in dark), never green, never with a tagline inside. Console keeps `system-ui`.
- **D-06:** Brand assets are SUPPLIED, not redrawn (Cowork build request update 8 Sep 2026): source files in `logo/` at the repo root — `backdesk-lockup.png` (mark + word, 1472×540; PRIMARY logo for the landing header, the Open Graph image and profile images), `backdesk-wordmark-ink-on-paper.png` and `backdesk-wordmark-paper-on-ink.png` (3696×924), `backdesk-mark-720.svg` (square mark for favicon/profile), `backdesk-favicon.svg`. Copy them into `public/brand/` (keep the PNGs, add `favicon.svg` from `backdesk-favicon.svg` plus a generated `favicon.ico`, and an `og-image.png` 1200×630 composed from the lockup: Paper background, lockup left, the tagline "Every quote chased until it's won or dead." in Ink, `backdesk.com.au` small bottom-right in Slate). The landing header shows the lockup as an image with `alt="Backdesk"` (sized so the word renders ≥ 96 px wide); the plain text wordmark (Inter Tight 700) remains the rule for audit/report headers, email footers and the console header. Never in green; no tagline inside the mark.
- **D-07:** Phase 8 deliberately deferred the visual restyle (Phase 8 D-04). This phase applies the tokens to the shared `globals.css`, so the console, login, audit page and monthly report pick up the palette; add `font-variant-numeric: tabular-nums` on dollar figures in the audit and report CSS. No layout changes to the A4 pages beyond that.

### Copy (source of truth and timing)
- **D-08:** Copy source of truth is the Cowork thread (offer sheet revised 9 Sep 2026: the Pipeline Manager blurb no longer says extras roll out to founding clients first — use the current docx text): M1 positioning/tagline/voice (`docs/gtm/m1-brand-basics.docx`) and the M2 offer sheet (`docs/gtm/m2-offer-sheet.docx`). The dedicated landing-page copy build request arrives from the Cowork thread on Fri 11 Sep 2026 under `docs/gtm/requests/`. The UI-SPEC locks structure, hierarchy and the copywriting contract now and uses the M2 sentences as the initial copy; the planner treats "swap in the 11 Sep copy" as a task with a precondition, not a blocker.
- **D-09:** Voice rules are binding on every string: outcome first, never "AI-powered/automation/agent/bot/dashboard/platform/leverage/seamless"; AI appears once as "Run by AI, checked by a human"; no competitor names; ranges and "estimated" on figures; positioned against inaction. The positioning statement, tagline "Every quote chased until it's won or dead.", the four "How it works" steps, the pricing table (Quote Chaser $597, Pipeline Manager $997, setup $990, founding five $297 × 3 months), the guarantee paragraph, "Your customers, your name", "A good fit" and the footer are the sections — in that order.

### The audit request form (LAND-02/03)
- **D-10:** Fields: business name, contact name, mobile, email, trade (select: electrical, plumbing, HVAC, solar, patios/outdoor, painting, landscaping, small builder, other), ServiceM8 user (yes/no), approximate quotes per month (select bands: <8, 8–15, 16–30, 30+), optional Job List CSV (`.csv`, text/csv, ≤ 5 MB), a privacy consent line linking to `/privacy`, honeypot field (visually hidden, named plausibly), and a submit button. Progressive enhancement: the form must work without client JS (server action / route handler POST) and enhance with inline validation.
- **D-11:** Storage: a new tenant-independent `audit_requests` table (id, created_at, fields above, `csv_object_path` nullable, `ip_hash`, `user_agent`, `status` enum new/contacted/audited/declined, `converted_prospect_id` nullable), written with the service-role client from the server; RLS denies anon/authenticated by default. CSV files go to a private Supabase Storage bucket (`audit-uploads`), never public, path keyed by request id; MIME and size checked server-side before upload.
- **D-12:** Abuse controls without paid infra: honeypot → silent 200 with no write; per-IP rate limit via a Postgres counter table (e.g. 5 submissions / hour / hashed IP) → refused with a plain message; server-side field validation with zod; no CAPTCHA in v1 (the anti-profile filter happens at the audit, not the form).
- **D-13:** Notification within one minute: after the insert, the same request sends an operator email via the existing `sendOperatorAlert` path (new alert kind `audit_request`) and an SMS via the existing ClickSend `sendSms` to the operator's handset (new env `OPERATOR_ALERT_PHONE`, E.164; documented in `docs/env-vars.md`), both from the brand sender. Notification failure must not lose the request: the row is written first; a failed notification is logged and shown in the console list as "notify failed".
- **D-14:** Confirmation: `/audit/thanks` says what happens next in the M1 voice ("We'll look at your ServiceM8 data and come back within one business day with the number") and repeats the contact email/phone. No account, no login link.

### Console side (LAND-04)
- **D-15:** `/audits/requests` (list, newest first, status badges) and `/audits/requests/[id]` (detail: fields, CSV download link served through an authenticated route, status control, "Start audit" button). "Start audit" opens `audits/new` pre-filled: business name; `source=csv` with the stored file when present, else `source=api_key` (the operator obtains the key from the prospect). Converting sets `converted_prospect_id` and status `audited`.

### Compliance, contact, metadata (LAND-05/06)
- **D-16:** `/privacy` is a real privacy notice in plain English (APP 1/5 shape): what is collected on the form and by the service, why, where it is held (Supabase Sydney), which providers process outside Australia (Resend, ClickSend, Anthropic), retention, access/correction, contact. Footer everywhere: `Backdesk · ABN [from config] · Perth WA · hello@backdesk.com.au · 0491 578 888`. The ABN is issued: **00 000 000 000** (business name Backdesk registered with ASIC 8 Sep 2026; Cowork build request update). Put it in the brand module as a constant and render it in every footer (landing, privacy, audit page, monthly report). Keep the rendering helper tolerant of an empty value so a future entity change cannot print a placeholder.
- **D-17:** Contact and legal identity values live in the brand module (`src/core/brand.ts`) alongside the existing exports (business ABN optional, contact email, phone, suburb), so the landing page, privacy page, audit page footer and monthly report footer read one source. Keep the module import-free and update its structural test.
- **D-18:** Metadata per page (`title`, `description`, Open Graph, Twitter card), `robots` allow, `sitemap.xml` and `robots.txt` routes, `<link rel="icon">` from `public/brand/`. Lighthouse ≥ 90 mobile for performance and accessibility on `/` and `/audit`; measure with the Lighthouse CLI in CI or a documented manual run (record the numbers). No third-party scripts, no analytics in v1.
- **D-19:** Accessibility: semantic landmarks, one `h1` per page, form labels bound to inputs, errors announced via `aria-describedby` (reuse the console's `FieldError` pattern), visible focus, colour contrast per the M1 table, target size ≥ 44 px on the phone.

### Claude's Discretion
- Component structure of the marketing route group (server components only where possible), CSS approach (plain CSS modules or global classes consistent with the console — no Tailwind, no UI library), OG image generation method, exact rate-limit numbers, Storage bucket naming, sitemap route mechanics.
- Whether `www` redirects at Vercel domain settings (preferred) or in `proxy.ts`.

</decisions>

<specifics>
## Specific Ideas

- The page should read like the M2 offer sheet laid out for a phone: number first, four steps, the price table, the guarantee "precisely", who it's for, how to start. One primary green button: "Get the free audit" → `/audit`.
- Dollar figures on the site are ranges or examples marked "example"; the only real number a prospect ever sees is their own audit.
- The form is short enough to finish while waiting at a wholesaler counter; the CSV upload is clearly optional ("If you have a Job List export handy, attach it and the audit is faster").
- The console request list must be usable on the operator's phone between meetings, like the queue.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Brand and copy
- `docs/gtm/requests/build-request-phase-8-brand-spec.md` — approved M1 tokens, type, wordmark, asset list, footer copy (sections 1–4 apply here; section 5 messaging copy is deferred, see below)
- `docs/gtm/m1-brand-basics.docx` — positioning, tagline, voice guide, words to say / not say
- `docs/gtm/m2-offer-sheet.docx` / `.pdf` — the offer copy the landing page is built from; pricing, guarantee, fit
- `docs/gtm/backdesk-launch-plan.md` §3–4 — what the marketing thread expects from Phase 9 and how build requests arrive

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` LAND-01..06; `.planning/ROADMAP.md` §Phase 9 (success criteria); `.planning/PROJECT.md` Business Context + Key Decisions (Phase 8 rows on DNS, Vercel protection, certificates)

### Code surfaces to reuse
- `src/app/(console)/audits/new/` (form.tsx, actions.ts, action-state.ts) + `src/core/audit/csv-intake.ts`, `csv-mapping.ts` — the intake this phase pre-fills
- `src/core/alerts/operator-email.ts` (`sendOperatorAlert`, `alertSubject`, `alertBody`) and `src/core/messaging/clicksend-client.ts` (`sendSms`) — notification paths
- `src/core/brand.ts` + `tests/brand.test.ts` — brand source of truth and its structural pins (Phase 8)
- `proxy.ts`, `src/lib/supabase/proxy.ts`, `src/app/(console)/layout.tsx` — route gating to extend host-awareness
- `src/app/globals.css`, `src/app/(console)/audits/[id]/audit.css`, `src/app/(console)/reports/[client]/[reportId]/report.css` — token surfaces
- `docs/vercel-domains-and-protection.md`, `docs/external-registrations.md` — Phase 8 domain evidence and the certificate lesson; `docs/env-vars.md` — env contract

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Console form pattern (server action + `action-state` + `FieldError` with aria wiring) — reuse for the public form so validation UX matches.
- `sendOperatorAlert` already builds branded operator emails; `sendSms` already sends via the dedicated AU number.
- Drizzle migrations via `npm run db:generate` / `db:migrate` (journal-ordering trap recorded in STATE.md — generate on a clean journal).

### Established Patterns
- Every mutating server action authorises itself; public form actions must instead enforce honeypot + rate limit + zod and write with the service-role client only.
- Tenant safety: `forTenant()` closure for tenant tables; `audit_requests` is tenant-independent by design and needs an explicit RLS policy set (deny by default).
- Live proofs recorded as dated entries in `docs/external-registrations.md`.

### Integration Points
- Vercel project `backdesk`: add apex + www; Standard Protection keeps the custom production domains public (measured in Phase 8).
- The `(console)` layout re-checks auth independently of the proxy — marketing pages must not sit under it.

</code_context>

<deferred>
## Deferred Ideas

- **M1 build request §5 messaging copy** (still deferred after the 8 Sep update) — SMS footer `[Business] · Reply STOP to opt out`, email From `[First name] at [Business] <quotes@…>`, expanded email footer (ABN, suburb, AI disclosure line), operator-alert subject prefix, audit/report footer wording with ABN. These change Spam Act identification strings Phase 8 built and tested (`"{business} via Backdesk"`, identity line). Needs a founder decision and its own quick task (or Phase 10 onboarding scope); flagged in the Phase 9 close-out.
- Analytics / conversion tracking — after the founding five; must stay privacy-respecting and script-light.
- Blog, case-study pages, bookkeeper partner page — Cowork M7/M8 deliverables; add routes when copy exists.
- CAPTCHA or Vercel WAF rate limiting — only if abuse appears.

</deferred>

---

*Phase: 09-landing-page-audit-intake*
*Context gathered: 2026-09-09 (updated same day for the Cowork build-request revision: ABN issued, brand assets supplied in `logo/`)*
