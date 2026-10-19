/**
 * THE D-18 ORDERING, PROVEN WITHOUT A BROWSER (CON-02).
 *
 * The client page's grouping IS the pipeline view: an operator opening a client
 * between two jobs gets one screenful, and what lands in it decides which quote
 * they act on. That ordering is the kind of thing that is checked once by
 * eye, drifts on the third edit, and is never noticed again — so it is data and
 * a pure function here, and the assertions below are the check.
 *
 * The discriminating cases, and what each one is guarding:
 *
 *  - PAUSED BEATS ACTIVE. A paused cadence is a sequence that has stopped
 *    moving and is waiting on a person; ranking it by its `active` siblings'
 *    rule would file it under "we are on it".
 *  - A STALLED TOUCH PULLS ITS QUOTE FORWARD, through the SHARED predicate. Two
 *    thresholds is the defect `stall-policy.ts` exists to prevent, and a second
 *    one written here would show a red badge on the queue beside a quote this
 *    page filed under `Chasing`.
 *  - EVERY CLOSED VOCABULARY MEMBER LANDS IN `Closed`. A status that fell
 *    through to `Waiting` would put a job won in June in the group the operator
 *    scans for work.
 *
 * PURE. No database, no environment, no clock — every `now` is a literal.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  formatRelative,
  groupRank,
  lastActivity,
  mergeConversation,
  nextTouchForQuote,
  NEXT_TOUCH_STATE_LABELS,
  NEXT_TOUCH_STATES,
  OPEN_QUOTE_STATUS,
  PIPELINE_GROUP_HEADINGS,
  PIPELINE_GROUPS,
  weeklyTouchCount,
  weekHorizon,
  WEEK_HORIZON_DAYS,
  type CadenceSnapshot,
  type QuoteSnapshot,
  type ReplyEvidence,
  type SentEvidence,
  type TouchSnapshot,
} from '@/core/pipeline/grouping';
import { STALL_THRESHOLD_HOURS } from '@/core/aging/stall-policy';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;

const slot = (hours: number): Date => new Date(NOW.getTime() + hours * HOUR);

const touch = (status: string, hours: number, touchNumber = 1): TouchSnapshot => ({
  touchNumber,
  status,
  scheduledAt: slot(hours),
});

const cadence = (
  status: string,
  reasons: { pauseReason?: string | null; stopReason?: string | null } = {},
): CadenceSnapshot => ({
  status,
  pauseReason: reasons.pauseReason ?? null,
  stopReason: reasons.stopReason ?? null,
});

/** An open, triaged quote — the boring baseline every case varies from. */
const quote = (overrides: Partial<QuoteSnapshot> = {}): QuoteSnapshot => ({
  quoteStatus: OPEN_QUOTE_STATUS,
  chaseEligibility: 'eligible',
  cadence: null,
  touches: [],
  ...overrides,
});

/* ------------------------------------------------------------------------- *
 * The order itself
 * ------------------------------------------------------------------------- */

describe('PIPELINE_GROUPS — the order is data', () => {
  it('is the D-18 action order, and the render walks THIS array', () => {
    expect([...PIPELINE_GROUPS]).toEqual(['needs_attention', 'chasing', 'waiting', 'closed']);
  });

  it('carries the 06-UI-SPEC headings verbatim, one per group', () => {
    expect(PIPELINE_GROUP_HEADINGS).toEqual({
      needs_attention: 'Needs attention',
      chasing: 'Chasing',
      waiting: 'Waiting',
      closed: 'Closed',
    });
  });

  it('is what the page renders from, rather than a second list in the JSX', () => {
    const page = readFileSync('src/app/(console)/clients/[id]/page.tsx', 'utf8');
    expect(page).toContain('PIPELINE_GROUPS.map');
    expect(page).toContain('PIPELINE_GROUP_HEADINGS');
    // The headings are never spelled out again beside the map they came from.
    expect(page).not.toMatch(/<h3>Chasing<\/h3>/);
  });
});

/* ------------------------------------------------------------------------- *
 * groupRank — the matrix
 * ------------------------------------------------------------------------- */

