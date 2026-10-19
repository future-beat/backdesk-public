/**
 * The live-API spike: replace research assumptions A1–A4 with measured facts,
 * and capture the fixture set every downstream sync/audit test is built on.
 *
 * WHY A SCRIPT AND NOT A TEST: these are questions ServiceM8's documentation
 * does not answer — whether `$filter` accepts time-of-day precision, how
 * `cursor` actually pages, what timezone their timestamps are in, how
 * zero-dates compare. A test asserts an expected answer; this MEASURES one and
 * prints it. The answers land in docs/servicem8-api-notes.md, and the code that
 * depends on them (src/core/servicem8/pagination.ts) is corrected to match.
 *
 * Read-only against the trial account. Writes only to tests/fixtures/sm8/.
 *
 * Usage:
 *   node scripts/sm8-spike.mjs          A1–A4 + fixture capture (the original)
 *   node scripts/sm8-spike.mjs probe    D-13 only: can a private API key read
 *                                       sms.json / email.json? (06-04)
 *
 * The subcommand exists so the D-13 question can be re-measured without
 * re-running twenty filter probes and REWRITING every fixture in
 * tests/fixtures/sm8/ — a downstream test suite's inputs are not something a
 * one-question probe should be able to change as a side effect.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { register } from 'node:module';

import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
const env = requireEnv('SM8_TEST_API_KEY');

register('./lib/ts-alias-hook.mjs', import.meta.url);
const { createSm8Client } = await import('@/core/servicem8/client');

const client = createSm8Client({ kind: 'apiKey', key: env.SM8_TEST_API_KEY });

/* ========================================================================= *
 * D-13 (06-04) — CAN WE SEE ServiceM8's OWN OUTBOUND COMMS AT ALL?
 * ========================================================================= */

/**
 * The question, and why it is MEASURED rather than assumed.
 *
 * ONB-04's gate rests on an operator ATTESTATION: a human looked at the
 * client's ServiceM8 settings and wrote down that Quote Follow Up is off. D-15
 * describes a second, stronger tier — BEHAVIOURAL drift detection, where we
 * notice ServiceM8's own follow-up actually going out beside ours and say so.
 * That tier is only buildable if the API will show us those messages under the
 * auth we actually hold, which is a private `X-API-Key`.
 *
 * `sms.json` and `email.json` appear in ServiceM8's endpoint list but are not
 * documented as reachable under a private key. Guessing either way is how a
 * phase ships a pause keyed on an endpoint that returns 403 in production, so
 * this probe records the HTTP status and — on a 200 — the SHAPE, and nothing in
 * this phase's production code reads either endpoint whichever way it lands.
 *
 * ── A HANDFUL OF REQUESTS, DELIBERATELY ─────────────────────────────────────
 *
 * Two GETs, no paging loop. The account's limits are 180/min and 20,000/day per
 * app per connected account; a probe that walked the cursor to characterise the
 * shape would spend a real client's budget to answer a yes/no question.
 */
async function probeD13() {
  console.log('ServiceM8 live spike — D-13: sms.json / email.json under a private API key\n');

  const measured = {};

  for (const resource of ['sms.json', 'email.json']) {
    const result = await client.get(resource);

    if (!result.ok) {
      measured[resource] = {
        reachable: false,
        status: result.status ?? null,
        kind: result.kind,
        detail: result.detail ?? null,
      };
      console.log(
        `   ${resource}: NOT READABLE — kind=${result.kind}` +
          (result.status ? ` status=${result.status}` : '') +
          (result.detail ? ` detail=${result.detail}` : ''),
      );
      continue;
    }

    // ── ON A 200, RECORD THE SHAPE AND NOT THE CONTENT ────────────────────
    //
    // FIELD NAMES ONLY. This is a real trial account and the record lands in a
    // file in the repository; a sample row would put whatever the account holds
    // — a customer's mobile, an email body — into git forever. The names are
    // what answer "is job-uuid attribution present", which is the only thing
    // tier-1 detection would need to key on.
    const rows = result.data.rows;
    const fields = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))].sort();

    measured[resource] = {
      reachable: true,
      status: 200,
      rowCount: rows.length,
      fields,
      hasJobUuidAttribution: fields.some((f) => /job.*uuid|uuid.*job/i.test(f)),
      timestampFields: fields.filter((f) => /date|time|sent|created/i.test(f)),
    };

    console.log(
      `   ${resource}: READABLE — ${rows.length} row(s); fields: ${fields.join(', ') || '(none — empty result)'}`,
    );
  }

  console.log('\nMeasured (JSON):');
  console.log(JSON.stringify(measured, null, 2));
  console.log('\nRecord this in docs/servicem8-api-notes.md under "ServiceM8 own-comms (D-13)".');
}

