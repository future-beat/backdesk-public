#!/usr/bin/env bash
#
# Regenerate the DERIVED brand assets under public/brand/.
#
# One-off, run by hand, never in CI and never on a request path: the outputs are
# committed static files so that a link preview or a browser tab fetches bytes
# from the repo and nothing renders an image at serve time (LAND-06).
#
# WHAT THIS DOES NOT DO: draw anything. The lockups, both wordmarks, the mark
# and the profile tile are SUPPLIED art (logo v2, 19 Sep 2026) — committed in
# logo/ as the source of record and copied into public/brand/ byte-identical.
# This script only rasterises the supplied art into the formats browsers demand
# and composes the Open Graph image from the opaque lockup. Recolouring,
# respacing or redrawing any of it is forbidden (logo/README.txt).
#
# WHY CHROME: this machine has no ImageMagick, rsvg or Inkscape, and `sips`
# cannot rasterise an SVG. Headless Chrome can, it is already installed for
# Lighthouse, and it is the same renderer the artwork will be viewed in.
#
# NO DEPENDENCY AT ALL: Chrome, `sips` and node. The .ico is packed inline (see
# the note above that step) rather than through `npx png-to-ico`, so this script
# fetches nothing and installs nothing.
#
# Usage:
#   scripts/brand/render-brand-assets.sh
#   CHROME=/path/to/chrome scripts/brand/render-brand-assets.sh
#
# Inputs (supplied art, never written by this script):
#   public/brand/profile-720.svg      the Graphite tile with the Paper mark
#   logo/backdesk-lockup-on-paper.png the 3696x928 opaque lockup, NOT served
#
# Outputs (all overwritten):
#   public/brand/favicon.ico          16/32/48 rasters of profile-720.svg
#   public/brand/apple-touch-icon.png 180x180, opaque
#   public/brand/logo-512.png         512x512, opaque — the structured-data logo
#   public/brand/og-image.png         1200x630, composed from the opaque lockup
#   public/favicon.ico                copy of the above, at the ROOT path
#   public/apple-touch-icon.png       copy of the above, at the ROOT path
#
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/public/brand"

# EVERY PATH EXPANSION IN THIS FILE IS QUOTED, AND THAT IS LOAD-BEARING SINCE
# 17 Sep 2026: the repo lives under `~/Documents/Venture building/Backdesk`, so
# an unquoted "$ROOT" splits into two arguments and Chrome renders `about:blank`
# into a plausible, blank PNG. `file://` URLs get the space percent-encoded as
# well — Chrome accepts a raw space in an argument but not inside a URL.
url_for() { printf 'file://%s' "${1// /%20}"; }

if [ ! -x "$CHROME" ]; then
  echo "No Chrome at: $CHROME" >&2
  echo "Set CHROME=/path/to/chrome and re-run." >&2
  exit 1
fi

for required in \
  "$OUT/profile-720.svg" \
  "$ROOT/logo/backdesk-lockup-on-paper.png" \
  "$ROOT/scripts/brand/og-image.html"; do
  if [ ! -f "$required" ]; then
    echo "Missing input: $required" >&2
    exit 1
  fi
done

# STRIP SVG METADATA (T-9-15). The supplied SVGs carry a ~7.7 KB C2PA manifest.
# logo/ keeps it; public/brand/ is world-readable and serves the art without it.
# Geometry and fills are untouched — only <metadata> and its namespace go.
for svg in favicon mark-graphite mark-paper profile-720; do
  node -e '
    const fs = require("fs");
    const [src, out] = process.argv.slice(1);
    const s = fs.readFileSync(src, "utf8")
      .replace(/<metadata>[\s\S]*?<\/metadata>/, "")
      .replace(" xmlns:c2pa=\"http://c2pa.org/manifest\"", "");
    fs.writeFileSync(out, s);
  ' "$ROOT/logo/backdesk-$svg.svg" "$OUT/$svg.svg"
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Chrome flags used throughout:
#   --headless=new             no window, no profile prompt
#   --hide-scrollbars          a scrollbar would eat pixels off the right edge
#   --force-device-scale-factor=1  --window-size is then the exact pixel size
#   --virtual-time-budget      wait for the image and the webfont to load
CHROME_FLAGS=(
  --headless=new
  --hide-scrollbars
  --force-device-scale-factor=1
  --disable-gpu
  --no-first-run
  --virtual-time-budget=10000
)

