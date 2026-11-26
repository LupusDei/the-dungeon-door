/**
 * SRD 5.2 monsters, the CR-to-XP table and encounter budgets, parsed once on first use (monsters.json
 * is large, so character generation never pays for it).
 */
import { z } from 'zod';
import crToXpJson from '../../data/srd/5.2/crToXp.json' with { type: 'json' };
import budgetsJson from '../../data/srd/5.2/encounterBudgets.json' with { type: 'json' };
import monstersJson from '../../data/srd/5.2/monsters.json' with { type: 'json' };
import { ABILITIES, type Ability, type AbilityScores, abilityModifier } from './abilities.ts';
import { type Power, powersOf, type Rider, riderOf } from './powers.ts';
import { once, parseTable } from './srd.ts';
import { lookup, require } from './violation.ts';

export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
];
export type Difficulty = 'low' | 'moderate' | 'high';

/** `advantageOnly`: extra damage the stat block grants only when the attack roll had Advantage. */
export interface DamageRoll { dice: string; type: string; advantageOnly?: true }
export interface MonsterAttack { name: string; bonus: number; ranged: boolean; damage: DamageRoll[]; rider?: Rider }
export interface Monster {
  id: string; name: string; size: string; type: string;
  ac: number; hp: number; hitDice: string; speed: number;
  abilities: AbilityScores; saveBonuses: Record<Ability, number>;
  resistances: string[]; vulnerabilities: string[]; immunities: string[]; conditionImmunities: string[];
  cr: number; xp: number;
  alignment: string;
  /** Skill bonuses from the stat block, by skill id ("stealth"). */
  skills: Record<string, number>;
  passivePerception: number;
  /** Feet of each special sense (0 without): darkvision sees darkness as dim light; blindsight and truesight see in it. */
  senses: { darkvision: number; blindsight: number; truesight: number };
  /** Its attack-roll actions. */
  attacks: MonsterAttack[];
  /** It can Disengage as a Bonus Action (a goblin's Nimble Escape): it flees without Opportunity Attacks. */
  disengages: boolean;
  /** Its save abilities: breath weapons, webs (powers.ts). */
  powers: Power[];
  /** The attacks its Multiattack makes in a turn, by name (two or more); [] without one. */
  multiattack: string[];
  /** With no attack and no power, what it does instead (its first action, else its reaction: Shriek, Bubble Dash); null otherwise. */
  idle: string | null;
}

const ref = z.object({ index: z.string() });
const damageTypes = z.array(z.string()).transform((ts) => ts.filter((t) => DAMAGE_TYPES.includes(t)));
/** A count, or "Number of Heads": the hydra starts with five (heads it grows and loses are not tracked). */
const headsOr = (count: string) => (/^\d+$/.test(count) ? Number(count) : 5);
const action = z.object({
  name: z.string(), desc: z.string(), attackBonus: z.number().optional(),
  actions: z.array(z.object({ actionName: z.string(), count: z.string().transform(headsOr) })).optional(),
  dc: z.object({ dcType: ref, dcValue: z.number(), successType: z.string() }).optional(),
  usage: z.object({ type: z.string(), minValue: z.number().optional(), times: z.number().optional() }).optional(),
  damage: z.array(z.object({ damageDice: z.string(), damageType: ref })).optional(),
});

const ADVANTAGE_ONLY = /if the attack roll had Advantage/;
const FLAT_DAMAGE = /Hit: (\d+) (\w+) damage/;

/** An attack that deals a flat amount ("Hit: 1 Slashing damage") has no dice in the table, only this text. */
function flatDamage(desc: string): DamageRoll[] {
  const stated = FLAT_DAMAGE.exec(desc);
  return stated ? [{ dice: stated[1], type: stated[2].toLowerCase() }] : [];
}

/** The last roll of an "…plus 2 (1d4) if the attack roll had Advantage" attack only counts with Advantage. */
function damageRolls(rolls: { damageDice: string; damageType: { index: string } }[], lastNeedsAdvantage: boolean): DamageRoll[] {
  return rolls.map((d, i) => {
    const roll: DamageRoll = { dice: d.damageDice, type: d.damageType.index };
    if (lastNeedsAdvantage && i === rolls.length - 1) roll.advantageOnly = true;
    return roll;
  });
}

const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
const MAKES = /makes (two|three|four|five) /;

/** The attacks a Multiattack lists, each as many times as listed; what is not an attack roll is left out. */
const listedAttacks = (multi: z.infer<typeof action>, attacks: readonly MonsterAttack[]): string[] =>
  (multi.actions ?? []).filter((r) => attacks.some((a) => a.name === r.actionName)).flatMap((r) => Array<string>(r.count).fill(r.actionName));

/**
 * The attack rolls of a Multiattack, by name: the listed attacks, each as many times as listed (what is not an
 * attack roll is left out), made up to the number the text says ("makes three Rend attacks") with the first
 * listed one, or with its usual attack when none is listed ("makes three attacks, using A or B").
 */
function multiattackOf(actions: readonly z.infer<typeof action>[], attacks: readonly MonsterAttack[]): string[] {
  const multi = actions.find((a) => a.name === 'Multiattack');
  if (!multi || attacks.length === 0) return [];
  const listed = listedAttacks(multi, attacks);
  const filler = listed[0] ?? (attacks.find((a) => !a.ranged) ?? attacks[0]).name;
  const stated = COUNTS[MAKES.exec(multi.desc)?.[1] ?? ''] ?? 0;
  const named = [...listed, ...Array<string>(Math.max(0, stated - listed.length)).fill(filler)];
  return named.length > 1 ? named : [];
}

