'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  ARRIVAL_SOURCE_FIELDS,
  ARRIVAL_SOURCE_KEY,
  ARRIVAL_VALUE_MAX,
  OWN_HOSTS,
  type ArrivalSourceField,
} from '@/core/intake/arrival-source';

/**
 * FIRST-TOUCH ARRIVAL CAPTURE, IN THE VISITOR'S OWN TAB (19 Sep 2026).
 *
 * Two tiny client components: one mounted in the marketing layout, which
 * remembers where this session began, and one mounted in the audit form, which
 * hands that memory back as four hidden fields.
 *
 * ── SESSION STORAGE, NOT A COOKIE (LAND-05, the request §6) ────────────────
 *
 * `sessionStorage` is per-tab, dies when the tab closes, is never sent to any
 * server on its own, and is not a cookie — which is why the privacy notice can
 * say what happens in one plain sentence and why there is no banner. Nothing
 * here loads a script, requests a third-party URL, or records anything about
 * the visitor beyond the four short strings named below.
 *
 * ── FIRST TOUCH MEANS THE FIRST, INCLUDING "NOTHING" ───────────────────────
 *
 * The record is written ONCE per session and never overwritten — and it is
 * written even when there is nothing in it. A visitor who arrives directly and
 * then wanders through the site must not be attributed to whatever page they
 * happened to be on when they reached the form, and "arrived directly" is
 * itself the answer for that session. An empty record is the fact that the
 * session began with no link to record.
 *
 * ── EVERY READ AND WRITE IS INSIDE A try/catch, AND THAT IS NOT DEFENSIVE ──
 *
 * `sessionStorage` THROWS on access in Safari's private mode on older iOS, in
 * a sandboxed iframe, and whenever a storage quota is exhausted — the property
 * access itself, before any method call. This runs on every public page, so an
 * unguarded read is a blank page for exactly the visitor whose browser is most
 * locked down. The failure mode here is losing one attribution, which is the
 * cheapest thing in the product to lose (LAND-03: the form's success may never
 * depend on these fields).
 */

/** The four values, as the record stored in the session. */
type ArrivalRecord = Partial<Record<ArrivalSourceField, string>>;

/**
 * A raw value, bounded before it is stored.
 *
 * The SERVER is the trust boundary and does the real parsing
 * (`@/core/intake/arrival-source`); this is a length cap so a hostile link
 * cannot fill a visitor's storage quota with a megabyte of query string on a
 * page they merely opened. Deliberately NOT the charset check: the server's
 * refusal is the one that decides what is stored, and duplicating the rule here
 * would give it two spellings that could drift.
 */
function bounded(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, ARRIVAL_VALUE_MAX);
  return trimmed === '' ? undefined : trimmed;
}

/**
 * `document.referrer`'s HOST, or nothing.
 *
 * NEVER THE FULL URL (the request §4, LAND-05). The rest of a referrer is a
 * search query, a page path and sometimes somebody else's campaign id, and none
 * of it is a fact about which of OUR channels worked.
 *
 * Our own hosts are dropped: a visitor moving from `/` to `/audit` sends a
 * referrer, and recording it would attribute every request to ourselves. Parsed
 * with `URL` rather than by string surgery so a malformed referrer is an
 * exception this function swallows rather than a fragment that looks like a
 * host.
 */
function referrerHost(): string | undefined {
  try {
    const referrer = document.referrer;
    if (!referrer) return undefined;
    const host = new URL(referrer).hostname.toLowerCase();
    return OWN_HOSTS.includes(host) ? undefined : host;
  } catch {
    return undefined;
  }
}

/**
 * Remember how this session began — once, on the first public page it loads.
 *
 * Renders NOTHING. It is mounted in the marketing layout so every public page
 * carries it, which is what makes the record "where the session started"
 * rather than "where the form was opened".
 */
/* ------------------------------------------------------------------------- *
 * THE RECORD, AS AN EXTERNAL STORE
 *
 * `sessionStorage` is exactly what `useSyncExternalStore` is for: state that
 * lives outside React, that the server cannot see, and that must not be read
 * during render on the server. It is used here instead of `useState` +
 * `useEffect` for a reason that is not stylistic — EFFECTS RUN CHILD FIRST.
 *
 * The capture below is mounted in the LAYOUT and the fields are mounted deep
 * inside the audit form, so on the first page load of a session the form's
 * effect runs BEFORE the layout has written anything. A `setState` in the
 * form's own effect would therefore read an empty store, once, and never look
 * again — every first-visit submission would arrive unattributed, which is
 * precisely the case the whole feature exists for (somebody clicking the
 * Google listing's booking link straight to `/audit`).
 *
 * So the capture EMITS after it writes, and the subscribed fields re-read. One
 * notification, in one direction, with no polling.
 * ------------------------------------------------------------------------- */

