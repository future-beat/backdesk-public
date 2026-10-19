---
phase: 15-lead-console-reporting-privacy
reviewed: 2026-10-15T07:46:34Z
depth: standard
files_reviewed: 94
files_reviewed_list:
  - .github/workflows/ci.yml
  - package.json
  - scripts/lead-privacy-invariants.mjs
  - src/app/(console)/clients/[id]/missed-calls-cursor.ts
  - src/app/(console)/clients/[id]/missed-calls-list.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/components/draft-card.tsx
  - src/app/(console)/components/lead-job-sheet.ts
  - src/app/(console)/components/text-back-outcome.ts
  - src/app/(console)/inbox/action-state.ts
  - src/app/(console)/inbox/create-job-actions.ts
  - src/app/(console)/inbox/page.tsx
  - src/app/(console)/layout.tsx
  - src/app/(console)/leads/action-state.ts
  - src/app/(console)/leads/actions.ts
  - src/app/(console)/leads/lead-card.tsx
  - src/app/(console)/leads/page.tsx
  - src/app/(console)/queue/queue-card.tsx
  - src/app/(console)/reports/[client]/[reportId]/page.tsx
  - src/app/(console)/reports/[client]/page.tsx
  - src/app/(console)/reports/export-actions.ts
  - src/app/(console)/reports/export-csv-form.tsx
  - src/app/(console)/reports/export-state.ts
  - src/app/(console)/reports/page.tsx
  - src/app/(marketing)/copy.ts
  - src/app/api/internal/messaging-reconcile/route.ts
  - src/app/robots.ts
  - src/core/aging/stalled-digest.ts
  - src/core/leads/constants.ts
  - src/core/leads/create-job.ts
  - src/core/leads/gate.ts
  - src/core/leads/pseudonym.ts
  - src/core/leads/pseudonymise.ts
  - src/core/leads/queue-deadline.ts
  - src/core/leads/text-back.ts
  - src/core/reporting/copy.ts
  - src/core/reporting/document.ts
  - src/core/reporting/generate.ts
  - src/core/reporting/metrics.ts
  - src/core/reporting/missed-call-figures.ts
  - src/core/reporting/partner-csv.ts
  - src/core/shared/env.ts
  - src/db/migrations/0042_phase15_privacy_console.sql
  - src/db/migrations/meta/0042_snapshot.json
  - src/db/migrations/meta/_journal.json
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/repository/leads.ts
  - src/db/repository/reports.ts
  - src/db/schema/inbound-messages.ts
  - src/db/schema/leads.ts
  - src/db/schema/missed-calls.ts
  - tests/audit-request-console.test.ts
  - tests/create-job-action.test.ts
  - tests/export-csv-action.test.ts
  - tests/fixtures/monthly-report-v1.json
  - tests/helpers/env.ts
  - tests/helpers/seed.ts
  - tests/lead-close-action.test.ts
  - tests/lead-digest-section.test.ts
  - tests/lead-job-create-db.test.ts
  - tests/lead-queue.test.ts
  - tests/leads-page.test.ts
  - tests/lint-ban.test.ts
  - tests/marketing-metadata.test.ts
  - tests/messaging-reconcile-route.test.ts
  - tests/missed-call-cursor.test.ts
  - tests/missed-call-figures.test.ts
  - tests/missed-call-log.test.ts
  - tests/missed-calls-section.test.ts
  - tests/monthly-report.test.ts
  - tests/operator-authorization.test.ts
  - tests/ops-scripts.test.ts
  - tests/opt-out-section.test.ts
  - tests/partner-csv.test.ts
  - tests/pipeline-grouping.test.ts
  - tests/privacy-page.test.ts
  - tests/proxy-host-routing.test.ts
  - tests/pseudonym.test.ts
  - tests/pseudonymise-structure.test.ts
  - tests/pseudonymise.test.ts
  - tests/queue-deadline.test.ts
  - tests/report-frozen-fixture.test.ts
  - tests/report-metrics.test.ts
  - tests/report-missed-calls.test.ts
  - tests/report-unchanged.test.ts
  - tests/reporting-metrics.test.ts
  - tests/reports-missed-calls-page.test.ts
  - tests/rls-coverage.test.ts
  - tests/text-back-gate.test.ts
  - tests/text-back-outcome-labels.test.ts
  - tests/text-back-recent-conversion.test.ts
  - tests/text-back-structure.test.ts
