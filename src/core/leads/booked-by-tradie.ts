/**
 * The tradie-booked resolution on the sync run (Phase 14, LEAD-04, D-07, D-12):
 * the post-commit pass that closes the lead the tradie booked himself.
 *
 * ── WHERE IT RUNS, AND WHY THERE ────────────────────────────────────────────
 *
 * `runSyncForConnection` calls `resolveLeadsBookedByTradie` once per cycle,
 * AFTER the cycle's locked write transaction has committed and before it
 * returns, inside a try/catch that logs a fixed sentence. Three reasons:
 *
 *  - The mirror it reads is the one the cycle just wrote, so a job and its
 *    contacts that arrived this cycle are matched this cycle.
 *  - Each hit opens ITS OWN transaction and closes the lead on that handle
 *    (`closeLeadInTx`). Inside the sync's transaction this would be the nested
 *    transaction `close.ts` warns about: a second pooled connection waiting on
 *    a cadence row lock the outer one may hold, while the outer waits for it.
 *  - The cycle's outcome is the sync's, not this pass's: a failure here changes
 *    no `sync_runs` row, no `SyncCycleResult` field, no cursor.
 *
 * ── WHAT IT MAY DO TO SERVICEM8: READ, AT MOST TEN TIMES ────────────────────
 *
 * Nothing is created, edited or deleted in ServiceM8 (D-12). The mirror tier
 * is free; the company-contact tier reads `companycontact.json` for a job with
 * no mirrored contact, at most `LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE` per
 * tenant per cycle, and only for a job inside the window of a lead the mirror
 * tier left unmatched. A tenant with no open lead at `none` spends ZERO reads
 * and one query — the live test tenant pays nothing for this on every tick.
 * Candidates past the cap wait for the next cycle.
 *
 * ── AND NEVER PAST THE TICK'S BUDGET (14-REVIEW WR-06) ──────────────────────
 *
 * The pass runs after the cycle has committed, outside the tick's
 * start-of-cycle deadline. So it carries a deadline of its own — the tick's
 * deadline less `LEAD_JOB_MATCH_PASS_MARGIN_MS`, handed down by the sync — and
 * each read waits at most `LEAD_JOB_MATCH_READ_TIMEOUT_MS`, never past that
 * deadline. Once the deadline is reached the remaining reads are SKIPPED,
 * counted and logged by kind (`tick_deadline`); their leads wait for the next
 * cycle. The mirror tier spends no read and always runs.
 *
 * ── NEVER DOUBLE-COUNTED (D-07) ─────────────────────────────────────────────
 *
 * Only an OPEN lead at `sm8_job_state = 'none'` is a candidate, and the
 * linkage write is guarded on exactly that. A lead the operator is creating a
 * job for (`creating`), has created one for (`created`, closed `job_created`)
 * or failed to (`failed`) is never touched: the two conversion reasons are
 * disjoint by construction. A repeated cycle finds no open candidate and does
 * nothing.
 *
 * ── AND THE ABANDONED CLAIM (plan 14-03, deviation B) ──────────────────────
 *
 * The pass first releases every lead of the tenant left in `creating` for
 * longer than `LEAD_JOB_CLAIM_STALE_MINUTES` — the operator's request died
 * mid-pipeline and nothing else ever will release it. One guarded UPDATE
 * (`creating` and attempted before the cutoff) to `failed` / `stale_claim`,
 * idempotent, uuids kept: the Retry comes back and its adopt-before-create
 * reconciles whatever ServiceM8 holds. A released lead is `failed`, so the
 * match below still never touches it.
 *
 * Logs carry ids and counts — never a caller's number, never a contact's.
 * Framework-free and model-free.
 */
import { sm8CompanyContact } from '@/core/servicem8/schemas';
import type { Sm8Client } from '@/core/servicem8/types';
import { forTenant, type JobContactMobile } from '@/db/repository';

import { closeLeadInTx } from './close';
import {
  LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE,
  LEAD_JOB_MATCH_READ_TIMEOUT_MS,
} from './constants';
import {
  contactsMatchMobile,
  jobInWindow,
  matchWindowFor,
  resolveLeadJobMatches,
  staleJobClaimCutoff,
  type LeadJobMatch,
  type MatchContact,
  type MatchLead,
} from './job-match';

