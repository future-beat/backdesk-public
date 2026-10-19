/**
 * Phase 14 (LEAD-04, D-07; T-14-15): the tradie-booked match, as pure
 * functions — the window in the client's zone, the mobile comparison, the
 * lead-to-job resolution — and the stale-claim boundary the same post-commit
 * pass applies (14-03 deviation B).
 *
 * ── THE BOUNDARIES ARE THE PRODUCT ──────────────────────────────────────────
 *
 * A wrong-window match closes a live enquiry as "booked" — the caller never
 * hears back and the tradie never knew. So the window is pinned on both sides
 * of both edges (D−1 out, D in, D+14 in, D+15 out), on CALENDAR dates in the
 * client's zone, never on instants: a 07:30 Perth call is 9 October in UTC and
 * 10 October where the tradie lives.
 *
 * PURE. No database, no ServiceM8, no clock. Every number is from ACMA's
 * fiction block (0491 570 6xx).
 */
import { describe, expect, it } from 'vitest';

import { LEAD_JOB_CLAIM_STALE_MINUTES, LEAD_JOB_MATCH_WINDOW_DAYS } from '../src/core/leads/constants';
import {
  contactsMatchMobile,
  isStaleJobClaim,
  matchWindowFor,
  resolveLeadJobMatches,
  staleJobClaimCutoff,
  type MatchContact,
  type MatchJob,
  type MatchLead,
} from '../src/core/leads/job-match';

const PERTH = 'Australia/Perth';
const MINUTE_MS = 60_000;

/** 07:30 Perth on Saturday 10 October 2026 — 9 October in UTC. */
const CALLED_AT = new Date('2026-10-09T23:30:00.000Z');
const LEAD_MOBILE = '+61491570621';
const OTHER_MOBILE = '+61491570622';

const contact = (overrides: Partial<MatchContact> = {}): MatchContact => ({
  mobile: null,
  phone: null,
  sm8Active: true,
  ...overrides,
});

const lead = (overrides: Partial<MatchLead> = {}): MatchLead => ({
  id: 'lead-1',
  contactMobile: LEAD_MOBILE,
  firstMissedAt: CALLED_AT,
  sm8JobState: 'none',
  ...overrides,
});

let jobSeq = 0;
const job = (date: string | null, overrides: Partial<MatchJob> = {}): MatchJob => {
  jobSeq += 1;
  return {
    sm8JobUuid: `00000000-0000-4000-8000-${String(jobSeq).padStart(12, '0')}`,
    companyUuid: '11111111-1111-4111-8111-111111111111',
    dateRaw: date === null ? null : `${date} 00:00:00`,
    status: 'Quote',
    sm8Active: true,
    ...overrides,
  };
};

const withContacts = (
  entries: Array<[MatchJob, MatchContact[]]>,
): ReadonlyMap<string, readonly MatchContact[]> =>
  new Map(entries.map(([j, cs]) => [j.sm8JobUuid, cs]));

describe('matchWindowFor — calendar dates in the client zone, both ends inclusive', () => {
  it('the window constant is fourteen days', () => {
    expect(LEAD_JOB_MATCH_WINDOW_DAYS).toBe(14);
  });

  it('a 07:30 Perth call (9 Oct UTC) opens on the PERTH date and closes D+14', () => {
    expect(matchWindowFor(CALLED_AT, PERTH)).toEqual({ fromYmd: '2026-10-10', toYmd: '2026-10-24' });
  });

  it('the same instant in UTC is a day earlier — the zone is what decides', () => {
    expect(matchWindowFor(CALLED_AT, 'UTC')).toEqual({ fromYmd: '2026-10-09', toYmd: '2026-10-23' });
  });

  it('adds days to the calendar date, so a DST change cannot move the far edge', () => {
    // Sydney leaves AEST for AEDT on Sunday 4 October 2026, inside this window.
    const sydneyCall = new Date('2026-09-30T14:30:00.000Z'); // 00:30 on 1 Oct, AEST
    expect(matchWindowFor(sydneyCall, 'Australia/Sydney')).toEqual({
      fromYmd: '2026-10-01',
      toYmd: '2026-10-15',
    });
  });

  it('crosses a month end', () => {
    const lateCall = new Date('2026-10-25T02:00:00.000Z');
    expect(matchWindowFor(lateCall, PERTH)).toEqual({ fromYmd: '2026-10-25', toYmd: '2026-11-08' });
  });
});

