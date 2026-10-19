/**
 * D-04: which human a cadence talks to, decided once and identically every time.
 *
 * A ServiceM8 job can carry a JOB contact, a BILLING contact and a property
 * manager, and only one of them is the person who asked for the quote. Getting
 * this wrong is not a scheduling bug — it is a follow-up sent to a real estate
 * agency about a homeowner's bathroom, in the tradie's name, which is exactly
 * the failure that loses a design partner.
 *
 * TWO PROPERTIES ARE PINNED HERE:
 *
 *   TOTAL AND DETERMINISTIC. The rule reads contact_type (case-insensitively),
 *   then channel usability, then the lowest sm8_contact_uuid. That final
 *   tie-break exists so that shuffling the input list — which a repository
 *   query is free to do, because a query without ORDER BY has no order —
 *   cannot change who gets messaged.
 *
 *   NULL IS AN ANSWER. A quote whose contacts are all unusable returns null and
 *   goes to operator triage. It never returns a best guess: an SMS to a
 *   landline is silently lost, and an email to a malformed address bounces
 *   against the client's own sending domain.
 *
 * Note what is NOT read: `is_primary_contact`. ServiceM8 marks it deprecated
 * and the Phase 2 schema header records the decision not to mirror it.
 *
 * Pure: no database, no network, no ALLOW_REMOTE_TESTS gate.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  normalizeAuMobile,
  normalizeEmail,
  selectPrimaryContact,
  type SelectableContact,
} from '@/core/cadence/primary-contact';

/** Sorted uuids, so the tie-break direction is readable in each test. */
const UUID_A = '0a000000-0000-4000-8000-000000000001';
const UUID_B = '5b000000-0000-4000-8000-000000000002';
const UUID_C = 'f0000000-0000-4000-8000-000000000003';

function contact(overrides: Partial<SelectableContact> = {}): SelectableContact {
  return {
    sm8ContactUuid: UUID_A,
    first: 'Dana',
    last: 'Reid',
    mobile: '0412345678',
    phone: null,
    email: 'dana@example.com',
    contactType: 'JOB',
    sm8Active: true,
    ...overrides,
  };
}

describe('normalizeAuMobile — Pattern 7 normalization', () => {
  it('turns a spaced local mobile into E.164', () => {
    expect(normalizeAuMobile('04 12 345 678')).toBe('+61412345678');
  });

  it.each([
    ['0412345678', '+61412345678'],
    ['0412 345 678', '+61412345678'],
    ['0412-345-678', '+61412345678'],
    ['(04) 1234 5678', '+61412345678'],
    ['+61 412 345 678', '+61412345678'],
    ['+61412345678', '+61412345678'],
    ['61412345678', '+61412345678'],
    ['0499999999', '+61499999999'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeAuMobile(raw)).toBe(expected);
  });

  it('passes an already-normalized number through unchanged', () => {
    expect(normalizeAuMobile('+61412345678')).toBe('+61412345678');
  });

  it.each([
    ['0893211234', 'a Perth landline'],
    ['(08) 9321 1234', 'a formatted Perth landline'],
    ['1300123456', 'a 1300 number'],
    ['+64211234567', 'a New Zealand mobile'],
    ['+14155552671', 'a US number'],
    ['041234567', 'one digit short'],
    ['04123456789', 'one digit long'],
    ['412345678', 'a mobile missing its leading zero'],
    ['not a phone', 'free text'],
    ['', 'an empty string'],
    ['   ', 'whitespace'],
  ])('returns null for %j (%s)', (raw) => {
    expect(normalizeAuMobile(raw)).toBeNull();
  });

  it('returns null for null and undefined rather than throwing at a call site', () => {
    expect(normalizeAuMobile(null)).toBeNull();
    expect(normalizeAuMobile(undefined)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Dana.Reid@Example.COM  ')).toBe('dana.reid@example.com');
  });

  it.each(['', '   ', 'dana', 'dana@', '@example.com', 'dana@example', 'da na@example.com'])(
    'returns null for %j',
    (raw) => {
      expect(normalizeEmail(raw)).toBeNull();
    },
  );

  it('returns null for null and undefined', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('selectPrimaryContact — contact_type precedence', () => {
  it('prefers JOB over BILLING', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, contactType: 'BILLING' }),
      contact({ sm8ContactUuid: UUID_B, contactType: 'JOB' }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_B);
  });

  it('prefers BILLING over a property manager', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, contactType: 'Property Manager' }),
      contact({ sm8ContactUuid: UUID_B, contactType: 'BILLING' }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_B);
  });

  it('prefers a property manager over an untyped contact', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, contactType: null }),
      contact({ sm8ContactUuid: UUID_B, contactType: 'Property Manager' }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_B);
  });

  it.each(['JOB', 'job', 'Job', ' jOb '])(
    'matches contact_type %j case-insensitively — upstream case varies',
    (raw) => {
      const chosen = selectPrimaryContact([
        contact({ sm8ContactUuid: UUID_A, contactType: 'BILLING' }),
        contact({ sm8ContactUuid: UUID_B, contactType: raw }),
      ]);

      expect(chosen?.sm8ContactUuid).toBe(UUID_B);
    },
  );

  it('matches a property manager whatever the spacing and case', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, contactType: 'Site Supervisor' }),
      contact({ sm8ContactUuid: UUID_B, contactType: 'property manager' }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_B);
  });
});

