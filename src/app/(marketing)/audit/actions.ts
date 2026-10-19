'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { sendOperatorAlert } from '@/core/alerts/operator-email';
import { auditRequestSmsBody, sendOperatorSms } from '@/core/alerts/operator-sms';
import { parseArrivalSource } from '@/core/intake/arrival-source';
import {
  AUDIT_REQUEST_FIELDS,
  BAND_LABELS,
  TRADE_LABELS,
  auditRequestSchema,
  toAuditFieldErrors,
} from '@/core/intake/audit-request';
import { sanitiseCsvFilename, sniffCsv } from '@/core/intake/csv-sniff';
import { clientIpFromHeaders, hashClientIp } from '@/core/intake/ip-hash';
import { throttleDecision } from '@/core/intake/throttle';
import { getServerEnv } from '@/core/shared/env';
import {
  attachAuditRequestCsv,
  bumpAuditRequestThrottle,
  createAuditRequest,
  putAuditUpload,
  recordAuditRequestNotify,
} from '@/db/repository';
import type { AuditNotifyOutcome } from '@/db/schema';

import { AUDIT_FORM_COPY } from '../copy';
import type { AuditRequestState } from './action-state';

/**
 * The public audit request (Phase 9, LAND-02/LAND-03, D-10..D-14).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS ACTION HAS NO SESSION, BY DESIGN. It is the only write path in the  │
 * │ product an unauthenticated stranger can reach, and that is the product   │
 * │ requirement: a tradie who has never heard of us fills in a form on a     │
 * │ phone. There is no `requireOperator()` here and there must not be one.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Its gate is therefore VALIDATION rather than authentication: zod bounds every
 * field before anything is written, and two abuse controls sit in front of that
 * — an off-screen decoy field and a per-address hourly counter. The blast radius
 * is bounded structurally instead: this module imports five repository
 * functions, all of them from the tenant-less audit-request family or the
 * private uploads bucket, and it must never import the tenant closure or the
 * prospect family. A structural test in
 * tests/audit-request-action.test.ts reads this file and says so; the single
 * barrel import below is what makes that checkable rather than aspirational.
 *
 * ── ORDER IS THE GUARANTEE (D-13) ───────────────────────────────────────────
 *
 * decoy → validate → count → insert → upload → notify → record → redirect. The
 * first two are free and write nothing, which is why they come first: a bot and
 * a typo must both be answered without touching the database. The COUNT is
 * bumped before the insert on purpose, so a refused attempt still counts —
 * bumping afterwards would leave a submitter parked at the limit refused
 * forever and never counted. The row is
 * written FIRST and nothing after it can un-write it: a provider having a bad
 * afternoon costs the operator a late reply, never a lost request. Both senders
 * already refuse to throw; `Promise.allSettled` is the belt to their braces,
 * and it also means a slow email cannot delay the SMS.
 *
 * The UPLOAD obeys the same rule and is the reason the leg exists separately: a
 * Storage outage must cost the ATTACHMENT and not the request. The file is
 * refused (or accepted) before the insert, so a wrong file is one sentence and
 * no write; but once the row exists, a failed upload is a logged error name and
 * a row that says "No file attached" — which is true, and which the operator can
 * act on by asking for the export again.
 *
 * ── WHAT IS NEVER LOGGED (T-9-05) ───────────────────────────────────────────
 *
 * Not the form body, not the client IP, not a caught error's message. An error
 * NAME reaches the log and a fixed sentence from the copy module reaches the
 * page — the console's own rule, applied to the one surface where the reader is
 * a stranger rather than the operator.
 */

/**
 * How much of an attachment is decoded for the sniff. One line is all the check
 * needs, and a fixed slice means a hostile 4 MB single-line file cannot make the
 * decision expensive.
 */
