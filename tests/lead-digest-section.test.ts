/**
 * THE LEADS SECTION OF THE 06:30 DIGEST (Phase 13, 13-05, D-08/D-09) — the
 * closed vocabulary, asserted byte-verbatim, and the wiring that makes a
 * failed lead read cost one paragraph rather than the email.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE DIGEST IS THE OPERATOR'S EMAIL (research Open Question 5). There is  │
 * │ no tradie digest; these lines are how the operator learns which client   │
 * │ to ring. A client name, an integer, a clock time, an IANA zone and fixed │
 * │ words — no caller number and no reply body can reach a line (T-13-15).   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 2026-10 (Phase 14, 14-04, D-09) — two more lines a client can earn, from
 * one counts-only read (`countLeadResolutionsSince`): ServiceM8 jobs created
 * from leads by the operator's tap, and leads the tradie booked himself.
 * Mocked here beside the other reads; pinned byte-verbatim below.
 *
 * PURE. The builder takes literals. The wiring half mocks the eight
 * repository reads `defaultSections` makes over the REAL barrel (importOriginal
 * — nothing reaches a database: every read the digest makes is replaced), and
 * injects a spy sender, so the whole body is proven with zero HTTP calls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const countColdLeadRepliesSince = vi.fn();
const listHeldEscalationsSince = vi.fn();
// 2026-10 (14-04): the eighth read — two counts per tenant.
const countLeadResolutionsSince = vi.fn();
// 2026-10-13 (Phase 15, 15-06, D-09): the ninth read — open leads past their
// next follow-up deadline, per tenant (the SQL twin of `leadDeadlineTier`).
const countOverdueOpenLeads = vi.fn();
const forAllTenants_reportMetrics = vi.fn();
const forAllTenants_cadenceTick = vi.fn();
const forAllTenants_latestAttestations = vi.fn();
const forAllTenants_stalledTally = vi.fn();
const readConsumerBacklog = vi.fn();

vi.mock('@/db/repository', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  countColdLeadRepliesSince: (since: Date) => countColdLeadRepliesSince(since),
  listHeldEscalationsSince: (since: Date) => listHeldEscalationsSince(since),
  countLeadResolutionsSince: (since: Date) => countLeadResolutionsSince(since),
  countOverdueOpenLeads: (now: Date) => countOverdueOpenLeads(now),
  forAllTenants_reportMetrics: (window: unknown) => forAllTenants_reportMetrics(window),
  forAllTenants_cadenceTick: () => forAllTenants_cadenceTick(),
  forAllTenants_latestAttestations: (kind: string) => forAllTenants_latestAttestations(kind),
  forAllTenants_stalledTally: (boundary: Date) => forAllTenants_stalledTally(boundary),
  readConsumerBacklog: (consumer: string) => readConsumerBacklog(consumer),
}));

const { buildLeadsSection, runStalledDigest, UNKNOWN_CLIENT_NAME } = await import(
  '@/core/aging/stalled-digest'
);
// 2026-10-13 (15-06): the overdue line's link is built the way the digest
// builds its queue link — from the one console base URL.
const { consoleBaseUrl } = await import('@/core/alerts/operator-email');

const ACME = '11111111-1111-4111-8111-111111111111';
const NORTH = '22222222-2222-4222-8222-222222222222';
const GHOST = '33333333-3333-4333-8333-333333333333';

/** 06:30 Perth on Wednesday 7 Oct 2026 — the digest's own hour. */
const NOW = new Date('2026-10-06T22:30:00.000Z');

const DIRECTORY = new Map([
  [ACME, { name: 'Acme Plumbing', timezone: 'Australia/Perth' }],
  [NORTH, { name: 'Northside Electrical', timezone: 'Australia/Sydney' }],
]);

/** Everything a real caller would have that must NOT appear in a line. */
const FORBIDDEN = ['+61', '0491570156', 'no hot water since Tuesday', ACME, NORTH, GHOST];

function assertClosedVocabulary(lines: readonly string[]) {
  for (const line of lines) {
    for (const forbidden of FORBIDDEN) expect(line).not.toContain(forbidden);
    // No run of nine digits: a phone number cannot hide in a line.
    expect(line).not.toMatch(/\d{9}/);
    expect(line).not.toMatch(/\+61/);
  }
}

