# API Coverage — Phase 15 (lead console, reporting, privacy)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Scope: Phase 15 gains a capability on NO external HTTP API. ServiceM8, Twilio, ClickSend, Resend and the Anthropic API are reached only through calls that already exist and gain nothing here; no package is installed (papaparse 5.7.0 is pre-existing from Phase 9). What the phase DOES gain capabilities on are platform and library surfaces inside the repo's own boundary — Postgres through drizzle (one migration, new reads, guarded writes), Node's `crypto` (a keyed hash), Next.js server actions and a browser download, the existing pg_cron tick, a Vercel environment variable, and `Papa.unparse`. Every row below is one of those. No test or plan step writes to any provider account; the hosted Supabase project is production and is touched only by `db:migrate` under the push protocol in plan 15-08.

| capability | decision | reason |
|---|---|---|
| Postgres ADD COLUMN `pseudonymised_at timestamptz` ×3 (migration 0042) | INTEGRATE | 15-01 — the D-06/D-07 stamps on leads, missed_calls, inbound_messages; nullable, no default, one journal entry |
| Postgres CHECK rewrite as DROP IF EXISTS + ADD (hand-finished) | INTEGRATE | 15-01 — the hash-admitting mobile CHECK gated on the stamp; the recent_conversion and job_linked_elsewhere widenings (0040/0041 idiom) |
| Postgres `AT TIME ZONE` with a bound IANA parameter, extract, FILTER | INTEGRATE | 15-03 — hour/weekday splits and after-hours counts in the tenant's zone; counts only cross the repository boundary (D-03) |
| Postgres `greatest(0, extract(epoch FROM …))` | INTEGRATE | 15-03 — delivered-timing seconds clamped at zero against provider clock skew (research Pitfall 7) |
| Postgres row-comparison keyset over `missed_calls_tenant_started_idx` | INTEGRATE | 15-03/15-05 — the missed-call log pages newest first without OFFSET (D-02) |
| Postgres `row_number() over (partition by …)` for the next pending touch | INTEGRATE | 15-03 — the lead queue's sort key, in SQL before the LIMIT (the queue's sort-before-cap rule) |
| Postgres `DISTINCT ON (tenant_id, period_start)` over monthly_reports | INTEGRATE | 15-03 — the newest frozen version per client-month for the export; five columns, no join |
| drizzle transaction per due lead with stamp-guarded UPDATEs | INTEGRATE | 15-03/15-07 — idempotent at the row; the lead's stamp last; cadences and send_ledger ride it with no fourth stamp |
| Node `crypto.createHmac('sha256', pepper)` | INTEGRATE | 15-02 — the keyed hash; HMAC not a salted digest because the 10^8 AU-mobile space would make a salted hash the number |
| Next.js server action returning a CSV string + a Blob download island | INTEGRATE | 15-06 — D-04's "operator-only server action"; the UI-SPEC's mechanism; no navigation, nothing written |
| Next.js GET route handler for the CSV (the audit-CSV precedent) | OPT-OUT | Research OQ2: the action + island is chosen; the route is the documented fallback built only if the phone UAT (iOS Safari, A3) fails — never both |
| Next.js `searchParams` parsed through zod for the log cursor | INTEGRATE | 15-05 — `calls_before={ISO}_{uuid}`; a malformed cursor renders page one silently |
| `revalidatePath` on four routes after a lead close or a job creation | INTEGRATE | 15-04 — /leads, /queue, /inbox and the client page all show the lead (research Pitfall 5) |
| pg_cron: the existing messaging-reconcile job at 03:30 AWST | INTEGRATE | 15-07 — the pass rides it as one more awaited call; counts by name in the tick's body (D-06) |
| pg_cron: a NEW job for pseudonymisation; `cron:apply` | OPT-OUT | D-06 says the job rides the nightly tick; cron-schedules.test.ts and apply-cron-schedules.mjs are must-not-move pins |
| Vercel `waitUntil` for the pass | OPT-OUT | CLAUDE.md "What NOT to Use": best-effort only; the pass is must-happen work and is awaited |
| Vercel env var CALLER_PSEUDONYM_PEPPER via push-vercel-env.mjs | INTEGRATE | 15-02 declares it REQUIRED; 15-08 checks presence by name (`vercel env ls`) before the deploy — env before schema before code |
| `vercel env pull` / any command naming an `.env*` file | OPT-OUT | Workspace rule: the agent never names an env file; the founder sets the local value by hand; the push script reads it without printing it |
| `Papa.unparse({ fields, data }, { newline: CRLF })` | INTEGRATE | 15-02 — the one CSV writer; RFC 4180 quoting proven upstream; the header line byte-pinned |
| A hand-written RFC 4180 CSV writer | OPT-OUT | papaparse is already installed; a second writer is one more thing to pin (research Don't Hand-Roll) |
| A chart library, SVG or canvas for the hour/weekday split | OPT-OUT | UI-SPEC: two plain tables on the live page, the weekday table only in print; zero new dependencies |
| zod v4 `.optional()` on `figures.missedCalls` | INTEGRATE | 15-02 — old frozen rows parse unchanged (D-11); pinned by the stored fixture (research A1) |
| SQL percentile / median in the database | OPT-OUT | One pure definition of median and P90 (computeMissedCallFigures) serves the frozen row and the live page; the repository returns the seconds array |
| Hashing inside the text-back gate's reads | OPT-OUT | Research Q6: the pseudonymisation boundary equals the 90-day cool-off, so no gate window holds a hashed row; the raw suppression row refuses a hashed STOP caller |
| Dead-letter `raw_payload` scrubbing | OPT-OUT | Research A4: dead letters carry no caller column; out of D-06's scope — a one-statement follow-up if the founder wants it |
| Bedrock (Sydney) for drafting or classification | OPT-OUT | D-05: Anthropic stays the direct provider; Bedrock is a v1.3 item and is named nowhere in the notice |
| ServiceM8, Twilio, ClickSend, Resend or Anthropic — any new call | OPT-OUT | No new provider capability in this phase; the figures and the pass are read-and-write over our own database only |
