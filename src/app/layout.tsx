import type { Metadata } from 'next';

import { CONSOLE_DESCRIPTION, SERVICE_NAME } from '@/core/brand';

import './globals.css';

/**
 * THE CACHE BUSTER ON EVERY ICON URL — bump it whenever the art changes.
 *
 * A favicon is the most aggressively cached thing a browser holds: Chrome keeps
 * it in its own store, separate from the HTTP cache, and will happily show a
 * year-old icon for a page it has just re-fetched. Vercel serves everything
 * under `public/` with a long immutable max-age, which is correct and makes the
 * problem worse.
 *
 * The v2 swap (19 Sep 2026) changed the BYTES at `/brand/favicon.ico`,
 * `favicon.svg` and `apple-touch-icon.png` and kept their URLs — so a returning
 * visitor kept the v1 Ink tile in their tab, which is exactly what was reported.
 * A query string is a different URL to every cache in the chain and changes
 * nothing about what is served, so it is the cheapest correct fix.
 *
 * NOT a build id or a content hash: those change on every deploy, which would
 * make every visitor re-fetch four files for a copy edit. This is a HUMAN
 * decision — it moves when the drawing moves, and 1 -> 2 is the v1 -> v2 swap.
 *
 * The two ROOT paths (`/favicon.ico`, `/apple-touch-icon.png`) deliberately
 * carry no version: they are well-known addresses requested by crawlers that
 * never read this head, so there is nothing to append a query to. They are new
 * paths as of this change, so no cache holds a v1 of them anyway.
 */
const BRAND_ASSET_VERSION = 2;

/** `/brand/x.png` -> `/brand/x.png?v=2`. */
const versioned = (path: string) => `${path}?v=${BRAND_ASSET_VERSION}`;

export const metadata: Metadata = {
  title: {
    default: SERVICE_NAME,
    template: `%s · ${SERVICE_NAME}`,
  },
  description: CONSOLE_DESCRIPTION,
  /*
   * Every icon served as a static file from `public/brand/` (D-18, LAND-06).
   * Nothing renders an image on a request and nothing is fetched from another
   * host — a link preview or a tab icon is bytes out of this repo.
   *
   * The SVGs are listed first because a browser that understands them should
   * take one; the .ico with `sizes: 'any'` is the fallback that keeps Safari and
   * older Edge from falling back to a /favicon.ico that no longer exists. The
   * Next default at `src/app/favicon.ico` is deliberately gone: as a file
   * convention it emitted a SECOND <link> into the head, and which of the two
   * a browser picked was not something this file decided.
   *
   * TWO SVGs, SCOPED BY SCHEME, AND THAT IS NOT BELT-AND-BRACES (logo v2,
   * 19 Sep 2026). The supplied `favicon.svg` is the bare Graphite mark on a
   * TRANSPARENT ground — v1's art carried its own Ink tile, v2's does not. A
   * #1A1F2B drawing on a dark browser chrome is a black shape on a black bar,
   * i.e. an empty tab. Recolouring the supplied file is forbidden
   * (logo/README.txt), so the fix belongs here: light chrome takes the Graphite
   * mark, dark chrome takes `mark-paper.svg`, which is the same two paths in
   * #FAFAF7. Chrome/Safari/Firefox all honour `media` on an icon link; anything
   * that does not falls through to the .ico below, which is opaque and legible
   * either way.
   *
   * FOUR LINKS, AND STILL FOUR AFTER THE ROOT ICONS LANDED (19 Sep 2026).
   * `public/favicon.ico` and `public/apple-touch-icon.png` now answer the
   * well-known ROOT addresses — the ones Google's favicon crawler and most link
   * unfurlers request directly without reading this head. A file under
   * `public/` is a plain static asset and emits no markup, so it adds no fifth
   * <link> and nothing here changes shape. `src/app/favicon.ico` would be the
   * opposite (a file convention that emits its own link) and stays absent,
   * asserted in tests/brand-assets.test.ts.
   */
  icons: {
    icon: [
      {
        url: versioned('/brand/favicon.svg'),
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: versioned('/brand/mark-paper.svg'),
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
      },
      { url: versioned('/brand/favicon.ico'), sizes: 'any' },
    ],
    apple: versioned('/brand/apple-touch-icon.png'),
  },
};

// Typed explicitly rather than with Next's generated `LayoutProps` global, which
// only exists after a build has emitted .next/types — using it would make
// `tsc --noEmit` fail on a clean checkout (and in CI before the build step).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
