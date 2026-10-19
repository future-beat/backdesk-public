---
phase: 04-messaging-gateway
verified: 2026-08-30T04:35:00Z
status: passed
score: 33/34 must-haves verified
behavior_unverified: 0
overrides_applied: 1
re_verification:
  previous_status: gaps_found
  previous_score: 30/34
  gaps_closed:

    - "CR-01 — per-tenant activation: buildRoutingSender now gates both channels on anyChannelEnabled; resolvers are the sole identity authority; tenant-override activation proven against the hosted DB (04-08, commits 4c5de33/e311fa9/b8e114b)"
    - "CR-02 — provider opt-out backstop: reconcile probe reads the four-field providerVerdictCorpus shared with receipts.ts; fixtures pinned to the two captured real payloads plus a status_text opt-out; reconcile guard moved to anyChannelEnabled('sms') (04-09, commit be85e4e)"
    - "CR-03 — dispatch isolation: per-send try/catch around setOutcome and per-tenant try/catch around performSends, both proven by the failure-injection suite (04-09, commit 02cf3a1)"
    - "Gap 1 (SC2/MSG-02 live email proof) — resolved by recorded developer override (04-10, commit 21cb564); honored, not re-flagged"
  gaps_remaining: []
  regressions: []
overrides:

  - must_have: "Email sends from a verified client domain (or service-subdomain fallback) with SPF/DKIM, Spam Act-compliant sender identification, and a functional unsubscribe on every message (roadmap SC2 / MSG-02)"
    truth: "Email sends from a verified client domain (or service-subdomain fallback) with SPF/DKIM, Spam Act-compliant sender identification, and a functional unsubscribe on every message (roadmap SC2 / MSG-02)"
    gap_ref: 1
    status: human_override
    decided: "2026-08-30"
    decided_by: "developer (gap-closure session)"
    accepted_by: "developer (gap-closure session)"
    accepted_at: "2026-08-30"
    reason: >-
      Blocked-external: no client domain exists to verify at Resend, so the D-02 real-send proof
      has nothing to send from — scripts/verify-email-pipe.mjs refuses at its first assertion by
      design. The pipe itself is built and unit-tested (ResendSender, List-Unsubscribe +
      List-Unsubscribe-Post headers, Spam Act footer naming client and service, HMAC unsubscribe
      endpoint), and no later roadmap phase (5/6/7) covers the proof — so it is not deferrable to
      a phase; it lands with first-client onboarding, the moment a verifiable domain first exists.
      This override defers the proof, it does not simulate it: D-02's meaning is unchanged (the
      pipe counts as proven only by a real send) and MSG-02 stays Pending in REQUIREMENTS.md.
    obligation: >-
      During first-client onboarding, before any email touch is enabled for that client:
      (1) verify the client domain (or the service subdomain) at /settings/email and apply the
      SPF/DKIM records Resend shows; (2) save an enabled email identity for that ONE tenant —
      per-tenant activation became real with the 04-08 CR-01 fix (anyChannelEnabled gate +
      per-tenant identity resolvers), so this arms one client and not fifteen; (3) run
      `npm run verify:email-pipe -- --tenant <id> --to <address>`; (4) record the run evidence in
      docs/external-registrations.md; (5) only then flip the MSG-02 checkbox in REQUIREMENTS.md.
    obligation_recorded_in:

      - "docs/external-registrations.md — '## 2026-08-30 — MSG-02 live email proof: deferred by override to first-client onboarding'"
      - ".planning/STATE.md — Blockers/Concerns entry '[Phase 4 — OVERRIDE 2026-08-30, carries to first-client onboarding]'"
      - ".planning/REQUIREMENTS.md — MSG-02 line pointer (checkbox deliberately unchanged)"

deferred:

  - truth: "The outbound touch body is real drafted copy rather than the Phase 3 placeholder ('[STUB touch 1] follow-up for quote…')"
    addressed_in: "Phase 5"
    evidence: "Phase 5 goal: 'Every touch is Claude-drafted in the client's approved voice with facts injected from data'. The compliance half of the body (business identification + 'Reply STOP to opt out') is real and was verified live; only the prose is stubbed, intentionally."
