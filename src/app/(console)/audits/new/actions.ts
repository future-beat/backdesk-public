'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Papa from 'papaparse';
import { z } from 'zod';

import { MAX_CSV_BYTES, MAX_CSV_ROWS, type CsvRow } from '@/core/audit/csv-mapping';
import { generateAuditFromApiKey } from '@/core/audit/generate';
import {
  clearAuditRequestCsv,
  createProspect,
  deleteAuditUpload,
  getAuditRequest,
  getAuditUpload,
  markAuditRequestConverted,
} from '@/db/repository';
import type { Sm8FailureKind } from '@/core/servicem8/types';
import { isSupportedTimeZone } from '@/core/shared/tenant';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../_auth';

/**
 * Failure copy, verbatim from the 02-UI-SPEC Copywriting Contract row
 * "Error — audit generation (API path)".
 *
 * ONE sentence of diagnosis and ONE of instruction, and the instruction names
 * the fallback: a prospect who will not or cannot produce a working key is not
 * a lost audit, they are a CSV upload (D-12). An error message that leaves the
 * operator staring at a dead end during a sales call is a message that loses
 * the meeting.
 */
const CLASSIFIED_REASON: Readonly<Record<Sm8FailureKind, string>> = {
  auth_failed: 'ServiceM8 rejected the key',
  rate_limited: 'ServiceM8 is rate-limiting this account',
  server_error: 'ServiceM8 returned an error',
  network_error: 'ServiceM8 could not be reached',
  parse_error: 'ServiceM8 returned data in an unexpected shape',
};

