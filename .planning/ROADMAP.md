# Roadmap: Quote Recovery MVP (Backdesk)

## Milestones

- ✅ **v1.0 MVP — the end-to-end quote-recovery loop** — Phases 1-7 (shipped 2026-09-05) — [archive](milestones/v1.0-ROADMAP.md) · [audit](milestones/v1.0-MILESTONE-AUDIT.md)
- ✅ **v1.1 GTM Launch (Backdesk)** — Phases 8-10 (shipped 2026-09-27, two event-gated proofs carried forward) — [archive](milestones/v1.1-ROADMAP.md) · [requirements](milestones/v1.1-REQUIREMENTS.md)
- ✅ **v1.2 Missed-call text-back** — Phases 11-15 (shipped 2026-10-15, every live proof event-gated on the first client) — [archive](milestones/v1.2-ROADMAP.md) · [requirements](milestones/v1.2-REQUIREMENTS.md) · [audit](milestones/v1.2-MILESTONE-AUDIT.md)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-7) — SHIPPED 2026-09-05</summary>

- [x] Phase 1: Foundation & Tenancy (4/4 plans) — completed 2026-08-26
- [x] Phase 2: ServiceM8 Sync & Quote Leakage Audit (7/7 plans) — completed 2026-08-27
- [x] Phase 3: Cadence Engine (9/9 plans) — completed 2026-08-28
- [x] Phase 4: Messaging Gateway (10/10 plans) — completed 2026-08-30
- [x] Phase 5: AI Drafting & Classification (8/8 plans) — completed 2026-08-31
- [x] Phase 6: Review Console & Escalation (6/6 plans) — completed 2026-09-02
- [x] Phase 7: Attribution & Reporting (7/7 plans, incl. 2 gap-closure) — completed 2026-09-04

Full phase details, goals, success criteria and plan lists: `milestones/v1.0-ROADMAP.md`. Phase artifacts (plans, summaries, verifications, UATs, security reviews): `milestones/v1.0-phases/`.

</details>

<details>
<summary>✅ v1.1 GTM Launch (Backdesk) (Phases 8-10) — SHIPPED 2026-09-27 (two proofs carried forward)</summary>

- [x] Phase 8: Brand & Domains (7/7 plans) — completed 2026-09-09
- [x] Phase 9: Landing Page & Audit Intake (11/11 plans) — completed 2026-09-10
- [x] Phase 10: First-Client Go-Live (6/8 plans; 10-07 and 10-08 are event-gated human-action proofs carried into v1.2) — closed 2026-09-27

Full phase details, goals, success criteria and plan lists: `milestones/v1.1-ROADMAP.md`. Phase artifacts: `milestones/v1.1-phases/`.

</details>

<details>
<summary>✅ v1.2 Missed-call text-back (Phases 11-15) — SHIPPED 2026-10-15 (every live proof event-gated on the first client)</summary>

- [x] Phase 11: Telephony Capture (7/8 plans; 11-08 three-carrier divert spike SKIPPED by founder override) — completed 2026-10-05
- [x] Phase 12: Instant Text-back & Arming (8/9 plans; 12-09 first live text-back SKIPPED by founder override) — completed 2026-10-07
- [x] Phase 13: Lead Cadence, Labels & Escalation (7/7 plans) — completed 2026-10-09
- [x] Phase 14: ServiceM8 Job Creation & Lead Resolution (5/5 plans) — completed 2026-10-11
- [x] Phase 15: Lead Console, Reporting & Privacy (8/8 plans) — completed 2026-10-15

Full phase details, goals, success criteria, founder decisions and plan lists: `milestones/v1.2-ROADMAP.md`. Phase artifacts: `milestones/v1.2-phases/`. Audit: `milestones/v1.2-MILESTONE-AUDIT.md`.

</details>

## Carried forward (event-gated on the first founding client)

Not a phase. Human-action proofs that cannot run until a founding client signs, connects ServiceM8 and diverts a real number. The consolidated 15-item first-client proof list is in `milestones/v1.2-MILESTONE-AUDIT.md`; the onboarding steps are `docs/client-divert-onboarding-runbook.md` §6–§8.

| Item | Where it is recorded | Gate |
|---|---|---|
| **CON-03** (v1.0/v1.1) live escalation handset proof on production | `milestones/v1.1-phases/10-first-client-go-live/10-07-PLAN.md` | first founding client |
| **MSG-02 / DOM-04** (v1.0/v1.1) live cadence-email proof from the verified identity with a live one-click unsubscribe | `milestones/v1.1-phases/10-first-client-go-live/10-08-PLAN.md` | first founding client |
| **11-08** three-carrier divert spike (CLI survival through carrier diverts) — never done | `milestones/v1.2-phases/11-telephony-capture/11-08-SUMMARY.md` | first client's diverted verification call from a second phone |
| **12-09** first live text-back, S4 arrival→delivered timing, `text_back_proof` | `milestones/v1.2-phases/12-instant-text-back-arming/12-09-SUMMARY.md` | first client armed and texted |
| First live lead cadence, lead reply, escalation, job created from a lead, DONE, frozen report with missed-call figures, CSV with data, first pseudonymisation (early Jan 2027) | `milestones/v1.2-MILESTONE-AUDIT.md` first-client proof list | first client |

Also carried: the drafting/onboarding-gate parity todo (`.planning/todos/pending/`), the review debt register in the audit (IN-* items across Phases 11–15, Nyquist VALIDATION files `draft`), and the founder's non-code tasks (client-agreement clauses D-12; confirm the two privacy facts; rule on the three inert spike rows).

## Progress

**Execution Order:** Phases execute in numeric order 11 → 12 → 13 → 14 → 15. Phase 11 must start with the Twilio bundle and number purchase (activation gates every live check); its live divert spike (criterion 4) gates Phase 12. Phase 14 may overlap with Phase 13 once the `leads` table exists; Phase 15's console views may start after Phase 12, its figures need 11–14. The carried-forward proofs run whenever the first founding client signs, independent of phase order.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Tenancy | v1.0 | 4/4 | Complete | 2026-08-26 |
| 2. ServiceM8 Sync & Quote Leakage Audit | v1.0 | 7/7 | Complete | 2026-08-27 |
| 3. Cadence Engine | v1.0 | 9/9 | Complete | 2026-08-28 |
| 4. Messaging Gateway | v1.0 | 10/10 | Complete | 2026-08-30 |
| 5. AI Drafting & Classification | v1.0 | 8/8 | Complete | 2026-08-31 |
| 6. Review Console & Escalation | v1.0 | 6/6 | Complete | 2026-09-02 |
| 7. Attribution & Reporting | v1.0 | 7/7 | Complete | 2026-09-04 |
| 8. Brand & Domains | v1.1 | 7/7 | Complete | 2026-09-09 |
| 9. Landing Page & Audit Intake | v1.1 | 11/11 | Complete | 2026-09-10 |
| 10. First-Client Go-Live | v1.1 | 6/8 (2 event-gated, carried forward) | Complete | 2026-09-27 |
| 11. Telephony Capture | v1.2 | 8/8 | Complete    | 2026-10-05 |
| 12. Instant Text-back & Arming | v1.2 | 9/9 | Complete    | 2026-10-07 |
| 13. Lead Cadence, Labels & Escalation | v1.2 | 7/7 | Complete    | 2026-10-09 |
| 14. ServiceM8 Job Creation & Lead Resolution | v1.2 | 5/5 | Complete    | 2026-10-11 |
| 15. Lead Console, Reporting & Privacy | v1.2 | 8/8 | Complete    | 2026-10-15 |
