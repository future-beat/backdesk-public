/**
 * Let a `.mjs` verify script import the REAL TypeScript modules.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS EXISTS SO A LIVE PROOF CAN USE PRODUCTION CODE RATHER THAN A        │
 * │ HAND-COPIED APPROXIMATION OF IT.                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `verify-drafting.mjs` used to restate the whitelist rule as
 * `ALLOWED.some((a) => a === t || a.includes(t))` — the substring test that
 * `validate.ts` exists to REJECT ("`45` is a substring of `$2,450`, so a model
 * writing 'I'll be there in 45 minutes' passes"). A proof that is weaker than
 * the thing it proves can print `ok` for output production would refuse, which
 * is worse than having no proof at all.
 *
 * Node 22 strips types from `.ts` files on its own. What it will not do is
 * resolve TypeScript's extensionless relative specifiers (`./gsm7`), because
 * ESM requires a real filename. This hook supplies only that: when a relative
 * specifier fails to resolve and carries no extension, try it again with `.ts`.
 *
 * DELIBERATELY NOT A GENERAL LOADER. No `@/` alias, no `.tsx`, no JSON, no
 * transpilation — a script that needed those would be a script that should be a
 * test. Anything it cannot resolve fails with the original error, so a genuine
 * typo does not silently become a missing-`.ts` report.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    const extensionless = !/\.[cm]?[jt]sx?$/.test(specifier);
    if (relative && extensionless) {
      return await nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
