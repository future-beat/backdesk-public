/**
 * CR-01: every service-role prospect path proves OPERATOR status, not just a session.
 *
 * ── WHY THIS IS A SOURCE SCAN AND NOT A BEHAVIOURAL TEST ────────────────────
 *
 * The defect being pinned is an ABSENCE — an action that reads
 * `supabase.auth.getClaims()`, concludes "authorized", and then writes through
 * `getDb()` where RLS is inert. A behavioural test can only prove the check
 * fires on the paths someone remembered to write a test for; the failure mode
 * here is the path nobody remembered. So this asserts the property over the
 * whole set of files, and the set itself is spelled out below — adding a new
 * prospect action means editing this list, which is the point (the same
 * discipline tests/lint-ban.test.ts applies to the repository barrel).
 *
 * These suites need no database: they read source text.
 *
 * ── THE PROPERTY ────────────────────────────────────────────────────────────
 *
 * `prospects` and `prospect_quote_lines` are gated by `is_operator()` policies
 * (0010) and a withheld `authenticated` INSERT grant (0014). NEITHER applies to
 * a write made through `getDb()`, which connects on `DATABASE_URL` as a
 * service-role-equivalent and bypasses RLS by design. On those paths the policy
 * is not the enforcement — `requireOperator()` is.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Every file that reaches `prospects` or `prospect_quote_lines` through the
 * service-role repository on behalf of a browser request.
 *
 * `audits/new/actions.ts`      — createProspect (writes api_key_ciphertext)
 * `audits/[id]/actions.ts`     — convertProspectToTenant (clears purge_after)
 * `audits/[id]/mapping/actions.ts` — confirmCsvMapping (writes quote lines)
 * `audits/[id]/mapping/page.tsx`   — getProspectStaging (renders staged PII)
 * `clients/[id]/actions.ts`    — armChannelAction / disarmChannelAction, which
 *     write `messaging_config` through the service-role repository on behalf of
 *     a browser request. The property is the same one and the stake is higher:
 *     the row they write is the switch that starts real customer messaging.
 *     `recordProofAction` (10-05) is in the same file and under the same rule:
 *     it writes `tenant_proofs`, whose `recorded_by` is NOT NULL and holds the
 *     id this guard returns — the one column a form field must never supply.
 *
 * ── THE REGEX DECISION, PINNED HERE (Phase 10) ──────────────────────────────
 *
 * The arming actions call `requireOperatorId()`, not `requireOperator()`, because
 * the audit row they write records WHICH operator armed sending. The two
 * assertions below therefore accept `requireOperator` with an optional `Id`
 * suffix. The alternative — have the actions call `requireOperator()` and then a
 * sibling for the id — was rejected: it is two allowlist reads per arming and
 * two places for the "read error is denial" rule to drift apart.
 * `requireOperator()` now DELEGATES to `requireOperatorId()`, so the allowlist
 * read exists exactly once, and the `_auth.ts` source assertions further down
 * still pin that read and its denial branch unchanged.
 */
const GUARDED_PATHS = [
  'src/app/(console)/audits/new/actions.ts',
  'src/app/(console)/audits/[id]/actions.ts',
  'src/app/(console)/audits/[id]/mapping/actions.ts',
  'src/app/(console)/audits/[id]/mapping/page.tsx',
  'src/app/(console)/clients/[id]/actions.ts',
  // 12-06: the text-back wording (sent verbatim to the public once attested)
  // and the never-text list, both written through the service-role path.
  'src/app/(console)/clients/[id]/text-back/actions.ts',
  // 2026-10-10 (14-02): the create-ServiceM8-job action. It writes `leads`,
  // `quotes` and `quote_contacts` through the service-role path AND creates
  // records in a client's ServiceM8 with their key; `sm8_job_created_by` holds
  // the id this guard returns. Not a prospect path, so the bare-getClaims
  // assertion does not apply: its membership read begins with `getClaims()`
  // AFTER `requireOperatorId()`, the `clients/[id]/actions.ts` shape.
  'src/app/(console)/inbox/create-job-actions.ts',
  // 2026-10-13 (Phase 15, 15-04): the lead queue. The page reads every open
  // lead across clients — and, per tenant, each caller's mobile and newest
  // reply — through the service-role path, so `requireOperator()` precedes
  // the first read. The close action stops a cadence and closes a lead
  // through the same path; its `authorize()` runs the gate and then the
  // operator's own-JWT membership read, the `queue/actions.ts` shape.
  'src/app/(console)/leads/actions.ts',
  'src/app/(console)/leads/page.tsx',
  // 2026-10-13 (Phase 15, 15-05): the client page's missed-calls section —
  // the only server file on the RLS-only client page that selects a caller
  // number (`missedCalls.listForLog`, through the service-role path). Its read
  // begins AFTER `requireOperator()`; the page itself stays ungated and
  // number-free (T-6-21), so the component, not the page, is listed.
  'src/app/(console)/clients/[id]/missed-calls-list.tsx',
  // 2026-10-13 (Phase 15, 15-06): the design-partner CSV action. It reads the
  // newest frozen `figures` of EVERY tenant through the service-role path, so
  // `requireOperator()` precedes the read (call-count ordering pinned in
  // tests/export-csv-action.test.ts); names come through the operator's JWT.
  'src/app/(console)/reports/export-actions.ts',
] as const;

