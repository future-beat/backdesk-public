/**
 * BUY ONE PERTH NUMBER FOR ONE CLIENT — CLAIM FIRST, THEN BUY (Phase 11,
 * CAP-01, D-08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ROW IS CLAIMED BEFORE A CENT IS SPENT. `tenant_divert_numbers` has   │
 * │ `tenant_id UNIQUE`, so the `pending` INSERT is the arbiter: two operators │
 * │ (or two clicks) both try to claim, the second gets a 23505, and it is    │
 * │ refused as "in progress" WITHOUT a provider call. Buying first and       │
 * │ recording after would make the database a witness rather than a guard — │
 * │ and the thing it would be witnessing is a second real charge.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The `dispatchOne` shape (claim → act → outcome) composed with connect's
 * verify-then-write: the guards verify configuration, the claim records intent,
 * the purchase acts, and `activate` / `fail` record what happened.
 *
 * ── THE GUARDS, IN ORDER, BEFORE ANY PROVIDER CALL (T-11-11) ───────────────
 *
 *   1. `APP_BASE_URL` unset → no canonical URL exists to write onto the number.
 *   2. Its host is not the console host → a preview deployment or the marketing
 *      apex would answer every diverted call with somebody else's bytes.
 *   3. No `TWILIO_AU_BUNDLE_SID` → an AU local number cannot be bought without
 *      the approved regulatory bundle.
 *   4. No `TWILIO_AU_ADDRESS_SID` → nor without the address on it.
 *
 * ── THE URLS COME FROM THE ONE BUILDER ─────────────────────────────────────
 *
 * The Voice URL and the Status Callback are produced by `twilioWebhookUrl`, the
 * function the two routes rebuild to verify `X-Twilio-Signature`. A path typed
 * here would be a second spelling of a signed string; one byte of drift fails
 * every real call's signature while Twilio's debugger shows 200s.
 *
 * ── NOTHING THROWS, AND NOTHING LEAKS ──────────────────────────────────────
 *
 * Every outcome is a member of a closed union. Caught values are discarded: a
 * postgres error carries its statement, and a Twilio error can quote the number
 * searched. A refused purchase is stored as OUR closed `lower_snake` code —
 * the column's CHECK (`^[a-z_]{1,32}$`) admits no digits, so `http_400` is
 * mapped, never written. The friendly name is the tenant uuid behind a fixed prefix,
 * never the business name: it is visible to anyone with Twilio console access.
 *
 * ── NO RELEASE, NO DELETE ──────────────────────────────────────────────────
 *
 * There is no path in this file that gives a number back. D-08: a released
 * number is one Twilio can sell to a stranger while the tradie's phone keeps
 * diverting to it.
 *
 * Framework-free: nothing here imports `next/*`. Every dependency is
 * injectable, so the whole flow is proven by a pure suite with a fake
 * repository and a stubbed Twilio.
 */
import { CONSOLE_HOST } from '@/core/brand';
import { getServerEnv, type ServerEnv } from '@/core/shared/env';
import {
  attachBundle,
  listNumbersByFriendlyName,
  purchaseNumber,
  searchAuLocalNumbers,
  twilioCredsFromEnv,
  type TwilioCreds,
} from '@/core/telephony/twilio-client';
import { twilioWebhookHost, twilioWebhookUrl } from '@/core/telephony/webhook-url';
import { forTenant, type TenantScopedRepository } from '@/db/repository';

/** Exactly the configuration provisioning reads. */
export type ProvisionEnv = Pick<
  ServerEnv,
  | 'APP_BASE_URL'
  | 'TWILIO_AU_BUNDLE_SID'
  | 'TWILIO_AU_ADDRESS_SID'
  | 'TWILIO_VOICE_WEBHOOK_SECRET'
  | 'TWILIO_VOICE_STATUS_WEBHOOK_SECRET'
  | 'TWILIO_VOICE_FALLBACK_URL'
>;

export interface ProvisionDeps {
  repo?: (tenantId: string) => Pick<TenantScopedRepository, 'divertNumber'>;
  search?: typeof searchAuLocalNumbers;
  purchase?: typeof purchaseNumber;
  /** The CR-01 adopt path's read: OUR numbers by friendly name. */
  listOwned?: typeof listNumbersByFriendlyName;
  /** WR-09: the bundle-only update + read-back, when create did not attach it. */
  attachBundle?: typeof attachBundle;
  /** `null` = the credentials could not be read (a deployment fault). */
  creds?: TwilioCreds | null;
  env?: ProvisionEnv;
  consoleHost?: string;
  now?: () => Date;
}

