# Milestones

## v1.2 Missed-call text-back (Shipped: 2026-10-15, every live proof event-gated on the first client)

**Phases completed:** 5 phases (11 Telephony Capture, 12 Instant Text-back & Arming, 13 Lead Cadence, Labels & Escalation, 14 ServiceM8 Job Creation & Lead Resolution, 15 Lead Console, Reporting & Privacy), 37 plans — 35 executed, 2 skipped by founder override (11-08 carrier spike, 12-09 first live text-back), 136 tasks
**Timeline:** 2026-09-27 → 2026-10-15 (263 commits since the v1.1 close)
**Codebase:** 388 source files / ~87k lines under `src/`, 211 test files, 43 migrations (0038–0042 this milestone); CI runs every DB-backed suite on a fresh local Supabase stack
**Closeout:** verified_closeout — 5/5 phases verified (VERIFICATION passed + founder UAT), 26/26 requirements satisfied, 16/16 seams wired, 4/4 E2E flows complete in CI (`milestones/v1.2-MILESTONE-AUDIT.md`); nothing has ever run live against a customer — every live clause is event-gated with a named relocation (see below)

**Delivered:** a missed call to a client's diverted Twilio number is answered by an unrecorded Australian greeting, lands as a missed-call row, and within seconds the caller receives one attested text from the client's identity through the existing ClickSend number and send ledger, gated deterministically (never-text, withheld, non-mobile, suppressed, 24 h repeat, daily cap, 90-day negative cool-off, 24 h post-conversion); the caller becomes a lead chased with two human-approved follow-ups inside contact hours then closed for good; replies are classified in a lead vocabulary with urgency, STOP first, then the tradie's DONE, then URGENT/emergency keywords, with hot replies, ring-twice and held after-hours escalations reaching the tradie's phone; one operator tap creates the ServiceM8 quote job exactly once with the mirror pre-inserted so the sync opens no second cadence, and tradie-booked jobs resolve the lead automatically; the operator works a cross-client lead queue and a per-client missed-call log from a phone; the monthly report and `/reports` carry first-party missed-call figures with denominators and a design-partner CSV with no personal data; callers are covered by the reviewed privacy notice and a nightly 90-day pseudonymisation pass (HMAC, suppressions kept forever). Per-client text-back arming goes through the audited gate with a strict diverted-call proof, template attestation, privacy coverage and a ClickSend balance alarm/auto-disarm.

**Key accomplishments:**

1. Telephony capture with nothing recorded (WA all-party consent avoided structurally), two signed webhook doors, nightly call-log reconcile as the guarantee, WA-range number filter and bundle read-back after the first purchase went wrong.
2. Instant text-back as touch 1 of a `kind='lead'` cadence through the existing ledger — delivery receipts, STOP, pause-on-reply and metrics apply unchanged; per-kind cadence policy so lead timings are never skipped by the quote's 48-hour rules.
3. The lead vocabulary, keyword rule, hold/release and ring-twice escalation — an emergency at 11 pm reaches the tradie; a cold question waits for the morning digest.
4. The first ServiceM8 write path, settled by a measured spike (uuid-in-header, soft delete, duplicate POST creates twice, Company has no mobile), with claim/adopt-before-create exactly-once and the first-sight guard.
5. Honest instrumentation: every rate with its denominator, S4 timing "no samples" until measured, lead-born jobs counted never attributed.
6. The privacy posture: callers section, plain-text pointer with no link, 90-day keyed pseudonymisation riding the existing reconcile tick, with the gate's cool-off identity so a hashed row never changes a texting decision.

**Founder overrides (recorded, each with a named relocation):** 11-08 three-carrier divert spike skipped (no second phone) — CLI survival through carrier diverts is unproven; the strict `divertVerified` rule refuses to arm on a direct-dial proof. 12-09 first live text-back session skipped (no second number) — no text-back has ever been sent on production; S4 timing unmeasured.

**Carried forward (event-gated on the first signed client):** CON-03 and MSG-02/DOM-04 from v1.1; the 11-08 and 12-09 proofs; the first live lead, reply, escalation, job, DONE, frozen report with figures, CSV with data; the first pseudonymisation (early January 2027). Consolidated list: `milestones/v1.2-MILESTONE-AUDIT.md`.

