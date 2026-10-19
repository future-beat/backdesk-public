---
phase: 12-instant-text-back-arming
reviewed: 2026-10-07T10:26:16Z
depth: standard
files_reviewed: 73
files_reviewed_list:
  - package.json
  - scripts/db-status.mjs
  - scripts/missed-calls-invariants.mjs
  - scripts/text-back-timing.mjs
  - src/app/(console)/clients/[id]/action-state.ts
  - src/app/(console)/clients/[id]/actions.ts
  - src/app/(console)/clients/[id]/checklist-card.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
  - src/app/(console)/clients/[id]/text-back/action-state.ts
  - src/app/(console)/clients/[id]/text-back/actions.ts
  - src/app/(console)/clients/[id]/text-back/forms.tsx
  - src/app/(console)/clients/[id]/text-back/page.tsx
  - src/app/(console)/queue/page.tsx
  - src/app/(marketing)/copy.ts
  - src/app/api/internal/cadence-tick/route.ts
  - src/app/api/webhooks/twilio/voice-status/route.ts
  - src/core/alerts/text-back-alerts.ts
  - src/core/attribution/qualify.ts
  - src/core/audit/constants.ts
  - src/core/cadence/dispatch.ts
  - src/core/cadence/run-tick.ts
  - src/core/cadence/sender.ts
  - src/core/escalation/escalate-hot-leads.ts
  - src/core/escalation/message.ts
  - src/core/escalation/quote-call.ts
  - src/core/leads/balance.ts
  - src/core/leads/constants.ts
  - src/core/leads/gate.ts
  - src/core/leads/never-text.ts
  - src/core/leads/sweep.ts
  - src/core/leads/template-admin.ts
  - src/core/leads/template.ts
  - src/core/leads/text-back.ts
  - src/core/messaging/clicksend-client.ts
  - src/core/messaging/inbound.ts
  - src/core/onboarding/arming.ts
  - src/core/onboarding/checklist.ts
  - src/core/onboarding/privacy-coverage.ts
  - src/core/telephony/missed-call.ts
  - src/core/telephony/parse-voice-webhook.ts
  - src/db/migrations/0039_phase12_text_back.sql
  - src/db/repository/escalations.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/repository/messaging-config.ts
  - src/db/repository/missed-calls.ts
  - src/db/repository/operator-alerts.ts
  - src/db/schema/cadences.ts
  - src/db/schema/escalations.ts
  - src/db/schema/inbound-messages.ts
  - src/db/schema/index.ts
  - src/db/schema/leads.ts
  - src/db/schema/messaging-config-audit.ts
  - src/db/schema/messaging-config.ts
  - src/db/schema/missed-calls.ts
  - src/db/schema/operator-alert-log.ts
  - src/db/schema/send-ledger.ts
  - src/db/schema/tenant-never-text.ts
  - src/db/schema/tenant-proofs.ts
  - src/db/schema/text-back-templates.ts
  - tests/attribution-qualify.test.ts
  - tests/lead-cadence-inert.test.ts
  - tests/lead-reply.test.ts
  - tests/text-back-arming-gate.test.ts
  - tests/text-back-balance.test.ts
  - tests/text-back-gate.test.ts
  - tests/text-back-quote.test.ts
  - tests/text-back-sweep.test.ts
  - tests/text-back-template.test.ts
  - tests/text-back-tick-passes.test.ts
  - tests/text-back.test.ts
findings:
  critical: 1
  warning: 5
  info: 9
  total: 15
status: issues_found
fixed: [CR-01, WR-01, WR-02, WR-03, WR-04, WR-05]
fixed_at: 2026-10-07
---

# Phase 12: Code Review Report

**Reviewed:** 2026-10-07T10:26:16Z
**Depth:** standard
**Files Reviewed:** 73 (62 source/script/config files changed since `64bcd0f`, the generated 0039 snapshot and journal excluded; 11 test suites read for coverage of the money/safety paths)
**Status:** issues_found — CR-01 and WR-01..WR-05 fixed 2026-10-07 (commits below); IN-01..IN-09 open, recorded only

## Summary

The review weighted the send path first, because no text-back has ever left production (12-09 was skipped) and the first live send will be to a real client's caller. The path that texts a member of the public holds up well against the focus questions:

- **Wrong recipient.** The number texted is read from the row the Twilio-signed arrival door wrote, by the id the completion UPDATE returned (`getMissedCallForTextBack`, `text-back.ts:196`); nothing from the status callback crosses. The own-number rule is null-guarded (`gate.ts:101-107`), compares the never-text list, the escalation phone in both normalisations, the divert number, the shared SMS from-number and the normalised `ForwardedFrom`; withheld/absent/landline callers are refused in D-06 order before any claim.
- **Twice to one caller / beyond the cap.** The missed-call claim is a guarded UPDATE on `text_back_status IS NULL` inside the one transaction; on the lead route `leads_one_open_per_mobile` and `cadences_one_live_per_lead`, on the quote route `send_ledger_cadence_touch_uniq` on `(cadence, 0)`, are DB arbiters for the sweep/callback race (`text-back.test.ts:349`, `text-back-sweep.test.ts:334`). Only the daily cap is a non-locked count (IN-03).
- **Unarmed / global row / stub.** `isTextBackArmed` is an exact-target read and `messaging_config_text_back_per_tenant` refuses a global row at the schema; the arm action refuses `target === 'everyone'` before any read; `sms_not_armed` refuses a stub or unresolved identity before the ledger claim, and a stub that "sends" is recorded `failed` (`text-back.ts:285-294`).
- **STOP and identity.** Validated at save, at attest, and again at send against the tenant's current name; the stored bytes are the validator's normalised output and are compared byte-for-byte at send (`text-back.ts:392-396`). The drafting path's `complianceSuffix` is applied in `draftTouches`, not the sender, so the attested body goes out unaltered.
- **CHECK consistency.** `skipped` is always written with a reason (gate skips, `markStaleTextBacks`, the `quote_open` variant); `claimed`/`sent`/`failed` never carry one; `coalesce` closes the NULL case; dead letters can never carry a status. The system audit row satisfies `actor_identity` and `system_disarms`.
- **Logs, scripts, emails.** Every log line in the new core is a fixed string or a closed-union value; the timing script, the proof detail and the alert bodies reduce numbers to booleans and counts. One exception is noted (IN-07).
- **Touch 0 / lead null-safety.** Attribution excludes touch 0 (`qualify.ts:113`, pinned); re-window and resume read unsent touches only and touch 0 is written `sent`; the 42-day expiry, progress, promote, draft and claim passes carry `kind = 'quote'`; the inbox, queue and hot-lead escalation guard a null `quoteId`.

What the review found is that the **safety net around the send** is weaker than the send itself: the ClickSend balance fail-safe fails open in exactly the state production was in on 6 Oct (a negative balance), the sweep's D-20 window drifts with the tick's own duration, and an armed client whose attested wording silently stops validating is never alerted. These are the Critical and the first two Warnings. The remaining findings are smaller consistency and dead-code items.

Deliberate deviations recorded in the plan summaries (listLive defaulting to quote, ForwardedFrom as evidence only, the quote_open skip carrying a route, the `unchanged` resave refusal, IN-02 left untouched, lead touches 2-3 inert, no FK on tenant-scoped tables per the 0038 convention) were not flagged. One tested decision is flagged anyway (CR-01), because the pin encodes behaviour that contradicts D-07/D-10 and the summaries do not record it as a deviation.

## Critical Issues

### CR-01: A negative ClickSend balance is treated as "unreadable", so the A$5 auto-disarm never fires in overdraft

**Status:** FIXED in `5d99913` — `centsFromDecimal` reads a signed decimal (rounded towards minus infinity, `-0` folded to 0); `-20.87` is −2087 cents and `runBalanceProbe` disarms every armed client and sends the auto-disarm email (strict `<` floors unchanged). `formatAud` renders `-A$20.87`. The "negative → unparseable" pin is replaced by `ok: true, balanceCents: -300`; a −2087 probe case asserts both disarms with `AUTO_DISARM_REASON` and the email. Genuinely unparsable responses still report `unparseable`.


