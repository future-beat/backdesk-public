/**
 * The messaging-config repository — the D-04 activation switch's only read and
 * write path.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS NOT A `forTenant()` NAMESPACE, AND WHY THAT IS NOT AN ESCAPE │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `forTenant(id)` closes over a tenant id and exposes no method that accepts
 * one, because forgetting a `WHERE tenant_id` is a cross-tenant leak. That
 * mechanism cannot express this table for the same structural reason
 * `inbound_messages` could not: the row that matters most has `tenant_id = NULL`
 * by design. `getChannelConfig` must be able to ask "is there a row for THIS
 * tenant, and if not, what is the global default" — a question with two scopes
 * in it, which a closure over one scope cannot pose.
 *
 * So this is the same shape of exception the prospect (D-01/D-03), consumer-
 * cursor (03-02) and inbound (04-01) families already are: its own file, its own
 * line in the barrel. What it owes in return is the same thing they owe — it
 * reads and writes ONE table and joins nothing. There is no accessor here that
 * can reach `cadences`, `quotes`, `tenants` or `send_ledger`, so nothing in this
 * file can turn "which number do we send from" into a read of customer data.
 *
 * `listChannelConfig` is the one accessor that returns other tenants' rows. It
 * is bounded by what the table holds: a channel, a from-address, a reply-to, a
 * business name and a flag — the sending identity that appears in the message a
 * customer receives anyway. NO CREDENTIALS LIVE HERE (see the schema header), so
 * there is nothing in a row of this table that a leak would make worse.
 *
 * Service-role, so RLS is bypassed by design; the policy on the table is
 * defence-in-depth for the console's authenticated reads.
 */
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';

import { messagingConfig, messagingConfigAudit, TEXT_BACK_CHANNEL } from '@/db/schema';
import type {
  MessagingChannel,
  MessagingConfigAuditAction,
  MessagingConfigRow,
  NewMessagingConfigRow,
} from '@/db/schema';

import { getDb } from './client';
import type { RepositoryDb } from './client';

/**
 * One config row as a caller supplies it.
 *
 * `id`, `createdAt` and `updatedAt` are omitted rather than optional: they are
 * the database's to decide. `updatedAt` in particular is set by the upsert below
 * on every write, so a caller-supplied value could only ever make the "when was
 * sending last reconfigured" question answer wrongly.
 *
 * `channel` is narrowed from the schema's `string` to `MessagingChannel`: the
 * CHECK constraint would catch a typo, but it would catch it as a 23514 raised
 * from inside the activation script rather than as a compile error.
 */
export type MessagingConfigUpsert = Omit<
  NewMessagingConfigRow,
  'id' | 'createdAt' | 'updatedAt' | 'channel'
> & { channel: MessagingChannel };

/**
 * Tenant rows sort before the global row.
 *
 * Postgres orders booleans false-then-true, so ascending `tenant_id IS NULL`
 * puts a real tenant id (false) ahead of the global row (true). The precedence
 * is therefore expressed ONCE, in the ORDER BY, rather than a second time in a
 * caller's `find()` — two spellings of "the override wins" is how a tenant row
 * ends up being read for one caller and ignored by another.
 */
const OVERRIDE_FIRST = asc(isNull(messagingConfig.tenantId));

/**
 * The identity to send this tenant's `channel` messages as — TENANT ROW FIRST,
 * GLOBAL ROW OTHERWISE, `null` if neither exists.
 *
 * ONE QUERY, NOT TWO. Both candidate rows are fetched in a single statement and
 * `[0]` is the answer. A read-then-read-again would be two round-trips on the
 * send path and — worse — a window in which a config change could be observed
 * half-applied: the tenant read missing a row that the global read then also
 * misses, producing "not configured" for a client that IS configured, i.e. a
 * silent fall back to the stub in the middle of an activation.
 *
 * `tenantId` is OPTIONAL: `getChannelConfig('sms')` asks for the global row
 * alone, which is what `buildRoutingSender` asks at construction time (before
 * any tenant is in hand) and what the activation script writes and re-reads.
 */
