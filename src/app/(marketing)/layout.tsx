import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ABN_DISPLAY,
  APEX_DOMAIN,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_E164,
  FACEBOOK_URL,
  SERVICE_NAME,
  TAGLINE,
  footerIdentityLine,
} from '@/core/brand';

import { ArrivalSourceCapture } from './arrival-source';
import { LANDING_COPY } from './copy';
import { inter, interTight } from './fonts';
import { professionalServiceJsonLdText } from './structured-data';
import './marketing.css';

/**
 * The public site's shell (Phase 9, D-01).
 *
 * A NESTED layout, not a second root. Route groups may hold multiple root
 * layouts, but two of them means a full page load between the console and the
 * site, a `/` that resolves twice, and an experimental flag for the 404 —
 * whereas nothing here needs its own `<html>`: `lang="en-AU"` is already right
 * in `src/app/layout.tsx`, which stays the only one.
 *
 * IT READS NO SERVER ENVIRONMENT. These pages must prerender, and a page that
 * reads the environment at render time cannot. Everything the
 * footer prints is a constant in the import-free brand module (D-17), so the
 * whole subtree is static by construction rather than by discipline (T-9-26).
 */

/**
 * What a link preview shows when this site is pasted into a chat (D-18).
 *
 * `metadataBase` is the apex and not the app host on purpose: these pages are
 * for the public site, and a relative `/brand/og-image.png` has to resolve to
 * an address a stranger's chat client can fetch. Before the DNS cut-over the
 * pages also answer on `app.backdesk.com.au`, where the preview image still
 * resolves to the apex — which is the address we want shared either way.
 *
 * The image is a committed 1200x630 PNG, not a rendered route: nothing about a
 * link preview should cost a function invocation, and a preview crawler is the
 * one visitor guaranteed not to wait.
 */
export const metadata: Metadata = {
  metadataBase: new URL(`https://${APEX_DOMAIN}`),
  openGraph: {
    siteName: SERVICE_NAME,
    type: 'website',
    locale: 'en_AU',
    images: [
      {
        url: '/brand/og-image.png',
        width: 1200,
        height: 630,
        alt: `${SERVICE_NAME}. ${TAGLINE}`,
      },
    ],
  },
  twitter: { card: 'summary_large_image' },
};

/**
 * The footer identity line, as segments, from the ONE builder (D-16).
 *
 * Split from `footerIdentityLine` rather than rebuilt beside it: the ABN
 * segment's omission when there is no ABN is a rule that must hold
 * everywhere the line is printed, and re-implementing the join here would be
 * the second spelling the brand module exists to prevent. The email and the
 * phone become links by comparing each segment to the constant it came from —
 * by VALUE, never by position — and `tests/marketing-metadata.test.ts` pins the
 * split so a change to the separator fails a test rather than quietly
 * rendering the whole line as one unlinked string.
 */
