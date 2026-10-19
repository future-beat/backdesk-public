/**
 * The allowlist that `is_operator()` reads — the RLS gate for every table that
 * has no `tenant_id` to gate on.
 *
 * THE PROBLEM THIS SOLVES. `has_tenant_access(tenant_id)` is the whole isolation
 * story for tenant-scoped tables, and it does not apply to a table like
 * `event_consumer_cursors` (one cadence engine reading every client's events) or
 * the Phase 2 prospect tables (a business that is not a client yet, so there is
 * no tenant). The tempting shortcut is
 *
 *     CREATE POLICY ... FOR ALL TO authenticated USING (true)
 *
 * which is RLS in name only — `rowsecurity = true`, every row visible to every
 * authenticated caller. `tests/rls-coverage.test.ts` fails any policy whose
 * qual is a literal `true` for exactly this reason.
 *
 * WHY AN ALLOWLIST TABLE RATHER THAN "IS A MEMBER OF ANY TENANT". The obvious
 * alternative is `EXISTS (SELECT 1 FROM tenant_members WHERE user_id =
 * auth.uid())` — today that set is {the founder}, so the two behave identically
 * and it needs no new table. It is the wrong choice because of what happens
 * NEXT: the v2 reports portal gives CLIENTS logins, and a client login is a
 * tenant_members row. On that day, every client would silently satisfy
 * `is_operator()` and gain read access to the consumer cursors and to every
 * prospect record — a list of the founder's sales pipeline, handed to the
 * customers in it, by a schema change made in a different phase for an unrelated
 * reason (RESEARCH Pattern 6).
 *
 * An explicit allowlist cannot be satisfied by accident. Enrolment is a
 * deliberate act: `node scripts/grant-operator.mjs`.
 *
 * NO FK TO `auth.users`. Supabase owns that schema; a cross-schema reference
 * from a drizzle-managed table couples our migration journal to theirs, and the
 * value is a uuid that `auth.uid()` returns either way. An id for a deleted user
 * simply matches nothing.
 */
import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const operatorAllowlist = pgTable(
  'operator_allowlist',
  {
    /** An `auth.users.id`. See the header for why this is not a foreign key. */
    userId: uuid('user_id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    /**
     * Self-referential on purpose: an operator may see the allowlist, and
     * nobody else may. It does not recurse, because `is_operator()` is
     * SECURITY DEFINER and runs as the table's owner, for whom RLS is not
     * enforced — the same mechanism that lets `has_tenant_access()` read
     * `tenant_members` from inside a policy on `tenant_members`.
     *
     * Note there is no INSERT path for `authenticated` regardless of this
     * WITH CHECK: the grants in the migration withhold INSERT entirely, so
     * self-enrolment is impossible even for someone already on the list.
     */
    pgPolicy('operator_allowlist_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type OperatorAllowlistEntry = typeof operatorAllowlist.$inferSelect;
