/**
 * T-4-24: the inbox's server action proves OPERATOR status BEFORE it touches the
 * repository — and the ordering is the property, not the outcome.
 *
 * ── WHY ORDER, AND NOT JUST "IT RETURNED AN ERROR" ──────────────────────────
 *
 * `markInboundTriaged` writes through `getDb()`, the service-role path, where
 * the `inbound_messages` policy is inert by design. So an action that called the
 * repository first and checked the caller afterwards would still return the
 * denial message — and would still have written the row. The assertions below
 * are therefore about the MOCK'S CALL COUNT on the denied paths, which is the
 * only thing that can fail on that mistake.
 *
 * A Server Action id is global: this action is POSTable at any route, including
 * ones `proxy.ts` never sees, and the `(console)` layout's gate runs only when a
 * layout renders — after the action has finished. The layout is not the
 * enforcement here; `requireOperator()` is.
 *
 * ── PURE, AND THE REAL GATE ─────────────────────────────────────────────────
 *
 * No database and no network: the repository barrel and `next/cache` are mocked.
 * `requireOperator()` itself is NOT mocked — Supabase's client is, one level
 * below it, so the real gate runs against a fake session. Mocking the gate would
 * leave the thing under test out of the test: the defect being pinned is a
 * missing or mis-ordered call to it.
 *
 * Sibling suite: tests/operator-authorization.test.ts pins the same property
 * over the prospect paths as a source scan (CR-01). This one is behavioural
 * because there is exactly one action to drive and its ordering is observable.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The signature is declared on the MOCK and the implementation takes nothing:
// the id is asserted through `toHaveBeenCalledWith`, so naming it in the body
// only bought an unused-parameter warning — and `npm run lint` runs with
// `--max-warnings=0`, so that one warning made the lint gate red for every
// later plan in this phase.
const markInboundTriaged = vi.fn<(id: string) => Promise<{ triaged: boolean }>>(
  async () => ({ triaged: true }),
);
const revalidatePath = vi.fn();

vi.mock('@/db/repository', () => ({
  markInboundTriaged: (id: string) => markInboundTriaged(id),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

/**
 * The session under test, swapped per case.
 *
 * `claims` null  → no session at all           → 'unauthenticated'
 * `allowlisted`  → whether the RLS-scoped read of `operator_allowlist` returns
 *                  the caller's row. A non-operator gets ZERO ROWS rather than
 *                  an error, which is the property `_auth.ts` relies on.
 */
let session: { userId: string | null; allowlisted: boolean } = {
  userId: 'operator-1',
  allowlisted: true,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: session.userId ? { claims: { sub: session.userId } } : null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'operator_allowlist' && session.allowlisted
              ? { data: { user_id: session.userId }, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
  }),
}));

const { markHandledAction } = await import('@/app/(console)/inbox/actions');
const { BLANK_TRIAGE_STATE } = await import('@/app/(console)/inbox/action-state');

const ROW_ID = '55555555-5555-4555-8555-555555555555';

function form(id: unknown): FormData {
  const data = new FormData();
  if (typeof id === 'string') data.set('inbound_id', id);
  return data;
}

beforeEach(() => {
  markInboundTriaged.mockClear();
  markInboundTriaged.mockResolvedValue({ triaged: true });
  revalidatePath.mockClear();
  session = { userId: 'operator-1', allowlisted: true };
});

