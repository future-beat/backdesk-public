/**
 * ONCE-ONLY ALERTING, PROVEN AT THE DATABASE (CON-04, D-09/D-11).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The property is not "the tick sends one email". It is that a SECOND tick  │
 * │ racing the first claims ZERO ROWS — because the guarantee lives in the    │
 * │ UPDATE's `stall_alerted_at IS NULL` predicate with RETURNING, not in      │
 * │ caller discipline. A unit test with a mocked repository would assert the  │
 * │ caller's good behaviour, which is exactly the guarantee 02-04 learned not │
 * │ to accept: "a caller-dependent guarantee is not a guarantee".             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So this suite runs against real Postgres, with real rows, and the named test
 * that matters most is the SECOND claim returning nothing of ours.
 *
 * ── IT RUNS AGAINST THE HOSTED, SHARED DATABASE ────────────────────────────
 *
 * `forAllTenants_claimNewlyStalled` is cross-tenant BY DESIGN — that is the
 * whole point of the accessor — so every assertion here is written as a
 * RELATIVE claim (my touches, in this set) or as a global invariant, never as an
 * absolute count. A run where the founder's own test tenant happens to hold a
 * stalled draft must not turn this file red.
 *
 * It also means the claim writes `stall_alerted_at` on any OTHER stalled touch
 * present at the time. That column is an alert dedupe and nothing else — no
 * status moves, no cadence changes, no message is sent — and the deployed cron
 * ticks are leased-paused for the duration of a remote run by
 * `tests/helpers/global-setup.ts`. Stated here rather than discovered later.
 *
 * NO EMAIL IS EVER SENT: `runCadenceTick` defaults its stall-alert sink to the
 * no-op sender and this suite injects a spy, so the Resend path is unreachable
 * from here by construction rather than by an env check.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runStalledDigest } from '../src/core/aging/stalled-digest';
import { STALL_THRESHOLD_HOURS, isStalled, stallBoundary } from '../src/core/aging/stall-policy';
import {
  buildDailyDigest,
  queueUrl,
  type StalledEmailSender,
} from '../src/core/alerts/stalled-drafts';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import {
  closeDb,
  forAllTenants_claimNewlyStalled,
  forAllTenants_stalledTally,
} from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedLedgerRow,
  seedQuotes,
  seedSuppression,
  seedTenant,
  seedTouches,
  signInAsOperator,
  teardownTenants,
} from './helpers/seed';

const HOUR = 3_600_000;

const tenantIds: string[] = [];

afterAll(async () => {
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

async function newTenant(prefix: string): Promise<string> {
  const id = await seedTenant(prefix);
  tenantIds.push(id);
  await seedConnection(id);
  return id;
}

/** The client's own name, which is the ONE free-text token an alert carries. */
async function nameOf(tenantId: string): Promise<string> {
  const { data, error } = await admin.from('tenants').select('name').eq('id', tenantId).single();
  if (error) throw new Error(`Reading the tenant name failed: ${error.message}`);
  return (data as { name: string }).name;
}

/** One touch on its own cadence, at a chosen slot and status. */
async function seedTouchAt(
  tenantId: string,
  options: { hoursFromNow: number; status?: string },
): Promise<string> {
  const [quote] = await seedQuotes(tenantId, [{ job_description: 'Switchboard upgrade' }]);
  const cadenceId = await seedCadence(tenantId, quote!.id);
  const [touch] = await seedTouches(cadenceId, tenantId, [
    {
      status: options.status ?? 'pending_approval',
      scheduled_at: new Date(Date.now() + options.hoursFromNow * HOUR).toISOString(),
    },
  ]);
  return touch!.id;
}

async function stallAlertedAt(touchId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('cadence_touches')
    .select('stall_alerted_at,status,skip_reason,scheduled_at')
    .eq('id', touchId)
    .single();
  if (error) throw new Error(`Reading the touch failed: ${error.message}`);
  return (data as { stall_alerted_at: string | null }).stall_alerted_at;
}

/** A sender that records what it was asked to send and never leaves the process. */
function spySender(): { send: StalledEmailSender; sent: Array<{ subject: string; body: string }> } {
  const sent: Array<{ subject: string; body: string }> = [];
  return {
    sent,
    send: async (message) => {
      sent.push(message);
      return { ok: true, id: 'spy' };
    },
  };
}

