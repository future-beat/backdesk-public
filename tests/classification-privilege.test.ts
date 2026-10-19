/**
 * AI-03's least privilege, proven STRUCTURALLY rather than behaviourally.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A SOURCE-READING SUITE AND NOT MORE BEHAVIOURAL TESTS                │
 * │                                                                          │
 * │ `tests/classify-inbound.test.ts` proves what the pass DOES with the      │
 * │ inputs it was given, including five prompt-injection fixtures. What it   │
 * │ cannot prove is what the pass COULD do — a capability added tomorrow     │
 * │ that no existing fixture happens to trigger. A behavioural suite says    │
 * │ "these injections did not reach `killContact`". This one says            │
 * │ "`killContact` is not reachable from this module at all", which is a     │
 * │ different and much stronger claim, and it is the one D-13 actually       │
 * │ makes.                                                                   │
 * │                                                                          │
 * │ Same shape and same reasoning as `tests/lint-ban.test.ts`: a boundary    │
 * │ nobody has ever seen reject anything is a boundary you hope exists.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CLASSIFY_PATH = 'src/core/classification/classify-inbound.ts';
const SCHEMA_PATH = 'src/core/classification/schema.ts';
const REPOSITORY_PATH = 'src/db/repository/inbound-messages.ts';

const CLASSIFY = readFileSync(CLASSIFY_PATH, 'utf8');
const SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');
const REPOSITORY = readFileSync(REPOSITORY_PATH, 'utf8');

/**
 * Every `from '…'` specifier in a source file.
 *
 * ALWAYS CALLED ON COMMENT-STRIPPED SOURCE. These files carry long headers, and
 * an English sentence that happens to read "…from \"how much got labelled\"" is
 * not an import — the first run of this suite matched exactly that.
 */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Source with comments stripped, so a mention in prose is not a reference. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CLASSIFY_CODE = code(CLASSIFY);
const SCHEMA_CODE = code(SCHEMA);
const REPOSITORY_CODE = code(REPOSITORY);

describe('the classification module reaches nothing dangerous (D-13)', () => {
  /**
   * Each entry is a module the pass must never be able to reach, and WHY.
   *
   * The list is written as pairs so a failure names the consequence rather than
   * a path — the next person to hit this needs to know what the boundary is for,
   * not merely that they crossed it.
   */
  const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
    [
      /cadence\/controls/,
      'killContact and pauseForReply — suppression is one-way (D-06) and belongs to a human (D-13)',
    ],
    [
      /repository\/for-tenant/,
      'the whole tenant-scoped surface: cadences, touches, quotes, the send ledger',
    ],
    [/cadence\/dispatch/, 'the claim transaction — the thing that actually sends'],
    [/cadence\/sender/, 'the provider seam'],
    [/core\/messaging\//, 'ClickSend, Resend and the routing composite'],
    [/suppressed-contacts/, 'the table the LLM must never write (D-13)'],
    [/cadence\/resume/, 'the D-07 re-window, which decides when customers are next texted'],
    [/cadence\/transitions/, 'the state machine a label is explicitly forbidden to move (D-14)'],
    // 2026-10 (Phase 13, plan 13-04): closing a lead on a label is a state
    // transition, so it lives in src/core/leads/label-effects.ts — a separate
    // tick pass that READS the labels this module wrote (D-11 under D-13).
    [/core\/leads/, 'closeLead — a lead closed on a label belongs to the label-effects pass'],
  ];

  it.each(FORBIDDEN)('does not import %s (%s)', (pattern, why) => {
    // The `why` is carried into the assertion message rather than left to the
    // test title, so a failure in CI output states the consequence next to the
    // offending path instead of leaving the reader to find this table.
    for (const path of [CLASSIFY_PATH, SCHEMA_PATH] as const) {
      const source = path === CLASSIFY_PATH ? CLASSIFY_CODE : SCHEMA_CODE;
      for (const specifier of importSpecifiers(source)) {
        expect(pattern.test(specifier), `${path} imports ${specifier} — forbidden: ${why}`).toBe(
          false,
        );
      }
    }
  });

  it('imports the repository through the barrel and nothing else from src/db', () => {
    // The project's `no-restricted-imports` rule forbids reaching past the
    // barrel for the raw client; this narrows it further for this one module.
    const dbImports = importSpecifiers(CLASSIFY_CODE).filter((s) => s.includes('/db/'));
    expect(dbImports.sort()).toEqual(['@/db/repository', '@/db/schema']);
  });

  it('THE WHOLE IMPORT LIST, pinned — a new one is a decision, not a detail', () => {
    // An equality rather than a deny-list, for the reason the barrel pin in
    // `lint-ban.test.ts` gives: the next dangerous import will not be one
    // somebody already thought to forbid.
    expect(importSpecifiers(CLASSIFY_CODE).sort()).toEqual(
      [
        '@anthropic-ai/sdk',
        '@anthropic-ai/sdk/helpers/zod',
        '@/core/shared/anthropic',
        '@/db/repository',
        '@/db/schema',
        './schema',
      ].sort(),
    );
  });

  it('references ONLY the three sanctioned repository functions', () => {
    // ── THE WRITE SURFACE, COUNTED ────────────────────────────────────────
    //
    // Every other name exported from the barrel is checked for absence. That is
    // what makes this a boundary rather than a habit: adding
    // `forTenant` or `updateDeliveryWhereMatch` to this module fails here before
    // it can fail a customer.
    const SANCTIONED = ['listUnclassified', 'writeClassification', 'bumpClassifyAttempts'];
    const FORBIDDEN_NAMES = [
      'forTenant',
      'forAllTenants_cadenceTick',
      'forAllTenants_cadencesByContactMobile',
      'forAllTenants_ledgerOwners',
      'insertInboundMessage',
      'markInboundTriaged',
      'listInboundNeedingTriage',
      'updateDeliveryWhereMatch',
      'upsertChannelConfig',
      'convertProspectToTenant',
      'getDb',
    ];

    for (const name of SANCTIONED) {
      expect(CLASSIFY_CODE, `${name} should be used`).toContain(name);
    }
    for (const name of FORBIDDEN_NAMES) {
      expect(
        new RegExp(`\\b${name}\\b`).test(CLASSIFY_CODE),
        `${CLASSIFY_PATH} must not reference ${name}`,
      ).toBe(false);
    }
  });
});

