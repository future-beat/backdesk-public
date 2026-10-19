# Deferred items — Phase 02

Out-of-scope discoveries logged during execution. Not fixed, deliberately.

## `npm audit`: 4 moderate advisories via `drizzle-kit`

**Found during:** 02-04 Task 2, immediately after `npm install resend@6.22.1`.

**Not caused by this plan.** The chain is
`drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild <=0.24.2`
(GHSA-67mh-4wv8-2f99: a dev-server request-forgery issue). `resend` contributes
nothing to it — the same four advisories were present before the install and are
reachable only through a **devDependency** used to generate migrations.

**Why it is not fixed here:** `npm audit fix --force` resolves it by installing
`drizzle-kit@0.18.1`, a major downgrade across the version this project's
migration workflow and journal format were built against. That is a migration-
tooling change with its own verification burden, and it belongs nowhere near a
plan about operator alerting.

**Trigger to revisit:** when drizzle-kit ships a release depending on a patched
esbuild, or before the first deployment that runs drizzle-kit anywhere other
than a developer machine.
