# Client divert onboarding runbook (Phase 12, COMP-03)

For the operator sitting with ONE client, their handset in front of you, to put
their missed calls on divert to Backdesk and turn on text-back. It also covers
the holiday pause and offboarding. Run it top to bottom; do not skip a section
because the client is in a hurry.

Every step is safe to repeat. Dialling a divert code a second time replaces the
earlier setting. Turning text-back on for a client that is already on, or off
for one that is already off, changes nothing. Each step ends with a read-only
check, so if you lose your place, run the check and carry on from there.

What this repository cannot tell you: whether the divert codes and the
no-answer delay below are right for this client's carrier and plan. The
diverted verification call in section 6 is the proof, per client, every time.
The codes here are what the research recorded, not something code has checked.

Never type a real phone number or a token into this file or into the evidence
entry. Write `<divert number>`, the tenant uuid and row ids only.

---

## 0. Before anything

### 0.1 The client is signed and connected

The client has a signed agreement and their client page opens in the console
at `https://app.backdesk.com.au/clients/<tenant uuid>`.

Check: the page loads and shows the client's name.

### 0.2 Provider balances

```bash
npm run clicksend:balance
```

The balance must be at least A$20. Below A$20 the operator is alerted; below
A$5 text-back turns itself off for every client until the balance is topped up.
Twilio auto-recharge must be on in the Twilio console (Billing).

Check: the printed balance is A$20 or more, and Twilio shows auto-recharge on.

### 0.3 The divert number exists

On the client page the checklist row "Divert number provisioned" is green. If
it is not, provision it first (docs/telephony-runbook.md section 5).

Check: the row reads green and shows the number's last digits.

### 0.4 The privacy notice covers callers

`https://backdesk.com.au/privacy` has the section "If you called a business
that uses Backdesk". The text-back arm action refuses while it is missing.
Since Phase 15 that section also states the retention promise: ninety days
after a lead closes without becoming a job, the caller's number is replaced
with a code that cannot be turned back into a number (a customer's number is
kept until their job is finished and for ninety days after, and no later
than twelve months after they booked), and a STOP is
kept for as long as it is needed so that it keeps working. Read that retention
paragraph to the client with the rest of 0.5, so they can repeat it to a
caller who asks.

Check: open the page on your phone and find the heading.

### 0.5 What the client is told, and agrees to

Say these three things out loud and get a yes to each:

1. A caller whose call they miss hears a short greeting and gets one text from
   Backdesk on their behalf.
2. Their carrier voicemail no longer answers diverted calls. The no-answer
   divert takes the slot voicemail used. Callers get a text instead.
3. Their mobile plan may charge for diverted calls (section 5).

Tell them as well (Phase 14): Backdesk may create a Quote job in their
ServiceM8 from a missed-call enquiry, in their own customer's words, marked
"Created by Backdesk from a missed call", and it sits in review until they have
actually quoted it.

Check: write "client agreed: greeting, no voicemail, carrier charges" in the
evidence entry with the date.

### 0.6 Decide the after-hours switch

A caller who answers the text-back and turns out to be hot is texted to the
client's escalation phone. The client page's **After-hours escalation** switch
decides what happens outside the client's contact hours:

- **Off (the default):** the alert is held and texted when the contact window
  next opens. The operator's 06:30 digest lists it under **Leads**.
- **On:** the alert is texted at once, at any hour.

Emergencies and URGENT replies are always texted at once, whichever way it is
set.

Ask the client. Turn it on for an emergency trade that wants to be woken at
night (a plumber who takes burst pipes, an electrician who takes power
outages, a locksmith). Leave it off for everyone else.

To set it, open "Change after-hours escalation" below the escalation-phone form
on the client page, tick or untick the box, and save.

Check: the profile row "After-hours escalation" reads On or Off as agreed.

