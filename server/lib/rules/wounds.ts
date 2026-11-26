/**
 * How hurt a foe looks, without its hit points (Robert: "players should see that they are making progress
 * without knowing exactly how much"). Six rungs of vigor by the share of hit points left; at half or less a
 * creature is Bloodied, as in the 2024 rules. The words suit the body: flesh bleeds, the undead crumble,
 * constructs crack, oozes dissolve.
 */

import { derivedRng } from './rng.ts';

export type Body = 'flesh' | 'undead' | 'construct' | 'ooze';

export const WOUND_RUNGS = 6;

/** Above each share, one rung more: over 3/4 Scratched, over 1/2 Bleeding, over 1/4 Bloodied, over 1/10 Staggering. */
const FLOORS = [3 / 4, 1 / 2, 1 / 4, 1 / 10];

/** From the rung of full vigor down to 0 (dead or down). */
const LADDERS: Readonly<Record<Body, readonly string[]>> = {
  flesh: ['Unhurt', 'Scratched', 'Bleeding', 'Bloodied', 'Staggering', 'Gasping', 'Dead'],
  undead: ['Whole', 'Torn', 'Gouged', 'Crumbling', 'Falling apart', 'Coming undone', 'Destroyed'],
  construct: ['Intact', 'Scuffed', 'Dented', 'Cracked', 'Breaking', 'Failing', 'Destroyed'],
  ooze: ['Whole', 'Rippling', 'Seeping', 'Shrinking', 'Sloughing', 'Dissolving', 'Destroyed'],
};

/** 6 unhurt, 5 scratched, 4 bleeding, 3 bloodied (half or less), 2 staggering, 1 gasping, 0 at 0 HP. */
export function vigorOf(hp: number, maxHp: number): number {
  if (hp <= 0) return 0;
  if (hp >= maxHp) return WOUND_RUNGS;
  return 1 + FLOORS.filter((floor) => hp / maxHp > floor).length;
}

/** The share of hit points at each rung's lower edge, rung 1 (Gasping) up: a rung r holds shares above BOUNDS[r-1], up to BOUNDS[r]. */
const BOUNDS = [0, ...[...FLOORS].reverse(), 1];
const LEAST_SHOWN = 0.001;

/**
 * How full a foe's gauge looks, 0 to 1, fuzzy so that its hit points cannot be read off it (Robert: "make the
 * wound slider fuzzy so that discrete values are unknown"). Its share of hit points is bent inside its wound's
 * band by a curve seeded from `salt` (the foe in this fight) and the band: so the gauge stays inside the band
 * its wound word names, never rises as the foe is hurt, is the same for the same state, and differs from fight
 * to fight. Unhurt is full; down is empty.
 */
export function fillOf(hp: number, maxHp: number, salt: string): number {
  const rung = vigorOf(hp, maxHp);
  if (rung === 0 || rung === WOUND_RUNGS) return rung / WOUND_RUNGS;
  const [lo, hi] = [BOUNDS[rung - 1], BOUNDS[rung]];
  const bend = 2 ** ((derivedRng(rung, salt).die(1001) - 501) / 500); // 1/2 to 2
  const fill = lo + (hi - lo) * ((hp / maxHp - lo) / (hi - lo)) ** bend;
  return Math.max(LEAST_SHOWN, Math.round(fill * 1000) / 1000);
}

export const woundOf = (c: { hp: number; maxHp: number; body?: Body }): string => (c.body ? LADDERS[c.body] : LADDERS.flesh)[WOUND_RUNGS - vigorOf(c.hp, c.maxHp)];

/** A monster's body, from its SRD type ("Undead", "humanoid (goblinoid)"). */
export const bodyOf = (type: string): Body => [...(['undead', 'construct', 'ooze'] as const).filter((b) => type.toLowerCase().includes(b)), 'flesh' as const][0];
