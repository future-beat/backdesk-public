---
phase: 06-review-console-escalation
plan: 04
subsystem: cadence
status: complete
tags: [onboarding, activation-gate, attestation, append-only, checklist, staleness, probe]

requires:
  - "tenant_attestations (06-01, migration 0032) — append-only, note NOT NULL, kind CHECK"
  - "hasApprovedTemplateSet + approveTemplateVersion (05-03) — the ONB-03 half"
  - "buildDailyDigest's DigestSection seam (06-02)"
  - "resolveSmsFrom / resolveEmailIdentity — the per-tenant identity authority (04-08 CR-01)"
  - "applyResumeRewindow's outside-the-transaction placement rule (resumeClient, 03-05)"
provides:
  - "src/core/drafting/onboarding-gate.ts — resumeIfOnboardingComplete, finishResume, hasSm8AutomationAttestation, readOnboardingConditions, onboardingComplete, attestSm8AutomationOff, SM8_AUTOMATION_ATTESTATION_KIND"
  - "for-tenant `attestations` namespace — append + latest, and nothing else"
  - "src/core/onboarding/checklist.ts — ATTESTATION_STALE_DAYS, isAttestationStale, attestationAgeDays, readOnboardingChecklist, CHECKLIST_ITEM_KEYS"
  - "clients/[id]/checklist-card.tsx — the Ready-to-send card + attest disclosure"
  - "attestSm8AutomationOffAction + attestRecordedMessage + ATTEST_NOTE_* copy"
  - "forAllTenants_latestAttestations (crossing twelve) + buildStaleAttestationSection"
  - "ControlState.fixes — the console's 'where to go to make this work' channel"
  - "resumeCadenceGatedState — the per-condition refusal mapping"
  - "scripts/sm8-spike.mjs probe subcommand + the D-13 record in docs/servicem8-api-notes.md"
affects:
  - "consume-events' born-paused decision now asks the COMPOSED predicate — every cadence created for an unattested tenant is born paused(onboarding)"
  - "resumeCadence's onboarding_gated arm carries conditions; the quote page's refusal copy is now per-condition with a link"
  - "runStalledDigest's empty test widened: 'nothing to say', not 'nothing stalled'"
  - "tests/helpers/seed.ts teardown covers tenant_attestations (evidence family, no FK)"

tech-stack:
  added: []
  patterns:
    - "The conjunction of an activation rule is written ONCE and reached by every call site (CR-01, asserted at source)"
    - "The absent repository method IS the append-only rule (suppression's shape, third application)"
    - "The vacuous-truth guard written out rather than folded in, so a reader sees the empty case was decided"
    - "A refusal carries CONDITIONS; the console owns the sentence and the link"
    - "A nag is a read path: no write anywhere on it, asserted behaviourally AND structurally"
    - "Measure-and-record probes ship no production code against the measurement"

key-files:
  created:
    - src/core/onboarding/checklist.ts
    - src/app/(console)/clients/[id]/checklist-card.tsx
    - tests/onboarding-checklist-gate.test.ts
  modified:
    - src/core/drafting/onboarding-gate.ts
    - src/core/cadence/consume-events.ts
    - src/core/cadence/controls.ts
    - src/core/aging/stalled-digest.ts
    - src/db/repository/for-tenant.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/index.ts
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/components/action-state.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx
    - scripts/sm8-spike.mjs
    - docs/servicem8-api-notes.md
    - tests/helpers/seed.ts
    - tests/lint-ban.test.ts
    - tests/pause-upgrade.test.ts

