---
phase: 08-brand-domains
plan: 04
subsystem: infra
tags: [dns, vercel, resend, dmarc, tls, squarespace, google-workspace, founder-action]

requires:
  - phase: 08-brand-domains
    provides: "08-01/08-02/08-03 — the Backdesk brand build (src/core/brand.ts and every surface reading it), plus docs/vercel-domains-and-protection.md as the DOM-01/02/03 reference skeleton"
  - phase: 04-messaging
    provides: "src/core/messaging/resend-domains.ts (region pinned ap-northeast-1, error-name-not-message house rule) and the /settings/email add-domain + verify console flow"
provides:
  - "backdesk.com.au delegated to Squarespace DNS (option registrar-dns, founder 2026-09-07) and recorded in docs/vercel-domains-and-protection.md §1"
  - "app.backdesk.com.au live: CNAME published, certificate issued, HTTPS 200 in syd1, serving the Backdesk brand build"
  - "quotes.backdesk.com.au sending records published and read back — DKIM, MX 10 feedback-smtp.ap-northeast-1.amazonses.com, SPF, and a monitor-only _dmarc.quotes"
  - "docs/external-registrations.md — the closed 2026-09-08 entry: verbatim founder replies, seven DNS-over-HTTPS read-backs, the Google Workspace apex change, the restricted_api_key incident, and the manual certificate issue"
  - "The standing rule that RESEND_API_KEY must be a Full access key wherever the console runs, and the open local-vs-deployed key drift it created"
  - "The measured finding that a Vercel domain can be verified: true / misconfigured: false for hours and still serve no TLS"
affects: [08-05-repoint-origin, 08-06-rename-and-redirect, 08-07-resend-verification, 09-landing-page, 10-first-client]

actuals:
  tokens: 10500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "DNS read-backs over Google DNS-over-HTTPS (https://dns.google/resolve) when the workspace resolver is a stub — and saying so in the evidence, because a dig that answers nothing is not a failing check"
    - "A live host is proven by curl -sI https://… returning 200, never by a provider status field: verified/misconfigured describe configuration, not service"
    - "A superseded analysis is kept with an outcome-first banner rather than deleted, so the reasoning survives for the next domain that hits the same aspf=s trap"

key-files:
  created: []
  modified:
    - docs/external-registrations.md
    - docs/vercel-domains-and-protection.md

key-decisions:
  - "DNS host: registrar-dns / Squarespace DNS, chosen by the founder 2026-09-07. The zone stays with the founder and the apex stays free for Phase 9"
  - "DMARC option A published — _dmarc.quotes TXT v=DMARC1; p=none; — so the sending subdomain carries its own explicit monitor-only policy and the apex was never touched by this project"
  - "DOM-01 and DOM-03 are deliberately NOT marked complete. The plan's own flagged assumptions say DOM-01 is satisfied only by the server-side proofs in 08-05/08-06 (the default-alias redirect half does not exist yet) and DOM-03 only by the console's VERIFIED_STATUS gate in 08-07. Checking them off on a founder's verbal report would be the exact 'green tick on our screen' failure resend-domains.ts was written against"
  - "The Resend DKIM key is recorded head-and-tail (218 chars, p=MIGf…IDAQAB) rather than in full: it is public DNS data, but an unreadable blob in an evidence log invites the trimming the record exists to prevent"
  - "vercel certs issue was run manually after automatic issuance silently never happened — recorded as an operational finding, not a workaround, because renew: yes means it should not recur but the same asynchrony will apply to the Phase 9 apex"

patterns-established:
  - "Checkpoint closure is evidence, not assertion: the founder's words go in verbatim and every claim they make is separately read back from outside the system, with the two kept visibly distinct"
  - "When a hazard disappears because the world changed rather than because the plan acted, say so — the DMARC section records that Google Workspace removed the strict policy, so nobody later credits the fix to the record we published"

requirements-completed: []