**Accepted at close:** review info items left open by design (11: IN-01/02/04/05/06/07; 12: IN-01..09; 13: IN-01..11; 14: IN-01/03..06/08/09; 15: IN-02..08); three inert research-spike rows in production `quotes`/`quote_contacts` (founder's call to delete); Nyquist VALIDATION files `draft` for Phases 11–15; Phase 13's 26 plan prohibitions not ratified in UAT; two privacy facts awaiting founder confirmation (ClickSend processes in Australia; 12-month converted-lead ceiling); OAuth `create_jobs` scope unconfirmed for App ID 000000; pepper rotation is a recorded decision, never routine; the migration apply at each phase close is run by the founder by hand (agent classifier refusal, 13-07/14-05/15-08).

**v1.3 candidates (not roadmapped):** Bedrock Sydney + Vercel OIDC federation (AU inference residency, no static Anthropic key); lead dollars attribution; client-reported call totals; booking-form template variable; inbound MMS; per-client SMS numbers; a dedicated kind for the unique-violation recovery sheet sentence; the client-agreement clauses (D-12, founder non-code task before the first signing).

**Archives:** `milestones/v1.2-ROADMAP.md`, `milestones/v1.2-REQUIREMENTS.md`, `milestones/v1.2-MILESTONE-AUDIT.md`, `milestones/v1.2-phases/`

## v1.1 GTM Launch (Backdesk) (Shipped: 2026-09-27, two proofs carried forward)

**Phases completed:** 3 phases (8 Brand & Domains, 9 Landing Page & Audit Intake, 10 First-Client Go-Live), 26 plans — 24 executed, 2 event-gated (+ 9 quick tasks)
**Timeline:** 2026-09-06 → 2026-09-27 (221 commits since v1.0)
**Codebase:** 140 test files, 38 migrations
**Closeout:** shipped_with_carry_forward — every line of code in the milestone is deployed and verified; the two remaining plans (10-07 CON-03 live escalation proof, 10-08 MSG-02/DOM-04 live email proof) are human-action proofs that cannot run until a founding client signs and connects ServiceM8. Closed on 2026-09-27 when the founder redirected the product toward missed-call text-back (see `docs/reports/Avoca AI and an Australian equivalent.md`).

**Delivered:** the quote-recovery loop is sellable under the Backdesk brand: brand module and logo v2 on every surface; console at app.backdesk.com.au and sending domain quotes.backdesk.com.au; public site at backdesk.com.au with the Quote Leakage Audit intake, ServiceM8 how-to, the first guide page, structured data for the listings and per-request arrival source; console arming with audited transactional arm/disarm gated on the onboarding checklist, proof recording, an eleven-item checklist with a Live state, the first-client go-live runbook, and the ServiceM8 own-comms row shape measured.

**Carried forward into v1.2 (event-gated on the first signed client):**

- 10-07 CON-03 live escalation handset proof on production.
- 10-08 MSG-02 / DOM-04 live email proof (send from the verified identity, Resend `delivered`, live one-click unsubscribe).

**Accepted at close:** Phase 10 VERIFICATION not run (six of eight plans complete; interim code review CR-01 + WR-01..03 fixed); Cowork's "Phase 11" listings request shipped as quick task 260919-mij and accepted by marketing 20 Sep 2026.

**Archives:** `milestones/v1.1-ROADMAP.md`, `milestones/v1.1-REQUIREMENTS.md`, `milestones/v1.1-phases/`

## v1.0 MVP — the end-to-end quote-recovery loop (Shipped: 2026-09-05)

**Phases completed:** 7 phases, 51 plans, 90 tasks (+ 11 quick tasks)
**Timeline:** 2026-08-25 → 2026-09-05 (12 days, 532 commits)
**Codebase:** 259 source files / ~92k lines under `src/`, 121 test files / ~49k lines, 35 migrations; 2,437 pure assertions + remote-gated suites run in CI against a local Supabase stack
**Closeout:** verified_closeout — 7/7 phases verified (VERIFICATION passed), 30/30 requirements satisfied, 15/15 seams wired, 4/4 E2E flows complete (`milestones/v1.0-MILESTONE-AUDIT.md`); 1 acknowledged deferred item (a deliberate v1.1 backlog todo, see STATE.md Deferred Items)

**Delivered:** a Perth trade business connects its ServiceM8 account, every open quote is chased through a human-approved, Claude-drafted SMS cadence on a dedicated AU number that stops deterministically on STOP/reply/win/loss, hot replies reach the tradie's handset, and every recovered job is attributed with an evidence chain and reported monthly as a frozen, printable A4 page with gross and conservative dollars against fees paid.

**Key accomplishments:**

1. **Tenant-safe foundation in Sydney** — RLS from migration 001, a `forTenant()` closure with no unscoped query surface, an ESLint ban and a mutation-checked two-tenant leak test that blocks CI (Phase 1).
2. **ServiceM8 mirror + Quote Leakage Audit** — edit_date-cursor polling inside rate limits, a transactional outbox for won/lost/deleted transitions, and the one-page prospect audit with a frozen baseline win rate (Phase 2).
3. **The cadence state machine** — two hand-decided total state machines (114 cells), materialized contact-hours-aware 5-touch schedules, a send ledger with a Postgres unique index making duplicate sends structurally impossible, JIT revalidation and a deterministic stop matrix (Phase 3).
4. **Compliance-gated messaging** — dedicated AU number `+61491579212` live and proven end to end (sent, delivered, replied, STOPped, suppressed), deterministic STOP before any LLM across both channels, delivery receipts with a reconcile poll, RFC 8058 one-click email unsubscribe; per-tenant arming row is the switch (Phase 4).
5. **Claude in the client's voice, never trusted with facts** — drafting from approved templates + voice profile with a verbatim price/date validator as the trust boundary; reply classification into a closed enum with low-confidence triage; onboarding gate: cadences born paused until templates are approved and the SM8 automation-off attestation is recorded (Phases 5–6).
6. **Operator console + attribution & reporting** — phone-first approval queue, per-client pipeline, stall alerts and the 06:30 digest, hot-lead escalation SMS; evidence-chained attribution (won within 30 days of the last qualifying send, once per quote, value frozen), frozen versioned monthly reports printed to A4 from the browser, and rolling per-client instrumentation with an opt-out alarm (Phases 6–7).

**Carried forward (event-gated, cannot close before the first client):**

- MSG-02 live email proof on a verified client domain — at first-client onboarding (recorded override, 04-10).
- CON-03 live escalation handset proof — at first-client arming (messaging_config sms row).
- First-client arming checklist (PROJECT.md Active).

**Accepted at close:** Broken Windows ledger 0 open (15 fixed, 13 waived with reasons, 2026-09-05); Nyquist VALIDATION.md files left `draft` for all seven phases — run `/gsd-validate-phase N` when v1.1 next touches phase N; one v1.1 backlog todo (drafting should call the onboarding-gate helpers).

**Archives:** `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`, `milestones/v1.0-phases/`
