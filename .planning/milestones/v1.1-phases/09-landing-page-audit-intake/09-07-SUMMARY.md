---
phase: 09-landing-page-audit-intake
plan: 07
subsystem: infra
tags: [vercel, dns, squarespace, doh, domains, redirect, google-workspace]

requires:
  - phase: 08-brand-domains
    provides: "The Squarespace-DNS-stays-authoritative decision (§1), the app.backdesk.com.au attach pattern, the domain-level 308 redirect shape, the DoH read-back discipline, and the finding that Vercel does not always auto-issue a certificate"
  - phase: 09-landing-page-audit-intake
    provides: "09-04/09-05/09-06 — the landing page, privacy notice, metadata and audit intake, verified on app.backdesk.com.au and ready for a public host"
provides:
  - "backdesk.com.au and www.backdesk.com.au attached to the Vercel project backdesk, both verified, www carrying a domain-level 308 to the apex"
  - "The apex cut over at Squarespace: the five Squarespace Defaults deleted, the rank-1 anycast A pair and the project CNAME published, the parking site gone"
  - "http://backdesk.com.au serving the real Backdesk landing page from Vercel's Sydney edge, and http://www redirecting to it"
  - "docs/vercel-domains-and-protection.md §9 with the measured column filled for every DNS and HTTP row"
  - "A dated evidence entry carrying two-resolver DoH read-backs, the Vercel config and domain-list read-backs, the HTTP proofs, and the founder's verbatim reply"
  - "A recorded proof that Google Workspace mail records survived the cut-over untouched (T-9-17 clear)"
affects: [09-08, phase-10, go-live, certificates, lighthouse]

actuals:
  tokens: 6704
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Two-resolver DoH read-back: a single resolver is one cache, not one truth"
    - "Authority ranking when resolvers disagree: the origin's own config API and a live HTTP response outrank any recursive resolver's answer"

key-files:
  created: []
  modified:
    - docs/vercel-domains-and-protection.md
    - docs/external-registrations.md

key-decisions:
  - "Task 2 answered cut-over-now: the founder published the records rather than deferring, so 09-08 measures production instead of the app host"
  - "The www CNAME was judged published despite Google Public DNS answering the stale Squarespace value on 5 of 12 probes — Cloudflare 12/12, Vercel's config API and a live HTTP 308 all disagreed with the cache, and the stale entry carried ~3,200 s of a 14,400 s TTL it could only have acquired before the edit"
  - "LAND-01 deliberately NOT marked complete: it names https://backdesk.com.au and neither host completes a TLS handshake yet; 09-08 issues the certificate and takes the HTTPS proofs"
  - "vercel certs issue was not run here even though the need is now visible — it belongs to the plan that records its proofs, not to the plan that happened to notice"

patterns-established:
  - "A scripted single-probe DNS assertion is unreliable for roughly one prior-TTL after any record change; record the flake in evidence so the next plan does not read it as a regression"
  - "The founder's verbatim reply is quoted as a block quote and kept structurally separate from every machine read-back, so a claim is never mistaken for a measurement"

requirements-completed: []

coverage:
  - id: D1
    description: "backdesk.com.au and www.backdesk.com.au are attached to the Vercel project backdesk, both verified, apex with no redirect and www with a 308 to the apex"
    requirement: LAND-01
    verification:
      - kind: integration
        ref: "vercel api /v9/projects/backdesk/domains?teamId=team_XXXXXXXX — www redirect=backdesk.com.au code=308 verified=true; apex redirect=null verified=true"
        status: pass
    human_judgment: false
  - id: D2
    description: "The apex DNS cut-over landed: the rank-1 anycast pair answers on two independent resolvers and no Squarespace parking address remains"
    requirement: LAND-01
    verification:
      - kind: integration
        ref: "curl https://dns.google/resolve?name=backdesk.com.au&type=A and cloudflare-dns.com equivalent — 216.198.79.1 + 64.29.17.1 on 11/11 probes, zero 198.185.159.* / 198.49.23.*"
        status: pass
      - kind: integration
        ref: "vercel api /v6/domains/backdesk.com.au/config — misconfigured:false, configuredBy:\"A\", ipStatus:\"no-change\""
        status: pass
    human_judgment: false
  - id: D3
    description: "The www CNAME is published at the registrar and the www→apex 308 is live"
    requirement: LAND-01
    verification:
      - kind: integration
        ref: "cloudflare-dns.com www CNAME — 956ea6eb7ab36544.vercel-dns-017.com. on 12/12 probes"
        status: pass
      - kind: integration
        ref: "vercel api /v6/domains/www.backdesk.com.au/config — configuredBy:\"CNAME\", cnames:[956ea6eb7ab36544.vercel-dns-017.com.], misconfigured:false"
        status: pass
      - kind: e2e
        ref: "curl -sI http://www.backdesk.com.au/ — HTTP/1.1 308, Location: https://backdesk.com.au/"
        status: pass
      - kind: integration
        ref: "dns.google www CNAME — split cache, 7/12 correct, 5/12 stale ext-sq.squarespace.com with ~3200s of the old 14400s TTL remaining"
        status: unknown
    human_judgment: false
  - id: D4
    description: "The apex serves the real Backdesk landing page from Vercel, not the Squarespace parking page"
    requirement: LAND-01
    verification:
      - kind: e2e
        ref: "curl -sI http://backdesk.com.au/ — HTTP/1.1 200, Server: Vercel, X-Vercel-Id: syd1::…; body <title>Backdesk · Quote chasing for Perth trade businesses</title>"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Google Workspace mail records and the console host survived the founder's edit untouched (threat T-9-17 did not occur)"
    verification:
      - kind: integration
        ref: "DoH MX / TXT spf / TXT google-site-verification / google._domainkey / _dmarc / app CNAME on Google and Cloudflare — byte-identical to the pre-cut-over table"
        status: pass
    human_judgment: false
  - id: D6
    description: "The founder's record list was safe and sufficient in practice — five deletions, three additions, nothing collateral"
    verification: []
    human_judgment: true
    rationale: "Only the founder can attest to what the Squarespace UI actually presented and whether any step was ambiguous; the read-backs prove the outcome but not the quality of the instructions"
  - id: D7
    description: "HTTPS on both hosts"
    requirement: LAND-01
    verification:
      - kind: e2e
        ref: "curl -sI https://backdesk.com.au/ and https://www.backdesk.com.au/ — curl: (35) SSL_ERROR_SYSCALL, no certificate issued"
        status: fail
    human_judgment: true
    rationale: "Out of scope for this plan by design — 09-08 owns vercel certs issue and the HTTPS 200 / 308 proofs. Recorded as fail rather than omitted so LAND-01 cannot read as met."

