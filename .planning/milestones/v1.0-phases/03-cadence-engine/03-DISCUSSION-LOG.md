# Phase 3: Cadence Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-27
**Phase:** 3-Cadence Engine
**Areas discussed:** Cadence shape & anchoring, Stop vs pause semantics, Overdue re-window policy, Dispatch handoff boundary

---

## Cadence shape & anchoring

### What anchors day 0 of the cadence?

| Option | Description | Selected |
|--------|-------------|----------|
| Eligibility moment (Recommended) | The quote_opened event — when the quote became chase-eligible. Fresh quotes ~5 min after sync; backfilled quotes when the operator ticks them. Never produces an instantly-overdue schedule. | ✓ |
| ServiceM8 quote date | Matches the customer's clock, but a triaged backfill quote materializes with every touch already overdue. | |
| Hybrid: quote date, floor at eligibility | Old quotes join the cadence at whatever touch number their age implies. | |

### Default touch-day offsets and configurability?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed default, per-client override (Recommended) | Default (day 0, 3, 7, 14, 21) stored as per-tenant config rows onboarding can edit; v1 UI can just apply the default. | ✓ |
| Hardcoded for all clients | Day offsets as code constants; changing a client's pacing later means a schema change under live cadences. | |
| Fully per-client from day one | Cadence-timing editor in onboarding before any cadence can start. | |

### Time of day within the contact window?

| Option | Description | Selected |
|--------|-------------|----------|
| Preferred slot + jitter (Recommended) | Per-tenant preferred send time (default ~9:30am local) clamped to the window, plus a few minutes of jitter. | ✓ |
| Window open | Fires when the window opens — 7:00am-sharp texts read as automated. | |
| Mirror the quote's hour | Send at the hour the original quote went out; derived from a nullable timestamp. | |

### Who gets chased when a quote has multiple contacts?

| Option | Description | Selected |
|--------|-------------|----------|
| One primary contact (Recommended) | Deterministic rule (JobContact type, fallback order); no-usable-contact quotes go to operator triage. | ✓ |
| Operator picks per quote | Manual contact-selection gate on every cadence. | |
| All contacts with a mobile | More reach, but double-messaging a household reads as spammy. | |

---

## Stop vs pause semantics

### A customer replies — the cadence pauses until what?

| Option | Description | Selected |
|--------|-------------|----------|
| Pause until operator acts (Recommended) | Reply freezes the cadence indefinitely; operator explicitly resumes or closes. | ✓ |
| Auto-resume after N quiet days | Resumes after e.g. 7 quiet days; risks texting someone who said "I'll call you Monday". | |
| Reply = hard stop | Any reply permanently ends the cadence. | |

### Kill switch behaviour (per-contact and per-client)?

| Option | Description | Selected |
|--------|-------------|----------|
| Contact=stop, client=pause (Recommended) | Per-contact kill is terminal (suppression list); per-client kill is a reversible pause. | ✓ |
| Both are terminal stops | Restarting a paused client means rebuilding every cadence. | |
| Both are reversible pauses | Reversible contact kill invites accidentally resuming someone who complained. | |

### What happens to remaining touches on resume?

| Option | Description | Selected |
|--------|-------------|----------|
| Shift schedule from resume (Recommended) | Remaining touches keep relative spacing, re-anchored from the resume moment. One rule for every pause type. | ✓ |
| Keep original calendar | Overdue touches re-window, future ones untouched; can bunch touches after a long pause. | |
| Operator chooses at resume | Extra UI + an extra state to test. | |

### 'reopened' and 'removed' events?

| Option | Description | Selected |
|--------|-------------|----------|
| Reopen=triage, remove=stop (Recommended) | removed terminally stops; reopened returns the quote to needs_review — a reopen usually means active negotiation. | ✓ |
| Reopen=fresh cadence, remove=stop | Auto-restart risks texting a customer mid-negotiation. | |
| Reopen=resume old cadence | Stale schedule context; the stop was terminal for a reason. | |

