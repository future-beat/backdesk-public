---
phase: 10-first-client-go-live
plan: 06
subsystem: docs
tags: [runbook, servicem8, vitest, operator-process, clicksend, resend]

requires:
  - phase: 10-01
    provides: the nine-key go-live checklist and its ITEM_LABELS — the row names the runbook quotes verbatim
  - phase: 10-02
    provides: clicksend:balance, escalations:recent, cadence:status, resend:email-status, cron:status — the machine steps the runbook names
  - phase: 10-03
    provides: the arm/disarm control labels and the arm-then-confirm warning the runbook walks the operator through
  - phase: 10-05
    provides: the two proof rows, the Record proof control and the 'SMS: Live' / 'Email: Live' lines the runbook ends on

provides:
  - "docs/first-client-go-live-runbook.md — eighteen numbered steps from signed agreement to first observed cadence send, each naming its screen or script and the artefact that proves it"
  - "tests/runbook-contract.test.ts — 48 pins over every checklist label, control label, npm script and housekeeping item, plus a credential-shape negative, bare on npm test"
  - "docs/servicem8-api-notes.md §ServiceM8 own-comms — the 11 Sep re-measure (first non-empty read of sms.json/email.json) and the recorded Tier 1 decision"
  - "docs/external-registrations.md — the rehearsal entry (balance + cron read-backs) and the probe entry (account, request count, exit code, row counts)"
  - ".planning/PROJECT.md — the armed-vs-live gate shape and the DOM-04 rewording as Key Decisions"

affects: [10-07, 10-08, phase-11, go-live-window]

actuals:
  tokens: 13037
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A process document is pinned by a pure docs-contract test, so a console label rename breaks the build instead of silently stranding the runbook"
    - "A measurement script records field NAMES and never values, so a live account's payload can be characterised in a committed file without putting a customer in git"

key-files:
  created:
    - docs/first-client-go-live-runbook.md
    - tests/runbook-contract.test.ts
  modified:
    - docs/servicem8-api-notes.md
    - docs/external-registrations.md
    - .planning/STATE.md
    - .planning/PROJECT.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Tier 1 ServiceM8 drift detection is 'designable PENDING ONE UNREAD VALUE', not 'designable' — the shape is right but the discriminator was deliberately not read"
  - "No Tier 1 code this phase: D-09's escape hatch admits it only as a small addition to the staleness nag, and a per-client poll with its own cursor and a correlation against send_ledger is not that. D-15 stays Tier 2"
  - "The re-measure was seeded and run on the TRIAL account only — no founding client is signed, and after an ONB-04 attestation a client account is permanently off limits for this"
  - "The runbook's balance step tells the operator to top up manually rather than trust auto-recharge, because the rehearsal read three cents with auto-recharge ON"

patterns-established:
  - "Read a probe's derived booleans with their regex in hand: hasJobUuidAttribution:false was a naming artefact and timestampFields over-reported on a substring match — both would have been wrong at face value"
  - "Historical doc sections are labelled and marked superseded in place rather than rewritten, so a reader never meets a stale assertion as if it were current"

requirements-completed: [ARM-04, ARM-05]

metrics:
  duration: "~55 min across two sessions (15:44–16:39 AWST 2026-09-11; a checkpoint pause sits between Task 1 and Task 3)"
  completed: 2026-09-11

status: complete
---

# Phase 10 Plan 06: Go-Live Runbook and the ARM-04 Re-measure Summary

The written path from signed agreement to first cadence send now exists and is pinned by 48 contract assertions, and the ServiceM8 own-comms question that has sat open since 1 September has a measured answer: **both endpoints returned 200 with one row each — the first payload either has ever shown — and Tier 1 drift detection is designable pending a single unread discriminator value, so D-15 detection stays Tier 2 unchanged.**

## What Was Built

