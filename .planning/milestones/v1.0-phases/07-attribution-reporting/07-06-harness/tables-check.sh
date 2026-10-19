#!/usr/bin/env bash
# 07-07 table harness — asserts the G-07-6 truth on every console table that
# was found outside `.table-scroll` (plus the /reports control) at 390px (the
# reported phone) and 1000px (desktop, where the wrapper must be inert) in
# headless Chrome. The wrapper in each fixture is READ FROM THE SHIPPED .tsx
# (see gen-tables.mjs), so this fails on today's source and passes once the
# four tables are wrapped. Exit 1 on any FAIL. Never touches the database.
#
#   bash .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh
#
# Overrides (for testing the harness itself against patched copies):
#   ROOT=<project root whose src/ to read> OUT=<dir> CHROME=<binary>
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$(cd "$HERE/../../../.." && pwd)}"
OUT="${OUT:-$(mktemp -d)}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
fail=0; pass() { echo "  PASS  $1"; }; failed() { echo "  FAIL  $1"; fail=1; }
command -v node >/dev/null || { echo "missing tool: node"; exit 2; }
[ -x "$CHROME" ] || { echo "missing Google Chrome at $CHROME"; exit 2; }

names=$(node "$HERE/gen-tables.mjs" "$OUT" "$ROOT" 390 1000) || exit 2

measure() { # $1 fixture name, $2 width → JSON or empty
  "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --window-size=1200,900 --virtual-time-budget=1500 --dump-dom "file://$OUT/outer-$1-$2.html" 2>/dev/null \
    | grep -o '<pre id="m">[^<]*' | sed 's/<pre id="m">//;s/&quot;/"/g'
}
v() { printf '%s' "$m" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));const x=o[process.argv[1]];console.log(Array.isArray(x)?x.join(","):x)' "$1"; }

echo "== 390px: every console table scrolls inside its own box; the document never widens =="
for n in $names; do
  m=$(measure "$n" 390)
  echo "        $n: $m"
  [ -n "$m" ] || { failed "$n @390: no measurement"; continue; }
  [ "$(v wrapperInSource)" = "true" ] && pass "$n @390: <table> is inside .table-scroll in the shipped .tsx" || failed "$n @390: <table> has no .table-scroll wrapper in the shipped .tsx"
  [ "$(v docScrollWidth)" = "390" ] && pass "$n @390: document is exactly viewport-wide (no sideways page scroll)" || failed "$n @390: document scrolls to $(v docScrollWidth)px (table min-content $(v tableMinContent)px in a $(v mainContentBox)px column)"
  # `barRight`, not the all-descendants `navRight` (quick-260904-dwt): the
  # console link row now holds its own overflow, so descendants beyond 390px are
  # the row's scrollable content, not a widened page. The brand and the row's
  # own box are what must fit.
  [ "$(v barRight)" -le 390 ] && pass "$n @390: the console bar is inside the viewport" || failed "$n @390: the console bar reaches $(v barRight)px"
done

echo "== 390px: the probe can see an overflow at all (Clients table bare, by construction) =="
m=$(measure control-bare 390)
echo "        control-bare: $m"
if [ -n "$m" ] && [ "$(v docScrollWidth)" -gt 390 ]; then
  pass "control-bare @390: an unwrapped seven-column table widens the document to $(v docScrollWidth)px — the probe sees it"
else
  failed "control-bare @390: the bare table did not widen the document — the probe is blind and the PASSes above prove nothing"
fi

echo "== 1000px: the wrapper is inert on desktop (natural width, no scrollbar) =="
for n in $names; do
  m=$(measure "$n" 1000)
  echo "        $n: $m"
  [ -n "$m" ] || { failed "$n @1000: no measurement"; continue; }
  [ "$(v docScrollWidth)" = "1000" ] && pass "$n @1000: document is exactly viewport-wide" || failed "$n @1000: document scrolls to $(v docScrollWidth)px"
  [ "$(v tableFits)" = "true" ] && pass "$n @1000: table fits its box (no scrollbar on desktop)" || failed "$n @1000: table wider than its box on desktop"
done

echo; echo "artifacts: $OUT"
[ "$fail" -eq 0 ] && echo "RESULT: PASS" || { echo "RESULT: FAIL"; exit 1; }
