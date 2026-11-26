/**
 * Checks and saving throws outside combat (SRD 5.2). In a group check every hero rolls, with their
 * vote's d20 when they voted, and the party succeeds if at least half do; in "best" mode the hero with the
 * best bonus rolls and anyone proficient in the skill or tool Helps (Advantage). A natural 20 or 1 is not
 * automatic. A check against a monster takes its DC from the monster (5.2 has no contests). Tools,
 * Expertise, Advantage, Disadvantage and Exhaustion come from lib/rules/checks.ts.
 */
import { abilityCheck, checkBonus, dcAgainst, hasTool } from '../rules/checks.ts';
import { parseDice, rollDice } from '../rules/dice.ts';
import { damageHero } from '../rules/dying.ts';
import { monster } from '../rules/monsters.ts';
import { d20Modifier } from '../rules/rests.ts';
import { type D20, type Mode, modeOf, rollD20 } from '../rules/resolve.ts';
import type { Sight } from '../rules/light.ts';
import type { Rng } from '../rules/rng.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { type RollHook, rollName } from './hooks.ts';

/** sight: how well the hero sees here (rules/light.ts); absent: clearly. */
export interface Hero { playerId: string; sheet: CharacterSheet; sight?: Sight }
export interface Roll {
  playerId: string; name: string;
  /** The d20 kept; null for a hero who is down. */
  natural: number | null; dice: number[]; mode: Mode; bonus: number; total: number | null; success: boolean;
  /** The check needed sight and the hero could not see: an automatic failure (5.2 Blinded). */
  blind?: true;
}
export interface GroupRoll { rolls: Roll[]; success: boolean; sheets: Hero[]; lines: string[] }

export const signed = (n: number) => (n < 0 ? `- ${-n}` : `+ ${n}`);
const standing = (h: Hero) => h.sheet.hp > 0;

/** The DC: the DM's, or the monster's when the check is against one. */
function dcOf(hook: RollHook): number {
  if (hook.kind === 'save') return hook.dc;
  return typeof hook.dc === 'number' ? hook.dc : dcAgainst(monster(hook.against!), hook);
}

/** Checks that need sight: in darkness they fail; in dim light Perception has Disadvantage (5.2 Lightly Obscured). */
const SIGHT_SKILLS = ['perception', 'investigation'];
const cannotSee = (hero: Hero, hook: RollHook) => hook.kind === 'check' && hero.sight === 'none' && SIGHT_SKILLS.includes(hook.skill ?? '');
const peering = (hero: Hero, hook: Extract<RollHook, { kind: 'check' }>) => hero.sight === 'dim' && hook.skill === 'perception';

function d20For(hero: Hero, hook: RollHook, natural: number, rng: Rng, helped: boolean): D20 & { bonus: number; mode: Mode } {
  if (hook.kind === 'check') return abilityCheck(rng, hero.sheet, hook, { natural, advantage: helped || !!hook.advantage, disadvantage: !!hook.disadvantage || peering(hero, hook) });
  const bonus = hero.sheet.saveBonuses[hook.ability] + d20Modifier(hero.sheet);
  const mode = modeOf(!!hook.advantage, !!hook.disadvantage);
  return { ...rollD20(rng, bonus, mode, natural), bonus, mode };
}

function rollFor(hero: Hero, hook: RollHook, vote: number, rng: Rng, helped = false): Roll {
  if (cannotSee(hero, hook)) return { ...downRoll(hero), blind: true };
  const { natural, rolls, total, bonus, mode } = d20For(hero, hook, vote, rng, helped);
  return { playerId: hero.playerId, name: hero.sheet.name, natural, dice: rolls, mode, bonus, total, success: total >= dcOf(hook) };
}

const downRoll = (h: Hero): Roll => ({ playerId: h.playerId, name: h.sheet.name, natural: null, dice: [], mode: 'normal', bonus: 0, total: null, success: false });

/** "14 (Advantage over 3)". */
function diceText(roll: Roll): string {
  if (roll.mode === 'normal') return `${roll.natural}`;
  const [first, second] = roll.dice;
  const dropped = first === roll.natural ? second : first;
  return `${roll.natural} (${roll.mode === 'advantage' ? 'Advantage' : 'Disadvantage'} over ${dropped})`;
}

