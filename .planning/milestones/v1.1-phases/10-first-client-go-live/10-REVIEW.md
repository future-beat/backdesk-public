---
phase: 10-first-client-go-live
reviewed: 2026-09-11T08:56:15Z
depth: standard
scope: waves 1-4 interim (plans 10-01..10-06; the two event-gated live-proof plans contain no code)
files_reviewed: 43
files_reviewed_list:
  - package.json
  - scripts/cadence-status.mjs
  - scripts/clicksend-balance.mjs
  - scripts/escalations-recent.mjs
  - scripts/resend-email-status.mjs
  - scripts/verify-email-pipe.mjs
  - src/app/(console)/_auth.ts
  - src/app/(console)/clients/[id]/action-state.ts
  - src/app/(console)/clients/[id]/actions.ts
  - src/app/(console)/clients/[id]/checklist-card.tsx
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/settings/email/actions.ts
  - src/app/(console)/settings/email/forms.tsx
  - src/app/(console)/settings/email/page.tsx
  - src/core/messaging/resend-domains.ts
  - src/core/messaging/resend-emails.ts
  - src/core/onboarding/arming.ts
  - src/core/onboarding/checklist.ts
  - src/db/migrations/0036_phase10_go_live.sql
  - src/db/repository/escalations.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/repository/messaging-config.ts
  - src/db/schema/index.ts
  - src/db/schema/messaging-config-audit.ts
  - src/db/schema/tenant-proofs.ts
  - tests/arming-actions.test.ts
  - tests/email-settings-action.test.ts
  - tests/escalation.test.ts
  - tests/go-live-checklist.test.ts
  - tests/helpers/seed.ts
  - tests/lint-ban.test.ts
  - tests/messaging-config-arming.test.ts
  - tests/onboarding-checklist-gate.test.ts
  - tests/operator-authorization.test.ts
  - tests/ops-scripts.test.ts
  - tests/proof-actions.test.ts
  - tests/rls-coverage.test.ts
  - tests/routing-dispatch.test.ts
  - tests/runbook-contract.test.ts
  - tests/sync-upsert.test.ts
  - tests/tenant-proofs.test.ts
findings:
  critical: 1
  warning: 3
  info: 8
  total: 12
fixed: 4
status: issues_found
---

# Phase 10: Code Review Report (interim, waves 1-4)

**Reviewed:** 2026-09-11T08:56:15Z
**Depth:** standard
**Files Reviewed:** 43 (diff `6bbba4b..HEAD` under `src`, `scripts`, `tests`, `package.json`; the two generated drizzle meta files were excluded)
**Status:** issues_found — the critical finding and all three warnings are FIXED (`fe2c88e`, `91f80aa`, `55aab1c`, `4c8d2f1`); the eight info items remain open, which is why the status has not moved to clean.

## Summary

The arming core holds up under adversarial reading. `armChannel` / `disarmChannel` put the config flip and the audit INSERT in one `getDb().transaction`, re-read the target row inside the transaction and re-supply every identity field, refuse `no_identity` before writing, and the DB suite forces a real constraint failure on the audit row and asserts the flip rolled back. `disarmChannel` is ungated and creates the explicit-OFF override when a tenant has no row. Both actions call `requireOperatorId()` then `authorize()` before a byte of `formData` is read, every input crosses a zod schema, the gate is re-read server-side on every arm, and a failed domain read is a refusal on both the checklist and the action. The blast-radius crossing is an INNER JOIN on live connections with `paused_at IS NULL` and a `NOT EXISTS` own-row predicate, selecting ids and names only. Migration 0036 carries RLS on both tables, REVOKE-then-GRANT, SELECT-only for `anon`/`authenticated`, and `is_operator()` for the tenant-less audit rows. The four scripts are SELECT/GET-only with explicit column lists, and `verify-email-pipe --cadence` validates before identity resolution and before the send. The remote suites rewritten per-tenant still assert something real (an explicit OFF row resolves no identity), and the pure suites pin write-nothing on every refusal.

