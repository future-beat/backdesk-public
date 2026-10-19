/**
 * The tradie-booked match (Phase 14, LEAD-04, D-07): which open lead was
 * booked by the tradie himself, decided as pure functions over rows the sync
 * already mirrors.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * An OPEN lead still at `sm8_job_state = 'none'` was booked by the tradie when
 * its caller's mobile appears on an ACTIVE ServiceM8 job dated inside
 * `[call date, call date + LEAD_JOB_MATCH_WINDOW_DAYS]`. Any status: a job
 * already won is the strongest proof of a booking.
 *
 *  - THE CALL DATE is the calendar date of `first_missed_at` in the CLIENT'S
 *    zone — a 07:30 Perth call is 9 October in UTC and 10 October where the
 *    tradie lives. The far edge is that calendar date plus fourteen DAYS, added
 *    to the date and never to the instant, so a DST change inside the window
 *    cannot move it by an hour across midnight.
 *  - BOTH ENDS ARE INSIDE (at-the-boundary-is-inside, the house rule of
 *    `qualify.ts`): a job dated exactly D+14 matches, D+15 does not.
 *  - THE JOB'S DATE is the first ten characters of its mirrored `date_raw`
 *    (`"2026-10-10 00:00:00"`), which ServiceM8 sets at creation to a date-only
 *    stamp. Whose zone that date is in is UNMEASURED (research A1); taken as
 *    the account's local date. At date granularity an hour's skew matters only
 *    near midnight, and its error direction is one more lead resolved
 *    `booked_by_tradie` — counted in leads-to-jobs, never attributed dollars.
 *
 * ── THE TWO TIERS ───────────────────────────────────────────────────────────
 *
 *  (i)  The job's mirrored JOB CONTACTS (`quote_contacts`), free — the sync has
 *       them already. A contact matches when it is active and its `mobile`, or
 *       failing that its `phone`, normalises (`normalizeAuMobile`, never SQL
 *       string munging) to the lead's number.
 *  (ii) A candidate job with NO mirrored contact at all — a job the tradie
 *       raised straight from a client record — keeps its people on the
 *       client's COMPANY contacts, which only a ServiceM8 read can see. This
 *       module never reads: it returns those jobs as `needsCompanyRead`, and
 *       only when the job falls inside the window of a lead tier (i) left
 *       unmatched, so a tenant whose leads all matched spends nothing. The
 *       caller performs the capped reads and applies `contactsMatchMobile`.
 *
 * ONE JOB PER LEAD: the first candidate by `date_raw`, then by uuid — the
 * earliest booking the tradie made for that caller. A job is not consumed by a
 * match: two callers on one job both resolve to it (the partial unique on the
 * linkage is scoped to `created`, our own creates). Tier (ii) is consulted only
 * for leads tier (i) did not match, so a lead with a contactless job AND a
 * later job carrying its contact resolves to the later one — the same booking
 * either way, and the cheaper answer.
 *
 * ── THE STALE CLAIM (plan 14-03, deviation B) ───────────────────────────────
 *
 * The same post-commit pass moves a lead stuck in `creating` for longer than
 * `LEAD_JOB_CLAIM_STALE_MINUTES` to `failed` / `stale_claim`. The boundary is
 * pure here and the repository's guarded UPDATE uses the same cutoff: strictly
 * older than the cutoff is stale, exactly at it is still live.
 *
 * PURE. No repository, no ServiceM8 client, no clock, no log.
 */
import { TZDate } from '@date-fns/tz';

import { normalizeAuMobile } from '@/core/cadence/primary-contact';

import { LEAD_JOB_CLAIM_STALE_MINUTES, LEAD_JOB_MATCH_WINDOW_DAYS } from './constants';

const MINUTE_MS = 60_000;

/** The calendar window a lead's booking must fall in, as `YYYY-MM-DD` strings. */
export interface MatchWindow {
  fromYmd: string;
  toYmd: string;
}

/** A contact's numbers, mirrored (tier i) or read from the client record (tier ii). */
export interface MatchContact {
  mobile: string | null;
  phone: string | null;
  sm8Active: boolean;
}

/** An open lead the match may resolve. `contactMobile` is never printed. */
export interface MatchLead {
  id: string;
  contactMobile: string;
  firstMissedAt: Date;
  sm8JobState: string;
}

/** A mirrored job. */
export interface MatchJob {
  sm8JobUuid: string;
  companyUuid: string | null;
  dateRaw: string | null;
  status: string;
  sm8Active: boolean;
}