/* ========================================================================= *
 * 1. The claim — once, at the database
 * ========================================================================= */

describe('the guarded claim is the once-only guarantee (D-11)', () => {
  let tenantId = '';
  /** Inside the threshold — must be claimed. */
  let stalled = '';
  /** Already past its slot — the worst case, must also be claimed. */
  let overdue = '';
  /** Outside the threshold — must NOT be claimed. */
  let comfortable = '';
  /** Already approved — not waiting on anybody. */
  let approved = '';

  beforeAll(async () => {
    tenantId = await newTenant('Stall Claim');

    stalled = await seedTouchAt(tenantId, { hoursFromNow: STALL_THRESHOLD_HOURS - 1 });
    overdue = await seedTouchAt(tenantId, { hoursFromNow: -6 });
    comfortable = await seedTouchAt(tenantId, { hoursFromNow: STALL_THRESHOLD_HOURS + 12 });
    approved = await seedTouchAt(tenantId, { hoursFromNow: 1, status: 'approved' });
  });

  it('claims exactly the touches inside the threshold, and nothing else of mine', async () => {
    const now = new Date();
    const boundary = new Date(now.getTime() + STALL_THRESHOLD_HOURS * HOUR);
    const { claimed } = await forAllTenants_claimNewlyStalled({ boundary, at: now });

    const mine = new Set(claimed.map((row) => row.touchId));

    expect(mine.has(stalled)).toBe(true);
    expect(mine.has(overdue)).toBe(true);
    expect(mine.has(comfortable)).toBe(false);
    expect(mine.has(approved)).toBe(false);
  });

  it('SECOND CLAIM RETURNS ZERO OF MINE — the dedupe is the WHERE clause', async () => {
    // The first claim above already flipped these rows. Nothing about this
    // caller is different; the statement simply cannot match them again.
    const now = new Date();
    const boundary = new Date(now.getTime() + STALL_THRESHOLD_HOURS * HOUR);
    const { claimed } = await forAllTenants_claimNewlyStalled({ boundary, at: now });

    const mine = claimed.filter((row) => row.tenantId === tenantId);
    expect(mine).toEqual([]);
  });

  it('stamped the claimed rows and left the others NULL', async () => {
    expect(await stallAlertedAt(stalled)).not.toBeNull();
    expect(await stallAlertedAt(overdue)).not.toBeNull();
    expect(await stallAlertedAt(comfortable)).toBeNull();
    expect(await stallAlertedAt(approved)).toBeNull();
  });

  it('changed NOTHING but that one column — aging observes, it does not act', async () => {
    // The re-window pass is the only schedule authority. An aging pass that
    // also skipped or moved a touch would be a second one, quietly disagreeing.
    const { data } = await admin
      .from('cadence_touches')
      .select('status,skip_reason,scheduled_at')
      .eq('id', overdue)
      .single();

    const row = data as { status: string; skip_reason: string | null; scheduled_at: string };
    expect(row.status).toBe('pending_approval');
    expect(row.skip_reason).toBeNull();
    expect(isStalled({ status: row.status, scheduledAt: new Date(row.scheduled_at) }, new Date()))
      .toBe(true);
  });

  it('names the client it claimed for', async () => {
    // The tally is the email's whole input: a name and an integer.
    const tally = await forAllTenants_stalledTally(new Date(Date.now() + STALL_THRESHOLD_HOURS * HOUR));
    const mine = tally.find((entry) => entry.tenantId === tenantId);

    expect(mine).toBeDefined();
    expect(mine!.tenantName).toContain('Stall Claim');
    // Two of mine are stalled; the digest counts everything still stalled,
    // regardless of whether it has already been alerted about.
    expect(mine!.count).toBe(2);
  });
});

/* ========================================================================= *
 * 2. The 05-04 gap — a needs_draft touch with NO draft row
 * ========================================================================= */

