/**
 * The drafting pass, PURE — no database, no credentials, no model.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `tests/draft-pipeline.test.ts` proves the pass works against the real    │
 * │ hosted Postgres. THIS file proves what that one cannot: the shape of     │
 * │ every request, and what happens on each of eight failures that are       │
 * │ awkward or impossible to provoke against a live stack.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Both fakes are structural, not casts. `DraftRepository` and `DraftClient` are
 * narrow interfaces the real repository and the real SDK client satisfy, so a
 * fake here is object literals that TYPECHECK against the same contract the
 * production caller uses. 05-01 recorded what the alternative costs: a
 * `seedTouches` return smuggled into `draftTouches` behind `as never` made a
 * throwing-client test pass green without the client ever being called.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  DRAFT_BATCH_LIMIT,
  DRAFT_CLAIM_STALE_MS,
  DRAFT_MODEL,
  MAX_DRAFT_ATTEMPTS,
  draftTouches,
  type DraftClient,
  type DraftRepository,
  type DraftResponse,
  type TouchRow,
} from '../src/core/drafting/draft-touches';
import { PROMPT_VERSION } from '../src/core/drafting/prompt';
import type { TouchDraftInsert } from '../src/db/repository';

const TENANT = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  name: 'Perth Sparks Electrical',
  timezone: 'Australia/Perth',
};

/**
 * A sentinel nobody may ever see in a body.
 *
 * It lives inside the fake TEMPLATE text, which is the raw wording the merge-fill
 * fallback D-10 forbids would be built from. Every failure path in this file
 * asserts that no recorded body contains it — so "no path composes a sendable
 * message from the template" is a property tested rather than a promise made.
 */
const TEMPLATE_SENTINEL = 'ZZTEMPLATEZZ';

const TEMPLATES = [1, 2, 3].map((touchNumber) => ({
  id: `template-${touchNumber}`,
  touchNumber,
  version: 1,
  body: `${TEMPLATE_SENTINEL} touch ${touchNumber}: check in on the quote.`,
}));

const VOICE = {
  greetingStyle: 'First name, no "Dear"',
  signOff: 'Mick',
  formality: 'Casual but not matey',
  bannedPhrases: ['just circling back'],
  exampleMessages: ['Hi Sam, any thoughts on that quote? Mick'],
  voiceNotes: 'Short sentences.',
};

const CADENCE = {
  quoteId: 'quote-1',
  contactName: 'Robin Vasquez',
  anchorAt: new Date('2026-08-20T02:00:00Z'),
  // 2026-10 (Phase 13, 13-02): the drafting pass picks the template set by the
  // cadence's kind. Every case in this suite is a QUOTE touch.
  kind: 'quote',
  leadId: null,
};

const QUOTE = {
  jobDescription: 'Replace meter box and mains upgrade',
  totalInvoiceAmount: '2450.00',
  quoteDateUtc: new Date('2026-08-12T02:00:00Z'),
};

const NOW = new Date('2026-08-26T02:00:00Z');

function touch(overrides: Partial<TouchRow> & { id: string }): TouchRow {
  return {
    cadenceId: 'cadence-1',
    touchNumber: 1,
    channel: 'sms',
    scheduledAt: new Date('2026-08-26T03:00:00Z'),
    ...overrides,
  };
}

interface FakeRepoOptions {
  queued?: readonly TouchRow[];
  templates?: readonly { id: string; touchNumber: number; version: number; body: string }[];
  settings?: typeof VOICE | null;
  priorBodies?: readonly string[];
  /** Attempts already on record for a touch, keyed by touch id. */
  priorAttempts?: Record<string, readonly { attempt: number }[]>;
  /** Touch ids an overlapping tick already holds the drafting claim on. */
  claimedElsewhere?: readonly string[];
}

interface StoredAttempt {
  id: string;
  touchId: string;
  attempt: number;
  status: string;
}

interface FakeRepo extends DraftRepository {
  readonly attempts: TouchDraftInsert[];
  readonly rows: StoredAttempt[];
  readonly markedPendingApproval: string[];
  readonly superseded: string[];
  readonly queueLimits: number[];
  /** Every id this pass claimed, in order. */
  readonly claimed: string[];
  /** Every id it gave back — the touches left in `needs_draft`. */
  readonly released: string[];
  /** Every id whose `draft_failures` counter this pass incremented. */
  readonly draftFailureBumps: string[];
}

