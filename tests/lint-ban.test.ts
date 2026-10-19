/**
 * ONB-05 control 2: proof that the raw-db-client import ban actually fires.
 *
 * A lint rule nobody has ever seen reject anything is a rule you hope is
 * configured, not one you know is. This suite runs the project's real
 * eslint.config.mjs over a violating snippet through the ESLint Node API and
 * asserts the error, then asserts the region-scoped allowance inside
 * src/db/repository.
 *
 * `lintText` with a virtual `filePath` keeps the violating code off disk, so
 * `eslint .` over the repository stays green — the fixture cannot become a
 * self-inflicted lint failure.
 */
import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const BAN_RULE = 'no-restricted-imports';

const VIOLATION = `import { getDb } from '@/db/repository/client';

export async function leakEverything() {
  return getDb();
}
`;

const RELATIVE_VIOLATION = `import { getDb } from '../db/repository/client';

export async function leakEverything() {
  return getDb();
}
`;

let eslint: ESLint;

/** Messages from a single-file lint run that came from the ban rule. */
async function banErrors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result.messages.filter((m) => m.ruleId === BAN_RULE);
}

beforeAll(() => {
  // Uses the repository's own eslint.config.mjs — no second, drifting config.
  eslint = new ESLint({ cwd: process.cwd() });
});