describe('a touch with no draft row still ages and still alerts (D-09, Pitfall 4)', () => {
  let tenantId = '';
  let noDraft = '';

  beforeAll(async () => {
    tenantId = await newTenant('Stall No Draft');
    // `needs_draft`, and deliberately NO `touch_drafts` row — which is exactly
    // what 05-04's deterministic 400/401/403 path leaves behind, because there
    // was no model output to be evidence of. A stall predicate joined to drafts
    // would be blind to precisely this touch.
    noDraft = await seedTouchAt(tenantId, { hoursFromNow: 1, status: 'needs_draft' });
  });

  it('has no draft row at all', async () => {
    const { data, error } = await admin.from('touch_drafts').select('id').eq('touch_id', noDraft);
    if (error) throw new Error(error.message);
    expect(data).toEqual([]);
  });

  it('is claimed and counted anyway', async () => {
    const now = new Date();
    const { claimed, perTenant } = await forAllTenants_claimNewlyStalled({
      boundary: new Date(now.getTime() + STALL_THRESHOLD_HOURS * HOUR),
      at: now,
    });

    expect(claimed.map((row) => row.touchId)).toContain(noDraft);

    const mine = perTenant.find((entry) => entry.tenantId === tenantId);
    expect(mine).toBeDefined();
    expect(mine!.count).toBe(1);
    expect(mine!.tenantName).toContain('Stall No Draft');
  });
});

/* ========================================================================= *
 * 3. The pass inside the tick, and its counts
 * ========================================================================= */

describe('the tick runs the aging pass and enumerates what it did', () => {
  let tenantId = '';

  beforeAll(async () => {
    tenantId = await newTenant('Stall Tick');
    // BOTH SLOTS ARE IN THE FUTURE, deliberately. A full tick runs the D-09/
    // D-10 re-window pass BEFORE the aging pass, and that pass acts on overdue
    // touches — so an overdue fixture here would be moved or retired by the
    // thing under test's own tick, and this test would be asserting the
    // re-window rules by accident. Overdue claiming is proven directly against
    // the accessor in section 1, where nothing else is running.
    await seedTouchAt(tenantId, { hoursFromNow: 2 });
    await seedTouchAt(tenantId, { hoursFromNow: 3, status: 'needs_draft' });
  });

  it('claims, counts and hands ONE covering email to the injected sender', async () => {
    const spy = spySender();

    const result = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      jitterMinutes: () => 0,
      stallAlertSender: spy.send,
    });

    // Relative: the hosted database may hold other newly-stalled touches.
    expect(result.touchesNewlyStalled).toBeGreaterThanOrEqual(2);
    expect(result.stallAlertSent).toBe(1);
    expect(result.stallAlertFailed).toBe(0);

    // ONE email covering every client, not one per client — fifteen emails a
    // minute is the shape D-11 forbids by name.
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0].subject).toMatch(/^\d+ drafts? stalled — send slots at risk$/);
    expect(spy.sent[0].body).toContain('Stall Tick');
    expect(spy.sent[0].body).toContain('Open the queue: ');
    // The closed vocabulary, on a real body built from real rows: no customer
    // name, no job description, no address, no draft text.
    expect(spy.sent[0].body).not.toContain('Switchboard upgrade');
  });

  it('sends nothing on a tick with nothing newly stalled', async () => {
    const spy = spySender();

    const result = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      jitterMinutes: () => 0,
      stallAlertSender: spy.send,
    });

    // Everything of mine was claimed by the run above; the hosted database may
    // still produce one, so the assertion is about the SENDER being consistent
    // with the count rather than about the count being zero.
    if (result.touchesNewlyStalled === 0) {
      expect(spy.sent).toEqual([]);
      expect(result.stallAlertSent).toBe(0);
      expect(result.stallAlertFailed).toBe(0);
    } else {
      expect(spy.sent).toHaveLength(1);
    }
  });
});

/* ========================================================================= *
 * 4. The digest and its route
 * ========================================================================= */

