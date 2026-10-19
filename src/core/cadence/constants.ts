/**
 * Every magnitude the cadence engine reasons about, named once.
 *
 * They live in their own module with NO IMPORTS — the same rule
 * `src/core/audit/constants.ts` follows, and for the same reason: these
 * numbers are read by the scheduler, by the re-window policy, by the operator
 * console's explanatory copy, and eventually by the monthly report. A value
 * repeated at four call sites is four values that can disagree, and the way
 * you find out is a client asking why their quote was chased on day 4 when the
 * console said day 3.
 *
 * WHAT IS AND IS NOT CONFIGURATION. `DEFAULT_TOUCH_OFFSET_DAYS` and
 * `DEFAULT_PREFERRED_SEND_TIME` are DEFAULTS: D-02 and D-03 put the live values
 * in `cadence_touch_templates` and `cadence_settings` rows, so onboarding can
 * say "not three weeks, my quotes go cold in five days" without a deploy. The
 * constants here are what a tenant is seeded with, and nothing reads them at
 * send time. The rest — jitter bound, min gap, staleness cap, expiry, draft
 * lead, same-day margin — are policy, identical for every client, and changing
 * one is a decision about the product rather than about a client.
 *
 * NOTE THE DELIBERATE SEAM (03-01 close-out): `templates.ensureDefaults()`
 * takes the offsets as a PARAMETER and does not import this module. The
 * repository layer stays ignorant of policy; the caller passes
 * `DEFAULT_TOUCH_OFFSET_DAYS` in.
 */

/**
 * D-02 — the default cadence shape: day 0, 3, 7, 14, 21 from the anchor.
 *
 * Offsets are measured from the ANCHOR (D-01: the eligibility moment), not from
 * the previous touch. That matters when a touch is re-windowed: the schedule is
 * a set of absolute intentions, so a slipped touch does not drag the whole tail
 * of the cadence along with it.
 *
 * Five touches over three weeks, front-loaded. A quote goes cold fast, and the
 * last two exist mostly so a customer who was waiting on a partner's decision
 * still hears from the tradie before the file closes.
 */
export const DEFAULT_TOUCH_OFFSET_DAYS = [0, 3, 7, 14, 21] as const;

/**
 * D-03 — the default wall-clock send time in the TENANT's zone, mid-morning.
 *
 * 'HH:MM', the shape `parseTimeOfDay` accepts. Mid-morning is chosen so a reply
 * lands during the tradie's working day rather than in an evening inbox nobody
 * reads until the following week, and so a follow-up never arrives at the two
 * moments that read as rude — first thing, and knock-off.
 *
 * ALWAYS CLAMPED INSIDE THE TENANT'S CONTACT WINDOW. A client whose window
 * opens at 10:00 gets 10:00 + jitter, not 09:30. The clamp lives in
 * `window.ts`, not here, because it depends on the tenant row.
 */
export const DEFAULT_PREFERRED_SEND_TIME = '09:30';

/**
 * D-03 — the upper bound, in minutes, of the random offset added to a slot.
 *
 * "A few minutes", so that a client's whole queue does not land at the identical
 * minute every morning. The point is not privacy or throttling; it is that a
 * batch of messages sharing a timestamp to the second reads as machinery, and
 * this product's entire proposition is that it does not.
 *
 * Deliberately small relative to `SAME_DAY_MARGIN_MINUTES`: jitter must never be
 * able to push a slot that passed the margin check out past the window close.
 */
export const JITTER_MAX_MINUTES = 10;

/**
 * D-10 — the minimum gap, in hours, between two messages to the same customer.
 *
 * Roughly two days. It exists for the re-window case: a touch that slipped past
 * its slot can be rescheduled into a position that sits hours before the NEXT
 * touch's slot, and the customer receives two chases in a morning. When the
 * rescheduled slot falls inside this gap of the following touch, the slipped
 * touch is skipped rather than compressed — one missed follow-up is cheaper
 * than looking like a machine having a malfunction.
 */
export const MIN_GAP_HOURS = 48;

/**
 * D-11 — how far past its slot a touch may be sent, in hours.
 *
 * A touch that is three days late is not a follow-up any more; it is a message
 * whose timing tells the customer that nobody was watching. Past this cap the
 * touch is skipped with `stale`, and the cadence carries on to the next one —
 * the alternative, sending everything that queued up during an outage, is the
 * burst that CAD-02 exists to prevent.
 */
export const STALENESS_CAP_HOURS = 72;

/**
 * D-12 — the age, in days, at which a cadence stops on its own.
 *
 * Six weeks from the anchor. A quote nobody has answered in six weeks is not
 * being considered, and a cadence that outlives its own schedule is how a
 * customer ends up hearing about a bathroom they had done by someone else in
 * March. Expiry is a terminal state with a reason, not a silent halt.
 */
export const CADENCE_EXPIRY_DAYS = 42;

/**
 * D-14 — how far ahead of its slot a touch surfaces for drafting/approval.
 *
 * Phase 3 auto-passes both gates, so this value does nothing yet by design.
 * It is fixed now because Phases 5 and 6 build the drafting queue and the
 * approval console against it, and CON-04's "draft aging" metric is measured
 * from the moment a touch became visible — which is this lead time, not the
 * send slot.
 */
export const DRAFT_LEAD_HOURS = 24;

/**
 * D-09 — how much of the contact window must remain for a slot to land today.
 *
 * "Enough margin", quantified. A touch becoming due at 16:55 against a 17:00
 * close is technically inside the window and practically an ambush: the tradie
 * is packing up, a reply arrives after hours, and the customer's answer sits
 * unread overnight. One hour is the planner's discretion within D-09 — the rule
 * is `now + margin <= window end`, evaluated in the tenant's zone.
 */
export const SAME_DAY_MARGIN_MINUTES = 60;

/**
 * The literal `event_consumer_cursors.consumer` key this engine registers under.
 *
 * A STRING CONSTANT AND NOT AN INLINE LITERAL because the cursor row is the
 * outbox contract from Phase 2 (`src/db/schema/quote-events.ts`): the consumer
 * registers with `INSERT ... ON CONFLICT DO NOTHING`, so a typo does not fail —
 * it silently creates a SECOND cursor that starts at zero and replays the
 * entire event history, which for this consumer means re-materializing cadences
 * for every quote ever opened.
 */
export const CADENCE_CONSUMER = 'cadence-engine';

/**
 * The literal `event_consumer_cursors.consumer` key the ATTRIBUTION consumer
 * registers under (Phase 7).
 *
 * SIBLINGS, AND NEITHER MAY EVER READ THE OTHER'S. Two consumers ride the same
 * `quote_status_events` outbox at their own pace: the cadence engine
 * materializes and stops cadences, the attribution consumer turns `won` events
 * into attribution rows. They advance independently on purpose — the cadence
 * engine can be head-of-line blocked on a tenant with a broken connection while
 * attribution keeps billing correctly, and vice versa.
 *
 * Living here rather than in a Phase 7 module so that BOTH cursor names are in
 * one file: the failure this prevents is a future consumer being given a name
 * that collides with, or is copy-pasted from, an existing one. A collision does
 * not fail loudly — the two consumers would silently share a cursor and each
 * would skip the events the other consumed.
 */
export const ATTRIBUTION_CONSUMER = 'attribution';
