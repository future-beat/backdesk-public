/**
 * The text-back's own timing and bookkeeping constants (Phase 12), and the lead
 * cadence's policy numbers (Phase 13).
 *
 * NOT commercial assumptions: the founder's three limits (the daily cap and the
 * two balance floors, D-07) live beside the other commercial assumptions in
 * `src/core/audit/constants.ts` and are recorded in
 * `docs/commercial-assumptions.md`. These are mechanism — how long to wait, how
 * old is too old, which touch number is reserved — and each says why.
 *
 * The Phase 13 lead numbers below (`LEAD_MIN_GAP_HOURS`,
 * `LEAD_STALENESS_CAP_HOURS`, `LEAD_EXPIRY_DAYS`, `LEAD_NEGATIVE_COOL_OFF_DAYS`,
 * `RING_TWICE_WINDOW_MINUTES`, `URGENT_KEYWORDS`) are recorded, with their
 * reasoning and the pin to edit, in `docs/commercial-assumptions.md` §11–§15
 * (13-05), so the founder can find and change them in one place.
 *
 * The Phase 14 numbers (`LEAD_JOB_MATCH_WINDOW_DAYS`, `DONE_LOOKBACK_HOURS`,
 * `LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE`) are recorded the same way in
 * `docs/commercial-assumptions.md` §16–§17 (plan 14-04), and
 * `LEAD_JOB_CLAIM_STALE_MINUTES` in §18 (plan 14-03). The pass's read budget
 * (`LEAD_JOB_MATCH_READ_TIMEOUT_MS`, `LEAD_JOB_MATCH_PASS_MARGIN_MS`,
 * 14-REVIEW WR-06) is noted beside the cap in §16.
 *
 * The Phase 15 numbers (`LEAD_RECENT_CONVERSION_HOURS`,
 * `PSEUDONYMISE_AFTER_DAYS`, `PSEUDONYMISE_BATCH`) are recorded the same way
 * in `docs/commercial-assumptions.md` §19–§20 (plan 15-07);
 * `PSEUDONYMISE_CONVERTED_MAX_DAYS` in §21 (15-REVIEW WR-02).
 *
 * No imports, so the pure gate, the send path, the sweep and the tests can all
 * read the same values.
 */

/**
 * Day offsets of a lead cadence's three touches, from the moment the text-back
 * is decided (D-04).
 *
 * `[0, 1, 2]` is Phase 13 D-01's "one instant text plus two follow-ups":
 * touch 1 is the text-back itself, sent at once (offset 0, and exempt from
 * contact hours: the caller rang seconds ago); touch 2 is a nudge on the
 * anchor's calendar date + 1 and touch 3 the last word on date + 2, each at
 * the client's preferred send time inside their contact window. Touches 2 and
 * 3 are CREATED with the text-back so the cadence has its whole shape from day
 * one. Phase 12 kept them inert behind `kind = 'quote'` predicates (D-19);
 * they become live under the LEAD policy (`LEAD_MIN_GAP_HOURS`,
 * `LEAD_STALENESS_CAP_HOURS`, `LEAD_EXPIRY_DAYS` below) when plan 13-02 wires
 * the per-kind policy and the lead follow-up branch — never under the quote's
 * 48-hour gap, which would retire every touch 2 that slipped.
 */
export const LEAD_TOUCH_OFFSET_DAYS = [0, 1, 2] as const;

/**
 * How long after a call ends the tick sweep leaves a text-back to the
 * synchronous path (D-20), in seconds.
 *
 * The status callback arrives about 12 seconds after the divert (measured in
 * 11-07) and sends at once; 45 seconds is the margin that lets that path win
 * every ordinary race, so the sweep only picks up a call whose callback never
 * arrived or whose pre-claim reads timed out. The claim arbiter makes a lost
 * race harmless either way — this only decides who usually does the work.
 */
export const TEXT_BACK_GRACE_SECONDS = 45;

