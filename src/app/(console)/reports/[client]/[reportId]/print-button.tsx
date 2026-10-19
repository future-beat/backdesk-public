'use client';

/**
 * THE PDF ENGINE IS THE BROWSER (D-12).
 *
 * SCREEN ONLY — `report.css` hides `.report-actions`, every `button` and every
 * `form` under `@media print`, so this control cannot appear on the artifact it
 * produces. That is the same rule `convert-form.tsx` follows one route over, for
 * the same reason: the printed page is a document handed to a client, and a
 * button rendered onto it is operator machinery leaking into their copy. The
 * acknowledgement line below inherits that hiding for free — it is inside
 * `.report-actions`, and `tests/print-feedback.test.ts` pins that the print
 * block still names the section.
 *
 * ── WHY THERE IS FEEDBACK (07-07, G-07-4) ───────────────────────────────────
 *
 * The previous header claimed `window.print()` opens the dialog and blocks
 * until it closes, so there was nothing to show. That is false on WebKit:
 * `LocalDOMWindow::print()` returns immediately and silently defers whenever
 * any subresource is still loading — no dialog, no event, no error — and shows
 * the sheet later, once loading settles. Next's default `<Link>` prefetch keeps
 * requests in flight for the seconds right after hydration, which is when this
 * button first works, and Phase 7 UAT duly reported a first press that did
 * nothing and a second that produced the PDF.
 *
 * So: the press is acknowledged at once, `beforeprint` (the dialog genuinely
 * opening) clears it, and ~1.5s of silence names the manual route while the
 * button stays live for another press. The transition table itself lives in
 * `./print-feedback` and is asserted without a browser.
 *
 * `beforeprint` is the PRIMARY signal and it is supported on every engine this
 * operator touches — WebKit shipped `beforeprint`/`afterprint` in Safari 13 and
 * iOS Safari 13 (WebKit bug 196478 / changeset r243762), Chromium and Gecko
 * long before that. The `matchMedia('print')` subscription in the effect below
 * is a second route to the same two events, for an embedded webview or an
 * engine older than that; it is belt and braces, not the load-bearing signal.
 *
 * ── WHY THIS IS A CLIENT COMPONENT AND NOT AN ANCHOR ────────────────────────
 *
 * There is no server round trip and no navigation. `window` exists only in the
 * browser, so the lines that touch it are isolated in the smallest possible
 * `'use client'` island; the entire report sheet above it stays server-rendered
 * (E4/E6: the document arrives whole, with no skeleton and no hydration gap).
 * The island's own first render is `idle`, so the acknowledgement is not in the
 * server HTML either.
 *
 * PLAIN PROPS, NO PROPS AT ALL: this file imports `react` and its import-free
 * sibling `print-feedback.ts`, and nothing else. `tests/lint-ban.test.ts` pins
 * both files in `CLIENT_REACHABLE` so they stay that way.
 */
import { useEffect, useRef, useState } from 'react';

import {
  nextPrintFeedback,
  printFeedbackMessage,
  PRINT_FALLBACK_AFTER_MS,
  type PrintFeedback,
} from './print-feedback';

export function PrintButton() {
  const [feedback, setFeedback] = useState<PrintFeedback>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => {
    // The dialog opening is the trustworthy signal that the press landed.
    // `afterprint` is the backstop for a surface that opens one without
    // announcing it first.
    const onBefore = () => {
      clearTimer();
      setFeedback((state) => nextPrintFeedback(state, 'beforeprint'));
    };
    const onAfter = () => {
      clearTimer();
      setFeedback((state) => nextPrintFeedback(state, 'afterprint'));
    };

    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);

    // BELT AND BRACES, NOT THE PRIMARY SIGNAL (07-07 review, CR-01).
    //
    // The two events above are supported by every engine this operator uses:
    // WebKit shipped them in Safari 13 / iOS Safari 13 (bug 196478, changeset
    // r243762, "[WK2] Add support for Window's beforeprint / afterprint
    // events") and the phone in the UAT report runs iOS 26. The print media
    // query is the same information by a second route — `matches` true is the
    // sheet opening, false is it closing — and it costs three lines, so an
    // embedded webview or an engine older than Safari 13 still clears the hint
    // instead of stranding it. Both routes dispatch the SAME two events into
    // the same reducer, which is idempotent: a duplicate `beforeprint` is a
    // no-op (pinned in `tests/print-feedback.test.ts`).
    //
    // Guarded because `matchMedia` is not universal (jsdom, some webviews) and
    // its `addEventListener` form only exists from Safari 14 — the versions
    // below that are exactly the ones already covered by `beforeprint`.
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const printMedia = query !== null && typeof query.addEventListener === 'function' ? query : null;
    const onMedia = (event: MediaQueryListEvent) => (event.matches ? onBefore() : onAfter());
    printMedia?.addEventListener('change', onMedia);

    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
      printMedia?.removeEventListener('change', onMedia);
      clearTimer();
    };
  }, []);

  function press() {
    clearTimer();
    setFeedback((state) => nextPrintFeedback(state, 'press'));
    timer.current = setTimeout(() => {
      timer.current = null;
      setFeedback((state) => nextPrintFeedback(state, 'timeout'));
    }, PRINT_FALLBACK_AFTER_MS);
    // LAST, and deliberately so. On Chromium `print()` blocks and dispatches
    // `beforeprint` inside the call, so the acknowledgement never paints there
    // and the timer is already cleared by the time this returns — the dialog IS
    // the acknowledgement. On WebKit mid-load it returns at once and the two
    // lines above are the only thing the operator has to go on.
    window.print();
  }

  const message = printFeedbackMessage(feedback);

  return (
    <>
      <button type="button" onClick={press}>
        Print or save as PDF
      </button>
      {/* MOUNTED FROM FIRST PAINT, EMPTY WHEN THERE IS NOTHING TO SAY.
          The `connect-form.tsx` status-line convention: a status role is
          already a polite live region, so a screen reader hears the
          acknowledgement without the focus moving off the button.

          It is NOT rendered conditionally, and that is the whole point (07-07
          review, WR-01): a live region has to be in the accessibility tree
          BEFORE its contents change for the change to be announced, and a
          region inserted in the same commit as its text is the case VoiceOver
          and NVDA routinely announce as nothing at all. This line is the only
          affordance an operator who cannot see the screen has for "the press
          landed", so it must not be the one that goes unspoken.

          Screen-only for free: it sits inside `.report-actions`, which
          `report.css` hides outright under `@media print`. Empty, it collapses
          to no vertical space (`.report-actions p[role='status']:empty`). */}
      <p className="muted hint" role="status">
        {message ?? ''}
      </p>
    </>
  );
}