describe('raw database client import ban (ONB-05)', () => {
  it('errors when application code imports the raw client via the @/ alias', async () => {
    const errors = await banErrors(VIOLATION, 'src/core/quotes/leak-probe.ts');

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].severity).toBe(2);
    expect(errors[0].message).toMatch(/forTenant/);
  });

  it('errors on the relative form of the same import', async () => {
    const errors = await banErrors(RELATIVE_VIOLATION, 'src/core/quotes/leak-probe.ts');

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].severity).toBe(2);
  });

  it('errors inside the console (src/app) too — the highest-risk caller', async () => {
    const errors = await banErrors(VIOLATION, 'src/app/(console)/leak-probe.ts');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('stays silent inside src/db/repository — the region that owns the client', async () => {
    const errors = await banErrors(
      `import { getDb } from './client';\n\nexport const probe = getDb;\n`,
      'src/db/repository/probe.ts',
    );

    expect(errors).toEqual([]);
  });

  it('does not ban the sanctioned forTenant import', async () => {
    const errors = await banErrors(
      `import { forTenant } from '@/db/repository';\n\nexport const probe = forTenant;\n`,
      'src/core/quotes/probe.ts',
    );

    expect(errors).toEqual([]);
  });

  it('the repository barrel does not re-export the raw client', async () => {
    const barrel = await import('@/db/repository');

    // Exhaustive rather than a `not.toContain('getDb')`: re-exporting the raw
    // client under ANY name would let a caller reach an unscoped query surface
    // through the front door and quietly defeat the ESLint ban. Types erase, so
    // only runtime exports appear here.
    //
    // The `forAllTenants_*` entries are deliberately visible: they are the
    // audited cross-tenant reads, named so a reviewer can grep a single prefix
    // and find every crossing. Adding another one requires editing this line,
    // which is the point.
    //
    //   forAllTenants_syncTick    — which connections are due (02-02)
    //   forAllTenants_webhookHint — whose job is this uuid (02-03, SYNC-03)
    //   forAllTenants_cadenceTick — whose cadences might have work this minute
    //                               (03-01). Windowing inputs and the two pause
    //                               flags only; the tick returns through
    //                               forTenant(id) the moment it knows one.
    //   forAllTenants_pendingQuoteEvents — the outbox scan the quote-events
    //     header specifies (03-01). THE ONE ACCESSOR HERE THAT RETURNS TENANT
    //     DATA, and deliberately so: the cadence engine IS the single
    //     cross-tenant consumer that contract names, reading ONE ordered stream
    //     by `id`. Per-tenant cursors could not answer "have I processed
    //     everything up to id N". Everything the consumer then DOES with an
    //     event goes through forTenant(event.tenantId).
    //
    // All four answer a question that cannot be asked from inside a tenant
    // scope, and the first three return connection/window metadata only — never
    // quotes, contacts, cadences, touches or ledger rows across clients.
    //
    // The prospect accessors (02-06) are a SEPARATE family, not an escape from
    // tenant scoping. They read and write `prospects` / `prospect_quote_lines`,
    // which carry no `tenant_id` and are gated by `is_operator()` instead
    // (D-01/D-03). None of them accepts a `tenantId` and none of them touches a
    // tenant-scoped table — asserted directly in
    // tests/prospect-audit.test.ts, in both directions.
    //
    // They appear on this line for the same reason `forAllTenants_*` does:
    // adding another one requires editing it, which is the point.
    //
    //   createProspect / storeAuditResults — the audit write path (D-04:
    //     storeAuditResults is the ONLY prospect-line insert site, so
    //     `purge_after` cannot be forgotten)
    //   getProspect / listProspects / countProspectLines — reads
    //   getProspectStaging — the 02-07 CSV workspace read. A NARROW read by
    //     design: two columns, so `api_key_ciphertext` cannot reach the mapping
    //     page's props even by a forgotten destructure (threat T-2-02).
    //   convertProspectToTenant — the ONE sanctioned crossing between the two
    //     families (D-02), in its own file for exactly that reason. It links and
    //     clears the purge clock; it copies nothing and creates no cadence
    //     candidate. See src/db/repository/conversion.ts.
    //
    // The cursor accessors (03-02) are a THIRD family, and they are not an
    // escape from tenant scoping either: `event_consumer_cursors` carries no
    // `tenant_id` column at all and is gated by `is_operator()`, exactly like
    // the prospect tables. Neither accepts a tenantId and neither touches a
    // tenant-scoped table.
    //
    //   registerConsumerCursor — INSERT ... ON CONFLICT DO NOTHING at 0, the
    //     self-registration the outbox contract requires (no row is seeded)
    //   readConsumerCursor — reads without registering, so "has never run" stays
    //     distinguishable from "is at 0"
    //
    // The ADVANCE is deliberately absent from this list: it lives on
    // `forTenant(id).consumerCursor` because it must commit inside the same
    // transaction as the tenant-scoped actions it covers.
    //
    // The inbound accessors (04-01) are a FOURTH family, and — like the
    // prospect and cursor ones — not an escape from tenant scoping. They read
    // and write ONE table, `inbound_messages`, and join nothing: there is no
    // accessor in that file that can reach `cadences`, `quotes` or
    // `suppressed_contacts`, so nothing there can turn "an unattributed reply"
    // into a cross-tenant read of customer data. They live outside `forTenant()`
    // because an inbound message arrives BEFORE we know whose it is, and a reply
    // we cannot place is recorded with `tenant_id = NULL` rather than dropped —
    // a state a scoped insert would have to invent an owner for.
    //
    //   insertInboundMessage           — the ONLY insert path
    //   findInboundByProviderMessageId — the 04-04 reconciliation dedupe read.
    //     Returns an ARRAY: there is no unique index on a third party's id
    //     space, so the caller decides what more-than-one means.
    //   listInboundNeedingTriage       — the 04-06 console read
    //   markInboundTriaged             — the ONLY writer of `triaged_at`
    //   TRIAGE_ATTRIBUTIONS / TRIAGE_PAGE_SIZE — the predicate's vocabulary and
    //     its cap, exported because the console renders badges for the same set
    //     and two spellings is how a later attribution becomes visible on one
    //     surface and invisible on the other.
    //
    // The 04-06 pair does NOT widen what this family promises, and the
    // temptation it resisted is worth naming: the triage screen shows CLIENT
    // NAMES for `candidate_tenant_ids`, and the obvious way to get them is a
    // join to `tenants` right here. That join is exactly the thing this family
    // is allowed to exist in exchange for not doing — it would turn "an
    // unattributed reply" into a cross-tenant read of the client list, through
    // a service-role accessor, for a label. The names are resolved on the page
    // instead, through the operator's OWN JWT under RLS, which can only ever
    // name clients that operator may already see.
    //
    // `forAllTenants_cadencesByContactMobile` (04-01) joins the CROSS-TENANT
    // list rather than the inbound family, because it genuinely is one: "whose
    // live cadence has this mobile?" is what an inbound reply asks, it returns
    // tenant data, and it cannot be asked from inside a tenant scope — the same
    // shape as forAllTenants_webhookHint, one channel over. It is on this line
    // for the reason every crossing is: adding one requires editing it.
    //
    // `forAllTenants_ids` (04-02) is the sixth crossing and the narrowest —
    // every tenant id and NOTHING else. D-03 requires that a STOP matching no
    // live cadence still suppresses the bare mobile, and `suppressed_contacts`
    // is tenant-scoped, so that write has no single row to be: it is performed
    // for every client. The question "who are all the clients" has no tenant to
    // scope to by definition. What keeps it audited is that its result is a
    // column of primary keys — there is nothing in it to render or leak, and
    // `tests/sync-upsert.test.ts` pins its select list so it cannot quietly
    // grow a name.
    //
    // The messaging-config accessors (04-03) are a FIFTH family, and the one
    // that most looks like an escape without being one. `getChannelConfig`
    // TAKES a tenant id — but not as a scope: it asks for the tenant's override
    // row OR the global default (`tenant_id IS NULL`) in ONE statement, and a
    // closure over a single scope cannot pose a question with two in it. The
    // global row is the point of the table: v1 sends every client's SMS from one
    // dedicated AU number (an alpha tag cannot receive replies, and replies drive
    // the product), so there is exactly one sms identity and it belongs to
    // nobody.
    //
    // What keeps it audited is the same thing that keeps the other four
    // audited — one table, no joins. Nothing in that file can reach `cadences`,
    // `quotes`, `tenants` or `send_ledger`. And `listChannelConfig`, the one
    // accessor that returns other tenants' rows, is bounded by what the table
    // holds: a from-address, a reply-to, a business name and a flag — the
    // sending identity that appears in the message a customer receives anyway.
    // NO CREDENTIALS LIVE IN THIS TABLE (they stay in env.ts, T-4-10), so there
    // is nothing in a row of it that a leak would make worse.
    //
    //   getChannelConfig    — override-then-default read, one query
    //   listChannelConfig   — the console/activation read
    //   upsertChannelConfig — the ONLY write path, and the write that turns real
    //     sending on. It is here rather than on `forTenant()` because the row it
    //     most often writes has no tenant.
    //
    // `updateDeliveryWhereMatch` (04-04) is a SIXTH family and the narrowest one
    // in this barrel. A delivery receipt arrives before we know whose it is —
    // ClickSend's callback carries a message id and the ledger id we generated,
    // and no tenant — so there is nothing to build a scope from, exactly like
    // `insertInboundMessage` above it.
    //
    // What keeps it audited is that it CANNOT READ. It is a single UPDATE whose
    // predicate is an exact match on a key the caller already holds; there is no
    // select, no list and no enumeration anywhere in that file, and `outcome` is
    // not in its SET list. The whole reachable surface of a forged delivery
    // receipt is four delivery columns on one row whose key the forger knew
    // before they started (T-4-15).
    //
    // `forAllTenants_ledgerOwners` (04-04) is the SEVENTH crossing and the
    // first one to read `send_ledger` across tenants — a table
    // `for-all-tenants.ts`'s own header listed as having no such reader. That
    // paragraph has been corrected there rather than worked around, because the
    // question it answers is the one this file exists for: the reconciliation
    // sweep polls ClickSend's history, a history row echoes back the
    // `custom_string` we generated (a `send_ledger.id`) and carries NO TENANT,
    // and turning "the provider refused this because the recipient opted out"
    // into Spam Act suppression evidence means asking whose send it was. Same
    // unaskable-from-inside-a-scope shape as `forAllTenants_webhookHint` with a
    // job uuid.
    //
    // What bounds it is that it is KEYED, not filtered: no date range, no
    // tenant list, no "recent sends" arm, and an empty id list returns nothing
    // rather than everything — so it cannot enumerate the ledger even by
    // accident. Its select list is four columns of ownership and one enum, with
    // `to_address` (a customer's mobile) and every delivery column deliberately
    // absent, and it is pinned below.
    //
    // `anyChannelEnabled` (04-08, CR-01) is the narrowest addition this pin has
    // taken: it selects ONE column of ONE row of `messaging_config` with
    // `LIMIT 1` and returns a BOOLEAN, so nothing it can answer is customer
    // data. It exists because `buildRoutingSender` must decide "is this channel
    // armed anywhere" before any tenant is in hand, and asking
    // `getChannelConfig(channel)` instead read the GLOBAL row alone — which made
    // one client's enabled override row invisible to the gate.
    //
    // ── THE THREE 05-06 ADDITIONS (D-13, AI-03) ─────────────────────────────
    //
    // `listUnclassified`, `writeClassification` and `bumpClassifyAttempts` are
    // NOT a new crossing: they read and write the same single `inbound_messages`
    // table the four existing inbound accessors do, join nothing, and take no
    // tenant scope for the reason that family exists at all — a reply arrives
    // before we know whose it is.
    //
    // They are worth naming here for a different reason than the others. These
    // three are THE ENTIRE WRITE SURFACE REACHABLE FROM MODEL OUTPUT. The
    // classification pass hands an attacker-controlled SMS body to Claude and
    // writes back what it returns, and the whole argument for doing that is that
    // the worst case is one mislabelled row a human still reads. A fourth
    // function appearing beside them — anything touching `suppressed_contacts`,
    // `cadences`, or the webhook's own `attribution`/`is_stop` findings — would
    // be a capability granted to a stranger's text, and it must fail here first.
    // `tests/classification-privilege.test.ts` asserts the other half: that
    // `src/core/classification/*` imports only these three.
    //
    // ── THE 06-01 ADDITION (CON-01), AND WHY IT IS THE BIGGEST ONE HERE ─────
    //
    // `forAllTenants_approvalQueue` is the EIGHTH crossing and the widest: it
    // returns customer-visible content across tenants — a frozen `final_body`, a
    // contact's first name, a job description — where every accessor above it
    // returns metadata, ids, or one ordered outbox stream.
    //
    // The justification is the operator's actual question: "what must I approve
    // next, ACROSS EVERYONE" (D-01). That is an ORDERING over every client's due
    // touches, and an ordering cannot be assembled from N scoped reads without
    // either fetching everything anyway or capping per tenant — which would push
    // a client with fifteen due drafts behind a client with one. The operator IS
    // the cross-tenant human, the same finding T-4-25/D-03 made about the inbox.
    //
    // What bounds it: a PINNED select list with NO address column of any kind,
    // NO join to `tenants` (the page resolves names through the operator's own
    // JWT under RLS, so it can never name a client they may not already see), a
    // closed two-status predicate exported as `APPROVAL_QUEUE_STATUSES`, and a
    // cap exported as `APPROVAL_QUEUE_CAP` with the sort applied in SQL before
    // it. Both constants are on this line rather than inlined precisely so the
    // predicate cannot be widened quietly — the queue, the 06-02 nav badge and
    // the CON-04 stall predicate must mean the same thing by "waiting on the
    // operator", and three spellings is how a badge reads 4 beside a list of 3.
    //
    // ── THE 06-02 PAIR (CON-04), AND WHY THEY ARE NARROWER THAN THEY LOOK ───
    //
    // `forAllTenants_claimNewlyStalled` is the NINTH crossing and the only one
    // in this file that WRITES across tenants. What makes that acceptable is
    // that it writes exactly one column — `stall_alerted_at` — and that its
    // WHERE clause (`... AND stall_alerted_at IS NULL`) with RETURNING IS the
    // once-only alert guarantee, rather than a filter a caller could forget.
    // It cannot move a touch, retire one, or change a status: aging observes,
    // and the re-window pass remains the only schedule authority.
    //
    // `forAllTenants_stalledTally` is its read-only sibling for the nightly
    // digest, grouped in SQL and bounded by the number of TENANTS.
    //
    // Both DO join `tenants`, which the queue accessor above refuses to do —
    // and the difference is the consumer, not the convenience. The queue feeds
    // a PAGE, which must learn client names only from the operator's own JWT.
    // These feed the tick and a cron route: service-role by construction,
    // rendering nothing, and the name they read goes into an email addressed to
    // the operator alone. Their whole return surface is ids, client names and
    // integers, which is what makes the alert vocabulary closable at all.
    //
    // ── THE 06-05 ADDITIONS (CON-03): ONE CROSSING AND ONE EVIDENCE FAMILY ──
    //
    // `forAllTenants_hotUnescalated` is the ELEVENTH crossing and, after the
    // approval queue, the widest: it returns a customer's WORDS and a
    // customer's MOBILE, across tenants. The question — "who just said yes, and
    // has their tradie been told" — cannot be asked from inside a scope for the
    // reason the whole inbound family lives outside one: a reply arrives
    // carrying a phone number and no client.
    //
    // The address is here for a reason no other accessor can claim: D-07's
    // message ENDS with `Call them: {mobile}`, and the tradie tapping that
    // number is the entire product moment. Withholding it would only mean the
    // pass fetched it a line later from somewhere else. What bounds it instead
    // is a closed predicate (`is_hot` AND `attribution = 'threaded'` AND no
    // escalation row — not a date range, not "recent replies"), a pinned select
    // list with no `raw_payload` and no `from_address`, NO join to `tenants`
    // (the escalation number is read through `forTenant(row.tenantId)`), and a
    // cap exported as `HOT_ESCALATION_CAP` because every row it returns costs a
    // real, charged SMS to a real handset.
    //
    // `claimEscalation`, `recentEscalationForCadence` and
    // `recordEscalationOutcome` are NOT a new crossing: one table, no joins, no
    // tenant scope — the same shape as the inbound and delivery-receipt
    // families, and outside `forTenant()` for the same reason those are
    // (`escalations` carries `tenant_id` as a column with no foreign key, so a
    // client who disconnects cannot take the record of what we did on their
    // behalf with them).
    //
    // They are named here for the reason the classification trio is: this is
    // the ENTIRE surface through which a tradie's phone can be made to ring.
    // `claimEscalation`'s `ON CONFLICT DO NOTHING RETURNING` IS the D-08
    // never-twice guarantee, and a fourth function appearing beside them —
    // anything that lists, deletes, or re-opens a claimed row — would be a path
    // to texting somebody twice about one reply, and it must fail here first.
    expect(Object.keys(barrel).sort()).toEqual([
      'APPROVAL_QUEUE_CAP',
      'APPROVAL_QUEUE_STATUSES',
      'CLASSIFY_BATCH_SIZE',
      'HOT_ESCALATION_CAP',
      // 2026-10 (15-03, D-01). The `/leads` queue's cap — a number, for the
      // APPROVAL_QUEUE_CAP reason: the page that renders a capped list has to
      // be able to SAY it is capped. The sort happens in SQL before it.
      'LEAD_QUEUE_CAP',
      'MAX_CLASSIFY_ATTEMPTS',
      // 06-03. The drafting ceiling, exported so the queue's no-draft-yet card
      // can tell "still trying" apart from "given up" — the difference between
      // a touch that will resolve itself and one that needs a human.
      'MAX_DRAFT_FAILURES',
      // 07-01. The report list's cap, exported for the MAX_DRAFT_FAILURES
      // reason: a page that renders a capped list has to be able to SAY it is
      // capped rather than silently drawing a truncated billing history. Not a
      // new crossing and not a new function — `monthly_reports` is reached only
      // through `forTenant()`, and this is an integer.
      'REPORT_LIST_LIMIT',
      'TRIAGE_ATTRIBUTIONS',
      'TRIAGE_PAGE_SIZE',
      'anyChannelEnabled',
      // ── THE PHASE 10 ARMING TRIO (10-01) ────────────────────────────────
      //
      // `armChannel` is the single most consequential function on this surface:
      // it is the write that starts real SMS and email to real customers, with
      // no deploy, effective on the next tick. It is named here — beside
      // `disarmChannel` and `listChannelAudit` below — for the reason the
      // escalation trio is: this is the ENTIRE surface through which sending
      // can be switched on, and a fourth function appearing beside them (one
      // that arms without an audit row, or that arms from a caller holding no
      // operator id) must fail here first.
      //
      // The audit row is not a separate export and must never become one:
      // `appendAudit` is private and callable only from inside these two
      // writers' transactions, so nothing can record a flip that did not happen
      // and nothing can flip without recording it.
      'armChannel',
      // Phase 9 (09-01). The public intake's tenant-less family — see the
      // barrel's own comment for why it is exported on its own line.
      'attachAuditRequestCsv',
      'bumpAuditRequestThrottle',
      'bumpClassifyAttempts',
      'claimEscalation',
      // 2026-10 (12-02, D-16). The never-twice claim's SECOND TRIGGER: an
      // open-quote customer rang and was missed. `claimEscalation`'s exact
      // shape keyed on `missed_call_id` — it can make a tradie's phone ring
      // once per missed call and never twice. Named beside its sibling for the
      // escalation trio's reason.
      'claimEscalationForMissedCall',
      // 2026-10 (13-03, D-09). The HELD escalation's release, and the release
      // IS the claim: one guarded UPDATE on `released_at IS NULL AND outcome
      // IS NULL`. A throw after it leaves the row released with no outcome and
      // it is never resent — the escalation trio's never-twice rule, held.
      'claimHeldEscalationRelease',
      // 2026-10 (12-02, D-10). The 'one operator alert per kind per Perth day'
      // latch. A claim, not a read; nothing un-claims, so nothing re-sends.
      'claimOperatorAlert',
      // 2026-10 (12-02, D-10). The failed / stuck text-back alert claim — a
      // guarded UPDATE whose stamp IS the decision to alert. Tenant, status
      // and code per row; no number.
      'claimTextBackAlerts',
      'clearAuditRequestCsv',
      'closeDb',
      // 11-01, CAP-03. The status callback's write: an UPDATE by exact CallSid
      // match and NEVER an insert — a callback is a hint, and the call-log
      // reconcile is the guarantee behind it (the delivery-receipt rule). Not a
      // crossing: one table, no joins, no tenant scope, the inbound-messages
      // shape of exception.
      'completeMissedCall',
      'convertProspectToTenant',
      // 2026-10 (13-03, D-08). The digest's cold-lead-replies line: counts per
      // tenant, one table, no join. In the inbound family on purpose, so the
      // sixteen cross-tenant exports stand.
      'countColdLeadRepliesSince',
      // 2026-10 (14-04, D-09). The digest's "jobs created from leads" and
      // "booked by the tradie" lines: two counts per tenant from one statement
      // over `leads`, no join, no id. In the lead family's own file, so the
      // sixteen cross-tenant exports stand.
      'countLeadResolutionsSince',
      // 2026-10 (15-03, D-09). The digest's overdue line: per tenant, how many
      // OPEN leads hold a waiting touch past its slot. Counts only, no id, no
      // number. In the lead family's own file, so the sixteen cross-tenant
      // exports stand.
      'countOverdueOpenLeads',
      'countProspectLines',
      'createAuditRequest',
      'createProspect',
      // The private audit-uploads bucket (09-03): the only service-role
      // supabase-js client in the application, and these four names are the
      // whole of its reach.
      'deleteAuditUpload',
      // 10-01. The other half of the arming trio, and the one that is NEVER
      // gated: every refusal `armChannel` carries exists to stop sending
      // starting, and none of them may stand between an operator and stopping
      // it. Its reason is REQUIRED, at the database.
      'disarmChannel',
      // 2026-10 (12-02, D-21). THE ONLY WRITE WITH NO HAND ON IT: the
      // low-balance auto-disarm. Its input type admits `text_back`, one tenant
      // and OFF only; the audit row it writes says `actor = 'system'`, and the
      // database refuses a system ARM. A system writer that could arm, or
      // reach the shared row, must fail here first.
      'disarmChannelBySystem',
      'findInboundByProviderMessageId',
      // 11-01, CAP-03. THE SIXTEENTH CROSSING: every ACTIVE divert number and
      // its owner — the nightly call-log reconcile's owner map. Bounded by the
      // number of tenants (one number each, UNIQUE), no caller data, no quote,
      // no cadence, and no write. An EMPTY answer is the reconcile's total
      // guard: no active number means no Twilio call at all.
      'forAllTenants_activeDivertNumbers',
      'forAllTenants_approvalQueue',
      // 10-03. THE FOURTEENTH CROSSING, and the tamest since
      // `forAllTenants_latestAttestations`: ids and client names only, no
      // address, no quote, no cadence column, and no write. It answers the one
      // question the two-tap arm confirm has to answer out loud — "which
      // clients does this shared-row tap start messaging for" — which cannot be
      // asked from inside a tenant scope, because the whole subject is the set
      // of OTHER tenants a row belonging to nobody governs.
      'forAllTenants_armedBySmsGlobal',
      'forAllTenants_cadenceTick',
      'forAllTenants_cadencesByContactMobile',
      'forAllTenants_claimNewlyStalled',
      // 11-01, CAP-03/D-02. THE FIFTEENTH CROSSING, and the webhookHint question
      // one provider over: "whose Backdesk number is this `To`?" cannot be
      // asked from inside a tenant scope because the tenant IS the answer.
      // Keyed on the CALLED number only — never ForwardedFrom — and it joins
      // `tenants` for the contact window on the 06-02 split (a service-role
      // webhook that renders nothing). The day it grows a ForwardedFrom
      // fallback is the day one client's caller is attributed to another.
      'forAllTenants_divertNumberByE164',
      'forAllTenants_hotUnescalated',
      'forAllTenants_ids',
      // 06-04. The TWELFTH crossing, and the tamest one in the file: a SELECT
      // returning an id, a client name and an instant, feeding a nightly email
      // addressed to the operator alone. It is named here because of what it
      // must NOT grow into — its aging sibling two lines up is a guarded UPDATE
      // that CLAIMS, and the day this one acquires an `alerted_at` to claim (or
      // any write at all) is the day the D-15 nag has started down the road to
      // a pause nobody decided to build.
      'forAllTenants_latestAttestations',
      'forAllTenants_ledgerOwners',
      'forAllTenants_pendingQuoteEvents',
      // 07-05, RPT-03. The THIRTEENTH crossing. Counts, sums and fee rows per
      // client for the `/reports` overview and the 06:30 opt-out line — no
      // address in any select list (they are compared inside the statements),
      // no quote or cadence column, and no write anywhere on the path: a metric
      // NAGS, it never pauses a cadence. Its own containment argument is
      // recorded in `tests/sync-upsert.test.ts` beside the export tripwire.
      'forAllTenants_reportMetrics',
      'forAllTenants_stalledTally',
      'forAllTenants_syncTick',
      'forAllTenants_webhookHint',
      'forTenant',
      'getAuditRequest',
      'getAuditUpload',
      'getChannelConfig',
      // 10-05. ONE escalation by id with the tenant in the predicate — the read
      // `recordProofAction` verifies an operator's pasted artefact id against
      // before it records a proof. Not a list accessor: there is no argument you
      // can pass it that enumerates anything.
      'getEscalationForTenant',
      // 11-01, CAP-05. ONE missed call by id with the tenant in the predicate —
      // the read the verification-call proof checks an operator's pasted
      // artefact against (11-05), the getEscalationForTenant shape. Its select
      // list carries no caller number of any kind.
      'getMissedCallForTenant',
      // 2026-10 (Phase 12, TXT-03). The ONE read that selects a caller's number
      // for SENDING, by the row id the completion UPDATE returned — imported by
      // `src/core/leads/text-back.ts` alone, never by a console surface.
      'getMissedCallForTextBack',
      'getProspect',
      'getProspectStaging',
      // 2026-10 (12-02, 12-08). ONE text-back by missed-call id with the tenant
      // in the predicate, joined to its own ledger row — the text_back_proof
      // artefact check. Ids, statuses and timestamps; no number.
      'getTextBackEvidenceForTenant',
      'insertInboundMessage',
      // 11-01, CAP-03/D-06. The arrival webhook's ONLY write: ON CONFLICT DO
      // NOTHING on `(provider, provider_call_id)`, so a redelivered CallSid
      // writes nothing. Named here beside its two siblings because together
      // they are the ENTIRE write surface a diverted call can reach — and in
      // Phase 12 a `missed_calls` row is what texts a caller.
      'insertMissedCallArrival',
      // 2026-10 (Phase 12, D-09). This client's own `text_back` switch, the
      // exact-target read — never the global-fallback `getChannelConfig`.
      'isTextBackArmed',
      // 2026-10 (14-04, D-08). The lead a tradie's DONE answers: the lead
      // escalation most recently SENT to that number inside the lookback, at
      // the clients that own it. A tenant id and a lead id; the address is
      // compared, never selected. Outside `forTenant()` for the escalation
      // family's reason — and it cannot list, claim or make a phone ring.
      'latestSentLeadEscalationTo',
      // 2026-10 (12-02, D-21). Tenant ids whose own text_back row is enabled —
      // the balance probe's reach. Ids only.
      'listArmedTextBackTenantIds',
      'listAuditRequests',
      // 10-01. A READ, and the reason the two writers above are safe to hand to
      // a console: the last N flips of one channel's switch, newest first, so
      // the page that offers the tap also shows who took it last. It cannot
      // arm, cannot edit and cannot delete — and `messaging_config_audit` has
      // no write grant for the console role at all (rls-coverage), so this is
      // the whole of anybody's reach into that history.
      'listChannelAudit',
      'listChannelConfig',
      // 07-03. THE READ THE 06-05 COMMENT PROMISED, and the reason it does not
      // reopen the surface the paragraph above is guarding: it is keyed on ONE
      // quote id the caller already holds, scoped by tenant in the same
      // predicate, and its select list carries no `to_address`. It cannot list,
      // cannot enumerate and cannot make a phone ring. A fifth escalation
      // function that CAN do any of those must fail here first.
      'listEscalationsForQuote',
      'listExpiredAuditUploads',
      // 2026-10 (13-03, D-08/D-09). The digest's "held overnight" line: a
      // tenant id and a hold time per row. No address, no trigger id.
      'listHeldEscalationsSince',
      'listInboundNeedingTriage',
      // 2026-10 (15-03, D-04). The design-partner CSV's read: the newest
      // frozen `figures` per client-month, with the tenant id, the period, the
      // zone and the version — no line, no customer name, no number, no client
      // name (the action resolves names through the operator's JWT). One
      // table, no join. The reports family's first file, so the sixteen
      // cross-tenant exports stand.
      'listLatestReportFiguresForExport',
      // 2026-10 (15-03, D-06). The privacy pass's lead due-read: closed or
      // expired leads, and converted leads whose job is finished, past
      // PSEUDONYMISE_AFTER_DAYS and unstamped, LIMIT-bounded. With its sibling
      // below, the ONLY family reads that return a raw caller number — their
      // ONE caller is the pass (15-07), which hashes in memory and writes
      // through `forTenant()`; never a log, never a page. The lead family, so
      // the sixteen cross-tenant exports stand.
      'listLeadsDueForPseudonymisation',
      // 2026-10 (15-03, D-06). The privacy pass's lead-less missed-call
      // due-read: a tenant's calls with no lead, past the boundary, unstamped,
      // LIMIT-bounded — withheld rows included so the predicate converges. The
      // raw caller strings go to the pass alone (15-07). The lead family.
      'listMissedCallsDueForPseudonymisation',
      // 2026-10 (15-03, D-01). The `/leads` queue's cross-client read: every
      // OPEN lead, soonest next deadline first, sorted in SQL before the cap
      // with the true total. Ids, instants, a touch status word and booleans
      // ONLY — no mobile, no body, no join into `inbound_messages`; the card's
      // personal facts come per tenant through `forTenant().leads.queueCards`
      // (the inbox's split). In the lead family's own file — where cross-tenant
      // lead reads live — so the sixteen cross-tenant exports stand.
      'listOpenLeadsForQueue',
      // 2026-10 (12-02, D-20). The tick sweep's read: ids of undecided calls
      // of a real tenant inside the age window. Ids only — the number is read
      // by the send path alone.
      'listPendingTextBacks',
      'listProspects',
      'listUnclassified',
      // 2026-10 (12-02, D-16). Route-quote missed calls with no escalation row
      // yet: three ids per row. In the escalation family because it reads the
      // never-twice key; not a crossing of customer data.
      'listUnescalatedQuoteCalls',
      // 2026-10 (13-03, D-07). Ring-twice: second calls inside the window from
      // a number with an open lead, no escalation yet. Four ids per row; the
      // caller's number is compared in the database and never selected.
      'listUnescalatedRingTwiceCalls',
      'markAuditRequestConverted',
      'markInboundTriaged',
      // 2026-10 (12-02, D-20). Undecided calls past the ceiling become
      // skipped / stale — never texted hours late (T-12-20).
      'markStaleTextBacks',
      // 07 CR-03. A READ, and one that returns a count and a timestamp with no
      // tenant in it: how far past the attribution consumer's position the
      // outbox has run. It is on this surface because a wedged consumer is
      // otherwise indistinguishable from a quiet month, and the 06:30 digest is
      // where the operator finds out. It cannot write and it cannot register —
      // a diagnostic that created the row whose absence is the answer would
      // report every developer machine as healthy.
      'purgeExpiredAuditUploads',
      'putAuditUpload',
      'readConsumerBacklog',
      'readConsumerCursor',
      'recentEscalationForCadence',
      'recordAuditRequestNotify',
      'recordEscalationOutcome',
      'registerConsumerCursor',
      'storeAuditResults',
      'sweepAuditRequestThrottle',
      // 2026-10 (14-04, D-08). "Which clients own this number?" — the DONE
      // door's first read, unaskable from inside a scope because the tenant IS
      // the answer. Never-text list ∪ normalised escalation phone; tenant ids
      // only, no number selected. In the lead family's own file, not a
      // seventeenth `forAllTenants_*` crossing: it reaches no customer data.
      'tenantsOwningNumber',
      'updateAuditRequestStatus',
      'updateDeliveryWhereMatch',
      'upsertChannelConfig',
      // 11-01, CAP-03/D-06. The call-log reconcile's convergent write: inserts a
      // call the webhook never saw, or fills only what a dropped callback left
      // NULL — never `started_at`, `after_hours` or a caller column, which are
      // facts computed at arrival.
      'upsertMissedCallFromLog',
      'writeClassification',
    ]);
  });
});

