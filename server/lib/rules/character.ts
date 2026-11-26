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
import type { EquipmentOption, Item, Size, Srd, SrdBackground, SrdClass, SrdSpecies, SrdSpellcasting } from './srd.ts';
import { srd as bundledSrd } from './srd.ts';
import { lookup, require } from './violation.ts';

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

const SKILL_PREFIX = 'skill-';
const SPELLCASTING_ABILITY: Readonly<Record<string, Ability>> = {
  bard: 'cha', cleric: 'wis', druid: 'wis', paladin: 'cha', ranger: 'wis', sorcerer: 'cha', warlock: 'cha', wizard: 'int',
};
/** Unarmored Defense: the ability added to 10 + DEX, and whether a shield may be used with it. */
const UNARMORED_DEFENSE: Readonly<Record<string, { ability: Ability; shield: boolean }>> = {
  barbarian: { ability: 'con', shield: true },
  monk: { ability: 'wis', shield: false },
};

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

function spellcasting(cls: SrdClass, choices: CharacterChoices, data: Srd): CharacterSheet['spellcasting'] {
  const casting = data.spellcasting.get(cls.id);
  const { cantrips = [], prepared = [] } = choices;
  if (!casting) {
    require(cantrips.length === 0 && prepared.length === 0, `${cls.name} casts no spells`);
    return null;
  }
  const level = casting.byLevel[0];
  const onList = (spellLevel: number) => (id: string) => data.spells.get(id)?.level === spellLevel && data.spells.get(id)!.classes.includes(cls.id);
  return {
    ability: SPELLCASTING_ABILITY[cls.id],
    ...UNDERIVED_SPELLCASTING,
    cantrips: requireSpells(cantrips, { count: level.cantrips, noun: 'cantrips', list: `${cls.name} cantrip`, onList: onList(0) }),
    prepared: requireSpells(prepared, { count: level.prepared, noun: 'prepared spells', list: `${cls.name} level-1 spell`, onList: onList(1) }),
  };
}

/** Placeholders for the numbers rederive fills in. */
const UNDERIVED_SPELLCASTING = { saveDc: 0, attackBonus: 0, slots: [], expended: [0, 0, 0, 0, 0, 0, 0, 0, 0], concentratingOn: null };
const UNDERIVED = {
  proficiencyBonus: 0, maxHp: 0, hp: 0, armorClass: 0, passivePerception: 0, skillBonuses: {},
  saveBonuses: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
};

/**
 * The slots for a level, keeping what was spent. Pact slots are all of one level, which rises with the
 * warlock's level, so the spent ones move up with it.
 */
function slotsAt(casting: SrdSpellcasting, level: number, expended: readonly number[]): { slots: number[]; expended: number[] } {
  const slots = [...casting.byLevel[level - 1].slots];
  if (casting.casterType !== 'pact') return { slots, expended: expended.map((n, i) => Math.min(n, slots[i])) };
  const spent = expended.reduce((sum, n) => sum + n, 0);
  return { slots, expended: slots.map((n) => Math.min(n, n > 0 ? spent : 0)) };
}

/**
 * Every number that follows from the rest of the sheet: proficiency bonus by level, max HP from the hit
 * die rolls (each level at least 1), AC, save and skill bonuses, passive Perception, and the spell save
 * DC, attack bonus and slots. HP is kept, but not above the new maximum.
 */
export function rederive(sheet: CharacterSheet, data: Srd = bundledSrd()): CharacterSheet {
  const pb = data.advancement[sheet.level - 1].proficiencyBonus;
  const scores = sheet.abilityScores;
  const bonus = (score: number, proficient: boolean) => abilityModifier(score) + (proficient ? pb : 0);
  const skillBonuses = Object.fromEntries([...data.skills].map(([skill, ability]) => [skill, bonus(scores[ability], sheet.skills.includes(skill))]));
  const perLevel = abilityModifier(scores.con) + (sheet.traits.includes('dwarven-toughness') ? 1 : 0);
  const maxHp = sheet.hpRolls.reduce((sum, roll) => sum + Math.max(1, roll + perLevel), 0);
  const casting = sheet.spellcasting;
  return {
    ...sheet, proficiencyBonus: pb, maxHp, hp: Math.min(sheet.hp, maxHp),
    armorClass: armorClass(sheet.classId, scores, sheet.otherProficiencies, sheet.equipment, data),
    saveBonuses: Object.fromEntries(ABILITIES.map((a) => [a, bonus(scores[a], sheet.savingThrows.includes(a))])) as CharacterSheet['saveBonuses'],
    skillBonuses, passivePerception: 10 + skillBonuses.perception,
    spellcasting: casting && {
      ...casting, saveDc: 8 + bonus(scores[casting.ability], true), attackBonus: bonus(scores[casting.ability], true),
      ...slotsAt(data.spellcasting.get(sheet.classId)!, sheet.level, casting.expended),
    },
  };
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
  const otherProficiencies = [...cls.proficiencies, ...proficiencies.filter((p) => !p.startsWith(SKILL_PREFIX))];
  const sheet = rederive({
    ...UNDERIVED,
    version: 1, name: choices.name, level: 1, xp: 0, classId: cls.id, speciesId: species.id, backgroundId: background.id,
    subclassId: null, size, speed: species.speed, abilityScores: scores, abilityRolls: rolled.rolls, hpRolls: [cls.hitDie],
    savingThrows: cls.saves, skills, otherProficiencies,
    equipment, gp: kit[0].gp + kit[1].gp, pendingChoices: kit.flatMap((o) => o.pending),
    traits: species.traits, feat: background.feat, feats: [], features: cls.levels[0].features.map((f) => f.name),
    spellcasting: spellcasting(cls, choices, data),
  }, data);
  return parseCharacterSheet({ ...sheet, hp: sheet.maxHp });
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
