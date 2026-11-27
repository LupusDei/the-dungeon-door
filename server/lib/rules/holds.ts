/**
 * Spells that hold a creature in a condition (SRD 5.2): Sleep, Hold Person, Hideous Laughter,
 * Blindness/Deafness and Hypnotic Pattern. A failed save puts a Hold on the target: the conditions the spell
 * brought, who cast it, and how it ends (a save at the end of each of the target's turns, any damage, or the
 * caster's concentration). Pure: a Combatant in, a new Combatant out. The rolls are scene.ts's.
 */
import type { Ability } from './abilities.ts';
import type { Combatant, Condition } from './combatant.ts';

export interface Hold {
  spellId: string;
  /** The caster's combatant id. A concentration spell's hold ends when the caster stops concentrating on it. */
  by: string;
  /** The conditions this hold brought: those the target did not have already and is not immune to. */
  conditions: Condition[];
  /** The save the target repeats at the end of each of its turns; null for none. */
  save: { ability: Ability; dc: number } | null;
  /** Any damage ends it. */
  brokenByHarm: boolean;
  /** Sleep: what a failed repeat save turns the hold into (it is then saved against no more). */
  deepens?: Condition[];
}

export interface HoldRule {
  conditions: Condition[];
  /** The target repeats the save at the end of each of its turns. */
  repeats: boolean;
  brokenByHarm: boolean;
  deepens?: Condition[];
  /** Only a creature of this type is affected (Hold Person: humanoid). */
  only?: string;
  /** A creature immune to this condition succeeds on the save (Sleep: creatures immune to Exhaustion do not sleep). */
  immuneIfImmuneTo?: Condition;
}

export const HOLDING_SPELLS: Readonly<Record<string, HoldRule>> = {
  sleep: { conditions: ['incapacitated'], repeats: true, brokenByHarm: true, deepens: ['unconscious'], immuneIfImmuneTo: 'exhaustion' },
  'hold-person': { conditions: ['paralyzed'], repeats: true, brokenByHarm: false, only: 'humanoid' },
  'hideous-laughter': { conditions: ['prone', 'incapacitated'], repeats: true, brokenByHarm: false },
  'blindness-deafness': { conditions: ['blinded'], repeats: true, brokenByHarm: false },
  'hypnotic-pattern': { conditions: ['charmed', 'incapacitated'], repeats: false, brokenByHarm: true },
};

export const holdRule = (spellId: string): HoldRule | undefined => HOLDING_SPELLS[spellId];

export const holdsOn = (c: Combatant): Hold[] => c.holds ?? [];

/** A hero has no creature type in a fight: heroes are humanoids. */
const typeOf = (c: Combatant) => (c.creatureType ?? 'humanoid').toLowerCase();

/** Whether the spell can take hold of this creature at all: its type, and the immunities that make it save. */
export function canBeHeld(c: Combatant, rule: HoldRule): boolean {
  if (rule.only && !typeOf(c).includes(rule.only)) return false;
  if (rule.immuneIfImmuneTo && c.conditionImmunities.includes(rule.immuneIfImmuneTo)) return false;
  return rule.conditions.some((x) => !c.conditionImmunities.includes(x));
}

const withHolds = (c: Combatant, holds: Hold[]): Combatant => {
  const { holds: _, ...rest } = c;
  return holds.length ? { ...rest, holds } : rest;
};

/** The conditions it has from something other than a spell's hold (a hit's rider, the dark). */
const unheld = (c: Combatant) => {
  const held = new Set(holdsOn(c).flatMap((h) => h.conditions));
  return c.conditions.filter((x) => !held.has(x));
};

/** Of `conditions`, those a hold claims: not ones it is immune to, nor ones something other than a hold gave it. */
const claimed = (c: Combatant, conditions: readonly Condition[]) => {
  const own = unheld(c);
  return conditions.filter((x) => !own.includes(x) && !c.conditionImmunities.includes(x));
};

const plus = (c: Combatant, conditions: readonly Condition[]) => [...c.conditions, ...conditions.filter((x) => !c.conditions.includes(x))];

/** The conditions another hold (or something else) still gives the creature are kept when one hold ends. */
function lift(c: Combatant, gone: readonly Hold[], kept: readonly Hold[]): Combatant {
  const still = new Set(kept.flatMap((h) => h.conditions));
  const lifted = new Set(gone.flatMap((h) => h.conditions).filter((x) => !still.has(x)));
  return withHolds({ ...c, conditions: c.conditions.filter((x) => !lifted.has(x)) }, [...kept]);
}

/** The spell takes hold: its conditions (less immunities and those it had from elsewhere), with how it ends. A second cast of the same spell by the same caster replaces the first. */
export function hold(c: Combatant, spellId: string, by: string, dc: number, ability: Ability): Combatant {
  const rule = HOLDING_SPELLS[spellId];
  const freed = release(c, (h) => h.spellId === spellId && h.by === by);
  const added = claimed(freed, rule.conditions);
  const h: Hold = {
    spellId, by, conditions: added, save: rule.repeats ? { ability, dc } : null, brokenByHarm: rule.brokenByHarm,
    ...(rule.deepens ? { deepens: rule.deepens } : {}),
  };
  return withHolds({ ...freed, conditions: plus(freed, added) }, [...holdsOn(freed), h]);
}

/** Ends the holds that match, and the conditions only they gave. */
export function release(c: Combatant, which: (h: Hold) => boolean): Combatant {
  const all = holdsOn(c);
  const gone = all.filter(which);
  return gone.length ? lift(c, gone, all.filter((h) => !which(h))) : c;
}

/** Damage ends the holds that any harm breaks (Sleep's, Hypnotic Pattern's). */
export const harmed = (c: Combatant): Combatant => release(c, (h) => h.brokenByHarm);

/**
 * The target's save at the end of its turn against a hold: a success ends it; a failure against Sleep turns
 * its drowsiness into sleep (Unconscious), and that is saved against no more.
 */
export function afterRepeatSave(c: Combatant, h: Hold, success: boolean): Combatant {
  const same = (x: Hold) => x.spellId === h.spellId && x.by === h.by;
  if (success) return release(c, same);
  if (!h.deepens) return c;
  const others = holdsOn(c).filter((x) => !same(x));
  const without = lift(c, [h], others);
  const added = claimed(without, h.deepens);
  const { deepens: _, ...rest } = h;
  return withHolds({ ...without, conditions: plus(without, added) }, [...others, { ...rest, conditions: added, save: null }]);
}

/** Holds whose caster no longer holds the spell by concentration end (`concentrating`: a caster's spell id, or null). */
export function heldByConcentration(c: Combatant, concentrating: (casterId: string) => string | null | undefined, concentration: (spellId: string) => boolean): Combatant {
  return release(c, (h) => concentration(h.spellId) && concentrating(h.by) !== undefined && concentrating(h.by) !== h.spellId);
}
