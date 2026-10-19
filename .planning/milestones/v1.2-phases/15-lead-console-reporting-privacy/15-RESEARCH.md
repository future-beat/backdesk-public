# Phase 15: Lead Console, Reporting & Privacy - Research

**Researched:** 2026-10-11 (HEAD `e67d4ca`; CONTEXT `821e4c4`, UI-SPEC `9a7cc4b`, PATTERNS `e67d4ca` read and reconciled below)
**Domain:** in-repo — Next.js 16 console pages + server actions, drizzle/Postgres reads, zod-frozen report documents, HMAC pseudonymisation riding an existing pg_cron tick, one drizzle migration
**Confidence:** HIGH for every in-repo claim (each cites a file and line range read this session); MEDIUM for the privacy wording (copy, not code); nothing in this phase needs a new package or an external fact

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 A new `/leads` page is the lead queue (founder 11 Oct 2026, CON-05):** cross-client, every OPEN lead whether or not it has replied, sorted by the next touch's due time (then by call time), in the approval queue's card shape: caller mobile (operator-only, as the inbox shows it), when they rang (tenant zone), after-hours flag, latest classified reply with label words + urgency, and the next action — approve touch (deep link into `/queue`), create job (the Phase 14 sheet, reused), close (reason `operator`). Usable on a phone; one extra console nav item; the existing `/queue` and `/inbox` are unchanged except links.
- **D-02 Per-client missed-call log on the client page (CON-06):** every diverted call for the client — arrived at, caller kind (mobile / other / withheld; the number only for mobiles, masked as the inbox does), after-hours flag, text-back outcome (sent / delivered / failed / skipped + skip reason / stale), the lead it opened (link to `/leads`) or the quote it attached to — paginated newest first; plus the client page's divert number, template set (attested versions) and text-back arming state, already partly present from Phases 11–12 and completed here.
- **D-03 Report figures (RPT-04):** the frozen monthly report row gains an OPTIONAL `figures.missedCalls` block (old rows without it still parse and render unchanged — pinned by a test on a stored pre-Phase-15 row): missed calls captured with hour-of-day (tenant zone) and weekday split; after-hours share (numerator/denominator); median and P90 call-arrival→text-delivered seconds over DELIVERED text-backs (null with "no samples" when none); reply rate on a delivered denominator; leads → jobs created (our tap) → jobs won, with tradie-booked resolutions as a separate count; every rate shown with its denominator; lead-born jobs are counted, never attributed dollars (D8 stands). The first regenerate of a month creates version N+1 and keeps N. `/reports` instrumentation shows the same figures live (month to date) for the operator.
- **D-04 Design-partner CSV (RPT-05):** a console export (operator-only server action, `/reports`) producing one row per client per month of the same figures with their denominators, header row fixed and pinned, NO phone numbers, NO message bodies, NO caller identifiers of any kind (structural test greps the generator's select list and the fixed header); client names as the only identifier.
- **D-05 Privacy notice review (COMP-01 remainder):** the callers section (shipped Phase 12 D-11) is reviewed for honesty: what is captured from a diverted call, who processes it and where — Twilio (voice, US-hosted with Sydney edge), ClickSend (SMS, AU), Anthropic (drafting + classification, US processing), Resend (email), Vercel (functions, Sydney region), Supabase (DB, Sydney) — and the retention statement updated to the 90-day pseudonymisation of D-06. The first text's plain-text privacy pointer stays `backdesk.com.au/privacy` with no link sent (already enforced by the template validator; pinned). "Last updated" date bumped. Anthropic stays the direct provider; Bedrock-Sydney is a v1.3 item (founder 11 Oct 2026).
- **D-06 90-day pseudonymisation (COMP-02, founder 11 Oct 2026):** 90 days after a lead CLOSES WITHOUT CONVERTING (`closed` with any reason other than the converted reasons), its caller number on the lead, on its missed calls and on its inbound rows is replaced by a keyed hash (HMAC-SHA-256 with a server-held pepper; same input → same hash so repeat-caller, cool-off and dedupe rules keep working; nothing reads the number back); the raw Twilio evidence strings on those missed calls are replaced the same way; message bodies stay; a `pseudonymised_at` timestamp marks each row. CONVERTED leads keep the number until their job reaches a terminal status (Completed/Unsuccessful) + 90 days. Suppressions (`suppressed_contacts`) are never touched. Missed calls with no lead (withheld, skipped) are pseudonymised 90 days after arrival. The job RIDES the existing nightly `messaging-reconcile` tick (03:30 AWST) as one more pass — no new pg_cron job, no `cron:apply`; idempotent, bounded per run, counted and logged by kind; a DB-backed read-back test proves rows past the boundary are hashed, rows inside are not, suppressions untouched, and a hashed caller still trips the Phase 12 gate's repeat/cool-off rules.
- **D-07 Migration 0042 (one entry):** `pseudonymised_at` on `leads`, `missed_calls`, `inbound_messages`; the dedicated error kind for the Phase 14 unique-violation recovery (replacing the borrowed `parse_error`, with its own sheet sentence); the `recent_conversion` text-back skip reason; CHECK widenings hand-written where the original CHECK is hand-written. Push protocol as always; the founder runs `db:migrate` by hand on classifier refusal.
- **D-08 Phase 14 carry-forwards folded in (founder 11 Oct 2026):** (a) the dedicated unique-violation error kind (D-07) wired into `create-job.ts` with a pure + DB pin; (b) `recent_conversion`: a caller whose lead at this client CONVERTED within the last 24 h is skipped by the text-back gate with that reason (inserted beside `recent_text` in the D-06 order, vocabulary pin moved), so a repeat call after a booking does not open a new lead and text.
- **D-09 Digest:** the 06:30 digest's Leads section gains one line for open leads past their next-touch deadline (the queue's overdue count) — no other digest change.
- **D-10 Instrumentation honesty:** no figure is derived from vendor statistics; every rate has a denominator; S4 timing has no live sample until the first client, so the report shows "no samples" rather than a number; the design-partner CSV is empty until then.
- **D-11 Quote behaviour unchanged:** report rows for quotes, attribution, `/queue`, `/inbox` behave as before; frozen reports render byte-identically (test on a stored fixture row).
- **D-12 Founder non-code task alongside (not planned here):** client-agreement clauses — the tradie authorises the messages, Backdesk holds consent evidence; recorded in STATE as a founder todo.

### Claude's Discretion
(CONTEXT.md has no "Claude's Discretion" section. The discretion areas are the ones CONTEXT's Scope line leaves to planning: file placement, accessor names, the exact predicates and the test shapes — each decided below with its reason.)

### Deferred Ideas (OUT OF SCOPE)
- Lead dollars attribution; client-reported call totals; booking-form variable; MMS; Bedrock Sydney + Vercel OIDC federation; per-client dedicated SMS numbers.

### Scope and constraints carried (verbatim)
- In: CON-05, CON-06, RPT-04, RPT-05, COMP-01 (remainder), COMP-02; the two Phase 14 carry-forwards (D-08).
- Out: client-reported monthly call totals (true missed-call rate), booking-form template variable, inbound MMS (v2); Bedrock/identity federation (v1.3); lead dollars attribution (D8); removal of the three inert spike rows (founder's call, never by agents).
- Hosted Supabase is production; migration push protocol; never `test:remote`; `.env*` never named; classifier refuses `db:migrate` (founder runs it) and may refuse `git push`.
- Nothing has ever run live against a customer (12-09 override): zero leads, nothing armed; every live clause is event-gated on the first client; plans need no second phone and no live customer; the console pages must render well with ZERO rows (empty states) because that is what the UAT will see.
- UI hint: yes — queue/inbox card patterns, brand tokens (`src/core/brand.ts`), phone-first; no new design system.
- 13-REVIEW IN-01..11 and 14-REVIEW IN-01..09 open by design.
- GSD model policy: fable for planner/researcher/checker/verifier/ui; opus for executors.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md:45-56) | Research Support |
|----|-------------|------------------|
| CON-05 | Cross-client lead queue sorted by deadline, in the approval queue's shape: caller mobile, when they rang, after-hours flag, latest classified reply with urgency, next action (approve touch, create job, close) | §Q1 — the `/queue` page/card/action mould, the two-authority read, the ids-only cross-tenant read + per-tenant card facts, `closeLead(…,'operator')`, nav wiring, revalidation set |
| CON-06 | Per-client missed-call log (every diverted call, whether it was texted and why not, the lead it opened) and the client's divert number, template set and text-back arming state on the client page | §Q2 — the client page's sections and read style, the `missed_calls`/`leads`/`send_ledger` columns per row, the keyset pagination (no precedent; smallest honest shape), masking ruling, empty states |
| RPT-04 | Monthly report + `/reports` instrumentation: missed calls captured with hour/weekday split, after-hours share, median/P90 arrival→delivered, reply rate on delivered denominator, leads → jobs created → jobs won; rates only with denominators; lead-born jobs counted not valued; frozen reports unchanged | §Q3 — where the report is computed and frozen, the five documents and the unchanged-arbiter, the optional zod block, the exact SQL predicates and the timestamp columns, "no samples", the fixture-row test, the month-to-date live view |
| RPT-05 | Design-partner stats CSV (same figures per client per month) with no phone numbers or message bodies | §Q4 — server action + download island (UI-SPEC) vs route handler (precedent), `Papa.unparse`, the fixed header pin, the structural grep test, the operator guard pin |
| COMP-01 | Privacy notice callers section (what is captured, who processes it, retention) and the first text's plain-text privacy pointer; no link sent | §Q5 — `PRIVACY_COPY` structure, the pinned sentences, `privacyCoversCallers`, the template validator's pointer rule (already pinned), paste-ready wording, the test to flip |
| COMP-02 | Closed non-converting missed-call rows pseudonymised after 90 days by a scheduled job with a read-back test; suppressions kept forever | §Q6/§Q7 — the columns and CHECKs, the pepper env, the three due predicates, the per-lead transaction, idempotency, the reconcile-route pass and its counts, the honest answer on the gate, migration 0042 |
</phase_requirements>

## Summary

Phase 15 is an in-repo phase: every question the planner needs answered is answered by a file that already exists, and the two design artefacts written since CONTEXT (15-UI-SPEC, 15-PATTERNS) agree with each other on most of it. Where they disagree — the missed-call log's placement, the CSV's download mechanism, the lead-queue read's shape, and whether the text-back gate should hash its input — this document picks one answer per question and says why, so the planner does not have to re-litigate. The four decisions, in one line each: the log stays ON the client page as a section whose caller numbers are read only behind `requireOperator()` (D-02's words, the UI-SPEC's layout, T-6-21's intent); the CSV is a server action returning text plus a client island that downloads it (D-04's words, the UI-SPEC's mechanism, `Papa.unparse` from the already-installed papaparse); the `/leads` read is split exactly as the inbox already splits it — an ids-and-instants cross-tenant read in the lead family, then per-tenant `forTenant()` reads for the mobile and the reply — so the sixteen-export pin stands without a record that says "this one returns customer data"; and the gate does NOT hash its input, because the pseudonymisation boundary (90 d after close) is the same length as the negative cool-off (`LEAD_NEGATIVE_COOL_OFF_DAYS = 90`), so a hashed lead cannot be inside any gate window — the "hashed caller still trips the gate" clause is proven through the suppression row (kept raw forever) and through the boundary identity, not through a dual read.

The report work is the most mechanical and the most exacting. The frozen row is five jsonb documents parsed by zod `z.object` schemas; zod v4's object strips unknown keys and treats `.optional()` as absent-OK, so an optional `missedCalls` key on `figures` parses every stored row unchanged — and `reportDocumentsUnchanged` (canonical JSON of the five documents) will correctly say "changed" the first time any month is regenerated after deploy, producing version N+1 and keeping N, which is exactly D-03. The denominators come from columns that exist today: `missed_calls.started_at` (arrival), `send_ledger.delivered_at` via `missed_calls.text_back_ledger_id` (delivered), `inbound_messages.lead_id` (replies), `leads.sm8_job_state = 'created'` / `closed_reason = 'booked_by_tradie'` (already the digest's two predicates verbatim), and the mirror `quotes.status IN ('Work Order','Completed')` joined on `(tenant_id, sm8_job_uuid)` (won). Hour-of-day and weekday are computed in the tenant zone in SQL (`AT TIME ZONE`), counts only.

The privacy and migration work is small but has three sharp edges the planner must schedule in order: the new pepper is a REQUIRED server env var, so it must exist on Vercel BEFORE the code that reads it deploys (otherwise `getServerEnv()` throws for every route); `leads_contact_mobile_e164` refuses a hash until 0042 widens it; and `tests/privacy-page.test.ts:110` currently asserts the callers section does NOT say "90 days" — that assertion flips, it is not a regression.

**Primary recommendation:** plan five waves — (1) 0042 + schema + vocabularies + pepper env + the pure leaves (figures, CSV writer, pseudonym hash, gate rule, error kind); (2) repository reads (lead queue ids, per-tenant card facts, missed-call log, figures counts, due-reads) with the allowlist records; (3) the four surfaces (`/leads`, the client-page section, `/reports` block + column + export, the sheet block) and the digest line; (4) the reconcile pass + DB-backed read-back suite + privacy copy; (5) the founder's push protocol (env → migrate → deploy → probes) with zero-row UAT on a phone.

## Project Constraints (from CLAUDE.md)

