/**
 * THE BRAND ART IS PRESENT, THE RIGHT SIZE, AND SERVED FROM `/brand/` (D-06, D-18).
 *
 * These files are the only part of the identity that no other test can see. A
 * missing constant fails a type-check and a missing CSS rule fails
 * `brand-tokens`; a missing PNG under `public/` fails nothing at all — it
 * renders as a broken image in a link preview, in someone else's product, weeks
 * later. So the enumeration below IS the contract: every file the metadata and
 * the landing header point at, asserted to exist and to decode to the size the
 * platform that reads it demands.
 *
 * The dimensions are checked by decoding the PNG header rather than by trusting
 * the filename, because the failure this catches is a regenerated asset that
 * came out at the wrong size after a script edit — a file called
 * `og-image.png` that is 1200x628 is still called `og-image.png`.
 *
 * THIS SUITE PINS LOGO v2 (GRAPHITE), SUPPLIED 19 Sep 2026. The art itself is
 * SUPPLIED, not generated here: the lockups, both wordmarks, the mark and the
 * profile tile are the supplied SVGs minus their C2PA metadata (T-9-15); the PNGs are byte-identical copies of `logo/`, which is committed as the
 * source of record. Only `favicon.ico`, `apple-touch-icon.png` and the OG
 * composition are derived, by `scripts/brand/render-brand-assets.sh`. v1's Ink
 * palette, its rounded tile and its capitalised wordmark are asserted GONE — a
 * half-applied identity is worse than either whole one, because it is the
 * version nobody chose.
 *
 * Pure suite: reads files, decodes bytes, and imports the root layout's
 * `metadata` — nothing else. Runs bare (`npx vitest run
 * tests/brand-assets.test.ts`), with NO ALLOW_REMOTE_TESTS.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// The REAL metadata object, not its source text. Everything else in this file
// is bytes on disk, but "the head carries exactly four icon links and every one
// of them is versioned" is a statement about the value Next serialises — a grep
// for `?v=2` would pass just as happily on five links, or on three plus a
// comment. The module imports `globals.css`, which Vite stubs, and
// `@/core/brand`, which is import-free by construction (D-17), so this costs
// nothing and reaches nothing.
import { metadata } from '../src/app/layout';
import { TAGLINE } from '../src/core/brand';

/**
 * The committed files directly inside `dir`, sorted — dotfiles and
 * subdirectories excluded.
 *
 * Both exclusions are the difference between an assertion about the ARTWORK and
 * an assertion about a folder on one laptop:
 *
 * - macOS writes `.DS_Store` into any directory Finder opens. It is gitignored
 *   and never ships, so a listing that counted it would fail a build because
 *   somebody looked at the logo.
 * - `logo/` is the marketing thread's delivery folder. They ship subfolders of
 *   artwork for surfaces this repo does not serve (`social-v2/` — the Facebook,
 *   WhatsApp and GBP covers, delivered the same afternoon as the v2 set), and
 *   how they organise that is not this suite's business.
 *
 * What remains asserted is the thing that matters: no loose file sits beside
 * the set, in either directory. A stray v1 lockup in `logo/` is a source of
 * record claiming to be current, and one in `public/brand/` is published.
 */
function brandFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** The PNG signature, then IHDR: width at byte 16, height at byte 20. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);

  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Every file `public/brand/` must hold, and what points at it.
 *
 * Listed exhaustively rather than globbed: a glob asserts that whatever is
 * there is fine, which is the opposite of the T-9-15 disposition — this
 * directory is world-readable, so what is IN it is as much the contract as what
 * is missing from it. The naming convention is the supplied name minus the
 * `backdesk-` prefix, and `EQUIVALENT` below is what enforces that pairing.
 */
