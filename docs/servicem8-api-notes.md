# ServiceM8 API — measured behaviour

What the API actually does, as opposed to what it is documented to do. Every row
below was **measured against a live trial account**, not read off a reference
page. Re-run `node scripts/sm8-spike.mjs` to reproduce.

- **Measured:** 26 August 2026
- **Account:** ServiceM8 14-day trial, 6 seeded jobs across all four statuses
- **Caveat that applies to the whole document:** six jobs is a small sample. Any
  finding whose answer could depend on volume (pagination, above all) is flagged
  as such rather than presented as settled.

---

## Filtering precision (A1)

| Question | Documented | **Measured** |
|---|---|---|
| Does `$filter` accept a datetime literal? | Only date-only examples (`create_date gt '2023-01-01'`) | **Yes.** `edit_date gt '2026-08-26 08:19:39'` returned 2 rows where a date-truncated read would have returned 5 |
| Is `gt` strict? | Implied yes | **No — it behaves as `>=`.** The probe returned exactly the inclusive count (2), not the strict count (1) |
| Are `ge` / `le` available? | Docs: "not currently supported" | Not re-tested; `gt` behaving inclusively makes `ge` unnecessary |

**Consequence for the code.** The cursor keeps second precision, so
`filterFrom(cursor)` can pass a full datetime. The inclusive comparison means
**the record sitting exactly on the cursor comes back on every poll**. This is
the safe direction — Pitfall 2 warns about *losing* same-second edits, and an
inclusive `gt` cannot lose them — and the repeat is absorbed by the
`(tenant_id, sm8_job_uuid)` upsert. It does mean a poll is never empty while any
record sits on the boundary; do not treat "one row returned" as "something
changed".

---

## Pagination (A2)

| Observation | Result |
|---|---|
| `job.json?cursor=-1` | 6 rows |
| `job.json` (parameter omitted) | 6 rows — **identical set** |
| Cursor / page / next / link / total headers | **None** |
| Response envelope | **None** — the body is a bare JSON array |

Full header set returned by `job.json`: `alt-svc`, `cache-control`,
`connection`, `content-encoding`, `content-type`, `date`, `server`,
`strict-transport-security`, `transfer-encoding`, `vary`, `via`, `x-amz-cf-id`,
`x-amz-cf-pop`, `x-cache`, `x-frame-options`, `x-platform-date-utc`.

**Status: NOT CONCLUSIVE, and deliberately recorded that way.** The account holds
6 jobs — far below any plausible page size — so a single complete response was
the expected outcome regardless of whether paging exists. What is established is
that **no next-cursor is advertised** in either the body or the headers. Whether
one is required above some threshold is unknown.

**Consequence for the code.** `src/core/servicem8/pagination.ts` keeps its
defensive walk instead of collapsing to one request. Its no-new-uuids
termination rule is load-bearing: because the server ignores the cursor
parameter, page two returns page one, and without that check the walk would run
to its 50-page cap on every call. Against the measured behaviour the walk costs
exactly one extra request per backfill.

**Re-measure before removing the loop.** Needs an account with >100 jobs.

---

## Timestamp timezone (A3)