export async function getChannelConfig(
  channel: MessagingChannel,
  tenantId?: string | null,
): Promise<MessagingConfigRow | null> {
  // `tenant_id = $1 OR tenant_id IS NULL` — exactly the two candidate rows, and
  // the unique index guarantees there is at most one of each.
  const scope = tenantId
    ? and(
        eq(messagingConfig.channel, channel),
        or(eq(messagingConfig.tenantId, tenantId), isNull(messagingConfig.tenantId)),
      )
    : and(eq(messagingConfig.channel, channel), isNull(messagingConfig.tenantId));

  const rows = await getDb()
    .select()
    .from(messagingConfig)
    .where(scope)
    .orderBy(OVERRIDE_FIRST)
    .limit(2);

  return rows[0] ?? null;
}

/**
 * IS THIS CHANNEL ARMED ANYWHERE? — the DEPLOYMENT-level activation question.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO QUESTIONS, TWO FUNCTIONS, AND CONFLATING THEM WAS CR-01.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `getChannelConfig` answers "WHICH identity does this tenant send as" and is
 * the sole authority on that. This answers a strictly narrower one: "is there
 * ANY enabled row for this channel", asked once per tick by `buildRoutingSender`
 * at a moment when no tenant is in hand, to decide whether a real provider is
 * worth wiring in at all.
 *
 * `buildRoutingSender` used to ask `getChannelConfig(channel)` with no tenant,
 * which reads the GLOBAL row alone — so enabling ONE client's override row while
 * the global row stayed off wired in `StubSender` for everybody, silently, while
 * the console reported success. That made the one-client-at-a-time rollout this
 * table exists for (D-04) unreachable: the only working activation was the
 * global row, which arms every client at once.
 *
 * WIDENING THE DEPLOYMENT GATE DOES NOT WIDEN THE BLAST RADIUS. A `true` here
 * only means a real sender object is constructed; every message still resolves
 * its identity through `resolveSmsFrom` / `resolveEmailIdentity`, which return
 * `null` for a tenant whose effective row is disabled or incomplete, and the
 * senders record `sms_not_configured` / `email_not_configured` on the ledger.
 * A tenant that was refused before is still refused — now with evidence a human
 * can read, instead of a stub row indistinguishable from Phase 3.
 *
 * ONE STATEMENT, ONE COLUMN, NO JOIN, `LIMIT 1`: it exists to be cheap enough to
 * run on every tick, and it keeps this file's promise that nothing in it can
 * turn "which number do we send from" into a read of customer data.
 */
export async function anyChannelEnabled(channel: MessagingChannel): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: messagingConfig.id })
    .from(messagingConfig)
    .where(and(eq(messagingConfig.channel, channel), eq(messagingConfig.enabled, true)))
    .limit(1);

  return row !== undefined;
}

/**
 * Every configured row for a channel, global row LAST.
 *
 * The operator console's messaging page (04-06) and the activation script
 * (04-07) both read this. Ordered by the same rule `getChannelConfig` ranks
 * with, so a reader of both files sees one precedence rather than two: overrides
 * first, then the default they override.
 */
export async function listChannelConfig(
  channel: MessagingChannel,
): Promise<MessagingConfigRow[]> {
  return getDb()
    .select()
    .from(messagingConfig)
    .where(eq(messagingConfig.channel, channel))
    .orderBy(OVERRIDE_FIRST, asc(messagingConfig.createdAt));
}

/**
 * Create or update the row for `(channel, tenant_id)`. THE ONLY WRITE PATH.
 *
 * `ON CONFLICT (channel, tenant_id) DO UPDATE` against the NULLS-NOT-DISTINCT
 * unique index, so an upsert of the GLOBAL row (`tenantId: null`) updates the
 * existing global row rather than inserting a second one. That is the entire
 * reason the index carries `NULLS NOT DISTINCT`: under Postgres's default,
 * `tenant_id IS NULL` rows never conflict, every upsert of the global config
 * would INSERT, and `getChannelConfig` would then return an arbitrary one of
 * them — this system sending from whichever number the planner happened to pick,
 * with no error anywhere.
 *
 * The `set` clause is EXHAUSTIVE over the mutable columns and coalesces each
 * absent field to its default rather than leaving it alone. An upsert here is a
 * caller stating the whole identity, not patching one field: a partial update
 * that silently kept a previous `from_address` would let the console's "clear
 * the number" produce a row that still sends from the old one.
 *
 * THREE CALLERS BY DESIGN (04-06 console action, 04-07 activation script, and
 * — through `upsertWith` below — the Phase 10 arm/disarm writers). All of them
 * go through the ONE statement rather than each building their own, because
 * "which number do we send as" is one decision and two writers is how an
 * activation turns one client on and another half-on.
 */