describe('groupRank — needs attention', () => {
  it('files a PAUSED cadence there whatever the reason, ahead of active', () => {
    for (const reason of ['customer_reply', 'client_paused', 'onboarding']) {
      expect(groupRank(quote({ cadence: cadence('paused', { pauseReason: reason }) }), NOW)).toBe(
        'needs_attention',
      );
    }
  });

  it('files a paused cadence there even with a touch in flight — paused beats active', () => {
    // Far enough out that the stall predicate has no opinion — otherwise this
    // would pass for the wrong reason and prove nothing about the pause.
    const inFlight = [touch('pending_approval', 48)];
    // The SAME touches under an active cadence read as `Chasing`. The cadence
    // status is what moves it, which is the assertion.
    expect(groupRank(quote({ cadence: cadence('active'), touches: inFlight }), NOW)).toBe(
      'chasing',
    );
    expect(groupRank(quote({ cadence: cadence('paused'), touches: inFlight }), NOW)).toBe(
      'needs_attention',
    );
  });

  it('files an open quote still awaiting triage there, with no cadence at all', () => {
    expect(groupRank(quote({ chaseEligibility: 'needs_review' }), NOW)).toBe('needs_attention');
  });

  it('does NOT ask the triage question of a closed quote', () => {
    // `needs review` beside a job won in June reads as an outstanding task and
    // is not one — the existing page rule, kept.
    expect(
      groupRank(quote({ quoteStatus: 'Work Order', chaseEligibility: 'needs_review' }), NOW),
    ).toBe('closed');
  });

  it('pulls an otherwise-chasing quote forward when a touch is STALLED', () => {
    const chasing = quote({
      cadence: cadence('active'),
      touches: [touch('pending_approval', STALL_THRESHOLD_HOURS + 1)],
    });
    expect(groupRank(chasing, NOW)).toBe('chasing');

    const stalled = quote({
      cadence: cadence('active'),
      touches: [touch('pending_approval', STALL_THRESHOLD_HOURS)],
    });
    expect(groupRank(stalled, NOW)).toBe('needs_attention');
  });

  it('uses the SHARED predicate — the boundary moves with STALL_THRESHOLD_HOURS', () => {
    // Not a re-spelling of the number 4: the case is built FROM the exported
    // constant, so a threshold change moves this test with the module rather
    // than breaking it.
    const atBoundary = quote({
      cadence: cadence('active'),
      touches: [touch('needs_draft', STALL_THRESHOLD_HOURS)],
    });
    const justOutside = quote({
      cadence: cadence('active'),
      touches: [touch('needs_draft', STALL_THRESHOLD_HOURS + 0.001)],
    });
    expect(groupRank(atBoundary, NOW)).toBe('needs_attention');
    expect(groupRank(justOutside, NOW)).toBe('chasing');
  });

  it('counts an overdue unapproved touch, not just an imminent one', () => {
    expect(
      groupRank(
        quote({ cadence: cadence('active'), touches: [touch('needs_draft', -72)] }),
        NOW,
      ),
    ).toBe('needs_attention');
  });

  it('does not ask the stall question of a resolved touch, however overdue', () => {
    for (const status of ['sent', 'skipped', 'approved', 'scheduled']) {
      expect(
        groupRank(
          quote({ cadence: cadence('active'), touches: [touch(status, -240)] }),
          NOW,
        ),
      ).not.toBe('needs_attention');
    }
  });
});

describe('groupRank — closed', () => {
  it('files every non-open ServiceM8 status there', () => {
    for (const status of ['Work Order', 'Completed', 'Unsuccessful']) {
      expect(groupRank(quote({ quoteStatus: status }), NOW)).toBe('closed');
    }
  });

  it('files every terminal cadence status there', () => {
    for (const status of ['stopped', 'completed', 'expired']) {
      expect(groupRank(quote({ cadence: cadence(status) }), NOW)).toBe('closed');
    }
  });

  it('names each stop reason as closed, not as a state of its own', () => {
    for (const reason of [
      'won',
      'lost',
      'removed',
      'reopened',
      'contact_suppressed',
      'operator_closed',
      'no_contact',
      'mirror_missing',
    ]) {
      expect(groupRank(quote({ cadence: cadence('stopped', { stopReason: reason }) }), NOW)).toBe(
        'closed',
      );
    }
  });

  it('closes a won quote whose cadence the tick has not stopped yet', () => {
    // The consumer stops it on the next tick and not before. Reading the gap as
    // `Chasing` puts a finished job in the group scanned for work.
    expect(groupRank(quote({ quoteStatus: 'Work Order', cadence: cadence('active') }), NOW)).toBe(
      'closed',
    );
  });

  it('treats an unrecognised upstream status as closed, never as chaseable', () => {
    expect(groupRank(quote({ quoteStatus: 'Something ServiceM8 Added' }), NOW)).toBe('closed');
  });
});