/** Everything currently reading the record. Empty on the server. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The stored record, as its raw JSON string.
 *
 * A STRING rather than a parsed object, because `useSyncExternalStore` compares
 * snapshots with `Object.is` and re-renders forever if a fresh object comes back
 * on every call. Strings compare by value, so this is stable by construction.
 */
function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(ARRIVAL_SOURCE_KEY);
  } catch {
    return null;
  }
}

/** The server has no session storage and must not pretend otherwise. */
function noStoredValue(): null {
  return null;
}

export function ArrivalSourceCapture() {
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(ARRIVAL_SOURCE_KEY) !== null) return;

      const params = new URLSearchParams(window.location.search);
      const record: ArrivalRecord = {};

      for (const field of ARRIVAL_SOURCE_FIELDS) {
        // `referrer_host` is not a query parameter — it comes from the document.
        if (field === 'referrer_host') continue;
        const value = bounded(params.get(field));
        if (value) record[field] = value;
      }

      const host = referrerHost();
      if (host) record.referrer_host = host;

      window.sessionStorage.setItem(ARRIVAL_SOURCE_KEY, JSON.stringify(record));
    } catch {
      // Storage unavailable or full. One attribution lost; nothing else changes.
    }

    // Outside the try: the fields must be told even if the write above threw,
    // because a store that is unreadable is still an answer they should settle
    // on rather than wait for.
    for (const listener of listeners) listener();
  }, []);

  return null;
}

/**
 * The four hidden inputs the audit form submits.
 *
 * ── WHY THIS IS A SEPARATE COMPONENT FROM THE FORM ─────────────────────────
 *
 * `AuditRequestForm` deliberately holds no `useState`: every visible value comes
 * back from the server and is applied with `defaultValue`, so a rejected submit
 * on a JS-disabled browser still shows what was typed. These four are the
 * opposite kind of field — nobody typed them, they exist only when JS ran, and
 * they must be read from storage AFTER hydration. Keeping them in their own
 * component means the form's rule stays true and this one's state cannot
 * re-render the fields a person is typing into.
 *
 * ── THEY RENDER EMPTY FIRST, ON PURPOSE ────────────────────────────────────
 *
 * The server has no idea what is in the visitor's session storage, so the first
 * paint must not claim to: `useSyncExternalStore`'s server snapshot is `null`,
 * the inputs are emitted empty, and the real values arrive on the client. That
 * is the mechanism that keeps hydration honest — a component that read storage
 * during render would render one thing on the server and another on the client,
 * and React resolves that disagreement by discarding the client's values.
 *
 * With JS off there is no capture and no fill, so all four submit empty and the
 * console says `Unknown`. That is the honest answer: nothing was recorded.
 */
export function ArrivalSourceFields() {
  const stored = useSyncExternalStore(subscribe, readStored, noStoredValue);

  /**
   * The stored JSON, as the four fields — or nothing.
   *
   * Every value is checked to be a STRING and every key to be one of the four
   * names, because what is being parsed is a value from the visitor's own
   * browser: an extension, a previous version of this code, or a person with the
   * console open could have put anything under that key, and an unchecked spread
   * would turn it into arbitrary form fields on a request the server then stores.
   * The server refuses anything it does not recognise anyway; this is the first
   * of the two readings, not the only one.
   */
  const record = useMemo<ArrivalRecord>(() => {
    if (!stored) return {};
    try {
      const parsed: unknown = JSON.parse(stored);
      if (parsed === null || typeof parsed !== 'object') return {};

      const next: ArrivalRecord = {};
      for (const field of ARRIVAL_SOURCE_FIELDS) {
        const value = (parsed as Record<string, unknown>)[field];
        if (typeof value !== 'string') continue;
        const safe = bounded(value);
        if (safe) next[field] = safe;
      }
      return next;
    } catch {
      // Not JSON. The fields stay empty and the row says Unknown.
      return {};
    }
  }, [stored]);

  return (
    <>
      {ARRIVAL_SOURCE_FIELDS.map((field) => (
        <input key={field} type="hidden" name={field} value={record[field] ?? ''} readOnly />
      ))}
    </>
  );
}
