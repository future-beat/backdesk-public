/**
 * The ONE 90-day fetch, shared by the prospect audit and the client baseline
 * (D-12, D-14, RESEARCH Pattern 6).
 *
 * ── WHY THIS IS SHARED CODE AND NOT TWO SIMILAR FUNCTIONS ───────────────────
 *
 * The audit is a PROMISE made to a prospect; the client's monthly report is the
 * DELIVERY against it. If the two are computed by different fetch paths, the
 * first thing a converted client sees is a number that contradicts the document
 * that sold them the service — and they will be right, because one of the two
 * will be wrong. Sharing the path makes disagreement unexpressible rather than
 * merely unlikely.
 *
 * ── FOUR REQUESTS, NOT SIX HUNDRED ──────────────────────────────────────────
 *
 * The obvious implementation asks for each job's notes and activities as it
 * walks the job list. At 300 jobs that is 600 requests against a documented
 * ceiling of 180/minute (RESEARCH anti-pattern), so the audit either takes ten
 * minutes or gets the PROSPECT'S OWN ACCOUNT rate-limited — during the meeting
 * where they handed over a key as a favour. Instead: one filtered request per
 * resource, joined in memory. `tests/baseline-winrate.test.ts` asserts the call
 * count from the source, because "no N+1" is an absence and no behavioural test
 * can demonstrate one.
 *
 * ── THE WINDOW IS DECIDED HERE, NOT BY SERVICEM8 ────────────────────────────
 *
 * The `$filter` deliberately asks for a day MORE than the window and the exact
 * boundary is applied locally by `isInWindow`. ServiceM8's `gt` was measured to
 * behave INCLUSIVELY (A1) and accepts only a date-granularity literal reliably,
 * so leaning on it for the day-90 edge would put the audit's most checkable
 * property — "the last 90 days" — inside somebody else's undocumented operator.
 * A day of slack costs a handful of extra rows we then discard.
 *
 * ── PARSE FAILURES ABORT ────────────────────────────────────────────────────
 *
 * Any row that does not match its schema fails the whole fetch. Skipping a bad
 * note silently converts a quote that WAS followed up into a leak, inflating
 * the headline figure in a document the prospect can check against their own
 * phone records. A partial audit is worse than no audit, because it looks
 * exactly like a complete one (threat T-2-17).
 */
import { createSm8Client } from '@/core/servicem8/client';
import { SM8_TIMESTAMP_ZONE, parseMoneyToCents, sm8ToUtc } from '@/core/servicem8/normalize';
import { fetchAllPages } from '@/core/servicem8/pagination';
import { sm8Job, sm8JobActivity, sm8JobContact, sm8Note } from '@/core/servicem8/schemas';
import type { Sm8Client, Sm8Result } from '@/core/servicem8/types';

import { auditWindow, isInWindow, type AuditLine, type AuditWindow } from './aggregate';
import { isFollowedUp } from './followup';

/**
 * One quote, ready both to aggregate and to persist.
 *
 * Extends `AuditLine` so the aggregation consumes it directly — there is no
 * mapping step between "what we fetched" and "what we count", and therefore no
 * place for the two to drift.
 */
