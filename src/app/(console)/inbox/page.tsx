import type { Metadata } from 'next';
import Link from 'next/link';

import { isPseudonym } from '@/core/leads/pseudonym';
import { NO_VALUE } from '@/core/shared/tenant';
import {
  listInboundNeedingTriage,
  type InboundTriageRow,
  type LeadJobLinkage,
} from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../_auth';
import { labelGuess, urgencyGuess } from '../components/label-guess';
import {
  type CreateJobSheet,
  jobChip,
  LEAD_JOB_STATE_LABELS,
  LEAD_RESOLUTION_LABELS,
  readLeadJobSheets,
} from '../components/lead-job-sheet';
import { NUMBER_RETIRED_LABEL } from '../components/text-back-outcome';
import { CreateJobForm } from './create-job-form';
import { MarkHandledForm } from './mark-handled-form';
import { SuppressContactForm } from './suppress-contact-form';

export const metadata: Metadata = { title: 'Inbox' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * WHERE AMBIGUITY LANDS (MSG-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ATTRIBUTION ALGORITHM IS ALLOWED TO FAIL. THIS IS WHERE IT SAYS SO.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 04-02 gave inbound SMS four honest buckets and made three of them do nothing
 * automatic on purpose: an ambiguous reply pauses no cadence, because a pause is
 * scheduling and acting on a guess would let anyone who can guess a phone number
 * stop two clients' chases at once. That decision is only defensible if the
 * unplaced rows reach a human. Without this page they reach a table.
 *
 * The queue is therefore everything still untriaged that is `ambiguous`,
 * `unmatched` or `dead_letter` — plus every STOP, including THREADED ones. A
 * threaded stop was already acted on (suppressed, cadence stopped); it is here
 * because somebody exercising a Spam Act right is a thing an operator should
 * see happen, not a row that quietly worked.
 *
 * ── SERVICE-ROLE READ BEHIND AN EXPLICIT OPERATOR GATE ──────────────────────
 *
 * `listInboundNeedingTriage` goes through `getDb()`, where RLS is inert by
 * design — so the `is_operator()` arm of the `inbound_messages` policy is NOT
 * what protects this page. `requireOperator()` is, and it runs before the read,
 * on the same argument as `audits/[id]/mapping/page.tsx` (CR-01): a session
 * proves somebody signed in, not that they may see a stranger's customers'
 * messages.
 *
 * ── THE RAW FROM-ADDRESS AND BODY ARE RENDERED HERE, AND ONLY HERE ──────────
 *
 * Both are forbidden in logs (T-2-02, T-4-02) and both are shown on this screen.
 * That is not a contradiction, it is the distinction the schema header draws: a
 * Vercel log line is readable by anyone with project access, forever, and is not
 * deletable per customer; this page is behind auth and an operator allowlist and
 * renders only what the person triaging must read to decide. When
 * `normalized_from` is NULL — a landline, a short code, an international sender
 * — the raw string is the ONLY thing there is to triage with.
 *
 * Cross-tenant bodies appear on one screen by design (T-4-25, D-03): the
 * operator IS the cross-tenant human. RLS still blocks a future client login,
 * because the policy's second arm is `is_operator()` and not "belongs to some
 * tenant".
 */

/**
 * A map, not an underscore-to-space string replace.
 *
 * The house rule the eligibility, sync-outcome and audit-source labels follow: a
 * fifth attribution added later must fail loudly here rather than ship as a
 * lowercase snake_case word on the operator's phone. The badge class carries no
 * meaning on its own — the label is always text (WCAG 1.4.1).
 */
const ATTRIBUTION_LABELS: Record<string, string> = {
  threaded: 'Threaded',
  ambiguous: 'Ambiguous',
  unmatched: 'Unmatched',
  dead_letter: 'Unreadable payload',
};

const ATTRIBUTION_BADGE_CLASS: Record<string, string> = {
  threaded: 'badge badge--ok',
  ambiguous: 'badge badge--warn',
  unmatched: 'badge badge--warn',
  dead_letter: 'badge badge--error',
};

/*
 * The classification labels moved to `components/label-guess.ts` in 06-06.
 *
 * Three surfaces show them now — this page, the quote page's conversation
 * thread, and the pipeline's reply chip — and "a guess stays phrased as a guess
 * on every surface" is a rule, not a style. A copied map is verbatim exactly
 * until somebody softens one copy. The argument for the wording lives with the
 * words. The reply itself is on screen here, verbatim and un-truncated, directly
 * above the badge, which is the other half of the same argument.
 */

/**
 * How sure the model said it was — shown ONLY when it was not sure.
 *
 * `high` is the acting threshold, and a "high confidence" caption on every
 * confident row is noise that trains the eye to skip the caption entirely,
 * including on the rows where it says the opposite. Below-high is the D-15
 * signal, so below-high is what gets said.
 */
const LOW_CONFIDENCE_LABELS: Record<string, string> = {
  medium: 'not certain',
  low: 'a guess',
};

/*
 * The lead resolution and job-state label maps moved to
 * `components/lead-job-sheet.ts` in 15-04, with the sheet builder: the lead
 * queue and the client page's missed-call log render the same chips, and a
 * copied map is verbatim exactly until somebody softens one copy.
 */

/**
 * Dates in the OPERATOR'S locale, with the time.
 *
 * Deliberately not a client's timezone, unlike every cadence surface: nothing on
 * this page is a contact-hours decision. The question it answers is "how long
 * has this person been waiting for a human", which is asked from wherever the
 * operator is standing. The time is shown because on this screen the difference
 * between four minutes ago and eleven hours ago is the whole triage decision.
 */
function formatReceived(at: Date): string {
  const value = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(value.getTime())) return NO_VALUE;
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

/** Everything a row needs to name the clients involved, resolved once. */
type TenantNames = ReadonlyMap<string, string>;

function nameOf(names: TenantNames, id: string): string {
  // A client the operator cannot see through RLS is named by nothing — showing
  // a bare uuid would be worse than useless on a phone, and inventing a name is
  // not available. "Another client" is the honest label, and it is also the
  // correct one: the operator does not need to know WHICH to know the reply is
  // ambiguous.
  return names.get(id) ?? 'Another client';
}

/**
 * The job linkage of every lead on screen, and the confirm sheet for each
 * OPEN lead still at `none` or `failed` (Phase 14, D-01, D-09).
 *
 * A TENANT-SCOPED READ PER TENANT, not a join in the triage read: that read
 * lives outside `forTenant()` and is pinned to one table
 * (tests/inbox-authorization.test.ts). The sheet is built by the shared
 * `readLeadJobSheets` (15-04) — the lead queue mounts the same form from the
 * same builder, so the two previews cannot drift. Its facts carry the
 * caller's words and mobile; they go into the form's props and nowhere else
 * (never a log).
 *
 * A failure here hides the create control and nothing else: the queue still
 * renders, because a reply someone must read outranks a button.
 */
async function readLeadJobs(rows: readonly InboundTriageRow[]): Promise<{
  linkage: ReadonlyMap<string, LeadJobLinkage>;
  sheets: ReadonlyMap<string, CreateJobSheet>;
}> {
  const leadsByTenant = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.tenantId || !row.leadId) continue;
    const set = leadsByTenant.get(row.tenantId) ?? new Set<string>();
    set.add(row.leadId);
    leadsByTenant.set(row.tenantId, set);
  }

  try {
    return await readLeadJobSheets(leadsByTenant);
  } catch {
    // Discarded, not logged: it can carry a predicate naming customer columns.
    console.error('[inbox] lead job linkage read failed');
    return { linkage: new Map(), sheets: new Map() };
  }
}

