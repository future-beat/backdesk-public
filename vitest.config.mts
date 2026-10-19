import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors the `@/*` -> `./src/*` mapping in tsconfig.json. Declared by hand
  // rather than via vite-tsconfig-paths: one more unaudited dependency is not
  // worth saving three lines.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/env.ts'],
    // Runs ONCE per run (not per file): on a sanctioned remote run it pauses
    // the two production pg_cron tick jobs — whose deployed handlers run the
    // cadence engine against this same database, and were consuming
    // test-emitted events mid-suite — and sweeps stale stamped seed rows left
    // by interrupted runs. No-op for pure runs and local stacks. See the file
    // header for the full story.
    globalSetup: ['tests/helpers/global-setup.ts'],
    // These suites talk to hosted Supabase in Sydney over the public internet;
    // the default 5s timeout is not enough for a cold connection.
    testTimeout: 30000,
    hookTimeout: 30000,
    // WR-05: every suite shares ONE operator account and ONE database, so
    // vitest's default file-level parallelism produced two genuine races:
    //
    //  1. Duplicate operator creation. Two suites each ran check-then-create in
    //     beforeAll; on a fresh CI database both saw "no such user", both called
    //     createUser, and the loser threw "email address already registered" —
    //     failing an entire CI-blocking suite on a TOCTOU.
    //  2. An unstable set-equality assertion. leak.test.ts reads `tenants` and
    //     `tenant_members` in two round-trips and asserts the sets match, while
    //     tenant-create.test.ts concurrently commits and deletes tenants. A
    //     commit landing between the two reads reddens the leak test for a
    //     reason that has nothing to do with isolation.
    //
    // A blocking gate that fails for reasons unrelated to the property under
    // test gets re-run until green, which is how a real red eventually gets
    // waved through. Serialising costs a few seconds at this suite size.
    fileParallelism: false,
  },
});
