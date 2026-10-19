/**
 * D-06 — THE PSEUDONYMISATION SURFACE, PINNED IN SOURCE (Phase 15, plan 15-03;
 * COMP-02).
 *
 * PURE. Constants and comment-stripped source reads; no database. The DB
 * read-back of the pass (hash written, stamp written, suppression row raw, a
 * new call from that number still refused) is plan 15-07's suite; this file
 * pins the properties that must hold BEFORE any of that can be trusted, and
 * plan 15-07 extends it with the pass module's own pins.
 *
 * ── WHAT IT HOLDS ───────────────────────────────────────────────────────────
 *
 *   (a) THE BOUNDARY IDENTITY. PSEUDONYMISE_AFTER_DAYS >= the negative
 *       cool-off: a lead is hashed only once it is at or past the cool-off,
 *       so no gate window can contain a hashed row — the reason the gate's
 *       per-caller reads compare the raw number and never a hash.
 *   (b) The due-reads name the constant and never a literal day count.
 *   (c) `forTenant().leads.pseudonymise` writes the four tables, every
 *       statement guarded on the lead's stamp being NULL and on the lead not
 *       being open, the `leads` statement last; `missedCalls.pseudonymise` is
 *       one UPDATE guarded on its own stamp. Neither writes the caller's
 *       words.
 *   (d) The suppression table is in no pseudonymisation statement, in either
 *       file — a STOP is kept for as long as it is needed so that it keeps
 *       working.
 *   (e) The gate's two per-caller reads (`latestForMobile`,
 *       `existsTextBackToCallerSince`) still compare the RAW caller with one
 *       equality — no hash, no second spelling, no pepper.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  LEAD_NEGATIVE_COOL_OFF_DAYS,
  PSEUDONYMISE_AFTER_DAYS,
  PSEUDONYMISE_BATCH,
  PSEUDONYMISE_CONVERTED_MAX_DAYS,
} from '../src/core/leads/constants';

const LEADS_FAMILY = 'src/db/repository/leads.ts';
const FOR_TENANT = 'src/db/repository/for-tenant.ts';

/** Source with block and line comments stripped, so prose is not a reference. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** From `start` to the next top-level `export` (a family function's body). */
function familySlice(source: string, start: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} is missing`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf('\nexport ', from + start.length);
  return source.slice(from, to === -1 ? undefined : to);
}

/**
 * From `start` to the next method key at the same six-space indentation, or
 * the namespace's closing brace — one `forTenant()` method implementation.
 */
function methodSlice(source: string, start: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} is missing`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(from + start.length);
  const next = rest.search(/\n {6}[A-Za-z]\w*: |\n {4}\},/);
  return source.slice(from, next === -1 ? undefined : from + start.length + next);
}

const leadsFamily = code(LEADS_FAMILY);
const forTenant = code(FOR_TENANT);

describe('(a) the boundary identity', () => {
  it('pseudonymises no earlier than the negative cool-off ends', () => {
    expect(PSEUDONYMISE_AFTER_DAYS).toBeGreaterThanOrEqual(LEAD_NEGATIVE_COOL_OFF_DAYS);
  });

  it('the converted long-stop (15-REVIEW WR-02) is a year, and above the ordinary boundary', () => {
    // Below the boundary it would hash a customer whose job is still open.
    expect(PSEUDONYMISE_CONVERTED_MAX_DAYS).toBe(365);
    expect(PSEUDONYMISE_CONVERTED_MAX_DAYS).toBeGreaterThan(PSEUDONYMISE_AFTER_DAYS);
  });

  it('works in bounded batches', () => {
    expect(PSEUDONYMISE_BATCH).toBeGreaterThan(0);
    expect(Number.isInteger(PSEUDONYMISE_BATCH)).toBe(true);
  });
});

