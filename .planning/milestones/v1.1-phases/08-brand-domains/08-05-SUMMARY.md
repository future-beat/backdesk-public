---
phase: 08-brand-domains
plan: 05
subsystem: infrastructure
status: complete
tags: [vercel, custom-domain, pg-cron, clicksend, url-switch, proofs]
requires:
  - "08-04: app.backdesk.com.au attached, CNAME published, certificate issued"
  - "08-04 step 5: operator set APP_BASE_URL in .env.local (proven here)"
provides:
  - "app.backdesk.com.au is the live origin for every consumer of APP_BASE_URL"
  - "npm run cron:status — secret-safe read-back of cron.job, net._http_response, the remote-test lease and the local origin"
  - "The old *.vercel.app alias is unreferenced — the precondition for the 08-06 rename and release"
affects:
  - "08-06: may now rename the project, redirect the new default alias and enable protection"
  - "08-07: Resend/email verification runs against the custom host"
tech-stack:
  added: []
  patterns:
    - "Re-point-and-read-back: every external store is re-pointed, then read back from the store itself, before the next store is touched"
    - "Extract-in-database: the cron URL is pulled out with substring(command from …) server-side so the bearer never crosses the wire"
key-files:
  created:
    - scripts/cron-status.mjs
  modified:
    - package.json
    - docs/external-registrations.md
    - docs/vercel-domains-and-protection.md
decisions:
  - "cron:status prints origin+pathname, never the raw command and never a query string — so a ?token= could not leak into an evidence log even if one appeared"
  - "The synthetic inbound row from the ClickSend payload-shape capture is left in place, per the 2026-08-29 precedent: it is the evidence the inbound path works on the new host"
  - "The 4-character token mask the script prints is elided entirely in the committed evidence log"
metrics:
  duration: "~25 min"
  completed: 2026-09-08
actuals:
  tokens: 6400
  tasks: 2
  commits: 2
---

# Phase 08 Plan 05: The URL Switch Summary

Every consumer of `APP_BASE_URL` — the Vercel env in Production and Preview, all four
pg_cron targets, and both ClickSend automation rules — now names
`app.backdesk.com.au`, each proven by a server-side artefact taken before the next step
ran; the old `*.vercel.app` alias is still live and now completely unreferenced.

## What was built

**`scripts/cron-status.mjs` + `npm run cron:status`** — a read-only probe in the
`db-status.mjs` mould. It exists because the Wave-2 proof queries were written as
`psql "$MIGRATE_DATABASE_URL" -c …` one-liners and this workspace denies any command
whose text names an `.env*` file; the connection string lives only there. The script
reads it the way every other script here does (`process.loadEnvFile`) and prints an
answer containing no credential. Four things, in the order that matters when something
is wrong:

1. `local APP_BASE_URL origin:` — what `cron:apply` *would* interpolate. Every
   "the jobs are still on the old origin" incident ends here.
2. `remote_test_lease rows:` and `remote-test-watchdog scheduled:` — Pitfall 4's
   overlap, made visible before `cron:apply` can interleave with a remote test run.
3. One line per job: `jobname schedule active=<t|f> <origin+path>`, plus `MISSING` and
   `DUPLICATED` lines so a mixed state is legible rather than inferred.
4. The last five `net._http_response` rows — the Phase 3 standard, because
   `cron.job_run_details` records a job that got a 401 as "success".

The URL is extracted **in the database** with `substring(command from 'url := ''([^'']+)''')`
so `cron.job.command` — bearer and all — never crosses the wire, and the extracted
value is reduced to `origin + pathname` before printing. It writes nothing;
`cron:apply` remains the only sanctioned writer of `cron.job`.

**The switch itself**, in the D-06 order, stopping at the first failure (none occurred).

## Key implementation details

### The read-back that nearly wasn't: `vercel env ls` lies about freshness

