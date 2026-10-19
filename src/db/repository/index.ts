/**
 * Public surface of the repository layer.
 *
 * `forTenant()` and connection teardown — nothing else. The raw drizzle client
 * in `./client` is deliberately NOT re-exported: re-exporting it here would let
 * any caller reach an unscoped query surface through the front door and quietly
 * defeat the ESLint ban (ONB-05).
 */
export {
  forTenant,
  // 06-03: the queue's no-draft-yet card needs the CEILING, not just the count.
  // At the cap `listNeedsDraft` stops offering the touch — drafting has given
  // up — and "it will keep trying" becomes a lie the operator would act on.
  MAX_DRAFT_FAILURES,
  // 07-01: the three Phase 7 write shapes. Exported for the same reason
  // `TouchDraftInsert` is — the attribution consumer and the report/fee server
  // actions each declare a narrow repository surface and need these to say what
  // they take. All three are `Omit`s that make the database-owned columns
  // (`version`, `attributedAt`, `generatedAt`, `createdAt`) UNPASSABLE.
  type AttributionClaim,
  type FeeInsert,
  type MonthlyReportSummary,
  type ReportInsert,
  // 07-01: the report list page's cap. Exported beside the summary type for the
  // MAX_DRAFT_FAILURES reason — a page that renders a capped list has to be able
  // to say so rather than silently drawing a truncated history.
  REPORT_LIST_LIMIT,
  type CadenceCreate,
  type CadenceTouchInsert,
  type ClaimedTouch,
  type ConnectionPatch,
  type ConnectionUpsert,
  type QuoteContactUpsert,
  type QuoteStatusEventInsert,
  type QuoteUpsert,
  type SendLedgerClaim,
  type StoredQuoteState,
  type SuppressionInsert,
  type SuppressionProbe,
  type SyncRunInsert,
  type TenantPatch,
  type TenantScopedRepository,
  // 05-04: the drafting pass declares its own narrow repository surface and
  // needs this row type to say what `insertAttempt` takes.
  type TouchDraftInsert,
} from './for-tenant';
/**
 * The cross-tenant exceptions, re-exported under their own line so this barrel
 * shows at a glance that they exist and how few of them there are.
 */
export {
  // 06-01, CON-01: what must the operator approve next, across everyone. The
  // WIDEST crossing in that file — a pinned select list with no address column,
  // no join to `tenants`, and a closed two-status predicate. See its header.
  APPROVAL_QUEUE_CAP,
  APPROVAL_QUEUE_STATUSES,
  forAllTenants_approvalQueue,
  // 10-03, ARM-02/D-03: which clients does arming the SHARED sms row actually
  // arm — connected, and with no sms row of their own. Ids and names only; both
  // readers are behind the operator gate, and the sentence they build is the
  // blast radius stated before the tap and repeated after it.
  forAllTenants_armedBySmsGlobal,
  type SmsGlobalArmedClient,
  forAllTenants_cadenceTick,
  forAllTenants_cadencesByContactMobile,
  // 06-02, CON-04: the aging pair. The first is a guarded UPDATE whose WHERE
  // clause is the once-only alert guarantee; the second is its read-only
  // sibling for the nightly digest. Both return ids, names and integers only.
  forAllTenants_claimNewlyStalled,
  forAllTenants_stalledTally,
  // 06-05, CON-03: which customer just said yes, and has their tradie been
  // told. The widest crossing after the queue — it carries a customer's words
  // AND their mobile, because the message it feeds ends with `Call them:`. No
  // join to `tenants`; the pass reads the escalation number through
  // `forTenant(row.tenantId)`. See its header.
  forAllTenants_hotUnescalated,
  HOT_ESCALATION_CAP,
  type HotUnescalatedReply,
  // 06-04, ONB-04/D-15: whose ServiceM8-automation attestation is getting old.
  // READ-ONLY and it writes nothing — unlike its aging sibling above, which
  // claims. Nothing on the staleness path may pause a client; it produces a
  // badge and one digest line. Returns an id, a name and an instant.
  forAllTenants_latestAttestations,
  type LatestTenantAttestation,
  // 07-05, RPT-03: counts, sums and fee rows per client for the reports
  // overview and the digest. READ-ONLY; addresses compared in-statement, never
  // selected. It joins `tenants` for a name where the queue accessor refuses
  // to, on the 06-02 split: both its consumers — the requireOperator-gated
  // `/reports` page and the 06:30 cron digest — hold the service-role key by
  // construction, and the digest has no JWT to resolve a name with.
  forAllTenants_reportMetrics,
  // 04-02, D-03: ids only, for the unthreadable-opt-out fan-out.
  forAllTenants_ids,
  // 04-04, T-4-18: whose send is this? — keyed by ids ClickSend echoed back.
  forAllTenants_ledgerOwners,
  forAllTenants_pendingQuoteEvents,
  forAllTenants_syncTick,
  forAllTenants_webhookHint,
  type ApprovalQueuePage,
  type ApprovalQueueRow,
  type CadenceByContactMobile,
  type CadenceTickTenant,
  type ClaimedStalledTouch,
  type DueConnection,
  type LedgerOwner,
  type StallClaim,
  type StalledTenantTally,
  type WebhookHintConnection,
} from './for-all-tenants';
/**
 * The prospect surface (D-01/D-03) — audit data, and no route from it to a
 * cadence. Exported on its own line so the separation is visible in the barrel:
 * nothing here takes a `tenantId`, and nothing above takes a `prospectId`.
 */