decisions:
  - "`resumeIfOnboardingComplete` + `finishResume` are the extracted in-transaction and outside-transaction halves, and BOTH writers use both — the placement rule and the RETURNING-ids scope now exist once instead of being copied into the second writer"
  - "`setComplete` was deliberately NOT widened to mean 'this client can send'. It still means the TEMPLATE set is finished, so the drafting page's partial-progress sentence keeps telling the truth; the composed answer travels beside it as `conditions`"
  - "`attestSm8AutomationOff` has NO failure arm: an append-only INSERT with a server-set timestamp has nothing to lose a race against, and an attestation recorded while templates are unapproved is a SUCCESS that resumed nothing"
  - "The refusal carries CONDITIONS, not a sentence — `src/core` returns outcomes and the console owns the copy (06-01's rule), so the per-condition wording and its link live in one mapping the quote page and any later surface share"
  - "`ControlState.fixes` is an optional ARRAY, so both-missing renders both sentences and both links in checklist order rather than picking one and hiding the other"
  - "A stale attestation SATISFIES the checklist row and keeps the gate open. Reading staleness as unmet would re-gate a healthy client on a calendar, which is the pause D-15 forbids"
  - "`isAttestationStale(null)` is FALSE — no attestation is UNMET, not stale; a re-attest nag beside a client who has never attested is an instruction nobody can act on"
  - "Staleness is derived in TypeScript, never in SQL: a `WHERE attested_at < now() - interval '30 days'` would be a second reading of ATTESTATION_STALE_DAYS, one in Postgres and one in the badge"
  - "The digest's empty test widened from `touchesStalled === 0` to 'nothing to say at all' — keying it on stalls alone means a four-month-old attestation is never mentioned on a morning the queue is clear, which is exactly the morning there is time to check"
  - "`forAllTenants_latestAttestations` INNER joins tenants and drops orphans, unlike `tallyByTenant`'s `Another client` fallback: 'go re-verify a client who no longer exists' is an instruction nobody can act on"

metrics:
  duration: ~65 min
  completed: 2026-09-01
  tasks: 3
  files: 22
  commits: 3

actuals:
  tokens: 38000
  tasks: 3
  commits: 3
---

# Phase 6 Plan 04: The Two-Condition Activation Gate Summary

ONB-04 holds: no cadence can be **created active** or **resumed** until this client's
templates are approved AND an operator has recorded, in their own words, that ServiceM8's
native Quote Follow Up is off. The evidence is append-only and never overwritten. Drift is
re-checked every 30 days and never pauses anybody. And the one external unknown of the
phase — can we see ServiceM8's own outbound comms at all — is now a measured fact on file.

## What Was Built

**One predicate, three call sites (D-14).** `resumeIfOnboardingComplete` is the only place
the two-condition conjunction is written, and it is reached by `approveTemplateVersion`,
by the new `attestSm8AutomationOff`, and — the part that matters — by `consume-events`'
born-paused decision. A source assertion pins it: the expression ANDing
`templatesApproved` with `sm8AutomationAttested` appears in exactly one file in `src`.

Two readings of one activation rule is the CR-01 defect class, and an activation rule is
the worst place in this system to have it. The two copies agree until one is widened, and
the one that was not is the one that lets a client send.

**The extraction moved BOTH halves, not one.** `approveTemplateVersion` used to carry the
in-transaction re-ask, the reason-scoped resume, AND the outside-the-transaction re-window
scoped to the RETURNING ids — with a long comment explaining why the last of those cannot
move inside. Writing a second writer meant either copying that reasoning or extracting it,
so `finishResume` is now the outside half and both writers call it. The comment lives once,
where the rule does.

**`attestations` — append and latest, and nothing else.** The namespace exposes no update
and no delete, and a test asserts the key list is exactly `['append', 'latest']`. The
append-only rule is the absent method, which is the shape `suppression` already has and for
the same reason: a surface that cannot express the write is a stronger guarantee than a
convention asking callers not to make it. `attested_at` is not a parameter — it is the
column's `defaultNow()`, because an attestation whose moment a caller could choose is a date
somebody could type.

**The vacuous-truth guard, written out again.** `hasSm8AutomationAttestation` returns FALSE
for a tenant with zero rows, with an early return that exists so a reader can see the empty
case was decided rather than inherited. That is T-5-13 one condition over, and it has a
named test whose whole job is to fail the day somebody rewrites it as
`rows.every(...)`.

