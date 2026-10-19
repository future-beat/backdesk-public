/**
 * The raw database client — MODULE-PRIVATE TO `src/db/repository/`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IMPORT BAN. Do not import this file from anywhere outside                │
 * │ `src/db/repository/**`. ESLint enforces it (`no-restricted-imports` in   │
 * │ eslint.config.mjs) and `tests/lint-ban.test.ts` proves the rule fires.   │
 * │                                                                          │
 * │ Use `forTenant(tenantId)` from `@/db/repository` instead.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Why (ONB-05, 01-RESEARCH.md Pattern 3): this connection uses `DATABASE_URL`,
 * which is a service-role-equivalent Postgres login. It BYPASSES RLS by design,
 * so every policy written in `src/db/schema` is inert on this path. The only
 * thing standing between a worker and another tenant's rows is the closure in
 * `for-tenant.ts` — a single query written against this client directly, with a
 * forgotten `where`, is a cross-tenant data leak.
 *
 * Connection notes:
 * - Transaction pooler (port 6543). `prepare: false` is mandatory — transaction
 *   mode does not support prepared statements.
 * - `max: 5` IS A CEILING ON CONCURRENCY, NOT A HINT (found in 07-05). A caller
 *   that issues MORE simultaneous queries than there are connections deadlocks:
 *   postgres.js pipelines the overflow onto connections PgBouncer has already
 *   handed to another transaction, and those queries never return — the first
 *   burst succeeds and every later one hangs until the statement timeout fires.
 *   It is not a slow query and it does not look like a pool problem; it looks
 *   like the database stopped answering. Keep `Promise.all` batches of
 *   repository reads well under this number, remembering that the pool is shared
 *   with every other request this instance is serving, or run them in sequence.
 * - Created lazily so that merely importing the repository (a build, a typecheck,
 *   a unit test) never demands database credentials or opens a socket.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { getServerEnv } from '@/core/shared/env';
import * as schema from '@/db/schema';

export type RepositoryDb = PostgresJsDatabase<typeof schema>;

let sql: Sql | undefined;
let db: RepositoryDb | undefined;

/**
 * The drizzle handle. Internal to this directory — see the import ban above.
 */
export function getDb(): RepositoryDb {
  if (db) return db;

  const { DATABASE_URL } = getServerEnv();

  if (new URL(DATABASE_URL).port === '5432') {
    // Not fatal, but worth saying out loud: 5432 is the session pooler, reserved
    // for migrations. Runtime queries belong on 6543 (see docs/env-vars.md).
    console.warn(
      'DATABASE_URL points at port 5432 (session pooler). Runtime queries should ' +
        'use the transaction pooler on 6543.',
    );
  }

  sql = postgres(DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,
  });
  db = drizzle(sql, { schema });
  return db;
}

/**
 * Close the pool. Needed by test suites and one-shot scripts — an open
 * postgres.js pool keeps the Node event loop alive.
 */
export async function closeDb(): Promise<void> {
  const open = sql;
  sql = undefined;
  db = undefined;
  if (open) await open.end({ timeout: 5 });
}