const CSV_SNIFF_BYTES = 4096;

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * The attachment, or `null` when there is not one.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ AN UNTOUCHED FILE INPUT IS STILL SENT. A browser submits an empty     │
 * │ `<input type="file">` as a multipart part with `filename=""` and zero │
 * │ bytes — the field being optional does not stop it being transmitted.  │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * The runtime then reconstructs that part as a `File`, and what it calls the
 * file is not dependable: sometimes `''`, sometimes a placeholder (`blob`,
 * `undefined`). Reading "is it a `File`?" as "did they attach something?"
 * therefore sent every no-file submission into `sniffCsv`, where it failed the
 * `.csv` suffix and came back as the not-a-CSV sentence — an optional field
 * refusing every submission that left it optional (G-09-1, UAT test 1,
 * 2026-09-10).
 *
 * SIZE IS THE HALF THAT DOES NOT LIE. A real attachment has bytes; a name is
 * whatever the runtime decided to call an absence. So zero bytes is "no file"
 * whatever it was named, and the empty name is kept as the second reading, for
 * the runtimes that report the absence honestly.
 *
 * This NARROWS what counts as an attachment and does nothing else (T-9-04): a
 * named, non-empty part still goes to `sniffCsv` unchanged, so a renamed `.txt`
 * and an oversized export are refused exactly as they were.
 */
function attachedFile(formData: FormData): File | null {
  const part = formData.get('csv_file');
  if (!(part instanceof File)) return null;
  // The empty-input part: zero bytes, under whatever name the runtime invented.
  if (part.size === 0 || part.name.trim() === '') return null;
  return part;
}

/** `settled` → the column vocabulary, with the failing channel's name only. */
function outcomeOf(
  settled: PromiseSettledResult<{ ok: true } | { ok: false; kind: string; detail: string }>,
): { outcome: AuditNotifyOutcome; detail: string | null } {
  if (settled.status === 'rejected') {
    // Neither sender throws; if one ever does, the REASON's name only.
    const name = settled.reason instanceof Error ? settled.reason.name : 'UnknownError';
    return { outcome: 'failed', detail: name };
  }
  if (settled.value.ok) return { outcome: 'sent', detail: null };
  return {
    outcome: settled.value.kind === 'not_configured' ? 'not_configured' : 'failed',
    detail: settled.value.detail,
  };
}

