# Backdesk

Missed-call text-back and quote recovery for Perth trade businesses on ServiceM8. Built solo
with Claude Code, August to October 2026.

**Case study.** Development stopped in October 2026, before the first paying client. The
original service is dormant rather than closed, and this repository is a sanitised copy:
personal numbers, account IDs and market research are removed or replaced with fictitious
values; the code, tests and planning record are otherwise intact.

## What it does

- **Missed-call text-back:** unanswered calls divert to a Backdesk number, an unrecorded
  greeting answers, and the caller gets a text from the business within seconds, then two
  human-approved follow-ups. Urgent replies go straight to the tradie's phone.
- **Quote recovery:** every open ServiceM8 quote is chased by Claude-drafted, human-approved
  SMS and email until it's won or dead.
- **Proof in dollars:** a free audit for prospects and a frozen monthly report for clients.

Three milestones in eight weeks: the quote loop (v1.0), brand, site and onboarding gates
(v1.1), then the pivot to missed-call text-back (v1.2).

## Engineering highlights

- **State machine as the product:** every pause, stop, opt-out, win and expiry is a pure,
  tested transition; guarded Postgres updates arbitrate all concurrency.
- **Compliance as code:** opt-out on every message, STOP handled before any model, contact
  hours in the client's zone, and a deterministic gate that records why a caller wasn't texted.
- **No recording, by construction:** WA requires all-party consent, so the greeting is static
  speech and a structural test keeps it that way.
- **Exactly-once writes to ServiceM8:** claim first, persist each ID as it arrives, adopt a
  half-created job on retry; behaviour measured against the live API before coding.
- **Honest numbers and privacy:** every rate shows its denominator; caller numbers are
  replaced by a keyed HMAC after 90 days without ever changing a texting decision.

## At a glance

| | |
|---|---|
| Code | 388 files, ~87k lines of TypeScript |
| Tests | 211 files, ~6,500 cases; database suites run in CI on a fresh Postgres |
| Schema | 43 Drizzle migrations, row-level security on every table |
| Stack | Next.js 16, Supabase (Sydney), Drizzle, Twilio, ClickSend, Resend, Claude, Zod, Vitest |

## How it was built

One developer with Claude Code under a written process: locked decisions, research, a
checked plan, atomic commits, code review, verification and phone UAT for every phase. The
full record, including overridden decisions, is in `.planning/milestones/`.

## Layout

`src/app` site, console and webhooks · `src/core` domain logic · `src/db` schema and
migrations · `tests` · `scripts` ops and renderers · `docs` runbooks · `.planning` record

## Run locally

```bash
npm install
npx supabase start     # local Postgres with pg_cron, pg_net, pgmq
npm run db:migrate
npm test && npm run typecheck && npm run lint
npm run dev
```

Environment variables: `docs/env-vars.md`. Minimal CI set: `.github/workflows/ci.yml`.

## Licence

MIT. Not affiliated with ServiceM8, Twilio, ClickSend, Resend or Anthropic.