`vercel env ls production` shows a `created` column, and after a successful overwrite it
still read **"10d ago"**. `vercel env add --force` updates the variable in place and
`createdAt` does not move. The timestamp that moves is `updatedAt`, visible only in
`--format json`:

```
{"key":"APP_BASE_URL","type":"encrypted","targets":["production","preview"],
 "createdAt":"2026-08-29T09:07:47.946Z","updatedAt":"2026-09-08T08:40:54.425Z"}
```

`createdAt` is the 2026-08-29 push that fixed the secret drift; `updatedAt` is this run.
A reader checking the table alone would conclude nothing had been pushed. Recorded in
the evidence log so nobody re-learns it.

### cron:status, before and after

Before (`cron:apply` not yet run):

```
local APP_BASE_URL origin: https://app.backdesk.com.au
remote_test_lease rows: 0
remote-test-watchdog scheduled: no

sm8-sync-tick */5 * * * * active=t https://quote-recovery-mvp.vercel.app/api/internal/sync-tick
cadence-tick * * * * * active=t https://quote-recovery-mvp.vercel.app/api/internal/cadence-tick
messaging-reconcile 30 19 * * * active=t https://quote-recovery-mvp.vercel.app/api/internal/messaging-reconcile
stalled-digest 30 22 * * * active=t https://quote-recovery-mvp.vercel.app/api/internal/stalled-digest
```

After:

```
local APP_BASE_URL origin: https://app.backdesk.com.au
remote_test_lease rows: 0
remote-test-watchdog scheduled: no

sm8-sync-tick */5 * * * * active=t https://app.backdesk.com.au/api/internal/sync-tick
cadence-tick * * * * * active=t https://app.backdesk.com.au/api/internal/cadence-tick
messaging-reconcile 30 19 * * * active=t https://app.backdesk.com.au/api/internal/messaging-reconcile
stalled-digest 30 22 * * * active=t https://app.backdesk.com.au/api/internal/stalled-digest
```

Four names, one row each, all active — DOM-02's convergence property, which
`cron:apply` gets by unscheduling by name and re-creating.

### The dispatches — the artefact that outranks the rest

```
200 2026-09-08T08:46:00.119Z
200 2026-09-08T08:45:01.119Z
200 2026-09-08T08:45:00.086Z
200 2026-09-08T08:44:00.081Z
200 2026-09-08T08:43:00.081Z
```

`cron:apply` completed between the 08:43 and 08:44 rows, so **every row from 08:44:00
onward was dispatched at the custom host** and every one is a 200. The extra row at
08:45:01 beside 08:45:00 is the `*/5` sync tick sharing a minute with the per-minute
cadence tick — so **both schedules** are proven on the new origin, not just the noisy one.

### ClickSend, masked

```
2. OK  inbound webhook: 401       OK  dlr webhook: 401       OK  messaging-reconcile: 401
   OK  dlr webhook (REAL token): 200          OK  messaging-reconcile (REAL bearer): 200
3. UPDATED  inbound-to-gateway -> https://app.backdesk.com.au/api/webhooks/clicksend/inbound?token=…
   UPDATED  dlr-to-gateway     -> https://app.backdesk.com.au/api/webhooks/clicksend/dlr?token=…
4. OK  exactly one 'inbound-to-gateway', enabled     OK  exactly one 'dlr-to-gateway', enabled
6. NOT arming the config row — `--activate` was not passed.
7. 200 {"skipped":true,"receiptsApplied":0,"inboundReplayed":0,"optOutsRecorded":0}
```

`UPDATED` rather than `ALREADY CONFIGURED` on both rules is itself the evidence the
addresses changed. Step 2 ran **before** step 3 and fails closed: a 404 there would have
meant the routes are not on the custom domain and the rules would never have been
re-pointed. Three wrong-token 401s plus two real-token 200s prove the routes are deployed
there *and* the deployment's secrets still agree with `.env.local` after today's push.

