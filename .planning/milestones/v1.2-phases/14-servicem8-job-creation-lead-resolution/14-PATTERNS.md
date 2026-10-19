# Phase 14: ServiceM8 Job Creation & Lead Resolution - Pattern Map

**Mapped:** 2026-10-10
**Files analyzed:** 34 new/modified (23 source/schema/migration/docs, 11 test files new or deliberately edited)
**Analogs found:** 32 / 34

Inputs: `14-CONTEXT.md` (D-01..D-13), `ROADMAP.md` Phase 14 (success criteria 1-4, research/risk flag), `REQUIREMENTS.md` SM8-01..03 + LEAD-04, `13-PATTERNS.md` as the format precedent. There is no `14-RESEARCH.md` at mapping time; where CONTEXT says "research decides" (D-02, D-10, D-11) the mapper records the in-repo shape the answer must fit and names the tripwire. No `.claude/skills/` directory exists.

All paths are relative to the repo root `<repo>`. Line ranges were read on 2026-10-10 at commit `41a7cab`.

File names marked (proposed) are the mapper's inference from the decisions; the planner may rename them. Everything else is an existing file.

---

## File Classification

### ServiceM8 write path (SM8-01)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/servicem8/types.ts` (mod: `Sm8Client.post`/`getOne`, widened `Sm8FailureKind` or a sibling `Sm8WriteFailureKind` closed enum) | model (type vocabulary) | request-response | itself 21-56 | exact |
| `src/core/servicem8/client.ts` (mod: `post(resource, body)` beside `get`; `getOne(resource, uuid)` for the read-back; same `classify`, same T-2-02 rules) | service (HTTP boundary) | request-response | itself 34-43 (`classify`), 60-104 (`get`) | exact |
| `src/core/servicem8/schemas.ts` (mod: `sm8Company`, `sm8CompanyContact` (research decides), create-response schema; `sm8Job`/`sm8JobContact` reused for read-back) | utility (zod) | transform | itself 64-74 (`sm8Flag`), 76-98 (`sm8Job`), 107-124 (`sm8JobContact`) | exact |
| `src/core/servicem8/normalize.ts` (mod only if a new normaliser is needed; `normalizeJob` reused as-is for the mirror row) | utility (pure) | transform | itself 194-222 (`normalizeJob`) | exact |
| `src/core/leads/create-job.ts` (new, proposed: `createServiceM8JobForLead(tenantId, leadId, …)` claim → ServiceM8 writes → read-back → one transaction) | service | request-response + CRUD | `src/core/telephony/provision.ts` 346-500 (claim → act → outcome, hold on indeterminate); `src/core/sync/connect.ts` 117-249 (verify → fetch outside tx → write atomically) | exact (composite) |
| `src/core/leads/job-description.ts` (new, proposed: pure builder of the description/note text from verbatim words + urgency + date) | utility (pure) | transform | `src/core/escalation/message.ts` builders (byte-pinned copy, see 13-PATTERNS); `src/core/aging/stalled-digest.ts` 157-214 (closed vocabulary, fixed words) | role-match |

### Mirror pre-insert (SM8-02)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/schema/quotes.ts` (mod: `SYNC_SOURCES` gains `'lead'`) | model | CRUD | itself 67-68, 126-129 | exact |
| `src/db/repository/for-tenant.ts` (mod: `quotes.upsertManyReturning` conflict set decision on `sync_source` — see Mismatch 2; `quotes.insertFromLead` or reuse of `upsertMany`; `quoteContacts.upsertMany` reused) | service (repository) | CRUD | itself 2728-2762 (conflict set, `chase_eligibility` omitted), 5137-5160 (`quoteContacts.upsertMany`) | exact |
| `src/core/sync/run-sync.ts` (mod: the auto-resolution pass only — D-13 says the first-sight branches are NOT modified) | service | batch | itself 453-549 (locked transaction, `stateFor` → `prev`, the D-15 gate at 500-503) | exact |

### Lead job linkage + creation state machine (SM8-03)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/schema/leads.ts` (mod: `sm8_job_uuid`, `job_creation_state`, `job_creation_error`, `job_creation_claimed_at`/`job_created_at`, `LEAD_JOB_CREATION_STATES`, `LEAD_CLOSED_REASONS` +3, CHECKs, partial unique on job uuid) | model | CRUD (evidence family) | itself 89-105 (vocabulary), 133-139 (closed pair), 163-185 (CHECKs); `src/db/schema/tenant-divert-numbers.ts` 52-53, 83-93, 107-118 (`pending/active/failed` + `failure_code` shape CHECK); `src/db/schema/missed-calls.ts` 232-253, 307-337 (outcome columns + iff-CHECKs) | exact |
| `src/db/repository/for-tenant.ts` (mod: `leads.claimJobCreation`, `leads.recordJobCreationFailure`, `leads.recordJobCreated`/`convert`, `leads.listOpenForJobMatch`, `leads.byIdWithReplies` or `inbound.listForLead`) | service (repository) | CRUD | itself 4543-4563 (`leads.close` guarded UPDATE), 4565-4589 (`listOpenWithEndedCadence` join), 4107-4137 (`closingLabelRowsForOpenLeads`) | exact |
| `src/core/leads/close.ts` (mod: `closeLeadInTx` learns the `converted` status for the three new reasons, or a sibling `convertLeadInTx`) | service | CRUD | itself 51-78, 84-91 | exact |