if ((process.argv[2] ?? 'all') === 'probe') {
  await probeD13();
  process.exit(0);
}

const FIXTURE_DIR = new URL('../tests/fixtures/sm8/', import.meta.url);

/** Unwrap or die — a spike that silently skips a probe measures nothing. */
async function fetchRows(resource, options = {}) {
  const result = await client.get(resource, options);
  if (!result.ok) {
    throw new Error(
      `${resource} (${JSON.stringify(options)}) failed: kind=${result.kind}` +
        (result.status ? ` status=${result.status}` : '') +
        (result.detail ? ` detail=${result.detail}` : ''),
    );
  }
  return result.data.rows;
}

const findings = {};

console.log('ServiceM8 live spike — measuring A1–A4\n');

// --- A1: does $filter accept time-of-day precision? -------------------------
//
// The docs demonstrate only date-only literals (`create_date gt '2023-01-01'`).
// If a datetime literal is parsed correctly, the sync cursor keeps second
// granularity; if it is ignored or misparsed, the cursor degrades to a day and
// the overlap window has to widen to match. The design tolerates either — but
// only if we know WHICH.
{
  const dateOnly = '2026-01-01';
  const dateTime = '2026-01-01 00:00:00';

  const [byDate, byDateTime, unfiltered] = await Promise.all([
    fetchRows('job.json', { filter: `edit_date gt '${dateOnly}'` }),
    fetchRows('job.json', { filter: `edit_date gt '${dateTime}'` }),
    fetchRows('job.json'),
  ]);

  // THE DISCRIMINATING PROBE. Comparing a datetime literal at MIDNIGHT against
  // a date-only literal for the same day proves nothing — both name the same
  // instant, so identical counts are expected whether or not the time component
  // is parsed. To actually observe time-of-day handling the literal must fall
  // in the MIDDLE of a day on which records exist: if the time is honoured, the
  // result is a strict subset of the same day's date-only result.
  const sorted = [...unfiltered].map((r) => r.edit_date).sort();
  const maxEdit = sorted.at(-1) ?? null;
  const midDay = sorted.at(-2) ?? maxEdit; // a real edit_date, mid-day by construction
  const sameDayMidnight = midDay ? midDay.slice(0, 10) : dateOnly;

  const [byMidDay, bySameDay] = await Promise.all([
    fetchRows('job.json', { filter: `edit_date gt '${midDay}'` }),
    fetchRows('job.json', { filter: `edit_date gt '${sameDayMidnight}'` }),
  ]);

  // THREE distinguishable outcomes, and the counts tell them apart:
  //   strict `>`      -> records strictly after the literal
  //   inclusive `>=`  -> that, plus the boundary record itself
  //   date-truncated  -> every record from that whole day
  const expectedStrict = sorted.filter((d) => d > midDay).length;
  const expectedInclusive = sorted.filter((d) => d >= midDay).length;
  const expectedTruncated = bySameDay.length;

  let semantics = 'unrecognised';
  if (byMidDay.length === expectedStrict && expectedStrict !== expectedTruncated) {
    semantics = 'strict-gt';
  } else if (byMidDay.length === expectedInclusive && expectedInclusive !== expectedTruncated) {
    semantics = 'inclusive-ge';
  } else if (byMidDay.length === expectedTruncated) {
    semantics = 'date-truncated';
  }

  findings.A1 = {
    unfiltered: unfiltered.length,
    dateOnlyLiteral: byDate.length,
    datetimeLiteral: byDateTime.length,
    probeLiteral: midDay,
    rowsReturnedByProbe: byMidDay.length,
    expectedIfStrictGt: expectedStrict,
    expectedIfInclusiveGe: expectedInclusive,
    expectedIfDateTruncated: expectedTruncated,
    semantics,
    timeComponentHonoured: semantics === 'strict-gt' || semantics === 'inclusive-ge',
  };

  console.log(
    `A1 filtering precision: unfiltered=${unfiltered.length} ` +
      `date-only('${dateOnly}')=${byDate.length} ` +
      `datetime('${dateTime}')=${byDateTime.length}\n` +
      `   mid-day probe edit_date gt '${midDay}' -> ${byMidDay.length} rows ` +
      `(strict-gt would be ${expectedStrict}, inclusive-ge ${expectedInclusive}, ` +
      `date-truncated ${expectedTruncated})\n` +
      `   => ${semantics.toUpperCase()}${
        semantics === 'inclusive-ge'
          ? ' — time IS honoured, but the boundary row comes back too. Harmless: ' +
            'the cursor re-fetch is deduped by the (tenant_id, sm8_job_uuid) upsert, ' +
            'and erring inclusive is the SAFE direction (Pitfall 2 is about LOSING ' +
            'same-second edits, not re-reading them).'
          : ''
      }`,
  );
}

