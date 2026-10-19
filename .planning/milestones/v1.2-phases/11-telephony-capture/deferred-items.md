# Phase 11 — deferred items

## From plan 11-06 (found by the live read-only search, 2026-09-28)

### D-11-06-1 (FIXED 2026-09-28 by the orchestrator before 11-07: locality results filtered to WA in searchAuLocalNumbers): `searchAuLocalNumbers` can offer a non-08 candidate that the buy action refuses

- **Found by:** `npm run twilio:numbers-search` (exit 0, 10 candidates for Perth). Every
  candidate carried `locality=Perth region=Western Australia address_requirements=local`,
  but by prefix class: 8 × `+61 8 7…`, 1 × `+61 8 5…`, and **1 × `+61 3 6…` — the FIRST
  candidate on the page.**
- **Why it matters:** `findDivertNumberCandidate` (`src/core/telephony/provision.ts`) shows
  `candidates[0]`, and `provisionDivertNumberAction`'s zod schema only accepts
  `^\+618\d{8}$`. If Twilio returns the same order on the day, "Find a Perth number" shows
  a number that "Buy this number" then refuses with the confirm sentence — every time.
- **Suggested fix (small, outside 11-06's files):** in `searchAuLocalNumbers`
  (`src/core/telephony/twilio-client.ts`), narrow the `inLocality` page client-side to
  `phoneNumber.startsWith('+618')` exactly as the unfiltered fallback page already is; fall
  through to the WA fallback when nothing survives. One unit test in the twilio-client suite.
- **Also worth a look:** whether `+61 8 7…` numbers are Perth-district at all (08 7xxx is
  commonly an Adelaide/SA range). Charging district does not matter to a divert-only number
  (runbook §4), so this is informational only.
- **Workaround until fixed:** runbook §4 tells the operator to read the prefix and search
  again if the console's candidate is not 08.
- **Out of scope for 11-06** (scope boundary: pre-existing code in 11-03/11-05). Must be
  resolved before, or during, plan 11-07's purchase step.

## From plan 11-07 (the first purchase, 2026-10-02)

### F-11-07-1 (FIXED d405260: WA geographic ranges per the ACMA Numbering Plan) (OPEN, non-blocking): the WA filter accepts an SA 08 range

- **Found by:** the first purchase. Twilio's search reported the candidate's locality as
  Perth; the Console shows the bought number (`PN00000000000000000000000000000000`,
  `+61 8 75…`) as "Waikerie, South Australia". D-11-06-1's fix keeps `+618` candidates, and
  the 08 area code covers WA, SA and NT — the note above already suspected `08 7xxx` as SA.
- **Why it is not blocking:** a divert number is never seen or dialled by a caller; charging
  district is irrelevant to capture (runbook §4). Only the locality line on the client page
  can read wrong.
- **Suggested fix:** in `searchAuLocalNumbers`, prefer WA number ranges (or the rate-centre /
  region field over the locality string) and fall through to any 08 only when no WA number is
  offered; one unit test. Before the first real client's purchase.

### F-11-07-2 (FIXED 769576d: bundle read-back, attach-on-null, `bundle_unattached` surfaced) (OPEN — verify in Phase 12): `bundleSid` on create did not attach the bundle

- **Found by:** the Console read-back after the purchase. Twilio returned `bundle_sid: null`
  on the new number although `bundleSid` was passed to the create call; the bundle's item
  assignments held only the documents and the end user. The orchestrator attached the bundle
  by an explicit API update at ~2026-10-02T12:47Z; the read-back now shows
  `BU00000000000000000000000000000000`.
- **To verify:** whether `create()` needs a follow-up `update({ bundleSid })` (or an
  item-assignment call), or whether Twilio populates `bundle_sid` lazily. If a follow-up is
  needed, add it to the provisioning path with a read-back before the first client purchase —
  an unattached regulated number risks reclamation.