describe('buildLeadsSection — the pure builder', () => {
  it('is null when both inputs are empty — never an empty heading', () => {
    expect(buildLeadsSection([], [], DIRECTORY, NOW)).toBeNull();
  });

  it('is null when every input is out of range or zero', () => {
    expect(
      buildLeadsSection(
        [{ tenantId: ACME, count: 0 }],
        [{ tenantId: ACME, holdUntil: new Date(NOW.getTime() - 25 * 3_600_000) }],
        DIRECTORY,
        NOW,
      ),
    ).toBeNull();
  });

  it('renders the cold line, singular and plural, verbatim', () => {
    const section = buildLeadsSection(
      [
        { tenantId: NORTH, count: 1 },
        { tenantId: ACME, count: 3 },
      ],
      [],
      DIRECTORY,
      NOW,
    );

    expect(section).toEqual({
      heading: 'Leads',
      lines: [
        'Acme Plumbing: 3 cold lead replies in the last 24 h waiting in the inbox',
        'Northside Electrical: 1 cold lead reply in the last 24 h waiting in the inbox',
      ],
    });
  });

  it('renders the held line with the LATEST release in the client zone, singular and plural', () => {
    const section = buildLeadsSection(
      [],
      [
        // Perth opens at 07:00 (23:00Z) and 08:00 (00:00Z): the later one wins.
        { tenantId: ACME, holdUntil: new Date('2026-10-06T23:00:00.000Z') },
        { tenantId: ACME, holdUntil: new Date('2026-10-07T00:00:00.000Z') },
        // Sydney 07:30 AEDT is 20:30Z the day before.
        { tenantId: NORTH, holdUntil: new Date('2026-10-06T20:30:00.000Z') },
      ],
      DIRECTORY,
      NOW,
    );

    expect(section).toEqual({
      heading: 'Leads',
      lines: [
        'Acme Plumbing: 2 hot leads held overnight — released at 08:00 (Australia/Perth)',
        'Northside Electrical: 1 hot lead held overnight — released at 07:30 (Australia/Sydney)',
      ],
    });
  });

  it("orders by client name, a client's cold line before its held line", () => {
    const section = buildLeadsSection(
      [
        { tenantId: NORTH, count: 2 },
        { tenantId: ACME, count: 1 },
      ],
      [{ tenantId: ACME, holdUntil: new Date('2026-10-06T23:00:00.000Z') }],
      DIRECTORY,
      NOW,
    );

    expect(section?.lines).toEqual([
      'Acme Plumbing: 1 cold lead reply in the last 24 h waiting in the inbox',
      'Acme Plumbing: 1 hot lead held overnight — released at 07:00 (Australia/Perth)',
      'Northside Electrical: 2 cold lead replies in the last 24 h waiting in the inbox',
    ]);
  });

  it('names an unknown tenant with fixed words, never its id, and tells the time in UTC', () => {
    const section = buildLeadsSection(
      [{ tenantId: GHOST, count: 1 }],
      [{ tenantId: GHOST, holdUntil: new Date('2026-10-06T23:00:00.000Z') }],
      DIRECTORY,
      NOW,
    );

    expect(UNKNOWN_CLIENT_NAME).toBe('unknown client');
    expect(section?.lines).toEqual([
      'unknown client: 1 cold lead reply in the last 24 h waiting in the inbox',
      'unknown client: 1 hot lead held overnight — released at 23:00 (UTC)',
    ]);
    assertClosedVocabulary(section!.lines);
  });

  it('carries no digit run other than the counts and the clock time', () => {
    const section = buildLeadsSection(
      [
        { tenantId: ACME, count: 12 },
        { tenantId: NORTH, count: 1 },
      ],
      [{ tenantId: NORTH, holdUntil: new Date('2026-10-06T20:30:00.000Z') }],
      DIRECTORY,
      NOW,
    );

    assertClosedVocabulary(section!.lines);
    for (const line of section!.lines) {
      const runs = line.match(/\d+/g) ?? [];
      // "24" in "the last 24 h" is fixed wording; otherwise a count, or HH and MM.
      const allowed = line.includes('cold lead') ? 2 : 3;
      expect(runs.length).toBe(allowed);
    }
  });
});

