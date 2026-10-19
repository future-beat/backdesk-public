---
phase: 09-landing-page-audit-intake
plan: 04
subsystem: infra
tags: [nextjs, proxy, middleware, routing, host-aware, supabase-ssr, vercel]

requires:
  - phase: 09-01
    provides: the single-string matcher with the marketing exclusions already added
  - phase: 04
    provides: proxy.ts, updateSession and the console's session gate
provides:
  - host-aware request classification: apex/www/apex.localhost serve the public site, every other host reaches the session gate
  - the console's client list at a real route (/clients), with app-host / rewritten to it
  - updateSession(request, { rewriteTo }) — a rewrite that survives the Supabase cookie rebuild
  - src/app/not-found.tsx, one branded 404 for both halves of the site
  - THE PROXY ACTUALLY RUNNING for the first time (it was at the wrong path since Phase 4)
affects: [09-05, 09-06, 09-07, 09-08, any plan touching routing, auth or the console's URLs]

actuals:
  tokens: 46876
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Host classification from the `host` header, never nextUrl.hostname"
    - "Rewrite-not-redirect for public-host console paths (no crawler-visible chain)"
    - "File-location assertions for framework-convention files"

key-files:
  created:
    - src/proxy.ts
    - src/app/not-found.tsx
  modified:
    - src/lib/supabase/proxy.ts
    - src/app/(console)/clients/page.tsx
    - src/app/(console)/clients/new/actions.ts
    - src/app/(console)/audits/[id]/actions.ts
    - tests/proxy-host-routing.test.ts

key-decisions:
  - "Checkpoint Task 1 answered `move-to-clients` by the operator on 2026-09-09: the console's client list moves to /clients and the proxy rewrites app-host / to it, freeing the real / for the landing page"
  - "The local marketing stand-in is `apex.localhost`, not `127.0.0.1`: NextURL collapses every loopback literal to `localhost`, making the planned value indistinguishable from the console host"
  - "Host classification reads the `host` header (port stripped, case folded) rather than nextUrl.hostname, which is the address the server is bound to"
  - "proxy.ts moved to src/proxy.ts — Next resolves it beside `app`, so the root file written in Phase 4 was never compiled"

patterns-established:
  - "Framework-convention files get a location test: source-reading tests cannot tell a correct file from an unloaded one"
  - "A response built twice (initial + inside Supabase's setAll) must be built from one shared target, asserted structurally"

requirements-completed: [LAND-01]

coverage:
  - id: D1
    description: "On the apex, www and the local stand-in, GET / is served with no Supabase call and every console path is rewritten to a 404 rather than redirected to the app host"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/proxy-host-routing.test.ts#the public hosts serve the landing page and 404 everything else (D-02)"
        status: pass
      - kind: e2e
        ref: "curl -H 'Host: backdesk.com.au' https://app.backdesk.com.au/inbox -> 404 (production, 2026-09-09)"
        status: pass
    human_judgment: false
  - id: D2
    description: "On the console hosts / still shows the operator's client list, rewritten to /clients after the session check, and signed-out / still redirects to /login"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/proxy-host-routing.test.ts#the console hosts keep their session gate (D-02)"
        status: pass
      - kind: e2e
        ref: "curl -sI https://app.backdesk.com.au/ -> 307 https://app.backdesk.com.au/login (production, signed out)"
        status: pass
    human_judgment: true
    rationale: "The signed-out half is proven by curl, but nobody has yet opened / with a live session and seen the client list render. That is the plan's own <human-check> and the one thing no automated check here covers."
  - id: D3
    description: "The matcher stays one string, still excludes the marketing paths and the API routes, and still gates /audits"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/proxy-host-routing.test.ts#the matcher is still one string (Pitfall 2)"
        status: pass
      - kind: unit
        ref: "tests/proxy-host-routing.test.ts#Next's own matcher engine agrees with the regex reading"
        status: pass
      - kind: e2e
        ref: "POST https://app.backdesk.com.au/api/internal/sync-tick -> 401 (its own credential, not a proxy 307)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The client list moved to /clients with both revalidatePath callers and the post-create redirect updated"
    requirement: LAND-01
    verification:
      - kind: unit
        ref: "tests/console-error-leak.test.ts#raw database errors never reach a rendered surface (WR-08)"
        status: pass
      - kind: other
        ref: "grep -rn \"revalidatePath('/')\" src/app -> 0 hits"
        status: pass
    human_judgment: true
    rationale: "Creating a client and seeing the list refresh with it is a round trip through a real session and a real write; no test here exercises it."
  - id: D5
    description: "The proxy is at src/proxy.ts and is actually compiled into the deployment"
    verification:
      - kind: unit
        ref: "tests/proxy-host-routing.test.ts#the proxy is where Next actually looks for it"
        status: pass
      - kind: e2e
        ref: "next build prints 'ƒ Proxy (Middleware)'; local production build: apex.localhost/inbox -> 404, localhost/ -> 307 /login"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-09-09
status: complete
---

# Phase 09 Plan 04: Host-Aware Routing Summary

**The proxy now classifies by host — public site on the apex, session gate everywhere else — and the console's client list moved to `/clients` with app-host `/` rewritten to it; along the way the proxy was discovered to have never run at all and was moved to where Next looks for it.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-09-09T12:10Z
- **Completed:** 2026-09-09T12:50Z
- **Tasks:** 2 (1 checkpoint, 1 implementation)
- **Files modified:** 17

## Accomplishments

- **D-02 delivered.** `src/proxy.ts` splits on the request host: the apex, `www` and the local stand-in serve `/` with no Supabase call and answer 404 for every console path; everything else (app host, localhost, preview URLs) reaches the session gate as before.
- **The `/` route is free for 09-05.** The client list lives at `/clients`; the app host's `/` is rewritten to it, so the operator's bookmark, the nav brand link and the post-login redirect are unchanged.
- **`updateSession` gained `{ rewriteTo }`**, building the rewrite in both places it builds a response so rotated session cookies survive it (T-9-24).
- **One branded 404** at `src/app/not-found.tsx`, serving both halves of the site — no host logic, no data, `noindex`.
- **The proxy runs for the first time.** It has been at the repo root since Phase 4, which is not where Next looks; the build emitted an empty middleware manifest and every request bypassed it.

## Task Commits

1. **Task 1: checkpoint:decision — move the console root to /clients** — answered `move-to-clients` by the operator on 2026-09-09; no commit of its own, implemented in Task 2.
2. **Task 2 (RED): failing host-routing and moved-page pins** — `20b9e4f` (test)
3. **Task 2 (GREEN): host-aware proxy, moved client list, not-found page** — `271924d` (feat)
4. **Task 2 (fix): proxy relocated to src/, host read from the header** — `cbf8c54` (fix)

## Files Created/Modified

- `src/proxy.ts` — host classification, the 404 rewrite, and the matcher (moved from the repo root, where it was inert)
- `src/lib/supabase/proxy.ts` — `updateSession(request, { rewriteTo })`; the rewrite is rebuilt inside `setAll` from the same target
- `src/app/(console)/clients/page.tsx` — the client list, moved from `(console)/page.tsx`, plus a `metadata` title
- `src/app/not-found.tsx` — the branded, data-free, `noindex` 404
- `src/app/(console)/clients/new/actions.ts`, `src/app/(console)/audits/[id]/actions.ts` — `revalidatePath('/clients')` and the post-create redirect
- `tests/proxy-host-routing.test.ts` — the host half of D-02, the file-location pin, and the NextURL-normalisation pin (44 tests)
- Seven route suites repointed at `src/proxy.ts`; `tests/console-error-leak.test.ts`, `tests/rekey-resume.test.ts`, `tests/stall-tick.test.ts` repointed at the moved page

## Decisions Made

- **Task 1 checkpoint: `move-to-clients`** (operator, 2026-09-09). The alternative — two root layouts with a host rewrite in `next.config.ts` — needs the experimental `global-not-found` and forces full reloads between route groups.
- **`apex.localhost` as the local marketing stand-in.** See deviation 1.
- **Classify on the `host` header.** See deviation 2.
- **`revalidatePath('/clients')`, not `'/'`.** `revalidatePath` names the real route; the proxy's rewrite is a per-request decision, so invalidating `/` would clear the landing page's entry instead of the operator's list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `127.0.0.1` cannot be a marketing host**

- **Found during:** Task 2, first run of the host suite
- **Issue:** RESEARCH §1 and the plan both put `'127.0.0.1'` in `MARKETING_HOSTS`. `NextURL` normalises every loopback literal (`127.x.x.x`, `[::1]`) to `localhost` before the proxy sees it, so the stand-in is byte-identical to the console's own local host. Whichever branch won, one of the two would have been broken locally.
- **Fix:** `apex.localhost` — a `.localhost` subdomain resolves to loopback with no `/etc/hosts` entry (RFC 6761; confirmed resolving on this machine) and survives the normalisation.
- **Files modified:** `src/proxy.ts`, `tests/proxy-host-routing.test.ts`
- **Verification:** `tests/proxy-host-routing.test.ts#the local stand-in survives NextURL normalisation` pins both halves — the collapse and the survival — because the wrong address is written down in two planning documents.
- **Committed in:** `271924d`

**2. [Rule 1 - Bug] The host must come from the header, not `nextUrl.hostname`**

- **Found during:** Task 2, probing a local production build
- **Issue:** The plan (and RESEARCH §1) read `request.nextUrl.hostname`. That is the hostname of the URL Next built for the request, which under a real server is the address it is **bound** to — so every host on the machine read back as `localhost` and the marketing branch was unreachable. Measured: `apex.localhost:3100/inbox` answered 307-to-login instead of 404.
- **Fix:** `requestHostname()` reads the `host` header, strips the port and lower-cases it, falling back to `nextUrl.hostname` for a synthesised request with no header. This is what Next's own `getHostname` does.
- **Files modified:** `src/proxy.ts`, `tests/proxy-host-routing.test.ts`
- **Verification:** three new cases (header beats URL, port/case ignored, URL fallback); confirmed in production with `curl -H 'Host: backdesk.com.au' https://app.backdesk.com.au/inbox` → 404.
- **Committed in:** `cbf8c54`

**3. [Rule 1 - Bug] The proxy has never run — wrong path since Phase 4**

- **Found during:** Task 2, post-deploy verification
- **Issue:** `proxy.ts` was at the repo root. Next's `getPossibleMiddlewareFilenames` searches the directory that **contains `app`** — `src/` in this project — so the file was never compiled: the build emitted `middleware: {}` and every request went straight to its route. Seven suites read the file's source and asserted its matcher was correct; none could tell the file was inert. It went unnoticed because the real gates were always `getClaims()` in the console layout and `requireOperator()` in each action, which is also why nothing was exposed while it lay dormant.
- **Impact this plan:** it turned latent into live. With the client list moved to `/clients` and no proxy to rewrite `/`, `https://app.backdesk.com.au/` answered **404** — the bookmark, the brand link and the post-login redirect all landed on it. That state was briefly deployed between the two pushes.
- **Fix:** `git mv proxy.ts src/proxy.ts`; seven suites repointed. `next build` now prints `ƒ Proxy (Middleware)`.
- **Verification:** a local production build before and after, probing every branch (below); then the production curls.
- **Committed in:** `cbf8c54`

**4. [Rule 3 - Blocking] `unstable_doesProxyMatch` does not exist**

- **Found during:** Task 2, writing the RED test
- **Issue:** The plan named `unstable_doesProxyMatch`. Next 16.3.2 still exports the helper under its middleware name.
- **Fix:** `unstable_doesMiddlewareMatch`, noted at the import.
- **Committed in:** `20b9e4f`

**5. [Rule 3 - Blocking] Two remote-guarded suites read the old page path**

- **Found during:** Task 2, after the `git mv`
- **Issue:** `tests/rekey-resume.test.ts` and `tests/stall-tick.test.ts` `readFileSync` the moved page. Both are remote-guarded, so they fail at import locally and would only have broken on the next sanctioned remote run.
- **Fix:** repointed at `src/app/(console)/clients/page.tsx`.
- **Committed in:** `271924d`

---

**Total deviations:** 5 auto-fixed (3 bugs, 2 blocking)
**Impact on plan:** No scope creep — every fix was needed for the plan's own must-haves to be true. Deviation 3 is the significant one: it is a pre-existing Phase 4 defect, not caused by this plan, but this plan is what made it load-bearing, and leaving it would have meant shipping a 404 at the console's front door.

## Issues Encountered

- **A 404 at `app.backdesk.com.au/` was briefly live** between the two pushes (commit `271924d` deployed, `cbf8c54` fixed it ~15 minutes later). Signed-in operators visiting `/` in that window would have seen the branded 404; `/clients`, `/inbox` and every other page were unaffected.
- The 40 remote-guarded integration suites fail at import without `ALLOW_REMOTE_TESTS`, exactly as they did before this plan (baseline 40 failed / 85 passed; after: identical, with 2741 tests passing vs 2736 — the five new ones).

## Verification Record

**Local production build** (`next build && next start -p 3100`), after the fix:

| Request | Result |
|---|---|
| `localhost/` (signed out) | 307 → `/login` |
| `localhost/inbox` | 307 → `/login` |
| `localhost/audit`, `localhost/login` | 200 |
| `apex.localhost/` | 404 (landing page arrives in 09-05) |
| `apex.localhost/inbox`, `/clients/new` | 404, branded not-found page |
| `apex.localhost/audit`, `/brand/favicon.svg` | 200 |
| `POST /api/internal/sync-tick`, `/api/internal/cadence-tick` | 401 — their own credential, not a proxy 307 (Pitfall 7) |

**Production** (deployment `backdesk-4wgpcqi1l`, READY, 2026-09-09):

| Request | Result |
|---|---|
| `https://app.backdesk.com.au/` signed out | **307 → `/login`** |
| `https://app.backdesk.com.au/clients` signed out | 307 → `/login` |
| `https://app.backdesk.com.au/audit` | 200 |
| `https://app.backdesk.com.au/brand/favicon.svg` | 200 |
| `https://app.backdesk.com.au/login` | 200 |
| `curl -H 'Host: backdesk.com.au' …/inbox` | 404 |
| `POST …/api/internal/sync-tick` unauth | 401 |

**Assumption A1 resolved:** `NextResponse.rewrite(url, { status: 404 })` does return a measured 404 — confirmed on both the local production build and production. 09-08 need not re-derive it, though the apex curl there is still worth recording once the domain is attached.

Gates: `npm run typecheck`, `npm run lint`, `npx next build` all clean; `npx vitest run` → 2741 passed, no new failures.

## Known Stubs

None.

## User Setup Required

None for this plan.

## Next Phase Readiness

- **09-05 (landing page) is unblocked:** `/` resolves to no route today, so `(marketing)/page.tsx` can claim it with no collision. The build confirms it.
- **09-07 (domain attach)** should re-run the apex curls once `backdesk.com.au` is attached; the classification is already proven through the `Host` header against the app host.
- **09-08 (Lighthouse)** must audit `http://apex.localhost:3000/`, **not** `http://127.0.0.1:3000/` — the research doc's address does not reach the marketing branch. Retain the honest labelling of local scores as indicative.
- **Carry-over for the operator's attention:** the proxy is newly live across the whole app. Every console page request now costs a `getClaims()` call in the proxy in addition to the layout's. That is the design, but it is new load on Supabase auth as of today and worth a glance at the auth request rate.
- **Open human check (D2/D4):** open `https://app.backdesk.com.au/` signed in and confirm the client list renders and the URL bar still reads `/`; then create a test client and confirm the list refreshes.

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-09*

## Self-Check: PASSED

All created/modified files verified present on disk (`src/proxy.ts`, `src/app/not-found.tsx`,
`src/app/(console)/clients/page.tsx`, `src/lib/supabase/proxy.ts`, `tests/proxy-host-routing.test.ts`);
both removed paths confirmed gone (`src/app/(console)/page.tsx`, root `proxy.ts`); all three
commits (`20b9e4f`, `271924d`, `cbf8c54`) present in git history and pushed to origin/main.