describe('groupRank — chasing and waiting', () => {
  it('is chasing when an active cadence has a promoted touch', () => {
    for (const status of ['needs_draft', 'pending_approval', 'approved']) {
      expect(
        groupRank(
          // Far enough out that the stall predicate has no opinion.
          quote({ cadence: cadence('active'), touches: [touch(status, 48)] }),
          NOW,
        ),
      ).toBe('chasing');
    }
  });

  it('is waiting when an active cadence has only future scheduled touches', () => {
    expect(
      groupRank(
        quote({ cadence: cadence('active'), touches: [touch('scheduled', 48)] }),
        NOW,
      ),
    ).toBe('waiting');
  });

  it('is waiting for an eligible quote whose cadence the tick has not created yet', () => {
    expect(groupRank(quote(), NOW)).toBe('waiting');
  });

  it('is waiting for an exhausted active cadence the completion sweep has not closed', () => {
    expect(
      groupRank(
        quote({ cadence: cadence('active'), touches: [touch('sent', -48), touch('skipped', -24)] }),
        NOW,
      ),
    ).toBe('waiting');
  });
});

/* ------------------------------------------------------------------------- *
 * nextTouchForQuote
 * ------------------------------------------------------------------------- */

describe('nextTouchForQuote', () => {
  it('picks the earliest touch that has not resolved, skipping sent and skipped', () => {
    const next = nextTouchForQuote(
      [
        touch('sent', -48, 1),
        touch('skipped', -24, 2),
        touch('scheduled', 24, 3),
        touch('scheduled', 72, 4),
      ],
      NOW,
    );
    expect(next?.touchNumber).toBe(3);
    expect(next?.scheduledAt.toISOString()).toBe(slot(24).toISOString());
  });

  it('returns null when nothing is left — a real state, not an em-dash', () => {
    expect(nextTouchForQuote([touch('sent', -48, 1)], NOW)).toBeNull();
    expect(nextTouchForQuote([], NOW)).toBeNull();
  });

  it('breaks a shared slot on touch number, so the line does not swap between renders', () => {
    const next = nextTouchForQuote([touch('scheduled', 24, 5), touch('scheduled', 24, 2)], NOW);
    expect(next?.touchNumber).toBe(2);
  });

  it('labels each state through the map, and the map covers the union', () => {
    const stateOf = (status: string, hours: number) =>
      nextTouchForQuote([touch(status, hours)], NOW)?.state;

    expect(stateOf('pending_approval', 48)).toBe('pending_approval');
    expect(stateOf('needs_draft', 48)).toBe('needs_draft');
    expect(stateOf('approved', 48)).toBe('approved');
    expect(stateOf('scheduled', 48)).toBe('scheduled');

    for (const state of NEXT_TOUCH_STATES) {
      expect(NEXT_TOUCH_STATE_LABELS[state]).toBeTruthy();
      // The house rule: a label, never a `.replace('_', ' ')` of the member.
      expect(NEXT_TOUCH_STATE_LABELS[state]).not.toMatch(/_/);
    }
    expect(NEXT_TOUCH_STATE_LABELS.pending_approval).toBe('awaiting approval');
    expect(NEXT_TOUCH_STATE_LABELS.needs_draft).toBe('no draft yet');
  });

  it('lets `stalled` win over the underlying status — the more urgent reading', () => {
    // `deriveUrgency` tests `overdue` before `due_soon` for the same reason:
    // when both readings are true, the urgent one is the honest one.
    expect(nextTouchForQuote([touch('pending_approval', 1)], NOW)?.state).toBe('stalled');
    expect(nextTouchForQuote([touch('needs_draft', -6)], NOW)?.state).toBe('stalled');
    // `approved` and `scheduled` cannot stall — the predicate refuses them.
    expect(nextTouchForQuote([touch('approved', -6)], NOW)?.state).toBe('approved');
  });
});

