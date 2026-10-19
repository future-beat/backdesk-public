# Commercial assumptions — decision record (Phase 8, BRAND-02)

**Confirmed:** 2026-09-07
**Confirmed by:** founder/operator
**Operator's reply, verbatim:** `keep-all, grace-window confirmed`

Three numbers and one rule decide what a Quote Leakage Audit promises a prospect
and what a monthly report claims on an invoice. They were carried as flagged
planner assumptions from Phase 2 and Phase 7; this record is the point at which
a human confirmed them, before any real audit or invoice exists.

**The one config location is `src/core/audit/constants.ts`.** That module has no
imports, holds exactly nine exports, and is pinned to both of those facts by
`tests/audit-aggregate.test.ts` — because a print page, a background consumer, a
digest builder and a React server component all have to read the same value, and
the moment one of them cannot, a second literal appears somewhere and the figure
and its own footnote begin to disagree on a document handed to a client as
evidence.

---

## 1. `AUDIT_RECOVERY_RATE` = `0.15`

**Confirmed: keep.**

**What it is:** the share of never-followed-up quote value assumed recoverable.

**Rationale** (from the JSDoc on the constant): the GTM research gives a 15–20%
band and no more specific figure. 0.15 is the conservative end, chosen
deliberately. The audit is a promise made before any work has been done, and the
service guarantees 3× fees — every point of overstatement here is a point of that
guarantee spent in advance, on a prospect who has not paid anything yet.
Under-promising costs a slightly less exciting headline; over-promising costs a
refund and the reference.

**Where it renders:**

- the audit page footnote — `src/app/(console)/audits/[id]/page.tsx:212`
  derives `ratePercent = Math.round(AUDIT_RECOVERY_RATE * 100)` and line 279
  prints "applies a conservative 15% recovery rate to the never-followed-up
  value"
- the figure the footnote explains — `recoverableEstimateCents` in
  `src/core/audit/aggregate.ts:215`, stored to `prospects.recoverable_estimate`

**If it changes:**

1. edit the value line in `src/core/audit/constants.ts` (nothing else holds a
   copy — `tests/audit-aggregate.test.ts` asserts `aggregate.ts` contains no
   second `0.15`)
2. edit the pin at `tests/audit-aggregate.test.ts:115`
   (`expect(AUDIT_RECOVERY_RATE).toBe(0.15)`)
3. **Stored-prospect caveat.** `prospects.recoverable_estimate` is written at
   audit time under the then-current rate, while the audit page footnote renders
   the *current* constant. Any prospect generated before the change would
   therefore disagree with its own footnote. Before shipping a rate change,
   `/audits` must list no prospects (the Aug-2026 fixture was torn down on
   4 Sep 2026) or every surviving prospect must be regenerated.
4. the new value must be a whole basis point — see §5.

## 2. `DEFAULT_BASELINE_WIN_RATE` = `0.7`

**Confirmed: keep.**

**What it is:** the win rate assumed when a client has no usable pre-service
history.

**Rationale** (from the JSDoc): 0.70 is deliberately HIGH, and the direction is
the whole point. The conservative figure is `gross × (1 − baseline)`, so a HIGH
assumed baseline SHRINKS our credit. Assuming the client was already winning 70%
of quotes — at or above every published trade benchmark found — lets the footnote
say "we assumed you were already winning 70%, so this number is understated",
which is a sentence that survives being challenged. The opposite assumption is a
number a client can argue down in the first meeting where it matters. The figure
is reasoned from a UK vendor's 30–50% "healthy" band and an unverified AU
aggregator figure of 85–87% acceptance; neither is a study, which is why it was
put to the operator rather than left to stand.

**Where it renders:** the report's baseline methodology footnote via
`src/core/reporting/copy.ts` (~line 258–262), and the conservative recovered
value itself through `resolveBaseline` in `src/core/attribution/baseline.ts`.

**If it changes:**

1. edit the value line in `src/core/audit/constants.ts`
2. edit the pin at `tests/audit-aggregate.test.ts:96`
   (`expect(DEFAULT_BASELINE_WIN_RATE).toBe(0.7)`)
3. baselines are **frozen at connect**, so a change affects only future
   thin-history connects — never a report already generated
4. the new value must be a whole basis point — see §5

## 3. `BASELINE_MIN_QUOTES` = `10`

**Confirmed: keep.**

**What it is:** the thin-sample floor below which a measured win rate is not
used.

**Rationale** (from the JSDoc): below ten quotes a "baseline" is a coin flip — at
n = 10 the 95% Wilson interval on p = 0.5 spans roughly ±0.28 — and the
deliberately conservative default above is the more honest yardstick. Ten quotes
in the 90-day baseline window is under one a week: a business that thin has no
baseline to speak of. Note the intended asymmetry: falling back here always
shrinks our credit, because the default is higher than almost any measured rate.
The thin-sample rule can only cost the service money, never the client.

