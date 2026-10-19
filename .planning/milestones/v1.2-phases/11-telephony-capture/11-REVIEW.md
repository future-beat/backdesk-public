---
phase: 11-telephony-capture
reviewed: 2026-10-04T16:32:26Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - src/app/api/webhooks/twilio/voice/route.ts
  - src/app/api/webhooks/twilio/voice-status/route.ts
  - src/app/api/internal/messaging-reconcile/route.ts
  - src/core/telephony/webhook-url.ts
  - src/core/telephony/verify-signature.ts
  - src/core/telephony/parse-voice-webhook.ts
  - src/core/telephony/caller.ts
  - src/core/telephony/greeting.ts
  - src/core/telephony/missed-call.ts
  - src/core/telephony/twilio-client.ts
  - src/core/telephony/reconcile.ts
  - src/core/telephony/provision.ts
  - src/core/onboarding/checklist.ts
  - src/core/shared/env.ts
  - src/db/migrations/0038_phase11_telephony_capture.sql
  - src/db/schema/missed-calls.ts
  - src/db/schema/tenant-divert-numbers.ts
  - src/db/schema/tenant-proofs.ts
  - src/db/repository/missed-calls.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/app/(console)/clients/[id]/actions.ts
  - src/app/(console)/clients/[id]/action-state.ts
  - src/app/(console)/clients/[id]/divert-number-form.tsx
  - src/app/(console)/clients/[id]/checklist-card.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - scripts/twilio-numbers-search.mjs
  - scripts/missed-calls-recent.mjs
  - scripts/verify-missed-call-reconcile.mjs
  - tests/telephony-greeting.test.ts
  - tests/telephony-caller.test.ts
  - tests/lint-ban.test.ts
findings:
  critical: 1
  warning: 9
  info: 8
  total: 18
status: issues_found
fixed: 11
partially_fixed: 1
fixed_at: 2026-10-05
fix_commits:
  CR-01: aca906b
  WR-01: 81e1947
  WR-02: 66cda87
  WR-03: 989bd84
  WR-04: 1fe47f2
  WR-05: 062bcd3
  WR-06: fa305fd
  WR-07: 2b159f3
  WR-08: d405260
  WR-09: 769576d
  IN-03: fa305fd
  IN-08: aca906b (activate-returns-zero-rows bullet only)
migration_needed: false
---

# Phase 11: Code Review Report

**Reviewed:** 2026-10-04T16:32:26Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Scope was `git diff --name-only 370bc0d..HEAD -- src scripts tests package.json .github` (58 files). All non-test source, the migration and the three scripts were read in full or as full diffs. Of the 22 test files, only `telephony-greeting`, `telephony-caller` and the `lint-ban` diff were inspected; the other test files, `meta/0038_snapshot.json`, `_journal.json` and `globals.css` were not reviewed. Six pure suites (caller, greeting, webhook-url, both routes, provision) were run bare: 187 passed. Nothing was run against the hosted database or Twilio.

The two public doors are sound on the points the phase cares most about: token compared in constant time before the body is read, signature over the URL built from `APP_BASE_URL` with the query token, tenant resolved from `To` only, uniform responses after the token gate, fixed-string logs with no caller number. RLS and grants (REVOKE-then-GRANT, SELECT-only for `authenticated`, two-arm policy, no delete path) match the stated design. The recorded deviations in 11-01..11-07 were not re-flagged.

The defects are at the edges:

- **Money path:** a purchase whose outcome is unknown (timeout, 5xx) is recorded as a definite failure, the console says "Nothing was bought", and the retry buys again (CR-01).
- **Withheld classifier:** Twilio's `+8656696` (UNKNOWN) sentinel is missing and is stored as a present caller (WR-01).
- **Skipped spike:** the verification-call proof does not check that the caller was present, though 11-08 moved the CLI-survival proof onto that call (WR-02).
- **"Never 5xx":** both doors call `getServerEnv()` outside any guard, so an invalid env is a 500 on a live call (WR-03).
- **Recording alarm:** a failed recordings count is silently reported as 0 (WR-05).

**The two open deferred items:**