- Custom TypeScript + Next.js 16 (App Router; `proxy.ts`, Turbopack) on Vercel; Supabase Postgres in `ap-southeast-2`; drizzle-orm + drizzle-kit for schema and migrations (never Prisma); `zod` v4 at every boundary; `date-fns` + `@date-fns/tz` for tenant-zone handling (never store local times). [CITED: .claude/CLAUDE.md "Technology Stack", "Supporting Libraries"]
- "Free-text LLM classification parsing" and `output_format` are banned — not touched by this phase; no model is in any Phase 15 path (the text-back/lead structural test `tests/text-back-structure.test.ts` already pins "no model under `src/core/leads`" — the pseudonymisation module lands there and must import no SDK). [VERIFIED: tests/text-back-structure.test.ts:1-24]
- Vercel `waitUntil` is banned for must-happen work — the pseudonymisation pass is awaited inside the reconcile route like its two siblings. [CITED: CLAUDE.md "What NOT to Use"; VERIFIED: src/app/api/internal/messaging-reconcile/route.ts:38-70]
- Service-role in server code, RLS written anyway; operator-only console pages prove operator status with `requireOperator()` BEFORE any `getDb()` read (the inbox/queue rule). [VERIFIED: src/app/(console)/queue/page.tsx:30-42, 82-97; src/app/(console)/_auth.ts:41-114]
- GSD workflow enforcement: all edits through `/gsd-execute-phase`; `commit_docs: true`. [VERIFIED: .planning/config.json]
- Hosted Supabase is production; never `npm run test:remote`; `.env*` is never named in a command; no ServiceM8/Twilio/ClickSend writes in this phase. [CITED: 15-CONTEXT "Constraints carried"; memory "Hosted DB is production"]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/leads` queue, lead close, approve deep-link | Frontend Server (Next server component + server actions) | Database (reads via repository) | Operator gate and tenant binding happen server-side; the card is a thin client island only for the two-step close (the queue card's reason) |
| Missed-call log + state line on `clients/[id]` | Frontend Server | Database | Same page family; numbers cross the boundary only behind `requireOperator()` |
| Report figures (frozen) | API/Backend (`src/core/reporting/generate.ts` in one transaction) | Database | Frozen documents are computed once and stored; the page only parses and renders |
| Live month-to-date figures + overview column | Frontend Server | Database (grouped counts) | Same pure function as the freeze, different `Period`; counts only cross the repository |
| Design-partner CSV | Frontend Server (server action) + Browser (Blob download island) | Database (frozen rows) | Operator gate in the action; serialisation pure; the browser only turns a string into a file |
| Pseudonymisation pass | API/Backend (reconcile route pass, pg_cron-triggered) | Database (guarded UPDATEs in one tx per lead) | Must-happen nightly work with counts out; idempotent at the row |
| `recent_conversion` gate rule, dedicated error kind | API/Backend (pure core + DB vocab) | Database (CHECK) | Three-place closed vocabulary (TS const ↔ CHECK ↔ test) |
| Privacy wording | Static (marketing copy module) | — | Pure copy; one predicate (`privacyCoversCallers`) gates arming on it |
| Digest overdue line | API/Backend (stalled-digest runner) | Database (counts per tenant) | Closed vocabulary email; counts only |

## Standard Stack

### Core (no additions — everything is already installed)
| Library | Version (package.json) | Purpose in this phase | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.3.2 | `/leads` page, server actions, the export island | the console's framework [VERIFIED: package.json:47] |
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 | the new reads, the pass's UPDATEs, migration 0042 | repository layer + journal [VERIFIED: package.json:46,58] |
| `zod` | 4.4.3 | `reportMissedCallsSchema` (optional on `figures`), action input schemas, the pepper env entry | every stored document is parsed by zod [VERIFIED: package.json:53; src/core/reporting/document.ts:12-24,125-139] |
| `papaparse` + `@types/papaparse` | 5.7.0 / 5.5.2 | `Papa.unparse` for the design-partner CSV | already a dependency (CSV intake); `unparse` is in the typings [VERIFIED: package.json:48,55; node_modules/@types/papaparse/index.d.ts:76] |
| `@date-fns/tz` + `date-fns` | 1.5.0 / 4.4.0 | `calendarMonth`, `currentMonth`, `TZDate` for tenant-zone month bounds | the reporting period helpers already use them [VERIFIED: src/core/reporting/period.ts:2-47] |
| `node:crypto` | runtime | `createHmac('sha256', pepper)` | the unsubscribe token already uses HMAC; the audit IP hash uses `createHash` with a salt [VERIFIED: src/core/intake/ip-hash.ts:2,14-20] |
| `vitest` | 4.1.11 | pure + DB-backed suites | the project's test runner [VERIFIED: package.json:10-11,66; vitest.config.mts] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Papa.unparse` | a 20-line hand-written RFC 4180 writer (15-PATTERNS "No Analog Found") | papaparse is already installed and its quoting is proven; a second CSV writer is one more thing to pin. Use `Papa.unparse` with `newline: '\r\n'`, quotes default; byte-pin the header line |
| server action + Blob island (UI-SPEC) | GET route handler `reports/csv/route.ts` (audit CSV precedent; 15-PATTERNS Mismatch 2) | the route is the in-repo download precedent and needs no client JS; but D-04 says "server action" and the UI-SPEC decided the island. Choose the action + island (see §Q4); the route stays the fallback if the island misbehaves on iOS Safari |
| SQL `AT TIME ZONE` hour/weekday grouping | pulling rows and `TZDate(...).getHours()` in JS (window.ts idiom) | SQL keeps counts-only across the repository boundary and never loads caller rows into the page; use SQL |

**Installation:** none. **Version verification:** all from `package.json` read this session; no `npm view` needed because nothing new is installed.

## Package Legitimacy Audit

> No external package is installed by this phase. `papaparse` 5.7.0 is pre-existing (introduced in Phase 9 for CSV intake) and is used here for `unparse` only.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none new) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                      ┌──────────────────────────── operator (phone) ────────────────────────────┐
                      │                                                                          │
   /leads ────────────┤ requireOperator() ─► listOpenLeadsForQueue() [ids, instants, touch state] │
     │                │       │                                                                   │
     │                │       └─► per tenant: forTenant(t).leads.queueCards(ids)  [mobile, reply]  │
     │                │                        forTenant(t).leads.jobLinkageFor / jobSheetFacts     │
     │                │       names/zones ◄── operator JWT (RLS)                                   │
     │   actions:     │  closeLeadFromQueue(tenantId, leadId) ─► closeLead(…,'operator')           │
     │                │  CreateJobForm (unchanged) ─► createJobForLeadAction (+ revalidate /leads) │
     │                │  "Approve the next touch →" ─► /queue#touch-{id}                           │
                      │                                                                          │
   clients/[id] ──────┤ RLS reads (as today) + <section id="missed-calls">:                       │
                      │     requireOperator() ─► forTenant(id).missedCalls.listForLog(before,20)  │
                      │     state line ◄── checklist.divert / arming / attestations (same facts)  │
                      │                                                                          │
   /reports ──────────┤ forAllTenants_reportMetrics(window) [+ missedCalls, afterHours, hasDivert] │
                      │ export action ─► requireOperator() ─► latest frozen rows ─► Papa.unparse  │
                      │       └─► island: Blob → <a download>                                    │
   /reports/[client] ─┤ repo.metrics.missedCallFigures(currentMonth) ─► computeMissedCallFigures │
   generate ──────────┤ generateMonthlyReport(): …existing reads… + missedCallCounts(period)      │
                      │     figures.missedCalls = computeMissedCallFigures(counts)                │
                      │     reportDocumentsUnchanged(next, prev) ─► version N+1 (N kept)          │
   /reports/[c]/[id] ─┤ parseReportDocument(row) ─► figures.missedCalls? ─► optional block        │
                      └──────────────────────────────────────────────────────────────────────────┘

   pg_cron 03:30 AWST ─► POST /api/internal/messaging-reconcile (bearer)
        reconcileMessaging() ─► reconcileMissedCalls() ─► runPseudonymisationPass({ now, pepper })
                                                             ├─ due leads (closed/expired ≥90 d)
                                                             ├─ due leads (converted, job terminal ≥90 d)
                                                             ├─ lead-less missed calls (≥90 d)
                                                             └─ per lead, ONE tx: leads, missed_calls,
                                                                inbound_messages, cadences, send_ledger
                                                                → HMAC(pepper, e164); stamp pseudonymised_at
   pg_cron 06:30 AWST ─► stalled-digest ─► buildLeadsSection(+ countOverdueOpenLeads(now))
   voice webhook ──► sendTextBack ─► decideTextBack(… recentConversion …) ─► skip 'recent_conversion'
```

### Recommended Project Structure (new and touched files)

```
src/app/(console)/
├── layout.tsx                         # + <Link href="/leads">Leads</Link> third (no badge)
├── leads/
│   ├── page.tsx                       # server page: gate → ids read → per-tenant facts → cards
│   ├── lead-card.tsx                  # 'use client': header/meta/reply/controls; two-step close
│   ├── action-state.ts                # leaf: the fixed close/approve sentences, LEAD_TOUCH_COUNT
│   └── actions.ts                     # 'use server': closeLeadFromQueue (authorize → closeLead → revalidate)
├── queue/queue-card.tsx               # + id={`touch-${row.touchId}`} on <article>; import LEAD_TOUCH_COUNT
├── inbox/create-job-actions.ts        # + revalidatePath('/leads')
├── clients/[id]/page.tsx              # + <section id="missed-calls"> (gated read inside its own try) + state line
├── clients/[id]/missed-calls-list.tsx # server component for the section (keeps page.tsx readable)
├── components/text-back-outcome.ts    # leaf: TEXT_BACK_OUTCOME_LABELS, TEXT_BACK_SKIP_REASON_LABELS, CALLER_KIND_LABELS
└── reports/
    ├── page.tsx                       # + Missed calls column + <section id="design-partner-export">
    ├── export-csv-form.tsx            # 'use client' island: useActionState → Blob download
    ├── export-state.ts                # leaf: EXPORT_* sentences
    ├── export-actions.ts              # 'use server': exportDesignPartnerCsv (requireOperator first)
    ├── [client]/page.tsx              # + live month-to-date block (MetricRow) + two split tables
    └── [client]/[reportId]/page.tsx   # + optional sheet block when figures.missedCalls present
