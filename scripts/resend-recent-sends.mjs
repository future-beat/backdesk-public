/**
 * What has this Resend account sent lately? (quick 260913-ind)
 *
 * Usage:  npm run resend:recent-sends -- [limit]
 *
 * READS ONLY. One `GET /emails`, no id required — the companion to
 * `resend:email-status`, which answers "did THIS message arrive" and needs an
 * id the operator already has. This one answers the question that comes first:
 * an email turned up in the inbox and nobody knows which sender produced it.
 * That is how the 22:30 UTC "Daily digest: 0 drafts still waiting" was traced
 * to the opt-out alarm on a one-contact test tenant, and it is how the fix is
 * confirmed — by the ABSENCE of a digest row after the next tick.
 *
 * ── WHAT IT PRINTS, AND WHAT IT REFUSES TO ─────────────────────────────────
 *
 *   created_at    when the send happened
 *   from          OUR sender — the one field that says whose email it is
 *   to_domain     the recipient's DOMAIN, never the address
 *   last_event    Resend's latest event for the message
 *   subject       address-shaped text redacted, then truncated
 *
 * The recipient is reduced to a domain before anything is printed, for the same
 * reason `resend-emails.ts` does it: this output is pasted into
 * `docs/external-registrations.md` and an evidence log is forever. The domain
 * is enough to tell an operator alert from a client cadence send, and the
 * address adds nothing but a customer's identity.
 *
 * THE SUBJECT IS BOUNDED RATHER THAN TRUSTED. It is the only variable-length
 * field here and the only reason to run the script at all — "Daily digest" is a
 * subject. Today every subject this account sends is a fixed phrase plus a
 * CLIENT's business name (`Quote follow-up from …`, the operator alerts), so
 * none of them names a customer. Tomorrow's template is not covered by that
 * sentence, so the redaction and the 80-character cap are applied here rather
 * than assumed upstream: a future subject that interpolated a customer's email
 * address would still not reach the log.
 *
 * The body is never fetched. `GET /emails` returns a list, and the whole
 * message lives behind `GET /emails/{id}`, which this script does not call.
 * The API key is read by the shared loader and never printed — not in the
 * output, not in an error, and not in a stack trace, which is why the fetch is
 * wrapped: a rejection stringifies to a message carrying the request URL, and
 * that URL belongs to our credentials' account (the CR-01 lesson).
 */
import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
requireEnv('RESEND_API_KEY');

/**
 * 1..100, defaulting to 20.
 *
 * Clamped on BOTH sides rather than capped: `Number('-5')` is a number, and a
 * negative limit reaches the provider as a query parameter nobody tested. An
 * operator polling this after a cron tick types a small number or nothing.
 */
const limit = Math.max(1, Math.min(Number(process.argv[2] ?? 20) || 20, 100));

let res;
try {
  res = await fetch(`https://api.resend.com/emails?limit=${limit}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
} catch (e) {
  // The NAME only. A fetch rejection's message carries the request URL, and an
  // unhandled one would print a stack containing it.
  console.error(`resend list failed: ${e instanceof Error ? e.name : 'unknown error'}`);
  process.exit(1);
}

if (!res.ok) {
  // The status, not the body: a provider error body can echo the request, and
  // the request was authorised by a header built from the API key.
  console.error(`resend list failed: HTTP ${res.status}`);
  process.exit(1);
}

const body = await res.json();
const rows = Array.isArray(body?.data) ? body.data : [];

/** Everything after the `@`, or `?` for anything that is not address-shaped. */
function domainOf(address) {
  return String(address ?? '').split('@')[1] ?? '?';
}

const ADDRESS_SHAPED = /[^\s<>@]+@[^\s<>@]+/g;

/** The subject with any address redacted and the length bounded. */
function safeSubject(value) {
  return JSON.stringify(String(value ?? '').replace(ADDRESS_SHAPED, '[redacted]').slice(0, 80));
}

console.log(`resend recent sends: ${rows.length}`);
for (const row of rows) {
  const recipients = Array.isArray(row.to) ? row.to : [row.to];
  const domains = recipients.map(domainOf).join(',');
  console.log(
    `${row.created_at}  from=${row.from}  to_domain=${domains}  ` +
      `last_event=${row.last_event}  subject=${safeSubject(row.subject)}`,
  );
}
