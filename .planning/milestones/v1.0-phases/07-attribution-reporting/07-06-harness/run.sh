#!/usr/bin/env bash
# 07-06 print harness — runs the print fixture through headless Chrome and
# (when swiftc is available) through WebKit, and asserts the G-07-1 / G-07-2
# truths on the output. Exit 1 on any FAIL. Never touches the database.
#
#   bash .planning/phases/07-attribution-reporting/07-06-harness/run.sh
#
# Overrides (for testing the harness itself against patched copies):
#   GLOBALS_CSS=<path> REPORT_CSS=<path> OUT=<dir>
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$(cd "$HERE/../../../.." && pwd)}"
GLOBALS_CSS="${GLOBALS_CSS:-$ROOT/src/app/globals.css}"
REPORT_CSS="${REPORT_CSS:-$ROOT/src/app/(console)/reports/[client]/[reportId]/report.css}"
OUT="${OUT:-$(mktemp -d)}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
# Minimum code points of the 60-point frozen description that must reach paper,
# on the WORSE engine. See the assertion in check_pdf.
DESC_FLOOR="${DESC_FLOOR:-22}"
fail=0; pass() { echo "  PASS  $1"; }; failed() { echo "  FAIL  $1"; fail=1; }; info() { echo "  INFO  $1"; }

for tool in node pdftotext pdfinfo; do command -v "$tool" >/dev/null || { echo "missing tool: $tool"; exit 2; }; done
[ -x "$CHROME" ] || { echo "missing Google Chrome at $CHROME"; exit 2; }

node "$HERE/gen.mjs" "$OUT" "$GLOBALS_CSS" "$REPORT_CSS" >/dev/null || exit 2

# Per-page facts from a PDF: prints "page chars rows rowsWithoutDollar header fragment first"
page_facts() {
  local pdf="$1" n p txt first chars rows nodollar header fragment
  n=$(pdfinfo "$pdf" | awk '/^Pages/{print $2}')
  for p in $(seq 1 "$n"); do
    txt=$(pdftotext -layout -f "$p" -l "$p" "$pdf" -)
    first=$(printf '%s\n' "$txt" | grep -v '^[[:space:]]*$' | head -1 | sed 's/^[[:space:]]*//' | cut -c1-60)
    chars=$(printf '%s' "$txt" | tr -d '[:space:]' | wc -c | tr -d ' ')
    rows=$(printf '%s\n' "$txt" | grep -c '^#4')
    nodollar=$(printf '%s\n' "$txt" | grep '^#4' | grep -vc '\$')
    header=0; case "$first" in JOB*) header=1;; esac
    # A page that opens with a lowercase word, a bracket, an ellipsis or a bare
    # month tail is the tail of a row cut at the fold.
    fragment=0; if printf '%s' "$first" | grep -qE '^([a-z]|\)|…|Aug\))'; then fragment=1; fi
    echo "$p $chars $rows $nodollar $header $fragment $first"
  done
}

check_pdf() { # $1 label, $2 pdf, $3 expect-header-repeat (1 = assert, 0 = info only)
  local label="$1" pdf="$2" expect="$3" facts n last lastchars rowsplit=0 frag=0 miss=0 hdrpages=0 rowpages=0
  [ -s "$pdf" ] || { failed "$label: no PDF produced"; return; }
  facts=$(page_facts "$pdf"); n=$(echo "$facts" | wc -l | tr -d ' ')
  echo "$facts" | sed "s/^/        $label p/"
  lastchars=$(echo "$facts" | tail -1 | awk '{print $2}')
  [ "$lastchars" -gt 0 ] && pass "$label: last page carries text (no trailing blank page)" || failed "$label: last page is blank"
  rowsplit=$(echo "$facts" | awk '{s+=$4} END{print s+0}')
  [ "$rowsplit" -eq 0 ] && pass "$label: every job row keeps its dollar figures on its own page" || failed "$label: $rowsplit row(s) lost their figures across a fold"
  frag=$(echo "$facts" | awk '{s+=$6} END{print s+0}')
  [ "$frag" -eq 0 ] && pass "$label: no page opens with the tail of a cut row" || failed "$label: $frag page(s) open with a row fragment"
  if pdftotext -layout "$pdf" - | grep -q '^#4200 · '; then pass "$label: job id and description are separated (#4200 · …)"; else failed "$label: job id runs into its description"; fi
  # THE COST OF THE ONE-LINE-BOX BUDGET, PRICED (07-06 review, CR-01).
  # The fixture description is the full 60-code-point freeze. The printed cell
  # shows a prefix of it and no more — a PDF has no hover, so whatever is cut
  # here is cut from the artifact that gets stapled to an invoice. Measured
  # 2026-09-03 at max-width 13rem: 25 code points on Chromium, 22 on WebKit.
  # The floor is set at the WebKit number so this fails LOUDLY if the Job cap is
  # lowered again, or if the width reclaimed from Follow-ups/Customer/padding is
  # spent on another column. Raise the floor when a change earns it; never lower
  # it silently. Residual gap to the 60-point freeze: .planning/WINDOWS.md.
  local desc
  desc=$(pdftotext -layout "$pdf" - | grep -m1 '^#4200 · ' \
    | node -e 'const s=require("fs").readFileSync(0,"utf8").replace(/^#4200 · /,"");const i=s.indexOf("\u2026");process.stdout.write(String(i<0?[...s.split(/\s\s+/)[0]].length:[...s.slice(0,i)].length))')
  if [ "${desc:-0}" -ge "$DESC_FLOOR" ]; then
    pass "$label: $desc code points of the job description survive (floor $DESC_FLOOR of the 60 frozen)"
  else
    failed "$label: only $desc code points of the job description survive (floor $DESC_FLOOR) — the Job cell lost width"
  fi
  rowpages=$(echo "$facts" | awk 'NR>1 && $3>0 {c++} END{print c+0}')
  hdrpages=$(echo "$facts" | awk 'NR>1 && $3>0 && $5==1 {c++} END{print c+0}')
  if [ "$expect" = "1" ]; then
    [ "$rowpages" -gt 0 ] && [ "$hdrpages" -eq "$rowpages" ] && pass "$label: header repeated on all $rowpages continuation page(s) carrying rows" || failed "$label: header on $hdrpages of $rowpages continuation page(s) carrying rows"
  else
    info "$label: header repeated on $hdrpages of $rowpages continuation page(s) carrying rows (WebKit does not repeat table header groups — recorded engine debt, not asserted)"
  fi
}