/** A configuration refusal. Each names the ONE missing thing. */
export type ProvisionGuardRefusal =
  | { kind: 'base_url_unset' }
  | { kind: 'wrong_host'; host: string }
  | { kind: 'bundle_missing' }
  | { kind: 'address_missing' }
  /** The server env (or the Twilio credentials in it) could not be read. */
  | { kind: 'config_unreadable' };

export type FindCandidateResult =
  | { kind: 'candidate'; phoneNumber: string; locality: string | null; region: string | null }
  | { kind: 'already_provisioned'; numberE164: string }
  | { kind: 'in_progress' }
  | { kind: 'no_inventory' }
  | { kind: 'search_failed'; code: string }
  | ProvisionGuardRefusal;

/**
 * The purchase went through and the row could not be filled. The ONE literal
 * for it: the result kind and the log line are the same token, so the string
 * the founder searches the Vercel log for cannot drift from the code path.
 */
const ORPHANED = 'orphaned_number' as const;

/**
 * THE HOLD CODE (CR-01): stored on a `pending` row whose purchase may or may not
 * have gone through. Fits the `failure_code` CHECK (`^[a-z_]{1,32}$`); on a
 * pending row it is a hold, not a failure — the row is NOT re-opened for a
 * purchase until the account has been searched for the number.
 */
export const DIVERT_HOLD_CODE = 'outcome_unknown' as const;

/**
 * How long a held claim waits before a purchase may be retried when the account
 * shows no number under its friendly name. A create that timed out on our side
 * can still be completing on Twilio's for a short while; ten minutes is far
 * beyond that, and short enough that an operator mid-onboarding is not stuck.
 */
export const DIVERT_HOLD_MS = 10 * 60_000;

/**
 * WR-09: the code an ACTIVE row carries when Twilio did not report the AU
 * regulatory bundle on the number after the attach-and-read-back. The log line
 * and the stored code are the same token.
 */
export const DIVERT_BUNDLE_UNATTACHED = 'bundle_unattached' as const;

export type ProvisionResult =
  /** `bundleAttached: false` = bought and recorded, but Twilio shows no bundle on it (WR-09). */
  | { kind: 'provisioned'; numberE164: string; locality: string | null; bundleAttached: boolean }
  /** A number bought earlier (outcome unseen) was found on Twilio and recorded. Nothing new was bought. */
  | { kind: 'adopted'; numberE164: string; bundleAttached: boolean }
  | { kind: 'already_provisioned'; numberE164: string }
  | { kind: 'in_progress' }
  | { kind: 'purchase_failed'; code: string }
  /** The purchase may have gone through. The row stays `pending` and held. */
  | { kind: 'outcome_unknown'; code: string }
  /** The account could not be searched for an earlier purchase. Nothing was bought. */
  | { kind: 'lookup_failed'; code: string }
  | { kind: typeof ORPHANED; sid: string }
  | ProvisionGuardRefusal;

/**
 * May a `pending` row be recovered (WR-07)? Held (CR-01), or claimed longer ago
 * than the hold: a claim that old is not a purchase still in flight — the
 * function that made it was killed between claim and result, or its `fail` /
 * `activate` write threw — and without this it would read "in progress"
 * forever, with no path but a hand-run statement. Recovery is always the adopt
 * path first, so a claim whose purchase DID go through is recorded, never
 * bought twice.
 */
export function isRecoverablePending(
  row: { status: string; failureCode: string | null; updatedAt: Date },
  now: Date,
): boolean {
  if (row.status !== 'pending') return false;
  if (row.failureCode === DIVERT_HOLD_CODE) return true;
  return now.getTime() - row.updatedAt.getTime() >= DIVERT_HOLD_MS;
}

/** The friendly name every Backdesk divert number carries — the adopt key. */
export function divertFriendlyName(tenantId: string): string {
  return `backdesk-divert-${tenantId}`;
}

/** The locality searched first. Any WA 08 number is acceptable (Pitfall 8). */
const SEARCH_LOCALITY = 'Perth';

