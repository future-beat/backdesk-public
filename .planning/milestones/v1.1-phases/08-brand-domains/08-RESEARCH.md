# Phase 8: Brand & Domains - Research

**Researched:** 2026-09-06
**Domain:** Rebrand (string swap + brand module), Vercel custom domain / project rename / Deployment Protection, Resend sending-domain verification, operational URL switch of pg_cron + ClickSend targets, commercial-assumption sign-off
**Confidence:** HIGH on the codebase inventory and the live Vercel/DNS state (read this session); MEDIUM on Vercel/Resend platform behaviour (official docs, fetched 2026-09-06, no Context7 available); one hard environment blocker found (DNS delegation)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Brand source of truth
- **D-01:** One brand module (suggested `src/core/brand.ts`) exports the service name `Backdesk`, the identity-line builder ("Sent by Backdesk on behalf of {business}."), the `via` display-name builder (`"{business} via Backdesk"`), the operator-alert from-name, the console meta description, and the public domains (`backdesk.com.au`, `app.backdesk.com.au`, `quotes.backdesk.com.au`). Every rendered surface imports from it; no literal "Quote Recovery" / "quote-recovery" string may remain in `src/` except the npm package name. Known literals today: `src/app/layout.tsx` (title default + template + description), `src/app/(console)/layout.tsx:102` (nav wordmark), `src/app/login/page.tsx:22` (h1), `src/app/(console)/audits/[id]/page.tsx:20` (`SERVICE_NAME`), `src/app/(console)/reports/[client]/[reportId]/page.tsx:31` (`SERVICE_NAME`), `src/app/api/unsubscribe/route.ts:94`, `src/core/messaging/resend-sender.ts:224-230` (identity line + from display name), `src/core/alerts/operator-email.ts:47` and `src/core/alerts/stalled-drafts.ts:49` (`DEFAULT_ALERT_FROM`), `src/core/messaging/clicksend-client.ts:57` (`SOURCE = 'quote-recovery'` → `'backdesk'`).
- **D-02:** Sender identification (Spam Act) keeps the v1.0 shape and only swaps the service name: email `From` display name `"{business} via Backdesk"`, the identity line in the body, the unsubscribe footer; SMS copy already names the tradie and never named the service — verify no template or drafting prompt mentions "Quote Recovery". STOP and RFC 8058 one-click unsubscribe paths are untouched and must stay green in the existing tests.
- **D-03:** Operator alert emails move to `Backdesk <alerts@quotes.backdesk.com.au>` once the domain is verified; until then the existing `onboarding@resend.dev` fallback stays, with only the display name changed. Alert-from must come from env/config (`ALERT_FROM` or equivalent), defaulting to the brand module value, not a hardcoded literal in two files.

### Visual identity (deliberately deferred)
- **D-04:** No UI-SPEC and no restyle in this phase. The wordmark, colour and type spec is the Cowork thread's M1 deliverable (`docs/gtm/backdesk-launch-plan.md` §3.1) and will arrive as a build request under `docs/gtm/requests/`; applying it is a follow-up quick task or part of Phase 9. Phase 8 changes strings and configuration only, keeping the current print-styled A4 audit/report layouts and console styling intact. The plan-phase UI gate was skipped on this basis (recorded here so verify-phase sees it).

### Domains and the URL switch
- **D-05:** Domains registered under the founder's ABN: `backdesk.com.au`, `backdesk.au`. Phase 8 attaches **only** `app.backdesk.com.au` to the Vercel project (console). The apex is reserved for Phase 9's landing page; `backdesk.au` gets no records this phase. DNS records are added by the founder at the registrar — the plan must produce the exact record list (CNAME/A for Vercel, SPF/DKIM/DMARC TXT/CNAME for Resend) and pause on a human-verify checkpoint until they resolve.
- **D-06:** The Vercel project rename (`quote-recovery-mvp` → `backdesk`) is part of this phase. `backdesk.vercel.app` is owned by a third party, so the renamed project gets a suffixed default URL — irrelevant once the custom domain is primary. **Order of operations (locked):** (1) attach `app.backdesk.com.au` and confirm it serves production while the old URL still works; (2) switch `APP_BASE_URL` (Production + Preview via `npm run env:push` / `scripts/push-vercel-env.mjs`), re-apply the pg_cron targets (`scripts/apply-cron-schedules.mjs` — sync-tick, cadence-tick, messaging-reconcile) and the ClickSend inbound + DLR webhook rules (`scripts/setup-clicksend.mjs`) to the custom domain and prove each with the Phase 3/4 standard (server-side 200 recorded in `net._http_response` / webhook row appears); (3) only then rename the project, re-create the deploy hook if one is in use, update `.vercel/project.json` via `vercel link`, and set `supabase/config.toml` `project_id = "backdesk"`. The old `*.vercel.app` URL must be dead weight before it is released. Never leave a tick pointed at a URL that is about to disappear.
- **D-07:** Redirect the default production `*.vercel.app` alias to `https://app.backdesk.com.au` (Vercel domain "redirect to" setting). Re-enable Vercel Deployment Protection at **Standard Protection** (preview + generated URLs; custom production domain stays public). Research must confirm: (a) Standard Protection does not gate the custom production domain, so the pg_cron ticks and ClickSend/Resend webhooks hitting `app.backdesk.com.au` keep working without a bypass; (b) whether the protected default URL still redirects before the auth wall; (c) whether any automation hits preview URLs (none known — remote tests run against the shared Sydney Supabase, not Vercel previews) and whether a Protection Bypass for Automation secret is needed. Outcome documented in `docs/` (DOM-02).
- **D-08:** `quotes.backdesk.com.au` is added and verified at Resend through the existing console flow (`/settings/email`, `src/core/messaging/resend-domains.ts`) with the Sydney-region caveat text left as is. It becomes the service-owned sending domain used for cadence email identities that have no per-client domain, and for operator alerts (D-03). Region for the Resend domain: keep the default unless research finds an APAC option that improves deliverability.

### Commercial assumptions (BRAND-02)
- **D-09:** The three flagged values stay in `src/core/audit/constants.ts` (`AUDIT_RECOVERY_RATE = 0.15`, `DEFAULT_BASELINE_WIN_RATE = 0.7`, `BASELINE_MIN_QUOTES = 10`) and the setup fee stays excluded from the recovery multiple (`src/core/reporting/figures.ts`, `copy.ts`). That file is the "one documented config location"; add a short header comment block there pointing at the decision record. The operator has NOT yet confirmed the values: the plan must carry a `checkpoint:decision` presenting the three values with the recommendation to keep them (bottom of the GTM 15–20% band; conservative baseline that understates our contribution; guarantee quoted against the retainer), and on confirmation record the decision in `PROJECT.md` Key Decisions (replace the two "⚠ Flagged assumption" rows) and in a new `docs/commercial-assumptions.md` that the Cowork thread can cite. If the operator changes a value, the audit page copy (`ratePercent`) and report copy already derive from the constants — verify with the existing tests.

### Tests and proof
- **D-10:** Existing tests that assert the literal "Quote Recovery" are updated to import from the brand module; add one test that renders the identity line, the from display name, and the unsubscribe footer and asserts they contain "Backdesk" and the business name. A repo-wide grep for `Quote Recovery` in `src/` (excluding `package.json`) returning zero rendered hits is an acceptance criterion of BRAND-01.
- **D-11:** Live proofs in this phase are limited to: console reachable at `https://app.backdesk.com.au` on a phone (login page reads Backdesk), `/settings/email` showing `quotes.backdesk.com.au` verified, cron tick 200s recorded against the new base URL, ClickSend rule read-back showing the new URLs. Sending a real cadence email is Phase 10 (DOM-04).

### Claude's Discretion
- Exact module name/shape for the brand source of truth; whether the alert-from env var is new or reuses an existing one (read `docs/env-vars.md` and `src/**/env` parsing first).
- Whether the redirect from the default alias is done in Vercel domain settings or `next.config.ts` (prefer Vercel setting — zero code).
- How the `docs/` protection write-up is organised (a new `docs/vercel-domains-and-protection.md` or a section in `docs/external-registrations.md`).

