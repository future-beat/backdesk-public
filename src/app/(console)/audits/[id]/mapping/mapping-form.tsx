'use client';

import { useActionState, useState } from 'react';

import { mappingKey, type CanonicalFieldKey, type CsvMapping } from '@/core/audit/csv-mapping';

import { confirmMappingAction } from './actions';
import { BLANK_MAPPING_STATE } from './action-state';

export interface MappingFieldView {
  key: CanonicalFieldKey;
  label: string;
  required: boolean;
}

/**
 * The column-mapping confirmation (02-UI-SPEC Screen 4, RESEARCH Pattern 7).
 *
 * ── THE ONE PLACE THE PRODUCT ASKS A HUMAN TO CONFIRM AN INFERENCE ──────────
 *
 * Every select arrives pre-filled by `inferMapping`, and none of them is acted
 * on until the operator presses Confirm. The preview below the selects re-renders
 * from client state as they change, so what the operator approves is the actual
 * five rows the audit will be built from, under the actual mapping — not a
 * description of one.
 *
 * ONLY THE MAPPING IS SUBMITTED. The five preview rows are props for display;
 * the confirm action re-reads all rows from `prospects.csv_staging` server-side.
 * A tampered form can therefore mis-map the operator's own columns — which is
 * the thing this screen exists for them to see — and nothing else.
 */
export function MappingForm({
  prospectId,
  fields,
  headers,
  inferred,
  previewRows,
  totalRows,
}: {
  prospectId: string;
  fields: MappingFieldView[];
  headers: string[];
  inferred: CsvMapping;
  previewRows: Record<string, string | undefined>[];
  totalRows: number;
}) {
  const [state, formAction, pending] = useActionState(confirmMappingAction, BLANK_MAPPING_STATE);
  const [mapping, setMapping] = useState<CsvMapping>(inferred);

  function choose(key: CanonicalFieldKey, header: string) {
    setMapping((current) => ({ ...current, [key]: header === '' ? null : header }));
  }

  /**
   * The warning belongs to the mapping it was computed under. Change a column
   * and the counts on screen are about something else, so both the message and
   * the acknowledgement it authorises disappear — the operator is asked again
   * with the real numbers rather than proceeding on a stale count.
   */
  const warning =
    state.warning && state.warning.mappingKey === mappingKey(mapping) ? state.warning : null;

  return (
    <form action={formAction}>
      <input type="hidden" name="prospect_id" value={prospectId} />

      {state.formError ? (
        <p className="error" role="alert">
          {state.formError}
        </p>
      ) : null}

      {/* The box scrolls, not the page: realistic ServiceM8 export headers
          (`Job Contact Mobile Number`) give each select its widest option's
          width and take the two columns to 388px inside the 30rem form
          (measured 408px at 390). The preview table below already has its own
          box; the quotes table's rule (02-05, 8de755c); G-07-6. */}
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Column mapping">
        <table>
          <caption className="muted meta">
            {totalRows} row{totalRows === 1 ? '' : 's'} uploaded. Check each column before
            confirming.
          </caption>
          <thead>
            <tr>
              <th scope="col">Audit field</th>
              <th scope="col">Column in your export</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.key}>
                <th scope="row">
                  {field.label}
                  {field.required ? null : <span className="muted"> (optional)</span>}
                </th>
                <td>
                  <select
                    name={field.key}
                    aria-label={`Column for ${field.label}`}
                    value={mapping[field.key] ?? ''}
                    onChange={(event) => choose(field.key, event.target.value)}
                    aria-invalid={state.fieldErrors[field.key] ? true : undefined}
                  >
                    {/* Present for every field, required ones included: an empty
                        select is how an unmappable column announces itself, and
                        hiding the option would force a wrong answer. */}
                    <option value="">— not in this export —</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  {state.fieldErrors[field.key] ? (
                    <p className="field-error" role="alert">
                      {state.fieldErrors[field.key]}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Preview</h2>
      <p className="muted hint">
        The first {previewRows.length} row{previewRows.length === 1 ? '' : 's'} as the audit
        will read {previewRows.length === 1 ? 'it' : 'them'}.
      </p>

      <div className="table-scroll" tabIndex={0} role="region" aria-label="Column preview">
        <table>
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.key} scope="col">
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, index) => (
              <tr key={index}>
                {fields.map((field) => {
                  const header = mapping[field.key];
                  const value = header === null ? null : (row[header] ?? '');
                  return (
                    <td key={field.key} className="cell-truncate">
                      {value === null || value === '' ? <span className="muted">—</span> : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {warning ? (
        <>
          {/* Proceed-with-warning (02-UI-SPEC "Error — CSV row validation").
              The count comes first because it is what the operator has to
              decide about; the reason explains it. */}
          <p className="error" role="alert">
            {warning.skipped} row{warning.skipped === 1 ? '' : 's'} skipped — {warning.reason}.
            The audit will be generated from the {warning.usable} valid row
            {warning.usable === 1 ? '' : 's'}.
          </p>
          {/* Present only on the submit that FOLLOWS the warning, so proceeding
              is an act rather than a hidden default. */}
          <input type="hidden" name="acknowledge" value="1" />
        </>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Generating audit…' : warning ? 'Generate from the valid rows' : 'Confirm mapping'}
      </button>
    </form>
  );
}
