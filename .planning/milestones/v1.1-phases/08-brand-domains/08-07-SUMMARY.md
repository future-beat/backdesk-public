---
phase: 08-brand-domains
plan: 07
subsystem: infra
tags: [resend, dkim, spf, dmarc, dns-over-https, vercel-env, operator-alerts, sending-domain]

requires:
  - phase: 08-brand-domains (08-02)
    provides: DEFAULT_ALERT_FROM in brand.ts and the OPERATOR_ALERT_FROM contract in docs/env-vars.md
  - phase: 08-brand-domains (08-04)
    provides: the quotes.backdesk.com.au domain object at Resend and the four DNS records published by the founder
  - phase: 08-brand-domains (08-06)
    provides: the renamed `backdesk` Vercel project that env pushes and redeploys target
provides:
  - Machine-readable proof that quotes.backdesk.com.au is verified at Resend (status=verified, region=ap-northeast-1) alongside four public DNS read-backs
  - OPERATOR_ALERT_FROM live in Vercel Production and Preview with a production deployment booted on it
  - A completed docs/vercel-domains-and-protection.md with no fill marker left and a §8 proof index spanning 08-04..08-07
  - The closing-checks record and the five-success-criteria-to-artefact map for verify-phase
affects: [09-landing-page, 10-first-client-onboarding, DOM-04, ARM-02]

actuals:
  tokens: 3241
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Read-only provider status reads as evidence: a GET that a lesser credential would reject proves both the fact and the credential class in one call"
    - "Event-gated proof: when the observable requires an event that must not be manufactured, name the artefacts that do exist and carry the observation forward rather than faking the event"

key-files:
  created: []
  modified:
    - docs/external-registrations.md
    - docs/vercel-domains-and-protection.md

key-decisions:
  - "DOM-03 left Pending, not marked complete: the requirement text names 'verification status visible in the console email settings page' and nobody opened that page today — the status behind it is proven, the render is not"
  - "Proved the Verified status with a read-only GET https://api.resend.com/domains instead of only quoting the founder — read-only, sends nothing, and returns the exact string VERIFIED_STATUS gates on"
  - "Refused to manufacture a stalled-digest fixture on the production database to observe the alert From header; recorded it as event-gated for the Phase 10 checklist"
  - "Recorded the plan's two stale DNS expectations as measured corrections rather than quietly satisfying them: the apex _dmarc is Google Workspace's and does carry rua=, and the apex A is Squarespace parking, not empty"

patterns-established:
  - "A stale plan expectation is corrected in the evidence entry with the reason it was written, not deleted — the next reader needs to know the zone changed under the plan"

requirements-completed: []

