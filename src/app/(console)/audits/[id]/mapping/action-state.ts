/**
 * Blank initial state for the CSV column-mapping form. Lives outside actions.ts
 * because a `'use server'` module may export only async functions
 * (invalid-use-server-value).
 */
import type { MappingState } from './actions';

export const BLANK_MAPPING_STATE: MappingState = {
  fieldErrors: {},
  formError: null,
  warning: null,
};