---

## Overdue re-window policy

### What is "the next allowed slot"?

| Option | Description | Selected |
|--------|-------------|----------|
| Today if window open, else next day (Recommended) | Send at next tick with jitter if the window's still open with margin; else next allowed day at preferred slot. | ✓ |
| Always next day's preferred slot | A touch missed by 10 minutes waits a full day. | |
| Send immediately on recovery | Post-outage, all clients' touches burst at the same minute. | |

### Collision with the next touch's slot?

| Option | Description | Selected |
|--------|-------------|----------|
| Min-gap: skip the stale one (Recommended) | Minimum gap (~2 days) between consecutive sends; a re-windowed touch inside the gap is skipped, the next touch carries the conversation. | ✓ |
| Push everything later | Cadence stretches; a delayed quote could be chased 5+ weeks. | |
| Send both as scheduled | Back-to-back messages read as nagging. | |

### Staleness cap?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip past ~72h overdue (Recommended) | Marked skipped_stale, never sent; cadence moves to the next touch. | ✓ |
| No cap — re-window handles it | After a fortnight pause, timing no longer makes sense. | |
| Stale = operator decision | Ongoing triage work; the console is Phase 6. | |

### Hard overall expiry?

| Option | Description | Selected |
|--------|-------------|----------|
| Cap at ~6 weeks (Recommended) | Auto-completes as 'expired' with remaining touches unsent; shows in the pipeline view, not the send queue. | ✓ |
| No expiry | Could still be texting about a 3-month-old quote. | |
| Operator-configurable per client | Another knob nobody asked for yet. | |

---

## Dispatch handoff boundary

### What does a touch coming due produce in this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Full pipeline + stub sender (Recommended) | Full JIT revalidation + ledger claim, then a pluggable sender interface; Phase 3 ships a stub that logs. Every CAD test runs against the real path; Phase 4 swaps the sender. | ✓ |
| Queue rows for Phase 4 | "Never twice" and revalidation timing unprovable until Phase 4. | |
| Scheduling only, no dispatch | CAD-04/05 success criteria would go unproven this phase. | |

### Model drafting/approval stages now?

| Option | Description | Selected |
|--------|-------------|----------|
| Model full lifecycle, stub the gates (Recommended) | scheduled → needs_draft → pending_approval → approved → sent/skipped, with gates auto-passed; touches surface ahead of the send slot. | ✓ |
| Minimal states now, extend later | Phases 5/6 migrate live rows into a reshaped machine; CAD-03 tests rewritten twice. | |
| Approval outside the touch machine | "Where is this touch stuck?" spans multiple tables. | |

### Who owns the suppression table?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 3 builds it (Recommended) | Contact-kill writes to it, dispatch revalidates against it, gate proven now; Phase 4's STOP regex becomes another writer. | ✓ |
| Phase 4 owns it, Phase 3 stubs the check | CAD-05 not truly demonstrated until later. | |
| Suppression = cadence stop only | A new quote for a suppressed contact would start a fresh cadence — the Spam Act failure mode. | |

### Operator visibility before Phase 6?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal console additions (Recommended) | Cadence state + upcoming touches on quote detail; kill/pause/resume buttons. Full queue UX stays in Phase 6. | ✓ |
| Read-only view, no controls | A kill switch you can't reach from your phone isn't a kill switch. | |
| No UI at all this phase | Stub-sending real clients' schedules blind. | |

---

## Claude's Discretion

- Tick mechanics (own pg_cron schedule vs piggyback on sync tick), route/endpoint design
- Send ledger schema, unique-constraint shape, stub-sent marking
- Exact named-constant values (min-gap, staleness cap, expiry, draft lead time, jitter range)
- Cadence/touch table design, consumer registration, crash-safe cursor advancement
- Primary-contact selection rule specifics
- Definition of "enough margin" for same-day re-windows

## Deferred Ideas

None — discussion stayed within phase scope.
