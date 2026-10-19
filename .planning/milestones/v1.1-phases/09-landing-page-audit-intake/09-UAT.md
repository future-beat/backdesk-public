---
status: complete
phase: 09-landing-page-audit-intake
source: [09-VERIFICATION.md]
started: 2026-09-09T10:33:43Z
updated: 2026-09-10T10:26:11Z
---

## Current Test
[testing complete]

## Tests

### 1. Live audit request from the operator's phone (JS on): submit on https://backdesk.com.au/au
expected: /audit/thanks; email + SMS within 60 s; count 1, status=new email=sent sms=sent; row listed newest-first with Perth received time, no notify-failed badge; /audits header shows 'Requests (1 new)'. Record both arrival times in 09-VALIDATION.md
result: pass
note: "Passed 2026-09-10 after ClickSend top-up: fresh submission, email + SMS received (first attempt's sms=failed INSUFFICIENT_CREDIT was the provider balance, not code)."

### 2. Repeat one submission with JavaScript disabled in the phone browser
expected: Native multipart POST lands on /audit/thanks; a second row and a second email + SMS
result: pass
note: "Operator request while passing: remove 'Perth' from the site footer and remove the phone number (it is the founder's personal mobile). Tracked as G-09-3."

### 3. Attach a small CSV on /audit and submit; then submit a .txt renamed .csv or a real .txt; o
expected: First: row shows 'CSV attached' in the list and Download CSV on the detail page. Second: the CSV type sentence, other values preserved, re-attach hint shown. Sixth: the rate-limit sentence over 200 with no email or SMS for it (the fifth is accepted)
result: pass
note: "CSV attach and type refusal confirmed on the phone; the optional sixth-submission rate-limit check was not exercised (covered by the throttle unit tests)."

### 4. Console walkthrough on the phone, signed in: open the CSV request from /audits/requests → 
expected: File downloads with the stored filename; status badge updates; audits/new arrives pre-filled (business name, source=csv, 'Using the file attached to the request', hint 'Pre-filled from the audit request by …'); mapping step behaves as for a manual CSV; request badge reads 'audited' and the primary action becomes 'Open audit' → /audits/{prospectId}; the stored object is gone AND the detail page now reads 'No file attached' with no Download CSV button (WR-05, abfc14f) — the list no longer says 'CSV attached'
result: pass
note: "Operator also reported the landing page content does not align perfectly on desktop (PDF print supplied) — tracked as G-09-4 pending inspection."

### 5. Signed in on the phone, open https://app.backdesk.com.au/ ; then create a test client from
expected: The client list renders at / (URL bar still /); after creating a client the list refreshes with it; signed out, / redirects to /login
result: pass
note: "Browser hides the bare trailing slash on the root address; bar never showed /clients."

### 6. On a phone, light AND dark scheme, at ~390 px: open https://backdesk.com.au/ , /audit, /au
expected: Favicon on the tab; the lockup crisp in the header, switching to the Paper variant in dark, word ≥ 96 px wide, header 64 px; no sideways scroll on any page; the only green is the two 'Get the free audit' actions and the dollar figures; prices tabular and aligned; long headings, the guarantee paragraph, the privacy lists and the thanks paragraph wrap at the measure with no clipping; footer mailto: and tel: links work
result: pass
note: "Both schemes fine on the phone. ABN wraps across lines in /privacy (G-09-5). Operator revised G-09-3: keep the personal number until a dedicated Backdesk number exists; remove only the suburb."

### 7. Paste https://backdesk.com.au into WhatsApp, iMessage and Slack
expected: A card with the 1200×630 OG image (lockup on Paper with the tagline) and the title 'Backdesk · Quote chasing for Perth trade businesses'
result: pass
note: "Card rendered in WhatsApp and iMessage; Slack not available to the operator."

### 8. Open /brand/og-image.png and /brand/apple-touch-icon.png on a phone and compare against D-
expected: OG image: Paper background, lockup left, tagline in Ink, backdesk.com.au small bottom-right in Slate; touch icon: the square mark, not green, no tagline inside the mark
result: pass

### 9. Console request list and detail rendered states on the phone: with 0 rows (before the live
expected: Empty state sentence 'No audit requests yet. Requests from backdesk.com.au/audit appear here, newest first.'; rows wrap rather than widen the page; no visible loading flash; detail page wraps the long name and truncates the agent string to one line
result: pass
note: "Empty state not observable (4 rows exist); the sentence is pinned by tests/audit-request-console.test.ts. Wrapping, no flash, long-name wrap and agent-string truncation confirmed."