coverage:
  - id: D1
    description: "quotes.backdesk.com.au is verified at Resend with SPF, DKIM and DMARC published"
    requirement: DOM-03
    verification:
      - kind: integration
        ref: "curl https://dns.google/resolve — DKIM TXT (p=, 218 chars), send.quotes MX 10 feedback-smtp.ap-northeast-1.amazonses.com, send.quotes TXT v=spf1 include:amazonses.com ~all, _dmarc.quotes TXT v=DMARC1; p=none; (no rua=)"
        status: pass
      - kind: integration
        ref: "GET https://api.resend.com/domains → 200, name=quotes.backdesk.com.au status=verified region=ap-northeast-1"
        status: pass
      - kind: unit
        ref: "tests/resend-domains.test.ts (VERIFIED_STATUS + EMAIL_DOMAIN_REGION pinned)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The verification status is visible to the operator on the console email settings page"
    requirement: DOM-03
    verification:
      - kind: manual_procedural
        ref: "open https://app.backdesk.com.au/settings/email — expect the Verified badge, region ap-northeast-1, residency note unchanged, from-address placeholder followups@quotes.backdesk.com.au"
        status: unknown
    human_judgment: true
    rationale: "The badge renders behind the operator login from a live Resend read; there is no repo script that renders the page without a session. The underlying status is proven (D1) — the rendering is not."
  - id: D3
    description: "Operator alerts are configured to send from Backdesk <alerts@quotes.backdesk.com.au>"
    requirement: DOM-03
    verification:
      - kind: integration
        ref: "npm run env:push (config, 40 chars) + vercel env ls --format json → OPERATOR_ALERT_FROM target=[production, preview] updatedAt 2026-09-08T09:46:16Z; vercel redeploy → backdesk-1nxnwruo3 READY, created 09:46:47Z, aliased app.backdesk.com.au"
        status: pass
    human_judgment: true
    rationale: "The From header itself can only be observed on a real send. The stalled digest sends nothing when there is nothing to report and no alert condition exists; manufacturing one on the production database was refused. Outstanding for the first real alert or the Phase 10 go-live checklist."
  - id: D4
    description: "quotes.backdesk.com.au is the documented sending domain for cadence email"
    requirement: DOM-03
    verification:
      - kind: unit
        ref: "tests/resend-sender.test.ts, tests/email-settings-action.test.ts (verified-domain gate on from_address)"
        status: pass
      - kind: other
        ref: "docs/vercel-domains-and-protection.md §4 status table — followups@quotes.backdesk.com.au is convention only; no messaging_config email row enabled (D-11)"
        status: pass
    human_judgment: true
    rationale: "Live cadence send on the verified domain is DOM-04, Phase 10, by decision D-11. What is delivered here is a verified domain plus a documented convention, and the summary says so rather than claiming a sending domain in use."
  - id: D5
    description: "docs/vercel-domains-and-protection.md is complete — every section holds a measured value or an explicit event-gated note, and §8 indexes 08-04..08-07"
    verification:
      - kind: integration
        ref: "grep -c '_To be filled' docs/vercel-domains-and-protection.md → 0; grep -c '^- \\*\\*2026-' → 6"
        status: pass
    human_judgment: false
  - id: D6
    description: "The phase's automated gates are green and the ticks are healthy on the custom domain"
    verification:
      - kind: unit
        ref: "npx vitest run (7 pure suites) → 7 files, 235 tests passed"
        status: pass
      - kind: integration
        ref: "npm run typecheck exit=0; npm run lint exit=0; git diff --quiet -- vercel.json exit=0"
        status: pass
      - kind: integration
        ref: "npm run cron:status → 4 active=t at https://app.backdesk.com.au/api/internal/, 200s at 09:50-09:53Z, remote_test_lease rows: 0"
        status: pass
      - kind: integration
        ref: "gh run list → CI success on 0344b85 (run 34211583609, 2026-09-08T09:43Z)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-09-08
status: complete
---

# Phase 8 Plan 07: Sending Domain Verified, Alerts Switched Summary

**`quotes.backdesk.com.au` is verified at Resend by the exact test the code applies — `status=verified`, `region=ap-northeast-1`, all four records answering in public DNS — and operator alerts now boot with `Backdesk <alerts@quotes.backdesk.com.au>`; the one thing nobody looked at is the console badge, so DOM-03 stays Pending.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-08T09:42Z
- **Completed:** 2026-09-08T09:56Z
- **Tasks:** 2 of 2
- **Files modified:** 2

## Accomplishments

