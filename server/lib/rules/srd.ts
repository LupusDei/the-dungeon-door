/**
 * The SRD 5.2 tables the engine uses (server/data/srd/5.2, CC-BY-4.0). The JSON is checked here, once,
 * where it enters, and reduced to the fields the rules read; everything inside lib/rules/ trusts it.
 */
import { z } from 'zod';
import armorJson from '../../data/srd/5.2/armor.json' with { type: 'json' };
import backgroundsJson from '../../data/srd/5.2/backgrounds.json' with { type: 'json' };
import advancementJson from '../../data/srd/5.2/characterAdvancement.json' with { type: 'json' };
import classesJson from '../../data/srd/5.2/classes.json' with { type: 'json' };
import featsJson from '../../data/srd/5.2/feats.json' with { type: 'json' };
import pointCostsJson from '../../data/srd/5.2/abilityScorePointCosts.json' with { type: 'json' };
import skillsJson from '../../data/srd/5.2/skills.json' with { type: 'json' };
import subclassesJson from '../../data/srd/5.2/subclasses.json' with { type: 'json' };
import speciesJson from '../../data/srd/5.2/species.json' with { type: 'json' };
import spellSlotsJson from '../../data/srd/5.2/spellSlots.json' with { type: 'json' };
import spellsJson from '../../data/srd/5.2/spells.json' with { type: 'json' };
import weaponsJson from '../../data/srd/5.2/weapons.json' with { type: 'json' };
import { ABILITIES, type Ability } from './abilities.ts';

export type Size = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';
export interface Item { id: string; name: string; count: number }
/** One starting-equipment option: what you get, its gold, and choices inside it the engine doesn't make. */
export interface EquipmentOption { items: Item[]; gp: number; pending: string[] }
export interface ProficiencyChoice { choose: number; from: string[] }

export interface SrdClass {
  id: string; name: string; hitDie: number; saves: Ability[];
  /** e.g. "light-armor", "all-armor", "shields", "simple-weapons", "scimitars". */
  proficiencies: string[];
  choices: ProficiencyChoice[];
  equipment: EquipmentOption[];
  /** Levels 1 to 20: the features gained at each. */
  levels: { level: number; features: { id: string; name: string }[] }[];
  subclasses: string[];
  /** The class level at which the subclass is chosen (its first "<class>-subclass" feature). */
  subclassLevel: number;
}
export interface SrdSubclass { id: string; name: string; classId: string; features: { name: string; level: number }[] }
export interface Advancement { level: number; xp: number; proficiencyBonus: number }
export type FeatType = 'origin' | 'general' | 'fighting-style' | 'epic-boon';
export interface SrdFeat {
  id: string; name: string; type: FeatType; minLevel: number;
  /** One of `abilities` must be at least `minimum` (Grappler: STR or DEX 13). */
  prerequisite: { abilities: Ability[]; minimum: number } | null;
  /** The +1 the feat grants: to one of `from`, up to `max`. */
  increase: { from: Ability[]; max: number } | null;
  needsSpellcasting: boolean;
}
export interface SrdSpecies { id: string; name: string; sizes: Size[]; speed: number; traits: string[] }
export interface SrdBackground { id: string; name: string; abilities: Ability[]; feat: string; proficiencies: string[]; equipment: EquipmentOption[] }
export interface SrdArmor {
  id: string; name: string; category: 'light' | 'medium' | 'heavy' | 'shield';
  base: number; dexBonus: boolean; maxDexBonus: number | null; strengthMinimum: number; stealthDisadvantage: boolean;
}
export interface SrdWeapon {
  id: string; name: string; category: 'simple' | 'martial'; range: 'melee' | 'ranged';
  damage: string; damageType: string; versatileDamage: string | null; properties: string[];
  normalRange: number; longRange: number | null; mastery: string | null;
}
export interface SrdSpell { id: string; name: string; level: number; classes: string[] }
export interface CastingLevel { cantrips: number; prepared: number; slots: number[] }
export interface SrdSpellcasting { classId: string; casterType: string; byLevel: CastingLevel[] }