function fakeRepo(options: FakeRepoOptions = {}): FakeRepo {
  const attempts: TouchDraftInsert[] = [];
  const rows: StoredAttempt[] = [];
  const markedPendingApproval: string[] = [];
  const superseded: string[] = [];
  const queueLimits: number[] = [];
  const claimed: string[] = [];
  const released: string[] = [];
  const draftFailureBumps: string[] = [];
  const settings = options.settings === undefined ? VOICE : options.settings;
  // Ids an "other tick" already holds — `claimForDrafting` returns everything
  // else, which is exactly what the real guarded UPDATE does.
  const heldElsewhere = new Set(options.claimedElsewhere ?? []);

  for (const [touchId, prior] of Object.entries(options.priorAttempts ?? {})) {
    for (const row of prior) {
      rows.push({
        id: `prior-${touchId}-${row.attempt}`,
        touchId,
        attempt: row.attempt,
        status: 'validator_failed',
      });
    }
  }

  return {
    attempts,
    rows,
    markedPendingApproval,
    superseded,
    queueLimits,
    claimed,
    released,
    draftFailureBumps,
    settings: {
      get: async () => (settings === null ? [] : [settings]),
    },
    templates: {
      latestApprovedSet: async () => options.templates ?? TEMPLATES,
      // 2026-10 (Phase 13, 13-02): the lead-default belt. Never reached here —
      // no cadence in this suite is a lead — so it inserts nothing.
      ensureLeadDefaults: async () => [],
    },
    cadences: {
      getById: async () => [CADENCE],
    },
    quotes: {
      byId: async () => [QUOTE],
    },
    // 2026-10 (Phase 13, 13-02): the two lead-fact reads. Unreached by quotes.
    leads: {
      byId: async () => [],
    },
    inbound: {
      latestForLead: async () => null,
    },
    drafts: {
      insertAttempt: async (row) => {
        attempts.push(row);
        const id = `draft-${attempts.length}`;
        rows.push({
          id,
          touchId: row.touchId,
          attempt: row.attempt,
          status: row.status,
        });
        return [{ id }];
      },
      latestForTouch: async (touchId) =>
        rows
          .filter((row) => row.touchId === touchId)
          .map((row) => ({ id: row.id, attempt: row.attempt, status: row.status }))
          .sort((a, b) => b.attempt - a.attempt),
      markSuperseded: async (draftId) => {
        superseded.push(draftId);
        const row = rows.find((candidate) => candidate.id === draftId);
        if (row && row.status === 'validator_failed') row.status = 'superseded';
        return [];
      },
      sentBodiesForCadence: async () => options.priorBodies ?? [],
    },
    touches: {
      listNeedsDraft: async (limit) => {
        queueLimits.push(limit);
        return options.queued ?? [];
      },
      claimForDrafting: async (ids) => {
        const won = ids.filter((id) => !heldElsewhere.has(id));
        claimed.push(...won);
        return won.map((id) => ({ id }));
      },
      releaseDraftingClaim: async (ids) => {
        released.push(...ids);
        return [];
      },
      bumpDraftFailures: async (id) => {
        draftFailureBumps.push(id);
        return [];
      },
      markPendingApproval: async (ids) => {
        markedPendingApproval.push(...ids);
        return [];
      },
    },
  };
}

interface FakeClient extends DraftClient {
  readonly requests: Record<string, unknown>[];
}

/**
 * A model that answers with the next scripted response for each call, capturing
 * every request it was given.
 */