**File:** `src/core/messaging/clicksend-client.ts:669,687`; `src/core/leads/balance.ts:185-202`; pinned by `tests/text-back-balance.test.ts:288`
**Issue:** `centsFromDecimal` returns `null` for any negative figure — `DECIMAL = /^\d+(?:\.\d+)?$/` rejects a leading `-` for strings and `raw < 0` rejects numbers. `getAccountBalance` then reports `unparseable`, and `runBalanceProbe` takes the `!read.ok` arm: `probeFailed = 1`, one "balance could not be read — nobody was switched off" email per Perth day, **no disarm**. The 12-09 summary records the production balance at **−A$20.87 on 6 Oct**: ClickSend reports negative balances, and every text-back attempted in that state fails `INSUFFICIENT_CREDIT` (a caller who rang a tradie and heard nothing back, D-10's exact scenario). D-07 says "auto-disarm below A$5"; −A$20.87 is below A$5. The test at line 288 pins the wrong behaviour as the expected one, and the balance.ts header lists "a negative figure" beside "unparseable" as if it were a read failure rather than the most readable low balance there is. In the current state, the only thing that would disarm an armed client during an overdraft is the operator reading the "unreadable" email and guessing why.
**Fix:**
```ts
// clicksend-client.ts
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export function centsFromDecimal(raw: unknown): number | null {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim();
  } else {
    return null;
  }
  if (!DECIMAL.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const magnitude = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(magnitude)) return null;
  return negative ? -magnitude : magnitude;
}
```
`decideBalanceActions` already uses strict `<`, so −2087 disarms and alerts without change. Make `formatAud` sign-aware (`A$-20.87`) for the auto-disarm email, replace the `'a negative balance' … 'unparseable'` pin with `ok: true, balanceCents: -300`, and add a `runBalanceProbe` case at −2087 cents asserting every armed client is disarmed with the system audit row.

## Warnings

### WR-01: The sweep judges the D-20 window with the tick's start clock, after the drafting and dispatch passes have run

**Status:** FIXED in `6d67634` — the sweep keeps its place in the pass order but reads its own clock at the sweep (`options.now ?? new Date()`), so the 45 s – 10 min window, the stale mark and the gate's `stale` rule are judged when the sweep runs. An injected `now` is still the sweep clock, so the pinned suites keep their window. `tests/cadence-tick-isolation.test.ts` pins both (fails without the fix).


**File:** `src/core/cadence/run-tick.ts:1300-1319`; `src/core/leads/sweep.ts:136-144,170`; `src/core/leads/text-back.ts:408,125`
**Issue:** `runTextBackSweepPass(now, …)` runs fifth in the tick, after `consumeQuoteEvents`, the attribution pass, `runProgressPass` (which drafts with Claude for every tenant) and `dispatchDueTouches`. `now` is the clock the tick started with. Every bound derived from it moves with the tick's elapsed time: `listPendingTextBacks` is asked for `[now − 10 min, now − 45 s]` and `markStaleTextBacks(now − 10 min)`, and the gate's `stale` rule (`now − referenceAt > 10 min`) and the 24-hour windows reuse the same `now` via `deps.now`. A tick that spends three minutes drafting will text a call that is really 12 minutes 59 seconds old and judge it 9 minutes 59 seconds old — D-20's ceiling ("older unsent calls are marked stale and never texted") is only approximately enforced, and the text-back that the sweep exists to guarantee "within the minute" waits behind the drafting pass. The DB suite pins the window on an injected clock, so it cannot see this.
**Fix:** Run the sweep first in `runCadenceTick` (it is the only time-critical pass and touches no cadence the later passes read), and keep `now` as the shared clock:
```ts
// run-tick.ts, before consumeQuoteEvents
const textBackSweep = await runTextBackSweepPass(now, textBackSender);
```
Alternatively, have the sweep take its own clock (`sweepNow = options.clock?.() ?? new Date()`) and pass it to `sendTextBack`, keeping the tick's injected `now` for the pinned suites via the seam.

### WR-02: An armed client whose text-back stops for a configuration reason is never told

**Status:** FIXED in `7ee4004` — `claimTextBackAlerts` gains an optional configuration arm (a second UPDATE in the same transaction, so the three original arms keep their partial index and no migration is needed): `skipped` + `no_template`/`sms_not_armed`, client armed for `text_back` now, call started inside `TEXT_BACK_CONFIG_ALERT_LOOKBACK_HOURS` (24). Each row is stamped once; rows for a client already alerted earlier the same Perth day come back `repeatToday` and are stamped but not re-emailed (one configuration email per client per Perth day — per-tenant latching in `operator_alert_log` would have needed a migration, its key is `(kind, day)`). `buildTextBackFailureAlert` has a fourth section with a remedy per reason; counts ride the existing `textBackAlerted`/`textBackAlertFailed` fields (tick key set unchanged). `readGoLiveChecklist` re-validates each attested body against the current tenant name with the send path's exact test, so `textBackTemplates` turns unmet with `no longer validates: …` after a rename. DB pins added to `text-back-repository` and `go-live-checklist` (CI only).


**File:** `src/core/leads/sweep.ts:156`; `src/db/repository/missed-calls.ts:511-535`; `src/core/onboarding/checklist.ts:601`; `src/db/repository/for-tenant.ts:4301`
**Issue:** D-10 says any failed text-back surfaces to the operator within the tick, never silent. The alert claim covers `failed`, stuck `claimed` and `sent`/`pause_failed` only. Two skips are failures of the armed client's configuration rather than of the caller: `no_template` (the attested body no longer validates — the business was renamed on the tenant row, which `template-admin.ts:27-33` describes as "a silent dead switch" at attest time but which can equally happen after attestation) and `sms_not_armed` (SMS disarmed, or the shared row flipped, after text-back was armed). Both are recorded as ordinary skips, counted only into `textBackSkipped` in the tick JSON, and never emailed. The checklist still shows "Text-back templates attested" green, because `attestedSetStatus` asks only whether an attested version exists, not whether it validates against the current name. The operator's first signal is a client asking why callers stopped getting texts.
**Fix:** Add a third arm to `claimTextBackAlerts` (and the partial index predicate) for `text_back_status = 'skipped' AND text_back_skip_reason IN ('no_template', 'sms_not_armed') AND tenant_id IN (SELECT tenant_id FROM messaging_config WHERE channel = 'text_back' AND enabled)`, group them under their own sentence in `buildTextBackFailureAlert` ("N callers were not texted because the attested wording no longer validates — open the Text-back page"). In `readGoLiveChecklist`, re-validate each attested body with `validateTextBackTemplate(body, { businessName: tenant.name, variant })` and mark `textBackTemplates` unmet with detail `no longer validates: <variant>` when it fails, so the card shows the dead switch.

### WR-03: The monthly report's "sent" count now includes lead-route text-backs

**Status:** FIXED in `4c10b57` — `isNotNull(sendLedger.quoteId)` added to `sentInWindow` in `forAllTenants_reportMetrics` and in its twin `forTenant().metrics.windowCounts` (the field-for-field equality test requires both). It applies to the touched, replied and opted-out reads, so numerators stay subsets of denominators; touch 0 on a quote cadence carries a `quote_id` and stays counted. `report-metrics` fixture gains a lead text-back row plus its STOP (CI only).


**File:** `src/db/repository/for-all-tenants.ts:1440-1446`
**Issue:** `sentInWindow` is `sender <> 'stub' AND outcome = 'sent' AND delivery_status IS DISTINCT FROM 'undelivered' AND claimed_at IN window`. Before Phase 12 every ledger row was a quote touch. A text-back's ledger row (`quote_id` NULL, `lead_id` set, touch 1) now satisfies the same predicate, so `forAllTenants_reportMetrics` reports a missed-call text as a quote follow-up sent. The client's monthly report is the invoice's proof of value; counting a text-back the client did not ask the quote engine to send inflates that figure. (Touch 0 on a quote cadence counting as "sent" is deliberate per 12-05's note in `qualify.ts:96-97` and is not flagged.)
**Fix:**
```ts
const sentInWindow = and(
  isNotNull(sendLedger.quoteId), // quote follow-ups only; lead text-backs report separately (Phase 15)
  ne(sendLedger.sender, 'stub'),
  …
);
```
Extend the `sync-upsert`/report pins accordingly, or if the metric is meant to include text-backs, rename the figure in the report copy so the client is not told it is quote follow-ups.

