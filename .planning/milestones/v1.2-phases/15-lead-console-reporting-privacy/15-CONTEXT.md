---
phase: 15
phase_name: Lead Console, Reporting & Privacy
milestone: v1.2
created: 2026-10-11
source: founder decisions 27 Sep + 11 Oct 2026; .planning/research/{FEATURES §8 metrics, PITFALLS §7.1 §7.2 §7.3, SUMMARY}; ROADMAP.md Phase 15 (planning note); Phase 12 D-11 (callers section shipped), Phase 13/14 outcomes (inbox lead rows, create-job sheet, DONE, converted reasons, 14-REVIEW WR-02 limitation, research OQ4 `recent_conversion`)
---

# Phase 15 Context — Lead Console, Reporting & Privacy

## Goal
The operator works leads and sees every missed call from a phone; the monthly report and `/reports` instrumentation carry Backdesk's first-party missed-call figures with honest denominators; a design-partner CSV replaces vendor statistics in the sales deck; callers are covered by a reviewed privacy notice and a retention job.

## Decisions (locked)

<decisions>
- **D-01 A new `/leads` page is the lead queue (founder 11 Oct 2026, CON-05):** cross-client, every OPEN lead whether or not it has replied, sorted by the next touch's due time (then by call time), in the approval queue's card shape: caller mobile (operator-only, as the inbox shows it), when they rang (tenant zone), after-hours flag, latest classified reply with label words + urgency, and the next action — approve touch (deep link into `/queue`), create job (the Phase 14 sheet, reused), close (reason `operator`). Usable on a phone; one extra console nav item; the existing `/queue` and `/inbox` are unchanged except links.
- **D-02 Per-client missed-call log on the client page (CON-06):** every diverted call for the client — arrived at, caller kind (mobile / other / withheld; the number only for mobiles, masked as the inbox does), after-hours flag, text-back outcome (sent / delivered / failed / skipped + skip reason / stale), the lead it opened (link to `/leads`) or the quote it attached to — paginated newest first; plus the client page's divert number, template set (attested versions) and text-back arming state, already partly present from Phases 11–12 and completed here.
- **D-03 Report figures (RPT-04):** the frozen monthly report row gains an OPTIONAL `figures.missedCalls` block (old rows without it still parse and render unchanged — pinned by a test on a stored pre-Phase-15 row): missed calls captured with hour-of-day (tenant zone) and weekday split; after-hours share (numerator/denominator); median and P90 call-arrival→text-delivered seconds over DELIVERED text-backs (null with "no samples" when none); reply rate on a delivered denominator; leads → jobs created (our tap) → jobs won, with tradie-booked resolutions as a separate count; every rate shown with its denominator; lead-born jobs are counted, never attributed dollars (D8 stands). The first regenerate of a month creates version N+1 and keeps N. `/reports` instrumentation shows the same figures live (month to date) for the operator.
- **D-04 Design-partner CSV (RPT-05):** a console export (operator-only server action, `/reports`) producing one row per client per month of the same figures with their denominators, header row fixed and pinned, NO phone numbers, NO message bodies, NO caller identifiers of any kind (structural test greps the generator's select list and the fixed header); client names as the only identifier.
- **D-05 Privacy notice review (COMP-01 remainder):** the callers section (shipped Phase 12 D-11) is reviewed for honesty: what is captured from a diverted call, who processes it and where — Twilio (voice, US-hosted with Sydney edge), ClickSend (SMS, AU), Anthropic (drafting + classification, US processing), Resend (email), Vercel (functions, Sydney region), Supabase (DB, Sydney) — and the retention statement updated to the 90-day pseudonymisation of D-06. The first text's plain-text privacy pointer stays `backdesk.com.au/privacy` with no link sent (already enforced by the template validator; pinned). "Last updated" date bumped. Anthropic stays the direct provider; Bedrock-Sydney is a v1.3 item (founder 11 Oct 2026).
- **D-06 90-day pseudonymisation (COMP-02, founder 11 Oct 2026):** 90 days after a lead CLOSES WITHOUT CONVERTING (`closed` with any reason other than the converted reasons), its caller number on the lead, on its missed calls and on its inbound rows is replaced by a keyed hash (HMAC-SHA-256 with a server-held pepper; same input → same hash so repeat-caller, cool-off and dedupe rules keep working; nothing reads the number back); the raw Twilio evidence strings on those missed calls are replaced the same way; message bodies stay; a `pseudonymised_at` timestamp marks each row. CONVERTED leads keep the number until their job reaches a terminal status (Completed/Unsuccessful) + 90 days. Suppressions (`suppressed_contacts`) are never touched. Missed calls with no lead (withheld, skipped) are pseudonymised 90 days after arrival. The job RIDES the existing nightly `messaging-reconcile` tick (03:30 AWST) as one more pass — no new pg_cron job, no `cron:apply`; idempotent, bounded per run, counted and logged by kind; a DB-backed read-back test proves rows past the boundary are hashed, rows inside are not, suppressions untouched, and a hashed caller still trips the Phase 12 gate's repeat/cool-off rules.
- **D-07 Migration 0042 (one entry):** `pseudonymised_at` on `leads`, `missed_calls`, `inbound_messages`; the dedicated error kind for the Phase 14 unique-violation recovery (replacing the borrowed `parse_error`, with its own sheet sentence); the `recent_conversion` text-back skip reason; CHECK widenings hand-written where the original CHECK is hand-written. Push protocol as always; the founder runs `db:migrate` by hand on classifier refusal.
- **D-08 Phase 14 carry-forwards folded in (founder 11 Oct 2026):** (a) the dedicated unique-violation error kind (D-07) wired into `create-job.ts` with a pure + DB pin; (b) `recent_conversion`: a caller whose lead at this client CONVERTED within the last 24 h is skipped by the text-back gate with that reason (inserted beside `recent_text` in the D-06 order, vocabulary pin moved), so a repeat call after a booking does not open a new lead and text.
- **D-09 Digest:** the 06:30 digest's Leads section gains one line for open leads past their next-touch deadline (the queue's overdue count) — no other digest change.
- **D-10 Instrumentation honesty:** no figure is derived from vendor statistics; every rate has a denominator; S4 timing has no live sample until the first client, so the report shows "no samples" rather than a number; the design-partner CSV is empty until then.
- **D-11 Quote behaviour unchanged:** report rows for quotes, attribution, `/queue`, `/inbox` behave as before; frozen reports render byte-identically (test on a stored fixture row).
- **D-12 Founder non-code task alongside (not planned here):** client-agreement clauses — the tradie authorises the messages, Backdesk holds consent evidence; recorded in STATE as a founder todo.
</decisions>

