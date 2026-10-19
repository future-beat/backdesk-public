---
quick_id: 260830-imj
slug: add-app-base-url-dummy-to-ci-test-env-fi
created: 2026-08-30T00:00:00.000Z
status: planned
---

# Quick Task: Add APP_BASE_URL dummy to the CI test env

## Root cause (diagnosed this session, confirmed against source)

CI run 33293181162 failed on exactly one test — `tests/routing-dispatch.test.ts:185`
"arms the REAL email delegate from one tenant row, with the global row off"
(`expected 'stub' to be 'resend'`). The chain:

- `chooseEmailSender` (src/core/messaging/resend-sender.ts:441-443) returns the
  stub fallback when any of `apiKey`, `appBaseUrl`, `signingSecret` is missing:
  `if (!apiKey || !appBaseUrl || !signingSecret) return fallback;`
- CI's stack-env export block (.github/workflows/ci.yml lines 128-159) sets
  dummies for `RESEND_API_KEY` and `UNSUBSCRIBE_SIGNING_SECRET` (plus the other
  Phase 4 bearers) but never `APP_BASE_URL`.
- `APP_BASE_URL` is `z.url().optional()` in serverEnvSchema
  (src/core/shared/env.ts:156), so the `tests/helpers/env.ts` gate cannot fail
  loudly on its absence — the test just gets the stub where it armed Resend.
- The test passed on the dev machine because `.env.local` sets `APP_BASE_URL`.

This is deliberate refusal behaviour working as designed (04-05: ResendSender
REFUSES rather than degrades on a missing APP_BASE_URL — a localhost unsubscribe
link in a customer inbox is a Spam Act breach every test would pass). The fix is
in CI's env, not in the sender or the test.

## Tasks

1. **`.github/workflows/ci.yml`** — in the "Export local stack environment"
   step's `{ ... } >> "$GITHUB_ENV"` block, add
   `echo "APP_BASE_URL=https://ci.invalid"` alongside the other dummies
   (natural home: with the `RESEND_API_KEY` / `UNSUBSCRIBE_SIGNING_SECRET`
   material, since all three feed `chooseEmailSender`'s arming check — but
   anywhere inside the block before the closing `} >> "$GITHUB_ENV"` is
   correct). Carry a short comment in the block's established voice explaining:
   - why it exists: `chooseEmailSender` refuses to arm the real email delegate
     without a base URL (unsubscribe links must never point at localhost), so
     `tests/routing-dispatch.test.ts` needs it to prove the CR-01 fix;
   - why absence was silent: the variable is `optional()` in serverEnvSchema,
     so the tests/helpers/env.ts gate cannot catch it;
   - why fake is safe: it must merely satisfy `z.url()`; no suite sends email
     (the Resend HTTP path is never reached from tests), and the reserved
     `.invalid` TLD is unreachable by definition — same rationale as the
     neighbouring `alerts@ci.invalid`.

   Value MUST be a full `https://` URL (schema is `z.url()`, not a hostname).
   Do not touch env.ts, the sender, or the test.

## Verification

- `grep -n 'APP_BASE_URL=https://ci.invalid' .github/workflows/ci.yml` — exactly
  one hit, inside the export block (i.e. between `supabase status -o env` and
  `} >> "$GITHUB_ENV"`).
- `npx tsc --noEmit` unaffected (workflow-only change) — skip; instead sanity-
  parse the YAML: `node -e "require('js-yaml')" 2>/dev/null` is not installed,
  so use `npx --no-install prettier --check .github/workflows/ci.yml || true`
  only if trivially available; otherwise rely on the grep plus visual diff —
  the change is one echo line and a comment inside an existing shell block, so
  YAML structure is untouched.
- Local proof of mechanism (optional, only if a local Supabase stack is
  running — `tests/routing-dispatch.test.ts` is an integration suite that
  refuses on non-local stacks; on this Docker-less dev machine SKIP this and
  rely on the grep): `APP_BASE_URL= npx vitest run tests/routing-dispatch.test.ts`
  reproduces the CI failure; with `APP_BASE_URL=https://ci.invalid` it passes.
- **Authoritative proof is the next CI run** — the orchestrator watches it after
  push. Expected: the "Test suite" step goes green, specifically the previously
  failing "arms the REAL email delegate…" test.

## Done criteria

- ci.yml exports `APP_BASE_URL=https://ci.invalid` into `$GITHUB_ENV` in the
  same block as the other dummy credentials, with a comment explaining the
  refusal-not-degrade rationale and why the dummy is safe.
- No source, test, or schema file changed.
- Next CI run on the pushed commit passes the full test suite.
