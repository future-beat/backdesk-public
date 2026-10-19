#!/usr/bin/env bash
# 07-06 nav harness — asserts the G-07-3 truths AND the quick-260904-dwt
# scroll-row truths on the console bar at 390px (the reported phone), 604px (the
# old one-line threshold) and 700px (desktop) in headless Chrome.
#
# G-07-3: the document is never wider than the viewport, every tap box clears
# 44px, no two hit boxes intersect, no label breaks mid-phrase.
# quick-260904-dwt: the bar is ONE row at every width; the LINK ROW is the box
# that scrolls; Inbox and Queue — the two screens with a clock on them — need no
# swipe; something is visibly cut or faded at the right edge so the row reads as
# scrollable; a focus ring has >= 3px of headroom inside the scroll container;
# and Sign out comes fully into view both by keyboard focus and by scrolling the
# row to its end. At 700px nothing scrolls and there is no fade.
#
# THE MEASURE OF "THE BAR FITS" IS `barRight`, NOT `navRight`. Once the row
# holds its own overflow, the all-descendants maximum reads the row's scrollable
# content (651px at 390px) — a fact about the row's scroll box, not about the
# page. `barRight` is the brand and the row's OWN box. `navRight` survives as
# the 700px gate, where nothing may scroll and so every item must be inside.
#
# Exit 1 on any FAIL. Overrides: GLOBALS_CSS=<path> OUT=<dir> CHROME=<binary>
#
# `GLOBALS_CSS=` is also how the NEGATIVE CONTROL is run — point it at
# `git show 898bce3:src/app/globals.css` (the 07-06 wrapping bar) and this
# script must print RESULT: FAIL on the row-scroll and one-row gates.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$(cd "$HERE/../../../.." && pwd)}"
GLOBALS_CSS="${GLOBALS_CSS:-$ROOT/src/app/globals.css}"
OUT="${OUT:-$(mktemp -d)}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
fail=0; pass() { echo "  PASS  $1"; }; failed() { echo "  FAIL  $1"; fail=1; }
info() { echo "  INFO  $1"; }
# Ring headroom is a one-decimal float (3.7px at 700px), which `[ -ge ]` cannot
# read at all — it errors and the gate passes by accident.
ge() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a >= b) }'; }
command -v node >/dev/null || { echo "missing tool: node"; exit 2; }
[ -x "$CHROME" ] || { echo "missing Google Chrome at $CHROME"; exit 2; }
node "$HERE/gen-nav.mjs" "$OUT" "$GLOBALS_CSS" 390 604 700 || exit 2
for w in 390 604 700; do
  m=$("$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --window-size=900,900 --virtual-time-budget=1500 --dump-dom "file://$OUT/outer-$w.html" 2>/dev/null | grep -o '<pre id="m">[^<]*' | sed 's/<pre id="m">//;s/&quot;/"/g')
  echo "        ${w}px: $m"
  [ -n "$m" ] || { failed "${w}px: no measurement"; continue; }
  v() { printf '%s' "$m" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));const x=o[process.argv[1]];console.log(Array.isArray(x)?x.join(","):x)' "$1"; }

  # ── G-07-3: the page itself, and every hit box in the bar ────────────────
  [ "$(v docScrollWidth)" = "$w" ] && pass "${w}px: document is exactly viewport-wide (no sideways page scroll)" || failed "${w}px: document scrolls to $(v docScrollWidth)px"
  [ "$(v barRight)" -le "$w" ] && pass "${w}px: the console bar — brand and the link row's own box — is inside the viewport" || failed "${w}px: the console bar reaches $(v barRight)px"
  [ "$(v signOutBox)" -ge 44 ] && pass "${w}px: Sign out tap box is $(v signOutBox)px (>= 44)" || failed "${w}px: Sign out tap box is $(v signOutBox)px"
  # EVERY tappable thing, not just Sign out (06-UI-SPEC:51; 07-06 review WR-02).
  [ "$(v minTapBox)" -ge 44 ] && pass "${w}px: smallest nav tap box is $(v minTapBox)px (>= 44, '$(v minTapLabel)')" || failed "${w}px: '$(v minTapLabel)' tap box is only $(v minTapBox)px"
  # No hit box may sit inside another's, whatever bought it its height (WR-03).
  [ -z "$(v overlaps)" ] && pass "${w}px: no two nav hit boxes intersect" || failed "${w}px: nav hit boxes intersect: $(v overlaps)"
  [ -z "$(v brokenMidPhrase)" ] && pass "${w}px: no label breaks mid-phrase" || failed "${w}px: labels broken mid-phrase: $(v brokenMidPhrase)"

  # ── quick-260904-dwt: ONE row, at every width ────────────────────────────
  # The operator's actual complaint. 176px of chrome on a 390px phone was three
  # of these; the row scrolls sideways now so the bar costs one line everywhere.
  if [ "$(v navLines)" = "1" ] && [ "$(v navHeight)" -le 72 ]; then
    pass "${w}px: bar is one row of $(v navHeight)px"
  else
    failed "${w}px: bar is $(v navLines) lines / $(v navHeight)px, not one row"
  fi

  if [ "$w" = 700 ]; then
    # Desktop: nothing scrolls, so the all-descendants measure applies again.
    [ "$(v navRight)" -le "$w" ] && pass "700px: every nav item is inside the viewport (nothing scrolls here)" || failed "700px: nav content reaches $(v navRight)px"
    [ "$(v rowScrollable)" = "false" ] && pass "700px: the link row does not scroll — desktop bar unchanged" || failed "700px: the link row scrolls on desktop (scrollWidth $(v rowScrollWidth), clientWidth $(v rowClientWidth))"
    [ "$(v navHeight)" = "72" ] && pass "700px: bar is exactly 72px (desktop unchanged)" || failed "700px: desktop bar is $(v navHeight)px, was 72px"
    # An INACTIVE scroll timeline never applies the animation, so this reading
    # is deterministic even in a frame-starved headless run — unlike the fade's
    # PRESENCE at a scrolling width, which is reported as INFO below.
    case "$(v maskAtRest)" in
      *"calc("*) failed "700px: a fade is drawn over a row that does not scroll ($(v maskAtRest))" ;;
      *) pass "700px: no fade where nothing overflows" ;;
    esac
  else
    # ── the row is the box that holds the overflow ─────────────────────────
    if [ "$(v rowScrollable)" = "true" ]; then
      pass "${w}px: the link row scrolls inside the bar ($(v rowClientWidth)px box, $(v rowScrollWidth)px of content)"
    else
      failed "${w}px: the link row does not scroll (scrollWidth $(v rowScrollWidth), clientWidth $(v rowClientWidth))"
    fi
    [ "$(v rowOverflowX)" = "auto" ] && pass "${w}px: the row is an overflow-x: auto scroll container" || failed "${w}px: the row's overflow-x is $(v rowOverflowX), not auto"
    # Without scroll-padding-inline the snap lands on the first item's edge and
    # eats the ring padding — scrollLeft 4 at rest, headroom 0.
    [ "$(v restScrollLeft)" = "0" ] && pass "${w}px: the row rests at its own start (scrollLeft 0)" || failed "${w}px: the row rests at scrollLeft $(v restScrollLeft), not 0"
    case ",$(v visibleAtRest)," in
      *,Inbox,*) inbox=yes ;; *) inbox=no ;;
    esac
    case ",$(v visibleAtRest)," in
      *,Queue,*) queue=yes ;; *) queue=no ;;
    esac
    if [ "$inbox" = yes ] && [ "$queue" = yes ]; then
      pass "${w}px: Inbox and Queue need no swipe (visible at rest: $(v visibleAtRest))"
    else
      failed "${w}px: the two clocked screens are not both visible at rest ($(v visibleAtRest))"
    fi
    # THE CUE, in the three states this probe can honestly tell apart. A cut
    # item and a rendered fade are the same promise — more exists to the right —
    # but WHICH of them is available depends on the width, and the fade's
    # rendered state depends on the engine having run a frame.
    #
    # 390px cuts Reports, so the strongest reading is available there. 604px
    # does NOT cut anything: the row's right edge lands in the GAP between Email
    # and Sign out, so the fade is the only cue that width has — and headless
    # Chrome under --dump-dom advances no scroll timeline, so the mask reads as
    # its 100%-opaque fallback whatever the CSS says. Gating on the RENDERED
    # fade there would gate on a frame the harness cannot produce.
    #
    # So the third branch asserts the fade is WIRED — the row's computed mask is
    # the gradient, not `none`. That still fails the 07-06 CSS (no mask at all),
    # which is the negative control this file exists to satisfy; the fade's
    # ACTUAL travel is the iPhone human check, reported as INFO below.
    if [ -n "$(v cutAtRest)" ]; then
      pass "${w}px: '$(v cutAtRest)' is cut at the right edge — the row reads as scrollable"
    else
      case "$(v maskAtRest)" in
        *"calc("*) pass "${w}px: the right-edge fade cues the overflow ($(v maskAtRest))" ;;
        linear-gradient*) pass "${w}px: nothing is cut here, and the right-edge fade is wired to cue it (mask $(v maskAtRest); headless cannot advance a scroll timeline — see INFO)" ;;
        *) failed "${w}px: nothing cues the overflow — no item cut and no fade ($(v maskAtRest))" ;;
      esac
    fi
    # A scroll container clips whatever is painted outside its padding box, so a
    # 3px focus ring needs 3px of padding it does not otherwise have.
    ge "$(v firstRingHeadroom)" 3 && pass "${w}px: first item has $(v firstRingHeadroom)px of ring headroom (>= 3)" || failed "${w}px: first item has only $(v firstRingHeadroom)px of ring headroom"
    ge "$(v lastRingHeadroom)" 3 && pass "${w}px: focused last item has $(v lastRingHeadroom)px of ring headroom (>= 3)" || failed "${w}px: focused last item has only $(v lastRingHeadroom)px of ring headroom"
    # The row carries no tabIndex, unlike .table-scroll: it is full of focusable
    # children, so focus is what scrolls it. Measured, not assumed.
    [ "$(v focusScrollsLastIn)" = "true" ] && pass "${w}px: keyboard focus scrolls Sign out into view without a tabIndex" || failed "${w}px: focusing Sign out does not bring it inside the row"
    [ "$(v endShowsSignOut)" = "true" ] && pass "${w}px: one swipe reaches Sign out (scrollLeft $(v endScrollLeft) of $(v endMaxScroll))" || failed "${w}px: Sign out is still not fully visible at the end of the row"
  fi

  if [ "$w" != 700 ]; then
    # INFO, NOT A GATE. Headless Chrome under --dump-dom produces almost no
    # animation frames inside an iframe, so a scroll-driven fade reads as its
    # 100%-opaque fallback here whatever the CSS says — measured `--nav-fade:
    # 0px` at 320 / 390 / 604 on the shipped tree. The cue gate above does not
    # depend on it; the fade's travel (2.5rem at rest, collapsing to 0 at the
    # end so Sign out is never dimmed) is the iPhone human check, where iOS 26.5
    # Safari does support scroll-driven animations.
    info "${w}px: mask at rest $(v maskAtRest) / --nav-fade $(v fadeAtRest)"
  fi
done
echo; echo "artifacts: $OUT"
[ "$fail" -eq 0 ] && echo "RESULT: PASS" || { echo "RESULT: FAIL"; exit 1; }