describe('selectPrimaryContact — channel usability inside a tier', () => {
  it('prefers a usable mobile over an email-only contact of the same type', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, mobile: null, phone: null, email: 'a@example.com' }),
      contact({ sm8ContactUuid: UUID_B, mobile: '0412345678', email: null }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_B);
    expect(chosen?.mobile).toBe('+61412345678');
  });

  it('does NOT let a usable mobile beat a higher contact_type tier', () => {
    // Type precedence dominates channel preference: the billing contact with a
    // mobile does not outrank the JOB contact we can email.
    const chosen = selectPrimaryContact([
      contact({
        sm8ContactUuid: UUID_A,
        contactType: 'BILLING',
        mobile: '0412345678',
        email: null,
      }),
      contact({
        sm8ContactUuid: UUID_B,
        contactType: 'JOB',
        mobile: null,
        phone: null,
        email: 'job@example.com',
      }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_B);
    expect(chosen?.mobile).toBeNull();
    expect(chosen?.email).toBe('job@example.com');
  });

  it('reads a mobile-shaped number out of the phone column when mobile is empty', () => {
    // ServiceM8 does not police which column a tradie types the number into,
    // and `normalizeAuMobile` only ever accepts mobile shapes — a landline in
    // `phone` still normalizes to null, so this is a fallback, not a guess.
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, mobile: null, phone: '0412 345 678' }),
    ]);

    expect(chosen?.mobile).toBe('+61412345678');
  });

  it('does not promote a landline sitting in the phone column', () => {
    const chosen = selectPrimaryContact([
      contact({
        sm8ContactUuid: UUID_A,
        mobile: null,
        phone: '(08) 9321 1234',
        email: 'a@example.com',
      }),
    ]);

    expect(chosen?.mobile).toBeNull();
    expect(chosen?.email).toBe('a@example.com');
  });
});

describe('selectPrimaryContact — the deterministic tie-break', () => {
  it('takes the lowest sm8_contact_uuid when tier and channel are equal', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_C }),
      contact({ sm8ContactUuid: UUID_A }),
      contact({ sm8ContactUuid: UUID_B }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_A);
  });

  it('returns the same contact whatever order the repository happened to return', () => {
    // A query without ORDER BY has no order. If input order could change the
    // answer, the recipient could change between two ticks.
    const rows = [
      contact({ sm8ContactUuid: UUID_C, contactType: 'BILLING' }),
      contact({ sm8ContactUuid: UUID_A, contactType: 'Property Manager' }),
      contact({ sm8ContactUuid: UUID_B, contactType: 'BILLING' }),
    ];

    const permutations = [
      [rows[0], rows[1], rows[2]],
      [rows[2], rows[0], rows[1]],
      [rows[1], rows[2], rows[0]],
      [...rows].reverse(),
    ];

    for (const order of permutations) {
      expect(selectPrimaryContact(order)?.sm8ContactUuid).toBe(UUID_B);
    }
  });
});