**The threshold is strictly fewer-than.** `src/core/attribution/baseline.ts:79`
reads `(input.quotesIssued ?? 0) < BASELINE_MIN_QUOTES`, so at *exactly* ten
quotes the measured baseline is used, not the default —
`tests/attribution-baseline.test.ts` covers both sides (`BASELINE_MIN_QUOTES − 1`
falls back, `BASELINE_MIN_QUOTES` does not).

**Where it renders:** the report footnote prints "fewer than 10 quotes" from this
same value — `src/core/reporting/copy.ts:262`.

**If it changes:** edit the value line in `src/core/audit/constants.ts` and the
pin at `tests/audit-aggregate.test.ts:100`
(`expect(BASELINE_MIN_QUOTES).toBe(10)`).

## 4. The setup fee is EXCLUDED from the recovery multiple

**Confirmed: keep excluded.** *16 Oct 2026: the public offer no longer carries a setup fee (Call Catcher $397 / Back Desk $797 a month, first 30 days free, founder decision after a prospect conversation). The exclusion rule stands unchanged: a fee of zero is excluded trivially, and a client onboarded under the old sheet still has its $990 recorded in `tenant_fees` and shown as excluded. The report's `feesNote` wording is reviewed when the first report under the new offer is generated.*

**Rationale** (from `feesNote`, `src/core/reporting/copy.ts`): the setup fee is
stated on the report and stated as excluded. The 3× guarantee is quoted against
the retainer, and silently folding a $990 setup fee into the denominator would
make a first month that worked look like a failure — while omitting the fee
entirely would make the report disagree with the invoice it is stapled to. The
sentence a client reads is "The return on fees divides the conservative recovered
value by the retainer only."

**Where it renders:** footnote 4 of the monthly report — `feesNote` in
`src/core/reporting/copy.ts`; the multiple itself in
`src/core/reporting/figures.ts`.

**If it changes:** this is a policy change, not a constant edit. It touches
`figures.ts`, `copy.ts` and four report test files, and needs its own plan.

## 5. Basis-point precision (why the two rates are constrained)

`src/core/audit/aggregate.ts` and `src/core/attribution/baseline.ts` both store
rates as **whole basis points** (`Math.round(value * 10_000)` into a `smallint`).
A rate that is not a whole basis point would be silently rounded on the way into
a stored row while the footnote rendered the unrounded constant — a figure
disagreeing with its own explanation, again. `0.15 → 1500` and `0.7 → 7000` are
both exact, and `tests/audit-aggregate.test.ts` now asserts
`Number.isInteger(rate * 10000)` for both, so any operator-chosen replacement
must satisfy the same constraint.

## 6. Grace-window behaviour (confirm-only, no change)

A quote **won** inside the 72-hour grace window (`GRACE_PERIOD_DAYS = 3`) is
**not** counted as "never followed up". The operator confirmed this as-is on
2026-09-07 with no follow-up task requested. The reasoning stands as written on
`GRACE_PERIOD_DAYS`: a tradie who quotes on Friday and rings on Monday followed
up, and counting them as a leak would put a figure in front of a prospect that
they can immediately disprove from their own phone records — the audit's only
real asset is that the prospect believes it.

## 7. `OPT_OUT_ALARM_MIN_CONTACTS` = `10`

**Added: 2026-09-13** (quick task `260913-ind`). Not one of the four values the
operator confirmed on 2026-09-07 — an operational threshold added afterwards in
response to a measured fault, recorded here because it lives in the same
single-config module and the same "figure and footnote must agree" rule applies.

**What it is:** the minimum number of contacts messaged in the rolling 30-day
window before the opt-out alarm may fire at all. Below it, `isOptOutAlarming`
returns false whatever the rate.

**Why it was added — measured, not assumed.** Every day at 22:30 UTC the daily
digest arrived carrying one line: "Perth Sparks Electrical (Test): 100.0% (1 of
1 contacts) in the last 30 days." The test tenant has exactly one contact — the
operator's own handset, opted out during the Phase 4 STOP test — and
`OPT_OUT_ALARM_RATE` had no denominator floor, so one suppressed contact was a
100% alarm for thirty rolling days. The digest's own "send nothing when empty"
rule was working correctly; the alarm was the noise source. An operator who
deletes that email unread every morning is an operator who will delete the real
one.

**Rationale for ten:** deliberately the same floor and the same argument as
`BASELINE_MIN_QUOTES` (§3). Below ten, a proportion is a coin flip — the 95%
Wilson interval at n = 10 is wide enough to swallow the 5% threshold whole. A
client we have messaged nine people for has not demonstrated a copy problem no
matter how many of them opted out; one more contact next week would halve the
figure.

**The asymmetry is intended, and it is the safe direction.** This rule can only
ever *silence* an alarm, never raise one. Worst case: a real problem is noticed
a week later on a client with almost no traffic. The case it prevents: a daily
false alarm that trains the operator to ignore the channel — which is the
channel every other alert also rides.