const EXPECTED = [
  // The two transparent lockups the site header switches between. The opaque
  // 3696x928 lockups carry their own Paper/Graphite canvas, which is right on
  // the OG image and wrong on a header — on a dark-scheme phone the Paper one
  // would render as a card floating on a Graphite bar — so neither is served.
  'public/brand/lockup-graphite-transparent.png',
  'public/brand/lockup-paper-transparent.png',
  'public/brand/wordmark-graphite-transparent.png',
  'public/brand/wordmark-paper-transparent.png',
  'public/brand/mark-graphite.svg',
  'public/brand/mark-paper.svg',
  'public/brand/profile-720.svg',
  'public/brand/favicon.svg',
  'public/brand/favicon.ico',
  'public/brand/apple-touch-icon.png',
  'public/brand/og-image.png',
  // The structured-data `logo` (19 Sep 2026). The SAME Graphite tile that is
  // uploaded as the profile picture on the Google Business Profile, Facebook and
  // WhatsApp, so a crawler comparing the site to the listings compares one
  // drawing to itself rather than two pictures of one business.
  'public/brand/logo-512.png',
];

/**
 * The supplied source art, committed as the record of what was drawn — all
 * eleven files as delivered on 19 Sep 2026, README included.
 *
 * `README.txt` is in this list and not treated as documentation: it is the
 * brand spec the rest of the repo is measured against ("Graphite #1A1F2B ·
 * Paper #FAFAF7 … never green, never capitalised, never split"), and a copy of
 * the art without it is a set of PNGs with no rule attached.
 */
const SOURCES = [
  'logo/README.txt',
  'logo/backdesk-favicon.svg',
  'logo/backdesk-mark-graphite.svg',
  'logo/backdesk-mark-paper.svg',
  'logo/backdesk-profile-720.svg',
  'logo/backdesk-lockup-graphite-transparent.png',
  'logo/backdesk-lockup-paper-transparent.png',
  'logo/backdesk-lockup-on-paper.png',
  'logo/backdesk-lockup-on-graphite.png',
  'logo/backdesk-wordmark-graphite-transparent.png',
  'logo/backdesk-wordmark-paper-transparent.png',
];

/** Served file -> the supplied file it must equal, byte for byte. */
const EQUIVALENT = [
  'lockup-graphite-transparent.png',
  'lockup-paper-transparent.png',
  'wordmark-graphite-transparent.png',
  'wordmark-paper-transparent.png',
];

/**
 * The WELL-KNOWN ROOT ADDRESSES, and the `public/brand/` file each must equal.
 *
 * These are not <link> targets and no markup points at them — that is the point
 * of them. Google's search-result favicon crawler, most link unfurlers, several
 * feed readers and Safari's older touch-icon lookup request `/favicon.ico` and
 * `/apple-touch-icon.png` DIRECTLY and never open the document head, so the
 * carefully-scoped `icons` block in `src/app/layout.tsx` is invisible to all of
 * them. Both paths 404'd on both hosts from Phase 9 until 19 Sep 2026.
 *
 * Asserted as COPIES rather than as their own renders: two drawings that are
 * meant to be one drawing is how a root favicon ends up a version behind the
 * one in the tab, with nothing to notice it.
 */
const ROOT_ICONS: [root: string, brand: string][] = [
  ['public/favicon.ico', 'public/brand/favicon.ico'],
  ['public/apple-touch-icon.png', 'public/brand/apple-touch-icon.png'],
];