// --- A2: cursor pagination mechanics ---------------------------------------
//
// A `cursor` parameter appears in exactly one documented filtering example and
// nothing states the page size or where a next cursor is returned. Without this
// measurement, pagination.ts is guessing — and a guess that never terminates is
// an infinite loop against a rate-limited API.
{
  const withCursor = await client.get('job.json', { cursor: '-1' });
  const withoutCursor = await client.get('job.json');
  if (!withCursor.ok || !withoutCursor.ok) throw new Error('A2 probe failed');

  const headers = Object.fromEntries(withCursor.data.headers.entries());
  // Anything that could plausibly carry a next-cursor or page metadata.
  const interesting = Object.entries(headers).filter(([k]) =>
    /cursor|page|next|link|total|count|range|limit/i.test(k),
  );

  const first = withCursor.data.rows[0];
  const envelopeKeys = first && typeof first === 'object' ? Object.keys(first) : [];
  const cursorLikeKeys = envelopeKeys.filter((k) => /cursor|page|next/i.test(k));

  findings.A2 = {
    rowsWithCursorMinus1: withCursor.data.rows.length,
    rowsWithoutCursorParam: withoutCursor.data.rows.length,
    identical: withCursor.data.rows.length === withoutCursor.data.rows.length,
    cursorRelatedHeaders: Object.fromEntries(interesting),
    cursorRelatedBodyKeys: cursorLikeKeys,
    responseIsBareArray: true,
    allHeaderNames: Object.keys(headers).sort(),
  };

  console.log(
    `A2 pagination: cursor=-1 -> ${withCursor.data.rows.length} rows; ` +
      `no cursor param -> ${withoutCursor.data.rows.length} rows; ` +
      `cursor-ish headers=${interesting.length ? JSON.stringify(Object.fromEntries(interesting)) : 'NONE'}; ` +
      `cursor-ish body keys=${cursorLikeKeys.length ? cursorLikeKeys.join(',') : 'NONE'} ` +
      `(response is a bare JSON array — no envelope)`,
  );
}

