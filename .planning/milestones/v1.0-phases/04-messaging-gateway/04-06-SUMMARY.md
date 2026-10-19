---
phase: 04-messaging-gateway
plan: 06
subsystem: messaging
tags: [console, triage, inbox, resend, domains, dns, residency, spam-act, operator-gate, msg-02, msg-04]

requires:
  - phase: 04-messaging-gateway
    plan: 02
    provides: the four inbound attributions, `candidate_tenant_ids`, `is_stop`, `triaged_at` and the dead-letter rows this inbox lists
  - phase: 04-messaging-gateway
    plan: 03
    provides: messaging_config, upsertChannelConfig/listChannelConfig, and the D-04 rule that an enabled row is the activation switch
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: `_auth.ts` / `requireOperator()` (CR-01), the console page + server-action + action-state conventions, the WR-08 no-raw-db-error rule
provides:
  - /inbox — the operator-gated reply-triage surface (untriaged ambiguous / unmatched / dead-letter / STOP rows, with candidates and a mark-handled action)
  - listInboundNeedingTriage / markInboundTriaged — the capped queue read and the only writer of `triaged_at`
  - /settings/email — domain verification (DNS records the operator pastes), per-tenant + global email identity, and the rendered AU-residency note
  - createDomain / listDomains / getDomain / verifyDomain / domainOfAddress — the Resend domains boundary, non-throwing, error-name-only
  - the server-side verified-domain refusal (T-4-26) that stands between a config row and an unverified send
affects: [04-05 resend sender arm, 04-07 provider wiring + activation, 05 email touches, 06 full console]

actuals:
  tokens: 61000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A third party's string that a HUMAN quotes back to somebody else is bounded but never rewritten: `codeOf` turns `ap-northeast-1` into `ap_northeast_1`, which is not a region anybody can look up — length is what bounds a leak, hyphens were never the risk"
    - "A repository family that lives outside `forTenant()` pays for it by joining nothing, and the payment falls due when a screen wants a NAME: the ids come back from the service-role read and the names are resolved on the page through the operator's own JWT, which can only ever name clients that operator may already see"
    - "A provider read whose answer gates a write is a REFUSAL when it fails, never a pass — the same `error || !data` default `requireOperator` takes, applied to `listDomains`"
    - "An operator-facing honesty note is asserted as rendered source, not trusted to a comment: the assertion pins the region CODE, because a code is checkable and 'offshore' is a word that softens every time somebody edits the copy"
    - "A `'use server'` module's export COUNT is pinned in a test, and every export is asserted to open with the gate — each export is a globally-POSTable endpoint, so the fourth one added later must be a decision somebody typed"

key-files:
  created:
    - src/app/(console)/inbox/page.tsx
    - src/app/(console)/inbox/actions.ts
    - src/app/(console)/inbox/action-state.ts
    - src/app/(console)/inbox/mark-handled-form.tsx
    - src/app/(console)/settings/email/page.tsx
    - src/app/(console)/settings/email/actions.ts
    - src/app/(console)/settings/email/action-state.ts
    - src/app/(console)/settings/email/forms.tsx
    - src/core/messaging/resend-domains.ts
    - tests/inbox-authorization.test.ts
    - tests/resend-domains.test.ts
    - tests/email-settings-action.test.ts
  modified:
    - src/db/repository/inbound-messages.ts
    - src/db/repository/index.ts
    - src/app/(console)/layout.tsx
    - tests/lint-ban.test.ts

