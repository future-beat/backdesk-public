/**
 * The live proof for plan 05-01: TWO REAL CLAUDE CALLS, on synthetic data.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT MAKES THIS A PROOF RATHER THAN A DEMO                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Every drafting test in this repository injects a fake `DraftClient`, which is
 * correct — the state machine is what those tests are about, and a suite that
 * needed an API key would be a suite nobody runs. But that leaves exactly one
 * seam no test can close: whether a REAL request in the shape this code builds
 * is accepted by the real API, and whether the response carries the fields the
 * installed types promise.
 *
 * Two assumptions close here or they do not close at all:
 *
 *   A1  structured outputs (`output_config.format`) work on the classification
 *       model with NO beta header and NO `tools` key.
 *   A2  `claude-sonnet-5` rejects sampling parameters, so the drafting request
 *       must send none. Proven by omission — the call below succeeds without
 *       them, and the negative probe at the end proves the 400 is real rather
 *       than folklore.
 *
 * ── SYNTHETIC DATA ONLY ─────────────────────────────────────────────────────
 *
 * The voice profile, the quote facts and the reply below are invented. NO
 * CUSTOMER CONTENT EXISTS IN A SMOKE RUN, which is what makes it safe for this
 * script to print the draft body it gets back — the one place in this codebase
 * where printing a generated body is acceptable, and only because the inputs
 * were fiction. The production path prints nothing (T-5-03).
 *
 * ── THE CLASSIFICATION MODEL IS `claude-opus-5` ─────────────────────────────
 *
 * USER DECISION, 2026-08-31: "classification is critical and cheap at our
 * volume". It supersedes the 05-01 operator decision that chose
 * `claude-sonnet-5`, which had itself superseded CLAUDE.md's research-time
 * `claude-haiku-4-5` row. Recorded in STATE.md and quick task 260831-iie.
 *
 * The two legs below therefore run on DIFFERENT models, deliberately: drafting
 * stays on `claude-sonnet-5`, classification runs on `claude-opus-5`. A1 is
 * settled FOR OPUS — the model that will actually classify — because this
 * script sends the production classification shape (same `output_config.format`,
 * same `max_tokens`) against the same model id production names.
 *
 * Exits non-zero on any failure.
 */
import { register } from 'node:module';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

// ── THE PRODUCTION VALIDATOR, NOT A RESTATEMENT OF IT ─────────────────────
//
// This script used to check the whitelist with
// `ALLOWED.some((a) => a === t || a.includes(t))` — the SUBSTRING rule
// `validate.ts:165-176` exists to reject: "`45` is a substring of `$2,450`, so
// a model writing 'I'll be there in 45 minutes' — a number nobody supplied,
// about an appointment nobody booked — passes." Production compares run to run.
//
// A live proof that applies a WEAKER rule than production can print
// `ok: no fabricated numbers` for output the real validator would refuse: the
// proof passing while the thing it proves would fail. The validator is pure and
// dependency-free by design, so importing it costs nothing but a resolver hook
// for TypeScript's extensionless specifiers.
register('./lib/ts-resolve-hooks.mjs', import.meta.url);
const { validateDraft } = await import('../src/core/drafting/validate.ts');

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    'REFUSED: ANTHROPIC_API_KEY is not set.\n' +
      '  This script exists to prove the REAL API accepts our request shapes;\n' +
      '  there is nothing it can usefully do without a key.\n' +
      '  Get one at console.anthropic.com -> API keys, put it in .env.local.',
  );
  process.exit(1);
}

const DRAFT_MODEL = 'claude-sonnet-5';
// Decision lineage — see the header. Research said `claude-haiku-4-5`; the 05-01
// operator decision chose `claude-sonnet-5`; the 2026-08-31 user decision chose
// `claude-opus-5`. Drafting above is unaffected and stays on Sonnet 5.
const CLASSIFY_MODEL = 'claude-opus-5';

const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });

let failures = 0;
const fail = (msg) => {
  console.error(`  FAIL: ${msg}`);
  failures += 1;
};
const pass = (msg) => console.log(`  ok: ${msg}`);

