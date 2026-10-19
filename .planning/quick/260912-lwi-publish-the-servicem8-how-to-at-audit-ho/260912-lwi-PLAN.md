---
phase: quick
plan: "260912-lwi"
quick_id: 260912-lwi
type: quick
wave: "1"
depends_on: []
files_modified:
  - src/app/(marketing)/copy.ts
  - src/app/(marketing)/audit/how-to/page.tsx
  - src/app/(marketing)/audit/thanks/page.tsx
  - src/app/sitemap.ts
  - tests/marketing-copy.test.ts
  - tests/howto-page.test.ts
  - docs/gtm/requests/response-phase-9-how-to.md
autonomous: "true"
must_haves:
  truths:
    - "https://backdesk.com.au/audit/how-to renders two numbered lists of at most five steps each (API key; Job List CSV export) in the M1 voice, followed verbatim by the sentence the Cowork request specified, and is public on both hosts"
    - "The confirmation page /audit/thanks shows the same how-to block (or a one-line link plus the sentence) so a prospect who has just submitted can act"
    - "The steps name ServiceM8's documented menu paths only (Settings → API Keys; Settings → ServiceM8 Add-ons → Advanced Reporting Pack; Reports tab → Job List Export) and make no claim ServiceM8's docs do not support (no 'read-only' claim unless the founder confirms the option exists)"
    - "The final wording is handed to marketing as docs/gtm/requests/response-phase-9-how-to.md"
  prohibitions:
    - requirement_id: LAND-05
      category: honesty
      statement: "MUST NOT publish a menu path or permission claim that is not in ServiceM8's documentation or verified by the founder; unverifiable details are phrased as instructions to look for the item, not as a path"
    - requirement_id: LAND-01
      category: design
      statement: "MUST NOT add a nav item, a third-party script, or any new dependency; the page reuses the marketing layout, measure and copy module"
---

# Quick task: publish the ServiceM8 how-to at /audit/how-to

## Why
The Phase 9 landing-copy request §3 asked for a verified how-to at `backdesk.com.au/audit/how-to` (two numbered lists, ≤5 steps each, plus a fixed sentence) and the same block on the confirmation page, so marketing's outreach scripts can promise "I'll send you the steps". It was left as the unstarted structural half of that request. The Cowork thread flagged it on 2026-09-12.

## Sources (documented, not guessed)
- API key: ServiceM8 developer docs, Authentication — "To create an API Key, go to Settings -> API Keys" (no developer account needed). The docs do not describe key scopes; the console's existing copy says "read-only API key" and "From the prospect's own Settings → API Keys".
- Job List export: ServiceM8 Help Center "How do I generate Reports?" — enable the **Advanced Reporting Pack** add-on under **Settings > ServiceM8 Add-ons**; then in the Online Dashboard open the **Reports** tab and choose **Job List Export**, which "exports all job details in .CSV format". The article does not document a date filter for that export; the audit itself uses the last 90 days, so the prospect exports everything.

## Tasks