describe('the request is schema-only, on the wire (AI-03, T-5-21)', () => {
  /** The `messages.parse({ … })` object literal, as text. */
  const requestLiteral = (() => {
    const start = CLASSIFY_CODE.indexOf('client.messages.parse({');
    expect(start).toBeGreaterThan(-1);
    const end = CLASSIFY_CODE.indexOf('} as Anthropic.MessageCreateParamsNonStreaming', start);
    expect(end).toBeGreaterThan(start);
    return CLASSIFY_CODE.slice(start, end);
  })();

  it('carries an output_config format built from the zod schema', () => {
    // 2026-10 (Phase 13, plan 13-04): the request is ONE literal for both
    // vocabularies, and the format comes from the row's vocabulary. Each of the
    // two formats is built from its zod schema, never a hand-written JSON one.
    expect(requestLiteral).toContain('output_config');
    expect(requestLiteral).toContain('format: vocabulary.format');
    expect(CLASSIFY_CODE).toContain('format: zodOutputFormat(ReplyClassification)');
    expect(CLASSIFY_CODE).toContain('format: zodOutputFormat(LeadReplyClassification)');
    // And there is exactly one request literal — no second, differently-shaped
    // call for leads that the pins above would not be reading.
    expect(CLASSIFY_CODE.split('client.messages.parse(').length).toBe(2);
  });

  it('contains NO tools property and no tool_choice', () => {
    // Schema-only is a property of the WIRE REQUEST, which is the strongest form
    // of AI-03: the payload physically contains nothing a model could call, so a
    // fully successful injection has nothing to reach for. A prompt instruction
    // not to use tools would be a request to be trusted; this is an absence.
    expect(/\btools\s*:/.test(requestLiteral)).toBe(false);
    expect(/\btool_choice\s*:/.test(requestLiteral)).toBe(false);
    expect(/\bbetas\s*:/.test(requestLiteral)).toBe(false);
  });

  it('sends no sampling parameter and no thinking key (the Opus 5 400 trap)', () => {
    // `claude-opus-5` rejects all four with a 400 — proven live by
    // `verify:drafting`'s negative probe. The symptom of getting this wrong is
    // total classification outage behind an error nobody can read.
    for (const param of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(new RegExp(`\\b${param}\\s*:`).test(requestLiteral), `${param} must be absent`).toBe(
        false,
      );
    }
  });

  it('names the operator-chosen model, with no date suffix', () => {
    expect(CLASSIFY).toContain("export const CLASSIFY_MODEL = 'claude-opus-5'");
    expect(requestLiteral).toContain('model: CLASSIFY_MODEL');
  });

  it('re-validates the parsed output with zod even though the API enforces it', () => {
    // CLAUDE.md: zod at every boundary, and an LLM output is a boundary even when
    // the API enforces the format. `messages.parse` returns `parsed_output: null`
    // on a schema miss and does NOT throw, so an unchecked read puts `undefined`
    // into a CHECK-constrained column.
    //
    // 2026-10 (Phase 13, plan 13-04): each vocabulary's `read` is the
    // re-validation, and the one call site hands it the raw `parsed_output`.
    expect(CLASSIFY_CODE).toContain('vocabulary.read(response.parsed_output)');
    expect(CLASSIFY_CODE).toContain('const parsed = ReplyClassification.safeParse(parsedOutput)');
    expect(CLASSIFY_CODE).toContain('const parsed = LeadReplyClassification.safeParse(parsedOutput)');
    expect(CLASSIFY_CODE.match(/if \(!parsed\.success\) return null;/g)).toHaveLength(2);
  });

  it('picks the vocabulary by lead_id, and by nothing else (Phase 13, D-05)', () => {
    expect(CLASSIFY_CODE).toContain(
      'const vocabulary = row.leadId !== null ? LEAD_VOCABULARY : QUOTE_VOCABULARY;',
    );
    expect(CLASSIFY_CODE).toContain('instructions: CLASSIFIER_INSTRUCTIONS');
    expect(CLASSIFY_CODE).toContain('instructions: LEAD_CLASSIFIER_INSTRUCTIONS');
  });

  it('puts the customer body in the user turn, inside delimiters, capped', () => {
    expect(CLASSIFY_CODE).toContain('<customer_reply>');
    expect(CLASSIFY_CODE).toContain('CLASSIFY_BODY_CAP');
    // `Array.from` rather than `slice`: code points, so an emoji at the boundary
    // is never cut into a lone surrogate.
    expect(CLASSIFY_CODE).toMatch(/Array\.from\(body\)\.slice\(0, CLASSIFY_BODY_CAP\)/);
    // The system block is a constant and contains no interpolation of the row.
    // 2026-10 (Phase 13, plan 13-04): one of two constants, picked by the row's
    // vocabulary (see the vocabulary pin above).
    expect(requestLiteral).toContain('system: vocabulary.instructions');
  });
});

