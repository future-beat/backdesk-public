/**
 * THE SERVICEM8 PIPELINE FOR ONE LEAD'S JOB (Phase 14, SM8-01, SM8-03; D-02,
 * D-03, D-04). Framework-free and database-free: it takes an `Sm8WriteClient`
 * (production's `createSm8Client`, a test's `createSm8Stub`), the plan, what a
 * previous attempt persisted, the mirror's company candidates, and a `persist`
 * callback — and it never opens a transaction (create-job.ts runs it OUTSIDE
 * any, for connect.ts's reason: third-party HTTP must not hold a pooled
 * connection).
 *
 * ── ADOPT BEFORE CREATE, AT EVERY STEP ──────────────────────────────────────
 *
 * ServiceM8 does not dedupe — an identical POST makes a second record (spike
 * ledger #15). So nothing here POSTs without first looking for what a previous
 * attempt may already have made:
 *
 *  - COMPANY: the persisted uuid (`getCompany`, active) → the mirror's
 *    contacts whose number normalises to the caller's (newest first, each
 *    verified active with `getCompany`) → ServiceM8's company contacts by the
 *    three spellings (`findCompanyContactsByMobile`, exact-spelling filter —
 *    ledger #4/#5) → only then `createCompany` + `createCompanyContact`
 *    carrying the caller's mobile, because a Company has no mobile of its own
 *    (ledger #2) and the next lookup must be able to find it.
 *  - JOB: the persisted uuid (`getJob`; ACTIVE → ours, whatever its status
 *    now; inactive or gone → the tradie deleted it, so the stale uuid and its
 *    contact uuid are cleared, `onStaleJob` reports the kind, and the step
 *    goes on as if nothing were persisted — 14-REVIEW WR-01) → an open Quote job of that company whose
 *    description's SHA-256 equals the digest PERSISTED BEFORE the first POST
 *    (`listOpenQuoteJobsForCompany`; never a re-composed string — the operator
 *    may retype the suburb on a retry, checker W1) → only then persist the new
 *    digest and `createJob`. With no digest persisted no job POST was ever
 *    made for this lead (the digest is written before the POST), so there is
 *    nothing to adopt and the list read is skipped.
 *  - CONTACT: on an ADOPTED job, its contacts (`listJobContactsForJob`) → an
 *    active JOB contact whose number normalises to the caller's → only then
 *    `createJobContact`. A job created in this attempt has no contacts
 *    (ServiceM8 auto-creates none for an API-created job, ledger #8), so the
 *    list read is skipped for it.
 *
 * Every uuid is handed to `persist` THE MOMENT IT IS KNOWN, so a crash between
 * steps leaves the retry something to reconcile on — including a uuid whose
 * POST succeeded but whose read-back failed (the wrapper carries it on the
 * failure; 14-REVIEW CR-01): it is persisted BEFORE the step returns failed.
 *
 * ── THE READ-BACK ───────────────────────────────────────────────────────────
 *
 * Each create wrapper reads its record back (writes.ts). After the contact the
 * job is read ONCE MORE: adding a contact bumps the job's `edit_date` (ledger
 * #11), and the mirror row must carry the final value or the sync's cursor
 * sees a change that is ours.
 *
 * NOTHING THROWS FOR AN EXPECTED FAILURE: every wrapper outcome maps to a
 * `LeadJobErrorKind` and comes back as `{ ok: false, kind }`. No log line
 * here: the caller logs ids and the kind.
 */
import { createHash } from 'node:crypto';

import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import { previewLinesFor } from '@/core/leads/job-description';
import { mobileSpellings, toLocalSpacedMobile } from '@/core/leads/mobile-spellings';
import type { Sm8Job, Sm8JobContact } from '@/core/servicem8/schemas';
import type { Sm8WriteClient } from '@/core/servicem8/types';
import {
  createCompany,
  createCompanyContact,
  createJob,
  createJobContact,
  findCompanyContactsByMobile,
  getCompany,
  getJob,
  listJobContactsForJob,
  listOpenQuoteJobsForCompany,
} from '@/core/servicem8/writes';
import type { LeadJobErrorKind } from '@/db/schema';