/**
 * The four configuration guards, in order — `null` when provisioning may
 * proceed. Exported so the search step refuses on exactly the same terms as
 * the purchase: a candidate the operator is then refused the right to buy is a
 * wasted tap and a confusing sentence.
 */
export function checkProvisionGuards(
  env: ProvisionEnv,
  consoleHost: string = CONSOLE_HOST,
): ProvisionGuardRefusal | null {
  let host: string | null;
  try {
    host = twilioWebhookHost(env);
  } catch {
    // `new URL` on a value the env schema should have refused. Not a host, so
    // not the console's host.
    return { kind: 'wrong_host', host: 'unparseable' };
  }
  if (host === null) return { kind: 'base_url_unset' };
  if (host !== consoleHost) return { kind: 'wrong_host', host };
  if (!env.TWILIO_AU_BUNDLE_SID) return { kind: 'bundle_missing' };
  if (!env.TWILIO_AU_ADDRESS_SID) return { kind: 'address_missing' };
  return null;
}

/**
 * A stored failure code the column's CHECK admits (`^[a-z_]{1,32}$` — no
 * digits). The client's reason (`http_400`, `ETIMEDOUT`, an error name) is
 * mapped onto a closed vocabulary; the provider's prose never reaches it.
 */
export function divertFailureCode(reason: string): string {
  const http = /^http_(\d{3})$/.exec(reason);
  if (http) {
    const status = Number(http[1]);
    if (status === 401 || status === 403) return 'provider_auth_refused';
    if (status === 404) return 'number_not_found';
    if (status === 429) return 'provider_rate_limited';
    if (status >= 500) return 'provider_unavailable';
    return 'provider_rejected';
  }
  if (/^E[A-Z_]{2,30}$/.test(reason)) return 'network_error';
  return 'sdk_error';
}

/**
 * Is this the claim losing the `tenant_id` UNIQUE race? SQLSTATE 23505 on the
 * error OR on its `cause` chain: drizzle wraps the driver's error in a
 * `DrizzleQueryError` whose `cause` carries the code (the `generate.ts` walk).
 * Anything else is NOT "in progress" — calling an unrelated fault a concurrent
 * claim would tell the operator to wait for a purchase nobody started.
 */
function isUniqueViolation(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause ?? null;
  }
  return false;
}

interface Resolved {
  env: ProvisionEnv;
  creds: TwilioCreds;
  consoleHost: string;
}

/** The env and credentials, or a refusal. Never throws. */
function resolve(deps: ProvisionDeps): Resolved | ProvisionGuardRefusal {
  let env: ProvisionEnv;
  if (deps.env) {
    env = deps.env;
  } else {
    try {
      env = getServerEnv();
    } catch {
      // The zod report names every missing key; it is discarded, not logged.
      return { kind: 'config_unreadable' };
    }
  }

  const consoleHost = deps.consoleHost ?? CONSOLE_HOST;
  const refused = checkProvisionGuards(env, consoleHost);
  if (refused) return refused;

  const creds = deps.creds === undefined ? twilioCredsFromEnv() : deps.creds;
  if (creds === null) return { kind: 'config_unreadable' };

  return { env, creds, consoleHost };
}

function isRefusal(value: Resolved | ProvisionGuardRefusal): value is ProvisionGuardRefusal {
  return 'kind' in value;
}

/**
 * TAP ONE: find a Perth number to offer. A READ — nothing is written and
 * nothing is bought. The row state is checked first so an operator is never
 * shown a number for a client that already has one.
 */
export async function findDivertNumberCandidate(
  input: { tenantId: string },
  deps: ProvisionDeps = {},
): Promise<FindCandidateResult> {
  const resolved = resolve(deps);
  if (isRefusal(resolved)) return resolved;

  const repo = (deps.repo ?? forTenant)(input.tenantId);
  let rows: Awaited<ReturnType<typeof repo.divertNumber.get>>;
  try {
    rows = await repo.divertNumber.get();
  } catch {
    console.error('[telephony] provision row read failed');
    return { kind: 'search_failed', code: 'read_failed' };
  }

  const row = rows[0] ?? null;
  if (row?.status === 'active' && row.numberE164) {
    return { kind: 'already_provisioned', numberE164: row.numberE164 };
  }
  // A HELD row (CR-01) or a STALE claim (WR-07) may be searched again: the buy
  // step looks the earlier purchase up on the account before it spends
  // anything. Any other pending row is a purchase somebody is still making.
  if (
    row?.status === 'pending' &&
    !isRecoverablePending(row, (deps.now ?? (() => new Date()))())
  ) {
    return { kind: 'in_progress' };
  }

  const found = await (deps.search ?? searchAuLocalNumbers)({
    creds: resolved.creds,
    locality: SEARCH_LOCALITY,
  });
  if (!found.ok) return { kind: 'search_failed', code: found.reason };

  const first = found.candidates[0];
  if (!first) return { kind: 'no_inventory' };

  return {
    kind: 'candidate',
    phoneNumber: first.phoneNumber,
    locality: first.locality,
    region: first.region,
  };
}