duration: 3h 22m
completed: 2026-09-09
status: complete
---

# Phase 9 Plan 07: Apex + www Cut-Over Summary

**backdesk.com.au now serves the Backdesk landing page from Vercel's Sydney edge with www 308-redirecting to it — the Squarespace parking site is gone, Google Workspace mail is provably untouched, and HTTPS is the one thing still missing.**

## Performance

- **Duration:** 3h 22m wall clock, the large majority of it waiting at the two blocking checkpoints for the founder's registrar action
- **Started:** 2026-09-09T05:40:00Z
- **Completed:** 2026-09-09T09:02:00Z
- **Tasks:** 3 of 3
- **Files modified:** 2

## Accomplishments

- **Both hostnames attached and the redirect configured** (Task 1, committed before this session): `backdesk.com.au` and `www.backdesk.com.au` on project `backdesk`, apex with no redirect, www with a domain-level 308 — set at Vercel, not in `proxy.ts`, matching the §5 pattern every other alias uses.
- **The record list was built from a post-attach read-back and that changed the answer.** Before attaching, `/v6/domains/backdesk.com.au/config` recommended `76.76.21.21`; after attaching, this project's rank 1 is the anycast pair `216.198.79.1` + `64.29.17.1`. A remembered generic value — or the value `vercel domains inspect` prints in its own warning text — would have published Vercel's second choice.
- **The cut-over is through.** `http://backdesk.com.au/` returns 200 with `Server: Vercel`, `X-Vercel-Id: syd1::…` and the real `<title>Backdesk · Quote chasing for Perth trade businesses</title>`. `http://www.backdesk.com.au/` returns `308` to `https://backdesk.com.au/`. Vercel's `misconfigured` flipped `true` → `false` on both hosts.
- **T-9-17 did not occur.** MX `1 smtp.google.com.`, the SPF TXT, the google-site-verification TXT, `google._domainkey`, `_dmarc` and the `app` CNAME all read back byte-identical on two independent resolvers. `hello@backdesk.com.au` is unaffected by a change that deleted five records next to it.
- **§9's measured column is filled** for every DNS and HTTP row, with the four HTTPS/TLS rows left deliberately empty and labelled `(09-08)`.

## Task Commits

1. **Task 1: Attach apex + www, set the 308, read back the records, write the founder's list** — `c95850d` (docs)
2. **Task 2: Decision checkpoint — cut over now vs defer** — answered `cut-over-now`; recorded in `0825469`
3. **Task 3: Founder publishes the records at Squarespace** — action done by the founder; read-backs and verdict in `0825469` (docs)

**Plan metadata:** see the `docs(09-07): complete the apex + www cut-over plan` commit.

## Files Created/Modified

- `docs/vercel-domains-and-protection.md` — §9 measured column filled; the "apex still serves the Squarespace parking page" paragraph replaced with the post-cut-over state and a note on reading split resolver caches
- `docs/external-registrations.md` — new dated entry `2026-09-09 — Apex cut over`, carrying the founder's verbatim reply, four read-backs (two-resolver DoH, Vercel config, project domain list, HTTP), the split-cache analysis, and the explicit statement that HTTPS does not work yet

