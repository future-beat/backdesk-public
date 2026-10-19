/**
 * A module-resolution hook that teaches plain `node` the `@/*` path alias.
 *
 * WHY THIS EXISTS: the verification scripts must exercise THE REAL CODE — the
 * same `connectServiceM8` the console calls, not a re-implementation of it in
 * script form. A script that reimplements the logic it is verifying proves only
 * that the script works.
 *
 * Node 22.20 strips TypeScript types natively, so `.ts` files import fine on
 * their own. What it does NOT know is `tsconfig.json`'s `paths` mapping, so
 * `@/core/sync/connect` fails to resolve. This hook supplies exactly that one
 * mapping and delegates everything else — no bundler, no transpiler, no new
 * dependency.
 *
 * Registered via `module.register()` from the calling script; see
 * scripts/verify-sm8-connect.mjs.
 */
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);

/** tsconfig `moduleResolution: bundler` semantics, narrowed to what we need. */
const CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * A FILE, specifically. `existsSync` alone is not enough: `@/db/repository`
 * matches the bare candidate because a DIRECTORY of that name exists, and
 * handing node a directory URL fails later with an opaque `EISDIR` from deep
 * inside the loader rather than falling through to `/index.ts`.
 */
function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

/** First candidate that is a real file, or null. */
function firstFile(base) {
  for (const suffix of CANDIDATES) {
    const candidate = new URL(base.href + suffix);
    if (isFile(candidate)) return candidate.href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // `@/x` — the tsconfig alias.
  if (specifier.startsWith('@/')) {
    const resolved = firstFile(new URL(specifier.slice(2), SRC));
    if (resolved) return { url: resolved, shortCircuit: true };
    throw new Error(`ts-alias-hook could not resolve ${specifier} under ${SRC.href}`);
  }

  // `./x` and `../x` WITHOUT an extension. The codebase is written for
  // `moduleResolution: bundler`, where extensionless relative imports are
  // idiomatic; node's ESM resolver requires the extension. Handled here rather
  // than by rewriting ~40 import statements to suit one verification script.
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    const resolved = firstFile(new URL(specifier, context.parentURL));
    if (resolved) return { url: resolved, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

/** The repo root as a file URL — handy for callers registering this hook. */
export const projectRoot = pathToFileURL(fileURLToPath(new URL('../../', import.meta.url)));
