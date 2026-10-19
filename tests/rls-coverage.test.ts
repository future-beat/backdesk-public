/**
 * ONB-05: no public table ships without row-level security.
 *
 * The leak test proves the tables that exist today are isolated. This one is the
 * standing guard for every table that does not exist yet: the moment someone
 * adds a `pgTable` without a `pgPolicy` (or writes a raw CREATE TABLE in a
 * custom migration and forgets the ALTER), the suite goes red and CI blocks it.
 *
 * Reads `pg_tables` over a direct connection because PostgREST cannot expose
 * catalog tables.
 */
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { testEnv } from './helpers/env';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('RLS coverage (ONB-05)', () => {
  it('has row-level security enabled on every table in the public schema', async () => {
    const unprotected = await sql<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = false
      ORDER BY tablename
    `;

    const names = unprotected.map((r) => r.tablename);

    expect(
      names,
      `Tables in the public schema without RLS: ${names.join(', ') || '(none)'}. ` +
        'Every tenant-scoped table needs a pgPolicy in src/db/schema (attaching a ' +
        'policy auto-enables RLS); a genuinely tenant-agnostic table still needs an ' +
        'explicit ALTER TABLE ... ENABLE ROW LEVEL SECURITY plus a deliberate policy.',
    ).toEqual([]);
  });

  /**
   * WR-10: `rowsecurity = true` is not isolation.
   *
   * The assertion above checks only that RLS is switched on. A future table
   * shipping with `CREATE POLICY ... FOR ALL TO authenticated USING (true)` —
   * the single most common RLS mistake, and the one that produces an actual
   * cross-tenant leak — has `rowsecurity = true` and sails straight through it.
   */
  it('has at least one policy on every RLS-enabled public table', async () => {
    // RLS enabled with NO policy is deny-all: safe, but almost always
    // unintentional, and invisible until a query silently returns nothing.
    const policyless = await sql<{ tablename: string }[]>`
      SELECT t.tablename
      FROM pg_tables t
      WHERE t.schemaname = 'public'
        AND t.rowsecurity = true
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename
        )
      ORDER BY t.tablename
    `;

    const names = policyless.map((r) => r.tablename);

    expect(
      names,
      `RLS is enabled with no policy at all on: ${names.join(', ') || '(none)'}. ` +
        'That is deny-all — safe, but it means nothing can read the table, which ' +
        'is rarely what was intended.',
    ).toEqual([]);
  });

  it('has no policy whose USING or WITH CHECK clause is unconditionally true', async () => {
    const wide = await sql<{ tablename: string; policyname: string }[]>`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (qual = 'true' OR with_check = 'true')
      ORDER BY tablename, policyname
    `;

    const named = wide.map((r) => `${r.tablename}.${r.policyname}`);

    expect(
      named,
      `USING(true) / WITH CHECK(true) policies found: ${named.join(', ') || '(none)'}. ` +
        'A policy that is unconditionally true is RLS in name only — the table ' +
        'reports rowsecurity = true and leaks every row to every caller of that ' +
        'role. Scope it through has_tenant_access(...) like tenants_member_access.',
    ).toEqual([]);
  });

  /**
   * WR-04: RLS is only half the guard — table privileges are the other half, and
   * they are the half the platform silently fills in.
   *
   * Supabase's project bootstrap installs ALTER DEFAULT PRIVILEGES in `public`
   * for the `postgres` role, so on the hosted project anon and authenticated had
   * INSERT, UPDATE, DELETE and TRUNCATE on both tables — while CI, running on a
   * fresh `supabase start` with no such default, had only what the migrations
   * granted. The two environments disagreed, and production was the permissive
   * one.
   *
   * TRUNCATE is the reason this is not merely untidy: it is NOT subject to
   * row-level security, so no policy test could ever have caught it.
   */
  it('grants exactly the documented privileges and nothing inherited (WR-04)', async () => {
    const grants = await sql<{ table_name: string; grantee: string; privs: string }[]>`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN (
          'tenants', 'tenant_members', 'sm8_connections', 'quotes',
          'quote_contacts', 'quote_status_events', 'sync_runs',
          'operator_allowlist', 'event_consumer_cursors',
          'prospects', 'prospect_quote_lines',
          'cadence_touch_templates', 'cadence_settings', 'cadences',
          'cadence_touches', 'send_ledger', 'suppressed_contacts',
          'inbound_messages', 'messaging_config',
          'escalations', 'tenant_attestations',
          'quote_attributions', 'monthly_reports', 'tenant_fees',
          'audit_requests', 'audit_request_throttle',
          'tenant_proofs', 'messaging_config_audit',
          'tenant_divert_numbers', 'missed_calls',
          'leads', 'text_back_templates', 'tenant_never_text_numbers',
          'operator_alert_log'
        )
        AND grantee IN ('anon', 'authenticated')
      GROUP BY table_name, grantee
      ORDER BY table_name, grantee
    `;

    const actual = Object.fromEntries(
      grants.map((g) => [`${g.table_name}/${g.grantee}`, g.privs]),
    );

    expect(
      actual,
      'Privileges drifted from src/db/migrations/0005_revoke_inherited_grants.sql ' +
        'or 0007_sm8_table_grants.sql. An extra INSERT on tenant_members is ' +
        'self-enrolment into another tenant; an extra INSERT on sm8_connections is ' +
        'a path to store an API key WITHOUT the live verification the connect ' +
        'action performs; an extra TRUNCATE on any of them bypasses RLS entirely.',
    ).toEqual({
      'tenant_members/anon': 'SELECT',
      'tenant_members/authenticated': 'SELECT',
      'tenants/anon': 'SELECT',
      'tenants/authenticated': 'DELETE,SELECT,UPDATE',
      // INSERT deliberately withheld on both: connections are created only by
      // the verify-then-write connect path, and quote rows must mirror a real
      // ServiceM8 job — a hand-inserted one is a job the cadence chases and the
      // client has never heard of.
      'quotes/anon': 'SELECT',
      'quotes/authenticated': 'DELETE,SELECT,UPDATE',
      'sm8_connections/anon': 'SELECT',
      'sm8_connections/authenticated': 'DELETE,SELECT,UPDATE',

      // The five sync tables (0011) are READ-ONLY to authenticated — strictly
      // narrower than `quotes`, which needs UPDATE for operator triage. None of
      // these has a column a human decides:
      //  * quote_contacts holds a client's customers' phone numbers; an UPDATE
      //    grant redirects a cadence at an attacker-chosen recipient.
      //  * quote_status_events is the attribution ledger — an INSERT grant
      //    fabricates a win the service then bills against.
      //  * sync_runs is the health log; a writable health log is not one.
      //  * operator_allowlist INSERT is self-promotion to operator.
      //  * event_consumer_cursors UPDATE rewinds the cadence engine (replaying
      //    every event as real messages to real customers) or skips it silently.
      'quote_contacts/anon': 'SELECT',
      'quote_contacts/authenticated': 'SELECT',
      'quote_status_events/anon': 'SELECT',
      'quote_status_events/authenticated': 'SELECT',
      'sync_runs/anon': 'SELECT',
      'sync_runs/authenticated': 'SELECT',
      'operator_allowlist/anon': 'SELECT',
      'operator_allowlist/authenticated': 'SELECT',
      'event_consumer_cursors/anon': 'SELECT',
      'event_consumer_cursors/authenticated': 'SELECT',

      // The two prospect tables (0014) are READ-ONLY to authenticated, and the
      // read is additionally gated by is_operator(). No INSERT for the same
      // reason sm8_connections has none — a prospect row is created only by the
      // verify-then-write audit action, which proves the API key works against
      // the live API BEFORE anything is stored. No UPDATE, because no column
      // here holds a human decision. No DELETE, because retention on
      // prospect_quote_lines is the purge job's business and an authenticated
      // DELETE on `prospects` would destroy the aggregate figures that are
      // supposed to OUTLIVE the raw lines (D-04).
      'prospects/anon': 'SELECT',
      'prospects/authenticated': 'SELECT',
      'prospect_quote_lines/anon': 'SELECT',
      'prospect_quote_lines/authenticated': 'SELECT',

      // The public intake (0035) is READ-ONLY to authenticated on the same
      // terms, and the omissions matter MORE here than anywhere else in this
      // map: `audit_requests` is the one table an unauthenticated stranger can
      // already cause a write to. The write path is the server action holding
      // the service-role connection, which validates every field first; an
      // `authenticated` INSERT grant would be a SECOND, unvalidated door into
      // it. No UPDATE (status changes go through the repository after
      // requireOperator()) and no DELETE (retention is the purge's business).
      //
      // `audit_request_throttle` appears in NO ROW OF THIS MAP, deliberately.
      // It is an abuse counter, not a record: nothing reads it through
      // PostgREST, and a SELECT grant would publish how many times each hashed
      // address has submitted. A table with zero grants to anon/authenticated
      // is simply absent here — its absence below is the assertion.
      'audit_requests/anon': 'SELECT',
      'audit_requests/authenticated': 'SELECT',

      // The six cadence tables (0017) are READ-ONLY to authenticated — every
      // one of them, with no exception for the "harmless" config tables.
      // `quotes` earns its UPDATE because `chase_eligibility` holds a human
      // decision the console makes directly; NOT ONE column here is like that.
      // The D-16 kill/pause/resume controls are server actions that authorize
      // with the operator's JWT and then write through the service-role
      // repository, because each of them is a multi-table transaction (stop the
      // cadence AND skip its unsent touches AND write the suppression row).
      // A direct console UPDATE would perform one third of that.
      //
      //  * cadence_settings UPDATE clears `paused_at` — restarting messaging to
      //    every one of a client's customers without the D-07 re-window, i.e.
      //    the burst send CAD-02 exists to prevent, from a curl.
      //  * cadence_touches UPDATE rewrites `scheduled_at`, the single column the
      //    "never out of hours, never late, never bursty" guarantee lives in.
      //  * cadences UPDATE flips a killed cadence back to 'active'.
      //  * send_ledger DELETE removes the row proving a touch was already
      //    claimed — the next tick re-claims it and the customer is messaged
      //    twice, which is the exact failure CAD-04 is about (T-3-03).
      'cadence_touch_templates/anon': 'SELECT',
      'cadence_touch_templates/authenticated': 'SELECT',
      'cadence_settings/anon': 'SELECT',
      'cadence_settings/authenticated': 'SELECT',
      'cadences/anon': 'SELECT',
      'cadences/authenticated': 'SELECT',
      'cadence_touches/anon': 'SELECT',
      'cadence_touches/authenticated': 'SELECT',
      'send_ledger/anon': 'SELECT',
      'send_ledger/authenticated': 'SELECT',

      // suppressed_contacts is the strictest row in this map and the one worth
      // reading twice (D-06/D-15, threat T-3-02). SELECT and nothing else — the
      // ABSENT DELETE is the point. A row here exists because a human
      // complained or asked to be left alone, so "un-suppress" must not be a
      // capability the console role holds at all, not even an undocumented one:
      // it would re-arm the cadence against that person. The absent INSERT
      // matters too — a console-written row would carry an unnormalized address,
      // and a suppression storing `0400 123 456` never matches the
      // `+61400123456` that dispatch actually checks.
      'suppressed_contacts/anon': 'SELECT',
      'suppressed_contacts/authenticated': 'SELECT',

      // inbound_messages (04-01, T-4-04) — read-only for the same reason the
      // six above are, plus one of its own. This table is COMPLIANCE EVIDENCE:
      // `is_stop`, `attribution` and `received_at` are what answers "did we
      // honour that STOP, and when did we know". An INSERT grant is a path by
      // which that record can be fabricated after the fact; a DELETE grant
      // removes the record of a customer having asked us to stop. The one write
      // the console performs (`triaged_at`, plan 04-06) goes through the
      // service-role repository like every other D-16 control.
      'inbound_messages/anon': 'SELECT',
      'inbound_messages/authenticated': 'SELECT',

      // messaging_config (04-03, D-04) — read-only, and this is the strongest
      // case for read-only in the schema. `enabled = true` on a row carrying a
      // from-address IS the activation of real SMS to real customers: no
      // deploy, no code change, effective on the next tick. An UPDATE grant
      // here would let the console role start messaging every client's
      // customers by flipping one boolean; INSERT is the same power one row
      // earlier. The console's messaging page (04-06) and the activation
      // script (04-07) both write through the service-role repository, like
      // every other D-16 control.
      'messaging_config/anon': 'SELECT',
      'messaging_config/authenticated': 'SELECT',

      // ── THE TWO PHASE 6 EVIDENCE TABLES (0032, threat T-6-04) ───────────
      //
      // Added to this pinned map rather than left to the two standing checks
      // above, because "RLS is on and a policy exists" does not cover the half
      // that RLS cannot: TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY, so an
      // inherited grant on either of these is invisible to every policy test.
      //
      // escalations is the D-08 never-twice claim. A DELETE grant removes the
      // row proving a tradie was already told about a reply, and the next tick
      // texts them again about the same customer — the noise that teaches them
      // to ignore the next alert. An UPDATE grant rewrites `outcome`, turning
      // "we do not know whether this reached them" into an answer nobody
      // verified.
      //
      // tenant_attestations is APPEND-ONLY, and the absent UPDATE is the point:
      // a row records that a named human looked at a client's ServiceM8
      // settings at a recorded moment. An attestation that can be edited
      // afterwards is not evidence of anything, because the attestation made
      // and the attestation recorded could differ with no trace. The absent
      // DELETE protects the staleness history D-15's re-check policy reads, and
      // the absent INSERT keeps `attested_at` ours rather than the caller's.
      'escalations/anon': 'SELECT',
      'escalations/authenticated': 'SELECT',
      'tenant_attestations/anon': 'SELECT',
      'tenant_attestations/authenticated': 'SELECT',

      // 07-01, and the three whose write grants would be most expensive: these
      // are the tables the client is BILLED from (T-7-01).
      //
      // quote_attributions — an INSERT grant invents a recovered job the client
      // is then invoiced for; an UPDATE grant edits the dollar figure after the
      // fact; a DELETE grant frees the D-04 never-twice claim, so a replayed
      // `won` event bills the same job a second time.
      //
      // monthly_reports — an UPDATE grant rewrites a document a client was
      // already sent, and the entire value of D-11 is that the PDF stapled to
      // an invoice is reproducible months later. A correction is a new VERSION.
      //
      // tenant_fees — the denominator of the 3x guarantee. Lowering an amount
      // after a report has quoted a multiple against it changes what the client
      // was told they got for their money, retroactively and invisibly.
      'quote_attributions/anon': 'SELECT',
      'quote_attributions/authenticated': 'SELECT',
      'monthly_reports/anon': 'SELECT',
      'monthly_reports/authenticated': 'SELECT',
      'tenant_fees/anon': 'SELECT',
      'tenant_fees/authenticated': 'SELECT',

      // ── THE TWO PHASE 10 GO-LIVE TABLES (0036, threat T-10-15) ──────────
      //
      // messaging_config_audit is the account of WHO turned real customer
      // messaging on, and when, and why it was turned off. It is append-only
      // through one private writer that runs inside `armChannel`'s transaction,
      // and every privilege absent from this line is a way that account could
      // be rewritten by the console role: an UPDATE grant edits the operator id
      // or the reason on a flip that already happened; a DELETE grant removes
      // the record of an arming entirely, leaving `messaging_config.enabled =
      // true` with nothing to explain it — which is precisely the state the
      // one-transaction writer exists to make impossible. TRUNCATE, inherited
      // silently from Supabase's default privileges, would erase the whole
      // history and is NOT subject to row-level security, so no policy test
      // could catch it.
      //
      // tenant_proofs is the other half of the same evidence pair, and it is
      // APPEND-ONLY for the `tenant_attestations` reason plus one of its own:
      // each row carries the artefact id somebody else can go and re-check. An
      // UPDATE grant lets that id be swapped after the fact, which converts
      // "here is the ClickSend message that reached the tradie's handset" into
      // an unfalsifiable claim — and a proof nobody can re-check is exactly the
      // "yeah, saw it work" this table was created to replace.
      'messaging_config_audit/anon': 'SELECT',
      'messaging_config_audit/authenticated': 'SELECT',
      'tenant_proofs/anon': 'SELECT',
      'tenant_proofs/authenticated': 'SELECT',

      // ── THE TWO PHASE 11 TELEPHONY TABLES (0038, threats T-11-12/T-11-17) ─
      //
      // missed_calls is EVIDENCE: one row per call a client's line diverted to
      // us, and the artefact the verification-call proof and Phase 12's
      // text-back gate both read. An authenticated INSERT would fabricate a
      // diverted call that never rang; an UPDATE would rewrite when a caller
      // rang (or whether it was after hours, which is a fact computed once at
      // arrival); a DELETE would erase a customer's call. Every writer is a
      // service-role path — the two Twilio webhooks and the nightly reconcile.
      // TRUNCATE, inherited silently, is not subject to RLS at all.
      //
      // tenant_divert_numbers has NO DELETE GRANT because DELETE IS THE RELEASE
      // PATH D-08 forbids: a number released while the client is active is a
      // number their phone keeps diverting to after Twilio sells it to somebody
      // else. No INSERT/UPDATE either — provisioning is claim-then-buy through
      // a server action on the service-role repository, and an UPDATE grant
      // would let the console repoint a live divert at a different number.
      'missed_calls/anon': 'SELECT',
      'missed_calls/authenticated': 'SELECT',
      'tenant_divert_numbers/anon': 'SELECT',
      'tenant_divert_numbers/authenticated': 'SELECT',

      // ── THE FOUR PHASE 12 TEXT-BACK TABLES (0039, 2026-10) ───────────────
      //
      // leads: a lead is what a text-back cadence chases — an authenticated
      // INSERT would open a chase of whoever's number was typed.
      // text_back_templates: these bytes are SENT to the public; an edit must
      // go through the save action's validator and the write-once attestation.
      // tenant_never_text_numbers: a DELETE removes the fail-safe that stops a
      // client's own line being texted when a carrier substitutes the caller ID.
      // operator_alert_log: the row IS the once-a-day latch — a session that
      // could insert it could silence today's balance alert.
      'leads/anon': 'SELECT',
      'leads/authenticated': 'SELECT',
      'operator_alert_log/anon': 'SELECT',
      'operator_alert_log/authenticated': 'SELECT',
      'tenant_never_text_numbers/anon': 'SELECT',
      'tenant_never_text_numbers/authenticated': 'SELECT',
      'text_back_templates/anon': 'SELECT',
      'text_back_templates/authenticated': 'SELECT',
    });
  });

  /**
   * RPT-01 and RPT-02 are INDEXES, not code — so they are asserted against the
   * MIGRATED DATABASE rather than against the schema files that were supposed to
   * produce them (the CAD-04 argument below, one phase later).
   *
   * A `uniqueIndex(...)` in src/db/schema proves only what drizzle intended. If
   * migration 0033 was never applied (the journal-ordering trap: `migrate` exits
   * 0 and silently skips), every unit test still passes and the first symptom is
   * a client invoiced twice for one recovered job.
   *
   * The COLUMN TUPLE is asserted, not merely the index's existence. A unique
   * index on `quote_id` alone would also "exist" under that name while making
   * one tenant's win consume another tenant's claim; a unique index on
   * `(tenant_id, period_start)` would forbid the version-2 report that D-11's
   * whole correction story depends on.
   */
  it('enforces at-most-once attribution and one row per report version in the database (RPT-01, RPT-02)', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('quote_attributions_one_per_quote', 'monthly_reports_version_uniq')
      ORDER BY indexname
    `;

    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(
      Object.keys(byName).sort(),
      'A load-bearing unique index from migration 0033 is missing from the ' +
        'migrated database. Without quote_attributions_one_per_quote, a replayed ' +
        '`won` event attributes the same job twice and the client is billed twice ' +
        'for one win; without monthly_reports_version_uniq, two concurrent ' +
        'generates both write version N and one silently replaces the other.',
    ).toEqual(['monthly_reports_version_uniq', 'quote_attributions_one_per_quote']);

    expect(byName.quote_attributions_one_per_quote).toMatch(/UNIQUE INDEX/);
    expect(
      byName.quote_attributions_one_per_quote,
      'The claim must be TENANT-SCOPED (quotes_tenant_job_uniq argument): two ' +
        'clients could be handed the same job uuid by a shared ServiceM8 account, ' +
        'and one tenant\u2019s win must never consume another tenant\u2019s claim.',
    ).toMatch(/\(tenant_id, quote_id\)/);

    expect(byName.monthly_reports_version_uniq).toMatch(/UNIQUE INDEX/);
    expect(
      byName.monthly_reports_version_uniq,
      'The version must be part of the key. Without it, re-generating a month ' +
        'could not keep the previous version, and D-11\u2019s "here is what we ' +
        'sent you, and here is the corrected one" becomes unsayable.',
    ).toMatch(/\(tenant_id, period_start, version\)/);
  });

  /**
   * T-3-02, asserted a second time and from the other direction.
   *
   * The exact-grants map above would already fail if an INSERT appeared on
   * `suppressed_contacts` — but it fails as one line in a 30-key object diff,
   * which is easy to "fix" by pasting the actual value in. This assertion says
   * what the rule IS rather than what the map happens to contain, so a future
   * convenience grant produces an error message that argues with the person who
   * added it.
   */
  it('holds no write grant of any kind on suppressed_contacts (T-3-02)', async () => {
    const writes = await sql<{ grantee: string; privilege_type: string }[]>`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'suppressed_contacts'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type <> 'SELECT'
      ORDER BY grantee, privilege_type
    `;

    expect(
      writes.map((w) => `${w.grantee}:${w.privilege_type}`),
      'The suppression list is the Spam Act safety mechanism and is INSERT-ONLY ' +
        'by design (D-06/D-15). A DELETE grant re-arms a cadence against someone ' +
        'who complained; an INSERT grant writes an unnormalized address that ' +
        'dispatch will never match. Both are structurally impossible today only ' +
        'because these grants are absent.',
    ).toEqual([]);
  });

  /**
   * CAD-04 and CAD-01 are indexes, not code — so they are asserted against the
   * MIGRATED DATABASE rather than against the schema file that was supposed to
   * produce them.
   *
   * A `uniqueIndex(...)` in src/db/schema proves only what drizzle intended. If
   * the migration was never applied (the journal-ordering trap: `migrate` exits
   * 0 and silently skips), every unit test still passes and the first symptom is
   * a customer receiving the same follow-up twice.
   *
   * The partial index's PREDICATE is asserted, not just its existence: a full
   * unique index on `quote_id` would also "exist" under that name while
   * forbidding the legal sequential-cadence history (reopen → re-triage → new
   * cadence) along with the illegal concurrency.
   */
  it('enforces never-twice and one-live-per-quote in the database (CAD-04, CAD-01)', async () => {
    const rows = await sql<
      { indexname: string; indexdef: string }[]
    >`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('send_ledger_cadence_touch_uniq', 'cadences_one_live_per_quote')
      ORDER BY indexname
    `;

    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(
      Object.keys(byName).sort(),
      'A load-bearing unique index is missing from the migrated database. ' +
        'Without send_ledger_cadence_touch_uniq, two overlapping ticks both ' +
        'claim the same touch and the customer is messaged twice; without ' +
        'cadences_one_live_per_quote, a replayed quote_opened starts a second ' +
        'parallel chase for the same job.',
    ).toEqual(['cadences_one_live_per_quote', 'send_ledger_cadence_touch_uniq']);

    expect(byName.send_ledger_cadence_touch_uniq).toMatch(/UNIQUE INDEX/);
    expect(byName.send_ledger_cadence_touch_uniq).toMatch(/\(cadence_id, touch_number\)/);

    expect(byName.cadences_one_live_per_quote).toMatch(/UNIQUE INDEX/);
    expect(byName.cadences_one_live_per_quote).toMatch(/\(quote_id\)/);
    expect(
      byName.cadences_one_live_per_quote,
      'cadences_one_live_per_quote must be PARTIAL on the live statuses. A full ' +
        'unique index would forbid a quote ever having a second cadence, which ' +
        'is a legal history (D-08 reopen → operator re-triage → fresh cadence).',
    ).toMatch(/WHERE .*'active'.*'paused'/);
  });

  /**
   * WR-06 — THE CONSTRAINT SET ON `cadences` IS PART OF `cadences.create`'s
   * CONTRACT, SO IT IS PINNED HERE.
   *
   * `create` uses TARGETLESS `ON CONFLICT DO NOTHING`, which is the right call
   * (naming an arbiter makes a conflict on any OTHER index raise 23505, which
   * `consume-events` reads as a blocked run and which holds the shared cursor for
   * every tenant). But targetless means it absorbs EVERY unique index, unique
   * constraint, exclusion constraint AND the primary key on this table — present
   * and future. The comment on that statement ends "either way, you are the
   * replay", which is true of the indexes enumerated below and silently becomes
   * false for the next one added.
   *
   * A unique index added by Phase 4 or 7 — say `(tenant_id, quote_id,
   * touch_generation)` — would be absorbed: zero rows returned,
   * `createCadenceForQuoteOpened` returns 'replayed', the event is consumed, and
   * NO CADENCE EXISTS. A quote that is never chased, with no error and no
   * counter. The failure is silent, which is why the tripwire has to be a test
   * rather than a comment.
   *
   * SO: if this test goes red because you added an index, that is the test
   * working. Add the name below AND decide, out loud, what a conflict on it
   * should mean to `createCadenceForQuoteOpened`'s 'replayed' branch.
   */
  it('pins every arbiter the targetless ON CONFLICT on `cadences` absorbs (WR-06)', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT i.indexname, i.indexdef
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      JOIN pg_index x ON x.indexrelid = c.oid
      WHERE i.schemaname = 'public'
        AND i.tablename = 'cadences'
        AND x.indisunique
      ORDER BY i.indexname
    `;

    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(
      Object.keys(byName).sort(),
      'The set of unique arbiters on `cadences` changed. `cadences.create` uses ' +
        'a TARGETLESS ON CONFLICT DO NOTHING, so every one of these silently ' +
        "turns into a 'replayed' answer and a consumed event. An index added " +
        'without revisiting that branch turns a real failure into a quote that ' +
        'is never chased, with no error and no counter anywhere.',
    ).toEqual([
      // The PK. Guarded only by `CadenceCreate` omitting `id` — TypeScript-only,
      // like `created_by_event_id` was before migration 0023, but a random uuid
      // collision is not a failure mode worth designing against.
      'cadences_pkey',
      // (id, tenant_id) — the pairing `cadence_touches` references so a touch
      // cannot be attached to another tenant's cadence (migration 0019).
      'cadences_id_tenant_uniq',
      // CAD-01, on the upstream job identity (migration 0024, WR-02).
      'cadences_one_live_per_job',
      // CAD-01, on our surrogate quote id.
      'cadences_one_live_per_quote',
      // G-3-2, the replay arbiter.
      'cadences_one_per_opened_event',
      // 2026-10 (Phase 12, migration 0039, D-05/D-19): THE FOURTH ARBITER, and
      // the decision this test exists to force. It is partial on `lead_id IS
      // NOT NULL`, and every quote row carries `lead_id` NULL
      // (`cadences_kind_identity`), so the targetless quote `create` can never
      // conflict on it: 'replayed' keeps exactly its meaning. Lead cadences are
      // created only by `createLead`, which NAMES this index as its arbiter.
      'cadences_one_live_per_lead',
    ].sort());

    // The predicate that makes the decision above true, asserted.
    expect(
      byName.cadences_one_live_per_lead,
      'cadences_one_live_per_lead must exclude NULL lead ids, or a quote insert ' +
        '(lead_id NULL) could reach it through the targetless ON CONFLICT.',
    ).toMatch(/WHERE \(*\(?lead_id IS NOT NULL\)? AND/);
    expect(byName.cadences_one_live_per_lead).toMatch(/'active'.*'paused'/);
    expect(byName.cadences_one_live_per_lead).toMatch(/\(lead_id\)/);

    // The two predicates that carry meaning, asserted rather than assumed.
    expect(
      byName.cadences_one_live_per_job,
      'cadences_one_live_per_job must be tenant-scoped: two clients may hold the ' +
        'same ServiceM8 job, and one client\'s live cadence must not block another\'s.',
    ).toMatch(/\(tenant_id, sm8_job_uuid\)/);
    expect(byName.cadences_one_live_per_job).toMatch(/WHERE .*'active'.*'paused'/);

    expect(
      byName.cadences_one_per_opened_event,
      'cadences_one_per_opened_event must NOT be partial on status — refusing a ' +
        'replayed quote_opened whatever the first cadence has since become is the ' +
        'entire difference between it and the live indexes (G-3-2).',
    ).not.toMatch(/'active'/);
    expect(
      byName.cadences_one_per_opened_event,
      'and it must be partial on NULL, so the rows the replay guarantee covers ' +
        'are in the definition rather than left to the NULLS DISTINCT default (CR-01).',
    ).toMatch(/WHERE \(created_by_event_id IS NOT NULL\)/);
  });

  /**
   * CR-01 — the replay key is required by the DATABASE, not by a TypeScript type.
   *
   * Asserted here as well as behaviourally in cadence-repository.test.ts because
   * this file's question is "did the migration actually reach the database", and
   * a NOT VALID constraint that was never applied fails exactly the same way the
   * missing index above does: silently, with every unit test still green.
   */
  it('requires the G-3-2 replay key on every new cadence (CR-01)', async () => {
    const [row] = await sql<{ def: string; convalidated: boolean }[]>`
      SELECT pg_get_constraintdef(oid) AS def, convalidated
      FROM pg_constraint
      WHERE conrelid = 'public.cadences'::regclass
        AND conname = 'cadences_replay_key_present'
    `;

    expect(
      row,
      'cadences_replay_key_present is missing. Without it created_by_event_id is ' +
        'nullable with NULLS DISTINCT semantics, so a writer that omits the key ' +
        'opts silently out of the replay guarantee and a duplicate ACTIVE cadence ' +
        're-chases the customer from touch 1 with no error anywhere.',
    ).toBeTruthy();
    expect(row.def).toMatch(/created_by_event_id IS NOT NULL/);
    // NOT VALID is deliberate: it skips the scan of pre-0021 rows, which cannot
    // carry a key. New and updated rows are checked regardless.
    expect(row.convalidated).toBe(false);
  });

  it('constrains the cadence vocabularies (WR-03, D-14)', async () => {
    // As with the sync tables, `authenticated` holds no write grant here, so
    // these defend against US. A typo'd `cadences.status` is the expensive one:
    // 'stoped' matches neither `= 'active'` (so the cadence stops dispatching)
    // nor `IN ('active','paused')` (so the row falls OUT of the partial unique
    // index and a SECOND live cadence can be created for the same quote).
    // Nothing goes red; the customer gets two parallel chase sequences.
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid IN (
          'public.cadences'::regclass,
          'public.cadence_touches'::regclass,
          'public.send_ledger'::regclass,
          'public.suppressed_contacts'::regclass,
          'public.cadence_touch_templates'::regclass
        )
        AND contype = 'c'
      ORDER BY conname
    `;
    const names = rows.map((r) => r.conname);

    for (const expected of [
      'cadences_status_known',
      'cadences_pause_reason_known',
      'cadences_stop_reason_known',
      'cadence_touches_status_known',
      'cadence_touches_skip_reason_known',
      'cadence_touches_channel_known',
      'send_ledger_outcome_known',
      'suppressed_contacts_channel_known',
      'cadence_touch_templates_channel_known',
      // 2026-10 (Phase 12, 0039): which identity each cadence kind carries,
      // and exactly one owner per ledger row (a quote or a lead, never both).
      'cadences_kind_known',
      'cadences_kind_identity',
      'send_ledger_one_owner',
    ]) {
      expect(names, `missing CHECK constraint ${expected}`).toContain(expected);
    }
  });

  /**
   * 2026-10 (Phase 13, migration 0040, D-05/D-09/D-11/D-12/D-16): the lead
   * vocabularies and closing shapes, asserted against the DATABASE because a
   * migration that was never applied fails exactly like a missing CHECK —
   * silently, with every pure test still green.
   */
  it('constrains the Phase 13 lead vocabularies and closing shapes (0040)', async () => {
    const rows = await sql<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid IN (
          'public.leads'::regclass,
          'public.inbound_messages'::regclass,
          'public.message_templates'::regclass,
          'public.escalations'::regclass,
          'public.missed_calls'::regclass,
          'public.cadences'::regclass
        )
        AND contype = 'c'
      ORDER BY conname
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.conname, r.def]));

    for (const expected of [
      // leads (D-11/D-14): the reason vocabulary and the three consistency rules.
      'leads_closed_reason_known',
      'leads_closed_iff_reason',
      'leads_closed_at_with_reason',
      'leads_expired_reason',
      // inbound_messages (D-05/D-06): the by-kind label CHECK and its siblings.
      'inbound_messages_label_known',
      'inbound_messages_urgency_known',
      'inbound_messages_urgency_lead_only',
      'inbound_messages_lead_label_has_urgency',
      'inbound_messages_keyword_hot_lead_only',
      // message_templates (D-02): quote or lead wording.
      'message_templates_kind_known',
      // escalations (D-09): only a held row can be released.
      'escalations_release_needs_hold',
      // The two widened vocabularies.
      'missed_calls_text_back_skip_reason_known',
      'cadences_stop_reason_known',
    ]) {
      expect(Object.keys(byName), `missing CHECK constraint ${expected}`).toContain(expected);
    }

    // The widenings reached the database, not only the schema files.
    expect(byName.missed_calls_text_back_skip_reason_known).toContain("'recent_negative_close'");
    expect(byName.cadences_stop_reason_known).toContain("'lead_closed'");
    // The label CHECK is BY KIND: both vocabularies, keyed on lead_id.
    expect(byName.inbound_messages_label_known).toContain("'new_enquiry'");
    expect(byName.inbound_messages_label_known).toContain("'not_interested'");
    expect(byName.inbound_messages_label_known).toMatch(/lead_id IS NULL/);
    expect(byName.inbound_messages_label_known).toMatch(/lead_id IS NOT NULL/);
  });

  it('carries the Phase 13 indexes, with the template identity widened by kind (0040)', async () => {
    // 2026-10 (Phase 13, migration 0040): the kind-widened template identity
    // REPLACES message_templates_tenant_touch_channel_version_uniq (a lead
    // touch 2 and a quote touch 2 must coexist at version 1); the other three
    // serve the 90-day gate read, the held-escalation release and the
    // label-effects pass.
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'message_templates_tenant_touch_channel_version_uniq',
          'message_templates_tenant_kind_touch_channel_version_uniq',
          'leads_tenant_mobile_created_idx',
          'escalations_held_idx',
          'inbound_messages_lead_label_idx'
        )
      ORDER BY indexname
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(Object.keys(byName).sort()).toEqual(
      [
        'escalations_held_idx',
        'inbound_messages_lead_label_idx',
        'leads_tenant_mobile_created_idx',
        'message_templates_tenant_kind_touch_channel_version_uniq',
      ].sort(),
    );
    expect(byName.message_templates_tenant_kind_touch_channel_version_uniq).toMatch(/UNIQUE/);
    expect(byName.message_templates_tenant_kind_touch_channel_version_uniq).toMatch(
      /\(tenant_id, kind, touch_number, channel, version\)/,
    );
    expect(byName.escalations_held_idx).toMatch(/hold_until IS NOT NULL/);
    expect(byName.escalations_held_idx).toMatch(/released_at IS NULL/);
    expect(byName.inbound_messages_lead_label_idx).toMatch(/lead_id IS NOT NULL/);
  });

  /**
   * 2026-10 (Phase 14, migration 0041, D-04/D-05/D-07/D-10): the lead's
   * ServiceM8 job linkage, the converted reasons and the `lead` sync source,
   * asserted against the DATABASE. `quotes_sync_source_known` is hand-written
   * (0008, re-written by hand in 0041) and invisible to drizzle, so reading its
   * definition is the only proof the widening reached the database rather
   * than only the schema file (research Pitfall 8).
   */
  it('constrains the Phase 14 job linkage, converted reasons and lead sync source (0041)', async () => {
    const rows = await sql<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid IN ('public.leads'::regclass, 'public.quotes'::regclass)
        AND contype = 'c'
      ORDER BY conname
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.conname, r.def]));

    for (const expected of [
      'leads_converted_reason',
      'leads_conversion_reason_only_converted',
      'leads_sm8_job_state_known',
      'leads_sm8_job_error_kind_known',
      'leads_sm8_job_created_has_uuid',
      'leads_sm8_job_failed_has_kind',
      'leads_sm8_job_attempts_nonneg',
      'leads_sm8_job_description_sha256_len',
      'quotes_sync_source_known',
    ]) {
      expect(Object.keys(byName), `missing CHECK constraint ${expected}`).toContain(expected);
    }

    // The widenings reached the database, not only the schema files.
    expect(byName.leads_closed_reason_known).toContain("'booked_by_tradie'");
    expect(byName.leads_closed_reason_known).toContain("'job_created'");
    expect(byName.leads_closed_reason_known).toContain("'closed_by_tradie'");
    expect(byName.leads_closed_iff_reason).toContain("'converted'");
    expect(byName.quotes_sync_source_known).toContain("'lead'");
    // Plan 14-03: the abandoned-claim kind, added to 0041 in place.
    expect(byName.leads_sm8_job_error_kind_known).toContain("'stale_claim'");
  });

  it('carries the Phase 14 indexes (0041)', async () => {
    // 2026-10 (Phase 14, migration 0041): the exactly-once arbiter for our own
    // creates (D-04, scoped to sm8_job_state = 'created') and the DONE read's
    // index (D-08).
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('leads_sm8_job_created_uniq', 'escalations_lead_to_address_sent_idx')
      ORDER BY indexname
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(Object.keys(byName).sort()).toEqual(
      ['escalations_lead_to_address_sent_idx', 'leads_sm8_job_created_uniq'].sort(),
    );
    expect(byName.leads_sm8_job_created_uniq).toMatch(/UNIQUE/);
    expect(byName.leads_sm8_job_created_uniq).toMatch(/\(tenant_id, sm8_job_uuid\)/);
    expect(byName.leads_sm8_job_created_uniq).toMatch(/sm8_job_state = 'created'/);
    expect(byName.escalations_lead_to_address_sent_idx).toMatch(/lead_id IS NOT NULL/);
  });

  /**
   * 2026-10 (Phase 15, migration 0042, D-06/D-07/D-08a/D-08b): the three
   * pseudonymisation stamps, the hash-admitting mobile CHECK and the two
   * vocabulary widenings, asserted against the DATABASE — the widening reached
   * the database, not only the schema files. No new table, so no privilege
   * row moves; no index, so the index pins above are unchanged.
   */
  it('carries the Phase 15 pseudonymised_at stamps, nullable timestamptz (0042)', async () => {
    const rows = await sql<{ table_name: string; data_type: string; is_nullable: string }[]>`
      SELECT table_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'pseudonymised_at'
      ORDER BY table_name
    `;

    expect(rows.map((r) => r.table_name)).toEqual(['inbound_messages', 'leads', 'missed_calls']);
    for (const row of rows) {
      expect(row.data_type, `${row.table_name}.pseudonymised_at type`).toBe(
        'timestamp with time zone',
      );
      expect(row.is_nullable, `${row.table_name}.pseudonymised_at must be nullable`).toBe('YES');
    }
  });

  it('widens the mobile CHECK on the stamp and the two vocabularies by one member each (0042)', async () => {
    const rows = await sql<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid IN ('public.leads'::regclass, 'public.missed_calls'::regclass)
        AND contype = 'c'
        AND conname IN (
          'leads_contact_mobile_e164',
          'leads_sm8_job_error_kind_known',
          'missed_calls_text_back_skip_reason_known'
        )
      ORDER BY conname
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.conname, r.def]));

    expect(Object.keys(byName).sort()).toEqual(
      [
        'leads_contact_mobile_e164',
        'leads_sm8_job_error_kind_known',
        'missed_calls_text_back_skip_reason_known',
      ].sort(),
    );
    // The hash arm is gated on the stamp; the E.164 arm is still there.
    expect(byName.leads_contact_mobile_e164).toContain('pseudonymised_at IS NOT NULL');
    expect(byName.leads_contact_mobile_e164).toContain('[0-9a-f]{64}');
    expect(byName.leads_contact_mobile_e164).toContain('^[+]614[0-9]{8}$');
    // D-08b and D-08a: one member each.
    expect(byName.missed_calls_text_back_skip_reason_known).toContain("'recent_conversion'");
    expect(byName.missed_calls_text_back_skip_reason_known).toContain("'recent_negative_close'");
    expect(byName.leads_sm8_job_error_kind_known).toContain("'job_linked_elsewhere'");
    expect(byName.leads_sm8_job_error_kind_known).toContain("'stale_claim'");
  });

  /**
   * T-2-08: the four tables with NO `tenant_id` to scope on.
   *
   * `has_tenant_access(tenant_id)` is inapplicable to them, and the obvious
   * shortcut — `TO authenticated USING (true)` — is caught by the literal-true
   * assertion above. What that assertion CANNOT catch is a policy scoped
   * through the wrong helper: an `exists-in-tenant_members` check would look
   * perfectly scoped and would silently admit every client login the moment the
   * v2 reports portal ships. So the helper itself is asserted by name.
   *
   * The two prospect tables (02-06) raise the stakes on that last sentence:
   * `prospects` is a list of businesses the founder is selling to, and
   * `prospect_quote_lines` holds their customers' contact details. A
   * membership-shaped policy would hand both to every client the day they get a
   * login — through a schema change made in a different phase for an unrelated
   * reason (D-01/D-03 separation).
   */
  it('gates the non-tenant tables through is_operator(), not membership (T-2-08)', async () => {
    const [fn] = await sql<{ prosecdef: boolean; provolatile: string; prolang: string }[]>`
      SELECT p.prosecdef, p.provolatile, l.lanname AS prolang
      FROM pg_proc p
      JOIN pg_language l ON l.oid = p.prolang
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'is_operator'
    `;

    expect(fn, 'public.is_operator() does not exist').toBeDefined();
    expect(
      fn.prosecdef,
      'is_operator() is not SECURITY DEFINER. Without definer rights the policy ' +
        'on operator_allowlist would query operator_allowlist under its own ' +
        'policy and recurse.',
    ).toBe(true);
    // 's' = STABLE. A VOLATILE function in a policy is re-evaluated per row.
    expect(fn.provolatile, 'is_operator() is not STABLE').toBe('s');
    expect(
      fn.prolang,
      'is_operator() must be plpgsql: a LANGUAGE sql body is validated at ' +
        'CREATE time and could not reference operator_allowlist, which the ' +
        'ordering requires to be created afterwards (see migration 0009).',
    ).toBe('plpgsql');

    const policies = await sql<{ tablename: string; qual: string | null }[]>`
      SELECT tablename, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'operator_allowlist', 'event_consumer_cursors',
          'prospects', 'prospect_quote_lines',
          'audit_requests', 'audit_request_throttle',
          'operator_alert_log'
        )
      ORDER BY tablename
    `;

    expect(
      policies.map((p) => p.tablename),
      'A non-tenant table lost its policy.',
    ).toEqual([
      // `audit_request_throttle` carries a policy nobody outside the service
      // role can reach, and that is the correct shape rather than an oversight:
      // this suite refuses an RLS-enabled table with NO policy, and "service
      // role only" is expressed as a real operator gate plus no grants at all.
      'audit_request_throttle',
      'audit_requests',
      'event_consumer_cursors',
      // 2026-10 (Phase 12, 0039): the balance-alert latch. Tenant-less, so its
      // only possible gate is the operator allowlist.
      'operator_alert_log',
      'operator_allowlist',
      'prospect_quote_lines',
      'prospects',
    ]);

    for (const policy of policies) {
      expect(
        policy.qual,
        `${policy.tablename}'s policy is not gated on is_operator(). A future ` +
          'client login must never be able to satisfy it.',
      ).toContain('is_operator()');
    }
  });

  /**
   * T-4-04: `inbound_messages` is the one table that is BOTH tenant-scoped and
   * operator-scoped, and getting that wrong fails in the quiet direction.
   *
   * Its `tenant_id` is NULLABLE by design — a reply we could not attribute is
   * recorded rather than dropped, because a customer texting STOP from a number
   * we have never seen has exercised a Spam Act right and the only acceptable
   * outcome is that a human sees it. `has_tenant_access(NULL)` can never be
   * true, so a policy carrying only that arm would make the rows that MOST need
   * a human the only rows no human can read. The table would look correct in
   * every schema-wide assertion above: RLS on, a policy present, no literal
   * `true` — and the triage queue would render empty forever.
   *
   * Both arms are therefore asserted by name, in the same spirit as the
   * is_operator() check above: `is_operator()` reads an explicit allowlist
   * rather than membership, so the operator arm cannot be satisfied by a future
   * client login reading another client's customer's message.
   */
  it('admits unattributed inbound rows to the operator ONLY (T-4-04)', async () => {
    const [policy] = await sql<{ policyname: string; qual: string | null; with_check: string | null }[]>`
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'inbound_messages'
    `;

    expect(policy, 'inbound_messages has no policy at all').toBeDefined();

    for (const [clause, expr] of [
      ['USING', policy.qual],
      ['WITH CHECK', policy.with_check],
    ] as const) {
      expect(
        expr,
        `inbound_messages' ${clause} clause does not scope tenant rows through ` +
          'has_tenant_access(). Every other tenant-carrying table does.',
      ).toContain('has_tenant_access');
      expect(
        expr,
        `inbound_messages' ${clause} clause has no is_operator() arm, so every ` +
          'UNATTRIBUTED reply (tenant_id IS NULL) is invisible to everyone — ' +
          'including the unplaced STOP that is the whole reason the column is ' +
          'nullable.',
      ).toContain('is_operator');
    }
  });

  /**
   * D-04, and the same shape of quiet failure `inbound_messages` has.
   *
   * `messaging_config.tenant_id` is NULLABLE because `tenant_id IS NULL` is THE
   * GLOBAL DEFAULT ROW — the single row that decides which number every client's
   * SMS is sent from, and therefore whether anything is sent at all. It belongs
   * to nobody, so `has_tenant_access(NULL)` can never be true, and a policy
   * carrying only that arm would make the row that governs the whole system
   * invisible to every human. The table would pass every schema-wide assertion
   * above — RLS on, a policy present, no literal `true` — while the operator's
   * messaging page rendered empty and an activation appeared not to have
   * happened.
   */
  it('admits the global messaging_config row to the operator ONLY (D-04)', async () => {
    const [policy] = await sql<{ policyname: string; qual: string | null; with_check: string | null }[]>`
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'messaging_config'
    `;

    expect(policy, 'messaging_config has no policy at all').toBeDefined();

    for (const [clause, expr] of [
      ['USING', policy.qual],
      ['WITH CHECK', policy.with_check],
    ] as const) {
      expect(
        expr,
        `messaging_config' ${clause} clause does not scope tenant rows through ` +
          'has_tenant_access(). Every other tenant-carrying table does.',
      ).toContain('has_tenant_access');
      expect(
        expr,
        `messaging_config' ${clause} clause has no is_operator() arm, so the ` +
          'GLOBAL row (tenant_id IS NULL) — the one that decides whether real ' +
          'SMS goes out at all — is invisible to everyone.',
      ).toContain('is_operator');
    }
  });

  /**
   * THE CLAUSE NOTHING ELSE WOULD CATCH.
   *
   * Postgres treats NULLs as DISTINCT in a unique index by default, so
   * `UNIQUE (channel, tenant_id)` without `NULLS NOT DISTINCT` permits any
   * number of rows with `tenant_id IS NULL` — i.e. any number of "global"
   * configs for one channel. Everything downstream still looks correct: the
   * upsert's `ON CONFLICT` simply inserts instead of updating, no error is
   * raised anywhere, and `getChannelConfig` returns whichever of them the
   * planner happened to order first. The observable symptom is this system
   * sending from an arbitrary one of two numbers, changing between ticks.
   *
   * Asserted against the DEFINITION rather than by inserting two global rows,
   * because this suite runs against the production-shared database and the row
   * it would have to insert is the one that turns real sending on.
   */
  it('keeps exactly one global row per channel possible (D-04, NULLS NOT DISTINCT)', async () => {
    const [idx] = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'messaging_config'
        AND indexname = 'messaging_config_channel_tenant_uniq'
    `;

    expect(idx, 'messaging_config_channel_tenant_uniq does not exist').toBeDefined();
    expect(
      idx.indexdef,
      'The uniqueness arbiter on messaging_config lost its NULLS NOT DISTINCT ' +
        'clause. Postgres now permits unlimited rows with tenant_id IS NULL — ' +
        'unlimited "global default" sms identities — and getChannelConfig will ' +
        'return whichever one the planner picks, silently.',
    ).toContain('NULLS NOT DISTINCT');
    expect(idx.indexdef).toContain('(channel, tenant_id)');
  });

  /**
   * 2026-10 (Phase 12, D-09): TEXT-BACK IS PER CLIENT ONLY. There is no global
   * text-back row, and the database refuses one on both the switch and its
   * history — so `isTextBackArmed`'s exact-target read can never be answered by
   * a row that would arm every client's callers at once.
   *
   * Asserted through the service-role path with every reason to succeed. The
   * INSERT is refused by the CHECK, so nothing is written — this suite may run
   * against a shared database without arming anything.
   */
  it('refuses a tenant-less text_back row on messaging_config and its audit (D-09)', async () => {
    let configError: unknown = null;
    try {
      await sql`
        INSERT INTO public.messaging_config (channel, tenant_id, enabled)
        VALUES ('text_back', NULL, false)
      `;
    } catch (error) {
      configError = error;
    }
    expect(String((configError as { message?: string } | null)?.message)).toContain(
      'messaging_config_text_back_per_tenant',
    );

    let auditError: unknown = null;
    try {
      await sql`
        INSERT INTO public.messaging_config_audit (channel, tenant_id, action, actor, reason)
        VALUES ('text_back', NULL, 'disarm', 'system', 'test: must be refused')
      `;
    } catch (error) {
      auditError = error;
    }
    expect(String((auditError as { message?: string } | null)?.message)).toContain(
      'messaging_config_text_back_per_tenant',
    );
  });

  it('constrains the sync vocabularies (WR-03)', async () => {
    // authenticated holds no write grant on these, so unlike the quotes CHECKs
    // these defend against US: a typo'd event_type written by the service-role
    // sync worker is a win the cadence engine silently ignores and the
    // recovered-revenue report silently omits, with nothing going red.
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid IN ('public.quote_status_events'::regclass, 'public.sync_runs'::regclass)
        AND contype = 'c'
      ORDER BY conname
    `;
    const names = rows.map((r) => r.conname);

    for (const expected of [
      'quote_status_events_type_known',
      'quote_status_events_from_status_known',
      'quote_status_events_to_status_known',
      'sync_runs_outcome_known',
    ]) {
      expect(names, `missing CHECK constraint ${expected}`).toContain(expected);
    }
  });

  /**
   * The credential column is the highest-value target in the schema, so it gets
   * an assertion of its own rather than relying on the general grant check.
   */
  it('constrains api_key_ciphertext to the versioned envelope (T-2-01)', async () => {
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.sm8_connections'::regclass
          AND conname = 'sm8_connections_ciphertext_versioned'
      ) AS exists
    `;

    expect(
      exists,
      'The CHECK that api_key_ciphertext looks like enc:v% is missing. Without it ' +
        'a plaintext key written by a careless code path is indistinguishable ' +
        'from ciphertext at the database level.',
    ).toBe(true);
  });

  /**
   * D-01/D-02: the conversion link, and the direction it points.
   *
   * A NULLABLE column, because a prospect is a sales artefact and most clients
   * are onboarded without one. What matters is that the FK exists at all: the
   * baseline snapshot lives on the prospect record and Phase 7 reaches it
   * THROUGH this column, so without the constraint a tenant could reference a
   * prospect id that no longer exists and the attribution report would silently
   * lose its "before we arrived" number.
   */
  it('links a converted client to its prospect via a nullable FK (D-02)', async () => {
    const [column] = await sql<{ is_nullable: string; data_type: string }[]>`
      SELECT is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenants'
        AND column_name = 'prospect_id'
    `;

    expect(column, 'tenants.prospect_id does not exist').toBeDefined();
    expect(column.data_type).toBe('uuid');
    expect(
      column.is_nullable,
      'tenants.prospect_id must be nullable — most clients never had an audit.',
    ).toBe('YES');

    const [fk] = await sql<{ confdeltype: string; reftable: string }[]>`
      SELECT c.confdeltype, cl.relname AS reftable
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.confrelid
      WHERE c.conrelid = 'public.tenants'::regclass
        AND c.contype = 'f'
        AND c.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.tenants'::regclass AND attname = 'prospect_id')
        ]::smallint[]
    `;

    expect(fk, 'tenants.prospect_id is not a foreign key').toBeDefined();
    expect(fk.reftable).toBe('prospects');
    // 'a' = NO ACTION. Deleting a prospect must not delete a paying client, and
    // SET NULL would silently discard the provenance rather than refusing.
    expect(
      fk.confdeltype,
      'tenants.prospect_id must NOT cascade — deleting a prospect would delete a client.',
    ).toBe('a');
  });

  it('constrains the prospect vocabularies and key envelope (WR-03, T-2-01)', async () => {
    // As with the sync tables, `authenticated` holds no write grant here, so
    // these defend against US: a typo'd `status` written by the service-role
    // audit path is a quote the baseline counts as neither won nor lost,
    // quietly deflating the number handed to a prospect in a sales meeting.
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid IN ('public.prospects'::regclass, 'public.prospect_quote_lines'::regclass)
        AND contype = 'c'
      ORDER BY conname
    `;
    const names = rows.map((r) => r.conname);

    for (const expected of [
      'prospects_source_known',
      'prospects_ciphertext_versioned',
      'prospect_quote_lines_status_known',
      'prospect_quote_lines_source_known',
    ]) {
      expect(names, `missing CHECK constraint ${expected}`).toContain(expected);
    }
  });

  it('constrains the audit-request vocabularies (Phase 9, D-11)', async () => {
    // `authenticated` holds no write grant here either, so these defend against
    // US: a trade or band written outside the closed vocabulary is a request
    // the console renders a blank label for, and a notify outcome outside its
    // vocabulary is a "notify failed" badge that never appears for a request
    // nobody was told about.
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.audit_requests'::regclass AND contype = 'c'
      ORDER BY conname
    `;
    const names = rows.map((r) => r.conname);

    for (const expected of [
      'audit_requests_trade_known',
      'audit_requests_band_known',
      'audit_requests_status_known',
      'audit_requests_notify_known',
    ]) {
      expect(names, `missing CHECK constraint ${expected}`).toContain(expected);
    }
  });

  it('constrains the quotes vocabularies (WR-03)', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.quotes'::regclass AND contype = 'c'
      ORDER BY conname
    `;
    const names = rows.map((r) => r.conname);

    // `authenticated` holds UPDATE on quotes, so without these a curl with a
    // valid operator JWT could write chase_eligibility = 'whatever' — a row that
    // is simultaneously not-chaseable and not-safely-parked depending on which
    // query asks (D-15).
    for (const expected of [
      'quotes_status_known',
      'quotes_chase_eligibility_known',
      'quotes_sync_source_known',
    ]) {
      expect(names, `missing CHECK constraint ${expected}`).toContain(expected);
    }
  });

  it('found the tables it was meant to check — an empty schema would pass vacuously', async () => {
    // Without this, dropping every table would turn the assertion above green.
    const present = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const names = present.map((r) => r.tablename);

    for (const table of [
      'tenants',
      'tenant_members',
      'sm8_connections',
      'quotes',
      'quote_contacts',
      'quote_status_events',
      'sync_runs',
      'operator_allowlist',
      'event_consumer_cursors',
      'prospects',
      'prospect_quote_lines',
      'cadence_touch_templates',
      'cadence_settings',
      'cadences',
      'cadence_touches',
      'send_ledger',
      'suppressed_contacts',
      'inbound_messages',
      'messaging_config',
      'audit_requests',
      'audit_request_throttle',
      // 2026-10 (Phase 12, migration 0039).
      'leads',
      'text_back_templates',
      'tenant_never_text_numbers',
      'operator_alert_log',
    ]) {
      expect(names, `expected table ${table} to exist`).toContain(table);
    }
  });
});