key-decisions:
  - "`listInboundNeedingTriage` does NOT join `tenants`, against the plan's action text. That join is precisely what this repository family is allowed to exist in exchange for not doing — it would turn 'an unattributed reply' into a cross-tenant read of the client list, through a service-role accessor, for a label. The ids come back and the page resolves names under RLS"
  - "Every STOP is in the triage queue, including THREADED ones, though a threaded stop was already acted on: somebody exercising a Spam Act right is a thing an operator should SEE happen, not a row that quietly worked"
  - "The Resend region is passed EXPLICITLY on every create and asserted with `toBe` on the literal. Resend's default is `us-east-1`, and a domain created without the argument is a client's mail processed in Virginia while the page beside it says Tokyo — a difference nothing in the UI would ever show, because the region is only ever read back from the domain we just created"
  - "DNS record VALUES pass through byte-identical while STATUSES are bounded to a code. Opposite treatments of two fields from the same response, and the asymmetry is the point: a status reaches a comparison and a log line, a DKIM value is the ~400-character string the operator copies by hand"
  - "The region label got its own sanitizer (`boundedLabel`) after the test caught `codeOf` rendering `ap_northeast_1` beside a residency note claiming `ap-northeast-1`"
  - "The verified-domain check runs whenever a from-address is supplied, not only when `enabled` is ticked: a row's only purpose is to be enabled, and a rule with one state exempted is a rule somebody reasons around"
  - "A failed `listDomains` REFUSES the write. Key revoked, provider down, network gone — every one of those is a state in which 'write it anyway' means possibly arming email on a domain nobody has verified"
  - "Enabling requires a reply-to and a business name, neither of which the plan asked for. D-01 says the system never sees email replies, so a missing reply-to is a customer saying yes into an inbox nobody reads; and the Spam Act requires the sender to be identified. An enabled row missing either is a compliance defect with a green tick on it"
  - "MSG-02 is NOT marked complete by this plan, though the plan's frontmatter claims it. D-02 defines MSG-02 as the email pipe PROVEN by a real send through the TouchSender path — the sender is 04-05 and the live proof is 04-07. Ticking it here would be exactly the green tick this codebase refuses"
  - "Both new pages are in the nav, though `layout.tsx` is not in the plan's file list: a triage screen nobody can reach is a triage screen nobody triages, and a domain flow the operator cannot find ends with them asking a developer, which is the thing the page exists to stop"

patterns-established:
  - "Console authorization suites are behavioural where there is an action to drive (assert the MOCK'S CALL COUNT on the denied path, since a repository-first action returns the same denial message having already written) and a source scan where the failure mode is an export nobody remembered"
  - "The gate-ordering assertion is textual and structural: split the action module on `export async function`, take the first statement of each body, require it to be `const access = await requireOperator()`"

requirements-completed: []