### Auto-resolution (LEAD-04, tradie-booked)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/leads/resolve-booked.ts` (new, proposed: `resolveLeadsBookedByTradie(tenantId, now)` per-tenant pass) | service | batch | `src/core/leads/close.ts` 130-145 (`closeLeadsWithEndedCadences` — read, loop, `closeLead` wrapper, count); `src/core/leads/label-effects.ts` 60-82 (newest-row-wins map, per-tenant catch) | exact |
| `src/core/sync/run-sync.ts` (mod: call the pass after the cycle's transaction commits, D-12 "rides the existing sync run") | service | batch | itself 551-563 (post-transaction return) and `src/core/cadence/run-tick.ts` 1060-1074 (`runLeadCloseSweep` pass shape) | exact |
| `src/core/leads/constants.ts` (mod: `LEAD_JOB_MATCH_WINDOW_DAYS = 14`) | config (no imports) | n/a | itself 148-161 (`LEAD_MIN_GAP_HOURS` paragraph shape) | exact |
| `docs/commercial-assumptions.md` (mod: §16 `LEAD_JOB_MATCH_WINDOW_DAYS`) | docs | n/a | itself §11 lines 311-336 (Added / What it is / Rationale / Where it applies / If it changes) | exact |

### DONE keyword (LEAD-04, tradie close)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/leads/done-keyword.ts` (new, proposed: `isDoneMessage(body)` anchored whole-message, case-insensitive) | utility (pure) | transform | `src/core/messaging/stop-keywords.ts` 38-80 (anchored, non-global, non-string → false); `src/core/leads/urgency-keywords.ts` 47-63 | exact |
| `src/core/messaging/inbound.ts` (mod: a tradie-DONE branch in `handleInboundSms` after `isStop`, before the candidate lookup; never touches the quote path) | service | event-driven | itself 245-298 (door order), 321-350 (D-06 keyword placement) | exact |
| `src/db/repository/escalations.ts` (mod: `latestSentEscalationToAddressSince(toAddress, since)` → `{ tenantId, leadId }`; cross-tenant by `to_address`, in the escalations family so the `forAllTenants_*` pin stands) | service (repository) | event-driven | itself 618-639 (`recentEscalationForCadence`), 456 (`listHeldEscalationsSince`), 707-731 (`to_address` handling notes) | exact |
| `src/db/repository/for-all-tenants.ts` or `tenants` read (mod: "whose own number is this sender?" — escalation phone + never-text list, cross-tenant) | service (repository) | event-driven | itself 617 (`forAllTenants_cadencesByContactMobile`), 1985 (`forAllTenants_divertNumberByE164`) | role-match (see Mismatch 7) |
| `src/core/alerts/operator-email.ts` (mod: `OperatorAlertKind` gains the DONE-unmatched kind + subject) OR `src/db/schema/operator-alert-log.ts` (`OPERATOR_ALERT_KINDS` + CHECK) | service / model | event-driven | `operator-email.ts` 65, 189-191; `operator-alert-log.ts` 32-37; `src/db/repository/operator-alerts.ts` 43-59 (`claimOperatorAlert` once-per-day) | exact |

### Console (D-01, D-09)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(console)/inbox/create-job-form.tsx` (new, proposed: `'use client'` arm-then-confirm sheet) | component | request-response | `src/app/(console)/inbox/suppress-contact-form.tsx` 52-122 (whole file: arm → warning → confirm, `Message`) | exact |
| `src/app/(console)/inbox/create-job-action.ts` or `inbox/actions.ts` (mod: `createJobFromLeadAction`) | controller (server action) | request-response | `src/app/(console)/inbox/actions.ts` 53-78 (`requireOperator` first, UUID guard, `revalidatePath('/inbox')`, two-outcome copy); `src/app/(console)/clients/[id]/actions.ts` 541-584 (`authorize(tenantId)` membership read, try/catch discard, fixed sentences) | exact |
| `src/app/(console)/inbox/action-state.ts` (mod: `CreateJobState`, blank, fixed sentences per ServiceM8 error kind) | utility (client-safe leaf) | n/a | itself 1-17; `src/app/(console)/clients/[id]/action-state.ts` 104-137 | exact |
| `src/app/(console)/inbox/page.tsx` (mod: lead row shows job uuid + status / "booked by tradie" / "closed by tradie"; mounts the form on an open lead's row) | component (server page) | request-response | itself 282-325 (lead row + D-13 suggested-action gating) | exact |
| `src/db/repository/inbound-messages.ts` (mod: `InboundTriageRow` gains lead status / job linkage columns, or a second per-lead read) | service (repository) | CRUD | itself 225-321 | exact |

### Digest + attribution (D-06, D-09)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/aging/stalled-digest.ts` (mod: two Leads lines — jobs created, tradie-booked) | service | batch | itself 157-214 (`buildLeadsSection`), 334-354 (its own try, directory fallback) | exact |
| `src/db/repository/inbound-messages.ts` or `for-all-tenants.ts` (mod: `countLeadJobsCreatedSince`, `countLeadsBookedSince` — per-tenant counts) | service (repository) | batch | `countColdLeadRepliesSince` (inbound-messages.ts 561+) — in a family, NOT a new `forAllTenants_*` | exact |
| `src/core/attribution/qualify.ts` + `consume-wins.ts` (mod: a `source = 'lead'` quote never attributes) | utility (pure) + service | transform | `qualify.ts` 91-118 (touch-0 exclusion); `consume-wins.ts` 323-327 (the six reads; `tx.quotes.byId`) | exact |

### Migration

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/migrations/0041_phase14_job_creation.sql` (proposed tag) + `meta/_journal.json` idx 41 + `meta/0041_snapshot.json` | migration | batch DDL | `0040_phase13_lead_cadence.sql` 1-89 (header), 91-94 (DROP IF EXISTS), 107-119 (re-ADD); `0008_sm8_vocabulary_constraints.sql` 49-53 (the `quotes_sync_source_known` idiom) | exact |

### Tests

| File | Role | Analog |
|---|---|---|
| `tests/sm8-client-write.test.ts` (pure: `post` builds the request, classifies 400/401/404/409/429/5xx, never stringifies `e`, read-back schema) | test (pure, fetch stubbed) | `tests/sm8-schemas.test.ts` 1-40; `tests/sync-upsert.test.ts` 469-496 (source-guarantee style for T-2-02) |
| `tests/lead-create-job.test.ts` (DB-backed, CI-only: exactly-once, retry from `failed`, partial-failure reconcile, mirror row `needs_review`/`lead`, no `quote_opened`, next poll opens no cadence) | test (DB-backed) | `tests/lead-close.test.ts` 1-90 (header discipline, pinned clock, fiction numbers, by-id teardown); `tests/sync-upsert.test.ts` 38-67 (`stubClient`/`failingClient`), 112-120 |
| `tests/provision-divert-number.test.ts` (pattern only — the hold/adopt cases are the template for `outcome_unknown` on a job create) | test | itself |
| `tests/lead-resolve-booked.test.ts` (DB-backed: match within 14 days, not before the call, not past day 14 (boundary inclusive), job-contact mobile vs company mobile, idempotent across two polls, our own tap never double-counted) | test (DB-backed) | `tests/lead-close.test.ts`; `tests/sync-upsert.test.ts` idempotence cases |
| `tests/done-keyword.test.ts` (pure) + `tests/lead-reply.test.ts` (mod: DONE cases at the door) | test | `tests/stop-keywords.test.ts`; `tests/lead-reply.test.ts` 388-419 (the STOP case shape), 456-542 (door order describe) |
| `tests/text-back-gate.test.ts` (mod only if `NEGATIVE_CLOSE_REASONS` derivation is affected — the three new reasons must NOT be negative) | test (pure) | itself 23-35 |
| `tests/lead-digest-section.test.ts` (mod: two new lines byte-verbatim; mocked reads +2) | test (pure, mocked barrel) | itself 1-40 |
| `tests/attribution-qualify.test.ts` (mod: source=lead exclusion pinned beside touch-0) | test (pure) | itself 160-189 |
| `tests/rls-coverage.test.ts` (mod: 0041 CHECK names + widened-vocabulary substrings; `leads` partial unique index) | test (DB-backed) | itself 711-759, 1190-1196 |
| `tests/lint-ban.test.ts` (mod: pin `inbox/create-job-form.tsx` + `inbox/action-state.ts`) | test (structural) | itself 695-769 |
| `tests/sync-upsert.test.ts` (mod: `Sm8Client` fakes gain `post`/`getOne` if the interface widens; a new source guarantee "run-sync.ts never calls the write path") | test | itself 46-67, 469-496, 498-724 |
| `tests/operator-authorization.test.ts` (mod: add the new inbox action file to `GUARDED_PATHS` if it is a new file) | test (structural) | itself 57-66 |

---

## Pattern Assignments

### `src/core/servicem8/client.ts` + `types.ts` (the write path, D-03)

**Analog:** the read path in the same two files. The header rules are the contract every new method inherits (`client.ts` 1-18):

```ts
 *  1. **The key is never interpolated into a returned string.** Every failure
 *     result is built from the HTTP STATUS CODE and, for network failures, the
 *     error's `name` — never `String(e)` …
 *  2. **Nothing throws.** See src/core/servicem8/types.ts — a thrown fetch error
 *     carries the Request object, headers included, to whatever logs it.
```

**Status classification is one function** (`client.ts` 34-43), and its comment already argues why a 400 is `server_error` not `auth_failed`. A write path needs finer kinds (D-03 "rate-limit and error kinds mapped to a closed enum"): 400 (our payload), 404 (resource), 409 (conflict), 429, 5xx, timeout, parse. Two shapes fit the codebase; the planner picks one:

- widen `Sm8FailureKind` (`types.ts` 21-26) — but `SyncOutcome` (`sync_runs.outcome` CHECK) and `SYNC_OUTCOME_LABELS` (`src/core/sync/outcomes.ts` 31-38, `Readonly<Record<SyncOutcome,string>>`) are exhaustive over it, so every new member must be added to both or the build fails; `failure-policy.ts` 85-105 also branches on it;
- or a sibling `Sm8WriteFailureKind` for `post` only, with the lead's `job_creation_error` column CHECKed to that list. **Prefer the sibling**: the sync vocabulary is pinned in three places and D-13 says quote behaviour is unchanged.

**The request shape to copy** (`client.ts` 71-104): `fetch(url, { headers: { 'X-API-Key': auth.key, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })`; `catch (e)` → `e.name` only; `if (!res.ok) return classify(res.status)`; `res.json()` → `parse_error`. For `post`, add `method: 'POST'`, `'Content-Type': 'application/json'`, `body: JSON.stringify(payload)`. **Do not assume the response body carries the uuid** — the Phase 2 spike found list endpoints return bare arrays and that the docs are wrong about field types (`schemas.ts` 51-56); D-11's spike settles uuid-in-header vs body. Return `{ ok: true, data: { body: unknown; headers: Headers } }` so the caller can read either.

**`endpointPath`** (`client.ts` 56-58) must be reused: every call site passes `job.json`, and the doubled-suffix bug it fixes would reappear on a hand-built POST URL.

**Read-back is a `get` with a `$filter`** unless the spike finds a `job/{uuid}.json` shape: `get('job.json', { filter: \`uuid eq '${uuid}'\` })` — the `$filter` encoder at `client.ts` 66-68 handles quoting.

**The interface** (`types.ts` 50-56) has ONE method; three test files build structural fakes against it (`tests/sync-upsert.test.ts` 46-67, `tests/sync-failure-alerts.test.ts`, `tests/quote-events.test.ts`). Adding a required `post` breaks all three at `tsc`. Either (a) add `post`/`getOne` as required and update the three fakes, or (b) export a separate `Sm8WriteClient` returned by `createSm8Client` alongside. Tripwire: `tests/sync-upsert.test.ts:22` imports `Sm8Client` by name.

**`Sm8Auth`** (`types.ts` 48) is a one-arm union; D-03's OAuth `create_jobs` follow-up lands as a second arm later, not now.

---

### `src/core/servicem8/schemas.ts` (zod at the write boundary)

**Analog:** itself. Every schema is `.object({...}).loose()` (lines 76-96) with `sm8Flag` for booleans and `sm8Timestamp` for zero-dates. A company schema (if research chooses `company.json` lookup) copies `sm8JobContact` (107-124): `uuid`, `active: sm8Flag`, `edit_date: z.string().min(1)`, free-text fields `.nullish()`.

**The comment at 100-105 is a fact the planner must carry:** "This is where the cadence's recipient phone and email come from — the company object carries neither." So company-by-mobile (D-02) is NOT a filter on `company.json`; the research spike has to find where ServiceM8 keeps a company's mobile (`companycontact.json` is the candidate). The mapper records this as a research dependency, not an assumption.

**Read-after-write validation:** the read-back parses with `sm8Job.safeParse` exactly as `run-sync.ts` 272-276 does, and the mirror row is `normalizeJob(parsed.data, SM8_TIMESTAMP_ZONE)` (`normalize.ts` 194-222) — the same function the sync uses, so the pre-inserted row is byte-identical in shape to what the next poll would write.

---

### `src/core/leads/create-job.ts` (claim → create → read back → commit, D-04/D-05)

**Analog:** `src/core/telephony/provision.ts` — the one place in the repo that performs an external create with an indeterminate outcome, and its header says so (lines 14-16: "The `dispatchOne` shape (claim → act → outcome) composed with connect's verify-then-write").

**The claim** (`provision.ts` 423-455): INSERT or guarded re-claim, never check-then-act:

```ts
  // A FAILED OR HELD ROW IS RE-CLAIMED, NEVER RE-INSERTED — and each re-claim
  // is guarded on the state it read (`failed`, or `pending` and older than
  // the hold), so two retries race exactly as two first claims do: one
  // wins, the other reads zero rows and stops here.
  reclaimed = row.status === 'failed'
    ? await repo.divertNumber.reclaim(input.spokenName)
    : await repo.divertNumber.reclaimStale(input.spokenName, new Date(now.getTime() - DIVERT_HOLD_MS));
  if (reclaimed.length === 0) return { kind: 'in_progress' };
```

For a lead: `leads.claimJobCreation(leadId, now)` is one UPDATE `SET job_creation_state = 'creating', job_creation_claimed_at = now WHERE id = … AND status = 'open' AND job_creation_state IN ('none', 'failed') RETURNING id`; zero rows → `{ kind: 'in_progress' | 'already_created' }` (D-04 "a second tap while creating or created is refused"). Same guard-as-WHERE house style as `leads.close` (`for-tenant.ts` 4554-4562).

**Indeterminate outcome is a HOLD, not a failure** (`provision.ts` 469-487):

```ts
    if (!bought.determinate) {
      // THE PURCHASE MAY HAVE GONE THROUGH (CR-01). A timeout, a reset or a 5xx
      // after the create left says nothing about whether Twilio bought it, so
      // the row is NOT failed — `failed` is the state the retry path opens on.
      // It stays `pending`, held, and the next attempt searches the account
      // under the friendly name before it spends anything.
      await repo.divertNumber.hold({ failureCode: DIVERT_HOLD_CODE });
      return { kind: 'outcome_unknown', code };
    }
```

Map onto leads: `network_error`/timeout/5xx after the POST left → stay `creating` with `job_creation_error = 'outcome_unknown'`; a determinate refusal (400/401/404/409) → `failed` with the kind. D-04's "a partial failure (company created, job missing; job created, contact missing) is reconciled on retry by uuid/mobile match, never by a second blind create" is `adoptExisting` (`provision.ts` 399-421, 560-610): **look before creating again** — search ServiceM8 for a job whose description carries the lead's marker / whose contact mobile matches, inside the window, and adopt it. `isRecoverablePending` (163-170) is the shape for "a `creating` claim older than N minutes is retryable".

**Order of operations is `connect.ts`'s** (lines 4-19, 133-238): HTTP OUTSIDE any transaction ("an open Postgres transaction held across several seconds of third-party HTTP occupies a pooled connection"), parse before writing, then ONE transaction for the mirror row + contact + lead update. Nothing throws for an expected failure (`connect.ts` 110-116): a typed result the action turns into a sentence.

**The result union** mirrors `ProvisionResult` (`provision.ts` 139-152): `created | adopted | already_created | in_progress | refused(kind) | outcome_unknown(kind)` — each a fixed kind, no provider prose (`divertFailureCode` 210 is the shape for a bounded code).

**Logging:** ids and vocabulary only (`provision.ts` 433, 485; `close.ts` 38-39). The lead's mobile and the caller's words never reach a log (T-11-04).

---

### `src/db/schema/leads.ts` + `0041` (job linkage + state machine, D-04/D-10)

**Analog 1 — the status vocabulary + failure code shape:** `tenant-divert-numbers.ts` 52-53, 83-93, 114-118:

```ts
export const DIVERT_NUMBER_STATUSES = ['pending', 'active', 'failed'] as const;
…
    check('tenant_divert_numbers_status_known', sql`status IN ('pending', 'active', 'failed')`),
    check('tenant_divert_numbers_failure_code_shape', sql`failure_code IS NULL OR failure_code ~ '^[a-z_]{1,32}$'`),
```

→ `LEAD_JOB_CREATION_STATES = ['none', 'creating', 'created', 'failed'] as const`, `job_creation_state text NOT NULL DEFAULT 'none'`, `job_creation_error` CHECKed to the closed write-kind list (or the regex shape if the list is research-settled late).

**Analog 2 — iff-CHECKs between a state and its companion columns:** `missed-calls.ts` 329-332 (`coalesce` so an undecided row cannot pass by NULL), and `leads.ts` 178-185 (`leads_closed_iff_reason`, `leads_closed_at_with_reason`). Write: `(job_creation_state = 'created') = (sm8_job_uuid IS NOT NULL)`, `(job_creation_state = 'failed') = (job_creation_error IS NOT NULL)` — except the hold code on `creating`, which the CHECK must admit (`job_creation_error IS NULL OR job_creation_state IN ('creating','failed')`).

**Analog 3 — partial unique as arbiter:** `leads.ts` 146-148 and 0039:191:

```sql
CREATE UNIQUE INDEX "leads_one_open_per_mobile" ON "leads" USING btree ("tenant_id","contact_mobile") WHERE status = 'open';
```

→ `CREATE UNIQUE INDEX "leads_one_lead_per_sm8_job" ON "leads" ("tenant_id","sm8_job_uuid") WHERE sm8_job_uuid IS NOT NULL;` — tenant-scoped for the `quotes_tenant_job_uniq` reason (`quotes.ts` 11-17). Note `quotes.sm8_job_uuid` is `uuid` typed (`quotes.ts` 77); match the type.

**The closed-reason widening** (`leads.ts` 89-105, 173-176): add `'booked_by_tradie'`, `'job_created'`, `'closed_by_tradie'` to `LEAD_CLOSED_REASONS` AND the CHECK literal AND 0041 — "the spelling must match … byte for byte" (171). Then **Mismatch 4** applies: `leads_closed_iff_reason` (`(status IN ('closed','expired')) = (closed_reason IS NOT NULL)`) forbids a reason on a `converted` row. The schema header (85-87) wrote this down in Phase 13: "`converted` (Phase 14) carries NO closed_reason under these CHECKs". D-10 prefers the existing column, so 0041 widens the CHECK to `(status IN ('closed','expired','converted')) = (closed_reason IS NOT NULL)` and `leads.close` (`for-tenant.ts` 4543-4563) maps the two converted reasons to `status = 'converted'` the way it maps `expired` today:

```ts
            status: reason === 'expired' ? 'expired' : 'closed',
```

becomes a three-way; `closeLeadInTx` (`close.ts` 51-78) then stops the cadence `lead_closed` unchanged — which is D-07's "existing `closeLead` path".

**Tripwires:** `NEGATIVE_CLOSE_REASONS` / `isRecentNegativeClose` in `src/core/leads/gate.ts` (imported by `tests/text-back-gate.test.ts` 27-35 alongside `LEAD_CLOSED_REASONS`) must not admit the new reasons as negative — a booked customer must still be texted back next time. `closedReasonFor` (`close.ts` 107-118) is untouched: a converted lead has no ended-cadence reconcile.

---

### `src/db/migrations/0041_*.sql` (one journal entry, D-10)

**Analog:** `0040_phase13_lead_cadence.sql` whole file. The last journal entry is idx 40, `when` 1791444299489 (`meta/_journal.json` tail).

**Header mould** (0040 1-27): the boxed "ONE ENTRY FOR THE PHASE … NO OTHER PLAN IN THIS PHASE TOUCHES THE JOURNAL"; "GENERATED by drizzle-kit from src/db/schema/{leads,quotes}.ts, then renamed … The generator's `when` (N) is AHEAD of 0040's 1791444299489 — CHECKED rather than assumed".

**"Safe to meet Phase 13 code in production"** (0040 29-42): every new `leads` column nullable or defaulted (`job_creation_state DEFAULT 'none' NOT NULL`, the rest nullable); every changed CHECK widening-only. The `leads_closed_iff_reason` rewrite is widening (it admits every row it admitted before). State that.

**Pre-flight paragraph** (0040 54-63): production holds ZERO `leads` rows and the test tenant is paused (CONTEXT constraints), so every CHECK is written plain; the 13-07 push protocol applies (CI on a throwaway branch; hosted: read-only counts, `cron:status` lease 0, `db:generate` no changes, `db:migrate` records 42 entries, second run no-op; the founder runs `db:migrate` by hand on classifier refusal).

**Hand-finished CHECKs** (0040 73-85): `quotes_sync_source_known` was hand-written in `0008` (lines 49-53):

```sql
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_sync_source_known;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_sync_source_known
  CHECK (sync_source IN ('backfill', 'poll'));
```

No drizzle snapshot knows it (the schema file has no `check()` for it — `quotes.ts` 134-143), so drizzle will emit nothing or a bare ADD. Follow 0040's `cadences_stop_reason_known` treatment (0040 79-83): add `check('quotes_sync_source_known', …)` to `quotes.ts` so the spelling is pinned beside `SYNC_SOURCES`, then in 0041 write `DROP CONSTRAINT IF EXISTS` + `ADD … CHECK (sync_source IN ('backfill', 'poll', 'lead'))`. `tests/rls-coverage.test.ts:1193` pins the constraint NAME; keep it.

---

### Mirror pre-insert (`run-sync.ts` first-sight rule, D-05/D-13)

**Analog:** `connect.ts` 205-238 (the backfill's row shape) and `run-sync.ts` 453-516 (the diff).

**The row** (`connect.ts` 205-210):

```ts
  const rows: QuoteUpsert[] = normalized.map((q) => ({
    ...q,
    syncSource: 'backfill' as const,
    // D-15 — see the header. Never 'eligible' from a backfill.
    chaseEligibility: 'needs_review' as const,
  }));
```

→ `{ ...normalizeJob(readBack), syncSource: 'lead', chaseEligibility: 'needs_review' }` via `tx.quotes.upsertMany` inside the same transaction as the lead's `created` write. `QuoteUpsert` is `Omit<NewQuote, 'tenantId'|'id'|'createdAt'|'updatedAt'>` (`for-tenant.ts` 191) — `editDateRaw` is NOT NULL (`quotes.ts` 104), so the read-back's `edit_date` is required; this is the structural reason D-03's read-after-write is mandatory, not cosmetic.

**The contact** = `normalizeContact(parsedJobContact)` (`run-sync.ts` 173-188) → `tx.quoteContacts.upsertMany([…])` (`for-tenant.ts` 5137-5160). `quote_contacts` has no FK to `quotes` by design (`quote-contacts.ts` 54-62), so the order inside the transaction does not matter.

**Why first-sight then opens nothing** (`run-sync.ts` 461-474, 500-503):

```ts
    const stored = await tx.quotes.stateFor(jobs.map((j) => j.sm8JobUuid));
    const previous = new Map(stored.map((row) => [row.sm8JobUuid, row]));
    …
      // D-15 gate. `quote_opened` announces something the cadence engine may
      // act on, so it fires only for a row that lands chase-eligible — which,
      // given the conflict-set rule above, means a brand-new poll-sourced row.
      if (type === 'quote_opened' && prev !== undefined) continue;
```

A pre-inserted row makes `prev` defined → `classifyTransition('Quote','Quote',false)` is `null` (`transitions.ts` 73) and the D-15 gate withholds `quote_opened` regardless. `chase_eligibility` stays `needs_review` because it is absent from the conflict set (`for-tenant.ts` 2760). **No edit to these branches is needed (D-13)** — but see Mismatch 2 on `sync_source`.

**Tests pin this absence:** `tests/sync-upsert.test.ts` 489-496 asserts `connect.ts` cannot reach the outbox; write the twin for the new module ("`create-job.ts` contains no `events.insertMany` and no `classifyTransition`") and a DB-backed case: pre-insert, then `runSyncForConnection` with a `stubClient` returning the same job → `eventsFor(tenantId)` unchanged, `cadences` for that job absent.

---

### `src/core/leads/resolve-booked.ts` + `run-sync.ts` (auto-resolution, D-07/D-12)

**Analog:** `closeLeadsWithEndedCadences` (`close.ts` 120-145):

```ts
export async function closeLeadsWithEndedCadences(tenantId: string, now: Date): Promise<number> {
  const rows = await repositoryFor(tenantId).leads.listOpenWithEndedCadence();
  let closed = 0;
  for (const row of rows) {
    const result = await closeLead(tenantId, row.leadId, closedReasonFor(…), now);
    if (result.kind === 'closed') closed += 1;
  }
  return closed;
}
```

→ `resolveLeadsBookedByTradie(tenantId, now)`: one repository read joining open leads to mirrored jobs by normalised mobile and the window, then `closeLead(tenantId, leadId, 'booked_by_tradie', now)` per row plus the job uuid write. Idempotence is the `status = 'open'` guard in `leads.close` (`for-tenant.ts` 4558-4560) — D-12's "idempotent across repeated polls" needs no marker column (`label-effects.ts` 29-34 says the same).

**The read's join shape** is `listOpenWithEndedCadence` (`for-tenant.ts` 4565-4589): `leads` ⋈ `cadences` on `lead_id` with BOTH sides carrying `tenant_id`. Here: `leads` ⋈ `quote_contacts` on `tenant_id` and a normalised-mobile comparison, ⋈ `quotes` on `(tenant_id, sm8_job_uuid)`. The mobile normaliser is `normalizeAuMobile` (`src/core/cadence/primary-contact.ts` 129-141) reading `mobile` first then `phone` (151-160) — but it is TypeScript; `quote_contacts.mobile` is stored raw (`run-sync.ts` 182). Either normalise in TS after a candidate read (contacts for the tenant edited in the window), or add a stored normalised column. The TS route matches the codebase ("the predicate is written HERE, in TypeScript" — `qualify.ts` 5-14); the window filter can be SQL.

**Exclude our own tap** (D-07 "never double-counted"): a lead whose `job_creation_state = 'created'` is already `converted` by the tap's transaction, so the `status = 'open'` predicate excludes it; also skip jobs whose `sm8_job_uuid` is on any lead (`leads_one_lead_per_sm8_job`).

**Wiring:** D-12 says no new cron job. Call it from `runSyncForConnection` AFTER `repo.transaction` returns (after `run-sync.ts` 549, before 551) — outside the locked transaction, so `closeLead`'s own transaction (`close.ts` 84-91) does not nest; per-connection isolation is already the tick's (`run-sync.ts` 638-656). Add a `leadsResolved` count to `SyncCycleResult` (113-137) and the three zero-literal returns (436-447, 623-634, 644-655). The `sync_runs` row (537-546) has no column for it; do not add one (D-13).

**Tripwire:** D-13 "every existing sync suite passes untouched" — `tests/sync-upsert.test.ts` compares `SyncCycleResult` fields by name in places; a new key is additive, but check `toEqual` on whole results.

---

### `src/core/leads/constants.ts` + `docs/commercial-assumptions.md` (D-07)

**Analog:** `LEAD_MIN_GAP_HOURS` (`constants.ts` 148-161) — a named export with the D-reference and a "why this number" paragraph; the file header (11-15) lists the Phase 13 constants with their doc sections. Add `LEAD_JOB_MATCH_WINDOW_DAYS = 14` and extend the header list.

**Doc section mould** (`commercial-assumptions.md` 311-336): `## 16. \`LEAD_JOB_MATCH_WINDOW_DAYS\` = \`14\`` with **Added**, **What it is**, **Rationale**, **Where it applies** (one place: the resolve-booked read), **If it changes** (the value line + the test pin). Boundary rule throughout the codebase: exactly-at-the-threshold is INSIDE (`qualify.ts` 79-90, `constants.ts` 196-197).

---

### DONE at the door (`inbound.ts`, D-08)

**Analog 1 — the matcher:** `stop-keywords.ts` 38-80 (anchored whole-message regex, non-global, `typeof body !== 'string' → false`); `urgency-keywords.ts` 60-63 shows the Phase 13 copy of that convention. `isDoneMessage(body)`: `/^\s*done\s*[.!]?\s*$/i`.

**Analog 2 — placement:** `handleInboundSms` (`inbound.ts` 245-298). STOP is decided first at 252; the DONE branch goes after 257 (`normalizedFrom`) and before 293 (`forAllTenants_cadencesByContactMobile`), and only when `!isStop`:

1. is `normalizedFrom` (or the raw `from` for a landline — never-text admits `+612/3/7/8` lines, `never-text.ts` 37) one of a client's own numbers? The own-number set is assembled today in `text-back.ts` 372-383 (never-text list + `escalationPhone` via `normalizeAuMobile` AND `classifyCaller` + divert number + SMS-from). Reuse that assembly's rule, not its code path (it is per-tenant and inside a transaction).
2. if yes and `isDoneMessage(body)`: read the escalation most recently SENT (`sent_at IS NOT NULL`) to THAT `to_address` within 48 h with a non-null `lead_id` (`escalations.ts` 707-731 documents `to_address` as the tradie's mobile at send time; 642-648 why a release may rewrite it); `closeLead(tenantId, leadId, 'closed_by_tradie', now)`; insert the inbound row `unmatched` (no cadence) with the tenant id; return a new result kind. No match → one operator alert, row recorded, nothing closed.
3. if the sender is NOT a client's own number, fall through — "an ordinary inbound reply".

The D-06 keyword placement at 330-336 is the comment style to copy ("after STOP, lead replies only"). The compliance-before-evidence ordering (88-96) applies: close the lead, then write the row.

**"The tradie is never texted back"** is structural: the door sends nothing (106-112). Say so in the branch comment and pin it in `tests/inbound-threading.test.ts`'s style (606: log lines carry only ids).

**The alert:** `sendOperatorAlert` (`operator-email.ts` 301) takes a closed `OperatorAlertKind` (65: `'auth_failed' | 'degraded' | 'audit_request'`) and `alertSubject` (189-191) is per kind — add a kind and a subject; `claimOperatorAlert` (`operator-alerts.ts` 43-59, `ON CONFLICT (kind, alert_day) DO NOTHING`) is the once-per-day dedupe if the alert should not repeat, but its `kind` CHECK (`operator-alert-log.ts` 32-37, `operator_alert_log_kind_known`) would need widening in 0041. Decide: email per DONE-unmatched (no table change) vs once per day (0041 widening).

---

### Console: the tap (`inbox/*`, D-01/D-09)

**Analog 1 — the sheet:** `suppress-contact-form.tsx` 52-104. Arm-then-confirm with the consequence stated BETWEEN the taps (80-86), the second tap on a control that did not exist a moment ago (35-43), `useActionState(action.bind(null, tenantId, …), BLANK)`, hidden input carrying the id, `Message` (106-122). The confirm sheet is the warning block grown into a preview: description (verbatim words), suburb, urgency line, the "Created by Backdesk from a missed call on <date>" note — all **plain props** (lint-ban rule, `after-hours-escalation-form.tsx` 24-28: "The only value imports are React, the server action and the sibling leaf").

**Analog 2 — the action:** `inbox/actions.ts` 53-78:

```ts
export async function markHandledAction(_previous: TriageState, formData: FormData): Promise<TriageState> {
  const access = await requireOperator();
  if (access !== 'ok') return { ...BLANK_TRIAGE_STATE, error: OPERATOR_DENIED_MESSAGE[access] };
  const raw = formData.get('inbound_id');
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) return { ...BLANK_TRIAGE_STATE, error: 'That message could not be found.' };
  const result = await markInboundTriaged(raw);
  revalidatePath('/inbox');
  return { error: null, success: result.triaged ? 'Marked handled.' : 'Already handled.' };
}
```

The header (22-51) is the WR-01/CR-01 argument: gate before the body is read; ONE export per `'use server'` file. The tenant-scoped write also wants the membership read: `authorize(tenantId)` in `clients/[id]/actions.ts` 233-258 (`getClaims` → `tenants` through the operator's own JWT). `killContactAction` (`quotes/[quoteId]/actions.ts` 197-229) shows the result-union → sentence switch with `revalidateBoth`.

**Revalidation (Mismatch 1):** `revalidateBoth` (173-184) guards the quote path with `UUID_PATTERN` and receives `''` for a lead (191-195). The new action has no quote and no quote page: call `revalidatePath('/inbox')` and `revalidatePath(\`/clients/${tenantId}\`)` directly; do not import `revalidateBoth`.

**Copy:** fixed sentences per result kind in `inbox/action-state.ts` (analog `clients/[id]/action-state.ts` 115-137); ServiceM8 kinds map to copy the way `connectServiceM8Action` does (`clients/[id]/actions.ts` 45-52: REJECTED / BUSY / UNAVAILABLE / SHAPE). Never provider prose (`console-error-leak.test.ts` 79-93 scans every console file).

**Analog 3 — the row:** `inbox/page.tsx` 282-325. The lead row branch (292-297) and the D-13 gating comment (299-311: "Offered only when the row carries the ids the EXISTING kill path needs … those ids come from this RLS-read row rather than from anything a caller supplied"). The tap is offered when `row.tenantId && row.leadId` and the lead is open with `job_creation_state !== 'created'`; the D-09 facts (job uuid + status, reason) render as text badges (text first, colour second — 221-227).

**Row data (Mismatch 5):** `InboundTriageRow` (`inbound-messages.ts` 225-262) carries `leadId` but no lead status, no job linkage, and the query lists only COLD, untriaged lead replies (305-311; hot ones are escalated and absent — `lead-reply.test.ts` 707). The planner must choose: widen the select with a `leads` join (status, `sm8_job_uuid`, `job_creation_state`, `closed_reason`) — mind `tests/classification-privilege.test.ts` 238-346 pins select lists on THIS file's classification functions, not on `listInboundNeedingTriage` — or a second per-lead read on the page. D-01's "any OPEN lead with at least one inbound reply" is then "any inbox row whose lead is open".

**Verbatim words:** the lead's own words are `inbound_messages.body` rows with `lead_id` set. No per-lead list read exists; `inbound.listThreadedForQuote` (`consume-wins.ts` 326) and `closingLabelRowsForOpenLeads` (`for-tenant.ts` 4107-4137, `leads` ⋈ `inbound_messages` both carrying `tenant_id`) are the shape for `inbound.listForLead(leadId)`. Suburb is not stored anywhere; "suburb if given" is operator-typed or absent (Claude's discretion — record the choice).

---

### Digest lines (`stalled-digest.ts`, D-09)

**Analog:** `buildLeadsSection` 157-214 — a pure builder over `(tenantId, count)` rows and a name directory, fixed words, `null` when empty, sorted by name. Add two tallies: `jobsCreated` and `booked`, each a line in the client's block (`"{client}: {n} lead(s) became ServiceM8 jobs"`, `"{client}: {n} lead(s) booked by the tradie"` — byte-pinned in `tests/lead-digest-section.test.ts`). The reads follow `countColdLeadRepliesSince` (declared in the Phase 13 barrel block, `index.ts` 461-489: "in the inbound family, so the sixteen `forAllTenants_*` exports stand") — put them in the leads family of a repository file, not as new `forAllTenants_*`. Wiring at 334-354 inside the same `try`.

---

### Attribution exclusion (`qualify.ts`, `consume-wins.ts`, D-06)

**Analog:** the touch-0 exclusion (`qualify.ts` 91-113):

```ts
 * TOUCH 0 NEVER QUALIFIES (12-05, D-17). … Excluded HERE and
 * not in `qualifiesAsTouch`, whose two SQL twins feed the live metrics and must
 * stay byte-equivalent to it …
    .filter((row) => row.touchNumber !== ABOUT_QUOTE_TOUCH_NUMBER)
```

A quote is NOT a ledger row, so the exclusion sits where the quote is read: `attributeWonEvent` (`consume-wins.ts` 317-327) already reads `const [quote] = await tx.quotes.byId(event.quoteId)`; a `quote.syncSource === 'lead'` (or a lead linked by `sm8_job_uuid`) short-circuits to a recorded non-attribution before `decideAttribution`. Pin it beside the touch-0 pins (`tests/attribution-qualify.test.ts` 160-189). **See Mismatch 2** — if `sync_source` is overwritten by the next poll, the exclusion must key on the `leads` linkage instead.

---

## Shared Patterns

### Operator gate + membership read
**Source:** `src/app/(console)/inbox/actions.ts` 57-60; `src/app/(console)/clients/[id]/actions.ts` 233-258
**Apply to:** the create-job action. `requireOperator()` first; tenant membership through the operator's own JWT; nothing in `formData` read before both. `tests/operator-authorization.test.ts` 57-66 lists guarded files — add the new action file if it is new (the regex accepts `requireOperator` or `requireOperatorId`).

### No provider prose reaches a column, a log or a screen
**Source:** `src/core/servicem8/types.ts` 1-19; `src/core/sync/outcomes.ts` 1-24; `tests/console-error-leak.test.ts` 79-93; `tests/sync-upsert.test.ts` 482-487
**Apply to:** `job_creation_error` (closed enum / regex CHECK), the action's sentences, every `console.error` in the new modules (fixed string + ids).

### Claim as a guarded UPDATE, never check-then-act
**Source:** `src/db/repository/for-tenant.ts` 4543-4563 (`leads.close`), 2706-2762 (`upsertManyReturning` conflict set), `src/db/repository/escalations.ts` 148-168 (`ON CONFLICT DO NOTHING RETURNING`)
**Apply to:** `claimJobCreation`, the converted write, the partial unique on the job uuid.

### HTTP outside the transaction, one transaction for the writes
**Source:** `src/core/sync/connect.ts` 4-19, 212-238; `src/core/sync/run-sync.ts` 9-23
**Apply to:** `create-job.ts` (POST + read-back outside; mirror + contact + lead state inside).

### Closed-vocabulary three-place pin (TS const ↔ CHECK ↔ test)
**Source:** `src/db/schema/leads.ts` 89-105 + 173-176; `tests/rls-coverage.test.ts` 711-759 (asserted against the DATABASE); `tests/text-back-gate.test.ts` 34-35
**Apply to:** `SYNC_SOURCES`, `LEAD_CLOSED_REASONS`, `LEAD_JOB_CREATION_STATES`, the write-kind enum.

### Client-safe leaf discipline
**Source:** `tests/lint-ban.test.ts` 695-769 (`CLIENT_REACHABLE`); `src/app/(console)/clients/[id]/after-hours-escalation-form.tsx` 24-28
**Apply to:** `inbox/create-job-form.tsx` (`'use client'`, plain props) and `inbox/action-state.ts` (imports nothing). Add both to the list.

### Test-env conventions
- **Pure suites** import nothing from `tests/helpers/env.ts`/`seed.ts` and run on a bare `npm test` (`env.ts` 138-156); `tests/text-back-gate.test.ts`, `tests/lead-digest-section.test.ts` (mocks the barrel via `vi.mock('@/db/repository', importOriginal…)`, 28-37) are the moulds.
- **DB-backed suites** carry the "DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS … MUST NEVER run through `npm run test:remote`" header (`lead-close.test.ts` 39-52), pinned clocks, ACMA fiction-block numbers in an unused range (0491 570 4xx/6xx are taken), by-id teardown, `fileParallelism: false` (`vitest.config.ts`).
- **Live ServiceM8** suites are `describe.skipIf(!canReachServiceM8)` (`connect-servicem8.test.ts` 44) and READ only. D-11 authorises writes for the research spike alone (`scripts/sm8-spike.mjs` is the script mould, header 1-23: "Read-only against the trial account"); keep every CI write test on `stubClient`-style fakes (`sync-upsert.test.ts` 46-67 — add a `post` recorder that returns a canned body/headers).

---

## Structural Mismatches the Planner Must Resolve

1. **Lead rows have no quote → `revalidateBoth`'s quote guard.** `quotes/[quoteId]/actions.ts` 173-184 interpolates a quote path under a UUID guard; the lead tap has none. Revalidate `/inbox` and `/clients/{tenantId}` directly.

2. **The poll overwrites `sync_source`.** `upsertManyReturning`'s conflict set (`for-tenant.ts` 2758) includes `syncSource: sql\`excluded.sync_source\``, so the first poll after the pre-insert rewrites `'lead'` → `'poll'` (only `chase_eligibility` is protected, 2760). If D-06's exclusion and the leads-to-jobs count key on `sync_source`, either remove `syncSource` from the conflict set (then `'backfill'` rows also stop flipping to `'poll'` — check `tests/connect-servicem8.test.ts` 120-121 and any sync test asserting `sync_source = 'poll'`), or key everything on `leads.sm8_job_uuid` and let `sync_source = 'lead'` be a first-sight record only. The second is the smaller change and keeps D-13 literal.

3. **ServiceM8 call outside the DB transaction vs exactly-once.** Resolved by the claim → act → outcome shape (`provision.ts`): `creating` claimed before the POST; indeterminate outcomes hold the claim with `outcome_unknown`; retry adopts by lookup before creating. The planner must specify the lookup key the spike confirms (uuid-in-header → `uuid eq`; else the Backdesk marker in `job_description` + contact mobile within the window).

4. **`leads_closed_iff_reason` forbids a reason on `converted`.** Widen the CHECK in 0041 and make `leads.close` three-way (`for-tenant.ts` 4549), or add `converted_reason`. D-10 prefers the existing column.

5. **The inbox lists inbound rows, not leads; hot lead replies are not listed.** `listInboundNeedingTriage` (305-311) excludes `is_hot`/`keyword_hot` rows and triaged rows. D-01's tap on "any OPEN lead with at least one inbound reply" needs either a `leads` join on the triage row (status + job linkage) or an accepted narrowing ("on its inbox row while it is in the inbox"). The full lead page is Phase 15.

6. **`Sm8Client` has one method and three structural fakes.** Widening the interface (`types.ts` 50-56) breaks `stubClient`/`failingClient` in `sync-upsert`, `sync-failure-alerts`, `quote-events` at `tsc`; update the fakes or add a sibling write type.

7. **The `forAllTenants_*` sixteen-export pin** (`sync-upsert.test.ts` 498-724). The DONE lookup is cross-tenant ("whose own number texted DONE?") and so is "the escalation most recently sent to that number". Put both reads in the escalations/leads families outside `forTenant()` (the Phase 13 precedent for `countColdLeadRepliesSince` and `listHeldEscalationsSince`, `index.ts` 461-489) rather than adding a seventeenth export — or edit the pin deliberately with its recorded-decision comment.

8. **The company lookup field.** `schemas.ts` 100-105 records that the ServiceM8 company object carries no phone/email; "company matched by normalised mobile" (D-02) must go through whatever object the spike finds (`companycontact.json` candidate). No code may assume `company.json?$filter=mobile eq …`.

9. **Job "created" timestamp for the 14-day window.** `NormalizedQuote` carries `dateRaw` (no UTC twin) and `editDateUtc`; neither is creation time, and `sm8Job` models no `create_date`. The spike must settle which field is "created", and 0041/`normalize.ts` may need to mirror it (nullable column, `sm8Timestamp` + `sm8ToUtc`, `normalize.ts` 87-120).

10. **`SyncOutcome` is exhaustive over `Sm8FailureKind`.** `outcomes.ts` 31-38 and the `sync_runs.outcome` CHECK fail to compile/apply if the read kinds are widened; use a sibling enum for write kinds.

11. **Operator alert kinds are closed in two places** (`operator-email.ts` 65; `operator-alert-log.ts` 32-37 + CHECK). A DONE-unmatched alert adds a kind to one or both; the table path needs 0041.

12. **`cadences_kind_identity`** (0039:202) forbids a `lead` cadence carrying `sm8_job_uuid`. The job uuid goes on `leads`, never on the lead cadence; the lead-born job's eventual quote cadence (if the operator triages it `eligible`) is a separate `kind = 'quote'` cadence created by the normal `quote_opened` path — which only fires on `markChaseEligible` (`eligibility.ts` 79-101), never from the pre-insert.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/core/servicem8/client.ts` `post()` | service (HTTP write) | request-response | The repo has never written to ServiceM8; the read method is the shape, the write semantics (uuid-in-header, 409 on duplicate, DELETE/`active=0`) are the D-11 spike's to settle. `src/core/telephony/twilio-client.ts` is the only other external write client and is Basic-auth form-encoded — a weaker analog than the SM8 read path. |
| `src/core/leads/job-description.ts` | utility (pure) | transform | No builder in the repo assembles text FROM a member of the public's words into a third-party system; the escalation SMS builders assemble from a closed vocabulary. The planner should byte-pin the output and keep the marker line ("Created by Backdesk from a missed call on <date>") a constant the adopt-on-retry lookup can search for. |

---

## Metadata

**Analog search scope:** `src/core/{servicem8,sync,leads,telephony,messaging,escalation,alerts,aging,attribution}`, `src/db/{schema,repository,migrations}`, `src/app/(console)/{inbox,clients/[id]}`, `src/app/api/internal/sync-tick`, `tests/*`, `docs/commercial-assumptions.md`, `scripts/sm8-spike.mjs`
**Files scanned:** 58 read in full or by targeted range; 3 greps over `tests/` for pins
**Pattern extraction date:** 2026-10-10
