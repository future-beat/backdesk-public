'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  formatReportDate,
  generateRefusalMessage,
  generateSuccessMessage,
  generateUnchangedMessage,
  periodLabel,
  GENERATE_FAILED_MESSAGE,
} from '@/core/reporting/copy';
import { generateMonthlyReport } from '@/core/reporting/generate';
import { parseMoneyToCents } from '@/core/servicem8/normalize';
import { forTenant } from '@/db/repository';
import { createClient } from '@/lib/supabase/server';

// State shapes + BLANK_* constants live in ./action-state — a 'use server'
// module may export only async functions (invalid-use-server-value).
import {
  BLANK_FEE_STATE,
  BLANK_GENERATE_STATE,
  FEE_SAVED_MESSAGE,
  FEE_WRITE_FAILED_MESSAGE,
  GENERATE_INPUT_MESSAGE,
  type FeeFieldErrors,
  type FeeState,
  type GenerateState,
} from './action-state';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tenant, once the caller has been proved entitled to it. */
interface AuthorizedTenant {
  id: string;
  name: string;
  timezone: string;
}

type Authorization =
  | { ok: true; tenant: AuthorizedTenant }
  | { ok: false; message: string };

/**
 * THE TWO CHECKS, BEFORE ANY BODY IS PARSED (WR-01, T-7-17).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A Server Action id is GLOBAL: both actions in this file are POSTable at   │
 * │ any route in the app, including ones `proxy.ts` never sees, by anyone who │
 * │ can guess a tenant uuid. `generateMonthlyReport` and `fees.append` write  │
 * │ through the SERVICE-ROLE repository path, where RLS is inert by design.   │
 * │ This function is the enforcement; the `(console)` layout is not, because  │
 * │ a layout runs only when a layout renders — after the action has finished. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * DUPLICATED FROM `clients/[id]/actions.ts` RATHER THAN IMPORTED, and the
 * duplication is a decision. That module is a `'use server'` file in another
 * route group: importing a non-action symbol out of it would make this route's
 * bundle depend on the connect flow's schemas and copy, and exporting a shared
 * helper from it is not possible — a `'use server'` module may export only
 * async functions, so a shared `authorize` would itself become a callable
 * Server Action with a global id. The checks are the same two, for the same two
 * reasons, and they are commented in both places.
 *
 * The membership read runs through the caller's OWN JWT, so `has_tenant_access`
 * decides: a tenant this operator is not a member of returns zero rows,
 * indistinguishable from one that does not exist.
 */
async function authorize(tenantId: string): Promise<Authorization> {
  if (!UUID_PATTERN.test(tenantId)) {
    return { ok: false, message: 'Unknown client.' };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return { ok: false, message: 'Your session has expired. Sign in again.' };
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, timezone')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return { ok: false, message: 'Unknown client.' };
  }

  return { ok: true, tenant: tenant as AuthorizedTenant };
}

/**
 * Bounds a FORGED post. The form's own selects cannot produce anything outside
 * these ranges, and that is the point of stating them: this schema exists for
 * the caller who is not using the form.
 *
 * `2024` is below any month this product could report on and `2100` is past any
 * month it will; both are cheap. `month` is 1-based, as `calendarMonth` takes it.
 */
const generateSchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/**
 * FREEZE ONE MONTH AS THE NEXT VERSION (RPT-02, D-11).
 *
 * NO BUSINESS RULE LIVES HERE. The core owns all of it: the four refusals, the
 * one-transaction snapshot, the frozen lines, the versioned insert and the
 * 23505 mapping. This action authorizes, validates two integers, and turns one
 * result into one sentence.
 */