### Deferred Ideas (OUT OF SCOPE)
- Landing page on the apex `backdesk.com.au` + host-based routing between marketing site and console — Phase 9
- Applying the M1 wordmark/colour/type across audit, report, emails, login — quick task after the Cowork build request lands (or folded into Phase 9's UI-SPEC)
- Live cadence email proof on `quotes.backdesk.com.au` (MSG-02 / DOM-04) and arming — Phase 10
- `backdesk.au` — parked; consider a redirect to `.com.au` when the landing page ships
- Trade mark — deferred to incorporation (not a code item)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BRAND-01 | Every prospect- and client-facing surface identifies the service as Backdesk; no "Quote Recovery" service-name string remains in rendered output (repo/package name may stay) | §5 Brand-string inventory (10 sites in 8 `src/` files, verified by grep this session; plus 1 script literal that reaches a real inbox), §Brand module shape, §Validation (grep-as-test) |
| BRAND-02 | AUDIT_RECOVERY_RATE (0.15), default baseline win rate (0.70) + BASELINE_MIN_QUOTES (10), setup-fee exclusion confirmed by the operator, in one documented config location, recorded in PROJECT.md | §6 Consumers + test pins (one-file edit + 3 literal pins), §Runtime State (stored `recoverable_estimate` caveat), checkpoint:decision shape |
| BRAND-03 | Spam Act sender identification names the tradie as sender and Backdesk only as the service; functional opt-out unchanged | §5 (identity line / `via` display name / unsubscribe footer builders; sanitiser stays in `resend-sender.ts`), §Security (header-injection test kept) |
| DOM-01 | Console served at `https://app.backdesk.com.au` (syd1 unchanged), `*.vercel.app` production URL redirects to it | §1 Vercel custom domain, redirect, rename semantics; §Environment (DNS delegation blocker); §4 URL switch sequence |
| DOM-02 | Deployment Protection re-enabled for previews without breaking pg_cron ticks or public pages; bypass/exclusions documented in `docs/` | §2 Standard Protection semantics on Hobby (verified plan = hobby), what stays public, bypass not needed, existing bypass secret to rotate |
| DOM-03 | `quotes.backdesk.com.au` verified at Resend (SPF, DKIM, DMARC), visible in console email settings, sending domain for cadence email and operator alerts | §3 Resend record set for a subdomain, region (no AU region exists), console flow mapping, from-address wiring (`OPERATOR_ALERT_FROM` reuse; cadence identity is data in `messaging_config`) |
</phase_requirements>

## Summary

Phase 8 is a coordinated rename with almost no new code. The codebase inventory is fully known: ten rendered "Quote Recovery"/"quote-recovery" sites across eight `src/` files (all listed in D-01 and re-verified by grep this session — nothing missed in drafting prompts, SMS templates or email markup), one script literal that will land in a real inbox during the Phase 10 proof (`scripts/verify-email-pipe.mjs:97`), and three test files that pin the old strings. The three commercial constants live in one import-free module whose export list and import-freedom are already asserted by a test; changing a value is a one-line edit plus three literal pins in `tests/audit-aggregate.test.ts`. The existing env schema already has `OPERATOR_ALERT_FROM` (optional), so D-03 needs no new variable — only a single `DEFAULT_ALERT_FROM` exported from the brand module and imported by both alert senders.

The platform facts are settled by official docs plus a live read of the Vercel project through the REST API: the team is on the **Hobby** plan, Vercel Authentication is currently **off** (`ssoProtection: null`), there are **no deploy hooks** (so the ROADMAP's "re-create the deploy hook" item is moot), the project is Git-linked to `future-beat/backdesk` (`main`), and `quote-recovery-mvp.vercel.app` is a first-class project domain with `redirect: null` — the "Redirect to" setting (or the `PATCH /v9/projects/{id}/domains/{domain}` API) applies to it. Standard Protection is available on Hobby and by definition never covers production domains, so the ticks and webhooks on `app.backdesk.com.au` need no bypass; the generated `-git-main-` and `-<scope>` production aliases become protected (July 2025 change), while `<project>.vercel.app` remains public and therefore redirects before any auth wall. Resend has exactly four regions and none in Australia — keep `ap-northeast-1`; the subdomain needs a DKIM TXT, an SPF MX + TXT on `send.quotes.backdesk.com.au`, and the DMARC goes on the organisational domain `_dmarc.backdesk.com.au` per Resend's own guidance.

The one hard blocker is outside the repo: **`backdesk.com.au` currently has no nameserver delegation** (NXDOMAIN for the apex and subdomains; the registry returns no NS set). No CNAME, TXT or MX can be published until the founder chooses a DNS host and delegates the zone. That decision must be the first human checkpoint, before any Vercel or Resend record is requested.

**Primary recommendation:** Plan Phase 8 as four waves in the D-06 order — (0) brand module + string swap + assumption sign-off (pure code, mergeable today); (1) DNS host decision + `app.backdesk.com.au` attach with proof; (2) the URL switch (`env:push` → redeploy → `cron:apply` → `clicksend:setup`, each with its server-side read-back); (3) rename + redirect on the *new* default domain + Standard Protection + Resend subdomain verification + alert-from switch — and keep every live proof as a recorded artefact, never a screenshot.

## Project Constraints (from CLAUDE.md)

Directives extracted from `.claude/CLAUDE.md` that bind this phase:

- **Stack is fixed:** TypeScript + Next.js 16 App Router on Vercel, Supabase Sydney (`ap-southeast-2`), Resend, ClickSend REST via thin `fetch` wrapper, zod v4 at every boundary. No Prisma, no n8n/Zapier, no alpha-tag sender IDs, no ClickSend SDK, no `waitUntil` for sends. `[VERIFIED: .claude/CLAUDE.md]`
- **Compliance:** Spam Act sender identification + functional opt-out on every outbound message; DNCR contact-hours discipline; Privacy Act APP compliance as vendor. The identity line / `via` display name / unsubscribe footer are the Spam Act controls this phase touches (BRAND-03). `[VERIFIED: .claude/CLAUDE.md]`
- **Budget:** tooling ≤ ~$200/mo pre-revenue. Relevant here: Vercel is on **Hobby** (verified live), so Pro-only protection features are out; Standard Protection on Hobby is free. `[VERIFIED: api.vercel.com /v2/teams → billing.plan = hobby]`
- **Vercel region:** `vercel.json` `regions: ["syd1"]` must survive (DOM-01). `[VERIFIED: vercel.json:1-4]` — verbatim: `{"$schema": "https://openapi.vercel.sh/vercel.json", "regions": ["syd1"]}`
- **Honesty about residency:** DB + auth are AU-resident; Vercel functions (syd1), Resend (`ap-northeast-1`) and ClickSend process offshore — the `/settings/email` residency banner already says so and D-08 keeps it. `[VERIFIED: src/app/(console)/settings/email/page.tsx:60-62]`
- **GSD workflow enforcement:** repo edits only through `/gsd-execute-phase`, `/gsd-quick`, `/gsd-debug`.
- **Dev tools:** Vitest for unit tests; Supabase CLI for migrations; Vercel CLI for env/domains. `[VERIFIED: package.json scripts]`
- **Claude model IDs** are irrelevant to this phase (no LLM code changes).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Brand strings on rendered surfaces (title, nav, login, A4 footers, email identity line, unsubscribe footer, alert from-name) | Frontend server (Next.js server components + route handlers) | Core (`src/core/brand.ts`, framework-free) | Strings render server-side; the single source of truth must be importable from `src/core` (messaging, alerts) and `src/app` alike — same reasoning as `src/core/audit/constants.ts` |
| Commercial assumptions (rate, baseline, min quotes, setup-fee exclusion) | Core (`src/core/audit/constants.ts`, `reporting/figures.ts`, `copy.ts`) | Docs (`docs/commercial-assumptions.md`, `PROJECT.md`) | Values are code constants consumed by the audit aggregator, attribution baseline, report figures/copy and the audit page; the decision record is documentation |
| Console host `app.backdesk.com.au` | CDN / Vercel edge (domain, TLS, redirect) | Registrar DNS (founder) | Domain attach, cert, `*.vercel.app` redirect and Deployment Protection are all Vercel project settings — zero application code |
| Absolute-URL minting (`APP_BASE_URL`) for unsubscribe links, alert links, cron targets, ClickSend callback URLs | Config (Vercel env + `.env.local`) | Database (`cron.job.command`) + ClickSend account (automation rules) | One env value fans out to three external stores; each must be re-pointed and read back |
| Sending domain `quotes.backdesk.com.au` | Resend (domain object, region, DKIM/SPF) | Registrar DNS (founder); console `/settings/email` | Existing console flow drives create/verify; from-addresses are `messaging_config` rows (data), alert from is env |
| Deployment Protection for previews | Vercel project setting | — | Platform feature; app code unaffected (`proxy.ts` already excludes `/api/*`, and Vercel auth sits in front of it anyway) |

## Standard Stack

No new packages are installed in this phase. Everything below is already in `package.json` / on the machine.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.3.2 `[VERIFIED: package.json]` | Console + route handlers; `metadata` in `src/app/layout.tsx` carries the title | Decided constraint |
| `resend` | 6.22.1 installed; 6.26.0 latest on npm `[VERIFIED: npm view resend version]` | `domains.create/list/get/verify` in `src/core/messaging/resend-domains.ts`; `emails.send` | Already wired; SDK region union is `'us-east-1' \| 'eu-west-1' \| 'sa-east-1' \| 'ap-northeast-1'` `[VERIFIED: node_modules/resend/dist/index.d.mts]` — no upgrade needed for this phase |
| `zod` | 4.4.3 `[VERIFIED: package.json]` | `getServerEnv()` schema; `OPERATOR_ALERT_FROM: z.string().min(1).optional()` and `APP_BASE_URL: z.url().optional()` already exist | Every config value crosses this boundary |
| `vitest` | 4.1.11 `[VERIFIED: package.json]` | Brand test, updated pins | Existing framework |

### Supporting (tooling on this machine)
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| Vercel CLI | 59.10.0 `[VERIFIED: vercel --version]` — has `project rename`, `domains add/inspect/verify`, `dns add`, `env add --project`, `curl` (beta) | Domain attach, DNS verification read-back, rename, env push (via `scripts/push-vercel-env.mjs`) | Waves 1–3 |
| Supabase CLI | 2.115.0 (devDependency) `[VERIFIED: package.json]` | `supabase/config.toml` `project_id` rename only; no migrations this phase | Wave 3 |
| `psql` | present `[VERIFIED: command -v psql]` | Read `cron.job` / `net._http_response` proofs on the session pooler | Wave 2 proofs |
| `dig` | 9.10.6 `[VERIFIED]` | DNS read-back for the founder's records | Waves 1, 3 |
| Node | 22.20.0 local; Vercel project Node 24.x `[VERIFIED: vercel project inspect]` | `process.loadEnvFile` in scripts needs ≥ 20.12 | — |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vercel "Redirect to" on the default domain | `next.config.ts` `redirects()` with a `has: [{type:'host', value:'…vercel.app'}]` condition | Works, but it is a code change, executes inside the app (a redirect hop on the custom domain is explicitly forbidden by CONTEXT, so the host condition would have to be exact), and vanishes if the project is renamed again. Prefer the Vercel setting (D-07); keep `next.config.ts` untouched |
| Registrar DNS for `backdesk.com.au` | Vercel nameservers (`vercel dns add` for every record, Resend records included) | Makes every record scriptable and read-back-able with `vercel dns ls`, but moves the apex zone to Vercel and the launch plan says the founder adds records at the registrar. Decide at the first checkpoint (see Open Questions) |
| Resend `ap-northeast-1` | `us-east-1` default | No AU region exists; Tokyo is nearest. Keep the pinned constant (`EMAIL_DOMAIN_REGION`) — changing region requires delete + re-add of the domain `[CITED: resend.com/docs/dashboard/domains/regions]` |

**Installation:** none. `npm install` is not part of this phase.

## Package Legitimacy Audit

> Not applicable: this phase adds no dependencies. `resend@6.22.1` is already installed and is the only third-party SDK exercised; it remains at its current version (upgrading to 6.26.0 is unnecessary and out of scope). `[VERIFIED: package.json; npm view resend version → 6.26.0]`

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Environment Availability

| Dependency | Required By | Available | Version / State | Fallback |
|------------|------------|-----------|-----------------|----------|
| `backdesk.com.au` DNS zone (nameserver delegation) | DOM-01, DOM-03 — every record | **✗ BLOCKING** | Registered (whois `status: ACTIVE`) but `dig backdesk.com.au NS` returns nothing and `app.backdesk.com.au` is NXDOMAIN at the `.com.au` authoritative servers `[VERIFIED: dig +trace, 2026-09-06]` | None — founder must set nameservers at the registrar (registrar DNS / Cloudflare DNS-only / Vercel NS). First human checkpoint |
| Vercel project `quote-recovery-mvp` | DOM-01/02 | ✓ | id `prj_XXXXXXXX`, team `hesams-projects-432a48c6` (**plan: hobby**), Git-linked `github:future-beat/backdesk` branch `main`, `deployHooks: []`, `ssoProtection: null`, `passwordProtection: null`, Node 24.x, production aliases `quote-recovery-mvp.vercel.app`, `quote-recovery-mvp-hesams-projects-432a48c6.vercel.app`, `quote-recovery-mvp-git-main-hesams-projects-432a48c6.vercel.app` `[VERIFIED: api.vercel.com /v9/projects, /v2/teams; vercel project ls]` | — |
| Vercel project domains | DOM-01 | ✓ | Exactly one: `quote-recovery-mvp.vercel.app` (`apexName: vercel.app`, `redirect: null`, `verified: true`); team has 0 owned domains `[VERIFIED: /v9/projects/…/domains; vercel domains ls]` | — |
| Protection Bypass for Automation secret | DOM-02 (hygiene) | ⚠ exists | One bypass secret already exists on the project (`protectionBypass` has one key). Nothing in this repo uses it. Research read the project object via the API, which echoes the secret — **regenerate or delete it during DOM-02** `[VERIFIED: /v9/projects]` | — |
| `APP_BASE_URL` in Vercel | DOM-01 switch | ✓ | Present in Production + Preview as type `Config` (created 8d ago) `[VERIFIED: vercel env ls production]`; value currently `https://quote-recovery-mvp.vercel.app` `[VERIFIED: docs/external-registrations.md:328-330, STATE.md]` | — |
| `OPERATOR_ALERT_FROM` in Vercel | DOM-03 alerts | ✗ (not set — default in code applies) | Absent from `vercel env ls` grep `[VERIFIED]` | Push after domain verifies (D-03) |
| Vercel CLI auth | all Vercel steps | ✓ | `vercel whoami` → `future-beat`; `.vercel/project.json` links `projectId prj_LlP3…`, `projectName quote-recovery-mvp` `[VERIFIED]` | — |
| Resend account / API key | DOM-03 | ✓ (per docs) | `RESEND_API_KEY` is REQUIRED in env schema; no domain verified as of 2026-08-30 `[VERIFIED: docs/external-registrations.md:707]`. Not probed this session (`.env.local` is read-denied in this workspace) | — |
| ClickSend account + number `+61491579212` | DOM-01 switch (rule re-point) | ✓ (per docs) | Rules configured to old origin; sms global row DISARMED `[VERIFIED: docs/external-registrations.md]` | — |
| Hosted Supabase (session pooler) for `cron:apply` + proofs | DOM-01 switch | ✓ (per docs) | `MIGRATE_DATABASE_URL` port 5432 required by the script `[VERIFIED: scripts/apply-cron-schedules.mjs:141-147]` | — |
| Docker (local Supabase for `npm test`) | Validation | ✗ | Machine has no Docker; `npm test` refuses the hosted target → use `npm run test:remote` (pauses production ticks for the run) `[VERIFIED: docs/env-vars.md, tests/helpers/global-setup.ts]` | CI runs the full suite on a local stack |

**Missing dependencies with no fallback:**
- DNS delegation for `backdesk.com.au` (see above). Until nameservers resolve, waves 1 and 3 cannot start; wave 0 (brand code, assumptions) and the doc write-ups can.

**Missing dependencies with fallback:**
- Docker → `npm run test:remote` for local runs; CI for the full suite.

## 1. Vercel custom domain, redirect, and project rename (DOM-01)

### DNS record for the subdomain
- Vercel now issues a **project-specific CNAME target** (example in docs: `d1d4fc829fe7bc7c.vercel-dns-017.com`); the generic `cname.vercel-dns.com` / `cname.vercel-dns-0.com` remain "general-purpose values" that also work. **Use the value `vercel domains inspect app.backdesk.com.au` prints after the domain is added**, not a remembered one. `[CITED: vercel.com/docs/domains/working-with-domains/add-a-domain; vercel.com/docs/domains/set-up-custom-domain]`
- Apex would be `A 76.76.21.21` — not needed this phase (D-05). `[CITED: same]`
- The DNS host must **not proxy** the CNAME (Cloudflare "orange cloud" breaks Vercel certificate issuance and Resend verification alike). `[CITED: resend.com/docs/add-a-domain; ASSUMED for Vercel — Vercel troubleshooting docs not fetched]`

### Commands and proofs (Wave 1)
```bash
# From the linked repo directory (project = quote-recovery-mvp at this point)
vercel domains add app.backdesk.com.au                 # or: vercel domains add app.backdesk.com.au quote-recovery-mvp
vercel domains inspect app.backdesk.com.au             # prints the exact CNAME name/value the founder must add
# --- founder adds the CNAME at the DNS host; checkpoint:human-verify ---
vercel domains verify app.backdesk.com.au --project quote-recovery-mvp --format=json   # expected vs observed records
dig +short app.backdesk.com.au CNAME                   # the vercel-dns target
vercel certs ls                                        # cert issued for app.backdesk.com.au
curl -sI https://app.backdesk.com.au/login | head -1   # HTTP/2 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.backdesk.com.au/api/internal/cadence-tick \
  -H "Authorization: Bearer $(printf '0%.0s' {1..64})"  # 401 = route deployed on the new host AND getServerEnv() parsed
```
The domain is "automatically applied to your latest production deployment"; no redeploy is needed to serve it. `[CITED: vercel.com/docs/domains/working-with-domains/deploying-and-redirecting]`

### Redirecting the default `*.vercel.app` production domain
- `quote-recovery-mvp.vercel.app` is a **project domain** (it appears in `GET /v9/projects/{id}/domains` with `redirect: null`) `[VERIFIED: api.vercel.com]`. Project domains accept `redirect` + `redirectStatusCode ∈ {301,302,307,308}` via `PATCH /v9/projects/{idOrName}/domains/{domain}` `[CITED: vercel.com/docs/rest-api/projects/update-a-project-domain]`, and the dashboard exposes the same as **Settings → Domains → Edit → "Redirect to"** (available once the project has more than one domain) `[CITED: deploying-and-redirecting]`.
- **Sequencing consequence:** the redirect is a property of the *domain name*. After the rename the default domain is a new name; the redirect must be applied to the **new** `backdesk-<suffix>.vercel.app`, after the rename, not before. Use **308** (permanent, method-preserving) — the old host must never be bookmarked again. `[ASSUMED: 308 choice is a recommendation, not a documented requirement]`
- Vercel's KB on duplicate content offers a WAF rule redirect as an alternative; unnecessary here. `[CITED: vercel.com/kb/guide/avoiding-duplicate-content-with-vercel-app-urls]`

### Project rename semantics
- Rename via dashboard (Settings → General), **`vercel project rename quote-recovery-mvp backdesk`** (present in CLI 59.10 `[VERIFIED: vercel project --help]`), or `PATCH /v9/projects/{idOrName} {"name":"backdesk"}`. Names: lowercase, ≤100 chars, letters/digits/`.`/`_`/`-`, no `---`. `[CITED: vercel.com/kb/guide/how-do-i-change-the-name-of-my-vercel-project; vercel.com/docs/project-configuration/general-settings]`
- **Old `*.vercel.app` URLs are released, not redirected:** "pre-rename generated URLs aren't guaranteed to stay accessible … replace any old URL that's bookmarked, shared, or stored externally, and use a custom domain for production traffic." `[CITED: same KB]` — confirms the ROADMAP/CONTEXT premise.
- **What survives a rename with no action:** Git auto-deploys, CI using `VERCEL_PROJECT_ID`, `.vercel/project.json` links, and custom domains — all keyed on the immutable project ID. `[CITED: same KB]` `.vercel/project.json` here is `{"projectId":"prj_LlP3…","orgId":"team_iNei…","projectName":"quote-recovery-mvp"}` `[VERIFIED: .vercel/project.json]` — the `projectName` field goes stale but is cosmetic; `vercel link --yes --project backdesk` refreshes it (D-06). Note: the previous `vercel link` wrote a `VERCEL_OIDC_TOKEN` block into `.env.local` as a side effect `[VERIFIED: STATE.md:390]` — expect the same again; harmless.
- **What must be updated:** env vars holding the old host (`APP_BASE_URL` — done in Wave 2 before the rename), OAuth callbacks (none: ServiceM8 OAuth is not built; App ID 000000 sits in Draft `[VERIFIED: docs/external-registrations.md:29-31]`), and deploy hooks — **none exist** (`deployHooks: []`) `[VERIFIED: api.vercel.com]`, so nothing to recreate.
- **New default domain when `backdesk.vercel.app` is taken** (it is: it resolves to Vercel anycast IPs today `[VERIFIED: dig backdesk.vercel.app]`): Vercel will assign a suffixed name; the exact suffix format is not documented on the pages fetched — read it back with `vercel project ls` / `targets.production.alias` after the rename and only then configure the redirect. `[ASSUMED: suffix shape]`
- `scripts/push-vercel-env.mjs` **requires `--project <name>`** and passes it to `vercel env add … --project` `[VERIFIED: scripts/push-vercel-env.mjs:103,155-160]` — after the rename every invocation must use `--project backdesk`; the script's usage comments (lines 7-10) and the `fail()` example (line 103) still say `quote-recovery-mvp` and should be updated in the same commit as `supabase/config.toml:5` (`project_id = "quote-recovery-mvp"` → `"backdesk"`) `[VERIFIED: supabase/config.toml:5]`.

## 2. Vercel Deployment Protection on Hobby (DOM-02)

**Verified live state:** plan `hobby`; `ssoProtection: null` (Vercel Authentication off — disabled in Phase 2 because "Vercel SSO deployment protection intercepted the cron POST … (Hobby has no previews-only scope; re-enable when a custom domain lands)" `[VERIFIED: .planning/milestones/v1.0-phases/02-…/02-UAT.md:45-48]`).

**Documented semantics (docs last updated 2026-08-28):** `[CITED: vercel.com/docs/deployment-protection; …/methods-to-protect-deployments/vercel-authentication]`
- "On the Hobby plan, Vercel Authentication with Standard Protection is available. This protects your preview deployments and deployment URLs, but **your production domain remains publicly accessible**. To protect production domains, you need a Pro or Enterprise plan."
- Scopes: **Standard Protection** — "Protects all deployments **except** production domains. Available on all plans." **All Deployments** — Pro/Enterprise. "Only Preview Deployments" is now the *legacy* "(Legacy) Pre-Production Deployments" scope (this is the "previews-only scope" Phase 2 could not find on Hobby).
- Since July 2025 Standard Protection also covers "all automatically generated domains, including the production branch git domain (for example `project-git-main.vercel.app`)". `[CITED: vercel.com/changelog/more-secure-deployment-protection]`
- API: `PATCH /v9/projects/{id}` with `{"ssoProtection":{"deploymentType":"prod_deployment_urls_and_all_previews"}}` = Standard Protection; `null` disables. Dashboard: Settings → Deployment Protection → Vercel Authentication toggle → scope → Save.
- Protection is enforced before the app ("requires authentication for all requests, including those to Routing Middleware") — so `proxy.ts`'s `/api/` exclusion does not exempt anything from Vercel auth; only the scope does.
- Unauthenticated requests to a protected URL get a Vercel login redirect (browser) / 401 page (non-browser). Re-enabling honours cookies from earlier logins for that URL.

**Answers to D-07:**
- (a) **Confirmed:** `app.backdesk.com.au` is a production domain → never protected under Standard Protection. pg_cron ticks, ClickSend callbacks and the unsubscribe page on that host need no bypass. Resend has no webhook into this system (no route under `src/app/api/webhooks/resend`; grep found none) `[VERIFIED: grep]`.
- (b) **`<project>.vercel.app` is itself listed as a production domain of the project** (`apexName: vercel.app` in the domains list) and the Hobby note says the production domain stays public, whereas the `-<scope>` and `-git-main-<scope>` aliases are the "automatically generated domains" that become protected. Conclusion: the default domain is not behind the auth wall, so its "Redirect to" fires for anonymous visitors. **Confidence MEDIUM** — the docs never state it in one sentence, so the plan must prove it: `curl -sI https://<new-default>.vercel.app/login` → `30x` with `location: https://app.backdesk.com.au/login`; `curl -sI https://backdesk-git-main-hesams-projects-432a48c6.vercel.app/login` → `401` with a `_vercel_sso_nonce` cookie (protected). If (b) turns out false, DOM-01's redirect still holds for logged-in Vercel users only; the honest fallback is to drop the redirect expectation on the default domain and document that the generated URLs are private by design.
- (c) **No automation targets preview URLs** (remote tests hit Supabase directly; CI never deploys — `.github/workflows/ci.yml` only lints, builds and runs the suite on a local stack `[VERIFIED]`). **Protection Bypass for Automation is not needed.** It is available on all plans if ever required (`x-vercel-protection-bypass` header/query, `VERCEL_AUTOMATION_BYPASS_SECRET` env) `[CITED: …/protection-bypass-automation; changelog "now available on all plans"]`. The one existing bypass secret should be regenerated/deleted as hygiene (see Environment).

**Why previews matter here:** Phase 4 pushed the messaging secrets and `APP_BASE_URL` to **Preview as well as Production** `[VERIFIED: docs/external-registrations.md:328-334]`, so a preview deployment is a second front door to the production database and providers (still behind Supabase login and bearer checks). Standard Protection restores the Vercel-login wall in front of that door at zero cost.

**What can honestly be delivered on Hobby (DOM-02):** Vercel Authentication + Standard Protection: all preview deployments and all generated production aliases protected; `app.backdesk.com.au` (and the default `<project>.vercel.app`) public. That is exactly what the requirement asks for. Document in a new `docs/vercel-domains-and-protection.md` (recommended over stuffing `external-registrations.md`, which is a dated evidence log — link the proof entries from there).

## 3. Resend sending domain and from-address wiring (DOM-03)

### Region
Resend regions are exactly **North Virginia `us-east-1`, Ireland `eu-west-1`, São Paulo `sa-east-1`, Tokyo `ap-northeast-1`**; region controls where mail is routed/sent from, not where data is stored (US); changing region = delete the domain and re-add. `[CITED: resend.com/docs/dashboard/domains/regions]` The SDK type union agrees `[VERIFIED: node_modules/resend/dist/index.d.mts]`. **Keep `EMAIL_DOMAIN_REGION = 'ap-northeast-1'`** (`src/core/messaging/resend-domains.ts:62`, pinned by `tests/resend-domains.test.ts:138-149`). No APAC option is closer.

### Record set for `quotes.backdesk.com.au` (expected shape — the console table is canonical)
Resend recommends sending from a subdomain; records are placed **on the subdomain**; the parent apex needs nothing for Resend. `[CITED: resend.com/docs/add-a-domain; …/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain]`

| Purpose | Type | Name (FQDN) | Value | Note |
|---------|------|-------------|-------|------|
| DKIM | TXT | `resend._domainkey.quotes.backdesk.com.au` | `p=MIGf…` (verbatim from the console/Resend) | Resend's current default is a TXT DKIM; the API reference example shows an older CNAME-to-`dkim.amazonses.com` form — accept whichever the console renders `[CITED: add-a-domain; api-reference/domains/create-domain]` |
| SPF (return-path) | MX | `send.quotes.backdesk.com.au` | `feedback-smtp.ap-northeast-1.amazonses.com`, priority 10 | region-specific host; the repo's own fixture uses this value `[VERIFIED: tests/resend-domains.test.ts:89]` |
| SPF | TXT | `send.quotes.backdesk.com.au` | `v=spf1 include:amazonses.com ~all` | |
| DMARC (recommended) | TXT | `_dmarc.backdesk.com.au` | `v=DMARC1; p=none;` (add `rua=mailto:…` only to a mailbox that can receive it — see Open Questions) | Resend: place on the **organisational domain**, start at `p=none`, tighten later `[CITED: resend.com/docs/dashboard/domains/dmarc]` |

Registrar-relative names (most AU hosts want zone-relative labels): `resend._domainkey.quotes`, `send.quotes` (MX + TXT), `_dmarc`. Values must be pasted verbatim; verification usually lands within 15 minutes, up to 72 h; "Restart verification" after that. `[CITED: add-a-domain]`

Note the `_dmarc.backdesk.com.au` record lives in the apex zone but is not the apex hostname — it does not conflict with D-05's "apex reserved for Phase 9". `[ASSUMED: interpretation of D-05]`

### How the existing console flow maps onto it
- **Add:** `/settings/email` → `AddDomainForm` → `createDomain(name)` passes `region: EMAIL_DOMAIN_REGION` explicitly and returns `records` verbatim (`value` is never trimmed) `[VERIFIED: src/core/messaging/resend-domains.ts:255-288]`.
- **Show records:** `DnsRecords` renders `type / name / value / status` in `<code>` with no truncation `[VERIFIED: settings/email/page.tsx:108-145]`.
- **Verify:** `VerifyDomainForm` → `verifyDomain(id)` (asynchronous; returns only an id) → page re-reads `getDomain` and shows the status badge; `verified` is the only status that permits sending (`VERIFIED_STATUS`) `[VERIFIED: resend-domains.ts:69, 329-345]`.
- **Gate on save:** `saveEmailConfigAction` refuses any `from_address` whose domain is not in `listDomains()` with status `verified` `[VERIFIED: settings/email/actions.ts:239-265]`.

### Where `identity.fromAddress` comes from (cadence email)
`buildRoutingSender()` → `chooseEmailSender(…, resolveEmailIdentity)`; `resolveEmailIdentity(tenantId)` reads `getChannelConfig('email', tenantId)` — **override-first: the tenant's own row, else the global (`tenant_id IS NULL`) row** — and returns `{fromAddress: row.fromAddress, replyTo: row.replyTo, businessName: row.businessName ?? tenant.name}`; a disabled or incomplete row returns `null` and the send is refused (`email_not_configured`). `[VERIFIED: src/core/messaging/routing-sender.ts:204-235, 258-285; src/db/repository/messaging-config.ts:87-108]`
**There is no code-level default from-domain.** The "service-owned fallback" is data: the `messaging_config` row's `from_address`. The form's placeholder becomes `quotes@<first verified domain>` automatically `[VERIFIED: settings/email/forms.tsx:145-148]`. Because an *enabled* row — global or per-tenant — must carry a tradie `reply_to` and a `business_name` `[VERIFIED: actions.ts:225-237]`, the global row cannot sensibly be enabled for "every client"; real activation is per-tenant (Phase 10, ARM-02). So for DOM-03 "sending domain for cadence email" is satisfied by: the domain verified + the convention documented (`followups@quotes.backdesk.com.au` recommended for cadence identities — the tests already use `followups@quotes.example.test`) + `brand.ts` exporting `SENDING_DOMAIN`. No identity row is armed in Phase 8 (D-11).

### Operator alerts from-address (D-03)
Both alert modules do `from = env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM` with a local `const DEFAULT_ALERT_FROM = 'Quote Recovery <onboarding@resend.dev>'` `[VERIFIED: operator-email.ts:47,200; stalled-drafts.ts:49,256]`; `OPERATOR_ALERT_FROM` is already in the schema as optional and in the pick-list `[VERIFIED: src/core/shared/env.ts:172,256]` and documented `[VERIFIED: docs/env-vars.md:85-89,190]`. **Reuse it; add no new variable.** Steps: (1) Wave 0 — `export const DEFAULT_ALERT_FROM = \`${SERVICE_NAME} <onboarding@resend.dev>\`` in `brand.ts`, both modules import it (display name changes now; still owner-only delivery, which is what alerts need). (2) After verification — push `OPERATOR_ALERT_FROM=Backdesk <alerts@quotes.backdesk.com.au>` with `npm run env:push -- --project backdesk --envs production,preview --public "OPERATOR_ALERT_FROM=Backdesk <alerts@quotes.backdesk.com.au>"` (`--public` splits on the first `=`; the value may contain spaces and angle brackets when shell-quoted `[VERIFIED: push-vercel-env.mjs:88-93]`), redeploy, then prove by triggering the stalled-digest with its real bearer (`POST /api/internal/stalled-digest`) and checking the received mail's `From:` header — note the digest sends nothing when there is nothing to report `[VERIFIED: PROJECT.md Key Decisions]`, so the proof may need a stalled fixture or is deferred to the first real alert; record whichever happened. Update the example line in `docs/env-vars.md:89` and `.env.example` (see Pitfalls re the `.env*` deny rule).

## 4. The URL switch in this codebase (DOM-01, D-06 step 2)

### Every consumer of `APP_BASE_URL` `[VERIFIED: grep src/ scripts/ supabase/ docs/ tests/, 2026-09-06]`
| Consumer | Line | What it builds | Re-point mechanism | Proof (server-side artefact) |
|----------|------|----------------|--------------------|------------------------------|
| `src/core/shared/env.ts` | 193, 257 | schema `z.url().optional()` + pick-list | Vercel env value | — |
| `src/core/alerts/operator-email.ts` `consoleBaseUrl()` | 97 | client-detail links in alert emails (fallback chain → `VERCEL_PROJECT_PRODUCTION_URL` → localhost) | env + redeploy | next alert's link host (deferred; not a Phase 8 proof) |
| `src/core/messaging/routing-sender.ts` | 276 | `appBaseUrl` for unsubscribe links — **no fallback**, refuses to send without it | env + redeploy | Phase 10 email proof |
| `scripts/apply-cron-schedules.mjs` | 150-183, `commandFor` | `cron.job.command` `net.http_post(url := '<origin>/api/internal/{sync-tick,cadence-tick,messaging-reconcile,stalled-digest}')` — **four jobs**, not three (the CONTEXT list omits `stalled-digest`) `[VERIFIED: JOBS array lines 63-140]` | `npm run cron:apply` (reads `.env.local`; needs `MIGRATE_DATABASE_URL` on 5432) | `SELECT jobname, schedule, active FROM cron.job WHERE jobname IN (…)` all `active = t`; `SELECT jobname, substring(command from 'url := ''([^'']+)''') FROM cron.job …` shows the new origin (bearer not printed); `SELECT status_code, created FROM net._http_response WHERE created > now() - interval '3 minutes' ORDER BY created DESC` shows **200** for the next cadence-tick minute — the Phase 3 standard (`cron.job_run_details` is green even on a 401) `[VERIFIED: docs/external-registrations.md, servicem8-api-notes.md:312-320]` |
| `scripts/setup-clicksend.mjs` | 154-171, 188-190 | ClickSend inbound rule `…/api/webhooks/clicksend/inbound?token=…` and DLR rule `…/api/webhooks/clicksend/dlr?token=…`, plus the reconcile probe | `npm run clicksend:setup -- --number +61491579212` (**no `--activate`**) — step 2 wrong-token probes must 401 on the new host, then rules are updated in place by `rule_name` and read back | script output: masked `action_address` on both rules pointing at `app.backdesk.com.au`, "exactly one of each"; real-token probes 200 |
| `scripts/verify-email-pipe.mjs` | 56, 158, 182 | unsubscribe link base for the proof send | env | Phase 10 |
| `scripts/push-vercel-env.mjs` | 10, 48 | the push itself (`--public APP_BASE_URL=…`) | — | `vercel env ls production` shows `APP_BASE_URL` type Config, updated "just now" |
| `tests/cron-schedules.test.ts` 85, 366-373; `tests/resend-sender.test.ts` 42, 433 | test fixtures | none | — |
| `docs/env-vars.md:94-102`, `docs/servicem8-api-notes.md:317`, `docs/external-registrations.md:315-330,744` | documentation | update examples / add a dated entry | — |

### Exact command sequence (Wave 2), with the redeploy the scripts insist on
```bash
# 0. .env.local: APP_BASE_URL=https://app.backdesk.com.au   (operator edits by hand)
# 1. Push to Vercel — Production AND Preview (Phase 4 precedent), still under the OLD project name
npm run env:push -- --project quote-recovery-mvp --envs production,preview --public APP_BASE_URL=https://app.backdesk.com.au
# 2. Redeploy — "a running deployment holds the values it booted with" (push-vercel-env.mjs). Merging the Wave-0 brand commit to main does this via the Git integration; otherwise `vercel redeploy <latest-production-url>`.
# 3. Re-point the four pg_cron jobs (origin + bearers read from .env.local; nothing printed)
npm run cron:apply
# 4. Re-point the two ClickSend rules; step 2 probes the NEW host first and fails closed
npm run clicksend:setup -- --number +61491579212
# 5. Proofs (session pooler)
psql "$MIGRATE_DATABASE_URL" -c "select jobname, schedule, active, substring(command from 'url := ''([^'']+)''') as url from cron.job where jobname in ('sm8-sync-tick','cadence-tick','messaging-reconcile','stalled-digest') order by jobname;"
psql "$MIGRATE_DATABASE_URL" -c "select status_code, created from net._http_response where created > now() - interval '3 minutes' order by created desc limit 5;"
```
`cron:apply` **unschedules and re-creates** each job (new `jobid`) `[VERIFIED: apply-cron-schedules.mjs:224-232]`. `tests/helpers/global-setup.ts` pauses `cadence-tick` and `sm8-sync-tick` by `jobid` for the duration of any `npm run test:remote` and re-arms them by re-querying the name `[VERIFIED: global-setup.ts:185-272]` — **never run `cron:apply` while a remote test run is in flight**, and after `cron:apply` confirm all four rows read `active = t` (a job left inactive by an interrupted test run would be replaced active by `cron:apply`, which is fine; the reverse overlap is not).

### Anything else embedding the old URL
- ClickSend rules (above) — yes. Resend — no webhooks configured, nothing to change. ServiceM8 — private-key polling, no callback URL; the Draft partner app has no live OAuth redirect. Vercel deploy hooks — none. GitHub — no workflow references Vercel URLs. `[VERIFIED: greps + api.vercel.com]`
- **Supabase Auth "Site URL" / additional redirect URLs** (dashboard setting, not in git) may hold `https://quote-recovery-mvp.vercel.app`; email+password login via `@supabase/ssr` does not depend on it, but password-reset/magic-link emails would. Check and update at the rename checkpoint. `[ASSUMED — not readable from the repo]`
- `docs/external-registrations.md` is a dated evidence log: keep history verbatim, append a "2026-09-xx — URL switch" entry with the read-backs.

## 5. Brand strings: complete inventory and the brand module (BRAND-01/03)

### Rendered literals in `src/` `[VERIFIED: grep -rn -i "quote recovery|quote-recovery" src, 2026-09-06]`
| # | File:line | Literal | Surface |
|---|-----------|---------|---------|
| 1 | `src/app/layout.tsx:7-10` | `default: 'Quote Recovery'`, `template: '%s · Quote Recovery'`, `description: 'Operator console for the managed quote-recovery service.'` | every console page title + meta description |
| 2 | `src/app/(console)/layout.tsx:102` | nav wordmark text `Quote Recovery` inside `<Link href="/" className="brand">` | console chrome |
| 3 | `src/app/login/page.tsx:22` | `<h1>Quote Recovery</h1>` | login page (the D-11 phone proof) |
| 4 | `src/app/(console)/audits/[id]/page.tsx:20` (used :297) | `const SERVICE_NAME = 'Quote Recovery'` → `{SERVICE_NAME} · prepared {date}` | A4 audit footer |
| 5 | `src/app/(console)/reports/[client]/[reportId]/page.tsx:31` (used :408) | `const SERVICE_NAME = 'Quote Recovery'` → `{SERVICE_NAME} · {month} · prepared … · version N` | A4 report footer |
| 6 | `src/app/api/unsubscribe/route.ts:94` | `Sent by Quote Recovery on behalf of the business that quoted you.` | unsubscribe confirm + done pages (must stay byte-identical across tokens) |
| 7 | `src/core/messaging/resend-sender.ts:224` | `const identityLine = \`Sent by Quote Recovery on behalf of ${business}.\`` | cadence email footer (html + text) |
| 8 | `src/core/messaging/resend-sender.ts:230` | `from: \`"${business} via Quote Recovery" <${identity.fromAddress}>\`` | cadence email From display name |
| 9 | `src/core/alerts/operator-email.ts:47`, `src/core/alerts/stalled-drafts.ts:49` | `const DEFAULT_ALERT_FROM = 'Quote Recovery <onboarding@resend.dev>'` | operator alert From (two copies) |
| 10 | `src/core/messaging/clicksend-client.ts:57` | `const SOURCE = 'quote-recovery'` | ClickSend `source` field (provider reporting only, not customer-visible) |

Comments mentioning the old name (`resend-sender.ts:23-24, 228`; the alert modules' header comments) should be updated in passing but are not rendered.

**Verified absent:** `src/core/drafting/prompt.ts` and the SMS/template code contain no service name (grep for `recovery`/`backdesk` in `src/core/drafting` → 0 hits); no React Email templates exist (email HTML is inline in `resend-sender.ts`); `public/` holds only the default Next SVGs. `[VERIFIED]`

**Outside `src/` (must still change):**
- `scripts/verify-email-pipe.mjs:97` — `'This is a Quote Recovery pipeline test, not a real follow-up.'` lands in a real inbox during DOM-04 → `Backdesk`.
- `scripts/push-vercel-env.mjs:7,10,103` (project name / URL examples), `supabase/config.toml:5` (`project_id`).
- `docs/env-vars.md:89` (`OPERATOR_ALERT_FROM=Quote Recovery <…>` example) and the matching `.env.example` line.
- Tests pinning the strings: `tests/resend-sender.test.ts:12,128-133,244`; `tests/clicksend-sender.test.ts:279` (`expect(message.source).toBe('quote-recovery')`). `tests/inbound-threading.test.ts:120` uses `@quote-recovery-test.invalid` as a fixture domain — harmless, optional rename.
- `package.json` `"name": "quote-recovery"` — stays (BRAND-01 carve-out).

### Recommended brand module: `src/core/brand.ts` (zero imports, mirrors `audit/constants.ts`)
```ts
// src/core/brand.ts — the ONLY place the service names itself. No imports, on purpose:
// a print page, an email builder, a route handler and an alert sender all read it.
export const SERVICE_NAME = 'Backdesk';
export const APEX_DOMAIN = 'backdesk.com.au';
export const CONSOLE_HOST = 'app.backdesk.com.au';
export const SENDING_DOMAIN = 'quotes.backdesk.com.au';
export const CONSOLE_DESCRIPTION =
  'Operator console for Backdesk, the managed quote-chasing service for trade businesses.';
/** ClickSend `source` — provider-side reporting tag, never customer-visible. */
export const PROVIDER_SOURCE_TAG = 'backdesk';
/** Pre-verification alert sender: Resend's owner-only onboarding address (RESEARCH A6). */
export const DEFAULT_ALERT_FROM = `${SERVICE_NAME} <onboarding@resend.dev>`;
/** Spam Act identity line — the tradie is the sender, Backdesk only the service. */
export function identityLine(business: string): string {
  return `Sent by ${SERVICE_NAME} on behalf of ${business}.`;
}
/** From display name. Caller sanitises `business` (resend-sender `displayName`) and adds the quotes. */
export function viaDisplayName(business: string): string {
  return `${business} via ${SERVICE_NAME}`;
}
```
- Keep the **header sanitiser where it is**: `resend-sender.ts` `displayName()` strips C0/DEL, `"`, `<`, `>`, `\`, collapses whitespace and caps at 78 chars, and the test at `tests/resend-sender.test.ts:236-246` pins the exact injected-name output — call `viaDisplayName(displayName(identity.businessName))` and keep the surrounding quotes in `resend-sender.ts` so that test only changes its expected suffix. `[VERIFIED: resend-sender.ts:172-185]`
- Unsubscribe route: `identityLine('the business that quoted you')` reproduces the generic footer without resolving any tenant — preserves the byte-identical-page property the route's comments insist on `[VERIFIED: unsubscribe/route.ts:113-123]`.
- Alert modules import `DEFAULT_ALERT_FROM`; `stalled-drafts.ts:44-49` currently argues it is "imported from nowhere because it is a constant" — replace that comment.
- `src/core` is framework-free by contract (`env.ts` header) and `src/app` already imports from `@/core/...` in server components (`audits/[id]/page.tsx:5`), so both sides can import `@/core/brand`. Place it at `src/core/brand.ts` as CONTEXT suggests rather than under `shared/` — it is a product fact, not plumbing. `[VERIFIED: layout]`
- Add `tests/brand.test.ts`: (i) `brand.ts` matches `/^import /m` nowhere and exports exactly the listed names (same technique as `tests/audit-aggregate.test.ts:57-82`); (ii) `identityLine("Dave's Plumbing")` contains both `Backdesk` and the business; `buildEmailMessage(...).from` equals `"Dave's Electrical via Backdesk" <…>`; the unsubscribe `page()` output contains `Sent by Backdesk on behalf of`; (iii) **the grep as a test** — walk `src/` with `fs.readdirSync(dir, { recursive: true })` (Node ≥ 20) and assert no file matches `/quote[- ]recovery/i` — this makes D-10's acceptance criterion executable in CI.

## 6. Commercial assumptions: consumers and test pins (BRAND-02) `[VERIFIED: grep + Read, 2026-09-06]`

`src/core/audit/constants.ts` (import-free; eight exports) — verbatim lines 35, 108, 127:
```
export const AUDIT_RECOVERY_RATE = 0.15;
export const DEFAULT_BASELINE_WIN_RATE = 0.7;
export const BASELINE_MIN_QUOTES = 10;
```

| Value | Runtime consumers | Tests that pin the literal (must change if the value changes) | Tests that are value-relative (survive a change) |
|-------|-------------------|---------------------------------------------------------------|--------------------------------------------------|
| `AUDIT_RECOVERY_RATE` | `src/core/audit/aggregate.ts:28,102` (basis points → stored `recoverable_estimate`); `src/app/(console)/audits/[id]/page.tsx:5,214,281` (`ratePercent` footnote); `scripts/verify-audit.mjs:42,108` | `tests/audit-aggregate.test.ts:115` `expect(AUDIT_RECOVERY_RATE).toBe(0.15)`; `:126-132` asserts `aggregate.ts` contains no `0.15` literal (fine for any value — but if the new value's digits appear elsewhere in that file the assertion needs the new literal) | `tests/audit-aggregate.test.ts:321`, `tests/prospect-audit.test.ts:149`, `tests/convert-prospect.test.ts:247-255` (structural: page imports the constant, no `%` literal) |
| `DEFAULT_BASELINE_WIN_RATE` | `src/core/attribution/baseline.ts:21,39` (`DEFAULT_BASELINE_BP`), `:79`; `src/core/reporting/generate.ts:49,355` | `tests/audit-aggregate.test.ts:96` `toBe(0.7)` | `tests/attribution-baseline.test.ts:30` |
| `BASELINE_MIN_QUOTES` | `baseline.ts:79`; `generate.ts:48,356`; report footnote prints "fewer than N quotes" from it | `tests/audit-aggregate.test.ts:100` `toBe(10)` | `tests/attribution-baseline.test.ts:68,78` (uses `BASELINE_MIN_QUOTES ± 1`) |
| Setup-fee exclusion | `src/core/reporting/figures.ts:81-84` (`feesSetupCents` is its own field; both multiples divide by `monthlyCents`); `src/core/reporting/copy.ts:286-311` `feesNote` ("…setup fee, shown separately. The return on fees divides the conservative recovered value by the retainer only.") | `tests/reporting-copy.test.ts:352-369` (exact sentence), `tests/reporting-figures.test.ts:68`, `tests/reporting-fees.test.ts:168`, `tests/monthly-report.test.ts:464` — only change if the *policy* changes | — |

**Guard rails for the D-09 header comment:** `tests/audit-aggregate.test.ts:57-82` asserts exactly eight `export const` names and `expect(source).not.toMatch(/^import /m)` — a comment block is fine as long as no line starts at column 0 with `import ` and no new export is added. Put the pointer to `docs/commercial-assumptions.md` in the file's top JSDoc.

**If the operator changes a value:** one line in `constants.ts` + the matching literal pin(s) in `tests/audit-aggregate.test.ts` (lines 96/100/115) + `docs/commercial-assumptions.md` + `PROJECT.md`. Nothing else. **Runtime caveat:** `prospects.recoverable_estimate` is stored at audit time under the then-current rate while the page footnote renders the current constant `[VERIFIED: audits/[id]/page.tsx:205-214 comment]` — an existing stored audit would disagree with its own footnote after a rate change. The Aug-2026 fixture was torn down 4 Sep; confirm `select count(*) from prospects` is 0 at the checkpoint (or regenerate any survivors). Baselines are frozen at connect (D-06/D-09), so a `DEFAULT_BASELINE_WIN_RATE` change only affects future thin-history connects.

**Checkpoint:decision content:** present the three values + the setup-fee rule with the recommendation to keep all (rationale already in the constants' JSDoc: bottom of the 15–20% band; high baseline understates our credit; 3× guarantee quoted against the retainer). Record in `PROJECT.md` Key Decisions (replace the two `⚠ Flagged assumption` rows: "AUDIT_RECOVERY_RATE = 0.15 (conservative)" and "Default baseline win rate 0.70 when a client has < 10 quotes before connect") and create `docs/commercial-assumptions.md`.

## Architecture Patterns

### System Architecture Diagram — the coordinated switch (data flow of a URL)
```
 .env.local APP_BASE_URL ──npm run env:push──▶ Vercel env (Production+Preview)
        │                                          │ redeploy (git push / vercel redeploy)
        │                                          ▼
        │                              Vercel deployment (syd1) ◀── app.backdesk.com.au (CNAME → <hash>.vercel-dns-0xx.com)
        │                                     ▲          ▲   ▲
        ├──npm run cron:apply──▶ cron.job.command (4 jobs) ─┘   │   └── <new>.vercel.app  ── 308 ──▶ app.backdesk.com.au
        │                         net.http_post → net._http_response 200  (proof)          (generated aliases: Vercel auth wall)
        │
        └──npm run clicksend:setup──▶ ClickSend automation rules (inbound, DLR) ──POST──▶ /api/webhooks/clicksend/* ?token=…
                                       (read-back: action_address masked)

 Founder DNS host (backdesk.com.au zone)
   app            CNAME  <from vercel domains inspect>
   resend._domainkey.quotes  TXT  p=…        ┐
   send.quotes    MX 10 feedback-smtp.ap-northeast-1.amazonses.com ├─▶ Resend domain quotes.backdesk.com.au (ap-northeast-1) ──▶ status verified
   send.quotes    TXT  v=spf1 include:amazonses.com ~all          ┘        │
   _dmarc         TXT  v=DMARC1; p=none;                                    ▼
                                                              /settings/email badge "Verified" → OPERATOR_ALERT_FROM push → alerts@quotes.…
```

### Recommended file changes (no new folders)
```
src/core/brand.ts                         # NEW — single source of truth (no imports)
src/app/layout.tsx                        # title/template/description from brand
src/app/(console)/layout.tsx              # nav wordmark
src/app/login/page.tsx                    # h1
src/app/(console)/audits/[id]/page.tsx    # SERVICE_NAME → import
src/app/(console)/reports/[client]/[reportId]/page.tsx
src/app/api/unsubscribe/route.ts          # identityLine('the business that quoted you')
src/core/messaging/resend-sender.ts       # identityLine / viaDisplayName
src/core/messaging/clicksend-client.ts    # PROVIDER_SOURCE_TAG
src/core/alerts/operator-email.ts, stalled-drafts.ts   # DEFAULT_ALERT_FROM import
src/core/audit/constants.ts               # header comment → docs/commercial-assumptions.md
scripts/verify-email-pipe.mjs, scripts/push-vercel-env.mjs (comments), supabase/config.toml
docs/commercial-assumptions.md            # NEW
docs/vercel-domains-and-protection.md     # NEW (DOM-02 write-up + DNS record list)
docs/env-vars.md, .env.example, docs/external-registrations.md (dated entries)
tests/brand.test.ts                       # NEW; tests/resend-sender.test.ts, tests/clicksend-sender.test.ts updated
.planning/PROJECT.md                      # Key Decisions rows
```

### Pattern 1: Import-free constants module pinned by a structural test
**What:** A `src/core/*.ts` file with only `export const`/pure functions, whose export list and import-freedom are asserted by reading the source in a test.
**When to use:** Any value that must render identically on a print page, in an email builder, a route handler and a background job.
**Example:** `tests/audit-aggregate.test.ts:57-82` `[VERIFIED]` — replicate for `brand.ts`.

### Pattern 2: Re-point-and-read-back for every external store
**What:** Each store that embeds a URL (Vercel env, `cron.job`, ClickSend rules) is written by an idempotent script and proven by a server-side artefact, never by "the dashboard looked right".
**When to use:** All of Wave 2. The scripts already exist; the plan adds the proof queries as explicit tasks.

### Pattern 3: Configure the redirect and protection on the *new* default domain, after the rename
**What:** Domain-level settings are keyed by domain name; a rename creates a new default domain. Sequence: rename → read back new alias → PATCH redirect on it → enable Standard Protection → curl proofs.

### Anti-Patterns to Avoid
- **A second spelling of the identity line** (e.g. building the footer text in the unsubscribe route independently) — it drifts; use the builder.
- **Moving the display-name sanitiser into `brand.ts`** — the sanitiser is a header-injection control tested in `resend-sender.test.ts`; the brand module must stay a pure string source.
- **A host-conditional redirect in `next.config.ts`** — adds code and an in-app hop; CONTEXT forbids any redirect hop on the custom domain.
- **Enabling "All Deployments"** — Pro-only, and would put the ticks behind Vercel auth again (the exact Phase 2 failure).
- **Renaming before the switch** — the old `*.vercel.app` is released on rename; ticks pointed at it 401/404 silently while `cron.job_run_details` stays green.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pushing env values to Vercel | dashboard copy-paste / `vercel env add` with `--value` | `npm run env:push` (`scripts/push-vercel-env.mjs`) | The 2026-08-29 secret-mismatch incident; values never hit argv/scrollback `[VERIFIED: script header]` |
| Re-pointing pg_cron targets | hand-written `cron.schedule` SQL | `npm run cron:apply` | Replaces-never-duplicates, bearer never printed, validates the origin |
| Re-pointing ClickSend rules | ClickSend dashboard edits | `npm run clicksend:setup -- --number …` (no `--activate`) | Probes the new host with wrong tokens first (401 ⇒ deployed + env parsed), idempotent PUT by `rule_name`, masked read-back |
| Resend domain add/verify | Resend dashboard or curl | `/settings/email` console flow | Region passed explicitly, records rendered verbatim, verified-domain gate on save — and the operator will use this same screen for client domains later |
| `*.vercel.app` redirect | `next.config.ts` / proxy logic | Vercel domain "Redirect to" / `PATCH …/domains/{domain}` | Zero code, survives deploys, no hop on the custom domain |
| Brand grep acceptance | a manual `grep` in the summary | `tests/brand.test.ts` filesystem walk | Executable in CI; BRAND-01 stays true after this phase |

**Key insight:** every external mutation in this phase already has a repo script with a built-in proof; the plan's job is ordering and recording, not new tooling.

## Runtime State Inventory

> Required: this is a rename/re-point phase. Canonical question: *after every file in the repo is updated, what runtime systems still hold `quote-recovery-mvp.vercel.app` or "Quote Recovery"?*

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| **Stored data** | (1) `cron.job.command` for `sm8-sync-tick`, `cadence-tick`, `messaging-reconcile`, `stalled-digest` embeds `https://quote-recovery-mvp.vercel.app/api/internal/…` `[VERIFIED: apply-cron-schedules.mjs commandFor; STATE.md 2026-08-29 entry]`. (2) `prospects.recoverable_estimate` derived from `AUDIT_RECOVERY_RATE` at audit time — only matters if the rate changes; fixture torn down 4 Sep, expect 0 rows `[VERIFIED: memory + page comment]`. (3) No stored rendered copy contains the service name: report `copy.ts` and `figures` hold no "Quote Recovery" `[VERIFIED: grep src/core/reporting]`; `send_ledger`/`inbound_messages` store no URLs. (4) Unsubscribe links already in customers' inboxes: none — no email has ever been sent (MSG-02 deferred) `[VERIFIED: external-registrations.md:707-713]` | (1) **data migration** via `npm run cron:apply` + `net._http_response` 200 proof. (2) verify count = 0 at the decision checkpoint. (3)(4) none |
| **Live service config** | (1) ClickSend automation rules (inbound + DLR) `action_address` → old origin `[VERIFIED: setup-clicksend.mjs; external-registrations 2026-08-29]`. (2) Vercel env `APP_BASE_URL` (Production + Preview) `[VERIFIED: vercel env ls]`. (3) Vercel project domain list (`quote-recovery-mvp.vercel.app`, no redirect) and Deployment Protection (`ssoProtection: null`) `[VERIFIED: api]`. (4) Resend: no webhooks; no verified domain `[VERIFIED]`. (5) Supabase Auth Site URL / redirect allow-list — unknown, may hold the old host `[ASSUMED]`. (6) ServiceM8 partner app 000000 (Draft) — no live callback `[VERIFIED: docs]` | (1) `npm run clicksend:setup` + read-back. (2) `npm run env:push` + redeploy. (3) attach domain, PATCH redirect on the *new* default domain after rename, enable Standard Protection; regenerate the stray bypass secret. (4) create + verify `quotes.backdesk.com.au` via console. (5) check dashboard at the rename checkpoint; update if set. (6) none |
| **OS-registered state** | None — Vercel serverless, no pm2/launchd/Task Scheduler. Local-only link files: `.vercel/project.json` (`projectName` stale after rename; `projectId` unchanged) and `supabase/config.toml` `project_id` (label for local CLI state only) `[VERIFIED: files read]` | `vercel link --yes --project backdesk`; edit `supabase/config.toml:5`. Verified by re-reading both files |
| **Secrets / env vars** | No secret *names* change. Values: `APP_BASE_URL` (new host), `OPERATOR_ALERT_FROM` (new, optional, after Resend verifies). `.env.local` gains another `VERCEL_OIDC_TOKEN` block on re-link (gitignored) `[VERIFIED: STATE.md:390]`. CI dummies in `.github/workflows/ci.yml` unaffected (no new REQUIRED var) `[VERIFIED: docs/env-vars.md keep-in-sync rule]` | none beyond the two value pushes |
| **Build artifacts / installed packages** | The running Vercel production deployment holds the env it booted with — a redeploy is mandatory after `env:push` `[VERIFIED: push-vercel-env.mjs:52-56]`. Local `.next/` and `tsconfig.tsbuildinfo` are ephemeral. `package.json` name stays `quote-recovery` by decision | redeploy (git push of the brand commit suffices) |

## Common Pitfalls

### Pitfall 1: Records requested before the zone exists
**What goes wrong:** Vercel and Resend both show "pending" forever; `dig` returns NXDOMAIN.
**Why it happens:** `backdesk.com.au` has no nameservers delegated today `[VERIFIED: dig +trace 2026-09-06]`.
**How to avoid:** First checkpoint = founder picks a DNS host and delegates; plan proves `dig backdesk.com.au NS` returns the host's servers before printing any record list.
**Warning signs:** `vercel domains inspect` reports no A/CNAME found for minutes after the founder says "done".

### Pitfall 2: Renaming while anything still points at the old host
**What goes wrong:** `cron.job_run_details` stays green while the ticks 404/401 against a released `*.vercel.app`; no sync, no sends, no alerts, ClickSend replies dropped at the door.
**Why:** Rename releases the old default domain (Vercel KB); pg_cron and ClickSend cannot follow.
**How to avoid:** D-06 order; `net._http_response` 200 on the custom domain and the ClickSend read-back are prerequisites of the rename task.
**Warning signs:** any `status_code` other than 200 in `net._http_response` after the switch.

### Pitfall 3: Redirect configured on the wrong (soon-to-vanish) domain
**What goes wrong:** Redirect set on `quote-recovery-mvp.vercel.app` disappears with the rename; the new `backdesk-<suffix>.vercel.app` serves the console unredirected.
**How to avoid:** configure the redirect after the rename, on the alias `vercel project ls` reports; curl-prove the `location` header.

### Pitfall 4: `cron:apply` overlapping a remote test run
**What goes wrong:** `global-setup.ts` paused `cadence-tick` by jobid; `cron:apply` replaced the job (new id, active); teardown re-queries by name and re-arms — usually fine — but a run killed mid-way can leave the watchdog lease pointing at ids that no longer exist, or leave a tick inactive. `[VERIFIED: global-setup.ts header + lines 185-292]`
**How to avoid:** never overlap; after any `cron:apply`, assert all four jobs `active = t`.

### Pitfall 5: The `.env*` deny rule
**What goes wrong:** `docs/env-vars.md` records that this workspace denies writes to `.env*`; `.env.example` exists (15,990 bytes, currently modified in git status) but could not be read this session `[VERIFIED: permission denial]`. The executor may be unable to update its `OPERATOR_ALERT_FROM` example line.
**How to avoid:** update `docs/env-vars.md` (the declared mirror) and ask the operator to mirror the one line into `.env.example` if the tool is blocked; do not fail the task on it.

### Pitfall 6: Expecting a Vercel-auth 401 to look like our 401
**What goes wrong:** After enabling protection, a wrong-token probe on a *generated* alias returns Vercel's HTML 401 (with `set-cookie: _vercel_sso_nonce`), which is not evidence the route works.
**How to avoid:** prove the ticks only on `app.backdesk.com.au` and with the real-token probes that `clicksend:setup` already performs (200s).

### Pitfall 7: Trimming or proxying DNS values
**What goes wrong:** DKIM verifies then fails alignment; CNAME behind a proxy never verifies.
**How to avoid:** paste verbatim from the console/`vercel domains inspect`; DNS-only records. `[CITED: resend add-a-domain; resend-domains.ts header]`

### Pitfall 8: DMARC `rua` to a mailbox on another domain
**What goes wrong:** Reports never arrive; some receivers treat an unauthorised external `rua` as a malformed policy.
**Why:** RFC 7489 §7.1 requires the receiving domain to publish an authorisation record for external report addresses. `[ASSUMED — RFC knowledge, not fetched]`
**How to avoid:** publish `v=DMARC1; p=none;` without `rua` this phase, or use a mailbox on `backdesk.com.au` once one exists.

### Pitfall 9: Breaking the structural tests with the header comment
**What goes wrong:** `tests/audit-aggregate.test.ts` fails on a ninth export or a line starting with `import `.
**How to avoid:** comment-only change; keep the eight exports.

## Code Examples

### Brand-aware From header (keeps the sanitiser and the quotes in `resend-sender.ts`)
```ts
// src/core/messaging/resend-sender.ts — Source: this repo, lines 218-231 today; brand import added
import { identityLine, viaDisplayName } from '@/core/brand';
// …
const business = displayName(identity.businessName);          // header-injection control stays here
const line = identityLine(business);                          // "Sent by Backdesk on behalf of Dave's Electrical."
return {
  from: `"${viaDisplayName(business)}" <${identity.fromAddress}>`,   // "Dave's Electrical via Backdesk" <…>
  // …html/text use `line`; headers unchanged (List-Unsubscribe, List-Unsubscribe-Post)
};
```

### The grep as a test (BRAND-01 acceptance)
```ts
// tests/brand.test.ts — Node ≥ 20 recursive readdir, no glob dependency
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
it('renders no "Quote Recovery" anywhere under src/', () => {
  const offenders = readdirSync('src', { recursive: true })
    .map((p) => join('src', String(p)))
    .filter((p) => statSync(p).isFile() && /\.(tsx?|css|mjs)$/.test(p))
    .filter((p) => /quote[- ]recovery/i.test(readFileSync(p, 'utf8')));
  expect(offenders).toEqual([]);
});
```

### Proof queries (session pooler, bearer never printed)
```sql
-- Source: pattern from docs/external-registrations.md (Phase 3/4 standard)
select jobname, schedule, active,
       substring(command from 'url := ''([^'']+)''') as url
  from cron.job
 where jobname in ('sm8-sync-tick','cadence-tick','messaging-reconcile','stalled-digest')
 order by jobname;
select status_code, created
  from net._http_response
 where created > now() - interval '3 minutes'
 order by created desc limit 5;   -- expect 200s from the per-minute cadence-tick
```

### Redirect + protection via REST (if the dashboard is not used)
```bash
# Source: vercel.com/docs/rest-api/projects/update-a-project-domain ; …/vercel-authentication
curl -X PATCH "https://api.vercel.com/v9/projects/backdesk/domains/<new-default>.vercel.app?teamId=team_XXXXXXXX" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
  -d '{"redirect":"app.backdesk.com.au","redirectStatusCode":308}'
curl -X PATCH "https://api.vercel.com/v9/projects/backdesk?teamId=team_XXXXXXXX" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
  -d '{"ssoProtection":{"deploymentType":"prod_deployment_urls_and_all_previews"}}'
# proofs
curl -sI https://<new-default>.vercel.app/login | grep -i '^location'          # https://app.backdesk.com.au/login
curl -sI https://backdesk-git-main-hesams-projects-432a48c6.vercel.app/login | head -1   # 401 (protected)
curl -sI https://app.backdesk.com.au/login | head -1                              # 200 (public)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Generic `cname.vercel-dns.com` for every subdomain | Project-specific CNAME target (`<hash>.vercel-dns-0xx.com`), read from `vercel domains inspect` | 2025–2026 (docs updated 2026-08-28) | Do not hard-code the target in the plan; print it from the CLI |
| Standard Protection excluded production generated URLs | Standard Protection covers all generated domains incl. `project-git-main.vercel.app`; only production *domains* stay public | 2025-07-14 changelog | The `-git-main-` alias becomes private; `app.backdesk.com.au` and `<project>.vercel.app` stay public |
| "Only Preview Deployments" scope | Legacy "(Legacy) Pre-Production Deployments"; Hobby uses Standard Protection | 2025 | Explains the Phase 2 finding; Standard is the right (and only) Hobby choice |
| `vercel domains` had no DNS check | `vercel domains verify <domain> --project <p> --format=json` | CLI changelog "verifying DNS configuration"; present in 59.10 `[VERIFIED]` | Machine-readable proof for the human-verify checkpoint |
| Resend DKIM via CNAME to amazonses | TXT `resend._domainkey` DKIM (CNAME form still appears in API examples) | — | Accept whichever the console renders |

**Deprecated/outdated:**
- The ROADMAP's "re-create the deploy hook" step — no deploy hook exists on the project `[VERIFIED: api]`.
- CONTEXT's "three pg_cron targets" — there are four (`stalled-digest` added in 06-02) `[VERIFIED: apply-cron-schedules.mjs]`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `<project>.vercel.app` (the default production domain) stays public under Standard Protection, so its redirect fires before any auth wall | §2 (b) | DOM-01's "redirects there" holds only for logged-in Vercel users; document and accept, or drop the redirect expectation |
| A2 | The renamed project's default domain will be `backdesk-<suffix>.vercel.app` with some Vercel-chosen suffix | §1 | None functional; read the real alias back before configuring the redirect |
| A3 | Vercel domain verification also fails behind a proxying CDN (Cloudflare orange cloud) | §1 | Slower cert issuance; instruct DNS-only regardless (Resend requires it anyway) |
| A4 | 308 is the right redirect status for the default domain | §1 | Cosmetic; 307 also acceptable |
| A5 | A `_dmarc.backdesk.com.au` TXT does not conflict with D-05's "apex reserved for Phase 9" | §3 | If the operator disagrees, publish `_dmarc.quotes.backdesk.com.au` instead (also valid) |
| A6 | External-domain DMARC `rua` needs an authorisation record on the receiving domain (RFC 7489 §7.1) | Pitfall 8 | Reports silently not delivered; no delivery impact |
| A7 | Supabase Auth Site URL / redirect list may reference the old host | §4, Runtime State | Password-reset links could point at a dead host; check at checkpoint |
| A8 | Resend's console for this account returns the TXT-DKIM record shape (vs the CNAME example) | §3 | None — console renders whatever is returned |

## Open Questions (RESOLVED)

All five were resolved during plan-phase (2026-09-06); each carries the plan/task that implements the answer.

1. **Which DNS host for `backdesk.com.au`?** (blocking)
   - What we know: registered, ACTIVE, **no nameservers** at the registry; founder does DNS per launch plan.
   - What's unclear: registrar identity (whois output is minimal) and whether its DNS is adequate.
   - Recommendation: registrar DNS or Cloudflare (DNS-only) if the founder wants to own the zone; Vercel nameservers if scriptability (`vercel dns add`, `vercel dns ls` read-backs) is preferred — but that moves the apex to Vercel before Phase 9 decides. Present as the first `checkpoint:decision`.
   - **RESOLVED:** the founder chooses at the 08-04 Task 1 `checkpoint:decision` (options `registrar-dns` — recommended — / `cloudflare-dns-only` / `vercel-nameservers`); the decision and date are written into `docs/vercel-domains-and-protection.md` §1 and the 08-04 Task 2 evidence entry. The zone stays with the founder; the agent never creates a DNS record (D-05).
2. **DMARC `rua` mailbox** — none exists on `backdesk.com.au`. Recommendation: `p=none` without `rua` now; revisit when a mailbox exists.
   - **RESOLVED:** `v=DMARC1; p=none;` with no `rua`. The record shape is fixed in 08-01 Task 3 (§3 of the DOM reference; `grep -ci 'rua='` must print 0), listed for the founder in the 08-04 Task 2 record table, and 08-07 carries the prohibition (MUST NOT publish a `rua=` mailbox on another domain, MUST NOT tighten beyond `p=none` this phase). Revisit when a mailbox exists on `backdesk.com.au`.
3. **Cadence from-address local part** on the service domain — `followups@quotes.backdesk.com.au` recommended (tests already use `followups@`); the form placeholder says `quotes@`. Decide and document in `docs/vercel-domains-and-protection.md` or the go-live runbook (Phase 10).
   - **RESOLVED:** `followups@quotes.backdesk.com.au`. Documented as the convention in 08-01 Task 3 (§4 "From-address conventions"); the email-settings form placeholder changes from `quotes@` to `followups@` in 08-02 Task 3; 08-07 Task 2 fills §4 with the conventions as live.
4. **Alert-from proof** — the stalled digest is silent when empty, so the `alerts@quotes.backdesk.com.au` From header may not be observable until the first real alert. Recommendation: record the env push + redeploy as the artefact, and flag the header check as event-gated (same shape as MSG-02).
   - **RESOLVED:** event-gated, as recommended. 08-07 Task 1 pushes `OPERATOR_ALERT_FROM` to Production + Preview, redeploys, and records the `vercel env ls` read-back as the artefact; the From-header observation is recorded as outstanding for the first real alert / the Phase 10 go-live checklist (also listed under Manual-Only Verifications in `08-VALIDATION.md`). No production fixture is manufactured.
5. **Existing Protection Bypass secret** — created outside this repo's history; regenerate/delete during DOM-02 and state in docs that no automation uses one.
   - **RESOLVED:** revoked in 08-06 Task 3 step 3 (`PATCH /v1/projects/backdesk/protection-bypass` with `revoke: { secret, regenerate: false }`; dashboard Remove/Regenerate as the fallback) and documented as unused in `docs/vercel-domains-and-protection.md` §7 (step 5); only "removed"/"regenerated" + date is recorded, never a value.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 `[VERIFIED: package.json]` |
| Config file | `vitest.config.mts` (alias `@` → `src`, `setupFiles: tests/helpers/env.ts`, `globalSetup: tests/helpers/global-setup.ts`, `fileParallelism: false`, 30 s timeouts) `[VERIFIED]` |
| Quick run command | `npx vitest run tests/brand.test.ts tests/resend-sender.test.ts tests/unsubscribe.test.ts tests/clicksend-sender.test.ts tests/audit-aggregate.test.ts` — pure suites run BARE, with no `ALLOW_REMOTE_TESTS`, and pause no production tick: the WR-09 gate in `tests/helpers/env.ts` fires on the first credential read (`resolveTestEnv()`, lines 107-125), not on file load, so a suite that never touches `testEnv` never trips it `[VERIFIED: env -u ALLOW_REMOTE_TESTS npx vitest run tests/audit-aggregate.test.ts → 27 passed, 773 ms, no tick pause, 2026-09-06]`. (Correction: an earlier draft of this row claimed the opt-in was required and that the global setup would pause the ticks — wrong for pure suites; `08-VALIDATION.md` is authoritative.) |
| Full suite command | CI `npx vitest run` on the local Supabase stack (`.github/workflows/ci.yml`: lint → `next build` with placeholder env → suite) `[VERIFIED]`. Locally the DB-backed suites need `npm run test:remote`, which pauses the two production tick jobs — **never during Plans 08-05..08-07 (the URL switch) and never overlapping `npm run cron:apply`**; the phase relies on CI for those suites |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BRAND-01 | No `quote[- ]recovery` under `src/`; title/nav/login/footers read Backdesk | unit (filesystem walk + builders) | `npx vitest run tests/brand.test.ts` (bare — no opt-in, no tick pause) | ❌ Wave 0 |
| BRAND-01 | `brand.ts` is import-free with a fixed export list | unit (structural) | same file | ❌ Wave 0 |
| BRAND-03 | From = `"{business} via Backdesk" <verified addr>`, identity line + `on behalf of` in html/text, List-Unsubscribe headers intact, header-injection sanitiser intact | unit | `… tests/resend-sender.test.ts` (lines 128-133, 177-178, 236-246 updated) | ✅ update pins |
| BRAND-03 | Unsubscribe pages byte-identical, footer names Backdesk; STOP + one-click suppression unchanged | unit (pure, local) + integration (CI local stack) | `… tests/unsubscribe.test.ts` bare locally; `tests/unsubscribe-suppression.test.ts tests/inbound-stop.test.ts` are DB-backed — CI only, never `test:remote` during 08-05..08-07 (unchanged, must stay green) | ✅ |
| BRAND-01 | ClickSend `source` tag = `backdesk` | unit | `… tests/clicksend-sender.test.ts` (line 279 updated) | ✅ update pin |
| BRAND-02 | Constants file: eight exports, no imports, pinned values; audit page derives `ratePercent`; report copy states setup fee excluded | unit (structural) | `… tests/audit-aggregate.test.ts tests/reporting-copy.test.ts tests/attribution-baseline.test.ts` bare locally; `tests/convert-prospect.test.ts` is DB-backed — CI only | ✅ (pins change only if values change) |
| DOM-01 | Scripts derive URLs from `APP_BASE_URL` with no literal | unit (structural) | `… tests/cron-schedules.test.ts` — DB-backed (`tests/helpers/seed`), CI only | ✅ |
| DOM-01 | Console at `https://app.backdesk.com.au` on a phone; `<new>.vercel.app` → 308 to it; syd1 intact | **live-only** | `curl -sI` proofs + `vercel domains verify --format=json` + `vercel.json` unchanged | manual — record in `docs/vercel-domains-and-protection.md` + external-registrations entry |
| DOM-01 | Ticks and webhooks re-pointed | **live-only** | `cron.job` url read-back, `net._http_response` 200, `clicksend:setup` read-back | manual — record |
| DOM-02 | Previews + generated aliases 401; custom domain 200; ticks still 200 after enabling | **live-only** | `curl -sI` on three hosts + `net._http_response` after enabling | manual — record |
| DOM-03 | Region pinned `ap-northeast-1`; records passed verbatim | unit | `… tests/resend-domains.test.ts` | ✅ |
| DOM-03 | `/settings/email` shows `quotes.backdesk.com.au` Verified; `OPERATOR_ALERT_FROM` pushed | **live-only** | screenshot-free: `vercel env ls production` line + console badge + `dig` of the three records | manual — record |

### Sampling Rate
- **Per task commit:** the bare quick run above plus `npm run typecheck && npm run lint` (≈ 3 s for the pure suites; no tick pause — nothing in the quick run reads a credential).
- **Per wave merge:** push `main`; the CI full suite (local stack) must be green before the next wave. `npm run test:remote` is NOT part of the per-wave loop and is prohibited during Plans 08-05..08-07 — it pauses the production ticks mid-switch (Pitfall 4).
- **Phase gate:** CI green on `main` (full suite on the local stack + `next build`) before `/gsd-verify-work`; all live proofs recorded with artefacts.

### Wave 0 Gaps
- [ ] `tests/brand.test.ts` — covers BRAND-01 (grep-as-test, export list, builders) and BRAND-03 (identity line / via name / unsubscribe footer)
- [ ] Update `tests/resend-sender.test.ts` (3 expectations + comments) and `tests/clicksend-sender.test.ts:279`
- [ ] No framework install needed

## Security Domain

### Applicable ASVS Categories (Level 1)
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | Supabase email+password via `@supabase/ssr`; host move only means cookies are re-issued on the new host. Check Supabase Auth Site URL (A7) |
| V3 Session Management | no change | `proxy.ts` `updateSession`; unaffected by domain |
| V4 Access Control | yes (platform) | Vercel Authentication + Standard Protection re-fences preview deployments that share production env `[VERIFIED: Preview env holds the secrets]`; internal routes keep their per-endpoint bearers; `proxy.ts` `/api/` exclusion still relies on those bearers |
| V5 Input Validation | yes | `OPERATOR_ALERT_FROM` stays `z.string().min(1)`; display-name sanitiser (`displayName`) unchanged and pinned; unsubscribe route stays token-oblivious |
| V6 Cryptography | no change | HMAC unsubscribe tokens; TLS certs auto-issued by Vercel for the new host |
| V13 API / webhooks | yes | ClickSend `?token=` URLs re-issued with the same secrets; wrong-token probes must 401 on the new host before rules are updated (script enforces) |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Header injection via business name into the new `via Backdesk` display name | Tampering/Spoofing | Keep `displayName()` in `resend-sender.ts`; test `tests/resend-sender.test.ts:236-246` |
| Ticks/webhooks left pointing at a released `*.vercel.app` (silent outage; dropped STOPs) | DoS / Repudiation | D-06 order; `net._http_response` 200 and rule read-back before rename |
| Preview deployments as an unauthenticated front door to production data/providers | Elevation | Standard Protection (Hobby) + existing Supabase login + bearers |
| Stray Protection Bypass secret (read through the API this session) | Information disclosure | Regenerate/delete; document that none is used |
| DNS takeover / wrong records at the registrar | Tampering | Founder-only DNS edits, registrar 2FA (out of repo); verbatim values; `dig` read-backs recorded |
| Redirect loop or hop on the custom domain | DoS | Redirect only on the default `*.vercel.app` domain; nothing in `next.config.ts` |
| Spam Act misidentification after the swap | Compliance | Identity line + `via` name + footer all from one builder; `tests/brand.test.ts` |

## Sources

### Primary (HIGH confidence — read/probed this session)
- Codebase: `src/core/shared/env.ts`, `src/core/messaging/{resend-sender,resend-domains,routing-sender,clicksend-client}.ts`, `src/core/alerts/{operator-email,stalled-drafts}.ts`, `src/app/layout.tsx`, `src/app/(console)/{layout,settings/email/*,audits/[id]/page,reports/[client]/[reportId]/page}.tsx`, `src/app/login/page.tsx`, `src/app/api/unsubscribe/route.ts`, `src/core/audit/constants.ts`, `src/core/reporting/{figures,copy}.ts`, `src/db/repository/messaging-config.ts`, `scripts/{push-vercel-env,apply-cron-schedules,setup-clicksend,verify-email-pipe}.mjs`, `vercel.json`, `.vercel/project.json`, `supabase/config.toml`, `proxy.ts`, `next.config.ts`, `vitest.config.mts`, `tests/helpers/{env,global-setup}.ts`, the tests named above, `docs/{env-vars,external-registrations,servicem8-api-notes,gtm/backdesk-launch-plan}.md`, `.planning/{PROJECT,STATE,ROADMAP,REQUIREMENTS}.md`, `02-UAT.md`
- Live state: `api.vercel.com` `/v9/projects/quote-recovery-mvp`, `/v9/projects/…/domains`, `/v2/teams/…` (via the CLI's stored session); `vercel whoami/project ls/project inspect/domains ls/env ls`; `dig` (+trace) for `backdesk.com.au`, `app.`/`quotes.` subdomains, `quote-recovery-mvp.vercel.app`, `backdesk.vercel.app`; `whois backdesk.com.au`; `npm view resend version`; `node_modules/resend/dist/index.d.mts`

### Secondary (MEDIUM confidence — official docs fetched 2026-09-06)
- vercel.com/docs/deployment-protection (updated 2026-08-28); …/methods-to-protect-deployments/vercel-authentication; …/methods-to-bypass-deployment-protection/protection-bypass-automation; vercel.com/changelog/more-secure-deployment-protection (2025-07-14); …/protect-past-production-deployments-with-deployment-protection (2023-11-02)
- vercel.com/docs/domains/working-with-domains/add-a-domain; …/deploying-and-redirecting; vercel.com/docs/domains/set-up-custom-domain; vercel.com/docs/cli/domains; vercel.com/docs/cli/link; vercel.com/docs/deployments/generated-urls; vercel.com/docs/project-configuration/general-settings; vercel.com/kb/guide/how-do-i-change-the-name-of-my-vercel-project; vercel.com/docs/rest-api/projects/update-a-project-domain; vercel.com/kb/guide/avoiding-duplicate-content-with-vercel-app-urls
- resend.com/docs/add-a-domain; resend.com/docs/dashboard/domains/regions; resend.com/docs/dashboard/domains/dmarc; resend.com/docs/api-reference/domains/create-domain; resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain

### Tertiary (LOW confidence)
- RFC 7489 §7.1 external-report authorisation (from training; A6)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nothing new installed; versions read from `package.json`/registry
- Codebase inventory (strings, consumers, tests): HIGH — every claim from `Read`/`grep` this session with line numbers
- Vercel behaviour: MEDIUM — official docs + live API state; A1 (default domain public under Standard) needs the curl proof
- Resend behaviour: MEDIUM — official docs; the console renders the authoritative record set
- Environment: HIGH on the DNS-delegation blocker (authoritative NXDOMAIN); the Resend/ClickSend account states are from the repo's own logs, not probed

**Research date:** 2026-09-06
**Valid until:** 2026-10-06 for platform docs (Vercel protection/domain docs move often — re-check the Standard Protection note if the plan slips); indefinitely for the codebase inventory until Phase 8 executes