describe('buildLeadsSection — the Phase 14 resolution lines (14-04, D-09)', () => {
  it("renders jobs created and booked by the tradie after the client's cold and held lines, verbatim", () => {
    const section = buildLeadsSection(
      [{ tenantId: ACME, count: 1 }],
      [{ tenantId: ACME, holdUntil: new Date('2026-10-06T23:00:00.000Z') }],
      DIRECTORY,
      NOW,
      [{ tenantId: ACME, jobsCreated: 2, bookedByTradie: 1 }],
    );

    expect(section).toEqual({
      heading: 'Leads',
      lines: [
        'Acme Plumbing: 1 cold lead reply in the last 24 h waiting in the inbox',
        'Acme Plumbing: 1 hot lead held overnight — released at 07:00 (Australia/Perth)',
        'Acme Plumbing: 2 ServiceM8 jobs created from leads in the last 24 h',
        'Acme Plumbing: 1 lead booked by the tradie in the last 24 h',
      ],
    });
  });

  it('is singular for one job and plural for several bookings', () => {
    const section = buildLeadsSection([], [], DIRECTORY, NOW, [
      { tenantId: ACME, jobsCreated: 1, bookedByTradie: 3 },
    ]);

    expect(section?.lines).toEqual([
      'Acme Plumbing: 1 ServiceM8 job created from leads in the last 24 h',
      'Acme Plumbing: 3 leads booked by the tradie in the last 24 h',
    ]);
  });

  it('renders a client that has only resolutions, ordered by name among the others', () => {
    const section = buildLeadsSection([{ tenantId: NORTH, count: 1 }], [], DIRECTORY, NOW, [
      { tenantId: ACME, jobsCreated: 0, bookedByTradie: 2 },
    ]);

    expect(section?.lines).toEqual([
      'Acme Plumbing: 2 leads booked by the tradie in the last 24 h',
      'Northside Electrical: 1 cold lead reply in the last 24 h waiting in the inbox',
    ]);
  });

  it('renders no line for a zero count, and nothing at all when every count is zero', () => {
    expect(
      buildLeadsSection([], [], DIRECTORY, NOW, [
        { tenantId: ACME, jobsCreated: 0, bookedByTradie: 0 },
      ]),
    ).toBeNull();

    expect(
      buildLeadsSection([], [], DIRECTORY, NOW, [
        { tenantId: ACME, jobsCreated: 2, bookedByTradie: 0 },
      ])?.lines,
    ).toEqual(['Acme Plumbing: 2 ServiceM8 jobs created from leads in the last 24 h']);
  });

  it('names a tenant the directory cannot name with fixed words, never its id', () => {
    const section = buildLeadsSection([], [], DIRECTORY, NOW, [
      { tenantId: GHOST, jobsCreated: 1, bookedByTradie: 1 },
    ]);

    expect(section?.lines).toEqual([
      'unknown client: 1 ServiceM8 job created from leads in the last 24 h',
      'unknown client: 1 lead booked by the tradie in the last 24 h',
    ]);
    assertClosedVocabulary(section!.lines);
  });

  it('defaults the fifth parameter — the four-argument call is unchanged', () => {
    expect(buildLeadsSection([{ tenantId: ACME, count: 2 }], [], DIRECTORY, NOW)?.lines).toEqual([
      'Acme Plumbing: 2 cold lead replies in the last 24 h waiting in the inbox',
    ]);
  });
});

/* ------------------------------------------------------------------------- *
 * The wiring: defaultSections, through runStalledDigest
 * ------------------------------------------------------------------------- */

function metricsRow(tenantId: string, tenantName: string, timezone: string) {
  return {
    tenantId,
    tenantName,
    timezone,
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
    // 2026-10 (Phase 15, 15-03): the overview's calls column, zero here.
    missedCalls: 0,
    missedCallsAfterHours: 0,
    hasDivertNumber: false,
  };
}