function failureMessage(kind: Sm8FailureKind): string {
  // The CLASSIFIED kind only — never a status line, a URL, or a caught error's
  // message. A `fetch` rejection stringifies to the request URL, and the one
  // header on that request is the prospect's API key (threat T-2-02).
  return (
    `Couldn't fetch this prospect's data: ${CLASSIFIED_REASON[kind]}. ` +
    'Check the read-only key or fall back to a CSV export.'
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name to fall back to when a stored object's row has lost its filename. */
const REQUEST_CSV_FALLBACK_NAME = 'job-list.csv';

/**
 * Record that this audit request became this prospect, and let go of the export
 * (D-15, T-9-06, T-9-30).
 *
 * ── THE MARK IS GUARDED, AND LOSING IS NOT AN ERROR ─────────────────────────
 *
 * `markAuditRequestConverted` writes `WHERE converted_prospect_id IS NULL`, so
 * two operators (or one operator and a double-tapped button) converting the same
 * request produce ONE link and the loser gets `false`. The loser still made a
 * real prospect and a real audit — that work is not thrown away and the redirect
 * still happens — but the request keeps pointing at the FIRST prospect, because
 * two audits for one request is a mistake worth being able to see rather than a
 * link worth overwriting. It is logged, not surfaced: the operator is already
 * being taken to the audit they just created.
 *
 * ── AND THE OBJECT GOES NOW, NOT IN THIRTY DAYS ─────────────────────────────
 *
 * The stored CSV is a stranger's CUSTOMERS' names and phone numbers. Its purpose
 * ends the moment it has been parsed into a prospect, and the daily purge is the
 * BACKSTOP for a request nobody ever opened, not the plan for one that has been
 * consumed. A failed delete costs nothing: the row keeps its path and its
 * `csv_purge_after` stamp, so the sweep retries tomorrow.
 *
 * ── AND THE ROW LETS GO OF IT TOO (WR-05) ───────────────────────────────────
 *
 * Deleting the object without clearing the columns left the console pointing at
 * a file that no longer exists: the detail page kept rendering `Download CSV`
 * and the filename, the list kept saying `· CSV attached`, and the button
 * opened a blank 404 tab. It self-healed — the row stayed in
 * `listExpiredAuditUploads` until `csv_purge_after`, and `remove()` on a missing
 * object reports no error — but only after up to thirty days.
 *
 * SAME ORDER AS THE PURGE, and for the same reason: object first, row second.
 * Clearing the row first and then failing to delete would leave an ORPHAN — a
 * file full of a stranger's customers in a bucket with nothing left pointing at
 * it, so nothing would ever try again. Guarding the clear on the delete's own
 * `true` is what keeps that ordering honest: a delete that did not happen
 * leaves the path and the purge stamp exactly where the sweep can find them
 * tomorrow.
 */
async function convertRequest(
  requestId: string,
  prospectId: string,
  objectPath: string | null,
): Promise<void> {
  const marked = await markAuditRequestConverted(requestId, prospectId);
  if (!marked) {
    console.error('[audit-requests] request already converted');
  }

  if (objectPath && (await deleteAuditUpload(objectPath))) {
    await clearAuditRequestCsv(requestId);
  }

  revalidatePath(`/audits/requests/${requestId}`);
  revalidatePath('/audits/requests');
}

export type CreateAuditState = {
  /** Message under the failing control. */
  errors: { business_name?: string; api_key?: string; csv_file?: string };
  /** A failure belonging to no single control. */
  formError: string | null;
  /**
   * The operator's input, echoed back so a rejection does not cost their
   * typing — MINUS the API key, which is never returned. Re-rendering it would
   * put a live third-party credential into the HTML payload and the client
   * router cache. Pasting again costs one Cmd-V.
   */
  values: { business_name: string; source: string };
};

const auditSchema = z.object({
  business_name: z
    .string()
    .trim()
    .min(1, 'Enter the prospect’s business name.')
    .max(120, 'That name is too long.'),
  // Length only. ServiceM8 documents no key format, and a regex invented here
  // would reject a valid key with a message blaming the operator.
  api_key: z.string().trim().min(8, 'Paste the full API key — this looks too short.'),
});

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

const businessNameSchema = auditSchema.shape.business_name;

/**
 * Parse an uploaded Job List export and stage it for the mapping step (D-12).
 *
 * ── BOTH CAPS BIND BEFORE THE WORK DOES (T-2-06) ────────────────────────────
 *
 * `file.size` is checked before a single byte is read, and the parse itself runs
 * with papaparse's `preview` set to `MAX_CSV_ROWS + 1` — so the row cap stops
 * the parser rather than merely rejecting its output. A cap enforced after a
 * full parse is not a cap on anything; it is a cap on the error message. The
 * `+ 1` is what lets an over-cap file be DETECTED: stopping at exactly the limit
 * cannot tell a 5,000-row file from a 500,000-row one.
 *
 * The upload is attacker-influenceable in the ordinary case — the file comes
 * from the prospect, who is a stranger. papaparse does no evaluation and the
 * cells are treated as data from here to the report, which React escapes; there
 * is no CSV re-export in this phase for a formula-injection payload to escape
 * into (T-2-14).
 */
async function stageCsvUpload(
  file: File,
  values: CreateAuditState['values'],
  timezone: string | undefined,
  /**
   * Run against the new prospect's id AFTER it exists and BEFORE the redirect
   * (09-06). It is a callback rather than a return value for one reason:
   * `finishStaging` ends in `redirect()`, which THROWS, so there is no moment
   * after this function returns in which a caller could do anything at all. The
   * caps, the parse and every refusal above are untouched by its presence.
   */
  afterCreate?: (prospectId: string) => Promise<void>,
): Promise<CreateAuditState> {
  if (file.size === 0) {
    return { errors: { csv_file: 'That file is empty.' }, formError: null, values };
  }

  if (file.size > MAX_CSV_BYTES) {
    return {
      errors: {
        csv_file: `That file is larger than ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))}MB. Re-export the Job List with a shorter date range.`,
      },
      formError: null,
      values,
    };
  }

  const text = await file.text();

  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    preview: MAX_CSV_ROWS + 1,
  });

  // A trailing comma on the header line produces an empty-named column; it
  // carries nothing and would render as a nameless dropdown option.
  const headers = (parsed.meta.fields ?? []).filter((header) => header.trim() !== '');

  if (headers.length === 0) {
    return {
      errors: {
        csv_file:
          'That file has no header row. Export the Job List from ServiceM8 reporting rather than saving a sheet by hand.',
      },
      formError: null,
      values,
    };
  }

  if (parsed.data.length === 0) {
    return {
      errors: { csv_file: 'That file has a header row and no data.' },
      formError: null,
      values,
    };
  }

  if (parsed.data.length > MAX_CSV_ROWS) {
    return {
      errors: {
        csv_file: `That file has more than ${MAX_CSV_ROWS} rows. Re-export the Job List with a shorter date range.`,
      },
      formError: null,
      values,
    };
  }

  return finishStaging(
    { headers, rows: parsed.data },
    values,
    timezone,
    afterCreate,
  );
}

