/**
 * THE CLOSED VOCABULARY, ASSERTED BYTE-VERBATIM (CON-04, T-2-02/T-2-16).
 *
 * An email is the one output of this system that leaves it unencrypted,
 * unlogged and unrecallable. The rows these two builders count are attached to
 * a customer's name, their mobile number, their address and a draft written
 * about their job — and none of those four things has an argument through which
 * it could reach either function.
 *
 * That claim is only worth anything if it is checked against the exact string,
 * so these tests compare whole bodies rather than asserting `toContain`. A
 * `toContain` suite passes cheerfully on a body that grew a fifth line naming a
 * customer, which is precisely the regression this file exists to catch.
 *
 * PURE. Every input is a literal, `at` and `queueUrl` are injected, and the
 * Resend path is never reached — its coverage boundary is the source assertion
 * at the bottom, the same one `sync-failure-alerts.test.ts` draws.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { STALL_THRESHOLD_HOURS } from '@/core/aging/stall-policy';
import {
  buildDailyDigest,
  buildStalledAlert,
  dailyDigestSubject,
  stalledAlertSubject,
  totalOf,
} from '@/core/alerts/stalled-drafts';

const AT = new Date('2026-09-01T06:30:00.000Z');
const URL = 'https://console.example.com/queue';

/** Everything a real caller would have that must NOT appear in a body. */
const FORBIDDEN = [
  'Dave',
  '+61491570156',
  '12 Example St',
  'Just following up on the quote',
  'a1b2c3d4',
];

describe('buildStalledAlert', () => {
  it('renders the two-client body verbatim', () => {
    const { subject, body } = buildStalledAlert({
      perTenantCounts: [
        { tenantName: 'Northside Electrical', count: 1 },
        { tenantName: 'Acme Plumbing', count: 2 },
      ],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
    });

    expect(subject).toBe('3 drafts stalled — send slots at risk');
    expect(body).toBe(
      [
        '3 unapproved messages are inside 4h of their send slot or already past it.',
        '',
        // Largest first: the client to open is the first line, not whichever
        // tenant id sorted low.
        'Acme Plumbing: 2',
        'Northside Electrical: 1',
        '',
        'Detected: 2026-09-01 06:30:00 UTC',
        '',
        'Open the queue: https://console.example.com/queue',
        '',
      ].join('\n'),
    );
  });

  it('renders the singular body verbatim — three agreements resolved together', () => {
    const { subject, body } = buildStalledAlert({
      perTenantCounts: [{ tenantName: 'Acme Plumbing', count: 1 }],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
    });

    expect(subject).toBe('1 draft stalled — send slots at risk');
    expect(body).toBe(
      [
        '1 unapproved message is inside 4h of its send slot or already past it.',
        '',
        'Acme Plumbing: 1',
        '',
        'Detected: 2026-09-01 06:30:00 UTC',
        '',
        'Open the queue: https://console.example.com/queue',
        '',
      ].join('\n'),
    );
  });

  it('defaults the threshold to the ONE shared constant', () => {
    const { body } = buildStalledAlert({
      perTenantCounts: [{ tenantName: 'Acme Plumbing', count: 1 }],
      at: AT,
      queueUrl: URL,
    });

    expect(body).toContain(`inside ${STALL_THRESHOLD_HOURS}h of its send slot`);
  });

  it('does not throw on an empty input — it renders the honest zero', () => {
    expect(() =>
      buildStalledAlert({ perTenantCounts: [], thresholdHours: 4, at: AT, queueUrl: URL }),
    ).not.toThrow();

    const { subject, body } = buildStalledAlert({
      perTenantCounts: [],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
    });

    expect(subject).toBe('0 drafts stalled — send slots at risk');
    expect(body).toBe(
      [
        '0 unapproved messages are inside 4h of their send slot or already past it.',
        '',
        'Detected: 2026-09-01 06:30:00 UTC',
        '',
        'Open the queue: https://console.example.com/queue',
        '',
      ].join('\n'),
    );
  });
});

describe('buildDailyDigest', () => {
  it('renders the roll-up body verbatim', () => {
    const { subject, body } = buildDailyDigest({
      perTenantCounts: [
        { tenantName: 'Acme Plumbing', count: 2 },
        { tenantName: 'Northside Electrical', count: 3 },
      ],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
    });

    expect(subject).toBe('Daily digest: 5 drafts still waiting');
    expect(body).toBe(
      [
        '5 unapproved messages are inside 4h of their send slot or already past it.',
        '',
        'Northside Electrical: 3',
        'Acme Plumbing: 2',
        '',
        'As at 2026-09-01 06:30:00 UTC',
        '',
        'Open the queue: https://console.example.com/queue',
        '',
      ].join('\n'),
    );
  });

  it('names zero honestly rather than pretending', () => {
    const { subject, body } = buildDailyDigest({
      perTenantCounts: [],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
    });

    expect(subject).toBe('Daily digest: 0 drafts still waiting');
    expect(body).toBe(
      [
        'Nothing is waiting on you — no unapproved message is inside 4h of its send slot.',
        '',
        'As at 2026-09-01 06:30:00 UTC',
        '',
        'Open the queue: https://console.example.com/queue',
        '',
      ].join('\n'),
    );
  });

  it('appends caller-owned sections in order — the 06-04 seam', () => {
    const { body } = buildDailyDigest({
      perTenantCounts: [{ tenantName: 'Acme Plumbing', count: 1 }],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
      sections: [
        { heading: 'Attestations older than 30 days:', lines: ['Acme Plumbing: 44 days'] },
      ],
    });

    expect(body).toBe(
      [
        '1 unapproved message is inside 4h of its send slot or already past it.',
        '',
        'Acme Plumbing: 1',
        '',
        'Attestations older than 30 days:',
        'Acme Plumbing: 44 days',
        '',
        'As at 2026-09-01 06:30:00 UTC',
        '',
        'Open the queue: https://console.example.com/queue',
        '',
      ].join('\n'),
    );
  });

  it('renders no section block when the caller supplies none', () => {
    const withNone = buildDailyDigest({
      perTenantCounts: [{ tenantName: 'Acme Plumbing', count: 1 }],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
    });
    const withEmpty = buildDailyDigest({
      perTenantCounts: [{ tenantName: 'Acme Plumbing', count: 1 }],
      thresholdHours: 4,
      at: AT,
      queueUrl: URL,
      sections: [],
    });

    expect(withEmpty.body).toBe(withNone.body);
  });
});