/**
 * The oldest call that may still be texted, in minutes (D-20).
 *
 * Measured from `coalesce(ended_at, started_at)`. Ten minutes covers a missed
 * callback plus a few skipped ticks; beyond it a text stops reading as "sorry
 * we missed your call" and starts reading as a stranger's automated message.
 * The nightly call-log reconcile can insert a call HOURS late, and this is what
 * stops that row producing a text at 03:30. Exactly ten minutes old is still
 * sendable (at-the-boundary-is-inside); one millisecond more is `stale`.
 */
export const TEXT_BACK_MAX_AGE_MINUTES = 10;

/**
 * The rolling window, in hours, of the one-text-per-caller rule and the daily
 * cap (D-06/D-07). A rolling window, never a calendar day: no tenant-zone
 * midnight resets either rule (docs/commercial-assumptions.md §8).
 */
export const TEXT_BACK_RATE_WINDOW_HOURS = 24;

/**
 * The reserved touch number of the "about your quote" text on a QUOTE cadence
 * (D-08/D-17).
 *
 * Zero, so it can never collide with the quote's own touches 1–5 on the
 * ledger's never-twice key `(cadence_id, touch_number)` — which also makes it
 * once per quote cadence, ever. Attribution's qualifying-touch rule excludes
 * it: an automatic reply to the customer's own phone call must never claim
 * recovered revenue by itself.
 */
export const ABOUT_QUOTE_TOUCH_NUMBER = 0;

/**
 * The budget for everything `sendTextBack` does BEFORE its claim, in
 * milliseconds (D-01, Pattern 3).
 *
 * Twilio gives a status callback 15 seconds in total. The pre-claim reads (the
 * row, the arming switch, the SMS identity) are small indexed reads; six
 * seconds is the arrival door's own budget for the same database. If they have
 * not answered by then nothing has been written, the row stays undecided, and
 * the tick sweep sends it within the minute — so timing out is always safe.
 * After the claim commits, nothing is ever aborted.
 */
export const TEXT_BACK_PRE_CLAIM_DEADLINE_MS = 6000;

/**
 * `touch_drafts.model` for a text-back (D-02). Not a model: the text-back has
 * no LLM in its path, and the draft row exists only because `touch_drafts` is
 * the one stored copy of what a customer was sent (the ledger has no body
 * column). The value says so to anyone reading the evidence.
 */
export const TEXT_BACK_DRAFT_MODEL = 'template';

/**
 * `touch_drafts.prompt_version` for a text-back. Versions the TEMPLATE PATH
 * (attested bytes, sent verbatim), so a later change to how text-backs are
 * composed is distinguishable in the evidence from rows written before it.
 */
export const TEXT_BACK_PROMPT_VERSION = 'text-back-template-1';

/**
 * How far back, in hours, the operator alert pass looks for an ARMED client's
 * configuration skips — `no_template` (the attested wording no longer
 * validates) and `sms_not_armed` (12-REVIEW WR-02).
 *
 * Measured from the call's `started_at`. A day is every call since this
 * client's last configuration email could have gone out; older skips belong
 * to an earlier armed spell and must not reach the operator the day a client
 * is re-armed. Within the window each call is claimed once, and each client
 * is emailed about it at most once per Perth day.
 */
export const TEXT_BACK_CONFIG_ALERT_LOOKBACK_HOURS = 24;

/**
 * How long a claimed text-back may sit with no recorded outcome before it is
 * "stuck", in minutes (D-10). A send takes seconds; two minutes is a send that
 * did not come back. The alert pass reports a claimed row older than this; the
 * quote-call escalation pass leaves a claimed row YOUNGER than this alone for
 * a tick, so the tradie is never told "our text is not confirmed" a second
 * before it is (12-REVIEW WR-05).
 */
export const TEXT_BACK_STUCK_MINUTES = 2;

/**
 * The oldest missed QUOTE call the tradie is still told about, in hours
 * (D-16; 12-REVIEW WR-05), measured from `coalesce(ended_at, started_at)`.
 *
 * The escalation SMS carries no time: "X rang about … and was missed" reads
 * as happening now. A tick normally escalates a call within the minute, so
 * this only bites after a backlog — an escalation-sender outage, missing
 * ClickSend credentials, ticks not running — and stops that backlog
 * reaching a tradie's phone as a burst of stale alarms. A day still covers an
 * overnight outage, when "they rang last night" is worth a call back; past it
 * the tradie's own missed-call list is the better record. Older rows simply
 * stop being selected.
 */
