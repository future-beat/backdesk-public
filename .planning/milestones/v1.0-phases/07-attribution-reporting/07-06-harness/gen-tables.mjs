/**
 * 07-07 table harness — fixture generator (G-07-6).
 *
 * Every console page that renders a `<table>` outside `.table-scroll` widens
 * the document below ~640px, because an auto-layout table's used width is
 * max(specified, min-content) and nothing between `<table>` and the viewport
 * contains overflow. This generator renders each such table over the REAL
 * globals.css, with the real console bar, inside an <iframe> of the width
 * under test (headless Chrome will not open a window narrower than 500px; an
 * iframe is an honest 390px viewport).
 *
 * MARKUP BY HAND, WRAPPER BY SOURCE. The row markup mirrors each .tsx by hand
 * (worst realistic content, per .planning/debug/clients-table-widens-page-390.md),
 * but whether the table sits inside `<div class="table-scroll">` is READ FROM
 * THE SHIPPED .tsx — comments stripped, the nth `<table` looked up, the text
 * before it checked for the wrapper. So this harness fails on today's source
 * and passes once the wrapper is in the file, without rendering React.
 *
 * `control-bare` is ALWAYS unwrapped, whatever the source says: it proves the
 * probe can see the overflow at all. A probe that cannot fail is not evidence.
 *
 * THE BAR IS MEASURED AS `barRight`, NOT `navRight` (quick-260904-dwt). Since
 * the console link row became an `overflow-x: auto` scroll container, the
 * all-descendants maximum reads the row's SCROLLABLE OVERFLOW — 651px at 390px
 * — which is a fact about the row's scroll box and not about the page width
 * this harness is here to police. `barRight` is the brand and the row's own
 * box (374px at 390px). The document width assertion is unchanged and is still
 * the real gate; every link's reachability is asserted by `nav-check.sh`.
 *
 * Synthetic data only — no client name, phone, address or amount from the
 * database is ever used here.
 *
 * Usage: node gen-tables.mjs <outDir> <projectRoot> <width>...
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, root, ...widths] = process.argv.slice(2);
if (!outDir || !root || widths.length === 0) {
  console.error('usage: node gen-tables.mjs <outDir> <projectRoot> <width>...');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const globalsCss = join(root, 'src/app/globals.css');

/** `.tsx` with JSX comments, block comments and whole-line comments removed. */
function stripComments(source) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Is the nth `<table` (1-based) in the file immediately inside
 * `<div className="table-scroll">`? Whitespace between the two is allowed;
 * anything else is not — an intervening element would be the box that
 * overflows instead.
 */
function wrappedInSource(relPath, nth) {
  const source = stripComments(readFileSync(join(root, relPath), 'utf8'));
  let at = -1;
  for (let i = 0; i < nth; i += 1) {
    at = source.indexOf('<table', at + 1);
    if (at < 0) throw new Error(`${relPath}: fewer than ${nth} <table elements`);
  }
  // MATCHED BY CLASS, NOT BY ONE BYTE STRING: the wrappers carry `tabIndex={0}`,
  // `role="region"` and an `aria-label` since 07-07's WR-03 fix, and a generator
  // that only recognised the bare `<div className="table-scroll">` would report
  // every wrapped table as unwrapped and fail the whole harness. Mirrors
  // `tableWrapping()` in tests/layout-contract.test.ts.
  return /<div[^>]*\bclassName=(["'])[^"']*\btable-scroll\b[^"']*\1[^>]*>\s*$/.test(
    source.slice(0, at),
  );
}

// Exactly formatInTenantZone(value, 'Australia/Perth') / the audits page's formatDate.
const fmt = (iso) =>
  new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Australia/Perth',
  }).format(new Date(iso));
const fmtDate = (iso) => new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(iso));
const lastSync = fmt('2026-09-03T08:15:00Z');
const created = fmtDate('2026-09-03T08:15:00Z');

/** The console bar of layout.tsx — brand + seven items, Queue badge showing. */
const NAV = `<header class="nav"><a href="/" class="brand">Quote Recovery</a><nav>
<a href="/inbox">Inbox</a><a href="/queue">Queue<span class="badge badge--error" aria-label="12 drafts waiting, 3 stalled">12</span></a>
<a href="/audits">Audits</a><a href="/reports">Reports</a><a href="/clients/new">New client</a><a href="/settings/email">Email</a>
<form action="#"><button type="submit" class="linkish">Sign out</button></form></nav></header>`;

