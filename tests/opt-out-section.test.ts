/**
 * THE DIGEST LINE'S VOCABULARY IS CLOSED, AND THIS SUITE IS WHAT CLOSES IT
 * (D-16, 07-UI-SPEC Screen 5).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A plain-text email leaving this service every morning is the one Phase 7 │
 * │ surface with no `role="alert"`, no gate and no reader who can check it   │
 * │ against the screen. So its bytes are asserted VERBATIM: a client name,   │
 * │ three integers and fixed words — never an address, never a body, never a │
 * │ customer's name.                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE. No database, no clock, no network — the section is a function of counts
 * that have already been computed, which is exactly why it can be pinned this
 * hard.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { OPT_OUT_ALARM_MIN_CONTACTS } from '@/core/audit/constants';
import {
  computeTenantMetrics,
  OPT_OUT_ALARM_BP,
  type TenantMetricCounts,
} from '@/core/reporting/metrics';
import { buildOptOutSection } from '@/core/reporting/opt-out-section';
import { rollingWindow } from '@/core/reporting/period';

const NOW = new Date('2026-09-02T06:30:00.000Z');
const WINDOW = rollingWindow(NOW, 30);

/**
 * A counts row with everything at zero except the two numbers this section
 * reads. Nothing else can reach the line, and building the fixture this way
 * says so.
 */
function counts(
  overrides: Partial<TenantMetricCounts> & Pick<TenantMetricCounts, 'tenantId' | 'tenantName'>,
): TenantMetricCounts {
  return {
    timezone: 'Australia/Perth',
    quotesOpened: 0,
    quotesFirstTouch24h: 0,
    cadencesTouched: 0,
    cadencesReplied: 0,
    contactsTouched: 0,
    contactsOptedOut: 0,
    draftsApproved: 0,
    draftsEdited: 0,
    editDistanceSum: '0',
    conservativeCents: 0,
    escalationLatencyMinutes: [],
    fees: [],
    // 2026-10 (Phase 15, 15-03): the overview's calls column, zero by default.
    missedCalls: 0,
    missedCallsAfterHours: 0,
    hasDivertNumber: false,
    ...overrides,
  };
}

const metricsFor = (row: TenantMetricCounts) => computeTenantMetrics(row, WINDOW, NOW);

/** 3 of 42 is 7.14…%, which rounds to 7.1% — above the 5% threshold. */
const ZED = counts({
  tenantId: '00000000-0000-4000-8000-0000000000ff',
  tenantName: 'Zed Plumbing',
  contactsTouched: 42,
  contactsOptedOut: 3,
});

/** 2 of 20 is 10.0%. Sorts BEFORE Zed by name, though it is alarmed later. */
const ACE = counts({
  tenantId: '00000000-0000-4000-8000-00000000000a',
  tenantName: 'Ace Electrical',
  contactsTouched: 20,
  contactsOptedOut: 2,
});

/** 1 of 100 is 1.0% — messaged plenty, upset almost nobody. */
const HEALTHY = counts({
  tenantId: '00000000-0000-4000-8000-00000000000b',
  tenantName: 'Bright Sparks',
  contactsTouched: 100,
  contactsOptedOut: 1,
});

/** Messaged nobody. A rate of `null`, and never a line. */
const SILENT = counts({
  tenantId: '00000000-0000-4000-8000-00000000000c',
  tenantName: 'Quiet Roofing',
});

