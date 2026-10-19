/**
 * THE THREE CLIENT-SAFE LEAVES, PINNED AGAINST THE SCHEMA VOCABULARY (Phase 15,
 * CON-05 / CON-06 / RPT-05; D-01, D-02, D-04).
 *
 * PURE. The leaves spell their label maps with string-literal keys because a
 * `'use client'` island that value-imports a vocabulary from `@/db/schema`
 * drags Postgres into the browser bundle (research Pitfall 9). So the
 * vocabularies are imported HERE, in the test, and every member is checked to
 * have a word — a new skip reason with no label fails this suite instead of
 * shipping as snake_case on the operator's phone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AFTER_HOURS_LABEL,
  CALLER_KIND_LABELS,
  NUMBER_RETIRED_LABEL,
  TEXT_BACK_OUTCOME_LABELS,
  TEXT_BACK_SKIP_REASON_LABELS,
  resolveTextBackOutcome,
  type TextBackOutcomeFacts,
} from '@/app/(console)/components/text-back-outcome';
import {
  BAD_REQUEST_MESSAGE,
  BLANK_CONTROL_STATE,
} from '@/app/(console)/components/action-state';
import {
  APPROVE_TOUCH_LABEL,
  CLOSE_CONFIRM_LABEL,
  CLOSE_DISMISS_LABEL,
  CLOSE_PENDING_LABEL,
  CLOSE_STEP_LABEL,
  LEAD_ALREADY_CLOSED_MESSAGE,
  LEAD_CLOSED_MESSAGE,
  LEAD_CLOSE_FAILED_MESSAGE,
  LEAD_TOUCH_COUNT,
  LEADS_EMPTY_HINT,
  LEADS_EMPTY_TITLE,
  LEADS_HINT,
  LEADS_LOAD_FAILED_MESSAGE,
  NEXT_TOUCH_STATE_LABELS,
  NO_FOLLOW_UPS_LEFT_LABEL,
  NO_REPLY_LABEL,
  STALLED_LABEL,
  closeConsequence,
  closeControlState,
  closeLeadSchema,
} from '@/app/(console)/leads/action-state';
import {
  BLANK_EXPORT_STATE,
  EXPORT_EMPTY_MESSAGE,
  EXPORT_FAILED_MESSAGE,
  EXPORT_FILENAME_PREFIX,
  EXPORT_HINT,
  EXPORT_LABEL,
  EXPORT_PENDING_LABEL,
  exportedMessage,
} from '@/app/(console)/reports/export-state';
import { TOUCH_STATUSES } from '@/db/schema/cadence-touches';
import { CALLER_KINDS, TEXT_BACK_SKIP_REASONS, TEXT_BACK_STATUSES } from '@/db/schema/missed-calls';
import { DELIVERY_STATUSES } from '@/db/schema/send-ledger';

const NOW = new Date('2026-10-13T02:00:00.000Z');
const STUCK_MS = 10 * 60_000;
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const facts = (overrides: Partial<TextBackOutcomeFacts> = {}): TextBackOutcomeFacts => ({
  textBackStatus: null,
  textBackSkipReason: null,
  deliveryStatus: null,
  startedAt: minutesAgo(1),
  ...overrides,
});

const word = (overrides: Partial<TextBackOutcomeFacts>) => resolveTextBackOutcome(facts(overrides), NOW, STUCK_MS).word;

describe('TEXT_BACK_SKIP_REASON_LABELS', () => {
  it('has a word for every TEXT_BACK_SKIP_REASONS member, and nothing else', () => {
    for (const reason of TEXT_BACK_SKIP_REASONS) {
      expect(TEXT_BACK_SKIP_REASON_LABELS[reason], reason).toBeTruthy();
    }
    expect(Object.keys(TEXT_BACK_SKIP_REASON_LABELS).sort()).toEqual([...TEXT_BACK_SKIP_REASONS].sort());
    expect(Object.keys(TEXT_BACK_SKIP_REASON_LABELS)).toHaveLength(14);
  });

  it('maps recent_conversion (D-08b) to its words', () => {
    expect(TEXT_BACK_SKIP_REASON_LABELS.recent_conversion).toBe('booked recently');
  });

  it('spells the UI-SPEC §2 words', () => {
    expect(TEXT_BACK_SKIP_REASON_LABELS).toEqual({
      not_armed: 'text-back not armed',
      own_number: "the client's own number",
      withheld: 'withheld number',
      not_mobile: 'not a mobile',
      suppressed: 'opted out',
      recent_negative_close: 'recent negative close',
      recent_conversion: 'booked recently',
      recent_text: 'texted recently',
      daily_cap: 'daily cap reached',
      stale: 'stale',
      sms_not_armed: 'SMS not armed',
      no_template: 'no attested template',
      lead_open: 'lead already open',
      quote_open: 'quote already open',
    });
  });
});

describe('CALLER_KIND_LABELS and the fixed chip words', () => {
  it('covers every non-mobile caller kind (a mobile renders its number)', () => {
    for (const kind of CALLER_KINDS.filter((k) => k !== 'mobile')) {
      expect(CALLER_KIND_LABELS[kind as keyof typeof CALLER_KIND_LABELS], kind).toBeTruthy();
    }
    expect(CALLER_KIND_LABELS.other_number).toBe('Landline or other number');
    expect(CALLER_KIND_LABELS.withheld).toBe('Withheld number');
  });

  it('spells the after-hours and retired-number words', () => {
    expect(AFTER_HOURS_LABEL).toBe('after hours');
    expect(NUMBER_RETIRED_LABEL).toBe('Mobile · number retired');
  });
});

describe('resolveTextBackOutcome — the §2 chip table', () => {
  it('status NULL: deciding… while young, undecided once older than the threshold', () => {
    expect(word({ startedAt: minutesAgo(1) })).toBe('deciding…');
    expect(resolveTextBackOutcome(facts({ startedAt: minutesAgo(11) }), NOW, STUCK_MS)).toEqual({
      word: 'undecided',
      tone: 'warn',
    });
  });

  it('claimed: sending… while young, stuck once old', () => {
    expect(word({ textBackStatus: 'claimed', startedAt: minutesAgo(1) })).toBe('sending…');
    expect(resolveTextBackOutcome(facts({ textBackStatus: 'claimed', startedAt: minutesAgo(30) }), NOW, STUCK_MS)).toEqual({
      word: 'stuck',
      tone: 'warn',
    });
  });

  it('sent: by the ledger delivery status', () => {
    expect(resolveTextBackOutcome(facts({ textBackStatus: 'sent', deliveryStatus: 'delivered' }), NOW, STUCK_MS)).toEqual({
      word: 'delivered',
      tone: 'ok',
    });
    expect(resolveTextBackOutcome(facts({ textBackStatus: 'sent', deliveryStatus: 'undelivered' }), NOW, STUCK_MS)).toEqual({
      word: 'undelivered',
      tone: 'error',
    });
    expect(word({ textBackStatus: 'sent', deliveryStatus: null })).toBe('sent');
    expect(word({ textBackStatus: 'sent', deliveryStatus: 'unknown' })).toBe('sent');
  });

  it('failed is failed, as an error', () => {
    expect(resolveTextBackOutcome(facts({ textBackStatus: 'failed' }), NOW, STUCK_MS)).toEqual({
      word: 'failed',
      tone: 'error',
    });
  });

  it('skipped: stale is its own warn chip; any other reason reads "skipped — {words}"', () => {
    expect(resolveTextBackOutcome(facts({ textBackStatus: 'skipped', textBackSkipReason: 'stale' }), NOW, STUCK_MS)).toEqual({
      word: 'stale',
      tone: 'warn',
    });
    expect(word({ textBackStatus: 'skipped', textBackSkipReason: 'own_number' })).toBe(
      "skipped — the client's own number",
    );
    expect(word({ textBackStatus: 'skipped', textBackSkipReason: 'recent_conversion' })).toBe(
      'skipped — booked recently',
    );
  });

  it('every skip reason resolves through the map, never to the raw reason', () => {
    for (const reason of TEXT_BACK_SKIP_REASONS) {
      const chip = word({ textBackStatus: 'skipped', textBackSkipReason: reason });
      expect(chip).not.toContain('_');
      expect(chip.length).toBeGreaterThan(0);
    }
  });

  it('every (status × delivery) combination resolves to a non-empty word', () => {
    for (const status of [null, ...TEXT_BACK_STATUSES]) {
      for (const delivery of [null, ...DELIVERY_STATUSES]) {
        for (const age of [1, 60]) {
          const chip = word({ textBackStatus: status, deliveryStatus: delivery, startedAt: minutesAgo(age) });
          expect(chip.length, `${status}/${delivery}/${age}`).toBeGreaterThan(0);
          expect(chip).not.toContain('_');
        }
      }
    }
  });
});

describe('no label contains an underscore', () => {
  it('in any map', () => {
    for (const map of [TEXT_BACK_OUTCOME_LABELS, TEXT_BACK_SKIP_REASON_LABELS, CALLER_KIND_LABELS, NEXT_TOUCH_STATE_LABELS]) {
      for (const label of Object.values(map)) expect(label).not.toContain('_');
    }
  });
});

describe('the lead queue leaf (D-01)', () => {
  it('has a next-touch word for every status the queue can show, each a TOUCH_STATUSES member', () => {
    const shown = ['scheduled', 'needs_draft', 'pending_approval', 'approved'];
    for (const status of shown) {
      expect((TOUCH_STATUSES as readonly string[]).includes(status), status).toBe(true);
      expect(NEXT_TOUCH_STATE_LABELS[status], status).toBeTruthy();
    }
    expect(NEXT_TOUCH_STATE_LABELS).toEqual({
      scheduled: 'scheduled',
      needs_draft: 'no draft yet',
      pending_approval: 'awaiting approval',
      approved: 'approved',
    });
  });

  it('spells the UI-SPEC §1 sentences', () => {
    expect(LEAD_TOUCH_COUNT).toBe(3);
    expect(CLOSE_STEP_LABEL).toBe('Close this lead');
    expect(closeConsequence('Acme Plumbing')).toBe(
      "This lead closes for good: its remaining follow-ups are cancelled and nothing more is sent. Acme Plumbing's customer can still ring again.",
    );
    expect([CLOSE_CONFIRM_LABEL, CLOSE_DISMISS_LABEL, CLOSE_PENDING_LABEL]).toEqual(['Close it', 'Keep it', 'Closing…']);
    expect(LEAD_CLOSED_MESSAGE).toBe('Lead closed. Nothing more will be sent.');
    expect(LEAD_ALREADY_CLOSED_MESSAGE).toBe('This lead was already closed.');
    expect(LEAD_CLOSE_FAILED_MESSAGE).toBe('Could not close the lead. Try again in a moment.');
    expect(APPROVE_TOUCH_LABEL).toBe('Approve the next touch →');
    expect(STALLED_LABEL).toBe('stalled');
    expect(NO_FOLLOW_UPS_LEFT_LABEL).toBe('No follow-ups left');
    expect(NO_REPLY_LABEL).toBe('No reply yet.');
    expect(LEADS_HINT).toBe(
      "Every missed caller who got a text and hasn't been closed, booked or expired — soonest follow-up deadline first, across every client. Read their latest reply, then approve the next touch, create the job, or close the lead.",
    );
    expect(LEADS_EMPTY_TITLE).toBe('No open leads.');
    expect(LEADS_EMPTY_HINT).toBe(
      "A lead opens the moment a diverted call gets a text-back. It shows up here with its next follow-up deadline, the caller's latest reply and what to do next, until it's closed, booked or expired.",
    );
    expect(LEADS_LOAD_FAILED_MESSAGE).toBe('Could not load the leads. Try again in a moment.');
  });

  it('accepts exactly one uuid lead_id', () => {
    expect(closeLeadSchema.safeParse({ lead_id: '3f6c2a1e-8b4d-4c7a-9e2f-5d1b7a3c9e4f' }).success).toBe(true);
    expect(closeLeadSchema.safeParse({ lead_id: 'not-a-uuid' }).success).toBe(false);
    expect(closeLeadSchema.safeParse({}).success).toBe(false);
  });

  it('maps each close outcome to its state; only a real close or an already-closed settles', () => {
    expect(closeControlState({ kind: 'closed' })).toEqual({ ...BLANK_CONTROL_STATE, success: LEAD_CLOSED_MESSAGE, settled: true });
    expect(closeControlState({ kind: 'already_closed' })).toEqual({
      ...BLANK_CONTROL_STATE,
      success: LEAD_ALREADY_CLOSED_MESSAGE,
      settled: true,
    });
    expect(closeControlState({ kind: 'not_found' })).toEqual({ ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE });
  });
});

describe('the export leaf (D-04)', () => {
  it('spells the UI-SPEC §3a sentences', () => {
    expect(EXPORT_LABEL).toBe('Export design-partner CSV');
    expect(EXPORT_PENDING_LABEL).toBe('Exporting…');
    expect(exportedMessage(1, 'backdesk-design-partner-stats-2026-10-13.csv')).toBe(
      'Exported 1 row as backdesk-design-partner-stats-2026-10-13.csv.',
    );
    expect(exportedMessage(4, 'f.csv')).toBe('Exported 4 rows as f.csv.');
    expect(EXPORT_EMPTY_MESSAGE).toBe('Nothing to export yet — the file has its header row only.');
    expect(EXPORT_FAILED_MESSAGE).toBe('Could not export the CSV. Try again in a moment.');
    expect(EXPORT_HINT).toBe(
      'One row per client per month: missed calls, after-hours share, text-back speed, reply rate and leads → jobs, each with its denominator. Client names only — no phone numbers, no message bodies, no caller details of any kind.',
    );
    expect(EXPORT_FILENAME_PREFIX).toBe('backdesk-design-partner-stats-');
    expect(BLANK_EXPORT_STATE).toEqual({ csv: null, filename: null, rows: null, error: null });
  });
});

describe('the leaves import nothing they must not (source pin)', () => {
  const code = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('text-back-outcome.ts and export-state.ts import nothing', () => {
    expect(code('src/app/(console)/components/text-back-outcome.ts')).not.toMatch(/^\s*import\b/m);
    expect(code('src/app/(console)/reports/export-state.ts')).not.toMatch(/^\s*import\b/m);
  });

  it('leads/action-state.ts value-imports only zod and the shared action state', () => {
    const specifiers = [...code('src/app/(console)/leads/action-state.ts').matchAll(/^import\s+([\s\S]*?)from\s+'([^']+)';$/gm)]
      .filter(([, clause]) => !/^\s*type\s/.test(clause!))
      .map(([, , specifier]) => specifier);
    expect(specifiers.sort()).toEqual(['../components/action-state', 'zod']);
  });

  it('no leaf derives a label by string replacement', () => {
    for (const path of [
      'src/app/(console)/components/text-back-outcome.ts',
      'src/app/(console)/leads/action-state.ts',
      'src/app/(console)/reports/export-state.ts',
    ]) {
      expect(code(path)).not.toMatch(/\.replace(All)?\(/);
    }
  });
});
