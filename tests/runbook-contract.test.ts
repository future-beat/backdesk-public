/**
 * THE GO-LIVE RUNBOOK, AS A TEST — because a runbook that names a button which
 * no longer exists is worse than no runbook at all.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The operator runs the first-client go-live window from a phone, with two │
 * │ handsets, inside the client's contact hours. Every step of               │
 * │ docs/first-client-go-live-runbook.md names a console label or an npm     │
 * │ script. If a label is renamed in the console and the runbook is not, the │
 * │ document sends the operator looking for a control that is not there —    │
 * │ mid-window, with real customer SMS already armed.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So this suite pins PRESENCE, not prose. It asserts that every checklist row
 * label, every arming/disarming control label, every npm script string and
 * every piece of Phase 8/9 housekeeping the runbook is supposed to carry is
 * actually in the file. It cannot judge whether the prose is sufficient — the
 * end-of-phase human check reads it end to end for that (ARM-05 is an edge
 * probe by design). What it CAN do is fail the moment the runbook and the
 * product drift apart, which is the failure that would cost a real send.
 *
 * The label lists below are copied from `ITEM_LABELS` and the control `label=` /
 * `summary=` props in `src/app/(console)/clients/[id]/checklist-card.tsx`. Two
 * lists, deliberately: this suite reading the labels out of the component would
 * pass a rename in both places, which is exactly the drift it exists to catch.
 *
 * PURE. One `readFileSync` of one markdown file. Runs bare
 * (`npx vitest run tests/runbook-contract.test.ts`), with NO ALLOW_REMOTE_TESTS,
 * no database and no network.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RUNBOOK_PATH = 'docs/first-client-go-live-runbook.md';
const RUNBOOK = readFileSync(RUNBOOK_PATH, 'utf8');

/**
 * The first thirteen of the card's seventeen checklist rows, verbatim from
 * `ITEM_LABELS` (checklist-card.tsx).
 *
 * Ordered as the card orders them: the seven onboarding items that gate arming,
 * the two arming rows, the two proof rows that gate nothing and prove
 * everything, then the two divert rows (Phase 11, CAP-05) — which gate the
 * missed-call text-back only (12-08). The four text-back rows that follow them
 * on the card belong to docs/client-divert-onboarding-runbook.md and are
 * pinned, with a card cross-check, in tests/client-divert-runbook.test.ts
 * (2026-10-06, 12-08: count corrected; no label pinned here was renamed).
 */
const CHECKLIST_LABELS = [
  'ServiceM8 connected',
  'Contact hours set',
  'Voice profile set',
  'Templates approved',
  'ServiceM8 auto follow-up off',
  'Escalation phone set',
  'Sending domain verified',
  'SMS armed',
  'Email armed',
  'Escalation handset proof recorded',
  'Email pipe proof recorded',
  'Divert number provisioned',
  'Verification call recorded',
] as const;

/**
 * The seven controls on the "Ready to send?" card.
 *
 * Four SMS (the shared arm, the override lift, the per-client off, the big
 * off), two email (arm, off), and the one proof form both proofs share. The
 * runbook has to name the one the operator should tap, because three of the
 * four SMS controls are hidden in any given state and a wrong tap here arms or
 * disarms every connected client.
 */
const CONTROL_LABELS = [
  'Arm SMS for every client',
  'Turn SMS off for this client only',
  'Turn SMS off for every client',
  'Turn SMS back on for this client',
  'Arm email',
  'Turn email off',
  'Record proof',
  // 2026-10-08 (13-05, D-09). Not on the card: the after-hours escalation
  // switch's disclosure summary and checkbox label, from
  // `after-hours-escalation-form.tsx` (the label doubles as the profile row's
  // `<dt>` on the client page). Runbook section 3 sends the operator to both.
  // Cross-checked against the form's source below.
  'Change after-hours escalation',
  'After-hours escalation',
  // 2026-10-10 (14-04, D-01). Not on the card either: the inbox lead row's
  // button that opens the job-creation confirm sheet, from `create-job-form.tsx`.
  // Runbook section 19 sends the operator to it, and to its Retry spelling
  // after a failure. Cross-checked against the form's source below.
  'Create ServiceM8 job',
  'Retry ServiceM8 job',
] as const;

/** The two after-hours labels above, as they must appear in the form itself. */
const AFTER_HOURS_FORM_PATH = 'src/app/(console)/clients/[id]/after-hours-escalation-form.tsx';
const AFTER_HOURS_FORM_LABELS = ['Change after-hours escalation', 'After-hours escalation'] as const;

/** The two job-creation labels above, as they must appear in the inbox form (14-04). */
const CREATE_JOB_FORM_PATH = 'src/app/(console)/inbox/create-job-form.tsx';
const CREATE_JOB_FORM_LABELS = ['Create ServiceM8 job', 'Retry ServiceM8 job'] as const;

/**
 * The Phase 14 behaviours the runbook must name (2026-10-10, 14-04, D-08 and
 * D-07): the tradie's DONE, and the lead that resolves by itself because the
 * tradie booked the caller — in the inbox row's own words.
 */
const LEAD_RESOLUTION_FACTS = ['DONE', 'booked by tradie', 'closed by tradie', 'Needs review'] as const;

