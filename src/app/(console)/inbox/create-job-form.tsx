'use client';

import { useActionState, useState } from 'react';

import { composeJobDescription } from '@/core/leads/job-description';

import { BLANK_CREATE_JOB_STATE, type CreateJobState } from './action-state';
import { createJobForLeadAction } from './create-job-actions';

/**
 * "Create ServiceM8 job" on an open lead's inbox row (Phase 14, D-01).
 *
 * ── THE TAP IS THE JUDGMENT ─────────────────────────────────────────────────
 *
 * There is no label gate and no auto-creation: the operator reading the
 * caller's words is the human gate, as with message approval. So the sheet
 * shows EXACTLY what will be written before anything is: the description,
 * composed here by the same pure `composeJobDescription` the server uses over
 * the same lines (`previewLinesFor`, built by the page from the database), so
 * the preview and the write are byte-identical by construction. The action
 * never trusts this preview — it rebuilds the description from the database
 * and refuses with `thread_changed` if a reply landed or a preview line
 * changed (an urgency label set by the classifier) since this page rendered
 * (the hidden `latest_inbound_id` and `preview_sha256`, both computed by the
 * server page; this form only echoes them — 14-REVIEW WR-04).
 *
 * ── ARM-THEN-CONFIRM ────────────────────────────────────────────────────────
 *
 * The suppress form's shape: the first tap opens the preview, the second lands
 * on a control that did not exist a moment ago. A mis-tap while scrolling a
 * list of different customers' rows must not write into a tradie's ServiceM8.
 *
 * CLIENT-SAFE (tests/lint-ban.test.ts, CLIENT_REACHABLE): plain props, React,
 * the action, the sibling leaf and the pure description module — nothing that
 * reaches the database.
 */
export function CreateJobForm({
  tenantId,
  leadId,
  clientName,
  replies,
  urgencyLine,
  noteLine,
  latestInboundId,
  previewSha256,
  mobileLocal,
  companyName,
  contactFirst,
  contactLast,
  jobState,
  errorSentence,
  attemptCount,
}: {
  tenantId: string;
  leadId: string;
  clientName: string;
  /** The caller's replies verbatim, oldest first. */
  replies: string[];
  urgencyLine: string | null;
  noteLine: string;
  /** The newest reply's id the preview was built from (checker W3). */
  latestInboundId: string;
  /** The server-computed digest of this preview's lines (WR-04). */
  previewSha256: string;
  /** The caller's mobile in the local spaced form written to ServiceM8. */
  mobileLocal: string;
  /** Prefilled; the operator confirms or corrects it. */
  companyName: string;
  contactFirst: string | null;
  contactLast: string | null;
  jobState: 'none' | 'failed';
  /** The last failure's fixed sentence, when `jobState` is `failed`. */
  errorSentence: string | null;
  attemptCount: number;
}) {
  const [state, formAction, pending] = useActionState(
    createJobForLeadAction.bind(null, tenantId, leadId),
    BLANK_CREATE_JOB_STATE,
  );
  const [armed, setArmed] = useState(false);
  const [company, setCompany] = useState(companyName);
  const [first, setFirst] = useState(contactFirst ?? '');
  const [last, setLast] = useState(contactLast ?? '');
  const [suburb, setSuburb] = useState('');

  const description = composeJobDescription({
    replies,
    suburb: suburb.trim() === '' ? null : suburb,
    urgencyLine,
    noteLine,
  });
  const contactName = [first.trim(), last.trim()].filter((part) => part !== '').join(' ');

  if (state.success) {
    return <Message state={state} />;
  }

  return (
    <div className="controls">
      <Message state={state} />

      {jobState === 'failed' && !armed ? (
        <p className="touch-meta" role="status">
          {errorSentence ?? 'The last attempt failed.'}{' '}
          <span className="muted">attempt {attemptCount}</span>
        </p>
      ) : null}

      {armed ? (
        <form action={formAction}>
          <p className="kill-warning" role="alert">
            This writes into {clientName}&apos;s ServiceM8.
          </p>
          <pre className="touch-meta">{description}</pre>
          <p className="touch-meta">
            Job contact: {contactName === '' ? '(no name)' : contactName} · {mobileLocal}
          </p>

          <input type="hidden" name="latest_inbound_id" value={latestInboundId} />
          <input type="hidden" name="preview_sha256" value={previewSha256} />
          <label>
            Client name in ServiceM8
            <input
              name="company_name"
              required
              maxLength={100}
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            />
          </label>
          <label>
            First name
            <input
              name="contact_first"
              maxLength={100}
              value={first}
              onChange={(event) => setFirst(event.target.value)}
            />
          </label>
          <label>
            Last name
            <input
              name="contact_last"
              maxLength={100}
              value={last}
              onChange={(event) => setLast(event.target.value)}
            />
          </label>
          <label>
            Suburb (optional)
            <input
              name="suburb"
              maxLength={60}
              value={suburb}
              onChange={(event) => setSuburb(event.target.value)}
            />
          </label>

          <p className="touch-meta muted">
            Create the job before marking this reply handled — a handled row leaves the inbox.
          </p>
          <button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Yes — create the job in ServiceM8'}
          </button>
          <button type="button" onClick={() => setArmed(false)} disabled={pending}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setArmed(true)}>
          {jobState === 'failed' ? 'Retry ServiceM8 job' : 'Create ServiceM8 job'}
        </button>
      )}
    </div>
  );
}

function Message({ state }: { state: CreateJobState }) {
  if (state.error) {
    return (
      <p className="error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="muted" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}