/* ------------------------------------------------------------------------- *
 * The week
 * ------------------------------------------------------------------------- */

describe('weeklyTouchCount', () => {
  it('is inclusive at EXACTLY seven days', () => {
    const horizon = new Date(NOW.getTime() + WEEK_HORIZON_DAYS * DAY);
    expect(weekHorizon(NOW).toISOString()).toBe(horizon.toISOString());

    expect(
      weeklyTouchCount([{ touchNumber: 1, status: 'scheduled', scheduledAt: horizon }], NOW),
    ).toBe(1);
    expect(
      weeklyTouchCount(
        [{ touchNumber: 1, status: 'scheduled', scheduledAt: new Date(horizon.getTime() + 1) }],
        NOW,
      ),
    ).toBe(0);
  });

  it('counts an overdue touch — it is still work this week', () => {
    expect(weeklyTouchCount([touch('needs_draft', -30)], NOW)).toBe(1);
  });

  it('counts nothing that has already resolved', () => {
    expect(weeklyTouchCount([touch('sent', 1), touch('skipped', 2)], NOW)).toBe(0);
  });

  it('counts every remaining touch in the window, not just the next one', () => {
    expect(
      weeklyTouchCount([touch('scheduled', 24, 1), touch('scheduled', 48, 2), touch('scheduled', 24 * 9, 3)], NOW),
    ).toBe(2);
  });
});

describe('formatRelative', () => {
  it('reads forwards and backwards from the same magnitudes', () => {
    expect(formatRelative(slot(3), NOW)).toBe('in 3 hours');
    expect(formatRelative(slot(-3), NOW)).toBe('3 hours ago');
    expect(formatRelative(slot(1), NOW)).toBe('in 1 hour');
    expect(formatRelative(slot(-1), NOW)).toBe('1 hour ago');
  });

  it('steps minutes → hours → days at the honest boundaries', () => {
    expect(formatRelative(new Date(NOW.getTime() + 90_000), NOW)).toBe('in 1 minute');
    expect(formatRelative(new Date(NOW.getTime() + 59 * 60_000), NOW)).toBe('in 59 minutes');
    expect(formatRelative(new Date(NOW.getTime() + HOUR), NOW)).toBe('in 1 hour');
    expect(formatRelative(new Date(NOW.getTime() + 23 * HOUR), NOW)).toBe('in 23 hours');
    expect(formatRelative(new Date(NOW.getTime() + DAY), NOW)).toBe('in 1 day');
    expect(formatRelative(new Date(NOW.getTime() + 9 * DAY), NOW)).toBe('in 9 days');
  });

  it('says something rather than "in 0 minutes" at the instant itself', () => {
    expect(formatRelative(NOW, NOW)).toBe('in under a minute');
    expect(formatRelative(new Date(NOW.getTime() - 1_000), NOW)).toBe('just now');
  });
});

/* ------------------------------------------------------------------------- *
 * The conversation merge (D-19)
 * ------------------------------------------------------------------------- */

const sent = (id: string, hours: number, touchNumber = 1): SentEvidence => ({
  kind: 'sent',
  id,
  touchNumber,
  at: slot(hours),
  channel: 'sms',
  outcome: 'sent',
  deliveryStatus: null,
});

const reply = (id: string, hours: number, label: string | null = 'interested'): ReplyEvidence => ({
  kind: 'reply',
  id,
  at: slot(hours),
  channel: 'sms',
  body: 'yeah go ahead',
  label,
});