/**
 * WR-13: the platform extensions enabled two phases before anything uses them.
 *
 * `pg_net` gives the database the ability to make arbitrary outbound HTTP
 * requests — a server-side request forgery primitive sitting inside the trust
 * boundary this phase is otherwise careful about — and `pg_cron` can schedule
 * arbitrary SQL. Nothing asserted who may reach either.
 *
 * WHAT THE REVIEW SUGGESTED, AND WHY IT IS NOT WHAT LANDED:
 *
 *   REVOKE ALL ON SCHEMA net FROM anon, authenticated;
 *
 * The `net` schema and its functions are owned by `supabase_admin` (a
 * superuser). Migrations connect as `postgres`, which is NOT that owner and
 * holds no grant option, so this REVOKE does not fail — it emits
 * `WARNING: no privileges could be revoked for "net"` and changes nothing.
 * A migration containing it would report success while leaving the grant intact,
 * which is worse than not having written it.
 *
 * WHAT ACTUALLY HOLDS, AND IS THEREFORE WHAT IS ASSERTED HERE:
 *
 *  1. `cron` and `pgmq` grant no USAGE to anon/authenticated, so their functions
 *     are unreachable by those roles regardless of any EXECUTE grant.
 *  2. anon and authenticated only ever reach this database THROUGH PostgREST,
 *     and PostgREST exposes `public` and `graphql_public` only. `net`, `cron`
 *     and `pgmq` are not exposed, so the primitives are not callable.
 *
 * RESIDUAL, ACCEPTED AND RECORDED: anon and authenticated DO hold USAGE on the
 * `net` schema plus EXECUTE on `net.http_post` / `http_get` / `http_delete`,
 * granted by the platform and not revocable by us. Item 2 is the only thing
 * standing between that and an SSRF primitive. The durable fix is to defer these
 * extensions to the phase that uses them — see src/db/migrations/README.md.
 */