const wrap = (wrapped, tableHtml) =>
  wrapped ? `<div class="table-scroll">${tableHtml}</div>` : tableHtml;

// ---- src/app/(console)/page.tsx — the Clients table (seven columns) ----
const clientsRow = (name, trade, healthCls, healthLbl, drafts, sync, hours, days, status) => `<tr>
<td><a href="#">${name}</a></td><td>${trade}</td>
<td><span class="${healthCls}">${healthLbl}</span></td>
<td>${drafts}</td><td>${sync}</td>
<td>${hours}<span class="muted"> ${days}</span></td><td>${status}</td></tr>`;
const clientsTable = `<table><thead><tr><th>Name</th><th>Trade</th><th>Sync</th><th>Drafts</th><th>Last sync</th><th>Contact hours</th><th>Status</th></tr></thead><tbody>
${clientsRow('Westside Electrical', 'electrician', 'badge badge--ok', 'healthy', '<span class="badge badge--error">4</span>', lastSync, '08:00–18:00', 'Mon–Fri', 'active')}
${clientsRow('Perth Plumbing Co', 'plumber', 'badge badge--warn', 'degraded', '<span class="badge">2</span>', lastSync, '07:30–17:00', 'Mon–Sat', 'active')}
${clientsRow('Joondalup Gas & Air', 'hvac', 'badge badge--error', 'auth failed', '—', lastSync, '08:00–16:30', 'Mon, Wed, Fri', 'paused')}
${clientsRow('New Prospect', 'roofer', 'badge', 'never synced', '—', '—', '—–—', '—', 'active')}
</tbody></table>`;
const clientsPage = (tableHtml) =>
  `<section><div class="row"><h1>Clients</h1><a href="#" class="button">New client</a></div>${tableHtml}</section>`;

// ---- src/app/(console)/clients/[id]/page.tsx — Recent sync runs ----
const runRow = (cls, lbl, f, u) =>
  `<tr><td>${lastSync}</td><td><span class="${cls}">${lbl}</span></td><td>${f}</td><td>${u}</td></tr>`;
const runsTable = `<table><thead><tr><th>Time</th><th>Outcome</th><th>Fetched</th><th>Updated</th></tr></thead><tbody>
${runRow('badge badge--ok', 'ok', 142, 17)}
${runRow('badge badge--warn', 'response parse error', 0, 0)}
${runRow('badge badge--error', 'auth failed', 0, 0)}
</tbody></table>`;
const runsPage = (tableHtml) =>
  `<section><div class="row"><h1>Westside Electrical</h1></div><section><h2>Recent sync runs</h2>${tableHtml}</section></section>`;

// ---- src/app/(console)/audits/page.tsx — the audits list ----
const auditRow = (biz, src, audit) =>
  `<tr><td><a href="#">${biz}</a></td><td>${src}</td><td>${created}</td><td>${audit}</td></tr>`;
const auditsTable = `<table><thead><tr><th>Business</th><th>Source</th><th>Created</th><th>Audit</th></tr></thead><tbody>
${auditRow('Superelectrotechnologies Pty Ltd', 'API key', `<a href="#">${created}</a>`)}
${auditRow('Perth Plumbing Co', 'CSV', '<span class="muted">not generated</span>')}
</tbody></table>`;
const auditsPage = (tableHtml) =>
  `<section><div class="row"><h1>Audits</h1><a href="#" class="button">New audit</a></div>${tableHtml}</section>`;

// ---- src/app/(console)/audits/[id]/mapping/mapping-form.tsx — the FIRST table (inside the 30rem form) ----
const mapFields = [
  ['job status', true],
  ['quote date', true],
  ['quote value', true],
  ['description', false],
  ['contact name', false],
  ['contact phone', false],
  ['contact email', false],
  ['work order date', false],
  ['unsuccessful date', false],
];
const sm8Headers = [
  'Job Status',
  'Quote Date',
  'Total Invoice Amount',
  'Description of Work',
  'Job Contact Name',
  'Job Contact Mobile Number',
  'Job Email Address',
  'Work Order Date',
  'Unsuccessful Date',
];
const mappingTable = `<table><caption class="muted meta">200 rows uploaded. Check each column before confirming.</caption>
<thead><tr><th scope="col">Audit field</th><th scope="col">Column in your export</th></tr></thead><tbody>
${mapFields
  .map(
    ([label, req]) =>
      `<tr><th scope="row">${label}${req ? '' : '<span class="muted"> (optional)</span>'}</th><td><select aria-label="Column for ${label}"><option value="">— not in this export —</option>${sm8Headers.map((h) => `<option>${h}</option>`).join('')}</select></td></tr>`,
  )
  .join('\n')}
</tbody></table>`;
const mappingPage = (tableHtml) =>
  `<section><div class="row"><h1>Map the export</h1></div><form action="#"><input type="hidden" name="prospect_id" value="x">${tableHtml}<button type="submit">Confirm mapping</button></form></section>`;

