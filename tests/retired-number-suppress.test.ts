/**
 * 15-REVIEW CR-01 — A RETIRED NUMBER IS NEVER WRITTEN AS A SUPPRESSION.
 *
 * PURE. The repository is mocked; the behaviour under test is the one
 * chokepoint every "never chase this human again" path shares
 * (`suppressAndStop` in `src/core/cadence/controls.ts`, reached here through
 * `killContact`, the inbox's soft-opt-out confirm).
 *
 * The privacy pass (D-06) overwrites a closed lead's cadence `contact_mobile`
 * with the caller pseudonym. Before this fix, confirming a soft opt-out on that
 * lead's untriaged reply inserted the 64-hex into `suppressed_contacts` — a row
 * no probe ever matches — and showed the success copy, while the caller's real
 * number stayed textable. The pins:
 *
 *   - a pseudonym mobile is dropped, nothing is written, and the result is the
 *     distinct `number_retired` kind (never `killed` / `already_stopped`);
 *   - a pseudonym mobile beside a real email still suppresses the email only;
 *   - a raw mobile is unaffected (the ordinary kill, unchanged);
 *   - the console maps `number_retired` to its own fixed sentence, an error;
 *   - the inbox reads the row's stamp and offers no suppress control on a
 *     retired row.
 *
 * The DB read-back of the same rule (a confirm on a hashed lead's cadence after
 * the real pass writes no suppression row) lives in `tests/pseudonymise.test.ts`
 * and runs in CI only.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getById = vi.fn();
const insertMany = vi.fn(async (rows: unknown[]) => rows.length);
const stopWhereLive = vi.fn(async (ids: string[]) => ids.map((id) => ({ id })));
const skipUnsentForCadences = vi.fn(async () => [] as Array<{ id: string }>);

const tx = {
  suppression: { insertMany },
  cadences: { stopWhereLive },
  touches: { skipUnsentForCadences },
};

vi.mock('@/db/repository', () => ({
  forTenant: () => ({
    cadences: { getById: (id: string) => getById(id) },
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }),
}));

const { killContact } = await import('@/core/cadence/controls');
const { pseudonymiseCaller } = await import('@/core/leads/pseudonym');
const { KILL_NUMBER_RETIRED_MESSAGE } = await import(
  '@/app/(console)/clients/[id]/quotes/[quoteId]/action-state'
);

const TENANT = '11111111-1111-4111-8111-111111111111';
const CADENCE = '33333333-3333-4333-8333-333333333333';
const RETIRED = pseudonymiseCaller('+61491570351', 'retired-number-suppress-pepper-not-a-secret');

function cadence(overrides: Record<string, unknown>) {
  return {
    id: CADENCE,
    status: 'stopped',
    pauseReason: null,
    stopReason: 'lead_closed',
    contactMobile: null,
    contactEmail: null,
    ...overrides,
  };
}

beforeEach(() => {
  getById.mockReset();
  insertMany.mockClear();
  stopWhereLive.mockClear();
  skipUnsentForCadences.mockClear();
});

describe('the suppression chokepoint drops a retired mobile (CR-01)', () => {
  it('the fixture is a pseudonym', () => {
    expect(RETIRED).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a pseudonym mobile alone: number_retired, nothing written, nothing stopped', async () => {
    getById.mockResolvedValue([cadence({ contactMobile: RETIRED })]);

    expect(await killContact(TENANT, CADENCE)).toEqual({ kind: 'number_retired' });
    expect(insertMany).not.toHaveBeenCalled();
    expect(stopWhereLive).not.toHaveBeenCalled();
  });

  it('a pseudonym mobile beside an email: the email alone is suppressed', async () => {
    getById.mockResolvedValue([
      cadence({ contactMobile: RETIRED, contactEmail: 'someone@example.test' }),
    ]);

    const result = await killContact(TENANT, CADENCE);

    expect(result).toMatchObject({ kind: 'already_stopped', addressesSuppressed: 1 });
    expect(insertMany).toHaveBeenCalledTimes(1);
    const rows = insertMany.mock.calls[0]?.[0] as Array<{ channel: string; address: string }>;
    expect(rows.map((row) => [row.channel, row.address])).toEqual([
      ['email', 'someone@example.test'],
    ]);
    expect(JSON.stringify(rows)).not.toContain(RETIRED);
  });

  it('a raw mobile is unaffected: the ordinary suppression is written', async () => {
    getById.mockResolvedValue([cadence({ contactMobile: '+61491570351' })]);

    expect(await killContact(TENANT, CADENCE)).toMatchObject({
      kind: 'already_stopped',
      addressesSuppressed: 1,
    });
    const rows = insertMany.mock.calls[0]?.[0] as Array<{ channel: string; address: string }>;
    expect(rows.map((row) => [row.channel, row.address])).toEqual([['sms', '+61491570351']]);
  });

  it('no address at all is still no_addresses, not number_retired', async () => {
    getById.mockResolvedValue([cadence({})]);

    expect(await killContact(TENANT, CADENCE)).toEqual({ kind: 'no_addresses' });
  });
});

describe('the console says so, in its own sentence (CR-01)', () => {
  const strip = (path: string) =>
    readFileSync(path, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the fixed sentence names the retirement and promises nothing was suppressed', () => {
    expect(KILL_NUMBER_RETIRED_MESSAGE).toMatch(/retired/);
    expect(KILL_NUMBER_RETIRED_MESSAGE).toMatch(/Nothing changed\.$/);
    expect(KILL_NUMBER_RETIRED_MESSAGE).not.toMatch(/never be chased/);
  });

  it('the kill action maps number_retired to that sentence, as an error', () => {
    const actions = strip('src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts');
    expect(actions).toMatch(
      /case 'number_retired':\s*return \{ \.\.\.BLANK_CONTROL_STATE, error: KILL_NUMBER_RETIRED_MESSAGE \}/,
    );
  });

  it('the inbox reads the stamp and checks it before offering the suppress control', () => {
    const repository = strip('src/db/repository/inbound-messages.ts');
    const start = repository.indexOf('export async function listInboundNeedingTriage');
    const select = repository.slice(start, repository.indexOf('.from(inboundMessages)', start));
    expect(select).toMatch(/pseudonymisedAt: inboundMessages\.pseudonymisedAt/);

    const page = strip('src/app/(console)/inbox/page.tsx');
    expect(page).toMatch(/const retired = row\.pseudonymisedAt !== null \|\| isPseudonym\(row\.fromAddress\);/);
    const retiredArm = page.indexOf('{retired && softOptOut ? (');
    const suppressArm = page.indexOf('softOptOut && row.tenantId && row.cadenceId ? (');
    expect(retiredArm).toBeGreaterThan(-1);
    expect(suppressArm).toBeGreaterThan(retiredArm);
    // The retired arm renders no form.
    expect(page.slice(retiredArm, suppressArm)).not.toMatch(/SuppressContactForm/);
  });

  it('the inbox renders the retired label, never the hash, as the sender (WR-04)', () => {
    const page = strip('src/app/(console)/inbox/page.tsx');

    expect(page).toMatch(/import \{ NUMBER_RETIRED_LABEL \} from '\.\.\/components\/text-back-outcome';/);
    // The sender line checks the stamp BEFORE it can render fromAddress.
    const sender = page.indexOf('{retired ? (\n                    <strong>{NUMBER_RETIRED_LABEL}</strong>');
    const raw = page.indexOf('<strong>{row.fromAddress}</strong>');
    expect(sender).toBeGreaterThan(-1);
    expect(raw).toBeGreaterThan(sender);
    expect(page.match(/\{row\.fromAddress\}/g) ?? []).toHaveLength(1);
    // And no lead link on a retired row.
    expect(page).toMatch(/\{retired \? null : \(\s*<>\s*\{' · '\}\s*<Link href=\{`\/leads#lead-\$\{row\.leadId\}`\}>/);
  });
});
