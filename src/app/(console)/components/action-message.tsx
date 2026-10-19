import Link from 'next/link';

import type { ControlState } from './action-state';

/**
 * ONE ACTION'S OUTCOME, RENDERED THE SAME WAY EVERYWHERE (WR-10).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THERE USED TO BE TWO `Message` COMPONENTS — one in `draft-card.tsx` and  │
 * │ one in `cadence-controls.tsx` — under one name, with one shared state    │
 * │ type, in a phase whose thesis is that a second correct copy IS the       │
 * │ defect. They were not even correct copies: `CadenceControls` rendered    │
 * │ `state.fixes` and `DraftCard` silently dropped it.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Nothing was visibly broken, because no approval outcome sets `fixes` today.
 * That is precisely the CR-02 shape: two copies that agree until one of them is
 * widened. The moment an approval is gated on an unmet onboarding condition —
 * the obvious next candidate, and the exact thing `resumeCadenceGatedState`
 * already does for resume — the link would appear on the cadence controls and
 * vanish from the draft card three elements below it, on the same screen.
 *
 * ── `role="alert"` FOR A FAILURE, `role="status"` FOR A SUCCESS ─────────────
 *
 * A screen-reader user who just killed a cadence must be told; interrupting
 * them for a confirmation they asked for is the wrong politeness. That split
 * was already identical in both copies, and now it is identical by construction.
 *
 * ── THE FIX LINKS LIVE INSIDE THE ANNOUNCED REGION, ON BOTH BRANCHES ────────
 *
 * Inside the `role` element rather than after it, so a screen-reader user hears
 * the refusal AND the way to clear it as one message rather than the refusal
 * alone with the remedy left silently in the DOM.
 *
 * On BOTH branches, because `ControlState.fixes` is declared on the state and
 * not on one arm of it. Today only the gated-resume path populates it, and that
 * path reports through `success` — a refusal phrased as an outcome rather than
 * an error. A future refusal that lands on `error` instead must not silently
 * lose its links for having chosen the other field.
 *
 * NEVER A "DO IT ANYWAY" AFFORDANCE (T-5-10). Everything in `fixes` goes to a
 * page that CLEARS a condition; there is no override, because the gate exists
 * precisely for the moment somebody is in a hurry.
 */
export function ActionMessage({ state }: { state: ControlState }) {
  const fixes = state.fixes ?? [];

  if (state.error) {
    return (
      <p className="error" role="alert">
        {state.error}
        <FixLinks fixes={fixes} />
      </p>
    );
  }

  if (state.success) {
    return (
      <p className="muted" role="status">
        {state.success}
        <FixLinks fixes={fixes} />
      </p>
    );
  }

  return null;
}

function FixLinks({ fixes }: { fixes: ReadonlyArray<{ href: string; label: string }> }) {
  return (
    <>
      {fixes.map((fix) => (
        <span key={fix.href}>
          {' '}
          <Link href={fix.href}>{fix.label}</Link>
        </span>
      ))}
    </>
  );
}
