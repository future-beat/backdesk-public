# Quote Recovery MVP

## What This Is

The delivery system behind a managed quote-recovery service for Perth trade businesses: it connects to a client's ServiceM8 account, chases every open quote through a human-supervised, AI-drafted SMS + email cadence until it's won or dead, and proves its value with a Quote Leakage Audit for prospects and a monthly recovered-revenue report for clients. The founder is the only operator initially; tradies and their customers never see a dashboard — they see polite follow-ups in the tradie's own voice and reports in dollars.

## Core Value

Every open quote gets followed up on time, with a human-approved message, and every recovered job is attributed and reported in dollars — the invoice must arrive stapled to proof it paid for itself.

## Business Context

- **Customer**: Perth trade businesses (1–10 staff, $2k–50k quoted jobs, ServiceM8 users); founder-led sales, one plan at $397/mo (Call Catcher; Back Desk tier removed 17 Oct 2026), no setup fee, first 30 days free (founding-five offer withdrawn 16 Oct 2026)
- **Revenue model**: Monthly retainer, one plan: $397 Call Catcher (was Quote Chaser; renamed 16 Oct 2026 with the missed-call positioning and repriced the same day from $597 + $990 setup). The $797 Back Desk tier (was Pipeline Manager) was removed 17 Oct 2026 (founder) and its extras (dormant backlog, invoice chasing, review requests) are not offered. No setup fee, first 30 days free then billed from day 31, month-to-month, 3×-fees-in-90-days guarantee
- **Success metric**: Recovered revenue per client per month (target ≥3× fees); day-120 target 15 clients / ~$9k MRR
- **Strategy notes**: GTM plan — https://claude.ai/code/artifact/71b8721e-6431-4332-8594-17e129e96ff0 (Parts I–II linked from there)

## Current State

**Shipped v1.2 Missed-call text-back on 2026-10-15** (Phases 11–15; archive `milestones/v1.2-ROADMAP.md`, audit `milestones/v1.2-MILESTONE-AUDIT.md`). Capture, instant text-back, the lead cadence, lead classification and escalation, ServiceM8 job creation, lead resolution, the lead console, missed-call reporting, the partner CSV and 90-day pseudonymisation are deployed and inert: zero leads, nothing armed, every live proof event-gated on the first founding client. Next milestone not yet defined — `/gsd-new-milestone`.

## Next Milestone Goals (candidates)

- Sign and onboard the first founding client and run the 15-item first-client proof list (the real v1.2 close).
- Bedrock Sydney + Vercel OIDC federation for AU inference residency.
- Lead dollars attribution once a lead-born job has been won.
- Client-reported call totals, booking-form variable, MMS, per-client SMS numbers (deferred from v1.2).

<details>
<summary>Previous: v1.2 Missed-call text-back (as planned 2026-09-27)</summary>

## v1.2 Missed-call text-back (planned)

**Goal:** Every missed inbound call to a client's diverted number gets a text within seconds, becomes a human-supervised lead that is chased briefly, escalated when hot and written into ServiceM8 on intent — and the whole thing produces Backdesk's first-party missed-call data.

**Target features:**
- Divert capture: an Australian number Backdesk controls takes the client's no-answer divert, plays a short greeting and hangs up, logging the missed call (caller, time, client, after-hours flag); the call is not recorded
- Instant text-back from the client's identity within seconds through the existing SMS number, with the Spam Act identity line and opt-out on every message
- Leads: a lead object with a short supervised cadence (2–3 touches over ~48 hours, human-approved), replies classified, hot leads escalated to the tradie's phone via the existing escalation path, a ServiceM8 job created on confirmed intent
- Console: lead queue and per-client missed-call log; text-back armed per client behind the same arming gate as SMS
- Reporting: missed-call rate, after-hours share, reply rate and leads-to-jobs in the monthly report, plus a design-partner stats export that replaces vendor statistics in the sales deck
- Carried forward from v1.1: Phase 10's two live proofs (CON-03 handset, MSG-02/DOM-04 email), still gated on the first signed client