export async function generateReportAction(
  tenantId: string,
  _previous: GenerateState,
  formData: FormData,
): Promise<GenerateState> {
  const auth = await authorize(tenantId);
  if (!auth.ok) {
    return { ...BLANK_GENERATE_STATE, error: auth.message };
  }

  const parsed = generateSchema.safeParse({
    year: formData.get('year'),
    month: formData.get('month'),
  });
  if (!parsed.success) {
    return { ...BLANK_GENERATE_STATE, error: GENERATE_INPUT_MESSAGE };
  }

  let result: Awaited<ReturnType<typeof generateMonthlyReport>>;
  try {
    result = await generateMonthlyReport(tenantId, parsed.data, new Date());
  } catch (error) {
    // The caught value is DISCARDED (WR-08, T-2-02). Only the SQLSTATE reaches
    // the log, and only because "which constraint" is the one thing that makes
    // a report-generation failure diagnosable at 6am.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown';
    console.error(`[reports] generate failed: ${code}`);
    return { ...BLANK_GENERATE_STATE, error: GENERATE_FAILED_MESSAGE };
  }

  // Revalidated on EVERY non-throwing outcome, including `concurrent`: that arm
  // means somebody else's version landed a moment ago, so this operator's
  // version list is stale in exactly the way the message tells them to fix by
  // reloading. Doing it here saves them the reload.
  revalidatePath(`/reports/${tenantId}`);

  const monthLabel = periodLabel(
    `${parsed.data.year}-${String(parsed.data.month).padStart(2, '0')}-01`,
    auth.tenant.timezone,
  );

  // ── ALREADY UP TO DATE RIDES THE SUCCESS SLOT ──────────────────────────────
  //
  // Nothing went wrong, so this is not an error; nothing was written, so it is
  // not `generateSuccessMessage` either. It carries `reportId` because the
  // operator's next act is identical to the one after a write — open it — and
  // the island's existing `{state.success} … Open it →` markup renders that
  // without learning a new state, which is what keeps `generate-form.tsx` at its
  // four pinned imports.
  if (result.kind === 'unchanged') {
    return {
      ...BLANK_GENERATE_STATE,
      success: generateUnchangedMessage(result.version, monthLabel),
      reportId: result.reportId,
    };
  }

  if (result.kind !== 'generated') {
    return {
      ...BLANK_GENERATE_STATE,
      error: generateRefusalMessage(result, {
        clientName: auth.tenant.name,
        monthLabel,
        connectedAtLabel:
          result.kind === 'before_connection'
            ? formatReportDate(result.connectedAt, auth.tenant.timezone)
            : '',
      }),
    };
  }

  return {
    ...BLANK_GENERATE_STATE,
    success: generateSuccessMessage(result.version, monthLabel),
    reportId: result.reportId,
  };
}

/* ------------------------------------------------------------------------- *
 * The fee schedule (D-13)
 * ------------------------------------------------------------------------- */

/**
 * A real day in a real month.
 *
 * The regex above accepts `2026-02-31`, which `date` would then reject at the
 * database with a 22008 the operator reads as "something broke". A fee's
 * `effective_from` decides which month's report charges it; a nonexistent one is
 * a typo, and the fix is to say so beside the field.
 */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(year, month - 1, day));

  return (
    at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
  );
}

/**
 * ONE MESSAGE PER CONTROL, keyed on `path[0]` — the Phase 1 `toFieldErrors`
 * rule, restated for this form's three fields.
 *
 * A form-level "check your input" on a three-field form is a puzzle; the
 * refusal has to render beside the field that is wrong.
 */
function toFeeFieldErrors(issues: ReadonlyArray<{ path?: ReadonlyArray<PropertyKey>; message: string }>): FeeFieldErrors {
  const errors: FeeFieldErrors = {};

  for (const issue of issues) {
    const key = String(issue.path?.[0] ?? '');
    if (key !== 'kind' && key !== 'amount' && key !== 'effective_from') continue;
    // First message wins: it is the most specific one for that control.
    if (errors[key] === undefined) errors[key] = issue.message;
  }

  return errors;
}

/**
 * The three validated fields, with the UI-SPEC's own sentences as the messages.
 *
 * `amount` IS A STRING ALL THE WAY TO THE INTEGER-CENTS PARSER, deliberately. The
 * regex bounds it to at most seven whole digits and exactly two decimals if any
 * — so `59.7` is refused rather than silently read as $59.70 — and the string is
 * then parsed into integer cents WITHOUT a float ever existing. `Number(amount)
 * * 100` is the bug that puts $597.00 in the database as 59699 cents and makes
 * every multiple computed from it a cent wrong forever.
 */
