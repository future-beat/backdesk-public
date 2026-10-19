/**
 * THE CLIENT DIVERT ONBOARDING RUNBOOK, AS A TEST (COMP-03, D-12).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The operator runs docs/client-divert-onboarding-runbook.md sitting with  │
 * │ one client and their handset. A wrong code diverts a business's calls    │
 * │ wrongly; a missing "do not arm" sends texts on a carrier that strips the │
 * │ caller; the iPhone switch sends EVERY call to the greeting. Each of those│
 * │ is a sentence in the runbook, so each is pinned here.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The runbook-contract mould (tests/runbook-contract.test.ts): PRESENCE, not
 * prose, plus three ORDER checks, because the order of this runbook is its
 * safety (own lines before the verification call, the verification call
 * before arming, text-back off before the diverts come off). Whether the
 * divert codes are right for a given carrier is NOT something this suite can
 * know: that is proved per client by the diverted verification call the
 * runbook requires (11-08 override).
 *
 * The labels are copied in, not read from the component, so a rename in one
 * place without the other goes red. The four text-back checklist labels and
 * the two text-back control labels live in `checklist-card.tsx` since 12-08,
 * and the cross-check at the end of this file reads the card for them.
 *
 * PURE. Two `readFileSync`s: the runbook and the card's source. Runs bare,
 * with NO ALLOW_REMOTE_TESTS, no database and no network.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RUNBOOK_PATH = 'docs/client-divert-onboarding-runbook.md';
const RUNBOOK = readFileSync(RUNBOOK_PATH, 'utf8');
const CARD_PATH = 'src/app/(console)/clients/[id]/checklist-card.tsx';
const CARD = readFileSync(CARD_PATH, 'utf8');

/** The three set codes, the three cancels, and the check (D-12). */
const DIVERT_CODES = [
  '**61*<divert number>#',
  '**62*<divert number>#',
  '**67*<divert number>#',
  '##61#',
  '##62#',
  '##67#',
  '*#61#',
] as const;

/** The D-12 safety phrases: each one is a way a client gets hurt if absent. */
const SAFETY_PHRASES = [
  'Call Forwarding',
  'UNCONDITIONAL',
  'second phone',
  'caller_present',
  'DO NOT ARM',
  'never released',
  'carrier',
  'voicemail',
  'prepaid',
] as const;

/**
 * The checklist rows the runbook sends the operator to: the two divert rows
 * and "SMS armed" from `ITEM_LABELS` today, and the four text-back rows plan
 * 12-08 adds verbatim.
 */
const CHECKLIST_LABELS = [
  'Divert number provisioned',
  'Verification call recorded',
  'SMS armed',
  'Text-back templates attested',
  'Own numbers on the never-text list',
  'Text-back armed',
  'Text-back proof recorded',
] as const;

/** The two text-back controls (12-08) and the text-back page's own labels (12-06). */
const CONTROL_LABELS = [
  'Turn text-back on for this client',
  'Turn text-back off for this client',
  'Save version',
  'Attest this wording',
  'Never text',
] as const;

/** Every command the runbook tells the operator to run; each is an npm alias. */
const COMMANDS = [
  'npm run missed-calls:recent',
  'npm run text-back:timing',
  'npm run clicksend:balance',
] as const;

/** The limits the operator will see working, stated as numbers (COMP-03 boundary). */
const LIMITS = ['24 hours', '10 minutes', '30 texts', 'A$5', 'A$20'] as const;

/** The two read-back lines the timing reader prints, used as checks here. */
const READ_BACKS = ['text_back_armed=true', 'text_back_armed=false'] as const;

describe('divert runbook: the codes (D-12)', () => {
  it.each(DIVERT_CODES)('carries %s', (code) => {
    expect(RUNBOOK).toContain(code);
  });

  it('carries every cancel code in the offboarding section as well as the table', () => {
    const offboarding = RUNBOOK.slice(RUNBOOK.indexOf('## 10. Offboarding'));

    for (const cancel of ['##61#', '##62#', '##67#']) expect(offboarding).toContain(cancel);
  });
});

describe('divert runbook: the safety phrases', () => {
  it.each(SAFETY_PHRASES)('carries %s', (phrase) => {
    expect(RUNBOOK).toContain(phrase);
  });

  it('never tells the operator to dial the Backdesk number for the verification call', () => {
    expect(RUNBOOK).toContain('Never dial the Backdesk number directly');
  });
});

describe('divert runbook: the console labels it sends the operator to', () => {
  it.each(CHECKLIST_LABELS)('names the checklist row %s', (label) => {
    expect(RUNBOOK).toContain(label);
  });

  it.each(CONTROL_LABELS)('names the control %s', (label) => {
    expect(RUNBOOK).toContain(label);
  });
});

