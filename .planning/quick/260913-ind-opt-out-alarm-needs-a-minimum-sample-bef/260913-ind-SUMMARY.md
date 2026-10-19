---
phase: quick
plan: "260913-ind"
quick_id: 260913-ind
subsystem: reporting
tags: [digest, opt-out, alarm, thresholds, constants, ops-scripts, resend, vitest]

# Dependency graph
requires:
  - phase: 07-instrumentation-and-reporting
    provides: "`isOptOutAlarming` as the ONE alarm predicate, `computeTenantMetrics`'s `optOut.alarming`, `buildOptOutSection`, and the digest's `sections` seam"
  - phase: 06-alerts-and-digest
    provides: "the 'empty is nothing to say' skip rule in `runStalledDigest` (`digestSkippedEmpty`) that this fix relies on to stop the send"
  - phase: 10-first-client-go-live
    provides: "the four read-only ops probes and `tests/ops-scripts.test.ts`, the mould the fifth one is pinned into"
provides:
  - "`OPT_OUT_ALARM_MIN_CONTACTS = 10` in `src/core/audit/constants.ts` — the denominator floor under the D-16 alarm"
  - "`isOptOutAlarming(optOut: Rate)`: the predicate now takes the figures, so no caller CAN ask the old rate-only question"
  - "`npm run resend:recent-sends -- <limit>`: a read-only list probe that names a sender, a recipient DOMAIN, a last_event and a bounded subject"
  - "docs/commercial-assumptions.md §7 — the constant, the measurement that produced it, and what it deliberately cannot do"
affects: [daily-digest, reports-overview-badge, reports-detail-badge, ops-runbook]

actuals:
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A threshold predicate takes the WHOLE rate, not the percentage: passing `{numerator, denominator, rateBp}` makes the sample floor unskippable at every call site, because the old question no longer typechecks"
    - "A sample floor is recorded beside the rate it guards, in the same no-imports constants module, and pinned by the same deliberate export-count edit — 8 to 9 — that forces the next addition to declare itself"
    - "An ops probe bounds the one variable-length field it prints (address-redact + truncate) rather than trusting today's upstream templates to stay safe"

key-files:
  created:
    - "scripts/resend-recent-sends.mjs"
  modified:
    - "src/core/audit/constants.ts"
    - "src/core/reporting/metrics.ts"
    - "src/core/reporting/opt-out-section.ts"
    - "tests/audit-aggregate.test.ts"
    - "tests/opt-out-section.test.ts"
    - "tests/reporting-metrics.test.ts"
    - "tests/report-metrics.test.ts"
    - "tests/ops-scripts.test.ts"
    - "docs/commercial-assumptions.md"
    - "package.json"

key-decisions:
  - "Changed the SIGNATURE rather than adding a guard at each call site: `isOptOutAlarming` takes `Rate` now, so the compiler — not a comment — is what stops a future surface from asking the rate-only question. Both existing callers were updated in the same commit and the two /reports badges inherit it through `computeTenantMetrics`"
  - "Ten, deliberately the same number and the same argument as `BASELINE_MIN_QUOTES`: below ten a proportion is a coin flip, and using a second, differently-reasoned floor would be a number nobody could defend later"
  - "The floor can only SILENCE, never raise — checked first and structurally, before any threshold comparison. The accepted cost is a real problem noticed a week later on a near-zero-traffic client; the avoided cost is a daily false alarm on the channel every other alert rides"
  - "Did NOT touch the digest schedule, the route, or the empty-send rule (CON-04). The tick still runs at 22:30 UTC and still sends whenever there is anything to say; a one-contact tenant simply no longer manufactures something to say"
  - "Kept the rate VISIBLE while silencing the alarm: `/reports` still renders '100.0% (1 of 1 contacts)' for the test tenant — the measurement was never wrong, only the conclusion drawn from it"
  - "Bounded the probe's subject (address-redacted, capped at 80 chars) even though every subject this Resend account sends today is a fixed phrase plus a CLIENT business name — that is a fact about today's templates, not a property of the script, and its output is pasted into an evidence log forever"

