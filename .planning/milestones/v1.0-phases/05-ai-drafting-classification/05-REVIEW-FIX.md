---
phase: 05-ai-drafting-classification
fixed_at: 2026-08-31T04:40:00Z
review_path: .planning/phases/05-ai-drafting-classification/05-REVIEW.md
iteration: 1
findings_in_scope: 15
fixed: 15
skipped: 0
status: all_fixed
remote_regression_fixed: 6227873
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-08-31T04:10:00Z
**Source review:** `.planning/phases/05-ai-drafting-classification/05-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 15 (2 critical, 13 warning — `fix_scope: critical_warning`)
- Fixed: 15
- Skipped: 0

**Verification (all gates run in the MAIN CHECKOUT — `workflow.use_worktrees` is
`false`, so every edit, migration and commit landed on `main` directly; the
numbers below are reproducible from the tree as it stands):**

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npm run lint` | clean, `--max-warnings=0` |
| `npm test` | **1590 assertions passed, 0 failed.** 31 failed FILES, all of them the single pre-existing remote-refusal gate — `grep -c "Error:"` over the run yields exactly one distinct error string, `Refusing to run integration tests against a non-local Supabase stack`. Baseline was 1540 assertions; the 50 added here are new coverage. |
| `npm run verify:drafting` | **PASSED** live (3 real Claude calls on synthetic data) — required by WR-10, which is a fix to that script |
| `npm run db:migrate` | 3 migrations applied to the hosted DB; each proven idempotent by a second run reporting an unchanged journal count |
| `npm run test:remote -- tests/draft-pipeline.test.ts tests/cadence-tick.test.ts` | **2 files / 18 tests passed**, one serialized run (see the regression note below) |

### Regression found by the coordinator's full remote run, and fixed

**My original claim in this section — that no remote run was needed — was
wrong, and it hid a real bug.** The CR-02 claim query interpolated a raw JS
`Date` into a drizzle `sql` template:

```ts
sql`(... OR ${cadenceTouches.draftingStartedAt} < ${staleBefore})`
```

which binds the value untyped, so postgres.js throws `ERR_INVALID_ARG_TYPE` at
Bind. This is the recorded Phase 3 trap. It is **invisible to every gate that
does not open a real connection**: the query typechecks, lints, and passes the
pure suites — which fake the repository across the narrow `DraftRepository`
interface, so no pure test can ever exercise the SQL. That is precisely the seam
my reasoning ("covered by pure tests through the narrow repository interfaces")
argued was covered, and it is the seam those interfaces *create*.

Fixed in `6227873` with builders — `or(isNull(col), lt(col, staleBefore))` —
which route the value through the column mapper. I audited every `sql` template
added across this whole fix pass; the only other one interpolates a column
reference rather than a value, and is safe.

**A second failure was masked behind the Bind crash.** With the claim working,
`cadence-tick`'s all-zero quiet-tick test failed on
`draftingUnconfigured: 0` — which was the WR-04 bug encoded as an expectation.
That test's own note on `classificationUnconfigured` cites `draftingUnconfigured`
as the precedent for "a 0 here would be indistinguishable from a healthy pass
with nothing to do"; WR-04 is what finally makes that comment true. The count is
*tenants* whose drafting could not run, so it is not pinnable against a shared
database: it is now `expect.any(Number)` inside the exhaustive `toEqual`
(preserving the extra-key and wrong-type guarantees, exactly as `cursorAt` is
handled) plus a separate `>= 1`, because "any number" would readmit the 0.

**Lesson worth carrying forward:** a repository method reachable only through an
injected interface has no pure-test coverage of its SQL by construction. Any
future finding that adds or edits a query needs a remote run, and "the pure
suite is green" is not evidence about it.

---

## Fixed Issues

### CR-01: `renderMoney` truncates cents

**Files modified:** `src/core/drafting/merge-facts.ts`, `tests/merge-facts.test.ts`
**Commit:** `fde2ef3`

`Math.trunc(cents / 100)` discarded the cents, rendering `'2437.50'` as
`$2,437`. Now renders the remainder, and returns `null` for a blank/whitespace
column instead of coercing `Number('')` to `$0`. The docstring's false
"integer-cents math; never a float round-trip" claim is replaced with an honest
account of why `Math.round(value * 100)` is safe at quote magnitudes.

