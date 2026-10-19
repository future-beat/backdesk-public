/**
 * ONE TAP CREATES THE SERVICEM8 JOB FOR A LEAD, EXACTLY ONCE (Phase 14,
 * SM8-01, SM8-02, SM8-03; D-01..D-06, D-13). Framework-free: the server action
 * calls `createJobForLead` after it has authorised the operator and the
 * tenant; tests call it with a stub ServiceM8 through `options.clientFactory`.
 *
 * ── THE ORDER, AND WHY EACH STEP IS WHERE IT IS ─────────────────────────────
 *
 *  1. FACTS AND REFUSALS. The sheet's facts are read (`jobSheetFacts`) and the
 *     cheap refusals answered before anything is claimed: no lead / not open →
 *     `not_open` (or `already_created`), no reply → `no_reply` (D-01's "at
 *     least one inbound reply", enforced here and not only at render), and
 *     THREAD CHANGED → `thread_changed`: the newest reply is not the one the
 *     operator's preview was built from, OR the preview's digest
 *     (`previewSha256For` — every reply, the urgency line, the note) differs
 *     from the one recomputed from these facts — a reply landed or the
 *     classifier labelled one between the preview and the confirm, and the
 *     operator must read it before anything is written (checker W3; 14-REVIEW
 *     WR-04).
 *  2. THE CONNECTION. None → `not_connected`; paused → `connection_paused`.
 *     The key is decrypted in-process exactly as the sync does.
 *  3. THE CLAIM IS THE ARBITER (provision.ts's reason). `claimJobCreation` is
 *     the only transition into `creating`, one guarded UPDATE decided by
 *     Postgres under row locking. Zero rows is an answer: the second of two
 *     taps reads `jobStateFor` and is told `already_in_progress` or
 *     `already_created`. Never check-then-act.
 *  4. SERVICEM8, OUTSIDE ANY TRANSACTION (connect.ts's reason: an open
 *     Postgres transaction held across seconds of third-party HTTP occupies a
 *     pooled connection). `provisionLeadJob` adopts before it creates at every
 *     step and hands each uuid to `setJobLinkage` the moment it is known.
 *  5. A FAILURE IS RECORDED, NEVER THROWN: `recordJobFailure` with the closed
 *     kind; the persisted uuids are kept and the retry reconciles on them.
 *  6. THE UNIT OF WORK — ONE transaction: the job into the quotes mirror as
 *     `needs_review` / `lead` (D-05, D-06 — never `eligible`, never an event:
 *     the next sync cycle finds a known row and emits nothing, D-13), the
 *     caller's contact into `quote_contacts`, the lead `created`, and the lead
 *     closed `job_created` through `closeLeadInTx` ON THIS TRANSACTION'S
 *     HANDLE (close.ts's reason: the wrapper would open a second connection
 *     that waits on the row lock this one holds). A throw is caught once and
 *     recorded `readback_mismatch`: the job now exists in the tradie's account
 *     and the retry adopts it by uuid. ONE EXCEPTION (14-REVIEW WR-02): a
 *     23505 on `leads_sm8_job_created_uniq` means the adopted job is already
 *     another lead's — the job linkage is cleared (company kept) and the lead
 *     fails `job_linked_elsewhere` (its own kind since migration 0042, Phase
 *     15 D-08a), so the retry creates fresh instead of looping.
 *
 * ── THE READ-THEN-CLAIM WINDOW NEEDS NO LOCK (checker I4) ───────────────────
 *
 * The facts are read BEFORE the claim, and the description is built from the
 * very facts the thread-change check passed on — which equal what the
 * operator previewed. A reply arriving AFTER this read and before the claim
 * is therefore not in the job (it is not caught; it is simply not written,
 * and it waits in the inbox like any reply); a lead that closed in between is
 * caught by the claim's `status = 'open'` guard. Neither needs a lock.
 *
 * LOGS carry the lead id, the tenant id, the job uuid and the closed kind —
 * never the caller's mobile, a reply body, a company name or a ServiceM8
 * response body (T-14-09).
 */
import { normalizeJob, SM8_TIMESTAMP_ZONE } from '@/core/servicem8/normalize';
import { createSm8Client } from '@/core/servicem8/client';
import type { Sm8WriteClient } from '@/core/servicem8/types';
import { decodeEncryptionKey, decryptCredential } from '@/core/shared/crypto';
import { getServerEnv } from '@/core/shared/env';
import { normalizeContact } from '@/core/sync/run-sync';
import { forTenant } from '@/db/repository';
import type { LeadJobErrorKind } from '@/db/schema';

import { closeLeadInTx } from './close';
import { buildJobDescription } from './job-description';
import { previewSha256For, provisionLeadJob } from './job-provision';
import { mobileTail } from './mobile-spellings';