src/core/
├── reporting/
│   ├── document.ts                    # + reportMissedCallsSchema; figures gains missedCalls: …optional()
│   ├── missed-call-figures.ts         # pure: computeMissedCallFigures(counts) incl. median/P90
│   ├── partner-csv.ts                 # pure: PARTNER_CSV_HEADER, partnerCsvRows, Papa.unparse
│   ├── generate.ts                    # + missedCallCounts(period) read → figures.missedCalls
│   └── copy.ts                        # + the sheet footnote sentence
├── leads/
│   ├── constants.ts                   # + LEAD_RECENT_CONVERSION_HOURS = 24, PSEUDONYMISE_AFTER_DAYS = 90, PSEUDONYMISE_BATCH = 200
│   ├── gate.ts                        # + isRecentConversion; rule 7 'recent_conversion'
│   ├── text-back.ts                   # + recentConversion fact from newestLead
│   ├── pseudonym.ts                   # pure: pseudonymiseCaller(e164|raw, pepper), isPseudonym
│   ├── pseudonymise.ts                # the pass: due-reads → per-lead tx → counts by kind
│   └── create-job.ts                  # kind 'job_linked_elsewhere' replaces borrowed 'parse_error'
├── aging/stalled-digest.ts            # buildLeadsSection(+overdue) → first line per client
└── shared/env.ts                      # + CALLER_PSEUDONYM_PEPPER: z.string().min(32)
src/db/
├── schema/{leads,missed-calls,inbound-messages}.ts   # pseudonymisedAt; CHECK widenings; vocab +1 each
├── repository/leads.ts                # listOpenLeadsForQueue, countOverdueOpenLeads, listLeadsDueForPseudonymisation
├── repository/for-tenant.ts           # leads.queueCards, leads.pseudonymise(tx), missedCalls.listForLog, metrics.missedCallCounts
├── repository/for-all-tenants.ts      # forAllTenants_reportMetrics widened (EXISTING export; the pin stands at sixteen)
├── repository/index.ts                # barrel lines with dated records
└── migrations/0042_phase15_privacy_console.sql + meta/_journal.json idx 42
src/app/(marketing)/copy.ts            # PRIVACY_COPY callers ¶4/¶6, dateLine
src/app/api/internal/messaging-reconcile/route.ts   # + pseudonymisation pass, fields by name
tests/ …                               # see Validation Architecture
docs/env-vars.md, docs/commercial-assumptions.md, .github/workflows/ci.yml, tests/helpers/env.ts
```

### Q1. `/leads` (D-01) — what to copy, what to read, where the read lives

**The page mould is `queue/page.tsx` verbatim in shape** [VERIFIED: src/app/(console)/queue/page.tsx:82-221]: `export const dynamic = 'force-dynamic'` (line 18); `requireOperator()` first and the denied arm renders `OPERATOR_DENIED_MESSAGE[access]` (83-93); the read inside `try` with the caught value DISCARDED and a fixed `console.error('[queue] approval queue read failed')` (95-112); client names and zones through `createClient()` under RLS into a `Map` with `'Another client'` as the unresolvable name (114-124); ONE `now` for the render (128); `deriveUrgency(row.scheduledAt, now)` computed on the server (160); the count line shows the TRUE total and is absent at zero (196-201); the empty state is two sentences (209-215). The card mould is `queue-card.tsx` [VERIFIED: 56-94 row type; 108-112 `URGENCY_BADGE_CLASS`; 136-150 the `useActionState` held ABOVE the control; 294-360 `SkipControl` two-step]. The deep link needs ONE change to `/queue`: `id={`touch-${row.touchId}`}` on the card's `<article>` — the UI-SPEC's only permitted `/queue` edit [CITED: 15-UI-SPEC §1 Controls].

**Actions mould is `queue/actions.ts`** [VERIFIED: 72-108 `authorize(tenantId)` = UUID guard → `requireOperator()` → RLS `tenants` read; 136-148 `revalidateQueue` with the UUID guard; 210-251 `skipFromQueue` shape: parse → write → `statusOf` for the stale arm → fixed messages]. The close action is the same shape with `closeLead(tenantId, leadId, 'operator', now)` [VERIFIED: src/core/leads/close.ts:39-46 — a tenant transaction that stops the live cadence with `stopWhereLive([id],'lead_closed')`, skips unsent touches `cadence_stopped`, then `leads.close` which only matches `status = 'open'` (for-tenant.ts:4827-4850) and returns `{kind:'closed'}|{kind:'already_closed'}`]. Map `already_closed` → `LEAD_ALREADY_CLOSED_MESSAGE` (settled, `role="status"`), a throw → `LEAD_CLOSE_FAILED_MESSAGE` (not settled, control stays), success → `LEAD_CLOSED_MESSAGE` (settled). Revalidate `/leads`, `/queue`, `/inbox`, `/clients/{tenantId}` [CITED: 15-UI-SPEC §Screens 1].

**Where the read lives — the honest split (resolves 15-PATTERNS Mismatch 4 without a record that says "this one returns a mobile"):** the inbox is already a cross-tenant list followed by per-tenant reads for anything personal: `listInboundNeedingTriage()` then, per tenant, `forTenant(tenantId).leads.jobLinkageFor([...ids])` and `jobSheetFacts(leadId)` [VERIFIED: src/app/(console)/inbox/page.tsx:112-178 `readLeadJobs`]. Do the same:

1. `listOpenLeadsForQueue(cap = LEAD_QUEUE_CAP)` in `src/db/repository/leads.ts` (the lead family file beside `countLeadResolutionsSince` [VERIFIED: src/db/repository/leads.ts:41-57]) — returns `{ rows: Array<{ tenantId, leadId, firstMissedAt, lastMissedAt, missedCallCount, afterHours, next: { touchId, touchNumber, scheduledAt, status } | null }>, total }`. SELECT list: ids, instants, a touch status word, a boolean, an integer — **no `contact_mobile`, no body**. The next touch is the lead's live cadence's earliest `cadence_touches` row with `status IN ('scheduled','needs_draft','pending_approval','approved')` [VERIFIED: TOUCH_STATUSES src/db/schema/cadence-touches.ts:18-26] via `cadences.lead_id` + `kind='lead'` + `status IN ('active','paused')` [VERIFIED: src/db/schema/cadences.ts:17-30,119-121]; ORDER BY `next.scheduled_at ASC NULLS LAST, leads.first_missed_at ASC` in SQL before the LIMIT, plus a `count(*)` for the true total (the approval-queue idiom, for-all-tenants.ts:899). This keeps the "sixteen `forAllTenants_*` exports" pin [VERIFIED: tests/sync-upsert.test.ts:498-500 counts `/forAllTenants_\w+/g` in for-all-tenants.ts only] AND answers 14-REVIEW IN-08 honestly: the family file keeps holding ids-and-counts reads only. Record it in the lint-ban barrel allowlist with a dated line [VERIFIED: tests/lint-ban.test.ts:434-443 the `countLeadResolutionsSince` record is the mould].
2. `forTenant(tenantId).leads.queueCards(leadIds)` — tenant-scoped, one statement per tenant: `contact_mobile`, and the newest `inbound_messages` row for each lead (`id, body, label, label_confidence, urgency, is_hot, received_at`) via the `latest` subquery idiom [VERIFIED: for-all-tenants.ts:914-921 is the alias idiom the PATTERNS doc cites]. `jobLinkageFor` and `jobSheetFacts` are reused as the inbox uses them for the chips and the sheet [VERIFIED: for-tenant.ts:4989-5060].

The page then renders `toLocalSpacedMobile(contactMobile)` [VERIFIED: src/core/leads/mobile-spellings.ts:13-17 — `0412 345 678` form], `labelGuess`/`urgencyGuess` [VERIFIED: src/app/(console)/components/label-guess.ts:2-40], the `after hours` chip from `leads.after_hours`, the inbox's `LEAD_RESOLUTION_LABELS`/`LEAD_JOB_STATE_LABELS` chips [VERIFIED: inbox/page.tsx:54-65]. The `CreateJobForm` is rendered with exactly the sheet the inbox builds (`readLeadJobs` → `CreateJobSheet` shape, inbox/page.tsx:96-109) — lift `readLeadJobs`'s sheet-building into a shared server helper (`src/app/(console)/components/lead-job-sheet.ts`, server-only, imports the repository) so both pages build the same props; `create-job-actions.ts` gains `revalidatePath('/leads')` [VERIFIED: src/app/(console)/inbox/create-job-actions.ts:112-113 revalidates `/inbox` and `/clients/{id}` only — 15-PATTERNS Mismatch 5].

**Masking ruling (D-01 "as the inbox shows it" vs D-02 "masked as the inbox does"):** the inbox renders the FULL `row.fromAddress` in a `<strong>` [VERIFIED: inbox/page.tsx:305-306]; the only mask in the repo is the quote page's `maskMobile` [VERIFIED: clients/[id]/quotes/[quoteId]/page.tsx:302-306, used at 574]. The UI-SPEC decided: full number on operator-only surfaces, no visual masking, never logged, never in a client artefact [CITED: 15-UI-SPEC Typography rule 2]. Adopt that for BOTH surfaces; "masked as the inbox does" in D-02 is read as "shown the way the inbox shows it" (the inbox does not mask). Do not claim masking (15-PATTERNS Mismatch 6).

**Nav:** `layout.tsx` adds `<Link href="/leads">Leads</Link>` after Queue, before Audits, with NO badge [VERIFIED: layout.tsx:162-216; CITED: 15-UI-SPEC Nav decision]. `tests/layout-contract.test.ts` may pin the nav order — check and extend.

**Pins to add:** `tests/console-error-leak.test.ts` walks every file under `(console)` automatically [VERIFIED: tests/console-error-leak.test.ts:28-45] — add `leads/page.tsx` and `clients/[id]/page.tsx`'s section to `NAMED_PAGES` so the "Could not load" sentence is asserted (line 59-64 pattern); `tests/operator-authorization.test.ts` `GUARDED_PATHS` gains `leads/actions.ts`, `leads/page.tsx`, `reports/export-actions.ts` [VERIFIED: tests/operator-authorization.test.ts:50-58 list; 88-99 the regexes]; `tests/lint-ban.test.ts` `CLIENT_REACHABLE` gains `leads/action-state.ts`, `leads/lead-card.tsx`, `components/text-back-outcome.ts`, `reports/export-state.ts`, `reports/export-csv-form.tsx` [VERIFIED: tests/lint-ban.test.ts:780-795 the list and its rule]; a `tests/leads-page.test.ts` source pin in the `queue-lead-rows` mould [VERIFIED: tests/queue-lead-rows.test.ts:32-80].

### Q2. The missed-call log (D-02) — placement, columns, pagination, empty state

**Placement ruling (15-PATTERNS Mismatch 1 vs 15-UI-SPEC §2):** keep it ON the client page as `<section id="missed-calls">` after Quotes and before Recent sync runs (the UI-SPEC), with the list rendered by a server component whose read runs ONLY after `requireOperator()` returns `'ok'` — the inbox's rule applied to one section. The client page today is RLS-only (operator JWT reads; no `requireOperator`) [VERIFIED: clients/[id]/page.tsx:328-339, 378-434] and its header rule is "no phone numbers on this page" (T-6-21, cited by 15-PATTERNS). Gating the section — not the page — honours D-02's "on the client page", the UI-SPEC's layout, and T-6-21's intent (a number is rendered only for the operator, inside its own `try`, degrading to its own sentence). If `requireOperator()` is not `'ok'`, the section renders `OPERATOR_DENIED_MESSAGE[access]` and no row. Add the page to `GUARDED_PATHS`.

**Per-row facts and where they come from** [VERIFIED: src/db/schema/missed-calls.ts:82-158]: `started_at` (arrival), `after_hours`, `caller_kind ∈ ('mobile','other_number','withheld')` (line 19), `caller_e164` (NULL iff withheld — CHECK `missed_calls_withheld_has_no_number`, 228-231), `text_back_status ∈ ('claimed','sent','failed','skipped')` (54), `text_back_skip_reason` (58-73; non-NULL iff skipped — CHECK 217-220), `text_back_route ∈ ('lead','quote')` (76), `text_back_decided_at`, `lead_id`, `cadence_id`, `text_back_ledger_id`, new `pseudonymised_at`. Delivery verdict: LEFT JOIN `send_ledger` on `text_back_ledger_id` for `delivery_status ∈ ('delivered','undelivered','unknown')` [VERIFIED: src/db/schema/send-ledger.ts:21-22,56-62] — exactly `getTextBackEvidenceForTenant`'s join [VERIFIED: src/db/repository/missed-calls.ts:468-496]. The lead's state for the link line: LEFT JOIN `leads` on `lead_id` for `status, closed_reason`. The quote for a `quote` route: `cadences.quote_id` via `cadence_id`. Dead letters never appear (`tenant_id IS NULL` rows are excluded by the tenant scope).

**Accessor:** `forTenant(id).missedCalls.listForLog({ before?: { startedAt: Date; id: string }, limit: 20 })` — the `latest()` statement [VERIFIED: for-tenant.ts:4653-4659] with named columns (the `MissedCallEvidence` discipline, missed-calls.ts:153-168 — never `select()` star into a page), `ORDER BY started_at DESC, id DESC` over `missed_calls_tenant_started_idx` [VERIFIED: missed-calls.ts:164-168], keyset `WHERE (started_at, id) < (before.startedAt, before.id)`. Also a `countInWindow(since)` for the state line's "{n} calls in the last 30 days".

**Pagination:** no cursor exists anywhere in the console — every list is cap-and-say (`REPORT_LIST_LIMIT = 120`, `LIST_LIMIT = 50` on audits/requests with "Showing the latest 50") [VERIFIED: for-tenant.ts:723; audits/requests/page.tsx:47,120,208]. D-02 says "paginated", so the smallest honest cursor: `?calls_before=<ISO>_<uuid>` read from the page's `searchParams` (Next 16: a Promise), parsed with a zod schema; malformed → page one silently; "Show older calls →" only when the page is full; "← Newest calls" when paged [CITED: 15-UI-SPEC §2 Pagination]. Page size 20.

**State line:** the divert number, text-back arming and attested-template facts are ALREADY read by `readGoLiveChecklist` for the checklist card [VERIFIED: clients/[id]/page.tsx:601-622; checklist-card.tsx:80-88 the row labels `divertNumber`, `divertVerified`, `textBackTemplates`, `textBackArmed`; checklist.ts:283,352 `live: {textBack: LiveState}`] — render the line from `checklist.divert.numberE164`, `checklist.arming`/`live.textBack`, and the attestation facts the card already receives, so the line and the card cannot disagree. Template VERSIONS: `repo.textBackTemplates.latestAttested(variant)` per `TEXT_BACK_VARIANTS` [VERIFIED: for-tenant.ts textBackTemplates interface; text-back/page.tsx:5-14] gives `attestedAt` per variant — show "templates attested {date}" (the latest of the three) with a link to `/clients/{id}/text-back`.

**Labels are maps** (`TEXT_BACK_OUTCOME_LABELS`, `TEXT_BACK_SKIP_REASON_LABELS`, `CALLER_KIND_LABELS`) in a leaf that imports nothing; a pure test reads `TEXT_BACK_SKIP_REASONS`/`TEXT_BACK_STATUSES`/`DELIVERY_STATUSES`/`CALLER_KINDS` and fails on a member without an entry [CITED: 15-UI-SPEC §2 maps + house rule]. The "deciding…/sending…/stuck" words use `TEXT_BACK_STUCK_MINUTES = 2` [VERIFIED: src/core/leads/constants.ts:31].

**Empty state:** `No diverted calls yet.` + the divert-aware second sentence; section-level error `Could not load the missed calls. Try again in a moment.` [CITED: 15-UI-SPEC §2].

### Q3. Report figures (D-03) — where, how, the exact queries

**Where the report is computed and frozen** [VERIFIED: src/core/reporting/generate.ts:111-346]: `generateMonthlyReport(tenantId, {year, month}, now)` runs in `forTenant(tenantId).transaction` (134); `calendarMonth(timezone, year, month)` (144; period.ts:27-30); the four count reads (167-170: attributions, `ledger.countQuotesChasedInPeriod`, `inbound.countThreadedInPeriod`, `events.countWonQuotesInPeriod`); `computeReportFigures` (174-184; figures.ts:41-66); the five documents `{figures, lines, baseline, constants, fees}` (279-285); **the version arbiter**: `reports.latestVersionOf(periodStart)` → `reports.byId` → `reportDocumentsUnchanged(documents, previous)` returns `{kind:'unchanged'}` else `insertVersion` (308-341); a 23505 on `monthly_reports_version_uniq` → `{kind:'concurrent'}` (65-71, 342-345). `reportDocumentsUnchanged` compares `canonicalJson` of the five keys [VERIFIED: src/core/reporting/unchanged.ts:13-50]. Consequence (15-PATTERNS Mismatch 7, and D-03's intent): the first regenerate of any month after deploy yields version N+1 because `figures` now carries `missedCalls`; N is kept and listed under "show earlier versions" [VERIFIED: reports/[client]/page.tsx:283-288, 421-446].

**How the row is parsed and rendered:** `parseReportDocument(row)` parses each document with its zod schema [VERIFIED: document.ts:125-139]; `reportFiguresSchema` is `z.object({...11 int fields})` (12-24). Zod v4 `z.object` strips unknown keys and treats `.optional()` keys as absent-OK, so

```ts
// src/core/reporting/document.ts — ADD; existing keys untouched
const rateSchema = z.object({ numerator: z.number().int(), denominator: z.number().int(), rateBp: z.number().int().nullable() });
export const reportMissedCallsSchema = z.object({
  captured: z.number().int(),
  withheld: z.number().int(),
  byHour: z.array(z.number().int()).length(24),      // tenant-zone hour 0..23
  byIsoWeekday: z.array(z.number().int()).length(7), // Mon..Sun
  afterHoursByIsoWeekday: z.array(z.number().int()).length(7),
  afterHours: rateSchema,
  textBacks: z.object({ sent: z.number().int(), delivered: z.number().int(), medianSeconds: z.number().int().nullable(), p90Seconds: z.number().int().nullable() }),
  replyRate: rateSchema,                              // replied leads / DELIVERED text-backs
  funnel: z.object({ leads: z.number().int(), jobsCreated: z.number().int(), jobsWon: z.number().int(), bookedByTradie: z.number().int() }),
});
export const reportFiguresSchema = z.object({ /* …the eleven existing fields… */, missedCalls: reportMissedCallsSchema.optional() });
```

parses every stored pre-Phase-15 row to `figures.missedCalls === undefined` [ASSUMED for the zod-v4 strip/optional semantics — training knowledge, consistent with the schema's existing use; pin it with the fixture test below so the executor's `parse()` proves it]. The sheet renders the block only when `report.figures.missedCalls !== undefined` [VERIFIED: reports/[client]/[reportId]/page.tsx:87-91 `figures = report.figures`; 189-229 the six-figure `dl.report-figures` the block follows]. `methodologyNotes(row)` appends one footnote when the block is present [VERIFIED: src/core/reporting/copy.ts:181-220 — notes are derived from the ROW, so an old row gets no new note]. `tests/monthly-report.test.ts` pins that the report page value-imports only `document`, `copy`, `format` [CITED: 15-PATTERNS §document.ts, citing monthly-report.test.ts:613-660] — keep the "no samples" null-check in the page/copy, not in `metrics`.

**The exact reads (one tenant, one `Period`, counts only; HTTP-free):**

| Figure | Predicate (tenant-scoped; `p` = `[period.start, period.end)`) | Columns [VERIFIED] |
|---|---|---|
| captured | `missed_calls.tenant_id = t AND started_at ∈ p` | missed-calls.ts:88,115 |
| withheld | … `AND caller_kind = 'withheld'` | 106 |
| byHour / byIsoWeekday / afterHoursByIsoWeekday | `GROUP BY extract(hour FROM started_at AT TIME ZONE $tz)`, `extract(isodow FROM started_at AT TIME ZONE $tz)`, `count(*) FILTER (WHERE after_hours)` — $tz is `tenants.timezone` (an IANA name validated by `tenants_validate_timezone_trg`) | 115-117; README:11-35 (trigger) |
| afterHours | numerator `count(*) FILTER (WHERE after_hours)`, denominator = captured | 117 |
| textBacks.sent | `text_back_status = 'sent' AND text_back_route = 'lead' AND started_at ∈ p` | 138-142 |
| textBacks.delivered (the S4 and reply denominator) | … `JOIN send_ledger l ON l.id = missed_calls.text_back_ledger_id AND l.tenant_id = t WHERE l.delivery_status = 'delivered'` | missed-calls.ts:154; send-ledger.ts:56,62; missed-calls repo 487-491 |
| medianSeconds / p90Seconds | over the delivered set: `extract(epoch FROM (l.delivered_at - missed_calls.started_at))` — **arrival = `started_at`** (D-03 says call-arrival; `ended_at` is nullable and is the greeting's end), **delivered = `send_ledger.delivered_at`** (the provider's receipt timestamp, written only when `status === 'delivered'`) [VERIFIED: src/core/messaging/receipts.ts:309; src/db/repository/delivery-receipts.ts:120-121]. Clamp negatives (provider clock skew) to 0 and pin; `count = 0 → null` ("no samples", D-10) | send-ledger.ts:62,65 |
| replyRate | numerator = `count(DISTINCT mc.lead_id)` over the delivered set `WHERE EXISTS (SELECT 1 FROM inbound_messages i WHERE i.tenant_id = t AND i.lead_id = mc.lead_id AND i.attribution = 'threaded')`; denominator = textBacks.delivered. Lead-level both sides, so a chatty caller counts once | inbound-messages.ts:72,93 |
| funnel.leads | `leads.tenant_id = t AND first_missed_at ∈ p` | leads.ts:91 |
| funnel.jobsCreated | … `AND sm8_job_state = 'created'` — the digest's predicate verbatim | repository/leads.ts:42 |
| funnel.jobsWon | … `AND sm8_job_state = 'created' AND EXISTS (quotes q WHERE q.tenant_id = leads.tenant_id AND q.sm8_job_uuid = leads.sm8_job_uuid AND q.status IN ('Work Order','Completed'))` — a COUNT, never cents (D-03/D8) | quotes.ts:54-55,86,89; jobLinkageFor join at for-tenant.ts:5001-5007 |
| funnel.bookedByTradie | … `AND closed_reason = 'booked_by_tradie'` — the digest's predicate verbatim | repository/leads.ts:43 |

Put the reads on `forTenant().metrics.missedCallCounts(period)` beside `windowCounts` [VERIFIED: for-tenant.ts:2747,5418] returning a `MissedCallCounts` record of integers and two small arrays; `computeMissedCallFigures(counts)` in `src/core/reporting/missed-call-figures.ts` is pure (uses `rateBasisPoints`, metrics.ts:21-24, and a copy of `escalationSpeed`'s median, metrics.ts:145-156, plus P90 = `sorted[Math.min(n-1, Math.ceil(0.9*n)-1)]`). `generate.ts` calls both inside its transaction and sets `figures.missedCalls`.

**Live month-to-date** on `/reports/[client]`: `currentMonth(tenant.timezone, now)` [VERIFIED: period.ts:33-36] → the same `missedCallCounts` → the same pure function → `MetricRow`s (reports/[client]/page.tsx:94-116) with the UI-SPEC's five evidence sentences. The `/reports` overview column: widen `forAllTenants_reportMetrics` (an EXISTING export — the sixteen pin counts names, not select lists) with `missedCalls`, `missedCallsAfterHours` over the rolling window and `hasDivertNumber` (LEFT JOIN `tenant_divert_numbers` active) [VERIFIED: for-all-tenants.ts:1468-1550 shape; `TenantMetricCounts` metrics.ts:63-99]; `tests/report-metrics.test.ts` (DB) and `tests/reporting-metrics.test.ts` (pure) gain the fields.

**The fixture-row test (D-03/D-11):** no stored-report fixture exists (`tests/fixtures/` holds `sm8/` only [VERIFIED: ls tests/fixtures]). Write `tests/fixtures/monthly-report-v1.json` — a literal `StoredReportRow` with the eleven-field `figures`, two `lines`, `baseline`, `constants`, `fees` exactly as `generate.ts:174-261` shapes them — and a pure test that (a) `parseReportDocument(fixture)` succeeds with `figures.missedCalls === undefined`, (b) `canonicalJson(parsed.figures)` equals `canonicalJson(fixture.figures)` (nothing added), (c) `methodologyNotes(parsed)` has exactly the five existing notes, (d) a React server-render of the sheet page is NOT attempted (the page is async + DB); instead pin the page source: the block is inside `figures.missedCalls === undefined ? null : (…)` (the `queue-lead-rows` source-pin mould). Also a DB case in `tests/monthly-report.test.ts`: generate → row has the block → generate again → `unchanged`.

### Q4. CSV export (D-04)

**Mechanism ruling (15-UI-SPEC vs 15-PATTERNS Mismatch 2):** D-04 says "server action" and the UI-SPEC decided the mechanism: the action returns `{ csv, filename, rows }`, a `'use client'` island builds a `Blob('text/csv;charset=utf-8')`, clicks a temporary `<a download>` and revokes the URL [CITED: 15-UI-SPEC §3a Mechanism]. Adopt it. The in-repo precedent for a DOWNLOAD is the GET route handler `audits/requests/[id]/csv/route.ts` [VERIFIED: 16-66 — `requireOperator()` → 404 on anything but `ok`; `content-disposition: attachment`, `x-content-type-options: nosniff`, `cache-control: private, no-store`]; keep it as the documented fallback (a route at `reports/csv/route.ts` with the same guard) only if the island fails the phone UAT — do not build both.

**Guard:** the action calls `requireOperator()` BEFORE any read (the `reports-authorization` ordering property [VERIFIED: tests/reports-authorization.test.ts:1-20 — "the ORDERING is the property … mocks' call counts on the denied paths"]); add `reports/export-actions.ts` to `GUARDED_PATHS`; write the mocks-call-count test in the reports-authorization mould.

**Data:** the newest version per `(tenant, period_start)` of `monthly_reports` for every tenant — a cross-tenant read of FROZEN documents and tenant names; it returns `figures` jsonb (counts) and `tenants.name` and nothing personal. Put `listLatestReportFiguresForExport()` in a reporting family file (`src/db/repository/reports.ts`, new) with its dated allowlist record; the sixteen pin stands. Parse each row's `figures` with `reportFiguresSchema` (strict shape, not raw jsonb).

**Writer:** `Papa.unparse(rows, { columns: PARTNER_CSV_HEADER, newline: '\r\n' })` [VERIFIED: papaparse 5.7.0 in package.json:48; `unparse` typed in @types/papaparse/index.d.ts:76] — `columns` fixes the header order; papaparse quotes fields containing `,` `"` `\r` `\n`. Byte-pin the first line equals `PARTNER_CSV_HEADER.join(',')`. Empty speed cells are `''`, never `0` (D-10). Proposed header (the plan pins the final list):

