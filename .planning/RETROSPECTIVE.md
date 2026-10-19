# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP, the end-to-end quote-recovery loop

**Shipped:** 2026-09-05
**Phases:** 7 | **Plans:** 51 (+11 quick tasks) | **Sessions:** ~14 (one or two per phase, plus gap-closure and close-out sessions)

### What Was Built
- A tenant-safe Sydney Postgres foundation whose cross-tenant leak test blocks CI, under an operator-only Next.js console usable from a phone.
- A ServiceM8 mirror with a transactional outbox, a prospect-facing Quote Leakage Audit, and the cadence state machine that is the product: materialized 5-touch schedules, an idempotent send ledger, JIT revalidation, a deterministic stop matrix.
- A compliance-gated messaging gateway on a live dedicated AU number (STOP before any LLM, receipts, one-click email unsubscribe), Claude drafting behind a verbatim price/date validator, closed-enum reply classification, and the onboarding gate that keeps cadences paused until templates are approved and the SM8 automation-off attestation exists.
- The review console (queue, pipeline, stall digest, hot-lead escalation) and evidence-chained attribution feeding frozen, versioned, printable monthly reports plus rolling per-client instrumentation.

### What Worked
- **Tracer plans first.** Every phase opened with a thin end-to-end slice proven on the hosted database before the wide plans; regressions surfaced as "the tracer moved", not as archaeology.
- **Pure state machines with hand-decided cells** (114 in Phase 3) and framework-free `src/core` modules: the exhaustive suites (2,437 assertions) are cheap, and the review rounds found real defects (a 100× multiple, a UTF-16 code-point cap, a wedge with no alert) rather than style.
- **Live proof over mocks where it mattered:** the real SMS conversation on `+61491579212`, the iPhone/desktop print UATs with PDFs in hand, the digest observed both silent and delivered. Each live check caught something a unit test could not (WebKit pagination, an inclusive-zero jitter, a print deferral).
- **Gap-closure loop:** UAT issue → parallel debug agents with measured root causes → gap plan tagged with gap ids → scoped review → re-verify. Three rounds in Phase 7 closed six gaps without a single regression.
- **Read-only production probes** (pg_net response table, cron run details) settled "is it broken?" questions in minutes; twice the answer was "design behaviour", and the memory file now says so.

### What Was Inefficient
- **Contract text that cited rules that never existed** (a "flex-wrap nav" in Phase 6, a "client-list wrapper" in Phase 7) passed two plan checks and two verifications. Prose coverage rows need a selector or a test name, not a claim.
- **Reviewer knowledge drift:** one review blocker asserted WebKit lacks `beforeprint`; two minutes with caniuse and the WebKit changeset refuted it. Blockers grounded in browser/vendor facts need a source before they change a design.
- **Miscounted acceptance greps** appeared in four consecutive plans; the checker caught each, but the pattern cost a round trip every time.
- **Ledger and validation bookkeeping drifted from reality:** 11 Broken Windows entries were fixed phases earlier but still read open at close; all seven VALIDATION.md files never left `draft`. Close-out had to reconcile 28 ledger rows and six debug sessions by hand.
- **Fixture data in production** (the seeded August month) was the right call for real prints but needed a manifest and a manual teardown; the metric denominator it removed then tripped the opt-out alarm the next morning. Correct, but surprising.

### Patterns Established
- Hosted Supabase is production: remote suites only through the lease-pausing `test:remote` script or CI's local stack; probes are read-only with URLs redacted.
- Frozen documents are the record: attribution values snapshot at write, reports are versioned rows the page renders from and never recomputes, and "delete" was rejected in favour of idempotent regeneration.
- Compliance choke points are single functions with byte-asserted vocabularies: STOP suppression, the digest body, the tick response, the evidence chain (strictObject, forbidden-key walk).
- Every gap plan carries `gap_ids`; every ruling on an engine limit lands in WINDOWS.md with a reason; every override is recorded in four places.
- Headless-Chrome/WKWebView harnesses under `07-06-harness/` measure layout facts (390px document width, print pagination, nav row height) and are re-run by verifiers, not trusted from summaries.

### Key Lessons
1. Put the measurement in the contract: a UI-SPEC coverage row must name the CSS rule or test that guarantees it, and a harness should be able to fail on the previous commit (negative control) before it is trusted to pass.
2. Ground vendor-behaviour claims in a primary source before acting on them, in both directions — the reviewer's blocker and the plan's "synchronous print" comment were both wrong about WebKit.
3. Close ledgers as you go: mark a Broken Windows entry fixed in the same commit that fixes it, and reconcile VALIDATION.md status in the phase that seeds it, or close-out becomes an audit of the audit.
4. Design silence deliberately and document it once: "no email means nothing is waiting" is right, but it must be written where the operator will look before they report it as a defect.
5. Keep design changes out of gap plans: the sideways-scrolling nav and idempotent Generate were queued as quick tasks after the phase closed, which kept the gap-closure loop honest and the UAT record clean.

### Cost Observations
- Model mix (agents): executors and fixers on opus; planners, checkers and verifiers on fable; integration checker on sonnet; orchestration on fable.
- Sessions: ~14 across 12 calendar days; the longest single session ran Phase 7 from discussion through milestone close.
- Notable: the three review rounds on Phase 7 (15 + 9 + 9 findings, all resolved) cost far less than the one production incident any of the criticals would have caused; the fixture-print UATs were the cheapest high-value checks of the milestone.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Review rounds | UAT issues found → closed | Notes |
|-----------|--------|-------|---------------|---------------------------|-------|
| v1.0 | 7 | 51 (+11 quick) | 3 in Phase 7 (33 findings, 32 fixed, 1 declined) | 6 → 6 | first milestone; ledger and validation bookkeeping reconciled at close |

### Recurring Themes
- Contracts that cite unmeasured rules; miscounted acceptance greps; ledger drift. Watch for these in v1.1 plan checks.