findings:
  critical: 1
  warning: 9
  info: 8
  total: 18
status: issues_found
fix_status:
  fixed: [CR-01, WR-01, WR-02, WR-03, WR-04, WR-05, WR-06, WR-07, WR-08, WR-09, IN-01]
  open: [IN-02, IN-03, IN-04, IN-05, IN-06, IN-07, IN-08]
  fixed_at: 2026-10-15
---

# Phase 15: Code Review Report

**Reviewed:** 2026-10-15T07:46:34Z
**Depth:** standard
**Files Reviewed:** 94
**Status:** issues_found

## Summary

Phase 15 (`e7ee32b..3387492`) was reviewed with the irreversible path first: the nightly pseudonymisation pass, its due-reads and guarded writes, the hash-admitting CHECK in 0042, the gate identity, every render that can meet a hashed row, and every surface that could carry a caller number or the pepper out. Then the figures (denominators, "no samples", lead-born exclusion, byte-identical old reports), the CSV, the privacy copy, the scripts, and the acknowledged test moves.

**What holds.** The pass cannot hash an OPEN lead (due-read admits only `closed`/`expired`/`converted`; every write carries `status <> 'open' AND pseudonymised_at IS NULL`), cannot hash a converted lead whose job is not terminal in the mirror, cannot hash a row inside the boundary (`closed_at <= now - 90 d` inclusive; terminal instant for converted), never names `suppressed_contacts`, and handles a withheld call's NULL correctly (`missed_calls_withheld_has_no_number` still holds). The per-lead transaction hashes the calls first and the lead LAST, with `LeadRefused` rolling the children back if the lead's guard refuses, so no hashed child is left under an unstamped lead; idempotency is at the row (the second run is proven zero). The gate reads are byte-identical and the boundary identity `PSEUDONYMISE_AFTER_DAYS = LEAD_NEGATIVE_COOL_OFF_DAYS` means no gate window (24 h `recent_text`, 24 h `recent_conversion`, 90 d cool-off, 14 d job match) can contain a hashed row; the one-open-per-mobile arbiter, `noteRepeatCall`, `listOpenForJobMatch` and attribution only touch OPEN leads. The HMAC is `createHmac('sha256', pepper)` over the stored E.164 (and over each raw string on its own value), 64 lower-hex, pepper floor 32, pepper passed in and never read by the leaf; the route reads it once and the body is sixteen enumerated numeric/boolean fields. No log line in the pass, the page, the section, the actions or the digest carries a number, hash, id or the pepper. The `/leads` page and the missed-call section run `requireOperator()` before the first read; the cross-tenant read returns ids and instants only; the close goes through `closeLead(…, 'operator')` under the tenant's own guard. The report block is optional and LAST, every rate carries its denominator, S4 prints "no samples", `jobsWon` is a count over `Work Order`/`Completed` of jobs we created as `Quote`, and the pre-Phase-15 fixture parses with `missedCalls` undefined and compares unchanged. Migration 0042 matches the schema files byte for byte. None of the acknowledged test edits weakened an assertion: the nav count stays exact, the pipeline pin now asserts exactly one search-param read, the digest/unchanged mocks were widened, the D-22 privacy assertion flipped to the promise the code now keeps.