- **F-11-07-1 (WA filter):** confirmed in code, see WR-08. The `region === 'WA'` arm is OR-ed with the `+618` prefix, so it never narrows anything.
- **F-11-07-2 (`bundle_sid` null after create):** not a field-name or casing problem. `purchaseNumber` passes `bundleSid` and `addressSid` (`twilio-client.ts:341-342`), and SDK 6.1.1 serialises them to `BundleSid` / `AddressSid` (`node_modules/twilio/lib/rest/api/v2010/account/incomingPhoneNumber.js:156-159`). The code makes no follow-up call and no read-back. So the cause is on Twilio's side (lazy population, or the bundle's state at purchase; commit 7d67a4b notes the bundle was "in review" and an earlier recorded SID was the Trust Hub profile). Code alone cannot settle which. See WR-09 for the read-back fix.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: BLOCKER — An indeterminate purchase is recorded as "failed, nothing bought", and the retry buys a second number — FIXED in `aca906b`

**File:** `src/core/telephony/provision.ts:347-357` (with `src/core/telephony/twilio-client.ts:351-353`, `src/app/(console)/clients/[id]/divert-number-form.tsx:142-143`, `src/app/(console)/clients/[id]/action-state.ts` `divertPurchaseFailedMessage`)

**Issue:** `purchaseNumber` maps every thrown value to `{ ok: false, reason }`. That includes a 20 s client timeout (`ETIMEDOUT` / `ECONNABORTED`), a connection reset after the request was sent, and any 5xx. `IncomingPhoneNumbers.create` is not idempotent, and in each of these cases Twilio may have completed the purchase. `provisionDivertNumber` treats all of them like a clean 4xx:

1. It writes `status='failed'` (`network_error` / `provider_unavailable`).
2. The console says "The purchase did not go through … nothing was bought. Search again".
3. The next click runs `reclaim` and then a second `create`.

The result is two billed, regulated numbers. The first is wired to the live voice URL, recorded nowhere, and never logged, because the `orphaned_number` line is written only when `activate` throws. By design there is no release path. This defeats the module's own "the row is claimed before a cent is spent" invariant. The cost per occurrence is small (about A$3 a month), but the number is untracked and the operator is told something false.

**Fix:** Treat only a definite refusal as `failed`. For indeterminate reasons, leave the row `pending` and say so:

```ts
// provision.ts
const INDETERMINATE = new Set(['network_error', 'provider_unavailable', 'sdk_error']);

if (!bought.ok) {
  const code = divertFailureCode(bought.reason);
  if (INDETERMINATE.has(code)) {
    // The purchase may have gone through. Do NOT open the retry path.
    console.error(`[telephony] provision outcome_unknown ${code}`);
    return { kind: 'outcome_unknown', code }; // row stays `pending`
  }
  ...fail({ failureCode: code })
}
```

Then add one read to `twilio-client.ts`: `incomingPhoneNumbers.list({ friendlyName: 'backdesk-divert-<tenantId>', limit: 2 })`. Call it before any purchase on a `pending` or `failed` row. If a number exists, `activate` with it instead of buying. Change the console sentence for this outcome to "The purchase may or may not have gone through — do not buy again; see the runbook". Add tests for `ETIMEDOUT` → no `fail`, no second `create`.

## Warnings

### WR-01: WARNING — `+8656696` (Twilio's "UNKNOWN" keypad sentinel) is stored as a present international caller — FIXED in `81e1947`

**File:** `src/core/telephony/caller.ts:51-60`

**Issue:** Twilio documents five keypad-spelled sentinels: `+266696687` ANONYMOUS, `+7378742833` RESTRICTED, `+2562533` BLOCKED, `+8656696` UNKNOWN, `+86282452253` UNAVAILABLE. The list has four; `+8656696` is missing. It matches `E164` (`^\+[1-9]\d{6,14}$`), so it is stored as `caller_kind='other_number'`, `caller_e164='+8656696'`, `caller_withheld=false`.

D-06 requires the withheld marker and no number. `missed-calls:recent` would print `caller_present=true`, which is exactly what 11-08 tells the operator to read as "CLI survived the divert". Phase 12 would not text it (not an AU mobile), so the harm is false evidence, not a wrong send. `tests/telephony-caller.test.ts` has no case for it.

