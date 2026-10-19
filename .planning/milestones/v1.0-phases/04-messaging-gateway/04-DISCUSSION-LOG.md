# Phase 4: Messaging Gateway - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-28
**Phase:** 4-Messaging Gateway
**Areas discussed:** Email reply path, Email scope for MSG-02, Ambiguous STOP policy, Number/sender config home

---

## Area Selection

All four proposed gray areas were selected, with the added instruction "Propose your recommendations for all" — Claude presented a recommended option per area and the user confirmed each recommendation.

---

## Email reply path

| Option | Description | Selected |
|--------|-------------|----------|
| Reply-To tradie (Recommended) | From: service subdomain, Reply-To: tradie's address. System never sees email replies; MSG-04 inbound threading scoped to SMS + unsubscribe events for this phase. Record Resend Inbound as the v2 trigger. | ✓ |
| Resend Inbound capture | Receive email replies on the service subdomain via email.received webhook — email replies thread and pause cadences like SMS. More build now; tradie no longer gets replies directly in their inbox. | |

**User's choice:** Reply-To tradie (Recommended)
**Notes:** Walking skeleton is SMS-only; email pause-on-reply becomes the documented v2 trigger for Resend Inbound.

---

## Email scope for MSG-02

| Option | Description | Selected |
|--------|-------------|----------|
| Pipe proven (Recommended) | Domain verify + SPF/DKIM + Spam Act footer + functional unsubscribe, proven by test send through the real TouchSender path. No email touches in live cadences this phase. | ✓ |
| Email touches in cadences | Also author email templates and enable email touches in real cadences now — pulls template/cadence-settings work forward from Phase 5. | |

**User's choice:** Pipe proven (Recommended)
**Notes:** All Phase 3 templates are SMS; template authoring stays with ONB-03/Phase 5.

---

## Ambiguous STOP policy

| Option | Description | Selected |
|--------|-------------|----------|
| Suppress all candidates (Recommended) | Write suppression for every candidate tenant (or bare number if no match), stop matched cadences, and create a triage item. Accepts mild cross-tenant visibility of the suppression row. | ✓ |
| Bare-number + triage only | Record the opt-out against the number without tenant attribution; operator resolves tenant scope in triage. Narrower writes, but a send could slip out before triage is worked. | |

**User's choice:** Suppress all candidates (Recommended)
**Notes:** Over-suppressing is the compliant failure mode.

---

## Number/sender config home

| Option | Description | Selected |
|--------|-------------|----------|
| DB config (Recommended) | A messaging-config table (global default row now, per-tenant override capable). Number lands mid-phase → one scripted ops step, no redeploy. | ✓ |
| Env var for v1 | Single CLICKSEND_FROM_NUMBER env var; simplest now, but v2 per-client numbers force the DB migration later and number changes require redeploys. | |

**User's choice:** DB config (Recommended)
**Notes:** Shaped for the stated v2 per-client-number direction; IPND unblock becomes an ops step.

---

## Claude's Discretion

- Minimal reply-triage surface shape (pre-Phase-6)
- DLR reconciliation cadence/mechanics (webhook hint, poll guarantee)
- `inbound_messages` and delivery-receipt schema design per evidence-table conventions
- STOP keyword set details (anchored whole-message regex baseline)
- Unsubscribe token mechanics (HMAC, uniform responses, own secret)
- Live-number activation checkpoint mechanics incl. empirical STOP-passthrough test and payload-shape capture
- svix install only if `resend@6.22.1` lacks `webhooks.verify()` (checkpointed)

## Deferred Ideas

- Resend Inbound email-reply capture — v2 trigger: email pause-on-reply wanted
- Email touch templates in live cadences — Phase 5
- Per-client dedicated numbers — v2 (config table shaped for it)