**What does not.** One BLOCKER: the inbox's soft-opt-out suppress path writes a hashed lead cadence's `contact_mobile` (the 64-hex) into `suppressed_contacts` and tells the operator the contact is suppressed, while the real number stays textable. Nine WARNINGs cover two retention gaps the published notice does not admit (late/ambiguous replies from a closed lead; converted leads whose job never reaches a terminal status in the mirror), a self-contradicting privacy notice (ClickSend "Australian" in the callers section, "processes content outside Australia" in the general section), the inbox rendering a hash as a sender, an incomplete CSV formula guard, a Blob download revoked before the browser reads it, a page-size literal the pin cements, an invariants probe that will read falsely after the first hash, and the unguarded messaging pass that starves the retention pass on a throw.

Nothing has run live against a customer (12-09), production holds zero leads, so every finding is pre-first-client.

## Fix Status (2026-10-15)

CR-01 and WR-01..WR-09 are fixed, one commit each, plus IN-01 (a one-line fix inside a file already edited for WR-01/WR-02). IN-02..IN-08 stay recorded and open. No migration was needed. DB-backed proofs are CI-only: `tests/pseudonymise.test.ts` gained the CR-01 confirm case, the WR-01 unplaced replies and the WR-02 long-stop seed.

| Finding | Commit |
|---------|--------|
| CR-01 | `cf17866` |
| WR-01 | `c3f9f4a` |
| WR-02 | `29eb43c` |
| WR-03 | `eab0245` |
| WR-04 | `145748b` |
| WR-05 | `1e6ac3f` |
| WR-06 | `f579e2e` |
| WR-07 | `1906fae` |
| WR-08 | `c0bab3b` |
| WR-09 | `2ea7cc1` |
| IN-01 | `2500ae2` |

## Critical Issues

### CR-01: Suppressing a soft opt-out on a hashed lead's row writes the HASH into `suppressed_contacts` and reports success — the caller's real number is not suppressed

**Status:** FIXED in `cf17866` (2026-10-15) — `suppressionEntriesFor` drops a pseudonym mobile; `suppressAndStop` returns `number_retired` (own sentence `KILL_NUMBER_RETIRED_MESSAGE`, an error); the inbox reads the stamp and offers no suppress control on a retired row. Pure pins `tests/retired-number-suppress.test.ts`; CI-only DB case in `tests/pseudonymise.test.ts`.

**File:** `src/core/cadence/controls.ts:288-320` (pre-existing path), `src/db/repository/for-tenant.ts:5569-5580` (this phase hashes `cadences.contact_mobile`), `src/app/(console)/inbox/page.tsx:393-410` (the reachable surface)
**Issue:** `leads.pseudonymise` now overwrites `cadences.contact_mobile` with the pseudonym for every lead cadence of a hashed lead. `suppressAndStop` reads `cadences.getById(cadenceId)`, builds `suppressionEntriesFor(cadence)` from `cadence.contactMobile` with no shape check, and inserts the entry BEFORE deciding whether the cadence is live — by design ("the suppression still landed" even when `already_stopped`, `quotes/[quoteId]/actions.ts:218-221`). The inbox's triage read (`listInboundNeedingTriage`) keeps every lead reply with `triaged_at IS NULL` regardless of lead status or age, and offers the `SuppressContactForm` on any row with `label = 'opt_out'` and a `cadence_id`. So an operator who confirms a soft opt-out on a lead reply that sat untriaged until 90 days after the lead closed (a) inserts `{ channel: 'sms', address: '<64-hex>' }` into `suppressed_contacts` — the table has no address-shape CHECK, so it lands — (b) sees `addressesSuppressed: 1` / the "never contact them again" success copy, and (c) leaves the caller's real E.164 unsuppressed: the next diverted call from that number passes rule 5 and gets a text. A person who asked to be left alone is texted, with a console record saying they were suppressed. Low likelihood (needs an untriaged soft opt-out that outlives the lead by 90 days), but the outcome is a wrong text and a false compliance record, and nothing in the pass, the comparator or the structural tests notices.
**Fix:** Refuse at the one chokepoint, and stop offering the control on a retired row:
```ts
// src/core/cadence/controls.ts — suppressionEntriesFor
import { isPseudonym } from '@/core/leads/pseudonym';
function suppressionEntriesFor(cadence: Cadence): SuppressionProbe[] {
  const entries: SuppressionProbe[] = [];
  // A retired (pseudonymised) mobile is not an address — a hash in the
  // suppression table suppresses nobody and reads as if it did.
  if (cadence.contactMobile && !isPseudonym(cadence.contactMobile)) {
    entries.push({ channel: 'sms', address: cadence.contactMobile });
  }
  …
}
```
and in `suppressAndStop`, return a new `{ kind: 'number_retired' }` when the mobile was a pseudonym and no entry remains, with its own fixed sentence in the inbox and quote-page action-state. Then exclude stamped rows from the inbox's lead arm (or select `pseudonymisedAt` and render `NUMBER_RETIRED_LABEL` with no suppress form — see WR-04). Add a case to `tests/pseudonymise.test.ts`: after the pass, `killContact(armedTenantId, f.cadenceId)` must not insert a hash and must not report a suppression; and a pure pin that `suppressionEntriesFor` drops a 64-hex mobile.