**Fix:** Add `'+8656696'` to `WITHHELD_SENTINELS`, plus a test row. Also compare the digits-only form, so `266696687` and `+1266696687` style deliveries are caught:

```ts
const digits = trimmed.replace(/\D/g, '');
if (SENTINEL_DIGITS.has(digits) || SENTINEL_DIGITS.has(digits.replace(/^1/, ''))) return WITHHELD;
```

### WR-02: WARNING — The divert verification proof accepts a call with no caller, so the relocated spike proof is not enforced — FIXED in `66cda87`

**File:** `src/app/(console)/clients/[id]/actions.ts:1022-1038`

**Issue:** The `divert_verification_call` arm checks that the row is the tenant's and that `call_status === 'completed'`. Nothing else. 11-08 skipped the three-carrier spike and moved the proof here: the verification call "MUST be a diverted call" and the row must show the caller present, before text-back can be armed. As written, a `#31#` call, a call on a carrier that strips CLI, or a call whose `caller_kind` is `other_number` all satisfy `divertVerified`. The arm also does not compare `call.divertNumberId` to the tenant's current active row, and the stored detail omits `caller_withheld`. The only thing between a CLI-stripping carrier and an armed client is the operator remembering a runbook line.

**Fix:**

```ts
if (call.callerWithheld || call.callerKind !== 'mobile') {
  return { ...BLANK_PROOF_STATE, error: PROOF_MISSED_CALL_NO_CALLER_MESSAGE };
}
if (call.divertNumberId !== activeDivertRow.id) { /* refuse: not this number */ }
// and record caller_withheld + divert_number_id in artefactDetail
```

A direct dial cannot be told from a divert when `ForwardedFrom` is absent, so keep `forwarded_from_present` as recorded evidence and keep the runbook step.

### WR-03: WARNING — `getServerEnv()` runs unguarded at the top of both public doors, so the "never 5xx" contract does not hold — FIXED in `989bd84`

**File:** `src/app/api/webhooks/twilio/voice/route.ts:110,115`; `src/app/api/webhooks/twilio/voice-status/route.ts:106,111`

**Issue:** `getServerEnv()` validates the whole server schema and throws when any required key is missing or malformed, including keys unrelated to telephony (for example `AUDIT_IP_HASH_SALT`). It is called outside any `try`. An env regression anywhere in the app becomes a 500 on the voice door, which Twilio plays as its application-error message to the tradie's customer. `TWILIO_VOICE_FALLBACK_URL` is optional, so there may be no fallback. Every other failure in the route is carefully mapped to a 200. The call is also made twice (line 110, then again on 115).

**Fix:** Call it once inside a `try`. On a throw, log a fixed string (`[twilio] voice env_unreadable; served generic greeting.`) and return `twiml(greetingTwiml(null))` on the voice door, or `received()` on the status door. The static generic greeting with no write is safe to serve unauthenticated. Add a route test with `getServerEnv` throwing.

### WR-04: WARNING — The URL-token secrets are not constrained to URL-safe characters, though the signed URL depends on it — FIXED in `1fe47f2`

**File:** `src/core/shared/env.ts:223-224`; `src/core/telephony/webhook-url.ts:72`

**Issue:** `twilioWebhookUrl` interpolates the secret unencoded, on the stated assumption that it is 64 hex characters. The schema only enforces `z.string().min(32)`. A secret containing `+`, `&`, `#`, `%`, `=` or a space (for example from `openssl rand -base64 48`) passes validation and then fails in production:

- `searchParams.get('token')` decodes `+` to a space.
- `&` or `#` truncates the value.

Every real call then gets a 401, which is Twilio's error message to the caller. The provisioning guard does not catch it, and it shows up only on the first live call after a rotation.

**Fix:** Enforce the assumption where it is made:

```ts
TWILIO_VOICE_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,}$/),
TWILIO_VOICE_STATUS_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,}$/),
```

The CI dummies already satisfy this pattern.

### WR-05: WARNING — A failed recordings count is reported as `recordings=0` with no log line, so the D-04 alarm fails silent — FIXED in `062bcd3`

**File:** `src/core/telephony/reconcile.ts:200-202`

