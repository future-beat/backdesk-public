/**
 * Lead-born jobs are COUNTED, never ATTRIBUTED (Phase 14, D-06; v1.2 decision
 * D8).
 *
 * A job is lead-born when ANY lead of the tenant is linked to it, in any
 * state (14-REVIEW WR-03). A uuid reaches `leads.sm8_job_uuid` only through a
 * job Backdesk recorded as the lead's: the operator's tap created it or
 * adopted it (`creating`, `created`, or `failed` part-way — the job exists in
 * the tradie's account even when the attempt did not finish), or the sync
 * matched the tradie's own booking (`booked_by_tradie`). Every one of those
 * counts in leads-to-jobs, and a `won` on it must never become recovered
 * dollars or a fee in v1.2, whatever touches the send ledger holds: the
 * operator may later review such a row eligible and run a quote cadence,
 * after which `qualifyingTouches` would otherwise credit it. A persisted job
 * the tradie deleted is cleared from the lead on the next attempt (WR-01), so
 * a stale link does not outlive it.
 *
 * KEYED ON THE LEAD LINKAGE, NEVER ON THE MIRROR'S SOURCE COLUMN. That column
 * is provenance — written by the mirror's upsert, not a decision — and the
 * tradie-booked job never carried `'lead'` at all.
 *
 * PURE: no imports. The consumer reads the linkage (`tx.leads.linkedToJob`)
 * and asks this before `decideAttribution` runs.
 */

/** One lead linked to the won job, as `forTenant().leads.linkedToJob` returns it. */
export interface LeadJobLink {
  sm8JobState: string;
  closedReason: string | null;
}

/**
 * Whether this job is lead-born: any linkage at all. The state and reason are
 * deliberately NOT consulted — a `failed` or `creating` lead holding the uuid
 * is still a job our tap made (see the header).
 */
export function isLeadBornJob(links: readonly LeadJobLink[]): boolean {
  return links.length > 0;
}