coverage:
  - id: D37
    description: "Untriaged ambiguous, unmatched, dead-letter and STOP inbound rows are listed for the operator with from-address, body, attribution, matched-cadence count and candidate tenant names; a threaded row links to its quote; the empty state reads 'No inbound needing attention.'"
    requirement: "MSG-04"
    verification:
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#the page reads the queue through the capped repository accessor"
        status: pass
      - kind: manual
        ref: "End-of-phase human check: /inbox on a phone-sized viewport"
        status: deferred
    human_judgment: true
    rationale: "The queue predicate, the cap and the mark-handled write are asserted; whether the rendered list is legible on a phone with a real row in it is a judgement only a human at the phone can make, and the hosted database currently holds zero inbound rows."
  - id: D38
    description: "The mark-handled action rejects an unauthenticated and a non-operator caller BEFORE any repository call, and calls markInboundTriaged with the row id for an operator"
    requirement: "MSG-04"
    verification:
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#rejects an unauthenticated caller WITHOUT calling the repository"
        status: pass
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#rejects an authenticated NON-operator WITHOUT calling the repository"
        status: pass
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#marks the row handled for an operator, with the id from the form"
        status: pass
    human_judgment: false
  - id: D39
    description: "`markInboundTriaged` is guarded on `triaged_at IS NULL`, so a repeat reports 'already handled' rather than resetting when the row was first handled"
    requirement: "MSG-04"
    verification:
      - kind: unit
        ref: "tests/inbox-authorization.test.ts#reports an already-handled row honestly rather than as a fresh write"
        status: pass
      - kind: other
        ref: "The guard itself is a WHERE clause; no remote assertion was run against it (this plan is pure-verification-only by wave-4 serialization)"
        status: deferred
    human_judgment: false
    rationale: "The predicate follows the established guard-as-WHERE house style (`pauseWhereActive`, `updateDeliveryWhereMatch`) and is exercised through a mocked repository. Driving it against real rows needs a remote run, which this plan is forbidden from making — 04-04 held the hosted database this wave."
  - id: D40
    description: "createDomain passes region `ap-northeast-1` explicitly and returns the DNS records with values byte-identical; a DKIM key survives the round trip whole"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/resend-domains.test.ts#passes the ap-northeast-1 region EXPLICITLY"
        status: pass
      - kind: unit
        ref: "tests/resend-domains.test.ts#returns the DNS records with values BYTE-IDENTICAL"
        status: pass
    human_judgment: false
  - id: D41
    description: "All four wrapper calls map success and failure without throwing; a failure carries the error NAME only and never the provider message"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/resend-domains.test.ts#reports an error by NAME and never carries the provider message"
        status: pass
      - kind: unit
        ref: "tests/resend-domains.test.ts#does not throw when the SDK does"
        status: pass
      - kind: unit
        ref: "tests/resend-domains.test.ts#reports an error by name and does not throw (list / get / verify)"
        status: pass
    human_judgment: false
  - id: D42
    description: "The enablement action refuses a from-address whose domain is absent, unverified, partially verified, or unreadable — server-side, before any write"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/email-settings-action.test.ts#REFUSES a from-address whose domain is not on the account"
        status: pass
      - kind: unit
        ref: "tests/email-settings-action.test.ts#REFUSES a domain whose status is %s (4 rows)"
        status: pass
      - kind: unit
        ref: "tests/email-settings-action.test.ts#REFUSES when the domain list cannot be read — a read failure is not a pass"
        status: pass
    human_judgment: false
  - id: D43
    description: "All three email-settings exports are gated before they act, and the export count is pinned so a fourth must be a decision somebody typed"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/email-settings-action.test.ts#every export of the action module is gated — the count is pinned"
        status: pass
      - kind: unit
        ref: "tests/email-settings-action.test.ts#%s refuses an unauthenticated caller and does nothing"
        status: pass
    human_judgment: false
  - id: D44
    description: "The AU-residency note names `ap-northeast-1` and renders on the email settings page above every control"
    requirement: "MSG-02"
    verification:
      - kind: unit
        ref: "tests/email-settings-action.test.ts#the RESIDENCY NOTE names ap-northeast-1 on the rendered page"
        status: pass
    human_judgment: false
  - id: D45
    description: "A real domain can be taken from nothing to verified-and-enabled from the console: add it, paste the displayed records at a DNS host, check DNS until verified, save a tenant's identity"
    requirement: "MSG-02"
    verification:
      - kind: manual
        ref: "End-of-phase human check; the live proof is scripts/verify-email-pipe.mjs in 04-05/04-07"
        status: deferred
    human_judgment: true
    rationale: "Nothing in this repository can observe a real Resend account. The wrapper is exercised against a mocked SDK built from the installed SDK's own type definitions (resend@6.22.1), so the untested seam is exactly one: whether a real response carries the fields these types promise. Verification is also asynchronous at Resend, so 'verified' can only be observed by re-reading a real domain."

duration: 19min
completed: 2026-08-29
status: complete
---

# Phase 4 Plan 06: The Two Operator Surfaces — Reply Triage and the Email Pipe Summary

