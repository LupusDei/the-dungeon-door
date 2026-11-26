/**
 * Wandering monsters (an original rule, CC0: 5.2 leaves them to the DM). In a dungeon, every half hour of
 * game time the dice roll a d6, and on a 1 a band of wandering monsters comes: a low-difficulty SRD 5.2
 * encounter for the party's levels. Noise (a fight just ended, a trap sprung) brings a check at once and
 * makes it 2 in 6; a wanderer's spoor in a corridor makes the check on the way 2 in 6 too. A rest gets one
 * check before it starts; wanderers who come interrupt it. They roll an attitude like any foes met.
 */
import { buildEncounter } from '../rules/encounter.ts';
import type { Rng } from '../rules/rng.ts';
import { foesNamed } from './hooks.ts';

export const CHECK_EVERY = 30 * 60;

export interface Wanderers { monsters: string[]; line: string }

/** How many checks this much more time brings, and the seconds toward the next. */
export function checksDue(since: number, seconds: number): { checks: number; since: number } {
  const total = since + seconds;
  return { checks: Math.floor(total / CHECK_EVERY), since: total % CHECK_EVERY };
}

/** One check: a d6 at or under `chance` brings a low band for these levels. */
export function wanderingRoll(rng: Rng, levels: readonly number[], chance: number): Wanderers | null {
  const roll = rng.die(6);
  if (roll > chance) return null;
  const { monsters } = buildEncounter(rng, levels, 'low');
  return { monsters, line: `Wandering monsters (d6: ${roll}): ${foesNamed(monsters)}.` };
}

/** The checks due, the first at 2 in 6 after noise (which brings one at once); the first band to come, or null. */
export function wanderingChecks(rng: Rng, levels: readonly number[], checks: number, noise: boolean): Wanderers | null {
  for (let i = 0; i < Math.max(checks, noise ? 1 : 0); i++) {
    const came = wanderingRoll(rng, levels, i === 0 && noise ? 2 : 1);
    if (came) return came;
  }
  return null;
}
