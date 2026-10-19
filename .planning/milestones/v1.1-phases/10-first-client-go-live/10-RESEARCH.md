# Phase 10: First-Client Go-Live - Research

**Researched:** 2026-09-11
**Domain:** Console-gated arming of production messaging (`messaging_config`), evidence-bearing live proofs on the hosted Sydney Supabase, ServiceM8 own-comms re-measure, operator runbook
**Confidence:** HIGH on the codebase mechanics (every claim below was read from source this session, cited `file:line`); MEDIUM on the two third-party facts that matter (ClickSend balance endpoint, Resend inbound); LOW only where flagged `[ASSUMED]`

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### The gate shape (the roadmap's open question)
- **D-01:** Two states, not one. **Armed** means `messaging_config` has an `enabled = true` row for the channel (tenant row, or the global sms row v1 shares). **Live** means armed AND the channel's live proof is recorded. The checklist (ARM-01) shows both. Arming (ARM-02) is gated on the *onboarding* items only: templates attested, SM8 automation-off attested, escalation phone set, contact hours set, and — for email — sending domain verified. The two proof items are NOT arming preconditions (they cannot be, since the proofs need the channel armed); they gate the **Go live** state and the runbook's final step. This resolves the ARM-01/ARM-02/ARM-03 circularity the roadmap flagged without inventing a "supervised first-arm mode".
- **D-02:** Proof recording is explicit and evidence-bearing: a `tenant_proofs` (or reuse of `tenant_attestations` with new kinds `escalation_handset_proof` and `email_pipe_proof`) row written by an operator action that requires the operator to paste the observable artefact id (the escalation row id / provider message id for SMS; the send-ledger id + inbound message id for email). No proof row without an artefact id. The checklist reads "recorded on {date}" from that row.

