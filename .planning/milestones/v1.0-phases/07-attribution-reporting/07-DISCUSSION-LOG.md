# Phase 7: Attribution & Reporting - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 7-Attribution & Reporting
**Areas discussed:** Attribution window & edge rules, Conservative net-of-baseline figure, Report period/freezing/delivery, Instrumentation definitions & home

The user selected all four areas and asked for a recommendation on every question. Every recommended option was accepted.

---

## Attribution window & edge rules

### How long after the last sent touch does a win still count?

| Option | Description | Selected |
|--------|-------------|----------|
| 30 days after last sent touch (Recommended) | Cadence runs ~3 weeks; a win within a month of the final touch is defensible; tight window protects the 3×-fees guarantee; anchored on last SENT touch | ✓ |
| 60 days after last sent touch | Captures slower trade decisions; higher gross, weaker story per job | |
| 90 days after last sent touch | Matches audit WINDOW_DAYS; most generous, hardest to defend per job | |

### Which sent touches qualify as evidence?

| Option | Description | Selected |
|--------|-------------|----------|
| outcome=sent, excluding known-undelivered (Recommended) | Real provider, outcome 'sent', minus delivery_status undelivered; email counts on sent; pending SMS receipt counts | ✓ |
| outcome=sent only, ignore delivery status | Simplest; credits a win after a carrier-reported undelivered SMS | |
| Carrier-confirmed delivered only | Strictest; excludes every email touch and any SMS with no receipt | |

### Which dollar figure is 'recovered'?

| Option | Description | Selected |
|--------|-------------|----------|
| Quote value snapshotted at attribution, frozen (Recommended) | Copy total_invoice_amount into the attribution record; report can never drift; later ServiceM8 edits show as discrepancies | ✓ |
| Live mirror value at report time | Always reflects latest figure; two prints of one month can disagree | |
| Value at cadence creation | Misses price changes agreed during the chase | |

### How many times can one quote be attributed?

| Option | Description | Selected |
|--------|-------------|----------|
| Once per quote, ever (Recommended) | First qualifying win; unique-constrained row per quote, the ledger's never-twice pattern | ✓ |
| Once per win event | Reopen→win cycles count twice; easy to challenge on an invoice | |
| Once per cadence | Each chase sequence claims its own win; risks two rows for one invoice | |

**User's choice:** All four recommended options.
**Notes:** None.

---

## Conservative net-of-baseline figure

### Which baseline is canonical when both exist?

| Option | Description | Selected |
|--------|-------------|----------|
| Connect-time snapshot is canonical (Recommended) | Same code path and window for every client; prospect audit baseline footnoted if present and different | ✓ |
| Prospect audit baseline wins when present | What the client was sold on; absent for most clients, may be CSV-derived | |
| Whichever was computed earlier | Mixed provenance; harder methodology footnote | |

### How is the conservative figure computed?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-job haircut: value × (1 − baseline win rate) (Recommended) | Per-job conservative value; never negative; sums cleanly; stored per row | ✓ |
| Subtract expected baseline wins across all chased quotes | Purer statistically; can go negative in a thin month | |
| Conservative = only wins preceded by a customer reply | Engagement-proven; doesn't satisfy 'net-of-baseline' wording | |

### What shows when the baseline is null?

| Option | Description | Selected |
|--------|-------------|----------|
| Named conservative default constant, footnoted (Recommended) | DEFAULT_BASELINE_WIN_RATE set deliberately HIGH; value + minimum-sample threshold Claude's discretion from research | ✓ |
| Gross only, with a 'baseline unavailable' footnote | Leaves the 3×-fees guarantee unprovable for that client | |
| Operator enters a baseline manually before the first report | Adds an onboarding step | |

### Does the baseline ever refresh?

| Option | Description | Selected |
|--------|-------------|----------|
| Frozen at connect, never refreshed (Recommended) | One-time pre-service fact; later windows contain our own wins; months stay comparable | ✓ |
| Operator can re-snapshot deliberately | Invites drift | |
| Rolling pre-service window | More code for no new information | |

**User's choice:** All four recommended options.
**Notes:** None.

---

## Report period, freezing & delivery

### Report period and late-win month

| Option | Description | Selected |
|--------|-------------|----------|
| Calendar month in client's zone; win lands in the month it was detected (Recommended) | Matches the retainer invoice; detection from the outbox event, not ServiceM8's editable work_order_date | ✓ |
| Calendar month; win lands in the month of its last sent touch | A sent report can change when a late win back-fills a closed month | |
| Rolling 30-day window from generation | Overlapping reports the client can't reconcile against invoices | |