/**
 * TAP TWO: buy the number the operator was shown.
 *
 * guards → read the row → (failed or held row: ADOPT a number already on the
 * account under this client's friendly name, CR-01) → CLAIM (insert `pending`,
 * or re-claim the row) → purchase, fully configured in ONE create call →
 * `activate`, `fail` (Twilio refused) or `hold` (the outcome is unknown).
 *
 * ONLY A DETERMINATE REFUSAL FAILS THE ROW (CR-01). `failed` is the state the
 * retry path opens on, so writing it for a timeout or a 5xx — after which
 * Twilio may well have bought the number — would make the next click buy a
 * second one. Those outcomes keep the row `pending` under the hold code, and
 * the console tells the operator the truth: it may have gone through.
 *
 * A purchase that succeeds and a fill that then fails is the one outcome that
 * cannot be undone from here: the number exists, is ours, and is billed. It is
 * logged as a fixed line carrying the PN sid (an identifier, not personal data)
 * so the founder can attach it by hand; the `pending` row stays, so nobody can
 * buy a second one meanwhile.
 */
export async function provisionDivertNumber(
  input: {
    tenantId: string;
    spokenName: string;
    phoneNumber: string;
    operatorId: string;
    /** The candidate's locality, as the search step returned it. */
    locality?: string | null;
  },
  deps: ProvisionDeps = {},
): Promise<ProvisionResult> {
  const resolved = resolve(deps);
  if (isRefusal(resolved)) return resolved;
  const { env, creds } = resolved;

  // The guards refused a missing bundle or address already; restated as values
  // so the purchase's REQUIRED parameters (WR-09) can never be `undefined`.
  const bundleSid = env.TWILIO_AU_BUNDLE_SID;
  const addressSid = env.TWILIO_AU_ADDRESS_SID;
  if (!bundleSid) return { kind: 'bundle_missing' };
  if (!addressSid) return { kind: 'address_missing' };
  const ensure = (sid: string, reported: string | null) =>
    ensureBundle({ creds, sid, bundleSid, reported, attach: deps.attachBundle ?? attachBundle });

  const voiceUrl = twilioWebhookUrl('voice', env);
  const statusCallback = twilioWebhookUrl('voice-status', env);
  // Unreachable after the guards (a set base URL always builds), but a `null`
  // written onto a live number would be worse than a refusal.
  if (voiceUrl === null || statusCallback === null) return { kind: 'base_url_unset' };

  const repo = (deps.repo ?? forTenant)(input.tenantId);

  let rows: Awaited<ReturnType<typeof repo.divertNumber.get>>;
  try {
    rows = await repo.divertNumber.get();
  } catch {
    console.error('[telephony] provision row read failed');
    return { kind: 'purchase_failed', code: 'read_failed' };
  }

  const row = rows[0] ?? null;
  if (row?.status === 'active' && row.numberE164) {
    return { kind: 'already_provisioned', numberE164: row.numberE164 };
  }
  const now = (deps.now ?? (() => new Date()))();
  const held = row?.status === 'pending' && row.failureCode === DIVERT_HOLD_CODE;
  // A pending claim nobody is still buying on — held, or older than the hold —
  // goes through the same adopt-or-reclaim path as a failed row (WR-07). A
  // fresh claim is a purchase in flight, and is left alone.
  if (row?.status === 'pending' && !isRecoverablePending(row, now)) {
    return { kind: 'in_progress' };
  }

  // ── LOOK BEFORE BUYING AGAIN (CR-01) ─────────────────────────────────────
  //
  // A failed, held or stale row may already own a number: an earlier create whose
  // answer we never saw. Before ANY retry, the account is searched under this
  // client's friendly name and what is found is ADOPTED — recorded on the row
  // — instead of bought a second time. A search that cannot run buys nothing.
  if (row !== null) {
    const adopted = await adoptExisting({
      tenantId: input.tenantId,
      creds,
      repo,
      now,
      listOwned: deps.listOwned ?? listNumbersByFriendlyName,
      ensure,
    });
    if (adopted !== null) return adopted;

    // Nothing on the account. A HELD claim still waits out the hold: a create
    // that timed out on our side can still be completing on Twilio's.
    if (held && now.getTime() - row.updatedAt.getTime() < DIVERT_HOLD_MS) {
      return { kind: 'outcome_unknown', code: DIVERT_HOLD_CODE };
    }
  }

  // ── THE CLAIM ────────────────────────────────────────────────────────────
  if (row === null) {
    try {
      await repo.divertNumber.claim({
        spokenName: input.spokenName,
        createdBy: input.operatorId,
      });
    } catch (e) {
      // The caught value is DISCARDED beyond its SQLSTATE.
      if (isUniqueViolation(e)) return { kind: 'in_progress' };
      console.error('[telephony] provision claim failed');
      return { kind: 'purchase_failed', code: 'claim_failed' };
    }
  } else {
    // A FAILED OR HELD ROW IS RE-CLAIMED, NEVER RE-INSERTED — and each re-claim
    // is guarded on the state it read (`failed`, or `pending` and older than
    // the hold), so two retries race exactly as two first claims do: one
    // wins, the other reads zero rows and stops here.
    let reclaimed: Awaited<ReturnType<typeof repo.divertNumber.reclaim>>;
    try {
      reclaimed =
        row.status === 'failed'
          ? await repo.divertNumber.reclaim(input.spokenName)
          : await repo.divertNumber.reclaimStale(
              input.spokenName,
              new Date(now.getTime() - DIVERT_HOLD_MS),
            );
    } catch {
      console.error('[telephony] provision claim failed');
      return { kind: 'purchase_failed', code: 'claim_failed' };
    }
    if (reclaimed.length === 0) return { kind: 'in_progress' };
  }

  // ── THE PURCHASE — everything set in the SAME create call (Pitfall 7) ────
  const bought = await (deps.purchase ?? purchaseNumber)({
    creds,
    phoneNumber: input.phoneNumber,
    friendlyName: divertFriendlyName(input.tenantId),
    voiceUrl,
    statusCallback,
    bundleSid,
    addressSid,
    voiceFallbackUrl: env.TWILIO_VOICE_FALLBACK_URL,
  });

  if (!bought.ok) {
    const code = divertFailureCode(bought.reason);

    if (!bought.determinate) {
      // THE PURCHASE MAY HAVE GONE THROUGH (CR-01). A timeout, a reset or a 5xx
      // after the create left says nothing about whether Twilio bought it, so
      // the row is NOT failed — `failed` is the state the retry path opens on.
      // It stays `pending`, held, and the next attempt searches the account
      // under the friendly name before it spends anything.
      try {
        await repo.divertNumber.hold({ failureCode: DIVERT_HOLD_CODE });
      } catch {
        // Still `pending` (the claim stands), just without the hold code: the
        // stale-claim path recovers it the same way once the hold has passed.
        console.error('[telephony] provision hold write failed');
      }
      console.error(`[telephony] provision ${DIVERT_HOLD_CODE} ${code}`);
      return { kind: 'outcome_unknown', code };
    }

    try {
      await repo.divertNumber.fail({ failureCode: code });
    } catch {
      // The row stays `pending`: nothing was bought, and "in progress" is the
      // safe reading until somebody looks. The fixed line says where to look.
      console.error('[telephony] provision fail write failed');
    }
    return { kind: 'purchase_failed', code };
  }

  // ── THE BUNDLE, READ BACK (WR-09) ────────────────────────────────────────
  const bundleAttached = await ensure(bought.sid, bought.bundleSid);

  // ── THE FILL ─────────────────────────────────────────────────────────────
  const locality = input.locality ?? null;
  let filled: Awaited<ReturnType<typeof repo.divertNumber.activate>>;
  try {
    filled = await repo.divertNumber.activate({
      providerNumberSid: bought.sid,
      numberE164: bought.phoneNumber,
      locality,
      purchasedAt: now,
      failureCode: bundleAttached ? null : DIVERT_BUNDLE_UNATTACHED,
    });
  } catch {
    filled = [];
  }
  if (filled.length === 0) {
    // THE NUMBER IS BOUGHT AND NOT RECORDED — the write threw, or its guard
    // matched no row (IN-08: zero rows is not "provisioned"). The sid is
    // Twilio's identifier for a resource on OUR account — the handle the
    // founder needs to attach it by hand. The caught value is discarded: it
    // carries the statement.
    console.error(`[telephony] provision ${ORPHANED} ${bought.sid}`);
    return { kind: ORPHANED, sid: bought.sid };
  }

  return { kind: 'provisioned', numberE164: bought.phoneNumber, locality, bundleAttached };
}