describe('platform extension reachability (WR-13)', () => {
  const anon = createClient(testEnv.url, testEnv.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  it('does not grant anon or authenticated USAGE on the cron or pgmq schemas', async () => {
    const usage = await sql<
      { nspname: string; anon_usage: boolean; auth_usage: boolean }[]
    >`
      SELECT n.nspname,
             has_schema_privilege('anon', n.oid, 'USAGE') AS anon_usage,
             has_schema_privilege('authenticated', n.oid, 'USAGE') AS auth_usage
      FROM pg_namespace n
      WHERE n.nspname IN ('cron', 'pgmq')
      ORDER BY n.nspname
    `;

    for (const row of usage) {
      expect(
        row.anon_usage,
        `anon gained USAGE on schema ${row.nspname} — cron.schedule and the pgmq ` +
          'queue functions become reachable to an unauthenticated role.',
      ).toBe(false);
      expect(
        row.auth_usage,
        `authenticated gained USAGE on schema ${row.nspname}.`,
      ).toBe(false);
    }
  });

  it('exposes only public and graphql_public through PostgREST', async () => {
    // The boundary that actually contains pg_net. If a future config change adds
    // `net` to the exposed schemas, http_post becomes an unauthenticated SSRF
    // endpoint — this is the test that would notice.
    for (const fn of ['http_post', 'http_get', 'http_delete', 'schedule', 'unschedule']) {
      const { error } = await anon.rpc(fn, {});

      expect(error, `anon.rpc('${fn}') was routable — it must not be`).not.toBeNull();
      expect(
        error!.code,
        `anon.rpc('${fn}') failed for a reason other than "no such exposed function"`,
      ).toBe('PGRST202');
    }
  });
});
