/**
 * One cadence tick: consume, make progress, dispatch — in that order, once a
 * minute.
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*`. The tick route
 * (plan 03-06) is one caller; a script and a test are the others, and none of
 * them may be the only place a guarantee holds.
 *
 * ── WHY THE THREE PASSES ARE ORDERED, AND WHY THAT ORDER ────────────────────
 *
 *   1. CONSUME. Events are facts about what already happened, so acting on them
 *      first means the rest of the tick works from the freshest state we have.
 *      In particular a quote won thirty seconds ago stops its cadence BEFORE the
 *      dispatch pass would have looked at that cadence's due touch. STOPS
 *      ALWAYS LAND BEFORE SENDS WITHIN A TICK, and this ordering is the whole
 *      mechanism.
 *   2. PROGRESS — three sub-passes, themselves ordered:
 *        a. EXPIRY (D-12). A cadence older than `CADENCE_EXPIRY_DAYS` from its
 *           anchor ends, and its unsent touches are retired as `cadence_expired`.
 *           First, so the next sub-pass never spends a decision on a touch
 *           belonging to a cadence that is already over.
 *        b. RE-WINDOW (D-09/D-10/D-11). Every unsent overdue touch is judged by
 *           `rewindowTouch` and moved, retired or left alone. This is where "a
 *           late touch is worse than a skipped touch" actually happens.
 *        c. PROMOTE (D-14). The draft and approval gates, which Phase 3
 *           auto-passes: `scheduled → approved` in one statement, for touches
 *           inside the draft lead window on ACTIVE cadences. LAST of the three,
 *           because promoting a touch and then moving it would surface work to
 *           the drafting queue at a time it is no longer going out at. Phases 5
 *           and 6 replace this sub-pass with real gates; nothing else changes
 *           when they do, which is the whole reason the intermediate states ship
 *           now (D-14 is one-way).
 *   3. DISPATCH. Only `approved` touches whose slot has arrived, each one
 *      revalidated inside its claim transaction.
 *      3b. TEXT-BACK SWEEP (Phase 12, D-01/D-20). Missed calls between 45 s and
 *      10 min old that no status callback claimed are texted through the one
 *      `sendTextBack`; older ones are marked stale. Beside dispatch because it
 *      touches a customer. Runs only when the route supplies its sender.
 *   6a. QUOTE-CALL ESCALATION (Phase 12, 12-05, D-16). A quote customer who
 *      rang and was missed (`text_back_route = 'quote'`) is told to the
 *      tradie's own escalation phone, once per call, on the SAME
 *      `escalationSender` seam as the hot-lead pass and directly after it.
 *      Then (Phase 13, 13-06) RING-TWICE (D-07): a caller with an open lead
 *      who rang twice inside 30 minutes, escalated on the second call's id —
 *      and then the RELEASE of held escalations (D-09) whose contact window
 *      has opened, each sent once. Same seam; undefined means neither scans.
 *   6b. TEXT-BACK ALERTS (Phase 12, D-10). Failed and stuck text-backs are
 *      claimed once and emailed to the operator, counts only. After
 *      escalation, before aging: it sends mail. Runs only with the ops seam.
 *   6c. CLICKSEND BALANCE (Phase 12, D-10/D-21). Every fifteenth minute, or at
 *      once after an insufficient-credit refusal, while anyone is armed: alert
 *      below A$20, audited auto-disarm below A$5, never on an unreadable read.
 *   4. COMPLETE. The cadences whose every touch is now terminal are closed
 *      (`all_touches_done`). AFTER dispatch, deliberately: a touch sent thirty
 *      lines ago is terminal, and sweeping before the send would leave the
 *      cadence looking live for one more minute for no reason. This is the
 *      production driver for the one CAD-03 event nothing else raises — without
 *      it a finished cadence sits `active` until D-12 expires it at six weeks,
 *      which reports as "ran out of time" for a schedule that actually ran its
 *      course. A PAUSED cadence is deliberately left alone; see the repository
 *      method's comment and `transitions.ts` note 5.
 *   5. CLASSIFY (AI-02, plan 05-06). Inbound replies that arrived unlabelled get
 *      a label and a confidence from `claude-opus-5`. DEAD LAST, and that
 *      placement is the D-16 guarantee expressed as an ordering: nothing above
 *      reads a label, so a model call can never stand in front of a send — and
 *      the STOP that the LLM-free webhook honoured minutes ago never waited on
 *      one either.
 *   6. ESCALATE (CON-03, plan 06-05). Every reply pass 5 just marked `is_hot`
 *      becomes an SMS to the TRADIE — customer name, quote, their words, their
 *      number. IMMEDIATELY AFTER CLASSIFICATION, and that adjacency is D-08's
 *      "within minutes" expressed as an ordering rather than as a promise.
 *   7. AGE (CON-04, plan 06-02). The touches about to miss their approval
 *      deadline are claimed and the operator is emailed once. LAST, because it
 *      sends mail and nothing above it reads `stall_alerted_at`.
 *
 * A cadence created in pass 1 with an offset-0 touch due immediately is
 * therefore promoted in pass 2 and sent in pass 3 OF THE SAME TICK. That is
 * D-01 working: a quote ticked eligible at 10am goes out this morning, not
 * tomorrow.
 *
 * ── WHICH TENANTS EACH PASS RUNS FOR ────────────────────────────────────────
 *
 * Pass 1 runs for EVERY tenant, paused or not: the events it consumes stop
 * cadences rather than start them, and a client whose key died last week still
 * needs the job they won on Tuesday to stop being chased.
 *
 * Passes 2 and 3 run only for tenants with neither pause set. That exclusion is
 * not merely "do not send while paused" — it is that a paused tenant's schedule
 * MUST NOT DRIFT tick by tick. Their mirror is stale (connection pause) or their
 * mandate is withdrawn (client pause), and repairing their schedule against a
 * moment that is not their resume would put every touch a few minutes further
 * into the past on every tick. Their repair happens exactly once, at the moment
 * the pause lifts, through the one D-07 rule in `resume.ts`.
 *
 * ── THE INJECTED CLOCK, RNG AND SENDER ARE PRODUCTION SEAMS ─────────────────
 *
 * They are not test hooks that happen to be public. `sender` is the D-13 seam
 * Phase 4 swaps `ClickSendSender` into — the swap is a caller change, not an
 * edit to this file. `jitterMinutes` is injected because a function that reached
 * for the global random source would have a dependency its signature does not
 * admit to (and CAD-02's determinism could not then be asserted). `now` is
 * injected because "is this touch due" is the one question in the system whose
 * answer must be pinnable.
 *
 * ── THE RESULT IS COUNTS ONLY ───────────────────────────────────────────────
 *
 * No client names, no quote descriptions, no addresses, no error strings. This
 * object becomes the tick route's HTTP response body, which is the only output
 * of this system not behind RLS. Outcomes are recorded durably in tables; the
 * response says how much happened, never to whom.
 */
import {
  forAllTenants_cadenceTick,
  forAllTenants_claimNewlyStalled,
  forTenant,
  type CadenceTickTenant,
} from '@/db/repository';

import { stallBoundary } from '@/core/aging/stall-policy';
import {
  consumeWonEvents,
  NO_ATTRIBUTION,
  type ConsumeWonEventsResult,
} from '@/core/attribution/consume-wins';
import {
  buildStalledAlert,
  noopStalledEmailSender,
  queueUrl,
  type StalledEmailSender,
} from '@/core/alerts/stalled-drafts';

import { CADENCE_KINDS, type CadenceKind } from '@/db/schema';

import { consumeQuoteEvents, NO_CONSUMPTION } from './consume-events';
import { DEFAULT_PREFERRED_SEND_TIME, DRAFT_LEAD_HOURS } from './constants';
import {
  contactWindowOf,
  dispatchDueTouches,
  type DispatchRefusal,
} from './dispatch';
import { randomJitterMinutes } from './jitter';
import { policyFor, type CadencePolicy } from './policy';
import { rewindowTouch } from './rewindow';
import { buildAnthropicClient, buildClassifyClient } from '@/core/shared/anthropic';
import { draftTouches, type DraftClient } from '@/core/drafting/draft-touches';
import {
  classifyInbound,
  NO_CLASSIFICATIONS,
  type ClassifyClient,
  type ClassifyCounts,
} from '@/core/classification/classify-inbound';
import {
  escalateHotLeads,
  NO_ESCALATIONS,
  type EscalationCounts,
  type EscalationSmsSender,
} from '@/core/escalation/escalate-hot-leads';
import {
  escalateQuoteCalls,
  NO_QUOTE_CALL_ESCALATIONS,
  type QuoteCallEscalationCounts,
} from '@/core/escalation/quote-call';
import {
  NO_RELEASES,
  releaseHeldEscalations,
  type ReleaseHeldCounts,
} from '@/core/escalation/release-held';
import {
  escalateRingTwiceCalls,
  NO_RING_TWICE_ESCALATIONS,
  type RingTwiceEscalationCounts,
} from '@/core/escalation/ring-twice';
import {
  NO_TEXT_BACK_ALERTS,
  NO_TEXT_BACK_SWEEP,
  runTextBackAlertPass,
  runTextBackSweep,
  type TextBackAlertCounts,
  type TextBackSweepCounts,
} from '@/core/leads/sweep';
import { NO_BALANCE_PROBE, runBalanceProbe, type BalanceProbeCounts } from '@/core/leads/balance';
import { closeLeadInTx, closeLeadsWithEndedCadences } from '@/core/leads/close';
import { applyLeadLabelEffects } from '@/core/leads/label-effects';

