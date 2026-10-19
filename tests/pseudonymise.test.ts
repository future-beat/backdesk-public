/**
 * D-06 — THE NIGHTLY PSEUDONYMISATION PASS, READ BACK FROM A REAL DATABASE
 * (Phase 15, plan 15-07; COMP-02).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   HASHED — past the boundary, on EVERY carrier, stamped:
 *     (a) a lead closed `not_a_lead` 91 days ago;
 *     (c) a lead converted `job_created` whose mirrored job reached Completed
 *         91 days ago;
 *     (f) a lead closed `opt_out` 91 days ago (its STOP row is kept raw);
 *     (h) a lead closed `spam` 91 days ago at a SECOND tenant (the pass is
 *         global; the per-tenant transaction binds the right tenant);
 *     (k) a lead converted `booked_by_tradie` 366 days ago whose job is still
 *         a Work Order in the mirror — the long-stop (15-REVIEW WR-02): a
 *         customer's number is kept no longer than
 *         PSEUDONYMISE_CONVERTED_MAX_DAYS after they converted, job finished
 *         or not.
 *     For each: `leads.contact_mobile` is the 64-hex HMAC of the number and
 *     `pseudonymised_at` is the pass's instant; its missed call's
 *     `caller_e164`, `caller_raw` and `forwarded_from_raw` are each the HMAC
 *     of THEIR OWN seeded string, stamped; its inbound row's `from_address`
 *     and `normalized_from` are the hash, the `body` byte-identical, stamped;
 *     its lead cadence's `contact_mobile` and its ledger row's `to_address`
 *     are the hash.
 *   STAMPED, ONE ROW AT A TIME — lead-less calls past the boundary:
 *     (e) a WITHHELD call: `caller_e164` stays NULL, `caller_kind` stays
 *         `withheld` (the CHECK held), `caller_raw` and `forwarded_from_raw`
 *         hashed;
 *     (e2) an other-number call: `caller_e164` hashed.
 *   UNTOUCHED — every carrier byte-identical, `pseudonymised_at` NULL:
 *     (b) closed 89 days ago — inside the boundary;
 *     (d) converted `booked_by_tradie`, the job still a Work Order;
 *     (d2) converted, the job Completed only 30 days ago;
 *     (g) an OPEN lead whose first call was 100 days ago — never hashed;
 *     (e3) a lead-less mobile call 10 days ago.
 *   KEPT — the STOP row for (f)'s number still holds the raw number.
 *   IDEMPOTENT — a second run at the same instant counts nothing and changes
 *     no column of (a)'s rows (full rows compared, `updated_at` included).
 *   THE GATE — a new call from (f)'s number, after the hash, is still skipped
 *     `suppressed` and opens no lead: a hashed STOP caller is still refused,
 *     through the suppression row kept raw (research Q6's ruling).
 *   LATE REPLIES (15-REVIEW WR-01) — replies from a due lead's number that we
 *     could not place (tenant, lead, quote and cadence all NULL):
 *     (a-late) `unmatched`, two days after (a) closed — hashed with (a);
 *     (h-amb) `ambiguous` naming (h)'s client — hashed with (h);
 *     (a-fresh) `unmatched` from (a)'s number twelve hours ago, past (a)'s
 *     close + ninety days — untouched;
 *     (b-late) `unmatched` from (b)'s number — untouched, (b) is not due;
 *     (h-other) `ambiguous` from (h)'s number naming only the OTHER client —
 *     untouched. Tenant-less rows: deleted by id in `afterAll`.
 *   RETIRED (15-REVIEW CR-01) — a soft-opt-out confirm (`killContact`) on
 *     (a)'s hashed cadence reports `number_retired` and writes no
 *     suppression row: a hash is never stored as an address.
 *   SILENT — no `console.*` line emitted by either run carries a `+61`, a
 *     nine-digit run, a 64-hex string or a seeded id.
 *
 * ── WHY THE COUNTS ARE COMPARED AGAINST A PRE-READ ──────────────────────────
 *
 * The pass is GLOBAL (it reads every tenant's due rows), and this suite shares
 * one database with every other suite. Before the first run the two due-reads
 * are called directly at the same instant: they must hold THIS suite's due
 * rows and none of its untouched ones (the boundary proven at the read), and
 * the pass's counts are asserted exactly against that pre-read — this suite's
 * own rows plus any other suite's due row, whose children are counted the
 * same way. On a clean CI database the foreign share is zero and the counts
 * are this suite's seeds exactly. The pre-read's rows carry raw numbers; they
 * are kept in memory, compared by id, and never printed.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms text-back and SMS identity rows — and runs a pass that
 * rewrites every due caller number in the database it is pointed at, for
 * good. Those rows are TENANT-SCOPED, carry fiction-block numbers and are
 * deleted BY ID in `afterAll`, first (`messaging_config` has no FK); the STOP
 * row is deleted by id before the tenants.
 *
 * The pepper is a test literal handed to the pass directly — never read from
 * the environment (the CI dummy exists for the route, not for this suite).
 * The sender is a recording sender whose `provider` is a real provider name,
 * so nothing is dialled. The clock is pinned. Every number is from ACMA's
 * fiction block, in the Phase 15 sub-blocks 0491 570 35x–36x no other suite
 * uses (research Pitfall 10); every word is invented.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { killContact } from '../src/core/cadence/controls';
import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { PSEUDONYMISE_BATCH } from '../src/core/leads/constants';
import { pseudonymiseCaller } from '../src/core/leads/pseudonym';
import { runPseudonymisationPass, type PseudonymisationResult } from '../src/core/leads/pseudonymise';
import { sendTextBack } from '../src/core/leads/text-back';
import {
  closeDb,
  listLeadsDueForPseudonymisation,
  listMissedCallsDueForPseudonymisation,
  upsertChannelConfig,
} from '../src/db/repository';

import {
  admin,
  seedInbound,
  seedLead,
  seedLeadCadence,
  seedLedgerRow,
  seedMissedCall,
  seedQuotes,
  seedSuppression,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  teardownTenants,
} from './helpers/seed';
import type { MissedCallSeedOptions } from './helpers/seed';

const MS_PER_DAY = 86_400_000;

/** THE PINNED CLOCK: Tuesday 20 October 2026, 08:00 in Perth (00:00 UTC). */
const NOW = new Date('2026-10-20T00:00:00.000Z');

