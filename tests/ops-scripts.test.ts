import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* ------------------------------------------------------------------------- *
 * The Phase 10 ops scripts — their contracts, as a test
 *
 * Four read-only probes exist so that every step of the go-live runbook names
 * an artefact a repeatable, server-side, secret-free read produces (D-10). Each
 * of them is run by hand, against PRODUCTION, by an operator who then pastes
 * the output into `docs/external-registrations.md`. That is the whole threat:
 * the output is archived, so anything a script prints is printed forever, and
 * the scripts hold the migration credentials and two provider keys while they
 * do it.
 *
 * None of those properties are testable by running the scripts — running them
 * requires the credentials and reaches the real systems. They ARE testable by
 * reading the committed source, which is what `tests/cron-status-script.test.ts`
 * established for `scripts/cron-status.mjs` in Phase 9 and what this suite does
 * for the four Phase 10 additions. A source-level pin needs no database and no
 * `ALLOW_REMOTE_TESTS`, so it runs on a bare `npm test` — which is the only
 * reason these rules are enforced at all rather than merely written down.
 *
 * Three rules, restated once so the per-script blocks below can be terse:
 *
 *   T-10-08  no credential and no connection URL may reach the output
 *   T-10-09  no customer address and no message body may reach the output
 *   T-10-10  no script may write: SELECT-only SQL, GET-only provider calls
 * ------------------------------------------------------------------------- */

/**
 * Source with comments stripped, for every rule below.
 *
 * Each of these files has a header whose job is to explain what it refuses to
 * print — and it can only do that by naming those things. A rule that read the
 * comments would be satisfiable by deleting the explanation, which is the
 * opposite of what it is for.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Every single-quoted literal that is a path (starts with `/`). */