// --- A3: what timezone are their timestamps in? ----------------------------
//
// Undocumented, and a community report has edit_date values appearing in the
// FUTURE for a Perth (UTC+8) account. Sync correctness does not depend on the
// answer (the cursor only ever compares their strings to their strings), but
// display and grace math do.
{
  const probe = await client.get('job.json');
  if (!probe.ok) throw new Error('A3 probe failed');
  const rows = probe.data.rows;

  // THE DIRECT ANSWER, found by dumping headers in the A2 probe: ServiceM8
  // returns `x-platform-date-utc` — their own server clock, explicitly labelled
  // UTC. Differencing against it isolates timezone interpretation from clock
  // skew, which the record-age heuristic alone cannot do.
  const platformDateUtc = probe.data.headers.get('x-platform-date-utc');
  const ourNow = new Date();
  // The header value is naive ('2026-08-26 08:44:06') and the header NAME says
  // UTC — so the 'Z' must be appended explicitly. Without it, `new Date()`
  // reads it in the RUNNING MACHINE's zone and reports the machine's own UTC
  // offset as if it were ServiceM8 clock skew. (This probe made exactly that
  // mistake on its first run and reported an -8h skew that did not exist.)
  const theirNow = platformDateUtc
    ? new Date(`${platformDateUtc.trim().replace(' ', 'T')}Z`)
    : null;
  const clockSkewSeconds =
    theirNow && !Number.isNaN(theirNow.getTime())
      ? Math.round((theirNow.getTime() - ourNow.getTime()) / 1000)
      : null;

  const maxEdit = rows.reduce(
    (max, r) => (max === null || r.edit_date > max ? r.edit_date : max),
    null,
  );

  // Read their naive string AS IF UTC and difference it against THEIR clock
  // (not ours — that would fold clock skew into the answer). A recently-edited
  // record reads ~0 if timestamps are stored in UTC, and ~+480 if stored in
  // Perth local time.
  const asIfUtc = maxEdit ? new Date(`${maxEdit.replace(' ', 'T')}Z`) : null;
  const ageMinutes =
    asIfUtc && theirNow ? Math.round((asIfUtc.getTime() - theirNow.getTime()) / 60_000) : null;

  findings.A3 = {
    platformDateUtcHeader: platformDateUtc,
    ourClockUtc: ourNow.toISOString(),
    clockSkewSeconds,
    maxEditDate: maxEdit,
    editDateMinusPlatformNowMinutes: ageMinutes,
    storedInUtc: ageMinutes !== null ? Math.abs(ageMinutes) < 240 : null,
    note:
      'x-platform-date-utc is ServiceM8 stating its own UTC clock. A naive ' +
      'edit_date read as UTC lands within minutes of it, so timestamps are ' +
      'stored in UTC — NOT account-local as A3 assumed. The residual is record ' +
      'AGE, not offset: for an exact reading, edit a job in the ServiceM8 UI ' +
      'and re-run immediately.',
  };

  console.log(
    `A3 timestamp offset: x-platform-date-utc='${platformDateUtc}' ` +
      `(our clock ${ourNow.toISOString()}, skew ${clockSkewSeconds}s)\n` +
      `   max edit_date='${maxEdit}' read as UTC sits ${ageMinutes} min from THEIR now ` +
      `=> timestamps appear ${
        ageMinutes !== null && Math.abs(ageMinutes) < 240 ? 'STORED IN UTC' : 'stored in a local zone'
      } (residual is record age)`,
  );
  console.log(
    '   For an exact reading: edit any job in the ServiceM8 UI, then re-run this script.',
  );
}