describe('divert runbook: the commands and the read-backs', () => {
  it.each(COMMANDS)('names %s', (command) => {
    expect(RUNBOOK).toContain(command);
  });

  it.each(READ_BACKS)('uses the read-back line %s as a check', (line) => {
    expect(RUNBOOK).toContain(line);
  });
});

describe('divert runbook: the limits, as numbers', () => {
  it.each(LIMITS)('states %s', (limit) => {
    expect(RUNBOOK).toContain(limit);
  });
});

/**
 * ORDER is the safety of this runbook, so it is asserted on the headings, not
 * on the first mention of a word anywhere (a summary paragraph near the top
 * would otherwise satisfy it).
 */
describe('divert runbook: order', () => {
  const at = (heading: string) => {
    const index = RUNBOOK.indexOf(heading);

    expect(index, `missing heading: ${heading}`).toBeGreaterThan(-1);
    return index;
  };

  it('puts the never-text list before the verification call', () => {
    expect(at('## 1. The never-text list')).toBeLessThan(at('## 6. The DIVERTED verification call'));
  });

  it('puts the verification call before turning text-back on', () => {
    expect(at('## 6. The DIVERTED verification call')).toBeLessThan(at('## 7. Turn text-back on'));
  });

  it('in offboarding, turns text-back off before removing the diverts, then confirms, then keeps the number', () => {
    const off = at('### 10.1 Turn text-back off');
    const remove = at('### 10.2 Remove all three diverts');
    const confirm = at('### 10.3 Confirm a test call rings out normally');
    const keep = at('### 10.4 Keep the number');

    expect(off).toBeLessThan(remove);
    expect(remove).toBeLessThan(confirm);
    expect(confirm).toBeLessThan(keep);
  });

  it('puts DO NOT ARM inside the verification-call section, before arming', () => {
    const doNotArm = RUNBOOK.indexOf('DO NOT ARM');

    expect(doNotArm).toBeGreaterThan(at('## 6. The DIVERTED verification call'));
    expect(doNotArm).toBeLessThan(at('## 7. Turn text-back on'));
  });
});

describe('divert runbook: shape', () => {
  it('has at least twelve ## sections', () => {
    expect((RUNBOOK.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it('points at the two-column artefact tables', () => {
    expect(RUNBOOK).toContain('Artefact that proves it');
  });

  it('ends its evidence template with the no-number line', () => {
    expect(RUNBOOK).toContain('No caller number and no secret value appears above.');
  });

  it('uses no em dash (plain Australian, the house rule)', () => {
    expect(RUNBOOK).not.toContain('—');
  });
});

/**
 * NO NUMBER AND NO CREDENTIAL EVER LANDS HERE.
 *
 * The runbook and its evidence template are written beside a client's handset
 * with the divert number on screen. These are the shapes that would matter: a
 * 64-hex secret, a Twilio sid (AC, PN or BU and 32 hex), and an AU number in
 * E.164. Placeholders like `<divert number>` are fine; values are not.
 */
describe('divert runbook: no number and no credential shape', () => {
  it('contains no 64-hex run', () => {
    expect(RUNBOOK).not.toMatch(/[0-9a-f]{64}/i);
  });

  it('contains no Twilio sid shape', () => {
    expect(RUNBOOK).not.toMatch(/\b(AC|PN|BU)[0-9a-f]{32}\b/);
  });

  it('contains no AU number in E.164', () => {
    expect(RUNBOOK).not.toMatch(/\+61\s?\d{9}/);
  });
});

/**
 * THE RUNBOOK AND THE CARD MUST NOT DRIFT (12-08). The operator reads a label
 * in the runbook and looks for it on the "Ready to send?" card; a rename in one
 * and not the other is a mid-onboarding dead end with a tradie waiting.
 */
describe('divert runbook: the card carries the text-back labels verbatim (12-08)', () => {
  const TEXT_BACK_CHECKLIST_LABELS = [
    'Text-back templates attested',
    'Own numbers on the never-text list',
    'Text-back armed',
    'Text-back proof recorded',
  ] as const;
  const TEXT_BACK_CONTROL_LABELS = [
    'Turn text-back on for this client',
    'Turn text-back off for this client',
  ] as const;

  it.each(TEXT_BACK_CHECKLIST_LABELS)("the card's ITEM_LABELS carry '%s'", (label) => {
    expect(CARD).toContain(`'${label}'`);
    expect(RUNBOOK).toContain(label);
  });

  it.each(TEXT_BACK_CONTROL_LABELS)('the card renders the control "%s"', (label) => {
    expect(CARD).toContain(`"${label}"`);
    expect(RUNBOOK).toContain(label);
  });

  it('offers no every-client text-back control', () => {
    expect(CARD).not.toMatch(/channel: 'text_back', (target|scope): 'everyone'/);
  });
});
