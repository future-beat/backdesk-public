---
phase: 04-messaging-gateway
reviewed: 2026-08-30T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - .github/workflows/ci.yml
  - docs/external-registrations.md
  - package.json
  - scripts/apply-cron-schedules.mjs
  - scripts/push-vercel-env.mjs
  - scripts/setup-clicksend.mjs
  - scripts/verify-email-pipe.mjs
  - src/app/(console)/inbox/action-state.ts
  - src/app/(console)/inbox/actions.ts
  - src/app/(console)/inbox/mark-handled-form.tsx
  - src/app/(console)/inbox/page.tsx
  - src/app/(console)/layout.tsx
  - src/app/(console)/settings/email/action-state.ts
  - src/app/(console)/settings/email/actions.ts
  - src/app/(console)/settings/email/forms.tsx
  - src/app/(console)/settings/email/page.tsx
  - src/app/api/internal/cadence-tick/route.ts
  - src/app/api/internal/messaging-reconcile/route.ts
  - src/app/api/unsubscribe/route.ts
  - src/app/api/webhooks/clicksend/dlr/route.ts
  - src/app/api/webhooks/clicksend/inbound/route.ts
  - src/core/cadence/controls.ts
  - src/core/cadence/dispatch.ts
  - src/core/cadence/sender.ts
  - src/core/messaging/clicksend-client.ts
  - src/core/messaging/clicksend-sender.ts
  - src/core/messaging/inbound.ts
  - src/core/messaging/receipts.ts
  - src/core/messaging/reconcile.ts
  - src/core/messaging/resend-domains.ts
  - src/core/messaging/resend-sender.ts
  - src/core/messaging/routing-sender.ts
  - src/core/messaging/stop-keywords.ts
  - src/core/messaging/unsubscribe-token.ts
  - src/core/shared/env.ts
  - src/db/migrations/0025_inbound_messages.sql
  - src/db/migrations/0026_messaging_config_delivery.sql
  - src/db/migrations/meta/_journal.json
  - src/db/repository/delivery-receipts.ts
  - src/db/repository/for-all-tenants.ts
  - src/db/repository/inbound-messages.ts
  - src/db/repository/index.ts
  - src/db/repository/messaging-config.ts
  - src/db/schema/inbound-messages.ts
  - src/db/schema/messaging-config.ts
  - tests/messaging-reconcile.test.ts
  - tests/routing-sender.test.ts
  - tests/unsubscribe.test.ts
findings:
  critical: 3
  warning: 12
  info: 7
  total: 22
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-08-30
**Depth:** standard
**Files Reviewed:** 41 source files (plus 3 test files read for corroboration)
**Status:** issues_found

## Summary

The security-sensitive surfaces this phase was asked to get right are, on the whole,
right. Token comparison is constant-time on all four bearer/query-token paths, the
unsubscribe endpoint really is a uniform-response non-oracle (GET writes nothing, POST
returns byte-identical bytes for valid/forged/DB-down), the suppression write path is
genuinely single-sourced through `controls.ts::suppressAndStop`, both channels and
verbatim snapshot addresses included, and `updateDeliveryWhereMatch` is structurally
incapable of reaching `outcome` or of matching without a key the caller already holds.
Log discipline (T-2-02 / T-4-02) held everywhere I traced it: no address, body, token or
provider prose reaches a `console.*` call in any route, sender, or core module.

What did not hold is the activation story and the compliance backstop.

Three findings are blocking. The largest is that **per-tenant activation does not work**:
`buildRoutingSender` gates both channels on the GLOBAL `messaging_config` row only, so
enabling a single client's row — the documented one-client-at-a-time rollout that D-04
and the `messaging_config` schema header both exist for — sends nothing, silently, via
`StubSender`, while the console reports "Email is on for this client." The second is that
the T-4-18 provider-opt-out backstop reads a two-field corpus (`status`, `status_code`)
that this repository's own live-capture evidence proves carries no verdict at all
(`'Sent'`/`'Failed'`, `'201'`/`'301'`) — the sibling classifier in `receipts.ts` was
already fixed for exactly this reason, and the reconcile pass was not. Its passing test
uses an invented `RECIPIENT_OPT_OUT` fixture that live data contradicts. The third is a
dispatch-loop hole where a single `setOutcome` failure aborts the whole tick for every
remaining tenant and abandons the current tenant's already-claimed sends permanently.

Beyond those, the recurring pattern in the warnings is **asymmetry between two files that
document themselves as siblings**: the DLR route omits the body-read guard the inbound
route explains at length; the inbound payload schema omits the `string | number` union
the history schema in the same package explains at length; `usableIdentity` sanitises the
display name but not the two addresses beside it in the same header string.

