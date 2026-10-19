/**
 * Phase 13 (research Pitfalls 1 and 7; checker B2) — the console is safe for a
 * row with no quote id.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FAILURE THIS PINS: a lead's touch 2 is promoted, drafted and parked  │
 * │ for approval — and never appears on /queue, because the page dropped     │
 * │ every row without a quote id. It stalls, the digest nags, nothing sends. │
 * │ And the opposite failure: a lead row that IS shown builds a              │
 * │ `/clients/{id}/quotes/null` path, or an operator cannot confirm a        │
 * │ missed caller's soft opt-out because the inbox wanted a quote id.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * No database renders these pages, so the proof is the source itself, read
 * with comments stripped (the `classification-privilege` mould): the narrowing
 * is gone, the types say nullable, and both revalidation helpers keep the UUID
 * guard that turns a lead's empty string into "skip the quote page".
 *
 * PURE: no seed, no database client, no environment.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\}/g, '{}')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const QUEUE_PAGE = code('src/app/(console)/queue/page.tsx');
const QUEUE_CARD = code('src/app/(console)/queue/queue-card.tsx');
const QUEUE_ACTIONS = code('src/app/(console)/queue/actions.ts');
const INBOX_PAGE = code('src/app/(console)/inbox/page.tsx');
const SUPPRESS_FORM = code('src/app/(console)/inbox/suppress-contact-form.tsx');
const QUOTE_ACTIONS = code('src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts');

/** The parameter list of one exported async function, by name. */
function paramsOf(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `${name} is exported`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf(')', start));
}

/** The body of one plain function, by name. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

describe('/queue keeps lead rows (Pitfall 1)', () => {
  it('the page no longer narrows rows by the presence of a quote id', () => {
    expect(QUEUE_PAGE).not.toMatch(/quoteId\s*!==\s*null/);
    expect(QUEUE_PAGE).not.toMatch(/row is typeof row & \{\s*quoteId: string/);
    expect(QUEUE_PAGE).toMatch(/page\.rows\.map\(/);
  });

  it('the page carries the kind and the lead id onto the card', () => {
    expect(QUEUE_PAGE).toMatch(/kind: row\.kind/);
    expect(QUEUE_PAGE).toMatch(/leadId: row\.leadId/);
  });

  it('the card row declares the quote id nullable, beside kind and leadId', () => {
    const rowType = QUEUE_CARD.slice(
      QUEUE_CARD.indexOf('export type QueueCardRow'),
      QUEUE_CARD.indexOf('const URGENCY_BADGE_CLASS'),
    );
    expect(rowType).toMatch(/quoteId: string \| null;/);
    expect(rowType).toMatch(/kind: string;/);
    expect(rowType).toMatch(/leadId: string \| null;/);
  });

  it('a lead card reads as a missed call and builds no quote link', () => {
    expect(QUEUE_CARD).toContain('Missed call · touch');
    // Every quote link goes through the one href, which is null for a lead.
    expect(QUEUE_CARD).toMatch(/row\.kind !== 'lead' && row\.quoteId !== null/);
    expect(QUEUE_CARD).not.toMatch(/href=\{`\/clients\/\$\{row\.tenantId\}\/quotes\/\$\{row\.quoteId\}`\}/);
    // Quote cards keep their link.
    expect(QUEUE_CARD).toContain('Open the quote');
  });
});

describe('the queue actions take a nullable quote id (Pitfall 7)', () => {
  it.each(['approveFromQueue', 'editAndApproveFromQueue', 'skipFromQueue'])(
    '%s declares quoteId: string | null',
    (name) => {
      expect(paramsOf(QUEUE_ACTIONS, name)).toMatch(/quoteId: string \| null/);
    },
  );

  it('revalidateQueue still tests the UUID pattern before building a quote path', () => {
    expect(bodyOf(QUEUE_ACTIONS, 'revalidateQueue')).toMatch(
      /if \(UUID_PATTERN\.test\(quoteId\)\)\s*\{\s*revalidatePath\(`\/clients\/\$\{tenantId\}\/quotes\/\$\{quoteId\}`\)/,
    );
  });

  it('every call passes the empty string for a lead, never null', () => {
    const calls = QUEUE_ACTIONS.match(/revalidateQueue\(tenantId, [^)]*\)/g) ?? [];
    expect(calls.length).toBe(3);
    for (const call of calls) expect(call).toBe("revalidateQueue(tenantId, quoteId ?? '')");
  });
});

describe('the inbox can confirm a lead\'s soft opt-out (D-11; checker B2)', () => {
  it('the suppress condition no longer requires a quote id', () => {
    expect(INBOX_PAGE).toMatch(/softOptOut && row\.tenantId && row\.cadenceId\s*\?/);
    expect(INBOX_PAGE).not.toMatch(/softOptOut && row\.tenantId && row\.cadenceId && row\.quoteId/);
  });

  it('the suppress form declares its quote id nullable and binds it unchanged', () => {
    expect(SUPPRESS_FORM).toMatch(/quoteId: string \| null;/);
    expect(SUPPRESS_FORM).toMatch(/killContactAction\.bind\(null, tenantId, quoteId\)/);
  });

  it('killContactAction declares a nullable quote id and authorizes first', () => {
    const params = paramsOf(QUOTE_ACTIONS, 'killContactAction');
    expect(params).toMatch(/quoteId: string \| null/);

    const start = QUOTE_ACTIONS.indexOf('export async function killContactAction(');
    const body = QUOTE_ACTIONS.slice(start, QUOTE_ACTIONS.indexOf('export async function', start + 10));
    expect(body.indexOf('authorize(tenantId)')).toBeGreaterThan(0);
    expect(body.indexOf('authorize(tenantId)')).toBeLessThan(body.indexOf('readCadenceId(formData)'));
    expect(body).toMatch(/revalidateBoth\(tenantId, quoteId \?\? ''\)/);
  });

  it('revalidateBoth still tests the UUID pattern before building a quote path', () => {
    expect(bodyOf(QUOTE_ACTIONS, 'revalidateBoth')).toMatch(
      /if \(UUID_PATTERN\.test\(quoteId\)\)\s*\{\s*revalidatePath\(`\/clients\/\$\{tenantId\}\/quotes\/\$\{quoteId\}`\)/,
    );
  });
});
