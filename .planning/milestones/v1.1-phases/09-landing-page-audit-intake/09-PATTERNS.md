# Phase 9: Landing Page & Audit Intake - Pattern Map

**Mapped:** 2026-09-09
**Files analyzed:** 46 new/modified files (from CONTEXT.md D-01..D-19, RESEARCH.md "Recommended Project Structure", UI-SPEC C-1..C-13)
**Analogs found:** 38 / 46 (8 files have no in-repo analog: fonts, robots, sitemap, not-found, marketing.css, storage client, brand assets, one-off scripts)

Every excerpt below was read from the working tree this session. Line numbers are as of commit `78d1790`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(marketing)/layout.tsx` (new) | layout | request-response (static) | `src/app/layout.tsx` + `src/app/(console)/layout.tsx` | role-match |
| `src/app/(marketing)/fonts.ts` (new) | config | static | none (`next/font/google`; RESEARCH §4) | none |
| `src/app/(marketing)/marketing.css` (new) | stylesheet | static | `src/app/(console)/audits/[id]/audit.css` (page-scoped CSS import) + `globals.css` class vocabulary | role-match |
| `src/app/(marketing)/copy.ts` (new) | utility (copy module) | static | `src/core/reporting/copy.ts` + `tests/reporting-copy.test.ts` | role-match |
| `src/app/(marketing)/page.tsx` (new, `/`) | page | static | `src/app/login/page.tsx` (page outside the console shell, metadata export) | role-match |
| `src/app/(marketing)/privacy/page.tsx` (new) | page | static | `src/app/login/page.tsx` | role-match |
| `src/app/(marketing)/audit/page.tsx` (new) | page | request-response | `src/app/(console)/audits/new/page.tsx` | exact |
| `src/app/(marketing)/audit/form.tsx` (new) | component (client) | request-response (multipart) | `src/app/(console)/audits/new/form.tsx` | exact |
| `src/app/(marketing)/audit/actions.ts` (new) | server action | request-response (write + notify) | `src/app/(console)/audits/new/actions.ts` (form/zod/File shape) + `src/app/(console)/clients/new/actions.ts` (self-authorising action) | exact |
| `src/app/(marketing)/audit/action-state.ts` (new) | utility | static | `src/app/(console)/audits/new/action-state.ts` | exact |
| `src/app/(marketing)/audit/field-error.tsx` (new) | component | static | `FieldError` in `src/app/(console)/audits/new/form.tsx:8-15` | exact |
| `src/app/(marketing)/audit/thanks/page.tsx` (new) | page | static | `src/app/login/page.tsx` | role-match |
| `src/app/not-found.tsx` (new) | page | static | none | none |
| `src/app/robots.ts`, `src/app/sitemap.ts` (new) | route (metadata) | static | none (Next metadata routes; RESEARCH §4) | none |
| `proxy.ts` (modify) | middleware | request-response | itself + `src/lib/supabase/proxy.ts` | exact |
| `src/lib/supabase/proxy.ts` (modify: `rewriteTo`) | middleware | request-response | itself | exact |
| `next.config.ts` (modify: `bodySizeLimit`) | config | static | itself | exact |
| `src/app/(console)/clients/page.tsx` (moved from `(console)/page.tsx`) | page | CRUD read (RLS) | `src/app/(console)/page.tsx` (the file itself, moved) | exact |
| `src/app/(console)/clients/new/actions.ts:128`, `src/app/(console)/audits/[id]/actions.ts:67` (modify `revalidatePath('/')`) | server action | — | themselves | exact |
| `src/app/(console)/audits/page.tsx` (modify: `Requests` link) | page | CRUD read | itself | exact |
| `src/app/(console)/audits/requests/page.tsx` (new) | page (list) | CRUD read (RLS) | `src/app/(console)/audits/page.tsx` (read contract) + `src/app/(console)/inbox/page.tsx:199-262` (`.touch-list` rows) | exact |
| `src/app/(console)/audits/requests/[id]/page.tsx` (new) | page (detail) | CRUD read (RLS) | `src/app/(console)/audits/[id]/page.tsx:121-175` | exact |
| `src/app/(console)/audits/requests/[id]/status-form.tsx` (new) | component (client) | request-response | `src/app/(console)/clients/[id]/escalation-phone-form.tsx` + `components/action-message.tsx` | exact |
| `src/app/(console)/audits/requests/[id]/actions.ts` (new) | server action | CRUD write (service role) | `src/app/(console)/audits/[id]/actions.ts` (`convertProspectAction`) | exact |
| `src/app/(console)/audits/requests/[id]/action-state.ts` (new) | utility | static | `src/app/(console)/audits/[id]/action-state.ts` / `components/action-state.ts` (`ControlState`) | exact |
| `src/app/(console)/audits/requests/[id]/csv/route.ts` (new) | route handler | file-I/O (download) | `src/app/api/internal/sync-tick/route.ts` (auth-first route shape) + `src/app/(console)/_auth.ts` | role-match |
| `src/app/(console)/audits/new/page.tsx` (modify: `?request=` pre-fill) | page | CRUD read | itself + `src/app/login/page.tsx:10-19` (`searchParams` read) | exact |
| `src/app/(console)/audits/new/form.tsx` (modify: `initial`, hidden `request_id`) | component | request-response | itself | exact |
| `src/app/(console)/audits/new/actions.ts` (modify: bucket `File`, `markAuditRequestConverted`) | server action | request-response | itself (`stageCsvUpload`, lines 94-166) | exact |
| `src/db/schema/audit-requests.ts` (new) | model | CRUD | `src/db/schema/prospects.ts` (tenant-less table + `is_operator()` policy) + `src/db/schema/messaging-config.ts:169` (`check()`) + `src/db/schema/escalations.ts:167-176` (`index()`) | exact |
| `src/db/schema/audit-request-throttle.ts` (new) | model | CRUD (counter) | `src/db/schema/prospects.ts` | role-match |
| `src/db/schema/index.ts` (modify) | config (barrel) | — | itself | exact |
| `src/db/migrations/0035_phase9_audit_requests.sql` (new) | migration | DDL | `0013_prospects.sql` (generated half) + `0014_prospect_grants_and_purge.sql` (grants/CHECK/cron half) + `0034` header (hand-written idempotency) | exact |
| `src/db/migrations/meta/_journal.json` (modify) | config | — | itself (idx 34 `when: 1788412215830`) | exact |
| `src/db/repository/audit-requests.ts` (new) | repository | CRUD (service role) | `src/db/repository/prospects.ts` + `src/db/repository/escalations.ts:85-103` (`onConflict` upsert) | exact |
| `src/db/repository/audit-uploads.ts` (new) | repository (storage) | file-I/O | `src/db/repository/client.ts` (lazy service-role client shape) | partial |
| `src/db/repository/index.ts` (modify: two barrel lines) | config (barrel) | — | itself, lines 104-119 | exact |
| `src/core/intake/audit-request.ts` (new, zod) | utility (schema) | transform | `auditSchema` in `audits/new/actions.ts:58-67` + `normalizeAuMobile`/`normalizeEmail` in `src/core/cadence/primary-contact.ts:129-149` | exact |
| `src/core/intake/ip-hash.ts`, `throttle.ts`, `csv-sniff.ts` (new, pure) | utility | transform | `src/core/escalation/message.ts` (pure, framework-free, test-pinned) | role-match |
| `src/core/alerts/operator-email.ts` (modify: kind `audit_request`) | service (provider boundary) | request-response | itself | exact |
| `src/core/alerts/operator-sms.ts` (new) | service (provider boundary) | request-response | `src/core/alerts/operator-email.ts:179-230` + `sendSms` in `src/core/messaging/clicksend-client.ts:179-270` + `getChannelConfig` in `src/db/repository/messaging-config.ts:87-110` | exact |
| `src/core/shared/env.ts` (modify: 3 keys) | config | — | itself (lines 153-172 and 231-259) | exact |
| `src/core/brand.ts` (modify: 7 exports) | utility (import-free) | static | itself + `tests/brand.test.ts:95-166` | exact |
| `src/app/globals.css` (modify: tokens, `--accent-fg`, request-list classes) | stylesheet | static | itself (lines 7-33, 317-346, 535-567, 697-739) | exact |
| `src/app/(console)/audits/[id]/audit.css:123`, `reports/[client]/[reportId]/report.css:104-111` (modify) | stylesheet | static | themselves | exact |
| `public/brand/*` + `scripts/brand/*` (new) | asset | static | `logo/backdesk-favicon.svg`, `logo/backdesk-mark-720.svg` (source art) | partial |
| `docs/env-vars.md`, `.github/workflows/ci.yml`, `tests/helpers/env.ts` (modify) | config/docs | — | themselves | exact |
| Tests (12 new + 5 edits, RESEARCH "Wave 0 Gaps") | test | — | `tests/brand.test.ts`, `tests/layout-contract.test.ts`, `tests/cadence-tick-route.test.ts:580-597`, `tests/escalation-message.test.ts`, `tests/sync-failure-alerts.test.ts`, `tests/rls-coverage.test.ts:116-311` | exact |

---

## Pattern Assignments

### 1. `src/app/(marketing)/audit/form.tsx` (client component, multipart request-response)

**Analog:** `src/app/(console)/audits/new/form.tsx` (161 lines; copy the whole shape).

**Imports + FieldError** (lines 1-15). `FieldError` is the D-19 `aria` pattern; lift it into `field-error.tsx` and import it from both forms:
```tsx
'use client';

import { useActionState, useState } from 'react';

import { createAuditAction } from './actions';
import { BLANK_AUDIT_STATE } from './action-state';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id} role="alert">
      {message}
    </p>
  );
}
```

**State hook + form-level error + one wired field** (lines 41-64). Every marketing field copies this triple: `defaultValue` from `state.values`, `aria-invalid` only when an error exists, `aria-describedby` pointing at `{name}-error` (UI-SPEC C-8 adds the `{name}-hint` id to the same attribute):
```tsx
const [state, formAction, pending] = useActionState(createAuditAction, BLANK_AUDIT_STATE);
...
<form action={formAction}>
  {state.formError ? (
    <p className="error" role="alert">
      {state.formError}
    </p>
  ) : null}

  <label htmlFor="business_name">Business name</label>
  <input
    id="business_name"
    name="business_name"
    type="text"
    required
    autoFocus
    maxLength={120}
    defaultValue={state.values.business_name}
    aria-invalid={state.errors.business_name ? true : undefined}
    aria-describedby={state.errors.business_name ? 'business_name-error' : undefined}
  />
  <FieldError id="business_name-error" message={state.errors.business_name} />
```

**Radio group in a fieldset** (lines 66-96) is the `Are you on ServiceM8?` yes/no shape (`label.check` rows):
```tsx
<fieldset>
  <legend>Data source</legend>
  ...
  <label className="check">
    <input type="radio" name="source" value="api_key" checked={source === 'api_key'} onChange={() => setSource('api_key')} />
    Read-only API key
  </label>
```

**File input + pending button** (lines 120-158):
```tsx
<input id="csv_file" name="csv_file" type="file" accept=".csv,text/csv" required
  aria-invalid={state.errors.csv_file ? true : undefined}
  aria-describedby={state.errors.csv_file ? 'csv_file-error' : undefined} />
<FieldError id="csv_file-error" message={state.errors.csv_file} />
...
<button type="submit" disabled={pending}>
  {pending ? 'Reading the export…' : 'Upload and map columns'}
</button>
```

**Deltas the marketing form must add on top of the analog** (RESEARCH §5, UI-SPEC C-8/C-9): `method="post"`, `encType="multipart/form-data"`, `noValidate`, a `<fieldset disabled={pending}>` wrapper, the off-screen honeypot `<input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true">` inside `div.hp`, `aria-busy` on the submit, and the `.button.button--lg` class. No `useState` for a source switch is needed; the CSV field is always rendered (optional).

---

### 2. `src/app/(marketing)/audit/actions.ts` (server action: honeypot -> throttle -> insert -> upload -> notify -> redirect)

**Analog A (form/zod/File handling):** `src/app/(console)/audits/new/actions.ts`.

**Imports + state type + `readString`** (lines 1-14, 44-72):
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Papa from 'papaparse';
import { z } from 'zod';

import { MAX_CSV_BYTES, MAX_CSV_ROWS, type CsvRow } from '@/core/audit/csv-mapping';
import { createProspect } from '@/db/repository';
...
export type CreateAuditState = {
  /** Message under the failing control. */
  errors: { business_name?: string; api_key?: string; csv_file?: string };
  /** A failure belonging to no single control. */
  formError: string | null;
  values: { business_name: string; source: string };
};

