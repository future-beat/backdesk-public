import { sanitiseCsvFilename } from '@/core/intake/csv-sniff';
import { getAuditRequest, getAuditUpload } from '@/db/repository';

import { requireOperator } from '../../../../_auth';

/**
 * The Job List export a stranger attached to their audit request, handed to the
 * one person allowed to read it (D-11, D-15, LAND-04).
 *
 * ── THE ROUTE'S OWN CHECK IS THE REAL CONTROL ───────────────────────────────
 *
 * This file sits under `(console)`, so `proxy.ts` gates the path on the app host
 * and the layout's `getClaims()` gate covers every PAGE beside it. Neither
 * covers this: route handlers are not wrapped by a route group's layout, and the
 * proxy is a routing decision made by a matcher regex that has been edited three
 * times this phase. `requireOperator()` is the first statement here for the same
 * reason it is the first statement in every console action.
 *
 * ── EVERY REFUSAL IS THE SAME REFUSAL (T-9-09) ──────────────────────────────
 *
 * A caller with no session, a caller with a session and no allowlist row, a
 * malformed id, an id that names no row, a row with no attachment and a row
 * whose object Storage will not hand over all get a bodiless not-found. The
 * alternative — distinguishing "you may not" from "there is nothing here" —
 * turns this route into an oracle for two things at once: which request ids
 * exist, and who is on the operator allowlist. Neither is a fact worth spending
 * on a nicer error message for a caller who by construction is not an operator.
 *
 * That is also why the operator check runs BEFORE `context.params` is awaited:
 * an id that is never read cannot be probed for by timing the response.
 *
 * ── WHAT THE BROWSER IS TOLD ABOUT THE BYTES ────────────────────────────────
 *
 * `attachment` plus the no-sniff header so a file whose contents are HTML
 * cannot be rendered as a page on the console's own origin, and the private
 * no-store one so a shared proxy or the browser's disk cache does not keep a copy
 * of somebody else's customer list on the operator's phone after the request row
 * has been purged (V8, V12).
 */

/** The repository's Storage client and the postgres driver both need Node. */
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name to fall back to when the row somehow holds a path but no filename. */
const FALLBACK_FILENAME = 'job-list.csv';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await requireOperator();
  if (access !== 'ok') {
    return new Response(null, { status: 404 });
  }

  // Next 16 hands a route handler's `params` as a PROMISE. Destructuring it in
  // the signature yields a Promise where a string is expected, which `tsc` will
  // catch on `.test()` but not on a template literal — so it is awaited here,
  // once, after the gate.
  const { id } = await context.params;

  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, and
  // `getAuditRequest` asserts the shape itself; checking here keeps the answer
  // identical to the unknown-id answer instead of a thrown 500.
  if (!UUID_PATTERN.test(id)) {
    return new Response(null, { status: 404 });
  }

  const request = await getAuditRequest(id);
  if (!request?.csvObjectPath) {
    return new Response(null, { status: 404 });
  }

  const blob = await getAuditUpload(request.csvObjectPath);
  if (!blob) {
    // Also the post-purge answer: the object is deleted 30 days after it was
    // attached (D-11) and the row keeps its columns only until the sweep clears
    // them, so "the path exists and the object does not" is an ordinary state.
    return new Response(null, { status: 404 });
  }

  // Sanitised AGAIN, though the public action already sanitised it before the
  // upload. This value is interpolated into a response header, the allowlist is
  // idempotent, and a header built from a stranger's filename is exactly the
  // place a second application of a cheap rule earns its line.
  const filename = sanitiseCsvFilename(request.csvFilename ?? FALLBACK_FILENAME);

  return new Response(blob, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
