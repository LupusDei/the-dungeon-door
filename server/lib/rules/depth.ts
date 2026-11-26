/**
 * Dungeon levels (Phase 5): a dungeon starts at the party's average level and may go a level deeper behind
 * each new door. Monsters, traps and treasure are stocked for the level (docs/rules-design.md).
 */
import type { Rng } from './rng.ts';

/** The chance in 100 that a new door leads a level deeper. */
export const DEEPER_IN_100 = 25;
export const MAX_DUNGEON_LEVEL = 20;

const clamp = (level: number) => Math.min(MAX_DUNGEON_LEVEL, Math.max(1, level));

/** The level a dungeon starts at: the living heroes' average level, rounded down (1 with none). */
export const startingLevel = (levels: readonly number[]): number =>
  clamp(Math.floor(levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length)));

/** The level beyond a new door: a d100 at or under DEEPER_IN_100 is a level deeper. */
export const deeper = (rng: Rng, level: number): number => clamp(rng.die(100) <= DEEPER_IN_100 ? level + 1 : level);

/** The levels an encounter for `size` heroes is built for at a dungeon level. */
export const atLevel = (size: number, level: number): number[] => Array<number>(Math.max(1, size)).fill(level);
