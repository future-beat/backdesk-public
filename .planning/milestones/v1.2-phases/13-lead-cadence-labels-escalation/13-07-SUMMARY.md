---
phase: 13-lead-cadence-labels-escalation
plan: 07
subsystem: ops scripts / CI gate / production migration / deployment
status: complete
tags: [invariants, ci-gate, migration-0040, push-protocol, checkpoint-decision, one-way]
requires:
  - 13-01..13-06 (every Phase 13 commit on main at 8caa4ce)
provides:
  - scripts/lead-cadence-invariants.mjs (+ `npm run lead-cadence:invariants`, pinned read-only in tests/ops-scripts.test.ts)
  - migration 0040 applied to the hosted Sydney database (41 journal entries)
  - Phase 13 code deployed to production on 8caa4ce
  - evidence entry in docs/external-registrations.md
requirements-completed: []
requirements-advanced: [LEAD-01, LEAD-02, LEAD-03, LEAD-05]
---

# 13-07 SUMMARY — invariants, CI gate, production migration 0040, deploy

## Task 1 — read-only invariants script + phase CI gate
- `7bc03ae` feat(13-07): read-only lead cadence invariants script (one SELECT over pre-0040 tables + one `information_schema` probe; six `name=value` lines; no rows, ids or numbers printed; alias + ops-scripts pin).
- `8caa4ce` fix(13-07): lead-reply armed fixture carries a ServiceM8 connection — run `37761432686` failed three `lead-reply` cases because the tick only visits clients with a connection, which production arming also requires; the fixture now seeds one (dated comment). No assertion, CHECK, product code or protected pin changed.
- Branch `ci/phase-13-final`: run `37761432686` on `7bc03ae` failure → run `37762760641` on `8caa4ce` **success** (179/179 files, 5818 tests, 29 skipped; migrate step "Journal entries recorded: 41"). Branch deleted.

## Task 2 — checkpoint:decision (blocking-human)
Pre-flight read-only lines (verbatim in docs/external-registrations.md): invariants all zero with `schema_0040_applied=false`; lease rows 0, no watchdog, ticks 200; generator clean; `migrations recorded: 40`; ClickSend A$19.13; production Ready on `d83ec7a`; main 30 commits ahead.

**Founder reply (9 Oct 2026, verbatim): `apply-now`.**

## Task 3 — push protocol, push, probes, evidence
Order kept: invariants → lease gate → clean generator → `db:migrate` → no-op second run → read-back → `git push origin main` → CI → Vercel Ready → probes → evidence.

- **Deviation (process):** `npm run db:migrate` was refused by the agent permission classifier ("Production Deploy" / "Auto-Mode Bypass") in both the executor's and the orchestrator's session. Neither worked around it. The founder ran both invocations by hand and reported `41 entries, exit 0` for each; the orchestrator took the read-back (`migrations recorded: 41`, `schema_0040_applied=true`, generator still clean) before pushing.
- Push `d83ec7a..8caa4ce main -> main`; CI run `37875868246` **success** on `8caa4ce`; GitHub deployment `6951663119` Production; Vercel `dpl_BY1JDNRSZbSD9RDFz8jCF9LRM2JM` production **Ready** (2026-10-09 10:42 AWST).
- Probes: `/api/webhooks/twilio/voice?token=wrong` → 401; `/voice-status?token=wrong` → 401; `/api/internal/cadence-tick` wrong bearer → 401. `cadence-tick` answering 200 after the deploy. Invariants after: `leads_total=0`, `text_back_armed_tenants=0`.
- Evidence entry `## 2026-10-09 — Phase 13: migration 0040 pushed to the hosted database` appended; status table row added; diff scanned clean for 64-hex strings and `+61`.

## State after this plan
No tenant has an enabled text_back row and no lead exists; the deployed lead cadence code has nothing to act on until the first client is armed through the console. Phase 13 is 7/7 plans; code review, verification and UAT follow.

## Carried forward
- First client: the relocated live proofs (12-09 override) now also cover touch 2 appearing in `/queue`, a lead reply classified in the lead vocabulary, and a held/released escalation.
- Lead-format structured output at `MAX_CLASSIFY_TOKENS = 100` is unproven live (13-04); a failure retries, never mislabels.
- Founder key rotation after the deploy (Supabase DB password / service key); identity federation not applicable to Supabase today.
