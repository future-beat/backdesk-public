# Phase 8: Brand & Domains - Context

**Gathered:** 2026-09-06 (decisions taken in the research/product thread on 6 Sep 2026; no separate discuss-phase run)
**Status:** Ready for planning

<domain>
## Phase Boundary

The service presents as **Backdesk** on every surface a prospect or client sees (Quote Leakage Audit page, monthly recovered-revenue report, cadence email identity line and footer, unsubscribe page, operator alert emails, console title/nav/login), on its own domains (`app.backdesk.com.au` for the console, `quotes.backdesk.com.au` as the Resend sending domain), with Vercel preview deployments protected again, the Vercel project renamed as part of the same coordinated URL switch, and the three commercial assumptions the audit and the invoice depend on confirmed by the operator and recorded. Requirements: BRAND-01, BRAND-02, BRAND-03, DOM-01, DOM-02, DOM-03.

Not in this phase: the public landing page on the apex `backdesk.com.au` (Phase 9), the live email proof MSG-02 / DOM-04 and arming (Phase 10), any visual restyle beyond the name (see D-04).

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<specifics>
## Specific Ideas

- "Sent by Backdesk on behalf of Dave's Plumbing" is the reference phrasing for every footer; the tradie is the sender, Backdesk is only the service.
- The console must still open fast on a phone between sales meetings; nothing in this phase may add a redirect hop on the custom domain itself.
- `backdesk.vercel.app` belongs to someone else (a Chinese chat admin console) — do not attempt to claim it; the suffixed default URL is fine because nothing will reference it.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Brand and GTM decisions
- `docs/gtm/backdesk-launch-plan.md` — settled decisions (name, ownership, domains, handles), Cowork/Code split, what Phase 8 delivers vs what M1 supplies
- `.planning/PROJECT.md` §Key Decisions — the two "⚠ Flagged assumption" rows this phase closes, the Vercel Authentication (Hobby) decision, MSG-02 deferral
- `.planning/ROADMAP.md` §Phase 8 — success criteria + the Vercel-rename planning note

### External registrations and scripts
- `docs/external-registrations.md` — Resend (`onboarding@resend.dev` state, no verified domain), ClickSend rules, Vercel env, `APP_BASE_URL` history
- `docs/env-vars.md` — env contract; `scripts/push-vercel-env.mjs` (`npm run env:push`) — how values reach Vercel without printing
- `scripts/apply-cron-schedules.mjs` (`npm run cron:apply`) — pg_cron targets derived from `APP_BASE_URL`; the Phase 3 proof standard (server-side 200 in `net._http_response`)
- `scripts/setup-clicksend.mjs` — inbound + DLR webhook rules derived from `APP_BASE_URL`
- `vercel.json` — `regions: ["syd1"]` must survive; `.vercel/project.json` — link file to refresh after the rename
- `supabase/config.toml` — `project_id` rename

### Code surfaces
- `src/core/messaging/resend-sender.ts` — identity line, from display name, per-client vs service sending identity
- `src/core/messaging/resend-domains.ts` + `src/app/(console)/settings/email/page.tsx` + `forms.tsx` — domain add/verify flow the operator will use for `quotes.backdesk.com.au`
- `src/core/alerts/operator-email.ts`, `src/core/alerts/stalled-drafts.ts` — `DEFAULT_ALERT_FROM`
- `src/app/api/unsubscribe/route.ts` — footer copy
- `src/app/(console)/audits/[id]/page.tsx`, `src/app/(console)/reports/[client]/[reportId]/page.tsx` — `SERVICE_NAME` footers on the two A4 pages
- `src/core/audit/constants.ts`, `src/core/attribution/baseline.ts`, `src/core/reporting/figures.ts`, `src/core/reporting/copy.ts` — the three assumptions and the setup-fee exclusion

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Resend domain management already exists end to end (list/get/add/verify + DNS record table rendered in the console) — no new Resend code needed, only the operator flow and the from-address defaults.
- `scripts/*.mjs` operational scripts already parameterise on `APP_BASE_URL` — the URL switch is "re-run the scripts with the new value and re-prove", not new code.
- Print-styled A4 audit and report pages share a footer pattern (`{SERVICE_NAME} · prepared …`) — replace the constant, keep the layout.

### Established Patterns
- Env is parsed once (`getServerEnv`) with zod; new config values follow that path and get a `docs/env-vars.md` row and an `.env.example` line.
- Every live proof in this repo is recorded with an observable server-side artefact (cron `net._http_response` 200, ClickSend rule read-back, webhook row), never "the dashboard looked right". Keep that standard.
- Tenant safety: nothing here touches tenant-scoped queries; the brand module is pure.

### Integration Points
- `APP_BASE_URL` fans out to: unsubscribe links (RFC 8058), cron targets, ClickSend webhook URLs, operator alert links, the console's absolute links. Changing it is the riskiest step in the phase — sequence per D-06.
- Vercel Deployment Protection was disabled in Phase 2 because it blocked the cron tick and prospect pages on the Hobby plan; re-enabling is safe only because the tick now targets a custom production domain (confirm in research).

</code_context>

<deferred>
## Deferred Ideas

- Landing page on the apex `backdesk.com.au` + host-based routing between marketing site and console — Phase 9
- Applying the M1 wordmark/colour/type across audit, report, emails, login — quick task after the Cowork build request lands (or folded into Phase 9's UI-SPEC)
- Live cadence email proof on `quotes.backdesk.com.au` (MSG-02 / DOM-04) and arming — Phase 10
- `backdesk.au` — parked; consider a redirect to `.com.au` when the landing page ships
- Trade mark — deferred to incorporation (not a code item)

</deferred>

---

*Phase: 08-brand-domains*
*Context gathered: 2026-09-06*