import { StubSender, type TouchSender } from './sender';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface RunCadenceTickOptions {
  /** Defaults to the real clock. Pinned in tests. */
  now?: Date;
  /** Minutes, drawn once per placement. Defaults to [0, JITTER_MAX_MINUTES]. */
  jitterMinutes?: () => number;
  /** Defaults to the D-13 stub. Phase 4 passes a real provider here. */
  sender?: TouchSender;
  /** Events consumed per tick; see `CONSUME_BATCH_LIMIT`. */
  batchLimit?: number;
  /**
   * The drafting seam (Phase 5). Defaults to `buildAnthropicClient()`, which is
   * `null` when no key is configured — and a null client is a legitimate
   * runtime state, not a test-only one (D-10).
   *
   * `undefined` means "build the real one"; an explicit `null` means "there is
   * no client", which is what a test asserting the unconfigured path passes.
   * The two are therefore NOT interchangeable here, and the destructuring below
   * uses a sentinel rather than a default parameter for exactly that reason.
   */
  draftClient?: DraftClient | null;
  /**
   * The classification seam (Phase 5, plan 05-06). Same `undefined` vs `null`
   * contract as `draftClient` above, and a SEPARATE option rather than a reuse
   * of it: the two workloads run on different timeout budgets (60s for prose,
   * 30s for two enum fields — see `src/core/shared/anthropic.ts`), and a test
   * that wants to disable one pass while exercising the other must be able to
   * say so.
   */
  classifyClient?: ClassifyClient | null;
  /**
   * The stall-alert sink (06-02). Defaults to the real Resend path.
   *
   * A PRODUCTION SEAM, not a test hook, and it DEFAULTS TO A NO-OP for exactly
   * the reason `sender` defaults to `StubSender`: this function is reachable
   * from a script and from every remote suite, all of which run against the
   * hosted database, so a real Resend default here would mean `npm run
   * test:remote` mails the operator about seeded rows. The ROUTE is the
   * composition root that knows about configuration and passes the real sender.
   * The no-op reports `not_configured`, so a caller that forgets lands in
   * `stallAlertFailed` rather than in a silent success.
   */
  stallAlertSender?: StalledEmailSender;
  /**
   * The hot-lead escalation seam (06-05, CON-03). Defaults to UNDEFINED, and
   * that default is load-bearing rather than lazy.
   *
   * Undefined means the escalation pass DOES NOT RUN AND DOES NOT SCAN. Claiming
   * an `escalations` row consumes the never-twice right for that reply
   * permanently, so a pass with nowhere to send must not touch the table —
   * `runCadenceTick` is reachable from a script and from every remote suite,
   * all of which run against the hosted Sydney database, and a claim taken there
   * would silently retire a real client's hot lead.
   *
   * Same composition-root split as `stallAlertSender`: the ROUTE knows about
   * credentials and passes the real sender; `src/core` never builds one from the
   * environment (the 05-06 lesson). A caller that forgets lands in
   * `escalationUnconfigured`, which is visible, rather than in a silent zero.
   */
  escalationSender?: EscalationSmsSender;
  /**
   * The attribution seam (07-03, RPT-01). DEFAULTS TO `'skip'`, and that default
   * is the strictest one in this interface.
   *
   * `'skip'` means the attribution pass DOES NOT REGISTER, DOES NOT SCAN and
   * DOES NOT ADVANCE. Not "runs and finds nothing" — does not start.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY A NO-OP DEFAULT IS LOAD-BEARING HERE. A brand-new consumer registers │
   * │ its cursor AT ZERO, by contract — "a consumer that does not exist yet    │
   * │ must not silently appear to be up to date" — and then walks the entire   │
   * │ outbox. `runCadenceTick` is reachable from a script and from every       │
   * │ remote suite, all of which run against the hosted Sydney database. The   │
   * │ FIRST such call to reach an unregistered attribution cursor would drain  │
   * │ every real client's `won` history into `quote_attributions`: real rows,  │
   * │ on a production table, that no method on this codebase can delete —      │
   * │ `forTenant().attributions` exposes no `update` and no `delete`, ever.    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Same composition-root split as `escalationSender` above, one step further:
   * that one defaults to undefined because a claim RETIRES a hot lead; this one
   * defaults to skip because a claim BILLS a client. The ROUTE is the only
   * caller that passes `'run'`, and `tests/attribution-consume.test.ts` is the
   * only suite that does.
   */
  attribution?: 'run' | 'skip';
  /**
   * The text-back guarantee sweep's sender (Phase 12, D-01/D-20, TXT-02).
   * NO DEFAULT, in the `escalationSender` mould, and for the same reason.
   *
   * Undefined means the sweep DOES NOT RUN AND DOES NOT SCAN — it neither
   * claims a pending call nor marks an old one stale. Claiming a missed call
   * consumes its never-twice right permanently (a claimed call is never
   * re-sent, D-04), and `runCadenceTick` is reachable from a script and from
   * every remote suite against the hosted Sydney database: a default here
   * would let a test run text a real client's caller, or silently retire
   * their call as handled.
   *
   * The ROUTE passes the routing sender it already built for the tick, and is
   * the only caller that does. A caller that forgets lands in
   * `textBackUnconfigured`, which is visible.
   */
  textBackSender?: TouchSender;
  /**
   * The text-back operator seam (Phase 12, D-10, TXT-06): the failed / stuck
   * text-back alert pass and the ClickSend balance probe. NO DEFAULT.
   *
   * Undefined means NEITHER RUNS. Both consume a once-only claim — the alert
   * pass stamps `text_back_alerted_at` on every failed or stuck row it reports,
   * and the probe latches today's operator alert and can disarm every armed
   * client — so a script or a remote suite against the hosted database must
   * not be able to spend them by forgetting a seam.
   *
   * `alertSender` is the closed-vocabulary email sink (never SMS: an SMS about
   * an empty SMS balance goes nowhere). `clicksend` carries the two credential
   * values the route already reads; either absent makes the probe report an
   * unreadable balance — never a disarm. `fetchImpl` is injected in tests.
   * The ROUTE is the only caller that passes this.
   */
  textBackOps?: {
    alertSender: StalledEmailSender;
    clicksend: { username: string | undefined; apiKey: string | undefined };
    fetchImpl?: typeof fetch;
  };
}