const FOOTER_SEGMENTS = footerIdentityLine(ABN_DISPLAY).split(' · ');

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`marketing ${inter.variable} ${interTight.variable}`}>
      {/*
        THE ONE STRUCTURED-DATA BLOCK, ON EVERY PUBLIC PAGE (19 Sep 2026).

        In the LAYOUT rather than on each page, so `/`, `/audit`, `/privacy`,
        `/audit/how-to`, `/audit/thanks` and the guide all describe the same
        business with the same `@id` — which is what lets a crawler treat them as
        one entity instead of six. A per-page block would be six chances to
        disagree with the Google Business Profile.

        `dangerouslySetInnerHTML` is the only way to put JSON inside a `<script>`
        from React: a text child is HTML-escaped, which turns `&` into `&amp;`
        and produces invalid JSON. The string is built from compile-time
        constants only, and the builder escapes `<` as `<` so nothing in it
        can close this element early — see `structured-data.ts`.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: professionalServiceJsonLdText() }}
      />

      {/*
        WHERE THIS SESSION BEGAN, REMEMBERED ONCE (19 Sep 2026).

        Renders nothing. It is here rather than on `/audit` so the record is
        "the link that brought this person to the site" rather than "the page
        the form happened to be opened from" — a visitor who arrives on the
        guide from the Google listing and clicks through to the audit two pages
        later is a Google arrival, and only a layout-level capture can know it.

        No cookie, no script, no third-party request: one `sessionStorage` key,
        in the visitor's own tab, read back by the form (LAND-05).
      */}
      <ArrivalSourceCapture />

      {/* First focusable element on the page, per the D-19 contract. */}
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className="site-header">
        {/*
          THE BAR IS FULL WIDTH; ITS CONTENTS ARE NOT (G-09-4, UAT 10 Sep 2026).
          The border and the background belong to the bar, so the rule runs edge
          to edge — but the lockup has to start on the SAME left edge as the
          hero, every section heading and the footer below it, and the only
          thing that knows where that edge is is `.wrap`. It was 20px of padding
          on the bar itself, which put the lockup 208px to the LEFT of every
          heading on a 1440px screen.
        */}
        <div className="wrap">
          {/*
            THE LOCKUP, IN BOTH SCHEMES (D-06, operator instruction 9 Sep;
            logo v2 art, 19 Sep 2026).

            Two transparent variants of the supplied art — Graphite drawing for
            light, Paper drawing for dark — chosen by the browser through
            `<picture>` rather than by CSS, so exactly one file is ever fetched.
            The opaque `backdesk-lockup-on-paper.png` carries its own Paper
            canvas: right on the OG image (always Paper) and wrong here, where on
            a dark-scheme phone it would render as a Paper card sitting on a
            Graphite bar. It is never served — it stays in `logo/` and only the
            OG composition reads it.

            `width`/`height` match the CSS exactly so nothing shifts as the PNG
            decodes, and they are sized from the WORD, not the canvas: the word
            spans x 290-1507 of the 1508px v2 source, 0.808 of it, so 147px
            renders it ~119px wide, above D-06's 96px floor. v2 kept v1's
            5.236:1 canvas ratio (1508/288 = 1152/220), so the 147x28 pair is
            unchanged by the swap.

            The v2 wordmark is lowercase BY DESIGN (logo/README.txt: "never
            capitalised") — that governs the drawing, not the prose. The alt text
            is the business name as it is written everywhere else: "Backdesk".
          */}
          <Link className="lockup-link" href="/">
            <picture>
              <source
                media="(prefers-color-scheme: dark)"
                srcSet="/brand/lockup-paper-transparent.png"
              />
              {/* A plain <img>, not `next/image`: the optimiser cannot be the
                  <img> inside a <picture> without rendering its own srcset and
                  defeating the art direction this element exists for. The asset
                  is a committed, correctly sized PNG with explicit dimensions, so
                  there is nothing left to optimise. */}
              <img
                src="/brand/lockup-graphite-transparent.png"
                alt="Backdesk"
                width={147}
                height={28}
              />
            </picture>
          </Link>

          {/*
            A text link, not a button: the landing page keeps exactly ONE green
            control (D-04), and it is the hero's. Kept on every page including
            `/audit` — a layout cannot read the pathname, and C-1 tolerates the
            destination linking to itself.
          */}
          <nav aria-label="Site">
            <Link href="/guides/servicem8-quote-follow-up">{LANDING_COPY.headerGuideLink}</Link>
            <Link href="/audit">{LANDING_COPY.headerLink}</Link>
          </nav>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="site-footer">
        {/* The same container as the header and every section (G-09-4). */}
        <div className="wrap">
          <p>
            {FOOTER_SEGMENTS.map((segment, index) => (
              <span key={segment}>
                {index > 0 ? ' · ' : null}
                {segment === CONTACT_EMAIL ? (
                  <a href={`mailto:${CONTACT_EMAIL}`}>{segment}</a>
                ) : segment === CONTACT_PHONE_DISPLAY ? (
                  <a href={`tel:${CONTACT_PHONE_E164}`}>{segment}</a>
                ) : (
                  segment
                )}
              </span>
            ))}
          </p>
          <p>
            <Link href="/privacy">{LANDING_COPY.footer.privacy}</Link> ·{' '}
            <Link href="/guides/servicem8-quote-follow-up">{LANDING_COPY.footer.guide}</Link> ·{' '}
            <Link href="/audit">{LANDING_COPY.footer.audit}</Link> ·{' '}
            {/*
              THE ONE OFF-SITE LINK IN THE FOOTER (19 Sep 2026).

              A plain text link in the same row as the other three, not an icon
              row: the request is explicit that there is no WhatsApp link (a
              `wa.me` address on a public page invites messages somebody then has
              to answer) and no Google link (the profile is for search, not for
              sending a reader away from the page they are already on).

              `target="_blank"` with `rel="noopener noreferrer"` — the tab this
              opens must not be able to reach back through `window.opener`, and
              the referrer is withheld because it is nobody else's business which
              page of ours a visitor left from.

              An `<a>` rather than a `<Link>`: this leaves the app entirely, so
              there is no route to prefetch and nothing for the client router to
              do with it.
            */}
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer">
              {LANDING_COPY.footer.facebook}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