describe('the mark-handled action is gated before it reaches the repository (T-4-24)', () => {
  it('rejects an unauthenticated caller WITHOUT calling the repository', async () => {
    session = { userId: null, allowlisted: false };

    const state = await markHandledAction(BLANK_TRIAGE_STATE, form(ROW_ID));

    // The count is the assertion. A repository-first action would return this
    // same message having already written the row.
    expect(markInboundTriaged).not.toHaveBeenCalled();
    expect(state.success).toBeNull();
    expect(state.error).toBe('Your session has expired. Sign in again.');
  });

  it('rejects an authenticated NON-operator WITHOUT calling the repository', async () => {
    // The gap CR-01 named: a valid session is not membership of the allowlist,
    // and every row this action reaches is one the policy admits to operators
    // alone (`tenant_id IS NULL`) — i.e. possibly another client's customer.
    session = { userId: 'signed-in-stranger', allowlisted: false };

    const state = await markHandledAction(BLANK_TRIAGE_STATE, form(ROW_ID));

    expect(markInboundTriaged).not.toHaveBeenCalled();
    expect(state.error).toBe('You do not have access to audits.');
  });

  it('keeps the two denials DISTINCT', async () => {
    // An expired session is fixed by signing in again; not being an operator is
    // not fixed by anything the caller can do. Collapsing them into one message
    // sends the operator to the login screen for a problem login cannot solve.
    session = { userId: null, allowlisted: false };
    const expired = await markHandledAction(BLANK_TRIAGE_STATE, form(ROW_ID));
    session = { userId: 'signed-in-stranger', allowlisted: false };
    const forbidden = await markHandledAction(BLANK_TRIAGE_STATE, form(ROW_ID));

    expect(expired.error).not.toBe(forbidden.error);
  });

  it('marks the row handled for an operator, with the id from the form', async () => {
    const state = await markHandledAction(BLANK_TRIAGE_STATE, form(ROW_ID));

    expect(markInboundTriaged).toHaveBeenCalledTimes(1);
    expect(markInboundTriaged).toHaveBeenCalledWith(ROW_ID);
    expect(state).toEqual({ error: null, success: 'Marked handled.' });
  });

  it('revalidates the inbox so the row leaves the list', async () => {
    // Without this the page keeps serving the router-cached payload and the row
    // the operator just dismissed is still on screen — which reads as the tap
    // not having worked, and invites a second one.
    await markHandledAction(BLANK_TRIAGE_STATE, form(ROW_ID));

    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
  });

  it('reports an already-handled row honestly rather than as a fresh write', async () => {
    // The `triaged_at IS NULL` guard makes the second write flip nothing. Saying
    // "marked handled" for it would claim a write that did not happen — and
    // `triaged_at` is the answer to "how long did this customer wait".
    markInboundTriaged.mockResolvedValue({ triaged: false });

    const state = await markHandledAction(BLANK_TRIAGE_STATE, form(ROW_ID));

    expect(state).toEqual({ error: null, success: 'Already handled.' });
  });

  it.each([
    ['absent', undefined],
    ['not a uuid', 'not-a-uuid'],
    ['empty', ''],
    ['sql-ish', "' OR 1=1 --"],
  ])('refuses a %s id WITHOUT calling the repository', async (_label, value) => {
    // A non-uuid reaches Postgres as a 22P02 thrown from two layers below a
    // screen the operator is looking at. The form can only ever submit the rows
    // on screen — but the action id is global and the body is the caller's.
    const state = await markHandledAction(BLANK_TRIAGE_STATE, form(value));

    expect(markInboundTriaged).not.toHaveBeenCalled();
    expect(state.error).toBe('That message could not be found.');
  });
});

/**
 * Source assertions — the half a behavioural test cannot reach.
 *
 * The failure mode is an absence: a SECOND action added to this module later,
 * without the gate. Driving the one that exists proves nothing about that.
 */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const ACTIONS = 'src/app/(console)/inbox/actions.ts';
const PAGE = 'src/app/(console)/inbox/page.tsx';

