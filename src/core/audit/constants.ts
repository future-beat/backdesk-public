/**
 * The numbers the Quote Leakage Audit and the attribution report are built on.
 *
 * They live in their own module — with no imports — because both the FIGURE and
 * the FOOTNOTE that explains it must render from the same value. The audit is a
 * document handed to a prospect as evidence; a report that says "we applied a
 * conservative 15% recovery rate" above a number computed with 0.2 is not a
 * rounding error, it is a document that can be shown to be wrong by the person
 * being sold to.
 *
 * Phase 7 added five more (below `WINDOW_DAYS`) under exactly the same rule,
 * and raised the stakes: the audit is a promise to a prospect, but an
 * attribution row is a line on an INVOICE. `tests/audit-aggregate.test.ts` pins
 * this module to exactly nine exports and asserts, as a test rather than a
 * convention, that it contains no `import` — the moment it can import, it can
 * acquire a dependency that makes it unusable from a print page, a consumer or
 * a digest, and the second literal appears somewhere to work around that.
 *
 * CONFIRMED, NOT ASSUMED (Phase 8, BRAND-02, D-09). The three COMMERCIAL values
 * below — `AUDIT_RECOVERY_RATE`, `DEFAULT_BASELINE_WIN_RATE` and
 * `BASELINE_MIN_QUOTES` — together with the rule that the setup fee is excluded
 * from the recovery multiple, were confirmed by the operator on 2026-09-07
 * ("keep-all"). The decision record, with the rationale and where each value
 * renders, is `docs/commercial-assumptions.md`; this file is the one config
 * location it points back to. Changing one of them means editing the value line
 * here AND the matching literal pin in `tests/audit-aggregate.test.ts` — and
 * nothing else, because nothing derives a second copy.
 */

/**
 * The share of never-followed-up quote value assumed recoverable (D-09).
 *
 * The GTM research gives a 15–20% band and no more specific figure. **0.15 is
 * the conservative end, chosen deliberately.** The audit is a promise made
 * before any work has been done, and the service guarantees 3x fees — every
 * point of overstatement here is a point of that guarantee spent in advance,
 * on a prospect who has not paid anything yet. Under-promising costs a slightly
 * less exciting headline; over-promising costs a refund and the reference.
 *
 * OPERATOR-CONFIRMED 2026-09-07 (see the file header): if a later operator
 * prefers another value in the band, this line is the only change required —
 * the figure, the footnote and the stored `recoverable_estimate` all derive
 * from it.
 */
export const AUDIT_RECOVERY_RATE = 0.15;

/**
 * Days after a quote is issued before silence counts as "never followed up"
 * (D-10).
 *
 * Three days, not one: a tradie who quotes on Friday and rings on Monday
 * followed up. Counting them as a leak would put a figure in front of a
 * prospect that they can immediately disprove from their own phone records,
 * and the audit's only real asset is that the prospect believes it.
 *
 * Measured as 72 hours of elapsed time, not three calendar days — see
 * `followup.ts` for why that distinction is load-bearing.
 */
export const GRACE_PERIOD_DAYS = 3;

/**
 * The audit and baseline window (AUD-01, D-14).
 *
 * The same 90 days for the prospect audit and for the client backfill baseline,
 * on purpose: a prospect's leakage figure and their first monthly report have
 * to be measured over comparable ground, or converting a prospect into a client
 * produces two numbers that appear to contradict each other in the first week.
 */
export const WINDOW_DAYS = 90;

/**
 * The attribution window: days after a qualifying sent touch within which a win
 * still counts as ours (D-01).
 *
 * Thirty days, anchored on the LAST qualifying SENT touch and measured back
 * from the moment the win was DETECTED — never on cadence creation, never on
 * ServiceM8's editable `work_order_date`. A quote we chased in March and a job
 * won in July are not the same event, and claiming credit for the second on the
 * strength of the first is precisely the overreach that makes a recovered-
 * revenue invoice arguable.
 *
 * MEASURED IN ELAPSED MILLISECONDS, not calendar days — the `auditWindow`
 * reasoning in `aggregate.ts`: a DST transition inside the window would
 * otherwise move its edge by an hour depending on where the consumer ran.
 *
 * PLANNER'S FLAGGED ASSUMPTION, surfaced rather than buried: this value is
 * COSTLY to change. Every attribution row records the window it was computed
 * under (`window_days`), so a later edit means months computed under two rules
 * and frozen reports already sent under the old one. The row column, the
 * report's methodology footnote and the evidence chain's
 * `constants.attributionWindowDays` all derive from this one line.
 */
