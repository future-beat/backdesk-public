/**
 * THE TEXT-BACK ARMING GATE, AS A TABLE (Phase 12, 12-08, TXT-05, D-09/D-15).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Text-back may be armed for ONE client only when ten things are true, in  │
 * │ checklist order. This suite pins the list and walks it one item at a     │
 * │ time: each key, alone unmet, is the key a refusal names.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE. It imports `ARMING_GATES` and `firstUnmetGate` from
 * `src/core/onboarding/arming.ts` — a module whose only imports are types — and
 * builds every item list by hand from string keys. No database, no seed
 * helper, no checklist reader: the DB-backed derivation of these same rows is
 * pinned in tests/go-live-checklist.test.ts, which runs in CI only.
 */
import { describe, expect, it } from 'vitest';

import { ARMING_GATES, firstUnmetGate } from '../src/core/onboarding/arming';

/** The ten text-back gates, in the order the checklist renders them. */
const TEXT_BACK_GATES = [
  'sm8Connected',
  'contactHours',
  'templatesApproved',
  'sm8AutomationOff',
  'escalationPhone',
  'smsArmed',
  'divertNumber',
  'divertVerified',
  'textBackTemplates',
  'neverTextOwnNumber',
] as const;

/** Rows that are on the checklist and gate nothing for text-back. */
const NON_GATING = [
  'voiceProfile',
  'sendingDomainVerified',
  'emailArmed',
  'escalationHandsetProof',
  'emailPipeProof',
  'textBackArmed',
  'textBackProof',
] as const;

/** The keys a messaging (sms / email) gate must never borrow. */
const DIVERT_AND_TEXT_BACK_KEYS = [
  'divertNumber',
  'divertVerified',
  'textBackTemplates',
  'neverTextOwnNumber',
  'textBackArmed',
  'textBackProof',
] as const;

type Key = (typeof TEXT_BACK_GATES)[number] | (typeof NON_GATING)[number];

/** Every row present, every row satisfied except the named ones. */
function items(unmet: readonly Key[] = [], omit: readonly Key[] = []) {
  const unmetSet = new Set<string>(unmet);
  const omitSet = new Set<string>(omit);

  return [...TEXT_BACK_GATES, ...NON_GATING]
    .filter((key) => !omitSet.has(key))
    .map((key) => ({ key, satisfied: !unmetSet.has(key), detail: null }));
}

describe('ARMING_GATES.text_back (D-09, D-15)', () => {
  it('is exactly the ten keys, in checklist order', () => {
    expect([...ARMING_GATES.text_back]).toEqual([...TEXT_BACK_GATES]);
  });

  it('leaves the sms and email gates as they were, with no divert or text-back key', () => {
    expect([...ARMING_GATES.sms]).toEqual([
      'sm8Connected',
      'contactHours',
      'templatesApproved',
      'sm8AutomationOff',
      'escalationPhone',
    ]);
    expect([...ARMING_GATES.email]).toEqual([
      'sm8Connected',
      'contactHours',
      'templatesApproved',
      'sm8AutomationOff',
      'escalationPhone',
      'sendingDomainVerified',
    ]);

    for (const channel of ['sms', 'email'] as const) {
      for (const key of DIVERT_AND_TEXT_BACK_KEYS) {
        expect([...ARMING_GATES[channel]], `${channel} gate borrowed ${key}`).not.toContain(key);
      }
    }
  });

  it('never gates on the switch itself or on its proof (the D-01 circularity)', () => {
    expect([...ARMING_GATES.text_back]).not.toContain('textBackArmed');
    expect([...ARMING_GATES.text_back]).not.toContain('textBackProof');
  });
});

describe("firstUnmetGate('text_back') — one unmet item at a time (TXT-05 boundary)", () => {
  it.each(TEXT_BACK_GATES)('names %s when it alone is unmet', (key) => {
    expect(firstUnmetGate('text_back', items([key]))).toBe(key);
  });

  it.each(NON_GATING)('ignores %s — unmet, it does not refuse text-back', (key) => {
    expect(firstUnmetGate('text_back', items([key]))).toBeNull();
  });

  it('names the EARLIER of two unmet items', () => {
    expect(firstUnmetGate('text_back', items(['neverTextOwnNumber', 'smsArmed']))).toBe('smsArmed');
    expect(firstUnmetGate('text_back', items(['divertVerified', 'escalationPhone']))).toBe(
      'escalationPhone',
    );
    expect(firstUnmetGate('text_back', items(['textBackTemplates', 'divertNumber']))).toBe(
      'divertNumber',
    );
  });

  it.each(TEXT_BACK_GATES)('reads %s as unmet when it is ABSENT from the list (TXT-05 empty)', (key) => {
    expect(firstUnmetGate('text_back', items([], [key]))).toBe(key);
  });

  it('starts at sm8Connected for an empty list — never vacuously satisfied', () => {
    expect(firstUnmetGate('text_back', [])).toBe('sm8Connected');
  });

  it('returns null when all ten are met', () => {
    expect(firstUnmetGate('text_back', items())).toBeNull();
  });

  it('opens sms while text-back still waits — the gates are independent', () => {
    const list = items(['divertVerified', 'neverTextOwnNumber']);

    expect(firstUnmetGate('sms', list)).toBeNull();
    expect(firstUnmetGate('text_back', list)).toBe('divertVerified');
  });
});
