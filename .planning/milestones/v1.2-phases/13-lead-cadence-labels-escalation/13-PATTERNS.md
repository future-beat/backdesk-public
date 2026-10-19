# Phase 13: Lead Cadence, Labels & Escalation - Pattern Map

**Mapped:** 2026-10-08
**Files analyzed:** 38 new/modified (27 source/schema/migration, 11 test files new, replaced or deliberately edited)
**Analogs found:** 37 / 38

Inputs: `13-CONTEXT.md` (D-01..D-17), `ROADMAP.md` Phase 13 (success criteria 1-4, planning note), `12-PATTERNS.md` as the format precedent. There is no `13-RESEARCH.md` in the phase directory at mapping time; where CONTEXT says "research decides" the mapper records both candidate shapes and names the tripwire each one trips. No `.claude/skills/` directory exists.

All paths are relative to the repo root `<repo>` (note the space). Line ranges were read on 2026-10-08 at commit `06944ee`.

File names marked (proposed) are the mapper's inference from the decisions; the planner may rename them. Everything else is an existing file.

---

## File Classification

### Policy and constants

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/leads/constants.ts` (mod: `LEAD_MIN_GAP_HOURS`, `LEAD_STALENESS_CAP_HOURS`, `LEAD_EXPIRY_DAYS`, `LEAD_NEGATIVE_COOL_OFF_DAYS`, `LEAD_RING_TWICE_MINUTES`, `LEAD_EMERGENCY_KEYWORDS`) | config (no-imports constants) | n/a | itself lines 1-25, 39-68; `src/core/cadence/constants.ts` 68-99 (the three quote magnitudes being mirrored) | exact |
| `src/core/cadence/policy.ts` (new, proposed: `cadencePolicyFor(kind)` returning `{minGapHours, stalenessCapHours, expiryDays, touchOffsetDays}`) | utility (pure) | transform | `src/core/onboarding/arming.ts` 95-106 (`ARMING_GATES` keyed `as const satisfies Record<…>`) + `src/core/cadence/constants.ts` header 12-24 (the "repository stays ignorant of policy; caller passes it in" seam) | role-match |

### Schema and migration

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/migrations/0040_phase13_lead_cadence.sql` (proposed tag) + `meta/_journal.json` idx 40 + `meta/0040_snapshot.json` | migration | batch DDL | `src/db/migrations/0039_phase12_text_back.sql` lines 1-92 (header), 161-221 (DDL idioms) | exact |
| `src/db/schema/inbound-messages.ts` (mod: `LEAD_LABELS`, `LEAD_URGENCIES`, `urgency` column, CHECK by kind) | model | event-driven | itself lines 112-156 (`INBOUND_LABELS`/`LABEL_CONFIDENCES`), 245-262 (label columns), 289-300 (CHECKs) | exact |
| `src/db/schema/leads.ts` (mod: `closed_reason`, `closed_at`, `LEAD_CLOSED_REASONS`, CHECK, status/closed consistency CHECK) | model | CRUD (evidence family) | itself lines 44-58 (vocabularies), 60-111 (table); `missed-calls.ts` `missed_calls_skip_reason_iff_skipped` (0039:217) for the iff-CHECK shape | exact |
| `src/db/schema/tenants.ts` (mod: `after_hours_escalation boolean NOT NULL DEFAULT false`) | model | CRUD | itself lines 35-40 (`escalationPhone`), `leads.ts:84` (`afterHours: boolean(...).notNull()`) | exact |
| `src/db/schema/message-templates.ts` (mod: `kind` column, CHECK, unique index widened to include `kind`) OR `src/db/schema/lead-templates.ts` (new sibling) | model | CRUD (versioned config) | itself lines 84-150; sibling shape `src/db/schema/text-back-templates.ts` (variant + version + attestation CHECKs) | exact |
| `src/db/schema/missed-calls.ts` (mod: `recent_negative_close` in `TEXT_BACK_SKIP_REASONS`) | model | event-driven | itself line 129-143; CHECK in 0039:214 | exact |
| `src/db/schema/escalations.ts` (mod: `hold_until` or equivalent, index for the held read) | model | event-driven | itself lines 117-215 | exact |
| `src/db/schema/cadences.ts` (mod only if a lead stop reason is added to `CADENCE_STOP_REASONS`) | model | CRUD | itself lines 285-295 | exact |

### Repository

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/repository/for-tenant.ts` (mod: `promoteDue`/`listNeedsDraft`/`claimDue` kind branches; `listLive(kind)` callers; `leads.close`, `leads.latestClosedForMobile`; lead template reads; `ClaimedTouch` widening) | service (repository) | CRUD | same file: `promoteDue` 3019-3040, `listNeedsDraft` 3041-3070, `claimDue` 3470-3525, `cadences.createLead` 3044-3063, `leads` 4124-4166, `templates.ensureDefaults` 2604-2622, `insertVersion` 2680-2700, `existsTextBackToCallerSince` 4089-4105 | exact |
| `src/db/repository/inbound-messages.ts` (mod: `listUnclassified` carries the cadence `kind`; `writeClassification` gains `urgency`) | service (repository) | CRUD | same file 365-460 | exact |
| `src/db/repository/escalations.ts` (mod: held-escalation claim/release; ring-twice claim reuses `claimEscalationForMissedCall`) | service (repository) | event-driven | same file 106-182 (two claims), 304-316 (cooldown read) | exact |
| `src/db/repository/for-all-tenants.ts` (mod: `forAllTenants_hotUnescalated` lead-aware; `forAllTenants_ringTwiceCalls` (proposed); held-escalation release read) | service (repository) | batch | same file 1309-1370 (`hotUnescalated`), 617-640 (`cadencesByContactMobile`) | exact |
| `src/db/repository/missed-calls.ts` (mod: `listUnescalatedQuoteCalls` sibling for ring-twice; last-closed-lead reader) | service (repository) | event-driven | same file 363-385, 429-460 | exact |
| `src/db/repository/index.ts` (mod: barrel block for the new exports) | config | n/a | itself 395-430 (the Phase 12 block prose + export list) | exact |

### Core

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/cadence/run-tick.ts` (mod: per-kind expiry, per-kind progress/rewindow, held-escalation release pass, ring-twice pass, enumerated result keys) | service | batch | itself: `expireOverdueCadences` 691-720, `rewindowCadence` 740-798, `runProgressPass` 810-860, `runEscalationPass`/`runQuoteCallEscalationPass` 1056-1092, wiring 1312-1356, result 1395-1451 | exact |
| `src/core/cadence/rewindow.ts` (mod: policy magnitudes become inputs, not module constants) | utility (pure) | transform | itself 95-120 (`RewindowInput`), 150-234 (`rewindowTouch`) | exact |
| `src/core/cadence/dispatch.ts` (mod: `dispatchOne` kind branch — lead touch does not look up the quote mirror) | service | batch | itself 400-430 (`mirror_missing` branch), 452-525 (address, suppression, window, draft, claim) | exact |
| `src/core/drafting/draft-touches.ts` (mod: lead facts + lead template read when `cadence.quoteId === null`) | service | batch | itself 800-880 | exact |
| `src/core/drafting/prompt.ts` (mod: `LeadFacts`, lead facts block after the stable prefix, `PROMPT_VERSION = 'p5'`) | utility (pure) | transform | itself 88-135, 316-434 | exact |
| `src/core/leads/template.ts` (mod or new sibling `lead-template.ts`: `defaultLeadTemplateBody(touch, businessName)` + save-time validator) | utility (pure) | transform | itself 68-161 | exact |
| `src/core/leads/keywords.ts` (new, proposed: `isEmergencyKeywordMessage(body)`) | utility (pure) | transform | `src/core/messaging/stop-keywords.ts` 38-80 (anchored regex, non-global, non-string → false); `src/core/leads/gate.ts` 93-134 (ordered pure rule) | exact |
| `src/core/classification/schema.ts` (mod: `LeadLabel`, `LeadUrgency`, `LeadClassification` zod derived from the schema consts) | utility (zod) | transform | itself 43-71 | exact |
| `src/core/classification/classify-inbound.ts` (mod: vocabulary chosen by kind; `LEAD_LABEL_DEFINITIONS: Record<LeadLabel,string>`; `isHotLead` lead arm; keyword pre-rule; lead label effects) | service | batch | itself 115-150 (definitions + instructions), 284-287 (`isHotLead`), 352-395 (`record`), 420-450 (API call + re-validation) | exact |
| `src/core/leads/close.ts` (new, proposed: `closeLead(tenantId, leadId, reason)` idempotent) | service | CRUD | `src/core/cadence/controls.ts` 280-360 (`suppressAndStop`: read, transition, guarded stop, skip unsent, result union) | exact |
| `src/core/leads/gate.ts` (mod: rule `recent_negative_close` after `recent_text`) | utility (pure) | transform | itself 13-30 (ordered header), 97-134 | exact |
| `src/core/leads/text-back.ts` (mod: assemble the negative-close fact; `leadSchedule` note) | service | event-driven | itself 340-420 (fact assembly), 625-675 (`leadSchedule`) | exact |
| `src/core/escalation/escalate-hot-leads.ts` (mod: hours/switch gate for lead rows, held outcome) | service | event-driven | itself 192-336 | exact |
| `src/core/escalation/ring-twice.ts` (new, proposed) | service | event-driven | `src/core/escalation/quote-call.ts` 133-215 (list → per-row → claim-by-missed-call → outcome) | exact |
| `src/core/escalation/message.ts` (mod: `buildRingTwiceEscalationSms`, `buildLeadEscalationSms` wording) | utility (pure) | transform | itself 315-362 (`buildEscalationSms`), 364-433 (`buildQuoteCallEscalationSms`) | exact |
| `src/core/messaging/inbound.ts` (mod: keyword hot-mark at the door for lead replies; quote-wins rule on a two-kind match) | service | event-driven | itself 262-315 (`handleSingleMatch`), 417-490 (many matches) | exact |
| `src/core/aging/stalled-digest.ts` (mod: "cold leads / held escalations" section) | service | batch | itself 46-86 (`buildStaleAttestationSection`) | exact |

