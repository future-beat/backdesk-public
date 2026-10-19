# Phase 10: First-Client Go-Live - Pattern Map

**Mapped:** 2026-09-11
**Files analyzed:** 27 (19 new, 8 modified)
**Analogs found:** 24 / 27 (3 are docs/runbook with a docs-shape analog only)

All line numbers below were read from source this session. Every excerpt is verbatim; the planner can cite `file:line` in plan actions.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/db/schema/tenant-proofs.ts` (new) | model | CRUD (append-only) | `src/db/schema/tenant-attestations.ts` | exact |
| `src/db/schema/messaging-config-audit.ts` (new) | model | CRUD (append-only, nullable tenant) | `src/db/schema/messaging-config.ts` (two-arm policy) + `tenant-attestations.ts` (append-only) | exact |
| `src/db/schema/index.ts` (mod) | config | — | itself, tail | exact |
| `src/db/migrations/0036_phase10_go_live.sql` (new) + `meta/_journal.json` (mod) | migration | batch | `src/db/migrations/0035_phase9_audit_requests.sql` | exact |
| `src/db/repository/messaging-config.ts` (mod: `armChannel`, `disarmChannel`, `listChannelAudit`) | repository | CRUD (transactional) | `upsertChannelConfig` (same file :193-212) + `for-tenant.ts:3881-3884` transaction + `client.ts:48` `getDb()` | exact |
| `src/db/repository/for-tenant.ts` (mod: `proofs` namespace) | repository | CRUD (append + latest) | `attestations` namespace (`for-tenant.ts:1593-1626` interface, `:3355-3376` impl) | exact |
| `src/db/repository/escalations.ts` (mod: `getEscalationForTenant`) | repository | request-response (read) | `listEscalationsForQuote` (`escalations.ts:236-253`) | exact |
| `src/db/repository/for-all-tenants.ts` (mod: `forAllTenants_armedBySmsGlobal`) | repository | request-response (cross-tenant read) | `forAllTenants_latestAttestations` (`for-all-tenants.ts:1136-1150`) | role-match |
| `src/db/repository/index.ts` (mod) | config | — | barrel line `:311-313` | exact |
| `src/core/messaging/resend-domains.ts` (mod: `isSendingDomainVerified`) | service | request-response (3rd-party) | `listDomains` (`resend-domains.ts:259-283`) + predicate in `settings/email/actions.ts:239-267` | exact |
| `src/core/messaging/resend-emails.ts` (new: `getEmailStatus`) | service | request-response (3rd-party) | `getDomain` (`resend-domains.ts:285-308`) | exact |
| `src/core/onboarding/checklist.ts` (mod: keys 6→10, `readGoLiveChecklist`, live derivation) | service | transform | itself (`checklist.ts:105-265`) | exact |
| `src/core/onboarding/arming.ts` (new: gate + refusal keys) | service | transform (pure) | `checklist.ts` header rule + `attestSm8AutomationOff` shape (`onboarding-gate.ts:484-513`) | role-match |
| `src/app/(console)/_auth.ts` (mod: `requireOperatorId`) | middleware | request-response | `requireOperator` (`_auth.ts:52-72`) | exact |
| `src/app/(console)/clients/[id]/checklist-card.tsx` (mod: labels, fixes, arm/disarm + proof forms) | component | request-response (`useActionState`) | itself (`:37-72`, `:94-97`, `:166-230`) + `quotes/[quoteId]/cadence-controls.tsx:159-190` (arm-then-confirm) | exact |
| `src/app/(console)/clients/[id]/actions.ts` (mod: `armChannelAction`, `disarmChannelAction`, `recordProofAction`) | controller (server action) | request-response | `attestSm8AutomationOffAction` (`actions.ts:432-510`) + `authorize` (`:138-163`) | exact |
| `src/app/(console)/clients/[id]/action-state.ts` (mod: `ARM_*` / `PROOF_*` sentences + blank states) | config | — | `AttestState` block (`action-state.ts:95-152`) | exact |
| `scripts/clicksend-balance.mjs` (new) | utility (ops script) | request-response (3rd-party) | `scripts/setup-clicksend.mjs:203-230` `api()` helper + `audit-requests-count.mjs` shell | exact |
| `scripts/escalations-recent.mjs` (new) | utility (ops script) | request-response (DB read) | `scripts/audit-requests-count.mjs:34-101` | exact |
| `scripts/resend-email-status.mjs` (new) | utility (ops script) | request-response (3rd-party) | `scripts/verify-email-pipe.mjs:48-85` (alias hook + args) | role-match |
| `scripts/verify-email-pipe.mjs` (mod: `--cadence` flag, optional) | utility | request-response | itself `:71-88` args, `:144-154` request | exact |
| `tests/go-live-checklist.test.ts` (new) | test | DB-backed | `tests/onboarding-checklist-gate.test.ts:601-615` | exact |
| `tests/messaging-config-arming.test.ts` + `tests/tenant-proofs.test.ts` (new) | test | DB-backed | `tests/escalation.test.ts:213-262` (config row lifecycle by id) + `seedAttestation` (`tests/helpers/seed.ts:296-310`) | exact |
| `tests/arming-actions.test.ts` + `tests/proof-actions.test.ts` (new) | test | pure (mocked) | `tests/email-settings-action.test.ts:27-60` | exact |
| `tests/ops-scripts.test.ts` (new) | test | pure (source grep) | `tests/cron-status-script.test.ts:1-45` | exact |
| `tests/rls-coverage.test.ts` (mod) + `tests/operator-authorization.test.ts` (mod) | test | DB-backed / pure | themselves (`rls-coverage:118-131`, `:262-310`; `operator-authorization:38-43`) | exact |
| `tests/routing-dispatch.test.ts:324` + `tests/escalation.test.ts:227-232` (mod: disarmed-state assertions) | test | DB-backed | themselves | exact |
| `docs/first-client-go-live-runbook.md` (new) | docs | — | `docs/servicem8-api-notes.md:169-218` (measured-fact section) + `docs/external-registrations.md:2440-2470` (dated evidence entry) | role-match |
| `docs/servicem8-api-notes.md` §own-comms (mod) | docs | — | itself `:169-218` | exact |

## Pattern Assignments

### `src/db/schema/tenant-proofs.ts` (model, append-only evidence)

**Analog:** `src/db/schema/tenant-attestations.ts`

**Imports pattern** (lines 49-51):
```typescript
import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
```
Add `jsonb` to the pg-core import for `artefact_detail`.

**Closed-vocabulary kind** (line 67-68) — copy the `as const` + derived type shape:
```typescript
export const TENANT_ATTESTATION_KINDS = ['sm8_automation_off'] as const;
export type TenantAttestationKind = (typeof TENANT_ATTESTATION_KINDS)[number];
```
For proofs: `export const TENANT_PROOF_KINDS = ['escalation_handset', 'email_pipe'] as const;`

**Core table pattern** (lines 70-120) — no FK on `tenant_id`, server-set timestamp, latest-wins index, `pgPolicy` in the schema:
```typescript
export const tenantAttestations = pgTable(
  'tenant_attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),
    /** One of TENANT_ATTESTATION_KINDS. CHECK-constrained in migration 0032. */
    kind: text('kind').notNull(),
    note: text('note').notNull(),
    attestedAt: timestamp('attested_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tenant_attestations_latest_idx').on(
      table.tenantId,
      table.kind,
      sql`${table.attestedAt} DESC`,
    ),
    pgPolicy('tenant_attestations_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type TenantAttestation = typeof tenantAttestations.$inferSelect;
export type NewTenantAttestation = typeof tenantAttestations.$inferInsert;
```
Proof additions: `artefactId: text('artefact_id').notNull()`, `artefactDetail: jsonb('artefact_detail').notNull().default({})`, `recordedBy: uuid('recorded_by').notNull()`, `recordedAt` in place of `attestedAt`; index `(tenant_id, kind, recorded_at DESC)`. The `kind` CHECK and the `length(artefact_id)` CHECK are hand-finished in the migration (the house rule for 0032's `CHECK (kind IN (...))`), or written with `check()` as `messaging-config.ts:131` does.

---

### `src/db/schema/messaging-config-audit.ts` (model, append-only, nullable tenant)

**Analog:** `src/db/schema/messaging-config.ts`

**Channel vocabulary reuse** (line 83) — import, do not re-spell:
```typescript
export const MESSAGING_CHANNELS = ['sms', 'email'] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];
```

**Nullable tenant + CHECK in schema** (lines 98, 131):
```typescript
    tenantId: uuid('tenant_id'),
    ...
    check('messaging_config_channel_known', sql`channel IN ('sms', 'email')`),
```
Add: `check('messaging_config_audit_action_known', sql\`action IN ('arm', 'disarm')\`)` and `check('messaging_config_audit_disarm_reason', sql\`action <> 'disarm' OR (reason IS NOT NULL AND length(reason) > 0)\`)`.

**Two-arm policy for a table with a global row** (lines 145-151) — copy verbatim, rename:
```typescript
    pgPolicy('messaging_config_member_or_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
      withCheck: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
    }),
```

---

### `src/db/migrations/0036_phase10_go_live.sql` + `meta/_journal.json` (migration)

**Analog:** `src/db/migrations/0035_phase9_audit_requests.sql`

**Header discipline** (lines 1-20) — one migration per phase, renamed tag, `when` checked:
```sql
-- GENERATED by drizzle-kit from src/db/schema/audit-requests.ts, then renamed
-- from its random tag (`0035_parallel_jamie_braddock`) and re-tagged in
-- meta/_journal.json. ... The
-- generator's `when` (1788919992174) is AHEAD of 0034's hand-stamped
-- 1788412215830, so no re-stamp was needed this time — checked rather than
-- assumed, because drizzle's migrator silently skips an entry older than the
-- last applied one.
```
Journal tail to extend (`meta/_journal.json`): 0035 is `idx: 35, when: 1788919992174, tag: "0035_phase9_audit_requests"`. 0036's `when` must exceed 1788919992174.

**Generated DDL shape** (lines 41-74) — CHECKs inline, RLS enabled, policy created:
```sql
CREATE TABLE "audit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	...
	CONSTRAINT "audit_requests_status_known" CHECK (status IN ('new', 'contacted', 'audited', 'declined')),
);
--> statement-breakpoint
ALTER TABLE "audit_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_requests_created_idx" ON "audit_requests" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "audit_requests_operator_access" ON "audit_requests" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_operator()) WITH CHECK (is_operator());--> statement-breakpoint
```

**Hand-finished REVOKE-then-GRANT block** (lines 93-121) — copy per new table:
```sql
REVOKE ALL ON public.audit_requests FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.audit_requests FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON public.audit_requests TO anon;
--> statement-breakpoint
GRANT SELECT ON public.audit_requests TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.audit_requests TO service_role;
--> statement-breakpoint
```
Same block for `tenant_proofs` and `messaging_config_audit` (SELECT-only to anon/authenticated). Note the `is_operator()` created-in-0009 caveat at line 22-23 applies to the audit table's policy.

---

### `src/db/repository/messaging-config.ts` (repository, transactional writer)

**Analog:** itself + `client.ts` + `for-tenant.ts`

**Imports** (lines 33-42):
```typescript
import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { messagingConfig } from '@/db/schema';
import type {
  MessagingChannel,
  MessagingConfigRow,
  NewMessagingConfigRow,
} from '@/db/schema';

import { getDb } from './client';
```
Add `desc` and `messagingConfigAudit` to these.

**The only write path — exhaustive set (lines 193-212)** — `armChannel` MUST re-supply every field:
```typescript
export async function upsertChannelConfig(
  row: MessagingConfigUpsert,
): Promise<MessagingConfigRow> {
  const [written] = await getDb()
    .insert(messagingConfig)
    .values(row)
    .onConflictDoUpdate({
      target: [messagingConfig.channel, messagingConfig.tenantId],
      set: {
        fromAddress: row.fromAddress ?? null,
        replyTo: row.replyTo ?? null,
        businessName: row.businessName ?? null,
        enabled: row.enabled ?? false,
        updatedAt: new Date(),
      },
    })
    .returning();

  return written;
}
```

**Effective-row read, override first** (lines 70, 87-105) — `armChannel` reads this inside the transaction before upserting:
```typescript
const OVERRIDE_FIRST = asc(isNull(messagingConfig.tenantId));

export async function getChannelConfig(
  channel: MessagingChannel,
  tenantId?: string | null,
): Promise<MessagingConfigRow | null> {
```

**Transaction handle** (`for-tenant.ts:1945-1946`, `:3881-3884`) — the handle type and the nested-savepoint rule:
```typescript
/** Any drizzle handle: the pool, or a transaction bound to one connection. */
type DbLike = RepositoryDb | Parameters<Parameters<RepositoryDb['transaction']>[0]>[0];
...
    transaction: <T,>(fn: (repo: TenantScopedRepository) => Promise<T>): Promise<T> =>
      // Nested transactions become savepoints in drizzle, so calling this from
      // inside an existing transaction is correct rather than a deadlock.
      db.transaction((tx) => fn(build(tenantId, tx))),
```
Shape for the new writer: `getDb().transaction(async (tx) => { const current = await <select via tx with OVERRIDE_FIRST>; const [written] = await tx.insert(messagingConfig).values({...current identity, enabled: true}).onConflictDoUpdate({...same exhaustive set...}).returning(); await tx.insert(messagingConfigAudit).values({channel, tenantId, action: 'arm', operatorUserId, reason, fromAddress: written.fromAddress}); return { config: written, audit }; })`. Refactor the upsert body into a private `upsertWith(db: DbLike, row)` so `upsertChannelConfig` and `armChannel` share one statement (the file's "one write path" rule, lines 170-192).

**Guarded write precedent** (`escalations.ts:169-185`) — the `.where(and(eq(id), isNull(outcome)))` guard shape if `disarmChannel` should refuse a no-op:
```typescript
    .where(and(eq(escalations.id, id), isNull(escalations.outcome)))
    .returning({ id: escalations.id });

  return { recorded: rows.length > 0 };
```

**Barrel** (`src/db/repository/index.ts:311-313`) — extend the same export list:
```typescript
  upsertChannelConfig,
  type MessagingConfigUpsert,
} from './messaging-config';
```

---

### `src/db/repository/for-tenant.ts` — `proofs` namespace (repository, append + latest)

**Analog:** `attestations` namespace

**Interface** (lines 1593-1626) — copy the doc discipline (`note` required at type level, timestamp not a parameter, `[]` means "not recorded"):
```typescript
  attestations: {
    append(row: {
      kind: TenantAttestationKind;
      note: string;
    }): Promise<TenantAttestation[]>;

    latest(kind: TenantAttestationKind): Promise<TenantAttestation[]>;
  };
```

**Implementation** (lines 3355-3376):
```typescript
    attestations: {
      // INSERT, and nothing else. `attestedAt` is deliberately NOT set here —
      // the column's `defaultNow()` is what makes the moment the database's.
      append: (row: { kind: TenantAttestationKind; note: string }) =>
        db.insert(tenantAttestations).values({ tenantId, ...row }).returning(),

      latest: (kind: TenantAttestationKind) =>
        db
          .select()
          .from(tenantAttestations)
          .where(
            and(
              eq(tenantAttestations.tenantId, tenantId),
              eq(tenantAttestations.kind, kind),
            ),
          )
          // MAX(attested_at) as an ordered LIMIT 1, because the caller needs
          // the whole ROW. `id DESC` is the tiebreak ...
          .orderBy(desc(tenantAttestations.attestedAt), desc(tenantAttestations.id))
          .limit(1),
    },
```
`proofs.append` takes `{ kind: TenantProofKind; artefactId: string; artefactDetail: Record<string, unknown>; note: string; recordedBy: string }`; `proofs.latest(kind)` orders by `recordedAt DESC, id DESC`.

---

### `src/db/repository/escalations.ts` — `getEscalationForTenant(tenantId, id)` (repository, single-row read)

**Analog:** `listEscalationsForQuote` (lines 236-253)

**Core pattern** — explicit select list (no `to_address`, no `body_segments`), tenant in the predicate:
```typescript
export async function listEscalationsForQuote(
  tenantId: string,
  quoteId: string,
): Promise<EscalationEvidence[]> {
  return getDb()
    .select({
      id: escalations.id,
      inboundMessageId: escalations.inboundMessageId,
      cadenceId: escalations.cadenceId,
      quoteId: escalations.quoteId,
      sentAt: escalations.sentAt,
      outcome: escalations.outcome,
      createdAt: escalations.createdAt,
    })
    .from(escalations)
    .where(and(eq(escalations.tenantId, tenantId), eq(escalations.quoteId, quoteId)))
    .orderBy(escalations.createdAt);
}
```
The new read adds `providerMessageId: escalations.providerMessageId` to the select, keys on `eq(escalations.id, id)`, `.limit(1)`. The header's rule (lines 227-235): the family lives outside `forTenant()` and `tenantId` travels in the call.

---

### `src/db/repository/for-all-tenants.ts` — `forAllTenants_armedBySmsGlobal()` (cross-tenant read, ids + names only)

**Analog:** `forAllTenants_latestAttestations` (lines 1136-1150)

**Core pattern** — join `tenants` for names, bounded by tenant count:
```typescript
export async function forAllTenants_latestAttestations(
  kind: TenantAttestationKind,
): Promise<LatestTenantAttestation[]> {
  const rows = await getDb()
    .selectDistinctOn([tenantAttestations.tenantId], {
      tenantId: tenantAttestations.tenantId,
      tenantName: tenants.name,
      attestedAt: tenantAttestations.attestedAt,
    })
    .from(tenantAttestations)
```
The new reader: `select({ id: tenants.id, name: tenants.name }).from(tenants).innerJoin(sm8Connections, ...paused_at IS NULL...).where(notExists(select from messagingConfig where channel='sms' and tenantId = tenants.id and enabled = false))`. Returns ids and names only.

---

### `src/core/messaging/resend-domains.ts` — `isSendingDomainVerified(address, lister = listDomains)` (service, third-party read, three-state)

**Analog:** the predicate as it exists in `src/app/(console)/settings/email/actions.ts:239-267` + `listDomains` (`resend-domains.ts:259-283`)

**Predicate to extract** (`settings/email/actions.ts:239-267`):
```typescript
    const domain = domainOfAddress(from_address);
    if (!domain) {
      return { ...BLANK_EMAIL_SETTINGS_STATE, error: 'Enter a valid from-address.' };
    }

    const domains = await listDomains();
    if (!domains.ok) {
      // A read failure is treated as REFUSAL, not as a pass. Every failure mode
      // here — key revoked, provider down, network gone — is a state in which
      // "let the write through" means possibly arming email on a domain nobody
      // has verified.
      console.error(`[settings/email] domain list failed: ${domains.reason}`);
      return {
        ...BLANK_EMAIL_SETTINGS_STATE,
        error: 'Could not check the domain right now. Nothing was saved — try again in a moment.',
      };
    }

    const verified = domains.domains.some(
      (candidate) => candidate.name.toLowerCase() === domain && candidate.status === VERIFIED_STATUS,
    );
```
Return type for the extracted helper: `{ kind: 'verified' } | { kind: 'unverified'; domain: string } | { kind: 'unknown'; reason: string }`. Then make the settings action call it (one spelling).

**No-throw wrapper shape** (`resend-domains.ts:259-283`) — reuse for `resend-emails.ts` `getEmailStatus(id)`:
```typescript
export async function listDomains(): Promise<ListDomainsResult> {
  const key = apiKey();
  if (!key) return failure('not_configured');

  try {
    const { data, error } = await new Resend(key).domains.list();

    if (error) return failure(error.name);
    if (!data) return failure('empty_response');

    return {
      ok: true,
      domains: (data.data ?? []).map((domain) => ({
        id: domain.id,
        name: domain.name,
        status: codeOf(domain.status),
        region: boundedLabel(domain.region),
        createdAt: domain.created_at ?? null,
      })),
    };
  } catch (e) {
    return failure(e instanceof Error ? e.name : 'unknown_error');
  }
}
```
`getEmailStatus(id)` = `new Resend(key).emails.get(id)` → `{ ok: true, lastEvent: codeOf(data.last_event), to: domainOfAddress-only }` — `error.name` only, never the message; `codeOf` bounds the vocabulary.

---

### `src/core/onboarding/checklist.ts` (service, one derivation; keys 6→10)

**Analog:** itself

**Imports** (lines 41-47):
```typescript
import {
  hasApprovedTemplateSet,
  SM8_AUTOMATION_ATTESTATION_KIND,
} from '@/core/drafting/onboarding-gate';
import { resolveEmailIdentity, resolveSmsFrom } from '@/core/messaging/routing-sender';
import { formatContactDays, formatContactTime } from '@/core/shared/tenant';
import { forTenant } from '@/db/repository';
```
Add `normalizeAuMobile` from `@/core/cadence/primary-contact`, `getChannelConfig` from `@/db/repository`, and `isSendingDomainVerified` (injected via a `deps` param so the DB-backed test stubs it).

**Key union** (lines 105-114) — extend in place:
```typescript
export const CHECKLIST_ITEM_KEYS = [
  'sm8Connected',
  'contactHours',
  'voiceProfile',
  'templatesApproved',
  'sm8AutomationOff',
  'messagingArmed',
] as const;

export type ChecklistItemKey = (typeof CHECKLIST_ITEM_KEYS)[number];
```

**Parallel reads** (lines 160-181) — add the new readers to the same `Promise.all`:
```typescript
  const [
    tenantRows,
    connectionRows,
    settingsRows,
    templatesApproved,
    attestationRows,
    smsFrom,
    emailIdentity,
  ] = await Promise.all([
    repo.tenant.get(),
    repo.connection.get(),
    repo.settings.get(),
    hasApprovedTemplateSet(repo),
    repo.attestations.latest(SM8_AUTOMATION_ATTESTATION_KIND),
    // THE PER-TENANT AUTHORITY, never `anyChannelEnabled` (04-08 CR-01).
    resolveSmsFrom(tenantId),
    resolveEmailIdentity(tenantId),
  ]);
```

**Item row shape** (lines 218-253) — the row to split into `smsArmed` / `emailArmed`:
```typescript
  const armed: string[] = [];
  if (smsFrom) armed.push(`SMS from ${smsFrom}`);
  if (emailIdentity) armed.push(`email from ${emailIdentity.fromAddress}`);
  ...
    {
      key: 'messagingArmed',
      satisfied: armed.length > 0,
      detail: armed.length > 0 ? armed.join(' · ') : null,
    },
```
New rows: `{ key: 'smsArmed', satisfied: smsFrom !== null, detail: smsFrom ? \`from ${smsFrom} (shared number)\` : null }`, `{ key: 'emailArmed', satisfied: emailIdentity !== null, detail: emailIdentity?.fromAddress ?? null }`, `{ key: 'escalationPhone', satisfied: normalizeAuMobile(tenant?.escalationPhone ?? null) !== null, detail: tenant?.escalationPhone ?? null }`, proof rows `detail: \`recorded ${date} · ${artefactId}\``. Derive `live` in the same function; never store it.

**Connection-live rule** (lines 190-195) — keep as the `sm8Connected` gate:
```typescript
  const sm8Connected = connection !== null && connection.pausedAt === null;
```

---

### `src/core/onboarding/arming.ts` (service, pure gate evaluation)

**Analog:** the "one conjunction" rule — `onboarding-gate.ts` `attestSm8AutomationOff` (lines 484-513) for the core-returns-outcome shape

**Core-returns-outcome shape** (`onboarding-gate.ts:484-513`):
```typescript
export async function attestSm8AutomationOff(
  tenantId: string,
  note: string,
  now: Date,
): Promise<AttestSm8AutomationOffResult> {
  const repo = forTenant(tenantId);

  const written = await repo.transaction(async (tx) => {
    const [attestation] = await tx.attestations.append({
      kind: SM8_AUTOMATION_ATTESTATION_KIND,
      note,
    });

    if (!attestation) throw new Error('attestSm8AutomationOff: the INSERT returned no row.');

    const { resumedIds, conditions } = await resumeIfOnboardingComplete(tx);

    return { attestedAt: attestation.attestedAt, resumedIds, conditions };
  });

  return {
    kind: 'attested',
    attestedAt: written.attestedAt,
    conditions: written.conditions,
    ...(await finishResume(tenantId, now, written.resumedIds)),
  };
}
```
`arming.ts` is pure: `ARMING_GATE: Record<MessagingChannel, readonly ChecklistItemKey[]>` and `firstUnmetGate(channel, items): ChecklistItemKey | null` walking `CHECKLIST_ITEM_KEYS` in order. No copy, no `next/*` — the action maps the key to a sentence.

---

### `src/app/(console)/_auth.ts` — `requireOperatorId()` (middleware)

**Analog:** `requireOperator` (lines 52-72) — same allowlist read, same "read error is denial"; keep the `sub` instead of discarding it:
```typescript
export async function requireOperator(): Promise<OperatorCheck> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return 'unauthenticated';

  const { data, error } = await supabase
    .from('operator_allowlist')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  // A read error is treated as denial rather than as a pass. ...
  if (error || !data) return 'forbidden';

  return 'ok';
}
```
Add beside it: `requireOperatorId(): Promise<{ ok: true; userId: string } | { ok: false; reason: 'unauthenticated' | 'forbidden' }>`; implement `requireOperator` as a thin call into it so the allowlist read exists once. Denial copy lives at lines 81-84 (`OPERATOR_DENIED_MESSAGE`).

---

### `src/app/(console)/clients/[id]/actions.ts` — `armChannelAction`, `disarmChannelAction`, `recordProofAction` (controller)

**Analog:** `attestSm8AutomationOffAction` (lines 432-510) + `authorize` (lines 138-163)

**Imports** (lines 1-11, 29-45):
```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { attestSm8AutomationOff } from '@/core/drafting/onboarding-gate';
import { ESCALATION_PHONE_MESSAGE, escalationPhoneSchema } from '@/core/shared/tenant';
...
import { forTenant } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

// State shapes + BLANK_* constants live in ./action-state — a 'use server'
// module may export only async functions (invalid-use-server-value).
import {
  ATTEST_NOTE_MAX,
  ...
  type AttestState,
} from './action-state';
```
Add `import { requireOperatorId } from '../../_auth';` (the `operator-authorization.test.ts:64` regex requires the import to come from a module path ending in `_auth`).

**Authorization: membership read through the operator's own JWT** (lines 138-163) — reuse as-is, call AFTER `requireOperatorId()`:
```typescript
async function authorize(tenantId: string): Promise<ConnectState | null> {
  if (!UUID_PATTERN.test(tenantId)) {
    return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return {
      ...BLANK_CONNECT_STATE,
      formError: 'Your session has expired. Sign in again.',
    };
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    return { ...BLANK_CONNECT_STATE, formError: 'Unknown client.' };
  }

  return null;
}
```

**Validation: bounded, trimmed, never defaulted** (lines 432-438):
```typescript
const attestSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, ATTEST_NOTE_REQUIRED_MESSAGE)
    .max(ATTEST_NOTE_MAX, ATTEST_NOTE_TOO_LONG_MESSAGE),
});
```
Arm: `z.object({ channel: z.enum(MESSAGING_CHANNELS), reason: z.string().trim().max(500).optional() })`; disarm: `reason` `.min(1)`; proof: `z.object({ kind: z.enum(TENANT_PROOF_KINDS), artefact_id: z.string().trim().min(8).max(128), note: z.string().trim().min(1).max(500) })`. UUID check via `UUID_PATTERN` (line 65) or `z.uuid()` (line 253 precedent).

**Core action pattern: authorise → validate → core call in try/catch → revalidate → sentence** (lines 468-510):
```typescript
export async function attestSm8AutomationOffAction(
  tenantId: string,
  _previous: AttestState,
  formData: FormData,
): Promise<AttestState> {
  const denied = await authorize(tenantId);
  if (denied) {
    return { ...BLANK_ATTEST_STATE, error: denied.formError ?? 'Unknown client.' };
  }

  const raw = formData.get('note');
  const parsed = attestSchema.safeParse({ note: typeof raw === 'string' ? raw : '' });
  if (!parsed.success) {
    return {
      ...BLANK_ATTEST_STATE,
      error: parsed.error.issues[0]?.message ?? ATTEST_NOTE_REQUIRED_MESSAGE,
    };
  }

  let result: Awaited<ReturnType<typeof attestSm8AutomationOff>>;
  try {
    result = await attestSm8AutomationOff(tenantId, parsed.data.note, new Date());
  } catch {
    // The caught value is DISCARDED: the statement's parameters include the
    // operator's own evidence note about this client.
    console.error('[clients] attestation write failed');
    return { ...BLANK_ATTEST_STATE, error: ATTEST_WRITE_FAILED_MESSAGE };
  }

  revalidatePath(`/clients/${tenantId}`);

  return {
    ...BLANK_ATTEST_STATE,
    success: attestRecordedMessage({
      templatesApproved: result.conditions.templatesApproved,
      cadencesResumed: result.cadencesResumed,
    }),
  };
}
```
For `armChannelAction`, between validate and the write: `const checklist = await readGoLiveChecklist(tenantId, new Date()); const unmet = firstUnmetGate(channel, checklist.items); if (unmet) return { ...BLANK_ARM_STATE, error: ARM_REFUSAL[unmet] };` — no write on refusal. For `recordProofAction`, between validate and the write: verify the artefact live (`getEscalationForTenant` → `outcome === 'sent' && providerMessageId`; or `getEmailStatus` → `lastEvent === 'delivered'`) and refuse with a fixed sentence otherwise.

**Error-arm discipline** (lines 393-404) — caught value discarded, fixed log line, fixed sentence:
```typescript
  try {
    await forTenant(tenantId).tenant.update({ escalationPhone: phone });
  } catch {
    console.error('[clients] escalation phone write failed');
    return {
      ...BLANK_ESCALATION_PHONE_STATE,
      error: ESCALATION_PHONE_WRITE_FAILED_MESSAGE,
    };
  }
```

---

### `src/app/(console)/clients/[id]/action-state.ts` — `ARM_*` / `PROOF_*` (config, fixed sentences)

**Analog:** the `AttestState` block (lines 95-152)

**State + blank + fixed sentences** (lines 99-122):
```typescript
export type AttestState = {
  error: string | null;
  success: string | null;
};

export const BLANK_ATTEST_STATE: AttestState = { error: null, success: null };

export const ATTEST_NOTE_REQUIRED_MESSAGE =
  'Say what you saw — "opened Settings → Automation with Dave, Quote Follow Up is off". Typing it is the record that somebody actually looked.';

export const ATTEST_NOTE_TOO_LONG_MESSAGE =
  'Keep it under 500 characters — it records what you saw, not the whole conversation.';

/** The evidence note's ceiling, matching the template-approval note's. */
export const ATTEST_NOTE_MAX = 500;
```

**Sentence-as-function for a variable consequence** (lines 88-93) — the shape for the SMS blast-radius sentence:
```typescript
export function escalationPhoneSavedMessage(phone: string | null): string {
  if (phone === null) {
    return 'Cleared. Hot-lead alerts will not be texted to anyone for this client until a number is set.';
  }
  return `Saved. Hot leads for this client will be texted to ${phone}.`;
}
```
New: `armedMessage(channel, armedClients: {name}[])` → `'Armed. SMS is on for every connected client from the next tick — 2 clients: A, B.'`; `ARM_REFUSAL: Record<GatingKey, string>`; `ARM_DOMAIN_UNKNOWN_MESSAGE = 'Could not check the sending domain right now. Nothing was armed — try again in a moment.'` (mirrors `settings/email/actions.ts:255`). The header (lines 1-9) is why these live here and not in `actions.ts`.

---

### `src/app/(console)/clients/[id]/checklist-card.tsx` (component, `useActionState` forms + arm-then-confirm)

**Analog:** itself + `quotes/[quoteId]/cadence-controls.tsx`

**Imports** (lines 1-7):
```typescript
'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { attestSm8AutomationOffAction } from './actions';
import { BLANK_ATTEST_STATE } from './action-state';
```
Add `useState`, the three new actions, their blank states. Types stay `import type` (the 06-02 build break, lines 29-33).

**Label / fix maps — `Record` over the key union** (lines 37-72): a new key is a compile error until both maps carry it:
```typescript
const ITEM_LABELS = {
  sm8Connected: 'ServiceM8 connected',
  contactHours: 'Contact hours set',
  voiceProfile: 'Voice profile set',
  templatesApproved: 'Templates approved',
  sm8AutomationOff: 'ServiceM8 auto follow-up off',
  messagingArmed: 'Messaging armed',
} as const;

type ItemKey = keyof typeof ITEM_LABELS;

const ITEM_FIX: Record<ItemKey, { href: (tenantId: string) => string; label: string } | null> = {
  sm8Connected: { href: () => '#servicem8-connection', label: 'Set it up →' },
  contactHours: null,
  voiceProfile: {
    href: (tenantId) => `/clients/${tenantId}/drafting`,
    label: 'Set it up →',
  },
  templatesApproved: {
    href: (tenantId) => `/clients/${tenantId}/drafting`,
    label: 'Approve templates →',
  },
  sm8AutomationOff: null,
  messagingArmed: null,
};
```
New labels (console voice): `escalationPhone: 'Escalation phone set'`, `sendingDomainVerified: 'Sending domain verified'`, `smsArmed: 'SMS armed'`, `emailArmed: 'Email armed'`, `escalationHandsetProof: 'Escalation handset proof recorded'`, `emailPipeProof: 'Email pipe proof recorded'`. Fixes: `sendingDomainVerified: { href: () => '/settings/email', label: 'Verify it →' }`, the rest `null` (control is on the card).

**Hook binding + row dispatch** (lines 94-97, 110-146):
```typescript
  const [state, formAction, pending] = useActionState(
    attestSm8AutomationOffAction.bind(null, tenantId),
    BLANK_ATTEST_STATE,
  );
  ...
        {items.map((item) => {
          const fix = ITEM_FIX[item.key];
          const attested = item.key === 'sm8AutomationOff';
          ...
              {attested ? (
                <AttestRow attestation={attestation} formAction={formAction} pending={pending} state={state} />
              ) : null}
```
Add one hook per new action and dispatch `ArmRow` on `smsArmed`/`emailArmed`, `ProofRow` on the two proof keys — same `key === '…'` switch.

**The writable-row form** (lines 196-227) — required note, no placeholder, inline `role="alert"` / `role="status"`:
```tsx
      <details className="disclosure" open={!attested || attestation.isStale}>
        <summary>{attested ? 'Record it again' : "Record it's off"}</summary>

        <form action={formAction}>
          {state.error ? (
            <p className="error" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p className="muted" role="status">
              {state.success}
            </p>
          ) : null}

          <label htmlFor="attest-note">How did you verify it?</label>
          <p className="muted meta">
            Open the client&rsquo;s ServiceM8 &rarr; Settings &rarr; Automation and confirm
            Quote Follow Up is off, then say what you saw.
          </p>
          <textarea id="attest-note" name="note" rows={3} required disabled={pending} />

          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : "Record it's off"}
          </button>
        </form>
      </details>
```
`ProofRow` = this form with `<input name="artefact_id" required>` + textarea `note` + hidden `kind`.

**Arm-then-confirm, not `confirm()`** (`cadence-controls.tsx:80`, `:159-190`) — the SMS arm control copies this and states the blast radius in the warning:
```tsx
  const [armed, setArmed] = useState(false);
  ...
        armed ? (
          <>
            {/* The consequence, stated between the two taps rather than after
                them. This is the sentence the arm step exists to show. */}
            <p className="kill-warning" role="alert">
              This stops the sequence and blocks this contact for good — on this quote and on
              every future one. There is no undo.
            </p>
            <form action={killAction}>
              <input type="hidden" name="cadence_id" value={cadenceId} />
              <button
                type="submit"
                className="kill-armed"
                disabled={killPending}
                onClick={() => setLast('kill')}
              >
                {killPending ? 'Stopping…' : 'Yes — never contact them again'}
              </button>
            </form>
            <button type="button" onClick={() => setArmed(false)} disabled={killPending}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setArmed(true)}>
            Never contact this customer again
          </button>
        )
```
Warning copy for SMS: "This arms SMS for every connected client on the next tick — {n} clients: {names}. Real customer messages will send from +61491579212." Disarm form: `<textarea name="reason" required>` (reason mandatory). The `last`-tapped single message slot (`cadence-controls.tsx:102-106`) is needed if more than one hook's message renders in one region.

**Page wiring** (`page.tsx:868-896`) — the card's dates are formatted in the tenant zone by the page, and the failed-read fallback keeps the `#ready-to-send` anchor:
```tsx
          attestation={{
            attestedOn: checklist.attestation.attestedAt
              ? formatInTenantZone(checklist.attestation.attestedAt, tenant.timezone, {
                  dateStyle: 'medium',
                })
              : null,
```
Proof "recorded on {date}" and the last-three audit rows are formatted here the same way and passed as plain strings.

---

### `scripts/clicksend-balance.mjs` (ops script, third-party read)

**Analog:** `scripts/setup-clicksend.mjs:203-230` `api()` + `scripts/audit-requests-count.mjs` shell

**ClickSend call helper** (`setup-clicksend.mjs:203-230`) — never throws on HTTP error, `e.name` only:
```javascript
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: AUTHORIZATION,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // `e.name` only. A fetch rejection stringifies to a message that can carry
    // the request URL, and this URL is built from our credentials' account.
    fail(`ClickSend ${method} ${path} failed: ${e instanceof Error ? e.name : 'UnknownError'}`);
  }

  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Leave null — the caller reports the status, which is the diagnosable part.
  }
  return { status: res.status, body: parsed };
}
```
`AUTHORIZATION` = `'Basic ' + Buffer.from(\`${CLICKSEND_USERNAME}:${CLICKSEND_API_KEY}\`).toString('base64')` (read via `loadEnv()`/`requireEnv()` from `scripts/lib/support.mjs:9-26`). Call `GET /v3/account`; print `data.balance` + `data._currency.currency_name_short` and nothing else.

**Script shell** (`audit-requests-count.mjs:34-57`):
```javascript
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
```

---

### `scripts/escalations-recent.mjs` (ops script, DB read, no PII)

**Analog:** `scripts/audit-requests-count.mjs:47-101`

**URL guard + connection** (lines 47-59) — parse inside `try`, never echo the value:
```javascript
const url = process.env.MIGRATE_DATABASE_URL;
if (!url) fail('MIGRATE_DATABASE_URL is not set — see docs/env-vars.md');

try {
  new URL(url);
} catch {
  fail('MIGRATE_DATABASE_URL is not a parseable URL — see docs/env-vars.md');
}

const sql = postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 });
```

**Explicit select list, closed-vocabulary output, `end()` in both arms** (lines 61-101):
```javascript
try {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM audit_requests) AS total,
      ...
      newest.created_at,
      newest.status,
    FROM ( ... ORDER BY created_at DESC, id DESC LIMIT 1 ) AS newest
  `;
  ...
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```
Select list for escalations: `id, tenant_id, cadence_id, outcome, sent_at, provider_message_id, created_at` — never `to_address`, never a body. `--tenant <uuid>` via the `args()` helper in `verify-email-pipe.mjs:71-79`, validated against a UUID regex before it reaches the query.

---

### `scripts/resend-email-status.mjs` (ops script, third-party read via TS core)

**Analog:** `scripts/verify-email-pipe.mjs:48-69` (alias hook to reuse TS modules)

```javascript
import { register } from 'node:module';

import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
const env = requireEnv('RESEND_API_KEY', ...);

// Teach node the `@/` alias, then import the real modules.
register('./lib/ts-alias-hook.mjs', import.meta.url);
const { ResendSender, buildEmailMessage, isOwnerOnlySender, OWNER_ONLY_SENDER_DOMAIN } =
  await import('@/core/messaging/resend-sender');
```
Import `getEmailStatus` from `@/core/messaging/resend-emails` the same way so the script and the proof action share one wrapper. Print `last_event` and the `to` domain only.

---

### `scripts/verify-email-pipe.mjs` (`--cadence` flag, optional A+ scope)

**Analog:** itself — the arg parser (lines 71-88) and the request (lines 144-154):
```javascript
function args(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--')) return null;
    parsed[argv[i].slice(2)] = argv[i + 1];
  }
  return parsed;
}
...
  const request = {
    ledgerId: 'verify-email-pipe',
    tenantId: TENANT_ID,
    quoteId: randomUUID(),
    // A RANDOM CADENCE: the link must verify and must suppress nothing.
    cadenceId: randomUUID(),
    touchNumber: 1,
    channel: 'email',
    to: { address: TO, contactName: null },
    body: PROOF_BODY,
  };
```
With `--cadence <id>`: read the cadence through `forTenant(TENANT_ID).cadences…` to prove it belongs to the tenant and is live before minting the token over it; print a loud "THIS LINK SUPPRESSES A REAL CONTACT" line; keep the header's "deliberately inert" paragraph (lines 36-41) true for the default path.

---

### Tests

**`tests/go-live-checklist.test.ts`** — analog `tests/onboarding-checklist-gate.test.ts:601-615`; update that file's two assertions in the same plan:
```typescript
    expect(checklist.items.map((item) => item.key)).toEqual([...CHECKLIST_ITEM_KEYS]);
    expect(checklist.items).toHaveLength(6);
```

**`tests/messaging-config-arming.test.ts` / `tests/tenant-proofs.test.ts`** — analog `tests/escalation.test.ts:213-262`: residue alarm first, tenant-scoped fictional row, tracked by id, deleted by id FIRST in `afterAll`:
```typescript
beforeAll(async () => {
  expect(
    await anyChannelEnabled('sms'),
    'An sms config row is already ENABLED before this suite wrote one — most ' +
      'likely residue from an interrupted run. ...',
  ).toBe(false);
  ...
  const row = await upsertChannelConfig({
    channel: 'sms',
    tenantId: armedTenantId,
    fromAddress: FROM_NUMBER,
    enabled: true,
  });
  configIds.push(row.id);
});

afterAll(async () => {
  for (const id of configIds) {
    await admin.from('messaging_config').delete().eq('id', id);
  }
  ...
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
```
Seed helper analog `tests/helpers/seed.ts:296-310` for `seedProof` / `seedMessagingConfigOverride` (service-role insert, kind fixed, `overrides` spread last):
```typescript
export async function seedAttestation(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('tenant_attestations').insert({
    tenant_id: tenantId,
    kind: 'sm8_automation_off',
    note: 'seeded — checked Settings → Automation',
    ...overrides,
  });
  if (error) throw new Error(`Seeding an attestation failed: ${error.message}`);
}
```
`seedMessagingConfigOverride` must default `enabled: false` and refuse `enabled: true` (04-03 rule).

**Disarmed-state assertions to rewrite (Pitfall 3)** — `tests/routing-dispatch.test.ts:324-329` and `tests/escalation.test.ts:227-232` both assert:
```typescript
    expect(
      await anyChannelEnabled('sms'),
      'An sms config row is ENABLED — global, or one client\'s override. Real ' +
        'customer SMS is armed on the next cadence tick. If that is not ' +
        'deliberate, disarm it before doing anything else.',
    ).toBe(false);
```
Rewrite to "no SEEDED tenant resolves an SMS identity": seed an explicit `enabled=false` override for each test tenant, then `expect(await resolveSmsFrom(seededTenantId)).toBeNull()` — the per-tenant question, which stays true after the global row is armed for the founding client.

**`tests/arming-actions.test.ts` / `tests/proof-actions.test.ts`** — analog `tests/email-settings-action.test.ts:27-60` (mock repository + `next/cache`, keep the rule under test real, fake the Supabase session one level below `requireOperator`):
```typescript
const upsertChannelConfig = vi.fn(async (row: unknown) => row);
const listDomains = vi.fn<() => Promise<ListDomainsResult>>();
const revalidatePath = vi.fn();

vi.mock('@/db/repository', () => ({
  upsertChannelConfig: (row: unknown) => upsertChannelConfig(row),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

vi.mock('@/core/messaging/resend-domains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/messaging/resend-domains')>()),
  createDomain: (name: string) => createDomain(name),
  verifyDomain: (id: string) => verifyDomain(id),
  listDomains: () => listDomains(),
}));

let session: { userId: string | null; allowlisted: boolean } = {
  userId: 'operator-1',
  allowlisted: true,
```
Mock `armChannel` / `readGoLiveChecklist` the same way; assert `armChannel` is never called when a gate is unmet.

**`tests/ops-scripts.test.ts`** — analog `tests/cron-status-script.test.ts:1-45`: source read, comments stripped, regex assertions:
```typescript
const SOURCE = readFileSync('scripts/cron-status.mjs', 'utf8');

const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('scripts/cron-status.mjs — read-only and credential-free by construction', () => {
  it('never reads or prints the raw command column', () => {
    ...
    expect(CODE).not.toMatch(/console\.(log|error)\([^)]*command/);
  });
```
For the three new scripts: no `to_address`, no `SELECT \*`, no `console.log(...url|...API_KEY|...AUTHORIZATION)`, only `SELECT` statements.

**`tests/rls-coverage.test.ts`** — two edits: the `table_name IN (...)` list (lines 118-131) and the exact-grants map (append after line 309):
```typescript
          'escalations', 'tenant_attestations',
          'quote_attributions', 'monthly_reports', 'tenant_fees',
          'audit_requests', 'audit_request_throttle'
        )
...
      'tenant_fees/anon': 'SELECT',
      'tenant_fees/authenticated': 'SELECT',
    });
```
Add `'tenant_proofs', 'messaging_config_audit'` and four map entries, all `'SELECT'`.

**`tests/operator-authorization.test.ts`** — extend `GUARDED_PATHS` (lines 38-43) with `'src/app/(console)/clients/[id]/actions.ts'` ONLY if the whole file is expected to import `requireOperator`/`requireOperatorId` from `_auth` — the regex at line 64 is `import\s*\{[^}]*\brequireOperator\b[^}]*\}\s*from\s*['"][^'"]*_auth['"]` and line 58 requires a `requireOperator(` call, so `requireOperatorId(` satisfies neither; either widen the regexes to `requireOperator(Id)?` or have the new actions call `requireOperator()` and a sibling to read the id.

---

### Docs

**`docs/first-client-go-live-runbook.md`** — no runbook exists; nearest shapes:
- Step-with-artefact table: `docs/external-registrations.md:2462-2470` (probe | result):
```markdown
| Probe | Result |
|---|---|
| `curl -s -o /dev/null -w '%{http_code}' https://backdesk.com.au/login` | **404** |
```
- Measured-fact section with "what this proves / what stays unmeasured / next measurement": `docs/servicem8-api-notes.md:169-218`.
- Evidence entries are append-only, dated `## 2026-09-DD — <what>` headings (`external-registrations.md:2064, 2213, 2440`), ids and outcomes only, never addresses or bodies.

**`docs/servicem8-api-notes.md` §own-comms** — replace the table at lines 173-177 with the measured rows and follow the numbered "next measurement" list at lines 207-213:
```markdown
| Endpoint | HTTP | Rows | Fields observed |
|---|---|---|---|
| `GET /api_1.0/sms.json` | **200** | 0 | — (empty array) |
| `GET /api_1.0/email.json` | **200** | 0 | — (empty array) |
...
3. Record the field list here. Tier 1 becomes designable only if a row carries a
   job UUID (or something that resolves to one) **and** a send timestamp.
```

## Shared Patterns

### Operator-first authorisation on every mutating action
**Source:** `src/app/(console)/_auth.ts:52-72` (allowlist read through the operator's own JWT; read error = denial) and `clients/[id]/actions.ts:138-163` (`authorize` membership read).
**Apply to:** `armChannelAction`, `disarmChannelAction`, `recordProofAction`. Order: `requireOperatorId()` → `authorize(tenantId)` → parse body. Nothing in `formData` is read before both pass (`actions.ts:281-282` comment).

### Fixed sentences live in `action-state.ts`, never inline
**Source:** `action-state.ts:1-9` header (a `'use server'` module may export only async functions).
**Apply to:** all new refusal/success copy (`ARM_REFUSAL`, `armedMessage`, `PROOF_*`). Console voice: plain, no exclamation marks.

### Discard the caught error, log a fixed line, return a fixed sentence
**Source:** `actions.ts:393-404` and `:492-499`.
**Apply to:** every `try` around `armChannel`, `disarmChannel`, `proofs.append`. The statement parameters carry a reason/note the operator typed and, for proofs, a provider id.

### Evidence table family rules
**Source:** `tenant-attestations.ts:39-47` header; `escalations.ts:227-235`.
**Apply to:** `tenant_proofs`, `messaging_config_audit`. No FK on `tenant_id`, no cascade; `pgPolicy` in the schema file; SELECT-only grants to anon/authenticated; server-set timestamps; no UPDATE/DELETE accessor in the repository.

### One migration per phase, journal re-tagged, `when` checked
**Source:** `0035_phase9_audit_requests.sql:1-20`; `meta/_journal.json` tail (0035 `when: 1788919992174`).
**Apply to:** `0036_phase10_go_live.sql` carrying both tables; no other plan in the phase touches the journal.

### Third-party reads never throw; `error.name` only; three-state results
**Source:** `resend-domains.ts:259-283`; `setup-clicksend.mjs:203-230`.
**Apply to:** `isSendingDomainVerified`, `getEmailStatus`, `clicksend-balance.mjs`. A failed read is `unknown` → the checklist says "could not check" and the arm action refuses (`settings/email/actions.ts:246-256` rule).

### Per-tenant identity resolvers, never `anyChannelEnabled`, on any per-client surface
**Source:** `checklist.ts:27-32` header; `messaging-config.ts:117-141`.
**Apply to:** `smsArmed`/`emailArmed` rows, the arm refusal, the rewritten remote-suite assertions.

### Read-only production probes as repo scripts
**Source:** `cron-status.mjs:13-31`, `audit-requests-count.mjs:11-33`.
**Apply to:** the three new scripts. `process.loadEnvFile('.env.local')` (or `loadEnv()`), explicit select lists, closed-vocabulary output, no credential or PII printed, `sql.end()` in both arms.

### Test-side: never leave an enabled `messaging_config` row behind; seeded tenants are explicitly OFF
**Source:** `tests/escalation.test.ts:221-262`; `tests/email-settings-action.test.ts:20-24`.
**Apply to:** every new DB-backed suite and the Pitfall 3 rewrite.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `docs/first-client-go-live-runbook.md` | docs | — | No operator runbook exists in `docs/`; use the step/artefact table and dated-entry shapes cited above plus RESEARCH.md Q5/Q8 sequences |
| `src/core/onboarding/arming.ts` gating map | service | pure | No existing per-channel gate map; the "one conjunction" rule (`onboarding-gate.ts:180-190`) is the design precedent, not a code shape |
| `forAllTenants_armedBySmsGlobal` `NOT EXISTS` predicate | repository | cross-tenant | No existing "tenants lacking an override row" query; nearest is the `tenants` join in `forAllTenants_latestAttestations` |

## Metadata

**Analog search scope:** `src/db/schema`, `src/db/repository`, `src/db/migrations`, `src/core/onboarding`, `src/core/drafting`, `src/core/messaging`, `src/app/(console)/_auth.ts`, `src/app/(console)/clients/[id]/**`, `src/app/(console)/settings/email`, `scripts/`, `scripts/lib`, `tests/`, `tests/helpers`, `docs/`
**Files scanned:** 31 read (targeted ranges for `for-tenant.ts`, `for-all-tenants.ts`, `rls-coverage.test.ts`, `setup-clicksend.mjs`, `page.tsx`)
**Pattern extraction date:** 2026-09-11
