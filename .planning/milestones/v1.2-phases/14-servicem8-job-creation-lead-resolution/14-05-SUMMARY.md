---
phase: 14-servicem8-job-creation-lead-resolution
plan: 05
subsystem: ops scripts / CI gate / production migration / deployment
status: complete
tags: [invariants, ci-gate, migration-0041, push-protocol, checkpoint-decision, one-way]
requires:
  - 14-01..14-04 (every Phase 14 commit on main at bc620eb)
provides:
  - scripts/lead-jobs-invariants.mjs (+ `npm run lead-jobs:invariants`, pinned read-only in tests/ops-scripts.test.ts)
  - migration 0041 applied to the hosted Sydney database (42 journal entries)
  - Phase 14 code deployed to production on bc620eb
  - evidence entry in docs/external-registrations.md
requirements-completed: []
requirements-advanced: [SM8-01, SM8-02, SM8-03, LEAD-04]
---

# 14-05 SUMMARY — invariants, CI gate, production migration 0041, deploy

## Task 1 — read-only invariants script + phase CI gate
- `bc620eb` feat(14-05): read-only lead jobs invariants script (one SELECT over pre-0041 columns + one catalogue probe; six `name=value` lines; alias + ops-scripts pin, 73/73 locally).
- Branch `ci/phase-14-final`: run `38045171848` on `bc620eb` **success first run** (191/191 files, 6,140 tests, 29 pre-existing skips; migrate "Journal entries recorded: 42"); first real-database run of every hazard suite from 14-01..14-04. No fix-forward commits. Branch deleted.

## Task 2 — checkpoint:decision (blocking-human)
Pre-flight read-only lines (verbatim in docs/external-registrations.md): invariants all zero with `schema_0041_applied=false`; lease rows 0, no watchdog, ticks 200; generator clean; `migrations recorded: 41`; ClickSend A$19.13; production Ready on `d1d5f2b`; main 25 commits ahead.

**Founder reply (11 Oct 2026, verbatim): `apply-now`.**

## Task 3 — push protocol, push, probes, evidence
Order kept: invariants → lease gate → clean generator → `db:migrate` → no-op second run → read-back → `git push origin main` → CI → Vercel Ready → probes → evidence.

- **Deviation (process, 13-07 precedent):** `npm run db:migrate` is refused by the agent permission classifier; the founder ran both invocations by hand and reported `42 entries, exit 0` for each; the orchestrator took the read-back (`migrations recorded: 42`, `schema_0041_applied=true`, generator clean) before pushing.
- Push `d1d5f2b..bc620eb main -> main`; CI `38111363682` **success** on `bc620eb`; GitHub deployment `6990859979` Production; Vercel `dpl_sEkrJ6EzaFdExQbGRda4XKXCgiVd` production **Ready** (2026-10-11 12:22 AWST).
- Probes: the two Twilio doors with a wrong token → 401; `cadence-tick` with a wrong bearer → 401; ticks 200 after the deploy; invariants after: `leads_total=0`, `quotes_source_lead=0`, `text_back_armed_tenants=0`.
- Evidence entry appended; status table row added; diff scanned clean for 64-hex strings and `+61`.

## Rulings recorded
- **Deviation C (14-03, commit 6374788):** `tests/attribution-consume-isolation.test.ts`'s hand-built fake transaction gained `leads.linkedToJob`; no assertion changed. Ratified by the orchestrator as a key-set acknowledgement (Phase 13 precedent).
- The three inert spike rows in production `quotes`/`quote_contacts` (research spike, 10 Oct) were not touched by any step; their removal remains the founder's call.

## State after this plan
No lead, no armed tenant, no lead-sourced quote on production; the deployed code has nothing to act on until the first client. Phase 14 is 5/5 plans; code review, verification and UAT follow.

## Carried forward
- First client: the first job created from a lead (SM8-01 live), the first tradie-booked match, the first DONE — all event-gated with the 12-09 override.
- Phase 15 candidate: `recent_conversion` text-back gate skip (research OQ4).
- The OAuth app's `create_jobs` scope for App ID 000000 (recorded in docs/servicem8-api-notes by 14-01) before any OAuth-path client creates jobs.
