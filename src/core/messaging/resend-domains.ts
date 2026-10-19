/**
 * The Resend domains boundary — how a client's sending domain goes from nothing
 * to verified (MSG-02, D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE ONE PHASE-4 FLOW CLAUDE CANNOT FINISH.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Everything else in this phase is code that either works or does not. This is
 * not: between `createDomain` and `verifyDomain` a human has to open a DNS host
 * and paste three records. So the wrapper's job is not to hide the provider —
 * it is to hand the operator the EXACT strings to paste and then let them ask
 * again. That is why `records` is passed through rather than summarised, and why
 * `value` is never touched: a DKIM public key that has been trimmed, wrapped or
 * "cleaned up" produces a domain that verifies and then silently fails SPF/DKIM
 * alignment at the receiving end, which is a client's mail landing in spam with
 * a green tick on our screen.
 *
 * ── THE HOUSE RULES THIS FILE FOLLOWS ───────────────────────────────────────
 *
 * 1. NOTHING THROWS. Every function returns a closed result union, exactly like
 *    `src/core/servicem8/client.ts` and `operator-email.ts`. This is called from
 *    a server action rendering a page; a provider having a bad afternoon must
 *    not become a 500 on a screen whose whole purpose is to tell the operator
 *    what is wrong with their domain.
 *
 * 2. FAILURE DETAIL IS THE ERROR'S `name`, NEVER ITS MESSAGE (operator-email.ts
 *    rule 3). Resend's names — `validation_error`, `missing_api_key`,
 *    `not_found` — ARE the classification; the message adds prose and the risk
 *    that some version of it echoes the request we made, which on this endpoint
 *    contains a client's domain and, one call away, their customers' addresses.
 *
 * 3. STATUSES ARE SANITIZED TO A BOUNDED CODE, values are not. Same trade
 *    `codeOf` makes in `clicksend-client.ts`: a status is documented as an enum,
 *    that documentation is the least-confident part of the research, and the
 *    value reaches a rendered surface and a comparison. A DNS record VALUE, by
 *    contrast, is the thing the operator is here to copy — bounding it would
 *    break the only job this file has.
 *
 * 4. FRAMEWORK-FREE (`src/core` contract): no `next/*`, no database. The API key
 *    is read from validated env in a server context and never leaves this
 *    module — the console pages that call it are server components and the
 *    actions are server actions, so nothing here is reachable from a browser
 *    bundle (T-4-27).
 */
import { Resend } from 'resend';

import { getServerEnv } from '@/core/shared/env';

/**
 * THE REGION, and the honesty problem it creates.
 *
 * Supabase gives this system AU data residency in Sydney. Resend has no
 * Australian region at all — `ap-northeast-1` (Tokyo) is the nearest one it
 * offers, and it is still offshore. Choosing it is the best available answer;
 * pretending it is an Australian answer is not, which is why the note on the
 * settings page names this string rather than saying "your data stays local".
 *
 * Pinned as a constant rather than passed per call so there is ONE region for
 * every client domain: two domains in two regions is a residency story with an
 * exception in it, and the exception is the part a prospect asks about.
 */
export const EMAIL_DOMAIN_REGION = 'ap-northeast-1' as const;

/** The one domain status that permits sending. */
export const VERIFIED_STATUS = 'verified';

/**
 * A DNS record exactly as the operator must paste it.
 *
 * `priority` is `null` rather than absent for the records that do not carry one
 * (TXT, CNAME): a missing key renders as nothing and so does a null, but only
 * the null survives being passed through a server-component boundary without a
 * `Cannot serialize undefined` surprise later.
 */
export interface DnsRecordView {
  /** `SPF` / `DKIM` / `Receiving` / `Tracking` — what the record is for. */
  record: string;
  /** `TXT` / `CNAME` / `MX` / `CAA` — what the operator selects at the host. */
  type: string;
  name: string;
  /** VERBATIM. Never trimmed, wrapped or normalized — see the header. */
  value: string;
  ttl: string;
  status: string;
  priority: number | null;
}

export interface DomainSummary {
  id: string;
  name: string;
  /** Bounded code. Compare against `VERIFIED_STATUS`, never against prose. */
  status: string;
  region: string;
  createdAt: string | null;
}

