/**
 * The operator-alert latch (Phase 12, D-10) — ONE ALERT PER KIND PER PERTH DAY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CLAIM IS THE DECISION TO ALERT TODAY. NOTHING UN-CLAIMS. The balance │
 * │ probe runs inside the per-minute tick; without this latch a low          │
 * │ ClickSend balance would email the operator every fifteen minutes until   │
 * │ somebody topped it up, and an inbox that cries wolf is one nobody reads. │
 * │ `INSERT … ON CONFLICT DO NOTHING RETURNING` on the primary key           │
 * │ `(kind, alert_day)`: the caller that gets a row back sends the email;    │
 * │ every later caller that day gets `false` and sends nothing. There is no  │
 * │ delete and no update here, and none may be added — a function that       │
 * │ released a claim would be a function that re-sends today's alert.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Claim-then-send, the escalation rule: a send that fails AFTER the claim is
 * reported by the caller as a failed alert. It is never retried by re-claiming.
 *
 * WHY THIS IS ITS OWN FILE, NOT A `forTenant()` NAMESPACE: the row belongs to
 * no client (an empty SMS balance is everybody's problem at once), so there is
 * no tenant to close over — the `audit_request_throttle` shape. One table, no
 * join, no read. Service-role, so RLS is bypassed by design; the table's
 * `is_operator()` policy is defence-in-depth.
 *
 * `detail` holds counts and codes only — never a number, a name or a body.
 */
import { operatorAlertLog, type OperatorAlertKind } from '@/db/schema';

import { getDb } from './client';

/** A Perth calendar date, `YYYY-MM-DD`, computed in code by the caller. */
const ALERT_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * CLAIM TODAY'S ALERT OF THIS KIND. `true` exactly once per `(kind, alertDay)`
 * — the caller that gets it sends the email — and `false` on every later call.
 *
 * TARGETED on the primary key: it is the table's only unique constraint, and
 * naming it means any other conflict would raise rather than read as "already
 * alerted". A malformed day throws before any statement (a programming error,
 * not an answer).
 */
export async function claimOperatorAlert(
  kind: OperatorAlertKind,
  alertDay: string,
  detail: Record<string, unknown> | null = null,
): Promise<boolean> {
  if (!ALERT_DAY_SHAPE.test(alertDay)) {
    throw new Error('claimOperatorAlert: alertDay must be a YYYY-MM-DD Perth calendar date.');
  }

  const rows = await getDb()
    .insert(operatorAlertLog)
    .values({ kind, alertDay, detail })
    .onConflictDoNothing({ target: [operatorAlertLog.kind, operatorAlertLog.alertDay] })
    .returning({ kind: operatorAlertLog.kind });

  return rows.length > 0;
}