const auditSchema = z.object({
  business_name: z
    .string()
    .trim()
    .min(1, 'Enter the prospect’s business name.')
    .max(120, 'That name is too long.'),
  ...
});

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}
```

**Zod issue -> per-field error map** (lines 237-249). Return every failing field at once (UI-SPEC E7 "partial"):
```ts
const parsed = auditSchema.safeParse({ business_name: values.business_name, api_key: readString(formData, 'api_key') });

if (!parsed.success) {
  const errors: CreateAuditState['errors'] = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === 'business_name' || field === 'api_key') errors[field] = issue.message;
  }
  return { errors, formError: null, values };
}
```

**File presence + size-before-read** (lines 99-113, 225-232). The size cap binds before a byte is read; copy the ordering:
```ts
const file = formData.get('csv_file');
if (!(file instanceof File) || file.name === '') {
  return { errors: { csv_file: 'Choose the Job List CSV exported from ServiceM8.' }, formError: null, values };
}
...
if (file.size === 0) {
  return { errors: { csv_file: 'That file is empty.' }, formError: null, values };
}
if (file.size > MAX_CSV_BYTES) {
  return { errors: { csv_file: `That file is larger than ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))}MB. ...` }, formError: null, values };
}
const text = await file.text();
const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true, preview: MAX_CSV_ROWS + 1 });
```
For the public form the sniff is `Papa.parse(text, { preview: 1 })` with `>= 2` columns (UI-SPEC "CSV acceptance"); the marketing copy for size/type errors is locked in the UI-SPEC Copywriting Contract, not the console strings above.

**Success = `redirect()` after revalidate** (lines 164-165, 267-268): `revalidatePath('/audits'); redirect(...)`. The public action redirects to `/audit/thanks` and should also `revalidatePath('/audits/requests')`.

**Analog B (what replaces `requireOperator()`):** `src/app/(console)/clients/new/actions.ts:44-99` is the "form is convenience, the action is the trust boundary" header. The public action has no session, so the equivalent block is honeypot -> throttle -> zod, in that order, before any write. Copy the comment discipline (lines 79-85) and the fixed-sentence failure shape (lines 119-123):
```ts
return {
  errors: {},
  formError: 'Could not create the client. Try again.',
  values,
};
```

**Reading the client IP.** No analog in `src/app`; use `headers()` from `next/headers` in the action and pass the first `x-forwarded-for` value to the pure `hashClientIp` (RESEARCH "Code Examples"). Keep the hashing in `src/core/intake/ip-hash.ts` so the action stays thin.

**Notification fan-out** (RESEARCH §8): `Promise.allSettled([sendOperatorAlert(...), sendOperatorSms(...)])` then `recordAuditRequestNotify(id, outcomes)`. Both senders already never throw (see §7), so `allSettled` is belt-and-braces.

**Lint constraints the action must respect:** `'use server'` files export only async functions (`tests/lint-ban.test.ts:729-744`); no `SUPABASE_SERVICE_ROLE_KEY` reference under `src/app` (`ci.yml:67`); no deep repository import (`eslint.config.mjs:31-48`), so every write goes through `@/db/repository`.

---

### 3. `src/app/(marketing)/audit/action-state.ts` and `field-error.tsx`

**Analog:** `src/app/(console)/audits/new/action-state.ts` (13 lines, copy verbatim with the new type):
```ts
/**
 * Blank initial state for the new-audit form. Lives outside actions.ts because
 * a `'use server'` module may export only async functions — a const export is
 * stripped/invalid under the use-server loader (invalid-use-server-value) ...
 */
