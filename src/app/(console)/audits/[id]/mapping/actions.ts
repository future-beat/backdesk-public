'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { confirmCsvMapping } from '@/core/audit/csv-intake';
import { CANONICAL_FIELDS, mappingKey, type CsvMapping } from '@/core/audit/csv-mapping';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../../_auth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MappingState = {
  /** Per-field message, keyed by canonical field — the named-column error. */
  fieldErrors: Partial<Record<string, string>>;
  formError: string | null;
  /**
   * The proceed-with-warning gate. Present means: rows were skipped, the
   * operator has been told how many and why, and a second submit carrying
   * `acknowledge` will generate the audit from the survivors.
   *
   * `mappingKey` is the mapping those counts were computed under. The form only
   * sends `acknowledge` while the selects still match it — otherwise changing a
   * column after seeing "4 rows skipped" would carry the acknowledgement over to
   * a mapping whose real count nobody has been shown.
   */
  warning: { skipped: number; usable: number; reason: string; mappingKey: string } | null;
};

/**
 * Confirm the column mapping and publish the audit (AUD-01, D-12).
 *
 * AUTH FIRST, BEFORE THE BODY IS PARSED (WR-01). A Server Action id is global
 * and this one writes `prospect_quote_lines`; the `(console)` layout's gate runs
 * only when a layout renders, which is after the action has already finished.
 *
 * AND AUTHORIZED, NOT MERELY SIGNED IN (CR-01). `confirmCsvMapping` writes
 * `prospect_quote_lines` — the highest-sensitivity table in the phase — through
 * the service-role repository, where the `is_operator()` policy does not run.
 * `requireOperator()` runs it explicitly.
 *
 * The action itself carries no orchestration — `confirmCsvMapping` lives in
 * `src/core/audit/csv-intake.ts` precisely so that factoring it out for
 * testability does not publish it as a second, unguarded endpoint.
 */
export async function confirmMappingAction(
  _previous: MappingState,
  formData: FormData,
): Promise<MappingState> {
  const access = await requireOperator();
  if (access !== 'ok') {
    return {
      fieldErrors: {},
      formError: OPERATOR_DENIED_MESSAGE[access],
      warning: null,
    };
  }

  const prospectId = formData.get('prospect_id');
  if (typeof prospectId !== 'string' || !UUID_PATTERN.test(prospectId)) {
    return { fieldErrors: {}, formError: 'That audit could not be found.', warning: null };
  }

  // Seven column NAMES, and nothing else, is the whole of the browser's
  // contribution to this step — the rows are re-read server-side from
  // `csv_staging`. An empty select means "not mapped", never an empty header.
  const mapping = Object.fromEntries(
    CANONICAL_FIELDS.map((field) => {
      const raw = formData.get(field.key);
      return [field.key, typeof raw === 'string' && raw !== '' ? raw : null];
    }),
  ) as CsvMapping;

  const result = await confirmCsvMapping({
    prospectId,
    mapping,
    acknowledgedSkips: formData.get('acknowledge') === '1',
  });

  if (result.ok) {
    revalidatePath('/audits');
    revalidatePath(`/audits/${prospectId}`);
    redirect(`/audits/${prospectId}`);
  }

  switch (result.kind) {
    case 'missing_columns':
      return {
        // The UI-SPEC named-column error, verbatim, ON the failing select —
        // the operator fixes this by changing that specific dropdown.
        fieldErrors: Object.fromEntries(
          result.missing.map((field) => [
            field.key,
            `Couldn't find a column for ${field.label}. Pick it from the dropdown or re-export the Job List from ServiceM8 reporting.`,
          ]),
        ),
        formError: null,
        warning: null,
      };

    case 'needs_acknowledgement':
      return {
        fieldErrors: {},
        formError: null,
        warning: {
          skipped: result.skipped,
          usable: result.usable,
          reason: result.reason,
          mappingKey: mappingKey(mapping),
        },
      };

    case 'no_usable_rows':
      return {
        fieldErrors: {},
        formError: `No rows could be used — ${result.reason}. Check the column mapping, or re-export the Job List covering the last 90 days.`,
        warning: null,
      };

    case 'unknown_header':
      return {
        fieldErrors: {},
        formError: 'That column is no longer part of this upload. Reload the page and try again.',
        warning: null,
      };

    case 'no_staging':
      return {
        fieldErrors: {},
        formError:
          'This upload has already been used or has expired. Start a new audit and upload the CSV again.',
        warning: null,
      };
  }
}