/** What will be written, built by the caller from the database — never from a posted preview. */
export interface LeadJobPlan {
  /** The operator-confirmed client-record name (required on the sheet). */
  companyName: string;
  contactFirst: string | null;
  contactLast: string | null;
  /** `leads.contact_mobile` — `+614…`, already proven by the column CHECK. */
  mobileE164: string;
  description: string;
  jobAddress: string | null;
}

/** What a previous attempt persisted — the claim's RETURNING row. */
export interface LeadJobPersisted {
  companyUuid: string | null;
  jobUuid: string | null;
  contactUuid: string | null;
  descriptionSha256: string | null;
}

/** A mirrored contact that may name the caller's company (`companyCandidatesByMobileTail`). */
export interface MirrorCompanyCandidate {
  companyUuid: string | null;
  mobile: string | null;
  phone: string | null;
  /** The CONTACT's flag. */
  sm8Active: boolean;
}

export interface LeadJobPersistPatch {
  companyUuid?: string;
  /** `null` clears a persisted job the tradie has since deleted (WR-01). */
  jobUuid?: string | null;
  /** `null` clears the contact of that deleted job with it. */
  contactUuid?: string | null;
  descriptionSha256?: string;
}

/**
 * Why a persisted job uuid was not adopted (WR-01): it reads back inactive
 * (soft-deleted, ledger #20) or it is gone (`bad_request`, A4). A closed
 * vocabulary — the caller logs it beside ids, never a number.
 */
export type StaleJobKind = 'inactive' | 'missing';

export type ProvisionResult =
  | {
      ok: true;
      /** The FINAL read-back of the job, after the contact. */
      job: Sm8Job;
      contact: Sm8JobContact;
      companyUuid: string;
      adopted: { company: boolean; job: boolean; contact: boolean };
    }
  | { ok: false; kind: LeadJobErrorKind };

type Step<T> = { ok: true; value: T } | { ok: false; kind: LeadJobErrorKind };

/** Hex SHA-256 — the adopt key for an orphaned job. Server-only (`node:crypto`). */
function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The confirm sheet's preview, digested (14-REVIEW WR-04). The page posts it
 * as a hidden field and `createJobForLead` recomputes it from the facts it
 * re-reads: ANY difference — a reply added, an urgency label the classifier
 * set between render and confirm, a reply body — is `thread_changed`, so what
 * is written is what the operator approved (D-01). The reply ids are in it so
 * that two identical bodies are still two replies. The suburb is not: the
 * operator types it on the sheet and the server composes it from the post.
 * Server-only (`node:crypto`); the page computes it, the client only echoes it.
 */
export function previewSha256For(facts: {
  replies: ReadonlyArray<{ id: string; body: string; urgency: string | null }>;
  firstMissedAt: Date;
  timezone: string;
}): string {
  const lines = previewLinesFor(facts);
  return sha256Of(
    JSON.stringify({
      replyIds: facts.replies.map((reply) => reply.id),
      replies: lines.replies,
      urgencyLine: lines.urgencyLine,
      noteLine: lines.noteLine,
    }),
  );
}

