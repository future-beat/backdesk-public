'use client';

import { useActionState, useState } from 'react';

import { createAuditAction } from './actions';
import { BLANK_AUDIT_STATE } from './action-state';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id} role="alert">
      {message}
    </p>
  );
}

/**
 * What an audit request contributes to this form (09-06, UI-SPEC C-12).
 *
 * PLAIN STRINGS, ALREADY FORMATTED. The size is a rendered label rather than a
 * byte count and the source is a decided word rather than a nullable path,
 * because this module is `'use client'`: every value here crosses into the
 * browser bundle, and the alternative — handing it the row and letting it
 * decide — is how a formatter, and then the module the formatter came from,
 * ends up shipped to a phone.
 *
 * NOTE WHAT IS ABSENT. There is no API key here and there never can be. The
 * request carries none, the operator types it at audit time, and it is not
 * echoed back on a failure either (T-2-02).
 */
export type NewAuditInitial = {
  requestId: string;
  businessName: string;
  source: 'csv' | 'api_key';
  /** The stored export's name, or null when there is nothing attached. */
  csvFilename: string | null;
  /** Its size, already rendered — `12 KB`, never `12288`. */
  csvSize: string | null;
};

/**
 * New prospect + audit (02-UI-SPEC Screen 4).
 *
 * `useActionState`, like the client form, so a rejected submission comes back
 * with the business name intact instead of a redirect that throws the form
 * away — the difference matters most on a phone, between sales meetings.
 *
 * THE KEY IS NEVER ECHOED BACK. Every other value in this form survives a
 * failure; the credential does not, because re-rendering it would put a live
 * third-party key into the server-rendered HTML and the client router cache
 * (threat T-2-02).
 *
 * BOTH SOURCE BRANCHES ARE WIRED (D-12). The API path verifies and generates in
 * one submit; the CSV path parses, stages, and hands the operator the mapping
 * step — the export's column layout is undocumented, so the inference is
 * confirmed by a human before it becomes a document (RESEARCH Pattern 7).
 */
export function NewAuditForm({
  timezones,
  defaultTimezone,
  initial,
}: {
  timezones: string[];
  defaultTimezone: string;
  initial?: NewAuditInitial;
}) {
  const [state, formAction, pending] = useActionState(createAuditAction, BLANK_AUDIT_STATE);
  // The operator's own last choice wins over the pre-fill, which wins over the
  // default: a rejected submission must not silently flip the source back to
  // what the request suggested and lose what they had switched to.
  const [source, setSource] = useState(state.values.source || initial?.source || 'api_key');

  return (
    <form action={formAction}>
      {state.formError ? (
        <p className="error" role="alert">
          {state.formError}
        </p>
      ) : null}

      {/* The request this audit is being started from. The action treats a
          malformed value as absent, so this is a convenience rather than a
          trust boundary. */}
      {initial ? <input type="hidden" name="request_id" value={initial.requestId} /> : null}

      <label htmlFor="business_name">Business name</label>
      <input
        id="business_name"
        name="business_name"
        type="text"
        required
        autoFocus
        maxLength={120}
        defaultValue={state.values.business_name || initial?.businessName || ''}
        aria-invalid={state.errors.business_name ? true : undefined}
        aria-describedby={state.errors.business_name ? 'business_name-error' : undefined}
      />
      <FieldError id="business_name-error" message={state.errors.business_name} />

      <fieldset>
        <legend>Data source</legend>
        <p className="muted hint">
          A read-only API key gives the most accurate audit — it can see notes and job
          activity, so &ldquo;never followed up&rdquo; is measured rather than inferred.
        </p>

        {/* API key FIRST: it is the preferred path (D-12), and the order of the
            options is the recommendation. */}
        <label className="check">
          <input
            type="radio"
            name="source"
            value="api_key"
            checked={source === 'api_key'}
            onChange={() => setSource('api_key')}
          />
          Read-only API key
        </label>

        <label className="check">
          <input
            type="radio"
            name="source"
            value="csv"
            checked={source === 'csv'}
            onChange={() => setSource('csv')}
          />
          CSV upload
        </label>
      </fieldset>

      {source === 'api_key' ? (
        <>
          <label htmlFor="api_key">ServiceM8 API key</label>
          <p className="muted hint">
            From the prospect&rsquo;s own Settings &rarr; API Keys. Stored encrypted; only the
            last four characters are ever shown.
          </p>
          <input
            id="api_key"
            name="api_key"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            aria-invalid={state.errors.api_key ? true : undefined}
            aria-describedby={state.errors.api_key ? 'api_key-error' : undefined}
          />
          <FieldError id="api_key-error" message={state.errors.api_key} />

        </>
      ) : (
        <>
          <label htmlFor="csv_file">Job List CSV</label>
          <p className="muted hint">
            From the prospect&rsquo;s ServiceM8 reporting &rarr; Job List export. You&rsquo;ll
            confirm which column is which on the next screen.
          </p>
          {/* THE FILE IS ALREADY HERE (C-12). The prospect attached it to their
              own request, so asking the operator to find it on their phone would
              be asking them to re-download something the server is holding. The
              input comes BACK the moment that file is refused — an empty export,
              a sheet saved by hand, one whose object has been purged — because
              at that point the stored file is not the answer and the only way
              forward is a different one. */}
          {initial?.csvFilename && !state.errors.csv_file ? (
            <>
              <p className="muted">
                Using the file attached to the request: {initial.csvFilename} (
                {initial.csvSize}).
              </p>
              <input type="hidden" name="use_request_file" value="1" />
            </>
          ) : (
            <>
              <input
                id="csv_file"
                name="csv_file"
                type="file"
                accept=".csv,text/csv"
                required
                aria-invalid={state.errors.csv_file ? true : undefined}
                aria-describedby={state.errors.csv_file ? 'csv_file-error' : undefined}
              />
              <FieldError id="csv_file-error" message={state.errors.csv_file} />
            </>
          )}
        </>
      )}

      {/* Outside the branch: both paths need it. The zone governs display and
          the window edges, and a CSV upload has exactly the same need of it as
          a key does. */}
      <label htmlFor="timezone">Timezone</label>
      <select id="timezone" name="timezone" defaultValue={defaultTimezone}>
        {timezones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>

      <button type="submit" disabled={pending}>
        {pending
          ? source === 'csv'
            ? 'Reading the export…'
            : 'Fetching 90 days…'
          : source === 'csv'
            ? 'Upload and map columns'
            : 'Generate audit'}
      </button>
    </form>
  );
}
