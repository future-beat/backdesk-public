---
phase: 13-lead-cadence-labels-escalation
reviewed: 2026-10-09T03:02:54Z
depth: standard
files_reviewed: 65
files_reviewed_list:
  - package.json
  - scripts/lead-cadence-invariants.mjs
  - src/app/(console)/clients/[id]/action-state.ts
  - src/app/(console)/clients/[id]/actions.ts
  - src/app/(console)/clients/[id]/after-hours-escalation-form.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
  - src/app/(console)/inbox/page.tsx
  - src/app/(console)/inbox/suppress-contact-form.tsx
  - src/app/(console)/queue/actions.ts
  - src/app/(console)/queue/page.tsx
  - src/app/(console)/queue/queue-card.tsx
  - src/app/api/internal/cadence-tick/route.ts
  - src/core/aging/stalled-digest.ts
  - src/core/cadence/dispatch.ts
  - src/core/cadence/policy.ts
  - src/core/cadence/rewindow.ts
  - src/core/cadence/run-tick.ts
  - src/core/cadence/window.ts
  - src/core/classification/classify-inbound.ts
  - src/core/classification/schema.ts
  - src/core/drafting/draft-touches.ts
  - src/core/drafting/prompt.ts
  - src/core/escalation/escalate-hot-leads.ts
  - src/core/escalation/hold.ts
  - src/core/escalation/message.ts
  - src/core/escalation/quote-call.ts
  - src/core/escalation/release-held.ts
  - src/core/escalation/ring-twice.ts
  - src/core/leads/close.ts
  - src/core/leads/constants.ts
  - src/core/leads/gate.ts
  - src/core/leads/label-effects.ts
  - src/core/leads/lead-templates.ts
  - src/core/leads/text-back.ts
  - src/core/leads/urgency-keywords.ts
  - src/core/messaging/inbound.ts
  - src/db/migrations/0040_phase13_lead_cadence.sql
  - src/db/repository/escalations.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/inbound-messages.ts
  - src/db/repository/index.ts
  - src/db/repository/missed-calls.ts
  - src/db/schema/cadences.ts
  - src/db/schema/escalations.ts
  - src/db/schema/inbound-messages.ts
  - src/db/schema/leads.ts
  - src/db/schema/message-templates.ts
  - src/db/schema/missed-calls.ts
  - src/db/schema/tenants.ts
  - tests/after-hours-escalation-action.test.ts
  - tests/cadence-tick.test.ts
  - tests/escalation-lead.test.ts
  - tests/escalation-passes.test.ts
  - tests/escalation.test.ts
  - tests/lead-cadence-active.test.ts
  - tests/lead-close.test.ts
  - tests/lead-digest-section.test.ts
  - tests/lead-policy-both-kinds.test.ts
  - tests/lead-reply.test.ts
  - tests/lint-ban.test.ts
  - tests/queue-lead-rows.test.ts
  - tests/ring-twice.test.ts
  - tests/urgency-keywords.test.ts
findings:
  critical: 1
  warning: 4
  info: 11
  total: 16
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-10-09T03:02:54Z
**Depth:** standard
**Files Reviewed:** 65 (51 source/script/config files changed in `ed2e4dc..8caa4ce`, the generated 0040 snapshot and journal excluded; 14 test suites read for what they pin and what they leave unpinned). Five unchanged files were opened to trace calls out of the diff: `src/app/(console)/components/label-guess.ts`, `src/core/drafting/validate.ts`, `src/core/drafting/merge-facts.ts`, `src/core/approval/approve-draft.ts`, `src/core/leads/template.ts`.
**Status:** issues_found
**Code under review:** `8caa4ce` (deployed; migration 0040 applied; CI run 37875868246 success; zero leads, nothing armed).
**Fix status (2026-10-09):** CR-01 and WR-01..WR-04 fixed (`3123d37`, `2578971`, `563094b`, `a6801f0`, `b5f21c9`); IN-04's count half fixed with CR-01; IN-01..IN-03 and IN-05..IN-11 recorded, not fixed.

## Summary

The review weighted the two things this phase can do to a member of the public and to a tradie's handset: send a lead follow-up, and ring the tradie's phone. Both paths hold against the focus questions:

- **A lead touch 2/3 outside hours, before approval, after STOP, after close, twice, or to a quote number.** `claimDue` still claims `approved` touches only (`for-tenant.ts:3792`); the shared tail keeps the suppression probe and the `outside_window` silent refusal, so dispatch is the second belt behind the rewindow (`dispatch.ts:574-592`); `closeLeadInTx` stops the cadence and retires every unsent touch in the same transaction as the lead write (`close.ts:57-77`), so a closed lead has nothing left to claim; the ledger key is unchanged; `refuseUnchaseableLead` re-reads the lead's status, the live quote cadence for the mobile and the touch-1 ledger outcome inside the claim transaction (`dispatch.ts:424-433`). The 02:00 fallback slot is moved by the lead rewindow at the tick it comes due (`rewindow.ts:218-247`, pinned at `lead-cadence-active.test.ts:560`).
- **Quote behaviour.** `QUOTE_POLICY` is built from the untouched quote constants; `rewindowTouch` defaults to it; every quote template read carries `kind = 'quote'` including the `approvedSetStatus` EXISTS; the hold is evaluated only when `leadId !== null`; the classifier picks the vocabulary by `lead_id` and the quote write is byte-identical except for an explicit `urgency: null`; WR-03's `isNotNull(sendLedger.quoteId)` keeps lead ledger rows and lead replies out of the monthly metrics. The D-19 control is carried verbatim.
- **The tick.** Every `closeLeadInTx` call site is on the caller's handle (`run-tick.ts:788`, `dispatch.ts:441`); the three wrapper callers are outside any transaction; every new pass has its own catch with a fixed string; every new scan is bounded (`HOT_ESCALATION_CAP`, `RING_TWICE_ESCALATION_CAP`, `limit`). `CADENCE_KINDS` is exhaustive at the type level for `POLICIES`.
- **Hot replies.** Keyword hits escalate with `label NULL` through the `(is_hot OR keyword_hot)` scan; an emergency behind a hold is not cooled down; holds are claims so a held backlog leaves the scan (pinned to the cap at `escalation-lead.test.ts:530-550`); a lead its own complaint closed in the claiming tick is still told. Nothing in a new log line, count, digest line or script output carries a number or a body.
- **Schema.** Every member of `LEAD_CLOSED_REASONS` reachable by a writer satisfies the four `leads` CHECKs; `urgency` is never written NULL beside a lead label (both vocabulary `read()`s and the lead `blank` return a member); the three-place identity holds byte for byte; the only non-widening index change is on a table with zero rows of the new kind.

What the review found is on the **other side of the conversation**: the operator's. A cold lead reply that the classifier is *sure* about has no surface at all — not the inbox (whose predicate excludes high-confidence labels), not a quote page (a lead has none) — while the new digest line tells the operator it is "waiting in the inbox". That is the Critical. The Warnings are a stale tradie number on a released hold, a "no links" rule that exists only in the prompt, the lead vocabulary rendering as raw snake_case on the operator's phone, and a shipped default template that says "yesterday" on a touch the engine deliberately rolls across weekends.

Recorded deviations (the dispatch branch writing the stop pair itself; the quote-wins arm limited to non-STOP replies; closing before threading; `cadence_id IS NOT NULL` on ring-twice; `urgency: null` on quote writes; the key-set acknowledgements in `cadence-tick.test.ts`; the after-hours tick in `lead-policy-both-kinds`; "not urgent" hot by lock) were checked and are not flagged. One recorded decision IS flagged (WR-01) because its consequence is a text to a number the client has removed.

## Critical Issues

### CR-01: A high-confidence cold lead reply has no operator surface, and the digest says it is "waiting in the inbox"

**Status:** FIXED in `3123d37` (2026-10-09). Inbox lead arm `lead_id IS NOT NULL AND is_hot = false AND keyword_hot = false` (no `threaded` predicate — redundant per the file's own classification-arm header, result set identical); triage row carries `leadId` and a lead row names its client with "missed-call lead, no quote"; `countColdLeadRepliesSince` gains `triaged_at IS NULL` (IN-04's count half). The `inbox-authorization` is_hot pin was found slicing an unrelated `.where(` and now reads the triage WHERE. DB proof in `tests/lead-reply.test.ts` (CI-only).

**File:** `src/db/repository/inbound-messages.ts:259-276` (`listInboundNeedingTriage`), `src/db/repository/inbound-messages.ts:1387-1412` (`countColdLeadRepliesSince`), `src/core/aging/stalled-digest.ts:138`; the gap is created by `src/core/classification/classify-inbound.ts:395-405` (`isHotLeadReply`) together with `src/core/leads/label-effects.ts:16-27`.
**Issue:** D-08 and D-11 say a cold lead reply "pauses the lead and sits in the operator inbox like quote replies". The inbox predicate admits four arms: unattributed/dead-letter rows, STOP, `label = 'opt_out'`, and `label_confidence <> 'high'`. A lead reply labelled `question` or `other` at **high** confidence is cold under D-07 (not in the four hot labels), not closing under D-11 (not in `LEAD_CLOSING_LABELS`), not an opt-out, and not unsure — so it matches no arm. For a quote reply that is fine: high-confidence replies are read on the quote page's conversation thread. A lead has no quote page, and the console's only other inbound reads are the inbox and that thread (checked: no page under `(console)/` reads `inbound_messages` for a lead). The net effect for the first live client: a caller replies "What area do you cover?", the door pauses the cadence (`pauseForReply`), the classifier writes `question`/high, nothing escalates, nothing lists it, the cadence stays paused until `LEAD_EXPIRY_DAYS` expires it on day 8, and the lead closes `expired` with the caller never answered. Meanwhile `countColdLeadRepliesSince` counts that row and the 06:30 digest prints "1 cold lead reply in the last 24 h waiting in the inbox" — the operator opens the inbox and finds nothing. The same hole swallows a lead reply the classifier gives up on (`MAX_CLASSIFY_ATTEMPTS` reached, label NULL, threaded): no arm matches it either, and IN-11 makes that more than theoretical. `tests/lead-reply.test.ts:593` pins `new_enquiry`/flexible/high (hot) and `:568` pins `complaint` at medium (inbox); no case pins a high-confidence `question`, which is the most ordinary reply a missed caller sends.
**Fix:** Give lead replies an inbox arm until Phase 15's lead queue exists, and make the digest count the same set the inbox shows:
```ts
// inbound-messages.ts — listInboundNeedingTriage, one more arm in the or():
// Phase 13: a reply threaded to a LEAD has no quote page, so every cold one
// is the inbox's until the lead queue (Phase 15). Hot ones were escalated.
and(
  isNotNull(inboundMessages.leadId),
  eq(inboundMessages.attribution, 'threaded'),
  eq(inboundMessages.isHot, false),
  eq(inboundMessages.keywordHot, false),
),

// countColdLeadRepliesSince — count what the inbox will actually show:
isNull(inboundMessages.triagedAt),
```
Note the arm deliberately does not require `label IS NOT NULL`, so a lead reply the classifier gave up on is also surfaced. Add a DB case in `lead-reply.test.ts`: `question`/`flexible`/high on a lead → cadence paused, `is_hot = false`, and the row is returned by `listInboundNeedingTriage`. If the digest wording is kept, it is then true.

## Warnings

### WR-01: A released hold texts the escalation number recorded at 23:00, not the one the client holds at 08:00

**Status:** FIXED in `2578971` (2026-10-09). Release re-reads `tenants.escalation_phone`; gone/unrepairable → `no_escalation_number`, no send; the number actually texted is written back to `to_address` with the outcome. Pure pins in `escalation-passes`; DB proof in `escalation-lead` (CI-only). Logic change — requires human verification.

**File:** `src/core/escalation/release-held.ts:183-190`; `src/db/repository/escalations.ts:201-210`
**Issue:** The release normalises `row.toAddress` — the tradie's number as it stood when the hold was claimed — and re-asks only `resolveSmsFrom`. 13-06 records this as a decision ("so the evidence row stays true"). The consequence it does not weigh: the operator's one reason to change `tenants.escalation_phone` overnight is that the stored number was wrong (an ex-employee, a typo that would text a stranger, 12-REVIEW's own "restored leading zero" worry). Every hold claimed before that edit is released to the old number anyway, and the evidence row then records a send to a number the client had already removed — which is the opposite of true. The release already re-reads the lead and the arming switch "because a client can be disarmed overnight"; the phone is the same class of fact.
**Fix:** Re-read the tenant at release and refuse when the phone is gone:
```ts
const [tenant] = await forTenant(row.tenantId).tenant.get();
const to = normalizeAuMobile(tenant?.escalationPhone);
if (to === null) { /* no_escalation_number, as now */ }
// optionally: record the number actually used
await updateEscalationToAddress(row.id, to); // or fold into recordEscalationOutcome
```
Pin it in `escalation-lead.test.ts`: hold at 23:00, change the tenant's phone at 00:00, release at 08:00 sends to the new number.

### WR-02: "No links" on a lead draft is a prompt instruction only — the validator has no link rule, and the template header says it does

**Status:** FIXED in `563094b` (2026-10-09). Opt-in Rule 5 (`forbidLinks`, rule `link`) on the model's text, passed by drafting and edit-then-approve for lead cadences only; `LINK_PATTERN` moved to the import-free leaf `src/core/shared/link-pattern.ts` (text-back-structure forbids `src/core/leads` importing drafting modules other than gsm7); lead-templates header names the mechanical rules.

**File:** `src/core/drafting/validate.ts:261-347` (Rules 1–4); `src/core/leads/lead-templates.ts:18-20`; `src/core/drafting/prompt.ts:584`
**Issue:** D-13 lists "no links" among the rules a lead draft follows, `LEAD_INSTRUCTIONS` says "No links, no web addresses, no phone numbers", and the lead-templates header reasons that the defaults carry "no links, no digits … so the draft validator can only refuse a draft for something the MODEL added". `validateDraft` has no link rule at all: Rule 1 matches digit runs, Rule 2 month/weekday names, Rules 3–4 charset/length and the compliance line. `backdesk.com.au/book` contains no digit and no date word, so a lead draft carrying a URL passes mechanically and reaches the approval queue, where a human is the only belt. The text-back validator already has the right regex (`src/core/leads/template.ts:111`, `LINK_PATTERN`), applied to touch 1; touches 2 and 3 are the only lead messages that a model writes and the only ones without it.
**Fix:** Add an opt-in rule to `validateDraft` so the quote path is untouched (D-17), and pass it for lead drafts:
```ts
// validate.ts
export interface ValidateDraftInput { …; forbidLinks?: boolean }
if (input.forbidLinks && LINK_PATTERN.test(modelText)) {
  violations.push({ rule: 'link', detail: modelText.match(LINK_PATTERN)![0] });
}
// draft-touches.ts + approve-draft.ts: forbidLinks: isLead
```
Export `LINK_PATTERN` from `template.ts` (or move it to a shared leaf). Pin a lead draft with `www.` refused in `drafting-validate.test.ts`, and correct the lead-templates header to say which rules are mechanical.

### WR-03: The lead vocabulary renders as raw snake_case on every console badge, and `urgency` is not shown at all

**Status:** FIXED in `a6801f0` (2026-10-09). Seven lead labels in `LABEL_GUESS_LABELS`; `urgencyGuess` (unknown renders nothing); inbox selects and renders urgency, emergency as `badge--error`; pure pin over both vocabularies in `lead-labels.test.ts`.

**File:** `src/app/(console)/components/label-guess.ts:40-47,61-64`; rendered at `src/app/(console)/inbox/page.tsx:228-231`
**Issue:** `LABEL_GUESS_LABELS` holds the six quote labels. Its own header says a member added to the vocabulary "must fail loudly here rather than ship as snake_case on the operator's phone", and `labelGuess` falls through to the raw value. Phase 13 added ten lead labels and did not touch the map, so a lead reply in the inbox (today: medium/low confidence rows and soft opt-outs; after CR-01: every cold one) carries a badge reading `new_enquiry`, `callback_request`, `existing_job`, `not_a_lead`, `already_sorted` or `spam`, and `question`/`opt_out`/`other` borrow the quote wording. The classifier's `urgency` — the one field that tells the operator whether this is a burst pipe or a fence — is selected by no console read. `tests/lead-reply.test.ts:785` ("no console surface links to a quote that does not exist") checks links, not labels.
**Fix:**
```ts
// label-guess.ts — the lead vocabulary, phrased as a guess like the rest
new_enquiry: 'reads as a new enquiry',
callback_request: 'reads as a call-back request',
existing_job: 'reads as an existing customer',
complaint: 'reads as a complaint',
not_a_lead: 'reads as not a lead',
already_sorted: 'reads as already sorted',
spam: 'reads as spam',
```
Add a pure pin that every member of `LEAD_LABELS` ∪ `INBOUND_LABELS` has an entry (read the schema consts in the test; the leaf stays import-free). Select `urgency` in `listInboundNeedingTriage` and render it beside the label for lead rows ("emergency" as `badge--error`).

### WR-04: The shipped touch-2 default says "your call yesterday", and the engine rolls touch 2 across weekends and public holidays

**Status:** FIXED in `b5f21c9` (2026-10-09). "Following up on your recent call."; no data fix (zero lead `message_templates` rows on production). The optional `DATE_WORD` extension was not taken.

**File:** `src/core/leads/lead-templates.ts:30`; `src/core/drafting/validate.ts:147-155`
**Issue:** `DEFAULT_LEAD_TEMPLATE_BODIES[2]` opens "Following up on your call yesterday." Touch 2 is placed at anchor date + 1 **rolled to the next allowed day** (`slotAtOffsetDays` → `rollToAllowedSlot`), and `LEAD_EXPIRY_DAYS`'s own comment reasons about a Friday call rolling touch 2 to Tuesday. The lead-templates header says touch 3 "avoids 'yesterday', because it goes two days after the call" — the same care is not taken for touch 2, which goes one to four days after it. The model is told "Days since the call: 3" and to "keep the template's intent", so it may or may not drop the word; the validator cannot help — `DATE_WORD` lists months and weekdays only, so "yesterday" is never checked against the facts. A Friday-afternoon caller receives, on Monday, "Following up on your call yesterday", in the tradie's name; the approver is the only belt, and a queue of twenty such cards on a Monday morning is exactly the skim the validate.ts header warns about.
**Fix:** Make the default true on every day it can send:
```ts
2: "Following up on your recent call. Still need a hand? Reply with the job and your suburb and we'll be in touch.",
```
The seed is `ON CONFLICT DO NOTHING` on version 1, so already-seeded tenants need an `insertVersion({ kind: 'lead', … })` + approve step or a one-off data statement; production has no seeded tenant yet, so changing the constant before the first arm is enough today. Optionally add `yesterday|today|tomorrow|tonight` to `DATE_WORD` with `daysSinceDisplay === '1'` whitelisting "yesterday".

## Info

### IN-01: A held alert is still released after an emergency on the same lead already woke the tradie

**File:** `src/core/escalation/release-held.ts:20-25`; `src/core/escalation/escalate-hot-leads.ts:282-289`
**Issue:** The 13-06 fix lets an emergency at 23:10 bypass the cooldown of a hold claimed at 23:00 ("both are told", pinned at `escalation-lead.test.ts:379`). The hold is then released at 08:00 with no cooldown check, so the tradie, already texted at 23:10 with the caller's number, is texted again at 08:00 about the earlier, milder message. The same shape produces two ring-twice holds for one lead when the calls are more than 30 minutes apart overnight. Deliberate and tested; recorded because the second SMS is the thing D-08 ("never texted for every miss") was written against.
**Fix:** At release, if an escalation on the same cadence was `sent` after `row.claimedAt`, record `cooldown_suppressed` instead of sending.

### IN-02: `escalate-hot-leads.ts` header is stale on three facts

**File:** `src/core/escalation/escalate-hot-leads.ts:16-23`
**Issue:** "writes four columns" (five since 13-03); "CONSUMES the stored `is_hot`; it never re-derives it" (the scan is `is_hot OR keyword_hot`, and the pass reads `urgency`/`keywordHot` for the hold); "`isHotLead` stays private to the classifier" (`isHotLeadReply` is exported). Harmless today, misleading to the next reader of the pass that rings phones.
**Fix:** Rewrite the paragraph to name both hot columns and the two hot rules.

### IN-03: The dispatch lead branch records a failed text-back as `expired`

**File:** `src/core/cadence/dispatch.ts:441`
**Issue:** When touch 1 never reached `sent`, the lead is closed `expired` (status `expired`) although nothing aged out — the vocabulary has no "text-back failed" member and `expired` is the only reason an `expired` status admits. Phase 15 reporting will read it as a lead that timed out. Recorded as a decision in 13-02; noted because a lead-level reason for "touch 1 failed" is a one-member CHECK widening now and a data repair later.
**Fix:** Add `text_back_failed` to `LEAD_CLOSED_REASONS` (and the CHECK) in the next migration, written with status `closed`.

### IN-04: The digest's Leads lines over-count and use the past tense for the future

**Status:** PARTIAL — the over-count (`triaged_at IS NULL`) was fixed with CR-01 in `3123d37`; the "released at" tense is not fixed.

**File:** `src/db/repository/inbound-messages.ts:1395-1403`; `src/core/aging/stalled-digest.ts:138-145`
**Issue:** `countColdLeadRepliesSince` ignores `triaged_at`, so a reply the operator marked handled yesterday afternoon is still "waiting in the inbox" this morning. The held line says "released at 08:00" at 06:30, when the release is ninety minutes away; the builder's comment admits "or will".
**Fix:** Add `isNull(inboundMessages.triagedAt)` (also in CR-01); word the line "release at {time}" when `latest > now`.

### IN-05: `afterHoursEscalationSchema = z.boolean()` validates a value the line above already made a boolean

**File:** `src/app/(console)/clients/[id]/actions.ts:115,149-157`
**Issue:** `formData.get(...) === 'on'` cannot produce anything but a boolean, so `safeParse` can never fail and the failure arm is unreachable. The comment says the schema is "the record of what this write admits"; a type annotation says the same with no dead branch.
**Fix:** `const afterHoursEscalation: boolean = formData.get('after_hours_escalation') === 'on';` and delete the schema and its branch (or validate the raw string with `z.enum(['on']).nullable()` if a record is wanted).

### IN-06: `LEAD_TOUCH_COUNT = 3` restates `LEAD_TOUCH_OFFSET_DAYS.length`

**File:** `src/app/(console)/queue/queue-card.tsx:115`
**Issue:** A second statement of the lead cadence's shape, in a client component that cannot import the constants module. Changing the offsets leaves the card saying "of 3".
**Fix:** Pass `touchCount` on `QueueCardRow` from the server page (which can import `LEAD_TOUCH_OFFSET_DAYS`), or pin the two equal in `queue-lead-rows.test.ts`.

### IN-07: `messageFor`'s quote branch is unreachable

**File:** `src/core/escalation/release-held.ts:128-137`
**Issue:** Only lead replies and ring-twice calls are ever held (`escalate-hot-leads.ts:296-304` requires `leadId !== null`), so `cadence?.quoteId` is always NULL here and `repo.quotes.byId` is never called. The generality reads as if quote replies can be held.
**Fix:** Drop the quote read and pass `LEAD_REPLY_SNIPPET` directly, with a comment that holds are lead-only.

### IN-08: Stale comments left by the flip from inert to active

**File:** `src/core/leads/text-back.ts:652-656` (`leadSchedule`: "they are INERT until Phase 13 re-windows them"); `src/db/schema/leads.ts:17-18` ("not texted again until Phase 13/14 add closing"); `src/core/cadence/dispatch.ts:153-158` (`DISPATCH_REFUSALS`: "three of these write … The other three", now four and five)
**Issue:** Each describes the Phase 12 state as current.
**Fix:** Update the three paragraphs; `leadSchedule`'s should say the lead rewindow moves a fallback slot at the tick it comes due.

### IN-09: The invariants script prints the driver's error message

**File:** `scripts/lead-cadence-invariants.mjs:97`
**Issue:** 12-REVIEW IN-07's pattern, carried into the new script: `console.error(error.message)`. The statement has no parameters today, and the comment says so; the sibling rule ("fixed strings only") is what keeps that true when the query grows.
**Fix:** `console.error('lead-cadence invariants read failed; nothing printed.')`.

### IN-10: The lead close sweep skips paused tenants; the label-effects pass does not

**File:** `src/core/cadence/run-tick.ts:1063`; `src/core/leads/label-effects.ts:63`
**Issue:** 13-04 argued that a paused client "still wants a spammer's lead closed" and walks every tenant; `runLeadCloseSweep` keeps the completion sweep's pause filter, so a paused client's lead whose cadence ended stays `open` (and holds `leads_one_open_per_mobile`) until the client is unpaused. Two passes, two answers to "does a pause stop lead bookkeeping".
**Fix:** Pick one; the label-effects reasoning (a close sends nothing) applies equally to the sweep.

### IN-11: The lead structured-output format is unproven at `MAX_CLASSIFY_TOKENS = 100`

**File:** `src/core/classification/classify-inbound.ts:114`
**Issue:** Carried forward by 13-04 and 13-07: the quote format was re-proven live; the lead format adds an enum field and runs against `claude-opus-5`, whose adaptive thinking may count against `max_tokens`. If the first live lead reply returns `parsed_output: null`, it retries to `MAX_CLASSIFY_ATTEMPTS` and sits unlabelled — which, per CR-01, is a row no console surface shows, and (because `is_hot` is never written) a hot lead the tradie never hears about unless a keyword fired.
**Fix:** Extend `scripts/verify-drafting.mjs` to probe `LeadReplyClassification` once before the first client is armed; CR-01's arm makes the failure visible either way.

---

_Reviewed: 2026-10-09T03:02:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
