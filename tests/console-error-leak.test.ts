/**
 * WR-08: no console page renders a raw database error message.
 *
 * ── WHY THIS MATTERED ───────────────────────────────────────────────────────
 *
 * Four pages interpolated `{error.message}` straight into a rendered `<p>`.
 * PostgREST error messages carry column names, constraint names and SQLSTATE
 * detail, and for errors raised inside `SECURITY DEFINER` functions they carry
 * the internals of `is_operator()` and `has_tenant_access()` — the two functions
 * the whole authorization model rests on.
 *
 * That was the one place in the phase where raw error text reached a rendered
 * surface. Every other boundary is rigorous about it: the ServiceM8 client
 * classifies by status code and refuses `String(e)`; `outcomes.ts` refuses to
 * echo an unrecognised stored value; `operator-email.ts` builds its body from a
 * closed vocabulary; the audit action returns only a classified
 * `Sm8FailureKind`. T-2-02 and T-2-16 apply here too.
 *
 * A source scan rather than a render test: the property is "this expression
 * appears nowhere", which is exactly what a render test of the pages someone
 * remembered to write cannot establish.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONSOLE_ROOT = 'src/app/(console)';

/** Every .tsx/.ts file under the console route group. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const CONSOLE_FILES = walk(CONSOLE_ROOT);

/** Strip comments — this file's own prose must not fail its own assertions. */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The pages asserted BY NAME, so none can be deleted quietly.
 *
 * The first four are the ones the Phase 2 review found interpolating
 * `{error.message}`. The two audit-request pages are Phase 9's: they read the
 * one table an unauthenticated stranger can cause a write to, through a single
 * `is_operator()` policy, so a PostgREST error raised on either of them carries
 * the internals of the function the whole authorization model rests on. 09-09
 * wrote the list's assertions into its own suite because 09-04 owned this file
 * in wave 2; 09-06 adds both entries here, where the `it.each` over every
 * console file already runs and the named-page rules can bind.
 */
const NAMED_PAGES = [
  'src/app/(console)/clients/page.tsx',
  'src/app/(console)/audits/page.tsx',
  'src/app/(console)/audits/[id]/page.tsx',
  'src/app/(console)/clients/[id]/page.tsx',
  'src/app/(console)/audits/requests/page.tsx',
  'src/app/(console)/audits/requests/[id]/page.tsx',
] as const;

describe('raw database errors never reach a rendered surface (WR-08)', () => {
  it('finds the console files to scan', () => {
    // Guards against the walk silently returning nothing and every assertion
    // below passing vacuously.
    expect(CONSOLE_FILES.length).toBeGreaterThan(5);
    for (const page of NAMED_PAGES) {
      expect(CONSOLE_FILES).toContain(page);
    }
  });

  it.each(CONSOLE_FILES)('%s does not interpolate error.message into JSX', (path) => {
    expect(code(path)).not.toMatch(/\{\s*error\.message\s*\}/);
  });

  it.each(CONSOLE_FILES)('%s does not interpolate any *.message into JSX', (path) => {
    // Broader than `error.message`: `err.message`, `e.message` and
    // `tenantError.message` are the same leak under a different local name.
    expect(code(path)).not.toMatch(/\{\s*\w+\.message\s*\}/);
  });

  it.each(CONSOLE_FILES)('%s does not render a stringified error', (path) => {
    const source = code(path);
    expect(source).not.toMatch(/\{\s*String\(\s*\w*[Ee]rror\w*\s*\)\s*\}/);
    expect(source).not.toMatch(/\{\s*JSON\.stringify\(\s*\w*[Ee]rror\w*/);
  });

  it.each(NAMED_PAGES)('%s still reports the failure to the operator', (path) => {
    const source = code(path);

    // The fix must not have become "swallow the error". A genuine failure is
    // still not a 404, and the operator still sees that something broke.
    expect(source).toMatch(/Could not load/);
    expect(source).toMatch(/role="alert"/);
  });

  it.each(NAMED_PAGES)('%s logs the error code server-side instead', (path) => {
    // The detail is not discarded, it is relocated: the server log is where an
    // operator (or a future incident) can actually use it.
    expect(code(path)).toMatch(/console\.error\([\s\S]*?error\.code/);
  });

  it.each(NAMED_PAGES)('%s logs the CODE, never the message', (path) => {
    const source = code(path);
    const logs = source.match(/console\.error\([^)]*\)/g) ?? [];

    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      // A code is a short opaque token (`42501`, `PGRST116`). The message is the
      // part that names schema internals, and moving it from the page to the
      // log would only change who leaks it.
      expect(log).not.toContain('.message');
    }
  });
});