| Where | Artefact that proves it |
|---|---|
| 0.2 to 0.6 | The balance line, the provisioned row, the agreement line in the evidence entry, and the "After-hours escalation" row |

---

## 1. The never-text list (own lines first)

### 1.1 Add every line the client owns

On the client's "Text-back" page add every line the client owns as "Client's
own line": their mobile, the office line, and any second handset. Do this
before anything else on that page. A call from one of these lines must never
be texted back to the client themselves.

Check: each line appears in the list with the "Client's own line" badge.

### 1.2 Add anyone they never want texted

Ask: "Is there anyone who rings you that should never get a text from us?"
(family, a supplier, an ex customer). Add each as "Never text".

Check: the checklist row "Own numbers on the never-text list" turns green.
Adding the same number twice is refused, so repeating this step is safe.

| Where | Artefact that proves it |
|---|---|
| 1.1, 1.2 | The row "Own numbers on the never-text list" green, and the count of own lines in the evidence entry (a count, never the numbers) |

---

## 2. The three wordings (template attestation)

### 2.1 Read each wording to the client

Each of the three wordings on the "Text-back" page is pre-filled. Read each
one aloud to the client and edit it until they would say it themselves.

### 2.2 Save and attest

For each wording: "Save version", check the message says 2 segments or fewer,
then "Attest this wording" with a note of who approved it (for example
"approved by the owner, read aloud 6 Oct").

Check: the checklist row "Text-back templates attested" turns green. Saving
without attesting puts nothing in use.

| Where | Artefact that proves it |
|---|---|
| 2.2 | The row "Text-back templates attested" green, and the version numbers in the evidence entry |

---

## 3. SMS for this client

### 3.1 SMS armed

Text-back sends from the shared SMS number, so the checklist row "SMS armed"
must be green for this client before text-back can be turned on. If it is
not, follow docs/first-client-go-live-runbook.md step 11 first.

Check: the row "SMS armed" reads green on this client's page.

---

## 4. Set the diverts on the client's handset

### 4.1 Dial all three codes

On the client's handset, dial each code and press call. Use the divert number
as the console shows it; if a carrier refuses the `+61` form, retry in the
national form.

| Divert | Set | Cancel |
|---|---|---|
| No answer | `**61*<divert number>#` | `##61#` |
| Unreachable (off or no coverage) | `**62*<divert number>#` | `##62#` |
| Busy (on another call) | `**67*<divert number>#` | `##67#` |

Set all three. Only setting 61 misses the after-hours and "on the tools"
calls, which are the calls the service is sold on.

Dialling a code again replaces the earlier setting, so repeating a code is
safe.

Check: dial `*#61#` and the handset shows the no-answer divert is set to the
divert number. Take a screenshot for the client's file (do not paste the
number into the evidence entry).

### 4.2 The no-answer delay, per carrier

Some networks take a delay in seconds with the no-answer code. These are the
variants the research recorded; confirm with the verification call in
section 6, because a wrong delay either rings the client too briefly or not at
all:

| Network | No-answer code with delay |
|---|---|
| Telstra (and Boost, ALDI Mobile) | `**61*<divert number>*11#` (ring time 15 to 30 seconds) |
| Optus (and amaysim) | `**61*<divert number>**20#` (20 seconds) |
| Vodafone | `**61*<divert number>#` |

### 4.3 TRAP: the iPhone Call Forwarding switch

> **Never use iPhone Settings → Phone → Call Forwarding.** That switch is
> UNCONDITIONAL. It sends every call to the greeting before the handset rings,
> and the client's business goes quiet. Use the dial codes above, every time.
> If the switch is on, turn it off before you start.

Check: on an iPhone, Settings → Phone → Call Forwarding reads off.

| Where | Artefact that proves it |
|---|---|
| 4.1 to 4.3 | The `*#61#` result (set, yes or no), the carrier and plan name, and "Call Forwarding off" in the evidence entry |

---

## 5. Carrier charges

### 5.1 Warn the client