coverage:
  - id: D1
    description: "backdesk.com.au is delegated to the DNS host the founder chose at a recorded decision checkpoint"
    requirement: DOM-01
    verification:
      - kind: other
        ref: "DoH NS backdesk.com.au -> nsc1-nsc4.squarespacedns.com (Status 0); decision reply 'registrar-dns squarespace' 2026-09-07 recorded in docs/vercel-domains-and-protection.md §1"
        status: pass
    human_judgment: false
  - id: D2
    description: "app.backdesk.com.au resolves to the Vercel target, holds a certificate, and serves the Backdesk brand build over HTTPS"
    requirement: DOM-01
    verification:
      - kind: other
        ref: "DoH CNAME app.backdesk.com.au -> 956ea6eb7ab36544.vercel-dns-017.com. (byte-identical to the rank-1 target); curl -sI https://app.backdesk.com.au/login -> HTTP/2 200, x-vercel-id syd1::syd1; body has 6x 'Backdesk', 0x 'Quote Recovery'; vercel certs ls -> cert_p3jSDu5X3aPicm9mpGkugVo1"
        status: pass
    human_judgment: false
  - id: D3
    description: "The four Resend records for quotes.backdesk.com.au are published exactly as the console rendered them"
    requirement: DOM-03
    verification:
      - kind: other
        ref: "DoH: resend._domainkey.quotes TXT present (218 chars, one unbroken string); send.quotes MX 10 feedback-smtp.ap-northeast-1.amazonses.com.; send.quotes TXT v=spf1 include:amazonses.com ~all; _dmarc.quotes TXT v=DMARC1; p=none; — all Status 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "quotes.backdesk.com.au is Verified at Resend"
    verification: []
    human_judgment: true
    rationale: "The founder's report ('resend is now verified') is the only source available here — the agent has no console session and no Full-access key to query the domain object. 08-07 re-checks it against the code's VERIFIED_STATUS gate as its own precondition; DOM-03 stays Pending until then"
  - id: D5
    description: "The apex hostname carries no record placed by this project (the D-05 prohibition)"
    requirement: DOM-01
    verification:
      - kind: other
        ref: "DoH A backdesk.com.au -> the four pre-existing Squarespace parking IPs only; every other apex record (MX smtp.google.com, SPF _spf.google.com, google._domainkey, _dmarc rua) is the founder's own Google Workspace connect, documented as such in docs/vercel-domains-and-protection.md §1"
        status: pass
    human_judgment: false
  - id: D6
    description: "APP_BASE_URL=https://app.backdesk.com.au is set in .env.local"
    verification: []
    human_judgment: true
    rationale: "This workspace is denied reads and writes on .env* files, so the operator's statement is the only evidence obtainable here. 08-05 proves it substantively by running cron:apply / clicksend:setup and reading back the origin they register"

duration: 6min
completed: 2026-09-08
status: complete
---

# Phase 08 Plan 04: DNS delegation, console host, and the founder's record list — Summary

One founder round-trip took `backdesk.com.au` from an undelegated name to a live console at `https://app.backdesk.com.au` and a fully-published Resend sending domain — and turned up three things the plan did not anticipate: a Google Workspace connect that dissolved the DMARC conflict, a Resend key too restricted to create a domain, and a Vercel certificate that reported itself fine while issuing nothing.

## What happened

Tasks 1 and 2 ran on 2026-09-07/08 (decision `registrar-dns squarespace`; commit `7886339` attached the domain, deployed the brand build and wrote the record list). This session resolved **Task 3**, the `checkpoint:human-action`, after the founder published the records and reported Resend verified.

**Every DNS read-back was taken over Google DNS-over-HTTPS**, not `dig`. The resolver in this workspace is a stub that returns an empty answer for every query — so the plan's seven `dig +short` acceptance criteria could not be run as written, and a `dig` here would have produced the same empty output for a published record and an absent one. That distinction is recorded in both docs, because it is the difference between a check that passed and a check that cannot fail.

All seven checks passed:

| Check | Result |
|---|---|
| `NS backdesk.com.au` | `nsc1`–`nsc4.squarespacedns.com.` — the host chosen in Task 1 |
| `CNAME app.backdesk.com.au` | `956ea6eb7ab36544.vercel-dns-017.com.` — byte-identical to the rank-1 target Vercel issued |
| `TXT resend._domainkey.quotes` | present, 218 chars, one unbroken string (not chunked) |
| `MX send.quotes` | `10 feedback-smtp.ap-northeast-1.amazonses.com.` |
| `TXT send.quotes` | `v=spf1 include:amazonses.com ~all` |
| `TXT _dmarc.quotes` | `v=DMARC1; p=none;` |
| `A backdesk.com.au` | the four pre-existing Squarespace parking IPs, unchanged — no A or CNAME added on the apex by anyone |

## The three surprises

**1. Google Workspace landed on the apex and dissolved the DMARC dilemma.** The plan's 5a/5b choice existed because a strict `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` sat on the organisational domain, and `sp=reject` + `aspf=s` is a live hazard for `quotes.backdesk.com.au` — Resend's `send.quotes…` return-path makes strict SPF alignment fail by construction, leaving every send resting on DKIM alone with `reject` as the penalty. Connecting Workspace for `hello@backdesk.com.au` replaced that policy with `v=DMARC1; p=none; rua=mailto:hello@backdesk.com.au`. So the hazard is gone **at its source**, and the `_dmarc.quotes` record the founder also published (option A) is now belt-and-braces rather than the fix. The apex records are the founder's mail, not Backdesk's sending path, and both docs say so explicitly so a later reader does not mistake `smtp.google.com` for ours.

Two live consequences, neither a defect: the apex DMARC now carries a `rua=` tag that Pitfall 8 advised against — defensible now that a real mailbox exists, but aggregate-report XML will genuinely arrive there, and it is Google's default rather than our choice. The subdomain record deliberately keeps no `rua`.