/** A uuid, checked before it is placed inside a `$filter` string. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveBookedResult = { kind: 'resolved' } | { kind: 'skipped' };

export interface ResolveBookedPassResult {
  /** Leads closed `booked_by_tradie` this cycle. */
  resolved: number;
  /** `companycontact.json` reads spent this cycle. */
  companyReads: number;
  /** Reads the pass would have spent but skipped at its deadline (WR-06). */
  companyReadsSkipped: number;
  /** Abandoned `creating` claims released to `failed` / `stale_claim` this cycle. */
  staleClaimsFailed: number;
}

export interface ResolveBookedPassOptions {
  /** The cycle's read client — the same one the sync just fetched with. */
  client: Sm8Client;
  tenantTimezone: string;
  now: Date;
  /**
   * Wall-clock epoch ms past which no company-contact read starts, and which
   * no read's timeout reaches past (WR-06). Absent: no deadline beyond the
   * per-read cap.
   */
  deadlineAt?: number;
  /** The wall clock the deadline is judged on. `Date.now` unless a test fakes it. */
  clock?: () => number;
}

/**
 * ONE lead, ONE transaction: record the job the match found and close the lead
 * `booked_by_tradie` on the same handle. Zero rows from the guarded linkage
 * write means the lead left `open`/`none` under us — the operator claimed it,
 * or it closed — and is an answer (`skipped`), not an error.
 */
export async function resolveLeadBookedByTradie(
  tenantId: string,
  leadId: string,
  jobUuid: string,
  now: Date,
): Promise<ResolveBookedResult> {
  return forTenant(tenantId).transaction(async (tx) => {
    const linked = await tx.leads.setMatchedJob(leadId, jobUuid, now);
    if (linked.length === 0) return { kind: 'skipped' } as const;

    await closeLeadInTx(tx, leadId, 'booked_by_tradie', now);
    return { kind: 'resolved' } as const;
  });
}

/** Mirrored contacts → per-job lists in the pure module's shape. */
function groupContacts(rows: readonly JobContactMobile[]): Map<string, MatchContact[]> {
  const byJob = new Map<string, MatchContact[]>();
  for (const row of rows) {
    const list = byJob.get(row.sm8JobUuid) ?? [];
    list.push({ mobile: row.mobile, phone: row.phone, sm8Active: row.sm8Active });
    byJob.set(row.sm8JobUuid, list);
  }
  return byJob;
}

/**
 * One client record's active contacts, or `null` when the read failed or a row
 * would not parse — either way this job is skipped this cycle, never guessed.
 */
async function readCompanyContacts(
  client: Sm8Client,
  companyUuid: string,
  timeoutMs: number,
): Promise<MatchContact[] | null> {
  const page = await client.get('companycontact.json', {
    filter: `company_uuid eq '${companyUuid}' and active eq 1`,
    timeoutMs,
  });
  if (!page.ok) return null;

  const contacts: MatchContact[] = [];
  for (const row of page.data.rows) {
    const parsed = sm8CompanyContact.safeParse(row);
    if (!parsed.success) return null;
    contacts.push({
      mobile: parsed.data.mobile ?? null,
      phone: parsed.data.phone ?? null,
      sm8Active: parsed.data.active,
    });
  }
  return contacts;
}

/**
 * THE PASS: every open, untouched lead of this tenant matched against the jobs
 * ServiceM8 shows for it in the fourteen days after the call, and every match
 * closed `booked_by_tradie`. See the header for where it runs and what it may
 * spend.
 */