import type { CreateAuditState } from './actions';

export const BLANK_AUDIT_STATE: CreateAuditState = {
  errors: {},
  formError: null,
  values: { business_name: '', source: 'api_key' },
};
```
The marketing `values` carry every D-10 field except the file.

---

### 4. `src/app/(marketing)/layout.tsx`, `page.tsx`, `privacy/page.tsx`, `audit/page.tsx`, `audit/thanks/page.tsx`

**Analog for a page outside the console shell:** `src/app/login/page.tsx` (57 lines). It is the only shipped page that renders without `(console)/layout.tsx`, imports the brand module, exports `metadata`, and reads `searchParams` through a `Promise`:
```tsx
import type { Metadata } from 'next';

import { SERVICE_NAME } from '@/core/brand';
...
export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  ...
  return (
    <main className="auth">
      <h1>{SERVICE_NAME}</h1>
```
Marketing pages differ in two ways: they wrap in `header/main#main/footer` landmarks (UI-SPEC C-1/C-7) and they do NOT set `dynamic = 'force-dynamic'` (they must prerender). `/` uses `title: { absolute: ... }` to bypass the root template; `/audit/thanks` adds `robots: { index: false }`.

**Analog for the page-with-form composition:** `src/app/(console)/audits/new/page.tsx` (35 lines):
```tsx
import type { Metadata } from 'next';
import Link from 'next/link';

import { NewAuditForm } from './form';

export const metadata: Metadata = { title: 'New audit' };
...
export default function NewAuditPage() {
  return (
    <section>
      ...
      <h1>New audit</h1>
      <NewAuditForm timezones={australianTimezones()} defaultTimezone={DEFAULT_TIMEZONE} />
    </section>
  );
}
```

**Analog for the nested layout:** `src/app/layout.tsx` (root; keep unchanged) and the brand-name link in `src/app/(console)/layout.tsx:99-104`:
```tsx
<header className="nav">
  <Link href="/" className="brand">
    {SERVICE_NAME}
  </Link>
```
The marketing layout is a nested layout returning `<div className={`marketing ${inter.variable} ${interTight.variable}`}>` with the site header and footer; `tests/brand.test.ts:232-245` will expect it to import `@/core/brand` (add it to `SURFACES` there).

**Footer identity line:** rendered from `footerIdentityLine(getServerEnv().BUSINESS_ABN ?? null)` in the server layout (RESEARCH §7: never `process.env` inside `brand.ts`).

---

### 5. `src/app/(marketing)/copy.ts` (all landing strings, one-file swap on 11 Sep)

**Analog:** `src/core/reporting/copy.ts` (header lines 1-36; a pure, framework-free module whose sentences are pinned byte-for-byte by `tests/reporting-copy.test.ts`, which also reads the source with `readFileSync('src/core/reporting/copy.ts')` at line 40 to forbid a `@/db` value import).

Copy the discipline, not the content: export plain `const` objects/strings, no `'use server'`, no imports from `@/db` or `next/*`. `tests/marketing-copy.test.ts` (Wave 0) then reads `copy.ts` for the D-09 forbidden-word list, the single `Run by AI, checked by a human`, and the no-em-dash rule, exactly as `tests/brand.test.ts:367-381` walks files with a regex.

---

### 6. `src/db/schema/audit-requests.ts` and `audit-request-throttle.ts` (models, tenant-independent)

**Analog:** `src/db/schema/prospects.ts`.

**Imports** (lines 58-71):
```ts
import { sql } from 'drizzle-orm';
import {
  boolean, date, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
```

**Closed vocabulary as a `const` tuple + type** (lines 73-75):
```ts
/** D-12: the two ways a prospect's quote history can reach us. */
export const PROSPECT_SOURCES = ['api_key', 'csv'] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];
```
Do the same for `AUDIT_REQUEST_TRADES`, `AUDIT_REQUEST_BANDS`, `AUDIT_REQUEST_STATUSES`, `AUDIT_NOTIFY_OUTCOMES`.

**Table + operator-only policy** (lines 104-110, 214-242). The policy comment (217-233) is the argument for `is_operator()` over a membership check; keep it:
```ts
export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessName: text('business_name').notNull(),
    /** One of PROSPECT_SOURCES. */
    source: text('source').notNull(),
    ...
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('prospects_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type Prospect = typeof prospects.$inferSelect;
export type NewProspect = typeof prospects.$inferInsert;
```

**Nullable FK with `onDelete`** (lines 248-250) for `converted_prospect_id` (use `'set null'`):
```ts
prospectId: uuid('prospect_id')
  .notNull()
  .references(() => prospects.id, { onDelete: 'cascade' }),
```

**In-schema CHECK** (`src/db/schema/messaging-config.ts:169`, emitted by `db:generate` — proven by `0026`):
```ts
check('messaging_config_channel_known', sql`channel IN ('sms', 'email')`),
```

**Indexes** (`src/db/schema/escalations.ts:167-176`):
```ts
uniqueIndex('escalations_inbound_message_uniq').on(table.inboundMessageId),
index('escalations_tenant_created_idx').on(table.tenantId, table.createdAt),
```
The throttle table's primary key is composite `(ip_hash, window_start)`; `audit_requests` gets `index('audit_requests_created_idx').on(table.createdAt)` and one on `status`.

**Barrel:** append `export * from './audit-requests';` and `export * from './audit-request-throttle';` to `src/db/schema/index.ts` (drizzle-kit reads only the barrel, per its header).

---

### 7. `src/db/migrations/0035_phase9_audit_requests.sql` + `meta/_journal.json`

**Analog (generated half):** `src/db/migrations/0013_prospects.sql`. Header lines 1-21 record the two mandatory manual edits (rename the random tag; re-stamp `when` in the journal). Generated body shape (lines 42-68):
```sql
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	...
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
...
CREATE POLICY "prospects_operator_access" ON "prospects" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_operator()) WITH CHECK (is_operator());
```

**Analog (hand-written half):** `src/db/migrations/0014_prospect_grants_and_purge.sql`. REVOKE-then-GRANT block (lines 20-49) — copy verbatim with the new table names; the throttle table gets the REVOKEs and `GRANT ALL ... TO service_role` only (no anon/authenticated grant, RESEARCH §5):
```sql
REVOKE ALL ON public.prospects FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.prospects FROM authenticated;
--> statement-breakpoint
...
GRANT SELECT ON public.prospects TO anon;
--> statement-breakpoint
GRANT SELECT ON public.prospects TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.prospects TO service_role;
--> statement-breakpoint
```
Idempotent CHECK shape, if any CHECK is hand-written rather than schema-emitted (lines 78-82):
```sql
ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_source_known;
--> statement-breakpoint
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_source_known
  CHECK (source IN ('api_key', 'csv'));
--> statement-breakpoint
```
Idempotent pg_cron scheduling, if the throttle sweep is done in SQL (lines 143-156):
```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prospect-line-purge') THEN
    PERFORM cron.unschedule('prospect-line-purge');
  END IF;
END
$$;
--> statement-breakpoint

SELECT cron.schedule(
  'prospect-line-purge',
  '15 3 * * *',
  $$DELETE FROM prospect_quote_lines WHERE purge_after IS NOT NULL AND purge_after < now()$$
);
```
The `storage.buckets` upsert (RESEARCH §6) goes LAST in the file as its own statement so a 42501 on hosted cannot lose the table DDL (Assumption A2).

**Consolidation rule:** `0033_phase7_reporting.sql:1-12` — one journal entry per phase; no other Phase 9 plan touches the journal. Journal trap: `_journal.json` idx 34 `when` is `1788412215830`; idx 35 must be greater (RESEARCH Pitfall 9).

---

### 8. `src/db/repository/audit-requests.ts` (tenant-less repository family)

**Analog:** `src/db/repository/prospects.ts`.

**Header claim + imports + id guard** (lines 22-58). The "no closure, operator-scoped, every id shape-checked" argument applies verbatim:
```ts
import { desc, eq, sql } from 'drizzle-orm';

import { CSV_STAGING_RETENTION_HOURS, PROSPECT_LINE_RETENTION_DAYS, prospectQuoteLines, prospects } from '@/db/schema';
import type { NewProspect, Prospect } from '@/db/schema';

import { getDb } from './client';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertProspectId(prospectId: string): void {
  if (typeof prospectId !== 'string' || !UUID_PATTERN.test(prospectId)) {
    throw new Error(`A prospect uuid is required; received ${JSON.stringify(prospectId)}.`);
  }
}
```

**Narrow insert type + insert with a Postgres-computed retention stamp** (lines 60-66, 134-147). `csv_purge_after = now() + 30 days` is this exact shape:
```ts
export type ProspectCreate = Pick<NewProspect, 'businessName' | 'source'> &
  Partial<Pick<NewProspect, 'apiKeyCiphertext' | 'keyLast4' | 'timezone' | 'csvNoteDegraded' | 'csvStaging'>>;

export async function createProspect(values: ProspectCreate): Promise<Prospect> {
  const [row] = await getDb()
    .insert(prospects)
    .values({
      ...values,
      csvStagingExpiresAt: values.csvStaging
        ? sql`now() + interval '${sql.raw(String(CSV_STAGING_RETENTION_HOURS))} hours'`
        : null,
    })
    .returning();
  return row;
}
```

**Get-or-null and pinned-column list** (lines 238-275):
```ts
export async function getProspect(prospectId: string): Promise<Prospect | null> {
  assertProspectId(prospectId);
  const [row] = await getDb().select().from(prospects).where(eq(prospects.id, prospectId));
  return row ?? null;
}

export async function listProspects(): Promise<Array<{ id: string; businessName: string; ... }>> {
  return getDb()
    .select({ id: prospects.id, businessName: prospects.businessName, ... })
    .from(prospects)
    // `id` breaks the tie: two prospects created in the same millisecond must
    // not swap places between renders.
    .orderBy(desc(prospects.createdAt), desc(prospects.id));
}
```

**Guarded update** — the `markAuditRequestConverted` / `recordAuditRequestNotify` writers should follow the `update ... where` shape in `storeAuditResults` (lines 182-207) and, where "once only" matters, the `outcome IS NULL` guard described for `recordEscalationOutcome` in `src/db/repository/index.ts:230-232`.

**Throttle upsert analog:** `src/db/repository/escalations.ts:85-103` (`onConflictDoNothing().returning(...)`):
```ts
const rows = await getDb()
  .insert(escalations)
  .values({ ... })
  .onConflictDoNothing()
  .returning({ id: escalations.id });

return rows[0] ?? null;
```
For the counter use drizzle's `onConflictDoUpdate({ target: [t.ipHash, t.windowStart], set: { hits: sql`${t.hits} + 1` } }).returning({ hits: t.hits })`, or the raw `sql` form in RESEARCH "Code Examples".

**Barrel line** (`src/db/repository/index.ts:104-119`) — add a new block in the same style:
```ts
/**
 * The prospect surface (D-01/D-03) — audit data, and no route from it to a
 * cadence. Exported on its own line so the separation is visible in the barrel:
 * nothing here takes a `tenantId`, and nothing above takes a `prospectId`.
 */
export {
  countProspectLines,
  createProspect,
  ...
} from './prospects';
```
Then add `'**/db/repository/audit-requests'`, `'**/db/repository/audit-uploads'` (and `.*` forms) to `DEEP_REPOSITORY_PATTERNS` in `eslint.config.mjs:31-43` so the deep-import ban covers the new modules.

---

### 9. `src/db/repository/audit-uploads.ts` (service-role Storage client)

**Analog (partial):** `src/db/repository/client.ts` — lazy, module-private, reads `getServerEnv()` on first use (lines 34-70):
```ts
import { getServerEnv } from '@/core/shared/env';
...
let db: RepositoryDb | undefined;

export function getDb(): RepositoryDb {
  if (db) return db;
  const { DATABASE_URL } = getServerEnv();
  ...
}
```
No `supabase-js` service-role client exists under `src/` today (RESEARCH §6 says so; say it in the module header). Use `createClient(url, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })` from `@supabase/supabase-js` (already a dependency, used by `tests/rls-coverage.test.ts:12`), keep the instance lazy like `getDb()`, and return typed outcomes with `error.name` only, following §7's provider-boundary rule.

---

### 10. `src/core/alerts/operator-email.ts` (add kind `audit_request`) and `src/core/alerts/operator-sms.ts` (new)

**Analog:** `src/core/alerts/operator-email.ts` itself.

**Kind union, input, result** (lines 51-75):
```ts
export type OperatorAlertKind = 'auth_failed' | 'degraded';

export interface OperatorAlertInput {
  tenantId: string;
  tenantName: string;
  kind: OperatorAlertKind;
  detail: SyncOutcome;
  at?: Date;
}

export type OperatorAlertResult =
  | { ok: true; id: string | null }
  | { ok: false; kind: 'not_configured' | 'send_failed'; detail: string };
```
Turn `OperatorAlertInput` into a discriminated union keyed on `kind` so the two sync kinds keep `tenantId/detail` and `audit_request` carries `requestId/businessName/...` (RESEARCH §8). `tests/sync-failure-alerts.test.ts:354-425` pins `alertSubject`/`alertBody` for the sync kinds; extend, do not break.

**Console URL builder** (lines 84-99) — add `auditRequestUrl(id)` beside `clientDetailUrl`:
```ts
export function consoleBaseUrl(): string {
  const env = getServerEnv();
  const explicit = env.APP_BASE_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  return (explicit ?? DEV_BASE_URL).replace(/\/+$/, '');
}

export function clientDetailUrl(tenantId: string): string {
  return `${consoleBaseUrl()}/clients/${tenantId}`;
}
```

**Subject + pure body** (lines 113-117, 128-170) — add an `audit_request` branch; the email subject per UI-SPEC is `Backdesk · Audit request: {business_name}`:
```ts
export function alertSubject(kind: OperatorAlertKind, tenantName: string): string {
  return kind === 'auth_failed'
    ? `ServiceM8 connection failed — follow-ups paused for ${tenantName}`
    : `ServiceM8 sync degraded for ${tenantName}`;
}
```

**Never-throw send with env-guard + name-only errors** (lines 179-230) — `sendOperatorSms` copies this skeleton exactly, swapping Resend for `sendSms`:
```ts
export async function sendOperatorAlert(input: OperatorAlertInput): Promise<OperatorAlertResult> {
  const at = input.at ?? new Date();

  let to: string; let from: string; let apiKey: string; let url: string;
  try {
    const env = getServerEnv();
    to = env.OPERATOR_ALERT_EMAIL;
    from = env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM;
    apiKey = env.RESEND_API_KEY;
    url = clientDetailUrl(input.tenantId);
  } catch {
    return { ok: false, kind: 'not_configured', detail: 'operator alert environment is invalid or missing' };
  }

  try {
    const { data, error } = await new Resend(apiKey).emails.send({ from, to, subject: alertSubject(...), text: alertBody({...}) });
    if (error) {
      // `name` only — see rule 3 in the header.
      return { ok: false, kind: 'send_failed', detail: error.name ?? 'unknown_error' };
    }
    return { ok: true, id: data?.id ?? null };
  } catch (e) {
    const name = e instanceof Error ? e.name : 'UnknownError';
    return { ok: false, kind: 'send_failed', detail: `send threw (${name})` };
  }
}
```

**SMS provider call** (`src/core/messaging/clicksend-client.ts:66-75, 179-182`):
```ts
export interface SendSmsInput {
  /** NORMALIZED E.164 recipient. */
  to: string;
  /** The dedicated AU virtual number, from `messaging_config.from_address`. */
  from: string;
  /** The approved body, VERBATIM. Never truncated or transformed here. */
  body: string;
  /** The `send_ledger` row id — how 04-04's delivery receipt finds its row. */
  customString: string;
}
...
export async function sendSms(input: SendSmsInput, creds: ClickSendCreds): Promise<SendSmsResult>
```
`SendSmsResult` (lines 87-89) is `{ ok: true; messageId; status } | { ok: false; reason; retryable; optedOut }` — map `reason` (already code-shaped via `codeOf`) into the `notify_detail` column.

**From-number without the arming flag** (`src/db/repository/messaging-config.ts:87-110`): `getChannelConfig('sms')` with no tenant returns the global row alone; read `row.fromAddress` and ignore `row.enabled` (RESEARCH Pitfall 5). `src/core/messaging/routing-sender.ts` already imports the repository from `src/core`, so the import is sanctioned.

**One-segment budget** (`src/core/escalation/message.ts:72-103` and `tests/escalation-message.test.ts:26,246-253`): import `countSeptets`, `normalizeForGsm7`, `segmentCount` from `@/core/drafting/gsm7`; in the pure test assert `segmentCount(countSeptets(body).septets) === 1` over a long-name fixture. Build the SMS body in a pure `src/core/alerts/operator-sms.ts` export (`auditRequestSmsBody`) so the test needs no mocks.

---

### 11. `src/core/shared/env.ts`, `tests/helpers/env.ts`, `.github/workflows/ci.yml`, `docs/env-vars.md`

**Analog:** the `OPERATOR_ALERT_*` block in `src/core/shared/env.ts:153-172` (required with a reason) and the pick-list rule at 231-259:
```ts
  // --- Operator alerting (SYNC-04, D-05) -----------------------------------
  //
  // REQUIRED, not optional, and that is the point. ...
  RESEND_API_KEY: z.string().min(1),
  OPERATOR_ALERT_EMAIL: z.email(),
  OPERATOR_ALERT_FROM: z.string().min(1).optional(),
```
```ts
    // Phase 4. EVERY key added to the schema above must also appear here — the
    // pick-list is explicit (rather than `process.env` wholesale) ...
    OPERATOR_ALERT_EMAIL: process.env.OPERATOR_ALERT_EMAIL,
    OPERATOR_ALERT_FROM: process.env.OPERATOR_ALERT_FROM,
```
Add `OPERATOR_ALERT_PHONE: z.string().regex(/^\+61\d{9}$/)`, `AUDIT_IP_HASH_SALT: z.string().min(32)`, `BUSINESS_ABN: z.string().regex(/^\d{11}$/).optional()` to both lists in the same commit (Pitfall 10).

**Test dummies:** `tests/helpers/env.ts:21-75` `REQUIRED` array (append with a comment in the same voice as `STALLED_DIGEST_SECRET`, lines 68-74) and `.github/workflows/ci.yml:128-163` (`echo "OPERATOR_ALERT_EMAIL=alerts@ci.invalid"` style; add `OPERATOR_ALERT_PHONE=+61400000000` and a 64-char salt).

**Docs:** `docs/env-vars.md` — the bash block per variable (lines 79-83 for `OPERATOR_ALERT_EMAIL`) and the two tables at lines 189/196 ("where read" and "NEXT_PUBLIC? never").

---

### 12. `src/core/brand.ts` + `tests/brand.test.ts`

**Analog:** the module itself. Add exports in the existing style (lines 24-31, 66-68):
```ts
/** The service's name, everywhere a human reads one (BRAND-01, D-01). */
export const SERVICE_NAME = 'Backdesk';

/** The registered apex. Reserved for the landing page — no console traffic. */
export const APEX_DOMAIN = 'backdesk.com.au';
...
export function identityLine(business: string): string {
  return `Sent by ${SERVICE_NAME} on behalf of ${business}.`;
}
```
New: `TAGLINE`, `CONTACT_EMAIL`, `CONTACT_PHONE_DISPLAY`, `CONTACT_PHONE_E164`, `BUSINESS_SUBURB`, `OPERATOR_LEGAL_NAME`, `footerIdentityLine(abn: string | null)`. **Constraints the test enforces** (`tests/brand.test.ts:107-158`): no `import`/`require`/`export ... from` of any shape; no `.replace/.replaceAll/.normalize/.split(` call anywhere (so `footerIdentityLine` must build with an array literal + `filter` + `join`, not `split`); the export list is pinned sorted:
```ts
expect(exported).toEqual([
  'APEX_DOMAIN',
  'CONSOLE_DESCRIPTION',
  'CONSOLE_HOST',
  'DEFAULT_ALERT_FROM',
  'PROVIDER_SOURCE_TAG',
  'SENDING_DOMAIN',
  'SERVICE_NAME',
  'identityLine',
  'viaDisplayName',
]);
```
Update the pin to the sixteen-name list in the same commit, and add `src/app/(marketing)/layout.tsx` to `SURFACES` (line 233-238).

---

### 13. `proxy.ts` + `src/lib/supabase/proxy.ts` (host-aware routing)

**Analog:** the files themselves.

**Current proxy** (`proxy.ts:16-36`), keep the single-string matcher and extend the exclusion list per RESEARCH §1:
```ts
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|login$|login/).*)'],
};
```

**`updateSession` cookie/response dance** (`src/lib/supabase/proxy.ts:22-63`). The `rewriteTo` option must rebuild the SAME rewrite response inside `setAll`, or refreshed cookies are lost:
```ts
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  ...
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
  ...
  if (!isAuthenticated && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }
  return response;
}
```

**Matcher test to extend** (`tests/cadence-tick-route.test.ts:580-597`; the same regex is duplicated in `tests/clicksend-inbound-route.test.ts:386` and `tests/clicksend-dlr-route.test.ts:348`):
```ts
const matcher = (() => {
  const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
  if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');
  return found[1];
})();

const matches = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname);

it('still matches console pages — the exclusion is API-only', () => {
  expect(matches('/')).toBe(true);
  expect(matches('/clients/2f1c8f8e-0000-4000-8000-000000000000')).toBe(true);
});
```
`tests/proxy-host-routing.test.ts` (Wave 0) copies this and adds the `/audit` vs `/audits` pairs (Pitfall 3).

---

### 14. `src/app/(console)/clients/page.tsx` (moved) and the two `revalidatePath('/')` callers

**Analog:** `src/app/(console)/page.tsx` is the file; `git mv` it. It already has `export const dynamic = 'force-dynamic'` (line 14) and reads through `createClient()`. Update:
- `src/app/(console)/clients/new/actions.ts:128-129`: `revalidatePath('/'); redirect('/');` -> `/clients`.
- `src/app/(console)/audits/[id]/actions.ts:67`: `revalidatePath('/')` -> `/clients`.
- `tests/console-error-leak.test.ts:NAMED_PAGES` lists `'src/app/(console)/page.tsx'` — rename the entry.
- `src/app/(console)/layout.tsx:102` `<Link href="/">` may stay (the proxy rewrites app-host `/`).

---

### 15. `src/app/(console)/audits/requests/page.tsx` (list, RLS read, `.touch-list` rows)

**Analog A (read contract):** `src/app/(console)/audits/page.tsx:1-85`:
```tsx
import type { Metadata } from 'next';
import Link from 'next/link';

import { NO_VALUE } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Audits' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

type ProspectRow = { id: string; business_name: string; source: string; audit_generated_at: string | null; created_at: string };

const SOURCE_LABELS: Record<string, string> = { api_key: 'API key', csv: 'CSV' };

export default async function AuditsListPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select('id, business_name, source, audit_generated_at, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    console.error(`[audits] prospect list read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Audits</h1>
        <p className="error" role="alert">
          Could not load audits. Try again in a moment.
        </p>
      </section>
    );
  }

  const prospects = (data as ProspectRow[] | null) ?? [];
