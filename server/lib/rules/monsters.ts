/**
 * SRD 5.2 monsters, the CR-to-XP table and encounter budgets, parsed once on first use (monsters.json
 * is large, so character generation never pays for it).
 */
import { z } from 'zod';
import crToXpJson from '../../data/srd/5.2/crToXp.json' with { type: 'json' };
import budgetsJson from '../../data/srd/5.2/encounterBudgets.json' with { type: 'json' };
import monstersJson from '../../data/srd/5.2/monsters.json' with { type: 'json' };
import { ABILITIES, type Ability, type AbilityScores, abilityModifier } from './abilities.ts';
import { parseTable } from './srd.ts';
import { lookup, require } from './violation.ts';

export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
];
export type Difficulty = 'low' | 'moderate' | 'high';

/** `advantageOnly`: extra damage the stat block grants only when the attack roll had Advantage. */
export interface DamageRoll { dice: string; type: string; advantageOnly?: true }
export interface MonsterAttack { name: string; bonus: number; ranged: boolean; damage: DamageRoll[] }
export interface Monster {
  id: string; name: string; size: string; type: string;
  ac: number; hp: number; hitDice: string; speed: number;
  abilities: AbilityScores; saveBonuses: Record<Ability, number>;
  resistances: string[]; vulnerabilities: string[]; immunities: string[]; conditionImmunities: string[];
  cr: number; xp: number;
  /** Attack-roll actions only; save-based actions (breath weapons) are left to the DM for now. */
  attacks: MonsterAttack[];
}

const ref = z.object({ index: z.string() });
const damageTypes = z.array(z.string()).transform((ts) => ts.filter((t) => DAMAGE_TYPES.includes(t)));
const action = z.object({
  name: z.string(), desc: z.string(), attackBonus: z.number().optional(),
  damage: z.array(z.object({ damageDice: z.string(), damageType: ref })).optional(),
});

const ADVANTAGE_ONLY = /if the attack roll had Advantage/;

/** The last roll of an "…plus 2 (1d4) if the attack roll had Advantage" attack only counts with Advantage. */
function damageRolls(rolls: { damageDice: string; damageType: { index: string } }[], lastNeedsAdvantage: boolean): DamageRoll[] {
  return rolls.map((d, i) => {
    const roll: DamageRoll = { dice: d.damageDice, type: d.damageType.index };
    if (lastNeedsAdvantage && i === rolls.length - 1) roll.advantageOnly = true;
    return roll;
  });
}

const monsterSchema = z.object({
  index: z.string(), name: z.string(), size: z.string(), type: z.string(),
  armorClass: z.array(z.object({ value: z.number() })).min(1), hitPoints: z.number(), hitDice: z.string(),
  speed: z.object({ walk: z.string() }),
  strength: z.number(), dexterity: z.number(), constitution: z.number(), intelligence: z.number(), wisdom: z.number(), charisma: z.number(),
  damageResistances: damageTypes, damageVulnerabilities: damageTypes, damageImmunities: damageTypes,
  conditionImmunities: z.array(ref), challengeRating: z.number(), xp: z.number(),
  proficiencies: z.array(z.object({ value: z.number(), proficiency: ref })),
  actions: z.array(action).default([]),
}).transform((m): Monster => {
  const abilities = { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma };
  const listed = new Map(m.proficiencies.map((p) => [p.proficiency.index, p.value]));
  return {
    id: m.index, name: m.name, size: m.size, type: m.type,
    ac: m.armorClass[0].value, hp: m.hitPoints, hitDice: m.hitDice, speed: parseInt(m.speed.walk, 10),
    abilities,
    saveBonuses: Object.fromEntries(ABILITIES.map((a) => [a, listed.get(`saving-throw-${a}`) ?? abilityModifier(abilities[a])])) as Record<Ability, number>,
    resistances: m.damageResistances, vulnerabilities: m.damageVulnerabilities, immunities: m.damageImmunities,
    conditionImmunities: m.conditionImmunities.map((c) => c.index),
    cr: m.challengeRating, xp: m.xp,
    attacks: m.actions.filter((a) => a.attackBonus !== undefined).map((a) => ({
      name: a.name, bonus: a.attackBonus!, ranged: a.desc.startsWith('Ranged'),
      damage: damageRolls(a.damage ?? [], ADVANTAGE_ONLY.test(a.desc)),
    })),
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
let tables: Tables | null = null;

function loaded(): Tables {
  tables ??= {
    monsters: new Map(parseTable('monsters', monsterSchema, monstersJson).map((m) => [m.id, m])),
    xp: new Map(parseTable('crToXp', crSchema, crToXpJson)),
    budgets: new Map(parseTable('encounterBudgets', budgetSchema, budgetsJson).map((b) => [b.level, b])),
  };
  return tables;
}

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
