/**
 * THE CREATE-JOB SHEET, BUILT ONCE FOR EVERY PAGE THAT MOUNTS IT (Phase 15,
 * D-01; lifted from `inbox/page.tsx`'s `readLeadJobs`, Phase 14 D-01 / D-09).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A SERVER MODULE. It imports the repository barrel and reads each        │
 * │ caller's mobile and words. NEVER imported by a `'use client'` file —    │
 * │ the islands take the sheet as plain props (`tests/leads-page.test.ts`).  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY ONE FUNCTION BUILDS THE SHEET FOR BOTH PAGES ────────────────────────
 *
 * The inbox and the lead queue both mount `CreateJobForm` for an open lead.
 * The form's preview is never trusted: the action rebuilds the description
 * from the facts it re-reads and refuses with `thread_changed` when the
 * server-computed digest no longer matches (14-REVIEW WR-04). Two builders
 * would be two places for the preview's lines, the digest's inputs or the
 * render rule to drift — and a sheet that disagrees with the action is a
 * button that always refuses. So the loop lives here, verbatim.
 *
 * ── TENANT-SCOPED PER TENANT, AND IT THROWS ─────────────────────────────────
 *
 * Every read goes through `forTenant(tenantId)`: the cross-tenant list each
 * page made first returns ids only. A failure THROWS — each caller keeps its
 * own `try` and its own fixed log string, because what a failure hides is the
 * caller's decision (the inbox hides the create control and still renders; the
 * lead queue renders its error arm). The facts carry the caller's words and
 * mobile; they go into the form's props and nowhere else (never a log).
 */
import { previewLinesFor } from '@/core/leads/job-description';
import { previewSha256For } from '@/core/leads/job-provision';
import { toLocalSpacedMobile } from '@/core/leads/mobile-spellings';
import { forTenant, type LeadJobLinkage } from '@/db/repository';

import { CREATE_JOB_SENTENCES } from '../inbox/action-state';

/**
 * What happened to a lead, in fixed words (Phase 14, D-09). A map, not an
 * underscore-to-space string replace: a fourth resolution must fail loudly
 * here, not ship as snake_case. Only the three Phase 14 reasons get a chip;
 * the lead's other closes are not news on a row. Exported for the inbox, the
 * lead queue and the client page's missed-call log (plan 15-05).
 */
export const LEAD_RESOLUTION_LABELS: Record<string, string> = {
  job_created: 'job created',
  booked_by_tradie: 'booked by tradie',
  closed_by_tradie: 'closed by tradie',
};

/**
 * The creation state, when it is one the operator must notice (D-04). A map,
 * not a replace. `none` and `created` say nothing: the first is the button,
 * the second is the job chip.
 */
export const LEAD_JOB_STATE_LABELS: Record<string, string> = {
  creating: 'creating job…',
  failed: 'job failed',
};

/** `job 01a1c0de · Quote #42` — the linked job, short, with the mirror's word for it. */
export function jobChip(link: LeadJobLinkage): string | null {
  if (link.sm8JobUuid === null) return null;
  const number = link.jobGeneratedId === null ? '' : ` #${link.jobGeneratedId}`;
  return `job ${link.sm8JobUuid.slice(0, 8)} · ${link.jobStatus ?? 'not mirrored'}${number}`;
}

/** One chip: its words, and the class that reinforces them (text first). */
export type LeadJobChip = { text: string; className: string };

/**
 * The lead's job / resolution / creation-state chips, in the inbox's order
 * and colours: a linked job is `badge--ok`, a failed creation `badge--warn`
 * (the one that waits on a human), the rest neutral.
 */
export function leadJobChips(link: LeadJobLinkage | undefined): LeadJobChip[] {
  if (link === undefined) return [];
  const chips: LeadJobChip[] = [];
  const job = jobChip(link);
  if (job !== null) chips.push({ text: job, className: 'badge badge--ok' });
  const resolution =
    link.closedReason == null ? undefined : LEAD_RESOLUTION_LABELS[link.closedReason];
  if (resolution !== undefined) chips.push({ text: resolution, className: 'badge' });
  const state = LEAD_JOB_STATE_LABELS[link.sm8JobState];
  if (state !== undefined) {
    chips.push({
      text: state,
      className: link.sm8JobState === 'failed' ? 'badge badge--warn' : 'badge',
    });
  }
  return chips;
}

/** The confirm sheet's props for one open, creatable lead (Phase 14, D-01). */
export type CreateJobSheet = {
  replies: string[];
  urgencyLine: string | null;
  noteLine: string;
  latestInboundId: string;
  previewSha256: string;
  mobileLocal: string;
  companyName: string;
  contactFirst: string | null;
  contactLast: string | null;
  jobState: 'none' | 'failed';
  errorSentence: string | null;
  attemptCount: number;
};

/**
 * The job linkage of every lead given, and the confirm sheet for each OPEN
 * lead still at `none` or `failed` with at least one reply — the render rule
 * both pages apply by mounting the form only when a sheet exists.
 */
export async function readLeadJobSheets(
  leadIdsByTenant: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<{
  linkage: ReadonlyMap<string, LeadJobLinkage>;
  sheets: ReadonlyMap<string, CreateJobSheet>;
}> {
  const linkage = new Map<string, LeadJobLinkage>();
  const sheets = new Map<string, CreateJobSheet>();

  for (const [tenantId, leadIds] of leadIdsByTenant) {
    const repo = forTenant(tenantId);
    const linked = await repo.leads.jobLinkageFor([...leadIds]);
    let timezone: string | null = null;

    for (const lead of linked) {
      linkage.set(lead.leadId, lead);
      if (lead.status !== 'open') continue;
      if (lead.sm8JobState !== 'none' && lead.sm8JobState !== 'failed') continue;

      const facts = await repo.leads.jobSheetFacts(lead.leadId);
      const newest = facts?.replies.at(-1);
      if (!facts || newest === undefined) continue;

      if (timezone === null) {
        const [tenant] = await repo.tenant.get();
        timezone = tenant?.timezone ?? 'Australia/Perth';
      }

      const previewFacts = {
        replies: facts.replies,
        firstMissedAt: facts.firstMissedAt,
        timezone,
      };
      const lines = previewLinesFor(previewFacts);
      const [first, ...rest] = (facts.contactName ?? '').trim().split(/\s+/);
      sheets.set(lead.leadId, {
        ...lines,
        latestInboundId: newest.id,
        // WR-04: the action recomputes this from the facts it re-reads.
        previewSha256: previewSha256For(previewFacts),
        mobileLocal: toLocalSpacedMobile(facts.contactMobile),
        companyName: facts.contactName?.trim() ?? '',
        contactFirst: first === '' ? null : first,
        contactLast: rest.length === 0 ? null : rest.join(' '),
        jobState: lead.sm8JobState,
        errorSentence:
          lead.sm8JobErrorKind === null
            ? null
            : (CREATE_JOB_SENTENCES[`failed:${lead.sm8JobErrorKind}`] ?? null),
        attemptCount: lead.sm8JobAttemptCount,
      });
    }
  }

  return { linkage, sheets };
}
