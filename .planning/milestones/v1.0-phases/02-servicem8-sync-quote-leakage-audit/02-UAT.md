---
status: complete
phase: 02-servicem8-sync-quote-leakage-audit
source: [02-VERIFICATION.md]
started: 2026-08-27T01:45:00Z
updated: 2026-08-27T14:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Console visual pass
expected: Connect form, sync health badges (healthy/degraded/auth-failed/never-synced + last-sync time), quotes table with Open default filter, triage checklist, audits list/new/detail pages all render per UI-SPEC on desktop and a phone viewport
result: pass
notes: |
  Full walkthrough on desktop + emulated 390px phone (client list, client detail
  with connect/health/quotes/triage/sync-runs, audits list/new/detail). Two
  runtime bugs found and FIXED in-session: 'use server' const exports crashed
  the client page (Runtime Error) and the new-audit form (state.values of
  undefined) — invisible to vitest and next build. Fixed across 4 action files,
  guarded by a new repo-wide test in tests/lint-ban.test.ts. Also verified:
  page body never overflows at 390px; quotes table scrolls in .table-scroll;
  DEGRADED staleness badge (CR-02 fix) observed live; sync tick proven locally
  (backfill, contacts, sync-run row).

### 2. Auth-failure alert + re-key auto-resume
expected: Revoke the trial API key in ServiceM8 → client shows auth-failed badge + persistent red banner + exactly ONE alert email arrives (Resend A6 assumption verified live). Paste a new key → verify-on-save succeeds, pause clears, sync resumes, and previously-approved triage decisions are untouched
result: pass
notes: |
  User revoked key; tick 1 returned auth_failed/paused/alerted, tick 2 skipped
  the paused connection entirely (no second alert). Red banner + AUTH FAILED
  badge rendered. Exactly one email arrived (A6 verified live). Re-key resumed
  automatically; triage decisions intact.

### 3. Production cron tick
expected: After deploying, run `APP_BASE_URL=https://<deployed-url> npm run cron:apply`, wait ~10 minutes, then confirm BOTH `cron.job_run_details` shows runs AND `sync_runs` has fresh rows (green cron + empty sync_runs is the failure this checks for). Queries are in 02-03-SUMMARY.md §UAT
result: pass
notes: |
  Unblocked 2026-08-27 after deployment. The check first CAUGHT the exact
  failure it exists for, twice: (1) Vercel built from stale GitHub (Phase 1
  code, 64 commits behind) — cron green, sync_runs empty; (2) after pushing,
  Vercel SSO deployment protection intercepted the cron POST — still green,
  still empty. Fixes: pushed main (+ corrected the machine-local git author
  that BLOCKED the Hobby-plan deploy), disabled Vercel Authentication
  (Hobby has no previews-only scope; re-enable when a custom domain lands).
  Final state verified BOTH sides: cron.job_run_details succeeded at 06:30
  and 06:35 UTC, each paired with a sync_runs row (ok, 5 fetched/5 upserted)
  from the deployed syd1 route.

### 4. A4 print backstop
expected: A generated audit prints to exactly one A4 page via browser print preview — including from a dark-mode phone (black on white, only the Recoverable estimate in accent blue) and with a worst-case fixture (60-char business name, 7-digit values)
result: pass
notes: |
  Verified against a REAL worst-case fixture: test prospect temporarily set to
  a 60-character business name and 7-digit dollar figures (restored after).
  User confirmed via browser print preview: one page, black on white, no nav
  chrome, only the recoverable estimate in accent blue. Screen layout also
  verified at both desktop and 390px.

### 5. Phone-overflow backstop (390px)
expected: The open-quotes table with 200+ backfilled rows remains scrollable on a 390px-wide viewport and the triage Save button stays reachable
result: pass
notes: |
  Verified with 200 seeded needs_review quotes (deleted after): at 390px the
  page body never overflowed (scrollWidth 390), the quotes table scrolled
  inside .table-scroll, 200 triage checkboxes rendered, and the Save
  eligibility button was fully visible in-viewport (rect 20-370 of 390).

### 6. DB-backed integration suite
expected: `ALLOW_REMOTE_TESTS=yes npx vitest run` fully green. NOTE: the orchestrator ran this twice post-fix on 2026-08-27 — 664/664 passed. Confirm or re-run at your discretion
result: pass
notes: "User accepted the orchestrator's two full green runs (664/664 incl. all DB-backed suites)." 

### 7. Prohibition sign-off
expected: Five judged-upheld prohibitions in 02-VERIFICATION.md (plaintext-key, no-backfill-events, no-auto-chase, prospect-rows-never-in-sync-tables, audit-honesty-footnote) reviewed and explicitly signed off
result: pass
notes: |
  User signed off all five, with one catch on prohibition 1: the last-4-only
  promise was over-delivered for prospects — the audit page never showed the
  key last-4 at all, so the operator could not tell which key generated an
  audit. Fixed in-session: audit subline now shows 'key ending in XXXX'
  (screen-only, print-hidden), verified in-browser and committed.

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
