/**
 * THE LEAD VOCABULARY IN THREE PLACES, AND THE LEAD HOT RULE OVER EVERY CELL
 * (Phase 13, D-05/D-07; LEAD-02, LEAD-03).
 *
 * PURE — no database, no credentials, no model. It reads two source files as
 * text (the `classification-privilege` mould) and drives the classifier with a
 * structural fake client.
 *
 * ── WHY THE THREE PLACES ARE COMPARED, NOT TRUSTED ──────────────────────────
 *
 * `LEAD_LABELS` and `LEAD_URGENCIES` are spelled in three places that cannot
 * check each other at compile time:
 *
 *   1. the TS consts           src/db/schema/inbound-messages.ts
 *   2. the CHECK literals      the same file's `check(…)` text, AND
 *                              src/db/migrations/0040_phase13_lead_cadence.sql
 *   3. the zod enums           src/core/classification/schema.ts
 *
 * A hyphen in one of them is a label the model returns, zod accepts and
 * Postgres refuses at 3am — or a row written that no `label = …` predicate
 * ever matches. (3) is derived from (1) in code; (2) is hand-pinned, so this
 * suite extracts the quoted lists from the file text and compares them member
 * for member, IN ORDER, against (1) and (3).
 *
 * ── WHY THE HOT MATRIX IS A TABLE ───────────────────────────────────────────
 *
 * 10 labels × 4 urgencies × 3 confidences = 120 cells. The expectation is a
 * literal grid written out once below, not a re-derivation of the rule — a
 * test that recomputed the rule would agree with any implementation, including
 * a wrong one.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  classifyInbound,
  isHotLeadReply,
  type ClassificationRepository,
  type ClassifyClient,
} from '../src/core/classification/classify-inbound';
import { LeadReplyLabel, LeadUrgency, ReplyConfidence } from '../src/core/classification/schema';
import {
  LABEL_GUESS_LABELS,
  labelGuess,
  URGENCY_GUESS_LABELS,
  urgencyGuess,
} from '../src/app/(console)/components/label-guess';
import type { UnclassifiedRow } from '../src/db/repository';
import {
  INBOUND_LABELS,
  LABEL_CONFIDENCES,
  LEAD_LABELS,
  LEAD_URGENCIES,
  type LeadLabel,
  type LeadUrgency as LeadUrgencyValue,
} from '../src/db/schema';

const SCHEMA_FILE = readFileSync('src/db/schema/inbound-messages.ts', 'utf8');
const MIGRATION_FILE = readFileSync('src/db/migrations/0040_phase13_lead_cadence.sql', 'utf8');

/** The single-quoted members of the first `<prefix> IN (…)` after `anchor`. */
function quotedListAfter(text: string, anchor: string, prefix: string): string[] {
  const from = text.indexOf(anchor);
  expect(from, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const start = text.indexOf(`${prefix} IN (`, from);
  expect(start, `list not found after ${anchor}: ${prefix} IN (`).toBeGreaterThan(-1);
  const open = start + `${prefix} IN (`.length;
  const close = text.indexOf(')', open);
  return [...text.slice(open, close).matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The CHECK literal in the drizzle schema file, by constraint name. */
function schemaCheck(name: string, prefix: string): string[] {
  return quotedListAfter(SCHEMA_FILE, `'${name}',`, prefix);
}

/** The CHECK literal in migration 0040's ADD CONSTRAINT, by constraint name. */
function migrationCheck(name: string, prefix: string): string[] {
  return quotedListAfter(MIGRATION_FILE, `ADD CONSTRAINT "${name}" CHECK`, prefix);
}

describe('LEAD_LABELS is byte-identical in three places (D-05)', () => {
  const LEAD_ARM = 'lead_id IS NOT NULL AND label';

  it('the TS const is the ten D-05 labels, underscores throughout', () => {
    expect([...LEAD_LABELS]).toEqual([
      'new_enquiry',
      'callback_request',
      'question',
      'existing_job',
      'complaint',
      'not_a_lead',
      'already_sorted',
      'spam',
      'opt_out',
      'other',
    ]);
  });

  it('equals the lead arm of the schema file CHECK, in order', () => {
    expect(schemaCheck('inbound_messages_label_known', LEAD_ARM)).toEqual([...LEAD_LABELS]);
  });

  it('equals the lead arm of migration 0040 CHECK, in order', () => {
    expect(migrationCheck('inbound_messages_label_known', LEAD_ARM)).toEqual([...LEAD_LABELS]);
  });

  it('equals the zod enum the model is bound to', () => {
    expect(LeadReplyLabel.options).toEqual([...LEAD_LABELS]);
  });

  it('INBOUND_LABELS is unchanged and still the quote arm of the same CHECK, both files', () => {
    const QUOTE_ARM = 'lead_id IS NULL AND label';
    expect([...INBOUND_LABELS]).toEqual([
      'interested',
      'question',
      'objection',
      'not_interested',
      'opt_out',
      'other',
    ]);
    expect(schemaCheck('inbound_messages_label_known', QUOTE_ARM)).toEqual([...INBOUND_LABELS]);
    expect(migrationCheck('inbound_messages_label_known', QUOTE_ARM)).toEqual([...INBOUND_LABELS]);
  });
});

describe('LEAD_URGENCIES is byte-identical in three places (D-05)', () => {
  it('the TS const is the four urgencies', () => {
    expect([...LEAD_URGENCIES]).toEqual(['emergency', 'this_week', 'flexible', 'unknown']);
  });

  it('equals the schema file CHECK, in order', () => {
    expect(schemaCheck('inbound_messages_urgency_known', 'urgency')).toEqual([...LEAD_URGENCIES]);
  });

  it('equals migration 0040 CHECK, in order', () => {
    expect(migrationCheck('inbound_messages_urgency_known', 'urgency')).toEqual([
      ...LEAD_URGENCIES,
    ]);
  });

  it('equals the zod enum the model is bound to', () => {
    expect(LeadUrgency.options).toEqual([...LEAD_URGENCIES]);
  });

  it('the confidence buckets are shared with the quote vocabulary, CHECK included', () => {
    expect(ReplyConfidence.options).toEqual([...LABEL_CONFIDENCES]);
    expect(schemaCheck('inbound_messages_label_confidence_known', 'label_confidence')).toEqual([
      ...LABEL_CONFIDENCES,
    ]);
  });
});

/* ------------------------------------------------------------------------- *
 * The 120-cell hot matrix (D-07)
 * ------------------------------------------------------------------------- */

/**
 * THE TABLE. One row per label; twelve cells per row — four urgency groups of
 * three confidences (H M L). `X` is hot, `.` is cold. Written out once, by
 * hand, from D-07:
 *
 *   emergency is hot at every confidence, except at spam / opt_out / not_a_lead;
 *   otherwise only HIGH confidence, and only at new_enquiry, callback_request,
 *   existing_job and complaint.
 */
const GRID: Record<LeadLabel, string> = {
  //                emergency  this_week  flexible   unknown
  //                H M L      H M L      H M L      H M L
  new_enquiry:      'X X X      X . .      X . .      X . .',
  callback_request: 'X X X      X . .      X . .      X . .',
  question:         'X X X      . . .      . . .      . . .',
  existing_job:     'X X X      X . .      X . .      X . .',
  complaint:        'X X X      X . .      X . .      X . .',
  not_a_lead:       '. . .      . . .      . . .      . . .',
  already_sorted:   'X X X      . . .      . . .      . . .',
  spam:             '. . .      . . .      . . .      . . .',
  opt_out:          '. . .      . . .      . . .      . . .',
  other:            'X X X      . . .      . . .      . . .',
};

const CONFIDENCES = ['high', 'medium', 'low'] as const;

const CELLS: ReadonlyArray<readonly [LeadLabel, LeadUrgencyValue, string, boolean]> =
  LEAD_LABELS.flatMap((label) => {
    const marks = GRID[label].replace(/\s+/g, '');
    expect(marks, `${label} row must have 12 cells`).toMatch(/^[X.]{12}$/);
    return LEAD_URGENCIES.flatMap((urgency, u) =>
      CONFIDENCES.map(
        (confidence, c) => [label, urgency, confidence, marks[u * 3 + c] === 'X'] as const,
      ),
    );
  });

/** A one-row repository that records the write. */
function oneLeadRow(): { repo: ClassificationRepository; written: Record<string, unknown>[] } {
  const queued: UnclassifiedRow = {
    id: 'cell',
    body: 'a reply',
    receivedAt: new Date('2026-10-08T00:00:00.000Z'),
    classifyAttempts: 0,
    leadId: 'lead-cell',
  };
  const written: Record<string, unknown>[] = [];
  return {
    written,
    repo: {
      async listUnclassified() {
        return [queued];
      },
      async writeClassification(_id, write) {
        written.push(write as unknown as Record<string, unknown>);
        return { classified: true };
      },
      async bumpClassifyAttempts() {},
    },
  };
}

function answering(parsed: unknown): ClassifyClient {
  return {
    messages: {
      async parse() {
        return { parsed_output: parsed };
      },
    },
  };
}

describe('isHotLeadReply over every (label × urgency × confidence) cell (D-07)', () => {
  it('the grid covers 120 cells, 33 of them hot', () => {
    expect(CELLS).toHaveLength(120);
    expect(CELLS.filter(([, , , hot]) => hot)).toHaveLength(33);
  });

  it('emergency is hot at every confidence except at spam, opt_out and not_a_lead', () => {
    const emergencyCold = CELLS.filter(([, urgency, , hot]) => urgency === 'emergency' && !hot);
    expect([...new Set(emergencyCold.map(([label]) => label))].sort()).toEqual(
      ['not_a_lead', 'opt_out', 'spam'].sort(),
    );
  });

  it('medium and low are cold at every non-emergency cell', () => {
    const offBar = CELLS.filter(
      ([, urgency, confidence, hot]) => urgency !== 'emergency' && confidence !== 'high' && hot,
    );
    expect(offBar).toEqual([]);
  });

  it.each(CELLS)('%s / %s / %s -> hot=%s', async (label, urgency, confidence, hot) => {
    // The function itself…
    expect(isHotLeadReply(label, urgency, confidence)).toBe(hot);

    // …and the same cell through the classification pass, so the matrix pins
    // the WIRING (the lead vocabulary's `read` uses this rule) and not just a
    // function nothing calls.
    const { repo, written } = oneLeadRow();
    await classifyInbound({
      client: answering({ label, urgency, confidence }),
      now: new Date('2026-10-08T00:00:00.000Z'),
      repo,
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ label, urgency, labelConfidence: confidence, isHot: hot });
  });
});

// ── 13-REVIEW WR-03 (2026-10-09): the console phrases every label it can see ──

describe('every label in either vocabulary has operator words (no snake_case on a phone)', () => {
  /**
   * The schema consts are read HERE, in the test, so `label-guess.ts` stays an
   * import-free leaf (lint-ban pins it). A member added to either vocabulary
   * without an entry fails this, rather than rendering `new_enquiry` on a
   * badge.
   */
  it.each([...new Set([...INBOUND_LABELS, ...LEAD_LABELS])])('%s has an entry, phrased as a guess', (label) => {
    expect(LABEL_GUESS_LABELS[label], label).toBeDefined();
    expect(labelGuess(label)).toMatch(/^reads as /);
    expect(labelGuess(label)).not.toContain('_');
  });

  it.each(LEAD_URGENCIES.filter((u) => u !== 'unknown'))('urgency %s has words', (urgency) => {
    expect(URGENCY_GUESS_LABELS[urgency], urgency).toBeDefined();
    expect(urgencyGuess(urgency)).not.toContain('_');
  });

  it('`unknown` and a quote reply’s NULL urgency render nothing', () => {
    expect(urgencyGuess('unknown')).toBeNull();
    expect(urgencyGuess(null)).toBeNull();
  });
});

describe('the inbox shows a lead reply’s urgency (WR-03)', () => {
  const strip = (path: string) =>
    readFileSync(path, 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const repository = strip('src/db/repository/inbound-messages.ts');
  const page = strip('src/app/(console)/inbox/page.tsx');

  it('the triage read selects urgency', () => {
    const select = repository.slice(
      repository.indexOf('export async function listInboundNeedingTriage'),
      repository.indexOf('.from(inboundMessages)', repository.indexOf('export async function listInboundNeedingTriage')),
    );
    expect(select).toMatch(/urgency: inboundMessages\.urgency/);
  });

  it('the page renders it through the shared guess, an emergency in the error colour', () => {
    expect(page).toMatch(/urgencyGuess\(row\.urgency\)/);
    expect(page).toMatch(/row\.urgency === 'emergency' \? 'badge badge--error' : 'badge'/);
  });
});