export {
  countProspectLines,
  createProspect,
  getProspect,
  getProspectStaging,
  listProspects,
  storeAuditResults,
  type AuditResults,
  type ProspectCreate,
  type ProspectLineInput,
} from './prospects';
/**
 * The audit-request surface (Phase 9, LAND-03) — a PUBLIC intake, operator-scoped,
 * and nothing here takes a `tenantId`. Exported on its own line for the same
 * reason the prospect block above is: this is the only family an
 * unauthenticated caller can cause a write to, so a reviewer reading one file
 * can see exactly how far that reach goes. Two tables, no client data, no route
 * from a request to a cadence.
 */
export {
  attachAuditRequestCsv,
  bumpAuditRequestThrottle,
  clearAuditRequestCsv,
  createAuditRequest,
  getAuditRequest,
  listAuditRequests,
  listExpiredAuditUploads,
  markAuditRequestConverted,
  recordAuditRequestNotify,
  sweepAuditRequestThrottle,
  updateAuditRequestStatus,
  type AuditRequestCreate,
} from './audit-requests';
/**
 * The private `audit-uploads` bucket (Phase 9, LAND-02, D-11) — its own line
 * because it is its own kind of thing: the only module in the application that
 * holds a service-role `supabase-js` client, and therefore the only one that
 * can reach Supabase Storage at all. Storage has no SQL write path, so this
 * cannot live behind the drizzle connection the rest of this barrel exports.
 * Deep-importing it is banned in `eslint.config.mjs`; this line is the door.
 */
export {
  deleteAuditUpload,
  getAuditUpload,
  purgeExpiredAuditUploads,
  putAuditUpload,
  type AuditUploadPurgeResult,
  type PutAuditUploadResult,
} from './audit-uploads';
/**
 * The outbox consumer's own bookkeeping (03-02). NOT a cross-tenant escape:
 * `event_consumer_cursors` carries no `tenant_id` at all and is gated by
 * `is_operator()`, so it is the same shape of exception the prospect family is.
 * Registration and the pre-scan read live here because they happen BEFORE any
 * tenant is known; the advance lives on `forTenant(id).consumerCursor` because
 * the outbox contract requires it to commit with the actions it covers.
 *
 * `readConsumerBacklog` joins them for the SAME reason and answers the same
 * kind of question with no tenant in it: how far past this consumer's position
 * the outbox has run, as a count and a timestamp. It is the durable evidence
 * that a consumer is wedged, which is what the 06:30 digest reads (07 CR-03).
 */