| Question | Assumed | **Measured** |
|---|---|---|
| What zone are `edit_date`, `quote_date` etc. in? | Account-local (the tenant's IANA zone) | **UTC** |

**This contradicts research assumption A3** and the community report of
future-skewed `edit_date` values on a Perth (UTC+8) account that motivated it.

The measurement: every response carries an **`x-platform-date-utc`** header —
ServiceM8 stating its own clock, explicitly labelled UTC. A job edited 24 minutes
before the probe had an `edit_date` reading **24 minutes behind** that header
when interpreted as UTC. Had the value been Perth local time, the same string
would have read roughly **8 hours ahead** of it.

> Probe correctness note: the header value is naive (`2026-08-26 08:44:06`), so
> it must be parsed with an explicit `Z`. The first version of this probe did
> not, read it in the running machine's zone, and reported an 8-hour "clock
> skew" that did not exist. With the fix, measured skew between ServiceM8's
> clock and ours is **0 seconds**.

**Consequence for the code.** `SM8_TIMESTAMP_ZONE = 'UTC'` in
`src/core/servicem8/normalize.ts` is the interpretation zone, and
`connectServiceM8` passes it explicitly rather than passing `tenant.timezone`.
The distinction matters: **the tenant's IANA zone governs contact hours and
display; this one governs how a ServiceM8 string is read.** Conflating them is an
8-hour error for every Perth client.

`sm8_connections.sm8_tz_offset_minutes` remains on the schema as per-account
calibration. If an account is ever found storing local time, that is a stored
value to change, not code.

**Precision note:** the residual in the measurement is record *age*, not offset.
For an exact reading, edit any job in the ServiceM8 UI and re-run the spike
immediately.

---

## Zero-date comparison (A4)

| Question | Assumed | **Measured** |
|---|---|---|
| Do zero-dates (`0000-00-00 00:00:00`) fall out of a `gt` comparison? | Yes | **Yes — confirmed** |

The direct probe was vacuous: all 6 seeded jobs have a real `quote_date`, so
`quote_date gt '2000-01-01'` returned all 6 and proved nothing.

The finding comes from a **natural experiment** on the same objects.
`work_order_date` is genuinely zero on every job still in `Quote` or
`Unsuccessful` status — the same zero-date value, on the same rows, in a field
that has a mix:

- 2 jobs with a real `work_order_date`, 4 with a zero one
- `work_order_date gt '2000-01-01'` returned **exactly the 2** real ones
- **0 of the 4** zero-date rows survived the filter

**Consequence for the code.** The single-filter Pattern 6 fetch
(`quote_date gt '<cutoff>'`, one request spanning all four statuses) is safe.
The four-request per-status fallback is **not needed** and has not been built.

---

## Schema corrections found by calling the API

Two fields do not match the reference documentation. Both were found by the
tracer failing against live data, not by reading:

| Field | Documented | **Actual** | Handling |
|---|---|---|---|
| `quote_sent` | integer 0/1 | **JSON boolean** (`false`) — returned alongside `active: 1`, a *number*, in the same object | `sm8Flag` in `schemas.ts` accepts numbers, strings and booleans |
| `total_invoice_amount` | string | String with **4 decimal places** (`"393.7500"`) | `parseMoneyToCents` truncates to 2 via integer string math — never float |

This is the concrete argument for the fixture set in `tests/fixtures/sm8/`: a
schema written from the reference pages alone rejected **every job in the
account**.

---

## Fixtures captured

Written by `scripts/sm8-spike.mjs` to `tests/fixtures/sm8/`, sanitized
(phone/mobile/email replaced with obvious fakes; free-text fields scrubbed for
phone and email patterns).

| File | Rows | Note |
|---|---|---|
| `job.json` | 6 | 2 Quote, 2 Work Order, 1 Completed, 1 Unsuccessful |
| `jobcontact.json` | 6 | one contact per job |
| `note.json` | 1 | trial account has minimal note history |
| `jobactivity.json` | 1 | scheduling records, not a comms log — see below |

The sanitize pass runs even though trial data is fake by construction, so the
script is safe to point at a real client's account later. A capture routine that
only works on fake data has to be rewritten the day it matters most.

**`jobactivity` is not a communications log.** It records staff
scheduling/time-allocation (`staff_uuid`, `start_date`, `activity_was_scheduled`).
It counts as evidence of *some* activity for D-10 follow-up detection, but SMS
and email sent from within ServiceM8 are **not visible** through it. The Quote
Leakage Audit's "never followed up" figure is an approximation for this reason,
and says so on the report.

---

## ServiceM8 own-comms (D-13) — `sms.json` / `email.json`

**Measured 1 Sep 2026** with `node scripts/sm8-spike.mjs probe`, against the
trial account, under a private `X-API-Key`.

| Endpoint | HTTP | Rows | Fields observed |
|---|---|---|---|
| `GET /api_1.0/sms.json` | **200** | 0 | — (empty array) |
| `GET /api_1.0/email.json` | **200** | 0 | — (empty array) |

### Re-measured 11 September 2026 (Phase 10, ARM-04)

`node scripts/sm8-spike.mjs probe` again — same trial account, same private
`X-API-Key`, exit 0, two GET requests, no paging, nothing written. **Seeded first:**
the operator sent **one SMS and one email from inside ServiceM8** (the manual path,
option (b) of the seeding checkpoint) on 2026-09-11 AWST, on the **trial** account
behind `SM8_TEST_API_KEY` — tenant `13e8f2aa-edee-4eb1-b699-09b650674f81`, "Perth
Sparks Electrical (Test)". It was **not** seeded on a founding client's account: none
is signed yet, and once one has attested automation-off under ONB-04, their account is
off limits for this measurement permanently.

| Endpoint | HTTP | Rows | Fields observed | hasJobUuidAttribution | timestampFields |
|---|---|---|---|---|---|
| `GET /api_1.0/sms.json` | **200** | **1** | `direction`, `from_phone`, `message`, `related_object`, `related_object_uuid`, `sent_by_staff_uuid`, `timestamp`, `to_phone`, `uuid` | `false` | `sent_by_staff_uuid`, `timestamp` |
| `GET /api_1.0/email.json` | **200** | **1** | `attachment_uuids`, `bcc_email`, `bounced`, `cc_email`, `direction`, `first_opened_at`, `from_email`, `message_html`, `message_text`, `opened`, `related_object`, `related_object_uuid`, `sent_by_staff_uuid`, `subject`, `timestamp`, `to_email`, `uuid` | `false` | `sent_by_staff_uuid`, `timestamp` |

Field **names** only. The probe records no row value and none appears above.

**Both derived booleans need their regex read alongside them — neither means at face
value what its name suggests:**

- **`hasJobUuidAttribution: false` is a naming artefact, not an absence.** The flag is
  the probe's `/job.*uuid|uuid.*job/i` test over field names, and ServiceM8 simply does
  not name the field `job_uuid`. Both endpoints carry **`related_object` +
  `related_object_uuid`** instead — the polymorphic attribution pair ServiceM8 uses
  elsewhere, where one field names the object type and the other holds that object's
  UUID. It is the only candidate in either row, and it is very likely the "something
  that resolves to a job UUID" the deferred condition allowed. But the probe
  deliberately reads no values, so **whether `related_object` reads `Job` for a
  job-context send is still unmeasured**, and that single unread value is now the whole
  of what stands between this shape and a designable Tier 1.
- **`timestampFields` over-reports.** `sent_by_staff_uuid` appears only because the
  regex `/date|time|sent|created/i` matches the substring `sent` inside it; it is a
  staff UUID. The genuine send timestamp on both endpoints is the single field
  **`timestamp`**. Its unit and timezone were not measured here — see the A3 section
  above for how ServiceM8 timestamps behaved on the endpoints that were.

`direction` is present on both, so their outbound is separable from their inbound
without inferring it from the address fields.

### Decision — Tier 1 drift detection (D-09)

The condition set on 1 September was: Tier 1 is designable **iff** a row carries a job
UUID (or something that resolves to one) **and** a send timestamp.

- **Timestamp half: met.** `timestamp` is present, singular and unambiguous.
- **Attribution half: met in shape, unmet in value.** `related_object_uuid` is the
  right kind of field and nothing else in the row could carry attribution, but its
  discriminator was not read.

So the honest statement is **"designable pending one unread value"**, not "designable".

**No Tier 1 code is written in this phase**, and D-09's escape hatch does not open it.
That hatch admits Tier 1 only if it is a *small addition to the staleness nag*, and it
is not: the nag is a 30-day timer over `tenant_attestations`, whereas Tier 1 needs a
per-client poll of two further endpoints, its own cursor, a correlation of their sends
against our `send_ledger` (or we would flag our own ServiceM8-side activity as drift),
and a decision about what a match actually does to a live cadence. None of that is an
addition to a timer. **D-15 detection therefore stays Tier 2 — operator attestation
plus the 30-day nag — unchanged, exactly as it shipped.**

Follow-up named, event-gated on the first founding client: **confirm `related_object`
reads `Job` on a job-context send, and re-measure against an AUTOMATION-generated
follow-up rather than a manual one.** Only a real client account runs Quote Follow Up
in anger, and until that returns Tier 1 has a shape but no confirmed key.

### The 1 September reading (historical — it recorded reachability, and that no row had ever been seen)

**Both endpoints are REACHABLE under a private API key.** That is the half of
D-13 this probe set out to answer, and it answers it: the auth we actually hold
for design-partner clients (a key they generate in their own settings, no OAuth
approval needed) is enough to call them. They do not 403 and they do not 404.

*(Superseded on the shape question by the 11 September re-measure above; kept
because it records what was true, and what was not yet known, on 1 September.)*

**The response SHAPE is still unmeasured, because the trial account has never
sent an SMS or an email through ServiceM8.** A `200 []` proves reachability and
nothing about the payload — field names, timestamp format, and above all whether
a row carries the **job UUID** that would let us attribute a ServiceM8-sent
message to the quote we are chasing. Tier-1 detection needs exactly that
attribution, so it cannot be designed against this measurement.

### Consequence for ONB-04 / D-15

*(The 1 September position. The Tier 1 bullet's blocker — "we have never seen a
row" — is closed by the 11 September re-measure; the Tier 2 bullet is unchanged and
still current, and the Decision above is the live one.)*

- **Tier 2 (staleness nag) is what shipped.** The gate is an operator
  attestation (`tenant_attestations`, kind `sm8_automation_off`), and drift is
  handled by re-asking a human at 30 days — a badge on the client page and one
  line in the daily digest. It never pauses anything.
- **Tier 1 (behavioural drift detection) stays DEFERRED, and this is now a
  measured deferral rather than an assumed one.** The blocker moved: it is no
  longer "we do not know whether we can read these endpoints" (we can), it is
  "we have never seen a row". Research A2's condition is unchanged and is now
  the whole of what is missing — a **seeded native follow-up** on a real
  account, so that automation-sent comms can be observed to appear here at all
  before any pause logic keys on them.
- **No production code path in this build reads either endpoint.** Reachability
  is not a licence to key a pause on a shape nobody has seen.

### The next measurement — what is still unknown

The 1 September blocker ("we have never seen a row") is closed. Two narrower ones and
one old one replace it:

1. **The discriminator value.** Re-read `related_object` for a row sent from a *job's*
   screen and confirm it reads `Job`, with `related_object_uuid` holding that job's
   UUID. One GET. Record the type name only — never the UUID, and never a row's
   address or body.
2. **The automation shape.** Everything in the 11 September table came from a
   **manually** sent SMS and email. A Quote Follow Up automation send may populate a
   different field set — `sent_by_staff_uuid` in particular is unlikely to name a
   human. On a consenting account: Settings → Automation → Quote Follow Up ON for one
   quote, let it fire, turn it OFF, re-run `node scripts/sm8-spike.mjs probe`, diff the
   field list against the table above. **Never on a client account that has already
   attested automation-off** — the attestation must stay true.
3. **Cursor and volume behaviour** — unchanged and unmeasured. Neither endpoint has
   been paged, and nothing is known about how far back either returns.

Note that `jobactivity` remains a dead end for this question — see the schema
correction above: it logs staff scheduling, not communications.

---

## Rate limits

180 requests/minute and 20,000/day, per app per connected account (restated on
the job reference page). Not stress-tested — the backfill issues 2–5 requests.

---

## Webhook activation — PENDING OAuth

Webhooks require the OAuth public-app path; a private API key cannot subscribe.
ServiceM8 Development Partner registration was submitted **25 Aug 2026, App ID
000000** (see `docs/external-registrations.md`), and no approval timeline is
published.

Until credentials are issued, **polling is the SYNC-03 guarantee** and the
webhook route ships inert.

### What is already built (plan 02-03)

`src/app/api/webhooks/servicem8/route.ts` exists and is fully tested
(`tests/webhook-hint.test.ts`, 18 assertions). It:

- answers a `{"challenge": "..."}` POST by echoing the raw value as
  `text/plain`, and the query-string form on GET;
- parses a job `uuid` out of either `{uuid}` or `{entry: [{uuid}]}` and **nothing
  else** — every other payload field is discarded by the zod schema;
- resolves the uuid to a tenant with `forAllTenants_webhookHint`, which matches
  against `quotes.sm8_job_uuid` and skips paused connections;
- debounces at **60 seconds** per connection against `last_success_at`;
- runs `runSyncForConnection` — the same cycle the 5-minute tick runs, so the two
  paths cannot drift;
- returns **200 for everything**, including a malformed body and a thrown cycle.

Nothing calls it yet: no subscription exists.

### Activation steps

1. Add `SM8_OAUTH_CLIENT_ID` / `SM8_OAUTH_CLIENT_SECRET` to the server env schema
   (`src/core/shared/env.ts`).
2. Add the OAuth arm to `Sm8Auth` in `src/core/servicem8/types.ts` — the union
   exists precisely so this is a constructor change, not a rewrite. Access tokens
   live 3600s; store the refresh token beside the ciphertext.
3. Implement the authorize → access_token exchange against
   `go.servicem8.com/oauth/authorize` and `/oauth/access_token`. Scopes needed:
   `read_jobs`, `read_customers`, `read_job_contacts`, `read_job_notes`,
   `read_schedule`.
4. Deploy so the callback URL is live at
   `https://<app-domain>/api/webhooks/servicem8`. Confirm the route is reachable
   without a session — `proxy.ts` excludes `api/` (see plan 02-03); a 307 to
   `/login` here means that exclusion regressed.
5. Create the subscription for the **Job** object:

   ```
   POST https://api.servicem8.com/api_1.0/webhook_subscriptions.json
   Authorization: Bearer <oauth access token>
   { "object": "Job", "callback_url": "https://<app-domain>/api/webhooks/servicem8", "fields": ["status", "active", "edit_date"] }
   ```

   ServiceM8 POSTs a challenge to that URL and the subscription only becomes
   live once it is echoed.

6. **UNVERIFIED — the one thing to watch.** The docs state the challenge must be
   echoed but do not pin the response encoding. The route answers with the raw
   value as `text/plain`. If the subscription call rejects that, switch to
   `Response.json({ challenge })` — it is a single marked line in
   `echoChallenge()`, and `tests/webhook-hint.test.ts` has the assertion to
   update alongside it. Record the measured answer here when it is known.

7. Callbacks carry only `{uuid, changed fields, resource_url}` — **re-fetch the
   object**; never trust the payload as the record. This is enforced structurally,
   not by convention: the route imports no write surface at all, and a test
   asserts it.
8. Return HTTP 200 always. A 429 from us throttles delivery for 15 minutes; a 410
   **auto-unsubscribes**. Retries continue for 72 hours. This is why the route
   swallows its own errors rather than surfacing them to ServiceM8.
9. **Keep the poll running** after webhooks are live. It is the reconciliation
   sweep that catches anything a missed callback dropped, and it is the only path
   that can discover a job we have never seen — the uuid-based tenant resolution
   in step 5 cannot resolve a brand-new job, by design (one polling interval of
   latency, on a job that is minutes old).

---

## The production tick (plan 02-03)

Not a ServiceM8 fact, recorded here because it is what makes the polling above
happen unattended.

| Piece | Where |
|---|---|
| Endpoint | `POST /api/internal/sync-tick`, bearer `SYNC_TICK_SECRET`, `maxDuration = 300`, region `syd1` |
| Schedule | pg_cron job `sm8-sync-tick`, `*/5 * * * *`, applied by `scripts/apply-cron-schedules.mjs` |
| Retention | pg_cron job `cron-details-cleanup`, weekly, migration `0012` |

Applying or rotating the schedule:

```bash
APP_BASE_URL=https://<app-domain> node scripts/apply-cron-schedules.mjs
```

The script is idempotent and prints jobname + schedule only. The secret and the
origin are read from the environment and are never committed.

**The cross-check that matters after deploy:** `cron.job_run_details` showing
succeeded runs is NOT evidence that sync ran — a 307 to `/login` counts as a
success to `net.http_post`. Check `sync_runs` gains rows in the same window.

---

## Write semantics (Phase 14 spike, 10 Oct 2026)

Measured by the Phase 14 research spike against **the test account only**
(D-11), 2026-10-10 05:10:20–05:10:25 UTC, 24 calls through the private API key.
The full call-by-call ledger is the "Spike ledger" in Phase 14's
`14-RESEARCH.md` (under `.planning/phases/` while the phase is open, the
milestone archive after). No other account was written to. The write client
built on these facts is `src/core/servicem8/client.ts` (`post`, `getOne`) and
`src/core/servicem8/writes.ts`; its only test double is
`tests/helpers/sm8-stub.ts`.

| Fact | Measured |
|---|---|
| Create verb/path | `POST /api_1.0/<resource>.json` with a JSON body and `Content-Type: application/json` |
| Success body | `200` `{"errorCode":0,"message":"OK"}` — `errorCode` is a **number** on the wire (the docs show the string `"0"`); the client accepts both |
| New record's uuid | the `x-record-uuid` response header, on every create (company, companycontact, job, jobcontact); absent on reads and errors. Not in the body |
| Update | `POST /<resource>/{uuid}.json` with a partial body → `200`, header echoes the uuid |
| Single read | `GET /<resource>/{uuid}.json` → a **single object**, not an array; `200` even when `active: 0` |
| Delete | `DELETE /<resource>/{uuid}.json` → `200`; **soft**: the record reads back with `active: 0` (not 404) |
| 400 shape | `{"errorCode":400,"message":"<reason>","documentation":"…"}`. Reasons seen: `company_uuid record does not exist`, `Job status is not valid`, `job_uuid is not a valid uuid`. The `message` is a response body: the client maps it to `bad_request` + the status and **never returns, logs or stores it** (T-2-02) |
| 401 / 429 / 404 | Not triggered (key valid, far under 180/min, deleted records read 200). Docs: 404 on a uuid that never existed — classified `bad_request`, a clean miss |
| Latency | 119–609 ms per call |
| Job read-back | `status: "Quote"` persisted on create; `date` is ServiceM8's date-only stamp (`YYYY-MM-DD 00:00:00`); `quote_date` and `edit_date` stamped; `generated_job_id` assigned; `job_address` and `category_uuid` empty strings; `quote_sent: false`; `total_invoice_amount: "0.0000"` |
| Job contacts | ServiceM8 auto-creates **no** job contact for an API-created job; adding one bumps the job's `edit_date` |

**The Company object has no mobile.** `company.json` carries name, ABN, address
and fax fields — no mobile, phone or email (measured; the docs agree). A client
record's numbers live on `companycontact.json`, so "match a company by mobile"
means filtering company **contacts**, and every company Backdesk creates gets a
company contact beside it. A primary company contact written with
`type: "JOB"` read back as `type: "BILLING"` — never filter company contacts by
`type`.

**`$filter` is exact-spelling.** A local spaced mobile (`04xx xxx xxx`) found
the contact stored that way; the same digits without spaces found nothing. The
product writes the local spaced form and asks for three spellings in order
(local spaced, local compact, international) — `src/core/leads/mobile-spellings.ts`.
The international spelling's filter behaviour is unmeasured (research A3).

**No server-side dedupe.** A second `POST job.json` identical to the first
created a second job. Exactly-once is ours to enforce: a guarded claim on the
lead, each uuid persisted the moment it is returned, and adopt-before-create on
retry.

**Sync safety — the test tenant's sync is LIVE.** The spike found the test
tenant's ServiceM8 connection not paused (only messaging was), and the 05:15
sync tick mirrored two of the spike jobs and one contact into production
`quotes` / `quote_contacts` (inactive, `Unsuccessful`, no event, no cadence —
inert; left for the founder to delete by id). **Any future write probe must
assume the sync is live: set every job `Unsuccessful` before deleting it**, so a
first sight emits nothing, and finish well inside one five-minute window.

**Final state of the five spike objects** (all cleaned in the same session):

| Object | uuid | Final state |
|---|---|---|
| company | `01a12438-2033-7bb1-957b-3d868b711fcb` | `active: 0` |
| companycontact | `01a12438-232f-7bb1-957b-c635a0fac47b` | `active: 0` |
| job | `01a12438-259d-7bb1-957a-334257f778ab` | `Unsuccessful`, `active: 0` |
| job (the duplicate) | `01a12438-2cc6-7bb1-957b-074e89246b4b` | `Unsuccessful`, `active: 0` |
| jobcontact | `01a12438-2832-7bb1-957b-91e78978beeb` | `active: 0` |

OAuth scopes the write path will need when the public app replaces the private
key are recorded under the App ID entry in `docs/external-registrations.md`.

---

## Reproducing

```bash
node scripts/sm8-spike.mjs        # measures A1–A4, rewrites the fixtures
node scripts/sm8-spike.mjs probe  # D-13 only: sms.json / email.json. Two GETs,
                                  # no fixture writes — a one-question probe
                                  # must not be able to change a test suite's
                                  # inputs as a side effect.
node scripts/verify-sm8-connect.mjs   # end-to-end connect proof
```

Both need `SM8_TEST_API_KEY` in `.env.local` — see `docs/env-vars.md`.
