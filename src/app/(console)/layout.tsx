import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOut } from '@/app/login/actions';
import { STALLABLE_TOUCH_STATUSES, stallBoundary } from '@/core/aging/stall-policy';
import { SERVICE_NAME } from '@/core/brand';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * What the nav badge says, or nothing at all.
 *
 * `null` means RENDER NO BADGE, and it covers two different situations on
 * purpose: nothing is waiting, and the count could not be read. See
 * `pendingQueueCount` for why those two collapse here.
 */
interface QueueBadge {
  pending: number;
  stalled: number;
}

/**
 * HOW MANY DRAFTS ARE WAITING ON THE PERSON READING THIS PAGE (D-10/D-12).
 *
 * ── RLS-SCOPED, THROUGH THE CALLER'S OWN JWT. NEVER SERVICE-ROLE ───────────
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This layout gates on `getClaims()` — ANY authenticated user — not on      │
 * │ `requireOperator()`. A service-role read here would therefore print a     │
 * │ cross-tenant number in the chrome of every page, to whoever is logged in. │
 * │ Today that is one operator; the v2 client-reports login is the whole      │
 * │ reason the distinction is drawn now, because the day it ships this badge  │
 * │ would already be leaking and nobody would be looking at this file.        │
 * │                                                                          │
 * │ Through `createClient()` the count is bounded by `has_tenant_access` by   │
 * │ CONSTRUCTION: a future client session sees its own rows and no others,    │
 * │ with no code change and no remembering.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── A FAILED READ RENDERS NO BADGE, AND THE LAYOUT NEVER BREAKS ────────────
 *
 * The nav is how an operator reaches the inbox, which is where an unseen
 * opt-out sits. A count query that threw would take that away over a number.
 * So the failure is swallowed, the badge is simply absent, and the honest error
 * lives on `/queue` itself — the page whose job is to be right about this.
 *
 * Two head counts rather than one read: the rows are never needed, only the
 * two integers, and `head: true` means the payload is a header.
 */
async function pendingQueueCount(
  supabase: SupabaseClient,
  now: Date,
): Promise<QueueBadge | null> {
  try {
    const waiting = () =>
      supabase
        .from('cadence_touches')
        .select('id', { count: 'exact', head: true })
        .in('status', [...STALLABLE_TOUCH_STATUSES]);

    const [pending, stalled] = await Promise.all([
      waiting(),
      // The SAME boundary the tick alerts on and the digest lists — imported,
      // never a second `now + 4h` written here. A badge that turned red on a
      // different threshold from the email would make the email look wrong.
      waiting().lte('scheduled_at', stallBoundary(now).toISOString()),
    ]);

    if (pending.error || stalled.error) return null;

    return { pending: pending.count ?? 0, stalled: stalled.count ?? 0 };
  } catch {
    // The caught value is discarded, not logged: a PostgREST error names
    // columns and policy internals, and the nav is not a place to report them.
    return null;
  }
}

/**
 * Auth-gated console shell.
 *
 * proxy.ts already redirects unauthenticated requests, so this check is
 * defence in depth: a mistake in the proxy matcher would otherwise expose every
 * page underneath this layout with no second gate. `getClaims()` verifies the
 * JWT signature — `getSession()` is never trusted here.
 */
