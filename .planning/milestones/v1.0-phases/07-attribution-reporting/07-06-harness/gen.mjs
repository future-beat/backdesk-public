/**
 * 07-06 print harness — fixture generator.
 *
 * Builds a standalone copy of the monthly-report sheet (the DOM of
 * src/app/(console)/reports/[client]/[reportId]/page.tsx, table markup as of
 * 07-06) that <link>s the REAL globals.css and report.css, so a headless print
 * exercises the shipped print block byte for byte. Synthetic data only — no
 * client name, phone, address or amount from the database is ever used here.
 *
 * Usage: node gen.mjs <outDir> <globals.css> <report.css>
 *
 * Writes:
 *   css/globals.css, css/report.css   copies of the two source files
 *   sheet.html                        the print fixture (24 rows, worst-case cells)
 *   sheet-measure-<w>.html            the same DOM with the @media print block
 *                                     unwrapped into plain CSS at a <w>px column,
 *                                     plus a script that reports layout facts
 *
 * DRIFT WARNING: the table markup below mirrors page.tsx by hand. When the Job
 * cell or the softwrap cells change in page.tsx, change them here too —
 * tests/layout-contract.test.ts pins the real page; this file only pins print.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, globalsCss, reportCss] = process.argv.slice(2);
if (!outDir || !globalsCss || !reportCss) {
  console.error('usage: node gen.mjs <outDir> <globals.css> <report.css>');
  process.exit(2);
}
mkdirSync(join(outDir, 'css'), { recursive: true });
copyFileSync(globalsCss, join(outDir, 'css', 'globals.css'));
copyFileSync(reportCss, join(outDir, 'css', 'report.css'));

// 60 code points + the generation-time ellipsis, exactly the frozen-row shape.
const DESC = 'Switchboard upgrade and RCD replacement, Joondalup, plus a ne…';
const ROWS = 40;

/** One tbody row, mirroring page.tsx (07-06): one-line Job cell, one softwrap cell. */
function row(i) {
  const id = 4200 + i;
  const name = i % 3 === 0 ? 'Christopher' : 'Dave';
  const label = `#${id} · ${DESC}`;
  return `<tr>
  <td><span class="cell-truncate" title="${label}">#${id}<span class="muted"> · ${DESC}</span></span></td>
  <td>${name}</td>
  <td>31 Aug</td>
  <td class="report-softwrap">12 · 14–31 Aug</td>
  <td>3</td>
  <td class="num">$12,450.00†</td>
  <td class="num">$10,582.50†</td>
</tr>`;
}

const figures = [
  ['Quotes chased', '12'],
  ['Replies', '5'],
  ['Jobs won', '2'],
  ['Recovered — conservative', '$487,500.00'],
  ['Recovered — gross', '$650,000.00'],
  ['Fees this month', '$597.00'],
]
  .map(([dt, dd]) => `<div class="report-figure"><dt>${dt}</dt><dd>${dd}</dd></div>`)
  .join('');

const notes = Array.from(
  { length: 5 },
  (_, i) =>
    `<li>Footnote ${i + 1}: lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim.</li>`,
).join('');

const sheet = `<div class="shell"><main><section class="report-sheet">
<h1>Quote follow-up report — Fixture Client</h1>
<p class="muted report-subline">August 2026 · prepared 3 Sep 2026 · version 2</p>
<dl class="report-hero"><dt>Return on fees</dt><dd>8.2×</dd><dd class="muted report-hero-note">on the conservative figure · 10.9× on gross</dd></dl>
<dl class="report-figures">${figures}</dl>
<div class="table-scroll"><table class="report-lines">
<caption>Jobs recovered in August 2026</caption>
<thead><tr><th scope="col">Job</th><th scope="col">Customer</th><th scope="col">Won</th><th scope="col">Follow-ups</th><th scope="col">Replies</th><th scope="col" class="num">Gross</th><th scope="col" class="num">Conservative</th></tr></thead>
<tbody>
${Array.from({ length: ROWS }, (_, i) => row(i)).join('\n')}
</tbody>
<tfoot><tr><td colspan="5">Total</td><td class="num">$298,800.00</td><td class="num">$253,980.00</td></tr></tfoot>
</table></div>
<ol class="report-notes">${notes}</ol>
<p class="report-footer">Quote Recovery · August 2026 · prepared 3 Sep 2026 · version 2</p>
</section></main></div>`;

const head = (extra) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>07-06 print fixture</title>
<link rel="stylesheet" href="css/globals.css"><link rel="stylesheet" href="css/report.css">${extra}</head>`;

writeFileSync(join(outDir, 'sheet.html'), `${head('')}<body>${sheet}</body></html>`);

/** The @media print block of report.css with the media wrapper removed.
 *  Comments are stripped first: the file's header prose mentions the words
 *  `@media print`, and matching that would slice the wrong braces. */
function unwrappedPrintBlock(cssWithComments) {
  const css = cssWithComments.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = css.indexOf('@media print');
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

const printRules = unwrappedPrintBlock(readFileSync(reportCss, 'utf8'));

const measureScript = `<script>
(function () {
  const t = document.querySelector('.report-lines');
  const ref = t.querySelector('tfoot tr').getBoundingClientRect().height;
  const rows = [...t.querySelectorAll('tbody tr')].map((tr) => tr.getBoundingClientRect().height);
  const footer = document.querySelector('.report-footer').getBoundingClientRect().bottom;
  const out = {
    width: document.querySelector('.report-sheet').clientWidth,
    trailingGap: Math.round((document.documentElement.scrollHeight - footer) * 100) / 100,
    wrappedRows: rows.filter((h) => h > ref + 1).length,
    tableFits: t.scrollWidth <= t.parentElement.clientWidth,
    tableScrollOverflow: getComputedStyle(t.parentElement).overflowX,
    theadBreakInside: getComputedStyle(t.querySelector('thead')).breakInside,
    jobCellDisplay: getComputedStyle(t.querySelector('tbody td .cell-truncate')).display,
    cols: [...t.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width)),
  };
  const pre = document.createElement('pre');
  pre.id = 'measure';
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
})();
</script>`;

for (const w of [661, 688]) {
  writeFileSync(
    join(outDir, `sheet-measure-${w}.html`),
    `${head(`<style>html{width:${w}px}${printRules}</style>`)}<body>${sheet}${measureScript}</body></html>`,
  );
}
console.log(`fixtures written to ${outDir}`);