<task type="auto" id="1">
<name>The how-to page, its copy, the confirmation block, the sitemap entry</name>
<files>src/app/(marketing)/copy.ts, src/app/(marketing)/audit/how-to/page.tsx, src/app/(marketing)/audit/thanks/page.tsx, src/app/sitemap.ts, tests/marketing-copy.test.ts, tests/howto-page.test.ts</files>
<read_first>
- src/app/(marketing)/copy.ts (THANKS_COPY, METADATA_COPY shape, voice rules; forbidden words test in tests/marketing-copy.test.ts)
- src/app/(marketing)/audit/thanks/page.tsx and privacy/page.tsx (page shape: `wrap` > `measure`, metadata export, noindex on thanks)
- src/app/sitemap.ts and src/app/robots.ts; src/proxy.ts matcher (audit/ paths are already public)
- src/app/(console)/audits/new/form.tsx lines 100-140 (existing key copy to reuse)
- .planning/quick/260912-lwi-publish-the-servicem8-how-to-at-audit-ho/260912-lwi-PLAN.md §Sources
</read_first>
<action>
Add `HOWTO_COPY` to copy.ts: title/description metadata; h1 "How to give Backdesk your ServiceM8 data"; a one-line intro ("Two ways. Either one takes a couple of minutes; the key gives the more accurate audit."); list A "Option 1 — an API key" with ≤5 steps built ONLY from the documented path: sign in to ServiceM8 on a computer → open Settings → open API Keys → create a key and give it a name like "Backdesk audit" → copy the key; list B "Option 2 — the Job List export" ≤5 steps: Settings → ServiceM8 Add-ons → turn on Advanced Reporting Pack (free to enable; say "if it's not already on") → Reports tab → Job List Export → save the CSV. Then the sentence VERBATIM: "Send the key or the file to hello@backdesk.com.au or reply to Hesam's text. Backdesk sees quotes, job statuses and the customer details on those quotes. Nothing else. If you don't go ahead, we delete it after 30 days." Add one honest line under option 1: "You can delete the key in the same screen whenever you like." Do NOT write "read-only" on this page unless the founder confirms (leave a `// FOUNDER-VERIFY` comment in copy.ts naming the two things to confirm on the trial account: whether API Keys offers a read-only/limited option, and whether Job List Export has a date filter). Email address from the brand module, not a literal.
Create `audit/how-to/page.tsx` (server component, `wrap` > `measure`, metadata from HOWTO_COPY, indexable, one h1, two `<ol>` lists, the sentence as a paragraph, a "Back to the audit form" link to /audit). On `/audit/thanks` add the same block beneath the body: the two options as a compact version (or the two lists verbatim — keep it under the measure) plus the sentence, and a link to /audit/how-to. Add `/audit/how-to` to sitemap.ts. Tests: extend tests/marketing-copy.test.ts so the forbidden-word scan covers HOWTO_COPY; new tests/howto-page.test.ts pinning: two ordered lists, each ≤5 `<li>`, the exact sentence present once on how-to and once on thanks, the metadata title present, sitemap includes `/audit/how-to`, and no occurrence of "read-only" in HOWTO_COPY.
</action>
<acceptance_criteria>
- `grep -c "Send the key or the file to" 'src/app/(marketing)/copy.ts'` → 1 (defined once, rendered on both pages by reference)
- `grep -c "/audit/how-to" src/app/sitemap.ts` → 1
- `npx vitest run tests/howto-page.test.ts tests/marketing-copy.test.ts tests/privacy-page.test.ts` passes
- `npm run typecheck && npm run lint` clean; `npx next build` lists `/audit/how-to` as a static route
</acceptance_criteria>
<verify><automated>npx vitest run tests/howto-page.test.ts tests/marketing-copy.test.ts</automated></verify>
<done>The page and the confirmation block exist with documented steps only; pinned.</done>
</task>

<task type="auto" id="2">
<name>Deploy, prove, and hand marketing the wording</name>
<files>docs/gtm/requests/response-phase-9-how-to.md</files>
<read_first>
- docs/gtm/requests/build-request-phase-9-landing-copy.md §3 (the request) and the Code→Cowork channel description in docs/gtm/backdesk-launch-plan.md §4
</read_first>
<action>
Push `main`; wait for the production deployment READY; `curl -s -o /dev/null -w '%{http_code}' https://backdesk.com.au/audit/how-to` → 200 and `https://app.backdesk.com.au/audit/how-to` → 200; `curl -s https://backdesk.com.au/sitemap.xml | grep -c how-to` → 1. Write `docs/gtm/requests/response-phase-9-how-to.md` (From: Code thread; To: Cowork thread): the live URL, the final wording of both lists and the sentence verbatim (so M4 §4.8 can quote it), the two items the founder must verify on the trial account before Tier 1 calls (read-only option; date filter), and the note that the confirmation page carries the same block. This file is the ONLY thing under docs/gtm/ this task writes; do not stage any other docs/gtm file.
</action>
<acceptance_criteria>
- live 200 on both hosts recorded; sitemap contains the path
- `ls docs/gtm/requests/response-phase-9-how-to.md` exists and contains the verbatim sentence
</acceptance_criteria>
<verify><automated>curl -s -o /dev/null -w '%{http_code}' https://backdesk.com.au/audit/how-to | grep -qx 200</automated></verify>
<done>Live, proven, and handed to marketing.</done>
</task>

</tasks>

## Verification
Founder human-check (recorded in the SUMMARY as owed): on the ServiceM8 trial account confirm (1) Settings → API Keys exists and whether a key can be limited/read-only, (2) Settings → ServiceM8 Add-ons → Advanced Reporting Pack, Reports → Job List Export produce a CSV, and whether a date filter exists. Copy is adjusted in a follow-up if either differs.