## Warnings

### WR-01: A reply that arrives after a lead's cadence has stopped (`unmatched`/`ambiguous`, `lead_id` NULL) keeps the caller's raw number forever — no due-read reaches it

**Status:** FIXED in `c3f9f4a` (2026-10-15) — Prefer-hashing route taken: `leads.pseudonymise` hashes and stamps unmatched/ambiguous rows with no tenant/lead/quote/cadence whose `normalized_from` is the due lead's raw number, received from its first call up to close + `PSEUDONYMISE_AFTER_DAYS` (or past the boundary); ambiguous only when this tenant is a candidate. New count `inboundRowsNoLead` / body `pseudonymisedInboundRowsNoLead` (16 -> 17 keys). Notice wording unchanged (now true).

**File:** `src/db/repository/leads.ts:538-567`, `src/db/repository/for-tenant.ts:5551-5563`, `src/app/(marketing)/copy.ts:481`
**Issue:** The inbound UPDATE in `leads.pseudonymise` is scoped `lead_id = L`. Attribution threads a reply only to a LIVE cadence (`forAllTenants_cadencesByContactMobile` reads `status IN ('active','paused')`), so the common late reply — "thanks, all sorted" two days after the operator closed the lead, or a reply while two clients' cadences both match — is stored `unmatched`/`ambiguous` with `lead_id NULL` and `cadence_id NULL`. Neither the lead arm nor the lead-less-call arm selects it. Its `from_address` and `normalized_from` hold the caller's E.164 indefinitely, while the notice says "we replace your number in that record (on the call, on the lead and on your messages)". `tests/pseudonymise.test.ts` seeds only threaded rows, so the gap is invisible.
**Fix:** A fourth guarded arm, stamped one row at a time like the lead-less calls:
```ts
// leads.ts — listInboundDueForPseudonymisation(now, limit)
.from(inboundMessages).where(and(
  isNotNull(inboundMessages.tenantId),
  isNull(inboundMessages.leadId), isNull(inboundMessages.quoteId),
  inArray(inboundMessages.attribution, ['unmatched', 'ambiguous']),
  lte(inboundMessages.receivedAt, boundary),
  isNull(inboundMessages.pseudonymisedAt),
))
```
hashing `from_address`/`normalized_from` and stamping; a new count `inboundRowsNoLead` in the result and the body (the 16-key pin moves to 17 by design). Quote replies (`quote_id` set) stay out of scope. Seed an unmatched late reply in the read-back suite and assert it is hashed.

### WR-02: A converted lead whose job never reaches `Completed`/`Unsuccessful` in the mirror keeps the number forever; the notice promises "until the job is finished and for 90 days after that"

**Status:** FIXED in `29eb43c` (2026-10-15) — `PSEUDONYMISE_CONVERTED_MAX_DAYS = 365` (commercial-assumptions §21); third due-read arm `converted AND closed_at <= now - 365 d`; notice: "...and no later than 12 months after you booked". Pinned both sides; CI-only seed (k).

