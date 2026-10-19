/**
 * Prospect → audit, end to end (AUD-01, AUD-02, D-12 API path).
 *
 * ── WHY THIS IS NOT INSIDE THE SERVER ACTION ────────────────────────────────
 *
 * A `'use server'` module may export only async functions, and EVERY function it
 * exports becomes a Server Action with a globally-POSTable id. Putting this
 * orchestration in `actions.ts` would therefore publish an unauthenticated
 * endpoint that accepts an API key and writes prospect rows — the exact class of
 * hole `authorize()` exists to close, opened by the act of factoring code out
 * for testability. It lives here, framework-free, and the action wraps it.
 *
 * That also makes it callable from a test without constructing a `FormData` and
 * without going through Next's action runtime — which is what
 * `tests/prospect-audit.test.ts` needs to prove the verify-precedes-write
 * property against the live API.
 *
 * ── ORDER OF OPERATIONS, AND WHAT EACH STEP DEFENDS ─────────────────────────
 *
 *   1. VERIFY the key with a live one-page call. The same probe
 *      `connectServiceM8` makes, for the same reason and now for a sharper one:
 *      a prospect row written against a key that does not work is a business in
 *      the pipeline list that looks audited and is not, and the operator
 *      discovers it in front of them.
 *   2. FETCH the whole 90 days. Still nothing written, so any ServiceM8 failure
 *      — a revoked key, a 429, a shape change — leaves NO residue at all. This
 *      is why the fetch precedes the insert rather than following it: the
 *      alternative leaves a half-created prospect for every transient error.
 *   3. AGGREGATE, purely.
 *   4. WRITE: the prospect row, then figures and lines. Both after every network
 *      call has already succeeded.
 *
 * ── WHAT IS NOT DONE HERE, ON PURPOSE (D-03) ────────────────────────────────
 *
 * No tenant is created, no `quotes` row is written, no event is emitted. The
 * prospect's customers have consented to nothing and have never heard of us;
 * the only entitlement this key carries is to COUNT.
 */
import { credentialLast4, decodeEncryptionKey, encryptCredential } from '@/core/shared/crypto';
import { getServerEnv } from '@/core/shared/env';
import type { Sm8FailureKind } from '@/core/servicem8/types';
import { createProspect, storeAuditResults, type ProspectLineInput } from '@/db/repository';

import { computeAuditFigures, computeBaseline, windowDate } from './aggregate';
import { auditClientFor, fetch90DayQuoteHistory } from './fetch-history';

export type GenerateAuditResult =
  | {
      ok: true;
      prospectId: string;
      quotesIssued: number;
      linesStored: number;
    }
  | { ok: false; kind: Sm8FailureKind };

export interface GenerateAuditInput {
  businessName: string;
  apiKey: string;
  /** IANA identifier — display and window rendering, never SM8 interpretation. */
  timezone?: string;
  /** Injectable for tests, so a fixture window never depends on the clock. */
  now?: Date;
}

/**
 * Verify a prospect's read-only key, pull their last 90 days, and persist the
 * audit.
 *
 * Returns a typed outcome, never a throw for an expected failure: the form
 * renders the classified kind as copy, and an exception raised from this depth
 * can carry a `Request` whose headers hold the prospect's key (threat T-2-02).
 */
export async function generateAuditFromApiKey(
  input: GenerateAuditInput,
): Promise<GenerateAuditResult> {
  const { businessName, apiKey, timezone, now = new Date() } = input;

  const client = auditClientFor(apiKey);

  // --- 1. Verify, before writing anything -----------------------------------
  const probe = await client.get('job.json', { cursor: '-1' });
  if (!probe.ok) return { ok: false, kind: probe.kind };

  // --- 2. Fetch. Still nothing written -------------------------------------
  const history = await fetch90DayQuoteHistory(client, { now });
  if (!history.ok) return { ok: false, kind: history.kind };

  // --- 3. Aggregate, purely -------------------------------------------------
  const { window, records } = history.data;
  // `now` threaded explicitly: the figures depend on it (a quote inside its
  // 72h grace is pending, not neglected — see `computeAuditFigures`), and a
  // second implicit clock reading could disagree with the one the window was
  // built from.
  const figures = computeAuditFigures(records, now);
  const baseline = computeBaseline(records);

  // --- 4. Write -------------------------------------------------------------
  const key = decodeEncryptionKey(getServerEnv().CREDENTIALS_ENCRYPTION_KEY);

  const prospect = await createProspect({
    businessName,
    source: 'api_key',
    // Ciphertext and last4 only — identical envelope and identical handling to
    // a client's key. That this one belongs to a business which has signed
    // nothing makes it more sensitive, not less (threat T-2-01).
    apiKeyCiphertext: encryptCredential(apiKey, key),
    keyLast4: credentialLast4(apiKey),
    ...(timezone ? { timezone } : {}),
  });

  const lines: ProspectLineInput[] = records.map((record) => ({
    sm8JobUuid: record.sm8JobUuid,
    status: record.status,
    quoteDateRaw: record.quoteDateRaw,
    quoteDateUtc: record.quoteDateUtc,
    valueCents: record.valueCents,
    description: record.description,
    contactName: record.contactName,
    contactPhone: record.contactPhone,
    contactEmail: record.contactEmail,
    followedUp: record.followedUp,
    lineSource: 'api',
  }));

  await storeAuditResults(
    prospect.id,
    {
      ...figures,
      baselineWinRate: baseline.winRate,
      baselineQuotesIssued: baseline.quotesIssued,
      windowStart: windowDate(window.start),
      windowEnd: windowDate(window.end),
      // The API path sees notes and job activities. Only the CSV path (plan
      // 02-07) degrades to status-change-only detection.
      csvNoteDegraded: false,
    },
    lines,
  );

  return {
    ok: true,
    prospectId: prospect.id,
    quotesIssued: figures.quotesIssued,
    linesStored: lines.length,
  };
}