**It did NOT silence the digest** (CON-04). The daily tick still runs on
schedule and still sends whenever there is anything to say; what changed is that
a one-contact tenant no longer manufactures something to say.

**Where it applies:** exactly one place — `isOptOutAlarming` in
`src/core/reporting/metrics.ts`, which now takes the whole `Rate` (numerator,
denominator, rateBp) rather than a bare `rateBp` so that no caller *can* ask the
old, rate-only question. Its three surfaces acquire the floor together: the
`/reports` overview badge and the `/reports/[client]` detail badge through
`computeTenantMetrics`'s `optOut.alarming`, and the digest line through
`src/core/reporting/opt-out-section.ts`.

**Boundary:** at exactly ten contacts the alarm CAN fire (at-the-boundary-is-
inside, the same convention as the 5% threshold itself);
`tests/opt-out-section.test.ts` covers 1-of-1 → no line, 9-of-9 → no line,
1-of-10 → a line, and 1-of-20 (exactly 5%) → a line.

**If it changes:** edit the value line in `src/core/audit/constants.ts` and the
pin in `tests/audit-aggregate.test.ts`
(`expect(OPT_OUT_ALARM_MIN_CONTACTS).toBe(10)`), plus the export-count pin in
the same file if the export count moves. Nothing is stored under this value —
it is evaluated at render time — so a change takes effect immediately on every
surface and rewrites no history.

## 8. `TEXT_BACK_DAILY_CAP` = `30`

**Added: 2026-10-06** (Phase 12, D-07 — founder decision 5 Oct 2026).

**What it is:** the most missed-call text-backs one client may send in any
rolling 24 hours. A call that would be the 31st is recorded on the missed call
as skipped with reason `daily_cap` and nothing is sent.

**Rationale for thirty:** a busy sole trader misses perhaps five to fifteen
calls on a bad day; thirty is double the worst day we expect, so the cap never
bites on honest traffic. It exists as **flood control**: a caller-ID spoof run,
a looping auto-dialler or a carrier fault that re-presents one call many times
must not turn a client's text-back into a bulk SMS sender in their name, on our
balance.

**Both rules are ROLLING 24-hour windows.** The cap and the one-text-per-caller
rule ("this caller was already texted for this client in the last 24 hours" →
`recent_text`) both count text-backs whose decision time falls inside the last
24 hours, measured back from the moment the new call is decided. **No
tenant-zone midnight resets either of them**: a client in Perth and one in
Sydney are limited identically, and a flood that starts at 23:50 does not get a
fresh thirty at 00:00.

**What is counted:** text-backs that were claimed (outcome not yet known — the
caller may have been texted) or sent. **Failed sends consume neither rule** — a
send ClickSend refused texted nobody and cost nothing, and it must not stop the
redial five minutes later from being answered. The row being decided is
excluded from its own count.

**Boundary:** with 29 prior text-backs in the window the call is texted (it is
the 30th); with 30 prior it is skipped `daily_cap`. A prior text-back decided at
exactly 24 hours before now still counts (at-the-boundary-is-inside).

**It is flood control, not a precise quota.** The two reads run inside the
claim transaction under READ COMMITTED, so two calls decided in the same instant
can both see 29 and both pass. That is accepted: the cap's job is to stop a
flood, and a flood is serialised by its own volume long before it reaches
thirty-one-at-once.

**Where it applies:** exactly one place — the `daily_cap` rule of
`decideTextBack` in `src/core/leads/gate.ts`; the count is
`missedCalls.countTextBacksSince` in the tenant-scoped repository.

**If it changes:** edit the value line in `src/core/audit/constants.ts` and the
value pin in `tests/audit-aggregate.test.ts`, then the gate suite's 29/30
boundary cases in `tests/text-back-gate.test.ts`.

## 9. `CLICKSEND_BALANCE_ALERT_FLOOR_CENTS` = `2000`

**Added: 2026-10-06** (Phase 12, D-07/D-10 — founder decision 5 Oct 2026).

**What it is:** the ClickSend account balance, in AUD cents (A$20), below which
the operator is emailed. One email per Perth calendar day at most, latched by
the `operator_alert_log` primary key `(kind, alert_day)`.

**Rationale for A$20:** at about 7.2c a segment and two segments per
text-back, A$20 is roughly 140 text-backs — several days of the whole founding
cohort's missed calls, which is the lead time a human needs to see an email and
top up. The alert is an email because an SMS about an empty SMS balance goes
nowhere.

**Where it applies:** exactly one place — the balance probe in
`src/core/leads/balance.ts`, run from the per-minute cadence tick on a
fifteen-minute time gate (no new cron job).

**If it changes:** edit the value line in `src/core/audit/constants.ts` and the
value pin in `tests/audit-aggregate.test.ts`. It must stay above §10's floor.

## 10. `CLICKSEND_BALANCE_DISARM_FLOOR_CENTS` = `500`

**Added: 2026-10-06** (Phase 12, D-07/D-10/D-21 — founder decision 5 Oct 2026).

