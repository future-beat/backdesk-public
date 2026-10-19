# Deferred items — Phase 10

Out-of-scope discoveries made while executing a plan. Logged, not fixed: the
executor's scope boundary is "only auto-fix what THIS task's changes caused".

## From plan 10-02 (2026-09-11)

### `tests/lint-ban.test.ts` is red on `main` — the barrel surface pin is stale

**Found during:** the bare `npx vitest run` gate at the end of plan 10-02.

**What:** `tests/lint-ban.test.ts:367` pins the exact sorted export list of
`src/db/repository/index.ts` ("anything that lists, deletes, or re-opens a
claimed row … must fail here"). Plan **10-01** added `listChannelAudit` to the
barrel and did not add it to the pinned list, so the suite fails with a
one-element diff.

**Why it is not fixed here:** plan 10-02 adds no repository export and does not
touch the barrel. The failure reproduces at `8dae60e` (10-01's final commit),
before any 10-02 commit.

**The fix:** add `'listChannelAudit'` to the sorted array in
`tests/lint-ban.test.ts`. One line, in 10-01's territory.

**Why it matters:** this is the repo's CI-blocking gate on the RLS-bypassing
data surface. A gate that is red for a known-benign reason is a gate people
start waving through, which is precisely what it exists to prevent.
