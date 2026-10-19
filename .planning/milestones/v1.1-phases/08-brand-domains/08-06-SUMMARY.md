---
phase: 08-brand-domains
plan: 06
subsystem: infra
tags: [vercel, dns, deployment-protection, redirect, rename, pg_cron, one-way]

requires:
  - phase: 08-brand-domains (08-04)
    provides: app.backdesk.com.au attached to the project, CNAME published, TLS certificate issued
  - phase: 08-brand-domains (08-05)
    provides: every consumer of APP_BASE_URL re-pointed at the custom domain and server-side-proven, so the old alias was dead weight before it was touched
provides:
  - Vercel project renamed quote-recovery-mvp -> backdesk (project ID unchanged)
  - .vercel/project.json refreshed; supabase/config.toml and scripts/push-vercel-env.mjs relabelled
  - 308 redirect to https://app.backdesk.com.au on ALL FIVE *.vercel.app production aliases
  - Vercel Authentication at Standard Protection (prod_deployment_urls_and_all_previews), measured
  - the pre-existing Protection Bypass for Automation secret removed (key count 1 -> 0)
  - docs/vercel-domains-and-protection.md sections 5-8 filled with measured values
  - the measured correction to research 2(b): Standard Protection walls deployment URLs, not production-branch aliases
affects: [08-07, phase-09-landing-page, any future vercel env push, any future project rename]

actuals:
  tokens: 46000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Register a Vercel-generated alias as a project domain (POST /v10/projects/{id}/domains) to make it eligible for a redirect"
    - "Read a secret from an API response and pipe it straight into the revoke call — never through a variable that gets echoed"

key-files:
  created: []
  modified:
    - supabase/config.toml
    - scripts/push-vercel-env.mjs
    - docs/vercel-domains-and-protection.md
    - docs/external-registrations.md

key-decisions:
  - "Operator answered the Task 1 checkpoint `release-now, phone check done` — all five 08-05 proofs confirmed and the outstanding handset check closed on 2026-09-08"
  - "The rename released nothing: generated aliases belong to a deployment, not a project name, so a rename with no deployment behind it leaves every old host live and mints no new one. A production redeploy minted backdesk-hesams-projects-432a48c6.vercel.app"
  - "The three surviving old-brand hosts were RETAINED and REDIRECTED rather than deleted — a name we still own cannot be claimed by a stranger and pointed at the brand (T-8-02), and stale links land on the console instead of a 404. Deletion is the irreversible direction and was not taken by default"
  - "Standard Protection on Hobby walls DEPLOYMENT URLs, not production-branch aliases: the -git-main- alias measured plain 200, contradicting the July-2025 changelog. That host was given the same 308 redirect, reaching DOM-02's intent through the redirect rather than the auth wall"
  - "The bypass secret was REMOVED, not regenerated — nothing in this system would use one"

patterns-established:
  - "Pattern: after any Vercel rename, deploy first, then read targets.production.alias back, then configure — the alias does not exist until a deployment carries it"
  - "Pattern: prove a protection scope by what it walls (a deployment URL) AND what it does not (a production alias), not by the setting's name"

requirements-completed: [DOM-01, DOM-02]

