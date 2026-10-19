import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { arrivalSourceLine } from '@/core/intake/arrival-source';
import { BAND_LABELS, TRADE_LABELS } from '@/core/intake/audit-request';
import { formatInTenantZone, NO_VALUE } from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

import { StatusForm } from './status-form';

export const metadata: Metadata = { title: 'Audit request' };

/** Session-dependent — must never be cached or statically rendered. */
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One audit request, and the two things the operator does to it (D-15, C-11).
 *
 * ── READ THROUGH THE COOKIE CLIENT, NOT THE REPOSITORY (T-9-18) ─────────────
 *
 * The list page's argument applies here unchanged and matters more, because this
 * page shows the phone number, the email address and the attachment rather than
 * a summary line. `createClient()` is the anon key plus the operator's session
 * cookie, so the single `is_operator()` policy on `audit_requests` is what
 * decides whether this row comes back. The repository family goes through
 * `getDb()`, where RLS is inert — using it here would move the gate out of
 * Postgres and into whichever check somebody remembers to keep at the top of the
 * file. A signed-in non-operator gets `null` and therefore the 404 below, which
 * is indistinguishable from an id that names nothing.
 *
 * ── AND IT DOES SHOW THE TWO DIAGNOSTIC COLUMNS, DELIBERATELY ───────────────
 *
 * `ip_hash` and `user_agent` are absent from the list on purpose: that screen is
 * read at a glance with people standing behind it, and neither column is a fact
 * about the business. They are here because this is the screen somebody opens
 * when a submission looks wrong — a duplicate, a bot, a form that failed on one
 * phone — and those are the only two columns that answer it. The hash is
 * truncated to eight characters (enough to tell two submitters apart, not enough
 * to be a handle) and the agent string is one truncated line.
 *
 * ── LOADING, AND FAILURE (E12) ──────────────────────────────────────────────
 *
 * There is no skeleton and no spinner, because there is no client-side fetch to
 * wait on: this is a server component behind one round trip, so the browser
 * holds the list page until the HTML arrives — the console's answer everywhere
 * else, and the right one on a phone where a skeleton is a flash of grey that
 * costs a frame and tells the operator nothing. A FAILED read renders the fixed
 * sentence and a way back rather than a 404: "not found" would send the operator
 * looking for a request that exists (WR-08).
 */

/** The same map the list uses; a fifth status must arrive here as a decision. */
const STATUS_BADGE_CLASS: Record<string, string> = {
  new: 'badge',
  contacted: 'badge',
  audited: 'badge badge--ok',
  declined: 'badge muted',
};

/** Requests come from Perth businesses and are read in Perth (C-10/C-11). */
const REQUEST_ZONE = 'Australia/Perth';

/** How much of the salted address hash is enough to tell two submitters apart. */
const IP_HASH_PREFIX = 8;

/**
 * Every column this page renders, named.
 *
 * Explicit rather than `select('*')` for the list page's reason: the NEXT column
 * added to the table arrives on a screen only when somebody decides it should.
 */
const REQUEST_COLUMNS =
  'id, business_name, contact_name, phone, email, trade, servicem8_user, quotes_band, ' +
  'status, csv_object_path, csv_filename, csv_bytes, converted_prospect_id, ' +
  'notify_email, notify_sms, notify_detail, ip_hash, user_agent, created_at, ' +
  // Where the request came from (19 Sep 2026). On the DETAIL page and not the
  // list, like the two diagnostic columns above it: the list is read at a
  // glance to answer "who asked", and this answers "which channel is working",
  // which is a question somebody sits down with.
  'utm_source, utm_medium, utm_campaign, referrer_host';

type RequestRow = {
  id: string;
  business_name: string;
  contact_name: string;
  phone: string;
  email: string;
  trade: string;
  servicem8_user: boolean;
  quotes_band: string;
  status: string;
  csv_object_path: string | null;
  csv_filename: string | null;
  csv_bytes: number | null;
  converted_prospect_id: string | null;
  notify_email: string | null;
  notify_sms: string | null;
  notify_detail: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer_host: string | null;
};

/**
 * One channel's outcome, as words first and colour second (WCAG 1.4.1).
 *
 * `not_configured` wears the error badge here even though the LIST deliberately
 * withholds its "notify failed" flag from it. The two screens are answering
 * different questions: the list asks "did this request reach me", where a
 * missing provider key is a deployment problem rather than a lost alert; this
 * page is where the operator finds out WHY nothing arrived, and a channel that
 * cannot send at all is not a milder version of one that tried and failed.
 */
function NotifyOutcome({ channel, outcome }: { channel: string; outcome: string | null }) {
  if (outcome === 'sent') return <span>{channel} sent</span>;
  if (outcome === 'failed') return <span className="badge badge--error">{channel} failed</span>;
  if (outcome === 'not_configured') {
    return <span className="badge badge--error">{channel} not configured</span>;
  }
  return <span className="muted">{channel} not attempted</span>;
}

