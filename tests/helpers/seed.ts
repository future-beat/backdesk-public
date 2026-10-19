/**
 * Two-tenant fixture for the ONB-05 leak test.
 *
 * The shape of this fixture is the experiment: tenants A and B carry
 * **identical** profile values apart from their names, and the operator is a
 * member of A only. If isolation ever keyed on anything but the tenant uuid —
 * a name, a trade type, a "looks like the same business" heuristic — these two
 * rows would be indistinguishable and the leak test would go red.
 *
 * Membership is inserted directly with the service-role client rather than
 * through `create_tenant()`, because that RPC enrols the caller in whatever it
 * creates: using it for B would hand the operator legitimate access to B and
 * quietly destroy the thing under test.
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_LEAD_TEMPLATE_BODIES } from '../../src/core/leads/lead-templates';
import { defaultTextBackBody, validateTextBackTemplate } from '../../src/core/leads/template';

import { testEnv } from './env';

export const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };

/** Service role bypasses RLS by design — confined to seeding and teardown. */
export const admin: SupabaseClient = createClient(
  testEnv.url,
  testEnv.serviceRoleKey,
  noPersist,
);

/** Identical for both tenants. Only the name differs. */
const SHARED_PROFILE = {
  trade_type: 'Plumbing',
  timezone: 'Australia/Perth',
  contact_hours_start: '08:00',
  contact_hours_end: '17:00',
  contact_days: [1, 2, 3, 4, 5],
  escalation_phone: '+61400111222',
  status: 'onboarding',
};

export interface TwoTenants {
  operatorId: string;
  tenantA: string;
  tenantB: string;
  nameA: string;
  nameB: string;
}

const PAGE_SIZE = 200;

/**
 * Find the operator by email, paging rather than assuming page one.
 *
 * The two suite-local copies of this helper both used a single `perPage: 200`
 * call and would have silently tried to RE-CREATE the operator on a project with
 * more users than that (IN-03).
 */
async function findOperatorId(): Promise<string | null> {
  const wanted = testEnv.operatorEmail.toLowerCase();

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;

    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (hit) return hit.id;
    if (data.users.length < PAGE_SIZE) return null;
  }
  return null;
}

/**
 * The single operator auth user, created if absent. Idempotent AND concurrency-
 * safe (WR-05).
 *
 * The check-then-create here is a TOCTOU by construction: on a fresh database
 * two callers can both see "no such user" and both call createUser. Rather than
 * pretend that cannot happen, the loser of that race is handled — an
 * already-registered failure means the user now exists, which is precisely the
 * postcondition this function promises, so it re-reads instead of throwing.
 *
 * Previously this threw, and because it ran in `beforeAll` it failed an entire
 * CI-blocking suite.
 */
export async function ensureOperatorExists(): Promise<string> {
  const existing = await findOperatorId();
  if (existing) return existing;

  const created = await admin.auth.admin.createUser({
    email: testEnv.operatorEmail,
    password: testEnv.operatorPassword,
    email_confirm: true,
  });

  if (!created.error) return created.data.user!.id;

  // Lost the race (or the address was registered between the two calls). The
  // user exists either way; anything else is a real failure.
  const raced = await findOperatorId();
  if (raced) return raced;

  throw new Error(`Could not ensure the operator user exists: ${created.error.message}`);
}

/**
 * Seed tenant A (operator is a member) and tenant B (operator is NOT a member).
 * Names are timestamped so repeat runs never collide on the unique lower(name)
 * index.
 */
export async function seedTwoTenants(): Promise<TwoTenants> {
  const operatorId = await ensureOperatorExists();

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const nameA = `Leak Acme Plumbing ${stamp}`;
  const nameB = `Leak Bravo Sparks ${stamp}`;

  const { data, error } = await admin
    .from('tenants')
    .insert([
      { ...SHARED_PROFILE, name: nameA },
      { ...SHARED_PROFILE, name: nameB },
    ])
    .select('id,name');
  if (error) throw new Error(`Seeding two tenants failed: ${error.message}`);

  const rowA = data!.find((r) => r.name === nameA);
  const rowB = data!.find((r) => r.name === nameB);
  if (!rowA || !rowB) throw new Error('Seed did not return both tenant rows');

  // Membership for A ONLY. This single row is what the RLS half is testing.
  const membership = await admin
    .from('tenant_members')
    .insert({ tenant_id: rowA.id, user_id: operatorId, role: 'operator' });
  if (membership.error) {
    await teardownTenants([rowA.id, rowB.id]);
    throw new Error(`Seeding membership failed: ${membership.error.message}`);
  }

  return { operatorId, tenantA: rowA.id, tenantB: rowB.id, nameA, nameB };
}

/**
 * A single tenant with the operator enrolled — for suites that need one client
 * rather than the adversarial pair.
 *
 * Uses `create_tenant()` (unlike `seedTwoTenants`, which must NOT for tenant B)
 * because here the operator SHOULD be a member: the connect action authorizes
 * through an RLS-scoped read, and a tenant with no membership would fail that
 * check for the right reason and the wrong test.
 */