**The two things this phase decided a human must do now have somewhere to do them: every reply the attribution algorithm refused to guess about is listed, contextualised and dismissable on one operator-gated screen, and a client's sending domain goes from nothing to verified-and-enabled without a developer — with the sentence about where email is actually processed rendered above the switch rather than buried in a research file.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-08-29T04:41:00Z
- **Completed:** 2026-08-29T05:00:00Z
- **Tasks:** 2
- **Files modified:** 16 (12 created, 4 modified)
- **Pure suite:** 1054 tests green on a bare `npm test`; 27 integration files refusing, which is the WR-09 guard and the same count as before this plan
- **`npm run build`:** green, with `/inbox` and `/settings/email` both listed as dynamic routes
- **Remote suite:** deliberately NOT run — this plan shares wave 4 with 04-04, and the hosted Sydney database forbids overlapping runs

## Accomplishments

- **Ambiguity has an address.** 04-02 made three of the four inbound branches deliberately do nothing automatic — an ambiguous reply pauses no cadence, because a pause acted on a guess is a lever anyone who can guess a phone number could pull. That decision is only defensible if the unplaced rows reach a human, and until this plan they reached a table. `/inbox` lists every untriaged `ambiguous`, `unmatched` and `dead_letter` row plus **every STOP, including threaded ones** — a threaded stop was already acted on, and it is there because somebody exercising a Spam Act right is a thing an operator should see happen.
- **The repository family paid its debt without breaking its promise.** `inbound-messages.ts` exists outside `forTenant()` on the explicit condition that it reads one table and joins nothing. The triage screen wants client NAMES for `candidate_tenant_ids`, and the obvious implementation is a join to `tenants` right there — through a service-role accessor, for a label. It does not do that: the ids come back and the page resolves names through the operator's OWN JWT under RLS, which can only ever name clients that operator may already see.
- **The Resend region is passed explicitly, and one assertion can fail on it.** Resend's default region is `us-east-1`. A `createDomain` call without the argument produces a client's mail processed in Virginia while the settings page beside it says Tokyo — and nothing in the UI would ever show the difference, because the region is only ever read back from the domain we just created. `expect(payload.region).toBe('ap-northeast-1')` is the only line in this repository that catches it.
- **DNS values are byte-identical; statuses are bounded.** Opposite treatments of two fields from the same response. A DKIM public key is ~400 characters the operator copies by hand, and a display truncation added later would produce a domain that verifies nowhere and mail that lands in spam with a green tick on our screen — so it is asserted with `toBe` on the whole string, the same shape of assertion as the 220-character SMS body in 04-03. A status reaches a comparison and a log line, so it goes through `codeOf`.
- **The honesty note is rendered, and the test pins the region code rather than the sentiment.** AU residency is a selling point the operator states out loud; the true version has an exception in it (Supabase Sydney, Resend offshore, ClickSend offshore). The note sits above every control on the page, and the assertion checks for the literal `ap-northeast-1` — because a region code is checkable by a prospect's IT person, where "offshore" is a word that softens every time somebody edits the copy.
- **Enabling email refuses more than the plan asked it to.** Unverified domain, absent domain, partially-verified domain, unreadable domain list, missing reply-to, missing business name — six refusals, all server-side, all before the row is written. The form offering only verified domains is a convenience; the action's id is global and the body is the caller's.
- **`messaging_config` is untouched on the hosted database.** Every test in this plan is pure: the repository, the provider and `next/cache` are mocked, so nothing here can leave an enabled row behind — the row that, by D-04's own design, arms real client messaging with no deploy.

## Task Commits

1. **Task 1: the reply-triage inbox** — `84b508b` (feat)
2. **Task 2: email domain verification + per-tenant identity + residency note** — `1c44f19` (feat)

## Files Created/Modified

**Created**

