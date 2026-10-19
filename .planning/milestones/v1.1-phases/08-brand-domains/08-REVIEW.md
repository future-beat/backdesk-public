---
phase: 08-brand-domains
reviewed: 2026-09-08T10:15:52Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - src/core/brand.ts
  - src/app/login/page.tsx
  - src/app/layout.tsx
  - src/app/(console)/layout.tsx
  - src/app/(console)/audits/[id]/page.tsx
  - src/app/(console)/reports/[client]/[reportId]/page.tsx
  - src/app/(console)/settings/email/forms.tsx
  - src/app/api/unsubscribe/route.ts
  - src/core/alerts/operator-email.ts
  - src/core/alerts/stalled-drafts.ts
  - src/core/audit/constants.ts
  - src/core/messaging/clicksend-client.ts
  - src/core/messaging/resend-sender.ts
  - scripts/cron-status.mjs
  - scripts/push-vercel-env.mjs
  - scripts/verify-email-pipe.mjs
  - supabase/config.toml
  - package.json
  - tests/brand.test.ts
  - tests/audit-aggregate.test.ts
  - tests/clicksend-sender.test.ts
  - tests/resend-sender.test.ts
findings:
  critical: 1
  warning: 3
  info: 7
  total: 11
fixed: 4
fixed_at: 2026-09-08T10:27:00Z
fix_scope: critical + warning
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-09-08T10:15:52Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found — CR-01, WR-01, WR-02 and WR-03 fixed; the seven Info findings are untouched and remain open.

## Fixes applied (2026-09-08)

| Finding | Commit | Files |
|---------|--------|-------|
| CR-01 | `4d717bc` | `scripts/cron-status.mjs`, `scripts/apply-cron-schedules.mjs` |
| WR-01 | `950a13e` | `src/core/messaging/resend-sender.ts`, `tests/resend-sender.test.ts` |
| WR-02 | `4256c12` | `tests/cron-status-script.test.ts` (new) |
| WR-03 | `fda7820` | `tests/brand.test.ts`, `tests/audit-aggregate.test.ts` |

Scope was Critical + Warning only. IN-01 through IN-07 were deliberately left
in place. One deviation from the suggested fix is recorded under WR-01.

## Summary

Phase 8 replaced every "Quote Recovery" literal under `src/` with imports from a new import-free `src/core/brand.ts`, moved the alert-from default into that module, added a read-only pg_cron read-back script, and relabelled scripts and config for the Vercel project rename. The rename fan-out itself is correct: every console and print surface imports `SERVICE_NAME`, the unsubscribe footer is built once at module scope from a constant argument (byte-identical across GETs, confirmed by reading the route), the `displayName()` sanitiser in `resend-sender.ts` is still called before `viaDisplayName()` and the injection pin in `tests/resend-sender.test.ts` keeps its stripped prefix byte-identical, `OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM` resolves correctly in both alert modules, and the title template composes from the same constant as the default. No legacy literal survives under `src/` (verified by grep, comments included).

Three things did not hold up under adversarial reading:

1. **`scripts/cron-status.mjs` has one error path that prints the full database connection string.** The script's whole reason for existing is "an answer that contains no credential", and it keeps that promise on every path except the port check at line 59, which calls `new URL(url)` outside any `try`. Node 22 prints an uncaught `ERR_INVALID_URL` with an `input:` property carrying the exact string — password included. Reproduced locally with a fake credential. Critical.
2. **A business name made only of stripped characters produces an unidentified sender.** The upstream gate in `routing-sender.ts` rejects a blank name, but `<>`, `""` or `\` pass `trim() !== ''` and sanitise to the empty string, so the email goes out as `" via Backdesk"`, subject `Quote follow-up from `, footer `Sent by Backdesk on behalf of .` — the Spam Act identification the module header promises to refuse rather than degrade. Reproduced with the exact sanitiser regexes. Warning.
3. **The structural pins that the threat model cites as T-8-01/T-8-14 mitigations have loopholes** (`export … from`, `require(`, `import(`, `.replaceAll(`, `export async function`), and the new script has no source-level test at all, unlike its sibling `apply-cron-schedules.mjs`. Warnings.

The remaining items are quality: three brand exports with no production consumer, a pointless alias constant, a second spelling of the brand in a script that already registers a TS loader, one unescaped interpolation that its sibling escapes, a surrogate-pair split in the (pre-existing) 78-char cap, duplicated job-name lists, and a grep-as-test extension filter that skips the 32 `.sql` files under `src/`.

Deliberate choices recorded in CONTEXT/SUMMARIES were not flagged: no restyle (D-04), `package.json` name kept, DOM-03 badge check left pending, the `tests/inbound-threading.test.ts` fixture domain.

## Critical Issues

### CR-01: `cron-status.mjs` prints the full `MIGRATE_DATABASE_URL` (password included) when the value is malformed

**FIXED** — commit `4d717bc`. Both scripts now parse inside a `try` and fail with
a message naming the variable and `docs/env-vars.md`, never the value. Confirmed
against a fake malformed credential: the guard prints one line and exits 1, with
no stack and no `input:`. Pinned by the WR-02 suite, which was verified to fail
against the pre-fix source.

**File:** `scripts/cron-status.mjs:59`
**Issue:** The port check runs `new URL(url)` at top level, outside the `try` that guards everything else. If `MIGRATE_DATABASE_URL` is set but not a parseable URL (a stray character in the port, a pasted line with a trailing `\r`, a truncated copy), the constructor throws an uncaught `TypeError: Invalid URL`, and Node's default uncaught-exception printer dumps the error's enumerable properties — including `input`, which is the complete connection string. Reproduced on Node v22.20.0 with a fake credential:

```
TypeError: Invalid URL
    at new URL (node:internal/url:825:25)
    ... {
  code: 'ERR_INVALID_URL',
  input: 'postgresql://postgres.fakeref:FAKEPASSWORD123@aws-0.pooler.supabase.com:54x32/postgres'
}
```

This contradicts the file's own contract ("prints an answer that contains no credential", header lines 15–31) and the T-8-05 mitigation in `08-05-PLAN.md` ("`cron:status` prints origin+path only"). The output of this script is, by design, pasted into evidence logs. A malformed value is exactly the case an operator hits while editing the env file, which is when they run this script. The same pattern pre-exists at `scripts/apply-cron-schedules.mjs:143` — not introduced this phase, but the fix is identical and should be applied there in the same change.

**Fix:**
```js
// scripts/cron-status.mjs — replace line 59
let port;
try {
  port = new URL(url).port;
} catch {
  // NEVER echo the value: the thing that failed to parse is the connection string.
  fail('MIGRATE_DATABASE_URL is not a parseable URL — see docs/env-vars.md');
}
if (port === '6543') {
  fail(
    'MIGRATE_DATABASE_URL points at the transaction pooler (6543). ' +
      'Schedule reads need the session pooler (5432).',
  );
}
```
Add the same guard at `scripts/apply-cron-schedules.mjs:143`. Then pin it: a pure test (see WR-02) asserting the source contains no `new URL(url)` outside a `try`, or more simply that `fail(` appears with the "not a parseable URL" message.

## Warnings

### WR-01: A business name made only of stripped characters sends an unidentified email

**FIXED** — commit `950a13e`. `attempt()` now checks the SANITISED name and
refuses before any provider call; `tests/resend-sender.test.ts` covers `<>`,
`""`, a lone backslash, `<"">\` and a bare C0 control (all five fail without the
guard).

**Deviation from the suggested fix:** the reason is `unidentified_sender`, not
`email_not_configured`. The review's prose asked for "its own reason so the
ledger names the actual problem" while its snippet reused the generic one; the
distinct reason follows the rule the file already states beside the owner-only
check — this row IS configured, and reporting it as unconfigured sends an
operator to check settings that are fine. The reason string is free-form (the
ledger records only `failed`) and `clicksend-sender.ts` sets the precedent with
`recipient_opted_out`.

**Not done (the review's "optionally"):** the `routing-sender.ts` fallback still
tests the raw name, so a garbage `business_name` refuses rather than falling
back to `tenant.name`. Making it test the sanitised value requires exporting
`displayName` out of `resend-sender.ts` — spreading the header-injection control
across two modules, which is the thing T-8-01 and the brand-module pins exist to
prevent. Refusing is the safe outcome; the fallback is a separate design call.

**File:** `src/core/messaging/resend-sender.ts:224-239` (and `src/core/messaging/routing-sender.ts:228-233`)
**Issue:** `resolveEmailIdentity` refuses a name whose `trim()` is empty, but `displayName()` strips `"`, `<`, `>`, `\` and all C0 controls *after* that gate. A `business_name` of `<>`, `""`, `\\` or `<"">` — each accepted by the settings form's `z.string().trim().max(120)` — sanitises to `''`. Reproduced with the exact regexes from lines 180–185:

```
"<>"   => ""   from= "\" via Backdesk\" <x@y>"
"\"\"" => ""   from= "\" via Backdesk\" <x@y>"
```

The resulting message carries `From: " via Backdesk" <followups@…>`, `Subject: Quote follow-up from `, and the footer `Sent by Backdesk on behalf of .` — the tradie is not identified anywhere, which is the Spam Act sender-identification failure the file header says the send is "REFUSED rather than degraded" for. Phase 8 made `displayName()` the declared trust boundary for the brand builders (T-8-01) and added a test that `identityLine('')` is "total over strings"; that test documents the builders will not throw, but nothing upstream of them refuses the empty result. The tenant fallback in `routing-sender.ts:230` only fires when the *raw* name is blank, so a garbage `business_name` also suppresses the fallback to `tenant.name`.

**Fix:** Refuse in `attempt()` on the sanitised value, with its own reason so the ledger names the actual problem, and keep `buildEmailMessage` pure:
```ts
// resend-sender.ts, in attempt() after the owner-only check (line ~340)
if (displayName(identity.businessName) === '') {
  // The name survived the settings gate but nothing legible survives the
  // header sanitiser — a From of `" via Backdesk"` identifies nobody.
  return this.failed('email_not_configured', false);
}
```
Optionally tighten the source: in `routing-sender.ts` fall back to `tenant.name` when `displayName(row.businessName) === ''` rather than only when the raw string is blank (this requires exporting `displayName` or moving the predicate next to it). Add a test in `tests/resend-sender.test.ts`: a `resolveEmailConfig` returning `businessName: '<>'` must produce `email_not_configured` and call the client zero times.

### WR-02: `cron-status.mjs` has no source-level test; its "never prints a secret" contract is enforced by hand

**FIXED** — commit `4256c12`, new pure suite `tests/cron-status-script.test.ts`
(runs bare, no `ALLOW_REMOTE_TESTS`, no stack). Pins: the `command` column is
only ever read through the server-side `substring(...)`; URLs reduce to origin +
path; the script writes nothing; no hard-coded origin; the CR-01 guard; and the
job-name and watchdog-name lists agree with the files that own them (IN-06 in
the interim).

**Deviation:** the review's `SELECT[^;]*\bcommand\b(?![^;]*substring)` lookahead
matches this file's legitimate `substring(command from ...)` and would have
failed on green code. Replaced with a count equality — every `command` mention
is a guarded one — which states the same rule and cannot pass vacuously.

**File:** `scripts/cron-status.mjs` (whole file); `tests/cron-schedules.test.ts:356-400`
**Issue:** `apply-cron-schedules.mjs` is pinned by `describe('the committed script itself')` — no hard-coded origin, no `console.log(...command)`, one `cron.schedule(` call. The new sibling script, which prints *more* rows from `cron.job` than the apply script does, has no equivalent. The 08-05 summary records this as deferred because `cron-schedules.test.ts` reads `testEnv.migrateDatabaseUrl` at module scope and needs a database. That reasoning does not apply to a `readFileSync` assertion: it needs no stack and can live in a pure suite. CR-01 is exactly the class of regression such a pin would have caught if written as "every `new URL(` call on the env value is inside a `try`". The script also duplicates `JOB_NAMES` (from `apply-cron-schedules.mjs:71-125`) and `WATCHDOG_JOB` (from `tests/helpers/global-setup.ts:107`); a rename in either owner makes this script print `MISSING` for a job that exists, with no test to say so.

**Fix:** Add a pure `tests/cron-status-script.test.ts` (runs bare, no `ALLOW_REMOTE_TESTS`):
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync('scripts/cron-status.mjs', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('scripts/cron-status.mjs — read-only and credential-free by construction', () => {
  it('never selects or prints the command column', () => {
    expect(CODE).not.toMatch(/SELECT[^;]*\bcommand\b(?![^;]*substring)/i);
    expect(CODE).not.toMatch(/console\.(log|error)\([^)]*command/);
  });
  it('writes nothing', () => {
    expect(CODE).not.toMatch(/cron\.(schedule|unschedule|alter_job)|\b(INSERT|UPDATE|DELETE)\b/i);
  });
  it('contains no hard-coded origin', () => {
    expect(CODE.match(/https?:\/\/[a-z0-9]/gi) ?? []).toEqual([]);
  });
  it('names the same jobs the apply script owns', () => {
    const apply = readFileSync('scripts/apply-cron-schedules.mjs', 'utf8');
    for (const name of ['sm8-sync-tick', 'cadence-tick', 'messaging-reconcile', 'stalled-digest']) {
      expect(apply).toContain(`name: '${name}'`);
      expect(SOURCE).toContain(`'${name}'`);
    }
  });
});
```
After CR-01 is fixed, add `expect(CODE).not.toMatch(/^\s*if \(new URL\(url\)/m)`.

### WR-03: The structural pins on `brand.ts` have loopholes the threat model does not account for

**FIXED** — commit `fda7820`. All three assertions now strip comments first,
match every export keyword, forbid `export {` / `export default`, catch
`export … from`, `import(`, `require(`, and cover `.replaceAll(` / `.split(` /
`.normalize(`. Applied identically to `tests/audit-aggregate.test.ts`. Verified
by injecting `export * from`, `export class` and `.replaceAll(` into
`src/core/brand.ts`: all three fail, where the old assertions passed.

**File:** `tests/brand.test.ts:96-130`
**Issue:** `08-01-PLAN.md` and `08-02-PLAN.md` cite these three tests as the T-8-01 mitigation ("asserts the module has no imports so no second sanitiser can be smuggled in") and the T-8-14 analogue. Each has a hole:
- Import-freedom (`/^import /m`, line 120) does not match `export { x } from './y'`, `export * from './y'`, dynamic `import('…')`, or `require('…')` — all of which add a dependency to the module.
- No-sanitiser (`/\.replace\(/`, line 129) does not match `.replaceAll(`, `.split(...).join(`, `.normalize(`, or a regex `.test()`-driven rewrite.
- Export count (`/export (?:const|function) (\w+)/g`, line 100) does not match `export async function`, `export class`, `export enum`, `export let`, or `export { a, b }` — so "exactly nine exports" is "exactly nine exports of two syntactic shapes".

These are the same patterns `tests/audit-aggregate.test.ts` uses, so the weakness is inherited, but Phase 8 is the phase that promoted them to a named STRIDE mitigation.

**Fix:**
```ts
// brand.test.ts
const source = readFileSync('src/core/brand.ts', 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// no imports of any shape
expect(code).not.toMatch(/^\s*import\b/m);
expect(code).not.toMatch(/^\s*export\b[^\n]*\bfrom\b/m);
expect(code).not.toMatch(/\b(require|import)\s*\(/);

// no sanitiser of any shape
expect(code).not.toMatch(/\.(replace|replaceAll|normalize|split)\s*\(/);

// every export syntax
const exported = [...code.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class|enum)\s+(\w+)/gm)]
  .map((m) => m[1]).sort();
expect(code).not.toMatch(/^export\s*\{/m);   // no re-export lists
expect(code).not.toMatch(/^export\s+default\b/m);
```
Apply the same tightening to `tests/audit-aggregate.test.ts` in the same change so the two pins stay parallel.

## Info

_None of the Info findings were in the fix scope; all seven remain open._

### IN-01: Unsubscribe footer interpolates `identityLine()` unescaped while the email builder escapes the same line

**File:** `src/app/api/unsubscribe/route.ts:95`
**Issue:** `resend-sender.ts:245` wraps `identityLine(business)` in `escapeHtml()`; the unsubscribe route interpolates it raw into markup. Harmless today (the argument is a constant with no HTML-special characters and `SERVICE_NAME` is `Backdesk`), but the two surfaces now share one builder and treat its output differently. A future brand string containing `&` would render as a bare ampersand on one page and `&amp;` in the other.
**Fix:** Either escape (`escapeHtml` is private to `resend-sender.ts`; a two-line local copy is fine here since the route imports nothing else from messaging) or add a comment stating the argument is a literal and the builder output is trusted markup-safe. Prefer escaping.

### IN-02: `SOURCE` is a pointless alias of `PROVIDER_SOURCE_TAG`

**File:** `src/core/messaging/clicksend-client.ts:59`
**Issue:** `const SOURCE = PROVIDER_SOURCE_TAG;` renames the import for no gain; the JSDoc above it still describes it as if it were the literal.
**Fix:** Delete the alias and use `PROVIDER_SOURCE_TAG` at the one call site; move the JSDoc to `brand.ts` (it already has an equivalent).

### IN-03: `verify-email-pipe.mjs` carries a second spelling of the brand

**File:** `scripts/verify-email-pipe.mjs:97`
**Issue:** `'This is a Backdesk pipeline test…'` is a hard-coded brand literal outside `src/`. The script already calls `register()` from `node:module` (line 49) to load TS, and imports `buildEmailMessage` from the TS sender, so it can import `SERVICE_NAME` the same way. The grep-as-test provably never opens `scripts/`, so this is exactly the "file nobody re-greps" the test header warns about.
**Fix:** `const { SERVICE_NAME } = await import('../src/core/brand.ts');` (or the alias the script already uses for the sender) and build `PROOF_BODY` from it.

### IN-04: The 78-character cap can split a surrogate pair and put a lone surrogate in the From header

**File:** `src/core/messaging/resend-sender.ts:185`
**Issue:** `.slice(0, MAX_DISPLAY_NAME_CHARS)` counts UTF-16 code units. A 77-character name ending in an astral character (emoji, some CJK) is cut to `…\ud83d`, which `String.prototype.isWellFormed()` reports as `false`. Reproduced. That string is then JSON-serialised by the Resend SDK and lands in a header as U+FFFD or a rejected request, depending on the provider's decoder. Pre-existing (the cap predates this phase), but Phase 8 added the "non-ASCII trading name intact" encoding test and declared this function the trust boundary.
**Fix:** `Array.from(value).slice(0, MAX_DISPLAY_NAME_CHARS).join('')`, or `.slice(0, MAX).toWellFormed()` (Node 20+). Add a case to the encoding test.

### IN-05: Three brand exports have no consumer in `src/` or `scripts/`

**File:** `src/core/brand.ts:28,31,38`
**Issue:** `APEX_DOMAIN`, `CONSOLE_HOST`, `SENDING_DOMAIN` are exported and pinned by the nine-export test but imported only by `tests/brand.test.ts`. They are a second source of truth beside `APP_BASE_URL` (console host) and `messaging_config.from_address` (sending domain) with nothing tying the pairs together; `CONSOLE_HOST` and the env value can drift silently. D-01 asked for the domains to be exported, so this is a design consequence rather than an oversight, but it should either gain a consumer or be documented as reference-only.
**Fix:** Cheapest useful consumer: in a bare test that already mocks env, or in `operator-email.ts`'s `consoleBaseUrl()` fallback chain, assert/derive from `CONSOLE_HOST`. Otherwise add a one-line comment on each that they are documentation constants with no runtime reader, so a future reader does not go looking for one.

### IN-06: `cron-status.mjs` duplicates the job-name and watchdog-name lists

**File:** `scripts/cron-status.mjs:44,47`
**Issue:** `JOB_NAMES` restates the four names in `scripts/apply-cron-schedules.mjs:71-125` and `WATCHDOG_JOB` restates `tests/helpers/global-setup.ts:107`. A rename in either owner makes this script print `MISSING`/`no` for a job that exists.
**Fix:** Extract the four `{ name, path, schedule }` rows (without secrets) into `scripts/lib/cron-jobs.mjs` and import them from both scripts; export `WATCHDOG_JOB` from the same place and have `global-setup.ts` import it. Covered by the WR-02 test in the interim.

### IN-07: The grep-as-test skips `.sql`, `.json` and `.md` under `src/`

**File:** `tests/brand.test.ts:342`
**Issue:** The extension filter `/\.(tsx?|css|mjs)$/` excludes the 32 migration files under `src/db/migrations/` and any JSON/Markdown that may appear under `src/`. D-10's criterion is "grep for the legacy name in `src/`", not "in TypeScript under `src/`". A migration comment or seed row naming the old service would pass today. (A manual grep confirms none currently does.)
**Fix:** Widen to `/\.(tsx?|css|mjs|sql|json|md)$/` and, if any file is intentionally exempt, list it explicitly with a reason rather than by extension.

---

_Reviewed: 2026-09-08T10:15:52Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
