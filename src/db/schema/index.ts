/**
 * Schema barrel — the single entry point drizzle-kit reads (see drizzle.config.ts).
 * Every future table must be exported from here or it will not reach a migration.
 */
export * from './prospects';
export * from './tenants';
export * from './sm8-connections';
export * from './quotes';
export * from './quote-contacts';
export * from './quote-events';
export * from './sync-runs';
export * from './operators';
export * from './cadence-templates';
export * from './cadence-settings';
export * from './cadences';
export * from './cadence-touches';
export * from './send-ledger';
export * from './suppressed-contacts';
export * from './inbound-messages';
export * from './messaging-config';
export * from './remote-test-lease';
export * from './message-templates';
export * from './touch-drafts';
export * from './escalations';
export * from './tenant-attestations';
export * from './quote-attributions';
export * from './monthly-reports';
export * from './tenant-fees';
export * from './audit-requests';
export * from './messaging-config-audit';
export * from './tenant-proofs';
// Phase 11 (telephony capture): the per-client divert number and every call it
// took. One journal entry for both — migration 0038.
export * from './tenant-divert-numbers';
export * from './missed-calls';
// Phase 12 (instant text-back): the lead a missed call opens, the attested
// text-back wording, the never-text list and the once-a-day operator alert
// latch. One journal entry for all four and every Phase 12 change to an
// existing table — migration 0039.
export * from './leads';
export * from './text-back-templates';
export * from './tenant-never-text';
export * from './operator-alert-log';
