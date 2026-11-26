/**
 * The combat math, SRD 5.2: d20 tests, attack rolls, damage, saving throws, death saves, healing and
 * conditions. Pure functions: a Combatant in, a new Combatant out.
 */
import type { Ability } from './abilities.ts';
import type { Combatant, Condition } from './combatant.ts';
import { parseDice, rollDice } from './dice.ts';
import type { Rng } from './rng.ts';
import { require } from './violation.ts';

export type Mode = 'normal' | 'advantage' | 'disadvantage';
export type Cover = 'none' | 'half' | 'three-quarters' | 'total';
export interface D20 { natural: number; rolls: number[]; total: number }
export interface RollOptions {
  /** A d20 already rolled (a player's vote); it is the first die. */
  natural?: number;
  advantage?: boolean;
  disadvantage?: boolean;
  cover?: Cover;
}
export interface AttackResult {
  attacker: string; target: string; attack: string;
  roll: D20; ac: number; hit: boolean; critical: boolean; damage: number;
}

const COVER_BONUS: Record<Exclude<Cover, 'total'>, number> = { none: 0, half: 2, 'three-quarters': 5 };
const INCAPACITATING: readonly Condition[] = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
const ATTACKER_DISADVANTAGE: readonly Condition[] = ['blinded', 'frightened', 'poisoned', 'prone', 'restrained'];
const TARGET_GRANTS_ADVANTAGE: readonly Condition[] = ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'];
const FAILS_STR_DEX_SAVES: readonly Condition[] = ['paralyzed', 'petrified', 'stunned', 'unconscious'];
const AUTO_CRIT_IN_MELEE: readonly Condition[] = ['paralyzed', 'unconscious'];

const has = (c: Combatant, conditions: readonly Condition[]) => c.conditions.some((x) => conditions.includes(x));

export const modeOf = (advantage: boolean, disadvantage: boolean): Mode =>
  advantage === disadvantage ? 'normal' : advantage ? 'advantage' : 'disadvantage';

export function rollD20(rng: Rng, bonus: number, mode: Mode, natural?: number): D20 {
  const first = natural ?? rng.die(20);
  const rolls = mode === 'normal' ? [first] : [first, rng.die(20)];
  const kept = mode === 'disadvantage' ? Math.min(...rolls) : Math.max(...rolls);
  return { natural: kept, rolls, total: kept + bonus };
}

function coverBonus(cover: Cover = 'none'): number {
  require(cover !== 'total', 'a target behind total cover cannot be targeted');
  return COVER_BONUS[cover];
}

function attackMode(attacker: Combatant, target: Combatant, ranged: boolean, options: RollOptions): Mode {
  const proneTarget = target.conditions.includes('prone');
  const advantage = options.advantage || attacker.conditions.includes('invisible') || has(target, TARGET_GRANTS_ADVANTAGE) || (proneTarget && !ranged);
  const disadvantage = options.disadvantage || has(attacker, ATTACKER_DISADVANTAGE) || target.conditions.includes('invisible') || (proneTarget && ranged);
  return modeOf(advantage, disadvantage);
}

/** Damage after the target's immunity, resistance (halved, rounded down) or vulnerability (doubled). */
export function damageAfterDefenses(target: Combatant, amount: number, type: string): number {
  if (target.immunities.includes(type)) return 0;
  if (target.resistances.includes(type)) return Math.floor(amount / 2);
  return target.vulnerabilities.includes(type) ? amount * 2 : amount;
}

const dead = (c: Combatant): Combatant => ({ ...c, hp: 0, status: 'dead' });

function failDeathSaves(c: Combatant, failures: number): Combatant {
  const total = c.deathSaves.failures + failures;
  return total >= 3 ? dead(c) : { ...c, status: 'dying', deathSaves: { ...c.deathSaves, failures: total } };
}

