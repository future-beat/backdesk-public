/**
 * zod at the ServiceM8 boundary (threat T-2-09).
 *
 * ServiceM8 responses are untrusted input — not because ServiceM8 is hostile,
 * but because a field that changes type in a Tuesday deploy would otherwise
 * reach the cadence engine as `undefined` and be sent to a customer.
 *
 * TWO COERCIONS THAT ARE NOT COSMETIC:
 *
 *  `sm8Timestamp` — ServiceM8 emits `'0000-00-00 00:00:00'` for "never
 *  happened" (a MySQL zero-date). `new Date('0000-00-00 00:00:00')` is
 *  `Invalid Date`, which is NOT null, does not throw, and propagates silently
 *  until something renders "NaN" to an operator or compares it in grace-period
 *  math and gets `false` for every branch. Normalizing to `null` at the
 *  boundary is what makes "no quote date" expressible (RESEARCH Pitfall 3).
 *
 *  `sm8Money` — `total_invoice_amount` arrives as a STRING and stays a string
 *  here. Coercing it to a JS number at the boundary would silently round
 *  through binary floating point before anything had a chance to do integer
 *  math on it. Conversion happens exactly once, in normalize.ts
 *  (RESEARCH Pitfall 4).
 *
 * `.passthrough()` (zod v4: `.loose()`) is deliberate: ServiceM8 adding a field
 * must never fail a sync. Strictness here would make their roadmap our outage.
 */
import { z } from 'zod';

/** '0000-00-00…', '' and null all mean "no value". */
export const sm8Timestamp = z
  .string()
  .nullish()
  .transform((v) => (!v || v.startsWith('0000-00-00') ? null : v));

/** Kept as a string on purpose — see the header. */
export const sm8Money = z
  .string()
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v));

/**
 * [CITED: developer.servicem8.com/reference/listjobs.md — "Valid values: Quote,
 * Work Order, Unsuccessful, Completed"]. The lifecycle is fixed by ServiceM8
 * and cannot be customised per account.
 */
export const JOB_STATUSES = ['Quote', 'Work Order', 'Unsuccessful', 'Completed'] as const;
export type Sm8Status = (typeof JOB_STATUSES)[number];

/**
 * ServiceM8's boolean-ish fields, normalized to a real boolean.
 *
 * THE DOCUMENTATION IS WRONG ABOUT THESE, and it was wrong in a way that only a
 * live call revealed: `active` and `quote_sent` are both documented as "integer
 * 0/1", but a real trial account returns `active: 1` (a number) alongside
 * `quote_sent: false` (a JSON boolean) IN THE SAME OBJECT — verified against
 * api.servicem8.com, 26 Aug 2026. A schema written from the reference page
 * alone rejects every job.
 *
 * Strings are accepted too, because a field that has already proven to vary by
 * representation is not one to bet a client's whole sync on.
 *
 * `active: 0` means DELETED and is deliberately NOT filtered out — a job that
 * vanished upstream is information the cadence engine needs (Pitfall 6).
 */
const sm8Flag = z
  .union([
    z.literal(0),
    z.literal(1),
    z.literal('0'),
    z.literal('1'),
    z.boolean(),
    z.literal('true'),
    z.literal('false'),
  ])
  .transform((v) => v === true || v === 1 || v === '1' || v === 'true');

export const sm8Job = z
  .object({
    uuid: z.string(),
    active: sm8Flag,
    /** The cursor field. Never zero for a record that exists. */
    edit_date: z.string().min(1),
    status: z.enum(JOB_STATUSES),
    date: sm8Timestamp,
    quote_date: sm8Timestamp,
    work_order_date: sm8Timestamp,
    completion_date: sm8Timestamp,
    unsuccessful_date: sm8Timestamp,
    quote_sent: sm8Flag.nullish(),
    quote_sent_stamp: sm8Timestamp,
    total_invoice_amount: sm8Money,
    company_uuid: z.string().nullish(),
    generated_job_id: z.string().nullish(),
    job_address: z.string().nullish(),
    job_description: z.string().nullish(),
  })
  .loose();