describe('mergeConversation', () => {
  it('interleaves strictly by timestamp, oldest first', () => {
    const merged = mergeConversation(
      [sent('s1', -72, 1), sent('s2', -24, 2)],
      [reply('r1', -48)],
    );
    expect(merged.map((entry) => entry.id)).toEqual(['s1', 'r1', 's2']);
    expect(merged.map((entry) => entry.kind)).toEqual(['sent', 'reply', 'sent']);
  });

  it('puts the SENT row first when a reply shares its instant', () => {
    // A reply cannot precede the message it answers, and a provider timestamp
    // rounded to the second can make it look like it did.
    const merged = mergeConversation([sent('s1', -10)], [reply('r1', -10)]);
    expect(merged.map((entry) => entry.id)).toEqual(['s1', 'r1']);
  });

  it('breaks a same-kind tie on id, so two rows do not swap between renders', () => {
    const merged = mergeConversation([sent('sb', -10, 2), sent('sa', -10, 1)], []);
    expect(merged.map((entry) => entry.id)).toEqual(['sa', 'sb']);
  });

  it('handles each side being empty without inventing a row', () => {
    expect(mergeConversation([], [])).toEqual([]);
    expect(mergeConversation([sent('s1', -1)], []).map((e) => e.id)).toEqual(['s1']);
    expect(mergeConversation([], [reply('r1', -1)]).map((e) => e.id)).toEqual(['r1']);
  });
});

describe('lastActivity — chips are indicators, never content', () => {
  it('returns the most recent of each kind', () => {
    const activity = lastActivity(
      [sent('s1', -72), sent('s2', -24)],
      [reply('r1', -48, 'question'), reply('r2', -12, 'objection')],
    );

    expect(activity.lastSentAt?.toISOString()).toBe(slot(-24).toISOString());
    expect(activity.lastReply?.at.toISOString()).toBe(slot(-12).toISOString());
    expect(activity.lastReply?.label).toBe('objection');
  });

  it('returns null for a fact that does not exist — there is no placeholder chip', () => {
    expect(lastActivity([], [])).toEqual({ lastSentAt: null, lastReply: null });
    expect(lastActivity([sent('s1', -1)], []).lastReply).toBeNull();
    expect(lastActivity([], [reply('r1', -1)]).lastSentAt).toBeNull();
  });

  it('carries an unclassified reply as a null label rather than dropping the reply', () => {
    const activity = lastActivity([], [reply('r1', -1, null)]);
    expect(activity.lastReply?.at.toISOString()).toBe(slot(-1).toISOString());
    expect(activity.lastReply?.label).toBeNull();
  });

  it('accepts the quote page\'s merged thread too — the shapes are structural', () => {
    const merged = mergeConversation([sent('s1', -72)], [reply('r1', -12, 'interested')]);
    const activity = lastActivity(
      merged.filter((entry) => entry.kind === 'sent'),
      merged.filter((entry): entry is ReplyEvidence => entry.kind === 'reply'),
    );
    expect(activity.lastSentAt?.toISOString()).toBe(slot(-72).toISOString());
    expect(activity.lastReply?.label).toBe('interested');
  });

  it('CANNOT carry a message body — neither its parameters nor its result have one', () => {
    // The mitigation for T-6-21 is this SHAPE, not a comment above a `.map()`:
    // a chip cannot render a customer's words because the value the row is
    // handed does not contain any, and the client page's reads therefore never
    // have to select the column.
    const activity = lastActivity([], [reply('r1', -1)]);
    expect(Object.keys(activity)).toEqual(['lastSentAt', 'lastReply']);
    expect(Object.keys(activity.lastReply ?? {})).toEqual(['at', 'label']);
    expect(JSON.stringify(activity)).not.toContain('yeah go ahead');
  });
});

/* ------------------------------------------------------------------------- *
 * Source discipline
 * ------------------------------------------------------------------------- */

/**
 * THE CLIENT PAGE'S PIPELINE CONTRACT.
 *
 * These five assertions moved here from `tests/quote-triage.test.ts`, which is a
 * DATABASE suite: it imports `helpers/seed`, trips the WR-09 disposable-stack
 * gate at import, and therefore runs only during a sanctioned remote run. A
 * source assertion behind a remote gate is a source assertion that rots. Three
 * of the five also changed meaning — they pinned the `?status=` filter D-18
 * supersedes — so the question each one asks was rewritten for the grouping
 * while the answer that no longer exists was dropped.
 */