// ---- src/app/(console)/reports/page.tsx — the overview (wrapped since 07-05; the positive control) ----
const reportsTable = `<table><thead><tr><th>Client</th><th class="num">First touch &lt;24h</th><th class="num">Replies</th><th class="num">Opt-outs</th><th class="num">Edited</th><th class="num">Multiple</th></tr></thead>
<tbody><tr><td><a href="#">Westside Electrical</a></td><td class="num">83.3%<br><span class="muted hint">(5/6)</span></td><td class="num">41.2%<br><span class="muted hint">(7/17)</span></td><td class="num">7.1%<span class="badge badge--error">above 5%</span><br><span class="muted hint">(3/42)</span></td><td class="num">18.0%<br><span class="muted hint">(9/50)</span></td><td class="num">8.2×</td></tr></tbody></table>`;
const reportsPage = (tableHtml) =>
  `<section><div class="row"><h1>Reports</h1></div><p class="hint muted">Last 30 days, rolling, across every client.</p>${tableHtml}</section>`;

/** name → { source, nth, page, table }. The wrapper is decided from `source`. */
const FIXTURES = {
  clients: { source: 'src/app/(console)/page.tsx', nth: 1, page: clientsPage, table: clientsTable },
  runs: { source: 'src/app/(console)/clients/[id]/page.tsx', nth: 1, page: runsPage, table: runsTable },
  audits: { source: 'src/app/(console)/audits/page.tsx', nth: 1, page: auditsPage, table: auditsTable },
  mapping: {
    source: 'src/app/(console)/audits/[id]/mapping/mapping-form.tsx',
    nth: 1,
    page: mappingPage,
    table: mappingTable,
  },
  reports: { source: 'src/app/(console)/reports/page.tsx', nth: 1, page: reportsPage, table: reportsTable },
};

const measure = `<script>
(function () {
  const table = document.querySelector('main table');
  const main = document.querySelector('main');
  const box = table.parentElement;
  const clone = table.cloneNode(true);
  clone.style.width = 'min-content'; clone.style.position = 'absolute'; clone.style.left = '-9999px';
  document.body.appendChild(clone);
  const minContent = clone.getBoundingClientRect().width;
  clone.remove();
  const r = table.getBoundingClientRect();
  const out = {
    viewport: innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    wrapperInSource: document.body.dataset.wrapped === 'true',
    tableParent: '<' + box.tagName.toLowerCase() + (box.className ? ' class="' + box.className + '"' : '') + '> overflow-x:' + getComputedStyle(box).overflowX,
    tableWidth: Math.round(r.width * 10) / 10,
    tableMinContent: Math.round(minContent * 10) / 10,
    tableFits: table.scrollWidth <= box.clientWidth + 1,
    mainContentBox: Math.round(main.clientWidth - 2 * parseFloat(getComputedStyle(main).paddingLeft)),
    barRight: Math.round(Math.max(...[...document.querySelector('.nav').children].map((e) => e.getBoundingClientRect().right))),
  };
  parent.document.getElementById('m').textContent = JSON.stringify(out);
})();
</script>`;

function emit(name, body, wrapped, width) {
  writeFileSync(
    join(outDir, `inner-${name}-${width}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="file://${globalsCss}"></head><body data-wrapped="${wrapped}"><div class="shell">${NAV}<main>${body}</main></div>${measure}</body></html>`,
  );
  writeFileSync(
    join(outDir, `outer-${name}-${width}.html`),
    `<!doctype html><html><body><pre id="m"></pre><iframe src="inner-${name}-${width}.html" width="${width}" height="900" style="border:0"></iframe></body></html>`,
  );
}

const names = [];
for (const width of widths) {
  for (const [name, f] of Object.entries(FIXTURES)) {
    const wrapped = wrappedInSource(f.source, f.nth);
    emit(name, f.page(wrap(wrapped, f.table)), wrapped, width);
    names.push(name);
  }
  // The negative control: the Clients table bare, whatever the source says.
  emit('control-bare', clientsPage(clientsTable), false, width);
}
console.log([...new Set(names)].join(' '));