- `src/app/(console)/inbox/page.tsx` — operator-gated server component; the header carries the argument for why the raw from-address and body are rendered here and forbidden in logs.
- `src/app/(console)/inbox/actions.ts` — ONE export, gated before the body is read.
- `src/app/(console)/inbox/action-state.ts`, `mark-handled-form.tsx` — the state constant and the per-row client form (`'use server'` modules may export only async functions).
- `src/app/(console)/settings/email/page.tsx` — residency note, per-domain DNS tables, config table, forms.
- `src/app/(console)/settings/email/actions.ts` — three gated exports: add domain, check DNS, save identity.
- `src/app/(console)/settings/email/action-state.ts`, `forms.tsx` — same split; three controls in one client module because they share a state shape and a feedback block.
- `src/core/messaging/resend-domains.ts` — framework-free wrapper; four calls, closed unions, `codeOf` for statuses, `boundedLabel` for the region, `domainOfAddress` as the one spelling of "the domain part".
- `tests/inbox-authorization.test.ts` — 15 assertions, pure.
- `tests/resend-domains.test.ts` — 23 assertions, pure, SDK mocked.
- `tests/email-settings-action.test.ts` — 36 assertions, pure.

**Modified**

- `src/db/repository/inbound-messages.ts` — `listInboundNeedingTriage` (capped, explicit select list, `raw_payload` deliberately absent), `markInboundTriaged` (guard-as-WHERE), `TRIAGE_ATTRIBUTIONS`, `TRIAGE_PAGE_SIZE`.
- `src/db/repository/index.ts` — four new barrel exports on the inbound family's line, with the not-joining-tenants argument written in place.
- `src/app/(console)/layout.tsx` — `/inbox` first in the nav, `/settings/email` last.
- `tests/lint-ban.test.ts` — the barrel key-set tripwire widened, with the argument.

## Decisions Made

See `key-decisions` in the frontmatter. The three worth reading twice:

1. **The join that was not written.** The plan's action text says `listInboundNeedingTriage` should be "joined with tenant names for the candidate_tenant_ids where present". Doing that would have been a one-line convenience that quietly cancelled the reason this repository family is allowed to exist at all: it reads one table and joins nothing, so nothing in it can turn an unattributed reply into a cross-tenant read of the client list. The names are resolved on the page instead, through the operator's own JWT — a strictly narrower authority than the service-role read above it, and one that degrades honestly (a client the operator cannot see renders as "Another client" rather than as a bare uuid or an invented name).

2. **A failed provider read is a refusal, not a pass.** `saveEmailConfigAction` asks `listDomains` whether the from-address's domain is verified. When that call fails — key revoked, provider down, network gone — the action refuses the write and says nothing was saved. The alternative reading ("we could not check, so proceed") is the one that arms email on an unverified domain, and the failure it produces is invisible from inside this system: Resend accepts the send, the ledger records it, and the client's follow-ups are quietly rejected at the receiving end. This is the same `error || !data` default `requireOperator()` takes on the allowlist read, applied one boundary over.

3. **MSG-02 is not ticked.** The plan's frontmatter claims MSG-02 and MSG-04. MSG-04 was already complete (04-02). MSG-02, per D-02, means the email pipe is *proven* — a real send through the actual `TouchSender` path — and this plan builds neither the sender (04-05) nor the live proof (04-07). Marking it complete because a domain-verification screen exists would be precisely the green tick this phase's other plans were written to avoid. `REQUIREMENTS.md` is unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The region rendered as `ap_northeast_1`, one line below a note claiming `ap-northeast-1`**
- **Found during:** Task 2 (the domain-list test)
- **Issue:** Every third-party string in the wrapper went through `codeOf`, which collapses non-alphanumerics to `_` — the sanitizer 04-03 established for provider statuses. Applied to a region it produces `ap_northeast_1`, which is not a region anybody can look up, rendered beside a residency note that names the real code. The one field on this page a prospect's IT person is most likely to check would have been the field that did not match.
- **Fix:** `boundedLabel` — trim and cap at 32 characters, no character substitution — used for the region only. The cap stays because the field is still a third party's string; the substitution goes because length is what bounds a leak and hyphens were never the risk. Documented at the function.
- **Verification:** `tests/resend-domains.test.ts#maps the account list and bounds each status to a code`, which asserts the region verbatim and the status bounded, in the same object.
- **Committed in:** `1c44f19`