export async function upsertChannelConfig(
  row: MessagingConfigUpsert,
): Promise<MessagingConfigRow> {
  return upsertWith(getDb(), row);
}

/** Any drizzle handle: the pool, or a transaction bound to one connection. */
type DbLike = RepositoryDb | Parameters<Parameters<RepositoryDb['transaction']>[0]>[0];

/**
 * THE STATEMENT ITSELF, on whichever handle the caller holds.
 *
 * Extracted so `armChannel` / `disarmChannel` can run the SAME upsert inside
 * their transaction, beside the audit INSERT, without the file growing a second
 * spelling of the exhaustive `set` clause. A second spelling is Pitfall 4: the
 * copy that omits `fromAddress` arms a row with no number, `resolveSmsFrom`
 * returns null, every send records `sms_not_configured`, and the console shows
 * a green "Armed" badge over it.
 *
 * Private on purpose. The handle parameter is the whole difference between this
 * and `upsertChannelConfig`, and a handle in a public signature is an invitation
 * to pass a transaction from somewhere that should not have one.
 */
async function upsertWith(db: DbLike, row: MessagingConfigUpsert): Promise<MessagingConfigRow> {
  const [written] = await db
    .insert(messagingConfig)
    .values(row)
    .onConflictDoUpdate({
      target: [messagingConfig.channel, messagingConfig.tenantId],
      set: {
        fromAddress: row.fromAddress ?? null,
        replyTo: row.replyTo ?? null,
        businessName: row.businessName ?? null,
        enabled: row.enabled ?? false,
        updatedAt: new Date(),
      },
    })
    .returning();

  return written;
}

/* ------------------------------------------------------------------------- *
 * ARM / DISARM — the audited writers (Phase 10, D-04)
 * ------------------------------------------------------------------------- */

/**
 * The exact row an arm or disarm TARGETS — never the effective/fallback row.
 *
 * `getChannelConfig` answers "which identity does this tenant SEND as", which
 * falls back to the global row. Arming must not: "arm email for this client"
 * resolving to the global row would flip a row belonging to everybody because
 * one client had none of their own. So the predicate here is exact — this
 * tenant's row, or the global row, and nothing stands in for either.
 */
/**
 * The channels the EXACT-TARGET reads may name. Since 12-08 this is the whole
 * of `MESSAGING_CHANNELS` — `text_back` joined the vocabulary together with
 * the gate that stands in front of arming it (D-09).
 */
type TargetChannel = MessagingChannel;

function targetScope(channel: TargetChannel, tenantId: string | null) {
  return and(
    eq(messagingConfig.channel, channel),
    tenantId === null
      ? isNull(messagingConfig.tenantId)
      : eq(messagingConfig.tenantId, tenantId),
  );
}

async function readTarget(
  db: DbLike,
  channel: TargetChannel,
  tenantId: string | null,
): Promise<MessagingConfigRow | null> {
  const [row] = await db
    .select()
    .from(messagingConfig)
    .where(targetScope(channel, tenantId))
    .limit(1);

  return row ?? null;
}

/**
 * IS THIS CLIENT'S TEXT-BACK ARMED? (Phase 12, D-09.) The EXACT-TARGET read.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NEVER `getChannelConfig('text_back', …)`. That reader falls back to the   │
 * │ global row by design, and text-back has no global row — the CHECK         │
 * │ `messaging_config_text_back_per_tenant` refuses one. Asking the fallback  │
 * │ reader would make "is this client armed" depend on a row that must not    │
 * │ exist, which is one migration mistake away from texting every client's    │
 * │ callers at once.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `true` only when THIS tenant's own `text_back` row exists and is enabled. A
 * missing row is "not armed", never "armed by default". Read on every call by
 * `sendTextBack`, so a disarm takes effect on the next call (D-09).
 */
export async function isTextBackArmed(tenantId: string): Promise<boolean> {
  const row = await readTarget(getDb(), TEXT_BACK_CHANNEL, tenantId);
  return row?.enabled === true;
}

export interface ArmChannelInput {
  channel: MessagingChannel;
  /** `null` = the shared row (sms in v1) — the same keying the table uses. */
  tenantId: string | null;
  /** From `requireOperatorId()`, never from a form field. */
  operatorUserId: string;
  reason?: string;
}