export const QUOTE_CALL_ESCALATION_MAX_AGE_HOURS = 24;

/**
 * The minimum gap, in hours, between two lead follow-ups to the same caller
 * (Phase 13, D-03) — the lead twin of the quote's `MIN_GAP_HOURS` (48).
 *
 * Touches 2 and 3 are one calendar day apart at the preferred time. A touch 2
 * that slipped and re-windows onto the same morning as touch 3 (gap about 0)
 * must still be skipped — one message that morning, not two. Twelve is HALF
 * the designed spacing, and the largest value that never skips a touch 2 that
 * is merely late within its own day: approved at 16:00 it still sends today;
 * approved at 17:30 it lands on touch 3's slot tomorrow and touch 3 carries.
 * Twenty-four or more would skip touch 2 even when it reschedules to a free
 * morning; the quote's 48 would retire every slipped touch 2 outright.
 */
export const LEAD_MIN_GAP_HOURS = 12;

/**
 * How long, in hours, after a caller's lead at a client CONVERTED that a new
 * missed call from the same caller is not texted back and opens no new lead
 * (Phase 15, D-08b). Recorded as the gate skip `recent_conversion`.
 *
 * A repeat call the day after a booking is the tradie's conversation with a
 * customer he already has — "sorry we missed your call" would read as nobody
 * knowing the job is booked, and a fresh lead would double-count the enquiry.
 * A day covers "ringing back about the booking"; past it a call from the same
 * number is treated as a new enquiry and texted. Measured from the lead's
 * `closed_at`; exactly twenty-four hours after the conversion is still refused
 * (at-the-boundary-is-inside, like the cool-off below).
 */
export const LEAD_RECENT_CONVERSION_HOURS = 24;

/**
 * How far past its slot a lead follow-up may still be sent, in hours (Phase
 * 13, D-03) — the lead twin of the quote's `STALENESS_CAP_HOURS` (72).
 *
 * "Yesterday's" follow-up still reads as a follow-up; two days late on a
 * promise of "about 48 hours" reads as nobody watching. Exactly 24 hours late
 * is still sendable (the rewindow boundary rule); past it the touch is skipped
 * `stale` and the cadence carries on, so a touch 3 nobody approved for a day
 * completes the cadence and the lead closes `touches_exhausted`.
 */
export const LEAD_STALENESS_CAP_HOURS = 24;

/**
 * The age, in days from the anchor, at which a lead cadence expires (Phase 13,
 * D-15) — the lead twin of the quote's `CADENCE_EXPIRY_DAYS` (42).
 *
 * Not four. A Friday 14:00 call before a long weekend (Monday a public holiday
 * the client does not work) rolls touch 2 to Tuesday and touch 3 to Wednesday,
 * about 4.8 days after the anchor, plus the 24-hour staleness slack: 5.8 days.
 * Expiry is judged before anything else, so four would expire that lead before
 * touch 3 could ever send. Seven covers the long weekend and still bounds a
 * lead to one week; a lead whose approvals never came expires on day 8's first
 * tick.
 */
export const LEAD_EXPIRY_DAYS = 7;

/**
 * How long, in days, a caller whose newest lead at a client closed NEGATIVELY
 * is not texted again by that client (Phase 13, D-12).
 *
 * Negative means the lead closed as `not_a_lead`, `spam`, `complaint` or
 * `opt_out`: a wrong number, a robocaller, an unhappy customer or someone who
 * asked to be left alone should not get "sorry we missed your call" every time
 * they ring in the next quarter. Measured from `leads.closed_at`; exactly 90
 * days after the close is still refused (at-the-boundary-is-inside). Recorded
 * as the gate skip `recent_negative_close`. An `opt_out` stays suppressed for
 * good through the suppression table regardless of this window; every other
 * close (`touches_exhausted`, `expired`, a label that kept the conversation
 * alive) lets a fresh call open a new lead and a new text-back.
 */
