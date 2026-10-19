---
phase: quick
plan: "260919-mij"
quick_id: 260919-mij
type: quick
wave: "1"
depends_on: []
files_modified:
  - src/core/brand.ts
  - src/app/(marketing)/layout.tsx
  - src/app/(marketing)/copy.ts
  - src/app/(marketing)/structured-data.ts
  - src/app/(marketing)/arrival-source.tsx
  - src/app/(marketing)/audit/form.tsx
  - src/app/(marketing)/audit/actions.ts
  - src/db/schema/audit-requests.ts
  - src/db/migrations/0037_audit_request_arrival_source.sql
  - src/db/repository/audit-requests.ts
  - src/app/(console)/audits/requests/[id]/page.tsx
  - scripts/brand/render-brand-assets.sh
  - public/brand/logo-512.png
  - tests/
  - docs/gtm/requests/response-phase-11-listings-and-source.md
autonomous: "true"
must_haves:
  truths:
    - "Every marketing page carries exactly one application/ld+json block of type ProfessionalService whose name, email, telephone and location come from src/core/brand.ts constants (never retyped), with areaServed = Perth, Mandurah, Midland, Joondalup, Rockingham (WA), address = locality Perth / region WA / country AU and NO streetAddress, openingHoursSpecification Mon–Fri 08:00–17:00, priceRange $$, logo = a served raster of the supplied v2 square tile, sameAs = [https://www.facebook.com/backdeskau]"
    - "No Service/Offer entries are emitted: prices live only in copy strings and the request forbids typing them twice"
    - "The footer's link line carries a plain-text 'Facebook' link to https://www.facebook.com/backdeskau (rel noopener, no icon, no WhatsApp, no Google)"
    - "First-touch arrival source (utm_source, utm_medium, utm_campaign, referrer HOST only, own hosts ignored) is kept in sessionStorage (no cookie), submitted as hidden fields with the audit form, validated server-side, stored in four new nullable columns on audit_requests, and shown on the console request page as 'Came from: {source} / {medium} ({host})' or 'Came from: Unknown'"
    - "A malformed or hostile source value can never reject the form or reach the console unescaped: each field is trimmed, capped at 64 chars, charset-checked, and stored as NULL when invalid"
    - "The privacy notice gains the requested sentence verbatim and its 'Last updated' date moves to 19 September 2026"
    - "Migration 0037 is applied to the hosted database BEFORE the code that writes the columns is pushed"
  prohibitions:
    - requirement_id: LAND-05
      category: privacy
      statement: "MUST NOT store the full referrer URL, any query string beyond the three utm keys, an IP-derived location, or use a cookie, a pixel, an analytics script or any third-party request"
    - requirement_id: LAND-03
      category: product
      statement: "MUST NOT change the operator SMS (one pinned segment) or make the audit form's success depend on the source fields"
---

# Quick task: Cowork build request "Phase 11" — listings structured data, Facebook footer link, audit arrival source

Request: docs/gtm/requests/build-request-phase-11-listings-and-source.md (19 Sep 2026). Cowork numbers it "Phase 11"; in this repo's roadmap it is a quick task under milestone v1.1 (Phase 10 stays parked at the founding-client gate).

<task type="auto" id="1">
<name>Structured data + Facebook footer link</name>
<files>src/core/brand.ts, src/app/(marketing)/structured-data.ts, src/app/(marketing)/layout.tsx, src/app/(marketing)/copy.ts, scripts/brand/render-brand-assets.sh, public/brand/logo-512.png, tests/structured-data.test.ts, tests/brand.test.ts, tests/brand-assets.test.ts</files>
<read_first>src/core/brand.ts (import-free; tests pin its export COUNT and forbid .replace/.split/.normalize — read tests/brand.test.ts before adding exports); marketing layout footer block + LANDING_COPY.footer; scripts/brand/render-brand-assets.sh (derived rasters; SVG metadata strip; path-with-space handling); tests/brand-assets.test.ts EXPECTED list</read_first>
<action>brand.ts: add FACEBOOK_URL, SERVICE_AREAS (the five names), OPENING_HOURS ({ days, opens:'08:00', closes:'17:00' }) — update the export-count pin deliberately. structured-data.ts: a pure builder returning the ProfessionalService object from brand constants + APEX_DOMAIN; telephone = CONTACT_PHONE_E164, email = CONTACT_EMAIL, url = https://backdesk.com.au/, @id = url + '#business'. logo: derive public/brand/logo-512.png (512x512) from the supplied profile tile via the render script (the square the listings themselves use, so Google sees the same image on all three); add it to the served-assets test. Layout: one &lt;script type="application/ld+json"&gt; rendered from JSON.stringify with '&lt;' escaped as \u003c. Footer: 'Facebook' link, target _blank rel="noopener noreferrer", same style as the others; copy in LANDING_COPY.footer. Tests: shape + required keys, no streetAddress, no Offer/Service/price numbers, values equal the brand constants, exactly one block in the layout source, footer link present, forbidden-word scan still clean.</action>
<acceptance_criteria>- `npx vitest run tests/structured-data.test.ts tests/brand.test.ts tests/brand-assets.test.ts tests/marketing-copy.test.ts tests/layout-contract.test.ts` passes</acceptance_criteria>
<verify><automated>npx vitest run tests/structured-data.test.ts</automated></verify>
<done>The site claims its listings.</done>
</task>

