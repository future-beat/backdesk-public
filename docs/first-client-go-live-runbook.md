# First-client go-live runbook

The path from a signed founding agreement to the first cadence message a real
customer receives, in the order it has to happen, with the screen or the command
for every step and the artefact that proves the step actually happened. Written
to be run on a phone, in one sitting, inside the client's contact hours, by one
operator holding two handsets. Nothing here should be improvised on the day:
where a step has a trap, the trap is written down next to it, because every trap
in this document is one that already cost somebody a send.

Read it end to end **before** the window opens, not during.

---

## Before anything

- **The hosted Sydney Supabase IS production.** There is no staging database.
  Never run `npm run test:remote` in a go-live window: it takes a lease that
  pauses the deployed cron jobs the window depends on, and a paused
  `cadence-tick` means nothing sends while everything looks healthy.
- **Never run `npm run cron:apply` during the window.** Run `npm run cron:status`
  before and after anything that touches scheduling, and only read.
- **Two handsets are needed.** A *customer* handset (the mobile on the test
  job's ServiceM8 contact, which receives the follow-up and sends the reply) and
  an *escalation* handset (which receives the hot-lead alert). If the client
  prefers the operator's handset stands in for the tradie's escalation phone,
  that is fine — **record which handset played which role** in the proof note.
  Never write a handset number into a document in this repository.
- **The console proxy runs on every request** and costs one `getClaims()` call.
  Pages are a beat slower than they were before Phase 9. That is expected.
- **Nothing in this runbook needs SQL.** Every artefact is produced by the
  product's own paths or by a read-only script. If a step seems to need a manual
  database write, stop — the step is wrong.
- **Never edit `quote_contacts` to stage a test recipient.** The ServiceM8 sync
  re-upserts the boundary rows every five minutes and reverts the edit within a
  minute. Change the number in ServiceM8 itself.

---

## The window, in order

### 1. Signed founding agreement

The agreement is signed before any credential is requested. The founding-client
agreement is `docs/gtm/m3-founding-client-agreement.pdf` (source `.docx`
alongside it).

| Where | Artefact that proves it |
|---|---|
| Email/DocuSign thread with the client | Countersigned PDF filed with the client's record; its date is the start of the first monthly reporting period |

### 2. ServiceM8 private API key from the client

Ask the client to generate it in **their own** ServiceM8 account: Settings →
Integrations → API (a private key needs no OAuth approval and no developer
partner status). They paste it into the connect form; the key is encrypted at
rest and only its last four characters are ever displayed again.

| Where | Artefact that proves it |
|---|---|
| `/clients/[id]` → the ServiceM8 connection form | "Connected. Pulled N jobs…" and the checklist row **ServiceM8 connected** showing the key's last 4 |

### 3. Contact hours and escalation phone

Contact hours are AWST and bound every dispatch. The escalation phone is where
hot-lead alerts land. Whether an alert waits for contact hours depends on what
it is about:

- **A hot reply to a quote follow-up** is texted to the escalation phone at
  once, whatever the hour. It does not obey contact hours, by design.
- **A hot reply from a lead** (a missed caller who answered the text-back)
  that arrives outside contact hours is held. It is texted when the client's
  contact window next opens, unless the client's **After-hours escalation**
  switch is on, in which case it is texted at once.
- **Emergencies and URGENT replies are always texted at once,** whatever the
  hour and whichever way the switch is set. That covers a lead reply the model
  marks as an emergency, and one that contains an urgent word such as
  "urgent", "burst" or "gas leak" (the full list is
  `docs/commercial-assumptions.md` §15).
- **Ring twice.** A second missed call from the same number within 30 minutes,
  while that caller's lead is open, texts the escalation phone. The caller does
  not get a second text.

The switch is **off** by default. Decide it with the client now: on for an
emergency trade that wants to be woken, off for everyone else. Set it under
"Change after-hours escalation", directly below the escalation-phone form. Held
alerts are listed in the operator's 06:30 digest under **Leads**.

**DONE closes a lead from this phone (Phase 14).** Tell the client: when a
hot-lead alert reaches this phone and they have dealt with the caller, they
can reply `DONE`. A reply containing the word DONE, in any case, from this
phone or from any line on the client's never-text list, closes the lead whose
alert was most recently sent to that number within the last 48 hours
(`docs/commercial-assumptions.md` §17). The lead's follow-ups stop, the inbox
row shows **closed by tradie**, and nobody is texted back — not the tradie, not
the caller. A `DONE` with no such alert closes nothing: the reply waits in the
inbox and the operator gets one email, "DONE received for <client> — no lead
to close". Find the lead the tradie meant and close it, or mark the reply
handled. A `STOP` from this phone is still a `STOP`. A `DONE` from any number
that is not the client's own is an ordinary customer reply.

| Where | Artefact that proves it |
|---|---|
| `/clients/[id]` → contact-hours form, escalation-phone form and "Change after-hours escalation" | Checklist rows **Contact hours set** and **Escalation phone set**; the profile row **After-hours escalation** reads On or Off as agreed |

### 4. Voice profile and templates approved (ONB-03)

Templates must be approved against the version the client saw. Until they are,
cadences are born `paused(onboarding)` and nothing can send — which is the
safety net this step deliberately removes.

| Where | Artefact that proves it |
|---|---|
| `/clients/[id]/drafting` | Checklist rows **Voice profile set** and **Templates approved** |

### 5. ServiceM8 auto follow-up off (ONB-04)

The client turns ServiceM8's own Quote Follow Up automation **off** so their
customers are not chased twice in two voices. We cannot read this over the API
(see `docs/servicem8-api-notes.md` §ServiceM8 own-comms) — it is an operator
attestation with a date, re-asked at 30 days.

| Where | Artefact that proves it |
|---|---|
| `/clients/[id]` → the **Ready to send?** card → the attest form | Checklist row **ServiceM8 auto follow-up off** showing "Verified off — {date}" |

Why it is an attestation and not a check: ServiceM8's `sms.json` and `email.json`
are reachable under a private key but have never been observed holding a row, so
nothing can key on them. The read-only probe that measures them is
`node scripts/sm8-spike.mjs probe` — **run it against the trial account only**,
never against a client whose automation-off attestation must stay true, and
record the result in `docs/servicem8-api-notes.md`.

### 6. Email identity and sending domain

From-address on `quotes.backdesk.com.au`, reply-to the tradie's own business
email, business name as it should appear. **Saving here never arms anything** —
the form writes the identity and preserves whatever enabled state the row had.

| Where | Artefact that proves it |
|---|---|
| `/settings/email` | The **Verified** badge from Resend and the checklist row **Sending domain verified** |

### 7. ClickSend balance

The first live SMS of Phase 9 failed with `INSUFFICIENT_CREDIT` — a provider
balance problem that looked exactly like a code problem. Check it before the
window, every time.

```
npm run clicksend:balance
```

Rehearsed 2026-09-11 against the live account:
`clicksend balance: 0.029806 AUD (low-credit threshold 0.50, auto-recharge on)`.
Three cents. **Auto-recharge reading "on" is not the same as funds arriving** —
top up in the ClickSend dashboard and re-run the command until the printed
balance comfortably covers the window (a segment costs ~0.079 AUD). Enabling or
raising auto-recharge is an operator choice in the dashboard, not a code change.

The operator confirmed on 2026-09-11 that ClickSend auto-recharge is switched **on** —
and the rehearsal above read three cents *with it on*. **Auto-recharge only proves
itself on a send.** So: run `npm run clicksend:balance` immediately before the CON-03
window and, if the printed balance is still under the low-credit threshold, **top up
manually rather than trusting the setting**. Discovering that auto-recharge did not
fire costs the live proof its first send.

| Where | Artefact that proves it |
|---|---|
| `npm run clicksend:balance` | The one balance line, quoted into the day's evidence entry |

### 8. ClickSend Opt-Out List

ClickSend refuses a send to a number on the account-level Opt-Out List, and the
operator's own handset texted STOP during the Phase 4 live proof on 2026-08-30 —
so it is on that list. If either handset in play is listed, remove it first, or
the escalation SMS will be refused by the provider and the CON-03 proof will
fail for a reason that has nothing to do with the product.

| Where | Artefact that proves it |
|---|---|
| ClickSend dashboard → Opt-Out List | A dated line in `docs/external-registrations.md` recording which handset was checked and whether it was removed (never the number itself) |

### 9. Cron sanity

```
npm run cron:status
```

Expect four jobs, all `active=t`, all pointed at `https://app.backdesk.com.au`,
plus `remote_test_lease rows: 0` and `remote-test-watchdog scheduled: no`.
Rehearsed 2026-09-11: `sm8-sync-tick */5 * * * *`, `cadence-tick * * * * *`,
`messaging-reconcile 30 19 * * *`, `stalled-digest 30 22 * * *`, with the last
five `net._http_response` rows all `200`. A lease row above zero means a remote
test suite is (or died) holding the crons paused — resolve that before arming.
Read only: **no `cron:apply` during the window.**

| Where | Artefact that proves it |
|---|---|
| `npm run cron:status` | The four job lines and `remote_test_lease rows: 0`, quoted into the evidence entry |

### 10. Keep the test tenant off

Arming SMS writes the **shared** row, and the shared row sends for every
connected client on the next tick. The test tenant
`13e8f2aa-edee-4eb1-b699-09b650674f81` ("Perth Sparks Electrical (Test)") is
connected to a live ServiceM8 trial account holding eligible quotes. Write its
explicit OFF override **before** arming: a tenant row beats the shared row.

| Where | Artefact that proves it |
|---|---|
| `/clients/13e8f2aa-edee-4eb1-b699-09b650674f81` → **Turn SMS off for this client only**, reason `test tenant — keep off` | That client's **SMS armed** row reads off (override) and a `messaging_config_audit` line records it |

### 11. Arm SMS

On the founding client's page, tap **Arm SMS for every client**. Read the
warning between the two taps: it names every client this arms, by name. **Only
the founding client should be listed.** If another name appears, stop, write
that client's override (step 10), and come back.

| Where | Artefact that proves it |
|---|---|
| `/clients/[id]` → **Ready to send?** → **Arm SMS for every client** → confirm | Audit line + checklist row **SMS armed**; the card's SMS state moves to "Armed, not yet proven" |

Disarm is always one tap away: **Turn SMS off for this client only** for one
client, **Turn SMS off for every client** to stop everything.
**Turn SMS back on for this client** lifts an override without touching anybody
else.

### 12. CON-03 proof — the escalation handset

The sequence, entirely through product paths:

1. In the client's ServiceM8, a real job whose contact carries the **customer
   handset** as its mobile and an **operator-controlled inbox** as its email.
   Wait for the 5-minute sync to mirror it.
2. Mark it chase-eligible on `/clients/[id]` → the cadence is created active and
   touch 1 is drafted.
3. Approve touch 1 in `/queue`.
4. Inside the client's contact window the next tick sends it from
   `+61491579212`. The ledger row reads `sent`; the delivery receipt follows in
   seconds.
5. Reply from the customer handset **unambiguously** — "Yes please, go ahead —
   when can you start?". Only a high-confidence `interested`/`question` is hot;
   a hedged reply is recorded and triaged and never escalates.
6. The escalation handset buzzes within about two ticks. A second hot reply on
   the same cadence within 30 minutes records `cooldown_suppressed`, not a
   second SMS — one reply per proof.
7. Read the row id:

```
npm run escalations:recent -- --tenant <tenant-uuid>
```

   Look for `outcome=sent` with a provider message id. Copy the row **id** (a
   uuid) — not the ClickSend message id.
8. Record it: **Record proof** under the escalation row, paste the uuid and a
   note saying which handset played the escalation phone. The action re-reads
   the row live and refuses anything that is not `sent` with a provider id.

| Where | Artefact that proves it |
|---|---|
| `/queue`, then `npm run escalations:recent -- --tenant <id>`, then **Record proof** | The `escalations` row (`outcome=sent`, `provider_message_id`), checklist row **Escalation handset proof recorded**, and the card reading **SMS: Live** |

Close the conversation honestly afterwards: the cadence is paused on the reply —
stop it from the console (`operator_closed`) so the customer handset is not
chased again.

### 13. Arm email

| Where | Artefact that proves it |
|---|---|
| `/clients/[id]` → **Ready to send?** → **Arm email** → confirm | Audit line + checklist row **Email armed** |

Email arming covers this client's **sending identity**, which the pipe proof
uses. Cadence follow-ups in v1 send by SMS only — no real cadence will send a
customer email. Say that to the client so nobody expects email follow-ups.
**Turn email off** reverses it and leaves SMS alone.

### 14. MSG-02 proof — the email pipe

```
npm run verify:email-pipe -- --tenant <tenant-uuid> --to <operator inbox> --cadence <the CON-03 cadence uuid>
```

It sends ONE real email through the real `TouchSender` from the tenant's
verified identity, prints the Resend id, the exact headers and a ready-made
one-click POST command. Then:

1. Poll delivery until it reads delivered:

```
npm run resend:email-status -- <resend-email-id>
```

   (exit 0 = `last_event=delivered`, exit 2 = not yet, exit 1 = the read broke).
2. Open the email in a real mail client: From shows the business name *via
   Backdesk* on `quotes.backdesk.com.au`, Reply-To is the tradie, the identity
   footer is there, and the headers carry `List-Unsubscribe` and
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
3. Run the printed one-click POST → expect `200`.
4. Confirm the click actually suppressed:

```
npm run cadence:status -- --cadence <cadence-uuid>
```

   Expect suppressed `sms=yes`, `email=yes`, cadence status `stopped`.
5. **Record proof** under the email row with the Resend id (not a uuid — the
   Resend id is the artefact here).

**Without `--cadence`, the unsubscribe link mints over a random id, resolves to
`no_cadence` and suppresses nothing.** That is deliberate protection for real
customers — but it also means the proof proves less. Use `--cadence` only with a
cadence you created to be unsubscribed, on a contact you control.

| Where | Artefact that proves it |
|---|---|
| `npm run verify:email-pipe`, `npm run resend:email-status`, `npm run cadence:status`, then **Record proof** | Resend id with `last_event=delivered`, the observed headers, the 200 from the one-click POST, checklist row **Email pipe proof recorded**, and the card reading **Email: Live** |

### 15. Live

The **Ready to send?** card now reads **SMS: Live** and **Email: Live** — the
card renders each channel as a row with a badge holding one of "Not armed",
"Armed, not yet proven" or "Live", and both must read `Live`. "Armed" means real
messages can leave and nobody has watched one arrive; "Live" means a human
watched one arrive. The distinction is the whole point of the two proof rows.

| Where | Artefact that proves it |
|---|---|
| `/clients/[id]` → **Ready to send?** | Both channel rows reading **Live**, with the eleven checklist rows green |

### 16. First cadence send observed

The first real customer follow-up. Approve it deliberately and watch it land.

| Where | Artefact that proves it |
|---|---|
| `/queue` → approve → `/clients/[id]/quotes/[quoteId]` | Send-ledger row `sent` plus the delivery badge on the conversation |

### 17. Week-1 watch

- The **06:30 digest email** each morning — stalled drafts, opt-out drift, a
  wedged sync cursor. **Silence means nothing is waiting on you**: the digest is
  deliberately not sent when there is nothing to report.
- `/reports` for the opt-out rate. A climbing opt-out rate is the earliest
  signal that the voice or the cadence is wrong.
- `npm run escalations:recent` for hot leads the client may not have actioned.
- Disarming is always one tap with a reason: **Turn SMS off for this client
  only**, or **Turn SMS off for every client** to stop the whole cohort.

| Where | Artefact that proves it |
|---|---|
| Inbox, `/reports`, `npm run escalations:recent` | Daily note in the client's record; any disarm carries its reason into the audit trail |

### 18. Housekeeping (carried from Phases 8 and 9)

Do these once; they are not per-client, but the first go-live is when they stop
being harmless.

- **Decline the two UAT audit requests.** `/audits/requests` → set each of the
  two test rows to `declined` so the real intake list is honest.
- **Supabase Auth URL Configuration.** Supabase dashboard → Authentication →
  **URL Configuration**: Site URL `https://app.backdesk.com.au`, Redirect URLs
  `http://localhost:3000/**`. Today only the localhost default exists, which
  means a password-reset or confirm link would point at a developer's laptop.
  Record the date it was set in `docs/external-registrations.md`.
- **`RESEND_API_KEY` must be the Full access key** both locally and in Vercel.
  A Sending-access key answers `restricted_api_key` to domain management, and
  the drift between `.env.local` and the deployment is a real historical bug —
  the email pipe proof runs locally against the same key the deployment uses.
- **Confirm the alert From header (D-12).** The first real operator alert email
  of this phase must read `Backdesk <alerts@quotes.backdesk.com.au>`. This was
  event-gated out of the Phase 8 UAT; the first alert closes it. Record the date
  and the observed header.

| Where | Artefact that proves it |
|---|---|
| `/audits/requests`; Supabase dashboard; Vercel env; the first alert email | Both rows showing `declined`; a dated `docs/external-registrations.md` entry for the Auth URL config and the observed alert From header |

### 19. Creating the ServiceM8 job from a lead (Phase 14)

Not part of the go-live window: this is what to do once leads are arriving.
When a missed caller has replied and wants the work, the operator turns the
lead into a Quote job in the client's ServiceM8 with one tap.

- **The control.** In the inbox, the row of any open lead with a reply carries
  **Create ServiceM8 job**. Tapping it opens a confirm sheet; nothing is written
  until the sheet is confirmed.
- **The sheet shows exactly what will be written:** the caller's words
  verbatim, the client name in ServiceM8 (prefilled from the cadence's contact
  name — edit it before confirming), first and last name, an optional suburb,
  the urgency line, and the note "Created by Backdesk from a missed call on
  <date> at <time>" (the call's local date and time, to the minute). The caller's mobile goes on the job contact.
- **Create before marking the reply handled.** A handled row leaves the inbox,
  and the control goes with it.
- **One job per lead.** A second tap is refused ("A ServiceM8 job already
  exists for this lead").
- **A failure** shows the ServiceM8 error kind on the row and the button reads
  **Retry ServiceM8 job**. A retry reuses anything the failed attempt already
  created in ServiceM8 — it never makes a duplicate client or job.
- **The job lands in the client's Needs review list** and is never chased
  automatically. Once the tradie has actually quoted it, review it like any
  other quote. The row shows **job created** with the job's status.
- **Booked by the tradie, by itself.** A lead whose caller appears on a
  ServiceM8 job dated within 14 days of the call
  (`docs/commercial-assumptions.md` §16) converts on the next sync without
  anyone tapping anything. The inbox row reads **booked by tradie**.
- **Counting.** Both kinds are counted in leads-to-jobs and never as attributed
  recovered dollars. The 06:30 digest's **Leads** section carries one line per
  client for ServiceM8 jobs created from leads and one for leads booked by the
  tradie in the last 24 hours.

| Where | Artefact that proves it |
|---|---|
| `/inbox` → **Create ServiceM8 job** on the lead's row → confirm | The row's **job created** chip with the job status; the job in the client's ServiceM8 and in their **Needs review** list |
| The next sync after the tradie books the caller himself | The row's **booked by tradie** chip; the digest's booked-by-the-tradie line the next morning |

### 20. Caller privacy — the nightly pseudonymisation pass (Phase 15)

Not part of the go-live window either: this is the retention promise the
privacy notice makes to every caller, and the job that keeps it.

- **What runs, and when.** One more pass on the existing 03:30 AWST
  `messaging-reconcile` tick, after the messaging and call-log sweeps. There
  is no new cron job and nothing to apply: **no `cron:apply`** for this step.
- **What it replaces.** Ninety days after a lead closes or expires without
  becoming a job, the caller's number on the lead, on its missed calls, on its
  messages, on its follow-up cadence and on its send records is replaced with
  a keyed code that cannot be turned back into a number. That includes a
  late reply from the same number that we could not match to a live
  follow-up (the "thanks, all sorted" after the lead closed), because it
  never threads to the lead. The same happens to a missed call that opened no
  lead, ninety days after it arrived.
- **What it keeps.** The words a caller sent stay with the client's records.
  A STOP is never touched: the do-not-message list keeps the number for as
  long as it is needed so that it keeps working, and a hashed caller who
  texted STOP is still refused. An open lead is never touched.
- **When rows fall due.** Ninety days after a non-converting close; for a
  customer, ninety days after their ServiceM8 job reaches Completed or
  Unsuccessful, and in any case a year after they booked even if the job
  never shows as finished (a disconnected or deleted job); for a lead-less
  call, ninety days after arrival (`docs/commercial-assumptions.md` §20 and
  §21). The first rows
  to fall due in production are the founder's own Phase 11 verification-call
  rows, in early January 2027 — expected, not a fault. Before then every
  night counts zero.
- **How to read what it did.** `npm run cron:status` shows the 03:30
  dispatch answered `200`. The tick's response body (pg_net keeps it beside
  the status code) carries ten counts by name, all starting
  `pseudonymise…`: leads closed, leads converted, missed calls with a lead,
  missed calls with no lead, message rows, late replies with no lead
  (`pseudonymisedInboundRowsNoLead`), cadence rows, ledger rows,
  `pseudonymiseFailed` and `pseudonymisePassFailed`. The Vercel function log
  for the route carries the same counts as fixed `[pseudonymise] …` lines.
  Counts only: no number, no code and no id is ever logged.
- **When it reports a failure.** `pseudonymisePassFailed=true` or
  `pseudonymiseFailed` above zero is a next-morning check: the rows it could
  not do stay as they were and are tried again the next night. It is never a
  data repair by SQL — a hand-written update to these columns is exactly how a
  number ends up half-replaced.
  The same body carries `messagingFailed`: `true` means the messaging sweep
  that runs first on the tick threw. The tick still answers `200` and the
  call-log sweep and this pass still ran; the cause is in the Vercel log line
  `[messaging-reconcile] messaging pass failed` and is a next-morning check.
- **The key.** `CALLER_PSEUDONYM_PEPPER` is a production secret on Vercel
  Production and Preview. Check that it is PRESENT with
  `vercel env ls production` — that lists names only. Never `vercel env pull`
  it into a file, and never paste its value anywhere, this runbook included
  (`docs/external-registrations.md` records it without a value). Rotating it
  changes every code written afterwards, so a caller from before and after a
  rotation stops looking like the same caller. A rotation is a recorded
  decision, never routine.
- **What the client is told.** The privacy notice's callers section — read
  them the retention paragraph during divert onboarding
  (`docs/client-divert-onboarding-runbook.md` §0.4): ninety days, the longer
  keep for customers, STOP kept so it keeps working, and the right to ask
  sooner.

| Where | Artefact that proves it |
|---|---|
| `npm run cron:status` on the morning after a tick | The `messaging-reconcile` dispatch answered `200`; the response body's nine `pseudonymise…` counts, with `pseudonymisePassFailed` false |
| `vercel env ls production` | The name `CALLER_PSEUDONYM_PEPPER` listed — the name only, never the value |

---

## What each proof is and is not

**The escalation proof (CON-03)** proves the whole SMS loop end to end: a real
customer-shaped message left the dedicated number, a real reply threaded back to
the right cadence, the classifier called it hot, and a human's handset buzzed.
It does not prove anything about the client's *own* customers' willingness to
reply — that is the week-1 watch.

**The email proof (MSG-02 / DOM-04)** proves send from the verified identity,
delivery (`last_event=delivered`), the From/Reply-To/footer/RFC 8058 headers as
a real mail client renders them, and a live one-click unsubscribe POST that
suppresses both channels for an operator-controlled contact. It does **not**
prove an inbound email path, because **there is no inbound email path by
design**: replies go to the tradie's own mailbox (reply-to), which is the
decision the whole email channel is built around. Inbound email is a v1.2
candidate, not a gap in this proof. Nor is there a send-ledger row for the proof
email — the script bypasses dispatch deliberately, so the Resend id is the
artefact.

**Neither proof gates arming.** Arming is gated on the onboarding rows; the
proofs gate the word *Live*. A channel can be armed and unproven — that state
has its own label, and it is not a state to leave a client in overnight.

### Divert rows (v1.2, Phase 11)

The "Ready to send?" card now ends with two more rows, after the two proofs:
**Divert number provisioned** (a Backdesk number is bought and active for this
client — its detail is the number) and **Verification call recorded** (a real
call to the client's own line diverted to that number, was captured, and its
`missed_calls` id was recorded as a proof). Under the second row a muted line
reads the last diverted call's date in the client's zone and how many days ago
it was, or "No diverted call yet."

**Neither divert row gates SMS or email arming**, and nothing in this runbook's
window depends on them. They are the facts the missed-call text-back gate reads
in Phase 12. Provisioning the number, placing the verification call and the
live divert spike are in `docs/telephony-runbook.md`, not here.

---

## Evidence entry template

Append to `docs/external-registrations.md` on the day, under a dated heading.
Ids, outcomes, timestamps, hostnames and dates only — **never** a phone number, a
customer name, an email address, a message body or any credential value.

```markdown
## 2026-09-DD — First client go-live: <client business name>

Tenant: <tenant uuid>
Pre-arm: clicksend balance <line as printed>; cron:status four jobs active, remote_test_lease rows: 0;
         ClickSend Opt-Out List checked for both handsets (<removed | not listed>)
Test tenant 13e8f2aa override written at <time> (audit id <uuid>)
SMS armed at <time> (audit id <uuid>) — warning listed <n> client(s)
CON-03: cadence <uuid>, ledger <uuid> outcome sent, escalation <uuid> outcome sent,
        provider id <id>, escalation handset = <operator | client>
Email armed at <time> (audit id <uuid>)
MSG-02: resend id <id>, last_event delivered at <time>, one-click POST 200,
        cadence:status suppressed sms=yes email=yes, status stopped
Live: both channels Live at <time>
Housekeeping: audit_requests <uuid>, <uuid> set declined; Supabase Auth URL Configuration set;
              first operator alert From header observed <date>

Identifiers, outcomes and dates only. No credential value of any kind appears above.
```
