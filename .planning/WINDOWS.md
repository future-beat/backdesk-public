---
schema_version: 1
open_count: 13
waived_count: 13
fixed_count: 16
total_count: 42
last_updated: 2026-10-08T09:20:30.757Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | unmet-truth | docs/external-registrations.md |  | ClickSend AU dedicated number order NOT submitted — blocked by IPND Australian street-address requirement; Twilio fallback blocked by same constraint. Phase 4 (MSG-01) SMS dependency unresolved. | fixed |  | 2026-08-25T03:11:49.194Z | 2026-09-05T03:23:29.457Z |
| 2 | 01 | unrun-verify | src/app/(console)/clients/[id]/page.tsx |  | Detail page, empty state and rejected-submission input preservation deferred to end-of-phase human device check (coverage D3, D4, D6) | fixed |  | 2026-08-25T10:38:24.380Z | 2026-09-05T03:23:29.563Z |
| 3 | 02 | deviation | src/core/servicem8/pagination.ts |  | A2 pagination mechanics not conclusive at 6 jobs — re-measure with >100 jobs before removing the defensive walk | waived | Operator ruling 2026-09-05: defensive pagination walk kept; re-measure when a client with >100 open quotes connects | 2026-08-26T09:01:38.629Z | 2026-09-05T04:05:17.806Z |
| 4 | 02 | unrun-verify | .planning/phases/02-servicem8-sync-quote-leakage-audit/02-01-SUMMARY.md |  | Console connect form and open-quotes list never visually verified — source assertions only (UAT in 02-01-SUMMARY) | fixed |  | 2026-08-26T09:01:38.714Z | 2026-09-05T03:23:29.674Z |
| 5 | 03 | deviation | src/db/repository/for-tenant.ts |  | cadenceTransition prescribes paused(client_paused) + customer_reply -> paused(customer_reply), but no repository method can perform that write (pauseWhereActive pauses only from 'active' by design). Phase 4 inbound-reply handling must add a guarded pause-or-upgrade write, or a client resume can revive a live conversation (D-05). | waived | Operator ruling 2026-09-05: matrix gap accepted — a client-paused cadence that receives a reply stays paused, the safe outcome; nothing sends | 2026-08-27T13:16:52.973Z | 2026-09-05T04:05:17.916Z |
| 6 | 3 | deviation | src/core/cadence/run-tick.ts |  | all_touches_done -> completed has no production driver: a cadence whose touches all terminate stays active until D-12 expiry | fixed |  | 2026-08-27T14:04:35.457Z | 2026-09-05T03:23:29.849Z |
| 7 | 3 | deviation | src/core/cadence/controls.ts |  | pauseForReply cannot perform the matrix-prescribed client_paused -> customer_reply upgrade; returns upgrade_unsupported for Phase 4 to close | waived | Operator ruling 2026-09-05: same gap as #5 — upgrade_unsupported is the honest return; nothing sends either way | 2026-08-27T14:38:03.589Z | 2026-09-05T04:05:18.034Z |
| 8 | 04 | deviation | tests/lint-ban.test.ts |  | 04-08 Rule 3: pinned repository-barrel export list required anyChannelEnabled to be added and argued for | waived | Operator ruling 2026-09-05: anyChannelEnabled was argued and accepted in 04-08 and the barrel pin lists it | 2026-08-30T04:01:21.287Z | 2026-09-05T04:05:18.149Z |
| 9 | 05 | stub | src/core/drafting/validate.ts |  | Charset gate is printable-ASCII and segment count is ceil(length/153) — interim stand-ins for a real GSM-7 septet counter; 05-02 replaces both without changing validateDraft's signature | fixed |  | 2026-08-30T16:23:31.352Z | 2026-09-05T03:23:29.959Z |
| 10 | 05 | stub | src/core/classification/schema.ts |  | ReplyClassification has no production caller yet — created so verify-drafting.mjs could settle A1; classify-inbound.ts lands in 05-04 | fixed |  | 2026-08-30T16:23:31.435Z | 2026-09-05T03:23:30.063Z |
| 11 | 05 | stub | src/core/drafting/draft-touches.ts |  | One template per prompt, not the tenant's approved set — cache prefix stays short and per-touch; 05-04 batching supplies the set | fixed |  | 2026-08-30T16:47:24.965Z | 2026-09-05T03:23:30.170Z |
| 12 | 05 | stub | src/core/drafting/edit-distance.ts |  | normalizedEditDistance has no storage caller yet — the AI-04 measurement is written by 05-07's edit-and-approve | fixed |  | 2026-08-30T16:47:25.050Z | 2026-08-31T03:05:39.589Z |
| 13 | 05 | stub | src/core/drafting/draft-touches.ts |  | no_voice_profile means the cadence_settings ROW is absent, not that the voice fields are empty — a present-but-blank profile is still drafted for | waived | Operator ruling 2026-09-05: v1 onboarding requires the voice profile before templates are approved, so a blank-but-present row cannot reach drafting | 2026-08-31T01:22:19.860Z | 2026-09-05T04:05:18.261Z |
| 14 | 05 | unrun-verify | src/core/drafting/prompt.ts |  | prompt caching still unproven at the new prefix length: no tenant yet has 5 approved templates + a voice profile + 2 due touches for a live 2-call batch (05-04 D10) | waived | Operator ruling 2026-09-05: cost-only optimisation (<$10/mo inference); cache_read_input_tokens is recorded per row so the first real batch answers it | 2026-08-31T01:22:19.945Z | 2026-09-05T04:05:18.392Z |
| 15 | 05 | stub | src/app/(console)/clients/[id]/drafting/actions.ts |  | message_templates.subject is written NULL on every row and no code path authors an email template — intentional D-04; email template authoring rides with the MSG-02 first-client email enablement event | waived | Operator ruling 2026-09-05: intentional D-04 — v1 is the five SMS templates; email templates ride with MSG-02's live proof at first-client onboarding | 2026-08-31T01:49:00.500Z | 2026-09-05T04:05:18.508Z |
| 16 | 05 | stub | src/core/classification/classify-inbound.ts |  | is_hot is written and nothing reads it — Phase 6 CON-02 hot-lead escalation consumes it (D-14: labels are evidence + triage priority only in Phase 5) | fixed |  | 2026-08-31T02:31:27.225Z | 2026-09-05T03:23:30.275Z |
| 17 | 05 | stub | src/core/classification/classify-inbound.ts |  | opt_out is labelled but nothing surfaces it at the top of triage — D-13's soft-opt-out operator path is 05-07's half | fixed |  | 2026-08-31T02:31:27.317Z | 2026-08-31T03:05:26.092Z |
| 18 | 05 | stub | src/core/classification/classify-inbound.ts |  | the high-only acting threshold and the three confidence buckets are self-reported and uncalibrated (research A2, no logprobs); tunable from recorded data without a schema change | waived | Operator ruling 2026-09-05: research A2 design (no logprobs); the high-only acting threshold is conservative; tune from recorded labels after the first client | 2026-08-31T02:31:27.410Z | 2026-09-05T04:05:18.620Z |
| 19 | 05 | stub | src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx |  | the approval gate is per-quote only — no deadline-sorted queue across clients, so an operator must open each quote to find drafts waiting (CON-01, Phase 6, deliberately not built here) | fixed |  | 2026-08-31T03:05:26.177Z | 2026-09-05T03:23:30.380Z |
| 20 | 05 | stub | src/app/(console)/inbox/page.tsx |  | the soft-opt-out one-tap is offered only when the row carries tenant/cadence/quote ids; an ambiguous or unmatched reply classified opt_out gets no suggestion and must be triaged by hand | waived | Operator ruling 2026-09-05: an unmatched opt_out reply stays in the triage queue for the operator; the deterministic STOP path (MSG-03) is unaffected | 2026-08-31T03:05:26.261Z | 2026-09-05T04:05:18.734Z |
| 21 | 05 | stub | src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts |  | the edit whitelist rebuilds price and date from the LIVE quote row, so a mirror re-sync between drafting and approval can refuse a body quoting the price the model was given; only the clock-derived days-since fact is pinned to the draft's moment | waived | Operator ruling 2026-09-05: refusing a body that quotes a stale price is the safe direction; the operator re-approves after the re-sync | 2026-08-31T03:05:26.347Z | 2026-09-05T04:05:18.857Z |
| 22 | 06 | deviation | src/db/repository/for-all-tenants.ts |  | 42702 ambiguous-column bug in forAllTenants_approvalQueue was invisible to tsc and lint; only the hosted-DB suite caught it | fixed |  | 2026-09-01T02:58:31.323Z | 2026-09-01T02:59:30.640Z |
| 23 | 07 | deviation | src/core/audit/aggregate.ts | 88 | Doc comment states 0.15*10_000 is 1500.0000000000002; it is exactly 1500. Code correct, comment false. | fixed |  | 2026-09-02T04:29:31.557Z | 2026-09-05T03:23:30.485Z |
| 24 | 07 | unrun-verify | tests/onboarding-gate.test.ts | 356 | Wall-clock boundary flake: re-window assertion uses toBeGreaterThan against new Date(); failed once at exact-millisecond equality, passed on isolated re-run | fixed |  | 2026-09-02T06:22:36.837Z | 2026-09-05T03:23:30.589Z |
| 25 | 07 | stub | src/app/(console)/reports/[client]/page.tsx |  | The '← Reports' back link (and the report page's own back chain) points at /reports, which does not exist until 07-05 builds the cross-client overview; the nav also carries no Reports link yet, so both new routes are reachable only by URL | fixed |  | 2026-09-02T07:04:06.446Z | 2026-09-02T08:14:11.761Z |
| 26 | 07 | unmet-truth | src/app/(console)/reports/[client]/[reportId]/report.css |  | G-07-2 (07-06): WebKit (iPhone Safari) does not repeat the per-job table header on continuation pages of the printed monthly report; Chromium does (thead break-inside: avoid). Accepted engine limitation — the 'header repeated on each continuation page' truth holds on desktop Chrome only. Verified in the 07-06 WKWebView harness; a fix would need per-page table splitting, not worth it for a <= 3-page document. | waived | Operator ruling 2026-09-05: accepted engine ruling (2026-09-03) — WebKit does not repeat printed table headers; confirmed on paper by 07-UAT test 4 | 2026-09-03T08:45:05.572Z | 2026-09-05T04:05:18.972Z |
| 27 | 07 | deviation | src/app/(console)/reports/[client]/[reportId]/report.css |  | G-07-2 (07-06): printed job rows are unsplittable only because every cell is one line box. The Customer and Follow-ups cells (.report-softwrap) may wrap when the sheet is narrower than ~661px — a first name beyond ~12 letters, or iOS ignoring the print zoom — and WebKit can split such a two-line row at a page fold. Accepted: the alternative is clipping the Conservative column off the sheet. The @supports zoom block is the recorded fallback to remove if the iPhone misapplies it. | waived | Operator ruling 2026-09-05: softwrap valve on two cells only, measured on both engines; the operator eyeballs the PDF before sending | 2026-09-03T08:45:15.098Z | 2026-09-05T04:05:19.085Z |
| 28 | 07 | deviation | src/app/(console)/reports/[client]/[reportId]/report.css |  | G-07-2 (07-06 review, CR-01): the printed monthly report shows only the first ~25 (Chromium) / ~22 (WebKit) code points of the 60-code-point frozen job description, because seven columns at 8.4pt do not fit more in a 661px A4 sheet and a PDF has no hover to recover the tail. Priced, not silent: run.sh asserts DESC_FLOOR=22 surviving code points on both engines, and the width reclaimed to get there (Follow-ups compressed to '12 · 14–31 Aug', Customer nowrap, print padding 0.4rem 0.2rem, cap 10rem -> 13rem) cannot be spent elsewhere without failing that assertion. The full 60 ARE readable on screen (the screen cap is lifted). Not fixed by lowering DESCRIPTION_MAX: 60 is the attribution evidence builder's persisted cap (codePointMax(61)), so matching it here would be a schema change AND would permanently discard from the frozen row what the screen can still show. | waived | Operator ruling 2026-09-05: accepted ruling (2026-09-03) — seven columns on A4 is the binding constraint; full description on screen | 2026-09-03T09:21:29.741Z | 2026-09-05T04:05:19.200Z |
| 29 | 08 | unrun-verify | tests/unsubscribe-suppression.test.ts |  | DB-backed suites (unsubscribe-suppression, inbound-stop, convert-prospect, cron-schedules) cannot run locally; verified structurally by grep — CI on next push to main is the gate | open |  | 2026-09-06T10:03:46.759Z |  |
| 30 | 08 | unrun-verify | tests/cron-schedules.test.ts |  | cron-status.mjs is not covered by the no-committed-origin structural assertion; the suite needs a local Supabase stack and test:remote is prohibited — checked by hand instead | open |  | 2026-09-08T08:52:43.879Z |  |
| 31 | 08 | unrun-verify | docs/vercel-domains-and-protection.md |  | DOM-03 console badge: /settings/email Verified badge for quotes.backdesk.com.au not observed — human-check, the last open clause of DOM-03 | open |  | 2026-09-08T09:57:31.330Z |  |
| 32 | 08 | unrun-verify | src/core/alerts/operator-email.ts |  | Operator alert From header event-gated: OPERATOR_ALERT_FROM deployed but no alert has fired, so 'Backdesk <alerts@quotes.backdesk.com.au>' is unobserved until the first real alert or Phase 10 | open |  | 2026-09-08T09:57:31.428Z |  |
| 33 | 09 | unrun-verify | src/app/(console)/audits/requests/page.tsx |  | Live device check deferred: /audits shows Requests (2 new) and the list renders the two 09-01 rows newest first with Perth times, correct badges and no sideways scroll (09-09 coverage D4, plus the E11 loading/overflow/partial backstops) | open |  | 2026-09-09T03:40:50.529Z |  |
| 34 | 09 | unrun-verify | src/app/(marketing)/page.tsx |  | Phone check in both colour schemes and the OG link-preview render for the landing page and /privacy — cannot run on the app host (/ is the console there); do it on the apex after 09-07 | open |  | 2026-09-09T05:17:17.923Z |  |
| 35 | 09 | deviation | tests/audit-request-console.test.ts |  | 09-06 tasks carried tdd="true" but were committed without a preceding RED test commit; assertions written in the same pass as the implementation | open |  | 2026-09-09T05:39:34.865Z |  |
| 36 | 10 | unrun-verify | tests/onboarding-checklist-gate.test.ts |  | DB-backed nine-key checklist assertions not run locally (CI-only suite); verified by typecheck + literal-array edit only | open |  | 2026-09-11T05:30:35.500Z |  |
| 37 | 10 | deviation | tests/lint-ban.test.ts | 367 | Barrel-surface pin stale since 10-01 added listChannelAudit to src/db/repository/index.ts — suite red on main; one-line fix belongs to 10-01 | open |  | 2026-09-11T05:45:16.680Z |  |
| 38 | 10 | unrun-verify | docs/first-client-go-live-runbook.md |  | The runbook's sufficiency is a human judgment the contract test cannot make — somebody must read it end to end before the go-live window opens (plan 10-06 flagged assumption) | open |  | 2026-09-11T08:41:17.867Z |  |
| 39 | quick | unrun-verify | .planning/quick/260913-ind-opt-out-alarm-needs-a-minimum-sample-bef/260913-ind-SUMMARY.md |  | 260913-ind: event-gated proof owed — after 22:31 UTC 2026-09-13 run 'npm run resend:recent-sends -- 5' and confirm no 'Daily digest' row for 2026-09-13 | open |  | 2026-09-13T05:42:01.275Z |  |
| 40 | quick | unrun-verify | .planning/quick/260919-mij-listings-structured-data-footer-link-and/260919-mij-SUMMARY.md |  | 260919-mij: event-gated proof owed — when the first tagged audit request arrives (Google profile or Facebook link), open audits/requests/[id] and confirm the 'Came from' line reads the channel rather than Unknown | open |  | 2026-09-19T09:10:43.547Z |  |
| 41 | 11 | stub | src/app/(console)/clients/[id]/checklist-card.tsx | 111 | ITEM_FIX.divertNumber links to #divert-number, which arrives with 11-05's provisioning form | open |  | 2026-09-27T17:02:12.885Z |  |
| 42 | 13 | skipped-test | tests/lead-reply.test.ts | 213 | lead-reply hot-reply escalation case skipped: 0040 label CHECK refuses a quote label on a lead row until the lead classifier lands — restored in 13-04 | fixed |  | 2026-10-08T08:35:46.801Z | 2026-10-08T09:20:30.757Z |

````json
[
  {
    "id": 1,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "docs/external-registrations.md",
    "line": null,
    "description": "ClickSend AU dedicated number order NOT submitted — blocked by IPND Australian street-address requirement; Twilio fallback blocked by same constraint. Phase 4 (MSG-01) SMS dependency unresolved.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-25T03:11:49.194Z",
    "resolved_at": "2026-09-05T03:23:29.457Z"
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "01",
    "file": "src/app/(console)/clients/[id]/page.tsx",
    "line": null,
    "description": "Detail page, empty state and rejected-submission input preservation deferred to end-of-phase human device check (coverage D3, D4, D6)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-25T10:38:24.380Z",
    "resolved_at": "2026-09-05T03:23:29.563Z"
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "02",
    "file": "src/core/servicem8/pagination.ts",
    "line": null,
    "description": "A2 pagination mechanics not conclusive at 6 jobs — re-measure with >100 jobs before removing the defensive walk",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: defensive pagination walk kept; re-measure when a client with >100 open quotes connects",
    "recorded_at": "2026-08-26T09:01:38.629Z",
    "resolved_at": "2026-09-05T04:05:17.806Z"
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "02",
    "file": ".planning/phases/02-servicem8-sync-quote-leakage-audit/02-01-SUMMARY.md",
    "line": null,
    "description": "Console connect form and open-quotes list never visually verified — source assertions only (UAT in 02-01-SUMMARY)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-26T09:01:38.714Z",
    "resolved_at": "2026-09-05T03:23:29.674Z"
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "03",
    "file": "src/db/repository/for-tenant.ts",
    "line": null,
    "description": "cadenceTransition prescribes paused(client_paused) + customer_reply -> paused(customer_reply), but no repository method can perform that write (pauseWhereActive pauses only from 'active' by design). Phase 4 inbound-reply handling must add a guarded pause-or-upgrade write, or a client resume can revive a live conversation (D-05).",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: matrix gap accepted — a client-paused cadence that receives a reply stays paused, the safe outcome; nothing sends",
    "recorded_at": "2026-08-27T13:16:52.973Z",
    "resolved_at": "2026-09-05T04:05:17.916Z"
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "3",
    "file": "src/core/cadence/run-tick.ts",
    "line": null,
    "description": "all_touches_done -> completed has no production driver: a cadence whose touches all terminate stays active until D-12 expiry",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-27T14:04:35.457Z",
    "resolved_at": "2026-09-05T03:23:29.849Z"
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "3",
    "file": "src/core/cadence/controls.ts",
    "line": null,
    "description": "pauseForReply cannot perform the matrix-prescribed client_paused -> customer_reply upgrade; returns upgrade_unsupported for Phase 4 to close",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: same gap as #5 — upgrade_unsupported is the honest return; nothing sends either way",
    "recorded_at": "2026-08-27T14:38:03.589Z",
    "resolved_at": "2026-09-05T04:05:18.034Z"
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "04",
    "file": "tests/lint-ban.test.ts",
    "line": null,
    "description": "04-08 Rule 3: pinned repository-barrel export list required anyChannelEnabled to be added and argued for",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: anyChannelEnabled was argued and accepted in 04-08 and the barrel pin lists it",
    "recorded_at": "2026-08-30T04:01:21.287Z",
    "resolved_at": "2026-09-05T04:05:18.149Z"
  },
  {
    "id": 9,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/drafting/validate.ts",
    "line": null,
    "description": "Charset gate is printable-ASCII and segment count is ceil(length/153) — interim stand-ins for a real GSM-7 septet counter; 05-02 replaces both without changing validateDraft's signature",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-30T16:23:31.352Z",
    "resolved_at": "2026-09-05T03:23:29.959Z"
  },
  {
    "id": 10,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/classification/schema.ts",
    "line": null,
    "description": "ReplyClassification has no production caller yet — created so verify-drafting.mjs could settle A1; classify-inbound.ts lands in 05-04",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-30T16:23:31.435Z",
    "resolved_at": "2026-09-05T03:23:30.063Z"
  },
  {
    "id": 11,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/drafting/draft-touches.ts",
    "line": null,
    "description": "One template per prompt, not the tenant's approved set — cache prefix stays short and per-touch; 05-04 batching supplies the set",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-30T16:47:24.965Z",
    "resolved_at": "2026-09-05T03:23:30.170Z"
  },
  {
    "id": 12,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/drafting/edit-distance.ts",
    "line": null,
    "description": "normalizedEditDistance has no storage caller yet — the AI-04 measurement is written by 05-07's edit-and-approve",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-30T16:47:25.050Z",
    "resolved_at": "2026-08-31T03:05:39.589Z"
  },
  {
    "id": 13,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/drafting/draft-touches.ts",
    "line": null,
    "description": "no_voice_profile means the cadence_settings ROW is absent, not that the voice fields are empty — a present-but-blank profile is still drafted for",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: v1 onboarding requires the voice profile before templates are approved, so a blank-but-present row cannot reach drafting",
    "recorded_at": "2026-08-31T01:22:19.860Z",
    "resolved_at": "2026-09-05T04:05:18.261Z"
  },
  {
    "id": 14,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "src/core/drafting/prompt.ts",
    "line": null,
    "description": "prompt caching still unproven at the new prefix length: no tenant yet has 5 approved templates + a voice profile + 2 due touches for a live 2-call batch (05-04 D10)",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: cost-only optimisation (<$10/mo inference); cache_read_input_tokens is recorded per row so the first real batch answers it",
    "recorded_at": "2026-08-31T01:22:19.945Z",
    "resolved_at": "2026-09-05T04:05:18.392Z"
  },
  {
    "id": 15,
    "kind": "stub",
    "phase": "05",
    "file": "src/app/(console)/clients/[id]/drafting/actions.ts",
    "line": null,
    "description": "message_templates.subject is written NULL on every row and no code path authors an email template — intentional D-04; email template authoring rides with the MSG-02 first-client email enablement event",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: intentional D-04 — v1 is the five SMS templates; email templates ride with MSG-02's live proof at first-client onboarding",
    "recorded_at": "2026-08-31T01:49:00.500Z",
    "resolved_at": "2026-09-05T04:05:18.508Z"
  },
  {
    "id": 16,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/classification/classify-inbound.ts",
    "line": null,
    "description": "is_hot is written and nothing reads it — Phase 6 CON-02 hot-lead escalation consumes it (D-14: labels are evidence + triage priority only in Phase 5)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-31T02:31:27.225Z",
    "resolved_at": "2026-09-05T03:23:30.275Z"
  },
  {
    "id": 17,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/classification/classify-inbound.ts",
    "line": null,
    "description": "opt_out is labelled but nothing surfaces it at the top of triage — D-13's soft-opt-out operator path is 05-07's half",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-31T02:31:27.317Z",
    "resolved_at": "2026-08-31T03:05:26.092Z"
  },
  {
    "id": 18,
    "kind": "stub",
    "phase": "05",
    "file": "src/core/classification/classify-inbound.ts",
    "line": null,
    "description": "the high-only acting threshold and the three confidence buckets are self-reported and uncalibrated (research A2, no logprobs); tunable from recorded data without a schema change",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: research A2 design (no logprobs); the high-only acting threshold is conservative; tune from recorded labels after the first client",
    "recorded_at": "2026-08-31T02:31:27.410Z",
    "resolved_at": "2026-09-05T04:05:18.620Z"
  },
  {
    "id": 19,
    "kind": "stub",
    "phase": "05",
    "file": "src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx",
    "line": null,
    "description": "the approval gate is per-quote only — no deadline-sorted queue across clients, so an operator must open each quote to find drafts waiting (CON-01, Phase 6, deliberately not built here)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-31T03:05:26.177Z",
    "resolved_at": "2026-09-05T03:23:30.380Z"
  },
  {
    "id": 20,
    "kind": "stub",
    "phase": "05",
    "file": "src/app/(console)/inbox/page.tsx",
    "line": null,
    "description": "the soft-opt-out one-tap is offered only when the row carries tenant/cadence/quote ids; an ambiguous or unmatched reply classified opt_out gets no suggestion and must be triaged by hand",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: an unmatched opt_out reply stays in the triage queue for the operator; the deterministic STOP path (MSG-03) is unaffected",
    "recorded_at": "2026-08-31T03:05:26.261Z",
    "resolved_at": "2026-09-05T04:05:18.734Z"
  },
  {
    "id": 21,
    "kind": "stub",
    "phase": "05",
    "file": "src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts",
    "line": null,
    "description": "the edit whitelist rebuilds price and date from the LIVE quote row, so a mirror re-sync between drafting and approval can refuse a body quoting the price the model was given; only the clock-derived days-since fact is pinned to the draft's moment",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: refusing a body that quotes a stale price is the safe direction; the operator re-approves after the re-sync",
    "recorded_at": "2026-08-31T03:05:26.347Z",
    "resolved_at": "2026-09-05T04:05:18.857Z"
  },
  {
    "id": 22,
    "kind": "deviation",
    "phase": "06",
    "file": "src/db/repository/for-all-tenants.ts",
    "line": null,
    "description": "42702 ambiguous-column bug in forAllTenants_approvalQueue was invisible to tsc and lint; only the hosted-DB suite caught it",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-01T02:58:31.323Z",
    "resolved_at": "2026-09-01T02:59:30.640Z"
  },
  {
    "id": 23,
    "kind": "deviation",
    "phase": "07",
    "file": "src/core/audit/aggregate.ts",
    "line": 88,
    "description": "Doc comment states 0.15*10_000 is 1500.0000000000002; it is exactly 1500. Code correct, comment false.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T04:29:31.557Z",
    "resolved_at": "2026-09-05T03:23:30.485Z"
  },
  {
    "id": 24,
    "kind": "unrun-verify",
    "phase": "07",
    "file": "tests/onboarding-gate.test.ts",
    "line": 356,
    "description": "Wall-clock boundary flake: re-window assertion uses toBeGreaterThan against new Date(); failed once at exact-millisecond equality, passed on isolated re-run",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T06:22:36.837Z",
    "resolved_at": "2026-09-05T03:23:30.589Z"
  },
  {
    "id": 25,
    "kind": "stub",
    "phase": "07",
    "file": "src/app/(console)/reports/[client]/page.tsx",
    "line": null,
    "description": "The '← Reports' back link (and the report page's own back chain) points at /reports, which does not exist until 07-05 builds the cross-client overview; the nav also carries no Reports link yet, so both new routes are reachable only by URL",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-02T07:04:06.446Z",
    "resolved_at": "2026-09-02T08:14:11.761Z"
  },
  {
    "id": 26,
    "kind": "unmet-truth",
    "phase": "07",
    "file": "src/app/(console)/reports/[client]/[reportId]/report.css",
    "line": null,
    "description": "G-07-2 (07-06): WebKit (iPhone Safari) does not repeat the per-job table header on continuation pages of the printed monthly report; Chromium does (thead break-inside: avoid). Accepted engine limitation — the 'header repeated on each continuation page' truth holds on desktop Chrome only. Verified in the 07-06 WKWebView harness; a fix would need per-page table splitting, not worth it for a <= 3-page document.",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: accepted engine ruling (2026-09-03) — WebKit does not repeat printed table headers; confirmed on paper by 07-UAT test 4",
    "recorded_at": "2026-09-03T08:45:05.572Z",
    "resolved_at": "2026-09-05T04:05:18.972Z"
  },
  {
    "id": 27,
    "kind": "deviation",
    "phase": "07",
    "file": "src/app/(console)/reports/[client]/[reportId]/report.css",
    "line": null,
    "description": "G-07-2 (07-06): printed job rows are unsplittable only because every cell is one line box. The Customer and Follow-ups cells (.report-softwrap) may wrap when the sheet is narrower than ~661px — a first name beyond ~12 letters, or iOS ignoring the print zoom — and WebKit can split such a two-line row at a page fold. Accepted: the alternative is clipping the Conservative column off the sheet. The @supports zoom block is the recorded fallback to remove if the iPhone misapplies it.",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: softwrap valve on two cells only, measured on both engines; the operator eyeballs the PDF before sending",
    "recorded_at": "2026-09-03T08:45:15.098Z",
    "resolved_at": "2026-09-05T04:05:19.085Z"
  },
  {
    "id": 28,
    "kind": "deviation",
    "phase": "07",
    "file": "src/app/(console)/reports/[client]/[reportId]/report.css",
    "line": null,
    "description": "G-07-2 (07-06 review, CR-01): the printed monthly report shows only the first ~25 (Chromium) / ~22 (WebKit) code points of the 60-code-point frozen job description, because seven columns at 8.4pt do not fit more in a 661px A4 sheet and a PDF has no hover to recover the tail. Priced, not silent: run.sh asserts DESC_FLOOR=22 surviving code points on both engines, and the width reclaimed to get there (Follow-ups compressed to '12 · 14–31 Aug', Customer nowrap, print padding 0.4rem 0.2rem, cap 10rem -> 13rem) cannot be spent elsewhere without failing that assertion. The full 60 ARE readable on screen (the screen cap is lifted). Not fixed by lowering DESCRIPTION_MAX: 60 is the attribution evidence builder's persisted cap (codePointMax(61)), so matching it here would be a schema change AND would permanently discard from the frozen row what the screen can still show.",
    "status": "waived",
    "reason": "Operator ruling 2026-09-05: accepted ruling (2026-09-03) — seven columns on A4 is the binding constraint; full description on screen",
    "recorded_at": "2026-09-03T09:21:29.741Z",
    "resolved_at": "2026-09-05T04:05:19.200Z"
  },
  {
    "id": 29,
    "kind": "unrun-verify",
    "phase": "08",
    "file": "tests/unsubscribe-suppression.test.ts",
    "line": null,
    "description": "DB-backed suites (unsubscribe-suppression, inbound-stop, convert-prospect, cron-schedules) cannot run locally; verified structurally by grep — CI on next push to main is the gate",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T10:03:46.759Z",
    "resolved_at": null
  },
  {
    "id": 30,
    "kind": "unrun-verify",
    "phase": "08",
    "file": "tests/cron-schedules.test.ts",
    "line": null,
    "description": "cron-status.mjs is not covered by the no-committed-origin structural assertion; the suite needs a local Supabase stack and test:remote is prohibited — checked by hand instead",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-08T08:52:43.879Z",
    "resolved_at": null
  },
  {
    "id": 31,
    "kind": "unrun-verify",
    "phase": "08",
    "file": "docs/vercel-domains-and-protection.md",
    "line": null,
    "description": "DOM-03 console badge: /settings/email Verified badge for quotes.backdesk.com.au not observed — human-check, the last open clause of DOM-03",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-08T09:57:31.330Z",
    "resolved_at": null
  },
  {
    "id": 32,
    "kind": "unrun-verify",
    "phase": "08",
    "file": "src/core/alerts/operator-email.ts",
    "line": null,
    "description": "Operator alert From header event-gated: OPERATOR_ALERT_FROM deployed but no alert has fired, so 'Backdesk <alerts@quotes.backdesk.com.au>' is unobserved until the first real alert or Phase 10",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-08T09:57:31.428Z",
    "resolved_at": null
  },
  {
    "id": 33,
    "kind": "unrun-verify",
    "phase": "09",
    "file": "src/app/(console)/audits/requests/page.tsx",
    "line": null,
    "description": "Live device check deferred: /audits shows Requests (2 new) and the list renders the two 09-01 rows newest first with Perth times, correct badges and no sideways scroll (09-09 coverage D4, plus the E11 loading/overflow/partial backstops)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-09T03:40:50.529Z",
    "resolved_at": null
  },
  {
    "id": 34,
    "kind": "unrun-verify",
    "phase": "09",
    "file": "src/app/(marketing)/page.tsx",
    "line": null,
    "description": "Phone check in both colour schemes and the OG link-preview render for the landing page and /privacy — cannot run on the app host (/ is the console there); do it on the apex after 09-07",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-09T05:17:17.923Z",
    "resolved_at": null
  },
  {
    "id": 35,
    "kind": "deviation",
    "phase": "09",
    "file": "tests/audit-request-console.test.ts",
    "line": null,
    "description": "09-06 tasks carried tdd=\"true\" but were committed without a preceding RED test commit; assertions written in the same pass as the implementation",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-09T05:39:34.865Z",
    "resolved_at": null
  },
  {
    "id": 36,
    "kind": "unrun-verify",
    "phase": "10",
    "file": "tests/onboarding-checklist-gate.test.ts",
    "line": null,
    "description": "DB-backed nine-key checklist assertions not run locally (CI-only suite); verified by typecheck + literal-array edit only",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T05:30:35.500Z",
    "resolved_at": null
  },
  {
    "id": 37,
    "kind": "deviation",
    "phase": "10",
    "file": "tests/lint-ban.test.ts",
    "line": 367,
    "description": "Barrel-surface pin stale since 10-01 added listChannelAudit to src/db/repository/index.ts — suite red on main; one-line fix belongs to 10-01",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T05:45:16.680Z",
    "resolved_at": null
  },
  {
    "id": 38,
    "kind": "unrun-verify",
    "phase": "10",
    "file": "docs/first-client-go-live-runbook.md",
    "line": null,
    "description": "The runbook's sufficiency is a human judgment the contract test cannot make — somebody must read it end to end before the go-live window opens (plan 10-06 flagged assumption)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T08:41:17.867Z",
    "resolved_at": null
  },
  {
    "id": 39,
    "kind": "unrun-verify",
    "phase": "quick",
    "file": ".planning/quick/260913-ind-opt-out-alarm-needs-a-minimum-sample-bef/260913-ind-SUMMARY.md",
    "line": null,
    "description": "260913-ind: event-gated proof owed — after 22:31 UTC 2026-09-13 run 'npm run resend:recent-sends -- 5' and confirm no 'Daily digest' row for 2026-09-13",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-13T05:42:01.275Z",
    "resolved_at": null
  },
  {
    "id": 40,
    "kind": "unrun-verify",
    "phase": "quick",
    "file": ".planning/quick/260919-mij-listings-structured-data-footer-link-and/260919-mij-SUMMARY.md",
    "line": null,
    "description": "260919-mij: event-gated proof owed — when the first tagged audit request arrives (Google profile or Facebook link), open audits/requests/[id] and confirm the 'Came from' line reads the channel rather than Unknown",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-19T09:10:43.547Z",
    "resolved_at": null
  },
  {
    "id": 41,
    "kind": "stub",
    "phase": "11",
    "file": "src/app/(console)/clients/[id]/checklist-card.tsx",
    "line": 111,
    "description": "ITEM_FIX.divertNumber links to #divert-number, which arrives with 11-05's provisioning form",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-27T17:02:12.885Z",
    "resolved_at": null
  },
  {
    "id": 42,
    "kind": "skipped-test",
    "phase": "13",
    "file": "tests/lead-reply.test.ts",
    "line": 213,
    "description": "lead-reply hot-reply escalation case skipped: 0040 label CHECK refuses a quote label on a lead row until the lead classifier lands — restored in 13-04",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-08T08:35:46.801Z",
    "resolved_at": "2026-10-08T09:20:30.757Z"
  }
]
````