const feeSchema = z.object({
  kind: z.enum(['monthly', 'setup'], { error: 'Pick a fee kind.' }),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{2})?$/, 'Amount must be a dollar figure like 597.00.'),
  effective_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Effective-from must be a date.')
    .refine(isRealCalendarDate, 'Effective-from must be a date.')
    // THE SAME BOUNDS `generateSchema` STATES, FOR THE SAME CALLER (07 WR-10).
    // Shape and calendar validity alone accept `0001-01-01` and `9999-12-31`,
    // and both append cleanly to a table with no delete path. A far-future row
    // is inert; a FAR-PAST one becomes "the fee in force" for every month
    // forever — `monthlyFeeInForceOn` picks the greatest `effective_from` not
    // after the day — and cannot be removed, only superseded by a row dated
    // even earlier. The date picker cannot produce either; this schema is for
    // the caller who is not using it.
    .refine((v) => v >= '2024-01-01' && v <= '2100-12-31', 'Effective-from must be a date.'),
  // Bounds a FORGED post as much as a long note: this is the operator's own
  // record of why a price changed, and it renders on the fee row untruncated.
  note: z.string().trim().max(200).optional(),
});

/**
 * RECORD ONE FEE-SCHEDULE ROW (D-13). APPEND ONLY — there is no edit and no
 * delete, here or anywhere below this.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO FEE AMOUNT IS EVER WRITTEN WITHOUT AN OPERATOR SUBMITTING IT. The     │
 * │ pricing from PROJECT.md ($297 / $597 / $997 / $990) appears in this      │
 * │ feature ONLY as a placeholder and a hint — never as a default value, and │
 * │ never written by any code path but this one. These rows are the          │
 * │ denominator of the 3× guarantee; a defaulted retainer would put a number │
 * │ nobody agreed to underneath a multiple on a client's invoice.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * AUTHORIZE FIRST, PARSE SECOND (WR-01). `fees.append` writes through the
 * service-role repository path where RLS is inert, so an action that validated
 * the body first and checked the caller afterwards would still have parsed a
 * stranger's input against a client they cannot see — and one refactor later
 * would have written it.
 */
/**
 * One `FormData` entry as a string — `''` for absent, and for the `File` a
 * multipart form can legally carry on any field name.
 */
function fieldText(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === 'string' ? raw : '';
}

export async function appendFeeAction(
  tenantId: string,
  _previous: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const auth = await authorize(tenantId);
  if (!auth.ok) {
    return { ...BLANK_FEE_STATE, error: auth.message };
  }

  const rawNote = formData.get('note');

  // WHAT THEY TYPED, VERBATIM, CARRIED ON EVERY REFUSAL BELOW. React 19 resets
  // an uncontrolled field once the action resolves, so a state without this
  // clears three correct fields to report that a fourth was wrong. Read before
  // parsing, because the values worth echoing are precisely the ones that did
  // not parse.
  const values = {
    kind: fieldText(formData, 'kind'),
    amount: fieldText(formData, 'amount'),
    effective_from: fieldText(formData, 'effective_from'),
    note: fieldText(formData, 'note'),
  };

  const parsed = feeSchema.safeParse({
    kind: formData.get('kind'),
    amount: formData.get('amount'),
    effective_from: formData.get('effective_from'),
    note: typeof rawNote === 'string' && rawNote.trim() !== '' ? rawNote : undefined,
  });

  if (!parsed.success) {
    return {
      ...BLANK_FEE_STATE,
      fieldErrors: toFeeFieldErrors(parsed.error.issues),
      values,
    };
  }

  // Integer cents, from the string, with no float in between.
  const amountCents = parseMoneyToCents(parsed.data.amount);
  if (amountCents === null) {
    return {
      ...BLANK_FEE_STATE,
      fieldErrors: { amount: 'Amount must be a dollar figure like 597.00.' },
      values,
    };
  }

  try {
    await forTenant(tenantId).fees.append({
      kind: parsed.data.kind,
      amountCents,
      effectiveFrom: parsed.data.effective_from,
      note: parsed.data.note ?? null,
    });
  } catch {
    // The caught value is DISCARDED: the statement's parameters include the
    // operator's own note about this client's commercial arrangement.
    console.error('[reports] fee write failed');
    // A TRANSIENT WRITE FAILURE IS THE CASE THAT MOST NEEDS THE ECHO: the input
    // was valid, so re-submitting it unchanged is the entire fix.
    return { ...BLANK_FEE_STATE, error: FEE_WRITE_FAILED_MESSAGE, values };
  }

  revalidatePath(`/reports/${tenantId}`);

  return { ...BLANK_FEE_STATE, success: FEE_SAVED_MESSAGE };
}
