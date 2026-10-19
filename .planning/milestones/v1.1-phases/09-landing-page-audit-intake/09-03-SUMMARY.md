---
phase: 09-landing-page-audit-intake
plan: 03
subsystem: api
tags: [nextjs, server-actions, supabase-storage, papaparse, sha256, rate-limiting, retention, privacy, vercel]

requires:
  - phase: 09-landing-page-audit-intake
    provides: "09-01's `audit_requests` + `audit_request_throttle` tables, the tenant-less repository family (`bumpAuditRequestThrottle`, `attachAuditRequestCsv`, `listExpiredAuditUploads`, `clearAuditRequestCsv`, `sweepAuditRequestThrottle`), the private `audit-uploads` bucket with `file_size_limit = 4194304` (migration 0035), `AUDIT_IP_HASH_SALT` in Vercel, and the `(marketing)/audit` form + session-less action this plan hardens"
  - phase: 02-quote-leakage-audit
    provides: "`MAX_CSV_BYTES` / `MAX_CSV_ROWS` and the papaparse intake the console pre-fill (09-06) will reuse — raised here to match the public cap"
  - phase: 06-reporting
    provides: "the daily `/api/internal/stalled-digest` bearer-authenticated pg_cron tick whose clock the upload purge now borrows"
provides:
  - "`src/core/intake/csv-sniff.ts`: pure CSV acceptance (extension + MIME allowlist + first-line parse >= 2 columns), the 4 MiB cap, and an allowlist filename sanitiser"
  - "`src/core/intake/ip-hash.ts`: first-`x-forwarded-for` extraction and `sha256(salt:key)` with IPv6 keyed on the /64"
  - "`src/core/intake/throttle.ts`: the `hits > limit` decision and the named hour window"
  - "`src/db/repository/audit-uploads.ts`: the FIRST service-role `supabase-js` client under `src/`, on its own barrel line — put/get/delete plus `purgeExpiredAuditUploads`"
  - "`next.config.ts` `experimental.serverActions.bodySizeLimit: '4400kb'`"
  - "the public form's optional `csv_file` field and off-screen `website` decoy; the action's decoy -> zod -> bump -> insert -> upload -> notify order"
  - "the 30-day object purge and day-old throttle sweep on the existing daily digest tick, reported as three enumerated counts"
affects: [09-04 host-aware-routing, 09-05 landing-page-privacy, 09-06 console-detail-prefill, 09-09 console-request-list, 10 go-live]

actuals:
  tokens: 74000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Service-role Storage client confined to `src/db/repository/`, enforced by a CI grep over `src/app` and an ESLint deep-import ban, so the barrel is the only door for the session-less public action"
    - "Abuse controls ordered ahead of validation: the free checks (a decoy field, an atomic counter) answer a bot without touching the database, and the decoy's response is byte-identical to a success including the absence of a log line"
    - "A retention promise kept by piggybacking an existing authenticated daily tick, because the store being purged (Supabase Storage) has no SQL delete path"
    - "Size read before bytes, sniff before the insert, upload after it — so a wrong file costs one sentence and no row, while a Storage outage costs the attachment and never the request"

key-files:
  created:
    - src/core/intake/csv-sniff.ts
    - src/core/intake/ip-hash.ts
    - src/core/intake/throttle.ts
    - src/db/repository/audit-uploads.ts
    - tests/audit-request-csv.test.ts
    - tests/audit-request-throttle.test.ts
  modified:
    - next.config.ts
    - src/core/audit/csv-mapping.ts
    - src/db/repository/index.ts
    - src/app/(marketing)/copy.ts
    - src/app/(marketing)/audit/form.tsx
    - src/app/(marketing)/audit/actions.ts
    - src/app/(marketing)/audit/action-state.ts
    - src/app/api/internal/stalled-digest/route.ts
    - tests/audit-request-action.test.ts
    - tests/csv-mapping.test.ts
    - tests/lint-ban.test.ts

