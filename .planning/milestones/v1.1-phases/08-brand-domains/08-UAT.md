---
status: complete
phase: 08-brand-domains
source: [08-VERIFICATION.md]
started: 2026-09-08T10:11:50Z
updated: 2026-09-08T16:10:02Z
---

## Current Test
[testing complete]

## Tests

### 1. Resend Verified badge on the console email settings page
expected: Log in and open https://app.backdesk.com.au/settings/email. quotes.backdesk.com.au is listed with the status badge "Verified", region ap-northeast-1, the residency note unchanged, and the from-address placeholder reads followups@quotes.backdesk.com.au.
result: pass

### 2. Supabase Auth URL Configuration names the new host
expected: Supabase dashboard → Authentication → URL Configuration. Site URL and every Redirect URL name https://app.backdesk.com.au or are the local defaults; none names quote-recovery-mvp.vercel.app. If stale, correct it (a stale value only adds a 308 hop to password-reset links).
result: pass
note: "Operator reported only a Site URL of http://localhost:3000 (the local default) and no Redirect URLs; nothing names the old host. Recommended follow-up (non-blocking): Site URL → https://app.backdesk.com.au, Redirect URLs → http://localhost:3000/** so auth emails link to the console."

### 3. Triage inbox shows exactly one synthetic inbound row from the webhook proof
expected: In the console inbox, exactly one unattributed inbound row dated 2026-09-08 with ClickSend's sample content (residue of the 08-05 webhook proof on the new host). Decision already taken: leave it.
result: pass

### 4. Alert From header (event-gated)
expected: On the first real operator alert (or as a Phase 10 go-live checklist item), the alert email's From header reads: Backdesk <alerts@quotes.backdesk.com.au>. Cannot be forced without manufacturing an alert on the production database; may be marked skipped here and carried to Phase 10.
result: skipped
reason: "Event-gated; carried to the Phase 10 go-live checklist (first real operator alert)."

### 5. Phone check (already closed 2026-09-08, listed for the record)
expected: On a phone on mobile data, https://app.backdesk.com.au/login loads over HTTPS with no certificate warning; heading reads Backdesk; tab reads "Sign in · Backdesk"; nothing redirects. Founder reply "release-now, phone check done" recorded in 08-06 and STATE.md.
result: pass

### 6. Judgment-tier prohibitions review
expected: Review the 16 prohibitions table in 08-VERIFICATION.md; confirm each non-authoritative "holds" verdict; none needs a corrective task.
result: pass

## Summary

total: 6
passed: 5
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps
