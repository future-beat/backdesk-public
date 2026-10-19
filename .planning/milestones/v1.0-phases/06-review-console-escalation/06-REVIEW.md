---
phase: 06-review-console-escalation
reviewed: 2026-09-01T00:00:00Z
depth: standard
files_reviewed: 75
files_reviewed_list:
  - .github/workflows/ci.yml
  - docs/env-vars.md
  - docs/servicem8-api-notes.md
  - scripts/apply-cron-schedules.mjs
  - scripts/sm8-spike.mjs
  - src/app/(console)/clients/[id]/action-state.ts
  - src/app/(console)/clients/[id]/actions.ts
  - src/app/(console)/clients/[id]/checklist-card.tsx
  - src/app/(console)/clients/[id]/escalation-phone-form.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts
  - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
  - src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx
  - src/app/(console)/clients/[id]/quotes/[quoteId]/draft-review.tsx
  - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
  - src/app/(console)/components/action-state.ts
  - src/app/(console)/components/draft-card.tsx
  - src/app/(console)/components/label-guess.ts
  - src/app/(console)/inbox/page.tsx
  - src/app/(console)/layout.tsx
  - src/app/(console)/page.tsx
  - src/app/(console)/queue/action-state.ts
  - src/app/(console)/queue/actions.ts
  - src/app/(console)/queue/page.tsx
  - src/app/(console)/queue/queue-card.tsx
  - src/app/api/internal/cadence-tick/route.ts
  - src/app/api/internal/stalled-digest/route.ts
  - src/app/globals.css
  - src/core/aging/stall-policy.ts
  - src/core/aging/stalled-digest.ts
  - src/core/alerts/stalled-drafts.ts
  - src/core/approval/approve-draft.ts
  - src/core/approval/limits.ts
  - src/core/cadence/consume-events.ts
  - src/core/cadence/controls.ts
  - src/core/cadence/run-tick.ts
  - src/core/drafting/onboarding-gate.ts
  - src/core/escalation/escalate-hot-leads.ts
  - src/core/escalation/message.ts
  - src/core/messaging/routing-sender.ts
  - src/core/onboarding/checklist.ts
  - src/core/pipeline/grouping.ts
  - src/core/shared/env.ts
  - src/core/shared/tenant.ts
  - src/db/migrations/0032_phase6_console.sql
  - src/db/repository/escalations.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/schema/cadence-touches.ts
  - src/db/schema/escalations.ts
  - src/db/schema/index.ts
  - src/db/schema/tenant-attestations.ts
  - tests/approval-queue.test.ts
  - tests/cadence-tick-route.test.ts
  - tests/clicksend-dlr-route.test.ts
  - tests/clicksend-inbound-route.test.ts
  - tests/cron-schedules.test.ts
  - tests/escalation-message.test.ts
  - tests/escalation.test.ts
  - tests/helpers/env.ts
  - tests/helpers/seed.ts
  - tests/inbox-authorization.test.ts
  - tests/lint-ban.test.ts
  - tests/onboarding-checklist-gate.test.ts
  - tests/pause-upgrade.test.ts
  - tests/pipeline-grouping.test.ts
  - tests/quote-draft-approval.test.ts
  - tests/quote-triage.test.ts
  - tests/rls-coverage.test.ts
  - tests/stall-policy.test.ts
  - tests/stall-tick.test.ts
  - tests/stalled-drafts.test.ts
  - tests/tenant-validation.test.ts
  - tests/unsubscribe.test.ts
findings:
  critical: 1
  warning: 10
  info: 0
  total: 11
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-09-01
**Depth:** standard
**Files Reviewed:** 75
**Status:** issues_found

## Summary

Phase 6 adds the cross-client approval queue, the per-touch skip, the stall
alarm + nightly digest, the hot-lead escalation SMS, the ONB-04 attestation
gate, and the client pipeline. The load-bearing invariants named in the brief
hold under inspection: the tick route enumerates fields one by one, the
escalation `to` is resolved only from `tenants.escalation_phone` through
`normalizeAuMobile`, the D-04 arming switch is asked through the single
`resolveSmsFrom` before any provider call, `touches.approveWhere` remains the
one statement writing `approved` and is reached from one core, the touch writes
are equality-guarded, and no classification code acquired a write path to
suppression or sends. Migration 0032 carries REVOKE-then-GRANT for both new
tables and no write grant to `authenticated`.

The defects are elsewhere. One is a correctness blocker: the approval pair
(`drafts.approve` + `touches.approveWhere`) is **not** transactional, and every
recovery path for a half-applied approval returns `already_approved` *without*
re-running the touch write — so a touch that lands in the wedged state is
permanently undispatchable while both surfaces report success. The rest are
consistency defects of the exact class this phase says it exists to prevent: two
readings of one predicate (nav badge vs queue), two filters on one draft set
(quote page vs queue accessor), a comment that promises a revalidation the code
does not perform, a relative-time label that can contradict the urgency badge
beside it, a customer address selected into a scan-surface payload, three
unhandled DB throws on paths whose neighbours all return fixed copy, and three
dead exports.

Test files were scanned for coverage of the findings rather than line-reviewed;
`tests/approval-queue.test.ts` covers the double-tap and the guard cases but not
the partial-write recovery that CR-01 describes.

## Critical Issues

### CR-01: The approval write is not atomic, and every recovery path reports a false success

**File:** `src/core/approval/approve-draft.ts:237-294`, `:179-186`

**Issue:**
`writeApproval` performs two independent statements with no transaction:

```ts
approved = await repo.drafts.approve(draftId, { ... });   // statement 1
if (approved.length === 0) return { kind: 'already_approved' };
await repo.touches.approveWhere([touchId]);               // statement 2
```

If anything interrupts execution between them — a Vercel function timeout, a
pooled-connection drop, a redeploy mid-request, a driver error on statement 2 —
the draft row is `approved` and the touch stays `pending_approval`. Dispatch
only claims touches whose status is `approved`, so that message never sends.

The state is unrecoverable through the product:

* `loadApprovableDraft` (line 181-183) sees `latest.status === 'approved'` and
  returns `{ kind: 'already_approved' }` **before** `writeApproval` is ever
  reached, so `approveWhere` never runs again.
* `writeApproval`'s zero-row branch (line 280-282) also returns
  `already_approved` before statement 2.
* `approvalControlState` maps that to `DRAFT_ALREADY_APPROVED_MESSAGE` —
  *"This draft was already approved. It goes out at its scheduled time."* — which
  is false, and is rendered with `settled: true`, removing the controls.
* The quote page hides the row entirely
  (`clients/[id]/quotes/[quoteId]/page.tsx:524`, `if (row.status !== 'generated'
  && row.status !== 'validator_failed') continue;`), so the touch disappears
  from the per-quote surface as well.

The module header argues at length that the *order* of the two writes is
load-bearing because the reverse order would produce "an approved touch whose
approved draft does not exist… which dispatch reads as `no_approved_draft` and
refuses forever, silently". The symmetric failure — an approved draft whose
touch never moved — has the same consequence and is not guarded against at all.
The touch is also still counted by `APPROVAL_QUEUE_STATUSES`, so it keeps
appearing on `/queue` and keeps generating stall alerts, forever.

**Fix:** make the pair atomic, and make the idempotent paths actually
idempotent:

```ts
// in writeApproval
const outcome = await repo.transaction(async (tx) => {
  const approved = await tx.drafts.approve(draftId, {
    finalBody, editDistance: String(editDistance), approvedAt: new Date(),
  });
  if (approved.length === 0) return 'already' as const;
  await tx.touches.approveWhere([touchId]);
  return 'written' as const;
});
if (outcome === 'already') {
  // REPAIR, not a bare report: an earlier attempt may have flipped the draft
  // and died before the touch moved. approveWhere is guarded on
  // `pending_approval`, so this is a no-op in the ordinary double-tap case.
  await repo.touches.approveWhere([touchId]);
  return { kind: 'already_approved' };
}
```

and give `loadApprovableDraft`'s `latest.status === 'approved'` branch the same
repair before it returns `already_approved`. Add a regression test that flips a
draft to `approved` directly, leaves the touch at `pending_approval`, and
asserts that a second `approveUnchanged` moves the touch.

## Warnings

### WR-01: The queue renders approve/edit controls for drafts the server will refuse

**File:** `src/db/repository/for-all-tenants.ts:828-835`, `src/app/(console)/queue/queue-card.tsx:190`, `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx:522-525`

**Issue:** `forAllTenants_approvalQueue` left-joins the *latest attempt* with no
predicate on `touch_drafts.status`. The quote page's equivalent read explicitly
filters it (`if (row.status !== 'generated' && row.status !== 'validator_failed')
continue;`). So for a `pending_approval` touch whose newest attempt is
`approved` or `superseded`, the two approval surfaces disagree: the quote page
shows nothing, the queue renders a full `DraftCard` with the badge
`awaiting approval`, the body of a message that will not be sent, and a working
"Approve and send as written" button. Tapping it yields `already_approved`
(reported as success) or `superseded` (reported as an error the operator cannot
clear), and the card returns on every reload.

This is the CR-02 drift class the phase was structured to prevent — one
population rule, two filters — and it directly violates the `draft-card.tsx`
header's stated property that "the operator is never offered a tap the server
would refuse."

**Fix:** push the status filter into the shared accessor so both surfaces read
one rule:

```ts
.leftJoin(
  touchDrafts,
  and(
    eq(touchDrafts.touchId, cadenceTouches.id),
    eq(touchDrafts.attempt, latest.latestAttempt),
    inArray(touchDrafts.status, ['generated', 'validator_failed']),
  ),
)
```

and delete the duplicate filter on the quote page (or have it import the same
exported constant). A touch whose latest attempt is filtered out then renders
through the existing `row.draft === null` no-draft card, which already says
something honest.

### WR-02: The nav Queue badge and the queue page count different populations

**File:** `src/app/(console)/layout.tsx:49-76`, `src/app/(console)/queue/page.tsx:107-136`

**Issue:** The badge counts `cadence_touches` through `createClient()` (RLS,
`has_tenant_access(tenant_id)` — membership only; migration 0016 grants the
`cadence_touches` policy no `is_operator()` arm). The queue page counts and
renders through `forAllTenants_approvalQueue()`, which is service-role and
returns every tenant. For any operator who is not a `tenant_members` row on
every tenant the two numbers differ — and the queue page *already assumes that
case exists*, because it renders `UNKNOWN_CLIENT = 'Another client'` for tenants
it cannot name under RLS.

`stall-policy.ts:9-18` states the failure this produces by name: "a badge that
reads red beside a list of three cards that all read `scheduled`, which teaches
an operator that the colour means nothing."

**Fix:** either give the badge the same authority as the page (a service-role
count behind `requireOperator()`, accepting that the layout gate must then be
upgraded from `getClaims()` to `requireOperator()`), or scope the queue read to
the operator's memberships. Whichever is chosen, assert the two counts agree for
a tenant the operator is not a member of.

### WR-03: The queue's approve/skip actions refuse the very cards the queue page renders

**File:** `src/app/(console)/queue/actions.ts:83-108` vs `src/app/(console)/queue/page.tsx:94-105`

**Issue:** Same asymmetry as WR-02, seen from the write side. The page gate is
`requireOperator()` alone; `authorize(tenantId)` in the actions is
`requireOperator()` **and** an RLS-scoped `tenants` read. For any tenant the
operator can see through the service-role queue but is not a member of, every
control on the card — approve, edit-then-approve, skip — returns
`UNKNOWN_QUOTE_MESSAGE` ("Unknown client or quote."), with no `settled`, so the
buttons stay and the operator can retry forever. The card is a permanent
dead end on the one screen whose purpose is clearing work.

**Fix:** make the page's population and the action's authorization answer the
same question. If the intent is genuinely "the operator is the cross-tenant
human" (the inbox precedent), then `authorize()` should accept an operator
without a membership row — but note that the inbox's own tables carry an
`is_operator()` arm in their RLS policy (`0025_inbound_messages.sql:73`) and
`cadence_touches` does not, so this is a deliberate decision to make and record,
not a line to delete.

### WR-04: `revalidateQueue` does not revalidate the quote page its own comment promises

**File:** `src/app/(console)/queue/actions.ts:110-123`

**Issue:** The doc comment reads: "The queue is the surface the operator is
looking at; the quote page and the client page render the same touch's state,
and an operator who taps through to a quote seconds later must not find the card
they just cleared still offering an approve button." The body revalidates
`/queue` and `/clients/${tenantId}` — the quote path is missing. The quote
page's own `revalidateBoth` (`quotes/[quoteId]/actions.ts:173-184`) does
revalidate all three, so the two surfaces are inconsistent.

**Fix:** the queue row already carries `quoteId`; bind it onto the actions the
way `tenantId` is bound, and revalidate it:

```ts
function revalidateQueue(tenantId: string, quoteId: string): void {
  revalidatePath('/queue');
  revalidatePath(`/clients/${tenantId}`);
  if (UUID_PATTERN.test(quoteId)) revalidatePath(`/clients/${tenantId}/quotes/${quoteId}`);
}
```

Alternatively, correct the comment to say the quote page is deliberately left to
its own `force-dynamic` render — but a comment asserting a behaviour the code
does not have is worse than either.

### WR-05: `relativeToSlot` can say "overdue" while the badge beside it says "due soon"

**File:** `src/app/(console)/queue/page.tsx:81-89`

**Issue:** The function's own header claims the sentence and the badge "cannot
say different things about one slot" because both come from the same clock. They
can:

```ts
const minutes = Math.round((scheduledAt.getTime() - now.getTime()) / 60_000);
if (minutes <= 0) return 'overdue';
```

`Math.round` floors any slot inside the next 30 seconds to `0`, so the text
reads `overdue` while `deriveUrgency` (`slot <= now` → overdue) correctly
returns `due_soon` and paints the `--warn` badge. Separately, `Math.round` on
the hour and day branches rounds *up*: a slot 91 minutes away renders as
"due in 2h", which overstates the time the operator has.

**Fix:** derive both from the same comparison and floor rather than round:

```ts
const ms = scheduledAt.getTime() - now.getTime();
if (ms <= 0) return 'overdue';            // identical predicate to deriveUrgency
const minutes = Math.floor(ms / 60_000);
if (minutes < 60) return `due in ${Math.max(1, minutes)}m`;
const hours = Math.floor(minutes / 60);
if (hours < 24) return `due in ${hours}h`;
return `due in ${Math.floor(hours / 24)}d`;
```

### WR-06: `job_address` is selected into the client-list payload and never rendered

**File:** `src/app/(console)/clients/[id]/page.tsx:85`, `:518`

**Issue:** The pipeline read selects `job_address` (a customer's physical
address) and `sm8_job_uuid`; neither is referenced anywhere in the file — the
row renders `generated_job_id`, `job_description`, money and dates. Both columns
are therefore serialised into the server-rendered HTML payload and the client
router cache for no consumer.

This contradicts the file's own stated discipline in three places — "every
column named here is serialised into this page's HTML payload and into the
client router cache" (`:130-142`), the `key_last4` argument (`:63-71`), and the
pipeline-row comment celebrating "one fewer customer identifier on a surface
whose whole job is to be scanned in public" (`:585-589`) — and it is the same
T-2-02 class the quote page's `to_address` note (`quotes/[quoteId]/page.tsx:94-101`)
was written to close.

**Fix:** drop both columns from the select list and from `QuoteRow`:

```ts
.select('id, generated_job_id, job_description, total_invoice_amount, quote_date_utc, status, chase_eligibility')
```

`job_address` stays on the quote detail page, which renders it.

### WR-07: A claimed stall alert that fails after the claim is reported as zero of everything

**File:** `src/core/cadence/run-tick.ts:819-851`

**Issue:** `runAgingPass` wraps the claim, the tally and the send in one
`try`. `forAllTenants_claimNewlyStalled` has already committed
`stall_alerted_at` by the time control reaches the send. If anything after the
claim throws — `tallyByTenant`'s `tenants` read, `queueUrl()` →
`consoleBaseUrl()` → `getServerEnv()`, or a future `send` implementation that
throws rather than returning `{ ok: false }` — the catch returns
`{ touchesNewlyStalled: 0, stallAlertSent: 0, stallAlertFailed: 0 }`.

Those touches are now claimed forever (the guard is `stall_alerted_at IS NULL`)
and will never be alerted about again, while the tick response says nothing
happened. `CadenceTickResult.stallAlertFailed`'s own field comment says it exists
because it "is the only way a lost alert is visible at all" — this path makes it
invisible.

**Fix:** split the try, so a post-claim failure still reports the claim:

```ts
const { claimed, perTenant } = await forAllTenants_claimNewlyStalled({ ... });
if (claimed.length === 0) return { touchesNewlyStalled: 0, stallAlertSent: 0, stallAlertFailed: 0 };
try {
  const outcome = await send(buildStalledAlert({ perTenantCounts: perTenant, at: now, queueUrl: queueUrl() }));
  return { touchesNewlyStalled: claimed.length, stallAlertSent: outcome.ok ? 1 : 0, stallAlertFailed: outcome.ok ? 0 : 1 };
} catch {
  console.error('[cadence] stall alert send failed after the claim.');
  return { touchesNewlyStalled: claimed.length, stallAlertSent: 0, stallAlertFailed: 1 };
}
```

(with the outer catch retained around the claim itself).

### WR-08: Three write paths have no error handling on surfaces where every neighbour does

**File:** `src/app/(console)/clients/[id]/actions.ts:387`, `:470`, `src/app/(console)/clients/[id]/page.tsx:706`

**Issue:**

* `updateEscalationPhoneAction` calls `forTenant(tenantId).tenant.update({...})`
  with no `try`. `tenant.update` throws by design on an empty/unknown/immutable
  patch (`for-tenant.ts:1482-1501`), and any driver error propagates. The action
  returns `EscalationPhoneState`, whose whole purpose is a fixed sentence.
* `attestSm8AutomationOffAction` calls `attestSm8AutomationOff`, which throws
  explicitly (`onboarding-gate.ts:500`) and runs a transaction, with no `try`.
* `ClientDetailPage` awaits `readOnboardingChecklist(tenant.id, now)` unguarded
  — seven parallel reads, any of which takes the entire client page down with a
  500. Every other read on that page is deliberately tolerated ("half a page
  beats none", `:508-512`), and the connection/quotes/runs reads all degrade.

An unhandled throw in a Server Action surfaces as a generic error with a digest
and no operator-actionable copy; on the page it is a blank error boundary on the
one screen that carries the activation gate.

**Fix:** wrap each in the established shape — `catch { console.error('[clients]
escalation phone write failed'); return { ...BLANK_ESCALATION_PHONE_STATE, error:
BAD_REQUEST_MESSAGE }; }` — and for the page, catch around
`readOnboardingChecklist` and render the checklist card with an "could not load"
row rather than failing the route.

### WR-09: Dead exports on three Phase 6 modules

**File:** `src/app/(console)/components/label-guess.ts:61-64`, `src/core/alerts/stalled-drafts.ts:299-307`, `src/core/aging/stall-policy.ts:143-145`

**Issue:**

* `labelGuess()` has zero consumers. All three surfaces the module header names
  (inbox `page.tsx:230`, quote page `:740`, client page `:441`) read
  `LABEL_GUESS_LABELS` directly and each re-implements the `?? raw` fallback
  inline — so the function that exists to own that fallback owns nothing, and
  the "one array of words in one file rather than a comment asking three files to
  agree" argument is only half-realised.
* `sendStalledDraftAlert` and `sendDailyDigest` have no callers anywhere in
  `src/` or `tests/`. Both routes inject `resendStalledEmailSender` and call the
  builders directly. They are two extra entry points onto the live Resend path
  that nothing exercises.
* `selectStalled` is referenced only by its own test.

**Fix:** delete `sendStalledDraftAlert`/`sendDailyDigest`; either delete
`labelGuess` or convert the three call sites to use it (preferred — it is the
fallback rule the header claims is centralised). Keep or drop `selectStalled` on
its own merits, but a helper whose only caller is its test is not covered, it is
described.

### WR-10: `ControlState.fixes` is honoured by one renderer and silently dropped by the other

**File:** `src/app/(console)/components/draft-card.tsx:349-365` vs `src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx:195-224`

**Issue:** `fixes` is declared on the shared `ControlState`
(`components/action-state.ts:80-95`) with the explicit rationale that "a refusal
that names a missing condition and then leaves the operator to find the screen
that supplies it is half an answer." `CadenceControls`' `Message` renders it;
`DraftCard`'s `Message` — the component both approval surfaces share — does not
render it at all. No approval outcome sets `fixes` today, so nothing is broken
now; the moment one does (an approval gated on an unmet onboarding condition is
the obvious candidate), the link disappears on the queue and the quote page's
draft card while still appearing on the cadence controls three elements above.

Both renderers are also duplicated implementations of one component under one
name, in a phase whose thesis is that a second correct copy is the defect.

**Fix:** extract one `<ActionMessage state={...} />` into
`components/action-state`-adjacent module and use it from both, or at minimum
render `state.fixes` in `draft-card.tsx`'s `Message` with the identical markup.

---

_Reviewed: 2026-09-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