**File:** `src/db/repository/leads.ts:496-514`, `src/app/(marketing)/copy.ts:481`
**Issue:** The converted arm requires `EXISTS (quotes … status IN ('Completed','Unsuccessful') AND terminal_instant <= boundary)`. Nothing fires when the client disconnects ServiceM8 (the mirror stops moving), when the tradie deletes the job (`active = 0` keeps its last status — `Quote`/`Work Order` — forever), when the job is abandoned as a `Work Order`, or when `sm8_job_uuid` is NULL (`eq(col, NULL)` is never true). Those customers' numbers, cadences, ledger `to_address` and inbound rows are retained with no upper bound, and the notice states a bound. Research recorded A4/A7 but not this.
**Fix:** Add a long-stop to the converted arm so the promise has a ceiling the code keeps:
```ts
const convertedLongStop = and(
  eq(leads.status, 'converted'),
  lte(leads.closedAt, longStopBoundary), // e.g. now − 365 d, a named constant
);
… or(closedWithoutConverting, convertedWithFinishedJob, convertedLongStop)
```
Say it in ¶6 ("…and in any case no longer than a year after the booking"), and add `leads_converted_past_long_stop` to `lead-privacy-invariants.mjs` so the founder sees the backlog.

### WR-03: The privacy notice contradicts itself about ClickSend: "an Australian provider" in the callers section, "process content outside Australia" in the general processors section and the landing footer

**Status:** FIXED in `eab0245` (2026-10-15) — Processors sentence moved by design: Resend + Anthropic offshore, "SMS is sent through ClickSend, an Australian provider."; residency paragraph and landing footer ("Email and AI providers") agree; cross-section ClickSend assertion. Last updated not bumped.