/**
 * The tail of the staging path, split out so a caller can act on the prospect
 * between its creation and the redirect that ends the request (09-06).
 *
 * Nothing about the CSV is decided here — every cap and every refusal has
 * already bound above. This function creates the row, lets the audit-request
 * conversion (if there is one) record what the request became, and leaves.
 */
async function finishStaging(
  staging: { headers: string[]; rows: CsvRow[] },
  values: CreateAuditState['values'],
  timezone: string | undefined,
  afterCreate?: (prospectId: string) => Promise<void>,
): Promise<CreateAuditState> {
  const prospect = await createProspect({
    businessName: values.business_name,
    source: 'csv',
    ...(timezone ? { timezone } : {}),
    // The staging workspace. Cleared by `storeAuditResults` in the same
    // transaction that publishes the audit — it holds a second copy of every
    // contact detail and must not outlive the confirmation that consumed it.
    csvStaging: { headers: staging.headers, rows: staging.rows },
  });

  if (afterCreate) {
    await afterCreate(prospect.id);
  }

  revalidatePath('/audits');
  redirect(`/audits/${prospect.id}/mapping`);
}

/**
 * Create a prospect and generate their Quote Leakage Audit (AUD-01, D-12).
 *
 * AUTH FIRST, BEFORE THE BODY IS EVEN PARSED (WR-01). Server Action ids are
 * global: this action is invokable by POSTing its id to any route, including one
 * the proxy never sees, and the `(console)` layout's own gate runs only when a
 * layout renders — which is after the action has finished. There is nothing in
 * this request body worth parsing for a caller with no session, and the body
 * contains a live credential.
 *
 * AND AUTHORIZATION IS A SEPARATE CHECK (CR-01). An earlier revision reasoned
 * that the operator allowlist was "the whole of the authorization story here,
 * enforced by the `is_operator()` policies plus the withheld INSERT grant on
 * `prospects`". That was false for this code path: `createProspect` writes
 * through `getDb()`, the service-role connection, where RLS is inert by design
 * and a grant withheld from `authenticated` never applies because the write is
 * not made as `authenticated`. A valid session was the only thing being proven.
 *
 * `requireOperator()` proves the rest, by reading the allowlist through the
 * operator's own JWT — the same shape the client actions use to prove tenant
 * membership. See `src/app/(console)/_auth.ts`.
 */
