/**
 * Checks and saving throws outside combat (SRD 5.2). In a group check every hero rolls, with their
 * vote's d20 when they voted, and the party succeeds if at least half do. In "best" mode one hero rolls,
 * and a hero proficient in the skill or tool Helps (Advantage): the check is made by those who picked the
 * choice it belongs to (`backers`), the one of them with the best bonus rolling and the others of them
 * helping. With nobody standing who picked it, the hero with the best bonus in the whole party rolls and
 * anyone may Help. A natural 20 or 1 is not automatic. A check against a monster takes its DC from the
 * monster (5.2 has no contests). Tools, Expertise, Advantage, Disadvantage and Exhaustion come from
 * lib/rules/checks.ts.
 */
import { abilityCheck, checkBonus, dcAgainst, hasTool } from '../rules/checks.ts';
import { parseDice, rollDice } from '../rules/dice.ts';
import { hasCondition, withCondition } from '../rules/conditions.ts';
import { resisted } from '../rules/defenses.ts';
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
  /** The table rolled this d20 for the hero: it was not the d20 of their vote. False for a hero who rolled nothing. */
  fresh: boolean;
}
/** helpers: the names of the heroes whose Help gave the roller Advantage ("best" mode); empty otherwise. */
export interface GroupRoll { rolls: Roll[]; success: boolean; sheets: Hero[]; lines: string[]; helpers: string[] }

/**
 * One d20 the engine rolled for a hero outside a fight, in numbers (play/result.ts): for the party's choice
 * (a check, a save, a parley, a trap) or for the hero's own written action.
 */
export interface TurnCheck {
  for: 'choice' | 'own';
  playerId: string;
  /** "Persuasion", "Dexterity save", "Thieves' Tools": the roll as the dice log names it. */
  name: string;
  natural: number; dice: number[]; mode: Mode; bonus: number; total: number; dc: number; success: boolean;
  fresh: boolean;
  helpers: string[];
  /** What a success did beyond passing ("Improvised damage 2 slashing"), or null. */
  detail: string | null;
  /** The words the player wrote, for their own action; null for the party's choice. */
  text: string | null;
  /** The engine line this roll produced, exactly as it is in the turn's lines. */
  line: string;
}

export const signed = (n: number) => (n < 0 ? `- ${-n}` : `+ ${n}`);
const standing = (h: Hero) => h.sheet.hp > 0;

/** The DC: the DM's, or the monster's when the check is against one. */
export function dcOf(hook: RollHook): number {
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
  const resilient = hook.condition === 'poisoned' && hero.sheet.traits.includes('dwarven-resilience'); // 5.2 Dwarven Resilience
  const mode = modeOf(!!hook.advantage || resilient, !!hook.disadvantage || (hook.ability === 'dex' && hasCondition(hero.sheet, 'restrained')));
  return { ...rollD20(rng, bonus, mode, natural), bonus, mode };
}

function rollFor(hero: Hero, hook: RollHook, vote: Thrown, rng: Rng, helped = false): Roll {
  if (cannotSee(hero, hook)) return { ...downRoll(hero), blind: true };
  const { natural, rolls, total, bonus, mode } = d20For(hero, hook, vote.natural, rng, helped);
  return { playerId: hero.playerId, name: hero.sheet.name, natural, dice: rolls, mode, bonus, total, success: total >= dcOf(hook), fresh: vote.fresh };
}

const downRoll = (h: Hero): Roll => ({ playerId: h.playerId, name: h.sheet.name, natural: null, dice: [], mode: 'normal', bonus: 0, total: null, success: false, fresh: false });

/** "14 (Advantage over 3)". */
function diceText(roll: Roll): string {
  if (roll.mode === 'normal') return `${roll.natural}`;
  const [first, second] = roll.dice;
  const dropped = first === roll.natural ? second : first;
  return `${roll.natural} (${roll.mode === 'advantage' ? 'Advantage' : 'Disadvantage'} over ${dropped})`;
}

/** The roll's line in the dice log, under the name the log gives the check ("Athletics", "Dexterity save"). */
function rollLine(roll: Roll, name: string, dc: number): string {
  if (roll.blind) return `${roll.name} cannot see and fails`;
  if (roll.natural === null) return `${roll.name} is down and fails`;
  return `${roll.name}: ${name} ${diceText(roll)} ${signed(roll.bonus)} = ${roll.total} vs DC ${dc}, ${roll.success ? 'success' : 'failure'}`;
}

const lineOf = (roll: Roll, hook: RollHook): string => rollLine(roll, rollName(hook), dcOf(hook));

/** "Ash helps: Advantage", "Ash, Cleo help: Advantage". */
export const helpLine = (names: readonly string[]): string => `${names.join(', ')} ${names.length > 1 ? 'help' : 'helps'}: Advantage`;

/** The d20s of a group roll as checks for the party's choice: one for each hero who rolled (the down and the blind rolled nothing). */
export function checksOf(rolled: Pick<GroupRoll, 'rolls' | 'helpers'>, name: string, dc: number): TurnCheck[] {
  return rolled.rolls.flatMap((r): TurnCheck[] => (r.natural === null || r.total === null ? [] : [{
    for: 'choice', playerId: r.playerId, name, natural: r.natural, dice: [...r.dice], mode: r.mode, bonus: r.bonus, total: r.total, dc,
    success: r.success, fresh: r.fresh, helpers: [...rolled.helpers], detail: null, text: null, line: rollLine(r, name, dc),
  }]));
}

