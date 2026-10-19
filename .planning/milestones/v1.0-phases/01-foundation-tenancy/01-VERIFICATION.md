---
phase: 01-foundation-tenancy
verified: 2026-08-25T11:29:32Z
status: passed
score: 18/20 must-haves verified
behavior_unverified: 1
overrides_applied: 0
deferred:
  - truth: "ClickSend account is created and a dedicated AU virtual number order is submitted"
    addressed_in: "Phase 4"
    evidence: "Phase 4 (Messaging Gateway) owns MSG-01: 'SMS sends and receives via dedicated AU virtual number(s)'; roadmap goal names 'dedicated AU numbers'. The order was attempted 2026-08-25 and refused on the IPND street-address requirement — an external constraint no Phase 1 execution could clear. The clock is started (support ticket open, +5-business-day check calendared for 2026-09-01), the Twilio fallback is documented with its caveat, and the root blocker (no IPND-acceptable AU business address) is escalated as a STATE.md Phase 4 blocker."
behavior_unverified_items:
  - truth: "A rejected create-client submission re-renders the form with the operator's typed input preserved next to the field errors"
    test: "On a phone or browser, submit /clients/new with an invalid field (e.g. start time after end time) and inspect the re-rendered form"
    expected: "Every previously typed value (name, trade, timezone, hours, checked days, phone) is still populated; the field error appears inline"
    why_human: "The action returns { errors, values } and every control reads defaultValue/defaultChecked from state.values (code present and wired), but React 19 useActionState repopulation is a DOM-level runtime behavior and no DOM test harness exists in this project — presence checks cannot see whether the browser actually keeps the input"
human_verification:
  - test: "On a phone: log in at /login, create a real client via /clients/new, confirm it appears in the list, then open it from the list"
    expected: "Login and form flow are usable on a phone; the detail page renders name, trade type, timezone, contact-hours window with day names, escalation phone, status badge, and created date correctly; visiting /clients/{garbage-uuid} returns 404"
    why_human: "Visual layout, tap targets, and rendered-profile correctness on a real device are judgment calls no assertion in this project makes (deferred <human-check> from plans 01-02 Task 2 and 01-03 Task 2; coverage D4/D7)"
  - test: "View the client list against an empty tenants table (fresh project or after cleanup)"
    expected: "An explicit 'No clients yet' empty state with a link to /clients/new renders instead of an empty table"
    why_human: "The branch (tenants.length === 0) is present in src/app/(console)/page.tsx but cannot be exercised automatically without emptying the live project's data (coverage D6)"
  - test: "Submit /clients/new with an invalid field and check the re-rendered form keeps your typed input"
    expected: "All typed values preserved, field error shown inline (see behavior_unverified_items)"
    why_human: "React 19 form-repopulation behavior; no DOM test harness (coverage D3)"
  - test: "Open Supabase Dashboard -> Project Settings and confirm the project region of record is ap-southeast-2 (Sydney)"
    expected: "Region reads ap-southeast-2; AU data residency is a committed sales claim (plan 01-02 prohibition ONB-01/privacy, status: unverified)"
    why_human: "Pooler hostname (aws-0-ap-southeast-2) and AAAA-range evidence are strong but only the dashboard project settings are an authoritative residency attestation; the verifier is also (correctly) denied read access to .env.local. UNVERIFIED-PROHIBITION — human review required, never a silent pass"
  - test: "In ServiceM8 (Account -> Developer), confirm the Public Application was created and record the App ID on the Account/ID line of docs/external-registrations.md"
    expected: "App ID recorded (non-secret); App Secret remains only in the operator's secret store. Next-check date in the log was 2026-08-26"
    why_human: "Vendor-side dashboard state has no automated probe; the committed log currently carries an explicit App-ID placeholder (01-01 partial completion). Backstop truth — abstains to human confirmation rather than passing on attestation alone"
---

# Phase 1: Foundation & Tenancy — Verification Report