export {
  type ConsumerBacklog,
  readConsumerBacklog,
  readConsumerCursor,
  registerConsumerCursor,
} from './consumer-cursor';
/**
 * The inbound-message surface (Phase 4, MSG-03). A FOURTH family of the same
 * shape as the prospect and cursor ones: nothing here takes a `tenantId` as a
 * scope, and nothing here touches a tenant-scoped table. It exists outside
 * `forTenant()` because an inbound message arrives before we know whose it is,
 * and a reply we cannot place is recorded with `tenant_id = NULL` rather than
 * dropped — see src/db/schema/inbound-messages.ts.
 *
 *   insertInboundMessage           — the ONLY insert path
 *   findInboundByProviderMessageId — the 04-04 reconciliation dedupe read
 *   listInboundNeedingTriage       — the 04-06 console read: rows still waiting
 *     on a human. Capped, explicit select list, and `raw_payload` deliberately
 *     absent from it.
 *   markInboundTriaged             — the ONLY writer of `triaged_at`, guarded on
 *     `triaged_at IS NULL` so a second tap cannot reset when a row was first
 *     handled.
 *
 * The two 04-06 additions do NOT widen this family's promise: both still read
 * and write one table and join nothing. `candidate_tenant_ids` is returned as
 * ids, and the console resolves the names through the operator's own JWT.
 *
 * ── THE 05-06 CLASSIFICATION TRIO, LISTED APART ON PURPOSE (D-13, AI-03) ────
 *
 *   listUnclassified      — the label queue: unlabelled, not dead-letter, under
 *                           the attempt cap, oldest first
 *   writeClassification   — the ONLY writer of label / label_confidence /
 *                           is_hot / classified_at, guarded on `label IS NULL`
 *   bumpClassifyAttempts  — the ONLY writer of classify_attempts
 *
 * These three are THE ENTIRE WRITE SURFACE REACHABLE FROM MODEL OUTPUT. They
 * are named here, in the barrel, for the same reason the `forAllTenants_*`
 * prefix exists above: so a reviewer can find every crossing by reading one
 * list rather than by trusting a promise. Nothing else in this file may be
 * imported by `src/core/classification/*`, and
 * `tests/classification-privilege.test.ts` asserts exactly that.
 */
export {
  bumpClassifyAttempts,
  CLASSIFY_BATCH_SIZE,
  findInboundByProviderMessageId,
  insertInboundMessage,
  listInboundNeedingTriage,
  listUnclassified,
  markInboundTriaged,
  MAX_CLASSIFY_ATTEMPTS,
  TRIAGE_ATTRIBUTIONS,
  TRIAGE_PAGE_SIZE,
  writeClassification,
  type ClassificationWrite,
  type InboundMessageInsert,
  type InboundTriageRow,
  type UnclassifiedRow,
} from './inbound-messages';
/**
 * The delivery-receipt write (Phase 4, MSG-01, plan 04-04). A SIXTH family of
 * the same shape, and the narrowest of them: ONE function, UPDATE-only, whose
 * predicate is an exact match on a key the caller must already hold (a
 * `send_ledger.id` we generated, or the provider's own message id).
 *
 * It is outside `forTenant()` because a delivery receipt arrives before we know
 * whose it is — ClickSend's callback carries a message id and our ledger id and
 * no tenant — so there is nothing to construct a scope from. That is not an
 * escape: nothing here can enumerate, list or read a row, and `outcome` is not
 * in the SET list, so the entire reachable surface of a forged receipt is four
 * delivery columns on one row somebody already knew the key to.
 *
 *   updateDeliveryWhereMatch — the ONLY writer of the delivery columns
 */
