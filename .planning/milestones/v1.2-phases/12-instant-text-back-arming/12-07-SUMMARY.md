---
phase: 12-instant-text-back-arming
plan: 07
subsystem: marketing copy + core/onboarding + docs + ops scripts
status: complete
tags: [privacy, comp-01, comp-03, runbook, divert, s4-evidence, text-back]
requires:
  - 12-01 (missed_calls text_back_* columns, text_back_ledger_id, messaging_config 'text_back' channel)
  - 12-03 (migration 0039 live, so the timing reader runs against production)
  - 12-06 (text-back page labels the runbook names: "Client's own line", "Never text", "Save version", "Attest this wording")
provides:
  - /privacy eighth section "If you called a business that uses Backdesk" (COMP-01 callers part, D-11)
  - Twilio named as a processor in a new sentence
  - PRIVACY_CALLERS_SECTION_ID + privacyCoversCallers (src/core/onboarding/privacy-coverage.ts, import-free)
  - docs/client-divert-onboarding-runbook.md + tests/client-divert-runbook.test.ts (COMP-03)
  - npm run text-back:timing (scripts/text-back-timing.mjs), ending in text_back_armed= / sms_enabled_for_tenant= read-backs
  - COMP-01 split recorded in REQUIREMENTS.md and ROADMAP.md
affects:
  - 12-08 (arm action calls privacyCoversCallers against the deployed copy; adds the four checklist labels and two controls the runbook already names, plus a card cross-check in tests/client-divert-runbook.test.ts)
  - 12-09 (teardown is checked against the two read-back lines)
  - Phase 15 (keeps the COMP-01 wording review, first-text pointer, retention statement, and COMP-02)
tech-stack:
  added: []
  patterns:
    - runbook-contract mould with heading-anchored ORDER assertions
    - missed-calls reader mould: explicit select list, numbers reduced to booleans in SQL, both pool-close arms
    - arming read-back as two boolean lines at the end of an evidence reader
key-files:
  created:
    - src/core/onboarding/privacy-coverage.ts
    - docs/client-divert-onboarding-runbook.md
    - tests/client-divert-runbook.test.ts
    - scripts/text-back-timing.mjs
  modified:
    - src/app/(marketing)/copy.ts
    - tests/privacy-page.test.ts
    - tests/arrival-source.test.ts
    - tests/ops-scripts.test.ts
    - package.json
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
decisions:
  - "The callers section's retention paragraph describes today's behaviour only (term of the agreement, delete on request); no 90-day period until COMP-02's job exists (D-22)"
  - "sms_enabled_for_tenant reads `enabled` on the tenant's own sms row first, else the shared row, else false; from_address is never named, so the reader cannot carry a sending identity"
  - "The privacy date pin in tests/arrival-source.test.ts is now 'on or after 19 September 2026' rather than one fixed day, so the next notice change cannot break it again"
metrics:
  duration: 12min
  completed: 2026-10-06
estimate:
  tokens: 40000
  tasks: 3
actuals:
  tokens: 11500
  tasks: 3
  commits: 4
---

# Phase 12 Plan 07: Privacy callers section, divert onboarding runbook, S4 timing reader Summary

The public notice now tells a missed caller what Backdesk captured, that Twilio and ClickSend process it offshore, and how STOP works. `privacyCoversCallers` is pinned true so 12-08's arm action has a predicate to refuse on. The operator has a contract-tested 13-section runbook for putting one client on divert, pausing and offboarding them. `npm run text-back:timing` prints S4 timing with no number and ends with the two arming read-back lines 12-09's teardown checks.

## What shipped