**File:** `src/app/(marketing)/copy.ts:479` vs `:504` and `:370`
**Issue:** ¶4 of `callers` (this phase, commit `ee372c0`) says "the text is sent through ClickSend, an Australian provider. Twilio processes the call details outside Australia." The byte-pinned general sentence at 504 says "Email is sent through Resend, SMS through ClickSend, and message drafting uses Anthropic. These providers process content outside Australia." The landing footer at 370 says "Messaging and AI providers process message content outside Australia." A reader — or the regulator the notice exists for — gets two incompatible statements about where their text is processed. One of them is wrong, and the phase's own test (`privacy-page.test.ts` "names every processor … and where it runs") pins only the new one.
**Fix:** Decide the fact (ClickSend's platform hosting, not its registered office) and make the three sentences agree. If ClickSend is AU-hosted: move the 504 pin by design to "Email is sent through Resend and message drafting uses Anthropic; these process content outside Australia. SMS is sent through ClickSend in Australia." and soften 370 to "Email and AI providers…". If it is not: drop "an Australian provider" from 479 and say "ClickSend processes the text outside Australia". Add one assertion that the word "outside Australia" is not attached to "ClickSend" in one section while "Australian" is in another.

### WR-04: The inbox renders the 64-hex hash as the sender of a retired lead's untriaged reply, and still offers the suppress control (see CR-01)

**Status:** FIXED in `145748b` (2026-10-15) — Inbox renders `NUMBER_RETIRED_LABEL` for a stamped (or pseudonym-sender) row, no lead link, no suppress control (CR-01).

**File:** `src/app/(console)/inbox/page.tsx:336`, `src/db/repository/inbound-messages.ts:270-320`
**Issue:** `listInboundNeedingTriage` has no age or lead-status bound, and `inbox/page.tsx` prints `<strong>{row.fromAddress}</strong>` verbatim. After the pass, an untriaged lead reply shows `a3f9…` (64 chars) where the caller's number was, with no "number retired" word, the "open the lead →" link to a card that no longer exists on `/leads` (closed), and the soft-opt-out suppress form. The missed-call log handles the same row correctly (`CallerLine` checks `pseudonymisedAt` first); the inbox does not know the column exists.
**Fix:** Select `pseudonymisedAt: inboundMessages.pseudonymisedAt` in the triage read; in the row render `row.pseudonymisedAt !== null ? NUMBER_RETIRED_LABEL : row.fromAddress`, hide the `SuppressContactForm` and the `/leads#lead-` link for a stamped row. Pin it in `tests/inbox-authorization.test.ts` or a sibling: the page checks the stamp before it renders `fromAddress`.

### WR-05: The CSV formula-injection guard misses tab, carriage return and leading whitespace

**Status:** FIXED in `1e6ac3f` (2026-10-15) — `FORMULA_LEAD = /^(?:[\t\r]|\s*[=+\-@])/`; pins for tab, CR, spaces, no-break space.

**File:** `src/core/reporting/partner-csv.ts:14-18`
**Issue:** `FORMULA_LEADS = new Set(['=', '+', '-', '@'])` is checked against `name.charAt(0)` only. OWASP's CSV-injection list also includes `\t` and `\r` as cell leaders, and spreadsheet importers trim leading whitespace before evaluating, so `' =HYPERLINK(…)'` and `'\t=…'` both evaluate. The client name is operator-entered today, but the file is built to be opened in Excel on other people's machines.
**Fix:**
```ts
const FORMULA_LEAD = /^[\s ]*[=+\-@\t\r]/;
function safeName(name: string): string {
  return FORMULA_LEAD.test(name) ? `'${name}` : name;
}
```
and extend the pin in `tests/partner-csv.test.ts` with `'\t=1+1'` and `'  =1+1'`.

### WR-06: `URL.revokeObjectURL` runs synchronously after `link.click()` — the download can be cancelled before the browser reads the Blob

**Status:** FIXED in `f579e2e` (2026-10-15) — Revoked on a 10 s `REVOKE_AFTER_MS` timer after the click; effect cleanup clears and revokes. Ordering pinned.

**File:** `src/app/(console)/reports/export-csv-form.tsx:39-46`
**Issue:** The island creates the object URL, clicks the anchor and revokes the URL in the same tick. Chrome tolerates this; Safari (including iOS, the phone UAT target the summary names as the open risk) and Firefox have both cancelled or produced empty downloads when the URL is revoked before the navigation starts. The status line will still say "Exported N rows as …", so the operator is told a file arrived that did not.
**Fix:**
```ts
link.click();
link.remove();
// Revoke after the navigation has started, not before.
const timer = setTimeout(() => URL.revokeObjectURL(url), 10_000);
return () => { clearTimeout(timer); URL.revokeObjectURL(url); };
```
(returning the cleanup from the effect). Keep the iOS UAT item.

### WR-07: The page size is a literal `limit: 20` beside `PAGE_SIZE = 20`, and the structural pin cements the literal

**Status:** FIXED in `1906fae` (2026-10-15) — `limit: PAGE_SIZE`; pin follows the constant.

**File:** `src/app/(console)/clients/[id]/missed-calls-list.tsx:57,228,254`; `tests/missed-calls-section.test.ts:90`
**Issue:** `listForLog({ before, limit: 20 })` and `rows.length === PAGE_SIZE` are the two halves of pagination. Change either number and the "Show older calls" link silently stops appearing (rows never equal `PAGE_SIZE`) or appears on a final short page. The pin `expect(SECTION).toContain('limit: 20')` makes the correct refactor (`limit: PAGE_SIZE`) fail the suite.
**Fix:** `repo.missedCalls.listForLog({ before: cursor ?? undefined, limit: PAGE_SIZE })`; pin `expect(SECTION).toContain('limit: PAGE_SIZE')` and `expect(SECTION).toMatch(/const PAGE_SIZE = 20;/)`.

### WR-08: The invariants script's "past boundary" counts never exclude stamped rows, so after the first live hash they read as a permanent backlog

**Status:** FIXED in `c0bab3b` (2026-10-15) — Both past-boundary counts carry `pseudonymised_at IS NULL` (the backlog); one SELECT, six lines; ops-scripts pin.

**File:** `scripts/lead-privacy-invariants.mjs:81-94`
**Issue:** `leads_closed_past_boundary` and `missed_calls_no_lead_past_boundary` count every row past 90 days with no `pseudonymised_at IS NULL` clause. The 15-08 probe interpreted `0 past boundary` as "nothing due". From the first January-2027 tick onward (the founder's own verification calls), both counts become non-zero and stay non-zero forever, and the probe can no longer distinguish "the pass is working" from "the pass is stuck". The header says the script is pre-0042; 0042 is applied in production (15-08) and the script already probes for the column.
**Fix:** Keep the existing totals and add the two that matter: `… AND pseudonymised_at IS NULL` as `*_due`, and `count(*) FILTER (WHERE pseudonymised_at IS NOT NULL)` as `*_stamped`; print all four. Guard the new columns behind the `schema_0042_applied` probe only if the script must keep running on a pre-0042 database.

### WR-09: `reconcileMessaging()` is the only unguarded pass on the tick — a throw there 500s the route and the retention pass does not run that night

**Status:** FIXED in `2ea7cc1` (2026-10-15) — `reconcileMessaging().catch(...)` with a fixed log line, `MESSAGING_FAILED` and body `messagingFailed` (17 -> 18 keys); pure route tests.

**File:** `src/app/api/internal/messaging-reconcile/route.ts:120`
**Issue:** The telephony pass and the new privacy pass both carry a `.catch` belt; the messaging pass, first in line, does not. A regression or a provider outage that escapes `reconcileMessaging` throws out of `POST`, `cron.job_run_details` records a 500, and the pass this phase describes as must-happen work ("a 200 for a retention pass that did not run is how a promise on the public notice quietly stops being true") silently does not run. Pre-existing shape, but this phase hung an irreversible-by-promise job behind it.
**Fix:** `const result = await reconcileMessaging().catch(() => MESSAGING_FAILED)` with a `MESSAGING_FAILED` constant whose `skipped: true` plus a new `messagingFailed: true` field is enumerated in the body (17 keys by design), or run the privacy pass in a `try/finally` so it executes even when messaging throws.

## Info

### IN-01: A short pepper fails the pass in the lead loop but is counted as one `failed` per row in the call loop

**Status:** FIXED in `2500ae2` (2026-10-15) — Pepper floor checked once at the top of `sweep` (one-line fix in an already-edited file).

**File:** `src/core/leads/pseudonymise.ts:100,143`
**Issue:** `pseudonymiseCaller(lead.contactMobile, pepper)` is deliberately outside the per-lead `try` so a pepper under the floor becomes `passFailed`; `hashCallerStrings(call, pepper)` in the lead-less loop is inside its `try`, so the same configuration bug is logged as "call write failed" up to 200 times and reported as `failed: 200, passFailed: false`. Unreachable in production (`serverEnvSchema` enforces the floor) but the two loops disagree.
**Fix:** Validate once at the top of `sweep`: `if (pepper.length < PEPPER_MIN_CHARS) throw new Error('pseudonym: pepper too short')` (or an exported `assertPepper`), and leave both loops' hashing inside their `try`.

### IN-02: The lead card's "expires" date is `first_missed_at + 7 d`, which is not the engine's expiry rule

**File:** `src/app/(console)/leads/page.tsx:254-261`
**Issue:** Expiry is the cadence policy's `expiryDays` from the cadence `anchor_at` (`policy.ts:65`), and a lead with no next touch is one whose cadence has ended — the sweep closes it as `touches_exhausted`/`expired` on the next tick. The label asserts a date from a formula no code path uses.
**Fix:** Either read `anchor_at` on the queue row and compute from `LEAD_POLICY`, or replace the sentence with "No follow-ups left · closes on the next sweep".

### IN-03: Duplicated constants and patterns across the new surfaces

**File:** `src/app/(console)/reports/[client]/page.tsx:177` and `reports/[client]/[reportId]/page.tsx:493` (`WEEKDAY_LABELS` twice); `src/app/(console)/leads/actions.ts:63` (`UUID_PATTERN`, a fourth copy); `src/app/(console)/leads/page.tsx:94` and `components/lead-job-sheet.ts:110` (`'Australia/Perth'` fallback — 14-REVIEW IN-09 carried); `src/app/(console)/leads/action-state.ts:9` (`LEAD_TOUCH_COUNT = 3` restating `LEAD_TOUCH_OFFSET_DAYS.length` — 13-REVIEW IN-06 carried, moved not removed)
**Issue:** Each pair is verbatim until one copy is edited.
**Fix:** `WEEKDAY_LABELS` into `core/reporting/copy.ts`; `UUID_PATTERN` from one shared leaf; the zone fallback from the schema default; `LEAD_TOUCH_COUNT = LEAD_TOUCH_OFFSET_DAYS.length` (constants.ts is import-free and client-safe).

### IN-04: The CSV collapses every tenant the operator's JWT cannot name into one `Another client` row set

**File:** `src/app/(console)/reports/export-actions.ts:82`
**Issue:** Two unresolvable tenants produce rows that differ only by month and are indistinguishable in the deck; the export test asserts "not a file of Another client" only for the names-read error path.
**Fix:** Skip rows whose tenant is not in `names` (and say "N clients omitted" in the status), or suffix with the tenant id's first eight characters.

### IN-05: Dead-letter `raw_payload` on `missed_calls` and `inbound_messages` keeps whatever number arrived, with no retention arm (research A4, recorded)

**File:** `src/db/schema/missed-calls.ts:241`, `src/db/schema/inbound-messages.ts:305`, `src/db/repository/leads.ts:538`
**Issue:** Dead letters are explicitly out of D-06's scope, but their payloads hold `From`/`Caller` for a call to a number no tenant owns — exactly the person the notice is least able to name.
**Fix:** One statement per table on the same tick: `UPDATE … SET raw_payload = NULL WHERE tenant_id IS NULL AND created_at <= boundary AND raw_payload IS NOT NULL`.

### IN-06: The keyset cursor carries milliseconds while `started_at` holds microseconds (executor-recorded in 15-05)

**File:** `src/app/(console)/clients/[id]/missed-calls-cursor.ts:36`, `src/db/repository/for-tenant.ts:5040-5047`
**Issue:** A row in the same millisecond as the cursor row but with a smaller microsecond part is neither `< before` nor `= before`, so it is skipped across the page boundary. Negligible at one tenant's call volume; recorded so it is not rediscovered.
**Fix:** Compare on `date_trunc('milliseconds', started_at)` in the keyset, or carry `to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')` in the cursor.

