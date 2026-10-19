/**
 * THE TEXT-BACK PATH'S SHAPE, PROVEN BY READING THE SOURCE (Phase 12, D-01/D-02).
 *
 * The classification-privilege mould: a behavioural suite proves what the
 * text-back DID with the inputs a fixture gave it; this proves what it COULD
 * do. Three structural promises, each a decision in CONTEXT.md:
 *
 *   1. NO MODEL IN THE PATH (D-02). Nothing under `src/core/leads` imports the
 *      Anthropic SDK, the drafting pipeline or the classification modules — the
 *      bytes a caller receives are the bytes an operator attested. The ONE
 *      drafting module allowed is `@/core/drafting/gsm7`, the pure septet
 *      counter every SMS in the product is measured with; it calls nothing.
 *   2. NO DEFERRED WORK (D-01). Neither `src/core/leads` nor the voice-status
 *      route uses `waitUntil`: a send is must-happen work, and the tick sweep —
 *      not a best-effort tail on a finished request — is the guarantee.
 *   3. NO SMS ON TWILIO (CONTEXT constraint). Nothing under `src` calls
 *      Twilio's message-sending API. ClickSend through the existing ledger is
 *      the only path a text leaves by.
 *
 * Comments are stripped before every rule, so a header that names what is
 * forbidden (as this one does) is not itself a violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Source with comments stripped, so a mention in prose is not a reference. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every `.ts` / `.tsx` file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

/** Every `from '…'` / `import('…')` specifier in comment-stripped source. */
function importSpecifiers(source: string): string[] {
  return [
    ...[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
}

const LEADS = sourceFiles('src/core/leads');
const ROUTE = 'src/app/api/webhooks/twilio/voice-status/route.ts';

describe('src/core/leads — no model in the text-back path (D-02)', () => {
  it('the directory holds the tracer files', () => {
    for (const file of ['constants.ts', 'gate.ts', 'template.ts', 'text-back.ts']) {
      expect(LEADS).toContain(join('src/core/leads', file));
    }
  });

  // Dated 2026-10 (Phase 15, plan 15-07): the caller-pseudonym leaf (15-02) and
  // the nightly pass (15-07) live here too, so the scans below cover them — the
  // pass is a retention job and must never reach a model either.
  it('the directory holds the Phase 15 privacy files', () => {
    for (const file of ['pseudonym.ts', 'pseudonymise.ts']) {
      expect(LEADS).toContain(join('src/core/leads', file));
    }
  });

  it.each(LEADS)('%s imports no model, drafting pipeline, classifier or framework module', (file) => {
    const specifiers = importSpecifiers(code(file));

    for (const specifier of specifiers) {
      expect(specifier, `${file} imports the Anthropic SDK`).not.toMatch(/^@anthropic-ai\//);
      expect(specifier, `${file} imports the classifier`).not.toMatch(/core\/classification\b/);
      expect(specifier, `${file} imports Next.js`).not.toMatch(/^next(\/|$)/);
      if (/core\/drafting\b/.test(specifier)) {
        // The pure counter only — see the header.
        expect(specifier, `${file} imports the drafting pipeline`).toBe('@/core/drafting/gsm7');
      }
    }
  });

  it('nothing under src/core/leads names a model id or a messages API', () => {
    for (const file of LEADS) {
      const source = code(file);
      expect(source, file).not.toMatch(/claude-|messages\.create|anthropic/i);
    }
  });

  it('the gate is pure: no repository, no clock read, no I/O', () => {
    const gate = code('src/core/leads/gate.ts');
    expect(importSpecifiers(gate).sort()).toEqual(
      ['./constants', '@/core/audit/constants', '@/db/schema'].sort(),
    );
    // The only schema import is type-only.
    expect(gate).toMatch(/import type \{[^}]*\} from '@\/db\/schema'/);
    expect(gate).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });
});

describe('no deferred work in the text-back path (D-01)', () => {
  it.each([...LEADS, ROUTE])('%s does not call waitUntil', (file) => {
    expect(code(file)).not.toMatch(/\bwaitUntil\b/);
  });
});

describe('no SMS on Twilio, anywhere (CONTEXT constraint)', () => {
  const ALL = sourceFiles('src');

  it('scans a real tree', () => {
    expect(ALL.length).toBeGreaterThan(100);
  });

  it.each(ALL)('%s does not call Twilio\'s message-sending API', (file) => {
    const source = code(file);
    expect(source).not.toMatch(/\/Messages(\.json)?\b/);
    expect(source).not.toMatch(/\.messages\s*\.\s*create\s*\(/);
  });
});