/** The test pepper — a literal over the floor, not hex, not a secret. */
const P = 'pseudonymise-readback-suite-pepper-not-a-secret';

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

function daysAgo(days: number): Date {
  return at(NOW, -days * MS_PER_DAY);
}

const hash = (value: string): string => pseudonymiseCaller(value, P);

/** The SMS number the gate check's text-back would leave from — fiction block. */
const SMS_FROM = '+61491570369';

/** One fiction-block mobile per scenario. */
const A_CLOSED_PAST = '+61491570351';
const B_CLOSED_INSIDE = '+61491570352';
const C_CONVERTED_DONE = '+61491570353';
const D_CONVERTED_OPEN_JOB = '+61491570354';
const D2_CONVERTED_RECENT_JOB = '+61491570355';
const E3_LEADLESS_RECENT = '+61491570357';
const F_OPT_OUT = '+61491570358';
const G_OPEN = '+61491570359';
const H_OTHER_TENANT = '+61491570361';
/** 15-REVIEW WR-02: the converted long-stop. */
const K_CONVERTED_LONG_STOP = '+61491570362';
/** A lead-less landline-shaped caller (other_number). */
const E2_OTHER_NUMBER = '+61891570356';
/** The raw `ForwardedFrom` every seeded call carries, unless null. */
const FORWARDED = '+61891570350';
/** The withheld call's forwarding number — its own string, its own hash. */
const FORWARDED_WITHHELD = '+61891570360';