export const ATTRIBUTION_WINDOW_DAYS = 30;

/**
 * The win rate assumed when a client has no usable pre-service history (D-08).
 *
 * **0.70 is deliberately HIGH, and the direction is the whole point.** The
 * conservative figure is `gross × (1 − baseline)`, so a HIGH assumed baseline
 * SHRINKS our credit. Assuming the client was already winning 70% of quotes —
 * at or above every published trade benchmark this planner could find — lets
 * the footnote say "we assumed you were already winning 70%, so this number is
 * understated", which is a sentence that survives being challenged. The
 * opposite assumption is a number a client can argue down in the first meeting
 * where it matters.
 *
 * This applies ONLY where the connect-time baseline is null or too thin
 * (D-06/D-09 make the measured one canonical and frozen), which the connect
 * flow makes rare.
 *
 * PLANNER'S FLAGGED ASSUMPTION (A1), surfaced rather than buried: 0.70 is
 * reasoned from a UK vendor's 30–50% "healthy" band (>60% flagged as
 * under-pricing) and an unverified AU aggregator figure of 85–87% acceptance.
 * Neither is a study, which is why it was put to the operator rather than left
 * to stand: **confirmed 2026-09-07** (see the file header). One line to change;
 * the figure and the footnote both derive from it.
 */
export const DEFAULT_BASELINE_WIN_RATE = 0.7;

/**
 * The thin-sample floor below which a measured win rate is not used (D-08).
 *
 * Ten quotes. Below that a "baseline" is a coin flip — at n = 10 the 95% Wilson
 * interval on p = 0.5 spans roughly ±0.28 — and the deliberately conservative
 * default above is the more honest yardstick. Ten quotes in the 90-day baseline
 * window is under one a week: a business that thin has no baseline to speak of.
 *
 * NOTE THE ASYMMETRY, WHICH IS INTENDED: falling back here always shrinks our
 * credit, because the default is higher than almost any measured rate. The
 * thin-sample rule can only cost us money, never the client.
 *
 * ASSUMPTION A2, surfaced rather than buried: standard binomial interval
 * arithmetic, no client data yet. **Operator-confirmed 2026-09-07** (see the
 * file header). The report's footnote prints "fewer than 10 quotes" from this
 * same value.
 */
export const BASELINE_MIN_QUOTES = 10;

/**
 * The opt-out rate above which a client is flagged (D-16).
 *
 * Five percent of contacts messaged in the rolling window. Above it the client
 * row on `/reports` shows a red badge and the 06:30 digest carries one line.
 * **It nags; it never pauses a healthy client** (Phase 6 D-15) — an automated
 * stop on a metric this noisy at founding-cohort volumes would silence a client
 * over three people who moved house.
 *
 * Honestly labelled "opt-out rate" everywhere, never "complaint rate": no
 * complaint signal exists in this system, and presenting one would be a claim
 * we cannot support.
 *
 * ONE VALUE, THREE SURFACES: the overview badge, the detail-page badge and the
 * digest heading all derive from it through `isOptOutAlarming` — none of them
 * carries a `5`, a `0.05` or a `500` of its own. The rate is only HALF the
 * rule; `OPT_OUT_ALARM_MIN_CONTACTS` below is the other half.
 */
export const OPT_OUT_ALARM_RATE = 0.05;

/**
 * The minimum contacts messaged in the window before the alarm may fire at all
 * (quick 260913-ind, 2026-09-13).
 *
 * A RATE NEEDS A DENOMINATOR TO MEAN ANYTHING. Measured on 2026-09-13: the test
 * tenant has exactly one contact — the operator's own handset, opted out during
 * the Phase 4 STOP test — so `optOutRate` read 100.0% (1 of 1 contacts) and
 * filled the daily digest with the same alarm line every morning for thirty
 * rolling days. Nothing was wrong; the alarm simply had no sample. An operator
 * who deletes that email unread every day is an operator who will delete the
 * real one.
 *
 * Ten, deliberately the SAME floor and the same argument as
 * `BASELINE_MIN_QUOTES` above: below ten a proportion is a coin flip, and the
 * 95% Wilson interval at n = 10 is wide enough to swallow the 5% threshold
 * whole. A client we have messaged nine people for has not demonstrated a copy
 * problem no matter how many of them opted out; one more contact next week
 * would halve the figure.
 *
 * THE ASYMMETRY IS INTENDED, and it is the safe direction: this rule can only
 * ever SILENCE an alarm, never raise one. The worst case is a real problem
 * noticed a week later on a client with almost no traffic; the case it prevents
 * is a daily false alarm that trains the operator to ignore the channel.
 *
 * It is applied in exactly one place — `isOptOutAlarming` in
 * `reporting/metrics.ts` — so the overview badge, the detail-page badge and the
 * digest line acquire the floor together or not at all. Recorded in
 * `docs/commercial-assumptions.md` §7.
 */