The script masks each token to four characters; the committed evidence log elides it
entirely. The origin and path are the whole content of the proof.

### The synthetic row, and why it stays

The inbound webhook is the one endpoint with no positive probe that does not write to a
table an operator triages from. Step 5 asked ClickSend to manufacture an inbound message;
it called back and **a row appeared** (`attribution=unmatched is_stop=false`, `raw_payload`
clean). A row can only exist if the callback reached `app.backdesk.com.au`, the token was
accepted, and the zod schema parsed the body — the strongest single artefact in the run,
and a side effect of a step run for another reason.

It is **left in place**, exactly as on 2026-08-29. It will show on the triage screen dated
today as an unattributed message. It is test residue, not a customer.

## Deviations from Plan

### Method substitutions (no rule invoked — the plan's own environment notes anticipated these)

**1. `dig` replaced by Google DNS-over-HTTPS.** The plan's Task 1 precondition is written
as `dig +short CNAME app.backdesk.com.au`. The local resolver in this workspace is a stub
that returns an empty answer for every query, so `dig` proves nothing either way. Both
preconditions were satisfied with `curl -s "https://dns.google/resolve?name=…&type=…"`,
which observes the same public zone from outside it: `CNAME app.backdesk.com.au` →
`956ea6eb7ab36544.vercel-dns-017.com.` (byte-identical to Vercel's issued target) and
`NS backdesk.com.au` → the four Squarespace nameservers. Same substitution the 08-04 entry
records.

**2. The wrong-bearer 401 body is `text/plain`, not JSON.** Task 1's acceptance criterion
said "401 with a JSON body". `src/app/api/internal/cadence-tick/route.ts:88-89` returns
`new Response('unauthorized')` and always has — the criterion carried a planning-time
assumption about a route that predates it. The property that actually matters (Pitfall 6:
*our* 401, not Vercel's HTML SSO wall) is proven by `content-type: text/plain; charset=utf-8`,
body `unauthorized`, and **zero** `_vercel_sso_nonce` cookies.

**3. `vercel env ls production` shows no updated timestamp.** Task 2's acceptance
criterion expected one. See "The read-back that nearly wasn't" above — `updatedAt` in
`--format json` is the field that moves, and it was read. The criterion is met in
substance by a different field than it named.

**4. The evidence log's wrong-bearer probe is written `Bearer <64 zeros>`.** Written
literally, the 64-zero probe token matched the plan's own `Bearer [A-Za-z0-9]` grep — a
false positive on a deliberately-invalid public value, but one that would make a future
reader stop and check. Reworded so the criterion passes cleanly.

### Auto-fixed issues

None. No step failed and no fix was required.

## Deferred Issues

**The no-committed-origin discipline is enforced manually for `cron-status.mjs`, not by a
test.** `tests/cron-schedules.test.ts` contains the `describe('the committed script
itself')` block that strips comments and asserts no `https://` literal — but the file
reads `testEnv.migrateDatabaseUrl` at module scope, so it refuses to load without a local
Supabase stack, and running it against the hosted project needs `npm run test:remote`,
which this plan prohibits (Pitfall 4). The assertion was run by hand instead
(`sed`-strip + `grep -c 'https://'` → **0**) and is recorded in the evidence log. Adding
`cron-status.mjs` to that describe block is worth doing when a plan next has a local stack
available; it was left alone here because the addition could not have been verified.

## Outstanding human-checks (end-of-phase UAT harvest)

Neither blocks the plan; both are recorded per the phase's proof standard.

1. **Task 1, D-11 — the phone check.** On a phone, on mobile data, open
   `https://app.backdesk.com.au/login`. Expected: loads over HTTPS with no certificate
   warning, the heading reads "Backdesk", the tab reads "Sign in · Backdesk", nothing
   redirects. A `curl` 200 does not prove the certificate chain on a handset or the
   rendered heading. Server-side evidence already recorded: `HTTP/2 200`, HSTS
   `max-age=63072000`, and 6 occurrences of "Backdesk" / 0 of "Quote Recovery" in the
   served HTML (08-04).
2. **Task 2 — the synthetic inbound row.** Open the triage inbox at
   `https://app.backdesk.com.au` and confirm exactly one unattributed row dated today with
   ClickSend's sample content. The script already reported `1 new inbound_messages row(s)`
   from the database side; the human-check confirms it renders behind the operator login.
   Decision already taken: **leave it**, per the 2026-08-29 precedent.

## Carried forward to 08-06

- **The old alias is dead weight and may now be released.** Nothing in the env, the
  scheduler or the provider references `quote-recovery-mvp.vercel.app`.
- **Supabase Auth "Site URL"** is a dashboard setting, not readable from this workspace,
  and may still hold the old origin. Email+password login via `@supabase/ssr` does not
  depend on it; password-reset and magic-link emails would. Check it at the rename
  checkpoint.
- **`RESEND_API_KEY` local vs deployed** (opened by 08-04) is still open. Nothing in this
  plan touched Resend, and nothing here depended on that key.

## DOM-01 deliberately left Pending

The plan's frontmatter claims `requirements: [DOM-01]`, but DOM-01 reads: *"The operator
console is served at `https://app.backdesk.com.au` … **and the default `*.vercel.app`
production URL redirects to it**."* The first clause is now true and proven; the second is
08-06's work, and 08-06's frontmatter claims DOM-01 too. `REQUIREMENTS.md` therefore still
reads `Pending` for it — checking it off here would put a half-true claim in the
traceability table, which is the one table that must not need a footnote.

## Prohibitions honoured

| Prohibition | Evidence |
|---|---|
| No project rename, no alias release | `.vercel/project.json` `projectName` still `quote-recovery-mvp`; `curl -sI https://quote-recovery-mvp.vercel.app/login` → `HTTP/2 200` |
| No `--activate` | Step 6 printed "NOT arming the config row"; the `sms` `messaging_config` row is untouched |
| No `cron:apply` during a remote test run; no `npm run test:remote` | `remote_test_lease rows: 0` and `remote-test-watchdog scheduled: no` immediately before **and** after `cron:apply`; `test:remote` never invoked |
| Nothing from 08-06 executed | No rename, no redirect, no Deployment Protection change; `vercel.json` unchanged (`git diff --quiet` clean) |
| No secret printed | `grep -nE 'Bearer [A-Za-z0-9]\|token=[A-Za-z0-9]{8,}' docs/external-registrations.md` → no matches |

## Verification

| Check | Result |
|---|---|
| `cron:status` job lines at `https://app.backdesk.com.au/api/internal/` | **4** |
| `cron:status` `active=t` count | **4** |
| `net._http_response` 200 after `cron:apply` | 4 consecutive post-switch 200s, both tick schedules |
| `cron:status` lease rows | **0**, before and after |
| `curl -sI https://app.backdesk.com.au/login` | `HTTP/2 200` |
| Wrong-bearer POST to `/api/internal/cadence-tick` | `401`, our own `text/plain` body, no SSO nonce |
| `cron-status.mjs` comment-stripped `grep -c 'https://'` | **0** |
| `grep -c '"cron:status": "node scripts/cron-status.mjs"' package.json` | **1** |
| `npm run lint` | exit 0 |
| `npm test` (pure suites, no `ALLOW_REMOTE_TESTS`) | 2468 tests passed / 75 files; 39 integration files refused to load for want of a local Supabase stack — pre-existing environmental condition, unrelated to this plan, and the guard that prevents an accidental hosted-DB run |
| `git diff --quiet -- vercel.json` | clean |
| `grep -c 'URL switch' docs/external-registrations.md` | **1** |

## Self-Check: PASSED

All four files exist on disk; both commits (`8e16ac6`, `6f04b20`) resolve in `git log`.