### IN-07: `CloseOutcome` has a `not_found` arm no caller can produce

**File:** `src/app/(console)/leads/action-state.ts:64,72`, `src/app/(console)/leads/actions.ts:125`
**Issue:** `closeLead` returns `closed | already_closed` only; the action maps everything else to `already_closed`. The `not_found` branch of `closeControlState` is dead.
**Fix:** Drop the arm, or have the action distinguish a foreign lead id (it deliberately does not — the header explains why), in which case delete the arm and the sentence.

### IN-08: The read-back suite runs an unscoped, irreversible pass over every tenant in the database it is pointed at

**File:** `tests/pseudonymise.test.ts:372-375`
**Issue:** `runPseudonymisationPass` hashes every due row of every tenant, which is why the suite tallies "foreign" rows. Correct on CI's throwaway Postgres; against the hosted project (`test:remote` is forbidden, and `globalSetup` pauses the ticks, but nothing refuses) it would hash production rows a night early. Every other DB suite's writes are tenant-scoped and torn down.
**Fix:** Assert at the top of `beforeAll` that `DATABASE_URL`/`MIGRATE_DATABASE_URL` does not point at the hosted project (host check, never echoing the URL), or give the pass an optional `tenantIds` scope that only tests pass.

---

_Reviewed: 2026-10-15T07:46:34Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
