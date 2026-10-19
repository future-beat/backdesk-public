/**
 * The unsubscribe door (MSG-02, MSG-03, T-4-19, T-4-20). A customer clicks a
 * link in a follow-up email, or their mail client POSTs it for them under
 * RFC 8058, and this route suppresses that human on BOTH channels.
 *
 * ── FULLY PUBLIC, AND THE TOKEN IS THE WHOLE CREDENTIAL ─────────────────────
 *
 * `proxy.ts`'s matcher excludes `api/`, so nothing runs before this handler — no
 * session, no redirect, no cookie. That exclusion is what makes an unsubscribe
 * possible at all: behind the proxy, a customer with no session would be
 * answered 307 → /login, which is a broken opt-out and a Spam Act problem
 * wearing a 200 (the same Pitfall 7 shape the tick routes carry).
 *
 * What replaces the session is `verifyUnsubscribeToken`: an HMAC over
 * (tenantId, cadenceId) minted at SEND time. Possession implies receipt of the
 * email, so "suppress an arbitrary victim" has no expression here — there is no
 * address-keyed, id-keyed or enumerable path into this file (T-4-19).
 *
 * ── EVERY ANSWER IS THE SAME ANSWER (T-4-20) ────────────────────────────────
 *
 * Valid, forged, malformed, absent, replayed-after-suppression, naming a cadence
 * that does not exist, and "the database was down" ALL produce a byte-identical
 * 200. This endpoint must not be an oracle: a body that varied would let anyone
 * probing tokens learn which ones name a live cadence, and this system's whole
 * customer list is exactly that question asked repeatedly.
 *
 * The cost is that a forged click is told it worked. That is the right way round
 * — the alternative discloses, and the thing being (not) done is the thing this
 * system is always allowed to do: stop contacting somebody.
 *
 * ── GET NEVER WRITES ────────────────────────────────────────────────────────
 *
 * GET renders a confirmation page and nothing else. Corporate mail scanners
 * follow every link in an inbound email; a GET that suppressed would opt people
 * out of conversations they wanted, and we would find out from the tradie.
 *
 * The page is a CONSTANT — the same bytes for every token, because the form
 * carries no `action` and therefore posts to the current URL, leaving the token
 * in the query string where it arrived. Nothing about the token is echoed into
 * the markup, so there is no version of this page that discloses anything.
 *
 * ── WHAT IS NEVER LOGGED ────────────────────────────────────────────────────
 *
 * The token (it is a credential, and platform logs have no retention limit and
 * no per-customer deletion), and any address — this route never learns one. The
 * suppression result KIND is the only interpolated value, pinned by
 * `tests/unsubscribe.test.ts`.
 */
import { identityLine } from '@/core/brand';
import { suppressFromInbound } from '@/core/cadence/controls';
import { verifyUnsubscribeToken } from '@/core/messaging/unsubscribe-token';
import { getServerEnv } from '@/core/shared/env';

/**
 * One click is one verify and one small transaction. 60s exists so a database
 * hiccup fails as a timeout rather than at a platform default, and so the number
 * is a decision rather than an accident.
 */
export const maxDuration = 60;

/** `node:crypto` and the postgres driver are both unavailable on edge. */
export const runtime = 'nodejs';

/**
 * Rendered by BOTH handlers, and identical in shape by construction.
 *
 * No external stylesheet, font or image: this page opens from a link in an email
 * on an unknown device behind an unknown network, and a request to a third party
 * from an unsubscribe page would also tell that third party who unsubscribed.
 */
