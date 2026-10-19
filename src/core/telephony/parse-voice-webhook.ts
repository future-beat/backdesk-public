/**
 * Twilio's voice webhook bodies, decoded and validated (Phase 11, D-05/D-06).
 *
 * Twilio Voice always posts `application/x-www-form-urlencoded`. The body is
 * read with `request.text()` (never `formData()`, which consumes the bytes a
 * dead letter needs to keep) and decoded HERE, once, into the flat string map
 * that BOTH the signature check and the schema read — so the values the
 * signature was verified over are exactly the values that get stored.
 *
 * TOLERANT BY DESIGN — hard-require only what is acted on, the inbound-SMS
 * rule. `looseObject` because Twilio adds parameters (`CallToken`, geographic
 * fields, `StirVerstat`…) and a strict schema would turn "they added a field"
 * into "every call is a dead letter".
 */
import { z } from 'zod';

import { MISSED_CALL_STATUSES } from '@/db/schema';

/**
 * Twilio's nine `CallStatus` values, verbatim — THE SAME ARRAY the
 * `missed_calls_call_status_known` CHECK is written from, so a value this
 * parser accepts is a value the column accepts.
 */
export const CALL_STATUSES = MISSED_CALL_STATUSES;

/**
 * The statuses after which a call is OVER (Phase 12, D-01): Twilio sends no
 * further status for the call, so the caller has hung up and the text-back may
 * go. `queued`, `initiated`, `ringing` and `in-progress` are not here — a call
 * still ringing has not been missed yet.
 */
export const FINAL_CALL_STATUSES = ['completed', 'busy', 'failed', 'no-answer', 'canceled'] as const;
export type FinalCallStatus = (typeof FINAL_CALL_STATUSES)[number];

/**
 * A form body → its DECODED key/value map, or `undefined` when it is not a form.
 *
 * The ClickSend DLR route's guarded decoder with the JSON attempt removed:
 * `new URLSearchParams('this is not a form')` does not fail — it yields one
 * entry whose KEY is the whole sentence — so a body only qualifies if it
 * contains an `=` and does not open like JSON. Empty keys are dropped.
 *
 * VALUES ARE DECODED (`+` → space, `%2B` → `+`), which is the shape Twilio's
 * signature algorithm appends: key, then decoded value, no separators.
 */
export function decodeFormBody(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('{') || trimmed.startsWith('[')) return undefined;
  if (!trimmed.includes('=')) return undefined;

  const entries = [...new URLSearchParams(trimmed).entries()].filter(([key]) => key !== '');
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** `CA` + 32 lowercase hex — Twilio's CallSid. */
export const CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/;

/**
 * The call-arrival request (the number's Voice URL).
 *
 * `CallSid` and `To` are REQUIRED: without a CallSid there is no idempotency
 * key, and without `To` there is no tenant (D-02). `From` is OPTIONAL at the
 * schema because a withheld caller is still a call — `classifyCaller` turns an
 * absent or non-numeric `From` into `withheld`. `ForwardedFrom` is evidence,
 * never a lookup key.
 */
export const voiceArrivalSchema = z.looseObject({
  CallSid: z.string().regex(CALL_SID_PATTERN),
  To: z.string().min(1),
  From: z.string().optional(),
  CallStatus: z.enum(CALL_STATUSES).optional(),
  Direction: z.string().optional(),
  ForwardedFrom: z.string().optional(),
  FromCountry: z.string().optional(),
});

export type VoiceArrival = z.infer<typeof voiceArrivalSchema>;

/**
 * The completed-status callback (the number's Status Callback, plan 11-02).
 * `Timestamp` is RFC 2822 UTC; it is parsed by the caller with a fallback to
 * receipt time and never fails the callback.
 */
export const voiceStatusSchema = z.looseObject({
  CallSid: z.string().regex(CALL_SID_PATTERN),
  CallStatus: z.enum(CALL_STATUSES),
  CallDuration: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  Timestamp: z.string().optional(),
});

export type VoiceStatus = z.infer<typeof voiceStatusSchema>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false };

export function parseVoiceArrival(params: Record<string, string>): ParseResult<VoiceArrival> {
  const parsed = voiceArrivalSchema.safeParse(params);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

export function parseVoiceStatus(params: Record<string, string>): ParseResult<VoiceStatus> {
  const parsed = voiceStatusSchema.safeParse(params);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}