/**
 * IS THE AU BUNDLE ON THE NUMBER? (WR-09, F-11-07-2)
 *
 * `reported` is what Twilio said the number carries (the create response, or
 * the account listing on adoption). If it is not our bundle, attach it with the
 * bundle-only update and READ IT BACK; the read-back decides. Still not there
 * → `false`, a fixed log line carrying the PN sid (an identifier, not personal
 * data), and the caller records `bundle_unattached` on the row so the console
 * shows it. Never throws: `attachBundle` resolves to a union.
 */
async function ensureBundle(pass: {
  creds: TwilioCreds;
  sid: string;
  bundleSid: string;
  reported: string | null;
  attach: typeof attachBundle;
}): Promise<boolean> {
  if (pass.reported === pass.bundleSid) return true;

  const attached = await pass.attach({ creds: pass.creds, sid: pass.sid, bundleSid: pass.bundleSid });
  if (attached.ok && attached.bundleSid === pass.bundleSid) return true;

  console.error(`[telephony] provision ${DIVERT_BUNDLE_UNATTACHED} ${pass.sid}`);
  return false;
}

/**
 * THE ADOPT PATH (CR-01): search the account for a number already carrying this
 * client's friendly name and, if there is one, record it on the row instead of
 * buying. `null` means "nothing on the account — the caller may go on".
 */
