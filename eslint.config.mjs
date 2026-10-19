import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Import specifiers that reach the raw, RLS-bypassing database client.
 * Covers the `@/` alias and every relative depth (`../`, `../../`, …), with and
 * without an explicit extension.
 */
const RAW_DB_CLIENT_PATTERNS = [
  "@/db/repository/client",
  "@/db/repository/client.*",
  "**/db/repository/client",
  "**/db/repository/client.*",
];

const RAW_DB_CLIENT_MESSAGE =
  "The raw database client is module-private to src/db/repository. It connects as a " +
  "service-role-equivalent login and BYPASSES RLS, so an unscoped query here is a " +
  "cross-tenant leak. Import { forTenant } from '@/db/repository' instead (ONB-05).";

/**
 * The repository's implementation modules, reachable only through the barrel.
 *
 * `src/db/repository/index.ts` exists so a reviewer can read ONE file and see
 * the whole sanctioned data surface — including, on their own lines, the few
 * cross-tenant exceptions. A deep import is a second door into that surface, and
 * the barrel stops being the answer to "what can application code reach" the
 * moment one exists.
 */
const DEEP_REPOSITORY_PATTERNS = [
  "@/db/repository/*",
  "**/db/repository/for-tenant",
  "**/db/repository/for-tenant.*",
  "**/db/repository/for-all-tenants",
  "**/db/repository/for-all-tenants.*",
  "**/db/repository/consumer-cursor",
  "**/db/repository/consumer-cursor.*",
  "**/db/repository/conversion",
  "**/db/repository/conversion.*",
  "**/db/repository/prospects",
  "**/db/repository/prospects.*",
  // Phase 9. `audit-uploads` lands in 09-03; banning its deep import now costs
  // nothing and means the barrel is the only door on the day it exists.
  "**/db/repository/audit-requests",
  "**/db/repository/audit-requests.*",
  "**/db/repository/audit-uploads",
  "**/db/repository/audit-uploads.*",
];

const DEEP_REPOSITORY_MESSAGE =
  "Import from '@/db/repository' (the barrel), not from a module inside it. The barrel " +
  "is the audited surface — one file a reviewer can read to see everything application " +
  "code may reach, cross-tenant exceptions included. A deep import is a second door.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // ONB-05 control 2 of 3: raw table access is lint-banned outside the
    // repository layer (01-RESEARCH.md Pattern 3). Control 1 is the forTenant
    // closure; control 3 is the two-tenant leak test.
    name: "tenant-isolation/ban-raw-db-client",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: RAW_DB_CLIENT_PATTERNS,
              message: RAW_DB_CLIENT_MESSAGE,
            },
            {
              group: DEEP_REPOSITORY_PATTERNS,
              message: DEEP_REPOSITORY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // Region-scoped allow: the repository owns its own client.
    name: "tenant-isolation/repository-owns-its-client",
    files: ["src/db/repository/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
