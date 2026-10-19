# Phase 2: ServiceM8 Sync & Quote Leakage Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-26
**Phase:** 2-servicem8-sync-quote-leakage-audit
**Areas discussed:** Prospect data model, Sync health & auth alerts, Audit report shape, Polling & backfill behavior

---

## Prospect data model

| Option | Description | Selected |
|--------|-------------|----------|
| Separate prospects table | Lightweight record; conversion creates a tenant and links back; tenants keep full contact-hours machinery | ✓ |
| Tenant with status 'prospect' | Reuses forTenant()/RLS wholesale but tenants require contact-hours fields prospects don't have | |
| You decide | Claude picks based on schema constraints | |

**User's choice:** Separate prospects table

| Option | Description | Selected |
|--------|-------------|----------|
| Link prospect to new tenant | Tenant references prospect record; snapshot stays on prospect; no copying | ✓ |
| Copy snapshot into tenant | Copy figures at conversion; two copies of the truth | |
| You decide | — | |

**User's choice:** Link prospect to new tenant

| Option | Description | Selected |
|--------|-------------|----------|
| Separate audit tables | Prospect quote lines keyed by prospect_id, disposable; sync tables stay pure | ✓ |
| Unified quotes table | Rows carry tenant_id or prospect_id; shared ingestion but cadence queries must exclude prospects forever | |
| You decide | — | |

**User's choice:** Separate audit tables

| Option | Description | Selected |
|--------|-------------|----------|
| Purge raw lines, keep aggregates | Raw lines auto-delete after ~30 days unless converted; figures + baseline snapshot persist | ✓ |
| Keep until manual delete | More flexibility, more data liability | |
| You decide | — | |

**User's choice:** Purge raw lines, keep aggregates

---

## Sync health & auth alerts

| Option | Description | Selected |
|--------|-------------|----------|
| Email + console banner | Immediate email + persistent red banner; no SMS dependency (Phase 4) | ✓ |
| Console banner only | Passive; "immediately" becomes "next login" | |
| Email + SMS when available | Email now, SMS when Phase 4 gateway lands | |

**User's choice:** Email + console banner

| Option | Description | Selected |
|--------|-------------|----------|
| Auth errors instant, others retry | 401/403 pauses on first occurrence; network/429/5xx retry, alert after ~3 failed cycles | ✓ |
| Any failure after 2 strikes | Uniform rule; delays hard-revocation reaction | |
| You decide | — | |

**User's choice:** Auth errors instant, others retry

| Option | Description | Selected |
|--------|-------------|----------|
| Badge + detail on client page | Badge + last-sync on list; sync runs/errors on detail page; reuses Phase 1 pages | ✓ |
| Dedicated sync dashboard | Separate /sync page; more to maintain | |
| Badge only | Minimal; weaker debugging story | |

**User's choice:** Badge + detail on client page

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-resume on verified key | Save triggers test call; success resumes sync and clears pause; overdue touches re-window | ✓ |
| Manual resume button | Explicit Resume per client after outage | |
| You decide | — | |

**User's choice:** Auto-resume on verified key

---

## Audit report shape

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative fixed rate | Never-followed-up value × ~15–20% fixed rate; comparable; protects 3× guarantee | ✓ |
| Baseline-derived rate | Prospect's own win rate as multiplier; noisy on small samples | |
| Range, not point estimate | Band from conservative to optimistic; weaker headline | |

**User's choice:** Conservative fixed rate

| Option | Description | Selected |
|--------|-------------|----------|
| No activity after quote sent | No activity/note/status change after quote date + ~3-day grace; footnoted approximation | ✓ |
| Still open past N days | Cruder proxy; catches slow deals as leaks | |
| You decide | — | |

**User's choice:** No activity after quote sent

| Option | Description | Selected |
|--------|-------------|----------|
| Print-styled web page | A4-styled console route; browser print-to-PDF; no PDF library; phone-renderable | ✓ |
| Generated PDF file | Server-side PDF; adds dependency | |
| Both from day one | Best experience, most build | |

**User's choice:** Print-styled web page

| Option | Description | Selected |
|--------|-------------|----------|
| API key first, CSV fallback | Read-only key runs same fetch code as sync; CSV covers unwilling prospects; same audit tables | ✓ |
| CSV only for v1 | Less build; weaker demo | |
| API key only | Loses key-shy prospects; AUD-01 names CSV | |

**User's choice:** API key first, CSV fallback

---

## Polling & backfill behavior

| Option | Description | Selected |
|--------|-------------|----------|
| 5 minutes fixed | Shared interval; ~288 polls/day/client; simple pg_cron schedule | ✓ |
| 15 minutes fixed | Fewer calls; slower won/lost detection | |
| Configurable per client | Flexibility unlikely to be used at this scale | |

**User's choice:** 5 minutes fixed

| Option | Description | Selected |
|--------|-------------|----------|
| 90 days of quotes | Open + won + lost; history doubles as baseline win rate; same window as audit | ✓ |
| Open quotes only | Minimum for chasing; no baseline | |
| Full history | Richest data; slowest first sync | |

**User's choice:** 90 days of quotes

| Option | Description | Selected |
|--------|-------------|----------|
| Operator triages at onboarding | Backfilled open quotes land "needs review"; operator ticks chase-eligible ones | ✓ |
| Auto-eligible under 30 days | Reasonable default, less deliberate | |
| Everything open is eligible | Max potential, max brand risk | |

**User's choice:** Operator triages at onboarding

| Option | Description | Selected |
|--------|-------------|----------|
| Keep all, filter by status | Console defaults to open; won/lost visible; history persists for Phase 7 | ✓ |
| Open only in UI | Rows persist in DB but hidden | |
| You decide | — | |

**User's choice:** Keep all, filter by status

---

## Claude's Discretion

- Status-transition event mechanism/schema (SYNC-02) for Phase 3 consumption
- API key storage/encryption mechanism (server-side only)
- CSV column mapping and validation UX
- Backoff parameters, sync-run logging schema, worker route design
- Exact conservative recovery-rate constant

## Deferred Ideas

None — discussion stayed within phase scope.