describe('public/brand holds every asset the metadata points at (D-06)', () => {
  it.each(EXPECTED)('%s exists', (path) => {
    expect(existsSync(path)).toBe(true);
  });

  it('serves NOTHING else — the directory listing is the contract', () => {
    // A stray file here is not inert: `public/` is world-readable, so anything
    // dropped in during a swap is published. This is the assertion that would
    // have caught v1's art being left behind beside v2's.
    expect(brandFiles('public/brand')).toEqual(
      EXPECTED.map((path) => path.replace('public/brand/', '')).sort(),
    );
  });

  it.each(SOURCES)('%s is committed as the source of record', (path) => {
    expect(existsSync(path)).toBe(true);
  });

  it('holds the supplied set and no loose file beside it — eleven files', () => {
    expect(brandFiles('logo')).toEqual(SOURCES.map((path) => path.replace('logo/', '')).sort());
  });

  it.each(EQUIVALENT)('%s is a COPY of the supplied art, not a re-export', (name) => {
    // logo/README.txt: never redraw, recolour, respace or capitalise. Equal
    // bytes is the strongest form of that — a re-export at the same dimensions
    // would pass a size check and still be a different drawing.
    expect(readFileSync(`public/brand/${name}`).equals(readFileSync(`logo/backdesk-${name}`))).toBe(
      true,
    );
  });

  it('serves both transparent lockups at the supplied 1508x288', () => {
    for (const name of ['lockup-graphite-transparent', 'lockup-paper-transparent']) {
      expect(pngSize(`public/brand/${name}.png`)).toEqual({ width: 1508, height: 288 });
    }
  });

  it('serves both wordmarks at the supplied 1236x288', () => {
    for (const name of ['wordmark-graphite-transparent', 'wordmark-paper-transparent']) {
      expect(pngSize(`public/brand/${name}.png`)).toEqual({ width: 1236, height: 288 });
    }
  });

  it('never serves the 3696px opaque lockups (LAND-06)', () => {
    // 93 KB each. They exist for the OG composition, which reads them out of
    // `logo/` on a workstation; a browser must never be asked to fetch one.
    expect(pngSize('logo/backdesk-lockup-on-paper.png')).toEqual({ width: 3696, height: 928 });
    expect(existsSync('public/brand/lockup-on-paper.png')).toBe(false);
    expect(existsSync('public/brand/lockup-on-graphite.png')).toBe(false);
  });

  it('switches the header lockup on the colour scheme, at the D-06 word size', () => {
    // D-06: the word renders >= 96px wide. The word spans x 290-1507 of the
    // 1508px source (0.808 of it), so a 147px-wide render puts it at ~119px.
    // v2 kept v1's 5.236:1 canvas ratio, so the pair did not move in the swap.
    // It is pinned here AND in marketing.css; a change to one without the other
    // is a layout shift on the slowest connection we have.
    const layout = readFileSync('src/app/(marketing)/layout.tsx', 'utf8');

    expect(layout).toContain('/brand/lockup-paper-transparent.png');
    expect(layout).toContain('/brand/lockup-graphite-transparent.png');
    expect(layout).toContain('(prefers-color-scheme: dark)');
    expect(layout).toContain('width={147}');
    expect(layout).toContain('height={28}');
    expect(layout).toContain('alt="Backdesk"');
  });
});

describe('the served SVGs are the v2 drawings, in the v2 palette', () => {
  /** One SVG's markup with the C2PA `<metadata>` blob removed. */
  function drawing(path: string): string {
    return readFileSync(path, 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '');
  }

  it('favicon.svg is the bare Graphite mark — two paths, no tile', () => {
    // v2's mark has no background of its own. That is why `src/app/layout.tsx`
    // scopes this file to light chrome and hands dark chrome `mark-paper.svg`:
    // a #1A1F2B drawing on a dark tab strip is an empty tab.
    const svg = drawing('public/brand/favicon.svg');

    expect(svg.match(/<path\b/g)).toHaveLength(2);
    expect(svg.match(/fill="#1A1F2B"/g)).toHaveLength(2);
    expect(svg).not.toMatch(/<rect\b/);
  });

  it('mark-paper.svg is the same two paths in Paper', () => {
    const svg = drawing('public/brand/mark-paper.svg');

    expect(svg.match(/<path\b/g)).toHaveLength(2);
    expect(svg.match(/fill="#FAFAF7"/g)).toHaveLength(2);
  });

  it('profile-720.svg is a full-bleed Graphite tile with the Paper mark on it', () => {
    // The source of `favicon.ico` and `apple-touch-icon.png`. Full-bleed is the
    // load-bearing part: iOS composites anything transparent onto black, and a
    // tab icon has to survive a dark strip.
    const svg = drawing('public/brand/profile-720.svg');

    expect(svg).toMatch(/<rect[^>]*width="100"[^>]*height="100"[^>]*fill="#1A1F2B"/);
    expect(svg.match(/fill="#FAFAF7"/g)).toHaveLength(2);
  });

  it.each(['favicon.svg', 'mark-graphite.svg', 'mark-paper.svg', 'profile-720.svg'])(
    '%s still scales — the viewBox is intact',
    (name) => {
      expect(readFileSync(`public/brand/${name}`, 'utf8')).toMatch(/viewBox="0 0 100 100"/);
    },
  );

  it.each(['favicon.svg', 'mark-graphite.svg', 'mark-paper.svg', 'profile-720.svg'])(
    'serves %s as the supplied art with ONLY its C2PA metadata removed (T-9-15)',
    (name) => {
      // Phase 9's threat register closed T-9-15 as "SVG metadata stripped" for
      // everything under the world-readable public/brand/. v2's first cut served
      // byte-identical copies and quietly reopened it (and put ~7.7 KB of base64
      // in front of every tab-icon fetch). The art itself is untouched: the
      // served file must equal the supplied one once the supplied one has its
      // <metadata> blob and the now-unused c2pa namespace removed — nothing else.
      const supplied = readFileSync(`logo/backdesk-${name}`, 'utf8');
      const served = readFileSync(`public/brand/${name}`, 'utf8');
      const expected = supplied
        .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
        .replace(' xmlns:c2pa="http://c2pa.org/manifest"', '');

      expect(supplied).toContain('<metadata>');
      expect(served).toBe(expected);
      expect(served).not.toMatch(/metadata|c2pa/i);
      expect(served.length).toBeLessThan(600);
    },
  );
});

