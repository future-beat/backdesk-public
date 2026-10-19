/**
 * Prospect → client conversion (D-02, D-04, AUD-02, threats T-2-07 / T-2-13).
 *
 * ── WHY THIS SUITE HITS A REAL DATABASE ─────────────────────────────────────
 *
 * Every claim here is about a transaction and a scheduled DELETE. A mocked
 * client would prove that `convertProspectToTenant` calls the functions this
 * file expects it to call, which is a test of the test. The property that
 * matters — "after conversion, the purge spares these rows" — is only decidable
 * by running the purge's own SQL against rows the conversion actually wrote.
 *
 * The last case is the important one and it is deliberately built the awkward
 * way: it reads the scheduled command out of `cron.job` and executes THAT,
 * rather than a hand-written DELETE that happens to resemble it. A test that
 * re-types the predicate proves the two agree only for as long as one person
 * remembers to edit both.
 */
import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { convertProspectToTenant } from '@/db/repository';

import { testEnv } from './helpers/env';
import {
  admin,
  ensureOperatorAllowlisted,
  seedProspect,
  seedProspectLines,
  seedTenant,
  teardownProspects,
  teardownTenants,
} from './helpers/seed';

const PURGE_JOB = 'prospect-line-purge';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
});

/** Everything seeded here, torn down in the right order (tenants first). */
const prospectIds: string[] = [];
const tenantIds: string[] = [];

async function newProspect(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = await seedProspect(overrides);
  prospectIds.push(id);
  return id;
}

async function newTenant(prefix: string): Promise<string> {
  const id = await seedTenant(prefix);
  tenantIds.push(id);
  return id;
}