**The composed gate reaches CREATION.** This is the plan's centre of gravity. A client
onboarded before Phase 6 has approved templates and no attestation — they are the exact
client ONB-04 was added for, and they are also the one a half-composed gate silently
exempts: their cadences would be born ACTIVE, would never need resuming, and would never
reach the refusal that names the missing attestation. The suite drives the real emit path
(`markChaseEligible` → outbox → `consumeQuoteEvents`) and proves the cadence is born
`paused(onboarding)` with its schedule fully materialized.

**The refusal names what is actually missing.** `resumeCadence`'s `onboarding_gated` arm now
carries `conditions`, read only on the refusal path so an ordinary resume pays nothing.
`ControlState` gained an optional `fixes` array, and the quote page renders each fix link
inside the same `role="status"` region as the sentence — so a screen-reader user hears the
refusal and the way to clear it as one message. Both conditions missing renders both
sentences and both links, in checklist order. There is no resume-anyway anywhere.

**The "Ready to send?" card.** Six fixed rows, computed by `src/core/onboarding/checklist.ts`
from the SAME readers the gate asks. Two of them are easy to get subtly wrong and both are
pinned by source assertion: `templatesApproved` must import the gate's own
`hasApprovedTemplateSet` and must contain no `message_templates` query (T-5-13);
`messagingArmed` must ask the per-tenant identity resolvers and must not name
`anyChannelEnabled` (04-08 CR-01). Where a row has a FACT worth showing it shows the fact
rather than "done" — the contact window with its zone, the identity a client is armed to
send from. A window an operator believes is 8–5 and is really 8–5 in the wrong zone reads as
a green tick forever.

**The attest form.** Required textarea, no placeholder, no default value, `.trim().min(1)`
at the action — the third layer of a rule the column (NOT NULL, no default) and the core
signature (required parameter) already enforce. A textarea holding one space is what a
hurried operator submits when asked to type something they have not done, and that is the
exact submission this column exists to refuse.

**The staleness nag, and what it is forbidden to do.** `ATTESTATION_STALE_DAYS = 30`,
inclusive at the boundary, derived by one pure function that both the badge and the digest
line call. `forAllTenants_latestAttestations` is a SELECT and stays one. The prohibition is
asserted two ways: behaviourally, by running the whole digest against a stale client with a
live cadence and proving status, pause reason, stop reason and schedule are byte-identical
afterwards; and structurally, by asserting the digest module contains no write verb at all.

**D-13, measured.** `node scripts/sm8-spike.mjs probe` — a subcommand, so re-measuring one
question cannot rewrite every fixture in `tests/fixtures/sm8/` as a side effect.

## Key Implementation Decisions

**`setComplete` was not widened, and the restraint is the decision.** The obvious move was
to make `approveTemplateVersion`'s `setComplete` mean "this client can send now". It would
have broken the drafting page: that flag drives `approvedStillWaitingMessage`, whose whole
job is to name the touch numbers still missing wording. An operator approving their fifth
template with no attestation on file would have been told templates were incomplete when
they are not. `setComplete` still means the TEMPLATE set is finished; the composed answer
rides beside it as `conditions`.

**The refusal carries conditions, not a sentence.** Putting the UI-SPEC copy in
`src/core/cadence/controls.ts` would have been the shortest path and would have put console
wording in a framework-free core that a script and the tick both import. Returning a
boolean pair would have made every surface re-derive which condition maps to which screen.
The outcome travels with its conditions and `resumeCadenceGatedState` is the one mapping.

**A stale attestation SATISFIES its checklist row.** This is the whole of D-15 in one
boolean. Reading staleness as unmet would re-gate a healthy client because a calendar rolled
over — a pause nobody decided to build, arriving through a `&& !isStale` that would look
like tightening. The row is green, the badge says "stale — re-attest", and the gate stays
open. `hasSm8AutomationAttestation` does not look at `attestedAt` at all, and says so.

