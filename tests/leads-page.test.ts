/**
 * Phase 15 (CON-05, D-01; T-15-03, T-15-14): the `/leads` surface, pinned in
 * source — the gate before the read, the discarded catch with its fixed
 * sentence inside `role="alert"`, the two-authority read, the close action's
 * ordering and revalidation set, the card's client-safe import set, and the
 * nav's third place.
 *
 * No database renders these pages, so the proof is the source itself, read
 * with comments stripped (the `queue-lead-rows` mould). `leads/page.tsx` is
 * deliberately NOT in `tests/console-error-leak.test.ts`'s NAMED_PAGES: those
 * rules want an error-code log line and a literal "Could not load" in the
 * page, which contradict the discarded-catch fixed-string rule this page
 * follows. Its error arm is pinned here instead; the leak suite's walk still
 * scans every file under `(console)`.
 *
 * PURE: no seed, no database client, no environment.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\}/g, '{}')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every module this source pulls in as a VALUE (the lint-ban helper's regex):
 * `import type` / `export type` are erased and skipped; a side-effect import,
 * an `export … from` and a dynamic `import()` all count.
 */
function valueImportSpecifiers(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specifiers: string[] = [];
  for (const [, keyword, clause, , specifier] of stripped.matchAll(
    /^(import|export)\b([\s\S]*?)(['"])([^'"]+)\3\s*;/gm,
  )) {
    const declaresFrom = /\bfrom\s*$/.test(clause);
    const sideEffect = keyword === 'import' && clause.trim() === '';
    if (!declaresFrom && !sideEffect) continue;
    if (/^\s*type\b/.test(clause)) continue;
    specifiers.push(specifier);
  }
  for (const [, , specifier] of stripped.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)) {
    specifiers.push(specifier);
  }
  return specifiers;
}

const PAGE_PATH = 'src/app/(console)/leads/page.tsx';
const ACTIONS_PATH = 'src/app/(console)/leads/actions.ts';
const CARD_PATH = 'src/app/(console)/leads/lead-card.tsx';

const PAGE = code(PAGE_PATH);
const ACTIONS = code(ACTIONS_PATH);
const CARD = code(CARD_PATH);
const LAYOUT = code('src/app/(console)/layout.tsx');

/**
 * The card's allowed VALUE imports — the queue card's set (15-04 Task 1).
 * A value import from the repository barrel or the schema module would drag
 * `postgres` into the browser bundle.
 */
const CARD_ALLOWED_IMPORTS = new Set<string>([
  'react',
  'next/link',
  './actions',
  './action-state',
  '../components/action-state',
  '../components/label-guess',
  '@/core/aging/stall-policy',
  // 2026-10-13 (15-04 Task 2): the ONE widening — the Phase 14 sheet,
  // itself `'use client'` with client-safe imports (the inbox mounts it).
  '../inbox/create-job-form',
]);

describe('/leads page: the gate, the read, the error arm', () => {
  it('is dynamic — session-dependent, never statically rendered', () => {
    expect(PAGE).toContain("export const dynamic = 'force-dynamic'");
  });

  it('runs requireOperator() before the first read', () => {
    const gate = PAGE.indexOf('requireOperator()');
    const read = PAGE.indexOf('listOpenLeadsForQueue(');
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(read);
  });

  it('reads the personal facts per tenant, once, after the ids-only read', () => {
    expect(PAGE.match(/queueCards\(/g) ?? []).toHaveLength(1);
    expect(PAGE).toMatch(/forTenant\(tenantId\)\.leads\.queueCards\(/);
    expect(PAGE.indexOf('listOpenLeadsForQueue(')).toBeLessThan(PAGE.indexOf('queueCards('));
  });

  it('logs a fixed string and discards the caught value', () => {
    expect(PAGE).toContain("console.error('[leads] lead queue read failed')");
    // A bare `catch {` — there is no binding to log or render.
    expect(PAGE).not.toMatch(/catch\s*\(\s*\w+\s*\)/);
  });

  it('renders LEADS_LOAD_FAILED_MESSAGE inside role="alert"', () => {
    const alerts = [...PAGE.matchAll(/role="alert"/g)].map((match) => match.index ?? -1);
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(
      alerts.some((at) => PAGE.slice(at, at + 200).includes('LEADS_LOAD_FAILED_MESSAGE')),
    ).toBe(true);
  });

  it('names an unresolvable client "Another client", never a uuid', () => {
    expect(PAGE).toContain("'Another client'");
  });

  it('derives the deadline tier through the one definition', () => {
    expect(PAGE).toContain('leadDeadlineTier(');
    expect(PAGE).not.toContain('deriveUrgency(');
  });

  it('never reaches the raw client or a forAllTenants_ read', () => {
    expect(PAGE).not.toContain('getDb(');
    expect(PAGE).not.toContain('forAllTenants_');
  });

  it('names the read cap it renders against', () => {
    expect(readFileSync(PAGE_PATH, 'utf8')).toContain('LEAD_QUEUE_CAP');
  });
});

describe('/leads close action: the gate, the core, the revalidation set', () => {
  it('authorizes before reading a byte of formData', () => {
    const body = ACTIONS.slice(ACTIONS.indexOf('export async function closeLeadFromQueue('));
    const gate = body.indexOf('authorize(');
    const read = body.indexOf('formData.get');
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(read);
  });

  it('closes through the core with reason operator', () => {
    expect(ACTIONS).toMatch(/closeLead\(tenantId, [a-zA-Z.]+, 'operator'/);
  });

  it('revalidates /leads, /queue, /inbox and the client page — exactly four', () => {
    expect(ACTIONS).toContain("revalidatePath('/leads')");
    expect(ACTIONS).toContain("revalidatePath('/queue')");
    expect(ACTIONS).toContain("revalidatePath('/inbox')");
    expect(ACTIONS).toContain('revalidatePath(`/clients/${tenantId}`)');
    expect(ACTIONS.match(/revalidatePath\(/g) ?? []).toHaveLength(4);
  });

  it('logs a fixed string on a failed write', () => {
    expect(ACTIONS).toContain("console.error('[leads] close write failed')");
    expect(ACTIONS).not.toMatch(/catch\s*\(\s*\w+\s*\)/);
  });

  it('exports exactly one action', () => {
    const exports = ACTIONS.match(/^export\s+async\s+function\s+(\w+)/gm) ?? [];
    expect(exports).toEqual(['export async function closeLeadFromQueue']);
  });
});

describe('/leads card: a client island with a client-safe import set', () => {
  it("is 'use client' on its first non-comment line", () => {
    const first = CARD.split('\n').find((line) => line.trim() !== '');
    expect(first?.trim()).toBe("'use client';");
  });

  it('value-imports only the allowed set — never the barrel or the schema', () => {
    const specifiers = valueImportSpecifiers(readFileSync(CARD_PATH, 'utf8'));
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(CARD_ALLOWED_IMPORTS.has(specifier), specifier).toBe(true);
      expect(specifier).not.toMatch(/^@\/db\//);
    }
  });

  it('anchors itself as #lead-{id} for the inbox link', () => {
    expect(CARD).toContain('id={`lead-${');
  });

  it('settles with role="status" and refuses with role="alert"', () => {
    expect(CARD).toContain('role="status"');
    expect(CARD).toContain('role="alert"');
  });

  it('holds the close state on the card and binds the tenant, never a form field', () => {
    expect(CARD).toContain('useActionState(');
    expect(CARD).toContain('closeLeadFromQueue.bind(null, row.tenantId)');
    expect(CARD).not.toMatch(/name="tenant_id"/);
    expect(CARD).not.toContain('confirm(');
  });

  it('deep-links the approve control into the queue card anchor', () => {
    expect(readFileSync(PAGE_PATH, 'utf8')).toContain('/queue#touch-');
  });
});

describe('the nav: Leads third, with no badge', () => {
  it('sits after Queue and before Audits', () => {
    const leads = LAYOUT.indexOf('href="/leads"');
    expect(leads).toBeGreaterThan(LAYOUT.indexOf('href="/queue"'));
    expect(leads).toBeLessThan(LAYOUT.indexOf('href="/audits"'));
    expect(LAYOUT.match(/href="\/leads"/g) ?? []).toHaveLength(1);
  });

  it('carries no count badge', () => {
    const start = LAYOUT.indexOf('href="/leads"');
    const element = LAYOUT.slice(start, LAYOUT.indexOf('</Link>', start));
    expect(element).not.toContain('badge');
  });
});

/*
 * 2026-10-13 (15-04 Task 2): the expansion — the shared sheet builder, the
 * queue card's anchor, the inbox's one link, robots.
 */
describe('the Phase 14 sheet is built once, for both pages', () => {
  const SHEET_PATH = 'src/app/(console)/components/lead-job-sheet.ts';
  const SHEET = code(SHEET_PATH);
  const INBOX = code('src/app/(console)/inbox/page.tsx');

  it('the builder is a server module, never imported by the card', () => {
    expect(SHEET).not.toContain("'use client'");
    expect(SHEET).toContain('export async function readLeadJobSheets(');
    expect(valueImportSpecifiers(readFileSync(CARD_PATH, 'utf8'))).not.toContain(
      '../components/lead-job-sheet',
    );
  });

  it('the inbox calls the builder and no longer reads sheet facts itself', () => {
    expect(INBOX).toMatch(
      /import\s*\{[^}]*\breadLeadJobSheets\b[^}]*\}\s*from\s*'\.\.\/components\/lead-job-sheet'/,
    );
    expect(INBOX).toContain('readLeadJobSheets(');
    expect(INBOX).not.toContain('jobSheetFacts(');
    // The inbox keeps its own catch and its own fixed string.
    expect(INBOX).toContain("console.error('[inbox] lead job linkage read failed')");
  });

  it('the lead queue calls the builder inside its one try', () => {
    // The try that holds the list read — not `callerLabelOf`'s.
    const tryAt = PAGE.lastIndexOf('try {', PAGE.indexOf('listOpenLeadsForQueue('));
    expect(tryAt).toBeGreaterThan(-1);
    const catchAt = PAGE.indexOf('} catch {', tryAt);
    const call = PAGE.indexOf('readLeadJobSheets(');
    expect(call).toBeGreaterThan(tryAt);
    expect(call).toBeLessThan(catchAt);
  });

  it('the card mounts CreateJobForm only when a sheet exists', () => {
    expect(CARD).toMatch(/import\s*\{\s*CreateJobForm\s*\}\s*from\s*'\.\.\/inbox\/create-job-form'/);
    expect(CARD).toMatch(/row\.sheet === undefined \? null : \(\s*<CreateJobForm/);
  });

  it('a create on /leads revalidates /leads', () => {
    expect(code('src/app/(console)/inbox/create-job-actions.ts')).toContain(
      "revalidatePath('/leads')",
    );
  });
});

describe('/queue changed by one anchor; /inbox by one link', () => {
  const QUEUE_CARD = code('src/app/(console)/queue/queue-card.tsx');
  const INBOX = code('src/app/(console)/inbox/page.tsx');

  it('the queue card anchors BOTH arms as #touch-{id}', () => {
    expect(QUEUE_CARD).toContain('const anchorId = `touch-${row.touchId}`');
    expect(QUEUE_CARD).toContain('<article className="draft-card" id={anchorId}>');
    expect(QUEUE_CARD).toMatch(/<DraftCard\s+anchorId=\{anchorId\}/);
    expect(code('src/app/(console)/components/draft-card.tsx')).toContain(
      '<article className="draft-card" id={anchorId}>',
    );
  });

  it('the queue card reads LEAD_TOUCH_COUNT from the leaf, not a local const', () => {
    expect(QUEUE_CARD).toMatch(
      /import\s*\{\s*LEAD_TOUCH_COUNT\s*\}\s*from\s*'\.\.\/leads\/action-state'/,
    );
    expect(QUEUE_CARD).not.toContain('const LEAD_TOUCH_COUNT');
  });

  it('the inbox lead row links to the lead card', () => {
    expect(INBOX).toContain('/leads#lead-${row.leadId}');
    expect(INBOX.match(/\/leads#lead-/g) ?? []).toHaveLength(1);
  });
});

describe('/leads is kept out of the index', () => {
  it('robots disallows it', () => {
    expect(readFileSync('src/app/robots.ts', 'utf8')).toContain("'/leads'");
  });
});