What does not hold is the **email half of the proof**. The escalation artefact is verified tenant-scoped in the predicate; the email artefact is verified only as "some email on this Resend account was delivered". One warning follows from the same wrapper (`opened`/`clicked` are post-delivery events and are refused as not delivered), one from the unvalidated artefact id reaching the provider URL path, and one from the identity-only settings save, which can null the identity of an ENABLED row and thereby stop a live client's email with no audit row.

Deliberate recorded choices (SMS arms the global row in v1; no Tier 1 detection; DOM-04 reworded scope; remote suites CI-only; the `requireOperator(?:Id)?` regex widening) were not flagged.

## Critical Issues

### CR-01: The email pipe proof is not tenant-scoped — any delivered email on the Resend account proves any client

**FIXED** — `fe2c88e`. `getEmailStatus` now surfaces the sender as a bare lowercase address (`bareAddress`, exported so both sides of the comparison normalise identically) and `recordProofAction` refuses any email whose sender is not this client's own armed from-address. An unparseable sender is a refusal, not a pass; the sentence names neither address.

**File:** `src/app/(console)/clients/[id]/actions.ts:919-937`, `src/core/messaging/resend-emails.ts:99-121`
**Issue:** T-10-17 ("fabricated or foreign artefact id recorded as proof", high) is mitigated for `escalation_handset_proof` by `getEscalationForTenant(tenantId, id)` with the tenant in the predicate. For `email_pipe_proof` the only check is `getEmailStatus(artefactId).lastEvent === 'delivered'`. Nothing ties the Resend email to this tenant: a delivered message id from another founding client's cadence, from an operator alert (`alerts@quotes.backdesk.com.au`), from the audit-request pipeline, or from a `verify-email-pipe` run against a different tenant all pass, and the checklist then derives `live.email = 'live'` for a client whose identity never sent anything. The Resend response carries `from: string` (`GetEmailResponseSuccess`, resend `index.d.mts:1462`), so ownership is checkable against the tenant's own row (`checklist.arming.email.from`), but the wrapper discards it. D-02's "the artefact belongs to this client" invariant, and the module's own header claim that the artefact is "verified live, tenant-scoped", are false for one of the two kinds.
**Fix:**
```ts
// resend-emails.ts — surface the sender, address only, lowercased
export type EmailStatusResult =
  | { ok: true; id: string; lastEvent: string; toDomain: string | null;
      /** The bare address inside Resend's `from`, lowercased. */
      fromAddress: string | null; createdAt: string | null }
  | { ok: false; reason: string };

function bareAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const inner = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  const address = inner.trim().toLowerCase();
  return address.includes('@') ? address : null;
}
// in getEmailStatus's ok branch:
fromAddress: bareAddress(data.from),

// actions.ts — after the delivered check, before artefactDetail is built
const ownFrom = checklist.arming.email.from?.trim().toLowerCase() ?? null;
if (ownFrom === null || status.fromAddress !== ownFrom) {
  return { ...BLANK_PROOF_STATE, error: PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE };
}
```
Add `PROOF_EMAIL_NOT_THIS_CLIENT_MESSAGE` to `action-state.ts` ("That email was not sent from this client's identity. Only a delivered message from their own from-address is a proof.") and a pure case in `tests/proof-actions.test.ts`: `getEmailStatus` resolves `{ ok: true, lastEvent: 'delivered', fromAddress: 'quotes@other.example.com.au' }` and `append` is not called.

## Warnings

### WR-01: The identity-only email settings save can null the identity of an ENABLED row — an unaudited effective disarm