/** How a provider might spell the number in `caller_raw` — a different string. */
function rawSpelling(mobile: string): string {
  const local = `0${mobile.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

const tenantIds: string[] = [];
const configIds: string[] = [];
const suppressionIds: string[] = [];
/** Tenant-less inbound rows (WR-01): no tenant teardown reaches them. */
const lateIds: string[] = [];
const seededIds: string[] = [];

/** A sender that records what it was asked to send, as a real provider would receive it. */
class RecordingSender implements TouchSender {
  readonly provider = 'clicksend';
  readonly sent: SendRequest[] = [];

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return {
      kind: 'sent',
      provider: 'clicksend',
      providerMessageId: `cs-${request.ledgerId.slice(0, 8)}`,
    };
  }
}

/* -------------------------------------------------------------------------- *
 * Reads, all keyed on this suite's ids
 * -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

async function rowById(table: string, id: string): Promise<Row> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).single();
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return data as Row;
}

function ms(value: unknown): number {
  return new Date(String(value)).getTime();
}

/** Rows of `table` belonging to `leadIds`, as the pass would reach them — for the foreign share. */
async function countForLeads(
  table: 'missed_calls' | 'inbound_messages' | 'cadences' | 'send_ledger',
  leadIds: string[],
): Promise<number> {
  if (leadIds.length === 0) return 0;
  let query = admin.from(table).select('id', { count: 'exact', head: true }).in('lead_id', leadIds);
  if (table === 'missed_calls' || table === 'inbound_messages') query = query.is('pseudonymised_at', null);
  if (table === 'cadences') query = query.eq('kind', 'lead');
  const { count, error } = await query;
  if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
  return count ?? 0;
}

/** Unplaced, unstamped replies from these numbers — the WR-01 foreign share. */
async function countUnplacedFrom(mobiles: string[]): Promise<number> {
  if (mobiles.length === 0) return 0;
  const { count, error } = await admin
    .from('inbound_messages')
    .select('id', { count: 'exact', head: true })
    .is('tenant_id', null)
    .is('lead_id', null)
    .is('quote_id', null)
    .is('pseudonymised_at', null)
    .in('attribution', ['unmatched', 'ambiguous'])
    .in('normalized_from', mobiles);
  if (error) throw new Error(`Counting unplaced replies failed: ${error.message}`);
  return count ?? 0;
}

/* -------------------------------------------------------------------------- *
 * Seeds
 * -------------------------------------------------------------------------- */

interface Carriers {
  leadId: string;
  callId: string;
  cadenceId: string;
  inboundId: string;
  ledgerId: string;
  mobile: string;
  callerRaw: string;
  body: string;
}

/**
 * A lead with its FULL carrier set: one missed call (`caller_raw` and
 * `forwarded_from_raw` set), a lead cadence, one threaded inbound row with an
 * invented body, one ledger row — every handle the caller's number lives on.
 */
async function leadWithCarriers(
  tenantId: string,
  mobile: string,
  leadOverrides: Record<string, unknown>,
  firstMissedAt: Date,
  body: string,
): Promise<Carriers> {
  const leadId = await seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: firstMissedAt.toISOString(),
    last_missed_at: firstMissedAt.toISOString(),
    ...leadOverrides,
  });
  const callerRaw = rawSpelling(mobile);
  const callId = await seedMissedCall(
    tenantId,
    { lead_id: leadId, caller_raw: callerRaw },
    {
      caller: mobile,
      forwardedFrom: FORWARDED,
      afterHours: false,
      startedAt: firstMissedAt,
      endedAt: at(firstMissedAt, 20_000),
    },
  );
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: mobile,
    anchor_at: firstMissedAt.toISOString(),
  });
  const inboundId = await seedInbound(tenantId, {
    cadenceId,
    quoteId: null,
    leadId,
    receivedAt: at(firstMissedAt, 3_600_000).toISOString(),
    fromAddress: mobile,
    body,
  });
  const ledgerId = await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: null,
    leadId,
    touchNumber: 1,
    claimedAt: at(firstMissedAt, 60_000).toISOString(),
    toAddress: mobile,
    outcome: 'sent',
  });
  seededIds.push(leadId, callId, cadenceId, inboundId, ledgerId);
  return { leadId, callId, cadenceId, inboundId, ledgerId, mobile, callerRaw, body };
}

/** A closed (not converted) lead with its carriers, closed `closedDaysAgo` days ago. */
function closedWithCarriers(
  tenantId: string,
  mobile: string,
  reason: string,
  closedDaysAgo: number,
  body: string,
): Promise<Carriers> {
  return leadWithCarriers(
    tenantId,
    mobile,
    { status: 'closed', closed_reason: reason, closed_at: daysAgo(closedDaysAgo).toISOString() },
    daysAgo(closedDaysAgo + 2),
    body,
  );
}

/** A converted lead linked to a seeded mirror job of `quoteStatus`. */
async function convertedWithCarriers(
  tenantId: string,
  mobile: string,
  reason: 'job_created' | 'booked_by_tradie',
  quote: Record<string, unknown>,
  body: string,
  convertedDaysAgo = 120,
): Promise<Carriers> {
  const [job] = await seedQuotes(tenantId, [quote]);
  if (job === undefined) throw new Error('Seeding the mirrored job returned no row');
  const closedAt = daysAgo(convertedDaysAgo);
  return leadWithCarriers(
    tenantId,
    mobile,
    {
      status: 'converted',
      closed_reason: reason,
      closed_at: closedAt.toISOString(),
      sm8_job_uuid: job.sm8_job_uuid,
      ...(reason === 'job_created'
        ? { sm8_job_state: 'created', sm8_job_created_at: closedAt.toISOString() }
        : {}),
    },
    daysAgo(convertedDaysAgo + 2),
    body,
  );
}

/** Every carrier row of one lead, by id. */
async function carriersOf(c: Carriers): Promise<Record<'lead' | 'call' | 'cadence' | 'inbound' | 'ledger', Row>> {
  return {
    lead: await rowById('leads', c.leadId),
    call: await rowById('missed_calls', c.callId),
    cadence: await rowById('cadences', c.cadenceId),
    inbound: await rowById('inbound_messages', c.inboundId),
    ledger: await rowById('send_ledger', c.ledgerId),
  };
}

/**
 * A reply we could not place (15-REVIEW WR-01): no tenant, no lead, no quote,
 * no cadence — `unmatched`, or `ambiguous` naming `candidates`. Tenant-less, so
 * deleted by id in `afterAll`.
 */
async function seedUnplacedReply(
  mobile: string,
  receivedAt: Date,
  body: string,
  candidates: string[] | null = null,
): Promise<string> {
  const { data, error } = await admin
    .from('inbound_messages')
    .insert({
      tenant_id: null,
      cadence_id: null,
      quote_id: null,
      lead_id: null,
      received_at: receivedAt.toISOString(),
      attribution: candidates === null ? 'unmatched' : 'ambiguous',
      matched_cadence_count: candidates === null ? 0 : 2,
      candidate_tenant_ids: candidates,
      channel: 'sms',
      from_address: rawSpelling(mobile),
      normalized_from: mobile,
      body,
      is_stop: false,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Seeding an unplaced reply failed: ${error.message}`);
  const id = (data as { id: string }).id;
  lateIds.push(id);
  seededIds.push(id);
  return id;
}