export interface CadenceTickResult {
  eventsConsumed: number;
  cadencesCreated: number;
  cadencesStopped: number;
  /**
   * D-08 reopen triage — quotes returned to the operator's review queue. The
   * only signal that a quote has re-entered a human's queue; without it a
   * reopen is indistinguishable from a quiet minute.
   */
  quotesFlaggedForReview: number;
  /**
   * Events consumed with NO ACTION AT ALL because their tenant has no
   * `sm8_connections` row. `consume-events.ts` calls this "the difference
   * between 'nothing to do' and 'nothing happened'" — a tenant row deleted
   * while its events remain discards work behind a green tick, and this is the
   * number that says so.
   */
  eventsSkipped: number;
  /**
   * Where the shared outbox cursor stands after the consume pass. Read
   * alongside `tenantsBlocked`: a cursor that does not move tick over tick is a
   * wedge, and 0 means the pass could not take a reading at all.
   */
  cursorAt: number;
  /**
   * Tenants whose consumption could not finish, holding the shared outbox
   * cursor where it stands. NON-ZERO MEANS THE OUTBOX IS NOT DRAINING — the one
   * counter that tells a wedged tick apart from a quiet one, since a wedge
   * otherwise reports every other number at zero.
   */
  tenantsBlocked: number;
  // ── THE ATTRIBUTION COUNTS (RPT-01, 07-03). ───────────────────────────────
  //
  // A SECOND CONSUMER ON THE SAME OUTBOX, with its own cursor row
  // (`'attribution'`) and its own head-of-line policy. The six fields are
  // prefixed rather than folded into the five above because the two consumers
  // advance INDEPENDENTLY: `cursorAt` and `attributionCursorAt` diverging is
  // the normal, healthy state — one of them is head-of-line blocked and the
  // other is still working — and a single shared count would hide exactly the
  // fact an operator is reading these numbers to find.
  //
  // Every one is 0 when the pass was not asked to run
  // (`RunCadenceTickOptions.attribution` defaults to `'skip'`), including the
  // cursor position: `NO_ATTRIBUTION.cursorAt` is the ABSENCE of a reading, not
  // a claim that the cursor sits at zero.
  /** Outbox events walked past by the attribution consumer, of every type. */
  attributionEventsConsumed: number;
  /** `quote_attributions` rows actually written. Replays return zero rows. */
  attributionsRecorded: number;
  /**
   * Wins with no qualifying touch in the D-01 window — jobs the tradie closed
   * himself. The healthy majority; a zero here would mean the predicate stopped
   * filtering, not that the service recovered everything.
   */
  attributionsUnqualified: number;
  /** Rows recorded with no dollar figure — the quote mirror was gone (Pitfall 8). */
  attributionsValueMissing: number;
  /**
   * Wins whose decision threw and were stepped over rather than retried forever.
   *
   * A COUNT OF BUGS, not of business outcomes. Non-zero means an event could not
   * be decided at all and was quarantined so the shared cursor could keep
   * moving; the 06:30 digest names it, because a number that appears only in a
   * cron log is not an operator signal.
   */
  attributionsPoisoned: number;
  /**
   * Where the ATTRIBUTION cursor stands. A POSITION, not a count — and still
   * just a number. 0 means no reading was taken (the pass was skipped).
   */
  attributionCursorAt: number;
  /** Tenants whose attribution run could not finish, holding that cursor. */
  attributionTenantsBlocked: number;
  /** D-12 — cadences that outlived their expiry from the anchor this tick. */
  cadencesExpired: number;
  /** D-09 — overdue touches moved to a new allowed slot. */
  touchesRewindowed: number;
  /** D-10/D-11/D-12 — overdue touches retired unsent, with a reason each. */
  touchesSkipped: number;
  /**
   * D-14 — touches moved `scheduled → needs_draft` this tick. NOTE the meaning
   * changed in Phase 5: this used to count touches promoted all the way to
   * `approved`. It now counts touches that reached the DRAFTING QUEUE, which is
   * the honest reading of "promoted" once the gates are real.
   */
  touchesPromoted: number;
  /** AI-01 — drafted, validated, recorded, and now awaiting a human. */
  touchesDrafted: number;
  /**
   * ── THE DRAFTING BREAKDOWN, SPLIT BY WHAT AN OPERATOR WOULD DO ABOUT IT ───
   *
   * 05-01 shipped one `draftsDeferred` lump because the tracer had one response
   * to every failure. It no longer does, and a counter that implies distinctions
   * the code does not make is exactly as bad as one that hides distinctions it
   * does. The split rule is not "one field per branch" — it is one field per
   * DIFFERENT THING TO DO, which is the same rule `refusals` follows.
   *
   * ONB-03 — no approved wording for the touch, or no voice profile at all.
   * The client is not finished being set up; nothing is wrong.
   */
  draftsNotOnboarded: number;
  /**
   * Two attempts, still not sendable — parked at `pending_approval` for
   * mandatory edit-then-approve. Go and write those ones by hand.
   */
  draftsValidatorFailed: number;
  /** 429 after the SDK's own retries. Look at volume, or at the plan. */
  draftsRateLimited: number;
  /**
   * Left exactly where it was because the cause was theirs (connection, 5xx,
   * 529) or unclassifiable. THE ONE PAIR DELIBERATELY LUMPED: both mean "wait,
   * the next tick retries", and an operator does the same thing about each.
   */
  draftsDeferred: number;
  /**
   * 400/401/403 — OURS, identical on every retry. Check the deploy and the key;
   * waiting fixes nothing. A number that is non-zero across every tenant at once
   * is a deploy bug, which is the reading this field exists to make possible.
   */
  draftsDeterministicFailed: number;
  /** Hit the attempt ceiling. Look at that specific touch (Pitfall 4). */
  draftsAttemptsExhausted: number;
  /**
   * TENANTS whose drafting could not run at all for want of an
   * `ANTHROPIC_API_KEY` — not touches. Set the key (D-10).
   *
   * A count of tenants rather than of work, because with no client the queue is
   * deliberately not read and there is no amount of work to report. It used to
   * be the number of touches promoted this minute, which in the steady state is
   * zero — making an unconfigured deployment look byte-identical to a quiet one.
   */
  draftingUnconfigured: number;
  dispatched: number;
  refused: number;
  /**
   * The same total, split by the rule that decided — counts only, one key per
   * member of the closed `DISPATCH_REFUSALS` vocabulary.
   *
   * CARRIED RATHER THAN COLLAPSED because the scalar cannot answer the one
   * question an operator asks about a quiet tick. `{ dispatched: 0, refused: 12 }`
   * is twelve paused tenants, or twelve suppressed customers, or twelve lost
   * claims, and those want three different responses — which is exactly the
   * shape `dispatch.ts` built the breakdown to replace.
   */
  refusals: Record<DispatchRefusal, number>;
  /** CAD-03 `all_touches_done` — cadences closed by the post-dispatch sweep. */
  cadencesCompleted: number;
  /**
   * Phase 13 (D-01, D-14) — open leads closed this tick by the reconciling
   * sweep because their lead cadence had ended: completed after touch 3
   * (`touches_exhausted`), expired, stopped by a STOP (`opt_out`) or by the
   * operator. Leads closed by the expiry pass or the dispatch lead branch are
   * closed inside those passes' own transactions and are not counted here.
   */
  leadsClosed: number;
  /**
   * Phase 13 (D-11) — open leads closed this tick by the label-effects pass,
   * on a HIGH-confidence closing label (`existing_job`, `complaint`,
   * `not_a_lead`, `already_sorted`, `spam`, `opt_out`). Separate from
   * `leadsClosed`, which counts the reconciling sweep's closes from an ended
   * cadence: one number is the model's judgement acting, the other is the
   * machine tidying up, and an operator asks about them for different reasons.
   */
  leadsClosedByLabel: number;
  /**
   * ── THE CLASSIFICATION COUNTS (AI-02, AI-03, plan 05-06) ──────────────────
   *
   * FOUR FIELDS, and they describe a pass that runs GLOBALLY rather than per
   * tenant — inbound replies are matched by phone number and a row may belong to
   * nobody at all, so there is no tenant to attribute these to. That is the same
   * reason `inbound_messages` lives outside `forTenant()`.
   *
   * Inbound replies that gained a label this tick, including the deterministic
   * empty-body path.
   */
  inboundClassified: number;
  /**
   * Of those, the ones labelled BELOW high confidence (D-15). The model's guess
   * is recorded; `is_hot` is not set and nothing acted on it. A subset of
   * `inboundClassified`, not a separate outcome — it answers "how much of this
   * minute's labelling still wants a person", which the total cannot.
   */
  inboundNeedsHuman: number;
  /**
   * Rows left unlabelled this tick, for any reason: a rate limit, an outage, an
   * unusable model answer, or a 400.
   *
   * THE ONE FIELD HERE DELIBERATELY LUMPED, and it is worth saying why, because
   * 05-04 split the drafting equivalent into five. The split rule is one field
   * per DIFFERENT THING TO DO — and every arm of this one has the same answer:
   * nothing. An unlabelled reply costs a triage row sorted by arrival instead of
   * by label, which is Phase 4's behaviour and is fine; `classify_attempts`
   * bounds the retry burn without anybody looking; and the deploy-level 400 an
   * operator WOULD act on already surfaces, loudly and per tenant, as
   * `draftsDeterministicFailed`. A number nobody would act on differently is a
   * number that should not have its own name.
   */
  inboundClassifyDeferred: number;
  /** No `ANTHROPIC_API_KEY`, so the pass did not run. `1` or `0` (D-10). */
  classificationUnconfigured: number;
  /**
   * ── THE ESCALATION COUNTS (CON-03, 06-05) ─────────────────────────────────
   *
   * SEVEN FIELDS, split by the 05-04 rule — one field per DIFFERENT THING TO DO
   * — and describing a pass that, like classification, runs GLOBALLY rather than
   * per tenant: a hot reply is found by scanning `inbound_messages`, which has
   * no tenant scope to run inside.
   *
   * An SMS reached a tradie about a customer who just said yes. THE NUMBER THE
   * WHOLE PHASE EXISTS FOR.
   */
  hotEscalated: number;
  /**
   * A second hot reply on a conversation already texted about within the
   * cooldown. Recorded as evidence, not dropped (D-08): Phase 7 computes reach
   * latency from these rows and cannot reconstruct a silence afterwards.
   * Nothing for an operator to do.
   */
  escalationCooldownSuppressed: number;
  /**
   * The client has no textable escalation mobile on file. THE FIX IS A PHONE
   * NUMBER SOMEBODY CAN GO AND ADD — which is why it is not lumped with the
   * next field, whose fix is a config row.
   */
  escalationNoNumber: number;
  /**
   * No enabled sms `messaging_config` row applies to that client, so the
   * deployment is disarmed for them (D-04). Zero provider calls were made. In
   * production today this is the EXPECTED value while the global row is
   * deliberately off; the fix is a row flip, not a deploy.
   */
  escalationNotConfigured: number;
  /** The provider refused it and said why. Look at that specific number. */
  escalationSendFailed: number;
  /**
   * Claimed, outcome unknown — our own code or the database threw. NOTHING
   * RETRIES IT, because the message may have left and a retry is how a tradie
   * is texted twice about one lead (the 03-01 send-ledger rule).
   */
  escalationDeferred: number;
  /**
   * `1` when no escalation sender was supplied, so the pass did not run and did
   * not scan. Its own field for the reason `classificationUnconfigured` is:
   * "nothing is wired" and "something threw" are read differently at 3am.
   */
  escalationUnconfigured: number;
  /**
   * ── THE QUOTE-CALL ESCALATION COUNTS (Phase 12, 12-05, D-16) ─────────────
   *
   * A quote customer rang and was missed: the tradie's phone was texted. One
   * per missed call, ever. Its "nothing wired" flag is
   * `escalationUnconfigured` — the same seam, so the same flag.
   */
  quoteCallEscalated: number;
  /** Claimed and recorded `cooldown_suppressed`: the tradie was told recently. */
  quoteCallEscalationSuppressed: number;
  /**
   * Claimed and refused with ZERO provider calls: no textable escalation phone
   * for that client, or no enabled SMS row applies to them.
   */
  quoteCallEscalationRefused: number;
  /**
   * The provider refused it, or the row threw (a claimed one is never
   * retried: the message may have left).
   */
  quoteCallEscalationFailed: number;
  /**
   * ── THE AFTER-HOURS HOLD AND RING-TWICE COUNTS (Phase 13, 13-06) ────────
   *
   * Hot LEAD replies claimed with `hold_until` this minute (D-09): outside the
   * client's window, switch off, neither emergency nor keyword. Not sent;
   * the release pass sends each once when the window opens.
   */
  escalationHeld: number;
  /** A second call inside the window (D-07): the tradie's phone was texted. */
  ringTwiceEscalated: number;
  /** A ring-twice claimed with `hold_until` (D-09): goes when the window opens. */
  ringTwiceHeld: number;
  /** A ring-twice claimed and recorded `cooldown_suppressed`. */
  ringTwiceSuppressed: number;
  /** A ring-twice claimed and refused with ZERO provider calls: no phone, or disarmed. */
  ringTwiceRefused: number;
  /** A ring-twice the provider refused, or that threw (a claimed one is never retried). */
  ringTwiceFailed: number;
  /** A held escalation released this minute and accepted by the provider. */
  escalationReleased: number;
  /**
   * Released and refused with ZERO provider calls: the lead closed during the
   * hold (`lead_closed`), no textable number, or the client was disarmed.
   */
  escalationReleaseRefused: number;
  /**
   * Released and then refused by the provider, or threw. A released row is
   * never revisited: the message may have left.
   */
  escalationReleaseFailed: number;
  /**
   * ── THE TEXT-BACK SWEEP COUNTS (Phase 12, D-01/D-20, TXT-02) ─────────────
   *
   * SIX FIELDS about the guarantee pass, which runs GLOBALLY (a pending call is
   * found by age, not by tenant). The sweep sends only calls NEVER CLAIMED;
   * a failed or unknown-outcome text-back is alerted, never re-sent.
   *
   * Pending calls handed to `sendTextBack` this tick, whatever became of them
   * — including the ones the status callback won (`claim_lost`).
   */
  textBackSwept: number;
  /** Of those, texted by the sweep. Non-zero means a callback was missed. */
  textBackSent: number;
  /** Of those, refused by the gate with a reason recorded on the call. */
  textBackSkipped: number;
  /**
   * Of those, not texted for a reason worth a look: the provider refused, the
   * outcome is unknown, or the pre-claim work failed (that row stays pending
   * and the next tick retries it). Refusals and unknowns reach the operator
   * through the alert pass as well.
   */
  textBackFailed: number;
  /** Calls past the ten-minute ceiling marked `skipped` / `stale` — never texted. */
  textBackStale: number;
  /**
   * `1` when no text-back sender was supplied, so the sweep did not scan. Its
   * own field for the reason `escalationUnconfigured` is: "nothing is wired"
   * and "nothing was pending" are read differently at 3am.
   */
  textBackUnconfigured: number;
  /**
   * ── THE TEXT-BACK ALERT COUNTS (Phase 12, D-10, TXT-06) ──────────────────
   *
   * Failed and stuck (claimed, no outcome after two minutes) text-backs
   * reported in an operator email that LEFT this tick. A row is claimed for
   * alerting once and never again, so these are never re-reported.
   */
  textBackAlerted: number;
  /**
   * `1` (or more) when an operator email about text-back was owed and did NOT
   * leave: the claim is not undone, so this number is the only record that an
   * alert was lost. "Check Resend" is the answer, as for `stallAlertFailed`.
   */
  textBackAlertFailed: number;
  /**
   * About-quote texts SENT to a quote customer who rang, whose quote cadence
   * could NOT be paused (12-05, D-08) — claimed for the operator email this
   * tick, each exactly once. Non-zero is a cadence to pause by hand.
   */
  textBackPauseFailed: number;
  /**
   * ── THE CLICKSEND BALANCE PROBE (Phase 12, D-07/D-10/D-21, TXT-06) ───────
   *
   * `1` when the balance was read (or tried) this tick: every fifteenth minute,
   * or at once after a text-back refused for want of credit — and only while
   * at least one client is armed for text-back.
   */
  balanceProbed: number;
  /**
   * `1` when the balance could NOT be read (credentials absent, HTTP failure,
   * timeout, an unparseable figure, not AUD). An unreadable balance never
   * disarms and never says "low"; it raises its own once-a-day email.
   */
  balanceProbeFailed: number;
  /** `1` when the once-a-day low-balance (below A$20) email left this tick. */
  balanceLowAlerted: number;
  /**
   * Clients whose text-back the SYSTEM switched off this tick because the
   * balance was below A$5 — each with an `actor = 'system'` audit row naming
   * the reason. Non-zero is a top-up-and-re-arm morning.
   */
  textBackAutoDisarmed: number;
  /**
   * ── THE AGING COUNTS (CON-04, 06-02) ──────────────────────────────────────
   *
   * THREE FIELDS, split by the 05-04 rule: one field per DIFFERENT THING TO DO.
   *
   * Touches that crossed the stall threshold THIS TICK and were claimed by the
   * guarded UPDATE. A number that is non-zero every minute means touches are
   * arriving at their threshold faster than the operator is clearing them,
   * which is a staffing fact rather than a bug.
   */
  touchesNewlyStalled: number;
  /** `1` when the covering email left, `0` when there was nothing to send. */
  stallAlertSent: number;
  /**
   * `1` when touches were claimed and the email did NOT leave.
   *
   * ITS OWN FIELD rather than folded into the one above, because it is the only
   * way a lost alert is visible at all: the claim is not undone and the touch is
   * never re-claimed (see `runAgingPass`), so this number is the record that an
   * operator was owed an email they did not get. The answer to a non-zero value
   * is "check Resend", which is a different action from every other count here.
   */
  stallAlertFailed: number;
}