/**
 * What an arm did, as an OUTCOME rather than an exception.
 *
 * `no_identity` and `already_armed` are ordinary answers, not errors: the first
 * is a client whose email identity has not been created yet, the second is a
 * second tap on a control that already did its job. Both leave the database
 * untouched, and `already_armed` writing no audit row is what makes "one audit
 * row per EFFECTIVE action" true — arming twice does not manufacture history.
 */
export type ArmChannelResult =
  | { kind: 'armed'; config: MessagingConfigRow; auditId: string }
  | { kind: 'already_armed'; config: MessagingConfigRow }
  | { kind: 'no_identity'; missing: 'row' | 'from_address' | 'reply_to' | 'business_name' }
  | PerTenantOnly;

/**
 * `text_back` ASKED OF THE ROW THAT BELONGS TO EVERYBODY (Phase 12, D-09).
 *
 * Text-back is armed one client at a time and there is no global text-back
 * row: the console action refuses the `everyone` target, this refusal stops a
 * null tenant before any statement, and the CHECK
 * `messaging_config_text_back_per_tenant` refuses the row itself. Three layers,
 * because the failure each one prevents is texting every client's callers at
 * once.
 */
export type PerTenantOnly = { kind: 'per_tenant_only' };

/** Refused BEFORE any statement — see `PerTenantOnly`. */
function refusesGlobal(channel: MessagingChannel, tenantId: string | null): boolean {
  return channel === TEXT_BACK_CHANNEL && tenantId === null;
}

/**
 * TURN SENDING ON for one (channel, tenant) row, and record the hand that did.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE UPSERT AND THE AUDIT ROW ARE ONE TRANSACTION. A crash between two    │
 * │ separate awaits leaves production armed with nothing to explain it, and  │
 * │ this is the write where that matters most: the next tick sends real      │
 * │ customer messages.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THE IDENTITY IS RE-READ AND RE-SUPPLIED (Pitfall 4). The upsert's `set` is
 * exhaustive by design, so `{channel, tenantId, enabled: true}` would null the
 * from-address, the reply-to and the business name — arming a row that cannot
 * send, with a green badge over it. The row is read INSIDE the transaction and
 * every identity field goes back in.
 *
 * CONCURRENCY: two operators arming the same row serialise on the
 * `(channel, tenant_id)` unique index inside their transactions — the second
 * one's upsert waits for the first to commit, then writes its own audit row
 * beside its own flip. Neither can observe a config row without its audit row,
 * and neither can the tick.
 */
export async function armChannel(input: ArmChannelInput): Promise<ArmChannelResult> {
  // TEXT-BACK HAS NO GLOBAL ROW, AND NO CALLER MAY ASK FOR ONE (D-09).
  if (refusesGlobal(input.channel, input.tenantId)) return { kind: 'per_tenant_only' };

  return getDb().transaction(async (tx) => {
    const target = await readTarget(tx, input.channel, input.tenantId);

    // ── TEXT-BACK: A SWITCH WITH NO IDENTITY (Phase 12, D-09) ────────────────
    //
    // The text leaves from the SMS number `resolveSmsFrom` answers for, and the
    // arming gate checks that separately (`smsArmed`), so there is nothing here
    // to require and nothing to re-supply: an absent row is CREATED enabled
    // with NULL identity columns, instead of the `no_identity` refusal a
    // sending channel gets. Same transaction, same audit row, same
    // already-on-is-not-an-event rule.
    if (input.channel === TEXT_BACK_CHANNEL) {
      if (target?.enabled) return { kind: 'already_armed', config: target } as const;

      const config = await upsertWith(tx, {
        channel: TEXT_BACK_CHANNEL,
        tenantId: input.tenantId,
        fromAddress: null,
        replyTo: null,
        businessName: null,
        enabled: true,
      });

      const auditId = await appendAudit(tx, {
        channel: TEXT_BACK_CHANNEL,
        tenantId: input.tenantId,
        action: 'arm',
        operatorUserId: input.operatorUserId,
        reason: input.reason ?? null,
        fromAddress: null,
      });

      return { kind: 'armed', config, auditId } as const;
    }

    if (!target) return { kind: 'no_identity', missing: 'row' } as const;

    // WHAT EACH CHANNEL NEEDS BEFORE IT MAY BE ARMED — the same three refusals
    // `/settings/email` applies when it creates the identity (D-01: a customer
    // who hits reply must reach the tradie; the Spam Act needs the sender
    // identified), enforced again here because this is the write that actually
    // starts the sending.
    if ((target.fromAddress ?? '').trim() === '') {
      return { kind: 'no_identity', missing: 'from_address' } as const;
    }
    if (input.channel === 'email') {
      if ((target.replyTo ?? '').trim() === '') {
        return { kind: 'no_identity', missing: 'reply_to' } as const;
      }
      if ((target.businessName ?? '').trim() === '') {
        return { kind: 'no_identity', missing: 'business_name' } as const;
      }
    }

    // ALREADY ON IS NOT AN ERROR AND NOT AN EVENT. No write, so no second audit
    // row for a flip that did not happen.
    if (target.enabled) return { kind: 'already_armed', config: target } as const;

    const config = await upsertWith(tx, {
      channel: input.channel,
      tenantId: input.tenantId,
      fromAddress: target.fromAddress,
      replyTo: target.replyTo,
      businessName: target.businessName,
      enabled: true,
    });

    const auditId = await appendAudit(tx, {
      channel: input.channel,
      tenantId: input.tenantId,
      action: 'arm',
      operatorUserId: input.operatorUserId,
      reason: input.reason ?? null,
      fromAddress: config.fromAddress,
    });

    return { kind: 'armed', config, auditId } as const;
  });
}