export {
  updateDeliveryWhereMatch,
  type DeliveryReceiptUpdate,
} from './delivery-receipts';
/**
 * The escalation evidence surface (Phase 6, CON-03, plan 06-05). A SEVENTH
 * family of the same shape: one table, no joins, and no method that takes a
 * `tenantId` as a scope — the id travels IN each write, because `escalations`
 * carries it as a column with no foreign key so a client who disconnects cannot
 * take the record of what we did on their behalf with them.
 *
 *   claimEscalation            — the D-08 NEVER-TWICE CLAIM. `INSERT … ON
 *     CONFLICT DO NOTHING RETURNING id` against
 *     `escalations_inbound_message_uniq`: only the caller that gets a row back
 *     may send, so two overlapping ticks produce one text rather than two.
 *   recentEscalationForCadence — the cooldown read, on the table's own
 *     `(cadence_id, created_at)` index.
 *   recordEscalationOutcome    — the ONLY writer of `outcome`, guarded on
 *     `outcome IS NULL` so a late second answer cannot bury the first.
 *
 *   listEscalationsForQuote    — 07-03, and THE READ THE PARAGRAPH BELOW
 *     PROMISED. Keyed on ONE quote the caller already holds, scoped by tenant
 *     in the same predicate, returning no `to_address`: there is no argument
 *     you can pass it that enumerates anything. The attribution consumer needs
 *     it because "we texted you within minutes of them saying yes" has to be
 *     reconstructible from the attribution row after the escalation, the
 *     inbound reply and the cadence are all gone (RPT-01, D-05).
 *
 *   getEscalationForTenant    — 10-05, D-02. ONE escalation by id, with the
 *     tenant in the PREDICATE and `provider_message_id` in the select list: the
 *     proof action verifies an operator's pasted artefact id against a live row
 *     before it records anything, and a read that fetched first and compared the
 *     tenant afterwards is one early return away from proving another client's
 *     escalation for this one (T-10-17).
 *
 * There is deliberately no list, no read-by-tenant and no delete: an evidence
 * table with a convenience reader becomes a queryable log of who replied to
 * whom. Phase 7 adds the read it needs, with its own argument — and the
 * argument, singular, is a quote id; Phase 10 adds one more, and its argument is
 * an escalation id.
 */
export {
  claimEscalation,
  getEscalationForTenant,
  listEscalationsForQuote,
  recentEscalationForCadence,
  recordEscalationOutcome,
  type EscalationClaim,
  type EscalationEvidence,
  type EscalationOutcomePatch,
  type EscalationProofEvidence,
} from './escalations';
/**
 * The messaging-config surface (Phase 4, MSG-01) — the D-04 activation switch.
 * A FIFTH family of the same shape as the three above: one table, no joins, and
 * no method that takes a `tenantId` as a SCOPE.
 *
 * `getChannelConfig(channel, tenantId?)` does take a tenant id, and that is
 * precisely why it cannot live on `forTenant()`: it asks for the tenant's
 * override row OR the global default (`tenant_id IS NULL`) in one statement, and
 * a closure over one scope cannot pose a question with two in it. The global row
 * — the one that decides whether anything sends at all — belongs to nobody by
 * design.
 *
 *   anyChannelEnabled   — the DEPLOYMENT-level gate: "is this channel armed
 *     anywhere". Asked once per tick by `buildRoutingSender`, before any tenant
 *     is in hand. Deliberately NOT an identity read — `getChannelConfig` stays
 *     the sole authority on which identity a given tenant sends as (CR-01).
 *   getChannelConfig    — override-then-default read, one query
 *   listChannelConfig   — the console/activation read, overrides first
 *   upsertChannelConfig — the ONLY write path (04-06 console, 04-07 script)
 *   armChannel          — upsert `enabled = true` + its audit row, ONE
 *     transaction (Phase 10, D-04). Re-reads and re-supplies the identity, so a
 *     bare enable flip can never null the number it arms.
 *   disarmChannel       — the same, `enabled = false`, reason REQUIRED. Never
 *     gated (D-05): nothing may stand between an operator and stopping sending.
 *   listChannelAudit    — the last N flips, newest first, for the client page
 */