Added `tests/merge-facts.test.ts` (15 cases). The money fixtures are
**round-tripped through the production validator** rather than string-compared —
the property that matters is not "renderMoney produced this text" but "the price
the tradie actually quoted is a price the model is allowed to write, and nothing
else is". Includes the inverse: `$2,437` is now refused as `unlisted_number`.

---

### CR-02: no claim and no `(touch_id, attempt)` uniqueness on the drafting queue

**Files modified:** `src/db/schema/touch-drafts.ts`, `src/db/schema/cadence-touches.ts`, `src/db/repository/for-tenant.ts`, `src/core/drafting/draft-touches.ts`, `src/core/cadence/run-tick.ts`, `src/db/migrations/0029_drafting_claim.sql`, `src/db/migrations/meta/*`, `tests/draft-touches.test.ts`
**Commits:** `09816b6`, then `6227873` (**regression fix — see the verification
section: the claim query bound a raw `Date` inside a `sql` template and threw
`ERR_INVALID_ARG_TYPE` on every real connection**)

Both halves the review asked for.

**(a)** Migration 0029 adds `UNIQUE (touch_id, attempt)`, and `latestForTouch`
gains a total order `(attempt DESC, created_at DESC, id DESC)` so a tie cannot
exist even if the index is dropped. Two guarantees is the right number for a
failure whose symptom is a touch that can never be approved through the console.

**(b)** `cadence_touches.drafting_started_at` is a claim taken by a guarded
`UPDATE ... RETURNING` before any model call. Chose the column over the review's
`FOR UPDATE SKIP LOCKED` alternative deliberately: drafting's unit of work spans
up to two 60s Anthropic calls, so a lock-based claim would hold a Postgres
transaction open across two minutes of somebody else's network.

**One design point beyond the review.** A claim that is only released by its
staleness window turns every ordinary failure into a six-minute delay on a
customer's follow-up. So the pass **releases** every claim it does not convert to
`pending_approval`, and the window (6 min, deliberately longer than the route's
300s `maxDuration` so a merely-slow tick is never robbed) is crash recovery
only. `draftTouches` was split into a claim/release shell plus
`draftClaimedBatch` so the release sits in a `finally` that survives a `return`,
a `break` and a throw alike — 8 new tests cover each of those exits.

Migration verified: `touch_drafts` was empty (0 rows, 0 duplicate groups) before
the unique index was created, so it could not fail mid-run.

---

### WR-01: the classification fence does not strip its own closing delimiter

**Files modified:** `src/core/classification/classify-inbound.ts`, `tests/classify-inbound.test.ts`
**Commit:** `15a5765`

`delimitedBody` now applies the drafting sanitizer's discipline: C0/C1 control
characters become spaces, and both markers are removed. Three tests added,
including one proving a marker split across a removal
(`</cus</customer_reply>tomer_reply>`) cannot reassemble — which is why the
removal joins with a space rather than nothing.

---

### WR-02: `draftTouches` ignores `touch.channel`

**Files modified:** `src/core/drafting/draft-touches.ts`, `tests/draft-touches.test.ts`
**Commit:** `d17dcdc`

Explicit `touch.channel !== 'sms'` guard at the top of the per-touch loop,
counted as `noApprovedTemplate` — which is what it is: a schedule this pass has
no wording for. Test asserts the email touch is never asked about while the SMS
touch beside it still drafts.

---

### WR-03: a deterministic (400/401/403) failure records no attempt

**Files modified:** `src/db/schema/cadence-touches.ts`, `src/db/repository/for-tenant.ts`, `src/core/drafting/draft-touches.ts`, `src/db/migrations/0030_draft_failure_cap.sql`, `src/db/migrations/meta/*`, `tests/draft-touches.test.ts`
**Commit:** `a30022b`

Took the review's first option (a dedicated counter) over the second (a zero-body
attempt row), because a `validator_failed` row on a touch still in `needs_draft`
would surface on the approval screen as a card with an empty body — trading one
bug for another.

Migration 0030 adds `cadence_touches.draft_failures`; `applyFailure` bumps it on
the deterministic arm; `listNeedsDraft` excludes touches at `MAX_DRAFT_FAILURES`,
mirroring `listUnclassified`'s `classify_attempts` predicate exactly. Two
counters, because they bound genuinely different things — output the validator
rejected, and requests the API refused to answer at all. Tests pin that rate
limits, connection errors and 529s still count for nothing.

---

### WR-04: `draftingUnconfigured` counts only this tick's promotions