`client,month,missed_calls,after_hours_calls,withheld_calls,text_backs_sent,text_backs_delivered,text_back_median_seconds,text_back_p90_seconds,leads_replied_on_delivered,leads_opened,jobs_created,jobs_won,booked_by_tradie`

**The structural test (D-04):** read `src/core/reporting/partner-csv.ts` and `src/db/repository/reports.ts` with comments stripped and assert neither matches `/caller|mobile|e164|from_address|to_address|body|contact_/i`; assert `PARTNER_CSV_HEADER` has no member matching the same; assert the select list names only `tenants.name`, `monthly_reports.period_start`, `.figures`, `.version`, `.tenant_id` (the `inbox-authorization` slice-and-regex idiom). Filename `backdesk-design-partner-stats-{YYYY-MM-DD}.csv` [CITED: 15-UI-SPEC §3a].

### Q5. Privacy wording (D-05)

**Structure** [VERIFIED: src/app/(marketing)/copy.ts:425-520]: `PRIVACY_COPY = { h1, dateLine, sections: [{id, h2, paragraphs[]}…] }`; eight sections in the pinned order `collect, callers, why, where, processors, retention, access, contact` [VERIFIED: tests/privacy-page.test.ts:29-40]; `dateLine` must match `/Last updated \d{1,2} \w+ 2026\./` (50) — today "Last updated 6 October 2026" (copy.ts:433). The page renders every paragraph as an escaped text node [VERIFIED: privacy/page.tsx:12-39].

**Pins that constrain the wording** [VERIFIED: tests/privacy-page.test.ts]: the `where` sentence (63-65) and the processors sentence "Email is sent through Resend, SMS through ClickSend, and message drafting uses Anthropic. These providers process content outside Australia." (68-72) are byte-pinned and must not move; the Twilio processors paragraph is byte-pinned (114-118); the callers section must contain `not recorded`, `withheld`, `one text message`, `Twilio`, `ClickSend`, `outside Australia`, `STOP` (90-105); **line 107-112 asserts `not.toMatch(/90 days/i)` and `toContain('for the term of their agreement')` — FLIP this test** to `toMatch(/90 days|ninety days/i)` and require the suppression sentence; the whole notice must never match `/(all|entirely|fully|only)[^.]{0,40}in Australia/i` (74-78); every paragraph > 40 chars (53-58). `privacyCoversCallers` requires the literal strings `Twilio` and `ClickSend` INSIDE the callers section [VERIFIED: src/core/onboarding/privacy-coverage.ts:7-20] and the arm action refuses without it — keep both names in `callers` (15-PATTERNS Mismatch 11).

