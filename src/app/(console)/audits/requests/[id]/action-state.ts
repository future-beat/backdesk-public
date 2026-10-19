/**
 * The status form's initial state, re-exported rather than re-declared.
 *
 * WR-10 ("one Message component") applies to the state as much as to the
 * markup: `ActionMessage` renders a `ControlState`, so a bespoke `{ error,
 * success }` type here would be a second shape that happens to be structurally
 * compatible today and drifts the first time `ControlState` grows a field.
 *
 * It exists as its own module for the reason `audits/new/action-state.ts` does:
 * a `'use server'` module may export only async functions, so the blank
 * constant cannot live in `actions.ts` — it reached the form as `undefined`
 * once already (06-02) and crashed on first render.
 *
 * IMPORT-LIGHT ON PURPOSE. `status-form.tsx` is `'use client'` and imports this
 * module; the only value that crosses is `BLANK_CONTROL_STATE`, from a leaf that
 * `tests/lint-ban.test.ts` already pins against pulling `@/db/*` into the
 * browser bundle.
 */
export { BLANK_CONTROL_STATE } from '../../../components/action-state';
export type { ControlState } from '../../../components/action-state';