**The digest's definition of "empty" changed, and it had to.** 06-02 decided an empty digest
is not sent, keyed on `touchesStalled === 0`. Left alone, a client whose attestation is four
months old would never be mentioned on any morning where the approval queue happened to be
clear — which is most mornings, and precisely the mornings when there is time to go and
check. The test is now "would the body carry anything an operator should act on", and
`digestSkippedEmpty` keeps meaning nothing-to-say.

**Staleness is not computed in SQL.** A `WHERE attested_at < now() - interval '30 days'` in
the accessor would have been one query instead of a query plus a filter, and it would have
been a second reading of `ATTESTATION_STALE_DAYS` — one in Postgres, one in the function the
badge renders from. They agree until somebody changes the threshold and finds one of them.

## D-13: the measured answer, and what it changes

```
GET /api_1.0/sms.json    -> 200, 0 rows      (private X-API-Key, trial account, 1 Sep 2026)
GET /api_1.0/email.json  -> 200, 0 rows
```

**Both endpoints ARE reachable under a private API key.** They do not 403 and do not 404 —
the auth we actually hold for design partners is enough to call them.

**The SHAPE is still unmeasured**, because the trial account has never sent an SMS or email
through ServiceM8. A `200 []` proves reachability and nothing about the payload — above all
nothing about whether a row carries the job UUID that tier-1 detection would have to
attribute on.

**D-15 tier 1 therefore stays DEFERRED, but the deferral is now measured rather than
assumed, and the blocker has moved.** It is no longer "we do not know whether we can read
these endpoints". It is "we have never seen a row". Research A2's condition — a seeded
native follow-up on a real account, to prove automation-sent comms appear here at all — is
now the entire remaining unknown, and `docs/servicem8-api-notes.md` records the exact
three-step measurement to run when a live client exists.

**FLAGGED AS A FOLLOW-UP, NOT AS WORK DONE.** No production code path in this build reads
either endpoint. Reachability is not a licence to key a pause on a shape nobody has seen.

## Deviations from Plan

### Deliberate additions beyond the plan's file list

**1. [Rule 2 — Missing critical functionality] `finishResume`, the extracted outside half**

The plan asked for `resumeIfOnboardingComplete` to be extracted and for
`attestSm8AutomationOff` to "re-window outside over the returned ids". Written literally,
that is a second copy of `approveTemplateVersion`'s tail — including the empty-scope early
return whose omission would re-window every active cadence the tenant has, and the paragraph
explaining why. Extracted instead.

**2. [Rule 2] `forAllTenants_latestAttestations` (crossing twelve) + the barrel pin**

The plan says the digest line is "computed from the same checklist reader", but the checklist
reader is per-tenant and a nightly digest has no tenant in hand. Doing it with
`forAllTenants_ids()` plus one `forTenant(id)` read per client would have been thirty round
trips to Sydney to build one section. The accessor returns every client's LATEST instant and
the shared pure function decides staleness — so the reader really is shared, at the level
where sharing matters. Pinned in `tests/lint-ban.test.ts` with the argument for what it must
never become: its aging sibling is a guarded UPDATE that claims, and the day this one
acquires an `alerted_at` is the day the nag starts down the road to a pause.

**3. [Rule 2] `ControlState.fixes` and the link rendering**

The UI-SPEC requires the refusal to link "to exactly that". `ControlState` carried two
nullable strings and no channel for a link, so the sentence would have named a screen the
operator then had to find. Optional, and an array, for `settled`'s reason and in the same
direction: a forgotten `fixes` renders the sentence alone (still true, less helpful), where
a defaulted one would render a link that fixes nothing.

**4. [Rule 2] `tenant_attestations` added to the test teardown**

`NO_CASCADE_TABLES` in `tests/helpers/seed.ts` did not cover it, because the table landed in
06-01 one plan before its first writer. Left behind, a stale attestation row would silently
satisfy the ONB-04 half of the gate for a later test's tenant — a suite passing because of
somebody else's residue, which is exactly what the ordered one-tenant-per-concern rule
exists to prevent.

**5. [Rule 2] `seedAttestation` helper**

