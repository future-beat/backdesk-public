---
phase: quick
plan: "260919-mij"
quick_id: 260919-mij
subsystem: marketing
tags: [json-ld, schema.org, seo, local-business, attribution, utm, sessionstorage, drizzle, migration, privacy]

requires:
  - phase: quick/260919-kel + 260919-lj8
    provides: logo v2 (the supplied Graphite profile tile logo-512.png is derived from), the brand render script, the served-asset contract
  - phase: 09 (landing + audit request)
    provides: the marketing layout and footer, the audit form and action, audit_requests and its console pages, PRIVACY_COPY
provides:
  - One ProfessionalService JSON-LD block on every public page, built from brand constants, claiming the Facebook page via sameAs
  - public/brand/logo-512.png — the square the three listings use, derived by the render script
  - A Facebook link in the public footer
  - First-touch arrival capture (sessionStorage, no cookie) and four nullable columns on audit_requests (migration 0037)
  - src/core/intake/arrival-source.ts — a total parser and the console line builder
  - The "Came from" line on audits/requests/[id]
affects: [marketing listings work, any future sameAs/GBP additions, audit-request attribution reporting, M4 outreach tripwire]

actuals:
  tokens: 54000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Structured data as a pure builder over brand constants, rendered once in the layout"
    - "useSyncExternalStore for sessionStorage read by a descendant of the component that writes it (effects run child-first)"
    - "Total parsers at the public boundary: unrecognised input becomes NULL, never a field error"

key-files:
  created:
    - src/app/(marketing)/structured-data.ts
    - src/app/(marketing)/arrival-source.tsx
    - src/core/intake/arrival-source.ts
    - src/db/migrations/0037_audit_request_arrival_source.sql
    - public/brand/logo-512.png
    - tests/structured-data.test.ts
    - tests/arrival-source.test.ts
    - docs/gtm/requests/response-phase-11-listings-and-source.md
  modified:
    - src/core/brand.ts
    - src/app/(marketing)/layout.tsx
    - src/app/(marketing)/copy.ts
    - src/app/(marketing)/audit/form.tsx
    - src/app/(marketing)/audit/actions.ts
    - src/app/(console)/audits/requests/[id]/page.tsx
    - src/db/schema/audit-requests.ts
    - src/db/repository/audit-requests.ts
    - scripts/brand/render-brand-assets.sh

key-decisions:
  - "Offer/Service entries skipped: the three prices live only in copy sentences, and the request forbids typing a figure a second time rather than reading it from one source"
  - "areaServed entries are named '{town} WA' so the site's list reads identically to the Google Business Profile's"
  - "The parser lives in src/core/intake/arrival-source.ts, not inline in the server action — the intake module's own header argues that a boundary reachable only through a server action can only be tested through one"
  - "No CHECK constraint on the four new columns: marketing owns the tag vocabulary, so a closed vocabulary would be a 23514 on the one write path an unauthenticated stranger can reach"
  - "First touch writes the record even when it is empty, so a direct arrival cannot be re-attributed by a later internal navigation"
  - "useSyncExternalStore with an explicit notify, because effects run child-first: the form's effect runs before the layout's capture on a first visit"