export interface AuditQuoteRecord extends AuditLine {
  sm8JobUuid: string;
  quoteDateRaw: string | null;
  description: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface QuoteHistory {
  window: AuditWindow;
  records: AuditQuoteRecord[];
  /** Jobs the account returned before the window filter — for diagnostics. */
  jobsFetched: number;
}

/** One extra day of slack, matching `connect.ts`'s backfill filter. */
function filterCutoff(window: AuditWindow): string {
  return new Date(window.start.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** `first last`, trimmed, or null — never a stray space or a bare 'null'. */
function contactName(contact: { first?: string | null; last?: string | null }): string | null {
  const name = [contact.first, contact.last].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : null;
}

function parseFailure(resource: string, issues: { path: PropertyKey[]; code: string }[]) {
  return {
    ok: false as const,
    kind: 'parse_error' as const,
    detail: `a ${resource} record did not match the expected shape: ${issues
      .map((i) => `${i.path.join('.')}: ${i.code}`)
      .join('; ')}`,
  };
}

/**
 * Fetch and normalize a ServiceM8 account's last 90 days of quotes.
 *
 * `sourceZone` is THE ZONE SERVICEM8'S NAIVE TIMESTAMPS ARE READ IN, measured
 * as UTC (see `normalize.ts`). It is deliberately NOT the prospect's or
 * tenant's display timezone: that zone governs contact hours and rendering,
 * this one governs interpretation, and passing a Perth zone here puts every
 * quote date eight hours out — which at the window edge silently moves quotes
 * in and out of the audit.
 *
 * Returns a typed result, never a throw for an expected failure: the caller
 * renders the classified kind as copy, and an exception from this depth can
 * carry a Request with the API key in its headers (threat T-2-02).
 */
export async function fetch90DayQuoteHistory(
  client: Sm8Client,
  options: { now?: Date; sourceZone?: string } = {},
): Promise<Sm8Result<QuoteHistory>> {
  const { now = new Date(), sourceZone = SM8_TIMESTAMP_ZONE } = options;

  const window = auditWindow(now);
  const cutoff = filterCutoff(window);

  // --- 1. Jobs. ONE filter spans all four statuses ---------------------------
  //
  // Any job that ever became a quote carries a `quote_date`; jobs created
  // straight to Work Order carry a zero-date and fall out of a `gt` comparison.
  // MEASURED, not assumed (A4): of 4 jobs with a zero `work_order_date`, zero
  // survived `work_order_date gt '2000-01-01'`. The per-status fallback the
  // research proposed is therefore not needed and has not been built.
  const jobsPage = await fetchAllPages(client, 'job.json', {
    filter: `quote_date gt '${cutoff}'`,
  });
  if (!jobsPage.ok) return jobsPage;

  const jobs = [];
  for (const row of jobsPage.data) {
    const parsed = sm8Job.safeParse(row);
    if (!parsed.success) return parseFailure('job', parsed.error.issues);
    jobs.push(parsed.data);
  }

  // Only the jobs actually in the audit need companion records joined to them.
  const inWindow = jobs.filter(
    (job) => job.active && isInWindow(sm8ToUtc(job.quote_date, sourceZone), window),
  );
  const wanted = new Set(inWindow.map((job) => job.uuid));

  // --- 2..4. Companion records, one bulk request each ------------------------
  const [notesPage, activitiesPage, contactsPage] = await Promise.all([
    fetchAllPages(client, 'note.json', { filter: `create_date gt '${cutoff}'` }),
    fetchAllPages(client, 'jobactivity.json', { filter: `start_date gt '${cutoff}'` }),
    // FILTERED LIKE THE OTHER THREE (WR-04). An unfiltered `jobcontact.json`
    // fetches the account's ENTIRE contact table — every contact for every job
    // ever, not just the 90-day window — which made it far and away the most
    // likely walk to hit the 50-page cap, and the cap is now a hard failure
    // rather than a silent truncation.
    //
    // `edit_date`, and the SAME FIELD THE SYNC PATH ALREADY USES for this
    // resource (`run-sync.ts` builds `edit_date gt '<contactCursor>'`). That
    // parity is the point: this module's header argues that the audit and the
    // client's monthly report must not be computed by different fetch paths,
    // because the first thing a converted client sees would be a number
    // contradicting the document that sold them. An unfiltered walk here was a
    // divergence from the connected path, not just a volume problem.
    fetchAllPages(client, 'jobcontact.json', { filter: `edit_date gt '${cutoff}'` }),
  ]);
  if (!notesPage.ok) return notesPage;
  if (!activitiesPage.ok) return activitiesPage;
  if (!contactsPage.ok) return contactsPage;

  /** job uuid → follow-up signal instants, assembled from every source. */
  const signals = new Map<string, Date[]>();
  const addSignal = (jobUuid: string | null | undefined, at: Date | null) => {
    if (!jobUuid || at === null || !wanted.has(jobUuid)) return;
    const existing = signals.get(jobUuid);
    if (existing) existing.push(at);
    else signals.set(jobUuid, [at]);
  };

  for (const row of notesPage.data) {
    const parsed = sm8Note.safeParse(row);
    if (!parsed.success) return parseFailure('note', parsed.error.issues);

    const note = parsed.data;
    if (!note.active) continue;
    // BOTH fields, not just the uuid — see the schema header. A note about the
    // customer's ACCOUNT is not a follow-up on this quote.
    if ((note.related_object ?? '').toLowerCase() !== 'job') continue;
    addSignal(note.related_object_uuid, sm8ToUtc(note.create_date, sourceZone));
  }

  for (const row of activitiesPage.data) {
    const parsed = sm8JobActivity.safeParse(row);
    if (!parsed.success) return parseFailure('jobactivity', parsed.error.issues);

    const activity = parsed.data;
    if (!activity.active) continue;
    addSignal(activity.job_uuid, sm8ToUtc(activity.start_date, sourceZone));
  }

  /** job uuid → the JOB-type contact, deterministic when a job has two. */
  const contacts = new Map<string, { name: string | null; phone: string | null; email: string | null }>();
  const contactUuidSeen = new Map<string, string>();

  for (const row of contactsPage.data) {
    const parsed = sm8JobContact.safeParse(row);
    if (!parsed.success) return parseFailure('jobcontact', parsed.error.issues);

    const contact = parsed.data;
    if (!contact.active || !wanted.has(contact.job_uuid)) continue;
    // `type` is free text upstream and its casing varies; `is_primary_contact`
    // is deprecated and deliberately never consulted.
    if ((contact.type ?? '').toUpperCase() !== 'JOB') continue;

    // Lowest uuid wins, so two renders of the same audit name the same person.
    const incumbent = contactUuidSeen.get(contact.job_uuid);
    if (incumbent !== undefined && incumbent <= contact.uuid) continue;
    contactUuidSeen.set(contact.job_uuid, contact.uuid);

    contacts.set(contact.job_uuid, {
      name: contactName(contact),
      phone: contact.mobile ?? contact.phone ?? null,
      email: contact.email ?? null,
    });
  }

  // --- 5. Assemble ----------------------------------------------------------
  const records: AuditQuoteRecord[] = inWindow.map((job) => {
    const quoteDateUtc = sm8ToUtc(job.quote_date, sourceZone);
    const contact = contacts.get(job.uuid);

    // A status change IS a follow-up: the tradie acted on the quote, whether or
    // not they told us about it in a note.
    const jobSignals = [
      ...(signals.get(job.uuid) ?? []),
      sm8ToUtc(job.quote_sent_stamp, sourceZone),
      sm8ToUtc(job.work_order_date, sourceZone),
      sm8ToUtc(job.completion_date, sourceZone),
      sm8ToUtc(job.unsuccessful_date, sourceZone),
    ];

    return {
      sm8JobUuid: job.uuid,
      status: job.status,
      quoteDateRaw: job.quote_date,
      quoteDateUtc,
      valueCents: parseMoneyToCents(job.total_invoice_amount),
      description: job.job_description ?? null,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      contactEmail: contact?.email ?? null,
      followedUp: isFollowedUp(quoteDateUtc, jobSignals),
    };
  });

  return { ok: true, data: { window, records, jobsFetched: jobs.length } };
}

/**
 * The same fetch, from a raw API key.
 *
 * A convenience over `createSm8Client` so the prospect path and the client path
 * construct the client identically — including the day the OAuth arm is added
 * to `Sm8Auth`, which is a constructor change in exactly one place.
 */
export function auditClientFor(apiKey: string): Sm8Client {
  return createSm8Client({ kind: 'apiKey', key: apiKey });
}