/** What one tenant's progress pass achieved. Counts only, like everything here. */
interface ProgressCounts {
  cadencesExpired: number;
  touchesRewindowed: number;
  touchesSkipped: number;
  touchesPromoted: number;
  touchesDrafted: number;
  draftsNotOnboarded: number;
  draftsValidatorFailed: number;
  draftsRateLimited: number;
  draftsDeferred: number;
  draftsDeterministicFailed: number;
  draftsAttemptsExhausted: number;
  draftingUnconfigured: number;
}

const NO_PROGRESS: ProgressCounts = {
  cadencesExpired: 0,
  touchesRewindowed: 0,
  touchesSkipped: 0,
  touchesPromoted: 0,
  touchesDrafted: 0,
  draftsNotOnboarded: 0,
  draftsValidatorFailed: 0,
  draftsRateLimited: 0,
  draftsDeferred: 0,
  draftsDeterministicFailed: 0,
  draftsAttemptsExhausted: 0,
  draftingUnconfigured: 0,
};

/**
 * D-12 — end the cadences that have outlived their own schedule.
 *
 * BOTH `active` AND `paused` CADENCES EXPIRE. A quote does not stop going cold
 * because the client paused messaging, and a cadence resumed after six weeks
 * would find every one of its touches stale anyway — the difference is that
 * expiry says so in the record, with a reason, rather than leaving a live-looking
 * cadence that quietly never sends. (This is the `expired_deadline` at a pause
 * cell of the CAD-03 matrix, applied.)
 *
 * The expiry and the retirement of the unsent touches are ONE transaction: a
 * cadence marked `expired` whose touches still read `scheduled` is the state in
 * which an ended cadence keeps being claimable.
 */
async function expireOverdueCadences(
  tenantId: string,
  now: Date,
  kind: CadenceKind,
  expiryDays: number,
): Promise<{ expired: number; touchesSkipped: number; expiredIds: Set<string> }> {
  const repo = forTenant(tenantId);
  // ONE KIND PER CALL, WITH THAT KIND'S EXPIRY (Phase 13, D-15). A quote
  // cadence lives 42 days; a lead cadence 7 — never the quote's six weeks.
  const live = await repo.cadences.listLive(kind);

  const overdue = live.filter(
    (cadence) => now.getTime() - cadence.anchorAt.getTime() > expiryDays * MS_PER_DAY,
  );
  if (overdue.length === 0) {
    return { expired: 0, touchesSkipped: 0, expiredIds: new Set() };
  }

  return repo.transaction(async (tx) => {
    // RETURNING drives what happens next: only the cadences that ACTUALLY moved
    // to `expired` get their touches retired, so a concurrent stop that won the
    // race is not followed by a skip claiming expiry decided it.
    const rows = await tx.cadences.markExpired(overdue.map((cadence) => cadence.id));
    if (rows.length === 0) {
      return { expired: 0, touchesSkipped: 0, expiredIds: new Set<string>() };
    }

    const ids = rows.map((row) => row.id);
    const skipped = await tx.touches.skipUnsentForCadences(ids, 'cadence_expired');

    // D-15: an expired LEAD cadence expires its lead, IN THIS TRANSACTION, on
    // THIS HANDLE. `closeLeadInTx` is the transaction form; the wrapper would
    // open a second connection that waits on the rows this one just locked,
    // and the tick would hang for this tenant every minute (checker B1). The
    // cadence is already expired, so the core only closes the lead.
    if (kind === 'lead') {
      for (const row of rows) {
        if (row.leadId !== null) await closeLeadInTx(tx, row.leadId, 'expired', now);
      }
    }

    return { expired: rows.length, touchesSkipped: skipped.length, expiredIds: new Set(ids) };
  });
}

/**
 * D-09/D-10/D-11 — every unsent overdue touch of one cadence, judged and acted on.
 *
 * ── WALKED IN TOUCH-NUMBER ORDER, AGAINST THE SLOTS AS THEY STAND ───────────
 *
 * Each touch's `nextTouch` is the following unsent one AS IT IS RIGHT NOW, not
 * as this pass may be about to leave it. That produces exactly the behaviour
 * D-10 describes when several touches came due during one outage: touch 2's
 * candidate lands after touch 3's slot, which is a negative gap and therefore
 * "within" it, so touch 2 is retired as `min_gap` and touch 3 carries the
 * conversation. Only the LAST overdue touch of a cadence can be rescheduled, and
 * that falls out of the rule rather than being special-cased.
 *
 * ONE TRANSACTION PER CADENCE. A cadence's touches are one schedule; half-moved
 * is a shape neither the old plan nor the new one describes, and it is the shape
 * the customer would receive.
 */