coverage:
  - id: D1
    description: "One ProfessionalService JSON-LD block on every marketing page, every value read from brand constants, no street address, no Offer/Service entries"
    verification:
      - kind: unit
        ref: "tests/structured-data.test.ts#every value comes from the brand module, compared rather than trusted"
        status: pass
      - kind: unit
        ref: "tests/structured-data.test.ts#what the block deliberately does NOT say"
        status: pass
      - kind: e2e
        ref: "live fetch of /, /audit and /guides/servicem8-quote-follow-up — JSON.parse'd, all required properties asserted, all three byte-identical"
        status: pass
    human_judgment: false
  - id: D2
    description: "logo-512.png derived from the supplied profile tile by the render script and served at 512x512"
    verification:
      - kind: unit
        ref: "tests/brand-assets.test.ts#logo-512.png is exactly 512x512, the size the listings and the JSON-LD want"
        status: pass
      - kind: e2e
        ref: "GET https://backdesk.com.au/brand/logo-512.png -> 200 image/png 8687 bytes"
        status: pass
    human_judgment: false
  - id: D3
    description: "Plain-text Facebook link in the public footer, new tab, rel noopener noreferrer, no WhatsApp and no Google link"
    verification:
      - kind: unit
        ref: "tests/structured-data.test.ts#the footer links the Facebook page, and only the Facebook page"
        status: pass
      - kind: e2e
        ref: "live fetch of /, /audit and the guide — facebook.com/backdeskau present on all three"
        status: pass
    human_judgment: false
  - id: D4
    description: "Migration 0037 applied to the hosted database before the code that writes the columns was pushed"
    verification:
      - kind: manual_procedural
        ref: "npm run cron:status (remote_test_lease rows: 0, watchdog not scheduled) -> npm run db:migrate exit=0 -> second run no-op -> information_schema shows four nullable text columns"
        status: pass
    human_judgment: false
  - id: D5
    description: "First-touch arrival capture in sessionStorage with no cookie, submitted as hidden fields, validated server-side to NULL on anything invalid, stored on the row"
    verification:
      - kind: unit
        ref: "tests/arrival-source.test.ts#parseUtmValue: the table / parseReferrerHost: a host, and only ever a host / the capture is sessionStorage, and nothing else"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#the arrival source reaches the row, and can never refuse a submission"
        status: pass
      - kind: integration
        ref: "tests/audit-request-repository.test.ts#stores the four values a tagged link produces, unchanged (CI, local stack)"
        status: pass
      - kind: automated_ui
        ref: "CDP read-only: /audit?utm_source=test&utm_medium=test -> hidden fields test/test, document.cookie empty; plain /audit -> all empty; /?utm_source=gbp -> /audit carries gbp/organic"
        status: pass
    human_judgment: false
  - id: D6
    description: "The console request page shows one 'Came from' line, or Unknown"
    verification:
      - kind: unit
        ref: "tests/arrival-source.test.ts#the console line, in every shape a request can arrive in"
        status: pass
      - kind: unit
        ref: "tests/arrival-source.test.ts#names the four columns in the console select list"
        status: pass
    human_judgment: true
    rationale: "No real request carries an arrival source yet — the line has never been read on a live row. First tagged request from the Google profile or Facebook is the proof, and it is event-gated on marketing publishing the links."
  - id: D7
    description: "The privacy notice carries marketing's sentence verbatim, dated 19 September 2026, with no mention of cookies"
    verification:
      - kind: unit
        ref: "tests/arrival-source.test.ts#the privacy notice says what happens, in the approved sentence"
        status: pass
      - kind: e2e
        ref: "live fetch of /privacy — sentence rendered once in <main>, date moved, no 'cookie' anywhere"
        status: pass
    human_judgment: false
  - id: D8
    description: "Response written for the marketing thread, with the utm rule, the skipped Offers and the two Google validators as a manual check"
    verification:
      - kind: manual_procedural
        ref: "docs/gtm/requests/response-phase-11-listings-and-source.md (committed ba706e5)"
        status: pass
    human_judgment: true
    rationale: "Whether the answer is useful to the marketing thread is a judgment only that thread can make — in particular whether they want the Offer entries restructured."

duration: 56min
completed: 2026-09-19
status: complete
---

# Quick task 260919-mij: listings structured data, Facebook footer link, and arrival source

**One `ProfessionalService` JSON-LD block built from the brand constants on every public page (no street address, no Offer entries), a Facebook footer link, and first-touch arrival capture in sessionStorage stored on four new `audit_requests` columns and printed as one "Came from" line in the console.**

## Performance

- **Duration:** 56 min
- **Started:** 2026-09-19T08:12Z
- **Completed:** 2026-09-19T09:08Z
- **Tasks:** 3
- **Files modified:** 25 (9 created, 16 modified)

## Accomplishments

- **The site claims its listings.** Until today there was no structured data at all, so `backdesk.com.au`, the Google Business Profile and `facebook.com/backdeskau` were three things a crawler had to guess were one business. One block, in the layout, so all six public pages carry the same `@id`. Verified live on `/`, `/audit` and the guide: parsed, every property asserted, all three byte-identical.
- **Every value in it is read from `@/core/brand`, not typed into the markup** — name, email, phone, city, state, the five service-area towns and the hours. A test compares each field to its constant, so the website and the Google profile cannot drift apart quietly, which is the one thing the block exists to prevent.
- **Migration 0037 applied to production before the code that writes it was pushed**, per the protocol: `cron:status` clean (`remote_test_lease rows: 0`, no watchdog), `db:migrate` exit=0, second run a no-op, then `information_schema` read back to confirm four nullable `text` columns.
- **Every audit request now says where it came from**, and does it without a cookie, a pixel, an analytics script or any third-party request: one `sessionStorage` key written once per session by the site-wide layout, read back by the form as four hidden fields, parsed server-side by a parser with no failure mode.
- **Proven in a real browser against production, without ever submitting the live form.** A tagged arrival fills the fields; a plain visit leaves them empty; and a session that *starts* on `/?utm_source=gbp&utm_medium=organic` still carries `gbp / organic` when the form is opened two pages later — which is the case the whole feature exists for.
- **Marketing has its answer**, including the rule their published links must keep and the fact that the two Google validators are a browser check only they can run (with the expected result spelled out, so "no rich results detected" is not misread as a fault).