function fakeClient(responses: readonly (DraftResponse | Error)[]): FakeClient {
  const requests: Record<string, unknown>[] = [];
  let index = 0;

  return {
    requests,
    messages: {
      parse: async (body) => {
        requests.push(body as unknown as Record<string, unknown>);
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

/**
 * A draft the validator refuses: `45` is a number nobody supplied.
 *
 * Chosen deliberately over an obviously-invented price. `45` shares its digits
 * with the supplied `$2,450`, which is the case 05-02's run-to-run whitelist
 * exists to catch — so this fixture also fails if that rule ever regresses to
 * substring matching.
 */
const BAD_DRAFT: DraftResponse = {
  parsed_output: { body: 'Hi Robin, I can swing past in 45 minutes if that suits?' },
  stop_reason: 'end_turn',
  usage: { input_tokens: 1180, output_tokens: 44, cache_read_input_tokens: 0 },
};

/** A well-formed draft: no digits the whitelist does not contain, plain ASCII. */
function goodDraft(text = 'Hi Robin, any questions about that quote?'): DraftResponse {
  return {
    parsed_output: { body: text },
    stop_reason: 'end_turn',
    usage: { input_tokens: 1180, output_tokens: 38, cache_read_input_tokens: 0 },
  };
}

describe('D-09 — one cached prefix per tenant batch', () => {
  it('sends a byte-identical system block with exactly one cache breakpoint', async () => {
    const repo = fakeRepo({
      queued: [
        touch({ id: 'a', touchNumber: 1, scheduledAt: new Date('2026-08-26T03:00:00Z') }),
        touch({ id: 'b', touchNumber: 2, scheduledAt: new Date('2026-08-26T04:00:00Z') }),
      ],
    });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.drafted).toBe(2);
    expect(client.requests).toHaveLength(2);

    const systems = client.requests.map(
      (request) => request.system as { type: string; text: string; cache_control?: unknown }[],
    );

    // ONE block, ONE breakpoint, in every request of the batch.
    for (const system of systems) {
      expect(system).toHaveLength(1);
      expect(system[0].type).toBe('text');
      expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    }

    // BYTE-IDENTICAL. A cache is a prefix match: one differing character in the
    // second request and the marker on the first one bought nothing.
    expect(systems[1][0].text).toBe(systems[0][0].text);

    // The whole approved SET is in that block — the 05-02 caller-half fix. A
    // per-touch template would make the two blocks differ, which the assertion
    // above already catches; this one says WHY they are the same.
    for (const template of TEMPLATES) {
      expect(systems[0][0].text).toContain(`Touch ${template.touchNumber}:`);
    }

    // The touch being written lives in the USER turn, which is what keeps one
    // cache entry per tenant rather than one per touch.
    expect(client.requests[0].messages).toEqual([
      { role: 'user', content: expect.stringContaining('Write touch 1') },
    ]);
    expect(client.requests[1].messages).toEqual([
      { role: 'user', content: expect.stringContaining('Write touch 2') },
    ]);
  });

  it('sends no sampling parameter and no thinking key (the Sonnet 5 400 trap)', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([goodDraft()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    const request = client.requests[0];
    // Proven live by `npm run verify:drafting`: sending `temperature` to
    // claude-sonnet-5 is a 400. Their absence is the configuration.
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(Object.keys(request)).not.toContain(banned);
    }
    expect(request.model).toBe(DRAFT_MODEL);
  });

  it('records the usage counters the caching question is answered with', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([
      {
        parsed_output: { body: 'Hi Robin, any questions?' },
        usage: { input_tokens: 1180, output_tokens: 38, cache_read_input_tokens: 1024 },
      },
    ]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(repo.attempts).toHaveLength(1);
    expect(repo.attempts[0].inputTokens).toBe(1180);
    expect(repo.attempts[0].outputTokens).toBe(38);
    expect(repo.attempts[0].cacheReadInputTokens).toBe(1024);
    // Counts, never bodies (T-2-02 / T-5-03).
    expect(repo.attempts[0].model).toBe(DRAFT_MODEL);
    expect(repo.attempts[0].promptVersion).toBe(PROMPT_VERSION);
  });
});

describe('AI-01 — batch order and the anti-starvation cap', () => {
  it('drafts in scheduled_at then id order, whichever read supplied the row', async () => {
    // Deliberately out of order in BOTH inputs, and the ids tie-break the two
    // touches sharing a slot — `claimDue`'s rule, mirrored.
    const at = (iso: string) => new Date(iso);
    const repo = fakeRepo({
      queued: [
        touch({ id: 'b', scheduledAt: at('2026-08-26T05:00:00Z') }),
        touch({ id: 'a', scheduledAt: at('2026-08-26T05:00:00Z') }),
      ],
    });
    const client = fakeClient([goodDraft()]);

    await draftTouches({
      repo,
      tenant: TENANT,
      touches: [touch({ id: 'c', scheduledAt: at('2026-08-26T04:00:00Z') })],
      client,
      now: NOW,
    });

    expect(repo.attempts.map((attempt) => attempt.touchId)).toEqual(['c', 'a', 'b']);
  });

  it('takes the queue read first, so a prior tick’s failures cannot starve', async () => {
    // 25 leftovers already waiting, plus one freshly promoted touch. The cap
    // admits the leftovers; the new arrival waits for the next tick.
    const queued = Array.from({ length: DRAFT_BATCH_LIMIT }, (_, i) =>
      touch({
        id: `old-${String(i).padStart(2, '0')}`,
        scheduledAt: new Date(Date.UTC(2026, 7, 26, 1, i)),
      }),
    );
    const repo = fakeRepo({ queued });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({
      repo,
      tenant: TENANT,
      touches: [touch({ id: 'new', scheduledAt: new Date('2026-08-26T09:00:00Z') })],
      client,
      now: NOW,
    });

    expect(counts.drafted).toBe(DRAFT_BATCH_LIMIT);
    expect(client.requests).toHaveLength(DRAFT_BATCH_LIMIT);
    expect(repo.attempts.map((attempt) => attempt.touchId)).not.toContain('new');
    // The read is asked for exactly the cap, never an unbounded list.
    expect(repo.queueLimits).toEqual([DRAFT_BATCH_LIMIT]);
  });

  it('de-duplicates a touch that is in both the queue read and the promotion', async () => {
    const shared = touch({ id: 'a' });
    const repo = fakeRepo({ queued: [shared] });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({
      repo,
      tenant: TENANT,
      touches: [shared],
      client,
      now: NOW,
    });

    expect(counts.drafted).toBe(1);
    expect(client.requests).toHaveLength(1);
  });

  it('drafts a promoted touch the queue read has not caught up with', async () => {
    const repo = fakeRepo({ queued: [] });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({
      repo,
      tenant: TENANT,
      touches: [touch({ id: 'promoted' })],
      client,
      now: NOW,
    });

    expect(counts.drafted).toBe(1);
    expect(repo.markedPendingApproval).toEqual(['promoted']);
  });
});

describe('D-02 — everything the model sees comes from our own mirror', () => {
  it('puts the prior SENT bodies of this cadence in the user turn', async () => {
    const repo = fakeRepo({
      queued: [touch({ id: 'a', touchNumber: 2 })],
      priorBodies: ['Hi Robin, sent this one already. Perth Sparks Electrical.'],
    });
    const client = fakeClient([goodDraft()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    const user = (client.requests[0].messages as { content: string }[])[0].content;
    expect(user).toContain('Already sent on this quote');
    expect(user).toContain('sent this one already');
    // And never in the SYSTEM block, which must stay per-tenant rather than
    // per-cadence or the cache entry fragments.
    const system = client.requests[0].system as { text: string }[];
    expect(system[0].text).not.toContain('sent this one already');
  });
});

describe('ONB-03 — a client who is not finished being set up is not drafted for', () => {
  it('counts no_approved_template for a touch whose wording is unapproved', async () => {
    const repo = fakeRepo({
      queued: [touch({ id: 'a', touchNumber: 4 })],
    });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.noApprovedTemplate).toBe(1);
    expect(counts.drafted).toBe(0);
    // THE MODEL WAS NEVER CALLED — the belt is checked before the request is
    // built, so an un-onboarded client cannot produce a draft to approve.
    expect(client.requests).toHaveLength(0);
    expect(repo.attempts).toEqual([]);
  });

  it('refuses to draft a non-SMS touch with the SMS template (D-04)', async () => {
    const repo = fakeRepo({
      queued: [
        touch({ id: 'mail', channel: 'email' }),
        touch({ id: 'txt', scheduledAt: new Date('2026-08-26T04:00:00Z') }),
      ],
    });
    const client = fakeClient([goodDraft(), goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    // The email touch is never asked about. Every rule this pass applies —
    // GSM-7 septets, the two-segment cap, the SMS opt-out suffix — is an SMS
    // rule, and `approvedSetStatus()` is SMS-only, so the activation gate would
    // not have caught this one on its way here.
    expect(client.requests).toHaveLength(1);
    expect(counts.noApprovedTemplate).toBe(1);
    expect(counts.drafted).toBe(1);
    expect(repo.markedPendingApproval).toEqual(['txt']);
    expect(repo.attempts.map((a) => a.touchId)).toEqual(['txt']);
  });

  it('counts no_voice_profile when the settings row is missing entirely', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })], settings: null });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.noVoiceProfile).toBe(1);
    expect(counts.drafted).toBe(0);
    expect(client.requests).toHaveLength(0);
  });

  it('does nothing at all, and asks nothing of the database, with no API key', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });

    const counts = await draftTouches({
      repo,
      tenant: TENANT,
      touches: [touch({ id: 'a' })],
      client: null,
      now: NOW,
    });

    expect(counts.unconfigured).toBe(1);
    // An unconfigured deployment does not run a query per tenant per minute to
    // rediscover that it has no key.
    expect(repo.queueLimits).toEqual([]);
  });

  it('reports unconfigured as a FLAG, not as this minute’s promotion count', async () => {
    // ── THE STEADY STATE, WHICH IS THE ONLY STATE THAT MATTERS HERE ───────
    //
    // Zero promotions is what a mature backlog looks like: every touch was
    // promoted on some earlier tick and is sitting in `needs_draft`. When
    // `unconfigured` was `touches.length`, this case reported
    // `touchesPromoted: 0, touchesDrafted: 0, draftingUnconfigured: 0` — byte-
    // identical to a quiet minute with nothing to do, which is precisely the
    // failure the anti-starvation read exists to prevent.
    const repo = fakeRepo({ queued: [touch({ id: 'a' }), touch({ id: 'b' })] });

    const counts = await draftTouches({
      repo,
      tenant: TENANT,
      touches: [],
      client: null,
      now: NOW,
    });

    expect(counts.unconfigured).toBe(1);
  });
});