describe('(b) the due-reads name the boundary constant', () => {
  it.each([
    'export async function listLeadsDueForPseudonymisation',
    'export async function listMissedCallsDueForPseudonymisation',
  ])('%s', (start) => {
    const body = familySlice(leadsFamily, start);

    expect(body).toMatch(/PSEUDONYMISE_AFTER_DAYS/);
    // Never a typed-in day count.
    expect(body).not.toMatch(/[\s(*]90\b/);
    // Guarded on the stamp, and bounded.
    expect(body).toMatch(/isNull\((leads|missedCalls)\.pseudonymisedAt\)/);
    expect(body).toMatch(/\.limit\(limit\)/);
  });

  it('the lead read has its two arms: closed-or-expired, and converted with a finished job', () => {
    const body = familySlice(leadsFamily, 'export async function listLeadsDueForPseudonymisation');

    expect(body).toMatch(/inArray\(leads\.status, \['closed', 'expired'\]\)/);
    expect(body).toMatch(/eq\(leads\.status, 'converted'\)/);
    expect(body).toMatch(/inArray\(quotes\.status, \['Completed', 'Unsuccessful'\]\)/);
    expect(body).toMatch(/quotes\.completionDateUtc/);
    expect(body).not.toMatch(/'open'/);
  });

  it('the lead read has the converted long-stop arm (15-REVIEW WR-02), named by its constant', () => {
    const body = familySlice(leadsFamily, 'export async function listLeadsDueForPseudonymisation');

    expect(body).toMatch(/PSEUDONYMISE_CONVERTED_MAX_DAYS/);
    expect(body).not.toMatch(/[\s(*]365\b/);
    expect(body).toMatch(/const convertedPastLongStop = and\(\s*eq\(leads\.status, 'converted'\),\s*lte\(leads\.closedAt, longStopBoundary\)/);
    expect(body).toMatch(/or\(closedWithoutConverting, convertedWithFinishedJob, convertedPastLongStop\)/);
  });

  it('the missed-call read takes only lead-less calls of a real tenant', () => {
    const body = familySlice(leadsFamily, 'export async function listMissedCallsDueForPseudonymisation');

    expect(body).toMatch(/isNotNull\(missedCalls\.tenantId\)/);
    expect(body).toMatch(/isNull\(missedCalls\.leadId\)/);
  });
});

describe('(c) the writes are guarded on the stamp', () => {
  const leadWrite = methodSlice(forTenant, 'pseudonymise: async (leadId');
  const callWrite = methodSlice(forTenant, 'pseudonymise: (id: string, hashes');

  it('the lead write updates the four tables, the lead LAST', () => {
    const updates = [...leadWrite.matchAll(/\.update\((\w+)\)/g)].map((match) => match[1]);

    // MOVED 2026-10-15 (15-REVIEW WR-01): a second `inbound_messages`
    // statement, before the lead's own (it reads the lead's raw number), for
    // the late replies from that number we could not place.
    expect(updates).toEqual(['inboundMessages', 'inboundMessages', 'cadences', 'sendLedger', 'leads']);
  });

  it('the late-reply statement (WR-01) reaches only unplaced, lead-less, quote-less, unstamped rows of THIS due lead\'s number', () => {
    const late = leadWrite.slice(
      leadWrite.indexOf('const lateReplyRows'),
      leadWrite.indexOf('const cadenceRows'),
    );

    expect(late).toMatch(/isNull\(inboundMessages\.tenantId\)/);
    expect(late).toMatch(/isNull\(inboundMessages\.leadId\)/);
    expect(late).toMatch(/isNull\(inboundMessages\.quoteId\)/);
    expect(late).toMatch(/isNull\(inboundMessages\.cadenceId\)/);
    expect(late).toMatch(/isNull\(inboundMessages\.pseudonymisedAt\)/);
    expect(late).toMatch(/eq\(inboundMessages\.attribution, 'unmatched'\)/);
    expect(late).toMatch(/eq\(inboundMessages\.attribution, 'ambiguous'\)/);
    expect(late).toMatch(/lateReplyOfDueLead\(\)/);

    const binding = leadWrite.slice(
      leadWrite.indexOf('const lateReplyOfDueLead'),
      leadWrite.indexOf('const lateReplyRows'),
    );
    // The lead's own guard, its raw number, and its first call as the floor.
    expect(binding).toMatch(/leadIsDue/);
    expect(binding).toMatch(/eq\(leads\.contactMobile, inboundMessages\.normalizedFrom\)/);
    expect(binding).toMatch(/gte\(inboundMessages\.receivedAt, leads\.firstMissedAt\)/);
    expect(binding).toMatch(/PSEUDONYMISE_AFTER_DAYS/);
    expect(binding).not.toMatch(/[\s(*]90\b/);
  });

  it('every lead-write statement carries the guard: not open, unstamped', () => {
    expect(leadWrite).toMatch(/ne\(leads\.status, 'open'\)/);
    expect(leadWrite).toMatch(/isNull\(leads\.pseudonymisedAt\)/);
    expect(leadWrite).toMatch(/isNull\(inboundMessages\.pseudonymisedAt\)/);
    expect((leadWrite.match(/isNull\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Statements 1–3 carry the lead's guard through an EXISTS each.
    expect((leadWrite.match(/dueLead\(\)/g) ?? []).length).toBe(3);
    // The hash and the stamp land in ONE statement on the lead.
    const leadUpdate = leadWrite.slice(leadWrite.indexOf('.update(leads)'));
    expect(leadUpdate).toMatch(/contactMobile: input\.contactHash/);
    expect(leadUpdate).toMatch(/pseudonymisedAt: input\.at/);
  });

  it('never writes the caller\'s words', () => {
    expect(leadWrite).not.toMatch(/body/i);
    expect(callWrite).not.toMatch(/body/i);
  });

  it('the missed-call write is one UPDATE, guarded on its own stamp', () => {
    expect((callWrite.match(/\.update\(/g) ?? []).length).toBe(1);
    expect(callWrite).toMatch(/\.update\(missedCalls\)/);
    expect(callWrite).toMatch(/isNull\(missedCalls\.pseudonymisedAt\)/);
    expect(callWrite).toMatch(/eq\(missedCalls\.tenantId, tenantId\)/);
  });

  it('the raw-string read takes only this tenant\'s unstamped calls of the lead', () => {
    const read = methodSlice(forTenant, 'listRawForLead: (leadId');

    expect(read).toMatch(/callerE164: missedCalls\.callerE164/);
    expect(read).toMatch(/callerRaw: missedCalls\.callerRaw/);
    expect(read).toMatch(/forwardedFromRaw: missedCalls\.forwardedFromRaw/);
    expect(read).toMatch(/isNull\(missedCalls\.pseudonymisedAt\)/);
  });

  it('the pepper never enters the repository — hashes arrive as arguments', () => {
    expect(forTenant).not.toMatch(/PEPPER|createHmac|pseudonymiseCaller/);
    expect(leadsFamily).not.toMatch(/PEPPER|createHmac|pseudonymiseCaller/);
  });
});

describe('(d) the suppression table is in no pseudonymisation statement', () => {
  const slices = [
    familySlice(leadsFamily, 'export async function listLeadsDueForPseudonymisation'),
    familySlice(leadsFamily, 'export async function listMissedCallsDueForPseudonymisation'),
    methodSlice(forTenant, 'pseudonymise: async (leadId'),
    methodSlice(forTenant, 'pseudonymise: (id: string, hashes'),
    methodSlice(forTenant, 'listRawForLead: (leadId'),
  ];

  it.each(slices.map((slice, i) => [i, slice] as const))('slice %i', (_i, slice) => {
    expect(slice).not.toMatch(/suppressed_contacts|suppressedContacts|suppression/i);
  });

  it('the lead family names no suppression table at all', () => {
    expect(leadsFamily).not.toMatch(/suppressed_contacts|suppressedContacts/);
  });
});

describe('(e) the gate\'s per-caller reads compare the raw caller, once', () => {
  it('latestForMobile is one equality on the stored mobile', () => {
    const read = methodSlice(forTenant, 'latestForMobile: (contactMobile');

    expect(read).toMatch(/eq\(leads\.contactMobile, contactMobile\)/);
    expect(read).not.toMatch(/inArray\(leads\.contactMobile/);
    expect(read).not.toMatch(/hash|pseudonym/i);
  });

  it('existsTextBackToCallerSince is one equality on the stored caller', () => {
    const read = methodSlice(forTenant, 'existsTextBackToCallerSince: async (caller');

    expect(read).toMatch(/eq\(missedCalls\.callerE164, caller\)/);
    expect(read).not.toMatch(/inArray\(missedCalls\.callerE164/);
    expect(read).not.toMatch(/hash|pseudonym/i);
  });
});

/**
 * (f) THE PASS ITSELF — dated extension, 2026-10 (Phase 15, plan 15-07; D-06,
 * research Q6). `src/core/leads/pseudonymise.ts` is the nightly job that makes
 * the retention promise true; these pins keep a later edit from quietly
 * breaking it: it imports only the hash leaf, the constants and the repository
 * barrel (no SDK, no environment — the pepper is an argument read once at the
 * route); it reads through the two due-reads, each bounded by the batch; one
 * transaction per lead; it names no suppression table; and no log line can
 * carry a number, a hash or an id, because none is a template literal.
 */
describe('(f) the pass module (plan 15-07)', () => {
  const PASS = 'src/core/leads/pseudonymise.ts';
  const raw = readFileSync(PASS, 'utf8');
  const pass = code(PASS);

  /** Every `from '…'` specifier on a VALUE import (type-only imports excluded). */
  function valueImports(source: string): string[] {
    return [...source.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map(
      (match) => match[1],
    );
  }

  it('value-imports the hash leaf, the constants and the repository barrel — nothing else', () => {
    expect(valueImports(pass).sort()).toEqual(['./constants', './pseudonym', '@/db/repository'].sort());
    expect(pass).not.toMatch(/import\(/);
  });

  it('reads through each due-read exactly once, each bounded by the batch', () => {
    expect(pass.match(/listLeadsDueForPseudonymisation\(/g) ?? []).toHaveLength(1);
    expect(pass.match(/listMissedCallsDueForPseudonymisation\(/g) ?? []).toHaveLength(1);
    expect(pass).toMatch(/listLeadsDueForPseudonymisation\([^)]*PSEUDONYMISE_BATCH\)/);
    expect(pass).toMatch(/listMissedCallsDueForPseudonymisation\([^)]*PSEUDONYMISE_BATCH\)/);
  });

  it('opens exactly one transaction — one per lead, in the lead loop', () => {
    expect(pass.match(/\.transaction\(/g) ?? []).toHaveLength(1);
  });

  it('hashes through the one leaf, and never builds its own HMAC', () => {
    expect((pass.match(/pseudonymiseCaller\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(pass).not.toMatch(/createHmac|node:crypto/);
  });

  it('never reads the environment', () => {
    expect(pass).not.toMatch(/getServerEnv/);
    expect(pass).not.toMatch(/process\.env/);
  });

  it('names no suppression table — a STOP is kept so it keeps working', () => {
    expect(pass).not.toMatch(/suppressed/i);
    expect(raw).not.toMatch(/suppressed_contacts|suppressedContacts/);
  });

  it('imports no model SDK', () => {
    expect(pass).not.toMatch(/@anthropic-ai/);
  });

  it('no log line is a template literal — counts ride as a separate argument', () => {
    // `${` on EVERY line naming `console.` — comments included, as the plan's
    // grep reads it; a backtick on every CODE line (prose may quote a call).
    for (const line of raw.split('\n').filter((l) => l.includes('console.'))) {
      expect(line, line).not.toContain('${');
    }
    const logLines = pass.split('\n').filter((line) => line.includes('console.'));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line, line).not.toContain('`');
      expect(line, line).toMatch(/console\.(log|error)\('\[pseudonymise\] [a-z_ ]+'(, result\.\w+)?\);/);
    }
  });

  it('never throws: the exported pass catches everything and returns the FAILED shape', () => {
    expect(pass).toMatch(/export async function runPseudonymisationPass/);
    expect(pass).toMatch(/catch\s*\{\s*console\.error\('\[pseudonymise\] pass failed'\);\s*return PSEUDONYMISE_FAILED;/);
  });

  it('checks the pepper once, before any read (15-REVIEW IN-01)', () => {
    const check = pass.indexOf("if (pepper.length < PEPPER_MIN_CHARS) throw new Error('pseudonym: pepper too short');");
    expect(check).toBeGreaterThan(-1);
    expect(pass.indexOf('listLeadsDueForPseudonymisation(')).toBeGreaterThan(check);
  });

  it('does not defer work', () => {
    expect(pass).not.toMatch(/\bwaitUntil\b/);
  });
});