/** What the operator confirmed on the sheet. Everything else is re-read from the database. */
export interface CreateJobInput {
  companyName: string;
  contactFirst: string | null;
  contactLast: string | null;
  suburb: string | null;
  /** The newest reply's id the preview was built from (checker W3). */
  expectedLatestInboundId: string;
  /**
   * `previewSha256For` of the facts the sheet's preview was built from
   * (14-REVIEW WR-04): recomputed here, any difference is `thread_changed`.
   */
  expectedPreviewSha256: string;
}

export interface CreateJobOptions {
  clientFactory?: (apiKey: string) => Sm8WriteClient;
  now?: Date;
}

export type CreateJobResult =
  | {
      kind: 'created';
      jobUuid: string;
      adopted: { company: boolean; job: boolean; contact: boolean };
    }
  | { kind: 'already_in_progress' }
  | { kind: 'already_created'; jobUuid: string | null }
  | { kind: 'not_open' }
  | { kind: 'no_reply' }
  | { kind: 'thread_changed' }
  | { kind: 'not_connected' }
  | { kind: 'connection_paused' }
  | { kind: 'failed'; errorKind: LeadJobErrorKind };

/** The lead left `creating` under the unit of work — throw, so nothing commits. */
class LeadNoLongerCreating extends Error {
  constructor() {
    super('lead is no longer creating');
    this.name = 'LeadNoLongerCreating';
  }
}

/** The partial unique that keeps one ServiceM8 job to one created lead (0041). */
const JOB_CREATED_UNIQUE = 'leads_sm8_job_created_uniq';

/**
 * Is this the unit of work losing to `leads_sm8_job_created_uniq` — the job we
 * adopted is already ANOTHER lead's created job (14-REVIEW WR-02)? SQLSTATE
 * 23505 naming that index, on the error or its `cause` chain (drizzle wraps
 * the driver's error — the walk `generate.ts` and `provision.ts` make). Any
 * other unique violation is not this case.
 */
function isJobCreatedUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    const { code, constraint_name: constraint, message } = current as {
      code?: unknown;
      constraint_name?: unknown;
      message?: unknown;
    };
    if (
      code === '23505' &&
      (constraint === JOB_CREATED_UNIQUE ||
        (typeof message === 'string' && message.includes(JOB_CREATED_UNIQUE)))
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause ?? null;
  }
  return false;
}

/** The answer for a lead whose state refuses a (new) creation. */
function refusalFor(state: { status: string; sm8JobState: string; sm8JobUuid: string | null }):
  | { kind: 'already_in_progress' }
  | { kind: 'already_created'; jobUuid: string | null }
  | { kind: 'not_open' } {
  if (state.sm8JobState === 'created') return { kind: 'already_created', jobUuid: state.sm8JobUuid };
  if (state.status !== 'open') return { kind: 'not_open' };
  if (state.sm8JobState === 'creating') return { kind: 'already_in_progress' };
  return { kind: 'not_open' };
}

/**
 * Create the ServiceM8 job for one open lead, exactly once. See the header for
 * the order. `operatorUserId` is the verified claim's `sub` — never a field.
 */