function spySender() {
  const sent: { subject: string; body: string }[] = [];
  return {
    sent,
    send: async (message: { subject: string; body: string }) => {
      sent.push(message);
      return { ok: true as const, id: null };
    },
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  forAllTenants_stalledTally.mockResolvedValue([]);
  readConsumerBacklog.mockResolvedValue(null);
  forAllTenants_latestAttestations.mockResolvedValue([]);
  forAllTenants_reportMetrics.mockResolvedValue([
    metricsRow(ACME, 'Acme Plumbing', 'Australia/Perth'),
  ]);
  forAllTenants_cadenceTick.mockResolvedValue([]);
  countColdLeadRepliesSince.mockResolvedValue([]);
  listHeldEscalationsSince.mockResolvedValue([]);
  countLeadResolutionsSince.mockResolvedValue([]);
  countOverdueOpenLeads.mockResolvedValue([]);
});

describe('the Leads section rides the 06:30 digest', () => {
  it('asks both reads for the last 24 hours and sends a Leads section named from the metrics rows', async () => {
    countColdLeadRepliesSince.mockResolvedValue([{ tenantId: ACME, count: 2 }]);
    listHeldEscalationsSince.mockResolvedValue([
      { tenantId: ACME, holdUntil: new Date('2026-10-06T23:00:00.000Z') },
    ]);
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    const since = new Date(NOW.getTime() - 24 * 3_600_000);
    expect(countColdLeadRepliesSince).toHaveBeenCalledWith(since);
    expect(listHeldEscalationsSince).toHaveBeenCalledWith(since);
    // Named from the rows the metrics read already returned — no extra read.
    expect(forAllTenants_cadenceTick).not.toHaveBeenCalled();

    expect(result.digestSent).toBe(1);
    expect(result.digestSkippedEmpty).toBe(0);
    const body = spy.sent[0]!.body;
    expect(body).toContain(
      [
        'Leads',
        'Acme Plumbing: 2 cold lead replies in the last 24 h waiting in the inbox',
        'Acme Plumbing: 1 hot lead held overnight — released at 07:00 (Australia/Perth)',
      ].join('\n'),
    );
    assertClosedVocabulary(body.split('\n'));
  });

  it('says nothing — no email at all — when there are no leads and nothing else', async () => {
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    expect(result.digestSkippedEmpty).toBe(1);
    expect(spy.sent).toHaveLength(0);
  });

  it('a lead read that throws logs a fixed string and the other sections still render', async () => {
    countColdLeadRepliesSince.mockRejectedValue(new Error('relation does not exist +61491570156'));
    forAllTenants_latestAttestations.mockResolvedValue([
      { tenantName: 'Acme Plumbing', attestedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    expect(consoleError).toHaveBeenCalledWith('[stalled-digest] lead reads failed');
    for (const call of consoleError.mock.calls) {
      expect(call).toHaveLength(1);
      expect(String(call[0])).not.toContain('+61');
    }
    expect(result.digestSent).toBe(1);
    const body = spy.sent[0]!.body;
    expect(body).toContain('ServiceM8 automation checks due:');
    expect(body).not.toContain('Leads');
  });

  it('a failed metrics read falls back to the tick tenant list for names, once', async () => {
    forAllTenants_reportMetrics.mockRejectedValue(new Error('boom'));
    forAllTenants_cadenceTick.mockResolvedValue([
      { tenantId: NORTH, name: 'Northside Electrical', timezone: 'Australia/Sydney' },
    ]);
    countColdLeadRepliesSince.mockResolvedValue([{ tenantId: NORTH, count: 1 }]);
    const spy = spySender();

    await runStalledDigest({ now: NOW, send: spy.send });

    expect(consoleError).toHaveBeenCalledWith('[stalled-digest] opt-out metrics read failed');
    expect(forAllTenants_cadenceTick).toHaveBeenCalledTimes(1);
    expect(spy.sent[0]!.body).toContain(
      'Northside Electrical: 1 cold lead reply in the last 24 h waiting in the inbox',
    );
  });

  it('asks the resolution read for the same 24 hours and renders its two lines (14-04)', async () => {
    countLeadResolutionsSince.mockResolvedValue([
      { tenantId: ACME, jobsCreated: 2, bookedByTradie: 1 },
    ]);
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    const since = new Date(NOW.getTime() - 24 * 3_600_000);
    expect(countLeadResolutionsSince).toHaveBeenCalledWith(since);
    expect(countColdLeadRepliesSince).toHaveBeenCalledWith(since);
    expect(forAllTenants_cadenceTick).not.toHaveBeenCalled();
    expect(result.digestSent).toBe(1);
    const body = spy.sent[0]!.body;
    expect(body).toContain(
      [
        'Leads',
        'Acme Plumbing: 2 ServiceM8 jobs created from leads in the last 24 h',
        'Acme Plumbing: 1 lead booked by the tradie in the last 24 h',
      ].join('\n'),
    );
    assertClosedVocabulary(body.split('\n'));
  });

  it('a resolution read that throws costs the Leads paragraph, not the email (14-04)', async () => {
    countColdLeadRepliesSince.mockResolvedValue([{ tenantId: ACME, count: 2 }]);
    countLeadResolutionsSince.mockRejectedValue(new Error('column does not exist +61491570156'));
    forAllTenants_latestAttestations.mockResolvedValue([
      { tenantName: 'Acme Plumbing', attestedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    expect(consoleError).toHaveBeenCalledWith('[stalled-digest] lead reads failed');
    for (const call of consoleError.mock.calls) {
      expect(String(call[0])).not.toContain('+61');
    }
    expect(result.digestSent).toBe(1);
    const body = spy.sent[0]!.body;
    expect(body).toContain('ServiceM8 automation checks due:');
    expect(body).not.toContain('Leads');
  });

  it('a tenant only the resolution read names triggers the tick-list name fallback (14-04)', async () => {
    countLeadResolutionsSince.mockResolvedValue([
      { tenantId: NORTH, jobsCreated: 0, bookedByTradie: 1 },
    ]);
    forAllTenants_cadenceTick.mockResolvedValue([
      { tenantId: NORTH, name: 'Northside Electrical', timezone: 'Australia/Sydney' },
    ]);
    const spy = spySender();

    await runStalledDigest({ now: NOW, send: spy.send });

    expect(forAllTenants_cadenceTick).toHaveBeenCalledTimes(1);
    expect(spy.sent[0]!.body).toContain(
      'Northside Electrical: 1 lead booked by the tradie in the last 24 h',
    );
  });

  it('the section sits after attestation drift', async () => {
    countColdLeadRepliesSince.mockResolvedValue([{ tenantId: ACME, count: 1 }]);
    forAllTenants_latestAttestations.mockResolvedValue([
      { tenantName: 'Acme Plumbing', attestedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    const spy = spySender();

    await runStalledDigest({ now: NOW, send: spy.send });

    const body = spy.sent[0]!.body;
    expect(body.indexOf('ServiceM8 automation checks due:')).toBeGreaterThan(-1);
    expect(body.indexOf('Leads')).toBeGreaterThan(body.indexOf('ServiceM8 automation checks due:'));
  });
});

/* ------------------------------------------------------------------------- *
 * 2026-10-13 (Phase 15, 15-06, D-09): the overdue-leads line
 * ------------------------------------------------------------------------- */

describe('2026-10-13 (15-06): the overdue line — first per client (D-09)', () => {
  it('renders FIRST among the client lines, plural, with the lead-queue link', () => {
    const section = buildLeadsSection(
      [{ tenantId: ACME, count: 2 }],
      [],
      DIRECTORY,
      NOW,
      [{ tenantId: ACME, jobsCreated: 1, bookedByTradie: 0 }],
      [{ tenantId: ACME, count: 2 }],
    );

    expect(section?.lines).toEqual([
      `Acme Plumbing: 2 open leads past their next follow-up deadline — open the lead queue: ${consoleBaseUrl()}/leads`,
      'Acme Plumbing: 2 cold lead replies in the last 24 h waiting in the inbox',
      'Acme Plumbing: 1 ServiceM8 job created from leads in the last 24 h',
    ]);
    assertClosedVocabulary(section!.lines);
  });

  it('singular: one open lead past ITS deadline', () => {
    expect(
      buildLeadsSection([], [], DIRECTORY, NOW, [], [{ tenantId: NORTH, count: 1 }])?.lines,
    ).toEqual([
      `Northside Electrical: 1 open lead past its next follow-up deadline — open the lead queue: ${consoleBaseUrl()}/leads`,
    ]);
  });

  it('adds no line for a zero, negative or non-integer count', () => {
    expect(
      buildLeadsSection(
        [],
        [],
        DIRECTORY,
        NOW,
        [],
        [
          { tenantId: ACME, count: 0 },
          { tenantId: NORTH, count: -3 },
          { tenantId: GHOST, count: 1.5 },
        ],
      ),
    ).toBeNull();
  });

  it('is null when every input is empty, overdue included', () => {
    expect(buildLeadsSection([], [], DIRECTORY, NOW, [], [])).toBeNull();
  });

  it('with ONLY an overdue count the section is non-null and holds that one line', () => {
    const section = buildLeadsSection([], [], DIRECTORY, NOW, [], [{ tenantId: ACME, count: 3 }]);
    expect(section?.heading).toBe('Leads');
    expect(section?.lines).toHaveLength(1);
    expect(section?.lines[0]).toContain('Acme Plumbing: 3 open leads past their next follow-up deadline');
  });

  it('names an unknown tenant with the fixed words, never the id', () => {
    const section = buildLeadsSection([], [], DIRECTORY, NOW, [], [{ tenantId: GHOST, count: 1 }]);
    expect(section?.lines[0]).toContain(`${UNKNOWN_CLIENT_NAME}: 1 open lead past its`);
    assertClosedVocabulary(section!.lines);
  });
});

describe('2026-10-13 (15-06): the overdue read rides the Leads try (D-09)', () => {
  it('is asked once with NOW, beside the other lead reads, and its line leads the section', async () => {
    countOverdueOpenLeads.mockResolvedValue([{ tenantId: ACME, count: 2 }]);
    countColdLeadRepliesSince.mockResolvedValue([{ tenantId: ACME, count: 1 }]);
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    expect(countOverdueOpenLeads).toHaveBeenCalledTimes(1);
    expect(countOverdueOpenLeads).toHaveBeenCalledWith(NOW);
    expect(countColdLeadRepliesSince).toHaveBeenCalledTimes(1);
    expect(forAllTenants_cadenceTick).not.toHaveBeenCalled();
    expect(result.digestSent).toBe(1);
    const body = spy.sent[0]!.body;
    expect(body).toContain(
      [
        'Leads',
        `Acme Plumbing: 2 open leads past their next follow-up deadline — open the lead queue: ${consoleBaseUrl()}/leads`,
        'Acme Plumbing: 1 cold lead reply in the last 24 h waiting in the inbox',
      ].join('\n'),
    );
    assertClosedVocabulary(body.split('\n'));
  });

  it('an overdue read that throws costs the Leads paragraph, not the email', async () => {
    countColdLeadRepliesSince.mockResolvedValue([{ tenantId: ACME, count: 2 }]);
    countOverdueOpenLeads.mockRejectedValue(new Error('column does not exist +61491570156'));
    forAllTenants_latestAttestations.mockResolvedValue([
      { tenantName: 'Acme Plumbing', attestedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    expect(consoleError).toHaveBeenCalledWith('[stalled-digest] lead reads failed');
    for (const call of consoleError.mock.calls) {
      expect(String(call[0])).not.toContain('+61');
    }
    expect(result.digestSent).toBe(1);
    const body = spy.sent[0]!.body;
    expect(body).toContain('ServiceM8 automation checks due:');
    expect(body).not.toContain('Leads');
  });

  it('a tenant only the overdue read names triggers the tick-list name fallback', async () => {
    countOverdueOpenLeads.mockResolvedValue([{ tenantId: NORTH, count: 1 }]);
    forAllTenants_cadenceTick.mockResolvedValue([
      { tenantId: NORTH, name: 'Northside Electrical', timezone: 'Australia/Sydney' },
    ]);
    const spy = spySender();

    await runStalledDigest({ now: NOW, send: spy.send });

    expect(forAllTenants_cadenceTick).toHaveBeenCalledTimes(1);
    expect(spy.sent[0]!.body).toContain(
      'Northside Electrical: 1 open lead past its next follow-up deadline — open the lead queue:',
    );
  });

  it('zero overdue everywhere and nothing else: no email at all (the empty-digest rule)', async () => {
    countOverdueOpenLeads.mockResolvedValue([{ tenantId: ACME, count: 0 }]);
    const spy = spySender();

    const result = await runStalledDigest({ now: NOW, send: spy.send });

    expect(result.digestSkippedEmpty).toBe(1);
    expect(spy.sent).toHaveLength(0);
  });
});
