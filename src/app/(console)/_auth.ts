/**
 * The operator authorization check, factored out because the prospect/audit
 * actions all need exactly the same one and for exactly the same reason (CR-01).
 *
 * ── AUTHENTICATION IS NOT AUTHORIZATION ─────────────────────────────────────
 *
 * `getClaims()` proves a valid Supabase session exists. It proves nothing about
 * the operator allowlist. That distinction is invisible on the client actions,
 * which read a `tenants` row through RLS and let Postgres decide membership, and
 * it was missing entirely on the prospect actions — which then wrote through
 * `getDb()`, the service-role path, where RLS is inert by design and the
 * withheld `authenticated` INSERT grant on `prospects` never applies because the
 * write is not made as `authenticated`.
 *
 * The consequence was specific rather than theoretical: `convertProspectAction`
 * is the only code path that clears `purge_after`, so any authenticated session
 * could cancel the D-04 retention policy on a stranger's customer PII — threat
 * T-2-07, which that action's own header says it exists to prevent.
 *
 * ── WHY A READ RATHER THAN A CLAIM ──────────────────────────────────────────
 *
 * The allowlist is a table, not a JWT claim, so the only way to ask Postgres
 * "is this user an operator" is to make Postgres answer it. `operator_allowlist`
 * carries `GRANT SELECT ... TO authenticated` (0011) and exactly one policy —
 * `FOR ALL TO authenticated USING (is_operator())` (0010) — so this read returns
 * the caller's own row for an operator and ZERO ROWS, not an error, for anyone
 * else. Denial and absence are indistinguishable to the caller, which is the
 * same property the grants elsewhere in the schema are chosen for.
 *
 * Read through the operator's OWN JWT (`createClient()` is anon-key + cookie
 * session, never service-role) — that is what makes the policy load-bearing here
 * instead of decorative.
 */
import { createClient } from '@/lib/supabase/server';

/**
 * The three outcomes, kept distinct because the callers render them
 * differently: an expired session is fixed by signing in again, and a
 * non-operator session is not fixed by anything the operator can do.
 */
export type OperatorCheck = 'ok' | 'unauthenticated' | 'forbidden';

/**
 * Prove the caller is an operator, not merely signed in.
 *
 * Call it FIRST in every prospect-mutating action — before the body is read,
 * matching the existing auth-first convention (WR-01): Server Action ids are
 * global, so these actions are POSTable at any route including ones the proxy
 * never sees, and the `(console)` layout's gate runs only when a layout renders,
 * which is after the action has already finished.
 */
export async function requireOperator(): Promise<OperatorCheck> {
  // ONE ALLOWLIST READ IN THIS MODULE, and it lives below. A second copy here
  // would be the drift this file was extracted to prevent, one function apart.
  const operator = await requireOperatorId();
  return operator.ok ? 'ok' : operator.reason;
}

/**
 * The same check, KEEPING THE USER ID it read.
 *
 * `requireOperator()` discards the `sub` because none of the prospect/audit
 * actions had anything to record it against. The Phase 10 arming actions do:
 * every arm and disarm writes a `messaging_config_audit` row whose
 * `operator_user_id` is NOT NULL, and the only trustworthy source for it is the
 * claim this function already read and verified against the allowlist. A form
 * field would be the caller's, which on an action whose id is global means the
 * attacker's.
 *
 * SAME RULES, VERBATIM: read through the operator's OWN JWT, and a read error is
 * denial rather than a pass.
 */
export async function requireOperatorId(): Promise<
  { ok: true; userId: string } | { ok: false; reason: 'unauthenticated' | 'forbidden' }
> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const allowed = await readAllowlist(supabase, userId);
  if (allowed !== 'ok') return { ok: false, reason: allowed };

  return { ok: true, userId };
}

/**
 * THE ALLOWLIST READ ITSELF — the one statement both exports above rest on.
 *
 * `operator_allowlist` carries `GRANT SELECT ... TO authenticated` (0011) and
 * one policy, `FOR ALL TO authenticated USING (is_operator())` (0010), so this
 * returns the caller's own row for an operator and ZERO ROWS — not an error —
 * for anyone else.
 */
async function readAllowlist(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<'ok' | 'forbidden'> {
  const { data, error } = await supabase
    .from('operator_allowlist')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  // A read error is treated as denial rather than as a pass. The failure modes
  // here (policy changed, grant revoked, database unreachable) are all states in
  // which "let the write through" is the wrong default for the one table that
  // holds a stranger's customer data — and, since Phase 10, for the one row that
  // arms real customer messaging.
  if (error || !data) return 'forbidden';

  return 'ok';
}

/**
 * The copy for a failed check.
 *
 * `forbidden` deliberately does NOT say "you are not an operator". The message
 * is the same shape the rest of the console uses for a resource the caller may
 * not see, so the response is not a membership oracle for the allowlist.
 */
export const OPERATOR_DENIED_MESSAGE: Readonly<Record<'unauthenticated' | 'forbidden', string>> = {
  unauthenticated: 'Your session has expired. Sign in again.',
  forbidden: 'You do not have access to audits.',
};