/**
 * NOTHING BEHIND THE SESSION GATE IS INDEXED (D-18, T-9-29).
 *
 * `robots.txt` disallows every console path by name, but a robots file is a
 * request a crawler may ignore, and the console's URLs travel: they are pasted
 * into the operator SMS, they appear in alert emails, and one of them will end
 * up somewhere a bot reads. A layout-level `noindex` covers every page under
 * this group at once, including the ones added after this line was written —
 * which is why it lives here and not on the pages.
 *
 * `follow: false` as well: there is nothing on a console page worth crawling
 * onward from, and every one of those links is behind the same gate.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect('/login');
  }

  // AFTER the auth gate, deliberately: an unauthenticated request must be
  // redirected without this layout having asked the database anything.
  const badge = await pendingQueueCount(supabase, new Date());

  return (
    <div className="shell">
      <header className="nav">
        {/*
          THE LOCKUP, NOT A TYPESET NAME (logo v2, 19 Sep 2026).

          Until now this was `{SERVICE_NAME}` in system-ui at weight 600 — the
          right colour by accident (it reads `--fg`, which moved to Graphite in
          quick-260919-kel) and the wrong letterforms by construction. v2's
          wordmark is Archivo 700, lowercase, tracked -0.04em, and none of that
          survives being approximated in whatever the operator's OS ships.
          logo/README.txt is explicit: never respace, never capitalise. The only
          way to obey that is to show the drawing.

          The same `<picture>` mechanism as the marketing header, for the same
          reason: the supplied lockups are TRANSPARENT, so the Graphite one is
          invisible on the dark scheme's ground and the Paper one on the light
          scheme's. The browser picks, so exactly one file is fetched, and a
          plain <img> rather than `next/image` — the optimiser would emit its own
          srcset and defeat the art direction the <picture> exists for.

          105x20, AND IT IS NARROWER THAN THE TEXT IT REPLACES. The bar's
          comment in globals.css is built on the brand measuring 121px; the
          lockup is 105px, so the scrolling link row gains ~16px rather than
          losing any. That was measured rather than assumed (see the nav comment
          in globals.css for the numbers). 105px clears README's 100px minimum;
          the 5.25 ratio is the same rounding the marketing header's 147x28
          already uses against the source's 5.236.

          `alt` is SERVICE_NAME, which this file already imports: the wordmark is
          lowercase because the drawing is, and the name in a screen reader,
          a tab title and an alert email should not disagree about that.
        */}
        <Link href="/" className="brand">
          <picture>
            <source
              media="(prefers-color-scheme: dark)"
              srcSet="/brand/lockup-paper-transparent.png"
            />
            <img
              src="/brand/lockup-graphite-transparent.png"
              alt={SERVICE_NAME}
              width={105}
              height={20}
            />
          </picture>
        </Link>
        <nav>
          {/* FIRST in the nav, and that placement is the argument: the inbox is
              the only screen holding work with a clock on it — an opt-out
              somebody sent, sitting unseen. Everything else here can wait a day.
              A page nobody can reach is a page nobody triages. */}
          <Link href="/inbox">Inbox</Link>
          {/* SECOND, and the placement is argued rather than alphabetical: the
              queue is the OTHER screen with a clock on it — a draft unapproved
              at its send slot is a follow-up that goes out late or not at all.
              It sits behind the inbox only because an unseen opt-out is a
              compliance failure and a late follow-up is a missed sale. */}
          <Link href="/queue">
            Queue
            {/* HIDDEN ENTIRELY AT ZERO, and hidden on a failed read — a
                permanent `0` in the chrome of every page is a thing an operator
                stops seeing, and then so is the 4. The digits are the CONTENT;
                the colour only reinforces (WCAG 1.4.1), which is why
                `.badge--error` never appears without a number inside it. */}
            {badge && badge.pending > 0 ? (
              <span
                className={badge.stalled > 0 ? 'badge badge--error' : 'badge'}
                aria-label={
                  badge.stalled > 0
                    ? `${badge.pending} drafts waiting, ${badge.stalled} stalled`
                    : `${badge.pending} drafts waiting`
                }
              >
                {badge.pending}
              </span>
            ) : null}
          </Link>
          {/* THIRD (Phase 15, D-01), because it is the third screen with a clock
              on it: a missed caller's next follow-up has a deadline, and a lead
              nobody looks at is a job the tradie never hears about. NO COUNT
              BADGE — a cross-tenant count read in chrome that every
              authenticated user renders is precisely what A5 forbids; the
              overdue count lives on the operator-gated page and in the 06:30
              digest instead. */}
          <Link href="/leads">Leads</Link>
          {/* The audits list, not `audits/new`: this is the pipeline view the
              operator returns to, and the New-audit button lives on it. */}
          <Link href="/audits">Audits</Link>
          {/* AFTER the two screens with a clock on them and after Audits, and
              with NO BADGE (U-8, 07-05). Reports have no clock: a drifting
              opt-out rate is a conversation to have this week, not an unseen
              compliance failure. And a count here would have to be a
              CROSS-TENANT fact read in chrome that every authenticated user
              renders, which is precisely what A5 forbids — the badge for the
              >5% alarm lives on the operator-gated page and in the 06:30
              digest instead. */}
          <Link href="/reports">Reports</Link>
          <Link href="/clients/new">New client</Link>
          {/* Last, because it is visited during onboarding and then rarely —
              but it IS in the nav, because a domain-verification flow the
              operator cannot find is a flow that ends with them asking a
              developer, which is the thing this page exists to stop. */}
          <Link href="/settings/email">Email</Link>
          <form action={signOut}>
            <button type="submit" className="linkish">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