### Task 1: the privacy notice covers callers (commit 959e4d2)
- `PRIVACY_COPY.sections` now has eight headings: What we collect; **If you called a business that uses Backdesk**; Why we collect it; Where it is held; Who else processes it; How long we keep it; Your access and correction; Contact.
- The six callers paragraphs are the RESEARCH proposal verbatim. **No sentence needed rewording**: every sentence passed the forbidden-word, punctuation, domain, spelling, single-disclosure and "only in Australia" scans as first written.
- New processors paragraph, after the pinned sentence: "If you called a business that uses Backdesk, the call is answered through Twilio. Twilio processes the call details outside Australia." Both byte-pinned sentences are untouched.
- Date line: `Last updated 6 October 2026.`
- `src/core/onboarding/privacy-coverage.ts`: `PRIVACY_CALLERS_SECTION_ID = 'callers'`, `privacyCoversCallers(sections)`. No imports, and a test asserts that.
- `tests/privacy-page.test.ts` was updated deliberately (dated 2026-10, D-11): eight headings, "eight sections" titles, and a nine-test callers block. That block checks the section's placement and content, the absence of "90 days", the Twilio paragraph, and the predicate (true on the shipped copy, false without the section, false with either provider name replaced). RED was confirmed first: 8 failures against the old copy.
- `tests/marketing-copy.test.ts` is byte-identical to the phase base and passes over the new copy.
- REQUIREMENTS.md: the COMP-01 row reads "Phase 12 (callers section, D-11) · Phase 15 (remaining wording review)" with "Partial — callers section shipped in Phase 12". The coverage sentence notes the 5 Oct 2026 split. The COMP-01 checkbox stays unchecked.
- ROADMAP.md: Phase 12 Requirements gained "COMP-01 (callers section only, D-11)". The risk-flag sentence now says the section was pulled forward. Phase 15 criterion 5 gained the parenthesis.

### Task 2: client divert onboarding runbook (commit de07154)
- `docs/client-divert-onboarding-runbook.md` has 13 `##` sections (0 to 12). The live steps end with `npm run text-back:timing` read-backs: `text_back_armed=true` after arming, `=false` after a pause or offboarding.
- On the iPhone trap and DO NOT ARM, the runbook is precise about what the reader can and cannot show. Before arming, every row reads `skipped/not_armed`, because gate rule 1 precedes `own_number`. So DO NOT ARM is keyed on `caller_present=false`. The "carrier presents the client's own line" case is caught on the first live call (`text_back_skip_reason=own_number`), with the instruction to turn text-back off.
- `tests/client-divert-runbook.test.ts` (222 lines) pins the following:
  - the 7 codes
  - 9 safety phrases
  - 7 checklist labels
  - 5 control labels
  - 3 commands
  - 5 limits
  - both read-back lines
  - 4 heading-anchored order checks
  - the shape: at least 12 sections, artefact tables, the closing no-number line, no em dash
  - 3 no-number/credential shapes

### Task 3: S4 timing reader (commit 7e9f8ac)
- `scripts/text-back-timing.mjs` runs two SELECTs and writes nothing. `--tenant` is required and must be a uuid; `--limit` is 1..50 and defaults to 10.
- The caller number and the raw ForwardedFrom column are reduced to booleans in SQL. The reader never names `caller_raw`, `to_address`, `provider_message_id`, `from_address`, `raw_payload` or `body`.
- Pinned in `tests/ops-scripts.test.ts` (7 tests plus the alias pin).

**First live output** (production, read-only, test tenant `13e8f2aa-edee-4eb1-b699-09b650674f81`, `--limit 5`, exit 0):

