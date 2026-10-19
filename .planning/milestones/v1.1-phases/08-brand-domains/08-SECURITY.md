---
phase: 8
slug: brand-domains
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-09-09
---

# Phase 8 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| tenant `business_name` → email From header / identity line | Operator-entered string becomes part of an RFC 5322 header and the Spam Act identity line | Tenant business name (untrusted text) |
| brand module → four runtime contexts | Print pages (RSC), email builder, route handler, alert sender import one import-free file | Service name, domains, phrasing |
| unsubscribe token → public page | Unauthenticated visitors; the page must not disclose whether a token is real | Signed token |
| env (`OPERATOR_ALERT_FROM`, `APP_BASE_URL`) → Resend / Vercel / cron / ClickSend | One public value fans out to three external stores; secrets ride alongside and must never print | Config + bearer secrets |
| pg_cron → Vercel route | Bearer in `cron.job.command`; read-backs extract origin+path only | Tick secrets |
| ClickSend → webhook routes | `?token=` URLs; masked in every read-back | Webhook tokens |
| founder's registrar account (Squarespace) → public DNS | Whoever controls the zone controls the console host and the sending domain | DNS records |
| console `/settings/email` → Resend API | Operator session creates the domain object; records come back verbatim | Domain records |
| Vercel API credential → project settings | Session token grants project-wide write; never printed or persisted | Session token |
| preview / generated URLs → production data | Previews carry production env; Standard Protection re-fences them | Production config |
| released alias → third parties | A released `*.vercel.app` name can be claimed by anyone | Old hostnames (retained, redirected) |
| constants module → prospect/client documents | A value is a promise on a sales document and a line on an invoice | Commercial assumptions |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-8-01 | Tampering/Spoofing | From display name via `viaDisplayName` | high | mitigate | `displayName()` sanitiser in `resend-sender.ts:174-187` runs before branding; empty sanitised name refused (`950a13e`); injection/CRLF pins in `tests/resend-sender.test.ts`, `tests/brand.test.ts` | closed |
| T-8-02 | Spoofing/DoS | tick or webhook left on a releasable alias | high | mitigate | All four pg_cron targets + both ClickSend rules re-pointed and read back before the rename; old aliases retained and 308-redirected (live `cron:status` 200s 2026-09-09) | closed |
| T-8-03 | Information disclosure | stray Protection Bypass secret | medium | mitigate | Revoked; Vercel API `protectionBypass` count 0; no bypass header/env in repo | closed |
| T-8-04 | Tampering (DNS hijack) | `backdesk.com.au` zone | high | mitigate | Zone at the founder's registrar DNS (Squarespace); agent holds no zone credential; every record read back live. Residual operator obligation: confirm 2FA on the Squarespace Domains login (AR-8-03) | closed |
| T-8-05 | Information disclosure | env values / bearers in terminal, logs, docs | medium | mitigate | `env:push` stdin contract; `cron-status.mjs` prints origin+path only with CR-01 guard (`4d717bc`, pinned by `tests/cron-status-script.test.ts`); `setup-clicksend.mjs` masks; evidence log holds only the invalid probe token | closed |
| T-8-06 | Elevation | preview/deployment URLs as unauthenticated front door | medium | mitigate | Standard Protection `prod_deployment_urls_and_all_previews`; deployment URLs 302 to SSO; the `-git-main-` alias (not walled on Hobby) 308s to the custom domain | closed |
| T-8-07 | DoS | redirect loop/hop on the custom domain | low | mitigate | `app.backdesk.com.au` has no redirect; `next.config.ts` / `proxy.ts` untouched; live 200 with no `location` | closed |
| T-8-08 | Repudiation (Spam Act identification) | identity line / via name / footer | medium | mitigate | Single builders in `src/core/brand.ts`; grep-as-test over `src/` forbids a second spelling | closed |
| T-8-09 | Information disclosure (oracle) | `/api/unsubscribe` pages | medium | mitigate | Footer from a constant argument at module scope; no tenant lookup; byte-identity test + T-4-20 oracle suite green | closed |
| T-8-10 | Information disclosure | Vercel session token for REST calls | medium | mitigate | Never echoed, logged or committed; revoke response suppressed | closed |
| T-8-11 | Information disclosure | `CONSOLE_DESCRIPTION` / metadata | low | accept | Public marketing prose; no host, secret or identifier (AR-8-02) | closed |
| T-8-12 | DoS (alerts) | `DEFAULT_ALERT_FROM` / switch to the service domain | high | mitigate | Default stays the deliverable onboarding sender; `OPERATOR_ALERT_FROM` pushed only after Resend `status=verified` + DKIM read-back | closed |
| T-8-13 | Repudiation | figure vs footnote after a value change | high | mitigate | Single origin `constants.ts` (0 imports / 8 exports), basis-point pin, record names every pin, stored-prospect caveat surfaced | closed |
| T-8-14 | Tampering | ninth export / import in `constants.ts` | medium | mitigate | Structural pins tightened for every export/import syntax (`fda7820`) | closed |
| T-8-15 | Information disclosure | decision record leaking client data | low | mitigate | `docs/commercial-assumptions.md` holds values and rationale only | closed |
| T-8-16 | Spoofing | DKIM/SPF/CNAME values | medium | mitigate | Values published verbatim, DNS-only; live read-backs match; Resend `status=verified`; DMARC `p=none` monitor mode | closed |
| T-8-17 | Information disclosure | evidence log | low | mitigate | Identifiers, public DNS values and dates only; tokens elided | closed |
| T-8-18 | DoS | `cron:apply` overlapping a remote test run | high | mitigate | `remote_test_lease rows: 0` before/after; `test:remote` never run | closed |
| T-8-19 | Elevation | `--activate` arming SMS during a config change | high | mitigate | Flag never passed; "NOT arming the config row" recorded | closed |
| T-8-20 | DoS | All-Deployments scope walling the ticks | high | mitigate | `deploymentType` read back ≠ `all`; no password protection; ticks 200 after enabling | closed |
| T-8-21 | Elevation | accidentally arming customer email | high | mitigate | `messaging_config` email row untouched; `VERIFIED_STATUS` gate in `actions.ts` unchanged; explicit statement in the evidence entry | closed |
| T-8-SC | Tampering (supply chain) | npm installs | low | accept | No package installed; lockfile byte-unchanged (AR-8-01) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-8-01 | T-8-SC | No package installed across seven plans; only an npm script line added to `package.json`; `package-lock.json` unchanged | gsd-security-auditor (verified) | 2026-09-09 |
| AR-8-02 | T-8-11 | `CONSOLE_DESCRIPTION` is public marketing prose with no host, secret or internal identifier; test-pinned | gsd-security-auditor (verified) | 2026-09-09 |
| AR-8-03 | T-8-04 (residual) | Registrar-2FA advisory was named in the plan but never written into the founder instructions. Enforceable controls (founder-owned zone, no agent zone credential, live read-backs) are present. Operator obligation: confirm 2FA is enabled on the Squarespace Domains login | operator obligation — pending founder acknowledgement | 2026-09-09 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags (non-blocking, carried forward)

1. `RESEND_API_KEY` in the deployment was escalated from Sending-access to Full-access (needed for domain management); key scope is not covered by a threat ID. Consider a dedicated Full-access key for domain operations and a Sending-access key for sends in a later phase.
2. Supabase Auth Site URL / Redirect URLs: operator reported Site URL = `http://localhost:3000` (local default) and no redirect list (UAT test 2). Recommended: Site URL `https://app.backdesk.com.au`, Redirect URLs `http://localhost:3000/**`.
3. `vercel link` appended a `VERCEL_OIDC_TOKEN` block to `.env.local` (gitignored; informational).
4. One synthetic ClickSend inbound row remains in production `inbound_messages` (test residue by precedent; UAT test 3 confirmed exactly one).
5. Code-review IN-01 (open): `unsubscribe/route.ts:95` interpolates `identityLine()` unescaped; input is a constant today (T-8-09 surface).

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-09 | 22 | 22 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-09