**2. `restricted_api_key` — a sending key cannot create a domain.** The operator's first add-domain attempt failed with that error name on screen. This is `resend-domains.ts` house rule 2 working exactly as designed: the provider's error *name* is the classification and it named the cause in one word, with no request detail leaked. A *Sending access* key sends mail but cannot create or read domain objects. The operator issued a Full access key, redeployed, and the add succeeded. Recorded as a standing rule — and as an **open item**, because the key value changed and `.env.local` may still hold the old one while the deployment holds the new.

**3. `verified: true` did not mean HTTPS worked.** Vercel reported `configuredBy: "CNAME"`, `conflicts: []`, `misconfigured: false`, `verified: true` — and for hours the TLS handshake closed with no peer certificate while `vercel certs ls` was empty. Plain HTTP returned 200 the whole time, which is what made it look fine from the wrong angle. `vercel certs issue app.backdesk.com.au` fixed it on the first try (`cert_p3jSDu5X3aPicm9mpGkugVo1`, 90d, `renew: yes`). HTTPS now returns `HTTP/2 200` from `syd1` and serves 6 occurrences of "Backdesk" and 0 of "Quote Recovery".

One cosmetic trap is documented alongside it: `vercel domains inspect` prints the four Squarespace nameservers with a **✘** against "Intended `ns1/ns2.vercel-dns.com`". That is not a fault — it compares the zone against Vercel-managed DNS, which Task 1 deliberately did not choose.

## Deviations from Plan

**1. [Rule 3 — Blocking] DNS read-backs taken over DNS-over-HTTPS instead of `dig`.** The plan's verification block is written as seven `dig +short` commands; the workspace resolver is a stub returning nothing for every query, so those commands are incapable of distinguishing a published record from an absent one. Substituted `curl -s https://dns.google/resolve?name=…&type=…` and recorded the substitution in both documents rather than silently reporting "dig passed". Same authority, honest provenance. No commit of its own — part of `d196e25`.

**2. [Rule 2 — Missing critical information] Recorded three findings the plan never asked for.** The `restricted_api_key` cause and its Full-access rule, the Google Workspace apex rewrite, and the certificate that never auto-issued are all operational facts that later plans will hit blind: 08-05 and 08-07 read a possibly-stale local Resend key, 08-07's DMARC reasoning depends on the apex having changed, and Phase 9's apex will meet the same certificate asynchrony. Each is written into `docs/vercel-domains-and-protection.md` at the section that owns it, not only into the dated entry.

**3. [Judgment — recorded, not auto-applied] `requirements-completed` left empty.** The plan's frontmatter claims `[DOM-01, DOM-03]`, but its own flagged-assumptions block says DOM-01 is satisfied only by the server-side proofs in 08-05/08-06 and DOM-03 only by the console's `VERIFIED_STATUS` gate in 08-07 — and 08-05/08-06/08-07 each claim the same IDs. The default-alias redirect half of DOM-01 does not exist yet, and DOM-03's verified badge is a founder's verbal report here. `requirements.mark-complete` was therefore **not** run and both stay Pending in `REQUIREMENTS.md`.

## Known Stubs

None. This plan produced documentation only; no code path was added, stubbed or skipped.

## Open items handed forward

| Item | Who picks it up |
|---|---|
| Confirm `.env.local` and the deployment hold the **same Full access** `RESEND_API_KEY` before trusting any local run | 08-05, 08-07 |
| Read the Resend console badge against `VERIFIED_STATUS` — DOM-03 flips only there | 08-07 |
| The default `*.vercel.app` → `app.backdesk.com.au` 308 redirect — the other half of DOM-01 | 08-06 |
| Prove `APP_BASE_URL` substantively by reading back the origin `cron:apply` / `clicksend:setup` register | 08-05 |
| Aggregate DMARC reports will begin arriving at `hello@backdesk.com.au` | operational, no action |
| Apply the "a live host is a 200 over HTTPS, not a status field" rule to the Phase 9 apex | 09 |

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | — | Decision checkpoint; recorded in Task 2's write |
| 2 | `7886339` | Domain attached, brand build deployed, founder record list written |
| — | `78d1790` | Open checkpoint recorded in STATE |
| 3 | `d196e25` | Founder confirmation, read-backs, and the three findings |

## Self-Check: PASSED

- `docs/external-registrations.md` — FOUND, contains the closed `Founder confirmation — 2026-09-08` section
- `docs/vercel-domains-and-protection.md` — FOUND, §1/§2/§3/§8 updated with measured values
- `.planning/phases/08-brand-domains/08-04-SUMMARY.md` — FOUND
- Commit `7886339` — FOUND; `78d1790` — FOUND; `d196e25` — FOUND
- `grep -cE 'Bearer |re_[A-Za-z0-9]{10,}'` on both docs — **0**, unchanged from before the task
- `git diff --diff-filter=D HEAD~1 HEAD` — no deletions