```
Header row with the action link (lines 88-94) is where the `Requests (N new)` link goes on `/audits`:
```tsx
<div className="row">
  <h1>Audits</h1>
  <Link href="/audits/new" className="button">
    New audit
  </Link>
</div>
```
Do NOT copy the `<table>` (lines 105-144): `tests/layout-contract.test.ts:433` requires every console table inside `.table-scroll`, and the UI-SPEC chose a list.

**Analog B (list markup):** `src/app/(console)/inbox/page.tsx:196-262`:
```tsx
{rows.length === 0 ? (
  <p className="muted">No inbound needing attention.</p>
) : (
  <ul className="touch-list">
    {rows.map((row) => (
      <li key={row.id}>
        <div className="touch-when touch-when--stack">
          {formatReceived(row.receivedAt)}
          <span className={ATTRIBUTION_BADGE_CLASS[row.attribution] ?? 'badge'}>
            {ATTRIBUTION_LABELS[row.attribution] ?? row.attribution}
          </span>
          {row.isStop ? <span className="badge badge--error">STOP</span> : null}
        </div>
        <p className="meta">
          <strong>{row.fromAddress}</strong>
          <span className="muted"> · {row.channel}</span>
        </p>
        <p className="touch-meta muted">...</p>
      </li>
    ))}
  </ul>
)}
```
Badge-class maps live as `Record<string, string>` constants (inbox lines 78-81): `new`/`contacted` -> `'badge'`, `audited` -> `'badge badge--ok'`, `declined` -> `'badge muted'`, notify failed -> `'badge badge--error'`. Time in `Australia/Perth` via `formatInTenantZone` from `@/core/shared/tenant` with a `.zone-note` once above the list (`globals.css:688-691`).

---

### 16. `src/app/(console)/audits/requests/[id]/page.tsx` (detail)

**Analog:** `src/app/(console)/audits/[id]/page.tsx:1-18, 121-175`:
```tsx
import { notFound } from 'next/navigation';
...
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AuditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked before the query.
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select('id, business_name, ...')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`[audits] prospect read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Quote Leakage Audit</h1>
        <p className="error" role="alert">Could not load this audit. Try again in a moment.</p>
        <p><Link href="/audits">Back to audits</Link></p>
      </section>
    );
  }

  const prospect = data as ProspectRow | null;
  if (!prospect) {
    notFound();
  }
```
`dl.profile` / `.profile dt|dd` are in `globals.css:622-636`; `.controls` stacked buttons at 799-814; `.cell-truncate` at 462-468 for the user-agent line.