describe('D-11 — exactly one regeneration, and never a third call', () => {
  it('regenerates once on a validator rejection and supersedes the loser', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([BAD_DRAFT, goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.drafted).toBe(1);
    expect(counts.validatorFailed).toBe(0);
    // TWO calls. Not one, not three.
    expect(client.requests).toHaveLength(2);

    // BOTH attempts are on record — the rejected one is kept, relabelled.
    expect(repo.attempts.map((a) => [a.attempt, a.status])).toEqual([
      [1, 'validator_failed'],
      [2, 'generated'],
    ]);
    expect(repo.superseded).toEqual(['draft-1']);
    expect(repo.markedPendingApproval).toEqual(['a']);
  });

  it('feeds the violation back as an instruction naming the provided value', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([BAD_DRAFT, goodDraft()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    const second = (client.requests[1].messages as { content: string }[])[0].content;
    expect(second).toContain('Your previous attempt was rejected');
    // The offending token AND the value it should have used — "invalid number"
    // is a complaint, this is an instruction (05-02 shaped the violations for it).
    expect(second).toContain('"45"');
    expect(second).toContain('$2,450');

    // The FIRST request carried no feedback section — a model told it was
    // rejected before it wrote anything is being lied to.
    const first = (client.requests[0].messages as { content: string }[])[0].content;
    expect(first).not.toContain('Your previous attempt was rejected');

    // And the feedback never entered the system block, which must stay
    // byte-identical across the batch or the cache breakpoint buys nothing.
    const systems = client.requests.map((r) => (r.system as { text: string }[])[0].text);
    expect(systems[1]).toBe(systems[0]);
  });

  it('parks the touch for mandatory human authoring when both attempts fail', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([BAD_DRAFT, BAD_DRAFT]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.validatorFailed).toBe(1);
    expect(counts.drafted).toBe(0);
    expect(client.requests).toHaveLength(2);
    expect(repo.attempts.map((a) => a.status)).toEqual([
      'validator_failed',
      'validator_failed',
    ]);
    // Nothing is superseded — no attempt won.
    expect(repo.superseded).toEqual([]);
    // OFF the drafting queue and onto a human's. `validator_failed` is the
    // status the approve action refuses to pass through unedited (05-07).
    expect(repo.markedPendingApproval).toEqual(['a']);
  });
});