async function rewindowCadence(
  tenantId: string,
  cadenceId: string,
  anchorAt: Date,
  tenant: CadenceTickTenant,
  now: Date,
  jitterMinutes: () => number,
  policy: CadencePolicy,
): Promise<{ rewindowed: number; skipped: number; expired: number }> {
  const win = contactWindowOf(tenant);
  const preferredSendTime = tenant.preferredSendTime ?? DEFAULT_PREFERRED_SEND_TIME;

  return forTenant(tenantId).transaction(async (tx) => {
    const unsent = await tx.touches.listUnsentForCadence(cadenceId);
    let rewindowed = 0;
    let skipped = 0;

    for (let i = 0; i < unsent.length; i += 1) {
      const touch = unsent[i];
      if (touch.scheduledAt.getTime() > now.getTime()) continue;

      const action = rewindowTouch({
        touch: { scheduledAt: touch.scheduledAt },
        nextTouch: unsent[i + 1] ? { scheduledAt: unsent[i + 1].scheduledAt } : null,
        cadenceAnchorAt: anchorAt,
        window: win,
        preferredSendTime,
        now,
        jitterMinutes,
        // The cadence kind's own gap, staleness cap and expiry (Phase 13, D-03).
        policy,
      });

      switch (action.kind) {
        case 'send_now':
          // The slot stands. Dispatch is what sends it, later in this tick.
          break;
        case 'reschedule':
          rewindowed += (await tx.touches.reschedule(touch.id, action.at)).length;
          break;
        case 'skip':
          skipped += (await tx.touches.skipWhere([touch.id], action.reason)).length;
          break;
        case 'expire_cadence': {
          // Unreachable from this caller: the sweep above already ended every
          // cadence past its expiry. HANDLED ANYWAY, and handled properly — the
          // policy is total, and a caller that reported one of its arms without
          // acting on it would be deciding by omission. Ending the cadence here
          // costs one guarded UPDATE and leaves no cadence that a second tick
          // would have to reach the same conclusion about.
          const ended = await tx.cadences.markExpired([cadenceId]);
          if (ended.length > 0) {
            skipped += (await tx.touches.skipUnsentForCadences([cadenceId], 'cadence_expired'))
              .length;
          }
          return { rewindowed, skipped, expired: ended.length };
        }
      }
    }

    return { rewindowed, skipped, expired: 0 };
  });
}

/**
 * The whole progress pass for every tenant that may currently be messaged.
 *
 * PER-TENANT ISOLATION, the rule `runSyncTick` set: one client's broken
 * configuration — an uninterpretable contact window, most likely — must not stop
 * the other fourteen from making progress. The caught value is deliberately not
 * logged: a driver error carries the statement, whose parameters are this
 * tenant's data.
 */
async function runProgressPass(
  now: Date,
  jitterMinutes: () => number,
  draftClient: DraftClient | null,
): Promise<ProgressCounts> {
  const totals: ProgressCounts = { ...NO_PROGRESS };

  for (const tenant of await forAllTenants_cadenceTick()) {
    if (tenant.connectionPausedAt !== null || tenant.settingsPausedAt !== null) continue;

    try {
      const repo = forTenant(tenant.tenantId);

      // (a) and (b), ONCE PER CADENCE KIND, each under its own policy (Phase
      // 13, D-03/D-04/D-15). Phase 12 ran both for quote cadences only and
      // left a lead's touches 2 and 3 inert (D-19). A lead's touches are one
      // day apart, so under the quote's 48-hour gap every slipped touch 2
      // would be retired `min_gap` and a lead would live six weeks; under
      // `LEAD_POLICY` it gets a 12-hour gap, a 24-hour staleness cap and a
      // 7-day life. The lead rewindow is also what moves a 02:00 fallback slot
      // into the window's morning (D-04); dispatch's `outside_window` refusal
      // is the second belt.
      for (const kind of CADENCE_KINDS) {
        const policy = policyFor(kind);

        // (a) D-12 / D-15 — for a lead, the expiry also closes the lead,
        // inside the expiry's own transaction.
        const expiry = await expireOverdueCadences(tenant.tenantId, now, kind, policy.expiryDays);
        totals.cadencesExpired += expiry.expired;
        totals.touchesSkipped += expiry.touchesSkipped;

        // (b) D-09/D-10/D-11, for the cadences still running. Paused cadences
        // are excluded here for the same reason paused TENANTS are excluded
        // from the whole pass: their repair belongs to the resume, not to
        // per-tick drift. (A paused LEAD cadence later resumed is repaired by
        // this loop within a minute, under the lead policy — the resume's own
        // gap-preserving rewindow is for quote cadences only, by design.)
        for (const cadence of await repo.cadences.listLive(kind)) {
          if (cadence.status !== 'active') continue;
          if (expiry.expiredIds.has(cadence.id)) continue;

          const moved = await rewindowCadence(
            tenant.tenantId,
            cadence.id,
            cadence.anchorAt,
            tenant,
            now,
            jitterMinutes,
            policy,
          );
          totals.touchesRewindowed += moved.rewindowed;
          totals.touchesSkipped += moved.skipped;
          totals.cadencesExpired += moved.expired;
        }
      }

      // (c) D-14, last: a touch surfaces to the drafting queue at the time it is
      // actually going out at, not at one this pass was about to change.
      //
      // BOTH KINDS, and the same `DRAFT_LEAD_HOURS` for both: D-03 names only
      // the gap, the staleness cap, the expiry and the offsets as per-kind. So
      // a lead's touch 2, one day after touch 1, is inside the 24-hour lead
      // time the moment the cadence exists — it is promoted and drafted within
      // the minute after the text-back and appears in the approval queue at
      // once, giving the operator the whole day to approve it.
      const promoted = await repo.touches.promoteDue(now, DRAFT_LEAD_HOURS * MS_PER_HOUR);
      totals.touchesPromoted += promoted.length;

      // (d) AI-01 — draft this tenant's drafting queue, in the same pass.
      //
      // THE PROMOTION `RETURNING` IS PASSED, NOT THE WHOLE JOB. `draftTouches`
      // reads the queue itself (`listNeedsDraft`, oldest first) and appends
      // these rows, de-duplicated — so a touch promoted by this tick is drafted
      // by this tick, AND a touch whose draft failed at 09:01 is picked up at
      // 09:02 instead of being abandoned. The tracer passed only these rows,
      // which visits each touch exactly once and then never again.
      //
      // Inside the same per-tenant try/catch: a drafting failure for one client
      // must not cost the other fourteen their progress pass. `draftTouches`
      // isolates per TOUCH internally, so reaching this catch means something
      // outside the per-touch loop failed.
      const drafts = await draftTouches({
        repo,
        tenant: {
          tenantId: tenant.tenantId,
          name: tenant.name,
          timezone: tenant.timezone,
        },
        touches: promoted,
        client: draftClient,
        now,
      });
      totals.touchesDrafted += drafts.drafted;
      // ONE MAPPING, WRITTEN OUT. The two ONB-03 counts collapse (both mean
      // "finish onboarding"), the two wait-and-retry counts collapse, and
      // nothing else does — see the field comments on CadenceTickResult.
      totals.draftsNotOnboarded += drafts.noApprovedTemplate + drafts.noVoiceProfile;
      totals.draftsValidatorFailed += drafts.validatorFailed;
      totals.draftsRateLimited += drafts.rateLimited;
      // `claimedElsewhere` joins the wait-and-retry bucket rather than getting a
      // field of its own: from the operator's side it is the same fact as an
      // outage-deferred touch — this tick did not draft it and something will.
      // The distinction that matters (an overlapping tick vs. a sick API) is one
      // for the drafting counts, not for the four numbers on the tick response.
      totals.draftsDeferred += drafts.apiDeferred + drafts.deferred + drafts.claimedElsewhere;
      totals.draftsDeterministicFailed += drafts.deterministicFailed;
      totals.draftsAttemptsExhausted += drafts.attemptsExhausted;
      totals.draftingUnconfigured += drafts.unconfigured;
    } catch {
      console.error(`[cadence] progress pass failed for tenant ${tenant.tenantId}.`);
    }
  }

  return totals;
}

/**
 * Pass 4 — close the cadences that have run their course (`all_touches_done`).
 *
 * ── WHY THIS IS A SWEEP AND NOT A CONSEQUENCE OF THE LAST SEND ──────────────
 *
 * The obvious alternative is for dispatch to check, after sending touch N,
 * whether N was the last one. It is wrong for two reasons. A cadence's final
 * touch is at least as often SKIPPED as sent — retired by the min-gap rule, by
 * staleness, by suppression — and those writes happen in three different
 * places, so the check would have to be repeated in all of them and would be
 * missing from the fourth one somebody adds later. And it would put a
 * cadence-wide read inside the claim transaction of a single touch, which is
 * the one place in this system that must stay narrow. A sweep asks the question
 * once, in the same statement that answers it.
 *
 * PER-TENANT ISOLATION, as everywhere else in this tick: one client's failure
 * must not close nobody's cadences. The caught value is deliberately not logged
 * — a driver error carries the statement, whose parameters are this tenant's
 * data.
 *
 * Runs for the same tenants as passes 2 and 3 (neither pause set). A paused
 * TENANT's finished cadences are swept the moment they resume; closing them
 * mid-pause would be a bookkeeping write against a client whose mandate is
 * currently withdrawn, and it buys nothing they can see.
 */
async function runCompletionSweep(): Promise<number> {
  let completed = 0;

  for (const tenant of await forAllTenants_cadenceTick()) {
    if (tenant.connectionPausedAt !== null || tenant.settingsPausedAt !== null) continue;

    try {
      const closed = await forTenant(tenant.tenantId).cadences.completeWhereAllTouchesDone();
      completed += closed.length;
    } catch {
      console.error(`[cadence] completion sweep failed for tenant ${tenant.tenantId}.`);
    }
  }

  return completed;
}

/**
 * Pass 4b — close the open leads whose lead cadence has ended (Phase 13,
 * D-01/D-14). See `closeLeadsWithEndedCadences`: a scan, not an edit in every
 * writer that can end a cadence.
 *
 * DIRECTLY AFTER THE COMPLETION SWEEP, so a lead whose touch 3 went this
 * minute — and whose cadence that sweep just completed — is closed
 * `touches_exhausted` this minute. Outside any transaction, so the sweep uses
 * the `closeLead` wrapper (one transaction per lead).
 *
 * For the same tenants as the completion sweep, and with the same per-tenant
 * isolation: the caught value is not logged, for the reason every catch in
 * this file gives.
 */
