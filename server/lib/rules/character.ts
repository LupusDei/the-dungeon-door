/**
 * Character generation, SRD 5.2, level 1: the player's choices in, a checked CharacterSheet out.
 * See docs/rules-design.md, "Character generation".
 */
import {
  ABILITIES, type Ability, type AbilityMethod, type AbilityScores, type BackgroundBoost,
  abilityModifier, applyBackgroundBoost, scoresFor,
} from './abilities.ts';
import { type Rng, pick, sample } from './rng.ts';
import { type CharacterSheet, parseCharacterSheet } from './sheet.ts';
import type { EquipmentOption, Item, Size, Srd, SrdBackground, SrdClass, SrdSpecies } from './srd.ts';
import { srd as bundledSrd } from './srd.ts';
import { require } from './violation.ts';

export interface CharacterChoices {
  name: string;
  classId: string;
  speciesId: string;
  backgroundId: string;
  /** Only for a species that offers a choice of size (Tiefling). */
  size?: Size;
  abilities: AbilityMethod;
  boost: BackgroundBoost;
  /** One list per class proficiency choice, in the class's order, by SRD id ("skill-stealth"). */
  classChoices: string[][];
  /** Index of the class's starting-equipment option (A = 0) and the background's. */
  classEquipment: number;
  backgroundEquipment: number;
  cantrips?: string[];
  prepared?: string[];
}

const PROFICIENCY_BONUS_AT_1 = 2;
const SKILL_PREFIX = 'skill-';
const SPELLCASTING_ABILITY: Readonly<Record<string, Ability>> = {
  bard: 'cha', cleric: 'wis', druid: 'wis', paladin: 'cha', ranger: 'wis', sorcerer: 'cha', warlock: 'cha', wizard: 'int',
};
/** Unarmored Defense: the ability added to 10 + DEX, and whether a shield may be used with it. */
const UNARMORED_DEFENSE: Readonly<Record<string, { ability: Ability; shield: boolean }>> = {
  barbarian: { ability: 'con', shield: true },
  monk: { ability: 'wis', shield: false },
};

function lookup<T>(table: ReadonlyMap<string, T>, id: string, kind: string): T {
  const found = table.get(id);
  require(found !== undefined, `there is no ${kind} ${id}`);
  return found;
}

function sizeFor(species: SrdSpecies, size: Size | undefined): Size {
  if (species.sizes.length > 1) {
    require(size !== undefined && species.sizes.includes(size), `choose a size: ${species.sizes.join(' or ')}`);
    return size;
  }
  require(size === undefined || size === species.sizes[0], `a ${species.name} is ${species.sizes[0]}`);
  return species.sizes[0];
}

function requireDistinct(ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    require(!seen.has(id), `${id} is chosen twice`);
    seen.add(id);
  }
}

/** The class's proficiency choices, checked; returns every chosen id. */
function classProficiencies(cls: SrdClass, chosen: readonly string[][], background: SrdBackground): string[] {
  require(chosen.length === cls.choices.length, `${cls.name} has ${cls.choices.length} proficiency choice(s)`);
  cls.choices.forEach((choice, i) => {
    require(chosen[i].length === choice.choose, `choose ${choice.choose} for ${cls.name} choice ${i + 1}`);
    for (const id of chosen[i]) require(choice.from.includes(id), `${id} is not a ${cls.name} choice`);
  });
  const ids = chosen.flat();
  requireDistinct([...background.proficiencies, ...ids]);
  return ids;
}

function equipmentOption(owner: { name: string; equipment: EquipmentOption[] }, index: number): EquipmentOption {
  const last = String.fromCharCode(64 + owner.equipment.length);
  require(index >= 0 && index < owner.equipment.length, `${owner.name} has equipment options A to ${last}`);
  return owner.equipment[index];
}

function pooled(items: readonly Item[]): Item[] {
  const byId = new Map<string, Item>();
  for (const item of items) {
    const held = byId.get(item.id);
    byId.set(item.id, { ...item, count: (held?.count ?? 0) + item.count });
  }
  return [...byId.values()];
}

