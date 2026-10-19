---
status: complete
phase: 11-telephony-capture
source: [11-VERIFICATION.md, 11-04-SUMMARY.md, 11-05-SUMMARY.md, 11-07-SUMMARY.md, 11-REVIEW.md]
started: 2026-10-05T15:00:52Z
updated: 2026-10-05T15:35:35Z
---

## Current Test
[testing complete]

## Tests

### 1. Client page checklist on the phone
expected: Thirteen checklist rows; "Divert number provisioned" shows the number; "Verification call recorded" reads verified on a date with an id; a muted "Last diverted call {date} — N days ago" line beneath it
result: pass

### 2. Divert number section has no way to lose the number
expected: The "Divert number" section shows the purchased number and the spoken name with a way to correct it; there is no release, delete or "buy another" control anywhere on the page
result: pass

### 3. Greeting on a real call
expected: Dialling the number plays an Australian female voice saying the business name, "this is an automated message and the call isn't recorded", "we're texting you now", "if your number is private, text us instead", then hangs up by itself in about 12 seconds
result: pass
note: "Reported by the founder on 2026-10-02 during plan 11-07: transcript matched word for word, hung up on its own, ~12 s; three further calls the same. The 'Test.' pause comes from the parentheses in the test tenant's name."

### 4. A stale or direct call can no longer be recorded as the verification proof
expected: On the "Verification call recorded" row, pasting the old missed-call id b79a5f9d-1edb-447c-9f94-8cc991ce2ea1 (more than 24 hours old) is refused with a sentence telling you to make a diverted call from a second phone; nothing changes on the row
result: pass

### 5. Every call shows up, and the missed-call count is believable
expected: After one more call to the number, the "Last diverted call" line updates to today within a minute of reloading the page
result: pass
note: "Direct dial (the founder has no second phone); the line updated to today. A diverted call remains untested — see 11-08-SUMMARY.md override."

## Summary
total: 5
passed: 5
issues: 0
pending: 0
skipped: 0

## Gaps
None. All five tests passed. Carried forward (not a UAT gap): no diverted call has been made yet; the first one happens at the first client's onboarding, or earlier if a second phone is available.