async function runLeadCloseSweep(now: Date): Promise<number> {
  let closed = 0;

  for (const tenant of await forAllTenants_cadenceTick()) {
    if (tenant.connectionPausedAt !== null || tenant.settingsPausedAt !== null) continue;

    try {
      closed += await closeLeadsWithEndedCadences(tenant.tenantId, now);
    } catch {
      console.error(`[cadence] lead close sweep failed for tenant ${tenant.tenantId}.`);
    }
  }

  return closed;
}

/**
 * Pass 5 — label the inbound replies that arrived since the last tick (AI-02).
 *
 * ── LAST, AND FOR EVERYONE ─────────────────────────────────────────────────
 *
 * LAST because a label is worth nothing to this tick: no pass above reads one,
 * nothing branches on one, and D-14 is explicit that a label triggers no state
 * transition. Putting it anywhere earlier would let a slow model call sit in
 * front of somebody's follow-up for no benefit at all.
 *
 * FOR EVERY TENANT — indeed for no tenant, since the scan is global. An inbound
 * reply arrives carrying a phone number and no client, and a row we could not
 * attribute has `tenant_id = NULL`; there is no scope from which to ask this
 * question. That makes it pass 1's shape rather than pass 2's: labels are
 * evidence, and a client whose messaging is paused still has replies worth
 * sorting for the human reading their inbox.
 *
 * ── AND IT CANNOT COST ANYONE THEIR SENDS (D-16) ───────────────────────────
 *
 * Its own try/catch, like every other pass, and it runs after dispatch has
 * already happened — so an Anthropic outage cannot delay a message, and it
 * certainly cannot delay a STOP, which the LLM-free webhook honoured minutes ago
 * without consulting anything in this file.
 *
 * The caught value is not logged, for the reason every catch in this file gives:
 * a driver error carries the statement, and this statement's parameters include
 * a customer's words.
 */
async function runClassificationPass(
  now: Date,
  client: ClassifyClient | null,
): Promise<ClassifyCounts> {
  try {
    return await classifyInbound({ client, now });
  } catch {
    console.error('[cadence] inbound classification failed this tick.');
    return { ...NO_CLASSIFICATIONS };
  }
}

/**
 * Pass 6 — tell each tradie whose customer just said yes (CON-03, D-05/D-08).
 *
 * ── IMMEDIATELY AFTER CLASSIFICATION, AND THE ORDER IS THE GUARANTEE ───────
 *
 * D-08 claims a hot reply reaches the tradie "within minutes". That is not a
 * latency budget somebody has to meet — it is TRUE STRUCTURALLY, because the
 * pass that sets `is_hot` and the pass that acts on it are the same tick, five
 * lines apart. A separate cron job would have made the same claim a promise.
 *
 * It runs BEFORE the aging pass because the aging pass sends the operator an
 * EMAIL about a queue, and this one tells a business owner their customer is
 * waiting on the phone. If one of them has to be behind a slow mail provider,
 * it is not this one.
 *
 * ── ITS OWN TRY/CATCH, LIKE EVERY PASS ─────────────────────────────────────
 *
 * `escalateHotLeads` already isolates per row (04-09); reaching this catch means
 * something outside that loop failed — the scan itself, most likely. The caught
 * value is not logged, for the reason every catch in this file gives: a driver
 * error carries the statement, and this statement's parameters include a
 * customer's words and their mobile number.
 */
/**
 * Pass 1b — turn `won` events into attribution rows (RPT-01, 07-03).
 *
 * ── WHERE IT SITS, AND WHY IT IS HERE RATHER THAN LAST ─────────────────────
 *
 * IMMEDIATELY AFTER THE CONSUME PASS AND BEFORE EVERYTHING ELSE, which is the
 * opposite of where a new pass usually goes. The placement rule this file
 * follows — "a pass that calls a third party goes behind every pass that
 * touches a customer" — does not bind here, because this pass makes NO external
 * call at all: it reads six tables and writes one, and every one of them is
 * inside the same Postgres.
 *
 * What decides the position is what it reads. Attribution keys on the OUTBOX
 * event, never on `cadences.stop_reason`, and it reads no column that
 * `runProgressPass`, dispatch, classification or escalation writes. So it is
 * independent of all four, and running it early means a win detected this
 * minute is billable this minute rather than after a slow mail provider has had
 * its say.
 *
 * ── ITS OWN TRY/CATCH, LIKE EVERY PASS ─────────────────────────────────────
 *
 * `consumeWonEvents` already isolates per tenant (a throwing run blocks that
 * tenant and holds the cursor); reaching this catch means something outside
 * that loop failed — the cursor registration or the cross-tenant scan. The
 * caught value is not logged, for the reason every catch in this file gives.
 *
 * ── `'skip'` IS NOT A TEST HOOK ────────────────────────────────────────────
 *
 * See `RunCadenceTickOptions.attribution`. On `'skip'` this returns
 * `NO_ATTRIBUTION` WITHOUT CALLING ANYTHING, so no cursor is registered, no
 * event is scanned and no claim is taken. That is what keeps a remote suite —
 * or a script somebody runs on a laptop — from attributing fifteen real
 * clients' won history to rows nothing in this codebase can delete.
 */
async function runAttributionPass(
  mode: 'run' | 'skip',
  batchLimit: number | undefined,
): Promise<ConsumeWonEventsResult> {
  if (mode === 'skip') return { ...NO_ATTRIBUTION };

  try {
    return await consumeWonEvents({ batchLimit });
  } catch {
    console.error('[cadence] attribution consumption failed this tick; proceeding.');
    return { ...NO_ATTRIBUTION };
  }
}

/**
 * Pass 5b — what a lead reply's label does to its lead (Phase 13, D-11). See
 * `applyLeadLabelEffects`: a separate pass, because the classifier may write
 * a label and nothing else (D-13).
 *
 * ── BETWEEN CLASSIFICATION AND ESCALATION, AND THE ORDER IS THE POINT ──────
 *
 * AFTER classification, so a label written this minute acts this minute.
 * BEFORE escalation, so the lead's state is settled before the tradie's phone
 * rings about the same reply. A high-confidence `complaint` or `existing_job`
 * is BOTH hot (D-07 — the tradie hears it) and closing (D-11 — the follow-ups
 * stop): by the time the escalation goes, the lead is closed, its cadence
 * stopped and its unsent touches skipped, so the tradie is never told about a
 * caller whose automated follow-up is still due. The escalation pass reads
 * `is_hot OR keyword_hot` and does not itself filter on lead state — closing
 * a lead never cancels the tradie hearing about it. Its own try/catch, like
 * every pass; the caught value is not logged.
 */
async function runLeadLabelEffectsPass(now: Date): Promise<number> {
  try {
    return (await applyLeadLabelEffects(now)).leadsClosed;
  } catch {
    console.error('[cadence] lead label effects failed this tick.');
    return 0;
  }
}

async function runEscalationPass(
  now: Date,
  sender: EscalationSmsSender | undefined,
): Promise<EscalationCounts> {
  try {
    return await escalateHotLeads({ sender, now });
  } catch {
    console.error('[cadence] hot-lead escalation failed this tick.');
    return { ...NO_ESCALATIONS };
  }
}

/**
 * The quote-call escalation pass (Phase 12, 12-05, D-16) — see
 * `src/core/escalation/quote-call.ts`. On the SAME `escalationSender` seam as
 * the hot-lead pass, so undefined means it neither scans nor claims. Its own
 * try/catch, like every pass; the caught value is not logged.
 */
async function runQuoteCallEscalationPass(
  now: Date,
  sender: EscalationSmsSender | undefined,
): Promise<QuoteCallEscalationCounts> {
  try {
    return await escalateQuoteCalls({ sender, now });
  } catch {
    console.error('[cadence] quote-call escalation failed this tick.');
    return { ...NO_QUOTE_CALL_ESCALATIONS, unconfigured: sender === undefined ? 1 : 0 };
  }
}

/**
 * The ring-twice escalation pass (Phase 13, 13-06, D-07) — see
 * `src/core/escalation/ring-twice.ts`. Same seam, same per-pass catch, the
 * caught value not logged.
 */
async function runRingTwiceEscalationPass(
  now: Date,
  sender: EscalationSmsSender | undefined,
): Promise<RingTwiceEscalationCounts> {
  try {
    return await escalateRingTwiceCalls({ sender, now });
  } catch {
    console.error('[cadence] ring-twice escalation failed this tick.');
    return { ...NO_RING_TWICE_ESCALATIONS, unconfigured: sender === undefined ? 1 : 0 };
  }
}

/**
 * The held-escalation release pass (Phase 13, 13-06, D-09) — see
 * `src/core/escalation/release-held.ts`. LAST of the escalation passes, so a
 * hold claimed earlier in this tick is never released in the same minute
 * unless its window really is open. Same seam, same per-pass catch.
 */
async function runReleaseHeldEscalationsPass(
  now: Date,
  sender: EscalationSmsSender | undefined,
): Promise<ReleaseHeldCounts> {
  try {
    return await releaseHeldEscalations({ sender, now });
  } catch {
    console.error('[cadence] held-escalation release failed this tick.');
    return { ...NO_RELEASES, unconfigured: sender === undefined ? 1 : 0 };
  }
}

/**
 * The text-back guarantee sweep (Phase 12, D-01/D-20) — see
 * `src/core/leads/sweep.ts`. Its own try/catch, like every pass: the sweep
 * never throws by contract, and this is what keeps that contract from being
 * the only thing standing between a bug there and every later pass. The
 * caught value is not logged, for the reason every catch in this file gives.
 */
