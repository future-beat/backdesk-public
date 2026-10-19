# Phase 2 — ServiceM8 API Coverage Matrix

**Generated:** 2026-08-26 (planner, API Coverage Decision Checkpoint)
**Integration mode:** read-only, private API key (X-API-Key) per client/prospect; OAuth deferred to partner-approval confirmation (App ID 000000). ServiceM8 is the system of record — this phase mirrors, never mutates.

| Capability | Decision | Where / Reason |
|------------|----------|----------------|
| `job.json` read (cursor + backfill fetch) | INTEGRATE | Plans 02-01/02-02/02-06 — quote mirror, status transitions, 90-day audit window (SYNC-01/02, AUD-01) |
| `$filter` (eq/ne/gt/lt, and-only) + `cursor` pagination | INTEGRATE | Plans 02-01/02-02 — edit_date-cursor polling; mechanics pinned by the 02-01 spike (A1/A2) |
| `jobcontact.json` read | INTEGRATE | Plan 02-02 (client sync: cadence recipient phone/email lives here, not on Company) + 02-06 (audit contact names) |
| `note.json` read | INTEGRATE | Plan 02-06 — D-10 never-followed-up detection (bulk fetch, joined by related_object_uuid) |
| `jobactivity.json` read | INTEGRATE | Plan 02-06 — D-10 follow-up signal (staff scheduling records count as "the tradie did something") |
| `company.json` read | OPT-OUT | Verified: Company carries NO email/mobile fields; customer identity for display comes from JobContact — fetching companies adds requests inside the rate budget for zero fields the phase needs |
| `webhook_subscriptions` + callbacks | INTEGRATE | Plan 02-03 — challenge + hints-to-poll adapter shipped, activation deferred pending OAuth credentials (SYNC-03); steps in docs/servicem8-api-notes.md; polling remains the guarantee |
| OAuth 2.0 flow (authorize/access_token, refresh) | OPT-OUT | Not needed this phase: private API keys need no partner approval (STATE.md bridge decision); Sm8Client takes an auth strategy so the OAuth swap is a constructor change when approval lands |
| Write operations (any POST/PUT) | OPT-OUT | Read-only by design — ServiceM8 is the system of record; the service must never mutate a client's job data (REQUIREMENTS Out of Scope: no CRM) |
| `attachment.json` read | OPT-OUT | Quote documents are not needed for follow-up cadence or audit figures in v1 |
| `jobpayment.json` read | OPT-OUT | Job payment flags are documented as unused/deferred by ServiceM8; revenue figures come from total_invoice_amount; Phase 7 attribution uses status transitions, not payments |
| other resources (staff, category, queue, geo) | OPT-OUT | Outside phase scope — no scheduling, categorisation, or geo features in the quote-recovery loop |
| MCP server (`api.servicem8.com/mcp`) | OPT-OUT | Founder-side ad-hoc analysis tool only (CLAUDE.md); never part of the production sync or audit path |
| Job List CSV export (Advanced Reporting Pack) | INTEGRATE | Plan 02-07 — out-of-band (operator upload, not an API call): D-12 audit fallback for key-shy prospects; a dashboard export the operator uploads, not an API call |

**Rate-limit posture:** 180/min, 20,000/day per app per connected account. Steady state ≈ 2–4 requests per connection per 5-minute tick (~600–1,200/day); backfill/audit adds ≤ ~8 bulk-filtered requests once per connect/prospect (bulk join, never per-job N+1). No throttling logic beyond honoring 429 backoff (D-06).