describe('D-10 — the API failure taxonomy', () => {
  const rateLimit = () =>
    new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
  const connection = () => new Anthropic.APIConnectionError({ message: 'socket hang up' });
  const overloaded = () =>
    new Anthropic.APIError(529, undefined, 'overloaded', new Headers(), 'overloaded_error');
  const badRequest = () =>
    new Anthropic.BadRequestError(400, undefined, 'bad request', new Headers());

  const threeTouches = [
    touch({ id: 'a', scheduledAt: new Date('2026-08-26T03:00:00Z') }),
    touch({ id: 'b', scheduledAt: new Date('2026-08-26T04:00:00Z') }),
    touch({ id: 'c', scheduledAt: new Date('2026-08-26T05:00:00Z') }),
  ];

  it('stops the tenant’s batch on a rate limit, leaving the rest untouched', async () => {
    const repo = fakeRepo({ queued: threeTouches });
    const client = fakeClient([goodDraft(), rateLimit(), goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.drafted).toBe(1);
    expect(counts.rateLimited).toBe(1);
    // The batch STOPPED: touch c was never asked about. The SDK already retried
    // twice with backoff before this reached us; continuing is hammering.
    expect(client.requests).toHaveLength(2);
    expect(repo.markedPendingApproval).toEqual(['a']);
  });

  it('stops the batch on a connection error', async () => {
    const repo = fakeRepo({ queued: threeTouches });
    const client = fakeClient([connection(), goodDraft(), goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.apiDeferred).toBe(1);
    expect(counts.drafted).toBe(0);
    expect(client.requests).toHaveLength(1);
    // NOTHING recorded and nothing moved — the touch is exactly where it was.
    expect(repo.attempts).toEqual([]);
    expect(repo.markedPendingApproval).toEqual([]);
  });

  it('stops the batch on a 529 overload, which is a bare APIError with a type', async () => {
    const repo = fakeRepo({ queued: threeTouches });
    const client = fakeClient([overloaded()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.apiDeferred).toBe(1);
    expect(client.requests).toHaveLength(1);
  });

  it('CONTINUES the batch on a deterministic 400, recording no body row', async () => {
    const repo = fakeRepo({ queued: threeTouches });
    const client = fakeClient([badRequest(), goodDraft(), goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.deterministicFailed).toBe(1);
    // The other two touches were drafted. A 400 we cannot attribute to the
    // deployment or to this one touch must not park the tenant's whole
    // oldest-first queue behind it.
    expect(counts.drafted).toBe(2);
    expect(client.requests).toHaveLength(3);

    // NO attempt row for the failed touch: there is no model output to be
    // evidence of, and no regeneration either — a 400 is identical on retry.
    expect(repo.attempts.map((a) => a.touchId)).toEqual(['b', 'c']);
    expect(repo.markedPendingApproval).not.toContain('a');
  });

  it('counts a deterministic failure AGAINST THE ROW, so it terminates', async () => {
    // ── THE UNBOUNDED CASE THIS CLOSES ────────────────────────────────────
    //
    // `MAX_DRAFT_ATTEMPTS` is read from `touch_drafts`, and a 400 writes no row
    // there. So a touch whose input makes every request a 400 accumulated ZERO
    // recorded attempts, was offered by `listNeedsDraft` every minute, and burnt
    // calls until D-12 expired the cadence six weeks later. `draft_failures` is
    // the counter that makes the touch-specific case stop; `listNeedsDraft`
    // stops offering a touch at the cap.
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([badRequest()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(repo.draftFailureBumps).toEqual(['a']);
    // Still no fabricated evidence: the counter bounds the touch, the ledger
    // records only what the model actually wrote.
    expect(repo.attempts).toEqual([]);
  });

  it.each([
    ['a rate limit', () => rateLimit()],
    ['a connection error', () => connection()],
    ['a 529 overload', () => overloaded()],
  ])('does NOT count %s against the row', async (_name, make) => {
    // None of these is a property of the touch — the same input succeeds next
    // minute. Spending the touch's budget on the API's bad day would retire a
    // customer's follow-up for a reason that has nothing to do with it.
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([make()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(repo.draftFailureBumps).toEqual([]);
  });

  it('logs the class name and status only — never a body or a prompt', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
      await draftTouches({
        repo,
        tenant: TENANT,
        touches: [],
        client: fakeClient([badRequest()]),
        now: NOW,
      });

      const logged = errors.mock.calls.flat().join(' ');
      expect(logged).toContain('BadRequestError');
      expect(logged).toContain('400');
      // T-5-03: an SDK error's message carries the request body, which is the
      // whole prompt — the customer's name, their job, their price.
      expect(logged).not.toContain('bad request');
      expect(logged).not.toContain('Robin');
      expect(logged).not.toContain('meter box');
      expect(logged).not.toContain(TEMPLATE_SENTINEL);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('D-10 — a 200 that carries no draft', () => {
  it('records a refusal and NEVER re-asks the same question', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([{ parsed_output: null, stop_reason: 'refusal' }, goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    // ONE call. The input is identical on a second ask and the model has
    // already said what it thinks of it.
    expect(client.requests).toHaveLength(1);
    expect(counts.validatorFailed).toBe(1);
    expect(counts.drafted).toBe(0);

    // Recorded — a refusal nobody can see is indistinguishable from a model
    // that was never called.
    expect(repo.attempts).toHaveLength(1);
    expect(repo.attempts[0].status).toBe('validator_failed');
    // NOTHING FROM THE MODEL, because there was nothing.
    expect(repo.attempts[0].generatedBody).toBe('');
    // BUT THE COMPLIANCE LINE SURVIVES. `final_body` pre-fills the operator's
    // edit box; left empty they had to reproduce the exact Spam Act suffix from
    // memory, their first submission failed `missing_suffix`, and only that
    // refusal told them the required text. They write the message; the
    // compliance line is ours and is identical every time.
    expect(repo.attempts[0].finalBody).toBe(
      'Perth Sparks Electrical. Reply STOP to opt out.',
    );
    // And it is only the suffix — no template text, no model text, nothing that
    // could be approved unedited as a message to a customer.
    expect(repo.attempts[0].finalBody).not.toContain(TEMPLATE_SENTINEL);
    expect(JSON.stringify(repo.attempts[0].validatorFailures)).toContain('refusal');
    // Parked for a human to write.
    expect(repo.markedPendingApproval).toEqual(['a']);
  });

  it('regenerates once after a max_tokens truncation', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([
      { parsed_output: null, stop_reason: 'max_tokens' },
      goodDraft(),
    ]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.drafted).toBe(1);
    expect(client.requests).toHaveLength(2);
    const second = (client.requests[1].messages as { content: string }[])[0].content;
    expect(second).toContain('cut off');
    // `attempt` counts RECORDED attempts, and the truncated call produced
    // nothing to record — so the surviving row is attempt 1, not 2. The column
    // is the evidence index the ceiling counts, not a call counter.
    expect(repo.attempts.map((a) => [a.attempt, a.status])).toEqual([[1, 'generated']]);
  });

  it('parks a touch the model truncates twice', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const truncated = { parsed_output: null, stop_reason: 'max_tokens' };
    const client = fakeClient([truncated, truncated]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.validatorFailed).toBe(1);
    expect(client.requests).toHaveLength(2);
    expect(repo.markedPendingApproval).toEqual(['a']);
  });

  it('regenerates once when the output does not satisfy the schema', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([{ parsed_output: null, stop_reason: 'end_turn' }, goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.drafted).toBe(1);
    expect(client.requests).toHaveLength(2);
  });
});

describe('the drafting claim — overlapping ticks do not draft the same touch', () => {
  it('claims every candidate BEFORE spending a model call', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([goodDraft()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(repo.claimed).toEqual(['a']);
  });

  it('does not draft a touch an overlapping tick already holds', async () => {
    const repo = fakeRepo({
      queued: [
        touch({ id: 'a' }),
        touch({ id: 'b', scheduledAt: new Date('2026-08-26T04:00:00Z') }),
      ],
      claimedElsewhere: ['a'],
    });
    const client = fakeClient([goodDraft(), goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    // THE POINT: one call, not two. The duplicate Sonnet call is what the claim
    // is for, and it is prevented before the request rather than deduplicated
    // after it.
    expect(client.requests).toHaveLength(1);
    expect(counts.claimedElsewhere).toBe(1);
    expect(counts.drafted).toBe(1);
    expect(repo.markedPendingApproval).toEqual(['b']);
    // And no attempt row was written for `a`, so its `attempt` numbering cannot
    // collide with the tick that owns it.
    expect(repo.attempts.map((a) => a.touchId)).toEqual(['b']);
  });

  it('gives the claim back on a touch left in needs_draft', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([
      new Anthropic.BadRequestError(400, undefined, 'bad request', new Headers()),
    ]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    // Released, so the NEXT tick retries in sixty seconds. Waiting out
    // DRAFT_CLAIM_STALE_MS instead would turn every ordinary failure into a
    // six-minute delay on a customer's follow-up.
    expect(repo.released).toEqual(['a']);
    expect(repo.markedPendingApproval).toEqual([]);
  });

  it('keeps the claim on a touch it parked at pending_approval', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient([goodDraft()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    // Nothing to release: the touch has left the drafting queue, so the column
    // means nothing and re-clearing it would be a write for its own sake.
    expect(repo.markedPendingApproval).toEqual(['a']);
    expect(repo.released).toEqual([]);
  });

  it('releases the touches a batch stop never reached', async () => {
    const repo = fakeRepo({
      queued: [
        touch({ id: 'a', scheduledAt: new Date('2026-08-26T03:00:00Z') }),
        touch({ id: 'b', scheduledAt: new Date('2026-08-26T04:00:00Z') }),
        touch({ id: 'c', scheduledAt: new Date('2026-08-26T05:00:00Z') }),
      ],
    });
    const client = fakeClient([
      goodDraft(),
      new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers()),
    ]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    // `a` was parked; `b` failed and `c` was never reached — and a 429 must not
    // hold two touches hostage for six minutes.
    expect(repo.released.sort()).toEqual(['b', 'c']);
  });

  it('releases every claim when the tenant turns out to have no voice profile', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })], settings: null });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.noVoiceProfile).toBe(1);
    expect(repo.released).toEqual(['a']);
  });

  it('releases the claim even when the pass throws outside the per-touch loop', async () => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    // A repository failure between the claim and the loop is exactly the case a
    // `finally` exists for: without it these touches wait out the staleness
    // window because of OUR error, not theirs.
    repo.templates.latestApprovedSet = async () => {
      throw new Error('database went away');
    };
    const client = fakeClient([goodDraft()]);

    await expect(
      draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW }),
    ).rejects.toThrow('database went away');

    expect(repo.released).toEqual(['a']);
  });

  it('passes a staleness cutoff behind now, so a slow tick is not robbed', async () => {
    const seen: { now: Date; staleBefore: Date }[] = [];
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    repo.touches.claimForDrafting = async (ids, now, staleBefore) => {
      seen.push({ now, staleBefore });
      return ids.map((id) => ({ id }));
    };
    const client = fakeClient([goodDraft()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.now).toEqual(NOW);
    expect(NOW.getTime() - seen[0]!.staleBefore.getTime()).toBe(DRAFT_CLAIM_STALE_MS);
    // Longer than the route's 300s maxDuration: a tick that is merely slow must
    // never have a touch it is actively drafting taken off it.
    expect(DRAFT_CLAIM_STALE_MS).toBeGreaterThan(300_000);
  });
});

describe('Pitfall 4 — a poisoned touch cannot burn calls forever', () => {
  it('skips a touch that already has MAX_DRAFT_ATTEMPTS attempts on record', async () => {
    const repo = fakeRepo({
      queued: [touch({ id: 'a' }), touch({ id: 'b', scheduledAt: new Date('2026-08-26T06:00:00Z') })],
      priorAttempts: {
        a: Array.from({ length: MAX_DRAFT_ATTEMPTS }, (_, i) => ({ attempt: i + 1 })),
      },
    });
    const client = fakeClient([goodDraft()]);

    const counts = await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    expect(counts.attemptsExhausted).toBe(1);
    // NOT a batch stop — the other touch is still drafted.
    expect(counts.drafted).toBe(1);
    expect(client.requests).toHaveLength(1);
    // Left exactly where it was. Retiring it is the cadence engine's decision
    // (D-10/D-11 staleness), not the drafter's.
    expect(repo.markedPendingApproval).toEqual(['b']);
  });

  it('counts attempts from the record, so they accumulate across ticks', async () => {
    const repo = fakeRepo({
      queued: [touch({ id: 'a' })],
      priorAttempts: { a: [{ attempt: 1 }, { attempt: 2 }] },
    });
    const client = fakeClient([BAD_DRAFT, goodDraft()]);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    // Numbering continues from what is on record — 3 and 4, never 1 again.
    expect(repo.attempts.map((a) => a.attempt)).toEqual([3, 4]);
  });
});

describe('D-10 — no failure path emits template text as a body', () => {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE MERGE-FILL PROHIBITION, AS A PROPERTY OF EVERY PATH AT ONCE.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The raw template body is the one string a "sensible fallback" would be built
   * from, and it carries a sentinel no model output contains. If any failure
   * path ever composes a body from it, one of these runs records it.
   */
  const scenarios: Array<[string, (DraftResponse | Error)[]]> = [
    ['success', [goodDraft()]],
    ['validator fail then pass', [BAD_DRAFT, goodDraft()]],
    ['validator fail twice', [BAD_DRAFT, BAD_DRAFT]],
    ['refusal', [{ parsed_output: null, stop_reason: 'refusal' }]],
    [
      'truncated twice',
      [
        { parsed_output: null, stop_reason: 'max_tokens' },
        { parsed_output: null, stop_reason: 'max_tokens' },
      ],
    ],
    ['unparseable then pass', [{ parsed_output: null }, goodDraft()]],
    ['rate limited', [new Anthropic.RateLimitError(429, undefined, 'x', new Headers())]],
    ['connection error', [new Anthropic.APIConnectionError({ message: 'x' })]],
    ['deterministic 400', [new Anthropic.BadRequestError(400, undefined, 'x', new Headers())]],
  ];

  it.each(scenarios)('never records template text as a body: %s', async (_name, responses) => {
    const repo = fakeRepo({ queued: [touch({ id: 'a' })] });
    const client = fakeClient(responses);

    await draftTouches({ repo, tenant: TENANT, touches: [], client, now: NOW });

    for (const attempt of repo.attempts) {
      expect(attempt.generatedBody).not.toContain(TEMPLATE_SENTINEL);
      expect(attempt.finalBody).not.toContain(TEMPLATE_SENTINEL);
    }
  });
});