describe('no trace of the v1 identity is still being served', () => {
  /*
   * THE v1 FILENAMES ARE NOT LISTED HERE, AND THAT IS DELIBERATE.
   *
   * The two exhaustive directory assertions above — `readdirSync('public/brand')`
   * and `readdirSync('logo')` against EXPECTED and SOURCES — already prove that
   * no v1 lockup, wordmark or mark survives in either place, and they prove it
   * for files nobody thought to enumerate as well. Naming the old files again
   * here would be a weaker check that also leaves the dead names greppable in
   * the repo, which is the thing the swap is trying to end.
   *
   * What the listings cannot see is the BYTES inside a correctly-named file.
   * That is this block.
   */

  it('spends no Ink hex and draws no rounded tile anywhere under public/brand', () => {
    // Byte-level, over every served file including the rasters: an .ico or a
    // .png regenerated from a stale source would still carry the old colour,
    // and the filename would look entirely correct.
    for (const name of readdirSync('public/brand')) {
      const bytes = readFileSync(`public/brand/${name}`).toString('latin1').toLowerCase();

      expect(bytes, `${name} still carries the v1 Ink hex`).not.toContain('14213d');
      expect(bytes, `${name} still draws the v1 rounded tile`).not.toContain('rx="18"');
    }
  });
});