- **Four DNS records read back and byte-identical to 08-04.** DKIM `p=…` as one unbroken 218-character string, `send.quotes` MX `10 feedback-smtp.ap-northeast-1.amazonses.com.`, `send.quotes` TXT `v=spf1 include:amazonses.com ~all`, and `_dmarc.quotes` TXT `v=DMARC1; p=none;` with **no `rua=`**. All over Google DNS-over-HTTPS, because the workspace resolver is a stub that answers nothing.
- **Turned the badge claim into a machine check.** Rather than resting DOM-03's central fact on "the founder said Verified", a read-only `GET https://api.resend.com/domains` returned `name=quotes.backdesk.com.au status=verified region=ap-northeast-1`. `verified` is the exact string `VERIFIED_STATUS` gates on and `ap-northeast-1` is the exact string `EMAIL_DOMAIN_REGION` pins — so the domain is verified *by the test the code applies*, not by a status someone read off a page.
- **Closed the `RESEND_API_KEY` drift open item on the local side.** That read used the **local** key and returned 200. A *Sending access* key cannot read domain objects — it answers `restricted_api_key`, which is exactly how the 08-04 add-domain attempt failed. So `.env.local` holds a Full access key and local runs can be trusted with it.
- **`OPERATOR_ALERT_FROM` is live and booted.** Pushed to Production and Preview as Config (40 chars — the whole display-name-plus-address pair survived `--public`'s split-on-first-`=`), value never printed. Production redeployed **31 seconds after** the write; the new deployment is READY with all six aliases re-attached and `app.backdesk.com.au` still 200.
- **The DOM reference is finished.** Zero fill markers, the full published DKIM key recorded so a future re-paste can be diffed rather than re-typed, a per-row status table in §4 that distinguishes "convention only" from "deployed", and a §8 proof index covering all six dated entries from 08-04 to 08-07.

## Task Commits

1. **Task 1: Prove the sending domain is verified and switch operator alerts to it** — `ff9c630` (docs)
2. **Task 2: Complete the DOM reference and run the phase-wide closing checks** — `720917e` (docs)

## Files Created/Modified

- `docs/external-registrations.md` — +132 lines: the dated entry `2026-09-08 — quotes.backdesk.com.au verified at Resend; OPERATOR_ALERT_FROM pushed`, carrying the four DoH read-backs, the two corrected plan expectations, the Resend status read, the env push and redeploy artefacts, the event-gated From-header note, and the explicit D-11 statement
- `docs/vercel-domains-and-protection.md` — §3 gains the full DKIM value, the measured Verified block and the drift-item closure; §4 gains a three-row status table; §8 gains the 08-07 entry. `grep -c '_To be filled'` → 0

## The five ROADMAP success criteria, mapped to artefacts

| # | Criterion | Artefact that satisfies it |
|---|---|---|
| 1 | Backdesk on every prospect/client surface; no rendered "Quote Recovery" service-name string | `tests/brand.test.ts` — the BRAND-01 grep-as-test, passing in the closing run (part of 7 files / 235 tests). Reinforced by the 08-05 phone check on `app.backdesk.com.au/login` and the 08-04 measurement of the served page: **6 occurrences of "Backdesk", 0 of "Quote Recovery"** |
| 2 | Every outbound SMS/email names the tradie as sender with Backdesk as the service; STOP and one-click unsubscribe still suppress both channels | `tests/resend-sender.test.ts` and `tests/clicksend-sender.test.ts` (sender identification and the `sent by Backdesk on behalf of …` line) plus `tests/unsubscribe.test.ts` **unchanged and passing** — the suppression path was not touched by any plan in this phase, which is the point |
| 3 | The three commercial assumptions confirmed, in one documented config location, with PROJECT.md recording the decision | Plan 08-03's `checkpoint:decision` (the operator's keep-all ruling), `docs/commercial-assumptions.md`, the constants header pointer, and the PROJECT.md Key Decisions rows — all landed before any real audit or invoice |
| 4 | Console at `https://app.backdesk.com.au` on a phone, syd1 unchanged, `*.vercel.app` redirects, previews protected, ticks and public pages still working, bypass/exclusions documented | The 08-05 entry (custom-domain 200, phone check, URL switch, four cron targets, both ClickSend rules) and the 08-06 entry (308 on all five `*.vercel.app` hosts, `302 → sso-api` on a deployment URL, `ssoProtection` read-back, bypass key 1 → 0), with §5–§7 of `docs/vercel-domains-and-protection.md` as the documentation. Re-confirmed today: `vercel.json` still pins `regions: ["syd1"]`, `/login` and `/api/unsubscribe` both **200** after the redeploy, default alias still **308** |
| 5 | The console email settings page shows `quotes.backdesk.com.au` verified (SPF, DKIM, DMARC published) and it is the sending domain for cadence email and operator alerts | **Partially proven.** This plan's entry: four DNS read-backs + `status=verified` from Resend + `OPERATOR_ALERT_FROM` deployed. **Outstanding:** the page render (human-check, D2) and the live cadence send (DOM-04, Phase 10, by D-11) |

## Decisions Made

**DOM-03 is NOT marked complete.** Its text has four clauses; three are proven and one is not:

| Clause | State |
|---|---|
| verified at Resend | **True** — `status=verified` from the API |
| SPF, DKIM, DMARC published | **True** — four public DNS answers |
| verification status **visible in the console email settings page** | **Not observed.** The status the page reads is proven; nobody opened the page |
| is the sending domain for cadence email and operator alerts | **Configured**, not exercised — alerts deployed, cadence email deliberately unarmed under D-11 |

Marking it complete would be claiming a rendered page that no human loaded today. It stays `[ ]` / `Pending` in REQUIREMENTS.md with exactly one blocking observation, which `/gsd-verify-phase` can close in the time it takes to open a URL. This is a deliberate choice, not an oversight — say it out loud at verification: **the Verified badge on `/settings/email` remains a human-check.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's DMARC read-back named the wrong record, and expected the wrong value**