**What it is:** the ClickSend balance, in AUD cents (A$5), below which the
system disarms text-back for every armed client, writing one
`messaging_config_audit` row per client with `actor = 'system'` and a reason.

**Rationale for A$5:** about thirty-five text-backs. Below it, a burst of calls
could leave text-backs that ClickSend refuses for credit — and a caller who rang
a tradie and got silence is exactly the failure this product exists to prevent.
An honest "text-back is off" on the console is better than a switch that reads
armed and sends nothing.

**It is never automatically reversed.** Re-arming is an operator's act, through
the arming gate, after the balance is topped up. A balance that cannot be read
(network error, a currency other than AUD, an unparseable answer) never
disarms anything; it raises its own once-a-day alert.

**Where it applies:** exactly one place — the balance probe in
`src/core/leads/balance.ts`.

**If it changes:** edit the value line in `src/core/audit/constants.ts` and the
value pin in `tests/audit-aggregate.test.ts`. It must stay below §9's floor (the
pin asserts the ordering).

## 11. `LEAD_MIN_GAP_HOURS` = `12`

**Added: 2026-10-08** (Phase 13, D-03, plan 13-05). The founder decided on 27
Sep 2026 (D-01) that a lead gets the text-back plus two follow-ups and then
closes, and that the follow-ups run on their own timings, never the quote's
(D-03). The numbers in §11–§13 were proposed by the phase research (13-RESEARCH
Q2), reasoned against the schedule rather than measured, and adopted by the
plan. They live in `src/core/leads/constants.ts`, not in
`src/core/audit/constants.ts` — they are cadence timings, not figures a
prospect or an invoice quotes — and the same "no change without the pin edit"
rule applies.

**What it is:** the minimum gap between two follow-ups to the same caller on a
lead. A touch that would land closer than this to the next one is skipped
(`min_gap`) and the next touch carries. The quote's value is 48 hours and is
unchanged.

**Rationale for twelve:** touches 2 and 3 are one calendar day apart at the
client's preferred send time. A touch 2 that slipped and would now land on the
same morning as touch 3 must be skipped: one message that morning, not two.
Twelve hours is half the designed spacing, and the largest value that never
skips a touch 2 that is merely late within its own day. Approved at 16:00, it
still sends today. Approved at 17:30, it would land on touch 3's slot tomorrow,
so it is skipped and touch 3 carries. Twenty-four or more would skip touch 2
even when it reschedules to a free morning. The quote's 48 would retire every
slipped touch 2 outright, which is why the lead needed its own value.

**Where it applies:** exactly one place. `LEAD_POLICY` in
`src/core/cadence/policy.ts` carries it into `rewindowTouch`
(`src/core/cadence/rewindow.ts`), chosen by the cadence's kind in the tick
(`policyFor(kind)` in `src/core/cadence/run-tick.ts`).

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
value pin in `tests/cadence-policy.test.ts`
(`expect([LEAD_MIN_GAP_HOURS, LEAD_STALENESS_CAP_HOURS, LEAD_EXPIRY_DAYS]).toEqual([12, 24, 7])`),
then re-read that suite's boundary cases.

## 12. `LEAD_STALENESS_CAP_HOURS` = `24`

**Added: 2026-10-08** (Phase 13, D-03; see §11 for who decided what).

**What it is:** how late, past its slot, a lead follow-up may still be sent.
Past it, the touch is skipped `stale` and the cadence carries on. The quote's
value is 72 hours and is unchanged.

**Rationale for twenty-four:** yesterday's follow-up still reads as a
follow-up. Two days late on a promise of "about 48 hours" reads as nobody
watching. Exactly 24 hours late is still sendable (at-the-boundary-is-inside,
the rewindow rule). A touch 3 nobody approved for a day is skipped, the cadence
completes, and the lead closes `touches_exhausted`. Nothing is sent to a caller
from a queue nobody was watching.

**Where it applies:** exactly one place. `LEAD_POLICY` in
`src/core/cadence/policy.ts`, read by `rewindowTouch`.

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
triple pin in `tests/cadence-policy.test.ts` (§11).

## 13. `LEAD_EXPIRY_DAYS` = `7`

**Added: 2026-10-08** (Phase 13, D-03 and D-15; see §11 for who decided what).

**What it is:** the age, in days from the missed call, at which a lead's
follow-up cadence expires and the lead closes `expired`. The quote's value is
42 days and is unchanged.

**Rationale for seven, and why not four:** take a Friday 14:00 call before a
long weekend, where Monday is a public holiday the client does not work. Touch
2 rolls to Tuesday and touch 3 to Wednesday, about 4.8 days after the call.
Add the 24-hour staleness slack (§12) and it is 5.8 days. Expiry is judged
before anything else, so four would expire that lead before touch 3 could ever
send. Seven covers the long weekend and still bounds a lead to one week. A lead
whose approvals never came expires on the first tick of day 8 (D-15).