export async function createAuditAction(
  _previous: CreateAuditState,
  formData: FormData,
): Promise<CreateAuditState> {
  const values = {
    business_name: readString(formData, 'business_name'),
    source: readString(formData, 'source') || 'api_key',
  };

  const access = await requireOperator();
  if (access !== 'ok') {
    return { errors: {}, formError: OPERATOR_DENIED_MESSAGE[access], values };
  }

  /**
   * The audit request this audit is being started FROM, if any (D-15, LAND-04).
   *
   * READ AFTER THE GATE, like everything else in this body. A malformed value is
   * treated as ABSENT rather than as an error: the parameter arrives from a query
   * string that anything can rewrite, and the honest response to a request id
   * that cannot exist is the plain new-audit form the operator was going to get
   * anyway — not a refusal that tells a prober their id was the wrong shape.
   */
  const requestIdRaw = readString(formData, 'request_id');
  const requestId = UUID_PATTERN.test(requestIdRaw) ? requestIdRaw : null;

  const timezoneRaw = readString(formData, 'timezone');
  // An unsupported identifier falls back to the schema default rather than
  // throwing from inside `sm8ToUtc` three layers down (the Phase 1 IANA rule).
  const timezone = isSupportedTimeZone(timezoneRaw) ? timezoneRaw : undefined;

  // ── The CSV branch (D-12) ────────────────────────────────────────────────
  //
  // It does NOT generate an audit. It parses, stages, and hands the operator
  // the mapping step — because the column layout of a ServiceM8 Job List export
  // is undocumented and inferring it is a guess that must be confirmed before
  // it becomes a document (RESEARCH Pattern 7).
  if (values.source === 'csv') {
    const nameOnly = businessNameSchema.safeParse(values.business_name);
    if (!nameOnly.success) {
      return {
        errors: { business_name: nameOnly.error.issues[0].message },
        formError: null,
        values,
      };
    }

    const chosen = formData.get('csv_file');
    let file = chosen instanceof File && chosen.name !== '' ? chosen : null;

    // The path of the object being CONSUMED, so the conversion can delete it.
    // Null when the operator uploaded their own file: this action deletes only
    // what it read.
    let objectPath: string | null = null;

    // No new file, but a request that has one: read the stored object and feed
    // it to the SAME `stageCsvUpload` a manual upload goes through. Nothing
    // about the parse, the 4 MiB cap or the 5,000-row cap is relaxed because the
    // bytes came from Storage rather than from a file picker — this file was
    // uploaded by a stranger through a public form, which is if anything the
    // stronger reason to make the caps bind.
    if (!file && requestId) {
      const request = await getAuditRequest(requestId);

      if (request?.csvObjectPath) {
        const blob = await getAuditUpload(request.csvObjectPath);

        if (blob) {
          file = new File(
            [await blob.arrayBuffer()],
            request.csvFilename ?? REQUEST_CSV_FALLBACK_NAME,
            { type: 'text/csv' },
          );
          objectPath = request.csvObjectPath;
        }
      }
    }

    // Falls through to the ORIGINAL sentence when the request has no object, or
    // had one and the 30-day purge has taken it: the operator's next move is the
    // same either way — attach a file, or switch to the API key.
    if (!file) {
      return {
        errors: { csv_file: 'Choose the Job List CSV exported from ServiceM8.' },
        formError: null,
        values,
      };
    }

    return stageCsvUpload(
      file,
      { ...values, business_name: nameOnly.data },
      timezone,
      requestId
        ? async (prospectId) => convertRequest(requestId, prospectId, objectPath)
        : undefined,
    );
  }

  const parsed = auditSchema.safeParse({
    business_name: values.business_name,
    api_key: readString(formData, 'api_key'),
  });

  if (!parsed.success) {
    const errors: CreateAuditState['errors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'business_name' || field === 'api_key') errors[field] = issue.message;
    }
    return { errors, formError: null, values };
  }

  const result = await generateAuditFromApiKey({
    businessName: parsed.data.business_name,
    apiKey: parsed.data.api_key,
    timezone,
  });

  if (!result.ok) {
    // A rejected key belongs on the FIELD — the operator fixes it by pasting a
    // different value into that input. Everything else is about the world
    // rather than about this control.
    if (result.kind === 'auth_failed') {
      return { errors: { api_key: failureMessage(result.kind) }, formError: null, values };
    }
    return { errors: {}, formError: failureMessage(result.kind), values };
  }

  if (requestId) {
    // No object path: the operator chose the key over whatever was attached, so
    // this action consumed nothing and has nothing to delete. The request's own
    // `csv_purge_after` stamp still governs the file (D-11).
    await convertRequest(requestId, result.prospectId, null);
  }

  revalidatePath('/audits');
  redirect(`/audits/${result.prospectId}`);
}