/** Rows as the database holds them, read with the service-role client. */
async function readLines(prospectId: string) {
  const { data, error } = await admin
    .from('prospect_quote_lines')
    .select('id, purge_after')
    .eq('prospect_id', prospectId);

  if (error) throw new Error(`Reading prospect lines failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; purge_after: string | null }>;
}

async function readTenant(tenantId: string) {
  const { data, error } = await admin
    .from('tenants')
    .select('id, prospect_id')
    .eq('id', tenantId)
    .single();

  if (error) throw new Error(`Reading the tenant failed: ${error.message}`);
  return data as { id: string; prospect_id: string | null };
}

async function readProspectFigures(prospectId: string) {
  const { data, error } = await admin
    .from('prospects')
    .select('quotes_issued, total_value, recoverable_estimate, baseline_win_rate, purge_marker:id')
    .eq('id', prospectId)
    .single();

  if (error) throw new Error(`Reading the prospect failed: ${error.message}`);
  return data as {
    quotes_issued: number | null;
    total_value: string | number | null;
    recoverable_estimate: string | number | null;
    baseline_win_rate: string | number | null;
  };
}

beforeAll(async () => {
  await ensureOperatorAllowlisted();
});

afterAll(async () => {
  // Tenants FIRST: the tenant → prospect foreign key is NO ACTION on purpose
  // (deleting a prospect must never delete a paying client), so a converted
  // prospect cannot be removed while a tenant still points at it.
  await teardownTenants(tenantIds);
  await teardownProspects(prospectIds);
  await sql.end({ timeout: 5 }).catch(() => {});
}, 60_000);

describe('convertProspectToTenant (D-02)', () => {
  it('sets the link and clears the purge clock on every line, in one call', async () => {
    const prospectId = await newProspect({
      quotes_issued: 12,
      total_value: '48500.00',
      recoverable_estimate: '1200.00',
      baseline_win_rate: '0.2500',
      baseline_quotes_issued: 12,
    });
    const tenantId = await newTenant('Convert Link');

    await seedProspectLines(prospectId, [
      { purge_after: new Date(Date.now() + 30 * 86_400_000).toISOString() },
      { purge_after: new Date(Date.now() + 29 * 86_400_000).toISOString() },
      { purge_after: new Date(Date.now() + 28 * 86_400_000).toISOString() },
    ]);

    const before = await readLines(prospectId);
    expect(before).toHaveLength(3);
    expect(before.every((line) => line.purge_after !== null)).toBe(true);

    const result = await convertProspectToTenant(prospectId, tenantId);

    expect(result).toEqual({ ok: true, linesKept: 3 });
    expect((await readTenant(tenantId)).prospect_id).toBe(prospectId);

    const after = await readLines(prospectId);
    expect(after).toHaveLength(3);
    // NULL is the only way a line survives past 30 days, and this is the only
    // code path that writes it (D-04).
    expect(after.every((line) => line.purge_after === null)).toBe(true);
  });

  it('leaves the audit figures and the baseline snapshot untouched', async () => {
    const prospectId = await newProspect({
      quotes_issued: 7,
      total_value: '19000.00',
      recoverable_estimate: '855.00',
      baseline_win_rate: '0.4286',
      baseline_quotes_issued: 7,
    });
    const tenantId = await newTenant('Convert Snapshot');

    const before = await readProspectFigures(prospectId);
    await convertProspectToTenant(prospectId, tenantId);
    const after = await readProspectFigures(prospectId);

    // D-02 LINKS, it does not copy. The baseline stays on the prospect row and
    // Phase 7 reads it through `tenants.prospect_id` — one copy of the number
    // the first invoice will be argued about.
    expect(after).toEqual(before);
    expect(Number(after.baseline_win_rate)).toBeCloseTo(0.4286, 4);
  });

  it('spares only converted lines when the scheduled purge runs', async () => {
    const converted = await newProspect();
    const untouched = await newProspect();
    const tenantId = await newTenant('Convert Purge');

    const expired = new Date(Date.now() - 86_400_000).toISOString();

    // Both prospects hold lines that are ALREADY expired, so the only thing
    // separating them at purge time is the conversion.
    await seedProspectLines(converted, [{ purge_after: expired }, { purge_after: expired }]);
    await seedProspectLines(untouched, [{ purge_after: expired }]);

    await convertProspectToTenant(converted, tenantId);

    // The command the cron job actually runs, read from the catalog and
    // executed verbatim rather than retyped here — see the file header.
    const [job] = await sql<{ command: string }[]>`
      SELECT command FROM cron.job WHERE jobname = ${PURGE_JOB}
    `;

    expect(job, `cron job ${PURGE_JOB} is not scheduled`).toBeDefined();
    await sql.unsafe(job.command);

    expect(await readLines(converted)).toHaveLength(2);
    expect(await readLines(untouched)).toHaveLength(0);
  });
});

describe('one link, no silent overwrite', () => {
  it('rejects a tenant that is already linked, and writes nothing', async () => {
    const first = await newProspect();
    const second = await newProspect();
    const tenantId = await newTenant('Convert Overwrite');

    await seedProspectLines(second, [
      { purge_after: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    ]);

    expect(await convertProspectToTenant(first, tenantId)).toEqual({ ok: true, linesKept: 0 });

    const rejected = await convertProspectToTenant(second, tenantId);

    expect(rejected).toEqual({
      ok: false,
      kind: 'already_linked',
      existingProspectId: first,
    });

    // The link still points at the FIRST prospect...
    expect((await readTenant(tenantId)).prospect_id).toBe(first);

    // ...and — the assertion that matters — the second prospect's lines were
    // NOT stranded in a kept-forever state by a partially-applied conversion.
    const stranded = await readLines(second);
    expect(stranded).toHaveLength(1);
    expect(stranded[0].purge_after).not.toBeNull();
  });
});

/**
 * ── THE PRINTED ARTIFACT, ASSERTED IN SOURCE ────────────────────────────────
 *
 * Print layout and colour cannot be decided by a test runner — that is the
 * plan's human UAT row, and it stays one. What CAN be pinned here is the set of
 * properties whose violation is silent and permanent: a hard-coded percentage
 * drifting from the constant that computed the figure, a print block that stops
 * hiding the console nav, an addendum footnote that renders unconditionally.
 * Each of those ships looking fine and is wrong on paper, in front of a
 * prospect.
 *
 * Comments are stripped before the negative assertions, so the reasoning above
 * a line cannot be deleted to keep a test green.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the audit report page (D-09, D-11)', () => {
  const PAGE = readFileSync('src/app/(console)/audits/[id]/page.tsx', 'utf8');
  const CSS = readFileSync('src/app/(console)/audits/[id]/audit.css', 'utf8');

  it('derives the footnote rate from the constant, not from a literal', () => {
    expect(PAGE).toContain('AUDIT_RECOVERY_RATE');
    expect(PAGE).toMatch(/from '@\/core\/audit\/constants'/);
    // The figure and the sentence explaining it must come from one value.
    expect(PAGE).toContain('{ratePercent}%');

    const code = withoutComments(PAGE);
    // No percentage literal for the rate anywhere in the file: '15%', '20%',
    // or the fraction itself.
    expect(code).not.toMatch(/\b(15|20)%/);
    expect(code).not.toContain('0.15');
  });

  it('renders the methodology footnote copy verbatim', () => {
    expect(PAGE).toContain('How this was measured');
    expect(PAGE).toContain('conservative');
    expect(PAGE).toContain('recovery rate to the never-followed-up value');
  });

  it('renders the CSV addendum if and only if csv_note_degraded is set', () => {
    const code = withoutComments(PAGE);

    expect(code).toContain('prospect.csv_note_degraded ?');
    // The addendum's own sentence appears exactly once, inside that branch.
    const occurrences = code.split('prepared from a CSV export').length - 1;
    expect(occurrences).toBe(1);
  });

  it('imports the print stylesheet and marks exactly one accent figure', () => {
    expect(PAGE).toContain("import './audit.css'");

    const code = withoutComments(PAGE);
    expect(code.split('audit-figure--hero').length - 1).toBe(1);
  });

  it('states the window from WINDOW_DAYS rather than the number 90', () => {
    expect(PAGE).toContain('WINDOW_DAYS');
    expect(withoutComments(PAGE)).not.toMatch(/last 90 days/i);
  });

  it('ships the A4 page rule and a print block that hides the console chrome', () => {
    expect(CSS).toMatch(/@page\s*\{[^}]*size:\s*A4/);
    expect(CSS).toMatch(/@page\s*\{[^}]*margin:\s*14mm/);
    expect(CSS).toContain('@media print');

    const printBlock = CSS.slice(CSS.indexOf('@media print'));
    expect(printBlock).toContain('.nav');
    expect(printBlock).toContain('.audit-actions');
    expect(printBlock).toContain('display: none');
  });

  it('forces the light palette in print, so a dark-mode phone prints on paper', () => {
    const printBlock = CSS.slice(CSS.indexOf('@media print'));
    expect(printBlock).toContain('--bg: #ffffff');
    // GRAPHITE, the brand's own dark, since logo v2 (19 Sep 2026). It was
    // #16181d — neither Ink nor Graphite, a near-black somebody picked for
    // print contrast before the palette had a dark of its own. This assertion
    // was left a version behind by quick-260919-lj8 and failed CI on main; the
    // stylesheet is correct and `tests/brand-tokens.test.ts` does the contrast
    // arithmetic (16.47:1 on white, an order of magnitude past the floor).
    expect(printBlock).toContain('--fg: #1A1F2B');
    // The accent is the ONE colour permitted to survive the printer's default
    // background-stripping. Counted on the unprefixed property only — the
    // `-webkit-` line beside it is the same declaration, not a second
    // exemption, and matching it would make this count meaningless.
    expect(printBlock).toContain('print-color-adjust: exact');
    expect(printBlock.match(/[^-]print-color-adjust: exact/g)).toHaveLength(1);
  });

  it('keeps the convert control out of the printed region', () => {
    expect(PAGE).toContain('audit-actions');
    const printBlock = CSS.slice(CSS.indexOf('@media print'));
    expect(printBlock).toMatch(/form\s*\{[\s\S]{0,80}display: none/);
  });
});

describe('input validation (threat T-2-13)', () => {
  it('reports a missing prospect rather than writing a dangling link', async () => {
    const tenantId = await newTenant('Convert Missing Prospect');
    const absent = '00000000-0000-4000-8000-000000000000';

    expect(await convertProspectToTenant(absent, tenantId)).toEqual({
      ok: false,
      kind: 'prospect_not_found',
    });
    expect((await readTenant(tenantId)).prospect_id).toBeNull();
  });

  it('reports a missing tenant rather than clearing a purge clock for nobody', async () => {
    const prospectId = await newProspect();
    await seedProspectLines(prospectId, [
      { purge_after: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    ]);

    const absent = '00000000-0000-4000-8000-000000000001';
    expect(await convertProspectToTenant(prospectId, absent)).toEqual({
      ok: false,
      kind: 'tenant_not_found',
    });

    // The clock is still running. A conversion that half-happened would be a
    // retention policy cancelled for a client that does not exist.
    const lines = await readLines(prospectId);
    expect(lines[0].purge_after).not.toBeNull();
  });

  it('throws on a malformed uuid rather than handing Postgres a 22P02', async () => {
    const tenantId = await newTenant('Convert Malformed');

    await expect(convertProspectToTenant('not-a-uuid', tenantId)).rejects.toThrow(
      /prospect uuid/i,
    );
    await expect(convertProspectToTenant(await newProspect(), 'nope')).rejects.toThrow(
      /tenant uuid/i,
    );
  });
});