export interface DisarmChannelInput {
  channel: MessagingChannel;
  tenantId: string | null;
  operatorUserId: string;
  /** REQUIRED — see the audit table's CHECK. A disarm is the interesting event. */
  reason: string;
}

export type DisarmChannelResult =
  | { kind: 'disarmed'; config: MessagingConfigRow; auditId: string }
  | { kind: 'already_disarmed'; config: MessagingConfigRow }
  | { kind: 'reason_required' }
  | PerTenantOnly;

/**
 * TURN SENDING OFF for one (channel, tenant) row, and record why.
 *
 * NEVER GATED (D-05). Every refusal `armChannel` carries exists to stop sending
 * starting; none of them may stand between an operator and stopping it.
 *
 * ── THE EXPLICIT-OFF OVERRIDE ───────────────────────────────────────────────
 *
 * Disarming a TENANT row that does not exist yet is not a no-op: it is the one
 * way to hold a single client off while the shared sms row is on (routing's
 * "an explicit per-client `enabled = false` means STOP, not fall back"). So a
 * missing tenant target is CREATED, disabled, with the identity copied from
 * whatever that tenant currently resolves to — the row exists to say OFF, and
 * an explicit OFF needs no identity of its own when there is none to copy.
 */
export async function disarmChannel(input: DisarmChannelInput): Promise<DisarmChannelResult> {
  // BEFORE ANY STATEMENT. The CHECK constraint would refuse an empty reason as
  // a 23514 from inside the transaction; this refuses it as an outcome the
  // action can turn into a sentence.
  const reason = input.reason.trim();
  if (reason === '') return { kind: 'reason_required' };

  // There is no global text-back row to turn off, and a request for one is a
  // caller that has misunderstood the switch — refused, never widened (D-09).
  if (refusesGlobal(input.channel, input.tenantId)) return { kind: 'per_tenant_only' };

  return getDb().transaction(async (tx) => {
    const target = await readTarget(tx, input.channel, input.tenantId);

    if (target && !target.enabled) {
      return { kind: 'already_disarmed', config: target } as const;
    }

    // The explicit-off override: no row of this tenant's own, so the identity
    // is taken from the row they currently send under (tenant first, then the
    // shared row — the same OVERRIDE_FIRST precedence `getChannelConfig` uses,
    // asked through this transaction's handle).
    let identity = target;
    if (!target && input.tenantId !== null) {
      const [effective] = await tx
        .select()
        .from(messagingConfig)
        .where(
          and(
            eq(messagingConfig.channel, input.channel),
            or(eq(messagingConfig.tenantId, input.tenantId), isNull(messagingConfig.tenantId)),
          ),
        )
        .orderBy(OVERRIDE_FIRST)
        .limit(2);

      identity = effective ?? null;
    }

    const config = await upsertWith(tx, {
      channel: input.channel,
      tenantId: input.tenantId,
      fromAddress: identity?.fromAddress ?? null,
      replyTo: identity?.replyTo ?? null,
      businessName: identity?.businessName ?? null,
      enabled: false,
    });

    const auditId = await appendAudit(tx, {
      channel: input.channel,
      tenantId: input.tenantId,
      action: 'disarm',
      operatorUserId: input.operatorUserId,
      reason,
      fromAddress: target?.fromAddress ?? null,
    });

    return { kind: 'disarmed', config, auditId } as const;
  });
}

