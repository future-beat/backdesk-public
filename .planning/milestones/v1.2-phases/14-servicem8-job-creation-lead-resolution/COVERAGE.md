# API Coverage — ServiceM8 REST API, write path (Phase 14)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Scope: the only external API this phase gains a capability on is the ServiceM8 REST API (`api.servicem8.com/api_1.0`), which the repository has read since Phase 2 (`src/core/servicem8/client.ts`, private `X-API-Key`) and WRITES for the first time here. Every fact below was measured live against the test account in the research spike (14-RESEARCH.md, Spike ledger, 10 Oct 2026, D-11) or cited from developer.servicem8.com. No package is installed; the client stays a thin typed `fetch` wrapper. Resend (the `done_no_lead` operator email) and the Anthropic API are reached only through calls that already exist and gain no capability; ClickSend, Twilio and Supabase surfaces are unchanged and are not re-opened here. No test or plan step writes to any ServiceM8 account (CI uses `tests/helpers/sm8-stub.ts`).

| capability | decision | reason |
|---|---|---|
| `POST /job.json` — create a Quote job with company, description, address | INTEGRATE | 14-01 `createJob`; 14-02 the tracer — `status: 'Quote'` is the only status ever written (D-02); `job_address` carries the operator-typed suburb when given |
| `POST /company.json` — create a client record (`name`, max 100) | INTEGRATE | 14-01 `createCompany`; tier (iii) of the company match, only after the mirror and the company-contact filter miss (D-02; research Pitfall 2) |
| `POST /companycontact.json` — the client's primary JOB contact with the mobile | INTEGRATE | 14-01 `createCompanyContact`; always beside a new company so the client record carries the caller's mobile and D-07's future matches can find it |
| `POST /jobcontact.json` — one JOB-type contact per created job | INTEGRATE | 14-01 `createJobContact`; ServiceM8 auto-creates no contact for an API-created job (ledger #8) |
| `x-record-uuid` response header on every create | INTEGRATE | 14-01 `post()` reads it; a 200 with no header is `readback_mismatch` and the retry adopts by description (SM8-03) |
| `GET /<resource>/<uuid>.json` — single-object read-back | INTEGRATE | 14-01 `getOne()` + `getJob`/`getJobContact`/`getCompany`; D-03's read-after-write on every create; 404 classified `bad_request` as a clean miss (A4) |
| `$filter` reads on job_uuid, mobile and company_uuid (exact spelling) | INTEGRATE | 14-01 the three list wrappers; 14-03 the company-contact match tier; exact-spelling only (ledger #4/#5), hence three spellings; values are validated uuids or derived spellings (T-14-04) |
| Write-error classification and `errorCode` 0 or '0' on success | INTEGRATE | 14-01 `classifyWrite` + `sm8WriteResult`: 400/404/422 bad_request, 401/403 auth_failed, 429 rate_limited, else server_error; a sibling enum keeps the sync's switches untouched (D-13) |
| Rate-limit budget (180/min, 20k/day per app per account) | INTEGRATE | A create is at most nine requests; the match spends at most ten company-contact reads per tenant per cycle and zero with no open lead (D-12) |
| OAuth write scopes (`create_jobs`, `manage_customers`, …) | OPT-OUT | D-03: the private API key path first; the scopes are recorded as a follow-up under App ID 000000 in `docs/external-registrations.md` (14-01), not requested |
| `POST /<resource>/<uuid>.json` — update a record | OPT-OUT | The sync never edits ServiceM8 (D-12) and the create path never updates; measured in the spike only to set the spike jobs Unsuccessful before deletion |
| `DELETE /<resource>/<uuid>.json` (soft delete, `active: 0`) | OPT-OUT | Nothing Backdesk creates is ever deleted by Backdesk; a wrong job is the tradie's to mark Unsuccessful; measured only for the spike's clean-up |
| Client-supplied `uuid` in a POST body as the idempotency key | OPT-OUT | Unmeasured (A2); the header uuid persisted per step plus adopt-by-description is the measured path; D-11 admits no further live probe (research OQ2) |
| Webhooks (`/webhook_subscriptions`) | OPT-OUT | Need the OAuth public app; polling stays the guarantee (CONTEXT scope); the pre-insert is what makes the 5-minute poll safe for a lead-born job (SM8-02) |
| `note.json` — a Note object for the "Created by Backdesk" line | OPT-OUT | D-01 puts the note as the last line of `job_description`, where the tradie reads it and the adopt-on-retry lookup can match it; a second object is a second thing to reconcile |
| Job money, category, badges and scheduling fields on create | OPT-OUT | `status` is the only required field (measured); the tradie quotes the job in ServiceM8; Backdesk writes words and a contact, never money (D-02, D-06) |
| `jobcontact.is_primary_contact` | OPT-OUT | Deprecated upstream; `type` is the selector (`schemas.ts:105`) |
| `company.json` filtered by mobile, phone or email | OPT-OUT | Impossible: the Company object carries no such field (measured, ledger #2; docs agree) — the match goes through `companycontact.json` and the mirrored job contacts (Pitfall 2) |
| Cursor pagination on the three write-path list reads | OPT-OUT | Each list is bounded (one job's contacts, one mobile's contacts, one company's open quotes); one page is read and a second page is treated as drift rather than walked |
| `sms.json` / `email.json` (ServiceM8 own-comms) | OPT-OUT | Unchanged from Phase 10's drift detection; this phase sends nothing through ServiceM8 |
| Official MCP server (`api.servicem8.com/mcp`) | OPT-OUT | Founder-side ad-hoc queries only; never the production write path |
