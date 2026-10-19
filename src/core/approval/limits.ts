/**
 * The approval form's outer bounds. A LEAF MODULE: it imports nothing.
 *
 * ── WHY THIS IS ITS OWN FILE, AND NOT A CONSTANT IN `approve-draft.ts` ─────
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `EDITED_BODY_MAX` is needed by the CLIENT: `draft-card.tsx` caps its      │
 * │ textarea with it, through `components/action-state.ts`. When that value   │
 * │ lived in `approve-draft.ts`, importing it dragged the whole module in —   │
 * │ and `approve-draft.ts` imports `@/db/repository`, which imports the       │
 * │ `postgres` driver, which imports `fs`, `net`, `tls` and `perf_hooks`.     │
 * │ The result was a production build that failed outright with four          │
 * │ `Module not found` errors, none of which mentioned the actual cause.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A `import type` is erased at build time and is therefore free; a VALUE import
 * is a real edge in the module graph. That asymmetry is invisible in the source
 * and invisible to `tsc`, which is why the number lives somewhere a client
 * component can reach without consequence rather than being remembered about.
 *
 * `approve-draft.ts` re-exports it so every server-side caller keeps its import
 * path. `tests/quote-draft-approval.test.ts` asserts the client boundary holds.
 */

/**
 * The longest body an edit form will accept, in characters.
 *
 * NOT the send limit — D-03's real cap is TWO GSM-7 SEGMENTS, which
 * `validateDraft` measures in septets over the normalized text and which this
 * number cannot express (a body of 320 emoji is 640 characters and eight UCS-2
 * segments). This is the outer bound on what is worth parsing at all: a
 * megabyte POSTed at a globally-reachable action id should be refused before it
 * reaches a validator, not after. The real refusal is `too_many_segments`, and
 * its message names the segment count.
 *
 * ONE NUMBER, four places: both surfaces' forms cap their textarea with it and
 * both surfaces' actions refuse past it.
 */
export const EDITED_BODY_MAX = 640;

/**
 * THE ONLY TWO DRAFT STATUSES AN OPERATOR MAY STILL BE OFFERED (WR-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE POPULATION RULE, TWO FILTERS was exactly the CR-02 shape this phase   │
 * │ exists to prevent, and the two approval surfaces had grown it. The quote  │
 * │ page filtered the latest attempt on these two statuses; the cross-client  │
 * │ queue's accessor did not. For a `pending_approval` touch whose newest     │
 * │ attempt is `approved` or `superseded`, the quote page showed nothing and  │
 * │ the queue rendered a full card — badge, body, and a working "Approve and  │
 * │ send as written" — for a message that will not be sent. Tapping it        │
 * │ answered `already_approved` (a success) or `superseded` (an error the     │
 * │ operator cannot clear), and the card came back on every reload.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `generated` is a draft awaiting a decision. `validator_failed` is one D-11
 * leaves edit-only — still the operator's to act on, which is why it is HERE and
 * not filtered out with the rest. `approved` is through the gate; `superseded`
 * lost a regeneration; neither is a tap the server would honour, and
 * `draft-card.tsx`'s stated property is that "the operator is never offered a
 * tap the server would refuse."
 *
 * ── WHY IT LIVES IN THIS LEAF MODULE ────────────────────────────────────────
 *
 * The two readers cannot share an import any closer than this. The queue reads
 * through drizzle in `for-all-tenants.ts`; the quote page reads through the
 * operator's own RLS-scoped Supabase client and must not touch the repository
 * barrel at all (it would drag the `postgres` driver in — see the header above,
 * and the ESLint ban). A framework-free leaf both can reach is the only place a
 * single rule can actually live.
 */
export const APPROVABLE_DRAFT_STATUSES = ['generated', 'validator_failed'] as const;

export type ApprovableDraftStatus = (typeof APPROVABLE_DRAFT_STATUSES)[number];

/**
 * The same rule, for the reader that has a `string` rather than a column.
 *
 * The queue applies `APPROVABLE_DRAFT_STATUSES` as a SQL predicate; the quote
 * page has already fetched the row and holds an untyped `status` off a Supabase
 * response. Without this, that caller would need a cast — and a cast is where
 * the two rules would drift apart again the next time one of them is widened.
 */
export function isApprovableDraftStatus(status: string): status is ApprovableDraftStatus {
  return (APPROVABLE_DRAFT_STATUSES as readonly string[]).includes(status);
}
