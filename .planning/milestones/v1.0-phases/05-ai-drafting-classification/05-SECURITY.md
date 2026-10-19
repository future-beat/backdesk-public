---
phase: 5
slug: ai-drafting-classification
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-31
---

# Phase 5 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Anthropic API | Drafting (claude-sonnet-5) and classification (claude-opus-5) calls | Quote facts, template wording, customer reply bodies (outbound); model output (inbound, untrusted) |
| Customer SMS replies | Inbound bodies reaching the classifier via inbound_messages | Untrusted free text — schema-only classification, no tools, 4-column write surface |
| ServiceM8-derived quote data | Job descriptions / names entering drafting prompts | Untrusted third-party text — fenced in the user turn, delimiter-stripped |
| Operator console (server actions) | Voice profile, template versions, attestation, approve/edit-approve, suppress one-tap | Authorize-first RLS-scoped writes; service-role transactions behind tenant closure |
| npm supply chain | @anthropic-ai/sdk 0.122.0 | Human-verified at blocking checkpoint ([SUS: too-new] recency-only) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-5-01 | Tampering | drafting/validate + draft-touches | high | mitigate | Whitelist scan validate.ts:287-298; judge appends suffix without template access; approval gate for-tenant.ts:343 | closed |
| T-5-02 | Elevation | touch lifecycle gates | high | mitigate | PROMOTABLE=['scheduled']; sole approved-writer guarded on pending_approval; write-once draft; touch_drafts_one_approved_per_touch partial unique index | closed |
| T-5-03 | Info disclosure | anthropic client / touch_drafts | high | mitigate | Error mapping returns class+status only; RLS + has_tenant_access on touch_drafts (0028) | closed |
| T-5-04 | Info disclosure | env handling | medium | mitigate | ANTHROPIC_API_KEY optional in env.ts, single process.env read, never argv | closed |
| T-5-05 | Tampering | dispatch body seam | high | mitigate | no_approved_draft refusal before ledger claim; stubTouchBody has zero production callers | closed |
| T-5-SC | Tampering | npm supply chain | high | mitigate | Blocking human-verify checkpoint on [SUS] verdict; package.json pins approved 0.122.0 | closed |
| T-5-06 | Tampering | price/date validator | critical | mitigate | Greedy NUMBER_TOKEN, run-to-run whitelist (digit-run decomposition), DATE_WORD guard, conservative refusal direction; 400 assertions green | closed |
| T-5-07 | Tampering | prompt injection via quote data | high | mitigate | C0/C1 strip + delimiter removal + code-point cap; untrusted fields fenced in user turn only; system block reads no ServiceM8 text | closed |
| T-5-08 | DoS | GSM-7/UCS-2 handling | medium | mitigate | Hard-fail on ucs2 encoding regardless of length | closed |
| T-5-09 | Repudiation | AI-04 evidence chain | low | accept | Accepted risk R-5-01 (below); compensating: PROMPT_VERSION recorded per draft, notNull columns, 14 known-answer tests | closed |
| T-5-10 | Elevation | onboarding pause resume | high | mitigate | Repository predicate pause_reason IS DISTINCT FROM 'onboarding' + matrix refusal (onboarding_gated) | closed |
| T-5-11 | Tampering | attestation write | high | mitigate | approveWhereUnapproved guarded on isNull(approvedAt) — write-once | closed |
| T-5-12 | Repudiation | attestation evidence | medium | mitigate | approvedAt + required approvalNote set atomically | closed |
| T-5-13 | DoS | vacuous approval set | high | mitigate | Empty template set reads unapproved (explicit length guard before .every) | closed |
| T-5-14 | DoS | Anthropic failure loop | medium | mitigate | Failure taxonomy; MAX_DRAFT_ATTEMPTS=5; draft_failures<5 cap (migration 0030); batch break arms | closed |
| T-5-15 | Tampering | validator-judge fallback | critical | mitigate | Judge has no template-body access; sentinel property test over 9 failure scenarios asserts no merge-fill fallback | closed |
| T-5-16 | Info disclosure | tick route response | high | mitigate | Field-by-field enumerated numeric response (T-3-24) | closed |
| T-5-17 | DoS | drafting pass runtime | medium | mitigate | DRAFT_BATCH_LIMIT=25, sequential with break arms, maxDuration=300 (bounds, not eliminates — research A6 fallback documented) | closed |
| T-5-18 | Elevation | drafting server actions | high | mitigate | authorize() first statement in all 3 exports, RLS-scoped JWT read before any formData | closed |
| T-5-19 | Tampering | voice profile → prompt | medium | accept | Accepted risk R-5-02 (below); compensating: sanitize() strips invisibles/headings/delimiters, length + array caps | closed |
| T-5-20 | Repudiation | attestation note quality | medium | mitigate | zod .min(1) + required core parameter + write-once | closed |
| T-5-21 | Elevation | classification request | high | mitigate | No tools key; output_config zodOutputFormat closed enum; pinned 4-column label write guarded label IS NULL | closed |
| T-5-22 | Tampering | classification blast radius | high | mitigate | Import-list equality assertion in classification-privilege.test.ts; reaches only 4 repository fns | closed |
| T-5-23 | Info disclosure | classification logging | high | mitigate | Four counts in route; class+status only in pass logging | closed |
| T-5-24 | DoS | classification retry loop | medium | mitigate | MAX_CLASSIFY_ATTEMPTS=5 in read predicate, SQL-side increment | closed |
| T-5-25 | Elevation | approve/edit actions | high | mitigate | Real authorize first; replay inert via partial unique index | closed |
| T-5-26 | Tampering | edited-body approval | high | mitigate | validateDraft re-run on edited bytes with whitelist rebuilt from tenant-scoped DB mirror at draft-time anchor; zero-write refusal | closed |
| T-5-27 | Elevation | inbox one-tap suppression | high | mitigate | Delegates to existing killContactAction (sole call site, gate-first); no new write path | closed |
| T-5-28 | Info disclosure | console logging | medium | mitigate | No console.* in new components; phase-5 log lines carry ids/codes only | closed |
| T-05-08-01 | Tampering | gap-fix CSS delta | low | accept | Accepted risk R-5-03 (below); verified presentation-only (globals.css + one className; D-13 boundary untouched) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-5-01 | T-5-09 | Edit-distance metric fidelity is an analytics concern, not a safety control; per-draft model/template/prompt-version columns are notNull and pinned by known-answer tests. Plan-time accept disposition. | operator (plan-time disposition, 05-02) | 2026-08-31 |
| R-5-02 | T-5-19 | Operator-authored voice text is trusted-adjacent input from the authenticated operator; sanitize() strips control chars, markdown headings and prompt delimiters, with length/array caps. Residual risk is the operator prompt-injecting their own tenant — accepted. | operator (plan-time disposition, 05-05) | 2026-08-31 |
| R-5-03 | T-05-08-01 | Gap-fix delta is presentation-only CSS + one className; verified via git show 6334881 that no compliance boundary (D-13 STOP path) is touched. | operator (plan-time disposition, 05-08) | 2026-08-31 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-31 | 30 | 30 | 0 | gsd-security-auditor (ASVS L1, verify-mitigations mode, plan-time register) |

Notes: 27 threats verified mitigated against code at HEAD (post code-review fixes 05-REVIEW-FIX.md and the claude-opus-5 classifier swap); 3 plan-time accept dispositions closed by the Accepted Risks Log above. Unregistered-surface sweep clean: 5 new server actions all authorize-first, no new API routes, both new tables RLS-protected, one new dependency human-verified (T-5-SC). Residual observation (non-finding): T-5-17 bounds rather than eliminates worst-case pass runtime; research A6 fallback documented.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