// ── 1. DRAFTING ───────────────────────────────────────────────────────────
//
// The same request shape `draftTouches` builds: a stable system prefix, a
// volatile user block, a one-field structured output, and NO sampling params.

const DraftOutput = z.object({ body: z.string() });

const ALLOWED = ['$2,450', '12 August', '18'];

const SYSTEM = [
  'You write SMS follow-ups for an Australian trade business chasing an open quote.',
  '',
  'Rules:',
  '- Rewrite the template for THIS quote, in the business owner\'s own voice.',
  '- Use ONLY the display strings provided under "Facts you may state". Copy them',
  '  character for character. Never compute, round, convert or reformat a price,',
  '  a date or a number, and never state one that is not listed there.',
  '- Plain ASCII punctuation only. No em dashes, no curly quotes, no emoji.',
  '- One SMS: aim for under 140 characters of your own text.',
  '- Do NOT write any opt-out, unsubscribe or "reply STOP" wording, and do not',
  '  sign off with the business name. Both are appended automatically afterwards.',
  '- Write only the message body.',
  '',
  '# The business owner\'s voice',
  'Greeting style: first name, no "Dear"',
  'Formality: casual but not matey',
  'Sign-off style: just their first name',
  '',
  '# Messages this owner has actually sent (match this register)',
  '- Hi Dave, just checking in on that switchboard quote. Any questions? Mick',
  '- Morning Jen, did you get a chance to look at the quote I sent? Mick',
  '',
  '# Approved templates, in cadence order',
  '1. Friendly check-in on the quote, ask if they have any questions.',
].join('\n');

const USER = [
  '# This message',
  'You are writing touch 1.',
  '',
  '# Facts you may state (copy character for character)',
  'Customer first name: Sarah',
  'Job: Replace meter box and mains upgrade',
  'Quote total: $2,450',
  'Quote date: 12 August',
  'Days since the quote: 18',
  '',
  '# The only numbers and dates permitted in your reply',
  ...ALLOWED.map((s) => `- ${s}`),
].join('\n');

console.log(`\n1. Drafting — one real ${DRAFT_MODEL} structured-output call`);

let draftBody = null;
try {
  const res = await client.messages.parse({
    model: DRAFT_MODEL,
    max_tokens: 400,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: USER }],
    output_config: { format: zodOutputFormat(DraftOutput) },
    // NO temperature / top_p / top_k. NO thinking. See A2 in the header.
  });

  if (res.parsed_output === null || res.parsed_output === undefined) {
    fail('parsed_output was null — the model did not satisfy the schema');
  } else {
    draftBody = res.parsed_output.body;
    pass('structured output parsed');
    console.log(`     draft: ${JSON.stringify(draftBody)}`);
    console.log(
      `     usage: in=${res.usage?.input_tokens} out=${res.usage?.output_tokens} ` +
        `cache_read=${res.usage?.cache_read_input_tokens ?? 0} ` +
        `cache_write=${res.usage?.cache_creation_input_tokens ?? 0}`,
    );
  }
} catch (e) {
  fail(`drafting call threw ${e?.constructor?.name} ${e?.status ?? ''}`);
}