## Task Commits

1. **Task 1: Structured data + Facebook footer link** — `384471c` (feat)
2. **Task 2: [BLOCKING] Migration 0037 + arrival source end to end** — `640926a` (feat)
3. **Task 3: Deploy, prove, answer marketing** — `ba706e5` (docs)

Plus `5c54c80` (fix) — a red test on `main` that predated this task, fixed so this work could ship green. See Deviations.

**Production:** `dpl_7iy2tGZrnXpm5kmmREjz9i8tGcCm` (Ready, 19 Sep 2026 16:59 AWST). CI green on `ba706e5` (run 35433460329).

## Files Created/Modified

**Created**

- `src/app/(marketing)/structured-data.ts` — the pure builder and its `<`-escaped serialiser
- `src/app/(marketing)/arrival-source.tsx` — the capture (layout) and the hidden fields (form)
- `src/core/intake/arrival-source.ts` — the total parser, the own-host list, and the console line builder
- `src/db/migrations/0037_audit_request_arrival_source.sql` — four nullable text columns
- `public/brand/logo-512.png` — 512×512 opaque Graphite tile, the listings' own square
- `tests/structured-data.test.ts` (21 cases), `tests/arrival-source.test.ts` (82 cases)
- `docs/gtm/requests/response-phase-11-listings-and-source.md` — the answer to the marketing thread

**Modified**

- `src/core/brand.ts` — `FACEBOOK_URL`, `SERVICE_AREAS`, `OPENING_HOURS` (18 → 21 pinned exports)
- `src/app/(marketing)/layout.tsx` — the JSON-LD block, the capture mount, the Facebook footer link
- `src/app/(marketing)/copy.ts` — the footer label, the privacy sentence, the date line
- `src/app/(marketing)/audit/form.tsx`, `audit/actions.ts` — hidden fields in, parsed values to the row
- `src/app/(console)/audits/requests/[id]/page.tsx` — four columns in the select list, the "Came from" line
- `src/db/schema/audit-requests.ts`, `src/db/repository/audit-requests.ts` — the columns and the insert
- `scripts/brand/render-brand-assets.sh` — derives `logo-512.png` from the same 720px opaque render as the touch icon

## Decisions Made

- **The `Offer`/`Service` entries were skipped, as §2 of the request permits.** The three prices exist only as sentences in `LANDING_COPY`; there is no structured source to read them from, and typing them into machine-readable markup would be the copy a search engine keeps believing after the page has moved on. The response tells marketing what it would take to have them (move the prices into a list the page renders from) and leaves that as their call.
- **`areaServed` entries are named `Perth WA`, `Mandurah WA`, …** so the site's service area reads identically to the Google profile's, rather than relying on a reader to join a bare city name to the business address.
- **No CHECK constraint on the four new columns.** Marketing owns the tag vocabulary and will invent channels without asking; a closed vocabulary would turn a new campaign into a `23514` on the one write path an unauthenticated stranger can reach. The *shape* is bounded by the parser instead, which stores `NULL` rather than refusing.
- **First touch writes the record even when it is empty.** A visitor who arrives directly and then wanders the site must not be re-attributed to whatever page they had open when they reached the form — "arrived with no link" is itself the answer for that session.
- **`useSyncExternalStore` with an explicit notify, not `useState` + `useEffect`.** Effects run child-first, so the form's effect (deep in the tree) runs *before* the layout's capture on a first page load. A `setState` filled from the form's own effect would read an empty store once and never look again — every first-visit submission unattributed, which is exactly the case the feature exists for. The React Compiler's `react-hooks/set-state-in-effect` rule refuses the naive version anyway; the ordering is the real reason.
- **`dangerouslySetInnerHTML` for the JSON-LD**, because React HTML-escapes a `<script>`'s text child and turns valid JSON into invalid JSON. Safe for a checkable reason: the string is built from compile-time constants, and `<` is escaped as `<` so nothing in it can close the element early.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A red CI on `main` that predated this task**

