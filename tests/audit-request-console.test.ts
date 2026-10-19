/**
 * The console's half of LAND-03: the operator can READ the requests, and the
 * reading cannot become a second door into the table (D-15, T-9-18, T-9-34).
 *
 * ── WHY A SOURCE SCAN RATHER THAN A RENDER TEST ─────────────────────────────
 *
 * Every property below is of the form "this page does NOT do X": it does not
 * hold a service-role client, it does not select the two diagnostic columns, it
 * does not put a database message on a screen. A render test can only show what
 * happens on the inputs somebody thought to write; the absence of a privilege is
 * exactly the property a render test cannot establish. `tests/console-error-
 * leak.test.ts` made the same choice for the same reason, and the three leak
 * assertions at the bottom of this file are ITS rules, applied to this one page
 * ahead of 09-06 adding it to that suite's `NAMED_PAGES`.
 *
 * ── WHAT THE READ PATH HAS TO BE ────────────────────────────────────────────
 *
 * `audit_requests` is tenant-independent and carries one policy — `is_operator()`
 * — so the ONLY thing standing between a signed-in non-operator and the list of
 * every business that has asked the founder for an audit is the choice of
 * client. `createClient()` (anon key + the operator's cookie) makes Postgres
 * decide; `getDb()` or a repository import would make this page decide, and a
 * page that decides is a page that can be got wrong quietly. So the absence of
 * the repository barrel is asserted as hard as the presence of `createClient`.
 *
 * ── AND WHAT IT MUST NOT CARRY TO THE SCREEN ────────────────────────────────
 *
 * `ip_hash` and `user_agent` exist to key a throttle bucket and to diagnose a
 * broken submit. Neither is a fact about the business, and a list is read at a
 * glance by whoever is standing behind the operator on a job site. The detail
 * page (09-06) shows them, truncated and deliberately; the list names them
 * nowhere, which is why the assertion is over the whole file rather than over
 * the select list alone.
 *
 * Pure: `readFileSync` only. No database, no network, no render.
 *
 * 09-06 extends this suite with the detail page, the status action, the CSV
 * download route and the `audits/new` pre-fill.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const LIST_PAGE = 'src/app/(console)/audits/requests/page.tsx';

/** Strip comments — this file's prose, and the page's, must not answer for it. */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const list = code(LIST_PAGE);

/** The ten columns the list is allowed to know about. */
const SELECTED_COLUMNS = [
  'id',
  'business_name',
  'trade',
  'quotes_band',
  'servicem8_user',
  'status',
  'csv_object_path',
  'notify_email',
  'notify_sms',
  'created_at',
] as const;

/** The two the throttle and the diagnostics own, and the list never does. */
const FORBIDDEN_COLUMNS = ['user_agent', 'ip_hash'] as const;

