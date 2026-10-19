/**
 * The production jitter draw, in the one module allowed to hold it.
 *
 * ── WHY THIS IS A FILE AND NOT A DEFAULT ARGUMENT ───────────────────────────
 *
 * Every scheduling function in this engine takes `jitterMinutes` as an injected
 * parameter, and a standing grep in `tests/cadence-*.test.ts` asserts that
 * `window.ts`, `materialize.ts`, `rewindow.ts` and `resume.ts` contain no call
 * to the global random source at all. That rule is what makes CAD-02's
 * determinism assertable: a function that reached for randomness would have a
 * dependency its signature does not admit to, and two runs with the same inputs
 * could not be compared.
 *
 * But something has to actually draw the number in production, and by the time
 * this was needed there were three callers wanting the same one (the tick, the
 * shared resume path, and the console preview to come). Three inlined copies of
 * `floor(random × (bound + 1))` is three places the bound can drift from
 * `JITTER_MAX_MINUTES`, and drift there is invisible: the schedule still looks
 * plausible, just not like the one the constant describes.
 *
 * So the draw lives here, once, with the bound read from the constant — and the
 * pure modules stay provably free of it.
 */
import { JITTER_MAX_MINUTES } from './constants';

/**
 * A whole number of minutes in [0, JITTER_MAX_MINUTES], inclusive at both ends.
 *
 * Inclusive of the bound because `JITTER_MAX_MINUTES` reads as "up to ten
 * minutes", and a draw that could never produce ten would make the constant
 * mean nine. The spread is cosmetic either way — its job is that a client's
 * whole morning queue does not share a timestamp to the second — so the honest
 * reading of the name wins.
 */
export function randomJitterMinutes(): number {
  return Math.floor(Math.random() * (JITTER_MAX_MINUTES + 1));
}