# ── 1. The tab icon, rasterised ───────────────────────────────────────────────
#
# FROM `profile-720.svg`, NOT FROM `favicon.svg`, AND THAT IS THE v2 DECISION.
# v1's favicon.svg drew its own Ink tile (`<rect rx="18">`) behind the mark, so
# a raster of it was legible on any browser chrome. v2's is the BARE Graphite
# mark on a transparent ground: rasterised straight, it is a #1A1F2B shape on
# whatever the tab strip happens to be, which on a dark strip is nothing at all.
# `profile-720.svg` is the supplied tile — a full-bleed Graphite square with the
# Paper mark at 56% — so it reads on light chrome and dark chrome alike without
# anything here touching the artwork. The bare mark still ships as an SVG icon,
# scheme-scoped in `src/app/layout.tsx`, which is where that problem belongs.
#
# Rendered once at 720px and downscaled with `sips`, rather than screenshotting
# a 16x16 window: Chrome clamps very small window sizes, and a square with two
# flat-sided paths in it downsamples cleanly.

cat > "$TMP/mark.html" <<'HTML'
<!doctype html>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  img { display: block; width: 100vw; height: 100vh; }
</style>
<img src="profile-720.svg" alt="" />
HTML
cp "$OUT/profile-720.svg" "$TMP/profile-720.svg"

echo "rendering the tile at 720px…"
"$CHROME" "${CHROME_FLAGS[@]}" \
  --default-background-color=00000000 \
  --window-size=720,720 \
  --screenshot="$TMP/tile-720.png" \
  "$(url_for "$TMP/mark.html")" 2>/dev/null

for size in 16 32 48; do
  sips -z "$size" "$size" "$TMP/tile-720.png" --out "$TMP/$size.png" > /dev/null
done

