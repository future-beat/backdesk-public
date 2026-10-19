import { Inter, Inter_Tight } from 'next/font/google';

/**
 * The two faces the public site is set in (D-05), SELF-HOSTED AT BUILD.
 *
 * The Next font loader downloads the CSS and the font files during `next build`
 * and serves them from this deployment: the browser makes NO request to Google,
 * which is what keeps the D-18 prohibition ("no third-party script, analytics,
 * runtime font or external image on the public pages") true of a page that is
 * nonetheless set in a Google font. The trade is that the BUILD needs one-time
 * outbound access to fonts.googleapis.com — CI and Vercel both have it; an
 * offline build fails here rather than shipping a page that phones home.
 *
 * Imported by `layout.tsx` and by nothing else. The variables land on the
 * marketing wrapper div, so the console, the login page and the two A4 print
 * pages never receive the class and never pay for a webfont (D-05: console
 * stays `system-ui`). Preloading follows the same boundary — Next preloads a
 * font only on the routes whose layout declares it.
 *
 * `display: 'swap'` plus Next's default `adjustFontFallback` metrics: text is
 * readable on first paint in a metric-matched fallback and does not jump when
 * Inter arrives. On a tradesperson's phone on 4G that is the difference between
 * a blank hero and a legible one.
 */
export const inter = Inter({
  subsets: ['latin'],
  // 400 body, 600 headings and labels, 700 for the two things M1 brand-locks to
  // it: the wordmark glyphs and standalone dollar figures. Not a third text
  // weight — see the UI-SPEC Typography table.
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * The wordmark face, 700 only. Used by the text `.wordmark` fallback — the site
 * header itself shows the supplied lockup image (D-06), and Inter Tight is what
 * every OTHER surface sets the name in.
 */
export const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['700'],
  display: 'swap',
  variable: '--font-inter-tight',
});
