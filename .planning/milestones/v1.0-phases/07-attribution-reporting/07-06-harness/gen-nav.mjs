/**
 * 07-06 nav harness — fixture generator (G-07-3, quick-260904-dwt).
 *
 * The console bar of src/app/(console)/layout.tsx (brand + seven items, the
 * Queue badge showing) over the REAL globals.css, inside an <iframe> of the
 * viewport width under test — headless Chrome will not open a window narrower
 * than 500px, but an iframe is an honest 390px viewport. The inner page
 * measures itself and writes the facts into the outer document, which
 * `--dump-dom` prints.
 *
 * Since quick-260904-dwt it also measures the SIDEWAYS-SCROLLING LINK ROW: how
 * wide the row's box is against its content, which labels are whole and which
 * are cut at rest, how much headroom a focus ring has inside the scroll
 * container, and whether `Sign out` comes into view both by keyboard focus and
 * by scrolling the row to its end. Those last two are the reason no `tabIndex`
 * is added to the row — they are measured rather than assumed.
 *
 * THE PROBE IS SYNCHRONOUS ON PURPOSE (no requestAnimationFrame): headless
 * Chrome under `--dump-dom` produces almost no animation frames inside an
 * iframe, and every fact here is layout geometry, which is available the moment
 * the script runs. The one thing that is NOT geometry is scroll-timeline
 * PROGRESS — so `maskAtRest` at a scrolling width is reported as INFO by
 * nav-check.sh, while its ABSENCE at 700px is a gate: an inactive timeline
 * (nothing overflows) never applies the animation, which is deterministic.
 *
 * SYNTHETIC ONLY. Fixture text, a fake badge count, no database, no network,
 * no env file — the 07-06 rule, restated because the fixture now looks enough
 * like the real console to tempt someone into wiring it to one.
 *
 * Usage: node gen-nav.mjs <outDir> <globals.css> <width>...
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, globalsCss, ...widths] = process.argv.slice(2);
if (!outDir || !globalsCss || widths.length === 0) {
  console.error('usage: node gen-nav.mjs <outDir> <globals.css> <width>...');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const inner = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="file://${globalsCss}"></head><body>
<div class="shell"><header class="nav"><a href="/" class="brand">Quote Recovery</a><nav>
<a href="/inbox">Inbox</a><a href="/queue">Queue<span class="badge badge--error" aria-label="12 drafts waiting, 3 stalled">12</span></a>
<a href="/audits">Audits</a><a href="/reports">Reports</a><a href="/clients/new">New client</a><a href="/settings/email">Email</a>
<form action="#"><button type="submit" class="linkish">Sign out</button></form></nav></header>
<main><h1>Reports</h1><div class="table-scroll"><table><thead><tr><th>Client</th><th>First touch &lt;24h</th><th>Reply rate</th><th>Opt-out rate</th><th>Human-edit rate</th><th>Multiple</th></tr></thead>
<tbody><tr><td>Fixture Client</td><td>83%</td><td>41%</td><td>2.1%</td><td>18%</td><td>8.2×</td></tr></tbody></table></div></main></div>
<script>
(function () {
  const items = [...document.querySelectorAll('.nav a, .nav button')];
  const tops = items.map((e) => e.getBoundingClientRect().top).sort((a, b) => a - b);
  let lines = 0; let last = -99;
  for (const t of tops) { if (t - last > 12) { lines += 1; last = t; } }
  const btn = document.querySelector('.nav button');
  const nav = document.querySelector('.nav');
  // Hit boxes, and whether any two of them intersect. A negative margin bought
  // Sign out its 44px by bleeding 10px into a ~9.3px gap, so 0.7px of it sat
  // inside Audits across a 45.7px band and — being later in DOM order — won
  // hit-testing there: a tap on the bottom edge of Audits signed the operator
  // out. Nothing in this harness could see it (07-06 review, WR-03).
  const boxes = items.map((e) => ({ label: e.textContent.trim(), r: e.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // Non-overlapping boxes give exactly 0 or a negative; 0.1 is float slack.
      if (x > 0.1 && y > 0.1) overlaps.push(boxes[i].label + '|' + boxes[j].label);
    }
  }
  // ── THE LINK ROW, THE BOX THAT NOW HOLDS THE OVERFLOW (quick-260904-dwt) ──
  // Its CLIENT box, not its scroll box: clientWidth / clientHeight are the
  // padding box, i.e. exactly what a person can see, while the bounding rect's
  // width would be the same number and its content extends past it invisibly.
  const row = document.querySelector('.nav nav');
  const rr = row.getBoundingClientRect();
  const rowBox = { left: rr.left, right: rr.left + row.clientWidth, top: rr.top, bottom: rr.top + row.clientHeight };
  const rowItems = [...row.querySelectorAll('a, button')];
  // The Queue link's text is 'Queue12' with the badge inside it; the trailing
  // count is data, not a label, so it is stripped and the item reads 'Queue'.
  const label = (e) => e.textContent.trim().replace(/[0-9]+$/, '').trim();
  const inside = (e) => {
    const r = e.getBoundingClientRect();
    return r.left >= rowBox.left - 0.5 && r.right <= rowBox.right + 0.5 && r.top >= rowBox.top - 0.5 && r.bottom <= rowBox.bottom + 0.5;
  };
  const cut = (e) => {
    const r = e.getBoundingClientRect();
    return Math.min(r.right, rowBox.right) - Math.max(r.left, rowBox.left) > 0.1 && !inside(e);
  };
  const rowStyle = getComputedStyle(row);
  const first = rowItems[0].getBoundingClientRect();
  const round1 = (n) => Math.round(n * 10) / 10;
  // Read BEFORE anything is focused or scrolled: both change the mask.
  const maskAtRest = rowStyle.maskImage || rowStyle.webkitMaskImage || 'none';
  const fadeAtRest = rowStyle.getPropertyValue('--nav-fade').trim();
  const visibleAtRest = rowItems.filter(inside).map(label);
  const cutAtRest = rowItems.filter(cut).map(label);
  const restScrollLeft = Math.round(row.scrollLeft);
  const firstRingHeadroom = round1(Math.min(first.top - rowBox.top, rowBox.bottom - first.bottom, first.left - rowBox.left));

  // KEYBOARD REACH, MEASURED. The row deliberately has no tabIndex: unlike
  // '.table-scroll' it is full of focusable children, so focus is what scrolls
  // it. This is the assertion that stands in for that decision.
  const lastItem = rowItems[rowItems.length - 1];
  lastItem.focus();
  const lastR = lastItem.getBoundingClientRect();
  const focusScrollsLastIn = inside(lastItem);
  const lastRingHeadroom = round1(Math.min(rowBox.right - lastR.right, lastR.top - rowBox.top, rowBox.bottom - lastR.bottom));

  // ONE SWIPE. Scrolling to the end must bring Sign out fully into view — the
  // usability half of the trade, and the thing a clipped shell could not do.
  row.scrollLeft = row.scrollWidth;
  const endScrollLeft = Math.round(row.scrollLeft);
  const endMaxScroll = Math.round(row.scrollWidth - row.clientWidth);
  const endShowsSignOut = inside(btn);
  row.scrollLeft = 0;

  const out = {
    viewport: innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    // EVERY DESCENDANT — the 700px gate, where nothing may scroll and so every
    // item must be inside the viewport. At a scrolling width this reads the
    // row's scrollable overflow (651px at 390) and says nothing about the page.
    navRight: Math.round(Math.max(...[...nav.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right))),
    // THE BAR ITSELF: the brand and the row's OWN box, which is the measure of
    // whether the console bar fits the viewport once the row holds overflow.
    barRight: Math.round(Math.max(...[...nav.children].map((e) => e.getBoundingClientRect().right))),
    navHeight: Math.round(nav.getBoundingClientRect().height),
    navLines: lines,
    signOutBox: Math.round(btn.getBoundingClientRect().height),
    // The SMALLEST tap box in the bar, not just Sign out's. The spec covers
    // every tappable thing including the Queue link by name (WR-02).
    minTapBox: Math.round(Math.min(...boxes.map((b) => b.r.height))),
    minTapLabel: boxes.reduce((m, b) => (b.r.height < m.r.height ? b : m), boxes[0]).label,
    overlaps,
    brokenMidPhrase: items.filter((e) => e.getClientRects().length > 1).map((e) => e.textContent.trim()),
    rowClientWidth: Math.round(row.clientWidth),
    rowScrollWidth: Math.round(row.scrollWidth),
    rowScrollable: row.scrollWidth > row.clientWidth,
    rowOverflowX: rowStyle.overflowX,
    rowSnap: rowStyle.scrollSnapType,
    restScrollLeft,
    visibleAtRest,
    cutAtRest,
    maskAtRest,
    fadeAtRest,
    firstRingHeadroom,
    focusScrollsLastIn,
    lastRingHeadroom,
    endScrollLeft,
    endMaxScroll,
    endShowsSignOut,
  };
  parent.document.getElementById('m').textContent = JSON.stringify(out);
})();
</script></body></html>`;
writeFileSync(join(outDir, 'inner.html'), inner);
for (const w of widths) {
  writeFileSync(
    join(outDir, `outer-${w}.html`),
    `<!doctype html><html><body><pre id="m"></pre><iframe src="inner.html" width="${w}" height="800" style="border:0"></iframe></body></html>`,
  );
}
