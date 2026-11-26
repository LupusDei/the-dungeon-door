/** Dice expressions as the SRD writes them ("2d6+5", "20d10 + 40", "d20", "5"). */
import type { Rng } from './rng.ts';
import { require } from './violation.ts';

export interface Dice { count: number; sides: number; bonus: number }

const DICE = /^(?:(\d*)d(\d+))?\s*(?:([+-])?\s*(\d+))?$/;

export function parseDice(text: string): Dice {
  const m = DICE.exec(text.trim());
  require(m !== null && text.trim() !== '', `not dice: ${text}`);
  const [, count, sides, sign, flat] = m;
  const bonus = Number(flat ?? 0) * (sign === '-' ? -1 : 1);
  return sides === undefined ? { count: 0, sides: 0, bonus } : { count: Number(count || 1), sides: Number(sides), bonus };
}

/** Rolls the dice; a critical hit rolls them twice and adds the bonus once. Never below 0. */
export function rollDice(rng: Rng, dice: Dice, options: { critical?: boolean } = {}): { total: number; faces: number[] } {
  const count = options.critical ? dice.count * 2 : dice.count;
  const faces = Array.from({ length: count }, () => rng.die(dice.sides));
  return { total: Math.max(0, faces.reduce((a, b) => a + b, dice.bonus)), faces };
}

export const averageDice = (dice: Dice): number => Math.floor((dice.count * (dice.sides + 1)) / 2) + dice.bonus;