function lineOf(roll: Roll, hook: RollHook): string {
  if (roll.blind) return `${roll.name} cannot see and fails`;
  if (roll.natural === null) return `${roll.name} is down and fails`;
  return `${roll.name}: ${rollName(hook)} ${diceText(roll)} ${signed(roll.bonus)} = ${roll.total} vs DC ${dcOf(hook)}, ${roll.success ? 'success' : 'failure'}`;
}

/** Damage from a save: rolled once; a failure takes it all, a success half. */
function applyDamage(heroes: Hero[], rolls: Roll[], hook: RollHook, rng: Rng): { sheets: Hero[]; line: string | null } {
  if (hook.kind !== 'save' || !hook.damage) return { sheets: heroes, line: null };
  const damage = rollDice(rng, parseDice(hook.damage)).total;
  const hurt = heroes.map((h, i) => ({ hero: h, taken: rolls[i].natural === null ? 0 : rolls[i].success ? Math.floor(damage / 2) : damage }));
  const sheets = hurt.map(({ hero, taken }) => ({ ...hero, sheet: damageHero(hero.sheet, taken) }));
  const taken = hurt.filter((h) => h.taken > 0).map((h) => `${h.hero.sheet.name} takes ${h.taken}`);
  return { sheets, line: `Damage ${damage}${hook.damageType ? ` ${hook.damageType}` : ''}: ${taken.join(', ')}` };
}

const voteOf = (votes: Readonly<Record<string, number>>, hero: Hero, rng: Rng) => (Object.hasOwn(votes, hero.playerId) ? votes[hero.playerId] : rng.die(20));

/** Help (5.2): a hero proficient in the skill or tool gives the one who rolls Advantage. */
const canHelp = (hero: Hero, hook: Extract<RollHook, { kind: 'check' }>) =>
  (!!hook.skill && hero.sheet.skills.includes(hook.skill)) || (!!hook.tool && hasTool(hero.sheet, hook.tool));

function bestRoll(heroes: Hero[], hook: Extract<RollHook, { kind: 'check' }>, votes: Readonly<Record<string, number>>, rng: Rng): GroupRoll {
  const up = heroes.filter(standing);
  if (up.length === 0) return { rolls: heroes.map(downRoll), success: false, sheets: heroes, lines: heroes.map((h) => `${h.sheet.name} is down and fails`) };
  const seeing = up.filter((h) => !cannotSee(h, hook));
  const roller = (seeing.length ? seeing : up).reduce((best, h) => (checkBonus(h.sheet, hook).bonus > checkBonus(best.sheet, hook).bonus ? h : best));
  const helpers = up.filter((h) => h !== roller && canHelp(h, hook));
  const roll = rollFor(roller, hook, voteOf(votes, roller, rng), rng, helpers.length > 0);
  const help = helpers.length ? [`${helpers.map((h) => h.sheet.name).join(', ')} ${helpers.length > 1 ? 'help' : 'helps'}: Advantage`] : [];
  return { rolls: [roll], success: roll.success, sheets: heroes, lines: [...help, lineOf(roll, hook)] };
}

/** The heroes make the check or save: with `votes[playerId]` as the d20, or a fresh one from `rng`. */
export function groupRoll(heroes: Hero[], hook: RollHook, votes: Readonly<Record<string, number>>, rng: Rng): GroupRoll {
  if (hook.kind === 'check' && hook.mode === 'best') return bestRoll(heroes, hook, votes, rng);
  const rolls = heroes.map((h): Roll => (standing(h) ? rollFor(h, hook, voteOf(votes, h, rng), rng) : downRoll(h)));
  const { sheets, line } = applyDamage(heroes, rolls, hook, rng);
  const successes = rolls.filter((r) => r.success).length;
  return { rolls, success: successes * 2 >= heroes.length, sheets, lines: [...rolls.map((r) => lineOf(r, hook)), ...(line ? [line] : [])] };
}