### WR-04: A lost ledger claim on the lead route commits a `claimed` missed call with no ledger row

**Status:** FIXED in `9cefcaf` — the zero-row lead-route `insertClaim` now throws inside the transaction, rolling the claim back (`pre_claim_failed`, retried by the sweep). New pure suite `tests/text-back-lead-claim-fault.test.ts` (fails without the fix).


**File:** `src/core/leads/text-back.ts:484-493`
**Issue:** `decideInTransaction` throws (rolling the claim back so the sweep retries) on every "cannot happen" state — missing tenant, gate passed without facts, touch 1 missing, draft not written — except one: `tx.ledger.insertClaim` returning no row on the lead branch `return { kind: 'done', result: 'claim_lost' }`. That return **commits** the transaction with the missed call `claimed` (no `text_back_ledger_id`, no decision patch), a new lead, a new live lead cadence and an approved draft, while nothing was sent. The row then surfaces two minutes later as "outcome unknown — may already have reached the caller", which is false, and `cadences_one_live_per_lead` means the caller can never be texted for this lead again. The branch cannot fire today (the cadence is new, so `(cadence, 1)` cannot already exist), which is exactly why it should be the throwing kind: the quote route's zero-row case is a real skip; this one is a fault.
**Fix:**
```ts
if (!ledger) throw new Error('lead ledger claim returned no row');
```

