---
status: complete
phase: 01-foundation-tenancy
source: [01-VERIFICATION.md]
started: 2026-08-26T00:00:00Z
updated: 2026-08-26T00:00:00Z
---

## Current Test

number: 1
name: Phone walkthrough — login and client lifecycle
expected: |
  On your phone (production build or `npm run dev`): log in at /login with the operator
  credentials, create a client with real-looking profile/trade/timezone/contact-hours,
  see it in the list, open its detail page. Then hand-edit the URL to /clients/not-a-uuid
  and to a random-but-valid uuid — both must render a 404 page, never a 500 or a DB error.

## Tests

### 1. Phone walkthrough — login and client lifecycle
Login → create client → list → detail on a real phone; garbage uuid and wrong-but-valid uuid both 404.

### 2. Empty state
With zero clients (or a fresh filter), the clients list renders the "No clients yet" empty state, not a blank page or error.

### 3. Input preservation on rejection
Submit the create-client form with one invalid field (e.g. end time before start time): the error message shows AND every other field keeps your typed input (React 19 useActionState repopulation).

### 4. Supabase region attestation
In the Supabase dashboard, Project Settings → confirm the region reads ap-southeast-2 (Sydney). This closes the AU-data-residency prohibition, which is a committed sales claim.

### 5. ServiceM8 App ID recorded
Confirm the Public Application exists in ServiceM8 (Account → Developer) and its App ID is recorded on the Account/ID line in docs/external-registrations.md (App Secret stays in your password manager only).

## Summary

All 5 items PASSED (operator-verified 2026-08-26): phone walkthrough incl. uuid 404s, empty state, input preservation on rejection, Supabase region confirmed ap-southeast-2, ServiceM8 App ID 000000 recorded.

Original scope: 5 human-verification items from 01-VERIFICATION.md (automated checks passed 18/20; the two
non-passes are items 3 and 4 above). ClickSend AU number remains an external Phase 4 blocker
(IPND address), tracked in STATE.md — not a Phase 1 gap.

## Gaps

(none recorded yet)