coverage:
  - id: D1
    description: "The Vercel project is named backdesk; the link file and the two local labels agree; the old name no longer resolves"
    requirement: DOM-01
    verification:
      - kind: integration
        ref: "vercel project inspect backdesk && node -p require('./.vercel/project.json').projectName && grep -q '^project_id = \"backdesk\"$' supabase/config.toml && grep -c 'quote-recovery-mvp' supabase/config.toml scripts/push-vercel-env.mjs == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every *.vercel.app production alias 308-redirects to https://app.backdesk.com.au with the path preserved, configured as a Vercel domain setting with no change to next.config.ts or proxy.ts"
    requirement: DOM-01
    verification:
      - kind: e2e
        ref: "curl -sI https://backdesk-hesams-projects-432a48c6.vercel.app/login -> HTTP/2 308, location: https://app.backdesk.com.au/login (and the same on four sibling aliases)"
        status: pass
      - kind: integration
        ref: "git diff --quiet -- next.config.ts proxy.ts && grep -q '\"syd1\"' vercel.json"
        status: pass
    human_judgment: false
  - id: D3
    description: "Vercel Authentication at Standard Protection walls preview/deployment URLs while the custom domain, the public unsubscribe endpoint and the four pg_cron ticks stay working"
    requirement: DOM-02
    verification:
      - kind: e2e
        ref: "curl -sI https://backdesk-iml7gpv1t-hesams-projects-432a48c6.vercel.app/login -> 302 vercel.com/sso-api + _vercel_sso_nonce"
        status: pass
      - kind: e2e
        ref: "curl -sI https://app.backdesk.com.au/login -> 200 ; /api/unsubscribe -> 200 ; wrong-bearer POST /api/internal/cadence-tick -> our own text/plain 401, no SSO cookie"
        status: pass
      - kind: integration
        ref: "npm run cron:status -> four jobs active=t, net._http_response 200 at 09:34/09:35/09:35/09:36/09:37Z (four rows after the change, both tick schedules)"
        status: pass
      - kind: integration
        ref: "GET /v9/projects/backdesk -> ssoProtection.deploymentType == prod_deployment_urls_and_all_previews (not 'all')"
        status: pass
    human_judgment: false
  - id: D4
    description: "The pre-existing Protection Bypass for Automation secret is revoked and documented as unused"
    requirement: DOM-02
    verification:
      - kind: integration
        ref: "GET /v9/projects/backdesk -> protectionBypass key count 1 -> 0 after PATCH /v1/projects/backdesk/protection-bypass"
        status: pass
    human_judgment: false
  - id: D5
    description: "Supabase Auth URL Configuration (Site URL + redirect allow-list) does not name the released host"
    verification: []
    human_judgment: true
    rationale: "Dashboard-only setting (research A7): not readable from the repo, the Supabase CLI or this workspace. Carried forward from 08-05 and still open."

duration: 62min
completed: 2026-09-08
status: complete
---

# Phase 8 Plan 06: Rename, Redirect and Deployment Protection Summary

**The project is `backdesk`, all five `*.vercel.app` production aliases 308 to `https://app.backdesk.com.au`, preview and deployment URLs are behind the Vercel login wall, and the stray automation-bypass key is gone — with every one of those claims a recorded `curl` or API read-back rather than a setting name.**

## Performance

- **Duration:** ~62 min
- **Started:** 2026-09-08T09:19:00Z (precondition `cron:status`)
- **Completed:** 2026-09-08T10:21:00Z
- **Tasks:** 3 (1 checkpoint resolved + 2 executed)
- **Files modified:** 4

## Accomplishments

- **The one-way door is walked.** `vercel project rename quote-recovery-mvp backdesk` succeeded; the project **ID is byte-identical** (`prj_XXXXXXXX`), which is why the custom domain, the Git integration and the link file survived untouched. The old name no longer resolves.
- **DOM-01 is complete and measured.** The new default alias `backdesk-hesams-projects-432a48c6.vercel.app` returns `HTTP/2 308` with `location: https://app.backdesk.com.au/login` — path preserved, no auth wall in front of it. Four sibling aliases got the same treatment. `next.config.ts` and `proxy.ts` were never opened, so the custom domain still serves with zero redirect hops.
- **DOM-02 is complete and measured, including where it does not do what the docs say.** Standard Protection is on and read back as `prod_deployment_urls_and_all_previews` (never `all`, the scope that would have repeated the Phase 2 failure). Deployment URLs now `302` to `vercel.com/sso-api` with a `_vercel_sso_nonce`. The custom domain, the public unsubscribe endpoint and all four pg_cron ticks were unaffected — **four `net._http_response` 200s landed after the change**, covering both the per-minute and five-minute schedules.
- **The bypass secret is gone**, not rotated: `protectionBypass` went from one key (scope `automation-bypass`, created 2026-09-06) to zero. No value of it was printed, logged, written to a file or carried into a commit.
- **Two research claims were corrected by measurement** rather than papered over — see Deviations.

## Task Commits

1. **Task 1: Release the old default alias now?** — resolved at the checkpoint, no commit (recorded as evidence inside the Task 2 commit)
2. **Task 2: Rename, refresh the link, relabel local config** — `99a48f9` (chore)
3. **Task 3: Redirect, Standard Protection, bypass revocation, measurement** — `491835f` (feat)

## Files Created/Modified

