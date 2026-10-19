/**
 * Phase 14 (SM8-02, D-06, D8; T-14-13): a `won` on a job a lead is linked to is
 * COUNTED in leads-to-jobs and NEVER attributed recovered dollars in v1.2.
 *
 * ── WHY THE EXCLUSION SITS BEFORE THE DECISION, NOT INSIDE IT ───────────────
 *
 * A lead-born job may later be reviewed eligible and run a quote cadence; its
 * touches would then qualify, and `decideAttribution` would bill the tradie for
 * a job our missed-call tap (or his own booking) produced. So the consumer asks
 * the lead linkage FIRST and returns `unqualified` before the decision runs,
 * whatever the ledger holds. `qualifyingTouches` is not where it goes: its two
 * SQL twins feed the live metrics and must stay byte-equivalent to it.
 *
 * KEYED ON THE LINKAGE, NEVER ON `quotes.sync_source`: that column is
 * provenance, and the tradie-booked job never carried `'lead'` at all.
 *
 * PURE. The predicate as a function, and the wiring as source pins. The
 * consumer's behaviour against a real database is in
 * tests/lead-booked-by-tradie.test.ts (CI).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isLeadBornJob } from '../src/core/attribution/lead-born';

const CONSUMER = 'src/core/attribution/consume-wins.ts';

function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('isLeadBornJob — over the lead linkage rows', () => {
  it('no linked lead is not lead-born', () => {
    expect(isLeadBornJob([])).toBe(false);
  });

  it('a lead whose job we created (state created) is lead-born', () => {
    expect(isLeadBornJob([{ sm8JobState: 'created', closedReason: 'job_created' }])).toBe(true);
  });

  it('a lead the tradie booked himself (booked_by_tradie, state none) is lead-born', () => {
    expect(isLeadBornJob([{ sm8JobState: 'none', closedReason: 'booked_by_tradie' }])).toBe(true);
  });

  it('the job_created reason suffices whatever the state says', () => {
    expect(isLeadBornJob([{ sm8JobState: 'none', closedReason: 'job_created' }])).toBe(true);
  });

  it('state created suffices whatever the reason says', () => {
    expect(isLeadBornJob([{ sm8JobState: 'created', closedReason: null }])).toBe(true);
  });

  // 14-REVIEW WR-03: ANY linkage is lead-born, whatever the state or reason.
  it('a FAILED attempt holding the uuid is lead-born — the job our tap made exists (WR-03)', () => {
    expect(isLeadBornJob([{ sm8JobState: 'failed', closedReason: null }])).toBe(true);
  });

  it('a lead still CREATING holding the uuid is lead-born — ours, not yet confirmed (WR-03)', () => {
    expect(isLeadBornJob([{ sm8JobState: 'creating', closedReason: null }])).toBe(true);
  });

  it('a lead closed for another reason that carries the uuid is still lead-born (WR-03)', () => {
    expect(isLeadBornJob([{ sm8JobState: 'none', closedReason: 'operator' }])).toBe(true);
    expect(isLeadBornJob([{ sm8JobState: 'failed', closedReason: 'opt_out' }])).toBe(true);
  });

  it('one lead-born link among others is enough', () => {
    expect(
      isLeadBornJob([
        { sm8JobState: 'failed', closedReason: null },
        { sm8JobState: 'none', closedReason: 'booked_by_tradie' },
      ]),
    ).toBe(true);
  });
});

describe('the consumer asks the linkage before the decision (D-06, T-14-13)', () => {
  const source = code(CONSUMER);
  const start = source.indexOf('async function attributeWonEvent(');
  const end = source.indexOf('\n}\n', start);
  const body = source.slice(start, end);

  it('reads tx.leads.linkedToJob on the event’s job inside attributeWonEvent', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body.match(/tx\.leads\.linkedToJob\(event\.sm8JobUuid\)/g) ?? []).toHaveLength(1);
  });

  it('the read and the lead-born branch come before decideAttribution', () => {
    const readAt = body.indexOf('tx.leads.linkedToJob(');
    const branchAt = body.indexOf('isLeadBornJob(');
    const decideAt = body.indexOf('decideAttribution(');
    expect(readAt).toBeGreaterThan(-1);
    expect(branchAt).toBeGreaterThan(readAt);
    expect(decideAt).toBeGreaterThan(branchAt);
  });

  it('the lead-born branch counts unqualified and returns before any claim', () => {
    const branchAt = body.indexOf('isLeadBornJob(');
    const branch = body.slice(branchAt, body.indexOf('return;', branchAt) + 'return;'.length);
    expect(branch).toContain('outcome.unqualified += 1');
    expect(branch).toContain('lead_born');
    expect(branch).not.toContain('attributions.claim(');
    expect(body.indexOf('tx.attributions.claim(')).toBeGreaterThan(branchAt);
  });

  it('never keys the exclusion on the sync source', () => {
    for (const path of [CONSUMER, 'src/core/attribution/lead-born.ts']) {
      expect(code(path)).not.toMatch(/sync_source|syncSource/);
    }
  });

  it('lead-born.ts is pure: it imports nothing', () => {
    expect(code('src/core/attribution/lead-born.ts')).not.toMatch(/^import /m);
  });
});

describe('the attribution rules themselves did not move (D-06, D-13)', () => {
  // SHA-256 of each file at the phase base (bd8beb3). A content pin rather than
  // a `git diff`, because CI checks out one commit and has no history to diff.
  const PINNED: Record<string, string> = {
    'src/core/attribution/qualify.ts': '1fa32c3986c59da2f594c13c2c02f83fcd2a2577f0f40e73dfcc8d4b2ec3700e',
    'src/core/attribution/decide.ts': '5a6c72e622346ad7112887c29ac07cf5c80f32c46c017151327784c5fd93f88d',
  };

  it.each(Object.entries(PINNED))('%s is byte-identical to the phase base', (path, digest) => {
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(digest);
  });
});