## Scope
- In: CON-05, CON-06, RPT-04, RPT-05, COMP-01 (remainder), COMP-02; the two Phase 14 carry-forwards (D-08).
- Out: client-reported monthly call totals (true missed-call rate), booking-form template variable, inbound MMS (v2); Bedrock/identity federation (v1.3); lead dollars attribution (D8); removal of the three inert spike rows (founder's call, never by agents).

## Constraints carried
- Hosted Supabase is production; migration push protocol; never `test:remote`; `.env*` never named; classifier refuses `db:migrate` (founder runs it) and may refuse `git push`.
- Nothing has ever run live against a customer (12-09 override): zero leads, nothing armed; every live clause is event-gated on the first client; plans need no second phone and no live customer; the console pages must render well with ZERO rows (empty states) because that is what the UAT will see.
- UI hint: yes — queue/inbox card patterns, brand tokens (`src/core/brand.ts`), phone-first; no new design system.
- 13-REVIEW IN-01..11 and 14-REVIEW IN-01..09 open by design.
- GSD model policy: fable for planner/researcher/checker/verifier/ui; opus for executors.

## Deferred ideas
- Lead dollars attribution; client-reported call totals; booking-form variable; MMS; Bedrock Sydney + Vercel OIDC federation; per-client dedicated SMS numbers.