export async function requestAuditAction(
  _previous: AuditRequestState,
  formData: FormData,
): Promise<AuditRequestState> {
  // ── THE DECOY, FIRST OF EVERYTHING (D-12, T-9-02) ─────────────────────────
  //
  // `website` is off-screen and `aria-hidden`, so a human never sees it and a
  // screen reader never reaches it; a form-filling bot completes it because
  // every other business form has one.
  //
  // THE RESPONSE MUST BE INDISTINGUISHABLE FROM A SUCCESS. Same redirect, no
  // row, no counter bump, no notification — and NO LOG LINE, which is the part
  // that is easy to get wrong: a log is not visible to the sender, but the
  // moment anything about this path differs in timing or output, the control is
  // worth nothing to the next bot operator who tests it.
  //
  // It is also read BEFORE zod, so a bot that fills the decoy and botches the
  // phone number is thanked rather than told which of its answers was wrong.
  //
  // `return redirect(...)` rather than a bare call: `redirect` throws to unwind
  // in production, but the guarantee that nothing below this line runs must not
  // depend on that — an explicit return makes the exit a fact about this
  // function rather than a fact about the framework.
  if (readString(formData, 'website').trim() !== '') {
    return redirect('/audit/thanks');
  }

  const values = Object.fromEntries(
    AUDIT_REQUEST_FIELDS.map((field) => [field, readString(formData, field)]),
  ) as AuditRequestState['values'];

  const parsed = auditRequestSchema.safeParse(values);
  if (!parsed.success) {
    // EVERY failing field at once, values preserved (UI-SPEC E7 "partial").
    return { errors: toAuditFieldErrors(parsed.error), formError: null, values };
  }

  const requestHeaders = await headers();

  // Diagnostic only, and bounded twice: 512 here and 512 again in the repository.
  const userAgent = requestHeaders.get('user-agent')?.slice(0, 512) ?? null;

  // ── THE PER-ADDRESS COUNTER (LAND-03, D-12, T-9-05) ───────────────────────
  //
  // The ADDRESS never leaves this line: `hashClientIp` salts and digests it, and
  // the digest is all that reaches the counter, the row or anything else. A null
  // address (local development, any server-side call) is not throttled and is
  // stored as null — a fabricated placeholder would collide every such request
  // into one bucket.
  const ipHash = hashClientIp(
    clientIpFromHeaders((name) => requestHeaders.get(name)),
    getServerEnv().AUDIT_IP_HASH_SALT,
  );

  if (ipHash) {
    let hits: number;
    try {
      // BEFORE the insert, so refused attempts count too.
      hits = await bumpAuditRequestThrottle(ipHash);
    } catch (e) {
      // A counter that is DOWN must not become a counter that is OFF (T-9-22).
      // Carrying on would mean unbounded writes and unbounded operator
      // notifications during exactly the outage nobody is watching — so this is
      // treated like a failed insert: fixed sentence out, error NAME logged,
      // nothing written.
      console.error(
        `[audit-request] throttle failed: ${e instanceof Error ? e.name : 'UnknownError'}`,
      );
      return { errors: {}, formError: AUDIT_FORM_COPY.serverError, values };
    }

    if (throttleDecision(hits) === 'refuse') {
      // HTTP 200 and a re-render, not a 429: the reader is a person on a shared
      // office connection as often as it is a script, the copy names a way
      // forward that does not need the form, and their typing survives.
      return { errors: {}, formError: AUDIT_FORM_COPY.rateLimited, values };
    }
  }

  // ── THE OPTIONAL JOB LIST EXPORT (LAND-02, D-10, T-9-04) ──────────────────
  //
  // Refused BEFORE the insert, so a wrong or oversized file costs one sentence
  // and no row — a stranger cannot make us write by attaching rubbish.
  //
  // The read order is the defence: `file.size` is a number the runtime already
  // has, so the cap binds before a single byte is in this process's memory, and
  // then only the first 4 KB is decoded for the sniff. Nothing reads the whole
  // file until the row exists and the file has been accepted.
  //
  // `attachedFile` answers whether there IS one, and its header says why that is
  // not the same question as whether the form carried a `File` (G-09-1).
  const file = attachedFile(formData);

  if (file) {
    const sniff = sniffCsv({
      name: file.name,
      type: file.type,
      size: file.size,
      firstBytes: await file.slice(0, CSV_SNIFF_BYTES).text(),
    });

    if (!sniff.ok) {
      return {
        errors: { csv_file: AUDIT_FORM_COPY.csvErrors[sniff.kind] },
        formError: null,
        values,
      };
    }
  }

  // ── WHERE IT CAME FROM (19 Sep 2026, LAND-03/LAND-05) ─────────────────────
  //
  // READ AFTER VALIDATION AND BEFORE THE INSERT, and it can affect neither. The
  // parser is total: every one of the four hidden fields is either a value it
  // recognises or `null`, and there is no shape of input that produces a field
  // error. That is the requirement, not an implementation detail — these are
  // the only fields on the form nobody typed, so a rejection here would be the
  // form refusing a submission over a value the person cannot see.
  const arrival = parseArrivalSource((field) => readString(formData, field));

  let requestId: string;
  try {
    const row = await createAuditRequest({
      businessName: parsed.data.business_name,
      contactName: parsed.data.contact_name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      trade: parsed.data.trade,
      servicem8User: parsed.data.servicem8,
      quotesBand: parsed.data.quotes_per_month,
      ipHash,
      userAgent,
      ...arrival,
    });
    requestId = row.id;
  } catch (e) {
    // The NAME only. A driver's message carries the failing statement, and the
    // statement carries every value in the form.
    console.error(
      `[audit-request] insert failed: ${e instanceof Error ? e.name : 'UnknownError'}`,
    );
    return { errors: {}, formError: AUDIT_FORM_COPY.serverError, values };
  }

  // ── THE UPLOAD (T-9-06, T-9-11) ───────────────────────────────────────────
  //
  // After the row, and never in front of it. The object key is
  // `{requestId}/{sanitised filename}`: the uuid is the tenant boundary this
  // bucket has instead of a tenant id — two prospects' exports cannot collide
  // and neither can name a path into the other's. The filename is the
  // prospect's own, made safe, because the operator downloading it in a week
  // wants to see what they sent.
  //
  // A failure here is LOGGED AND SURVIVED, by design (see the header). The row
  // keeps `csv_object_path = null`, `hasCsv` goes false to the email, and the
  // operator reads "No file attached" rather than the request being lost.
  let hasCsv = false;
  if (file) {
    const safeName = sanitiseCsvFilename(file.name);
    const objectPath = `${requestId}/${safeName}`;
    const stored = await putAuditUpload(
      objectPath,
      new Uint8Array(await file.arrayBuffer()),
    );

    if (stored.ok) {
      try {
        // Only now, and only here: the four csv columns and the 30-day purge
        // stamp are one fact, and the repository writes them together.
        await attachAuditRequestCsv(requestId, {
          objectPath,
          filename: safeName,
          bytes: file.size,
        });
        hasCsv = true;
      } catch (e) {
        // The object is stored and the row does not know. The daily purge reads
        // rows, so this one would never be collected — worth a log line naming
        // nothing but the error class, and never worth failing the request over.
        console.error(
          `[audit-request] csv attach failed: ${e instanceof Error ? e.name : 'UnknownError'}`,
        );
      }
    } else {
      // The NAME only. A Storage message carries the object key, and the object
      // key carries a prospect's filename.
      console.error(`[audit-request] upload failed: ${stored.detail}`);
    }
  }

  const at = new Date();
  const [emailSettled, smsSettled] = await Promise.allSettled([
    sendOperatorAlert({
      kind: 'audit_request',
      requestId,
      businessName: parsed.data.business_name,
      contactName: parsed.data.contact_name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      trade: TRADE_LABELS[parsed.data.trade],
      quotesBand: BAND_LABELS[parsed.data.quotes_per_month],
      servicem8: parsed.data.servicem8,
      // TRUE ONLY IF THE OBJECT IS STORED AND THE ROW POINTS AT IT. An email
      // that promises an attachment the console cannot show is worse than one
      // that never mentioned it.
      hasCsv,
      at,
    }),
    sendOperatorSms({
      requestId,
      body: auditRequestSmsBody({
        businessName: parsed.data.business_name,
        contactName: parsed.data.contact_name,
        phone: parsed.data.phone,
      }),
    }),
  ]);

  const email = outcomeOf(emailSettled);
  const sms = outcomeOf(smsSettled);

  try {
    await recordAuditRequestNotify(requestId, {
      email: email.outcome,
      sms: sms.outcome,
      // The FIRST failing channel's detail. Two codes in one column would be a
      // second format for the console to parse; the console shows "notify
      // failed" and the row's two outcome columns say which channel.
      detail: email.detail ?? sms.detail ?? null,
    });
  } catch (e) {
    // The request is already stored and the operator already told. Losing the
    // bookkeeping is worth a log line and nothing more — it must not turn a
    // successful submission into an error the prospect reads.
    console.error(
      `[audit-request] notify bookkeeping failed: ${e instanceof Error ? e.name : 'UnknownError'}`,
    );
  }

  // The console list this row appears on is 09-09; revalidating now means it is
  // correct the first time it exists.
  revalidatePath('/audits/requests');
  redirect('/audit/thanks');
}