describe('contactsMatchMobile — normalised in TypeScript, active contacts only', () => {
  it.each([
    ['0491 570 621'],
    ['0491570621'],
    ['+61491570621'],
    ['61491570621'],
    ['(0491) 570-621'],
  ])('the mobile spelled %s matches the lead', (spelling) => {
    expect(contactsMatchMobile(LEAD_MOBILE, [contact({ mobile: spelling })])).toBe(true);
  });

  it('a mobile kept in the phone field, with mobile null, matches', () => {
    expect(contactsMatchMobile(LEAD_MOBILE, [contact({ phone: '0491 570 621' })])).toBe(true);
  });

  it('a landline in mobile does not hide the mobile kept in phone', () => {
    expect(
      contactsMatchMobile(LEAD_MOBILE, [contact({ mobile: '(08) 9000 0000', phone: '0491570621' })]),
    ).toBe(true);
  });

  it('an INACTIVE contact never matches', () => {
    expect(
      contactsMatchMobile(LEAD_MOBILE, [contact({ mobile: '0491 570 621', sm8Active: false })]),
    ).toBe(false);
  });

  it('a different number does not match', () => {
    expect(contactsMatchMobile(LEAD_MOBILE, [contact({ mobile: '0491 570 622' })])).toBe(false);
  });

  it('a landline in phone does not match', () => {
    expect(contactsMatchMobile(LEAD_MOBILE, [contact({ phone: '(08) 9491 5706' })])).toBe(false);
  });

  it('no contacts is no match', () => {
    expect(contactsMatchMobile(LEAD_MOBILE, [])).toBe(false);
  });

  it('one matching contact among others is enough', () => {
    expect(
      contactsMatchMobile(LEAD_MOBILE, [
        contact({ mobile: '0491 570 622' }),
        contact({ mobile: '0491 570 621' }),
      ]),
    ).toBe(true);
  });
});

describe('resolveLeadJobMatches — the window edges', () => {
  const resolveOne = (date: string) => {
    const j = job(date);
    return resolveLeadJobMatches(
      [lead()],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 621' })]]]),
      PERTH,
    );
  };

  it('a job dated D (the Perth date of the call) matches', () => {
    expect(resolveOne('2026-10-10').matches).toHaveLength(1);
  });

  it('a job dated D+14 matches (at-the-boundary-is-inside)', () => {
    expect(resolveOne('2026-10-24').matches).toHaveLength(1);
  });

  it('a job dated D+15 does not', () => {
    expect(resolveOne('2026-10-25').matches).toEqual([]);
  });

  it('a job dated D−1 does not — the UTC date of the call is NOT the call date', () => {
    expect(resolveOne('2026-10-09').matches).toEqual([]);
  });

  it('a job with no date never matches', () => {
    const j = job(null);
    const result = resolveLeadJobMatches(
      [lead()],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 621' })]]]),
      PERTH,
    );
    expect(result).toEqual({ matches: [], needsCompanyRead: [] });
  });
});

describe('resolveLeadJobMatches — who may match, and how often', () => {
  it('returns the lead and the job it matched', () => {
    const j = job('2026-10-13');
    const result = resolveLeadJobMatches(
      [lead()],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 621' })]]]),
      PERTH,
    );
    expect(result).toEqual({ matches: [{ leadId: 'lead-1', jobUuid: j.sm8JobUuid }], needsCompanyRead: [] });
  });

  it('an INACTIVE job never matches', () => {
    const j = job('2026-10-13', { sm8Active: false });
    const result = resolveLeadJobMatches(
      [lead()],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 621' })]]]),
      PERTH,
    );
    expect(result).toEqual({ matches: [], needsCompanyRead: [] });
  });

  it.each(['creating', 'created', 'failed'])('a lead in sm8_job_state %s is skipped — it is the operator’s', (state) => {
    const j = job('2026-10-13');
    const result = resolveLeadJobMatches(
      [lead({ sm8JobState: state })],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 621' })]]]),
      PERTH,
    );
    expect(result).toEqual({ matches: [], needsCompanyRead: [] });
  });

  it('a lead matches at most ONE job: the oldest date, then the lowest uuid', () => {
    const later = job('2026-10-15', { sm8JobUuid: '00000000-0000-4000-8000-0000000000a1' });
    const tieHigh = job('2026-10-12', { sm8JobUuid: '00000000-0000-4000-8000-0000000000b2' });
    const tieLow = job('2026-10-12', { sm8JobUuid: '00000000-0000-4000-8000-0000000000b1' });
    const mobile = [contact({ mobile: '0491 570 621' })];
    const result = resolveLeadJobMatches(
      [lead()],
      // Input order deliberately NOT the answer's order.
      [later, tieHigh, tieLow],
      withContacts([
        [later, mobile],
        [tieHigh, mobile],
        [tieLow, mobile],
      ]),
      PERTH,
    );
    expect(result.matches).toEqual([{ leadId: 'lead-1', jobUuid: tieLow.sm8JobUuid }]);
  });

  it('two leads whose two mobiles are both on one job both match it', () => {
    const j = job('2026-10-13');
    const result = resolveLeadJobMatches(
      [lead({ id: 'lead-a' }), lead({ id: 'lead-b', contactMobile: OTHER_MOBILE })],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 621' }), contact({ mobile: '0491570622' })]]]),
      PERTH,
    );
    expect(result.matches).toEqual([
      { leadId: 'lead-a', jobUuid: j.sm8JobUuid },
      { leadId: 'lead-b', jobUuid: j.sm8JobUuid },
    ]);
  });

  it('each lead is judged against its OWN window', () => {
    const j = job('2026-10-30');
    const earlyLead = lead({ id: 'early' }); // window 10–24 Oct
    const lateLead = lead({
      id: 'late',
      contactMobile: OTHER_MOBILE,
      firstMissedAt: new Date('2026-10-20T02:00:00.000Z'), // window 20 Oct – 3 Nov
    });
    const result = resolveLeadJobMatches(
      [earlyLead, lateLead],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 621' }), contact({ mobile: '0491 570 622' })]]]),
      PERTH,
    );
    expect(result.matches).toEqual([{ leadId: 'late', jobUuid: j.sm8JobUuid }]);
  });

  it('a job whose contacts are someone else matches nothing and needs no company read', () => {
    const j = job('2026-10-13');
    const result = resolveLeadJobMatches(
      [lead()],
      [j],
      withContacts([[j, [contact({ mobile: '0491 570 699' })]]]),
      PERTH,
    );
    expect(result).toEqual({ matches: [], needsCompanyRead: [] });
  });
});