export {
  anyChannelEnabled,
  armChannel,
  disarmChannel,
  getChannelConfig,
  listChannelAudit,
  listChannelConfig,
  upsertChannelConfig,
  type ArmChannelInput,
  type ArmChannelResult,
  type ChannelAuditRow,
  type DisarmChannelInput,
  type DisarmChannelResult,
  type MessagingConfigUpsert,
} from './messaging-config';
/**
 * Telephony capture (Phase 11, CAP-01/CAP-03, D-02/D-06). Two crossings and one
 * tenant-less family, in ONE block so a reviewer sees the whole of what a
 * diverted call can reach.
 *
 *   forAllTenants_divertNumberByE164 — whose Backdesk number is this `To`? The
 *     voice webhook's ONE read before it answers: tenant, divert-number id,
 *     spoken name and the contact window. Keyed on the CALLED number only —
 *     never ForwardedFrom (D-02).
 *   forAllTenants_activeDivertNumbers — every active number and its owner, the
 *     nightly call-log reconcile's owner map (11-02). Empty means "make no
 *     Twilio call at all".
 *
 * `missed_calls` itself is the inbound-messages shape of exception: a call
 * arrives before we know whose it is, and a call to a number nobody owns is a
 * dead letter with `tenant_id = NULL`, so nothing here takes a tenant as a
 * SCOPE and nothing here joins.
 *
 *   insertMissedCallArrival — the arrival webhook. ON CONFLICT DO NOTHING on the
 *     `(provider, provider_call_id)` arbiter; `null` means "already recorded".
 *   completeMissedCall      — the status callback. UPDATE by exact CallSid match
 *     and NEVER an insert: a callback is a hint (the delivery-receipt rule).
 *   upsertMissedCallFromLog — the reconcile. Fills only what a dropped callback
 *     left NULL; never rewrites `started_at`, `after_hours` or a caller column.
 *   getMissedCallForTenant  — ONE call by id with the tenant in the PREDICATE,
 *     for the verification-call proof (11-05). No caller number in its select
 *     list.
 *
 * NO DELETE ANYWHERE IN THIS BLOCK, and none may be added: a missed call is
 * evidence, and a divert number is released by nobody while its client is
 * active (D-08) — `forTenant(id).divertNumber` has no delete either.
 */
export {
  type ActiveDivertNumber,
  type DivertNumberOwner,
  forAllTenants_activeDivertNumbers,
  forAllTenants_divertNumberByE164,
} from './for-all-tenants';
export {
  completeMissedCall,
  getMissedCallForTenant,
  insertMissedCallArrival,
  upsertMissedCallFromLog,
  type MissedCallArrivalInsert,
  type MissedCallCompletion,
  type MissedCallEvidence,
  type MissedCallFromLog,
} from './missed-calls';
/**
 * Text-back (Phase 12, TXT-01..03). THE WHOLE SURFACE, declared once (12-01
 * and 12-02) so the later plans of the phase add no export. Eleven value
 * exports, each with one job:
 *
 *   getMissedCallForTextBack — the ONE read that selects a caller's number for
 *     sending, by the row id the completion UPDATE returned. Imported by
 *     `src/core/leads/text-back.ts` alone: no console page, action, script or
 *     route may import it (T-12-07).
 *   isTextBackArmed — this client's own `text_back` switch, the EXACT-TARGET
 *     read. Never `getChannelConfig`, which falls back to a global row
 *     text-back must not have (D-09).
 *   listPendingTextBacks — the tick sweep's read (D-20): ids of undecided calls
 *     inside the age window. Ids only.
 *   markStaleTextBacks — the sweep's other half: past the ceiling is
 *     `skipped` / `stale`, never texted late (T-12-20).
 *   claimTextBackAlerts — the D-10 claim on failed / stuck text-backs (and,
 *     12-REVIEW WR-02, an armed client's `no_template` / `sms_not_armed`
 *     skips); the stamp is the decision to alert. Tenant, status and codes
 *     per row.
 *   getTextBackEvidenceForTenant — the `text_back_proof` artefact check (12-08):
 *     one call and its ledger row, tenant in the predicate, no number.
 *   claimEscalationForMissedCall — the D-16 never-twice claim for "an
 *     open-quote customer rang", keyed on the missed call.
 *   listUnescalatedQuoteCalls — which route-`quote` calls have no escalation
 *     yet: three ids per row.
 *   disarmChannelBySystem — the low-balance auto-disarm (D-21): `text_back`
 *     only, one tenant, OFF only, with an `actor = 'system'` audit row in the
 *     same transaction.
 *   listArmedTextBackTenantIds — whom an auto-disarm would reach; tenant ids.
 *   claimOperatorAlert — one operator alert per kind per Perth day (D-10).
 *
 * The decision writes (claim, decision, outcome, the 24-hour and cap counts),
 * leads, the never-text list and the attested templates are tenant-scoped and
 * live on `forTenant()`, so they run on the claim's transaction handle.
 */
