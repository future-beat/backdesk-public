/**
 * "DID THIS ACTUALLY WORK ON PRODUCTION, AND WHAT IS THE RECEIPT?" — the
 * append-only evidence table, proven at the database (D-02, ARM-03/DOM-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PROPERTIES UNDER TEST ARE THE DATABASE'S, NOT THE REPOSITORY'S.      │
 * │ `artefact_id` too short, an unknown `kind`, a missing `recorded_by` and  │
 * │ an INSERT through the operator's own JWT are all refused by CHECKs, a    │
 * │ NOT NULL and a grant — so each is exercised through a path that has      │
 * │ EVERY REASON TO SUCCEED (the service-role client, or a signed-in         │
 * │ operator) and is refused anyway. A test that asserted the TypeScript     │
 * │ signature refuses them would be asserting caller discipline, which 02-04 │
 * │ recorded is not a guarantee.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * Every assertion here is a query. It runs against `supabase start` on the
 * runner and never through `npm run test:remote` (D-11): the hosted Sydney
 * project is production, and a proof row invented by a suite is exactly the
 * "manufactured evidence" D-06 forbids on that database.
 *
 * ── THE ESCALATION ROW THIS FILE WRITES IS FICTION, AND IT IS DELETED ───────
 *
 * `getEscalationForTenant` is the read the proof action verifies a pasted
 * artefact id with, so proving it needs a row to read. The row is seeded through
 * the service-role client with the minimum columns, carries an ACMA fiction-block
 * number, is tracked by id and deleted by id in `afterAll` BEFORE the tenants go
 * — `escalations` carries `tenant_id` with no foreign key, so nothing sweeps it
 * on its own. Nothing in this file sends anything to anybody: no tick runs and
 * no sender exists here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, forTenant, getEscalationForTenant } from '../src/db/repository';

import { admin, ensureOperatorExists, seedTenant, signInAsOperator, teardownTenants } from './helpers/seed';

/** ACMA's fiction block — nothing here is dialable. */
const TRADIE_PHONE = '+61491570164';

/** Long enough to clear the 8..128 CHECK, and obviously not a real provider id. */
const ESCALATION_ARTEFACT = 'ClickSend-fictional-0001';
const EMAIL_ARTEFACT = 'resend-fictional-0001';

let operatorId: string;
let tenantId: string;
/** The OTHER client — the one whose escalation must never verify for the first. */
let otherTenantId: string;

const tenantIds: string[] = [];
/** Every `escalations` row this suite wrote. No FK to tenants; deleted by id. */
const escalationIds: string[] = [];