**Files modified:** `src/core/drafting/draft-touches.ts`, `src/core/cadence/run-tick.ts`, `tests/draft-touches.test.ts`
**Commits:** `4cc1455`, then `6227873` (the remote `cadence-tick` all-zero
assertion encoded the old zero as an expectation — see the verification section)

Now a flag (`= 1`), matching `ClassifyCounts.unconfigured`, with the tick's field
comment rewritten to read as "tenants whose drafting could not run". The added
test passes **zero** promoted touches — the steady state, and the case the old
code reported as byte-identical to a quiet minute.

---

### WR-05: approval-time re-validation rebuilt from the wrong clock and business name

**Files modified:** `src/db/schema/touch-drafts.ts`, `src/core/drafting/draft-touches.ts`, `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts`, `src/db/migrations/0031_draft_merge_inputs.sql`, `src/db/migrations/meta/*`, `tests/quote-draft-approval.test.ts`
**Commit:** `f17e2f6`

Migration 0031 adds `touch_drafts.merge_now` and `.compliance_suffix`, joining
`prompt_version`/`template_version`/`model` as reproduction inputs recorded on
the row. Both nullable, with the approve action falling back to `created_at` and
a re-derived suffix for pre-existing rows — which is exactly the behaviour those
rows already had. No backfill: inventing values for an evidence table is worse
than a documented `null`.

Three tests: one whose fixture makes `merge_now` and `created_at` name different
days on purpose (so reading `created_at` would refuse the body), one proving a
rename does not break a draft already on screen, and one proving the frozen
suffix is still **checked** rather than merely accepted — freezing must not mean
skipping a legal requirement.

---

### WR-06: the quote page renders a stale rejected attempt as "awaiting approval"

**Files modified:** `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx`
**Commit:** `4b6574f`

Added the `seen` set so the first row per touch decides, whatever it says. The
structural test that pinned the old loop shape was updated in the WR-07 commit
(`84999f2`) to pin the new one.

---

### WR-07: a model refusal shown as "Write the message before approving it"

**Files modified:** `src/app/(console)/clients/[id]/quotes/[quoteId]/action-state.ts`, `src/core/drafting/draft-touches.ts`, `tests/quote-draft-approval.test.ts`, `tests/draft-touches.test.ts`
**Commit:** `84999f2`

Both halves. The recorded `detail` is now rendered (a genuinely empty submission
carries none and still gets the plain instruction — a case the new tests
separate explicitly), and `parkUnusable` parks with the suffix as `final_body`
so the edit form starts from the legally-required line instead of nothing. The
refusal test now also asserts the parked body contains **only** the suffix and no
template text, so the D-10 "no path composes a sendable message from the
template" property still holds over the new value.

---

### WR-08: operator-pasted voice examples enter the SYSTEM block unfenced

**Files modified:** `src/app/(console)/clients/[id]/drafting/actions.ts`, `tests/drafting-settings-action.test.ts`
**Commit:** `2ab904d`

`sanitize()` now strips markdown heading syntax and both `QUOTE_DATA` markers at
the same boundary that already strips invisibles. Newlines still survive — a
voice example flattened to one line is a worse example; it is the structure that
goes, not the shape of a real message.

Added a drift guard beyond the review's suggestion: the action restates the
markers as literals (rather than importing a prompt-internal constant), so a
test pins both files against the same strings — renaming a marker in `prompt.ts`
alone now fails rather than silently disabling the stripping.

---

### WR-09: `classified` counted even when the guarded write matched no rows

**Files modified:** `src/core/classification/classify-inbound.ts`, `tests/classify-inbound.test.ts`
**Commit:** `9be154d`

`record` now reads `{ classified }` and returns early on a lost race. Two tests:
one proving the write is still **attempted** for both rows (the guard is the
arbiter, not a pre-check this pass performs), and one proving `needsHuman` — a
subset of `classified` — is not left larger than the set it is drawn from.

---

### WR-10: `verify:drafting` used the substring rule `validate.ts` documents as a hole

**Files modified:** `scripts/verify-drafting.mjs`, `scripts/lib/ts-resolve-hooks.mjs`
**Commit:** `0b1a49a`