export interface Srd {
  classes: ReadonlyMap<string, SrdClass>;
  species: ReadonlyMap<string, SrdSpecies>;
  backgrounds: ReadonlyMap<string, SrdBackground>;
  armor: ReadonlyMap<string, SrdArmor>;
  weapons: ReadonlyMap<string, SrdWeapon>;
  /** skill id ("stealth") → its ability. */
  skills: ReadonlyMap<string, Ability>;
  spells: ReadonlyMap<string, SrdSpell>;
  spellcasting: ReadonlyMap<string, SrdSpellcasting>;
  /** point-buy score → cost. */
  pointCosts: ReadonlyMap<number, number>;
  /** Levels 1 to 20, in order. */
  advancement: Advancement[];
  subclasses: ReadonlyMap<string, SrdSubclass>;
  feats: ReadonlyMap<string, SrdFeat>;
}

const ref = z.object({ index: z.string(), name: z.string() });
const ability = z.object({ index: z.enum(ABILITIES) }).transform((a) => a.index);
const size = z.enum(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']);

type Part = { item: Item } | { gp: number } | { pending: string };
const part: z.ZodType<Part> = z.union([
  z.object({ optionType: z.literal('counted_reference'), count: z.number(), of: ref })
    .transform((p) => ({ item: { id: p.of.index, name: p.of.name, count: p.count } })),
  z.object({ optionType: z.literal('money'), count: z.number(), unit: z.literal('gp') }).transform((p) => ({ gp: p.count })),
  z.object({
    optionType: z.literal('choice'),
    choice: z.object({ desc: z.string().optional(), from: z.object({ equipmentCategory: ref.optional() }) }),
  }).transform((p) => ({ pending: p.choice.desc ?? `one of ${p.choice.from.equipmentCategory?.name}` })),
]);

function toOption(parts: Part[]): EquipmentOption {
  const option: EquipmentOption = { items: [], gp: 0, pending: [] };
  for (const p of parts) {
    if ('item' in p) option.items.push(p.item);
    else if ('gp' in p) option.gp += p.gp;
    else option.pending.push(p.pending);
  }
  return option;
}

const equipmentOptions = z
  .array(z.object({ from: z.object({ options: z.array(z.union([z.object({ optionType: z.literal('multiple'), items: z.array(part) }), part])) }) }))
  .transform((sets) => sets.flatMap((s) => s.from.options.map((o) => toOption('items' in o ? o.items : [o]))));

const referenceIds = z.object({ options: z.array(z.object({ item: ref })) }).transform((f) => f.options.map((o) => o.item.index));
/** A nested choice ("artisan's tools or a musical instrument") flattens into one list to choose from. */
const choiceOption = z.union([
  z.object({ item: ref }).transform((o) => [o.item.index]),
  z.object({ choice: z.object({ from: referenceIds }) }).transform((o) => o.choice.from),
]);
const proficiencyChoice = z.object({ choose: z.number(), from: z.object({ options: z.array(choiceOption) }) })
  .transform((c) => ({ choose: c.choose, from: c.from.options.flat() }));

const classSchema = z.object({
  index: z.string(), name: z.string(), hitDie: z.number(), savingThrows: z.array(z.enum(ABILITIES)),
  proficiencies: z.array(ref), proficiencyChoices: z.array(proficiencyChoice), startingEquipmentOptions: equipmentOptions,
  subclasses: z.array(ref), levels: z.array(z.object({ level: z.number(), features: z.array(ref) })).length(20),
}).transform((c): SrdClass => ({
  id: c.index, name: c.name, hitDie: c.hitDie, saves: c.savingThrows, proficiencies: c.proficiencies.map((p) => p.index),
  choices: c.proficiencyChoices, equipment: c.startingEquipmentOptions,
  levels: c.levels.map((l) => ({ level: l.level, features: l.features.map((f) => ({ id: f.index, name: f.name })) })),
  subclasses: c.subclasses.map((s) => s.index),
  subclassLevel: c.levels.find((l) => l.features.some((f) => f.index === `${c.index}-subclass`))!.level,
}));

const subclassSchema = z.object({
  index: z.string(), name: z.string(), class: ref, features: z.array(z.object({ name: z.string(), level: z.number() })),
}).transform((s): SrdSubclass => ({ id: s.index, name: s.name, classId: s.class.index, features: s.features }));

const advancementSchema = z.object({ level: z.number(), experiencePoints: z.number(), proficiencyBonus: z.number() })
  .transform((a): Advancement => ({ level: a.level, xp: a.experiencePoints, proficiencyBonus: a.proficiencyBonus }));

const ABILITY_NAMES: Readonly<Record<string, Ability>> = {
  Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha',
};
/** "Increase your Strength or Dexterity score by 1, to a maximum of 20" (or "one ability score of your choice"). */
const INCREASE = /Increase (?:one ability score of your choice|your ([A-Za-z, ]+?) score) by 1, to a maximum of (\d+)/;

function featIncrease(description: string): SrdFeat['increase'] {
  const match = INCREASE.exec(description);
  if (!match) return null;
  const from = match[1] ? match[1].split(/, (?:or )?| or /).map((name) => ABILITY_NAMES[name]) : [...ABILITIES];
  return { from, max: Number(match[2]) };
}

const featSchema = z.object({
  index: z.string(), name: z.string(), type: z.enum(['origin', 'general', 'fighting-style', 'epic-boon']), description: z.string(),
  prerequisites: z.object({ minimumLevel: z.number().optional(), featureNamed: z.string().optional() }).optional(),
  prerequisiteOptions: z.object({ from: z.object({ options: z.array(z.object({ abilityScore: ability, minimumScore: z.number() })) }) }).optional(),
}).transform((f): SrdFeat => ({
  id: f.index, name: f.name, type: f.type, minLevel: f.prerequisites?.minimumLevel ?? 1,
  prerequisite: f.prerequisiteOptions
    ? { abilities: f.prerequisiteOptions.from.options.map((o) => o.abilityScore), minimum: f.prerequisiteOptions.from.options[0].minimumScore }
    : null,
  increase: featIncrease(f.description),
  needsSpellcasting: f.prerequisites?.featureNamed === 'Spellcasting',
}));

const speciesSchema = z.object({
  index: z.string(), name: z.string(), speed: z.number(), traits: z.array(ref), size: size.optional(),
  sizeOptions: z.object({ from: z.object({ options: z.array(z.object({ size })) }) }).optional(),
}).transform((s): SrdSpecies => ({
  id: s.index, name: s.name, speed: s.speed, traits: s.traits.map((t) => t.index),
  sizes: s.sizeOptions?.from.options.map((o) => o.size) ?? [s.size ?? 'Medium'],
}));

const backgroundSchema = z.object({
  index: z.string(), name: z.string(), abilityScores: z.array(ability), feat: z.object({ name: z.string() }),
  proficiencies: z.array(ref), equipmentOptions,
}).transform((b): SrdBackground => ({
  id: b.index, name: b.name, abilities: b.abilityScores, feat: b.feat.name,
  proficiencies: b.proficiencies.map((p) => p.index), equipment: b.equipmentOptions,
}));

const armorSchema = z.object({
  index: z.string(), name: z.string(), category: z.enum(['light', 'medium', 'heavy', 'shield']),
  armorClass: z.object({ base: z.number(), dexBonus: z.boolean(), maxBonus: z.number().nullable() }),
  strengthMinimum: z.number(), stealthDisadvantage: z.boolean(),
}).transform((a): SrdArmor => ({
  id: a.index, name: a.name, category: a.category, base: a.armorClass.base, dexBonus: a.armorClass.dexBonus,
  maxDexBonus: a.armorClass.maxBonus, strengthMinimum: a.strengthMinimum, stealthDisadvantage: a.stealthDisadvantage,
}));

const damage = z.object({ damageDice: z.string(), damageType: ref });
const weaponSchema = z.object({
  index: z.string(), name: z.string(), category: z.enum(['simple', 'martial']), weaponRange: z.enum(['melee', 'ranged']),
  damage, twoHandedDamage: damage.nullish(), properties: z.array(z.string()),
  /** The table leaves a few melee weapons' range out (Morningstar); melee reach is 5 ft. */
  range: z.object({ normal: z.number(), long: z.number().nullable() }).nullable().transform((r) => r ?? { normal: 5, long: null }),
  mastery: z.string().nullish(),
}).transform((w): SrdWeapon => ({
  id: w.index, name: w.name, category: w.category, range: w.weaponRange, damage: w.damage.damageDice,
  damageType: w.damage.damageType.index, versatileDamage: w.twoHandedDamage?.damageDice ?? null, properties: w.properties,
  normalRange: w.range.normal, longRange: w.range.long, mastery: w.mastery ?? null,
}));

const skillSchema = z.object({ index: z.string(), abilityScore: ability });
const spellSchema = z.object({ index: z.string(), name: z.string(), level: z.number(), classes: z.array(z.string()) })
  .transform((s): SrdSpell => ({ id: s.index, name: s.name, level: s.level, classes: s.classes }));
const spellcastingSchema = z.object({
  class: z.string(), casterType: z.string(),
  byLevel: z.array(z.object({ cantripsKnown: z.number(), preparedSpells: z.number(), slots: z.array(z.number()) })),
}).transform((s): SrdSpellcasting => ({
  classId: s.class, casterType: s.casterType,
  byLevel: s.byLevel.map((l) => ({ cantrips: l.cantripsKnown, prepared: l.preparedSpells, slots: l.slots })),
}));
const pointCostSchema = z.object({ score: z.number(), cost: z.number() });

/** The records of one SRD table, checked against `schema`; a bad table names itself and the first bad field. */
export function parseTable<S extends z.ZodType>(table: string, schema: S, json: unknown): z.output<S>[] {
  const parsed = z.object({ records: z.array(schema) }).safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`SRD table ${table} is malformed: ${issue.path.join('.')}: ${issue.message}`);
  }
  return parsed.data.records;
}