**Key context:** Stage 0 of the trajectory in `docs/reports/Avoca AI and an Australian equivalent.md` (27 Sep 2026): copying Avoca is the wrong frame for Australia; the durable position is the workflow after the call. This milestone reuses the SMS, classification, escalation, console and reporting stack; no voice AI; tooling stays within the A$200/month budget; telephony provider decided in research. Marketing continues in the Cowork thread.

</details>

## Requirements

### Validated

- ✓ ServiceM8 integration: per-client sync (private API key + edit_date-cursor polling), won/lost status-transition events, auth-failure pause + operator alert — Phase 2 (OAuth + webhook activation pending partner approval; polling is the guarantee)
- ✓ Quote Leakage Audit: one-page A4 report from read-only API key or CSV export, baseline win-rate snapshot for net-of-baseline attribution — Phase 2
- ✓ Cadence engine: 5-touch stateful sequence, materialized contact-hours-aware sends, idempotent send ledger, JIT revalidation — Phase 3
- ✓ Messaging gateway: two-way SMS on a dedicated AU number (live-proven end-to-end), deterministic STOP before any LLM with both-channel suppression, delivery receipts + reconcile guarantee, inbound threading with triage-not-guess — Phase 4 (email pipe built + unit-tested; live proof deferred by override to first-client onboarding)
- ✓ AI drafting & classification: Claude-drafted touches (sonnet-5) from approved templates + voice profile with a verbatim price/date validator; reply classification (opus-5, schema-only, no tools, least-privilege) with low-confidence triage; ONB-03 voice/template/attestation onboarding with born-paused activation gate; AI-04 evidence (model/version/edit-distance per draft) — Phase 5 (deployed to production, UAT 3/3, security 30/30)
- ✓ Review console & escalation: cross-client deadline-sorted approval queue on a phone (approve/edit-then-approve/terminal-skip through one extracted core, full body always visible, full review the only v1 mode), per-client pipeline view + conversation thread, touch-keyed stall alerts + 06:30-Perth digest (cron live), hot-lead escalation tick pass (claim-then-send, disarmed refusals recorded), ONB-04 two-condition onboarding gate reaching cadence creation + both resumes with attested SM8-automation-off checklist — Phase 6 (deployed + phone-UAT'd on production, security 23/23, code review 9 fixes applied; live escalation handset proof deferred by override to first-client arming, beside the MSG-02 email proof)

- ✓ Monthly recovered-revenue report: evidence-chained attribution (won within 30 days of the last qualifying sent touch, once per quote, value frozen at attribution), gross + conservative (net of a connect-time baseline, default 70% when fewer than 10 quotes) figures, frozen versioned calendar-month rows rendered as a print-styled A4 page the browser prints to PDF — Phase 7 (deployed; iPhone Safari + desktop Chrome prints UAT'd; security 36/36; three code-review rounds applied)
- ✓ Instrumentation: rolling-30-day first-touch-within-24h rate, reply rate, recovery multiple, opt-out rate (>5% badge + digest line), human-edit rate on `/reports` and `/reports/[client]` — Phase 7
- ✓ Brand: Backdesk on every prospect/client-facing surface from one import-free brand module (`src/core/brand.ts`) with a grep-as-test; Spam Act identity line and "{business} via Backdesk" From header; commercial assumptions confirmed by the operator 2026-09-07 (`keep-all, grace-window confirmed`) and recorded in `docs/commercial-assumptions.md` — Phase 8 (UAT 5/5 passed + 1 event-gated skip; security 22/22; code review 4 fixes applied)
- ✓ Domains & email: console at https://app.backdesk.com.au (Vercel project renamed to `backdesk`; every old *.vercel.app alias 308-redirects; Standard Protection on; stray bypass secret revoked); DNS at Squarespace (registrar DNS); `quotes.backdesk.com.au` verified at Resend (DKIM/SPF/DMARC p=none) and set as the operator-alert sender; all four pg_cron targets and both ClickSend rules re-pointed with server-side proofs — Phase 8
- ✓ Landing page & audit intake: https://backdesk.com.au live over HTTPS (apex + www on Vercel, DNS at Squarespace), M2 offer copy in the M1 voice, no-login Quote Leakage Audit request form (honeypot, salted-IP throttle, 4 MiB private-bucket CSV with 30-day purge) → tenant-independent `audit_requests` row + operator email and one-segment SMS within a second; console `/audits/requests` list/detail/CSV download and pre-filled `audits/new`; privacy notice; Lighthouse mobile 97/100 — Phase 9 (UAT 10/10 + 5 gap fixes; security 35/35; code review 5 warnings fixed, 5 info open)
- ✓ First-client go-live controls: audited transactional arm/disarm per channel gated on the onboarding checklist (+ sm8Connected, + verified domain for email), proof recording against verified artefacts, eleven-item checklist with a per-channel Live state, the go-live runbook, read-only ops probes (ClickSend balance, escalations, cadence status, Resend delivery), the ServiceM8 own-comms row shape measured — Phase 10 (six of eight plans; interim code review fixed; the two live proofs carried forward)
- ✓ Multi-tenant onboarding flow: connect ServiceM8 (Phase 2), approve templates + voice profile (Phase 5), cadence timing/contact hours (Phases 1/3), escalation phone + Ready-to-send checklist (Phase 6) — assembled across phases, surfaced as the per-client checklist card; sampled review after 30 days remains V2-01

### Active

- [ ] Missed-call divert capture on a Backdesk-controlled AU number with a greeting, no recording, and a logged missed-call event — v1.2
- [ ] Instant text-back within seconds from the client's identity, Spam Act identity line + opt-out — v1.2
- [ ] Lead object with a short supervised cadence, reply classification, hot-lead escalation and ServiceM8 job creation on confirmed intent — v1.2
- [ ] Console lead queue, per-client missed-call log, text-back arming behind the existing gate — v1.2
- [ ] Missed-call, after-hours and leads-to-jobs metrics in the monthly report and a design-partner stats export — v1.2
- [ ] Carried forward: CON-03 live escalation handset proof and MSG-02 / DOM-04 live email proof — event-gated on the first signed client
- [ ] Later candidates: minute-capped inbound voice tier (Stage 1 of the trajectory) only after Stage 0 gates pass; OAuth + webhooks when the ServiceM8 partner app lands (App ID 000000); sampled review mode after 30 days of edit-rate data (V2-01)

### Out of Scope

- Voice-based outbound follow-up — DNCR/Telemarketing Standard overhead; only if a client or partner pulls for it (Stage 3 of the trajectory)
- Voice AI answering (inbound voice tier) — Stage 1 of the trajectory, gated on Stage 0 results; not in v1.2 (decision 27 Sep 2026)
- Integrations beyond ServiceM8 — Tradify is closed; Simpro/AroFlo wait for demand; CSV import covers edge cases
- Client-facing self-serve dashboard — clients get reports, not logins; console is operator-only in v1
- Lead generation of any kind — the service converts existing demand; mixing blurs the measurable claim
- Payment/billing automation — direct debit handled manually (founding cohort is 5–15 clients)
- Marketing collateral, outreach, partner channel, case studies — executed in the Cowork product-marketing thread, not in this repo (decision 6 Sep 2026)
- Trade mark filing — deferred until incorporation (decision 6 Sep 2026)

## Context

- Three research reports precede this build: market case ("The AI Employee Opportunity"), vertical selection ("The Vertical Decision"), GTM plan ("The Quote Recovery Playbook"). The GTM plan is the product spec's source of truth for offer, cadence shape, pricing, and metrics.
- ServiceM8 is the chosen build surface deliberately: open REST API, webhooks, add-on SDK, and an MCP server; it dominates the 0–9 employee ANZ trade segment. Known strategic risk: ServiceM8 shipping native follow-up — the moat is the managed relationship, not the integration.
- The founder operates solo: onboarding is white-glove (templates approved in the tradie's voice within 7 days), console must be usable from a phone between sales meetings, and per-client QA time must trend from 5–8 hrs/month to ≤2 hrs as templates mature.
- Unit economics targets: COGS ~$100–170/client/month (inference <$10, SMS $10–20, tooling $10–20, human QA the balance) at $597 price → 72–83% gross margin.
- End-customer trust is existential: one bad message damages the tradie's brand. Cadence capped at 5 touches/3 weeks, tone templates client-approved, complaint rate is a first-class metric with alarm at >5% of contacts.
- **Codebase state at v1.0 (2026-09-05):** 259 source files (~92k lines) + 121 test files (~49k lines), 35 migrations, TypeScript throughout; Next.js 16 console on Vercel, Supabase Sydney (Postgres + pg_cron + pg_net), ClickSend SMS on a dedicated AU number, Resend email, Claude (sonnet-5 drafting, opus-5 classification). 2,437 pure assertions; remote-gated suites run in CI against a local Supabase stack. Production is DISARMED for real sends until the first client's messaging_config row is enabled.
- **Known debt at v1.0 close:** Broken Windows ledger 0 open (15 fixed / 13 waived with reasons); Nyquist VALIDATION.md files never reconciled (run validate-phase when a phase is next touched); drafting re-derives the onboarding rule inline (v1.1 todo); two event-gated live proofs (email domain, escalation handset) wait for the first client.

## Constraints

- **Tech stack**: Custom TypeScript service + Next.js console on Vercel, Supabase (Postgres/auth/cron) in Sydney region — decision 25 Aug 2026; AU data residency is a selling point
- **Compliance**: Spam Act (sender ID + functional opt-out), DNCR contact-hours discipline (own-customer follow-up is consent-exempt but stay inside hours), recording disclosure if voice ever added, assume full Privacy Act APP compliance as vendor
- **Timeline**: Weeks 1–2 of the GTM plan = end-to-end loop demo on live data with 2 design partners; the build must reach "first cadence running for a real client" inside ~2 weeks
- **Budget**: Tooling ≤ ~$200/mo pre-revenue; no paid infra beyond Supabase/Vercel/SMS provider/Anthropic API
- **Dependencies**: ServiceM8 API access (developer account + OAuth app approval lead time — verify early), AU SMS provider selection (ClickSend / MessageMedia / Twilio — research phase decision)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Trajectory change (27 Sep 2026): the next milestone is missed-call text-back, not a voice receptionist — Stage 0 of the Avoca research trajectory (`docs/reports/Avoca AI and an Australian equivalent.md`) | Australian trades are 91% micro firms; ServiceM8 bundles an AI Phone Agent at A$49/mo; the defensible position is the workflow after the call, which Backdesk already owns; text-back reuses the whole stack at cents per event and yields first-party missed-call data before any voice spend | — Accepted; v1.1 closed with its two live proofs carried forward |
| Custom TypeScript service over n8n | Cadence state machine is the product; needs tests, versioning, no platform ceiling; founder builds with Claude Code so code velocity is high | — Pending |
| Web dashboard console (operator-only) | Only reviewer is the founder; mobile queue + pipeline view; grows into report portal later | — Pending |
| Supabase + Next.js/Vercel, Sydney region | Fastest managed path; Postgres+auth+cron in one; AU residency sellable | — Pending |
| Missed-call text-back deferred to v2 | Bundled freebie, not the measurable core; avoids per-client telephony at launch | — Pending |
| ServiceM8-only integration + CSV import | Open API/MCP; CSV covers audits for prospects and non-SM8 edge cases | — Pending |
| SMS/email provider chosen in research phase | AU sender-ID rules, pricing, and deliverability need current data | Resend live for operator alerts (Phase 2); SMS provider decision lands Phase 4 |
| ServiceM8 timestamps treated as UTC opaque cursor | Measured live (Phase 2 spike): docs are silent, community wrong; A3 assumption disproved | ✓ Shipped Phase 2 |
| Transactional outbox for status-transition events | Cadence engine consumes exactly-once-ish events; same-tx write with quote upsert | ✓ Shipped Phase 2 |
| AES-256-GCM app-layer credential encryption | pgsodium pending deprecation; keys never plaintext at rest, last-4 display only | ✓ Shipped Phase 2 |
| Vercel Authentication disabled (Hobby) | Blocks pg_cron tick + prospect-facing pages; re-enable Standard Protection when custom domain lands | Accepted Phase 2 |
| AUDIT_RECOVERY_RATE = 0.15 (conservative) | Bottom of GTM 15–20% band; renders on prospect-facing audit; kept at the conservative end because the 3× guarantee is promised before any work is done | ✓ Confirmed 2026-09-07 (Phase 8, BRAND-02) — see docs/commercial-assumptions.md |
| Dedicated AU number +61491579212 live; shared across founding cohort | IPND cleared unexpectedly (status REGISTRATION_NOT_REQUIRED — may be dormant, not gone; recheck at second number). AUD 20.90/mo, first month free | ✓ Shipped Phase 4 |
| ClickSend runs ALL matching inbound rules, not first-match | Measured live (A3): STOP reaches our webhook even while their Opt-out rule fires; our suppressed_contacts stays canonical | ✓ Verified Phase 4 |
| messaging_config row = the arming switch; DISARMED until first client | Per-tenant one-client-at-a-time activation real since CR-01 fix; re-arming is one UPDATE, no deploy | ✓ Shipped Phase 4 |
| MSG-02 live email proof deferred by override to first-client onboarding | No domain verified at Resend; pipe built + unit-tested; obligation recorded in 4 artifacts | ⚠ Event-gated obligation |
| Classification model = claude-opus-5 (drafting stays sonnet-5) | User decision 2026-08-31: classification is critical and cheap at volume; supersedes Haiku row (and interim sonnet-5 choice); both models reject sampling params — none sent | ✓ Shipped Phase 5 |
| Verbatim price/date validator is the trust boundary, not the prompt | Post-generation digit-run whitelist over pre-rendered display strings; failures force mandatory review; never merge-fill fallback | ✓ Shipped Phase 5 |
| ONB-03 gate = cadences born paused('onboarding'); attestation is the one resume path | No approved template set → nothing sends; operator attests client approval per template version (write-once evidence) | ✓ Shipped Phase 5 |
| Attribution = won within 30 days of the last qualifying SENT touch, once per quote, value snapshotted and frozen | Anchored on real sends, not cadence creation; a later ServiceM8 edit shows as a discrepancy, never a silent change to a sent report | ✓ Shipped Phase 7 |
| Monthly reports are frozen, versioned rows; regenerate = version N+1, never delete | The PDF stapled to an invoice must be reproducible byte for byte; operator asked for delete on 2026-09-03 — rejected in favour of idempotent generate + collapsed list (queued todo) | ✓ Shipped Phase 7 (todo queued) |
| Default baseline win rate 0.70 when a client has < 10 quotes before connect | Conservative figure credits only the share above an assumed already-good win rate; understates our contribution by design | ✓ Confirmed 2026-09-07 (Phase 8, BRAND-02) — see docs/commercial-assumptions.md |
| The browser is the PDF engine (no PDF library); WebKit header non-repeat and ~22–25 printed description characters accepted | Zero infra, A4 print CSS twin of the audit page; engine limits measured and recorded (WINDOWS #26/#28) | ✓ Shipped Phase 7 |
| Brand = Backdesk; domains backdesk.com.au + backdesk.au; sole-trader ownership until incorporation | Role-not-feature name survives the whole-back-office and second-vertical moves; cleared against ABR, web, and DNS (offsider/admin crew/officehand rejected for clashes); company deferred — imputation makes the 25% rate a deferral only, incorporation trigger is liability/contracts, not income | ✓ Decided 2026-09-06 |
| Vercel project renamed to `backdesk` only AFTER every consumer of APP_BASE_URL was re-pointed and proven; old aliases retained and redirected, not released | A released *.vercel.app name can be claimed by a third party; a name we still own cannot. Rename → deploy → read back → configure, because generated aliases belong to deployments, not project names | ✓ Shipped Phase 8 (08-06) |
| Standard Protection on Hobby does NOT wall the `-git-main-` alias; production custom domain stays public; deployment URLs get the SSO wall | Measured live 2026-09-08; the git-main alias was given a 308 to the custom domain instead; pg_cron ticks and webhooks need no bypass | ✓ Measured Phase 8 |
| DNS host = Squarespace registrar DNS; Google Workspace (hello@backdesk.com.au) owns the apex mail records; Backdesk sends only from `quotes.` subdomain with its own `_dmarc.quotes` p=none | Zone stays with the founder; apex reserved for the Phase 9 landing page; Workspace connect replaced Squarespace's strict default DMARC | ✓ Decided Phase 8 (08-04) |
| Vercel auto-issued no certificate for app.backdesk.com.au hours after verification; `vercel certs issue` was required | "configured/verified" status fields and a plain-HTTP 200 are not proof a host is live — only an HTTPS 200 is | ✓ Recorded Phase 8 |
| Resend API key must be Full access for domain management (Sending-access answers `restricted_api_key`) | The console's add-domain and domain list depend on it; consider split keys later | ✓ Recorded Phase 8 |
| Console client list moved to `/clients`; app-host `/` rewrites there; the public `/` is the landing page; `proxy.ts` lives at `src/proxy.ts` | Route groups cannot both own `/`; the proxy had never compiled at the repo root since Phase 4 (layout + action gates were the real guards) — now live and load-bearing | ✓ Shipped Phase 9 (09-04) |
| Public CSV cap = 4 MiB (not the 5 MB in D-10) across form, console intake, bucket and `bodySizeLimit` | Vercel rejects bodies over 4.5 MB before the action runs; a real Job List export is well under 1 MB | ✓ Decided 2026-09-09 (cap-4mib) |
| Empty `<input type=file>` parts are "no attachment" by bytes, not by name | Browsers submit a zero-byte part; runtimes may name it — first live submission failed on it (UAT 2026-09-10) | ✓ Fixed Phase 9 (09-10) |
| Operator SMS reads the global `messaging_config` sms row and ignores the arming flag; ClickSend balance is an operational dependency | First live SMS failed with INSUFFICIENT_CREDIT (provider balance, not code); topped up 2026-09-10 — watch the balance before Phase 10 sends | ✓ Recorded Phase 9 |
| Public footer: ABN 00 000 000 000 · Perth WA · hello@ · phone (personal number kept until a dedicated Backdesk number exists); no suburb; ABN rendered with no-break spaces | Operator instruction at UAT 2026-09-10 | ✓ Shipped Phase 9 (09-11) |
| Daily digest is NOT sent when there is nothing to report | Silence = "nothing waiting on you"; keyed on body content (stalled drafts, opt-out drift, wedged cursor), not on stalled count alone | ✓ Shipped Phase 6, confirmed Phase 7 UAT (heartbeat not built — silence is indistinguishable from a broken sender) |
| Go-live gate shape: ARMED (`messaging_config` enabled) vs LIVE (armed + recorded proof); arming gated on onboarding items + sm8Connected + domain verified for email, proofs never gate arming; SMS arms the shared row for every connected client, per-client off override | Resolves the ARM-01/02/03 circularity without a supervised first-arm mode (Phase 10 D-01/D-03/D-05) | ✓ Shipped Phase 10 |
| DOM-04 reworded 2026-09-11: the MSG-02 proof is send from the verified identity + Resend `delivered` + headers/footer in a real client + a live one-click POST suppressing both channels on an operator-controlled contact; no inbound email path exists by design (reply-to is the tradie) — inbound email is a v1.2 candidate | Phase 4 D-01 sends replies to the tradie; Resend Receiving would reverse it (research Q6 Option B) | ✓ Recorded Phase 10 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-27 after Phase 9 (Landing Page & Audit Intake) — v1.1 GTM Launch (Backdesk)*
