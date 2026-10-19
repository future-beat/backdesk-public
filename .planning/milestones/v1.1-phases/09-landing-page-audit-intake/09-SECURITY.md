---
phase: 9
slug: landing-page-audit-intake
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-09-10
---

# Phase 9 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| public internet → `/audit` server action | Unauthenticated multipart POST from any prospect (or bot); decoy → zod → atomic throttle → sniff → insert → upload → notify → record | Prospect PII, optional CSV of the prospect's customers |
| `x-forwarded-for` → salted hash | Vercel-written header; salted SHA hash keyed on /64 for IPv6; never stored raw | Network address |
| server action → `audit_requests` (service role) | Tenant-independent table; anon/authenticated have SELECT under `is_operator()` only | Request rows + notify outcomes |
| server action → Storage bucket `audit-uploads` (private) | Service-role client confined to `src/db/repository/audit-uploads.ts`; no public/signed URL; operator-gated download route | CSV objects, purged after 30 days or on conversion |
| server action → Resend / ClickSend | Operator-only recipients from env; global `messaging_config` sms row for the from-number (arming flag ignored) | Business name, contact name, phone (control chars stripped) |
| host header → `src/proxy.ts` | Exact-match set of own hostnames; marketing hosts 404-rewrite console paths; console hosts run `updateSession` | Route selection only, no security decision |
| console (RLS `createClient`) → request list/detail/CSV route | `requireOperator()` before params; RLS decides reads | Request rows, CSV stream |
| Squarespace DNS → Vercel / Google Workspace | Founder-owned zone; apex A + www CNAME to Vercel; mail records untouched | Public DNS |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-9-01 | Spoofing | host header → proxy | high | mitigate | Exact-match own-domain set; header host lower-cased, port stripped; public host non-marketing path → 404 rewrite; console layout `getClaims()` + `requireOperator()` independent | closed |
| T-9-02 | DoS | form spam / notify fan-out | high | mitigate | Decoy exits before any write; zod refusal writes nothing; atomic throttle bump before insert; one email + one SMS per stored row, no retry | closed |
| T-9-03 | DoS | IPv6 rotation across allocations | medium | accept | /64 keying in `ip-hash.ts`; WAF/CAPTCHA deferred until abuse appears (AR-9-01) | closed |
| T-9-04 | Tampering | malicious CSV | high | mitigate | Suffix + MIME allowlist, size before parse, 2-column sniff; zero-byte part = no attachment (09-10); bucket `file_size_limit` 4 MiB + MIME array; `bodySizeLimit 4400kb`; download route `text/csv`, `attachment`, `nosniff`, `no-store` | closed |
| T-9-05 | Info disclosure | logs / notify_detail / page errors | high | mitigate | Error names only in every catch; IP hashed before use; console pages log `error.code`; console-error-leak suite | closed |
| T-9-06 | Info disclosure | prospect PII retention | high | mitigate | `csv_purge_after = now()+30d` on the single writer; purge object-then-row on the daily digest tick; conversion deletes object and clears columns (WR-05) | closed |
| T-9-07 | Spoofing | SMS recipient | high | mitigate | No recipient parameter; `to = env.OPERATOR_ALERT_PHONE`; `customString` carries the request id | closed |
| T-9-08 | Tampering | email header/body injection | medium | mitigate | zod max lengths; `stripControlCharacters` on subject (WR-02) and every body value; plain text only | closed |
| T-9-09 | Info disclosure | request-id enumeration via CSV route | high | mitigate | `requireOperator()` before `params`; uniform bodiless 404 on every refusal (pinned) | closed |
| T-9-10 | Info disclosure | service-role key from `src/app` | high | mitigate | Only service-role client under `src/db/repository`; CI grep fails the build on the key under `src/app`; eslint deep-import ban | closed |
| T-9-11 | Info disclosure | bucket public exposure | high | mitigate | Bucket `public=false`; no `storage.objects` policy; no signed/public URL in `src/` | closed |
| T-9-12 | EoP | public action → tenant data | high | mitigate | Action imports only the audit-request/upload family; no tenant id anywhere in the type; test asserts no `forTenant`/`createProspect` | closed |
| T-9-13 | DoS | SMS gated by tenant arming | medium | mitigate | Global `getChannelConfig('sms')`, `enabled` never read; `not_configured` recorded on the row | closed |
| T-9-14 | Info disclosure | secrets in evidence | high | mitigate | Env entries carry names/types/lengths only; salt via subshell + stdin; secret-shaped grep over docs → 0 | closed |
| T-9-15 | Info disclosure | `public/brand/*` | low | mitigate | Brand art only; SVG metadata stripped; asset set enumerated by test | closed |
| T-9-16 | Repudiation | Lighthouse provenance | medium | mitigate | Seven committed reports with `requestedUrl` on the apex | closed |
| T-9-17 | DoS | Google Workspace records | high | mitigate | Do-not-touch table; authoritative-NS read-backs; live MX/SPF/DKIM/DMARC intact after cut-over | closed |
| T-9-18 | EoP | status / pre-fill actions, list + count | high | mitigate | Auth before body read, uuid check, write after; list/detail/count via RLS `createClient()` | closed |
| T-9-19 | Tampering | production DDL via dirty journal | high | mitigate | Journal idx 35 `when` monotonic; no-op second `db:migrate` proven; bucket upsert last | closed |
| T-9-20 | Tampering | brand identity constants | medium | mitigate | Exact export pin (18), no-import and no-sanitiser pins, placeholder-ABN impossibility test | closed |
| T-9-21 | Spoofing | wordmark/lockup misuse | low | accept | Design rule; `.wordmark{color:var(--fg)}` + "nothing else green" test; operator ratified (AR-9-02) | closed |
| T-9-22 | DoS | throttle store outage | medium | mitigate | Thrown bump → fixed sentence, error name logged, nothing written | closed |
| T-9-23 | Info disclosure | crawler redirect chain apex → login | low | mitigate | 404 rewrite, never redirect; `/login` exemption removed from the matcher (WR-01); live apex `/login` → 404 | closed |
| T-9-24 | Tampering | cookies dropped on rewrite | medium | mitigate | `setAll` rebuilds the rewrite from the same target; routing test pins it | closed |
| T-9-25 | DoS | Supabase call on public `/` | low | mitigate | `NextResponse.next()` before any Supabase client; apex `/` sets no cookies | closed |
| T-9-26 | Info disclosure | `getServerEnv()` from prerendered page | medium | mitigate | Only the server action reads env in the marketing tree; ABN is a constant | closed |
| T-9-27 | Tampering | third-party script / runtime font / external image | medium | mitigate | `next/font/google` self-hosted at build; no scripts; brand from `/brand/*` | closed |
| T-9-28 | Repudiation | privacy notice accuracy | high | mitigate | Sydney / offshore-processor / residency sentences pinned by test and live | closed |
| T-9-29 | Info disclosure | console routes indexed | low | mitigate | robots disallows console paths; `noindex` on console, login, thanks | closed |
| T-9-30 | Tampering | double conversion | low | mitigate | `WHERE converted_prospect_id IS NULL`; loser logs and continues | closed |
| T-9-31 | Tampering | remembered generic A record | medium | mitigate | Records copied from Vercel's config read-back after attach; live A = the rank-1 pair | closed |
| T-9-32 | Spoofing | www diverging from apex | low | mitigate | Live `www` → 308 to the apex | closed |
| T-9-33 | Tampering | pasted copy with forbidden claims | medium | mitigate | Forbidden-word / dollar-ceiling / competitor-domain tests; conflicting copy held back | closed |
| T-9-34 | Info disclosure | hash / UA on the list | low | mitigate | Explicit column list without `user_agent`/`ip_hash`; forbidden-columns test | closed |
| T-9-SC | Tampering (supply chain) | npm installs | high | mitigate | No package.json/lockfile change in Phase 9; `png-to-ico` npx replaced by direct ICO packing; lighthouse@13.4.1 as an audited one-off | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-9-01 | T-9-03 | /64-prefix hashing shares one bucket per residential allocation; rotation across allocations is tolerated because a WAF or CAPTCHA now would throttle real prospects (CONTEXT Deferred Ideas: "only if abuse appears"). Residual: code-review IN-01 — compressed IPv6 text can key differently for short prefixes; not attacker-selectable on Vercel | operator (UAT test 10 ratification, 2026-09-10) | 2026-09-10 |
| AR-9-02 | T-9-21 | Wordmark/lockup misuse has no runtime control by design; enforced by the UI-SPEC, the `.wordmark` token rule and the "nothing else green" test | operator (UAT test 10 ratification, 2026-09-10) | 2026-09-10 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags (non-blocking, carried forward)

1. `src/proxy.ts` had never compiled since Phase 4 (it sat at the repo root); it is now live and load-bearing, pinned by location tests and the `ƒ Proxy (Middleware)` build line. Nothing was exposed: the layout and action gates were independent.
2. `.vercelignore` (09-08) excludes `.planning/`, `docs/` and `logo/` from deploy uploads — risk-reducing; do not remove as "unused".
3. Code-review IN-05 (open): the request status select has no transition rule; a converted request can be set back to `new`. Operator-only surface; integrity nuisance.
4. T-9-14 observation: the docs secret-grep gate is run by hand per plan; a `docs/`-scoped secret grep in CI would make it durable.
5. Code-review IN-01..IN-04 remain open (info level).

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-10 | 35 | 35 (33 mitigated + 2 accepted) | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-10