describe('the derived rasters decode to the sizes their platforms demand', () => {
  it('og-image.png is exactly 1200x630 (LAND-06)', () => {
    // Not "about 1200x630". Facebook, LinkedIn and X each re-crop anything else,
    // and the tagline is set 80px from an edge that would move.
    expect(pngSize('public/brand/og-image.png')).toEqual({ width: 1200, height: 630 });
  });

  it('apple-touch-icon.png is exactly 180x180 — iOS ignores the SVG', () => {
    expect(pngSize('public/brand/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });

  it('logo-512.png is exactly 512x512, the size the listings and the JSON-LD want', () => {
    // Google asks for at least 112px and prefers a square; 512 is what the three
    // profile pictures are uploaded at, so the structured-data `logo` and the
    // listings show the same file at the same resolution.
    expect(pngSize('public/brand/logo-512.png')).toEqual({ width: 512, height: 512 });
  });

  it('renders logo-512.png from the SAME opaque square as the touch icon', () => {
    // Not a second render, and not from the transparent `favicon.svg`: a
    // transparent logo composited by somebody else's product lands on whatever
    // background they chose, and a #1A1F2B mark on a dark card is nothing at
    // all. The script downscales the 720px opaque tile both icons come from.
    const script = readFileSync('scripts/brand/render-brand-assets.sh', 'utf8');

    expect(script).toMatch(/sips -z 512 512 "\$TMP\/touch-720\.png" --out "\$OUT\/logo-512\.png"/);
  });

  it('favicon.ico is a real ICO carrying three rasters', () => {
    // ICONDIR: reserved 0x0000, type 0x0001 (icon), then the image count — all
    // little-endian. A PNG renamed to `.ico` is the failure this catches, and
    // Windows/Edge are the platforms that would notice first.
    const ico = readFileSync('public/brand/favicon.ico');

    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
  });

  it('packs the 16, 32 and 48 px rasters, in that order', () => {
    // Each ICONDIRENTRY starts at 6 + 16n; byte 0 is the width, byte 1 the
    // height, and 0 means 256. The order is what a browser picks from.
    const ico = readFileSync('public/brand/favicon.ico');
    const sizes = [0, 1, 2].map((n) => [ico[6 + 16 * n], ico[7 + 16 * n]]);

    expect(sizes).toEqual([
      [16, 16],
      [32, 32],
      [48, 48],
    ]);
  });
});

describe('the well-known ROOT icon paths answer (19 Sep 2026)', () => {
  it.each(ROOT_ICONS)('%s exists', (root) => {
    expect(existsSync(root)).toBe(true);
  });

  it.each(ROOT_ICONS)('%s is byte-identical to %s', (root, brand) => {
    // Equal bytes, not "both are icons": the failure this catches is a re-render
    // that updated one copy, which leaves the tab showing v2 and Google's search
    // results showing v1 — with both files present and both names correct.
    expect(readFileSync(root).equals(readFileSync(brand))).toBe(true);
  });

  it('is written by the render script, not copied by hand', () => {
    // A `cp` somebody ran once is a copy that goes stale at the next re-render.
    const script = readFileSync('scripts/brand/render-brand-assets.sh', 'utf8');

    expect(script).toMatch(/cp "\$OUT\/favicon\.ico" "\$ROOT\/public\/favicon\.ico"/);
    expect(script).toMatch(
      /cp "\$OUT\/apple-touch-icon\.png" "\$ROOT\/public\/apple-touch-icon\.png"/,
    );
  });

  it('is reachable on BOTH hosts — the proxy must not own either path', () => {
    // On the console host an un-excluded path is a 307 to /login; on the apex it
    // is rewritten to 404. Either way the well-known address stays broken, which
    // is the whole defect. `tests/proxy-host-routing.test.ts` asserts the
    // behaviour through Next's own matcher engine; this is the reminder at the
    // asset end, where somebody adding a third root file will be looking.
    const proxy = readFileSync('src/proxy.ts', 'utf8');
    const matcher = proxy.match(/matcher:\s*\['([^']+)'\]/)?.[1] ?? '';

    expect(matcher).toContain('favicon.ico');
    expect(matcher).toContain('apple-touch-icon.png');
  });
});

describe('the root layout points every icon at /brand/ (D-18)', () => {
  const LAYOUT = readFileSync('src/app/layout.tsx', 'utf8');

  it('declares BOTH scheme-scoped SVGs, the ICO and the Apple touch icon', () => {
    // The pair is the whole point: v2's mark is a bare Graphite drawing on a
    // transparent ground, so one SVG cannot serve both tab strips. The .ico
    // stays as the fallback for anything that ignores `media`.
    expect(LAYOUT).toContain("versioned('/brand/favicon.svg')");
    expect(LAYOUT).toContain("media: '(prefers-color-scheme: light)'");
    expect(LAYOUT).toContain("versioned('/brand/mark-paper.svg')");
    expect(LAYOUT).toContain("media: '(prefers-color-scheme: dark)'");
    expect(LAYOUT).toContain('/brand/favicon.ico');
    expect(LAYOUT).toContain('/brand/apple-touch-icon.png');
  });

  it('busts the cache on EVERY icon URL, and on nothing else (19 Sep 2026)', () => {
    // WHY A QUERY STRING AT ALL: the v2 swap changed the bytes under
    // `/brand/favicon.ico`, `favicon.svg` and `apple-touch-icon.png` and kept
    // their URLs. A browser caches a favicon in its own store, outside the HTTP
    // cache, and Vercel serves `public/` immutable — so a returning visitor kept
    // the v1 Ink tile in their tab. That is the bug this task was raised on.
    //
    // Read out of the real metadata object rather than grepped, so the count is
    // the count Next will emit: exactly four icon URLs, every one versioned.
    const urls = [
      ...(metadata.icons as { icon: { url: string }[]; apple: string }).icon.map((i) => i.url),
      (metadata.icons as { apple: string }).apple,
    ];

    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(url).toMatch(/^\/brand\/[a-z0-9.-]+\?v=\d+$/);
    }

    // ONE constant behind all four, so a bump cannot land on three of them.
    const versions = new Set(urls.map((url) => url.split('?v=')[1]));
    expect(versions.size).toBe(1);

    // The version is a HUMAN decision that moves when the drawing moves — not a
    // build id or a content hash, either of which would re-fetch four files on
    // every deploy. v1 -> v2 is the swap of 19 Sep 2026.
    expect(LAYOUT).toMatch(/const BRAND_ASSET_VERSION = 2;/);
    expect([...versions][0]).toBe('2');
  });

  it('leaves the two ROOT paths unversioned — there is no head to read them from', () => {
    // A crawler asking for `/favicon.ico` asks for exactly that. They are new
    // paths as of this change, so no cache holds a v1 of them to bust.
    expect(LAYOUT).not.toMatch(/'\/favicon\.ico\?/);
    expect(LAYOUT).not.toMatch(/'\/apple-touch-icon\.png\?/);
  });

  it('keeps the title and description the brand test pins', () => {
    // Belt and braces with `tests/brand.test.ts`: the icons block is added to
    // the same `metadata` object those three lines live in, and an edit that
    // reformatted the object is exactly how they would be lost.
    expect(LAYOUT).toContain('default: SERVICE_NAME');
    expect(LAYOUT).toContain('description: CONSOLE_DESCRIPTION');
  });

  it('has no Next default favicon left in the app directory', () => {
    // `src/app/favicon.ico` is a file convention: Next emits a `<link>` for it
    // automatically, so leaving it in place puts TWO icons in the head and the
    // browser picks the wrong one about half the time.
    expect(existsSync('src/app/favicon.ico')).toBe(false);
  });
});

describe('the assets are static files, served from the repo (LAND-06)', () => {
  it('is generated by a committed script, not at request time', () => {
    // The prohibition, as a test: nothing renders an image on a request and
    // nothing fetches one from an external host. The script exists so the
    // rasters can be rebuilt, and the PNGs are committed so they never are on
    // the serving path.
    expect(existsSync('scripts/brand/render-brand-assets.sh')).toBe(true);
    expect(existsSync('scripts/brand/og-image.html')).toBe(true);
  });

  it('rasterises the icons from the Graphite TILE, not from the bare mark', () => {
    // The v2 trap, written down where the next edit to the script will hit it:
    // `favicon.svg` is transparent, so an .ico made from it is invisible on a
    // dark tab strip. `profile-720.svg` is the tile that is legible on both.
    const script = readFileSync('scripts/brand/render-brand-assets.sh', 'utf8');

    expect(script).toContain('profile-720.svg');
    expect(script).not.toMatch(/src="favicon\.svg"/);
    expect(script).toContain('#1A1F2B');
    expect(script).not.toMatch(/14213D/i);
  });

  it('composes the OG image from the unserved opaque lockup', () => {
    const og = readFileSync('scripts/brand/og-image.html', 'utf8');

    expect(og).toContain('../../logo/backdesk-lockup-on-paper.png');
    expect(og).not.toContain('public/brand/lockup.png');
  });

  it('keeps the one-off font fetch out of anything that ships', () => {
    // `og-image.html` links Google Fonts, which is correct for a page rendered
    // once on a workstation and would be a third-party request on any page a
    // visitor loads (D-18: no third-party scripts). It is under `scripts/`, not
    // under `src/` or `public/`, and this is what keeps it there.
    const og = readFileSync('scripts/brand/og-image.html', 'utf8');

    expect(og).toContain('fonts.googleapis.com');
    expect(existsSync('public/brand/og-image.html')).toBe(false);
  });

  it('paints the same tagline into the OG image as the alt text names', () => {
    // 16 Oct 2026 (quick 261016-1xw): TAGLINE moved to the missed-call line and
    // the committed PNG had to be re-rendered, because the og:image alt in the
    // root marketing layout is derived from TAGLINE while the picture is baked
    // from this page. The source page is now pinned to the constant so the
    // picture and the alt cannot drift apart again. `&rsquo;` is normalised to
    // a straight apostrophe so a future tagline with one still matches.
    const og = readFileSync('scripts/brand/og-image.html', 'utf8').replaceAll('&rsquo;', "'");

    expect(og).toContain(`<p class="tagline">${TAGLINE}</p>`);
  });
});