/** A fictional escalation row for one tenant, through the service-role client. */
async function seedEscalation(
  forTenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from('escalations')
    .insert({
      tenant_id: forTenantId,
      inbound_message_id: crypto.randomUUID(),
      cadence_id: crypto.randomUUID(),
      quote_id: crypto.randomUUID(),
      to_address: TRADIE_PHONE,
      outcome: 'sent',
      provider_message_id: 'seeded-provider-id',
      sent_at: new Date().toISOString(),
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding an escalation failed: ${error.message}`);
  const id = (data as { id: string }).id;
  escalationIds.push(id);
  return id;
}

beforeAll(async () => {
  operatorId = await ensureOperatorExists();
  tenantId = await seedTenant('Proofs Owner');
  otherTenantId = await seedTenant('Proofs Stranger');
  tenantIds.push(tenantId, otherTenantId);
});

afterAll(async () => {
  // BY ID and FIRST — `escalations` has no foreign key to `tenants`, so the
  // teardown sweep by tenant id is a belt this file does not rely on.
  if (escalationIds.length > 0) {
    const { error } = await admin.from('escalations').delete().in('id', escalationIds);
    if (error) throw new Error(`Teardown failed, escalations left behind: ${error.message}`);
  }
  // `tenant_proofs` IS swept by `teardownTenants` (10-04 added it to the
  // no-cascade list), and the reason is this suite's own subject matter: a
  // leftover proof row for a recycled tenant id would answer "has this client's
  // escalation ever reached a real handset" with somebody else's evidence.
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

/* -------------------------------------------------------------------------- *
 * append + latest
 * -------------------------------------------------------------------------- */

describe('proofs.append then proofs.latest (D-02)', () => {
  it('returns the appended row, with recorded_at set by the DATABASE', async () => {
    const before = Date.now();

    const appended = await forTenant(tenantId).proofs.append({
      kind: 'escalation_handset_proof',
      artefactId: ESCALATION_ARTEFACT,
      artefactDetail: { provider_message_id: 'seeded-provider-id' },
      note: 'handset buzzed on the bench, read it out loud',
      recordedBy: operatorId,
    });

    expect(appended).toHaveLength(1);
    expect(appended[0]?.artefactId).toBe(ESCALATION_ARTEFACT);
    expect(appended[0]?.recordedBy).toBe(operatorId);

    // SERVER-SET, NEVER SUBMITTED. `recordedAt` is not a parameter of `append`
    // at all — a proof whose date somebody could type is a date, not a proof —
    // so the only evidence that it was set is that a plausible instant came
    // back without anybody supplying one.
    expect(appended[0]?.recordedAt).toBeInstanceOf(Date);
    expect(appended[0]!.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 60_000);

    const latest = await forTenant(tenantId).proofs.latest('escalation_handset_proof');
    expect(latest).toHaveLength(1);
    expect(latest[0]?.id).toBe(appended[0]?.id);
  });

  it('is LATEST-WINS across two proofs of the same kind — re-proving is a NEW ROW', async () => {
    const repo = forTenant(tenantId);

    const second = await repo.proofs.append({
      kind: 'escalation_handset_proof',
      artefactId: `${ESCALATION_ARTEFACT}-again`,
      artefactDetail: {},
      note: 're-proved after the number changed',
      recordedBy: operatorId,
    });

    const latest = await repo.proofs.latest('escalation_handset_proof');
    expect(latest[0]?.id).toBe(second[0]?.id);
    expect(latest[0]?.artefactId).toBe(`${ESCALATION_ARTEFACT}-again`);

    // The first row is STILL THERE. An append-only table whose history could be
    // lost would answer "when did this last actually work" and "did it ever"
    // with the same row.
    const { data, error } = await admin
      .from('tenant_proofs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('kind', 'escalation_handset_proof');
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('answers [] — never a guess — for a kind nobody has proven', async () => {
    // `[]` MUST BE READ AS "NOT PROVEN". This is the vacuous-truth direction
    // (T-5-13) applied to the `live` derivation: a client whose email pipe has
    // never been proven is exactly the client that derivation exists to describe.
    expect(await forTenant(tenantId).proofs.latest('email_pipe_proof')).toEqual([]);
    expect(await forTenant(otherTenantId).proofs.latest('escalation_handset_proof')).toEqual([]);
  });

  it('accepts divert_verification_call (0038) — append and latest round-trip', async () => {
    // THE THIRD KIND (Phase 11, CAP-05). The artefact is a `missed_calls` row
    // id; this suite only proves the table takes the kind and reads it back —
    // verifying the artefact is the proof action's job (plan 11-05).
    const artefactId = crypto.randomUUID();
    const appended = await forTenant(tenantId).proofs.append({
      kind: 'divert_verification_call',
      artefactId,
      artefactDetail: { call_status: 'completed', forwarded_from_present: false },
      note: 'rang the client line from the bench, it diverted and the greeting played',
      recordedBy: operatorId,
    });
    expect(appended[0]?.kind).toBe('divert_verification_call');

    const latest = await forTenant(tenantId).proofs.latest('divert_verification_call');
    expect(latest).toHaveLength(1);
    expect(latest[0]?.artefactId).toBe(artefactId);

    // AND IT IS ITS OWN KIND: it does not answer for either messaging proof.
    expect(await forTenant(otherTenantId).proofs.latest('divert_verification_call')).toEqual([]);
  });

  it('is tenant-scoped: one client\'s proof is not another\'s', async () => {
    await forTenant(otherTenantId).proofs.append({
      kind: 'email_pipe_proof',
      artefactId: EMAIL_ARTEFACT,
      artefactDetail: { last_event: 'delivered', to_domain: 'example.test' },
      note: 'arrived in the operator inbox, SPF and DKIM both pass',
      recordedBy: operatorId,
    });

    expect(await forTenant(tenantId).proofs.latest('email_pipe_proof')).toEqual([]);
    const theirs = await forTenant(otherTenantId).proofs.latest('email_pipe_proof');
    expect(theirs[0]?.artefactId).toBe(EMAIL_ARTEFACT);
  });
});

/* -------------------------------------------------------------------------- *
 * What the DATABASE refuses
 * -------------------------------------------------------------------------- */

describe('the table refuses a proof that proves nothing', () => {
  it('refuses an artefact id under eight characters, through the SERVICE-ROLE client', async () => {
    // The most privileged client this codebase has, and it is still refused:
    // `'x'` satisfies a NOT NULL and proves nothing, which is why the column
    // carries a length CHECK rather than only a required TypeScript field.
    const { error } = await admin.from('tenant_proofs').insert({
      tenant_id: tenantId,
      kind: 'escalation_handset_proof',
      artefact_id: 'short',
      note: 'seeded — must be refused',
      recorded_by: operatorId,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('tenant_proofs_artefact_present');
  });

  it('refuses an unknown kind', async () => {
    // The TypeScript union erases before the INSERT is built, so a typo would
    // insert cleanly, satisfy no read, and leave the client showing "not proven"
    // forever with the proof sitting in the table.
    //
    // `text_back` DELIBERATELY, and still refused after Phase 12 (2026-10,
    // migration 0039): `text_back` is the CHANNEL, not a proof kind. Phase 12
    // added `text_back_proof` instead — the `_proof` suffix of its two
    // siblings — so the channel name can never be recorded as proof of
    // anything by a typo. The positive case is the next test.
    const { error } = await admin.from('tenant_proofs').insert({
      tenant_id: tenantId,
      kind: 'text_back',
      artefact_id: 'long-enough-to-pass',
      note: 'seeded — must be refused',
      recorded_by: operatorId,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('tenant_proofs_kind_known');
  });

  it('accepts text_back_proof — the Phase 12 kind (D-13, 0039)', async () => {
    // The artefact is the `missed_calls.id` of a delivered text-back. The row
    // is the tenant's, so `teardownTenants` sweeps it.
    const { data, error } = await admin
      .from('tenant_proofs')
      .insert({
        tenant_id: tenantId,
        kind: 'text_back_proof',
        artefact_id: '00000000-0000-4000-8000-00000000c0de',
        artefact_detail: { provider_message_id: 'seeded-message-id', after_hours: false },
        note: 'seeded — a delivered text-back, read back by a test',
        recorded_by: operatorId,
      })
      .select('kind')
      .single();

    expect(error).toBeNull();
    expect((data as { kind: string }).kind).toBe('text_back_proof');
  });

  it('refuses a proof with nobody\'s hand on it', async () => {
    const { error } = await admin.from('tenant_proofs').insert({
      tenant_id: tenantId,
      kind: 'email_pipe_proof',
      artefact_id: 'long-enough-to-pass',
      note: 'seeded — must be refused',
    });

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toContain('recorded_by');
  });

  it('refuses an INSERT through the operator\'s own JWT — SELECT only (0036)', async () => {
    // APPEND-ONLY IS IN THE GRANTS, not only in the repository surface. The
    // console reaches this table through a server action on the service-role
    // connection after the allowlist read; a browser session holding the anon
    // key has no write path at all, whatever RLS would have said about the row.
    const operator = await signInAsOperator();

    const { error } = await operator.from('tenant_proofs').insert({
      tenant_id: tenantId,
      kind: 'email_pipe_proof',
      artefact_id: 'long-enough-to-pass',
      note: 'posted from a browser session',
      recorded_by: operatorId,
    });

    expect(error).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- *
 * The artefact read the proof action verifies with
 * -------------------------------------------------------------------------- */

describe('getEscalationForTenant scopes the artefact to its owner (T-10-17)', () => {
  it('returns the row, with its provider message id, for the tenant who owns it', async () => {
    const escalationId = await seedEscalation(tenantId);

    const row = await getEscalationForTenant(tenantId, escalationId);

    expect(row?.id).toBe(escalationId);
    expect(row?.outcome).toBe('sent');
    // THE HANDLE THAT SURVIVES OUTSIDE THIS DATABASE. The proof is re-checkable
    // at ClickSend by somebody who was not there, and this id is how.
    expect(row?.providerMessageId).toBe('seeded-provider-id');

    // AND NOT THE TRADIE'S NUMBER. The select list has no `to_address`, because
    // whatever this read returns ends up in a stored artefact (T-10-20).
    expect(Object.keys(row ?? {})).not.toContain('toAddress');
  });

  it('returns null for ANOTHER tenant\'s escalation id', async () => {
    const strangersEscalation = await seedEscalation(otherTenantId);

    // The tenant is in the PREDICATE. A read that fetched the row and compared
    // the tenant afterwards is one early return away from proving another
    // client's escalation for this one.
    expect(await getEscalationForTenant(tenantId, strangersEscalation)).toBeNull();
    expect(await getEscalationForTenant(otherTenantId, strangersEscalation)).not.toBeNull();
  });

  it('returns null for an id that does not exist', async () => {
    // "No such escalation" and "somebody else's escalation" are the SAME answer
    // deliberately: the caller has nothing to say about the difference that
    // would not also tell a guesser which uuids exist.
    expect(await getEscalationForTenant(tenantId, crypto.randomUUID())).toBeNull();
  });
});