**Issue:** `const found = recordings.ok ? recordings.count : 0; if (found === 0) return 0;`. When the Twilio read fails (rotated auth token, 429, timeout), nothing is logged. The route body, the `reconcile recovered=… recordings=0` info line and `verify:missed-call-reconcile` all show `0`, which looks the same as "verified none". A permanently failing check reads as a permanently clean account. The calls poll, by contrast, does log its failure (line 295). D-04 says recording is "asserted by the reconcile"; an assertion that cannot be told apart from its own failure is not one.

**Fix:**

```ts
if (!recordings.ok) {
  console.warn(`[telephony] reconcile recordings poll failed: ${recordings.reason}`);
  return 0; // or return -1 / a separate `recordingsChecked: false` field
}
```

Preferably add a `recordingsChecked` boolean to `MissedCallReconcileResult` and the route body, so the ops probe can tell the two apart. Update the six-field pin if so.

### WR-06: WARNING — A call dead-lettered at arrival is never attributed by the reconcile, yet is counted as recovered — FIXED in `fa305fd`

**File:** `src/db/repository/missed-calls.ts:129-142`; `src/core/telephony/missed-call.ts:212-215`; `src/core/telephony/reconcile.ts:303-308`

**Issue:** An `unknown_number` dead letter keeps the real CallSid, with `tenant_id NULL` and no caller data. This is reachable. An `orphaned_number` purchase is live on Twilio while the row is still `pending`, and the lookup requires `status='active'`, so every call in that gap is dead-lettered. The same happens if a row is hand-activated later.

When the reconcile later finds the owner, `upsertMissedCallFromLog` hits the conflict path. That path updates only `call_status`, `duration_seconds`, `ended_at` and `completed_via`. So `tenant_id`, `divert_number_id`, the caller columns and `dead_letter_reason` stay as the dead letter wrote them. The call is permanently tenant-less and caller-less, and `recovered += 1` counts it anyway. This contradicts "every diverted call becomes a row the rest of the milestone can act on".

**Fix:** Let the conflict path adopt a dead letter:

```ts
set: {
  tenantId:        sql`coalesce(${missedCalls.tenantId}, excluded.tenant_id)`,
  divertNumberId:  sql`coalesce(${missedCalls.divertNumberId}, excluded.divert_number_id)`,
  callerE164:      sql`case when ${missedCalls.tenantId} is null then excluded.caller_e164 else ${missedCalls.callerE164} end`,
  // same CASE for caller_withheld, caller_kind, caller_raw, forwarded_from_raw, after_hours
  deadLetterReason: sql`case when ${missedCalls.tenantId} is null then null else ${missedCalls.deadLetterReason} end`,
  ...
}
```

Add a DB-suite case: dead letter, then reconcile with an owner, expect an attributed row.

### WR-07: WARNING — A `pending` divert row has no recovery path in code — FIXED in `2b159f3`

**File:** `src/core/telephony/provision.ts:306,349-355`; `src/app/(console)/clients/[id]/divert-number-form.tsx` (`pending` branch)

**Issue:** The row stays `pending` in three cases:

- the function is killed between `claim` and the purchase result (deploy, timeout);
- the `fail` write throws ("provision fail write failed");
- `activate` throws (orphan).

After that, both `findDivertNumberCandidate` and `provisionDivertNumber` return `in_progress` forever. The console shows "Purchase in progress — reload in a moment" with no age and no next step. Nothing distinguishes a claim made two seconds ago from one made two days ago. The client cannot be provisioned without a hand-run repository task.

**Fix:** Show `updated_at` age on the pending state ("claimed N minutes ago"). After a threshold (say 5 minutes), offer the reconcile-by-friendly-name lookup from CR-01: adopt the number if Twilio has one, otherwise flip the row to `failed` with `claim_abandoned` so the normal retry opens. One repository method, guarded on `status='pending' AND updated_at < now() - interval`.

### WR-08: WARNING — The WA search filter's `region` arm is redundant; any `+618` number passes (open item F-11-07-1) — FIXED in `d405260`

**File:** `src/core/telephony/twilio-client.ts:296-298,302-304`

**Issue:** The predicate is `n.region === 'WA' || n.phoneNumber.startsWith('+618')`.