/** Applies damage already adjusted for defenses: monsters die at 0 HP, heroes fall and make death saves. */
export function takeDamage(target: Combatant, amount: number, critical: boolean): Combatant {
  if (amount <= 0) return target;
  if (target.hp === 0) return amount >= target.maxHp ? dead(target) : failDeathSaves(target, critical ? 2 : 1);
  const hp = target.hp - amount;
  if (hp > 0) return { ...target, hp };
  if (target.side === 'foes' || -hp >= target.maxHp) return dead(target);
  return { ...addCondition(target, 'unconscious'), hp: 0, status: 'dying', deathSaves: { successes: 0, failures: 0 } };
}

export function attackRoll(rng: Rng, attacker: Combatant, attackName: string, target: Combatant, options: RollOptions): { result: AttackResult; target: Combatant } {
  require(attacker.status === 'up' && !has(attacker, INCAPACITATING), `${attacker.name} cannot act`);
  require(target.status !== 'dead', `${target.name} is already dead`);
  const attack = attacker.attacks.find((a) => a.name === attackName);
  require(attack !== undefined, `${attacker.name} has no attack ${attackName}`);
  const ac = target.ac + coverBonus(options.cover);
  const mode = attackMode(attacker, target, attack.ranged, options);
  const roll = rollD20(rng, attack.bonus, mode, options.natural);
  const hit = roll.natural === 20 || (roll.natural !== 1 && roll.total >= ac);
  const critical = hit && (roll.natural === 20 || (!attack.ranged && has(target, AUTO_CRIT_IN_MELEE)));
  const damage = hit
    ? attack.damage
      .filter((d) => !d.advantageOnly || mode === 'advantage')
      .reduce((sum, d) => sum + damageAfterDefenses(target, rollDice(rng, parseDice(d.dice), { critical }).total, d.type), 0)
    : 0;
  const result = { attacker: attacker.id, target: target.id, attack: attack.name, roll, ac, hit, critical, damage };
  return { result, target: takeDamage(target, damage, critical) };
}

export function savingThrow(rng: Rng, target: Combatant, ability: Ability, dc: number, options: RollOptions): { roll: D20 | null; success: boolean } {
  const physical = ability === 'str' || ability === 'dex';
  if (physical && has(target, FAILS_STR_DEX_SAVES)) return { roll: null, success: false };
  const dex = ability === 'dex';
  const mode = modeOf(!!options.advantage, !!options.disadvantage || (dex && target.conditions.includes('restrained')));
  const roll = rollD20(rng, target.saveBonuses[ability] + (dex ? coverBonus(options.cover) : 0), mode, options.natural);
  return { roll, success: roll.total >= dc };
}

const revived = (c: Combatant, hp: number): Combatant =>
  ({ ...removeCondition(c, 'unconscious'), hp, status: 'up', deathSaves: { successes: 0, failures: 0 } });

/** One death save for a dying hero: 10+ succeeds, a 1 is two failures, a 20 is back up with 1 HP. */
export function deathSave(rng: Rng, c: Combatant, natural?: number): Combatant {
  require(c.status === 'dying', `${c.name} is not dying`);
  const face = natural ?? rng.die(20);
  if (face === 20) return revived(c, 1);
  if (face < 10) return failDeathSaves(c, face === 1 ? 2 : 1);
  const successes = c.deathSaves.successes + 1;
  return successes >= 3
    ? { ...c, status: 'stable', deathSaves: { successes: 0, failures: 0 } }
    : { ...c, deathSaves: { ...c.deathSaves, successes } };
}

export function heal(c: Combatant, amount: number): Combatant {
  require(c.status !== 'dead', `${c.name} is dead`);
  return revived(c, Math.min(c.maxHp, c.hp + amount));
}

export function addCondition(c: Combatant, condition: Condition): Combatant {
  if (c.conditions.includes(condition) || c.conditionImmunities.includes(condition)) return c;
  return { ...c, conditions: [...c.conditions, condition] };
}

export const removeCondition = (c: Combatant, condition: Condition): Combatant => ({ ...c, conditions: c.conditions.filter((x) => x !== condition) });