- **Found during:** Task 1
- **Issue:** The action text asked for `dig +short TXT _dmarc.backdesk.com.au` returning `v=DMARC1; p=none;` with no `rua=`. That apex name is not ours and no longer holds that value: it answers **`v=DMARC1; p=none; rua=mailto:hello@backdesk.com.au`** — Google Workspace's default, published when the founder connected Workspace *after* this plan was written. Our record is the **subdomain** one. Read literally, the plan's check would have failed on a `rua=` we neither published nor may remove.
- **Fix:** Read back both. `_dmarc.quotes.backdesk.com.au` → `v=DMARC1; p=none;` with **no `rua=`**, which is the record the DMARC prohibition actually governs. The apex record is recorded as Google's, untouched, with the note that its `p=none` makes our subdomain record belt-and-braces rather than load-bearing — and that Google could change it under us, which is why the subdomain record exists.
- **Files modified:** `docs/external-registrations.md`, `docs/vercel-domains-and-protection.md` (§3 DMARC row)
- **Verification:** `_dmarc.quotes` matches `v=DMARC1` and does **not** match `rua=`; both asserted in the closing check run
- **Committed in:** `ff9c630`, `720917e`

**2. [Rule 1 - Bug] "apex A lookup is empty" was never going to be true**

- **Found during:** Task 1
- **Issue:** The plan used `test -z "$(dig +short A backdesk.com.au)"` as the "apex untouched" proof. The apex has carried **four Squarespace parking A records** since before this phase existed — they are already tabulated in §1 of the DOM reference. An empty result would have meant something had been *removed*.
- **Fix:** Applied the test D-05 actually asks for: *no record placed by this project*. Read back all four parking addresses (`198.185.159.144/145`, `198.49.23.144/145`) and confirmed they are identical to the 08-04 set. Recorded the reasoning so the same wrong assertion is not written into the Phase 9 apex plan.
- **Files modified:** `docs/external-registrations.md`
- **Verification:** DoH `A backdesk.com.au` → the four expected addresses, unchanged
- **Committed in:** `ff9c630`

**3. [Rule 2 - Missing critical evidence] The central fact of DOM-03 rested on a verbal report**

- **Found during:** Task 1
- **Issue:** The plan's only evidence for "verified" was the founder's message plus DNS records — but DNS records resolving proves the *records* are right, not that Resend has accepted them. A domain can have all four records published and still sit in `pending`, and the code refuses to send on anything but the literal string `verified`.
- **Fix:** Made one read-only `GET https://api.resend.com/domains` from a throwaway script in the scratchpad (never written into the repo, not committed). Returned `HTTP 200`, `status=verified`, `region=ap-northeast-1`. Sends no mail, prints no key material, touches nothing — and it collaterally closed the 08-04 `RESEND_API_KEY` drift open item, because a Sending-access key cannot make that call at all.
- **Files modified:** `docs/external-registrations.md`, `docs/vercel-domains-and-protection.md` (§3)
- **Verification:** The returned strings compared against `VERIFIED_STATUS` and `EMAIL_DOMAIN_REGION` in `src/core/messaging/resend-domains.ts`; both exact
- **Committed in:** `ff9c630`, `720917e`

---

**Total deviations:** 3 auto-fixed (2 × Rule 1, 1 × Rule 2)
**Impact on plan:** No scope creep. Two were stale expectations in a plan written before the zone changed under it — correcting them is the difference between a check that passes and a check that means something. The third replaced hearsay with a measurement on the one fact the whole requirement turns on.

## Issues Encountered

- **`dig` and `host` answer nothing in this workspace** (stub resolver). Every DNS read is over `https://dns.google/resolve`, stated as such in the evidence entry — the same method and the same caveat as 08-04.
- **`npm` echoes the full argv in its run banner**, so `OPERATOR_ALERT_FROM`'s value appeared in the console banner of the push command. Not an incident: the value is a display name and an address, it is documented verbatim in `docs/env-vars.md` and in this phase's plans, and it was stored as Config (`--no-sensitive`) precisely because it is not a secret. Every *read-back* was by metadata only. Worth knowing before piping a genuine secret through `--public`, which is what the script's positional-argument path exists to prevent.
- **The alert From header cannot be observed today.** The stalled digest sends nothing when there is nothing to report and no alert condition exists on this database. The only way to force one is to write a stalled fixture into the **production** Supabase, which this phase's rules and the 2026-08-30 MSG-02 precedent both refuse. Recorded as event-gated with the artefacts that do exist.

