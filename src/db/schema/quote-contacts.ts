/**
 * The recipient data. Every SMS and every email the cadence engine sends in
 * Phase 3 and Phase 4 addresses a row in this table.
 *
 * WHY A SEPARATE TABLE RATHER THAN COLUMNS ON `quotes`: a ServiceM8 job can
 * carry several contacts (`JOB`, `BILLING`, a property manager), and which one
 * a follow-up should reach is a decision the cadence engine makes with all of
 * them in view. Flattening "the" contact onto the quote row would force that
 * choice at sync time, in the layer that knows least about it, and would
 * silently discard the alternatives when the first one bounces.
 *
 * WHY IT SYNCS ON ITS OWN CURSOR (`sm8_connections.contact_cursor`): contacts
 * and jobs have independent `edit_date` streams upstream. A tradie correcting a
 * customer's mobile number does not touch the job, so a contact-change would be
 * invisible to a job-cursor poll — and the number we send to would stay wrong
 * until something unrelated edited the job.
 *
 * `is_primary_contact` IS DELIBERATELY NOT MIRRORED. The ServiceM8 job-contact
 * reference marks it deprecated; `type` is the field to select on. Mirroring a
 * deprecated field would invite Phase 3 to build recipient selection on
 * something upstream has already stopped maintaining.
 *
 * `sm8_active` follows the same rule as on `quotes` (Pitfall 6): a contact
 * deleted upstream must be visible to us AS deleted rather than merely absent.
 * A cadence that keeps texting a number the tradie removed is the failure this
 * column exists to prevent.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { tenants } from './tenants';

export const quoteContacts = pgTable(
  'quote_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** The upsert/dedupe key, scoped by tenant for the same reason `quotes` is. */
    sm8ContactUuid: uuid('sm8_contact_uuid').notNull(),

    /**
     * The join back to `quotes.sm8_job_uuid`. Deliberately the ServiceM8 uuid
     * rather than a foreign key to `quotes.id`: contacts and jobs arrive on
     * separate cursors, so a contact can legitimately be fetched in a cycle
     * where its job has not been seen yet. A real FK would reject that row —
     * losing the contact permanently, because the next poll will not re-offer
     * it once the cursor has moved past. ServiceM8's own reference says
     * `job_uuid` "cannot be changed once set", so the key is stable.
     */
    sm8JobUuid: uuid('sm8_job_uuid').notNull(),

    first: text('first'),
    last: text('last'),
    phone: text('phone'),
    mobile: text('mobile'),
    email: text('email'),

    /** 'JOB' | 'BILLING' | 'Property Manager' — free text upstream, case varies. */
    contactType: text('contact_type'),

    /** false means DELETED upstream — see the header. */
    sm8Active: boolean('sm8_active').notNull().default(true),

    /** The contact cursor's basis. Verbatim, never reinterpreted. */
    editDateRaw: text('edit_date_raw').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quote_contacts_tenant_contact_uniq').on(table.tenantId, table.sm8ContactUuid),
    // Phase 3's read is "give me the contacts for this job", every send.
    index('quote_contacts_tenant_job_idx').on(table.tenantId, table.sm8JobUuid),
    pgPolicy('quote_contacts_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type QuoteContact = typeof quoteContacts.$inferSelect;
export type NewQuoteContact = typeof quoteContacts.$inferInsert;