/** Damage from a save: rolled once; a failure takes it all, a success half. */
function applyDamage(heroes: Hero[], rolls: Roll[], hook: RollHook, rng: Rng): { sheets: Hero[]; line: string | null } {
  if (hook.kind !== 'save' || !hook.damage) return { sheets: heroes, line: null };
  const damage = rollDice(rng, parseDice(hook.damage)).total;
  const share = (i: number) => (rolls[i].natural === null ? 0 : rolls[i].success ? Math.floor(damage / 2) : damage);
  const hurt = heroes.map((h, i) => ({ hero: h, taken: hook.damageType ? resisted(h.sheet, share(i), hook.damageType) : share(i) }));
  const sheets = hurt.map(({ hero, taken }) => ({ ...hero, sheet: damageHero(hero.sheet, taken) }));
  const taken = hurt.filter((h) => h.taken > 0).map((h) => `${h.hero.sheet.name} takes ${h.taken}`);
  return { sheets, line: `Damage ${damage}${hook.damageType ? ` ${hook.damageType}` : ''}: ${taken.join(', ')}` };
}

/** A hero's d20: the one they threw with their vote, or a fresh one the table rolls for them. */
interface Thrown { natural: number; fresh: boolean }
const voteOf = (votes: Readonly<Record<string, number>>, hero: Hero, rng: Rng): Thrown =>
  (Object.hasOwn(votes, hero.playerId) ? { natural: votes[hero.playerId], fresh: false } : { natural: rng.die(20), fresh: true });

/** A failed save brings the hook's condition: for its minutes, or until a long rest. */
function afflict(heroes: Hero[], rolls: Roll[], hook: RollHook): Hero[] {
  if (hook.kind !== 'save' || !hook.condition) return heroes;
  const until = hook.minutes ? { kind: 'time' as const, left: hook.minutes * 60 } : { kind: 'long-rest' as const };
  return heroes.map((h, i) => (rolls[i].natural === null || rolls[i].success ? h : { ...h, sheet: withCondition(h.sheet, { condition: hook.condition!, until }) }));
}

/** Help (5.2): a hero proficient in the skill or tool gives the one who rolls Advantage. */
const canHelp = (hero: Hero, hook: Extract<RollHook, { kind: 'check' }>) =>
  (!!hook.skill && hero.sheet.skills.includes(hook.skill)) || (!!hook.tool && hasTool(hero.sheet, hook.tool));

/**
 * One hero rolls for the party. Those standing who picked the choice (`backers`) make the check: the best
 * bonus among them rolls (one who can see, if any of them can) and the others of them Help. With no backer
 * standing, the whole standing party is the pool.
 */
function bestRoll(heroes: Hero[], hook: Extract<RollHook, { kind: 'check' }>, votes: Readonly<Record<string, number>>, rng: Rng, backers: readonly string[]): GroupRoll {
  const up = heroes.filter(standing);
  if (up.length === 0) return { rolls: heroes.map(downRoll), success: false, sheets: heroes, lines: heroes.map((h) => `${h.sheet.name} is down and fails`), helpers: [] };
  const backing = up.filter((h) => backers.includes(h.playerId));
  const pool = backing.length ? backing : up;
  const seeing = pool.filter((h) => !cannotSee(h, hook));
  const roller = (seeing.length ? seeing : pool).reduce((best, h) => (checkBonus(h.sheet, hook).bonus > checkBonus(best.sheet, hook).bonus ? h : best));
  const helpers = pool.filter((h) => h !== roller && canHelp(h, hook)).map((h) => h.sheet.name);
  const roll = rollFor(roller, hook, voteOf(votes, roller, rng), rng, helpers.length > 0);
  const help = helpers.length ? [helpLine(helpers)] : [];
  return { rolls: [roll], success: roll.success, sheets: heroes, lines: [...help, lineOf(roll, hook)], helpers };
}

/**
 * The heroes make the check or save: with `votes[playerId]` as the d20, or a fresh one from `rng`.
 * `backers` are the players who picked the choice this roll is for; they matter only in "best" mode.
 */
export function groupRoll(heroes: Hero[], hook: RollHook, votes: Readonly<Record<string, number>>, rng: Rng, backers: readonly string[] = []): GroupRoll {
  if (hook.kind === 'check' && hook.mode === 'best') return bestRoll(heroes, hook, votes, rng, backers);
  const rolls = heroes.map((h): Roll => (standing(h) ? rollFor(h, hook, voteOf(votes, h, rng), rng) : downRoll(h)));
  const damaged = applyDamage(heroes, rolls, hook, rng);
  const { sheets, line } = { ...damaged, sheets: afflict(damaged.sheets, rolls, hook) };
  const successes = rolls.filter((r) => r.success).length;
  return { rolls, success: successes * 2 >= heroes.length, sheets, lines: [...rolls.map((r) => lineOf(r, hook)), ...(line ? [line] : [])], helpers: [] };
}
