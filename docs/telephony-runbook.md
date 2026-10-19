# Telephony runbook (Phase 11 — founder-facing)

Every live step of the missed-call capture layer, in the order it has to
happen, with the screen or the command for each step and the artefact that
proves it happened. This one is **ours** — the founder's. The client-facing
runbook (which divert codes a tradie dials on their own phone) is Phase 12's.

Where a step has a trap, the trap is written beside it. Read it end to end
**before** a live window, not during.

---

## 0. Before anything

- **The hosted Sydney Supabase IS production.** There is no staging database.
  Never run `npm run test:remote` in a live window — it takes a lease that
  pauses the deployed cron jobs.
- Run `npm run cron:status` before and after every live window, and only read.
- **Two handsets minimum:** a *caller* handset (places the test calls) and the
  founder's handset (the one whose calls are diverted, or which dials the
  number directly). The spike (§10) needs three carriers plus a caller.
- **Never write a handset number into this repository** — not in a note, not in
  an evidence entry, not in a commit message. Every instrument below prints
  booleans and prefix classes instead of numbers, for exactly this reason.
- **Nothing here needs SQL.** Every artefact comes from the product's own paths
  or from a read-only script. If a step seems to need a hand-typed database
  write, stop — the step is wrong.
- **The fixed log strings.** Both Twilio doors log a closed set of lines and
  nothing else. To read them:

  ```bash
  vercel logs --since 1h | grep -F '[twilio]'
  vercel logs --since 1h | grep -F '[telephony]'
  ```

  | Line | Means |
  |---|---|
  | `[twilio] voice signature_rejected; served generic greeting.` | A request carried the right route token but a bad `X-Twilio-Signature` (wrong Auth Token on the deploy, or a URL mismatch). No row written |
  | `[twilio] voice base_url_unset; …` / `[twilio] status base_url_unset; …` | `APP_BASE_URL` is missing on the deploy — the doors fail closed. Fix the env, redeploy |
  | `[twilio] voice body_unreadable; …` / `[twilio] status body_unreadable; …` | The form body could not be read. Counted, no row |
  | `[twilio] voice env_unreadable; …` / `[twilio] status env_unreadable; …` | The server env failed validation (any key, not only Twilio's). The doors answer the generic greeting / 200 and write nothing; the nightly reconcile recovers the rows. Fix the env on Vercel, redeploy |
  | `[twilio] voice handled: <kind>.` / `[twilio] status handled: <kind>.` | The normal path. `<kind>` is a closed vocabulary (for the status door: `completed`, `unmatched`, `unparseable`, `db_failed`) |
  | `[telephony] RECORDING_PRESENT — D-04 violated; alerting operator.` | The nightly reconcile found a recording on the account. See §1 |
  | `[telephony] provision orphaned_number <PN sid>` | A number was bought but could not be recorded. See §5, "Trap: orphaned number" |
  | `[telephony] provision outcome_unknown <code>` | A purchase may or may not have gone through; the row is held `pending`. See §5, "Trap: purchase outcome unknown" |
  | `[telephony] provision adopted <PN sid>` / `provision lookup_failed <code>` / `provision duplicate_numbers <n>` | The buy step's look-before-buying search (§5) |
  | `[telephony] provision bundle_unattached <PN sid>` | Twilio did not show the AU bundle on a bought/adopted number even after the attach and read-back. See §5 |
  | `[telephony] reconcile recovered=<n> recordings=<n>` | One line per nightly reconcile. `recordings=unknown` means the count could not be read — the D-04 check did NOT run (WR-05) |
  | `[telephony] reconcile recordings poll failed: <code>` | The recordings count failed (rotated Auth Token, 429, timeout). Not "none found": check the Twilio Console by hand (§1) if it repeats |

---

## 1. Account and recording posture

**Where:** Twilio Console → Voice → Settings → Recordings.

It must show **no Recording Configuration**. Nothing in this product creates a
recording: the greeting is `<Pause>`, `<Say>`, `<Hangup>` and nothing else, and a
structural test forbids every verb that could capture audio (D-04). No
transcription, no Voice Intelligence service.

If a recording ever appears anyway (a Console setting flipped by hand, a
misconfigured bin), the nightly reconcile counts it and **texts the operator's
handset** with the fixed alarm, and logs `[telephony] RECORDING_PRESENT`. The
response is: delete the configuration in the Console, delete the recording, and
write an evidence entry saying when and why.

| Where | Artefact that proves it |
|---|---|
| Voice → Settings → Recordings | Evidence entry line "recording configurations: empty on <date>" |

---

## 2. AU regulatory bundle

**Status:** submitted 2026-09-28 1:32 pm AWST, **pending review**
(`docs/external-registrations.md`, Phase 11 Twilio entry). Nothing can be bought
until it is approved.

- **Sole trader path (what was submitted):** AU Local, Business end-user. ABN
  in the Document Number field; identity document = the ABN Lookup record plus
  the ASIC business-name extract ("Record of Registration for Business").
- **Individual fallback:** if Twilio rejects the business path for a sole
  trader, re-submit as the Individual end-user type ("business use only"): AU
  government ID or passport, plus proof of the AU address.
- **The Address:** the street address that cleared ClickSend's IPND check on
  2026-08-29. **No PO box** — Twilio refuses one.
- **Review expectations:** Twilio quotes about 24 business hours. If there is no
  decision after 72 h, contact Twilio support quoting the Bundle SID.
- **Telnyx fallback trigger:** the bundle is refused outright, or support cannot
  move it within a week of submission. That halts the phase for a re-plan of the
  provisioning plans; it is not a runbook step.

The two identifiers go into `.env.local` as `TWILIO_AU_BUNDLE_SID` and
`TWILIO_AU_ADDRESS_SID`, then:

```bash
npm run env:push -- --project backdesk --envs production,preview TWILIO_AU_BUNDLE_SID TWILIO_AU_ADDRESS_SID
```

…and a redeploy. (Done on 2026-09-28. Repeat only if a re-submission produces a
new Bundle SID — the purchase refuses by name while either is missing.)

| Where | Artefact that proves it |
|---|---|
| Phone Numbers → Regulatory Compliance → Bundles | Bundle status **Twilio-approved**, recorded with the date in the evidence log |

---

## 3. Env keys and rotation

Four keys are **required** (the server refuses to start without them) and
three are optional:

| Key | Role |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account identifier (REST username) |
| `TWILIO_AUTH_TOKEN` | REST password **and** the signature key Twilio signs every webhook with |
| `TWILIO_VOICE_WEBHOOK_SECRET` | The `voice` door's `?token=` |
| `TWILIO_VOICE_STATUS_WEBHOOK_SECRET` | The `voice-status` door's `?token=` — deliberately a different secret |
| `TWILIO_AU_BUNDLE_SID`, `TWILIO_AU_ADDRESS_SID` | Optional in the schema, required by the purchase guards |
| `TWILIO_VOICE_FALLBACK_URL` | Optional — see §6 |

Push the four together:

```bash
npm run env:push -- --project backdesk --envs production,preview TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_VOICE_WEBHOOK_SECRET TWILIO_VOICE_STATUS_WEBHOOK_SECRET
```

**The probe** (after any push and redeploy): both doors must answer 401 to a
wrong token.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST 'https://app.backdesk.com.au/api/webhooks/twilio/voice?token=wrong'
curl -s -o /dev/null -w '%{http_code}\n' -X POST 'https://app.backdesk.com.au/api/webhooks/twilio/voice-status?token=wrong'
```

**Rotating a route secret** — the token lives inside the URL Twilio signs, so it
is a two-sided change and the order matters:

1. Put the new value in `.env.local`, push it (command above, that key only).
2. Redeploy, and wait for **Ready**.
3. Twilio Console → Phone Numbers → Manage → Active numbers → the number →
   Voice Configuration: edit the Voice URL (or the Status Callback) so its
   `?token=` is the new value. Save. Repeat for **every** active number.
4. One test call (§7's procedure) and `npm run missed-calls:recent` to see the
   row land with `completed_via callback`.

Between step 2 and step 3 the door answers 401 for a few seconds. That window
is accepted — there is no previous-secret grace in v1.2 — and a call that lands
in it is recovered by the nightly reconcile. Do it outside the client's hours.

**Trap:** the Auth Token is the signature key, not a bearer. Rotating it makes
every signature fail (`signature_rejected`, generic greeting, no row) until the
deploy carries the new value. Rotate it only when it is compromised, outside
hours, and push + redeploy immediately after promoting the new token in the
Console.

---

## 4. Search (read-only)

```bash
npm run twilio:numbers-search
npm run twilio:numbers-search -- --locality Fremantle
```

One GET through the Sydney edge. It prints one line per candidate — number,
locality, region, `address_requirements` — and **buys nothing**. Exit 0 with
candidates; exit 2 with `twilio numbers search: none for <locality>`; exit 1
with `returned <status>` on a refusal (401 is a wrong credential pair).

- If Perth is empty, try another WA town with `--locality`, or accept **any WA
  08 number**: the tradie's customers never dial it. The charging district only
  changes what a *caller* pays and whether the number can be ported — neither
  matters for a number that only receives diverted calls.
- **Read the prefix, not only the locality.** `08` is not Western Australia —
  it is WA, SA, the NT and Broken Hill. The console's Find and Buy accept only
  the **WA geographic ranges** of the ACMA Numbering Plan 2025 (Schedule 1,
  Part 4): `08 41`, `08 51–55` (not `08 5550`), `08 57–58`, `08 6x` and
  `08 9x` (WR-08). Twilio's `locality`/`region` metadata is not evidence: on
  2026-09-28 a "Perth, Western Australia" page included a `+613` number, and on
  2026-10-02 a "Perth" candidate (`08 75…`) turned out to be Waikerie, SA. This
  script prints Twilio's raw page unfiltered — the console filters it; if the
  console says there is no inventory, try again later.

The candidate numbers are unallocated Twilio inventory, not anybody's handset —
but still do not paste them into the evidence log. Record the exit code and the
candidate **count**.

---

## 5. Purchase from the console

**Where:** `/clients/[id]` → the **Divert number** section (the checklist's
divert row links to it).

1. **Spoken name.** Say it aloud first. At most six words. The voice reads what
   is written, literally — abbreviations like "Pty Ltd" are read as written.
   Write what Olivia should *say*, not the legal name.
2. Tap **Find a Perth number**. Read the sentence that comes back: the number,
   its locality, and the monthly cost.
3. Tap **Buy this number**. This is a real, paid, production purchase. The row
   is claimed before anything is bought, so a double tap cannot buy two.

**Read back in the Twilio Console** (Phone Numbers → Manage → Active numbers →
the number):

| Field | Must read |
|---|---|
| Voice Configuration → A call comes in | `https://app.backdesk.com.au/api/webhooks/twilio/voice?token=…`, HTTP POST |
| Call status changes | `https://app.backdesk.com.au/api/webhooks/twilio/voice-status?token=…`, HTTP POST |
| Messaging | **Left empty** — SMS never goes through Twilio |
| Friendly name | `backdesk-divert-<tenant uuid>` — never the business name |
| Regulatory | The bundle attached |

**The bundle is read back by the product (WR-09, F-11-07-2).** On 2026-10-02 the
create call carried the bundle but Twilio returned `bundle_sid: null`. The buy
step now reads the bundle from Twilio's answer; if it is missing it attaches the
bundle with a bundle-only update and **fetches the number again**. If Twilio
still does not show it, the purchase still succeeds (the number is bought), the
log line is `[telephony] provision bundle_unattached <PN sid>`, the row carries
`bundle_unattached`, and the Divert number section and checklist row say "AU
bundle not attached at purchase". Then: Twilio Console → the number →
Regulatory → attach the bundle by hand, record it (sid and date) in the
evidence log, and only then give the client the number. The console notice
stays as the record that it was missing at purchase.

Back on the client page the checklist row **Divert number provisioned** reads
the number.

**Trap: orphaned number.** If the form answers "The number was bought but could
not be recorded — do not buy again", **do not buy a number anywhere else**. The
number exists and is billed; the client's row stays `pending` so nobody can buy
a second. Find the PN sid with `vercel logs --since 1h | grep -F 'provision orphaned_number'`
and record it (sid only) in the evidence log. **Recovery is in the console
(WR-07):** a pending claim older than 10 minutes shows "A purchase claimed N min
ago never finished"; tap **Find**, then **Buy** — the buy step lists the
account's numbers named `backdesk-divert-<tenant uuid>`, finds the orphan and
records it on the row ("Found … already bought … nothing new was bought").
Only if that keeps failing, open a quick task. Never a hand-typed UPDATE on
production, and never a release.

**A claim that never finished** (the function was killed between claim and
result, or a write after it threw) reads "Purchase in progress — claimed N min
ago" and, after 10 minutes, offers the same Find → Buy recovery as above.

**Trap: purchase outcome unknown.** If the form answers "Twilio did not answer
clearly … the purchase may have gone through", **do not buy a number for this
client anywhere else** (not in the Twilio Console either). A timeout, a dropped
connection or a Twilio 5xx says nothing about whether Twilio bought it, so the
row stays `pending` with the hold code `outcome_unknown` and the Divert number
section says so. The log line is `[telephony] provision outcome_unknown <code>`.
Wait 10 minutes, then **Find** and **Buy** again on the client page: the buy step
first lists the account's numbers named `backdesk-divert-<tenant uuid>` and, if
one is there, records it on the row ("Found … already bought … nothing new was
bought"). Only when the account shows none, and the hold is over, does it buy.
If it answers "Could not check Twilio for an earlier purchase", nothing was
bought — try again later. A `provision duplicate_numbers <n>` line means two
numbers carry this client's name: record both PN sids (sids only) in the
evidence log and open a quick task; never release one by hand.

**Correcting the name later:** the active section keeps a spoken-name field and
an **Update spoken name** button. The next call uses the new name.

---

## 6. Optional TwiML Bin fallback

Twilio calls the number's fallback URL only when our voice door fails to answer
(a Vercel outage). Without one, the caller hears Twilio's default application
error and the nightly reconcile still recovers the row. **Ship without it if it
costs the day.**

1. Twilio Console → Runtime → TwiML Bins → create a bin holding the **generic**
   greeting — no business name, because one bin serves every client:
   "Hi, thanks for calling. This is an automated message and the call isn't
   recorded. We're texting you now — if your number is private, text us
   instead." (`<Pause length="1"/>`, then `<Say voice="Polly.Olivia-Neural" language="en-AU">`, then `<Hangup/>`.)
2. For numbers bought **afterwards:** put the bin's URL in `.env.local` as
   `TWILIO_VOICE_FALLBACK_URL`, push it, redeploy. The purchase then sets it.
3. For numbers **already bought:** paste the bin's URL by hand into the number's
   "Primary handler fails" field in Voice Configuration.

---

## 7. Verification call and proof

**This call MUST be a DIVERTED call — never a direct dial.** The three-carrier
spike was skipped by founder override (11-08, 5 Oct 2026), so each client's
verification call is now the proof that the caller's number survives a divert
on that client's carrier. A call dialled straight to the Twilio number proves
nothing about the divert, and the console refuses a call that arrived without a
caller number.

1. Set the divert on the **client's handset** (no-answer divert to the Backdesk
   number, the 61 code — see the client's carrier).
2. From a **second phone with caller ID on** (not the client's own handset, not
   `#31#`), ring the **client's own line** and let it go unanswered until it
   diverts. Listen: is the greeting intelligible, and is the business name
   pronounced right? (S5 — write one sentence about it in the evidence entry.)
3. Let it hang up by itself.
4. Read the row:

   ```bash
   npm run missed-calls:recent -- --tenant <tenant uuid> --limit 5
   ```

   The top row must show `call_status=completed`, `completed_via=callback`,
   `caller_withheld=false` and **`caller_present=true`**, and the caller must be
   the second phone. Record the carrier and whether `forwarded_from_present` is
   true (evidence only — it is never routed on). If `caller_present=false`, the
   carrier stripped the caller on the divert: **do not arm text-back for this
   client** (11-08), and record it.
   Its `duration_seconds` is the S5 measurement: pause plus greeting, **at most
   13 s**. If it is over, the greeting template is a fixed constant in code, not
   an operator setting — file a quick task to trim it (for example "This is an
   automated message and" → "This is automated and"). A shorter spoken name
   helps only at the margin.
5. Copy the row's id. On the client page, paste it into the **Missed call id**
   field of the checklist row **Verification call recorded**, with a short note
   naming the carrier. The proof is refused unless the row is this client's,
   completed, **on the client's active divert number, with the caller's number
   present (not withheld), and less than 24 hours old**. The recorded proof
   stores ids and booleans only — `caller_present`, `caller_withheld`,
   `forwarded_from_present`, `divert_number_id` — never a number.

| Where | Artefact that proves it |
|---|---|
| `missed-calls:recent` + the checklist | The row id, `completed_via=callback`, `caller_present=true`, `forwarded_from_present`, the carrier, `duration_seconds`, and the proof row filled |

---

## 8. S7 region check

Straight after the verification call:

```bash
npm run verify:missed-call-reconcile
```

It announces itself as a production write (it runs the same reconcile the
nightly job runs — after a clean verification call it changes nothing, because
the reconcile only fills columns a dropped callback left empty, or adopts a
dead-lettered call whose number now has an owner), then prints:

```
calls listed (inbound, 48h): N
reconcile: skipped=false recovered=M recordings=0 recordings_check_failed=false
```

**Read `recovered` correctly:** it counts only the calls the reconcile actually
recovered in the last 48 hours — inserted (no row existed), completed (a
dropped callback left the completion empty) or adopted (a dead letter for a
number that had no active owner when the call arrived, now attributed). A row
that was already complete is not counted, so after a clean verification call it
reads **0**. The proof of what changed is always the row itself, read with
`missed-calls:recent`.

`N` of 1 or more proves the US1 region, reached through the Sydney edge, sees
calls to the number (S7). `N = 0` after a call that rang means the call was
processed in a region our client cannot see — stop and record it; that reopens
D-10. `recordings` must be 0 (§1). `recordings=unknown` with
`recordings_check_failed=true` means the count could not be read — that is not
a pass; re-run, and check Voice → Settings → Recordings by hand.

---

## 9. Dropped-callback drill (success criterion 3)

Proves the claim that matters most: when Twilio's status callback never
arrives, the reconcile completes the row anyway — once, with no duplicate.

1. **Save the current URL first.** Twilio Console → the number → Voice
   Configuration → "Call status changes". Copy the exact URL into the password
   manager (it contains the route secret — never into this repo, a chat, or the
   evidence log).
2. Edit that URL: change **one character of the token**. Save.
3. Place one call to the number from the founder's handset. Let it hang up.
4. `npm run missed-calls:recent -- --tenant <tenant uuid> --limit 3` → the new
   row shows `call_status=ringing` (or `-`) and `completed_via=-`. Note its id
   and the row count.
5. `vercel logs --since 1h | grep -F '[twilio] status'` shows **no** `status
   handled` line for this call — the wrong token was refused with a 401 before
   the body was read (Twilio's own debugger shows the 401).
6. `npm run verify:missed-call-reconcile` → `skipped=false` and `recovered`
   of at least 1 — the drill's call, completed by the reconcile (it counts only
   rows it actually inserted, completed or adopted — see §8; a clean
   verification call is not counted; the row is still the proof).
7. `npm run missed-calls:recent -- --tenant <tenant uuid> --limit 3` → the
   **same row id**, now `completed_via=reconcile`, `call_status=completed`, and
   the row count unchanged — no duplicate.
8. **Restore:** paste the saved URL back into "Call status changes", exactly.
   Save.
9. Place one more call. `missed-calls:recent` → its row reads
   `completed_via=callback`. The drill is over only when this line is seen.

| Where | Artefact that proves it |
|---|---|
| Steps 4, 6, 7, 9 | The drill row id with its two `completed_via` readings (`-` then `reconcile`), and the restore call's row with `callback` |

---

## 10. Live divert spike protocol (success criterion 4 — gates Phase 12)

> **Status, 5 Oct 2026: not run.** The founder skipped this spike ("skip the spike altogether"). It no longer gates Phase 12. The proof it would have given now comes from each client's own verification call, which must be a diverted call from a second phone (section 7). Run this section if a client's carrier ever shows a missing caller number.

Three handsets, one per carrier — **Telstra, Optus, Vodafone** — (the founder's
plus two design partners'), and a fourth phone to place the calls.

**Per handset, set the conditional diverts to the Twilio number** by dialling
these codes and pressing call:

| Divert | Set | Clear |
|---|---|---|
| No answer | `**61*<divert number>#` | `##61#` |
| Unreachable | `**62*<divert number>#` | `##62#` |
| Busy | `**67*<divert number>#` | `##67#` |

Check the no-answer divert is set with `*#61#`. Use the number as the console
shows it; if a carrier refuses the `+61` form, retry in the national `08` form.

**Trap (iPhone):** Settings → Phone → Call Forwarding is **unconditional** — it
diverts every call before the handset rings. Do not use it. Use the dial codes.

**The calls, from the fourth phone, per handset:**

1. **No answer:** call the handset and let it ring out.
2. **Busy:** call while the handset is already on another call.
3. **Unreachable:** call with the handset in flight mode.
4. **Withheld (once per session is enough):** call with `#31#` dialled before
   the number, so the caller ID is withheld.

After **each** call: `npm run missed-calls:recent -- --tenant <tenant uuid> --limit 3`
and note the new row's id and the call time. Carrier and divert type are **not**
stored facts (Twilio does not send them) — write them beside the row, matched
by call time.

**When finished:** clear every divert with `##61#`, `##62#`, `##67#` and confirm
with `*#61#` that nothing is left set. A forgotten divert on a design partner's
phone sends their real customers to a greeting.

**Evidence table:**

| carrier | divert type | handset | call time (AWST) | row id | caller_present | forwarded_from_present | caller_kind | call_status | duration_seconds |
|---|---|---|---|---|---|---|---|---|---|

**Pass criteria:**

- `caller_present=true` and `caller_kind=mobile` on every diverted call placed
  from a mobile — the caller's number survived the divert on that carrier (S2).
- The `#31#` call: `caller_kind=withheld` and `caller_present=false`.
- `forwarded_from_present` is recorded per carrier **as evidence only**. It is
  never used for routing (D-02).

---

## 11. Evidence entry template

Append to `docs/external-registrations.md` under a dated heading. Ids,
booleans, statuses, durations and times only.

```markdown
## 2026-MM-DD — Phase 11 live divert spike

Tenant: <tenant uuid>
Recording posture: recording configurations empty on <date> (Voice > Settings > Recordings)
Bundle: <approved on date>
Search: twilio:numbers-search exit <code>, <count> candidates for <locality>
Purchase: PN sid <sid>, checklist "Divert number provisioned" at <time>
Verification call (DIVERTED, from a second phone): row <uuid>, carrier <name>, completed_via callback,
       caller_present true, forwarded_from_present <bool>, duration_seconds <n>
S5: <one sentence — intelligible? name pronounced right?> duration <n> s (limit 13 s)
S7: calls listed (inbound, 48h): <n>
S4: <status callback arrival vs call end, from the timestamps>
Drill: row <uuid> — completed_via - → reconcile (recovered=<n>, row count unchanged);
       restore call row <uuid> completed_via callback

| carrier | divert type | handset | call time (AWST) | row id | caller_present | forwarded_from_present | caller_kind | call_status | duration_seconds |
|---|---|---|---|---|---|---|---|---|---|
| Telstra | no-answer | founder | … | … | … | … | … | … | … |

Diverts cleared on all three handsets at <time> (checked with *#61#).

No caller number appears above. No credential value of any kind appears above.
```

---

## 12. What is never done

- **No recording.** Not of a call, not of a voicemail, not "just for testing".
- **No release of a number.** There is no release path in the product, on
  purpose: a released number can be re-sold to a stranger who then receives
  a client's customers' calls. Retiring a number is a decision, not a step.
- **No SMS on Twilio.** The number's Messaging configuration stays empty; SMS is
  ClickSend's (Phase 4).
- **No rewire without the order in §3.** Changing a Voice URL or Status
  Callback outside the push → redeploy → Console → test-call order is how a
  door ends up answering 401 to real calls.
- **No caller number in the repo**, in any file, ever.