describe('the vocabulary is closed', () => {
  it('admits nothing but a name, a count, a threshold, a timestamp and a URL', () => {
    // The inputs a real caller holds are the tenant name and an integer. There
    // is no parameter here for any of the forbidden strings, so this asserts
    // the SHAPE as much as the output: adding one would be a type error at
    // every call site before it could be a leak.
    const perTenantCounts = [{ tenantName: 'Acme Plumbing', count: 2 }];

    for (const body of [
      buildStalledAlert({ perTenantCounts, at: AT, queueUrl: URL }).body,
      buildDailyDigest({ perTenantCounts, at: AT, queueUrl: URL }).body,
    ]) {
      for (const forbidden of FORBIDDEN) {
        expect(body).not.toContain(forbidden);
      }
      // The only digits in the body are the count, the threshold and the
      // timestamp — no phone number, no dollar amount, no id.
      expect(body).not.toMatch(/\d{6,}/);
    }
  });

  it('interpolates the tenant name verbatim, including punctuation', () => {
    const { body } = buildStalledAlert({
      perTenantCounts: [{ tenantName: "O'Brien & Sons Plumbing", count: 1 }],
      at: AT,
      queueUrl: URL,
    });

    expect(body).toContain("O'Brien & Sons Plumbing: 1");
  });
});

describe('subjects and totals', () => {
  it('pluralises the subject on the total, not on the client count', () => {
    expect(stalledAlertSubject(1)).toBe('1 draft stalled — send slots at risk');
    expect(stalledAlertSubject(2)).toBe('2 drafts stalled — send slots at risk');
    expect(dailyDigestSubject(1)).toBe('Daily digest: 1 draft still waiting');
    expect(dailyDigestSubject(0)).toBe('Daily digest: 0 drafts still waiting');
  });

  it('totals across clients', () => {
    expect(totalOf([])).toBe(0);
    expect(totalOf([{ tenantName: 'A', count: 3 }, { tenantName: 'B', count: 4 }])).toBe(7);
  });
});

describe('the send path — source assertions (the honest coverage boundary)', () => {
  /** Comments stripped — the established idiom; this file argues in prose. */
  const code = readFileSync('src/core/alerts/stalled-drafts.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('never imports from next/*', () => {
    expect(code).not.toMatch(/from 'next\//);
  });

  it('forwards only an error NAME, never a provider message', () => {
    expect(code).toContain("error.name ?? 'unknown_error'");
    expect(code).not.toContain('error.message');
    expect(code).not.toContain('e.message');
  });

  it('has ONE Resend send, reached through ONE exported seam (WR-09)', () => {
    expect(code.match(/emails\.send\(/g)).toHaveLength(1);

    // `resendStalledEmailSender` is the only exported VALUE that reaches it —
    // the seam both routes inject. `sendStalledDraftAlert` and `sendDailyDigest`
    // used to sit beside it as `build*` + send one-liners that NOTHING called,
    // in `src/` or in `tests/`: two extra entry points onto the live Resend path
    // that no code exercised. An unexercised route to a real send is not spare
    // capacity — its first caller is the one that finds out it was wrong.
    expect(code).toContain(
      'export const resendStalledEmailSender: StalledEmailSender = sendClosedVocabularyEmail;',
    );
    expect(code).not.toContain('export async function sendStalledDraftAlert');
    expect(code).not.toContain('export async function sendDailyDigest');
  });

  it('the routes compose the builder and the seam themselves', () => {
    // Which is the shape the injection seam exists to produce, and the reason
    // the two deleted wrappers had no callers in the first place.
    for (const route of [
      'src/app/api/internal/stalled-digest/route.ts',
      'src/core/cadence/run-tick.ts',
    ]) {
      const source = readFileSync(route, 'utf8');
      expect(source).not.toContain('sendStalledDraftAlert');
      expect(source).not.toContain('sendDailyDigest(');
    }
  });

  it('does not widen OperatorAlertKind — it is a sibling module', () => {
    expect(code).not.toContain('OperatorAlertKind');
    // The two helpers it DOES reuse rather than re-derive.
    expect(code).toContain(
      "import { consoleBaseUrl, formatAlertTimestamp } from '@/core/alerts/operator-email'",
    );
  });
});