- **Found during:** Task 2 (after the first push, watching CI)
- **Issue:** `tests/convert-prospect.test.ts:301` still expected `--fg: #16181d` in the printed audit's `@media print` block. The previous quick task (`260919-lj8`) moved that palette to the brand's own Graphite (`#1A1F2B`) and left the assertion a version behind. It is a DB-backed suite, so it runs in CI and nowhere else — which is how it shipped green locally and failed on `main` before this task started.
- **Fix:** Updated the expectation to `#1A1F2B`, with a note recording why. The stylesheet was already correct; `tests/brand-tokens.test.ts` does the contrast arithmetic (16.47:1 on white).
- **Files modified:** `tests/convert-prospect.test.ts`
- **Verification:** CI run 35432821482 green; the run before it failed on exactly and only this assertion.
- **Committed in:** `5c54c80` (its own commit, deliberately separate from this task's work)

### Structural deviations from the written plan

**2. The arrival parser lives in `src/core/intake/arrival-source.ts`, not inline in `audit/actions.ts`**

The plan named a `sourceField()` helper inside the action. The `src/core/intake/audit-request.ts` header makes the argument against that explicitly — "a boundary that can only be exercised through a server action is a boundary that can only be tested through one" — and that is the whole reason the audit form's zod schema lives in `core/intake` rather than beside the action. The parser is the same kind of thing, so it went to the same place. The action imports it. Consequence: the parser's 40-odd table cases run in a pure suite in 10 ms instead of through a mocked server action.

**3. The console line is a `<dt>Came from</dt>` / `<dd>` pair rather than one literal string**

The request's wording is `"Came from: gbp / organic (www.google.com)"`. The page is a `<dl className="profile">` where every other fact (Mobile, Trade, Received) is a `dt`/`dd` pair, and a `dt` already reads as "label:". The rendered result is the requested line, label and value; the helper `arrivalSourceLine()` owns the value half and is what the tests pin.

**4. Two tests were added to suites the plan did not name**

`tests/audit-request-action.test.ts` (the action storing values / nulls, and the SMS left alone) and `tests/audit-request-repository.test.ts` (the columns round-tripping through a real Postgres in CI) — both because those files already hold the harness the assertions need. `tests/audit-request-action.test.ts`'s exact-object assertion on `createAuditRequest` also *had* to be updated, since the insert now carries four more keys.

---

**Total deviations:** 1 auto-fixed bug (pre-existing, blocking), 3 structural choices documented above.
**Impact on plan:** No scope creep. The bug fix was necessary to get a green CI on this task's SHA at all; the structural choices follow conventions this repo already argues for in prose.

## Issues Encountered

- **The React Compiler lint rule `react-hooks/set-state-in-effect`** refused the first version of the hidden-fields component. Chasing the right replacement surfaced the more serious bug underneath it (child-first effect ordering — see Decisions), which no lint rule would have caught and which would have silently broken attribution for exactly the first-visit case the feature is for.
- **Comment contamination in source-scanning tests**, twice: a negative match for `wa.me` and a count of `dangerouslySetInnerHTML` were both satisfied by the comments *explaining* those rules. Fixed the way this repo already does it — strip comments before any negative match, and assert the stripper did not eat the markup.

## User Setup Required

None from Code. **Owed back to the marketing thread** (all three recorded in the response file):

1. The **GBP share URL** for `sameAs`, once Google publishes the pending profile edits — a one-line commit when it arrives.
2. A run of the **Rich Results Test** and the **Schema Markup Validator** in a browser. Both are interactive pages; expect the Schema Markup Validator to detect one `ProfessionalService` with no errors and the Rich Results Test to report *no rich results detected*, which is correct for a service-area business with no published address.
3. A decision on whether they want the three prices restructured so `Offer` entries become possible without a second spelling.

## Next Phase Readiness

- The block is live and the four columns exist in production; the **first tagged request** from the Google profile or Facebook is the event that proves the "Came from" line on a real row (D6 above — the only deliverable held for human judgment on evidence, not on opinion).
- `SERVICE_AREAS`, `OPENING_HOURS` and `FACEBOOK_URL` are now the single spelling of three facts that also live on the Google profile. Any future change to the hours or the service area is one constant and a test, on both surfaces.
- Adding the GBP URL to `sameAs` is a one-line change to an array in `structured-data.ts` plus its test.

---
*Quick task: 260919-mij*
*Completed: 2026-09-19*

## Self-Check: PASSED

All nine created files exist on disk; all four commit hashes (`384471c`, `640926a`, `5c54c80`, `ba706e5`) are in `git log`. Test counts corrected against a real run (structured-data 21, arrival-source 82). No stubs: nothing in this task renders a placeholder or a hardcoded empty value — the one "empty" state (`Came from: Unknown`) is a real, expected answer with its own test, not an unwired component.