const withRider = (a: z.infer<typeof action>) => {
  const rider = riderOf(a);
  return rider ? { rider } : {};
};

const SKILL = 'skill-';
/** "60 ft." → 60; absent → 0. */
const feet = (text: string | undefined) => (text ? parseInt(text, 10) : 0);

/** What a monster that can't harm anyone does on its turn: its first action, else its first reaction (a Shrieker's Shriek). */
const idleOf = (actions: readonly { name: string }[], reactions: readonly { name: string }[], harms: number): string | null =>
  (harms > 0 ? null : (actions[0] ?? reactions[0])?.name ?? null);

const monsterSchema = z.object({
  index: z.string(), name: z.string(), size: z.string(), type: z.string(),
  armorClass: z.array(z.object({ value: z.number() })).min(1), hitPoints: z.number(), hitDice: z.string(),
  speed: z.object({ walk: z.string() }),
  strength: z.number(), dexterity: z.number(), constitution: z.number(), intelligence: z.number(), wisdom: z.number(), charisma: z.number(),
  damageResistances: damageTypes, damageVulnerabilities: damageTypes, damageImmunities: damageTypes,
  conditionImmunities: z.array(ref), challengeRating: z.number(), xp: z.number(), alignment: z.string(),
  senses: z.object({ passivePerception: z.number(), darkvision: z.string().optional(), blindsight: z.string().optional(), truesight: z.string().optional() }),
  proficiencies: z.array(z.object({ value: z.number(), proficiency: ref })),
  actions: z.array(action).default([]),
  bonusActions: z.array(z.object({ desc: z.string() })).default([]),
  reactions: z.array(z.object({ name: z.string() })).default([]),
}).transform((m): Monster => {
  const abilities = { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma };
  const listed = new Map(m.proficiencies.map((p) => [p.proficiency.index, p.value]));
  const attacks = m.actions.filter((a) => a.attackBonus !== undefined).map((a) => ({
    name: a.name, bonus: a.attackBonus!, ranged: a.desc.startsWith('Ranged'),
    damage: a.damage ? damageRolls(a.damage, ADVANTAGE_ONLY.test(a.desc)) : flatDamage(a.desc),
    ...withRider(a),
  }));
  return {
    id: m.index, name: m.name, size: m.size, type: m.type,
    ac: m.armorClass[0].value, hp: m.hitPoints, hitDice: m.hitDice, speed: parseInt(m.speed.walk, 10),
    abilities,
    saveBonuses: Object.fromEntries(ABILITIES.map((a) => [a, listed.get(`saving-throw-${a}`) ?? abilityModifier(abilities[a])])) as Record<Ability, number>,
    resistances: m.damageResistances, vulnerabilities: m.damageVulnerabilities, immunities: m.damageImmunities,
    conditionImmunities: m.conditionImmunities.map((c) => c.index),
    cr: m.challengeRating, xp: m.xp, alignment: m.alignment,
    skills: Object.fromEntries([...listed].filter(([id]) => id.startsWith(SKILL)).map(([id, value]) => [id.slice(SKILL.length), value])),
    passivePerception: m.senses.passivePerception,
    senses: { darkvision: feet(m.senses.darkvision), blindsight: feet(m.senses.blindsight), truesight: feet(m.senses.truesight) },
    attacks, multiattack: multiattackOf(m.actions, attacks), powers: powersOf(m.actions),
    disengages: m.bonusActions.some((b) => /Disengage/.test(b.desc)),
    idle: idleOf(m.actions, m.reactions, attacks.length + powersOf(m.actions).length),
  };
});

/** "1/8" → 0.125, "2" → 2. */
function crValue(text: string): number {
  const [numerator, denominator = '1'] = text.split('/');
  return Number(numerator) / Number(denominator);
}

const crSchema = z.object({ challengeRating: z.string(), xp: z.number() })
  .transform((r) => [crValue(r.challengeRating), r.xp] as const);
const budgetSchema = z.object({ level: z.number(), low: z.number(), moderate: z.number(), high: z.number() });

interface Tables { monsters: Map<string, Monster>; xp: Map<number, number>; budgets: Map<number, Record<Difficulty, number>> }
const loaded = once((): Tables => ({
  monsters: new Map(parseTable('monsters', monsterSchema, monstersJson).map((m) => [m.id, m])),
  xp: new Map(parseTable('crToXp', crSchema, crToXpJson)),
  budgets: new Map(parseTable('encounterBudgets', budgetSchema, budgetsJson).map((b) => [b.level, b])),
}));

export const monsters = (): ReadonlyMap<string, Monster> => loaded().monsters;

export const monster = (id: string): Monster => lookup(loaded().monsters, id, 'monster');

export const xpForCr = (cr: number): number => lookup(loaded().xp, cr, 'challenge rating');

/** SRD 5.2: the XP of monsters a party can face, the sum of each character's budget for its level. */
export function encounterBudget(levels: readonly number[], difficulty: Difficulty): number {
  return levels.reduce((total, level) => {
    const budget = loaded().budgets.get(level);
    require(budget !== undefined, `there is no encounter budget for level ${level}`);
    return total + budget[difficulty];
  }, 0);
}