export {
  claimTextBackAlerts,
  getMissedCallForTextBack,
  getTextBackEvidenceForTenant,
  listPendingTextBacks,
  markStaleTextBacks,
  type ClaimedTextBackAlert,
  type MissedCallForTextBack,
  type PendingTextBackWindow,
  type TextBackEvidence,
} from './missed-calls';
export {
  disarmChannelBySystem,
  isTextBackArmed,
  listArmedTextBackTenantIds,
  type DisarmChannelBySystemInput,
  type DisarmChannelBySystemResult,
} from './messaging-config';
export {
  claimEscalationForMissedCall,
  listUnescalatedQuoteCalls,
  type MissedCallEscalationClaim,
  type UnescalatedQuoteCall,
  type UnescalatedQuoteCallWindow,
} from './escalations';
export { claimOperatorAlert } from './operator-alerts';
export {
  type LeadCadenceCreate,
  type LeadOpen,
  type NeverTextAdd,
  type TextBackDecisionPatch,
  type TextBackTemplateInsert,
} from './for-tenant';
/**
 * Lead cadence, labels and escalation (Phase 13). THE REMAINING SURFACE,
 * declared once (13-03) so plans 13-04, 13-05 and 13-06 add no export — the
 * 12-02 interface-first move. Four value exports, each with one job:
 *
 *   claimHeldEscalationRelease — D-09: the release of a held escalation IS its
 *     claim — one guarded UPDATE on `released_at IS NULL AND outcome IS NULL`,
 *     never retried. Ids and the tradie's number; no caller number, no body.
 *   listHeldEscalationsSince — D-08/D-09: the 06:30 digest's "held overnight"
 *     line. A tenant id and a time per row.
 *   listUnescalatedRingTwiceCalls — D-07: second calls inside the window from
 *     a number with an open lead, with no escalation yet. Ids only.
 *   countColdLeadRepliesSince — D-08: the digest's "cold lead replies" line.
 *     Counts per tenant; in the inbound family, so the sixteen
 *     `forAllTenants_*` exports stand.
 *
 * The lead reads that know their tenant (`inbound.closingLabelRowsForOpenLeads`,
 * `inbound.byIdForEscalation`) live on `forTenant()`.
 */
export {
  claimHeldEscalationRelease,
  listHeldEscalationsSince,
  listUnescalatedRingTwiceCalls,
  type HeldEscalationSince,
  type ReleasedEscalation,
  type RingTwiceWindow,
  type UnescalatedRingTwiceCall,
} from './escalations';
export { countColdLeadRepliesSince, type ColdLeadReplyCount } from './inbound-messages';
export {
  type ClosingLabelRow,
  type InboundForEscalation,
  type LeadClosingLabel,
} from './for-tenant';
/**
 * ServiceM8 job creation and lead resolution (Phase 14). 2026-10 (14-01): the
 * tenant-scoped surface, declared once so plans 14-02, 14-03 and 14-04 add no
 * export. TYPES ONLY — every method lives on `forTenant()` (the guarded claim
 * and the linkage writes, the sheet and row reads, the match reads), so no
 * value export and no `forAllTenants_*` crossing is added here.
 */