function page(heading: string, message: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Unsubscribe</title>',
    '<style>',
    'body{font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
    'margin:0;padding:2.5rem 1.25rem;color:#111;background:#fafafa}',
    'main{max-width:32rem;margin:0 auto;background:#fff;border:1px solid #e5e5e5;',
    'border-radius:12px;padding:1.75rem}',
    'h1{font-size:1.35rem;margin:0 0 .75rem}',
    'p{margin:0 0 1.25rem}',
    'button{font:inherit;padding:.7rem 1.1rem;border:0;border-radius:8px;',
    'background:#111;color:#fff;cursor:pointer}',
    'small{color:#666}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${heading}</h1>`,
    message,
    `<p><small>${identityLine('the business that quoted you')}</small></p>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * THE CONFIRMATION PAGE. A constant, evaluated once.
 *
 * The form has NO `action`, so the browser posts to the current URL — token
 * included, never echoed. It also has no hidden input, which is what makes this
 * page byte-identical for every token value and therefore incapable of
 * disclosing whether one is real.
 *
 * It names no business and no address, for the same reason: resolving the
 * client's name from the token would make a valid token render differently from
 * an invalid one, which is precisely the oracle the whole route is built to
 * avoid.
 */
const CONFIRM_PAGE = page(
  'Unsubscribe',
  [
    '<p>Confirm that you no longer want follow-up messages about your quote.</p>',
    '<form method="post">',
    '<button type="submit">Unsubscribe me</button>',
    '</form>',
  ].join('\n'),
);

/**
 * THE ONLY ANSWER A POST EVER GETS. Also a constant — see the header on why the
 * successful and the refused paths must be the same bytes.
 */
const DONE_PAGE = page(
  'You have been unsubscribed',
  [
    '<p>You will not receive any more follow-up messages about your quote.</p>',
    '<p>This applies to both email and text messages, and it cannot be undone ',
    'from this page. If it was a mistake, reply to the business directly.</p>',
  ].join('\n'),
);

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // A shared cache holding either page would be harmless (both are
      // constants) — but a confirmation stored against a URL that carries a
      // credential is not a thing to leave to a proxy's judgement.
      'cache-control': 'no-store',
    },
  });
}

export function GET(): Response {
  return html(CONFIRM_PAGE);
}

/**
 * The token, from the query string first and the form body second.
 *
 * QUERY FIRST because that is where both real senders put it: our own
 * confirmation form (no `action`, so it posts to the current URL) and an RFC
 * 8058 one-click client, which POSTs `List-Unsubscribe=One-Click` to the URL
 * from the header and knows nothing about our fields.
 *
 * The body is read as a fallback so a hand-built form with a hidden input still
 * works. Wrapped, because `formData()` rejects on a body that is not a form —
 * and an unparseable body must be a refusal, not a 500 that differs from every
 * other response.
 */
async function tokenFrom(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get('token');
  if (fromQuery) return fromQuery;

  try {
    const form = await request.formData();
    const value = form.get('token');
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const token = await tokenFrom(request);
  const subject = token
    ? verifyUnsubscribeToken(token, getServerEnv().UNSUBSCRIBE_SIGNING_SECRET)
    : null;

  if (subject) {
    try {
      // THROUGH controls.ts, never a write of its own. Every "never chase this
      // human again" path in this codebase runs the same transaction, because
      // the second expression of it is the one that gets a condition wrong —
      // and here the failure is an email sent after somebody clicked
      // unsubscribe. `email_unsubscribe` is the evidence that distinguishes
      // this from an operator kill or a texted STOP; the transition, the
      // both-channel rule and the verbatim addresses are identical by
      // construction.
      const result = await suppressFromInbound(
        subject.tenantId,
        subject.cadenceId,
        'email_unsubscribe',
      );

      // THE RESULT KIND, AND NOTHING ELSE. A member of a closed union: no
      // address, no token, no tenant id can reach a platform log through it.
      console.log(
        `[unsubscribe] click handled: ${result.kind}.`,
      );
    } catch {
      // A database outage must not become the one response that differs from
      // all the others — and must not become a 500 that a one-click sender
      // retries in a loop. The click is lost; the customer can click again, and
      // the footer link keeps working.
      console.error('[unsubscribe] the suppression failed; the click was not recorded.');
    }
  }

  return html(DONE_PAGE);
}