**FIXED** — `91f80aa`. An enabled row now refuses a save that clears `from_address` or `reply_to`, with a sentence naming the disarm control. The relaxed rule survives on disabled rows, and editing a complete identity on a live row is still allowed. `business_name` is deliberately out of scope: it falls back to the tenant's name in `resolveEmailIdentity`, so clearing it is not by itself a stop. The milder form (changing `from_address` to an unverified domain) was already refused by the pre-existing `isSendingDomainVerified` check, which runs on every save that supplies an address.

**File:** `src/app/(console)/settings/email/actions.ts:235-297`
**Issue:** `saveEmailConfigAction` preserves `enabled` from the stored row (correct) but applies no completeness rule when that row is enabled. Posting `from_address=''` (or `reply_to=''`) against a live client writes `{ fromAddress: null, enabled: true }` through the exhaustive upsert. `resolveEmailIdentity` then returns `null` (`routing-sender.ts:224-226`), every send records `email_not_configured`, the checklist reads `emailArmed` unmet with detail "identity saved, not armed" while `EmailControls` still offers "Turn email off" (because `tenantRow.enabled` is true), and no `messaging_config_audit` row exists. This is exactly the silent-stop the header's own rationale for preserving `enabled` describes, reached through the identity fields instead of the flag. The comment justifying the removed completeness checks ("on a row that is disabled and sends nothing") assumes the row is disabled; it may not be. Changing the from-address of a live row to a different verified domain is the milder form of the same gap (live sending identity changed with no audit).
**Fix:** Keep the relaxed rule for disabled rows, but refuse an incomplete identity on an enabled one and point at the disarm control:
```ts
if (existing?.enabled) {
  const incomplete = from_address === '' || reply_to === '';
  if (incomplete) {
    return {
      ...BLANK_EMAIL_SETTINGS_STATE,
      error: "Email is on for this client. Turn it off from the client's page before clearing its identity — the change must be audited.",
    };
  }
}
```
Pin it in `tests/email-settings-action.test.ts` (`getChannelConfig` → `{ tenantId: TENANT_ID, enabled: true }`, `from_address: ''` → `upsertChannelConfig` not called).

### WR-02: `opened` / `clicked` are refused as "not delivered" — the DOM-04 sequence can make its own proof unrecordable

**FIXED** — `55aab1c`. `getEmailStatus` returns `delivered`, derived from one `DELIVERED_EVENTS` set (`delivered`, `opened`, `clicked`); both callers read the boolean and neither compares `lastEvent` itself. `bounced`, `complained`, `delivery_delayed`, `sent` and `queued` remain refusals. The artefact row still stores what Resend said rather than the derived boolean, so it stays re-checkable at the provider.

**File:** `src/app/(console)/clients/[id]/actions.ts:927-932`, `scripts/resend-email-status.mjs:83-86`, `src/core/messaging/resend-emails.ts:18-21`
**Issue:** Resend's `last_event` is the *latest* event, and the union includes `opened` and `clicked` (resend `index.d.mts:1466`), both of which imply delivery. D-07's sequence has the operator open the proof email in a real inbox and exercise the one-click link before recording the proof; if open or click tracking is enabled on the sending domain, `last_event` will read `opened`/`clicked` and both the action (`proofEmailNotDeliveredMessage('opened')`) and the script (exit 2) refuse a message that was delivered. The wrapper's header says it exists so that "two spellings of what counts as delivered" cannot exist, yet the comparison is spelled in two callers rather than in the wrapper.
**Fix:** Decide "delivered" once, in the wrapper, and have both callers read the boolean:
```ts
// resend-emails.ts
const DELIVERED_EVENTS: ReadonlySet<string> = new Set(['delivered', 'opened', 'clicked']);
// ok branch: add
delivered: DELIVERED_EVENTS.has(lastEvent),
```
Action: `if (!status.delivered) return … proofEmailNotDeliveredMessage(status.lastEvent)`. Script: `if (status.delivered) process.exit(0)`. Update the `tests/ops-scripts.test.ts` pin at line 257 (`"'delivered'"`) to `toContain('status.delivered')` and add `opened` to the accepted cases in `tests/proof-actions.test.ts`.