describe('client page pipeline contract (source assertions, D-18)', () => {
  const PAGE = readFileSync('src/app/(console)/clients/[id]/page.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const CSS = readFileSync('src/app/globals.css', 'utf8');

  it('has no ?status= filter left to strand the operator in', () => {
    expect(PAGE).not.toMatch(/FILTER_STATUSES/);
    expect(PAGE).not.toMatch(/readFilter/);
    expect(PAGE).not.toMatch(/\?status=/);
    // And the page reads no status from the search params — a route that still
    // accepted one would leave a bookmarked `?status=won` silently doing nothing.
    // 2026-10 (Phase 15, 15-05; pin corrected in 15-08): the page takes exactly
    // ONE search param, the missed-call log's keyset cursor (15-UI-SPEC §2,
    // D-02), read in exactly one place and passed raw to the section. Three
    // mentions: the destructure, the type, the one read — a fourth is a second
    // reader, and the filter this test retired would come back through it.
    expect(PAGE.match(/searchParams/g) ?? []).toHaveLength(3);
    expect(PAGE.match(/\(await searchParams\)\[[^\]]+\]/g) ?? []).toEqual([
      '(await searchParams)[CALLS_BEFORE_PARAM]',
    ]);
    expect(PAGE).not.toMatch(/\bstatus\b['"]?\s*\]|searchParams\)?\.status/);
  });

  it('reads the whole synced history in one query, minus what ServiceM8 deleted', () => {
    const query = PAGE.match(/const quotesQuery[\s\S]*?sm8_active', true\);/)?.[0] ?? '';
    expect(query).toContain("eq('tenant_id', tenant.id)");
    // Pitfall 6: the row is kept, it is not surfaced.
    expect(query).toContain("eq('sm8_active', true)");
    // No status predicate anywhere in it — the grouping is what separates
    // "needs chasing" from "what happened".
    expect(query).not.toMatch(/\.in\('status'/);
  });

  it('carries both empty states, verbatim', () => {
    // Two different diagnoses. One generic "No quotes." would be wrong in one of
    // them, and would send the operator to re-key a healthy connection.
    expect(PAGE).toContain(
      'No quotes yet. Connect ServiceM8 above — the first sync runs within 5 minutes and pulls the last 90 days.',
    );
    expect(PAGE).toContain('No quotes in the synced history.');
    // The THIRD reading — "this client has quotes and none of them need you" —
    // is the group's own empty copy and not this sentence.
    expect(PAGE).toContain('Nothing needs attention.');
  });

  it('renders money through Intl, never by gluing a dollar sign to a number', () => {
    expect(PAGE).toMatch(/Intl\.NumberFormat\('en-AU'/);
    expect(PAGE).toMatch(/currency:\s*'AUD'/);
    expect(PAGE).toMatch(/minimumFractionDigits:\s*2/);
    // `$${amount}` renders 1200 as "$1200" — no separator, no cents, and no
    // locale. It is the failure mode this assertion exists to keep out.
    expect(PAGE).not.toMatch(/\$\$\{/);
  });

  it('truncates long descriptions to one line and gives the pipeline line its own row', () => {
    const truncate = CSS.match(/\.cell-truncate\s*\{[^}]*\}/)?.[0] ?? '';
    expect(truncate).toMatch(/text-overflow:\s*ellipsis/);
    expect(truncate).toMatch(/white-space:\s*nowrap/);

    // The next-touch line and the activity chips claim a whole flex line at
    // every width — sharing one with the job number is what pushes the fact the
    // operator came for off a 390px screen.
    const line = CSS.match(/\.touch-line\s*\{[^}]*\}/)?.[0] ?? '';
    expect(line).toMatch(/flex:\s*1 1 100%/);

    // The superseded filter's styling went with it: dead CSS outlives the
    // element it styled and teaches the next reader that the control is still
    // there somewhere. Matched on the RULE (a selector followed by `{` or an
    // attribute predicate) rather than on the name, because the comment left in
    // its place says what used to be here and why — a tombstone is not a rule.
    expect(CSS).not.toMatch(/\.filter-link\s*[{[]/);
    expect(CSS).not.toMatch(/\.filters\s*\{/);
  });

  it('renders the groups as `.touch-list` rows, never as the seven-column table', () => {
    // The shipped phone decision (05-08, "A LIST, NOT A TABLE"), and these rows
    // carry more facts than the table could hold at 390px.
    expect(PAGE).toContain('className="touch-list"');
    expect(PAGE).not.toMatch(/<th>Eligibility<\/th>/);
    expect(PAGE).not.toMatch(/<th>Follow-up<\/th>/);
  });

  it('collapses Closed in a disclosure that names its count', () => {
    expect(PAGE).toMatch(/PIPELINE_GROUP_HEADINGS\.closed\}\s*\(\{rows\.length\}\)/);
    expect(PAGE).toMatch(/<details className="disclosure"/);
  });

  it('names the tenant zone once, and formats every instant through the shared helper', () => {
    expect(PAGE).toMatch(/zone-note">times in \{tenant\.timezone\}/);
    expect(PAGE).not.toMatch(/toLocaleString|toLocaleDateString|toISOString/);
  });
});

/* ------------------------------------------------------------------------- *
 * The conversation thread and the chips, as SOURCE contracts (D-19, T-6-21)
 * ------------------------------------------------------------------------- */

describe('bodies render on the quote page and NOWHERE on the client page', () => {
  const CLIENT_PAGE = readFileSync('src/app/(console)/clients/[id]/page.tsx', 'utf8');
  const QUOTE_PAGE = readFileSync(
    'src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx',
    'utf8',
  );

  it('the client page never SELECTS a message body — not filtered later, not selected', () => {
    // The strongest form of this guarantee is the select list. A body that is
    // never read cannot be rendered, cannot be serialised into the HTML payload,
    // and cannot end up in the client router cache (T-2-02, T-6-21).
    const selects = [...CLIENT_PAGE.matchAll(/\.select\(\s*'([^']*)'/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    for (const list of selects) {
      const columns = list.split(',').map((column) => column.trim());
      expect(columns).not.toContain('body');
      expect(columns).not.toContain('final_body');
      expect(columns).not.toContain('generated_body');
    }
  });

  it('the client page renders chips from label and relative time only', () => {
    expect(CLIENT_PAGE).toContain('labelGuess(');
    expect(CLIENT_PAGE).toMatch(/sent \{formatRelative/);
    // No body reaches a chip because no body reaches the page.
    expect(CLIENT_PAGE).not.toMatch(/\.body/);
  });

  it('the quote page reads the body, and says why it is allowed to', () => {
    expect(QUOTE_PAGE).toMatch(/\.select\('id, received_at, channel, body, label'\)/);
    expect(QUOTE_PAGE).toContain('reply-body');
  });

  it('the conversation section always renders, with the UI-SPEC empty copy', () => {
    expect(QUOTE_PAGE).toContain('No messages yet — the first touch is scheduled for ');
    expect(QUOTE_PAGE).toContain("'No messages yet.'");
    // Named zone, once, beside the heading — never a per-row zone suffix.
    expect(QUOTE_PAGE).toMatch(/zone-note">times in \{tenant\.timezone\}/);
  });

  it('has ONE list of sent messages, not two', () => {
    // The `Messages sent` section was the sent half of the conversation. Two
    // lists of the same sends agree until one of them is changed.
    expect(QUOTE_PAGE).not.toContain('<h2>Messages sent</h2>');
    expect(QUOTE_PAGE).not.toContain('Nothing has been sent for this quote yet.');
  });

  it('stops selecting the recipient address it never rendered', () => {
    // Asserted on the SELECT LISTS, not on the file: the type's header explains
    // why the column is gone, and a tombstone is not a read.
    const selects = [...QUOTE_PAGE.matchAll(/\.select\(\s*'([^']*)'/g)].map((m) => m[1]);
    for (const list of selects) {
      expect(list.split(',').map((column) => column.trim())).not.toContain('to_address');
    }
  });

  it('both surfaces phrase the guess through the shared module, never a local map', () => {
    const INBOX = readFileSync('src/app/(console)/inbox/page.tsx', 'utf8');
    const SHARED = readFileSync('src/app/(console)/components/label-guess.ts', 'utf8');

    expect(SHARED).toContain("interested: 'reads as interested'");
    // A local literal on either surface is how "verbatim" quietly stops being
    // verbatim.
    for (const source of [INBOX, CLIENT_PAGE, QUOTE_PAGE]) {
      expect(source).toContain('label-guess');
      expect(source).not.toMatch(/const LABEL_GUESS_LABELS/);
      // AND THROUGH THE FUNCTION, NOT THE RAW MAP (WR-09). Each surface used to
      // index `LABEL_GUESS_LABELS` and re-spell `?? raw` beside it — three
      // copies of the fallback the shared module exists to own.
      expect(source).toContain('labelGuess(');
      expect(source).not.toMatch(/LABEL_GUESS_LABELS\[/);
    }
  });
});

describe('the escalation number is refused, never repaired (CON-03, T-6-22)', () => {
  const ACTIONS = readFileSync('src/app/(console)/clients/[id]/actions.ts', 'utf8');

  it('validates through the SAME schema object tenant creation uses', () => {
    const TENANT = readFileSync('src/core/shared/tenant.ts', 'utf8');
    // One definition, two callers: the create form's field IS this schema.
    expect(TENANT).toContain('export const escalationPhoneSchema');
    expect(TENANT).toMatch(/escalation_phone:\s*escalationPhoneSchema/);
    expect(ACTIONS).toContain("escalationPhoneSchema } from '@/core/shared/tenant'");
    // And the action does not carry a second pattern of its own.
    expect(ACTIONS).not.toMatch(/04\\d\{8\}/);
  });

  it('authorizes before it reads a byte of the body (WR-01)', () => {
    const action =
      ACTIONS.match(/export async function updateEscalationPhoneAction[\s\S]*?\n}/)?.[0] ?? '';
    expect(action).toBeTruthy();
    const authorizeAt = action.indexOf('await authorize(tenantId)');
    const formDataAt = action.indexOf("formData.get('escalation_phone')");
    expect(authorizeAt).toBeGreaterThan(-1);
    expect(formDataAt).toBeGreaterThan(authorizeAt);
  });

  it('updates ONE named column and reads nothing back to write again', () => {
    const action =
      ACTIONS.match(/export async function updateEscalationPhoneAction[\s\S]*?\n}/)?.[0] ?? '';
    // The PATCH OBJECT is what matters, so the assertion reads its keys rather
    // than sweeping the whole function for column names (several of which are
    // ordinary English words that appear in the copy).
    const patch = action.match(/tenant\.update\(\{([^}]*)\}\)/)?.[1] ?? '';
    const keys = patch
      .split(',')
      .map((entry) => entry.split(':')[0].trim())
      .filter(Boolean);

    // The 05-05 named-conflict-set discipline: a settings save that rewrote its
    // row siblings would silently revert a contact-hours change made in another
    // tab, and those columns are the DNCR window every send obeys.
    expect(keys).toEqual(['escalationPhone']);

    // And nothing reads the row first. A read-modify-write is how the siblings
    // get dragged along by a later edit that "just adds one field".
    expect(action).not.toContain('tenant.get()');
  });
});

describe('grouping.ts is a derivation, not a page fragment', () => {
  const SOURCE = readFileSync('src/core/pipeline/grouping.ts', 'utf8');
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('imports the stall predicate rather than re-deriving it', () => {
    expect(CODE).toContain("from '@/core/aging/stall-policy'");
    expect(CODE).toContain('isStalled');
  });

  it('writes no threshold of its own — the number 4 is not in this file', () => {
    // Four copies of one threshold agree until somebody changes it and finds
    // three of them. `isStalled` carries the number; nothing here re-spells it.
    expect(CODE).not.toMatch(/STALL_THRESHOLD/);
    expect(CODE).not.toMatch(/\b4\s*\*\s*3_?600_?000\b/);
    expect(CODE).not.toMatch(/scheduledAt[\s\S]{0,80}\b4\b/);
  });

  it('imports nothing from next/* or the database', () => {
    const imports = [...CODE.matchAll(/^import\s[\s\S]*?from\s+'([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@/core/aging/stall-policy']);
  });
});