async function runTextBackSweepPass(
  now: Date,
  sender: TouchSender | undefined,
): Promise<TextBackSweepCounts> {
  try {
    return await runTextBackSweep({ now, sender });
  } catch {
    console.error('[cadence] text-back sweep failed this tick.');
    return { ...NO_TEXT_BACK_SWEEP, unconfigured: sender === undefined ? 1 : 0 };
  }
}

/**
 * The failed / stuck text-back alert pass (Phase 12, D-10) — see
 * `runTextBackAlertPass`, which splits its own try at the claim the way
 * `runAgingPass` below does. This wrapper is the backstop for the pass's own
 * contract; with no ops seam it claims nothing at all.
 */
async function runTextBackAlertWrapper(
  now: Date,
  ops: RunCadenceTickOptions['textBackOps'],
): Promise<TextBackAlertCounts> {
  if (ops === undefined) return { ...NO_TEXT_BACK_ALERTS };
  try {
    return await runTextBackAlertPass({ now, sendEmail: ops.alertSender });
  } catch {
    console.error('[cadence] text-back alert pass failed this tick.');
    return { ...NO_TEXT_BACK_ALERTS };
  }
}

/**
 * The ClickSend balance probe (Phase 12, D-10) — see
 * `src/core/leads/balance.ts`. With no ops seam it does not run: it can latch
 * today's operator alert and disarm every armed client, and neither may be
 * spent by a script or a remote suite. `force` is the alert pass having seen a
 * text-back refused for want of credit.
 */
async function runBalanceProbePass(
  now: Date,
  ops: RunCadenceTickOptions['textBackOps'],
  force: boolean,
): Promise<BalanceProbeCounts> {
  if (ops === undefined) return { ...NO_BALANCE_PROBE };
  try {
    return await runBalanceProbe({
      now,
      force,
      clicksend: ops.clicksend,
      fetchImpl: ops.fetchImpl,
      sendEmail: ops.alertSender,
    });
  } catch {
    console.error('[cadence] balance probe failed this tick.');
    return { ...NO_BALANCE_PROBE };
  }
}

/**
 * Pass 7 — tell the operator about the touches that are about to miss their
 * slot (CON-04, D-09/D-10/D-11).
 *
 * ── AFTER CLASSIFICATION, AND THE PLACEMENT IS THE ARGUMENT ────────────────
 *
 * LAST, for the same reason classification is second-last: nothing above reads
 * `stall_alerted_at`, nothing branches on it, and this pass sends an EMAIL. A
 * mail provider having a slow afternoon must never stand in front of somebody's
 * follow-up. It also means the pass sees the state the tick has already
 * produced — a touch drafted thirty lines ago is `pending_approval` now, and
 * alerting on it is correct.
 *
 * ── THE CLAIM IS THE ALERT DECISION, AND IT HAPPENS FIRST ──────────────────
 *
 * The guarded UPDATE flips `stall_alerted_at` and RETURNS only the rows it
 * actually moved. That statement — not this function, and not the tick — is
 * what makes "one alert per touch per threshold crossing" true, so a second tick
 * racing the first returns nothing and sends nothing.
 *
 * ── AND THE EMAIL IS NOT RETRIED (D-11) ────────────────────────────────────
 *
 * If the send fails, the claim has already happened and the touch will never be
 * claimed again. That is deliberate rather than a gap: the persistent signal is
 * the queue's own count badge, which the operator sees on every page of the
 * console, and the 06:30 digest lists everything still stalled REGARDLESS of
 * alert state — so a lost email costs a few hours of latency at worst. The
 * alternative, un-claiming on failure, converts a mail outage into an alert
 * storm at the exact moment the operator can least afford one, which is the
 * trained-blindness failure this whole mechanism exists to avoid.
 *
 * `stallAlertFailed` is how a lost email is still visible, in the one place a
 * number can be: the tick's own response.
 *
 * ── SO THE TRY IS SPLIT AT THE CLAIM, AND THAT IS THE POINT (WR-07) ─────────
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE `try` AROUND BOTH HALVES MADE THE PARAGRAPH ABOVE FALSE. The claim   │
 * │ COMMITS `stall_alerted_at`. If anything after it threw — the tally's     │
 * │ `tenants` read, `queueUrl()` reaching `getServerEnv()`, or a `send` that │
 * │ throws rather than returning `{ ok: false }` — the single catch reported │
 * │ `{ 0, 0, 0 }`. Those touches were then claimed FOREVER (the guard is     │
 * │ `stall_alerted_at IS NULL`), never alerted about again, and the tick's   │
 * │ response said nothing had happened. The one number that exists to make a │
 * │ lost alert visible was the number the failure erased.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The outer `try` still covers the CLAIM itself — a claim that throws wrote
 * nothing, so `{ 0, 0, 0 }` is the truth there. Everything after it is a second
 * `try` that reports the claim it cannot undo.
 */
async function runAgingPass(
  now: Date,
  send: StalledEmailSender,
): Promise<{ touchesNewlyStalled: number; stallAlertSent: number; stallAlertFailed: number }> {
  let claim: Awaited<ReturnType<typeof forAllTenants_claimNewlyStalled>>;
  try {
    claim = await forAllTenants_claimNewlyStalled({
      boundary: stallBoundary(now),
      at: now,
    });
  } catch {
    // The caught value is not logged, for the reason every catch in this file
    // gives: a driver error carries the statement, and this statement's
    // parameters are tenants' data.
    //
    // NOTHING WAS CLAIMED, so zero is honest here and only here: the guarded
    // UPDATE either returned rows or it did not run.
    console.error('[cadence] stalled-touch claim failed this tick.');
    return { touchesNewlyStalled: 0, stallAlertSent: 0, stallAlertFailed: 0 };
  }

  const { claimed, perTenant } = claim;
  if (claimed.length === 0) {
    return { touchesNewlyStalled: 0, stallAlertSent: 0, stallAlertFailed: 0 };
  }

  // ── PAST THIS LINE THE CLAIM IS COMMITTED AND CANNOT BE TAKEN BACK. ──────
  try {
    // ONE email covering every newly-stalled client, not one per client.
    // Fifteen emails a minute is the shape D-11 forbids by name.
    const outcome = await send(
      buildStalledAlert({ perTenantCounts: perTenant, at: now, queueUrl: queueUrl() }),
    );

    return {
      touchesNewlyStalled: claimed.length,
      stallAlertSent: outcome.ok ? 1 : 0,
      stallAlertFailed: outcome.ok ? 0 : 1,
    };
  } catch {
    // A THROW HERE IS A LOST ALERT, and it is reported as exactly that — the
    // same shape a `{ ok: false }` send produces, because from the operator's
    // side they are the same event. The claim is still reported, because it
    // still happened.
    console.error('[cadence] stall alert send failed after the claim.');
    return { touchesNewlyStalled: claimed.length, stallAlertSent: 0, stallAlertFailed: 1 };
  }
}