### Frozen record or live page?

| Option | Description | Selected |
|--------|-------------|----------|
| Frozen, versioned report rows (Recommended) | Report row with figures, per-job lines, baseline + constants, generated_at, version; page renders from the row; regeneration keeps N | ✓ |
| Live-computed on every view | No record of what the client was sent | |
| Live page with an explicit 'lock' action | Extra state; an unlocked report can still be sent by mistake | |

### How does the report reach the client?

| Option | Description | Selected |
|--------|-------------|----------|
| Print-styled page, operator sends it (Recommended) | Reuse the audit A4 print pattern; operator prints to PDF and attaches to the invoice | ✓ |
| System emails the PDF via Resend | Needs a report recipient, server-side PDF rendering, transactional template | |
| Tokenized read-only web link | Effectively V2-08's portal | |

### Fees source and what the multiple divides

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tenant fee schedule with effective-from dates (Recommended) | Monthly fee + setup fee with effective dates; report reads the fee in force; headline multiple = conservative ÷ fees, gross multiple beside | ✓ |
| Operator types fees in at generation time | Not reproducible | |
| Plan-tier enum mapped to fixed amounts | Breaks on a negotiated number | |

**User's choice:** All four recommended options.
**Notes:** None.

---

## Instrumentation definitions & home

### Where does instrumentation live?

| Option | Description | Selected |
|--------|-------------|----------|
| New /reports area: cross-client overview + per-client detail (Recommended) | /reports lists every client with five metrics; /reports/[client] has metrics, evidence, report list, Generate; pipeline page only links | ✓ |
| Section on the existing client page only | No cross-client comparison; pipeline page grows again | |
| Both: metrics strip on client page plus /reports | Two renderings of one number (the CR-01 shape) | |

### Metric time window

| Option | Description | Selected |
|--------|-------------|----------|
| Rolling 30 days, live (Recommended) | Catches problems now; reports stay frozen calendar months; labelled as different instruments | ✓ |
| Calendar month, matching the reports | Operator view empty every month-start | |
| Operator-selectable window | More UI for a solo operator | |

### What counts as opt-out/complaint, where does the >5% alarm surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-outs only, alarm as a badge on /reports (Recommended) | STOP + unsubscribe + confirmed soft opt-out over contacts with ≥1 real sent touch; labelled 'opt-out rate'; red badge + one digest line; never auto-pause | ✓ |
| Opt-outs plus 'objection' and 'not_interested' classifications | Inflates the alarm; an objection is about price | |
| Opt-outs plus an operator-flagged 'complaint' marker | Separates genuine complaints; small new inbox affordance | |

### How is human-edit rate defined?

| Option | Description | Selected |
|--------|-------------|----------|
| Share of approved drafts with edit_distance > 0, mean distance beside it (Recommended) | V2-01 is written as a share; mean normalized distance distinguishes tiny edits from rewrites; validator-forced edits count | ✓ |
| Mean normalized edit distance only | Conflates 'many tiny edits' with 'few rewrites' | |
| Share edited beyond a materiality threshold | One more constant to defend | |

**User's choice:** All four recommended options.
**Notes:** None.

---

## Closing check

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Write CONTEXT.md; remaining details to Claude's discretion with stated defaults | ✓ |
| Explore more gray areas | Attribution computation trigger, evidence-chain presentation, chased-but-open quotes, first-touch denominator exclusions | |

## Claude's Discretion

- When attribution is computed (outbox consumer with own cursor vs. at report time); attribution table shape; evidence-chain storage
- Report row schema, version semantics, whether unattributed wins appear as context
- Page/print layouts and badge visuals (UI hint: yes)
- DEFAULT_BASELINE_WIN_RATE value and minimum-sample threshold
- Fee schedule schema and setup-fee treatment
- Optional escalation-latency metric
- Badge count read path and digest-line wiring

## Deferred Ideas

- System-sent report emails / tokenized client links (V2-08)
- Operator-flagged complaint marker on inbound messages
- Engagement-proven third figure (wins preceded by a reply)
- Operator baseline re-snapshot
- Selectable instrumentation windows
- Cross-client benchmarking (V2-04)
- Phase 2's flagged assumptions (AUDIT_RECOVERY_RATE, won-inside-72h-grace) stay the operator's call before the first real audit
