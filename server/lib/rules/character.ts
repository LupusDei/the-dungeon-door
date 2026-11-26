/**
 * Character generation, SRD 5.2, level 1: the player's choices in, a checked CharacterSheet out.
 * See docs/rules-design.md, "Character generation".
 */
import {
  ABILITIES, type Ability, type AbilityMethod, type AbilityScores, type BackgroundBoost,
  abilityModifier, applyBackgroundBoost, scoresFor,
} from './abilities.ts';
import { asItStands } from './checks.ts';
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

export interface SpellPick { count: number; noun: string; list: string; onList: (id: string) => boolean }

export function requireSpells(chosen: readonly string[], pick: SpellPick): string[] {
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
  return { slots, expended: slots.map((n) => Math.min(n, spent)) };
}

/** Expertise each feature grants (SRD 5.2): Rogue 1 and 6, Bard 2 and 9, Ranger 9 give two skills; Deft Explorer one. */
const EXPERTISE_GRANTS: Readonly<Record<string, number>> = { Expertise: 2, 'Deft Explorer': 1 };

/**
 * The hero's Expertise: the skills already chosen, then (for grants not yet used) its proficient skills
 * with the best bonus, so a quick-built hero gets the obvious picks.
 */
export function expertiseOf(sheet: CharacterSheet, scores: AbilityScores, data: Srd): string[] {
  const slots = sheet.features.reduce((n, f) => n + (EXPERTISE_GRANTS[f] ?? 0), 0);
  const { expertise: chosen = [] } = sheet;
  const open = sheet.skills
    .filter((s) => !chosen.includes(s))
    .sort((a, b) => scores[data.skills.get(b)!] - scores[data.skills.get(a)!] || a.localeCompare(b));
  return [...chosen, ...open].slice(0, Math.max(slots, chosen.length));
}

/**
 * Every number that follows from the rest of the sheet: proficiency bonus by level, max HP from the hit
 * die rolls (each level at least 1), AC, save and skill bonuses, passive Perception (as it stands: less
 * exhaustion, as for any d20 test), and the spell save
 * DC, attack bonus and slots. HP is kept, but not above the new maximum.
 */
export function rederive(sheet: CharacterSheet, data: Srd = bundledSrd()): CharacterSheet {
  const pb = data.advancement[sheet.level - 1].proficiencyBonus;
  const scores = sheet.abilityScores;
  const bonus = (score: number, proficient: boolean) => abilityModifier(score) + (proficient ? pb : 0);
  const expertise = expertiseOf(sheet, scores, data);
  const skillBonuses = Object.fromEntries([...data.skills].map(([skill, ability]) =>
    [skill, bonus(scores[ability], sheet.skills.includes(skill)) + (expertise.includes(skill) ? pb : 0)]));
  const perLevel = abilityModifier(scores.con) + (sheet.traits.includes('dwarven-toughness') ? 1 : 0);
  const maxHp = sheet.hpRolls.reduce((sum, roll) => sum + Math.max(1, roll + perLevel), 0);
  const casting = sheet.spellcasting;
  return asItStands({
    ...sheet, proficiencyBonus: pb, maxHp, hp: Math.min(sheet.hp, maxHp), ...(expertise.length ? { expertise } : {}),
    armorClass: armorClass(sheet.classId, scores, sheet.otherProficiencies, sheet.equipment, data),
    saveBonuses: Object.fromEntries(ABILITIES.map((a) => [a, bonus(scores[a], sheet.savingThrows.includes(a))])) as CharacterSheet['saveBonuses'],
    skillBonuses,
    spellcasting: casting && {
      ...casting, saveDc: 8 + bonus(scores[casting.ability], true), attackBonus: bonus(scores[casting.ability], true),
      ...slotsAt(data.spellcasting.get(sheet.classId)!, sheet.level, casting.expended),
    },
  });
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
    hitDiceSpent: 0, exhaustion: 0, resourcesUsed: {},
    savingThrows: cls.saves, skills, otherProficiencies,
    equipment, gp: kit[0].gp + kit[1].gp, pendingChoices: kit.flatMap((o) => o.pending),
    traits: species.traits, feat: background.feat, feats: [], features: cls.levels[0].features.map((f) => f.name),
    spellcasting: spellcasting(cls, choices, data),
  }, data);
  return parseCharacterSheet({ ...sheet, hp: sheet.maxHp });
}

/** What to fill in: anything left out is chosen at random. */
export interface QuickRequest { name: string; classId?: string; speciesId?: string; backgroundId?: string }

