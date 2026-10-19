# Backdesk domains, DNS and deployment protection

The reference for DOM-01 (custom domain + rename), DOM-02 (deployment protection)
and DOM-03 (Resend sending domain): **what record was asked for, what was actually
observed, and where the proof lives**. It is written in the style of
`docs/servicem8-api-notes.md` — a documented column and a measured column, because
a DNS or protection claim read off a docs page is not the same thing as one
observed against this project.

- **Started:** 2026-09-06 (Phase 8, Plan 08-01) — record *shapes* only; no DNS existed yet
- **Measured rows** are filled by the dated entries in `docs/external-registrations.md`;
  this file links to them rather than repeating them
- **Secrets discipline:** identifiers, hostnames and dates only. No token, key or
  bypass secret is ever written here (same rule as `docs/external-registrations.md`)
- **Scope (D-05):** only `app.backdesk.com.au` is attached this phase. The apex
  `backdesk.com.au` is reserved for the Phase 9 landing page and `backdesk.au` gets
  no records at all

---

## 1. DNS host for backdesk.com.au

Where the zone is authoritatively served, and the date it was delegated there. The
choice matters for one reason beyond convenience: the host must be able to serve a
**non-proxied** CNAME. A proxying front end (Cloudflare's "orange cloud") breaks
Vercel certificate issuance and Resend verification alike.

| Fact | Value |
|---|---|
| Registrar | **Squarespace Domains** |
| DNS host serving the zone | **Squarespace DNS** — option `registrar-dns`, chosen by the founder 2026-09-07 |
| Delegated / confirmed on | **2026-09-08** — `dig +short NS backdesk.com.au` returns `nsc1`–`nsc4.squarespacedns.com` |
| Proxying disabled (DNS-only) | **N/A — Squarespace DNS has no proxy mode.** Every record is served authoritatively, so the orange-cloud failure in Pitfall 7 cannot occur here |

The zone was found **already delegated** when Plan 08-04 ran: research recorded
NXDOMAIN on 2026-09-06, and by 2026-09-08 the founder had pointed the registrar at
Squarespace's own nameservers. Delegation is therefore not a blocker for any
remaining plan — only the individual records are.

**Squarespace DNS panel notes** (Settings → Domains → the domain → DNS Settings →
Custom Records): CNAME, TXT and MX are all supported; MX priority is a separate
field; a long DKIM `p=…` value must be entered as **one single string** (the panel
does not chunk it, and chunking it by hand breaks the key).

**Records in the apex zone, none of them ours** (read back 2026-09-08 after the
founder connected Google Workspace — the SPF and DMARC rows had *different values*
when Plan 08-04 started; see §3):

| Name | Type | Value | Whose, and what it means |
|---|---|---|---|
| `@` | A ×4 | `198.185.159.144/145`, `198.49.23.144/145` | Squarespace parking. The apex is reserved for Phase 9 — leave these alone |
| `@` | MX | `1 smtp.google.com.` | **Google Workspace** — the founder's own mail at `hello@backdesk.com.au`. Not Backdesk's sending path, which is `quotes.backdesk.com.au` (§3) |
| `@` | TXT | `v=spf1 include:_spf.google.com ~all` | Google Workspace. **Replaced the earlier `v=spf1 -all`.** Still no bearing on `send.quotes.backdesk.com.au` — SPF is not inherited by subdomains |
| `@` | TXT | `google-site-verification=vWZK2lryw39-…` | Google Workspace domain proof |
| `google._domainkey` | TXT | `v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A…` | Google Workspace DKIM |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:hello@backdesk.com.au` | Google Workspace. **Replaced `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s`** — which is what made the §3 conflict disappear |

**The apex carries no record placed by this project, and never will before Phase 9.**
The rows above are the registrar's parking and the founder's mail. D-05 holds.

## 2. app.backdesk.com.au (Vercel)

The console host. The record below is added by the founder at the DNS host; the
value is **project-specific** and must be pasted verbatim from
`vercel domains inspect app.backdesk.com.au` — Vercel issues a per-project CNAME
target, and a remembered generic value is not a substitute.

| Purpose | Type | Name (zone-relative) | Value | Note |
|---|---|---|---|---|
| Console host | CNAME | `app` | `956ea6eb7ab36544.vercel-dns-017.com.` | DNS-only, no proxy. Read from `vercel domains verify --format=json` on 2026-09-08 |
| Domain verification | TXT | `_vercel` | ~~not demanded~~ | Not required: the domain is already owned inside the scope, so `verify` reports `"verified": true, "verification": []`. No TXT to add |

The CNAME value above is the **project-specific** target Vercel issued for this
project (`rank: 1`). Vercel also offers `cname.vercel-dns.com` as a rank-2
general-purpose value and, in the human-readable `vercel domains inspect` output,
an `A app.backdesk.com.au 76.76.21.21` alternative. Prefer the rank-1 CNAME: it is
the value the API names first, and it survives IP changes that a pinned A record
would not.

Domain attached to the project on **2026-09-08** (`vercel domains add
app.backdesk.com.au quote-recovery-mvp` → `domain_added`).

### Measured — 2026-09-08, after the founder published the CNAME

| Fact | Documented | Measured |
|---|---|---|
| `CNAME app.backdesk.com.au` | `956ea6eb7ab36544.vercel-dns-017.com.` | **identical** — read back over Google DNS-over-HTTPS |
| Vercel's own view | configured | `configuredBy: "CNAME"`, `conflicts: []`, **`misconfigured: false`**, `verified: true` |
| TLS certificate | auto-issued on verification | **did not auto-issue.** Hours after `verified: true` the TLS handshake closed with no peer certificate and `vercel certs ls` was empty. `vercel certs issue app.backdesk.com.au` fixed it immediately → `cert_p3jSDu5X3aPicm9mpGkugVo1`, expires in 90d, `renew: yes` |
| `curl -sI https://app.backdesk.com.au/login` | 200 | **`HTTP/2 200`**, `server: Vercel`, `x-vercel-id: syd1::syd1::…`, HSTS `max-age=63072000` |
| `curl -sI http://app.backdesk.com.au/login` | — | **308** → the `https://` URL |
| What it serves | the brand build | 6 occurrences of "Backdesk", **0** of "Quote Recovery" |

**Two traps recorded so nobody re-learns them:**

1. **`verified: true` and `misconfigured: false` do not mean the host serves HTTPS.**
   Certificate issuance is a separate asynchronous step and here it silently never
   ran. The proof of a live host is `curl -sI https://…` returning 200 — never a
   status field. Apply the same rule to the apex in Phase 9.
2. **`vercel domains inspect` prints the four Squarespace nameservers with a ✘** next
   to "Intended Nameservers `ns1/ns2.vercel-dns.com`". That is **not a fault** — it
   compares the zone against Vercel-managed DNS, which Task 1 deliberately did not
   choose. Read `misconfigured` from the config API instead.

**The attach is complete and the host is load-bearing as of 2026-09-08.** Plan 08-05
re-pointed every consumer of `APP_BASE_URL` at this hostname — the Vercel env in
Production and Preview, all four pg_cron targets, and both ClickSend automation rules —
each proven by a server-side artefact (`net._http_response` 200s on both tick schedules;
the ClickSend rule read-back; a synthetic inbound row that could only exist if the webhook
route parsed here). `quote-recovery-mvp.vercel.app` still resolves and still serves, but
**nothing references it any more**, which is the precondition D-06 step 3 waits on.

Remaining proofs for 08-06: the default-alias redirect and the deployment
protection rows in §5–§7.

## 3. quotes.backdesk.com.au (Resend)

The service-owned sending domain. Records are placed **on the subdomain**; the apex
needs nothing for Resend. The console table at `/settings/email` is canonical — the
shapes below are what to expect, not what to paste.

**All four are published and read back as of 2026-09-08** (Plan 08-04 Task 3, over
Google DNS-over-HTTPS — the local resolver in the agent workspace is a stub and
`dig` proves nothing there):

| Purpose | Type | Name (zone-relative) | Value | Measured 2026-09-08 |
|---|---|---|---|---|
| DKIM | TXT | `resend._domainkey.quotes` | the console's `p=…` key, pasted whole | **present**, 218 chars, one unbroken string — full value below. Never re-typed, never trimmed |
| SPF (return-path) | MX | `send.quotes` | `feedback-smtp.ap-northeast-1.amazonses.com` (priority 10) | **exact**, priority 10, region host correct |
| SPF | TXT | `send.quotes` | `v=spf1 include:amazonses.com ~all` | **exact** |
| DMARC | TXT | `_dmarc.quotes` | `v=DMARC1; p=none;` | **exact**, and **no `rua=`** — option A was taken; see the resolution block below. The *apex* `_dmarc.backdesk.com.au` answers `v=DMARC1; p=none; rua=mailto:hello@backdesk.com.au`, which is Google Workspace's, not ours |

**The published DKIM value, in full** (a public key; safe to record, and recorded here so
a future re-paste can be diffed rather than re-typed):

```
resend._domainkey.quotes.backdesk.com.au.  1800  IN  TXT  "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDkSeecbZVN9dn6ZLrrxU+qTcO80HW1psFX5oLzKk0aocuTGsN6M/QuOzdGKAGhScmp4lJKJgy+61B+2F8hwkEPS2ELWGbrFKvtmPnuqw9TiwZAMEoY+Ir7mnFke9l8KdiHqAFvcQrbbXxLwPV/oZwxnrTdiKogP7NV4CalM2folwIDAQAB"
```

**Verified — measured 2026-09-08 (Plan 08-07).** The founder reported the badge Verified,
and the status behind it was then read directly from Resend, read-only, no mail sent:

```
GET https://api.resend.com/domains  → HTTP 200
  name=quotes.backdesk.com.au  status=verified  region=ap-northeast-1
  id=7cac62f6-391e-4d1d-bb03-45ef52994deb  created=2026-09-08T06:25:32Z
```

`status=verified` is the exact string `VERIFIED_STATUS` gates on
(`src/core/messaging/resend-domains.ts`), and `region=ap-northeast-1` is the exact string
`EMAIL_DOMAIN_REGION` pins — so the domain is verified *by the test the code applies*, not
by a badge someone read. What remains a human-check is only the **rendering**: that
`/settings/email` displays that status, the region and the residency note. See the 08-07
SUMMARY.

### `RESEND_API_KEY` must be a **Full access** key, not a sending key

Adding the domain failed on the first attempt with Resend's error name
**`restricted_api_key`** rendered in the console (2026-09-08). A *Sending access* key
can send mail but cannot create or read domain objects, so the `/settings/email`
add-domain flow refuses. The operator issued a Full access key, updated the deployment
and redeployed; the add then succeeded and the domain verified.

The failure surfaced correctly and needed no code change:
`src/core/messaging/resend-domains.ts` house rule 2 puts the provider's error **name**
on screen and never its message, and `restricted_api_key` named the cause in one word
without leaking the request.

**Open item, CLOSED on the local side 2026-09-08 (Plan 08-07).** The worry was that
`.env.local` still held the old *Sending access* key while the deployment held the new
Full access one — the drift class of the 2026-08-29 entry in
`docs/external-registrations.md`. The domain read above was made **with the local key**
and returned `HTTP 200` with the domain listed; a Sending-access key cannot read domain
objects and would have answered `restricted_api_key`. So the local key is a Full access
key, and `scripts/verify-email-pipe.mjs` and any other local run can be trusted with it.

What is *not* proven, and cannot be without printing either value: that the local key and
the Vercel key are the same key. Both are Full access and both work; if they are two
different Full-access keys nothing misbehaves, so this is a bookkeeping question rather
than a live hazard. The 2026-08-29 failure mode — two values that differ in a way both
ends report as healthy — does not apply here, because a wrong key here fails loudly with
a named error rather than silently.

**Region: `ap-northeast-1` (Tokyo).** Resend offers only North Virginia, Ireland,
São Paulo and Tokyo — there is no AU region, and Tokyo is the closest. Region is
fixed at creation: changing it means deleting the domain and re-adding it, which
invalidates the DKIM record. `EMAIL_DOMAIN_REGION` in
`src/core/messaging/resend-domains.ts` already carries this value and is test-pinned.

### The pre-existing DMARC record — RESOLVED 2026-09-08 (kept for the reasoning)

> **Outcome first.** Option **A** was published: `_dmarc.quotes` TXT `v=DMARC1; p=none;`.
> Separately, and not at our request, the founder connected **Google Workspace** on the
> apex, which **replaced** the strict organisational policy with
> `v=DMARC1; p=none; rua=mailto:hello@backdesk.com.au`. So the hazard below was removed
> at its source as well as overridden at the subdomain — the `_dmarc.quotes` record is
> now belt-and-braces rather than the load-bearing fix. Nothing publishes two DMARC
> records at one name, and the apex was never touched by this project.
>
> Two live consequences: the **apex** DMARC now carries a `rua=` tag, which Pitfall 8
> advised against — defensible now that `hello@backdesk.com.au` is a real mailbox, but
> aggregate-report XML will genuinely start arriving there and it is Google's default,
> not our choice. The **subdomain** record deliberately keeps no `rua`.
>
> The analysis below is retained because it is why option A was the right shape, and
> because the same `aspf=s` trap will apply to any client domain that publishes one.

Squarespace had already published a DMARC policy on the organisational domain:

```
_dmarc.backdesk.com.au.  14400  IN  TXT  "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s"
```

This was not anticipated by the phase research, and it breaks the record list in two
separate ways:

1. **Adding a second `_dmarc` TXT is worse than adding none.** RFC 7489 §6.6.3 says a
   domain publishing more than one DMARC record at the same name is treated as having
   **no** record at all. So `v=DMARC1; p=none;` must *replace* the existing value, not
   sit beside it — or go on a different name.
2. **`sp=reject` with strict alignment is a live hazard for `quotes.backdesk.com.au`.**
   Subdomains inherit `sp`, so mail from the sending domain is subject to `reject`.
   `aspf=s` (strict SPF alignment) requires the return-path domain to equal the From
   domain exactly — but Resend's return-path is `send.quotes.backdesk.com.au`, a
   *subdomain* of the From domain, so **SPF alignment fails by construction**. DMARC
   still passes as long as DKIM passes (`d=quotes.backdesk.com.au` aligns strictly),
   but that leaves every send resting on DKIM alone with `reject` as the penalty for
   any lapse. That is the opposite of the "start at monitor-only, tighten with
   sending history" posture DOM-03 asks for.

**The two resolutions that were offered** (Research A5 reserved exactly this objection
point) — **A was published**:

| | What to publish | Effect | Trade-off |
|---|---|---|---|
| **A — subdomain policy (recommended)** | **Add** `_dmarc.quotes` TXT `v=DMARC1; p=none;` | A DMARC record on the subdomain overrides the organisational `sp=reject` for `quotes.backdesk.com.au` only | The apex keeps `p=reject` + `v=spf1 -all`, which is the correct posture for a domain that sends no mail. **Nothing in the apex zone is touched at all**, which also honours D-05 more literally than the original plan did |
| **B — plan default** | **Edit** the existing `_dmarc` TXT, replacing its value with `v=DMARC1; p=none;` | Monitor-only across the whole organisational domain | Deliberately gives up a strict anti-spoofing policy the founder already has for free, on an apex that sends nothing. Harder to justify now that the record is known to exist |

Either way the aggregate-report address tag stays absent (Pitfall 8 — no mailbox
exists to receive the reports it would commit us to reading), and
the policy is tightened only once `quotes.backdesk.com.au` has sending history.

**On the DMARC record:** the aggregate-report address tag is deliberately omitted.
RFC 7489 §7.1 makes publishing a report address a commitment to receive and process
what arrives at it; an address nobody reads is worse than no tag, and there is no
mailbox for it yet. `p=none;` is monitor-only and is tightened once the domain has
sending history.

## 4. From-address conventions

| Use | Address | Where it is set |
|---|---|---|
| Cadence email, service-owned identity | `followups@quotes.backdesk.com.au` | `messaging_config.from_address` (data, not code) — armed per tenant in Phase 10 |
| Cadence email, per-client identity | `…@<the client's own verified domain>` | The default path; the service domain is the fallback |
| Operator alerts | `Backdesk <alerts@quotes.backdesk.com.au>` | `OPERATOR_ALERT_FROM` (existing env var) — **live**: pushed to Production and Preview 2026-09-08T09:46:16Z and redeployed 31s later |

Before verification, alerts fell back to `DEFAULT_ALERT_FROM` in `src/core/brand.ts` —
Resend's pre-verification sender, which delivers only to the account owner. That is
exactly who an operator alert is for, so the fallback was never a degraded mode. Both
alert modules resolve `from = env.OPERATOR_ALERT_FROM ?? DEFAULT_ALERT_FROM` **at send
time**, so the switch needed no code change and the fallback is still there if the
variable is ever removed.

**Status of each row, honestly:**

| Row | State on 2026-09-08 |
|---|---|
| `followups@quotes.backdesk.com.au` (cadence, service identity) | **Convention only.** Shipped as the form placeholder in 08-02 and used by the tests; **no `messaging_config` email row is enabled**, so no cadence email can be sent. Arming is DOM-04 / ARM-02, Phase 10 (D-11) |
| per-client identity on the client's own verified domain | The default path. Unchanged; nothing to configure until a client onboards |
| `Backdesk <alerts@quotes.backdesk.com.au>` (operator alerts) | **Configured and deployed.** The From header itself is **event-gated — see entry "2026-09-08 — quotes.backdesk.com.au verified at Resend; OPERATOR_ALERT_FROM pushed"**: the stalled digest sends nothing when there is nothing to report, so the header is observed on the first real alert or on the Phase 10 go-live checklist. Manufacturing a stalled fixture on the production database to force one was refused |

## 5. Default alias redirect (post-rename)

The default `*.vercel.app` production domain redirects **308** to
`https://app.backdesk.com.au`.

- Configured in Vercel domain settings ("Redirect to"), **not** in `next.config.ts` —
  a redirect in code would add a hop to every request on the custom domain, and the
  console must open fast on a phone
- The redirect is a property of the *domain name*, so it is applied to the **new**
  default domain **after** the rename, never to the custom domain
- 308 is permanent and method-preserving: the old host must never be bookmarked again
- Vercel's KB says pre-rename generated URLs are released rather than redirected,
  which is why nothing may still reference the old host at rename time (D-06). **In
  practice on 2026-09-08 nothing was released at all** — see the findings below.
  Treat the KB sentence as the guarantee you are *not* given, not as a prediction of
  what happens: plan as if the old host dies, then check whether it did

| Fact | Documented | Measured |
|---|---|---|
| New default domain after the rename | Suffixed (`backdesk.vercel.app` is owned by a third party) | **`backdesk-hesams-projects-432a48c6.vercel.app`** — the suffix is the **team slug**, not a random string. Read back from `targets.production.alias`, and only *after* a redeploy: see the finding below |
| Redirect status / target | 308 → `https://app.backdesk.com.au` | **`HTTP/2 308`**, `location: https://app.backdesk.com.au/login` — path preserved. Measured 2026-09-08 09:33Z, and again after protection was enabled |
| Every other `*.vercel.app` production alias | not anticipated | **also 308 → `https://app.backdesk.com.au`** — five hosts in total (see the table below) |

### Two findings the plan did not expect (2026-09-08)

**1. The rename released nothing, and minted nothing.** Immediately after
`vercel project rename`, `targets.production.alias` still listed the four *old*
hosts and both `backdesk-…vercel.app` names answered **404**. Generated aliases
belong to a *deployment*, not to a project name, so they only move when a
deployment is created. A production redeploy minted them. **A rename with no
deployment behind it leaves every old URL live and the new one non-existent** —
so "rename, then configure the redirect" is really "rename, deploy, read back,
then configure the redirect".

**2. Nothing was released, so nothing had to be.** `quote-recovery-mvp.vercel.app`
is a *registered project domain*, not a generated alias, and the rename left it
attached and serving. The two old generated aliases stayed pinned to the
pre-rename deployment and kept serving too. The plan assumed all three would
vanish. Given they did not, **they were kept and redirected rather than deleted**:
a name we still own cannot be claimed by a stranger and pointed at the brand
(threat T-8-02), and any external bookmark lands on the console instead of a 404.
Deleting them is still available at any time; it is the irreversible direction, so
it was not taken by default.

**How the redirect was attached.** A generated alias is not in
`GET /v9/projects/{id}/domains`, so `PATCH …/domains/{alias}` answers
`Project Domain not found (404)`. `POST /v10/projects/backdesk/domains` accepts it
— the alias registers as a project domain (`verified: true`) and then takes
`redirect` + `redirectStatusCode` like any other. That is the mechanism behind
every 308 row above; no code was involved.

### Every host this project answers on, measured 2026-09-08 after both changes

| Host | Result | Why |
|---|---|---|
| `app.backdesk.com.au` | **200** | The console. Custom production domain — public by design, no redirect hop |
| `backdesk-hesams-projects-432a48c6.vercel.app` | **308** → custom domain | The new default alias (DOM-01) |
| `backdesk-git-main-hesams-projects-432a48c6.vercel.app` | **308** → custom domain | Production-branch alias; see §6 (b) for why a redirect and not an auth wall |
| `quote-recovery-mvp.vercel.app` | **308** → custom domain | The old default; retained, not released |
| `quote-recovery-mvp-hesams-projects-432a48c6.vercel.app` | **308** → custom domain | Old generated alias |
| `quote-recovery-mvp-git-main-hesams-projects-432a48c6.vercel.app` | **308** → custom domain | Old generated alias |
| `backdesk-<hash>-hesams-projects-432a48c6.vercel.app` (any deployment URL) | **302** → `vercel.com/sso-api` + `_vercel_sso_nonce` | Deployment URL — walled by Standard Protection |
| `backdesk.vercel.app` | 200, **not ours** | A third party's static site. Never touched, never claimed |

`next.config.ts` and `proxy.ts` were not opened. `vercel.json` still pins
`regions: ["syd1"]`.

## 6. Deployment Protection (Standard, Hobby)

Vercel Authentication at **Standard Protection**: preview deployments and all
automatically generated domains require a Vercel login; production domains stay
public. This is the whole of what the Hobby plan offers, and it is exactly what
DOM-02 asks for.

| D-07 question | Documented | Measured |
|---|---|---|
| (a) Does the custom production domain `app.backdesk.com.au` stay public? | Yes — "your production domain remains publicly accessible" on Hobby; protecting production needs Pro/Enterprise. So the pg_cron ticks, ClickSend callbacks and the unsubscribe page need no bypass | **Confirmed.** `/login` **200**, `/api/unsubscribe` **200** after protection was on. The wrong-bearer POST to `/api/internal/cadence-tick` returned **our own** `401` (`content-type: text/plain`, body `unauthorized`, **no** `_vercel_sso_nonce`) — Pitfall 6 satisfied. `net._http_response` recorded **200 at 09:35:00, 09:35:00, 09:36:00 and 09:37:00Z**, all after the 09:34Z change, covering both tick schedules |
| (b) Does the protected default alias still redirect before the auth wall? | Probably — `<project>.vercel.app` is itself listed as a production domain, while the `-<scope>` / `-git-main-<scope>` aliases are the generated domains that get protected. **MEDIUM confidence**: the docs never say it in one sentence | **Yes — A1 holds, but the boundary is not where research drew it.** The default alias returns **308** with `location: https://app.backdesk.com.au/login` *with Standard Protection on*: no wall, no login. The correction is in the second half of the claim — **the `-git-main-` alias was measured at plain `200`, not `401`**, on a fresh origin hit (`x-vercel-cache: MISS`). The July-2025 changelog line about generated production-branch domains did **not** hold here. What Standard Protection actually walls on this project is the **deployment URL** (`backdesk-<hash>-<team>.vercel.app` → `302` to `vercel.com/sso-api` with `_vercel_sso_nonce`); anything aliasing the *production* deployment stays public, exactly as the Hobby sentence says. So the git-main alias was given the **same 308 redirect** — the outcome DOM-02 wants (no unbranded host serving the console) reached through the redirect rather than the auth wall |
| (c) Does any automation target preview URLs? | No — remote tests hit Supabase directly and CI never deploys, so no Protection Bypass secret is required | **Confirmed, and acted on.** Nothing broke when the wall went up: all four ticks kept returning 200, and they are the only automation that calls this system over HTTP. The one pre-existing bypass secret was **removed** the same day (§7) and nothing noticed |

The fallback prepared for a false (b) — "drop the redirect expectation and document
that the generated URLs are private by design" — was **not needed for the default
alias**, which redirects for anonymous visitors. It was needed for the *reverse*
surprise: the git-main alias is **public**, not private. It is redirected, not walled.

**What is honestly delivered on Hobby, in one line:** every preview and deployment
URL requires a Vercel login; every production `*.vercel.app` alias 308s to
`app.backdesk.com.au`; `app.backdesk.com.au` is public and un-hopped. There is no
host left that serves this console under a non-Backdesk name.

Protection is enforced **before** the application, including before routing
middleware — `proxy.ts` exclusions exempt nothing from it. Only the scope does.

## 7. Protection Bypass for Automation

**No script, environment variable or workflow in this repository uses a Protection
Bypass secret**, and none should: nothing in the automation path targets a preview
or generated URL.

**The stray pre-existing bypass secret was REMOVED on 2026-09-08** (Plan 08-06,
Task 3). Before: `protectionBypass` held exactly **one** key, scope
`automation-bypass`, created `2026-09-06T08:28:45Z`. After
`PATCH /v1/projects/backdesk/protection-bypass` with `{"revoke":{"secret":…,
"regenerate":false}}`, `GET /v9/projects/backdesk` reports **zero** keys. It was
revoked, not rotated — there is nothing to rotate *for*. No value of it was ever
printed, logged, written to a file or carried into a commit: the key was piped from
the read response straight into the revoke body, and the revoke response was
suppressed because it echoes key material.

Note the endpoint prefix: protection-bypass lives on **`/v1/`**, not on the `/v9/`
project routes.

If one is ever genuinely needed, it is available on all plans and is passed as a
request header or query parameter — it would be stored as a deployment environment
variable and never written into this file or any other file in the repo.

## 8. Proof index

Dated entries in `docs/external-registrations.md` that carry the observed evidence
for the rows above. Plans 08-04 through 08-07 append their entry titles here as they
land.

- **2026-09-08 — DNS delegation decided, app.backdesk.com.au attached (pending), founder record list** (Plan 08-04) — the Squarespace decision, the `vercel domains add` / `verify` output, the CNAME target in §2, the apex records in §1, and the full record list handed to the founder. **Closed the same day** by its own "Founder confirmation — 2026-09-08" section, which carries: the verbatim replies, the seven DNS-over-HTTPS read-backs, the Google Workspace apex change that dissolved the §3 DMARC conflict, the `restricted_api_key` failure and its Full-access fix, and the manual `vercel certs issue` that turned a `verified: true` domain into a host that actually serves HTTPS
- **2026-09-08 — app.backdesk.com.au serves production (old alias still live)** (Plan 08-05, Task 1) — D-06 step 1 proven from outside: `vercel domains verify` `configured-correctly`, the certificate row, `HTTP/2 200` on the custom host, the route's own `text/plain` 401 to a wrong bearer (not Vercel's SSO wall), the old alias still 200, and the pre-switch `cron:status` baseline showing all four jobs green on the OLD origin with zero lease rows
- **2026-09-08 — URL switch: APP_BASE_URL, four pg_cron targets and both ClickSend rules now point at app.backdesk.com.au** (Plan 08-05, Task 2) — D-06 step 2 end to end: the env push and the `updatedAt` that proves it (`vercel env ls`'s `created` column does **not** move on an overwrite), the redeploy, the `cron:status` before/after showing all four jobs move origin, four consecutive post-switch `net._http_response` 200s covering both tick schedules, the ClickSend step-2 wrong-token 401s and real-token 200s on the new host, both rules read back as exactly one each, and the synthetic inbound row that proves the webhook parses on the custom domain. `--activate` not passed; the old alias still live but unreferenced
- **2026-09-08 — Vercel project renamed to backdesk; what the rename actually released (and what it did not)** (Plan 08-06, Task 2) — D-06 step 3: the verbatim `release-now, phone check done` decision, the five re-confirmed proofs, the pre-rename `cron:status`, the rename output and the unchanged project ID, the discovery that generated aliases only move on the next *deployment*, the redeploy that minted `backdesk-hesams-projects-432a48c6.vercel.app` and its `-git-main-` sibling, the refreshed `.vercel/project.json`, and the `supabase/config.toml` / `push-vercel-env.mjs` relabels
- **2026-09-08 — Redirect on every production alias, Standard Protection enabled, bypass secret removed** (Plan 08-06, Task 3) — DOM-01 and DOM-02 measured end to end: the 308s and their `location` headers on all five `*.vercel.app` hosts, the `302 → vercel.com/sso-api` + `_vercel_sso_nonce` on a deployment URL, the **200s that stayed 200** on `app.backdesk.com.au/login` and `/api/unsubscribe`, our own `text/plain` `401` to a wrong bearer, the four post-change `net._http_response` 200s, the `ssoProtection` read-back, and the bypass-key count going 1 → 0
- **2026-09-08 — quotes.backdesk.com.au verified at Resend; OPERATOR_ALERT_FROM pushed** (Plan 08-07, Task 1) — DOM-03 measured: the four DNS-over-HTTPS read-backs (DKIM `p=` unbroken, `send.quotes` MX and SPF TXT, `_dmarc.quotes` with no `rua=`), the read-only Resend API answer `status=verified region=ap-northeast-1`, the correction of two stale plan expectations (the apex `_dmarc` is Google's and *does* carry `rua=`; the apex A is Squarespace parking, not empty), the `OPERATOR_ALERT_FROM` push (config, 40 chars, value never printed) with its `vercel env ls` timestamps, the redeploy 31s later with all six aliases re-attached, the event-gated From-header note, and the statement that no `messaging_config` email row was enabled and no email was sent
- **2026-09-09 — Apex + www attached to the project, redirect set, founder record list** (Plan 09-07, Task 1) — LAND-01's first half: `vercel domains add` for both hosts (`domain_added`, `verified: true` on each with no ownership TXT demanded), the www → apex **308** written through `PATCH /v9/projects/backdesk/domains/www.backdesk.com.au` and read back, the `/v6/domains/{name}/config` read-back **taken after attaching** (rank-1 IPv4 changed from the pre-attach `76.76.21.21` to the anycast pair), the finding that `vercel domains inspect` still prints the rank-2 legacy address in its warning, the current-zone enumeration over DoH, and the five-record delete list / do-not-touch list handed to the founder. The cut-over itself is the checkpoint that follows

## 9. Apex + www (Phase 9)

`backdesk.com.au` is the public landing host (LAND-01) and `www.backdesk.com.au`
redirects to it. Both were attached to project `backdesk` on **2026-09-09**; the DNS
records that make them serve are published by the founder at Squarespace, which is why
this section has a documented column now and a measured one that Plan 09-08 fills after
the cut-over.

**The values below were read back from this project's own domain config *after*
attaching** (`GET /v6/domains/{name}/config?teamId=…`), never remembered. This matters
here more than it did in §2: before the domains were attached the same endpoint
recommended `76.76.21.21`, and after attaching it recommends a different, newer pair.

### Records asked for

| Purpose | Type | Name (zone-relative) | Priority | Value | Source of the value |
|---|---|---|---|---|---|
| Landing apex | A | `@` | — | `216.198.79.1` | `recommendedIPv4` rank 1, first address |
| Landing apex | A | `@` | — | `64.29.17.1` | `recommendedIPv4` rank 1, second address |
| www | CNAME | `www` | — | `956ea6eb7ab36544.vercel-dns-017.com.` | `recommendedCNAME` rank 1 |
| www → apex | — | — | — | 308 redirect, set **at Vercel**, not in DNS and not in `proxy.ts` | `PATCH /v9/projects/backdesk/domains/www.backdesk.com.au` |

Rank 1 is an anycast **pair** — both addresses are added, one A row each. Rank 2 is the
single legacy `76.76.21.21`; it is not used. Rank-1 CNAME is the same project-specific
target `app` already uses (§2), which is the cross-check that it belongs to this project:
`app.backdesk.com.au` resolves through it to exactly `216.198.79.1` and `64.29.17.1`.

**A trap worth naming.** `vercel domains inspect backdesk.com.au` prints
`WARNING! … Set the following record … A backdesk.com.au 76.76.21.21 [recommended]` — the
**rank-2** value, in the one output a human is most likely to read. The config API's
rank-1 is authoritative for this project. The same command also prints the four
Squarespace nameservers with a ✘ against `ns1/ns2.vercel-dns.com`; as in §2 that is **not
a fault**, it compares the zone against Vercel-managed DNS, which this project
deliberately does not use.

**No AAAA on the apex** (Vercel's guidance is to skip IPv6 and remove any AAAA record).
**CAA: none exists today** — read back empty on 2026-09-09. If one is ever added it must
permit Let's Encrypt, or certificate issuance for these hosts stops.

### Do not touch — every apex record that is not ours

Deleting or editing any row below breaks the founder's Google Workspace mail or the
Backdesk sending domain. None of them has anything to do with the landing page.

| Name | Type | Value | Whose |
|---|---|---|---|
| `@` | MX | `1 smtp.google.com.` | Google Workspace — `hello@backdesk.com.au` |
| `@` | TXT | `v=spf1 include:_spf.google.com ~all` | Google Workspace SPF |
| `@` | TXT | `google-site-verification=vWZK2lryw39-…` | Google Workspace domain proof |
| `google._domainkey` | TXT | `v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A…` | Google Workspace DKIM |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:hello@backdesk.com.au` | Google Workspace DMARC |
| `app` | CNAME | `956ea6eb7ab36544.vercel-dns-017.com.` | The console host (§2) |
| `resend._domainkey.quotes` | TXT | the long `p=…` key | Resend sending domain (§3) |
| `send.quotes` | MX | `10 feedback-smtp.ap-northeast-1.amazonses.com.` | Resend |
| `send.quotes` | TXT | `v=spf1 include:amazonses.com ~all` | Resend |
| `_dmarc.quotes` | TXT | `v=DMARC1; p=none;` | Resend subdomain policy |
| `@` | NS | `nsc1`–`nsc4.squarespacedns.com.` | The delegation itself (§1) |

Only five rows are deleted, all of them inside Squarespace's **Squarespace Defaults**
section: the four parking A records on `@` and the `www` CNAME to `ext-sq.squarespace.com`.

### Documented vs measured

The founder published the records on **2026-09-09** (Plan 09-07 Task 3). Plan 09-08
filled the four HTTPS/TLS rows on the same day, once Vercel auto-issued the certificates.
Every row in this table is now a measured value.

| Fact | Documented | Measured (2026-09-09) |
|---|---|---|
| `A backdesk.com.au` | `216.198.79.1`, `64.29.17.1`, and nothing else | **matches** — `216.198.79.1` + `64.29.17.1` on Google and Cloudflare DoH; no `198.…` parking address on any probe |
| `CNAME www.backdesk.com.au` | `956ea6eb7ab36544.vercel-dns-017.com.` | **published** — authoritative `nsc1`/`nsc2.squarespacedns.com` answer `956ea6eb7ab36544.vercel-dns-017.com` directly; Cloudflare 10/10; Google Public DNS still draining its old 14,400 s TTL (4/10 at 09:10Z on 09-08, cache-only — see the split-cache note below) |
| Vercel's view of the apex | `misconfigured: false`, `configuredBy: "A"` | **matches** — `misconfigured: false`, `configuredBy: "A"`, `ipStatus: "no-change"`, `aValues: ["64.29.17.1","216.198.79.1"]` |
| Vercel's view of www | `misconfigured: false`, `configuredBy: "CNAME"` | **matches** — `misconfigured: false`, `configuredBy: "CNAME"`, `cnames: ["956ea6eb7ab36544.vercel-dns-017.com."]` |
| `curl -sI http://backdesk.com.au/` | the landing page, served by Vercel | **matches** — `HTTP/1.1 200 OK`, `x-vercel-id: syd1::…`, `<title>Backdesk · Quote chasing for Perth trade businesses</title>` |
| `curl -sI http://www.backdesk.com.au/` | 308 to the apex | **matches** — `HTTP/1.1 308 Permanent Redirect`, `location: https://backdesk.com.au/` |
| `curl -sI https://backdesk.com.au/` | `HTTP/2 200`, `x-vercel-id: syd1…` | **matches** — `HTTP/2 200`, `x-vercel-id: syd1::8s7rw-1788944755154-1c02ee2664ad`, `strict-transport-security: max-age=63072000` (09-08, 2026-09-09 09:05Z) |
| `curl -sI https://www.backdesk.com.au/` | `HTTP/2 308`, `location: https://backdesk.com.au/` | **matches** — `HTTP/2 308`, `location: https://backdesk.com.au/`, `x-vercel-id: syd1::qwvcb-…` (09-08) |
| `curl -sI http://backdesk.com.au/` (plain HTTP after certs) | 308 to https | **matches** — `HTTP/1.0 308 Permanent Redirect`, `Location: https://backdesk.com.au/` (09-08) |
| `curl -sI https://backdesk.com.au/inbox` | 404 — console paths are not public on the apex | **matches** — `HTTP/2 404` (Assumption A1 measured; no `proxy.ts` change was needed) |
| `curl -sI https://backdesk.com.au/login` | 404 — `/login` is a console path like any other | **404 since 2026-09-09 (deployment `a2e7559xq`)** — `HTTP/2 404`, `x-vercel-id: syd1::mjmmx-…`, no `location` header, body `<title>Page not found · Backdesk</title>`. It answered **200 with the console sign-in form** until that deployment — see "The one apex path that was not 404ing" below |
| `curl -sI https://app.backdesk.com.au/login` | 200 — the sign-in form, on the console host | **matches** — `HTTP/2 200`, `<title>Sign in · Backdesk</title>` with both the email and password inputs, re-measured after the fix above |
| `curl -sL https://www.backdesk.com.au/login` | 308 to the apex, then 404 | **matches** — `308` → `https://backdesk.com.au/login` → `404` |
| TLS certificate | may need `vercel certs issue` — §2 found it does not always auto-issue | **auto-issued, no manual step** — `vercel certs ls` shows `cert_75sS7HrcOF0ESuYpvEho3gVh` (`backdesk.com.au`) and `cert_4VC2cnr09xR2WaXDK07jXfUa` (`www.backdesk.com.au`), both `in 90d`, `renew: yes`, age 2m at first probe. §2's finding did **not** repeat here (09-08) |
| `MX` / SPF / DKIM / DMARC on the apex | unchanged, byte for byte | **unchanged** — `1 smtp.google.com.`, `v=spf1 include:_spf.google.com ~all`, `google-site-verification=vWZK2…`, `v=DKIM1;k=rsa;p=MIIBIjAN…`, `v=DMARC1; p=none; rua=mailto:hello@backdesk.com.au`, identical on both resolvers |
| `CNAME app.backdesk.com.au` | unchanged | **unchanged** — `956ea6eb7ab36544.vercel-dns-017.com.` |

**The one apex path that was not 404ing (WR-01, gap T-9-23).** Until 2026-09-09 the apex
answered `https://backdesk.com.au/login` with `HTTP/2 200` and the console sign-in form,
while `/inbox` and `/audits/requests` on the same host answered 404. The cause was in
`src/proxy.ts`, not in DNS or in any Vercel setting: `config.matcher` excluded
`login$|login/`, so the proxy never ran for `/login` on ANY host and the marketing-host
branch could not rewrite it to the branded 404. 09-04's measured table had probed
`localhost/login` and `app.backdesk.com.au/login` — both correctly 200 — but never the
apex, and the only test on the path asserted the exclusion itself.

The exclusion was removed. The sign-in form was never at risk from being matched:
`PUBLIC_PATHS` in `src/lib/supabase/proxy.ts` already lets `/login` through `updateSession`
without a redirect, so the form stays open on the console hosts at a cost of one
`getClaims()` call. Measured after deployment `a2e7559xq`: apex and `www` `/login` → 404
with no `location` header, `app` `/login` → 200 with the form intact, apex `/` → 200. The
apex now has exactly one shape — the landing page, `/audit`, `/audit/thanks`, `/privacy`,
`/brand/*`, `robots.txt`, `sitemap.xml`, and 404 for everything else — with no path that
has to be remembered as an exception.

**The cut-over landed, and HTTPS with it.** `https://backdesk.com.au/` serves the Backdesk
landing page from Vercel's Sydney edge (`HTTP/2 200`, `x-vercel-id: syd1::…`) and
`https://www.backdesk.com.au/` returns the domain-level 308 to the apex — both proven at
the HTTP layer, not read off a status field. Plain `http://` on the apex now 308s to
`https://` and both hosts send `strict-transport-security: max-age=63072000`.

**Certificates auto-issued this time.** §2's finding — that Vercel does not always
auto-issue — did not repeat: within roughly three hours of the zone edit, and about two
minutes before the first successful probe, Vercel issued both certificates on its own.
`vercel certs issue` was prepared but never run. The finding stands as a *possibility* to
check for, not a step to perform blindly; the rule is to probe `https://` first and only
issue by hand if the handshake fails.

**A resolver disagreeing is not a missing record.** For roughly an hour after the change,
Google Public DNS answered `www` from two different cache states depending on which of its
instances took the query — some still holding `ext-sq.squarespace.com.` from before the
edit. A single unlucky probe reads as "the founder did not publish it". Three independent
authorities said otherwise at the same moment: Cloudflare answered the Vercel target on
every probe, Vercel's own config API reported `configuredBy: "CNAME"` with
`misconfigured: false`, and `http://www.backdesk.com.au/` already returned the 308. Query
at least two resolvers before concluding a record is absent, and prefer the authority that
cannot be stale.

**The authority that cannot be stale is the zone's own nameserver.** 09-08 met the same
split on the *apex* `A` record — Google Public DNS still returned the four Squarespace
parking addresses on 1–2 of every 10 probes, hours after the edit — and settled it by
querying `nsc1` and `nsc2.squarespacedns.com` directly instead of any recursive resolver
(Node's `dns.Resolver` with `setServers([nsIp])`; the sandbox `dig` is a stub). Both
authoritative servers returned the Vercel pair and no parking address anywhere in the zone.
That is a measurement of the record, not of somebody's cache, and it is the check to reach
for first whenever a resolver and a live HTTP response disagree.
