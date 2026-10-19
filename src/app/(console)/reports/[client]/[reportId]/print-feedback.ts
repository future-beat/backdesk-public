/**
 * WHAT THE PRINT BUTTON SAYS WHEN THE BROWSER SAYS NOTHING (G-07-4).
 *
 * ── WHY A PRESS PROVES NOTHING ──────────────────────────────────────────────
 *
 * `window.print()` is not the synchronous, always-visible dialog its old
 * header comment claimed. On WebKit, `LocalDOMWindow::print()` returns at once
 * and silently DEFERS whenever any subresource is still loading: it sets an
 * internal "print when finished loading" flag, opens no dialog, fires no event,
 * throws nothing. The sheet appears later — when the load settles, or on a
 * second press. Next's default `<Link>` prefetch keeps a burst of RSC requests
 * in flight for exactly the seconds after hydration, which is exactly when the
 * button first works, so the operator's first tap is the one most likely to be
 * swallowed (`.planning/debug/report-print-button-inert.md`).
 *
 * So the press is acknowledged, `beforeprint` — the dialog actually opening —
 * is the PRIMARY success signal, and a short silence names the manual route
 * instead of leaving the operator staring at a button that did nothing. The
 * report is the D-12 delivery mechanism: a silent press is a report that does
 * not get sent.
 *
 * PRIMARY, NOT ONLY (07-07 review, CR-01). `beforeprint`/`afterprint` exist on
 * every engine the operator uses: WebKit shipped them in Safari 13 and iOS
 * Safari 13 (bug 196478, changeset r243762), so the iPhone in the UAT report
 * does fire them. The island subscribes to `matchMedia('print')` as well, and
 * feeds it into these same two events, so an older or embedded engine still has
 * a way out of `fallback`. That is why the table below is written to be
 * IDEMPOTENT: `beforeprint` from the event and from the media query arriving
 * together must be one transition, not two.
 *
 * ── WHY A PLAIN REDUCER ─────────────────────────────────────────────────────
 *
 * The interesting behaviour is the transition table, not the DOM: a stale timer
 * must not resurrect a hint after the dialog opened, and a press from the
 * fallback state must be a fresh attempt rather than a dead button. Kept as a
 * pure function, all of that is asserted in `tests/print-feedback.test.ts` with
 * no browser, no jsdom and no timers.
 *
 * IMPORTS NOTHING, deliberately. It sits one directory from a file that reads
 * the database; `tests/lint-ban.test.ts` pins it in `CLIENT_REACHABLE` and the
 * pure suite asserts the import list is empty.
 */

/** Idle renders no line at all; the other two each render one fixed sentence. */
export type PrintFeedback = 'idle' | 'opening' | 'fallback';

/**
 * `press` is the operator; `beforeprint`/`afterprint` are the browser saying a
 * dialog exists; `timeout` is the island's own 1.5s alarm.
 */
export type PrintFeedbackEvent = 'press' | 'beforeprint' | 'afterprint' | 'timeout';

/**
 * How long to wait for a dialog before naming the manual route.
 *
 * Long enough that the acknowledgement is not a flicker on a browser that opens
 * the sheet promptly, short enough that an operator between site visits does
 * not conclude the button is broken and walk away.
 */
export const PRINT_FALLBACK_AFTER_MS = 1500;

export const PRINT_OPENING_MESSAGE = 'Opening print…';

export const PRINT_FALLBACK_MESSAGE =
  'Nothing opened? On iPhone use Share → Print; on desktop press ⌘P / Ctrl+P.';

/** The whole behaviour of the button, as a transition table. */
export function nextPrintFeedback(state: PrintFeedback, event: PrintFeedbackEvent): PrintFeedback {
  switch (event) {
    // From ANY state, including `fallback`: the button is never dead, and a
    // second press after the hint is a fresh attempt, not a no-op.
    case 'press':
      return 'opening';
    // The dialog is up — that is the acknowledgement, so drop ours.
    case 'beforeprint':
      return 'idle';
    // Belt and braces for a surface that opened a dialog without announcing it
    // beforehand: whatever we were saying, the print is over.
    case 'afterprint':
      return 'idle';
    // ONLY from `opening`. A timer armed by a press whose dialog has since
    // opened is stale; letting it through would put the hint back on screen
    // underneath an open print sheet.
    case 'timeout':
      return state === 'opening' ? 'fallback' : state;
    default:
      return state;
  }
}

/** The line to render, or `null` for no line at all. */
export function printFeedbackMessage(state: PrintFeedback): string | null {
  if (state === 'opening') return PRINT_OPENING_MESSAGE;
  if (state === 'fallback') return PRINT_FALLBACK_MESSAGE;
  return null;
}