describe('the daily digest (CON-04)', () => {
  let tenantId = '';
  let tenantName = '';

  beforeAll(async () => {
    tenantId = await newTenant('Stall Digest');
    tenantName = await nameOf(tenantId);
    await seedTouchAt(tenantId, { hoursFromNow: 1 });
    await seedTouchAt(tenantId, { hoursFromNow: -30 });
  });

  it('lists everything still stalled, ALREADY-ALERTED ROWS INCLUDED', async () => {
    const now = new Date();
    // Alert on them first — which is what the tick does every minute. A digest
    // filtered on "not yet alerted" would be empty every morning from here on.
    await forAllTenants_claimNewlyStalled({
      boundary: new Date(now.getTime() + STALL_THRESHOLD_HOURS * HOUR),
      at: now,
    });

    const spy = spySender();
    const result = await runStalledDigest({ now, send: spy.send });

    expect(result.touchesStalled).toBeGreaterThanOrEqual(2);
    expect(result.digestSent).toBe(1);
    expect(result.digestFailed).toBe(0);
    expect(result.digestSkippedEmpty).toBe(0);
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0].body).toContain(`${tenantName}: 2`);
  });

  it('hands the sender the BYTE-VERBATIM body the pure builder produces', async () => {
    const now = new Date();
    const spy = spySender();

    // `sections: []` IS THE POINT OF THE OVERRIDE (06-04's own header says so):
    // it isolates the stall half. The default composition now reads the whole
    // shared database for attestation drift AND opt-out rates, so an expected
    // body built from the tally alone could only match on a morning when
    // nobody else's fixtures happened to be drifting. The sections have their
    // own byte assertions — `tests/opt-out-section.test.ts`, and the two tests
    // below.
    await runStalledDigest({ now, send: spy.send, sections: [] });

    const tally = await forAllTenants_stalledTally(
      new Date(now.getTime() + STALL_THRESHOLD_HOURS * HOUR),
    );
    const expected = buildDailyDigest({
      perTenantCounts: tally,
      at: now,
      queueUrl: queueUrl(),
    });

    expect(spy.sent[0].subject).toBe(expected.subject);
    expect(spy.sent[0].body).toBe(expected.body);
  });
});

/* ========================================================================= *
 * 4b. The opt-out line the digest gained in 07-05 (D-16, RPT-03)
 * ========================================================================= */