## Narrative Findings (AI reviewer)

### Critical Issues

#### CR-01: Enabling a per-tenant `messaging_config` row sends nothing — the whole D-04 rollout is unreachable

**Severity:** BLOCKER
**File:** `src/core/messaging/routing-sender.ts:222-255`, `:126-131`, `:426-439` (in `resend-sender.ts`); `src/app/(console)/settings/email/actions.ts:286-293`

**Issue:**
`buildRoutingSender()` reads the activation flag with the global-only form of the lookup:

```ts
const [smsConfig, emailConfig] = await Promise.all([
  getChannelConfig('sms'),     // no tenantId → and(channel, isNull(tenantId))
  getChannelConfig('email'),
]);
```

`getChannelConfig(channel)` with no `tenantId` filters `isNull(messagingConfig.tenantId)`
(`src/db/repository/messaging-config.ts:93-98`), so only the global row is ever consulted.
`chooseSmsSender` / `chooseEmailSender` then return `fallback` (`StubSender`) whenever that
global row is absent or `enabled = false` — which, per `docs/external-registrations.md`, is
production's current state (the global sms row was deliberately DISARMED).

Consequences, all silent:

1. An operator who saves an ENABLED row for one client and leaves the global row off gets
   `StubSender` for that client. The tick records `sender = 'stub'`, `outcome = 'stub_sent'`,
   and nothing is sent — while `saveEmailConfigAction` returns
   `'Saved. Email is on for this client.'`, which is false.
2. The only way to send for one client is to enable the GLOBAL row, which by
   `resolveEmailIdentity` / `resolveSmsFrom` immediately arms every client that has no row
   of their own. That is the exact inverse of the rollout `src/db/schema/messaging-config.ts`
   describes as the reason this is a table rather than an env var: "somebody has to turn
   sending on for one client at a time, watch it, and be able to turn it off in seconds."