### Console

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(console)/clients/[id]/after-hours-escalation-form.tsx` (new, proposed) | component | request-response | `src/app/(console)/clients/[id]/escalation-phone-form.tsx` (92 lines, whole file) | exact |
| `src/app/(console)/clients/[id]/actions.ts` (mod: `updateAfterHoursEscalationAction`) | controller (server action) | request-response | itself 439-503 (`updateEscalationPhoneAction`) | exact |
| `src/app/(console)/clients/[id]/action-state.ts` (mod: state type, blank, saved sentence) | utility (client-safe leaf) | n/a | itself 42-60, 93-99 | exact |
| `src/app/(console)/clients/[id]/page.tsx` (mod: read `after_hours_escalation`, mount the form) | component (server page) | request-response | itself 486 (select list), 907-916 (profile row + form mount) | exact |
| `src/app/(console)/clients/new/{form,actions}.tsx` (mod: onboarding default for emergency trades — only if D-09 "set at onboarding" is read as the create form) | controller/component | request-response | themselves (`escalation_phone` field, lines 27, 76, 109, 164) | exact |

### Tests

| File | Role | Analog |
|---|---|---|
| `tests/lead-cadence-active.test.ts` (REPLACES `tests/lead-cadence-inert.test.ts`, D-17) | test (DB-backed, CI-only) | the file it replaces, 1-200, 294-340; `tests/cadence-tick.test.ts` |
| `tests/cadence-policy.test.ts` (pure: per-kind magnitudes, boundaries) | test (pure) | `tests/cadence-rewindow.test.ts` 1-45 |
| `tests/cadence-policy-side-by-side.test.ts` (DB-backed: lead touch 2 sent at ~24 h, quote touch 2 held — D-03) | test (DB-backed, CI-only) | `tests/lead-cadence-inert.test.ts` seeding 150-200; `tests/cadence-dispatch.test.ts` |
| `tests/lead-keywords.test.ts` (pure) | test (pure) | `tests/text-back-gate.test.ts` 1-40; `tests/stop-keywords*.test.ts` if present, else `stop-keywords.ts` header cases |
| `tests/classify-lead.test.ts` (pure, structural fakes) | test (pure) | `tests/classify-inbound.test.ts` 1-45 |
| `tests/classification-privilege.test.ts` (mod: pinned select/set lists change) | test (structural) | itself 1-30, 287-299 |
| `tests/lead-labels-three-places.test.ts` (structural: TS const ↔ 0040 CHECK ↔ zod) | test (structural) | `tests/classification-privilege.test.ts` 287-299; `tests/text-back-structure.test.ts` 1-40 |
| `tests/escalation-lead.test.ts` / `tests/ring-twice.test.ts` (DB-backed) | test (DB-backed, CI-only) | `tests/escalation.test.ts` 1-45; `tests/lead-reply.test.ts` 1-45 |
| `tests/escalation-message.test.ts` (mod: new builders byte-for-byte) | test (pure) | itself 41-90 |
| `tests/drafting-prompt.test.ts` (mod: `p5`, lead facts after prefix, byte-identity) | test (pure) | itself 78-90 |
| `tests/text-back-gate.test.ts` (mod: `recent_negative_close` position) + `tests/lead-close.test.ts` (DB-backed idempotence) | test | themselves; `tests/cadence-controls.test.ts` |
| `tests/lint-ban.test.ts` (mod: pin the new client-safe leaf if a new form imports a constant) | test (structural) | itself 668-745 |

---

## Pattern Assignments

### `src/core/leads/constants.ts` + `src/core/cadence/policy.ts` (per-kind policy, D-03)

**Analog:** `src/core/cadence/constants.ts` lines 68-99 — the three quote magnitudes, each a named export with a D-reference and a "why this number" paragraph:

```ts
export const MIN_GAP_HOURS = 48;        // D-10, line 78
export const STALENESS_CAP_HOURS = 72;  // D-11, line 89
export const CADENCE_EXPIRY_DAYS = 42;  // D-12, line 99
```

**Where the lead values go:** `src/core/leads/constants.ts` — already the no-imports module for lead mechanism constants (header lines 1-12: "No imports, so the pure gate, the send path, the sweep and the tests can all read the same values"). `LEAD_TOUCH_OFFSET_DAYS = [0, 1, 2] as const` is at line 25 with the D-19 "INERT until Phase 13" paragraph (lines 19-23) that this phase must rewrite.

**The selection shape:** mirror `ARMING_GATES` (`src/core/onboarding/arming.ts` 95-106):
```ts
export const ARMING_GATES = {
  sms: BOTH_CHANNELS,
  email: [...BOTH_CHANNELS, 'sendingDomainVerified'],
  text_back: [...],
} as const satisfies Record<MessagingChannel, readonly ChecklistItemKey[]>;
```
i.e. `CADENCE_POLICY = { quote: {...}, lead: {...} } as const satisfies Record<CadenceKind, CadencePolicy>` — one object, keyed by `cadences.kind`, so a third kind is a type error until it has numbers.

**Who reads it:** `rewindowTouch` currently imports `MIN_GAP_HOURS`, `STALENESS_CAP_HOURS`, `CADENCE_EXPIRY_DAYS` at module level (`rewindow.ts` lines 172, 183, 229). D-03 means these become fields of `RewindowInput` (lines 95-120) with the quote values as defaults, OR the caller `rewindowCadence` (`run-tick.ts` 740-798) passes `cadencePolicyFor(cadence.kind)`. `expireOverdueCadences` (`run-tick.ts` 691-720) compares against `CADENCE_EXPIRY_DAYS * MS_PER_DAY` at line 701 — same substitution.

**Tripwire:** `tests/cadence-rewindow.test.ts` imports the four quote constants by name (lines 32-37) and asserts boundaries at exactly 48/72/42 — those tests must keep passing untouched (D-17). Changing the quote values or their export names is a red.

---

### `src/db/migrations/0040_*.sql` (migration, one journal entry, D-16)

**Analog:** `src/db/migrations/0039_phase12_text_back.sql`.

**Header mould** (0039 lines 1-21): boxed "ONE ENTRY FOR THE PHASE" statement listing everything riding the entry and "NO OTHER PLAN IN THIS PHASE TOUCHES THE JOURNAL"; then "GENERATED by drizzle-kit from src/db/schema/{...}.ts, then renamed from its random tag and re-tagged in meta/_journal.json. The generator's `when` (N) is AHEAD of 0039's 1791222883774 — CHECKED rather than assumed, because drizzle's migrator silently SKIPS an entry older than the last applied one." The last journal entry is idx 39, `when` 1791222883774.

**"Safe to meet Phase 12 code in production"** (0039 lines 45-53): every column added to an existing table NULLABLE or DEFAULTED; every changed CHECK WIDENING-only. Phase 13's columns all qualify: `tenants.after_hours_escalation DEFAULT false NOT NULL`, `inbound_messages.urgency` nullable, `leads.closed_reason`/`closed_at` nullable, `escalations.hold_until` nullable, `message_templates.kind DEFAULT 'quote' NOT NULL` (if the existing table is chosen).

**CHECK widening is hand-finished** (0039 lines 161-163 then 205, 211-214):
```sql
ALTER TABLE "missed_calls" DROP CONSTRAINT IF EXISTS "missed_calls_text_back_skip_reason_known";--> statement-breakpoint
...
ALTER TABLE "missed_calls" ADD CONSTRAINT "missed_calls_text_back_skip_reason_known" CHECK (text_back_skip_reason IS NULL OR text_back_skip_reason IN ('not_armed', 'own_number', 'withheld', 'not_mobile', 'suppressed', 'recent_text', 'daily_cap', 'stale', 'sms_not_armed', 'no_template', 'lead_open', 'quote_open'));--> statement-breakpoint
```
Phase 13 widens this one (`recent_negative_close`) and, if lead stop reasons are added, `cadences_stop_reason_known`. drizzle emits a bare DROP; rewrite to drop-if-exists + re-add.

**The by-kind label CHECK** has no exact precedent; the nearest shape is `cadences_kind_identity` (0039:202):
```sql
CHECK ((kind = 'quote' AND quote_id IS NOT NULL AND sm8_job_uuid IS NOT NULL AND lead_id IS NULL) OR (kind = 'lead' AND lead_id IS NOT NULL AND quote_id IS NULL AND sm8_job_uuid IS NULL))
```
`inbound_messages` has no `kind` column — it has `cadence_id`, `quote_id` (nullable) and `lead_id` (0039:173). The CHECK can key on `lead_id IS NOT NULL` ("lead vocabulary") vs `lead_id IS NULL` ("quote vocabulary"):
```sql
CHECK (label IS NULL OR (lead_id IS NULL AND label IN ('interested', …)) OR (lead_id IS NOT NULL AND label IN ('new_enquiry', …)))
```
and `urgency IS NULL OR lead_id IS NOT NULL` (urgency is lead-only). Unmatched/ambiguous rows have `lead_id` NULL and are never classified (`listUnclassified` excludes only `dead_letter`; `hotUnescalated` requires `threaded`), so they fall under the quote arm harmlessly — state this in the migration header.

**Partial unique index with predicate, targeted arbiter** (0039:191, 195):
```sql
CREATE UNIQUE INDEX "leads_one_open_per_mobile" ON "leads" USING btree ("tenant_id","contact_mobile") WHERE status = 'open';
CREATE UNIQUE INDEX "cadences_one_live_per_lead" ON "cadences" USING btree ("lead_id") WHERE lead_id IS NOT NULL AND status IN ('active', 'paused');
```
Both stay. `closeLead` writes `status = 'closed'`, which EXITS the partial index, so a later call can open a new lead (D-12) — this is why no index change is needed for repeat callers.

**Grant block, one per NEW table** (0039 lines 92, and 12-PATTERNS §migration): only needed if a sibling `lead_templates` table is chosen. Widening `message_templates` needs no grant change.

**Push protocol** (12-03-PLAN.md line 22, 12-03-SUMMARY.md line 50): CI on a throwaway branch proves 0040 on a journal-only database; then on the hosted database — read-only pre-flight counts, `cron:status` lease 0, `db:generate` reports no changes, `db:migrate` records 41 entries, second run no-op, read-back under RLS; only then push `main`. Schema before code.

---

### `src/db/schema/inbound-messages.ts` + `schema.ts` + `classify-inbound.ts` (LEAD_LABELS three-place derivation, D-05)

**Analog:** the existing `INBOUND_LABELS` chain, which is exactly the three-place pattern the ROADMAP names.

**Place 1 — TS const** (`inbound-messages.ts` 140-156):
```ts
export const INBOUND_LABELS = [
  'interested', 'question', 'objection', 'not_interested', 'opt_out', 'other',
] as const;
export type InboundLabel = (typeof INBOUND_LABELS)[number];
export const LABEL_CONFIDENCES = ['high', 'medium', 'low'] as const;
```
Add beside it `LEAD_LABELS` (10 members from D-05, underscore spelling) and `LEAD_URGENCIES = ['emergency', 'this_week', 'flexible', 'unknown'] as const`, each with the per-member definition comment block the quote vocabulary has at 112-139. Reuse `LABEL_CONFIDENCES` unchanged.

**Column** (245-250): `label: text('label')`, `labelConfidence: text('label_confidence')`. Add `urgency: text('urgency')` nullable with the comment "NULL on every quote row and until classified".

**Place 2 — CHECK** (289-300): the `IS NULL OR IN (…)` shape, hand-pinned. The comment at 291-293 says "The spelling here must match INBOUND_LABELS and the zod enum byte for byte" — repeat it for the lead arm.

**Place 3 — zod derived, never retyped** (`src/core/classification/schema.ts` 43-71):
```ts
export const ReplyLabel = z.enum(INBOUND_LABELS);
export const ReplyConfidence = z.enum(LABEL_CONFIDENCES);
export const ReplyClassification = z.object({ label: ReplyLabel, confidence: ReplyConfidence });
```
Add `LeadLabel = z.enum(LEAD_LABELS)`, `LeadUrgency = z.enum(LEAD_URGENCIES)`, `LeadClassification = z.object({ label, urgency, confidence })`. The header's "TWO FIELDS, AND DELIBERATELY NO FREE-TEXT ONE" (56-65) is D-05's "no free-text summary" — three fields now, still no prose.

**Prompt definitions are a `Record<Label, string>`** (`classify-inbound.ts` 115-131) so an undefined label is a type error:
```ts
const LABEL_DEFINITIONS: Record<InboundLabel, string> = { interested: '…', … };
export const CLASSIFIER_INSTRUCTIONS = [
  "You classify a customer's SMS reply to a tradesperson's quote follow-up.",
  …
  'Choose exactly one label:',
  ...INBOUND_LABELS.map((label) => `  ${label} — ${LABEL_DEFINITIONS[label]}`),
```
Build `LEAD_LABEL_DEFINITIONS: Record<LeadLabel, string>` and `LEAD_CLASSIFIER_INSTRUCTIONS` the same way (reply to a missed-call text, not a quote follow-up), plus an urgency paragraph.

**The API call re-validates at the boundary** (420-448):
```ts
response = await client.messages.parse({
  model: CLASSIFY_MODEL, max_tokens: MAX_CLASSIFY_TOKENS,
  system: CLASSIFIER_INSTRUCTIONS,
  messages: [{ role: 'user', content: body }],
  output_config: { format: zodOutputFormat(ReplyClassification) },
} as Anthropic.MessageCreateParamsNonStreaming);
…
const parsed = ReplyClassification.safeParse(response.parsed_output);
if (!parsed.success) return { kind: 'unparseable' };
```
Select `system` and `format` by the row's kind; keep NO `tools` key (comment 398-405; `classification-privilege` pins it).

**The hot rule lives in one private function** (284-287):
```ts
function isHotLead(label: InboundLabel, confidence: string): boolean {
  if (confidence !== 'high') return false;
  return label === 'interested' || label === 'question';
}
```
Add the lead arm (D-07) as a sibling `isHotLeadReply(label, urgency, confidence)` and dispatch by kind; the escalation pass CONSUMES `is_hot` and never re-derives (`for-all-tenants.ts` 1292-1296, `escalate-hot-leads.ts` 21-23).

**Row kind must reach the classifier:** `UnclassifiedRow` is `{id, body, receivedAt, classifyAttempts}` (`inbound-messages.ts` repo 365-370) with a header that says `tenant_id`, `cadence_id` are deliberately ABSENT. Adding a `kind`/`leadId IS NOT NULL` boolean is the minimum: `listUnclassified` (394-416) reads `inbound_messages` alone — select `isNotNull(inboundMessages.leadId)` as `isLead` rather than joining `cadences`. `writeClassification` (438-460) has "THE PINNED SET LIST. Four columns" — `urgency` makes five, and `tests/classification-privilege.test.ts` is written to go red on that (its comment says so at 443-445). Update the test deliberately.

**Label effects on the lead (D-11)** have no analog inside the classifier — Phase 5 decided "no label triggers a state transition" (`escalate-hot-leads.ts` 19-21), and `classification-privilege` pins that `killContact` is unreachable from the module. Two honest shapes: (a) a separate tick pass that reads classified lead rows with `lead_id` and applies `closeLead`, mirroring how escalation is its own scan (`hotUnescalated`'s anti-join 1338-1346); (b) widen the classifier. The planner should pick (a) and update `classification-privilege` only for `urgency`. The reply pause is already written at the door (`inbound.ts` 299).

---

### `src/core/leads/keywords.ts` (deterministic emergency rule, D-06)

**Analog:** `src/core/messaging/stop-keywords.ts` 38-80.

```ts
const STOP_PATTERN =
  /^\s*(?:stop\s*all|stop|unsubscribe|cancel|end|quit|opt[\s-]?out)\s*[.!]?\s*$/i;

export function isStopMessage(body: string): boolean {
  if (typeof body !== 'string') return false;
  return STOP_PATTERN.test(body);
}
```
Differences the planner must state: STOP is ANCHORED (whole message), the emergency rule is `\b…\b` ANYWHERE, case-insensitive, NOT global (the "lastIndex" note at 62-64 applies). Keep the list as a named const in `src/core/leads/constants.ts` (`LEAD_EMERGENCY_KEYWORDS`) and build the regex from it with escaping, so the test pins the list, not a regex literal. Framework-free, logs nothing (header 32-36: T-4-02 — the body never reaches a platform log).

**Order of rules at the door:** `inbound.ts` 223 `const isStop = isStopMessage(input.body);` runs before the candidate lookup; the keyword rule runs AFTER the single-match branch has decided the row is a lead reply (`candidate.leadId !== null`, 287) and BEFORE `insertInboundMessage` so `is_hot = true` can be written on insert — `isHot` is `notNull().default(false)` (`inbound-messages.ts` 253). The classifier's `writeClassification` is guarded on `label IS NULL`, not on `is_hot`, so a keyword-hot row still gets its label later (D-06 "keyword hits still get classified afterwards").

---

### `src/core/leads/close.ts` (closeLead, D-11/D-14)

**Analog:** `src/core/cadence/controls.ts` 280-360 `suppressAndStop` — read, pure transition, guarded stop, skip-unsent in the same transaction, result union:

```ts
const [cadence] = await repo.cadences.getById(cadenceId);
if (!cadence) return { kind: 'no_cadence' };
…
return repo.transaction(async (tx) => {
  const outcome = cadenceTransition({ status, pauseReason }, 'contact_killed');
  if (outcome.kind !== 'move') return { kind: 'already_stopped' as const, … };
  const stopped = await tx.cadences.stopWhereLive([cadence.id], KILL_STOP_REASON);
  if (stopped.length === 0) return { kind: 'already_stopped' as const, … };
  const skipped = await tx.touches.skipUnsentForCadences([cadence.id], KILL_SKIP_REASON);
  return { kind: 'killed' as const, …, touchesSkipped: skipped.length };
});
```
`stopReasonFor('operator_closed')` → `'operator_closed'` (`controls.ts` 84; `CADENCE_STOP_REASONS` at `cadences.ts` 285-295). A lead close that is not operator-driven needs either a new stop reason (`lead_closed`, CHECK widening in 0040) or reuses `operator_closed`; the lead's own `closed_reason` carries the label-set vocabulary either way.

**Idempotent lead write:** the house guard shape, from `writeClassification` (`inbound-messages.ts` repo 448-459):
```ts
.update(inboundMessages).set({…})
.where(and(eq(inboundMessages.id, id), isNull(inboundMessages.label)))
.returning({ id: inboundMessages.id });
return { classified: rows.length > 0 };
```
→ `leads.close(id, reason, at)`: `UPDATE leads SET status='closed', closed_reason, closed_at, updated_at WHERE tenant_id AND id AND status = 'open' RETURNING id`; zero rows = already closed = fine, not news. The lead's current `leads` namespace (`for-tenant.ts` 4124-4166) has `openOrCreate` (targeted `ON CONFLICT` on the partial index), `noteRepeatCall` (guarded on `status = 'open'`), `byId`.

**Ordering inside the transaction:** stop cadence then close lead, both on `tx` (the `text-back.ts` 438-520 shape: lead → cadence → touches → draft → ledger all on one `tx`, every impossible state throws to roll back).

---

### `src/core/leads/gate.ts` + `text-back.ts` + `missed-calls.ts` (90-day negative cool-off, D-12)

**Analog (pure rule):** `gate.ts` 97-134 — numbered, ordered, first refusal wins; new rule goes between 6 `recent_text` and 7 `daily_cap` (or after `daily_cap` — the header 13-30 says new rules go AFTER D-06's order so existing tests hold):
```ts
// 6
if (facts.textedSince24h) return refuse('recent_text');
```
→ add `recentNegativeClose: boolean` to `TextBackFacts` (51-84; "None optional: an absent fact cannot pass") and `if (facts.recentNegativeClose) return refuse('recent_negative_close');`. `TextBackGateReason` (48) derives from `TextBackSkipReason`, so the schema const must gain the member first.

**Analog (DB fact):** `for-tenant.ts` 4089-4105 `existsTextBackToCallerSince(caller, since, excludeId)` — tenant-scoped, bound Date passed by column comparison (never a raw Date in a sql template — `missed-calls.ts` repo 395-402). Sibling: `leads.closedNegativelySince(contactMobile, since)` → `SELECT id FROM leads WHERE tenant_id AND contact_mobile AND status='closed' AND closed_reason IN ('not_a_lead','spam','complaint','opt_out') AND closed_at >= since LIMIT 1`. Index: `(tenant_id, contact_mobile, closed_at DESC) WHERE status = 'closed'` in 0040, modelled on `missed_calls_text_back_caller_idx` (0039:199).

**Fact assembly:** `text-back.ts` 376-382 is where the facts are read on `tx`:
```ts
const since = new Date(now.getTime() - RATE_WINDOW_MS);
const suppressed = caller !== null && (await tx.suppression.existsFor([...])).length > 0;
const textedSince24h = caller !== null && (await tx.missedCalls.existsTextBackToCallerSince(caller, since, row.id));
```
Add the 90-day read beside it and pass it at 395-415. Note `noteRepeatCall` at 349 runs BEFORE the gate ("a repeat call joins the caller's open lead, whatever the gate says") — unchanged; a closed lead has no open row to join.

---

### Lead templates (D-02): `message-templates.ts` / sibling + `template.ts` defaults

**Analog A — the quote template table** (`src/db/schema/message-templates.ts` 84-147): identity `(tenant, touch_number, channel, version)` with `uniqueIndex('message_templates_tenant_touch_channel_version_uniq')` at 130-135 and write-once `approvedAt`/`approvalNote`. Adding `kind text DEFAULT 'quote' NOT NULL` requires the unique index to become `(tenant, kind, touch_number, channel, version)` and the sub-select version bump (`for-tenant.ts` 2680-2700) to filter on `kind`:
```ts
version: sql`(
  SELECT COALESCE(MAX(${messageTemplates.version}), 0) + 1
  FROM ${messageTemplates}
  WHERE ${messageTemplates.tenantId} = ${tenantId}
    AND ${messageTemplates.touchNumber} = ${row.touchNumber}
    AND ${messageTemplates.channel} = ${row.channel}
)`,
```
Every existing read (`latestApproved` 2624-2645, `approvedSet` 2740-2765, the correlated `exists` on `cadenceTouchTemplates.touchNumber`) must add `eq(messageTemplates.kind, 'quote')` or the drafting gate (`hasApprovedTemplateSet`) starts seeing lead rows as quote wordings. This is the "touches Phase 5 code" the ROADMAP warns about.

**Analog B — the sibling table** (`src/db/schema/text-back-templates.ts`): `variant` + `version` + CHECK `variant IN (…)`, body length and segment-range CHECKs, attestation-consistency CHECK (lines 28-45 of the table body). A `lead_templates` sibling keyed `(tenant, touch_number, version)` avoids touching the quote reads entirely at the cost of a new table (grant block, policy, barrel export, seed helper). CONTEXT prefers the existing table; 12-PATTERNS chose the sibling for text-back for exactly the "don't widen the quote path" reason. Planner decides; both tripwires are listed below.

**Defaults seeded "at arming/first use":** the only existing default-seeding path is timing rows, `templates.ensureDefaults(offsetDays)` (`for-tenant.ts` 2604-2622), called from `consume-events.ts` 779 with `DEFAULT_TOUCH_OFFSET_DAYS` passed in:
```ts
return db.insert(cadenceTouchTemplates)
  .values(offsetDays.map((days, i) => ({ tenantId, touchNumber: i + 1, offsetDays: days, channel: 'sms' })))
  .onConflictDoNothing({ target: [cadenceTouchTemplates.tenantId, cadenceTouchTemplates.touchNumber] })
  .returning();
```
Quote BODIES are never seeded — operators write them. For lead bodies the default text pattern is `defaultTextBackBody(variant, businessName)` (`src/core/leads/template.ts` 77-101): name typed into the bytes, every char GSM-7 basic, `Reply STOP` + privacy pointer tail. A `defaultLeadTemplateBody(touchNumber, businessName)` sibling plus a `leadTemplates.ensureDefaults(tenantName)` targeted on the unique index is the composite. D-02 says the template is a SHAPE the drafting prompt rewrites (message-templates header 106-113), so the lead default is a template body, not attested bytes — the `validateTextBackTemplate` rule set (103-161) applies at save minus `merge_token_left` semantics, and the send-time guarantee comes from `validateDraft` (below), not from the template.

**Seeding moment:** D-02 says arming/first use. `ARMING_GATES.text_back` (`arming.ts` 98-105) lists `textBackTemplates`; the arm action is `armChannelAction` (`clients/[id]/actions.ts` ~649-741 per 12-PATTERNS). Seeding inside `draftTouches` on first lead touch (the `consume-events.ts` 779 pattern: seed-then-read in one transaction) is the lower-coupling option.

---

### `src/core/drafting/prompt.ts` + `draft-touches.ts` (lead facts block, D-13)

**Analog:** `prompt.ts` 316-434 `buildDraftPrompt`.

**Stable half** (322-360): INSTRUCTIONS → voice → examples → templates sorted by touch number; "Nothing below this point may read `quoteFacts`, `priorBodies` or `touchNumber`" (318-321). The lead facts block goes in the VOLATILE half only.

**Volatile half, the facts block** (366-385):
```ts
const factLines = [
  line('Customer first name', sanitizeUntrusted(q.contactFirstName, MAX_NAME)),
  line('Job', sanitizeUntrusted(q.jobDescription, MAX_JOB_DESCRIPTION)),
  line('Quote total', q.totalDisplay),
  …
].filter((l): l is string => l !== null);
userParts.push(section('# Facts you may state (copy character for character)', [DATA_OPEN, …, DATA_CLOSE].join('\n')));
```
Lead facts (D-13): the caller's verbatim reply (UNTRUSTED → `sanitizeUntrusted`, fenced), after-hours flag, touch number, what touch 1 said (from `repo.drafts.sentBodiesForCadence`, already read at `draft-touches.ts` 836 as `priorBodies` — touch 1's text-back body IS a `touch_drafts` row, `text-back.ts` 466-480). `allowedDisplayStrings` for a lead is `[]` ("(none - do not write any number or date)", 395-398) — the validator then refuses any digit run, which is D-13's "no links / no price".

**`PROMPT_VERSION`** (95): `'p4'`; bump to `'p5'`. `tests/drafting-prompt.test.ts` 78-86 pins `expect(PROMPT_VERSION).toBe('p4')` with the test name "is p4 — p3 plus the spelled-out-numeral rule" — rewrite deliberately.

**The caller** (`draft-touches.ts` 806-845): `const [quote] = cadence.quoteId ? await repo.quotes.byId(cadence.quoteId) : [];` already tolerates a null quote; `buildMergeFacts` with null amounts yields nulls. The lead branch needs `repo.leads.byId(cadence.leadId)` for `afterHours` and the latest inbound body for the verbatim reply, and templates from the lead read instead of `templates.latestApproved(touchNumber, 'sms')`. `insertAttempt` at 862-876 writes `quoteId: cadence.quoteId` (null-safe since 0039) and `templateId/templateVersion` — a sibling table would need those columns to be re-pointed or nullable (tripwire).

**Validator** (`src/core/drafting/validate.ts` 213-347): unchanged; the compliance suffix is `expectedSuffix` and `endsWith` (338-345). The lead suffix must still carry the identity + STOP (D-13 "identity line + STOP mandatory as on touch 1") — `complianceSuffix` in `src/core/cadence/sender.ts` (109-112 per 12-PATTERNS) is the one source.

---

### Kind branches in the tick (D-01, D-04, D-15, D-17)

**Analog:** the exact `kind = 'quote'` predicates Phase 12 added. Each is a place Phase 13 flips to "both kinds, per-kind policy":

| Site | Lines | Today | Phase 13 |
|---|---|---|---|
| `touches.promoteDue` | `for-tenant.ts` 3019-3040 | subquery `AND ${cadences.kind} = 'quote'` (3035) | drop the predicate (promotion is kind-agnostic once drafting handles leads) |
| `touches.listNeedsDraft` | 3041-3070 | same subquery (3055) | drop; `draftTouches` branches on `cadence.quoteId === null` |
| `touches.claimDue` | 3470-3525 | `eq(cadences.kind, 'quote')` (3517); select narrows `quoteId: sql<string>`, `sm8JobUuid: sql<string>` (3477-3484) | drop the predicate AND widen `ClaimedTouch` to `string \| null` plus `kind`/`leadId` — the comment at 3477-3481 says the narrowing is only honest because of the predicate |
| `cadences.listLive(kind = 'quote')` | 3056-3068 | default `'quote'` | callers pass kind explicitly: `expireOverdueCadences` 697, `runProgressPass` 834 |
| `expireOverdueCadences` | `run-tick.ts` 691-720 | `listLive('quote')`, `CADENCE_EXPIRY_DAYS` | loop both kinds with `cadencePolicyFor(kind).expiryDays` (D-15) |
| `runProgressPass` (b) | 824-848 | `listLive('quote')`, comment 831-833 "inert until Phase 13" | both kinds; `rewindowCadence` takes the policy |
| `dispatchOne` | `dispatch.ts` 400-430 | looks up the quote by `touch.sm8JobUuid`; missing → `mirror_missing` STOP (irreversible, 404-427) | `if (touch.kind === 'lead')` skip the mirror lookup; refuse `lead_closed` (new `DispatchRefusal`?) if the lead is not `open`. `tests/cadence-tick-route.test.ts` 490 pins `Object.keys(body.refusals)` to `DISPATCH_REFUSALS` — a new refusal must be added to that const |

**The re-window into contact hours (D-04):** `leadSchedule` (`text-back.ts` 632-675) already places touches 2-3 with `materializeCadenceSchedule` using the tenant window and `jitterMinutes: () => 0`, falling back to plain day offsets if the window is unusable (comment 625-630). `slotAtOffsetDays` (`materialize.ts` 160) puts offset N at the preferred time on the anchor's date + N days, which for a 02:00 text-back puts touch 2 at 09:30 the next morning — D-04's "first slot next morning". The tick's `rewindowTouch` (`rewindow.ts` 150-234) then repairs drift with `nextAllowedSlot`. So D-04 may already hold at creation; the phase must PROVE it (a 02:00 anchor test) rather than re-implement it, and the `rewindowTouch` `min_gap` check (222-231) must use the lead's gap or touch 3 (24 h after touch 2) is skipped as `min_gap` under 48 — this is the exact failure D-03's side-by-side test pins.

**Enumerated result keys:** `run-tick.ts` 1395-1451 writes every count field by name with "NO SPREAD" comments; `cadence-tick/route.ts` 223-316 mirrors each key; `tests/cadence-tick-route.test.ts` 385 pins `Object.keys(body).sort()`. New passes (held-release, ring-twice, lead-close) add keys in all three places.

---

### Escalation (D-07, D-08, D-09): `escalate-hot-leads.ts`, `ring-twice.ts`, `escalations.ts`

**Analog — the per-row loop** (`escalate-hot-leads.ts` 192-336): (a) tenant escalation phone via `normalizeAuMobile` (218-225), (b) `resolveSmsFrom` BEFORE claim and HTTP (231-236), (c) cooldown read before claim (241-250), lead id read through the tenant scope when `row.quoteId === null` (256-262), (d) `claimEscalation({ inboundMessageId, …, leadId, toAddress: to ?? '', at: now })` (265-274), `if (claimed === null) continue;` (278), then outcome writes `no_escalation_number` / `sms_not_configured` / `cooldown_suppressed` (280-296), `buildEscalationSms` with `LEAD_REPLY_SNIPPET` when no quote (298-304), send with `customString: claimed.id` (306-314), `recordEscalationOutcome` sent/failed (316-334), per-row `catch {}` that discards the value (336-).

**Where D-09 goes:** between (c) and (d) — a new gate "is this lead row allowed to send NOW": `isHot && kind === 'lead'` → if emergency-urgency or keyword-hot: send regardless; else if inside the tenant's contact window (`contactWindowOf(tenant)` + `isInsideWindow` from `src/core/cadence/window.ts`, as `run-tick.ts` 749 does) or `tenant.afterHoursEscalation`: send; else record outcome `held` with `hold_until = nextAllowedSlot(now, win, …)` and `continue`. `ESCALATION_OUTCOMES` (`escalations.ts` schema 109-116) is a closed vocabulary — add `held`. The header's exemption list (30-40: "contact hours — a hot lead at 7pm reaches them at 7pm") must be rewritten to say "for QUOTE replies; lead replies obey D-09".

**Release pass:** a scan for `outcome = 'held' AND hold_until <= now` mirroring the `hotUnescalated` anti-join (`for-all-tenants.ts` 1324-1352), then the same send + `recordEscalationOutcome`. The cooldown read `recentEscalationForCadence` (`escalations.ts` repo 304-316) "counts EVERY prior escalation in the window, including refused ones" — a held row would suppress its own release; exclude `held` there or key the release off the held row itself (it already holds the claim).

**Ring-twice (D-07):** reuse `claimEscalationForMissedCall` verbatim (`escalations.ts` repo 161-182):
```ts
.onConflictDoNothing({ target: escalations.missedCallId, where: isNotNull(escalations.missedCallId) })
```
and the `escalateQuoteCalls` loop (`quote-call.ts` 133-215): list → `forTenant(row.tenantId).tenant.get()` → `resolveSmsFrom` → cooldown → `claimEscalationForMissedCall({missedCallId, tenantId, cadenceId, quoteId: null, toAddress, at})` → outcome. The list read is the new part: sibling of `listUnescalatedQuoteCalls` (`escalations.ts` repo 238-285) — missed calls of route `lead` whose `lead_id` has an earlier call within `LEAD_RING_TWICE_MINUTES` (the `leads.last_missed_at`/`missed_call_count` advanced by `noteRepeatCall`, `for-tenant.ts` 4144-4160, is the cheap signal: `missed_call_count >= 2 AND last_missed_at - first_missed_at <= 30 min` or the second call's own row) and no escalation row. `cadenceId` is NOT NULL on `escalations` (schema 141) — the lead cadence id is on `missed_calls.cadence_id` (0039:184) for the second call via `setTextBackDecision`'s `lead_open` skip path only if that path records it (check `text-back.ts` 342-344: `skip('lead_open')` writes status/skipReason only — tripwire: the second call's row may carry no `cadence_id`; read it from the lead instead).

**Message:** `buildQuoteCallEscalationSms` (`message.ts` 404-433) with `NO_QUOTE_CALL_NAME = 'A quote customer'` and `textSentence(textSent)` is the mould for `buildRingTwiceEscalationSms` ("rang twice in N minutes"); keep the shared-counter budget (72-104) and `tests/escalation-message.test.ts` 85+ "byte for byte" fixtures.

---

### `inbound.ts` (threading, quote-wins, D-10)

**Analog:** `handleSingleMatch` 276-315 — `threaded.leadId = candidate.leadId` (287), `pauseForReply` before the row write (299), `console.log` ids only (302-305). `handleManyMatches` 417-490: ambiguous → recorded, NO pause (438-447). D-10's "if a number is on both a quote and a lead cadence at the same client, quote wins and the lead is closed with a logged reason" is a new arm inside the many-matches branch: when every candidate shares one `tenantId` and exactly one has `quoteId !== null`, thread to it and `closeLead(leadId, 'quote_cadence_wins')`. `CadenceByContactMobile` (617-640) already returns `quoteId`, `leadId`, `tenantId` per candidate.

---

### `clients/[id]/after-hours-escalation-form.tsx` + `actions.ts` + `action-state.ts` (D-09 toggle)

**Analog:** `escalation-phone-form.tsx` (whole file, 92 lines): `'use client'`, `useActionState(updateEscalationPhoneAction.bind(null, tenantId), BLANK_…_STATE)`, `<details className="disclosure">` collapsed, `role="alert"` / `role="status"` paragraphs, plain props, imports only the sibling leaf + the action (header 31-36 explains why; `tests/lint-ban.test.ts` 698 pins `clients/[id]/action-state.ts` as a leaf).

**Server action** (`actions.ts` 439-503): `authorize(tenantId)` before any `formData` read (444-447), bounded raw read (449-458), `safeParse` (465-471), `forTenant(tenantId).tenant.update({ escalationPhone: phone })` as a ONE-COLUMN patch (484; `tenant.update` refuses unknown/immutable keys, `for-tenant.ts` 2396-2420 — `after_hours_escalation` becomes a mutable key automatically via `getTableColumns`, 174-175), `catch {}` discarding the driver error (485-494), `revalidatePath`, fixed success sentence from the leaf (`escalationPhoneSavedMessage`, `action-state.ts` 93-99). A boolean toggle reads `formData.get('after_hours_escalation') === 'on'`.

**Page** (`page.tsx` 486, 907-916): add `after_hours_escalation` to the select string and a `<dd>` + form mount beside the escalation phone. `tests/console-error-leak.test.ts` scans every console file for `{error.message}` — the new form must render only the fixed sentences.

---

### `stalled-digest.ts` (cold leads and held escalations in the 06:30 digest, D-08/D-09)

**Analog:** `buildStaleAttestationSection` 68-86 — a pure section builder over a closed-vocabulary read, returning `null` (not an empty section) when there is nothing, riding the `sections` seam (`StalledDigestOptions.sections`, 88-106):
```ts
if (lines.length === 0) return null;
return { heading: 'ServiceM8 automation checks due:', lines };
```
"client name, an integer, and fixed words" — no customer name or body may reach it (header 56-63).

---

### `src/db/repository/index.ts` (barrel)

**Analog:** itself 395-430 — a prose block naming each export and its one job ("`claimEscalationForMissedCall` — the D-16 never-twice claim … keyed on the missed call"), then the `export { … }` list. Add the Phase 13 names with the same one-line "what it is and who may import it" discipline.

---

## Shared Patterns

### Closed vocabularies: `as const` array → type → CHECK (→ zod when a model writes it)
**Source:** `inbound-messages.ts` 140-156 + 289-300; `schema.ts` 53-54; `leads.ts` 45-58 + 98-100
**Apply to:** `LEAD_LABELS`, `LEAD_URGENCIES`, `LEAD_CLOSED_REASONS`, the new `TEXT_BACK_SKIP_REASONS` member, any new `ESCALATION_OUTCOMES` / `CADENCE_STOP_REASONS` / `DISPATCH_REFUSALS` member. Underscore spelling. The zod enum is DERIVED (`z.enum(LEAD_LABELS)`), never retyped.

### Claim → mark → COMMIT → send → record; NULL outcome is never retried
**Source:** `escalate-hot-leads.ts` 265-336; `escalations.ts` repo 106-182
**Apply to:** ring-twice, held release, any new escalation trigger. The unique index decides; `claimed === null` → `continue` silently.

### Zero rows from `ON CONFLICT DO NOTHING RETURNING` / a guarded UPDATE is an answer
**Source:** `for-tenant.ts` 1040-1050 (`cadences.create` doc), 4125-4142 (`leads.openOrCreate`), `inbound-messages.ts` repo 438-460 (`writeClassification`)
**Apply to:** `closeLead` (guard `status = 'open'`), lead template `ensureDefaults`, held-escalation release.

### Policy is passed in; the repository is ignorant of magnitudes
**Source:** `cadence/constants.ts` header 21-24; `consume-events.ts` 779 `tx.templates.ensureDefaults(DEFAULT_TOUCH_OFFSET_DAYS)`
**Apply to:** `cadencePolicyFor(kind)` — read in `run-tick.ts` / `rewindow.ts` callers, never inside `for-tenant.ts`.

### Pure rule modules: no repository, no clock, no `next/*`, non-strings → false, logs nothing
**Source:** `gate.ts` 38-41; `stop-keywords.ts` 32-36, 68-80
**Apply to:** `keywords.ts`, `policy.ts`, the lead template validator, `isHotLeadReply`.

### Per-row / per-tenant isolation with a value-discarding catch
**Source:** `escalate-hot-leads.ts` 185-191, 336-; `run-tick.ts` 1056-1092 (every pass wrapped, fixed-string `console.error`)
**Apply to:** every new tick pass and loop.

### Counts-only results, enumerated field by field, NO SPREAD
**Source:** `run-tick.ts` 1395-1451; `cadence-tick/route.ts` 223-316
**Apply to:** new pass counts; update `tests/cadence-tick-route.test.ts` 385 key pin.

### Server action guard order: authorize → bounded read → schema → one-column patch → catch-discard → revalidate → fixed sentence
**Source:** `clients/[id]/actions.ts` 439-503
**Apply to:** `updateAfterHoursEscalationAction`.

### Client-reachable modules import no server value
**Source:** `escalation-phone-form.tsx` 31-36; `tests/lint-ban.test.ts` 668-745
**Apply to:** the new form; any constant it shows comes from `action-state.ts`.

### Evidence family: no FK, no cascade, no delete; config family cascades
**Source:** `leads.ts` 25-27, 66; `message-templates.ts` 52-60
**Apply to:** `leads` columns (evidence), lead templates (config → cascade from tenants).

### Hosted database is production
**Source:** `tests/helpers/env.ts` 52-64 (`LOCAL_HOST_PATTERN`), `global-setup.ts` 1-40, `lead-cadence-inert.test.ts` 37-45
**Apply to:** every DB-backed suite header: "DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS … MUST NEVER run through `npm run test:remote`".

---

## Test-env and convention pins

**Pure vs DB-backed markers.** A pure suite says so in its header and imports no `tests/helpers/seed` (`classify-inbound.test.ts` 1-3 "PURE — no database, no credentials, no model"; `text-back-tick-passes.test.ts` 11-13 "PURE: it imports neither `tests/helpers/seed` nor a database client, and every repository name the passes import is a `vi.fn` here"; `cadence-rewindow.test.ts` 25-27 "runs on a bare checkout"). A DB-backed suite imports `admin`, `seed*`, `teardownTenants` from `tests/helpers/seed` (`lead-cadence-inert.test.ts` 56-67), uses `beforeAll`/`afterAll` with teardown by id, states "every number is from ACMA's fiction block (0491 570 1xx)", and keys every assertion on its own ids because the passes are global (`lead-reply.test.ts` 31-33).

**Env gate.** `tests/helpers/env.ts` loads `.env.test` then `.env.local` (never name them in commands) and lists the REQUIRED server-env members (lines 21-60: Supabase, `DATABASE_URL`, `MIGRATE_DATABASE_URL`, operator creds, Resend, encryption key, tick secrets, webhook bearers). `LOCAL_HOST_PATTERN` (64) + `ALLOW_REMOTE_TESTS` is the one gate; `global-setup.ts` pauses the production pg_cron ticks on a sanctioned remote run. `vitest.config.mts`: `fileParallelism: false`, 30 s timeouts, `setupFiles: tests/helpers/env.ts`, `globalSetup: tests/helpers/global-setup.ts`.

**Twilio dummy env.** Server-env suites that touch telephony stub the four Twilio values (`tests/twilio-voice-status-route.test.ts` 55-57: `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_WEBHOOK_SECRET`, `TWILIO_VOICE_STATUS_WEBHOOK_SECRET` as fixed 32+/40-char strings); CI writes the same dummies into the env file (`.github/workflows/ci.yml` 187-190). Phase 13 suites that reach `getServerEnv()` inherit this and need nothing new.

**CI-only DB suites.** `ci.yml` 83-230: `supabase start`, `supabase status -o env`, `db:migrate` over the session URL (221), then `npx vitest run` (226) against the local stack, `supabase stop --no-backup`. Locally `npm test` runs the pure suites only when no `.env.*` points at a local stack. Never `npm run test:remote`.

**Commit / lint conventions.** `npm run lint` is `eslint . --max-warnings=0`; `tests/lint-ban.test.ts` runs the real `eslint.config.mjs` over virtual files and pins (i) `no-restricted-imports` for `@/db/repository/client`, deep `for-tenant` / cross-tenant imports anywhere outside `src/db/repository` (cases at 49-88, 619-648), (ii) the client-safe leaves by path (681-745). `tests/console-error-leak.test.ts` scans every `src/app/(console)` file for `{error.message}` after stripping comments and names pages explicitly (60+). `tests/layout-contract.test.ts` pins CSS/tsx layout rules for the report and audit pages (read-only for this phase). `tests/text-back-structure.test.ts` and `tests/classification-privilege.test.ts` are the source-reading moulds for "what the module COULD do": no model under `src/core/leads` (text-back header rule 1 — the keyword rule and `closeLead` must not import the SDK), no `tools` key in the classifier, pinned set lists. `tests/runbook-contract.test.ts` ties docs to console labels; if a runbook names the new toggle, pin it.

---

## Tripwires That WILL Go Red

### Schema / migration
- `tests/classification-privilege.test.ts`: `writeClassification` set list (4 columns) and `UnclassifiedRow` select list are pinned; `urgency` and the kind flag change both. Also pins `z.enum(INBOUND_LABELS)` (287) and `INBOUND_LABELS.map(` (299) — adding the lead equivalents must keep those strings present.
- `tests/rls-coverage.test.ts` (per env.ts 28-29) reads `pg_tables` — a sibling `lead_templates` table needs RLS + policy + grants or it reds.
- drizzle emits a bare `DROP CONSTRAINT` for widened CHECKs; `0039:161-163` shows the hand-finished form. Journal `when` must exceed 1791222883774.
- `message_templates_tenant_touch_channel_version_uniq` (`message-templates.ts` 130-135): adding `kind` without widening it makes lead and quote touch-1 versions collide.

### Repository surface
- `ClaimedTouch` narrowing (`for-tenant.ts` 3477-3484) is only honest with the `kind = 'quote'` predicate; dropping one without the other compiles and then dispatches a lead touch into `mirror_missing` (the irreversible stop `lead-cadence-inert.test.ts` 28-35 guards).
- `cadences.listLive` default `'quote'` (3056): any caller still relying on the default silently excludes leads.
- `recentEscalationForCadence` counts refused outcomes (304-316 comment) — a `held` row suppresses its own release unless excluded.

### Tick / dispatch / route
- `tests/cadence-tick-route.test.ts` 385 (`Object.keys(body)`) and 490 (`DISPATCH_REFUSALS`) go red on any new count or refusal — intended.
- `tests/lead-cadence-inert.test.ts` MUST be replaced, not deleted (D-17): its D-19 control at 338-345 (quote dispatched in the same tick) is the assertion to carry into the active suite.
- `rewindowTouch` `min_gap` at 48 h (`rewindow.ts` 229) skips lead touch 3 unless the policy is per-kind — the D-03 side-by-side test exists to catch exactly this.
- `DRAFT_LEAD_HOURS = 24` (`cadence/constants.ts` 110) means a lead touch 2 at +1 day is promoted/drafted IMMEDIATELY after touch 1 — correct, but the approval queue will show it within the minute; say so in the plan.

### Classification / escalation
- `escalate-hot-leads.ts` header 30-40 states contact hours are EXEMPT — D-09 contradicts it for leads; rewrite the header or the reviewer flags the drift.
- `tests/escalation-message.test.ts` 85+ "byte for byte": new builders need their own fixtures; `ESCALATION_COOLDOWN_MINUTES = 30` (`message.ts` 72) is pinned at 80.
- `tests/drafting-prompt.test.ts` 78-86 pins `'p4'`.
- `isHotLead` is private (`classify-inbound.ts` 284) — the lead rule goes beside it, not in an accessor (`for-all-tenants.ts` 1292-1296 forbids re-deriving).

### Gate / text-back
- `tests/text-back-gate.test.ts` 1-14 pins the rule ORDER by name; inserting `recent_negative_close` changes the list — intended, update the header and the adjacency cases.
- `TextBackGateReason` (`gate.ts` 48) excludes `lead_open`/`quote_open`; `recent_negative_close` is a GATE reason and must be in `TEXT_BACK_SKIP_REASONS` + the 0040 CHECK first or the DB rejects the write.

---

## Structural Mismatches the Planner Must Resolve

1. **Where kind lives on `inbound_messages`.** There is no `kind` column; `lead_id IS NOT NULL` is the proxy. The CHECK, `listUnclassified` and `hotUnescalated` must all use the same proxy, or add a denormalised `cadence_kind` column in 0040 (the `leadId` denormalisation at `inbound.ts` 286-287 is the precedent for copying cadence facts onto the row).
2. **Lead templates: widen `message_templates` (CONTEXT preference) vs sibling table (12-PATTERNS precedent).** Widening touches `latestApproved`, `approvedSet`, `insertVersion`, the unique index and the Phase 5 drafting gate; a sibling touches `touch_drafts.template_id/template_version` semantics and needs grants/RLS/barrel/seed. Both are listed above with line numbers.
3. **Label effects (D-11) vs the Phase 5 privilege boundary.** `classification-privilege` pins that the classifier cannot reach a state transition. A separate "lead resolution" pass (scan classified lead rows → `closeLead`) keeps that boundary; folding closes into the classifier breaks it. Prefer the pass.
4. **`DispatchRefusal` for a closed lead.** `dispatchOne` has no "owner is closed" refusal for leads; `quote_closed` is the quote analog (429). Either `closeLead` skipping unsent touches makes this unreachable (then no new refusal), or add `lead_closed` to `DISPATCH_REFUSALS` and the route pin.
5. **Ring-twice cadence id.** `escalations.cadence_id` is NOT NULL; the second call's `missed_calls` row records only `skipped/lead_open`. Read the live lead cadence via `cadences_one_live_per_lead` (`leads.id` → `cadences.lead_id`) when claiming.
6. **Held-escalation column.** `hold_until` on `escalations` vs a `held` outcome + release scan; the never-twice index is on `inbound_message_id`, so a held row IS the claim — release must UPDATE it, not insert a second.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/core/classification/classify-inbound.ts` — a vocabulary chosen per row at call time | service | batch | The classifier has one system prompt and one schema today; selecting `(instructions, zod format, hot rule)` by row kind has no precedent. Use `ARMING_GATES`'s keyed-`as const` shape for the triple and keep one `ask()` with the triple passed in. |

---

## Metadata

**Analog search scope:** `src/core/{cadence,leads,classification,drafting,escalation,messaging,aging,onboarding}`, `src/db/{schema,repository,migrations}`, `src/app/(console)/clients/[id]`, `src/app/(console)/clients/new`, `src/app/api/internal/cadence-tick`, `tests/`, `.github/workflows/ci.yml`, `vitest.config.mts`, `eslint.config.mjs`
**Files scanned:** 52 read (targeted ranges on the four files over 2,000 lines: `for-tenant.ts`, `for-all-tenants.ts`, `run-tick.ts`, `draft-touches.ts`)
**Pattern extraction date:** 2026-10-08 at `06944ee`