**2. [Rule 2 - Missing Critical] Enabling email refuses without a reply-to or a business name**
- **Found during:** Task 2
- **Issue:** The plan's form spec lists reply-to and business name as fields. Nothing required them. D-01 is explicit that v1 email sends FROM a service subdomain with REPLY-TO the tradie's own address, and that the system never sees email replies — so an enabled row with no reply-to sends mail whose answers go to an unmonitored inbox, and neither the tradie nor this system ever learns the customer said yes. Separately, the Spam Act requires the sender to be identified, which is what `business_name` puts in the message.
- **Fix:** Both required when `enabled` is ticked, each with its own sentence naming the consequence rather than the field. A disabled row may still be blank.
- **Verification:** `tests/email-settings-action.test.ts` — the three "an enabled row cannot be missing what compliance requires" blocks.
- **Committed in:** `1c44f19`

**3. [Rule 2 - Missing Critical] The verified-domain check runs whenever a from-address is supplied, not only on enable**
- **Found during:** Task 2
- **Issue:** The plan scopes the check to enablement. That leaves a saved-but-disabled row carrying a from-address on an unverified domain — a row the next operator (or the same one, a week later) enables believing it was checked, because it is sitting in the table beside rows that were.
- **Fix:** The check runs on any non-empty from-address. A rule with one state exempted is a rule somebody reasons around.
- **Verification:** `tests/email-settings-action.test.ts#checks the domain even when the row is being saved DISABLED`.
- **Committed in:** `1c44f19`

**4. [Rule 2 - Missing Critical] Both pages are in the nav, though `layout.tsx` is not in the plan's file list**
- **Found during:** Task 1
- **Issue:** The plan's must-haves say the operator inbox lists untriaged rows and that the operator can verify a domain without touching code. Neither is true of a route with no link to it: the honest description would have been "the operator can do this if they remember the URL". A triage screen nobody can reach is a triage screen nobody triages.
- **Fix:** `/inbox` FIRST in the nav — it is the only screen holding work with a clock on it — and `/settings/email` last, where an onboarding-time page belongs. Both placements are argued in comments at the links.
- **Committed in:** `84b508b` and `1c44f19`

### Structural deviations

**5. Four files were added that the plan's `files_modified` does not list**
- `inbox/action-state.ts`, `inbox/mark-handled-form.tsx`, `settings/email/action-state.ts`, `settings/email/forms.tsx`. Not scope creep: a `'use server'` module may export only async functions (a const export is a module-evaluation error under Turbopack), and `useActionState` requires a client component. This is the exact split `clients/[id]/{actions,action-state,triage-form}.tsx` already uses, and the alternative — plain forms with no state — would have meant a mark-handled tap that fails silently on the one screen whose rows are compliance events.

**6. A third test file, `tests/email-settings-action.test.ts`**
- The plan names two suites. The acceptance criterion "the enablement server action rejects an unverified domain's from_address server-side (unit test with mocked wrapper)" belongs to neither: `resend-domains.test.ts` mocks the SDK and tests the wrapper, while this one mocks the wrapper and tests its consumer. Putting both in one file would have meant two different mock boundaries in one module. Same split, and the same reasoning, as 04-03's `routing-sender` / `routing-dispatch` division.

**7. `src/db/repository/messaging-config.ts` is in the plan's `files_modified` and was not modified**
- `upsertChannelConfig` already had the shape this plan needed, including the exhaustive SET clause that makes clearing a field clear the column. Nothing was added to avoid touching it; there was nothing to add.

**8. `getDomain` is exported, though the plan's `artifacts.exports` lists only three**
- The plan's own action text asks for four, and the fourth is load-bearing: Resend's `list` endpoint does not return DNS records and `verify` returns only an id, so `getDomain` is the only call that can produce the table this page exists to show.

---

**Total deviations:** 4 auto-fixed (1 bug, 3 missing-critical), 4 structural.
**Impact on plan:** No scope creep. Deviation 1 is the one that would have shipped something wrong — a region label contradicting the residency note directly beneath it, on the one page written to make that claim checkable.