### WR-05: `listUnescalatedQuoteCalls` has no age bound, so a backlog escalates stale calls to the tradie

**Status:** FIXED in `6f57baf` — `listUnescalatedQuoteCalls(limit, { notBefore, stuckBefore })` (required window): reference instant at or after `now − QUOTE_CALL_ESCALATION_MAX_AGE_HOURS` (24, in `src/core/leads/constants.ts`), and a `claimed` row decided after `now − TEXT_BACK_STUCK_MINUTES` waits a tick (the constant moved to `constants.ts`, re-exported from `sweep.ts`). Rows past the bound simply stop being selected; no `stale` escalation outcome is recorded (that would need a CHECK change, i.e. a migration). The DB cooldown case that escalated two calls a day apart in one pass was rewritten to a hot-reply escalation inside the cooldown, and a too-old case added (CI only).


**File:** `src/db/repository/escalations.ts:215-240`; `src/core/escalation/quote-call.ts:140-203`
**Issue:** The quote-call pass selects every `text_back_route = 'quote'` row without an escalation, oldest first, with no reference-instant floor. After an escalation-sender outage, a period with no `CLICKSEND_*` credentials, or a tick backlog, the tradie receives "X rang about "…" and was missed" for calls hours or days old, and the SMS carries no time. The pass also reads rows still `claimed` (the callback's send in flight), so a tradie can be told "Our text back to them is not confirmed" a second before it is. The reply-escalation pass has the inbound row's own staleness to lean on; this one has nothing.
**Fix:** Add `referenceInstant(gte, now − 24h)` (or reuse `TEXT_BACK_MAX_AGE_MINUTES`-style constant for "too old to escalate") to the WHERE, and exclude `text_back_status = 'claimed' AND text_back_decided_at > now − TEXT_BACK_STUCK_MINUTES` so a row mid-send waits one tick. Record a `stale`-style outcome on rows older than the bound so they stop being selected.

## Info

### IN-01: `TextBackFacts.openQuoteCadence` is computed and passed but never read

**File:** `src/core/leads/gate.ts:78-79`; `src/core/leads/text-back.ts:411`
**Issue:** The gate test pins that an open quote cadence "is NOT a gate rule" — the field exists only to be ignored. Dead input to a pure function invites a later rule that reads it in the wrong place.
**Fix:** Remove the field from `TextBackFacts` and the call site; the route decision stays in `decideInTransaction`.

### IN-02: Arming and SMS identity are read before the claim transaction

**File:** `src/core/leads/text-back.ts:204-222,228`
**Issue:** `isTextBackArmed`, the sender build and `resolveSmsFrom` run on `getDb()` before the transaction and are passed in as facts. A disarm that commits between the pre-read and the claim still sends (window ≤ 6 s per the deadline). D-09's "takes effect on the next call" holds in practice; the gap is noted because the whole design otherwise puts every fact inside the claim.
**Fix:** Re-read the tenant's `text_back` row on `tx` inside `decideInTransaction` (an exact-target select of one row) and refuse `not_armed` if it has flipped.

### IN-03: The daily cap is a non-locked count

**File:** `src/db/repository/for-tenant.ts:4106-4119`; `src/core/leads/gate.ts:122`
**Issue:** `countTextBacksSince` runs under READ COMMITTED; two callbacks for different callers in the same second each count 29 and both send (31). The per-caller rule is DB-enforced by `leads_one_open_per_mobile` and the ledger's `(cadence, 0)` key, so only the cap can overshoot, by the concurrency of a single second.
**Fix:** Acceptable at this volume; if it must be exact, `SELECT … FOR UPDATE` the tenant row (or `pg_advisory_xact_lock(hashtext(tenant_id))`) at the top of `decideInTransaction`.

### IN-04: Two CHECK constraints on different tables share the name `messaging_config_text_back_per_tenant`

**File:** `src/db/migrations/0039_phase12_text_back.sql:204,207`; `src/db/schema/messaging-config-audit.ts:394-397`
**Issue:** Postgres allows the collision (constraint names are per table) but `scripts/db-status.mjs` and anyone reading `pg_constraint` by `conname` now gets two rows for one name, and an error message naming the constraint does not say which table refused.
**Fix:** Name the audit one `messaging_config_audit_text_back_per_tenant` in a follow-up migration (`ALTER TABLE … RENAME CONSTRAINT`) and in the schema.

### IN-05: `text_back_templates` carries a tenant FK while every other Phase 11/12 tenant-scoped table deliberately does not

**File:** `src/db/migrations/0039_phase12_text_back.sql:190` vs `0038_phase11_telephony_capture.sql:23`; `src/db/schema/text-back-templates.ts:953-955`
**Issue:** 0038 records "NO FOREIGN KEY on either `tenant_id`" as a convention; `leads`, `tenant_never_text_numbers` and `missed_calls` follow it, `text_back_templates` (`ON DELETE cascade`) does not. A tenant delete would cascade attested wording out of the evidence trail while the ledger rows that sent it survive.
**Fix:** Pick one convention; if the FK stays, drop the cascade (`ON DELETE restrict`) so attested bytes are never removed implicitly.

### IN-06: `LINK_PATTERN` refuses sentence punctuation without a following space as a link

**File:** `src/core/leads/template.ts:111,154`
**Issue:** `[a-z0-9-]+\.[a-z]{2,}` matches `call.Reply` (a missed space after a full stop) and `Smith.Co`, so the operator is told "Remove the link" when there is none.
**Fix:** Require the host-like match to be followed by `/`, `:`, whitespace or end, and not preceded by a letter that is itself sentence text: `/https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|au|io|co)\b/i`, or tolerate the false positive but word the refusal as "looks like a link".

### IN-07: The timing script prints the driver's error message

**File:** `scripts/text-back-timing.mjs:228`
**Issue:** The core modules discard every caught value because a postgres.js error can carry statement parameters; the script prints `error.message`. Its parameters are a tenant uuid and a limit, so nothing sensitive today, but the sibling rule ("fixed strings only") is the one that keeps it that way when the query grows.
**Fix:** `console.error('text-back timing read failed; nothing printed.')` and exit 1.

### IN-08: A second auto-disarm on the same Perth day is audited but not emailed

**File:** `src/core/leads/balance.ts:221-237`
**Issue:** The `text_back_auto_disarmed` latch is per day. Operator re-arms at 10:00 without topping up; the 10:15 probe disarms again, writes the system audit row, and the day's email is already spent. The client page shows "system" in the arming history, but nothing arrives in the operator's inbox.
**Fix:** Log a fixed line when `autoDisarmed > 0` and the claim was not ours, or key the latch on `(kind, day)` plus a `detail.disarmed` increment via `ON CONFLICT DO UPDATE` so the second event is at least visible in `operator_alert_log`.

### IN-09: `pre_claim_failed` is counted as `failed` every tick while the row remains pending

**File:** `src/core/leads/sweep.ts:115-119,157`
**Issue:** A row whose pre-claim read timed out is retried next tick by design, yet `FAILED_KINDS` counts it under `textBackFailed`, the same field as a provider refusal. An operator reading the tick JSON sees "failures" that are retries.
**Fix:** Count it separately (`retried`) or leave it in `swept` only, as `claim_lost` is.

---

_Reviewed: 2026-10-07T10:26:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
