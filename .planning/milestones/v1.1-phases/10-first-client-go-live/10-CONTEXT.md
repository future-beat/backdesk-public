# Phase 10: First-Client Go-Live - Context

**Gathered:** 2026-09-11 (decisions from the roadmap planning note, the v1.0 carried-forward obligations, and the operational findings of Phases 8–9; no separate discuss-phase run)
**Status:** Ready for planning

<domain>
## Phase Boundary

The operator takes a signed founding client from agreement to the first cadence send entirely from the console and a written runbook, and the two live proofs deferred since v1.0 are closed on production: CON-03 (hot-lead reply → escalation SMS on the tradie's handset) and MSG-02/DOM-04 (a cadence email from `quotes.backdesk.com.au`, delivered, reply threaded, RFC 8058 one-click unsubscribe suppressing both channels). Requirements: ARM-01..ARM-05, DOM-04.

Not in this phase: new cadence features, the M1 §5 messaging-copy changes (still deferred, needs a founder decision), per-client dedicated numbers, OAuth/webhooks (v1.2), the 11 Sep landing-copy conflict (Cowork).

</domain>

<decisions>
## Implementation Decisions

### The gate shape (the roadmap's open question)
- **D-01:** Two states, not one. **Armed** means `messaging_config` has an `enabled = true` row for the channel (tenant row, or the global sms row v1 shares). **Live** means armed AND the channel's live proof is recorded. The checklist (ARM-01) shows both. Arming (ARM-02) is gated on the *onboarding* items only: templates attested, SM8 automation-off attested, escalation phone set, contact hours set, and — for email — sending domain verified. The two proof items are NOT arming preconditions (they cannot be, since the proofs need the channel armed); they gate the **Go live** state and the runbook's final step. This resolves the ARM-01/ARM-02/ARM-03 circularity the roadmap flagged without inventing a "supervised first-arm mode".
- **D-02:** Proof recording is explicit and evidence-bearing: a `tenant_proofs` (or reuse of `tenant_attestations` with new kinds `escalation_handset_proof` and `email_pipe_proof`) row written by an operator action that requires the operator to paste the observable artefact id (the escalation row id / provider message id for SMS; the send-ledger id + inbound message id for email). No proof row without an artefact id. The checklist reads "recorded on {date}" from that row.

### Arming from the console (ARM-02)
- **D-03:** Arm/disarm is a server action on the client page (`(console)/clients/[id]`), one control per channel (SMS, email), writing through `upsertChannelConfig` — never raw SQL. SMS in v1 arms the **global** row (tenant_id NULL, from `+61491579212`) because every founding client shares the number; the control must say so plainly ("arms SMS for every connected client on the next tick") and the runbook must too. Email arms the **tenant** row (from-address on the verified `quotes.backdesk.com.au` domain, reply-to the tradie's business email, business name), created by the existing `/settings/email` flow.
- **D-04:** Every arm/disarm is audited: a `messaging_config_audit` table (channel, tenant_id nullable, action arm|disarm, operator user id, reason text required on disarm and optional on arm, created_at) written in the same transaction as the upsert. The client page shows the last three audit rows. `requireOperator()` first, as every mutating action does.
- **D-05:** Arming is refused (not just hidden) while any gating item is incomplete: the action re-reads the checklist conditions server-side (`readOnboardingConditions` + domain verification + escalation phone + contact hours) and returns the fixed refusal sentence naming the first missing item. Disarming is never gated.

### The two live proofs
- **D-06 (CON-03 / ARM-03):** Executed on production with the founding client's real ServiceM8 account and the operator's own handset standing in as the tradie's escalation phone for the proof if the client prefers (recorded which). Sequence: SMS armed → a real customer-style reply arrives on the dedicated number (the operator sends it from a second handset) → the escalation tick sends the escalation SMS → the escalation row shows `sent` with a provider message id → proof recorded via D-02. Never manufacture rows in the production database by SQL; the proof is produced by the product's own paths.
- **D-07 (MSG-02 / DOM-04):** Executed on production through the real `TouchSender` path: `scripts/verify-email-pipe.mjs --tenant <id> --to <address>` (built in Phase 4, refuses `onboarding@resend.dev`) sends ONE real email from the tenant's verified identity to an operator-controlled inbox; then a reply from that inbox threads to the quote (inbound email path); then the one-click unsubscribe is exercised and both channels show suppressed for that contact. Evidence: send-ledger row, delivery receipt, inbound row, suppressed_contacts rows — recorded in the phase verification and via D-02.
- **D-08:** Both proofs are **event-gated on a signed founding client** whose ServiceM8 account is connected. If no client has signed when the phase executes, the plans up to and including the console work complete; the two proof plans stop at a `checkpoint:human-action` ("founding client signed and connected") and the phase closes only when they run. The runbook is written regardless.

### ServiceM8 own-comms re-measure (ARM-04)
- **D-09:** On the founding client's connected account (or the trial account with a seeded native follow-up), run `node scripts/sm8-spike.mjs probe` to capture a non-empty `sms.json` / `email.json` row; record the field list in `docs/servicem8-api-notes.md` §"ServiceM8 own-comms (D-13)"; decide whether Tier 1 drift detection becomes designable (needs a job UUID + send timestamp on the row) and record the decision — no Tier 1 code is written in this phase unless the shape makes it a small addition to the existing staleness nag.

### Runbook (ARM-05)
- **D-10:** `docs/first-client-go-live-runbook.md`: from signed founding agreement → ServiceM8 private API key from the client → connect → templates in the client's voice approved and attested → SM8 automation-off attestation → contact hours + escalation phone → email identity added and domain verified (or the shared service domain) → **ClickSend balance check** (the first live SMS in Phase 9 failed with INSUFFICIENT_CREDIT) → arm SMS → CON-03 proof → arm email → MSG-02 proof → mark live → first cadence send observed on the queue → what to watch in week 1 (stall digest, opt-out rate, escalation). Each step names the console screen or script and the artefact that proves it. It also lists the operational housekeeping found in Phase 9: decline the two UAT `audit_requests` rows, confirm Supabase Auth URL config, keep the Resend key Full access.

### Operational facts to carry (from Phases 8–9)
- **D-11:** Production is the hosted Sydney Supabase; never `test:remote` during go-live windows; `npm run cron:status` before any cron change; the proxy now runs (Phase 9) and costs a `getClaims()` per console request — fine, but note it.
- **D-12:** Operator alerts go to `OPERATOR_ALERT_PHONE` / `OPERATOR_ALERT_FROM` (Phase 8/9); the event-gated Phase 8 UAT item ("alert From header reads Backdesk <alerts@quotes.backdesk.com.au>") is confirmed by the first real alert during this phase and recorded.

### Claude's Discretion
- Whether proofs live in `tenant_attestations` (new kinds) or a new `tenant_proofs` table; the audit table's exact columns; where the arm/disarm controls sit on the client page (the checklist card is the natural home); the runbook's exact section order.

</decisions>

<specifics>
## Specific Ideas

- The checklist card already exists (`(console)/clients/[id]/checklist-card.tsx`, six fixed labels from the Phase 6 UI-SPEC, a `Record` over the key union so a new item is a compile error until labelled). Extend it; do not build a second card.
- "Messaging armed" is already one of its labels — split it into "SMS armed" / "Email armed" plus the two proof rows and "Sending domain verified".
- Copy stays in the console voice (plain, no exclamation marks); the arming control must read as a switch with consequences, not a toggle.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and history
- `.planning/ROADMAP.md` §Phase 10 (success criteria + the gate planning note); `.planning/REQUIREMENTS.md` ARM-01..05, DOM-04
- `.planning/PROJECT.md` Key Decisions rows: messaging_config = the arming switch (Phase 4); ONB-03 attestation gate (Phase 5); MSG-02 deferral (Phase 4); CON-03 deferral (Phase 6); Phase 8/9 rows on domains, alerts, ClickSend balance
- `.planning/milestones/v1.0-phases/04-*/04-07-SUMMARY.md` (how the global sms row was armed and the handset test run), `05-*` ONB-03, `06-*` ONB-04 + escalation, `.planning/STATE.md` Blockers (Phase 4 OWED/RESTORE items, Phase 8/9 carry-forwards)

### Code surfaces
- `src/db/schema/messaging-config.ts`, `src/db/repository/messaging-config.ts` (`getChannelConfig`, `anyChannelEnabled`, `listChannelConfig`, `upsertChannelConfig`)
- `src/core/drafting/onboarding-gate.ts` (`readOnboardingConditions`, `onboardingComplete`, attestations), `src/core/onboarding/checklist.ts`, `src/app/(console)/clients/[id]/checklist-card.tsx` + `actions.ts`
- `src/db/schema/tenant-attestations.ts`, `tenants.ts` (`contact_hours_*`, `escalation_phone`), `escalations.ts`, `send-ledger`, `inbound-messages`, `suppressed-contacts`
- `src/core/escalation/escalate-hot-leads.ts` (disarmed refusals recorded), `src/core/messaging/resend-sender.ts`, `scripts/verify-email-pipe.mjs`, `scripts/setup-clicksend.mjs`, `scripts/sm8-spike.mjs`, `scripts/cron-status.mjs`
- `docs/servicem8-api-notes.md` §own-comms, `docs/external-registrations.md` (append-only evidence), `docs/env-vars.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The checklist card and `readOnboardingConditions` already compute five of the eight ARM-01 items; the missing three (domain verified, proofs, per-channel arming) are reads of existing tables plus the new proof rows.
- `upsertChannelConfig` is the only writer needed for arming; the audit table is new.
- `verify-email-pipe.mjs` is the MSG-02 proof harness, unchanged since Phase 4.

### Established Patterns
- Mutating actions authorise themselves (`requireOperator()` first); tenant writes through `forTenant()`; evidence recorded as dated entries in `docs/external-registrations.md`; live proofs = server-side artefacts, never dashboard screenshots.
- Attestations are write-once, latest-wins rows; proofs should follow the same shape.

### Integration Points
- Arming the global sms row affects every connected client; the console copy and the runbook must say so.
- The escalation tick and the cadence tick run every minute on production; proofs are observed through their normal artefacts.

</code_context>

<deferred>
## Deferred Ideas

- M1 §5 messaging copy (SMS footer, email From format, expanded footers) — founder decision pending
- Per-client dedicated numbers; OAuth + webhooks — v1.2
- Tier 1 SM8 automation drift detection — only if ARM-04's shape makes it designable
- Sampled review mode after 30 days of edit-rate data — V2-01

</deferred>

---

*Phase: 10-first-client-go-live*
*Context gathered: 2026-09-11*