human_verification:

  - test: "DLR callback wire shape (research A1 residue; backstop truth #22): when the first real client's first delivery receipt arrives via the webhook (not the poll), capture the callback body and confirm transport encoding and timestamp unit"
    expected: "Form-encoded or JSON body decodes; numeric timestamp interprets as epoch seconds"
    why_human: "The one live receipt's Vercel log window rolled off before capture; test payloads were copied from /sms/history rows, not a callback body"

  - test: "Deploy the gap-closure work before arming for a real client: push main (17 commits ahead of origin/main as of this verification, including e658ea1 and the CR-01/02/03 fixes 4c5de33, e311fa9, b8e114b, be85e4e, 02cf3a1) and confirm production runs that build"
    expected: "Production runs a build containing e658ea1 AND the three gap-closure fix commits — without them, arming one client on production still sends nothing (CR-01 defect is live in the deployed build)"
    why_human: "Deployment state is outside the repo; git shows no remote branch contains these commits"

  - test: "Vercel Production env vars (04-01 D7): Project → Settings → Environment Variables → Production shows CLICKSEND_WEBHOOK_SECRET, CLICKSEND_DLR_SECRET, UNSUBSCRIBE_SIGNING_SECRET, MESSAGING_RECONCILE_SECRET"
    expected: "All four present"
    why_human: "Set via dashboard; not observable from the repo. (Corroborated indirectly: the live webhook proof implies at least the ClickSend secrets are live.)"

  - test: "Phone-viewport inbox triage (deferred <human-check> from 04-06): open /inbox on a phone-sized viewport; untriaged ambiguous/STOP rows visible with candidates; mark-handled removes a row; empty state shows when clear"
    expected: "Fully usable one-handed"
    why_human: "Visual/ergonomic"

  - test: "First-client email onboarding flow (override obligation + deferred <human-check> from 04-06): domain create → DNS records → verified → enable one tenant's email config in the console, then run the five-step proof sequence in the MSG-02 override obligation"
    expected: "Console flow completes without touching code; verify-email-pipe passes; evidence recorded; MSG-02 flipped"
    why_human: "Requires a real client domain (blocked-external, per the recorded override); the CR-01 blocker on this flow is now fixed and remote-tested, so the flow is ready the moment a domain exists"

  - test: "Judgment-tier prohibitions (9 across plans) — NON-AUTHORITATIVE LLM-judge verdict: all pass; human sign-off recommended"
    expected: "Log discipline (no address/body/token in console.* — re-corroborated this run: both new dispatch catches bind nothing and log ids only, pinned by the T-2-02 spy test), suppression irreversibility, at-most-once semantics, resend.dev refusal, inbound-effects closure, residency note"
    why_human: "unverified-prohibition — human review recommended (judgment-tier, no test-tier enforcement wired)"
---

# Phase 4: Messaging Gateway Verification Report

**Phase Goal:** Real SMS and email flow through a single compliance-gated send path, and every inbound message lands in the right conversation
**Verified:** 2026-08-30 (re-verification)
**Status:** human_needed
**Re-verification:** Yes — after gap closure (04-08, 04-09, 04-10)

Prior run (2026-08-30T02:50Z): `gaps_found`, 30/34, four gaps. This run independently confirmed in source — not from the summaries — that gaps 2–4 (CR-01/02/03) are closed, and honored the recorded developer override on gap 1 (MSG-02, decided 2026-08-30). Previously-passed items received regression checks (existence + pure-suite re-runs on every touched area); no regressions found.

## Goal Achievement

### Gap Closure Verification (the focus of this run)