<task type="auto" id="2">
<name>[BLOCKING] Migration 0037 + arrival source end to end</name>
<files>src/db/schema/audit-requests.ts, src/db/migrations/0037_*.sql, repository, src/app/(marketing)/arrival-source.tsx, audit/form.tsx, audit/actions.ts, console request page, copy.ts (privacy), tests</files>
<read_first>src/db/schema/audit-requests.ts + its repository + tests/helpers seed for audit requests; audit/actions.ts (zod schema, honeypot, how optional fields are read; the text() helper at ~line 88); audit/form.tsx (client component); console audits/requests/[id]/page.tsx; PRIVACY_COPY + the privacy tests; docs on the migration protocol in .planning/quick/*/ and 10-01-SUMMARY (cron:status gate, journal 'when' monotonic, exit status captured, no-op second run); tests/rls-coverage.test.ts (column-level pins?) and tests/audit-request-*.test.ts</read_first>
<action>Schema: utm_source, utm_medium, utm_campaign, referrer_host — nullable text. Migration via `npm run db:generate` (idx 37, 'when' > 1789103759992; second generate = no changes). PUSH PROTOCOL: `npm run cron:status` must show remote_test_lease rows: 0 and no watchdog → `npm run db:migrate; echo exit=$?` → second run no-op → only then push code. Client: a tiny 'use client' component mounted in the marketing layout that, on first load in a session, reads the three utm_* params and document.referrer's hostname (ignored when it is backdesk.com.au, www.backdesk.com.au, app.backdesk.com.au or empty) and writes ONE sessionStorage key if none exists (first-touch); wrapped in try/catch (storage can throw). Form: on mount, copy that key into four hidden inputs. Server: a sourceField() parser — trim, lower-case utm values, max 64, /^[a-z0-9._~-]+$/ for utm and a hostname pattern for the host; anything else → null; never adds a field error. Console: one line per the request's wording; 'Came from: Unknown' when all four are null; campaign appended as ' · {campaign}' when present; rendered as text. Privacy: add the sentence verbatim to the collection section and move the date line to 19 September 2026. Tests: parser table (valid, too long, script-ish, uppercase, empty, host with port/path rejected), action stores values / stores nulls, console line variants, privacy sentence present once, the layout mounts the capture component, no 'cookie' word added to the privacy copy, no document.cookie anywhere in src/app/(marketing).</action>
<acceptance_criteria>- migration applied with exit=0 and a no-op second run, recorded in the SUMMARY
- pure suites green; typecheck, lint, build clean; CI green on the pushed SHA (DB-backed audit-request suites run there)</acceptance_criteria>
<verify><automated>npx vitest run tests/arrival-source.test.ts</automated></verify>
<done>Every new audit request says where it came from.</done>
</task>

<task type="auto" id="3">
<name>Deploy, prove, answer marketing</name>
<files>docs/gtm/requests/response-phase-11-listings-and-source.md</files>
<read_first>docs/gtm/requests/response-phase-10-guide-page.md (response shape)</read_first>
<action>After CI green + production READY: fetch /, /audit and /guides/servicem8-quote-follow-up, extract the ld+json block from each, JSON.parse it, assert the required properties and that all three are identical. Browser-level proof of capture WITHOUT submitting the live form (never POST to production /audit): load https://backdesk.com.au/audit?utm_source=test&utm_medium=test with the CDP script extended to evaluate the four hidden inputs' values and sessionStorage; then a plain visit shows them empty. Write the response file: what shipped, the Offer entries skipped and why, logo choice, sameAs has Facebook only until the GBP share URL arrives (one-line follow-up), the exact console wording, the sessionStorage/no-cookie design, the validation rule (so marketing keeps utm values lowercase a–z, 0–9, . _ ~ -, ≤64 chars), and that the two Google validators are a manual check for marketing or the founder (links included).</action>
<acceptance_criteria>- live JSON-LD parsed on three pages; hidden-field capture observed live; response file written and committed</acceptance_criteria>
<verify><automated>test -f docs/gtm/requests/response-phase-11-listings-and-source.md</automated></verify>
<done>Live, proven, answered.</done>
</task>