export {
  type ActiveJobInRange,
  type CompanyCandidate,
  type JobContactMobile,
  type LeadJobClaim,
  type LeadJobLinkage,
  type LeadJobLinkagePatch,
  type LeadJobMatchCandidate,
  type LeadJobSheetFacts,
  type LeadJobStateFacts,
  type LeadLinkedToJob,
} from './for-tenant';
/**
 * The tradie's DONE and the digest's resolution lines (Phase 14). 2026-10
 * (14-04): three value exports, declared once, NONE of them a `forAllTenants_*`
 * crossing — each answers a question that has no tenant yet, and each returns
 * tenant ids, a lead id or counts, never a number or a body:
 *
 *   tenantsOwningNumber — D-08: which clients own this number (never-text
 *     list ∪ normalised escalation phone). Tenant ids only. The lead family.
 *   latestSentLeadEscalationTo — D-08: the lead escalation most recently SENT
 *     to that number inside the lookback. A tenant id and a lead id. The
 *     escalation family.
 *   countLeadResolutionsSince — D-09: the 06:30 digest's "jobs created from
 *     leads" and "booked by the tradie" lines. Counts per tenant. The lead
 *     family.
 *
 * The sixteen `forAllTenants_*` exports stand.
 */
export {
  countLeadResolutionsSince,
  tenantsOwningNumber,
  type LeadResolutionCount,
} from './leads';
export { latestSentLeadEscalationTo, type LeadEscalationAnswered } from './escalations';
/**
 * The lead console, the reporting additions and the privacy pass (Phase 15).
 * 2026-10 (15-03): every repository read and write plans 15-04..15-07 consume,
 * declared once. NONE of the value exports is a `forAllTenants_*` crossing —
 * the sixteen stand — and each family read returns ids, instants or counts:
 *
 *   listOpenLeadsForQueue / LEAD_QUEUE_CAP — D-01: every OPEN lead across
 *     clients, soonest deadline first, capped in SQL with the true total.
 *     Ids, instants, a touch status word, booleans — no mobile, no body; the
 *     card's personal facts come per tenant through
 *     `forTenant(t).leads.queueCards`. The lead family.
 *   countOverdueOpenLeads — D-09: the digest's overdue line. Counts per
 *     tenant. The lead family.
 *   listLeadsDueForPseudonymisation / listMissedCallsDueForPseudonymisation —
 *     D-06: the privacy pass's due-reads, bounded by a limit. The ONLY two
 *     family reads that return a raw number — their one caller is the pass
 *     (plan 15-07), which hashes in memory and writes through `forTenant()`.
 *     The lead family.
 *   listLatestReportFiguresForExport — D-04: the newest frozen figures per
 *     client-month for the design-partner CSV. Ids, the period, the zone, the
 *     version and the figures document — no line, no name, no number. The
 *     reports family's first file.
 *
 * The scoped reads and writes (`leads.queueCards`, `leads.pseudonymise`,
 * `missedCalls.listForLog`, `missedCalls.countInWindow`,
 * `missedCalls.listRawForLead`, `missedCalls.pseudonymise`,
 * `metrics.missedCallCounts`) live on `forTenant()`; only their row types are
 * exported here.
 */
export {
  countOverdueOpenLeads,
  LEAD_QUEUE_CAP,
  listLeadsDueForPseudonymisation,
  listMissedCallsDueForPseudonymisation,
  listOpenLeadsForQueue,
  type LeadDueForPseudonymisation,
  type LeadQueuePage,
  type LeadQueueRow,
  type MissedCallDueForPseudonymisation,
  type OverdueOpenLeadCount,
} from './leads';
export {
  type LeadQueueCardFacts,
  type MissedCallHashes,
  type MissedCallLogCursor,
  type MissedCallLogRow,
  type MissedCallRawStrings,
  type PseudonymiseLeadCounts,
} from './for-tenant';
export { listLatestReportFiguresForExport, type ReportFiguresForExport } from './reports';
/**
 * The ONE crossing between the two families above (D-02) — deliberately on its
 * own line, from its own file, so the exception is impossible to miss when
 * reading this barrel.
 */
export { convertProspectToTenant, type ConvertProspectResult } from './conversion';
export { closeDb } from './client';