describe('the inbox surfaces carry the gate in source', () => {
  it.each([ACTIONS, PAGE])('%s calls requireOperator()', (path) => {
    expect(code(path)).toMatch(/\brequireOperator\s*\(/);
  });

  it.each([ACTIONS, PAGE])('%s imports it from the shared module', (path) => {
    // A locally-defined helper of the same name would satisfy the assertion
    // above while re-introducing the drift `_auth.ts` exists to prevent.
    expect(code(path)).toMatch(
      /import\s*\{[^}]*\brequireOperator\b[^}]*\}\s*from\s*['"][^'"]*_auth['"]/,
    );
  });

  it.each([ACTIONS, PAGE])('%s does not treat a bare getClaims() as authorization', (path) => {
    expect(code(path)).not.toMatch(/getClaims\s*\(/);
  });

  it('the action module exports EXACTLY ONE async function', () => {
    // Every export of a `'use server'` module is a globally-POSTable endpoint.
    // Orchestration living here would be orchestration anyone with a session
    // could invoke, which is the Phase 2 lesson this file is written against.
    const exports = code(ACTIONS).match(/^export\s+async\s+function\s+(\w+)/gm) ?? [];
    expect(exports).toHaveLength(1);
    expect(exports[0]).toContain('markHandledAction');
  });

  it('the page reads the queue through the capped repository accessor', () => {
    // Not a hand-rolled query in the page: the cap, the untriaged predicate and
    // the deliberately-absent `raw_payload` all live in one place, and a second
    // spelling of "which rows need a human" is how a fifth attribution ends up
    // visible on one surface and invisible on another.
    expect(code(PAGE)).toMatch(/listInboundNeedingTriage\s*\(/);
  });

  it('the page renders no raw database error (WR-08)', () => {
    // A postgres error from this query carries the predicate, and the predicate
    // names customer columns.
    const page = code(PAGE);
    expect(page).not.toMatch(/\{\s*\w*[eE]rror\.message\s*\}/);
    expect(page).not.toMatch(/\{\s*String\s*\(\s*\w*[eE]rror\s*\)\s*\}/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE CLASSIFICATION SURFACING (D-13, D-14, D-15 — plan 05-07)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PROPERTY UNDER TEST IS AN ABSENCE: a classification label must not   │
 * │ be able to cause a suppression. It can sort a row and it can put a       │
 * │ BUTTON on one, and that is the entire extent of it (D-13, AI-03).        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A behavioural test cannot prove an absence — driving the suggest button and
 * watching the right thing happen says nothing about a second write path added
 * beside it. These are structural for that reason, and they are the same shape
 * as `classification-privilege.test.ts`: assert what the code COULD do, not only
 * what it did.
 *
 * The ORDERING half is proven where it can only be proven — against the hosted
 * database, in `tests/inbound-threading.test.ts`. The queue is CAPPED, so the
 * priority has to be part of what the LIMIT chooses, and a sort applied to a
 * fixture array here would be a test of the fixture.
 * ══════════════════════════════════════════════════════════════════════════ */

const REPOSITORY = 'src/db/repository/inbound-messages.ts';
const SUPPRESS_FORM = 'src/app/(console)/inbox/suppress-contact-form.tsx';

describe('the widened triage read keeps its family promise', () => {
  const source = code(REPOSITORY);

  it('still reads ONE table and joins nothing', () => {
    // What this family owes in exchange for living outside `forTenant()`. A join
    // here would turn "an unattributed reply" into a cross-tenant read of
    // customer data.
    expect(source).not.toMatch(/\.(inner|left|right|full)?[Jj]oin\s*\(/);
    const tables = new Set([...source.matchAll(/\.from\((\w+)\)/g)].map((m) => m[1]));
    expect(tables).toEqual(new Set(['inboundMessages']));
  });

  it('selects the three classification columns the screen needs, and no more', () => {
    // `classify_attempts` and `raw_payload` are deliberately absent: the first
    // is our retry bookkeeping and the second is an unbounded provider payload,
    // and every column here is serialised into the page's HTML payload.
    const select = source.slice(
      source.indexOf('export async function listInboundNeedingTriage'),
      source.indexOf('export async function markInboundTriaged'),
    );
    expect(select).toMatch(/label: inboundMessages\.label/);
    expect(select).toMatch(/labelConfidence: inboundMessages\.labelConfidence/);
    expect(select).toMatch(/isHot: inboundMessages\.isHot/);
    expect(select).not.toMatch(/rawPayload/);
    expect(select).not.toMatch(/classifyAttempts/);
  });

  it('ranks soft opt-outs first and below-high-confidence second, IN SQL', () => {
    // In the ORDER BY rather than in the page, because the read is capped: a
    // sort applied afterwards orders only the rows the cap admitted, so a soft
    // opt-out could be cut off by a night of dead-letter callbacks and then
    // "sorted to the top" of a list it is not in.
    expect(source).toMatch(/WHEN[\s\S]{0,120}?= 'opt_out'[\s\S]{0,120}?= false THEN 0/);
    expect(source).toMatch(/WHEN[\s\S]{0,160}?IS NOT NULL[\s\S]{0,160}?<> 'high' THEN 1/);
    expect(source).toMatch(/\.orderBy\(TRIAGE_PRIORITY,/);
  });

  /**
   * The triage read's WHERE, sliced INSIDE `listInboundNeedingTriage`.
   *
   * 2026-10-09 (13-REVIEW CR-01): the slice used to start at the file's FIRST
   * `.where(`, which is the provider-message-id lookup above this function —
   * so the is_hot pin below was checking a one-line predicate it could never
   * fail on. Scoped to the function now, so it reads the queue predicate.
   */
  const triageWhere = (): string => {
    const fn = source.slice(
      source.indexOf('export async function listInboundNeedingTriage'),
      source.indexOf('export async function markInboundTriaged'),
    );
    return fn.slice(fn.indexOf('.where('), fn.indexOf('.orderBy('));
  };

  // 2026-10-09 (Phase 13, 13-REVIEW CR-01): NARROWED BY DESIGN. The lead arm
  // reads `is_hot = false` to EXCLUDE a lead reply escalation already told the
  // tradie about. The property this pin guards is unchanged — `is_hot` never
  // ADMITS a row — so the one excluding spelling is removed before the check.
  it('does NOT let is_hot admit a row to the queue (D-14)', () => {
    // A hot lead is the system working — placed, paused, and waiting on Phase
    // 6's escalation. The triage screen means "a human must look at this".
    const where = triageWhere();
    expect(where).toMatch(/isNull\(inboundMessages\.triagedAt\)/);
    expect(where).not.toMatch(/eq\(inboundMessages\.isHot, true\)/);
    expect(where.replaceAll('eq(inboundMessages.isHot, false)', '')).not.toMatch(/isHot/);
  });

  it('shows every cold lead reply, labelled or not, at any confidence (CR-01, D-08/D-11)', () => {
    // A lead has no quote page, so the inbox is the only place a confident
    // `question` from a missed caller can be read. The arm must not require a
    // label (a reply the classifier gave up on) nor a confidence.
    const where = triageWhere();
    const arm = where.match(
      /and\(\s*isNotNull\(inboundMessages\.leadId\),\s*eq\(inboundMessages\.isHot, false\),\s*eq\(inboundMessages\.keywordHot, false\),\s*\)/,
    );
    expect(arm).not.toBeNull();
    expect(arm?.[0]).not.toMatch(/label/);
  });

  it('leaves the model-writable surface at exactly three functions', () => {
    // The widening added a READ. If it had added a write, this count changes —
    // and the write surface reachable from model output is the whole safety
    // argument for classifying attacker-controlled text at all.
    const writers = source.match(/getDb\(\)\s*\n?\s*\.update\(/g) ?? [];
    expect(writers).toHaveLength(3);
  });
});

describe('the soft-opt-out suggestion cannot write a suppression itself (D-13, T-5-27)', () => {
  const form = code(SUPPRESS_FORM);
  const page = code(PAGE);

  it('delegates to the EXISTING operator kill action', () => {
    expect(form).toMatch(
      /import\s*\{\s*killContactAction\s*\}\s*from\s*'[^']*quotes\/\[quoteId\]\/actions'/,
    );
    expect(form).toMatch(/killContactAction\.bind\(null, tenantId, quoteId\)/);
  });

  it('is a CLIENT component and declares no server action of its own', () => {
    // Every export of a `'use server'` module is a globally-POSTable endpoint.
    // A second suppression endpoint is the thing this plan must not add.
    expect(form).toMatch(/^'use client';/);
    expect(form).not.toMatch(/'use server'/);
  });

  it('reaches no repository, no schema and no suppression table', () => {
    // The deny-list is written out rather than implied: these are the names a
    // second write path would have to use.
    for (const forbidden of [
      'forTenant',
      'getDb',
      'suppressedContacts',
      'suppressed_contacts',
      'killContact(',
      '@/db/',
    ]) {
      expect(form).not.toContain(forbidden);
    }
  });

  it('submits ONLY the cadence id — the ids come from the RLS-read row', () => {
    const hidden = [...form.matchAll(/name="(\w+)"/g)].map((m) => m[1]);
    expect(hidden).toEqual(['cadence_id']);
  });

  it('arms before it confirms, because a mis-tap here has no undo', () => {
    // T-5-27 is exactly "one-tap suppressing the wrong contact", and this
    // control sits in a scrolling list of rows about different customers.
    expect(form).toMatch(/armed\s*\?/);
    expect(form).toMatch(/setArmed\(true\)/);
    expect(form).toMatch(/setArmed\(false\)/);
  });

  // 2026-10 (Phase 13, 13-02, D-11; checker B2): MOVED BY DESIGN. The pin was
  // "carrying every id", quote id included — which left a missed caller's soft
  // opt-out with no confirmation path at all. A lead reply has a client and a
  // cadence and NO quote, and the kill path is the same, so the condition is
  // the two ids the kill needs. The form-binding pin above stands unchanged.
  it('the page offers it ONLY for a soft opt-out carrying a client and a cadence', () => {
    expect(page).toMatch(/const softOptOut = row\.label === 'opt_out' && !row\.isStop/);
    expect(page).toMatch(/softOptOut && row\.tenantId && row\.cadenceId\s*\?/);
    expect(page).not.toMatch(/softOptOut && row\.tenantId && row\.cadenceId && row\.quoteId/);
  });

  it('the page renders labels as GUESSES, never as findings (D-15)', () => {
    // A label that read as a verdict would teach an operator to act on the badge
    // instead of the reply — which is the trust a prompt injection would spend.
    //
    // The WORDS moved to `components/label-guess.ts` in 06-06, because three
    // surfaces show them now (this page, the quote page's conversation thread,
    // and the pipeline's reply chip) and "a guess stays phrased as a guess on
    // every surface" is a rule rather than a style. So the property is asserted
    // in two halves: the words still read as opinions, and this page still gets
    // them from there rather than from a local map of its own.
    const shared = readFileSync('src/app/(console)/components/label-guess.ts', 'utf8');
    expect(shared).toMatch(/reads as an opt-out/);
    expect(shared).toMatch(/reads as interested/);

    // THE FUNCTION, NOT THE MAP (WR-09). `labelGuess` is where the `?? raw`
    // fallback lives; all three surfaces used to import the map and re-implement
    // that fallback inline, which left the function that exists to own the rule
    // owning nothing.
    // 2026-10-09 (13-REVIEW WR-03): the page also imports `urgencyGuess` from
    // the same module, so the pin allows a sibling name in the braces.
    expect(page).toMatch(/\blabelGuess\b[^}]*\} from '\.\.\/components\/label-guess'/);
    expect(page).not.toMatch(/const LABEL_GUESS_LABELS/);
    expect(page).not.toMatch(/LABEL_GUESS_LABELS\[/);

    // A map, not a string transform: a seventh label must fail loudly there
    // rather than ship as snake_case on the operator's phone. Asserted with the
    // prose stripped, because the module's header names the transform it is
    // refusing to be — a comment may say what the code may not do.
    const sharedCode = shared.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(sharedCode).not.toMatch(/\.replace\(['"]_['"]/);
    expect(page).not.toMatch(/\.replace\(['"]_['"]/);
  });

  it('the page shows the hot flag and acts on nothing (D-14)', () => {
    expect(page).toMatch(/row\.isHot \?/);
    // Display only. No form, no action and no branch hangs off it.
    expect(page).not.toMatch(/isHot[\s\S]{0,80}?<form/);
  });
});

describe('no NEW suppression write exists anywhere in the codebase', () => {
  it('killContact is called from exactly one place outside its own module', () => {
    // The Phase 3 header's argument, asserted: the second expression of "stop
    // chasing this person" is the one that gets a condition wrong, and the
    // failure is a message going out after somebody asked us to stop.
    const callers = [
      'src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts',
      'src/app/(console)/inbox/page.tsx',
      'src/app/(console)/inbox/suppress-contact-form.tsx',
      'src/app/(console)/inbox/actions.ts',
    ].filter((path) => /\bkillContact\s*\(/.test(code(path)));

    expect(callers).toEqual(['src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts']);
  });

  it('the inbox action module still exports exactly one action', () => {
    // The suggestion added a component, not an endpoint.
    const exports = code(ACTIONS).match(/^export\s+async\s+function\s+(\w+)/gm) ?? [];
    expect(exports).toHaveLength(1);
  });
});