const canWear = (category: string, proficiencies: readonly string[]) =>
  proficiencies.includes(`${category}-armor`) || (category !== 'shield' && proficiencies.includes('all-armor'));

/** The best AC the hero can have from what it carries and is proficient with, or Unarmored Defense. */
export function armorClass(classId: string, scores: AbilityScores, proficiencies: readonly string[], equipment: readonly Item[], data: Srd): number {
  const dex = abilityModifier(scores.dex);
  const worn = equipment.map((i) => data.armor.get(i.id)).filter((a) => a !== undefined);
  const shield = proficiencies.includes('shields') && worn.some((a) => a.category === 'shield') ? 2 : 0;
  const unarmored = UNARMORED_DEFENSE[classId];
  const bodies = worn
    .filter((a) => a.category !== 'shield' && canWear(a.category, proficiencies))
    .map((a) => a.base + (a.dexBonus ? Math.min(dex, a.maxDexBonus ?? dex) : 0) + shield);
  const bare = unarmored ? 10 + dex + abilityModifier(scores[unarmored.ability]) + (unarmored.shield ? shield : 0) : 10 + dex + shield;
  return Math.max(bare, ...bodies);
}

interface SpellPick { count: number; noun: string; list: string; onList: (id: string) => boolean }

function requireSpells(chosen: readonly string[], pick: SpellPick): string[] {
  require(chosen.length === pick.count, `choose ${pick.count} ${pick.noun}`);
  requireDistinct(chosen);
  for (const id of chosen) require(pick.onList(id), `${id} is not a ${pick.list}`);
  return [...chosen];
}

function spellcasting(cls: SrdClass, scores: AbilityScores, choices: CharacterChoices, data: Srd): CharacterSheet['spellcasting'] {
  const casting = data.spellcasting.get(cls.id);
  const { cantrips = [], prepared = [] } = choices;
  if (!casting) {
    require(cantrips.length === 0 && prepared.length === 0, `${cls.name} casts no spells`);
    return null;
  }
  const level = casting.byLevel[0];
  const onList = (spellLevel: number) => (id: string) => data.spells.get(id)?.level === spellLevel && data.spells.get(id)!.classes.includes(cls.id);
  const ability = SPELLCASTING_ABILITY[cls.id];
  const bonus = PROFICIENCY_BONUS_AT_1 + abilityModifier(scores[ability]);
  return {
    ability,
    saveDc: 8 + bonus,
    attackBonus: bonus,
    slots: [...level.slots],
    cantrips: requireSpells(cantrips, { count: level.cantrips, noun: 'cantrips', list: `${cls.name} cantrip`, onList: onList(0) }),
    prepared: requireSpells(prepared, { count: level.prepared, noun: 'prepared spells', list: `${cls.name} level-1 spell`, onList: onList(1) }),
  };
}

function bonus(score: number, proficient: boolean): number {
  return abilityModifier(score) + (proficient ? PROFICIENCY_BONUS_AT_1 : 0);
}