key-decisions:
  - "Checkpoint Task 1 answered `cap-4mib` (operator, 2026-09-09): 4 MiB app cap, `bodySizeLimit: '4400kb'`, copy 'CSV only, up to 4 MB', console `MAX_CSV_BYTES` raised to 4 MiB with its pin. D-10's '<= 5 MB' is superseded — recorded as the plan's one-way deviation."
  - "The cap is ONE number in four places (app constant, body limit, console intake, bucket `file_size_limit`) because a file accepted by any one of them and refused by another is either a Vercel error page nobody wrote or a 09-06 pre-fill rejecting a file already stored"
  - "The decoy exits with `return redirect(...)` rather than a bare call: the guarantee that nothing below runs must be a fact about the function, not about whether the framework's redirect throws"
  - "A throttle bump that throws returns the server-error sentence and writes nothing (T-9-22) — a counter that is down must not become a counter that is off, or the outage nobody is watching is also the moment writes and operator notifications go unbounded"
  - "`sniffCsv` refuses an empty file as kind `type`, not `size`: the size sentence would send a prospect hunting for a cap they are nowhere near"
  - "IPv6 is keyed on the /64 (first four hextets); rotation across allocations is accepted (T-9-03) with a WAF left in CONTEXT as a Deferred Idea"
  - "The upload purge rides the daily stalled-digest tick and runs AFTER `runStalledDigest`, so a Storage outage that fails the purge cannot also cost the operator the email that says drafts are piling up (RESEARCH §6, assumption A8 — accepted)"

patterns-established:
  - "Pattern 1: a pure acceptance module takes a DESCRIPTION of a file (name/type/size/firstBytes) rather than a `File`, so the one decision an unauthenticated stranger can reach is unit-testable without a runtime or a request"
  - "Pattern 2: refusal KIND in `src/core`, refusal SENTENCE in the marketing copy module — the 11 September copy swap stays a one-file change"
  - "Pattern 3: barrel-export totality is pinned in `tests/lint-ban.test.ts`, so widening the public action's reach is a test failure rather than a silent import"

requirements-completed: [LAND-02, LAND-03]

coverage:
  - id: D1
    description: "A prospect can attach an optional Job List CSV (.csv, up to 4 MB) and it is stored in the private audit-uploads bucket at {request_id}/{sanitised-filename}, with MIME, extension, size and a first-line parse sniff checked server-side before upload"
    requirement: LAND-02
    verification:
      - kind: unit
        ref: "tests/audit-request-csv.test.ts#a real ServiceM8 export is accepted whatever MIME the browser guessed"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#uploads under {requestId}/{sanitised name} and records it on the row"
        status: pass
    human_judgment: false
  - id: D2
    description: "A non-CSV or oversized file is refused with the locked copy and nothing else is lost; a failed upload still stores the request with csv_object_path null"
    requirement: LAND-02
    verification:
      - kind: unit
        ref: "tests/audit-request-action.test.ts#refuses a non-CSV with the locked sentence and writes NOTHING"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#survives a failed upload: the request stands, hasCsv is false, the NAME is logged"
        status: pass
    human_judgment: false
  - id: D3
    description: "Exactly 4,194,304 bytes is accepted and 4,194,305 refused with the size copy; bodySizeLimit '4400kb' keeps a larger body from reaching the action"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-csv.test.ts#accepts exactly the cap and refuses one byte past it"
        status: pass
      - kind: unit
        ref: "tests/audit-request-csv.test.ts#states the platform body limit in next.config.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "A non-empty honeypot field returns the same redirect to /audit/thanks as success with no row, no throttle bump, no notification and no log line"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-action.test.ts#a filled decoy is silently thanked and nothing happens"
        status: pass
    human_judgment: false
  - id: D5
    description: "The sixth submission from one hashed IP inside an hour bucket is refused with the UI-SPEC rate-limit sentence over HTTP 200; the fifth is accepted; refused attempts still count"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-throttle.test.ts#the fifth submission is allowed and the sixth is not (D-12)"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#the per-IP throttle, counted before the row is written (LAND-03)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The IP is never stored: ip_hash is sha256(AUDIT_IP_HASH_SALT:ip) hex, IPv4 whole, IPv6 keyed on the /64; a null IP stores null and is not throttled"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-throttle.test.ts#the client address, hashed and then forgotten (T-9-05)"
        status: pass
      - kind: unit
        ref: "tests/audit-request-action.test.ts#never lets the raw address reach the row or the log (T-9-05)"
        status: pass
    human_judgment: false
  - id: D7
    description: "CSV objects older than 30 days are deleted by purgeExpiredAuditUploads from the daily stalled-digest tick and the row's csv columns are nulled; throttle rows older than a day are swept in the same pass"
    requirement: LAND-02
    verification:
      - kind: unit
        ref: "tests/audit-request-throttle.test.ts#the daily tick is the purge's clock"
        status: pass
    human_judgment: true
    rationale: "The structural assertions prove the purge is wired to the daily authenticated tick and reports enumerated counts, but that an object actually leaves the hosted Sydney bucket 30 days after upload can only be observed against production — the hosted database is production and this executor does not write to it. Confirmed live by watching `uploadsPurged` in cron.job_run_details after the first real attachment ages out."
  - id: D8
    description: "The public form's optional CSV field and off-screen decoy render correctly on a phone, with the re-attach hint appearing after a rejected submit"
    requirement: LAND-02
    verification:
      - kind: manual_procedural
        ref: "UAT after deploy: attach a small CSV on app.backdesk.com.au/audit; submit a .txt; submit six times from one phone"
        status: unknown
    human_judgment: true
    rationale: "The decoy must be invisible and unreachable to a real screen reader and a real keyboard, and the file input's touch target and the re-attach hint's placement are visual facts. A DOM assertion cannot see whether `left: -10000px` actually put the field off the visible viewport on a 375px phone."