export const LEAD_NEGATIVE_COOL_OFF_DAYS = 90;

/**
 * How many days after a lead closes without converting (or after a converted
 * lead's job reaches a terminal status) its caller number is replaced by a
 * keyed hash, and a lead-less missed call's number likewise (Phase 15, D-06).
 *
 * DEFINED AS the cool-off above rather than typed again. The gate's
 * repeat-caller and cool-off reads compare the RAW number and never see a
 * hash: a lead is hashed only once it is at or past the cool-off, so no gate
 * window can contain a hashed row. Shortening retention below the cool-off
 * would silently open the cool-off for every hashed caller; the identity makes
 * that a visible edit to this line, and plan 15-03 pins it.
 */
export const PSEUDONYMISE_AFTER_DAYS = LEAD_NEGATIVE_COOL_OFF_DAYS;

/**
 * The most rows of each kind the nightly pseudonymisation pass hashes in one
 * run (Phase 15, D-06). Each read is ordered by its due instant and bounded by
 * this, so a backlog drains over a few nights instead of one long run, and one
 * bad row cannot block the rest — it fails alone and is re-selected next
 * night while the others are stamped.
 */
export const PSEUDONYMISE_BATCH = 200;

/**
 * The CEILING on how long a CONVERTED lead's caller number is kept, in days
 * after the lead converted (`closed_at`) — 15-REVIEW WR-02.
 *
 * A converted caller's number is normally kept until their ServiceM8 job
 * reaches Completed or Unsuccessful in the mirror, plus
 * `PSEUDONYMISE_AFTER_DAYS`. Nothing fires that arm when the mirror never
 * sees a terminal status: the client disconnects ServiceM8, the tradie deletes
 * the job (its last status is kept), the job is abandoned as a Work Order, or
 * the lead never recorded a job uuid. Without a ceiling those numbers would be
 * kept with no end, while the public notice states one. So a converted lead is
 * due this many days after it converted REGARDLESS of its job's state, and the
 * notice says "no later than 12 months after you booked".
 *
 * MUST stay above `PSEUDONYMISE_AFTER_DAYS` (pinned): a ceiling below the
 * ordinary boundary would hash a customer whose job is still open.
 */
export const PSEUDONYMISE_CONVERTED_MAX_DAYS = 365;

/**
 * The window, in minutes, inside which a second missed call from the same
 * caller at the same client is "ringing twice" (Phase 13, D-07).
 *
 * Someone who rings, is missed, and rings again within half an hour is telling
 * the tradie it matters — that is a model-free hot trigger and escalates to the
 * tradie's phone. The second call gets no second text (the Phase 12
 * `recent_text` / `lead_open` skips stand); only the escalation.
 */
export const RING_TWICE_WINDOW_MINUTES = 30;

/**
 * The deterministic emergency words (Phase 13, D-06): a lead reply containing
 * any of these, as a whole word or phrase, case-insensitive, is HOT without
 * waiting for the model. The matcher lives in plan 13-04; the list lives here
 * so the rule, its tests and the docs read one source.
 *
 * Phrases, not bare words, where a bare word would misfire: `no power`, not
 * `no` (so "no worries" is cold); `gas leak` / `smell gas`, not `gas` (so "gas
 * hot water quote" is cold); `sparking`, not `spark` (so "sparky" is cold). "No
 * hot water" is deliberately absent — a quote, not an emergency, for most
 * trades. There is no negation guard: "not urgent" matches, and the direction
 * of that error is one extra SMS to the tradie (research OQ4, settled).
 */
export const URGENT_KEYWORDS = [
  'urgent',
  'emergency',
  'burst',
  'flooding',
  'flooded',
  'gas leak',
  'smell gas',
  'no power',
  'locked out',
  'sparking',
] as const;