export async function seedTenant(prefix = 'Connect Test'): Promise<string> {
  await ensureOperatorExists();
  const operator = await signInAsOperator();

  const { data, error } = await operator.rpc('create_tenant', {
    p_name: `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    p_trade_type: 'Plumbing',
    p_timezone: 'Australia/Perth',
    p_hours_start: '08:00',
    p_hours_end: '17:00',
    p_days: [1, 2, 3, 4, 5],
    p_escalation_phone: null,
  });
  if (error) throw new Error(`Seeding a tenant failed: ${error.message}`);
  return data as string;
}

/**
 * A ServiceM8 connection row, written with the admin client.
 *
 * The ciphertext is a plausible `enc:v1` envelope rather than a real one — the
 * `sm8_connections_ciphertext_versioned` CHECK constraint rejects anything that
 * does not look encrypted, which is exactly the point of that constraint. Tests
 * that need a DECRYPTABLE value build one with `encryptCredential`.
 */
export async function seedConnection(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('sm8_connections').insert({
    tenant_id: tenantId,
    api_key_ciphertext: 'enc:v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCCCCCC',
    key_last4: '9999',
    ...overrides,
  });
  if (error) throw new Error(`Seeding a connection failed: ${error.message}`);
}

/**
 * Mirrored quote rows, written with the admin client.
 *
 * Returns the inserted `(id, sm8_job_uuid)` pairs: the event tests need our own
 * row id to assert `quote_status_events.quote_id`, and re-querying for it after
 * the fact would race a suite that seeds concurrently.
 */
export async function seedQuotes(
  tenantId: string,
  rows: Array<Record<string, unknown>> = [{}],
): Promise<Array<{ id: string; sm8_job_uuid: string }>> {
  const payload = rows.map((row, i) => ({
    tenant_id: tenantId,
    sm8_job_uuid: randomUUID(),
    status: 'Quote',
    edit_date_raw: `2026-08-2${(i % 9) + 1} 09:00:0${i % 10}`,
    sync_source: 'backfill',
    ...row,
  }));

  const { data, error } = await admin
    .from('quotes')
    .insert(payload)
    .select('id,sm8_job_uuid');
  if (error) throw new Error(`Seeding quotes failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; sm8_job_uuid: string }>;
}

/** Mirrored job-contact rows, written with the admin client. */
export async function seedQuoteContacts(
  tenantId: string,
  rows: Array<Record<string, unknown>> = [{}],
): Promise<Array<{ id: string; sm8_contact_uuid: string }>> {
  const payload = rows.map((row, i) => ({
    tenant_id: tenantId,
    sm8_contact_uuid: randomUUID(),
    sm8_job_uuid: randomUUID(),
    first: 'Test',
    last: `Contact ${i}`,
    mobile: '+61400000000',
    contact_type: 'JOB',
    edit_date_raw: `2026-08-2${(i % 9) + 1} 09:00:0${i % 10}`,
    ...row,
  }));

  const { data, error } = await admin
    .from('quote_contacts')
    .insert(payload)
    .select('id,sm8_contact_uuid');
  if (error) throw new Error(`Seeding quote contacts failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; sm8_contact_uuid: string }>;
}

/** One `sync_runs` row — the health log entry a cycle would have written. */
export async function seedSyncRun(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('sync_runs').insert({
    tenant_id: tenantId,
    outcome: 'ok',
    ...overrides,
  });
  if (error) throw new Error(`Seeding a sync run failed: ${error.message}`);
}

/**
 * Per-tenant touch templates (D-02), written with the admin client.
 *
 * Defaults to the day 0/3/7/14/21 shape. `touch_number` is the array position
 * plus one, exactly as `forTenant().templates.ensureDefaults()` computes it —
 * a suite that seeded a different mapping would be testing a schedule the
 * production path cannot produce.
 */
export async function seedTouchTemplates(
  tenantId: string,
  offsetDays: readonly number[] = [0, 3, 7, 14, 21],
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('cadence_touch_templates').insert(
    offsetDays.map((days, i) => ({
      tenant_id: tenantId,
      touch_number: i + 1,
      offset_days: days,
      channel: 'sms',
      ...overrides,
    })),
  );
  if (error) throw new Error(`Seeding touch templates failed: ${error.message}`);
}

/**
 * ONE `tenant_attestations` ROW, WITH A CHOSEN `attested_at` (06-04, D-15).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONLY REASON THIS HELPER EXISTS IS THE BACKDATE, AND THAT IS ALSO WHY │
 * │ IT USES `admin` RATHER THAN THE REPOSITORY.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `attestations.append` deliberately does NOT take a timestamp: the column's
 * `defaultNow()` is what makes the moment the database's rather than a
 * caller's, because an attestation whose date somebody could type is worth
 * nothing as evidence. The 30-day staleness policy still has to be testable, so
 * the ONE place that may choose an `attested_at` is a test fixture writing
 * through the service-role client — visibly outside the production surface,
 * which is the point.
 */
export async function seedAttestation(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('tenant_attestations').insert({
    tenant_id: tenantId,
    kind: 'sm8_automation_off',
    note: 'seeded — checked Settings → Automation',
    ...overrides,
  });
  if (error) throw new Error(`Seeding an attestation failed: ${error.message}`);
}

/**
 * AN EXPLICIT *OFF* `messaging_config` ROW FOR ONE TENANT (Phase 10, 04-03 rule).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT REFUSES `enabled: true`, AND THAT REFUSAL IS THE WHOLE POINT.         │
 * │ `enabled = true` on a row carrying a from-address IS real customer       │
 * │ messaging, effective on the next tick with no deploy. Arming is a        │
 * │ production act performed by a named operator through `armChannel`, which │
 * │ writes an audit row beside the flip. A fixture that could arm would be a │
 * │ way for real messages to start with nobody's name on them (T-10-15).    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY SUITES NEED AN EXPLICIT *OFF* ROW AT ALL ────────────────────────────
 *
 * "This tenant is not armed" and "this deployment is not armed" are different
 * questions, and only the first one stays meaningful after the founding client
 * goes live. A tenant with NO row of its own inherits the shared row, so a
 * suite asserting `resolveSmsFrom(seeded) === null` would be asserting the
 * deployment's state. An explicit `enabled = false` row is routing's
 * "per-client OFF means STOP, not fall back", so the answer stays no whatever
 * the shared row does.
 *
 * ── DELETE THE RETURNED ID YOURSELF, FIRST, IN `afterAll` ───────────────────
 *
 * `messaging_config` has NO foreign key to `tenants` — the global row carries
 * no tenant at all — so `teardownTenants` does not sweep it and cannot be made
 * to. The row id is returned for exactly that reason: delete by id BEFORE the
 * tenants go, the rule `tests/routing-dispatch.test.ts` and
 * `tests/escalation.test.ts` already follow.
 */
export async function seedMessagingConfigOverride(
  tenantId: string,
  channel: 'sms' | 'email',
  overrides: Record<string, unknown> = {},
): Promise<string> {
  // BEFORE ANY STATEMENT. A helper that threw only after writing would have
  // armed the row it was refusing to arm.
  if (overrides.enabled === true) {
    throw new Error(
      'seedMessagingConfigOverride refuses enabled=true — arming is never a fixture (04-03 rule)',
    );
  }

  const { data, error } = await admin
    .from('messaging_config')
    .insert({
      channel,
      tenant_id: tenantId,
      from_address: null,
      reply_to: null,
      business_name: null,
      enabled: false,
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a messaging_config override failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * ONE `tenant_proofs` ROW (Phase 10, D-02) — a proof somebody can re-check.
 *
 * The artefact id is what separates this table from `tenant_attestations`: an
 * attestation is a human saying "I looked", a proof carries the id of the thing
 * they looked at (a ClickSend message id, a Resend email id) so a second person
 * can go and look at it too. `artefact_id` is NOT NULL with a length CHECK of
 * 8..128, which is why the seeded value is a full-length string rather than
 * `'x'`.
 *
 * `recorded_by` is the operator's real user id, read through
 * `ensureOperatorExists()`: the column is NOT NULL and a proof with no hand on
 * it is the row the table exists to refuse.
 */
export async function seedProof(
  tenantId: string,
  kind:
    | 'escalation_handset_proof'
    | 'email_pipe_proof'
    | 'divert_verification_call'
    | 'text_back_proof',
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const recordedBy = await ensureOperatorExists();

  const { data, error } = await admin
    .from('tenant_proofs')
    .insert({
      tenant_id: tenantId,
      kind,
      artefact_id: 'seeded-artefact-0001',
      artefact_detail: {},
      note: 'seeded — read back by a test',
      recorded_by: recordedBy,
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a tenant proof failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Monotonic within one process, so two divert numbers seeded in the same
 * millisecond still get distinct stamps.
 */
let telephonySeq = 0;

/**
 * One `tenant_divert_numbers` row (Phase 11, CAP-01), `active` by default.
 *
 * THE NUMBER IS STAMPED, because `number_e164` is UNIQUE across every tenant
 * (D-02: a number is never shared) and a fixed value would collide with the
 * previous run's leftover — or with the other tenant in the same suite. `+6189`
 * plus seven digits clears the `^[+]61[0-9]{9}$` CHECK; the local stack is the
 * only place these rows land (the hosted database is production, D-11).
 *
 * `created_by` is the operator's real user id, through `ensureOperatorExists()`:
 * the column is NOT NULL, the `recorded_by` rule one table over.
 *
 * Returns the row id. Swept by `teardownTenants` (NO_CASCADE_TABLES).
 */
export async function seedDivertNumber(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const createdBy = await ensureOperatorExists();
  const stamp = String((Date.now() + telephonySeq++) % 10_000_000).padStart(7, '0');

  const { data, error } = await admin
    .from('tenant_divert_numbers')
    .insert({
      tenant_id: tenantId,
      number_e164: `+6189${stamp}`,
      spoken_name: 'Seeded Sparks',
      status: 'active',
      provider_number_sid: `PN${'0'.repeat(32)}`,
      created_by: createdBy,
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a divert number failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Phase 12's typed knobs on `seedMissedCall` — each derives the columns the
 * IN-04 CHECKs tie together, so a suite cannot seed an inconsistent row by
 * setting one of them.
 *
 *   caller       — an E.164 number, or `null` for a WITHHELD caller (no
 *                  number, `caller_kind = 'withheld'`, the withheld flag set)
 *   callerKind   — override the derived kind (`+614…` → mobile, else other)
 *   forwardedFrom— the raw ForwardedFrom Twilio sent, or `null`
 *   afterHours   — the arrival's stored after-hours fact
 *   startedAt    — arrival time
 *   endedAt      — completion time (also sets `call_status = 'completed'`)
 */
export interface MissedCallSeedOptions {
  caller?: string | null;
  callerKind?: 'mobile' | 'other_number' | 'withheld';
  forwardedFrom?: string | null;
  afterHours?: boolean;
  startedAt?: Date;
  endedAt?: Date | null;
}

/**
 * One `missed_calls` row (Phase 11, CAP-03) — a completed-shape arrival from the
 * webhook, with a stamped CallSid so the `(provider, provider_call_id)` arbiter
 * never sees a repeat across runs.
 *
 * `tenantId` MAY BE NULL: that is a DEAD LETTER, which matches no tenant
 * predicate — so `teardownTenants` cannot reach it and the suite that wrote it
 * must delete it BY ID (the `inbound_messages` caveat below).
 *
 * The numbers are ACMA fiction-block values. Returns the row id.
 */
export async function seedMissedCall(
  tenantId: string | null,
  overrides: Record<string, unknown> = {},
  options: MissedCallSeedOptions = {},
): Promise<string> {
  // Phase 12: the IN-04 CHECKs (0039) tie the caller columns together, so the
  // options derive the consistent set — a withheld caller has no number and
  // carries the withheld flag, and a dead letter carries a reason.
  const caller =
    options.caller === undefined
      ? {}
      : options.caller === null
        ? { caller_e164: null, caller_kind: 'withheld', caller_withheld: true }
        : {
            caller_e164: options.caller,
            caller_kind: options.callerKind ?? (/^[+]614/.test(options.caller) ? 'mobile' : 'other_number'),
            caller_withheld: false,
          };
  const derived: Record<string, unknown> = {
    ...caller,
    ...(options.forwardedFrom === undefined ? {} : { forwarded_from_raw: options.forwardedFrom }),
    ...(options.afterHours === undefined ? {} : { after_hours: options.afterHours }),
    ...(options.startedAt === undefined ? {} : { started_at: options.startedAt.toISOString() }),
    ...(options.endedAt === undefined
      ? {}
      : { ended_at: options.endedAt?.toISOString() ?? null, call_status: 'completed' }),
    ...(tenantId === null && overrides.dead_letter_reason === undefined
      ? { dead_letter_reason: 'unknown_number' }
      : {}),
  };

  const { data, error } = await admin
    .from('missed_calls')
    .insert({
      tenant_id: tenantId,
      provider_call_id: `CA${randomUUID().replace(/-/g, '')}`,
      called_number_e164: '+61891570156',
      caller_e164: '+61491570156',
      caller_kind: 'mobile',
      started_at: new Date().toISOString(),
      after_hours: false,
      source: 'webhook',
      ...derived,
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a missed call failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * The one-row-per-tenant cadence settings row (D-03/D-06).
 *
 * `preferred_send_time` is NOT defaulted here beyond the column's own default:
 * the point of D-03 is that the time is a per-client decision, and a helper
 * that quietly picked one would make a windowing test pass regardless of
 * whether the production path reads the column at all.
 */
export async function seedCadenceSettings(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin
    .from('cadence_settings')
    .insert({ tenant_id: tenantId, ...overrides });
  if (error) throw new Error(`Seeding cadence settings failed: ${error.message}`);
}

/**
 * A synthetic `created_by_event_id` for a seeded cadence (CR-01).
 *
 * NEGATIVE ON PURPOSE. `quote_status_events.id` is a bigserial, so every id the
 * real outbox can ever mint is positive: a negative key can collide with a
 * production event id only if that sequence is made to count backwards. Seeded
 * cadences must carry a key at all because migration 0023's
 * `cadences_replay_key_present` requires one — and requiring it is the point,
 * since a seeded NULL was exactly how the dispatch/controls/tick suites used to
 * sit outside the replay guarantee they were meant to be exercising code under.
 *
 * The base is randomised per process and the counter runs within it, because
 * vitest runs suites in parallel processes against ONE shared hosted database
 * and `cadences_one_per_opened_event` is global: two files seeding concurrently
 * must not pick the same id. 9e12 bases × 1000 slots stays inside
 * Number.MAX_SAFE_INTEGER, which matters because drizzle reads this column in
 * `mode: 'number'`.
 */
const SEEDED_EVENT_ID_BASE = -Math.floor(Math.random() * 8_000_000_000_000) * 1000;
let seededEventIdCount = 0;

export function nextSeededEventId(): number {
  seededEventIdCount += 1;
  return SEEDED_EVENT_ID_BASE - seededEventIdCount;
}

/**
 * One cadence row, returning its id.
 *
 * `anchor_at` defaults to now, which is what D-01 means by "the eligibility
 * moment" — the consumption of `quote_opened`, never the ServiceM8
 * `occurred_at` a backfilled quote would carry. A suite testing the overdue
 * paths overrides it explicitly, so "this cadence starts in the past" is always
 * something the test SAYS rather than something the helper assumed.
 *
 * `created_by_event_id` defaults to a fresh synthetic id rather than being
 * omitted: see `nextSeededEventId`. A suite that needs the cadence to carry a
 * REAL event id overrides it, which is again something the test says out loud.
 */
export async function seedCadence(
  tenantId: string,
  quoteId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from('cadences')
    .insert({
      tenant_id: tenantId,
      quote_id: quoteId,
      sm8_job_uuid: randomUUID(),
      status: 'active',
      anchor_at: new Date().toISOString(),
      created_by_event_id: nextSeededEventId(),
      contact_name: 'Test Customer',
      contact_mobile: '+61400000000',
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a cadence failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * ARM ONE CLIENT'S TEXT-BACK (Phase 12, D-09) — a per-tenant `text_back` row,
 * enabled, through the service role.
 *
 * THE ONE ARMING FIXTURE, and it is safe to be one for a reason the SMS rule
 * (`seedMessagingConfigOverride` refuses `enabled=true`) does not have: a
 * `text_back` row arms nothing by itself. A text-back still needs the client's
 * SMS identity to resolve AND a real (non-stub) sender, and every DB suite
 * injects its own recording sender. `messaging_config` has no FK, so the
 * returned id must be deleted BY ID by the suite, first.
 */
export async function seedTextBackArmed(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from('messaging_config')
    .insert({ channel: 'text_back', tenant_id: tenantId, enabled: true, ...overrides })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a text_back row failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * The three attested text-back wordings (Phase 12, D-02/D-03) — the defaults,
 * built for the tenant's own name so they validate at send time. Override any
 * variant's body (or pass `attested: false` to leave a version unattested).
 * Returns the row ids by variant. Cascades with the tenant.
 */
export async function seedTextBackTemplates(
  tenantId: string,
  overrides: {
    bodies?: Partial<Record<'business_hours' | 'after_hours' | 'about_quote', string>>;
    version?: number;
    attested?: boolean;
    variants?: Array<'business_hours' | 'after_hours' | 'about_quote'>;
  } = {},
): Promise<Record<string, string>> {
  const operatorId = await ensureOperatorExists();
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();
  if (tenantError) throw new Error(`Reading the tenant name failed: ${tenantError.message}`);
  const name = (tenant as { name: string }).name;

  const variants = overrides.variants ?? ['business_hours', 'after_hours', 'about_quote'];
  const attested = overrides.attested ?? true;
  const ids: Record<string, string> = {};

  for (const variant of variants) {
    const body = overrides.bodies?.[variant] ?? defaultTextBackBody(variant, name);
    const validated = validateTextBackTemplate(body, { businessName: name, variant });
    const { data, error } = await admin
      .from('text_back_templates')
      .insert({
        tenant_id: tenantId,
        variant,
        version: overrides.version ?? 1,
        body,
        segments: validated.ok ? validated.segments : 2,
        attested_at: attested ? new Date().toISOString() : null,
        attested_by: attested ? operatorId : null,
        attestation_note: attested ? 'seeded — attested by a test' : null,
        created_by: operatorId,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Seeding a text-back template failed: ${error.message}`);
    ids[variant] = (data as { id: string }).id;
  }
  return ids;
}

