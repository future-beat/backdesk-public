# Phase 15: Lead Console, Reporting & Privacy - Pattern Map

**Mapped:** 2026-10-11
**Files analyzed:** 41 new/modified (27 source/schema/migration/docs, 14 test files new or deliberately edited)
**Analogs found:** 38 / 41

Inputs: `15-CONTEXT.md` (D-01..D-12), `ROADMAP.md` Phase 15 (success criteria 1-5, planning note), `14-PATTERNS.md` as the format precedent. There is no `15-RESEARCH.md` at mapping time. No `.claude/skills/` directory exists.

All paths are relative to the repo root `<repo>`. Line ranges were read on 2026-10-11 at commit `821e4c4`.

File names marked (proposed) are the mapper's inference from the decisions; the planner may rename them. Everything else is an existing file.

Three facts found while mapping that reshape several decisions are stated up front; the Mismatches section argues each:

- **Nothing in the console masks a mobile.** The inbox prints `row.fromAddress` raw (`inbox/page.tsx` 418); the only mobile formatter is `toLocalSpacedMobile` (`src/core/leads/mobile-spellings.ts`, used at `inbox/page.tsx` 253). "Masked as the inbox does" (D-01/D-02) has no code behind it — the planner picks "raw, behind `requireOperator`" (the inbox's actual rule) or writes the first mask.
- **The client page is a kitchen scan surface that selects no phone number** (`clients/[id]/page.tsx` 145-158, T-6-21) and is RLS-gated, not operator-gated (467-520). D-02's number-bearing log cannot live on it as written.
- **`leads_contact_mobile_e164` is `contact_mobile ~ '^[+]614[0-9]{8}$'` and the column is NOT NULL** (`schema/leads.ts` 199, 281). A keyed hash cannot be written into that column without 0042 widening the CHECK (or a sibling column).

---

## File Classification

### Lead queue (CON-05, D-01)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(console)/leads/page.tsx` (new) | component (server page) | request-response | `src/app/(console)/queue/page.tsx` 82-221 whole | exact |
| `src/app/(console)/leads/lead-card.tsx` (new, `'use client'`) | component | request-response | `src/app/(console)/queue/queue-card.tsx` 56-269; chips from `inbox/page.tsx` 366-412 | exact |
| `src/app/(console)/leads/actions.ts` (new: `closeLeadFromLeads`) | controller (server action) | request-response | `src/app/(console)/queue/actions.ts` 72-108 (`authorize`), 210-251 (`skipFromQueue`) | exact |
| `src/app/(console)/leads/action-state.ts` (new, client-safe leaf) | utility | n/a | `src/app/(console)/queue/action-state.ts` 69-145 | exact |
| `src/db/repository/leads.ts` (mod: `listOpenLeadsForQueue()` cross-tenant, in the lead family) | service (repository) | CRUD | `src/db/repository/for-all-tenants.ts` 900-990 (`forAllTenants_approvalQueue`: cap + true total); `src/db/repository/leads.ts` 98-114 (`countLeadResolutionsSince`, the family placement) | exact (see Mismatch 4) |
| `src/app/(console)/layout.tsx` (mod: one nav item) | component | n/a | itself 162-210 | exact |
| `src/app/(console)/inbox/create-job-form.tsx` (reused, unchanged) | component | request-response | itself 16-194 | exact |
| `src/app/(console)/inbox/page.tsx` (mod: `readLeadJobs` 208-274 extracted to a shared helper or duplicated; lead row gains a `/leads` link) | component | request-response | itself 178-274, 453-457 | exact |
| `src/app/(console)/queue/page.tsx` (mod: nothing but a link from a lead card to `/leads`, if any) | component | — | itself 172-179 | exact |

### Per-client missed-call log (CON-06, D-02)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(console)/clients/[id]/missed-calls/page.tsx` (new sub-page, proposed — see Mismatch 1) | component (server page) | request-response | `src/app/(console)/clients/[id]/text-back/page.tsx` 62-148 (RLS tenant gate → `forTenant(id)` reads, each degrading alone) + `requireOperator` from `queue/page.tsx` 83-93 | exact (composite) |
| `src/db/repository/for-tenant.ts` (mod: `missedCalls.listNewest(limit, before?)` paginated) | service (repository) | CRUD | itself 4653-4659 (`missedCalls.latest`), `src/db/repository/missed-calls.ts` 278-321 (`MissedCallEvidence` — presence booleans, number NOT selected), `for-tenant.ts` 723 + 2655-2660 (`REPORT_LIST_LIMIT` capped list + targeted read) | exact |
| `src/app/(console)/clients/[id]/page.tsx` (mod: link to the log beside 1074-1082; divert number / template versions / arming state summary) | component | request-response | itself 931-951 (`DivertNumberForm` props from `checklist.divert`), 1074-1082 (sibling link idiom), `text-back/page.tsx` 99-131 (`latestAttested` per variant, `isTextBackArmed`) | exact |

### Report figures (RPT-04, D-03, D-10, D-11)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/reporting/document.ts` (mod: `reportMissedCallsSchema`, `figures.missedCalls` OPTIONAL) | utility (zod leaf) | transform | itself 44-56, 205-219 | exact |
| `src/core/reporting/missed-call-figures.ts` (new pure: counts, hour/weekday split, after-hours share, median + P90 seconds, reply rate, funnel) | utility (pure) | transform | `src/core/reporting/metrics.ts` 48-69 (`Rate`, `rateBasisPoints`), 263-288 (`escalationSpeed` median), `figures.ts` 54-87; `src/core/cadence/window.ts` 147-150 (`isoWeekdayInZone`), 185-196 (`TZDate` hours in zone) | exact |
| `src/core/reporting/generate.ts` (mod: reads + `missedCalls` on the figures document; the comparator sees it via `documents`) | service | batch | itself 277-300, 380-395 | exact |
| `src/db/repository/for-tenant.ts` (mod: period reads over `missed_calls`, `leads`, `inbound_messages`, `send_ledger`/receipts for delivered timing) | service (repository) | batch | itself `countThreadedInPeriod`/`countWonQuotesInPeriod` (called at generate.ts 279-280), `missedCalls.countTextBacksSince` 4756-4770 | exact |
| `src/core/reporting/metrics.ts` + `src/db/repository/for-all-tenants.ts` `forAllTenants_reportMetrics` (mod: live month-to-date missed-call counts on `TenantMetricCounts`) | utility + repository | batch | `metrics.ts` 169-250, 313-346; `for-all-tenants.ts` 1468-1550 | exact (an EXISTING export widens — the sixteen pin stands) |
| `src/app/(console)/reports/page.tsx`, `reports/[client]/page.tsx` (mod: live figures with denominators) | component | request-response | `reports/page.tsx` 76-91 (`MetricCell` numerator/denominator), `reports/[client]/page.tsx` 391-470 | exact |
| `src/app/(console)/reports/[client]/[reportId]/page.tsx` (mod: renders the block when present, "no samples" when null, nothing when absent) | component | request-response | itself 123-130, 270-325 (`figures.*` `<dd>`s, `NO_VALUE`) | exact |
| `src/core/reporting/copy.ts` (mod: labels for the new block) | config | n/a | itself (`tests/reporting-copy.test.ts` pins) | exact |

### Design-partner CSV (RPT-05, D-04)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(console)/reports/csv/route.ts` (new GET — see Mismatch 2) | controller (route handler) | file-I/O | `src/app/(console)/audits/requests/[id]/csv/route.ts` 41-99 | exact |
| `src/core/reporting/partner-csv.ts` (new pure: `PARTNER_CSV_HEADER` const + `partnerCsvRows(reports)`) | utility (pure) | transform | none for CSV serialisation (see No Analog); `unchanged.ts` 79-99 for the "one canonical writer" discipline | role-match |
| `src/db/repository/for-all-tenants.ts` or `leads.ts` family (mod: a frozen-figures read — tenant name + `monthly_reports.figures` per month, no lines) | service (repository) | batch | `for-all-tenants.ts` 1534-1537 (tenant name list), `for-tenant.ts` 2650-2660 (`reports.list`) | role-match |

### Privacy notice (COMP-01, D-05)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(marketing)/copy.ts` (mod: `PRIVACY_COPY` callers ¶4 and ¶6, processors, `dateLine`) | config (copy) | n/a | itself 402-520 | exact |
| `src/core/onboarding/privacy-coverage.ts` (mod only if the predicate learns a third name) | utility (leaf) | transform | itself 19-39 | exact |
| `src/core/leads/template.ts` (untouched; pointer pinned) | — | — | itself 40-41, 151-156 | exact |

### Pseudonymisation (COMP-02, D-06)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/leads/pseudonym.ts` (new leaf: `pseudonymiseCaller(e164, pepper)` → HMAC-SHA-256 hex; `isPseudonym(value)`) | utility (pure) | transform | `src/core/intake/ip-hash.ts` 73-79 (salt passed in, never read from env inside), `src/core/messaging/unsubscribe-token.ts` 58-109 (`createHmac('sha256', secret)`, `MIN_SECRET_CHARS`) | exact |
| `src/core/shared/env.ts` (mod: `CALLER_PSEUDONYM_PEPPER: z.string().min(32)`) | config | n/a | itself 200-205 (`AUDIT_IP_HASH_SALT` paragraph) | exact |
| `src/core/leads/pseudonymise.ts` (new pass: `runPseudonymisationPass({ now, pepper })` → counts by kind; never throws) | service | batch | `src/core/telephony/reconcile.ts` 108-188 (`NOTHING`/`FAILED` constants, `try { sweep } catch { fixed string; FAILED }`), `src/core/leads/sweep.ts` 75-182 (`TEXT_BACK_SWEEP_LIMIT` bound, counts object, per-row try), `src/core/leads/balance.ts` 111-130 (counts interface + `NO_*` constant) | exact |
| `src/db/repository/leads.ts` (mod: the due reads + guarded UPDATEs, in the lead family; cross-tenant by design like `countLeadResolutionsSince`) | service (repository) | batch | itself 98-114; `for-tenant.ts` 4817-4845 (`latestForMobile`, `close` guarded UPDATE) | exact |
| `src/app/api/internal/messaging-reconcile/route.ts` (mod: one more awaited pass, counts enumerated field by field) | controller | batch | itself 101-133 | exact |
| `src/db/schema/{leads,missed-calls,inbound-messages}.ts` (mod: `pseudonymised_at timestamptz`; `leads_contact_mobile_e164` widened) | model | CRUD | `leads.ts` 281 (the CHECK), `missed-calls.ts` 345-348 (`withheld_has_no_number` — must still hold after hashing) | exact |
| `src/core/leads/constants.ts` + `docs/commercial-assumptions.md` (mod: `LEAD_PSEUDONYMISE_AFTER_DAYS = 90`, `LEAD_RECENT_CONVERSION_HOURS = 24`) | config + docs | n/a | `constants.ts` 148-161 paragraph shape; `commercial-assumptions.md` §16 (Added / What it is / Rationale / Where it applies / If it changes) | exact |
| `src/core/leads/text-back.ts` (mod: the gate's lead/text reads must match a hashed caller too — pass `[caller, pseudonymiseCaller(caller, pepper)]`) | service | event-driven | itself 395-404 | exact (see Mismatch 3) |

### `recent_conversion` gate rule (D-08b)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/leads/gate.ts` (mod: rule 7 `recent_conversion`; `isRecentConversion(newestLead, now)`; `TextBackFacts.recentConversion`) | utility (pure) | transform | itself 120-150 (`NEGATIVE_CLOSE_REASONS`, `isRecentNegativeClose`), 176-182 (rule 6/7 placement) | exact |
| `src/db/schema/missed-calls.ts` (mod: `TEXT_BACK_SKIP_REASONS` + CHECK, inserted after `recent_negative_close`) | model | CRUD | itself 129-150, 311-313 | exact |
| `src/core/leads/text-back.ts` (mod: one more fact from the same `latestForMobile` row) | service | event-driven | itself 398-404, 426-433 | exact |

### Dedicated error kind (D-07/D-08a)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/schema/leads.ts` (mod: `LEAD_JOB_ERROR_KINDS` + `leads_sm8_job_error_kind_known`) | model | CRUD | itself 176-188, 323-327 | exact |
| `src/core/leads/create-job.ts` (mod: 293-306 writes the new kind instead of `parse_error`) | service | request-response | itself 116-136 (the 23505 detector), 290-306 | exact |
| `src/app/(console)/inbox/action-state.ts` (mod: one `failed:<kind>` sentence) | utility (leaf) | n/a | itself 42-69 | exact |

### Digest (D-09)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/aging/stalled-digest.ts` (mod: one overdue line per client in `buildLeadsSection`; one more read in the same `try`) | service | batch | itself 172-255, 375-399 | exact |
| `src/db/repository/leads.ts` (mod: `countOverdueOpenLeads(now)` — per tenant, `leads ⋈ cadence_touches` or `cadences`, counts only) | service (repository) | batch | itself 98-114; `for-all-tenants.ts` 980-986 (`total` count on the waiting predicate) | exact |

### Migration

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/migrations/0042_phase15_privacy_console.sql` (new; ONE journal entry; idx 42; `when` > 1791619675151) | migration | — | `0041_phase14_job_creation.sql` 1-120 whole; `0040` 91-93 + 115-116 (`DROP CONSTRAINT IF EXISTS` then `ADD` for hand-written CHECKs) | exact |

### Tests

| Test File | Kind | Analog | Match Quality |
|---|---|---|---|
| `tests/leads-page.test.ts` (new: source pins — no quote-id narrowing, requireOperator first, `nameOf` fallback, no raw error) | source-read | `tests/queue-lead-rows.test.ts` 21-110, `tests/inbox-authorization.test.ts` 200-240 | exact |
| `tests/console-error-leak.test.ts` (auto-scans every file under `src/app/(console)` — 28-38; `NAMED_PAGES` 60-67 only if a page needs a named assertion) | source-read | itself | exact |
| `tests/lint-ban.test.ts` (mod: `CLIENT_REACHABLE` 713-793 gains `leads/lead-card.tsx` + `leads/action-state.ts`; the repository-export allowlist ~360-640 gains every new repository export with its one-line record) | source-read | itself 786-793 (the 14-02 entry), 436-443 (the `countColdLeadRepliesSince` / `countLeadResolutionsSince` entries) | exact |
| `tests/operator-authorization.test.ts` (mod: `GUARDED_PATHS` 57-72 gains `leads/actions.ts`, `reports/csv/route.ts`, the missed-calls page) | source-read | itself 57-72, 98-110 | exact |
| `tests/sync-upsert.test.ts` 498-724 (UNCHANGED — the sixteen-export pin; every new cross-tenant read lives in `leads.ts`/`inbound-messages.ts` families) | source-read | itself | exact |
| `tests/monthly-report.test.ts` (mod: a stored pre-Phase-15 row parses and renders unchanged; `figures.missedCalls` present on a fresh generate) | DB-backed | itself 357-500, 613-660 (render-from-row source pin: the report page may value-import only `document`, `copy`, `format`) | exact |
| `tests/report-unchanged.test.ts` (mod: an added `missedCalls` block is CHANGED → version N+1) | pure | itself 220-300 | exact |
| `tests/reporting-missed-call-figures.test.ts` (new pure: median/P90 boundaries, zero denominators → `null`, hour/weekday in zone across DST) | pure | `tests/reporting-metrics.test.ts`, `tests/reporting-figures.test.ts` | exact |
| `tests/partner-csv.test.ts` (new: header byte-pinned; generator's select list and header grep-asserted for no `caller`, `mobile`, `from_address`, `body`, `e164`) | source-read + pure | `tests/inbox-authorization.test.ts` 279-292 (select-list grep), `tests/audit-request-csv.test.ts` 177-181 (purity) | exact |
| `tests/reports-csv-route.test.ts` (new: 404 on non-operator, headers, `runtime`) | route | `tests/messaging-reconcile-route.test.ts` 244-290 (config pins), audit csv route shape | role-match |
| `tests/privacy-page.test.ts` (mod: 134-138 flips — "90 days" now REQUIRED in callers; retention names the pseudonymisation; `dateLine` bumped; Anthropic/Resend/Vercel/Supabase named where D-05 says) | pure | itself 88-172 | exact |
| `tests/text-back-gate.test.ts` (mod: `FAILING` 66-81 + `ORDER` 83-95 gain `recent_conversion` after `recent_negative_close`; 127-130 vocabulary pin unchanged in form) | pure | itself | exact |
| `tests/lead-pseudonymise.test.ts` (new DB-backed read-back: past boundary hashed, inside not, suppressions untouched, converted-with-open-job untouched, no-lead calls after 90 d, idempotent second run = 0, hashed caller still trips rules 6/7 via `decideTextBack` facts built from the repo) | DB-backed | `tests/lead-close.test.ts` 292-470 (seed → act → read columns → second act = no-op), `tests/missed-call-reconcile.test.ts` 434-475 (NOTHING on throw; no number in any log line) | exact |
| `tests/messaging-reconcile-route.test.ts` (mod: 138-147 "six enumerated counts" grows; 217-243 every leaf number/boolean) | route | itself | exact |
| `tests/create-job-action.test.ts` + `tests/lead-job-create-db.test.ts` (mod: sentence-key pin and the unique-violation case assert the new kind) | pure + DB | themselves | exact |
| `tests/lead-digest-section.test.ts` (mod: the overdue line byte-pinned) | pure | itself | exact |
| `tests/rls-coverage.test.ts` (UNCHANGED unless a table is added — 0042 adds columns only) | DB | itself 116-134 | exact |

---

## Pattern Assignments

### `src/app/(console)/leads/page.tsx` (server page, D-01)

**Analog:** `src/app/(console)/queue/page.tsx` — the one cross-client, deadline-ordered, phone-first screen. Copy its skeleton verbatim and change the read:

**Gate before read, discard the caught value** (82-112):
```ts
const access = await requireOperator();
if (access !== 'ok') { return (<section><h1>Queue</h1><p className="error" role="alert">{OPERATOR_DENIED_MESSAGE[access]}</p></section>); }
let page: ApprovalQueuePage;
try { page = await forAllTenants_approvalQueue(); } catch {
  console.error('[queue] approval queue read failed');   // fixed string, nothing else
  return (…'Could not load the queue. Try again in a moment.'…);
}
```

**Names and zones through the operator's own JWT, never a join** (114-124): `supabase.from('tenants').select('id, name, timezone')` → `Map`; `'Another client'` fallback (65). The repository read returns ids only.

**One `now` per render, zone named on every card** (126-160): `slotLabel: \`${formatInTenantZone(row.scheduledAt, timezone)} (${timezone})\``, `relativeLabel: relativeToSlot(…)`, `urgency: deriveUrgency(row.scheduledAt, now)` — "due in 2h" beside the absolute time, never instead. The lead queue's sort key is the next touch's `scheduled_at` (then `first_missed_at`); a lead with no pending touch (cadence ended, lead still open) sorts last by call time — the read decides this in SQL (`ORDER BY`), not the page (the inbox's rule, `tests/inbox-authorization.test.ts` 294-300).

**True total beside the cap, absent at zero** (196-201); **empty state is two sentences** (209-215) — the UAT will see zero rows (CONTEXT constraints).

**The card data is assembled HERE as plain props** (136-190): the lead's mobile (raw or formatted with `toLocalSpacedMobile`), `formatInTenantZone(firstMissedAt)`, `afterHours`, the latest classified reply (`label`, `urgency`, `receivedAt`), the next pending touch (id, number, slot), the job linkage. The create-job sheet props come from `readLeadJobs` (`inbox/page.tsx` 208-274) — extract that helper to `src/app/(console)/components/lead-job-sheets.ts` (server-only; imports `forTenant`) so both pages call one function, or duplicate it; the inbox's `jobSheetFacts` comment (198-206) says why it is a per-tenant read, not a join.

**Deep link to `/queue`:** the approve action is not re-implemented; a lead card links `href="/queue"` (optionally `#touch-<id>` if the queue card gains an `id` attribute) — D-01 "approve touch (deep link into `/queue`)".

---

### `src/app/(console)/leads/lead-card.tsx` (`'use client'`, D-01)

**Analog:** `queue-card.tsx`. Keep: `QueueCardRow`-style prop type with doc comments (56-94); the `touch-when touch-when--stack` header with client name + urgency badge (161-166); `URGENCY_BADGE_CLASS: Record<UrgencyTier, string>` as a map so a new tier is a compile error (108-112); the two-step close in the card's `useActionState` so a settled close removes the other controls (127-150, 294-360): `Close this lead` → consequence sentence → `Close it` / `Keep it`; a settled state replaces the controls with the sentence (317-323).

**Chips from the inbox row** (`inbox/page.tsx` 366-412): label via `labelGuess` / `urgencyGuess` (`components/label-guess.ts`, already in `CLIENT_REACHABLE`), `emergency` is the only coloured urgency; `jobChip`/`LEAD_RESOLUTION_LABELS`/`LEAD_JOB_STATE_LABELS` (119-147) are maps, never `.replace('_',' ')`. Text first, colour second.

**The sheet is mounted, not re-written:** `<CreateJobForm tenantId leadId clientName {...sheet} />` exactly as `inbox/page.tsx` 494-500; the form binds `createJobForLeadAction.bind(null, tenantId, leadId)` (`create-job-form.tsx` 76-79) and revalidates `/inbox` + `/clients/{id}` (`create-job-actions.ts` 141-142) — add `revalidatePath('/leads')` there (Mismatch 5).

**Leaf discipline:** the only value imports are React, the server action, the sibling `action-state`, `label-guess` and (if needed) `URGENCY_LABELS` from `stall-policy` — `tests/lint-ban.test.ts` 713-793 lists what a `'use client'` file may reach; add both new files with a dated one-line record.

---

### `src/app/(console)/leads/actions.ts` + `action-state.ts` (close with reason `operator`, D-01)

**Analog:** `queue/actions.ts`. `authorize(tenantId)` (72-108): UUID guard → `requireOperator()` → membership read through the operator's JWT → `{ ok, name, timezone }`; "BEFORE reading a byte of `formData`" (header 36-37). Then the `skipFromQueue` shape (210-251):
```ts
const parsed = closeLeadSchema.safeParse({ lead_id: String(formData.get('lead_id') ?? '') });
if (!parsed.success) return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };
let outcome: CloseOutcome;
try { const r = await closeLead(tenantId, parsed.data.lead_id, 'operator', new Date()); … }
catch { console.error('[leads] close write failed'); return { …error: BAD_REQUEST_MESSAGE }; }
if (outcome.kind === 'closed') revalidateLeads(tenantId);
return closeControlState(outcome);
```
The core is `closeLead` (`src/core/leads/close.ts` 84-91 — one transaction, stops the cadence, `already_closed` on a second press; `tests/lead-close.test.ts` 292-366 pins it). The action maps `closed | already_closed | not_found` to fixed sentences in `action-state.ts` the way `skipControlState` does (`queue/action-state.ts` 99-145: outcome union + `Record<string,string>` stale messages + `settled: true`). Revalidate `/leads`, `/queue`, `/inbox`, `/clients/{tenantId}` — all four show the lead.

`GUARDED_PATHS` (`tests/operator-authorization.test.ts` 57-72) must list the new action file; the regex accepts `requireOperator` or `requireOperatorId`.

---

### `src/db/repository/leads.ts` — the cross-tenant lead-queue read (D-01)

**Analog:** `forAllTenants_approvalQueue` (`for-all-tenants.ts` 900-990) for the SHAPE: `[rows, counted] = await Promise.all([ select … .orderBy(…).limit(CAP), select count(*)::int ])` → `{ rows, total }`, cap exported beside it (`APPROVAL_QUEUE_CAP = 50`, 776). The read is `leads` LEFT JOIN the next pending `cadence_touches` row (the `latest` subquery idiom at 914-921 — alias names that no real column shares) LEFT JOIN the newest classified `inbound_messages` row for the lead (`label`, `label_confidence`, `urgency`, `received_at` — no `body`; the inbox select-list rule, `tests/inbox-authorization.test.ts` 279-292). `WHERE leads.status = 'open'`.

**Where it lives (Mismatch 4):** NOT a seventeenth `forAllTenants_*`. The Phase 13/14 precedent is explicit (`lint-ban.test.ts` 436-443, 611-616; `index.ts` 515-535): a cross-tenant read that answers a tenantless question goes in the lead family's own file with a dated one-line record in the allowlist, and the sixteen pin stands. This read DOES return a customer mobile per row (like `forAllTenants_cadencesByContactMobile`, `sync-upsert.test.ts` 517-527) — say so in the allowlist comment, and keep `body` out of the select.

**Overdue count for the digest** (D-09): `countOverdueOpenLeads(now)` in the same file — `leads ⋈ cadence_touches` on `(tenant_id, lead_id)` where `status = 'open'` and a touch in `APPROVAL_QUEUE_STATUSES` has `scheduled_at < now`, grouped by tenant; the `countLeadResolutionsSince` shape (98-114: `count(*) FILTER`, `groupBy(tenantId)`, filter zero rows out).

---

### `src/app/(console)/clients/[id]/missed-calls/page.tsx` (sub-page, D-02 — Mismatch 1)

**Analog:** `text-back/page.tsx` 62-148: UUID guard → RLS `tenants` read with the operator's JWT (`notFound()` on null, fixed sentence on error, code only in the log) → `const repo = forTenant(tenant.id)` → each read in its own `try` that degrades to a sentence ("a list that cannot be read costs the operator that list, not the page", header 44-48) → back-link `← {tenant.name}` (143-145). ADD `requireOperator()` first (the `queue/page.tsx` 83-93 block) because this page shows caller numbers — the inbox's rule, stated at `inbox/page.tsx` 30-42.

**Pagination:** newest first, capped, with the true total and a "showing the most recent N" sentence — `reports/[client]/page.tsx` 515-521 is the exact wording mould (`versions.length === REPORT_LIST_LIMIT ? <p>Showing the most recent …</p>`). A `?before=<iso>` cursor on the sub-page is the simplest "paginated" that fits (no in-repo cursor precedent in the console; `TRIAGE_PAGE_SIZE`/`REPORT_LIST_LIMIT`/`APPROVAL_QUEUE_CAP` are all cap-and-say).

**Row content:** `formatInTenantZone(startedAt, tenant.timezone)`, caller kind from `CALLER_KINDS` (`missed-calls.ts` 65), number only when `callerKind === 'mobile'` (D-02), `afterHours` chip, text-back outcome from `TEXT_BACK_STATUSES` + `TEXT_BACK_SKIP_REASONS` (119, 135-150) via a `Record<string,string>` label map (the `LEAD_RESOLUTION_LABELS` house rule), the lead link `/leads` (or `/leads#lead-<id>`) when `leadId` is set, the quote link `/clients/{id}/quotes/{quoteId}` when `textBackRoute === 'quote'` (`cadenceId` → quote via `cadences.quoteId`; the read can join it).

**Repository read:** extend the `missedCalls` family (`for-tenant.ts` 4652-4772) with `listNewest(limit, before?)`: the `latest()` statement (4653-4659) with `.limit(limit)` and an optional `lt(startedAt, before)`; select by name (`MissedCallEvidence` 278-292 is the discipline — list columns, never `select()` star into a page), INCLUDING `callerE164` this once, because the page is operator-gated. Column list: `id, startedAt, afterHours, callerKind, callerE164, textBackStatus, textBackSkipReason, textBackRoute, leadId, cadenceId, pseudonymisedAt`. A pseudonymised row renders "number removed" (the hash is never shown).

**Client page changes** (`clients/[id]/page.tsx`): a sibling link at 1074-1082 (`Missed calls →`), and the "divert number, template set (attested versions), text-back arming state" summary — the divert block already renders at 931-951 and 1036-1045 (`checklist.divert`); template versions and arming come from `repo.textBackTemplates.latestAttested(variant)` per `TEXT_BACK_VARIANTS` and `isTextBackArmed(tenant.id)` (`text-back/page.tsx` 99-131) — three reads in the page's existing `Promise.all` (755-792) with the same tolerated-failure arm. NO number columns on this page (145-158).

---

### `src/core/reporting/document.ts` + `missed-call-figures.ts` (RPT-04, D-03)

**The optional block** (document.ts 44-56 + 213): `z.object({...})` in zod v4 strips unknown keys and does not require missing optional ones, so
```ts
export const reportMissedCallsSchema = z.object({
  captured: z.number().int(),
  byHour: z.array(z.number().int()).length(24),
  byIsoWeekday: z.array(z.number().int()).length(7),
  afterHours: rateSchema,                // { numerator, denominator, rateBp: nullable }
  textDelivered: z.object({ count, medianSeconds: z.number().int().nullable(), p90Seconds: z.number().int().nullable() }),
  replyRate: rateSchema,                 // replies / DELIVERED texts
  funnel: z.object({ leads, jobsCreated, jobsWon, bookedByTradie }),
});
export const reportFiguresSchema = z.object({ …existing…, missedCalls: reportMissedCallsSchema.optional() });
```
parses every stored row (absent → `undefined`), and `parseReportDocument` (205-219) is untouched. The header (22-33) is the argument: no Postgres CHECK on the jsonb, strictness lives here. **`tests/monthly-report.test.ts` 613-660 pins that the report page value-imports only `document`, `copy`, `format`** — the "no samples" rendering is a `null` check in the page, not a function from `metrics`.

**Rates carry their denominator** — `Rate` (`metrics.ts` 48-53, `rateBasisPoints` 63-66 → `null` at zero) is the type; render with the `MetricCell` shape (`reports/page.tsx` 76-91: `(numerator/denominator)` under the rate). **Median/P90** copy `escalationSpeed` (263-288): sort, `Math.floor(n/2)`, even-length average; P90 as `sorted[Math.min(n - 1, Math.ceil(0.9 * n) - 1)]` — pin the boundary in the pure test. `count: 0 → medianSeconds: null` ("no samples", D-10). **Hour/weekday in the tenant zone** copy `window.ts` 147-150 and 185-196: `new TZDate(instant, zone)` then `.getHours()` / `((getDay()+6)%7)+1` — never `Date#getHours()`.

**Denominators the reads must supply** (one transaction, `generate.ts` 244-300 shape; HTTP-free): missed calls with `tenant_id` in the period (`startedAt`); delivered text-backs = `missed_calls.text_back_status = 'sent'` whose ledger row's receipt is `delivered` (`text_back_ledger_id` → `send_ledger` → `delivery_status`; the DLR columns are the `reconcile.ts` 166-240 pass's); call-arrival→delivered seconds = `delivery_updated_at - started_at` (or `ended_at`; say which); replies = `inbound_messages` with `lead_id` in a lead whose text-back is in the delivered set; leads = `leads` created in the period; `jobsCreated` = `sm8_job_state = 'created'`; `bookedByTradie` = `closed_reason = 'booked_by_tradie'` (`leads.ts` 99-100 are these two predicates verbatim); `jobsWon` = those leads' mirrored `quotes.status` in `('Work Order','Completed')` via `sm8_job_uuid` — a COUNT, never cents (D-03, D8).

**Live month-to-date** (`/reports`, `/reports/[client]`): the same pure function over `TenantMetricCounts` widened in `forAllTenants_reportMetrics` (1468-1550: "COUNTS, SUMS AND FEE ROWS … no message body, no customer name") and `repo.metrics.windowCounts` (`reports/[client]/page.tsx` 274). `LIVE_METRICS_WINDOW_DAYS` is a rolling 30; "month to date" is a second `Period` from `period.ts` — do not reinterpret the rolling window.

---

### `src/app/(console)/reports/csv/route.ts` + `partner-csv.ts` (RPT-05, D-04 — Mismatch 2)

**Analog:** `audits/requests/[id]/csv/route.ts` 41-99: `export const runtime = 'nodejs'`; `requireOperator()` first, `404` (not 401/403) on anything but `ok` (53-56); `Response` with
```ts
headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' }
```
(90-98). The filename is a constant (`backdesk-partner-stats.csv`), so no sanitiser is needed. The `/reports` page links to it (`<a href="/reports/csv" download>`), the way the audit request page links its CSV.

**The generator is pure and reads frozen rows only:** `partnerCsvRows(rows: { tenantName, periodStart, figures: ReportFiguresDocument }[])` over `monthly_reports` (newest version per month — `reports.latestVersionOf` idiom, `generate.ts` 418-425) → one row per client per month, columns = `PARTNER_CSV_HEADER` (a `readonly string[]` const, byte-pinned). A month with no `figures.missedCalls` yields empty cells, not zeros (D-10: empty until the first client). Quoting rule: RFC 4180 double-quote any field containing `,`, `"`, `\r`, `\n`; CRLF line ends; no BOM (the sniff test at `audit-request-csv.test.ts` 70-82 shows the repo reads both). **No CSV writer exists in the repo** — this is a new 20-line leaf; `canonicalJson` (`unchanged.ts` 79-99) is the "one writer, written once" mould.

**The structural test** (D-04): grep the repository read's select list and `PARTNER_CSV_HEADER` for `/caller|mobile|e164|from_address|to_address|body|contact/i` and assert none; the `inbox-authorization.test.ts` 279-292 slice-and-regex idiom. Client names are the only identifier (`tenants.name`, resolved in the route through the operator's JWT like `queue/page.tsx` 117-124, or from the service-role read — either is operator-gated; the JWT read is narrower, prefer it).

---

### `src/app/(marketing)/copy.ts` `PRIVACY_COPY` (COMP-01, D-05)

**Analog:** itself 425-520, and the header 402-424 says what Phase 15 changes: "Phase 15 replaces that paragraph when COMP-02 ships the pseudonymisation job". Edits:

- callers ¶4 (473): keep Twilio + ClickSend + Anthropic; D-05 adds WHERE — "Twilio (voice, United States, with a Sydney edge), ClickSend (Australia), Anthropic (United States)". `privacyCoversCallers` (`privacy-coverage.ts` 23, 36-38) needs the two names present in the callers section — any rewording must keep both literal strings or the arm action refuses (`clients/[id]/actions.ts` 792).
- callers ¶6 (476) → the 90-day statement: "Ninety days after a lead closes without becoming a job, we replace your number in our records with a code we cannot turn back into a number. If you became a customer, we keep it until the job is finished and for ninety days after. A STOP request is kept so that it keeps working." (`tests/privacy-page.test.ts` 134-138 currently asserts the OPPOSITE — flip it to require `/90 days|ninety days/i` and the suppression sentence.)
- processors (496-501): the two pinned sentences at 498-499 "never move" (header 414-415); ADD a sentence for Resend/Vercel/Supabase processing locations only if D-05's list is not already covered by `where` 490-491 (Supabase Sydney, Vercel Sydney) and 498 (Resend, Anthropic). It is covered; name Bedrock nowhere (v1.3).
- `dateLine` (433): bump the date; the test's regex `/Last updated \d{1,2} \w+ 2026\./` (77) still passes.

**Pointer pin** already exists: `template.ts` 40-41 + 151-156 (`TEXT_BACK_PRIVACY_POINTER = 'backdesk.com.au/privacy'`, `missing_privacy_pointer`, `extra_link`) and `tests/text-back-template.test.ts`. D-05 "pinned" is satisfied by citing it; no change.

---

### `src/core/leads/pseudonym.ts` + env (COMP-02, D-06)

**Analog 1 — the salt-passed-in leaf:** `ip-hash.ts` 73-79 and its header 17-19 ("a module that read `AUDIT_IP_HASH_SALT` itself could not be tested"):
```ts
export function hashClientIp(ip: string | null, salt: string): string | null {
  if (!ip) return null;
  …
  return createHash('sha256').update(`${salt}:${key}`).digest('hex');
}
```
Write `pseudonymiseCaller(e164: string, pepper: string): string` as `createHmac('sha256', pepper).update(e164).digest('hex')` — the `unsubscribe-token.ts` 108-110 call — with `assertSigningSecret`'s 32-char floor (72-80). Same input → same hash (D-06) by construction; `isPseudonym(v)` = `/^[0-9a-f]{64}$/`.

**Analog 2 — the env entry:** `env.ts` 200-205 (`AUDIT_IP_HASH_SALT: z.string().min(32)` with the "why a salt" paragraph) → `CALLER_PSEUDONYM_PEPPER: z.string().min(32)`. The founder sets it on Vercel + local before 0042 is applied (push protocol); `tests/helpers/env.ts` `REQUIRED` list gains it. Never name the dotfile.

**Where the pepper is read:** `getServerEnv()` in the ROUTE (`messaging-reconcile/route.ts` 103) and in `text-back.ts` (the gate's reads, Mismatch 3) — never inside the pure leaf or the pass.

---

### `src/core/leads/pseudonymise.ts` — the pass (D-06)

**Analog:** `telephony/reconcile.ts` 108-188: a counts interface with per-field doc comments; `NOTHING` and `FAILED` constants; `export async function reconcileMissedCalls(deps) { try { return await sweep(deps) } catch { console.error('[telephony] reconcile failed'); return FAILED } }`. Bound per run like `sweep.ts` 75-80 (`TEXT_BACK_SWEEP_LIMIT = 25` with its paragraph) — e.g. `PSEUDONYMISE_BATCH = 200` rows per kind per night; idempotent because every UPDATE is guarded `pseudonymised_at IS NULL` and the due predicate excludes already-hashed rows.

**Counts by kind** (D-06 "counted and logged by kind"): `{ leadsClosed, leadsConverted, missedCallsWithLead, missedCallsNoLead, inboundRows, failed }`; log one fixed line per kind with the count only (`[pseudonymise] leads_closed=N` — ids never, numbers never; `tests/missed-call-reconcile.test.ts` 456-475 is the "no number in any log line" assertion to copy).

**The three due predicates** (repository, lead family):
1. `leads.status IN ('closed','expired') AND closed_at <= now - 90d AND pseudonymised_at IS NULL` (any `closed_reason` not in `LEAD_CONVERSION_REASONS` — `converted` is its own status, so the status predicate is the whole rule).
2. `leads.status = 'converted' AND pseudonymised_at IS NULL AND EXISTS (quotes q WHERE q.tenant_id = leads.tenant_id AND q.sm8_job_uuid = leads.sm8_job_uuid AND q.status IN ('Completed','Unsuccessful') AND q.edit_date_utc <= now - 90d)` — `booked_by_tradie` leads carry `sm8_job_uuid` too (0041 header 70-72); a converted lead whose job is still open is never touched. Use the mirror's terminal-status column by its real name (`quotes.ts`; `run-sync.ts` 453-549 is where the status lands).
3. `missed_calls.lead_id IS NULL AND started_at <= now - 90d AND pseudonymised_at IS NULL AND caller_e164 IS NOT NULL` (withheld rows have nothing to hash — but still stamp `pseudonymised_at` so the predicate converges, or exclude them; decide and pin).

**The writes, per due lead, in ONE transaction** (`close.ts` 84-91 / `create-job.ts` tail is the `forTenant(tenantId).transaction` shape): `UPDATE leads SET contact_mobile = $hash, pseudonymised_at = now`; `UPDATE missed_calls SET caller_e164 = $hash, caller_raw = CASE WHEN caller_raw IS NULL THEN NULL ELSE $hashRaw END, forwarded_from_raw = …, pseudonymised_at = now WHERE lead_id = $lead`; `UPDATE inbound_messages SET from_address = $hash, normalized_from = $hash, pseudonymised_at = now WHERE lead_id = $lead` — `body` untouched (D-06). `suppressed_contacts` is never in any statement (pin by grepping the module for the table name — `tests/rls-coverage.test.ts` 466 already pins no write grant). `caller_raw`/`forwarded_from_raw` are "replaced the same way" — hash each raw string with the same pepper.

**Wiring** (`messaging-reconcile/route.ts` 101-133): after `reconcileMissedCalls`, `const privacy = await runPseudonymisationPass({ now, pepper }).catch(() => PSEUDONYMISE_FAILED)`; add its fields BY NAME to the `Response.json` (117-131: "enumerated field by field rather than spread"). `tests/messaging-reconcile-route.test.ts` 138-147 and 217-243 then grow; 274-281 ("calls the telephony sweep exactly once, and spreads neither result") gets a twin.

---

### `src/db/schema/*` + `0042` (D-06, D-07, D-08)

**Columns:** `pseudonymisedAt: timestamp('pseudonymised_at', { withTimezone: true })` on `leads`, `missedCalls`, `inboundMessages` — nullable, no default (0041 27-28: "every new column is nullable or defaulted").

**The CHECK that blocks the hash (Mismatch 3):** `leads.ts` 281 `leads_contact_mobile_e164` → widen to `contact_mobile ~ '^[+]614[0-9]{8}$' OR (pseudonymised_at IS NOT NULL AND contact_mobile ~ '^[0-9a-f]{64}$')` — widening only (every existing row passes), hand-finished in 0042 as `DROP CONSTRAINT IF EXISTS … ; ADD CONSTRAINT …` (0040 91-93 + 115-116; 0041 95-96 + 119-120; README "Hand-written objects are invisible to the drizzle snapshots" 11-35). `missed_calls_withheld_has_no_number` (345-348) still holds: a withheld row keeps `caller_e164 NULL`. `leads_one_open_per_mobile` is partial on `status = 'open'` and never meets a hashed row. `inbound_messages` has no shape CHECK on `from_address`/`normalized_from` (360-395: none) — but `normalized_from` is what `forAllTenants_cadencesByContactMobile` matches on (`inbound.ts` 321); a hashed value matches nothing, which is correct.

**Vocabulary widenings:** `TEXT_BACK_SKIP_REASONS` (`missed-calls.ts` 135-150) gains `'recent_conversion'` after `'recent_negative_close'` and the CHECK literal at 311-313 gains it at the same position; `LEAD_JOB_ERROR_KINDS` (`leads.ts` 176-188) gains `'job_taken'` (proposed name: "the adopted job is already another lead's created job") and the CHECK at 323-327 gains it. Both CHECKs were hand-finished in 0040/0041 (0041 84-88 shows the error-kind CHECK edited in place) — 0042 writes `DROP CONSTRAINT IF EXISTS` + `ADD` for each. The three-place pin (TS const ↔ CHECK ↔ test) is `tests/text-back-gate.test.ts` 127-130 and `tests/create-job-action.test.ts`.

**0042 header mould** (0041 1-93): boxed "ONE ENTRY FOR THE PHASE … NO OTHER PLAN IN THIS PHASE TOUCHES THE JOURNAL"; "GENERATED by drizzle-kit from src/db/schema/{leads,missed-calls,inbound-messages}.ts, then renamed … `when` (N) is AHEAD of 0041's 1791619675151 — CHECKED rather than assumed"; "SAFE TO MEET PHASE 14 CODE IN PRODUCTION" (nullable columns; every CHECK widening-only); "PRE-FLIGHT EXPECTATION" (production `leads_total=0`, zero `missed_calls` with a lead; every CHECK plain); the push protocol (CI on a throwaway branch; hosted read-only counts; `cron:status` lease 0; `db:generate` no changes; `db:migrate` records 43 entries, second run no-op; the founder runs `db:migrate` by hand on classifier refusal). Journal: idx 42, tag `0042_phase15_privacy_console`.

---

### `src/core/leads/gate.ts` — `recent_conversion` (D-08b)

**Analog:** rule 6 and its helper (120-150, 176-182). Write beside them:
```ts
const CONVERSION_WINDOW_MS = LEAD_RECENT_CONVERSION_HOURS * 3_600_000;
export function isRecentConversion(newestLead: { status: string; closedAt: Date | null } | undefined, now: Date): boolean {
  if (newestLead === undefined || newestLead.status !== 'converted' || newestLead.closedAt === null) return false;
  return now.getTime() - newestLead.closedAt.getTime() <= CONVERSION_WINDOW_MS;   // exactly-at is INSIDE (constants.ts 196-197 rule)
}
```
and in `decideTextBack`: `// 7 — Phase 15, D-08: a caller whose lead here CONVERTED within 24 h is not re-opened.` `if (facts.recentConversion) return refuse('recent_conversion');` between rule 6 (`recent_negative_close`) and `recent_text` — D-08 says "inserted beside `recent_text`"; after 6 keeps the "per-caller must-not-text facts walk together" argument (header 36-42) intact and makes the stored vocabulary order `…, 'recent_negative_close', 'recent_conversion', 'recent_text', …`. Renumber the header list (14-31) and `tests/text-back-gate.test.ts` `FAILING`/`ORDER` (66-95); the 127-130 pin is the three-place check. `LeadCloseFacts` (`for-tenant.ts` 277-281) already carries `status` — `latestForMobile` (4817-4826) needs no change. `text-back.ts` 402-403 gains `const recentConversion = isRecentConversion(newestLead, now);` and 431 passes it. `constants.ts` gains `LEAD_RECENT_CONVERSION_HOURS = 24` (the `LEAD_MIN_GAP_HOURS` paragraph shape, 148-161) + a `commercial-assumptions.md` section.

---

### `src/core/leads/create-job.ts` — the dedicated kind (D-08a)

**Analog:** itself 290-306: the branch already isolates the case ("23505 naming `leads_sm8_job_created_uniq` … the linkage was cleared") and names its borrowed kind at 293-296 with the reason ("0041 is applied to production … so the vocabulary could not grow"). Replace `const kind: LeadJobErrorKind = 'parse_error'` with the new member; the log line (302-305) stays ids + kind. `CREATE_JOB_SENTENCES` (`inbox/action-state.ts` 42-69) gains `'failed:job_taken': 'That ServiceM8 job already belongs to another lead. Retry — a fresh job will be created.'` (a map, never `.replace`); `tests/create-job-action.test.ts` pins the key set against `LEAD_JOB_ERROR_KINDS`; `tests/lead-job-create-db.test.ts` (UNIQUE_SECOND/UNIQUE_THIRD callers, 44-46) asserts the stored kind.

---

### `src/core/aging/stalled-digest.ts` — overdue line (D-09)

**Analog:** `buildLeadsSection` 172-255 — a pure builder over `(tenantId, count)` rows and a directory; `Tally` gains `overdue`; one line `` `${name}: ${n} open lead${n===1?'':'s'} past the next-touch deadline` `` byte-pinned in `tests/lead-digest-section.test.ts`; `null` when every tally is zero (252). The read `countOverdueOpenLeads(now)` is called inside the SAME `try` at 375-399 ("counts only, the same window, the same try"), and the directory fallback (383-390) covers its tenants. "The queue's overdue count" = `deriveUrgency(scheduledAt, now) === 'overdue'` → `scheduled_at <= now` for a `STALLABLE_TOUCH_STATUSES` touch (`layout.tsx` 56-68 uses `stallBoundary`; overdue is the plain `<= now` — say which and pin it).

---

## Shared Patterns

### Operator gate before any read; names through the operator's JWT
**Source:** `queue/page.tsx` 82-124; `inbox/page.tsx` 276-315; `queue/actions.ts` 72-108; `_auth.ts` 52-86, 123-126
**Apply to:** `/leads` page + actions, the missed-calls sub-page, the CSV route, the live report additions. Pages return the `OPERATOR_DENIED_MESSAGE[access]` paragraph; route handlers return `404`.

### The caught value is discarded; a fixed string reaches the log
**Source:** `queue/page.tsx` 96-112; `create-job-actions.ts` 133-138; `reconcile.ts` 183-187; `tests/console-error-leak.test.ts` (scans every console file, 28-38)
**Apply to:** every new page, action, route and pass. A missed-call row or a lead row carries a number; a Postgres error carries the predicate.

### Counts only out of a tick; fields enumerated, never spread
**Source:** `messaging-reconcile/route.ts` 117-133; `balance.ts` 111-130; `sweep.ts` 89-120
**Apply to:** the pseudonymisation pass and its route fields.

### Closed vocabularies are maps in three places (TS const ↔ CHECK ↔ test), and labels are maps, not string replaces
**Source:** `missed-calls.ts` 129-150 + 311-313; `leads.ts` 176-188 + 323-327; `inbox/page.tsx` 119-137; `queue-card.tsx` 96-112
**Apply to:** `recent_conversion`, the new error kind, every chip on `/leads` and the missed-call log.

### Client-safe leaf discipline
**Source:** `tests/lint-ban.test.ts` 704-793; `queue/action-state.ts` 1-52; `inbox/action-state.ts` 31-41
**Apply to:** `leads/lead-card.tsx`, `leads/action-state.ts`. Sentences live in the leaf; the vocabulary's home (`@/db/schema`) is never imported by a `'use client'` file.

### Every rate carries its denominator; zero denominator is `null`, never 0
**Source:** `metrics.ts` 20-66; `reports/page.tsx` 76-91, 191-202 ("`—` + `no fees`, never `0.0×`")
**Apply to:** every missed-call figure in the frozen block, the live pages and the CSV (empty cell).

### Hashing with a server-held secret passed in as an argument
**Source:** `ip-hash.ts` 73-79; `unsubscribe-token.ts` 58-110; `env.ts` 200-205
**Apply to:** `pseudonym.ts`; the pepper is read once at the edge (`route.ts`, `text-back.ts`) via `getServerEnv()`.

### Cross-tenant reads live in a family file, not as a seventeenth `forAllTenants_*`
**Source:** `tests/sync-upsert.test.ts` 498-724; `tests/lint-ban.test.ts` 436-443, 611-616; `src/db/repository/index.ts` 515-535; `leads.ts` 98-114
**Apply to:** `listOpenLeadsForQueue`, `countOverdueOpenLeads`, the pseudonymisation due-reads, the partner-CSV figures read. Each gets its dated one-line record in the lint-ban allowlist. `forAllTenants_reportMetrics` is an EXISTING export and may widen its select (the "cadences-column" note at 1539-1542 explains why it joins what it joins — keep the new counts to single-table aggregates on `missed_calls`/`leads`).

### Zone-aware time
**Source:** `shared/tenant.ts` 312-330 (`formatInTenantZone`, `NO_VALUE` on bad input); `cadence/window.ts` 147-150, 185-196 (`TZDate`)
**Apply to:** `/leads` and the missed-call log (render), `missed-call-figures.ts` (hour/weekday buckets).

### Test-env conventions
- **Pure suites** (gate, figures, CSV writer, digest section) import nothing from `tests/helpers/env.ts`/`seed.ts`; `tests/text-back-gate.test.ts` and `tests/lead-digest-section.test.ts` are the moulds.
- **DB-backed suites** carry the "DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS … MUST NEVER run through `npm run test:remote`" header (`lead-close.test.ts` 39-52); pinned `NOW`; ACMA fiction-block callers in an unused range (0491 570 6xx is taken by `lead-job-create-db.test.ts` 44-51); `seedTenant`/`seedLead`/`seedMissedCall`/`seedInbound`/`seedSuppression`/`seedQuotes` (`tests/helpers/seed.ts` 154, 766, 494, 1183, 998, 199); by-id `teardownTenants` (1436); `fileParallelism: false` and 30 s timeouts (`vitest.config.ts`); `globalSetup` pauses the production ticks on a sanctioned remote run — never run `test:remote` from an agent.
- **Source-read pins** strip comments first (`inbox-authorization.test.ts` 190-198; `monthly-report.test.ts` 614-622) and grep the function's slice (`indexOf('export async function X')` → next export).
- **Route suites** mock the core with `vi.mock`, import the route after (`messaging-reconcile-route.test.ts` 13-50), and pin `runtime`/`maxDuration`/`timingSafeEqual`/proxy exclusion from source (244-290).

---

## Structural Mismatches the Planner Must Resolve

1. **The client page cannot show caller numbers, and it is not operator-gated.** `clients/[id]/page.tsx` 145-158 (T-6-21: "a phone number would be a fact it does not use") and 467-520 (RLS tenants read, no `requireOperator`). D-02 wants mobiles "on the client page". Resolve as a sub-page `/clients/[id]/missed-calls` (the `text-back/page.tsx` shape + `requireOperator`) linked from the client page, with the number-free summary (divert number, template versions, arming) staying on the client page; OR keep the log on the client page with NO numbers (caller kind only). The first honours D-02's content; the second honours T-6-21. Record the choice.

2. **"Operator-only server action" cannot produce a download.** A Next server action returns state to `useActionState`, not a `Response`; the only in-repo download is a GET route handler (`audits/requests/[id]/csv/route.ts`). D-04's intent (operator-only, from `/reports`) is met by `reports/csv/route.ts` + `requireOperator()` → 404, linked from `/reports`. Add the route to `GUARDED_PATHS`.

3. **A hash cannot be stored where the gate reads.** `leads_contact_mobile_e164` (`leads.ts` 281) refuses anything but `+614…`, and `contact_mobile` is NOT NULL (199). `latestForMobile(caller)` (`for-tenant.ts` 4817-4826) and `existsTextBackToCallerSince(caller…)` (4739-4754) compare the raw caller. D-06 requires both: hashed storage AND working repeat/cool-off rules. Resolution: 0042 widens the CHECK (hash admitted only when `pseudonymised_at IS NOT NULL`); `text-back.ts` reads with `inArray(contactMobile, [caller, pseudonymiseCaller(caller, pepper)])` (and the same for `missed_calls.caller_e164`), so a hashed negative close within 90 d still trips rule 6 — which is the D-06 read-back test's last clause. `isRecentNegativeClose` and the new `isRecentConversion` stay pure (they never see the number). Alternative: a `contact_mobile_hash` column and NULL-ing the raw — but NOT NULL + the open-lead unique make that the larger change.

4. **The lead queue is a cross-tenant read that returns customer mobiles.** The sixteen-export pin (`sync-upsert.test.ts` 498) forbids a new `forAllTenants_*`; the Phase 13/14 precedent (`leads.ts` family + allowlist record) is the path, but the precedent's reads return ids and counts — this one returns a mobile per row, like `forAllTenants_cadencesByContactMobile` does. The allowlist comment must say so and name the operator gate as the only reader; `body` must stay out of the select (test it).

5. **The create-job action revalidates `/inbox` and `/clients/{id}` only** (`create-job-actions.ts` 141-142). Mounting the sheet on `/leads` without `revalidatePath('/leads')` leaves a stale "Create ServiceM8 job" button after a success — the WR-04 class of bug `queue-card.tsx` 42-47 describes. One line; pin it in the leads-page source test.

6. **No mask exists.** D-01/D-02 say "masked as the inbox does"; the inbox shows the full address (`inbox/page.tsx` 418). Either render the full mobile behind `requireOperator` (the inbox's actual rule) or introduce `maskMobile()` in `mobile-spellings.ts` (pure, pinned) and use it on BOTH new surfaces. Do not claim masking that is not implemented.

7. **`reportDocumentsUnchanged` will say CHANGED for every month on the first regenerate after deploy** (`unchanged.ts` 116-121: canonical JSON of `figures` now carries `missedCalls`). That is D-03's stated intent (version N+1, N kept) — but the `/reports/[client]` page lists one row per month with earlier versions one tap away (`reports/[client]/page.tsx` 356-370), and the printed sheet for N has no block. The frozen-render test must assert BOTH: a stored row without the block renders byte-identically, and a fresh generate adds it. There is no stored-report fixture file (`tests/fixtures/` holds ServiceM8 fixtures only) — write one from the current generator's document shape (`document.ts` 166-180) as a JSON literal in the test, parsed through `parseReportDocument`.

8. **Delivered-timing denominator needs the DLR.** `missed_calls.text_back_status = 'sent'` means the provider accepted; "delivered" is the receipt on the ledger row (`reconcile.ts` 166-240; `send_ledger.delivery_status`). Median/P90 over DELIVERED texts (D-03) must join `text_back_ledger_id → send_ledger` and use the receipt timestamp. Say which timestamp is "text delivered" (receipt `delivery_updated_at`) and which is "call arrival" (`started_at`).

9. **`recent_conversion` vs. the open-lead arbiter.** A converted lead exits `leads_one_open_per_mobile` (0041 header 64-68), so today a repeat call opens a second lead. Rule 7 closes that in the GATE only; the lead-open path (`openOrCreate`, `for-tenant.ts` 4775-4790) is downstream of the gate (`text-back.ts` "The gate passed" 444) and needs no change. The DB pin: a second call 1 h after `converted` records `skipped`/`recent_conversion` and inserts no lead.

10. **Withheld rows and `pseudonymised_at`.** `caller_e164 IS NULL` on withheld rows (`missed_calls_withheld_has_no_number`); there is nothing to hash, but `caller_raw`/`forwarded_from_raw` may hold evidence. Decide whether withheld rows are stamped (raw strings hashed) or excluded; the convergence predicate must not re-select them every night.

11. **`privacyCoversCallers` requires the literal strings `Twilio` and `ClickSend` in the callers section** (`privacy-coverage.ts` 23). Any rewording that moves a provider name into the processors section only would silently disarm text-back for every client (`clients/[id]/actions.ts` 792). Keep both names in `callers`.

12. **The lint-ban repository allowlist is exhaustive** (`tests/lint-ban.test.ts` ~360-640 `toEqual([...])` on the barrel's keys). Every new repository export (`listOpenLeadsForQueue`, `countOverdueOpenLeads`, the due-reads, `missedCalls.listNewest` if exported at top level, the frozen-figures read) must be added there with its record line, or `npm test` fails on the barrel shape.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/core/reporting/partner-csv.ts` (CSV serialisation) | utility (pure) | transform | The repo READS CSV (`csv-sniff.ts`, papaparse) and serves a stored blob (`audits/…/csv/route.ts`); nothing writes CSV. Build a 20-line RFC 4180 writer, byte-pin the header, keep `canonicalJson`'s "one writer" discipline. |
| Pagination cursor for the missed-call log | component / repository | CRUD | Every console list is cap-and-say (`REPORT_LIST_LIMIT` 120, `APPROVAL_QUEUE_CAP` 50, `TRIAGE_PAGE_SIZE` 200) with a "showing the most recent N" sentence; no `?before=` cursor exists. Copy the cap-and-say shape first; add a cursor only if D-02's "paginated" is read strictly. |
| A stored pre-Phase-15 `monthly_reports` fixture | test fixture | — | `tests/fixtures/` holds ServiceM8 fixtures only; `monthly-report.test.ts` captures its own v1 at runtime (87-130). Write the literal from `ReportDocument` (`document.ts` 166-180). |

---

## Metadata

**Analog search scope:** `src/app/(console)/{queue,inbox,clients/[id],clients/[id]/text-back,reports,audits/requests/[id]/csv,layout.tsx,_auth.ts}`, `src/app/(marketing)/{copy.ts,privacy}`, `src/app/api/internal/messaging-reconcile`, `src/core/{reporting,leads,telephony,messaging,intake,onboarding,aging,cadence/window.ts,shared}`, `src/db/{schema,repository,migrations}`, `tests/*` (pins), `vitest.config.ts`, `tests/helpers/*`
**Files scanned:** 64 read in full or by targeted range; 14 greps over `src/` and `tests/` for pins and precedents
**Pattern extraction date:** 2026-10-11