patterns-established:
  - "When a predicate's inputs are already sitting in one object, pass the object: the enforcement of a new precondition should be a type error at every call site, not a line of prose asking callers to remember"
  - "Record an operational threshold in docs/commercial-assumptions.md with the MEASUREMENT that produced it — the digest line, verbatim, with its date — so the next reader can tell a reasoned floor from a round number"

requirements-completed: []

coverage:
  - id: D1
    description: "The opt-out alarm fires only when a tenant has at least OPT_OUT_ALARM_MIN_CONTACTS contacts in the window; 1 of 1 produces no digest line and no badge; 1 of 10 does"
    verification:
      - kind: unit
        ref: "tests/opt-out-section.test.ts#writes NOTHING for a client with one contact who opted out (quick 260913-ind)"
        status: pass
      - kind: unit
        ref: "tests/opt-out-section.test.ts#stays silent one contact short of the floor, however unanimous (9 of 9)"
        status: pass
      - kind: unit
        ref: "tests/opt-out-section.test.ts#fires at exactly the floor, and the rate threshold is unchanged above it (1 of 10, 1 of 20)"
        status: pass
      - kind: unit
        ref: "tests/reporting-metrics.test.ts#needs a SAMPLE before it fires — the denominator floor (quick 260913-ind)"
        status: pass
      - kind: other
        ref: "grep -rn 'isOptOutAlarming(' src | grep -v metrics.ts -> one call site, passing row.optOut; both /reports badges read optOut.alarming, set by the same predicate in computeTenantMetrics"
        status: pass
    human_judgment: false
  - id: D2
    description: "With the test tenant's 1-of-1 opt-out, the daily digest has no sections and no stalled drafts, so it is skipped (digestSkippedEmpty) — the operator stops receiving 'Daily digest: 0 drafts still waiting'"
    verification:
      - kind: unit
        ref: "buildOptOutSection returns null for 1-of-1 (above) -> defaultSections pushes nothing (stalled-digest.ts:184) -> sectionLines 0 + touchesStalled 0 -> digestSkippedEmpty (stalled-digest.ts:216). Each link pinned; the composition is reasoned, not executed"
        status: pass
      - kind: integration
        ref: "OWED, event-gated: after 22:31 UTC 2026-09-13, `npm run resend:recent-sends -- 5` shows NO 'Daily digest' row for 2026-09-13"
        status: pending
    human_judgment: true
    rationale: "The only honest proof is the absence of an email after a scheduled tick that has not happened yet. Every link in the chain is unit-pinned; what cannot be asserted locally is that the live 22:30 UTC run takes the skip branch against real data."
  - id: D3
    description: "The new constant lives in src/core/audit/constants.ts beside OPT_OUT_ALARM_RATE and is recorded in docs/commercial-assumptions.md"
    verification:
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#exports exactly the nine named constants, in EVERY export syntax (pin raised 8 -> 9 deliberately)"
        status: pass
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#holds the deliberately HIGH default baseline and the Phase 7 thresholds — expect(OPT_OUT_ALARM_MIN_CONTACTS).toBe(10)"
        status: pass
      - kind: unit
        ref: "tests/audit-aggregate.test.ts#is a module with NO imports OF ANY SHAPE — still passes; the constants module stays import-free"
        status: pass
      - kind: other
        ref: "grep -c OPT_OUT_ALARM_MIN_CONTACTS docs/commercial-assumptions.md -> 2 (§7 heading and the change instruction)"
        status: pass
    human_judgment: false
  - id: D4
    description: "scripts/resend-recent-sends.mjs is a read-only probe printing created_at, from, recipient DOMAIN, last_event and subject — never a recipient address or the key"
    verification:
      - kind: unit
        ref: "tests/ops-scripts.test.ts#makes exactly one request, and it is a GET"
        status: pass
      - kind: unit
        ref: "tests/ops-scripts.test.ts#loads the key through the shared loader and never prints it"
        status: pass
      - kind: unit
        ref: "tests/ops-scripts.test.ts#prints the recipient DOMAIN and nothing that could be an address"
        status: pass
      - kind: unit
        ref: "tests/ops-scripts.test.ts#bounds the subject rather than trusting it / #is reachable by the alias the runbook and the SUMMARY name"
        status: pass
      - kind: other
        ref: "grep -c '\"resend:recent-sends\"' package.json -> 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "Deployed: typecheck, lint and build clean; pushed; production deployment READY"
    verification:
      - kind: build
        ref: "npm run typecheck; npm run lint; npx next build — all clean"
        status: pass
      - kind: integration
        ref: "pushed 7af96de..a514259 to main; production deployment backdesk-8aj8tm1hy (dpl_2yEi4dZHqxp4Z3wHc81NEK7pR4CM) Ready in 33s"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-13