/**
 * The audit INSERT. Private, and called only from inside the two transactions
 * above — an audit row written on its own would be a record of a flip that may
 * not have happened, which is worse than none.
 */
async function appendAudit(
  db: DbLike,
  row: {
    channel: MessagingChannel;
    tenantId: string | null;
    action: MessagingConfigAuditAction;
    operatorUserId: string;
    reason: string | null;
    fromAddress: string | null;
  },
): Promise<string> {
  const [written] = await db
    .insert(messagingConfigAudit)
    .values(row)
    .returning({ id: messagingConfigAudit.id });

  if (!written) throw new Error('appendAudit: the INSERT returned no row.');

  return written.id;
}

/* ------------------------------------------------------------------------- *
 * THE SYSTEM DISARM (Phase 12, D-21) — the one write with no hand on it
 * ------------------------------------------------------------------------- */

/**
 * What the low-balance auto-disarm supplies. The CHANNEL IS THE LITERAL
 * `'text_back'` and the tenant is REQUIRED: the system may turn off one
 * client's text-back and nothing else — never the shared sms row, never email,
 * and never anything on.
 */
export interface DisarmChannelBySystemInput {
  channel: typeof TEXT_BACK_CHANNEL;
  tenantId: string;
  /** REQUIRED and non-blank, e.g. `auto: ClickSend balance below A$5`. */
  reason: string;
}

export type DisarmChannelBySystemResult =
  | { kind: 'disarmed'; config: MessagingConfigRow; auditId: string }
  | { kind: 'already_disarmed'; config: MessagingConfigRow | null };

/**
 * TURN ONE CLIENT'S TEXT-BACK OFF BECAUSE THE PRODUCT DECIDED TO (D-21), and
 * record that no person did.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A SEPARATE FUNCTION, NOT `disarmChannel` WITH A NULL OPERATOR. The       │
 * │ operator writers keep `operatorUserId: string`, so no console caller can │
 * │ pass NULL by accident; this is the only path that writes                 │
 * │ `actor = 'system'`, and its input type cannot name an arm, another       │
 * │ channel or the shared row. The database agrees: the CHECKs               │
 * │ `messaging_config_audit_actor_identity` and                             │
 * │ `messaging_config_audit_system_disarms` refuse a system arm and an       │
 * │ operator row with no user id.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ONE TRANSACTION: the exact-target read, the guarded flip and the audit row.
 * An absent or already-disabled row is `already_disarmed` and writes NOTHING —
 * no flip and no audit row — so a probe that runs every fifteen minutes below
 * the floor records one system disarm, not one per tick. Unlike the operator's
 * `disarmChannel` it never CREATES a row: an absent text-back row is already
 * off (`isTextBackArmed` reads absence as not armed).
 *
 * The flip is `UPDATE … WHERE id = ? AND enabled = true`, not the upsert: a
 * concurrent operator disarm that commits first makes this statement match
 * nothing, and the answer is then `already_disarmed` with no second audit row.
 *
 * The reason is trimmed and checked BEFORE ANY STATEMENT; a blank one is a
 * programming error (the caller passes a constant), so it throws rather than
 * reaching the CHECK as a 23514 inside the tick.
 */