**Gap 1 — SC2/MSG-02 live email proof → PASSED (override).**
The `overrides:` entry recorded by 04-10 (commit `21cb564`) matches gap 1's truth byte-verbatim. Honored as a legitimate resolution: blocked-external on the first client domain, obligation recorded in all three sibling artifacts (confirmed present: docs/external-registrations.md:689 dated section; STATE.md:282 Blockers entry; REQUIREMENTS.md:39 MSG-02 line still `- [ ]` with the override pointer). D-02's meaning intact — MSG-02 remains honestly Pending.

**Gap 2 — CR-01 per-tenant activation → CLOSED, verified in source.**

- `anyChannelEnabled(channel)` exists at `src/db/repository/messaging-config.ts:142-150` — single SELECT of `id`, `WHERE channel AND enabled`, `LIMIT 1`, no join; exported through the barrel (`src/db/repository/index.ts:143`) with its deployment-gate rationale.
- `buildRoutingSender` (`src/core/messaging/routing-sender.ts:239-274`) gates BOTH arms on `Promise.all([anyChannelEnabled('sms'), anyChannelEnabled('email')])`; no tenant-less `getChannelConfig` read survives (the only `getChannelConfig` calls in the file are the two-argument per-tenant resolver reads at :175 and :212).
- `chooseSmsSender(channelEnabled: boolean, creds, fallback)` (:142-180) and `chooseEmailSender(channelEnabled: boolean, ...)` (`resend-sender.ts:433-445`) take the boolean gate; no from-address condition at either gate — identity lives wholly in `resolveSmsFrom`/`resolveEmailIdentity`, whose null produces a RECORDED `sms_not_configured`/`email_not_configured` refusal.
- The IN-04 comment is rewritten (:118-140) and describes the two-level gate that actually exists, including the CR-01 history.
- Console copy corrected: `actions.ts:299` reads "Saved. Email is on for this client from the next send tick." — asserted verbatim at `tests/email-settings-action.test.ts:270`.
- The gap's named test exists: `tests/routing-dispatch.test.ts:119-231` "one client armed, every other refused — the D-04 rollout (CR-01)" asserts `providerFor('email') === 'resend'` from one tenant row with the global row off, `resolveEmailIdentity(armed)` = the seeded identity, `resolveEmailIdentity(other)` = null, sms stays stub. Safety rails all present: no `.send(` in the block, delete-BY-ID afterAll, residue alarm (`anyChannelEnabled('email')` must be false in beforeAll), and the sms disarmed-alarm re-pointed at `anyChannelEnabled('sms')` (:317). 04-08-SUMMARY records the remote run passing twice, serialized (not re-run here — hosted-DB house rule).

**Gap 3 — CR-02 provider opt-out backstop → CLOSED, verified in source.**