/** One never-text entry (Phase 12, D-06/IN-07). Swept by `teardownTenants`. */
export async function seedNeverTextNumber(
  tenantId: string,
  numberE164: string,
  kind: 'own_line' | 'never_text' = 'own_line',
): Promise<string> {
  const createdBy = await ensureOperatorExists();
  const { data, error } = await admin
    .from('tenant_never_text_numbers')
    .insert({ tenant_id: tenantId, number_e164: numberE164, kind, created_by: createdBy })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a never-text number failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * One SENT lead escalation (Phase 14, plan 14-04, D-08): the row the tradie's
 * DONE answers — `outcome 'sent'`, `sent_at`, `lead_id` and `to_address` (the
 * tradie's normalised number as texted). The trigger is a fresh
 * `inbound_message_id` (no FK — the evidence posture; `escalations_one_trigger`
 * needs exactly one). `holdUntil` / `releasedAt` seed a held-then-released row
 * (`escalations_release_needs_hold`). Swept by `teardownTenants`.
 */
export async function seedEscalationSent(
  tenantId: string,
  entry: {
    leadId: string;
    cadenceId: string;
    toAddress: string;
    sentAt: Date;
    holdUntil?: Date;
    releasedAt?: Date;
  },
): Promise<string> {
  const { data, error } = await admin
    .from('escalations')
    .insert({
      tenant_id: tenantId,
      cadence_id: entry.cadenceId,
      lead_id: entry.leadId,
      quote_id: null,
      inbound_message_id: randomUUID(),
      to_address: entry.toAddress,
      outcome: 'sent',
      sent_at: entry.sentAt.toISOString(),
      hold_until: entry.holdUntil?.toISOString() ?? null,
      released_at: entry.releasedAt?.toISOString() ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a sent escalation failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * One OPEN lead (Phase 12, D-05). `first_missed_call_id` defaults to a fresh
 * uuid (no FK — the evidence posture). Swept by `teardownTenants`.
 */
export async function seedLead(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const at = new Date().toISOString();
  const { data, error } = await admin
    .from('leads')
    .insert({
      tenant_id: tenantId,
      contact_mobile: '+61491570156',
      first_missed_call_id: randomUUID(),
      first_missed_at: at,
      last_missed_at: at,
      after_hours: false,
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a lead failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * One LEAD cadence (Phase 12, D-19): `kind = 'lead'`, the lead id set, both
 * quote columns NULL and NO event id — the widened replay key admits it
 * because it is a lead. Swept by `teardownTenants`.
 */
export async function seedLeadCadence(
  tenantId: string,
  leadId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from('cadences')
    .insert({
      tenant_id: tenantId,
      kind: 'lead',
      lead_id: leadId,
      quote_id: null,
      sm8_job_uuid: null,
      status: 'active',
      anchor_at: new Date().toISOString(),
      contact_mobile: '+61491570156',
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a lead cadence failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Touch rows for a cadence. `touch_number` comes from the array position, and
 * `scheduled_at` must be supplied per row — see `seedCadence` on why a helper
 * does not invent times.
 */
export async function seedTouches(
  cadenceId: string,
  tenantId: string,
  rows: Array<Record<string, unknown>> = [{}],
): Promise<Array<{ id: string; touch_number: number }>> {
  const payload = rows.map((row, i) => ({
    tenant_id: tenantId,
    cadence_id: cadenceId,
    touch_number: i + 1,
    channel: 'sms',
    status: 'scheduled',
    scheduled_at: new Date(Date.now() + (i + 1) * 3_600_000).toISOString(),
    original_offset_days: i,
    ...row,
  }));

  const { data, error } = await admin
    .from('cadence_touches')
    .insert(payload)
    .select('id,touch_number');
  if (error) throw new Error(`Seeding touches failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; touch_number: number }>;
}

/**
 * An APPROVED message-template version (05-01).
 *
 * `approved_at` is set by default because the overwhelmingly common need is "a
 * tenant who can be drafted for". A suite testing the ONB-03 belt — a tenant
 * with templates that are not approved yet — passes `approved_at: null`
 * explicitly, which is the correct amount of friction: an unapproved template
 * is the unusual case and should have to be asked for.
 */
export async function seedMessageTemplate(
  tenantId: string,
  touchNumber: number,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const { data, error } = await admin
    .from('message_templates')
    .insert({
      tenant_id: tenantId,
      touch_number: touchNumber,
      channel: 'sms',
      version: 1,
      body: `Friendly check-in on the quote for touch ${touchNumber}.`,
      approved_at: new Date().toISOString(),
      approval_note: 'seeded',
      ...overrides,
    })
    .select('id,version')
    .single();

  if (error) throw new Error(`Seeding a message template failed: ${error.message}`);
  return data as { id: string; version: number };
}

/**
 * THE WHOLE APPROVED TEMPLATE SET — what a tenant needs before any cadence of
 * theirs may be born ACTIVE (ONB-03, 05-03).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CALL THIS IN ANY SUITE THAT DRIVES `consumeQuoteEvents` AND EXPECTS AN   │
 * │ ACTIVE CADENCE. Without it the cadence is created PAUSED `onboarding`,   │
 * │ with its full schedule materialized — which is correct, and is not what  │
 * │ a Phase 3 suite was written to assert.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The five touch numbers match `DEFAULT_TOUCH_OFFSET_DAYS`, which is the shape
 * `templates.ensureDefaults` seeds on the first cadence — so `approvedSetStatus`
 * finds an approved sms wording for every timing row it can see. Only the
 * WORDING rows are written here: the timing rows are the consumer's own lazy
 * seed, and writing them early would hide a regression in it.
 */
export async function seedApprovedTemplateSet(
  tenantId: string,
  touchNumbers: readonly number[] = [1, 2, 3, 4, 5],
): Promise<void> {
  for (const touchNumber of touchNumbers) {
    await seedMessageTemplate(tenantId, touchNumber);
  }
}

/**
 * The shipped LEAD wording, approved (Phase 13, D-02): two `message_templates`
 * rows of kind 'lead' for touches 2 and 3, bodies from
 * `DEFAULT_LEAD_TEMPLATE_BODIES` — what `templates.ensureLeadDefaults` seeds.
 * `seedMessageTemplate` passes `kind` through its overrides like any column.
 */
export async function seedLeadTemplates(tenantId: string): Promise<void> {
  for (const touchNumber of [2, 3] as const) {
    await seedMessageTemplate(tenantId, touchNumber, {
      kind: 'lead',
      body: DEFAULT_LEAD_TEMPLATE_BODIES[touchNumber],
      approval_note: 'seeded lead default',
    });
  }
}

/**
 * Set a client's after-hours escalation switch (Phase 13, D-09) with the
 * admin client. Default OFF in the schema; plan 13-06's suites flip it.
 */
export async function setTenantAfterHoursEscalation(
  tenantId: string,
  value: boolean,
): Promise<void> {
  const { error } = await admin
    .from('tenants')
    .update({ after_hours_escalation: value })
    .eq('id', tenantId);
  if (error) throw new Error(`Setting the after-hours switch failed: ${error.message}`);
}

/**
 * An APPROVED `touch_drafts` row — what dispatch now requires before it will
 * send anything (D-10, `no_approved_draft`).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS HELPER EXISTS BECAUSE THE GATE BECAME REAL, AND EVERY SUITE THAT    │
 * │ SEEDS AN `approved` TOUCH AND EXPECTS A SEND NOW NEEDS ONE.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Before 05-01, `promoteDue` moved a touch straight to `approved` and dispatch
 * composed the body itself. A suite could therefore seed `status: 'approved'`
 * and get a send. It can no longer: `dispatch` reads
 * `drafts.approvedFinalBody(touchId)` inside the claim transaction and refuses
 * when it is null.
 *
 * `finalBody` is DETERMINISTIC and returned to the caller, so a test can assert
 * that the bytes reaching `SendRequest.body` are these exact bytes rather than
 * something dispatch composed — which is the whole point of the seam.
 */
export async function seedApprovedDraft(
  tenantId: string,
  cadenceId: string,
  touchId: string,
  touchNumber: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const finalBody =
    (overrides.final_body as string | undefined) ??
    `Approved draft for touch ${touchNumber}. Test Business. Reply STOP to opt out.`;

  const { error } = await admin.from('touch_drafts').insert({
    tenant_id: tenantId,
    cadence_id: cadenceId,
    touch_id: touchId,
    touch_number: touchNumber,
    attempt: 1,
    model: 'claude-sonnet-5',
    prompt_version: 'p1',
    generated_body: `Approved draft for touch ${touchNumber}.`,
    final_body: finalBody,
    status: 'approved',
    segments: 1,
    edit_distance: '0',
    approved_at: new Date().toISOString(),
    ...overrides,
  });

  if (error) throw new Error(`Seeding an approved draft failed: ${error.message}`);
  return finalBody;
}

/**
 * Suppression entries (D-15).
 *
 * ADDRESSES ARE PASSED IN ALREADY NORMALIZED, deliberately. Suppression matches
 * on the exact stored string, so a helper that normalized for the caller would
 * hide the one bug this table can have — a suppression written as
 * `0400 123 456` never matching the `+61400123456` that dispatch checks. A
 * suite proving normalization must be able to seed an un-normalized value.
 */
export async function seedSuppression(
  tenantId: string,
  entries: Array<{ channel: 'sms' | 'email'; address: string; reason?: string; source?: string }>,
): Promise<void> {
  if (entries.length === 0) return;

  const { error } = await admin.from('suppressed_contacts').insert(
    entries.map((entry) => ({
      tenant_id: tenantId,
      channel: entry.channel,
      address: entry.address,
      reason: entry.reason ?? 'test suppression',
      source: entry.source ?? 'operator_kill',
    })),
  );
  if (error) throw new Error(`Seeding suppression failed: ${error.message}`);
}

/**
 * An attribution row (RPT-01), written with the admin client.
 *
 * EVERY NOT-NULL COLUMN IS SUPPLIED, because the point of a seeded attribution
 * is to be a row the reads and the unique index treat exactly like a real one.
 * `evidence: {}` is acceptable HERE and only here: the D-05 chain is built and
 * validated by `src/core/attribution/evidence.ts`, and a seed that hand-rolled a
 * plausible-looking chain would be asserting against its own fiction.
 *
 * `won_detected_at` defaults to now — a suite testing the D-10 month boundaries
 * overrides it explicitly, so "this win lands in July" is always something the
 * test SAYS rather than something the helper assumed (the `seedCadence` rule).
 *
 * Returns the row id.
 */
export async function seedAttribution(
  tenantId: string,
  quoteId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from('quote_attributions')
    .insert({
      tenant_id: tenantId,
      quote_id: quoteId,
      sm8_job_uuid: randomUUID(),
      won_event_id: nextSeededEventId(),
      won_detected_at: now,
      first_touch_claimed_at: now,
      last_touch_claimed_at: now,
      qualifying_touch_count: 2,
      gross_cents: 250_000,
      conservative_cents: 220_000,
      value_source: 'mirror',
      baseline_rate_bp: 1200,
      baseline_source: 'connect',
      baseline_sample: 40,
      window_days: 30,
      evidence: {},
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding an attribution failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * A fee-schedule entry (D-13), written with the admin client.
 *
 * `effectiveFrom` IS REQUIRED, with no default here and none in the schema — the
 * "no default contact window" rule. A helper that invented a date would let a
 * suite assert an in-force calculation against a boundary nobody chose, which is
 * the one thing this table's arithmetic turns on.
 *
 * Returns the row id.
 */
export async function seedFee(
  tenantId: string,
  entry: {
    kind: 'monthly' | 'setup';
    amountCents: number;
    effectiveFrom: string;
    note?: string;
  },
): Promise<string> {
  const { data, error } = await admin
    .from('tenant_fees')
    .insert({
      tenant_id: tenantId,
      kind: entry.kind,
      amount_cents: entry.amountCents,
      effective_from: entry.effectiveFrom,
      note: entry.note ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a fee failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * A `send_ledger` row (CAD-04 evidence), written with the admin client.
 *
 * THE ATTRIBUTION EVIDENCE SEEDER. Phase 7's whole predicate reads this table —
 * `sender <> 'stub' AND outcome = 'sent' AND delivery_status IS DISTINCT FROM
 * 'undelivered'`, inside the window before a win — so the defaults here are a
 * QUALIFYING touch and a suite proving a refusal overrides them explicitly. That
 * is the `seedCadence` rule: the interesting case is something the test says.
 *
 * `claimedAt` IS REQUIRED and has no default. `send_ledger` has no `sent_at`, so
 * `claimed_at` IS the sent moment the D-01 window is measured against
 * (send-ledger.ts:155-156), and a helper that defaulted it to `now()` would put
 * every seeded touch inside every window — quietly making the window test pass
 * whatever the window said.
 *
 * `toAddress` defaults to a number in the ACMA FICTION range (+61491570xxx),
 * never a real mobile: these rows go to the hosted production database.
 *
 * Returns the row id.
 */
export async function seedLedgerRow(
  tenantId: string,
  entry: {
    cadenceId: string;
    /** NULL for a lead cadence's row (Phase 13): exactly one owner per row. */
    quoteId: string | null;
    /** The lead a lead cadence's row belongs to (Phase 13); omitted for a quote. */
    leadId?: string | null;
    touchNumber: number;
    claimedAt: string;
    channel?: 'sms' | 'email';
    toAddress?: string;
    sender?: string;
    outcome?: string | null;
    deliveryStatus?: string | null;
    /**
     * 2026-10 (Phase 15, 15-03): the provider's receipt instant
     * (`delivered_at`) — what the delivered-timing figure reads. Defaults to
     * NULL, as on a row no receipt has reached.
     */
    deliveredAt?: string | null;
  },
): Promise<string> {
  const { data, error } = await admin
    .from('send_ledger')
    .insert({
      tenant_id: tenantId,
      cadence_id: entry.cadenceId,
      quote_id: entry.quoteId,
      lead_id: entry.leadId ?? null,
      touch_number: entry.touchNumber,
      claimed_at: entry.claimedAt,
      channel: entry.channel ?? 'sms',
      to_address: entry.toAddress ?? '+61491570156',
      // NOT 'stub'. A stub row is excluded from attribution forever by the
      // `sender` column (Phase 3 D-13), so a seeder defaulting to it would make
      // every attribution test silently assert nothing.
      sender: entry.sender ?? 'clicksend',
      outcome: entry.outcome === undefined ? 'sent' : entry.outcome,
      // NULL = no receipt yet, which QUALIFIES (D-02: a pending receipt counts).
      // Distinct from 'undelivered', which does not.
      delivery_status: entry.deliveryStatus ?? null,
      delivered_at: entry.deliveredAt ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a ledger row failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * An `inbound_messages` row (MSG-03 evidence), written with the admin client.
 *
 * The reply half of the evidence chain: Phase 7 counts threaded replies per
 * quote and per period, and the opt-out rate reads the STOP rows.
 *
 * `body` DEFAULTS TO THE EMPTY STRING and `fromAddress` to a fiction number,
 * deliberately and not merely for convenience. These rows land on the hosted
 * production database, and a customer's words or mobile seeded into the inbound
 * table would be indistinguishable from a real reply on the operator's triage
 * screen. The column already treats `''` as a first-class value (a provider can
 * deliver an empty-bodied SMS), so nothing is being faked.
 *
 * `receivedAt` IS REQUIRED, for the `claimedAt` reason above: it is what a
 * per-period reply count is bucketed by.
 *
 * Returns the row id.
 */
export async function seedInbound(
  tenantId: string,
  entry: {
    cadenceId: string;
    /** NULL for a reply threaded to a lead cadence (Phase 13). */
    quoteId: string | null;
    receivedAt: string;
    attribution?: 'threaded' | 'ambiguous' | 'unmatched' | 'dead_letter';
    label?: string | null;
    isHot?: boolean;
    isStop?: boolean;
    fromAddress?: string;
    /** The lead a lead reply threads to (Phase 13, D-10); omitted for a quote. */
    leadId?: string | null;
    /** The door's deterministic emergency flag (Phase 13, D-06) — lead rows only. */
    keywordHot?: boolean;
    /** The reply's text. Defaults to '' — see above for why. */
    body?: string;
    /**
     * 2026-10 (Phase 15, 15-03): a labelled LEAD reply must carry its urgency
     * (`inbound_messages_lead_label_has_urgency`), and the `/leads` card reads
     * the confidence beside the label. Both default to NULL.
     */
    urgency?: string | null;
    labelConfidence?: string | null;
  },
): Promise<string> {
  const from = entry.fromAddress ?? '+61491570157';

  const { data, error } = await admin
    .from('inbound_messages')
    .insert({
      tenant_id: tenantId,
      cadence_id: entry.cadenceId,
      quote_id: entry.quoteId,
      received_at: entry.receivedAt,
      attribution: entry.attribution ?? 'threaded',
      matched_cadence_count: 1,
      channel: 'sms',
      from_address: from,
      normalized_from: from,
      body: entry.body ?? '',
      is_stop: entry.isStop ?? false,
      label: entry.label ?? null,
      is_hot: entry.isHot ?? false,
      lead_id: entry.leadId ?? null,
      keyword_hot: entry.keywordHot ?? false,
      urgency: entry.urgency ?? null,
      label_confidence: entry.labelConfidence ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding an inbound message failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Put the shared test operator on `operator_allowlist`, so suites that read the
 * non-tenant tables through an operator JWT see rows rather than an empty set.
 *
 * Deliberately NOT called from a global setup: the tables gated by
 * `is_operator()` are supposed to be invisible to a user who is not enrolled,
 * and a blanket enrolment would make that property untestable. Suites opt in.
 */
export async function ensureOperatorAllowlisted(): Promise<string> {
  const operatorId = await ensureOperatorExists();

  const { error } = await admin
    .from('operator_allowlist')
    .upsert({ user_id: operatorId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw new Error(`Allowlisting the operator failed: ${error.message}`);

  return operatorId;
}

/**
 * A prospect row (D-01), written with the admin client.
 *
 * Written through the SERVICE-ROLE client on purpose, and not merely for
 * convenience: `authenticated` holds no INSERT grant on this table (0014),
 * because the only sanctioned creation path is the verify-then-write audit
 * action. Seeding through the anon client would fail — correctly — and the
 * failure would look like an RLS bug rather than the grant working.
 */
export async function seedProspect(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const { data, error } = await admin
    .from('prospects')
    .insert({
      business_name: `Audit Prospect ${stamp}`,
      source: 'api_key',
      timezone: 'Australia/Perth',
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding a prospect failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Raw audit lines for a prospect.
 *
 * `purge_after` is NOT defaulted here. The D-04 guarantee is that the
 * APPLICATION sets it at every insert, and a helper that quietly filled it in
 * would make the purge tests pass regardless of whether that guarantee holds —
 * each caller states the retention it is testing.
 */
export async function seedProspectLines(
  prospectId: string,
  rows: Array<Record<string, unknown>> = [{}],
): Promise<Array<{ id: string }>> {
  const payload = rows.map((row, i) => ({
    prospect_id: prospectId,
    sm8_job_uuid: randomUUID(),
    status: 'Quote',
    quote_date_raw: `2026-06-2${(i % 9) + 1} 09:00:00`,
    line_source: 'api',
    ...row,
  }));

  const { data, error } = await admin
    .from('prospect_quote_lines')
    .insert(payload)
    .select('id');

  if (error) throw new Error(`Seeding prospect lines failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string }>;
}

/**
 * Delete prospects by id; `prospect_quote_lines` cascades.
 *
 * A tenant that references one of them does NOT cascade (the FK is NO ACTION on
 * purpose — deleting a prospect must never delete a paying client), so a suite
 * that converted a prospect must tear the tenant down first. The error surfaces
 * rather than being swallowed, because a silent leftover here is a row in the
 * founder's real sales pipeline view.
 */
export async function teardownProspects(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await admin.from('prospects').delete().in('id', ids);
  if (error) throw new Error(`Teardown failed, prospects left behind: ${error.message}`);
}

/**
 * Deleting a tenant cascades to tenant_members, sm8_connections, quotes,
 * quote_contacts, sync_runs, cadence_touch_templates and cadence_settings —
 * every one of those foreign keys is `ON DELETE CASCADE`.
 *
 * EVERYTHING IN `NO_CASCADE_TABLES` IS AN EXCEPTION, AND EVERY ONE OF THEM IS
 * DELIBERATE. These tables carry `tenant_id` with no foreign key at all,
 * because they are the evidence Phase 7 computes recovered revenue from (and,
 * for `suppressed_contacts`, the Spam Act record) — a client who disconnects
 * must not take their own attribution or suppression history with them. See
 * the headers of src/db/schema/quote-events.ts, send-ledger.ts and
 * suppressed-contacts.ts.
 *
 * That design choice means test teardown has to say so OUT LOUD rather than
 * inherit a cascade: otherwise every run leaves rows behind pointing at tenants
 * that no longer exist, in tables nobody thinks to look at.
 *
 * ORDER IS CHILDREN BEFORE PARENTS. `cadence_touches` has the one real FK in
 * the cadence family (to `cadences`, ON DELETE CASCADE) so it would follow
 * anyway — it is listed first regardless, because relying on a cascade that a
 * future schema change might drop is how leftovers reappear silently.
 */
const NO_CASCADE_TABLES = [
  'cadence_touches',
  'send_ledger',
  'cadences',
  // 2026-10 (Phase 12, 0039). Evidence family: `leads` carries `tenant_id`
  // with no FK, so nothing sweeps it — and it is listed AFTER `cadences`
  // because a lead cadence points at its lead (children before parents). Left
  // behind, an OPEN lead for a recycled tenant id would hold
  // `leads_one_open_per_mobile` and make the next run's first call read
  // `lead_open`. `tenant_never_text_numbers` (no FK either) beside it: a
  // leftover own-line entry would turn a later suite's caller into
  // `own_number`. `text_back_templates` CASCADES from `tenants` (config
  // family) and is listed anyway, the `tenant_fees` rule below.
  // `operator_alert_log` is tenant-less: the suites that write it delete their
  // own rows by key.
  'leads',
  'tenant_never_text_numbers',
  'text_back_templates',
  'suppressed_contacts',
  'quote_status_events',
  // 04-01. Same rule, one caveat that no tenant-keyed teardown can cover: an
  // UNATTRIBUTED inbound row carries `tenant_id = NULL` on purpose (a reply we
  // could not place is still recorded), so it matches no `.in('tenant_id', ids)`
  // predicate. A suite that exercises the unmatched branches must delete its own
  // rows BY ID — tests/inbound-stop.test.ts does, and says so.
  'inbound_messages',
  // 05-01. Evidence family, so no FK and no cascade — same rule as the rows
  // above it. Ordering is unconstrained (it references nothing), but it is
  // listed BEFORE `cadence_touches` so a reader does not have to check whether
  // it needed to be.
  'touch_drafts',
  // 06-05. Evidence family again, and the one whose leftovers are most
  // expensive: `escalations` carries the UNIQUE(inbound_message_id) never-twice
  // claim, so a row left behind by a previous run permanently suppresses the
  // escalation of that inbound id. Test inbound ids are fresh each run, so the
  // real cost is residue on the shared database — but the delete is by
  // `tenant_id`, and an escalation whose inbound row was deleted BY ID (the
  // unattributed-reply caveat above) has to go with it.
  'escalations',
  // 06-04. Evidence family, third rule application: `tenant_attestations`
  // carries `tenant_id` with NO foreign key, because the record of what we
  // checked on a client's behalf outlives the client. Left behind, a stale
  // attestation row for a recycled tenant id would silently satisfy the ONB-04
  // half of the activation gate for a LATER test's tenant — a suite passing
  // because of somebody else's residue is the exact failure the ordered
  // one-tenant-per-concern rule in onboarding-gate.test.ts exists to avoid.
  'tenant_attestations',
  // 10-04. Evidence family, the `tenant_attestations` argument applied again:
  // `tenant_proofs` carries `tenant_id` with NO foreign key, so nothing sweeps
  // it. A leftover proof row for a recycled tenant id would answer "has this
  // client's escalation ever reached a real handset" with somebody else's
  // evidence — the one question the go-live runbook is not allowed to guess at.
  //
  // `messaging_config_audit` is deliberately NOT here. Its rows mirror
  // `messaging_config`, which teardown cannot reach at all (the global row
  // carries no tenant), so both are deleted BY ID by the suite that wrote them
  // — and a delete-by-tenant here would be this fixture quietly erasing the
  // record of an arming.
  //
  // 11-04. Evidence family, the telephony pair. `missed_calls` carries
  // `tenant_id` with no FK, so nothing sweeps it — and a leftover row would
  // answer "when did this client's divert last ring" with a previous run's call.
  // The `inbound_messages` caveat applies verbatim: a DEAD LETTER carries
  // `tenant_id = NULL`, matches no predicate here, and must be deleted BY ID by
  // the suite that wrote it (tests/missed-calls.test.ts does, and says so).
  'missed_calls',
  // 11-04. Config/evidence family: no FK and no cascade, because the record of
  // which number was a client's must outlive the client (D-08). Left behind, its
  // UNIQUE on `number_e164` would refuse the next run's seeded number.
  'tenant_divert_numbers',
  'tenant_proofs',
  // 07-01. Evidence family, and the residue that would cost the most: a
  // `quote_attributions` row left behind for a seeded tenant permanently
  // consumes the D-04 never-twice claim for that (tenant_id, quote_id) — so a
  // later suite proving "the second claim returns zero rows" would pass for the
  // wrong reason, or a first claim would fail for one. Deleted by `tenant_id`
  // with no cascade to inherit, exactly like the rows above it.
  'quote_attributions',
  // 07-01. Evidence family. A leftover frozen report for a recycled tenant id
  // would make `reports.list()` return a document nobody in this run generated,
  // and would push the next generated version to N+1 instead of 1.
  'monthly_reports',
  // 07-01. THIS ONE CASCADES (config family, FK to `tenants`), and it is listed
  // anyway — the header's rule: relying on a cascade that a future schema change
  // might drop is how leftovers reappear silently. It is listed BEFORE the
  // `tenants` delete for the same reason.
  'tenant_fees',
] as const;

export async function teardownTenants(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Sequential, not Promise.all: `cadence_touches` must be gone before
  // `cadences`, and a parallel run would race that ordering.
  for (const table of NO_CASCADE_TABLES) {
    const { error } = await admin.from(table).delete().in('tenant_id', ids);
    if (error) {
      throw new Error(`Teardown failed, ${table} rows left behind: ${error.message}`);
    }
  }

  const { error } = await admin.from('tenants').delete().in('id', ids);
  if (error) throw new Error(`Teardown failed, tenants left behind: ${error.message}`);
}

/** A signed-in operator on the anon key — the client RLS actually governs. */
export async function signInAsOperator(): Promise<SupabaseClient> {
  const client = createClient(testEnv.url, testEnv.anonKey, noPersist);
  const { error } = await client.auth.signInWithPassword({
    email: testEnv.operatorEmail,
    password: testEnv.operatorPassword,
  });
  if (error) throw new Error(`Operator sign-in failed: ${error.message}`);
  return client;
}