Diverted calls may be charged per call or per minute, depending on the
carrier and plan, and prepaid services may need credit for the divert to work
at all. With no credit on some prepaid plans the divert silently fails and the
caller hears a carrier message instead of the greeting.

Ask the client to check their first bill after this change. Record the carrier
and the plan in the evidence entry.

Check: the evidence entry names the carrier and the plan, and says the client
was warned.

---

## 6. The DIVERTED verification call

### 6.1 Ring the client's number from a second phone

From a second phone with caller ID on (not the client's handset and not one of
their own lines, no `#31#`), ring the client's OWN number and let it ring out
until it diverts. Never dial the Backdesk number directly for this step: a
direct dial proves nothing about the divert.

Listen: is the greeting clear, and is the business name said right?

### 6.2 Read the row

```bash
npm run missed-calls:recent -- --tenant <tenant uuid> --limit 5
```

The top row must show `call_status=completed`, `caller_withheld=false` and
`caller_present=true`. A row under this tenant is a call on this client's
active divert number, because the tenant is found from the number rung.

Record whether `forwarded_from_present` is true, and the carrier. These are
evidence only; nothing is routed on them.

### 6.3 Record it within 24 hours

Copy the row id. On the client page paste it into the checklist row
"Verification call recorded". The proof is refused unless the call is less
than 24 hours old when recorded, so record it straight away.

### 6.4 DO NOT ARM when the caller is missing

If `caller_present` is false, the carrier is not passing the caller's number
through the divert. **DO NOT ARM.** This client stays off text-back and you
write the carrier and plan in the evidence entry. The console refuses a
verification call that arrived without a caller number in any case.

Check: "Verification call recorded" is green with the row id.

| Where | Artefact that proves it |
|---|---|
| 6.2, 6.3 | The row id, `call_status=completed`, `caller_present=true`, `forwarded_from_present`, the carrier, and the proof recorded |

---

## 7. Turn text-back on

### 7.1 Arm

On the "Ready to send?" card tap "Turn text-back on for this client", read the
confirmation out loud to yourself, and confirm. The arm action refuses unless
every gate row is green and the privacy notice covers callers.

Turning it on twice changes nothing.

Turning it on also gives the client the default wording for a caller's two
follow-up texts (touches 2 and 3). The operator approves every one of those
texts before it goes; the wording itself is never sent as it stands.

Check: the row "Text-back armed" turns green.

---

## 8. The first live text and its proof

### 8.1 Ring again from the second phone

The second phone rings the client's number again and lets it divert. The text
arrives on the second phone.

### 8.2 Read the timing

```bash
npm run text-back:timing -- --tenant <tenant uuid> --limit 5
```

The newest line shows `text_back_status=sent` and, once the delivery receipt
lands, a delivered time. The output ends with `text_back_armed=true`.

### 8.3 Record the proof

Paste the missed call id into "Text-back proof recorded", with a note of whose
handset it arrived on and how long it took by your stopwatch.

If the second phone's call reads `skipped` with `text_back_skip_reason=own_number`,
the carrier is presenting the client's own line as the caller. Turn text-back
off for this client (section 9) with that reason, and record it.

### 8.4 The rules you will see working

- One text per caller per 24 hours.
- No text for a call more than 10 minutes old.
- At most 30 texts per client per day.
- A withheld caller, a landline, the client's own lines, anyone on the
  never-text list and anyone who replied STOP are never texted. The reason is
  on the row as `text_back_skip_reason`.
- Below A$5 of ClickSend balance, text-back turns itself off for every client.
- Touches 2 and 3 of a lead (the two follow-ups after the text-back) are
  approved in `/queue` like any quote touch. Each appears there 24 hours before
  its send slot. Touch 2's slot is the next day, so it usually appears within a
  minute of the text-back. Touch 3 appears about a day later. Nothing sends
  outside the client's contact hours: touch 2 goes the next day and touch 3 the
  day after, each at the client's usual send time.