/**
 * The barrel is the ONLY door — control 2 of 3, one level out from the raw
 * client.
 *
 * `index.ts` exists so a reviewer can read one file and see the whole sanctioned
 * data surface, cross-tenant exceptions on their own lines. That property is
 * only true if application code cannot reach past it, and for three plans
 * `controls.ts` did exactly that (`@/db/repository/for-tenant`) while every
 * other consumer went through the barrel — two answers to one question, and the
 * kind of drift that is invisible until somebody deep-imports something the
 * barrel deliberately does not export.
 */
describe('deep repository import ban', () => {
  const DEEP_ALIAS = `import { forTenant } from '@/db/repository/for-tenant';

export const probe = forTenant;
`;
  const DEEP_RELATIVE = `import { forAllTenants_cadenceTick } from '../db/repository/for-all-tenants';

export const probe = forAllTenants_cadenceTick;
`;

  it('errors on the aliased deep import of for-tenant', async () => {
    const errors = await banErrors(DEEP_ALIAS, 'src/core/cadence/probe.ts');

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].severity).toBe(2);
    expect(errors[0].message).toMatch(/barrel/);
  });

  it('errors on the relative deep import of a cross-tenant accessor', async () => {
    const errors = await banErrors(DEEP_RELATIVE, 'src/core/cadence/probe.ts');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('errors in a test file too — the barrel is not a production-only rule', async () => {
    const errors = await banErrors(DEEP_ALIAS, 'tests/probe.test.ts');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('stays silent inside src/db/repository — the region that owns the modules', async () => {
    const errors = await banErrors(
      `import { forTenant } from './for-tenant';\n\nexport const probe = forTenant;\n`,
      'src/db/repository/probe.ts',
    );

    expect(errors).toEqual([]);
  });

  it('does not ban the barrel itself', async () => {
    const errors = await banErrors(
      `import { forTenant } from '@/db/repository';\n\nexport const probe = forTenant;\n`,
      'src/core/cadence/probe.ts',
    );

    expect(errors).toEqual([]);
  });
});

/**
 * THE CLIENT BOUNDARY, caught at test time instead of at `next build` time.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `import type` is ERASED at build time. A value import is a real edge in   │
 * │ the module graph. That asymmetry is invisible in the source, invisible to │
 * │ `tsc`, invisible to `npm test` — and it is the whole difference between a │
 * │ shared constant and the `postgres` driver in the browser bundle.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 06-01 extracted `components/action-state.ts` as the ONE home for the approval
 * copy, and it imported `EDITED_BODY_MAX` — a value — from
 * `@/core/approval/approve-draft`, which imports `@/db/repository`. Since
 * `draft-card.tsx` is a `'use client'` component that imports this module,
 * `next build` failed outright with four `Module not found` errors naming `fs`,
 * `net`, `tls` and `perf_hooks`: nothing in that message points at an edit
 * form's character cap, and nothing in the plan's verification (`npm test`,
 * `tsc`, `lint`) runs a build. Fixed in 06-02 by moving the number to a leaf
 * module; this is the guard that stops it coming back the next time somebody
 * needs one constant from a module that talks to Postgres.
 */
describe('client-reachable console modules import no server-only value', () => {
  const CLIENT_REACHABLE = [
    'src/app/(console)/components/action-state.ts',
    'src/app/(console)/components/draft-card.tsx',
    // 06-03. `queue-card.tsx` is `'use client'` and imports its sibling
    // `action-state.ts` for the skip copy — the same two-module shape that broke
    // the build from `components/`, one directory over. The skip's outcome
    // vocabulary is one `import` away from the repository barrel, and the
    // temptation to reach for `TouchSkipReason` there is exactly the value/type
    // asymmetry this guard exists for.
    'src/app/(console)/queue/action-state.ts',
    'src/app/(console)/queue/queue-card.tsx',
    // 06-04. `checklist-card.tsx` is `'use client'` and renders answers derived
    // by `@/core/onboarding/checklist`, which imports the repository barrel.
    // Importing its `ChecklistItem` TYPE is free; importing
    // `ATTESTATION_STALE_DAYS` — a VALUE from the same module — would drag
    // Postgres into the browser bundle. The card therefore takes plain props
    // and defines its own labels; this is the guard that keeps it that way.
    'src/app/(console)/clients/[id]/checklist-card.tsx',
    'src/app/(console)/clients/[id]/action-state.ts',
    // 06-06. `escalation-phone-form.tsx` is `'use client'` and validates through
    // a schema that lives in `@/core/shared/tenant` — a module the SERVER side
    // of the same feature imports. Reaching for `escalationPhoneSchema` (a
    // VALUE) from the form would be the same asymmetry one field over; the form
    // takes plain props and lets the action own the validation.
    'src/app/(console)/clients/[id]/escalation-phone-form.tsx',
    // 11-05. `divert-number-form.tsx` is `'use client'` and sits one import away
    // from `@/core/telephony/provision`, which reaches the repository barrel
    // AND the Twilio REST client. The form takes plain props and posts to the
    // actions; the spoken-name bounds it shows come from its sibling leaf.
    'src/app/(console)/clients/[id]/divert-number-form.tsx',
    // 13-05. The after-hours escalation switch, `'use client'`, beside the
    // escalation-number form and in its mould: React, the action and the
    // sibling leaf — never `@/db/schema` for the column name.
    'src/app/(console)/clients/[id]/after-hours-escalation-form.tsx',
    // The label-guess map is imported by two server pages today and is one
    // `'use client'` away from a third. It imports nothing, and this is the
    // guard that keeps it a leaf.
    'src/app/(console)/components/label-guess.ts',
    // 07-04. The Generate form's state module. It imports NOTHING today, and
    // the pull is obvious: `GENERATE_FAILED_MESSAGE` and the refusal sentences
    // live in `@/core/reporting/copy`, whose sibling `generate.ts` imports the
    // repository barrel. One convenient re-export from there and the browser
    // bundle acquires `postgres`.
    'src/app/(console)/reports/[client]/action-state.ts',
    // 07-04. `generate-form.tsx` is `'use client'` and spells its own month
    // names rather than importing a vocabulary from the reporting core — the
    // same value/type asymmetry, on a module one hop from `forTenant()`.
    'src/app/(console)/reports/[client]/generate-form.tsx',
    // 07-04, rewritten 07-07. The print control is `'use client'` and imports
    // `react` and its sibling leaf `print-feedback.ts` — nothing else. Pinned
    // because it sits in a directory whose OTHER file reads the database, and a
    // small component is exactly where a stray import gets added without
    // thought.
    'src/app/(console)/reports/[client]/[reportId]/print-button.tsx',
    // 07-07. The sibling leaf: the print button's transition table. It is the
    // reducer, and it must stay import-free precisely because it is one
    // directory from a file that reads the database — the shortest path from
    // `postgres` into the browser bundle here is somebody reaching into
    // `page.tsx`'s import set for a label.
    'src/app/(console)/reports/[client]/[reportId]/print-feedback.ts',
    // 07-04. The Add-a-fee form is `'use client'` and spells its own kind
    // vocabulary rather than importing `TENANT_FEE_KINDS` from the schema
    // module — a VALUE from a module that reaches Postgres. The action owns the
    // validation; the form owns two option labels.
    'src/app/(console)/reports/[client]/fee-schedule-form.tsx',
    // 12-06. `text-back/forms.tsx` is `'use client'` and sits one import away
    // from `@/core/leads/template-admin` and `never-text`, both of which reach
    // the repository barrel, and from `@/db/schema`, which owns the variant and
    // kind vocabularies. The form takes plain props and spells its labels from
    // the sibling leaf; the actions own the validation against the real
    // vocabularies. `import type` from either is free; a value is not.
    'src/app/(console)/clients/[id]/text-back/forms.tsx',
    'src/app/(console)/clients/[id]/text-back/action-state.ts',
    // 2026-10-10 (14-02). The create-ServiceM8-job sheet is `'use client'` and
    // composes its preview through `@/core/leads/job-description` — a module
    // that imports nothing from the repository, the one value import from core
    // this form is allowed, and the reason the builder lives in its own file
    // (the SHA-256 adopt key lives in job-provision.ts, server-side). Its
    // sibling leaf spells the result sentences as string-literal keys rather
    // than importing LEAD_JOB_ERROR_KINDS — a VALUE from `@/db/schema`.
    'src/app/(console)/inbox/create-job-form.tsx',
    'src/app/(console)/inbox/action-state.ts',
    // 2026-10-13 (Phase 15, 15-02). The three leaves the /leads card, the
    // missed-call log's rows and the design-partner export island read their
    // fixed sentences and label maps from. Their vocabularies (touch statuses,
    // text-back statuses, skip reasons, caller kinds) live in `@/db/schema`, so
    // the maps use string-literal keys and the TEST pins them. The two islands
    // that will read them, `lead-card.tsx` (15-04) and `export-csv-form.tsx`
    // (15-06), join this list when those plans create them.
    'src/app/(console)/leads/action-state.ts',
    'src/app/(console)/components/text-back-outcome.ts',
    'src/app/(console)/reports/export-state.ts',
    // 2026-10-13 (Phase 15, 15-04). The lead card is `'use client'` and reads
    // its sentences from the 15-02 leaf above; the deadline tier, the caller's
    // spaced mobile and every time arrive as plain props built on the server.
    // A value import of `TOUCH_STATUSES` or a repository type's module would
    // put `postgres` in the browser bundle.
    'src/app/(console)/leads/lead-card.tsx',
    // 2026-10-13 (Phase 15, 15-06). The design-partner export island is
    // `'use client'` and value-imports only `react`, its server action and the
    // import-free `export-state.ts` leaf above. The action reaches the
    // repository barrel on the server; the island receives a string.
    'src/app/(console)/reports/export-csv-form.tsx',
  ];

  /**
   * Every module this SOURCE pulls in as a VALUE — `import type` and
   * `export type` are erased at build time and are fine.
   *
   * EVERY IMPORT SHAPE, not just the single-quoted ones with a `from` clause
   * (07-07 review, WR-04). The previous regex was
   * `/^import\s+([\s\S]*?)from\s+'([^']+)';$/gm`, and two shapes walked
   * straight past it:
   *
   *   - `import '@/db/repository';` — a SIDE-EFFECT import. No `from`, so it
   *     never matched, the allowlist loop had nothing to reject, and the guard
   *     passed. That is precisely the edge that puts `postgres` in the browser
   *     bundle, and precisely the shape this describe block's header says broke
   *     `next build` with four `Module not found` errors.
   *   - `import x from "@/db/repository";` — double quotes. Zero matches.
   *
   * Also caught now: `export … from`, and `await import('…')`, which is a real
   * edge in the module graph even though it is lazy.
   *
   * A quoted string alone is not enough to be an import — `export const X =
   * 'hi';` starts with `export` and ends `'hi';` — so a statement counts only
   * if its clause ends in `from`, or is empty (the side-effect form).
   */
  function valueImportSpecifiers(source: string): string[] {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specifiers: string[] = [];

    for (const [, keyword, clause, , specifier] of stripped.matchAll(
      /^(import|export)\b([\s\S]*?)(['"])([^'"]+)\3\s*;/gm,
    )) {
      const declaresFrom = /\bfrom\s*$/.test(clause);
      const sideEffect = keyword === 'import' && clause.trim() === '';
      if (!declaresFrom && !sideEffect) continue;
      // `import type { … } from` / `export type { … } from`: erased, harmless.
      // A `{ type A, b }` inline-type clause is NOT skipped — `b` is a value.
      if (/^\s*type\b/.test(clause)) continue;
      specifiers.push(specifier);
    }

    for (const [, , specifier] of stripped.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)) {
      specifiers.push(specifier);
    }

    return specifiers;
  }

  /** The same, for a file on disk. */
  function valueImportSources(path: string): string[] {
    return valueImportSpecifiers(readFileSync(path, 'utf8'));
  }

  it('sees every import shape, including the two that used to walk past it', () => {
    // SELF-TEST, because the guard below is only as good as this function and a
    // blind spot in it looks exactly like a clean bill of health (WR-04).
    const db = '@/db/repository';

    // The two shapes the old regex could not see.
    expect(valueImportSpecifiers(`import '${db}';`)).toEqual([db]);
    expect(valueImportSpecifiers(`import "${db}";`)).toEqual([db]);
    expect(valueImportSpecifiers(`import x from "${db}";`)).toEqual([db]);
    expect(valueImportSpecifiers(`import { a } from "${db}";`)).toEqual([db]);

    // The shapes it could, plus the two it never covered at all.
    expect(valueImportSpecifiers(`import x from '${db}';`)).toEqual([db]);
    expect(valueImportSpecifiers(`import * as ns from '${db}';`)).toEqual([db]);
    expect(valueImportSpecifiers(`import {\n  a,\n  b,\n} from '${db}';`)).toEqual([db]);
    expect(valueImportSpecifiers(`export { a } from '${db}';`)).toEqual([db]);
    expect(valueImportSpecifiers(`const m = await import('${db}');`)).toEqual([db]);

    // Erased at build time — free.
    expect(valueImportSpecifiers(`import type { A } from '${db}';`)).toEqual([]);
    expect(valueImportSpecifiers(`export type { A } from '${db}';`)).toEqual([]);
    // An inline type in a value clause is still a value import.
    expect(valueImportSpecifiers(`import { type A, b } from '${db}';`)).toEqual([db]);

    // Not imports at all — a quoted string ending in `;` is not enough.
    expect(valueImportSpecifiers(`export const GREETING = 'hi';`)).toEqual([]);
    expect(valueImportSpecifiers(`const path = 'import from nowhere';`)).toEqual([]);
    // Commented-out imports stay invisible.
    expect(valueImportSpecifiers(`// import '${db}';`)).toEqual([]);

    // THE REVIEW'S EXACT SCENARIO: this line inserted at the top of the island
    // used to leave the specifier list as ["react", "./print-feedback"] and the
    // guard passing. It must now be seen — and therefore rejected below.
    const island = readFileSync(
      'src/app/(console)/reports/[client]/[reportId]/print-button.tsx',
      'utf8',
    );
    expect(valueImportSpecifiers(`import '${db}';\n${island}`)).toContain(db);
  });

  for (const path of CLIENT_REACHABLE) {
    it(`${path} pulls no database module into the browser bundle`, () => {
      const specifiers = valueImportSources(path);

      for (const specifier of specifiers) {
        expect(specifier).not.toMatch(/^@\/db\//);
        // `approve-draft` is server-only by transitive dependency: it imports
        // the repository barrel. Types from it are free; values are not.
        expect(specifier).not.toBe('@/core/approval/approve-draft');
      }
    });
  }

  it('the constant they DO need lives in a module that imports nothing', () => {
    const limits = readFileSync('src/core/approval/limits.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(limits.match(/^import .*$/gm) ?? []).toEqual([]);
    expect(limits).toContain('export const EDITED_BODY_MAX');
  });

  it('and every existing server-side import path still resolves', () => {
    // The re-export is what makes the move invisible to the actions, the core
    // and the suites that already import it from `approve-draft`.
    const core = readFileSync('src/core/approval/approve-draft.ts', 'utf8');
    expect(core).toContain("export { EDITED_BODY_MAX } from './limits';");
  });
});

/**
 * invalid-use-server-value, caught at test time instead of page-load time.
 *
 * A `'use server'` module may export only async functions. Turbopack enforces
 * this at MODULE EVALUATION in the browser — invisible to vitest (which imports
 * the module directly) and, for some shapes, silently `undefined` instead of an
 * error. Both failure modes shipped in this phase and were found by loading
 * pages during UAT (connect page Runtime Error; audits/new crash on
 * `state.values` of undefined). Blank action states belong in a sibling
 * `action-state.ts`.
 */
describe("'use server' files export only async functions", () => {
  it('finds no const/let/var/sync-function exports in any use-server module', async () => {
    const { readFileSync } = await import('node:fs');
    const { execSync } = await import('node:child_process');
    const files = execSync(
      String.raw`grep -rl "^'use server'" src --include='*.ts' --include='*.tsx'`,
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const [lineNo, line] of src.split('\n').entries()) {
        // Runtime value exports only — `export type` / `export interface` are
        // erased and legal; `export async function` is the intended shape.
        if (/^export\s+(const|let|var|function\s)/.test(line) && !/^export\s+async\s/.test(line)) {
          offenders.push(`${file}:${lineNo + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
