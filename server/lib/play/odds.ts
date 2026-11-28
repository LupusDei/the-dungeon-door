/**
 * How likely a hero's result was (docs/rules-design.md, "Experience from actions"). A hero learns most from
 * what was not supposed to happen: the long shot that landed, the sure thing that slipped. This is where
 * "not supposed to happen" becomes a number, from what the engine already rolled and recorded: the bonus, the
 * DC or armour class, and Advantage or Disadvantage.
 *
 * Pure: it rolls nothing and changes nothing. play/xp.ts turns the odds into XP.
 */
import type { D20, Mode } from '../rules/resolve.ts';
import type { CombatEvent } from '../rules/scene.ts';

/** One d20 that decided a hero's action this turn: whether it came good for the hero, and the chance it had of doing so (0 to 1). */
export interface HeroDie { playerId: string; success: boolean; chance: number }

const FACES = 20;
/** An attack roll can always miss (a natural 1) and always hit (a natural 20): SRD 5.2. */
const ATTACK_FLOOR = 1 / FACES;

/**
 * The chance that a d20 plus `bonus` reaches `target`. `attack`: an attack roll, which a natural 1 misses and a
 * natural 20 hits whatever the numbers; an ability check or a saving throw has neither.
 */
export function chanceOf(bonus: number, target: number, mode: Mode = 'normal', attack = false): number {
  const needed = target - bonus; // the face the die has to show
  const raw = (FACES + 1 - needed) / FACES;
  const one = attack ? Math.min(1 - ATTACK_FLOOR, Math.max(ATTACK_FLOOR, raw)) : Math.min(1, Math.max(0, raw));
  if (mode === 'advantage') return 1 - (1 - one) ** 2;
  return mode === 'disadvantage' ? one ** 2 : one;
}

/** The chance, before the roll, of what happened: the chance of success when it succeeded, the rest when it failed. */
export const likelihood = (die: Pick<HeroDie, 'success' | 'chance'>): number => (die.success ? die.chance : 1 - die.chance);

/** 1 chance in 10 or worse, 1 in 4 or worse, 9 in 10 or better. Anything between is plain. */
export const RARE = 0.1;
export const UNLIKELY = 0.25;
export const SURE = 0.9;
export type Rarity = 'rare' | 'unlikely' | 'plain' | 'sure';

/** A sum of twentieths lands a hair off its decimal; the bands are meant at the decimal. */
const HAIR = 1e-9;

/** Which band a result falls in, by the chance it had. */
export function rarityOf(chance: number): Rarity {
  if (chance <= RARE + HAIR) return 'rare';
  if (chance <= UNLIKELY + HAIR) return 'unlikely';
  return chance >= SURE - HAIR ? 'sure' : 'plain';
}

/**
 * How a recorded d20 was rolled, as far as its faces tell. Two different faces are Advantage when the higher
 * counted and Disadvantage when the lower did. Two equal faces, or one, read as a plain roll: the engine's
 * record of an attack (rules/resolve.ts AttackResult) keeps the faces and not the mode.
 */
export function modeRolled(roll: Pick<D20, 'natural' | 'rolls'>): Mode {
  if (roll.rolls.length < 2 || roll.rolls[0] === roll.rolls[1]) return 'normal';
  return roll.natural === Math.max(...roll.rolls) ? 'advantage' : 'disadvantage';
}

/** An ability check or a saving throw the hero rolled, against a DC. */
export const dieOfCheck = (c: { playerId: string; success: boolean; bonus: number; dc: number; mode: Mode }): HeroDie =>
  ({ playerId: c.playerId, success: c.success, chance: chanceOf(c.bonus, c.dc, c.mode) });

/** An attack roll (a weapon's or a spell's) against armour class. */
function dieOfAttack(playerId: string, r: { roll: D20; ac: number; hit: boolean }): HeroDie {
  return { playerId, success: r.hit, chance: chanceOf(r.roll.total - r.roll.natural, r.ac, modeRolled(r.roll), true) };
}

/**
 * The d20s that decided each hero's action in a round, read from the engine's own log (rules/scene.ts): a
 * weapon attack or a spell attack against armour class, and a foe's saving throw against a hero's spell,
 * where the hero's success is the foe's failure. A save nobody rolled (an immune foe, one that cannot save) is
 * no die. A reaction is not the hero's action, so an opportunity attack is left out.
 *
 * `isHero` says which actors are heroes; `saveDc` is a hero's spell save DC (null without spellcasting).
 */
export function diceOfRound(events: readonly CombatEvent[], isHero: (id: string) => boolean, saveDc: (id: string) => number | null): HeroDie[] {
  return events.flatMap((e): HeroDie[] => {
    if (!isHero(e.actor)) return [];
    if (e.kind === 'attack') return e.reaction ? [] : [dieOfAttack(e.actor, e.result)];
    if (e.kind !== 'spell') return [];
    const dc = saveDc(e.actor);
    return e.outcomes.flatMap((o): HeroDie[] => {
      if (o.attack) return [dieOfAttack(e.actor, o.attack)];
      if (!o.save?.roll || dc === null) return [];
      const saves = chanceOf(o.save.roll.total - o.save.roll.natural, dc, modeRolled(o.save.roll));
      return [{ playerId: e.actor, success: !o.save.success, chance: 1 - saves }];
    });
  });
}
