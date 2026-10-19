---
phase: 15-lead-console-reporting-privacy
plan: 08
subsystem: ops scripts / CI gate / env / production migration / deployment
status: complete
tags: [invariants, ci-gate, pepper-env, migration-0042, push-protocol, checkpoint-decision, one-way]
requires:
  - 15-01..15-07 (every Phase 15 commit on main at 3387492)
provides:
  - scripts/lead-privacy-invariants.mjs (+ `npm run lead-privacy:invariants`, pinned read-only in tests/ops-scripts.test.ts)
  - CALLER_PSEUDONYM_PEPPER present on Vercel Production + Preview (by name)
  - migration 0042 applied to the hosted Sydney database (43 journal entries)
  - Phase 15 code deployed to production on 3387492
  - evidence entry + two status rows in docs/external-registrations.md
requirements-completed: []
requirements-advanced: [CON-05, CON-06, RPT-04, RPT-05, COMP-01, COMP-02]
---

# 15-08 SUMMARY — invariants, CI gate, pepper, production migration 0042, deploy

## Task 1 — read-only invariants script + phase CI gate
- `fdec765` feat(15-08): read-only lead privacy invariants script (one SELECT + one catalogue probe; six `name=value` lines; alias + ops-scripts pin, 78/78 locally).
- `3387492` fix(15-08): the client-page pipeline pin reads one search param, the calls cursor, never a status — run `38382249141` failed on a Phase 6 pin that asserted the client page read no `searchParams`; 15-05's keyset cursor is a legitimate param; the pin now checks its real intent (no `status` read, exactly one param read). Originating plan: 15-05.
- Branch `ci/phase-15-final`: `38382249141` on `fdec765` failure → `38383487689` on `3387492` **success** (210/210 files, 6,546 tests, 29 pre-existing skips; migrate "Journal entries recorded: 43"); first real-database run of `pseudonymise` (23) and every other never-run suite. Branch deleted.

## Task 2 — checkpoint:decision (blocking-human)
First pre-flight (13 Oct) HALTED as designed: `CALLER_PSEUDONYM_PEPPER` absent from Vercel (production=0, preview=0). The founder generated the value, set it locally and pushed it to Production + Preview; second pre-flight (15 Oct) read present by name (1/1), invariants all zero with `schema_0042_applied=false`, lease 0, ticks 200, `migrations recorded: 42`, CI success bound to HEAD, main 32 commits ahead. The `.env.example` name-only line is still the founder's to add and commit (15-02 could not read the file).

**Founder reply (15 Oct 2026, verbatim): `apply-now`.**

## Task 3 — push protocol, push, probes, evidence
Order kept: env → invariants → lease gate → clean generator → `db:migrate` → no-op second run → read-back → `git push origin main` → CI → Vercel Ready → probes → evidence.

- **Deviation (process, 13-07/14-05 precedent):** `npm run db:migrate` is refused by the agent permission classifier; the founder ran both invocations by hand and reported `43 entries, exit 0` for each; the orchestrator took the read-back (`migrations recorded: 43`, `schema_0042_applied=true`, generator clean) before pushing.
- Push `6091a8c..3387492 main -> main`; CI `38697822211` **success**; GitHub deployment `7086414650` Production; Vercel `dpl_VutbbUKgCscG1QTgS2Wf2dGwTAqG` production **Ready** (2026-10-15 15:18 AWST).
- Probes: the two Twilio doors with a wrong token → 401; `cadence-tick` with a wrong bearer → 401; `GET /leads` unauthenticated → 307 to login; ticks 200 after the deploy; invariants after unchanged (0 leads, 0 past boundary, 4 suppressions).
- Evidence entry appended; two status rows added (0042; the pepper). Diff scanned clean for 64-hex strings and `+61`.

## Zero-row phone UAT list (for /gsd-verify-work 15)
1. `/leads`: "No open leads." empty state, Leads is the third nav item.
2. Test-tenant client page: the Missed calls section renders (six calls on production from Phase 11/12; outcome chips; no raw number for withheld rows), the state line names the divert number and "text-back not armed".
3. `/reports`: the Missed calls column (— / no divert number vs a count), the client page's month-to-date block with "no samples" for timing, the Export design-partner CSV button downloads a header-only file on iOS Safari.
4. A pre-Phase-15 frozen report renders without the missed-call block.
5. `/privacy`: callers section reads cleanly (Twilio overseas, ClickSend Australian, Anthropic US, 90-day retention sentence), "Last updated 13 October 2026".
6. The next 06:30 digest and 03:30 reconcile run without error (operator email; Vercel log `[pseudonymise]` lines showing zero due).

## Carried forward (milestone close)
- First client: every live clause of v1.2 (12-09 override) — first diverted call, first text, first lead, first job, first DONE, first real report figures, first CSV with data.
- The `.env.example` pepper line (founder commit).
- Pepper rotation needs a plan (re-keys future hashes; already-hashed rows stop matching repeat callers).
- v1.3 candidates: Bedrock Sydney + Vercel OIDC federation; lead dollars attribution; client-reported call totals; booking-form variable; MMS; per-client SMS numbers; client-agreement clauses (D-12 founder task).