## Decisions Made

**1. `cut-over-now` over `defer-cut-over`.** The founder's reply was a single line — `cut-over-now, records published` — which selected the option and reported the action already taken. Deferring would have left LAND-01 unmet and given 09-08's Lighthouse run nothing but the app host to measure.

**2. The `www` record was judged published despite a resolver saying otherwise.** An early Google Public DNS probe answered `ext-sq.squarespace.com.` for `www`, which reads exactly like "the founder skipped that row". Twelve probes per resolver settled it: Cloudflare 12/12 correct, Google 7/12 correct with a fresh 1,800 s TTL and 5/12 stale with **~3,200 s remaining of the old 14,400 s TTL** — an entry that could only have been cached before the edit. Vercel's own config API and a live `308` from `www` both agreed the record exists. Three authorities that cannot be reading Google's cache outrank the cache.

**3. LAND-01 is not marked complete.** The requirement names `https://backdesk.com.au`. Neither host completes a TLS handshake, so a visitor typing the domain gets a browser security failure, not a landing page. The requirement is also declared by 09-08, which the shared-ID gate correctly blocks on. Claiming it here would mean claiming the `s`.

**4. `vercel certs issue` was not run**, even though the need became visible during verification. It belongs to 09-08, the plan that will record its output and take the HTTPS proofs. Running it here would have put an unverified certificate step in a plan with no place to prove it worked.

## Deviations from Plan

None — plan executed exactly as written. The two checkpoints were reached, surfaced and answered in order; no deviation rule fired.

## Issues Encountered

**The plan's scripted Task 3 verification reported FAIL while every fact it tested was true.**

The one-liner is `curl … www CNAME | grep -q vercel-dns && ! curl … apex A | grep -qE '198\.185\.159\.|198\.49\.23\.' && curl … MX | grep -q smtp.google.com`. It ran against Google Public DNS during the split-cache window and drew a stale instance, so condition 1 failed. A second, less obvious effect: `grep -q` closing the pipe early can also flip the chain under `pipefail`, so the failure mode is doubly untrustworthy.

Resolved by decomposing the chain condition by condition, then probing each resolver twelve times instead of once, then corroborating against two authorities that hold no recursive cache (Vercel's config API and a live HTTP request). The finding is written into the evidence entry so 09-08 does not read the same flake as a regression.

**Lesson worth carrying:** a single-probe DNS assertion is unreliable for roughly one prior-TTL after any record change. Where a record previously carried a 4-hour TTL, that is a 4-hour window in which a correct change can be scripted as a failure.

## Known Stubs

None. Both artifacts are complete for this plan's scope; the four empty HTTPS rows in §9's measured column are 09-08's contract, explicitly labelled, not placeholders left behind.

## User Setup Required

The plan's `user_setup` (Squarespace DNS) was **completed by the founder during this plan** at the Task 3 checkpoint. Nothing further is required at the registrar for the landing host.

One thing remains outside the repository and it is 09-08's, not the founder's: no TLS certificate exists for `backdesk.com.au` or `www.backdesk.com.au`.

## Next Phase Readiness

**Ready for 09-08**, which now has a real production host to measure rather than the app host:

- Issue the certificate — `vercel certs issue backdesk.com.au www.backdesk.com.au` (the §2 / Phase 8 finding repeated: Vercel did not auto-issue after this zone change)
- Take the HTTPS proofs and fill the four empty rows in §9's measured column: `curl -sI https://backdesk.com.au/` → `HTTP/2 200`, `curl -sI https://www.backdesk.com.au/` → `HTTP/2 308` to the apex
- Run Lighthouse against the apex over HTTPS
- Re-read MX / SPF / DKIM / DMARC over DoH once more as the durable T-9-17 check
- Then, and only then, mark LAND-01 complete

**Precondition for 09-08 to carry forward:** if any `www` check disagrees with a `backdesk.com.au` check, query a second resolver before treating it as a fault. The stale Google entry expires within about an hour of this plan's close and should be gone; if a stale answer somehow persists past 2026-09-09T10:00Z, that is a real registrar issue and not propagation.

**No blockers.** The one-way door is through and the Squarespace Defaults no longer exist; reverting would mean re-creating five records by hand.

## Self-Check

- `docs/vercel-domains-and-protection.md` — FOUND, contains `Apex + www` (2 occurrences) and the filled measured column
- `docs/external-registrations.md` — FOUND, new entry contains `www.backdesk.com.au`, `ext-sq.squarespace.com` and `smtp.google.com`
- `c95850d` — FOUND in git log (Task 1)
- `0825469` — FOUND in git log (Tasks 2 + 3 evidence)
- Secret gate on staged docs — `git diff --cached docs | grep -ciE "bearer|token=|api_key|secret"` returned `0`
- No file deletions in either commit

## Self-Check: PASSED

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-09*