**Task 1 (prior session, commits `05a7ef8` + `95ded05`)** — `docs/first-client-go-live-runbook.md`: a "Before anything" block (the hosted Sydney Supabase *is* production; never `test:remote` in a window; `cron:status` yes, `cron:apply` never; two handsets and which stands in for the tradie's escalation phone), then eighteen `### N.` steps in the D-10 order, each with a `Where | Artefact that proves it` table, ending on "What each proof is and is not" and an evidence-entry template. `tests/runbook-contract.test.ts` pins every label, script and housekeeping string plus a credential-shape negative. Both machine steps were rehearsed read-only against production and their printed lines recorded in `docs/external-registrations.md`.

**Task 2** — operator checkpoint; resolved below.

**Task 3 (commit `63d30f4`)** — the probe, the re-measure, the decision, and the two project-file records.

## The ARM-04 Measurement

`node scripts/sm8-spike.mjs probe`, trial account, private `X-API-Key`, **exit 0**, two GET requests, nothing written:

| Endpoint | HTTP | Rows | Previously (1 Sep) |
|---|---|---|---|
| `GET /api_1.0/sms.json` | 200 | **1** | 200, 0 rows |
| `GET /api_1.0/email.json` | 200 | **1** | 200, 0 rows |

Nine field names on `sms.json`, seventeen on `email.json` — recorded in full in the notes, names only.

**The two derived booleans do not mean what they say, and this is the finding that mattered most.** `hasJobUuidAttribution: false` is the probe's `/job.*uuid|uuid.*job/i` test over field names; ServiceM8 simply does not name the field `job_uuid`. Both endpoints carry **`related_object` + `related_object_uuid`** — the polymorphic attribution pair, the only candidate in either row, and very likely the "something that resolves to a job UUID" the deferred condition allowed. Taken at face value the flag would have closed Tier 1 as impossible. Equally, `timestampFields` lists `sent_by_staff_uuid` only because the regex matches the substring `sent`; the genuine send timestamp is the single field `timestamp`.

**Tier 1 decision.** Timestamp half: met. Attribution half: met in shape, unmet in value — the probe records no values by design, so whether `related_object` reads `Job` for a job-context send is still unknown. Hence *designable pending one unread value*, not designable. No Tier 1 code was written: D-09's hatch admits it only as a small addition to the staleness nag, and Tier 1 needs a per-client poll of two more endpoints, its own cursor, a correlation against `send_ledger` (or it would flag our own ServiceM8-side activity), and a decision about what a match does to a live cadence. **D-15 detection stays Tier 2 — attestation plus the 30-day nag — unchanged.** The follow-up is named in the notes and event-gated on the first founding client: confirm the discriminator, and re-measure against an *automation*-generated send rather than a manual one.

## Checkpoint Resolution (Task 2)

Operator, verbatim: `seeded: manual-sms-email, auto-recharge is on, no clients yet` (2026-09-11 AWST).

- **Seeding** was option (b) — one SMS and one email sent from inside ServiceM8 on the **trial** account (tenant `13e8f2aa…`). Recorded in both the notes and the evidence entry, including that it was manual rather than automation-generated, which is exactly why the automation shape remains on the next-measurement list.
- **Auto-recharge on** — and the 10-02 rehearsal read `0.029806 AUD` *with it on*. The runbook's step 7 gained a line: auto-recharge only proves itself on a send, so run `npm run clicksend:balance` immediately before the CON-03 window and top up manually if it is still under threshold rather than trusting the setting.
- **No clients yet** — recorded in STATE.md: waves 5–6 (plans 10-07, 10-08) are event-gated on the first signed founding client and the phase parks there. Nothing in the repo blocks them.

## Deviations from Plan

**1. [Rule 1 — Bug] The 1 September prose asserted something the re-measure made false**

- **Found during:** Task 3, placing the new section where the plan said ("after the 1 Sep table")
- **Issue:** `docs/servicem8-api-notes.md` stated "**The response SHAPE is still unmeasured, because the trial account has never sent an SMS or an email through ServiceM8**", and the Consequence section gave Tier 1's blocker as "we have never seen a row". With the re-measure inserted above them, a reader would meet both as current statements.
- **Fix:** the new block sits where the plan asked; the paragraphs below are labelled `### The 1 September reading (historical …)` and each carries an inline superseded note pointing at the re-measure. Nothing was deleted — the record of what was known on 1 September is the point of keeping it.
- **Files modified:** `docs/servicem8-api-notes.md` — **Commit:** `63d30f4`

**2. [Scope] The "next measurement" list was rewritten rather than amended**

The plan said to update it to reflect what is still unknown; the old list's three steps were entirely about getting a row at all, which is done. It is replaced by the discriminator value, the automation shape, and the (unchanged, still unmeasured) cursor/volume behaviour.

No deviation was needed on the balance script — `npm run clicksend:balance` printed its fields correctly in the Task 1 rehearsal.

## Verification

- `npx vitest run tests/runbook-contract.test.ts` — **48 passed**, well above the 30-assertion bar.
- `node scripts/sm8-spike.mjs probe` — exit 0.
- Bare `npm test` — **3073 tests passed, zero assertion failures**. 43 test *files* error at import with the single message `Refusing to run integration tests against a non-local Supabase`: that is the designed hosted-DB guard, not a regression, and `test:remote` was deliberately not run (it pauses the deployed crons).
- Acceptance greps: `Re-measured`=1, `hasJobUuidAttribution`=2, `Decision`=2 in the notes; `SUPERSEDED`≥2 in STATE.md; `Go-live gate shape`=1 and `DOM-04 reworded 2026-09-11`=1 in PROJECT.md; `sm8-spike.mjs probe`≥1 in external-registrations.
- `npm run test:remote` was **not** run. No production write of any kind; nothing was armed.

## Known Stubs

None. No placeholder, hardcoded-empty or TODO path was introduced.

## Threat Flags

None. The probe is two reads; T-10-21 (seeding on a client account) could not arise because no client is signed and the trial account was used and named; T-10-22 is held by the field-names-only design plus the closing no-credential line; T-10-23 is held by the contract test.

## Open After This Plan

- **The end-of-phase human check remains outstanding by design:** the plan's own flagged assumption is that the runbook's *sufficiency* is a judgment the contract test cannot make. It pins presence of every step, artefact and script, not whether the prose is enough. Somebody must read it end to end before the window opens.
- **`related_object`'s discriminator value** and **the automation-generated shape** — both named in the notes, both event-gated on a founding client.
- **Waves 5–6 (10-07, 10-08)** — event-gated on the first signed founding client.

## Self-Check: PASSED

All five named artefacts exist on disk; all three commits (`05a7ef8`, `95ded05`, `63d30f4`) are in the log.

## Push, CI and Deployment

- **Pushed:** `d595887..03cef56  main -> main`.
- **CI:** run `34580436357` — **completed / success** on the pushed SHA (7m56s). This is what promotes the 43 DB-backed suites that the bare local run refuses: they execute in CI against a fresh local stack.
- **Production deployment:** `dpl_45KcimBBn1bq1MyYRm7PWgSE48dv` — **READY**, target production, created 2026-09-11 16:41:36 AWST (the same second the push's CI run started). `app.backdesk.com.au`, `backdesk.com.au` and `www.backdesk.com.au` all alias to it, and `https://app.backdesk.com.au/` answers `307` (the console redirect, as expected for an unauthenticated request).
- Honest note on the correlation: `vercel inspect` exposes no `githubCommitSha` for this deployment, so the tie to `03cef56` rests on the alias plus the matching creation second, not on a SHA read back from the platform.