async function adoptExisting(pass: {
  tenantId: string;
  creds: TwilioCreds;
  repo: Pick<TenantScopedRepository, 'divertNumber'>;
  now: Date;
  listOwned: typeof listNumbersByFriendlyName;
  ensure: (sid: string, reported: string | null) => Promise<boolean>;
}): Promise<ProvisionResult | null> {
  const listed = await pass.listOwned({
    creds: pass.creds,
    friendlyName: divertFriendlyName(pass.tenantId),
  });
  if (!listed.ok) {
    // CANNOT LOOK, SO DO NOT BUY: a retry made blind is the double purchase
    // this path exists to prevent.
    console.error(`[telephony] provision lookup_failed ${listed.reason}`);
    return { kind: 'lookup_failed', code: listed.reason };
  }

  const existing = listed.items[0];
  if (existing === undefined) return null;
  if (listed.items.length > 1) {
    // Two numbers under one client's name is the double purchase already
    // happened. The first is adopted; the count tells the founder to look.
    console.error(`[telephony] provision duplicate_numbers ${listed.items.length}`);
  }

  // The adopted number gets the same bundle read-back as a fresh purchase.
  const bundleAttached = await pass.ensure(existing.sid, existing.bundleSid);

  let adopted: Awaited<ReturnType<typeof pass.repo.divertNumber.activate>>;
  try {
    adopted = await pass.repo.divertNumber.activate({
      providerNumberSid: existing.sid,
      numberE164: existing.phoneNumber,
      // The search step's locality belonged to the candidate on screen, which
      // may not be this number. Unknown is the honest value.
      locality: null,
      purchasedAt: pass.now,
      failureCode: bundleAttached ? null : DIVERT_BUNDLE_UNATTACHED,
    });
  } catch {
    console.error(`[telephony] provision ${ORPHANED} ${existing.sid}`);
    return { kind: ORPHANED, sid: existing.sid };
  }
  // The guard matched nothing: the row moved under us (another attempt
  // finished first). Nothing was bought here; the reload shows which.
  if (adopted.length === 0) return { kind: 'in_progress' };

  console.info(`[telephony] provision adopted ${existing.sid}`);
  return { kind: 'adopted', numberE164: existing.phoneNumber, bundleAttached };
}
