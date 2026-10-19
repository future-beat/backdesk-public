/**
 * Blank initial state for the convert-to-client form. Lives outside actions.ts
 * because a `'use server'` module may export only async functions
 * (invalid-use-server-value).
 */
import type { ConvertState } from './actions';

export const BLANK_CONVERT_STATE: ConvertState = { error: null, success: null };