export interface DomainDetail extends DomainSummary {
  records: DnsRecordView[];
}

/**
 * `reason` is a CODE, never a sentence. Callers render their own copy from it;
 * nothing here produces text meant for a human to read as-is.
 */
export interface DomainsFailure {
  ok: false;
  reason: string;
}

export type CreateDomainResult = { ok: true; domain: DomainDetail } | DomainsFailure;
export type GetDomainResult = { ok: true; domain: DomainDetail } | DomainsFailure;
export type ListDomainsResult = { ok: true; domains: DomainSummary[] } | DomainsFailure;
export type VerifyDomainResult = { ok: true; id: string } | DomainsFailure;

/**
 * Reduce a third party's string to a bounded, lowercase, snake-shaped token.
 *
 * The length cap is what actually bounds the damage. Resend's error names are
 * already codes and its statuses are already enums — but that is documentation,
 * and this value flows onto a rendered page and into a log line. If the field
 * ever turns out to carry prose (or an address), 48 characters is far shorter
 * than anything worth leaking.
 */
function codeOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return 'unknown';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function failure(raw: unknown): DomainsFailure {
  return { ok: false, reason: codeOf(raw) };
}

/**
 * Bounded, but NOT rewritten — for the one third-party string a human quotes
 * back to somebody else.
 *
 * `codeOf` turns `ap-northeast-1` into `ap_northeast_1`, which is not a region
 * anybody can look up. This value is rendered beside a residency note that names
 * the region literally, and a prospect's IT person checks it against Resend's
 * documentation. So the cap stays (the field is still a third party's string)
 * and the substitution goes: length is what bounds a leak, and hyphens were
 * never the risk.
 */
function boundedLabel(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return 'unknown';
  return raw.trim().slice(0, 32);
}

/**
 * The API key, read at CALL time rather than module load.
 *
 * Same reason `buildRoutingSender` reads config per tick: a missing key is a
 * deployment state that gets fixed, and a module-scope read would hold whatever
 * was true when the serverless instance cold-started. The thrown zod report is
 * deliberately not forwarded — it names environment VARIABLES, which is safe,
 * but the rule about what may cross this boundary is absolute rather than
 * case-by-case.
 */
function apiKey(): string | null {
  try {
    return getServerEnv().RESEND_API_KEY;
  } catch {
    return null;
  }
}

/** `undefined` for a record type that carries no priority — see `DnsRecordView`. */
function priorityOf(record: { priority?: number }): number | null {
  return typeof record.priority === 'number' ? record.priority : null;
}

function toRecordView(record: {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  status: string;
  priority?: number;
}): DnsRecordView {
  return {
    record: record.record,
    type: record.type,
    name: record.name,
    // NOT `codeOf`. This is the string the operator pastes.
    value: record.value,
    ttl: record.ttl,
    status: codeOf(record.status),
    priority: priorityOf(record),
  };
}

/**
 * The domain part of an address, lowercased — `null` for anything that is not
 * one address with one `@` in it.
 *
 * Lives here rather than in the console action because the question it answers
 * ("may we send as this address") is decided against the list this module
 * returns, and a second spelling of "the domain part" is how an address passes
 * the check on one screen and fails at the provider.
 */
export function domainOfAddress(address: string): string | null {
  const parts = address.trim().toLowerCase().split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local === '' || domain === '' || !domain.includes('.')) return null;
  return domain;
}

/**
 * Register a sending domain and return the records that must exist in DNS.
 *
 * The region is passed EXPLICITLY on every create. Resend's default is
 * `us-east-1`; a domain created without this argument is a client's mail
 * processed in Virginia while the settings page beside it says Tokyo, and
 * nothing in the UI would ever show the difference.
 */
export async function createDomain(name: string): Promise<CreateDomainResult> {
  const key = apiKey();
  if (!key) return failure('not_configured');

  try {
    const { data, error } = await new Resend(key).domains.create({
      name,
      region: EMAIL_DOMAIN_REGION,
    });

    if (error) return failure(error.name);
    if (!data) return failure('empty_response');

    return {
      ok: true,
      domain: {
        id: data.id,
        name: data.name,
        status: codeOf(data.status),
        region: boundedLabel(data.region),
        createdAt: data.created_at ?? null,
        records: (data.records ?? []).map(toRecordView),
      },
    };
  } catch (e) {
    return failure(e instanceof Error ? e.name : 'unknown_error');
  }
}