export type Sm8Job = z.infer<typeof sm8Job>;

/**
 * [CITED: developer.servicem8.com/reference/listjobcontacts.md]
 *
 * This is where the cadence's recipient phone and email come from — the company
 * object carries neither. `is_primary_contact` is DEPRECATED upstream and is
 * deliberately not modelled; `type` is the field to select on.
 */
export const sm8JobContact = z
  .object({
    uuid: z.string(),
    active: sm8Flag,
    edit_date: z.string().min(1),
    /** "cannot be changed once set" — safe as a join key. */
    job_uuid: z.string(),
    first: z.string().nullish(),
    last: z.string().nullish(),
    phone: z.string().nullish(),
    mobile: z.string().nullish(),
    email: z.string().nullish(),
    /** 'JOB' | 'BILLING' | 'Property Manager' — free text, values vary in case. */
    type: z.string().nullish(),
  })
  .loose();

export type Sm8JobContact = z.infer<typeof sm8JobContact>;

/**
 * [CITED: developer.servicem8.com/reference/listnotes.md]
 *
 * The comms-adjacent record. Notes join to jobs through `related_object_uuid`,
 * with `related_object` naming which kind of object that uuid refers to — so
 * BOTH fields have to be consulted: a note attached to a Company happens to
 * carry a uuid in the same column, and joining on the uuid alone would credit
 * a job with a follow-up that was written about the customer's account.
 *
 * `create_date` is the D-10 signal, NOT `edit_date`: editing a note written the
 * day the quote went out does not mean anyone contacted the customer this week.
 */
export const sm8Note = z
  .object({
    uuid: z.string(),
    active: sm8Flag,
    edit_date: z.string().min(1),
    /** 'Job' | 'Company' | … — free text upstream, case observed to vary. */
    related_object: z.string().nullish(),
    related_object_uuid: z.string().nullish(),
    create_date: sm8Timestamp,
  })
  .loose();

export type Sm8Note = z.infer<typeof sm8Note>;

/**
 * [CITED: developer.servicem8.com/reference/listjobactivities.md]
 *
 * A STAFF SCHEDULING RECORD, NOT A COMMUNICATIONS LOG — and that distinction is
 * the honest limit of the whole "never followed up" figure. It records who was
 * allocated to a job and when; SMS and email sent from inside ServiceM8 are
 * **not visible here** (measured against the live trial account, see
 * docs/servicem8-api-notes.md).
 *
 * It still counts as evidence for D-10: a visit scheduled or recorded after the
 * quote means the tradie did something about it. But because the invisible
 * channels can only ever cause a followed-up quote to look neglected — never
 * the reverse — the audit's leakage figure is an OVER-estimate bounded by this
 * gap, and the report says so in its methodology footnote rather than
 * presenting the number as complete.
 *
 * `note` is deliberately not modelled: nothing needs the text, and text we do
 * not parse is text we cannot accidentally store or log.
 */
export const sm8JobActivity = z
  .object({
    uuid: z.string(),
    active: sm8Flag,
    edit_date: z.string().min(1),
    job_uuid: z.string(),
    start_date: sm8Timestamp,
    end_date: sm8Timestamp,
  })
  .loose();

export type Sm8JobActivity = z.infer<typeof sm8JobActivity>;

// ── Phase 14: the WRITE boundary (SM8-01, D-03) ─────────────────────────────
//
// Read schemas stay `.loose()` (ServiceM8 adding a field must never fail a
// read-back); REQUEST schemas are `.strict()` on OUR side, so a typo never
// silently ships a field ServiceM8 would ignore. Every shape below was
// measured by the research spike against the test account on 10 Oct 2026
// (14-RESEARCH "Spike ledger"; docs/servicem8-api-notes.md "Write semantics").