describe('buildOptOutSection (D-16)', () => {
  it('writes one byte-verbatim line per client above the threshold', () => {
    const section = buildOptOutSection([ZED, HEALTHY, ACE].map(metricsFor));

    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Opt-out rate above 5%:');
    // ORDERED BY NAME, not by severity: the operator reads this list to decide
    // who to ring, and a list that reorders itself every morning is one they
    // scan from the top every morning.
    expect(section!.lines).toEqual([
      'Ace Electrical: 10.0% (2 of 20 contacts) in the last 30 days.',
      'Zed Plumbing: 7.1% (3 of 42 contacts) in the last 30 days.',
    ]);
  });

  it('returns NULL when nobody is above it, not an empty section', () => {
    const section = buildOptOutSection([HEALTHY, SILENT].map(metricsFor));

    // A heading with nothing under it is a daily all-clear, which is the
    // trained blindness the digest's empty-send rule exists to avoid — and a
    // `{ heading, lines: [] }` would still count toward `sectionLines` and mail
    // an otherwise-empty digest.
    expect(section).toBeNull();
  });

  it('never alarms a client with no denominator', () => {
    // `null` is not `>= 5%`. A badge — or a line in the operator's inbox — for
    // a client we have messaged nobody for is a false accusation.
    expect(buildOptOutSection([SILENT].map(metricsFor))).toBeNull();
  });

  it('alarms exactly AT the threshold, from the one constant', () => {
    // 5 of 100 is 5.0% — at the boundary, and inside it, the same convention
    // every other rule in this codebase uses.
    const exact = counts({
      tenantId: '00000000-0000-4000-8000-00000000000d',
      tenantName: 'Edge Case Concreting',
      contactsTouched: 100,
      contactsOptedOut: 5,
    });

    const section = buildOptOutSection([exact].map(metricsFor));
    expect(section!.lines).toEqual([
      `Edge Case Concreting: ${OPT_OUT_ALARM_BP / 100}.0% (5 of 100 contacts) in the last 30 days.`,
    ]);
  });

  it('writes NOTHING for a client with one contact who opted out (quick 260913-ind)', () => {
    // THE BUG THIS RULE WAS WRITTEN FOR, as a fixture. The live test tenant
    // has exactly one contact — the operator's own handset, opted out during
    // the Phase 4 STOP test — so this section was the digest's ONLY content
    // every morning for a rolling thirty days: "100.0% (1 of 1 contacts)". The
    // arithmetic was right and the alarm was noise, and an operator who
    // deletes this email unread every day will delete the real one too.
    const lone = counts({
      tenantId: '00000000-0000-4000-8000-00000000000e',
      tenantName: 'Perth Sparks Electrical (Test)',
      contactsTouched: 1,
      contactsOptedOut: 1,
    });

    expect(buildOptOutSection([lone].map(metricsFor))).toBeNull();
  });

  it('stays silent one contact short of the floor, however unanimous', () => {
    // 9 of 9 is 100% and still not a sample. The floor is a DENOMINATOR rule,
    // not a severity rule — there is no rate high enough to buy past it.
    const nine = counts({
      tenantId: '00000000-0000-4000-8000-00000000000f',
      tenantName: 'Thin Sample Tiling',
      contactsTouched: OPT_OUT_ALARM_MIN_CONTACTS - 1,
      contactsOptedOut: OPT_OUT_ALARM_MIN_CONTACTS - 1,
    });

    expect(buildOptOutSection([nine].map(metricsFor))).toBeNull();
  });

  it('fires at exactly the floor, and the rate threshold is unchanged above it', () => {
    // AT the floor is inside it, the same convention as the 5% threshold. 1 of
    // 10 is 10%; 1 of 20 is exactly 5%. Both alarm — the sample floor can only
    // ever silence a client, never raise one that would not have alarmed.
    const atFloor = counts({
      tenantId: '00000000-0000-4000-8000-000000000010',
      tenantName: 'Floor Roofing',
      contactsTouched: OPT_OUT_ALARM_MIN_CONTACTS,
      contactsOptedOut: 1,
    });
    const atThreshold = counts({
      tenantId: '00000000-0000-4000-8000-000000000011',
      tenantName: 'Gable Glazing',
      contactsTouched: 20,
      contactsOptedOut: 1,
    });

    const section = buildOptOutSection([atFloor, atThreshold].map(metricsFor));
    expect(section!.lines).toEqual([
      'Floor Roofing: 10.0% (1 of 10 contacts) in the last 30 days.',
      'Gable Glazing: 5.0% (1 of 20 contacts) in the last 30 days.',
    ]);
  });

  it('emits nothing that could be a contact, for a fixture of contacts', () => {
    const section = buildOptOutSection([ZED, ACE].map(metricsFor));
    const rendered = [section!.heading, ...section!.lines].join('\n');

    expect(rendered).not.toContain('@');
    expect(rendered).not.toContain('+61');
    // The client NAME is the only variable text; everything else is a closed
    // vocabulary of integers and fixed words. Letters, digits, spaces and the
    // seven punctuation marks the copy uses — nothing that could begin an
    // address, a number or a URL.
    expect(rendered).toMatch(/^[A-Za-z0-9 %:().,'\-\n]+$/);
    expect(rendered).not.toMatch(/[+<>[\]{}]/);
  });
});

describe('the section cannot carry customer data or a second threshold (source)', () => {
  /**
   * COMMENTS AND IMPORT LINES STRIPPED — the established source-assertion idiom
   * (stall-tick's `code()`), one step further.
   *
   * This file's own prose explains the rules it is being checked against, and
   * `@/core/...` module specifiers are full of `@`. Scanning them would make
   * the assertions unwritable, or (worse) make the author delete the
   * explanation to get the test green. What is asserted is the CODE.
   */
  const source = readFileSync('src/core/reporting/opt-out-section.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .replace(/^\s*\} from '[^']+';$/gm, '');

  it('names no address, body or contact column', () => {
    // The accessor it reads cannot return one — this is the belt: a future
    // edit that widened `TenantMetricCounts` could not quietly render one here
    // without failing this line first.
    expect(source).not.toContain('@');
    expect(source).not.toContain('+61');
    expect(source).not.toMatch(/\baddress\b/i);
    expect(source).not.toMatch(/\bbody\b/i);
  });

  it('applies the ONE predicate and writes no threshold of its own', () => {
    expect(source).toContain('isOptOutAlarming');
    expect(source).toContain('OPT_OUT_ALARM_BP');
    // The heading's `5` is DERIVED. A literal here is how the email and the
    // badge come to disagree about what "above" means.
    expect(source).not.toMatch(/above 5%/);
    expect(source).not.toMatch(/\b0\.05\b/);
  });
});