/**
 * Every domain on the account. NO RECORDS — Resend's list endpoint does not
 * return them, and inventing an empty array here would make "this domain has no
 * DNS requirements" indistinguishable from "we did not ask". `getDomain` is the
 * call that carries records.
 */
export async function listDomains(): Promise<ListDomainsResult> {
  const key = apiKey();
  if (!key) return failure('not_configured');

  try {
    const { data, error } = await new Resend(key).domains.list();

    if (error) return failure(error.name);
    if (!data) return failure('empty_response');

    return {
      ok: true,
      domains: (data.data ?? []).map((domain) => ({
        id: domain.id,
        name: domain.name,
        status: codeOf(domain.status),
        region: boundedLabel(domain.region),
        createdAt: domain.created_at ?? null,
      })),
    };
  } catch (e) {
    return failure(e instanceof Error ? e.name : 'unknown_error');
  }
}

/** One domain WITH its records — the read the DNS table on the settings page needs. */
export async function getDomain(id: string): Promise<GetDomainResult> {
  const key = apiKey();
  if (!key) return failure('not_configured');

  try {
    const { data, error } = await new Resend(key).domains.get(id);

    if (error) return failure(error.name);
    if (!data) return failure('empty_response');

    return {
      ok: true,
      domain: {
        id: data.id,
        name: data.name,
        status: codeOf(data.status),
        region: boundedLabel(data.region),
        createdAt: data.created_at ?? null,
        records: (data.records ?? []).map(toRecordView),
      },
    };
  } catch (e) {
    return failure(e instanceof Error ? e.name : 'unknown_error');
  }
}

/**
 * Ask Resend to re-check DNS.
 *
 * RETURNS ONLY AN ID, because that is all the endpoint returns: verification is
 * asynchronous, so a 200 here means "we will look", not "it is verified". The
 * caller must re-read the domain to learn the outcome — and the result type says
 * so by having nothing else in it, rather than by a comment somebody skips.
 */
export async function verifyDomain(id: string): Promise<VerifyDomainResult> {
  const key = apiKey();
  if (!key) return failure('not_configured');

  try {
    const { data, error } = await new Resend(key).domains.verify(id);

    if (error) return failure(error.name);
    if (!data) return failure('empty_response');

    return { ok: true, id: data.id };
  } catch (e) {
    return failure(e instanceof Error ? e.name : 'unknown_error');
  }
}

/**
 * MAY WE SEND AS THIS ADDRESS? — the one predicate, three-state.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A FAILED READ IS NEITHER "VERIFIED" NOR "NOT YET". It is UNKNOWN, and    │
 * │ the caller must refuse on it.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Extracted from `/settings/email`'s save action, which has enforced exactly
 * this rule since 04-06 and now calls this instead of spelling it a second
 * time. Two spellings is T-4-26's shape: the copy that treats a provider outage
 * as a pass arms email on a domain nobody has verified, and nothing in this
 * system ever sees the receiving side reject the mail.
 *
 * The three states are different ACTIONS for the operator, which is why they are
 * not a boolean: `unverified` means go and add DNS records; `unknown` means try
 * again in a moment and change nothing; `invalid_address` means the address
 * itself is wrong, and no amount of DNS will fix it.
 *
 * `lister` is injected for the tests and for the checklist's DB-backed suites —
 * the default is the real call, so a caller who passes nothing gets the truth.
 */
export async function isSendingDomainVerified(
  address: string,
  lister: () => Promise<ListDomainsResult> = listDomains,
): Promise<
  | { kind: 'verified'; domain: string }
  | { kind: 'unverified'; domain: string }
  | { kind: 'invalid_address' }
  | { kind: 'unknown'; reason: string }
> {
  const domain = domainOfAddress(address);
  if (!domain) return { kind: 'invalid_address' };

  const domains = await lister();
  if (!domains.ok) return { kind: 'unknown', reason: domains.reason };

  const verified = domains.domains.some(
    (candidate) => candidate.name.toLowerCase() === domain && candidate.status === VERIFIED_STATUS,
  );

  return verified ? { kind: 'verified', domain } : { kind: 'unverified', domain };
}