## Closing checks

| Check | Result |
|---|---|
| 7 pure suites (`brand`, `resend-sender`, `unsubscribe`, `clicksend-sender`, `audit-aggregate`, `resend-domains`, `email-settings-action`) | **7 files, 235 tests passed**, 2.50s. Run bare — no `ALLOW_REMOTE_TESTS` |
| `npm run typecheck` | exit **0** |
| `npm run lint` | exit **0** |
| `git diff --quiet -- vercel.json` | exit **0** — still `{"regions": ["syd1"]}` |
| `npm run cron:status` | **4 × `active=t`** at `https://app.backdesk.com.au/api/internal/`; `net._http_response` 200s at 09:50, 09:50, 09:51, 09:52, 09:53Z — all **after** the 09:46:47Z redeploy, covering both tick schedules; `remote_test_lease rows: 0`; watchdog not scheduled |
| CI on latest main | **success** — run `34211583609` on `0344b85` ("docs(08-06): complete the rename, redirect and deployment-protection plan"), 7m30s, 2026-09-08T09:43Z. This plan's two commits are docs-only and land on main after; the DB-backed suites (unsubscribe suppression, inbound STOP, convert-prospect, cron-schedules) ran green there on the local stack |
| Live host after redeploy | `app.backdesk.com.au/login` **200**, `/api/unsubscribe` **200**, default alias **308 → app.backdesk.com.au/login** |

`npm run test:remote` was **not** run, per the hosted-DB rule.

## Known Stubs

None. No code was written in this plan — both commits are documentation of measured facts.

## Outstanding observations (for verify-phase and Phase 10)

1. **The `/settings/email` Verified badge** — human-check. Open `https://app.backdesk.com.au/settings/email`: expect `quotes.backdesk.com.au` with a **Verified** badge, region `ap-northeast-1`, the residency note unchanged, and the from-address placeholder reading `followups@quotes.backdesk.com.au`. This is the single clause holding DOM-03 open.
2. **The alert From header** — event-gated. On the first real operator alert (or on the Phase 10 go-live checklist), confirm the `From:` reads `Backdesk <alerts@quotes.backdesk.com.au>`.
3. **Supabase Auth → URL Configuration** — dashboard-only, founder task, carried forward from 08-05/08-06 and **not** in this plan's scope. Site URL and the redirect allow-list should name `https://app.backdesk.com.au`. Now that every old host 308s to the custom domain a stale value degrades to an extra hop rather than a dead link, but it should still be corrected.
4. **`RESEND_API_KEY` local-vs-Vercel identity** — narrowed, not closed. Both are Full access keys that work; whether they are the *same* key is unknowable without printing one, and nothing misbehaves if they differ. The 2026-08-29 silent-drift failure mode does not apply here, because a wrong key fails loudly with a named error.

## User Setup Required

None new. Items 1 and 3 above are operator actions already recorded in `docs/external-registrations.md`.

## Next Phase Readiness

Phase 8's build work is done. The console is on `app.backdesk.com.au` behind a certificate that had to be issued by hand, every unbranded host redirects to it, deployment protection is on without breaking a single tick, the commercial assumptions are confirmed and recorded, and the service sending domain is verified with alerts pointed at it.

**Phase 9 (landing page)** inherits a clean apex: `backdesk.com.au` carries only Squarespace parking and the founder's Google Workspace records, and §2's hard-won lesson applies directly — `verified: true` from Vercel does not mean the host serves HTTPS; the proof is a 200, and certificate issuance may need `vercel certs issue` by hand.

**Phase 10 (first client)** inherits DOM-04 and the two observations above. The verified domain is ready; `messaging_config` is deliberately unarmed, so arming a tenant's email identity is a Phase 10 act with the verified-domain gate already enforcing correctness on `saveEmailConfigAction`.

**Blocking nothing.** The one open DOM-03 clause is a page load.

---
*Phase: 08-brand-domains*
*Completed: 2026-09-08*

## Self-Check: PASSED

Both modified docs exist and carry their required strings (`verified at Resend`,
`alerts@quotes.backdesk.com.au`); both task commits `ff9c630` and `720917e` are present in
`git log`; this SUMMARY exists at its expected path.