export async function runCadenceTick(
  options: RunCadenceTickOptions = {},
): Promise<CadenceTickResult> {
  const {
    now = new Date(),
    jitterMinutes = randomJitterMinutes,
    sender = new StubSender(),
    batchLimit,
    stallAlertSender = noopStalledEmailSender,
    // NO DEFAULT, and that is the decision: undefined means the escalation pass
    // does not scan at all. See `RunCadenceTickOptions.escalationSender`.
    escalationSender,
    // DEFAULTS TO `'skip'`, and the default is what stops a script or a remote
    // suite draining real clients' won history into `quote_attributions`. The
    // route is the only caller that passes `'run'`. See
    // `RunCadenceTickOptions.attribution`.
    attribution = 'skip',
    // NO DEFAULT: undefined means the text-back sweep does not scan at all.
    // See `RunCadenceTickOptions.textBackSender`.
    textBackSender,
    // NO DEFAULT: undefined means neither the text-back alert pass nor the
    // balance probe runs. See `RunCadenceTickOptions.textBackOps`.
    textBackOps,
  } = options;

  // NOT a destructuring default: `null` is a meaningful value here (see
  // RunCadenceTickOptions.draftClient), and a default would silently replace an
  // explicit "there is no client" with a real one built from the environment.
  const draftClient =
    options.draftClient === undefined ? buildAnthropicClient() : options.draftClient;

  // Same sentinel, same reason, and a SEPARATE client because the two workloads
  // carry different timeout budgets.
  const classifyClient =
    options.classifyClient === undefined ? buildClassifyClient() : options.classifyClient;

  // THE CONSUME PASS MUST NEVER BE ABLE TO COST ANYONE THEIR SENDS. Passes 2, 3
  // and 4 each isolate their per-tenant work for the reason spelled out above
  // `runProgressPass`, and the pass that runs FIRST needs that guarantee most:
  // a throw here would take dispatch down for every tenant, and a deterministic
  // one would do it every minute forever, because the cursor can never advance
  // past the event that threw. Consumption failing costs stops arriving a tick
  // late; consumption failing LOUDLY AND FATALLY costs everyone their follow-ups.
  //
  // The caught value is not logged, for the reason every other catch in this
  // file gives: a driver error carries the statement, and the statement's
  // parameters are a tenant's data.
  let consumed = NO_CONSUMPTION;
  try {
    consumed = await consumeQuoteEvents({ jitterMinutes, batchLimit });
  } catch {
    console.error('[cadence] event consumption failed this tick; proceeding to dispatch.');
  }

  // RIGHT HERE, ON PURPOSE — see `runAttributionPass`. The second consumer walks
  // the same outbox on its own cursor: it reads nothing the passes below write,
  // makes no external call, and a win detected this minute becomes billable this
  // minute rather than behind a mail provider. `'skip'` (the default) returns
  // without registering, scanning or advancing anything.
  const attributions = await runAttributionPass(attribution, batchLimit);

  const progress = await runProgressPass(now, jitterMinutes, draftClient);
  const dispatch = await dispatchDueTouches({ sender, now });
  // RIGHT BEHIND DISPATCH, ON PURPOSE. The sweep texts a member of the public
  // who rang a tradie under ten minutes ago, so it belongs with the pass that
  // touches customers — ahead of the completion sweep, the model call and every
  // pass that sends mail, none of which it reads or is read by. A slow model
  // or mail provider must never stand between a missed call and its text.
  //
  // ITS OWN CLOCK, READ HERE (12-REVIEW WR-01). The drafting and dispatch
  // passes above can run for minutes, and the sweep's every bound — the
  // 45 s – 10 min window, the stale mark and the gate's `stale` rule inside
  // `sendTextBack` — is derived from the clock it is handed. Handing it the
  // tick's START clock would text a call that is really 12 minutes old after a
  // three-minute drafting pass, and D-20's ceiling would hold only
  // approximately. An injected `now` (the pinned suites) is still the sweep's
  // clock, so the window stays pinnable; only the real clock is re-read.
  const sweepNow = options.now ?? new Date();
  const textBackSweep = await runTextBackSweepPass(sweepNow, textBackSender);
  const cadencesCompleted = await runCompletionSweep();
  // RIGHT BEHIND IT (Phase 13): a lead cadence the sweep just completed closes
  // its lead in the same minute. See `runLeadCloseSweep`.
  const leadsClosed = await runLeadCloseSweep(now);
  // LAST. See `runClassificationPass` — nothing above reads a label, so a model
  // call must never stand in front of a send.
  const classification = await runClassificationPass(now, classifyClient);
  // BETWEEN THE TWO (Phase 13, D-11): a label written this minute closes its
  // lead this minute, before the escalation pass rings the tradie about the
  // same reply. See `runLeadLabelEffectsPass`.
  const leadsClosedByLabel = await runLeadLabelEffectsPass(now);
  // IMMEDIATELY AFTER, in the SAME TICK that set `is_hot` — which is what makes
  // D-08's "within minutes" structural rather than a promise. See
  // `runEscalationPass`.
  const escalation = await runEscalationPass(now, escalationSender);
  // DIRECTLY AFTER, on the same seam: a quote customer who rang and was missed
  // reaches the tradie's phone in the same minute (D-16).
  const quoteCallEscalation = await runQuoteCallEscalationPass(now, escalationSender);
  // THEN RING-TWICE (Phase 13, D-07), on the same seam: a caller with an open
  // lead who rang again inside 30 minutes reaches the tradie this minute — or
  // is held for the window like any non-emergency trigger (D-09).
  const ringTwice = await runRingTwiceEscalationPass(now, escalationSender);
  // AND THEN THE RELEASE (D-09): every held escalation whose window has
  // opened, sent once. After every pass that can hold, so the order of a tick
  // is hold-then-release and never the reverse.
  const released = await runReleaseHeldEscalationsPass(now, escalationSender);
  // BEHIND EVERYTHING THAT TOUCHES A CUSTOMER, because it sends mail — and
  // after the sweep, so a text-back the sweep saw refused THIS minute is
  // reported THIS minute rather than the next.
  const textBackAlerts = await runTextBackAlertWrapper(now, textBackOps);
  // THEN THE BALANCE, behind the same seam: every fifteenth minute, or AT ONCE
  // when the alert pass just saw a text-back refused for want of credit — the
  // one failure that means every later text-back will fail the same way.
  const balance = await runBalanceProbePass(
    now,
    textBackOps,
    textBackAlerts.insufficientCreditSeen === 1,
  );
  // AND THEN THE ALARM. See `runAgingPass`: nothing above reads
  // `stall_alerted_at`, and this pass sends mail, so it goes behind everything
  // that touches a customer.
  const aging = await runAgingPass(now, stallAlertSender);

  return {
    eventsConsumed: consumed.eventsConsumed,
    cadencesCreated: consumed.cadencesCreated,
    cadencesStopped: consumed.cadencesStopped,
    quotesFlaggedForReview: consumed.quotesFlaggedForReview,
    eventsSkipped: consumed.eventsSkipped,
    cursorAt: consumed.cursorAt,
    tenantsBlocked: consumed.tenantsBlocked,
    // ── THE ATTRIBUTION COUNTS (RPT-01, 07-03). ──
    //
    // Enumerated one by one like everything else here. NO SPREAD, and the
    // reason is sharper for this pass than for any other: `ConsumeWonEventsResult`
    // describes work over a client's job descriptions, their customer's reply
    // labels and a DOLLAR FIGURE. A field added there later — a blocked
    // tenant's id, a quote that would not price — must not ride a
    // `...attributions` into `cron.job_run_details` and the Vercel log, which
    // are lower-trust than the database and which nobody can delete a row out
    // of. Seven numbers, and they are numbers about the outbox rather than about
    // anyone.
    attributionEventsConsumed: attributions.eventsConsumed,
    attributionsRecorded: attributions.attributionsRecorded,
    attributionsUnqualified: attributions.attributionsUnqualified,
    attributionsValueMissing: attributions.attributionsValueMissing,
    attributionsPoisoned: attributions.attributionsPoisoned,
    // A POSITION, not a count — the same distinction `cursorAt` carries, for
    // the OTHER consumer's cursor. The two diverging is normal.
    attributionCursorAt: attributions.cursorAt,
    attributionTenantsBlocked: attributions.tenantsBlocked,
    cadencesExpired: progress.cadencesExpired,
    touchesRewindowed: progress.touchesRewindowed,
    touchesSkipped: progress.touchesSkipped,
    touchesPromoted: progress.touchesPromoted,
    touchesDrafted: progress.touchesDrafted,
    draftsNotOnboarded: progress.draftsNotOnboarded,
    draftsValidatorFailed: progress.draftsValidatorFailed,
    draftsRateLimited: progress.draftsRateLimited,
    draftsDeferred: progress.draftsDeferred,
    draftsDeterministicFailed: progress.draftsDeterministicFailed,
    draftsAttemptsExhausted: progress.draftsAttemptsExhausted,
    draftingUnconfigured: progress.draftingUnconfigured,
    dispatched: dispatch.dispatched,
    refused: dispatch.refused,
    refusals: dispatch.refusals,
    cadencesCompleted,
    leadsClosed,
    leadsClosedByLabel,
    inboundClassified: classification.classified,
    inboundNeedsHuman: classification.needsHuman,
    // ONE MAPPING, WRITTEN OUT — the three "left unlabelled" arms collapse into
    // the single field an operator would do nothing different about. See the
    // field comment on `CadenceTickResult.inboundClassifyDeferred`.
    inboundClassifyDeferred:
      classification.deferred +
      classification.unparseable +
      classification.deterministicFailed,
    classificationUnconfigured: classification.unconfigured,
    // CON-03 / 06-05, enumerated one by one like everything above. NO SPREAD:
    // these describe a pass that reads a customer's reply and their mobile, and
    // a field added to `EscalationCounts` later must not ride into
    // `cron.job_run_details` and the Vercel log on a `...escalation`.
    hotEscalated: escalation.hotEscalated,
    escalationCooldownSuppressed: escalation.cooldownSuppressed,
    escalationNoNumber: escalation.noNumber,
    escalationNotConfigured: escalation.notConfigured,
    escalationSendFailed: escalation.sendFailed,
    escalationDeferred: escalation.deferred,
    escalationUnconfigured: escalation.unconfigured,
    // Phase 12 / 12-05 (D-16), enumerated one by one: a pass that reads a
    // customer's number must not spread its counts into the job log.
    quoteCallEscalated: quoteCallEscalation.escalated,
    quoteCallEscalationSuppressed: quoteCallEscalation.cooldownSuppressed,
    quoteCallEscalationRefused: quoteCallEscalation.refused,
    quoteCallEscalationFailed: quoteCallEscalation.sendFailed,
    // Phase 13 / 13-06 (D-07, D-09), enumerated one by one: the hold, the
    // ring-twice and the release. NO SPREAD — these passes read a reply's
    // words and a caller's number, and a field added to their counts later
    // must not ride into `cron.job_run_details`.
    escalationHeld: escalation.held,
    ringTwiceEscalated: ringTwice.escalated,
    ringTwiceHeld: ringTwice.held,
    ringTwiceSuppressed: ringTwice.cooldownSuppressed,
    ringTwiceRefused: ringTwice.refused,
    ringTwiceFailed: ringTwice.sendFailed,
    escalationReleased: released.released,
    escalationReleaseRefused: released.refused,
    escalationReleaseFailed: released.sendFailed,
    // Phase 12 / TXT-02 — the text-back sweep, enumerated one by one. NO
    // SPREAD: this pass handles a caller's number, and a field added to
    // `TextBackSweepCounts` later must not ride into `cron.job_run_details`.
    textBackSwept: textBackSweep.swept,
    textBackSent: textBackSweep.sent,
    textBackSkipped: textBackSweep.skipped,
    textBackFailed: textBackSweep.failed,
    textBackStale: textBackSweep.stale,
    textBackUnconfigured: textBackSweep.unconfigured,
    textBackAlerted: textBackAlerts.alerted,
    // EVERY lost text-back operator email: the failure alert's, and any
    // balance email whose once-a-day claim was spent without the mail leaving.
    textBackAlertFailed: textBackAlerts.alertFailed + balance.emailFailed,
    textBackPauseFailed: textBackAlerts.pauseFailed,
    balanceProbed: balance.probed,
    balanceProbeFailed: balance.probeFailed,
    balanceLowAlerted: balance.lowAlerted,
    textBackAutoDisarmed: balance.autoDisarmed,
    touchesNewlyStalled: aging.touchesNewlyStalled,
    stallAlertSent: aging.stallAlertSent,
    stallAlertFailed: aging.stallAlertFailed,
  };
}