export async function disarmChannelBySystem(
  input: DisarmChannelBySystemInput,
): Promise<DisarmChannelBySystemResult> {
  if (input.channel !== TEXT_BACK_CHANNEL) {
    throw new Error('disarmChannelBySystem: only the text_back channel may be disarmed by the system.');
  }
  if (input.tenantId.trim() === '') {
    throw new Error('disarmChannelBySystem: a tenant id is required.');
  }
  const reason = input.reason.trim();
  if (reason === '') {
    throw new Error('disarmChannelBySystem: a reason is required.');
  }

  return getDb().transaction(async (tx) => {
    const target = await readTarget(tx, TEXT_BACK_CHANNEL, input.tenantId);

    // ABSENT OR ALREADY OFF IS NOT AN EVENT: no write, no audit row.
    if (!target || !target.enabled) {
      return { kind: 'already_disarmed', config: target } as const;
    }

    const [config] = await tx
      .update(messagingConfig)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(messagingConfig.id, target.id), eq(messagingConfig.enabled, true)))
      .returning();

    if (!config) return { kind: 'already_disarmed', config: target } as const;

    const [written] = await tx
      .insert(messagingConfigAudit)
      .values({
        channel: TEXT_BACK_CHANNEL,
        tenantId: input.tenantId,
        action: 'disarm',
        // THE ONLY WRITER OF THIS VALUE. No hand was on the switch, so there
        // is no operator id — and the CHECK requires exactly that pairing.
        actor: 'system',
        operatorUserId: null,
        reason,
        fromAddress: target.fromAddress,
      })
      .returning({ id: messagingConfigAudit.id });

    if (!written) throw new Error('disarmChannelBySystem: the audit INSERT returned no row.');

    return { kind: 'disarmed', config, auditId: written.id } as const;
  });
}

/**
 * The tenants whose OWN `text_back` row is enabled — the balance probe's list
 * of whom an auto-disarm would reach, and its "is anybody armed" test (empty
 * means the probe makes no ClickSend call at all).
 *
 * Tenant ids only. One table, no join. `tenant_id` is never NULL on a
 * `text_back` row (`messaging_config_text_back_per_tenant`); the narrowing
 * below says so to the compiler rather than casting.
 */
export async function listArmedTextBackTenantIds(): Promise<string[]> {
  const rows = await getDb()
    .select({ tenantId: messagingConfig.tenantId })
    .from(messagingConfig)
    .where(and(eq(messagingConfig.channel, TEXT_BACK_CHANNEL), eq(messagingConfig.enabled, true)))
    .orderBy(asc(messagingConfig.createdAt), asc(messagingConfig.id));

  return rows.flatMap((r) => (r.tenantId === null ? [] : [r.tenantId]));
}

/** One line of the switch's history, as the client page renders it. */
export interface ChannelAuditRow {
  id: string;
  channel: string;
  /** `null` = the shared row. */
  tenantId: string | null;
  action: string;
  /**
   * One of MESSAGING_CONFIG_AUDIT_ACTORS (Phase 12, D-21): `'operator'`, or
   * `'system'` for the low-balance auto-disarm.
   */
  actor: string;
  /** `null` exactly when `actor = 'system'` — no hand was on the switch. */
  operatorUserId: string | null;
  reason: string | null;
  fromAddress: string | null;
  createdAt: Date;
}

/**
 * The most recent flips of one channel's switch, newest first.
 *
 * `includeGlobal` is the SMS case: the shared row belongs to nobody, so its
 * history has no client page of its own — every client page shows it, because
 * every client is affected by it. Email passes `false`: another client's email
 * arming is none of this page's business.
 *
 * `created_at DESC, id DESC` — the id tiebreak makes the order deterministic
 * for two rows written in the same millisecond, which is exactly what a test
 * that arms and disarms in one breath produces.
 */
export async function listChannelAudit(
  channel: MessagingChannel,
  scope: { tenantId: string; includeGlobal: boolean },
  limit = 3,
): Promise<ChannelAuditRow[]> {
  const where = scope.includeGlobal
    ? and(
        eq(messagingConfigAudit.channel, channel),
        or(
          eq(messagingConfigAudit.tenantId, scope.tenantId),
          isNull(messagingConfigAudit.tenantId),
        ),
      )
    : and(
        eq(messagingConfigAudit.channel, channel),
        eq(messagingConfigAudit.tenantId, scope.tenantId),
      );

  return getDb()
    .select({
      id: messagingConfigAudit.id,
      channel: messagingConfigAudit.channel,
      tenantId: messagingConfigAudit.tenantId,
      action: messagingConfigAudit.action,
      actor: messagingConfigAudit.actor,
      operatorUserId: messagingConfigAudit.operatorUserId,
      reason: messagingConfigAudit.reason,
      fromAddress: messagingConfigAudit.fromAddress,
      createdAt: messagingConfigAudit.createdAt,
    })
    .from(messagingConfigAudit)
    .where(where)
    .orderBy(desc(messagingConfigAudit.createdAt), desc(messagingConfigAudit.id))
    .limit(limit);
}