---

### 17. `status-form.tsx` + `actions.ts` + `action-state.ts` under `audits/requests/[id]/`

**Analog (client form with role=status/alert):** `src/app/(console)/clients/[id]/escalation-phone-form.tsx:38-91`:
```tsx
const [state, formAction, pending] = useActionState(
  updateEscalationPhoneAction.bind(null, tenantId),
  BLANK_ESCALATION_PHONE_STATE,
);

return (
  <form action={formAction}>
    {state.error ? (<p className="error" role="alert">{state.error}</p>) : null}
    {state.success ? (<p className="muted" role="status">{state.success}</p>) : null}
    ...
    <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save number'}</button>
  </form>
);
```
Prefer the shared `ActionMessage` (`src/app/(console)/components/action-message.tsx:45-67`) with `ControlState` / `BLANK_CONTROL_STATE` from `components/action-state.ts:59-98` instead of a bespoke state type (WR-10 "one Message component"). Keep the form's own module free of any `@/db` value import (`tests/lint-ban.test.ts:538-710`).

**Analog (action):** `src/app/(console)/audits/[id]/actions.ts:1-62` — auth first, uuid shape check, repository write, `revalidatePath`, fixed sentences:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { convertProspectToTenant } from '@/db/repository';
import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../_auth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function convertProspectAction(_previous: ConvertState, formData: FormData): Promise<ConvertState> {
  const access = await requireOperator();
  if (access !== 'ok') {
    return { error: OPERATOR_DENIED_MESSAGE[access], success: null };
  }

  const prospectId = formData.get('prospect_id');
  if (typeof prospectId !== 'string' || !UUID_PATTERN.test(prospectId)) {
    return { error: 'That audit could not be found.', success: null };
  }
  ...
  const result = await convertProspectToTenant(prospectId, tenantId);
  if (result.ok) {
    revalidatePath(`/audits/${prospectId}`);
    revalidatePath('/audits');
    ...
  }
```
The write-failure branch follows `updateEscalationPhoneAction` (`clients/[id]/actions.ts:390-404`): `try { await repo(...) } catch { console.error('[audit-requests] status write failed'); return { ...BLANK, error: FIXED } }` — the caught value is discarded. Validate `status` with `z.enum(AUDIT_REQUEST_STATUSES)`; the `_auth.ts` path from `audits/requests/[id]/` is `../../../_auth`.

---

### 18. `src/app/(console)/audits/requests/[id]/csv/route.ts` (authenticated download)

**Analog (route shape):** `src/app/api/internal/sync-tick/route.ts:36-70` — a route handler owns its own auth and returns a plain `Response`:
```ts
/** `node:crypto` and the postgres driver both need the Node runtime. */
export const runtime = 'nodejs';
...
function unauthorized(): Response {
  return new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), getServerEnv().SYNC_TICK_SECRET)) {
    return unauthorized();
  }
