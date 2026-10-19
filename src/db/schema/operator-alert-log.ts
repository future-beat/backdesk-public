/**
 * ONE OPERATOR ALERT PER KIND PER DAY (Phase 12, D-10).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PRIMARY KEY IS THE LATCH. The balance probe runs inside the per-     │
 * │ minute tick; without a latch a low ClickSend balance would email the     │
 * │ operator every fifteen minutes until it was topped up. Sending is        │
 * │ claim-then-send: `INSERT … ON CONFLICT DO NOTHING RETURNING` on          │
 * │ (kind, alert_day), and ZERO ROWS means today's alert is already sent.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `alert_day` is the Perth calendar date, computed in code. `detail` holds
 * counts and codes only — never a number, a name or a body.
 *
 * TENANT-LESS AND OPERATOR-ONLY, the `audit_request_throttle` mould: there is
 * no client this row belongs to, so the policy is `is_operator()` alone.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** What the operator can be alerted about from this table. */
export const OPERATOR_ALERT_KINDS = [
  'clicksend_balance_low',
  'text_back_auto_disarmed',
  'clicksend_balance_unreadable',
] as const;
export type OperatorAlertKind = (typeof OPERATOR_ALERT_KINDS)[number];

export const operatorAlertLog = pgTable(
  'operator_alert_log',
  {
    /** One of OPERATOR_ALERT_KINDS. */
    kind: text('kind').notNull(),
    /** The Perth calendar date the alert belongs to. */
    alertDay: date('alert_day').notNull(),
    /** Counts and codes only. */
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** THE LATCH. See the header. */
    primaryKey({ name: 'operator_alert_log_pkey', columns: [table.kind, table.alertDay] }),

    check(
      'operator_alert_log_kind_known',
      sql`kind IN ('clicksend_balance_low', 'text_back_auto_disarmed', 'clicksend_balance_unreadable')`,
    ),

    pgPolicy('operator_alert_log_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type OperatorAlertLogRow = typeof operatorAlertLog.$inferSelect;
export type NewOperatorAlertLogRow = typeof operatorAlertLog.$inferInsert;