```
text-back calls (newest first, 5 rows)
4dbe701f-a0c9-48d8-874b-e45d572197ef  started=2026-10-05T15:33:20.718Z  ended=2026-10-05T15:33:34.000Z  completed_via=callback  after_hours=true  caller_present=true  forwarded_from_present=false  text_back_status=skipped  text_back_skip_reason=not_armed  text_back_route=-  text_back_decided_at=-  claimed=-  outcome=-  delivery_status=-  delivered=-  greeting_s=13  handler_s=-  arrival_to_delivered_s=-
24c72471-cee5-4d71-8995-6c2e1e0e7ba2  started=2026-10-02T12:50:49.594Z  ended=2026-10-02T12:51:02.000Z  completed_via=callback  after_hours=true  caller_present=true  forwarded_from_present=false  text_back_status=skipped  text_back_skip_reason=not_armed  text_back_route=-  text_back_decided_at=-  claimed=-  outcome=-  delivery_status=-  delivered=-  greeting_s=12  handler_s=-  arrival_to_delivered_s=-
71284d4a-9713-4679-a0de-8ca0fb5c9c85  started=2026-10-02T12:48:41.807Z  ended=2026-10-02T12:48:54.000Z  completed_via=reconcile  after_hours=true  caller_present=true  forwarded_from_present=false  text_back_status=skipped  text_back_skip_reason=not_armed  text_back_route=-  text_back_decided_at=-  claimed=-  outcome=-  delivery_status=-  delivered=-  greeting_s=12  handler_s=-  arrival_to_delivered_s=-
b79a5f9d-1edb-447c-9f94-8cc991ce2ea1  started=2026-10-02T12:37:30.120Z  ended=2026-10-02T12:37:43.000Z  completed_via=callback  after_hours=true  caller_present=true  forwarded_from_present=false  text_back_status=skipped  text_back_skip_reason=not_armed  text_back_route=-  text_back_decided_at=-  claimed=-  outcome=-  delivery_status=-  delivered=-  greeting_s=13  handler_s=-  arrival_to_delivered_s=-
de0dd2cd-e007-47e2-96ca-dafe12e87842  started=2026-10-02T12:36:32.549Z  ended=2026-10-02T12:36:45.000Z  completed_via=callback  after_hours=true  caller_present=true  forwarded_from_present=false  text_back_status=skipped  text_back_skip_reason=not_armed  text_back_route=-  text_back_decided_at=-  claimed=-  outcome=-  delivery_status=-  delivered=-  greeting_s=12  handler_s=-  arrival_to_delivered_s=-
samples=0
clocks: delivered_at is the carrier clock; started, ended, decided and claimed are ours. Record the stopwatch reading of handset arrival beside these figures.
text_back_armed=false
sms_enabled_for_tenant=false
```

As expected: every row is `skipped/not_armed`, `samples=0`, and both read-backs are false. Greeting durations of 12 to 13 s sit inside the S5 13 s bound. No `+61` appears anywhere in the output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The privacy date pin in tests/arrival-source.test.ts broke on the planned date move**
- **Found during:** overall verification (full bare `vitest run`)
- **Issue:** `tests/arrival-source.test.ts` pinned `'Last updated 19 September 2026.'` exactly. The plan requires the date to move to today, and the research "tests that break by design" list missed this pin.
- **Fix:** the pin now parses the date and asserts it is on or after 19 September 2026. It still refuses the old 10 September date. The change has a dated comment.
- **Files modified:** tests/arrival-source.test.ts
- **Commit:** d8c4bfb

**2. [Interpretation] "select lists name none of caller_e164 / forwarded_from_raw"**
- `caller_present` and `forwarded_from_present` can only be computed by naming those two columns inside `IS NOT NULL`. So the pin follows the missed-calls reader's rule: each appears exactly once, only in that boolean shape. The other four columns (`caller_raw`, `to_address`, `provider_message_id`, `from_address`) plus `raw_payload` and `body` are asserted absent entirely.

## Verification

- `npx vitest run tests/privacy-page.test.ts tests/marketing-copy.test.ts tests/client-divert-runbook.test.ts tests/runbook-contract.test.ts tests/ops-scripts.test.ts`: 235 passed
- `tests/arrival-source.test.ts`: passes after the fix
- `npm run typecheck`, `npm run lint`: clean
- Full bare `npx vitest run`: the only real failure was the arrival-source pin, now fixed. The other 48 "failed" files are the DB-gated suites refusing to run without `ALLOW_REMOTE_TESTS` (the remote-test guard, as designed; `test:remote` was not run).
- Live: `npm run text-back:timing -- --tenant 13e8f2aa-... --limit 5` exited 0, and all four grep gates passed.

## Known Stubs

None.

## TDD Gate Compliance

Task 1 (`tdd="true"`): RED was verified before GREEN by running the new tests against the pre-change copy (8 failures). The plan specifies a single `feat(12-07)` commit for the task, so there is no separate `test(...)` commit.

## Self-Check: PASSED

- FOUND: src/core/onboarding/privacy-coverage.ts, docs/client-divert-onboarding-runbook.md, tests/client-divert-runbook.test.ts, scripts/text-back-timing.mjs
- FOUND commits: 959e4d2, de07154, 7e9f8ac, d8c4bfb
