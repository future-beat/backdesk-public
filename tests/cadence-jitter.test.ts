/**
 * `jitter.ts` is the ONLY place in the cadence engine that draws a random
 * number, and this suite is what makes that a fact rather than an intention.
 *
 * ── WHY A DIRECTORY-WIDE GREP AND NOT FOUR PER-FILE ONES ────────────────────
 *
 * The per-file greps already standing in `cadence-window.test.ts`,
 * `cadence-materialize.test.ts` and `cadence-rewindow.test.ts` name the module
 * they guard, so they guard exactly the modules somebody thought of. They did
 * not cover `consume-events.ts`, which for three plans carried a private
 * `defaultJitter()` that was byte-for-byte `randomJitterMinutes` — a second
 * place `JITTER_MAX_MINUTES` could drift from the constant, and drift there is
 * invisible: the schedule still looks plausible, just not like the one the
 * constant describes.
 *
 * This one enumerates the directory instead, so a module added next phase is
 * covered the moment it exists rather than the moment somebody remembers.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { JITTER_MAX_MINUTES } from '../src/core/cadence/constants';
import { randomJitterMinutes } from '../src/core/cadence/jitter';

const CADENCE_DIR = fileURLToPath(new URL('../src/core/cadence/', import.meta.url));

/** Every module in the engine except the one allowed to hold the draw. */
const GUARDED = readdirSync(CADENCE_DIR)
  .filter((name) => name.endsWith('.ts') && name !== 'jitter.ts')
  .sort();

describe('the global random source lives in jitter.ts and nowhere else', () => {
  it('finds the modules to guard — an empty list would pass vacuously', () => {
    expect(GUARDED.length).toBeGreaterThan(5);
    expect(GUARDED).toContain('consume-events.ts');
    expect(GUARDED).toContain('run-tick.ts');
  });

  it.each(GUARDED)('%s reaches for no randomness of its own', (name) => {
    const source = readFileSync(`${CADENCE_DIR}${name}`, 'utf8');

    // Split so this assertion cannot match itself if the file is ever read by
    // another grep in this repository — the idiom the rewindow suite uses.
    expect(source).not.toContain('Math.rand' + 'om');
  });

  it('is not a rule with no subject: jitter.ts does hold the draw', () => {
    const source = readFileSync(`${CADENCE_DIR}jitter.ts`, 'utf8');

    expect(source).toContain('Math.rand' + 'om');
  });
});

describe('randomJitterMinutes', () => {
  it('draws whole minutes inside [0, JITTER_MAX_MINUTES], inclusive at both ends', () => {
    // The bound is read from the constant rather than restated, which is the
    // drift the single-home rule exists to prevent.
    for (let i = 0; i < 500; i += 1) {
      const drawn = randomJitterMinutes();

      expect(Number.isInteger(drawn)).toBe(true);
      expect(drawn).toBeGreaterThanOrEqual(0);
      expect(drawn).toBeLessThanOrEqual(JITTER_MAX_MINUTES);
    }
  });
});