**Where it applies:** exactly one place. `LEAD_POLICY` in
`src/core/cadence/policy.ts`, read by `rewindowTouch` and by the tick's expiry
pass for lead cadences (`src/core/cadence/run-tick.ts`), which closes the lead
through `closeLead` (`src/core/leads/close.ts`).

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
triple pin in `tests/cadence-policy.test.ts` (§11).

## 14. `LEAD_NEGATIVE_COOL_OFF_DAYS` = `90`

**Added: 2026-10-08** (Phase 13, D-12 — founder decision 8 Oct 2026).

**What it is:** how long a caller is not texted again by a client after their
newest lead at that client closed **negatively**. Negative means
`not_a_lead`, `spam`, `complaint` or `opt_out`. The missed call is recorded as
skipped with reason `recent_negative_close`, and nothing is sent.

**Rationale for ninety:** a wrong number, a robocaller, an unhappy customer or
someone who asked to be left alone should not get "sorry we missed your call"
every time they ring in the next quarter. Ninety days is the founder's number
(D-12), not a measured one. Every other
close (`touches_exhausted`, `expired`, or a label that kept the conversation
alive) lets a fresh call open a new lead and send a new text-back.

**`opt_out` is not bounded by this window.** A caller who opted out stays
suppressed for good through the suppression table. The ninety days is a second,
shorter fence for the three negative closes that are not opt-outs.

**Boundary:** measured from the lead's `closed_at`. A call exactly ninety days
after the close is still refused (at-the-boundary-is-inside).

**Where it applies:** exactly one place. The `recent_negative_close` rule of
`decideTextBack` in `src/core/leads/gate.ts`, inserted after `suppressed` and
before `recent_text`. The fact it reads is the caller's newest lead at the
client, read in `src/core/leads/text-back.ts`.

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
value pins in `tests/text-back-gate.test.ts`
(`expect(LEAD_NEGATIVE_COOL_OFF_DAYS).toBe(90)`) and `tests/lead-close.test.ts`
(the same line; DB-backed, runs at the CI gate).

## 15. `RING_TWICE_WINDOW_MINUTES` = `30` and `URGENT_KEYWORDS`

**Added: 2026-10-08** (Phase 13, D-06 and D-07 — founder decisions 27 Sep and
8 Oct 2026; final keyword list from 13-RESEARCH Q6 and Open Question 4).

These are the two model-free ways a lead becomes **hot**, meaning it is texted
to the client's escalation phone. Both are recorded together because both are
fixed rules a human chose, not a model's judgement.

### Ring twice

**What it is:** a second missed call from the same caller at the same client,
starting within thirty minutes of the first, while that caller's lead is open.
The tradie's escalation phone is texted once. The caller gets no second text:
the Phase 12 `recent_text` and `lead_open` skips stand, and only the escalation
is new.

**Rationale for thirty:** someone who rings, is missed, and rings again within
half an hour is telling the tradie it matters (D-07). Thirty minutes is the
decision's number, not a measured one. A single missed call never texts the
tradie.

**Where it applies:** exactly one place. The ring-twice escalation pass (plan
13-06) passes it as `windowMs` to `listUnescalatedRingTwiceCalls` in
`src/db/repository/escalations.ts`, which compares the two calls inside the
database. The caller's number is never selected.

**If it changes:** edit the value line in `src/core/leads/constants.ts`. No
pure value pin exists yet. `tests/lead-close.test.ts` (DB-backed) derives its
window from the constant, and plan 13-06's ring-twice suite pins the boundary.

### The urgent keywords

**The list, in order:** `urgent`, `emergency`, `burst`, `flooding`, `flooded`,
`gas leak`, `smell gas`, `no power`, `locked out`, `sparking`.

**The rule:** a reply to a lead that contains any of these, as a whole word or
phrase, is hot at once, without waiting for the model. Matching is
case-insensitive, and a phrase tolerates any whitespace between its words. The
reply is still classified afterwards for its label; the hot decision does not
wait for it. STOP runs first: a STOP reply never reaches this rule.

**Phrases, not bare words, where a bare word would misfire:**

- `no power`, not `no`, so "no worries" is cold.
- `gas leak` and `smell gas`, not `gas`, so "gas hot water quote" is cold.
- `sparking`, not `spark`, so "sparky" and "spark plug" are cold.

**Deliberately absent:**

- "no hot water". For most trades that is a quote, not an emergency.
- "urgently". The whole-word rule means `urgent` does not match it. Add it to
  the list if the founder wants it.

**There is no negation guard, by decision.** "not urgent" and "it's not an
emergency" match. The cost is one extra text to the tradie, after which the
model's `flexible` urgency sits on the row. A guard that tried to read
negation would sooner or later miss a real emergency phrased oddly. The other
known false positives, "burst out laughing" and "stop flooding me with texts",
are implausible or harmless: a complaint is hot under D-07 anyway.