/**
 * How a quick hero is built. `primary` (new heroes): the standard array best-first to the class's primary
 * abilities, then Constitution, then the rest at random; the background's +2 and +1 to those where it
 * allows; a healer prepares its best healing spell. `classic` (heroes stored before Phase 5 without a
 * sheet, so their numbers never change): best-first to the class's saves, boosts and spells at random.
 */
export type BuildStyle = 'primary' | 'classic';

const spellsOf = (data: Srd, classId: string, level: number) =>
  [...data.spells.values()].filter((s) => s.level === level && s.classes.includes(classId)).map((s) => s.id);

interface Style {
  first: (cls: SrdClass) => Ability[];
  boost: (rng: Rng, allowed: readonly Ability[], first: readonly Ability[]) => { kind: 'twoOne'; plusTwo: Ability; plusOne: Ability };
  /** Spells prepared first when the class has them, best first (the rest are at random). */
  firstSpells: readonly string[];
}

/** A healer prepares its best healing spell first; a wizard or sorcerer, Magic Missile (darts that never miss). */
const FIRST_SPELLS = ['cure-wounds', 'healing-word', 'magic-missile'];

const STYLES: Record<BuildStyle, Style> = {
  primary: { first: (cls) => [...new Set<Ability>([...cls.primary, 'con'])], boost: boostFor, firstSpells: FIRST_SPELLS },
  classic: { first: (cls) => cls.saves, boost: (rng, allowed) => boostFor(rng, allowed, []), firstSpells: [] },
};

/** A full, legal set of choices, chosen by the rng: "roll me a hero", or an NPC for the DM (see BuildStyle); the gear options are taken. */
export function quickChoices(rng: Rng, request: QuickRequest, data: Srd = bundledSrd(), style: BuildStyle = 'primary'): CharacterChoices {
  const cls = lookup(data.classes, request.classId ?? pick(rng, [...data.classes.keys()]), 'class');
  const species = lookup(data.species, request.speciesId ?? pick(rng, [...data.species.keys()]), 'species');
  const background = lookup(data.backgrounds, request.backgroundId ?? pick(rng, [...data.backgrounds.keys()]), 'background');
  const how = STYLES[style];
  const first = how.first(cls);
  const rest = ABILITIES.filter((a) => !first.includes(a));
  const boost = how.boost(rng, background.abilities, first);
  return {
    name: request.name, classId: cls.id, speciesId: species.id, backgroundId: background.id,
    size: pick(rng, species.sizes),
    abilities: { kind: 'standardArray', order: [...first, ...sample(rng, rest, rest.length)] },
    boost,
    classChoices: pickClassChoices(rng, cls, background), classEquipment: 0, backgroundEquipment: 0,
    ...pickSpells(rng, cls.id, data, how.firstSpells),
  };
}

/** The background's +2 and +1 to the first of `wanted` it allows, in order; what is left, at random. */
function boostFor(rng: Rng, allowed: readonly Ability[], wanted: readonly Ability[]): { kind: 'twoOne'; plusTwo: Ability; plusOne: Ability } {
  const liked = wanted.filter((a) => allowed.includes(a));
  const [plusTwo, plusOne] = [...liked, ...sample(rng, allowed.filter((a) => !liked.includes(a)), Math.max(0, 2 - liked.length))];
  return { kind: 'twoOne', plusTwo, plusOne };
}

function pickClassChoices(rng: Rng, cls: SrdClass, background: SrdBackground): string[][] {
  const taken = new Set(background.proficiencies);
  return cls.choices.map((choice) => {
    const picked = sample(rng, choice.from.filter((id) => !taken.has(id)), choice.choose);
    picked.forEach((id) => taken.add(id));
    return picked;
  });
}

/** Cantrips at random; the first prepared spell is the first of `firstSpells` the class has, the rest at random. */
function pickSpells(rng: Rng, classId: string, data: Srd, firstSpells: readonly string[]): { cantrips: string[]; prepared: string[] } {
  const casting = data.spellcasting.get(classId)?.byLevel[0] ?? { cantrips: 0, prepared: 0 };
  const known = spellsOf(data, classId, 1);
  const healer = firstSpells.filter((id) => known.includes(id)).slice(0, 1);
  return {
    cantrips: sample(rng, spellsOf(data, classId, 0), casting.cantrips),
    prepared: [...healer, ...sample(rng, known.filter((id) => !healer.includes(id)), casting.prepared - healer.length)],
  };
}