describe('resolveLeadJobMatches — the company-contact tier is asked for, never performed', () => {
  it('a job with NO contacts inside an unmatched lead’s window needs its company read', () => {
    const j = job('2026-10-13', { companyUuid: '22222222-2222-4222-8222-222222222222' });
    const result = resolveLeadJobMatches([lead()], [j], withContacts([]), PERTH);
    expect(result).toEqual({
      matches: [],
      needsCompanyRead: [{ jobUuid: j.sm8JobUuid, companyUuid: '22222222-2222-4222-8222-222222222222' }],
    });
  });

  it('an empty contact list counts as no contacts', () => {
    const j = job('2026-10-13');
    const result = resolveLeadJobMatches([lead()], [j], withContacts([[j, []]]), PERTH);
    expect(result.needsCompanyRead).toHaveLength(1);
  });

  it('a contactless job OUTSIDE every open lead’s window is not read', () => {
    const j = job('2026-10-25');
    const result = resolveLeadJobMatches([lead()], [j], withContacts([]), PERTH);
    expect(result).toEqual({ matches: [], needsCompanyRead: [] });
  });

  it('a contactless job with no company cannot be read and is not asked for', () => {
    const j = job('2026-10-13', { companyUuid: null });
    const result = resolveLeadJobMatches([lead()], [j], withContacts([]), PERTH);
    expect(result.needsCompanyRead).toEqual([]);
  });

  it('a contactless job is not read when every lead in whose window it falls already matched', () => {
    const matched = job('2026-10-12');
    const contactless = job('2026-10-14');
    const result = resolveLeadJobMatches(
      [lead()],
      [matched, contactless],
      withContacts([[matched, [contact({ mobile: '0491 570 621' })]]]),
      PERTH,
    );
    expect(result.matches).toEqual([{ leadId: 'lead-1', jobUuid: matched.sm8JobUuid }]);
    expect(result.needsCompanyRead).toEqual([]);
  });

  it('a contactless job is asked for once, however many leads it could answer', () => {
    const j = job('2026-10-13');
    const result = resolveLeadJobMatches(
      [lead({ id: 'a' }), lead({ id: 'b', contactMobile: OTHER_MOBILE })],
      [j],
      withContacts([]),
      PERTH,
    );
    expect(result.needsCompanyRead).toHaveLength(1);
  });

  it('only leads still at none are counted when deciding whether to read', () => {
    const j = job('2026-10-13');
    const result = resolveLeadJobMatches([lead({ sm8JobState: 'creating' })], [j], withContacts([]), PERTH);
    expect(result.needsCompanyRead).toEqual([]);
  });
});

describe('the stale claim boundary (14-03 deviation B) — longer than the constant is stale', () => {
  const NOW = new Date('2026-10-10T01:00:00.000Z');

  it('the constant is fifteen minutes', () => {
    expect(LEAD_JOB_CLAIM_STALE_MINUTES).toBe(15);
  });

  it('the cutoff is now minus the constant', () => {
    expect(staleJobClaimCutoff(NOW).toISOString()).toBe('2026-10-10T00:45:00.000Z');
  });

  it('a claim exactly fifteen minutes old is NOT stale (the boundary is the live side)', () => {
    expect(isStaleJobClaim(new Date(NOW.getTime() - 15 * MINUTE_MS), NOW)).toBe(false);
  });

  it('a claim one millisecond older is stale', () => {
    expect(isStaleJobClaim(new Date(NOW.getTime() - 15 * MINUTE_MS - 1), NOW)).toBe(true);
  });

  it('a claim fourteen minutes fifty-nine seconds old is not stale', () => {
    expect(isStaleJobClaim(new Date(NOW.getTime() - 14 * MINUTE_MS - 59_000), NOW)).toBe(false);
  });

  it('a claim with no attempt time is never stale by this rule', () => {
    expect(isStaleJobClaim(null, NOW)).toBe(false);
  });
});