export async function createJobForLead(
  tenantId: string,
  leadId: string,
  input: CreateJobInput,
  operatorUserId: string,
  options: CreateJobOptions = {},
): Promise<CreateJobResult> {
  const {
    clientFactory = (apiKey: string) => createSm8Client({ kind: 'apiKey', key: apiKey }),
    now = new Date(),
  } = options;
  const repo = forTenant(tenantId);

  // ── 1. Facts and refusals ──────────────────────────────────────────────────
  const facts = await repo.leads.jobSheetFacts(leadId);
  const [tenant] = await repo.tenant.get();
  if (facts === null || tenant === undefined) return { kind: 'not_open' };
  if (facts.status !== 'open' || facts.sm8JobState === 'created' || facts.sm8JobState === 'creating') {
    return refusalFor(facts);
  }
  const newest = facts.replies.at(-1);
  if (newest === undefined) return { kind: 'no_reply' };
  if (newest.id !== input.expectedLatestInboundId) return { kind: 'thread_changed' };
  // WR-04: the newest id alone misses an urgency label the classifier set
  // between render and confirm. The digest covers every preview line.
  const previewSha256 = previewSha256For({
    replies: facts.replies,
    firstMissedAt: facts.firstMissedAt,
    timezone: tenant.timezone,
  });
  if (previewSha256 !== input.expectedPreviewSha256) return { kind: 'thread_changed' };

  // ── 2. The connection ──────────────────────────────────────────────────────
  const [connection] = await repo.connection.get();
  if (connection === undefined) return { kind: 'not_connected' };
  if (connection.pausedAt !== null) return { kind: 'connection_paused' };
  const encryptionKey = decodeEncryptionKey(getServerEnv().CREDENTIALS_ENCRYPTION_KEY);
  const client = clientFactory(decryptCredential(connection.apiKeyCiphertext, encryptionKey));

  // ── 3. The claim ───────────────────────────────────────────────────────────
  const [claim] = await repo.leads.claimJobCreation(leadId, now);
  if (claim === undefined) {
    const [state] = await repo.leads.jobStateFor(leadId);
    return state === undefined ? { kind: 'not_open' } : refusalFor(state);
  }

  // ── 4. ServiceM8, outside any transaction ──────────────────────────────────
  const description = buildJobDescription(
    { replies: facts.replies, firstMissedAt: facts.firstMissedAt, timezone: tenant.timezone },
    input.suburb,
  );
  let provisioned: Awaited<ReturnType<typeof provisionLeadJob>>;
  try {
    const candidates = await repo.quoteContacts.companyCandidatesByMobileTail(
      mobileTail(facts.contactMobile),
    );
    provisioned = await provisionLeadJob(
      client,
      {
        companyName: input.companyName,
        contactFirst: input.contactFirst,
        contactLast: input.contactLast,
        mobileE164: facts.contactMobile,
        description,
        jobAddress: null,
      },
      {
        companyUuid: claim.sm8CompanyUuid,
        jobUuid: claim.sm8JobUuid,
        contactUuid: claim.sm8JobContactUuid,
        descriptionSha256: claim.sm8JobDescriptionSha256,
      },
      candidates,
      async (patch) => {
        await repo.leads.setJobLinkage(leadId, patch);
      },
      (staleKind) => {
        // WR-01: the persisted job was deleted in ServiceM8; it was cleared and
        // a fresh one follows. Ids and the closed kind only.
        const staleJobUuid = claim.sm8JobUuid;
        console.warn(
          `[leads] lead ${leadId} (tenant ${tenantId}): persisted job ${staleJobUuid} not adopted, kind ${staleKind}, so it was cleared.`,
        );
      },
    );
  } catch {
    // A database throw mid-pipeline (a persist), never a ServiceM8 answer —
    // the client classifies those. What ServiceM8 holds is unknown, which is
    // exactly the retry-adopts case. The caught value is not logged.
    provisioned = { ok: false, kind: 'readback_mismatch' };
  }

  // ── 5. A failure is recorded ───────────────────────────────────────────────
  if (!provisioned.ok) {
    const kind = provisioned.kind;
    await repo.leads.recordJobFailure(leadId, kind, now);
    console.error(`[leads] job creation for lead ${leadId} (tenant ${tenantId}) failed: ${kind}.`);
    return { kind: 'failed', errorKind: kind };
  }

  // ── 6. The unit of work ────────────────────────────────────────────────────
  const { job, contact } = provisioned;
  const jobUuid = job.uuid;
  const contactUuid = contact.uuid;
  try {
    await repo.transaction(async (tx) => {
      await tx.quotes.upsertManyReturning([
        {
          ...normalizeJob(job, SM8_TIMESTAMP_ZONE),
          syncSource: 'lead',
          chaseEligibility: 'needs_review',
        },
      ]);
      await tx.quoteContacts.upsertMany([normalizeContact(contact)]);
      const linked = await tx.leads.recordJobCreated(leadId, {
        jobUuid,
        contactUuid,
        createdBy: operatorUserId,
        at: now,
      });
      if (linked.length === 0) throw new LeadNoLongerCreating();
      const closed = await closeLeadInTx(tx, leadId, 'job_created', now);
      if (closed.kind === 'already_closed') {
        console.error(`[leads] lead ${leadId} was already closed when job ${jobUuid} was recorded.`);
      }
    });
  } catch (error) {
    if (isJobCreatedUniqueViolation(error)) {
      // WR-02: the job adopted (by uuid or by digest) is already another
      // lead's created job. Re-adopting it on every Retry would hit this again
      // forever, so the job linkage — job uuid, contact uuid and the adopt key
      // that named it — is cleared (the company is kept) and the next attempt
      // creates a fresh job. The kind is dedicated since migration 0042
      // (Phase 15, D-08a; 14-REVIEW WR-02), so the sheet says what happened
      // instead of borrowing a parse failure's words. The caught value is not
      // logged.
      const kind: LeadJobErrorKind = 'job_linked_elsewhere';
      await repo.leads.setJobLinkage(leadId, {
        jobUuid: null,
        contactUuid: null,
        descriptionSha256: null,
      });
      await repo.leads.recordJobFailure(leadId, kind, now);
      console.error(
        `[leads] job ${jobUuid} for lead ${leadId} (tenant ${tenantId}) is already another lead's created job (unique violation on leads_sm8_job_created_uniq), so the linkage was cleared: ${kind}.`,
      );
      return { kind: 'failed', errorKind: kind };
    }
    // Nothing committed. The job exists in the tradie's account with its uuid
    // persisted; the retry adopts it. The caught value is not logged.
    const kind: LeadJobErrorKind = 'readback_mismatch';
    await repo.leads.recordJobFailure(leadId, kind, now);
    console.error(
      `[leads] job ${jobUuid} for lead ${leadId} (tenant ${tenantId}) could not be recorded: ${kind}.`,
    );
    return { kind: 'failed', errorKind: kind };
  }

  console.info(`[leads] job ${jobUuid} created for lead ${leadId} (tenant ${tenantId}).`);
  return { kind: 'created', jobUuid, adopted: provisioned.adopted };
}