describe('selectPrimaryContact — exclusions and the honest null', () => {
  it('excludes a contact deleted upstream (sm8_active false)', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, contactType: 'JOB', sm8Active: false }),
      contact({ sm8ContactUuid: UUID_B, contactType: 'BILLING' }),
    ]);

    expect(chosen?.sm8ContactUuid).toBe(UUID_B);
  });

  it('returns null for an empty contact list', () => {
    expect(selectPrimaryContact([])).toBeNull();
  });

  it('returns null when every contact is unusable — operator triage, never a guess', () => {
    const chosen = selectPrimaryContact([
      contact({ sm8ContactUuid: UUID_A, mobile: '0893211234', phone: null, email: null }),
      contact({ sm8ContactUuid: UUID_B, mobile: null, phone: null, email: 'not-an-email' }),
      contact({ sm8ContactUuid: UUID_C, mobile: '   ', phone: '', email: '  ' }),
    ]);

    expect(chosen).toBeNull();
  });

  it('returns null when the only usable contact was deleted upstream', () => {
    expect(
      selectPrimaryContact([
        contact({ sm8ContactUuid: UUID_A, sm8Active: false }),
        contact({ sm8ContactUuid: UUID_B, mobile: null, phone: null, email: null }),
      ]),
    ).toBeNull();
  });

  it('treats a missing sm8Active as active — the column defaults to true', () => {
    const chosen = selectPrimaryContact([{ sm8ContactUuid: UUID_A, mobile: '0412345678' }]);
    expect(chosen?.sm8ContactUuid).toBe(UUID_A);
  });
});

describe('selectPrimaryContact — the returned snapshot', () => {
  it('returns normalized addresses, not the raw ServiceM8 strings', () => {
    const chosen = selectPrimaryContact([
      contact({ mobile: '04 12 345 678', email: '  Dana.Reid@Example.COM ' }),
    ]);

    expect(chosen).toEqual({
      sm8ContactUuid: UUID_A,
      name: 'Dana Reid',
      mobile: '+61412345678',
      email: 'dana.reid@example.com',
    });
  });

  it('assembles a name from whichever parts exist', () => {
    expect(selectPrimaryContact([contact({ first: 'Dana', last: null })])?.name).toBe('Dana');
    expect(selectPrimaryContact([contact({ first: null, last: 'Reid' })])?.name).toBe('Reid');
    expect(selectPrimaryContact([contact({ first: '  ', last: null })])?.name).toBeNull();
  });

  it('nulls the unusable channel rather than passing an unsendable address on', () => {
    const chosen = selectPrimaryContact([
      contact({ mobile: '0893211234', phone: null, email: 'dana@example.com' }),
    ]);

    expect(chosen?.mobile).toBeNull();
    expect(chosen?.email).toBe('dana@example.com');
  });
});

describe('primary-contact.ts is framework-free and reads no deprecated field', () => {
  const source = readFileSync(
    new URL('../src/core/cadence/primary-contact.ts', import.meta.url),
    'utf8',
  );

  it('imports nothing from next/*', () => {
    expect(source).not.toMatch(/from ['"]next\//);
  });

  it('never reads isPrimaryContact — ServiceM8 marks it deprecated (Phase 2 decision)', () => {
    // The header is allowed to NAME it (recording what is deliberately absent
    // is this codebase's house style); reading it as a property is not.
    expect(source).not.toMatch(/\.\s*isPrimaryContact/);
    expect(source).not.toMatch(/\bis_primary_contact\s*[:=]/);
  });
});