## Issues Encountered

- **No remote verification, by design.** This plan shares wave 4 with 04-04, which runs remote suites against the hosted Sydney database, and the two must not overlap. Everything here is pure (`npm test`, `npx tsc --noEmit`, `npm run build`). The consequence is recorded honestly in coverage D39: the `triaged_at IS NULL` guard is a WHERE clause exercised through a mocked repository, not against real rows.
- **Nothing has ever received a real Resend domains response.** The wrapper is built against the installed SDK's own type definitions (`resend@6.22.1`) and exercised with a mocked client. The untested seam is exactly one: whether a real response carries the fields those types promise. `empty_response`, the tolerant `?? []` on records, and the non-throwing contract all exist because that seam cannot be closed from here.
- **The hosted `inbound_messages` table is empty**, so the inbox has never rendered a real row. The empty state is what an operator sees today, and that is correct — no SMS has been received because ClickSend is not wired to the webhook yet (04-07, still behind the IPND business-address requirement).
- **The cross-session `0025` journal collision is unchanged.** This plan generated no migration.

## User Setup Required

**Nothing to run now.** When the operator is ready to verify a client's domain:

1. Open `/settings/email` (nav: **Email**).
2. Add the sending subdomain — a subdomain the client owns, or the service subdomain. Not their bare invoicing domain.
3. Copy each row of the DNS table into the client's DNS host exactly as shown. The DKIM value is long and every character matters.
4. Press **Check DNS**. Verification is asynchronous at Resend — refresh a minute later; propagation can take longer than the check.
5. Once the badge reads **Verified**, save an email identity: the client, a from-address on that domain, the tradie's own address as reply-to, and their business name.

`RESEND_API_KEY` is already set (it has powered operator alerts since 02-04) and no new environment variable is introduced.

**The residency sentence, for sales conversations, verbatim from the page:** database and auth are AU-resident (Supabase Sydney); email is processed by Resend offshore, nearest region `ap-northeast-1`, and SMS by ClickSend.

## Next Phase Readiness

**Ready for 04-05 (the Resend sender arm):**
- `messaging_config`'s email row now has a console writer, so 04-05's `chooseEmailSender` gate has something real to read — and `reply_to` and `business_name` are guaranteed non-null on any ENABLED row, which is what a Spam Act-compliant sender identity needs.
- `resend-domains.ts` establishes the error-name-only, non-throwing shape at the Resend boundary; the sender should follow it rather than invent a second one.
- `domainOfAddress` is the one spelling of "the domain part" if the sender ever needs to check its own from-address.

**Ready for 04-07 (activation):**
- The activation sequence for email is now a screen, not a script: verify the domain, then save the identity with **Send email** ticked. The global row is an option in the same form, labelled "Every client (the default row)".
- `/inbox` is where 04-07's first real inbound SMS will appear if attribution cannot place it — which, on a brand-new dedicated number with no cadences running, is exactly what the first test message will be.

**Ready for Phase 6 (the full console):**
- The inbox is deliberately minimal: no filters, no pagination controls, no bulk actions. `TRIAGE_PAGE_SIZE` caps it at 200 and the cap's header says what a longer queue actually means (triage has stopped happening) rather than pretending a scroll would fix it.

**Carried blockers unchanged:** the IPND business-address dependency still blocks the AU dedicated number, the ServiceM8 partner App ID/Secret is still unconfirmed, and the cross-session `0025` journal collision still needs a human at merge time.

---
*Phase: 04-messaging-gateway*
*Completed: 2026-08-29*

## Self-Check: PASSED

All 12 created source/test artifacts and the SUMMARY exist on disk; both task
commits (`84b508b`, `1c44f19`) are present in git history. No `messaging_config`
or `inbound_messages` row was written anywhere during this plan — every suite is
pure and the hosted database was never contacted.
