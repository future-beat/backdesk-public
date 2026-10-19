<!-- GSD:project-start source:PROJECT.md -->

## Project

**Quote Recovery MVP**

The delivery system behind a managed quote-recovery service for Perth trade businesses: it connects to a client's ServiceM8 account, chases every open quote through a human-supervised, AI-drafted SMS + email cadence until it's won or dead, and proves its value with a Quote Leakage Audit for prospects and a monthly recovered-revenue report for clients. The founder is the only operator initially; tradies and their customers never see a dashboard — they see polite follow-ups in the tradie's own voice and reports in dollars.

**Core Value:** Every open quote gets followed up on time, with a human-approved message, and every recovered job is attributed and reported in dollars — the invoice must arrive stapled to proof it paid for itself.

### Constraints

- **Tech stack**: Custom TypeScript service + Next.js console on Vercel, Supabase (Postgres/auth/cron) in Sydney region — decision 25 Aug 2026; AU data residency is a selling point
- **Compliance**: Spam Act (sender ID + functional opt-out), DNCR contact-hours discipline (own-customer follow-up is consent-exempt but stay inside hours), recording disclosure if voice ever added, assume full Privacy Act APP compliance as vendor
- **Timeline**: Weeks 1–2 of the GTM plan = end-to-end loop demo on live data with 2 design partners; the build must reach "first cadence running for a real client" inside ~2 weeks
- **Budget**: Tooling ≤ ~$200/mo pre-revenue; no paid infra beyond Supabase/Vercel/SMS provider/Anthropic API
- **Dependencies**: ServiceM8 API access (developer account + OAuth app approval lead time — verify early), AU SMS provider selection (ClickSend / MessageMedia / Twilio — research phase decision)

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.x (latest stable) | Whole codebase | Decided constraint; single language across console, cadence engine, and integration code |
| Next.js (App Router) | 16.x latest stable (16.3.2 verified 2026-08-25; `proxy.ts` replaces `middleware.ts`, `next lint` removed, Turbopack default) | Operator console + API route handlers | Decided constraint; route handlers double as webhook receivers and cron-tick endpoints — no second deployment needed at this scale |
| Supabase (Postgres 15+) | hosted, `ap-southeast-2` (Sydney) | DB, auth, cron, queues | Sydney region confirmed available; AU data residency is a selling point. pg_cron + pg_net + pgmq all supported on the hosted platform |
| `@supabase/supabase-js` | v2 latest | DB/auth client | Official client; use service-role key server-side, anon key + RLS in console |
| Anthropic Claude API (`@anthropic-ai/sdk`) | latest | Drafting + reply classification | Decided constraint; see model choice below |
| ClickSend (REST API, direct `fetch`) | api v3 | SMS send/receive (AU) | AU-native provider, PAYG ~7.2c/SMS entry (~5.7c at volume, 50% new-customer bonus), dedicated AU virtual numbers, delivery-receipt webhooks, inbound-SMS webhook rules, local compliance familiarity (publishes ACMA sender-ID guidance). Skip their generated Node SDK — the REST API is simple; wrap it in a thin typed client |
| Resend | Pro plan ($20/mo) | Email from/on behalf of client domains | 50k emails/mo + **10 verified domains** on Pro — exactly matches the founding-five-to-fifteen cohort; per-domain SPF/DKIM verification flow is clean; best DX of the three candidates; React Email templates fit the Next.js stack |
| Vercel | Pro plan | Console hosting + serverless compute | Decided constraint; functions default 300s max duration (Fluid compute up to 800s GA) — ample for a per-minute send tick |

### Claude model choice (drafting + classification)

| Task | Model ID | Pricing (per MTok in/out) | Why |
|------|----------|---------------------------|-----|
| Message drafting (client voice) | `claude-sonnet-5` | $3/$15 ($2/$10 intro through 2026-08-31) | Best quality/cost for short, tone-sensitive copy. At ~500–1,500 drafts/mo (~1.5k input + 200 output tokens each) this is **$3–8/mo total** — comfortably inside the <$10/client inference COGS target |
| Reply classification (interested / objection / opt-out / hot lead) | `claude-haiku-4-5` | $1/$5 | Classification is easy for Haiku; sub-cent per reply. Use **strict tool use** (`strict: true` tool with `additionalProperties: false`) or structured outputs (`output_config: {format: ...}`) so the label is schema-guaranteed — never parse free text |
| Escalation-worthy edge cases (optional) | `claude-opus-5` | $5/$25 | Only if Sonnet drafts miss the voice in QA; cost still trivial at this volume |

