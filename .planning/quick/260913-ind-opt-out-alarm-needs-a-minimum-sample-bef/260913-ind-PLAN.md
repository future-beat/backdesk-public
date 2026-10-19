---
phase: quick
plan: "260913-ind"
quick_id: 260913-ind
type: quick
wave: "1"
depends_on: []
files_modified:
  - src/core/audit/constants.ts
  - src/core/reporting/metrics.ts
  - src/core/reporting/opt-out-section.ts
  - tests/opt-out-section.test.ts
  - tests/audit-aggregate.test.ts
  - docs/commercial-assumptions.md
  - scripts/resend-recent-sends.mjs
  - package.json
  - tests/ops-scripts.test.ts
autonomous: "true"
must_haves:
  truths:
    - "The opt-out alarm (digest section and the /reports badge) fires only when a tenant has at least OPT_OUT_ALARM_MIN_CONTACTS contacts in the window; 1 of 1 contacts opted out produces no alarm line and no badge; 1 of 10 does (10% > 5%)"
    - "With the test tenant's 1-of-1 opt-out, the daily digest has no sections and no stalled drafts, so it is skipped (digestSkippedEmpty) — the operator stops receiving 'Daily digest: 0 drafts still waiting'"
    - "The new constant lives in src/core/audit/constants.ts beside OPT_OUT_ALARM_RATE and is recorded in docs/commercial-assumptions.md"
    - "scripts/resend-recent-sends.mjs is a read-only probe that prints created_at, from, recipient DOMAIN, last_event and subject — never a recipient address or the key"
  prohibitions:
    - requirement_id: CON-04
      category: product
      statement: "MUST NOT disable or unschedule the daily digest; the fix is a minimum sample on the alarm, not silencing the channel"
    - requirement_id: ONB-05
      category: privacy
      statement: "MUST NOT print recipient addresses or any key in the new probe"
---

# Quick task: the opt-out alarm needs a minimum sample before it fires

## Cause (measured 2026-09-13 via Resend's send history)
Every day at 22:30 UTC the digest "Daily digest: 0 drafts still waiting" is delivered. Its only content is the opt-out section: "Perth Sparks Electrical (Test): 100.0% (1 of 1 contacts) in the last 30 days." The test tenant has one contact — the operator's own handset, opted out during the Phase 4 STOP test. `isOptOutAlarming(rateBp)` has no denominator floor, so one contact is a 100% alarm for a rolling 30 days. The digest's "send nothing when empty" rule is working; the alarm is the noise source.

## Tasks

<task type="auto" id="1">
<name>Minimum contacts before the opt-out alarm fires</name>
<files>src/core/audit/constants.ts, src/core/reporting/metrics.ts, src/core/reporting/opt-out-section.ts, tests/opt-out-section.test.ts, tests/audit-aggregate.test.ts, docs/commercial-assumptions.md</files>
<read_first>
- src/core/audit/constants.ts (OPT_OUT_ALARM_RATE; the header pointer to docs/commercial-assumptions.md; the structural test pins the export count and no imports)
- src/core/reporting/metrics.ts (`isOptOutAlarming`, `OPT_OUT_ALARM_BP`, `TenantMetrics.optOut.{numerator,denominator,rateBp}`) and every caller of `isOptOutAlarming` (grep: opt-out-section.ts, the /reports pages/badges, digest line in reports)
- tests/opt-out-section.test.ts, tests/audit-aggregate.test.ts (export-count pin), tests for metrics/reports badges that assert alarm behaviour
- docs/commercial-assumptions.md (record shape)
</read_first>
<action>
Add `export const OPT_OUT_ALARM_MIN_CONTACTS = 10;` to constants.ts with a short JSDoc (an alarm on fewer than ten contacts is noise: one opted-out contact reads as 100%). Change `isOptOutAlarming` to take the opt-out figures (numerator/denominator/rateBp or the whole `optOut` object) and return false when `denominator < OPT_OUT_ALARM_MIN_CONTACTS`; update every caller so the digest section and the /reports badge use the same rule (grep for `isOptOutAlarming(` and fix each call site — no caller may keep the old rate-only check). Update the export-count pin in tests/audit-aggregate.test.ts deliberately (state the new count). Tests: opt-out-section — 1 of 1 → null section; 1 of 10 → one line; 9 of 9 → null; 1 of 20 (5%) → line (threshold unchanged at ≥ 5%). Record the new constant in docs/commercial-assumptions.md as a row/section with rationale and the date.
</action>
<acceptance_criteria>
- `grep -c "OPT_OUT_ALARM_MIN_CONTACTS" src/core/audit/constants.ts src/core/reporting/metrics.ts` → both ≥ 1
- `grep -rn "isOptOutAlarming(" src | grep -v "metrics.ts"` — every call passes the figures, none passes only a rate
- `npx vitest run tests/opt-out-section.test.ts tests/audit-aggregate.test.ts tests/reporting-metrics.test.ts` passes (adjust the third name to the real metrics suite)
- `grep -c "OPT_OUT_ALARM_MIN_CONTACTS" docs/commercial-assumptions.md` ≥ 1
</acceptance_criteria>
<verify><automated>npx vitest run tests/opt-out-section.test.ts tests/audit-aggregate.test.ts</automated></verify>
<done>The alarm has a floor; the test tenant's 1-of-1 no longer fills the digest.</done>
</task>

<task type="auto" id="2">
<name>Commit the read-only Resend probe, deploy, and record the owed check</name>
<files>scripts/resend-recent-sends.mjs, package.json, tests/ops-scripts.test.ts</files>
<read_first>
- scripts/resend-recent-sends.mjs (written by the orchestrator 2026-09-13; read-only; prints domains only), scripts/resend-email-status.mjs (mould), tests/ops-scripts.test.ts (how the other probes are pinned: explicit no-write, no-address, no-key assertions)
</read_first>
<action>
Add the npm alias `resend:recent-sends`; pin the probe in tests/ops-scripts.test.ts (uses `loadEnv`/`requireEnv`, contains no `console.log` of `.to`/address values — the domain split is the only recipient output, never logs `RESEND_API_KEY`, makes GET requests only). Run `npm run typecheck && npm run lint && npx next build`; push `main`; wait for the production deployment READY (record the id). The proof that the digest stops is event-gated on the next 22:30 UTC tick: record in the SUMMARY that the orchestrator/operator confirms via `npm run resend:recent-sends -- 5` after 22:31 UTC on 2026-09-13 that no "Daily digest" row was sent for that day.
</action>
<acceptance_criteria>
- `grep -c '"resend:recent-sends"' package.json` → 1
- `npx vitest run tests/ops-scripts.test.ts` passes
- pushed; READY recorded
</acceptance_criteria>
<verify><automated>npx vitest run tests/ops-scripts.test.ts</automated></verify>
<done>Probe committed; deployed; the next tick is the proof.</done>
</task>

</tasks>