status: complete
---

# Quick task 260913-ind: the opt-out alarm needs a minimum sample before it fires

**The alarm that filled the daily digest every morning now needs a denominator: one opted-out test handset is still measured and still shown as 100.0% (1 of 1 contacts), but it no longer alarms, no longer badges, and no longer manufactures a digest — and the read-only probe that traced the fault is committed, so the absence of tonight's digest is checkable rather than assumed.**

## Performance

- **Duration:** 20 min
- **Tasks:** 2 of 2
- **Commits:** 2 (`85890ef`, `a514259`)

## Accomplishments

- **`OPT_OUT_ALARM_MIN_CONTACTS = 10`**, in the no-imports constants module beside `OPT_OUT_ALARM_RATE`, with the measurement that produced it written into the JSDoc: the live test tenant has one contact, the operator's own handset, opted out during the Phase 4 STOP test, so `optOutRate` read a true and meaningless 100% for thirty rolling days. Ten is deliberately the same floor and the same Wilson-interval argument as `BASELINE_MIN_QUOTES` — a second, differently-reasoned number would be one nobody could defend later.
- **`isOptOutAlarming` takes the whole `Rate` now**, not a bare `rateBp`. The floor is checked first and structurally, before any threshold comparison, and the signature change is the enforcement: a future surface cannot ask the old rate-only question, because it no longer typechecks. Both call sites moved in the same commit — `buildOptOutSection` directly, and the `/reports` overview and detail badges through `computeTenantMetrics`'s `optOut.alarming`.
- **The rate stays visible.** Nothing was hidden: the detail page still prints "100.0%" and "1 of 1 contacts messaged". The arithmetic was never wrong — only the conclusion drawn from it was — and suppressing the figure as well would have traded one wrong answer for another.
- **Four boundary cases pinned** in `tests/opt-out-section.test.ts`, written as the production fixture rather than as abstractions: 1 of 1 → no line (named "Perth Sparks Electrical (Test)", the actual tenant), 9 of 9 → no line, 1 of 10 → a line, 1 of 20 (exactly 5%) → a line. The floor can only ever silence; above it nothing changed.
- **The export-count pin raised 8 → 9 deliberately**, with a comment saying the count is a tripwire and not a budget, plus a value pin and `docs/commercial-assumptions.md §7` carrying the digest line verbatim, the date, the asymmetry, and the explicit note that the digest itself was not touched.
- **`npm run resend:recent-sends -- <limit>`**, the fifth read-only ops probe: one `GET /emails`, never the message behind an id. The recipient is reduced to a domain by `domainOf` before it can reach a template; the subject is address-redacted and capped at 80 characters; the key reaches exactly one place, the `Authorization` header; the fetch is wrapped so a rejection prints `e.name` and not a URL belonging to our account. Seven gates in `tests/ops-scripts.test.ts`, including the npm alias itself — a proof step that names a missing alias is a proof step that silently never runs.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `tests/reporting-metrics.test.ts` called the predicate with a bare `rateBp`**

- **Found during:** Task 1
- **Issue:** The suite that pins `isOptOutAlarming` is not in the plan's file list, but it calls the function five times with a number. The signature change makes it a type error — the suite cannot compile, let alone pass.
- **Fix:** Added an `atRate(rateBp, denominator = OPT_OUT_ALARM_MIN_CONTACTS)` helper so the threshold assertions stay about the threshold, and a new case for the floor itself (1-of-1 silent, 1-of-10 alarming, 9-of-9 silent, 1-of-20 alarming).
- **Files modified:** `tests/reporting-metrics.test.ts`
- **Commit:** `85890ef`

**2. [Rule 1 - Bug] The remote fixture asserted the exact behaviour being removed**