**Phase Goal:** Multi-tenant foundation exists — operator can create isolated clients, and both external lead-time clocks (ServiceM8 partner approval, AU number provisioning) are started
**Verified:** 2026-08-25T11:29:32Z
**Status:** human_needed
**Re-verification:** No — initial verification

> Note on mode: ROADMAP marks Phase 1 `Mode: mvp` but the phase goal is not in User Story format (the four success criteria below are the verifiable contract; each plan's objective is individually story-formatted). Verification proceeded goal-backward against the roadmap Success Criteria, with a User Flow Coverage view included. Informational only.

## Goal Achievement

### User Flow Coverage (operator flow)

| Step | Expected | Evidence | Status |
| ---- | -------- | -------- | ------ |
| Visit console unauthenticated | Redirect to /login | Live spot-check: GET `/` and `/clients/new` -> 307 to `/login`; `/login` -> 200 (built app started locally) | ✓ |
| Log in | Email+password sign-in succeeds; wrong password rejected | `tests/auth-security.test.ts` (5 tests) passed in this verification's run | ✓ |
| Create client at /clients/new | Full profile validated server-side; RPC creates tenant + membership atomically | `tests/tenant-validation.test.ts` (42), `tests/tenant-create.test.ts` (5) passed; `rpc('create_tenant', ...)` wired in actions.ts:86 | ✓ |
| See client in list | RLS-scoped read, created_at DESC + id DESC, rows link to detail | `src/app/(console)/page.tsx:16-21,64` — live query, both order clauses, `/clients/${tenant.id}` links | ✓ |
| Open detail page | Full profile renders; unknown/foreign/malformed id 404s | `[id]/page.tsx` UUID guard + notFound(); integration test for the zero-row path; phone rendering → human | ✓ (render → human) |

### Observable Truths

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | Operator can log in at /login; unauthenticated console requests redirect to /login (SC1, ONB-01) | ✓ VERIFIED | Behavioral: live 307 spot-check + auth-security tests passing; proxy.ts matcher + `updateSession` redirect + `(console)/layout.tsx` getClaims defense-in-depth |
| 2  | Operator can create a client with name, trade, timezone, contact-hours window and sees it in the list (SC1, ONB-01) | ✓ VERIFIED | tenant-create integration tests (full-profile persistence + readback) passed; UI wired form -> action -> RPC -> RLS read |
| 3  | RLS enabled on every migration-set-001 table; policies key on tenant_members membership lookup, never raw_user_meta_data (SC2, ONB-05) | ✓ VERIFIED | `0001_tenants_and_members.sql` — ENABLE ROW LEVEL SECURITY on both tables + policies using `has_tenant_access(id)` / `auth.uid()`; SECURITY DEFINER fn in 0000; no raw_user_meta_data anywhere |
| 4  | create_tenant is transactional (no orphan membership) and duplicate names collide on unique lower(name) (ONB-01) | ✓ VERIFIED | Single plpgsql SECURITY DEFINER fn (one transaction by construction) in 0002 + `tenants_name_lower_key`; real duplicate-collision integration test passed |
| 5  | Client list ordering is deterministic (created_at DESC, id DESC tiebreak) | ✓ VERIFIED | Both order clauses present in page.tsx:20-21; determinism delegated to Postgres ORDER BY semantics |
| 6  | Public signup returns an error — operator-only auth | ✓ VERIFIED | auth-security test "rejects public signup" passed in this run (pins the dashboard toggle) |
| 7  | Tenant data path runs against Supabase in ap-southeast-2 (Sydney) | ? UNCERTAIN | docs/env-vars.md documents the aws-0-ap-southeast-2 pooler; dashboard is the only authoritative attestation → human item (flagged prohibition ONB-01/privacy) |
| 8  | Invalid tenant input rejected server-side with field-level errors (hours ordering, IANA timezone, days range, empty name/trade, AU phone) (ONB-01) | ✓ VERIFIED | 42 validation unit tests passed; tenantCreateSchema is the sole authority, called in actions.ts before the RPC |
| 9  | Double submit with same name yields exactly one tenant with a mapped duplicate-name field error (ONB-01 idempotency) | ✓ VERIFIED | Integration test asserts real PostgREST 23505 error shape + exactly one surviving row |
| 10 | Rejected submission preserves the operator's typed input on the re-rendered form (ONB-01) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `{errors, values}` returned; every control reads defaultValue/defaultChecked from state.values — present and wired, but no DOM test exercises the repopulation → human |
| 11 | /clients/[id] shows the full business profile; unknown/foreign/malformed ids 404 (ONB-01) | ✓ VERIFIED | UUID-shape guard + notFound(); RLS-scoped query; zero-row integration test; visual render on phone → human |
| 12 | Client list shows explicit empty state; rows link to detail (ONB-01 empty edge) | ✓ VERIFIED | Empty-state branch and `/clients/${tenant.id}` links present in page.tsx:45,64; empty-state visual → human |
| 13 | Two-tenant leak test passes both halves — RLS half (member of A sees no B; anon sees nothing) and repository half (forTenant(A) can never emit B) (SC2, ONB-05) | ✓ VERIFIED | `tests/leak.test.ts` 9 assertions passed in this verification's own vitest run against the live project, and in CI |
| 14 | Suite fails when any public-schema table has RLS disabled, with a non-vacuity guard (ONB-05) | ✓ VERIFIED | `tests/rls-coverage.test.ts` (2 tests) passed against live pg_tables |
| 15 | Importing the raw db client outside src/db/repository is an ESLint error, proven by a firing test (SC3, ONB-05) | ✓ VERIFIED | `tests/lint-ban.test.ts` 6 assertions passed; `no-restricted-imports` block + repository-scoped off-switch in eslint.config.mjs |
| 16 | forTenant(id) with no rows returns an empty array — never null, never a throw (ONB-05 empty edge) | ✓ VERIFIED | leak.test.ts empty-edge assertion passed; UUID guard at construction |
| 17 | Identical-profile tenants stay isolated — keying on UUID only (ONB-05 adjacency edge) | ✓ VERIFIED | Seed creates identical-profile A/B; adjacency + write-scoping assertions passed |
| 18 | CI runs typecheck, fresh-stack migrate, and the full suite (leak + rls-coverage blocking) and is green (SC2, ONB-05) | ✓ VERIFIED | `gh run list`: conclusion success on b1f3aec and 15fe670; ci.yml runs `npx drizzle-kit migrate` then `npx vitest run` + two secret scans |
| 19 | ServiceM8 Development Partner registration submitted, date recorded, App Secret outside git (SC4) | ✓ VERIFIED | docs/external-registrations.md: dated Submitted entry, secrets-discipline enforced (no secret-shaped strings); App ID issuance unconfirmed → human follow-up item |
| 20 | ClickSend AU virtual number order submitted (SC4) | ⧖ DEFERRED | Order attempted and externally refused (IPND address); clock started via support ticket, 2026-09-01 fallback trigger calendared — see Deferred Items |
| 21 | docs/external-registrations.md records both clocks: dates, non-secret IDs, status, next check, fallback trigger each (SC4) | ✓ VERIFIED | File read in full: two Submitted lines, Fallback trigger per section, Twilio caveat + root-blocker analysis, zero secret material |

**Score:** 18/20 truths verified (1 present-but-behavior-unverified, 1 uncertain/human; deferred item excluded from denominator)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Dedicated AU virtual number order submitted (ClickSend) | Phase 4 | Phase 4 owns MSG-01 ("SMS via dedicated AU virtual number(s)"). External blocker: ClickSend (and the Twilio fallback) both require an IPND-format AU street address the operator does not have. Clock is started (support ticket 2026-08-25), fallback + root-blocker documented in docs/external-registrations.md, escalated in STATE.md. SC4's substance — clocks started with fallbacks documented — is met; the literal "order submitted" is externally impossible until an address exists, needed by 2026-09-01 |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `docs/external-registrations.md` | Evidence log, contains "Submitted:" | ✓ VERIFIED | 2 Submitted entries, 2 Fallback triggers, no secrets |
| `src/db/schema/tenants.ts` | pgTable + pgPolicy RLS | ✓ VERIFIED | 77 lines, 4 pgPolicy references |
| `src/db/migrations/` | 3-part journal (extensions/fn, tables+policies, RPC+grants+index) | ✓ VERIFIED | 4 migrations (0003 table-grants added by 01-04, fixing a real CI-found gap) |
| `proxy.ts` | Next 16 session refresh + route protection | ✓ VERIFIED | Wired to updateSession; matcher excludes /login and static assets |
| `src/app/(console)/clients/new/actions.ts` | Server action -> create_tenant RPC | ✓ VERIFIED | `rpc('create_tenant')` at line 86, authenticated client, schema-validated first |
| `src/app/(console)/page.tsx` | Live client list | ✓ VERIFIED | Real `.from('tenants')` query — FLOWING, no static data |
| `scripts/verify-tracer.mjs` | 5-step end-to-end tracer | ✓ VERIFIED | 146 lines, present and substantive |
| `tests/tenant-create.test.ts` | ONB-01 integration tests | ✓ VERIFIED | 5 tests passed in this run |
| `vitest.config.mts` | Vitest 4 config | ✓ VERIFIED | Renamed .ts -> .mts (documented deviation); alias resolution added |
| `src/core/shared/tenant.ts` | tenantCreateSchema authority | ✓ VERIFIED | Contains tenantCreateSchema; framework-free; explicit "Deliberately absent: any default contact-hours window" |
| `src/app/(console)/clients/[id]/page.tsx` | RLS-enforced detail page | ✓ VERIFIED | UUID guard, notFound(), live query |
| `tests/tenant-validation.test.ts` | Unit test per rejection rule | ✓ VERIFIED | 42 tests passed |
| `src/db/repository/for-tenant.ts` | forTenant() closure, exports ["forTenant"] | ✓ VERIFIED | tenantId closed over; no method takes a tenantId; UUID + empty-patch guards |
| `src/db/repository/client.ts` | Module-private drizzle client | ✓ VERIFIED | Not re-exported by barrel (index.ts exports forTenant + closeDb only) |
| `tests/leak.test.ts` | Two-halves leak test | ✓ VERIFIED | 9 assertions passed |
| `tests/rls-coverage.test.ts` | RLS-everywhere assertion | ✓ VERIFIED | 2 tests passed (incl. non-vacuity guard) |
| `.github/workflows/ci.yml` | typecheck -> supabase start -> migrate -> vitest + secret scans | ✓ VERIFIED | All steps present; latest run success |
| `.env.example` (plan 01-02 files list) | Env template | ⚠️ NOT PRODUCED | Blocked by workspace `.env*` write-deny; full contract stands in docs/env-vars.md; operator action carried forward (documented deviation, not a frontmatter must-have) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| clients/new/actions.ts | create_tenant migration fn | `supabase.rpc('create_tenant', ...)` | ✓ WIRED | actions.ts:86 (gsd-tools regex-escape false negative; confirmed by grep) |
| proxy.ts | src/lib/supabase/proxy.ts | updateSession(request) | ✓ WIRED | Tool-verified |
| src/db/schema/tenants.ts | src/db/migrations | drizzle-kit generated DDL | ✓ WIRED | 0001 contains both CREATE POLICY statements + ENABLE RLS matching the schema pgPolicies (directory target — manual check) |
| clients/new/actions.ts | src/core/shared/tenant.ts | tenantCreateSchema parse before RPC | ✓ WIRED | Tool-verified |
| (console)/page.tsx | clients/[id]/page.tsx | list rows link /clients/{id} | ✓ WIRED | page.tsx:64 `<Link href={\`/clients/${tenant.id}\`}>` (route-file target — manual check) |
| tests/leak.test.ts | src/db/repository/for-tenant.ts | imports forTenant, asserts zero B-leakage | ✓ WIRED | leak.test.ts:24 import; used at lines 101/113/114+ (tool pattern-escape false negative) |
| eslint.config.mjs | src/db/repository/client.ts | no-restricted-imports ban | ✓ WIRED | Ban patterns at lines 11-14, rule at 39, repository off-switch at 57; proven firing by lint-ban tests |
| .github/workflows/ci.yml | src/db/migrations | `npx drizzle-kit migrate` before tests | ✓ WIRED | ci.yml:105 (directory target — manual check) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| (console)/page.tsx | tenants rows | Authenticated `.from('tenants').select().order()` | Yes (RLS-scoped live query) | ✓ FLOWING |
| clients/[id]/page.tsx | tenant profile | Authenticated `.from('tenants')` by id | Yes | ✓ FLOWING |
| clients/new/form.tsx | field defaults | `state.values` (empty on first render; repopulated from action state) | Yes — deliberately empty initially (prohibition) | ✓ FLOWING |
| for-tenant.ts | tenant.get()/update() | drizzle select/update with `eq(tenants.id, tenantId)` closure predicate | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Typecheck clean | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Full suite (single run) | `npx vitest run` | 6 files, 69/69 passed in 3.66s against the live project; suites self-clean | ✓ PASS |
| Unauthenticated console gating | `next start` (existing build) + curl `/`, `/clients/new`, `/login` | 307 -> /login, 307 -> /login, 200 | ✓ PASS |
| CI conclusion | `gh run list --limit 3` | success (15fe670), success (b1f3aec) | ✓ PASS |
| All 11 documented task commits exist | `git cat-file -t` per hash | 11/11 OK | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist or are declared by any plan; the phase's runnable verification is `scripts/verify-tracer.mjs` + the Vitest suites, both exercised above. SKIPPED (no probes declared).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| ONB-01 | 01-02, 01-03 | Operator creates client with profile, trade, timezone, contact-hours | ✓ SATISFIED | Truths 1-2, 4, 8-12; 47 ONB-01-relevant assertions passing; edges closed (idempotency, adjacency start==end, empty) |
| ONB-05 | 01-02, 01-04 | Tenant-scoped data access: RLS everywhere + forTenant() + CI leak tests | ✓ SATISFIED | Truths 3, 13-18; three independent controls (closure, lint ban, leak test) all evidenced; CI-blocking |
| ONB-02 | 01-01 (clock-start only) | ServiceM8 connection — Phase 2 requirement | ✓ CORRECTLY NOT CLAIMED | Plan frontmatter note + SUMMARY `requirements-completed: []`; only the approval clock started; fallback bridges Phase 2 |
| MSG-01 | 01-01 (clock-start only) | AU number SMS — Phase 4 requirement | ✓ CORRECTLY NOT CLAIMED | Same; now carries the documented IPND-address blocker for Phase 4 planning |

**Orphan check:** REQUIREMENTS.md maps exactly ONB-01 and ONB-05 to Phase 1; both are claimed by plans and satisfied. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| tests/tenant-validation.test.ts | 326 | word "placeholder" in a test name for display-helper fallback strings | ℹ️ Info | Not a stub — a named unit test for formatContactDays/Time empty-input output |

No TBD/FIXME/XXX/TODO/HACK markers anywhere in src/, tests/, or scripts/. No tracked `.env*` files. No `SERVICE_ROLE` reference under src/app/. `getSession` appears only in comments explaining why it is not trusted.

### Prohibition Checks

| Prohibition | Tier | Status | Evidence |
| ----------- | ---- | ------ | -------- |
| 01-03 / ONB-01 (values): MUST NOT default/coerce contact-hours to an always-on window | test-enforced | ✓ RESOLVED | All contact-hours/days defaults in clients/new read from `state.values` (empty on first render); tenant.ts documents "Deliberately absent: any default contact-hours window"; unit test "rejects a missing start or end" passed. The only prefill is timezone (Australia/Perth), which the plan explicitly mandates |
| 01-02 / ONB-01 (privacy): MUST NOT store tenant data in a non-AU Supabase region | judgment | ⚠️ UNVERIFIED-PROHIBITION — human review required | Pooler hostname evidence (aws-0-ap-southeast-2) in docs/env-vars.md is strong but not authoritative; dashboard confirmation is the resolution path. Routed to human verification, never silently passed |

### Human Verification Required

#### 1. Phone UAT — create-client flow end to end

**Test:** On your phone: log in at /login, create a real client via /clients/new, confirm it appears in the list, open it from the list, and visit /clients/{garbage-uuid}.
**Expected:** Flow is phone-usable; detail page renders name, trade, timezone, day-named contact-hours window, escalation phone, status, created date; garbage uuid 404s.
**Why human:** Visual layout/tap targets/rendered correctness on a real device (deferred human-checks from plans 01-02 and 01-03).

#### 2. Empty state

**Test:** View the client list with zero tenants (fresh project or post-cleanup).
**Expected:** "No clients yet" + link to /clients/new, not an empty table.
**Why human:** Branch cannot be exercised without emptying live data.

#### 3. Input preservation on rejection (behavior-unverified truth)

**Test:** Submit /clients/new with start time ≥ end time.
**Expected:** Inline field error; every typed value still populated.
**Why human:** React 19 useActionState repopulation is DOM behavior no test in this project exercises.

#### 4. Supabase region attestation (flagged prohibition)

**Test:** Supabase Dashboard -> Project Settings -> confirm region.
**Expected:** ap-southeast-2 (Sydney).
**Why human:** Only the dashboard is authoritative; AU residency is a committed sales claim.

#### 5. ServiceM8 App ID follow-up (backstop truth, partial from 01-01)

**Test:** ServiceM8 Account -> Developer: confirm the Public Application exists; record the App ID in docs/external-registrations.md.
**Expected:** App ID recorded (non-secret); App Secret stays in the secret store.
**Why human:** Vendor dashboard state has no automated probe; the log carries an explicit placeholder with a 2026-08-26 next-check.

### Gaps Summary

No blocking gaps. The phase goal is achieved in the codebase to the limit of automated verification: the multi-tenant foundation exists and is proven by mechanisms (RLS from migration 001, membership-lookup policies, transactional create_tenant, forTenant() closure, ESLint ban with firing proof, two-tenant leak test, green CI on a fresh migration-built database — 69/69 tests re-run and passing during this verification, plus a live route-gating spot-check).

Two items prevent a clean `passed`:

1. **Five human-verification items** (phone UAT, empty state, input preservation, region attestation, ServiceM8 App ID) — all deliberate plan deferrals or vendor-side state, none evidencing a defect.
2. **One deferred external item:** the ClickSend AU number order is blocked on an IPND-format AU street address (which also gates the Twilio fallback). This is documented, calendared (2026-09-01), escalated to STATE.md, and owned by Phase 4 (MSG-01). SC4's substance — both clocks started with fallbacks documented — is evidenced by docs/external-registrations.md.

Carry-forward for the operator (also in the log): secure an IPND-acceptable AU business address by 2026-09-01, and create `.env.example` from docs/env-vars.md (the verifier and executor are both denied `.env*` writes).

---

_Verified: 2026-08-25T11:29:32Z_
_Verifier: Claude (gsd-verifier)_


---
*Human verification completed 2026-08-26: all 5 items passed (operator attestation via UAT — see 01-UAT.md). AU-region prohibition RESOLVED: dashboard confirms ap-southeast-2.*
