#!/usr/bin/env bash
# Re-render the logo/social-v2 covers from scripts/brand/social-cover.html.
# Positions were measured from the 19 Sep 2026 artwork (bounding boxes of the
# lockup and tagline bands) so a re-render only changes the words.
# Profile pictures and the GBP logo carry no text and are not rendered here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="$ROOT/logo/social-v2"
PAGE="file://$ROOT/scripts/brand/social-cover.html"
render() { # name w h query
  "$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=5000 --window-size="$2,$3" \
    --screenshot="$OUT/$1" "$PAGE?w=$2&h=$3&$4" 2>/dev/null
  echo "rendered $1"
}
render backdesk-fb-cover-1640x624-graphite.png 1640 624 "bg=graphite&layout=stack&lockupW=826&lockupCY=0.406&tagY=0.607&tagSize=38"
render backdesk-fb-cover-1640x624-paper.png    1640 624 "bg=paper&layout=stack&lockupW=826&lockupCY=0.406&tagY=0.607&tagSize=38"
render backdesk-wa-cover-2422x1362-graphite.png 2422 1362 "bg=graphite&layout=side&lockupX=284&lockupW=788&lockupCY=0.3007&tagSize=56"
render backdesk-wa-cover-2422x1362-paper.png    2422 1362 "bg=paper&layout=side&lockupX=284&lockupW=788&lockupCY=0.3007&tagSize=56"
render backdesk-gbp-cover-1080x608.png          1080 608 "bg=paper&layout=stack&lockupW=671&lockupCY=0.44&tagY=0.609&tagSize=31"
