# Phase 6: Review Console & Escalation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-31
**Phase:** 6-Review Console & Escalation
**Areas discussed:** Approval queue mechanics, Hot-lead SMS escalation, Draft aging & stalled alerts, ONB-04 verification method, CON-02 pipeline view

The user selected all four proposed gray areas plus "Propose your recommendations for each"; every question was presented recommendation-first and every recommended option was accepted. CON-02 pipeline view was added at the final check.

---

## Approval queue mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| One cross-client queue (Recommended) | Single queue across all clients, sorted by time-to-send-slot; client name on every card; drafts only | ✓ |
| Grouped by client | Sectioned per client, each deadline-sorted | |
| Per-client queues | Enter each client to see their drafts | |

| Option | Description | Selected |
|--------|-------------|----------|
| Terminal skip w/ reason (Recommended) | Skip = touch → skipped with new operator reason; cadence continues; no defer button | ✓ |
| Skip whole cadence step + option to stop | Also surface "stop chasing entirely?" | |
| Defer only | Skip pushes down queue; declining requires quote page | |

| Option | Description | Selected |
|--------|-------------|----------|
| One-at-a-time, full body (Recommended) | Every approve one tap on one visible body; no select-all/approve-all | ✓ |
| Per-client approve-remaining | Batch commit after reviewing a client's run | |

| Option | Description | Selected |
|--------|-------------|----------|
| No field — full review is v1 (Recommended) | Don't model review_mode; 30-day clock derivable from tenants.created_at for V2-01 | ✓ |
| Add review_mode field now, full-only | Store the future data home now | |

**User's choice:** All recommendations accepted.

---

## Hot-lead SMS escalation

| Option | Description | Selected |
|--------|-------------|----------|
| Separate alert path (Recommended) | Escalation module calls ClickSend directly, bypassing dispatch and customer-protection gates; own evidence row | ✓ |
| Through TouchSender seam | Reuse routing sender + send_ledger | |

| Option | Description | Selected |
|--------|-------------|----------|
| Shared number + tap-to-call (Recommended) | Existing shared number; message carries customer mobile; tradie replies land unmatched in triage | ✓ |
| Second dedicated alert number | ~AUD 21/mo clean separation | |

| Option | Description | Selected |
|--------|-------------|----------|
| Name + reply + tap-to-call (Recommended) | Customer name, quote snippet, reply text (~2 segments), customer mobile — self-contained | ✓ |
| Reply excerpt only, details on request | Shorter, withholds lead warmth | |

| Option | Description | Selected |
|--------|-------------|----------|
| Same tick as classify (Recommended) | Fires in the tick that sets is_hot; one SMS per hot message, recorded sent-at; cooldown at discretion | ✓ |
| Batched digest | Combined SMS every N minutes | |
| Escalate + notify operator too | Also email/SMS the operator per hot lead | |

**User's choice:** All recommendations accepted.

---

## Draft aging & stalled alerts

| Option | Description | Selected |
|--------|-------------|----------|
| Deadline-relative (Recommended) | Stalled = unapproved touch (needs_draft OR pending_approval) with slot inside threshold or past; keys on touch state (covers 05-04 no-row gap) | ✓ |
| Age-based | Alert on hours since draft creation | |

| Option | Description | Selected |
|--------|-------------|----------|
| Email + queue badge (Recommended) | Existing operator-email machinery + nav badge; operator SMS later if needed | ✓ |
| SMS to operator | Lands harder, more plumbing | |
| Both from day one | Maximum safety, most noise | |

| Option | Description | Selected |
|--------|-------------|----------|
| Once per threshold + digest (Recommended) | One alert per touch per crossing (alerted_at dedupe); daily digest of still-stalled | ✓ |
| Escalating repeats | Backoff re-alerts until handled | |

| Option | Description | Selected |
|--------|-------------|----------|
| Queue + nav badge + client rows (Recommended) | Urgency on cards, nav count badge, per-client pending indicator | ✓ |
| Queue only | Aging strictly on the queue screen | |

**User's choice:** All recommendations accepted.

---

## ONB-04 verification method

| Option | Description | Selected |
|--------|-------------|----------|
| Attestation + research probe (Recommended) | Operator attests with evidence note (D-06 pattern); researcher investigates API/behavioral detection as bonus backstop | ✓ |
| Behavioral detection required | Block until system proves no native follow-ups | |
| Attestation only, no research | Skip detection research entirely | |

| Option | Description | Selected |
|--------|-------------|----------|
| Extend onboarding gate (Recommended) | paused(onboarding) becomes checklist: templates approved AND sm8-automation attested; one pause reason, one resume path | ✓ |
| Second pause reason | Distinct sm8_check reason; vocabulary + resume matrix grow | |

| Option | Description | Selected |
|--------|-------------|----------|
| Evidence pauses, staleness nags (Recommended) | Hard evidence of native follow-up → pause + alert; stale attestation → nag only, no auto-pause | ✓ |
| Stale = pause | Any stale attestation auto-pauses | |
| Alert only, never pause | Even hard evidence only alerts | |

| Option | Description | Selected |
|--------|-------------|----------|
| Full checklist card (Recommended) | Per-client onboarding checklist: mostly derived items, one attested | ✓ |
| Single check only | Just the SM8-automation item, no checklist UI | |

**User's choice:** All recommendations accepted.

---

## CON-02 pipeline view

| Option | Description | Selected |
|--------|-------------|----------|
| Evolve client-detail page (Recommended) | clients/[id] grows into the pipeline view; no new sub-page | ✓ |
| New /pipeline sub-page | Dedicated screen, one more hop | |

| Option | Description | Selected |
|--------|-------------|----------|
| Group by cadence state (Recommended) | Needs attention → actively chasing → waiting → closed (collapsed) | ✓ |
| Flat table + status filter | Extend existing table with filter control | |
| Timeline view | Chronological feed; new pattern | |

| Option | Description | Selected |
|--------|-------------|----------|
| Per-quote thread on quote page (Recommended) | Pipeline shows compact indicators; full conversation thread on quote-detail | ✓ |
| Client-level message feed | Last N messages with bodies on pipeline page | |

| Option | Description | Selected |
|--------|-------------|----------|
| Next touch per quote + count (Recommended) | Per-quote next touch + weekly summary line | ✓ |
| 7-day schedule list | Every scheduled touch for 7 days in send order | |

**User's choice:** All recommendations accepted.

---

## Claude's Discretion

- Stall threshold hours, escalation cooldown window, digest send time
- Escalation evidence-row shape (own table vs columns on inbound_messages)
- Queue card layout, urgency visuals, mobile edit UX (UI-phase candidate)
- New operator skip reason name (CHECK-constraint pattern)
- Onboarding-checklist storage shape
- Where the tradie's alert mobile lives (tenants vs cadence_settings)
- How ONB-04 attestation composes with the approval-resume write

## Deferred Ideas

- Sampled review / graduated autonomy (V2-01)
- Second dedicated alert number for tradie SMS
- Operator SMS alerts for stalled drafts
- Behavioral SM8-automation detection as the gate (vs backstop)
- 7-day upcoming-touches schedule view