### WR-03: The email artefact id is sent to the provider URL path with no format validation

**FIXED** — `4c8d2f1`. Validated before the provider read with the script's own pattern (`/^[0-9a-f-]{20,64}$/`) so the two readers of the same paste agree. The line-471 test whose premise was wrong is replaced with refusals on `../domains`, a query string and a non-id; the fixture id is now uuid-shaped (it was `resend-message-0001`, an id Resend would never mint — which is what made the wrong premise look proven).

**File:** `src/app/(console)/clients/[id]/actions.ts:919`, `src/core/messaging/resend-emails.ts:105`, `tests/proof-actions.test.ts:471-476`
**Issue:** `proofSchema.artefact_id` accepts any trimmed string of 8..128 characters, and `getEmailStatus(id)` hands it to `new Resend(key).emails.get(id)`, which interpolates it into `GET /emails/{id}` unencoded. A paste such as `../domains` or `x?y` reaches a different authenticated endpoint. The realistic outcome is a bounded `unknown` refusal, but the escalation half validates its id as a uuid *before* the read (`UUID_PATTERN.test`), the standalone script validates with `/^[0-9a-f-]{20,64}$/` (`resend-email-status.mjs:65`), and the action is the one caller that does neither. The pure test at line 471 ("does NOT require a uuid for the email artefact — a Resend id is not one") pins the absence; Resend email ids are uuid-shaped, so the test's premise is wrong.
**Fix:** Validate before the provider read, with the script's pattern so both readers agree:
```ts
const RESEND_ID_PATTERN = /^[0-9a-f-]{20,64}$/;
// in the email branch, before getEmailStatus:
if (!RESEND_ID_PATTERN.test(artefactId)) {
  return { ...BLANK_PROOF_STATE, error: PROOF_ARTEFACT_NOT_RESEND_ID_MESSAGE };
}
```
Replace the line-471 test with one that asserts a non-id (`'../domains'`) is refused and `getEmailStatus` is not called.

## Info

### IN-01: The arming gate is evaluated outside the arming transaction

**File:** `src/app/(console)/clients/[id]/actions.ts:648-666`, `src/db/repository/messaging-config.ts:319-366`
**Issue:** `readGoLiveChecklist` runs on the pool, then `armChannel` opens its transaction; the gate conditions (connection paused, templates approval, attestation, escalation phone, domain) are not re-checked under the row lock. The window is milliseconds and every input to it is operator-only (attestations are append-only; a pause or template revocation would have to race the same operator), so this is bounded, but the summary's claim that the gate and the write are one evaluation is slightly stronger than the code.
**Fix:** Either record the choice in the `armChannel` header ("the gate is the caller's, read immediately before; the transaction protects the flip and its audit row, not the gate"), or accept an optional `gate: (tx) => Promise<GatingKey | null>` in `ArmChannelInput` and evaluate it inside `tx` before `upsertWith`. The former is the cheaper honest answer at this scale.

### IN-02: A stale disarm sentence can resurface under an armed row after a proof tap

**File:** `src/app/(console)/clients/[id]/checklist-card.tsx:400-408`
**Issue:** `ArmRow` selects `last.kind === 'arm' ? armState : disarmState`, so `last = { channel, kind: 'proof' }` falls through to `disarmState`. Sequence: disarm (disarmState.success set) → re-arm → record proof: the SMS arm row now shows "Off. SMS is off …" from the earlier disarm beside a channel that is on.
**Fix:** `last.kind === 'arm' ? armState : last.kind === 'disarm' ? disarmState : BLANK_ARM_STATE`.

### IN-03: Blast-radius warning reads "from the shared number the shared number" when no global row exists