- A second missed call from the same number within 30 minutes texts the
  client's escalation phone, not the caller.
- The tradie's DONE. A reply containing the word DONE from the client's
  escalation phone, or from any line on the never-text list, closes the lead
  most recently alerted to that number within 48 hours. Nobody is texted back.
  With no such lead, the reply waits in the inbox and the operator is emailed.
- Booked by the tradie. A lead whose caller turns up on a ServiceM8 job dated
  within 14 days of the call closes on its own at the next sync, shown as
  "booked by tradie" on the inbox row.

Check: "Text-back proof recorded" is green.

| Where | Artefact that proves it |
|---|---|
| 8.2, 8.3 | The `text-back:timing` output (it prints no number) and the proof recorded |

---

## 9. Holiday or pause

### 9.1 Turn it off with a reason

Tap "Turn text-back off for this client" with a reason such as
"holiday until 14 Jan". The greeting keeps answering and calls keep being
logged; nobody is texted. Turning it off takes effect on the next call, and
turning it off when it is already off changes nothing.

Check: `npm run text-back:timing -- --tenant <tenant uuid> --limit 1` ends with
`text_back_armed=false`.

### 9.2 Back on when they return

On the day they return, turn it back on (section 7).

---

## 10. Offboarding, in this order

Order matters: a divert left on a handset after the service stops sends that
business's callers to a greeting nobody answers.

### 10.1 Turn text-back off

"Turn text-back off for this client" with the reason "offboarding".

Check: `npm run text-back:timing -- --tenant <tenant uuid> --limit 1` ends with
`text_back_armed=false`.

### 10.2 Remove all three diverts on the handset

Dial `##61#`, `##62#` and `##67#` on the client's handset.

Check: `*#61#` shows no divert set.

### 10.3 Confirm a test call rings out normally

From another phone ring the client's number and let it ring out. It must reach
the client's own voicemail (or ring out), not the Backdesk greeting.

Check: `npm run missed-calls:recent -- --tenant <tenant uuid> --limit 1` shows
no new row for that call.

### 10.4 Keep the number

The Backdesk number is kept and never released. Numbers are recycled, and a
handset somewhere may still divert to it.

| Where | Artefact that proves it |
|---|---|
| 10.1 to 10.3 | `text_back_armed=false`, the `*#61#` result, and the test call with no new row |

---

## 11. Evidence entry template

Paste into the client's evidence log and fill the blanks. Counts, ids,
booleans and names only.

```
## 2026-MM-DD Text-back onboarding: <client business name>

tenant: <tenant uuid>
client agreed (greeting, no voicemail, carrier charges): <date>
clicksend balance at start: A$<amount>
carrier: <carrier>   plan: <plan name>   prepaid: <yes/no>
own lines on the never-text list (count): <n>   never text (count): <n>
template versions attested: <v>, <v>, <v>   approved by: <who>
diverts set: 61 <yes/no>  62 <yes/no>  67 <yes/no>   *#61# shows set: <yes/no>
iPhone Call Forwarding off: <yes/no/not an iPhone>
verification row: <missed call id>  call_status=<status>  caller_present=<true/false>
  forwarded_from_present=<true/false>   recorded at: <time>
text-back armed at: <time>
first live text row: <missed call id>  text_back_status=<status>
  timing lines: <paste the text-back:timing output>
  stopwatch, handset arrival: <seconds>
proof recorded at: <time>

No caller number and no secret value appears above.
```

---

## 12. What is never done

- Never arm a client whose verification row shows the caller missing.
- Never use the unconditional iPhone Call Forwarding switch.
- Never use a direct dial to the Backdesk number as a real client's
  verification call.
- Never release or retire a number while a handset may still divert to it.
- Never paste a handset number, a token or a key into this file or the
  evidence entry.
- Never fix a missed-call row or an arming row by SQL. Use the console.