/** A blank optional name is absent, not an empty string in the tradie's ServiceM8. */
function optionalName(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Either of a contact's numbers normalises to the caller's. */
function sameMobile(
  row: { mobile?: string | null; phone?: string | null },
  mobileE164: string,
): boolean {
  return normalizeAuMobile(row.mobile) === mobileE164 || normalizeAuMobile(row.phone) === mobileE164;
}

/**
 * A company uuid we may use: it reads back active. `bad_request` (a uuid that
 * no longer exists on the account) is "not usable"; any transport failure
 * stops the pipeline rather than falling through to a create.
 */
async function activeCompany(client: Sm8WriteClient, uuid: string): Promise<Step<boolean>> {
  const read = await getCompany(client, uuid);
  if (read.ok) return { ok: true, value: read.data.active === true };
  if (read.kind === 'bad_request') return { ok: true, value: false };
  return { ok: false, kind: read.kind };
}

async function resolveCompany(
  client: Sm8WriteClient,
  plan: LeadJobPlan,
  persisted: LeadJobPersisted,
  candidates: readonly MirrorCompanyCandidate[],
  persist: (patch: LeadJobPersistPatch) => Promise<void>,
): Promise<Step<{ uuid: string; adopted: boolean }>> {
  const adopt = async (uuid: string): Promise<Step<{ uuid: string; adopted: boolean }>> => {
    if (uuid !== persisted.companyUuid) await persist({ companyUuid: uuid });
    return { ok: true, value: { uuid, adopted: true } };
  };

  // Tier 0: the uuid a previous attempt persisted.
  if (persisted.companyUuid !== null) {
    const usable = await activeCompany(client, persisted.companyUuid);
    if (!usable.ok) return usable;
    if (usable.value) return adopt(persisted.companyUuid);
  }

  // Tier (i): the mirror — newest first, as the read orders them.
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const uuid = candidate.companyUuid;
    if (uuid === null || seen.has(uuid)) continue;
    if (!candidate.sm8Active || !sameMobile(candidate, plan.mobileE164)) continue;
    seen.add(uuid);
    const usable = await activeCompany(client, uuid);
    if (!usable.ok) return usable;
    if (usable.value) return adopt(uuid);
  }

  // Tier (ii): ServiceM8's company contacts, three spellings, exact match.
  const found = await findCompanyContactsByMobile(client, mobileSpellings(plan.mobileE164));
  if (!found.ok) return { ok: false, kind: found.kind };
  for (const row of found.data) {
    if (row.active !== true || seen.has(row.company_uuid)) continue;
    seen.add(row.company_uuid);
    const usable = await activeCompany(client, row.company_uuid);
    if (!usable.ok) return usable;
    if (usable.value) return adopt(row.company_uuid);
  }

  // Tier (iii): create the client record, then the contact that carries the
  // mobile (a Company has none — ledger #2).
  const company = await createCompany(client, { name: plan.companyName.trim() });
  if (!company.ok) {
    // CR-01: the POST answered a uuid and the read-back did not confirm it —
    // the client record may exist. Persist it before giving up, so the retry
    // reads it back (tier 0) instead of creating a second client record.
    if (company.uuid !== undefined) await persist({ companyUuid: company.uuid });
    return { ok: false, kind: company.kind };
  }
  const companyUuid = company.data.uuid;
  await persist({ companyUuid });

  const contact = await createCompanyContact(client, {
    company_uuid: companyUuid,
    first: optionalName(plan.contactFirst),
    last: optionalName(plan.contactLast),
    mobile: toLocalSpacedMobile(plan.mobileE164),
    type: 'JOB',
    is_primary_contact: '1',
  });
  if (!contact.ok) return { ok: false, kind: contact.kind };

  return { ok: true, value: { uuid: companyUuid, adopted: false } };
}

async function resolveJob(
  client: Sm8WriteClient,
  plan: LeadJobPlan,
  persisted: LeadJobPersisted,
  companyUuid: string,
  persist: (patch: LeadJobPersistPatch) => Promise<void>,
  onStaleJob: (staleKind: StaleJobKind) => void,
): Promise<Step<{ uuid: string; adopted: boolean }>> {
  // The uuid a previous attempt persisted: ours, whatever its status now —
  // but only while it is ACTIVE (WR-01). A job the tradie deleted reads back
  // `active: false` (ledger #20); adopting it would hang a contact on a
  // deleted job and convert the lead to it. Inactive or gone, the stale uuid
  // (and the contact uuid on that job) is cleared and the step continues as
  // if nothing were persisted: adopt-by-digest lists `active eq 1` only, so a
  // fresh create follows. A transport failure stops the pipeline instead.
  if (persisted.jobUuid !== null) {
    const read = await getJob(client, persisted.jobUuid);
    if (read.ok && read.data.active === true) {
      return { ok: true, value: { uuid: persisted.jobUuid, adopted: true } };
    }
    if (!read.ok && read.kind !== 'bad_request') return { ok: false, kind: read.kind };
    await persist({ jobUuid: null, contactUuid: null });
    onStaleJob(read.ok ? 'inactive' : 'missing');
  }

  // Adopt-by-digest: only a persisted digest can name an orphan (see header).
  if (persisted.descriptionSha256 !== null) {
    const open = await listOpenQuoteJobsForCompany(client, companyUuid);
    if (!open.ok) return { ok: false, kind: open.kind };
    const orphan = open.data.find(
      (job) =>
        typeof job.job_description === 'string' &&
        sha256Of(job.job_description) === persisted.descriptionSha256,
    );
    if (orphan !== undefined) {
      await persist({ jobUuid: orphan.uuid });
      return { ok: true, value: { uuid: orphan.uuid, adopted: true } };
    }
  }

  // The digest goes down BEFORE the POST, so a crash after ServiceM8 made the
  // job (but before its uuid was persisted) leaves the retry a key to adopt by.
  const digest = sha256Of(plan.description);
  if (digest !== persisted.descriptionSha256) await persist({ descriptionSha256: digest });

  const created = await createJob(client, {
    status: 'Quote',
    company_uuid: companyUuid,
    job_description: plan.description,
    ...(plan.jobAddress === null ? {} : { job_address: plan.jobAddress }),
  });
  if (!created.ok) {
    // CR-01: the job may exist with this uuid. Persisted, the sync's
    // first-sight guard mirrors it needs_review / lead (no quote cadence) and
    // the retry adopts it by uuid; dropped, the next poll would open it.
    if (created.uuid !== undefined) await persist({ jobUuid: created.uuid });
    return { ok: false, kind: created.kind };
  }
  await persist({ jobUuid: created.data.uuid });

  return { ok: true, value: { uuid: created.data.uuid, adopted: false } };
}