# The ICO is packed here, in fifteen lines of node, rather than by `npx
# png-to-ico`. That package works, and its legitimacy was audited — but v3
# appends an upscaled 256x256 UNCOMPRESSED entry to whatever it is given,
# turning a three-raster favicon into a 285 KB file. A favicon is fetched on
# every cold page load and LAND-06 wants Lighthouse >= 90 on a phone, so that
# is not a cosmetic difference. Packing it directly also drops a network fetch
# and a third-party package from this script entirely (T-9-SC).
#
# ICO layout: a 6-byte ICONDIR (reserved 0, type 1, image count), then one
# 16-byte ICONDIRENTRY per image (width, height — 0 meaning 256 — colour count,
# reserved, planes, bit depth, byte length, offset), then the image payloads.
# The payloads are the PNGs themselves: PNG-compressed ICO entries are
# understood by every browser from IE11 on, and a BMP payload would be four
# times the size for the same pixels.
echo "packing favicon.ico (16, 32, 48)…"
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const [out, ...inputs] = process.argv.slice(1);
const pngs = inputs.map((p) => readFileSync(p));
const dir = Buffer.alloc(6 + 16 * pngs.length);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(pngs.length, 4);
let offset = dir.length;
pngs.forEach((png, i) => {
  const at = 6 + 16 * i;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  dir.writeUInt8(width === 256 ? 0 : width, at);
  dir.writeUInt8(height === 256 ? 0 : height, at + 1);
  dir.writeUInt16LE(1, at + 4);
  dir.writeUInt16LE(32, at + 6);
  dir.writeUInt32LE(png.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
writeFileSync(out, Buffer.concat([dir, ...pngs]));
' "$OUT/favicon.ico" "$TMP/16.png" "$TMP/32.png" "$TMP/48.png"

# ── 2. The Apple touch icon ───────────────────────────────────────────────────
#
# OPAQUE, deliberately. iOS applies its own superellipse mask to this file and
# composites anything transparent onto black — so a transparent PNG gets four
# black wedges on a home screen. `profile-720.svg` is full-bleed Graphite
# already; the page background below is the same #1A1F2B as a second guarantee,
# so a resample that softens the tile's outermost pixel row cannot leak white
# into it.
#
# Rendered at 720 and downscaled, NOT screenshotted at 180: Chrome clamps a
# window below roughly 400px wide and screenshots the clamped viewport, which
# produced a 180x180 crop of the TOP-LEFT of an oversized mark — a plain Ink
# square with one corner of the bar showing. The size read-back at the end of
# this script would not have caught it; the file was exactly 180x180 and
# exactly wrong.

cat > "$TMP/touch.html" <<'HTML'
<!doctype html>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: #1A1F2B; }
  img { display: block; width: 100vw; height: 100vh; }
</style>
<img src="profile-720.svg" alt="" />
HTML

echo "rendering apple-touch-icon.png at 180px…"
"$CHROME" "${CHROME_FLAGS[@]}" \
  --window-size=720,720 \
  --screenshot="$TMP/touch-720.png" \
  "$(url_for "$TMP/touch.html")" 2>/dev/null

sips -z 180 180 "$TMP/touch-720.png" --out "$OUT/apple-touch-icon.png" > /dev/null

# ── 2b. The listings logo ─────────────────────────────────────────────────────
#
# THE SAME SQUARE, AT 512, FOR THE STRUCTURED DATA (19 Sep 2026).
#
# `logo` on the ProfessionalService block is the image Google may show beside the
# business, and the drawing it must show is the one already uploaded as the
# profile picture on the Google Business Profile, Facebook and WhatsApp — the
# supplied Graphite tile. Two pictures of one business is exactly the ambiguity
# that block exists to remove.
#
# DOWNSCALED FROM THE SAME 720px OPAQUE RENDER as the touch icon, not rendered
# again: one render, one drawing, and no second Chrome invocation whose flags
# could drift from the first. Opaque for the touch icon's reason turned outward —
# a transparent PNG composited by somebody else's product lands on whatever
# background they chose, and a #1A1F2B mark on a dark card is nothing at all.
#
# 512 because that is the size the three profiles want and comfortably above
# Google's 112px floor for an organisation logo.

echo "rendering logo-512.png at 512px…"
sips -z 512 512 "$TMP/touch-720.png" --out "$OUT/logo-512.png" > /dev/null

# ── 3. The same two icons, at the ROOT paths ──────────────────────────────────
#
# `/favicon.ico` and `/apple-touch-icon.png` are WELL-KNOWN ADDRESSES, not
# <link> targets, and that is the whole reason these copies exist. Google's
# search-result favicon crawler, most link unfurlers, an RSS reader and Safari's
# older touch-icon lookup all request the root path DIRECTLY and never read the
# document head — so `icons` in `src/app/layout.tsx` does nothing for any of
# them, and before this step both paths 404'd on both hosts (open since Phase 9).
#
# COPIES, NOT A SECOND RENDER: identical bytes to the `public/brand/` pair, so
# there is exactly one drawing and `tests/brand-assets.test.ts` can assert the
# equality. A file in `public/` emits NO <link> of its own (that is the
# `src/app/` file convention, which stays deliberately empty — see the comment
# on the `icons` block), so the head still declares exactly the four links it
# was designed to.
#
# The proxy has to let both through on the console host, or the app domain
# answers a 307 to /login for an icon — `src/proxy.ts` excludes them by name and
# `tests/proxy-host-routing.test.ts` pins it.

echo "copying both icons to the root paths…"
cp "$OUT/favicon.ico" "$ROOT/public/favicon.ico"
cp "$OUT/apple-touch-icon.png" "$ROOT/public/apple-touch-icon.png"

# ── 4. The Open Graph image ───────────────────────────────────────────────────
#
# Composed by scripts/brand/og-image.html, which links Google Fonts for Inter
# and reads the opaque lockup out of logo/. Both fetches happen here, once, and
# never on a page a visitor loads.
#
# `--allow-file-access-from-files` is NOT needed: the lockup is an <img>, not a
# fetch, and Chrome loads a sibling file:// image without it.

echo "rendering og-image.png at 1200x630…"
"$CHROME" "${CHROME_FLAGS[@]}" \
  --window-size=1200,630 \
  --screenshot="$OUT/og-image.png" \
  "$(url_for "$ROOT/scripts/brand/og-image.html")" 2>/dev/null

# ── 5. Read the sizes back ────────────────────────────────────────────────────
#
# The script asserts its own output, because a Chrome flag that stopped being
# honoured would otherwise produce a plausible file at the wrong size and the
# only symptom would be a cropped link preview weeks later. `tests/brand-assets.test.ts`
# pins the same numbers on every run.

node -e '
const { readFileSync } = require("node:fs");
const size = (p) => {
  const b = readFileSync(p);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const check = (p, w, h) => {
  const [gw, gh] = size(p);
  if (gw !== w || gh !== h) throw new Error(`${p}: expected ${w}x${h}, got ${gw}x${gh}`);
  console.log(`  ok ${p} ${gw}x${gh}`);
};
check(process.argv[1] + "/og-image.png", 1200, 630);
check(process.argv[1] + "/apple-touch-icon.png", 180, 180);
check(process.argv[1] + "/logo-512.png", 512, 512);
const ico = readFileSync(process.argv[1] + "/favicon.ico");
if (ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) !== 3) throw new Error("favicon.ico is not an ICO with 3 images");
console.log("  ok favicon.ico 3 rasters");
// The root copies, by bytes: `cp` of a path that moved would leave a stale
// file at the well-known address and nothing else here would notice.
for (const name of ["favicon.ico", "apple-touch-icon.png"]) {
  const a = readFileSync(process.argv[1] + "/" + name);
  const b = readFileSync(process.argv[1] + "/../" + name);
  if (!a.equals(b)) throw new Error("public/" + name + " is not a copy of public/brand/" + name);
  console.log(`  ok public/${name} == public/brand/${name}`);
}
' "$OUT"

echo "done — commit the six regenerated files."