/**
 * The prospect paths ALONE, for the bare-getClaims assertion below.
 *
 * `clients/[id]/actions.ts` is excluded from that one assertion and from no
 * other: its `authorize()` helper reads the target tenant through the
 * OPERATOR'S OWN JWT, and that read starts with `getClaims()`. There, the call
 * is the membership check — made AFTER `requireOperatorId()`, never instead of
 * it — which is the opposite of the defect the assertion pins.
 */
const PROSPECT_PATHS = GUARDED_PATHS.filter((path) => path.includes('/audits/'));

function source(path: string): string {
  return readFileSync(path, 'utf-8');
}

/** Strip block and line comments so a mention in prose cannot satisfy an assertion. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('operator authorization on service-role prospect paths (CR-01)', () => {
  it.each(GUARDED_PATHS)('%s calls requireOperator()', (path) => {
    // `requireOperatorId(` satisfies this too — see the regex decision above.
    expect(code(path)).toMatch(/\brequireOperator(?:Id)?\s*\(/);
  });

  it.each(GUARDED_PATHS)('%s imports requireOperator from the shared module', (path) => {
    // A locally-defined helper of the same name would satisfy the assertion
    // above while re-introducing the drift the shared module exists to prevent.
    expect(code(path)).toMatch(
      /import\s*\{[^}]*\brequireOperator(?:Id)?\b[^}]*\}\s*from\s*['"][^'"]*_auth['"]/,
    );
  });

  it.each(PROSPECT_PATHS)(
    '%s does not treat a bare getClaims() as authorization',
    (path) => {
      // getClaims() proves a session exists and nothing more. On these paths it
      // was the ONLY check, which is the defect. requireOperator() calls it
      // internally, so no caller needs it directly.
      expect(code(path)).not.toMatch(/getClaims\s*\(/);
    },
  );

  it('requireOperator authorizes by reading operator_allowlist through RLS', () => {
    const auth = code('src/app/(console)/_auth.ts');

    // The read must go through the operator's own JWT (`createClient()` is
    // anon-key + cookie session). Reading the allowlist through getDb() would
    // reproduce the original defect inside the fix.
    expect(auth).toMatch(/createClient\s*\(/);
    expect(auth).toMatch(/from\s*\(\s*['"]operator_allowlist['"]\s*\)/);
    expect(auth).not.toMatch(/\bgetDb\b/);
  });

  it('requireOperator denies rather than passes when the allowlist read errors', () => {
    const auth = code('src/app/(console)/_auth.ts');

    // `error || !data` — an unreachable database must not become an open door
    // on the one table holding a stranger's customer data.
    expect(auth).toMatch(/if\s*\(\s*error\s*\|\|\s*!\s*data\s*\)\s*return\s*'forbidden'/);
  });

  it('the three outcomes stay distinct', async () => {
    const mod = await import('@/app/(console)/_auth');

    // A single boolean would collapse "sign in again" (actionable) into "you do
    // not have access" (not), and the console renders those differently.
    expect(Object.keys(mod.OPERATOR_DENIED_MESSAGE).sort()).toEqual([
      'forbidden',
      'unauthenticated',
    ]);
  });
});
