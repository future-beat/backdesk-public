# Phase 5: AI Drafting & Classification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-30
**Phase:** 5-AI Drafting & Classification
**Areas discussed:** Template freedom, Voice & approval capture, Draft timing & failure path, Classification consequences

The user selected all four proposed gray areas and asked Claude to propose recommendations for each question; every recommendation was accepted as presented.

---

## Template freedom

| Option | Description | Selected |
|--------|-------------|----------|
| Bounded rewrite | Template fixes intent/structure/rough wording; Claude re-renders per quote in the client's voice; facts only from merge data; validator enforces verbatim prices/dates | ✓ |
| Verbatim merge-fill | Template is the message; only merge fields substitute; no LLM at draft time | |
| Tiered freedom | Touch 1 near-verbatim, later touches progressively looser | |

| Option | Description | Selected |
|--------|-------------|----------|
| Quote + touch history | Quote facts plus which prior touches were sent, all from our mirror/ledger | ✓ |
| Quote facts only | Just the current quote's merge data | |

| Option | Description | Selected |
|--------|-------------|----------|
| Target 1, cap 2 segments | Prompt targets a single GSM-7 segment; validator hard-fails >2 segments | ✓ |
| Target 1, hard cap 1 | Strictly one segment | |
| No hard cap | Trust the template and prompt | |

| Option | Description | Selected |
|--------|-------------|----------|
| SMS-only templates | v1 onboarding requires only the 5 SMS templates; schema supports email from day one | ✓ |
| SMS + email now | Author and approve both channel variants per touch this phase | |

**User's choice:** All recommendations accepted.
**Notes:** None.

---

## Voice & approval capture

| Option | Description | Selected |
|--------|-------------|----------|
| Structured + examples | Structured fields (greeting, sign-off, formality, banned phrases) + 2–3 real example messages + free-text notes | ✓ |
| Freeform notes only | One text area filled during onboarding | |
| Derived from history | Ingest past ServiceM8 messages and summarize the voice | |

| Option | Description | Selected |
|--------|-------------|----------|
| Operator attests | Per-template-version approval with timestamp + evidence note, recorded by the operator | ✓ |
| Client email link | Client clicks an approval email | |

| Option | Description | Selected |
|--------|-------------|----------|
| Cadence born paused | quote_opened creates + materializes; unapproved tenant → paused (onboarding reason); approval resumes via D-07 re-window | ✓ |
| Gate at the draft step only | Cadences activate but touches can't leave needs_draft | |
| Gate at eligibility | Quotes for unapproved tenants stay out of chase eligibility | |

| Option | Description | Selected |
|--------|-------------|----------|
| Edit = new unapproved version | Approval binds to version; drafting uses last approved version until the new one is approved | ✓ |
| Edit revokes, drafting halts | Editing immediately unapproves and drafting pauses | |
| Edits apply silently | Approval is one-time per template slot | |

**User's choice:** All recommendations accepted.
**Notes:** None.

---

## Draft timing & failure path

| Option | Description | Selected |
|--------|-------------|----------|
| At needs_draft, per tick | Draft in the same tick pass as promotion, batched per tenant for prompt-cache reuse | ✓ |
| Daily batch pass | One scheduled pass drafts the coming day's queue | |
| On-demand in console | Draft when the operator opens the queue | |

| Option | Description | Selected |
|--------|-------------|----------|
| Stay needs_draft, retry next tick | Retry per tick; re-window/stale machinery handles lateness; never send a raw template | ✓ |
| Fallback to merge-filled template | Send the deterministic template on persistent API failure | |

| Option | Description | Selected |
|--------|-------------|----------|
| One retry, then flag mandatory review | Feed violation back once; second failure → validator_failed, human-only path | ✓ |
| No retry, straight to review | First failure flags mandatory review | |
| Retry until valid (capped) | Regenerate up to N times | |

| Option | Description | Selected |
|--------|-------------|----------|
| Real gate + minimal approve | pending_approval blocks; minimal approve/edit action on quote-detail page this phase | ✓ |
| Real gate, no UI yet | Blocks with no approve action until Phase 6 | |
| Keep auto-pass until Phase 6 | Drafts generate but approval stays stubbed | |

**User's choice:** All recommendations accepted.
**Notes:** None.

---

## Classification consequences

| Option | Description | Selected |
|--------|-------------|----------|
| Operator confirms suppression | Soft opt-out → triage top priority with one-tap killContact; LLM never writes suppression | ✓ |
| Auto-suppress on high confidence | High-confidence opt-out writes suppression directly | |

| Option | Description | Selected |
|--------|-------------|----------|
| Evidence + triage priority | Labels + confidence recorded; hot flag for interested/question; no state transitions | ✓ |
| Labels drive transitions now | e.g. not-interested auto-stops the cadence | |

| Option | Description | Selected |
|--------|-------------|----------|
| Threshold to operator | Below-threshold → treated as other/needs-human in triage, guess shown not acted on | ✓ |
| No confidence field | Trust the label always | |

| Option | Description | Selected |
|--------|-------------|----------|
| Async after recording | Webhook unchanged and LLM-free; classification runs post-response/next tick | ✓ |
| Inline in the webhook | Classify before responding | |

**User's choice:** All recommendations accepted.
**Notes:** None.

---

## Claude's Discretion

- Drafts table/storage shape (evidence-family conventions; must record model, template version, prompt version, validator result, edit distance)
- Edit-distance metric and computation point
- Validator implementation details (price/date extraction and verbatim matching)
- Prompt architecture within the decided shape; injection hardening for quote-derived text
- Classification schema details, exact confidence threshold, and where the async step runs
- Exact onboarding pause-reason name and approval-resume composition
- Voice-profile/template-version schema specifics; placement of the minimal approve/edit action
- Anthropic API failure taxonomy and draft-aging alerting

## Deferred Ideas

- Email touch templates required at onboarding — rides with first-client email enablement (MSG-02 event)
- Sampled review / graduated autonomy — V2-01, gated on AI-04 edit-rate data
- AI-suggested replies to customer responses — V2-02
- Auto-suppression of high-confidence soft opt-outs — revisit only if triage volume demands, as a compliance-reviewed policy decision