describe('the repository write surface, pinned at the SQL (D-13)', () => {
  /** The `.set({ … })` of one named function. */
  function setList(functionName: string): string {
    const start = REPOSITORY_CODE.indexOf(`export async function ${functionName}`);
    expect(start, `${functionName} not found`).toBeGreaterThan(-1);
    const setAt = REPOSITORY_CODE.indexOf('.set(', start);
    expect(setAt).toBeGreaterThan(start);
    return REPOSITORY_CODE.slice(setAt, REPOSITORY_CODE.indexOf('.where(', setAt));
  }

  // 2026-10 (Phase 13, plan 13-03): FIVE columns — `urgency` added, the
  // model's D-05 judgement on a lead reply, written with its label. This is a
  // deliberate widening of what model output may write, recorded here; the
  // door's `keywordHot` is asserted absent below, because a classification
  // that could write it could overwrite a keyword hot with a cold verdict.
  it('writeClassification sets EXACTLY the five classification columns', () => {
    const set = setList('writeClassification');
    const columns = [...set.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);

    expect(columns.sort()).toEqual(
      ['classifiedAt', 'isHot', 'label', 'labelConfidence', 'urgency'].sort(),
    );
  });

  it('writeClassification cannot reach attribution, is_stop, triaged_at or the body', () => {
    // Those four are the DETERMINISTIC webhook's findings (04-01). A model that
    // could edit them could rewrite the record of a STOP it was never allowed to
    // decide — and `body` is the evidence of what the customer actually sent.
    const set = setList('writeClassification');
    // 2026-10 (Phase 13): `keywordHot` (the door's D-06 column) and `leadId`
    // (the threading decision) joined the forbidden list.
    for (const column of [
      'attribution',
      'isStop',
      'triagedAt',
      'body',
      'tenantId',
      'cadenceId',
      'keywordHot',
      'leadId',
    ]) {
      expect(new RegExp(`\\b${column}\\s*:`).test(set), `${column} must not be settable`).toBe(
        false,
      );
    }
  });

  it('writeClassification is guarded on label IS NULL — a second answer cannot overwrite', () => {
    const body = REPOSITORY_CODE.slice(
      REPOSITORY_CODE.indexOf('export async function writeClassification'),
      REPOSITORY_CODE.indexOf('export async function bumpClassifyAttempts'),
    );
    expect(body).toContain('isNull(inboundMessages.label)');
  });

  it('bumpClassifyAttempts sets exactly one column, and increments in SQL', () => {
    const set = setList('bumpClassifyAttempts');
    const columns = [...set.matchAll(/(\w+):\s/g)].map((m) => m[1]);

    expect(columns).toEqual(['classifyAttempts']);
    // Incremented in the database, not read-modify-written: two overlapping ticks
    // must not both read 2 and both write 3, which is how a cap that exists to
    // bound a burn stops bounding it.
    expect(set).toContain('+ 1');
  });

  it('listUnclassified carries all three predicates — the queue, the dead-letter skip, the cap', () => {
    const body = REPOSITORY_CODE.slice(
      REPOSITORY_CODE.indexOf('export async function listUnclassified'),
      REPOSITORY_CODE.indexOf('export interface ClassificationWrite'),
    );

    expect(body).toContain('isNull(inboundMessages.label)');
    expect(body).toContain("ne(inboundMessages.attribution, 'dead_letter')");
    // THE POISONED-ROW STOP. Without this a reply whose body makes the model
    // emit something the schema rejects is retried every minute forever.
    expect(body).toContain('lt(inboundMessages.classifyAttempts, MAX_CLASSIFY_ATTEMPTS)');
    // Oldest first — a reply waiting eleven minutes matters more than one that
    // arrived during this tick.
    expect(body).toContain('asc(inboundMessages.receivedAt)');
  });

  // 2026-10 (Phase 13, plan 13-03): the queue row's select list gains
  // `leadId` — the kind proxy the classifier picks its vocabulary by — and
  // still carries nothing that says whose reply this is.
  it('listUnclassified selects exactly five columns, leadId the only Phase 13 addition', () => {
    const body = REPOSITORY_CODE.slice(
      REPOSITORY_CODE.indexOf('export async function listUnclassified'),
      REPOSITORY_CODE.indexOf('export interface ClassificationWrite'),
    );
    const selectAt = body.indexOf('.select(');
    const select = body.slice(selectAt, body.indexOf('.from(', selectAt));
    const columns = [...select.matchAll(/(\w+):\s*inboundMessages\./g)].map((m) => m[1]);

    expect(columns.sort()).toEqual(
      ['body', 'classifyAttempts', 'id', 'leadId', 'receivedAt'].sort(),
    );
    for (const absent of ['fromAddress', 'normalizedFrom', 'tenantId', 'cadenceId', 'rawPayload']) {
      expect(new RegExp(`\\b${absent}\\s*:`).test(select), `${absent} must not be selected`).toBe(
        false,
      );
    }
  });

  it('the classification reads join nothing — the family promise still holds', () => {
    const region = REPOSITORY_CODE.slice(
      REPOSITORY_CODE.indexOf('export async function listUnclassified'),
    );
    expect(/\.(innerJoin|leftJoin|rightJoin|fullJoin)\(/.test(region)).toBe(false);
  });
});

describe('the label vocabulary is derived, never retyped (AI-02)', () => {
  it('schema.ts builds its enums from the database consts', () => {
    // The same words live in the TypeScript const, the Postgres CHECK and the
    // schema the model is bound to. A hyphen in one of them produces a label the
    // model returns, zod accepts and Postgres rejects at 3am.
    expect(SCHEMA).toContain('z.enum(INBOUND_LABELS)');
    expect(SCHEMA).toContain('z.enum(LABEL_CONFIDENCES)');
    // 2026-10 (Phase 13, plan 13-04): the lead vocabulary, derived the same way.
    // tests/lead-labels.test.ts compares all three places member for member.
    expect(SCHEMA).toContain('z.enum(LEAD_LABELS)');
    expect(SCHEMA).toContain('z.enum(LEAD_URGENCIES)');
    // And no hand-typed member list anywhere in the module.
    expect(/z\.enum\(\s*\[/.test(SCHEMA)).toBe(false);
  });

  it('the classifier describes every label the schema admits', () => {
    // `LABEL_DEFINITIONS` is a `Record<InboundLabel, string>`, so a seventh label
    // added to the database vocabulary is a TYPE ERROR here until somebody
    // decides what it means. A label the schema accepts and the prompt never
    // describes is one the model would return by guesswork.
    expect(CLASSIFY_CODE).toContain('Record<InboundLabel, string>');
    expect(CLASSIFY_CODE).toContain('INBOUND_LABELS.map(');
    // 2026-10 (Phase 13, plan 13-04): the lead labels and the urgencies, by the
    // same Record-then-map construction.
    expect(CLASSIFY_CODE).toContain('Record<LeadLabel, string>');
    expect(CLASSIFY_CODE).toContain('LEAD_LABELS.map(');
    expect(CLASSIFY_CODE).toContain('Record<LeadUrgency, string>');
    expect(CLASSIFY_CODE).toContain('LEAD_URGENCIES.map(');
  });
});