**The pointer pin already exists:** `TEXT_BACK_PRIVACY_POINTER = 'backdesk.com.au/privacy'`, `missing_privacy_pointer`, and `extra_link` (any other link in the body) [VERIFIED: src/core/leads/template.ts:40-41,151-157; tests/text-back-template.test.ts:15,165-167]. D-05 "pinned" is satisfied by citing it; add one sentence to `tests/privacy-page.test.ts` asserting `TEXT_BACK_PRIVACY_POINTER` equals `${APEX_DOMAIN}/privacy` so the two cannot drift.

**Paste-ready copy** (replace callers ¶4 and ¶6; keep ¶1–¶3 and ¶5 as shipped [VERIFIED: copy.ts:467-477]):

¶4 (processors + locations): `The call is answered through Twilio, which runs in the United States and connects through its Sydney edge; the text is sent through ClickSend from Australia. Both process these details outside Australia. If the business writes back to you, the wording may be drafted with Anthropic in the United States and a person approves it before it is sent. The record itself is stored with Supabase in Sydney and handled by our software running on Vercel in Sydney.`

¶6 (retention, D-06): `Ninety days after a lead closes without becoming a job, we replace your number in that record — on the call, on the lead and on your messages — with a code we cannot turn back into a number; the words you sent stay with the business's records. If you became a customer, we keep your number until the job is finished and for 90 days after that. A STOP request is kept for as long as it is needed so that it keeps working. You can ask us to remove your number sooner, using the contact details below.`

`dateLine`: bump to the ship date (`Last updated {d} October 2026.`). Processors section: unchanged (Resend/Anthropic/ClickSend and the Twilio paragraph are already there; Supabase/Vercel Sydney are in `where`). Name Bedrock nowhere. [MEDIUM confidence — wording is copy, not code; the founder reviews it at UAT]

### Q6. Pseudonymisation (D-06) — columns, CHECKs, pepper, predicates, the pass, the gate

**Columns to hash, per lead, in ONE `forTenant(tenantId).transaction`:**

| Table.column | CHECK / unique that matters [VERIFIED] | Treatment |
|---|---|---|
| `leads.contact_mobile` (NOT NULL) | `leads_contact_mobile_e164`: `contact_mobile ~ '^[+]614[0-9]{8}$'` (leads.ts:149) — **refuses a hash until widened**; `leads_one_open_per_mobile` partial on `status = 'open'` (130-132) never meets a closed row; `leads_tenant_mobile_created_idx` (138-142) is a plain index | `= HMAC`; CHECK widened in 0042 to `… OR (pseudonymised_at IS NOT NULL AND contact_mobile ~ '^[0-9a-f]{64}$')` |
| `missed_calls.caller_e164` (nullable), `caller_raw`, `forwarded_from_raw` | `missed_calls_withheld_has_no_number`: `(caller_kind='withheld') = (caller_e164 IS NULL)` (228-231) — withheld rows keep NULL; no CHECK on the two raw strings; `missed_calls_text_back_caller_idx` partial (246-248) is a plain index | `caller_e164 = CASE WHEN NULL THEN NULL ELSE HMAC END`; each raw string `= HMAC(raw)` when non-NULL ("replaced the same way") |
| `inbound_messages.from_address` (NOT NULL), `normalized_from` (nullable) | no shape CHECK on either (inbound-messages.ts:76-82,131-170); `inbound_messages_normalized_from_idx` plain | both `= HMAC`; `body` untouched |
| `cadences.contact_mobile` (lead cadences, `kind='lead'`, `lead_id = L`) | no CHECK (cadences.ts:95); read only for LIVE cadences (`status IN ('active','paused')`) by `forAllTenants_cadencesByContactMobile` and `liveQuoteCadenceForMobile` [VERIFIED: for-all-tenants.ts:617-640; for-tenant.ts:3582-3595] — a closed lead's cadence is never live | `= HMAC` — **D-06 does not name this column; without it the retention statement is false** (the number survives on the cadence row). Rides the lead's stamp; no fourth `pseudonymised_at` |
| `send_ledger.to_address` (NOT NULL) WHERE `lead_id = L` | no CHECK (send-ledger.ts:42); never read by address | `= HMAC` — same reason; rides the lead's stamp |
| `suppressed_contacts` | never in any statement (pin by grepping the pass module for the table name) | untouched (D-06) |
| `escalations.to_address` | the tradie's number, not the caller's [VERIFIED: escalations.ts:46; the DONE read keys on it] | untouched |
| `missed_calls.raw_payload`, `inbound_messages.raw_payload` | kept ONLY on dead-letter rows (`tenant_id IS NULL`) [VERIFIED: src/core/telephony/missed-call.ts:195 `keepRaw`; missed-calls repo 318 `rawPayload: null`; clicksend inbound route:222-233] — attributed rows carry none | out of D-06's scope (dead letters have no caller columns); noted in Assumptions |

**The HMAC leaf** (`src/core/leads/pseudonym.ts`, pure, pepper passed IN — the `hashClientIp(ip, salt)` discipline [VERIFIED: src/core/intake/ip-hash.ts:14-20 and its header "a module that read AUDIT_IP_HASH_SALT itself could not be tested"]): `pseudonymiseCaller(value: string, pepper: string): string` = `createHmac('sha256', pepper).update(value).digest('hex')` (64 lower-hex); `isPseudonym(v) = /^[0-9a-f]{64}$/.test(v)`; refuse a pepper shorter than 32 chars. Same input → same hash by construction.