The 30-day boundary is untestable through the production surface by design: `append` takes
no timestamp. The one place that may choose an `attested_at` is a fixture writing through the
service-role client, visibly outside the production surface.

**6. [Rule 2] The digest's empty-test widening**

Not in the plan, and without it the staleness line would have been invisible on most
mornings. See Key Decisions.

### Departures from the plan's literal wording

**7. The `sm8-spike` probe's third outcome**

The plan anticipated two results — `404/403` (tier 1 stays deferred) or `200 with usable
shape` (tier 1 becomes buildable, flagged as a follow-up). The measurement was neither: **200
with NO shape**, because the account has never sent anything. Recorded as what it is rather
than rounded to the nearer branch; the consequence section above states which half of the
question is answered and which is not.

### Pinned-list edits the project requires

- `tests/lint-ban.test.ts` barrel pin gains `forAllTenants_latestAttestations` and its type.
- The same file's `CLIENT_REACHABLE` list gains `clients/[id]/checklist-card.tsx` and
  `clients/[id]/action-state.ts` — the same `'use client'` + sibling-constants shape that
  broke the build in 06-02, and the card is one `import` away from `ATTESTATION_STALE_DAYS`,
  a VALUE in a module that imports the repository.
- `tests/pause-upgrade.test.ts`'s `onboarding_gated` assertion gains the conditions record.

## Verification

| Gate | Result |
|------|--------|
| `npm run test:remote -- tests/onboarding-checklist-gate.test.ts` | **25/25 passed** (hosted Sydney DB, cron ticks leased-paused) |
| `npm run test:remote -- tests/stall-tick.test.ts tests/lint-ban.test.ts` | **44/44 passed** — the digest change and the barrel pin |
| `npm test` | **2015 passed** (2010 at plan start); 35 files remote-gated as designed (34 + the new suite) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run build` | green |
| `node scripts/sm8-spike.mjs probe` | ran against the live trial account; both statuses measured |
| Probe record in `docs/servicem8-api-notes.md` | present (`grep` verification in the plan passes) |
| Migration | **none generated** — 0032 remains the phase's single journal entry, per 06-01 |

### The named Pitfall 6 test, and what it proves

```
describe('the pre-Phase-6 client: templates approved, no attestation')
  → markChaseEligible + consumeQuoteEvents  → cadence status 'paused', reason 'onboarding'
                                            → touches materialized (not refused)
  → resumeCadence(...)                      → { onboarding_gated,
                                                { templatesApproved: true,
                                                  sm8AutomationAttested: false } }
  → attestSm8AutomationOff(...)             → cadencesResumed: 1, and the ACTIVE cadence
                                              outside the resume keeps its exact schedule