3. `routing-sender.ts:119-124` documents this behaviour as if it existed
   ("NOTE THE ORDER OF THE `enabled` CHECK relative to the tenant lookup in
   `buildRoutingSender`"), but `buildRoutingSender` performs no tenant lookup at that gate.
   The comment describes the disable direction only, which happens to work by accident
   because `resolveSmsFrom` / `resolveEmailIdentity` re-ask per tenant.
4. `tests/routing-sender.test.ts` only exercises `chooseSmsSender` as a pure function over
   a single row; no test constructs a tenant-override row and asserts it activates.

**Fix:**
Gate on "any enabled row for this channel", not on the global row, and keep the per-tenant
resolution as the authority for *which identity*. Minimum change:

```ts
// src/db/repository/messaging-config.ts — new accessor, one statement, no join
export async function anyChannelEnabled(channel: MessagingChannel): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: messagingConfig.id })
    .from(messagingConfig)
    .where(and(eq(messagingConfig.channel, channel), eq(messagingConfig.enabled, true)))
    .limit(1);
  return row !== undefined;
}
```

```ts
// src/core/messaging/routing-sender.ts
const [smsEnabled, emailEnabled, smsGlobal, emailGlobal] = await Promise.all([
  anyChannelEnabled('sms'),
  anyChannelEnabled('email'),
  getChannelConfig('sms'),
  getChannelConfig('email'),
]);

// chooseSmsSender / chooseEmailSender take the deployment-level "is this channel armed
// anywhere" answer; the per-tenant resolvers below still refuse a tenant whose own row
// is disabled or absent-and-global-disabled, so nothing widens the blast radius.
```

`chooseSmsSender` / `chooseEmailSender` must then require `enabled || fromAddress` from the
*global* row no longer; the `from`/identity check moves entirely to the resolvers, which
already return `null` for a disabled or address-less row. Add a test that (a) a tenant
override with `enabled = true` and a disabled global row produces a real sender for that
tenant and `sms_not_configured` for every other, and (b) the console success copy matches.

---

#### CR-02: The provider-opt-out backstop (T-4-18) reads fields that live data proves carry no verdict — it cannot fire

**Severity:** BLOCKER
**File:** `src/core/messaging/reconcile.ts:209`; corpus assembled in `src/core/messaging/receipts.ts:260-265`

**Issue:**
`applyHistory` decides whether a polled history row represents a provider-side opt-out from
two fields only:

```ts
if (isOptOutCode(codeOf(`${entry.status ?? ''} ${entry.statusCode ?? ''}`))) {
  optedOutLedgerIds.push(outcome.ledgerId);
}
```

`docs/external-registrations.md` (2026-08-30, "The delivery half of MSG-01, proven") records
the actual shape of both real history rows this account has ever produced:

| field | delivered send | failed send |
|---|---|---|
| `status` | `Sent` | `Failed` |
| `status_code` | `201` | `301` |
| `status_text` | `Message delivered to the handset` | `Absent Subscriber. Phone is out of range…` |
| `error_text` | `Message delivered to the handset` | `Unknown error` |

`codeOf('Sent 201')` → `SENT_201`; `codeOf('Failed 301')` → `FAILED_301`. Neither contains
`OPT`, and neither ever will: the verdict prose lives in `status_text` / `error_text`. This
is the *identical* defect that was found and fixed one file over — `receipts.ts:189-196` and
the same doc's "The sweep was translating lossily" section explain that classifying from
`Sent 201` "carries no verdict", and `classify`'s corpus was widened to
`[status, status_text, status_code, error_text]` for exactly that reason. `reconcile.ts`'s
opt-out probe was not.

Net effect: `recordOptOuts` receives an empty `ledgerIds` list on every real sweep and returns
`0` immediately (`reconcile.ts:289`). The compliance guarantee the pass exists for — "ClickSend
refused this message because the recipient opted out with them, and that opt-out never passed
through our inbound door" (threat T-4-18, the hole `reconcile.ts`'s own header calls "the third,
and the one that matters") — is dead code in production, reporting `optOutsRecorded: 0`
indistinguishably from "nothing was missed". This is the same failure shape the doc's
"the BACKSTOP was reading an empty endpoint" section describes for `/sms/inbound`.

Compounding it: `tests/messaging-reconcile.test.ts:319` asserts the path with
`historyRow({ status: 'RECIPIENT_OPT_OUT', statusCode: null })` — a fixture invented before
any real payload existed, which the live capture contradicts. The suite is green on a shape
the provider does not emit.

**Fix:**
Use the same four-field corpus the classifier uses, assembled the same way (per-field `codeOf`,
never one joined string — `codeOf` caps at 48 chars and the real `status_text` is 114):

```ts
// src/core/messaging/reconcile.ts
function providerVerdictCorpus(entry: SmsHistoryEntry): string {
  return [entry.status, entry.statusText, entry.statusCode, entry.errorText]
    .filter((f) => f !== null && f !== undefined && String(f).trim() !== '')
    .map((f) => codeOf(String(f)))
    .join(' ');
}

if (isOptOutCode(providerVerdictCorpus(entry))) {
  optedOutLedgerIds.push(outcome.ledgerId);
}
```

Better still, export that corpus builder from `receipts.ts` so there is one answer to "what
did the provider say about this message", asked from both places — the same argument
`receipts.ts` makes about `codeOf` itself. Then replace the invented fixture with the two
captured payloads already recorded in the doc, plus one synthesised opt-out whose token sits
in `status_text` rather than `status`.

---

#### CR-03: A `setOutcome` failure aborts the whole tick and permanently abandons the remaining claimed sends

**Severity:** BLOCKER
**File:** `src/core/cadence/dispatch.ts:514-543`, `:562-579`

**Issue:**
`performSends` wraps `sender.send()` in a try/catch, but not the ledger write that follows it:

```ts
await forTenant(send.tenantId).ledger.setOutcome(send.ledgerId, recorded, …);
```

and `dispatchDueTouches` invokes `performSends` **outside** the try/catch that gives the loop
its per-tenant isolation:

```ts
let claim;
try {
  claim = await claimForTenant(tenant, options);   // guarded
} catch { … continue; }
…
await performSends(claim.pending, options.sender); // UNGUARDED
```

So one transient driver error on one `setOutcome` — a pooler hiccup, a statement timeout —
throws out of `performSends`, out of `dispatchDueTouches`, and out of the tick. Two distinct
losses:

1. **Within the current tenant**, every remaining `PendingSend` in `claim.pending` is skipped
   entirely. Those touches were already marked `sent` and their ledger rows already claimed
   inside the committed transaction, so they now sit at `outcome IS NULL` forever, and the
   file's own at-most-once rule (header, "AT-MOST-ONCE, ON PURPOSE") means they are never
   auto-resent. The customer simply does not get the follow-up, and nothing reports it beyond
   a NULL column.
2. **Across tenants**, the whole remaining tenant list is skipped for this tick — directly
   contradicting the stated invariant at `:546-552`: "one client's broken configuration cannot
   stop the other fourteen from being followed up." One tenant's DB error is exactly that.

**Fix:**
Guard both. Per-send, so one bad ledger write cannot cost the sends behind it; and per-tenant,
so the loop keeps its documented isolation:

```ts
// performSends
if (!outcome) continue;
const recorded: SendLedgerOutcome = …;
try {
  await forTenant(send.tenantId).ledger.setOutcome(send.ledgerId, recorded, …);
} catch {
  // The message HAS gone out. Leaving `outcome` NULL is the honest record; losing the
  // remaining sends because of it is not.
  console.error(
    `[cadence] could not record the outcome for ledger ${send.ledgerId}; ` +
      'the send happened and the row is left NULL — surfaced, never auto-resent.',
  );
}
```

```ts
// dispatchDueTouches
try {
  await performSends(claim.pending, options.sender);
} catch {
  console.error(`[cadence] send pass failed for tenant ${tenant.tenantId}; continuing.`);
}
```

---

### Warnings

#### WR-01: The DLR route reads the request body without the guard the inbound route documents

**Severity:** WARNING
**File:** `src/app/api/webhooks/clicksend/dlr/route.ts:161`

**Issue:** `const payload = decodeBody(await request.text());` is unwrapped. The inbound route
one directory over guards the identical call (`inbound/route.ts:163-171`) and explains why:
"The stream itself failed — an aborted upload, a truncated request." Here that throws, becomes
a 500, and the DLR route's own header states the cost of a non-2xx to this provider —
"their retry behaviour on an error is to keep re-delivering for up to 72 hours and to THROTTLE
the rule after repeated failures". A truncated body therefore degrades delivery of every other
client's receipts, which is the exact outcome the route was designed to avoid.

**Fix:**
```ts
let text: string;
try {
  text = await request.text();
} catch {
  console.warn('[clicksend] dlr body could not be read; acknowledged 200.');
  return received();
}
const payload = decodeBody(text);
```

---

#### WR-02: `classify` treats any `ERROR` substring as dispositive failure, including in a field the provider populates on success

**Severity:** WARNING
**File:** `src/core/messaging/receipts.ts:144-157`, `:194`, `:260-265`

**Issue:** `UNDELIVERED_CODES` contains the bare token `ERROR`, failure is checked before
success (`:194`), and `error_text` is deliberately part of the corpus (`:261`) — while the
file's own header records that "ClickSend populates `error_code` AND `error_text` on a
SUCCESSFUL delivery". The two facts only coexist safely because the one observed success
happened to carry `error_text: 'Message delivered to the handset'`. A success whose
`error_text` reads `No error`, `Error: none`, `0 errors` or similar collapses to
`NO_ERROR` / `ERROR_NONE` under `codeOf` and is recorded `undelivered` — on the column an
operator triages from and Phase 7 reads, silently, and in the same direction as the bug
`c47dd1d` was written to fix. The ordering makes it one-way: no amount of `DELIVERED` in the
corpus can rescue it.

**Fix:** Do not let a generic token from a field the provider fills on success be dispositive.
Either drop `ERROR` from `UNDELIVERED_CODES` and rely on the specific tokens (`FAILED`,
`REJECTED`, `EXPIRED`, `UNDELIV…`), or scope the corpus per field:

```ts
// status / status_text / status_code decide; error_text is consulted ONLY when the
// status fields carry no recognisable token at all.
const statusCorpus = [receipt.status, receipt.status_text, receipt.status_code] …;
const status = classify(statusCorpus) === 'unknown'
  ? classify(codeOf(String(receipt.error_text ?? '')))
  : classify(statusCorpus);
```

---

#### WR-03: `From` and `Reply-To` addresses are not sanitised for header injection, only the display name is

**Severity:** WARNING
**File:** `src/core/messaging/resend-sender.ts:172-185`, `:227-235`, `:383-393`; `src/core/messaging/resend-domains.ts:208-214`

**Issue:** `displayName()` strips C0 controls, `"`, `<`, `>` and `\` from `businessName` and the
comment correctly names the reason ("A CR or LF in a header value is an INJECTED HEADER (`Bcc:`
being the obvious one)"). The two values interpolated into the *same* header string get no such
treatment:

```ts
from: `"${business} via Quote Recovery" <${identity.fromAddress}>`,
replyTo: identity.replyTo,
```

Their only gate is `usableIdentity` → `isAddress` → `domainOfAddress`, which splits on `@`,
lowercases, and requires a `.` in the domain — it accepts `dave@example.com\nBcc: victim@x.com`
without complaint (one `@`, non-empty local, dotted domain). Today the only writer is
`saveEmailConfigAction`, whose `z.email()` rejects newlines, and `setup-clicksend.mjs` writes
NULL — so this is a defence-in-depth gap rather than a live exploit. But it is the layer the
file claims to be ("this is the same rule enforced where the message is actually built"), and
the `messaging_config` table is service-role writable from a script.

**Fix:** Sanitise where the message is built, not only where the form is parsed:

```ts
const HEADER_UNSAFE = /[ -"<>\\,;]/;

function isHeaderSafeAddress(value: string): boolean {
  return !HEADER_UNSAFE.test(value) && domainOfAddress(value) !== null;
}
// in usableIdentity:
if (!isHeaderSafeAddress(fromAddress) || !isHeaderSafeAddress(replyTo) || businessName === '')
  return null;
```

---

#### WR-04: The inbound webhook's stated forgery blast radius understates an irreversible, all-tenant, attacker-chosen suppression

**Severity:** WARNING
**File:** `src/app/api/webhooks/clicksend/inbound/route.ts:26-33`; `src/core/messaging/inbound.ts:380-410`; `src/core/cadence/controls.ts:405-429`

**Issue:** The route header enumerates what a forged request can do and concludes: "the worst
outcome of a forgery is that a cadence STOPS, which is the direction this system is allowed to
fail in." That is not the worst outcome. `handleNoMatch` on an unmatched STOP calls
`suppressBareContact(await forAllTenants_ids(), …)`, which writes a `suppressed_contacts` row
for **an attacker-chosen mobile number, for every tenant in the system**, under a mechanism
`controls.ts` and `suppressed-contacts.ts` make irreversible at three layers (no unsuppress
function, no repository mutator, no grant). Anyone holding `CLICKSEND_WEBHOOK_SECRET` can walk
the AU mobile space and permanently blacklist arbitrary numbers across all fifteen clients,
including numbers those clients have never quoted, with the only record being `unmatched` rows
on the triage screen.

The token is a URL query parameter by necessity — the file correctly notes it "appears in access
logs at every hop" and it is additionally stored in plaintext in ClickSend's account
configuration (`action_address`). So "somebody else holds it" is a state to survive, exactly as
`delivery-receipts.ts` says of its own token — and that file's answer (an UPDATE with an exact-
match predicate, no insert path) is the standard this one does not meet.

**Fix:** Two options, both cheap; take at least the first.

1. Rate-bound the fan-out. A single request that suppresses N tenants is fine; a source that
   does it repeatedly is not. Record and cap unmatched-STOP fan-outs per window, and alert the
   operator past the cap — a legitimate volume here is a handful per week.
2. Restore the stated invariant by narrowing the fan-out to tenants that have *ever* held a
   cadence or quote contact for that normalized mobile, falling back to full fan-out only when
   that set is empty. That preserves D-03's compliance direction for real customers while
   removing "suppress a number nobody has ever contacted" from a forger's reach.

Either way, correct the route header: it is currently a security argument that does not match
the code beneath it.

---

#### WR-05: `verifyDomainAction` passes an unvalidated caller-supplied string into the Resend API path

**Severity:** WARNING
**File:** `src/app/(console)/settings/email/actions.ts:143-148`

**Issue:**
```ts
const id = readString(formData, 'domain_id');
if (id === '' || id.length > 64) { … }
const result = await verifyDomain(id);
```
The only checks are non-empty and ≤64 characters. `verifyDomain` interpolates it into a Resend
SDK path (`/domains/{id}/verify`) using an account-wide API key. Every other identifier in this
codebase that reaches a query or a provider path is UUID-shaped first — `markHandledAction`
(`inbox/actions.ts:20`), `saveEmailConfigAction` (`:36`), `updateDeliveryWhereMatch`
(`delivery-receipts.ts:55`), each with a comment explaining why. This one is not, and the file
it lives in opens by stating that "Every export of a `'use server'` module is a globally-POSTable
endpoint whose id is reachable from any route" and that two of these "spend money at a third
party". Path segments like `..%2f` are the obvious probe.

**Fix:** Reuse the pattern already declared at the top of the same file:
```ts
if (!UUID_PATTERN.test(id)) {
  return { ...BLANK_EMAIL_SETTINGS_STATE, error: 'That domain could not be found.' };
}
```
(Resend domain ids are UUIDs; if that ever changes, an explicit `^[A-Za-z0-9-]{1,64}$` is the
minimum.)

---

#### WR-06: The inbound payload schema will dead-letter every reply if `message_id` arrives as a number

**Severity:** WARNING
**File:** `src/app/api/webhooks/clicksend/inbound/route.ts:106-113`; contrast `src/core/messaging/clicksend-client.ts:346-364`

**Issue:** The inbound webhook declares `message_id: z.string().optional()`. The list schema for
the *same provider field* in `clicksend-client.ts` declares
`message_id: z.union([z.string(), z.number()]).nullish()`, and `receipts.ts:89` states the reason
in general terms: "a provider that sends `"1756351200"` and a provider that sends `1756351200`
are the same provider on different days". If ClickSend ever emits a numeric `message_id` on the
inbound callback, `safeParse` fails and **every customer reply becomes a `dead_letter`** —
`is_stop` false, `normalized_from` NULL, no threading, no suppression, no pause — recoverable
only by the next daily sweep, up to 24 hours later, for a STOP. The route header itself rates
the payload shape as under-documented and builds the entire dead-letter mechanism around that
uncertainty; hard-typing one field against that uncertainty is the one place the tolerance
lapses.

**Fix:**
```ts
const inboundPayload = z.looseObject({
  from: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  body: z.union([z.string(), z.number()]).transform(String),
  to: z.union([z.string(), z.number()]).transform(String).optional(),
  message_id: z.union([z.string(), z.number()]).transform(String).optional(),
});
```

---

#### WR-07: The `provider_message_id` fallback predicate is not unique, and a multi-row match is reported as a single `applied`

**Severity:** WARNING
**File:** `src/db/repository/delivery-receipts.ts:95-125`; `src/core/messaging/receipts.ts:280-281`

**Issue:** When `custom_string` is absent or malformed, the update falls through to
`eq(sendLedger.providerMessageId, providerMessageId)`. There is no unique index on that column —
`inbound-messages.ts:65-78` makes precisely this argument about the same id space ("it is a third
party's identifier … a uniqueness assumption about somebody else's id space is exactly the kind of
thing that turns a duplicated provider callback into a 23505"). So one callback can stamp several
`send_ledger` rows, potentially across tenants. `applyDeliveryReceipt` then reads
`const applied = rows[0]` and reports `{ kind: 'applied', ledgerId }` for the first — the fan-out
is invisible, and in the reconcile path the same single id is the one fed to `recordOptOuts`.

**Fix:** Report the fan-out rather than hide it, and make it visible in the sweep:
```ts
const rows = await updateDeliveryWhereMatch({ … });
if (rows.length > 1) {
  console.warn(
    `[messaging] a delivery receipt matched ${rows.length} ledger rows on provider id; ` +
      'provider_message_id is not unique — the rows are stamped, the ambiguity is not.',
  );
}
return rows[0] ? { kind: 'applied', ledgerId: rows[0].id } : { kind: 'unmatched' };
```
Consider also a partial unique index on `send_ledger (provider_message_id) WHERE provider_message_id IS NOT NULL`
so the assumption is enforced rather than hoped for.

---

#### WR-08: An enabled email row on a deployment missing `APP_BASE_URL` produces silent stub sends with no refusal reason

**Severity:** WARNING
**File:** `src/core/messaging/routing-sender.ts:240-253`; `src/core/messaging/resend-sender.ts:426-439`

**Issue:** `chooseEmailSender` returns the stub when `apiKey`, `appBaseUrl` or `signingSecret` is
missing. `APP_BASE_URL` is `z.url().optional()` in `env.ts` and `docs/external-registrations.md`
records it as having been genuinely **absent from Vercel Production** on 2026-08-29. In that
state, an enabled email row yields `sender = 'stub'` / `outcome = 'stub_sent'` — no
`email_not_configured` ledger reason, no log line, nothing on any screen. The per-tenant arm gets
this right (`ResendSender.attempt` records `email_not_configured` for the same condition at
`:316-321`), the deployment-level gate does not.

**Fix:** Make the deployment-level miss loud, since it affects every client at once:
```ts
if (!apiKey || !appBaseUrl || !signingSecret) {
  console.error(
    '[messaging] an ENABLED email config exists but this deployment cannot build a ' +
      'compliant message (missing api key, base url or signing secret); falling back to ' +
      'the stub. No email will be sent until this is fixed.',
  );
  return fallback;
}
```
(Only log when `config?.enabled` is true, so an unconfigured deployment stays quiet.)

---

#### WR-09: The verified-domain check is enforced only at save time, never at send time

**Severity:** WARNING
**File:** `src/core/messaging/routing-sender.ts:195-211`

**Issue:** `saveEmailConfigAction` refuses to store a from-address whose domain is not
`VERIFIED_STATUS` at Resend, and its comment argues the check "is server-side, and that is the
point (T-4-26)" because "mail without aligned SPF/DKIM is rejected or spam-foldered … the visible
symptom is a client's follow-ups silently not arriving". Domain status is not static: DNS records
get deleted, DKIM keys get rotated, Resend moves a domain to `failed`/`temporary_failure`.
`resolveEmailIdentity` re-reads the row at send time but never re-asks the question the row was
gated on, so the exact symptom the action guards against reappears with no gate in front of it.

**Fix:** Either cache the verified-domain list once per tick in `buildRoutingSender` and pass a
`domainIsVerified` predicate into `ResendSender` (a `verified_domain_unavailable` refusal is
strictly better than a spam-foldered send), or record the verification status on the
`messaging_config` row at save time plus a periodic re-check. At minimum, document the gap in
`routing-sender.ts` so it is a known limit rather than an assumed guarantee.

---

#### WR-10: Inbound replay dedupes on an id space that is not proven to be shared, and dead letters carry none

**Severity:** WARNING
**File:** `src/core/messaging/reconcile.ts:239-256`

**Issue:** `if (entry.messageId && (await findInbound(entry.messageId)).length > 0) continue;`
is the only dedupe. Two ways it silently fails open:

1. The webhook stores `providerMessageId` from the callback's `message_id`; the sweep compares
   against `/sms/history`'s `message_id`. `docs/external-registrations.md` confirms the shape of
   the history field but explicitly records that the DLR/inbound *callback* body shape "is STILL
   unobserved". If the two id spaces differ in format, every message in the rolling 48-hour window
   is replayed on every sweep — forever.
2. `deadLetter()` in the inbound route writes `providerMessageId: null` unconditionally
   (`inbound/route.ts:229`), so any message that dead-lettered is re-handled by every subsequent
   sweep within the window.

Each replay re-runs `handleInboundSms`: a new `inbound_messages` row on the triage screen, another
`pauseForReply` (idempotent), and for an unmatched STOP another full all-tenant
`suppressBareContact` fan-out. The header calls a duplicate "a second row on the triage screen",
which understates a daily recurrence.

**Fix:** Add a second dedupe key that does not depend on a third party's id format — e.g. skip
rows whose `(normalized_from, body, received_at within ±N minutes of the history `date`)` already
exists — and count the skips. Then instrument it: `ReconcileResult` should carry
`inboundSkippedAsDuplicate` so a runaway replay is a number an operator sees, not a screen that
slowly fills.

---

#### WR-11: `setup-clicksend.mjs` can print the DLR callback token if ClickSend echoes the URL under any key but `action_address`

**Severity:** WARNING
**File:** `scripts/setup-clicksend.mjs:585-589`

**Issue:**
```js
const echoed = { ...dlr.rule };
if (echoed.action_address) echoed.action_address = mask(echoed.action_address);
console.log(`   DLR rule as ClickSend stored it: ${JSON.stringify(echoed)}`);
```
This dumps the whole rule object, masking exactly one known key. The block exists *because* "the
receipts-rule field set is the least-documented thing here" — i.e. precisely because the key set is
unknown. Any additional key carrying the URL (`url`, `callback_url`, `webhook_url`, a nested
object) prints `CLICKSEND_DLR_SECRET` verbatim into terminal scrollback and CI logs, defeating the
file's own stated rule ("Nothing here prints a secret").

**Fix:** Mask by value, not by key name:
```js
function scrub(value) {
  const s = JSON.stringify(value);
  return s.replaceAll(process.env.CLICKSEND_DLR_SECRET, '<dlr-token>')
          .replaceAll(process.env.CLICKSEND_WEBHOOK_SECRET, '<inbound-token>');
}
console.log(`   DLR rule as ClickSend stored it: ${scrub(dlr.rule)}`);
```

---

#### WR-12: `push-vercel-env.mjs` can resolve its promise twice, and `--public` values travel in argv against the file's own rule

**Severity:** WARNING
**File:** `scripts/push-vercel-env.mjs:165-174`, `:92-95`

**Issue:** Two smaller defects in a file whose whole purpose is careful handling.

1. `child.on('error', …)` and `child.on('close', …)` both call `resolve`. On a spawn failure Node
   emits `error` and then `close`, so the second resolution is discarded silently — harmless today,
   but it means the reported `detail` is whichever fired first, and a future `reject` or side effect
   added to either handler becomes order-dependent.
2. The header states the rule "never passed as `--value` (argv is world-readable via `ps`)" and then
   `--public NAME=value` does exactly that. The values in question are config rather than secrets
   (`APP_BASE_URL`), so the risk is low — but the file's rule is stated absolutely and the code has
   an exception, which is how the exception grows.

**Fix:** Guard the resolve (`let settled = false;`) and either read `--public` names from the
environment like the positional ones, or narrow the header's claim to "no *secret* is passed as an
argument, and `--public` is for values that are safe in `ps`".

---

### Info

#### IN-01: Dead `UUID_PATTERN` re-check after `z.uuid()` has already validated the same field

**File:** `src/app/(console)/settings/email/actions.ts:36`, `:214-216`
**Issue:** `configSchema` declares `tenant_id: z.union([z.literal(''), z.uuid()])`, so by the time
`if (tenant_id !== '' && !UUID_PATTERN.test(tenant_id))` runs the branch is unreachable. Two
answers to "is this a uuid" in one function is the drift this codebase elsewhere argues against.
**Fix:** Delete the second check and the now-unused `UUID_PATTERN` constant, or drop `z.uuid()` and
keep the regex — one of them, not both.

---

#### IN-02: `cancel`, `end` and `quit` are treated as irreversible opt-outs on their own

**File:** `src/core/messaging/stop-keywords.ts:65-66`
**Issue:** The file's own risk analysis is that "a false positive costs a customer permanently"
because the resulting `suppressed_contacts` write is irreversible. `cancel` as a whole message is at
least as likely to mean "cancel the job/quote" as "stop messaging me" — a quote-recovery product is
the one context where that ambiguity is maximal. `end` and `quit` are less common but carry the same
one-way consequence.
**Fix:** Keep them (the Spam Act direction is right) but make the ambiguous subset visible: record
which keyword matched on the `inbound_messages` row so an operator triaging a suppression months
later can see it was `cancel` rather than `STOP`.

---

#### IN-03: The alternation-ordering comment describes a failure the regex engine does not have

**File:** `src/core/messaging/stop-keywords.ts:44-49`
**Issue:** The comment claims that with `stop` first, `"STOP ALL"` "would match `stop` and then fail
on the leftover ` ALL`, making a MORE emphatic opt-out the one that does not register". JavaScript's
engine backtracks into the remaining alternatives, so `stop\s*all` would still match either way. The
ordering is harmless and arguably clearer; the justification is wrong, and a wrong mechanism in a
comment is what a future reader reasons from.
**Fix:** Reword to "ordered longest-first for readability; backtracking makes either order correct."

---

#### IN-04: `routing-sender.ts` documents a per-tenant gate that `buildRoutingSender` does not perform

**File:** `src/core/messaging/routing-sender.ts:119-124`
**Issue:** "NOTE THE ORDER OF THE `enabled` CHECK relative to the tenant lookup in
`buildRoutingSender`: `getChannelConfig` returns the tenant's OVERRIDE row when one exists…" —
`buildRoutingSender` calls `getChannelConfig('sms')` with no tenant argument, so no override is ever
consulted at that gate. See CR-01. Flagged separately because the comment will still be wrong after
CR-01 is fixed unless it is rewritten alongside.
**Fix:** Rewrite as part of the CR-01 change to describe the gate that actually exists.

---

#### IN-05: `escapeHtml` omits `'`, and the unsubscribe link is interpolated unescaped into an `href`

**File:** `src/core/messaging/resend-sender.ts:188-194`, `:244`
**Issue:** `` `<a href="${link}">` `` takes `link` raw. It is safe only because `APP_BASE_URL` is
`z.url()`-validated and the token is base64url + `encodeURIComponent`. That is an argument about two
other modules, not a property of this one, and `escapeHtml` — which exists two lines above — does not
handle `'` either.
**Fix:** `` `<a href="${escapeHtml(link)}">` `` and add `.replace(/'/g, '&#39;')` to `escapeHtml`.
Both are free.

---

#### IN-06: A missing `UNSUBSCRIBE_SIGNING_SECRET` turns the uniform-200 endpoint into a 500

**File:** `src/app/api/unsubscribe/route.ts:181-185`
**Issue:** `getServerEnv()` is called inside `POST`, and only on the branch where a token was
supplied. On a deployment missing the secret it throws, producing a 500 — a response an attacker can
distinguish from the 200 that the route's entire "EVERY ANSWER IS THE SAME ANSWER (T-4-20)" design
rests on, and one that also distinguishes "token present" from "token absent". `env.ts` marks the
variable required so this needs a broken deployment; the token module's own header nonetheless makes
the "never throw, this must not be an oracle" argument explicitly.
**Fix:** Wrap the env read so the route degrades to the same 200:
```ts
let secret: string | null = null;
try { secret = getServerEnv().UNSUBSCRIBE_SIGNING_SECRET; } catch { secret = null; }
const subject = token && secret ? verifyUnsubscribeToken(token, secret) : null;
```

---

#### IN-07: The two `provider_message_id` lookups have no supporting index

**File:** `src/db/migrations/0025_inbound_messages.sql:72`; `src/db/migrations/0026_messaging_config_delivery.sql:82-85`
**Issue:** `findInboundByProviderMessageId` (`inbound-messages.ts:80-88`) is called once per polled
history row on every sweep, and `updateDeliveryWhereMatch`'s fallback predicate hits
`send_ledger.provider_message_id` — neither column is indexed. Noted as correctness-adjacent rather
than as a performance point: the sweep runs inside a cron-invoked function with a 300s ceiling, and
a sequential scan per row is how that ceiling is eventually reached silently.
**Fix:** `CREATE INDEX inbound_messages_provider_message_id_idx ON inbound_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;`
and the equivalent on `send_ledger`.

---

_Reviewed: 2026-08-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