export async function resolveLeadsBookedByTradie(
  tenantId: string,
  options: ResolveBookedPassOptions,
): Promise<ResolveBookedPassResult> {
  const { client, tenantTimezone, now, deadlineAt, clock = Date.now } = options;
  const repo = forTenant(tenantId);

  const staleClaimsFailed = (await repo.leads.failStaleJobClaims(staleJobClaimCutoff(now), now)).length;
  if (staleClaimsFailed > 0) {
    console.log(`[leads] tenant ${tenantId}: ${staleClaimsFailed} abandoned job claim(s) released as stale_claim.`);
  }

  const open = await repo.leads.listOpenForJobMatch();
  // THE COMMON CASE, AND IT COSTS NOTHING MORE: no open lead, no read.
  if (open.length === 0) return { resolved: 0, companyReads: 0, companyReadsSkipped: 0, staleClaimsFailed };

  // The query only returns `none`; the pure module re-checks it regardless.
  const leads: MatchLead[] = open.map((l) => ({ ...l, sm8JobState: 'none' }));
  const windows = new Map(leads.map((l) => [l.id, matchWindowFor(l.firstMissedAt, tenantTimezone)]));

  let fromYmd = '9999-12-31';
  let toYmd = '0000-01-01';
  for (const w of windows.values()) {
    if (w.fromYmd < fromYmd) fromYmd = w.fromYmd;
    if (w.toYmd > toYmd) toYmd = w.toYmd;
  }

  // Active jobs only, by construction of the read — an inactive or deleted
  // job (the spike's three inert rows among them) can never be a candidate.
  const jobs = await repo.quotes.listActiveByDateRange(fromYmd, toYmd);
  if (jobs.length === 0) return { resolved: 0, companyReads: 0, companyReadsSkipped: 0, staleClaimsFailed };

  const contactsByJob = groupContacts(await repo.quoteContacts.forJobs(jobs.map((j) => j.sm8JobUuid)));
  const { matches, needsCompanyRead } = resolveLeadJobMatches(
    leads,
    jobs.map((j) => ({ ...j, sm8Active: true })),
    contactsByJob,
    tenantTimezone,
  );

  const all: LeadJobMatch[] = [...matches];
  const matched = new Set(matches.map((m) => m.leadId));
  const dateByJob = new Map(jobs.map((j) => [j.sm8JobUuid, j.dateRaw]));

  let companyReads = 0;
  let skippedReads = 0;
  for (const request of needsCompanyRead) {
    if (companyReads + skippedReads >= LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE) break;

    const dateRaw = dateByJob.get(request.jobUuid) ?? null;
    const waiting = leads.filter(
      (l) => !matched.has(l.id) && jobInWindow(dateRaw, windows.get(l.id)!),
    );
    // An earlier read this cycle may already have answered every lead this
    // job could — then this read is not spent.
    if (waiting.length === 0) continue;
    if (!UUID_PATTERN.test(request.companyUuid)) continue;

    // WR-06: no read starts at or past the deadline, and none may wait past it.
    const remainingMs = deadlineAt === undefined ? Infinity : deadlineAt - clock();
    if (remainingMs <= 0) {
      skippedReads += 1;
      continue;
    }

    companyReads += 1;
    const contacts = await readCompanyContacts(
      client,
      request.companyUuid,
      Math.min(LEAD_JOB_MATCH_READ_TIMEOUT_MS, remainingMs),
    );
    if (contacts === null) continue;

    for (const lead of waiting) {
      if (contactsMatchMobile(lead.contactMobile, contacts)) {
        all.push({ leadId: lead.id, jobUuid: request.jobUuid });
        matched.add(lead.id);
      }
    }
  }

  let resolved = 0;
  for (const { leadId, jobUuid } of all) {
    const result = await resolveLeadBookedByTradie(tenantId, leadId, jobUuid, now);
    if (result.kind === 'resolved') resolved += 1;
  }

  if (resolved > 0) {
    console.log(
      `[leads] tenant ${tenantId}: ${resolved} lead(s) resolved booked_by_tradie, ` +
        `${companyReads} company-contact reads.`,
    );
  }
  if (skippedReads > 0) {
    const skipKind = 'tick_deadline';
    console.warn(
      `[leads] tenant ${tenantId}: ${skippedReads} company-contact read(s) skipped, ` +
        `kind ${skipKind}; their leads wait for the next cycle.`,
    );
  }

  return { resolved, companyReads, companyReadsSkipped: skippedReads, staleClaimsFailed };
}