// --- A4: do zero-dates fall out of a `gt` comparison? -----------------------
//
// Pattern 6 fetches the whole 90-day history with ONE filter on quote_date,
// relying on jobs that never became a quote (zero quote_date) being excluded
// naturally. If they are NOT excluded, the fallback is four per-status requests.
{
  const [unfiltered, filtered] = await Promise.all([
    fetchRows('job.json'),
    fetchRows('job.json', { filter: `quote_date gt '2000-01-01'` }),
  ]);

  const isZero = (v) => !v || String(v).startsWith('0000-00-00');

  const zeroQuoteDate = unfiltered.filter((r) => isZero(r.quote_date));
  const filteredUuids = new Set(filtered.map((r) => r.uuid));
  const zeroDateLeakedThrough = zeroQuoteDate.filter((r) => filteredUuids.has(r.uuid));

  // NATURAL EXPERIMENT, because a seeded account may legitimately have no
  // zero-quote_date jobs (every job was quoted first) and the quote_date probe
  // above is then vacuous. `work_order_date` IS genuinely zero on every job
  // still in Quote or Unsuccessful status — the same zero-date value, on the
  // same object, in a field that definitely has some. If `gt` excludes those,
  // it excludes zero-dates, and the answer transfers to quote_date.
  const zeroWorkOrder = unfiltered.filter((r) => isZero(r.work_order_date));
  const realWorkOrder = unfiltered.filter((r) => !isZero(r.work_order_date));
  const byWorkOrder = await fetchRows('job.json', {
    filter: `work_order_date gt '2000-01-01'`,
  });
  const woUuids = new Set(byWorkOrder.map((r) => r.uuid));
  const zeroWorkOrderLeaked = zeroWorkOrder.filter((r) => woUuids.has(r.uuid));

  const conclusive = zeroQuoteDate.length > 0 || zeroWorkOrder.length > 0;
  const excludes =
    (zeroQuoteDate.length === 0 || zeroDateLeakedThrough.length === 0) &&
    (zeroWorkOrder.length === 0 || zeroWorkOrderLeaked.length === 0);

  findings.A4 = {
    unfiltered: unfiltered.length,
    quoteDateGt2000: filtered.length,
    rowsWithZeroOrEmptyQuoteDate: zeroQuoteDate.length,
    zeroQuoteDateRowsSurvivingTheFilter: zeroDateLeakedThrough.length,
    // The transferable measurement.
    rowsWithZeroWorkOrderDate: zeroWorkOrder.length,
    rowsWithRealWorkOrderDate: realWorkOrder.length,
    workOrderDateGt2000: byWorkOrder.length,
    zeroWorkOrderDateRowsSurvivingTheFilter: zeroWorkOrderLeaked.length,
    excludesZeroDates: conclusive ? excludes : null,
  };

  console.log(
    `A4 zero-date comparison: quote_date gt '2000-01-01' -> ${filtered.length}/${unfiltered.length}; ` +
      `rows with zero quote_date=${zeroQuoteDate.length} (survived: ${zeroDateLeakedThrough.length})\n` +
      `   natural experiment — work_order_date gt '2000-01-01' -> ${byWorkOrder.length}; ` +
      `rows with a REAL work_order_date=${realWorkOrder.length}, ` +
      `with a ZERO work_order_date=${zeroWorkOrder.length} (survived: ${zeroWorkOrderLeaked.length})\n` +
      `   => ${
        !conclusive
          ? 'INCONCLUSIVE (no zero-date rows in this account to observe)'
          : excludes
            ? 'gt EXCLUDES zero-dates as assumed — the single-filter Pattern 6 fetch is safe'
            : 'gt does NOT exclude zero-dates — fall back to four per-status fetches'
      }`,
  );
}

// --- Fixture capture --------------------------------------------------------
//
// Every downstream sync and audit test parses these instead of a hand-written
// approximation of what ServiceM8 "probably" returns — which is exactly how the
// quote_sent boolean was missed when the schema was written from the docs.
//
// SANITIZED even though the trial data is fake by construction: the sanitize
// pass is what makes it SAFE to point this script at a real client's account
// later. A fixture capture that only works on fake data has to be rewritten the
// day it matters most.
const FAKE = {
  phone: '0400000000',
  mobile: '0400000000',
  email: 'fixture@example.invalid',
};

/** Replace every contact-bearing field, at any depth, with an obvious fake. */
function sanitize(rows) {
  return rows.map((row) => {
    const clean = { ...row };
    for (const [field, replacement] of Object.entries(FAKE)) {
      if (clean[field] !== undefined && clean[field] !== null && clean[field] !== '') {
        clean[field] = replacement;
      }
    }
    // Free-text fields can carry a phone number or an address a customer typed.
    for (const field of ['note', 'job_description', 'job_address', 'billing_address']) {
      if (typeof clean[field] === 'string') {
        clean[field] = clean[field]
          .replace(/\b(?:\+?61|0)[\s-]?[2-478](?:[\s-]?\d){8}\b/g, FAKE.phone)
          .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, FAKE.email);
      }
    }
    return clean;
  });
}

await mkdir(FIXTURE_DIR, { recursive: true });

const captured = {};
for (const resource of ['job', 'jobcontact', 'note', 'jobactivity']) {
  let rows;
  try {
    rows = await fetchRows(`${resource}.json`);
  } catch (e) {
    console.log(`   fixture ${resource}.json: NOT CAPTURED — ${e.message}`);
    rows = [];
  }
  const clean = sanitize(rows);
  await writeFile(
    new URL(`${resource}.json`, FIXTURE_DIR),
    `${JSON.stringify(clean, null, 2)}\n`,
    'utf8',
  );
  captured[resource] = clean.length;
  console.log(`   fixture ${resource}.json: ${clean.length} row(s)`);
}

findings.fixtures = captured;

console.log('\nFindings (JSON):');
console.log(JSON.stringify(findings, null, 2));
console.log('\nRecord these in docs/servicem8-api-notes.md.');