/**
 * How many days AFTER a missed call a ServiceM8 job carrying the caller's
 * mobile still counts as the tradie's own booking of that lead (Phase 14,
 * D-07).
 *
 * A lead whose caller mobile appears — through the job's contact, or its
 * client record's contact — on a job dated within fourteen days after the call
 * was booked by the tradie himself: the sync closes it `converted` with reason
 * `booked_by_tradie`. Fourteen covers a tradie who rang back the next week and
 * booked a quote visit for the week after; past it a job for the same number is
 * more likely a new enquiry than this one. Measured on calendar dates in the
 * client's zone; the job dated exactly fourteen days after the call is still
 * inside (at-the-boundary-is-inside). Counted in leads-to-jobs, NEVER
 * attributed recovered dollars (D8).
 */
export const LEAD_JOB_MATCH_WINDOW_DAYS = 14;

/**
 * How far back, in hours, a tradie's DONE looks for the escalation it answers
 * (Phase 14, D-08).
 *
 * A DONE from the client's own phone closes the lead whose escalation was most
 * recently SENT to that number inside the last two days. Older escalations are
 * stale: a tradie replying DONE to something from last week is more likely
 * answering something else, and closing the wrong lead silently is worse than
 * asking — so a DONE with no escalation inside the window closes nothing and
 * raises one operator alert instead.
 */
export const DONE_LOOKBACK_HOURS = 48;

/**
 * The most `companycontact.json` reads one sync cycle may spend, per client,
 * matching open leads to jobs that have no mirrored contact (Phase 14, D-07,
 * D-12).
 *
 * Most jobs carry a job contact the sync already mirrors, so the match is
 * usually free. A job the tradie created straight from a client record has
 * none, and its mobile lives only on the client's company contact — one read
 * per company. Ten per cycle (every five minutes) is far inside ServiceM8's
 * 180 requests a minute and 20,000 a day at this volume, and a tenant with no
 * open lead spends zero. Candidates past the cap wait for the next cycle.
 */
export const LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE = 10;

/**
 * The longest one of those company-contact reads may wait, in milliseconds
 * (14-REVIEW WR-06). The client's own timeout is 20 s; ten reads at that would
 * be 200 s of ServiceM8 wait after a cycle has committed, outside the tick's
 * deadline. These reads are optional — a skipped one waits for the next
 * cycle — so each is capped at five seconds, and never past the pass's
 * deadline (below).
 */
export const LEAD_JOB_MATCH_READ_TIMEOUT_MS = 5_000;

/**
 * How far before the sync tick's deadline (`TICK_DEADLINE_MS`, measured from
 * the tick's start) the tradie-booked pass stops spending company-contact
 * reads, in milliseconds (14-REVIEW WR-06). Past it the remaining reads are
 * skipped, counted and logged; the mirror tier (no ServiceM8 read) still
 * resolves. The margin leaves the pass's own per-hit transactions, and the
 * next cycle's admission check, room inside the tick budget.
 */
export const LEAD_JOB_MATCH_PASS_MARGIN_MS = 10_000;

/**
 * How long, in minutes, a lead may sit in `sm8_job_state = 'creating'` before
 * the sync's post-commit pass declares the claim abandoned and moves the lead
 * to `failed` with error kind `stale_claim` (Phase 14, plan 14-03).
 *
 * A claim is taken by the operator's tap and released by that same request —
 * `created` on success, `failed` with a kind on any classified failure or
 * in-process throw. The one way a lead stays `creating` is the request dying
 * mid-pipeline (a platform timeout, a redeploy), and then the claim admits
 * nothing: the row shows "creating job…" with no control, forever. Fifteen
 * minutes is far past any request's life (the console's functions run for
 * minutes at most, and a create is a handful of ServiceM8 calls), so a claim
 * that old has no request behind it. Moving it to `failed` brings back the
 * operator's Retry, and the retry's adopt-before-create reconciles whatever
 * ServiceM8 holds — a job the dead request did create is adopted, never
 * duplicated. Strictly OLDER than the constant is stale; a claim exactly
 * fifteen minutes old is still live.
 */
export const LEAD_JOB_CLAIM_STALE_MINUTES = 15;