export default async function AuditRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked before the query.
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // The code, to the log; a fixed sentence, to the page (WR-08, T-9-05). A
    // PostgREST message names columns, constraints and the internals of
    // `is_operator()`, and none of it is something the operator can act on.
    console.error(`[audit-requests] request read failed: ${error.code ?? 'unknown'}`);
    return (
      <section>
        <h1>Audit request</h1>
        <p className="error" role="alert">
          Could not load this request. Try again in a moment.
        </p>
        <p>
          <Link href="/audits/requests">Back to audit requests</Link>
        </p>
      </section>
    );
  }

  const request = data as RequestRow | null;
  if (!request) {
    notFound();
  }

  const converted = request.converted_prospect_id;

  return (
    <section>
      <p className="muted">
        <Link href="/audits/requests">← Audit requests</Link>
      </p>

      <div className="row">
        {/* `.request-name` is `overflow-wrap: anywhere` — a 120-character
            business name wraps instead of widening the page (E12 long text). */}
        <h1 className="request-name">{request.business_name}</h1>
        <span className={STATUS_BADGE_CLASS[request.status] ?? 'badge'}>{request.status}</span>
      </div>

      <dl className="profile">
        <dt>Contact</dt>
        <dd>{request.contact_name}</dd>

        <dt>Mobile</dt>
        <dd>
          <a href={`tel:${request.phone}`}>{request.phone}</a>
        </dd>

        <dt>Email</dt>
        <dd className="request-name">
          <a href={`mailto:${request.email}`}>{request.email}</a>
        </dd>

        <dt>Trade</dt>
        <dd>{TRADE_LABELS[request.trade as keyof typeof TRADE_LABELS] ?? request.trade}</dd>

        <dt>ServiceM8</dt>
        <dd>{request.servicem8_user ? 'Yes' : 'No'}</dd>

        <dt>Quotes a month</dt>
        <dd>
          {BAND_LABELS[request.quotes_band as keyof typeof BAND_LABELS] ?? request.quotes_band}
        </dd>

        <dt>Received</dt>
        <dd>
          {formatInTenantZone(request.created_at, REQUEST_ZONE)}{' '}
          <span className="muted">{REQUEST_ZONE}</span>
        </dd>

        {/*
          WHICH CHANNEL PRODUCED THIS REQUEST (19 Sep 2026).

          One line, built by the same pure helper the tests exercise:
          `gbp / organic (www.google.com)`, with the campaign appended as
          ` · booking`, or `Unknown` when nothing was recorded.

          UNKNOWN IS AN ANSWER, NOT A GAP. Outreach emails stay link-free
          because Gmail rewrites every link, so an email-sourced request
          genuinely arrives with nothing attached and is matched to a person by
          email address against the M4 target list instead. A row that said
          nothing at all would read as a bug in the capture.

          Rendered as a TEXT NODE. The value is a stranger's query string, and
          two independent things keep it harmless: the parser refused every
          character that could be markup before it was stored, and React escapes
          what it is handed. Neither is trusted to be the only one.
        */}
        <dt>Came from</dt>
        <dd className="request-name">
          {arrivalSourceLine(
            {
              utmSource: request.utm_source,
              utmMedium: request.utm_medium,
              utmCampaign: request.utm_campaign,
              referrerHost: request.referrer_host,
            },
            NO_VALUE,
          )}
        </dd>

        <dt>Job List export</dt>
        <dd>
          {request.csv_object_path ? (
            <>
              <a className="button button--secondary" href={`/audits/requests/${id}/csv`} download>
                Download CSV
              </a>{' '}
              <span className="muted">
                {request.csv_filename ?? NO_VALUE} ({request.csv_bytes ?? 0} bytes)
              </span>
            </>
          ) : (
            // Also the state a request reaches once the export has been
            // CONSUMED, and 30 days after attaching one it was not: conversion
            // and the purge both delete the object and clear all four columns
            // together, so a dead Download button is not a state that exists.
            <span className="muted">No file attached</span>
          )}
        </dd>

        <dt>Notifications</dt>
        <dd>
          <NotifyOutcome channel="Email" outcome={request.notify_email} />
          {' · '}
          <NotifyOutcome channel="SMS" outcome={request.notify_sms} />
          {request.notify_detail ? (
            // An error NAME or a provider reason CODE, which is all the column
            // is ever written with (T-9-05). Never a provider payload.
            <>
              {' '}
              <span className="muted">({request.notify_detail})</span>
            </>
          ) : null}
        </dd>

        <dt>Connection</dt>
        <dd>{request.ip_hash ? request.ip_hash.slice(0, IP_HASH_PREFIX) : NO_VALUE}</dd>

        <dt>Browser</dt>
        <dd className="cell-truncate">{request.user_agent ?? NO_VALUE}</dd>
      </dl>

      {/* ONE primary action, and only while it is still the right one (C-11).
          After conversion the green button would offer a second audit for a
          request that already has one — the request row guards that write, but
          a control whose only outcome is a refusal should not be on screen. */}
      <div className="controls">
        {converted === null ? (
          <a className="button" href={`/audits/new?request=${id}`}>
            Start audit
          </a>
        ) : (
          <Link className="button-quiet" href={`/audits/${converted}`}>
            Open audit
          </Link>
        )}

        <StatusForm requestId={id} current={request.status} />
      </div>
    </section>
  );
}