- Deferred-items records the live search printing `region=Western Australia`, so the `=== 'WA'` literal likely never matches.
- If it did match, it could admit a non-`+618` number that the buy action's `^\+618\d{8}$` then refuses. That is the D-11-06-1 trap again.
- `+618` covers WA, SA and NT. The first purchase got a Waikerie SA number that Twilio's own search had labelled locality Perth, so the provider's locality and region strings cannot fix this.

The function comment ("narrowed … to `region === 'WA'` or a `+618` number — any WA 08 number") describes behaviour the code does not have.

**Fix:** Filter by number range, not by the provider's strings, and drop the region arm:

```ts
// WA geographic ranges are 08 5xxx / 08 6xxx / 08 9xxx; 08 7xxx and 08 8xxx are SA/NT.
// Verify against the ACMA numbering plan before relying on this.
const WA_RANGE = /^\+618[569]\d{7}$/;
const perth = inLocality.filter((n) => WA_RANGE.test(n.phoneNumber));
```

Fall back to any `+618` only when no WA-range number is offered. Add one unit test with a `+6187…` candidate first on the page.

### WR-09: WARNING — The purchase has no read-back of the regulatory bundle (open item F-11-07-2) — FIXED in `769576d`

**File:** `src/core/telephony/twilio-client.ts:338-350`

**Issue:** As established in the Summary, the create parameters are spelled correctly, yet the live purchase came back with `bundle_sid: null`. The code returns only `sid` and `phoneNumber`, so an unattached regulated number is reported as `provisioned`. Two further gaps:

- `bundleSid?` and `addressSid?` are optional in the signature, so an `undefined` is silently dropped from the request rather than refused.
- The file's "no update" rule means the manual attach done on 2 Oct cannot be reproduced by the product.

**Fix:**

1. Make `bundleSid` and `addressSid` required in `purchaseNumber`'s input type.
2. Return `bundleAttached: bought.bundleSid === input.bundleSid` from the create response.
3. If false, re-fetch once after a short delay. If still null, call `incomingPhoneNumbers(sid).update({ bundleSid })` and fetch again. This is a deliberate, narrowly named widening of the surface, for example `attachBundle`.
4. If still unattached, log a fixed `[telephony] provision bundle_unattached <PN sid>` and surface a console sentence.

Step 3's first fetch also answers the open question of whether Twilio populates the field lazily.

## Info

### IN-01: The structural no-recording scan covers two directories only

**File:** `tests/telephony-greeting.test.ts:44`
**Issue:** `SCANNED_DIRS` is `src/core/telephony` and `src/app/api/webhooks/twilio`. TwiML is a string and needs no import, so a `<Record>` or `<Dial record>` emitted from a Phase 12 module elsewhere (for example `src/core/textback/`, or a new route) passes the scan. The `sources.length >= 7` floor also would not notice a file moved out.
**Fix:** Add a repo-wide assertion: no file under `src/` other than `src/core/telephony/greeting.ts` contains `<Response>` or imports `twilio/lib/twiml`. Run the forbidden-element patterns over all of `src/`.

### IN-02: Reconcile silently truncates at 500 calls and aborts the whole sweep on one failed upsert

**File:** `src/core/telephony/twilio-client.ts:187-190`; `src/core/telephony/reconcile.ts:302-309`
**Issue:** `calls.list({ limit: 500 })` is account-wide and covers all directions, with no signal when the cap is hit. One upsert throw skips every later call. The run then reports `skipped: true` with zeros, which is indistinguishable from "no active numbers".
**Fix:** Log a fixed `reconcile calls_truncated` line when `items.length === limit`. Wrap each upsert in try/catch with a `failed` counter.

### IN-03: The reconcile upsert overwrites `call_status` unconditionally, including with NULL — FIXED in `fa305fd` (with WR-06)

**File:** `src/db/repository/missed-calls.ts:135`
**Issue:** `knownStatus()` returns `null` for a status outside the nine. `excluded.call_status` then replaces a stored `completed` with NULL.
**Fix:** `callStatus: sql\`coalesce(excluded.call_status, ${missedCalls.callStatus})\``.

### IN-04: Row invariants the code relies on are not CHECKed

**File:** `src/db/migrations/0038_phase11_telephony_capture.sql:114-121`; `src/db/schema/missed-calls.ts`
**Issue:** Three gaps:

