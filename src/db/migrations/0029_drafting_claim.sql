-- ── THE DRAFTING QUEUE GETS A CLAIM, AND ITS EVIDENCE TABLE GETS AN ARBITER ─
--
-- Every other queue in this codebase is defended: dispatch claims with
-- `FOR UPDATE OF cadence_touches SKIP LOCKED` and leans on `send_ledger`'s
-- unique index; `message_templates` computes its version inside the INSERT
-- behind a unique index. Drafting had neither. It read `needs_draft` with a
-- plain SELECT and numbered each `touch_drafts.attempt` from that read.
--
-- pg_cron fires the tick every 60s without waiting for the response, and a full
-- drafting batch (25 touches, up to two 60s Anthropic calls each) can occupy the
-- route's whole 300s budget — so a tick overlapping the next two is the
-- documented worst case, not a hypothetical. Unclaimed, both ticks draft the
-- same touch: two paid Sonnet calls, and two attempt rows racing for one number.
--
-- The second of those is the expensive one. `drafts.latestForTouch` orders by
-- `attempt` and the quote page orders by `touch_number, attempt DESC`; with a
-- tie Postgres may hand the two queries different rows, so the page renders
-- draft A while the approve action computes a different "latest" and answers
-- "reload the page to see it" — forever. That touch cannot be approved through
-- the console at all and the customer's follow-up never goes out.

-- ── (1) THE CLAIM ───────────────────────────────────────────────────────────
--
-- NULL means "nobody is drafting this". Set by a guarded UPDATE ... RETURNING
-- (`claimForDrafting`), which under READ COMMITTED lets exactly one caller win
-- each row, and CLEARED by the drafting pass on every path that leaves a touch
-- in `needs_draft` — so an ordinary failure is still retried by the very next
-- tick. A column rather than a row lock because drafting's unit of work spans
-- two Anthropic calls, and a lock-based claim would hold a Postgres transaction
-- open across two minutes of somebody else's network.

ALTER TABLE "cadence_touches" ADD COLUMN "drafting_started_at" timestamp with time zone;--> statement-breakpoint

-- ── (2) THE ARBITER ─────────────────────────────────────────────────────────
--
-- `attempt` is derived from a read, so the claim is what SHOULD stop two
-- writers computing the same number and this index is what makes it true rather
-- than likely — the same belt-and-brace `touch_drafts_one_approved_per_touch`
-- already applies one column over.
--
-- IF THIS STATEMENT FAILS WITH 23505, duplicate (touch_id, attempt) rows already
-- exist from a pre-claim tick overlap. Do NOT make the index partial or drop it
-- to get the migration through: resolve the duplicates deliberately first.
-- `touch_drafts` is an evidence table (AI-04) and which of two rows to keep is a
-- question about what was actually written in a client's name — not one a
-- migration should answer by guessing.

CREATE UNIQUE INDEX "touch_drafts_touch_attempt_uniq" ON "touch_drafts" USING btree ("touch_id","attempt");