function pathLiterals(source: string): string[] {
  return (source.match(/'\/[^']*'/g) ?? []).map((s) => s.slice(1, -1));
}

describe('scripts/clicksend-balance.mjs — one GET, one line, no credentials', () => {
  const CODE = code('scripts/clicksend-balance.mjs');

  it('requests exactly one provider path, and that path is /account', () => {
    // The balance check is a pre-arm runbook step (D-10): the first live SMS of
    // Phase 9 failed with INSUFFICIENT_CREDIT, which is a fact that was knowable
    // before the send and is now read before arming. One endpoint answers it.
    expect(pathLiterals(CODE)).toEqual(['/account']);

    const fetches = CODE.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(CODE).toMatch(/method:\s*'GET'|method:\s*"GET"/);
  });

  it('never writes to the provider — no write verb appears anywhere', () => {
    // `setup-clicksend.mjs` is the only script that may change the ClickSend
    // account, and it announces every write. This one is a read an operator
    // runs while nervous, minutes before arming; it must be incapable of
    // changing the thing it is measuring.
    expect(CODE).not.toMatch(/['"](POST|PUT|PATCH|DELETE)['"]/);
  });

  it('never prints a credential, the Authorization header or a URL', () => {
    // T-10-08. The output of this script is pasted into an evidence log.
    expect(CODE).not.toMatch(
      /console\.\w+\([^)]*\b(CLICKSEND_USERNAME|CLICKSEND_API_KEY|AUTHORIZATION|API_BASE)\b/,
    );
    expect(CODE).not.toMatch(
      /fail\([^)]*\b(CLICKSEND_USERNAME|CLICKSEND_API_KEY|AUTHORIZATION|API_BASE)\b/,
    );
    // A fetch rejection stringifies to a message carrying the request URL, and
    // that URL belongs to our credentials' account. `e.name` only.
    expect(CODE).toMatch(/e instanceof Error \? e\.name : /);
    expect(CODE).not.toMatch(/e\.message|error\.message/);
  });

  it('fails on a non-200 naming the status and nothing else', () => {
    expect(CODE).toMatch(/status !== 200/);
    expect(CODE).toContain('returned ${status}');
    // Not the body: a ClickSend error body can echo the request, and the
    // request was authorised by a header built from the API key.
    expect(CODE).not.toMatch(/fail\([^)]*\bbody\b/);
  });

  it('prints the balance line and nothing resembling a row of data', () => {
    expect(CODE).toContain('clicksend balance:');
    expect(CODE).not.toMatch(/JSON\.stringify\(\s*body\s*\)/);
    expect(CODE).not.toMatch(/SELECT \*/i);
  });
});

/**
 * The two rules both database probes obey, asserted once.
 *
 * Both were written from the `scripts/audit-requests-count.mjs` shell, and both
 * inherit the CR-01 lesson it carries: an uncaught `new URL()` throw prints
 * `ERR_INVALID_URL` with an `input:` property holding the string it could not
 * parse — here the production connection string, password included. A malformed
 * value is what an operator HAS while editing the env file, which is exactly
 * when they run a script to see whether it is fixed.
 */
function expectReadOnlyDbScript(CODE: string): void {
  // T-10-10 — no statement that could change production.
  expect(CODE).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|REVOKE)\b/i);
  // An explicit select list is what keeps a column nobody thought about out of
  // an evidence log. `SELECT *` is how a customer's mobile number gets there.
  expect(CODE).not.toMatch(/SELECT \*/i);

  // CR-01.
  expect(CODE).toMatch(/try \{\s*\n\s*new URL\(url\);\s*\n\s*\} catch \{/);
  expect(CODE).toContain('MIGRATE_DATABASE_URL is not a parseable URL');
  expect(CODE).not.toMatch(/console\.\w+\([^)]*\burl\b/);
  expect(CODE).not.toMatch(/fail\([^)]*\$\{url\}/);

  // Both arms close the pool: a script that leaves a connection open on the
  // failure path is one an operator runs three times in a row while debugging.
  expect((CODE.match(/sql\.end\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
}

describe('scripts/escalations-recent.mjs — the CON-03 artefact, with nobody in it', () => {
  const CODE = code('scripts/escalations-recent.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('selects the eight evidence columns and neither the recipient nor the body', () => {
    // The escalation row's `to_address` is the TRADIE's mobile (schema header) —
    // not a customer's, but still a handset number, and this output is pasted
    // into `docs/external-registrations.md`. `body_segments` is a cost figure
    // that says nothing about whether the escalation worked. T-10-09.
    for (const column of [
      'inbound_message_id',
      'tenant_id',
      'cadence_id',
      'outcome',
      'sent_at',
      'provider_message_id',
      'created_at',
    ]) {
      expect(CODE).toContain(column);
    }
    expect(CODE).not.toMatch(/to_address|body_segments/);
  });

  it('validates --tenant as a uuid BEFORE it reaches the query', () => {
    expect(CODE).toMatch(/const UUID = \/\^\[0-9a-f\]\{8\}-/);
    expect(CODE).toMatch(/UUID\.test\(/);
    expect(CODE).not.toMatch(/sql\.unsafe/);
    // Ordering, not just presence: a validation that runs after the statement
    // is built is decoration.
    expect(CODE.indexOf('UUID.test(')).toBeLessThan(CODE.indexOf('sql`'));
  });

  it('defaults --limit to 10 and refuses anything outside 1..50', () => {
    expect(CODE).toMatch(/limit < 1 \|\| limit > 50/);
    expect(CODE).toContain('LIMIT ${limit}');
  });

  it('orders newest first, deterministically', () => {
    // `created_at` alone ties for rows written inside the same transaction, and
    // a runbook step that copies "the top row" needs the top row to be stable.
    expect((CODE.match(/ORDER BY created_at DESC, id DESC/g) ?? [])).toHaveLength(1);
  });
});

describe('scripts/cadence-status.mjs — status and suppression, never an address', () => {
  const CODE = code('scripts/cadence-status.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('computes both suppression facts with EXISTS rather than fetching addresses', () => {
    // The question is "is this contact blocked", which is a boolean. Selecting
    // the address to compare it in JavaScript would put a customer's mobile
    // number into this process — and one `console.log` later, into the log.
    expect((CODE.match(/EXISTS/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(CODE).toContain('sms_suppressed');
    expect(CODE).toContain('email_suppressed');
  });

  it('touches the snapshot address columns ONLY inside the SQL predicates', () => {
    for (const column of ['contact_mobile', 'contact_email']) {
      const all = CODE.match(new RegExp(column, 'g')) ?? [];
      const qualified = CODE.match(new RegExp(`c\\.${column}`, 'g')) ?? [];
      expect(all).toHaveLength(qualified.length);
      expect(qualified.length).toBe(1);
    }
    expect(CODE).not.toMatch(/contactMobile|contactEmail/);
    expect(CODE).not.toMatch(/console\.\w+\([^)]*contact_/);
  });

  it('requires --cadence as a uuid and has a not-found arm', () => {
    expect(CODE).toMatch(/const UUID = \/\^\[0-9a-f\]\{8\}-/);
    expect(CODE.indexOf('UUID.test(')).toBeLessThan(CODE.indexOf('sql`'));
    expect(CODE).toContain('cadence: not found');
  });
});

describe('src/core/messaging/resend-emails.ts — delivery evidence, nothing else', () => {
  const CODE = code('src/core/messaging/resend-emails.ts');

  it('returns the error NAME and never a provider message', () => {
    // operator-email.ts rule 3, inherited: Resend's `name` IS the
    // classification, and the message adds prose plus the risk that some
    // version of it echoes the request — which on this endpoint names an email
    // id and, in the response, a customer's address.
    expect(CODE).toMatch(/error\.name/);
    expect(CODE).not.toMatch(/error\.message|e\.message/);
    expect(CODE).toMatch(/catch \(e\)/);
  });

  it('never returns the subject, the html or the text of a real email', () => {
    // `GET /emails/{id}` returns the whole message — subject, html and text
    // included. This wrapper's callers are a server action that writes a proof
    // row and a script whose output is archived. Neither has any use for the
    // body, and both would put it somewhere permanent.
    expect(CODE).not.toMatch(/data\.(subject|html|text)\b/);
    expect(CODE).not.toMatch(/\bsubject:|\bhtml:|\btext:/);
  });

  it('reduces the recipient to a domain and bounds last_event', () => {
    expect(CODE).toContain('domainOfAddress');
    expect(CODE).toContain('toDomain');
    expect(CODE).toMatch(/\[a-z_\]\{1,32\}/);
  });

  it('decides "delivered" ONCE, here, and counts the post-delivery events (WR-02)', () => {
    // `last_event` is the LATEST event, not the furthest point reached: a
    // message delivered and then opened reads `opened`. Two callers comparing
    // it themselves is two chances to refuse a proof for an email that arrived
    // — which D-07's own sequence produces, since the operator opens it.
    expect(CODE).toContain('DELIVERED_EVENTS');
    expect(CODE).toMatch(/new Set\(\['delivered', 'opened', 'clicked'\]\)/);
    expect(CODE).toContain('delivered: DELIVERED_EVENTS.has(lastEvent)');
    // And the answers that must still stop a go-live are NOT in the set.
    for (const refused of ['bounced', 'complained', 'delivery_delayed', 'sent', 'queued']) {
      expect(CODE).not.toMatch(new RegExp(`DELIVERED_EVENTS[^\\n]*${refused}`));
    }
  });

  it('surfaces the SENDER, so a caller can tell whose email it is (CR-01)', () => {
    // The one field of this response that names a client. Without it the proof
    // action has no tenant scoping at all — the account is shared by every
    // founding client, the operator alerts and the audit pipeline.
    expect(CODE).toContain('fromAddress');
    expect(CODE).toContain('bareAddress(data.from)');
  });

  it('reads only — this module cannot send, cancel or update an email', () => {
    expect(CODE).not.toMatch(/emails\.(send|create|update|cancel)/);
  });
});

describe('scripts/resend-email-status.mjs — last_event, pollable by exit code', () => {
  const CODE = code('scripts/resend-email-status.mjs');

  it('prints the delivery fact and the recipient DOMAIN only', () => {
    expect(CODE).toContain('last_event=');
    expect(CODE).toContain('to_domain=');
    // Not the message, and not the address it went to.
    expect(CODE).not.toMatch(/\b(subject|html|body)\b/);
  });

  it('exits 2 when the message did not reach the recipient', () => {
    // A runbook step re-polls this: Resend's delivery event lands seconds to
    // minutes after the send, so "not delivered YET" must be distinguishable
    // from "the read failed" (exit 1) by a shell that is looping on it.
    //
    // AND THE PREDICATE IS THE WRAPPER'S (WR-02). A second comparison against
    // `last_event` here is how `opened` — which the D-07 sequence itself
    // produces — becomes exit 2 on an email the operator just read.
    expect(CODE).toContain('status.delivered');
    expect(CODE).not.toMatch(/lastEvent\s*===/);
    expect(CODE).toMatch(/process\.exit\(2\)/);
  });

  it('validates the email id before it reaches the provider', () => {
    expect(CODE).toMatch(/\^\[0-9a-f-\]\{20,64\}\$/);
  });

  it('and the PROOF ACTION validates with the same pattern (WR-03)', () => {
    // Two readers of the same paste, and both hand it to `emails.get`, which
    // interpolates it into `GET /emails/{id}` unencoded. An id this script
    // takes and the form refuses is a mid-go-live dead end; an id the form
    // takes and this script refuses is the same dead end from the other side.
    const ACTION = code('src/app/(console)/clients/[id]/actions.ts');
    expect(ACTION).toMatch(/\^\[0-9a-f-\]\{20,64\}\$/);
    // And BEFORE the read, not after it.
    expect(ACTION.indexOf('RESEND_ID_PATTERN.test(')).toBeLessThan(
      ACTION.indexOf('await getEmailStatus('),
    );
  });

  it('goes through the shared wrapper rather than calling Resend itself', () => {
    // One spelling of "what does delivered mean" — the proof action (plan 05)
    // and this script must not be able to disagree.
    expect(CODE).toContain('@/core/messaging/resend-emails');
    expect(CODE).toContain('getEmailStatus');
    expect(CODE).not.toMatch(/fetch\(|new Resend\(/);
  });
});

describe('scripts/resend-recent-sends.mjs — a list read that names no recipient', () => {
  const CODE = code('scripts/resend-recent-sends.mjs');

  it('makes exactly one request, and it is a GET', () => {
    // T-10-10. This probe exists to answer "which of our senders produced that
    // email", which is a read. An operator runs it minutes after a cron tick
    // to check what went out; it must be incapable of changing anything.
    expect((CODE.match(/fetch\(/g) ?? [])).toHaveLength(1);
    expect(CODE).toMatch(/method:\s*'GET'|method:\s*"GET"/);
    expect(CODE).not.toMatch(/['"](POST|PUT|PATCH|DELETE)['"]/);
  });

  it('reads the LIST endpoint and never the message behind it', () => {
    // `GET /emails/{id}` returns the whole message — subject, html and text.
    // The list does not, and this script must not reach for it: the output is
    // pasted into an evidence log, and a body there is permanent.
    expect(CODE).toContain('api.resend.com/emails?limit=');
    expect(CODE).not.toMatch(/emails\/\$\{/);
    expect(CODE).not.toMatch(/\bhtml\b|\.text\b/);
  });

  it('loads the key through the shared loader and never prints it', () => {
    // ONB-05. The key reaches exactly one place — the Authorization header.
    expect(CODE).toContain('loadEnv()');
    expect(CODE).toContain("requireEnv('RESEND_API_KEY')");
    expect(CODE).not.toMatch(/console\.\w+\([^)]*\b(RESEND_API_KEY|Authorization|Bearer)\b/);
    expect((CODE.match(/RESEND_API_KEY/g) ?? [])).toHaveLength(2);

    // A fetch rejection stringifies to a message carrying the request URL, and
    // an unhandled one prints a stack containing it (CR-01). `e.name` only.
    expect(CODE).toMatch(/e instanceof Error \? e\.name : /);
    expect(CODE).not.toMatch(/e\.message|error\.message/);
  });

  it('prints the recipient DOMAIN and nothing that could be an address', () => {
    // T-10-09, and structurally: the `to` field is reduced by `domainOf`
    // BEFORE it reaches a template. No line may interpolate a recipient whole.
    expect(CODE).toContain('to_domain=');
    expect(CODE).toContain('domainOf');
    expect(CODE).not.toMatch(/console\.\w+\([^)]*\brow\.to\b/);
    expect(CODE).not.toMatch(/\$\{row\.to\}|\$\{recipients\}|\$\{to\}/);
    expect(CODE).not.toMatch(/\bto=\$\{/);
  });

  it('bounds the subject rather than trusting it', () => {
    // The subject is the only variable-length field printed and the only
    // reason to run the script — "Daily digest" is a subject. Every subject
    // this account sends today is a fixed phrase plus a CLIENT's business
    // name, which is a sentence about today's templates, not a property of
    // this script. So an address-shaped substring is redacted and the length
    // is capped here, where it cannot be forgotten upstream.
    expect(CODE).toContain('safeSubject');
    expect(CODE).toContain('[redacted]');
    expect(CODE).toMatch(/\.slice\(0, 80\)/);
  });

  it('clamps the limit on BOTH sides before it reaches the provider', () => {
    // `Number('-5')` is a number. A negative limit is a query parameter nobody
    // tested, sent by an operator who fat-fingered a flag.
    expect(CODE).toMatch(/Math\.max\(1, Math\.min\(/);
  });

  it('is reachable by the alias the runbook and the SUMMARY name', () => {
    // The owed check after this quick task is `npm run resend:recent-sends --
    // 5` run after 22:31 UTC. An alias that does not exist is a proof step
    // that silently never happens.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['resend:recent-sends']).toBe('node scripts/resend-recent-sends.mjs');
  });
});

describe('scripts/verify-email-pipe.mjs — the --cadence branch is opt-in and loud', () => {
  const CODE = code('scripts/verify-email-pipe.mjs');

  it('keeps the default link inert', () => {
    // Without --cadence the token is minted over a random uuid, so the POST
    // resolves to `no_cadence` and writes nothing. That default is the whole
    // reason the proof can be run against any address without consequences.
    expect((CODE.match(/randomUUID\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('announces the blast radius before anything is sent (T-10-11)', () => {
    expect(
      (CODE.match(/THIS LINK SUPPRESSES A REAL CONTACT ON BOTH CHANNELS/g) ?? []),
    ).toHaveLength(1);
  });

  it('looks the cadence up exactly once, inside the branch', () => {
    expect((CODE.match(/cadences\.getById\(/g) ?? [])).toHaveLength(1);
    expect(CODE.indexOf('if (CADENCE_ID)')).toBeLessThan(CODE.indexOf('cadences.getById('));
  });

  it('validates the cadence BEFORE resolving an identity and before sending', () => {
    // Ordering is the property, not presence. A check that runs after the send
    // has been made is a comment. The refusal must happen while nothing has
    // left the building — which is also why the fictional-cadence acceptance
    // run is safe to execute against production.
    const lookup = CODE.indexOf('cadences.getById(');
    expect(lookup).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(CODE.indexOf('await resolveEmailIdentity('));
    expect(lookup).toBeLessThan(CODE.indexOf('sender.send('));
  });

  it('prints the exact one-click POST command the runbook runs', () => {
    expect(CODE).toContain('one-click POST:');
    expect(CODE).toContain('List-Unsubscribe=One-Click');
  });
});

/* ------------------------------------------------------------------------- *
 * The Phase 11 telephony instruments (plan 11-06)
 *
 * Same three rules as above, restated for a new kind of data: a caller's
 * number is personal information about somebody who never agreed to be in an
 * evidence log (T-11-04), the Twilio pair buys numbers (T-11-14), and nothing
 * here may write to Twilio at all (CAP-01 — the purchase is a console action).
 * ------------------------------------------------------------------------- */

describe('scripts/twilio-numbers-search.mjs — one GET through the Sydney edge, nothing bought', () => {
  const CODE = code('scripts/twilio-numbers-search.mjs');

  it('requests exactly one provider path, and that path is the AU local search', () => {
    expect(pathLiterals(CODE)).toEqual(['/AvailablePhoneNumbers/AU/Local.json']);
    expect(CODE.match(/fetch\(/g) ?? []).toHaveLength(1);
    expect(CODE).toMatch(/method:\s*'GET'/);
    // `InLocality` is the one global filter; `AreaCode` / `InRegion` are US/CA.
    expect(CODE).toContain('InLocality=');
    expect(CODE).not.toMatch(/AreaCode|InRegion/);
  });

  it('reaches the Sydney edge of the US1 region, like the REST client (D-10)', () => {
    expect(CODE).toContain('https://api.sydney.us1.twilio.com/2010-04-01');
    expect(CODE).not.toMatch(/api\.twilio\.com|\.au1\./);
  });

  it('never writes to Twilio — no write verb, no purchase resource', () => {
    // CAP-01: the purchase happens only from the console, claim-then-buy. A
    // script that could buy a number is one that can buy it twice.
    expect(CODE).not.toMatch(/['"](POST|PUT|PATCH|DELETE)['"]/);
    expect(CODE).not.toMatch(/IncomingPhoneNumbers/);
  });

  it('never prints a credential, the Authorization header or a URL', () => {
    expect(CODE).not.toMatch(
      /console\.\w+\([^)]*\b(TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|AUTHORIZATION|API_BASE)\b/,
    );
    expect(CODE).not.toMatch(
      /fail\([^)]*\b(TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|AUTHORIZATION|API_BASE)\b/,
    );
    // The header is built inside the fetch call and never bound to a name that
    // a later console line could reach.
    expect(CODE).not.toMatch(/const AUTHORIZATION/);
    expect(CODE).toMatch(/e instanceof Error \? e\.name : /);
    expect(CODE).not.toMatch(/e\.message|error\.message/);
  });

  it('fails on a non-200 naming the status and never the body', () => {
    expect(CODE).toMatch(/status !== 200/);
    expect(CODE).toContain('returned ${status}');
    expect(CODE).not.toMatch(/fail\([^)]*\bbody\b/);
    expect(CODE).not.toMatch(/JSON\.stringify\(/);
  });

  it('validates --locality before the request and exits 2 on an empty page', () => {
    expect(CODE.indexOf('--locality must be')).toBeGreaterThan(-1);
    expect(CODE.indexOf('--locality must be')).toBeLessThan(CODE.indexOf('fetch('));
    expect(CODE).toContain('twilio numbers search: none for ${locality}');
    expect(CODE).toContain('process.exit(2)');
  });
});

describe('scripts/missed-calls-recent.mjs — the CAP-03 evidence, with nobody\'s number in it', () => {
  const CODE = code('scripts/missed-calls-recent.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('touches the two number columns ONLY inside an IS NOT NULL boolean', () => {
    // T-11-04. The number never leaves the database, so no later console line
    // can print it. Each column appears once, and only in that shape.
    for (const column of ['caller_e164', 'forwarded_from_raw']) {
      expect(CODE).not.toMatch(new RegExp(`${column}(?! IS NOT NULL\\))`));
      expect(CODE.match(new RegExp(column, 'g')) ?? []).toHaveLength(1);
    }
    expect(CODE).toContain('(caller_e164 IS NOT NULL) AS caller_present');
    expect(CODE).toContain('(forwarded_from_raw IS NOT NULL) AS forwarded_from_present');
  });

  it('never names the raw From or the dead-letter payload column at all', () => {
    expect(CODE).not.toMatch(/caller_raw|raw_payload|callerRaw|rawPayload/);
    expect(CODE).not.toMatch(/callerE164|forwardedFromRaw/);
  });

  it('validates --tenant and --limit BEFORE the statement is built', () => {
    expect(CODE).toMatch(/const UUID = \/\^\[0-9a-f\]\{8\}-/);
    expect(CODE).not.toMatch(/sql\.unsafe/);
    const statement = CODE.indexOf('sql`');
    expect(statement).toBeGreaterThan(-1);
    expect(CODE.indexOf('UUID.test(')).toBeLessThan(statement);
    expect(CODE.indexOf('limit < 1 || limit > 50')).toBeGreaterThan(-1);
    expect(CODE.indexOf('limit < 1 || limit > 50')).toBeLessThan(statement);
    expect(CODE).toContain('LIMIT ${limit}');
  });

  it('orders newest first, deterministically, and says so when empty', () => {
    expect(CODE.match(/ORDER BY started_at DESC, id DESC/g) ?? []).toHaveLength(1);
    expect(CODE).toContain('missed calls: none');
  });
});

describe('scripts/missed-calls-invariants.mjs — the IN-04 pre-flight, four counts and no row', () => {
  const CODE = code('scripts/missed-calls-invariants.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('prints exactly the four counts the 0039 CHECK decision reads', () => {
    for (const name of [
      'total',
      'withheld_number_mismatch',
      'withheld_flag_mismatch',
      'dead_letter_tenant_mismatch',
    ]) {
      expect(CODE).toContain(`console.log(\`${name}=\${row.${name}}\`)`);
    }
    expect(CODE.match(/console\.log\(/g) ?? []).toHaveLength(4);
  });

  it('aggregates inside the database: the number columns appear only inside a NULL test', () => {
    // T-11-04. No row, no id, no number crosses into this process.
    expect(CODE).not.toMatch(/caller_e164(?! IS NULL\))/);
    expect(CODE).not.toMatch(/caller_raw|raw_payload|forwarded_from_raw/);
    expect(CODE).not.toMatch(/\bid,|tenant_id,/);
    expect(CODE.match(/count\(\*\)/g) ?? []).toHaveLength(4);
  });
});

describe('scripts/lead-cadence-invariants.mjs — the 0040 pre-flight, six counts and no row', () => {
  // 2026-10 (Phase 13, 13-07): the pre-flight and read-back the push protocol reads.
  const CODE = code('scripts/lead-cadence-invariants.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('prints exactly the six lines the 0040 push protocol reads', () => {
    for (const name of [
      'leads_total',
      'lead_cadences_total',
      'inbound_lead_rows',
      'message_templates_total',
      'text_back_armed_tenants',
      'schema_0040_applied',
    ]) {
      expect(CODE).toContain(`console.log(\`${name}=\${row.${name}}\`)`);
    }
    expect(CODE.match(/console\.log\(/g) ?? []).toHaveLength(6);
  });

  it('aggregates inside the database: no row, no id, no number crosses into this process', () => {
    // T-13-15.
    expect(CODE).not.toMatch(/contact_mobile|caller_e164|caller_raw|from_address|to_address|raw_payload/);
    expect(CODE).not.toMatch(/\bbody\b/);
    expect(CODE).not.toMatch(/\bid,|tenant_id,/);
    expect(CODE.match(/count\(/g) ?? []).toHaveLength(5);
    // One statement.
    expect(CODE.match(/sql`/g) ?? []).toHaveLength(1);
  });

  it('probes the catalogue for the column 0040 adds', () => {
    expect(CODE).toContain('FROM information_schema.columns');
    expect(CODE).toContain("AND table_name = 'tenants'");
    expect(CODE).toContain("AND column_name = 'after_hours_escalation'");
  });
});

describe('scripts/lead-jobs-invariants.mjs — the 0041 pre-flight, six counts and no row', () => {
  // 2026-10 (Phase 14, 14-05): the pre-flight and read-back the push protocol reads.
  const CODE = code('scripts/lead-jobs-invariants.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('prints exactly the six lines the 0041 push protocol reads', () => {
    for (const name of [
      'leads_total',
      'leads_converted',
      'quotes_source_lead',
      'escalations_lead_sent',
      'text_back_armed_tenants',
      'schema_0041_applied',
    ]) {
      expect(CODE).toContain(`console.log(\`${name}=\${row.${name}}\`)`);
    }
    expect(CODE.match(/console\.log\(/g) ?? []).toHaveLength(6);
  });

  it('aggregates inside the database: no row, no id, no number crosses into this process', () => {
    // T-14-09.
    expect(CODE).not.toMatch(/contact_mobile|caller_e164|caller_raw|from_address|to_address|raw_payload/);
    expect(CODE).not.toMatch(/\bbody\b/);
    expect(CODE).not.toMatch(/\bid,|tenant_id,|sm8_job_uuid|sm8_company_uuid/);
    expect(CODE.match(/count\(/g) ?? []).toHaveLength(5);
    // One statement.
    expect(CODE.match(/sql`/g) ?? []).toHaveLength(1);
  });

  it('counts the two values the plain 0041 CHECKs assume are absent', () => {
    expect(CODE).toContain("FROM leads WHERE status = 'converted'");
    expect(CODE).toContain("FROM quotes WHERE sync_source = 'lead'");
  });

  it('probes the catalogue for the column 0041 adds', () => {
    expect(CODE).toContain('FROM information_schema.columns');
    expect(CODE).toContain("AND table_name = 'leads'");
    expect(CODE).toContain("AND column_name = 'sm8_job_state'");
  });
});

describe('scripts/lead-privacy-invariants.mjs — the 0042 pre-flight, six counts and no row', () => {
  // 2026-10 (Phase 15, 15-08): the pre-flight and read-back the push protocol
  // reads, and the count of rows the pass's first run would hash.
  const CODE = code('scripts/lead-privacy-invariants.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('prints exactly the six lines the 0042 push protocol reads', () => {
    for (const name of [
      'leads_total',
      'leads_closed_past_boundary',
      'missed_calls_total',
      'missed_calls_no_lead_past_boundary',
      'suppressed_contacts_total',
      'schema_0042_applied',
    ]) {
      expect(CODE).toContain(`console.log(\`${name}=\${row.${name}}\`)`);
    }
    expect(CODE.match(/console\.log\(/g) ?? []).toHaveLength(6);
  });

  it('aggregates inside the database: no row, no id, no number crosses into this process', () => {
    // T-14-09, restated for the pass that hashes caller numbers.
    expect(CODE).not.toMatch(/contact_mobile|caller_e164|caller_raw|from_address|to_address|raw_payload/);
    expect(CODE).not.toMatch(/\bbody\b/);
    expect(CODE).not.toMatch(/\bid,|tenant_id,|sm8_job_uuid|sm8_company_uuid|caller_hash/);
    expect(CODE.match(/count\(/g) ?? []).toHaveLength(5);
    // One statement.
    expect(CODE.match(/sql`/g) ?? []).toHaveLength(1);
  });

  it('counts exactly the rows the first nightly pass would hash, at the 90-day boundary', () => {
    // PSEUDONYMISE_AFTER_DAYS (pinned at 90 by tests/pseudonymise-structure.test.ts).
    expect(CODE.match(/interval '90 days'/g) ?? []).toHaveLength(2);
    expect(CODE).toContain("WHERE status IN ('closed', 'expired')");
    expect(CODE).toContain("AND closed_at <= now() - interval '90 days'");
    expect(CODE).toContain('WHERE tenant_id IS NOT NULL');
    expect(CODE).toContain('AND lead_id IS NULL');
    expect(CODE).toContain("AND started_at <= now() - interval '90 days'");
    expect(CODE).toContain('FROM suppressed_contacts');
  });

  it('the two past-boundary counts take UNSTAMPED rows only — the backlog (15-REVIEW WR-08)', () => {
    // After the first live hash, a count of every row past the boundary would
    // read as a permanent backlog; the stamp clause makes it what is still due.
    expect(CODE).toMatch(
      /closed_at <= now\(\) - interval '90 days'\s*AND pseudonymised_at IS NULL\s*\) AS leads_closed_past_boundary/,
    );
    expect(CODE).toMatch(
      /started_at <= now\(\) - interval '90 days'\s*AND pseudonymised_at IS NULL\s*\) AS missed_calls_no_lead_past_boundary/,
    );
    expect(CODE.match(/pseudonymised_at IS NULL/g) ?? []).toHaveLength(2);
  });

  it('probes the catalogue for the column 0042 adds', () => {
    expect(CODE).toContain('FROM information_schema.columns');
    expect(CODE).toContain("AND table_name = 'leads'");
    expect(CODE).toContain("AND column_name = 'pseudonymised_at'");
  });
});

describe('scripts/verify-missed-call-reconcile.mjs — the real core, once, loudly', () => {
  const CODE = code('scripts/verify-missed-call-reconcile.mjs');

  it('imports the production reconcile through the alias hook', () => {
    expect(CODE.match(/register\(/g) ?? []).toHaveLength(1);
    expect(CODE).toContain("register('./lib/ts-alias-hook.mjs', import.meta.url)");
    expect(CODE).toContain("import('../src/core/telephony/reconcile.ts')");
    expect(CODE).toContain('reconcileMissedCalls()');
  });

  it('announces the production write before anything is loaded', () => {
    const notice = CODE.indexOf('the hosted Sydney database is production');
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(CODE.indexOf("import('../src/core/telephony/reconcile.ts')"));
  });

  it('has no SQL of its own — it may only call the core', () => {
    expect(CODE).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|SELECT)\b/);
    expect(CODE).not.toMatch(/from 'postgres'|sql`/);
  });

  it('prints counts only — the S7 line and the three result numbers', () => {
    expect(CODE).toContain('calls listed (inbound, 48h)');
    expect(CODE).toContain('listed.items.length');
    expect(CODE).toMatch(/recovered=\$\{result\.missedCallsRecovered\}/);
    // The call list carries callers' numbers: nothing but its length is read.
    expect(CODE).not.toMatch(/items\[|items\.map|\.from\b|forwardedFrom/);
    expect(CODE).toMatch(/e instanceof Error \? e\.name : /);
    expect(CODE).not.toMatch(/e\.message|error\.message/);
  });

  it('closes the pool', () => {
    expect(CODE).toContain('closeDb()');
  });
});

describe('scripts/text-back-timing.mjs — the S4 evidence and the arming read-back, no number (D-14)', () => {
  const CODE = code('scripts/text-back-timing.mjs');

  it('is read-only and never echoes the connection string', () => {
    expectReadOnlyDbScript(CODE);
  });

  it('touches the two number columns ONLY inside an IS NOT NULL boolean', () => {
    // T-12-07. As in the missed-calls reader: the number never leaves the database.
    for (const column of ['caller_e164', 'forwarded_from_raw']) {
      expect(CODE).not.toMatch(new RegExp(`${column}(?! IS NOT NULL\\))`));
      expect(CODE.match(new RegExp(column, 'g')) ?? []).toHaveLength(1);
    }
    expect(CODE).toContain('(mc.caller_e164 IS NOT NULL) AS caller_present');
    expect(CODE).toContain('(mc.forwarded_from_raw IS NOT NULL) AS forwarded_from_present');
  });

  it('names no recipient, body, provider id or sending identity column at all', () => {
    for (const column of [
      'caller_raw',
      'to_address',
      'provider_message_id',
      'from_address',
      'raw_payload',
      'body',
    ]) {
      expect(CODE, column).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('requires and validates --tenant and --limit BEFORE the first statement', () => {
    expect(CODE).toMatch(/const UUID = \/\^\[0-9a-f\]\{8\}-/);
    expect(CODE).not.toMatch(/sql\.unsafe/);
    const statement = CODE.indexOf('sql`');
    expect(statement).toBeGreaterThan(-1);
    expect(CODE.indexOf('if (tenant === undefined) fail(USAGE)')).toBeLessThan(statement);
    expect(CODE.indexOf('UUID.test(')).toBeLessThan(statement);
    expect(CODE.indexOf('limit < 1 || limit > 50')).toBeLessThan(statement);
    expect(CODE).toContain('LIMIT ${limit}');
  });

  it('joins the ledger on text_back_ledger_id for one tenant, newest first', () => {
    expect(CODE).toContain('LEFT JOIN send_ledger sl ON sl.id = mc.text_back_ledger_id');
    expect(CODE).toContain('WHERE mc.tenant_id = ${tenant}');
    expect(CODE.match(/ORDER BY mc\.started_at DESC, mc\.id DESC/g) ?? []).toHaveLength(1);
    expect(CODE).toContain('text-back calls: none');
  });

  it('prints the three deltas, the summary line and the clock line', () => {
    for (const name of ['greeting_s=', 'handler_s=', 'arrival_to_delivered_s=']) {
      expect(CODE).toContain(name);
    }
    expect(CODE).toContain("console.log('samples=0')");
    expect(CODE).toContain('samples=${promises.length} median_s=${median(promises)} worst_s=');
    expect(CODE).toContain('delivered_at is the carrier clock');
  });

  it('ends with the two arming read-back lines, as booleans', () => {
    const armed = CODE.indexOf('console.log(`text_back_armed=${flag(');
    const sms = CODE.indexOf('console.log(`sms_enabled_for_tenant=${flag(');

    expect(armed).toBeGreaterThan(-1);
    expect(sms).toBeGreaterThan(armed);
    // Nothing is printed after them.
    expect(CODE.slice(sms + 1).match(/console\.log\(/g) ?? []).toHaveLength(0);
    // The per-tenant sms row decides before the shared one (resolveSmsFrom's rule).
    expect(CODE).toContain('ORDER BY (tenant_id IS NULL) ASC');
    expect(CODE).toContain("channel = 'text_back' AND tenant_id = ${tenant} AND enabled");
  });
});

describe('package.json — the telephony aliases the runbook names', () => {
  it('exposes all three instruments', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['twilio:numbers-search']).toBe('node scripts/twilio-numbers-search.mjs');
    expect(pkg.scripts['missed-calls:recent']).toBe('node scripts/missed-calls-recent.mjs');
    // 2026-10 (Phase 12, IN-04): the 0039 pre-flight.
    expect(pkg.scripts['missed-calls:invariants']).toBe('node scripts/missed-calls-invariants.mjs');
    // 2026-10 (Phase 13, 13-07): the 0040 pre-flight and read-back.
    expect(pkg.scripts['lead-cadence:invariants']).toBe('node scripts/lead-cadence-invariants.mjs');
    // 2026-10 (Phase 14, 14-05): the 0041 pre-flight and read-back.
    expect(pkg.scripts['lead-jobs:invariants']).toBe('node scripts/lead-jobs-invariants.mjs');
    // 2026-10 (Phase 15, 15-08): the 0042 pre-flight and read-back.
    expect(pkg.scripts['lead-privacy:invariants']).toBe('node scripts/lead-privacy-invariants.mjs');
    // 2026-10 (Phase 12, D-14): the S4 timing reader and the arming read-back.
    expect(pkg.scripts['text-back:timing']).toBe('node scripts/text-back-timing.mjs');
    expect(pkg.scripts['verify:missed-call-reconcile']).toBe(
      'node scripts/verify-missed-call-reconcile.mjs',
    );
  });
});