- `providerVerdictCorpus(fields)` exported from `receipts.ts:224-231` — per-field `codeOf`, blanks filtered, space-joined; `classify`'s call site reads through it (:287-291). ONE builder, two callers.
- The reconcile probe at `reconcile.ts:231-232` is `isOptOutCode(providerVerdictCorpus([entry.status, entry.statusText, entry.statusCode, entry.errorText]))` — all four verdict-bearing fields, same order as receipts; the two-field template-literal probe is gone (no ``codeOf(` `` in the file).
- Guard alignment: `ReconcileDeps.anyEnabled` (:99) defaults to `anyChannelEnabled` (:112); the gate at :137 is `!(await anyEnabled('sms'))` — a tenant-only activation (real after 04-08) is now swept.
- Fixtures: zero occurrences of `RECIPIENT_OPT_OUT`; the captured real delivered payload is `historyRow()`'s default (statusText "Message delivered to the handset"), `REAL_FAILED` carries the captured "Absent Subscriber…" sentence (:57-62) asserted as a negative even with outcome='failed', and the synthesised opt-out's token sits only in `statusText` (:350) with `suppressFromInbound(..., 'provider_opt_out')` asserted (:367).

**Gap 4 — CR-03 dispatch isolation → CLOSED, verified in source.**

- Per-send guard: `dispatch.ts:537-562` wraps the `setOutcome` await in try/catch; the catch binds nothing, logs the ledger id only, does not rethrow, and the loop continues — NULL outcome is the honest record, never auto-resent (D-07).
- Per-tenant guard: `dispatch.ts:608-615` wraps the `performSends` call in try/catch inside the tenant loop; the catch logs the tenant id only and continues. The :566-582 invariant comment now states the guard covers the send pass.
- Failure-injection suite exists: `tests/cadence-dispatch-isolation.test.ts` mocks `@/db/repository` and covers all four behaviors (both-touches-sent under first-write rejection; NULL-not-retried; tenant B recorded while every write for A rejects; tenant B dispatched when A's send pass throws; T-2-02 log-discipline spy). Ran here: green.

### Observable Truths

Roadmap Success Criteria (the contract):

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | SMS sends from a dedicated AU virtual number with delivery receipts recorded per message, and two-way replies arrive back | ✓ VERIFIED | Unchanged from prior run: live e2e evidence chain (send_ledger 77433ea2, inbound 1c13261e) in docs/external-registrations.md; all wiring re-confirmed intact after the gap-closure edits (buildRoutingSender → ClickSendSender path re-read this run). CR-03's tick-robustness weakness is now fixed and injection-tested. |
| 2 | Email sends from a verified client domain (or service-subdomain fallback) with SPF/DKIM, Spam Act identification, functional unsubscribe | PASSED (override) | Override: blocked-external on the first client domain; proof lands with first-client onboarding — accepted by developer (gap-closure session) on 2026-08-30. The CR-01 blocker on per-tenant email activation is now FIXED, so the onboarding flow is genuinely ready the moment a domain exists. |
| 3 | STOP/unsubscribe deterministic regex before any LLM, suppresses across both channels, immediate at the send gate | ✓ VERIFIED | Unchanged: live handset STOP proof + pure regex/token suites. CR-02's provider-side backstop — the belt-and-braces behind this — is now live-shaped and can fire. |
| 4 | Every outbound identifies the client business; every inbound threads to the correct tenant/contact/quote; ambiguity → human triage, never a guess | ✓ VERIFIED | Unchanged: live identification + threading evidence; inbound.ts (487 lines) and inbox surface untouched by gap plans; regression existence checks pass. |

Plan-level must-have truths — the three prior FAILs re-scored, all others regression-checked:

| # | Truth (plan) | Status | Evidence |
| --- | ----------- | ------ | -------- |
| 5-18 | (04-01…04-03 truths — STOP semantics, threading, webhook door, ClickSendSender mapping, D-06 delegate claim) | ✓ VERIFIED | Regression: all supporting files exist at prior line counts; pure suites for every file touched by gap plans re-run green (122 tests across 5 suites); untouched files unchanged since prior full verification |
| 19 | Global row absent/disabled → stub, byte-identical to Phase 3; activation = config flip, no deploy (D-04) | ✓ VERIFIED | Now true in BOTH directions: global direction unchanged (chooseSmsSender(false,…) → fallback, unit-tested); per-tenant direction fixed by CR-01 and proven by the remote activation block. Disarmed-alarm upgraded to ask `anyChannelEnabled('sms')` — the question the tick asks |
| 20-21 | DLR updates only delivery columns; unmatched DLR recorded no-op | ✓ VERIFIED | Regression: receipts.ts edit was additive (corpus extraction); classify call site semantics unchanged; suites green in 04-09's recorded runs |
| 22 | DLR numeric timestamps are epoch seconds; unit confirmed against captured real payloads (backstop) | ? UNCERTAIN | Unchanged: poll path validated against captured payloads; the DLR CALLBACK wire shape remains unobserved. Backstop truth → abstains → human item 1 |
| 23 | Reconciliation sweep is the guarantee: missed DLRs + missed inbounds recovered, opted-out failures gain suppression evidence | ✓ VERIFIED | CR-02 closed: four-field shared corpus at reconcile.ts:231-232; real-payload fixtures with negative assertions; guard on anyChannelEnabled('sms') covers tenant-only activations. Deployment of the fixes is human item 2 |
| 24-28 | Email headers/footer, D-01 identity, unsubscribe transaction, no-oracle responses, ResendSender mapping | ✓ VERIFIED | Regression: resend-sender.ts edit confined to chooseEmailSender's signature; sender construction and header/footer logic untouched; resend-sender suite re-run green |
| 29 | Operator inbox lists every untriaged row + mark-handled | ✓ VERIFIED | Regression: inbox page.tsx (231 lines) untouched by gap plans |
| 30 | Operator can create domain, see DNS records, refresh verification, and — once verified — enable a tenant's email config without touching code | ✓ VERIFIED | Previously FAILED on the enable half (CR-01). Now: domain half unchanged (resend-domains.ts wired, 333 lines); enable half fixed — a tenant row genuinely arms that one client (remote activation test) and the console copy claims exactly that, test-pinned verbatim |
| 31-32 | AU-residency note; operator gating | ✓ VERIFIED | Regression: pages untouched |
| 33-34 | Real handset STOP proof; scripted activation | ✓ VERIFIED | Unchanged recorded evidence; setup-clicksend.mjs still 879 lines, wired |

Additional gap-plan truths (04-08/04-09 must_haves, folded into the gap-closure section above): all VERIFIED — one-client-armed/every-other-refused (remote test), one corpus builder asked from two places (source-confirmed), reconcile covers tenant-only activation (unit-tested), per-send and per-tenant isolation (injection-suite, ran green here).

**Score:** 33/34 truths verified (1 PASSED via override, 1 uncertain → human)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Touch body is the Phase 3 placeholder prose (compliance suffix is real and live-verified) | Phase 5 | Phase 5 goal: "Every touch is Claude-drafted in the client's approved voice with facts injected from data" |

### Required Artifacts

Prior run verified all 22 phase artifacts at all four levels. This run re-verified the six files the gap plans modified plus the one they created:

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/db/repository/messaging-config.ts` | anyChannelEnabled accessor | ✓ VERIFIED | :142-150 — one statement, LIMIT 1, no join; barrel-exported |
| `src/core/messaging/routing-sender.ts` | both arms on the deployment gate; honest comments | ✓ VERIFIED | Previously "GATE DEFECTIVE" — now :247-250 gates both channels on anyChannelEnabled; no tenant-less getChannelConfig; IN-04 comment rewritten |
| `src/core/messaging/resend-sender.ts` | chooseEmailSender boolean gate | ✓ VERIFIED | :433-445 — (channelEnabled, creds); identity wholly in the resolver |
| `src/core/messaging/receipts.ts` | exported providerVerdictCorpus; classify uses it | ✓ VERIFIED | :224-231 export; :291 call site |
| `src/core/messaging/reconcile.ts` | four-field probe; anyEnabled guard | ✓ VERIFIED | Previously "OPT-OUT ARM DEAD" — now :231-232 shared-corpus probe; :137 deployment-level guard |
| `src/core/cadence/dispatch.ts` | per-send + per-tenant guards | ✓ VERIFIED | :537-562 setOutcome guard; :608-615 performSends guard; both catches bind nothing |
| `tests/cadence-dispatch-isolation.test.ts` | failure-injection suite, both levels | ✓ VERIFIED | NEW; 5 tests, all four behaviors + T-2-02 spy; ran here, green |
| `scripts/verify-email-pipe.mjs` | D-02 email proof script | ✓ VERIFIED (deferred by override) | 206 lines; execution is the override obligation at first-client onboarding |
| All other prior artifacts (webhook routes, inbound.ts, senders, schema, console pages, setup script) | unchanged | ✓ VERIFIED (regression) | Existence + line counts match prior run; untouched by gap plans |

### Key Link Verification

Prior links all re-confirmed or unchanged; the gap-plan links verified this run:

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| buildRoutingSender | messaging-config repository | anyChannelEnabled('sms') / anyChannelEnabled('email') | ✓ WIRED (routing-sender.ts:247-250) |
| ClickSendSender / ResendSender | getChannelConfig(channel, tenantId) | resolveSmsFrom / resolveEmailIdentity — per-tenant identity authority | ✓ WIRED (:174-179, :211-227) |
| reconcile.ts applyHistory | receipts.ts | providerVerdictCorpus → isOptOutCode | ✓ WIRED (:61 import, :231-232 probe) |
| receipts.ts classify | providerVerdictCorpus | same builder, second caller | ✓ WIRED (:291) |
| reconcileMessaging guard | anyChannelEnabled('sms') | deps.anyEnabled default | ✓ WIRED (:99, :112, :137) |
| dispatchDueTouches | performSends | per-tenant try/catch | ✓ WIRED (:608-615) |
| performSends | ledger.setOutcome | per-send try/catch | ✓ WIRED (:537-562) |
| saveEmailConfigAction copy | gate semantics | "from the next send tick" — verbatim-pinned | ✓ WIRED (actions.ts:299 ↔ test:270) |
| (all 12 prior-run links) | — | — | ✓ WIRED (regression) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| dispatch | sender per channel | anyChannelEnabled + per-tenant resolvers | Yes — tenant override row proven to arm exactly one client against the hosted DB | ✓ FLOWING (was ⚠️ HOLLOW) |
| reconcile opt-out evidence | optedOutLedgerIds | four-field verdict corpus | Yes — fires on a status_text verdict, silent on both captured real payloads | ✓ FLOWING (was ✗ DISCONNECTED) |
| inbox page | untriaged rows | listInboundNeedingTriage | Yes (unchanged) | ✓ FLOWING |
| email settings page | domains + DNS records | Resend domains API | Yes (unchanged) | ✓ FLOWING |

### Behavioral Spot-Checks

Remote/integration suites run against the shared hosted Sydney production DB and were NOT re-run here (house rule: test:remote pauses deployed crons, runs serialized; 04-08/04-09 record their remote runs green, including the full 70-file/1512-test pass). Pure suites for every gap-touched area were run this session:

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| CR-03 isolation (both levels + T-2-02), CR-02 probe/fixtures/guard, CR-01 gates + console copy | `npx vitest run tests/cadence-dispatch-isolation.test.ts tests/messaging-reconcile.test.ts tests/routing-sender.test.ts tests/resend-sender.test.ts tests/email-settings-action.test.ts` | 122/122 pass | ✓ PASS |
| Type integrity after signature changes | `npx tsc --noEmit` | clean | ✓ PASS |
| CR-01 hosted-DB activation proof | (recorded, not re-run — remote house rule) | 04-08: 6 passed, run twice serialized; residue alarm green on second run proves teardown | ✓ PASS (recorded evidence) |
| Live SMS end-to-end | (one-shot live proof, prior run) | Evidence chain in docs/external-registrations.md | ✓ PASS (recorded evidence) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this project — SKIPPED. `verify-email-pipe.mjs` remains deliberately unexecuted; its execution is the override's recorded obligation, not a gap.

### Requirements Coverage

Gap plans declare: 04-08 `[MSG-01, MSG-02]`, 04-09 `[MSG-01, MSG-03]`, 04-10 `[MSG-02]` — all within the phase's MSG-01..04 mapping. No orphaned requirements.

| Requirement | Source Plans | Description | Status | Evidence |
| ----------- | ------------ | ----------- | ------ | -------- |
| MSG-01 | 04-03, 04-04, 04-07, 04-08, 04-09 | SMS via dedicated AU number, two-way, DLRs per message | ✓ SATISFIED | Live e2e proof; CR-03 tick-robustness now fixed and injection-tested; REQUIREMENTS.md `[x]` Complete |
| MSG-02 | 04-05, 04-06, 04-08, 04-10 | Email via verified domain, SPF/DKIM, identification, unsubscribe | ⚠ DEFERRED BY OVERRIDE | Pipe built and tested; per-tenant enable fixed (CR-01); live proof deferred by recorded override to first-client onboarding; REQUIREMENTS.md honestly `[ ]` Pending with pointer |
| MSG-03 | 04-01, 04-02, 04-05, 04-09 | Deterministic STOP/unsubscribe, both channels, immediate at gate | ✓ SATISFIED | Live STOP proof; the CR-02 provider-side backstop behind it can now fire; REQUIREMENTS.md `[x]` Complete |
| MSG-04 | 04-02, 04-06, 04-07 | Identification on every outbound; correct threading; ambiguity → triage | ✓ SATISFIED | Unchanged live evidence; REQUIREMENTS.md `[x]` Complete |

### Anti-Patterns Found

All three prior BLOCKERs are resolved (verified in source above). Scan of every gap-plan-modified file: no TBD/FIXME/XXX, no TODO/HACK/placeholder debt markers.

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| various | — | Advisory carry-forwards from 04-REVIEW.md: WR-01 (DLR body-read guard), WR-02 (ERROR-token classification), WR-04 (forgery blast radius), WR-06 (inbound message_id typing), WR-10 (replay dedupe), IN-06 (unsubscribe 500 on missing secret), + remaining warnings/info | ⚠️ WARNING | Never verification gaps; none contradicts a must-have. Tracked in 04-REVIEW.md for future hardening |
| touch body | — | `[STUB touch 1]` placeholder prose | ℹ️ INFO | Intentional; deferred to Phase 5. Compliance suffix real and live-verified |

### Human Verification Required

Six items (frontmatter `human_verification:`), summarized:

1. **DLR callback wire shape** — capture the first real callback body; confirm encoding + epoch-seconds (backstop truth #22 residue).
2. **Deploy before arming** — 17 commits sit unpushed on local main (including `e658ea1` and all three gap-closure fixes). Production still runs the pre-fix build; arming one client against the deployed build would still hit CR-01. Push + confirm deployment before first-client activation.
3. **Vercel Production env vars** — four webhook/signing secrets, dashboard-only.
4. **Phone-viewport inbox triage** — visual/ergonomic, deferred from 04-06.
5. **First-client email onboarding flow** — the override obligation's five-step sequence; the console flow's CR-01 blocker is fixed, so this is ready the moment a domain exists.
6. **Judgment-tier prohibitions (9)** — non-authoritative LLM-judge pass, flagged for human sign-off.

### Gaps Summary

**No gaps remain.** All four prior gaps are resolved:

- **Gap 1 (SC2/MSG-02)** — resolved by the recorded developer override (2026-08-30), honored as legitimate: blocked-external, obligation recorded in four artifacts, D-02's meaning and the Pending checkbox both intact.
- **Gap 2 (CR-01)** — closed in source: `anyChannelEnabled` deployment gate on both routing arms, resolvers as sole identity authority, rewritten comment, honest console copy, and the one-client-armed/every-other-refused proof against the hosted database with a residue alarm guarding the production-shared DB.
- **Gap 3 (CR-02)** — closed in source: one shared four-field verdict corpus asked from receipts AND reconcile, fixtures pinned to the two captured real payloads (asserted as negatives) plus a status_text opt-out, and the reconcile guard aligned with the new activation model.
- **Gap 4 (CR-03)** — closed in source: per-send and per-tenant guards, both catches binding nothing (T-2-02), no retries (D-07), proven by the failure-injection suite at the repository seam.

The phase goal's code-side achievement is complete. Status is `human_needed` rather than `passed` solely because six human items remain — most materially: the gap-closure fixes are committed but **undeployed** (item 2), and the email live proof is an event-gated obligation carried by the override. Nothing further is plannable; the remaining items are operator actions and future-event obligations.

---

_Verified: 2026-08-30T04:35:00Z_
_Verifier: Claude (gsd-verifier)_