describe('the request list is read under RLS, never around it (T-9-18)', () => {
  it('finds a page to scan', () => {
    // A renamed route or a wrong path must not pass every assertion vacuously
    // (WR-06).
    expect(list.length).toBeGreaterThan(500);
  });

  it('is never statically rendered', () => {
    expect(list).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('reads through the cookie-bound client, so is_operator() decides', () => {
    expect(list).toMatch(/import \{ createClient \} from '@\/lib\/supabase\/server'/);
    expect(list).toMatch(/await createClient\(\)/);
  });

  it('holds no service-role door', () => {
    // The repository family goes through `getDb()`, where RLS is inert. On this
    // page that would replace a database-enforced gate with a remembered one.
    expect(list).not.toMatch(/@\/db\/repository/);
    expect(list).not.toMatch(/getDb/);
  });
});

describe('the select list is explicit and narrow (T-9-34)', () => {
  it.each(SELECTED_COLUMNS)('names %s', (column) => {
    expect(list).toContain(column);
  });

  it('is not a wildcard', () => {
    // `select('*')` is how the two diagnostic columns arrive on a page that
    // never asked for them — and how the NEXT column added to the table does.
    expect(list).not.toMatch(/select\(\s*'\*'/);
  });

  it.each(FORBIDDEN_COLUMNS)('never mentions %s anywhere in the file', (column) => {
    expect(list).not.toContain(column);
  });
});

describe('newest first, and capped', () => {
  it('orders by created_at desc with id breaking the tie', () => {
    expect(list).toMatch(/\.order\('created_at', \{ ascending: false \}\)/);
    expect(list).toMatch(/\.order\('id', \{ ascending: false \}\)/);
  });

  it('caps the read at 50 rows and says so when the cap bites', () => {
    expect(list).toMatch(/const LIST_LIMIT = 50/);
    expect(list).toMatch(/\.limit\(LIST_LIMIT\)/);
    expect(list).toContain('Showing the latest 50');
  });
});

describe('the copy is the UI-SPEC row, verbatim', () => {
  it('heads the page Audit requests', () => {
    expect(list).toContain('<h1>Audit requests</h1>');
  });

  it('counts the new against the total on one line', () => {
    expect(list).toMatch(/new · \$\{/);
    expect(list).toMatch(/total/);
  });

  it('says what an empty list means and where rows come from', () => {
    expect(list).toContain(
      'No audit requests yet. Requests from backdesk.com.au/audit appear here, newest first.',
    );
  });
});

describe('the badges say the word and only then the colour (WCAG 1.4.1)', () => {
  const STATUS_CLASSES: [string, string][] = [
    ['new', 'badge'],
    ['contacted', 'badge'],
    ['audited', 'badge badge--ok'],
    ['declined', 'badge muted'],
  ];

  it.each(STATUS_CLASSES)('maps %s to %s', (status, className) => {
    // The map is a `Record`, not a `.replace('_', ' ')` at the render site: a
    // fifth status added to the CHECK constraint must fail here rather than
    // ship as an unstyled snake_case word on the operator's phone.
    expect(list).toContain(`${status}: '${className}'`);
  });

  it('reserves --error for a failed notification, on either channel (D-13)', () => {
    expect(list).toContain('badge badge--error');
    expect(list).toContain('notify failed');
    expect(list).toMatch(/notify_email === 'failed'/);
    expect(list).toMatch(/notify_sms === 'failed'/);
  });

  it('never uses --warn, which belongs to sync health', () => {
    expect(list).not.toContain('badge--warn');
  });
});

describe('a list, not a table (G-07-6)', () => {
  it('renders no table element at all', () => {
    // A four-fact row inside `.table-scroll` puts the status badge — the fact
    // the operator opened the page for — off the right edge of a 390px phone.
    expect(list).not.toMatch(/<table/);
    expect(list).toContain('className="touch-list"');
  });

  it('lets a 120-character business name wrap rather than widen the page', () => {
    expect(list).toContain('request-name');
  });
});

describe('the vocabularies come from the schema, resolved once', () => {
  it('takes both label maps from the pure intake module', () => {
    expect(list).toMatch(/from '@\/core\/intake\/audit-request'/);
    expect(list).toContain('TRADE_LABELS');
    expect(list).toContain('BAND_LABELS');
  });

  it('names the zone exactly once, above the list', () => {
    const mentions = list.match(/Australia\/Perth/g) ?? [];
    // Repeating the zone on every row costs the times themselves the width they
    // need on a phone — the `.zone-note` argument, verbatim from globals.css.
    expect(mentions).toHaveLength(1);
    expect(list).toContain('zone-note');
    expect(list).toContain('formatInTenantZone');
  });
});

describe('a failed read reports without leaking (WR-08, mirrored for this page)', () => {
  it('does not interpolate error.message into JSX', () => {
    expect(list).not.toMatch(/\{\s*error\.message\s*\}/);
  });

  it('does not interpolate any *.message into JSX', () => {
    expect(list).not.toMatch(/\{\s*\w+\.message\s*\}/);
  });

  it('does not render a stringified error', () => {
    expect(list).not.toMatch(/\{\s*String\(\s*\w*[Ee]rror\w*\s*\)\s*\}/);
    expect(list).not.toMatch(/\{\s*JSON\.stringify\(\s*\w*[Ee]rror\w*/);
  });

  it('still tells the operator the page broke', () => {
    expect(list).toContain('Could not load audit requests. Try again in a moment.');
    expect(list).toMatch(/role="alert"/);
  });

  it('sends the code to the log and nothing else', () => {
    expect(list).toMatch(/console\.error\([\s\S]*?error\.code/);

    const logs = list.match(/console\.error\([^)]*\)/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log).not.toContain('.message');
    }
  });
});

/**
 * ── THE ENTRY POINT (UI-SPEC "Console entry point") ─────────────────────────
 *
 * The list is reachable from `/audits` and from nowhere else, on purpose. The
 * console nav carries its own written refusal of a fifth item — six links is
 * already the width of a phone's chrome — so the request list is a second link
 * in the `/audits` header row instead. That makes the nav's byte-identity part
 * of this contract: "we added a page" must not quietly become "we widened the
 * bar every authenticated page renders".
 */
const AUDITS_PAGE = 'src/app/(console)/audits/page.tsx';
const CONSOLE_LAYOUT = 'src/app/(console)/layout.tsx';

const audits = code(AUDITS_PAGE);
const layout = code(CONSOLE_LAYOUT);

/**
 * What the nav carries. 09-06 held it at six; this plan's argument (a page is
 * not a nav item by default) still stands, and the count is still EXACT.
 *
 * 2026-10-13 (Phase 15, 15-04): MOVED BY DESIGN to seven. `/leads` is the
 * third screen with a clock on it — a missed caller's next follow-up has a
 * deadline — and 15-UI-SPEC decided it a nav item, third, with no badge
 * (Inbox · Queue · Leads · Audits · Reports · New client · Email). The
 * request list is still not in the nav (the assertion below).
 */
const NAV_LINK_COUNT = 7;

describe('the /audits header row opens the request list', () => {
  it('links to the list', () => {
    expect(audits).toContain('href="/audits/requests"');
  });

  it('counts the waiting requests without fetching them', () => {
    // A `head: true` count is one round trip that returns no rows: the header
    // needs the number, and pulling 50 strangers' contact details into a page
    // that renders one integer would be the wrong trade twice over.
    expect(audits).toMatch(/\.from\('audit_requests'\)/);
    expect(audits).toMatch(/count: 'exact', head: true/);
    expect(audits).toMatch(/\.eq\('status', 'new'\)/);
  });

  it('reads that count under RLS too, through the client the page already holds', () => {
    expect(audits).toMatch(/from '@\/lib\/supabase\/server'/);
    expect(audits).not.toMatch(/@\/db\/repository/);
  });

  it('appends the number only when there is one, and only when it is not zero', () => {
    // Three states, one expression: a count of 3 reads `Requests (3 new)`, a
    // count of 0 and a FAILED count both read `Requests`. A permanent `(0 new)`
    // is chrome an operator stops reading, and a failed count rendered as zero
    // would be a lie in the one direction that matters.
    expect(audits).toMatch(/!== null/);
    expect(audits).toMatch(/> 0 \? ` \(\$\{\w+\} new\)` : ''/);
    expect(audits).toContain('Requests');
  });
});

describe('the console nav bar was not widened', () => {
  it('carries exactly its seven links', () => {
    const nav = layout.match(/<nav>[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(nav).not.toBe('');
    expect(nav.match(/<Link href=/g) ?? []).toHaveLength(NAV_LINK_COUNT);
  });

  it('does not know the request list exists', () => {
    expect(layout).not.toContain('/audits/requests');
  });
});

/* ==========================================================================
 * 09-06: the DETAIL page, the status action and the download route.
 *
 * Two kinds of test, deliberately, and the split is the same one the header
 * argues for above. The PAGE is read rather than rendered: every property that
 * matters about it is an absence (no service-role door, no wildcard select, no
 * database message on screen) or a shape (which control exists in which state),
 * and a render test can only show what happens on the inputs somebody thought
 * to write. The ACTION and the ROUTE are RUN, because what matters about them
 * is what they DO when the caller is not an operator — that nothing is written,
 * that nothing is read out of Storage, that the answer is the same one an
 * unknown id gets. An absence at runtime is not visible in the source.
 *
 * `requireOperator()` is NOT mocked. Supabase's client is mocked one level
 * below it, so the real gate runs against a fake session — the shape 04-03
 * established, and the reason these suites can assert on denial without
 * asserting on a mock of the thing under test.
 * ========================================================================== */

const DETAIL_PAGE = 'src/app/(console)/audits/requests/[id]/page.tsx';
const STATUS_FORM = 'src/app/(console)/audits/requests/[id]/status-form.tsx';
const CSV_ROUTE = 'src/app/(console)/audits/requests/[id]/csv/route.ts';

const detail = code(DETAIL_PAGE);
const statusForm = code(STATUS_FORM);
const csvRoute = code(CSV_ROUTE);

describe('the request detail page (C-11)', () => {
  it('finds a page to scan', () => {
    expect(detail.length).toBeGreaterThan(1000);
  });

  it('is never statically rendered', () => {
    expect(detail).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('reads through the cookie-bound client, so is_operator() decides', () => {
    expect(detail).toMatch(/import \{ createClient \} from '@\/lib\/supabase\/server'/);
    expect(detail).toMatch(/await createClient\(\)/);
  });

  it('holds no service-role door', () => {
    expect(detail).not.toMatch(/@\/db\/repository/);
    expect(detail).not.toMatch(/getDb/);
  });

  it('404s a malformed uuid and a row that is not there', () => {
    // Postgres raises 22P02 on a malformed uuid rather than returning no rows,
    // and a signed-in non-operator gets `null` from the policy-scoped read —
    // which must be indistinguishable from an id that names nothing.
    expect(detail).toMatch(/UUID_PATTERN\.test\(id\)/);
    const notFounds = detail.match(/notFound\(\)/g) ?? [];
    expect(notFounds.length).toBeGreaterThanOrEqual(2);
  });

  it('names its columns rather than selecting the lot', () => {
    expect(detail).not.toMatch(/select\(\s*'\*'/);
    for (const column of [
      'business_name',
      'contact_name',
      'phone',
      'email',
      'trade',
      'quotes_band',
      'servicem8_user',
      'status',
      'csv_object_path',
      'csv_filename',
      'csv_bytes',
      'converted_prospect_id',
      'notify_email',
      'notify_sms',
      'notify_detail',
      'ip_hash',
      'user_agent',
      'created_at',
    ]) {
      expect(detail).toContain(column);
    }
  });

  it('shows the two diagnostic columns HERE, and truncates both', () => {
    // The list withholds them; this is the screen somebody opens when a
    // submission looks wrong, and they are the only two columns that answer it.
    expect(detail).toMatch(/ip_hash\.slice\(0, IP_HASH_PREFIX\)/);
    expect(detail).toContain('cell-truncate');
  });

  it('says No file attached when there is nothing to download (E12 partial)', () => {
    expect(detail).toContain('No file attached');
    expect(detail).toContain('Download CSV');
    // The link is the gated route, never a Storage URL or a signed one.
    expect(detail).toMatch(/href=\{`\/audits\/requests\/\$\{id\}\/csv`\}/);
    expect(detail).not.toMatch(/createSignedUrl|supabase\.co\/storage/);
  });

  /**
   * WR-05. The button is decided by `csv_object_path` ALONE, which is only
   * sound because every path that deletes the object also clears that column:
   * `convertRequest` does it now (asserted in the RUN half below) and
   * `purgeExpiredAuditUploads` has always done it. Deciding on the filename or
   * on the byte count instead would survive a conversion and put a dead
   * download in front of the operator.
   */
  it('decides the download on the object path, not the filename or the size', () => {
    expect(detail).toMatch(/\{request\.csv_object_path \? \(/);
    expect(detail).not.toMatch(/request\.csv_filename \?\s*\(/);
    expect(detail).not.toMatch(/request\.csv_bytes \?\s*\(/);
  });

  it('offers exactly one primary action, and only before conversion', () => {
    expect(detail.match(/Start audit/g) ?? []).toHaveLength(1);
    expect(detail.match(/Open audit/g) ?? []).toHaveLength(1);
    expect(detail).toMatch(/converted === null/);
    expect(detail).toMatch(/\/audits\/new\?request=\$\{id\}/);
  });

  it('renders the status control rather than a second copy of the action', () => {
    expect(detail).toContain('<StatusForm requestId={id} current={request.status} />');
  });

  it('never injects raw HTML', () => {
    // Every cell on this page is a stranger's typing.
    expect(detail).not.toContain('dangerouslySetInnerHTML');
  });

  it('has no delete control at all (C-11)', () => {
    expect(detail).not.toMatch(/\bDelete\b/);
  });

  it('reports a failed read without leaking, and logs the code', () => {
    expect(detail).toContain('Could not load this request. Try again in a moment.');
    expect(detail).toMatch(/role="alert"/);
    expect(detail).toMatch(/console\.error\([\s\S]*?error\.code/);
    for (const log of detail.match(/console\.error\([^)]*\)/g) ?? []) {
      expect(log).not.toContain('.message');
    }
  });
});

describe('the status form is a leaf on the client side', () => {
  it('is a client component that renders the ONE Message component (WR-10)', () => {
    expect(statusForm).toMatch(/^'use client';/);
    expect(statusForm).toContain('ActionMessage');
    expect(statusForm).toContain('useActionState');
  });

  it('pulls no database module into the browser bundle', () => {
    // `AUDIT_REQUEST_STATUSES` is a VALUE in a module that imports
    // `drizzle-orm/pg-core`; importing it here is the asymmetry that put four
    // `Module not found` errors into `next build` in 06-02. The action
    // validates against the schema's list; this component owns four labels.
    expect(statusForm).not.toContain('@/db');
    expect(statusForm).not.toContain('@/core/approval/approve-draft');
  });
});

/* ==========================================================================
 * The RUN half: the status action and the download route.
 * ========================================================================== */

const updateAuditRequestStatus = vi.fn<(id: string, status: string) => Promise<void>>();
const getAuditRequest = vi.fn<(id: string) => Promise<unknown>>();
const getAuditUpload = vi.fn<(path: string) => Promise<Blob | null>>();
const deleteAuditUpload = vi.fn<(path: string) => Promise<boolean>>();
const clearAuditRequestCsv = vi.fn<(id: string) => Promise<void>>();
const markAuditRequestConverted = vi.fn<(a: string, b: string) => Promise<boolean>>();
const createProspect = vi.fn<(input: Record<string, unknown>) => Promise<{ id: string }>>();
const revalidatePath = vi.fn<(path: string) => void>();
const generateAuditFromApiKey = vi.fn();
const redirected: string[] = [];

vi.mock('@/db/repository', () => ({
  updateAuditRequestStatus: (id: string, status: string) => updateAuditRequestStatus(id, status),
  getAuditRequest: (id: string) => getAuditRequest(id),
  getAuditUpload: (path: string) => getAuditUpload(path),
  deleteAuditUpload: (path: string) => deleteAuditUpload(path),
  clearAuditRequestCsv: (id: string) => clearAuditRequestCsv(id),
  markAuditRequestConverted: (a: string, b: string) => markAuditRequestConverted(a, b),
  createProspect: (input: Record<string, unknown>) => createProspect(input),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

// `redirect()` THROWS in Next, and the throw is load-bearing: it is what stops
// the code after it from running. Modelling that here is what lets a test assert
// "the request was marked BEFORE the redirect" rather than merely that both
// happened.
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    redirected.push(path);
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('@/core/audit/generate', () => ({
  generateAuditFromApiKey: (input: unknown) => generateAuditFromApiKey(input),
}));

/** The fake session `requireOperator()` — the REAL one — runs against. */
let session: { userId: string | null; allowlisted: boolean } = {
  userId: 'operator-1',
  allowlisted: true,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: session.userId ? { claims: { sub: session.userId } } : null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'operator_allowlist' && session.allowlisted
              ? { data: { user_id: session.userId }, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
  }),
}));

const { updateAuditRequestStatusAction } = await import(
  '@/app/(console)/audits/requests/[id]/actions'
);
const { BLANK_CONTROL_STATE } = await import('@/app/(console)/audits/requests/[id]/action-state');
const { GET } = await import('@/app/(console)/audits/requests/[id]/csv/route');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** A `params` whose access is observable — the route must not touch it early. */
function paramsProbe(id: string) {
  const seen = { read: false };
  const context = {
    get params() {
      seen.read = true;
      return Promise.resolve({ id });
    },
  };
  return { context, seen };
}

beforeEach(() => {
  vi.clearAllMocks();
  redirected.length = 0;
  session = { userId: 'operator-1', allowlisted: true };
});

describe('updateAuditRequestStatusAction is gated before it is useful (T-9-18)', () => {
  it('refuses a session that is not on the allowlist, and writes nothing', async () => {
    session = { userId: 'signed-in-stranger', allowlisted: false };

    const result = await updateAuditRequestStatusAction(
      BLANK_CONTROL_STATE,
      form({ request_id: REQUEST_ID, status: 'contacted' }),
    );

    expect(result.error).toBe('You do not have access to audits.');
    expect(result.success).toBeNull();
    // The write goes through `getDb()`, where the `is_operator()` policy is
    // inert — so "nothing was called" IS the authorization property here.
    expect(updateAuditRequestStatus).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a caller with no session at all', async () => {
    session = { userId: null, allowlisted: false };

    const result = await updateAuditRequestStatusAction(
      BLANK_CONTROL_STATE,
      form({ request_id: REQUEST_ID, status: 'contacted' }),
    );

    expect(result.error).toBe('Your session has expired. Sign in again.');
    expect(updateAuditRequestStatus).not.toHaveBeenCalled();
  });

  it('refuses a malformed id before Postgres can raise 22P02', async () => {
    const result = await updateAuditRequestStatusAction(
      BLANK_CONTROL_STATE,
      form({ request_id: 'not-a-uuid', status: 'contacted' }),
    );

    expect(result.error).toBe('That request could not be found.');
    expect(updateAuditRequestStatus).not.toHaveBeenCalled();
  });

  it('refuses a status outside the CHECK constraint vocabulary', async () => {
    const result = await updateAuditRequestStatusAction(
      BLANK_CONTROL_STATE,
      form({ request_id: REQUEST_ID, status: 'archived' }),
    );

    expect(result.error).toBe('Choose a status.');
    expect(updateAuditRequestStatus).not.toHaveBeenCalled();
  });

  it('writes the status and revalidates both surfaces that render it', async () => {
    updateAuditRequestStatus.mockResolvedValueOnce(undefined);

    const result = await updateAuditRequestStatusAction(
      BLANK_CONTROL_STATE,
      form({ request_id: REQUEST_ID, status: 'audited' }),
    );

    expect(updateAuditRequestStatus).toHaveBeenCalledWith(REQUEST_ID, 'audited');
    expect(revalidatePath).toHaveBeenCalledWith(`/audits/requests/${REQUEST_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith('/audits/requests');
    expect(result).toEqual({ error: null, success: 'Status updated.' });
  });

  it('reports a failed write in a fixed sentence, never the driver text (WR-08)', async () => {
    updateAuditRequestStatus.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "audit_requests_pkey" (42501)'),
    );

    const result = await updateAuditRequestStatusAction(
      BLANK_CONTROL_STATE,
      form({ request_id: REQUEST_ID, status: 'declined' }),
    );

    expect(result.error).toBe('Could not update the status. Try again.');
    expect(result.error).not.toContain('audit_requests_pkey');
    expect(result.error).not.toContain('42501');
    // A failed write must not revalidate a page whose content did not change.
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('the CSV route answers every refusal the same way (T-9-09)', () => {
  const REFUSALS: [string, () => void][] = [
    ['no session', () => (session = { userId: null, allowlisted: false })],
    [
      'a session with no allowlist row',
      () => (session = { userId: 'signed-in-stranger', allowlisted: false }),
    ],
  ];

  it.each(REFUSALS)('404s %s without reading the id or touching Storage', async (_name, set) => {
    set();
    const { context, seen } = paramsProbe(REQUEST_ID);

    const response = await GET(new Request('http://app.test/csv'), context);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(getAuditRequest).not.toHaveBeenCalled();
    expect(getAuditUpload).not.toHaveBeenCalled();
    // An id that is never read cannot be probed for by timing the response.
    expect(seen.read).toBe(false);
  });

  it('404s a malformed id', async () => {
    const { context } = paramsProbe('nope');

    const response = await GET(new Request('http://app.test/csv'), context);

    expect(response.status).toBe(404);
    expect(getAuditRequest).not.toHaveBeenCalled();
  });

  it('404s an id that names no row', async () => {
    getAuditRequest.mockResolvedValueOnce(null);
    const { context } = paramsProbe(REQUEST_ID);

    const response = await GET(new Request('http://app.test/csv'), context);

    expect(response.status).toBe(404);
    expect(getAuditUpload).not.toHaveBeenCalled();
  });

  it('404s a request that never had a file', async () => {
    getAuditRequest.mockResolvedValueOnce({ id: REQUEST_ID, csvObjectPath: null });
    const { context } = paramsProbe(REQUEST_ID);

    const response = await GET(new Request('http://app.test/csv'), context);

    expect(response.status).toBe(404);
    expect(getAuditUpload).not.toHaveBeenCalled();
  });

  it('404s a path whose object is gone — the ordinary post-purge state', async () => {
    getAuditRequest.mockResolvedValueOnce({
      id: REQUEST_ID,
      csvObjectPath: `${REQUEST_ID}/job-list.csv`,
      csvFilename: 'job-list.csv',
    });
    getAuditUpload.mockResolvedValueOnce(null);
    const { context } = paramsProbe(REQUEST_ID);

    const response = await GET(new Request('http://app.test/csv'), context);

    expect(response.status).toBe(404);
  });

  it('names no other status, so the route is neither an id nor a membership oracle', () => {
    expect(csvRoute).not.toMatch(/40[13]/);
    expect(csvRoute.match(/status: 404/g) ?? []).toHaveLength(4);
  });

  it('checks the allowlist before it awaits params or reads anything', () => {
    const authAt = csvRoute.indexOf('requireOperator()');
    expect(authAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(csvRoute.indexOf('await context.params'));
    expect(authAt).toBeLessThan(csvRoute.indexOf('getAuditRequest('));
    expect(authAt).toBeLessThan(csvRoute.indexOf('getAuditUpload('));
  });

  it('awaits the Next 16 params promise rather than destructuring it', () => {
    expect(csvRoute).toContain('Promise<{ id: string }>');
    expect(csvRoute.match(/await context\.params/g) ?? []).toHaveLength(1);
  });
});

describe('a successful download is an attachment nothing may cache (V8, V12)', () => {
  beforeEach(() => {
    getAuditRequest.mockResolvedValue({
      id: REQUEST_ID,
      csvObjectPath: `${REQUEST_ID}/job-list.csv`,
      csvFilename: 'job-list.csv',
    });
    getAuditUpload.mockResolvedValue(new Blob(['Job Number,Status\n1,Quote\n']));
  });

  it('streams the object with the stored filename', async () => {
    const { context } = paramsProbe(REQUEST_ID);

    const response = await GET(new Request('http://app.test/csv'), context);

    expect(response.status).toBe(200);
    expect(getAuditUpload).toHaveBeenCalledWith(`${REQUEST_ID}/job-list.csv`);
    expect(await response.text()).toBe('Job Number,Status\n1,Quote\n');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="job-list.csv"',
    );
  });

  it('sends the four headers that stop it becoming a page or a cached copy', async () => {
    const { context } = paramsProbe(REQUEST_ID);

    const response = await GET(new Request('http://app.test/csv'), context);

    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('re-sanitises the filename before it goes into a header', async () => {
    // The public action already sanitised it at upload time; this is a header
    // built from a stranger's typing, and the allowlist is idempotent.
    getAuditRequest.mockResolvedValue({
      id: REQUEST_ID,
      csvObjectPath: `${REQUEST_ID}/job-list.csv`,
      csvFilename: 'jobs"\r\nSet-Cookie: x.csv',
    });
    const { context } = paramsProbe(REQUEST_ID);

    const response = await GET(new Request('http://app.test/csv'), context);

    const disposition = response.headers.get('content-disposition') ?? '';
    // The header-injection characters are what matter — a CR, an LF or a second
    // double quote is what would end the value and start a header of the
    // caller's choosing. The word that follows them is inert once they are
    // gone, so the assertion is the allowlist itself rather than a blocklist of
    // header names somebody has to keep adding to.
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition.slice('attachment; filename="'.length, -1)).not.toMatch(/["\r\n]/);
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"$/);
  });
});

/* ==========================================================================
 * 09-06 Task 2: the pre-filled `audits/new`.
 *
 * The property under test is CONTINUITY as much as conversion: a request-driven
 * submit has to end up in the SAME `stageCsvUpload` — same 4 MiB cap, same
 * 5,000-row cap, same undocumented-columns mapping step — that a manual upload
 * goes through. The bytes came from a stranger through a public form, which is
 * the stronger reason for the caps to bind, not a reason to trust them.
 * ========================================================================== */

const NEW_AUDIT_PAGE = 'src/app/(console)/audits/new/page.tsx';
const NEW_AUDIT_FORM = 'src/app/(console)/audits/new/form.tsx';
const NEW_AUDIT_ACTION = 'src/app/(console)/audits/new/actions.ts';

const newPage = code(NEW_AUDIT_PAGE);
const newForm = code(NEW_AUDIT_FORM);
const newAction = code(NEW_AUDIT_ACTION);

const { createAuditAction } = await import('@/app/(console)/audits/new/actions');
const { BLANK_AUDIT_STATE } = await import('@/app/(console)/audits/new/action-state');

const PROSPECT_ID = '22222222-2222-4222-8222-222222222222';
const OBJECT_PATH = `${REQUEST_ID}/job-list.csv`;
const CSV_TEXT = 'Job Number,Status\nJ1,Quote\n';

/** `redirect()` throws, so a successful submit is caught rather than returned. */
async function submit(
  fields: Record<string, string>,
  file?: File,
): Promise<{ state?: Awaited<ReturnType<typeof createAuditAction>>; to?: string }> {
  const data = form(fields);
  if (file) data.append('csv_file', file);

  try {
    return { state: await createAuditAction(BLANK_AUDIT_STATE, data) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith('NEXT_REDIRECT:')) {
      return { to: message.slice('NEXT_REDIRECT:'.length) };
    }
    throw e;
  }
}

describe('starting an audit from a request feeds the stored file to the SAME intake', () => {
  beforeEach(() => {
    createProspect.mockResolvedValue({ id: PROSPECT_ID });
    markAuditRequestConverted.mockResolvedValue(true);
    deleteAuditUpload.mockResolvedValue(true);
    clearAuditRequestCsv.mockResolvedValue(undefined);
    getAuditRequest.mockResolvedValue({
      id: REQUEST_ID,
      csvObjectPath: OBJECT_PATH,
      csvFilename: 'job-list.csv',
    });
    getAuditUpload.mockResolvedValue(new Blob([CSV_TEXT]));
  });

  it('reads the object, parses it through the staging path, and lands on mapping', async () => {
    const result = await submit({
      business_name: 'Sparky Electrical',
      source: 'csv',
      request_id: REQUEST_ID,
      use_request_file: '1',
    });

    expect(getAuditUpload).toHaveBeenCalledWith(OBJECT_PATH);
    // The staging workspace is the proof the UNCHANGED parse ran: these headers
    // and rows exist only on the far side of papaparse and both caps.
    expect(createProspect).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: 'Sparky Electrical',
        source: 'csv',
        csvStaging: { headers: ['Job Number', 'Status'], rows: [{ 'Job Number': 'J1', Status: 'Quote' }] },
      }),
    );
    expect(result.to).toBe(`/audits/${PROSPECT_ID}/mapping`);
  });

  it('records what the request became and lets go of the export (D-15, T-9-06)', async () => {
    await submit({
      business_name: 'Sparky Electrical',
      source: 'csv',
      request_id: REQUEST_ID,
      use_request_file: '1',
    });

    expect(markAuditRequestConverted).toHaveBeenCalledWith(REQUEST_ID, PROSPECT_ID);
    expect(deleteAuditUpload).toHaveBeenCalledWith(OBJECT_PATH);
    // WR-05. Deleting the object is only half of letting go: without this the
    // row keeps `csv_object_path`, `csv_filename`, `csv_bytes` and
    // `csv_purge_after`, so the detail page renders `Download CSV` for a file
    // that no longer exists and the button opens a blank 404 tab — for up to
    // thirty days, until the purge sweeps a row whose object is already gone.
    expect(clearAuditRequestCsv).toHaveBeenCalledTimes(1);
    expect(clearAuditRequestCsv).toHaveBeenCalledWith(REQUEST_ID);
    expect(revalidatePath).toHaveBeenCalledWith(`/audits/requests/${REQUEST_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith('/audits/requests');
  });

  /**
   * THE ORDER IS THE GUARANTEE, and the guard is what keeps it honest.
   *
   * Object first, row second — the purge's own rule. Clearing the columns for
   * a delete that did not happen would strand the file: nothing left in the
   * database would point at a bucket object full of a stranger's customers, so
   * nothing would ever try to remove it again. Leaving the path and the
   * `csv_purge_after` stamp in place instead is the retryable failure — the
   * sweep finds it tomorrow.
   */
  it('leaves the row pointing at the object when the delete fails', async () => {
    deleteAuditUpload.mockResolvedValue(false);

    await submit({
      business_name: 'Sparky Electrical',
      source: 'csv',
      request_id: REQUEST_ID,
      use_request_file: '1',
    });

    expect(deleteAuditUpload).toHaveBeenCalledWith(OBJECT_PATH);
    expect(clearAuditRequestCsv).not.toHaveBeenCalled();
  });

  it('converts ONCE across two sessions, and the loser still gets its audit', async () => {
    // The guard is `WHERE converted_prospect_id IS NULL` in the repository, so
    // the second conversion returns false. The prospect it created is real and
    // the operator is still taken to it; what does NOT happen is the request
    // being re-pointed at the second audit.
    markAuditRequestConverted.mockResolvedValueOnce(false);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await submit({
      business_name: 'Sparky Electrical',
      source: 'csv',
      request_id: REQUEST_ID,
      use_request_file: '1',
    });

    expect(result.to).toBe(`/audits/${PROSPECT_ID}/mapping`);
    expect(logged).toHaveBeenCalledWith('[audit-requests] request already converted');
    logged.mockRestore();
  });

  it('falls back to the original sentence when the export has been purged', async () => {
    // `csv_object_path` null is BOTH "never attached anything" and "the 30-day
    // purge took it": all four columns are cleared together, so the two states
    // are indistinguishable — and the operator's next move is the same either
    // way. Nothing throws, and nothing is converted.
    getAuditRequest.mockResolvedValue({ id: REQUEST_ID, csvObjectPath: null });

    const result = await submit({
      business_name: 'Sparky Electrical',
      source: 'csv',
      request_id: REQUEST_ID,
    });

    expect(result.state?.errors.csv_file).toBe('Choose the Job List CSV exported from ServiceM8.');
    expect(getAuditUpload).not.toHaveBeenCalled();
    expect(createProspect).not.toHaveBeenCalled();
    expect(markAuditRequestConverted).not.toHaveBeenCalled();
  });

  it('falls back the same way when the row keeps a path Storage will not serve', async () => {
    getAuditUpload.mockResolvedValue(null);

    const result = await submit({
      business_name: 'Sparky Electrical',
      source: 'csv',
      request_id: REQUEST_ID,
    });

    expect(result.state?.errors.csv_file).toBe('Choose the Job List CSV exported from ServiceM8.');
    expect(createProspect).not.toHaveBeenCalled();
  });

  it('prefers a file the operator chose over the one on the request', async () => {
    const result = await submit(
      {
        business_name: 'Sparky Electrical',
        source: 'csv',
        request_id: REQUEST_ID,
      },
      new File(['Job,Status\nA,Quote\n'], 'newer.csv', { type: 'text/csv' }),
    );

    expect(getAuditUpload).not.toHaveBeenCalled();
    // And it deletes NOTHING: this action deletes only what it read. The
    // request's own attachment is untouched, columns and all.
    expect(deleteAuditUpload).not.toHaveBeenCalled();
    expect(clearAuditRequestCsv).not.toHaveBeenCalled();
    expect(markAuditRequestConverted).toHaveBeenCalledWith(REQUEST_ID, PROSPECT_ID);
    expect(result.to).toBe(`/audits/${PROSPECT_ID}/mapping`);
  });
});

describe('the API-key branch converts too, and is otherwise untouched', () => {
  beforeEach(() => {
    markAuditRequestConverted.mockResolvedValue(true);
    generateAuditFromApiKey.mockResolvedValue({ ok: true, prospectId: PROSPECT_ID });
  });

  it('marks the request with the prospect the key produced', async () => {
    const result = await submit({
      business_name: 'Sparky Electrical',
      source: 'api_key',
      api_key: 'sm8-key-1234567890',
      request_id: REQUEST_ID,
    });

    expect(generateAuditFromApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ businessName: 'Sparky Electrical', apiKey: 'sm8-key-1234567890' }),
    );
    expect(markAuditRequestConverted).toHaveBeenCalledWith(REQUEST_ID, PROSPECT_ID);
    // Nothing was read from Storage, so nothing is deleted from it — and the
    // row keeps its columns, because the file it names is still there and
    // still governed by its own `csv_purge_after` stamp (D-11).
    expect(deleteAuditUpload).not.toHaveBeenCalled();
    expect(clearAuditRequestCsv).not.toHaveBeenCalled();
    expect(result.to).toBe(`/audits/${PROSPECT_ID}`);
  });

  it('converts nothing when the key is refused', async () => {
    generateAuditFromApiKey.mockResolvedValue({ ok: false, kind: 'auth_failed' });

    const result = await submit({
      business_name: 'Sparky Electrical',
      source: 'api_key',
      api_key: 'sm8-key-1234567890',
      request_id: REQUEST_ID,
    });

    expect(result.state?.errors.api_key).toContain('ServiceM8 rejected the key');
    expect(markAuditRequestConverted).not.toHaveBeenCalled();
  });
});

describe('a request id that cannot be one is simply absent', () => {
  beforeEach(() => {
    createProspect.mockResolvedValue({ id: PROSPECT_ID });
    generateAuditFromApiKey.mockResolvedValue({ ok: true, prospectId: PROSPECT_ID });
  });

  it('does not throw, does not read, does not convert', async () => {
    // The value arrives in a query string that anything can rewrite. Refusing it
    // would tell a prober their id was the wrong shape; ignoring it gives them
    // the form they were going to get anyway.
    const result = await submit({
      business_name: 'Sparky Electrical',
      source: 'api_key',
      api_key: 'sm8-key-1234567890',
      request_id: '../../etc/passwd',
    });

    expect(getAuditRequest).not.toHaveBeenCalled();
    expect(markAuditRequestConverted).not.toHaveBeenCalled();
    expect(result.to).toBe(`/audits/${PROSPECT_ID}`);
  });

  it('leaves both branches exactly as they were when no request is named', async () => {
    const api = await submit({
      business_name: 'Sparky Electrical',
      source: 'api_key',
      api_key: 'sm8-key-1234567890',
    });
    expect(api.to).toBe(`/audits/${PROSPECT_ID}`);
    expect(markAuditRequestConverted).not.toHaveBeenCalled();

    const csv = await submit(
      { business_name: 'Sparky Electrical', source: 'csv' },
      new File([CSV_TEXT], 'jobs.csv', { type: 'text/csv' }),
    );
    expect(csv.to).toBe(`/audits/${PROSPECT_ID}/mapping`);
    expect(getAuditRequest).not.toHaveBeenCalled();
    expect(markAuditRequestConverted).not.toHaveBeenCalled();
  });

  it('still asks for a file when the CSV branch has neither (existing copy)', async () => {
    const result = await submit({ business_name: 'Sparky Electrical', source: 'csv' });

    expect(result.state?.errors.csv_file).toBe('Choose the Job List CSV exported from ServiceM8.');
  });
});

describe('the pre-fill source, read rather than run', () => {
  it('checks the operator allowlist before it reads the request id', () => {
    const authAt = newAction.indexOf('await requireOperator()');
    const readAt = newAction.indexOf("readString(formData, 'request_id')");

    expect(authAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(readAt);
  });

  it('names the stored filename and text/csv when it rebuilds the File', () => {
    expect(newAction).toContain('REQUEST_CSV_FALLBACK_NAME');
    expect(newAction).toMatch(/type: 'text\/csv'/);
    expect(newAction).toMatch(/request\.csvFilename \?\? REQUEST_CSV_FALLBACK_NAME/);
  });

  it('converts on both branches and cleans up on the one that consumed a file', () => {
    expect((newAction.match(/convertRequest\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(newAction).toContain('markAuditRequestConverted');
    expect(newAction).toContain('deleteAuditUpload');
    // WR-05: the clear is GUARDED on the delete's own result, in that order.
    expect(newAction).toMatch(/deleteAuditUpload\(objectPath\)\)\s*\)?\s*\{\s*await clearAuditRequestCsv/);
    expect(newAction).toContain('getAuditUpload');
  });

  it('leaves the caps and the mapping step exactly where they were', () => {
    // `stageCsvUpload` still owns every refusal; the split moved only its tail.
    expect(newAction).toMatch(/file\.size > MAX_CSV_BYTES/);
    expect(newAction).toMatch(/preview: MAX_CSV_ROWS \+ 1/);
    expect(newAction).toMatch(/\/audits\/\$\{prospect\.id\}\/mapping/);
  });

  it('reads the pre-fill under RLS and never through the repository', () => {
    expect(newPage).toMatch(/import \{ createClient \} from '@\/lib\/supabase\/server'/);
    expect(newPage).not.toMatch(/@\/db\/repository/);
    expect(newPage).not.toMatch(/select\(\s*'\*'/);
  });

  it('renders the hint the UI-SPEC wrote (C-12)', () => {
    expect(newPage).toContain('Pre-filled from the audit request by');
    expect(newPage).toContain('This request has already been turned into an audit.');
    expect(newPage).toContain('uploads are kept for 30 days');
  });

  it('never pre-fills a credential (T-2-02)', () => {
    // The request has none to give; the operator types it at audit time.
    expect(newPage).not.toContain('api_key_ciphertext');
    expect(newForm).not.toMatch(/defaultValue=\{[^}]*api[Kk]ey/);
    expect(newForm).not.toMatch(/initial\?\.apiKey|initial\.apiKey/);
  });

  it('swaps the file input for the static line, and keeps the API branch intact', () => {
    expect(newForm).toContain('Using the file attached to the request');
    expect((newForm.match(/name="request_id"/g) ?? []).length).toBe(1);
    expect((newForm.match(/api_key/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The input comes back the moment the stored file is refused.
    expect(newForm).toMatch(/initial\?\.csvFilename && !state\.errors\.csv_file/);
  });
});
