/**
 * The 06:30 roll-up (CON-04, D-11).
 *
 * ── WHY THIS IS A MODULE AND NOT THE ROUTE'S BODY ──────────────────────────
 *
 * A Next route file may export only its handlers and its segment config, so a
 * digest written inside `route.ts` could be exercised in exactly one way: by
 * constructing a `Request`, holding a real bearer, and letting it mail somebody.
 * Here it takes an injected sender and a pinned clock, and the suite proves the
 * body byte-for-byte with zero HTTP calls and zero emails — the same seam
 * `run-sync`'s `onAlert` and the tick's `sender` are, for the same reason.
 *
 * ── IT DOES NOT WRITE ANYTHING ─────────────────────────────────────────────
 *
 * No `stall_alerted_at`, no status, no counter. The digest is an OBSERVATION of
 * a set the tick already claimed; if it wrote, a missed nightly run would
 * silently change what the next morning's tick alerts on.
 *
 * ── THE LEADS SECTION IS THE OPERATOR'S VIEW OF D-08 (Phase 13) ────────────
 *
 * D-08 says "the tradie hears about cold leads in the existing 06:30 digest".
 * This digest is the OPERATOR's email (`OPERATOR_ALERT_EMAIL`); there is no
 * tradie-facing digest in the codebase and none is built here (13-RESEARCH
 * Open Question 5). The operator reads the Leads lines and tells the client —
 * nothing new is ever sent to a client's handset from this file.
 */
import { consoleBaseUrl } from '@/core/alerts/operator-email';
import {
  buildDailyDigest,
  noopStalledEmailSender,
  queueUrl,
  type DigestSection,
  type StalledEmailSender,
  totalOf,
} from '@/core/alerts/stalled-drafts';
import { stallBoundary } from '@/core/aging/stall-policy';
import { SM8_AUTOMATION_ATTESTATION_KIND } from '@/core/drafting/onboarding-gate';
import {
  attestationAgeDays,
  isAttestationStale,
} from '@/core/onboarding/checklist';
import { computeTenantMetrics, LIVE_METRICS_WINDOW_DAYS } from '@/core/reporting/metrics';
import { buildAttributionWedgeSection } from '@/core/attribution/wedge-section';
import { ATTRIBUTION_CONSUMER } from '@/core/cadence/constants';
import { buildOptOutSection } from '@/core/reporting/opt-out-section';
import { rollingWindow } from '@/core/reporting/period';
import {
  countColdLeadRepliesSince,
  countLeadResolutionsSince,
  countOverdueOpenLeads,
  forAllTenants_cadenceTick,
  forAllTenants_latestAttestations,
  forAllTenants_reportMetrics,
  forAllTenants_stalledTally,
  listHeldEscalationsSince,
  readConsumerBacklog,
} from '@/db/repository';

/**
 * The D-15 drift nag, as one digest section.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS FUNCTION WRITES NOTHING, AND NOTHING IT CALLS WRITES ANYTHING.      │
 * │ Staleness NAGS. It must never pause, never re-gate, never touch a        │
 * │ status. A calendar rolling over is not evidence a client switched their  │
 * │ ServiceM8 automation back on.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Rides `buildDailyDigest`'s `sections` seam rather than widening its parameter
 * list — the seam exists so this file's vocabulary stays this file's, and so
 * `stalled-drafts.ts` never learns about attestations (06-02's argument for the
 * seam, from its own end).
 *
 * THE VOCABULARY IS CLOSED, exactly as the counts above it are: a client name,
 * an integer, and fixed words. There is no argument through which a customer
 * name, a message body or an address could reach it — the accessor it reads
 * cannot return one.
 *
 * Staleness is derived by `isAttestationStale`, the SAME pure function the
 * checklist card renders its badge from. The threshold is written once.
 */