const byId = <T extends { id: string }>(records: T[]) => new Map(records.map((r) => [r.id, r]));

function load(): Srd {
  return {
    classes: byId(parseTable('classes', classSchema, classesJson)),
    species: byId(parseTable('species', speciesSchema, speciesJson)),
    backgrounds: byId(parseTable('backgrounds', backgroundSchema, backgroundsJson)),
    armor: byId(parseTable('armor', armorSchema, armorJson)),
    weapons: byId(parseTable('weapons', weaponSchema, weaponsJson)),
    skills: new Map(parseTable('skills', skillSchema, skillsJson).map((s) => [s.index, s.abilityScore])),
    spells: byId(parseTable('spells', spellSchema, spellsJson)),
    spellcasting: new Map(parseTable('spellSlots', spellcastingSchema, spellSlotsJson).map((s) => [s.classId, s])),
    pointCosts: new Map(parseTable('abilityScorePointCosts', pointCostSchema, pointCostsJson).map((c) => [c.score, c.cost])),
    advancement: parseTable('characterAdvancement', advancementSchema, advancementJson),
    subclasses: byId(parseTable('subclasses', subclassSchema, subclassesJson)),
    feats: byId(parseTable('feats', featSchema, featsJson)),
  };
}

/** `load`, run on the first call only; later calls share its result. */
export function once<T>(load: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => {
    cached ??= { value: load() };
    return cached.value;
  };
}

/** The SRD 5.2 tables, parsed on first use. */
export const srd: () => Srd = once(load);