/** Builds a level-1 hero from the player's choices. Throws RuleViolation on a choice the rules forbid. */
export function buildCharacter(choices: CharacterChoices, rng: Rng, data: Srd = bundledSrd()): CharacterSheet {
  const cls = lookup(data.classes, choices.classId, 'class');
  const species = lookup(data.species, choices.speciesId, 'species');
  const background = lookup(data.backgrounds, choices.backgroundId, 'background');
  const size = sizeFor(species, choices.size);
  const rolled = scoresFor(choices.abilities, rng, data.pointCosts);
  const scores = applyBackgroundBoost(rolled.scores, background.abilities, choices.boost);
  const proficiencies = [...background.proficiencies, ...classProficiencies(cls, choices.classChoices, background)];
  const kit = [equipmentOption(cls, choices.classEquipment), equipmentOption(background, choices.backgroundEquipment)];
  const equipment = pooled(kit.flatMap((o) => o.items));
  const skills = proficiencies.filter((p) => p.startsWith(SKILL_PREFIX)).map((p) => p.slice(SKILL_PREFIX.length)).sort();
  const skillBonuses = Object.fromEntries([...data.skills].map(([skill, ability]) => [skill, bonus(scores[ability], skills.includes(skill))]));
  const otherProficiencies = [...cls.proficiencies, ...proficiencies.filter((p) => !p.startsWith(SKILL_PREFIX))];
  const toughness = species.traits.includes('dwarven-toughness') ? 1 : 0;
  const maxHp = cls.hitDie + abilityModifier(scores.con) + toughness;
  return parseCharacterSheet({
    version: 1, name: choices.name, level: 1, classId: cls.id, speciesId: species.id, backgroundId: background.id,
    size, speed: species.speed, abilityScores: scores, abilityRolls: rolled.rolls,
    proficiencyBonus: PROFICIENCY_BONUS_AT_1, maxHp, hp: maxHp,
    armorClass: armorClass(cls.id, scores, otherProficiencies, equipment, data),
    savingThrows: cls.saves, skills, otherProficiencies,
    saveBonuses: Object.fromEntries(ABILITIES.map((a) => [a, bonus(scores[a], cls.saves.includes(a))])),
    skillBonuses, passivePerception: 10 + skillBonuses.perception,
    equipment, gp: kit[0].gp + kit[1].gp, pendingChoices: kit.flatMap((o) => o.pending),
    traits: species.traits, feat: background.feat,
    spellcasting: spellcasting(cls, scores, choices, data),
  });
}

/** What to fill in: anything left out is chosen at random. */
export interface QuickRequest { name: string; classId?: string; speciesId?: string; backgroundId?: string }

const spellsOf = (data: Srd, classId: string, level: number) =>
  [...data.spells.values()].filter((s) => s.level === level && s.classes.includes(classId)).map((s) => s.id);

/**
 * A full, legal set of choices, chosen by the rng: "roll me a hero", or an NPC for the DM. The standard
 * array goes best-first to the class's saving throws, then the rest at random; the gear options are taken.
 */
export function quickChoices(rng: Rng, request: QuickRequest, data: Srd = bundledSrd()): CharacterChoices {
  const cls = lookup(data.classes, request.classId ?? pick(rng, [...data.classes.keys()]), 'class');
  const species = lookup(data.species, request.speciesId ?? pick(rng, [...data.species.keys()]), 'species');
  const background = lookup(data.backgrounds, request.backgroundId ?? pick(rng, [...data.backgrounds.keys()]), 'background');
  const rest = ABILITIES.filter((a) => !cls.saves.includes(a));
  const [plusTwo, plusOne] = sample(rng, background.abilities, 2);
  return {
    name: request.name, classId: cls.id, speciesId: species.id, backgroundId: background.id,
    size: pick(rng, species.sizes),
    abilities: { kind: 'standardArray', order: [...cls.saves, ...sample(rng, rest, rest.length)] },
    boost: { kind: 'twoOne', plusTwo, plusOne },
    classChoices: pickClassChoices(rng, cls, background), classEquipment: 0, backgroundEquipment: 0,
    ...pickSpells(rng, cls.id, data),
  };
}

function pickClassChoices(rng: Rng, cls: SrdClass, background: SrdBackground): string[][] {
  const taken = new Set(background.proficiencies);
  return cls.choices.map((choice) => {
    const picked = sample(rng, choice.from.filter((id) => !taken.has(id)), choice.choose);
    picked.forEach((id) => taken.add(id));
    return picked;
  });
}

function pickSpells(rng: Rng, classId: string, data: Srd): { cantrips: string[]; prepared: string[] } {
  const casting = data.spellcasting.get(classId)?.byLevel[0] ?? { cantrips: 0, prepared: 0 };
  return {
    cantrips: sample(rng, spellsOf(data, classId, 0), casting.cantrips),
    prepared: sample(rng, spellsOf(data, classId, 1), casting.prepared),
  };
}