echo "== A. structural (Chrome, print block applied on screen) =="
for w in 661 688; do
  m=$("$CHROME" --headless=new --disable-gpu --window-size=760,1600 --virtual-time-budget=1500 --dump-dom "file://$OUT/sheet-measure-$w.html" 2>/dev/null | grep -o '<pre id="measure">[^<]*' | sed 's/<pre id="measure">//;s/&quot;/"/g')
  echo "        $w px: $m"
  [ -n "$m" ] || { failed "measure at ${w}px produced no output"; continue; }
  v() { printf '%s' "$m" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));const k=process.argv[1];console.log(o[k])' "$1"; }
  if awk -v g="$(v trailingGap)" 'BEGIN{exit !(g < 1 && g > -1)}'; then pass "${w}px: no zero-ink height after the footer (G-07-1)"; else failed "${w}px: $(v trailingGap)px of zero-ink height after the footer (G-07-1)"; fi
  [ "$(v wrappedRows)" = "0" ] && pass "${w}px: every job row is one line box" || failed "${w}px: $(v wrappedRows) row(s) taller than one line box"
  [ "$(v tableFits)" = "true" ] && pass "${w}px: seven columns fit the column (no clipped Conservative)" || failed "${w}px: table wider than the column"
  [ "$(v tableScrollOverflow)" = "visible" ] && pass "${w}px: .table-scroll computes overflow visible in print" || failed "${w}px: .table-scroll overflow-x is $(v tableScrollOverflow)"
  [ "$(v theadBreakInside)" = "avoid" ] && pass "${w}px: thead computes break-inside: avoid" || failed "${w}px: thead break-inside is $(v theadBreakInside)"
  [ "$(v jobCellDisplay)" = "block" ] && pass "${w}px: Job cell span is a block" || failed "${w}px: Job cell span display is $(v jobCellDisplay)"
done

echo "== B. Chromium print (Google Chrome, A4, @page margins) =="
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT/chrome.pdf" "file://$OUT/sheet.html" >/dev/null 2>&1
check_pdf chrome "$OUT/chrome.pdf" 1

echo "== C. WebKit print (WKWebView, 1px = 1pt, iOS-measured margins) =="
if command -v swiftc >/dev/null; then
  if [ ! -x "$OUT/wkprint" ]; then swiftc -O "$HERE/wkprint.swift" -o "$OUT/wkprint" 2>/dev/null || { failed "wkprint.swift did not compile"; }; fi
  if [ -x "$OUT/wkprint" ]; then
    WK_MARGIN_PT="${WK_MARGIN_PT:-49.7}" "$OUT/wkprint" "$OUT/sheet.html" "$OUT/webkit.pdf" >/dev/null 2>&1
    check_pdf webkit "$OUT/webkit.pdf" 0
  fi
else
  info "swiftc not found — WebKit leg skipped; iPhone Safari is verified by hand"
fi

echo; echo "artifacts: $OUT"
[ "$fail" -eq 0 ] && echo "RESULT: PASS" || { echo "RESULT: FAIL"; exit 1; }