/** The card heading and the two live lines, as the runbook writes them. */
const STATE_STRINGS = ['Ready to send?', 'SMS: Live', 'Email: Live'] as const;

/**
 * Every command the runbook tells the operator to run.
 *
 * Each is an npm alias that already exists in package.json (plan 10-02 added
 * four of them), plus the read-only ServiceM8 probe. A runbook step whose
 * command is wrong is a step the operator cannot complete.
 */
const COMMANDS = [
  'npm run clicksend:balance',
  'npm run escalations:recent',
  'npm run cadence:status',
  'npm run resend:email-status',
  'npm run verify:email-pipe',
  'npm run cron:status',
  'node scripts/sm8-spike.mjs probe',
] as const;

/**
 * The operational facts carried forward from Phases 8 and 9 (D-11, D-12, and
 * the Q8 housekeeping table) plus the traps this phase's own research found.
 *
 * Each entry is a fact that cost somebody something to learn: the first live
 * SMS failed on provider balance (INSUFFICIENT_CREDIT), the shared SMS row arms
 * the connected TEST tenant (13e8f2aa) along with the founding client, the
 * operator's handset sits on ClickSend's Opt-Out List, the email proof's
 * one-click link resolves to `no_cadence` and suppresses nothing without
 * `--cadence`, and `test:remote` pauses the deployed crons the window depends
 * on. A runbook that omits any of them is a runbook that will be surprised.
 */
const HOUSEKEEPING = [
  '13e8f2aa',
  'Opt-Out List',
  'INSUFFICIENT_CREDIT',
  '/audits/requests',
  'declined',
  'URL Configuration',
  'https://app.backdesk.com.au',
  'alerts@quotes.backdesk.com.au',
  'Full access',
  'test:remote',
  'cron:apply',
  '+61491579212',
  'quotes.backdesk.com.au',
  'List-Unsubscribe',
  'no_cadence',
] as const;

describe('go-live runbook: the console labels it sends the operator to', () => {
  it.each(CHECKLIST_LABELS)('names the checklist row %s', (label) => {
    expect(RUNBOOK).toContain(label);
  });

  it.each(CONTROL_LABELS)('names the control %s', (label) => {
    expect(RUNBOOK).toContain(label);
  });

  it.each(STATE_STRINGS)('names %s', (text) => {
    expect(RUNBOOK).toContain(text);
  });

  // The other half of the tie for the two labels that do not live on the card:
  // a rename in the form without the runbook (or the reverse) goes red here.
  it.each(AFTER_HOURS_FORM_LABELS)('the after-hours form still renders %s', (label) => {
    expect(readFileSync(AFTER_HOURS_FORM_PATH, 'utf8')).toContain(label);
  });

  // The same tie for the inbox's job-creation control (14-04).
  it.each(CREATE_JOB_FORM_LABELS)('the inbox create-job form still renders %s', (label) => {
    expect(readFileSync(CREATE_JOB_FORM_PATH, 'utf8')).toContain(label);
  });
});

describe('go-live runbook: the Phase 14 lead resolutions it must describe', () => {
  it.each(LEAD_RESOLUTION_FACTS)('names %s', (fact) => {
    expect(RUNBOOK).toContain(fact);
  });
});

describe('go-live runbook: the commands it tells the operator to run', () => {
  it.each(COMMANDS)('names %s', (command) => {
    expect(RUNBOOK).toContain(command);
  });
});

describe('go-live runbook: the operational facts it must carry', () => {
  it.each(HOUSEKEEPING)('carries %s', (fact) => {
    expect(RUNBOOK).toContain(fact);
  });
});

describe('go-live runbook: shape', () => {
  /**
   * Eighteen numbered steps, from the signed agreement to the week-1 watch
   * (D-10). A count, not an order check: the order is prose the human check
   * reads, but a runbook that lost half its steps to a bad edit is machine
   * detectable.
   */
  it('has at least eighteen ### steps', () => {
    const headings = RUNBOOK.match(/^### /gm) ?? [];
    expect(headings.length).toBeGreaterThanOrEqual(18);
  });

  it('points at the two-column artefact tables', () => {
    expect(RUNBOOK).toContain('Artefact that proves it');
  });
});

/**
 * NO CREDENTIAL EVER LANDS HERE.
 *
 * The runbook is the one document written DURING a window in which the operator
 * is holding a ServiceM8 private key, a Resend key and a database URL, and
 * pasting a step's output into it is the obvious thing to do. These three
 * patterns are the shapes that would matter: a Resend key, a Postgres
 * connection string, and an API-key header or variable with a value after it.
 *
 * Names are fine — the runbook says "RESEND_API_KEY must be the Full access
 * key" and must keep saying it. Values are not.
 */
describe('go-live runbook: no credential shape', () => {
  it('contains no Resend key', () => {
    expect(RUNBOOK).not.toMatch(/re_[A-Za-z0-9_-]{20,}/);
  });

  it('contains no Postgres connection string', () => {
    expect(RUNBOOK).not.toMatch(/postgres(ql)?:\/\//i);
  });

  it('contains no API key with a value after it', () => {
    expect(RUNBOOK).not.toMatch(/(SM8_TEST_API_KEY|X-API-Key|CLICKSEND_API_KEY)\s*[:=]\s*\S{8,}/i);
  });
});