**When it sends, day or night:** an urgent-keyword reply, and a reply the model
marks emergency, are texted to the escalation phone at once whatever the hour,
and whether or not the client's after-hours switch is on (D-09). The switch
only decides whether other hot leads outside contact hours are texted now or
held until the window opens.

**Where it applies:** exactly one place. `isUrgentKeyword` in
`src/core/leads/urgency-keywords.ts`, called at the inbound door for a reply
threaded to a live lead. It sets `keyword_hot` on the reply, never `is_hot`.

**If it changes:** edit the list in `src/core/leads/constants.ts` and the
ordered list pin in `tests/urgency-keywords.test.ts`, then add a hot case and a
cold near-miss for the new word to the same suite.

## 16. `LEAD_JOB_MATCH_WINDOW_DAYS` = `14`

**Added: 2026-10-10** (Phase 14, D-07, plan 14-04). The founder decided on 10
Oct 2026 that a lead the tradie books himself in ServiceM8 resolves on its own,
without anyone tapping anything, and that fourteen days after the call is the
window. Fourteen is the decision's number, not a measured one. Like §11–§15 it
lives in `src/core/leads/constants.ts`, and the same "no change without the pin
edit" rule applies.

**What it is:** how many days after a missed call a ServiceM8 job carrying the
caller's mobile still counts as the tradie's own booking of that lead. On every
sync cycle, an open lead whose caller appears on a job dated within this window
— on the job's own contact, or on the client record's contact — is closed
`converted`, reason `booked_by_tradie`, with the job recorded against it.

**Rationale for fourteen:** a quote job a tradie raises within two weeks of a
missed call from that number is that caller's booking: he rang back the next
week and booked a visit for the week after. Past two weeks, a job for the same
number is more likely a new enquiry than this one. The window is measured on
calendar dates in the client's own zone, and the job dated exactly fourteen
days after the call is still inside (at-the-boundary-is-inside). A lead
resolved this way is counted in leads-to-jobs and **never** in attributed
recovered dollars: the tradie booked it, and the report says so.