- `supabase/config.toml` — `project_id = "backdesk"` (a label for local Supabase CLI state only; no migration, no remote change)
- `scripts/push-vercel-env.mjs` — usage example and the `fail()` message now name `--project backdesk` and the custom domain. Comments and one error string; behaviour unchanged. Every future `npm run env:push` must pass `--project backdesk` — the old name no longer resolves, so a stale invocation fails loudly instead of pushing somewhere wrong.
- `docs/vercel-domains-and-protection.md` — sections 5, 6, 7 filled with measured values; a new host-by-host table; two findings written up; section 8 proof index extended
- `docs/external-registrations.md` — two dated evidence entries (rename; redirect + protection + revocation)

## Decisions Made

**The Task 1 checkpoint, verbatim: `release-now, phone check done`.** All five 08-05 proofs were re-confirmed at the gate (four active cron jobs on the custom-domain origin with five consecutive 200s and zero lease rows; `APP_BASE_URL` Production `updatedAt` 2026-09-08T08:40:54.425Z; the ClickSend rule read-back; the URL-switch evidence entry) and the operator closed the last one by opening `https://app.backdesk.com.au/login` **on a phone on 2026-09-08** — no certificate warning, heading `Backdesk`.

**Retain-and-redirect over release.** The three surviving old-brand hosts could have been deleted — `release-now` authorised exactly that. They were kept and redirected instead. A name we still own cannot be claimed by a stranger and pointed at the brand (threat T-8-02), and every stale external link lands on the console rather than a 404. This is *more* conservative than what the operator authorised, introduces no new risk, and deletion stays available at any time. It is the irreversible direction, so it was not taken by default.

**Redirect where the auth wall would not reach.** When the `-git-main-` alias turned out to be public, the choice was between accepting an unbranded host serving the console and giving it the same 308 as its siblings. The redirect was chosen: it reaches DOM-02's actual intent using the mechanism the plan already sanctioned, and specifically **not** the host-conditional redirect in `next.config.ts`/`proxy.ts` that the plan prohibits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The rename released nothing and minted nothing — a redeploy was required before the plan could continue**

- **Found during:** Task 2, immediately after the rename
- **Issue:** The plan's next step was "read the NEW default alias back". There was none. `targets.production.alias` still listed all four *old* hosts, and both `backdesk-…vercel.app` names answered **404**. Generated aliases are assigned to a *deployment*, not to a project name, so a rename with no deployment behind it changes nothing observable. Task 3 had no target to configure.
- **Fix:** Issued `vercel redeploy` of the current production deployment, which minted `backdesk-hesams-projects-432a48c6.vercel.app` and `backdesk-git-main-hesams-projects-432a48c6.vercel.app` (both then 200). Research A2's guessed suffix shape turned out to be the **team slug**, not a random string — read back, never assumed, exactly as the plan insisted.
- **Files modified:** none (platform state)
- **Verification:** `GET /v9/projects/backdesk` `targets.production.alias` read back after the redeploy; both hosts curl-probed
- **Committed in:** `99a48f9` (documented in the Task 2 evidence entry)

**2. [Rule 3 - Blocking] A generated alias cannot take a redirect until it is registered as a project domain**

- **Found during:** Task 3, step 1
- **Issue:** `PATCH /v9/projects/backdesk/domains/backdesk-hesams-projects-432a48c6.vercel.app` answered `Project Domain not found. (404)`. The plan assumed the new default alias would appear in the project-domains list the way `quote-recovery-mvp.vercel.app` does. It does not — it is a generated alias, and only *registered* domains carry redirect settings.
- **Fix:** `POST /v10/projects/backdesk/domains` accepts the alias; it registers as a project domain (`verified: true`, same `projectId`) and then takes `redirect` + `redirectStatusCode` normally. This is now the documented mechanism in the DOM reference.
- **Files modified:** `docs/vercel-domains-and-protection.md`
- **Verification:** `curl -sI …/login` → `HTTP/2 308`, `location: https://app.backdesk.com.au/login`
- **Committed in:** `491835f`

**3. [Rule 2 - Missing Critical] Standard Protection does not wall the production-branch alias — it was redirected instead**