- **Found during:** Task 1
- **Issue:** `tests/report-metrics.test.ts` (the hosted-DB suite) seeds one messaged contact and one suppression — the production shape — and asserted `metrics.optOut.alarming === true`. That is now false by design, so the assertion would fail the next time anyone runs `test:remote`, on the one suite that cannot be run casually.
- **Fix:** Inverted it and renamed the case to "measures A at 100% opt-out and REFUSES to alarm on one contact": the rate assertions stay (it is still 10,000bp and still above `OPT_OUT_ALARM_BP`), and the alarm assertion now proves the floor with `expect(a.contactsTouched).toBeLessThan(OPT_OUT_ALARM_MIN_CONTACTS)` beside it.
- **Files modified:** `tests/report-metrics.test.ts`
- **Commit:** `85890ef`
- **Note:** the suite was NOT executed — it runs against the hosted Sydney project, which is production. `tsc --noEmit` covers its compilation; the assertion change is reasoned from the fixture it reads.

**3. [Rule 2 - Missing] The probe as handed over could leak a URL, a subject and a negative limit**

- **Found during:** Task 2
- **Issue:** Reviewing the orchestrator's script against the four existing probes found three gaps against their established rules: the `fetch` was unwrapped (a rejection stringifies to a message carrying the request URL — the CR-01 lesson `clicksend-balance.mjs` was built around), the subject was printed raw and unbounded, and `Math.min(Number('-5') || 20, 100)` passes `-5` straight to the provider.
- **Fix:** Wrapped the fetch and printed `e.name` only; added `safeSubject()` (address-shaped substrings → `[redacted]`, then `.slice(0, 80)`); clamped the limit on both sides; made the verb explicit (`method: 'GET'`) so the no-write rule is greppable the way it is for `clicksend-balance.mjs`.
- **Files modified:** `scripts/resend-recent-sends.mjs`
- **Commit:** `a514259`

No Rule 4 questions arose. No architectural change: one constant, one signature, two call sites.

## Verification

Task 1, local:

- `npx vitest run tests/opt-out-section.test.ts tests/audit-aggregate.test.ts tests/reporting-metrics.test.ts` — **74 passed**
- `npx vitest run` (bare, no `ALLOW_REMOTE_TESTS`) — **3111 passed**; the 43 file-level failures are the integration suites refusing to run without a local Supabase, which is their pre-existing behaviour on a bare run and out of this task's scope
- `grep -c OPT_OUT_ALARM_MIN_CONTACTS src/core/audit/constants.ts src/core/reporting/metrics.ts` → 2 and 3
- `grep -rn 'isOptOutAlarming(' src | grep -v metrics.ts` → one call site, `isOptOutAlarming(row.optOut)`; no caller passes a rate
- `grep -c OPT_OUT_ALARM_MIN_CONTACTS docs/commercial-assumptions.md` → 2

Task 2:

- `npx vitest run tests/ops-scripts.test.ts` — **37 passed** (30 before, 7 new)
- `npm run typecheck`, `npm run lint`, `npx next build` — all clean
- pushed `7af96de..a514259` to `main`; production deployment **`backdesk-8aj8tm1hy`** (`dpl_2yEi4dZHqxp4Z3wHc81NEK7pR4CM`) **Ready**, 33s
- the probe itself was not RUN from here — it reads the live Resend account, and the check it exists for is the one below

## Owed: one event-gated check

**After 22:31 UTC on 2026-09-13** (i.e. after tonight's digest tick), run:

```
npm run resend:recent-sends -- 5
```

**Expected: no row whose subject begins "Daily digest" for 2026-09-13.** That absence is the proof — the fix removes the digest's only content for a one-contact tenant, and `runStalledDigest` then takes the `digestSkippedEmpty` branch and sends nothing. A "Daily digest: 0 drafts still waiting" row appearing anyway means either the deployment did not take or a second section produced a line, and the probe's output names which.

This cannot be verified earlier: the tick is scheduled, and the evidence is an email that does not arrive.

## Self-Check: PASSED

- `scripts/resend-recent-sends.mjs` — FOUND
- `.planning/quick/260913-ind-opt-out-alarm-needs-a-minimum-sample-bef/260913-ind-SUMMARY.md` — FOUND
- commit `85890ef` — FOUND
- commit `a514259` — FOUND (pushed, `origin/main`)