**The sibling cap, `LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE` = `10`:** a job the
tradie raised straight from a client record carries no job contact, so its
mobile is found only on the client's company contact, one ServiceM8 read per
company. The match spends at most ten such reads per client per five-minute
cycle (D-12's budget), far inside ServiceM8's 180 requests a minute and 20,000
a day at this volume. A client with no open lead spends none, and candidates
past the cap wait for the next cycle.

**Inside the tick's budget (14-REVIEW WR-06):** these reads run after the
sync cycle has committed, so they carry a deadline of their own — the sync
tick's deadline less `LEAD_JOB_MATCH_PASS_MARGIN_MS` (`10_000`) — and each one
waits at most `LEAD_JOB_MATCH_READ_TIMEOUT_MS` (`5_000`), never past that
deadline. Reads left when the deadline passes are skipped, counted and logged
(`tick_deadline`), and their leads wait for the next cycle. Both are mechanism,
not commercial assumptions; they live beside the cap in
`src/core/leads/constants.ts`.

**Where it applies:** exactly one place. The tradie-booked pass on the sync
(`resolveLeadsBookedByTradie` in `src/core/leads/booked-by-tradie.ts`) builds
each lead's window through `matchWindowFor` in `src/core/leads/job-match.ts`,
and spends the company reads under the cap in the same pass.

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
boundary pins in `tests/lead-job-match.test.ts` (a job dated D+14 matches, D+15
does not) and `tests/lead-booked-by-tradie.test.ts` (DB-backed, runs at the CI
gate). The cap has no value pin of its own; the same two suites exercise it.

## 17. `DONE_LOOKBACK_HOURS` = `48`

**Added: 2026-10-10** (Phase 14, D-08, plan 14-04). The founder decided on 10
Oct 2026 that the tradie can close a lead himself by replying `DONE` from his
own phone, and that the reply answers the alert most recently sent to that
phone within the last two days. Forty-eight hours is the decision's number.

**What it is:** how far back, in hours, a tradie's `DONE` looks for the hot-lead
alert it answers. A `DONE` (a whole word, any case, anywhere in the reply) from
the client's escalation phone or from any line on the client's never-text list
closes the lead whose alert was most recently sent to that number inside this
window, with the reason `closed_by_tradie`. Nobody is texted back. A `DONE`
with no such alert closes nothing: the reply waits in the inbox and the
operator gets one email naming the client.

**Rationale for forty-eight:** two days is how long a `DONE` can still be about
the alert it answers — the tradie read the text that evening, or the next
morning, or after a weekend job. An alert sent exactly forty-eight hours
before is still inside (at-the-boundary-is-inside). One hour more is an
operator question, not a guess: closing the wrong lead silently is worse than
asking, so an older `DONE` emails the operator instead of acting.

**Where it applies:** exactly one place. The inbound door's `DONE` branch
(`handleTradieDone` in `src/core/leads/done-keyword.ts`) passes it to
`latestSentLeadEscalationTo` in `src/db/repository/escalations.ts`. The
operator email's sentence reads the same constant.

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
boundary pins in `tests/lead-done-keyword.test.ts` (47 h and 48 h close, 49 h
alerts; DB-backed, runs at the CI gate). `tests/done-keyword.test.ts` reads
the constant for the window it asserts and for the email's wording.

## 18. `LEAD_JOB_CLAIM_STALE_MINUTES` = `15`

**Added: 2026-10-10** (Phase 14, plan 14-03). Proposed by the executor when
14-02's tracer review found that a lead can be left in `creating` with no way
back, and adopted by the orchestrator for this plan. It was written before
§16–§17 (`LEAD_JOB_MATCH_WINDOW_DAYS` and `DONE_LOOKBACK_HOURS`, plan 14-04),
whose numbers had been reserved for them.

**What it is:** how long a lead may stay in the job-creation state `creating`
before the system treats the attempt as abandoned. On every five-minute sync
cycle, a lead that has been `creating` for longer than this is moved to
`failed`, with the reason recorded as `stale_claim`. The operator's Retry
then reappears on the inbox row.

**Rationale for fifteen:** the operator's tap claims the lead and releases it
in the same request. It ends as `created` on success or `failed` with a reason
on any failure. A lead stays `creating` only when that request died partway
through, for example from a platform timeout or a redeploy, and nothing else
ever releases it. A create is a handful of ServiceM8 calls, and the console's
functions run for minutes at most. So a claim fifteen minutes old has no
request behind it, and releasing it is safe. A retry never duplicates: it
first looks for anything the dead attempt created in ServiceM8 and reuses it.
Exactly fifteen minutes is still live; only strictly older is released.

**Where it applies:** exactly one place. The tradie-booked pass on the sync
(`resolveLeadsBookedByTradie` in `src/core/leads/booked-by-tradie.ts`)
releases abandoned claims through `staleJobClaimCutoff` in
`src/core/leads/job-match.ts` and one guarded update in the lead repository.

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
boundary pins in `tests/lead-job-match.test.ts` (15 minutes is live, one
millisecond more is stale) and `tests/lead-booked-by-tradie.test.ts`
(DB-backed, runs at the CI gate).

## 19. `LEAD_RECENT_CONVERSION_HOURS` = `24`

**Added: 2026-10** (Phase 15, plans 15-01/15-07; founder decisions D-06 and
D-08 of 11 Oct 2026). The founder decided that a caller who rings back the day
after their lead was booked is not texted "sorry we missed your call", and
that a day is the window. Twenty-four is the decision's number, not a measured
one. Like §11–§18 it lives in `src/core/leads/constants.ts`, and the same "no
change without the pin edit" rule applies.

**What it is:** how many hours after a caller's lead at a client converted
(closed `converted`, by the operator's job creation or by the tradie's own
booking) a new missed call from the same number is not texted back and opens
no new lead. The call is recorded `skipped` with the reason
`recent_conversion`, and the client page's missed-call log shows it.

**Rationale for twenty-four:** a repeat call within a day of a booking is the
tradie's conversation with a customer he already has — "ringing back about
the booking". A text-back would read as nobody knowing the job is booked, and
a fresh lead would count the same enquiry twice. Past a day, a call from the
same number is treated as a new enquiry and texted like any other. Measured
from the lead's `closed_at`; a call exactly twenty-four hours after the
conversion is still refused (at-the-boundary-is-inside, like §14).

**Where it applies:** exactly one place. Rule 7 of the text-back gate
(`recent_conversion` in `src/core/leads/gate.ts`), whose fact is assembled on
the claim transaction in `src/core/leads/text-back.ts` from the caller's
newest lead at the client.

**If it changes:** edit the value line in `src/core/leads/constants.ts` and the
boundary pins in `tests/text-back-gate.test.ts` (exactly 24 hours is inside,
one millisecond more is outside) and `tests/text-back-recent-conversion.test.ts`
(DB-backed, runs at the CI gate).

## 20. `PSEUDONYMISE_AFTER_DAYS` = `90` (defined as `LEAD_NEGATIVE_COOL_OFF_DAYS`) and `PSEUDONYMISE_BATCH` = `200`

**Added: 2026-10** (Phase 15, plans 15-01/15-07; founder decisions D-06 and
D-08 of 11 Oct 2026). The founder decided on 11 Oct 2026 that a caller's
number is not kept for ever: ninety days after a lead ends without becoming a
job, the number is replaced by a code that cannot be turned back into a
number, and a customer's number is kept until their job is finished and for
ninety days after that. The public privacy notice states this in its callers
section. The founder chose the irreversible keyed hash over deletion so that
repeat-caller counts survive. Both values live in
`src/core/leads/constants.ts`.

**What it is:** `PSEUDONYMISE_AFTER_DAYS` is how many days after a lead closes
or expires without converting, or after a converted lead's mirrored job
reaches Completed or Unsuccessful, the caller's number is replaced by its
keyed hash (HMAC-SHA-256 under a server-held key) everywhere the product holds
it for that lead: the lead, its missed calls, its message rows, its lead
cadence and its send ledger rows. The words a caller sent are kept. A missed
call that opened no lead is treated the same way that many days after it
arrived. An open lead is never touched, and a STOP is kept raw for as long as
it is needed so that it keeps working. `PSEUDONYMISE_BATCH` is the most rows
of each kind (due leads, and lead-less calls) the nightly pass handles in one
run.

**Rationale for ninety:** ninety days matches the negative cool-off (§14) BY
DEFINITION — the value line is `= LEAD_NEGATIVE_COOL_OFF_DAYS`, not a second
typed-in 90. A lead is hashed only once it is at or past the end of every
window the text-back gate looks back over, so the gate never meets a hash and
compares raw numbers only. Shortening retention below the cool-off would
silently reopen it: a caller closed as spam or a complaint would be texted
again, because their old lead would no longer match their number. That is why
the two are one value. The STOP rule survives the hash because it reads the
suppression rows, which are never hashed.

**Rationale for two hundred:** two hundred rows per kind per night drains any
backlog in days at this volume (fifteen clients produce nowhere near that many
closes a night) and bounds the nightly tick's duration. Each row is its own
transaction, so one bad row fails alone, is counted, and is selected again the
next night while the rest are done.

**Where it applies:** the two due-reads (`listLeadsDueForPseudonymisation` and
`listMissedCallsDueForPseudonymisation` in `src/db/repository/leads.ts`) build
their boundary from `PSEUDONYMISE_AFTER_DAYS` and take at most
`PSEUDONYMISE_BATCH` rows; the pass (`runPseudonymisationPass` in
`src/core/leads/pseudonymise.ts`) runs both on the nightly `messaging-reconcile`
tick and writes the hashes. The privacy notice's callers section states the
period in words.

**If it changes:** edit the value line in `src/core/leads/constants.ts`, and
with it: the boundary identity and the pass pins in
`tests/pseudonymise-structure.test.ts`; the read-back suite
`tests/pseudonymise.test.ts` (DB-backed, runs at the CI gate; its seeds sit at
89 and 91 days); the gate's cool-off pin in `tests/text-back-gate.test.ts` if
the cool-off moves with it; the privacy wording in
`src/app/(marketing)/copy.ts` and its test `tests/privacy-page.test.ts`; and
the caller-privacy step (§20) in `docs/first-client-go-live-runbook.md`. A
retention period on the public notice that the code does not keep is the worst
sentence this product could publish.

## 21. `PSEUDONYMISE_CONVERTED_MAX_DAYS` = `365`

**Added: 2026-10-15** (Phase 15 code review, 15-REVIEW WR-02). The §20 rule
keeps a customer's number until their ServiceM8 job reaches Completed or
Unsuccessful in the mirror, plus ninety days. Nothing fires that rule when the
mirror never sees a finished job: the client disconnects ServiceM8, the
tradie deletes the job (it keeps its last status), the job is abandoned as a
Work Order, or the lead never recorded a job. Without a ceiling those numbers
would be kept with no end, while the public notice states one.

**What it is:** the most days after a lead CONVERTED (its `closed_at`) that
its caller's number is kept, whatever the job's state. On that day the lead
falls due exactly as §20 describes (the lead, its calls, its messages, its
cadence and its send records), and the nightly pass hashes it.

**Rationale for a year:** most trade jobs finish within weeks, so the §20 rule
does the work and this ceiling only catches the jobs the mirror never sees
finish. A year leaves a long job (a renovation, a staged install) its full
term plus the ninety days in almost every case, and gives the notice a plain
sentence: "no later than 12 months after you booked". It MUST stay above
`PSEUDONYMISE_AFTER_DAYS` (pinned), or a customer whose job is still open
would be hashed.

**Where it applies:** the third arm of `listLeadsDueForPseudonymisation` in
`src/db/repository/leads.ts`; the privacy notice's callers section states it
in words.

**If it changes:** edit the value line in `src/core/leads/constants.ts`, and
with it: the pins in `tests/pseudonymise-structure.test.ts` and
`tests/privacy-page.test.ts`; the long-stop seed (366 days) in
`tests/pseudonymise.test.ts` (DB-backed, runs at the CI gate); the notice's
sentence in `src/app/(marketing)/copy.ts`; and the caller-privacy step (§20)
in `docs/first-client-go-live-runbook.md`.

---

**Single config location:** `src/core/audit/constants.ts` for §1–§10, and
`src/core/leads/constants.ts` for the lead timings and rules in §11–§21.
Both file headers point back at this record. No value above may be changed
without a recorded operator decision, and no value may be changed without the
matching pin edit — `tests/audit-aggregate.test.ts` for §1–§10, and the suite
each of §11–§21 names. A value edited on its own is a
figure that disagrees with its own footnote on a document handed to a
prospect.