- **Found during:** Task 3, step 4 (the measurement the plan demanded)
- **Issue:** With Standard Protection confirmed on, `curl -sI https://backdesk-git-main-hesams-projects-432a48c6.vercel.app/login` returned **`HTTP/2 200`**, not the `401` + `_vercel_sso_nonce` the plan and research §2(b) predicted. `x-vercel-cache: MISS` on a fresh origin hit, identical with a cache-busting query string — not a stale edge response. The July-2025 changelog line ("Standard Protection also covers all automatically generated domains, including the production branch git domain") did not hold on this project. What Vercel actually enforces on Hobby is the plain-English Hobby sentence: **deployment** URLs are walled; anything aliasing the **production** deployment stays public. Left alone, an unbranded `*.vercel.app` host would keep serving the console.
- **Fix:** Registered the `-git-main-` alias (and the two surviving old-brand generated aliases, and the old default project domain) as project domains and gave each the same **308 → `https://app.backdesk.com.au`**. DOM-02's intent — no non-Backdesk host serving this console — is reached by redirect where the auth wall cannot reach. The plan's prohibition against a host-conditional redirect in `next.config.ts`/`proxy.ts` was honoured; both files are byte-unchanged.
- **Files modified:** `docs/vercel-domains-and-protection.md`, `docs/external-registrations.md`
- **Verification:** all five aliases curl-measured at `308` with the correct `location`; a deployment URL measured at `302` + `_vercel_sso_nonce` to prove the wall genuinely exists; `app.backdesk.com.au/login` and `/api/unsubscribe` both still `200`
- **Committed in:** `491835f`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing critical)
**Impact on plan:** No scope creep. Two of the three were forced by platform behaviour the research had guessed wrong; the third converted a failed prediction into a delivered outcome using a mechanism the plan already sanctioned. Every correction is written into `docs/vercel-domains-and-protection.md` so the next person reads the measurement, not the guess.

## Issues Encountered

**Research A1 is TRUE as asked, but its surrounding claim was half wrong.** The MEDIUM-confidence question was "does the protected default alias still redirect before the auth wall?" — measured **yes**: `308`, no login, for an anonymous visitor with protection on. The part of §2(b) that failed was its prediction that the *other* generated aliases would be walled. The prepared fallback ("generated URLs are private by design") was never needed; the surprise ran the opposite way, and the honest answer is now in the §6 Measured column rather than the documented one.

**The wrong-bearer probe returns `text/plain`, not JSON.** The plan's acceptance criterion said "401 with a JSON body". The route has always answered `content-type: text/plain; charset=utf-8`, body `unauthorized` — as the 08-05 entry also recorded. The body shape was never the point of that probe; the absence of `_vercel_sso_nonce` is, and it is absent. Recorded as measured rather than adjusted to match the plan.

**The plan's automated verify string does not pass as written**, and should not: it asserts `curl -sI "https://$GIT_MAIN_ALIAS/login" | grep -q ' 401'`. That host measures `308`. Every other clause passes (custom domain 200, unsubscribe 200, wrong-bearer 401, `syd1` present, `next.config.ts`/`proxy.ts` unchanged, no fill markers left, `npm run lint` clean). The failing clause encodes the prediction that deviation 3 disproved.

## User Setup Required

**One operator check is still open**, carried forward from 08-05:

**Supabase → Authentication → URL Configuration.** Site URL and every Redirect URL must name `https://app.backdesk.com.au` or be the local defaults — none may name `quote-recovery-mvp.vercel.app`. This is dashboard-only (research A7): not readable from the repo, the Supabase CLI or this workspace. Consequence if stale: a password-reset or confirmation link points at an old host. Now that every old host 308s to the custom domain, that degrades to an extra redirect hop rather than a dead link — but it should still be corrected.

## Next Phase Readiness

- **DOM-01 and DOM-02 are complete** and marked so in REQUIREMENTS.md; both are backed by curl measurements in `docs/external-registrations.md`, not by settings names.
- **08-07 is unblocked.** It reads the Resend `VERIFIED_STATUS` gate and pushes `OPERATOR_ALERT_FROM`. Two things it must carry forward: every `npm run env:push` now needs `--project backdesk`, and the `RESEND_API_KEY` drift flagged on 2026-09-08 (`.env.local` may hold the old sending-only key while the deployment holds the Full access one) is still open.
- **Phase 9 (landing page, apex `backdesk.com.au`)** inherits two lessons from this plan: certificate issuance does not follow verification automatically (08-04's trap), and generated aliases do not move until a deployment moves them.

---
*Phase: 08-brand-domains*
*Completed: 2026-09-08*

## Self-Check: PASSED

All modified files exist on disk; both task commits (`99a48f9`, `491835f`) are present in `git log`.
