# Backdesk

A managed service for Perth trade businesses, built solo between August and October 2026 and
stopped before its first paying client. This repository is the whole system, published as a
case study: the product decisions, the code, the tests and the planning record behind them.

**Status: archived.** The service is closed and nothing here is deployed. Personal phone
numbers, the ABN, account identifiers and the market research have been removed or replaced
with fictitious values; the code, tests and engineering record are otherwise as they were.

## What it did

A tradie on the tools misses calls and sends quotes nobody follows up. Backdesk fixed both
without the tradie learning new software:

- **Missed-call text-back.** The tradie diverts unanswered calls to a Backdesk number. An
  unrecorded greeting answers, and within seconds the caller gets one text from the business.
  Two human-approved follow-ups chase the enquiry until the job is booked or closed. Urgent
  replies, and a second call within half an hour, go straight to the tradie's phone.
- **Quote recovery.** Connected to the tradie's ServiceM8 account, it chases every open quote
  with a five-touch SMS and email cadence until the quote is won or dead. Every message is
  drafted by Claude in the tradie's voice and approved by a person before it sends.
- **Proof in dollars.** A free Quote Leakage Audit for prospects, and a frozen monthly report
  for clients: calls caught, jobs booked, quotes chased, revenue recovered (gross and
  conservative, net of the client's own baseline win rate), fees paid.

Tradies and their customers never see a dashboard. The single operator works a phone-first
console: an approval queue, an inbox, a lead queue, a missed-call log and the reports.

## How it got here

| Milestone | Shipped | What it added |
|---|---|---|
| v1.0 | 5 Sep 2026 | The quote-recovery loop end to end: ServiceM8 sync, cadence engine, ClickSend and Resend gateways, Claude drafting and reply classification, review console, escalation, attribution and monthly reporting |
| v1.1 | 27 Sep 2026 | The brand, public site and audit intake, per-client arming gates, go-live runbook |
| v1.2 | 15 Oct 2026 | The pivot to missed-call text-back: Twilio capture, the instant text, the lead cadence, lead classification and escalation, ServiceM8 job creation, the lead console, missed-call reporting and 90-day pseudonymisation |

The pivot came from a structured review of the US market leader for trades AI reception: the
evidence said a tradie feels a missed call immediately and an unchased quote only in
hindsight. Positioning and pricing were then reworked after conversations with tradies (one
plan, a free first month, no setup fee) before development stopped.

## Engineering highlights

- **The cadence state machine is the product.** Every pause, stop, opt-out, win and expiry is
  a pure, exhaustively tested transition; Postgres guarded updates are the only arbiters of
  concurrency. Quote and lead cadences share one engine with per-kind timing policy.
- **Compliance as code, not as policy.** Spam Act sender identification and a working opt-out
  on every message; STOP handled deterministically before any model sees a reply; contact
  hours in the client's zone; a deterministic gate decides who may be texted (withheld,
  landline, own-number, suppressed, repeat-caller and daily-cap rules) and records why not.
- **No call is recorded.** Western Australia requires all-party consent to record, so the
  greeting is static speech and there is nothing to record. A structural test keeps it so.
- **Exactly-once writes to someone else's system.** Creating a ServiceM8 job claims the lead
  first, persists every returned identifier as soon as it exists, adopts a half-created job on
  retry instead of creating a second, and pre-inserts the mirror row so the sync never opens a
  duplicate cadence. The semantics were measured against the live API before any code was
  written (duplicate POSTs create duplicates; deletes are soft).
- **Honest numbers.** Every rate is shown with its denominator; a timing with no samples
  says "no samples"; jobs booked from missed calls are counted, never valued in dollars.
  Reports are frozen and versioned; a regenerated month is a new version, never an edit.
- **Privacy by construction.** Caller numbers of closed, non-converting leads are replaced by
  a keyed HMAC after 90 days by a nightly pass; the boundary is defined as the repeat-caller
  cool-off, so a hashed record can never change a texting decision. Suppressions are kept.
- **Production treated as production.** 43 versioned migrations applied under a written push
  protocol (schema before code, read-back before push); a lease that pauses live cron ticks
  before any remote test run; every database-backed suite runs in CI against a fresh local
  stack.

## Numbers

| | |
|---|---|
| Application code | 388 files, about 87,000 lines of TypeScript |
| Tests | 211 files, about 6,500 test cases; pure suites run anywhere, database suites in CI |
| Schema | 43 Drizzle migrations, row-level security on every table |
| History | 1,043 commits over 8 weeks (squashed into one commit here) |

## How it was built

Built by one person with Claude Code as the engineering pair, under a written planning
workflow (the record is in `.planning/`): every phase has a context
file of locked decisions, research, a plan checked by a second agent before execution, atomic
commits, a code review, a fix pass, a goal-backward verification and a phone UAT. Product,
compliance and pricing decisions were the founder's and are recorded with dates in the phase
context files. The record is kept here deliberately: `.planning/milestones/` shows how each
decision was made, reviewed and verified, including the ones that were overridden.

## Stack

TypeScript, Next.js 16 (App Router) on Vercel, Supabase (Postgres, Auth, pg_cron) in Sydney,
Drizzle ORM, Twilio Programmable Voice for the divert numbers, ClickSend for SMS, Resend for
email, Anthropic Claude for drafting and classification with schema-guaranteed outputs, Zod at
every boundary, Vitest.

## Repository map

| Area | Path |
|---|---|
| Public site | `src/app/(marketing)` |
| Operator console | `src/app/(console)` |
| Webhooks and cron endpoints | `src/app/api` |
| Domain logic (cadence, leads, telephony, drafting, classification, escalation, reporting) | `src/core` |
| Schema, migrations, tenant-scoped repositories | `src/db` |
| Tests | `tests` |
| Ops scripts, brand and document renderers | `scripts` |
| Runbooks, API notes, commercial assumptions | `docs` |
| Planning and verification record | `.planning` |

## Running it locally

```bash
npm install
npx supabase start            # local Postgres with pg_cron, pg_net and pgmq
npm run db:migrate            # against the local stack
npm test                      # pure suites; database suites need the local stack
npm run typecheck && npm run lint
npm run dev
```

Every environment variable is documented in `docs/env-vars.md`; CI shows the minimal dummy set
needed to build and test (`.github/workflows/ci.yml`).

## Licence

MIT. See `LICENSE`. Backdesk was independent and not affiliated with ServiceM8, Twilio,
ClickSend, Resend or Anthropic.