export function buildStaleAttestationSection(
  latest: readonly { tenantName: string; attestedAt: Date }[],
  now: Date,
): DigestSection | null {
  const lines = latest
    .filter((row) => isAttestationStale(row.attestedAt, now))
    .map(
      (row) =>
        `${row.tenantName}: ServiceM8 auto-follow-up attestation is ` +
        `${attestationAgeDays(row.attestedAt, now)} days old — re-verify and record it.`,
    );

  // NULL, not an empty section. A heading with nothing under it is a daily
  // "no drift" all-clear, which is the trained blindness this digest's own
  // empty-send rule exists to avoid.
  if (lines.length === 0) return null;

  return { heading: 'ServiceM8 automation checks due:', lines };
}

/** How far back the Leads section looks: the night just gone, and the day before it. */
const LEADS_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** The fixed words for a tenant id the directory cannot name. Never the id itself. */
export const UNKNOWN_CLIENT_NAME = 'unknown client';

/** What the Leads section needs to know about a client: what to call it, and its clock. */
export interface LeadsDirectoryEntry {
  name: string;
  /** IANA identifier — the release time is told in the client's own zone. */
  timezone: string;
}

/** A count as the section renders it: a positive integer, or 0 for anything else. */
function positiveCount(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** `HH:MM`, 24-hour, in `timeZone`; UTC when the zone is not one Intl knows. */
function clockTime(at: Date, timeZone: string): { time: string; zone: string } {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  try {
    const time = new Intl.DateTimeFormat('en-AU', { ...options, timeZone }).format(at);
    return { time, zone: timeZone };
  } catch {
    const time = new Intl.DateTimeFormat('en-AU', { ...options, timeZone: 'UTC' }).format(at);
    return { time, zone: 'UTC' };
  }
}

/**
 * The Leads section of the 06:30 digest (Phase 13, D-08, D-09).
 *
 * Two lines a client can earn, in fixed words:
 *
 *   "{client}: {n} cold lead repl(y|ies) in the last 24 h waiting in the inbox"
 *      — lead replies classified cold, so they reached nobody's handset; the
 *        operator is who tells the tradie (D-08).
 *   "{client}: {n} hot lead(s) held overnight — released at {HH:MM} ({zone})"
 *      — hot lead alerts that waited for the client's contact hours because
 *        the after-hours switch is off (D-09). The time is the LATEST hold, in
 *        the client's own zone: when the last of them reached the tradie, or
 *        will.
 *
 * And, since Phase 14 (14-04, D-09), two more from `resolutions`:
 *
 *   "{client}: {n} ServiceM8 job(s) created from leads (last 24 h)"
 *      — the operator's tap created and read back a Quote job (D-04).
 *   "{client}: {n} lead(s) booked by the tradie (last 24 h)"
 *      — the sync found the caller on a job the tradie raised (D-07).
 *
 * Counted in leads-to-jobs, never in attributed dollars.
 *
 * And, since Phase 15 (15-06, D-09), one more from `overdue`, FIRST per client
 * because it is the line with a clock:
 *
 *   "{client}: {n} open lead(s) past (its|their) next follow-up deadline —
 *    open the lead queue: {console}/leads"
 *      — open leads whose next due touch is waiting on the operator and past
 *        its slot. The count is `countOverdueOpenLeads`, the SQL twin of the
 *        `/leads` deadline tier, so the chip, the count line and this line
 *        agree on what "overdue" means. The link is the console base URL the
 *        digest's queue link is built from.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE VOCABULARY IS CLOSED (T-13-15). A client name, an integer, a clock   │
 * │ time, an IANA zone and fixed words. The two inputs carry a tenant id, a  │
 * │ count and a time and nothing else, so no caller number and no reply body │
 * │ can reach a line — there is no argument through which one could.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * NULL WHEN THERE IS NOTHING, never an empty heading (the attestation
 * section's rule). Ordered by client name; within a client, overdue, cold,
 * held, jobs created, booked by the tradie. A tenant id the directory cannot name renders the fixed words
 * "unknown client", never the id.
 *
 * `now` bounds the held rows to the same 24 hours the read asks for, so the
 * function says what its heading says whatever a caller hands it.
 */
export function buildLeadsSection(
  cold: readonly { tenantId: string; count: number }[],
  held: readonly { tenantId: string; holdUntil: Date }[],
  directory: ReadonlyMap<string, LeadsDirectoryEntry>,
  now: Date,
  resolutions: readonly { tenantId: string; jobsCreated: number; bookedByTradie: number }[] = [],
  overdue: readonly { tenantId: string; count: number }[] = [],
): DigestSection | null {
  const since = now.getTime() - LEADS_LOOKBACK_MS;

  type Tally = {
    cold: number;
    held: number;
    latest: Date | null;
    jobsCreated: number;
    booked: number;
    overdue: number;
  };
  const byTenant = new Map<string, Tally>();
  const tallyFor = (tenantId: string): Tally => {
    let tally = byTenant.get(tenantId);
    if (!tally) {
      tally = { cold: 0, held: 0, latest: null, jobsCreated: 0, booked: 0, overdue: 0 };
      byTenant.set(tenantId, tally);
    }
    return tally;
  };

  for (const row of cold) {
    if (!Number.isInteger(row.count) || row.count <= 0) continue;
    tallyFor(row.tenantId).cold += row.count;
  }

  for (const row of held) {
    if (row.holdUntil.getTime() < since) continue;
    const tally = tallyFor(row.tenantId);
    tally.held += 1;
    if (tally.latest === null || row.holdUntil > tally.latest) tally.latest = row.holdUntil;
  }

  for (const row of resolutions) {
    const jobsCreated = positiveCount(row.jobsCreated);
    const booked = positiveCount(row.bookedByTradie);
    if (jobsCreated === 0 && booked === 0) continue;
    const tally = tallyFor(row.tenantId);
    tally.jobsCreated += jobsCreated;
    tally.booked += booked;
  }

  for (const row of overdue) {
    if (!Number.isInteger(row.count) || row.count <= 0) continue;
    tallyFor(row.tenantId).overdue += row.count;
  }

  const clients = [...byTenant.entries()]
    .map(([tenantId, tally]) => ({
      tenantId,
      tally,
      name: directory.get(tenantId)?.name ?? UNKNOWN_CLIENT_NAME,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.tenantId.localeCompare(b.tenantId));

  const lines: string[] = [];
  for (const { tenantId, tally, name } of clients) {
    if (tally.overdue > 0) {
      const one = tally.overdue === 1;
      lines.push(
        `${name}: ${tally.overdue} open lead${one ? '' : 's'} past ${one ? 'its' : 'their'} next follow-up deadline — open the lead queue: ${consoleBaseUrl()}/leads`,
      );
    }
    if (tally.cold > 0) {
      const noun = tally.cold === 1 ? 'reply' : 'replies';
      lines.push(`${name}: ${tally.cold} cold lead ${noun} in the last 24 h waiting in the inbox`);
    }
    if (tally.held > 0 && tally.latest !== null) {
      const { time, zone } = clockTime(tally.latest, directory.get(tenantId)?.timezone ?? 'UTC');
      const noun = tally.held === 1 ? 'lead' : 'leads';
      lines.push(
        `${name}: ${tally.held} hot ${noun} held overnight — released at ${time} (${zone})`,
      );
    }
    if (tally.jobsCreated > 0) {
      const noun = tally.jobsCreated === 1 ? 'job' : 'jobs';
      lines.push(
        `${name}: ${tally.jobsCreated} ServiceM8 ${noun} created from leads in the last 24 h`,
      );
    }
    if (tally.booked > 0) {
      const noun = tally.booked === 1 ? 'lead' : 'leads';
      lines.push(`${name}: ${tally.booked} ${noun} booked by the tradie in the last 24 h`);
    }
  }

  if (lines.length === 0) return null;

  return { heading: 'Leads', lines };
}

export interface StalledDigestOptions {
  /** Defaults to the real clock. Pinned in tests. */
  now?: Date;
  /**
   * Defaults to the NO-OP, not to Resend — the same composition-root split the
   * cadence tick makes. `src/core` must be runnable from a script and a suite
   * without mailing anybody; the route names the real sender.
   */
  send?: StalledEmailSender;
  /**
   * OVERRIDE the sections this run appends. Defaults to the real drift read
   * (`buildStaleAttestationSection`), so production gets the D-15 nag without
   * the route having to know about attestations — and a test can pass `[]` to
   * isolate the stall half.
   */
  sections?: readonly DigestSection[];
}

/** Counts only — this becomes an HTTP body, which is a lower-trust surface. */
export interface StalledDigestResult {
  /** Clients with at least one still-stalled touch. */
  tenantsAffected: number;
  /** Touches still stalled across every client. */
  touchesStalled: number;
  /** `1` when a digest left. */
  digestSent: number;
  /** `1` when there was something to say and saying it failed. */
  digestFailed: number;
  /**
   * `1` when the digest was NOT sent because nothing is stalled.
   *
   * ── THE EMPTY DIGEST IS DELIBERATELY NOT SENT, AND THIS IS THE RECEIPT ────
   *
   * A daily "all clear" that is right 95% of the time is the same trained
   * blindness the nav badge hides its zero for — by the time it matters, it is
   * the email nobody opens. But an absent email is indistinguishable from a
   * broken cron, so the liveness proof has to live somewhere else: it is this
   * number, in the 200 body `net._http_response` records every morning. The
   * builder still renders the honest zero, and a caller that wants it can ask.
   */
  digestSkippedEmpty: number;
}

/**
 * The sections production appends, in the order the operator should read them.
 *
 * A WEDGED ATTRIBUTION CURSOR FIRST, ATTESTATION DRIFT SECOND, LEADS THIRD,
 * OPT-OUT FOURTH. The order is how urgent each one is: the first means the
 * product's core promise is silently not happening and money is not reaching
 * invoices, the second is a compliance check going stale (ONB-04), the third
 * is a caller waiting on an answer today (Phase 13, D-08), the fourth is a
 * conversation to have this week.
 *
 * ── EACH READ FAILS ON ITS OWN ─────────────────────────────────────────────
 *
 * The metrics read is wrapped separately, and that is the whole reason it is a
 * separate arm: it is the newest and widest read on this path, and a digest
 * that did not go out because ONE of its four paragraphs could not be computed
 * would take the stalled-draft roll-up — the thing the operator actually acts
 * on every morning — down with it. A failed metrics read contributes NO
 * section, logs a fixed string, and the rest of the email leaves.
 *
 * ── AND THEY RUN ONE AFTER THE OTHER ───────────────────────────────────────
 *
 * `forAllTenants_reportMetrics` is itself eleven statements. Racing it against
 * the attestation read would be fine on its own, but this function is already
 * running beside `forAllTenants_stalledTally` — and the pool ceiling recorded
 * in `src/db/repository/client.ts` is a real deadlock, not a throughput note.
 */
async function defaultSections(now: Date): Promise<DigestSection[]> {
  const sections: DigestSection[] = [];

  try {
    // TWO STATEMENTS, and they run before the others rather than beside them —
    // the pool ceiling in `src/db/repository/client.ts` is a real deadlock, not
    // a throughput note, and this function already runs beside
    // `forAllTenants_stalledTally`.
    const backlog = await readConsumerBacklog(ATTRIBUTION_CONSUMER);
    const wedge = buildAttributionWedgeSection(backlog, now);
    if (wedge) sections.push(wedge);
  } catch {
    // Its own arm, for the reason the metrics read has one: a digest that did
    // not go out because ONE paragraph could not be computed would take the
    // stalled-draft roll-up down with it.
    console.error('[stalled-digest] attribution backlog read failed');
  }

  const latest = await forAllTenants_latestAttestations(SM8_AUTOMATION_ATTESTATION_KIND);
  const attestation = buildStaleAttestationSection(latest, now);
  if (attestation) sections.push(attestation);

  // The metrics rows name EVERY client with its zone, so they double as the
  // Leads section's directory — no extra read on a normal morning.
  const directory = new Map<string, LeadsDirectoryEntry>();
  let optOut: DigestSection | null = null;
  try {
    const window = rollingWindow(now, LIVE_METRICS_WINDOW_DAYS);
    const counts = await forAllTenants_reportMetrics(window);
    for (const row of counts) {
      directory.set(row.tenantId, { name: row.tenantName, timezone: row.timezone });
    }
    // ONE derivation, three surfaces. The rows this line is built from are the
    // rows `/reports` renders, computed by the same function over the same
    // window — so a client badged on screen is a client named in this email.
    optOut = buildOptOutSection(counts.map((row) => computeTenantMetrics(row, window, now)));
  } catch {
    // The caught value is discarded (WR-08): a driver error names columns, and
    // this string ends up in a cron log the operator reads.
    console.error('[stalled-digest] opt-out metrics read failed');
  }

  // ── LEADS (Phase 13, D-08/D-09) ────────────────────────────────────────────
  //
  // ITS OWN TRY, for the metrics read's reason: a digest that did not go out
  // because the lead counts could not be read would take the stalled-draft
  // roll-up down with it. Sequential, for the pool-ceiling reason above.
  // Rendered before opt-out: a cold lead waiting in the inbox is today's work,
  // an opt-out rate is this week's conversation.
  try {
    const since = new Date(now.getTime() - LEADS_LOOKBACK_MS);
    const cold = await countColdLeadRepliesSince(since);
    const held = await listHeldEscalationsSince(since);
    // Phase 14 (14-04, D-09): counts only, the same window, the same try.
    const resolutions = await countLeadResolutionsSince(since);
    // Phase 15 (15-06, D-09): counts only, the same try — a failed read costs
    // the paragraph. Asked at `now`, not over the 24 h window: overdue is a
    // state, and the predicate is the SQL twin of the `/leads` deadline tier.
    const overdue = await countOverdueOpenLeads(now);

    // A failed metrics read leaves the directory empty; the tick's tenant list
    // names connected clients in ONE statement, read only on that morning.
    if (
      [...cold, ...held, ...resolutions, ...overdue].some((row) => !directory.has(row.tenantId))
    ) {
      for (const tenant of await forAllTenants_cadenceTick()) {
        if (!directory.has(tenant.tenantId)) {
          directory.set(tenant.tenantId, { name: tenant.name, timezone: tenant.timezone });
        }
      }
    }

    const leads = buildLeadsSection(cold, held, directory, now, resolutions, overdue);
    if (leads) sections.push(leads);
  } catch {
    // Discarded, as above: a fixed string in the cron log, nothing else.
    console.error('[stalled-digest] lead reads failed');
  }

  if (optOut) sections.push(optOut);

  return sections;
}

export async function runStalledDigest(
  options: StalledDigestOptions = {},
): Promise<StalledDigestResult> {
  const now = options.now ?? new Date();
  const send = options.send ?? noopStalledEmailSender;

  const [perTenantCounts, sections] = await Promise.all([
    forAllTenants_stalledTally(stallBoundary(now)),
    options.sections ? Promise.resolve(options.sections) : defaultSections(now),
  ]);

  const touchesStalled = totalOf(perTenantCounts);
  const sectionLines = sections.reduce((sum, section) => sum + section.lines.length, 0);

  // ── "EMPTY" IS NOTHING TO SAY, NOT NOTHING STALLED (06-04) ────────────────
  //
  // An unsent digest is how this route says "there is nothing waiting on you",
  // and the honest test for that is whether the BODY would carry anything an
  // operator should act on. Keying it on `touchesStalled` alone would mean a
  // client whose ServiceM8 attestation is four months old is never mentioned on
  // any morning where the approval queue happens to be clear — which is most
  // mornings, and precisely the mornings when there is time to go and check.
  if (touchesStalled === 0 && sectionLines === 0) {
    return {
      tenantsAffected: 0,
      touchesStalled: 0,
      digestSent: 0,
      digestFailed: 0,
      digestSkippedEmpty: 1,
    };
  }

  const outcome = await send(
    buildDailyDigest({
      perTenantCounts,
      at: now,
      queueUrl: queueUrl(),
      sections,
    }),
  );

  return {
    tenantsAffected: perTenantCounts.length,
    touchesStalled,
    digestSent: outcome.ok ? 1 : 0,
    digestFailed: outcome.ok ? 0 : 1,
    digestSkippedEmpty: 0,
  };
}