**File:** `src/app/(console)/clients/[id]/checklist-card.tsx:664`, `src/app/(console)/clients/[id]/action-state.ts:266-273`
**Issue:** `SmsControls` passes `sms.from ?? 'the shared number'` into `smsBlastRadiusSentence`, whose template already says "from the shared number ${from}". With no global sms row (the state before `setup-clicksend` has run) the warning is ungrammatical; the arm would then return `no_identity` anyway.
**Fix:** Pass `sms.from` through as `string | null` and have the sentence render `from the shared number${from ? ` ${from}` : ''}` — one spelling in `action-state.ts`.

### IN-04: The forbidden-operator sentence on the arming controls says "audits"

**File:** `src/app/(console)/_auth.ts:123-126`, used at `clients/[id]/actions.ts:623,730,844`
**Issue:** `OPERATOR_DENIED_MESSAGE.forbidden` is `'You do not have access to audits.'`, written for the prospect actions. It is now the refusal on arm, disarm and proof — the operator reads "audits" on a control that arms customer messaging.
**Fix:** Generalise the sentence (`'You do not have access to this.'`) or add a per-surface parameter; keep it non-oracular per the existing comment.

### IN-05: Stale counts in comments and a nine-key test fixture

**File:** `src/core/onboarding/arming.ts:70`, `src/app/(console)/clients/[id]/page.tsx:733`, `src/core/onboarding/checklist.ts:280`, `tests/arming-actions.test.ts:107-117`
**Issue:** `arming.ts` says `GatingKey` "would then be all NINE checklist keys" (eleven since 10-05); `page.tsx` says the checklist "fans out to TEN parallel reads" while `checklist.ts` says "Twelve independent reads" (twelve is correct, plus the dependent domain read); `ALL_KEYS` in the pure arming suite lists nine keys and its fixture omits `proofs`/`live`. Harmless for the gate (the proof keys never gate) but the fixture no longer matches the type it stands in for.
**Fix:** Update the three numbers; extend `ALL_KEYS` to the eleven keys and add `proofs: { … null }, live: { sms: 'not_armed', email: 'not_armed' }` to `checklistFixture`.

### IN-06: Magic `500` in zod messages beside the named constants

**File:** `src/app/(console)/clients/[id]/actions.ts:601` (`'Keep the reason under 500 characters.'`), `:794` (`'Keep it under 500 characters — …'`)
**Issue:** The limits are `ARM_REASON_MAX` and `PROOF_NOTE_MAX`; the sentences hard-code 500 and will drift if the constants change.
**Fix:** Template the constant: `` `Keep the reason under ${ARM_REASON_MAX} characters.` ``.

### IN-07: A hedged assertion that pins nothing about `live.sms`

**File:** `tests/go-live-checklist.test.ts:345`
**Issue:** `expect(['not_armed', 'armed']).toContain(checklist.live.sms)` accepts either outcome, so the "not_armed on both channels" test asserts only the email half. The rationale (the shared row may be armed) is real on the hosted database but not on the CI stack this suite runs against.
**Fix:** Seed an explicit OFF override for the bare tenant (`seedMessagingConfigOverride(tenantId, 'sms')`) and assert `toBe('not_armed')`; the 10-04 helper exists for exactly this.

### IN-08: The two database probes print `error.message`; the provider probes print `e.name`

**File:** `scripts/escalations-recent.mjs:145`, `scripts/cadence-status.mjs:137`
**Issue:** T-10-08's rule ("errors as names") is applied to `clicksend-balance.mjs` and `getEmailStatus` and pinned by `ops-scripts.test.ts`, but the two postgres scripts print the driver message. A postgres.js auth failure message names the role (`postgres.<project-ref>` on the pooler). This matches the pre-existing `cron-status.mjs:176` pattern and nothing interpolated is secret, so it is consistency rather than a leak.
**Fix:** `console.error(error instanceof Error ? \`${error.name}${'code' in error ? \` (${error.code})\` : ''}\` : 'UnknownError')` in both, and extend `expectReadOnlyDbScript` to pin `error.name`.

---

_Reviewed: 2026-09-11T08:56:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