/** A uuid's shape. ServiceM8 mints time-ordered `01a1…` ids; any 8-4-4-4-12 hex passes. */
const sm8Uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/**
 * [CITED: developer.servicem8.com/reference/listclients.md]
 * [VERIFIED: spike ledger #2]
 *
 * A ServiceM8 "client" record. IT HAS NO MOBILE, PHONE OR EMAIL — measured, and
 * the docs agree (research Pitfall 2). A company is matched by mobile through
 * its company CONTACTS (`sm8CompanyContact`), never by filtering `company.json`.
 */
export const sm8Company = z
  .object({
    uuid: z.string(),
    active: sm8Flag,
    edit_date: z.string().min(1),
    name: z.string().nullish(),
  })
  .loose();

export type Sm8Company = z.infer<typeof sm8Company>;

/**
 * [CITED: developer.servicem8.com/reference/listcompanycontacts.md]
 * [VERIFIED: spike ledger #3/#4]
 *
 * Where a client record keeps its people's numbers. `type` is free text and
 * NOT a selector: the primary contact created with `type: 'JOB'` read back as
 * `BILLING` (research A5) — never filter company contacts by type.
 */
export const sm8CompanyContact = z
  .object({
    uuid: z.string(),
    active: sm8Flag,
    edit_date: z.string().min(1),
    company_uuid: z.string(),
    first: z.string().nullish(),
    last: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    mobile: z.string().nullish(),
    type: z.string().nullish(),
  })
  .loose();

export type Sm8CompanyContact = z.infer<typeof sm8CompanyContact>;

/**
 * `POST job.json` [CITED: developer.servicem8.com/reference/createjobs.md]
 * [VERIFIED: spike ledger #6/#13]. `status` is the only required field and
 * `'Quote'` the only value Backdesk ever writes; `job_address` max 500 (docs).
 */
export const sm8JobCreate = z
  .object({
    status: z.literal('Quote'),
    company_uuid: sm8Uuid,
    job_description: z.string().min(1).max(4000),
    job_address: z.string().max(500).optional(),
  })
  .strict();

export type Sm8JobCreate = z.infer<typeof sm8JobCreate>;

/**
 * `POST jobcontact.json` [CITED: createjobcontacts.md] [VERIFIED: spike ledger
 * #9/#14]. ServiceM8 auto-creates NO job contact for an API-created job (#8).
 * `is_primary_contact` is deprecated upstream on JobContact and not written.
 */
export const sm8JobContactCreate = z
  .object({
    job_uuid: sm8Uuid,
    first: z.string().max(100).optional(),
    last: z.string().max(100).optional(),
    mobile: z.string(),
    type: z.literal('JOB'),
  })
  .strict();

export type Sm8JobContactCreate = z.infer<typeof sm8JobContactCreate>;

/** `POST company.json` — `name` 1–100 [CITED: createclients.md] [VERIFIED: spike ledger #1]. */
export const sm8CompanyCreate = z
  .object({
    name: z.string().min(1).max(100),
  })
  .strict();

export type Sm8CompanyCreate = z.infer<typeof sm8CompanyCreate>;

/**
 * `POST companycontact.json` [CITED: createcompanycontacts.md] [VERIFIED: spike
 * ledger #3]. Written beside every company we create so the tradie's client
 * record carries the caller's mobile (and later matches can find it).
 */
export const sm8CompanyContactCreate = z
  .object({
    company_uuid: sm8Uuid,
    first: z.string().optional(),
    last: z.string().optional(),
    mobile: z.string(),
    type: z.literal('JOB'),
    is_primary_contact: z.literal('1'),
  })
  .strict();

export type Sm8CompanyContactCreate = z.infer<typeof sm8CompanyContactCreate>;

/**
 * The write envelope [VERIFIED: spike ledger #1–#19]: `{"errorCode":0,
 * "message":"OK"}`. `errorCode` is a NUMBER on the wire; the docs show the
 * string `"0"` — both accepted. Anything else on a 200 is drift.
 */
export const sm8WriteResult = z
  .object({
    errorCode: z.union([z.literal(0), z.literal('0')]),
    message: z.string(),
  })
  .loose();

export type Sm8WriteEnvelope = z.infer<typeof sm8WriteResult>;