// The mechanical half — asserted here too, because the whole D-01 claim is that
// this suffix is appended by us and never produced by the model.
if (draftBody !== null) {
  const SUFFIX = 'Perth Sparks Electrical. Reply STOP to opt out.';
  const finalBody = `${draftBody.trim()} ${SUFFIX}`;
  if (!finalBody.endsWith(SUFFIX)) {
    fail('final body does not end with the compliance suffix');
  } else {
    pass('compliance suffix appended mechanically');
  }

  // ── T-5-01, LIVE, THROUGH THE REAL VALIDATOR. ──────────────────────────
  //
  // Every rule at once, and the same rules production applies: the run-to-run
  // whitelist comparison, the date words, the GSM-7 charset, the two-segment
  // cap and the compliance line. Nothing here restates a rule, so nothing here
  // can be a weaker version of one.
  const verdict = validateDraft({
    body: finalBody,
    allowedDisplayStrings: ALLOWED,
    expectedSuffix: SUFFIX,
  });
  if (!verdict.ok) {
    fail(`the real validator refused the live draft: ${JSON.stringify(verdict.violations)}`);
  } else {
    pass(`live draft passes the production validator (${verdict.segments} segment(s))`);
  }

  // ── THE NEGATIVE PROBE, on the validator rather than on the API. ───────
  //
  // A passing check above proves nothing unless the checker can fail. `45` is a
  // SUBSTRING of the supplied `$2,450` and a number nobody gave the model — the
  // exact case the old hand-copied rule waved through. If this probe ever
  // passes, the import is resolving to something other than production.
  const probe = validateDraft({
    body: `Righto, I will be there in 45 minutes. ${SUFFIX}`,
    allowedDisplayStrings: ALLOWED,
    expectedSuffix: SUFFIX,
  });
  if (probe.ok || !probe.violations.some((v) => v.rule === 'unlisted_number')) {
    fail('the imported validator did not refuse a substring of a supplied value');
  } else {
    pass('validator refuses a number nobody supplied (substring probe)');
  }
}

// ── 2. CLASSIFICATION (A1) ────────────────────────────────────────────────
//
// The assumption under test: structured outputs on the classification model with
// NO beta header and NO `tools` key. The enums are spelled exactly as
// INBOUND_LABELS / LABEL_CONFIDENCES and the CHECK constraints in 0028.

const ReplyClassification = z.object({
  label: z.enum([
    'interested',
    'question',
    'objection',
    'not_interested',
    'opt_out',
    'other',
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
});

console.log(`\n2. Classification — one real ${CLASSIFY_MODEL} messages.parse (A1)`);

try {
  const res = await client.messages.parse({
    model: CLASSIFY_MODEL,
    max_tokens: 100,
    system:
      'Classify the customer reply to a tradesperson\'s quote follow-up. ' +
      'Return only the label and your confidence.',
    messages: [
      {
        role: 'user',
        content: 'Yeah mate that price is a fair bit more than I was expecting.',
      },
    ],
    output_config: { format: zodOutputFormat(ReplyClassification) },
    // NO beta header, NO tools key — that is the assumption.
  });

  if (res.parsed_output === null || res.parsed_output === undefined) {
    fail('parsed_output was null — schema not satisfied');
  } else {
    const { label, confidence } = res.parsed_output;
    pass(`A1 SETTLED on ${CLASSIFY_MODEL}: label=${label} confidence=${confidence}`);
    // Not asserted as a specific label — the point is the SHAPE is guaranteed,
    // not that a smoke test can adjudicate one sentence's meaning. But this
    // particular reply is an objection, so a wildly different answer is worth
    // seeing in the output.
    if (label !== 'objection') {
      console.log(
        `     note: expected 'objection' for a price complaint, got '${label}'`,
      );
    }
  }
} catch (e) {
  fail(`classification call threw ${e?.constructor?.name} ${e?.status ?? ''}`);
}

// ── 3. A2, PROVEN AS A NEGATIVE ───────────────────────────────────────────
//
// The drafting call above sends no sampling parameters. That is only meaningful
// if sending them would in fact fail — otherwise the omission is a style choice
// dressed up as a constraint. One deliberate 400.

console.log(`\n3. Negative probe — ${DRAFT_MODEL} must REJECT temperature (A2)`);

try {
  await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 16,
    temperature: 0.5,
    messages: [{ role: 'user', content: 'hi' }],
  });
  fail('temperature was ACCEPTED — A2 is wrong, revisit the request shape');
} catch (e) {
  if (e?.status === 400) {
    pass('temperature rejected with 400, as assumed');
  } else {
    fail(`expected a 400, got ${e?.constructor?.name} ${e?.status ?? ''}`);
  }
}

console.log('');
if (failures > 0) {
  console.error(`verify:drafting FAILED (${failures} failure(s))`);
  process.exit(1);
}
console.log('verify:drafting PASSED');
