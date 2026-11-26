/**
 * Checks and saving throws outside combat (SRD 5.2): every hero rolls, with their vote's d20 when they
 * voted; a natural 20 or 1 is not automatic; the party succeeds if at least half the heroes do (Group
 * Check). Exhaustion costs 2 a level on every d20 test.
 */
import { abilityModifier } from '../rules/abilities.ts';
import { parseDice, rollDice } from '../rules/dice.ts';
import { exhaustionEffects } from '../rules/rests.ts';
import type { Rng } from '../rules/rng.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { ABILITY_NAMES, type RollHook, titleCase } from './hooks.ts';

export interface Hero { playerId: string; sheet: CharacterSheet }
export interface Roll { playerId: string; name: string; natural: number | null; bonus: number; total: number | null; success: boolean }
export interface GroupRoll { rolls: Roll[]; success: boolean; sheets: Hero[]; lines: string[] }

function bonusFor(sheet: CharacterSheet, hook: RollHook): number {
  const { d20 } = exhaustionEffects(sheet);
  if (hook.kind === 'save') return sheet.saveBonuses[hook.ability] + d20;
  const skilled = hook.skill && Object.hasOwn(sheet.skillBonuses, hook.skill);
  return (skilled ? sheet.skillBonuses[hook.skill!] : abilityModifier(sheet.abilityScores[hook.ability])) + d20;
}

const what = (hook: RollHook) =>
  hook.kind === 'save' ? `${ABILITY_NAMES[hook.ability]} save` : hook.skill ? titleCase(hook.skill) : ABILITY_NAMES[hook.ability];
const signed = (n: number) => (n < 0 ? `- ${-n}` : `+ ${n}`);

function rollFor(hero: Hero, hook: RollHook, natural: number): Roll {
  const bonus = bonusFor(hero.sheet, hook);
  const total = natural + bonus;
  return { playerId: hero.playerId, name: hero.sheet.name, natural, bonus, total, success: total >= hook.dc };
}

function lineOf(roll: Roll, hook: RollHook): string {
  if (roll.natural === null) return `${roll.name} is down and fails`;
  return `${roll.name}: ${what(hook)} ${roll.natural} ${signed(roll.bonus)} = ${roll.total} vs DC ${hook.dc}, ${roll.success ? 'success' : 'failure'}`;
}

/** Damage from a save: rolled once; a failure takes it all, a success half. */
function applyDamage(heroes: Hero[], rolls: Roll[], hook: RollHook, rng: Rng): { sheets: Hero[]; line: string | null } {
  if (hook.kind !== 'save' || !hook.damage) return { sheets: heroes, line: null };
  const damage = rollDice(rng, parseDice(hook.damage)).total;
  const hurt = heroes.map((h, i) => ({ hero: h, taken: rolls[i].natural === null ? 0 : rolls[i].success ? Math.floor(damage / 2) : damage }));
  const sheets = hurt.map(({ hero, taken }) => ({ ...hero, sheet: { ...hero.sheet, hp: Math.max(0, hero.sheet.hp - taken) } }));
  const taken = hurt.filter((h) => h.taken > 0).map((h) => `${h.hero.sheet.name} takes ${h.taken}`);
  return { sheets, line: `Damage ${damage}${hook.damageType ? ` ${hook.damageType}` : ''}: ${taken.join(', ')}` };
}

/** Every hero makes the check or save: with `votes[playerId]` as the d20, or a fresh one from `rng`. */
export function groupRoll(heroes: Hero[], hook: RollHook, votes: Readonly<Record<string, number>>, rng: Rng): GroupRoll {
  const rolls = heroes.map((h): Roll => (h.sheet.hp === 0
    ? { playerId: h.playerId, name: h.sheet.name, natural: null, bonus: 0, total: null, success: false }
    : rollFor(h, hook, Object.hasOwn(votes, h.playerId) ? votes[h.playerId] : rng.die(20))));
  const { sheets, line } = applyDamage(heroes, rolls, hook, rng);
  const successes = rolls.filter((r) => r.success).length;
  return { rolls, success: successes * 2 >= heroes.length, sheets, lines: [...rolls.map((r) => lineOf(r, hook)), ...(line ? [line] : [])] };
}
