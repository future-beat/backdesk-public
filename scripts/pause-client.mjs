/**
 * Pause one client through the PRODUCT's own reversible switch (D-06):
 * `pauseClient(tenantId, now)` — two writes in one transaction (cadence_settings
 * paused_at + every active cadence paused with reason client_paused). No SQL of
 * its own. Reversal is `resumeClient` via the console's quote-page control.
 *
 * Requires `--confirm`: this is a production write. Prints the result kind and
 * the count of cadences paused — never a customer, phone or key.
 *
 * Usage: node scripts/pause-client.mjs --tenant <tenant-uuid> --confirm
 */
import { register } from 'node:module';
import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
requireEnv('DATABASE_URL');
register('./lib/ts-alias-hook.mjs', import.meta.url);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const tenantIdx = args.indexOf('--tenant');
const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;
const confirmed = args.includes('--confirm');

if (!tenantId || !/^[0-9a-f-]{36}$/.test(tenantId)) {
  fail('Usage: node scripts/pause-client.mjs --tenant <tenant-uuid> --confirm');
}
if (!confirmed) {
  fail('Refusing: this pauses a client on the connected database. Re-run with --confirm.');
}

const { pauseClient } = await import('@/core/cadence/controls');
const result = await pauseClient(tenantId, new Date());
if (result.kind === 'already_paused') {
  console.log(`tenant ${tenantId}: already paused (no change)`);
} else {
  console.log(`tenant ${tenantId}: paused; cadences paused: ${result.cadencesPaused}`);
}
process.exit(0);
