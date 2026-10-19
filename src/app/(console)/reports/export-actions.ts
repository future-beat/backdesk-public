'use server';

/**
 * THE DESIGN-PARTNER CSV (Phase 15, RPT-05, D-04, D-10).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS FILE CAN NEVER CARRY: a phone number, a caller, a message      │
 * │ body, a customer name, a quote line. Nothing on its path reads one. The  │
 * │ read is the newest FROZEN `figures` document per (client, month) — counts│
 * │ only — and the only other fact is each client's NAME, read through the   │
 * │ operator's own JWT. The writer's fourteen-column header is byte-pinned   │
 * │ and its source is grepped for personal-field tokens (partner-csv.test).  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY A SERVER ACTION, AND NOT A ROUTE ────────────────────────────────────
 *
 * D-04 says "a server action", and UI-SPEC §3a decided the mechanism: the
 * action returns `{ csv, filename, rows }` and the client island builds a Blob
 * and clicks a temporary `<a download>`. No navigation, nothing written, no
 * confirm step. The in-repo precedent for a download is the GET route handler
 * under `audits/requests/[id]/csv`; a `reports/csv/route.ts` with the same guard
 * is the DOCUMENTED FALLBACK only if the phone UAT shows the island cannot
 * download on iOS Safari (research OQ2). It is not built — never both.
 *
 * ── THE GATE IS FIRST, AND THE ORDER IS THE PROPERTY (T-15-03) ──────────────
 *
 * `listLatestReportFiguresForExport` reads across EVERY tenant through the
 * service-role path, where RLS is inert by design. A Server Action id is
 * global — POSTable from any route, `proxy.ts` or no — so `requireOperator()`
 * runs before any read, and a denied caller costs nothing but the sentence.
 * `tests/export-csv-action.test.ts` pins the ordering by the mocks' call counts.
 *
 * ── A STRICT PARSE, NEVER RAW JSONB (T-15-09) ───────────────────────────────
 *
 * Every row's `figures` goes through `reportFiguresSchema` before the writer
 * sees it: the block arrives typed, or `undefined` for a month frozen before
 * Phase 15 (its cells are empty, never zero). A document that fails the parse
 * fails the whole export — a half row in a sales deck is worse than a retry.
 *
 * The month is `YYYY-MM` SLICED from `period_start`, which is already the local
 * calendar date the month was cut in; it is never reformatted through a Date.
 */
import { reportFiguresSchema } from '@/core/reporting/document';
import { partnerCsv, type PartnerCsvInput } from '@/core/reporting/partner-csv';
import { listLatestReportFiguresForExport } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../_auth';
import {
  BLANK_EXPORT_STATE,
  EXPORT_FAILED_MESSAGE,
  EXPORT_FILENAME_PREFIX,
  type ExportState,
} from './export-state';

/**
 * `useActionState` calls this with `(previousState, formData)`. It reads
 * NEITHER — the export takes no input, so there is nothing a caller can POST
 * that changes what is read — and declares no parameters for that reason.
 */
export async function exportDesignPartnerCsv(): Promise<ExportState> {
  const access = await requireOperator();
  if (access !== 'ok') {
    return { ...BLANK_EXPORT_STATE, error: OPERATOR_DENIED_MESSAGE[access] };
  }

  try {
    const rows = await listLatestReportFiguresForExport();

    // NAMES THROUGH THE OPERATOR'S OWN JWT — the queue page's two-authority
    // rule: the frozen figures come through the service role, the names through
    // RLS, so a client this operator cannot see is never named in the file.
    const supabase = await createClient();
    const { data, error } = await supabase.from('tenants').select('id, name');
    if (error) throw new Error('tenant names read failed');

    const names = new Map(
      ((data as { id: string; name: string }[] | null) ?? []).map((row) => [row.id, row.name]),
    );

    const inputs: PartnerCsvInput[] = rows.map((row) => ({
      clientName: names.get(row.tenantId) ?? 'Another client',
      month: row.periodStart.slice(0, 7),
      missedCalls: reportFiguresSchema.parse(row.figures).missedCalls,
    }));

    const csv = partnerCsv(inputs);
    // The operator's date, UTC — the file's name, not a figure.
    const filename = `${EXPORT_FILENAME_PREFIX}${new Date().toISOString().slice(0, 10)}.csv`;

    return { csv, filename, rows: inputs.length, error: null };
  } catch {
    // The caught value is DISCARDED (WR-08, T-2-02): a driver or parse error can
    // carry column names and stored values, and the operator can act on none.
    console.error('[reports] export read failed');
    return { ...BLANK_EXPORT_STATE, error: EXPORT_FAILED_MESSAGE };
  }
}
