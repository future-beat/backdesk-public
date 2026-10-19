/**
 * Blank initial state for the new-audit form. Lives outside actions.ts because
 * a `'use server'` module may export only async functions — a const export is
 * stripped/invalid under the use-server loader (invalid-use-server-value),
 * which reached the form as `undefined` and crashed on `state.values`.
 */
import type { CreateAuditState } from './actions';

export const BLANK_AUDIT_STATE: CreateAuditState = {
  errors: {},
  formError: null,
  values: { business_name: '', source: 'api_key' },
};
