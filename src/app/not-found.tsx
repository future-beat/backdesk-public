import type { Metadata } from 'next';
import Link from 'next/link';

import { SERVICE_NAME } from '@/core/brand';

/**
 * The one 404 page, for both halves of the site (09-04).
 *
 * It sits at the ROOT so it renders inside the only root layout, which means it
 * answers for an unknown id on a console page, an unknown marketing path, and —
 * the case it was added for — every console path requested on the public host,
 * which `proxy.ts` rewrites to an unmatched URL rather than redirecting to the
 * console (threat T-9-23).
 *
 * IT KNOWS NOTHING. No host logic, no session, no data: this page is rendered
 * for strangers, crawlers and the operator alike, and a 404 that varies by who
 * asked is a 404 that tells them apart. `noindex` because a soft-404 in an index
 * is worse than no entry at all — and because the paths that reach it here are
 * the console's, which have no business being crawled.
 *
 * Shaped like `src/app/login/page.tsx`: the same `main.auth` card, outside the
 * console shell, so it never renders a nav a signed-out visitor cannot use.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="auth">
      <h1>{SERVICE_NAME}</h1>
      <p className="muted">That page doesn&rsquo;t exist.</p>
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