export default async function InboxPage() {
  const access = await requireOperator();
  if (access !== 'ok') {
    return (
      <section>
        <h1>Inbox</h1>
        <p className="error" role="alert">
          {OPERATOR_DENIED_MESSAGE[access]}
        </p>
      </section>
    );
  }

  let rows: InboundTriageRow[];
  try {
    rows = await listInboundNeedingTriage();
  } catch {
    // The caught value is DELIBERATELY DISCARDED rather than logged or shown
    // (WR-08, T-2-02): a postgres error from this query can carry the predicate,
    // and the predicate names customer columns. The operator cannot act on any
    // of it either way.
    console.error('[inbox] triage queue read failed');
    return (
      <section>
        <h1>Inbox</h1>
        <p className="error" role="alert">
          Could not load the inbox. Try again in a moment.
        </p>
      </section>
    );
  }

  // Names through the operator's OWN JWT, so RLS decides which clients they may
  // see — a narrower authority than the read above, and the reason the
  // repository accessor returns ids rather than joining `tenants` itself.
  const supabase = await createClient();
  const { data: tenantRows } = await supabase.from('tenants').select('id, name');
  const names: TenantNames = new Map(
    ((tenantRows as { id: string; name: string }[] | null) ?? []).map((row) => [row.id, row.name]),
  );

  const { linkage, sheets } = await readLeadJobs(rows);

  return (
    <section>
      <div className="row">
        <h1>Inbox</h1>
        <span className="muted">
          {rows.length === 0
            ? null
            : `${rows.length} message${rows.length === 1 ? '' : 's'} needing attention`}
        </span>
      </div>

      <p className="hint muted">
        Replies we could not place, every opt-out, anything the classifier was unsure about, and
        every reply from a missed caller that did not go to the tradie. Nothing here is followed
        up automatically and nothing has been suppressed on a label —
        these are yours to decide.
      </p>

      {rows.length === 0 ? (
        <p className="muted">No inbound needing attention.</p>
      ) : (
        <ul className="touch-list">
          {rows.map((row) => {
            const candidates = row.candidateTenantIds ?? [];

            /**
             * D-13: classified as an opt-out but NOT matched by the
             * deterministic STOP regex. Nobody has been suppressed — the
             * reply-pause froze the cadence and stopped there, on purpose,
             * because a compliance write is not a model's to make.
             */
            const softOptOut = row.label === 'opt_out' && !row.isStop;
            /**
             * Phase 15 (15-REVIEW CR-01): the privacy pass retired this
             * caller's number — the row's sender, its lead and its cadence
             * now hold a pseudonym. There is no address left to suppress, so
             * the suppress control is NOT offered on it; a hash written as a
             * suppression would suppress nobody and read as if it did.
             *
             * 15-REVIEW WR-04: the stamp is the truth, and a sender that IS a
             * pseudonym counts too (belt and braces) — the hash is never
             * rendered as a sender, and the lead link is not offered.
             */
            const retired = row.pseudonymisedAt !== null || isPseudonym(row.fromAddress);
            const lowConfidence =
              row.labelConfidence === null ? null : LOW_CONFIDENCE_LABELS[row.labelConfidence];
            // A LEAD reply's urgency (D-05; 13-REVIEW WR-03), as a guess. Only
            // a lead row carries one; `unknown` renders nothing.
            const urgency = urgencyGuess(row.urgency);
            // The lead's create-job sheet, read per lead (not per row).
            const sheet = row.leadId ? sheets.get(row.leadId) : undefined;
            // The lead's linkage — per LEAD, so a second reply's row shows the
            // same chips as the first (research Pitfall 6).
            const link = row.leadId ? linkage.get(row.leadId) : undefined;
            const job = link === undefined ? null : jobChip(link);
            const resolution =
              link?.closedReason == null ? undefined : LEAD_RESOLUTION_LABELS[link.closedReason];
            const jobState = link === undefined ? undefined : LEAD_JOB_STATE_LABELS[link.sm8JobState];

            return (
              <li key={row.id}>
                <div className="touch-when touch-when--stack">
                  {formatReceived(row.receivedAt)}
                  {/* Text first, colour second. The STOP badge is separate from
                      attribution because they answer different questions: whose
                      is this, and did somebody ask us to stop. A threaded STOP
                      carries both. */}
                  <span className={ATTRIBUTION_BADGE_CLASS[row.attribution] ?? 'badge'}>
                    {ATTRIBUTION_LABELS[row.attribution] ?? row.attribution}
                  </span>
                  {row.isStop ? <span className="badge badge--error">STOP</span> : null}
                  {/* The model's opinion, and it looks like one. A soft opt-out
                      is the only label that carries a colour, because it is the
                      only one with something waiting on a human. */}
                  {row.label === null ? null : (
                    <span className={softOptOut ? 'badge badge--error' : 'badge'}>
                      {labelGuess(row.label)}
                      {lowConfidence === undefined || lowConfidence === null
                        ? ''
                        : ` — ${lowConfidence}`}
                    </span>
                  )}
                  {/* The urgency the model gave a missed caller's reply. An
                      emergency carries a colour for the soft opt-out's reason:
                      it is the one that changes what the operator does next.
                      Text first, colour second (WCAG 1.4.1). */}
                  {urgency === null ? null : (
                    <span
                      className={row.urgency === 'emergency' ? 'badge badge--error' : 'badge'}
                    >
                      {urgency}
                    </span>
                  )}
                  {/* D-14's flag, DISPLAY-ONLY here: written on every
                      high-confidence interested/question reply, read by Phase
                      6's escalation. Nothing in this phase acts on it. */}
                  {row.isHot ? <span className="badge badge--ok">hot</span> : null}
                  {/* Phase 14 (D-09): what happened to the lead. Text first,
                      colour second; a failure is the one that waits on a
                      human, so it is the one with a warning colour. */}
                  {job === null ? null : <span className="badge badge--ok">{job}</span>}
                  {resolution === undefined ? null : <span className="badge">{resolution}</span>}
                  {jobState === undefined ? null : (
                    <span
                      className={link?.sm8JobState === 'failed' ? 'badge badge--warn' : 'badge'}
                    >
                      {jobState}
                    </span>
                  )}
                </div>

                <p className="meta">
                  {/* 15-REVIEW WR-04: a retired row shows the retired label,
                      never the 64-hex code the pass left in its place. */}
                  {retired ? (
                    <strong>{NUMBER_RETIRED_LABEL}</strong>
                  ) : (
                    <strong>{row.fromAddress}</strong>
                  )}
                  {retired || row.normalizedFrom ? null : (
                    // The normalizer refused it, so this number can never thread
                    // — worth saying, because otherwise "unmatched" reads as "we
                    // have no cadence for them" when it means "we could not even
                    // ask".
                    <span className="muted"> · not a recognisable AU mobile</span>
                  )}
                  <span className="muted"> · {row.channel}</span>
                </p>

                {/* The body verbatim, un-truncated. A trimmed reply is a reply
                    whose meaning may have been trimmed off, and this screen
                    exists to be read by the one human allowed to read it. */}
                <p className="touch-meta">{row.body === '' ? <em>(empty message)</em> : row.body}</p>

                <p className="touch-meta muted">
                  {row.matchedCadenceCount} live cadence
                  {row.matchedCadenceCount === 1 ? '' : 's'} matched
                  {candidates.length > 0 ? (
                    <> · candidates: {candidates.map((id) => nameOf(names, id)).join(', ')}</>
                  ) : null}
                </p>

                {/* A LEAD reply has no quote page (Phase 13, 13-REVIEW CR-01):
                    this screen is where it is read until the lead queue
                    exists, so the row names the client and says what it is,
                    with no link to a quote that does not exist. */}
                {row.tenantId && row.quoteId ? (
                  <p className="touch-meta">
                    <Link href={`/clients/${row.tenantId}/quotes/${row.quoteId}`}>
                      {nameOf(names, row.tenantId)} — open the quote
                    </Link>
                  </p>
                ) : row.tenantId && row.leadId ? (
                  <p className="touch-meta">
                    <Link href={`/clients/${row.tenantId}`}>{nameOf(names, row.tenantId)}</Link>
                    {/* D-01's one inbox link (15-04): the lead's card on the
                        lead queue, where its next touch, job and close live.
                        This row stays — the 13-REVIEW CR-01 bridge. */}
                    {/* Not on a retired row (15-REVIEW WR-04): its lead is
                        closed and off the queue, so the anchor finds nothing. */}
                    {retired ? null : (
                      <>
                        {' · '}
                        <Link href={`/leads#lead-${row.leadId}`}>open the lead →</Link>
                      </>
                    )}
                    <span className="muted"> · missed-call lead, no quote</span>
                  </p>
                ) : null}

                {/* ── THE D-13 SUGGESTED ACTION ────────────────────────────
                    Offered only when the row carries the ids the EXISTING kill
                    path needs — a client and a cadence — and those ids come
                    from this RLS-read row rather than from anything a caller
                    supplied (T-5-27). An unattributed reply has no cadence to
                    stop and no client to stop it for, so there is nothing to
                    suggest — the operator triages it by hand.

                    THE QUOTE ID IS NOT PART OF THE CONDITION (Phase 13, D-11).
                    A lead reply has a cadence to stop and a client to stop it
                    for, and no quote; the kill path is the same, so the
                    operator can confirm a missed caller's soft opt-out here.
                    The form gets the row's quote id, NULL for a lead. */}
                {retired && softOptOut ? (
                  <p className="touch-meta muted">
                    This reads like somebody asking to be left alone, but their number was retired
                    under the privacy policy, so there is no number left to suppress. If they ring
                    again, their new call is a new lead.
                  </p>
                ) : softOptOut && row.tenantId && row.cadenceId ? (
                  <>
                    <p className="touch-meta muted">
                      This reads like somebody asking to be left alone, but it is not a plain STOP
                      — so nothing has been suppressed. Read it, then decide.
                    </p>
                    <SuppressContactForm
                      tenantId={row.tenantId}
                      quoteId={row.quoteId}
                      cadenceId={row.cadenceId}
                      clientName={nameOf(names, row.tenantId)}
                    />
                  </>
                ) : null}

                {/* ── THE D-01 CREATE-JOB SHEET ────────────────────────────
                    ABOVE mark-handled (research Pitfall 6): a handled row
                    leaves the inbox, and until the lead page exists this row
                    is the only place the job can be created from. Rendered
                    for an OPEN lead at `none` or `failed` with at least one
                    reply — the core re-checks all three. */}
                {row.tenantId && row.leadId && sheet ? (
                  <CreateJobForm
                    tenantId={row.tenantId}
                    leadId={row.leadId}
                    clientName={nameOf(names, row.tenantId)}
                    {...sheet}
                  />
                ) : null}

                <MarkHandledForm inboundId={row.id} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