#### Arming from the console (ARM-02)
- **D-03:** Arm/disarm is a server action on the client page (`(console)/clients/[id]`), one control per channel (SMS, email), writing through `upsertChannelConfig` — never raw SQL. SMS in v1 arms the **global** row (tenant_id NULL, from `+61491579212`) because every founding client shares the number; the control must say so plainly ("arms SMS for every connected client on the next tick") and the runbook must too. Email arms the **tenant** row (from-address on the verified `quotes.backdesk.com.au` domain, reply-to the tradie's business email, business name), created by the existing `/settings/email` flow.
- **D-04:** Every arm/disarm is audited: a `messaging_config_audit` table (channel, tenant_id nullable, action arm|disarm, operator user id, reason text required on disarm and optional on arm, created_at) written in the same transaction as the upsert. The client page shows the last three audit rows. `requireOperator()` first, as every mutating action does.
- **D-05:** Arming is refused (not just hidden) while any gating item is incomplete: the action re-reads the checklist conditions server-side (`readOnboardingConditions` + domain verification + escalation phone + contact hours) and returns the fixed refusal sentence naming the first missing item. Disarming is never gated.

#### The two live proofs
- **D-06 (CON-03 / ARM-03):** Executed on production with the founding client's real ServiceM8 account and the operator's own handset standing in as the tradie's escalation phone for the proof if the client prefers (recorded which). Sequence: SMS armed → a real customer-style reply arrives on the dedicated number (the operator sends it from a second handset) → the escalation tick sends the escalation SMS → the escalation row shows `sent` with a provider message id → proof recorded via D-02. Never manufacture rows in the production database by SQL; the proof is produced by the product's own paths.
- **D-07 (MSG-02 / DOM-04):** Executed on production through the real `TouchSender` path: `scripts/verify-email-pipe.mjs --tenant <id> --to <address>` (built in Phase 4, refuses `onboarding@resend.dev`) sends ONE real email from the tenant's verified identity to an operator-controlled inbox; then a reply from that inbox threads to the quote (inbound email path); then the one-click unsubscribe is exercised and both channels show suppressed for that contact. Evidence: send-ledger row, delivery receipt, inbound row, suppressed_contacts rows — recorded in the phase verification and via D-02.
- **D-08:** Both proofs are **event-gated on a signed founding client** whose ServiceM8 account is connected. If no client has signed when the phase executes, the plans up to and including the console work complete; the two proof plans stop at a `checkpoint:human-action` ("founding client signed and connected") and the phase closes only when they run. The runbook is written regardless.

#### ServiceM8 own-comms re-measure (ARM-04)
- **D-09:** On the founding client's connected account (or the trial account with a seeded native follow-up), run `node scripts/sm8-spike.mjs probe` to capture a non-empty `sms.json` / `email.json` row; record the field list in `docs/servicem8-api-notes.md` §"ServiceM8 own-comms (D-13)"; decide whether Tier 1 drift detection becomes designable (needs a job UUID + send timestamp on the row) and record the decision — no Tier 1 code is written in this phase unless the shape makes it a small addition to the existing staleness nag.

#### Runbook (ARM-05)
- **D-10:** `docs/first-client-go-live-runbook.md`: from signed founding agreement → ServiceM8 private API key from the client → connect → templates in the client's voice approved and attested → SM8 automation-off attestation → contact hours + escalation phone → email identity added and domain verified (or the shared service domain) → **ClickSend balance check** (the first live SMS in Phase 9 failed with INSUFFICIENT_CREDIT) → arm SMS → CON-03 proof → arm email → MSG-02 proof → mark live → first cadence send observed on the queue → what to watch in week 1 (stall digest, opt-out rate, escalation). Each step names the console screen or script and the artefact that proves it. It also lists the operational housekeeping found in Phase 9: decline the two UAT `audit_requests` rows, confirm Supabase Auth URL config, keep the Resend key Full access.

#### Operational facts to carry (from Phases 8–9)
- **D-11:** Production is the hosted Sydney Supabase; never `test:remote` during go-live windows; `npm run cron:status` before any cron change; the proxy now runs (Phase 9) and costs a `getClaims()` per console request — fine, but note it.
- **D-12:** Operator alerts go to `OPERATOR_ALERT_PHONE` / `OPERATOR_ALERT_FROM` (Phase 8/9); the event-gated Phase 8 UAT item ("alert From header reads Backdesk <alerts@quotes.backdesk.com.au>") is confirmed by the first real alert during this phase and recorded.

### Claude's Discretion
- Whether proofs live in `tenant_attestations` (new kinds) or a new `tenant_proofs` table; the audit table's exact columns; where the arm/disarm controls sit on the client page (the checklist card is the natural home); the runbook's exact section order.

### Deferred Ideas (OUT OF SCOPE)
- M1 §5 messaging copy (SMS footer, email From format, expanded footers) — founder decision pending
- Per-client dedicated numbers; OAuth + webhooks — v1.2
- Tier 1 SM8 automation drift detection — only if ARM-04's shape makes it designable
- Sampled review mode after 30 days of edit-rate data — V2-01
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARM-01 | Per-client checklist shows the full go-live state: templates attested, SM8 automation-off attested, escalation phone set, contact hours set, sending domain verified, escalation handset proof recorded, SMS arming state, email arming state | Q1: `readOnboardingChecklist` already computes 6 keys (`checklist.ts:105-112`); extend `CHECKLIST_ITEM_KEYS` to 9–10 keys; new readers for domain-verified (`listDomains()` + `domainOfAddress`), per-channel armed (`resolveSmsFrom`/`resolveEmailIdentity` split), escalation phone (`normalizeAuMobile(tenant.escalationPhone)`), and proofs (new `tenant_proofs.latest(kind)`). Card `ITEM_LABELS`/`ITEM_FIX` are `Record<key,…>` so new keys are compile errors until labelled |
| ARM-02 | Arm/disarm SMS and email from the console writing `messaging_config`; arming blocked until every checklist item is complete; every arm/disarm audited with operator, timestamp, reason | Q3/Q4: `upsertChannelConfig` is the only write path (`messaging-config.ts:193`); new `armChannel()`/`disarmChannel()` repository functions wrap upsert + `messaging_config_audit` insert in one `getDb().transaction`; `requireOperator()` needs an id-returning sibling; D-05 refusal re-reads the same `readGoLiveChecklist` the card renders |
| ARM-03 | CON-03 live escalation handset proof executed on production and recorded | Q5: exact production sequence through product paths; escalation row `outcome='sent'` + `provider_message_id` (`escalate-hot-leads.ts:299`); artefact surfaced by a read-only script; proof row via D-02 |
| ARM-04 | `sms.json`/`email.json` row shape re-measured on a live account; D-15 detection updated if changed; recorded in `docs/servicem8-api-notes.md` | Q7: `node scripts/sm8-spike.mjs probe` reads `SM8_TEST_API_KEY` (`sm8-spike.mjs:30`) — needs the founding client's key exported for one run, or a seeded native follow-up on the trial account; records field names only |
| ARM-05 | Written go-live runbook in `docs/` from signed agreement to first cadence send, referencing the checklist and both proofs | Q8: every step mapped to a console screen or read-only script and the artefact it produces; ClickSend balance via `GET /v3/account` → `data.balance` + `data._currency.currency_name_short`; Supabase Auth URL config; decline the two UAT `audit_requests` rows |
| DOM-04 | MSG-02 live email proof on the verified domain: send, delivery, inbound reply threaded to the quote, RFC 8058 one-click unsubscribe suppressing both channels; evidence recorded | Q6: **the "inbound reply threaded" clause cannot be met by existing code** (no inbound email path; reply-to is the tradie by D-01) and the script's unsubscribe link is deliberately inert (`verify-email-pipe.mjs:148`). Smallest honest scope proposed with estimates; wording revision recommended |
</phase_requirements>

## Summary

Phase 10 is mostly *assembly* of mechanisms that already exist and were live-proven in v1.0, plus one new evidence table pair and one arming action with an audit trail. The checklist core (`src/core/onboarding/checklist.ts`) already derives six items from the same readers the activation gate uses; the console card already renders them from a `Record` over the key union, so extending to the nine ARM-01 items is a typed change in two files plus new readers. `messaging_config` already has the only write path (`upsertChannelConfig`), the `NULLS NOT DISTINCT` arbiter that makes "exactly one global row" a database fact, and the per-tenant resolvers (`resolveSmsFrom`, `resolveEmailIdentity`) that decide what "armed for this client" means — a tenant row with `enabled=false` is an explicit OFF that beats the global ON, which is the tool for keeping the Phase 4 test tenant quiet when the global SMS row is armed for the founding client.

Two findings change what the planner can honestly promise. First, **v1 cadences never produce an email touch**: `ensureDefaults` seeds SMS timing rows only, `approvedSetStatus()` is SMS-only, and the drafting pass skips any non-SMS touch (`draft-touches.ts:769`). "Email armed" therefore wires the real `ResendSender` and resolves an identity, but no cadence email will leave production in v1 — the only customer-shaped email the product can send today is `scripts/verify-email-pipe.mjs`. Second, **there is no inbound email path**: `src/app/api/webhooks/` holds only `clicksend/` and `servicem8/`, `handleInboundSms` is SMS-only, and D-01 sends replies to the tradie's own address by design. DOM-04's "inbound reply threaded to the quote" clause is unmeetable without building a Resend Receiving route (an `inbound.` MX, a webhook, a body fetch, and a reversal of D-01) — a v1.2-sized change. The script's one-click link is also deliberately minted over a random cadence id so a click writes nothing. The recommendation is to revise DOM-04 to what the code can prove live (send from the verified identity, Resend `last_event=delivered`, headers/footer verified in a real mail client, the one-click POST answered live on production) and, if the planner wants a live suppression, a `--cadence` flag on the script exercised against a deliberately created test cadence — with both-channel suppression semantics already pinned by `tests/unsubscribe-suppression.test.ts`.

The Phase 4 OWED/RESTORE items in STATE.md are stale: the same file records them RESOLVED on 2026-08-30 (`STATE.md:478-480`) — window restored, contact mobile restored by the sync itself, zero live cadences, global SMS row disarmed. Nothing needs tearing down. What does need care is that the test tenant `13e8f2aa` is still connected to a live ServiceM8 trial account with eligible quotes, and that the operator's handset that texted STOP on 2026-08-30 sits in ClickSend's account-level Opt-Out List (04-07 A3 finding) — both are pre-arm runbook checks.

**Primary recommendation:** Ship one migration (`0036`) carrying `tenant_proofs` (kind CHECK, `artefact_id` NOT NULL, `recorded_by` NOT NULL) and `messaging_config_audit`; add `armChannel`/`disarmChannel` to `src/db/repository/messaging-config.ts` as the transactional writer; extend `checklist.ts` to a `readGoLiveChecklist` that the card, the arming action, and the proof actions all read; and revise DOM-04's wording before the proof plan is written so the phase does not close on a clause no code can satisfy.

## Project Constraints (from CLAUDE.md)

| Directive | Consequence for this phase |
|-----------|----------------------------|
| Tech stack: TypeScript, Next.js 16 (App Router, `proxy.ts`), Supabase Sydney, drizzle-orm + drizzle-kit migrations | New tables via drizzle schema files + one hand-finished migration; no Prisma; migrations run with `npm run db:migrate` over the session connection (5432) |
| `zod` v4 everywhere data crosses a boundary | Arm/disarm/proof server actions validate `FormData` with zod (`z.uuid()`, bounded strings) before any write |
| Never free-text LLM classification | Untouched — the escalation proof reads stored `is_hot`, never re-derives |
| Compliance: Spam Act sender ID + functional opt-out; DNCR contact hours | Arming copy must name the blast radius; the proof email keeps the identity line and RFC 8058 headers; contact-hours item stays a gate |
| Budget ≤ ~$200/mo; no paid infra beyond Supabase/Vercel/SMS/Anthropic | No new services. Resend Receiving (if ever built) is on the existing account |
| Dedicated virtual number, shared across founding cohort; tradie identified in copy | The global SMS row is the v1 identity; D-03 arms it; per-client numbers are v1.2 |
| GSD workflow enforcement: edits only through GSD commands | Planner produces PLAN.md files; executor edits; no ad-hoc repo edits |
| "Vercel `waitUntil` for sends" banned; sends are must-happen work | Proofs ride the existing per-minute pg_cron ticks; no new send path |
| Operator-only console; RLS as defence-in-depth; service-role in server code | New tables get `pgPolicy` + REVOKE/GRANT blocks in the migration and rows in `tests/rls-coverage.test.ts`'s exact-grants map |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Go-live checklist derivation (9 items) | API / Backend (`src/core/onboarding/checklist.ts`) | Frontend Server (client page renders) | One derivation feeds card, arming refusal, and proof gating — the `deriveHealth` one-derivation rule (`checklist.ts` header) |
| Sending-domain-verified read | API / Backend (`src/core/messaging/resend-domains.ts` → Resend API) | — | Third-party read; must be tolerated and three-state (verified / not / unknown) |
| Arm / disarm + audit | API / Backend (`src/db/repository/messaging-config.ts` transaction) | Frontend Server (server action authorises, validates, maps result to a sentence) | The switch is a DB row flip effective on the next tick (`schema/messaging-config.ts` header) |
| Proof recording | API / Backend (new `tenant_proofs` repository namespace on `forTenant`) | Frontend Server (server action) | Evidence family: append-only, tenant-scoped, SELECT-only to `authenticated` |
| CON-03 escalation | Database / cron → API (`cadence-tick` Pass 5 classify, Pass 6 escalate) | — | Already deployed; proof only observes |
| MSG-02 email send | CLI script (`scripts/verify-email-pipe.mjs`) → API core (`ResendSender`) | Resend (offshore, `ap-northeast-1`) | The only customer-shaped email path in v1 |
| One-click unsubscribe | API route (`src/app/api/unsubscribe/route.ts`) | Database (`controls.ts` suppress transaction) | Live on production; suppression semantics pinned in a DB-backed suite |
| ARM-04 probe | CLI script (`scripts/sm8-spike.mjs probe`) | ServiceM8 API | Two GETs, records field names only |
| Runbook | Docs (`docs/first-client-go-live-runbook.md`) | — | Each step names a console screen or read-only script and its artefact |
| Operational reads (balance, cron, audit requests) | CLI scripts (`scripts/*.mjs`, `process.loadEnvFile`) | ClickSend / Supabase | The workspace denies commands naming `.env*`; scripts are the sanctioned reader (`cron-status.mjs` header) |

## Standard Stack

No new runtime dependencies. Everything this phase needs is installed and version-pinned in `package.json` `[VERIFIED: package.json:34-53]`:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 | Schema for the two new tables; `db.transaction` for arm+audit | Existing migration authority; `nullsNotDistinct()` only on the constraint builder in this version (`schema/messaging-config.ts:155`) |
| `drizzle-kit` | 0.31.10 | `npm run db:generate` for migration 0036, then hand-finish CHECK + GRANT blocks | House pattern (0032/0033/0035 headers) |
| `postgres` | 3.4.9 | driver; scripts use `process.loadEnvFile('.env.local')` | `cron-status.mjs`, `audit-requests-count.mjs` precedent |
| `resend` | 6.22.1 | `domains.list()` for the domain-verified read; `emails.get()` for the delivery read-back (new wrapper) | Already the only Resend caller family |
| `zod` | 4.4.3 | Action input validation | House rule |
| `next` | 16.3.2 | Server actions with `useActionState` | Existing card pattern |
| `vitest` | 4.1.11 | Pure + DB-backed suites | Existing |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `scripts/setup-clicksend.mjs` `api()` helper (`setup-clicksend.mjs:203`) | Basic-auth `fetch` against `https://rest.clicksend.com/v3` | Copy the helper shape into a new read-only `scripts/clicksend-balance.mjs` |
| `scripts/audit-requests-count.mjs` mould | Read-only production probe with an explicit select list, no PII | New `scripts/escalations-recent.mjs` (and optionally `scripts/proof-status.mjs`) |

**Installation:** none.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. `gsd query package-legitimacy check` was not run because there is nothing to check. (Any plan that proposes a new dependency must run the gate first.)

## Findings by planner question

### Q1 — Checklist: how items are computed and rendered; adding the ARM-01 items

**How it works today** `[VERIFIED: src/core/onboarding/checklist.ts:105-112, 156-268]`

```ts
// src/core/onboarding/checklist.ts:105-112 — verbatim
export const CHECKLIST_ITEM_KEYS = [
  'sm8Connected',
  'contactHours',
  'voiceProfile',
  'templatesApproved',
  'sm8AutomationOff',
  'messagingArmed',
] as const;
```

`readOnboardingChecklist(tenantId, now)` (`:156`) issues seven parallel reads through `forTenant(tenantId)`: `tenant.get()`, `connection.get()`, `settings.get()`, `hasApprovedTemplateSet(repo)` (the gate's own reader), `attestations.latest('sm8_automation_off')`, `resolveSmsFrom(tenantId)`, `resolveEmailIdentity(tenantId)` (`:179-180`). It returns `{ items: ChecklistItem[]; attestation: AttestationState }` where each item is `{ key, satisfied, detail }` — `detail` carries the fact itself ("8:00 am–6:00 pm Mon–Fri (Australia/Perth)", "SMS from +61…"). The `messagingArmed` row (`:250`) is `armed.length > 0` over both resolvers joined with ` · `.

The card (`src/app/(console)/clients/[id]/checklist-card.tsx`) is a client component whose props are plain data; `ITEM_LABELS` (`:37-44`) and `ITEM_FIX` (`:59-72`) are `Record<ItemKey, …>` — a new key is a compile error until labelled (`:55-58` comment). `messagingArmed` has `ITEM_FIX: null` because "its remedy is a deployment config change with no console screen behind it" (`:71`) — which is exactly what this phase changes. The page formats dates in the tenant zone before passing them down (`page.tsx:877-880`) and tolerates a checklist read failure by rendering a fixed error section keeping the `#ready-to-send` anchor (`page.tsx:734-741, 884-896`).

**Tests pin the shape**: `tests/onboarding-checklist-gate.test.ts:606-607` asserts `items.map(key)` equals `[...CHECKLIST_ITEM_KEYS]` and `toHaveLength(6)`. Both must be updated in the same plan that extends the keys `[VERIFIED]`.

**Recommended extension** (keep one derivation; keep the core framework-free):

```ts
export const CHECKLIST_ITEM_KEYS = [
  'sm8Connected',
  'contactHours',
  'voiceProfile',
  'templatesApproved',
  'sm8AutomationOff',
  'escalationPhone',        // NEW — normalizeAuMobile(tenant.escalationPhone) !== null
  'sendingDomainVerified',  // NEW — Resend status of the tenant email row's from-domain
  'smsArmed',               // SPLIT from messagingArmed — resolveSmsFrom(tenantId) !== null
  'emailArmed',             // SPLIT — resolveEmailIdentity(tenantId) !== null
  'escalationHandsetProof', // NEW — tenant_proofs.latest('escalation_handset')
  'emailPipeProof',         // NEW — tenant_proofs.latest('email_pipe')
] as const;
```

Ten keys rather than ARM-01's eight because ARM-01 omits `voiceProfile`/`sm8Connected` (already shipped, keep them) and the CONTEXT adds the email proof row. If the planner prefers exactly the ARM-01 list, drop `emailPipeProof` — but D-01 says "the checklist shows both" proofs, so keep it.

Reader sources, each already existing or one line:
- `escalationPhone`: `tenant.escalationPhone` (`schema/tenants.ts:40`) through `normalizeAuMobile` (`core/cadence/primary-contact.ts:129`) — the same function the escalation pass uses (`escalate-hot-leads.ts` step (a)), so "set" means "textable", not "non-null".
- `sendingDomainVerified`: `getChannelConfig('email', tenantId)` → `domainOfAddress(row.fromAddress)` (`resend-domains.ts:208`) → `listDomains()` (`:259`) → `status === VERIFIED_STATUS` where `VERIFIED_STATUS = 'verified'` (`:66`). This is exactly the predicate `saveEmailConfigAction` already applies (`settings/email/actions.ts:256-260`); extract it to `resend-domains.ts` as `isSendingDomainVerified(address)` so the settings action, the checklist and the arming refusal share one spelling. **Three-state**: `listDomains()` can fail (`{ok:false, reason}`); the item must render "could not check" (unsatisfied, distinct detail) and the arming action must **refuse** on a failed read — the same "a read failure is treated as REFUSAL" rule the settings action states (`actions.ts:247-256`). Inject the lister into the checklist reader so the DB-backed test can stub it without network.
- `smsArmed` / `emailArmed`: the existing two resolvers, one per row; `detail` = the from-address/identity.
- Proof rows: `forTenant(id).proofs.latest(kind)` (new namespace, mirrors `attestations.latest` at `for-tenant.ts:3361-3374`), `detail` = "recorded {date} · {artefact id}".

Card labels (console voice, no exclamation marks): `Escalation phone set` / `Sending domain verified` / `SMS armed` / `Email armed` / `Escalation handset proof recorded` / `Email pipe proof recorded`. `ITEM_FIX` for `sendingDomainVerified` → `/settings/email` "Verify it →"; for `escalationPhone` → `null` (the form is on the same page); for the arming rows → `null` (the control is on the card); for proofs → `null` (the record form is on the card).

**Live state**: derive `live = smsArmed && escalationHandsetProof` (and `emailLive = emailArmed && emailPipeProof`) in the core and render a single "Live" / "Armed, not yet proven" / "Not armed" line at the top of the card. Do not store it — it is a derivation of two facts, like `deriveHealth`.

### Q2 — Proof rows: `tenant_attestations` shape and the D-02 storage decision

`tenant_attestations` `[VERIFIED: src/db/schema/tenant-attestations.ts:67-127]`: columns `id uuid`, `tenant_id uuid NOT NULL` (no FK), `kind text NOT NULL` (CHECK), `note text NOT NULL` (no default — "the note IS the deliberation"), `attested_at timestamptz default now()`, `created_at`. Index `(tenant_id, kind, attested_at DESC)`. Policy `has_tenant_access(tenant_id)`. Grants: SELECT-only to `anon`/`authenticated` (`0032_phase6_console.sql`, exact-grants map `tests/rls-coverage.test.ts:304-305`). The kind vocabulary is a one-member closed set:

```ts
// src/db/schema/tenant-attestations.ts:67 — verbatim
export const TENANT_ATTESTATION_KINDS = ['sm8_automation_off'] as const;
```
and the migration CHECK is `CHECK (kind IN ('sm8_automation_off'))` (`0032_phase6_console.sql:94`). **There is no operator column** on this table — "a NAMED HUMAN" in its header is aspirational; the row records when, not who.

**Recommendation: a new `tenant_proofs` table**, not new attestation kinds. Reasons:
1. D-02's rule "no proof row without an artefact id" must be a database fact. Reusing `note` for the artefact makes it prose; a dedicated `artefact_id text NOT NULL CHECK (length(artefact_id) > 0)` (or `uuid` for the escalation kind) makes it a constraint.
2. D-04 wants the operator id on the audit trail; a proof is the same class of evidence. `recorded_by uuid NOT NULL` costs nothing on a new table and would be a schema change with a backfill problem on the old one.
3. `forAllTenants_latestAttestations(kind)` is kind-filtered (`for-all-tenants.ts:1137`), so the digest would not be polluted either way — but the attestation staleness policy (30-day nag, `checklist.ts` `ATTESTATION_STALE_DAYS`) has no meaning for a proof, and a shared table invites a future reader to apply it.

Proposed shape (drizzle, `src/db/schema/tenant-proofs.ts`):

| column | type | notes |
|---|---|---|
| `id` | uuid pk default random | |
| `tenant_id` | uuid NOT NULL, **no FK** | evidence-family rule (`escalations.ts` header) |
| `kind` | text NOT NULL, CHECK `IN ('escalation_handset','email_pipe')` | closed vocabulary, house rule |
| `artefact_id` | text NOT NULL, CHECK `length(artefact_id) BETWEEN 8 AND 128` | escalation row uuid / Resend email id |
| `artefact_detail` | jsonb NOT NULL default `'{}'` | what the action verified live: `{provider_message_id, sent_at}` or `{last_event, to_domain}` — no addresses |
| `note` | text NOT NULL | "which handset stood in" (D-06 says record which) |
| `recorded_by` | uuid NOT NULL | `auth.users.id` from claims `sub` |
| `recorded_at` | timestamptz NOT NULL default now() | server-set |
| `created_at` | timestamptz NOT NULL default now() | |

Index `(tenant_id, kind, recorded_at DESC)`; policy `has_tenant_access(tenant_id)`; REVOKE ALL from anon/authenticated then GRANT SELECT to both + ALL to service_role (`0035_phase9_audit_requests.sql:93-105` block shape). Append-only namespace on `forTenant`: `proofs.append({kind, artefactId, artefactDetail, note, recordedBy})` and `proofs.latest(kind)`.

**Migration shape** `[VERIFIED: 0033/0035 headers; drizzle/meta/_journal.json tail]`: ONE migration for the whole phase (`0036_phase10_go_live.sql`) carrying both tables — the journal-ordering trap fires when two plans each generate a migration (`0033_phase7_reporting.sql:3-11`). Generate with `npm run db:generate`, rename the random tag, re-tag `meta/_journal.json`, and check `when` > `1788919992174` (0035's stamp) — drizzle's migrator silently skips an entry older than the last applied one (`0035:15-20`). Hand-finish CHECKs and GRANTs (drizzle-kit does not model them). Add both tables to the `table_name IN (...)` list (`tests/rls-coverage.test.ts:118-131`) and the exact-grants map (`:262-305`) — `messaging_config_audit/authenticated: 'SELECT'`, `tenant_proofs/authenticated: 'SELECT'`.

### Q3 — Arming action: keys, tenant email row, transaction, the global SMS row

**Keying** `[VERIFIED: src/db/schema/messaging-config.ts:83, 145-171; src/db/repository/messaging-config.ts:70-105, 193-215]`:

```ts
// src/db/schema/messaging-config.ts:83 — verbatim
export const MESSAGING_CHANNELS = ['sms', 'email'] as const;
```
Unique constraint `messaging_config_channel_tenant_uniq` on `(channel, tenant_id)` with `.nullsNotDistinct()` — so exactly one global row per channel; `upsertChannelConfig` does `ON CONFLICT (channel, tenant_id) DO UPDATE` with an **exhaustive** `set` (`fromAddress`, `replyTo`, `businessName`, `enabled`, `updatedAt`) — a caller states the whole identity, not a patch (`:203-213`). Consequence: the arm action must re-supply `from_address`/`reply_to`/`business_name` from the existing row (read `getChannelConfig(channel, tenantId)` first, inside the transaction) or it will null them.

**Fallback semantics** `[VERIFIED: messaging-config.ts:87-105; routing-sender.ts:185-189, 220-236]`: `getChannelConfig(channel, tenantId)` fetches the tenant row and the global row in one query ordered `OVERRIDE_FIRST` (`asc(isNull(tenantId))`) and returns `[0]`. `resolveSmsFrom` returns `null` if `!row?.enabled`. So:
- no tenant sms row + global `enabled=true` → **armed** (global from) — every connected client, including the Phase 4 test tenant `13e8f2aa`;
- tenant sms row `enabled=false` + global `enabled=true` → **explicitly OFF** for that tenant (the comment at `routing-sender.ts:205-208` says this is the design);
- `anyChannelEnabled(channel)` (`:142`) is the deployment-level gate `buildRoutingSender` asks once per tick — never use it for a per-client display (CR-01 defect class, `checklist.ts` header).

**What the tenant email row needs** `[VERIFIED: settings/email/actions.ts:190-296]`: `saveEmailConfigAction` writes `{channel:'email', tenantId, fromAddress, replyTo, businessName, enabled}` and refuses enabling without from-address, reply-to ("customer replies go there, not to us"), business name (Spam Act), and a from-domain whose Resend status is `verified`. `resolveEmailIdentity` additionally falls back to `tenants.name` for the business name (`routing-sender.ts:228-233`). The client-page email arm action should reuse the same refusals; the cleanest split is: `/settings/email` stays the place the identity is *created* (from/reply-to/name, `enabled` unticked), and the client page only flips `enabled` on a row that already resolves — refusing with "Add this client's email identity first →" if `getChannelConfig('email', tenantId)?.tenantId !== tenantId`.

**Same-transaction audit** `[VERIFIED: src/db/repository/client.ts:40-68; for-tenant.ts:3881-3884]`: `getDb()` returns a `PostgresJsDatabase` (drizzle), so `getDb().transaction(async (tx) => { ... })` is available; `forTenant().transaction` already wraps it and nested calls become savepoints. `upsertChannelConfig` takes no handle — add an optional `db: DbLike` parameter (the `for-tenant.ts:1946` type) or, cleaner, a new exported `armChannel(input)` in `messaging-config.ts` that opens the transaction, re-reads the effective row, upserts with `enabled: true`, inserts the audit row, and returns both. `disarmChannel` mirrors it with `enabled: false` and a required reason. Both stay in the messaging-config file so the "one write path" rule (`:185-192`) holds — two exported writers in one file, not two files.

`messaging_config_audit` columns (D-04 plus what the page needs): `id`, `channel text CHECK IN ('sms','email')`, `tenant_id uuid NULL` (NULL = the global row; same meaning as the config table), `action text CHECK IN ('arm','disarm')`, `operator_user_id uuid NOT NULL`, `reason text NULL` (CHECK `action <> 'disarm' OR (reason IS NOT NULL AND length(reason) > 0)`), `from_address text NULL` (snapshot of what was armed — the identity the audit line should show), `created_at`. Policy: same two-arm shape as `messaging_config` — `(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())` (`schema/messaging-config.ts:167-171`), so the global row's audit lines are visible to the operator. `is_operator()` is created in 0009; `CREATE POLICY` resolves it at DDL time — fine, it exists. SELECT-only grants. "Last three rows" read: `listAudit(channel, tenantId, limit 3)` where for `sms` the query is `tenant_id IS NULL` (global) — the page must say "SMS (shared number)".

**Presenting the global SMS row**: the control is per-channel on the client page (D-03, locked) but the SMS write is global. Two consequences the card must render, and the runbook must state:
1. The count and names of every other tenant that will become armed by this write: `SELECT tenants … WHERE NOT EXISTS (messaging_config sms row for that tenant with enabled=false)` joined with a live connection. This is a new `forAllTenants_*` read returning ids and names only (the `forAllTenants_reportMetrics` precedent joins `tenants` for names under `requireOperator`).
2. The mitigation for the test tenant: before arming, write a tenant sms override `enabled=false` for `13e8f2aa` through the same `disarmChannel({channel:'sms', tenantId})` (reason: "test tenant — keep off"). That is the existing per-client-OFF semantics, no new code path. The escalation pass then records `sms_not_configured` for that tenant with zero HTTP (`tests/escalation.test.ts:404-416` proves it).

Operator identity: `requireOperator()` returns `'ok' | 'unauthenticated' | 'forbidden'` (`_auth.ts:52-72`) and discards the `sub` it read (`:56`). Add `requireOperatorId(): Promise<{ ok: true; userId: string } | { ok: false; reason: 'unauthenticated' | 'forbidden' }>` beside it (same allowlist read, same "read error is denial" rule) rather than changing the existing signature used by every prospect/audit action.

### Q4 — Server-side gate evaluation and the refusal sentence

Reuse, do not re-derive: the arm action calls the same `readGoLiveChecklist(tenantId, now, deps)` the page renders, then walks `CHECKLIST_ITEM_KEYS` in order and refuses on the first unsatisfied *gating* item. Gating set for arming (D-01/D-05): `contactHours`, `templatesApproved`, `sm8AutomationOff`, `escalationPhone`, and for email additionally `sendingDomainVerified`. Not gating: `sm8Connected`? — **recommend it IS gating** (arming a client whose ServiceM8 key is dead sends follow-ups about quotes nobody can win-detect; `checklist.ts:196-200` already treats a paused connection as unmet). `voiceProfile` is not gating (drafting has its own belt). Proof items never gate arming.

Refusal copy pattern `[VERIFIED: clients/[id]/action-state.ts; email action-state.ts]`: fixed sentences live in `action-state.ts` as exported constants or pure functions (a `'use server'` module may export only async functions — `action-state.ts:4-9`). State shape `{ error: string | null; success: string | null }`. Recommend `ARM_REFUSAL: Record<GatingKey, string>` with sentences naming the fix, e.g. `'Approve every template first — Voice & templates →'`, `'Record that ServiceM8 auto follow-up is off first (below).'`, `'Set an escalation number first (above).'`, `'quotes.backdesk.com.au is not verified for this client's from-address yet — Email settings →'`, and for the read failure `'Could not check the sending domain right now. Nothing was armed — try again in a moment.'`. Success sentence for SMS must state the blast radius: `'Armed. SMS is on for every connected client from the next tick — {n} client(s): {names}.'`; for email: `'Armed. Email is on for this client from the next tick.'` (the timing claim is true because of CR-01, `settings/email/actions.ts:279-290`).

Authorisation shape: `requireOperatorId()` first, then the tenant membership read through the operator's own JWT (`clients/[id]/actions.ts:138-162` `authorize`) — both, because the write goes through the service-role path.

### Q5 — CON-03 proof: what the tick needs, STATE.md Phase 4 items, safe production sequence

**Mechanism** `[VERIFIED]`:
- Pass 5 classifies inbound rows since the last tick (`run-tick.ts:784`); `is_hot` is derived in exactly one place: `isHotLead` returns `false` unless `confidence === 'high'` (`classify-inbound.ts:285`, verbatim `if (confidence !== 'high') return false;`) and then `label === 'interested' || label === 'question'` (`:286`) `[VERIFIED]`. **The proof reply must be unambiguous** ("Yes please go ahead, when can you start?") — a medium-confidence label is recorded, triaged, and never escalated.
- Pass 6 (`run-tick.ts:824`) runs `escalateHotLeads` over `forAllTenants_hotUnescalated` = `inbound_messages.is_hot = true AND attribution = 'threaded' AND no escalations row` (`for-all-tenants.ts:1280-1286`).
- The pass resolves `to = normalizeAuMobile(tenants.escalation_phone)`, `from = resolveSmsFrom(tenantId)` (before any claim or HTTP), then claims (`UNIQUE(inbound_message_id)`), then sends with `customString: claimed.id` (`escalate-hot-leads.ts:294`), then records `outcome:'sent', sentAt, providerMessageId` (`:299-303`). Outcome vocabulary:

```ts
// src/db/schema/escalations.ts:108-113 — verbatim
export const ESCALATION_OUTCOMES = [
  'sent',
  'no_escalation_number',
  'sms_not_configured',
  'cooldown_suppressed',
] as const;
```
  plus UPPERCASE provider codes via `codeOf` on refusal; `outcome IS NULL` = claimed, unknown.
- The sender is built from `CLICKSEND_USERNAME`/`CLICKSEND_API_KEY` in the tick route (`cadence-tick/route.ts:142-145`); production has both (Phase 4 live proof).
- `ESCALATION_COOLDOWN_MINUTES = 30` (`escalation/message.ts:72`) — a second hot reply on the same cadence inside 30 min records `cooldown_suppressed`, not a second SMS. One reply per proof.

**The proof artefact**: the `escalations` row (`id`, `outcome='sent'`, `sent_at`, `provider_message_id`). Nothing in the console reads it — `listEscalationsForQuote` is used only by attribution (`consume-wins.ts:168,438`). The operator needs a way to get the id without SQL: a read-only `scripts/escalations-recent.mjs` (`audit-requests-count.mjs` mould: explicit select list — `id, tenant_id, cadence_id, outcome, sent_at, provider_message_id, created_at`; no `to_address`, no body) is the cheapest; a quote-page "Escalations" line is nicer but is UI work the proof does not need. The proof action should then **verify the artefact live**: read the escalation row by id scoped to the tenant (new `getEscalationForTenant(tenantId, id)` in `repository/escalations.ts`), require `outcome === 'sent'` and `provider_message_id IS NOT NULL`, store both in `artefact_detail`. Refuse otherwise with a fixed sentence.

**STATE.md Phase 4 items** `[VERIFIED: .planning/STATE.md:473-480]`: the OWED (`:473`) and MUST RESTORE (`:474`) bullets are superseded by three later bullets in the same list — `:478` "the teardown blocker is closed… 0 live cadences and 0 pending touches", `:479` "the owed remote fixtures are run… full test:remote green", `:480` "DISARMED 2026-08-30… enabled=false". `docs/external-registrations.md:658-680` "Teardown, done" agrees. Cadence `b7a0f041` is `stopped(contact_suppressed)` with touches 2–5 `skipped(suppressed)` (04-07 SUMMARY). **Nothing to tear down; STATE.md should be tidied so the stale bullets stop being re-read** (a docs task in this phase).

Two live facts still matter:
1. Test tenant `13e8f2aa` is connected to a live ServiceM8 trial account that held two `status='Quote'`/eligible quotes (`STATE.md:480`). Arming the global SMS row arms it. Mitigation in Q3 (explicit tenant `enabled=false` row) — or, if the Phase 5/6 gate is still closed for it (no attestation / templates), its cadences are born `paused('onboarding')` and nothing sends; verify with the checklist card for that tenant rather than assume.
2. ClickSend's account-level **Opt-Out List holds the operator's handset** that texted STOP on 2026-08-30 (04-07 SUMMARY "their Opt-Out List now holds exactly the one handset"). A send to an opted-out number is refused by the provider (`isOptOutCode` exists in `clicksend-client.ts:594`). If that handset is the escalation phone for the proof, remove it from the ClickSend Opt-Out List first (dashboard; record it in `docs/external-registrations.md`), or use a different handset. The 2026-09-10 operator-alert SMS (09-UAT, "email + SMS received") is evidence only if `OPERATOR_ALERT_PHONE` is that same handset — check, do not assume `[ASSUMED which handset]`.

**Safe production sequence through product paths only** (no SQL):
1. Founding client tenant fully onboarded: connected (private key), contact hours, escalation phone (operator handset or tradie's — record which in the proof note), voice profile, templates approved (ONB-03), attestation (ONB-04). Checklist green on everything except the two proofs and the two arming rows.
2. Pre-arm: `scripts/clicksend-balance.mjs` (new; see Q8) shows balance > 0 AUD; `npm run cron:status` shows the four jobs on `https://app.backdesk.com.au` and no lease; ClickSend Opt-Out List checked for the handsets in play; test tenant explicitly disarmed (Q3).
3. A real job in the client's ServiceM8 account whose contact mobile is the operator's **second** handset (created in ServiceM8 by the client/operator — the sync mirrors it; do not edit `quote_contacts`, the sync reverts it within a minute, `STATE.md` Phase 4 FINDING). Mark it chase-eligible on the client page (`saveEligibilityAction`) → `quote_opened` → cadence created **active** (gate open) → touch 1 `needs_draft` → drafted → operator approves in `/queue`.
4. Arm SMS from the client page (writes global row + audit). Next tick inside the client's contact window: dispatch sends touch 1 from `+61491579212` to the second handset; `send_ledger` `outcome='sent'` (`SEND_LEDGER_OUTCOMES = ['stub_sent','sent','failed']`, `send-ledger.ts:102`); DLR arrives.
5. From the second handset reply e.g. "Yes go ahead, when can you start?" → inbound webhook threads it to the one live cadence for that mobile → `reply_threaded`, cadence `paused(customer_reply)`.
6. Within the next tick(s): Pass 5 labels it `interested` (hot) → Pass 6 sends the escalation SMS to the escalation phone → `escalations` row `sent` + `provider_message_id`. Expect the handset to buzz within ~1–2 minutes.
7. `node scripts/escalations-recent.mjs --tenant <id>` → copy the escalation row id → client page "Record escalation handset proof" → paste id + note → row written after live verification → checklist "Escalation handset proof recorded on {date}"; SMS state reads **Live**.
8. Close the test conversation honestly: the cadence is paused on reply; the operator decides in the console (stop it as `operator_closed`) so the second handset is not chased further. Record everything in `docs/external-registrations.md` as a dated entry (ids, outcomes, timestamps; never addresses or bodies).

Timing: the whole sequence is bounded by the client's contact window (dispatch obeys it; escalation does not).

### Q6 — MSG-02 proof: `verify-email-pipe.mjs`, the missing inbound-email path, and DOM-04's wording

**Script behaviour** `[VERIFIED: scripts/verify-email-pipe.mjs:48-207]`: requires `RESEND_API_KEY`, `APP_BASE_URL`, `UNSUBSCRIBE_SIGNING_SECRET`, `DATABASE_URL` from `.env.local`; `--tenant <uuid> --to <address>`. Five assertions: (1) `resolveEmailIdentity(tenant)` non-null (needs an **enabled** tenant email row with from/reply-to/name), (2) from-domain not `resend.dev` (`:133`; `OWNER_ONLY_SENDER_DOMAIN = 'resend.dev'`, `resend-sender.ts:79`), (3) builds the message and prints the exact headers (`List-Unsubscribe`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click` at `resend-sender.ts:263`, From, Reply-To, Subject), (4) the minted token verifies back, (5) `new ResendSender({…, resolveEmailConfig: resolveEmailIdentity}).send(request)` — the real `TouchSender` — and prints `provider message id <resend id>` on `kind:'sent'` (`resend-sender.ts:379`). Preconditions on production therefore: tenant email row **armed** (so the sequence is arm email → run the script — matching CONTEXT's order) and the local `.env.local` `RESEND_API_KEY` must be the same Full-access key as the deployment (Phase 8 drift warning, `STATE.md:498`).

Two design facts the script's own header states and the planner must not paper over:
- `ledgerId: 'verify-email-pipe'` (`:144`) — **no `send_ledger` row is written** (the ledger is written by dispatch, not by senders; the script bypasses dispatch by design). D-07's "send-ledger row" evidence does not exist for this path; the artefact is the **Resend email id**.
- `cadenceId: randomUUID()` (`:148`) — the one-click link is real and verifiable but resolves to `no_cadence` (`controls.ts:298`) and **writes nothing**, "so the proof cannot permanently suppress a real customer". D-07's "both channels show suppressed for that contact" cannot happen from this email as built.

**Delivery evidence**: no Resend webhooks are configured (Phase 8 runtime inventory) and there is no email DLR path. Use Resend's `GET /emails/{id}` which returns `last_event` (`delivered`, `sent`, `bounced`, `complained`, `delivery_delayed`) `[CITED: resend.com/docs/api-reference/emails/retrieve-email]` — a read-only call with the existing key; wrap it as `getEmailStatus(id)` beside `resend-domains.ts` (same no-throw, `error.name`-only rules) and have the proof action verify `last_event === 'delivered'` before writing the `email_pipe` proof row. A read-only `scripts/resend-email-status.mjs <id>` gives the runbook the same fact.

**Is there an inbound email path?** **No** `[VERIFIED: ls src/app/api/webhooks → clicksend/, servicem8/ only; src/core/messaging/inbound.ts is `handleInboundSms` with `channel: 'sms'` hard-coded; grep for `email.received`/receiving matches only resend-domains.ts and the settings action]`. `resend-sender.ts:31-33` states the design: "REPLY-TO (D-01) the tradie's OWN address. v1 captures no inbound email at all". A reply from the operator-controlled inbox goes to the tradie's mailbox (or, for the proof, whatever reply-to the tenant row holds).

**Consequence for DOM-04**: the clause "inbound reply threaded to the quote" is not satisfiable by code that exists, and the clause "one-click unsubscribe suppressing both channels" is not satisfiable by the script as built. Two options with estimates:

| Option | What it proves live | Work | Recommendation |
|---|---|---|---|
| **A — revise DOM-04 to the provable pipe** | Send from the tenant identity on `quotes.backdesk.com.au` via the real `TouchSender`; `last_event=delivered`; From/Reply-To/identity footer/RFC 8058 headers observed in a real mail client; one-click POST on production returns 200 and logs `[unsubscribe] click handled: no_cadence` (endpoint + token verification live); the reply lands in the reply-to mailbox (the operator sets reply-to to an inbox they control for the proof, then to the tradie's) | ~0.5 plan: wrapper + script + docs; suppression semantics already pinned by `tests/unsubscribe-suppression.test.ts:201,244,275` (DB-backed, CI) | **Do this.** Rewrite DOM-04 as: "…send, delivered, reply-to reaches the tradie's inbox, RFC 8058 one-click endpoint answered on production; both-channel suppression on click proven by the DB-backed suite" |
| **A+ — live suppression via `--cadence`** | Same as A, plus a click that suppresses a real contact on both channels and stops a cadence | +~0.3 plan: script accepts `--cadence <id>`, validates the cadence belongs to `--tenant` and is live, mints the token over it; run against a deliberately created test cadence (test tenant, operator's own contact created in the SM8 trial account) | Optional. Only if the operator wants the live click; the product path (`route.ts:198` → `suppressFromInbound`) is unchanged |
| **B — build inbound email** | Reply threaded to the quote | 2–3 plans + DNS + a D-01 reversal: Resend Receiving needs an MX (third-party guide says host `inbound`, priority 10, value from the dashboard `[CITED: getfluxly.com/blog/resend-inbound-email, 2026-07-29 — LOW]`; Resend docs confirm receiving works on "a verified domain" but give no record values on the intro page `[CITED: resend.com/docs/dashboard/receiving/introduction]`), an `email.received` webhook route (payload is **metadata only**: `email_id, from, to, subject, message_id, attachments[]` — body via `GET /emails/receiving/{id}` `[CITED: resend.com/docs/webhooks/emails/received; /api-reference/emails/retrieve-received-email]`), Svix signature verification, threading by recipient plus-address or `In-Reply-To` ↔ stored `provider_message_id`, a new `inbound_messages.channel='email'` branch in `controls.ts`, and reply-to pointed at a Backdesk receiving address with forwarding to the tradie (reverses D-01) | **Defer to v1.2.** Not a go-live phase's change; note that v1 cadences produce no email touches anyway (below) |

**One more honesty item**: v1 cadences are SMS-only end to end — `ensureDefaults` seeds `channel:'sms'` timing rows (`consume-events.ts:779`, `draft-touches.ts:759-760` comment), `approvedSetStatus()` filters `channel = 'sms'` on both sides (`for-tenant.ts:2314, 2325`), and the drafting pass skips non-SMS touches as `noApprovedTemplate` (`draft-touches.ts:769`). "A cadence email leaves quotes.backdesk.com.au" (ROADMAP SC4) is therefore true only in the sense that the cadence's *TouchSender path* carries the proof email; no real cadence will send email in v1. The checklist's "Email armed" row and the runbook must say this plainly so the operator does not expect email follow-ups. Recommend the SC4 wording be corrected alongside DOM-04.

### Q7 — ARM-04: `sm8-spike.mjs probe` mechanics

`[VERIFIED: scripts/sm8-spike.mjs:27-120; docs/servicem8-api-notes.md:169-215]`: `loadEnv()` then `requireEnv('SM8_TEST_API_KEY')` (`:30`); `createSm8Client({kind:'apiKey', key})`; `probe` (argv[2] === 'probe', `:115`) issues exactly two GETs — `sms.json`, `email.json` — and on 200 records `rowCount`, sorted **field names only** (never a row), `hasJobUuidAttribution` (regex `/job.*uuid|uuid.*job/i`), and `timestampFields` (`/date|time|sent|created/i`), then prints JSON and says where to record it. It exits before the fixture rewrite. Last measurement (1 Sep 2026): both 200, 0 rows.

What it needs from this phase:
- **The key**: the script reads `SM8_TEST_API_KEY`, i.e. the trial account. For the founding client's account, either (a) export that client's private key into the shell for the one run (`SM8_TEST_API_KEY=… node scripts/sm8-spike.mjs probe` — the value never lands in a file; note the workspace's `.env*` denial applies to file names, not exports), or (b) add `--tenant <id>` that decrypts the stored connection key through the existing credential module (`src/core/shared/crypto.ts`, AES-256-GCM) — more code, cleaner audit. Recommend (a) for the one-off measure with the run recorded in `docs/external-registrations.md`; (b) only if the probe becomes a recurring thing.
- **A non-empty row**: the doc's "next measurement" steps (`servicem8-api-notes.md:205-215`) — on a connected account switch **Settings → Automation → Quote Follow Up ON** for one quote and let it fire, or send one SMS/email from inside ServiceM8, then re-probe. On the founding client this contradicts ONB-04 (automation must be OFF) — do it on the **trial account** (seed a native follow-up there), or only on the founding client *before* their attestation is recorded. Record which.
- **Recording**: append a dated table to §"ServiceM8 own-comms (D-13)" with the field list, `hasJobUuidAttribution`, `timestampFields`, then the decision: Tier 1 designable iff a job UUID (or something resolving to one) AND a send timestamp are present. No Tier 1 code unless it is a small addition to the staleness nag (D-09).

### Q8 — Runbook artefacts, ClickSend balance, Supabase Auth URL, the UAT audit_requests rows

Each runbook step's artefact (console screen or read-only script; DB rows only through scripts that print no PII):

| Step | Screen / script | Artefact |
|---|---|---|
| Signed agreement | — (docs/gtm M3) | file reference |
| ServiceM8 private key | `/clients/[id]` connect form | "Connected. Pulled N jobs…" + checklist `ServiceM8 connected` (key last-4) |
| Contact hours + escalation phone | `/clients/[id]` profile + escalation form | checklist rows |
| Voice + templates approved | `/clients/[id]/drafting` | `Templates approved` row (via `approvedSetStatus`) |
| SM8 automation-off attestation | checklist card attest form | `Verified off — {date}` line |
| Email identity + domain verified | `/settings/email` | `Verified` badge (Resend status), row in "Who sends as what"; checklist `Sending domain verified` |
| ClickSend balance | **new** `scripts/clicksend-balance.mjs` | `balance: 12.34 AUD` (one line, no credentials) |
| Cron sanity | `npm run cron:status` | four jobs on `https://app.backdesk.com.au`, `remote_test_lease rows: 0` |
| Test tenant kept off | client page of `13e8f2aa` → Disarm SMS (tenant override) | audit row |
| Arm SMS | founding client page → Arm SMS | audit row + success sentence naming the n armed clients |
| CON-03 proof | Q5 sequence; `scripts/escalations-recent.mjs` | escalation row `sent` + provider id; proof row |
| Arm email | client page → Arm email | audit row |
| MSG-02 proof | `npm run verify:email-pipe -- --tenant … --to …`; `scripts/resend-email-status.mjs <id>` | Resend id, `last_event=delivered`, headers printed; proof row |
| Mark live | derived on the card (both proofs recorded) | card reads `Live` |
| First cadence send observed | `/queue` approve → `/clients/[id]/quotes/[quoteId]` conversation | ledger row `sent` + delivery badge |
| Week-1 watch | 06:30 digest email; `/reports` opt-out rate; escalation counts in tick logs | — |
| Housekeeping | `/audits/requests` status select → `declined` for the two UAT rows (`STATUSES = ['new','contacted','audited','declined']`, `audits/requests/[id]/status-form.tsx:11`; CHECK in `0035`) | list shows them declined |
| Supabase Auth URL config | Supabase dashboard → Authentication → URL Configuration: Site URL `https://app.backdesk.com.au`, Redirect URLs `http://localhost:3000/**` (`STATE.md:450`) | dated entry in `docs/external-registrations.md` — dashboard-only, not readable from the repo `[ASSUMED current value]` |
| Alert From header confirmed (D-12) | first real operator alert email | header `Backdesk <alerts@quotes.backdesk.com.au>` observed; recorded |

**ClickSend balance**: there is no balance step in `setup-clicksend.mjs` (its steps are number → endpoints → rules → shape → activate; `:233-870`). ClickSend's REST API exposes `GET https://rest.clicksend.com/v3/account` with HTTP Basic (`username:api_key`, the same `AUTHORIZATION` header the setup script builds), whose `data` carries `balance` (string decimal, e.g. `"1117.461060"`), `_currency.currency_name_short` (e.g. `"AUD"`), `low_credit_amount`, `auto_recharge`, `auto_recharge_amount` `[CITED: ClickSend OpenAPI spec (apis.guru mirror of the official spec), GET /account 200 example — MEDIUM; the official docs page 404'd on fetch]`. Write `scripts/clicksend-balance.mjs` in the `api()`-helper mould, print `balance` + currency + `low_credit_amount` only. Add an `npm run clicksend:balance` script. Consider recommending the operator enable ClickSend auto-recharge (dashboard) — note in the runbook as an operator choice, not a code change.

### Q9 — Validation architecture (pure vs DB-backed vs live-only)

See `## Validation Architecture` below. Short version: the checklist, gate, arming repository and proof repository are DB-backed suites (run in CI against `supabase start`; locally only via `test:remote`, which D-11 forbids during go-live windows); the server actions are pure suites with the Supabase client mocked one level below `requireOperator` (`tests/email-settings-action.test.ts:29-80` pattern); the two proofs are provable only live and are recorded as dated evidence entries + proof rows, with the phase VERIFICATION carrying the ids.

### Q10 — Security: arming is the highest-consequence action in the product

See `## Security Domain`. The threat list is enumerated there with mitigations that already exist (operator allowlist read through RLS, membership read through the operator's JWT, service-role write only after both, zod bounds, fixed sentences, no addresses in logs) and the ones this phase adds (blast-radius display, same-transaction audit, live artefact verification, no SQL path, secrets never printed by the new scripts).

## Architecture Patterns

### System Architecture Diagram

```
                     ┌──────────────────────────── console (operator JWT + allowlist) ────────────────────────────┐
                     │  /clients/[id]                                                                               │
                     │   ┌─ Ready to send? card ──────────────────────────────────────────────────────────────┐    │
                     │   │  items[] ◄── readGoLiveChecklist(tenantId, now, {listDomains})  (ONE derivation)   │    │
                     │   │  [Arm SMS] [Disarm SMS] [Arm email] [Disarm email]  [Record proof: kind+artefact]  │    │
                     │   │  last 3 audit rows (sms = global)                                                   │    │
                     │   └───────────┬──────────────────────────┬──────────────────────────┬─────────────────┘    │
                     └───────────────┼──────────────────────────┼──────────────────────────┼──────────────────────┘
                                     │ server action            │ server action            │ server action
                                     ▼                          ▼                          ▼
        requireOperatorId() ─► authorize(tenant via RLS) ─► zod ─► readGoLiveChecklist ─► first unmet gating item? ─► REFUSE (fixed sentence)
                                     │ all gating items met
                                     ▼
              armChannel({channel, tenantId|null, operatorUserId, reason?})   ── getDb().transaction ──►  messaging_config UPSERT (enabled=true, identity re-supplied)
                                                                                                    └──►  messaging_config_audit INSERT
                                     │ next tick
                                     ▼
   pg_cron cadence-tick (1/min) ─► buildRoutingSender() [anyChannelEnabled] ─► dispatch (resolveSmsFrom per tenant) ─► ClickSend ─► send_ledger 'sent' ─► DLR
                                        └─► Pass 5 classify (is_hot) ─► Pass 6 escalateHotLeads (resolveSmsFrom, claim, send) ─► escalations 'sent' + provider_message_id
                                                                                                                                         │
   second handset reply ─► ClickSend inbound webhook ─► handleInboundSms ─► inbound_messages 'threaded' ─► cadence paused(customer_reply) ─┘
                                                                                                                                         ▼
   scripts/escalations-recent.mjs (read-only) ─► escalation id ─► [Record proof] ─► verify row live (outcome='sent') ─► tenant_proofs INSERT ─► card: Live

   scripts/verify-email-pipe.mjs --tenant --to ─► ResendSender.send (real TouchSender) ─► Resend id ─► GET /emails/{id} last_event=delivered ─► [Record proof] ─► tenant_proofs
                                                          └─► inbox: From / Reply-To / footer / List-Unsubscribe ─► one-click POST /api/unsubscribe ─► 200 (no_cadence)
```

### Recommended Project Structure (new files only)

```
src/db/schema/tenant-proofs.ts              # evidence table (kinds, artefact_id NOT NULL, recorded_by)
src/db/schema/messaging-config-audit.ts     # audit table (two-arm policy like messaging_config)
src/db/schema/index.ts                      # + both exports
src/db/migrations/0036_phase10_go_live.sql  # ONE migration: both tables, CHECKs, REVOKE/GRANT blocks; journal re-tag
src/db/repository/messaging-config.ts       # + armChannel / disarmChannel / listChannelAudit (transactional)
src/db/repository/for-tenant.ts             # + proofs: { append, latest }
src/db/repository/escalations.ts            # + getEscalationForTenant(tenantId, id)
src/db/repository/for-all-tenants.ts        # + forAllTenants_armedBySmsGlobal() (ids + names; blast radius)
src/core/messaging/resend-domains.ts        # + isSendingDomainVerified(address, lister?)
src/core/messaging/resend-emails.ts         # getEmailStatus(id) -> last_event (no-throw, name-only errors)
src/core/onboarding/checklist.ts            # keys 6 -> 10; readGoLiveChecklist; live derivation
src/core/onboarding/arming.ts               # gate evaluation + refusal keys (framework-free)
src/app/(console)/_auth.ts                  # + requireOperatorId()
src/app/(console)/clients/[id]/checklist-card.tsx   # labels/fixes for new keys; arm/disarm + proof forms
src/app/(console)/clients/[id]/actions.ts           # armChannelAction, disarmChannelAction, recordProofAction
src/app/(console)/clients/[id]/action-state.ts      # ARM_* / PROOF_* fixed sentences + blank states
scripts/clicksend-balance.mjs               # GET /v3/account -> balance + currency (read-only)
scripts/escalations-recent.mjs              # read-only, explicit select list, no addresses
scripts/resend-email-status.mjs             # GET /emails/{id} -> last_event
docs/first-client-go-live-runbook.md        # ARM-05
tests/go-live-checklist.test.ts             # DB-backed: 10 keys, gating set, live derivation, domain lister injected
tests/messaging-config-arming.test.ts       # DB-backed: arm+audit atomic, disarm requires reason, identity re-supplied, tenant override beats global
tests/tenant-proofs.test.ts                 # DB-backed: append-only, artefact required, latest-wins
tests/arming-actions.test.ts                # pure: requireOperatorId first, membership read, refusal sentences, no write on refusal
tests/rls-coverage.test.ts                  # + two tables in the IN list and the exact-grants map
```

### Pattern 1: One derivation, three consumers
**What:** `readGoLiveChecklist` is read by the card (display), the arm action (refusal) and the proof action (which channel's proof may be recorded — a proof for an unarmed channel is refused).
**When to use:** every gate in this codebase (`checklist.ts` header, `onboarding-gate.ts:180-190` "THE CONJUNCTION IS WRITTEN EXACTLY ONCE").
**Example:** `src/core/onboarding/checklist.ts:156-268` today; extend, do not fork.

### Pattern 2: Transactional writer in the repository, sentence in the action
**What:** the repository owns the transaction (upsert + audit), returns a closed result; the action authorises, validates, and maps to a fixed sentence.
**When to use:** the arm/disarm/proof actions — copy `attestSm8AutomationOff` (`onboarding-gate.ts:484-513`, `repo.transaction` at `:391`) + `attestSm8AutomationOffAction` (`actions.ts:468-503`).

### Pattern 3: Explicit tenant OFF beats global ON
**What:** a tenant `messaging_config` sms row with `enabled=false` is how one client stays quiet while the shared number is armed (`routing-sender.ts:205-208`; `getChannelConfig` ordering `messaging-config.ts:70`).
**When to use:** the test tenant before arming; any future client the operator wants paused without touching everyone.

### Pattern 4: Read-only production probes as repo scripts
**What:** `process.loadEnvFile('.env.local')`, explicit select lists, no PII, no credentials printed (`cron-status.mjs:1-34`, `audit-requests-count.mjs:1-33`).
**When to use:** every runbook artefact that lives in a DB row or a provider account.

### Anti-Patterns to Avoid
- **`anyChannelEnabled` on a per-client screen** — the deployment question, not the client's (CR-01; `checklist.ts` header).
- **A checkbox instead of a required note/artefact** — T-5-12; the proof form must require the artefact id and refuse an empty note.
- **Partial upsert** — `upsertChannelConfig` nulls omitted identity fields (`messaging-config.ts:203-213`); always re-read then re-supply.
- **`confirm()` dialogs** — the console's kill control uses a two-step inline arm-then-confirm that spells out the consequence (`cadence-controls.tsx:32-39`); the SMS arm control should copy that shape and name the n clients it arms.
- **A migration per plan** — journal-ordering trap (0033/0035 headers).
- **Editing `quote_contacts` to stage a recipient** — the sync reverts it (STATE.md Phase 4 FINDING); stage the contact in ServiceM8.
- **Reading the checklist's domain status from a cached page** — `force-dynamic` already; the Resend read must be per request and tolerated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is this from-domain verified?" | a second string comparison in the client action | `isSendingDomainVerified()` extracted from `settings/email/actions.ts:256-260` | two spellings drift (T-4-26) |
| Operator identity | JWT parsing | `supabase.auth.getClaims()` + allowlist read (`_auth.ts:52-72`) | the allowlist is the authority, read through RLS |
| Atomic arm + audit | two awaits | `getDb().transaction` (drizzle) | a crash between them is an armed row nobody can explain |
| Escalation evidence | re-deriving hot from labels | stored `is_hot` + `escalations` row | privilege boundary (Phase 5 D-14; `tests/escalation.test.ts:613`) |
| Email delivery proof | a Resend webhook route | `GET /emails/{id}` `last_event` | one read-only call; webhooks are a v1.2 item |
| ClickSend balance | a dashboard screenshot | `GET /v3/account` in `scripts/clicksend-balance.mjs` | server-side artefact, repeatable |
| Both-channel suppression proof | a live click on a real customer | `tests/unsubscribe-suppression.test.ts` + a live `no_cadence` POST (Option A) | the product must never suppress a real contact for a proof |

**Key insight:** every mechanism in this phase exists and was live-proven in v1.0; the risk is in re-implementing a gate or a write in a second place. Extend the one reader, add the one writer, and let the proofs observe.

## Runtime State Inventory

This phase is not a rename, but it flips production state; the inventory is included because the planner needs the same "what lives outside git" answers.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) Global sms `messaging_config` row: `tenant_id=NULL`, `from_address=+61491579212`, `enabled=false` `[VERIFIED: STATE.md:480]`. (2) Test tenant `13e8f2aa` connected to a live SM8 trial account, cadences `b7a0f041`/`f0016435` stopped, contact `4fe1fbf8` suppressed on both channels `[VERIFIED: STATE.md:478; external-registrations.md:658-680]`. (3) Two UAT `audit_requests` rows (operator's own) `[VERIFIED: STATE.md:443]`. (4) No `tenant_proofs`/`messaging_config_audit` tables yet | (1) arm via the new action; (2) write an explicit tenant sms `enabled=false` row before arming, or verify its gate is closed; (3) set `declined` via console; (4) migration 0036 |
| Live service config | (1) ClickSend: balance topped up 2026-09-10 after INSUFFICIENT_CREDIT `[VERIFIED: STATE.md:443]`; account Opt-Out List holds the operator's STOP handset `[VERIFIED: 04-07-SUMMARY]`; inbound + DLR rules on `app.backdesk.com.au` (Phase 8). (2) Resend: `quotes.backdesk.com.au` `status=verified`, region `ap-northeast-1`; no webhooks; API key Full access `[VERIFIED: 08-07-SUMMARY; STATE.md:450]`. (3) Supabase Auth URL configuration possibly still default localhost-only `[ASSUMED: dashboard-only]`. (4) pg_cron: four jobs on the custom domain `[VERIFIED: cron-status.mjs JOB_NAMES:44; Phase 8]` | (1) balance script pre-arm; Opt-Out List check for proof handsets; (2) none; (3) set Site URL + redirect list, record; (4) `npm run cron:status` before the window, never `cron:apply` during it |
| OS-registered state | None — verified: no launchd/systemd/Task Scheduler artefacts in this project (Vercel + Supabase hosted) | none |
| Secrets / env vars | No new variables. Existing: `CLICKSEND_USERNAME/API_KEY`, `RESEND_API_KEY` (Full access, local vs deployment drift risk `STATE.md:498`), `UNSUBSCRIBE_SIGNING_SECRET`, `APP_BASE_URL`, `OPERATOR_ALERT_PHONE/FROM`, `SM8_TEST_API_KEY` (trial), `MIGRATE_DATABASE_URL` (5432) | none; the ARM-04 run may export a client key in-shell for one command |
| Build artifacts | None — verified: no compiled/installed artefact depends on this phase | none |

## Common Pitfalls

### Pitfall 1: Arming SMS arms the test tenant too
**What goes wrong:** the global row arms every connected client; `13e8f2aa` is connected to a live trial account that held eligible quotes.
**Why:** `getChannelConfig` falls back to the global row for any tenant without its own (`messaging-config.ts:87-105`).
**How to avoid:** explicit tenant sms row `enabled=false` for the test tenant (Pattern 3) written through the console before arming; the arm control lists the clients it will arm.
**Warning signs:** `send_ledger` rows for tenant `13e8f2aa` after arming; escalation `sms_not_configured` counts are the *good* sign.

### Pitfall 2: The proof handset is on ClickSend's Opt-Out List
**What goes wrong:** the escalation SMS (or touch 1) is refused by the provider with an opt-out code; the escalation row records an UPPERCASE outcome, not `sent`.
**Why:** the 2026-08-30 STOP put the operator's handset on the account-level list (A3 finding).
**How to avoid:** check/remove in the ClickSend dashboard before the window; use a second handset as the "customer"; record in `docs/external-registrations.md`.
**Warning signs:** `outcome` matching `isOptOutCode` (`clicksend-client.ts:594`).

### Pitfall 3: Remote suites encode "production is disarmed"
**What goes wrong:** after arming, `npm run test:remote` goes red: `tests/routing-dispatch.test.ts:324` asserts `anyChannelEnabled('sms')` is `false` ("If that is not deliberate, disarm it"), and the fake-sender escalation test relies on seeded tenants having no config row (`tests/escalation.test.ts:404-416`) — with the global row armed, `resolveSmsFrom(seededTenant)` returns the number.
**Why:** those assertions were the alarm for accidental arming (04-07 SUMMARY deviation 2).
**How to avoid:** D-11 already forbids `test:remote` during go-live; additionally, in this phase, rewrite the routing-dispatch assertion to "no seeded tenant is armed" (seed an explicit `enabled=false` override for test tenants in `seed.ts`) and make the escalation test seed an explicit disarmed override. CI (local stack) is unaffected either way.
**Warning signs:** a red `test:remote` the day after go-live.

### Pitfall 4: `upsertChannelConfig` erases the identity on a bare `enabled` flip
**What goes wrong:** arming with `{channel, tenantId, enabled:true}` nulls `from_address` → `resolveSmsFrom` returns `null` → every send `sms_not_configured` with a green "Armed" badge.
**Why:** exhaustive `set` clause by design (`messaging-config.ts:203-213`).
**How to avoid:** `armChannel` re-reads the effective row inside the transaction and re-supplies all fields; a DB-backed test asserts `from_address` survives an arm→disarm→arm cycle.

### Pitfall 5: A failed Resend read must not read as "not verified" (or as "verified")
**What goes wrong:** the checklist says "not yet" during a Resend outage and the operator "fixes" a domain that is fine — or the gate lets an unverified domain through because a read error was treated as pass.
**How to avoid:** three-state item; refusal on read failure (`settings/email/actions.ts:247-256` rule); the page already tolerates checklist failure.

### Pitfall 6: The email proof has no ledger row and its unsubscribe link suppresses nothing
**What goes wrong:** the verification claims evidence that cannot exist (D-07's "send-ledger row", "suppressed_contacts rows").
**How to avoid:** Option A wording; the artefact is the Resend id + `last_event`; the click is proven live as `no_cadence` and semantically in the suite (Q6).

### Pitfall 7: The journal-ordering trap and the `when` stamp
**How to avoid:** one migration `0036`, `when > 1788919992174`, journal re-tagged (0035 header).

### Pitfall 8: The proof can be recorded for the wrong tenant or an unsent row
**How to avoid:** the proof action reads the artefact scoped to `tenantId` and requires `outcome='sent'` + provider id (escalation) / `last_event='delivered'` (email); refuse otherwise; the DB CHECK refuses an empty artefact id.

### Pitfall 9: Contact-hours window bounds the CON-03 window, escalation does not
**What goes wrong:** the operator runs the proof at 7 pm; touch 1 never dispatches (window), so no reply, so no escalation.
**How to avoid:** run inside the client's window; the escalation itself is window-free by design (`escalations.ts` header D-05).

### Pitfall 10: `RESEND_API_KEY` drift between `.env.local` and Vercel
**What goes wrong:** the script (local key) succeeds while the deployment (or vice versa) uses a different key.
**How to avoid:** confirm both are the Full-access key before the window (`STATE.md:498`); `vercel env ls production` shows presence, not equality — the script's own send is the equality proof for the local side.

## Code Examples

### Migration 0036 skeleton (hand-finished parts)
```sql
-- src/db/migrations/0036_phase10_go_live.sql — after drizzle-kit's CREATE TABLE / POLICY / INDEX output
-- Source: house pattern 0032:84-135, 0035:70-105 [VERIFIED]
ALTER TABLE public.tenant_proofs DROP CONSTRAINT IF EXISTS tenant_proofs_kind_known;
--> statement-breakpoint
ALTER TABLE public.tenant_proofs
  ADD CONSTRAINT tenant_proofs_kind_known
  CHECK (kind IN ('escalation_handset', 'email_pipe'));
--> statement-breakpoint
ALTER TABLE public.tenant_proofs DROP CONSTRAINT IF EXISTS tenant_proofs_artefact_present;
--> statement-breakpoint
ALTER TABLE public.tenant_proofs
  ADD CONSTRAINT tenant_proofs_artefact_present
  CHECK (length(artefact_id) BETWEEN 8 AND 128);
--> statement-breakpoint
ALTER TABLE public.messaging_config_audit DROP CONSTRAINT IF EXISTS messaging_config_audit_action_known;
--> statement-breakpoint
ALTER TABLE public.messaging_config_audit
  ADD CONSTRAINT messaging_config_audit_action_known
  CHECK (action IN ('arm', 'disarm'));
--> statement-breakpoint
ALTER TABLE public.messaging_config_audit DROP CONSTRAINT IF EXISTS messaging_config_audit_disarm_reason;
--> statement-breakpoint
ALTER TABLE public.messaging_config_audit
  ADD CONSTRAINT messaging_config_audit_disarm_reason
  CHECK (action <> 'disarm' OR (reason IS NOT NULL AND length(reason) > 0));
--> statement-breakpoint
REVOKE ALL ON public.tenant_proofs FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.tenant_proofs FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.messaging_config_audit FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.messaging_config_audit FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON public.tenant_proofs TO anon;
--> statement-breakpoint
GRANT SELECT ON public.tenant_proofs TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.tenant_proofs TO service_role;
--> statement-breakpoint
GRANT SELECT ON public.messaging_config_audit TO anon;
--> statement-breakpoint
GRANT SELECT ON public.messaging_config_audit TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.messaging_config_audit TO service_role;
```

### The transactional arm writer
```ts
// src/db/repository/messaging-config.ts — addition. Source: getDb() is PostgresJsDatabase (client.ts:40) [VERIFIED];
// upsert shape from :193-215 [VERIFIED]. The identity is RE-SUPPLIED because the set clause is exhaustive.
export interface ArmChannelInput {
  channel: MessagingChannel;
  tenantId: string | null;          // null = the global row (sms in v1)
  operatorUserId: string;
  reason?: string;
}

export async function armChannel(input: ArmChannelInput): Promise<{ config: MessagingConfigRow; auditId: string }> {
  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(messagingConfig)
      .where(and(eq(messagingConfig.channel, input.channel),
                 input.tenantId ? eq(messagingConfig.tenantId, input.tenantId) : isNull(messagingConfig.tenantId)))
      .limit(1);
    if (!existing?.fromAddress) throw new ArmError('no_identity'); // never arm a row with no from-address

    const [config] = await tx
      .insert(messagingConfig)
      .values({ ...existing, enabled: true })
      .onConflictDoUpdate({
        target: [messagingConfig.channel, messagingConfig.tenantId],
        set: { fromAddress: existing.fromAddress, replyTo: existing.replyTo ?? null,
               businessName: existing.businessName ?? null, enabled: true, updatedAt: new Date() },
      })
      .returning();

    const [audit] = await tx
      .insert(messagingConfigAudit)
      .values({ channel: input.channel, tenantId: input.tenantId, action: 'arm',
                operatorUserId: input.operatorUserId, reason: input.reason ?? null,
                fromAddress: existing.fromAddress })
      .returning({ id: messagingConfigAudit.id });

    return { config, auditId: audit.id };
  });
}
```

### Gate evaluation and refusal (framework-free core)
```ts
// src/core/onboarding/arming.ts — Source: checklist keys pattern checklist.ts:105-112 [VERIFIED]
export const ARMING_GATES: Record<MessagingChannel, readonly ChecklistItemKey[]> = {
  sms:   ['sm8Connected', 'contactHours', 'templatesApproved', 'sm8AutomationOff', 'escalationPhone'],
  email: ['sm8Connected', 'contactHours', 'templatesApproved', 'sm8AutomationOff', 'escalationPhone', 'sendingDomainVerified'],
};

export function firstUnmetGate(channel: MessagingChannel, checklist: GoLiveChecklist): ChecklistItemKey | null {
  const byKey = new Map(checklist.items.map((item) => [item.key, item]));
  for (const key of ARMING_GATES[channel]) {
    const item = byKey.get(key);
    if (!item?.satisfied) return key;   // absent == unmet, never vacuously true (T-5-13)
  }
  return null;
}
```

### Read-only ClickSend balance script (shape)
```js
// scripts/clicksend-balance.mjs — Source: setup-clicksend.mjs api() helper :203-230 [VERIFIED];
// response fields from the ClickSend OpenAPI spec GET /account example [CITED: apis.guru mirror — MEDIUM]
const { status, body } = await api('GET', '/account');
if (status !== 200) fail(`GET /v3/account returned ${status}`);
const { balance, _currency, low_credit_amount, auto_recharge } = body.data;
console.log(`clicksend balance: ${balance} ${_currency?.currency_name_short ?? '?'} ` +
            `(low-credit threshold ${low_credit_amount}, auto-recharge ${auto_recharge ? 'on' : 'off'})`);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Arming = `setup-clicksend.mjs --activate` or a manual UPDATE (`STATE.md:480`) | Console action + audit row (this phase) | Phase 10 | operator does not touch SQL; audit trail |
| "Messaging armed" one row (04-08/06-04) | per-channel rows + live derivation | Phase 10 | ARM-01 |
| Email delivery unknown after send | `GET /emails/{id}` `last_event` read | Phase 10 | proof artefact |
| Resend inbound: not available when Phase 4 was designed | Resend Receiving GA (Nov 2025 per press; docs live) `[CITED: alternativeto.net news 2025-11; resend.com/docs/dashboard/receiving]` | 2025-11 | makes Option B possible in v1.2; does not change v1's D-01 |

**Deprecated/outdated:** the STATE.md Phase 4 OWED/RESTORE bullets (`:473-474`) — resolved at `:478-480`; tidy them.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `GET https://rest.clicksend.com/v3/account` returns `data.balance` and `data._currency.currency_name_short` (from the OpenAPI spec mirror; the official docs page 404'd) | Q8 | balance script prints undefined — harmless, fix field names on first run |
| A2 | Supabase Auth URL Configuration still holds only the localhost default (dashboard-only; not readable from the repo) | Q8, Runtime State | password-reset links point at the wrong host; no effect on email+password login |
| A3 | `OPERATOR_ALERT_PHONE` is (or is not) the same handset that texted STOP on 2026-08-30 — unknown; the ClickSend Opt-Out List check is required regardless | Q5, Pitfall 2 | escalation SMS refused during the proof window |
| A4 | Resend Receiving MX values (`inbound`, priority 10) — third-party guide only | Q6 Option B | irrelevant unless Option B is chosen (deferred) |
| A5 | The founding client's ServiceM8 account will let the client (or operator) create a job with the operator's second handset as the contact | Q5 step 3 | fall back to the trial account for the CON-03 proof (still product paths; record it) |
| A6 | RESOLVED — `isHotLead` requires `confidence === 'high'` (`classify-inbound.ts:285`); only the model's confidence on the actual reply is uncertain | Q5 | a medium/low-confidence label is triaged, not escalated; send an unambiguous reply and retry with a clearer one if needed (cooldown is per cadence, 30 min) |
| A7 | Drizzle `db.transaction` over the Supabase transaction pooler (6543, `prepare:false`) is already exercised by `forTenant().transaction` in production paths, so the new writer needs no pooler change | Q3 | if wrong, arm+audit would need the session pooler — it is not wrong (`for-tenant.ts:3881-3884` runs in the attest action today) |

## Open Questions (RESOLVED)

1. **DOM-04 wording vs. code (RESOLVED — recommendation):** revise DOM-04 (and ROADMAP SC4) to Option A before the proof plan; record the revision in REQUIREMENTS.md and PROJECT.md Key Decisions. Optionally A+ for a live click. Option B is v1.2.
2. **Proof storage (RESOLVED — Claude's discretion):** new `tenant_proofs` table (artefact + recorded_by NOT NULL), not new attestation kinds.
3. **Where the controls sit (RESOLVED):** on the checklist card, beside the two arming rows and the two proof rows; the SMS arm uses the two-step inline confirm shape from `cadence-controls.tsx` and names the clients it arms.
4. **Should `sm8Connected` gate arming? (recommend YES)** — a dead key means no win detection; the checklist already treats a paused connection as unmet. Planner to confirm; D-05 lists only four gates + domain, so this is an addition inside the spirit of D-01.
   **RESOLVED — plan 10-01: `ARMING_GATES` includes `sm8Connected`.**
5. **Test tenant handling before arming (needs an operator choice):** explicit tenant `enabled=false` override (recommended, reversible, audited) vs. pausing its connection vs. leaving it (if its gate is closed). The runbook must record the choice.
   **RESOLVED — plan 10-07 Task 1 step 5: explicit `enabled=false` tenant sms row for 13e8f2aa with audit read-back before the arm decision.**
6. **Which handset stands in as the escalation phone (D-06 says record which):** operator's own vs. the tradie's; and whether that handset is on the ClickSend Opt-Out List. Runbook pre-check.
   **RESOLVED — plan 10-07 resume signals record which handset is the escalation phone and its Opt-Out status.**
7. **ARM-04 key source:** in-shell export of the client's private key for one run (recommended) vs. a `--tenant` decrypting path. If the client's automation must stay OFF (it must, post-attestation), seed the native follow-up on the trial account instead.
   **RESOLVED — plan 10-06 Task 2/3: probe on the trial account after a seeded native follow-up; key exported in-shell.**
8. **`test:remote` assertions after go-live (Pitfall 3):** rewrite in this phase or accept a red `test:remote` post-arming? Recommend rewriting in the console-work plan so the day-after run is meaningful.
   **RESOLVED — plan 10-04 Task 3 rewrites the two disarmed-state remote assertions to per-tenant questions.**
9. **Email arming when v1 cadences are SMS-only:** D-03 says arm the tenant email row; harmless (identity resolves, nothing drafts email). Confirm the card copy says "no email follow-ups are scheduled in v1" so the operator's expectation is right.
   **RESOLVED — plans 10-01/10-05: card copy states SMS-only cadence sends and the shared-number blast radius.**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | scripts, build | ✓ | v22.20.0 | — |
| npm | scripts | ✓ | 10.9.3 | — |
| Vercel CLI | env checks / deploy | ✓ | 59.10.0 | dashboard |
| `psql` | not needed (scripts use `postgres`) | ✓ | — | — |
| Supabase CLI | local stack for DB-backed suites | ✗ (not on PATH) | — | CI runs `supabase start` (`.github/workflows/ci.yml:90`); locally the DB-backed suites need `test:remote`, forbidden during go-live windows → rely on CI |
| Hosted Supabase (Sydney) | everything | ✓ (production) | Postgres 15+ | — |
| ClickSend account + balance | SMS proof | ✓ (topped up 2026-09-10) | — | balance script pre-arm |
| Resend account (Full-access key), `quotes.backdesk.com.au` verified | email proof | ✓ | — | — |
| ServiceM8 founding-client account (private key) | CON-03 proof, ARM-04 | **event-gated** (D-08) | — | trial account (`SM8_TEST_API_KEY`) for ARM-04 only |
| Two handsets (customer + escalation) | CON-03 proof | operator-provided | — | — |
| `dig` | DNS checks | stub (env note) | — | DoH via `curl https://dns.google/resolve?name=…` |

**Missing dependencies with no fallback:** the signed, connected founding client — the two proof plans stop at `checkpoint:human-action` (D-08).
**Missing dependencies with fallback:** Supabase CLI locally → CI.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (`vitest.config.mts`; `fileParallelism: false`; `setupFiles: tests/helpers/env.ts`; `globalSetup` pauses the production ticks on remote runs) |
| Config file | `vitest.config.mts` |
| Quick run command | `npx vitest run tests/<file>.test.ts` (pure suites); DB-backed suites need a local stack (CI) — never `npm run test:remote` in a go-live window (D-11) |
| Full suite command | `npm run test` (pure locally; DB-backed in CI after `supabase start`), `npm run typecheck`, `npm run lint` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARM-01 | 10 keys in order; each reader's satisfied/detail; domain lister injected (verified / not / unknown); live derivation | DB-backed (CI) | `npx vitest run tests/go-live-checklist.test.ts` | ❌ Wave 0 (and update `tests/onboarding-checklist-gate.test.ts:606-607`) |
| ARM-02 | `armChannel` writes config + audit atomically (rollback on audit failure), re-supplies identity, refuses no-identity; `disarmChannel` requires reason; tenant override beats global | DB-backed (CI) | `npx vitest run tests/messaging-config-arming.test.ts` | ❌ Wave 0 |
| ARM-02 | actions: `requireOperatorId` first, membership read, zod bounds, refusal on first unmet gate with the fixed sentence, **no write on refusal**, success sentence names armed clients | pure (mocked Supabase client + repository) | `npx vitest run tests/arming-actions.test.ts` | ❌ Wave 0 (pattern: `tests/email-settings-action.test.ts`) |
| ARM-02 | new tables have policies + exact grants; `messaging_config_audit` policy has the `is_operator()` arm | DB-backed (CI) | `npx vitest run tests/rls-coverage.test.ts` | ✅ extend |
| ARM-02 | console files still authorise (source-grep) and leak no provider strings | pure | `npx vitest run tests/operator-authorization.test.ts tests/console-error-leak.test.ts` | ✅ extend GUARDED_PATHS |
| D-02 | `tenant_proofs` append-only, artefact required (DB CHECK), latest-wins; proof action verifies the artefact live and refuses `outcome<>'sent'` / `last_event<>'delivered'` | DB-backed + pure | `npx vitest run tests/tenant-proofs.test.ts tests/proof-actions.test.ts` | ❌ Wave 0 |
| ARM-03 | escalation machinery (already 17/17 remote) | DB-backed | `npx vitest run tests/escalation.test.ts` | ✅ (assertion rewrite per Pitfall 3) |
| ARM-03 | **live handset delivery** | manual-only (production) | runbook step; evidence: escalation row id + provider id in `docs/external-registrations.md` + proof row | live |
| DOM-04 | headers/footer/identity; nine refusals; one-click both-channel suppression + idempotency | pure + DB-backed | `npx vitest run tests/resend-sender.test.ts tests/unsubscribe.test.ts tests/unsubscribe-suppression.test.ts` | ✅ |
| DOM-04 | **live send + delivered + live POST** | manual-only (production) | `npm run verify:email-pipe -- --tenant … --to …`; `node scripts/resend-email-status.mjs <id>` | live |
| ARM-04 | probe output recorded; field list in docs | manual + docs grep | `node scripts/sm8-spike.mjs probe` (trial or client key) | live |
| ARM-05 | runbook exists, references every checklist key and both proofs | pure (docs grep test, `tests/marketing-copy.test.ts` style) | `npx vitest run tests/runbook-contract.test.ts` | ❌ Wave 0 (optional) |
| Scripts | `clicksend-balance.mjs`, `escalations-recent.mjs`, `resend-email-status.mjs` print no credential/PII (source grep, `tests/cron-status-script.test.ts` pattern) | pure | `npx vitest run tests/ops-scripts.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the pure suites touched + `npm run typecheck` + `npm run lint`.
- **Per wave merge:** CI full run (DB-backed suites against the local stack).
- **Phase gate:** CI green; both proofs' artefact ids recorded in `10-VERIFICATION.md`; `npm run test:remote` deliberately NOT run in the go-live window (D-11) — run it after the window with Pitfall 3's rewrite in place.

### Wave 0 Gaps
- [ ] `tests/go-live-checklist.test.ts` — ARM-01
- [ ] `tests/messaging-config-arming.test.ts` — ARM-02 repository
- [ ] `tests/arming-actions.test.ts` — ARM-02 actions (mock pattern from `email-settings-action.test.ts`)
- [ ] `tests/tenant-proofs.test.ts` + `tests/proof-actions.test.ts` — D-02
- [ ] `tests/ops-scripts.test.ts` — no-secret/no-PII grep over the three new scripts
- [ ] `tests/helpers/seed.ts` — `seedMessagingConfigOverride(tenantId, channel, enabled=false)` and `seedProof(...)`; **never** seed an enabled row (04-03 rule, `email-settings-action.test.ts:20-24`)
- [ ] `tests/rls-coverage.test.ts` — two table names + grants

## Security Domain

Arming is the highest-consequence action in the product: it turns real customer messaging on for every connected client with no deploy.

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase session via `@supabase/ssr` `getClaims()`; no change |
| V3 Session Management | yes | cookie session; proxy gate (Phase 9) + per-action re-check (Server Action ids are global — `actions.ts:70-90`) |
| V4 Access Control | yes | `requireOperatorId()` (allowlist read through RLS, error = denial) THEN tenant membership read through the operator's JWT; service-role write only after both; RLS policies + SELECT-only grants on the new tables |
| V5 Input Validation | yes | zod: `z.uuid()` for tenant/artefact ids, `.trim().min(1).max(500)` for reason/note, bounded lengths before regex; `MESSAGING_CHANNELS` enum |
| V6 Cryptography | no new | unsubscribe token HMAC unchanged; SM8 keys AES-256-GCM unchanged |
| V7 Error handling / logging | yes | fixed sentences; caught values discarded; scripts print ids/counts/outcomes only |
| V8 Data protection | yes | proof `artefact_detail` holds ids/status only — never `to_address`, bodies, or customer names |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Any authenticated session POSTs the global arm action id | Elevation | `requireOperatorId()` before the body is read; membership read; test pins the order (`operator-authorization.test.ts` GUARDED_PATHS) |
| Operator arms the global row not realising it arms N clients | Repudiation / Tampering | blast-radius list in the control + success sentence; audit row with operator id; runbook step |
| Arm succeeds, audit insert fails | Repudiation | one transaction; DB-backed test forces the audit failure and asserts the config row is unchanged |
| Bare `enabled` flip nulls the identity (silent `sms_not_configured` everywhere) | DoS (silent) | identity re-supplied from the row; refuse arming a row without `from_address`; test |
| Proof recorded with a fabricated/foreign artefact id | Tampering | tenant-scoped live read of the artefact; `outcome='sent'` / `last_event='delivered'` required; DB CHECK on length |
| Proof for an unarmed channel | Tampering | refuse unless the channel resolves for the tenant |
| Resend read failure treated as "verified" | Elevation | read failure = refusal (existing rule) |
| SQL by hand on production during the window | Tampering | none permitted; scripts are read-only with explicit select lists; `cron:apply` forbidden in the window |
| Secrets in script output / evidence log | Information disclosure | scripts print balance/ids/status only; `docs/external-registrations.md` entries end with the standard "No credential value of any kind appears above" line |
| Test tenant chased with the shared number | Tampering (customer harm) | explicit tenant `enabled=false` override before arming; checklist for the test tenant reviewed |
| Provider opt-out list blocks the proof handset | DoS | pre-window Opt-Out List check; second handset |
| Escalation SMS to an attacker-controlled number | Spoofing | unchanged: escalation phone action requires membership (`actions.ts:349-404`); proof note records which handset |
| Disarm as a denial-of-service on a live client | DoS | disarm is never gated (D-05) but is audited with a required reason; the client page shows the last three audit rows |
| `test:remote` during the window pauses production ticks | DoS | D-11; `cron:status` shows `remote_test_lease rows` |

## Sources

### Primary (HIGH confidence — read this session)
- `src/core/onboarding/checklist.ts` (keys :105-112, reader :156-268), `src/app/(console)/clients/[id]/checklist-card.tsx` (:37-72), `page.tsx` (:720-741, :840-896), `actions.ts` (:138-162, :352-503), `action-state.ts`
- `src/db/schema/messaging-config.ts` (:83, :145-171), `src/db/repository/messaging-config.ts` (:70-105, :142-151, :193-215), `src/core/messaging/routing-sender.ts` (:185-189, :205-236, :248-258)
- `src/db/schema/tenant-attestations.ts` (:67, :86), `src/db/repository/for-tenant.ts` (:1593-1625, :3355-3374, :3881-3884, :2294-2326), `src/db/repository/client.ts` (:40-68)
- `src/db/schema/escalations.ts` (:108-113, :157), `src/core/escalation/escalate-hot-leads.ts` (:268, :294-303), `src/db/repository/for-all-tenants.ts` (:1251-1291, :1137), `src/core/classification/classify-inbound.ts` (:284-286), `src/core/cadence/run-tick.ts` (:784, :824), `src/app/api/internal/cadence-tick/route.ts` (:142-145)
- `src/core/messaging/resend-sender.ts` (:20-80, :263, :379), `src/core/messaging/resend-domains.ts` (:66, :208, :259), `src/app/api/unsubscribe/route.ts` (:198), `src/core/cadence/controls.ts` (:298, :391-397), `src/core/messaging/inbound.ts`, `src/app/api/webhooks/` listing
- `src/core/drafting/onboarding-gate.ts` (:86-200, :391, :484-513), `src/core/drafting/draft-touches.ts` (:752-772), `src/core/cadence/consume-events.ts` (:779)
- `src/app/(console)/settings/email/actions.ts` (:190-296), `page.tsx`, `forms.tsx`; `src/app/(console)/_auth.ts` (:52-72)
- `scripts/verify-email-pipe.mjs` (:48-207), `scripts/sm8-spike.mjs` (:27-120), `scripts/setup-clicksend.mjs` (:100-135, :195-245, :755), `scripts/cron-status.mjs` (:1-120), `scripts/audit-requests-count.mjs`
- `src/db/migrations/0032_phase6_console.sql` (:36-135), `0033_phase7_reporting.sql` (:1-45, :103-250), `0035_phase9_audit_requests.sql` (:1-30, :70-105), `meta/_journal.json` (tail), `src/db/migrations/README.md`
- `tests/onboarding-checklist-gate.test.ts` (:606-607), `tests/email-settings-action.test.ts` (:1-80), `tests/routing-dispatch.test.ts` (:300-330), `tests/escalation.test.ts` (:404-416, :516-650), `tests/rls-coverage.test.ts` (:118-134, :262-305), `tests/unsubscribe-suppression.test.ts` (:201, :244, :275), `tests/helpers/seed.ts`, `vitest.config.mts`, `.github/workflows/ci.yml` (:90, :211), `package.json`
- `.planning/STATE.md` (:440-503 Blockers), `.planning/PROJECT.md` (:48-51, :100-120), `.planning/milestones/v1.0-phases/04-messaging-gateway/04-07-SUMMARY.md`, `04-05-SUMMARY.md` (:72, :210-217), `04-10-SUMMARY.md`, `06-review-console-escalation/06-05-SUMMARY.md` (:318-340), `06-VERIFICATION.md`, `06-UAT.md` (:25-28), `06-UI-SPEC.md` (§3, Copywriting), `.planning/phases/08-brand-domains/08-07-SUMMARY.md`, `08-RESEARCH.md` (:273, :438, :568)
- `docs/servicem8-api-notes.md` (:169-215), `docs/external-registrations.md` (:426-680, :1850-1861, headings), `docs/env-vars.md`

### Secondary (MEDIUM confidence)
- ClickSend REST API v3 OpenAPI spec (apis.guru mirror) — `GET /account` 200 example: `data.balance`, `data._currency.currency_name_short`, `low_credit_amount`, `auto_recharge` (the official `developers.clicksend.com/docs/account` page returned 404 on fetch)
- https://resend.com/docs/api-reference/emails/retrieve-email — `GET /emails/{id}`, `last_event`
- https://resend.com/docs/webhooks/emails/received — `email.received` payload is metadata only
- https://resend.com/docs/api-reference/emails/retrieve-received-email — `GET /emails/receiving/{id}` returns html/text
- https://resend.com/docs/dashboard/receiving/introduction — receiving on "a verified domain"; MX required; no record values on the page

### Tertiary (LOW confidence)
- https://www.getfluxly.com/blog/resend-inbound-email (2026-07-29) — MX host `inbound`, priority 10; retention/size undocumented
- https://alternativeto.net/news/2025/11/resend-adds-inbound-feature-… — Resend Inbound launch (Nov 2025)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; versions read from `package.json`
- Architecture: HIGH — every mechanism cited from source; the two structural findings (no inbound email; SMS-only cadences) each rest on three independent code locations
- Pitfalls: HIGH for codebase pitfalls; MEDIUM for the ClickSend Opt-Out List (recorded in a Phase 4 summary, not re-read from the provider this session)
- Third-party facts: MEDIUM (ClickSend balance fields, Resend `last_event`), LOW (Resend inbound MX values)

**Research date:** 2026-09-11
**Valid until:** 2026-10-11 for codebase facts (re-verify if Phases 8–9 carry-forwards land first); 7 days for provider facts if Option B is ever revisited