duration: 26min
completed: 2026-09-09
status: complete
---

# Phase 09 Plan 03: Form Hardening Summary

**The public audit form now carries an optional Job List CSV into a private, service-role-only bucket that expires in 30 days, behind a silent decoy and an atomic per-address hourly counter that never stores an address.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-09-09T11:50:00Z
- **Completed:** 2026-09-09T12:16:00Z
- **Tasks:** 3 of 3 (Task 1 was a checkpoint, resolved before execution)
- **Files modified:** 17 (6 created, 11 modified)

## Accomplishments

- **The optional export lands privately.** `src/db/repository/audit-uploads.ts` is the first service-role `supabase-js` client anywhere under `src/`, and it is confined to `src/db/repository/` by two independent gates that already existed for it: the CI grep for `SUPABASE_SERVICE_ROLE_KEY` over `src/app`, and the ESLint deep-import ban 09-01 pre-registered. Objects live at `{request_id}/{sanitised-filename}` in a bucket with `public = false` and not one `storage.objects` policy, so the only read path in the product is the operator-gated route 09-06 will add.
- **The cap is one number in four places.** 4,194,304 bytes: the app constant, `bodySizeLimit: '4400kb'` (the cap plus multipart overhead, under Vercel's 4.5 MB ceiling), the console `MAX_CSV_BYTES` raised from 2 MiB with its test pin, and the bucket's own `file_size_limit` that migration 0035 already wrote. Every file this form accepts is one the platform will carry and one 09-06's pre-fill will re-read.
- **Acceptance is a parse, not a MIME guess.** `sniffCsv` takes the extension, an allowlist that includes `application/vnd.ms-excel` and `application/octet-stream` and the empty string (what Excel-associated Windows and Android pickers actually send), and then the real gate: papaparse on the first 4 KB yielding at least two columns. A BOM-prefixed CRLF Excel export passes; a renamed `.xlsx` and an empty file do not.
- **The decoy is indistinguishable from a success.** Same redirect, no row, no bump, no notification, and — asserted explicitly — no log line. It is read before zod, so a bot that fills `website` and botches the phone number is thanked rather than told which of its answers was wrong.
- **The counter is atomic and the address is not stored.** `bumpAuditRequestThrottle` runs before the insert (so refused attempts count) and returns a total from one `ON CONFLICT DO UPDATE RETURNING`; `hashClientIp` salts and digests the first `x-forwarded-for` value, keyed on the IPv6 /64 so rotation inside one residential allocation shares a bucket. A null address is not throttled and is stored as null.
- **The 30-day promise now has something that keeps it.** `purgeExpiredAuditUploads` deletes each expired object, nulls the row's four csv columns, and sweeps day-old counter rows — running on the existing daily digest tick because Supabase Storage has no SQL delete and the route was already a bearer-authenticated daily clock.

## Task Commits

Each task was committed atomically; both `auto` tasks carried `tdd="true"`, so each has a RED/GREEN pair.

1. **Task 1: CSV size cap (checkpoint:decision)** — no commit; answered `cap-4mib` by the operator on 2026-09-09 and applied throughout Task 2.
2. **Task 2: Optional CSV upload** — `77a1809` (test, RED) → `3cd4fcb` (feat, GREEN)
3. **Task 3: Decoy, IP hash, throttle, purge** — `ead9764` (test, RED) → `e22e8ab` (feat, GREEN)

No REFACTOR commit was needed for either task: both implementations were written against their tests and needed no post-green cleanup.

## Files Created/Modified

**Created**
- `src/core/intake/csv-sniff.ts` — pure acceptance decision, the 4 MiB cap, and the allowlist filename sanitiser
- `src/core/intake/ip-hash.ts` — `clientIpFromHeaders` (first `x-forwarded-for` value) and `hashClientIp` (salted sha256, IPv6 /64)
- `src/core/intake/throttle.ts` — `throttleDecision` (`hits > limit`) and the named hour window
- `src/db/repository/audit-uploads.ts` — the service-role Storage client and the purge
- `tests/audit-request-csv.test.ts` — 24 assertions over acceptance, the boundary bytes and the four-way cap agreement
- `tests/audit-request-throttle.test.ts` — the hash, the header, the decision, and the digest-route structure

**Modified**
- `next.config.ts` — `experimental.serverActions.bodySizeLimit: '4400kb'`
- `src/core/audit/csv-mapping.ts` — `MAX_CSV_BYTES` 2 MiB → 4 MiB, with the reason and the cross-reference in the docblock
- `src/db/repository/index.ts` — the `audit-uploads` barrel line
- `src/app/(marketing)/copy.ts` — the CSV label, hint, re-attach sentence, the two refusal sentences, the decoy label
- `src/app/(marketing)/audit/form.tsx` — the optional file field and the off-screen decoy
- `src/app/(marketing)/audit/actions.ts` — decoy → zod → bump → insert → upload → notify
- `src/app/(marketing)/audit/action-state.ts` — `AuditErrorField` adds `csv_file` as an error key and deliberately not a value key
- `src/app/api/internal/stalled-digest/route.ts` — the purge and three enumerated counts
- `tests/audit-request-action.test.ts` — 13 new cases: upload, decoy, throttle, and the full ordering
- `tests/csv-mapping.test.ts` — the cap pin follows the constant
- `tests/lint-ban.test.ts` — the four new barrel exports added to the totality pin

## Decisions Made

### Checkpoint Task 1 — CSV size cap: `cap-4mib`

**Answered by the operator, 2026-09-09.** 4 MiB app cap, `bodySizeLimit: '4400kb'`, copy "CSV only, up to 4 MB", console `MAX_CSV_BYTES` raised to 4 MiB with its test pin updated; the bucket `file_size_limit = 4194304` was already correct in migration 0035, so no follow-up migration was needed.

The two rejected options and why the answer holds: `keep-5mb-copy` would have left files between 4 and 5 MB promised acceptance on the first screen a prospect reads and then met either a Vercel error page or the size refusal — a broken promise at first contact. `signed-browser-upload` would have honoured the number by breaking D-10's no-JS requirement, inverting the honeypot/throttle ordering, and adding a public write path into the bucket.

The remaining key decisions are in the frontmatter above.

## Deviations from Plan

### 1. [Checkpoint-driven, one-way] D-10's "≤ 5 MB" is now 4 MiB everywhere

- **Found during:** Task 1 (the checkpoint that exists for exactly this)
- **Issue:** D-10 locked the public CSV cap at "≤ 5 MB", which the platform cannot honour. Vercel Functions reject a request body over 4.5 MB with `FUNCTION_PAYLOAD_TOO_LARGE` before the Server Action runs, and Server Actions default to a 1 MB body [09-RESEARCH.md §5 "Body size — the locked '≤ 5 MB' cannot be met as written" and Pitfall 1, citing vercel.com/docs/functions/limitations (updated 2026-08-24) and nextjs.org `serverActions`].
- **Fix:** `AUDIT_CSV_MAX_BYTES = 4 * 1024 * 1024`; `bodySizeLimit: '4400kb'` (the cap plus the 10–20 KB multipart adds, still under the platform ceiling); `MAX_CSV_BYTES` raised from 2 MiB to match; the hint reads "CSV only, up to 4 MB" and the size refusal reads "That file is over 4 MB. Leave it out and we'll get the data another way." A ServiceM8 Job List export for a 1–10 staff business over 90 days is far under 1 MB, so no real prospect meets either number.
- **Files modified:** `src/core/intake/csv-sniff.ts`, `next.config.ts`, `src/core/audit/csv-mapping.ts`, `tests/csv-mapping.test.ts`, `src/app/(marketing)/copy.ts`
- **Verification:** `tests/audit-request-csv.test.ts` pins all four numbers to the same integer and asserts `next.config.ts` contains `4400kb`; the UI-SPEC's own "up to 5 MB" wording no longer appears anywhere in `copy.ts` (`grep -c "up to 5 MB"` → 0).
- **Committed in:** `3cd4fcb`
- **Onward:** 09-05's `/privacy` and any UI-SPEC copy refresh should say 4 MB. The UI-SPEC rows C-8 "Job List CSV" hint, "Error: csv size", and the "CSV acceptance" default still read 5 MB and are now superseded by this SUMMARY.

### 2. [Rule 3 — Blocking] The barrel totality pin refused the four new exports

- **Found during:** Task 2
- **Issue:** `tests/lint-ban.test.ts` asserts the exact key set of `@/db/repository`, deliberately, so that widening the reach of the one unauthenticated write path is a test failure rather than a silent import. Adding the `audit-uploads` barrel line failed it.
- **Fix:** Added `deleteAuditUpload`, `getAuditUpload`, `purgeExpiredAuditUploads` and `putAuditUpload` to the pinned list with a comment naming what they are, which is the intended maintenance for this gate rather than a workaround for it.
- **Files modified:** `tests/lint-ban.test.ts`
- **Verification:** `npx vitest run tests/lint-ban.test.ts` — 28 passed.
- **Committed in:** `3cd4fcb`

### 3. [Rule 3 — Blocking] The digest route's own anti-spread comment tripped the plan's grep

- **Found during:** Task 3
- **Issue:** Task 3's acceptance criterion is `grep -c "\.\.\.result\|\.\.\.purge" src/app/api/internal/stalled-digest/route.ts` printing 0. The route already contained the literal `...result` — inside the comment that states the no-spread rule, written by an earlier phase.
- **Fix:** Reworded that sentence to "A spread would let a field added later for an operator's benefit ride straight there, which is why the absence of one is checked rather than remembered." The rule is stated no less clearly and the check now measures code rather than prose about code.
- **Files modified:** `src/app/api/internal/stalled-digest/route.ts`
- **Verification:** the grep prints 0; `tests/audit-request-throttle.test.ts#enumerates the new counts by name and never spreads a result` passes.
- **Committed in:** `e22e8ab`

### 4. [Rule 2 — Missing critical functionality] `return redirect(...)` on the decoy path

- **Found during:** Task 3
- **Issue:** A bare `redirect('/audit/thanks')` in the decoy branch typechecks (it returns `never`) but only actually stops the function because the framework's `redirect` throws. Under the action suite's non-throwing `redirect` mock, execution fell through and a decoy hit wrote a row — which is precisely the prohibition this control exists to enforce, and the test caught it.
- **Fix:** `return redirect('/audit/thanks')`, with the reasoning in a comment: the guarantee that nothing below runs must be a fact about this function, not about the framework.
- **Files modified:** `src/app/(marketing)/audit/actions.ts`
- **Verification:** `tests/audit-request-action.test.ts#redirects exactly as a success does, having written nothing`
- **Committed in:** `e22e8ab`

---

**Total deviations:** 4 — 1 checkpoint-driven one-way change (recorded, decided by the operator before execution), 2 Rule 3 blocking fixes, 1 Rule 2 correctness fix.
**Impact on plan:** No scope creep. Deviation 1 is the decision the plan's own checkpoint existed to take. Deviations 2 and 3 are maintenance of two deliberate gates that fire on exactly this kind of change. Deviation 4 closed a real hole in a prohibition (`MUST NOT ... write a row ... for a honeypot hit`).

## Prohibition Status

All three of the plan's flagged prohibitions moved from `unverified` to verified by automated assertion:

| Requirement | Prohibition | Status | Evidence |
|---|---|---|---|
| LAND-02 | No public URL, no browser-held signed URL, no `storage.objects` policy | verified | No `storage.objects` policy was added; `audit-uploads.ts` exposes only `putAuditUpload`/`getAuditUpload`/`deleteAuditUpload` and issues no signed URL (`createSignedUrl` appears nowhere in `src/`); the deep-import ban plus the barrel pin bound who can call them |
| LAND-03 | No notification, row or throttle bump for a honeypot hit; response indistinguishable from success | verified | `tests/audit-request-action.test.ts#a filled decoy is silently thanked and nothing happens` — plus an explicit assertion that neither `console.error` nor `console.warn` is called |
| LAND-03 | No uploaded list kept past 30 days; the purge is scheduled, not a convention | verified (structurally) | `purgeExpiredAuditUploads` is called from the daily authenticated tick and reports enumerated counts; the 30-day stamp is written by the repository from `AUDIT_UPLOAD_RETENTION_DAYS`. That an object actually leaves the hosted bucket is D7's live check |

## Threat Flags

None. Every surface this plan added is already in the plan's `<threat_model>`: the multipart body (T-9-04), the service-role Storage client (T-9-10/T-9-11), the daily tick's delete (T-9-06), and the `x-forwarded-for` throttle key (T-9-02/T-9-03/T-9-05/T-9-22). No new endpoint, auth path or schema change was introduced.

## Known Stubs

None. Nothing in this plan renders placeholder data or leaves a data source unwired. The `hasCsv` flag reaching the operator email is `true` only when the object is stored **and** the row points at it.

## Issues Encountered

- **The remote suites are red locally, and that is the guard working.** A bare `npx vitest run` reports 40 failed suites, all of them refusing with "Refusing to run integration tests against a non-local Supabase stack" because the hosted Sydney project is production. All 2,710 individual tests that do run pass. This plan's six relevant suites are pure and all green.
- **`@supabase/storage-js` is transitive, not declared.** The bucket handle's type is derived (`ReturnType<ReturnType<typeof createClient>['storage']['from']>`) rather than imported from that package, so this module does not depend on somebody else's lockfile.

## User Setup Required

None. `AUDIT_IP_HASH_SALT` was already added to `.env.local`, Vercel Production and Vercel Preview by 09-01, and no new secret, cron entry or bucket was needed — the purge borrows the existing `STALLED_DIGEST_SECRET` tick.

## Next Phase Readiness

- **09-06 (console detail + pre-fill)** has everything it needs: `getAuditUpload(path)` returns a `Blob` for the operator-gated download route, `MAX_CSV_BYTES` now matches the public cap so the pre-fill cannot reject a stored file, and `deleteAuditUpload` is exported for the delete-on-conversion step.
- **09-05 (landing page + privacy)** must state the 30-day CSV retention in `/privacy` and should carry the `.hp` rule (`position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden`) into `marketing.css`; the decoy currently holds those five declarations in an inline `style` prop so it is off-screen from the first deploy, and that inline copy can be dropped once the stylesheet exists.
- **09-04** owns `proxy.ts` and the push at the end of this wave; nothing here touched either.
- **Live UAT after deploy** (D7, D8): attach a small CSV on `app.backdesk.com.au/audit` and confirm the row shows "CSV attached"; submit a `.txt` and read the type sentence; submit six times from one phone and confirm the sixth shows the rate-limit sentence with no email or SMS for it.

## Self-Check: PASSED

- All 7 claimed files exist on disk (4 source modules, 2 new test suites, this SUMMARY).
- All 4 claimed commits exist in git: `77a1809`, `3cd4fcb`, `ead9764`, `e22e8ab`.
- Prohibition spot-checks re-run against the tree: `grep -rn "createSignedUrl" src/` → 0 hits; the only `storage.objects` mention anywhere in the migrations is the comment in 0035 stating that no policy exists.
- `npm run typecheck`, `npm run lint --max-warnings=0` and `npx next build` all clean; the six plan-relevant suites green (`audit-request-csv`, `audit-request-throttle`, `audit-request-action`, `csv-mapping`, `lint-ban`, `audit-request-schema`).