/* -------------------------------------------------------------------------- *
 * The fixture, the pre-read, both runs
 * -------------------------------------------------------------------------- */

let armedTenantId: string;
let otherTenantId: string;

let a: Carriers;
let b: Carriers;
let c: Carriers;
let d: Carriers;
let d2: Carriers;
let f: Carriers;
let g: Carriers;
let h: Carriers;
let k: Carriers;
let eWithheld: string;
let eOther: string;
let eRecent: string;
let aLate: string;
let aFresh: string;
let bLate: string;
let hAmbiguous: string;
let hOther: string;

/** Every seeded row's state BEFORE the pass — what an untouched row must still equal. */
const before = new Map<string, Row>();

let dueLeadIds: string[] = [];
let dueCallIds: string[] = [];
let expected: PseudonymisationResult;
let first: PseudonymisationResult;
let second: PseudonymisationResult;
let aAfterFirst: Awaited<ReturnType<typeof carriersOf>>;
let aAfterSecond: Awaited<ReturnType<typeof carriersOf>>;
let logLines: string[] = [];

async function snapshot(table: string, id: string): Promise<void> {
  before.set(`${table}:${id}`, await rowById(table, id));
}

async function snapshotCarriers(x: Carriers): Promise<void> {
  await snapshot('leads', x.leadId);
  await snapshot('missed_calls', x.callId);
  await snapshot('cadences', x.cadenceId);
  await snapshot('inbound_messages', x.inboundId);
  await snapshot('send_ledger', x.ledgerId);
}