### 10. Ratify the 27 must_haves.prohibitions (all judgment-tier) — see the Prohibitions table bel
expected: Each prohibition marked resolved by the operator, or a follow-up filed
result: pass

## Summary

total: 10
passed: 10
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-09-1
  truth: "A prospect can submit the audit request with the optional CSV left empty (LAND-02); an empty file input must never be treated as an attachment"
  status: resolved
  resolved_by: 09-10-PLAN.md
  resolved_at: 2026-09-10
  reason: "User reported: empty optional 'ServiceM8 export' field is refused with the not-a-CSV sentence, blocking every submission without a file"
  severity: blocker
  test: 1
  artifacts: ["src/app/(marketing)/audit/actions.ts"]
  missing: ["treat a zero-byte or unnamed File part as no attachment before sniffCsv; regression test for the empty multipart part as browsers send it"]
- gap_id: G-09-2
  truth: "The primary green buttons on the landing page show readable label text (UI-SPEC C-2: --accent background with --accent-fg text)"
  status: resolved
  resolved_by: 09-10-PLAN.md
  resolved_at: 2026-09-10
  reason: "User reported: the green buttons on https://backdesk.com.au have no readable text"
  severity: major
  test: 1
  artifacts: ["src/app/(marketing)/marketing.css", "src/app/globals.css"]
  missing: ["a scoped link colour rule in marketing.css out-specifies .button and paints the label green on green; give .button/.button--lg text precedence (or exclude .button from the link rule) and pin it with a CSS-contract test"]
- gap_id: G-09-3
  truth: "The public footer and the privacy intro identify Backdesk without the founder's suburb: ABN, Perth WA, hello@backdesk.com.au and the phone number (kept until a dedicated Backdesk number exists — operator instruction 2026-09-10, revised at test 6)"
  status: resolved
  resolved_by: 09-11-PLAN.md
  resolved_at: 2026-09-10
  reason: "User reported: remove Perth from the bottom of the page (and the privacy intro). Phone number stays for now (revised at test 6)."
  severity: minor
  test: 2
  artifacts: ["src/core/brand.ts", "src/app/(marketing)/layout.tsx", "src/app/(marketing)/privacy/page.tsx", "src/app/(marketing)/copy.ts"]
  missing: ["drop the suburb segment (CONTACT_SUBURB / Perth) from footerIdentityLine and every consumer (landing footer, privacy intro + contact section, audit and report footers); keep ABN, Perth WA, email and phone; update the brand structural test and privacy tests"]
- gap_id: G-09-4
  truth: "On desktop widths the landing page's header, hero, sections and footer share one left edge (a single centred container); nothing is centred independently of the rest (UI-SPEC layout, D-05 measure)"
  status: resolved
  resolved_by: 09-11-PLAN.md
  resolved_at: 2026-09-10
  reason: "User reported: the website content on desktop does not align perfectly (PDF print). Measured live at 1440px: header/footer content at x=20, section content (.wrap) at x=228, hero h1 centred at x=417 — three different left edges"
  severity: minor
  test: 4
  artifacts: ["src/app/(marketing)/marketing.css", "src/app/(marketing)/layout.tsx", "src/app/(marketing)/page.tsx"]
  missing: ["put the header inner and footer inner inside the same .wrap as the sections; give the hero its .wrap and left-align its .measure (no auto margins) so the h1, lede and button share the 228px edge; keep phone layout unchanged; pin with the marketing CSS contract test"]
- gap_id: G-09-5
  truth: "The ABN renders as one unbreakable token wherever it appears (footer, privacy intro), never split across lines"
  status: resolved
  resolved_by: 09-11-PLAN.md
  resolved_at: 2026-09-10
  reason: "User reported with screenshot: 'ABN 00 000 000 000' breaks between lines on /privacy at phone width"
  severity: cosmetic
  test: 6
  artifacts: ["src/core/brand.ts", "src/app/(marketing)/privacy/page.tsx", "src/app/(marketing)/marketing.css"]
  missing: ["render the ABN through a helper that joins the groups with no-break spaces (U+00A0) — the brand module cannot use .replace/.split (structural pin), so build it from the four groups as an array join; or wrap it in a span with white-space: nowrap; pin with a test"]