- Nothing enforces "withheld ⇒ no number" or `caller_withheld = (caller_kind = 'withheld')`, and Phase 12 texts off these columns.
- Nothing enforces `tenant_id IS NULL ⇔ dead_letter_reason IS NOT NULL`.
- `'body_unreadable'` is in the dead-letter vocabulary but no code path writes it.

**Fix:** In Phase 12's migration, add `CHECK ((caller_kind = 'withheld') = (caller_e164 IS NULL))`, `CHECK (caller_withheld = (caller_kind = 'withheld'))` and the tenant/dead-letter equivalence. Drop the unused reason or write it.

### IN-05: `forwarded_from_raw`, `from_country` and the dead letter's `To` are stored uncapped

**File:** `src/core/telephony/missed-call.ts:171,230-231`; `src/core/telephony/reconcile.ts:261`
**Issue:** `caller_raw` is capped at 64 "because a caller controls its length". The same reasoning applies to these three fields.
**Fix:** `.slice(0, 64)` on each. Share one constant between `missed-call.ts` and `reconcile.ts`, where `MAX_CALLER_RAW_CHARS` is currently duplicated.

### IN-06: `missedCalls.latest()` selects the whole row, caller number included, to read one timestamp

**File:** `src/db/repository/for-tenant.ts:3621-3630`; `src/core/onboarding/checklist.ts:392`
**Issue:** The checklist needs only `startedAt`. `select()` pulls `caller_e164`, `caller_raw` and `forwarded_from_raw` into the page's server render path. This is at odds with the "no caller number in its select list" rule that `getMissedCallForTenant` follows.
**Fix:** `select({ startedAt: missedCalls.startedAt })` and narrow the return type.

### IN-07: Phase 12 handoff — capture does not mark "caller is the diverting line"

**File:** `src/core/telephony/missed-call.ts:217-231`
**Issue:** 11-08 requires Phase 12 to fail safe when the caller is absent or is the client's own number. Absent is fully covered: `caller_withheld` is true and `caller_e164` is NULL, including when `From` is missing. For the own-number case, capture provides only `forwarded_from_raw`, which is unnormalised and carrier-dependent. `tenant_divert_numbers` holds no "client's own line" value. If a carrier substitutes the diverting line as CLI and omits `ForwardedFrom`, the row looks like an ordinary mobile caller.
**Fix:** In Phase 12, compare `caller_e164` against `classifyCaller(forwarded_from_raw).e164` and against the TXT-05 never-text list. Treat an empty never-text list as "not armable". Consider a `client_line_e164` column on `tenant_divert_numbers`, filled at onboarding.

### IN-08: Small dead code and unchecked results — PARTIALLY FIXED in `aca906b` (activate returning zero rows → orphan path; the alias and the duplicated helpers are unchanged)

**File:** `src/app/(console)/clients/[id]/checklist-card.tsx:367`; `src/core/telephony/provision.ts:362-367`; `src/app/api/webhooks/twilio/voice/route.ts:86-91` and `voice-status/route.ts:85-90`
**Issue:**

- `const formChannel: ProofSlot | null = proofChannel;` is a leftover alias from the 11-04 narrowing.
- `activate`'s returned rows are not checked. Zero rows (the guard matched nothing) is reported as `provisioned`.
- `tokenMatches` / `unauthorized` are duplicated across the two doors. The header documents this as deliberate, so it is noted only.

**Fix:** Remove the alias. Treat `activate` returning `[]` as the orphan path.

---

## Fix log (2026-10-05, gsd-code-fixer)

CR-01 and WR-01..WR-09 fixed, one atomic commit each; IN-03 fixed inside WR-06's
upsert, and IN-08's "activate returning zero rows is reported as provisioned"
fixed inside CR-01. No migration was needed: every new state fits the existing
CHECK vocabularies (`outcome_unknown` as a hold code on a `pending` row,
`bundle_unattached` on an `active` row, both in `failure_code ~ '^[a-z_]{1,32}$'`);
`npm run db:generate` reported "No schema changes". Out-of-scope info findings
IN-01, IN-02, IN-04, IN-05, IN-06, IN-07 are unchanged.

_Reviewed: 2026-10-04T16:32:26Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