```
Here the credential is the operator session: `const access = await requireOperator(); if (access !== 'ok') return new Response(null, { status: 404 })` (indistinguishable from unknown id, RESEARCH "Known Threat Patterns"), then the uuid shape check, then `getAuditUpload(path)` via the barrel and `new Response(blob, { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="..."', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } })`. `requireOperator` is at `src/app/(console)/_auth.ts:52-72` and uses `createClient()` from `@/lib/supabase/server` (cookie session), which works inside a route handler under `(console)`.

---

### 19. `src/app/(console)/audits/new/{page,form,actions}.tsx` (pre-fill from a request)

**page.tsx:** read `searchParams` as in `src/app/login/page.tsx:10-15` (`searchParams: Promise<{ request?: string }>`), shape-check the uuid, read the row through `createClient()` (RLS decides; a non-operator gets `null` and the plain form), render `p.muted.hint` and pass `initial` to `NewAuditForm`.

**form.tsx:** `useState(state.values.source || 'api_key')` at line 42 becomes `useState(state.values.source || initial?.source || 'api_key')`; add `<input type="hidden" name="request_id" value={initial.requestId} />` (the `convert-form.tsx:46` hidden-input shape) and replace the file input with the static line when a request file exists (UI-SPEC C-12).

**actions.ts:** after `requireOperator()` (line 199) and inside the CSV branch (215-235), when `request_id` is present and no new file was chosen: `getAuditUpload(path)` -> `new File([await blob.arrayBuffer()], filename, { type: 'text/csv' })` -> the unchanged `stageCsvUpload(file, values, timezone)` (94-166). After `createProspect` / `generateAuditFromApiKey` succeed, call `markAuditRequestConverted(requestId, prospectId)` and delete the object. Raise `MAX_CSV_BYTES` in `src/core/audit/csv-mapping.ts:41` to `4 * 1024 * 1024` and the pin in `tests/csv-mapping.test.ts:549` in the same commit.

---

### 20. `src/app/globals.css`, `audit.css`, `report.css` (tokens)

**Token blocks to replace** (`globals.css:7-33`) with the UI-SPEC set verbatim (adds `--surface`, `--accent-fg`):
```css
:root {
  --bg: #ffffff;
  --fg: #16181d;
  --muted: #626875;
  --line: #e2e5ea;
  --accent: #1f6feb;
  --error: #b42318;
  /* Sync-health badges only (02-UI-SPEC Color). Never for chrome or links. */
  --ok: #1a7f37;
  --warn: #9a6700;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101317;
    --fg: #e9ecf1;
    --muted: #9aa2b1;
    --line: #262b33;
    --accent: #6ea8fe;
    --error: #ff8a80;
    --ok: #57ab5a;
    --warn: #d4a72c;
  }
}
```

**Hard-coded white to fix** (`globals.css:317-328` and `339-346`):
```css
button {
  ...
  background: var(--accent);
  color: #fff;          /* -> var(--accent-fg) */
  min-height: 2.75rem;
}
.button {
  display: inline-block;
  padding: 0.55rem 0.9rem;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;          /* -> var(--accent-fg) */
  text-decoration: none;
}
```

**Print accent override** (`audit.css:117-124`): change `--accent: #1f6feb;` to `#1B7A4A`. **Figure rules to add `font-variant-numeric: tabular-nums`:** `audit.css` `.audit-figure dd` (ends line 63) and `report.css:104-111` `.report-figure dd`. The existing `.num` rule (`globals.css:649-652`) is the reference:
```css
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

**Existing class vocabulary the marketing and request pages reuse** (`globals.css`): `.badge` + modifiers 535-567; `.profile` 622-636; `.touch-list`/`.touch-when`/`.touch-meta` 697-739 (+ `@media (min-width: 32rem)` 771-780); `.controls` 799-814; `.button-quiet` 856-869 (a transparent secondary button; `.button--secondary` can mirror it); focus-ring convention 453-456 (`outline: 2px solid var(--accent); outline-offset: 2px`).

**Structural CSS test analog:** `tests/layout-contract.test.ts:15-22` reads the three stylesheets with `readFileSync` and asserts rules by regex; `tests/brand-tokens.test.ts` (Wave 0) copies that harness for the hex set, `--accent-fg`, and `tabular-nums`.

---

### 21. `src/core/intake/*` (pure modules) and their tests

**Analog:** `src/core/escalation/message.ts` header (lines 1-16: "PURE, framework-free, dependency-free, and it does not log") and its test `tests/escalation-message.test.ts:22-44`, which reads the source to pin imports:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countSeptets, segmentCount } from '../src/core/drafting/gsm7';
...
it('imports countSeptets and segmentCount from the drafting module', () => {
  expect(SOURCE).toContain('countSeptets');
  expect(SOURCE).toContain('segmentCount');
});
```
**Phone/email normalisers to reuse, never re-spell** (`src/core/cadence/primary-contact.ts:129-149`):
```ts
export function normalizeAuMobile(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(PUNCTUATION, '');
  if (cleaned === '') return null;
  if (LOCAL_MOBILE.test(cleaned)) return `+61${cleaned.slice(1)}`;
  if (INTERNATIONAL_MOBILE.test(cleaned)) return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  return null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.trim().toLowerCase();
  return EMAIL_SHAPE.test(cleaned) ? cleaned : null;
}
```
Use them inside `z.string().transform(...).refine(...)` in `audit-request.ts`, with the UI-SPEC error strings.

---

### 22. `tests/rls-coverage.test.ts` edits

Add `'audit_requests'` to the table list at lines 121-131 and two rows to the exact-grants map (lines 148-310) in the `prospects` comment style (184-196):
```ts
'prospects/anon': 'SELECT',
'prospects/authenticated': 'SELECT',
```
Add `'audit_requests'` and `'audit_request_throttle'` to the `is_operator()` policy list at lines 640-655 and to the presence list at 930-950. The throttle table appears in no grants row (nothing granted to anon/authenticated).

---

## Shared Patterns

### Auth-first server actions (console side)
**Source:** `src/app/(console)/_auth.ts:52-84` (`requireOperator()` + `OPERATOR_DENIED_MESSAGE`).
**Apply to:** `audits/requests/[id]/actions.ts`, the CSV route, and the modified `audits/new/actions.ts`.
```ts
const access = await requireOperator();
if (access !== 'ok') {
  return { errors: {}, formError: OPERATOR_DENIED_MESSAGE[access], values };
}
```
The public marketing action is the deliberate exception: no session; honeypot + throttle + zod are its gate.

### Service-role write, RLS read
**Source:** `src/app/(console)/audits/new/actions.ts:178-188` (comment) and `src/app/(console)/audits/page.tsx:59-68` (read through `createClient()`).
**Apply to:** every request page (read via `@/lib/supabase/server` `createClient()`) and every request write (via `@/db/repository`).

### Never-throwing provider boundary, error names only
**Source:** `src/core/alerts/operator-email.ts:9-30` (three rules) and `src/core/messaging/clicksend-client.ts:1-22`.
**Apply to:** `operator-sms.ts`, `audit-uploads.ts`, the notify columns (`notify_detail` holds `error.name` / `reason` codes, never prose).

### Fixed sentences to the page, codes to the log
**Source:** `src/app/(console)/audits/page.tsx:70-83`; enforced by `tests/console-error-leak.test.ts` (scans every `.ts/.tsx` under `src/app/(console)`).
**Apply to:** all new console pages and actions; the marketing action's `formError` strings come from the UI-SPEC contract.
```ts
console.error(`[audits] prospect list read failed: ${error.code ?? 'unknown'}`);
return (<p className="error" role="alert">Could not load audits. Try again in a moment.</p>);
```

### `'use server'` modules export only async functions
**Source:** `tests/lint-ban.test.ts:721-744` and every `action-state.ts`.
**Apply to:** `(marketing)/audit/actions.ts`, `audits/requests/[id]/actions.ts`; constants, types-with-values and copy live beside them in non-action modules.

### Repository barrel is the only door
**Source:** `eslint.config.mjs:31-48`, `src/db/repository/index.ts` header.
**Apply to:** `audit-requests.ts`, `audit-uploads.ts` (export on their own commented barrel lines; add their names to `DEEP_REPOSITORY_PATTERNS`).

### Structural tests that read source
**Source:** `tests/brand.test.ts:95-166`, `tests/layout-contract.test.ts:15-22`, `tests/cadence-tick-route.test.ts:580-597`.
**Apply to:** `marketing-copy`, `brand-tokens`, `proxy-host-routing`, `brand-assets` tests.

### Retention stamped by Postgres, purged by a scheduled job
**Source:** `src/db/repository/prospects.ts:227-232` (`purgeAfter: sql\`now() + interval '30 days'\``) and `0014_prospect_grants_and_purge.sql:143-156`.
**Apply to:** `csv_purge_after` on `audit_requests`; the object purge itself runs from `src/app/api/internal/stalled-digest/route.ts` (`POST`, lines 60-90: bearer check, then `runStalledDigest`, then counts-only JSON) by adding `purgeExpiredAuditUploads()` to that handler and one more count to its response (Assumption A8).

### Env keys: schema + pick-list + test REQUIRED + CI dummy + docs, one commit
**Source:** `src/core/shared/env.ts:153-172, 238-259`; `tests/helpers/env.ts:21-75`; `.github/workflows/ci.yml:128-163`; `docs/env-vars.md:79-83, 189-196`.
**Apply to:** `OPERATOR_ALERT_PHONE`, `AUDIT_IP_HASH_SALT`, `BUSINESS_ABN`.

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md §1/§4/§6 and the UI-SPEC instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/app/(marketing)/fonts.ts` | config | static | No `next/font` usage anywhere (console is `system-ui` by decision); RESEARCH §4 gives the exact `Inter`/`Inter_Tight` definitions |
| `src/app/(marketing)/marketing.css` | stylesheet | static | No marketing stylesheet exists; page-scoped CSS import precedent is `audits/[id]/page.tsx:10` (`import './audit.css'`) and the token/class vocabulary is `globals.css` |
| `src/app/not-found.tsx` | page | static | No root `not-found.tsx` today (RESEARCH §1 confirms); render inside the root layout with the brand module |
| `src/app/robots.ts`, `src/app/sitemap.ts` | metadata routes | static | No metadata routes exist; RESEARCH §4 has the return shapes |
| `src/db/repository/audit-uploads.ts` | repository (Storage) | file-I/O | First service-role `supabase-js` client under `src/`; laziness pattern from `client.ts` only |
| `public/brand/*`, `scripts/brand/*` | assets / one-off scripts | static | Source art is in `logo/` (`backdesk-favicon.svg`, `backdesk-mark-720.svg`, wordmark PNGs); `public/` holds only Next defaults; no generation scripts exist |
| `next.config.ts` `experimental.serverActions.bodySizeLimit` | config | static | Config currently has only `turbopack.root`; add the key per RESEARCH §5 |
| Vercel domain attach / www redirect / founder DNS checkpoint | ops | — | Not code; follow `docs/vercel-domains-and-protection.md` and `docs/external-registrations.md` (Phase 8 record shape) |

## Metadata

**Analog search scope:** `src/app/**`, `src/core/**`, `src/db/**`, `src/lib/**`, `tests/**`, `proxy.ts`, `eslint.config.mjs`, `next.config.ts`, `vercel.json`, `.github/workflows/ci.yml`, `docs/env-vars.md`, `logo/`, `public/`
**Files scanned:** 52 read in full or by targeted range (see line citations)
**Pattern extraction date:** 2026-09-09