export const OPT_OUT_ALARM_MIN_CONTACTS = 10;

/**
 * The first-touch service-level window, in hours (D-18).
 *
 * Twenty-four hours from the `quote_opened` event's `detected_at` to touch 1
 * becoming a qualifying sent row. This is the metric that answers "is the thing
 * we sell actually happening" — the pitch is that every open quote gets
 * followed up ON TIME, and a first touch that lands on day three is the service
 * silently not being delivered.
 *
 * Exactly 24h counts as within (the strict-threshold convention this codebase
 * uses everywhere: at the boundary is inside). Derived once into
 * `FIRST_TOUCH_MS` in `reporting/metrics.ts`; the dd label on both
 * instrumentation pages renders "within 24h" from this same number.
 */
export const FIRST_TOUCH_HOURS = 24;

/**
 * The most missed-call text-backs one client may send in any rolling 24 hours
 * (Phase 12, D-07 — founder decision 5 Oct 2026).
 *
 * Thirty. A busy sole-trader misses perhaps five to fifteen calls on a bad day;
 * thirty is double the worst day we expect, so the cap never bites on honest
 * traffic. What it is for is FLOOD CONTROL: a caller-ID spoof run, a looping
 * auto-dialler or a carrier fault that re-presents one call many times must not
 * turn a client's text-back into a bulk SMS sender in their name, on our
 * balance. It is not a precise quota — two calls decided in the same instant
 * can both pass at 29 — and does not need to be.
 *
 * A ROLLING WINDOW, NOT A CALENDAR DAY: counted over claimed and sent
 * text-backs decided in the last 24 hours, so no tenant-zone midnight resets
 * it. Failed sends are not counted (a refused send cost nothing and texted
 * nobody).
 *
 * Applied in exactly one place — the `daily_cap` rule of `decideTextBack` in
 * `src/core/leads/gate.ts`. Recorded in `docs/commercial-assumptions.md` §8.
 */
export const TEXT_BACK_DAILY_CAP = 30;

/**
 * The ClickSend balance, in AUD cents, below which the operator is alerted
 * once a day (Phase 12, D-07/D-10 — founder decision 5 Oct 2026).
 *
 * A$20. At ~7.2c a segment and two segments a text-back, A$20 is roughly 140
 * text-backs — several days of the whole founding cohort's missed calls, which
 * is the lead time a human needs to notice an email and top up. The alert is
 * an email (an SMS about an empty SMS balance goes nowhere) and is latched to
 * one per Perth calendar day by `operator_alert_log`.
 *
 * Applied in exactly one place — the balance probe in
 * `src/core/leads/balance.ts`. Recorded in `docs/commercial-assumptions.md` §9.
 */
export const CLICKSEND_BALANCE_ALERT_FLOOR_CENTS = 2000;

/**
 * The ClickSend balance, in AUD cents, below which every armed client's
 * text-back is DISARMED by the system (Phase 12, D-07/D-10/D-21 — founder
 * decision 5 Oct 2026).
 *
 * A$5 — about thirty-five text-backs. Below it a burst of calls could leave
 * claimed text-backs that ClickSend then refuses for credit, and a caller who
 * rang a tradie and got silence is the failure this product exists to prevent;
 * an honest "text-back is off" on the operator's console is better than a
 * switch that reads armed and sends nothing. The disarm writes one audit row per
 * client with `actor = 'system'` and a reason, and is never automatically
 * reversed: re-arming is an operator's act through the gate.
 *
 * Applied in exactly one place — the balance probe in
 * `src/core/leads/balance.ts`. Recorded in `docs/commercial-assumptions.md` §10.
 */
export const CLICKSEND_BALANCE_DISARM_FLOOR_CENTS = 500;