beforeAll(async () => {
  armedTenantId = await seedTenant('Pseudonymise Readback');
  tenantIds.push(armedTenantId);
  // The gate check below needs an ARMED client: text_back on, an SMS identity
  // that resolves, attested wording. TENANT-SCOPED, deleted by id in afterAll.
  configIds.push(await seedTextBackArmed(armedTenantId));
  const sms = await upsertChannelConfig({
    channel: 'sms',
    tenantId: armedTenantId,
    fromAddress: SMS_FROM,
    enabled: true,
  });
  configIds.push(sms.id);
  await seedTextBackTemplates(armedTenantId);

  otherTenantId = await seedTenant('Pseudonymise Readback Other');
  tenantIds.push(otherTenantId);

  a = await closedWithCarriers(armedTenantId, A_CLOSED_PAST, 'not_a_lead', 91, 'Quibble about the marmalade gutter');
  b = await closedWithCarriers(armedTenantId, B_CLOSED_INSIDE, 'other', 89, 'Zephyr lantern for the shed roof');
  c = await convertedWithCarriers(
    armedTenantId,
    C_CONVERTED_DONE,
    'job_created',
    { status: 'Completed', completion_date_utc: daysAgo(91).toISOString() },
    'Ochre trellis wobbles near the plinth',
  );
  d = await convertedWithCarriers(
    armedTenantId,
    D_CONVERTED_OPEN_JOB,
    'booked_by_tradie',
    { status: 'Work Order' },
    'Tangerine conduit hums at dusk',
  );
  d2 = await convertedWithCarriers(
    armedTenantId,
    D2_CONVERTED_RECENT_JOB,
    'job_created',
    { status: 'Completed', completion_date_utc: daysAgo(30).toISOString() },
    'Velvet bracket rattles in the eaves',
  );
  f = await closedWithCarriers(armedTenantId, F_OPT_OUT, 'opt_out', 91, 'STOP');
  await seedSuppression(armedTenantId, [{ channel: 'sms', address: F_OPT_OUT, reason: 'readback STOP' }]);
  const { data: stopRows, error: stopError } = await admin
    .from('suppressed_contacts')
    .select('id')
    .eq('tenant_id', armedTenantId)
    .eq('channel', 'sms');
  if (stopError) throw new Error(`Reading the STOP row failed: ${stopError.message}`);
  suppressionIds.push(...((stopRows ?? []) as Array<{ id: string }>).map((row) => row.id));

  g = await leadWithCarriers(armedTenantId, G_OPEN, {}, daysAgo(100), 'Indigo spigot drips on Sundays');
  h = await closedWithCarriers(otherTenantId, H_OTHER_TENANT, 'spam', 91, 'Saffron widget offer, act now');
  // WR-02: converted a year and a day ago, the job never finished in the mirror.
  k = await convertedWithCarriers(
    armedTenantId,
    K_CONVERTED_LONG_STOP,
    'booked_by_tradie',
    { status: 'Work Order' },
    'Cobalt rafter creaks at noon',
    366,
  );

  // A WITHHELD caller: no number at all, so the CHECK keeps `caller_e164` NULL.
  const withheld: MissedCallSeedOptions = {
    caller: null,
    forwardedFrom: FORWARDED_WITHHELD,
    afterHours: false,
    startedAt: daysAgo(91),
  };
  eWithheld = await seedMissedCall(armedTenantId, { caller_raw: 'anonymous' }, withheld);
  eOther = await seedMissedCall(
    armedTenantId,
    { caller_raw: '08 9157 0356' },
    { caller: E2_OTHER_NUMBER, forwardedFrom: null, afterHours: false, startedAt: daysAgo(91) },
  );
  eRecent = await seedMissedCall(
    armedTenantId,
    { caller_raw: rawSpelling(E3_LEADLESS_RECENT) },
    { caller: E3_LEADLESS_RECENT, forwardedFrom: FORWARDED, afterHours: false, startedAt: daysAgo(10) },
  );
  seededIds.push(armedTenantId, otherTenantId, eWithheld, eOther, eRecent);

  // WR-01: replies we could not place, from the leads' own numbers.
  aLate = await seedUnplacedReply(A_CLOSED_PAST, daysAgo(89), 'Cheers, the marmalade gutter is sorted');
  aFresh = await seedUnplacedReply(A_CLOSED_PAST, at(NOW, -12 * 3_600_000), 'Rhubarb downpipe, new one');
  bLate = await seedUnplacedReply(B_CLOSED_INSIDE, daysAgo(88), 'Lantern all good now');
  hAmbiguous = await seedUnplacedReply(H_OTHER_TENANT, daysAgo(90), 'Widget, still keen?', [
    otherTenantId,
    armedTenantId,
  ]);
  hOther = await seedUnplacedReply(H_OTHER_TENANT, daysAgo(90), 'Widget, other client', [armedTenantId]);

  for (const x of [a, b, c, d, d2, f, g, h, k]) await snapshotCarriers(x);
  for (const id of [eWithheld, eOther, eRecent]) await snapshot('missed_calls', id);
  for (const id of [aLate, aFresh, bLate, hAmbiguous, hOther]) await snapshot('inbound_messages', id);

  // ── THE PRE-READ: the due sets at NOW, read directly (see the header) ─────
  const dueLeads = await listLeadsDueForPseudonymisation(NOW, PSEUDONYMISE_BATCH + 1);
  const dueCalls = await listMissedCallsDueForPseudonymisation(NOW, PSEUDONYMISE_BATCH + 1);
  dueLeadIds = dueLeads.map((lead) => lead.leadId);
  dueCallIds = dueCalls.map((call) => call.id);

  const ours = new Set([a, c, f, h, k].map((x) => x.leadId));
  const foreignLeadIds = dueLeadIds.filter((id) => !ours.has(id));
  const foreignCalls = await countForLeads('missed_calls', foreignLeadIds);
  expected = {
    leadsClosed: dueLeads.filter((lead) => lead.status !== 'converted').length,
    leadsConverted: dueLeads.filter((lead) => lead.status === 'converted').length,
    missedCallsWithLead: 5 + foreignCalls,
    missedCallsNoLead: dueCalls.length,
    inboundRows: 5 + (await countForLeads('inbound_messages', foreignLeadIds)),
    // WR-01: this suite's two (a-late, h-amb), plus any unplaced unstamped
    // reply from a foreign due lead's number (zero on a clean CI database).
    inboundRowsNoLead:
      2 +
      (await countUnplacedFrom(
        dueLeads.filter((lead) => !ours.has(lead.leadId)).map((lead) => lead.contactMobile),
      )),
    cadenceRows: 5 + (await countForLeads('cadences', foreignLeadIds)),
    ledgerRows: 5 + (await countForLeads('send_ledger', foreignLeadIds)),
    failed: 0,
    passFailed: false,
  };

  // ── BOTH RUNS, every console line captured ────────────────────────────────
  const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  try {
    first = await runPseudonymisationPass({ now: NOW, pepper: P });
    aAfterFirst = await carriersOf(a);
    second = await runPseudonymisationPass({ now: NOW, pepper: P });
    aAfterSecond = await carriersOf(a);
  } finally {
    logLines = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((v) => String(v)).join(' ')));
    for (const spy of spies) spy.mockRestore();
  }
}, 180_000);