**The pepper env:** `CALLER_PSEUDONYM_PEPPER: z.string().min(32)` in `serverEnvSchema` beside `AUDIT_IP_HASH_SALT` [VERIFIED: src/core/shared/env.ts:145 the salt entry; 242-285 the `process.env` mapping]; read with `getServerEnv()` in the ROUTE and passed down. Because it is REQUIRED, four places must gain it in the same commit: `docs/env-vars.md` (the contract; AUDIT_IP_HASH_SALT's paragraph at 95-110 and the table row at 288 are the mould), `tests/helpers/env.ts` `REQUIRED` [VERIFIED: 40-56], `.github/workflows/ci.yml` dummy line (the 64-char `openssl rand -hex 32` shape, its own distinct dummy) [VERIFIED: ci.yml:175], and the founder's local file + Vercel Production/Preview (`npm run env:push CALLER_PSEUDONYM_PEPPER --project backdesk` — the script pushes named variables from the local file [VERIFIED: scripts/push-vercel-env.mjs:60-110]). **Order matters:** the Vercel value must exist BEFORE the code deploys, or `getServerEnv()` throws for EVERY route (the Twilio-quartet precedent in STATE: "Founder must add … before any deploy of main").

**The three due predicates** (repository, lead family; `now - 90 d` = `PSEUDONYMISE_AFTER_DAYS` in constants.ts, defined as `= LEAD_NEGATIVE_COOL_OFF_DAYS` with a comment, see the gate ruling):
1. closed-non-converting: `leads.status IN ('closed','expired') AND closed_at <= now - 90d AND pseudonymised_at IS NULL` — `converted` is its own status [VERIFIED: leads.ts:22,160-168 `leads_closed_iff_reason`, `leads_converted_reason`], so status alone is the rule.
2. converted + terminal job: `leads.status = 'converted' AND pseudonymised_at IS NULL AND EXISTS (quotes q WHERE q.tenant_id = leads.tenant_id AND q.sm8_job_uuid = leads.sm8_job_uuid AND q.status IN ('Completed','Unsuccessful') AND coalesce(q.completion_date_utc, q.unsuccessful_date_utc, q.edit_date_utc) <= now - 90d)` [VERIFIED: quotes.ts:54,89,114,126,130]. A `booked_by_tradie` lead also carries `sm8_job_uuid` (`setMatchedJob`); a converted lead whose job is still open is never touched.
3. lead-less missed calls: `missed_calls.tenant_id IS NOT NULL AND lead_id IS NULL AND started_at <= now - 90d AND pseudonymised_at IS NULL` — stamp EVERY such row (withheld rows have nothing to hash but are stamped so the predicate converges — 15-PATTERNS Mismatch 10 decided: stamp, hash the raw strings if present).
Bound each read with `LIMIT PSEUDONYMISE_BATCH` (200) ordered by the due instant, so a backlog drains over nights and one bad row cannot block the rest.

**The pass** (`src/core/leads/pseudonymise.ts`): the `reconcileMissedCalls` mould [VERIFIED: src/core/telephony/reconcile.ts:108-200 — counts interface, `NOTHING`/`FAILED` constants, `try { sweep } catch { console.error(fixed); return FAILED }`]; counts `{ leadsClosed, leadsConverted, missedCallsNoLead, inboundRows, cadenceRows, ledgerRows, failed }`; one fixed log line per kind with the count only (no id, no number — `tests/missed-call-reconcile.test.ts` has the "no number in any log line" assertion to copy). Per due lead: `forTenant(tenantId).transaction(tx => tx.leads.pseudonymise(leadId, hashes))` where the repository method issues the five guarded UPDATEs (`… AND pseudonymised_at IS NULL` on the three stamped tables; `lead_id = L` on cadences/ledger) and stamps `leads.pseudonymised_at` last. Idempotent at the row; a crash mid-batch re-selects only unstamped rows next night.

**Wiring in the route** [VERIFIED: messaging-reconcile/route.ts:38-70]: after `reconcileMissedCalls`, `const privacy = await runPseudonymisationPass({ now, pepper }).catch(() => PSEUDONYMISE_FAILED)`; add its fields BY NAME to `Response.json` (the "enumerated field by field" rule). `tests/messaging-reconcile-route.test.ts:145` pins `Object.keys(body).toHaveLength(7)` — that pin grows to the new count (a moved pin by design). `maxDuration = 300` (line 9) is ample for 600 guarded UPDATE batches. No new cron job: `cron-schedules.test.ts` is untouched [VERIFIED: tests/cron-schedules.test.ts:36,137-242].

**The gate ruling (D-06's last clause; 15-PATTERNS Mismatch 3):** the gate's two per-caller reads compare the RAW caller: `leads.latestForMobile(caller)` (`eq(contactMobile, caller)`, newest lead regardless of status) and `missedCalls.existsTextBackToCallerSince(caller, since)` [VERIFIED: for-tenant.ts:4817-4826; 4739-4754]; `isRecentNegativeClose` applies `now - closedAt <= LEAD_NEGATIVE_COOL_OFF_DAYS` with `LEAD_NEGATIVE_COOL_OFF_DAYS = 90` [VERIFIED: src/core/leads/gate.ts:49-71; constants.ts:46]. The pseudonymisation boundary is `closed_at <= now - 90 d`. **A lead is hashed only once it is at or past the cool-off, so no gate window (24 h recent_text, 24 h recent_conversion, 90 d cool-off, 14 d job match) can contain a hashed row** except at the single instant `now - closed_at = 90 d` exactly. Making the gate read `inArray(contactMobile, [caller, hash])` (15-PATTERNS' proposal) would buy nothing today and would couple the hot path to the pepper. **Decision: the gate does NOT hash its input and its reads are byte-identical.** What makes "a hashed caller still trips the gate" TRUE and testable: (a) a caller closed `opt_out` is in `suppressed_contacts` with the raw number forever, and the gate's rule 5 (`suppressed`) runs on the raw caller — the read-back test seeds an `opt_out` lead 91 days old, runs the pass, asserts the lead/call/inbound rows are hashed, the suppression row is raw, and `decideTextBack` for a new call from that number refuses `suppressed`; (b) a pure pin `PSEUDONYMISE_AFTER_DAYS >= LEAD_NEGATIVE_COOL_OFF_DAYS` (define the former as the latter) so a future shortening of retention cannot silently open the cool-off; (c) repeat-caller counting (`noteRepeatCall`) only touches OPEN leads, which are never hashed. "Dedupe keeps working" (same input → same hash) is pinned in the pure leaf; no report figure counts distinct callers, so the raw-vs-hash split during a transition changes no number. State all of this in the pass module's header.

### Q7. Migration `0042_phase15_privacy_console.sql` — exact change list (14-RESEARCH §Q7 format)

One journal entry; `when` must exceed 0041's `1791619675151` [VERIFIED: src/db/migrations/meta/_journal.json idx 41]; idx 42, tag `0042_phase15_privacy_console`. Generate with `npm run db:generate`, rename the tag, hand-finish per `src/db/migrations/README.md:11-35` (every widened CHECK as `DROP CONSTRAINT IF EXISTS` then `ADD` — 0040:92,115 and 0041:95-96,119-120 are the idiom; delete any generated statement touching the five hand-written `cadences_*` objects).

**A. Columns that change nullability:** none.

**B. New columns**

| Table | Column | Notes |
|---|---|---|
| `leads` | `pseudonymised_at timestamptz NULL` | D-06 stamp |
| `missed_calls` | `pseudonymised_at timestamptz NULL` | D-06 stamp |
| `inbound_messages` | `pseudonymised_at timestamptz NULL` | D-06 stamp |

**C. CHECKs** (all plain — pre-flight: production `leads_total=0` [VERIFIED: docs/external-registrations.md tail, 11 Oct], zero `missed_calls` with a lead, zero `inbound_messages` with `lead_id`; every change is widening-only)

```sql
-- leads: DROP IF EXISTS + ADD (generated in 0039 from the schema file; rewritten in the 0040 idiom)
leads_contact_mobile_e164        contact_mobile ~ '^[+]614[0-9]{8}$' OR (pseudonymised_at IS NOT NULL AND contact_mobile ~ '^[0-9a-f]{64}$')
leads_sm8_job_error_kind_known   sm8_job_error_kind IS NULL OR sm8_job_error_kind IN ('auth_failed','rate_limited','server_error','network_error','parse_error','bad_request','connection_paused','not_connected','readback_mismatch','stale_claim','job_linked_elsewhere')
-- missed_calls: DROP IF EXISTS + ADD (0039 wrote it; 0040 rewrote it the same way at lines 92/115)
missed_calls_text_back_skip_reason_known   text_back_skip_reason IS NULL OR text_back_skip_reason IN ('not_armed','own_number','withheld','not_mobile','suppressed','recent_negative_close','recent_conversion','recent_text','daily_cap','stale','sms_not_armed','no_template','lead_open','quote_open')
```
Unchanged: `missed_calls_withheld_has_no_number`, `missed_calls_skip_reason_iff_skipped`, every other `leads_*`, every `inbound_messages_*` CHECK. [VERIFIED: the three current literals at leads.ts:149,185-188; missed-calls.ts:204-207]

**D. Indexes:** none required at this table size. Optional (defer): `leads (closed_at) WHERE pseudonymised_at IS NULL AND status IN ('closed','expired')` for the due-read — do not add in 0042.

**E. New tables:** none. **GRANT blocks:** none. **F. Data statements:** none — every new column is nullable, so Phase 14 code meeting the 0042 schema stays legal.

**G. Repository/types that change:** `TEXT_BACK_SKIP_REASONS` (+`'recent_conversion'` after `'recent_negative_close'` [VERIFIED: missed-calls.ts:58-73]); `LEAD_JOB_ERROR_KINDS` (+`'job_linked_elsewhere'` — the name 14-REVIEW WR-02 suggested [VERIFIED: 14-REVIEW.md:153]; 15-PATTERNS proposed `job_taken` — pick ONE; this document picks the review's); `TextBackGateReason` widens automatically (`Exclude<TextBackSkipReason, 'lead_open'|'quote_open'>` [VERIFIED: gate.ts:8]); `CREATE_JOB_SENTENCES['failed:job_linked_elsewhere']` [VERIFIED: inbox/action-state.ts:42-69; tests/create-job-action.test.ts:104-113 pins a sentence per kind]; new `forTenant` methods `leads.queueCards`, `leads.pseudonymise`, `missedCalls.listForLog`, `missedCalls.countInWindow`, `metrics.missedCallCounts`; new family exports `listOpenLeadsForQueue`, `countOverdueOpenLeads`, `listLeadsDueForPseudonymisation`, `listMissedCallsDueForPseudonymisation`, `listLatestReportFiguresForExport`; `forAllTenants_reportMetrics` select widened (name unchanged). **Pins to move by design:** `tests/text-back-gate.test.ts:89-101 ORDER` and `:127-130` (the three-place vocabulary pin), `tests/rls-coverage.test.ts` (new `it` for 0042: the three columns exist; `leads_contact_mobile_e164` contains `pseudonymised_at`; the two widened CHECKs contain their new member — the 0041 block at 800-838 is the mould), `tests/lint-ban.test.ts` allowlist (+ every new barrel export, sorted), `tests/messaging-reconcile-route.test.ts:145` (key count), `tests/lead-digest-section.test.ts:19-37` (mock list + `countOverdueOpenLeads`), `tests/privacy-page.test.ts:107-112` (flip), `tests/create-job-action.test.ts` (kind set).

**Push protocol** (14-05 precedent, verbatim in effect [VERIFIED: docs/external-registrations.md tail]): founder sets `CALLER_PSEUDONYM_PEPPER` locally and on Vercel (`npm run env:push …`) FIRST → read-only pre-flight (`npm run lead-jobs:invariants` → `leads_total=0`; `npm run cron:status` → lease rows 0, no watchdog) → `npm run db:generate` reports no drift → **`npm run db:migrate`** (the classifier refuses it; the founder runs it by hand and reports `Journal entries recorded: 43, exit 0`; a second run is a no-op at 43) → read-back of the three columns and the three CHECKs → only then `git push origin main` (schema before code) → CI → Vercel Ready → probes: `POST /api/internal/messaging-reconcile` with a wrong bearer → 401; after the next 03:30 tick, `cron:status` shows 200 and the body carries the new count fields at zero → evidence entry in `docs/external-registrations.md`. Over the session connection (5432), never the pooler [VERIFIED: src/db/migrations/README.md:1-9].

### Q8. `recent_conversion` (D-08b) — insertion point, the DB fact, the pins

**The DB fact needs no new read:** `latestForMobile` returns `{status, closedReason, closedAt}` of the caller's NEWEST lead at this tenant [VERIFIED: for-tenant.ts:4817-4826; `LeadCloseFacts` 277-281 — its doc comment "NULL while open or converted" is STALE: `close()` writes `closed_reason`/`closed_at` for `converted` too (4827-4850) and `leads_closed_iff_reason` requires it (leads.ts:160-163); fix the comment]. So `isRecentConversion(newestLead, now)` = `newestLead?.status === 'converted' && closedAt !== null && now - closedAt <= LEAD_RECENT_CONVERSION_HOURS * 3_600_000` (exactly-at is INSIDE, matching `isRecentNegativeClose`'s `<=` [VERIFIED: gate.ts:70]).

**Insertion:** `text-back.ts` computes `const recentConversion = isRecentConversion(newestLead, now)` beside line 311 and passes it in the facts (331-350) [VERIFIED]; `TextBackFacts` gains `recentConversion: boolean`; `decideTextBack` gains rule 7 `if (facts.recentConversion) return refuse('recent_conversion')` BETWEEN rule 6 (`recent_negative_close`, gate.ts:100) and `recent_text` (103) — "inserted beside `recent_text`" and the per-caller must-not-text facts stay contiguous. The stored vocabulary takes the same position, so `tests/text-back-gate.test.ts:127-130` ("the gate vocabulary is the stored skip vocabulary, in the same order, minus the two send-path reasons") holds once `ORDER` (89-101) and `FAILING` (66-82) gain `recent_conversion: { recentConversion: true }` at position 7; the pairwise/adjacency generator (134-) covers the two new adjacent pairs automatically. `constants.ts` gains `LEAD_RECENT_CONVERSION_HOURS = 24` (beside `LEAD_MIN_GAP_HOURS`, 37) and `docs/commercial-assumptions.md` a line. The lead-open path needs no change: the gate runs before `openOrCreate` [VERIFIED: text-back.ts:331-378]. **DB pin** (in `tests/lead-close.test.ts` or a new `tests/text-back-recent-conversion.test.ts`, fiction block `+6149157031x`): seed a `converted` lead closed 1 h ago → `sendTextBack` on a new call from the same mobile → `missed_calls` row `skipped`/`recent_conversion`, lead count unchanged; the same at 25 h → a NEW lead opens (the arbiter admits it, 0041 header).

### Q9. Digest overdue line (D-09)

**Seam** [VERIFIED: src/core/aging/stalled-digest.ts:88-171 `buildLeadsSection(cold, held, directory, now, resolutions)`; 246-268 the one `try` that reads `countColdLeadRepliesSince`, `listHeldEscalationsSince`, `countLeadResolutionsSince` and fills the directory from `forAllTenants_cadenceTick` for unknown tenants]. Add a sixth parameter `overdue: readonly { tenantId; count }[] = []`, a `Tally.overdue`, and the line FIRST per client (it is the line with a clock). **Predicate** = the queue's overdue: `deriveUrgency(scheduledAt, now) === 'overdue'` ⇔ `scheduled_at <= now` [VERIFIED: src/core/aging/stall-policy.ts:165-170] for a touch whose status is in `STALLABLE_TOUCH_STATUSES = ['needs_draft','pending_approval']` [VERIFIED: 69] on a live lead cadence of an OPEN lead — `countOverdueOpenLeads(now)` in `repository/leads.ts` (the `countLeadResolutionsSince` shape: `count(*) FILTER`, `groupBy(tenantId)`, zero rows filtered). An `approved` touch past its slot is sent by the next tick and is NOT overdue. **Wording** (UI-SPEC binding; byte-pin in `tests/lead-digest-section.test.ts`): `{Client name}: {n} open lead{s} past {its/their} next follow-up deadline — open the lead queue: {consoleBaseUrl()}/leads`. No line at zero; the section stays `null` when every tally is zero; the empty-digest-not-sent rule is unchanged [VERIFIED: 297-305].

### Q10. Test plan — see Validation Architecture.

### Anti-Patterns to Avoid
- **A seventeenth `forAllTenants_*` export, or a family-file read that returns a mobile:** split the read as the inbox does (ids cross-tenant, personal facts per tenant).
- **`select()` star into a page:** name every column; the log and the lead cards read `caller_e164`/`contact_mobile` by name under the operator gate only.
- **Hashing in the gate's hot path:** see §Q6 — the boundary makes it unnecessary; keep the gate reads byte-identical.
- **A REQUIRED env var deployed before it exists on Vercel:** every route 500s. Env first.
- **`.replace('_',' ')` labels:** maps only, pinned against the schema vocabulary.
- **A chart library for the hour/weekday split:** two tables (UI-SPEC); the sheet prints the weekday table only.
- **`0` where the truth is `null`:** "no samples" (D-10) — `medianSeconds: null`, CSV cell `''`.
- **A fourth `pseudonymised_at` on cadences/ledger:** they ride the lead's stamp; D-07 says ×3.
- **Logging a number or a hash:** the pass logs counts only; the structural test greps the module for `console.` lines carrying a template literal with `${`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV serialisation | a string-join writer | `Papa.unparse(rows, { columns, newline: '\r\n' })` (papaparse already installed) | quoting of `,` `"` newlines is already correct and tested upstream; pin only the header line |
| Month bounds in a tenant zone | `new Date(y, m, 1)` | `calendarMonth` / `currentMonth` (period.ts) | DST and zone handled; the report already uses them |
| Hour/weekday in a tenant zone | `Date#getHours()` | SQL `AT TIME ZONE tenants.timezone` (or `TZDate` in JS) | UTC hours would misplace every evening call |
| Keyed hash | SHA-256 of `pepper + number` | `createHmac('sha256', pepper)` | HMAC is the keyed construction; the salt-concatenation idiom is for the IP throttle, not for a reversible-by-brute-force 8-digit space |
| Median / P90 | ad-hoc percentile | copy `escalationSpeed`'s median; P90 = `sorted[min(n-1, ceil(0.9n)-1)]`, pinned at n=1,2,9,10,11 | one definition, one test |
| Operator gating | `getClaims()` checks | `requireOperator()` / `requireOperatorId()` from `_auth.ts` | the allowlist read is the authorisation; the source-scan tests enforce it |
| Two-step destructive confirm | `confirm()` | the queue's `SkipControl` shape | established, phone-tested |

**Key insight:** every "new" problem in this phase has a shipped twin two directories away; the risk is drift between twins, which the source-pin tests exist to catch.

## Runtime State Inventory

> Included because the phase changes stored data (a pseudonymisation pass) and the schema; not a rename.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Production `leads` = 0, `missed_calls` with a lead = 0, `inbound_messages` with `lead_id` = 0 [VERIFIED: docs/external-registrations.md 11 Oct read-back `leads_total=0`]; `missed_calls` rows from the founder's own verification calls exist (Phase 11) and will become "lead-less missed calls ≥ 90 d" in early January 2027 — the pass will hash their `caller_e164` (the founder's own mobile) and raw strings. `monthly_reports` rows exist for the test tenant (Phase 7) — they will parse unchanged and gain a version on regenerate | code edit (the pass) — no data migration; note the January behaviour in the runbook |
| Live service config | pg_cron `messaging-reconcile` (03:30 AWST) and `stalled-digest` (06:30) jobs — unchanged; no `cron:apply` | none |
| OS-registered state | none — verified: no launchd/systemd/Task Scheduler in this project | none |
| Secrets/env vars | NEW `CALLER_PSEUDONYM_PEPPER` (REQUIRED): local file (founder), Vercel Production + Preview (`npm run env:push`), CI dummy in `ci.yml`, `tests/helpers/env.ts`, `docs/env-vars.md`. Existing bearers unchanged | founder step BEFORE deploy |
| Build artifacts | `src/db/migrations/meta/0042_snapshot.json` + journal entry (generated); `next build` output — nothing stale | regenerate via `db:generate` |

## Common Pitfalls

### Pitfall 1: the pepper deploys after the code
**What goes wrong:** `serverEnvSchema` is parsed once per process; a missing REQUIRED key throws from `getServerEnv()` — every route, webhook and tick fails. **Why:** `getServerEnv` is global [VERIFIED: env.ts:234-290]. **Avoid:** env on Vercel first (push protocol step 0); the plan's deploy checkpoint lists it. **Warning sign:** `vercel logs` showing "Invalid server environment".

### Pitfall 2: the hash meets `leads_contact_mobile_e164`
**What goes wrong:** the pass's UPDATE fails 23514 on every lead. **Avoid:** 0042 widens the CHECK (gated on `pseudonymised_at IS NOT NULL`); the read-back test is the proof. **Warning sign:** `failed` count > 0 in the reconcile body.

### Pitfall 3: `privacy-page.test.ts:110` reads as a regression
**What goes wrong:** an executor "fixes" the copy to keep the old assertion. **Avoid:** the plan names the flip explicitly (D-22 → COMP-02).

### Pitfall 4: the reconcile route's key-count pin
**What goes wrong:** `expect(Object.keys(body)).toHaveLength(7)` fails. **Avoid:** move the pin with the new fields enumerated by name [VERIFIED: tests/messaging-reconcile-route.test.ts:136-150].

### Pitfall 5: the inbox's create-job success leaves `/leads` stale
**What goes wrong:** the "Create ServiceM8 job" button persists on a converted lead. **Avoid:** `revalidatePath('/leads')` in `create-job-actions.ts`; source-pin it (15-PATTERNS Mismatch 5).

### Pitfall 6: `reportDocumentsUnchanged` and the version jump
**What goes wrong:** the operator regenerates every month and sees "version 2" everywhere. **Why:** intended (D-03) — `figures` changed. **Avoid:** the hint on `/reports/[client]` already says "a new version only if the figures or lines changed" [VERIFIED: 396-399]; the plan adds no suppression.

### Pitfall 7: delivered-time clock skew
**What goes wrong:** `delivered_at` (ClickSend's clock) earlier than `started_at` (ours) gives a negative duration. **Avoid:** clamp to 0 in SQL (`greatest(0, …)`), pin it.

### Pitfall 8: the lint-ban allowlist is exhaustive
**What goes wrong:** `npm test` fails on the barrel shape for every new export [VERIFIED: tests/lint-ban.test.ts:360-640 `toEqual([...])`]. **Avoid:** every new barrel export gets its sorted line with a dated record.

### Pitfall 9: the client-reachable leaf imports a value from `@/db/schema`
**What goes wrong:** `next build` fails with `fs`/`net` module-not-found [VERIFIED: tests/lint-ban.test.ts:755-795 header]. **Avoid:** label maps are string-literal keyed in a leaf; the pure test, not the leaf, imports the vocabulary.

### Pitfall 10: fiction numbers collide across DB suites
**What goes wrong:** `leads_one_open_per_mobile` or `missed_calls_provider_call_uniq` trips between concurrently-seeded suites. **Avoid:** Phase 15 DB suites use `+6149157031x`–`+6149157039x` (the `3xx` sub-block; only `0491 570 300` is used, in a pure test) [VERIFIED: grep over tests/*.ts this session].

## Code Examples

### 1. The ids-only cross-tenant lead-queue read (lead family, `src/db/repository/leads.ts`)
```ts
// Source: forAllTenants_approvalQueue shape (for-all-tenants.ts:899-990) + countLeadResolutionsSince (leads.ts:41-57)
export const LEAD_QUEUE_CAP = 50;
export async function listOpenLeadsForQueue(cap = LEAD_QUEUE_CAP): Promise<LeadQueuePage> {
  const db = getDb();
  const nextTouch = db
    .select({ leadId: cadences.leadId, touchId: cadenceTouches.id, touchNumber: cadenceTouches.touchNumber,
              scheduledAt: cadenceTouches.scheduledAt, touchStatus: cadenceTouches.status,
              rank: sql<number>`row_number() over (partition by ${cadences.leadId} order by ${cadenceTouches.scheduledAt} asc)`.as('rank') })
    .from(cadences)
    .innerJoin(cadenceTouches, eq(cadenceTouches.cadenceId, cadences.id))
    .where(and(eq(cadences.kind, 'lead'), inArray(cadences.status, ['active', 'paused']),
               inArray(cadenceTouches.status, ['scheduled', 'needs_draft', 'pending_approval', 'approved'])))
    .as('next_touch');
  const [rows, counted] = await Promise.all([
    db.select({ tenantId: leads.tenantId, leadId: leads.id, firstMissedAt: leads.firstMissedAt,
                lastMissedAt: leads.lastMissedAt, missedCallCount: leads.missedCallCount, afterHours: leads.afterHours,
                touchId: nextTouch.touchId, touchNumber: nextTouch.touchNumber, scheduledAt: nextTouch.scheduledAt, touchStatus: nextTouch.touchStatus })
      .from(leads)
      .leftJoin(nextTouch, and(eq(nextTouch.leadId, leads.id), eq(nextTouch.rank, 1)))
      .where(eq(leads.status, 'open'))
      .orderBy(sql`${nextTouch.scheduledAt} asc nulls last`, asc(leads.firstMissedAt), asc(leads.id))
      .limit(cap),
    db.select({ total: sql<number>`count(*)::int` }).from(leads).where(eq(leads.status, 'open')),
  ]);
  return { rows, total: counted[0]?.total ?? 0 };
}
// NO contact_mobile, NO body: the card's personal facts come from forTenant(tenantId).leads.queueCards(ids).
```

### 2. The HMAC leaf
```ts
// Source: ip-hash.ts:14-20 discipline (secret passed in); node:crypto
import { createHmac } from 'node:crypto';
const PEPPER_MIN = 32;
export function pseudonymiseCaller(value: string, pepper: string): string {
  if (pepper.length < PEPPER_MIN) throw new Error('pseudonym: pepper too short');
  return createHmac('sha256', pepper).update(value, 'utf8').digest('hex'); // 64 lower-hex; same input → same hash
}
export const PSEUDONYM_PATTERN = /^[0-9a-f]{64}$/;
export const isPseudonym = (v: string): boolean => PSEUDONYM_PATTERN.test(v);
```

### 3. Rule 7 in the gate
```ts
// Source: gate.ts:62-71 (isRecentNegativeClose) and :97-104 (rules 5–7)
const CONVERSION_WINDOW_MS = LEAD_RECENT_CONVERSION_HOURS * 3_600_000;
export function isRecentConversion(newest: { status: string; closedAt: Date | null } | undefined, now: Date): boolean {
  if (newest === undefined || newest.status !== 'converted' || newest.closedAt === null) return false;
  return now.getTime() - newest.closedAt.getTime() <= CONVERSION_WINDOW_MS; // exactly-at is INSIDE, like the cool-off
}
// decideTextBack: … if (facts.recentNegativeClose) return refuse('recent_negative_close');
//                   if (facts.recentConversion)   return refuse('recent_conversion');   // 7 — D-08b
//                   if (facts.textedSince24h)     return refuse('recent_text'); …
```

### 4. The optional block renders only when present
```tsx
// Source: reports/[client]/[reportId]/page.tsx:189-229 (the six-figure dl) — add after it
{report.figures.missedCalls === undefined ? null : (
  <MissedCallsSheetBlock block={report.figures.missedCalls} timezone={report.timezone} />
)}
```

### 5. The export island (UI-SPEC mechanism)
```tsx
// Source: 15-UI-SPEC §3a Mechanism; useActionState as in queue-card.tsx:136-139
'use client';
const [state, formAction, pending] = useActionState(exportDesignPartnerCsv, BLANK_EXPORT_STATE);
useEffect(() => {
  if (!state.csv) return;
  const url = URL.createObjectURL(new Blob([state.csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: state.filename });
  a.click(); URL.revokeObjectURL(url);
}, [state.csv, state.filename]);
```

### 6. The Papa.unparse call
```ts
// Source: papaparse 5.7.0 (package.json:48); @types/papaparse index.d.ts:76
import Papa from 'papaparse';
export const PARTNER_CSV_HEADER = ['client','month','missed_calls', /* … */ 'booked_by_tradie'] as const;
export function partnerCsv(rows: readonly PartnerCsvRow[]): string {
  return Papa.unparse({ fields: [...PARTNER_CSV_HEADER], data: rows.map(toCells) }, { newline: '\r\n' });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Callers retained "for the term of the agreement" (Phase 12 D-22 copy) | 90-day pseudonymisation stated and enforced | this phase | the privacy test's retention assertion flips |
| Borrowed `parse_error` for the unique-violation recovery (14-REVIEW WR-02) | dedicated `job_linked_elsewhere` | this phase (0042) | sheet sentence is true, not approximate |
| Repeat call after conversion re-texts (14-RESEARCH OQ4 accepted) | `recent_conversion` gate skip | this phase | no second lead/text within 24 h of a booking |
| Cold lead replies only visible in the inbox (13-REVIEW CR-01 bridge "until Phase 15's lead queue exists") | `/leads` shows every open lead; the inbox lead arm STAYS (D-01: inbox unchanged except links) | this phase | two surfaces, one truth; do not remove the inbox arm |

**Deprecated/outdated:** `LeadCloseFacts` doc comment ("NULL while open or converted") — stale since 0041; fix while touching the gate.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | zod v4 `z.object` strips unknown keys and an `.optional()` key parses as `undefined` when absent (so old `figures` rows parse unchanged) | Q3 | the fixture test fails at `parse()` in wave 1 — cheapest place; fallback `.passthrough()`/`.loose()` is a one-word change |
| A2 | `Papa.unparse` with `fields` + `data` and `newline: '\r\n'` emits RFC 4180 quoting for `,` `"` `\r` `\n` | Q4 | the CSV byte-pin test catches it; fallback is the 20-line writer 15-PATTERNS describes |
| A3 | iOS Safari honours a programmatic `<a download>` click on a Blob URL for a `text/csv` file (the island mechanism) | Q4 | the phone UAT shows the file; fallback is the GET route handler precedent |
| A4 | Dead-letter rows (`tenant_id IS NULL`) carry no caller number in a column (only `raw_payload`) and are out of D-06's scope | Q6 | if the founder wants them scrubbed, add `raw_payload = NULL` for dead letters ≥ 90 d as a fourth predicate — one statement |
| A5 | The privacy wording proposed in §Q5 is acceptable to the founder (copy, not code) | Q5 | reworded at UAT; the tests pin only the load-bearing literals |
| A6 | DB-backed suites run in CI against the CI database (ci.yml writes the env file; 14-REVIEW "DB case (CI)") and are never run locally with `test:remote` | Validation | if CI's database is unavailable, the read-back proof waits for the next green run |
| A7 | `tenants.timezone` is always a valid IANA name (`tenants_validate_timezone_trg`, migration 0004) so SQL `AT TIME ZONE` cannot error | Q3 | a bad zone would fail the figures read for one tenant — surfaced as the page's error arm |

## Open Questions

1. **Does the missed-call log live on the client page or a sub-page?** Known: D-02 says "on the client page"; the UI-SPEC designed a section; 15-PATTERNS prefers a sub-page because the page is RLS-only and carries no numbers. **Recommendation:** section on the client page with the read behind `requireOperator()` inside its own `try` (§Q2). **(RESOLVED — planner default: section.)**
2. **Server action + island, or route handler, for the CSV?** Known: D-04 says server action; the UI-SPEC decided the island; the only download precedent is a GET route. **Recommendation:** action + island; route as the documented fallback if the phone UAT fails (§Q4). **(RESOLVED.)**
3. **Does the gate read the hash?** Known: pseudonymisation boundary = cool-off = 90 d; no gate window can contain a hashed row; suppression keeps the raw number. **Recommendation:** no dual read; prove through suppression + the boundary pin (§Q6). **(RESOLVED.)**
4. **Masked or full numbers?** Known: the inbox shows the full address; no mask exists except the quote page's. **Recommendation:** full, operator-only, never logged (UI-SPEC rule); do not claim masking. **(RESOLVED.)**
5. **Are `cadences.contact_mobile` and `send_ledger.to_address` hashed?** Known: D-06 names three tables; both columns carry the caller's number on lead rows and are never read after close. **Recommendation:** hash both in the per-lead transaction, riding the lead's stamp; `pseudonymised_at` stays ×3 (§Q6). **(RESOLVED — planner default: hash them; name it in the privacy wording as "on the call, on the lead and on your messages" which already covers it in substance.)**
6. **The dedicated error kind's name?** Known: 14-REVIEW suggested `job_linked_elsewhere`; 15-PATTERNS proposed `job_taken`. **Recommendation:** `job_linked_elsewhere` (traceable to the review). **(RESOLVED.)**
7. **Withheld / other-number lead-less rows — stamped or skipped?** **Recommendation:** stamped (hash raw strings and `caller_e164` where present) so the due predicate converges. **(RESOLVED.)**
8. **Where does the cross-tenant lead-queue read live and what does it return?** **Recommendation:** `listOpenLeadsForQueue` in `repository/leads.ts`, ids/instants only; per-tenant `leads.queueCards` for the mobile and the reply (§Q1). The UI-SPEC's placeholder name `forAllTenants_leadQueue()` is NOT used. **(RESOLVED.)**
9. **Hour table on the printed sheet?** **Recommendation:** weekday only in print (UI-SPEC decision); both tables on the live page. **(RESOLVED.)**
10. **Is the pepper REQUIRED or optional-with-skip?** Known: a retention promise that silently does not run is worse than a loud deploy failure; `AUDIT_IP_HASH_SALT` is REQUIRED. **Recommendation:** REQUIRED, env-first ordering in the push protocol. **(RESOLVED.)**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v22.20.0 | — |
| npm | scripts | ✓ | 10.9.3 | — |
| vitest | tests | ✓ | 4.1.11 | — |
| drizzle-kit | `db:generate` | ✓ | 0.31.10 (node_modules/.bin) | — |
| Supabase CLI | local stack | via npx (devDependency 2.115.0); no Docker on this machine | — | DB-backed suites run in CI; the hosted project is production and read-only for research |
| Docker | local Postgres | ✗ | — | CI (A6) |
| Hosted Supabase (Sydney) | migration 0042, probes | ✓ (founder runs `db:migrate`) | Postgres 15+ | — |

**Missing dependencies with no fallback:** none. **Missing dependencies with fallback:** Docker → CI for DB-backed proofs.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.11 (`environment: 'node'`, `setupFiles: tests/helpers/env.ts`, `globalSetup: tests/helpers/global-setup.ts`) [VERIFIED: vitest.config.mts] |
| Config file | `vitest.config.mts` |
| Quick run command | `npx vitest run tests/<file>.test.ts` |
| Full suite command | `npm test` (pure suites locally; DB-backed suites in CI — never `npm run test:remote`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CON-05 | `/leads` page source: gate before read, discarded catch, `force-dynamic`, `revalidatePath('/leads')` in create-job action, `id="touch-…"` on the queue card, nav link third | source-pin (pure) | `npx vitest run tests/leads-page.test.ts` | ❌ Wave 0 |
| CON-05 | `listOpenLeadsForQueue` returns ids only (no `contact_mobile`/`body` in its select; sorted before cap; true total); `queueCards` tenant-scoped | DB (CI) + source-pin | `npx vitest run tests/lead-queue.test.ts` | ❌ |
| CON-05 | close action: authorize ordering (mocks' call counts), `already_closed`/`closed`/throw → the three fixed sentences | pure (mocks) | `npx vitest run tests/lead-close-action.test.ts` | ❌ |
| CON-05 | label maps cover every schema member | pure | `npx vitest run tests/text-back-outcome-labels.test.ts` | ❌ |
| CON-06 | `listForLog` keyset paging (20, newest first, cursor strictly older), delivery verdict join, dead letters excluded, pseudonymised row flagged | DB (CI) | `npx vitest run tests/missed-call-log.test.ts` | ❌ |
| CON-06 | client page section source: gated read inside its own try; state line from checklist facts; cursor zod schema rejects garbage | source-pin + pure | `tests/leads-page.test.ts` | ❌ |
| RPT-04 | `computeMissedCallFigures`: rates with denominators, `null` at zero, median/P90 boundaries (n = 0,1,2,9,10,11), hour/weekday arrays lengths | pure | `npx vitest run tests/missed-call-figures.test.ts` | ❌ |
| RPT-04 | `missedCallCounts(period)` SQL: tenant isolation, period bounds, delivered join, reply lead-level, won via mirror, after-hours in tenant zone (a 23:30 AWST call lands on the right weekday) | DB (CI) | `npx vitest run tests/report-missed-calls.test.ts` | ❌ |
| RPT-04 / D-11 | stored pre-Phase-15 fixture parses with `missedCalls === undefined`; canonical `figures` unchanged; notes unchanged; sheet page source guards the block | pure | `npx vitest run tests/report-frozen-fixture.test.ts` | ❌ |
| RPT-04 | generate → block present; regenerate → `unchanged`; pre-existing row → regenerate → version N+1 with N kept | DB (CI) | `tests/monthly-report.test.ts` (extend) | ✅ extend |
| RPT-04 | overview column counts + `hasDivertNumber`; `TenantMetricCounts` widened | DB + pure | `tests/report-metrics.test.ts`, `tests/reporting-metrics.test.ts` (extend) | ✅ extend |
| RPT-05 | header byte-pin; structural grep (no caller/mobile/body/contact in generator + read); empty cells not zeros; `Papa.unparse` quoting of a client name with a comma; action authorize-before-read (mock counts) | pure | `npx vitest run tests/partner-csv.test.ts` | ❌ |
| COMP-01 | privacy pins (flip at 107-112; keep all others); `TEXT_BACK_PRIVACY_POINTER === APEX_DOMAIN + '/privacy'`; `privacyCoversCallers` true | pure | `tests/privacy-page.test.ts` (edit) | ✅ edit |
| COMP-02 | HMAC leaf: deterministic, 64-hex, pepper floor, `isPseudonym` | pure | `npx vitest run tests/pseudonym.test.ts` | ❌ |
| COMP-02 | read-back: seed (a) closed `not_a_lead` 91 d, (b) closed 89 d, (c) converted with job `Completed` 91 d, (d) converted with job open, (e) lead-less withheld call 91 d, (f) `opt_out` lead 91 d + suppression → run pass → (a),(c),(e),(f) hashed on lead/missed_calls/inbound/cadence/ledger and stamped; (b),(d) untouched; suppression raw; second run → zero counts; `decideTextBack` for (f)'s number → `suppressed`; fiction block `+6149157031x` | DB (CI) | `npx vitest run tests/pseudonymise.test.ts` | ❌ |
| COMP-02 | pass structure: module imports no SDK, no `suppressed_contacts` token, log lines carry no `${`; route body fields by name; key-count pin moved | source-pin + route mock | `tests/text-back-structure.test.ts` (extend), `tests/messaging-reconcile-route.test.ts` (edit) | ✅ edit |
| COMP-02 / D-07 | 0042 applied: three columns; `leads_contact_mobile_e164` admits a 64-hex only with the stamp; the two widened CHECKs | DB (CI) | `tests/rls-coverage.test.ts` (extend) | ✅ extend |
| D-08b | gate ORDER/FAILING/vocabulary pin with `recent_conversion` at 7; `isRecentConversion` boundaries (24 h inside, 24 h + 1 ms outside, non-converted false); DB: second call at 1 h skipped `recent_conversion`, at 25 h a new lead | pure + DB | `tests/text-back-gate.test.ts` (edit), `tests/text-back-recent-conversion.test.ts` | ✅/❌ |
| D-08a | `CREATE_JOB_SENTENCES` has `failed:job_linked_elsewhere`; create-job records the new kind on 23505 (`lead-job-create-db` UNIQUE case asserts the kind) | pure + DB | `tests/create-job-action.test.ts`, `tests/lead-job-create-db.test.ts` (edit) | ✅ edit |
| D-09 | digest line byte-pinned; first per client; null at zero; `countOverdueOpenLeads` mocked in the list; DB: overdue predicate (pending_approval past slot counts; approved past slot does not) | pure + DB | `tests/lead-digest-section.test.ts` (edit), `tests/lead-queue.test.ts` | ✅ edit |
| cross-cutting | sixteen-export pin unchanged; lint-ban allowlist + CLIENT_REACHABLE; console-error-leak NAMED_PAGES; operator-authorization GUARDED_PATHS; quote suites (`transitions`, `eligibility`, `qualify`, `decide`) byte-identical | pure | `npm test` | ✅ edit |

### Sampling Rate
- **Per task commit:** the suite(s) the task touched, e.g. `npx vitest run tests/missed-call-figures.test.ts tests/text-back-gate.test.ts`, plus `npm run typecheck` and `npm run lint`.
- **Per wave merge:** `npm test` (pure, local) + `npx next build`; DB-backed suites observed in CI.
- **Phase gate:** CI green on `main` after the founder's `db:migrate`; probes and zero-row UAT before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/fixtures/monthly-report-v1.json` — a stored pre-Phase-15 `StoredReportRow` literal (D-11)
- [ ] `tests/missed-call-figures.test.ts`, `tests/partner-csv.test.ts`, `tests/pseudonym.test.ts`, `tests/text-back-outcome-labels.test.ts` — pure leaves
- [ ] `tests/leads-page.test.ts` — source pins for the three new/changed pages
- [ ] `tests/lead-queue.test.ts`, `tests/missed-call-log.test.ts`, `tests/report-missed-calls.test.ts`, `tests/pseudonymise.test.ts`, `tests/text-back-recent-conversion.test.ts` — DB (CI), fiction block `+6149157031x`–`39x`
- [ ] Env: `CALLER_PSEUDONYM_PEPPER` dummy in `ci.yml`, `REQUIRED` in `tests/helpers/env.ts`, entry in `docs/env-vars.md` — before any suite reaches `getServerEnv()`
- [ ] Framework install: none — vitest present

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth session via `createClient()`; unchanged |
| V3 Session Management | yes | `proxy.ts` gating + `requireOperator()`; `force-dynamic` on session pages (T-6-02) |
| V4 Access Control | yes | `requireOperator()` BEFORE any `getDb()` read on `/leads`, the log section, the export action; tenant bound server-side on every action; `GUARDED_PATHS` source pin |
| V5 Input Validation | yes | zod on every action input (`lead_id` uuid, cursor), the env pepper, the parsed `figures` jsonb (`reportFiguresSchema`) |
| V6 Cryptography | yes | `createHmac('sha256', pepper)` from `node:crypto` — never hand-rolled; pepper ≥ 32 chars, server-only, never logged |
| V7 Error Handling & Logging | yes | caught values discarded; fixed-string logs; counts only; no number, hash or body in any log line (structural test) |
| V8 Data Protection | yes | caller numbers rendered only behind the operator gate; never in the CSV, the sheet, the digest; pseudonymised at 90 d; suppressions kept |
| V14 Configuration | yes | REQUIRED env parsed once; CI dummies distinct per variable |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server action POSTed with another tenant's lead id | Elevation | `authorize(tenantId)` + core re-reads under `forTenant(tenantId)` where a foreign id matches nothing (the queue action rule) |
| CSV leaks a number or a body via a widened select | Information disclosure | the structural grep test over the generator and the read; `reportFiguresSchema` parse (no raw jsonb reaches the writer) |
| Hash reversal by brute force over the 10^8 AU-mobile space | Information disclosure | HMAC with a 32+ char server pepper (not a public salt); the pepper never leaves the server env |
| Pseudonymisation pass runs under an unauthenticated POST | Spoofing | the route's constant-time bearer check is unchanged; the pass is behind it |
| Raw postgres error reaches the operator's screen | Information disclosure | `console-error-leak` scan over every `(console)` file; fixed "Could not load…" sentences |
| CSV formula injection (`=`, `+`, `-`, `@` leading cells) | Tampering | the only text cell is `tenants.name` (operator-created); prefix with `'` if it starts with one of the four characters — one line, pin it |

## Sources

### Primary (HIGH confidence — files read this session with line ranges cited inline)
- `src/app/(console)/{queue/page.tsx, queue/queue-card.tsx, queue/actions.ts, queue/action-state.ts, layout.tsx, _auth.ts, inbox/page.tsx, inbox/create-job-form.tsx, inbox/create-job-actions.ts, inbox/action-state.ts, clients/[id]/page.tsx, clients/[id]/text-back/page.tsx, clients/[id]/checklist-card.tsx, clients/[id]/quotes/[quoteId]/page.tsx (mask), reports/page.tsx, reports/[client]/page.tsx, reports/[client]/actions.ts, reports/[client]/[reportId]/page.tsx, audits/requests/[id]/csv/route.ts, components/label-guess.ts}`
- `src/core/{reporting/{document,unchanged,figures,generate,period,metrics,format,copy}.ts, leads/{gate,constants,close,text-back,create-job,template,mobile-spellings}.ts, aging/{stalled-digest,stall-policy}.ts, alerts/stalled-drafts.ts, messaging/{reconcile,receipts}.ts, telephony/{reconcile,missed-call}.ts, intake/ip-hash.ts, onboarding/{privacy-coverage,checklist}.ts, shared/{env,tenant}.ts}`
- `src/db/schema/{leads,missed-calls,inbound-messages,suppressed-contacts,send-ledger,monthly-reports,cadences,cadence-touches,escalations,quotes,tenants}.ts`; `src/db/repository/{leads,missed-calls,for-tenant (interfaces 2258-2760, impls 4652-5060, 3562-3595),for-all-tenants (617-668, 1468-1560),index}.ts`; `src/db/migrations/{0040,0041}_*.sql`, `meta/_journal.json`, `README.md`
- `src/app/(marketing)/{copy.ts (PRIVACY_COPY), privacy/page.tsx}`; `src/app/api/internal/{messaging-reconcile,stalled-digest}/route.ts`
- `tests/{lint-ban, sync-upsert (498-530), privacy-page, text-back-gate, text-back-template, console-error-leak, operator-authorization, reports-authorization, queue-lead-rows, lead-digest-section, messaging-reconcile-route, cron-schedules, rls-coverage (800-850), report-unchanged, monthly-report, create-job-action, text-back-structure}.test.ts`; `tests/helpers/{env,seed}.ts`; `vitest.config.mts`; `.github/workflows/ci.yml` (150-200); `package.json`; `scripts/{push-vercel-env,lead-jobs-invariants}.mjs`; `docs/{env-vars,external-registrations}.md`
- `.planning/phases/15-…/{15-CONTEXT,15-UI-SPEC,15-PATTERNS}.md`; `14-REVIEW.md` (WR-02, IN-08); `14-RESEARCH.md` (§Q7 format, Pitfall 7, OQ4); `13-REVIEW.md` (CR-01); `12-CONTEXT.md` (D-06); `.planning/research/{FEATURES §8, PITFALLS §7}.md`; `REQUIREMENTS.md`; `ROADMAP.md`; `STATE.md`

### Secondary (MEDIUM confidence)
- `.claude/CLAUDE.md` stack and compliance notes (project-curated; dated Aug 2026)
- The proposed privacy wording (copy drafted here; load-bearing literals cross-checked against the test pins)

### Tertiary (LOW confidence)
- zod v4 strip/optional semantics and `Papa.unparse` option names (training knowledge; both pinned by wave-1 tests — A1, A2)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new package; every library and version read from `package.json`
- Architecture: HIGH — every pattern is a shipped file with a cited line range; the four UI-SPEC/PATTERNS disagreements are resolved with reasons
- Pitfalls: HIGH — each names the pin or CHECK that would fail

**Research date:** 2026-10-11
**Valid until:** 2026-11-10 (stable; re-check only if `main` moves under `src/db/repository` or the privacy tests)