- Use `output_config: {format: {...}}` for structured outputs — the old `output_format` param is deprecated.
- **Prompt caching**: minimum cacheable prefix is ~1024 tokens and cache TTL is short, so at this volume it only pays off when a per-client voice-guide + template block (stable prefix) is reused in bursts (e.g., drafting a day's queue in one pass). Design prompts with the stable client-voice block first, volatile quote details last — cheap to do now, harmless if cache never hits.
- Assistant prefill is removed on current models; don't design classification around prefill.

### SMS sender identity (architecture-defining, decide before build)

| Fact | Consequence |
|------|-------------|
| ACMA **SMS Sender ID Register is live**: since **1 July 2026** any alphanumeric sender ID to AU numbers must be registered/approved; unregistered ones are overstamped "Unverified" or blocked; providers must verify the sender's entitlement to the business name | Sending "as" each tradie via alpha tag means per-client ACMA registration of *their* business name — paperwork per onboarding, and the register verifies entitlement, which a third-party agency complicates |
| Alphanumeric sender IDs **cannot receive replies** (not real numbers) | Replies drive the whole product (classification, pause-on-reply, opt-out, hot-lead escalation) — alpha tags are unusable for the cadence channel |
| Dedicated AU virtual numbers support two-way SMS and reply-STOP opt-out; they are outside the alpha-tag register regime | **Use dedicated virtual numbers.** v1: one dedicated number shared across founding clients (reply attribution by recipient phone number + active-cadence lookup); move to per-client numbers when clients overlap customers or volume justifies it. Identify the tradie by name in message copy (Spam Act sender identification) |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | v4 latest | Runtime validation of webhook payloads, LLM outputs, env | Everywhere data crosses a boundary (ServiceM8 webhooks, ClickSend callbacks, Claude tool outputs) |
| `resend` + `@react-email/components` | latest | Email sending + templates | Transactional sends; Spam Act footer baked into the base template |
| `drizzle-orm` + `drizzle-kit` | latest | Typed schema + migrations over Supabase Postgres | The cadence state machine lives in Postgres; versioned migrations matter more than an ORM's query builder. (Alternative: raw SQL + supabase-js is acceptable; do NOT adopt Prisma — heavier cold starts on serverless, awkward with pg_cron/pgmq-managed schemas) |
| `pgmq` (Supabase Queues) | platform extension | Durable send queue | Enqueue due messages; worker endpoint consumes with visibility timeout — gives retry + exactly-once-ish semantics that bare cron lacks |
| `pg_cron` + `pg_net` (Supabase Cron) | platform extensions | The tick | Schedule a per-minute job that either runs SQL (enqueue due touches) or HTTP-POSTs the protected Vercel worker endpoint |
| `@anthropic-ai/sdk` | latest | Claude calls | Official SDK; typed tool definitions via `betaZodTool` if using the tool runner |
| `date-fns` + `date-fns-tz` | latest | Contact-hours windows (AWST), cadence offsets | DNCR-style contact-hours discipline needs explicit `Australia/Perth` handling; never store local times |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Supabase CLI | Local dev + migrations + branching | `supabase start` for local Postgres with extensions; keep pg_cron schedules in migration files |
| Vercel CLI | Preview deploys | Webhook endpoints need a stable URL — use a dedicated preview alias or ngrok/cloudflared during ServiceM8 webhook development |
| Vitest | Unit tests for the cadence state machine | The state machine (paused/stopped/opt-out/win transitions) is the product — test it exhaustively, no mocks of Postgres needed for pure transition logic |
| ServiceM8 free trial account (14-day) / free plan | Test tenant | No formal developer sandbox program found (LOW confidence) — budget a real trial account with seeded fake quotes as the test rig; Partner accounts can provision accounts via API |

## ServiceM8 Integration Facts (verified against developer.servicem8.com, Aug 2026)

- **Auth**: Two modes. Private app = `X-API-Key` header, generated in account Settings, no developer account. Public app = OAuth 2.0 (`go.servicem8.com/oauth/authorize` → `/oauth/access_token`), 1-hour access tokens + refresh tokens, ~70 granular scopes; incremental scope requests unlock higher rate limits.
- **Developer signup**: register as a **Development Partner** at servicem8.com/developer-registration to get App ID/Secret for OAuth apps. No published approval lead time (LOW confidence on timing — **do this in week 1**; fallback: start each client on a private API key from their own account settings, which needs no partner approval at all, and migrate to OAuth later).
- **Quotes are jobs**: there is no quote object. A Job has a fixed 4-status lifecycle: `Quote` → `Work Order` (won) → `Completed`; `Unsuccessful` = lost/declined. Statuses cannot be customized. Quote recovery = jobs where `status = 'Quote'`; win detection = transition to Work Order/Completed; loss = Unsuccessful.
- **Endpoints**: `https://api.servicem8.com/api_1.0/{resource}.json` — `job.json`, `company.json` (clients), `jobcontact.json`, `jobactivity.json`, etc.
- **Webhooks**: subscribe via `/webhook_subscriptions` (OAuth apps must answer a challenge POST). Subscribable objects include **Job**, Job Activity, Job Payment, Note, Task, Material, Company, Attachment, Form Response. Callback payload contains **only the UUID + changed fields + resource_url** — you must re-fetch the object. Return HTTP 200; retries continue up to 72h; your 429 throttles delivery 15 min; your 410 auto-unsubscribes. Webhooks generally require the OAuth (public app) path — another reason to do partner registration early.
- **Rate limits**: 180 requests/min and 20,000/day, **per app per connected account** (HTTP 429 on breach) — generous for 15 clients; still design polling as incremental (webhook-triggered fetch + daily reconciliation sweep, not full-table polls).
- **MCP server**: official, at `api.servicem8.com/mcp` (OAuth) — useful for founder-side ad-hoc queries and the Quote Leakage Audit prototyping, not for the production sync path.

## Background-Job Architecture (what production systems do in 2026)

## Supabase Specifics

- **Region**: `ap-southeast-2` (Sydney) — confirmed in Supabase's available-regions list. Note honestly in sales copy: DB + auth are AU-resident; Vercel functions, Anthropic, and email providers process data outside AU unless separately configured (Vercel Sydney region `syd1` exists for function execution — set it in `vercel.json`).
- **Auth (single operator)**: Supabase Auth, email+password + TOTP MFA, with a one-row allowlist check (or simply disable signups). Console pages gated by proxy.ts (Next 16 rename of middleware). Don't build magic-link-only auth — the console must open fast on a phone between sales meetings.
- **RLS for multi-tenant**: every tenant-scoped table carries `client_id`; backend (service-role key) bypasses RLS by design; RLS policies exist as defense-in-depth and become load-bearing only if clients ever get logins (v2 reports portal). This is the standard 2026 pattern for operator-only admin apps: service-role in server code, RLS written anyway.
- **Cron/queues**: Supabase Cron UI wraps pg_cron/pg_net (down to sub-minute granularity); pgmq ships as Supabase Queues with a dashboard.

## Cost Sanity Check (15 clients)

| Item | Est. monthly | Basis |
|------|--------------|-------|
| SMS (ClickSend) | ~$110–160 AUD total (~$8–11/client) | ~1,500–2,000 segments @ ~7.2c + 1–2 dedicated numbers |
| Claude inference | <$10 total | Sonnet 5 drafting + Haiku classification at ~2k msgs/mo |
| Resend Pro | $20 USD | 10 domains, 50k emails |
| Supabase Pro | $25 USD | Needed for production reliability (no auto-pause) |
| Vercel Pro | $20 USD | Cron/functions/team features |
| **Total infra** | **~$150–200 AUD** | Inside the ≤$200/mo pre-revenue budget; per-client COGS well inside the $100–170 target |

## Installation

# Core

# Data layer

# Email templates

# Dev

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| ClickSend | Twilio | If you want the best-in-class Node SDK/webhook tooling and accept ~8c AUD/SMS + US-centric compliance flow; also the fallback if ClickSend's dedicated-number provisioning is slow. Dedicated AU number ~US$6.50/mo |
| ClickSend | Cellcast | Only if SMS cost dominates (from ~2.8c/SMS) — thinner docs/support and less proven webhook DLRs make it wrong for a compliance-sensitive v1 |
| Resend | Postmark ($15/mo + $1.80/1k) | If deliverability problems appear on client domains — Postmark's transactional-only shared IPs are the deliverability gold standard |
| Resend | AWS SES ($0.10/1k) | At >15 client domains or >50k emails/mo; accept DIY reputation management |
| pg_cron tick + Vercel handler | Small always-on worker (Railway/Fly) | If cadence logic ever needs persistent connections, sub-second latency, or >13-min batches (v2 missed-call text-back may force this) |
| drizzle-orm | Raw SQL + supabase-js | If the team prefers zero ORM; fine, but keep migrations in files either way |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Alphanumeric sender IDs (alpha tags) for the cadence | Cannot receive replies (kills classification/opt-out/escalation) and now require per-business ACMA Sender ID Register approval since 1 July 2026 | Dedicated AU virtual number(s); tradie identified in message copy |
| Sinch MessageMedia for v1 | Sales-led, plan-based from ~$45/mo; slower to start than PAYG competitors | ClickSend PAYG |
| ClickSend's generated Node SDK | Auto-generated, poorly maintained; adds nothing over the simple REST API | Thin typed `fetch` wrapper + zod |
| n8n / Zapier / Make for the cadence | Relitigated and decided: the state machine is the product; needs tests and versioning | Custom TS service |
| Prisma | Serverless cold-start weight; friction with platform-managed extensions (pg_cron, pgmq) | drizzle-orm or raw SQL |
| Vercel `waitUntil` for sends | Best-effort only, bounded by function duration; sends are must-happen work | pgmq queue + idempotency keys |
| ServiceM8 full-table polling loops | 20k req/day per account cap; wasteful | Webhooks (Job object) + incremental `edit_date`-filtered fetch + daily reconciliation |
| Free-text LLM classification parsing | Fragile; labels must be exact for the state machine | Strict tool use / structured outputs (`output_config.format`) |
| `output_format` param (Claude) | Deprecated | `output_config: {format: {...}}` |

## Stack Patterns by Variant

- Start design partners on **private API keys** generated in their own ServiceM8 settings (no approval needed), poll `job.json` on `edit_date` every 5 min
- Because webhooks may require the OAuth public-app path, polling is the week-1 bridge; swap to webhooks when the partner app is live
- Send from a service-owned subdomain (e.g. `quotes.<service>.com.au`) with reply-to the tradie's address; keep per-client domains as the default path
- Draft the whole day's queue in one batch pass to exploit Claude prompt caching on the per-client voice prefix

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Next.js 16.x | Vercel Fluid compute | 300s default / 800s max duration — confirm `maxDuration` in route segment config for the worker route |
| pg_cron / pgmq | Supabase hosted (all regions incl. Sydney) | Enable via dashboard Integrations; keep schedules in migrations |
| drizzle-orm | Supabase Postgres 15+ | Use the `postgres` (postgres.js) driver, transaction-pooler port 6543 for serverless |
| `@anthropic-ai/sdk` latest | `claude-sonnet-5`, `claude-haiku-4-5` | Use exact model IDs, no date suffixes; structured outputs need no beta header |

## Sources

- https://developer.servicem8.com/docs/authentication — OAuth flow, private API keys, Development Partner registration (MEDIUM — official docs, fetched)
- https://developer.servicem8.com/docs/webhooks-overview — webhook objects, challenge, payload shape, retry/throttle behaviour (MEDIUM)
- https://developer.servicem8.com/discuss/5e7c063a3e0315004cec6878 + community threads — 180/min, 20k/day rate limits (MEDIUM)
- https://support.servicem8.com/hc/en-us/articles/115005715723 — Quote/Work Order/Completed/Unsuccessful fixed statuses (MEDIUM)
- https://developer.servicem8.com/docs/mcp-server — official MCP server (MEDIUM); absence of sandbox program (LOW — not found ≠ doesn't exist)
- https://mobilemessage.com.au/best-bulk-sms-provider-australia, https://australiabulksms.com/sms-providers-australia/, https://www.smscomparison.com.au/sms-gateway/ — AU SMS pricing Aug 2026 (MEDIUM — cross-checked aggregators; confirm exact rates at signup)
- https://www.acma.gov.au/sms-sender-id-register-rules-telcos + https://www.twilio.com/en-us/blog/insights/australia-sender-id-register + ClickSend help — Sender ID Register effective 1 July 2026 (MEDIUM — ACMA + two providers agree)
- https://www.touchsms.com.au/alpha-sender-id-vs-virtual-number/, ClickSend/SMSGlobal help — alpha tags can't receive replies (MEDIUM)
- https://www.buildmvpfast.com/blog/resend-vs-ses-vs-postmark-transactional-email-deliverability-saas-2026, https://nuntly.com/resend-pricing — email pricing/domain limits (MEDIUM — verify Resend Pro domain count at signup)
- https://supabase.com/docs/guides/platform/regions — Sydney `ap-southeast-2` (MEDIUM); https://supabase.com/modules/cron, pgmq guides — cron/queues (MEDIUM)
- https://vercel.com/docs/cron-jobs, https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan, Vercel/Railway comparison posts — cron limits, 300s/800s durations, worker patterns (MEDIUM)
- Bundled Claude API reference skill (cached 2026-06-24) — model IDs, $/MTok pricing, structured outputs, prompt-caching minimums (HIGH — curated)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