describe('the opt-out alarm reaches the 06:30 digest and changes nothing (D-16)', () => {
  let tenantId = '';
  let tenantName = '';
  let cadenceId = '';
  /** ACMA fiction range — these rows land on the hosted database. */
  const address = '+61491570158';

  beforeAll(async () => {
    tenantId = await newTenant('Stall Digest OptOut');
    tenantName = await nameOf(tenantId);

    // TEN contacts messaged, ONE opt-out: a rate of 10%, above the 5% alarm AND
    // at the OPT_OUT_ALARM_MIN_CONTACTS floor (quick-260913-ind): an alarm on
    // fewer than ten contacts is noise — one opted-out contact read as 100% and
    // filled the digest every morning — so the fixture must clear the floor for
    // the section to exist at all. Distinct ACMA fiction addresses, one per quote.
    const quotes = await seedQuotes(
      tenantId,
      Array.from({ length: 10 }, (_, i) => ({ job_description: `Hot water swap ${i + 1}` })),
    );
    for (const [i, quote] of quotes.entries()) {
      const id = await seedCadence(tenantId, quote!.id);
      if (i === 0) cadenceId = id;
      await seedLedgerRow(tenantId, {
        cadenceId: id,
        quoteId: quote!.id,
        touchNumber: 1,
        claimedAt: new Date(Date.now() - 2 * 24 * HOUR).toISOString(),
        toAddress: i === 0 ? address : `+6149157010${i}`,
      });
    }
    await seedSuppression(tenantId, [{ channel: 'sms', address }]);

    // Something stalled as well, so the digest has a reason to be sent at all
    // and this suite is testing the SECTION rather than the empty-send rule.
    await seedTouchAt(tenantId, { hoursFromNow: -30 });
  });

  it('carries the heading and this client one line, through the default composition', async () => {
    const now = new Date();
    const spy = spySender();

    // NO `sections` OVERRIDE. This is the production path — the digest reads
    // the metrics itself, which is the seam the whole plan hangs on.
    const result = await runStalledDigest({ now, send: spy.send });

    expect(result.digestSent).toBe(1);
    expect(spy.sent).toHaveLength(1);

    const body = spy.sent[0].body;
    expect(body).toContain('Opt-out rate above 5%:');
    // RELATIVE, never absolute: the hosted database is shared, and another
    // client legitimately being above the threshold must not redden this file.
    expect(body).toContain(`${tenantName}: 10.0% (1 of 10 contacts) in the last 30 days.`);
  });

  it('leaves the cadence, the touch and the suppression exactly as they were', async () => {
    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ THE PROHIBITION, ASSERTED. A metric NAGS — it never pauses, stops or │
    // │ edits a cadence (D-16, Phase 6 D-15). A client past the threshold is │
    // │ a conversation to have, and halting their chase would cost them the  │
    // │ quotes they are still winning.                                       │
    // └──────────────────────────────────────────────────────────────────────┘
    const before = await admin
      .from('cadences')
      .select('status,pause_reason,stop_reason,updated_at')
      .eq('id', cadenceId)
      .single();
    if (before.error) throw before.error;

    const suppressionsBefore = await admin
      .from('suppressed_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    await runStalledDigest({ now: new Date(), send: spySender().send });

    const after = await admin
      .from('cadences')
      .select('status,pause_reason,stop_reason,updated_at')
      .eq('id', cadenceId)
      .single();
    if (after.error) throw after.error;

    const suppressionsAfter = await admin
      .from('suppressed_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    expect(after.data).toEqual(before.data);
    expect(suppressionsAfter.count).toBe(suppressionsBefore.count);
  });
});

/** Source with comments stripped — the established source-assertion idiom. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the stalled-digest route', () => {
  const SOURCE = code('src/app/api/internal/stalled-digest/route.ts');

  it('401s a wrong bearer, with no body detail', async () => {
    const { POST } = await import('../src/app/api/internal/stalled-digest/route');

    const response = await POST(
      new Request('https://example.test/api/internal/stalled-digest', {
        method: 'POST',
        headers: { authorization: 'Bearer not-the-secret-not-even-close-000000' },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    // A body that distinguished "wrong secret" from "no secret" is an oracle.
    expect(await response.text()).toBe('unauthorized');
  });

  it('401s a missing Authorization header the same way', async () => {
    const { POST } = await import('../src/app/api/internal/stalled-digest/route');

    const response = await POST(
      new Request('https://example.test/api/internal/stalled-digest', { method: 'POST' }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorized');
  });

  it('reads its OWN bearer and none of the other five', () => {
    expect(SOURCE).toContain('getServerEnv().STALLED_DIGEST_SECRET');
    for (const other of [
      'CADENCE_TICK_SECRET',
      'SYNC_TICK_SECRET',
      'CLICKSEND_WEBHOOK_SECRET',
      'CLICKSEND_DLR_SECRET',
      'UNSUBSCRIBE_SIGNING_SECRET',
      'MESSAGING_RECONCILE_SECRET',
    ]) {
      expect(SOURCE).not.toContain(other);
    }
  });

  it('compares in constant time', () => {
    expect(SOURCE).toContain('timingSafeEqual');
    expect(SOURCE).not.toMatch(/provided\s*===\s*expected/);
  });

  it('returns COUNTS ONLY, enumerated — never a spread of the result', () => {
    expect(SOURCE).not.toContain('...result');
    const body = SOURCE.slice(SOURCE.indexOf('Response.json({'));
    const fields = [...body.matchAll(/^\s{4}(\w+): result\.(\w+),$/gm)];
    expect(fields.length).toBeGreaterThan(0);
    for (const [, key, source] of fields) {
      expect(key).toBe(source);
    }
    // No client name, no touch id, no provider error string.
    expect(body).not.toMatch(/tenantName|touchId|detail/);
  });
});

/* ========================================================================= *
 * 5. The nav badge's assumption (research A5), asserted rather than assumed
 * ========================================================================= */

describe('the RLS-scoped count equals the service-role count for the operator', () => {
  let tenantA = '';
  let tenantB = '';

  beforeAll(async () => {
    tenantA = await newTenant('Badge Parity A');
    tenantB = await newTenant('Badge Parity B');
    await seedTouchAt(tenantA, { hoursFromNow: 2 });
    await seedTouchAt(tenantA, { hoursFromNow: 40 });
    await seedTouchAt(tenantB, { hoursFromNow: 3, status: 'needs_draft' });
  });

  it('counts the same rows through the caller JWT as through service-role (A5)', async () => {
    // ┌────────────────────────────────────────────────────────────────────┐
    // │ THE NAV BADGE READS THROUGH THE OPERATOR'S OWN JWT, not the         │
    // │ service-role key, because the console layout gates on `getClaims()` │
    // │ — any authenticated user — rather than on `requireOperator()`. That │
    // │ is only a correct badge if the operator is a member of every        │
    // │ tenant, which is what `create_tenant` does today and what this      │
    // │ test pins. If it ever stops being true the badge UNDERCOUNTS, and   │
    // │ the documented fallback is an operator-gated server component —     │
    // │ recorded here, not silently switched to.                            │
    // └────────────────────────────────────────────────────────────────────┘
    const operator = await signInAsOperator();
    const ids = [tenantA, tenantB];

    const scoped = await operator
      .from('cadence_touches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['needs_draft', 'pending_approval'])
      .in('tenant_id', ids);

    const serviceRole = await admin
      .from('cadence_touches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['needs_draft', 'pending_approval'])
      .in('tenant_id', ids);

    expect(scoped.error).toBeNull();
    expect(serviceRole.error).toBeNull();
    expect(scoped.count).toBe(3);
    expect(scoped.count).toBe(serviceRole.count);
  });

  it('the stalled SUBSET agrees too, on the same imported boundary', async () => {
    const operator = await signInAsOperator();
    const boundary = stallBoundary(new Date()).toISOString();

    const scoped = await operator
      .from('cadence_touches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['needs_draft', 'pending_approval'])
      .in('tenant_id', [tenantA, tenantB])
      .lte('scheduled_at', boundary);

    // Two of the three are inside the threshold; the +40h one is not.
    expect(scoped.count).toBe(2);
  });

  it('the layout builds no service-role client (source assertion)', () => {
    const layout = code('src/app/(console)/layout.tsx');

    expect(layout).toContain("from '@/lib/supabase/server'");
    expect(layout).not.toContain('SERVICE_ROLE');
    expect(layout).not.toContain('getDb');
    expect(layout).not.toContain('forAllTenants');
  });

  it('neither surface writes a second threshold literal (source assertion)', () => {
    // The badge, the Drafts column and the alert must colour on ONE rule. A `4`
    // beside a `scheduled_at` comparison is how they stop agreeing.
    for (const path of ['src/app/(console)/layout.tsx', 'src/app/(console)/clients/page.tsx']) {
      const source = code(path);
      expect(source).toContain('stallBoundary');
      expect(source).not.toMatch(/scheduled_at[\s\S]{0,80}\b4\b/);
      expect(source).not.toContain('STALL_THRESHOLD_HOURS *');
    }
  });

  it('the opt-out alarm colours on ONE rule across all three surfaces (07-05)', () => {
    // THE SAME SHAPE, ONE THRESHOLD OVER. The overview badge, the detail badge
    // and the digest heading all derive from `OPT_OUT_ALARM_BP` and fire on
    // `isOptOutAlarming`; a `5` typed into any of them is how an operator comes
    // to read "above 5%" in an email and find no badge on the screen.
    for (const path of [
      'src/app/(console)/reports/page.tsx',
      'src/app/(console)/reports/[client]/page.tsx',
      'src/core/reporting/opt-out-section.ts',
    ]) {
      const source = code(path);
      expect(source, `${path} must reach the alarm through the shared module`).toMatch(
        /isOptOutAlarming|OPT_OUT_ALARM_BP/,
      );
      expect(source, `${path} writes its own threshold`).not.toMatch(/above 5%/);
      expect(source, `${path} writes its own threshold`).not.toMatch(/\b0\.05\b/);
    }
  });

  it('hides the badge at zero and on a read failure (source assertion)', () => {
    const layout = code('src/app/(console)/layout.tsx');

    // A permanent 0 in the chrome of every page trains blindness; a failed read
    // must look the same as zero rather than take the nav down.
    expect(layout).toContain('badge && badge.pending > 0');
    expect(layout).toContain('return null;');
    expect(layout).toContain("badge.stalled > 0 ? 'badge badge--error' : 'badge'");
  });
});

/* ========================================================================= *
 * 6. Source assertions the behavioural tests cannot reach
 * ========================================================================= */

describe('the tick route enumerates the three new fields (T-3-24)', () => {
  const SOURCE = code('src/app/api/internal/cadence-tick/route.ts');

  it('lists them one by one', () => {
    for (const field of ['touchesNewlyStalled', 'stallAlertSent', 'stallAlertFailed']) {
      expect(SOURCE).toContain(`${field}: result.${field},`);
    }
  });

  it('does not spread the result object', () => {
    // The whole reason the fields are typed out. A `...result` would let a
    // field added later ride into `cron.job_run_details` and the Vercel log.
    expect(SOURCE).not.toContain('...result');
  });

  it('injects the REAL sender here rather than defaulting to it in src/core', () => {
    expect(SOURCE).toContain('stallAlertSender: resendStalledEmailSender');
    const tick = code('src/core/cadence/run-tick.ts');
    expect(tick).toContain('stallAlertSender = noopStalledEmailSender');
    expect(tick).not.toContain('resendStalledEmailSender');
  });
});