async function resolveContact(
  client: Sm8WriteClient,
  plan: LeadJobPlan,
  jobUuid: string,
  jobAdopted: boolean,
  persisted: LeadJobPersisted,
  persist: (patch: LeadJobPersistPatch) => Promise<void>,
): Promise<Step<{ contact: Sm8JobContact; adopted: boolean }>> {
  if (jobAdopted) {
    const listed = await listJobContactsForJob(client, jobUuid);
    if (!listed.ok) return { ok: false, kind: listed.kind };
    const ours = listed.data.find(
      (row) =>
        row.active === true &&
        (row.type ?? '').toUpperCase() === 'JOB' &&
        sameMobile(row, plan.mobileE164),
    );
    if (ours !== undefined) {
      if (ours.uuid !== persisted.contactUuid) await persist({ contactUuid: ours.uuid });
      return { ok: true, value: { contact: ours, adopted: true } };
    }
  }

  const created = await createJobContact(client, {
    job_uuid: jobUuid,
    first: optionalName(plan.contactFirst),
    last: optionalName(plan.contactLast),
    mobile: toLocalSpacedMobile(plan.mobileE164),
    type: 'JOB',
  });
  if (!created.ok) {
    // CR-01: the contact may exist; the retry lists the job's contacts first.
    if (created.uuid !== undefined) await persist({ contactUuid: created.uuid });
    return { ok: false, kind: created.kind };
  }
  await persist({ contactUuid: created.data.uuid });

  return { ok: true, value: { contact: created.data, adopted: false } };
}

/**
 * Company → job → contact → final read-back, adopting at every step (see the
 * header). The caller holds the claim; this function holds nothing.
 */
export async function provisionLeadJob(
  client: Sm8WriteClient,
  plan: LeadJobPlan,
  persisted: LeadJobPersisted,
  mirrorCompanyCandidates: readonly MirrorCompanyCandidate[],
  persist: (patch: LeadJobPersistPatch) => Promise<void>,
  /** Told when a persisted job was not adopted (WR-01); the caller logs it. */
  onStaleJob: (staleKind: StaleJobKind) => void = () => {},
): Promise<ProvisionResult> {
  const company = await resolveCompany(client, plan, persisted, mirrorCompanyCandidates, persist);
  if (!company.ok) return company;

  const job = await resolveJob(client, plan, persisted, company.value.uuid, persist, onStaleJob);
  if (!job.ok) return job;

  const contact = await resolveContact(
    client,
    plan,
    job.value.uuid,
    job.value.adopted,
    persisted,
    persist,
  );
  if (!contact.ok) return contact;

  // The final read-back: the contact bumped the job's edit_date (ledger #11).
  const final = await getJob(client, job.value.uuid);
  if (!final.ok) return { ok: false, kind: 'readback_mismatch' };

  return {
    ok: true,
    job: final.data,
    contact: contact.value.contact,
    companyUuid: company.value.uuid,
    adopted: {
      company: company.value.adopted,
      job: job.value.adopted,
      contact: contact.value.adopted,
    },
  };
}