The script now imports and runs `validateDraft` itself, checking every rule at
once. `tsx` is not a dependency and Node 22's type-stripping does not resolve
TypeScript's extensionless relative specifiers, so this needed
`scripts/lib/ts-resolve-hooks.mjs` — a deliberately minimal resolve hook that
supplies only that one thing (no alias, no `.tsx`, no transpilation) and rethrows
the original error otherwise, so a genuine typo does not become a
missing-`.ts` report. No new dependency.

Added a negative probe on the validator itself: a passing check proves nothing
unless the checker can fail, and if `45` (a substring of the supplied `$2,450`)
ever passes, the import is resolving to something other than production.

**Verified live** — `npm run verify:drafting` PASSED, including
`ok: validator refuses a number nobody supplied (substring probe)`.

---

### WR-11: `saveTemplateVersion` hardcodes a 5-touch ceiling

**Files modified:** `src/app/(console)/clients/[id]/drafting/actions.ts`, `tests/drafting-settings-action.test.ts`
**Commit:** `8ba7e80`

Took the review's stronger option. The bound is now **membership** in
`approvedSetStatus()` — the exact rows `drafting/page.tsx` renders cards from —
rather than a maximum. So the form and the schema agree by construction rather
than by two numbers being kept in step, and a shape with a gap in it (1, 2, 4, 5)
is handled without anybody having to think about gaps. An empty shape refuses
everything, which is what the page's own "the follow-up shape does not exist"
copy already says. Three tests, including the six-touch tenant that could
previously never complete its template set.

---

### WR-12: the fact validator's guarantee does not cover a price written in words

**Files modified:** `src/core/drafting/validate.ts`, `src/core/drafting/prompt.ts`, `tests/drafting-validate.test.ts`, `tests/drafting-prompt.test.ts`
**Commit:** `0459af6`

Took the review's cheaper-and-more-honest option. The limit is recorded **at Rule
1**, where a reader will meet it, rather than in a header nobody re-reads; and
`INSTRUCTIONS` gains an explicit line naming the spelled-out forms.

The new tests **assert that the validator does not catch these** — because it
does not, and a suite that quietly omitted the case would leave the file's
"MECHANICAL, NOT PERSUASIVE" framing reading as a total guarantee. Anyone who
later extends Rule 1 to English numerals gets a failing test telling them to
delete the block.

**One thing the review did not ask for:** `PROMPT_VERSION` bumped `p3` → `p4`.
The file's own rule is "BUMP THIS whenever the instruction text ... changes", and
two different prompts sharing a version is precisely the drift that column exists
to prevent.

---

### WR-13: suppressing from the inbox never revalidates `/inbox`

**Files modified:** `src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts`, `tests/quote-draft-approval.test.ts`
**Commit:** `46c900f`

`revalidatePath('/inbox')` added to `revalidateBoth`, with the second-caller
reasoning recorded in the function's docstring.

---

## Notes for the verifier

**Nothing here is flagged "requires human verification".** Every fix is either a
mechanical correction with a test that fails without it, or a documented
trade-off recorded above. The three judgement calls worth a second opinion are
called out in place: the claim-release design in CR-02, the counter-over-row
choice in WR-03, and the accept-the-residue decision in WR-12.

**The remote suites were run once, serialized, for the two files the regression
touched** (`draft-pipeline`, `cadence-tick`) — `fileParallelism: false` and the
cron-pause `globalSetup` make a single `test:remote` invocation the correct
shape. Both re-armed the production cron jobs and released the pause lease
cleanly on exit. The remaining remote suites have **not** been run against these
changes; the coordinator's full regression run is the authority there.

**Three migrations were applied to the production-shared hosted DB** (0029, 0030,
0031). All additive — one index and four nullable/defaulted columns. Each was
proven idempotent by a second `db:migrate` run reporting an unchanged journal
count (30, 31, 32 respectively), and the resulting DDL was read back from
`information_schema` / `pg_indexes` rather than assumed. The journal
monotonicity guard (`tests/lint-ban.test.ts`) passes.

**Migration file names were changed after generation** from drizzle's random tags
(`0029_outgoing_la_nuit`, `0030_wet_siren`, `0031_cold_centennial`) to the
repo's descriptive convention, with `meta/_journal.json` tags updated to match.

**One behaviour change a reader might not expect from the finding titles:**
WR-07 means a parked-unusable draft now stores the compliance suffix as its
`final_body` where it previously stored `''`. Dispatch is unaffected — it sends
only `approved` drafts, and these are `validator_failed`.

---

_Fixed: 2026-08-31T04:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