```

The third step's fixture is the discriminating one: an active cadence with overdue touches
that the resume never returned. A re-window scoped to the tenant rather than to the RETURNING
ids passes everything above it and fails exactly there.

### Test-environment note

Every command above was run with `STALLED_DIGEST_SECRET` injected into the command
environment. It is a REQUIRED member of `serverEnvSchema` (06-02) and is still absent from
`.env.local`, which this executor is permission-blocked from writing. **06-02's operator
obligation 1 remains outstanding and blocks a bare `npm test`.**

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-6-12 Repudiation — attestation forged, backdated or overwritten | Append-only INSERT through a namespace whose key list is asserted to be exactly `['append', 'latest']`; `attested_at` is `defaultNow()` and is NOT a parameter, proven by passing an obviously-wrong clock and reading back a server timestamp within 60s of now; note required at the column (NOT NULL, no default), at the core signature and at the action (`.trim().min(1)`); service-role writes only, SELECT-only grants from 0032. A second attestation is proven to add a row and leave the first byte-unchanged. |
| T-6-13 Elevation — creation or resume bypassing the composed gate | ONE predicate (`resumeIfOnboardingComplete`) reached by `consume-events` and both writers, with a source assertion that the conjunction appears in exactly one file and that `consume-events` no longer calls `hasApprovedTemplateSet`. The pre-Phase-6 approved-but-unattested tenant is proven born-paused through the real emit path, and refused at resume with the attestation named. |
| T-6-14 Denial of service — staleness auto-pausing healthy clients | Staleness produces UI state and one digest line. Proven behaviourally: a full `runStalledDigest` against a stale client with a live cadence leaves status, pause reason, stop reason and every touch schedule byte-identical. Proven structurally: the digest module contains no `pauseWhereActive` / `stopWhereLive` / `resumeWherePaused` / `skipWhere` / `reschedule` / `update(`. The accessor it reads is a SELECT. |
| T-6-15 Elevation — forged attest POST | WR-01 order: `authorize(tenantId)` — session check **and** an RLS-scoped `tenants` read with the caller's own JWT — before a byte of `formData` is read; zod with a bounded, trimmed, non-empty note; the write scoped to `forTenant(the authorized tenant)`, so a forged body naming another client attests nothing. No extra params accepted. |

## Prohibitions Honoured

- **A stale attestation pauses NOTHING.** Asserted on real rows after a real digest run, and
  again as an absence of every write verb in the module. The only thing staleness produces is
  a badge and a sentence.
- **No resume-anyway affordance beside a gated cadence.** The refusal's only links go to
  pages that CLEAR a condition; the checklist card's attest disclosure has no "mark off
  without checking" arm. Stated in three file headers so the next person to be in a hurry
  reads the argument before adding one.
- **Attestation rows are never updated or deleted.** Enforced by the absent method, asserted
  as a key list, and proven by appending twice.
- **No migration.** `git diff` touches no file under `src/db/migrations/`.
- **No packages installed.** `git diff` touches no manifest.
- **No production code reads `sms.json` or `email.json`.** The probe is a script.

## Known Stubs

None.

Two things are deliberately scoped elsewhere and are not stubs:

- **D-15 tier 1 (behavioural drift detection)** is deferred with a measured reason and a
  written next-measurement procedure. Nothing renders a placeholder for it.
- **`messagingArmed`'s fix link** is `null`, because arming a channel is a
  `messaging_config` row flip with no console screen behind it. A link going nowhere teaches
  the operator that this list's links are decorative, which is worse than its absence; the
  row still shows the identity when armed.

## Requirement Status

**ONB-04 is complete and is marked here.** This is the only plan claiming it. Activation
requires both conditions at creation and at both resume paths; the attested condition carries
timestamped, append-only evidence with a required note; drift is re-checked at 30 days
without auto-pausing; and the detection question has a measured answer instead of an
assumption.

## Notes for Next Plans

- **`resumeIfOnboardingComplete` is the ONE resume path.** A third condition (if one is ever
  added) goes into `OnboardingConditions` and `onboardingComplete`, and every call site picks
  it up for free. Do not add a second conjunction; a source assertion fails first and says
  why.
- **`ControlState.fixes` is now the console's "where to go" channel.** Any refusal that names
  a missing thing should carry the link to it rather than describing the screen.
- **The checklist card's `ITEM_FIX` is a `Record` over the key union**, so a seventh checklist
  item is a compile error there rather than a row with no way to fix it.
- **Do not compute staleness in SQL.** `isAttestationStale` is the one derivation; the
  accessor deliberately returns raw instants.
- **`digestSkippedEmpty` now means "nothing to say", not "nothing stalled".** A future digest
  section must decide whether its own emptiness counts, and say so where it builds.
- **When a live client exists, re-run `node scripts/sm8-spike.mjs probe`** after seeding one
  native ServiceM8 follow-up. The three-step procedure is in `docs/servicem8-api-notes.md`
  and it is the only thing standing between here and D-15 tier 1.

## Self-Check: PASSED

Files asserted present:

```
FOUND: src/core/drafting/onboarding-gate.ts
FOUND: src/core/onboarding/checklist.ts
FOUND: src/app/(console)/clients/[id]/checklist-card.tsx
FOUND: tests/onboarding-checklist-gate.test.ts
```

Commits asserted present: `6559363`, `8909778`, `3a14c38`.