afterAll(async () => {
  // BY ID and FIRST: an enabled text_back or sms row must not outlive the suite.
  if (configIds.length > 0) {
    const { error } = await admin.from('messaging_config').delete().in('id', configIds);
    if (error) throw new Error(`Teardown failed, messaging_config rows left: ${error.message}`);
  }
  // The tenant-less replies (WR-01) by id: no tenant teardown reaches them.
  if (lateIds.length > 0) {
    const { error } = await admin.from('inbound_messages').delete().in('id', lateIds);
    if (error) throw new Error(`Teardown failed, unplaced replies left: ${error.message}`);
  }
  // The STOP row by id, before the tenants (teardown would sweep it too).
  if (suppressionIds.length > 0) {
    const { error } = await admin.from('suppressed_contacts').delete().in('id', suppressionIds);
    if (error) throw new Error(`Teardown failed, suppression rows left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

/* -------------------------------------------------------------------------- *
 * The boundary, at the read
 * -------------------------------------------------------------------------- */

describe('the due-reads select exactly the rows past the boundary (D-06)', () => {
  it('the whole due set fits one night — the counts below are one run', () => {
    expect(dueLeadIds.length).toBeLessThanOrEqual(PSEUDONYMISE_BATCH);
    expect(dueCallIds.length).toBeLessThanOrEqual(PSEUDONYMISE_BATCH);
  });

  it('due leads: (a), (c), (f), (h), (k) — and never (b), (d), (d2), (g)', () => {
    for (const x of [a, c, f, h, k]) expect(dueLeadIds).toContain(x.leadId);
    for (const x of [b, d, d2, g]) expect(dueLeadIds).not.toContain(x.leadId);
  });

  it('due lead-less calls: (e) and (e2) — never (e3), and never a lead\'s own call', () => {
    expect(dueCallIds).toContain(eWithheld);
    expect(dueCallIds).toContain(eOther);
    expect(dueCallIds).not.toContain(eRecent);
    for (const x of [a, b, c, d, d2, f, g, h, k]) expect(dueCallIds).not.toContain(x.callId);
  });
});

/* -------------------------------------------------------------------------- *
 * The first run
 * -------------------------------------------------------------------------- */

describe('the first run counts by kind and never fails', () => {
  it('counts exactly what was due, by kind', () => {
    expect(first).toEqual(expected);
  });

  it('on this suite\'s rows: three closed (a, f, h), two converted (c, k), two lead-less calls (e, e2)', () => {
    expect(first.leadsClosed).toBeGreaterThanOrEqual(3);
    expect(first.leadsConverted).toBeGreaterThanOrEqual(2);
    expect(first.missedCallsWithLead).toBeGreaterThanOrEqual(5);
    expect(first.missedCallsNoLead).toBeGreaterThanOrEqual(2);
    expect(first.inboundRows).toBeGreaterThanOrEqual(5);
    expect(first.cadenceRows).toBeGreaterThanOrEqual(5);
    expect(first.ledgerRows).toBeGreaterThanOrEqual(5);
    expect(first.failed).toBe(0);
    expect(first.passFailed).toBe(false);
  });
});

describe('past the boundary: every carrier hashed and stamped', () => {
  const cases = [
    ['(a) closed not_a_lead 91 days ago', () => a],
    ['(c) converted, job Completed 91 days ago', () => c],
    ['(f) closed opt_out 91 days ago', () => f],
    ['(h) closed spam 91 days ago, at the second tenant', () => h],
    ['(k) converted 366 days ago, job still a Work Order — the long-stop (WR-02)', () => k],
  ] as const;

  it.each(cases)('%s', async (_label, pick) => {
    const x = pick();
    const rows = await carriersOf(x);
    const expectedHash = hash(x.mobile);

    // The lead: the hash and its stamp, together.
    expect(rows.lead.contact_mobile).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.lead.contact_mobile).toBe(expectedHash);
    expect(ms(rows.lead.pseudonymised_at)).toBe(NOW.getTime());

    // The missed call: each caller string hashed on ITS OWN value.
    expect(rows.call.caller_e164).toBe(expectedHash);
    expect(rows.call.caller_raw).toBe(hash(x.callerRaw));
    expect(rows.call.caller_raw).not.toBe(expectedHash);
    expect(rows.call.forwarded_from_raw).toBe(hash(FORWARDED));
    expect(ms(rows.call.pseudonymised_at)).toBe(NOW.getTime());

    // The inbound row: the sender hashed, the words kept byte for byte.
    expect(rows.inbound.from_address).toBe(expectedHash);
    expect(rows.inbound.normalized_from).toBe(expectedHash);
    expect(rows.inbound.body).toBe(x.body);
    expect(rows.inbound.body).toBe(before.get(`inbound_messages:${x.inboundId}`)?.body);
    expect(ms(rows.inbound.pseudonymised_at)).toBe(NOW.getTime());

    // The lead cadence and the ledger ride the lead's stamp.
    expect(rows.cadence.contact_mobile).toBe(expectedHash);
    expect(rows.ledger.to_address).toBe(expectedHash);
  });

  it('(h) was hashed under its own tenant', async () => {
    const rows = await carriersOf(h);
    for (const row of Object.values(rows)) expect(row.tenant_id).toBe(otherTenantId);
  });

  it('(f): the STOP row still holds the raw number — a STOP is kept so it keeps working', async () => {
    const { data, error } = await admin
      .from('suppressed_contacts')
      .select('address, channel')
      .in('id', suppressionIds);
    if (error) throw new Error(`Reading the STOP row failed: ${error.message}`);
    expect(data).toHaveLength(1);
    expect((data ?? [])[0]?.address).toBe(F_OPT_OUT);
    expect((data ?? [])[0]?.channel).toBe('sms');
  });
});

describe('inside the boundary, or still a customer, or still open: untouched', () => {
  const cases = [
    ['(b) closed 89 days ago', () => b],
    ['(d) converted 120 days ago, job still a Work Order (inside the long-stop)', () => d],
    ['(d2) converted, job Completed 30 days ago', () => d2],
    ['(g) open, first call 100 days ago', () => g],
  ] as const;

  it.each(cases)('%s: every carrier byte-identical, no stamp', async (_label, pick) => {
    const x = pick();
    const rows = await carriersOf(x);

    expect(rows.lead).toEqual(before.get(`leads:${x.leadId}`));
    expect(rows.call).toEqual(before.get(`missed_calls:${x.callId}`));
    expect(rows.cadence).toEqual(before.get(`cadences:${x.cadenceId}`));
    expect(rows.inbound).toEqual(before.get(`inbound_messages:${x.inboundId}`));
    expect(rows.ledger).toEqual(before.get(`send_ledger:${x.ledgerId}`));

    expect(rows.lead.pseudonymised_at).toBeNull();
    expect(rows.call.pseudonymised_at).toBeNull();
    expect(rows.inbound.pseudonymised_at).toBeNull();
    expect(rows.lead.contact_mobile).toBe(x.mobile);
    expect(rows.call.caller_e164).toBe(x.mobile);
    expect(rows.cadence.contact_mobile).toBe(x.mobile);
    expect(rows.ledger.to_address).toBe(x.mobile);
    expect(rows.inbound.from_address).toBe(x.mobile);
  });

  it('(e3) a lead-less call 10 days ago: byte-identical, no stamp', async () => {
    const row = await rowById('missed_calls', eRecent);
    expect(row).toEqual(before.get(`missed_calls:${eRecent}`));
    expect(row.pseudonymised_at).toBeNull();
    expect(row.caller_e164).toBe(E3_LEADLESS_RECENT);
  });
});

describe('lead-less calls past the boundary: stamped one row at a time', () => {
  it('(e) withheld: stamped, caller_e164 still NULL, still withheld, the raw strings hashed', async () => {
    const row = await rowById('missed_calls', eWithheld);

    expect(ms(row.pseudonymised_at)).toBe(NOW.getTime());
    expect(row.caller_e164).toBeNull();
    expect(row.caller_kind).toBe('withheld');
    expect(row.caller_withheld).toBe(true);
    expect(row.caller_raw).toBe(hash('anonymous'));
    expect(row.forwarded_from_raw).toBe(hash(FORWARDED_WITHHELD));
  });

  it('(e2) other number: caller_e164 hashed, a NULL forwarded_from_raw stays NULL, stamped', async () => {
    const row = await rowById('missed_calls', eOther);

    expect(ms(row.pseudonymised_at)).toBe(NOW.getTime());
    expect(row.caller_e164).toBe(hash(E2_OTHER_NUMBER));
    expect(row.caller_raw).toBe(hash('08 9157 0356'));
    expect(row.forwarded_from_raw).toBeNull();
    expect(row.caller_kind).toBe('other_number');
  });
});

/* -------------------------------------------------------------------------- *
 * The second run
 * -------------------------------------------------------------------------- */

describe('a second run at the same instant changes nothing (idempotent at the row)', () => {
  it('counts nothing, and does not fail', () => {
    expect(second).toEqual({
      leadsClosed: 0,
      leadsConverted: 0,
      missedCallsWithLead: 0,
      missedCallsNoLead: 0,
      inboundRows: 0,
      inboundRowsNoLead: 0,
      cadenceRows: 0,
      ledgerRows: 0,
      failed: 0,
      passFailed: false,
    });
  });

  it('(a)\'s rows are column-for-column what the first run left, updated_at included', () => {
    expect(aAfterSecond).toEqual(aAfterFirst);
  });
});

/* -------------------------------------------------------------------------- *
 * The gate, after the hash (D-06's last clause; research Q6)
 * -------------------------------------------------------------------------- */

describe('a hashed STOP caller is still refused', () => {
  it('a new call from (f)\'s number is skipped suppressed and opens no lead', async () => {
    const sender = new RecordingSender();
    const endedAt = at(NOW, -15_000);
    const callId = await seedMissedCall(
      armedTenantId,
      {},
      { caller: F_OPT_OUT, afterHours: false, startedAt: at(endedAt, -20_000), endedAt },
    );
    seededIds.push(callId);

    const result = await sendTextBack(callId, { now: NOW, getSender: async () => sender });

    expect(result.kind).toBe('skipped');
    const row = await rowById('missed_calls', callId);
    expect(row.text_back_status).toBe('skipped');
    expect(row.text_back_skip_reason).toBe('suppressed');
    expect(row.lead_id).toBeNull();
    expect(sender.sent).toHaveLength(0);

    // No lead holds the raw number; the one hashed lead is the old one.
    const { data: raw, error: rawError } = await admin
      .from('leads')
      .select('id')
      .eq('tenant_id', armedTenantId)
      .eq('contact_mobile', F_OPT_OUT);
    if (rawError) throw new Error(`Reading leads failed: ${rawError.message}`);
    expect(raw ?? []).toHaveLength(0);

    const { data: hashed, error: hashedError } = await admin
      .from('leads')
      .select('id')
      .eq('tenant_id', armedTenantId)
      .eq('contact_mobile', hash(F_OPT_OUT));
    if (hashedError) throw new Error(`Reading leads failed: ${hashedError.message}`);
    expect((hashed ?? []).map((lead) => (lead as { id: string }).id)).toEqual([f.leadId]);
  });
});

/* -------------------------------------------------------------------------- *
 * Late replies we could not place (15-REVIEW WR-01)
 * -------------------------------------------------------------------------- */

describe('a late reply from a hashed lead\'s number is hashed with it (WR-01)', () => {
  it('(a-late) unmatched, two days after the close: hashed, stamped, words kept', async () => {
    const row = await rowById('inbound_messages', aLate);
    expect(row.from_address).toBe(hash(A_CLOSED_PAST));
    expect(row.normalized_from).toBe(hash(A_CLOSED_PAST));
    expect(ms(row.pseudonymised_at)).toBe(NOW.getTime());
    expect(row.body).toBe(before.get(`inbound_messages:${aLate}`)?.body);
    expect(row.tenant_id).toBeNull();
    expect(row.lead_id).toBeNull();
  });

  it('(h-amb) ambiguous, naming the hashed lead\'s client: hashed under that lead', async () => {
    const row = await rowById('inbound_messages', hAmbiguous);
    expect(row.from_address).toBe(hash(H_OTHER_TENANT));
    expect(row.normalized_from).toBe(hash(H_OTHER_TENANT));
    expect(ms(row.pseudonymised_at)).toBe(NOW.getTime());
  });

  it('untouched: a reply after the lead\'s window, a reply to a lead not due, an ambiguous reply naming only another client', async () => {
    for (const id of [aFresh, bLate, hOther]) {
      expect(await rowById('inbound_messages', id)).toEqual(before.get(`inbound_messages:${id}`));
    }
  });

  it('counted by name, and nothing on the second run', () => {
    expect(first.inboundRowsNoLead).toBeGreaterThanOrEqual(2);
    expect(second.inboundRowsNoLead).toBe(0);
  });
});

/* -------------------------------------------------------------------------- *
 * A retired number is never written as a suppression (15-REVIEW CR-01)
 * -------------------------------------------------------------------------- */

describe('a soft-opt-out confirm on a hashed lead writes no suppression (CR-01)', () => {
  it('killContact on (a)\'s hashed cadence: number_retired, and no suppression row holds the hash', async () => {
    // The inbox's confirm runs exactly this, after the operator's gate.
    expect(await killContact(armedTenantId, a.cadenceId)).toEqual({ kind: 'number_retired' });

    const { data, error } = await admin
      .from('suppressed_contacts')
      .select('id')
      .eq('tenant_id', armedTenantId)
      .eq('address', hash(A_CLOSED_PAST));
    if (error) throw new Error(`Reading suppressed_contacts failed: ${error.message}`);
    expect(data ?? []).toHaveLength(0);

    // Nothing moved on the cadence either.
    const cadence = await rowById('cadences', a.cadenceId);
    expect(cadence.contact_mobile).toBe(hash(A_CLOSED_PAST));
    expect(cadence.status).toBe(aAfterSecond.cadence.status);
  });
});

/* -------------------------------------------------------------------------- *
 * The logs (T-15-01)
 * -------------------------------------------------------------------------- */

describe('no number, hash or id reaches any log line of either run', () => {
  it('the pass logged its counts', () => {
    expect(logLines.some((line) => line.startsWith('[pseudonymise] leads_closed'))).toBe(true);
  });

  it('no +61, no nine-digit run, no 64-hex string, no seeded id', () => {
    const logs = logLines.join('\n');

    expect(logs).not.toMatch(/\+61\d/);
    expect(logs).not.toMatch(/\d{9}/);
    expect(logs).not.toMatch(/[0-9a-f]{64}/);
    for (const id of seededIds) expect(logs).not.toContain(id);
  });
});