export interface LeadJobMatch {
  leadId: string;
  jobUuid: string;
}

/** A contactless candidate whose client record the caller may read (tier ii). */
export interface CompanyReadRequest {
  jobUuid: string;
  companyUuid: string;
}

export interface LeadJobMatchResult {
  matches: LeadJobMatch[];
  needsCompanyRead: CompanyReadRequest[];
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * The lead's window: the call's calendar date in `timezone`, through that date
 * plus `LEAD_JOB_MATCH_WINDOW_DAYS`, both inclusive. See the header.
 */
export function matchWindowFor(firstMissedAt: Date, timezone: string): MatchWindow {
  const local = new TZDate(firstMissedAt.getTime(), timezone);
  const year = local.getFullYear();
  const month = local.getMonth();
  const day = local.getDate();

  // Calendar arithmetic on a zone-free date: UTC has no DST, so +14 is 14 days.
  const end = new Date(Date.UTC(year, month, day + LEAD_JOB_MATCH_WINDOW_DAYS));

  return {
    fromYmd: `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}`,
    toYmd: `${pad(end.getUTCFullYear(), 4)}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
  };
}

/** Whether a job's mirrored date falls inside a window. A job with no date never does. */
export function jobInWindow(dateRaw: string | null, window: MatchWindow): boolean {
  if (dateRaw === null || dateRaw.length < 10) return false;
  const ymd = dateRaw.slice(0, 10);
  return ymd >= window.fromYmd && ymd <= window.toYmd;
}

/**
 * Whether any ACTIVE contact carries the lead's mobile — its `mobile`, or its
 * `phone` when `mobile` does not normalise to a mobile.
 */
export function contactsMatchMobile(
  leadMobileE164: string,
  contacts: readonly MatchContact[],
): boolean {
  const target = normalizeAuMobile(leadMobileE164);
  if (target === null) return false;

  return contacts.some(
    (c) => c.sm8Active && (normalizeAuMobile(c.mobile) ?? normalizeAuMobile(c.phone)) === target,
  );
}

const byDateThenUuid = (a: MatchJob, b: MatchJob): number => {
  const ad = a.dateRaw ?? '';
  const bd = b.dateRaw ?? '';
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.sm8JobUuid === b.sm8JobUuid) return 0;
  return a.sm8JobUuid < b.sm8JobUuid ? -1 : 1;
};

/**
 * Tier (i) for every lead at `none`, and the tier (ii) reads the caller should
 * make for the leads tier (i) left unmatched. See the header for the rule.
 */
export function resolveLeadJobMatches(
  leads: readonly MatchLead[],
  jobs: readonly MatchJob[],
  contactsByJob: ReadonlyMap<string, readonly MatchContact[]>,
  timezone: string,
): LeadJobMatchResult {
  const ordered = jobs.filter((j) => j.sm8Active).sort(byDateThenUuid);
  const candidates = leads.filter((l) => l.sm8JobState === 'none');

  const matches: LeadJobMatch[] = [];
  const unmatchedWindows: MatchWindow[] = [];

  for (const lead of candidates) {
    const window = matchWindowFor(lead.firstMissedAt, timezone);
    const hit = ordered.find(
      (j) =>
        jobInWindow(j.dateRaw, window) &&
        contactsMatchMobile(lead.contactMobile, contactsByJob.get(j.sm8JobUuid) ?? []),
    );
    if (hit) matches.push({ leadId: lead.id, jobUuid: hit.sm8JobUuid });
    else unmatchedWindows.push(window);
  }

  const needsCompanyRead: CompanyReadRequest[] = [];
  for (const j of ordered) {
    if (j.companyUuid === null) continue;
    if ((contactsByJob.get(j.sm8JobUuid)?.length ?? 0) > 0) continue;
    if (!unmatchedWindows.some((w) => jobInWindow(j.dateRaw, w))) continue;
    needsCompanyRead.push({ jobUuid: j.sm8JobUuid, companyUuid: j.companyUuid });
  }

  return { matches, needsCompanyRead };
}

/** The instant before which a `creating` claim is abandoned (strictly before). */
export function staleJobClaimCutoff(now: Date): Date {
  return new Date(now.getTime() - LEAD_JOB_CLAIM_STALE_MINUTES * MINUTE_MS);
}

/** Whether a claim attempted at `attemptedAt` is stale at `now`. See the header. */
export function isStaleJobClaim(attemptedAt: Date | null, now: Date): boolean {
  if (attemptedAt === null) return false;
  return attemptedAt.getTime() < staleJobClaimCutoff(now).getTime();
}
